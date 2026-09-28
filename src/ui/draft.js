/* 文字PVメーカー v2 — original work. 曲から下書き: finds where the song's voice starts phrases and drafts the start of every automatic line; a review in the step column with audition and try-on, applied as one time.tap (DESIGN_2_2 §5.2). */
MV.def('ui/draft', ['ui/dom', 'ui/icons', 'i18n/t', 'core/draft', 'core/timing', 'core/lyrics', 'core/beats', 'audio/voice'],
  (dom, I, T, CD, TM, LY, B, VO) => {
    'use strict';

    const { h } = dom;
    // The release gate (DESIGN_2_2 §5.2): true labels the ② button 「曲から下書き（試験的）」 when real songs agree
    // with tapped times less than half the time.
    const DRAFT_BETA = false;
    const TRY_MS = 150;                    // the try-on re-plans this long after the last change of the checks
    const AUDITION = Object.freeze({ BEFORE: 1, LENGTH: 3 });   // [▶] plays from 1 s before the drafted start, for 3 s
    const AGREE_MIN = 3;                   // the agreement readout needs this many drafted lines with a tapped start
    const MARK = Object.freeze({ high: '◎', mid: '○', low: '△' });
    const PREROLL = 2;                     // 再生して確認 starts this long before the first drafted line

    // --- the pure parts (tests/node/ui_draft.test.js) ----------------------------------------------------------------

    // input(doc, plan, { redo }) → { lines: [{ id, t0, draft, w, auto }], tapped: Set<lineId> }: the plan's lines with
    // their gap weights (core/timing gapWeights: the read rate pin or the tempo, the blank rows above each line). A line
    // is drafted when its start is automatic; with redo also when its start pin was tapped or set by hand. LRC times,
    // AI times and lock pins are always anchors. tapped: the lines whose start is a tapped pin (the agreement readout).
    function input(doc, plan, opts) {
      const redo = !!(opts && opts.redo);
      const pins = doc.pins || {};
      const lang = (doc.meta && doc.meta.lang) || 'auto';
      let parsed = [];
      try { parsed = LY.linesOf(LY.parseSheet(doc.sheet.rows), { lang }); } catch (e) { parsed = []; }
      const pause = new Map(parsed.map((l) => [l.id, l.pauseBefore || 0]));
      const rate = pins['work:readRate'];
      const readRate = rate && typeof rate.v === 'number' ? rate.v : null;
      const w = TM.gapWeights(plan.lines.map((l) => ({ text: l.text, lang: l.lang, pauseBefore: pause.get(l.id) || 0 })),
        { readRate, bpm: plan.beats ? plan.beats.bpm : null });
      const tapped = new Set();
      const lines = plan.lines.map((l, i) => {
        const pin = pins['line/' + l.id + ':start'];
        const pinned = !!pin && !!l.by && l.by.start === 'pin';
        const auto = !!l.by && l.by.start === 'auto';
        if (pinned && pin.by === 'tap') tapped.add(l.id);
        const redoable = pinned && (pin.by === 'tap' || pin.by === 'user');
        return { id: l.id, t0: l.t0, draft: auto || (redo && redoable), w: w[i], auto };
      });
      return { lines, tapped };
    }

    // checkedByDefault(res) → the proposals checked when the review opens: 確か and たぶん (自信なし rows stay as they are).
    function checkedByDefault(res) {
      return new Set(res.proposals.filter((x) => x.conf !== 'low').map((x) => x.lineId));
    }

    // applyCmd(lines, res, checked) → one time.tap (marks in line order) or null: the checked proposals, and the drafted
    // lines that are already in place (res.kept) on a found onset while their start is automatic, so re-spreading
    // around the new pins does not move them away from it. The pins are by 'tap' (timed against the song).
    function applyCmd(lines, res, checked) {
      const want = new Map();
      for (const x of res.proposals) if (checked.has(x.lineId)) want.set(x.lineId, x.to);
      const auto = new Set(lines.filter((l) => l.auto).map((l) => l.id));
      for (const x of res.kept) if (x.conf !== 'low' && auto.has(x.lineId)) want.set(x.lineId, x.to);
      const marks = lines.filter((l) => want.has(l.id)).map((l) => ({ lineId: l.id, start: want.get(l.id) }));
      return marks.length ? { t: 'time.tap', marks } : null;
    }

    // counts(res) → { a, b, c }: 確か, たぶん and 自信なし among the proposals.
    function counts(res) {
      const n = { high: 0, mid: 0, low: 0 };
      for (const x of res.proposals) n[x.conf]++;
      return { a: n.high, b: n.mid, c: n.low };
    }

    // drafted(lines, res) → how many line starts the draft sets: the proposals plus the kept lines applyCmd pins.
    function drafted(lines, res) {
      const auto = new Set(lines.filter((l) => l.auto).map((l) => l.id));
      return res.proposals.length + res.kept.filter((x) => x.conf !== 'low' && auto.has(x.lineId)).length;
    }

    // --- the panel -------------------------------------------------------------------------------------------------

    function mount(app) {
      const t = app.t;
      const body = h('div', { class: 'draft-body' });
      // The heading takes focus when the panel opens: Tab reaches the controls, and Space still plays (a focused
      // checkbox would take it).
      const heading = h('h2', { class: 'step-title', tabindex: '-1', text: t('draft.title') });
      const root = h('div', { class: 'step step-draft' }, h('div', { class: 'step-head' }, I.icon('wave'), heading), body);

      // The session: phase 'need' (the voice is not read), 'reading' (曲の声を読む runs), 'review'.
      let S = null;
      let digestMemo = { digest: null, act: null, cands: null };

      function source(doc) {
        if (S.source === 'voice') {
          const cands = VO.candidatesIn(S.dec, 0, Infinity);
          return { cands, act: S.dec.act, hz: S.dec.hz };
        }
        const d = doc.song.digest;
        if (digestMemo.digest !== d) {
          const a = VO.digestActivity(d);
          digestMemo = { digest: d, act: a, cands: VO.fromDigest(d) };
        }
        return { cands: digestMemo.cands, act: digestMemo.act.act, hz: digestMemo.act.hz };
      }

      function decoded(doc) {
        const v = doc.song && doc.song.voice;
        if (!VO.hasPhrases(v)) return null;
        try { return VO.decode(v); } catch (e) { return null; }
      }

      // start(): one session at a time; not while tapping. Nothing to draft → a toast, and no panel.
      function start() {
        const doc = app.doc, plan = app.plan;
        if (S || app.view.state.mode === 'tap' || !plan || !plan.lines.length || !doc.song) return false;
        if (!input(doc, plan, {}).lines.some((l) => l.draft)) { app.toast(t('draft.noAuto'), { kind: 'info' }); return false; }
        app.pause();
        if (app.goStep) app.goStep(app.view.state.step);          // the step column shows the panel: unfold it
        S = { phase: 'need', source: null, dec: decoded(doc), redo: false, tryOn: true, userOn: new Set(), userOff: new Set(),
          lines: [], res: null, tapped: new Set(), checked: new Set(), trial: null, abort: null, progress: 0, audition: null };
        app.view.set({ mode: 'draft' });
        if (S.dec) { S.source = 'voice'; propose(true); } else render();
        app.bus.emit('draft');
        if (app.shell) app.shell.playbar.updateStrip();
        return true;
      }

      // Drafts from the source (the stored voice, or the loudness) for the current document; the user's own checks and
      // unchecks are kept by line id.
      function propose(first) {
        const doc = app.doc, plan = app.plan;
        if (!S || !plan || !doc.song) { cancel(); return; }
        const src = source(doc);
        if (!src.cands.length) { app.toast(t('draft.noVoice'), { kind: 'warn' }); cancel(); return; }
        const inp = input(doc, plan, { redo: S.redo });
        const res = CD.draftStarts({ lines: inp.lines, cands: src.cands, voiced: VO.voiced(src.cands, src.act, src.hz),
          duration: plan.duration, grid: plan.beats ? B.grid(plan.beats) : null, snap: doc.timing.snap, digest: S.source === 'digest' });
        const before = S.res;
        S.lines = inp.lines;
        S.tapped = inp.tapped;
        S.res = res;
        S.phase = 'review';
        const def = checkedByDefault(res);
        S.checked = new Set(res.proposals.map((x) => x.lineId)
          .filter((id) => (def.has(id) || S.userOn.has(id)) && !S.userOff.has(id)));
        if (!first && before) app.toast(t('draft.stale'), { kind: 'info' });
        render();
        tryOnSoon();
        app.bus.emit('draft');
        if (app.shell) app.shell.playbar.updateStrip();
      }

      // --- try-on and audition ---------------------------------------------------------------------------------------

      function tryNow() {
        if (!S || S.phase !== 'review' || !S.tryOn) return;
        const cmd = applyCmd(S.lines, S.res, S.checked);
        let trial = null;
        try { trial = cmd ? app.reduce(app.doc, cmd) : null; } catch (e) { trial = null; }
        S.trial = trial;
        app.tryOn(trial, t('draft.strip'));
      }
      const tryOnSoon = dom.debounce(tryNow, TRY_MS);

      // Another try-on replaced the draft's (the AI's, the compare view): 当てて見る turns off, the stage is left alone.
      function tryOnReplaced(doc) {
        if (!S || !S.trial || doc === S.trial) return;
        S.trial = null;
        S.tryOn = false;
        const box = body.querySelector('[data-draft="tryOn"]');
        if (box) box.checked = false;
      }

      function stopAudition() {
        if (S && S.audition) { S.audition(); S.audition = null; }
      }

      function audition(to) {
        if (!S || !app.songReady()) return;
        stopAudition();
        const from = Math.max(0, to - AUDITION.BEFORE), until = from + AUDITION.LENGTH;
        app.seek(from);
        app.play();
        S.audition = app.bus.on('time', (tt) => {
          if (tt < until) return;
          stopAudition();
          app.pause();
        });
      }
      app.view.on((changed, st) => { if (S && changed.includes('playing') && !st.playing) stopAudition(); });

      // --- reading the voice (a song imported by an older build) -----------------------------------------------------

      async function readVoice() {
        if (!S || !app.readVoice) return;
        S.phase = 'reading';
        S.progress = 0;
        S.abort = new AbortController();
        render();
        const session = S;
        const out = await app.readVoice({ signal: S.abort.signal, onProgress: (p) => { if (S === session) { S.progress = p; progress(); } } });
        if (S !== session) return;                 // the draft ended meanwhile
        S.abort = null;
        if (out === 'done') {
          S.dec = decoded(app.doc);
          if (S.dec) { S.source = 'voice'; propose(true); return; }
        }
        if (out === 'cancelled') { app.toast(t('draft.cancelled')); leave(); return; }
        app.toast(t('draft.voiceFailed'), { kind: 'error' });
        S.phase = 'need';
        render();
      }

      function fromLoudness() {
        if (!S || !app.doc.song || !app.doc.song.digest) return;
        S.source = 'digest';
        propose(true);
      }

      // --- leaving ----------------------------------------------------------------------------------------------------

      function leave() {
        if (!S) return;
        tryOnSoon.cancel();
        stopAudition();
        if (S.abort) S.abort.abort();
        const mine = S.trial;
        S = null;
        if (mine) app.tryOn(null);
        app.view.set({ mode: 'normal' });
        app.bus.emit('draft');
        if (app.shell) app.shell.playbar.updateStrip();
      }

      // [やめる] / Esc: nothing is recorded (a voice read meanwhile stays, as its own undo entry).
      function cancel() {
        if (!S) return false;
        const reading = S.phase === 'reading';
        app.pause();
        leave();
        if (reading) app.toast(t('draft.cancelled'));
        return true;
      }

      // [適用]: one undo entry 「曲から下書き（n行）」.
      function apply() {
        if (!S || S.phase !== 'review') return false;
        const cmd = applyCmd(S.lines, S.res, S.checked);
        const n = cmd ? cmd.marks.length : 0;
        app.pause();
        leave();
        if (!cmd) return false;
        app.store.seal();
        app.dispatch(cmd, { label: ['undo.draft', { n }] });
        app.store.seal();
        const from = Math.max(0, cmd.marks[0].start - PREROLL);
        app.toast(t('draft.done', { n }), { kind: 'ok', action: { label: t('tap.check'), run: () => { app.seek(from); app.play(); } } });
        return true;
      }

      // Every document change during the review (an undo, an edit in the timeline): the draft follows the new lines.
      // Opening another work ends it.
      app.bus.on('plan', (e) => {
        if (!S) return;
        if (e && e.kind === 'load') { leave(); return; }
        if (S.phase !== 'review') return;
        if (S.source === 'voice') {
          S.dec = decoded(app.doc);
          if (!S.dec) { S.source = null; S.phase = 'need'; render(); app.bus.emit('draft'); return; }
        }
        propose(false);
      });
      app.bus.on('song', () => { if (S && S.phase === 'need') render(); });

      // --- rendering ----------------------------------------------------------------------------------------------------

      let bar = null, barText = null;
      function progress() {
        if (!bar || !S) return;
        const pct = Math.round(S.progress * 100);
        dom.setStyle(bar, { width: pct + '%' });
        barText.textContent = t('draft.listening', { pct });
      }

      function render() {
        bar = null;
        if (!S) { dom.clear(body); return; }
        if (S.phase === 'need') renderNeed();
        else if (S.phase === 'reading') renderReading();
        else renderReview();
      }

      function button(label, run, cls) {
        return h('button', { class: cls || 'btn', type: 'button', text: label, on: { click: run } });
      }

      function renderNeed() {
        const ready = app.songReady();
        const digest = !!(app.doc.song && app.doc.song.digest);
        const acts = ready ? [button(t('draft.readVoice'), () => readVoice(), 'btn primary')]
          : [button(t('draft.relink'), async () => { await app.pickRelink(); if (S) render(); }, 'btn primary')];
        if (!ready && digest) acts.push(button(t('draft.loudOnly'), () => fromLoudness()));
        acts.push(button(t('draft.stop'), () => cancel()));
        dom.replace(body, h('p', { class: 'note', text: t('draft.needVoice') }), h('div', { class: 'row-actions' }, acts));
      }

      function renderReading() {
        bar = h('div', { class: 'progress-bar' });
        barText = h('div', { class: 'muted small', role: 'status' });
        dom.replace(body, h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar),
          barText, h('div', { class: 'row-actions' }, button(t('draft.cancel'), () => cancel())));
        progress();
      }

      function renderReview() {
        const res = S.res;
        const plan = app.plan;
        const byId = new Map((plan ? plan.lines : []).map((l) => [l.id, l]));
        const c = counts(res);
        const head = [h('p', { class: 'draft-head', text: t('draft.head', { n: drafted(S.lines, res) }) }),
          h('p', { class: 'note subtle', text: t('draft.counts', c) })];
        const agree = CD.agreement(res, S.tapped);
        if (agree.n >= AGREE_MIN) head.push(h('p', { class: 'note', 'data-draft': 'agree', text: t('draft.agree', agree) }));
        const tryBox = h('input', { type: 'checkbox', 'data-draft': 'tryOn', checked: S.tryOn });
        tryBox.addEventListener('change', () => {
          S.tryOn = tryBox.checked;
          if (S.tryOn) tryNow(); else { tryOnSoon.cancel(); const mine = S.trial; S.trial = null; if (mine) app.tryOn(null); }
          if (app.shell) app.shell.playbar.updateStrip();
        });
        const redoBox = h('input', { type: 'checkbox', 'data-draft': 'redo', checked: S.redo });
        redoBox.addEventListener('change', () => { S.redo = redoBox.checked; propose(true); focusData('redo'); });
        const songReady = app.songReady();
        const rows = res.proposals.map((x) => {
          const line = byId.get(x.lineId);
          const n = line ? line.index + 1 : 0;
          const box = h('input', { type: 'checkbox', checked: S.checked.has(x.lineId), 'data-line': x.lineId });
          box.addEventListener('change', () => {
            if (box.checked) { S.checked.add(x.lineId); S.userOn.add(x.lineId); S.userOff.delete(x.lineId); }
            else { S.checked.delete(x.lineId); S.userOff.add(x.lineId); S.userOn.delete(x.lineId); }
            changed();
          });
          const play = h('button', { class: 'icon-btn small', type: 'button', disabled: !songReady,
            'aria-label': t('draft.play'), title: songReady ? t('draft.play') : t('draft.needSongToPlay'),
            on: { click: () => audition(x.to) } }, I.icon('play', { size: 14 }));
          return h('li', { class: 'draft-row', 'data-conf': x.conf },
            h('label', { class: 'check-row draft-check' }, box,
              h('span', { class: 'draft-when', text: t('draft.row', { n, from: T.fmtTime(x.from), to: T.fmtTime(x.to) }) })),
            h('span', { class: 'draft-conf', text: MARK[x.conf] + ' ' + t('draft.conf.' + x.conf) }), play,
            h('span', { class: 'draft-text', text: line ? line.text : '' }));
        });
        const applyBtn = button(t('draft.apply'), () => apply(), 'btn primary');
        applyBtn.dataset.draft = 'apply';
        const aiLink = app.view.state.prefs.ai ? h('button', { class: 'link', type: 'button', text: t('draft.aiBetter'),
          on: { click: () => { cancel(); if (app.actions.has('ai.align')) app.actions.run('ai.align', { from: 'draft' }); } } }) : null;
        dom.replace(body, ...head,
          h('label', { class: 'check-row' }, tryBox, h('span', { text: t('draft.tryOn') })),
          h('label', { class: 'check-row', title: t('draft.redoTip') }, redoBox, h('span', { text: t('draft.redo') })),
          h('ul', { class: 'draft-rows' }, rows),
          h('div', { class: 'row-actions' },
            button(t('draft.all'), () => setAll((x) => true), 'chip-btn'),
            button(t('draft.sure'), () => setAll((x) => x.conf === 'high'), 'chip-btn')),
          h('div', { class: 'row-actions' }, applyBtn, button(t('draft.stop'), () => cancel())),
          h('p', { class: 'note subtle', text: t('draft.keys') }),
          h('p', { class: 'note subtle', text: t('draft.hint') }), aiLink);
        applyBtn.disabled = !applyCmd(S.lines, res, S.checked);
      }

      function focusData(key) {
        const el = body.querySelector('[data-draft="' + key + '"]');
        if (el) dom.focus(el);
      }

      // A check changed: the boxes, 適用 and the try-on follow (the list is not rebuilt, so focus stays).
      function changed() {
        for (const box of body.querySelectorAll('input[data-line]')) box.checked = S.checked.has(box.dataset.line);
        const applyBtn = body.querySelector('[data-draft="apply"]');
        if (applyBtn) applyBtn.disabled = !applyCmd(S.lines, S.res, S.checked);
        tryOnSoon();
        app.bus.emit('draft');
      }

      function setAll(pick) {
        if (!S || S.phase !== 'review') return;
        for (const x of S.res.proposals) {
          if (pick(x)) { S.checked.add(x.lineId); S.userOn.add(x.lineId); S.userOff.delete(x.lineId); }
          else { S.checked.delete(x.lineId); S.userOff.add(x.lineId); S.userOn.delete(x.lineId); }
        }
        changed();
      }

      // The timeline's ticks: each proposal on its line row (checked: solid, unchecked: dashed).
      function marks() {
        if (!S || S.phase !== 'review') return [];
        return S.res.proposals.map((x) => ({ lineId: x.lineId, t: x.to, on: S.checked.has(x.lineId), conf: x.conf }));
      }

      // The play bar's mode strip: 「下書きを試写中 [適用] [やめる]」.
      function strip() {
        if (!S) return null;
        const actions = [];
        if (S.phase === 'review') actions.push({ label: t('draft.apply'), run: () => apply() });
        actions.push({ label: t('draft.stop'), run: () => cancel() });
        return { kind: 'tryon', text: S.trial ? t('draft.strip') : t('draft.title'), actions };
      }

      return { root, start, cancel, apply, active: () => !!S, marks, strip, tryOnReplaced, phase: () => (S ? S.phase : null),
        onShow: () => { if (S && !root.contains(document.activeElement)) dom.focus(heading); } };
    }

    return { mount, input, applyCmd, checkedByDefault, counts, drafted, DRAFT_BETA, AUDITION };
  });
