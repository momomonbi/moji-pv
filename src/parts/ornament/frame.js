/* 文字PVメーカー v2 — original work. Decorations that frame the text block: hair frame, big brackets, corner ticks, orbit ring, tape strips (DESIGN §5.6). */
MV.def('parts/ornament/frame', ['parts/kit'], (K) => {
  'use strict';

  const FRAME_ROLES = ['lyric', 'focus', 'title', 'outro'];   // text-bound decorations also dress title and outro cards
  const EASE_OUT = K.ease('cubicOut');
  const EASE_IN = K.ease('quadIn');
  const SNAP = K.ease('backOut');
  const MIN_SCALE = 1e-4;          // a node never scales to exactly 0 (its matrix stays invertible)
  const KEY_GREEN = '#00B140';     // the green-screen key, the ground of a chroma palette (§4.16.3, §4.19.4)
  const RING_DOT = 10;             // du: the largest orbiting dot's radius (and the ring's stroke), kept off the text too
  const RING_ROUND = 0.34;         // the ring is never flatter than this (ry / rx)
  const RING_TURNS = Object.freeze([1, 0.75, 0.5, 0.25, 0]);   // shares of its tilt a ring tries, until it clears the text
  const RING_IN_X = 0.48, RING_IN_Y = 0.47;   // a ring's semi-axes stay within these shares of the frame, when they can
  const RING_OUT = 0.75;           // … else within this share (it runs out of the frame at its ends)
  const TAPE_CLEAR = 12;           // du between a tape piece and the text block's corner, even while it snaps in
  const TAPE_GROW = 1.2;           // tape pieces snap in from this scale
  const TAU = K.math.TAU;
  const DEG = K.math.DEG;

  // The ground's colour seen through a decoration: the 'ground' token, except on a green screen, where the ground is the
  // key and a translucent layer of it would be keyed out or spill green into the tape; a white sheen stands in there.
  function sheenOf(pal) { return String(pal.ground).toUpperCase() === KEY_GREEN ? '#FFFFFF' : 'ground'; }

  // --- geometry and timing ----------------------------------------------------------------------------------------------

  // The text block (env.hints.focus) with its corners; a block too small to frame (an empty interlude card) becomes a
  // modest box in the middle of the frame.
  function focusOf(env) {
    const f = env.hints && env.hints.focus, D = env.D;
    const ok = f && [f.x, f.y, f.w, f.h].every(Number.isFinite);
    const w = ok ? Math.max(f.w, 24) : 0.3 * D.short, h = ok ? Math.max(f.h, 24) : 0.12 * D.short;
    const cx = ok ? f.x + f.w / 2 : D.cx, cy = ok ? f.y + f.h / 2 : D.cy;
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, x1: cx + w / 2, y1: cy + h / 2 };
  }

  // The block grown by `gap`, kept inside the frame (a block wider than the frame is framed by the frame's edge).
  function around(env, f, gap) {
    const D = env.D, m = 3;
    return { x0: Math.max(m, f.x - gap), y0: Math.max(m, f.y - gap), x1: Math.min(D.w - m, f.x1 + gap), y1: Math.min(D.h - m, f.y1 + gap) };
  }

  // Semi-axes (rx, ry) of a ring turned by `tilt` (radians) and centred on a box of half sides (hw, hh) that keep the
  // whole box inside the ring: the ellipse of least area through the box's corners (√2 × the half sides, seen in the
  // ring's own frame) where the frame allows it, else as wide as allowed and tall enough to clear the corners; never
  // flatter than RING_ROUND. `fits` is false when the frame leaves no such ring.
  function ringAxes(hw, hh, tilt, maxRx, maxRy) {
    const c = Math.cos(tilt), s = Math.sin(tilt);
    const ax = Math.abs(hw * c + hh * s), ay = Math.abs(hh * c - hw * s);     // corners (hw, hh) and (−hw, −hh)
    const bx = Math.abs(hw * c - hh * s), by = Math.abs(hh * c + hw * s);     // corners (hw, −hh) and (−hw, hh)
    // the other semi-axis a ring of semi-axis r needs to pass outside corners (u, v) along r and (u', v') across it
    const need = (r, u, v, u2, v2) => Math.max(u < r ? v / Math.sqrt(1 - (u / r) * (u / r)) : Infinity,
      u2 < r ? v2 / Math.sqrt(1 - (u2 / r) * (u2 / r)) : Infinity);
    let rx = Math.min(Math.SQRT2 * Math.max(ax, bx), maxRx);
    let ry = Math.max(RING_ROUND * rx, need(rx, ax, ay, bx, by));
    if (ry > maxRy) {                                  // too tall for the frame: as tall as it may be, and wide enough
      ry = maxRy;
      rx = Math.max(RING_ROUND * ry, need(ry, ay, ax, by, bx));
    }
    return { rx: Math.min(rx, maxRx), ry, fits: rx <= maxRx };
  }

  // The ring round a box, inside the frame and turned as far toward `tilt` as that lets it clear the box (a big block
  // gets a level ring: turning it needs more room). A block too big for any such ring gets one that runs out of the
  // frame at its ends rather than through the text.
  function ringOf(hw, hh, tilt, D) {
    let ring = null;
    for (const [mx, my] of [[RING_IN_X, RING_IN_Y], [RING_OUT, RING_OUT]]) {
      for (const k of RING_TURNS) {
        ring = Object.assign(ringAxes(hw, hh, tilt * k, mx * D.w, my * D.h), { tilt: tilt * k });
        if (ring.fits) return ring;
      }
    }
    return ring;
  }

  // Cut-local windows of a decoration that animates itself: in over [s, s + d] as the text starts to appear, out over
  // [o, o + od], ending with the cut (and never starting later than the text's own exit).
  function windows(env, inDur) {
    const T = env.times, span = T.b - T.a;
    const d = Math.max(0.05, Math.min(inDur, 0.45 * span));
    const od = Math.max(0.05, Math.min(0.35, 0.3 * span));
    const o = Math.min(T.out, T.b - od);
    return { s: T.a + 0.04, d, o, od: T.b - o };
  }

  // --- behaviours (module level, pure in t, allocation-free) --------------------------------------------------------------

  // Node k scales along one axis (0 = x, 1 = y) from 0 to 1 over [s[k], s[k] + d[k]] and back over [o[k], o[k] + od[k]].
  function runGrow(P, t, b) {
    for (let k = 0; k < b.nodes.length; k++) {
      const i = b.nodes[k];
      const inK = EASE_OUT(K.math.clamp((t - b.s[k]) / b.d[k])), outK = EASE_IN(K.math.clamp((t - b.o[k]) / b.od[k]));
      const v = Math.max(MIN_SCALE, inK * (1 - outK));
      if (b.axis[k] === 0) P.sx[i] *= v; else P.sy[i] *= v;
    }
  }

  // Node k slides in from (dx[k], dy[k]) and fades up over [s, s + d]; it slides back out and fades over [o, o + od].
  function runSlide(P, t, b) {
    const inK = EASE_OUT(K.math.clamp((t - b.s) / b.d)), outK = EASE_IN(K.math.clamp((t - b.o) / b.od));
    const off = 1 - inK + outK, vis = inK * (1 - outK);
    for (let k = 0; k < b.nodes.length; k++) {
      const i = b.nodes[k];
      P.x[i] += b.dx[k] * off; P.y[i] += b.dy[k] * off;
      P.alpha[i] *= vis;
    }
  }

  // Every node settles from scale `grow` to 1 over [s, s + d] with a small overshoot (the alpha follows the text).
  function runSnap(P, t, b) {
    const v = b.grow + (1 - b.grow) * SNAP(K.math.clamp((t - b.s) / b.d));
    for (let k = 0; k < b.nodes.length; k++) { P.sx[b.nodes[k]] *= v; P.sy[b.nodes[k]] *= v; }
  }

  // Dots riding an ellipse (rx, ry) inside their group: dot k trails the lead by lag[k] radians.
  function runOrbit(P, t, b) {
    const th = b.phase + TAU * b.speed * t;
    for (let k = 0; k < b.nodes.length; k++) {
      const a = th - b.lag[k];
      P.x[b.nodes[k]] += b.rx * Math.cos(a); P.y[b.nodes[k]] += b.ry * Math.sin(a);
    }
  }

  function behave(env, run, nodes, fields) {
    env.sb.behave(Object.assign({}, fields, { phase: K.PH.ORNAMENT, live: 'always', from: Math.min(...nodes),
      to: Math.max(...nodes) + 1, t0: env.times.a, t1: env.times.b, run, nodes: Int32Array.from(nodes) }));
  }

  // --- hairFrame (the kind's fallback) ----------------------------------------------------------------------------------

  const hairFrame = K.ornament({
    key: 'hairFrame', fallback: true, scope: 'cut', follow: 'own',
    label: { ja: '細線枠', en: 'Hair frame' },
    blurb: { ja: '文字のまとまりを細い線の枠が一筆で囲む', en: 'A thin rectangle around the text block that draws itself' },
    tags: ['minimal', 'serious'],
    traits: { roles: FRAME_ROLES },
    params: {
      gap: { type: 'num', min: 0, max: 120, step: 1, unit: 'du', label: { ja: '間隔', en: 'Gap' }, auto: { range: [24, 44] } },
      width: { type: 'num', min: 0.5, max: 8, step: 0.5, unit: 'du', label: { ja: '太さ', en: 'Width' }, auto: { pick: [1.5, 2, 2.5] } },
      draw: { type: 'num', min: 0.2, max: 2, step: 0.05, unit: 's', label: { ja: '描く時間', en: 'Draw time' }, auto: { range: [0.5, 0.9] } },
    },
    build(env, p) {
      const { sb } = env;
      const r = around(env, focusOf(env), p.gap), w = windows(env, p.draw);
      // top → right → bottom → left, one continuous stroke; it retracts in the opposite order
      const sides = [[r.x0, r.y0, r.x1 - r.x0, 0], [r.x1, r.y0, r.y1 - r.y0, 90], [r.x1, r.y1, r.x1 - r.x0, 180], [r.x0, r.y1, r.y1 - r.y0, 270]];
      const nodes = [];
      for (const [x, y, len, deg] of sides) {
        const g = sb.group({ layer: 'text', x, y, rot: deg * DEG, owner: env.owner });
        sb.shape({ parent: g, layer: 'text', owner: env.owner, path: K.shape.line(0, 0, len, 0), stroke: p.ink, width: p.width,
          cap: 'square', alpha: 0.45 + 0.55 * p.amount });
        nodes.push(g);
      }
      const q = [0, 1, 2, 3];
      behave(env, runGrow, nodes, { axis: new Uint8Array(4),
        s: Float32Array.from(q, (k) => w.s + k * w.d / 4), d: new Float32Array(4).fill(w.d / 4),
        o: Float32Array.from(q, (k) => w.o + (3 - k) * w.od / 4), od: new Float32Array(4).fill(w.od / 4) });
    },
  });

  // --- bigBrackets ------------------------------------------------------------------------------------------------------

  const bigBrackets = K.ornament({
    key: 'bigBrackets', scope: 'cut', follow: 'own',
    label: { ja: '大括弧', en: 'Big brackets' },
    blurb: { ja: '大きな鉤括弧が文字をはさむ（縦書きでは縦の括弧）', en: 'Oversized corner brackets framing the text (turned for vertical text)' },
    tags: ['literary', 'bold'],
    traits: { roles: FRAME_ROLES },
    shared: { ink: { auto: { pick: ['accent', 'ink', 'muted'], weights: [4, 1, 1] } } },
    params: {
      arm: { type: 'num', min: 0.15, max: 0.8, step: 0.01, unit: 'frac', label: { ja: '短い腕', en: 'Short arm' }, auto: { range: [0.26, 0.38] } },
      weight: { type: 'num', min: 2, max: 28, step: 0.5, unit: 'du', label: { ja: '線の太さ', en: 'Weight' }, auto: { range: [7, 12] } },
      gap: { type: 'num', min: 0, max: 100, step: 1, unit: 'du', label: { ja: '間隔', en: 'Gap' }, auto: { range: [18, 32] } },
    },
    build(env, p) {
      const { sb, D } = env;
      const r = around(env, focusOf(env), p.gap), vertical = env.orient === 'v';
      const long = 0.78 * (vertical ? r.x1 - r.x0 : r.y1 - r.y0), short = Math.max(p.weight * 2, p.arm * long);
      // horizontal: 「 at the top left and 」 at the bottom right; vertical: ﹁ at the top right and ﹂ at the bottom left
      const marks = vertical
        ? [[r.x1, r.y0, [-long, 0, 0, 0, 0, short], 1, -1], [r.x0, r.y1, [long, 0, 0, 0, 0, -short], -1, 1]]
        : [[r.x0, r.y0, [short, 0, 0, 0, 0, long], -1, -1], [r.x1, r.y1, [-short, 0, 0, 0, 0, -long], 1, 1]];
      const nodes = [], dx = [], dy = [], shift = 0.035 * D.short;
      for (const [x, y, pts, sx, sy] of marks) {
        const g = sb.group({ layer: 'text', x, y, owner: env.owner });
        sb.shape({ parent: g, layer: 'text', owner: env.owner, path: K.shape.poly(pts, false), stroke: p.ink, width: p.weight,
          cap: 'square', alpha: 0.55 + 0.45 * p.amount });
        nodes.push(g); dx.push(sx * shift); dy.push(sy * shift);
      }
      const w = windows(env, 0.45);
      behave(env, runSlide, nodes, { dx: Float32Array.from(dx), dy: Float32Array.from(dy), s: w.s, d: w.d, o: w.o, od: w.od });
    },
  });

  // --- cornerTicks ------------------------------------------------------------------------------------------------------

  const cornerTicks = K.ornament({
    key: 'cornerTicks', scope: 'cut', follow: 'text',
    label: { ja: '角の印', en: 'Corner ticks' },
    blurb: { ja: '文字のまとまりの四隅に細いL字', en: 'Thin L-marks at the corners of the text block' },
    tags: ['minimal', 'serious'],
    traits: { roles: FRAME_ROLES },
    params: {
      size: { type: 'num', min: 0.02, max: 0.2, step: 0.005, unit: 'frac', label: { ja: '長さ', en: 'Length' }, auto: { range: [0.04, 0.07] } },
      gap: { type: 'num', min: 0, max: 80, step: 1, unit: 'du', label: { ja: '間隔', en: 'Gap' }, auto: { range: [18, 40] } },
      width: { type: 'num', min: 1, max: 8, step: 0.5, unit: 'du', label: { ja: '太さ', en: 'Width' }, auto: { pick: [2, 3] } },
    },
    build(env, p) {
      const { sb, D } = env;
      const r = around(env, focusOf(env), p.gap), L = p.size * D.short;
      const nodes = [];
      for (const [x, y, sx, sy] of [[r.x0, r.y0, 1, 1], [r.x1, r.y0, -1, 1], [r.x0, r.y1, 1, -1], [r.x1, r.y1, -1, -1]]) {
        const g = sb.group({ layer: 'text', x, y, owner: env.owner });
        sb.shape({ parent: g, layer: 'text', owner: env.owner, stroke: p.ink, width: p.width, cap: 'square',
          alpha: 0.4 + 0.6 * p.amount, path: K.shape.poly([sx * L, 0, 0, 0, 0, sy * L], false) });
        nodes.push(g);
      }
      const w = windows(env, 0.35);
      behave(env, runSnap, nodes, { grow: 1.6, s: w.s, d: w.d });
    },
  });

  // --- orbitRing --------------------------------------------------------------------------------------------------------

  const orbitRing = K.ornament({
    key: 'orbitRing', scope: 'cut', follow: 'text',
    label: { ja: '周回輪', en: 'Orbit ring' },
    blurb: { ja: '文字を囲む細い輪を、小さな点がまわる', en: 'A thin ring around the text with one dot orbiting it' },
    tags: ['airy', 'playful'],
    traits: { cells: [1, 14], roles: FRAME_ROLES },
    params: {
      tilt: { type: 'num', min: -20, max: 20, step: 0.5, unit: 'deg', label: { ja: '傾き', en: 'Tilt' }, auto: { range: [-7, 7] } },
      speed: { type: 'num', min: 0, max: 1, step: 0.01, unit: 'Hz', label: { ja: '周回の速さ', en: 'Orbit speed' },
        auto: { range: [0.12, 0.28], follow: 'energy' } },
      dash: { type: 'bool', label: { ja: '点線', en: 'Dashed' }, auto: { pick: [true, false] } },
      gap: { type: 'num', min: 0, max: 100, step: 1, unit: 'du', label: { ja: '間隔', en: 'Gap' }, auto: { range: [16, 34] } },
    },
    build(env, p) {
      const { sb, D, rng } = env;
      const f = focusOf(env), clear = p.gap + RING_DOT;
      // the ring passes outside the block's corners (the dots too)
      const { rx, ry, tilt } = ringOf(f.w / 2 + clear, f.h / 2 + clear, p.tilt * DEG, D);
      const g = sb.group({ layer: 'text', x: f.cx, y: f.cy, rot: tilt, owner: env.owner });
      sb.shape({ parent: g, layer: 'text', owner: env.owner, path: K.shape.ellipse(0, 0, rx, ry), stroke: p.ink, width: 2,
        dash: p.dash ? [2, 9] : undefined, cap: 'round', alpha: 0.5 + 0.4 * p.amount });
      const dots = [];
      for (const [r, a] of [[4, 0.3], [6, 0.55], [9.5, 1]]) {
        dots.push(sb.shape({ parent: g, layer: 'text', owner: env.owner, path: K.shape.ellipse(0, 0, r, r), fill: p.ink, alpha: a }));
      }
      behave(env, runOrbit, dots, { rx, ry, speed: p.speed, phase: rng.range(0, TAU), lag: Float32Array.of(0.24, 0.12, 0) });
      const w = windows(env, 0.5);
      behave(env, runSnap, [g], { grow: 0.86, s: w.s, d: w.d });
    },
  });

  // --- tapeStrip --------------------------------------------------------------------------------------------------------

  // A strip of tape (length L, width W) centred on the origin, its short ends torn in a zigzag.
  function tapePath(L, W, teeth) {
    const pts = [], tooth = W * 0.09;
    pts.push(-L / 2, -W / 2, L / 2, -W / 2);
    for (let k = 1; k <= teeth; k++) pts.push(L / 2 - (k % 2 ? tooth : 0), -W / 2 + (W * k) / teeth);
    pts.push(-L / 2, W / 2);
    for (let k = teeth - 1; k >= 1; k--) pts.push(-L / 2 + (k % 2 ? tooth : 0), -W / 2 + (W * k) / teeth);
    return K.shape.poly(pts, true);
  }

  const tapeStrip = K.ornament({
    key: 'tapeStrip', scope: 'cut', follow: 'text',
    label: { ja: 'テープ', en: 'Tape strip' },
    blurb: { ja: '文字のまとまりの角に半透明のテープ', en: 'Translucent tape pieces at the corners of the text block' },
    tags: ['playful', 'retro'],
    shared: { ink: { auto: { pick: ['shiftB', 'muted', 'shiftA', 'accent'], weights: [3, 2, 1, 1] } } },
    params: {
      pieces: { type: 'int', min: 1, max: 4, label: { ja: '枚数', en: 'Pieces' }, auto: { pick: [2, 4, 1], weights: [3, 1, 1] } },
      length: { type: 'num', min: 60, max: 400, step: 1, unit: 'du', label: { ja: '長さ', en: 'Length' }, auto: { range: [200, 280] } },
      skew: { type: 'num', min: 0, max: 25, step: 0.5, unit: 'deg', label: { ja: '傾きの乱れ', en: 'Skew' }, auto: { range: [4, 10] } },
    },
    build(env, p) {
      const { sb, rng } = env;
      const f = focusOf(env), W = p.length * 0.3;
      // corner, its outward diagonal and the tape's angle there (across the diagonal, as tape holds down a photo's corner)
      const corners = [[f.x, f.y, -1, -1, -45], [f.x1, f.y1, 1, 1, -45], [f.x1, f.y, 1, -1, 45], [f.x, f.y1, -1, 1, 45]];
      const nodes = [];
      for (let k = 0; k < p.pieces; k++) {
        const [cx, cy, nx, ny, deg] = corners[k];
        const skew = rng.range(-p.skew, p.skew) * DEG, L = p.length * rng.range(0.85, 1.1);
        // out along the diagonal until no part of the (skewed, snapping) tape reaches the corner: the block lies wholly
        // behind the corner as seen along its outward diagonal
        const out = TAPE_CLEAR + TAPE_GROW * ((L / 2) * Math.abs(Math.sin(skew)) + (W / 2) * Math.cos(skew));
        const g = sb.group({ layer: 'text', x: cx + (nx * out) / Math.SQRT2, y: cy + (ny * out) / Math.SQRT2, rot: deg * DEG + skew,
          owner: env.owner });
        sb.shape({ parent: g, layer: 'text', owner: env.owner, path: tapePath(L, W, 7), fill: p.ink,
          alpha: 0.42 + 0.25 * p.amount });
        sb.shape({ parent: g, layer: 'text', owner: env.owner, path: K.shape.rect(-L * 0.42, -W * 0.34, L * 0.84, W * 0.16),
          fill: sheenOf(env.pal), alpha: 0.22 });
        nodes.push(g);
      }
      const w = windows(env, 0.3);
      behave(env, runSnap, nodes, { grow: TAPE_GROW, s: w.s, d: w.d });
    },
  });

  return [hairFrame, bigBrackets, cornerTicks, orbitRing, tapeStrip];
});
