/* 文字PVメーカー v2 — original work. The glyph morph (v2.2, DESIGN_2_2 §4, M4): letters the two lines share glide to their new places, the others melt. */
MV.def('parts/seam/morph', ['parts/kit'], (K) => {
  'use strict';

  const { clamp } = K.math;
  const L = (ja, en) => ({ ja, en });
  const SINE = K.ease('sineInOut');

  // A glyph seam (`glyphs: true`): the planner writes the letters the two lines share into the seam entry, and the
  // renderer holds those glyphs out of the two side surfaces and draws them itself, travelling from the old line's
  // place to the new line's (engine/render/morph). mix() melts what is left: the old line's other letters soften and
  // fade over [0, OLD_OUT], the new line's come into focus over [NEW_IN, NEW_FULL]; both at once only in the middle,
  // each blurred while it is faint, so neither reads as a second line printed over the first. The window ends at the
  // new line's start (`ends`) and takes up to half the shorter cut (`share`); the old line's exit and the new line's
  // entrance are the transition itself (`replaces`).
  const OLD_OUT = 0.6, NEW_IN = 0.35, NEW_FULL = 0.95, SOFTEN_PEAK = 1.4;
  function meltRest(fx, a, b, u, p) {
    const eo = SINE(clamp(u / OLD_OUT)), en = SINE(clamp((u - NEW_IN) / (NEW_FULL - NEW_IN)));
    const out = fx.take(), g = out.ctx;
    const pa = p.soften * SOFTEN_PEAK * eo * fx.unit, pb = p.soften * SOFTEN_PEAK * (1 - en) * fx.unit;
    const oldS = pa >= 1 && eo < 1 ? fx.blurred(a, pa) : a;
    const newS = pb >= 1 && en > 0 ? fx.blurred(b, pb) : b;
    g.globalAlpha = clamp(1 - eo);
    if (eo < 1) g.drawImage(oldS.canvas, 0, 0);
    g.globalAlpha = clamp(en);
    if (en > 0) g.drawImage(newS.canvas, 0, 0);
    g.globalAlpha = 1;
    if (oldS !== a) fx.give(oldS);
    if (newS !== b) fx.give(newS);
    return out;
  }

  const glyphMorph = K.seam({
    key: 'glyphMorph',
    label: L('モーフ', 'Glyph morph'),
    blurb: L('前の行と同じ字が次の位置へ移り、ちがう字は溶けて入れ替わる',
      'Letters the two lines share glide to their new places; the others melt into the new text'),
    tags: ['soft', 'literary'], family: 'morph', scope: 'text', replaces: { depart: true, arrive: true },
    pool: false, late: true, glyphs: true, share: 0.5, ends: true,
    shared: { dur: { auto: { range: [0.5, 0.9], follow: '-energy' } } },
    params: {
      arc: { type: 'num', min: 0, max: 0.5, step: 0.01, unit: 'frac', label: L('弧', 'Arc'), auto: { value: 0.12 } },
      spread: { type: 'num', min: 0, max: 0.6, step: 0.01, unit: 'frac', label: L('ずらし', 'Stagger'),
        auto: { range: [0.1, 0.25] }, ui: 'advanced' },
      melt: { type: 'enum', of: ['swap', 'fade'], optKey: 'melt', label: L('ちがう字', 'Other letters'), auto: { value: 'swap' } },
      soften: { type: 'num', min: 0, max: 30, step: 0.5, unit: 'du', label: L('ぼかし', 'Soften'), auto: { range: [6, 12] } },
    },
    mix: meltRest,
  });

  return [glyphMorph];
});
