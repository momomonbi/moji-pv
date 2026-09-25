/* 文字PVメーカー v2 — original work. Framing: darkened corners and letterbox bars. */
MV.def('parts/filter/frame', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, smooth } = K.math;
  const L = (ja, en) => ({ ja, en });
  const ALL_ROLES = ['lyric', 'focus', 'title', 'interlude', 'outro'];
  // Compositions that set words against the top or bottom edge, where letterbox bars would cover them.
  const EDGE_HUGGERS = Object.freeze(['cornerNote', 'hangingTags', 'tickerMarquee']);

  // --- edgeShade -----------------------------------------------------------------------------------------------------

  // A vignette: an elliptical radial gradient (the frame's own proportions) from clear inside `size` to dark at the
  // corners. The alpha rises with the square of the distance (a few stops approximate it), so there is no visible ring.
  // The gradient is the same picture on every frame of one size, and filling a whole frame with a radial gradient is
  // slow on a canvas without a GPU (fx_parts: 20 frame copies at 720p in CI's Chrome, 8 in Chromium), so it is painted once
  // at full strength (alpha u²) into a kept layer (fx.layer, per `size` and frame size) and laid over the frame at
  // alpha `dark` (alpha dark·u², as before, within 8-bit rounding): one copy and one draw per frame.
  // Its darkness fades to nothing with amount (the ramp below 0.1), so a `when` other than 'always' fades it in and
  // out instead of switching it.
  const SHADE_STOPS = 4;
  const SHADE_INK = '#120D08';          // a warm near-black: old lenses fall off toward brown, not grey
  function vignette(g, w, h, size) {
    const R = (w / 2) * Math.SQRT2 * 1.02, r0 = R * size;
    g.translate(w / 2, h / 2);
    g.scale(1, h / w);
    const grad = g.createRadialGradient(0, 0, r0, 0, 0, R);
    for (let k = 0; k <= SHADE_STOPS; k++) {
      const u = k / SHADE_STOPS;
      grad.addColorStop(u, K.color.rgba(SHADE_INK, u * u));
    }
    g.fillStyle = grad;
    g.fillRect(-R, -R, 2 * R, 2 * R);
  }

  function shade(fx, src, p) {
    const dark = clamp(0.12 + 0.45 * p.amount) * smooth(p.amount / 0.1);
    if (!(dark >= 1 / 255)) return src;
    const size = p.size;
    const layer = fx.layer('edgeShade:' + size, (g, w, h) => vignette(g, w, h, size));
    const out = fx.own(src), g = out.ctx;
    g.globalAlpha = dark;
    g.drawImage(layer, 0, 0);
    g.globalAlpha = 1;
    return out;
  }

  const edgeShade = K.filter({
    key: 'edgeShade',
    label: L('周辺減光', 'Edge shade'),
    blurb: L('画面の四隅がゆるやかに暗くなる', 'Darkened corners, like an old lens'),
    tags: ['dark', 'slow'], family: 'vignette',
    stage: 'film', cost: 3, passes: 2, alphaSafe: false,
    traits: { roles: ALL_ROLES },
    params: {
      size: { type: 'num', min: 0.1, max: 0.9, step: 0.05, unit: 'frac', label: L('明るく残す広さ', 'Clear area'),
        auto: { range: [0.35, 0.55] } },
    },
    apply: shade,
  });

  // --- cinemaBars ----------------------------------------------------------------------------------------------------

  // Black bars at the top and bottom, `size` × the frame's short side high at amount 0.5 (so a tall frame gets bands,
  // not half its height in black). Their height follows `amount` (0 = none), so a `when` other than 'always' makes
  // them slide in and out with the cut.
  function bars(fx, src, p) {
    const bh = Math.round(clamp(p.size * Math.min(2 * p.amount, 1.5), 0, 0.3) * Math.min(fx.w, fx.h));
    if (bh < 1) return src;
    const out = fx.own(src), g = out.ctx;
    g.fillStyle = '#000000';
    g.fillRect(0, 0, fx.w, bh);
    g.fillRect(0, fx.h - bh, fx.w, bh);
    return out;
  }

  const cinemaBars = K.filter({
    key: 'cinemaBars',
    label: L('帯', 'Cinema bars'),
    blurb: L('画面の上下に映画のような黒い帯が入る', 'Letterbox bars at the top and bottom'),
    tags: ['serious'], family: 'letterbox',
    shared: { amount: { auto: { range: [0.45, 0.6] } } },
    stage: 'shape', cost: 1, passes: 1, alphaSafe: false,
    traits: { roles: ALL_ROLES },
    fits: (f, chosen) => (EDGE_HUGGERS.includes(chosen && chosen.arrange) ? 0.1 : 1),
    params: {
      size: { type: 'num', min: 0.03, max: 0.2, step: 0.005, unit: 'frac', label: L('帯の太さ', 'Bar height'),
        auto: { range: [0.08, 0.12] } },
    },
    apply: bars,
  });

  return [edgeShade, cinemaBars];
});
