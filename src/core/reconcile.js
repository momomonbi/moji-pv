/* 文字PVメーカー v2 — original work. Stable row ids, offset maps and remapping of per-line data (DESIGN §4.10). */
MV.def('core/reconcile', ['core/lyrics', 'core/script', 'core/paths'], (L, S, P) => {
  'use strict';

  const DICE_MIN = 0.5;
  const UPPER_LATIN = /[A-ZÀ-ÖØ-ÞĀ-ɏḀ-ỿ]/g;
  const LINE_CUT = /^(r[0-9a-z]+(?:\.[1-9][0-9]*)?)~([0-9]+)$/;
  const LINE_BREAK = /\r\n|\r|\n/;
  // Bigram codes: code points and the two edge marks of a padded key ('^' + key + '$') in base 0x110002.
  const EDGE_START = 0x110000, EDGE_END = 0x110001, GRAM_BASE = 0x110002;

  // ---- LCS (Myers O(ND), linear space) -------------------------------------------------------------------------

  // Matched positions of a longest common subsequence of two integer arrays, flat [i0, j0, i1, j1, …] in increasing
  // order. The common prefix and suffix are matched first, so a local edit costs little, and values that occur on
  // only one side are dropped before the search (they can never match), so replacing everything is cheap too.
  function lcsFlat(a, b) {
    let lo = 0;
    while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
    let ea = a.length, eb = b.length;
    while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) { ea--; eb--; }
    const out = [];
    for (let i = 0; i < lo; i++) out.push(i, i);
    if (ea > lo && eb > lo) {
      const ia = shared(a, lo, ea, b, lo, eb), ib = shared(b, lo, eb, a, lo, ea);
      const fa = Int32Array.from(ia, (i) => a[i]), fb = Int32Array.from(ib, (j) => b[j]);
      const size = 2 * (Math.ceil((fa.length + fb.length) / 2) + 2);
      const mid = [];
      lcsInto(fa, 0, fa.length, fb, 0, fb.length, new Int32Array(size), new Int32Array(size), mid);
      for (let k = 0; k < mid.length; k += 2) out.push(ia[mid[k]], ib[mid[k + 1]]);
    }
    for (let i = ea, j = eb; i < a.length; i++, j++) out.push(i, j);
    return out;
  }

  // Indices in x[x0..x1) whose value also occurs in y[y0..y1).
  function shared(x, x0, x1, y, y0, y1) {
    const values = new Set();
    for (let j = y0; j < y1; j++) values.add(y[j]);
    const out = [];
    for (let i = x0; i < x1; i++) if (values.has(x[i])) out.push(i);
    return out;
  }

  // LCS of a[a0..a1) and b[b0..b1) into out (absolute indices, increasing): strip the common ends, find the middle
  // snake, recurse on both sides. fw / bw are scratch diagonal arrays shared by the whole recursion.
  function lcsInto(a, a0, a1, b, b0, b1, fw, bw, out) {
    while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) { out.push(a0++, b0++); }
    let tail = 0;
    while (a1 > a0 && b1 > b0 && a[a1 - 1] === b[b1 - 1]) { a1--; b1--; tail++; }
    if (a1 > a0 && b1 > b0) {
      // Both ends differ here, so at least two edits are needed and each half below needs fewer.
      const s = middleSnake(a, a0, a1 - a0, b, b0, b1 - b0, fw, bw);
      lcsInto(a, a0, a0 + s.x, b, b0, b0 + s.y, fw, bw, out);
      for (let x = s.x, y = s.y; x < s.u; x++, y++) out.push(a0 + x, b0 + y);
      lcsInto(a, a0 + s.u, a1, b, b0 + s.v, b1, fw, bw, out);
    }
    for (let k = 0; k < tail; k++) out.push(a1 + k, b1 + k);
  }

  // Myers' middle snake of a[a0..a0+n) and b[b0..b0+m): the diagonal run { x, y } → { u, v } (relative offsets) that
  // an optimal edit path crosses halfway. fw[k] / bw[c] hold the furthest x reached on forward diagonal k = x − y and
  // on reverse diagonal c (counted from the ends); forward k and reverse c meet when c = (n − m) − k.
  function middleSnake(a, a0, n, b, b0, m, fw, bw) {
    const delta = n - m, odd = (delta & 1) !== 0;
    const half = Math.ceil((n + m) / 2), off = half + 1;
    fw[off + 1] = 0;
    bw[off + 1] = 0;
    for (let d = 0; d <= half; d++) {
      for (let k = -d; k <= d; k += 2) {
        let x = k === -d || (k !== d && fw[off + k - 1] < fw[off + k + 1]) ? fw[off + k + 1] : fw[off + k - 1] + 1;
        let y = x - k;
        const x0 = x, y0 = y;
        while (x < n && y < m && a[a0 + x] === b[b0 + y]) { x++; y++; }
        fw[off + k] = x;
        const c = delta - k;
        if (odd && c >= 1 - d && c <= d - 1 && x + bw[off + c] >= n) return { x: x0, y: y0, u: x, v: y };
      }
      for (let c = -d; c <= d; c += 2) {
        let x = c === -d || (c !== d && bw[off + c - 1] < bw[off + c + 1]) ? bw[off + c + 1] : bw[off + c - 1] + 1;
        let y = x - c;
        const x0 = x, y0 = y;
        while (x < n && y < m && a[a0 + n - 1 - x] === b[b0 + m - 1 - y]) { x++; y++; }
        bw[off + c] = x;
        const k = delta - c;
        if (!odd && k >= -d && k <= d && x + fw[off + k] >= n) return { x: n - x, y: m - y, u: n - x0, v: m - y0 };
      }
    }
    throw new Error('reconcile: no middle snake');          // unreachable: the paths meet by d = ⌈(n + m) / 2⌉
  }

  // Matched index pairs [[i, j], …] of a longest common subsequence of two integer arrays, in increasing order.
  function lcsPairs(a, b) {
    const flat = lcsFlat(a, b);
    const out = [];
    for (let k = 0; k < flat.length; k += 2) out.push([flat[k], flat[k + 1]]);
    return out;
  }

  // ---- row keys ------------------------------------------------------------------------------------------------

  // Normalized text for matching rows: whitespace removed, NFKC, Latin lower-cased.
  function normalizeKey(text) {
    return text.normalize('NFKC').replace(/\s+/g, '').replace(UPPER_LATIN, (c) => c.toLowerCase());
  }

  // key(src) of §4.10.1 plus what the remapping needs: the plain text and the number of sung occurrences.
  function describe(src) {
    const row = L.parseRow(src);
    let key = '';
    if (row.kind === 'comment') key = '#' + (row.heading || '');
    else if (row.kind === 'meta') key = '@' + row.tag;
    else if (row.kind === 'lyric') key = normalizeKey(row.text);
    const lines = row.kind === 'lyric' && row.text !== '' ? Math.max(1, row.stamps.length) : 0;
    return { key, text: row.text, lines, grams: null };
  }

  // rows → Map<rowId, { text, lines }> (lines = sung occurrences; 0 when the row is not a line).
  function rowInfo(rows) {
    const out = new Map();
    for (const r of rows) {
      const d = describe(r.src);
      out.set(r.id, { text: d.text, lines: d.lines });
    }
    return out;
  }

  // Interns string keys as small integers (< keysA.length + keysB.length) so the LCS compares numbers.
  function intern(keysA, keysB) {
    const ids = new Map();
    const conv = (k) => {
      let id = ids.get(k);
      if (id === undefined) { id = ids.size; ids.set(k, id); }
      return id;
    };
    return [Int32Array.from(keysA, conv), Int32Array.from(keysB, conv)];
  }

  // ---- bigram Dice ---------------------------------------------------------------------------------------------

  // Sorted character bigrams of the padded key '^' + key + '$' (code points), as numbers. The edge marks let a short
  // key keep enough bigrams: one changed character of a 3-character key still leaves Dice ≥ 0.5.
  function bigrams(key) {
    const cps = [EDGE_START];
    for (const ch of key) cps.push(ch.codePointAt(0));
    cps.push(EDGE_END);
    const out = new Float64Array(cps.length - 1);
    for (let i = 0; i + 1 < cps.length; i++) out[i] = cps[i] * GRAM_BASE + cps[i + 1];
    return out.sort();
  }

  function gramsOf(d) {
    if (!d.grams) d.grams = bigrams(d.key);
    return d.grams;
  }

  // Calls fn(gram, count) for each distinct bigram of a sorted list.
  function eachRun(grams, fn) {
    for (let i = 0; i < grams.length;) {
      let j = i + 1;
      while (j < grams.length && grams[j] === grams[i]) j++;
      fn(grams[i], j - i);
      i = j;
    }
  }

  // Dice 2·|A∩B| / (|A| + |B|) over bigram multisets for every old/new pair of a gap that shares a bigram (an
  // inverted index, so unrelated rows cost nothing). Returns flat [p, q, score, …] for scores ≥ 0.5, where p and q
  // are positions in `olds` and `news`.
  function diceCandidates(oldD, newD, olds, news) {
    const index = new Map();                                  // bigram → [p, count, p, count, …]
    olds.forEach((i, p) => eachRun(gramsOf(oldD[i]), (g, c) => {
      const list = index.get(g);
      if (list) list.push(p, c); else index.set(g, [p, c]);
    }));
    const common = new Int32Array(olds.length);
    const touched = [], out = [];
    news.forEach((j, q) => {
      const gb = gramsOf(newD[j]);
      eachRun(gb, (g, c) => {
        const list = index.get(g);
        if (!list) return;
        for (let t = 0; t < list.length; t += 2) {
          if (common[list[t]] === 0) touched.push(list[t]);
          common[list[t]] += Math.min(c, list[t + 1]);
        }
      });
      for (const p of touched) {
        const s = (2 * common[p]) / (gramsOf(oldD[olds[p]]).length + gb.length);
        if (s >= DICE_MIN) out.push(p, q, s);
        common[p] = 0;
      }
      touched.length = 0;
    });
    return out;
  }

  // Order-preserving pairing that maximizes the total score over the candidates (flat [p, q, score, …]). Rows without
  // a candidate cannot pair, so the DP runs only over rows that have one. Ties prefer pairing, then skipping the old
  // row. Calls pair(olds[p], news[q]) for each accepted pair.
  function alignCandidates(cand, olds, news, pair) {
    const ps = distinctSorted(cand, 0), qs = distinctSorted(cand, 1);
    const pAt = new Map(ps.map((p, x) => [p, x])), qAt = new Map(qs.map((q, x) => [q, x]));
    const m = ps.length, n = qs.length, w = n + 1;
    const score = new Float64Array(m * n).fill(-1);
    for (let k = 0; k < cand.length; k += 3) score[pAt.get(cand[k]) * n + qAt.get(cand[k + 1])] = cand[k + 2];
    const best = new Float64Array((m + 1) * w);
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        const s = score[i * n + j];
        const take = s >= 0 ? s + best[(i + 1) * w + j + 1] : -1;
        best[i * w + j] = Math.max(take, best[(i + 1) * w + j], best[i * w + j + 1]);
      }
    }
    for (let i = 0, j = 0; i < m && j < n;) {
      const s = score[i * n + j];
      const here = best[i * w + j];
      if (s >= 0 && s + best[(i + 1) * w + j + 1] === here) {
        pair(olds[ps[i]], news[qs[j]]);
        i++;
        j++;
      } else if (best[(i + 1) * w + j] === here) i++;
      else j++;
    }
  }

  function distinctSorted(cand, at) {
    const set = new Set();
    for (let k = at; k < cand.length; k += 3) set.add(cand[k]);
    return [...set].sort((x, y) => x - y);
  }

  // ---- reconcile -----------------------------------------------------------------------------------------------

  // Lyric box text → rows. CR LF, a lone CR and LF all end a row (a row's src is always one line); the empty text
  // has no rows.
  function splitRows(text) {
    if (text === '') return [];
    return text.split(LINE_BREAK);
  }

  // Stable row ids for a new lyric text (§4.10.1). Returns { rows, next, same, edited, removed, added } and,
  // additively, `info: { before, after }` (Map<rowId, { text, lines }> of the old and new rows) for the remapping.
  function reconcile(oldRows, newText, next) {
    const srcs = splitRows(String(newText));
    const oldD = oldRows.map((r) => describe(r.src));
    const newD = srcs.map(describe);
    const owner = new Int32Array(srcs.length).fill(-1);      // new index → old index
    const taken = new Uint8Array(oldRows.length);
    const pair = (i, j) => { owner[j] = i; taken[i] = 1; };

    const [ka, kb] = intern(oldD.map((d) => d.key), newD.map((d) => d.key));
    const anchors = lcsPairs(ka, kb);
    anchors.forEach(([i, j]) => pair(i, j));
    const moves = uniqueMoves(ka, kb, owner, taken);
    pairGaps(anchors, oldD, newD, moves, pair);
    moves.forEach(([i, j]) => pair(i, j));
    return assemble(oldRows, srcs, oldD, newD, owner, taken, next);
  }

  // Rule 4 pairs: a new row whose key is unique among the new rows, left unpaired by the LCS, and an unpaired old row
  // with the same key, unique among the old rows. They are found before rule 3 and kept out of its gaps: otherwise a
  // swapped row would be paired by similarity with a look-alike row in its gap, and its id (with its pins) would
  // stay with the position instead of following the text.
  function uniqueMoves(ka, kb, owner, taken) {
    const size = ka.length + kb.length;
    const oldCount = new Int32Array(size), newCount = new Int32Array(size), oldAt = new Int32Array(size);
    ka.forEach((k, i) => { oldCount[k]++; oldAt[k] = i; });
    kb.forEach((k) => { newCount[k]++; });
    const moves = [];
    kb.forEach((k, j) => {
      if (owner[j] < 0 && newCount[k] === 1 && oldCount[k] === 1 && !taken[oldAt[k]]) moves.push([oldAt[k], j]);
    });
    return moves;
  }

  // Rule 3 in each gap between consecutive anchors, over the rows that rule 4 does not claim. A gap with exactly one
  // old and one new row pairs them whatever their similarity: that row was edited in place (a short row can lose
  // half its bigrams to a single keystroke).
  function pairGaps(anchors, oldD, newD, moves, pair) {
    const heldOld = new Set(moves.map((mv) => mv[0])), heldNew = new Set(moves.map((mv) => mv[1]));
    let pi = 0, pj = 0;
    for (const [i, j] of anchors.concat([[oldD.length, newD.length]])) {
      const olds = freeIn(pi, i, heldOld), news = freeIn(pj, j, heldNew);
      if (olds.length === 1 && news.length === 1) pair(olds[0], news[0]);
      else if (olds.length && news.length) {
        const cand = diceCandidates(oldD, newD, olds, news);
        if (cand.length) alignCandidates(cand, olds, news, pair);
      }
      pi = i + 1;
      pj = j + 1;
    }
  }

  function freeIn(from, to, held) {
    const out = [];
    for (let k = from; k < to; k++) if (!held.has(k)) out.push(k);
    return out;
  }

  function assemble(oldRows, srcs, oldD, newD, owner, taken, next) {
    let counter = next;
    const rows = [], same = new Map(), edited = new Set(), added = [];
    const before = new Map(), after = new Map();
    oldRows.forEach((r, i) => before.set(r.id, { text: oldD[i].text, lines: oldD[i].lines }));
    srcs.forEach((src, j) => {
      const i = owner[j];
      let row;
      if (i >= 0) {
        const old = oldRows[i];
        row = old.src === src ? old : { id: old.id, src };
        same.set(old.id, old.id);
        if (oldD[i].text !== newD[j].text) edited.add(old.id);
      } else {
        row = { id: 'r' + (counter++).toString(36), src };
        added.push(row.id);
      }
      rows.push(row);
      after.set(row.id, { text: newD[j].text, lines: newD[j].lines });
    });
    const removed = oldRows.filter((r, i) => !taken[i]).map((r) => r.id);
    return { rows, next: counter, same, edited, removed, added, info: { before, after } };
  }

  // ---- offset maps ---------------------------------------------------------------------------------------------

  // Int32Array m with m[offset] = new offset for every offset 0..oldText.length (§4.10.2).
  function offsetTable(oldText, newText) {
    const keptAt = new Int32Array(oldText.length).fill(-1);
    const kept = lcsFlat(units(oldText), units(newText));
    for (let k = 0; k < kept.length; k += 2) keptAt[kept[k]] = kept[k + 1];
    const out = new Int32Array(oldText.length + 1);
    let nextKept = newText.length;
    out[oldText.length] = nextKept;
    for (let i = oldText.length - 1; i >= 0; i--) {
      if (keptAt[i] >= 0) nextKept = keptAt[i];
      out[i] = nextKept;
    }
    out[0] = 0;
    const offs = S.graphemeOffsets(newText);
    for (let i = 0; i <= oldText.length; i++) out[i] = S.snapToBoundary(offs, out[i]);
    return out;
  }

  function units(text) {
    const u = new Int32Array(text.length);
    for (let i = 0; i < text.length; i++) u[i] = text.charCodeAt(i);
    return u;
  }

  // offsetMap(oldText, newText) → (offset) => newOffset: character-level LCS; kept characters keep their place,
  // deleted ones go to the next kept character; old length → new length; 0 → 0; snapped to a grapheme start.
  function offsetMap(oldText, newText) {
    const table = offsetTable(String(oldText), String(newText));
    const last = table.length - 1;
    return (offset) => table[Math.min(Math.max(0, Math.trunc(offset)), last)];
  }

  // ---- remapping pins, salts and locks (§4.10.3) ---------------------------------------------------------------

  // Line id of a key's scope and, for a line cut, its offset. Keys are pin paths or salt keys (a bare scope or
  // scope ':' slot). Returns null for keys that belong to no line (work scope, title, intro, outro, bad keys).
  function lineOfKey(key) {
    const colon = key.indexOf(':');
    const scope = colon < 0 ? key : key.slice(0, colon);
    if (scope.startsWith('line/')) {
      const line = scope.slice(5);
      return P.isLineId(line) ? { line, off: null, gap: false } : null;
    }
    if (!scope.startsWith('cut/')) return null;
    const cut = scope.slice(4);
    const m = LINE_CUT.exec(cut);
    if (m) return { line: m[1], off: Number(m[2]), gap: false };
    if (cut.startsWith('gap/') && P.isLineId(cut.slice(4))) return { line: cut.slice(4), off: null, gap: true };
    return null;
  }

  function rowOfLine(lineId) {
    const dot = lineId.indexOf('.');
    return { row: dot < 0 ? lineId : lineId.slice(0, dot), occ: dot < 0 ? 0 : Number(lineId.slice(dot + 1)) };
  }

  // A line existed before the edit and does not exist after it (row removed, not a line any more, or stamp gone).
  function vanished(lineId, before, after) {
    const { row, occ } = rowOfLine(lineId);
    const b = before.get(row);
    if (!b || occ >= b.lines) return false;                  // not a line before: not ours to delete
    const a = after.get(row);
    return !a || occ >= a.lines;
  }

  // Applies §4.10.3 to { pins, salts, locks } after the rows changed. before/after: Map<rowId, { text, lines }>;
  // edited: Set<rowId> whose plain text changed. Unchanged maps are returned as the same objects.
  function remapKeyed(keyed, before, after, edited) {
    const tables = new Map();
    const tableOf = (row) => {
      if (!tables.has(row)) tables.set(row, offsetTable(before.get(row).text, after.get(row).text));
      return tables.get(row);
    };
    const ctx = { before, after, edited, tableOf };
    const pins = remapMap(keyed.pins || {}, ctx, true);
    const salts = remapMap(keyed.salts || {}, ctx, false);
    const locks = dropLocks(keyed.locks || {}, ctx);
    return { pins, salts, locks };
  }

  function remapMap(map, ctx, isPins) {
    const moves = [];
    let changed = false;
    for (const key of Object.keys(map)) {
      const at = lineOfKey(key);
      if (!at) { moves.push({ key, to: key, off: -1, value: map[key] }); continue; }
      if (vanished(at.line, ctx.before, ctx.after)) { changed = true; continue; }
      const row = rowOfLine(at.line).row;
      const isEdited = ctx.edited.has(row) && ctx.after.has(row) && ctx.after.get(row).lines > 0;
      let to = key, value = map[key];
      if (isEdited && at.off !== null) to = rekey(key, at, ctx.tableOf(row));
      if (isEdited && isPins && at.off === null && !at.gap && key.endsWith(':split')) {
        value = remapSplit(value, ctx.tableOf(row), ctx.after.get(row).text.length);
        if (value === null) { changed = true; continue; }
      }
      if (to !== key || value !== map[key]) changed = true;
      moves.push({ key, to, off: at.off === null ? -1 : at.off, value });
    }
    if (!changed) return map;
    // Collisions: the key with the smaller original offset wins.
    moves.sort((x, y) => x.off - y.off);
    const out = {};
    for (const mv of moves) if (!(mv.to in out)) out[mv.to] = mv.value;
    return sortedKeys(out, map);
  }

  // Rewrites the offset of a 'cut/<line>~<off>…' key; an offset beyond the old text (already an orphan) is kept.
  function rekey(key, at, table) {
    if (at.off >= table.length) return key;
    const off = table[at.off];
    if (off === at.off) return key;
    const prefix = 'cut/' + at.line + '~';
    return prefix + off + key.slice(prefix.length + String(at.off).length);
  }

  // Maps a split pin through the offset table; null when it no longer describes pieces of the new text.
  function remapSplit(pin, table, newLength) {
    if (!pin || !Array.isArray(pin.v)) return pin;
    const v = pin.v;
    if (!v.every((x) => Number.isInteger(x) && x >= 0)) return pin;
    const out = [];
    for (const x of v) {
      const y = table[Math.min(x, table.length - 1)];
      if ((y === 0 || y < newLength) && (out.length === 0 || y > out[out.length - 1])) out.push(y);
    }
    if (out.length === 0 || out[0] !== 0) return null;
    if (out.length === v.length && out.every((x, i) => x === v[i])) return pin;
    return Object.assign({}, pin, { v: out });
  }

  function dropLocks(locks, ctx) {
    let out = locks;
    for (const id of Object.keys(locks)) {
      if (P.isLineId(id) && vanished(id, ctx.before, ctx.after)) {
        if (out === locks) out = Object.assign({}, locks);
        delete out[id];
      }
    }
    return out;
  }

  // Keeps the original key order where keys survive (tidier diffs); new keys follow in sorted order.
  function sortedKeys(out, original) {
    const res = {};
    for (const k of Object.keys(original)) if (k in out) res[k] = out[k];
    for (const k of Object.keys(out).sort()) if (!(k in res)) res[k] = out[k];
    return res;
  }

  return { reconcile, offsetMap, remapKeyed, rowInfo, lcsPairs, splitRows, rowKey: (src) => describe(src).key };
});
