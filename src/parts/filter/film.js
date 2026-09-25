/* 文字PVメーカー v2 — original work. Film surface: animated grain, scanlines, dust and scratches. */
MV.def('parts/filter/film', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, TAU } = K.math;
  const L = (ja, en) => ({ ja, en });
  const ALL_ROLES = ['lyric', 'focus', 'title', 'interlude', 'outro'];
  const TILE = 128;                  // fx.tile() textures are 128 device px square

  // These three are textures too (the work-level `texture` slot runs them over the whole video with fx.cut = null).
  // They change on fx.tick(rate, t), so a 60 fps preview and a 30 fps export show the same pattern at the same instant.

  function rnd(fx, k, j) { return fx.noise(k * 1024 + j); }

  // Pooled surfaces come back with their transform, alpha and blend reset, but not the line state an earlier user set
  // (caps, joins, dashes): a part that strokes sets all of it, or a frame would depend on what was drawn before it.
  const NO_DASH = Object.freeze([]);
  function lineState(g, width) {
    g.lineWidth = width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.setLineDash(NO_DASH);
  }

  // Covers the frame with a texture tile drawn as images, one per tile position: `k` (a whole number) device px per
  // tile pixel, shifted by (ox, oy) px, so neighbouring tiles meet without a seam. On a canvas without a GPU a pattern
  // fill under a blend mode, a smoothed resize and a shrunk tile each cost several full-frame copies; a 1:1 tile costs
  // about one, which matters for the textures that run over every frame of a video.
  function tileCover(g, fx, tile, k, ox, oy, smooth) {
    const size = TILE * k;
    const x0 = -(((Math.round(ox) % size) + size) % size), y0 = -(((Math.round(oy) % size) + size) % size);
    g.imageSmoothingEnabled = smooth && k > 1;
    for (let y = y0; y < fx.h; y += size) for (let x = x0; x < fx.w; x += size) g.drawImage(tile, x, y, size, size);
    g.imageSmoothingEnabled = true;
  }

  // The tile scale for a wanted size of one tile pixel (device px): the nearest whole number, at least 1.
  function tileScale(px) { return Math.max(1, Math.round(px)); }

  // --- grainFilm (fallback) --------------------------------------------------------------------------------------------

  // Grey grain overlaid: mid-grey is neutral, so the grain lightens and darkens around every tone, light or dark. The
  // grain is drawn crisp (no smoothing), one tile pixel per whole number of device px.
  function grain(fx, src, p, t) {
    const a = clamp(p.amount * 0.55);
    if (a < 1 / 64) return src;
    const k = fx.tick(p.rate, t);
    const out = fx.own(src), g = out.ctx;
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = a;
    tileCover(g, fx, fx.tile('grain', k), tileScale(p.size * fx.unit), rnd(fx, k, 0) * TILE, rnd(fx, k, 1) * TILE, false);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    return out;
  }

  const grainFilm = K.filter({
    key: 'grainFilm',
    label: L('粒子', 'Film grain'),
    blurb: L('フィルムの粒子が細かくざわめく', 'Animated film grain'),
    tags: ['retro', 'organic'], family: 'grain', fallback: true, texture: true,
    stage: 'film', cost: 3, passes: 2, alphaSafe: false,
    traits: { roles: ALL_ROLES },
    params: {
      size: { type: 'num', min: 0.5, max: 6, step: 0.1, unit: 'du', label: L('粒の大きさ', 'Grain size'), auto: { range: [1.3, 2.2] } },
      rate: { type: 'num', min: 4, max: 30, step: 1, unit: 'Hz', label: L('ざわめく速さ', 'Rate'), auto: { pick: [12, 24, 24] } },
    },
    apply: grain,
  });

  // --- rasterLines ---------------------------------------------------------------------------------------------------

  // Dark scanlines at a fixed pitch (never finer than 2 device px, or they would shimmer), drawn as one path of whole-pixel
  // rows, plus an optional bright band that rolls slowly down the screen like an old monitor.
  function raster(fx, src, p, t) {
    const pitch = Math.max(2, p.pitch * fx.unit), line = Math.max(1, Math.round(pitch * 0.35));
    const a = clamp((p.amount * 0.14 * pitch) / line);          // the same average darkening at any pitch
    if (a < 1 / 64) return src;
    const out = fx.own(src), g = out.ctx;
    g.globalAlpha = a;
    g.fillStyle = '#000000';
    g.beginPath();
    for (let y = 0; y < fx.h; y += pitch) g.rect(0, Math.round(y), fx.w, line);
    g.fill();
    if (p.roll > 0) {
      const bh = fx.h * 0.22, y = ((t * p.roll * 0.35) % 1) * (fx.h + bh) - bh;
      const grad = g.createLinearGradient(0, y, 0, y + bh);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.globalCompositeOperation = 'soft-light';
      g.globalAlpha = clamp(p.amount * 0.6);
      g.fillStyle = grad;
      g.fillRect(0, y, fx.w, bh);
      g.globalCompositeOperation = 'source-over';
    }
    g.globalAlpha = 1;
    return out;
  }

  const rasterLines = K.filter({
    key: 'rasterLines',
    label: L('走査線', 'Raster lines'),
    blurb: L('細い横縞の走査線が画面に重なる', 'Fine horizontal scanlines'),
    tags: ['retro', 'digital'], family: 'screen', texture: true,
    stage: 'film', cost: 2, passes: 2, alphaSafe: false,
    traits: { roles: ALL_ROLES },
    params: {
      pitch: { type: 'num', min: 2, max: 10, step: 0.1, unit: 'du', label: L('線の間隔', 'Pitch'), auto: { range: [2.8, 4.2] } },
      roll: { type: 'num', min: 0, max: 1, step: 0.05, unit: 'frac', label: L('流れる明るい帯', 'Rolling band'),
        auto: { pick: [0, 0.4, 0.7], weights: [2, 2, 1] } },
    },
    apply: raster,
  });

  // --- dustSpecks ----------------------------------------------------------------------------------------------------

  // Every tick a new handful of specks (a few are hairs) and, now and then, a vertical scratch that wanders slowly
  // (it moves on the same ticks, so the whole pattern holds still between them).
  // Dust is dark on the print and light where the negative was hit, so both appear.
  // The tick alone decides the layout: where the specks are and in which order they appear. Amount (which the post
  // stack's `when` weighting changes from frame to frame) only decides how many of them show, fading the last one in
  // or out, and how strongly — so within a tick specks fade, they never jump.
  function dust(fx, src, p, t) {
    const a = clamp(p.amount);
    if (a < 0.02) return src;
    const k = fx.tick(p.rate, t);
    const out = fx.own(src), g = out.ctx;
    lineState(g, Math.max(0.6, 1.3 * fx.unit));
    const draft = fx.quality === 'draft' ? 0.5 : 1;
    const most = Math.round(p.specks * 1.2 * draft), shown = p.specks * (0.4 + 0.8 * a) * draft;
    const u = fx.unit;
    for (let j = 0; j < most; j++) {
      const vis = clamp(shown - j);
      if (vis <= 0) break;
      const x = rnd(fx, k, 5 * j) * fx.w, y = rnd(fx, k, 5 * j + 1) * fx.h;
      const s = rnd(fx, k, 5 * j + 2), dark = rnd(fx, k, 5 * j + 3) < 0.55, bend = rnd(fx, k, 5 * j + 4);
      const ink = dark ? '#16120E' : '#FFFFFF';
      g.globalAlpha = clamp(a * (0.45 + 0.5 * s) * vis);
      if (s > 0.86) {
        const len = (14 + 26 * bend) * u;
        g.strokeStyle = ink;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + len * 0.6, y + len * (bend - 0.5), x + len, y + len * 0.3);
        g.stroke();
      } else {
        g.fillStyle = ink;
        g.beginPath();
        g.arc(x, y, Math.max(0.5, (1 + 4 * s * s * s) * u), 0, TAU);
        g.fill();
      }
    }
    const slow = Math.floor(t * 0.8);
    if (rnd(fx, slow, 900) < p.scratch) {
      const x = (0.1 + 0.8 * fx.noise((k / p.rate) * 0.4 + 300)) * fx.w;
      g.globalAlpha = clamp(a * (0.25 + 0.25 * rnd(fx, k, 901)));
      g.fillStyle = rnd(fx, slow, 902) < 0.5 ? '#FFFFFF' : '#16120E';
      g.fillRect(x, 0, Math.max(1, 1.2 * u), fx.h);
    }
    g.globalAlpha = 1;
    return out;
  }

  const dustSpecks = K.filter({
    key: 'dustSpecks',
    label: L('ほこり', 'Dust specks'),
    blurb: L('ほこりと細かな傷がちらつく', 'Dust and fine scratches'),
    tags: ['retro', 'organic'], family: 'grain', texture: true,
    stage: 'film', cost: 1, passes: 1, alphaSafe: false,
    traits: { roles: ALL_ROLES },
    params: {
      specks: { type: 'int', min: 2, max: 80, label: L('ほこりの数', 'Specks'), auto: { range: [10, 26] } },
      rate: { type: 'num', min: 2, max: 24, step: 1, unit: 'Hz', label: L('入れ替わる速さ', 'Rate'), auto: { pick: [8, 12, 12] } },
      scratch: { type: 'num', min: 0, max: 1, step: 0.05, unit: 'frac', label: L('傷の出やすさ', 'Scratches'), auto: { range: [0.2, 0.5] } },
    },
    apply: dust,
  });

  return [grainFilm, rasterLines, dustSpecks];
});
