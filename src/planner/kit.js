/* 文字PVメーカー v2 — original work. The set of looks of a song part (演出セット) for 「パートごとに演出をそろえる」 (DESIGN_2_2 §2.1.4). */
MV.def('planner/kit', ['core/hash', 'core/rng', 'core/num', 'planner/choose'], (H, R, N, CH) => {
  'use strict';

  // Each song part draws its layouts, entrances, holds, exits, camera textures, screen effects, decorations and
  // backgrounds from a small set of groups (a family, or a part for kinds without families), with one entrance and one
  // exit family (the best group of each kind) as its signature. The set is a weight on the chooser, never a filter: a
  // member weighs ×KIT, the primary group ×KIT_PRIMARY, everything else as before.
  const KIT_KINDS = Object.freeze(['arrange', 'arrive', 'dwell', 'depart', 'lens', 'filter', 'ornament', 'ground']);
  const KIT_SIZE = Object.freeze({ arrange: 3, arrive: 3, depart: 3, dwell: 2, lens: 2, filter: 2, ornament: 4, ground: 2 });
  const KIT = 8, KIT_PRIMARY = 16;
  // Under the kit, holds and camera textures also pass over the previous cut's value (planner/cast avoidOf), like
  // layouts and entrances: the members' recency relax would otherwise let them repeat back to back.
  const KIT_AVOID = Object.freeze(['dwell', 'lens']);
  const NO_FAMILY = new Set(['ornament', 'ground']);
  const FACES = Object.freeze(['display', 'serif', 'body']);
  const FACE_WEIGHTS = Object.freeze([3, 2, 1]);

  // The group a part counts in: its family (its key when it has none); decorations and backgrounds by key.
  function groupOf(kind, def) {
    if (!def) return null;
    return NO_FAMILY.has(kind) ? def.key : def.family || def.key;
  }

  // select(ctx, part, poolOf, energy) → the kit of one part: frozen { key, kind, face, groups: { kind: [group] } (sorted
  // by name), primary: { kind: group } }. poolOf(kind) = the part pool the kit draws from (mood gates, filters,
  // season, backdrop and texture exclusion applied, planner/cast poolOf). A group weighs the sum over its parts of the
  // look-only chooser factors × the fit of the part's energy range to the part's target energy; the groups are ranked
  // by ln W + Gumbel(seed, group) with seed = hash32('kit', look seed, part key, kind, salt of work:kit.<key>), ties to
  // the smaller name. The seed has no cut key, so no edit elsewhere changes a kit; a salt rerolls its own part only.
  function select(ctx, part, poolOf, energy) {
    const reg = ctx.registry;
    const salt = (ctx.salts && ctx.salts['work:kit.' + part.key]) || 0;
    const seed0 = ctx.doc.look.seed;
    const e = typeof energy === 'number' ? energy : 0.5;
    const want = { energy: e };
    // a typical cut of the part for the parts' own fits (no composition chosen yet): a part that needs a beat weighs
    // little in a song without a tempo, one made for impact lines a quarter
    const typical = { energy: e, beat: ctx.grid ? ctx.grid.period : 0, impact: false, emph: false, words: 2, cells: 8 };
    const groups = {}, primary = {};
    for (const kind of KIT_KINDS) {
      const W = new Map();
      for (const key of poolOf(kind)) {
        const def = reg.get(kind, key);
        const g = groupOf(kind, def);
        if (!g) continue;
        const s = ctx.chooser.statics(kind, key, kind === 'filter');
        const fits = typeof def.fits === 'function' ? Math.max(0, Number(def.fits(typical, {})) || 0) : 1;
        const w = s.product * CH.traitFit(reg.traits(kind, key), want) * fits;
        if (w > 0) W.set(g, (W.get(g) || 0) + w);
      }
      const seed = H.hash32('kit', seed0, part.key, kind, salt);
      const ranked = [...W.keys()].sort()
        .map((g) => ({ g, score: Math.log(W.get(g)) + R.gumbel(seed, g) }))
        .sort((a, b) => b.score - a.score || (a.g < b.g ? -1 : a.g > b.g ? 1 : 0));
      groups[kind] = Object.freeze(ranked.slice(0, KIT_SIZE[kind]).map((x) => x.g).sort());
      primary[kind] = ranked.length ? ranked[0].g : null;
    }
    const face = R.fromSeed(H.hash32('kit', seed0, part.key, 'face', salt)).weighted(FACES.slice(), FACE_WEIGHTS.slice());
    return Object.freeze({ key: part.key, kind: part.kind, face, groups: Object.freeze(groups), primary: Object.freeze(primary) });
  }

  // factorOf(kit, kind, group) → KIT_PRIMARY for the kind's primary group, KIT for another member, else 1.
  function factorOf(kit, kind, group) {
    if (!kit || group === null || group === undefined) return 1;
    if (kit.primary[kind] === group) return KIT_PRIMARY;
    const list = kit.groups[kind];
    return list && list.includes(group) ? KIT : 1;
  }

  return { select, groupOf, factorOf, KIT_KINDS, KIT_SIZE, KIT, KIT_PRIMARY, KIT_AVOID, FACES };
});
