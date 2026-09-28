/* 文字PVメーカー v2 — original work. Directions of 文字PVの定石: which parameters point which way, and the alternation of 「動きの向きを交互にする」 (DESIGN_2_2 §2.2.4). */
MV.def('planner/flow', ['core/hash', 'core/rng', 'core/num', 'core/schema', 'core/paths'], (H, R, N, S, P) => {
  'use strict';

  // Three axes: h = the on-screen travel of what the viewer sees (+1 = rightward), side = where the text sits (+1 =
  // right), rot = the turn (+1 = clockwise). A cut's direction on an axis is the sign of its first directional value
  // there (the rest of the cut follows it); the next directional cut is turned the other way with probability P_FLIP,
  // except on the first cut of a part run and on a restart cut (1 in 4, keyed by the look seed and the cut key, so no
  // reroll or insert moves it). A turned parameter is still an automatic value (pfrom 'alt'): a pin, a lock, a rule, a
  // die on the parameter or a guard (vertical text, a sideways entrance of more than one word) keeps its value, which
  // still gives the cut its direction.
  const P_FLIP = 0.9;
  const LOOKBACK = 2;
  const RESTART_MASK = 3;
  const SEAM_LOOKBACK = 3;
  const AXES = Object.freeze(['h', 'side', 'rot']);
  const NO_DIR = 13;                                 // dirOf when no axis has a direction

  function swap(a, b) { return (v) => (v === a ? b : v === b ? a : v); }
  function signMap(map) { return (v) => (map[v] !== undefined ? map[v] : 0); }
  function neg(v) { return typeof v === 'number' ? -v : v; }
  function wrapAngle(v) {
    let x = ((v % 360) + 360) % 360;
    if (x > 180) x -= 360;
    return x;
  }
  // an angle's horizontal sign: cos ≥ 0.6 → +1 (rightward), ≤ −0.6 → −1
  function angleSign(v) {
    if (typeof v !== 'number') return 0;
    const c = Math.cos(v * Math.PI / 180);
    return c >= 0.6 ? 1 : c <= -0.6 ? -1 : 0;
  }
  function mirrorAngle(v) { return typeof v === 'number' ? wrapAngle(180 - v) : v; }
  function numSign(v, min) {
    if (typeof v !== 'number') return 0;
    return Math.abs(v) >= (min || 0) && v !== 0 ? Math.sign(v) : 0;
  }

  // entry(kind, key, axis, names, sign(p), flip(v), extra) → one row of the direction table. sign reads the parameters
  // (p); flip maps one value to its mirror. orient: the entry applies only to text of that orientation; when(feat):
  // an extra guard; order: { name, to(want, v) } a stagger order turned with the direction (the words never fly over
  // the ones still waiting).
  function entry(kind, key, axis, names, sign, flip, extra) {
    return Object.freeze(Object.assign({ id: kind + '.' + key, kind, key, axis, names: Object.freeze(names), sign, flip }, extra || {}));
  }

  const CW = signMap({ cw: 1, ccw: -1, alt: 0 });
  const LR = signMap({ left: -1, right: 1 });

  const TABLE = Object.freeze([
    entry('arrange', 'sidebarIndex', 'side', ['side'], (p) => LR(p.side), swap('left', 'right'), { orient: 'h' }),
    entry('arrange', 'cornerNote', 'side', ['corner'],
      (p) => signMap({ bottomLeft: -1, topLeft: -1, bottomRight: 1, topRight: 1 })(p.corner),
      (v) => swap('topLeft', 'topRight')(swap('bottomLeft', 'bottomRight')(v)), { orient: 'h' }),
    entry('arrange', 'creditFold', 'side', ['corner'], (p) => signMap({ bottomLeft: -1, bottomRight: 1 })(p.corner),
      swap('bottomLeft', 'bottomRight'), { orient: 'h' }),
    entry('arrange', 'edgeBleed', 'side', ['anchor'], (p) => signMap({ start: -1, end: 1, center: 0 })(p.anchor),
      swap('start', 'end'), { orient: 'h' }),
    entry('arrange', 'tiltedCard', 'rot', ['tilt'], (p) => numSign(p.tilt, 1), neg),
    entry('arrive', 'twirlArrive', 'rot', ['dir'], (p) => CW(p.dir), swap('cw', 'ccw')),
    // from the right (xFrom > 0) the words travel left: −1. One-word cuts only: the part keeps later words clear of the
    // ones already there only in its designed direction.
    entry('arrive', 'skewSlide', 'h', ['xFrom', 'kxFrom'], (p) => -numSign(p.xFrom), neg,
      { orient: 'h', when: (f) => !!f && f.words === 1 }),
    entry('depart', 'twirlDepart', 'rot', ['dir'], (p) => CW(p.dir), swap('cw', 'ccw')),
    // the wind takes the glyphs from its downwind edge first: sweepX (left first) blowing left, tail blowing right
    entry('depart', 'windBlow', 'h', ['dir'], (p) => LR(p.dir), swap('left', 'right'),
      { orient: 'h', order: { name: 'order', to: (want, v) => (want > 0 && v === 'sweepX' ? 'tail' : want < 0 && v === 'tail' ? 'sweepX' : v) } }),
    entry('depart', 'skewExit', 'h', ['xTo', 'kxTo'], (p) => numSign(p.xTo), neg,
      { orient: 'h', order: { name: 'order', to: (want, v) => (want > 0 && v === 'lead' ? 'tail' : want < 0 && v === 'tail' ? 'lead' : v) } }),
    entry('dwell', 'slowDrift', 'h', ['angle'], (p) => angleSign(p.angle), mirrorAngle),
    // the camera pans right: the picture travels left
    entry('lens', 'panSweep', 'h', ['dir'], (p) => signMap({ right: -1, left: 1, up: 0, down: 0 })(p.dir), swap('left', 'right')),
    entry('lens', 'driftFloat', 'h', ['angle'], (p) => -angleSign(p.angle), mirrorAngle),
    entry('lens', 'parallaxOrbit', 'rot', ['dir'], (p) => CW(p.dir), swap('cw', 'ccw')),
    entry('seam', 'swishCut', 'h', ['dir'], (p) => signMap({ left: -1, right: 1, up: 0, down: 0 })(p.dir), swap('left', 'right')),
    entry('seam', 'shoveAcross', 'h', ['dir'], (p) => signMap({ left: -1, right: 1, up: 0, down: 0 })(p.dir), swap('left', 'right')),
  ]);
  const DIR = new Map(TABLE.map((e) => [e.kind + '/' + e.key, e]));

  function entryOf(kind, key) { return DIR.get(kind + '/' + key) || null; }

  // signOf(kind, key, p) → the sign of a decision's parameters on its entry's axis (0 without an entry).
  function signOf(kind, key, p) {
    const e = entryOf(kind, key);
    return e && p ? e.sign(p) : 0;
  }

  // flipValue(e, name, v, spec) → the mirrored value coerced through the parameter's spec, or undefined.
  function flipValue(e, v, spec) {
    const x = e.flip(v);
    return spec ? S.coerce(spec, x) : x;
  }

  // --- packed directions ---------------------------------------------------------------------------------------------

  // dirOf({ h, side, rot }) → (h + 1) + 3·(side + 1) + 9·(rot + 1): 13 = no direction on any axis.
  function pack(own) { return own ? (own.h + 1) + 3 * (own.side + 1) + 9 * (own.rot + 1) : NO_DIR; }
  function unpack(dir) {
    const d = typeof dir === 'number' && dir >= 0 && dir < 27 ? dir : NO_DIR;
    return { h: (d % 3) - 1, side: (Math.floor(d / 3) % 3) - 1, rot: Math.floor(d / 9) - 1 };
  }
  function axisOf(dir, axis) { return unpack(dir)[axis]; }

  // restartAt(seed, part, cutKey) → whether a cut starts its own directions: a cut without a part (special cuts), the
  // first cut of a part run, and 1 cut in 4 by a coin of (look seed, cut key) alone.
  function restartAt(lookSeed, part, cutKey) {
    return !part || part.first || (H.hash32('pv.restart', lookSeed, cutKey) & RESTART_MASK) === 0;
  }

  // The parameter specs of a part by name (the registry's declared order), and whether each is shared.
  const specCache = new WeakMap();
  function specsOf(registry, kind, key) {
    let byKey = specCache.get(registry);
    if (!byKey) { byKey = new Map(); specCache.set(registry, byKey); }
    const id = kind + '/' + key;
    let m = byKey.get(id);
    if (!m) {
      m = new Map();
      for (const x of registry.params(kind, key) || []) m.set(x.name, x);
      byKey.set(id, m);
    }
    return m;
  }

  // Whether a die is on one parameter of the cut (cut/<key>:<param path> or line/<id>:<param path>).
  function paramSalted(ctx, cut, kind, idx, key, name, shared) {
    const s = ctx.salts;
    if (!s) return false;
    let path;
    try { path = P.slotParamPath(kind, idx, key, name, shared); } catch (e) { return false; }
    return !!(s['cut/' + cut.key + ':' + path] || (cut.line && s['line/' + cut.line + ':' + path]));
  }

  function sortedCopy(o) {
    const out = {};
    for (const k of Object.keys(o).sort()) out[k] = o[k];
    return out;
  }

  // flipParams(st, kind, idx, seed, d, part, aligned) → d with its directional parameters turned where the alternation
  // asks (pfrom 'alt'), and st.dirOwn set on the entry's axis (planner/cast decidePart, after the parameters, the
  // motion speed and an aligned copy's values: aligned = the decision shows its source's part with the source's
  // parameters, which are kept as they are and give the cut its direction). st = the cast state (ctx, cut, hist,
  // chosen, natural, feat, dirOwn); part = the cut's part (planner/arc) or null. Returns whether a value was turned and
  // why ('alt' against the previous cut, 'same' with the rest of the cut), or null.
  function flipParams(st, kind, idx, seed, d, part, aligned) {
    if (st.natural || !d || !d.p || typeof d.v !== 'string' || d.v === 'none') return null;
    const e = entryOf(kind, d.v);
    if (!e) return null;
    let s = e.sign(d.p);
    if (s === 0) return null;
    const { ctx, cut } = st;
    const specs = specsOf(ctx.registry, kind, d.v);
    if (e.names.some((n) => !specs.has(n) || !(n in d.p))) return null;          // a lenient registry, a material
    const f = st.feat || cut.feat;
    const fixed = !!aligned || e.names.some((n) => d.pfrom && d.pfrom[n] !== undefined) ||
      e.names.some((n) => paramSalted(ctx, cut, kind, idx, d.v, n, !!specs.get(n).shared)) ||
      (e.orient && st.chosen.orient !== e.orient) || (e.when && !e.when(f));
    let why = null;
    if (!fixed) {
      let want, p;
      if (st.dirOwn[e.axis] !== 0) { want = st.dirOwn[e.axis]; p = 1; }
      else if (restartAt(ctx.doc.look.seed, part, cut.key)) { want = 0; p = 0; }
      else { want = -prevSign(st.hist, e.axis); p = P_FLIP; }
      if (want !== 0 && s !== want && R.stream(seed, 'pv.flip.' + e.id).next() < p) {
        const next = Object.assign({}, d.p);
        const pfrom = Object.assign({}, d.pfrom || {});
        let ok = true;
        for (const n of e.names) {
          const x = flipValue(e, d.p[n], specs.get(n).spec);
          if (x === undefined) { ok = false; break; }
          next[n] = x;
          pfrom[n] = 'alt';
        }
        if (ok) {
          if (e.order && !(d.pfrom && d.pfrom[e.order.name]) && typeof next[e.order.name] === 'string') {
            const o = e.order.to(want, next[e.order.name]);
            const spec = specs.get(e.order.name);
            if (o !== next[e.order.name] && (!spec || S.coerce(spec.spec, o) === o)) { next[e.order.name] = o; pfrom[e.order.name] = 'alt'; }
          }
          d.p = sortedCopy(next);
          d.pfrom = sortedCopy(pfrom);
          why = p === 1 ? 'same' : 'alt';
          s = want;
        }
      }
    }
    if (st.dirOwn[e.axis] === 0) st.dirOwn[e.axis] = s;
    return why;
  }

  // The first nonzero sign on an axis among the previous LOOKBACK cuts' final directions (history rows' dir), else 0.
  function prevSign(hist, axis) {
    if (!hist || typeof hist.prevDir !== 'function') return 0;
    for (let k = 1; k <= LOOKBACK; k++) {
      const s = axisOf(hist.prevDir(k), axis);
      if (s !== 0) return s;
    }
    return 0;
  }

  // --- seams ----------------------------------------------------------------------------------------------------------

  // seamDir(decision) → the horizontal sign of a transition (0 for a seam without a direction).
  function seamDir(d) { return d && typeof d.v === 'string' && d.p ? signOf('seam', d.v, d.p) : 0; }

  // flipSeam(ctx, B, d, history, seed) → the seam decision into B turned against the latest horizontal transition of the
  // last SEAM_LOOKBACK boundaries, with P_FLIP (d itself when nothing changes). A pinned direction, a die on it, or a
  // copied or pinned seam are left alone (the caller passes only automatic, uncopied seams).
  function flipSeam(ctx, B, d, history, seed) {
    if (!d || !d.p || typeof d.v !== 'string') return d;
    const e = entryOf('seam', d.v);
    if (!e) return d;
    const s = e.sign(d.p);
    if (s === 0) return d;
    const specs = specsOf(ctx.registry, 'seam', d.v);
    if (e.names.some((n) => !specs.has(n) || (d.pfrom && d.pfrom[n] !== undefined) ||
      paramSalted(ctx, B, 'seam', null, d.v, n, !!specs.get(n).shared))) return d;
    let prev = 0;
    for (let i = history.length - 1; i >= 0 && i >= history.length - SEAM_LOOKBACK; i--) {
      if (history[i] && history[i].dir) { prev = history[i].dir; break; }
    }
    const want = -prev;
    if (want === 0 || s === want || !(R.stream(seed, 'pv.flip.dir').next() < P_FLIP)) return d;
    const p = Object.assign({}, d.p);
    const pfrom = Object.assign({}, d.pfrom || {});
    for (const n of e.names) {
      const x = flipValue(e, d.p[n], specs.get(n).spec);
      if (x === undefined) return d;
      p[n] = x;
      pfrom[n] = 'alt';
    }
    const out = {};
    for (const k of Object.keys(d)) out[k] = d[k];
    out.p = sortedCopy(p);
    out.pfrom = sortedCopy(pfrom);
    // keep the key order of planner/tracks withParams (by, from, p, pfrom, v)
    const sorted = {};
    for (const k of ['by', 'from', 'p', 'pfrom', 'v']) if (out[k] !== undefined) sorted[k] = out[k];
    return sorted;
  }

  return {
    TABLE, DIR, AXES, P_FLIP, LOOKBACK, RESTART_MASK, NO_DIR, entryOf, signOf, flipValue, pack, unpack, axisOf, restartAt,
    flipParams, prevSign, seamDir, flipSeam, wrapAngle,
  };
});
