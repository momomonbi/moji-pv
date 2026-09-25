/* 文字PVメーカー v2 — original work. frameAt(plan, t) → FrameGraph, scene evaluation, cameras and rigs, closed-form time lookups (DESIGN §4.19; DESIGN_2_1 §4.4, §4.6). */
MV.def('engine/scene/frame', ['core/num', 'core/hash', 'core/noise', 'core/mat', 'core/beats', 'core/curve', 'core/shot',
  'audio/digest', 'engine/scene/table', 'engine/scene/behave', 'engine/scene/shot'],
(N, H, NZ, MAT, BEATS, CV, SHOT, DIG, T, BH, SS) => {
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
    return { byA, aSorted, span, cutIndex, seams, impulses, impT, beats, env, rigs: rigIndex(plan) };
  }

  // --- rigs (DESIGN_2_1 §4.6): the area camera, a pure lookup ------------------------------------------------------

  // Per run: its window, blend and keys as typed arrays (u, ln zoom, x and y in du, roll in radians) with the curve
  // INTO each key compiled once. A run whose rig is 'none' (or unreadable) has no keys and poses the identity.
  function rigIndex(plan) {
    const list = Array.isArray(plan.rigs) ? plan.rigs : [];
    const W = plan.design ? plan.design.w : 0, Hh = plan.design ? plan.design.h : 0;
    const runs = list.map((r) => {
      const rig = SHOT.expandRig(r.rig ? r.rig.v : 'none', {
        amp: r.rig && r.rig.p && Number.isFinite(r.rig.p.amp) ? r.rig.p.amp : 1,
        curve: r.curve && r.curve.v !== undefined ? r.curve.v : null });
      const keys = rig ? rig.keys : [];
      const n = keys.length;
      const run = { t0: r.t0, t1: r.t1, n, blend: r.blend && r.blend.t1 > r.blend.t0 ? { t0: r.blend.t0, t1: r.blend.t1 } : null,
        u: new Float64Array(n), lz: new Float64Array(n), x: new Float64Array(n), y: new Float64Array(n), roll: new Float64Array(n),
        curve: keys.map((k) => CV.fn(k.curve)) };
      keys.forEach((k, i) => {
        run.u[i] = k.u; run.lz[i] = Math.log(k.zoom); run.x[i] = k.x * W; run.y[i] = k.y * Hh; run.roll[i] = k.roll * N.DEG;
      });
      return run;
    });
    return { runs, t0: Float64Array.from(runs, (r) => r.t0) };
  }

  const RIG_A = { x: 0, y: 0, zoom: 1, roll: 0 }, RIG_B = { x: 0, y: 0, zoom: 1, roll: 0 };

  // The pose of one run at t into out: keys interpolated in run-normalized time with the curve into each key; zoom in
  // log space. Held before the first key and after the last; equal u = a jump. Returns out with zoom as ln zoom.
  function runPose(run, t, out) {
    out.x = 0; out.y = 0; out.zoom = 0; out.roll = 0;
    if (run.n === 0) return out;
    const u = run.t1 > run.t0 ? N.clamp((t - run.t0) / (run.t1 - run.t0)) : 1;
    let i = 0;
    while (i < run.n - 1 && run.u[i + 1] <= u) i++;
    if (i >= run.n - 1 || u <= run.u[0]) {
      const k = u <= run.u[0] ? 0 : run.n - 1;
      out.x = run.x[k]; out.y = run.y[k]; out.zoom = run.lz[k]; out.roll = run.roll[k];
      return out;
    }
    const span = run.u[i + 1] - run.u[i];
    const f = span > 0 ? run.curve[i + 1]((u - run.u[i]) / span) : 1;
    out.x = run.x[i] + (run.x[i + 1] - run.x[i]) * f;
    out.y = run.y[i] + (run.y[i + 1] - run.y[i]) * f;
    out.zoom = run.lz[i] + (run.lz[i + 1] - run.lz[i]) * f;
    out.roll = run.roll[i] + (run.roll[i + 1] - run.roll[i]) * f;
    return out;
  }

  // rigAt(plan, t, out) → out { x, y (du), zoom, roll (radians) }: the rig of the run holding t (binary search on t0;
  // before the first run the first, after the last the last). Inside a run's blend window (a non-hard seam into it) the
  // previous run's pose eases into this one's with smoothstep, zoom in log space; the window may start before the run.
  // Identity without rigs. Pure; the index is cached by plan identity.
  function rigAt(plan, t, out) {
    const o = out || { x: 0, y: 0, zoom: 1, roll: 0 };
    const rx = indexOf(plan).rigs;
    const runs = rx.runs;
    if (runs.length === 0) { o.x = 0; o.y = 0; o.zoom = 1; o.roll = 0; return o; }
    let k = Math.max(0, lastAtOrBefore(rx.t0, t));
    const next = runs[k + 1];
    if (next && next.blend && t >= next.blend.t0 && t < next.blend.t1) k++;
    const run = runs[k];
    const cur = runPose(run, t, RIG_A);
    const bl = run.blend;
    if (k > 0 && bl && t >= bl.t0 && t < bl.t1) {
      const prev = runPose(runs[k - 1], Math.min(t, runs[k - 1].t1), RIG_B);
      const w = N.smooth((t - bl.t0) / (bl.t1 - bl.t0)), v = 1 - w;
      cur.x = prev.x * v + cur.x * w; cur.y = prev.y * v + cur.y * w;
      cur.zoom = prev.zoom * v + cur.zoom * w; cur.roll = prev.roll * v + cur.roll * w;
    }
    o.x = cur.x; o.y = cur.y; o.zoom = Math.exp(cur.zoom); o.roll = cur.roll;
    return o;
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

  // evaluate(scene, tl) → scene.table with the live pose of local time tl solved (reset → behaviours → world → the
  // shot's follow lean on the camera, DESIGN_2_1 §4.5.6). Pure in (scene, tl): nothing survives from an earlier call.
  function evaluate(scene, tl) {
    const table = scene.table;
    T.resetLive(table);
    BH.runBehaviours(table.live, scene.behaviours, tl);
    T.solve(table);
    if (scene.lean) SS.leanInto(scene);
    return table;
  }

  // --- cameras (§4.19.3; DESIGN_2_1 §4.4) ----------------------------------------------------------------------------

  // cutCamera(scene, out) → out { x, y, zoom, roll, jx, jy, fz }: the camera node of an evaluated scene (lens ∘ shot ∘
  // lean) before the rig and the impulses; fz = the shot's own zoom at this evaluation (1 without a shot).
  function cutCamera(scene, out) {
    const o = out || { x: 0, y: 0, zoom: 1, roll: 0, jx: 0, jy: 0, fz: 1 };
    const P = scene.table.live, c = scene.cam;
    o.x = P.x[c]; o.y = P.y[c]; o.zoom = P.sx[c]; o.roll = P.rot[c]; o.jx = P.jx[c]; o.jy = P.jy[c];
    o.fz = scene.shot ? scene.shot.live.zoom : 1;
    return o;
  }

  const NO_CUT = Object.freeze({ x: 0, y: 0, zoom: 1, roll: 0, jx: 0, jy: 0, fz: 1 });

  // composeCamera(cut, rig, plan, t, out) → CamPose { x, y, zoom, roll, shakeX, shakeY, fz }: the rig (outer) composed
  // with a cut camera (inner), then the impulses at absolute time t (§4.4 step 4):
  //   zoom = Zc · Zr · (1 + PUNCH · punch);  x = Xc + Xr / Zc;  y = Yc + Yr / Zc;  roll = Rc + Rr
  //   shake = the camera's own jitter + the shake impulse / (framing zoom · Zr)
  // With roll 0 this is exactly the product of the two view transforms. The impulse shake is kept screen-constant under
  // the framing zoom (the shot's and the rig's); like the lens deltas it is not rescaled by the lens's own zoom, so a
  // plan without shots and rigs gives the v2 camera exactly. fz = the framing zoom (shot · rig).
  function composeCamera(k, r, plan, t, out) {
    const o = out || { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0, fz: 1 };
    const shake = impulseAt(plan, 'shake', t);
    const punch = impulseAt(plan, 'punch', t);
    const fz = k.fz * r.zoom;
    o.x = k.x + r.x / k.zoom; o.y = k.y + r.y / k.zoom; o.roll = k.roll + r.roll;
    o.zoom = k.zoom * r.zoom * (1 + PUNCH * punch);
    o.shakeX = k.jx + (shake ? (shake * (NZ.noise2(SHAKE_SEED, t * SHAKE_RATE, 0) - 0.5) * SHAKE_DU) / fz : 0);
    o.shakeY = k.jy + (shake ? (shake * (NZ.noise2(SHAKE_SEED, t * SHAKE_RATE, 1) - 0.5) * SHAKE_DU) / fz : 0);
    o.fz = fz;
    return o;
  }

  const CUT_TMP = { x: 0, y: 0, zoom: 1, roll: 0, jx: 0, jy: 0, fz: 1 };
  const RIG_TMP = { x: 0, y: 0, zoom: 1, roll: 0 };

  // cameraAt(scene, plan, t, out) → CamPose: the camera of an evaluated scene composed with the plan's rig and impulses
  // at absolute time t, { x, y, zoom, roll, shakeX, shakeY, fz } into `out`.
  function cameraAt(scene, plan, t, out) {
    return composeCamera(cutCamera(scene, CUT_TMP), rigAt(plan, t, RIG_TMP), plan, t, out);
  }

  // rigCamera(plan, t, out) → CamPose: the rig plus the impulses, for grounds while no cut is on screen, so the area move
  // continues through interludes and the ground never jumps.
  function rigCamera(plan, t, out) {
    return composeCamera(NO_CUT, rigAt(plan, t, RIG_TMP), plan, t, out);
  }

  // depthCam(cam, f, out) → CamPose: the camera a photo or video at camera factor f sees (DESIGN_2_1 §11.9.3; the kit
  // exports it as K.depthCam): x, y, roll and the shakes times f, zoom' = exp(f · ln zoom) (the framing zoom alike).
  // f = 1 is the camera itself (exactly), f = 0 no camera at all; a factor above 1 is lowered so the zoom stays ≤ 4.
  const DEPTH_ZOOM_MAX = 4;
  function depthCam(cam, f, out) {
    const o = out || { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0, fz: 1 };
    const fz = cam.fz === undefined ? 1 : cam.fz;
    if (f === 1) {
      o.x = cam.x; o.y = cam.y; o.zoom = cam.zoom; o.roll = cam.roll; o.shakeX = cam.shakeX; o.shakeY = cam.shakeY; o.fz = fz;
      return o;
    }
    if (!(f > 0)) {
      o.x = 0; o.y = 0; o.zoom = 1; o.roll = 0; o.shakeX = 0; o.shakeY = 0; o.fz = 1;
      return o;
    }
    let k = f;
    if (k > 1 && cam.zoom > 1) k = Math.min(k, Math.log(DEPTH_ZOOM_MAX) / Math.log(cam.zoom));
    o.x = k * cam.x; o.y = k * cam.y; o.roll = k * cam.roll;
    o.zoom = Math.exp(k * Math.log(cam.zoom));
    o.shakeX = k * cam.shakeX; o.shakeY = k * cam.shakeY;
    o.fz = Math.exp(k * Math.log(fz));
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
    rigAt, rigCamera, cutCamera, composeCamera, depthCam, DEPTH_ZOOM_MAX,
  };
});
