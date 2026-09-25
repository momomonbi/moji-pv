/* 文字PVメーカー v2 — original work. Stable 32-bit hashing and canonical-JSON hashing (DESIGN §4.1.1). */
MV.def('core/hash', [], () => {
  'use strict';

  // hash32(...parts): FNV-1a over the UTF-16 code units of each part (String(part)), a separator after each part,
  // then the murmur3 fmix32 finaliser. Returns an unsigned 32-bit integer.  (FROZEN code, DESIGN §4.1.1)
  function hash32(...parts) {
    let h = 0x811c9dc5;
    for (let p = 0; p < parts.length; p++) {
      const s = String(parts[p]);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      h ^= 0x1f; h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  }

  // Serializes a value like JSON.stringify, but with object keys sorted (UTF-16 order) at every depth.
  // Dropped like JSON: undefined, functions and symbols as object values. Non-finite numbers print as null.
  // Typed arrays print as plain arrays. Non-enumerable properties (e.g. plan.env) are never visited.
  function canonical(v) {
    const s = encode(v);
    return s === undefined ? 'null' : s;
  }

  function encode(v) {
    if (v === null) return 'null';
    switch (typeof v) {
      case 'number': return Number.isFinite(v) ? JSON.stringify(v) : 'null';
      case 'string': return JSON.stringify(v);
      case 'boolean': return v ? 'true' : 'false';
      case 'object': return Array.isArray(v) || ArrayBuffer.isView(v) ? encodeList(v) : encodeObject(v);
      default: return undefined;
    }
  }

  function encodeList(list) {
    const out = new Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const s = encode(list[i]);
      out[i] = s === undefined ? 'null' : s;
    }
    return '[' + out.join(',') + ']';
  }

  function encodeObject(obj) {
    if (typeof obj.toJSON === 'function') return encode(obj.toJSON());
    const keys = Object.keys(obj).sort();
    const out = [];
    for (const k of keys) {
      const s = encode(obj[k]);
      if (s !== undefined) out.push(JSON.stringify(k) + ':' + s);
    }
    return '{' + out.join(',') + '}';
  }

  // hashJSON(v): hash32 of the canonical JSON of v, as 8 lowercase hex characters.
  function hashJSON(v) {
    return hash32(canonical(v)).toString(16).padStart(8, '0');
  }

  return { hash32, hashJSON, canonical };
});
