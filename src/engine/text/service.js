/* 文字PVメーカー v2 — original work. Text service for scene builds: cached layouts plus the metric-free splitters (DESIGN §4.15.4; 文字組み DESIGN_2_2 §1). */
MV.def('engine/text/service', ['core/hash', 'core/script', 'engine/text/layout', 'engine/text/breaker', 'engine/text/faces',
  'engine/text/kumi'],
(H, S, L, B, FACES, KU) => {
  'use strict';

  const CACHE_MAX = 2000;          // §7.3: text layouts, LRU by (RunSpec hash, measurer key)
  const DERIVED_MAX = 16;          // cut-scoped services (withKumi) kept per service; the memo is cleared when full
  // Only these RunSpec fields change a layout; ink, style, reveal, parent and drift do not. An absent field is not
  // keyed, so adding `kumi` (DESIGN_2_2 §1) left every earlier key as it was.
  const LAYOUT_FIELDS = ['span', 'text', 'orient', 'face', 'size', 'tracking', 'leading', 'box', 'align', 'valign',
    'fit', 'maxLines', 'breakAt', 'emph', 'emphScale', 'lang', 'sizeGroup', 'kumi'];

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

  // The kumi field is keyed by its normalized value (KU.key), so equal settings written differently share one entry
  // and a setting that is off (null, all strengths 0) keys like no field at all: the layout is the same.
  function specKey(spec) {
    const picked = {};
    for (const f of LAYOUT_FIELDS) if (spec && spec[f] !== undefined) picked[f] = spec[f];
    if (picked.kumi !== undefined) {
      const k = KU.key(KU.normalize(picked.kumi));
      if (k) picked.kumi = k; else delete picked.kumi;
    }
    return H.hashJSON(picked);
  }

  // createTextService({ measurer, faces, cache?, kumi? }) → TextService. Layout results are shared, read-only objects:
  // callers copy what they need and never write into the typed arrays. withFaces() gives a service for other faces that
  // shares the same cache (keys include the faces).
  //
  // 文字組み (DESIGN_2_2 §1): `kumi` is a cut's typesetting ({ kana, jump, head, latin }, engine/text/kumi). The service
  // lays out every RunSpec merged with it by KU.withCut (a spec that sets `kumi` or `tracking` keeps its own), and the
  // keys hold the merged spec. withKumi(k) gives the service of a cut: memoised per value, sharing the cache; the
  // getter `kumi` is the service's own (null when off). A service without kumi lays out exactly as before.
  function createTextService({ measurer, faces = null, cache = null, kumi = null } = {}) {
    if (!measurer || typeof measurer.width !== 'function' || typeof measurer.metrics !== 'function') {
      throw new TypeError('createTextService needs a Measurer { key, width, metrics }');
    }
    return serviceOf(measurer, faces, cache || createLru(CACHE_MAX), KU.normalize(kumi), H.hashJSON(faces));
  }

  function serviceOf(measurer, faces, lru, cutKumi, facesKey) {
    const keyOf = (spec, text) => [measurer.key, facesKey, specKey(spec), text === undefined ? '' : String(text)].join('|');
    const specOf = (spec) => KU.withCut(spec, cutKumi);

    function layout(spec, text) {
      const s = specOf(spec);
      const key = keyOf(s, text);
      let hit = lru.get(key);
      if (!hit) { hit = L.layoutRun(s, text, faces, measurer); lru.set(key, hit); }
      return hit;
    }

    // layoutAll([{ spec, text }]) → RunLayout[]; runs that share a sizeGroup are fitted together.
    function layoutAll(items) {
      if (!items.some((it) => it.spec && typeof it.spec.sizeGroup === 'string' && it.spec.sizeGroup)) {
        return items.map((it) => layout(it.spec, it.text));
      }
      const list = cutKumi ? items.map((it) => ({ spec: specOf(it.spec), text: it.text })) : items;
      const key = 'group|' + list.map((it) => keyOf(it.spec, it.text)).join('\n');
      let hit = lru.get(key);
      if (!hit) { hit = L.layoutRuns(list, faces, measurer); lru.set(key, hit); }
      return hit;
    }

    // Services derived from this one, by kumi key: at most DERIVED_MAX, cleared when full.
    const derived = new Map();
    function withKumi(k) {
      const nk = KU.normalize(k), key = KU.key(nk);
      if (key === KU.key(cutKumi)) return api;
      let svc = derived.get(key);
      if (!svc) {
        if (derived.size >= DERIVED_MAX) derived.clear();
        svc = serviceOf(measurer, faces, lru, nk, facesKey);
        derived.set(key, svc);
      }
      return svc;
    }

    const api = {
      layout, layoutAll,
      columns: (text, n, lang) => B.columns(text, n, lang),
      phrases: (text, lang) => B.phrases(text, lang),
      words: (text, lang) => B.words(text, lang),
      breakLines: (text, maxCells, lang, mode) => B.breakLines(text, maxCells, lang, mode),
      cells: (str) => S.cells(str),
      fontFor: (role, script) => FACES.fontFor(faces, role, script),
      faces,
      get key() { return measurer.key; },
      get kumi() { return cutKumi; },
      withFaces: (next) => serviceOf(measurer, next, lru, cutKumi, H.hashJSON(next)),
      withKumi,
      clear: () => lru.clear(),
      get cached() { return lru.size; },
    };
    return api;
  }

  return { createTextService, createLru, specKey, CACHE_MAX, DERIVED_MAX, LAYOUT_FIELDS };
});
