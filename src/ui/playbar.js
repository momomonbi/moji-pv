/* 文字PVメーカー v2 — original work. Play bar: transport, time readout, lane with the area bands, look history, おまかせ, mute, drawer toggle, mode strip (DESIGN §6.4.2; DESIGN_2_1 §6.8). */
MV.def('ui/playbar', ['ui/dom', 'ui/icons', 'ui/looks', 'ui/selection', 'ui/timeline', 'planner/areas', 'i18n/t'],
  (dom, I, LK, S, TL, AREAS, T) => {
  'use strict';

  const { h } = dom;
  // Fit levels for a narrow play bar (§6.4.2: every control stays usable): 1 hides the おまかせ key hint, 2 the duration
  // in the time readout, 3 makes おまかせ icon-only (its name stays for screen readers), 4 tightens the spacing.
  const FIT_MAX = 4;
  const TIME_RE = /^\s*(?:(\d+):)?(\d+(?:\.\d*)?)\s*$/;
  const CUT_TOP = 0.2;                 // the cut blocks fill the lane from 20 % to 80 % of its height; the area bands (DESIGN_2_1
  const CUT_BOTTOM = 0.8;              // §6.8) run in the strip above them
  const BAND_INK = Object.freeze(['rgba(240,182,77,0.55)', 'rgba(124,196,255,0.5)']);
  const BAND_ON = '#e2553b';

  function parseTime(text) {
    const m = TIME_RE.exec(String(text).replace('：', ':'));
    if (!m) return null;
    return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
  }

  // base64 → Uint8Array (the 20 Hz loudness digest of the song, §3.2).
  function decodeDigest(b64) {
    try {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return null; }
  }

  function mount(app, stageEl) {
    const t = app.t;
    const lane = h('canvas', { class: 'lane-canvas' });
    const laneBox = h('div', { class: 'lane', role: 'slider', tabindex: '0', 'aria-label': t('play.lane'), title: t('play.lane'), 'aria-valuemin': '0' }, lane);
    const stripText = h('span', { class: 'strip-text', role: 'status' });
    const stripActs = h('span', { class: 'strip-acts' });
    const strip = h('div', { class: 'mode-strip', hidden: true }, stripText, stripActs);
    const laneRow = h('div', { class: 'lane-row' }, laneBox, strip);

    // 最初に戻る (⏮, the Home key's seek.edge): the way back to 0:00 a beginner can see, next to 再生
    const startBtn = h('button', { class: 'pbtn to-start', type: 'button', 'data-ctl': 'toStart' });
    const playBtn = h('button', { class: 'pbtn play', type: 'button', 'data-act': 'play.toggle' });
    const timeBtn = h('button', { class: 'time-readout', type: 'button', title: t('play.timeTip') });
    const timeInput = h('input', { class: 'time-input', type: 'text', hidden: true, 'aria-label': t('play.timeInput'), spellcheck: false });
    const prevBtn = h('button', { class: 'pbtn', type: 'button', 'data-act': 'look.prev' }, I.icon('prev'));
    const histBtn = h('button', { class: 'hist-pos', type: 'button', 'data-act': 'looks.open' });
    const nextBtn = h('button', { class: 'pbtn', type: 'button', 'data-act': 'look.next' }, I.icon('next'));
    const omakase = h('button', { class: 'omakase', type: 'button', 'data-act': 'look.omakase', 'aria-label': t('play.omakase') },
      I.icon('omakase', { size: 20 }), h('span', { class: 'omakase-label', text: t('play.omakase') }), h('kbd', { class: 'omakase-key', text: 'R' }));
    const muteBtn = h('button', { class: 'pbtn', type: 'button', 'data-act': 'audio.mute' });
    const tlBtn = h('button', { class: 'pbtn', type: 'button', 'data-act': 'timeline.toggle', 'aria-pressed': 'false',
      title: t('cmd.timeline.toggle') + ' (Shift+T)', 'aria-label': t('cmd.timeline.toggle') }, I.icon('timeline'));
    const controls = h('div', { class: 'controls', role: 'toolbar', 'aria-label': t('play.toolbar') },
      h('div', { class: 'ctl-group' }, startBtn, playBtn, timeBtn, timeInput),
      h('span', { class: 'grow' }),
      h('div', { class: 'ctl-group hist' }, prevBtn, histBtn, nextBtn),
      omakase,
      h('div', { class: 'ctl-group' }, muteBtn, tlBtn));
    stageEl.append(laneRow, controls);

    const lctx = lane.getContext('2d');
    let digestCache = { key: null, data: null };
    let fitKey = '';
    let sizeKey = '';                       // layout + tier + width: the CSS sizes the row depends on
    let timeChars = 0;
    let flashTimer = 0;
    let flashing = null;

    dom.on(controls, 'click', '[data-act]', (ev, b) => app.actions.run(b.dataset.act, { from: 'playbar' }));
    startBtn.addEventListener('click', () => app.actions.run('seek.edge', { to: 'start', from: 'playbar' }));
    timeBtn.addEventListener('click', () => {
      timeInput.value = T.fmtTime(app.time());
      timeBtn.hidden = true;
      timeInput.hidden = false;
      timeInput.select();
      dom.focus(timeInput);
    });
    timeInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        const v = parseTime(timeInput.value);
        if (v !== null) app.seek(v);
        closeTimeInput();
        ev.preventDefault();
      } else if (ev.key === 'Escape') { closeTimeInput(); ev.preventDefault(); ev.stopPropagation(); }
    });
    timeInput.addEventListener('blur', closeTimeInput);
    function closeTimeInput() {
      if (timeInput.hidden) return;
      timeInput.hidden = true;
      timeBtn.hidden = false;
      if (document.activeElement === timeInput || !document.activeElement || document.activeElement === document.body) dom.focus(timeBtn);
    }

    // --- lane: click = seek, drag = scrub, double-click = select the line (on the band strip: the area) ------------

    function timeAt(ev) {
      const r = lane.getBoundingClientRect();
      const d = duration();
      return Math.max(0, Math.min(d, (ev.clientX - r.left) / Math.max(1, r.width) * d));
    }
    let scrubbing = false;
    laneBox.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      scrubbing = true;
      laneBox.setPointerCapture(ev.pointerId);
      app.seek(timeAt(ev));
    });
    laneBox.addEventListener('pointermove', (ev) => { if (scrubbing) app.seek(timeAt(ev)); });
    laneBox.addEventListener('pointerup', () => { scrubbing = false; });
    laneBox.addEventListener('dblclick', (ev) => {
      const tt = timeAt(ev);
      const plan = app.plan;
      const r = lane.getBoundingClientRect();
      const band = ev.clientY - r.top < r.height * CUT_TOP ? TL.bandAt(bands(), tt) : null;
      if (band) { app.select(S.areaSel(band.area), { from: 'timeline', open: true }); return; }
      const line = plan && plan.lines.find((l) => l.t0 <= tt && tt < l.t1) || plan && plan.lines.slice().reverse().find((l) => l.t0 <= tt);
      if (line) app.select({ level: 'line', ids: [line.id] }, { from: 'timeline', open: true });
    });

    function duration() {
      const plan = app.plan;
      return plan && plan.duration > 0 ? plan.duration : 1;
    }

    function layout(res) {
      const st = res.rects.stage;
      const ln = res.rects.lane;
      const ct = res.rects.controls;
      dom.place(laneRow, { x: ln.x - st.x, y: ln.y - st.y, w: ln.w, h: ln.h });
      dom.place(controls, { x: ct.x - st.x, y: ct.y - st.y, w: ct.w, h: ct.h });
      sizeKey = res.layout + ':' + res.tier + ':' + ct.w;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      lane.width = Math.max(1, Math.round(ln.w * dpr));
      lane.height = Math.max(1, Math.round(ln.h * dpr));
      dom.setStyle(lane, { width: ln.w, height: ln.h });
      drawLane();
      updateControls();
    }

    // Steps down the fit levels until the row fits its rect. Measures only when something that changes the row's
    // width changed (its rect, shown buttons, texts).
    function fit() {
      const key = [sizeKey, histBtn.hidden, histBtn.textContent, muteBtn.hidden,
        omakase.querySelector('.omakase-key').textContent, timeBtn.textContent.length].join('|');
      if (key === fitKey) return;
      fitKey = key;
      let level = 0;
      controls.dataset.fit = '0';
      while (level < FIT_MAX && controls.scrollWidth > controls.clientWidth + 0.5) {
        level += 1;
        controls.dataset.fit = String(level);
      }
    }

    // --- lane drawing ------------------------------------------------------------------------------------------

    // The area bands (DESIGN_2_1 §6.8, planner/areas.bands: song sections, else headings, else blocks), each with its
    // resolved area; remembered per plan, lyric rows and song analysis, as the timeline drawer does.
    let bandMemo = { plan: null, rows: null, info: null, list: [] };
    function bands() {
      const p = app.plan;
      if (!p || !p.lines || !p.lines.length) return [];
      const rows = app.doc.sheet.rows, info = app.doc.song ? app.doc.song.info : null;
      if (bandMemo.plan !== p || bandMemo.rows !== rows || bandMemo.info !== info) {
        let list = [];
        try {
          list = AREAS.bands(app.doc, p).map((b) => Object.assign({}, b, { area: AREAS.resolve(app.doc, p, b.ref) })).filter((b) => b.area);
        } catch (e) { list = []; }
        bandMemo = { plan: p, rows, info, list };
      }
      return bandMemo.list;
    }

    function digestOf(song) {
      if (!song || !song.digest || typeof song.digest.loud !== 'string') return null;
      const key = song.sha1 + ':' + song.digest.loud.length;
      if (digestCache.key !== key) digestCache = { key, data: decodeDigest(song.digest.loud) };
      return digestCache.data;
    }

    function hatch(x0, x1, top, bottom) {
      lctx.save();
      lctx.beginPath();
      lctx.rect(x0, top, x1 - x0, bottom - top);
      lctx.clip();
      lctx.strokeStyle = 'rgba(255,255,255,0.28)';
      lctx.lineWidth = 1;
      for (let x = x0 - (bottom - top); x < x1; x += 6) {
        lctx.beginPath(); lctx.moveTo(x, bottom); lctx.lineTo(x + (bottom - top), top); lctx.stroke();
      }
      lctx.restore();
    }

    function edge(x, top, bottom, pinned, dpr) {
      lctx.save();
      lctx.strokeStyle = pinned ? '#f2efe8' : 'rgba(242,239,232,0.55)';
      lctx.lineWidth = (pinned ? 2 : 1) * dpr;
      lctx.setLineDash(pinned ? [] : [2 * dpr, 2 * dpr]);
      lctx.beginPath(); lctx.moveTo(x, top); lctx.lineTo(x, bottom); lctx.stroke();
      lctx.restore();
    }

    function drawLane() {
      const W = lane.width, H = lane.height;
      const dpr = W / Math.max(1, lane.clientWidth || W);
      const plan = app.plan;
      const d = duration();
      const x = (tt) => tt / d * W;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, W, H);
      lctx.fillStyle = '#12151b';
      lctx.fillRect(0, 0, W, H);
      const doc = app.doc;
      const range = doc.output.range;
      if (range) { lctx.fillStyle = 'rgba(124,196,255,0.12)'; lctx.fillRect(x(range.t0), 0, x(range.t1) - x(range.t0), H); }
      const loud = digestOf(doc.song);
      if (loud && loud.length) {
        const hz = doc.song.digest.hz || 20;
        lctx.fillStyle = 'rgba(160,168,184,0.28)';
        const step = Math.max(1, Math.floor(dpr * 2));
        for (let px = 0; px < W; px += step) {
          const i = Math.min(loud.length - 1, Math.floor(px / W * d * hz));
          const a = loud[i] / 255 * (H * 0.46);
          lctx.fillRect(px, H / 2 - a, Math.max(1, step - 1), 2 * a);
        }
      }
      if (!plan) return;
      const sel = S.validate(app.view.state.sel, plan, doc);
      const selCuts = new Set(S.cutsOf(sel, plan));
      const hl = TL.highlighted(app.view.state.highlight);
      const top = Math.round(H * CUT_TOP), bottom = Math.round(H * CUT_BOTTOM);
      const selKey = sel.level === 'line' && sel.area ? AREAS.keyOf(sel.area) : null;
      bands().forEach((b, i) => {
        const x0 = x(b.t0), x1 = Math.max(x0 + 1, x(b.t1) - dpr);
        lctx.fillStyle = b.key === selKey ? BAND_ON : BAND_INK[i % 2];
        lctx.fillRect(x0, 0, x1 - x0, Math.max(1, top - dpr));
      });
      const lineOf = new Map(plan.lines.map((l) => [l.id, l]));
      plan.cuts.forEach((c, i) => {
        if (!Number.isFinite(c.t0) || !Number.isFinite(c.t1)) return;
        const x0 = x(c.t0), x1 = Math.max(x0 + 1, x(c.t1) - dpr);
        const special = !c.line;
        const on = selCuts.has(c.key) || hl.has(c.line);
        lctx.fillStyle = special ? 'rgba(255,255,255,0.10)' : on ? '#e2553b' : i % 2 ? '#3b4252' : '#465063';
        lctx.fillRect(x0, top, x1 - x0, bottom - top);
        const line = c.line ? lineOf.get(c.line) : null;
        if (line && line.locked) hatch(x0, x1, top, bottom);
        if (line && line.cuts[0] === c.key) edge(x0, top - 2 * dpr, bottom + 2 * dpr, line.by && line.by.start !== 'auto', dpr);
      });
      const tp = x(app.time());
      lctx.fillStyle = '#f2efe8';
      lctx.fillRect(Math.round(tp - dpr), 0, Math.max(2, Math.round(2 * dpr)), H);
      lctx.beginPath();
      lctx.moveTo(tp - 5 * dpr, 0); lctx.lineTo(tp + 5 * dpr, 0); lctx.lineTo(tp, 6 * dpr); lctx.closePath(); lctx.fill();
      laneBox.setAttribute('aria-valuemax', String(Math.round(d * 100) / 100));
      laneBox.setAttribute('aria-valuenow', String(Math.round(app.time() * 100) / 100));
      laneBox.setAttribute('aria-valuetext', T.fmtTime(app.time()));
    }

    // --- controls ----------------------------------------------------------------------------------------------

    function setIconLabel(button, iconName, label, extraTitle) {
      dom.replace(button, I.icon(iconName));
      button.setAttribute('aria-label', label);
      button.title = extraTitle ? label + ' (' + extraTitle + ')' : label;
    }

    // 再生 / 一時停止, and 最初から再生 (↻) once the playhead stands at the end: ▶ there starts again from 0:00. Redrawn
    // only when that state changes (onTime runs every frame while playing).
    let playKey = '';
    function updatePlay() {
      const vs = app.view.state;
      const end = typeof app.clockEnd === 'function' ? app.clockEnd() : 0;
      const state = vs.playing ? 'pause' : end > 0 && vs.time >= end - 0.05 ? 'replay' : 'play';
      if (state === playKey) return;
      playKey = state;
      setIconLabel(playBtn, state, t('play.' + state), t('key.space'));
    }

    function updateTime() {
      const d = app.plan ? app.plan.duration : 0;
      timeBtn.textContent = '';
      timeBtn.append(h('span', { class: 'now', text: T.fmtTime(app.time()) }), h('span', { class: 'dur', text: ' / ' + T.fmtTime(d) }));
      if (timeBtn.textContent.length !== timeChars) { timeChars = timeBtn.textContent.length; fit(); }
    }

    function updateControls() {
      const vs = app.view.state;
      const hasLines = !!(app.plan && app.plan.lines.length);
      playKey = '';
      updatePlay();
      setIconLabel(startBtn, 'toStart', t('play.toStart'), 'Home');
      startBtn.disabled = !hasLines;
      playBtn.disabled = !hasLines;
      if (!hasLines) playBtn.title = t('play.needLyrics');
      updateTime();
      const side = app.store.side;
      const ptr = LK.pointer(side, app.doc);
      const show = ptr.total > 1 || ptr.modified;
      histBtn.hidden = !show;
      histBtn.textContent = ptr.modified ? '●/' + ptr.total : (ptr.index || 0) + '/' + ptr.total;
      histBtn.title = ptr.modified ? t('play.histModified') : t('play.histPos', { i: ptr.index || 0, n: ptr.total });
      histBtn.setAttribute('aria-label', histBtn.title);
      prevBtn.disabled = !hasLines || !LK.prev(side, app.doc);
      nextBtn.disabled = !hasLines || !LK.next(side, app.doc);
      prevBtn.title = t('cmd.look.prev') + ' ([)';
      nextBtn.title = t('cmd.look.next') + ' (])';
      prevBtn.setAttribute('aria-label', t('cmd.look.prev'));
      nextBtn.setAttribute('aria-label', t('cmd.look.next'));
      omakase.disabled = !hasLines;
      omakase.title = hasLines ? t('play.omakaseTip') + ' (' + (app.inText() ? 'Ctrl+Shift+Enter' : 'R') + ')' : t('play.needLyrics');
      omakase.querySelector('.omakase-key').textContent = app.inText() ? 'Ctrl+Shift+Enter' : 'R';
      muteBtn.hidden = !app.doc.song;
      const muted = app.isMuted ? app.isMuted() : vs.prefs.muted;
      setIconLabel(muteBtn, muted ? 'muted' : 'sound', muted ? t('play.unmute') : t('play.mute'), 'M');
      tlBtn.setAttribute('aria-pressed', String(vs.drawer));
      updateStrip();
      fit();
    }

    // --- mode strip (tap / try-on) and flashed messages --------------------------------------------------------

    function updateStrip() {
      const st = flashing || (app.modeStrip ? app.modeStrip() : null);
      strip.hidden = !st;
      laneBox.hidden = !!st;
      if (!st) return;
      stripText.textContent = st.text;
      dom.replace(stripActs, (st.actions || []).map((a) => h('button', { class: 'btn small', type: 'button',
        on: { click: a.run } }, a.label)));
      strip.dataset.kind = st.kind || 'mode';
    }

    function flash(text, ms) {
      flashing = { text, kind: 'toast' };
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => { flashing = null; updateStrip(); }, ms || 4000);
      updateStrip();
    }

    function onTime() { updateTime(); updatePlay(); drawLane(); }

    app.bus.on('time', onTime);
    app.bus.on('plan', () => { drawLane(); updateControls(); });
    app.bus.on('side', updateControls);
    app.bus.on('focus', updateControls);
    app.view.on((changed) => {
      if (changed.some((k) => ['playing', 'prefs', 'drawer', 'mode', 'autoMuted'].includes(k))) updateControls();
      if (changed.includes('sel') || changed.includes('highlight') || changed.includes('time')) onTime();
    });

    return {
      layout, update: updateControls, flash, updateStrip, pulseOmakase() {
        if (dom.prefersReducedMotion()) return;
        omakase.classList.remove('pulse');
        void omakase.offsetWidth;
        omakase.classList.add('pulse');
      },
      omakaseButton: omakase, controls, parseTime,
    };
  }

  return { mount, parseTime };
});
