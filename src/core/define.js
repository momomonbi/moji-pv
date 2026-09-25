/* 文字PVメーカー v2 — original work. Module kernel: MV.def / MV.use / MV.ids. */
(function (G) {
  'use strict';
  const MV = G.MV || (G.MV = {});
  const defs = new Map(), done = new Map(), busy = new Set();
  const ID = /^[a-z0-9_]+(\/[a-z0-9_]+)*$/;
  MV.def = (id, deps, factory) => {
    if (!ID.test(id)) throw new Error('MV: bad module id ' + id);
    if (defs.has(id)) throw new Error('MV: duplicate module ' + id);
    if (!Array.isArray(deps) || typeof factory !== 'function') throw new Error('MV: bad definition ' + id);
    defs.set(id, { deps: deps.slice(), factory });
  };
  MV.use = (id) => {
    if (done.has(id)) return done.get(id);
    const d = defs.get(id);
    if (!d) throw new Error('MV: missing module ' + id);
    if (busy.has(id)) throw new Error('MV: dependency cycle at ' + id);
    busy.add(id);
    const out = d.factory(...d.deps.map(MV.use));
    busy.delete(id);
    done.set(id, MV.DEV && out && typeof out === 'object' ? Object.freeze(out) : out);
    return done.get(id);
  };
  MV.ids = (prefix = '') => [...defs.keys()].filter((k) => k.startsWith(prefix)).sort();
  MV.has = (id) => defs.has(id);
})(typeof globalThis !== 'undefined' ? globalThis : this);
