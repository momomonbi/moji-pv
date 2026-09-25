/* 文字PVメーカー v2 — original work. Behaviours: the scheduler, the dwell envelope and the kit's motion adapters (DESIGN §4.17.4, §4.18.3). */
MV.def('engine/scene/behave', ['core/num', 'core/ease', 'core/rng', 'core/motion', 'core/schema', 'engine/scene/stagger'],
(N, E, RNG, MO, SCH, STG) => {
  'use strict';

  const PH = Object.freeze({ REST: 0, MOTION: 1, ORNAMENT: 2, LENS: 3, STYLE: 4 });
  const LIVE = Object.freeze(['until', 'after', 'during', 'always']);
  const DEG = N.DEG;

  // The pooled DELTA pose of K.perGlyph / K.perGlyphHold / K.moves: angles in DEGREES (§4.18.3). No px/py: pivots are
  // set by the adapter from the motion's unit.
  const DELTA = Object.freeze(['x', 'y', 'z', 'rot', 'kx', 'ky', 'rx', 'ry', 'sx', 'sy', 'alpha', 'reveal', 'blur', 'tint',
    'glow', 'shard', 'echo', 'jx', 'jy', 'pixel']);
  const MUL = Object.freeze(['sx', 'sy', 'alpha', 'reveal']);
  const ADD = Object.freeze(DELTA.filter((c) => !MUL.includes(c)));
  const ANGLE = Object.freeze(['rot', 'kx', 'ky', 'rx', 'ry']);
  const ADD_SCALE = Object.freeze(ADD.map((c) => (ANGLE.includes(c) ? DEG : 1)));

  const RAMP_IN = 0.25;          // dwell weight: 0 → 1 over 0.25 s after the entrance
  const RAMP_OUT = 0.2;          // … and back to 0 over 0.2 s before the exit

  class BehaviourError extends Error {
    constructor(code, message) { super(message); this.name = 'BehaviourError'; this.code = code; }
  }

  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }

  // --- behaviours and the scheduler ---------------------------------------------------------------------------

  // Throws for a malformed Behaviour (part programming errors surface at build, not per frame).
  function check(b) {
    const bad = (m) => { throw new BehaviourError('bad-behaviour', m); };
    if (!b || typeof b !== 'object') bad('a behaviour must be an object');
    if (!(Number.isInteger(b.phase) && b.phase >= PH.REST && b.phase <= PH.STYLE)) bad('phase must be one of K.PH');
    if (!LIVE.includes(b.live)) bad('live must be one of ' + LIVE.join(' '));
    if (!(Number.isInteger(b.from) && Number.isInteger(b.to) && b.from >= 0 && b.to >= b.from)) bad('from/to must be a node range');
    if (!(typeof b.t0 === 'number' && typeof b.t1 === 'number') || Number.isNaN(b.t0) || Number.isNaN(b.t1)) bad('t0/t1 must be numbers');
    if (typeof b.run !== 'function') bad('run(P, t, b) is required');
    return b;
  }

  // Sorted by (phase, build order); a new array.
  function sortBehaviours(list) {
    return list.map((b, i) => [b, i]).sort((p, q) => p[0].phase - q[0].phase || p[1] - q[1]).map((p) => p[0]);
  }

  // 'until' runs while t < t1 (before t0 its run clamps progress to 0), 'after' while t > t0, 'during' for
  // t0 ≤ t ≤ t1, 'always' always.
  function isActive(b, t) {
    switch (b.live) {
      case 'until': return t < b.t1;
      case 'after': return t > b.t0;
      case 'during': return t >= b.t0 && t <= b.t1;
      default: return true;
    }
  }

  // Runs every active behaviour of a pre-sorted list on the live pose columns P at local time t.
  function runBehaviours(P, list, t) {
    for (let k = 0; k < list.length; k++) {
      const b = list[k];
      if (isActive(b, t)) b.run(P, t, b);
    }
  }

  // --- envelopes ---------------------------------------------------------------------------------------------

  // Dwell weight at local time tl: 0 until the entrance ends (rest), up to 1 over 0.25 s, down to 0 over the 0.2 s
  // before the exit starts (out). Continuous, so dwell motion never pops.
  function envelopeWeight(tl, rest, out) {
    if (!(tl > rest && tl < out)) return 0;
    const up = N.smooth((tl - rest) / RAMP_IN), down = N.smooth((out - tl) / RAMP_OUT);
    return up < down ? up : down;
  }

  // Alpha of a `follow: 'text'` ornament: fades in over the entrance [a, rest] and out over the exit [out, b].
  function followWeight(t, times) {
    const fin = times.rest > times.a ? N.smooth((t - times.a) / (times.rest - times.a)) : (t >= times.a ? 1 : 0);
    const fout = times.b > times.out ? N.smooth((times.b - t) / (times.b - times.out)) : (t < times.b ? 1 : 0);
    return fin < fout ? fin : fout;
  }

  // --- small run functions used by the builder (module level; pure in t; no allocation) -----------------------

  function runDrift(P, t, b) {
    P.x[b.from] += b.vx * t;
    P.y[b.from] += b.vy * t;
  }

  function runFollow(P, t, b) {
    const k = followWeight(t, b.times);
    for (let r = 0; r < b.roots.length; r++) P.alpha[b.roots[r]] *= k;
  }

  // --- beat lookups without allocation ----------------------------------------------------------------------

  // Fills out { index, phase, since, bar } like Grid.beatAt(t) (core/beats) plus the bar index.
  function beatInto(grid, t, out) {
    const x = (t - grid.offset) / grid.period;
    let index = Math.floor(x), phase = x - index;
    if (phase >= 1) { index += 1; phase = 0; }
    out.index = index; out.phase = phase; out.since = phase * grid.period;
    out.bar = Math.floor(index / grid.meter);
    return out;
  }

  // --- pooled delta pose and glyph view (single-threaded; reset before every use) ------------------------------

  const D = {};
  for (const c of DELTA) D[c] = MUL.includes(c) ? 1 : 0;
  const G = { index: 0, count: 0, em: 0, cls: '', rank: 0, word: 0, line: 0, emph: 0, rnd: 0, cx: 0, cy: 0, w: 0, h: 0 };

  function resetDelta() {
    D.x = 0; D.y = 0; D.z = 0; D.rot = 0; D.kx = 0; D.ky = 0; D.rx = 0; D.ry = 0; D.sx = 1; D.sy = 1; D.alpha = 1;
    D.reveal = 1; D.blur = 0; D.tint = 0; D.glow = 0; D.shard = 0; D.echo = 0; D.jx = 0; D.jy = 0; D.pixel = 0;
  }

  function mergeDelta(P, i) {
    for (let k = 0; k < ADD.length; k++) { const c = ADD[k]; if (D[c] !== 0) P[c][i] += D[c] * ADD_SCALE[k]; }
    for (let k = 0; k < MUL.length; k++) { const c = MUL[k]; if (D[c] !== 1) P[c][i] *= D[c]; }
  }

  function fillGlyph(b, j) {
    const T = b.glyphs;
    G.index = j; G.count = b.to - b.from; G.em = T.em[j]; G.cls = T.cls[j]; G.rank = b.rank[j];
    G.word = T.unitOf.word[j]; G.line = T.unitOf.line[j]; G.emph = T.emph[j]; G.rnd = b.rnd[j];
    G.cx = T.cx[j]; G.cy = T.cy[j]; G.w = T.w[j]; G.h = T.h[j];
    return G;
  }

  function updateFrameCut(b, t) {
    const fc = b.fc;
    fc.tl = t;
    fc.level = b.level ? b.level(t) : 0.5;
    fc.beat = b.grid ? beatInto(b.grid, t, b.beat) : null;
    return fc;
  }

  // --- motion adapters (K.moves, K.perGlyph, K.perGlyphHold) ---------------------------------------------------

  // Per-glyph entrance/exit: u = linear progress after the glyph's stagger delay, k = ease(u). Tracks interpolate
  // columns; a perGlyph fn writes the delta pose directly. The delta merges with the §4.17.1 rules. The unit pivot is
  // set only while the glyph is away from its rest pose (entrance u < 1, exit u > 0), so at rest the pose equals the
  // base pose exactly, px/py included (the identity rule).
  function runGlyphMotion(P, t, b) {
    const fc = updateFrameCut(b, t);
    const n = b.to - b.from;
    const done = t >= b.t1, idle = t <= b.t0;          // exact ends: every glyph at u = 1 (or 0), whatever the rounding
    for (let j = 0; j < n; j++) {
      let u = done ? 1 : idle ? 0 : b.dur > 0 ? (t - b.t0 - b.delay[j]) / b.dur : (t >= b.t0 + b.delay[j] ? 1 : 0);
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const k = b.ease(u);
      resetDelta();
      if (b.fn) b.fn(D, fillGlyph(b, j), k, u, b.p, fc);
      else applyTracks(b, j, u, k);
      const i = b.from + j;
      mergeDelta(P, i);
      if (b.pivot && (b.exit ? u > 0 : u < 1)) { P.px[i] = b.pivot.px[j]; P.py[i] = b.pivot.py[j]; }
    }
  }

  function applyTracks(b, j, u, k) {
    const tr = b.tracks;
    for (let q = 0; q < tr.col.length; q++) {
      const kk = tr.curve[q] ? tr.curve[q](u) : k;
      let v = tr.from[q] + (tr.to[q] - tr.from[q]) * kk;
      if (tr.scale[q] === 1) v *= b.glyphs.em[j];
      const c = tr.col[q];
      if (tr.mul[q]) D[c] *= v; else D[c] += v;
    }
  }

  // Dwell: fn(P, g, time since the glyph arrived, envelope weight, p, fc); nothing runs while the weight is 0.
  function runHold(P, t, b) {
    const w = envelopeWeight(t, b.rest, b.out);
    if (!(w > 0)) return;
    const fc = updateFrameCut(b, t);
    const n = b.to - b.from;
    for (let j = 0; j < n; j++) {
      resetDelta();
      b.fn(D, fillGlyph(b, j), t - b.arrived[j], w, b.p, fc);
      mergeDelta(P, b.from + j);
    }
  }

  // --- building motion behaviours ------------------------------------------------------------------------------

  const TRACK_UNITS = Object.freeze({ x: 'em', y: 'em', z: 'em', rot: 'deg', kx: 'deg', ky: 'deg', rx: 'deg', ry: 'deg',
    blur: 'em' });
  const UNIT_KINDS = Object.freeze(['', 'em', 'du', 'deg', 'rad', 'x']);

  function identityOf(col) { return MUL.includes(col) ? 1 : 0; }

  // compileMoves({ unit, tracks, curve?, expose? }) → the normalized motion spec (used by make and K.mirror):
  // { unit, tracks: { col: { from, to, unit } }, curve: { col: easeName }, expose: [col], dir: 'arrive'|'depart'|null }
  function compileMoves(spec) {
    const bad = (m) => { throw new BehaviourError('bad-moves', m); };
    if (!spec || typeof spec !== 'object' || !spec.tracks || typeof spec.tracks !== 'object') bad('K.moves needs { tracks }');
    const unit = spec.unit === undefined ? 'glyph' : spec.unit;
    if (!STG.UNITS.includes(unit)) bad('unit must be one of ' + STG.UNITS.join(' '));
    const tracks = {};
    for (const col of Object.keys(spec.tracks)) {
      if (!DELTA.includes(col)) bad('unknown track column ' + col);
      const t = spec.tracks[col];
      const tr = Array.isArray(t) ? { from: t[0], to: t[1] } : Object.assign({}, t);
      if (!finite(tr.from) || !finite(tr.to)) bad('track ' + col + ' needs finite from and to');
      tr.unit = tr.unit === undefined ? (TRACK_UNITS[col] || '') : tr.unit;
      if (!UNIT_KINDS.includes(tr.unit)) bad('track ' + col + ': unknown unit ' + tr.unit);
      tracks[col] = Object.freeze(tr);
    }
    const curve = Object.assign({}, spec.curve || {});
    for (const col of Object.keys(curve)) {
      if (!tracks[col]) bad('curve names a column without a track: ' + col);
      E.get(curve[col]);
    }
    const expose = (spec.expose || []).slice();
    for (const col of expose) if (!tracks[col]) bad('expose names a column without a track: ' + col);
    return Object.freeze({ unit, tracks: Object.freeze(tracks), curve: Object.freeze(curve), expose: Object.freeze(expose),
      dir: directionOf(tracks) });
  }

  // 'arrive' when every track ends at identity, 'depart' when every track starts there, null otherwise.
  function directionOf(tracks) {
    const cols = Object.keys(tracks);
    const endsIdle = cols.every((c) => tracks[c].to === identityOf(c));
    const startsIdle = cols.every((c) => tracks[c].from === identityOf(c));
    if (endsIdle && !startsIdle) return 'arrive';
    if (startsIdle && !endsIdle) return 'depart';
    return endsIdle ? 'arrive' : null;
  }

  function exposedName(col, kind) { return col + (kind === 'depart' ? 'To' : 'From'); }

  // The per-glyph fields every motion behaviour shares, from the target and the part's params.
  function motionTiming(env, target, p, kind, unit) {
    const times = env.times;
    const span = times.b - times.a;
    const order = SCH.ORDERS.includes(p.order) ? p.order : 'lead';
    const share = MO.SHARE[kind];
    const R = STG.ranksOf(env, target, order, unit);
    if (order === 'sung') {
      const dur = Math.min(finite(p.dur) ? Math.max(0, p.dur) : 0, kind === 'arrive' ? span : share * span);
      const room = Math.max(0, (kind === 'arrive' ? span : share * span) - dur);
      const cutSpan = env.cut ? Math.max(0, env.cut.t1 - env.cut.t0) : 0;
      const delay = Float64Array.from(STG.sungFractions(env, target, unit));
      let last = 0;
      for (let j = 0; j < delay.length; j++) { delay[j] = Math.min(delay[j] * cutSpan, room); if (delay[j] > last) last = delay[j]; }
      return { rank: R.rank, delay, dur, total: last + dur };
    }
    const fit = MO.fitMotion({ dur: p.dur, each: p.each, count: R.count, window: span, share });
    const delay = new Float64Array(R.rank.length);
    let last = 0;
    for (let j = 0; j < delay.length; j++) { delay[j] = R.rank[j] * fit.each; if (delay[j] > last) last = delay[j]; }
    return { rank: R.rank, delay, dur: fit.dur, total: Math.max(fit.total, last + fit.dur) };
  }

  // Total length of an entrance/exit as the adapters will fit it (build.js uses this for times.rest / times.out).
  function motionTotal(env, target, p, kind, unit) {
    if (target.to <= target.from) return 0;
    return motionTiming(env, target, p || {}, kind, unit || 'glyph').total;
  }

  function frameCutOf(env) {
    const cut = env.cut || {};
    const f = env.feat || cut.feat || {};
    return { tl: 0, level: 0.5, beat: null, cut: Object.freeze({ dur: finite(f.dur) ? f.dur : Math.max(0, (cut.t1 || 0) - (cut.t0 || 0)),
      impact: !!(cut.impact || f.impact), energy: finite(f.energy) ? f.energy : 0.5 }) };
  }

  function glyphRandoms(env, n) {
    return RNG.stream(finite(env.seed) ? env.seed : 0, 'glyph', env.key || '').floats(n);
  }

  function baseFields(env, target, p) {
    const n = target.to - target.from;
    return { glyphs: target, p, rnd: glyphRandoms(env, n), fc: frameCutOf(env), grid: env.grid || null,
      beat: { index: 0, phase: 0, since: 0, bar: 0 }, level: typeof env.level === 'function' ? env.level : null };
  }

  function easeOf(name) { return E.get(E.EASES.includes(name) ? name : 'linear'); }

  // make for arrive/depart parts built by K.perGlyph(fn) or K.moves(spec). kind = 'arrive' | 'depart'.
  function glyphMotionMaker(kind, source) {
    return function make(env, target, p) {
      if (!target || target.to <= target.from) return [];
      const params = p || {};
      const unit = source.unit || 'glyph';
      const tm = motionTiming(env, target, params, kind, unit);
      const t0 = kind === 'arrive' ? env.times.a : env.times.out;
      const b = Object.assign(baseFields(env, target, params), {
        phase: PH.MOTION, live: kind === 'arrive' ? 'until' : 'after', from: target.from, to: target.to,
        t0, t1: t0 + tm.total, run: runGlyphMotion, exit: kind === 'depart', delay: tm.delay, dur: tm.dur, rank: tm.rank,
        ease: easeOf(params.ease),
        fn: source.fn || null, tracks: source.motion ? tracksFor(source.motion, kind, params) : null,
        pivot: unit === 'glyph' ? null : STG.pivots(env, target, unit),
      });
      return [b];
    };
  }

  function tracksFor(motion, kind, p) {
    const cols = Object.keys(motion.tracks);
    const out = { col: cols, from: new Float64Array(cols.length), to: new Float64Array(cols.length),
      scale: new Uint8Array(cols.length), mul: new Uint8Array(cols.length), curve: new Array(cols.length).fill(null) };
    cols.forEach((c, q) => {
      const tr = motion.tracks[c];
      let from = tr.from, to = tr.to;
      if (motion.expose.includes(c)) {
        const v = p[exposedName(c, kind)];
        if (finite(v)) { if (kind === 'depart') to = v; else from = v; }
      }
      const k = tr.unit === 'rad' ? 1 / DEG : 1;
      out.from[q] = from * k; out.to[q] = to * k;
      out.scale[q] = tr.unit === 'em' ? 1 : 0;
      out.mul[q] = MUL.includes(c) ? 1 : 0;
      out.curve[q] = motion.curve[c] ? E.get(motion.curve[c]) : null;
    });
    return out;
  }

  // make for dwell parts built by K.perGlyphHold(fn).
  function holdMaker(fn) {
    return function make(env, target, p) {
      if (!target || target.to <= target.from) return [];
      const n = target.to - target.from;
      const arrived = target.arrived || new Float32Array(n).fill(env.times.rest);
      return [Object.assign(baseFields(env, target, p || {}), {
        phase: PH.REST, live: 'during', from: target.from, to: target.to, t0: env.times.rest, t1: env.times.out,
        run: runHold, fn, rest: env.times.rest, out: env.times.out, arrived, rank: identityRanks(n),
      })];
    };
  }

  function identityRanks(n) {
    const r = new Float32Array(n);
    for (let j = 0; j < n; j++) r[j] = j;
    return r;
  }

  return {
    PH, LIVE, DELTA, BehaviourError, RAMP_IN, RAMP_OUT,
    check, sortBehaviours, isActive, runBehaviours, envelopeWeight, followWeight, beatInto,
    runDrift, runFollow, runGlyphMotion, runHold,
    compileMoves, directionOf, exposedName, identityOf, motionTiming, motionTotal, glyphMotionMaker, holdMaker,
    TRACK_UNITS,
  };
});
