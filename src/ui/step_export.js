/* 文字PVメーカー v2 — original work. Step ④ 書き出し: settings, the Filmora set's contents, preflight with jump links, progress, cancel, done (DESIGN §6.4.3, §4.21; DESIGN_2_1 §13.10). */
MV.def('ui/step_export', ['ui/dom', 'ui/icons', 'ui/output', 'ui/filmora_help', 'export/schedule', 'i18n/t'], (dom, I, OUT, HELP, SCH, T) => {
  'use strict';

  const { h } = dom;
  const SHORTS = [720, 1080, 1440, 2160];
  const FPS = [24, 30, 60];
  // The button of a pre-flight item that jumps (default 見る): a missing photo or video says つなぎ直す and opens the
  // library, where its row has [つなぎ直す] (DESIGN_2_1 §11.7.8).
  const JUMP_LABEL = { 'media-missing': 'media.relink' };
  const QUALITIES = ['standard', 'high', 'max'];
  const PROGRESS_ANNOUNCE_MS = 5000;
  const RUN_UPDATE_MS = 100;            // the running view is redrawn at most this often (a new phase at once)
  const RADIO_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

  // radioKeys(group): a segmented radio group of step ④ (§6.12): the arrows move to the next option and choose it (Home
  // and End: the first and the last); the app keymap (← → frames) never sees them. One tab stop per group (fillSeg).
  function radioKeys(group) {
    group.addEventListener('keydown', (ev) => {
      if (!RADIO_KEYS.has(ev.key) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      const radios = [...group.querySelectorAll('[role="radio"]')].filter((b) => !b.disabled);
      if (!radios.length) return;
      ev.preventDefault();
      ev.stopPropagation();
      const at = radios.indexOf(document.activeElement);
      const n = radios.length;
      const to = ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1
        : (Math.max(0, at) + (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : n - 1)) % n;
      if (to === at) return;
      dom.focus(radios[to]);
      radios[to].click();
    });
  }

  function mount(app) {
    const t = app.t;
    const seg = (name, label) => {
      const el = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label, 'data-seg': name });
      radioKeys(el);
      return el;
    };
    // 形式 (DESIGN_2_1 §13.10): [MP4] [Filmora用] as a radio pair, plus [その他 ▾] (透過動画（WebM）/ PNG連番 / 透過PNG) — one
    // control, the pattern of step ③'s 画面の形.
    const formatPair = h('div', { class: 'fmt-radios', role: 'radiogroup', 'aria-label': t('exp.format') });
    radioKeys(formatPair);
    const otherFormat = h('select', { class: 'seg-select', 'aria-label': t('exp.fmt.otherLabel'), 'data-other': 'format' },
      h('option', { value: '', hidden: true, text: t('exp.fmt.other') }),
      OUT.OTHER_FORMATS.map((v) => h('option', { value: v, text: t('exp.fmt.' + v) })));
    const format = h('div', { class: 'segmented fmt-seg', 'data-seg': 'format' }, formatPair, otherFormat);
    const size = h('select', { class: 'select', 'aria-label': t('exp.size') });
    const fps = seg('fps', t('exp.fps'));
    const backdrop = h('select', { class: 'select', 'aria-label': t('exp.backdrop') });
    const range = seg('range', t('exp.range'));
    const quality = seg('quality', t('exp.quality'));
    const audio = h('input', { type: 'checkbox', id: 'exp-audio' });
    const name = h('input', { class: 'text-input', type: 'text', 'aria-label': t('exp.name'), spellcheck: false });
    // 詳しく for Filmora用: the set's contents, then the guide (§13.10). The main MP4 is always in the set.
    const kitBoxes = {};
    const kitRow = (key) => {
      kitBoxes[key] = h('input', { type: 'checkbox', id: 'exp-kit-' + key, 'data-kit': key });
      return h('label', { class: 'check-row', htmlFor: 'exp-kit-' + key }, kitBoxes[key], h('span', { text: t('exp.kit.' + key) }));
    };
    // A file the set always holds (完成動画, the README) or adds by itself (the song's WAV where the browser cannot put
    // it into the MP4): checked and disabled, with why — so the rows add up to the summary line's count.
    const fixedRow = (kind, why) => h('label', { class: 'check-row is-fixed', htmlFor: 'exp-kit-' + kind, 'data-always': kind },
      h('input', { type: 'checkbox', id: 'exp-kit-' + kind, checked: true, disabled: true }),
      h('span', { text: t(OUT.kitLabel(kind)) }), h('span', { class: 'muted kit-always', text: why }));
    const wavRow = fixedRow('wav', t('exp.kit.wavWhy'));
    // the green screen's how-to line (DESIGN_2_1 §13.6), under its checkbox while it is ticked
    const greenNote = h('p', { class: 'note subtle kit-note', 'data-note': 'kit-chroma', hidden: true, text: t('exp.chromaNote') });
    const kitSet = h('fieldset', { class: 'kit-set' }, h('legend', { class: 'field-label', text: t('exp.kit.title') }),
      fixedRow('main', t('exp.kit.always')), kitRow('overlay'), kitRow('bg'), kitRow('green'), greenNote,
      h('div', { class: 'kit-pair' }, kitRow('srt'), kitRow('lrc')), wavRow, fixedRow('readme', t('exp.kit.always')));
    const howTo = h('button', { class: 'link kit-howto', type: 'button', 'data-kit-help': 'planned' }, t('exp.kit.howTo') + ' ›');
    const kitBox = h('div', { class: 'kit-box', hidden: true }, kitSet, howTo);
    const moreLabel = h('summary', { text: t('exp.more') });
    const more = h('details', { class: 'more', 'data-ctl': 'more' }, moreLabel,
      row(t('exp.range'), range), row(t('exp.quality'), quality),
      h('label', { class: 'check-row', htmlFor: 'exp-audio' }, audio, h('span', { text: t('exp.audio') })),
      row(t('exp.name'), name), kitBox);
    const summary = h('div', { class: 'exp-summary' });
    // Where the set goes (with a folder picker): a new folder inside the folder the user picks.
    const folderHint = h('p', { class: 'note subtle exp-note', 'data-note': 'kit-folder', hidden: true });
    // The pre-flight list; it takes the focus when a fix button re-renders it away (tabindex -1: not a Tab stop).
    const checks = h('ul', { class: 'checks', tabindex: '-1', 'aria-label': t('exp.checks') });
    // Under 背景 (ui/output.backdropNote): transparency (§13.10, exp.alphaNote2) — the transparent WebM is the one to use
    // in editors, PNG sequences suit compositing apps; not for Filmora用, whose set has its own transparent video — or,
    // when the file is green, the green screen's how-to line (DESIGN_2_1 §13.6).
    const alphaNote = h('p', { class: 'note subtle exp-note', 'data-note': 'alpha', text: t('exp.alphaNote2') });
    const chromaNote = h('p', { class: 'note subtle exp-note', 'data-note': 'chroma', hidden: true, text: t('exp.chromaNote') });
    const settings = h('div', { class: 'exp-settings' },
      field(t('exp.format'), format, 'format'), field(t('exp.size'), size, 'size'), field(t('exp.fps'), fps, 'fps'),
      field(t('exp.backdrop'), [backdrop, alphaNote, chromaNote], 'backdrop'), more, summary, folderHint, checks);
    const running = h('div', { class: 'exp-running', hidden: true });
    // Said to screen readers: the Filmora set's phase and the end of an export (the progress bar says the numbers).
    const said = h('div', { class: 'sr-only exp-said', role: 'status', 'aria-live': 'polite' });
    const root = h('div', { class: 'step step-export' },
      h('div', { class: 'step-head' }, h('h2', { class: 'step-title', text: t('step.short.export') })), settings, running, said);
    const go = h('button', { class: 'btn primary wide', type: 'button', 'data-act': 'export.start' }, I.icon('export'), t('exp.go'));
    const footer = h('div', { class: 'footer-export' }, go);
    let lastAnnounce = 0;
    let blocked = false;
    let runView = null;                 // the running view's elements (runningView), made once per export; null otherwise
    let lastRun = 0;

    function row(label, control) { return h('div', { class: 'field-row labeled' }, h('span', { class: 'field-label inline', text: label }), control); }
    function field(label, control, id) {
      return h('div', { class: 'field', 'data-ctl': id }, h('div', { class: 'field-label', text: label }), control);
    }

    function setOut(key, v) { app.dispatch({ t: 'output.set', key, v }, { label: ['undo.output', {}] }); }
    // A format choice keeps its backdrop in step (透過動画 / 透過PNG ⇔ 透明, ui/output): one choice, one undo entry.
    function setFormat(v) { app.batch({ label: ['undo.output', {}] }, OUT.formatCmds(app.doc, v)); }

    dom.on(root, 'click', '[data-seg] [data-v]', (ev, b) => {
      const which = b.closest('[data-seg]').dataset.seg;
      const v = b.dataset.v;
      if (which === 'format') setFormat(v);
      else if (which === 'fps') setOut('fps', Number(v));
      else if (which === 'quality') setOut('quality', v);
      else if (which === 'range') chooseRange(v);
    });
    otherFormat.addEventListener('change', () => { if (otherFormat.value) setFormat(otherFormat.value); });
    size.addEventListener('change', () => setOut('short', Number(size.value)));
    backdrop.addEventListener('change', () => app.batch({ label: ['undo.backdrop', {}] }, OUT.backdropCmds(app.doc, backdrop.value)));
    audio.addEventListener('change', () => setOut('audio', audio.checked));
    name.addEventListener('change', () => setOut('name', name.value.trim() || null));
    dom.on(kitSet, 'change', '[data-kit]', (ev, box) => app.dispatch(OUT.kitCmd(app.doc, box.dataset.kit, box.checked), { label: ['undo.output', {}] }));
    howTo.addEventListener('click', () => HELP.open(app, HELP.planned(app.doc, planOf(), kitEnv())));
    // The export action asks about a large in-memory export itself (app.exportStart), from here and from Ctrl+K alike.
    go.addEventListener('click', () => app.actions.run('export.start'));

    function chooseRange(v) {
      if (v === 'all') { setOut('range', null); return; }
      if (v === 'sel') {
        const r = app.selectionRange();
        if (r) setOut('range', r); else app.toast(t('exp.rangeNeedsSel'));
        return;
      }
      if (!app.doc.output.range) app.toast(t('exp.rangeHowTo'));
    }

    // fillSeg(el, values, cur, label, disabled?) → the radios of a segmented group: made once and updated in place, so
    // the focus stays on the option an arrow key chose. The checked one is the group's tab stop (else the first enabled).
    function fillSeg(el, values, cur, label, disabled) {
      let buttons = [...el.querySelectorAll('[role="radio"]')];
      if (buttons.length !== values.length || buttons.some((b, i) => b.dataset.v !== String(values[i]))) {
        buttons = values.map((v) => h('button', { class: 'seg', type: 'button', role: 'radio', 'data-v': String(v) }));
        dom.replace(el, buttons);
      }
      let stop = -1;
      values.forEach((v, i) => {
        const b = buttons[i];
        const why = disabled ? disabled(v) : '';
        const on = String(v) === String(cur);
        b.setAttribute('aria-checked', String(on));
        b.disabled = !!why;
        if (why) b.title = why; else b.removeAttribute('title');
        const text = label(v);
        if (b.textContent !== text) b.textContent = text;
        if (on) stop = i;
      });
      const first = stop >= 0 ? stop : buttons.findIndex((b) => !b.disabled);
      buttons.forEach((b, i) => { b.tabIndex = i === first ? 0 : -1; });
    }

    // その他 ▾ shows the other format when one is chosen (and is marked like a chosen segment), else 「その他」.
    function fillOther(cur, disabled) {
      const chosen = OUT.OTHER_FORMATS.includes(cur);
      for (const opt of otherFormat.options) if (opt.value) opt.disabled = !!disabled(opt.value);
      const want = chosen ? cur : '';
      if (otherFormat.value !== want) otherFormat.value = want;
      otherFormat.classList.toggle('is-on', chosen);
    }

    function canStream() { return app.svc.exporter.sink.canStream(); }
    function canDirectory() { return app.svc.exporter.sink.canDirectory(); }
    // The plan the numbers come from; before there is one (no lyrics yet), an empty video of the work's shape.
    function planOf() { return app.plan || { duration: 0, design: { aspect: app.doc.look.aspect }, lines: [], cuts: [] }; }
    // What the Filmora set holds depends on the audio codec the browser has (AAC, else a WAV file) and the song.
    function kitEnv() {
      const probe = app.exportProbe ? app.exportProbe() || {} : {};
      return { audioCodec: probe.audioCodec, songReady: !!app.doc.song && app.songReady() };
    }

    // The range the export renders: output.range clamped to the video (export/schedule.exportRange), or null.
    function rangeOf() { return app.plan ? SCH.exportRange(app.doc, app.plan) : null; }
    const clock = (sec) => T.fmtTime(sec).replace(/\.\d+$/, '');

    function summaryText() {
      const env = Object.assign({ fsAccess: canStream(), dirAccess: canDirectory() }, kitEnv());
      const s = OUT.summary(app.doc, planOf(), env);
      const p = s.params;
      if (s.key === 'exp.kit.summary') {
        return t(s.key, { n: p.n, size: T.fmtBytes(p.bytes), where: t(p.where === 'folder' ? 'exp.kit.toFolder' : 'exp.kit.toZip') });
      }
      return t(s.key, { w: p.w, h: p.h, fps: p.fps, dur: clock(p.seconds), size: T.fmtBytes(p.bytes),
        where: t(p.where === 'disk' ? 'exp.toDisk' : 'exp.toMemory') });
    }

    // Pre-flight items (export/schedule.preflight + ui/output.checks) as text: 'exp.pre.<code>' with display params.
    function checkText(c) {
      const p = c.params || {};
      if (c.code === 'no-lines') return t('exp.noLines');
      const params = Object.assign({}, p);
      if (p.bytes !== undefined) params.size = T.fmtBytes(p.bytes);
      if (p.at !== undefined) params.time = T.fmtTime(p.at);
      if (p.bg !== undefined) params.bg = t('exp.bg.' + p.bg);
      if (Array.isArray(p.keys)) params.list = p.keys.map((k) => app.label('filter', k)).join(t('list.sep'));
      if (Array.isArray(p.families)) { params.family = p.families.join(t('list.sep')); params.n = p.families.length; }
      if (c.code === 'overfull') params.n = p.line;
      // the chosen format by name: as the subject (alpha-backdrop) or inside a sentence (no-webcodecs, no-audio-codec, …)
      if (c.code === 'alpha-backdrop') params.format = t('exp.fmt.' + p.format);
      else if (p.format) params.format = t('exp.fmtIn.' + p.format);
      if (c.code === 'layers-approx') params.what = OUT.layersWhat(p, t);
      return t(OUT.checkKey(c), params);
    }

    // A fix re-renders the pre-flight list, which takes its button away: the focus goes to the control the fix changed
    // (the chosen 形式, 背景, or the set's checkbox, when on screen), else to the list, never to the page (where Space
    // would start playback).
    function fixButton(c) {
      if (!c.fix || !c.fix.length) return null;
      const undo = c.code === 'flash-rate' ? 'undo.flashFix' : 'undo.output';
      return h('button', { class: 'link', type: 'button', text: t(OUT.fixLabel(c)), on: { click: () => {
        const target = fixTarget(c.fix);
        app.batch({ label: [undo, {}] }, c.fix);
        const shown = target && root.contains(target) && !target.disabled && target.getClientRects().length > 0;
        dom.focus(shown ? target : checks);
      } } });
    }

    // fixTarget(cmds) → the control of step ④ that shows what the fix changes (asked before it is applied).
    function fixTarget(cmds) {
      const cmd = (kind, key) => cmds.find((x) => x.t === kind && x.key === key);
      const f = cmd('output.set', 'format');
      if (f) return OUT.MAIN_FORMATS.includes(f.v) ? formatPair.querySelector('[data-v="' + f.v + '"]') : otherFormat;
      const kit = cmd('output.set', 'kit');
      if (kit) {
        const before = SCH.kitOptions(app.doc.output);
        const key = OUT.KIT_KEYS.find((x) => !!before[x] !== !!kit.v[x]);
        return key ? kitBoxes[key] : null;
      }
      return cmd('look.set', 'backdrop') ? backdrop : null;
    }

    function jumpTo(c) {
      if (c.jump && c.jump.cut) app.select({ level: 'cut', key: c.jump.cut }, { from: 'header', open: true, seek: true });
      else if (c.jump && typeof c.jump.t === 'number') app.seek(c.jump.t);
      else if (c.jump && c.jump.action) app.actions.run(c.jump.action);           // media-missing: the library
      else if (c.code === 'no-lines') app.goStep('lyrics');
    }

    function renderSettings() {
      const o = app.doc.output;
      const env = app.env();
      const aspect = app.doc.look.aspect;
      // the formats that encode video need WebCodecs (MP4, the set, 透過動画); the reason names the format
      const noVideo = (v) => (SCH.FORMATS[v].video && !env.webcodecs ? t('exp.pre.no-webcodecs', { format: t('exp.fmtIn.' + v) }) : '');
      fillSeg(formatPair, OUT.MAIN_FORMATS, o.format, (v) => t('exp.fmt.' + v), noVideo);
      fillOther(o.format, noVideo);
      dom.replace(size, SHORTS.map((s) => {
        const sz = SCH.outputSize(aspect, s);
        return h('option', { value: String(s), selected: s === o.short, text: t('exp.sizeOpt', { p: s, w: sz.w, h: sz.h }) });
      }));
      fillSeg(fps, FPS, o.fps, (v) => String(v));
      // 透明 makes the output transparent (透過動画, or 透過PNG from a PNG sequence); Filmora用 does not offer it
      // (ui/output.backdropChoices: the set would be lost on the way back).
      dom.replace(backdrop, OUT.backdropChoices(o.format, app.doc.look.backdrop).map((b) => h('option', {
        value: b, selected: b === app.doc.look.backdrop, text: t(b === 'clear' ? OUT.clearLabel(o.format) : 'exp.bg.' + b),
      })));
      const note = OUT.backdropNote(app.doc);
      alphaNote.hidden = note !== 'exp.alphaNote2';
      chromaNote.hidden = note !== 'exp.chromaNote';
      const r = o.range ? rangeOf() || o.range : null;
      fillSeg(range, ['all', 'sel', 'io'], r ? 'io' : 'all', (v) => (v === 'io' && r ? clock(r.t0) + '–' + clock(r.t1) : t('exp.range.' + v)));
      fillSeg(quality, QUALITIES, o.quality, (v) => t('exp.q.' + v));
      audio.checked = !!o.audio;
      audio.disabled = !OUT.hasSound(o.format) || !app.doc.song;
      if (document.activeElement !== name) name.value = o.name || '';
      name.placeholder = o.format === 'kit' ? SCH.kitBase(app.doc) : app.defaultFileName();
      const kit = o.format === 'kit';
      kitBox.hidden = !kit;
      moreLabel.textContent = t(kit ? 'exp.moreKit' : 'exp.more');
      const chosen = SCH.kitOptions(o);
      for (const key of OUT.KIT_KEYS) kitBoxes[key].checked = !!chosen[key];
      greenNote.hidden = !chosen.green;
      wavRow.hidden = !(kit && OUT.kitAlways(app.doc, planOf(), kitEnv()).includes('wav'));
      summary.textContent = summaryText();
      folderHint.hidden = !(kit && canDirectory());
      if (!folderHint.hidden) folderHint.textContent = t('exp.kit.folderHint', { folder: SCH.kitFolder(app.doc) });
      const list = app.exportChecks();
      dom.replace(checks, OUT.shownChecks(list).map((c) => {
        const actions = [fixButton(c),
          c.jump || c.code === 'no-lines' ? h('button', { class: 'link', type: 'button', text: t(JUMP_LABEL[c.code] || 'exp.jump'),
            on: { click: () => jumpTo(c) } }) : null]
          .filter(Boolean);
        return h('li', { class: 'check check-' + c.level, 'data-code': c.code },
          I.icon(c.level === 'block' ? 'warn' : c.level === 'info' ? 'info' : 'warn', { size: 15 }),
          h('div', { class: 'check-body' }, h('span', { text: checkText(c) }), actions.length ? h('div', { class: 'check-actions' }, actions) : null));
      }));
      blocked = list.some((c) => c.level === 'block');
      go.disabled = blocked || !!app.exporting;
    }

    // The done state of a Filmora set (§13.9): how many files and where (the folder, or the ZIP that was downloaded), each
    // file with its name, what it is and its size, and 「Filmoraで使うには」.
    function kitDone(st) {
      const r = st.result;
      const help = h('button', { class: 'link kit-howto', type: 'button', 'data-kit-help': 'written' }, t('exp.kit.howTo') + ' ›');
      help.addEventListener('click', () => HELP.open(app, HELP.written(r, { w: st.w, h: st.h, fps: st.fps })));
      return h('div', { class: 'exp-done' }, I.icon('check', { size: 28 }),
        h('div', { class: 'exp-title', text: t('exp.done') }),
        h('div', { class: 'muted', text: kitDoneText(r) }),
        h('ul', { class: 'kit-done-files', 'aria-label': t('exp.kit.files') }, r.files.map((f) => h('li', { 'data-kind': f.kind },
          h('span', { class: 'kit-file-name', text: f.name }),
          h('span', { class: 'kit-file-meta', text: [OUT.kitLabel(f.kind) ? t(OUT.kitLabel(f.kind)) : '', T.fmtBytes(f.bytes)].filter(Boolean)
            .join(t('exp.kit.metaSep')) })))),
        help);
    }

    // 「{n}ファイルを書き出しました」 and where: the folder inside the folder the user picked (result.parent, when the browser
    // names it), or the ZIP that was downloaded.
    function kitDoneText(r) {
      if (!r.name && r.parent) return t('exp.kit.doneIn', { n: r.files.length, folder: r.folder, parent: r.parent });
      return t('exp.kit.done', { n: r.files.length, folder: r.name || r.folder });
    }

    // The running view: made once per export, then updated in place — at most every RUN_UPDATE_MS, at once for a new
    // phase and for the last frame. Rebuilding it for every frame (tens a second) churned the page while the export
    // renders and reads back canvases on the same thread; with the Filmora set that stalled headless Chromium's export.
    function runningView() {
      const v = {
        title: h('div', { class: 'exp-title' }),
        phase: h('div', { class: 'exp-phase', hidden: true }),         // the Filmora set: 動画 → 曲・字幕・説明 → ZIP (also said)
        fill: h('div', { class: 'progress-bar' }),
        frames: h('span'), percent: h('span'), left: h('div', { class: 'muted' }), part: undefined,
      };
      v.bar = h('div', { class: 'progress big', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100',
        'aria-label': t('exp.progressLabel') }, v.fill);
      dom.replace(running, v.title, v.phase, v.bar, h('div', { class: 'exp-nums' }, v.frames, v.percent), v.left,
        h('p', { class: 'note', text: t('exp.snapshot') }));
      dom.replace(footer, h('button', { class: 'btn wide', type: 'button', text: t('exp.cancel'), on: { click: () => app.actions.run('export.cancel') } }));
      return v;
    }

    function showRunning(st) {
      const now = performance.now();
      const fresh = !runView || !running.contains(runView.title);
      if (fresh) runView = runningView();
      else if (st.part === runView.part && st.i < st.N && now - lastRun < RUN_UPDATE_MS) return;
      lastRun = now;
      const v = runView;
      const pct = st.N ? Math.floor(st.i / st.N * 100) : 0;
      const sz = SCH.outputSize(app.doc.look.aspect, st.short || app.doc.output.short);
      v.title.textContent = t('exp.running', { h: Math.min(sz.w, sz.h), fps: st.fps || app.doc.output.fps });
      const phase = st.part ? t('exp.kit.phase', { what: t('exp.kit.what.' + st.part) }) : '';
      if (st.part !== v.part) {
        v.part = st.part;
        v.phase.hidden = !st.part;
        if (st.part) { v.phase.dataset.part = st.part; v.phase.textContent = phase; said.textContent = phase; }
      }
      const progress = t('exp.progress', { i: st.i, n: st.N, eta: clock(st.eta || 0) });
      v.bar.setAttribute('aria-valuenow', String(pct));
      v.bar.setAttribute('aria-valuetext', phase ? t('exp.kit.running', { phase, progress }) : progress);
      // the value is announced at most every PROGRESS_ANNOUNCE_MS
      if (now - lastAnnounce < PROGRESS_ANNOUNCE_MS) v.bar.setAttribute('aria-live', 'off');
      else { lastAnnounce = now; v.bar.removeAttribute('aria-live'); }
      dom.setStyle(v.fill, { width: pct + '%' });
      v.frames.textContent = t('exp.frames', { i: st.i, n: st.N });
      v.percent.textContent = pct + '%';
      v.left.textContent = st.eta !== null && st.eta !== undefined ? t('exp.left', { time: clock(st.eta) }) : t('exp.preparing');
    }

    function renderRunning(st) {
      if (st.phase === 'running') { showRunning(st); return; }
      runView = null;
      if (st.phase === 'done') {
        const info = st.result.files ? kitDoneText(st.result)
          : t('exp.doneInfo', { name: st.result.name, size: T.fmtBytes(st.result.bytes), frames: st.result.frames });
        dom.replace(running, st.result.files ? kitDone(st) : h('div', { class: 'exp-done' }, I.icon('check', { size: 28 }),
          h('div', { class: 'exp-title', text: t('exp.done') }), h('div', { class: 'muted', text: info })));
        said.textContent = t('exp.done') + ' ' + info;
        dom.replace(footer, h('button', { class: 'btn wide', type: 'button', text: t('exp.again'), on: { click: () => app.exportReset() } }));
      } else if (st.phase === 'error') {
        dom.replace(running, h('div', { class: 'inline-error', role: 'alert' }, I.icon('warn'), h('span', { text: st.message })));
        dom.replace(footer, h('button', { class: 'btn wide', type: 'button', text: t('exp.back'), on: { click: () => app.exportReset() } }));
      }
    }

    function update() {
      const st = app.exportState();
      const busy = st.phase !== 'idle';
      settings.hidden = busy;
      running.hidden = !busy;
      if (busy) renderRunning(st);
      else {
        // idle (after 中止 too): the next export makes its running view, and 中止 in the footer, afresh (and says its
        // phases and its end again, even when they read as the last one's did)
        runView = null;
        said.textContent = '';
        dom.replace(footer, go);
        renderSettings();
      }
    }

    // Showing the step asks for the faces the export will draw, so 書体を読み込み中 clears before [書き出す] (§4.14).
    function onShow() {
      if (app.exportFonts) app.exportFonts();
      update();
    }

    app.bus.on('export', update);
    app.bus.on('song', update);
    app.bus.on('fonts', () => { if (root.isConnected) update(); });
    app.bus.on('media', () => { if (root.isConnected) update(); });   // an asset found or lost on this device
    return { root, footer, update: () => update(), onShow };
  }

  return { mount, radioKeys };
});
