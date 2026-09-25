/* 文字PVメーカー v2 — original work. Graphic backgrounds: flat fill, grid paper, stripe shift, halftone sun (DESIGN §5.5). */
MV.def('parts/ground/plain', ['parts/kit'], (K) => {
  'use strict';

  const BLEED = 0.15;              // share of the frame painted beyond each edge, so camera moves never show an edge
  const FIELD = 5.5;               // least ink contrast of any colour that may sit behind the text
  const ACCENT_KEEP = 0.72;        // … and the share of the accent's contrast with the ground it keeps
  const EDGE = 3.2;                // least ink contrast of a colour that calm() dims in the middle of the frame
  const STRIPE_DE = 0.052;         // the most a stripe differs from the ground (OKLab distance, at full amount)

  // --- readable tints (the kit has no contrast helper, and parts may use only the kit) --------------------------------

  function luminance(hex) {
    const n = parseInt(hex.slice(1, 7), 16);
    const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  }

  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  // pal.ground (or `base`) tinted toward `toward` (OKLab) by at most `want`, backed off until the text still reads on it:
  // the ink keeps contrast ≥ min (FIELD by default) on the ground's side, and the accent (emphasis) keeps most of its
  // own contrast. Colours made with EDGE must be dimmed by calm() in the middle of the frame.
  function readable(pal, toward, want, min, base) {
    const from = base || pal.ground, least = min || FIELD;
    const inkL = luminance(pal.ink), light = luminance(from) > inkL;
    const accentMin = ACCENT_KEEP * (least / FIELD) * contrast(pal.accent, from);
    const ok = (m) => {
      const c = K.color.mix(from, toward, m);
      return contrast(pal.ink, c) >= least && luminance(c) > inkL === light && contrast(pal.accent, c) >= accentMin;
    };
    if (ok(want)) return K.color.mix(from, toward, want);
    let lo = 0, hi = want;
    for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
    return K.color.mix(from, toward, lo);
  }

  function hexOf(pal, ink) { return pal[ink] || ink; }

  // OKLab distance of two colours: how strongly a pattern made of them reads (about 0.02 is barely seen, 0.1 is bold).
  // A contrast ratio misses a saturated colour on a ground of its own lightness; this does not.
  function oklab(hex) {
    const n = parseInt(hex.slice(1, 7), 16);
    const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), b = lin(n & 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  }

  function distance(a, b) {
    const p = oklab(a), q = oklab(b);
    return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  }

  // The largest share m ≤ want of the mix from `from` toward `toward` whose colour stays within `most` of `from`.
  function within(from, toward, want, most) {
    if (distance(from, K.color.mix(from, toward, want)) <= most) return want;
    let lo = 0, hi = want;
    for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (distance(from, K.color.mix(from, toward, m)) <= most) lo = m; else hi = m; }
    return lo;
  }

  // The painted area: the frame plus the bleed on every side (du).
  function areaOf(D) {
    return { w: D.w, h: D.h, x0: -BLEED * D.w, y0: -BLEED * D.h, W: D.w * (1 + 2 * BLEED), H: D.h * (1 + 2 * BLEED) };
  }

  function paint(env, data, draw, animated) {
    env.sb.paint({ layer: 'ground', bleed: BLEED, animated, owner: env.owner, data, draw });
  }

  // A very soft darkening (or lightening) toward `edge` at the corners.
  function vignette(g, d, q) {
    if (!(d.edgeAlpha > 0)) return;
    const cx = d.w / 2, cy = d.h / 2, r = Math.hypot(d.w, d.h) / 2;
    const grad = g.createRadialGradient(cx, cy, r * 0.3, cx, cy, r * 1.3);
    grad.addColorStop(0, q.rgba(d.edge, 0));
    grad.addColorStop(1, q.rgba(d.edge, d.edgeAlpha));
    g.fillStyle = grad;
    g.fillRect(d.x0, d.y0, d.W, d.H);
  }

  // --- flatFill ---------------------------------------------------------------------------------------------------------

  function flatDraw(g, t, d, q) {
    g.fillStyle = d.fill;
    g.fillRect(d.x0, d.y0, d.W, d.H);
    vignette(g, d, q);
  }

  const flatFill = K.ground({
    key: 'flatFill', fallback: true, animated: false,
    label: { ja: '無地', en: 'Flat fill' },
    blurb: { ja: '地の色に、ごく淡い周辺の陰り', en: 'Solid ground with a very soft vignette at the corners' },
    tags: ['minimal'],
    params: {
      vignette: { type: 'num', min: 0, max: 1, step: 0.01, label: { ja: '周辺の陰り', en: 'Vignette' }, auto: { range: [0.45, 0.8] } },
    },
    build(env, p) {
      const pal = env.pal;
      paint(env, Object.assign(areaOf(env.D), { fill: pal.ground, edge: pal.ground2, edgeAlpha: p.vignette * (0.5 + 0.5 * p.amount) }),
        flatDraw, false);
    },
  });

  // --- gridPaper --------------------------------------------------------------------------------------------------------

  function gridLines(g, d, major) {
    const c = d.cell, cx = d.w / 2, cy = d.h / 2;
    const nx = Math.ceil(d.W / 2 / c) + 1, ny = Math.ceil(d.H / 2 / c) + 1;
    g.beginPath();
    for (let i = -nx; i <= nx; i++) {
      if ((i % 5 === 0) !== major) continue;
      g.moveTo(cx + i * c, d.y0); g.lineTo(cx + i * c, d.y0 + d.H);
    }
    for (let j = -ny; j <= ny; j++) {
      if ((j % 5 === 0) !== major) continue;
      g.moveTo(d.x0, cy + j * c); g.lineTo(d.x0 + d.W, cy + j * c);
    }
  }

  function gridDraw(g, t, d, q) {
    g.fillStyle = d.fill;
    g.fillRect(d.x0, d.y0, d.W, d.H);
    vignette(g, d, q);
    gridLines(g, d, false);
    g.strokeStyle = q.rgba(d.line, d.minor); g.lineWidth = 0.9; g.stroke();
    gridLines(g, d, true);
    g.strokeStyle = q.rgba(d.line, d.major); g.lineWidth = 1.7; g.stroke();
    if (d.marginX === null) return;
    g.beginPath();
    g.moveTo(d.marginX, d.y0); g.lineTo(d.marginX, d.y0 + d.H);
    g.moveTo(d.marginX + 5, d.y0); g.lineTo(d.marginX + 5, d.y0 + d.H);
    g.strokeStyle = q.rgba(d.rule, 0.55); g.lineWidth = 1.2; g.stroke();
  }

  const gridPaper = K.ground({
    key: 'gridPaper', animated: false,
    label: { ja: '方眼', en: 'Grid paper' },
    blurb: { ja: '細い方眼線、五本ごとに少し濃い線', en: 'Fine grid lines, every fifth one stronger' },
    tags: ['minimal', 'serious'],
    params: {
      cell: { type: 'int', min: 12, max: 96, unit: 'du', label: { ja: 'ます目', en: 'Cell' }, auto: { range: [26, 42] } },
      line: { type: 'ink', label: { ja: '線の色', en: 'Line color' }, auto: { pick: ['muted', 'shiftA'], weights: [3, 1] } },
      margin: { type: 'bool', label: { ja: '余白線', en: 'Margin rule' }, auto: { pick: [false, true], weights: [3, 1] } },
    },
    build(env, p) {
      const { pal, D } = env;
      const line = readable(pal, hexOf(pal, p.line), 1);
      const a = p.amount;
      const margin = D.safe.l + 0.06 * D.w;         // the rule sits on the grid line nearest to this
      paint(env, Object.assign(areaOf(D), {
        fill: pal.ground, edge: pal.ground2, edgeAlpha: 0.5, cell: p.cell, line, minor: 0.14 + 0.16 * a, major: 0.28 + 0.3 * a,
        marginX: p.margin ? D.w / 2 + Math.round((margin - D.w / 2) / p.cell) * p.cell : null,
        rule: readable(pal, pal.accent, 0.8),
      }), gridDraw, false);
    },
  });

  // --- stripeShift ------------------------------------------------------------------------------------------------------

  function stripeDraw(g, t, d, q) {
    g.fillStyle = d.fill;
    g.fillRect(d.x0, d.y0, d.W, d.H);
    const R = Math.hypot(d.W, d.H) / 2, period = 2 * d.width;
    const off = K.math.wrap(d.speed * t, 0, period * 4);
    const k0 = Math.floor((-R - off) / period) - 1, k1 = Math.ceil((R - off) / period);
    g.save();
    g.translate(d.w / 2, d.h / 2);
    g.rotate(d.angle);
    g.beginPath();
    for (let k = k0; k <= k1; k++) g.rect(off + k * period, -R, d.width, 2 * R);
    g.fillStyle = d.stripe;
    g.fill();
    g.beginPath();
    for (let k = k0; k <= k1; k++) {
      if (((k % 4) + 4) % 4 !== 0) continue;
      const x = off + k * period + d.width + d.width * 0.5;
      g.moveTo(x, -R); g.lineTo(x, R);
    }
    g.strokeStyle = q.rgba(d.pin, d.pinAlpha);
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  }

  const stripeShift = K.ground({
    key: 'stripeShift',
    label: { ja: '流れ縞', en: 'Stripe shift' },
    blurb: { ja: '斜めの縞がゆっくり流れる', en: 'Diagonal stripes that scroll slowly' },
    tags: ['playful', 'busy'],
    params: {
      width: { type: 'num', min: 12, max: 200, step: 1, unit: 'du', label: { ja: '縞の幅', en: 'Stripe width' }, auto: { range: [34, 78] } },
      angle: { type: 'num', min: -75, max: 75, step: 1, unit: 'deg', label: { ja: '角度', en: 'Angle' }, auto: { pick: [35, -35, 55, -55] } },
      speed: { type: 'num', min: 0, max: 80, step: 0.5, unit: 'du', label: { ja: '流れる速さ（毎秒）', en: 'Speed (per second)' },
        auto: { range: [6, 24], follow: 'energy' } },
      toward: { type: 'ink', label: { ja: '縞の色', en: 'Stripe color' },
        auto: { pick: ['ground2', 'shiftA', 'shiftB', 'accent'], weights: [3, 2, 2, 1] } },
    },
    build(env, p) {
      const { pal, D } = env;
      // the stripes cross every glyph, so their edges stay soft: within STRIPE_DE of the ground (OKLab), however dark or
      // saturated the colour they lean toward, as well as readable
      const toward = hexOf(pal, p.toward), most = STRIPE_DE * (0.6 + 0.4 * p.amount);
      paint(env, Object.assign(areaOf(D), {
        fill: pal.ground, width: p.width, angle: p.angle * K.math.DEG, speed: p.speed,
        stripe: readable(pal, toward, within(pal.ground, toward, 0.1 + 0.3 * p.amount, most)),
        pin: readable(pal, pal.accent, 1), pinAlpha: 0.2 + 0.35 * p.amount,
      }), stripeDraw, p.speed > 0);
    },
  });

  // --- halftoneSun ------------------------------------------------------------------------------------------------------

  // The lyric zone, where the halftone thins out to nothing: an ellipse of these shares of w and h around the middle,
  // clear inside ZONE_IN and at full strength from ZONE_OUT (in its own radii). A disc pinned to the centre is meant to
  // stand behind the words: there its dots only thin to CENTRE_FLOOR.
  const ZONE_W = 0.42, ZONE_H = 0.34, ZONE_IN = 0.6, ZONE_OUT = 1.35, CENTRE_FLOOR = 0.3;
  // At most this many dot pitches from the disc's centre to its rim (about π·32² ≈ 3,200 dots), so the largest disc with
  // the finest spacing still draws within the §7.4 frame budget; a finer pinned spacing is used as far as that allows.
  const RIM_PITCHES = 32;
  const PLACES = Object.freeze({
    topRight: [0.84, 0.2], topLeft: [0.16, 0.2], bottomRight: [0.84, 0.82], bottomLeft: [0.16, 0.82], center: [0.5, 0.48],
  });

  // 1 away from the middle of the frame, down to d.floor where lyrics usually sit: the dots of a disc in a corner shrink to
  // nothing behind them, so no dot in the accent ever stands behind an emphasized word in the accent.
  function calm(d, x, y) {
    const e = Math.hypot((x - d.w / 2) / (ZONE_W * d.w), (y - d.h / 2) / (ZONE_H * d.h));
    return d.floor + (1 - d.floor) * K.math.smooth((e - ZONE_IN) / (ZONE_OUT - ZONE_IN));
  }

  // Dots on a turning square grid; each dot's radius falls off from the disc's centre to its rim.
  function halftoneDraw(g, t, d, q) {
    g.fillStyle = d.fill;
    g.fillRect(d.x0, d.y0, d.W, d.H);
    vignette(g, d, q);
    const s = q.draft ? d.spacing * 1.35 : d.spacing;
    const a = d.turn + d.spin * t, ca = Math.cos(a), sa = Math.sin(a);
    const n = Math.ceil(d.R / s);
    g.beginPath();
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const rho = Math.hypot(i, j) * s / d.R;
        if (rho >= 1) continue;
        const x = d.cx + (i * ca - j * sa) * s, y = d.cy + (i * sa + j * ca) * s;
        if (x < d.x0 || y < d.y0 || x > d.x0 + d.W || y > d.y0 + d.H) continue;      // off the painted area
        const r = 0.5 * s * Math.pow(1 - Math.pow(rho, 1.6), 0.75) * calm(d, x, y);
        if (r < 0.6) continue;
        g.moveTo(x + r, y);
        g.arc(x, y, r, 0, K.math.TAU);
      }
    }
    g.fillStyle = d.dot;
    g.fill();
    g.beginPath();
    g.arc(d.cx, d.cy, d.R * 1.06, 0, K.math.TAU);
    g.moveTo(d.cx + d.R * 1.12, d.cy);
    g.arc(d.cx, d.cy, d.R * 1.12, 0, K.math.TAU);
    g.strokeStyle = q.rgba(d.dot, d.ring);
    g.lineWidth = 1.5;
    g.stroke();
  }

  const halftoneSun = K.ground({
    key: 'halftoneSun',
    label: { ja: '網点の日', en: 'Halftone sun' },
    blurb: { ja: 'アクセント色の大きな網点の円がゆっくり回る', en: 'A large halftone disc in the accent color, slowly turning' },
    tags: ['retro', 'bright'],
    params: {
      size: { type: 'num', min: 0.3, max: 1.4, step: 0.01, unit: 'frac', label: { ja: '大きさ', en: 'Size' }, auto: { range: [0.7, 1] } },
      spacing: { type: 'num', min: 8, max: 48, step: 0.5, unit: 'du', label: { ja: '網点の間隔', en: 'Dot spacing' }, auto: { range: [14, 22] } },
      spin: { type: 'num', min: -8, max: 8, step: 0.1, unit: 'deg', label: { ja: '回転（毎秒）', en: 'Turn (per second)' },
        auto: { pick: [-1.4, -0.8, 0.8, 1.4] } },
      place: { type: 'enum', of: ['topRight', 'topLeft', 'bottomRight', 'bottomLeft', 'center'], label: { ja: '位置', en: 'Place' },
        auto: { pick: ['topRight', 'topLeft', 'bottomRight', 'bottomLeft'], weights: [4, 3, 2, 2] } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const [fx, fy] = PLACES[p.place] || PLACES.topRight;
      const R = (p.size * D.short) / 2;
      paint(env, Object.assign(areaOf(D), {
        fill: pal.ground, edge: pal.ground2, edgeAlpha: 0.6, cx: fx * D.w, cy: fy * D.h, R, floor: p.place === 'center' ? CENTRE_FLOOR : 0,
        spacing: Math.max(p.spacing, R / RIM_PITCHES), spin: p.spin * K.math.DEG, turn: rng.range(0, Math.PI / 2),
        dot: readable(pal, pal.accent, 0.5 + 0.45 * p.amount, EDGE), ring: 0.18 + 0.3 * p.amount,
      }), halftoneDraw, p.spin !== 0);
    },
  });

  return [flatFill, gridPaper, stripeShift, halftoneSun];
});
