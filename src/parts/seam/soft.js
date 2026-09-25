/* 文字PVメーカー v2 — original work. Text transitions: the hard cut, a soft dissolve and an ink-blot bleed. */
MV.def('parts/seam/soft', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, TAU } = K.math;
  const L = (ja, en) => ({ ja, en });
  const SINE = K.ease('sineInOut');
  const CREEP = K.ease('quadIn');

  // Text seams (§4.19.2 step 4) receive only the text and near layers of the two cuts: a holds the old cut's words,
  // b the new cut's, both transparent elsewhere; the ground is drawn once underneath. u runs 0 → 1 across the window
  // centred on the new cut's start, so b's own entrance begins at u = 0.5.

  // --- hardCut (fallback) --------------------------------------------------------------------------------------------

  // No transition: both cuts drawn as they are, exactly what the frame shows without a seam. The planner never lists
  // it in Plan.seams; this only runs when a hand-made plan does.
  function hard(fx, a, b) {
    const out = fx.take(), g = out.ctx;
    g.drawImage(a.canvas, 0, 0);
    g.drawImage(b.canvas, 0, 0);
    return out;
  }

  const hardCut = K.seam({
    key: 'hardCut',
    label: L('直結', 'Hard cut'),
    blurb: L('切り替え効果を使わずにそのまま次のカットへ', 'No transition: the next cut simply follows'),
    tags: ['minimal'], family: 'cut', scope: 'text', fallback: true,
    mix: hard,
  });

  // --- blendDissolve -------------------------------------------------------------------------------------------------

  // A crossfade in which the old words also soften (blur) as they fade, so they melt rather than just dim. The two
  // curves overlap only partly: the old words go over [0, OLD_OUT] of the window and grow soft (up to 1.6 × `soften`),
  // the new ones come in over [NEW_IN, 1]. With one shared curve both lines stood at half strength, both sharp, in the
  // same place mid-window — two lyrics printed over each other; now the new words firm up over a fading smudge.
  const OLD_OUT = 0.7, NEW_IN = 0.2, NEW_FULL = 0.8, SOFTEN_PEAK = 1.6;
  function dissolve(fx, a, b, u, p) {
    const eo = SINE(clamp(u / OLD_OUT)), en = SINE(clamp((u - NEW_IN) / (NEW_FULL - NEW_IN)));
    const out = fx.take(), g = out.ctx;
    const px = p.soften * SOFTEN_PEAK * eo * fx.unit;
    const old = px >= 1 && eo < 1 ? fx.blurred(a, px) : a;
    g.globalAlpha = clamp(1 - eo);
    if (eo < 1) g.drawImage(old.canvas, 0, 0);
    g.globalAlpha = clamp(en);
    if (en > 0) g.drawImage(b.canvas, 0, 0);
    g.globalAlpha = 1;
    if (old !== a) fx.give(old);
    return out;
  }

  const blendDissolve = K.seam({
    key: 'blendDissolve',
    label: L('溶け合い', 'Blend dissolve'),
    blurb: L('前の文字がぼやけながら次の文字へ溶けていく', 'The old text softens and dissolves into the new'),
    tags: ['soft', 'slow'], family: 'fade', scope: 'text',
    traits: { energy: [0, 0.75] },
    shared: { dur: { auto: { range: [0.45, 0.9], follow: '-energy' } } },
    params: {
      soften: { type: 'num', min: 0, max: 40, step: 0.5, unit: 'du', label: L('ぼかし', 'Soften'), auto: { range: [6, 16] } },
    },
    mix: dissolve,
  });

  // --- sumiSeep ------------------------------------------------------------------------------------------------------

  // Ink blots spread from seeded points near the middle of the frame; inside them the new words show, outside them the
  // old words remain. Each blot is a circle with a wavy rim (three seeded sine harmonics, so the outline closes
  // smoothly) that starts at its own time, creeps at first and then floods, and would cover the whole frame on its own
  // by u = 1. The mask's edge is feathered, so the ink soaks rather than cuts.
  const RIM_POINTS = 36;
  const MARGIN = 2;                  // small-mask px around the frame (see bleed)

  function blotPath(g, cx, cy, r, p3, p5, p9) {
    for (let j = 0; j <= RIM_POINTS; j++) {
      const th = (TAU * j) / RIM_POINTS;
      const k = 1 + 0.09 * Math.sin(3 * th + p3) + 0.06 * Math.sin(5 * th + p5) + 0.04 * Math.sin(9 * th + p9);
      const x = cx + Math.cos(th) * r * k, y = cy + Math.sin(th) * r * k;
      if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
  }

  function farthestCorner(w, h, x, y) { return Math.hypot(Math.max(x, w - x), Math.max(y, h - y)); }

  // The mask is painted small, at 1/f of the frame (f = the power of two nearest twice the feather), with a margin of
  // MARGIN small px on every side, and stretched to full size once: the smoothed stretch is the feather (a ramp about
  // f px wide) and costs one full-frame pass, where blurring a full-size mask costs several. The margin keeps the
  // ramp's fade toward the empty outside beyond the frame edge, so a blot that covers the frame covers it right to the
  // edges. The mask is only read after that: it cuts the new words in (destination-in) and the old ones out
  // (destination-out).
  function featherScale(px) { return Math.pow(2, Math.max(1, Math.min(5, Math.round(Math.log2(Math.max(1, 2 * px)))))); }

  function bleed(fx, a, b, u, p) {
    const w = fx.w, h = fx.h, f = featherScale(p.soft * fx.unit);
    const small = fx.take(), gs = small.ctx;
    gs.setTransform(1 / f, 0, 0, 1 / f, MARGIN, MARGIN);
    gs.fillStyle = '#000000';
    gs.beginPath();
    for (let k = 0; k < p.blots; k++) {
      const base = 16 * k;
      const cx = (0.18 + 0.64 * fx.noise(base + 1)) * w, cy = (0.28 + 0.44 * fx.noise(base + 2)) * h;
      const start = p.stagger * fx.noise(base + 3);
      const grow = CREEP(clamp((u - start) / (1 - start)));
      const r = grow * (farthestCorner(w, h, cx, cy) + 2 * f) * 1.3;
      if (r < 0.5) continue;
      blotPath(gs, cx, cy, r, TAU * fx.noise(base + 4), TAU * fx.noise(base + 5), TAU * fx.noise(base + 6));
    }
    gs.fill();
    gs.setTransform(1, 0, 0, 1, 0, 0);
    const mask = fx.take();
    mask.ctx.drawImage(small.canvas, MARGIN, MARGIN, w / f, h / f, 0, 0, w, h);
    fx.give(small);
    const inside = fx.take(), gi = inside.ctx;
    gi.drawImage(b.canvas, 0, 0);
    gi.globalCompositeOperation = 'destination-in';
    gi.drawImage(mask.canvas, 0, 0);
    gi.globalCompositeOperation = 'source-over';
    const out = fx.take(), g = out.ctx;
    g.drawImage(a.canvas, 0, 0);
    g.globalCompositeOperation = 'destination-out';
    g.drawImage(mask.canvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(inside.canvas, 0, 0);
    fx.give(mask);
    fx.give(inside);
    return out;
  }

  const sumiSeep = K.seam({
    key: 'sumiSeep',
    label: L('墨にじみ', 'Ink bleed'),
    blurb: L('広がる墨のしみの中から次の文字がにじみ出る', 'The new text bleeds in through spreading ink blots'),
    tags: ['organic', 'literary'], family: 'ink', scope: 'text', replaces: { depart: true },
    traits: { energy: [0, 0.75] },
    shared: { dur: { auto: { range: [0.6, 1], follow: '-energy' } } },
    params: {
      blots: { type: 'int', min: 1, max: 7, label: L('しみの数', 'Blots'), auto: { range: [3, 5] } },
      soft: { type: 'num', min: 1, max: 40, step: 0.5, unit: 'du', label: L('にじみ', 'Feather'), auto: { range: [8, 16] } },
      stagger: { type: 'num', min: 0, max: 0.7, step: 0.05, unit: 'frac', label: L('広がり始めのずれ', 'Stagger'),
        auto: { range: [0.2, 0.45] }, ui: 'advanced' },
    },
    mix: bleed,
  });

  return [hardCut, blendDissolve, sumiSeep];
});
