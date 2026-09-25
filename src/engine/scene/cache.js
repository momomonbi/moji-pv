/* 文字PVメーカー v2 — original work. Scene cache: LRU of built scenes by (fingerprint, measurer key) with prefetch (DESIGN §4.17.5, §7.3). */
MV.def('engine/scene/cache', [], () => {
  'use strict';

  const MAX = 16;

  function keyOf(fp, fontKey) { return String(fp) + '|' + String(fontKey); }

  // createSceneCache({ max = 16 }) → { get(fp, fontKey), put(scene), prefetch(plan, t0, t1, build), has, clear, size }
  // Scenes are keyed by the fingerprint of what they were built from (cut or segment `fp`) and the measurer key they
  // were laid out with (scene.fontKey), so a font load (new measurer key) rebuilds them. Scenes with equal keys are
  // interchangeable: place them in time with the FrameGraph, never with scene.key / scene.span.
  function createSceneCache(opts) {
    const max = opts && Number.isInteger(opts.max) && opts.max > 0 ? opts.max : MAX;
    const map = new Map();
    let fontKey = null;

    function touch(key, scene) {
      map.delete(key);
      map.set(key, scene);
      while (map.size > max) map.delete(map.keys().next().value);
    }

    function get(fp, fk) {
      fontKey = fk;
      const key = keyOf(fp, fk);
      const scene = map.get(key);
      if (scene) touch(key, scene);
      return scene || null;
    }

    function has(fp, fk) { return map.has(keyOf(fp, fk === undefined ? fontKey : fk)); }

    function put(scene) {
      if (!scene || scene.fp === undefined) throw new TypeError('scene cache: put needs a scene with fp');
      if (fontKey === null && scene.fontKey !== undefined) fontKey = scene.fontKey;
      touch(keyOf(scene.fp, scene.fontKey), scene);
      return scene;
    }

    // Builds the missing scenes of every cut visible in [t0, t1] and every ground segment overlapping it, nearest
    // first, at most the cache size of them. build(item, kind) → Scene, kind = 'cut' | 'ground'. Presence is checked
    // under the measurer key of the latest get() (or of the first put() before any get). The window's scenes that are
    // already cached are touched first, farthest first, so they outrank everything outside the window and the nearest
    // are the most recent: the scenes built next evict only scenes outside the window, never each other (the window
    // holds at most `max` items), so an idle prefetch per frame builds each scene once. Returns the keys it built.
    function prefetch(plan, t0, t1, build) {
      const mid = (t0 + t1) / 2;
      const items = [];
      for (const c of plan.cuts || []) if (c.a <= t1 && c.b >= t0) items.push({ item: c, kind: 'cut', d: distance(c.a, c.b, mid) });
      for (const g of plan.grounds || []) if (g.t0 <= t1 && g.t1 >= t0) items.push({ item: g, kind: 'ground', d: distance(g.t0, g.t1, mid) });
      items.sort((p, q) => p.d - q.d || (p.kind < q.kind ? -1 : p.kind > q.kind ? 1 : 0) || p.item.t0 - q.item.t0);
      const near = items.slice(0, max);
      for (let k = near.length - 1; k >= 0; k--) {
        const key = keyOf(near[k].item.fp, fontKey);
        if (map.has(key)) touch(key, map.get(key));
      }
      const built = [];
      for (const { item, kind } of near) {
        if (has(item.fp)) continue;
        const scene = build(item, kind);
        if (scene) { put(scene); built.push(item.key); }
      }
      return built;
    }

    return {
      get, has, put, prefetch,
      clear() { map.clear(); },
      get size() { return map.size; },
      get fontKey() { return fontKey; },
    };
  }

  function distance(a, b, t) { return t < a ? a - t : t > b ? t - b : 0; }

  return { MAX, createSceneCache };
});
