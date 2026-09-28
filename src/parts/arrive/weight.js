/* 文字PVメーカー v2 — original work. Weight entrance (v2.2, DESIGN_2_2 §4): 太る — letters appear thin and grow to the line's weight. */
MV.def('parts/arrive/weight', ['parts/kit'], (K) => {
  'use strict';

  const { clamp } = K.math;
  const FADE = K.ease('quadOut');
  const FADE_SHARE = 0.3;        // a glyph fades in over the first 30 % of its motion (it starts at its thinnest)

  // The reach of the motion: `thin` of the weight room below the face the line is laid out with (the face most of its
  // glyphs use; with the planner's grow rule that face is the bold end weight). Read at build, from the target.
  function thinPrep(env, target, p) {
    return Object.assign({}, p, { reach: Math.round(p.thin * K.weightRoom(target).below) });
  }
  const THIN_OPTS = { prep: thinPrep, wt: (p) => [-p.reach, 0] };

  // wt runs from −reach to 0 (the face's own weight) on the eased progress; exactly 0 and alpha × 1 at u = 1.
  function grow(P, g, k, u, p) {
    P.wt -= p.reach * (1 - k);
    P.alpha *= FADE(clamp(u / FADE_SHARE));
  }

  const weightGrow = K.arrive({
    key: 'weightGrow',
    label: { ja: '太る', en: 'Weight grow' },
    blurb: { ja: '細い字で現れ、太い字へ育っていく', en: 'Letters appear thin and grow bold' },
    tags: ['bold', 'slow'], family: 'weight', pool: false, late: true, optIn: 'weight', unit: 'glyph', weight: 2,
    traits: { energy: [0.1, 0.85], roles: ['lyric', 'focus', 'title'] },
    shared: {
      dur: { auto: { range: [0.7, 1.3], follow: '-energy' } }, each: { auto: { range: [0.02, 0.05] } },
      order: { auto: { pick: ['lead', 'core'], weights: [3, 1] } },
      ease: { auto: { pick: ['cubicOut', 'sineInOut'], weights: [2, 1] } },
    },
    params: {
      thin: { type: 'num', min: 0.2, max: 1, step: 0.05, unit: 'frac', label: { ja: '始まりの細さ', en: 'Start thinness' },
        auto: { value: 1 } },
    },
    make: K.perGlyph(grow, THIN_OPTS),
  });

  return [weightGrow];
});
