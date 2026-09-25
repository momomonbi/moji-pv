/* 文字PVメーカー v2 — original work. Small numeric helpers shared by every layer (DESIGN §4.1.4). */
MV.def('core/num', [], () => {
  'use strict';
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  function clamp(x, lo = 0, hi = 1) { return x < lo ? lo : x > hi ? hi : x; }

  function lerp(a, b, t) { return a + (b - a) * t; }

  // Position of x between a and b (0 at a, 1 at b); 0 when a === b.
  function invLerp(a, b, x) { return a === b ? 0 : (x - a) / (b - a); }

  function remap(x, a0, a1, b0, b1) { return lerp(b0, b1, invLerp(a0, a1, x)); }

  // Smoothstep of t clamped to [0, 1].
  function smooth(t) {
    const u = clamp(t);
    return u * u * (3 - 2 * u);
  }

  function fract(x) { return x - Math.floor(x); }

  // Wraps x into [lo, hi) (hi > lo). Uses the remainder, so whole turns come out exact: wrap(370, 0, 360) === 10.
  function wrap(x, lo, hi) {
    const span = hi - lo;
    if (!(span > 0)) return lo;
    const r = (x - lo) % span;
    const out = lo + (r < 0 ? r + span : r);
    return out < hi ? out : lo;
  }

  function q6(x) { return Math.round(x * 1e6) / 1e6; }

  function approxEq(a, b, eps = 1e-9) { return Math.abs(a - b) <= eps; }

  return { clamp, lerp, invLerp, remap, smooth, fract, wrap, q6, approxEq, TAU, DEG };
});
