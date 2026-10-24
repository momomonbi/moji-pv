/* 文字PVメーカー v2 — original work. Isolated, full-cycle camera samples in a large playback dialog. */
MV.def('ui/camera_preview', ['ui/dom', 'ui/icons', 'i18n/t', 'core/shot', 'engine/facade'], (dom, I, T, SHOT, FAC) => {
  'use strict';
  const { h } = dom;
  const KINDS = Object.freeze(['shot', 'xshot', 'rig', 'lens']);
  const CINEMATIC_KEYS = Object.freeze(['universeJourney', 'singularityBurst', 'windMeadow', 'fluidClouds', 'wavePuddle']);
  const SPEEDS = Object.freeze([0.25, 0.5, 1]);
  const sessions = new WeakMap();

  function supports(kind, key) { return KINDS.includes(kind) && key !== null && key !== undefined; }
  function normalize(ref) {
    return ref.kind === 'shot' && SHOT.isExtreme(ref.key) ? Object.assign({}, ref, { kind: 'xshot' }) : Object.assign({}, ref);
  }
  function advance(time, delta, duration, speed, loop) {
    const end = Math.max(0, duration), next = Math.max(0, time) + Math.max(0, delta) * speed;
    if (!end) return { time: 0, ended: true };
    if (next < end) return { time: next, ended: false };
    return loop ? { time: next % end, ended: false } : { time: end, ended: true };
  }
  function nameOf(app, ref) {
    if (ref.kind === 'rig') return app.t.label(SHOT.rigLabel(ref.key));
    if (ref.kind === 'shot' || ref.kind === 'xshot') {
      const base = app.t.label(SHOT.label(ref.key)), x = SHOT.xKeyOf(ref.key);
      return x && x.m ? app.t('shot.mirroredOf', { name: base }) : base;
    }
    return app.label(ref.kind, ref.key);
  }
  function blurbOf(app, ref) {
    if (ref.kind === 'rig') return app.t('camera.sample.rigHint');
    if (ref.kind === 'shot' || ref.kind === 'xshot') {
      const x = SHOT.xKeyOf(ref.key), key = x ? x.key : ref.key;
      return typeof key === 'string' && app.t.has('shot.blurb.' + key) ? app.t('shot.blurb.' + key) : '';
    }
    const def = app.reg.get(ref.kind, ref.key);
    return def && def.blurb ? def.blurb[app.t.lang] || def.blurb.ja || '' : '';
  }

  // open(app, ref, {name, blurb}) → {close, done, state}. The engine's thumbnail renderer and sample plan are separate
  // from the main scene, picks, song clock and document. Both normal closure and native Escape release the fork.
  function open(app, ref0, options) {
    const cinematic = ref0 && ref0.kind === 'ornament' && CINEMATIC_KEYS.includes(ref0.key);
    if (!ref0 || (!cinematic && !supports(ref0.kind, ref0.key)) || !app.dialogs || !app.engine) return null;
    const old = sessions.get(app);
    if (old) old.close();
    const ref = normalize(ref0), opt = options || {}, t = app.t;
    const sampleDuration = cinematic ? Math.max(2, Math.min(30, Number.isFinite(opt.duration) ? opt.duration : 8)) : null;
    if (cinematic) ref.params = Object.assign({}, ref.params, { clock: 'section', start: 0, duration: sampleDuration });
    const failureKey = cinematic ? 'cinematic.previewFailed' : 'camera.sample.failed';
    const theme = app.plan && app.plan.look ? app.plan.look.theme.v : null;
    const sampleOptions = { text: t('pb.sampleText'), textB: t('pb.sampleTextB'), theme, aspect: app.doc.look.aspect };
    if (cinematic) sampleOptions.sampleDuration = sampleDuration;
    let sample = null, engine = null;
    try { sample = FAC.samplePlan(app.reg, ref, sampleOptions); engine = app.engine.fork(); }
    catch (e) { if (app.toast) app.toast(t(failureKey)); return null; }
    const duration = sample.duration;
    const ratio = sample.design.w / sample.design.h;
    const width = Math.round(ratio >= 1 ? 960 : 960 * ratio), height = Math.round(ratio >= 1 ? 960 / ratio : 960);
    // Opening this dialog is an explicit request to watch the selected movement once.
    let playing = !document.hidden;
    let time = 0, speed = cinematic ? 1 : 0.5;
    let frame = 0, lastTick = null, lastPaint = -Infinity, renderCount = 0, disposed = false, closeDialog = null;
    let offView = null, offDoc = null;
    let root = null, canvas = null, play = null, seek = null, readout = null, loop = null, guides = null, note = null;

    function updateControls() {
      if (!root) return;
      play.textContent = t(playing ? 'camera.sample.pause' : 'camera.sample.play');
      play.setAttribute('aria-pressed', String(playing));
      seek.value = String(time);
      seek.setAttribute('aria-valuetext', T.fmtTime(time));
      readout.textContent = t('camera.sample.time', { time: T.fmtTime(time), end: T.fmtTime(duration) });
      root.dataset.sampleTime = String(time);
      root.dataset.renderCount = String(renderCount);
      root.dataset.playing = String(playing);
    }
    function paint() {
      if (disposed || !canvas || !canvas.isConnected) return;
      try {
        const g = canvas.getContext('2d');
        engine.thumb(ref, { canvas, ctx: g, w: width, h: height }, Object.assign({}, sampleOptions, { t: time }));
        if (guides.checked) {
          g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
          g.strokeStyle = 'rgba(124,196,255,0.28)'; g.lineWidth = 1;
          g.setLineDash([6, 8]); g.beginPath();
          for (const p of [0.25, 0.5, 0.75]) { g.moveTo(width * p, 0); g.lineTo(width * p, height); g.moveTo(0, height * p); g.lineTo(width, height * p); }
          g.stroke(); g.restore();
        }
        renderCount++;
      } catch (e) {
        playing = false;
        note.hidden = false; note.textContent = t(failureKey);
      }
      updateControls();
    }
    function cancelFrame() { if (frame) cancelAnimationFrame(frame); frame = 0; lastTick = null; }
    function schedule() { if (!disposed && playing && !document.hidden && !frame) frame = requestAnimationFrame(tick); }
    function tick(now) {
      frame = 0;
      if (disposed || !root || !root.isConnected || document.hidden || !playing) return;
      const delta = lastTick === null ? 0 : (now - lastTick) / 1000;
      lastTick = now;
      const next = advance(time, delta, duration, speed, loop.checked);
      time = next.time;
      if (next.ended) playing = false;
      if (now - lastPaint >= 1000 / 30 || !playing) { paint(); lastPaint = now; }
      schedule();
    }
    function pause() { playing = false; cancelFrame(); updateControls(); }
    function visibility() { if (document.hidden) pause(); }
    function dispose() {
      if (disposed) return;
      disposed = true; playing = false; cancelFrame(); updateControls();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', close);
      if (offView) offView(); if (offDoc) offDoc();
      try { engine.dispose(); } catch (e) { /* cleanup still removes listeners and retires this session */ }
      if (sessions.get(app) === handle) sessions.delete(app);
    }
    function close() { dispose(); if (closeDialog) closeDialog(); }
    const handle = { close, done: null,
      state: () => ({ time, duration, speed, playing, renderCount, disposed, framePending: !!frame, kind: ref.kind, key: ref.key }) };
    sessions.set(app, handle);
    try {
      handle.done = app.dialogs.open((body, done) => {
        closeDialog = done;
        body.closest('dialog').classList.add('camera-preview-dialog');
        canvas = h('canvas', { class: 'camera-preview-canvas', width, height, role: 'img', 'aria-label': opt.name || nameOf(app, ref) });
        play = h('button', { class: 'btn primary camera-preview-play', type: 'button', 'data-autofocus': '1',
          on: { click: () => {
            if (playing) pause(); else { if (time >= duration) time = 0; playing = !document.hidden;
              note.hidden = true; lastTick = null; updateControls(); schedule(); }
          } } });
        const restart = h('button', { class: 'btn camera-preview-restart', type: 'button', text: t('camera.sample.restart'),
          on: { click: () => { time = 0; playing = !document.hidden; note.hidden = true; lastTick = null; paint(); schedule(); } } });
        seek = h('input', { class: 'camera-preview-seek', type: 'range', min: '0', max: String(duration), step: '0.001',
          'aria-label': t('camera.sample.seek'), on: { input: () => { time = Math.max(0, Math.min(duration, Number(seek.value))); lastTick = null; paint(); } } });
        readout = h('output', { class: 'camera-preview-time' });
        const speedSelect = h('select', { class: 'select camera-preview-speed', 'aria-label': t('camera.sample.speed'),
          on: { change: () => { const v = Number(speedSelect.value); if (SPEEDS.includes(v)) speed = v; lastTick = null; } } },
        SPEEDS.map((v, i) => h('option', { value: String(v), selected: v === speed,
          text: t(['camera.sample.slowest', 'camera.sample.slow', 'camera.sample.normal'][i]) })));
        loop = h('input', { class: 'camera-preview-loop', type: 'checkbox', checked: false });
        guides = h('input', { class: 'camera-preview-guides', type: 'checkbox', checked: !cinematic, on: { change: paint } });
        note = h('p', { class: 'note subtle', hidden: true });
        root = h('div', { class: 'camera-preview', 'data-preview-kind': ref.kind,
          'data-preview-key': typeof ref.key === 'string' ? ref.key : 'custom', 'data-duration': String(duration) },
        h('p', { class: 'camera-preview-caption', text: opt.blurb || blurbOf(app, ref) || t('camera.sample.note') }),
        h('div', { class: 'camera-preview-screen' }, canvas),
        h('div', { class: 'camera-preview-transport' }, play, restart, readout), seek,
        h('div', { class: 'camera-preview-options' }, h('label', {}, t('camera.sample.speed'), speedSelect),
          h('label', {}, loop, t('camera.sample.loop')), h('label', {}, guides, t('camera.sample.guides'))), note);
        body.appendChild(root);
        updateControls();
      }, { title: t(cinematic ? 'cinematic.previewTitle' : 'camera.sample.title', { name: opt.name || nameOf(app, ref) }), wide: true });
      handle.done.then(dispose, dispose);
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('pagehide', close);
      if (app.view && app.view.on) offView = app.view.on((changed) => {
        if (changed.some((k) => ['sel', 'panel', 'step', 'mode'].includes(k))) close();
      });
      if (app.store && app.store.on) offDoc = app.store.on('doc', close);
      paint(); schedule();
      return handle;
    } catch (e) { close(); return null; }
  }

  return { KINDS, CINEMATIC_KEYS, SPEEDS, supports, normalize, advance, nameOf, blurbOf, open };
});
