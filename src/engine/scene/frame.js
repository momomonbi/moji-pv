/* 文字PVメーカー v2 — original work. frameAt(plan, t) → FrameGraph, scene evaluation and closed-form time lookups (DESIGN §4.19). */
MV.def('engine/scene/frame', ['core/num', 'core/hash', 'core/noise', 'core/mat', 'core/beats', 'audio/digest',
  'engine/scene/table', 'engine/scene/behave'],
(N, H, NZ, MAT, BEATS, DIG, T, BH) => {
  'use strict';

  // Everything here is a pure function of its arguments. Per-plan indexes are derived data cached by plan identity
  // (plans are immutable), so evaluation order never matters.

  const IMPULSE_WINDOW = 6;      // an impulse counts while 0 ≤ t − ti < 6·decay
  const IMPULSE_TERMS = 8;       // at most 8 recent impulses per lookup (§7.4 4K limits)
  const SHAKE_DU = 40;
  const SHAKE_RATE = 23;
  const PUNCH = 0.04;
  const SHAKE_SEED = H.hash32('impulse', 'shake');
  const ENV_HZ = 20;
  const BACKDROP_FILL = Object.freeze({ chroma: '#00B140', black: '#000000', clear: null, scene: null });
  const FILTER_STAGES = Object.freeze(['shape', 'tone', 'light', 'optic', 'film']);

  // --- per-plan index (derived, cached by identity) ------------------------------------------------------------

  const INDEX = new WeakMap();

  function indexOf(plan) {
    let ix = INDEX.get(plan);
    if (!ix) { ix = buildIndex(plan); INDEX.set(plan, ix); }
    return ix;
  }

  function buildIndex(plan) {
    const cuts = plan.cuts || [];
    const byA = cuts.map((c, i) => i).sort((p, q) => cuts[p].a - cuts[q].a || p - q);
    const aSorted = Float64Array.from(byA, (i) => cuts[i].a);
    let span = 0;
    for (const c of cuts) span = Math.max(span, c.b - c.a);
    const cutIndex = new Map(cuts.map((c, i) => [c.key, i]));
    const seams = (plan.seams || []).map((s, i) => ({ i, lo: s.at - s.dur / 2, hi: s.at + s.dur / 2,
      a: cutIndex.has(s.a) ? cutIndex.get(s.a) : -1, b: cutIndex.has(s.into) ? cutIndex.get(s.into) : cutIndex.get(s.b) }))
      .filter((s) => s.b !== undefined && s.b >= 0 && s.hi > s.lo)
      .sort((p, q) => p.lo - q.lo || p.i - q.i);
    const impulses = {};
    for (const imp of plan.impulses || []) (impulses[imp.kind] || (impulses[imp.kind] = [])).push(imp);
    for (const k of Object.keys(impulses)) impulses[k].sort((p, q) => p.t - q.t);
    const impT = {};
    for (const k of Object.keys(impulses)) impT[k] = Float64Array.from(impulses[k], (x) => x.t);
    const beats = plan.beats ? BEATS.grid(plan.beats) : null;
    const env = plan.env ? envelopeOf(plan.env) : null;
    return { byA, aSorted, span, cutIndex, seams, impulses, impT, beats, env };
  }

  function envelopeOf(e) {
    if (e && e.loud) return e;                                 // already { hz, loud }
    if (ArrayBuffer.isView(e)) return { hz: ENV_HZ, loud: e };  // plan.env: the 20 Hz Float32Array
    return null;
  }

  // Last index k in the sorted array with a[k] ≤ t (−1 when none).
  function lastAtOrBefore(a, t) {
    let lo = 0, hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= t) lo = mid + 1; else hi = mid; }
    return lo - 1;
  }

  // --- time lookups ---------------------------------------------------------------------------------------------

  // Σ amp·exp(−(t − ti)/decay) over impulses of `kind` with 0 ≤ t − ti < 6·decay (the 8 most recent at most).
  function impulseAt(plan, kind, t) {
    const ix = indexOf(plan);
    const list = ix.impulses[kind];
    if (!list) return 0;
    let sum = 0;
    for (let k = lastAtOrBefore(ix.impT[kind], t), n = 0; k >= 0 && n < IMPULSE_TERMS; k--, n++) {
      const imp = list[k], tau = t - imp.t;
      if (!(imp.decay > 0)) continue;
      if (tau < IMPULSE_WINDOW * imp.decay) sum += imp.amp * Math.exp(-tau / imp.decay);
    }
    return sum;
  }

  // Beat info at t: { index, phase, since, bar } (into `out` when given), or null without a BPM.
  function beatAt(plan, t, out) {
    const g = indexOf(plan).beats;
    if (!g) return null;
    return BH.beatInto(g, t, out || { index: 0, phase: 0, since: 0, bar: 0 });
  }

  // The plan's beat grid shifted so that local time 0 is `origin` (cuts: cut.t0, grounds: seg.t0); null without a BPM.
  function gridAt(plan, origin) {
    const b = plan.beats;
    if (!b || !(b.bpm > 0)) return null;
    return BEATS.grid({ bpm: b.bpm, offset: (b.offset || 0) - origin, meter: b.meter || 4 });
  }

  // Loudness 0..1 at absolute time t from plan.env (20 Hz); 0.5 when the plan has no envelope.
  function levelAt(plan, t) {
    const env = indexOf(plan).env;
    return env ? DIG.level(env, t) : 0.5;
  }

  // floor(t·rate + 1e-6): stochastic looks change at a fixed rate, so every frame rate shows the same pattern.
  function tick(rate, t) { return Math.floor(t * rate + 1e-6); }

  function noiseAt(seed, x) { return NZ.noise1(seed, x); }

  // --- frameAt ---------------------------------------------------------------------------------------------------

  // A FrameGraph plus its (non-enumerable) pool of entry objects, reused by the next frameAt(plan, t, fg).
  function emptyGraph() {
    const fg = { t: 0, cuts: [], grounds: [], seam: null, post: { texture: null, accents: [] }, backdrop: 'scene' };
    Object.defineProperty(fg, '_pool', { enumerable: false, value: { cuts: [], grounds: [], accents: [],
      seam: { i: 0, u: 0, scope: 'text', aCuts: [], bCuts: [], aGround: -1, bGround: -1 } } });
    return fg;
  }

  function pooled(pool, k) {
    if (!pool[k]) pool[k] = { i: 0, tl: 0 };
    return pool[k];
  }

  // frameAt(plan, t, out?) → FrameGraph (pure in (plan, t)); `out` (a FrameGraph from an earlier call) is overwritten.
  //   cuts:    every cut with a ≤ t < b, sorted by a, each { i, tl = t − cut.t0 }
  //   grounds: the segment holding t, or both segments while a world seam is active, each { i, tl = t − seg.t0 }
  //   seam:    { i, u, scope, aCuts, bCuts, aGround, bGround } while t is inside a seam window, else null.
  //            The window is centred on `at` (§4.16.6: [B.a − dur/2, B.a + dur/2]); aCuts/bCuts list the cuts on each
  //            side, including the seam's own A and B even when they are not visible yet (or any more).
  //   post:    { texture, accents: [{ cut, slot: 'filter#k', tl }] } for the current cut
  function frameAt(plan, t, out) {
    const fg = out && out._pool ? out : emptyGraph();
    const ix = indexOf(plan);
    fg.t = t;
    fg.backdrop = (plan.look && plan.look.backdrop) || 'scene';
    collectCuts(plan, ix, t, fg);
    fg.seam = seamAt(plan, ix, t, fg);
    collectGrounds(plan, t, fg);
    collectPost(plan, t, fg);
    return fg;
  }

  function collectCuts(plan, ix, t, fg) {
    fg.cuts.length = 0;
    const last = lastAtOrBefore(ix.aSorted, t);
    let first = last;
    while (first > 0 && ix.aSorted[first - 1] > t - ix.span - 1e-9) first--;
    let n = 0;
    for (let k = Math.max(0, first); k <= last; k++) {
      const i = ix.byA[k], c = plan.cuts[i];
      if (!(c.a <= t && t < c.b)) continue;
      const e = pooled(fg._pool.cuts, n++);
      e.i = i; e.tl = t - c.t0;
      fg.cuts.push(e);
    }
  }

  function seamAt(plan, ix, t, fg) {
    let hit = null;
    for (const s of ix.seams) {
      if (s.lo > t) break;
      if (t < s.hi) hit = s;
    }
    if (!hit) return null;
    const sp = plan.seams[hit.i];
    const s = fg._pool.seam;
    s.i = hit.i;
    s.u = N.clamp((t - hit.lo) / (hit.hi - hit.lo));
    s.scope = sp.scope === 'world' ? 'world' : 'text';
    s.aCuts.length = 0; s.bCuts.length = 0;
    for (const e of fg.cuts) {
      if (e.i === hit.a || e.i === hit.b) continue;
      if (e.i < hit.b) s.aCuts.push(e.i); else s.bCuts.push(e.i);
    }
    if (hit.a >= 0) s.aCuts.push(hit.a);
    s.bCuts.push(hit.b);
    byStart(plan, s.aCuts);
    byStart(plan, s.bCuts);
    s.aGround = hit.a >= 0 ? plan.cuts[hit.a].ground : -1;
    s.bGround = plan.cuts[hit.b].ground;
    return s;
  }

  function byStart(plan, list) {
    for (let k = 1; k < list.length; k++) {                 // insertion sort: tiny lists, no allocation
      const v = list[k];
      let j = k - 1;
      while (j >= 0 && (plan.cuts[list[j]].a > plan.cuts[v].a || (plan.cuts[list[j]].a === plan.cuts[v].a && list[j] > v))) {
        list[j + 1] = list[j]; j--;
      }
      list[j + 1] = v;
    }
  }

  function segmentAt(plan, t) {
    const segs = plan.grounds || [];
    if (segs.length === 0) return -1;
    for (let i = 0; i < segs.length; i++) if (segs[i].t0 <= t && t < segs[i].t1) return i;
    return t < segs[0].t0 ? 0 : segs.length - 1;
  }

  function collectGrounds(plan, t, fg) {
    fg.grounds.length = 0;
    const seam = fg.seam;
    const pool = fg._pool.grounds;
    const push = (i) => {
      if (i < 0 || i >= (plan.grounds || []).length) return;
      for (const e of fg.grounds) if (e.i === i) return;
      const e = pooled(pool, fg.grounds.length);
      e.i = i; e.tl = t - plan.grounds[i].t0;
      fg.grounds.push(e);
    };
    if (seam && seam.scope === 'world' && seam.aGround >= 0 && seam.bGround >= 0 && seam.aGround !== seam.bGround) {
      push(seam.aGround); push(seam.bGround);
    } else {
      push(segmentAt(plan, t));
    }
  }

  // currentCut(plan, t, fg) → index of the current cut (−1 when none): during a seam A before u = 0.5 and B after;
  // otherwise the last visible cut whose t0 ≤ t (else the first). Its filters are the accents; the renderer may use its
  // camera for the ground and hud.
  function currentCut(plan, t, fg) {
    const s = fg.seam;
    if (s) {
      const idx = plan.seams[s.i];
      const b = s.bCuts.length ? s.bCuts[0] : -1;
      const a = s.aCuts.length ? s.aCuts[s.aCuts.length - 1] : -1;
      const chosen = s.u >= 0.5 ? (indexOf(plan).cutIndex.get(idx.into) ?? b) : (indexOf(plan).cutIndex.get(idx.a) ?? a);
      if (chosen !== undefined && chosen >= 0) return chosen;
    }
    let cur = -1;
    for (const e of fg.cuts) if (plan.cuts[e.i].t0 <= t) cur = e.i;
    if (cur < 0 && fg.cuts.length) cur = fg.cuts[0].i;
    return cur;
  }

  function collectPost(plan, t, fg) {
    const post = fg.post;
    const tex = plan.look && plan.look.texture;
    post.texture = tex && tex.v && tex.v !== 'none' ? tex : null;
    post.accents.length = 0;
    const i = currentCut(plan, t, fg);
    if (i < 0) return;
    const cut = plan.cuts[i];
    const count = slotValue(cut, 'filter.count', 0);
    for (let k = 0; k < 3; k++) {
      const slot = FILTER_SLOTS[k];
      const d = cut.slots[slot];
      if (k >= count || !d || !d.v || d.v === 'none') continue;
      const e = fg._pool.accents[post.accents.length] || (fg._pool.accents[post.accents.length] = { cut: 0, slot: '', tl: 0 });
      e.cut = i; e.slot = slot; e.tl = t - cut.t0;
      post.accents.push(e);
    }
  }

  const FILTER_SLOTS = Object.freeze(['filter#0', 'filter#1', 'filter#2']);

  function slotValue(cut, slot, dflt) {
    const d = cut.slots && cut.slots[slot];
    return d && d.v !== undefined && d.v !== null ? d.v : dflt;
  }

  // --- evaluating a scene -----------------------------------------------------------------------------------------

  // evaluate(scene, tl) → scene.table with the live pose of local time tl solved (reset → behaviours → world).
  // Pure in (scene, tl): nothing survives from an earlier call.
  function evaluate(scene, tl) {
    const table = scene.table;
    T.resetLive(table);
    BH.runBehaviours(table.live, scene.behaviours, tl);
    T.solve(table);
    return table;
  }

  // The camera of an evaluated scene plus the plan's impulses at absolute time t (§4.19.3):
  // { x, y, zoom, roll, shakeX, shakeY } into `out`.
  function cameraAt(scene, plan, t, out) {
    const o = out || { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0 };
    const P = scene.table.live, c = scene.cam;
    const shake = impulseAt(plan, 'shake', t);
    const punch = impulseAt(plan, 'punch', t);
    o.x = P.x[c]; o.y = P.y[c]; o.roll = P.rot[c];
    o.zoom = P.sx[c] * (1 + PUNCH * punch);
    o.shakeX = P.jx[c] + (shake ? shake * (NZ.noise2(SHAKE_SEED, t * SHAKE_RATE, 0) - 0.5) * SHAKE_DU : 0);
    o.shakeY = P.jy[c] + (shake ? shake * (NZ.noise2(SHAKE_SEED, t * SHAKE_RATE, 1) - 0.5) * SHAKE_DU : 0);
    return o;
  }

  const V1 = new Float32Array(6), V2 = new Float32Array(6);

  // view(k) = T(W/2, H/2) · S(1 + (zoom − 1)·k) · R(−roll·k) · T(−W/2 − (camX + shakeX)·k, −H/2 − (camY + shakeY)·k)
  function viewMatrix(out, cam, k, W, H) {
    const s = 1 + (cam.zoom - 1) * k;
    MAT.compose(V1, W / 2, H / 2, -cam.roll * k, 0, 0, s, s, 0, 0);
    MAT.ident(V2);
    V2[4] = -W / 2 - (cam.x + cam.shakeX) * k;
    V2[5] = -H / 2 - (cam.y + cam.shakeY) * k;
    return MAT.mul(out, V1, V2);
  }

  // --- backdrop modes (§4.19.4) ------------------------------------------------------------------------------------

  const GREYS = Object.freeze({ shiftA: '#9A9A9A', shiftB: '#6E6E6E', muted: '#808080', ground2: '#1A1A1A' });

  // The palette a backdrop draws with: 'black' turns ink/accent white and the shifts grey; others keep the palette
  // (the planner already adjusted it for chroma).
  function paletteFor(pal, backdrop) {
    if (backdrop !== 'black') return pal;
    return Object.assign({}, pal, { ground: '#000000', ink: '#FFFFFF', accent: '#FFFFFF' }, GREYS);
  }

  // Fill for the frame before anything is drawn: '#00B140' (chroma), '#000000' (black), null (scene: the ground
  // layer paints; clear: the frame is cleared to transparent).
  function backdropFill(backdrop) { return BACKDROP_FILL[backdrop] === undefined ? null : BACKDROP_FILL[backdrop]; }

  function groundVisible(backdrop) { return backdrop === 'scene' || backdrop === undefined; }

  // Whether a filter part runs under a backdrop mode (§4.19.4 table).
  function filterAllowed(def, backdrop) {
    if (!def) return false;
    if (backdrop === 'chroma') return def.alphaSafe === true || def.stage === 'shape';
    if (backdrop === 'black') return def.stage === 'shape' || def.stage === 'film';
    if (backdrop === 'clear') return def.alphaSafe === true;
    return true;
  }

  return {
    IMPULSE_WINDOW, IMPULSE_TERMS, SHAKE_DU, PUNCH, FILTER_STAGES,
    frameAt, currentCut, evaluate, cameraAt, viewMatrix, impulseAt, beatAt, gridAt, levelAt, tick, noiseAt,
    paletteFor, backdropFill, groundVisible, filterAllowed, segmentAt,
  };
});
