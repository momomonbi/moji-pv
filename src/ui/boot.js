/* 文字PVメーカー v2 — original work. Boot: builds store, registry, engine, player and services; wires events, actions and keys (DESIGN §9.2). */
MV.def('ui/boot', ['core/doc', 'core/store', 'i18n/t', 'i18n/strings', 'ui/dom', 'ui/keys', 'ui/actions',
  'ui/selection', 'ui/looks', 'ui/view', 'ui/shell', 'ui/header', 'ui/tap', 'ui/project_io',
  'ui/inspector', 'ui/timeline', 'ui/palette', 'ui/menus', 'ui/dialogs', 'ui/ai_panel', 'ai/providers',
  'ui/fields', 'ui/output'],             // WP8b views, WP8c AI panel, INT-UI output rules
(D, ST, T, strings, dom, K, A, S, LK, V, shell, header, tapUi, projectIo, inspector, timeline, palette, menus, dialogs,
  aiPanel, aiProviders, F, OUT) => {
  'use strict';

  const TYPING_REPLAN_MS = 120;         // typing never waits on the planner (§7.4)
  const OMAKASE_TRIES = 16;
  const FRAME = 1 / 30;
  const PLAY_FROM_LEAD = 0.5;
  const RELINK_TOLERANCE_S = 0.5;       // §6.11: a re-linked song may differ in length by at most this much
  const PREPARE_S = 5;                  // scenes prepared on each side of the playhead after a seek or a new plan
  // While playing, prepare again once the playhead has moved this far from the last prepare's centre, so a window whose
  // sprites exceed the budget is refilled well before its horizon (perf-1; every 2.5 s, one frame about 2 s after a
  // prepare still rasterized 18 sprites on project_vertical at 720p).
  const REPREPARE_S = 1.5;
  const PREPARE_DEBOUNCE_MS = 80;
  const TAP_OPEN_S = 600;               // tapping without a song: the silent clock runs this far past the last line's start

  // ===============================================================================================================
  // Services: the packages boot connects (DESIGN §9.2). Every one is required; a missing module fails loudly here.
  // ===============================================================================================================

  function services() {
    const commands = MV.use('core/commands');
    const registry = MV.use('parts/catalog').defaultRegistry();
    const facade = MV.use('engine/facade');
    const canvasHost = MV.use('engine/host/canvas');
    const fontHost = MV.use('engine/host/fonts');
    const measureHost = MV.use('engine/host/measure');
    const planPkg = MV.use('planner/plan');
    const fieldsPkg = MV.use('planner/fields');
    const lookPkg = MV.use('planner/look');
    const lyrics = MV.use('core/lyrics');
    const hosts = { fonts: null };                     // the preview's FontBook (its epoch makes frames stale, §4.14)
    const createEngine = () => {
      const canvas = canvasHost.createCanvasFactory();
      const fonts = fontHost.createFontBook({ document });
      if (!hosts.fonts) hosts.fonts = fonts;
      const measurer = measureHost.createCanvasMeasurer(canvas, fonts);
      return facade.createEngine({ registry, canvas, measurer, fonts, assets: null });
    };
    return {
      reduce: commands.reduce,
      registry,
      createEngine,
      fonts: () => hosts.fonts,
      createPlayer: MV.use('audio/host/player').createPlayer,
      songs: MV.use('audio/host/decode'),
      // planner/look.previewMood reads the registry from its last plan() unless it is passed (WP8b integration note).
      previewMood: (doc, moodSeed) => lookPkg.previewMood(doc, moodSeed, { registry }),
      lockPayload: fieldsPkg.lockPayload,
      pinSig: planPkg.pinSig,
      diff: MV.use('planner/diff').diff,
      // Field states and explanations for the inspector (planner/fields, planner/explain; §4.16.1).
      fieldState: fieldsPkg.fieldState,
      fieldStates: fieldsPkg.fieldStates,
      explain: MV.use('planner/explain').explain,
      tapCore: MV.use('core/tap'),
      sample: (lang) => (lang === 'en' ? lyrics.SAMPLE_EN : lyrics.SAMPLE_JA),
      exporter: { mp4: MV.use('export/host/mp4'), png: MV.use('export/host/png'), sink: MV.use('export/host/sink'),
        schedule: MV.use('export/schedule') },
    };
  }

  function safeStorage(kind) {
    try { const s = window[kind]; s.getItem('mojipv.probe'); return s; } catch (e) { return null; }
  }

  function randomU32() {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0];
  }

  function createBus() {
    const map = new Map();
    return {
      on(evt, fn) {
        if (!map.has(evt)) map.set(evt, []);
        map.get(evt).push(fn);
        return () => { const l = map.get(evt); l.splice(l.indexOf(fn), 1); };
      },
      emit(evt, payload) { for (const fn of (map.get(evt) || []).slice()) fn(payload); },
    };
  }

  // ===============================================================================================================
  // The app object: shared state and the verbs every view uses.
  // ===============================================================================================================

  function createApp(svc) {
    const lang = MV.LANG === 'en' ? 'en' : 'ja';
    const t = T.createT(lang, strings, svc.registry);
    const view = V.createView({ storage: safeStorage('localStorage') });
    const store = ST.createStore({ doc: D.defaultDoc(), side: D.defaultSide(), reduce: svc.reduce, now: () => Date.now() });
    const engine = svc.createEngine();
    const bus = createBus();
    return {
      t, lang, view, store, engine, bus, reg: svc.registry, svc, actions: null, layout: null, shell: null, io: null, tap: null,
      plan: null, prevDoc: null, exporting: null, popover: null, clipboard: null, peaks: null, tapCore: svc.tapCore,
      get doc() { return store.doc; },
      reduce: (doc, cmd) => svc.reduce(doc, cmd),
      label: (kind, key) => t.part(kind, key),
      warnings: () => { try { return engine.warnings() || []; } catch (e) { return []; } },
      titleOf: () => header.titleOf(store.doc),
      inText: () => dom.targetKind(document.activeElement) === 'text',
      env: () => ({ webcodecs: typeof VideoEncoder === 'function', fsAccess: typeof window.showSaveFilePicker === 'function' }),
    };
  }

  // --- dispatching, planning and history ------------------------------------------------------------------------

  function installStore(app) {
    const { store, view, bus, engine } = app;
    let lastDoc = store.doc;

    const withSel = (meta) => {
      const m = Object.assign({}, meta || {});
      if (!m.sel) m.sel = { before: view.state.sel, after: view.state.sel };
      return m;
    };
    app.dispatch = (cmd, meta) => {
      try { return store.dispatch(cmd, withSel(meta)); } catch (e) { reportError(app, e); return store.rev; }
    };
    app.batch = (meta, cmds) => {
      try { return store.batch(withSel(meta), cmds); } catch (e) { reportError(app, e); return store.rev; }
    };
    app.jump = (n) => { if (app.shell) app.shell.steps.bodies.lyrics.editor.flushTyping(); store.jump(n); };

    function replan(e) {
      if (app.shell && app.shell.stage.hasAlt()) app.shell.stage.setAlt(null);
      const before = app.plan;
      engine.setDoc(store.doc);
      app.plan = engine.plan;
      const sel = S.validate(view.state.sel, app.plan);
      if (!S.equal(sel, view.state.sel)) view.set({ sel });
      if (app.plan && view.state.time > app.plan.duration) view.set({ time: app.plan.duration });
      bus.emit('plan', Object.assign({ before }, e || { kind: 'load', touched: { rows: 'all', look: true } }));
    }
    const replanSoon = dom.debounce(replan, TYPING_REPLAN_MS);
    app.replan = replan;

    store.on('doc', (e) => {
      app.prevDoc = lastDoc;
      lastDoc = store.doc;
      if ((e.kind === 'undo' || e.kind === 'redo') && e.sel) view.set({ sel: e.sel });
      const top = store.peek().undo;
      const typing = e.kind === 'do' && e.cmds.length === 1 && e.cmds[0].t === 'lyrics.set' && top && top[0] === 'undo.typing';
      if (typing) replanSoon(e); else { replanSoon.cancel(); replan(e); }
      // The look history comes after the plan and never throws: a history that cannot be recorded (a damaged side)
      // must not leave the preview on the previous plan or skip the autosave.
      if (e.kind === 'do') {
        try { recordLook(app, e.cmds); } catch (err) { if (typeof console !== 'undefined') console.error(err); }
      }
      if (app.io) app.io.schedule();
    });
    store.on('side', (e) => { bus.emit('side', e); if (app.io) app.io.schedule(); });
    bus.on('plan', (e) => reportUndoneLook(app, e));
  }

  // Look history (§3.7): おまかせ, rerolls and field dice append or coalesce; ◀ ▶ never do. While the history is still
  // empty (lyrics typed, or brought in by the AI or a file, rather than pasted — a paste records the first look in
  // app.firstRun), the look before this change is recorded first as 「最初の見た目」, so ◀ can always go back to it.
  function recordLook(app, cmds) {
    const cmd = cmds.length === 1 ? cmds[0] : { t: 'batch', cmds };
    const kind = LK.appendKind(cmd);
    if (kind === 'none') return;
    const first = cmds.find((c) => LK.appendKind(c) !== 'none') || cmd;
    let label = ['look.rerollScope', {}];
    if (first.t === 'look.omakase') label = ['look.omakase', {}];
    else if (first.t === 'look.seed') label = ['look.reroll', {}];
    else if (LK.isFieldDice(first.key)) label = [LK.DICE_LABEL, {}];
    const before = app.prevDoc;
    const hasLines = !!(app.plan && app.plan.lines.length);
    app.store.setSide((side) => {
      const empty = hasLines && before && !LK.pointer(side, before).total;
      const s = empty ? LK.record(side, before, { kind: 'append', scope: 'work', label: ['look.first', {}] }) : side;
      return LK.record(s, app.store.doc, { kind, scope: LK.scopeOfCmd(cmd), label });
    });
  }

  function reportError(app, e) {
    if (typeof console !== 'undefined') console.error(e);
    app.toast(app.t('err.command'), { kind: 'error' });
  }

  // --- time and playback ---------------------------------------------------------------------------------------

  function installTransport(app) {
    const { view, bus } = app;
    app.player = app.svc.createPlayer({ buffer: null, duration: 0 });

    const duration = () => (app.plan ? app.plan.duration : 0);
    // Where the clock stops: the video length, except while tapping without a song (§6.4.15 silent clock). The taps set
    // the timing then, so the clock runs on past the automatic length, up to the last line's start + TAP_OPEN_S.
    const clockEnd = () => {
      const d = duration();
      if (view.state.mode !== 'tap' || !app.plan || (app.songReady && app.songReady())) return d;
      return Math.max(d, app.plan.lines.reduce((m, l) => Math.max(m, l.t0), 0)) + TAP_OPEN_S;
    };
    app.clockEnd = clockEnd;
    // The player clamps to its own duration; keep it equal to the clock's end (only while stopped: load() stops).
    app.syncPlayer = () => {
      const p = app.player;
      if (view.state.playing || typeof p.load !== 'function' || Math.abs((p.duration || 0) - clockEnd()) < 1e-6) return;
      p.load({ buffer: app.buffer, duration: clockEnd() });
      p.seek(view.state.time);
    };
    app.time = () => (view.state.playing ? app.player.now() : view.state.time);
    // The preview is silent when the preference says so, or during the one-off first-run autoplay (§6.9.2).
    app.isMuted = () => V.isMuted(view.state);
    const applyMute = () => { if (app.player.setMuted) app.player.setMuted(app.isMuted()); };
    app.seek = (tt) => {
      const x = Math.max(0, Math.min(clockEnd(), Number(tt) || 0));
      app.syncPlayer();
      app.player.seek(x);
      view.set({ time: x });
      bus.emit('time', x);
    };
    app.play = () => {
      if (!app.plan || !app.plan.lines.length) return;
      app.syncPlayer();
      let from = view.state.time;
      if (from >= clockEnd() - 0.05) from = 0;
      applyMute();
      app.player.play(from);
      view.set({ playing: true, time: from });
    };
    app.pause = () => {
      if (!view.state.playing) return;
      const now = app.player.now();
      app.player.pause();
      // The first-run mute ends with the autoplay: the next play follows the stored preference.
      view.set({ playing: false, time: Math.min(now, clockEnd()), autoMuted: false });
      app.syncPlayer();
      bus.emit('time', view.state.time);
    };
    // Called by the stage once per animation frame while playing.
    app.onTick = () => {
      const now = app.player.now();
      const end = Math.min(clockEnd(), app.player.duration > 0 ? app.player.duration : Infinity);
      if (now >= end - 1e-3 || !app.player.playing) { app.pause(); app.seek(Math.min(now, clockEnd())); return; }
      bus.emit('time', now);
    };
    // Entering or leaving tap mode changes the clock's end: the stopped player takes the new length (a tap session that
    // ran past the video's end comes back to it).
    view.on((changed) => { if (changed.includes('mode') && !view.state.playing) app.seek(view.state.time); });
    // setSongBuffer(buffer | null, sha1): the decoded audio and the doc.song sha1 it belongs to (app.bufferSha1).
    app.buffer = null;
    app.bufferSha1 = null;
    app.setSongBuffer = (buffer, sha1) => {
      if (view.state.playing) app.pause();
      app.buffer = buffer || null;
      app.bufferSha1 = buffer ? sha1 || null : null;
      if (typeof app.player.load === 'function') app.player.load({ buffer: app.buffer, duration: duration() });
      else app.player = app.svc.createPlayer({ buffer: app.buffer, duration: duration() });
      app.player.seek(view.state.time);
      view.set({ autoMuted: false });
      applyMute();
    };
    view.on((changed) => { if (changed.includes('prefs') || changed.includes('autoMuted')) applyMute(); });
    bus.on('plan', () => app.syncPlayer());
  }

  // --- selection, panels, steps --------------------------------------------------------------------------------

  function installNavigation(app) {
    const { view } = app;
    let opener = null;                          // what had focus when the detail column opened (§6.12: focus returns)
    const panelRoot = () => (app.shell && app.shell.panel ? app.shell.panel.root : null);
    const shown = (el) => !!el && el.isConnected && !el.disabled && el.getClientRects().length > 0;
    app.openPanel = (panel, from) => {
      if (panel === 'details' && view.state.aiReview) { app.toast(app.t('panel.reviewLocked')); return; }
      const active = document.activeElement;
      const root = panelRoot();
      if (!view.state.panel) opener = active && active !== document.body && !(root && root.contains(active)) ? active : null;
      view.openPanel(panel, { from, layout: app.layout ? app.layout.layout : 'wide' });
    };
    // Closing the column (Esc at the root, ×, the header toggles) while focus is inside it: focus goes back to what
    // opened it, or to the stage, never to <body>.
    app.closePanel = () => {
      const root = panelRoot();
      const inside = !!root && root.contains(document.activeElement);
      view.closePanel();
      if (!inside || !app.shell) return;
      if (shown(opener)) dom.focus(opener); else app.shell.stage.focus();
      opener = null;
    };
    // select(sel, { from, open, pause, seek: true | false | 'ifPaused' }).
    app.select = (sel, opts) => {
      const o = opts || {};
      const s = S.validate(sel, app.plan);
      if (o.pause) app.pause();
      view.set({ sel: s });
      const openable = s.level !== 'work' || o.from === 'header' || o.from === 'crumbs';
      if (o.open && !view.state.aiReview && openable && view.state.panel !== 'details') {
        app.openPanel('details', o.from === 'lyrics' ? 'lyrics' : o.from || 'key');
      }
      const seek = o.seek === undefined ? 'ifPaused' : o.seek;
      const wantSeek = seek === true || (seek === 'ifPaused' && !view.state.playing && view.state.prefs.seekOnSelect);
      if (wantSeek && s.level !== 'work') {
        const tt = S.seekTime(s, app.plan);
        if (tt !== null) app.seek(tt);
      }
    };
    app.goStep = (step) => {
      if (view.state.mode === 'tap') return;
      if (view.state.rail) view.set({ rail: false, railBy: null });
      if (app.layout && (app.layout.layout === 'compact' || app.layout.layout === 'stacked') && view.state.panel) view.closePanel();
      view.set({ step });
    };
    app.toast = (text, opts) => (app.shell ? app.shell.toasts.show(text, opts) : null);
    app.tryOn = (doc, badge) => {
      if (!app.shell) return;
      if (app.ai) app.ai.tryOnReplaced(doc);                // WP8c: another try-on ends the AI's
      if (doc) app.shell.stage.setAlt(doc, badge);
      else if (app.shell.stage.hasAlt() && !view.state.compare) app.shell.stage.setAlt(null);
      app.shell.playbar.updateStrip();
    };
    app.modeStrip = () => {
      if (app.tap && app.tap.active()) return app.tap.strip();
      if (app.shell && app.shell.stage.hasAlt() && !view.state.compare) {
        const ai = app.ai ? app.ai.strip() : null;            // WP8c: 「案Bを試写中 [この案にする] [やめる]」
        if (ai) return ai;
        return { kind: 'tryon', text: app.t('play.tryOnStrip'), actions: [{ label: app.t('play.tryOnStop'), run: () => app.tryOn(null) }] };
      }
      return null;
    };
    app.selectionRange = () => {
      const plan = app.plan;
      const s = S.validate(view.state.sel, plan);
      const ids = s.level === 'line' ? s.ids : [S.lineOfSel(s)].filter(Boolean);
      const lines = plan ? plan.lines.filter((l) => ids.includes(l.id)) : [];
      if (!lines.length) return null;
      const t0 = Math.max(0, Math.min(...lines.map((l) => l.t0)) - app.doc.timing.lead);
      const t1 = Math.max(...lines.map((l) => l.t1));
      return { t0: Math.round(t0 * 100) / 100, t1: Math.round(t1 * 100) / 100 };
    };
  }

  // --- first run, sample, projects, songs ------------------------------------------------------------------------

  function installWork(app) {
    const { store, view, t } = app;

    // §6.9.2: after the first paste — a default look entry, muted playback from line 1, focus to the stage, a pulse.
    // Without the autoplay (reduced motion, or the preference off) the preview parks on line 1's hero frame (§6.5
    // seeking on select), so the first thing seen is the lyric, not the empty lead-in before it.
    app.firstRun = () => {
      if (!LK.pointer(store.side, store.doc).total) {
        store.setSide((side) => LK.record(side, store.doc, { kind: 'append', scope: 'work', label: ['look.first', {}] }));
      }
      const plan = app.plan;
      if (!plan || !plan.lines.length) return;
      if (view.state.prefs.autoplay && !dom.prefersReducedMotion()) {
        app.seek(Math.max(0, plan.lines[0].t0 - PLAY_FROM_LEAD));
        view.set({ autoMuted: true });
        app.play();
      } else {
        const hero = S.seekTime({ level: 'line', ids: [plan.lines[0].id] }, plan);
        app.seek(hero !== null ? hero : plan.lines[0].t0);
      }
      if (app.shell) {
        app.shell.stage.focus();
        app.shell.playbar.pulseOmakase();
      }
      if (view.state.prefs.hintOmakase) {
        app.toast(t('hint.omakase'), { kind: 'info' });
        view.setPref('hintOmakase', false);
      }
    };

    app.loadSample = () => {
      store.seal();
      app.dispatch({ t: 'lyrics.set', text: app.svc.sample(app.lang) }, { label: ['undo.sample', {}] });
      store.seal();
      app.firstRun();
    };

    // loadProject(doc, side, { quiet }): quiet leaves the toast to the caller (clearing the device says what it did).
    app.loadProject = (doc, side, o) => {
      if (app.tap && app.tap.active()) app.tap.cancel();   // its marks belong to the lines of the work being left
      app.pause();
      store.load(doc, side);
      view.set({ sel: S.WORK, time: 0 });
      app.seek(0);
      if (!(o && o.quiet)) app.toast(t('io.historyCleared'), { kind: 'info' });
    };

    // Songs (audio/host/decode.loadSong: decode, analyze, peaks); audio bytes go to IndexedDB by sha1, never into the JSON.
    // The decoded buffer always belongs to doc.song: every document change (edit, undo, redo, open, new work) drops a
    // buffer whose sha1 no longer matches and looks the song up again by sha1 (syncSong).
    let song = { state: 'none', name: '', progress: 0 };
    let linking = null;                                   // the sha1 being looked up in IndexedDB
    let looked = null;                                    // the last sha1 looked up (a miss is not retried per edit)
    const setSong = (x) => { song = x; app.bus.emit('song', x); };
    const idle = () => setSong({ state: 'none', name: '', progress: 0 });
    app.songReady = () => !!(app.doc.song && app.buffer && app.bufferSha1 === app.doc.song.sha1);
    app.songState = () => {
      if (song.state === 'linking' && !app.doc.song) return { state: 'none' };
      return song.state === 'none' && app.doc.song ? { state: app.songReady() ? 'ready' : 'missing' } : song;
    };
    const peaksOf = (buffer) => {
      return buffer ? MV.use('audio/peaks').peaks(app.svc.songs.channelsOf(buffer), buffer.sampleRate) : null;
    };
    app.syncSong = () => {
      const want = app.doc.song ? app.doc.song.sha1 : null;
      if (!want) looked = null;
      if (want === app.bufferSha1) return;
      const dropped = !!app.buffer;
      if (dropped) { app.setSongBuffer(null); app.peaks = null; }
      if (want && looked !== want) { looked = want; app.relinkSong(app.doc.song); } else if (dropped) app.bus.emit('song', song);
    };
    store.on('doc', () => app.syncSong());
    app.pickSong = async () => {
      const files = await dom.pickFiles('audio/*,.mp3,.wav,.m4a,.ogg,.flac', false);
      if (files[0]) app.loadSong(files[0]);
    };
    // One song loads at a time: a newer file (or [中止]) aborts the analysis of the one still loading, and a load that
    // was replaced or cancelled never reaches the document.
    let loading = null;                                   // { abort } of the song being decoded and analyzed
    app.cancelSong = () => { if (loading) loading.abort.abort(); };
    app.loadSong = async (file) => {
      const songs = app.svc.songs;
      if (loading) loading.abort.abort();
      const job = { abort: new AbortController() };
      loading = job;
      const current = () => loading === job && !job.abort.signal.aborted;
      setSong({ state: 'decoding', name: file.name, progress: 0 });
      try {
        const res = await songs.loadSong(file, { signal: job.abort.signal,
          onProgress: (p) => { if (current()) setSong({ state: 'decoding', name: file.name, progress: p }); } });
        if (!current()) throw Object.assign(new Error('song load cancelled'), { code: 'cancelled' });
        app.io.putSong(res.song.sha1, file);
        app.setSongBuffer(res.buffer, res.song.sha1);        // first, so the song.set below finds its buffer
        app.peaks = res.peaks;
        store.seal();
        app.dispatch({ t: 'song.set', song: res.song }, { label: ['undo.song', {}] });
        idle();
        app.syncSong();                                     // a refused song.set drops the buffer again
        app.toast(t('song.loaded', { name: file.name }), { kind: 'ok' });
      } catch (e) {
        if (loading !== job) return;                        // a newer file took over; it reports for itself
        if (e && e.code === 'cancelled') { idle(); app.toast(t('err.song.cancelled')); return; }
        if (typeof console !== 'undefined') console.error(e);
        setSong({ state: 'error', name: file.name, progress: 0, code: e && e.code ? e.code : 'decode' });
      } finally {
        if (loading === job) loading = null;
      }
    };
    app.clearSong = () => {
      app.dispatch({ t: 'song.clear' }, { label: ['undo.songClear', {}] });
      idle();
    };
    const stillWanted = (sha1) => !!(app.doc.song && app.doc.song.sha1 === sha1 && app.bufferSha1 !== sha1);
    // Finds the song's audio by sha1 in IndexedDB; without it step ② asks to re-link it (§6.11).
    app.relinkSong = async (docSong) => {
      const songs = app.svc.songs;
      if (!docSong) return;
      const sha1 = docSong.sha1;
      linking = sha1;
      setSong({ state: 'linking', name: docSong.name, progress: 0 });
      try {
        const blob = await app.io.getSong(sha1);
        const decoded = blob && stillWanted(sha1) ? await songs.decodeFile(blob) : null;
        if (decoded && stillWanted(sha1)) {
          app.setSongBuffer(decoded.buffer, sha1);
          app.peaks = peaksOf(decoded.buffer);
        }
      } catch (e) { /* stays "missing" */ }
      if (linking === sha1) linking = null;
      if (song.state === 'linking') idle(); else app.bus.emit('song', song);
    };
    // The relink picker (§6.11): the file must be the project's song — the same sha1, or, after asking, a file whose
    // length is within ±0.5 s. The document is not changed (no song.set): its analysis, tempo and offset stay.
    app.pickRelink = async () => {
      const files = await dom.pickFiles('audio/*,.mp3,.wav,.m4a,.ogg,.flac', false);
      if (files[0]) await app.relinkFile(files[0]);
    };
    app.relinkFile = async (file) => {
      const songs = app.svc.songs;
      const docSong = app.doc.song;
      if (!docSong) return false;
      const dur = T.fmtTime(docSong.seconds).replace(/\.\d+$/, '');
      setSong({ state: 'linking', name: file.name, progress: 0 });
      let decoded = null;
      try { decoded = await songs.decodeFile(file); } catch (e) {
        setSong({ state: 'error', name: file.name, progress: 0, code: e && e.code ? e.code : 'decode', relink: true });
        return false;
      }
      let ok = decoded.sha1 === docSong.sha1;
      if (!ok && Math.abs(decoded.buffer.duration - docSong.seconds) <= RELINK_TOLERANCE_S) {
        const text = t('song.relinkAsk', { name: file.name, dur });
        ok = app.confirm ? await app.confirm({ title: t('song.relinkTitle'), text, ok: t('song.relinkOk') }) : window.confirm(text);
      } else if (!ok) app.toast(t('song.relinkMismatch', { name: file.name, dur }), { kind: 'error' });
      const linked = ok && app.doc.song === docSong;
      if (linked) {
        app.io.putSong(docSong.sha1, file);
        app.setSongBuffer(decoded.buffer, docSong.sha1);
        app.peaks = peaksOf(decoded.buffer);
        app.toast(t('song.relinked', { name: file.name }), { kind: 'ok' });
      }
      idle();
      return linked;
    };
  }

  // Export (§4.21) through export/host/*: probe + preflight, openSink from the click, progress, cancel, done.
  function installExport(app) {
    const { t } = app;
    let st = { phase: 'idle' };
    let abort = null;
    let probed = { key: null, value: null };
    const set = (x) => { st = x; app.exporting = x.phase === 'running' ? x : null; app.bus.emit('export', x); };
    const ex = () => app.svc.exporter;
    app.exportState = () => st;
    app.exportReset = () => set({ phase: 'idle' });
    app.defaultFileName = () => {
      const ext = app.doc.output.format === 'mp4' ? 'mp4' : 'zip';
      return ex().schedule.fileName(app.doc, ext);
    };
    // WebCodecs support for the current size (async; cached per w×h×fps, then the step re-renders).
    app.exportProbe = () => {
      if (!app.plan) return null;
      const o = app.doc.output;
      const { w, h } = ex().schedule.outputSize(app.plan.design.aspect, o.short);
      const key = w + 'x' + h + '@' + o.fps;
      if (probed.key !== key) {
        probed = { key, value: null };
        ex().mp4.probe({ w, h, fps: o.fps }).then((value) => {
          if (probed.key === key) { probed.value = value; app.bus.emit('export', st); }
        }).catch(() => { probed.value = { webcodecs: false, codec: null, audioCodec: null, anyCodec: false }; });
      }
      return probed.value;
    };
    // The pre-flight list of step ④: export/schedule.preflight plus the UI's own items (ui/output.checks: transparency
    // and backdrop filters), one line for every font that failed, fixes as command lists.
    app.exportChecks = () => {
      if (!app.plan || !app.plan.lines.length) return [{ code: 'no-lines', level: 'block', params: {} }];
      const pr = app.exportProbe() || {};
      const items = ex().schedule.preflight(app.doc, app.plan, {
        webcodecs: typeof VideoEncoder === 'function', codec: pr.codec, audioCodec: pr.audioCodec, anyCodec: pr.anyCodec,
        fontsReady: fontsReady(),
        fsAccess: ex().sink.canStream(), songReady: !app.doc.song || app.songReady(), warnings: app.warnings(),
      });
      return OUT.mergeFonts(OUT.withFixes(items, app.doc).concat(OUT.checks(app.doc, app.plan, app.reg)));
    };
    // The faces the export range draws (§4.14): asked for when step ④ shows, so the export does not wait on them later;
    // the pre-flight says 書体を読み込み中 until they are in (the export itself waits for them, §4.21).
    const fontRefs = () => {
      const fonts = app.svc.fonts ? app.svc.fonts() : null;
      if (!fonts || !app.plan) return null;
      const { t0, t1 } = ex().schedule.exportRange(app.doc, app.plan);
      try { return { fonts, usage: app.engine.fontUsage(t0, t1) }; } catch (e) { return null; }
    };
    const fontsReady = () => {
      const f = fontRefs();
      return !f || !f.usage.refs.some((r) => { const st = f.fonts.status(r); return st === 'idle' || st === 'loading'; });
    };
    app.exportFonts = () => {
      const f = fontRefs();
      if (!f || typeof f.fonts.ready !== 'function' || !f.usage.refs.length) return;
      Promise.resolve(f.fonts.ready(f.usage.refs, f.usage.textByFamily)).then(() => app.bus.emit('fonts'), () => app.bus.emit('fonts'));
    };
    // A large export built in memory asks first (§4.21 pre-flight 'confirm'), however the export starts (button, Ctrl+K,
    // keys). Such an item exists only without File System Access, where openSink shows no picker and so needs no user
    // activation: awaiting the dialog before it is safe.
    const confirmLarge = async () => {
      const item = app.exportChecks().find((c) => c.level === 'confirm');
      if (!item) return true;
      const text = t('exp.pre.memory.confirm', { size: T.fmtBytes(item.params.bytes) });
      return app.confirm ? app.confirm({ text }) : window.confirm(text);
    };
    const openSink = async (o, name) => {
      try { return await ex().sink.openSink({ name, kind: o.format === 'mp4' ? 'mp4' : 'zip' }); } catch (e) {
        set({ phase: 'error', message: t('err.exp.sink') });
        return null;
      }
    };
    let starting = false;                   // the confirmation or the save dialog is open
    app.exportStart = async () => {
      if (st.phase === 'running' || starting) return;
      starting = true;
      let sink = null;
      try {
        if (await confirmLarge()) sink = await openSink(app.doc.output, app.defaultFileName());
      } finally { starting = false; }
      if (!sink) return;
      const o = app.doc.output;
      const name = app.defaultFileName();
      abort = new AbortController();
      app.pause();
      set({ phase: 'running', i: 0, N: 0, eta: null, fps: o.fps, short: o.short, started: performance.now() });
      const onProgress = (p) => set(Object.assign({}, st, { i: p.i, N: p.N, eta: p.eta }));
      // The export renders the committed document: a fork planned from app.doc, whatever the preview shows (a try-on or
      // the compare view render another document on the preview engine).
      const doc = app.doc;
      let source = null;
      try {
        source = app.engine.fork();
        source.setDoc(doc);
        const args = { engine: source, doc, sink, signal: abort.signal, onProgress };
        const result = o.format === 'mp4'
          ? await ex().mp4.exportVideo(Object.assign(args, { audio: o.audio && app.songReady() ? app.buffer : null }))
          : await ex().png.exportPngs(Object.assign(args, { alpha: o.format === 'pngAlpha' }));
        if (result.blob) ex().sink.downloadBlob(result.blob, result.name || name);
        set({ phase: 'done', result: Object.assign({ name }, result) });
      } catch (e) {
        const code = e && e.code ? e.code : 'encode';
        if (code === 'cancelled' || (abort && abort.signal.aborted)) { set({ phase: 'idle' }); app.toast(t('err.exp.cancelled')); }
        else {
          if (typeof console !== 'undefined') console.error(e);
          set({ phase: 'error', message: t(OUT.errorKey(code)) });
        }
      } finally {
        if (source && typeof source.dispose === 'function') source.dispose();
      }
      abort = null;
    };
    app.exportCancel = () => { if (abort) abort.abort(); };
  }

  // Nudge gestures (drag on the preview): one gesture = one undo entry.
  function installNudge(app) {
    const DEFAULT = { dx: 0, dy: 0, rot: 0, s: 1 };
    app.nudgeOf = (sel) => {
      const cuts = S.cutsOf(sel, app.plan);
      const cut = app.plan && app.plan.cuts.find((c) => c.key === cuts[0]);
      const n = cut && cut.els && cut.els.text && cut.els.text.nudge;
      return Object.assign({}, DEFAULT, n || {});
    };
    app.beginNudge = (sel) => {
      const path = sel.scope + ':el.text.nudge';
      const plan = app.plan;                              // the pin goes where the cut's pins live (F.pinCmd, §4.10.4)
      const gesture = app.store.gesture('nudge:' + path);
      return {
        set(v) { app.dispatch(F.pinCmd(path, v, plan, app.svc.pinSig), { label: ['undo.nudge', {}], mergeKey: 'nudge:' + path }); },
        end() { gesture.end(); },
      };
    };
  }

  // ===============================================================================================================
  // Actions (buttons, keys, menus and tests share them).
  // ===============================================================================================================

  function defineActions(app) {
    const { view, store, t } = app;
    const def = (id, run, extra) => A.defineAction(Object.assign({ id, label: 'cmd.' + id, run }, extra || {}));
    const hasLines = () => !!(app.plan && app.plan.lines.length);
    const editor = () => app.shell.steps.bodies.lyrics.editor;
    const selLines = () => {
      const s = S.validate(view.state.sel, app.plan);
      if (s.level === 'line') return s.ids;
      const l = S.lineOfSel(s);
      return l ? [l] : [];
    };

    def('play.toggle', () => (view.state.playing ? app.pause() : app.play()), { enabled: hasLines });
    def('seek.step', (c, a) => {
      app.pause();
      const d = a && a.seconds ? a.seconds : (a && a.frames ? a.frames : 1) * FRAME;
      app.seek(app.time() + d);
    });
    def('seek.edge', (c, a) => { app.pause(); app.seek(a && a.to === 'end' ? (app.plan ? app.plan.duration : 0) : 0); });
    def('sel.line', (c, a) => app.select(S.nextLine(view.state.sel, app.plan, a ? a.d : 1), { from: 'key' }), { enabled: hasLines });
    def('sel.cut', (c, a) => app.select(S.nextCut(view.state.sel, app.plan, a ? a.d : 1), { from: 'key' }), { enabled: hasLines });
    def('sel.down', () => app.select(S.down(view.state.sel, app.plan), { from: 'key' }), { enabled: hasLines });
    def('sel.up', () => {
      const s = view.state.sel;
      if (s.level === 'work') {
        if (view.state.panel) { app.closePanel(); return true; }
        if (app.inText()) { document.activeElement.blur(); return true; }
        return false;
      }
      app.select(S.up(s, app.plan), { from: 'key', seek: false });
      return true;
    });

    def('look.omakase', () => omakase(app), { enabled: hasLines });
    def('look.reroll', () => reroll(app), { enabled: hasLines });
    def('look.prev', () => stepLook(app, LK.prev), { enabled: () => hasLines() && !!LK.prev(store.side, app.doc) });
    def('look.next', () => stepLook(app, LK.next), { enabled: () => hasLines() && !!LK.next(store.side, app.doc) });
    def('looks.open', () => {
      app.select(S.WORK, { from: 'header', open: true });
      if (app.inspector) app.inspector.openSection('looks');                // WP8b: 作品全体 › 試した見た目
    });
    def('look.details', () => app.select(S.WORK, { from: 'header', open: true }));
    def('lock.toggle', () => toggleLock(app, selLines()), { enabled: () => selLines().length > 0 });
    def('look.copy', () => {
      const scope = S.scopeOf(view.state.sel, app.plan);
      if (scope === 'work') return false;
      app.clipboard = scope;
      app.toast(t('toast.lookCopied'));
      return true;
    });
    def('look.paste', () => pasteLook(app), { enabled: () => !!app.clipboard });

    def('tap.start', () => app.tap.start(), { enabled: hasLines });
    def('tap.mark', (c, a) => app.tap.mark(a));
    def('tap.end', (c, a) => app.tap.end(a));
    def('tap.back', () => app.tap.back());
    def('tap.seek', (c, a) => app.tap.seekBy(a));
    def('tap.pause', () => app.tap.pause());
    def('tap.finish', () => app.tap.finish());

    def('time.pinStart', () => {
      const ids = selLines();
      if (!ids.length) return false;
      app.dispatch({ t: 'pin.set', path: 'line/' + ids[0] + ':start', v: Math.round(app.time() * 100) / 100, by: 'user' },
        { label: ['undo.pinStart', {}] });
      return true;
    }, { enabled: () => selLines().length > 0 });
    // WP8b: the focused inspector row publishes the path(s) it may clear (several lines: one per line); lock pins
    // stay (Unlock removes them, §3.6), as with the row's ×.
    def('pin.clearField', () => {
      const f = view.state.focusField;
      const paths = (Array.isArray(f) ? f : f ? [f] : []).filter((p) => app.doc.pins[p] && app.doc.pins[p].by !== 'lock');
      if (!paths.length) return false;
      const cmds = paths.map((path) => ({ t: 'pin.clear', path }));
      if (cmds.length === 1) app.dispatch(cmds[0], { label: ['undo.unpin', {}] });
      else app.batch({ label: ['undo.unpin', {}] }, cmds);
      return true;
    });
    def('pin.clearSelection', () => {
      const s = S.validate(view.state.sel, app.plan);
      const scopes = s.level === 'line' ? s.ids.map((id) => 'line/' + id) : [S.scopeOf(s, app.plan)];
      const before = store.rev;
      app.batch({ label: ['undo.unpinAll', {}] }, scopes.map((scope) => ({ t: 'pin.clearUnder', scope })));
      if (store.rev !== before) app.toast(t('toast.unpinned'), { action: { label: t('cmd.edit.undo'), run: () => store.undo() } });
    });
    def('edit.undo', () => { editor().flushTyping(); store.undo(); }, { enabled: () => !!store.peek().undo || editor().isFocused() });
    def('edit.redo', () => { editor().flushTyping(); store.redo(); }, { enabled: () => !!store.peek().redo });

    def('file.new', () => app.io.newWork());
    def('file.open', () => { app.io.open(); });
    def('file.save', () => { app.io.save(); });
    def('file.saveAs', () => { app.io.saveAs(); });
    def('file.saveLrc', () => { app.io.saveLrc(); }, { enabled: hasLines });

    def('play.fromLine', () => {
      const ed = editor();
      const line = ed.isFocused() ? ed.caretLine() : (app.plan && app.plan.lines.find((l) => l.id === selLines()[0]));
      if (!line) return false;
      app.seek(Math.max(0, line.t0 - PLAY_FROM_LEAD));
      app.play();
      return true;
    }, { enabled: hasLines });
    def('lyrics.moveRows', (c, a) => (editor().isFocused() ? editor().moveRows(a ? a.d : 1) : false));
    def('lyrics.emphasis', () => (editor().isFocused() ? editor().emphasis() : false));

    def('step.go', (c, a) => app.goStep(a && a.step ? a.step : 'lyrics'));
    def('panel.details', (c, a) => {
      if (view.state.panel === 'details') app.closePanel(); else app.openPanel('details', a && a.from ? a.from : 'key');
    }, { enabled: () => !view.state.aiReview, checked: () => view.state.panel === 'details' });
    def('panel.ai', (c, a) => {
      if (view.state.panel === 'ai') app.closePanel(); else app.openPanel('ai', a && a.from ? a.from : 'key');
    }, { enabled: () => view.state.prefs.ai, checked: () => view.state.panel === 'ai' });
    def('panel.close', () => app.closePanel());
    const aiTool = (tool) => () => { app.openPanel('ai', 'ai'); app.bus.emit('ai.tool', tool); };
    def('ai.prep', aiTool('prep'), { enabled: () => view.state.prefs.ai });
    def('ai.looks', aiTool('looks'), { enabled: () => view.state.prefs.ai });
    def('ai.align', aiTool('align'), { enabled: () => view.state.prefs.ai && !!app.doc.song });
    def('timeline.toggle', () => view.set({ drawer: !view.state.drawer }), { checked: () => view.state.drawer });
    def('range.in', () => setRange(app, 't0'));
    def('range.out', () => setRange(app, 't1'));
    def('view.compare', () => {
      if (view.state.compare) return false;
      // WP8c: during an AI try-on, B shows the current look (§6.4.10.7); releasing it returns to the try-on.
      const aiTry = app.ai && app.ai.state.tryOn;
      if (!aiTry && !app.prevDoc) return false;
      view.set({ compare: true });
      app.shell.stage.setAlt(aiTry ? app.doc : app.prevDoc, t(aiTry ? 'ai.compareNow' : 'play.compareBadge'));
      app.shell.playbar.updateStrip();
      return true;
    });
    def('audio.mute', () => {
      if (view.state.autoMuted) { view.set({ autoMuted: false }); view.setPref('muted', false); return; }
      view.setPref('muted', !view.state.prefs.muted);
    }, { checked: () => app.isMuted() });
    def('stage.fullscreen', () => app.shell.stage.fullscreen());
    def('region.next', () => app.shell.cycleRegion(1));
    def('region.prev', () => app.shell.cycleRegion(-1));
    def('help.keys', () => showKeys(app));
    def('export.start', () => { app.exportStart(); },
      { enabled: () => hasLines() && !app.exportChecks().some((c) => c.level === 'block') });
    def('export.cancel', () => app.exportCancel());
    for (const pref of ['singleKeys', 'autoFold', 'autoplay', 'ai']) {
      def('pref.' + pref, () => view.setPref(pref, !view.state.prefs[pref]), { checked: () => !!view.state.prefs[pref] });
    }
    def('app.lang', () => {
      app.io.flushNow();                                      // this task: the navigation may end the page first
      window.location.href = app.lang === 'en' ? '../index.html' : 'en/index.html';
    });
  }

  function omakase(app) {
    const doc = app.doc;
    const current = app.svc.previewMood(doc, doc.look.moodSeed);
    let pick = null;
    for (let i = 0; i < OMAKASE_TRIES; i++) {
      pick = { seed: randomU32(), moodSeed: randomU32() };
      if (app.svc.previewMood(doc, pick.moodSeed) !== current) break;
    }
    const before = app.plan;
    app.store.seal();
    app.dispatch({ t: 'look.omakase', seed: pick.seed, moodSeed: pick.moodSeed }, { label: ['undo.omakase', {}] });
    reportKept(app, before, 'work');
  }

  function reroll(app) {
    const s = S.validate(app.view.state.sel, app.plan);
    const scope = S.scopeOf(s, app.plan);
    const before = app.plan;
    // The root and work-scope element pages (全体 › 文字 …) reroll the whole video: no stream reads salts['work'].
    if (scope === 'work') {
      app.dispatch({ t: 'look.seed', seed: randomU32() }, { label: ['undo.rerollAll', {}] });
    } else {
      const lines = s.level === 'line' ? s.ids : [S.lineOfSel(s)].filter(Boolean);
      if (lines.some((id) => app.doc.locks[id])) { app.toast(app.t('toast.lockedNoReroll'), { kind: 'warn' }); return; }
      const keys = s.level === 'line' ? s.ids.map((id) => 'line/' + id) : [scope];
      app.batch({ label: ['undo.reroll', {}] }, keys.map((key) => ({ t: 'salt.bump', key })));
    }
    reportKept(app, before, scope);
  }

  // The one-line planner.diff readout (§6.7), or '' when no part choice changed.
  function diffReadout(app, before, scope) {
    let entries = [];
    try { entries = before && app.plan ? app.svc.diff(before, app.plan) || [] : []; } catch (e) { entries = []; }
    return LK.diffText(LK.diffSummary(entries, app.plan), app.t, { scope });
  }

  // Toast after おまかせ / reroll: what was kept (user pins, locks, AI pins) and the diff readout on a second line.
  function reportKept(app, before, scope) {
    const t = app.t;
    const pins = Object.values(app.doc.pins);
    const p = pins.filter((x) => x.by !== 'lock' && x.by !== 'tap' && x.by !== 'ai').length;
    const ai = pins.filter((x) => x.by === 'ai').length;
    const l = Object.keys(app.doc.locks).length;
    let kept = '';
    if (p || l) kept = t('toast.kept', { p, l }) + (ai ? t('toast.keptAi', { n: ai }) : '');
    else if (ai) kept = t('toast.keptAiOnly', { n: ai });
    const text = [kept, diffReadout(app, before, scope)].filter(Boolean).join('\n');
    if (text) app.toast(text);
  }

  // After undo / redo of a look change (おまかせ, reroll, dice, ◀ ▶): the same readout (§6.7).
  function reportUndoneLook(app, e) {
    if ((e.kind !== 'undo' && e.kind !== 'redo') || !Array.isArray(e.cmds)) return;
    const look = (c) => c && (LK.appendKind(c) !== 'none' || c.t === 'look.restore');
    if (!e.cmds.some(look)) return;
    const text = diffReadout(app, e.before, 'work');
    if (text) app.toast(text);
  }

  function stepLook(app, which) {
    const entry = which(app.store.side, app.doc);
    if (!entry) return false;
    app.dispatch(LK.restoreCmd(entry), { label: ['undo.lookRestore', {}] });
    return true;
  }

  function toggleLock(app, ids) {
    const allLocked = ids.every((id) => app.doc.locks[id]);
    const n = app.store.rev;              // shown with the lock (core/commands takes the revision in the payload)
    const cmds = ids.map((id) => (allLocked ? { t: 'lock.clear', lineId: id }
      : Object.assign({}, app.svc.lockPayload(app.doc, app.plan, id, { registry: app.reg }), { n })));
    app.batch({ label: [allLocked ? 'undo.unlock' : 'undo.lock', { n: ids.length }] }, cmds);
  }

  function pasteLook(app) {
    const s = S.validate(app.view.state.sel, app.plan);
    const to = s.level === 'line' ? s.ids.map((id) => 'line/' + id) : [S.scopeOf(s, app.plan)];
    const targets = to.filter((x) => x !== app.clipboard && x !== 'work');
    if (!targets.length) return false;
    // Cut targets are written under the key their pins already live at (F.writeScope, §4.10.4), with today's text as sig.
    const sigs = {};
    const dest = targets.map((x) => {
      if (!x.startsWith('cut/')) return x;
      const at = F.writeScope(x, app.plan);
      sigs[at.slice(4)] = app.svc.pinSig(app.plan, x.slice(4));
      return at;
    });
    app.dispatch({ t: 'pin.copy', from: F.writeScope(app.clipboard, app.plan), to: dest, sigs }, { label: ['undo.pasteLook', {}] });
    return true;
  }

  function setRange(app, edge) {
    const cur = app.doc.output.range || { t0: 0, t1: app.plan ? app.plan.duration : 0 };
    const r = Object.assign({}, cur, { [edge]: Math.round(app.time() * 100) / 100 });
    if (!(r.t0 < r.t1)) { app.toast(app.t('exp.rangeBad'), { kind: 'warn' }); return; }
    app.dispatch({ t: 'output.set', key: 'range', v: r }, { label: ['undo.range', {}] });
  }

  // The ? sheet: the keymap, generated (transient; closes on Esc or an outside click).
  function showKeys(app) {
    if (app.dialogs) { app.dialogs.keys(); return; }                        // WP8b: the generated sheet in a <dialog>
    const t = app.t;
    const anchor = document.querySelector('[data-act="menu.open"]');
    header.popover(app, anchor, (box) => {
      box.classList.add('keys-sheet');
      box.appendChild(dom.h('div', { class: 'menu-heading', text: t('keys.title') }));
      const seen = new Set();
      const rows = [];
      for (const b of K.KEYMAP) {
        if (b.ctx !== 'global' || seen.has(b.cmd) || !strings['cmd.' + b.cmd]) continue;
        seen.add(b.cmd);
        rows.push(dom.h('div', { class: 'key-row' }, dom.h('span', { class: 'key-cmd', text: t('cmd.' + b.cmd) }),
          dom.h('span', { class: 'key-keys' }, K.keysFor(b.cmd).map((k) => dom.h('kbd', { text: K.display(k, { space: t('key.space') }) })))));
      }
      box.appendChild(dom.h('div', { class: 'key-list', tabindex: '0' }, rows));
    });
  }

  // ===============================================================================================================
  // Keys: one listener resolves every shortcut through the keymap (IME, text and mode guards live in ui/keys).
  // ===============================================================================================================

  const ACTIVATES = 'button, a[href], summary, [role="button"], [role="tab"], [role="radio"], [role="menuitem"], '
    + 'input[type="checkbox"], input[type="radio"]';
  const REPEATABLE = ['seek.step', 'tap.seek', 'sel.line', 'sel.cut'];
  // Header, play bar and step tabs: a button there that got focus from a pointer press leaves Space to the shortcut
  // (play / pause, SPEC §2, §6.9: paste → click おまかせ → Space plays). Focus that came from the keyboard keeps Space as
  // activation. (:focus-visible cannot tell them apart: a key press makes the focused element match it.)
  const POINTER_SPACE = '.region-header, .controls, .step-tabs, .region-rail';

  function installKeys(app) {
    const { view } = app;
    let pressed = null;                       // the control that the latest pointer press focused
    document.addEventListener('pointerdown', (ev) => {
      pressed = ev.target instanceof Element ? ev.target.closest(ACTIVATES) : null;
    }, true);
    document.addEventListener('focusin', (ev) => { if (ev.target !== pressed) pressed = null; }, true);
    const pointerFocused = (el) => el === pressed && !!el.closest(POINTER_SPACE);
    const endCompare = () => {
      if (!view.state.compare) return;
      view.set({ compare: false });
      const aiTry = app.ai && app.ai.state.tryOn;            // WP8c: back to the AI try-on
      app.shell.stage.setAlt(aiTry ? aiTry.doc : null, aiTry ? aiTry.badge : undefined);
      app.shell.playbar.updateStrip();
    };
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Tab') pressed = null;              // focus moves by keyboard from here on
      if (app.popover) return;
      const mode = view.state.mode === 'tap' ? 'tap' : app.paletteOpen ? 'palette' : app.pickerOpen ? 'picker' : 'normal';
      const res = K.resolveKey({
        key: ev.key, code: ev.code, ctrlKey: ev.ctrlKey, shiftKey: ev.shiftKey, altKey: ev.altKey, metaKey: ev.metaKey,
        isComposing: ev.isComposing, keyCode: ev.keyCode, targetKind: dom.targetKind(ev.target),
      }, { mode, singleKeys: view.state.prefs.singleKeys });
      if (!res) return;
      if (res.cmd === 'noop') { ev.preventDefault(); return; }
      // Space / Enter on a focused button keep their native meaning (activation); WP8b: also inside a sub-page (tiles,
      // filter checkboxes), where Enter on a tile picks it through its click.
      const activation = (ev.key === ' ' || ev.key === 'Enter') && (mode === 'normal' || mode === 'picker') && !ev.ctrlKey && !ev.metaKey
        && ev.target instanceof Element && ev.target.closest(ACTIVATES) && !(ev.key === ' ' && pointerFocused(ev.target));
      if (activation) return;
      if (ev.repeat && !REPEATABLE.includes(res.cmd)) { ev.preventDefault(); return; }
      if (!app.actions.has(res.cmd)) return;
      const ran = app.actions.run(res.cmd, Object.assign({}, res.args, { timeStamp: ev.timeStamp, from: 'key' }));
      if (ran) ev.preventDefault();
    });
    document.addEventListener('keyup', (ev) => { if (ev.key === 'b' || ev.key === 'B') endCompare(); });
    window.addEventListener('blur', endCompare);
  }

  // ===============================================================================================================
  // WP8b: UI part 2 mounts — dialogs, menus, palette, the inspector in [data-mount="inspector"] and the timeline in
  // [data-mount="timeline"] (the hooks ui/shell and ui/stage leave for them).
  // ===============================================================================================================

  function mountDetails(app) {
    app.dialogs = dialogs.mount(app);
    app.confirm = (o) => app.dialogs.confirm(o);
    app.menus = menus.mount(app);
    app.palette = palette.mount(app);
    const regions = app.shell.regions;
    const insp = app.shell.panel.root.querySelector('[data-mount="inspector"]');
    if (insp) app.inspector = inspector.mount(app, insp);
    const drawer = regions.stage.querySelector('[data-mount="timeline"]');
    if (drawer) app.timeline = timeline.mount(app, drawer);
    // WP8c: the AI panel in [data-mount="ai"] (app.ai = its controller); the second service's SDK is injected here (§9.2).
    aiProviders.setSDK(window.AnthropicSDK || null);
    const ai = app.shell.panel.root.querySelector('[data-mount="ai"]');
    if (ai) {
      app.aiPanel = aiPanel.mount(app, ai);
      app.ai = app.aiPanel.ctl;
    }
  }

  // prepareDue(center, t) → true when playback at t has moved REPREPARE_S or more from the time the last prepare was
  // centred on (null: none yet). Pure; the Node tests play a fixture with it.
  function prepareDue(center, t) {
    return center === null || Math.abs(t - center) >= REPREPARE_S;
  }

  // Stale preview frames (§4.14, §4.20): a face that finishes loading moves the font book's epoch, and the scenes around
  // the playhead are prepared after seeks and plan changes; both repaint the preview, which may be paused.
  function installPrepare(app) {
    const repaint = () => { if (app.shell) app.shell.stage.invalidate(); };
    const fonts = app.svc.fonts ? app.svc.fonts() : null;
    if (fonts && typeof fonts.on === 'function') fonts.on('epoch', () => { repaint(); app.bus.emit('fonts'); });
    const engine = app.engine;
    if (typeof engine.prepare !== 'function') return;
    let center = null;                            // the playhead time the last prepare was centred on
    const run = (tt) => {
      center = tt;
      Promise.resolve(engine.prepare(Math.max(0, tt - PREPARE_S), tt + PREPARE_S)).then(repaint, () => {});
    };
    const prepare = dom.debounce(() => {
      if (!app.plan || !app.plan.lines.length) return;
      run(app.time());
    }, PREPARE_DEBOUNCE_MS);
    app.bus.on('plan', () => prepare());
    app.view.on((changed) => { if (changed.includes('time') && !app.view.state.playing) prepare(); });
    // While playing, the window follows the playhead (prepareDue), so the scenes and the blurred-glyph sprites of the
    // cuts ahead are ready before they reach the screen (the preview prepare runs in idle slices, and a newer prepare
    // stops the older one). Without this, every cut past the first window was built and its sprites rasterized in the
    // frame that first showed it. It only warms caches: no frame depends on it (§7.1.4).
    app.bus.on('time', (tt) => {
      if (!app.view.state.playing || !app.plan || !app.plan.lines.length) return;
      if (prepareDue(center, tt)) run(tt);
    });
    prepare();
  }

  // ===============================================================================================================
  // start()
  // ===============================================================================================================

  function start() {
    const svc = services();
    const app = createApp(svc);
    const params = new URLSearchParams(window.location.search);
    document.documentElement.lang = app.lang;
    document.title = app.t('app.name');
    document.body.classList.add('mv-body');

    installStore(app);
    installTransport(app);
    installNavigation(app);
    installWork(app);
    installExport(app);
    installNudge(app);
    A.setContext(() => app);
    app.actions = A;
    defineActions(app);
    app.io = projectIo.create(app);
    app.io.begin();
    app.tap = tapUi.mount(app);
    app.replan();
    app.shell = shell.mount(app, document.getElementById('app'));
    mountDetails(app);                                                        // WP8b views (UI part 2)
    app.io.installDrop(app.shell.root);
    installKeys(app);
    installPrepare(app);
    app.bus.on('layout', (res) => {
      if (res.layout === 'stacked' && app.view.state.prefs.hintStacked) {
        app.toast(app.t('hint.narrow'), { kind: 'info' });
        app.view.setPref('hintStacked', false);
      }
    });

    MV.app = app;
    if (params.get('test') === '1') window.__mv = app;

    const restored = params.get('fresh') === '1' ? Promise.resolve(null) : app.io.restore();
    app.ready = restored.then((file) => {
      if (file) {
        app.store.load(file.doc, file.side);                // the 'doc' event re-links the song (syncSong)
      }
      if (!app.plan || !app.plan.lines.length) app.shell.steps.bodies.lyrics.editor.focus();
      return app;
    });
    return app;
  }

  return { start, prepareDue, PREPARE_S, REPREPARE_S };
});
