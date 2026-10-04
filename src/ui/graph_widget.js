/* 文字PVメーカー v2 — original work. The graph widget (表現の強さ): five strengths over an interlude, drawn by dragging points, or 自動 (the song's loudness and tempo decide). */
MV.def('ui/graph_widget', ['ui/dom'], (dom) => {
  'use strict';

  const { h } = dom;

  // The value is 'auto' or five strengths 0…1 at the start, ¼, ½, ¾ and the end of the interlude ('0.2,0.5,0.9,0.6,0.3'),
  // as parts/arrange/interlude reads it. The presets give a shape in one tap; dragging a point (or the arrow keys on
  // it) draws your own; 自動 hands it back to the song.
  const N = 5;
  const PRESETS = Object.freeze([
    { key: 'auto', v: 'auto' },
    { key: 'rise', v: '0.15,0.35,0.55,0.8,1' },
    { key: 'arc', v: '0.25,0.7,1,0.7,0.3' },
    { key: 'fall', v: '1,0.8,0.55,0.35,0.15' },
    { key: 'calm', v: '0.2,0.2,0.2,0.2,0.2' },
    { key: 'full', v: '0.95,0.95,0.95,0.95,0.95' },
  ]);
  const AUTO_SHOWN = Object.freeze([0.35, 0.55, 0.7, 0.6, 0.4]);   // where the points wait while 自動 decides
  const UNPIN = '\u0000auto';                                    // ui/widgets AUTO: 自動 clears the pin
  const STEP = 0.05, STEP_BIG = 0.2;
  const PAD = 10, PLOT_H = 72;

  function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

  // valuesOf('0.2,0.5,…') → five numbers, or null for 'auto' and anything that is not five numbers.
  function valuesOf(v) {
    if (typeof v !== 'string') return null;
    const xs = v.split(',');
    if (xs.length !== N || xs.some((x) => !x.trim() || !Number.isFinite(Number(x)))) return null;
    return xs.map((x) => clamp01(Number(x)));
  }

  function textOf(vals) { return vals.map((x) => String(Math.round(clamp01(x) * 100) / 100)).join(','); }

  function make(field, env) {
    const t = env.t;
    const canvas = h('canvas', { class: 'gw-canvas', 'aria-hidden': 'true' });
    const handleLayer = h('div', { class: 'gw-handles', role: 'group', 'aria-label': env.label });
    const plot = h('div', { class: 'gw-plot' }, canvas, handleLayer);
    const presets = PRESETS.map((p) => h('button', { class: 'chip-btn', type: 'button', 'data-key': p.key,
      on: { click: () => { if (!st.readOnly) env.commit(p.v === 'auto' ? UNPIN : p.v); } } }, t('graph.' + p.key)));
    const note = h('p', { class: 'note subtle gw-note' });
    const el = h('div', { class: 'gw' }, h('div', { class: 'row-actions gw-presets' }, presets), plot, note);
    const handles = [];
    let st = { value: 'auto' }, cur = AUTO_SHOWN.slice(), auto = true, drag = null;

    for (let i = 0; i < N; i++) {
      const b = h('button', { class: 'cw-h gw-h', type: 'button', 'data-i': String(i) });
      wire(b, i);
      handles.push(b);
      handleLayer.append(b);
    }

    function box() {
      const r = canvas.getBoundingClientRect();
      const W = Math.round(r.width) || 240, H = Math.round(r.height) || PLOT_H;
      return { W, H, x: (i) => PAD + (i / (N - 1)) * (W - 2 * PAD), y: (v) => H - PAD - v * (H - 2 * PAD),
        v: (py) => clamp01((H - PAD - py) / (H - 2 * PAD)), top: r.top };
    }

    function wire(b, i) {
      b.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0 || st.readOnly) return;
        ev.preventDefault();
        dom.focus(b);
        drag = { g: env.gesture(), i };
        b.setPointerCapture(ev.pointerId);
      });
      b.addEventListener('pointermove', (ev) => {
        if (!drag) return;
        const g = box();
        cur[drag.i] = g.v(ev.clientY - g.top);
        auto = false;
        draw();
        drag.g.set(textOf(cur));
      });
      const end = () => { if (drag) { drag.g.end(); drag = null; } };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
      b.addEventListener('keydown', (ev) => {
        if (ev.ctrlKey || ev.metaKey || ev.altKey || st.readOnly) return;
        const step = ev.shiftKey ? STEP_BIG : STEP;
        if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
          cur[i] = clamp01(cur[i] + (ev.key === 'ArrowUp' ? step : -step));
          auto = false;
          draw();
          env.commit(textOf(cur), { merge: true });
        } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
          const j = i + (ev.key === 'ArrowLeft' ? -1 : 1);
          if (j >= 0 && j < N) dom.focus(handles[j]);
        } else return;
        // the arrows belong to the point: they must not move the inspector's selection
        ev.preventDefault();
        ev.stopPropagation();
      });
    }

    function draw() {
      const g = box(), dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(g.W * dpr)) canvas.width = Math.round(g.W * dpr);
      if (canvas.height !== Math.round(g.H * dpr)) canvas.height = Math.round(g.H * dpr);
      const c = canvas.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, g.W, g.H);
      c.fillStyle = '#101318';
      c.fillRect(0, 0, g.W, g.H);
      c.strokeStyle = 'rgba(242,239,232,0.14)';
      c.lineWidth = 1;
      c.setLineDash([3, 3]);
      for (const v of [0, 0.5, 1]) { c.beginPath(); c.moveTo(PAD, g.y(v)); c.lineTo(g.W - PAD, g.y(v)); c.stroke(); }
      c.setLineDash(auto ? [5, 4] : []);
      c.fillStyle = auto ? 'rgba(240,182,77,0.08)' : 'rgba(240,182,77,0.2)';
      c.beginPath();
      c.moveTo(g.x(0), g.y(0));
      for (let i = 0; i < N; i++) c.lineTo(g.x(i), g.y(cur[i]));
      c.lineTo(g.x(N - 1), g.y(0));
      c.closePath();
      c.fill();
      c.strokeStyle = auto ? 'rgba(240,182,77,0.55)' : '#f0b64d';
      c.lineWidth = 2;
      c.beginPath();
      for (let i = 0; i < N; i++) { if (i) c.lineTo(g.x(i), g.y(cur[i])); else c.moveTo(g.x(i), g.y(cur[i])); }
      c.stroke();
      c.setLineDash([]);
      handles.forEach((b, i) => {
        dom.setStyle(b, { left: g.x(i), top: g.y(cur[i]) });
        b.setAttribute('aria-label', t('graph.point', { n: i + 1, v: Math.round(cur[i] * 100) }));
        b.disabled = !!st.readOnly;
      });
    }

    return {
      el,
      focus: () => dom.focus(handles[0]),
      update(s) {
        st = s || {};
        if (drag) return;                                  // the drag owns the points until it ends
        const vals = st.mixed ? null : valuesOf(st.value);
        auto = !vals;
        cur = vals ? vals.slice() : AUTO_SHOWN.slice();
        const shown = st.mixed ? '' : (vals ? textOf(vals) : 'auto');
        for (const b of presets) b.classList.toggle('on', PRESETS.find((p) => p.key === b.dataset.key).v === shown);
        note.textContent = t(st.mixed ? 'state.mixed' : auto ? 'graph.autoNote' : 'graph.drawnNote');
        // drawn after layout: the plot has no size until the row is in the panel
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(draw); else draw();
      },
    };
  }

  return { make, valuesOf, textOf, PRESETS };
});
