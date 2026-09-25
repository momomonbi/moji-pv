/* 文字PVメーカー v2 — original work. Light in the lens: diffusion veil, bloom and drifting light leaks. */
MV.def('parts/filter/glow', ['parts/kit'], (K) => {
  'use strict';

  const { clamp } = K.math;
  const L = (ja, en) => ({ ja, en });
  const ALL_ROLES = ['lyric', 'focus', 'title', 'interlude', 'outro'];

  // Cost (DESIGN §7.4: post ≤ 3 ms at 720p). A canvas without a GPU pays for every full-frame pixel a blend mode or a
  // smoothed resize touches, so the soft layers here (bloom, leaks) are made on small corners of one scratch surface,
  // where they cost almost nothing, and each reaches the frame in a single smoothed stretch.

  function reset(g) { g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; }

  // --- softVeil --------------------------------------------------------------------------------------------------------

  // A diffusion filter: a blurred copy laid over the sharp frame softens it (mist), and the same copy screened on top
  // makes light areas halate into their surroundings (bloom).
  function veil(fx, src, p) {
    if (!(p.amount > 0.01)) return src;
    const b = fx.blurred(src, Math.max(1, p.radius * fx.unit));
    const out = fx.own(src), g = out.ctx;
    g.globalAlpha = clamp(p.amount * p.mist * 0.5);
    g.drawImage(b.canvas, 0, 0);
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = clamp(p.amount * p.bloom * 0.4);
    g.drawImage(b.canvas, 0, 0);
    reset(g);
    fx.give(b);
    return out;
  }

  const softVeil = K.filter({
    key: 'softVeil',
    label: L('紗', 'Soft veil'),
    blurb: L('明るいところが柔らかくにじむ紗のような光', 'A soft diffusion glow over the highlights'),
    tags: ['soft', 'airy'], family: 'diffuse',
    stage: 'optic', cost: 4, passes: 5, alphaSafe: false,
    traits: { roles: ALL_ROLES },
    params: {
      radius: { type: 'num', min: 4, max: 80, step: 1, unit: 'du', label: L('にじみの広さ', 'Radius'), auto: { range: [14, 28] } },
      mist: { type: 'num', min: 0, max: 1, step: 0.05, unit: 'frac', label: L('やわらかさ', 'Softness'), auto: { range: [0.2, 0.4] } },
      bloom: { type: 'num', min: 0, max: 1, step: 0.05, unit: 'frac', label: L('光のにじみ', 'Bloom'), auto: { range: [0.35, 0.6] } },
    },
    apply: veil,
  });

  // --- glowSpill -------------------------------------------------------------------------------------------------------

  // Bloom from the bright parts only, built at ¼ size in the corners of two scratch surfaces A and B (every step draws
  // from one into the other: a canvas drawn onto itself is copied whole first, which costs a full frame each time):
  //   A: the frame at ½ (top left) → B: the mask at ¼ (top left);
  //   mask: its luminance (a grey 'color' fill), cut below a threshold with a 'color-burn' by a grey
  //   (b → (b − c) / (1 − c); `steep` raises the threshold c), times the frame's colours again, so the bright parts
  //   keep their own colours;
  //   blur: halved `levels` more times (every step averages pixel pairs, so thin bright strokes are not skipped),
  //   alternating between the surfaces, then doubled back step by step with smoothing (each step softens further).
  // The blurred mask is then stretched over the frame once, screened (`burn` makes the screen stronger, so the
  // brightest cores clip). A light paper ground passes the threshold only partly: it glows gently while bright words
  // and lights glow fully.
  // Burn greys 1 − c for steep 0–3: c = 0.75^(1 / 2^steep), the threshold of the luminance raised to 2^steep and cut
  // at 0.75, whose slope above the threshold it matches as well.
  const THRESHOLD_GREYS = Object.freeze(['#404040', '#222222', '#121212', '#090909']);
  const MAX_LEVELS = 4;
  const GAP = 2;                               // px between regions, so smoothing never reads a neighbour

  // n halved k times (rounding up, at least 1).
  function halved(n, k) {
    let v = n;
    for (let j = 0; j < k; j++) v = Math.max(1, Math.ceil(v / 2));
    return v;
  }

  // Blur level k lives on B when k is even (level 0 = the mask at B's top left) and on A when k is odd. The halved
  // copies stack from the top of a column at x = down, the doubled ones from the top of a column at x = up; every
  // region is written once, so no step clears a region (a write to a surface whose picture another surface is still
  // waiting to draw also copies it whole).
  function levelY(k, h4) {
    let y = 0;
    for (let j = k % 2 === 0 ? 2 : 1; j < k; j += 2) y += halved(h4, j) + GAP;
    return y;
  }

  // The doubled copies: the finished mask (level 0) at the top of the up column, the others below it.
  function upY(k, h4) { return k === 0 ? 0 : h4 + GAP + levelY(k, h4); }

  // Blurs the mask by halving it `levels` times and doubling it back, each step into the other surface. Returns the x
  // of the blurred mask (at y = 0 on B, w4 × h4).
  function blurMask(A, B, levels, down, up, w4, h4) {
    for (let k = 1; k <= levels; k++) {
      const from = k % 2 ? B : A, to = k % 2 ? A : B;
      to.ctx.drawImage(from.canvas, k > 1 ? down : 0, levelY(k - 1, h4), halved(w4, k - 1), halved(h4, k - 1),
        down, levelY(k, h4), halved(w4, k), halved(h4, k));
    }
    for (let k = levels; k >= 1; k--) {
      const from = k % 2 ? A : B, to = k % 2 ? B : A;
      to.ctx.drawImage(from.canvas, k < levels ? up : down, k < levels ? upY(k, h4) : levelY(k, h4), halved(w4, k), halved(h4, k),
        up, upY(k - 1, h4), halved(w4, k - 1), halved(h4, k - 1));
    }
    return levels > 0 ? up : 0;
  }

  function spill(fx, src, p) {
    if (!(p.amount > 0.01)) return src;
    const w = fx.w, h = fx.h, w2 = Math.ceil(w / 2), h2 = Math.ceil(h / 2), w4 = Math.ceil(w / 4), h4 = Math.ceil(h / 4);
    const down = w2 + GAP, up = down + Math.ceil(w4 / 2) + GAP;
    const levels = Math.max(0, Math.min(MAX_LEVELS, Math.round(Math.log2(Math.max(1, (p.radius * fx.unit) / 8)))));
    const A = fx.take(), B = fx.take(), ga = A.ctx, gb = B.ctx;
    ga.drawImage(src.canvas, 0, 0, w, h, 0, 0, w2, h2);
    gb.drawImage(A.canvas, 0, 0, w2, h2, 0, 0, w4, h4);
    gb.globalCompositeOperation = 'color';
    gb.fillStyle = '#808080';
    gb.fillRect(0, 0, w4, h4);
    gb.globalCompositeOperation = 'color-burn';
    gb.fillStyle = THRESHOLD_GREYS[Math.max(0, Math.min(3, p.steep | 0))];
    gb.fillRect(0, 0, w4, h4);
    gb.globalCompositeOperation = 'multiply';
    gb.drawImage(A.canvas, 0, 0, w2, h2, 0, 0, w4, h4);
    gb.globalCompositeOperation = 'source-over';
    const maskX = blurMask(A, B, levels, down, up, w4, h4);
    const out = fx.own(src), go = out.ctx;
    go.globalCompositeOperation = 'screen';
    go.globalAlpha = clamp(p.amount * (1 + p.burn));
    go.drawImage(B.canvas, maskX, 0, w4, h4, 0, 0, w, h);
    reset(go);
    fx.give(A); fx.give(B);
    return out;
  }

  const glowSpill = K.filter({
    key: 'glowSpill',
    label: L('光のにじみ', 'Glow spill'),
    blurb: L('明るいところから光があふれてにじむ', 'Bloom spilling from bright areas'),
    tags: ['bright', 'wet'], family: 'diffuse',
    stage: 'light', cost: 4, passes: 3, alphaSafe: false,
    traits: { roles: ALL_ROLES },
    params: {
      radius: { type: 'num', min: 6, max: 120, step: 1, unit: 'du', label: L('広がり', 'Radius'),
        auto: { range: [22, 46], follow: 'energy' } },
      steep: { type: 'int', min: 0, max: 3, label: L('光る明るさの境目', 'Threshold'), auto: { pick: [1, 1, 2] }, ui: 'advanced' },
      burn: { type: 'num', min: 0, max: 1, step: 0.05, unit: 'frac', label: L('芯の強さ', 'Core burn'), auto: { range: [0.05, 0.25] } },
    },
    apply: spill,
  });

  // --- amberSpill -------------------------------------------------------------------------------------------------------

  // Warm film-burn colours, chosen for 'hard-light': a channel above ½ screens (lights), one below multiplies (tints),
  // so one layer both glows on dark areas and tints light ones.
  const LEAK = Object.freeze(['#FF9440', '#FF5A6E', '#FFCC66']);   // film-burn orange, rose, amber
  const EDGES = Object.freeze({ left: [0, 0.5, 0, 1], right: [1, 0.5, 0, 1], top: [0.5, 0, 1, 0], bottom: [0.5, 1, 1, 0] });
  const LOW = 4;                     // the leak layer is painted at ¼ size (it is all soft gradients)

  // Three soft blobs of warm light sit just outside one edge and wander along it. They are painted into a ¼-size
  // corner of a scratch surface and laid over the frame with one stretched 'hard-light' draw.
  function leak(fx, src, p, t) {
    if (!(p.amount > 0.01)) return src;
    const w = fx.w, h = fx.h, lw = Math.ceil(w / LOW), lh = Math.ceil(h / LOW), big = Math.max(lw, lh);
    const e = EDGES[p.edge] || EDGES.left;
    const layer = fx.take(), gl = layer.ctx;
    gl.globalCompositeOperation = 'screen';
    for (let k = 0; k < LEAK.length; k++) {
      const along = 0.15 + 0.7 * fx.noise(t * p.drift + k * 7.31);
      const breath = 0.55 + 0.45 * fx.noise(t * p.drift * 1.7 + 40 + k * 3.7);
      const x = (e[2] ? along : e[0]) * lw + (e[2] ? 0 : (e[0] ? 1 : -1) * 0.06 * lw);
      const y = (e[3] ? along : e[1]) * lh + (e[3] ? 0 : (e[1] ? 1 : -1) * 0.06 * lh);
      const r = big * p.size * (0.45 + 0.2 * k) * (0.8 + 0.2 * breath);
      const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(lw, x + r), y1 = Math.min(lh, y + r);
      if (x1 <= x0 || y1 <= y0) continue;
      gl.globalAlpha = clamp(p.amount * breath * 0.75);
      gl.fillStyle = blob(gl, x, y, r, LEAK[k]);
      gl.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    reset(gl);
    const out = fx.own(src), g = out.ctx;
    g.globalCompositeOperation = 'hard-light';
    g.drawImage(layer.canvas, 0, 0, lw, lh, 0, 0, w, h);
    reset(g);
    fx.give(layer);
    return out;
  }

  function blob(g, x, y, r, hex) {
    const grad = g.createRadialGradient(x, y, 0, x, y, Math.max(1, r));
    grad.addColorStop(0, K.color.rgba(hex, 0.95));
    grad.addColorStop(0.4, K.color.rgba(hex, 0.5));
    grad.addColorStop(1, K.color.rgba(hex, 0));
    return grad;
  }

  const amberSpill = K.filter({
    key: 'amberSpill',
    label: L('光漏れ', 'Light leak'),
    blurb: L('画面の端から暖かい光がゆっくり漏れ込む', 'Warm light leaks drift in from one edge'),
    tags: ['soft', 'retro'], family: 'leak',
    stage: 'light', cost: 4, passes: 2, alphaSafe: false,
    traits: { roles: ALL_ROLES },
    params: {
      edge: { type: 'enum', of: ['left', 'right', 'top', 'bottom'], label: L('漏れる端', 'Edge'),
        auto: { pick: ['left', 'right', 'top', 'bottom'], weights: [3, 3, 2, 1] } },
      size: { type: 'num', min: 0.2, max: 1.2, step: 0.05, unit: 'frac', label: L('光の大きさ', 'Size'), auto: { range: [0.55, 0.85] } },
      drift: { type: 'num', min: 0.02, max: 1, step: 0.01, unit: 'Hz', label: L('動く速さ', 'Drift'),
        auto: { range: [0.12, 0.3], follow: 'tempo' } },
    },
    apply: leak,
  });

  return [softVeil, glowSpill, amberSpill];
});
