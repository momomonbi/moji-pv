/* 文字PVメーカー v2 — original work. Material runtime (stub): the parts/mix interface that package C fills in (DESIGN_2_1 §3.12, §5.9). */
MV.def('parts/mix', ['core/num', 'core/hash', 'core/rng', 'core/noise', 'core/curve', 'core/recipe', 'core/registry',
  'parts/kit', 'engine/scene/behave'], () => {
  'use strict';

  // The stub keeps every caller working before the interpreter lands: no material is ever derived, so the effective
  // registry is the base registry itself (same identity, same plan hashes) and nothing reads a material hash.
  const SHAPE_LIB = Object.freeze({});

  // derive(entry, base) → { def | null, problems }
  function derive() { return { def: null, problems: [] }; }

  // registryFor(base, materials, media?) → Registry: the base itself while materials are not interpreted.
  function registryFor(base) { return base; }

  // materialHash(entry) → 'xxxxxxxx'
  function materialHash() { return '00000000'; }

  // sampleDefs() → def[] (conformance and the lab)
  function sampleDefs() { return []; }

  return { SHAPE_LIB, derive, registryFor, materialHash, sampleDefs };
});
