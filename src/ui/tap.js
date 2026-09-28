/* 文字PVメーカー v2 — original work. Tap mode: Space/Enter, the tap button or a press on the preview marks line starts while the song plays; one time.tap on finish. The one-line mode re-taps a single line: it loops until the line is marked, finishes by itself after it and keeps the other lines still (DESIGN §4.11, §6.4.15; DESIGN_2_2 §5). */
MV.def('ui/tap', ['ui/dom', 'ui/icons', 'ui/keys', 'ui/selection', 'i18n/t', 'planner/plan', 'core/timing'], (dom, I, K, S, T, PL, TM) => {
  'use strict';

  const { h } = dom;
  const PREROLL = 2;                 // playback starts 2 s before the line
  const SEEK_STEP = 3;
  const KEY_ROWS = [['tap.mark', 'tap.keyMark'], ['tap.end', 'tap.keyEnd'], ['tap.back', 'tap.keyBack'],
    ['tap.seek', 'tap.keySeek'], ['tap.pause', 'tap.keyPause'], ['tap.finish', 'tap.keyFinish']];
  // この行だけ打ち直す (PV22 S2): the key rows of the one-line mode (Space = 開始, E = 終わり, Backspace = 打ち直す)
  const ONLY_ROWS = [['tap.mark', 'fld.start'], ['tap.end', 'fld.end'], ['tap.back', 'tap.keyRetry'],
    ['tap.seek', 'tap.keySeek'], ['tap.pause', 'tap.keyPause'], ['tap.finish', 'tap.keyFinish']];

  // The one-line session (PV22 S2, DESIGN_2_2 §5): before the mark playback loops from PREROLL before the line to
  // LOOP_PAD after the later of its end and the next line's start (LOOP_MAX times, then it rewinds and stops); a jump of
  // the clock by more than JUMP that the session did not make, or a pause, is the user taking over and ends the loop.
  // After the mark the session ends by itself at stopAt, or END_PAD after E.
  const ONLY = Object.freeze({ LOOP_PAD: 1.5, LOOP_MAX: 5, JUMP: 0.5, OWN_EPS: 0.05, STOP_MIN: 1, STOP_PAD: 0.5, STOP_MAX: 12,
    END_PAD: 0.3, MOVED: 0.05, ROUNDS: 3 });

  // --- the session rules, pure (tests/node/tap_session.test.js) ------------------------------------------------------

  // loopAt(line, next) → the time past which the loop seeks back (line and next: plan lines; next may be null).
  function loopAt(line, next) { return Math.max(line.t1, next ? next.t0 : line.t1) + ONLY.LOOP_PAD; }

  // stopAt(m, old, nextOld) → when a session marked at m ends by itself: after the line's old length, and after the
  // next line's old start when that is still ahead; at least STOP_MIN, at most STOP_MAX after the mark.
  function stopAt(m, old, nextOld) {
    return Math.min(m + ONLY.STOP_MAX, Math.max(m + ONLY.STOP_MIN, m + (old.t1 - old.t0) + ONLY.STOP_PAD,
      nextOld !== null && nextOld > m ? nextOld + ONLY.STOP_PAD : -Infinity));
  }

  // userSeek(last, t, own) → whether the clock jumped (last → t) without the session asking for it (own: the time
  // the session's own last seek went to, or null).
  function userSeek(last, t, own) {
    return last !== null && Math.abs(t - last) > ONLY.JUMP && !(own !== null && Math.abs(t - own) < ONLY.OWN_EPS);
  }

  // endShift(pins, lineId, start, oldT0, duration) → the new end pin value when the line has a paired start and end pin
  // (a length the user set; neither a lock pin): the end moves with the start. null for a lone end, a lock pin, or an
  // end that would come less than MIN_LEN after the start.
  function endShift(pins, lineId, start, oldT0, duration) {
    const sp = pins['line/' + lineId + ':start'], ep = pins['line/' + lineId + ':end'];
    if (!sp || !ep || sp.by === 'lock' || ep.by === 'lock' || typeof ep.v !== 'number' || !Number.isFinite(ep.v)) return null;
    const v = Math.round(Math.min(duration, ep.v + (start - oldT0)) * 100) / 100;
    return v >= start + TM.MIN_LEN - 1e-9 ? v : null;
  }

  const TS = Object.freeze({ loopAt, stopAt, userSeek, endShift, ONLY });

  function mount(app) {
    const t = app.t;
    const count = h('span', { class: 'tap-count' });
    const title = h('h2', { class: 'step-title', text: t('tap.title') });
    const nowLine = h('div', { class: 'tap-now' });
    const nextLine = h('div', { class: 'tap-next' });
    const last = h('div', { class: 'tap-last', role: 'status', 'aria-live': 'polite' });
    // For the mouse and touch: a press is a tap at the press's own time (pointerdown, not the later click). Keys never
    // reach it as a click: in tap mode Space and Enter are the tap.mark shortcut.
    const padHint = h('span', { class: 'btn-hint', text: t('tap.padHint') });
    const pad = h('button', { class: 'btn primary tap-pad', type: 'button',
      on: { pointerdown: (ev) => { if (ev.button === 0) mark({ timeStamp: ev.timeStamp }); } } },
    h('span', { class: 'btn-main', text: t('tap.pad') }), padHint);
    const keys = h('dl', { class: 'tap-keys' });
    // 前後の行を動かさない (the one-line mode; a device preference)
    const keepBox = h('input', { type: 'checkbox', id: 'tap-keep' });
    const keepRow = h('label', { class: 'check-row tap-keep', htmlFor: 'tap-keep', title: t('tap.keepTip'), hidden: true },
      keepBox, h('span', { text: t('tap.keep') }));
    keepBox.addEventListener('change', () => app.view.setPref('tapKeep', keepBox.checked));
    const backBtn = h('button', { class: 'btn', type: 'button', text: t('tap.backBtn'), on: { click: () => back() } });
    const root = h('div', { class: 'step step-tap' },
      h('div', { class: 'step-head' }, title, h('span', { class: 'grow' }), count),
      nowLine, nextLine, keepRow, pad, last, keys,
      h('div', { class: 'row-actions' }, backBtn,
        h('button', { class: 'btn primary', type: 'button', text: t('tap.finishBtn'), on: { click: () => finish() } })));

    let session = null;              // { state (core/tap TapState), byId: Map<lineId, line>, only: OnlyState | null }
    let keyMode = null;

    function fillKeys(only) {
      if (keyMode === only) return;
      keyMode = only;
      dom.replace(keys, (only ? ONLY_ROWS : KEY_ROWS).map(([cmd, label]) => [
        h('dt', {}, K.keysFor(cmd, 'tap').map((k) => h('kbd', { text: K.display(k, { space: t('key.space'), enter: 'Enter' }) }))),
        h('dd', { text: t(label) })]));
    }
    fillKeys(false);

    function eventTime(args) {
      const stamp = args && typeof args.timeStamp === 'number' ? args.timeStamp : null;
      const raw = stamp !== null && app.player.outputTimeOf ? app.player.outputTimeOf(stamp) : app.player.now();
      return Math.max(0, raw - (app.doc.timing.tapLatency || 0));
    }

    const lineAt = (i) => (session && i >= 0 && i < session.state.lineIds.length ? session.byId.get(session.state.lineIds[i]) : null);

    // start() starts at the selected line, else the line at the playhead, else line 1; start({ from: lineId }) at that
    // line (the timeline's この行からタップで合わせる); start({ only: lineId }) re-taps that one line (この行だけ打ち直す).
    function start(opts) {
      const ls = app.plan ? app.plan.lines : [];
      if (!ls.length) return false;
      if (opts && opts.only) return startOnly(opts.only);
      const selLine = opts && opts.from ? opts.from : S.lineOfSel(S.validate(app.view.state.sel, app.plan));
      const tNow = app.time();
      let at = selLine ? ls.findIndex((l) => l.id === selLine) : -1;
      if (at < 0) at = ls.findIndex((l) => l.t0 <= tNow && tNow < l.t1);
      if (at < 0) at = 0;
      session = { state: app.tapCore.tapStart(ls, ls[at].id), byId: new Map(ls.map((l) => [l.id, l])), only: null };
      app.pause();                   // stopped, the player takes the tap clock's length (open-ended without a song)
      if (app.goStep) app.goStep(app.view.state.step);   // the step column shows this panel: unfold it
      last.textContent = '';
      app.view.set({ mode: 'tap' });
      app.seek(Math.max(0, ls[at].t0 - PREROLL));
      app.play();
      update();
      return true;
    }

    function startOnly(lineId) {
      const ls = app.plan.lines;
      const at = ls.findIndex((l) => l.id === lineId);
      if (at < 0) return false;
      const line = ls[at], next = ls[at + 1] || null;
      app.pause();                   // before the session: stopping earlier playback is not the user pausing the loop
      if (app.goStep) app.goStep(app.view.state.step);
      session = {
        state: app.tapCore.tapStart(ls, line.id, { only: true }), byId: new Map(ls.map((l) => [l.id, l])),
        only: { lineId: line.id, n: line.index + 1, oldPlan: app.plan, old: { t0: line.t0, t1: line.t1 },
          nextOld: next ? next.t0 : null, loopAt: loopAt(line, next), looping: true, loops: 0, last: null, own: null,
          stopAt: Infinity, pausing: false, shown: null },
      };
      last.textContent = '';
      app.view.set({ mode: 'tap' });
      ownSeek(Math.max(0, line.t0 - PREROLL));
      app.play();
      update();
      return true;
    }

    // A seek the session makes itself (the loop, 打ち直す): not the user taking over.
    function ownSeek(x) {
      const O = session.only;
      O.own = x;
      app.seek(x);
    }

    function reduce(type, tt) {
      const before = session.state;
      session.state = app.tapCore.tapReduce(session.state, { type, t: tt });
      return session.state !== before;
    }

    // The session is paused exactly while playback is stopped, however it stopped or started again (P, ▶ in the play
    // bar, 1行戻る, the song's end): after P then ▶ the marks count again. In the one-line mode a pause the session did
    // not make itself ends the loop.
    app.view.on((changed, st) => {
      if (!session || !changed.includes('playing')) return;
      if (session.only && !st.playing) {
        if (session.only.pausing) session.only.pausing = false; else session.only.looping = false;
      }
      if (reduce(st.playing ? 'resume' : 'pause', app.player.now())) update();
    });

    // The one-line session follows the clock (bus 'time': every frame while playing, and every seek and pause).
    function tick(tt) {
      const O = session && session.only;
      if (!O) return;
      if (userSeek(O.last, tt, O.own)) O.looping = false;
      O.own = null;
      O.last = tt;
      if (!app.view.state.playing) return;
      if (!app.tapCore.done(session.state)) {
        if (!O.looping || tt <= O.loopAt) return;
        const from = Math.max(0, O.old.t0 - PREROLL);
        if (O.loops < ONLY.LOOP_MAX) { O.loops += 1; ownSeek(from); return; }
        // after LOOP_MAX rounds: back to the start and stopped; ▶ tries again
        O.loops = 0;
        O.pausing = true;
        app.pause();
        ownSeek(from);
        last.textContent = t('tap.looped');
        return;
      }
      if (tt >= O.stopAt) { finish(); return; }
      countdown(tt);
    }
    app.bus.on('time', tick);

    function countdown(tt) {
      const O = session.only;
      const s = Math.max(0, Math.ceil(O.stopAt - tt));
      if (O.shown === s) return;
      O.shown = s;
      nextLine.textContent = t('tap.autoEnd', { s });
    }

    // While playback is stopped (▶, P, a click elsewhere) the clock stands still: a mark would give every line the same
    // time, so none is taken and the panel says why.
    function stopped() {
      if (app.view.state.playing) return false;
      last.textContent = t('tap.stopped');
      return true;
    }

    function mark(args) {
      if (!session || stopped()) return;
      const s = session.state;
      const tt = eventTime(args);
      if (session.only && app.tapCore.done(s)) { last.textContent = t('tap.onlyDone'); return; }
      if (reduce('mark', tt)) {
        announce('tap.marked', lineAt(session.state.current), tt);
        if (session.only) session.only.stopAt = stopAt(tt, session.only.old, session.only.nextOld);
      } else if (!s.paused && s.cursor < s.stop) last.textContent = t('tap.tooSoon');
      update();
    }

    function end(args) {
      if (!session || stopped()) return;
      const tt = eventTime(args);
      if (reduce('end', tt)) {
        announce('tap.endMarked', lineAt(session.state.current), tt);
        if (session.only) session.only.stopAt = tt + ONLY.END_PAD;
      }
      update();
    }

    // Backspace: forget the last line's mark and step back; playback seeks 2 s before that line. In the one-line mode
    // (打ち直す) it forgets the mark and loops again from 2 s before the line.
    function back() {
      if (!session) return;
      if (session.only) {
        const O = session.only;
        reduce('back', app.player.now());
        Object.assign(O, { stopAt: Infinity, looping: true, loops: 0, shown: null });
        ownSeek(Math.max(0, O.old.t0 - PREROLL));
        if (!app.view.state.playing) app.play();
        update();
        return;
      }
      if (!reduce('back', app.player.now())) return;
      const line = lineAt(session.state.cursor);
      if (line) app.seek(Math.max(0, line.t0 - PREROLL));
      if (!app.view.state.playing) app.play();
      update();
    }

    function seekBy(args) {
      if (!session) return;
      app.seek(Math.max(0, app.time() + (args && args.seconds ? args.seconds : SEEK_STEP)));
    }

    function pause() {
      if (!session) return;
      if (app.view.state.playing) { reduce('pause', app.player.now()); app.pause(); } else { reduce('resume', app.player.now()); app.play(); }
      update();
    }

    // Esc / T / [終わる]: one time.tap (one undo entry); nothing is recorded without marks.
    function finish() {
      if (!session) return;
      if (session.only) { finishOnly(); return; }
      const cmd = app.tapCore.tapCommand(session.state);
      const n = cmd ? cmd.marks.length : 0;
      session = null;
      app.pause();
      app.view.set({ mode: 'normal' });
      if (cmd && n) {
        app.store.seal();
        app.dispatch(cmd, { label: ['undo.tap', { n }] });
        report(cmd);
      }
      if (app.shell) app.shell.playbar.updateStrip();
    }

    // The one-line result, one undo entry 「この行を打ち直す（n行目）」: a paired end pin moved with the start, the
    // time.tap, and (前後の行を動かさない) the start pins that keep the other automatic lines where they were.
    function finishOnly() {
      const O = session.only;
      const cmd = app.tapCore.tapCommand(session.state);
      session = null;
      app.pause();
      app.view.set({ mode: 'normal' });
      if (app.shell) app.shell.playbar.updateStrip();
      if (!cmd) return;
      const doc = app.doc, id = O.lineId, m = cmd.marks[0];
      const cmds = [];
      let shifted = false;
      if (m.start !== undefined && m.end === undefined) {
        const v = endShift(doc.pins, id, m.start, O.old.t0, O.oldPlan.duration);
        if (v !== null) { cmds.push({ t: 'pin.set', path: 'line/' + id + ':end', v, by: doc.pins['line/' + id + ':end'].by }); shifted = true; }
      }
      cmds.push(cmd);
      const helpers = [];
      if (app.view.state.prefs.tapKeep && m.start !== undefined) {
        try {
          for (let round = 0; round < ONLY.ROUNDS; round++) {
            const trial = app.reduce(doc, { t: 'batch', cmds });
            const after = PL.plan(trial, { registry: app.reg }).lines;
            const add = app.tapCore.stillPins(O.oldPlan.lines, after, id, m.start)
              .filter((x) => x.lineId !== id && !helpers.some((y) => y.lineId === x.lineId));
            if (!add.length) break;
            for (const x of add) {
              cmds.push({ t: 'pin.set', path: 'line/' + x.lineId + ':start', v: x.start, by: 'user' });
              helpers.push(x);
            }
          }
        } catch (e) { /* a trial that cannot be planned: no helper pins */ }
      }
      const endBefore = doc.pins['line/' + id + ':end'];
      app.store.seal();
      app.batch({ label: ['undo.tapLine', { n: O.n }] }, cmds);
      const cleared = !shifted && !!endBefore && !app.doc.pins['line/' + id + ':end'];
      reportOnly(O, helpers, shifted, cleared);
    }

    function reportOnly(O, helpers, shifted, cleared) {
      const p = app.plan;
      const now = new Map((p ? p.lines : []).map((l) => [l.id, l]));
      const kept = new Set(helpers.map((x) => x.lineId));
      const moved = O.oldPlan.lines.filter((l) => l.id !== O.lineId && !kept.has(l.id) && l.by && l.by.start === 'auto' &&
        now.has(l.id) && Math.abs(now.get(l.id).t0 - l.t0) >= ONLY.MOVED).length;
      const num = (lineId) => (now.has(lineId) ? now.get(lineId).index + 1 : null);
      const parts = [t('tap.lineDone', { n: O.n })];
      if (helpers.length) {
        const list = helpers.map((x) => num(x.lineId)).filter((n) => n !== null).join(t('list.sep'));
        parts.push(t('tap.lineKeptList', { list, n: helpers.length }));
      }
      if (moved) parts.push(t('tap.lineMoved', { m: moved }));
      if (shifted) parts.push(t('tap.endShifted'));
      if (cleared) parts.push(t('tap.endCleared'));
      const line = now.get(O.lineId);
      const from = line ? Math.max(0, line.t0 - PREROLL) : null;
      if (from !== null) app.seek(from);
      const action = from === null ? null : { label: t('tap.check'), run: () => { app.seek(from); app.play(); } };
      const actions = helpers.length ? [{ label: t('tap.unpinHelpers'), run: () => unpinHelpers(helpers) }] : [];
      app.toast(parts.join(app.lang === 'ja' ? '' : ' '), { kind: moved ? 'warn' : 'ok', action, actions });
    }

    // ほかの行の固定を外す: one undo entry removing the helper pins that are still as the re-tap left them.
    function unpinHelpers(helpers) {
      const pins = app.doc.pins;
      const cmds = helpers.filter((x) => {
        const pin = pins['line/' + x.lineId + ':start'];
        return pin && pin.by === 'user' && pin.v === x.start;
      }).map((x) => ({ t: 'pin.clear', path: 'line/' + x.lineId + ':start' }));
      if (cmds.length) app.batch({ label: ['undo.unpinHelpers', { n: cmds.length }] }, cmds);
    }

    // After the command, from the new plan: how many marked starts the timing really uses (a mark earlier than a pin or
    // an LRC time above the session is dropped with time-order), and a way to hear the result from the first marked line.
    function report(cmd) {
      const lines = new Map((app.plan ? app.plan.lines : []).map((l) => [l.id, l]));
      const starts = cmd.marks.filter((m) => m.start !== undefined);
      const unused = starts.filter((m) => { const l = lines.get(m.lineId); return !l || !l.by || l.by.start !== 'pin'; }).length;
      const first = starts.length ? lines.get(starts[0].lineId) : null;
      const from = first ? Math.max(0, first.t0 - PREROLL) : null;
      if (from !== null) app.seek(from);
      const action = from === null ? null : { label: t('tap.check'), run: () => { app.seek(from); app.play(); } };
      const n = cmd.marks.length;
      if (unused) app.toast(t('tap.doneSome', { n: n - unused, m: unused }), { kind: 'warn', action });
      else app.toast(t('tap.done', { n }), { kind: 'ok', action });
    }

    // Ends the session without recording anything (another project is opened, or the lines are replaced): its marks
    // belong to lines that are going away.
    function cancel() {
      if (!session) return;
      session = null;
      app.pause();
      app.view.set({ mode: 'normal' });
      if (app.shell) app.shell.playbar.updateStrip();
    }

    // Shows the time that was recorded (the clock at the key or press, minus the latency setting).
    function announce(key, line, time) {
      if (line) last.textContent = t(key, { n: line.index + 1, time: T.fmtTime(time) });
    }

    function position() {
      const s = session.state;
      return { i: Math.min(s.cursor + 1, s.lineIds.length), n: s.lineIds.length };
    }

    function update() {
      if (!session) return;
      const O = session.only;
      fillKeys(!!O);
      title.textContent = t(O ? 'tap.onlyTitle' : 'tap.title');
      count.hidden = !!O;
      keepRow.hidden = !O;
      padHint.hidden = !!O;
      backBtn.textContent = t(O ? 'tap.keyRetry' : 'tap.backBtn');
      if (O) {
        keepBox.checked = !!app.view.state.prefs.tapKeep;
        const line = session.byId.get(O.lineId);
        const marked = app.tapCore.done(session.state);
        nowLine.textContent = line ? line.text : '';
        O.shown = null;
        if (marked) countdown(app.time()); else nextLine.textContent = t('tap.onlyHint');
        pad.disabled = marked;
      } else {
        count.textContent = t('tap.progress', position());
        const cur = lineAt(session.state.current);
        const nxt = lineAt(session.state.cursor);
        nowLine.textContent = cur ? cur.text : t('tap.ready');
        nextLine.textContent = nxt ? t('tap.nextLine', { text: nxt.text }) : t('tap.allMarked');
        pad.disabled = !nxt;
      }
      root.classList.toggle('is-paused', !!session.state.paused);
      root.classList.toggle('is-only', !!O);
      if (app.shell) app.shell.playbar.updateStrip();
    }

    // The play-bar mode strip while tapping: 「タップ中 12/40 [1行戻る] [終わる]」; one line: 「この行だけ打ち直す
    // [打ち直す] [終わる]」.
    function strip() {
      if (!session) return null;
      const O = session.only;
      return { kind: 'tap', text: O ? t('tap.onlyTitle') : t('tap.strip', position()),
        actions: [{ label: t(O ? 'tap.keyRetry' : 'tap.backBtn'), run: () => back() }, { label: t('tap.finishBtn'), run: () => finish() }] };
    }

    return { root, start, mark, end, back, seekBy, pause, finish, cancel, strip, active: () => !!session,
      only: () => (session && session.only ? session.only.lineId : null), update };
  }

  return { mount, PREROLL, TS };
});
