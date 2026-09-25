/* 文字PVメーカー v2 — original work. Text service for scene builds: cached layouts plus the metric-free splitters (DESIGN §4.15.4). */
MV.def('engine/text/service', ['core/hash', 'core/script', 'engine/text/layout', 'engine/text/breaker', 'engine/text/faces'],
(H, S, L, B, FACES) => {
  'use strict';

  const CACHE_MAX = 2000;          // §7.3: text layouts, LRU by (RunSpec hash, measurer key)
  // Only these RunSpec fields change a layout; ink, style, reveal, parent and drift do not.
  const LAYOUT_FIELDS = ['span', 'text', 'orient', 'face', 'size', 'tracking', 'leading', 'box', 'align', 'valign',
    'fit', 'maxLines', 'breakAt', 'emph', 'emphScale', 'lang', 'sizeGroup'];

  function createLru(max) {
    const map = new Map();
    return {
      get(key) {
        if (!map.has(key)) return undefined;
        const v = map.get(key);
        map.delete(key);
        map.set(key, v);
        return v;
      },
      set(key, v) {
        if (map.has(key)) map.delete(key);
        map.set(key, v);
        while (map.size > max) map.delete(map.keys().next().value);
      },
      clear() { map.clear(); },
      get size() { return map.size; },
    };
  }

  function specKey(spec) {
    const picked = {};
    for (const f of LAYOUT_FIELDS) if (spec && spec[f] !== undefined) picked[f] = spec[f];
    return H.hashJSON(picked);
  }

  // createTextService({ measurer, faces }) → TextService. Layout results are shared, read-only objects: callers copy
  // what they need and never write into the typed arrays. withFaces() gives a service for other faces that shares the
  // same cache (keys include the faces).
  function createTextService({ measurer, faces = null, cache = null } = {}) {
    if (!measurer || typeof measurer.width !== 'function' || typeof measurer.metrics !== 'function') {
      throw new TypeError('createTextService needs a Measurer { key, width, metrics }');
    }
    const lru = cache || createLru(CACHE_MAX);
    const facesKey = H.hashJSON(faces);
    const keyOf = (spec, text) => [measurer.key, facesKey, specKey(spec), text === undefined ? '' : String(text)].join('|');

    function layout(spec, text) {
      const key = keyOf(spec, text);
      let hit = lru.get(key);
      if (!hit) { hit = L.layoutRun(spec, text, faces, measurer); lru.set(key, hit); }
      return hit;
    }

    // layoutAll([{ spec, text }]) → RunLayout[]; runs that share a sizeGroup are fitted together.
    function layoutAll(items) {
      if (!items.some((it) => it.spec && typeof it.spec.sizeGroup === 'string' && it.spec.sizeGroup)) {
        return items.map((it) => layout(it.spec, it.text));
      }
      const key = 'group|' + items.map((it) => keyOf(it.spec, it.text)).join('\n');
      let hit = lru.get(key);
      if (!hit) { hit = L.layoutRuns(items, faces, measurer); lru.set(key, hit); }
      return hit;
    }

    return {
      layout, layoutAll,
      columns: (text, n, lang) => B.columns(text, n, lang),
      phrases: (text, lang) => B.phrases(text, lang),
      words: (text, lang) => B.words(text, lang),
      breakLines: (text, maxCells, lang, mode) => B.breakLines(text, maxCells, lang, mode),
      cells: (str) => S.cells(str),
      fontFor: (role, script) => FACES.fontFor(faces, role, script),
      faces,
      get key() { return measurer.key; },
      withFaces: (next) => createTextService({ measurer, faces: next, cache: lru }),
      clear: () => lru.clear(),
      get cached() { return lru.size; },
    };
  }

  return { createTextService, createLru, CACHE_MAX };
});
