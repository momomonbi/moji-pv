/* 文字PVメーカー v2 — original work. Tap mode: Space/Enter, the tap button or a press on the preview marks line starts while the song plays; one time.tap on finish (DESIGN §4.11, §6.4.15). */
MV.def('ui/tap', ['ui/dom', 'ui/icons', 'ui/keys', 'ui/selection', 'i18n/t'], (dom, I, K, S, T) => {
  'use strict';

  const { h } = dom;
  const PREROLL = 2;                 // playback starts 2 s before the line
  const SEEK_STEP = 3;
  const KEY_ROWS = [['tap.mark', 'tap.keyMark'], ['tap.end', 'tap.keyEnd'], ['tap.back', 'tap.keyBack'],
    ['tap.seek', 'tap.keySeek'], ['tap.pause', 'tap.keyPause'], ['tap.finish', 'tap.keyFinish']];

  function mount(app) {
    const t = app.t;
    const count = h('span', { class: 'tap-count' });
    const nowLine = h('div', { class: 'tap-now' });
    const nextLine = h('div', { class: 'tap-next' });
    const last = h('div', { class: 'tap-last', role: 'status', 'aria-live': 'polite' });
    // For the mouse and touch: a press is a tap at the press's own time (pointerdown, not the later click). Keys never
    // reach it as a click: in tap mode Space and Enter are the tap.mark shortcut.
    const pad = h('button', { class: 'btn primary tap-pad', type: 'button',
      on: { pointerdown: (ev) => { if (ev.button === 0) mark({ timeStamp: ev.timeStamp }); } } },
    h('span', { class: 'btn-main', text: t('tap.pad') }), h('span', { class: 'btn-hint', text: t('tap.padHint') }));
    const keys = h('dl', { class: 'tap-keys' }, KEY_ROWS.map(([cmd, label]) => [
      h('dt', {}, K.keysFor(cmd, 'tap').map((k) => h('kbd', { text: K.display(k, { space: t('key.space'), enter: 'Enter' }) }))),
      h('dd', { text: t(label) })]));
    const root = h('div', { class: 'step step-tap' },
      h('div', { class: 'step-head' }, h('h2', { class: 'step-title', text: t('tap.title') }), h('span', { class: 'grow' }), count),
      nowLine, nextLine, pad, last, keys,
      h('div', { class: 'row-actions' },
        h('button', { class: 'btn', type: 'button', text: t('tap.backBtn'), on: { click: () => back() } }),
        h('button', { class: 'btn primary', type: 'button', text: t('tap.finishBtn'), on: { click: () => finish() } })));

    let session = null;              // { state (core/tap TapState), byId: Map<lineId, line> }

    function eventTime(args) {
      const stamp = args && typeof args.timeStamp === 'number' ? args.timeStamp : null;
      const raw = stamp !== null && app.player.outputTimeOf ? app.player.outputTimeOf(stamp) : app.player.now();
      return Math.max(0, raw - (app.doc.timing.tapLatency || 0));
    }

    const lineAt = (i) => (session && i >= 0 && i < session.state.lineIds.length ? session.byId.get(session.state.lineIds[i]) : null);

    // Starts at the selected line, else the line at the playhead, else line 1.
    function start() {
      const ls = app.plan ? app.plan.lines : [];
      if (!ls.length) return false;
      const selLine = S.lineOfSel(S.validate(app.view.state.sel, app.plan));
      const tNow = app.time();
      let at = selLine ? ls.findIndex((l) => l.id === selLine) : -1;
      if (at < 0) at = ls.findIndex((l) => l.t0 <= tNow && tNow < l.t1);
      if (at < 0) at = 0;
      session = { state: app.tapCore.tapStart(ls, ls[at].id), byId: new Map(ls.map((l) => [l.id, l])) };
      app.pause();                   // stopped, the player takes the tap clock's length (open-ended without a song)
      if (app.goStep) app.goStep(app.view.state.step);   // the step column shows this panel: unfold it
      last.textContent = '';
      app.view.set({ mode: 'tap' });
      app.seek(Math.max(0, ls[at].t0 - PREROLL));
      app.play();
      update();
      return true;
    }

    function reduce(type, tt) {
      const before = session.state;
      session.state = app.tapCore.tapReduce(session.state, { type, t: tt });
      return session.state !== before;
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
      if (reduce('mark', tt)) announce('tap.marked', lineAt(session.state.current), tt);
      else if (!s.paused && s.cursor < s.lineIds.length) last.textContent = t('tap.tooSoon');
      update();
    }

    function end(args) {
      if (!session || stopped()) return;
      const tt = eventTime(args);
      if (reduce('end', tt)) announce('tap.endMarked', lineAt(session.state.current), tt);
      update();
    }

    // Backspace: forget the last line's mark and step back; playback seeks 2 s before that line.
    function back() {
      if (!session || !reduce('back', app.player.now())) return;
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
      count.textContent = t('tap.progress', position());
      const cur = lineAt(session.state.current);
      const nxt = lineAt(session.state.cursor);
      nowLine.textContent = cur ? cur.text : t('tap.ready');
      nextLine.textContent = nxt ? t('tap.nextLine', { text: nxt.text }) : t('tap.allMarked');
      pad.disabled = !nxt;
      root.classList.toggle('is-paused', !!session.state.paused);
      if (app.shell) app.shell.playbar.updateStrip();
    }

    // The play-bar mode strip while tapping: 「タップ中 12/40 [1行戻る] [終わる]」.
    function strip() {
      if (!session) return null;
      return { kind: 'tap', text: t('tap.strip', position()),
        actions: [{ label: t('tap.backBtn'), run: () => back() }, { label: t('tap.finishBtn'), run: () => finish() }] };
    }

    return { root, start, mark, end, back, seekBy, pause, finish, cancel, strip, active: () => !!session, update };
  }

  return { mount, PREROLL };
});
