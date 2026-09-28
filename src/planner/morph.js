/* 文字PVメーカー v2 — original work. The letters two lines share: weighted runs and gap swaps for the glyph morph seam (DESIGN_2_2 §4, M4). */
MV.def('planner/morph', ['core/script'], (S) => {
  'use strict';

  // A letter unit: one grapheme of a class that can stand for itself (spaces, punctuation and symbols never match; they
  // melt with the rest). Its weight tells the matcher which letters are worth a match: a kanji, katakana, hangul or
  // emoji 3, a Latin letter or digit 2, a hiragana 1 — so a particle never takes the place of a kanji.
  const WEIGHTS = Object.freeze({ han: 3, kata: 3, hangul: 3, emoji: 3, latin: 2, digit: 2, fullLatin: 2, hira: 1, smallKana: 1 });
  const STRONG = new Set(['han', 'kata', 'hangul', 'emoji']);        // a single one of these is a run of its own
  const KANA = new Set(['hira', 'smallKana']);
  const MAX_UNITS = 64;          // only the first 64 units of each text take part (≤ 65 × 65 cells)
  const MAX_PAIRS = 64;
  const RUN_BONUS = 1;           // a match right after a match scores one more: runs beat scattered letters
  const CACHE_MAX = 256;

  // unitsOf(text) → { g: [grapheme], off: [UTF-16 offset in text], cls: [class], n }
  function unitsOf(text) {
    const s = String(text === undefined || text === null ? '' : text);
    const offs = S.graphemeOffsets(s);
    const g = [], off = [], cls = [];
    for (let k = 0; k + 1 < offs.length && g.length < MAX_UNITS; k++) {
      const ch = s.slice(offs[k], offs[k + 1]);
      const c = S.charClass(ch);
      if (WEIGHTS[c] === undefined) continue;
      g.push(ch); off.push(offs[k]); cls.push(c);
    }
    return { g, off, cls, n: g.length };
  }

  // Weighted LCS over two unit lists with a run bonus, two states per cell: E (the last units of both prefixes are
  // matched) and N (best of E, skip A's last unit, skip B's last unit — in this order on ties). Scores compare by
  // points, then by drift (the sum over matches of |i·m − j·n|: how far the match sits from the diagonal), so of two
  // equal answers the one closer to the lines' own order wins. → the matched pairs [[i, j], …] in reading order.
  function lcs(A, B) {
    const n = A.n, m = B.n, W = m + 1, size = (n + 1) * W;
    const sN = new Int32Array(size), dN = new Int32Array(size), sE = new Int32Array(size).fill(-1), dE = new Int32Array(size);
    const cN = new Uint8Array(size);          // N's choice: 0 = E (match), 1 = skip A, 2 = skip B
    const cE = new Uint8Array(size);          // E's choice: 0 = after N, 1 = after E (a run)
    for (let i = 1; i <= n; i++) {
      for (let j = 1; j <= m; j++) {
        const at = i * W + j, diag = (i - 1) * W + (j - 1);
        if (A.g[i - 1] === B.g[j - 1]) {
          const w = WEIGHTS[A.cls[i - 1]];
          const drift = Math.abs((i - 1) * m - (j - 1) * n);
          let s = sN[diag] + w, d = dN[diag] + drift, c = 0;
          if (sE[diag] >= 0) {
            const s2 = sE[diag] + w + RUN_BONUS, d2 = dE[diag] + drift;
            if (s2 > s || (s2 === s && d2 < d)) { s = s2; d = d2; c = 1; }
          }
          sE[at] = s; dE[at] = d; cE[at] = c;
        }
        let s = -1, d = 0, c = 0;
        if (sE[at] >= 0) { s = sE[at]; d = dE[at]; c = 0; }
        const up = (i - 1) * W + j, left = i * W + (j - 1);
        if (sN[up] > s || (sN[up] === s && dN[up] < d)) { s = sN[up]; d = dN[up]; c = 1; }
        if (sN[left] > s || (sN[left] === s && dN[left] < d)) { s = sN[left]; d = dN[left]; c = 2; }
        sN[at] = s; dN[at] = d; cN[at] = c;
      }
    }
    const out = [];
    let i = n, j = m, inE = false;
    while (i > 0 && j > 0) {
      const at = i * W + j;
      if (inE) {
        out.push([i - 1, j - 1]);
        inE = cE[at] === 1;
        i--; j--;
      } else if (cN[at] === 0) inE = true;
      else if (cN[at] === 1) i--;
      else j--;
    }
    return out.reverse();
  }

  // Runs: maximal sequences of matched pairs consecutive in both unit lists → [{ from, len }] over `pairs`.
  function runsOf(pairs) {
    const runs = [];
    for (let k = 0; k < pairs.length; k++) {
      const last = runs.length ? runs[runs.length - 1] : null;
      const prev = k > 0 ? pairs[k - 1] : null;
      if (last && prev[0] + 1 === pairs[k][0] && prev[1] + 1 === pairs[k][1]) last.len++;
      else runs.push({ from: k, len: 1 });
    }
    return runs;
  }

  // A run that means something: three letters or more, two with at least one that is not kana, or one strong letter.
  function keepRun(A, pairs, run) {
    if (run.len >= 3) return true;
    if (run.len === 2) return !KANA.has(A.cls[pairs[run.from][0]]) || !KANA.has(A.cls[pairs[run.from + 1][0]]);
    return STRONG.has(A.cls[pairs[run.from][0]]);
  }

  // Between two kept anchors (and before the first, after the last) the units of both lines pair up in reading order
  // when the gap is about the same size on both sides (max ≤ 2·min + 1): same = 1 for equal letters, else 0 (a swap).
  function swaps(A, B, anchors) {
    const out = [];
    const stops = [[-1, -1]].concat(anchors, [[A.n, B.n]]);
    for (let k = 0; k + 1 < stops.length; k++) {
      const [ia, ib] = stops[k], [ja, jb] = stops[k + 1];
      const p = ja - ia - 1, q = jb - ib - 1;
      if (p < 1 || q < 1 || Math.max(p, q) > 2 * Math.min(p, q) + 1) continue;
      for (let t = 0; t < Math.min(p, q); t++) {
        const x = ia + 1 + t, y = ib + 1 + t;
        out.push([A.off[x], B.off[y], A.g[x] === B.g[y] ? 1 : 0]);
      }
    }
    return out;
  }

  // The work for one pair of texts, shared by analyze and pairsOf.
  function core(textA, textB) {
    const A = unitsOf(textA), B = unitsOf(textB);
    const pairs = lcs(A, B);
    const anchors = [];
    let m = 0, longest = 0;
    for (const run of runsOf(pairs)) {
      if (!keepRun(A, pairs, run)) continue;
      for (let k = run.from; k < run.from + run.len; k++) anchors.push(pairs[k]);
      m += run.len;
      if (run.len > longest) longest = run.len;
    }
    const meaningful = m >= 2 && (longest >= 2 || m >= 0.4 * Math.min(A.n, B.n));
    return { A, B, anchors, analysis: Object.freeze({ m, longest, nA: A.n, nB: B.n, meaningful }), pairs: {} };
  }

  const cache = new Map();          // LRU: textA \0 textB → core
  function coreOf(textA, textB) {
    const key = String(textA) + '\u0000' + String(textB);
    let hit = cache.get(key);
    if (hit !== undefined) { cache.delete(key); cache.set(key, hit); return hit; }
    hit = core(textA, textB);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, hit);
    return hit;
  }

  // analyze(textA, textB) → frozen { m, longest, nA, nB, meaningful } over the kept anchors: m letters in kept runs,
  // the longest run, the unit counts; meaningful when m ≥ 2 and (a run of 2 or more, or m ≥ 0.4 of the shorter line).
  function analyze(textA, textB) { return coreOf(textA, textB).analysis; }

  // pairsOf(textA, textB, melt) → frozen [[aOff, bOff, same], …]: the kept anchors (same = 1) and, with melt 'swap' (the
  // default), the gap pairs; sorted by bOff, at most 64. The same frozen array for the same texts and melt.
  function pairsOf(textA, textB, melt) {
    const c = coreOf(textA, textB);
    const mode = melt === 'fade' ? 'fade' : 'swap';
    let out = c.pairs[mode];
    if (out) return out;
    const list = c.anchors.map(([i, j]) => [c.A.off[i], c.B.off[j], 1]);
    if (mode === 'swap') for (const s of swaps(c.A, c.B, c.anchors)) list.push(s);
    list.sort((x, y) => x[1] - y[1] || x[0] - y[0]);
    out = Object.freeze(list.slice(0, MAX_PAIRS).map((x) => Object.freeze(x)));
    c.pairs[mode] = out;
    return out;
  }

  return { unitsOf, lcs, runsOf, analyze, pairsOf, MAX_UNITS, MAX_PAIRS, WEIGHTS };
});
