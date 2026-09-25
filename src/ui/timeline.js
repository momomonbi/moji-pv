/* 文字PVメーカー v2 — original work. Timeline drawer: beat / song / line / cut rows, drags that write time pins, zoom, snap, keyboard nudges, a11y proxies (DESIGN §6.4.13). */
MV.def('ui/timeline', ['ui/dom', 'ui/icons', 'ui/selection', 'ui/fields', 'i18n/t', 'core/paths', 'core/doc'], (dom, I, S, F, T, P, D) => {
  'use strict';

  const { h } = dom;
  const EDGE_PX = 6;
  const SNAP_PX = 7;
  const DRAG_PX = 4;
  const ZOOM = 1.6;
  const MIN_SPAN = 2;
  const MIN_LEN = 0.1;
  const RULER_PX = 15;
  const COLORS = { bg: '#101318', row: '#161a21', line: '#465063', line2: '#3b4252', sel: '#e2553b', cut: '#343b48',
    text: '#eceae5', muted: '#8e94a1', beat: 'rgba(242,239,232,0.18)', bar: 'rgba(242,239,232,0.45)', play: '#f2efe8',
    range: 'rgba(124,196,255,0.14)', focus: '#7cc4ff', wave: 'rgba(160,168,184,0.35)', section: 'rgba(240,182,77,0.16)',
    highlight: '#f0b64d', mark: '#c9b27a' };

  function decodeDigest(b64) {
    try {
      const bin = atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch (e) { return null; }
  }

  // Nice ruler steps in seconds.
  const STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

  // songMarks(info) → { sections: [{ t0, t1, kind }], highlights: [t] } from doc.song.info (§4.22: sections
  // { kind, start, end }, highlights { time, what }); unknown kinds read as 'other', unreadable entries are skipped.
  function songMarks(info) {
    const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    const sections = [];
    for (const s of (info && Array.isArray(info.sections) ? info.sections : [])) {
      const t0 = s ? num(s.start) : null, t1 = s ? num(s.end) : null;
      if (t0 === null || t1 === null || t1 <= t0) continue;
      sections.push({ t0, t1, kind: D.SECTION_KINDS.includes(s.kind) ? s.kind : 'other' });   // core/doc validates the same list
    }
    const highlights = [];
    for (const hl of (info && Array.isArray(info.highlights) ? info.highlights : [])) {
      const at = typeof hl === 'number' ? num(hl) : hl ? num(hl.time) : null;
      if (at !== null) highlights.push(at);
    }
    return { sections, highlights };
  }

  // The kind of a line edge: 'pin' (solid), 'lrc' (the stamp in the text: a mark, solid and muted), 'auto' (dashed).
  function edgeKind(by) { return by === 'pin' || by === 'lrc' ? by : 'auto'; }

  function mount(app, host) {
    const t = app.t;
    const snapBtn = h('button', { class: 'chip-btn tl-btn', type: 'button', 'aria-pressed': 'false' }, t('song.snap'));
    const bpmBtn = h('button', { class: 'chip-btn tl-btn', type: 'button', title: t('tl.bpmTip') });
    const zoomOut = h('button', { class: 'icon-btn small', type: 'button', title: t('tl.zoomOut'), 'aria-label': t('tl.zoomOut') }, '−');
    const fit = h('button', { class: 'chip-btn tl-btn', type: 'button' }, t('tl.fit'));
    const zoomIn = h('button', { class: 'icon-btn small', type: 'button', title: t('tl.zoomIn'), 'aria-label': t('tl.zoomIn') }, I.icon('plus', { size: 14 }));
    const followBtn = h('button', { class: 'chip-btn tl-btn', type: 'button', 'aria-pressed': 'false' }, t('tl.follow'));
    const bar = h('div', { class: 'tl-bar', role: 'toolbar', 'aria-label': t('tl.label') }, h('span', { class: 'tl-title', text: t('tl.label') }),
      snapBtn, bpmBtn, h('span', { class: 'tl-zoom' }, zoomOut, fit, zoomIn), h('span', { class: 'grow' }), followBtn);
    const canvas = h('canvas', { class: 'tl-canvas', 'aria-hidden': 'true' });
    const proxy = h('div', { class: 'sr-only tl-proxy', role: 'listbox', tabindex: '0', 'aria-label': t('tl.lines') });
    const area = h('div', { class: 'tl-area' }, canvas, proxy);
    const root = h('div', { class: 'timeline' }, bar, area);
    dom.replace(host, root);

    const g = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    let view = { t0: 0, span: 0 };               // visible window; span 0 = fit
    let press = null;
    let focus = { lineId: null, edge: 'start' }; // the edge Ctrl+←/→ nudges
    let digest = { key: null, data: null };

    // --- geometry -----------------------------------------------------------------------------------------------

    const duration = () => (app.plan && app.plan.duration > 0 ? app.plan.duration : 1);
    function win() {
      const d = duration();
      const span = view.span > 0 ? Math.min(view.span, d) : d;
      const t0 = Math.max(0, Math.min(view.t0, d - span));
      return { t0, span };
    }
    const xOf = (tt) => { const w = win(); return (tt - w.t0) / w.span * W; };
    const tOf = (x) => { const w = win(); return w.t0 + x / Math.max(1, W) * w.span; };

    function rows() {
      const body = Math.max(40, H - RULER_PX);
      const beat = Math.round(body * 0.12), song = Math.round(body * 0.28), line = Math.round(body * 0.32);
      return { beat: [0, beat], song: [beat, beat + song], line: [beat + song, beat + song + line], cut: [beat + song + line, body],
        ruler: [body, H] };
    }

    function layout() {
      const r = area.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, Math.round(r.width));
      H = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      dom.setStyle(canvas, { width: W, height: H });
      draw();
    }

    // --- drawing ------------------------------------------------------------------------------------------------

    function digestOf(song) {
      if (!song || !song.digest || typeof song.digest.loud !== 'string') return null;
      const key = song.sha1 + ':' + song.digest.loud.length;
      if (digest.key !== key) digest = { key, data: decodeDigest(song.digest.loud) };
      return digest.data;
    }

    function hatch(x0, x1, y0, y1) {
      g.save();
      g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
      g.strokeStyle = 'rgba(255,255,255,0.3)';
      g.lineWidth = 1;
      for (let x = x0 - (y1 - y0); x < x1; x += 6) { g.beginPath(); g.moveTo(x, y1); g.lineTo(x + (y1 - y0), y0); g.stroke(); }
      g.restore();
    }

    // §6.4.2: pinned edges solid, auto edges dashed; an LRC stamp (a text mark) is solid but thin and muted.
    function edge(x, y0, y1, kind, focused) {
      g.save();
      g.strokeStyle = focused ? COLORS.focus : kind === 'pin' ? COLORS.text : kind === 'lrc' ? COLORS.mark : 'rgba(242,239,232,0.5)';
      g.lineWidth = focused ? 3 : kind === 'pin' ? 2 : 1;
      g.setLineDash(kind === 'auto' && !focused ? [3, 3] : []);
      g.beginPath(); g.moveTo(x, y0); g.lineTo(x, y1); g.stroke();
      g.restore();
    }

    let fontCss = null;
    function label(text, x, y, maxW, color) {
      if (maxW < 18) return;
      if (!fontCss) fontCss = '11px ' + getComputedStyle(document.body).fontFamily;
      g.fillStyle = color || COLORS.text;
      g.font = fontCss;
      g.textBaseline = 'middle';
      let s = text;
      while (s.length > 1 && g.measureText(s).width > maxW) s = s.slice(0, -2) + '…';
      g.fillText(s, x, y);
    }

    function drawBeats(r) {
      const b = app.plan && app.plan.beats;
      if (!b || !b.bpm) { label(t('tl.noBeats'), 6, (r[0] + r[1]) / 2, W - 12, COLORS.muted); return; }
      const period = 60 / b.bpm;
      const w = win();
      if (period / w.span * W < 3) return;
      const k0 = Math.ceil((w.t0 - b.offset) / period);
      for (let k = k0; ; k++) {
        const tt = b.offset + k * period;
        if (tt > w.t0 + w.span) break;
        const isBar = ((k % (b.meter || 4)) + (b.meter || 4)) % (b.meter || 4) === 0;
        g.fillStyle = isBar ? COLORS.bar : COLORS.beat;
        g.fillRect(Math.round(xOf(tt)), r[0] + (isBar ? 1 : 4), 1, r[1] - r[0] - (isBar ? 2 : 6));
      }
    }

    function drawSong(r) {
      const song = app.doc.song;
      const loud = digestOf(song);
      const mid = (r[0] + r[1]) / 2, half = (r[1] - r[0]) / 2 - 2;
      if (loud && loud.length) {
        const hz = song.digest.hz || 20;
        g.fillStyle = COLORS.wave;
        for (let x = 0; x < W; x += 2) {
          const i = Math.min(loud.length - 1, Math.max(0, Math.floor(tOf(x) * hz)));
          const a = loud[i] / 255 * half;
          g.fillRect(x, mid - a, 1, 2 * a);
        }
      } else label(t('tl.noSong'), 6, mid, W - 12, COLORS.muted);
      const marks = songMarks(song && song.info);
      for (const s of marks.sections) {
        const x0 = xOf(s.t0), x1 = xOf(s.t1);
        if (x1 < 0 || x0 > W) continue;
        g.fillStyle = COLORS.section;
        g.fillRect(x0, r[0] + 1, Math.max(1, x1 - x0), r[1] - r[0] - 2);
        label(t('songSec.' + s.kind), x0 + 4, r[0] + 8, x1 - x0 - 8, COLORS.muted);
      }
      g.fillStyle = COLORS.highlight;
      for (const at of marks.highlights) g.fillRect(xOf(at) - 1, r[0], 2, r[1] - r[0]);
    }

    function drawLines(r, sel) {
      const p = app.plan;
      const selLines = new Set(sel.level === 'line' ? sel.ids : [S.lineOfSel(sel)].filter(Boolean));
      p.lines.forEach((l, i) => {
        const x0 = xOf(l.t0), x1 = xOf(l.t1);
        if (x1 < 0 || x0 > W) return;
        const on = selLines.has(l.id) || app.view.state.highlight === l.id;
        g.fillStyle = on ? COLORS.sel : i % 2 ? COLORS.line2 : COLORS.line;
        g.fillRect(x0, r[0] + 3, Math.max(1, x1 - x0 - 1), r[1] - r[0] - 6);
        if (l.locked) hatch(x0, x1, r[0] + 3, r[1] - 3);
        label((i + 1) + ' ' + l.text, Math.max(x0, 0) + 4, (r[0] + r[1]) / 2, x1 - Math.max(x0, 0) - 8);
        const f = focus.lineId === l.id && document.activeElement === proxy;
        edge(x0, r[0], r[1], edgeKind(l.by && l.by.start), f && focus.edge === 'start');
        edge(x1, r[0] + 4, r[1] - 4, edgeKind(l.by && l.by.end), f && focus.edge === 'end');
      });
    }

    function drawCuts(r, sel) {
      const p = app.plan;
      const selCuts = new Set(S.cutsOf(sel, p));
      p.cuts.forEach((c) => {
        const x0 = xOf(c.t0), x1 = xOf(c.t1);
        if (x1 < 0 || x0 > W) return;
        g.fillStyle = selCuts.has(c.key) ? COLORS.sel : c.line ? COLORS.cut : 'rgba(255,255,255,0.08)';
        g.fillRect(x0, r[0] + 3, Math.max(1, x1 - x0 - 1), r[1] - r[0] - 6);
        const line = c.line ? p.lines.find((l) => l.id === c.line) : null;
        const k = line ? line.cuts.indexOf(c.key) + 1 : 0;
        label(line ? line.index + 1 + '-' + k : t.label(S.crumbs({ level: 'cut', key: c.key }, p).slice(-1)[0].label), x0 + 3,
          (r[0] + r[1]) / 2, x1 - x0 - 6, COLORS.muted);
        if (line && k > 1) edge(x0, r[0], r[1], app.doc.pins[F.writePath('cut/' + c.key + ':t0', p)] ? 'pin' : 'auto', false);
      });
    }

    function drawRuler(r) {
      const w = win();
      const step = STEPS.find((s) => s / w.span * W >= 70) || STEPS[STEPS.length - 1];
      g.fillStyle = '#0c0e12';
      g.fillRect(0, r[0], W, r[1] - r[0]);
      for (let tt = Math.ceil(w.t0 / step) * step; tt <= w.t0 + w.span; tt += step) {
        const x = Math.round(xOf(tt));
        g.fillStyle = COLORS.muted;
        g.fillRect(x, r[0], 1, 4);
        label(T.fmtTime(tt).replace(/\.00$/, ''), x + 3, (r[0] + r[1]) / 2 + 1, 80, COLORS.muted);
      }
    }

    function draw() {
      if (!W || host.hidden) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = COLORS.bg;
      g.fillRect(0, 0, W, H);
      const r = rows();
      for (const k of ['beat', 'song', 'line', 'cut']) {
        g.fillStyle = COLORS.row;
        g.fillRect(0, r[k][0] + 1, W, r[k][1] - r[k][0] - 2);
      }
      const range = app.doc.output.range;
      if (range) { g.fillStyle = COLORS.range; g.fillRect(xOf(range.t0), 0, xOf(range.t1) - xOf(range.t0), H); }
      drawBeats(r.beat);
      drawSong(r.song);
      if (app.plan && app.plan.lines.length) {
        const sel = S.validate(app.view.state.sel, app.plan);
        drawLines(r.line, sel);
        drawCuts(r.cut, sel);
      } else label(t('tl.empty'), 8, (r.line[0] + r.cut[1]) / 2, W - 16, COLORS.muted);
      drawRuler(r.ruler);
      const x = xOf(app.time());
      g.fillStyle = COLORS.play;
      g.fillRect(Math.round(x) - 1, 0, 2, H);
      updateBar();
    }

    // --- hit testing ------------------------------------------------------------------------------------------------

    function rowAt(y) {
      const r = rows();
      for (const k of ['beat', 'song', 'line', 'cut', 'ruler']) if (y >= r[k][0] && y < r[k][1]) return k;
      return 'ruler';
    }

    function hitAt(x, y) {
      const row = rowAt(y);
      const p = app.plan;
      if (!p) return { row };
      if (row === 'line') {
        for (const l of p.lines) {
          const x0 = xOf(l.t0), x1 = xOf(l.t1);
          if (Math.abs(x - x0) <= EDGE_PX) return { row, line: l, edge: 'start' };
          if (Math.abs(x - x1) <= EDGE_PX) return { row, line: l, edge: 'end' };
        }
        const l = p.lines.find((x2) => x >= xOf(x2.t0) && x < xOf(x2.t1));
        return l ? { row, line: l, edge: null } : { row };
      }
      if (row === 'cut') {
        for (const c of p.cuts) {
          const line = c.line ? p.lines.find((l) => l.id === c.line) : null;
          if (line && line.cuts.indexOf(c.key) > 0 && Math.abs(x - xOf(c.t0)) <= EDGE_PX) return { row, cut: c, line, edge: 'inner' };
        }
        const c = p.cuts.find((x2) => x >= xOf(x2.t0) && x < xOf(x2.t1));
        return c ? { row, cut: c, line: c.line ? p.lines.find((l) => l.id === c.line) : null } : { row };
      }
      return { row };
    }

    // --- snapping ---------------------------------------------------------------------------------------------------

    function snapTime(tt, ignoreLine, alt) {
      if (alt) return tt;
      const cands = [];
      const b = app.plan && app.plan.beats;
      const mode = app.doc.timing.snap;
      if (b && b.bpm && mode !== 'off') {
        const unit = 60 / b.bpm * (mode === 'half' ? 0.5 : mode === 'bar' ? (b.meter || 4) : 1);
        cands.push(b.offset + Math.round((tt - b.offset) / unit) * unit);
      }
      for (const l of app.plan ? app.plan.lines : []) if (l.id !== ignoreLine) cands.push(l.t0, l.t1);
      cands.push(app.time());
      let best = tt, dist = SNAP_PX / Math.max(1, W) * win().span;
      for (const c of cands) if (Math.abs(c - tt) < dist) { dist = Math.abs(c - tt); best = c; }
      return Math.round(best * 1000) / 1000;
    }

    // --- drags --------------------------------------------------------------------------------------------------------

    function localPoint(ev) {
      const r = canvas.getBoundingClientRect();
      return { x: ev.clientX - r.left, y: ev.clientY - r.top };
    }

    function startGesture(kind, key) {
      press.gesture = app.store.gesture('tl:' + key);
      press.mergeKey = 'tl:' + key;
      press.kind = kind;
      if (app.view.state.playing) app.pause();
    }

    function pinTime(path, v) {
      const cmd = F.pinCmd(path, v, app.plan, app.svc.pinSig);         // where the cut's pins live (§4.10.4)
      app.dispatch(cmd, { label: ['undo.time', {}], mergeKey: press.mergeKey, where: { scope: path.split(':')[0], field: path.split(':')[1] } });
    }

    function dragTo(pt, ev) {
      const tt = tOf(pt.x);
      const hit = press.hit;
      if (press.range) {
        const a = Math.max(0, Math.min(press.t, tt)), b = Math.min(duration(), Math.max(press.t, tt));
        if (b - a > 0.05) {
          app.dispatch({ t: 'output.set', key: 'range', v: { t0: Math.round(a * 100) / 100, t1: Math.round(b * 100) / 100 } },
            { label: ['undo.range', {}], mergeKey: press.mergeKey });
        }
        return;
      }
      if (hit.row === 'line' && hit.line && hit.edge === 'start') {
        pinTime('line/' + hit.line.id + ':start', Math.max(0, Math.min(hit.line.t1 - MIN_LEN, snapTime(tt, hit.line.id, ev.altKey))));
      } else if (hit.row === 'line' && hit.line && hit.edge === 'end') {
        pinTime('line/' + hit.line.id + ':end', Math.max(hit.line.t0 + MIN_LEN, snapTime(tt, hit.line.id, ev.altKey)));
      } else if (hit.row === 'line' && hit.line) {
        const raw = tt - press.t;
        const start = snapTime(hit.line.t0 + raw, hit.line.id, ev.altKey);
        const delta = Math.round((start - hit.line.t0) * 1000) / 1000;
        app.dispatch({ t: 'time.shift', lineIds: [hit.line.id], delta, base: { [hit.line.id]: { start: hit.line.t0, end: hit.line.t1 } } },
          { label: ['undo.time', {}], mergeKey: press.mergeKey });
      } else if (hit.row === 'cut' && hit.edge === 'inner') {
        const cuts = hit.line.cuts.map((k) => app.plan.cuts.find((c) => c.key === k));
        const i = hit.line.cuts.indexOf(hit.cut.key);
        const lo = cuts[i - 1].t0 + MIN_LEN, hi = hit.cut.t1 - MIN_LEN;
        pinTime('cut/' + hit.cut.key + ':t0', Math.max(lo, Math.min(hi, snapTime(tt, null, ev.altKey))));
      }
    }

    canvas.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const pt = localPoint(ev);
      const hit = hitAt(pt.x, pt.y);
      press = { x: pt.x, t: tOf(pt.x), hit, range: hit.row === 'ruler' && ev.shiftKey, gesture: null, moved: false };
      if (hit.line) focus = { lineId: hit.line.id, edge: hit.edge === 'end' ? 'end' : 'start' };
      canvas.setPointerCapture(ev.pointerId);
    });
    canvas.addEventListener('pointermove', (ev) => {
      const pt = localPoint(ev);
      if (!press) {
        const hit = hitAt(pt.x, pt.y);
        canvas.style.cursor = hit.edge ? 'ew-resize' : hit.line && hit.row === 'line' ? 'grab' : 'default';
        return;
      }
      if (!press.moved && Math.abs(pt.x - press.x) < DRAG_PX) return;
      const draggable = press.range || (press.hit.line && press.hit.row === 'line') || press.hit.edge === 'inner';
      if (!draggable) return;
      if (!press.moved) {
        press.moved = true;
        startGesture(press.range ? 'range' : 'time', press.range ? 'range' : (press.hit.line ? press.hit.line.id : '') + (press.hit.edge || 'body'));
      }
      dragTo(pt, ev);
    });
    const endPress = () => {
      if (!press) return;
      const p = press;
      press = null;
      if (p.gesture) { p.gesture.end(); return; }
      clickAt(p);
    };
    canvas.addEventListener('pointerup', endPress);
    canvas.addEventListener('pointercancel', () => { if (press && press.gesture) press.gesture.end(); press = null; });

    // A click selects (line → 行, cut → カット; seeks when paused) and opens 詳細; elsewhere it seeks (§6.5).
    function clickAt(p) {
      const hit = p.hit;
      if (hit.row === 'line' && hit.line) {
        app.select({ level: 'line', ids: [hit.line.id] }, { from: 'timeline', open: true });
      } else if (hit.row === 'cut' && hit.cut) {
        const sole = hit.line && hit.line.cuts.length === 1;
        app.select(sole ? { level: 'line', ids: [hit.line.id] } : { level: 'cut', key: hit.cut.key }, { from: 'timeline', open: true });
      } else app.seek(p.t);
    }

    canvas.addEventListener('wheel', (ev) => {
      const pt = localPoint(ev);
      if (ev.ctrlKey || ev.metaKey) zoomAround(tOf(pt.x), ev.deltaY > 0 ? ZOOM : 1 / ZOOM);
      else {
        const w = win();
        view = { t0: w.t0 + (ev.deltaX || ev.deltaY) / Math.max(1, W) * w.span, span: w.span };
        clampView();
        draw();
      }
      ev.preventDefault();
    }, { passive: false });

    function clampView() {
      const d = duration();
      view.span = view.span > 0 ? Math.max(Math.min(MIN_SPAN, d), Math.min(view.span, d)) : 0;
      view.t0 = Math.max(0, Math.min(view.t0, d - (view.span || d)));
    }

    function zoomAround(center, factor) {
      const w = win();
      const span = Math.max(MIN_SPAN, w.span * factor);
      const k = (center - w.t0) / w.span;
      view = { t0: center - k * span, span: span >= duration() ? 0 : span };
      clampView();
      draw();
    }

    // --- toolbar -----------------------------------------------------------------------------------------------------

    snapBtn.addEventListener('click', () => {
      const on = app.doc.timing.snap !== 'off';
      app.dispatch({ t: 'timing.set', key: 'snap', v: on ? 'off' : 'beat' }, { label: ['undo.snap', {}] });
    });
    bpmBtn.addEventListener('click', () => {
      app.select(S.WORK, { from: 'header', open: true });
      if (app.inspector) requestAnimationFrame(() => app.inspector.flashField('bpm'));
    });
    zoomIn.addEventListener('click', () => zoomAround(app.time(), 1 / ZOOM));
    zoomOut.addEventListener('click', () => zoomAround(app.time(), ZOOM));
    fit.addEventListener('click', () => { view = { t0: 0, span: 0 }; draw(); });
    followBtn.addEventListener('click', () => app.view.setPref('follow', !app.view.state.prefs.follow));

    function updateBar() {
      const snap = app.doc.timing.snap !== 'off';
      snapBtn.setAttribute('aria-pressed', String(snap));
      const b = app.plan && app.plan.beats;
      const pinned = !!app.doc.pins['work:bpm'];
      bpmBtn.textContent = b && b.bpm ? t('tl.bpm', { bpm: Math.round(b.bpm * 10) / 10, src: t(pinned ? 'state.pinned' : 'state.auto') }) : t('tl.bpmNone');
      followBtn.setAttribute('aria-pressed', String(!!app.view.state.prefs.follow));
      fit.setAttribute('aria-pressed', String(!(view.span > 0)));
    }

    // Follow: keep the playhead in the window while playing.
    function follow(tt) {
      if (!app.view.state.prefs.follow || !(view.span > 0)) return;
      const w = win();
      if (tt < w.t0 || tt > w.t0 + w.span * 0.92) { view.t0 = tt - w.span * 0.1; clampView(); }
    }

    // --- keyboard and a11y proxies --------------------------------------------------------------------------------

    function proxyLabel(l, i) {
      const pins = Object.keys(app.doc.pins).filter((p) => { try { return P.isUnder(p, 'line/' + l.id) && app.doc.pins[p].by !== 'lock'; } catch (e) { return false; } }).length;
      const parts = [t('tl.proxy', { n: i + 1, t0: T.fmtTime(l.t0), t1: T.fmtTime(l.t1) })];
      if (l.locked) parts.push(t('state.locked'));
      if (pins) parts.push(t('lyr.pinCount', { n: pins }));
      return parts.join(t('tl.proxySep'));
    }

    function renderProxy() {
      const lines = app.plan ? app.plan.lines : [];
      dom.replace(proxy, lines.map((l, i) => h('div', { role: 'option', id: 'tl-opt-' + l.id, 'aria-selected': String(focus.lineId === l.id),
        text: proxyLabel(l, i) })));
      if (focus.lineId) proxy.setAttribute('aria-activedescendant', 'tl-opt-' + focus.lineId);
    }

    proxy.addEventListener('focus', () => {
      const lines = app.plan ? app.plan.lines : [];
      if (!focus.lineId && lines.length) {
        const own = S.lineOfSel(S.validate(app.view.state.sel, app.plan));
        focus = { lineId: own || lines[0].id, edge: 'start' };
      }
      renderProxy();
      draw();
    });
    proxy.addEventListener('blur', () => draw());
    proxy.addEventListener('keydown', (ev) => {
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;         // Ctrl+←/→ is the timeline.nudge action
      const lines = app.plan ? app.plan.lines : [];
      if (!lines.length) return;
      const at = Math.max(0, lines.findIndex((l) => l.id === focus.lineId));
      let handled = true;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        const to = Math.max(0, Math.min(lines.length - 1, at + (ev.key === 'ArrowDown' ? 1 : -1)));
        focus = { lineId: lines[to].id, edge: focus.edge };
        app.select({ level: 'line', ids: [lines[to].id] }, { from: 'timeline' });
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
        focus = { lineId: lines[at].id, edge: ev.key === 'ArrowLeft' ? 'start' : 'end' };
      } else if (ev.key === 'Enter') {
        app.select({ level: 'line', ids: [lines[at].id] }, { from: 'timeline', open: true });
      } else handled = false;
      if (handled) { ev.preventDefault(); ev.stopPropagation(); renderProxy(); draw(); }
    });

    // Ctrl+←/→ (Shift ×10): nudges the focused edge by one frame (§6.4.13); outside the timeline the key stays the browser's.
    if (!app.actions.has('timeline.nudge')) {
      app.actions.defineAction({ id: 'timeline.nudge', label: 'cmd.timeline.nudge', run: (c, a) => {
        if (!root.contains(document.activeElement) || !focus.lineId || !app.plan) return false;
        const line = app.plan.lines.find((l) => l.id === focus.lineId);
        if (!line) return false;
        const d = ((a && a.frames) || 1) / (app.doc.output.fps || 30);
        const slot = focus.edge === 'end' ? 'end' : 'start';
        const cur = slot === 'end' ? line.t1 : line.t0;
        const v = Math.max(0, Math.round((cur + d) * 1000) / 1000);
        app.dispatch({ t: 'pin.set', path: 'line/' + line.id + ':' + slot, v, by: 'user' },
          { label: ['undo.time', {}], mergeKey: 'nudge:' + line.id + ':' + slot });
        return true;
      } });
    }

    // --- wiring ------------------------------------------------------------------------------------------------------

    const redraw = dom.createBatcher(() => draw());
    app.bus.on('time', (tt) => { if (!host.hidden) { follow(tt); redraw('time'); } });
    app.bus.on('plan', () => { clampView(); if (!host.hidden) { renderProxy(); redraw('plan'); } });
    app.bus.on('layout', () => { if (!host.hidden) requestAnimationFrame(layout); });
    app.view.on((changed) => {
      if (changed.includes('drawer') && app.view.state.drawer) requestAnimationFrame(() => { renderProxy(); layout(); });
      if (changed.some((k) => k === 'sel' || k === 'highlight' || k === 'prefs')) redraw('view');
    });

    return { draw, layout, view: () => win(), focus: () => dom.focus(proxy), hitAt, xOf, tOf, rows };
  }

  return { mount, songMarks, edgeKind };
});
