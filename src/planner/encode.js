/* 文字PVメーカー v2 — original work. Plan encoding: canonical text, the streamed plan hash and cut fingerprints (DESIGN §3.12, §7.1). */
MV.def('planner/encode', ['core/hash'], (H) => {
  'use strict';

  // --- canonical text ----------------------------------------------------------------------------------------
  // The canonical JSON of core/hash.canonical (keys sorted at every depth, undefined dropped, non-finite numbers as
  // null), written for plain plan data. tests/node/planner_determinism.test.js checks it against core/hash.canonical
  // on every corpus plan.

  const PLAIN = /^[^"\\\u0000-\u001f\ud800-\udfff]*$/;
  function quote(s) { return PLAIN.test(s) ? '"' + s + '"' : JSON.stringify(s); }

  // Object keys repeat endlessly in a plan (slot names, param names), so their quoted form is cached.
  const keyText = new Map();
  function quoteKey(k) {
    let q = keyText.get(k);
    if (q === undefined) {
      q = quote(k) + ':';
      if (keyText.size > 4096) keyText.clear();
      keyText.set(k, q);
    }
    return q;
  }

  // JSON.stringify prints a value exactly as the canonical form does when every object in it has its keys in sorted
  // order and none needs toJSON or is a typed array (primitives, undefined, functions and non-finite numbers print
  // alike in both). The planner builds its hot objects (parameters, features, element maps, lines) with sorted keys,
  // so their text comes from the native encoder. A big frozen object never changes, so its answer is kept.
  const asIsFrozen = new WeakMap();
  const REMEMBER = 8;                    // objects with fewer keys are checked again (cheaper than the WeakMap)
  function asIs(v) {
    if (v === null || typeof v !== 'object') return true;
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) if (!asIs(v[i])) return false;
      return true;
    }
    if (ArrayBuffer.isView(v) || typeof v.toJSON === 'function') return false;
    const keys = Object.keys(v);
    const remember = keys.length >= REMEMBER && Object.isFrozen(v);
    if (remember) {
      const known = asIsFrozen.get(v);
      if (known !== undefined) return known;
    }
    let ok = true;
    for (let i = 0; i < keys.length && ok; i++) ok = (i === 0 || keys[i - 1] < keys[i]) && asIs(v[keys[i]]);
    if (remember) asIsFrozen.set(v, ok);
    return ok;
  }

  function canon(v) {
    if (v === null) return 'null';
    switch (typeof v) {
      case 'number': return Number.isFinite(v) ? String(v) : 'null';
      case 'string': return quote(v);
      case 'boolean': return v ? 'true' : 'false';
      case 'object': break;
      default: return undefined;
    }
    if (ArrayBuffer.isView(v) || typeof v.toJSON === 'function') return H.canonical(v);
    if (asIs(v)) return JSON.stringify(v);
    if (Array.isArray(v)) {
      let out = '[';
      for (let i = 0; i < v.length; i++) {
        const s = canon(v[i]);
        out += (i ? ',' : '') + (s === undefined ? 'null' : s);
      }
      return out + ']';
    }
    const keys = Object.keys(v);
    if (keys.length > 1) keys.sort();
    let out = '{', first = true;
    for (const k of keys) {
      const s = canon(v[k]);
      if (s === undefined) continue;
      out += (first ? '' : ',') + quoteKey(k) + s;
      first = false;
    }
    return out + '}';
  }

  // Decisions, features and element maps never change once made (cached casts are frozen), so each one's canonical
  // text is made once, however many plans reuse the object.
  const textOf = new WeakMap();
  function objectCanon(v) {
    if (v === null || typeof v !== 'object') return canon(v);
    let t = textOf.get(v);
    if (t === undefined) { t = canon(v); textOf.set(v, t); }
    return t;
  }

  // --- streaming hash32 ---------------------------------------------------------------------------------------
  // core/hash.hash32 is FNV-1a over each part followed by a separator, then fmix32. Feeding the pieces of a long text
  // one by one gives the same number as hashing the joined text, without building it (§3.12: hash = hashJSON(plan)).
  const FNV_BASIS = 0x811c9dc5;
  function feed(h, s) {
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h;
  }
  function feedAll(h, parts) { for (let i = 0; i < parts.length; i++) h = feed(h, parts[i]); return h; }
  // feed for the flat cut texts of planHash only. It is feed's loop with type feedback of its own: feed also meets
  // every piece encodeCut hashes (sliced and concatenated strings of many shapes), and sharing it left the plan
  // hash's long loop about three times slower in some plans (a re-plan of project_long 5 → 7 ms).
  function feedText(h, s) {
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h;
  }
  function endPart(h) { return Math.imul(h ^ 0x1f, 0x01000193); }
  function finish(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  }
  function hex8(n) { return n.toString(16).padStart(8, '0'); }

  // --- decisions -----------------------------------------------------------------------------------------------

  // A decision's canonical text (plan hash) and the canonical text of what a scene reads from it, { p, v }
  // (fingerprint): where a value came from (from, by, pfrom) is not drawn, so pinning or locking a value as it is
  // keeps the cut's scene (§3.12 fp).
  const DECISION_KEYS = new Set(['by', 'from', 'p', 'pfrom', 'v']);
  const decisionOf = new WeakMap();
  function decisionTexts(d) {
    let t = decisionOf.get(d);
    if (t !== undefined) return t;
    const p = d.p === undefined ? undefined : canon(d.p);
    const v = canon(d.v);
    const scene = '{' + (p === undefined ? '' : '"p":' + p + ',') + '"v":' + v + '}';
    let full;
    if (Object.keys(d).every((k) => DECISION_KEYS.has(k))) {
      const fields = [['by', canon(d.by)], ['from', canon(d.from)], ['p', p], ['pfrom', canon(d.pfrom)], ['v', v]];
      full = '{' + fields.filter((f) => f[1] !== undefined).map((f) => quoteKey(f[0]) + f[1]).join(',') + '}';
    } else full = canon(d);
    t = { full, scene };
    decisionOf.set(d, t);
    return t;
  }

  // A plain decision: only the five fields, a value, p and pfrom that JSON.stringify prints canonically (primitives,
  // and the canonical curve and shot objects of v2.1, whose keys core/curve and core/shot sort).
  function plainDecision(d) {
    if (!d || d.v === undefined || (typeof d.v === 'object' && d.v !== null && !asIs(d.v))) return false;
    if (typeof d.by !== 'string' && d.by !== undefined) return false;
    if (typeof d.from !== 'string' && d.from !== undefined) return false;
    for (const f of Object.keys(d)) if (!DECISION_KEYS.has(f)) return false;
    return asIs(d.p) && asIs(d.pfrom);
  }

  // The fixed pieces around a decision's parameters, cached: the plan text of slot `k` (first or not) is
  // head(k, by, from, p?) + P + tail(pfrom, v); its fingerprint text is sceneHead(k, p?) + P + ',"v":' + V + '}'.
  // Per slot name: the four fingerprint heads (first or not × with or without p) and the plan heads by from and by.
  // Lookups use the names as they are (no key strings are built per cut).
  const slotPieces = new Map();
  function piecesOf(k) {
    let e = slotPieces.get(k);
    if (e === undefined) {
      if (slotPieces.size > 1024) slotPieces.clear();
      const q = quoteKey(k);
      e = { scene: [',' + q + '{', ',' + q + '{"p":', q + '{', q + '{"p":'], plan: new Map() };
      slotPieces.set(k, e);
    }
    return e;
  }

  function planHead(first, k, by, from, hasP) {
    const e = piecesOf(k);
    let byFrom = e.plan.get(from);
    if (byFrom === undefined) { byFrom = new Map(); e.plan.set(from, byFrom); }
    let heads = byFrom.get(by);
    if (heads === undefined) {
      const fields = [];
      if (by !== undefined) fields.push('"by":' + JSON.stringify(by));
      if (from !== undefined) fields.push('"from":' + JSON.stringify(from));
      const open = quoteKey(k) + '{' + fields.join(',');
      const withP = open + (fields.length ? ',"p":' : '"p":');
      heads = [',' + open, ',' + withP, open, withP];
      byFrom.set(by, heads);
    }
    return heads[(first ? 2 : 0) + (hasP ? 1 : 0)];
  }

  function sceneHead(first, k, hasP) { return piecesOf(k).scene[(first ? 2 : 0) + (hasP ? 1 : 0)]; }

  // A decision's value as its closing piece: [',"v":' + JSON + '}', '"v":' + JSON + '}'] (after other fields, alone).
  // Part keys, other string values and numbers (counts, scales and the camera's rounded values) repeat, so their
  // pieces are made once (the hash then reads flat strings); other values get fresh pieces.
  const valueTails = new Map();
  function valueTail(v) {
    if (typeof v !== 'string' && typeof v !== 'number') { const j = JSON.stringify(v); return [',"v":' + j + '}', '"v":' + j + '}']; }
    let s = valueTails.get(v);
    if (s === undefined) {
      if (valueTails.size > 4096) valueTails.clear();
      const j = JSON.stringify(v);
      s = [',"v":' + j + '}', '"v":' + j + '}'];
      valueTails.set(v, s);
    }
    return s;
  }

  // --- cuts ----------------------------------------------------------------------------------------------------

  // encodeCut(cut, keys, extra) → { fp, parts, pieces }. cut = a plan cut (fp not yet set); keys = its sorted slot
  // names; extra = the fingerprint's other inputs [els, window lead, window length, shared look, beat phase, loudness offset].
  // The fingerprint hashes the scene inputs: text, emph, impact, note, role, lang, feat, the slots as { p, v } and
  // `extra` (§3.12 fp). parts = the canonical text of the cut (with fp) in pieces, for the streamed plan hash; each
  // parameter object is printed once, natively, and shared by both. pieces: what retimeCut reuses (general path: none).
  function encodeCut(cut, keys, extra) {
    const slots = cut.slots;
    let plain = asIs(cut.feat) && asIs(cut.els) && asIs(cut.emph);
    for (let i = 0; i < keys.length && plain; i++) plain = plainDecision(slots[keys[i]]);
    if (!plain) return encodeCutParts(cut, keys, extra);
    const P = new Array(keys.length), V = new Array(keys.length);
    for (let i = 0; i < keys.length; i++) {
      const d = slots[keys[i]];
      P[i] = d.p === undefined ? null : JSON.stringify(d.p);
      V[i] = valueTail(d.v);
    }
    const feat = objectCanon(cut.feat);
    let h = FNV_BASIS;
    for (const x of [canon(cut.text), canon(cut.emph), canon(cut.impact), canon(cut.note), canon(cut.role), canon(cut.lang),
      feat]) h = endPart(feed(h, x));
    h = feed(h, '{');
    for (let i = 0; i < keys.length; i++) {
      h = feed(h, sceneHead(i === 0, keys[i], P[i] !== null));
      // { p, v }: ',"v":…}' after the parameters, '"v":…}' alone
      h = P[i] !== null ? feed(feed(h, P[i]), V[i][0]) : feed(h, V[i][1]);
    }
    h = endPart(feed(h, '}'));
    for (const x of extra) h = endPart(feed(h, String(x)));
    const fp = hex8(finish(h));
    return { fp, parts: cutPieces(cut, keys, fp, feat, P, V), pieces: { feat, P, V } };
  }

  // retimeCut(cut, keys, enc) → parts | null: the parts of a cut with enc's scene (every fingerprint input equal) at
  // other absolute times (a, b, t0, t1, repT), reusing enc's printed features and decisions; null when enc was made
  // by the general path (encodeCutParts), whose pieces are not kept.
  function retimeCut(cut, keys, enc) {
    const q = enc.pieces;
    return q ? cutPieces(cut, keys, enc.fp, q.feat, q.P, q.V) : null;
  }

  // `rig` (the cut's rig run, Plan v2) is printed next to `ground`, in key order.
  function cutPieces(cut, keys, fp, feat, P, V) {
    const head = JSON.stringify({ a: cut.a, b: cut.b, els: cut.els, emph: cut.emph });
    const mid = JSON.stringify({ fp, ground: cut.ground, impact: cut.impact, key: cut.key, lang: cut.lang, line: cut.line,
      note: cut.note, pinKey: cut.pinKey, repT: cut.repT, rig: cut.rig, role: cut.role, seamIn: cut.seamIn });
    const parts = [head.slice(0, -1) + ',"feat":' + feat + ',' + mid.slice(1, -1) + ',"slots":{'];
    for (let i = 0; i < keys.length; i++) {
      const d = cut.slots[keys[i]];
      const hasP = P[i] !== null;
      parts.push(planHead(i === 0, keys[i], d.by, d.from, hasP));
      if (hasP) parts.push(P[i]);
      let sep = hasP || d.by !== undefined || d.from !== undefined;
      let tail = '';
      if (d.pfrom !== undefined) { tail += (sep ? ',' : '') + '"pfrom":' + JSON.stringify(d.pfrom); sep = true; }
      if (tail !== '') parts.push(tail);
      parts.push(sep ? V[i][0] : V[i][1]);
    }
    parts.push('},' + JSON.stringify({ t0: cut.t0, t1: cut.t1, text: cut.text }).slice(1));
    return parts;
  }

  // The same encoding for any data (decisions with other fields, unsorted objects): canonical texts part by part.
  function encodeCutParts(cut, keys, extra) {
    const t = {
      text: canon(cut.text), emph: canon(cut.emph), impact: canon(cut.impact), note: canon(cut.note), role: canon(cut.role),
      lang: canon(cut.lang), feat: objectCanon(cut.feat), els: objectCanon(cut.els),
    };
    let h = FNV_BASIS;
    for (const x of [t.text, t.emph, t.impact, t.note, t.role, t.lang, t.feat]) h = endPart(feed(h, x));
    h = endPart(feedAll(h, slotsParts(cut.slots, keys, 'scene')));
    for (const x of extra) h = endPart(feed(h, String(x)));
    const fp = hex8(finish(h));
    const parts = [];
    let pending = '{';
    const put = (key, text) => {
      if (text === undefined) return;
      pending += (pending.length > 1 || parts.length ? ',' : '') + quoteKey(key);
      if (Array.isArray(text)) { parts.push(pending); parts.push(...text); pending = ''; }
      else pending += text;
    };
    put('a', canon(cut.a)); put('b', canon(cut.b)); put('els', t.els); put('emph', t.emph); put('feat', t.feat);
    put('fp', '"' + fp + '"'); put('ground', canon(cut.ground)); put('impact', t.impact); put('key', canon(cut.key));
    put('lang', t.lang); put('line', canon(cut.line)); put('note', t.note);
    if (cut.pinKey !== undefined) put('pinKey', canon(cut.pinKey));
    put('repT', canon(cut.repT));
    if (cut.rig !== undefined) put('rig', canon(cut.rig));
    put('role', t.role); put('seamIn', canon(cut.seamIn));
    put('slots', slotsParts(cut.slots, keys, 'full'));
    put('t0', canon(cut.t0)); put('t1', canon(cut.t1)); put('text', t.text);
    parts.push(pending + '}');
    return { fp, parts };
  }

  // The canonical text of a slots map as parts: '{', '"arrange":', <decision>, ',', … '}'. keys = its sorted keys;
  // which = 'full' (the Plan) or 'scene' (the fingerprint).
  function slotsParts(slots, keys, which) {
    const parts = ['{'];
    for (let i = 0; i < keys.length; i++) {
      parts.push((i ? ',' : '') + quoteKey(keys[i]), decisionTexts(slots[keys[i]])[which]);
    }
    parts.push('}');
    return parts;
  }

  // --- the plan hash -------------------------------------------------------------------------------------------

  // The hash state after a cut's parts, remembered per parts array (a reused cut keeps its array): when the state
  // before it is the same as last time, the state after it is too, so re-planning feeds only the cuts from the first
  // changed one on. The parts are joined once into one flat text (hashing the pieces one by one gives the same
  // number), which the cuts after a changed one are fed again from.
  const after = new WeakMap();

  // planHash(plan, cutParts) → hashJSON(plan without hash) (§3.12), streamed: the top-level keys in sorted order, the
  // cuts part by part.
  function planHash(plan, cutParts) {
    let h = feed(FNV_BASIS, '{');
    let first = true;
    for (const k of Object.keys(plan).sort()) {
      if (k === 'hash') continue;
      if (k === 'cuts') {
        h = feed(h, (first ? '' : ',') + quoteKey(k) + '[');
        for (let i = 0; i < cutParts.length; i++) {
          const parts = cutParts[i];
          const before = i ? feed(h, ',') : h;
          let known = after.get(parts);
          if (known === undefined) { known = { before: 0, h: 0, text: parts.join('') }; after.set(parts, known); }
          else if (known.before === before) { h = known.h; continue; }
          h = feedText(before, known.text);
          known.before = before;
          known.h = h;
        }
        h = feed(h, ']');
      } else {
        const text = canon(plan[k]);
        if (text === undefined) continue;
        h = feed(h, (first ? '' : ',') + quoteKey(k) + text);
      }
      first = false;
    }
    return hex8(finish(endPart(feed(h, '}'))));
  }

  return {
    canon, asIs, objectCanon, decisionTexts, encodeCut, retimeCut, planHash, hex8, FNV_BASIS, feed, endPart, finish,
  };
});
