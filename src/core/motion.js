/* 文字PVメーカー v2 — original work. Fitting entrance/exit stagger into a cut window, and the cut's hero time (DESIGN §4.7). */
MV.def('core/motion', [], () => {
  'use strict';
  // The FROZEN option name `window` is always a local number here (a parameter or a const). The L0–L5 lint accepts
  // it inside that binding's scope, as long as it is never used as an object. See docs/NOTES.md ("WP0 review fixes").

  const SHARE = Object.freeze({ arrive: 0.45, depart: 0.35 });   // max share of the window (b − a) a motion may take
  const MIN_DUR = 0.12;

  function nonNegative(x) { return x > 0 ? x : 0; }

  // Shrinks the stagger first, then the duration, so that dur + each·(count − 1) fits share·window.
  // Planner (repT) and scene (stagger) both call this, so they always agree.
  function fitMotion({ dur, each, count, window, share = 1 }) {
    const d = nonNegative(dur), e = nonNegative(each);
    const gaps = Number.isFinite(count) && count > 1 ? Math.floor(count) - 1 : 0;
    const limit = share * nonNegative(window);
    const total = d + e * gaps;
    if (total <= limit) return { dur: d, each: e, total };
    if (d < limit && gaps > 0) return { dur: d, each: (limit - d) / gaps, total: limit };
    const fitted = Math.max(MIN_DUR, limit);
    return { dur: fitted, each: 0, total: fitted };
  }

  // repT: the moment the entrance has finished, plus 10% of the calm stretch before the exit; clamped to [a, b).
  // cut = { a, b }; arrive / depart = { dur, each } (null = instant); count = number of stagger units.
  function heroTime(cut, arrive, depart, count) {
    const a = cut.a, b = cut.b, window = b - a;
    const A = fitMotion({ ...motionOf(arrive), count, window, share: SHARE.arrive }).total;
    const L = fitMotion({ ...motionOf(depart), count, window, share: SHARE.depart }).total;
    const t = a + A + 0.1 * Math.max(0, (b - L) - (a + A));
    return clampHalfOpen(t, a, b);
  }

  function motionOf(m) { return m ? { dur: m.dur, each: m.each } : { dur: 0, each: 0 }; }

  // Clamp into [a, b): values at or past b map to a double just below b.
  function clampHalfOpen(t, a, b) {
    if (!(b > a)) return a;
    if (t < a) return a;
    if (t < b) return t;
    const below = b - Math.max(Math.abs(b), 1) * Number.EPSILON;
    return below >= a ? below : a;
  }

  return { SHARE, MIN_DUR, fitMotion, heroTime };
});
