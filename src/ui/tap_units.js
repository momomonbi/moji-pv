/* 文字PVメーカー v2 — original work. 1字ずつタップ: tap each sung unit of one line while it loops; one undo step writes the line's start and its character times (歌ハメ, DESIGN_2_2 §6). */
MV.def('ui/tap_units', ['ui/dom', 'ui/icons', 'ui/keys', 'ui/selection', 'i18n/t', 'core/tap', 'planner/sung', 'engine/text/breaker'],
(dom, I, K, S, T, TAP, SU, BR) => {
  'use strict';

  const { h } = dom;
  // The loop: from LOOP_BEFORE s before the line to LOOP_AFTER s after where its singing ends (plan.sung, else its end).
  const LOOP_BEFORE = 1.5;
  const LOOP_AFTER = 0.8;
  const RATES = Object.freeze([[1, 'tapu.rate.1'], [0.75, 'tapu.rate.075'], [0.5, 'tapu.rate.05']]);
  const STEPS = Object.freeze([['mora', 'tapu.step.mora'], ['phrase', 'tapu.step.phrase']]);
  // A pin holds at most 400 pairs (planner/sung): the units and the end.
  const MAX_UNITS = 399;
  const KEY_ROWS = [['tap.mark', 'tapu.keyMark'], ['tap.end', 'tapu.keyEnd'], ['tap.back', 'tapu.keyBack'],
    ['tap.pause', 'tap.keyPause'], ['tap.finish', 'tapu.keyFinish']];

  // unitsFor(text, lang, step) → [{ at, text }]: the sung units (区切り 1字, planner/sung unitsOf) or the starts of the
  // words (言葉, the breaker's phrases); the first always starts at 0 (what comes before a first word goes with it).
  function unitsFor(text, lang, step) {
    const s = String(text);
    let starts;
    if (step === 'phrase') {
      starts = BR.phrases(s, lang).map((r) => r[0]);
      if (!starts.length) starts = [0];
      else if (starts[0] !== 0) starts = [0].concat(starts.slice(1));
    } else starts = Array.from(SU.unitsOf(s, lang).at);
    starts = starts.slice(0, MAX_UNITS);
    return starts.map((a, i) => ({ at: a, text: s.slice(a, i + 1 < starts.length ? starts[i + 1] : s.length).trim() || s.slice(a, a + 1) }));
  }

  // loopOf(line, ls) → { a, b }: the stretch of the song the session plays again and again.
  function loopOf(line, ls) {
    const end = ls && typeof ls.end === 'number' ? ls.end : line.t1;
    return { a: Math.max(0, line.t0 - LOOP_BEFORE), b: Math.max(line.t0, end) + LOOP_AFTER };
  }

  // pinOf(result, text) → the sung.times value of a take: its pairs, plus the end pair where E was pressed.
  function pinOf(result, text) {
    const pairs = result.times.map((p) => [p[0], p[1]]);
    if (result.end !== null) pairs.push([String(text).length, result.end]);
    return pairs;
  }

  function mount(app) {
    const t = app.t;
    const title = h('h2', { class: 'step-title', text: t('tapu.title') });
    const count = h('span', { class: 'tap-count' });
    const chips = h('div', { class: 'tapu-chips', role: 'list' });
    const last = h('div', { class: 'tap-last', role: 'status', 'aria-live': 'polite' });
    const seg = (items, pick, label) => {
      const buttons = items.map(([v, key]) => h('button', { class: 'seg', type: 'button', role: 'radio', 'aria-checked': 'false',
        'data-v': String(v), on: { click: () => pick(v) } }, t(key)));
      return { el: h('div', { class: 'segmented w-seg', role: 'radiogroup', 'aria-label': t(label) }, buttons),
        set(v) { buttons.forEach((b, i) => b.setAttribute('aria-checked', String(items[i][0] === v))); } };
    };
    const stepSeg = seg(STEPS, (v) => restartWith({ step: v }), 'tapu.step');
    const rateSeg = seg(RATES, (v) => setRate(v), 'tapu.rate');
    const controls = h('div', { class: 'tapu-controls' },
      h('label', { class: 'field-label inline', text: t('tapu.step') }), stepSeg.el,
      h('label', { class: 'field-label inline', text: t('tapu.rate') }), rateSeg.el);
    const pad = h('button', { class: 'btn primary tap-pad', type: 'button',
      on: { pointerdown: (ev) => { if (ev.button === 0) mark({ timeStamp: ev.timeStamp }); } } },
    h('span', { class: 'btn-main', text: t('tapu.keyMark') }), h('span', { class: 'btn-hint', text: t('tap.padHint') }));
    const okBtn = h('button', { class: 'btn primary', type: 'button', 'data-act': 'tapu.ok', text: t('tapu.ok'), on: { click: () => finish() } });
    const retryBtn = h('button', { class: 'btn', type: 'button', 'data-act': 'tapu.retry', text: t('tapu.retry'), on: { click: () => retry() } });
    const cancelBtn = h('button', { class: 'btn', type: 'button', 'data-act': 'tapu.cancel', text: t('tapu.cancel'), on: { click: () => cancel() } });
    const keys = h('dl', { class: 'tap-keys' }, KEY_ROWS.map(([cmd, label]) => [
      h('dt', {}, K.keysFor(cmd, 'tap').map((k) => h('kbd', { text: K.display(k, { space: t('key.space'), enter: 'Enter' }) }))),
      h('dd', { text: t(label) })]));
    const root = h('div', { class: 'step step-tap step-tapu' },
      h('div', { class: 'step-head' }, title, h('span', { class: 'grow' }), count),
      h('p', { class: 'note subtle', text: t('tapu.hint') }), chips, controls, pad, last, keys,
      h('div', { class: 'row-actions' }, cancelBtn, retryBtn, okBtn));

    // { lineId, text, lang, step, units, state (core/tap UnitTapState), loop: { a, b }, rate, prevRate }
    let session = null;

    function eventTime(args) {
      const stamp = args && typeof args.timeStamp === 'number' ? args.timeStamp : null;
      const raw = stamp !== null && app.player.outputTimeOf ? app.player.outputTimeOf(stamp) : app.player.now();
      // the latency is wall-clock time; song time runs at the player's rate
      return Math.max(0, raw - (app.doc.timing.tapLatency || 0) * (app.player.rate || 1));
    }

    function reduce(type, tt) {
      const before = session.state;
      session.state = TAP.unitReduce(session.state, { type, t: tt });
      return session.state !== before;
    }

    // start(lineId, { step, rate }) → true when the session started (the line exists and no session runs).
    function start(lineId, opts) {
      const p = app.plan;
      const line = p && lineId ? p.lines.find((l) => l.id === lineId) : null;
      if (session || !line) return false;
      const o = opts || {};
      const step = o.step === 'phrase' ? 'phrase' : 'mora';
      const units = unitsFor(line.text, line.lang, step);
      if (!units.length) return false;
      app.pause();
      const rate = RATES.some((r) => r[0] === o.rate) ? o.rate : 1;
      session = { lineId: line.id, text: line.text, lang: line.lang, step, units, state: TAP.unitStart(units),
        loop: loopOf(line, p.sung ? p.sung.get(line.id) : null), rate, prevRate: app.player.rate || 1 };
      if (app.goStep) app.goStep(app.view.state.step);   // the step column shows this panel: unfold it
      app.view.set({ mode: 'tap' });
      applyRate();
      last.textContent = '';
      drawChips();
      app.seek(session.loop.a);
      app.play();
      update();
      return true;
    }

    function applyRate() {
      if (!session) return;
      try { app.player.rate = session.rate; } catch (e) { /* a player without rates plays at 1 */ }
    }

    function restoreRate(s) {
      try { app.player.rate = s.prevRate; } catch (e) { /* nothing to restore */ }
    }

    // 速さ: the player's rate for the rest of the session (restored when it ends).
    function setRate(v) {
      if (!session) return;
      session.rate = v;
      applyRate();
      update();
    }

    // 区切り: another way to cut the line into steps starts the take again.
    function restartWith(o) {
      if (!session || o.step === session.step) return;
      session.step = o.step;
      session.units = unitsFor(session.text, session.lang, o.step);
      session.state = TAP.unitStart(session.units);
      if (!app.view.state.playing) session.state = TAP.unitReduce(session.state, { type: 'pause', t: 0 });
      drawChips();
      retry();
    }

    // The session follows playback: marks count only while it plays (P, ▶, the song's end); playing again after the
    // loop's end starts the loop again (the take is kept).
    app.view.on((changed, st) => {
      if (!session || !changed.includes('playing')) return;
      if (st.playing && app.time() >= session.loop.b - 0.05) app.seek(session.loop.a);
      if (reduce(st.playing ? 'resume' : 'pause', app.player.now())) update();
    });

    // At the loop's end playback stops and the strip offers 決定 and もう一度: a take is never thrown away by itself.
    app.bus.on('time', (tt) => {
      if (!session || !app.view.state.playing || tt < session.loop.b) return;
      app.pause();
      reduce('loopEnd', tt);
      last.textContent = t('tapu.loopEnd');
      update();
    });

    function stopped() {
      if (app.view.state.playing) return false;
      last.textContent = session.state.atLoopEnd ? t('tapu.loopEnd') : t('tap.stopped');
      return true;
    }

    function mark(args) {
      if (!session || stopped()) return;
      const s = session.state;
      const tt = eventTime(args);
      if (reduce('mark', tt)) last.textContent = session.units[session.state.cursor - 1].text + ' ' + T.fmtTime(tt);
      else if (!s.paused && s.cursor < s.units.length) last.textContent = t('tapu.tooSoon');
      update();
    }

    function end(args) {
      if (!session || stopped()) return;
      const tt = eventTime(args);
      if (reduce('end', tt)) last.textContent = t('tapu.keyEnd') + ' ' + T.fmtTime(tt);
      update();
    }

    // Backspace: forget the end, else the last mark.
    function back() {
      if (!session || !reduce('back', app.player.now())) return;
      update();
    }

    // ←/→ do nothing here: the loop is the whole session.
    function seekBy() {}

    function pause() {
      if (!session) return;
      if (app.view.state.playing) app.pause(); else app.play();
      update();
    }

    // もう一度: every mark forgotten, the loop from its start.
    function retry() {
      if (!session) return;
      reduce('restart', app.player.now());
      last.textContent = '';
      app.seek(session.loop.a);
      if (!app.view.state.playing) app.play();
      update();
    }

    function close() {
      const s = session;
      session = null;
      app.pause();
      restoreRate(s);
      app.view.set({ mode: 'normal' });
      if (app.shell) app.shell.playbar.updateStrip();
      return s;
    }

    // Esc / T / [決定]: with at least two marks, one undo step writes the line's start (time.tap, the first mark) and
    // its character times (a line pin by 'tap'); with fewer, nothing is written.
    function finish() {
      if (!session) return;
      const res = TAP.unitResult(session.state);
      const s = close();
      if (!res) { app.toast(t('tapu.tooFew'), { kind: 'warn' }); return; }
      const n = res.times.length;
      app.store.seal();
      app.batch({ label: ['undo.tapUnits', { n }] }, [
        { t: 'time.tap', marks: [{ lineId: s.lineId, start: res.start }] },
        { t: 'pin.set', path: 'line/' + s.lineId + ':sung.times', v: pinOf(res, s.text), by: 'tap' },
      ]);
      report(s, n);
    }

    // The toast, from the new plan: where the line's 歌ハメ does not come on, it offers 「この行を歌ハメにする」.
    function report(s, n) {
      const ls = app.plan && app.plan.sung ? app.plan.sung.get(s.lineId) : null;
      const action = ls && ls.hame ? null : { label: t('tapu.makeHame'), run: () => makeHame(s.lineId) };
      app.toast(t('tapu.done', { n }), { kind: 'ok', action });
    }

    function makeHame(lineId) {
      const crumb = app.plan ? S.crumbs({ level: 'line', ids: [lineId] }, app.plan).slice(-1)[0] : null;
      app.dispatch({ t: 'pin.set', path: 'line/' + lineId + ':sung.hame', v: true, by: 'user' },
        { label: ['undo.pin', { field: t('fld.hame'), scope: crumb ? t.label(crumb.label) : '' }] });
    }

    // 「やめる」, another project, replaced lines: nothing is written.
    function cancel() {
      if (!session) return;
      close();
    }

    function drawChips() {
      dom.replace(chips, session.units.map((u, i) => h('span', { class: 'tapu-chip', role: 'listitem', 'data-i': String(i), text: u.text })));
    }

    function position() {
      const s = session.state;
      return { i: Math.min(s.cursor + (s.cursor < s.units.length ? 1 : 0), s.units.length), n: s.units.length };
    }

    function update() {
      if (!session) return;
      const s = session.state;
      count.textContent = t('tapu.progress', position());
      Array.from(chips.children).forEach((el, i) => {
        el.classList.toggle('is-done', i < s.cursor);
        el.classList.toggle('is-next', i === s.cursor);
      });
      chips.classList.toggle('is-ended', s.end !== null);
      stepSeg.set(session.step);
      rateSeg.set(session.rate);
      pad.disabled = s.cursor >= s.units.length;
      okBtn.disabled = s.cursor < 2;
      retryBtn.hidden = !s.atLoopEnd;
      root.classList.toggle('is-paused', !!s.paused);
      if (app.shell) app.shell.playbar.updateStrip();
    }

    // The play-bar strip: 「1字ずつタップ 3 / 9 [決定] [もう一度] [やめる]」 (もう一度 at the loop's end).
    function strip() {
      if (!session) return null;
      const s = session.state;
      const actions = [];
      if (s.cursor >= 2) actions.push({ label: t('tapu.ok'), run: () => finish() });
      if (s.atLoopEnd) actions.push({ label: t('tapu.retry'), run: () => retry() });
      actions.push({ label: t('tapu.cancel'), run: () => cancel() });
      return { kind: 'tap', text: t('tapu.title') + ' ' + t('tapu.progress', position()), actions };
    }

    return {
      root, start, mark, end, back, seekBy, pause, finish, cancel, retry, setRate, strip, update, active: () => !!session,
      session: () => (session ? { lineId: session.lineId, step: session.step, rate: session.rate, loop: Object.assign({}, session.loop),
        state: session.state } : null),
    };
  }

  // combine(line, units) → the app's tap panel: the line tapping of ui/tap and this unit mode behind one API. Every
  // key and button goes to the running session; start() / startUnits() refuse while the other mode runs; `root` is
  // the panel of the mode in use (ui/steps shows it). Other members of the line panel pass through.
  function combine(line, units) {
    const cur = () => (units.active() ? units : line);
    const api = Object.assign({}, line, {
      start: (o) => (units.active() ? false : line.start(o)),
      startUnits: (lineId, o) => (line.active() ? false : units.start(lineId, o)),
      mark: (a) => cur().mark(a),
      end: (a) => cur().end(a),
      back: () => cur().back(),
      seekBy: (a) => cur().seekBy(a),
      pause: () => cur().pause(),
      finish: () => cur().finish(),
      cancel: () => { units.cancel(); line.cancel(); },
      strip: () => cur().strip(),
      update: () => cur().update(),
      active: () => line.active() || units.active(),
      mode: () => (units.active() ? 'units' : line.active() ? 'lines' : null),
      units,
    });
    Object.defineProperty(api, 'root', { enumerable: true, get: () => cur().root });
    return api;
  }

  return { mount, combine, unitsFor, loopOf, pinOf, LOOP_BEFORE, LOOP_AFTER, RATES };
});
