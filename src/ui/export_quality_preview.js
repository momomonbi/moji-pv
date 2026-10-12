/* 文字PVメーカー v2 — original work. Short, real MP4 / transparent WebM encodes at every quality, independent of the editor's transport and history. */
MV.def('ui/export_quality_preview', ['ui/dom', 'ui/output', 'export/schedule', 'i18n/t'], (dom, OUT, S, T) => {
  'use strict';

  const QUALITIES = S.QUALITY_LEVELS;
  const SECONDS = 3;

  // Starting near the end still compares a full three seconds when the selected range permits it.
  function previewRange(doc, plan, time) {
    if (!plan || !Number.isFinite(plan.duration)) return null;
    const range = S.exportRange(doc, plan);
    if (!(range.t1 > range.t0)) return null;
    const span = Math.min(SECONDS, range.t1 - range.t0);
    const at = Number.isFinite(time) ? time : range.t0;
    const t0 = Math.min(Math.max(range.t0, at), range.t1 - span);
    return { t0, t1: Math.min(range.t1, t0 + span) };
  }

  // Sound, file names, kit extras and the selected quality do not change the silent comparison videos.
  function signature(doc, plan) {
    if (!doc) return null;
    const o = doc.output;
    const output = { format: o.format, short: o.short, fps: o.fps, range: o.range, acceleration: o.acceleration || 'auto' };
    return JSON.stringify([Object.assign({}, doc, { output }), plan ? plan.duration : null]);
  }

  function createController(app, options) {
    const opts = options || {};
    const urls = opts.urls || globalThis.URL;
    let state = { phase: 'idle', clips: [] };
    let active = null, epoch = 0, dead = false;
    let knownDoc = null, knownPlan = null, cachedKey = null, key = null;
    let lastExport = null;
    const off = [];

    function currentKey() {
      if (knownDoc !== app.doc || knownPlan !== app.plan) {
        knownDoc = app.doc;
        knownPlan = app.plan;
        cachedKey = signature(knownDoc, knownPlan);
      }
      return cachedKey;
    }

    function emit(next) {
      state = next;
      if (!dead && opts.onChange) opts.onChange(state);
    }

    function revoke(clips) {
      for (const clip of clips) urls.revokeObjectURL(clip.url);
    }

    function clearResults() {
      revoke(state.clips);
      state = Object.assign({}, state, { clips: [] });
    }

    function availability() {
      const format = app.doc.output.format;
      if (format !== 'mp4' && format !== 'kit' && format !== 'webmAlpha') return 'exp.preview.unavailable';
      if (!app.plan || !app.plan.lines || !app.plan.lines.length || !previewRange(app.doc, app.plan, 0)) return 'exp.preview.empty';
      const exportState = app.exportState ? app.exportState() : null;
      if (app.exporting || (exportState && exportState.phase === 'running')) return 'exp.preview.busy';
      if (state.note === 'exp.preview.playbackUnsupported') return state.note;
      const env = app.env ? app.env() : null;
      if (env && !env.webcodecs) return 'exp.preview.codecNote';
      const probe = app.exportProbe ? app.exportProbe() : null;
      if (probe && (format === 'webmAlpha' ? probe.vp9Codec === null : probe.codec === null)) return 'exp.preview.codecNote';
      return null;
    }

    function cancel(note) {
      epoch += 1;
      clearResults();
      if (active) {
        active.note = note || 'exp.preview.cancelled';
        active.abort.abort();
        revoke(active.clips);
        active.clips = [];
        emit(Object.assign({}, state, { phase: 'cancelling', note: active.note }));
      } else emit({ phase: 'idle', clips: [], note: note || 'exp.preview.cancelled' });
    }

    function update(force) {
      if (dead) return;
      const next = currentKey();
      if (key !== next || force === true) {
        const hadPreview = !!active || !!state.clips.length || state.note === 'exp.preview.playbackUnsupported';
        key = next;
        if (hadPreview) cancel('exp.preview.stale');
      }
      const why = availability();
      if (why === 'exp.preview.busy' && (active || state.clips.length)) cancel('exp.preview.busy');
      else {
        if (why !== 'exp.preview.busy' && state.note === 'exp.preview.busy') {
          state = Object.assign({}, state, { note: null });
          if (active && active.note === 'exp.preview.busy') active.note = null;
        }
        if (opts.onChange) opts.onChange(state);
      }
    }

    // The main export reports every frame. Hidden comparisons only need its busy transitions or a new codec probe.
    function exportChanged(payload) {
      const st = app.exportState ? app.exportState() : payload;
      const phase = st ? st.phase : null;
      const busy = !!app.exporting || phase === 'running';
      const probe = app.exportProbe ? app.exportProbe() : null;
      const stamp = probe ? JSON.stringify([probe.webcodecs, probe.codec, probe.vp9Codec]) : null;
      if (busy && lastExport && lastExport.busy && phase === lastExport.phase && stamp === lastExport.probe && currentKey() === key) return;
      lastExport = { phase, busy, probe: stamp };
      update();
    }

    async function start() {
      update();
      if (dead || active || availability()) return false;
      clearResults();
      const doc = app.doc;
      const alpha = doc.output.format === 'webmAlpha';
      const format = alpha ? 'webmAlpha' : 'mp4';
      const mime = alpha ? 'video/webm' : 'video/mp4';
      const range = previewRange(doc, app.plan, app.view && app.view.state.time);
      const { w, h } = S.outputSize(app.plan.design.aspect, doc.output.short);
      const session = { abort: new AbortController(), epoch: ++epoch, clips: [], source: null, note: null, key: currentKey() };
      active = session;
      const same = () => !dead && active === session && epoch === session.epoch && currentKey() === session.key && !availability();
      const stopped = () => new S.ExportError('cancelled', 'quality comparison cancelled');
      const frameState = { phase: 'running', clips: [], range, seconds: range.t1 - range.t0, w, h, fps: doc.output.fps,
        quality: QUALITIES[0], percent: 0, format, alpha, mime };
      emit(frameState);
      try {
        // A try-on may be on the main engine. Plan the committed document only on this owned fork.
        session.source = app.engine.fork();
        session.source.setDoc(doc);
        const ex = app.svc.exporter;
        for (const quality of QUALITIES) {
          if (!same()) throw stopped();
          const previewDoc = Object.assign({}, doc, { output: Object.assign({}, doc.output,
            { format, audio: false, quality, range: Object.assign({}, range) }) });
          emit(Object.assign({}, frameState, { quality, percent: 0 }));
          const sink = ex.sink.createMemorySink({ name: 'quality-' + quality + (alpha ? '.webm' : '.mp4'), type: mime });
          const encode = alpha ? ex.webm.exportWebm : ex.mp4.exportVideo;
          const result = await encode({ engine: session.source, doc: previewDoc, audio: null,
            sink, signal: session.abort.signal, onProgress: (p) => {
              if (!same()) { session.abort.abort(); return; }
              emit(Object.assign({}, frameState, { quality, percent: p.N > 0 ? Math.round(100 * p.i / p.N) : 0 }));
            } });
          if (!same()) throw stopped();
          if (!result.blob) throw new S.ExportError('encode', 'quality comparison returned no video');
          session.clips.push({ quality, bytes: result.bytes, codec: result.codec, format, mime, alpha,
            url: urls.createObjectURL(result.blob) });
        }
        if (!same()) throw stopped();
        const clips = session.clips;
        session.clips = [];
        emit(Object.assign({}, frameState, { phase: 'done', clips, note: 'exp.preview.ready' }));
        return true;
      } catch (err) {
        revoke(session.clips);
        session.clips = [];
        if (!dead && active === session) {
          const cancelled = session.abort.signal.aborted || (err && err.code === 'cancelled') || !same();
          emit({ phase: cancelled ? 'idle' : 'error', clips: [], note: cancelled
            ? session.note || 'exp.preview.stale' : 'exp.preview.error', error: cancelled ? null : err });
        }
        return false;
      } finally {
        if (session.source) session.source.dispose();
        if (active === session) {
          active = null;
          if (!dead && state.phase === 'cancelling') emit({ phase: 'idle', clips: [], note: session.note });
          else if (!dead && opts.onChange) opts.onChange(state);
        }
      }
    }

    function destroy() {
      if (dead) return;
      dead = true;
      epoch += 1;
      if (active) {
        active.abort.abort();
        revoke(active.clips);
        active.clips = [];
      }
      clearResults();
      for (const unsubscribe of off) if (typeof unsubscribe === 'function') unsubscribe();
    }

    key = currentKey();
    if (app.bus && app.bus.on) {
      off.push(app.bus.on('plan', (e) => update(!!e && e.kind === 'load')));
      off.push(app.bus.on('export', exportChanged));
      off.push(app.bus.on('device', () => update(true)));
    }
    // Also catch debounced text edits immediately, before the next plan is ready.
    if (app.store && app.store.on) off.push(app.store.on('doc', (e) => update(!!e && e.kind === 'load')));
    return { get state() { return state; }, get busy() { return !!active; }, availability, start, cancel, update, destroy,
      playbackUnavailable: () => cancel('exp.preview.playbackUnsupported') };
  }

  function mount(app) {
    const { h } = dom;
    const t = app.t;
    const start = h('button', { type: 'button', class: 'btn', 'data-act': 'quality-preview.start', text: t('exp.preview.start') });
    const stop = h('button', { type: 'button', class: 'btn quiet', 'data-act': 'quality-preview.cancel', hidden: true,
      text: t('exp.preview.cancel') });
    const status = h('p', { class: 'note quality-preview-status', role: 'status', 'aria-live': 'polite' });
    const rangeLabel = h('p', { class: 'note subtle quality-preview-range', hidden: true });
    const alphaNote = h('p', { class: 'note subtle quality-preview-alpha', hidden: true, text: t('exp.preview.alphaNote') });
    const cards = h('div', { class: 'quality-preview-clips', hidden: true });
    const play = h('button', { type: 'button', class: 'btn quiet', 'data-act': 'quality-preview.play', text: t('exp.preview.play') });
    const seek = h('input', { type: 'range', min: 0, max: SECONDS, step: 0.01, value: 0,
      'data-quality-preview-seek': '', 'aria-label': t('exp.preview.seek') });
    const transport = h('div', { class: 'quality-preview-transport', hidden: true }, play, seek);
    const deck = h('div', { class: 'quality-preview-deck' }, rangeLabel, alphaNote, transport, cards);
    const expand = h('button', { type: 'button', class: 'btn quiet', hidden: true,
      'data-act': 'quality-preview.expand', text: t('exp.preview.expand') });
    const close = h('button', { type: 'button', class: 'btn quiet', 'data-act': 'quality-preview.close',
      text: t('exp.preview.close') });
    const dialogBody = h('div', { class: 'quality-preview-dialog-body' });
    const dialog = h('dialog', { class: 'quality-preview-dialog', 'aria-label': t('exp.preview.title') },
      h('div', { class: 'quality-preview-dialog-head' }, h('h3', { text: t('exp.preview.title') }), close), dialogBody);
    const root = h('section', { class: 'export-quality-preview', 'aria-label': t('exp.preview.title') },
      h('h3', { class: 'field-label', text: t('exp.preview.title') }),
      h('p', { class: 'note subtle', text: t('exp.preview.help') }),
      h('div', { class: 'quality-preview-actions' }, start, stop, expand), status, deck, dialog);
    let controller = null, shown = null, videos = [], playing = false, seeking = false;

    function pause() {
      for (const video of videos) video.pause();
      playing = false;
      play.textContent = t('exp.preview.play');
    }

    function closeExpanded(restoreFocus) {
      const wasOpen = dialog.open;
      pause();
      if (wasOpen) dialog.close();
      if (deck.parentNode !== root) root.insertBefore(deck, dialog);
      if (restoreFocus && wasOpen && root.isConnected && !expand.hidden) dom.focus(expand);
    }

    function unload() {
      closeExpanded(false);
      for (const video of videos) { video.removeAttribute('src'); video.load(); }
      videos = [];
      dom.clear(cards);
      shown = null;
    }

    function seekAll(time, source) {
      if (seeking) return;
      seeking = true;
      for (const video of videos) if (video !== source && Number.isFinite(video.duration)) {
        if (Math.abs(video.currentTime - time) > 0.04) video.currentTime = Math.min(time, video.duration);
      }
      seek.value = String(time);
      seeking = false;
    }

    function render(state) {
      if (!controller) return;
      const busy = controller.busy;
      const why = controller.availability();
      root.dataset.previewPhase = state.phase;
      root.dataset.qualityCount = dialog.dataset.qualityCount = String(state.clips.length);
      dom.setStyle(root, { '--quality-count': Math.max(1, state.clips.length) });
      dom.setStyle(dialog, { '--quality-count': Math.max(1, state.clips.length) });
      start.disabled = busy || !!why;
      stop.hidden = !busy;
      stop.disabled = state.phase === 'cancelling';
      if (state.clips !== shown) {
        unload();
        shown = state.clips;
        if (state.clips.length) {
          seek.max = String(state.seconds);
          seek.value = '0';
          dom.replace(cards, state.clips.map((clip) => {
            const video = h('video', { controls: true, muted: true, playsinline: true, preload: 'metadata', src: clip.url,
              'aria-label': t('exp.q.' + clip.quality) });
            video.muted = true;
            video.addEventListener('loadedmetadata', () => {
              const time = Number(seek.value);
              if (time > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(time, video.duration);
            });
            video.addEventListener('seeking', () => seekAll(video.currentTime, video));
            video.addEventListener('ended', pause);
            video.addEventListener('error', () => {
              if (videos.includes(video) && video.error) controller.playbackUnavailable();
            });
            videos.push(video);
            return h('div', { class: ['quality-preview-clip', clip.alpha ? 'is-alpha' : null], 'data-preview-quality': clip.quality },
              h('h4', { class: 'quality-preview-clip-title', text: t('exp.q.' + clip.quality) }), video,
              h('p', { class: 'note subtle', text: t('exp.preview.actual', { size: T.fmtBytes(clip.bytes) }) }));
          }));
        }
      }
      cards.hidden = !state.clips.length;
      transport.hidden = !state.clips.length;
      expand.hidden = !state.clips.length || typeof dialog.showModal !== 'function';
      alphaNote.hidden = !state.clips.length || !state.alpha;
      rangeLabel.hidden = !state.range;
      if (state.range) rangeLabel.textContent = t('exp.preview.clip', { from: T.fmtTime(state.range.t0), to: T.fmtTime(state.range.t1),
        w: state.w, h: state.h, fps: state.fps });
      if (state.phase === 'running') status.textContent = t('exp.preview.working', {
        quality: t('exp.q.' + state.quality), percent: state.percent });
      else if (state.phase === 'cancelling') status.textContent = t('exp.preview.stopping');
      else if (state.error) status.textContent = t('exp.preview.error', { reason: t(OUT.errorKey(state.error.code),
        Object.assign({ format: t('exp.fmtIn.' + (state.format || app.doc.output.format)) }, OUT.errorParams(state.error))) });
      else status.textContent = why ? t(why) : state.note ? t(state.note) : '';
    }

    controller = createController(app, { onChange: render });
    // Native button, range and video keys belong to this comparison, not the editor's global playback shortcuts.
    root.addEventListener('keydown', (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if ([' ', 'Spacebar', 'Enter', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(ev.key)
        || ev.key === 'Escape' && dialog.open) {
        ev.stopPropagation();
      }
    });
    expand.addEventListener('click', () => {
      if (!videos.length || typeof dialog.showModal !== 'function') return;
      pause();
      dialogBody.appendChild(deck);
      try { dialog.showModal(); } catch (err) { closeExpanded(false); }
    });
    close.addEventListener('click', () => closeExpanded(true));
    dialog.addEventListener('cancel', (ev) => { ev.preventDefault(); closeExpanded(true); });
    dialog.addEventListener('close', () => {
      if (!dialog.open && deck.parentNode !== root) closeExpanded(false);
    });
    start.addEventListener('click', () => { controller.start(); });
    stop.addEventListener('click', () => { pause(); controller.cancel(); });
    seek.addEventListener('input', () => seekAll(Number(seek.value), null));
    play.addEventListener('click', async () => {
      if (playing) { pause(); return; }
      const at = Number(seek.value);
      const position = videos.some((video) => video.ended) || at >= Number(seek.max) - 0.0001 ? 0 : at;
      seekAll(position, null);
      const current = videos.slice();
      try {
        await Promise.all(current.map((video) => video.play()));
        if (current.length && current[0] === videos[0]) {
          playing = true;
          play.textContent = t('exp.preview.pause');
        } else for (const video of current) video.pause();
      } catch (err) { for (const video of current) video.pause(); pause(); }
    });
    // Follow the first comparison's clock; keep the other silent videos close after buffering or loop seeking.
    cards.addEventListener('timeupdate', () => {
      if (playing && videos[0]) seekAll(videos[0].currentTime, videos[0]);
    }, true);
    const offView = app.view && typeof app.view.on === 'function' ? app.view.on((changed, state) => {
      if (changed.includes('step') && state.step !== 'export') {
        closeExpanded(false);
        if (controller.busy) controller.cancel();
      }
    }) : null;
    render(controller.state);
    return { root, controller, update: () => controller.update(), cancel: () => controller.cancel(),
      destroy() { if (offView) offView(); unload(); controller.destroy(); } };
  }

  return { QUALITIES, SECONDS, previewRange, signature, createController, mount };
});
