/* 文字PVメーカー v2 — original work. Digital damage: color channels that slip apart and bands that jump sideways. */
MV.def('parts/filter/glitch', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, smooth, DEG } = K.math;
  const L = (ja, en) => ({ ja, en });

  // Deterministic randoms for tick k: fx.noise at integer points is its seeded lattice value (no allocation).
  function rnd(fx, k, j) { return fx.noise(k * 1024 + j); }

  // A short pulse on every beat (0 without a beat grid).
  function thumpSwell(fx, t) {
    const b = fx.beat(t);
    return b ? Math.exp(-b.since / 0.12) : 0;
  }

  // Frames whose empty areas and colours must stay as they are (DESIGN §4.19.4): transparent (clear), the green-screen
  // key and black (white text only). fx.pal is the frame palette after the backdrop rule, so its ground tells them apart.
  const KEY_GREEN = '#00B140';
  function plainFrame(fx) {
    if (fx.alpha) return true;
    const pal = fx.pal;
    if (!pal) return false;
    const ground = String(pal.ground).toUpperCase(), ink = String(pal.ink).toUpperCase();
    return ground === KEY_GREEN || (ground === '#000000' && ink === '#FFFFFF');
  }

  // --- chromaSlip ------------------------------------------------------------------------------------------------------

  // src drawn 1:1 at the whole-pixel offset (dx, dy) — no resampling, and the frame keeps its scale — with the strips
  // it uncovers filled by its edge rows and columns stretched across them (clamp to edge).
  function shifted(g, src, w, h, dx, dy) {
    g.drawImage(src.canvas, dx, dy);
    if (dx > 0) g.drawImage(src.canvas, 0, 0, 1, h, 0, dy, dx, h);
    if (dx < 0) g.drawImage(src.canvas, w - 1, 0, 1, h, w + dx, dy, -dx, h);
    if (dy > 0) g.drawImage(src.canvas, 0, 0, w, 1, dx, 0, w, dy);
    if (dy < 0) g.drawImage(src.canvas, 0, h - 1, w, 1, dx, h + dy, w, -dy);
    if (dx !== 0 && dy !== 0) {
      g.drawImage(src.canvas, dx > 0 ? 0 : w - 1, dy > 0 ? 0 : h - 1, 1, 1,
        dx > 0 ? 0 : w + dx, dy > 0 ? 0 : h + dy, Math.abs(dx), Math.abs(dy));
    }
  }

  // Red one way, green+blue the other, added back together: flat areas come out exactly as they were and edges grow
  // red and cyan fringes. The copies move by whole pixels (a fractional offset resamples the whole frame, several
  // copies' worth of work on a canvas without a GPU). The frame is opaque here (the filter is not alpha-safe), so
  // multiplying by a pure colour is enough to isolate a channel.
  function slip(fx, src, p, t) {
    const pulse = 1 + p.kick * (fx.impulse('slip', t) + 0.5 * thumpSwell(fx, t)) + 0.3 * (fx.noise(t * 3) - 0.5);
    const d = p.amount * p.spread * pulse * fx.unit;
    if (!(d >= 0.5)) return src;
    const a = p.angle * DEG, dx = Math.round(Math.cos(a) * d), dy = Math.round(Math.sin(a) * d);
    if (dx === 0 && dy === 0) return src;
    const w = fx.w, h = fx.h;
    const out = fx.take(), g = out.ctx;
    shifted(g, src, w, h, dx, dy);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = '#FF0000';
    g.fillRect(0, 0, w, h);
    const c = fx.take(), gc = c.ctx;
    shifted(gc, src, w, h, -dx, -dy);
    gc.globalCompositeOperation = 'multiply';
    gc.fillStyle = '#00FFFF';
    gc.fillRect(0, 0, w, h);
    gc.globalCompositeOperation = 'source-over';
    g.globalCompositeOperation = 'lighter';
    g.drawImage(c.canvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
    fx.give(c);
    return out;
  }

  const chromaSlip = K.filter({
    key: 'chromaSlip',
    label: L('色ずれ', 'Chroma slip'),
    blurb: L('色が左右にずれ、拍や見せ場で強くなる', 'Color channels slide apart, harder on beats and impacts'),
    tags: ['digital', 'hard', 'fast'], family: 'glitch', gate: 'chroma',
    stage: 'optic', cost: 3, passes: 5, alphaSafe: false,
    shared: { amount: { auto: { range: [0.35, 0.85], follow: 'amount.chroma' } } },
    params: {
      spread: { type: 'num', min: 0, max: 48, step: 0.5, unit: 'du', label: L('ずれ幅', 'Spread'),
        auto: { range: [5, 16], follow: 'amount.chroma' } },
      angle: { type: 'num', min: -180, max: 180, step: 1, unit: 'deg', label: L('角度', 'Angle'), auto: { pick: [0, 0, 90, 30] } },
      kick: { type: 'num', min: 0, max: 4, step: 0.1, label: L('跳ね', 'Kick'), auto: { range: [1, 3], follow: 'amount.glitch' } },
    },
    apply: slip,
  });

  // --- sliceGlitch -----------------------------------------------------------------------------------------------------

  // Moves the band [y, y + bh) of src sideways by dx into g, wrapping around the frame edge (the band is cleared first,
  // so transparent frames stay transparent).
  function shiftBand(g, src, w, y, bh, dx) {
    const sx = ((Math.round(-dx) % w) + w) % w;
    g.clearRect(0, y, w, bh);
    g.drawImage(src.canvas, sx, y, w - sx, bh, 0, y, w - sx, bh);
    if (sx > 0) g.drawImage(src.canvas, 0, y, sx, bh, w - sx, y, sx, bh);
  }

  // Glitches come in bursts: a slow noise opens and closes them, impulses ('slip') and beats force them, all scaled by
  // `amount` (0 = off). The pattern — which ticks glitch, which bands, where — is read at the start of the current
  // tick of `rate`, so the bands hold still for a whole tick and every frame rate shows the same pattern; between
  // bursts the frame is left alone. Amount (which the post stack's `when` weighting changes from frame to frame) only
  // scales it: a tick's glitch fades in as amount passes its gate, and how far the bands jump, how many of them show
  // and how strongly they are tinted follow amount smoothly.
  // Bands sit anywhere, more often toward the middle of the frame (the mean of two uniform draws), where compositions
  // mostly put the words: a band across empty ground shows nothing. A shown band jumps at least 35 % of the widest
  // jump at that strength, so a glitch reads as a tear through the words, not a one-pixel wobble. Some thin bands also
  // get one or two channels inverted as a light colour cast (cyan or magenta 'difference' at under half strength: a
  // flat block of saturated colour looked like a UI bar, not damage), except in frames whose empty areas and colours
  // must stay as they are (transparent, green screen, black: see plainFrame).
  const GATE_SOFT = 0.1;
  const TINT_BAND = 0.035;           // bands taller than this share of the frame are never tinted
  function slice(fx, src, p, t) {
    const k = fx.tick(p.rate, t), tk = k / p.rate;
    const burst = smooth((fx.noise(tk * 0.7 + 17) - 0.3) / 0.45);
    const force = p.amount * (0.35 + 0.65 * burst + fx.impulse('slip', tk) + 0.5 * thumpSwell(fx, tk));
    const open = clamp((force * 1.2 - rnd(fx, k, 0)) / GATE_SOFT);
    if (!(open > 0)) return src;
    const w = fx.w, h = fx.h, level = clamp(force), tints = !plainFrame(fx);
    const out = fx.take(), g = out.ctx;
    g.drawImage(src.canvas, 0, 0);
    const most = 1 + Math.floor(rnd(fx, k, 1) * p.bands), shown = most * (0.4 + 0.6 * level);
    for (let j = 0; j < most; j++) {
      const vis = open * clamp(shown - j);
      if (!(vis > 0)) break;
      const r = rnd(fx, k, 2 + 4 * j);
      const bh = Math.max(1, Math.round((0.006 + 0.07 * r * r) * h));
      const y = Math.round(0.5 * (rnd(fx, k, 3 + 4 * j) + rnd(fx, k, 600 + j)) * (h - bh));
      const side = rnd(fx, k, 4 + 4 * j) * 2 - 1;
      const dx = Math.sign(side) * (0.35 + 0.65 * Math.abs(side)) * p.shift * fx.unit * (0.55 + 0.45 * level) * vis;
      if (Math.abs(dx) >= 0.5) shiftBand(g, src, w, y, bh, dx);
      const tinted = rnd(fx, k, 5 + 4 * j);
      if (tints && tinted < p.tint && bh <= TINT_BAND * h) {
        g.globalCompositeOperation = 'difference';
        g.globalAlpha = clamp((0.28 + 0.2 * level) * vis);
        g.fillStyle = tinted < p.tint / 2 ? '#00FFFF' : '#FF00FF';
        g.fillRect(0, y, w, bh);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = 1;
      }
    }
    return out;
  }

  const sliceGlitch = K.filter({
    key: 'sliceGlitch',
    label: L('裂け目', 'Slice glitch'),
    blurb: L('横長の帯が一定の間隔でずれて跳ねる', 'Horizontal bands jump sideways at a fixed tick rate'),
    tags: ['digital', 'hard'], family: 'glitch', gate: 'glitch',
    stage: 'shape', cost: 2, passes: 2, alphaSafe: true,
    shared: { amount: { auto: { range: [0.3, 0.8], follow: 'amount.glitch' } } },
    params: {
      bands: { type: 'int', min: 1, max: 12, label: L('帯の数', 'Bands'), auto: { range: [3, 7], follow: 'amount.glitch' } },
      shift: { type: 'num', min: 4, max: 300, step: 1, unit: 'du', label: L('ずれ幅', 'Shift'),
        auto: { range: [30, 110], follow: 'energy' } },
      rate: { type: 'num', min: 2, max: 30, step: 0.5, unit: 'Hz', label: L('切り替わる速さ', 'Rate'),
        auto: { range: [8, 15], follow: 'tempo' } },
      tint: { type: 'num', min: 0, max: 1, step: 0.05, unit: 'frac', label: L('反転する帯', 'Inverted bands'),
        auto: { range: [0.1, 0.35] }, ui: 'advanced' },
    },
    apply: slice,
  });

  return [chromaSlip, sliceGlitch];
});
