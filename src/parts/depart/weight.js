/* 文字PVメーカー v2 — original work. Weight exit (v2.2, DESIGN_2_2 §4): 細る — letters thin out and fade. */
MV.def('parts/depart/weight', ['parts/kit'], (K) => {
  'use strict';

  const { clamp } = K.math;
  const FADE_IN = K.ease('quadIn');
  const FADE_FROM = 0.6;         // a glyph keeps its alpha for the first 60 % of its motion, then fades out

  // The reach: `thin` of the weight room below the line's face (as 太る, parts/arrive/weight).
  function thinPrep(env, target, p) {
    return Object.assign({}, p, { reach: Math.round(p.thin * K.weightRoom(target).below) });
  }
  const THIN_OPTS = { prep: thinPrep, wt: (p) => [-p.reach, 0] };

  // wt runs from 0 to −reach; at u = 0 exactly the rest pose (K.depart re-wraps the maker as an exit: it starts at
  // times.out and runs after it).
  function thin(P, g, k, u, p) {
    P.wt -= p.reach * k;
    P.alpha *= 1 - FADE_IN(clamp((u - FADE_FROM) / (1 - FADE_FROM)));
  }

  const weightThin = K.depart({
    key: 'weightThin',
    label: { ja: '細る', en: 'Weight thin' },
    blurb: { ja: '字が細くなりながら消えていく', en: 'Letters thin out and fade' },
    tags: ['soft', 'slow'], family: 'weight', pool: false, late: true, optIn: 'weight', unit: 'glyph',
    traits: { energy: [0.05, 0.7], roles: ['lyric', 'focus', 'title'] },
    shared: {
      dur: { auto: { range: [0.5, 0.9], follow: '-energy' } }, each: { auto: { range: [0.01, 0.03] } },
      order: { auto: { pick: ['lead', 'tail'], weights: [2, 1] } },
      ease: { auto: { pick: ['sineIn', 'quadIn'], weights: [2, 1] } },
    },
    params: {
      thin: { type: 'num', min: 0.2, max: 1, step: 0.05, unit: 'frac', label: { ja: '終わりの細さ', en: 'End thinness' },
        auto: { value: 1 } },
    },
    make: K.perGlyph(thin, THIN_OPTS),
  });

  return [weightThin];
});
