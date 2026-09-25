/* 文字PVメーカー v2 — original work. Step ④ 書き出し: settings, preflight with jump links, progress, cancel, done (DESIGN §6.4.3, §4.21). */
MV.def('ui/step_export', ['ui/dom', 'ui/icons', 'ui/output', 'export/schedule', 'i18n/t'], (dom, I, OUT, SCH, T) => {
  'use strict';

  const { h } = dom;
  const SHORTS = [720, 1080, 1440, 2160];
  const FPS = [24, 30, 60];
  const FORMATS = OUT.FORMATS;
  const BACKDROPS = OUT.BACKDROPS;
  // The button of a pre-flight item that has a fix, and the undo label of that fix.
  const FIX_LABEL = { 'flash-rate': 'exp.pre.flash-fix', 'clear-mp4': 'exp.pre.makeAlpha', 'clear-png': 'exp.pre.makeAlpha',
    'alpha-backdrop': 'exp.pre.makeClear', 'no-webcodecs': 'exp.pre.makePng', 'no-h264': 'exp.pre.makePng' };
  const QUALITIES = ['standard', 'high', 'max'];
  const PROGRESS_ANNOUNCE_MS = 5000;

  function mount(app) {
    const t = app.t;
    const seg = (name, label) => h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label, 'data-seg': name });
    const format = seg('format', t('exp.format'));
    const size = h('select', { class: 'select', 'aria-label': t('exp.size') });
    const fps = seg('fps', t('exp.fps'));
    const backdrop = h('select', { class: 'select', 'aria-label': t('exp.backdrop') });
    const range = seg('range', t('exp.range'));
    const quality = seg('quality', t('exp.quality'));
    const audio = h('input', { type: 'checkbox', id: 'exp-audio' });
    const name = h('input', { class: 'text-input', type: 'text', 'aria-label': t('exp.name'), spellcheck: false });
    const more = h('details', { class: 'more', 'data-ctl': 'more' }, h('summary', { text: t('exp.more') }),
      row(t('exp.range'), range), row(t('exp.quality'), quality),
      h('label', { class: 'check-row', htmlFor: 'exp-audio' }, audio, h('span', { text: t('exp.audio') })),
      row(t('exp.name'), name));
    const summary = h('div', { class: 'exp-summary' });
    const checks = h('ul', { class: 'checks' });
    // Transparency is a PNG sequence only: browsers cannot encode a video with alpha today (SPEC §6, §7).
    const alphaNote = h('p', { class: 'note subtle exp-note', 'data-note': 'alpha', text: t('exp.alphaNote') });
    const settings = h('div', { class: 'exp-settings' },
      field(t('exp.format'), format, 'format'), field(t('exp.size'), size, 'size'), field(t('exp.fps'), fps, 'fps'),
      field(t('exp.backdrop'), [backdrop, alphaNote], 'backdrop'), more, summary, checks);
    const running = h('div', { class: 'exp-running', hidden: true });
    const root = h('div', { class: 'step step-export' },
      h('div', { class: 'step-head' }, h('h2', { class: 'step-title', text: t('step.short.export') })), settings, running);
    const go = h('button', { class: 'btn primary wide', type: 'button', 'data-act': 'export.start' }, I.icon('export'), t('exp.go'));
    const footer = h('div', { class: 'footer-export' }, go);
    let lastAnnounce = 0;
    let blocked = false;

    function row(label, control) { return h('div', { class: 'field-row labeled' }, h('span', { class: 'field-label inline', text: label }), control); }
    function field(label, control, id) {
      return h('div', { class: 'field', 'data-ctl': id }, h('div', { class: 'field-label', text: label }), control);
    }

    function setOut(key, v) { app.dispatch({ t: 'output.set', key, v }, { label: ['undo.output', {}] }); }

    dom.on(root, 'click', '[data-seg] [data-v]', (ev, b) => {
      const which = b.parentNode.dataset.seg;
      const v = b.dataset.v;
      // 透過PNG ⇔ 透明 (ui/output): one choice, one undo entry.
      if (which === 'format') app.batch({ label: ['undo.output', {}] }, OUT.formatCmds(app.doc, v));
      else if (which === 'fps') setOut('fps', Number(v));
      else if (which === 'quality') setOut('quality', v);
      else if (which === 'range') chooseRange(v);
    });
    size.addEventListener('change', () => setOut('short', Number(size.value)));
    backdrop.addEventListener('change', () => app.batch({ label: ['undo.backdrop', {}] }, OUT.backdropCmds(app.doc, backdrop.value)));
    audio.addEventListener('change', () => setOut('audio', audio.checked));
    name.addEventListener('change', () => setOut('name', name.value.trim() || null));
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

    function fillSeg(el, values, cur, label, disabled) {
      dom.replace(el, values.map((v) => h('button', {
        class: 'seg', type: 'button', role: 'radio', 'data-v': String(v), 'aria-checked': String(String(v) === String(cur)),
        disabled: !!(disabled && disabled(v)), title: disabled && disabled(v) ? disabled(v) : null,
      }, label(v))));
    }

    // Sizes and estimates: export/schedule owns the frozen math (§4.21).
    function sizeOf(aspect, short) { return SCH.outputSize(aspect, short); }
    function bytesOf(o, sz, seconds) {
      if (o.format === 'mp4') return SCH.estimateBytes(seconds, SCH.bitrate(sz.w, sz.h, o.fps, o.quality), o.audio && !!app.doc.song);
      return SCH.estimatePngBytes(SCH.frameCount(seconds, o.fps), sz.w, sz.h, o.format === 'pngAlpha');
    }

    function canStream() { return app.svc.exporter.sink.canStream(); }

    // The range the export renders: output.range clamped to the video (export/schedule.exportRange), or null.
    function rangeOf() { return app.plan ? SCH.exportRange(app.doc, app.plan) : null; }
    function durationOf() {
      const r = rangeOf();
      return r ? Math.max(0, r.t1 - r.t0) : 0;
    }
    const clock = (sec) => T.fmtTime(sec).replace(/\.\d+$/, '');

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
      return t('exp.pre.' + c.code, params);
    }

    function fixButton(c) {
      if (!c.fix || !c.fix.length) return null;
      const undo = c.code === 'flash-rate' ? 'undo.flashFix' : 'undo.output';
      return h('button', { class: 'link', type: 'button', text: t(FIX_LABEL[c.code] || 'exp.pre.fix'),
        on: { click: () => app.batch({ label: [undo, {}] }, c.fix) } });
    }

    function jumpTo(c) {
      if (c.jump && c.jump.cut) app.select({ level: 'cut', key: c.jump.cut }, { from: 'header', open: true, seek: true });
      else if (c.jump && typeof c.jump.t === 'number') app.seek(c.jump.t);
      else if (c.code === 'no-lines') app.goStep('lyrics');
    }

    function renderSettings() {
      const o = app.doc.output;
      const env = app.env();
      const aspect = app.doc.look.aspect;
      fillSeg(format, FORMATS, o.format, (v) => t('exp.fmt.' + v), (v) => (v === 'mp4' && !env.webcodecs ? t('exp.pre.no-webcodecs') : ''));
      dom.replace(size, SHORTS.map((s) => {
        const sz = sizeOf(aspect, s);
        return h('option', { value: String(s), selected: s === o.short, text: t('exp.sizeOpt', { p: s, w: sz.w, h: sz.h }) });
      }));
      fillSeg(fps, FPS, o.fps, (v) => String(v));
      // 透明 is always offered: choosing it makes the output 透過PNG (the only transparent format, SPEC §7).
      dom.replace(backdrop, BACKDROPS.map((b) => h('option', {
        value: b, selected: b === app.doc.look.backdrop, text: t(b === 'clear' ? 'exp.bg.clearPng' : 'exp.bg.' + b),
      })));
      const r = o.range ? rangeOf() || o.range : null;
      fillSeg(range, ['all', 'sel', 'io'], r ? 'io' : 'all', (v) => (v === 'io' && r ? clock(r.t0) + '–' + clock(r.t1) : t('exp.range.' + v)));
      fillSeg(quality, QUALITIES, o.quality, (v) => t('exp.q.' + v));
      audio.checked = !!o.audio;
      audio.disabled = o.format !== 'mp4' || !app.doc.song;
      if (document.activeElement !== name) name.value = o.name || '';
      name.placeholder = app.defaultFileName();
      const sz = sizeOf(aspect, o.short);
      const bytes = bytesOf(o, sz, durationOf());
      summary.textContent = t('exp.summary', { w: sz.w, h: sz.h, fps: o.fps, dur: clock(durationOf()),
        size: T.fmtBytes(bytes), where: canStream() ? t('exp.toDisk') : t('exp.toMemory') });
      const list = app.exportChecks();
      dom.replace(checks, list.filter((c) => c.code !== 'memory' || c.level === 'confirm').map((c) => {
        const actions = [fixButton(c),
          c.jump || c.code === 'no-lines' ? h('button', { class: 'link', type: 'button', text: t('exp.jump'), on: { click: () => jumpTo(c) } }) : null]
          .filter(Boolean);
        return h('li', { class: 'check check-' + c.level, 'data-code': c.code },
          I.icon(c.level === 'block' ? 'warn' : c.level === 'info' ? 'info' : 'warn', { size: 15 }),
          h('div', { class: 'check-body' }, h('span', { text: checkText(c) }), actions.length ? h('div', { class: 'check-actions' }, actions) : null));
      }));
      blocked = list.some((c) => c.level === 'block');
      go.disabled = blocked || !!app.exporting;
    }

    function renderRunning(st) {
      const pct = st.N ? Math.floor(st.i / st.N * 100) : 0;
      const sz = sizeOf(app.doc.look.aspect, st.short || app.doc.output.short);
      const bar = h('div', { class: 'progress big', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100',
        'aria-valuenow': String(pct), 'aria-valuetext': t('exp.progress', { i: st.i, n: st.N, eta: clock(st.eta || 0) }),
        'aria-label': t('exp.progressLabel') }, h('div', { class: 'progress-bar', style: { width: pct + '%' } }));
      const now = performance.now();
      if (now - lastAnnounce < PROGRESS_ANNOUNCE_MS) bar.setAttribute('aria-live', 'off');
      else lastAnnounce = now;
      if (st.phase === 'running') {
        dom.replace(running,
          h('div', { class: 'exp-title', text: t('exp.running', { h: Math.min(sz.w, sz.h), fps: st.fps || app.doc.output.fps }) }),
          bar, h('div', { class: 'exp-nums' }, h('span', { text: t('exp.frames', { i: st.i, n: st.N }) }), h('span', { text: pct + '%' })),
          h('div', { class: 'muted', text: st.eta !== null && st.eta !== undefined ? t('exp.left', { time: clock(st.eta) }) : t('exp.preparing') }),
          h('p', { class: 'note', text: t('exp.snapshot') }));
        dom.replace(footer, h('button', { class: 'btn wide', type: 'button', text: t('exp.cancel'), on: { click: () => app.actions.run('export.cancel') } }));
      } else if (st.phase === 'done') {
        dom.replace(running, h('div', { class: 'exp-done' }, I.icon('check', { size: 28 }),
          h('div', { class: 'exp-title', text: t('exp.done') }),
          h('div', { class: 'muted', text: t('exp.doneInfo', { name: st.result.name, size: T.fmtBytes(st.result.bytes), frames: st.result.frames }) })));
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
      else { dom.replace(footer, go); renderSettings(); }
    }

    // Showing the step asks for the faces the export will draw, so 書体を読み込み中 clears before [書き出す] (§4.14).
    function onShow() {
      if (app.exportFonts) app.exportFonts();
      update();
    }

    app.bus.on('export', update);
    app.bus.on('song', update);
    app.bus.on('fonts', () => { if (root.isConnected) update(); });
    return { root, footer, update: () => update(), onShow };
  }

  return { mount };
});
