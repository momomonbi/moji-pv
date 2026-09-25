/* 文字PVメーカー v2 — original work. The catalog: every part module under parts/<kind>/ gathered into the default registry (DESIGN §4.6). */
MV.def('parts/catalog', ['core/registry'], (REG) => {
  'use strict';

  // Part modules live in one directory per kind; parts/kit and this file are not part modules.
  const PART_MODULE = /^parts\/(arrange|arrive|dwell|depart|ground|ornament|lens|filter|seam|theme|mood)\//;

  // Every part definition of the part modules defined so far, in module id order. A module defined later (another
  // package's new file) is picked up by the next call; nothing is registered by side effect.
  function defs() {
    return MV.ids('parts/').filter((id) => PART_MODULE.test(id)).flatMap((id) => MV.use(id));
  }

  // The app's registry. Strict by default: a RegistryError lists every problem (§4.6). `opts` is passed on to
  // createRegistry, so { strict: false } gives a partial registry with `problems` while the catalog is incomplete.
  function defaultRegistry(opts) {
    return REG.createRegistry(defs(), opts);
  }

  return { defs, defaultRegistry };
});
