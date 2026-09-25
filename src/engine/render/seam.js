/* 文字PVメーカー v2 — original work. Seams: the transition part of a plan seam, its params and the guarded mix of two surfaces (DESIGN §4.19.2 step 4; DESIGN_2_1 §4.2). */
MV.def('engine/render/seam', ['core/hash', 'core/curve', 'engine/scene/table', 'engine/render/post'], (H, CV, T, PO) => {
  'use strict';

  // A text seam composes only the text and near layers of the two sides (the ground and the far layers are drawn once
  // underneath); a world seam composes two complete worlds. Either way the post stack runs once, on the result.
  const TEXT_LAYERS = Object.freeze([T.LAYER_INDEX.text, T.LAYER_INDEX.near]);

  const resolved = new WeakMap();        // plan seam entry → { def, p, seed, warp }

  // seamPart(plan, registry, i) → { def, p, seed, warp } for plan.seams[i] (p.dur = the window's length); an unknown key
  // falls back to the kind's fallback. warp = CV.warp(p.curve), the transition's progress curve (seam.curve, linear by
  // default): mix() receives warp(u); the ground camera blend and the current-cut switch keep the raw u.
  function seamPart(plan, registry, i) {
    const s = plan.seams[i];
    let hit = resolved.get(s);
    if (hit && hit.registry === registry) return hit;
    const slot = s.slot || {};
    let def = slot.v ? registry.get('seam', slot.v) : null;
    const unknown = !def;
    if (!def) def = registry.get('seam', registry.fallback('seam'));
    const seed = H.hash32('seam', s.into || '', slot.v || '', s.at);
    const b = (plan.cuts || []).find((c) => c.key === s.into) || null;
    const look = { amounts: plan.look.amounts || {}, mood: null, bpm: plan.beats ? plan.beats.bpm : null };
    const ax = { f: (b && b.feat) || {}, look };
    let p = PO.paramsFor(registry, def, unknown ? { v: def.key } : slot, seed, ax);
    // The window the planner gave (planner/tracks clamps the slot's `dur` to 0.4 × the shorter cut, 0.8 s for world
    // seams): a part that counts time over the transition (glitchSwap's ticks) reads the real length.
    if (typeof s.dur === 'number' && s.dur > 0 && p.dur !== s.dur) p = Object.freeze(Object.assign({}, p, { dur: s.dur }));
    hit = { def, p, seed, registry, unknown, warp: CV.warp(p.curve) };
    resolved.set(s, hit);
    return hit;
  }

  // mix(ctl, pool, part, a, b, u) → Surface: part.def.mix(fx, a, b, part.warp(u), p) with u clamped, checked result. A
  // part that throws or returns something that is not a surface gives a hard cut (a before u = 0.5, b after) and the
  // error, so a broken transition never breaks the frame.
  function mix(ctl, pool, part, a, b, u, onError) {
    const k = u < 0 ? 0 : u > 1 ? 1 : u;
    const w = part.warp ? part.warp(k) : k;
    ctl.use(part.seed, null, false);
    try {
      const out = part.def.mix(ctl.fx, a, b, w, part.p);
      if (!out || !out.canvas || !out.ctx) throw new PO.FxError('bad-result', 'mix() must return a Surface');
      return out;
    } catch (err) {
      if (onError) onError(part, err);
      return k < 0.5 ? a : b;
    }
  }

  return { TEXT_LAYERS, seamPart, mix };
});
