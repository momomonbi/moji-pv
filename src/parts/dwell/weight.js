/* 文字PVメーカー v2 — original work. Weight hold (v2.2, DESIGN_2_2 §4): 脈打つ太さ — letters swell in weight on every beat. */
MV.def('parts/dwell/weight', ['parts/kit'], (K) => {
  'use strict';

  const { smooth, TAU } = K.math;
  const L = (ja, en) => ({ ja, en });
  const RISE = 0.03;             // the swell rises over 30 ms after a beat (no jump at the beat)
  const AMP_MAX = 400;           // at most 400 weight units: |d wt/dt| stays ≤ 60 per 1/480 s (conformance)

  // Build-time params from the target: the direction (bolder when the face has the room for the swing, else lighter,
  // else toward the larger room), the amplitude (the swing scaled by 強さ, never past the room or AMP_MAX) and the
  // time the hold starts (the no-beat breathing is phased from it).
  function pulsePrep(env, target, p) {
    const room = K.weightRoom(target);
    const dirW = room.above >= p.swing ? 1 : room.below >= p.swing ? -1 : (room.above >= room.below ? 1 : -1);
    const amp = Math.max(0, Math.min(dirW > 0 ? room.above : room.below, Math.round(p.swing * (0.5 + 0.5 * p.amount)), AMP_MAX));
    return Object.assign({}, p, { dirW, amp, rest: env.times.rest });
  }

  // With a beat grid: the envelope of 拍動 (parts/dwell/lively thumpSwell) — a 30 ms rise, an exponential fall, and a
  // release to rest before the next beat (1 − phase²). Without one the weight breathes on a cosine of `period`.
  function pulse(P, g, time, w, p, fc) {
    let s;
    if (fc.beat) {
      const since = fc.beat.since, ph = fc.beat.phase;
      s = smooth(since / RISE) * Math.exp((-since * p.speed) / p.decay) * (1 - ph * ph);
    } else {
      s = 0.5 - 0.5 * Math.cos((TAU * (fc.tl - p.rest) * p.speed) / p.period);
    }
    P.wt += p.dirW * p.amp * w * s;
  }

  const weightPulse = K.dwell({
    key: 'weightPulse',
    label: L('脈打つ太さ', 'Weight pulse'),
    blurb: L('拍ごとに字が太さで脈打つ', 'Letters swell in weight on every beat'),
    tags: ['bold', 'fast'], family: 'weight', pool: false, late: true, optIn: 'weight', needs: ['beats'], weight: 0.5,
    traits: { energy: [0.35, 1], roles: ['lyric', 'focus'] },
    fits: (f) => (f.beat ? 1.2 : 0.4),
    params: {
      swing: { type: 'int', min: 100, max: 400, step: 25, label: L('振れ幅', 'Swing'), auto: { range: [150, 300], follow: 'energy' } },
      decay: { type: 'num', min: 0.1, max: 0.5, step: 0.01, unit: 's', label: L('戻り', 'Decay'), auto: { range: [0.12, 0.22], follow: '-tempo' } },
      period: { type: 'num', min: 0.6, max: 4, step: 0.1, unit: 's', label: L('周期', 'Period'), auto: { range: [1.2, 2.2], follow: '-tempo' } },
    },
    make: K.perGlyphHold(pulse, { prep: pulsePrep, wt: (p) => (p.dirW > 0 ? [0, p.amp] : [-p.amp, 0]) }),
  });

  return [weightPulse];
});
