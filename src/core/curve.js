/* 文字PVメーカー v2 — original work. Speed curves (緩急): one canonical value for eases, presets, Béziers and speed ramps (DESIGN_2_1 §2.4, §3.2, §4.1). */
MV.def('core/curve', ['core/ease', 'core/num'], (E, N) => {
  'use strict';

  // A Curve is plain JSON (§2.4):
  //   EaseName | PresetName | { bz: [x1, y1, x2, y2] } | { sp: [[u, s], …] } | { ramp: { edge, ends, peak } }
  // `coerce` gives the canonical form: q3 numbers, sorted keys, deep-frozen; presets stay names. Structure that cannot
  // be read (a wrong type, a bad count, u out of order, a Bézier x outside [0, 1], no area) gives undefined; magnitudes
  // (Bézier y, speeds, ramp edge and peak) are clamped into their ranges.

  const MAX_KNOTS = 8;
  const RAMP_W = 0.06;
  const RAMP_ENDS = Object.freeze(['both', 'start', 'end']);
  const BZ_Y = Object.freeze([-0.5, 1.5]);
  const SPEED_MAX = 8;
  const EDGE = Object.freeze([0, 0.4]);
  const PEAK = Object.freeze([0.125, 8]);
  const LRU_MAX = 256;
  const H = 1e-4;                                  // central-difference step of speedAt (UI only)

  function q3(x) {
    const r = Math.round(x * 1000) / 1000;
    return r === 0 ? 0 : r;                        // no -0 in documents
  }

  function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  // --- presets (FROZEN data, §4.1 table; stored by name, never expanded in documents) ------------------------------

  const PRESETS = deepFreeze({
    softEnds: { bz: [0.6, 0, 0.4, 1] },
    hushRushHush: { sp: [[0, 0.15], [0.12, 0.3], [0.22, 1.9], [0.78, 1.9], [0.88, 0.3], [1, 0.15]] },
    holdThenDash: { sp: [[0, 0], [0.28, 0.08], [0.34, 2.4], [0.8, 1.1], [1, 0]] },
    dashStop: { sp: [[0, 1.5], [0.86, 1.3], [0.94, 0.08], [1, 0]] },
    slowBloom: { sp: [[0, 0.08], [1, 2]] },
    fadeBrake: { sp: [[0, 2], [1, 0.08]] },
    snapSettle: { bz: [0.2, 0.9, 0.25, 1.15] },
  });
  const PRESET_KEYS = Object.freeze(Object.keys(PRESETS).sort());
  // Presets whose time reversal is a named curve (symmetric ones map to themselves).
  const REVERSE_NAMED = Object.freeze({ softEnds: 'softEnds', hushRushHush: 'hushRushHush', slowBloom: 'fadeBrake',
    fadeBrake: 'slowBloom' });

  function isEase(v) { return E.EASES.includes(v); }
  function isPreset(v) { return Object.prototype.hasOwnProperty.call(PRESETS, v); }

  // --- coerce ------------------------------------------------------------------------------------------------------

  function coerce(v) {
    if (typeof v === 'string') return isEase(v) || isPreset(v) ? v : undefined;
    if (!isObject(v)) return undefined;
    const keys = Object.keys(v);
    if (keys.length !== 1) return undefined;
    switch (keys[0]) {
      case 'bz': return coerceBz(v.bz);
      case 'sp': return coerceSp(v.sp);
      case 'ramp': return coerceRamp(v.ramp);
      default: return undefined;
    }
  }

  function coerceBz(list) {
    if (!Array.isArray(list) || list.length !== 4 || !list.every(isFiniteNumber)) return undefined;
    const x1 = q3(list[0]), x2 = q3(list[2]);
    if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) return undefined;
    const y1 = N.clamp(q3(list[1]), BZ_Y[0], BZ_Y[1]), y2 = N.clamp(q3(list[3]), BZ_Y[0], BZ_Y[1]);
    return deepFreeze({ bz: [x1, y1, x2, y2] });
  }

  function coerceSp(list) {
    if (!Array.isArray(list) || list.length < 2 || list.length > MAX_KNOTS) return undefined;
    const knots = [];
    for (const k of list) {
      if (!Array.isArray(k) || k.length !== 2 || !isFiniteNumber(k[0]) || !isFiniteNumber(k[1])) return undefined;
      knots.push([q3(k[0]), N.clamp(q3(k[1]), 0, SPEED_MAX)]);
    }
    return knotsOk(knots) ? deepFreeze({ sp: knots }) : undefined;
  }

  // u0 = 0, un = 1, u non-decreasing, never three equal u in a row, and a positive area.
  function knotsOk(knots) {
    const n = knots.length - 1;
    if (knots[0][0] !== 0 || knots[n][0] !== 1) return false;
    for (let i = 1; i <= n; i++) {
      if (knots[i][0] < knots[i - 1][0]) return false;
      if (i >= 2 && knots[i][0] === knots[i - 1][0] && knots[i - 1][0] === knots[i - 2][0]) return false;
    }
    return areaOf(knots) > 0;
  }

  function areaOf(knots) {
    let a = 0;
    for (let i = 0; i + 1 < knots.length; i++) a += (knots[i + 1][0] - knots[i][0]) * (knots[i][1] + knots[i + 1][1]) / 2;
    return a;
  }

  function coerceRamp(r) {
    if (!isObject(r) || !RAMP_ENDS.includes(r.ends) || !isFiniteNumber(r.edge) || !isFiniteNumber(r.peak)) return undefined;
    return deepFreeze({ ramp: { edge: N.clamp(q3(r.edge), EDGE[0], EDGE[1]), ends: r.ends, peak: N.clamp(q3(r.peak), PEAK[0], PEAK[1]) } });
  }

  function isCurve(v) { return coerce(v) !== undefined; }

  // --- forms -------------------------------------------------------------------------------------------------------

  // The ramp (the two-slider form) as speed knots (§4.1 table); a knot equal to the previous one is dropped.
  function rampKnots(ramp) {
    const e = ramp.edge, k = ramp.peak, W = RAMP_W;
    let raw;
    if (ramp.ends === 'start') raw = [[0, 1], [e, 1], [e + W, k], [1, k]];
    else if (ramp.ends === 'end') raw = [[0, k], [1 - e - W, k], [1 - e, 1], [1, 1]];
    else raw = [[0, 1], [e, 1], [e + W, k], [1 - e - W, k], [1 - e, 1], [1, 1]];
    const out = [];
    for (const [u, s] of raw) {
      const knot = [q3(u), s];
      const last = out[out.length - 1];
      if (!last || last[0] !== knot[0] || last[1] !== knot[1]) out.push(knot);
    }
    return out;
  }

  // Presets → their data, a ramp → { sp }; ease names and data come back unchanged. Unreadable → 'linear'.
  function expand(c) {
    const v = coerce(c);
    if (v === undefined) return 'linear';
    if (typeof v === 'string') return isPreset(v) ? PRESETS[v] : v;
    if (v.ramp) return deepFreeze({ sp: rampKnots(v.ramp) });
    return v;
  }

  function keyOf(c) {
    const v = coerce(c);
    if (v === undefined) return 'n:linear';
    if (typeof v === 'string') return 'n:' + v;
    if (v.bz) return 'bz:' + v.bz.join(',');
    if (v.sp) return 'sp:' + v.sp.map((k) => k[0] + ',' + k[1]).join(';');
    return 'rp:' + v.ramp.ends + ',' + v.ramp.edge + ',' + v.ramp.peak;
  }

  // --- evaluation --------------------------------------------------------------------------------------------------

  // Piecewise-linear speed, integrated in closed form (§4.1). Knots are Float64Arrays; the evaluation is a linear scan
  // over ≤ 8 knots and allocates nothing. A zero-length segment is a jump in speed, not in position: it is skipped.
  function spTables(knots) {
    const n = knots.length;
    const U = new Float64Array(n), S = new Float64Array(n), C = new Float64Array(n);
    for (let i = 0; i < n; i++) { U[i] = knots[i][0]; S[i] = knots[i][1]; }
    for (let i = 0; i + 1 < n; i++) C[i + 1] = C[i] + (U[i + 1] - U[i]) * (S[i] + S[i + 1]) / 2;
    return { U, S, C, A: C[n - 1], n };
  }

  // The segment i with U[i] ≤ u < U[i + 1] and a positive length (u in (0, 1)).
  function segmentOf(t, u) {
    let i = 0;
    while (i < t.n - 2 && !(u < t.U[i + 1])) i++;
    return i;
  }

  function spFn(knots) {
    const t = spTables(knots);
    return (u) => {
      if (u <= 0) return 0;
      if (u >= 1) return 1;
      const i = segmentOf(t, u);
      const L = t.U[i + 1] - t.U[i];
      const tau = u - t.U[i];
      return (t.C[i] + t.S[i] * tau + (t.S[i + 1] - t.S[i]) * tau * tau / (2 * L)) / t.A;
    };
  }

  function spSpeed(knots, u) {
    const t = spTables(knots);
    if (u <= 0) return t.S[0] / t.A;
    if (u >= 1) return t.S[t.n - 1] / t.A;
    const i = segmentOf(t, u);
    const L = t.U[i + 1] - t.U[i];
    return (t.S[i] + (t.S[i + 1] - t.S[i]) * (u - t.U[i]) / L) / t.A;
  }

  function build(v) {
    const data = expand(v);
    if (typeof data === 'string') return E.get(data);
    if (data.bz) return E.bezier(data.bz[0], data.bz[1], data.bz[2], data.bz[3]);
    return spFn(data.sp);
  }

  // compile(c) → { fn, warp, linear, key }, memoized by keyOf (LRU 256). fn(0) = 0 and fn(1) = 1 exactly.
  const memo = new Map();
  function compile(c) {
    const key = keyOf(c);
    const hit = memo.get(key);
    if (hit) {
      memo.delete(key);
      memo.set(key, hit);
      return hit;
    }
    const v = coerce(c);
    const f = build(v === undefined ? 'linear' : v);
    const linear = isLinear(v);
    const out = Object.freeze({
      fn: f,
      warp: linear ? (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u) : (u) => N.clamp(f(u)),
      linear, key,
    });
    memo.set(key, out);
    if (memo.size > LRU_MAX) memo.delete(memo.keys().next().value);
    return out;
  }

  // Position curve u → f(u); may overshoot (back*, elastic, spring, snapSettle, Béziers with y outside [0, 1]).
  // An unreadable value gives linear; nothing here throws on data.
  function fn(c) { return compile(c).fn; }

  // Time warp u → clamp01(f(u)): hold clocks, seam progress, stagger spread.
  function warp(c) { return compile(c).warp; }

  function isLinear(c) {
    const v = coerce(c);
    if (v === undefined) return true;             // reads as linear
    if (typeof v === 'string') return v === 'linear';
    if (v.bz) return v.bz[0] === v.bz[1] && v.bz[2] === v.bz[3];
    if (v.sp) return v.sp.every((k) => k[1] === v.sp[0][1]);
    return v.ramp.peak === 1;
  }

  // g(u) = 1 − f(1 − u) (§3.2): names through core/ease, symmetric presets unchanged, slowBloom ↔ fadeBrake,
  // other presets and data reversed, a ramp swaps start and end.
  function reverse(c) {
    const v = coerce(c);
    if (v === undefined) return 'linear';
    if (typeof v === 'string') {
      if (isEase(v)) return E.reverse(v);
      if (REVERSE_NAMED[v]) return REVERSE_NAMED[v];
      return reverseData(PRESETS[v]);
    }
    if (v.ramp) {
      const ends = v.ramp.ends === 'start' ? 'end' : v.ramp.ends === 'end' ? 'start' : 'both';
      return coerce({ ramp: { edge: v.ramp.edge, ends, peak: v.ramp.peak } });
    }
    return reverseData(v);
  }

  function reverseData(d) {
    if (d.bz) return coerce({ bz: [1 - d.bz[2], 1 - d.bz[3], 1 - d.bz[0], 1 - d.bz[1]] });
    const n = d.sp.length - 1;
    return coerce({ sp: d.sp.map((k, i) => [1 - d.sp[n - i][0], d.sp[n - i][1]]) });
  }

  // Normalized speed f'(u): exact for speed ramps and presets with speed data, a central difference otherwise (UI).
  function speedAt(c, u) {
    const data = expand(c);
    if (typeof data !== 'string' && data.sp) return spSpeed(data.sp, u);
    const f = fn(c);
    const a = Math.max(0, Math.min(1 - 2 * H, u - H)), b = a + 2 * H;
    return (f(b) - f(a)) / (b - a);
  }

  // n + 1 samples of the position curve at i / n.
  function sample(c, n) {
    const count = Math.max(1, Math.floor(isFiniteNumber(n) ? n : 1));
    const f = fn(c);
    const out = new Float32Array(count + 1);
    for (let i = 0; i <= count; i++) out[i] = f(i / count);
    return out;
  }

  // [stringKey, params] for the UI: presets 'curve.<name>'; eases as ui/fields labels them ('opt.ease' with the family
  // and direction keys as params, or 'opt.ease.<name>'); data forms 'curve.bz', 'curve.sp' { n }, 'curve.ramp.<ends>' { peak }.
  function label(c) {
    const v = coerce(c);
    const x = v === undefined ? 'linear' : v;
    if (typeof x === 'string') {
      if (isPreset(x)) return ['curve.' + x, {}];
      const m = /^(linear|steps|[a-z]+?)(InOut|In|Out)?$/.exec(x);
      if (!m || !m[2]) return ['opt.ease.' + x, {}];
      return ['opt.ease', { family: 'opt.ease.' + m[1], dir: 'opt.easeDir.' + m[2] }];
    }
    if (x.bz) return ['curve.bz', {}];
    if (x.sp) return ['curve.sp', { n: x.sp.length }];
    return ['curve.ramp.' + x.ramp.ends, { peak: x.ramp.peak }];
  }

  return {
    PRESETS, PRESET_KEYS, RAMP_ENDS, MAX_KNOTS, RAMP_W,
    isCurve, coerce, keyOf, expand, compile, fn, warp, isLinear, reverse, speedAt, sample, label,
  };
});
