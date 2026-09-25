/* 文字PVメーカー v2 — original work. Pin index, precedence lookup and cut-pin reattachment (DESIGN §3.5, §4.3, §4.10.4). */
MV.def('core/pins', ['core/paths'], (P) => {
  'use strict';

  // index(pins) → { work: Map<slot, pin>, line: Map<lineId, Map<slot, pin>>, cut: Map<cutKey, Map<slot, pin>>,
  //                 byLine: Map<lineId, pinCutKey[]> (sorted by offset), bad: string[] (paths that do not parse) }
  // Paths are visited in sorted order so every Map iterates deterministically.
  function index(pins) {
    const ix = { work: new Map(), line: new Map(), cut: new Map(), byLine: new Map(), bad: [] };
    for (const path of Object.keys(pins || {}).sort()) {
      let parsed;
      try { parsed = P.parse(path); } catch (e) { ix.bad.push(path); continue; }
      const { scope, slot } = parsed;
      if (scope.kind === 'work') ix.work.set(slot, pins[path]);
      else if (scope.kind === 'line') mapOf(ix.line, scope.id).set(slot, pins[path]);
      else addCutPin(ix, scope, slot, pins[path]);
    }
    for (const keys of ix.byLine.values()) keys.sort(byOffset);
    return ix;
  }

  function mapOf(outer, key) {
    let m = outer.get(key);
    if (!m) { m = new Map(); outer.set(key, m); }
    return m;
  }

  function addCutPin(ix, scope, slot, pin) {
    if (!ix.cut.has(scope.id) && scope.lineId !== null) {
      const keys = ix.byLine.get(scope.lineId);
      if (keys) keys.push(scope.id); else ix.byLine.set(scope.lineId, [scope.id]);
    }
    mapOf(ix.cut, scope.id).set(slot, pin);
  }

  function byOffset(a, b) {
    return P.cutOffset(a) - P.cutOffset(b) || (a < b ? -1 : a > b ? 1 : 0);
  }

  // The single implementation of the precedence table (§3.5): cut (via pinCutKey) > line > work.
  // at = { cutKey, pinCutKey, lineId }. pinCutKey undefined → cutKey is used; null → the cut has no attached pins.
  // lineId undefined → derived from cutKey. Returns the raw pin value (the caller coerces) or null.
  function lookup(ix, at, slot) {
    const where = at || {};
    const cutKey = where.cutKey || null;
    const pinCutKey = where.pinCutKey !== undefined ? where.pinCutKey : cutKey;
    const lineId = where.lineId !== undefined ? where.lineId : cutKey ? P.lineOfCut(cutKey) : null;
    if (pinCutKey) {
      const pin = get(ix.cut, pinCutKey, slot);
      if (pin) return hit(pin, 'pin:cut', 'cut/' + pinCutKey + ':' + slot);
    }
    if (lineId) {
      const pin = get(ix.line, lineId, slot);
      if (pin) return hit(pin, 'pin:line', 'line/' + lineId + ':' + slot);
    }
    const pin = ix.work.get(slot);
    return pin ? hit(pin, 'pin:work', 'work:' + slot) : null;
  }

  function get(outer, key, slot) {
    const m = outer.get(key);
    return m ? m.get(slot) : undefined;
  }

  // `at` is the path of the pin that won.
  function hit(pin, from, at) { return { v: pin.v, from, by: pin.by, at }; }

  // Reattaches a line's cut pins to its current cuts (§4.10.4). cuts = [{ key, a, b, text }] with a, b the piece's
  // character offsets. Returns { map: { [actualCutKey]: pinCutKey }, orphans, shadowed } (pin keys, sorted by offset).
  function attachCuts(ix, lineId, cuts) {
    const pending = new Set(ix.byLine.get(lineId) || []);
    const owner = new Array(cuts.length).fill(null);
    const shadowed = [];

    cuts.forEach((cut, i) => {
      if (pending.has(cut.key)) { owner[i] = cut.key; pending.delete(cut.key); }
    });
    settle(bySignature(ix, pending, cuts, owner), cuts, owner, pending, shadowed);
    settle(byContainment(pending, cuts, owner), cuts, owner, pending, shadowed);

    const map = {};
    cuts.forEach((cut, i) => { if (owner[i] !== null) map[cut.key] = owner[i]; });
    return { map, orphans: [...pending].sort(byOffset), shadowed: shadowed.sort(byOffset) };
  }

  // Step 2: a pin key whose pins carry a sig attaches when exactly one free cut has that text.
  function bySignature(ix, pending, cuts, owner) {
    const proposals = [];
    for (const key of pending) {
      const sigs = sigsOf(ix.cut.get(key));
      if (sigs.size === 0) continue;
      let match = -1, count = 0;
      cuts.forEach((cut, i) => {
        if (owner[i] === null && sigs.has(cut.text)) { match = i; count++; }
      });
      if (count === 1) proposals.push({ key, cut: match });
    }
    return proposals;
  }

  function sigsOf(slots) {
    const sigs = new Set();
    if (slots) for (const pin of slots.values()) if (pin && typeof pin.sig === 'string') sigs.add(pin.sig);
    return sigs;
  }

  // Step 3: a pin key whose offset lies in [a, b) of a free cut attaches there.
  function byContainment(pending, cuts, owner) {
    const proposals = [];
    for (const key of pending) {
      const off = P.cutOffset(key);
      const i = cuts.findIndex((cut, j) => owner[j] === null && off >= cut.a && off < cut.b);
      if (i >= 0) proposals.push({ key, cut: i });
    }
    return proposals;
  }

  // Step 4: per cut, the proposal whose offset is closest to the cut's `a` wins (ties: smaller offset);
  // the other proposals for that cut are shadowed.
  function settle(proposals, cuts, owner, pending, shadowed) {
    const byCut = new Map();
    for (const p of proposals) {
      const list = byCut.get(p.cut);
      if (list) list.push(p.key); else byCut.set(p.cut, [p.key]);
    }
    for (const [i, keys] of byCut) {
      const a = cuts[i].a;
      keys.sort((x, y) => Math.abs(P.cutOffset(x) - a) - Math.abs(P.cutOffset(y) - a) || byOffset(x, y));
      owner[i] = keys[0];
      for (const key of keys) pending.delete(key);
      shadowed.push(...keys.slice(1));
    }
  }

  // Every pin path under a scope ('work', 'line/<id>' includes that line's cuts, 'cut/<key>'), sorted.
  function pinsUnder(pins, scope) {
    return Object.keys(pins || {}).filter((path) => {
      try { return P.isUnder(path, scope); } catch (e) { return false; }
    }).sort();
  }

  return { index, lookup, attachCuts, pinsUnder };
});
