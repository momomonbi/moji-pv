/* 文字PVメーカー v2 — original work. Print looks: a halftone dot screen, two-color printing and paper texture. */
MV.def('parts/filter/print', ['parts/kit'], (K) => {
  'use strict';

  const { clamp } = K.math;
  const L = (ja, en) => ({ ja, en });
  const ALL_ROLES = ['lyric', 'focus', 'title', 'interlude', 'outro'];
  const TILE = 128;                  // fx.tile() textures are 128 device px square
  const HALFTONE_CELL = 8;           // the 'halftone' tile has one dot per 8 device px
  const TOOTH_PX = 1.1;              // du per tooth grain (one tile pixel up to 1080p)
  const FIBRE_PX = 1.2;              // du per fibre-tile pixel

  function copyOf(fx, src) {
    const out = fx.take();
    out.ctx.drawImage(src.canvas, 0, 0);
    return out;
  }

  // Covers the frame with a texture tile drawn as images, one per tile position: `k` (a whole number) device px per
  // tile pixel, shifted by (ox, oy) px, so neighbouring tiles meet without a seam. On a canvas without a GPU a pattern
  // fill under a blend mode, a smoothed resize and a shrunk tile each cost several full-frame copies; a 1:1 tile costs
  // about one, which matters for the textures that run over every frame of a video. Larger tiles (k ≥ 2, only at high
  // output sizes) are smoothed when `smooth` asks for it.
  function tileCover(g, fx, tile, k, ox, oy, smooth) {
    const size = TILE * k;
    const x0 = -(((Math.round(ox) % size) + size) % size), y0 = -(((Math.round(oy) % size) + size) % size);
    g.imageSmoothingEnabled = smooth && k > 1;
    for (let y = y0; y < fx.h; y += size) for (let x = x0; x < fx.w; x += size) g.drawImage(tile, x, y, size, size);
    g.imageSmoothingEnabled = true;
  }

  // The tile scale for a wanted size of one tile pixel (device px): the nearest whole number, at least 1.
  function tileScale(px) { return Math.max(1, Math.round(px)); }

  // --- dotScreen -----------------------------------------------------------------------------------------------------

  // The dot tile overlaid: overlay is strongest in the mid tones and fades toward pure white and black, which is where
  // a printed halftone shows most. The tile's rows are staggered, so the dots already sit on a 45° screen. The screen's
  // pitch is a whole number of tile cells (at least one: 8 device px), the size a tile draws without resampling.
  function dots(fx, src, p) {
    const a = clamp(p.amount * 0.55);
    if (a < 1 / 64) return src;
    const out = copyOf(fx, src), g = out.ctx;
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = a;
    tileCover(g, fx, fx.tile('halftone', 0), tileScale((p.pitch * fx.unit) / HALFTONE_CELL), 0, 0, true);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    return out;
  }

  const dotScreen = K.filter({
    key: 'dotScreen',
    label: L('網点', 'Dot screen'),
    blurb: L('印刷の網点が画面全体に重なる', 'A halftone dot screen over the frame'),
    tags: ['retro', 'literary'], family: 'print', texture: true,
    stage: 'film', cost: 3, passes: 2, alphaSafe: false,
    traits: { roles: ALL_ROLES },
    params: {
      pitch: { type: 'num', min: 3, max: 32, step: 0.5, unit: 'du', label: L('網点の間隔', 'Pitch'), auto: { range: [6, 12] } },
    },
    apply: dots,
  });

  // --- duoTone -------------------------------------------------------------------------------------------------------

  // Token colors when the FxContext carries no palette (DESIGN §4.18.11 lists none; see NOTES "## WP5b2"): a neutral
  // indigo-and-cream print pair that reads on light and dark themes alike, instead of one theme's colors.
  const FALLBACK_PALETTE = Object.freeze({ ground: '#F3EAD8', ground2: '#E6DAC2', ink: '#15151A', accent: '#1E3A5F',
    shiftA: '#2F6F8F', shiftB: '#C9A15B', muted: '#8C8577' });

  function hexOf(ink, pal) {
    if (typeof ink === 'string' && /^#[0-9A-Fa-f]{6}$/.test(ink)) return ink;
    return (pal && pal[ink]) || FALLBACK_PALETTE[ink] || FALLBACK_PALETTE.accent;
  }

  function rgbOf(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); }

  // Luminosity as the 'saturation' blend keeps it (W3C compositing Lum), 0..255.
  function luma(rgb) { return 0.3 * rgb[0] + 0.59 * rgb[1] + 0.11 * rgb[2]; }

  function hexFrom(rgb) {
    return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  function grey(v) { return hexFrom([v, v, v]); }

  // The frame's luminance y mapped between the two inks, as a two-colour print does it: a pixel as dark as the darker
  // ink (or darker) prints that ink, one as light as the lighter ink (or lighter) shows that ink, and the tones between
  // spread evenly:  y' = clamp((y − Ld) / (Ll − Ld)),  out = dark + y'·(light − dark)  (Ld, Ll: the inks' luminance).
  // The ground, normally one of the two inks, keeps its exact colour and the words print in the full other ink (a map
  // that started from black lifted a dark ground toward the other ink and left light-theme words pale).
  //   y                   a 'color' fill with grey keeps each pixel's luminosity only
  //   (y − Ld)/(1 − Ld)   'color-burn' by the grey 1 − Ld: 0 at or below Ld          (skipped when Ld is 0)
  //   × k → y'            'color-dodge' by the grey 1 − 1/k, k = (1 − Ld)/(Ll − Ld): clips at 1, so anything as
  //                       light as the lighter ink or lighter prints exactly that ink (skipped when k is 1)
  //   × (light − dark)    'multiply', per channel (a channel where the lighter ink is darker stays at the dark ink's)
  //   + dark              'lighter' adds the darker ink
  // Three to five blend fills, each one full-frame pass. Mixed over the frame by amount.
  const MAX_STRETCH = 6;             // inks of almost the same luminance: their range is stretched at most this much
  function duo(fx, src, p) {
    const mix = clamp(p.amount * 1.3);
    if (mix < 1 / 64) return src;
    const pal = fx.pal || null;
    const A = rgbOf(hexOf(p.shadow, pal)), B = rgbOf(hexOf(p.light, pal));
    const [dark, light] = luma(A) <= luma(B) ? [A, B] : [B, A];
    const Ld = luma(dark) / 255, Ll = luma(light) / 255;
    const k = Math.min(MAX_STRETCH, (1 - Ld) / Math.max(1e-3, Ll - Ld));
    const tone = copyOf(fx, src), gt = tone.ctx;
    gt.globalCompositeOperation = 'color';
    gt.fillStyle = '#808080';
    gt.fillRect(0, 0, fx.w, fx.h);
    if (Ld >= 0.5 / 255) {
      gt.globalCompositeOperation = 'color-burn';
      gt.fillStyle = grey(255 * (1 - Ld));
      gt.fillRect(0, 0, fx.w, fx.h);
    }
    if (k > 1 + 0.5 / 255) {
      gt.globalCompositeOperation = 'color-dodge';
      gt.fillStyle = grey(255 * (1 - 1 / k));
      gt.fillRect(0, 0, fx.w, fx.h);
    }
    gt.globalCompositeOperation = 'multiply';
    gt.fillStyle = hexFrom(light.map((v, i) => v - dark[i]));
    gt.fillRect(0, 0, fx.w, fx.h);
    gt.globalCompositeOperation = 'lighter';
    gt.fillStyle = hexFrom(dark);
    gt.fillRect(0, 0, fx.w, fx.h);
    gt.globalCompositeOperation = 'source-over';
    if (mix >= 1 - 1 / 64) return tone;
    const out = copyOf(fx, src), g = out.ctx;
    g.globalAlpha = mix;
    g.drawImage(tone.canvas, 0, 0);
    g.globalAlpha = 1;
    fx.give(tone);
    return out;
  }

  const duoTone = K.filter({
    key: 'duoTone',
    label: L('二色刷り', 'Duo tone'),
    blurb: L('画面を地の色とアクセント色の二色に刷り直す', 'The frame remapped to two colors, the ground and the accent'),
    tags: ['retro', 'literary'], family: 'print',
    stage: 'tone', cost: 5, passes: 8, alphaSafe: false,
    traits: { roles: ALL_ROLES },
    params: {
      shadow: { type: 'ink', label: L('濃い側の色', 'Shadow ink'), auto: { pick: ['accent', 'shiftA', 'ink'], weights: [4, 2, 1] } },
      light: { type: 'ink', label: L('明るい側の色', 'Light ink'), auto: { value: 'ground' } },
    },
    apply: duo,
  });

  // --- paperTooth ----------------------------------------------------------------------------------------------------

  // A still paper surface printed over the frame: fine uneven tooth (the grain tile overlaid, crisp) and a few fibres.
  // It does not move: paper stays put while the words move. Both are drawn tile pixel to device pixel (or whole
  // multiples at high output sizes), which keeps this texture — it runs over every frame — at about three copies.
  // The fibres are mostly light strokes: on light paper they barely show, but on a dark ground (a dark theme with
  // this texture, or the black backdrop) at full strength they read as hairs and the fibre tile's repeat shows. They
  // are therefore scaled by how light the ground is (fibreShow).
  function paper(fx, src, p) {
    const a = clamp(p.amount);
    if (a < 0.02) return src;
    const out = copyOf(fx, src), g = out.ctx;
    g.globalCompositeOperation = 'overlay';
    g.globalAlpha = clamp(a * (0.08 + 0.3 * p.tooth));
    tileCover(g, fx, fx.tile('grain', 3), tileScale(TOOTH_PX * fx.unit), 0, 0, false);
    g.globalCompositeOperation = 'source-over';
    const fibres = clamp(a * p.fibre * fibreShow(fx));
    if (fibres >= 1 / 255) {
      g.globalAlpha = fibres;
      tileCover(g, fx, fx.tile('fiber', 5), tileScale(FIBRE_PX * fx.unit), 37, 11, true);
    }
    g.globalAlpha = 1;
    return out;
  }

  // 0.3 on a black ground … 1 on a white one (the frame palette's ground; 1 without a palette). None on the black
  // backdrop (DESIGN §4.19.4: white text only; the frame is laid over other footage): grain and dots vanish on its
  // black by themselves, the light fibres would not.
  const DARK_FIBRE = 0.3;
  function fibreShow(fx) {
    const pal = fx.pal, ground = pal && pal.ground;
    if (typeof ground !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(ground)) return 1;
    if (ground === '#000000' && String(pal.ink).toUpperCase() === '#FFFFFF') return 0;
    return DARK_FIBRE + (1 - DARK_FIBRE) * (luma(rgbOf(ground)) / 255);
  }

  const paperTooth = K.filter({
    key: 'paperTooth',
    label: L('紙の目', 'Paper tooth'),
    blurb: L('紙のざらつきと繊維が画面に重なる', 'A paper texture over the frame'),
    tags: ['organic', 'literary'], family: 'print', texture: true,
    stage: 'film', cost: 3, passes: 3, alphaSafe: false,
    traits: { roles: ALL_ROLES },
    params: {
      tooth: { type: 'num', min: 0, max: 1, step: 0.05, unit: 'frac', label: L('ざらつき', 'Tooth'), auto: { range: [0.4, 0.7] } },
      fibre: { type: 'num', min: 0, max: 1, step: 0.05, unit: 'frac', label: L('繊維', 'Fibres'), auto: { range: [0.15, 0.35] } },
    },
    apply: paper,
  });

  return [dotScreen, duoTone, paperTooth];
});
