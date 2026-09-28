/* 文字PVメーカー v2 — original work. Stagger: ranking motion units by order, sung timing, and unit pivots (DESIGN §4.17.4). */
MV.def('engine/scene/stagger', ['core/rng', 'core/script', 'core/schema'], (RNG, S, SCH) => {
  'use strict';

  const ORDERS = SCH.ORDERS;
  const UNITS = Object.freeze(['glyph', 'word', 'line', 'run']);

  class StaggerError extends Error {
    constructor(code, message) { super(message); this.name = 'StaggerError'; this.code = code; }
  }

  function glyphCount(target) { return Math.max(0, target.to - target.from); }

  // unitIndex(target, unit) → per glyph (0 … n−1) the index of its unit; units are numbered in reading order.
  function unitIndex(target, unit) {
    const n = glyphCount(target);
    if (unit === undefined || unit === 'glyph') {
      const out = new Int32Array(n);
      for (let j = 0; j < n; j++) out[j] = j;
      return out;
    }
    const src = target.unitOf && target.unitOf[unit];
    if (!src) throw new StaggerError('bad-unit', 'unknown motion unit ' + JSON.stringify(unit));
    return Int32Array.from(src.subarray ? src.subarray(0, n) : src.slice(0, n));
  }

  function unitCountOf(idx) {
    let max = -1;
    for (let j = 0; j < idx.length; j++) if (idx[j] > max) max = idx[j];
    return max + 1;
  }

  // Centres of each unit's cells: 'local' in the glyphs' own frame (for pivots), 'world' at rest in frame du.
  function unitCentres(target, idx, count, space) {
    const x0 = new Float64Array(count).fill(Infinity), y0 = new Float64Array(count).fill(Infinity);
    const x1 = new Float64Array(count).fill(-Infinity), y1 = new Float64Array(count).fill(-Infinity);
    const X = space === 'world' ? target.wx : target.x, Y = space === 'world' ? target.wy : target.y;
    for (let j = 0; j < idx.length; j++) {
      const u = idx[j], hw = target.w[j] / 2, hh = target.h[j] / 2;
      if (X[j] - hw < x0[u]) x0[u] = X[j] - hw;
      if (Y[j] - hh < y0[u]) y0[u] = Y[j] - hh;
      if (X[j] + hw > x1[u]) x1[u] = X[j] + hw;
      if (Y[j] + hh > y1[u]) y1[u] = Y[j] + hh;
    }
    const cx = new Float64Array(count), cy = new Float64Array(count);
    for (let u = 0; u < count; u++) {
      cx[u] = x0[u] <= x1[u] ? (x0[u] + x1[u]) / 2 : 0;
      cy[u] = y0[u] <= y1[u] ? (y0[u] + y1[u]) / 2 : 0;
    }
    return { cx, cy };
  }

  // Dense ranks of numeric keys (equal keys share a rank; smaller keys come first).
  function denseRanks(keys) {
    const uniq = [...new Set(Array.from(keys))].sort((a, b) => a - b);
    const pos = new Map(uniq.map((k, i) => [k, i]));
    return Array.from(keys, (k) => pos.get(k));
  }

  function firstGlyphOf(idx, count) {
    const first = new Int32Array(count).fill(-1);
    for (let j = 0; j < idx.length; j++) if (first[idx[j]] < 0) first[idx[j]] = j;
    return first;
  }

  // Rank per unit for an order (§4.17.4). 'sung' ranks like 'lead'; its delays come from sungFractions.
  function unitRanks(env, target, order, idx, count) {
    const all = [...Array(count).keys()];
    const mid = (count - 1) / 2;
    switch (order) {
      case 'tail': return all.map((u) => count - 1 - u);
      case 'core': return all.map((u) => Math.floor(Math.abs(u - mid)));
      case 'rim': { const top = Math.floor(mid); return all.map((u) => top - Math.floor(Math.abs(u - mid))); }
      case 'scatter': {
        const seq = RNG.stream(seedOf(env), 'order').shuffle(all);
        const rank = new Array(count);
        seq.forEach((u, k) => { rank[u] = k; });
        return rank;
      }
      case 'word': case 'line': {
        const first = firstGlyphOf(idx, count);
        const by = target.unitOf[order];
        return denseRanks(all.map((u) => by[first[u]]));
      }
      case 'sweepX': case 'sweepY': case 'radial': return spatialRanks(target, order, idx, count);
      case 'emphFirst': {
        const has = new Uint8Array(count);
        for (let j = 0; j < idx.length; j++) if (target.emph[j]) has[idx[j]] = 1;
        const seq = all.filter((u) => has[u]).concat(all.filter((u) => !has[u]));
        const rank = new Array(count);
        seq.forEach((u, k) => { rank[u] = k; });
        return rank;
      }
      default: return all;            // 'lead', 'sung' and anything unknown: reading order
    }
  }

  // sweepX / sweepY rank by the rounded position along their axis and break ties along the other one (top to bottom,
  // left to right), so the glyphs of a vertical column (sweepX) or of a line (sweepY) still sweep one by one instead of
  // leaving together; radial ranks by the rounded distance from the focus centre.
  function spatialRanks(target, order, idx, count) {
    const { cx, cy } = unitCentres(target, idx, count, 'world');
    if (order === 'sweepX' || order === 'sweepY') {
      const along = order === 'sweepX' ? cx : cy, across = order === 'sweepX' ? cy : cx;
      const seq = [...Array(count).keys()].sort((a, b) => Math.round(along[a]) - Math.round(along[b])
        || Math.round(across[a]) - Math.round(across[b]) || a - b);
      const rank = new Array(count);
      let r = -1;
      seq.forEach((u, k) => {
        const p = seq[k - 1];
        const same = k > 0 && Math.round(along[u]) === Math.round(along[p]) && Math.round(across[u]) === Math.round(across[p]);
        if (!same) r++;
        rank[u] = r;
      });
      return rank;
    }
    const f = target.focus || { x: 0, y: 0, w: 0, h: 0 };
    const fx = f.x + f.w / 2, fy = f.y + f.h / 2;
    const keys = [];
    for (let u = 0; u < count; u++) keys.push(Math.round(Math.hypot(cx[u] - fx, cy[u] - fy)));
    return denseRanks(keys);
  }

  function seedOf(env) { return env && Number.isFinite(env.seed) ? env.seed : 0; }

  // ranksOf(env, target, order, unit) → { rank: Float32Array per glyph, count: distinct ranks, unit: Int32Array per glyph,
  // units: number of units }. Every glyph of a unit shares the unit's rank.
  function ranksOf(env, target, order, unit) {
    const idx = unitIndex(target, unit);
    const units = unitCountOf(idx);
    const perUnit = unitRanks(env, target, ORDERS.includes(order) ? order : 'lead', idx, units);
    const rank = new Float32Array(idx.length);
    let count = 0;
    for (let j = 0; j < idx.length; j++) {
      rank[j] = perUnit[idx[j]];
      if (rank[j] + 1 > count) count = rank[j] + 1;
    }
    return { rank, count, unit: idx, units };
  }

  // sungFractions(env, target, unit) → per glyph: the share of the cut's morae sung before its unit starts.
  function sungFractions(env, target, unit) {
    const idx = unitIndex(target, unit);
    const count = unitCountOf(idx);
    const text = new Array(count).fill('');
    for (let j = 0; j < idx.length; j++) text[idx[j]] += target.ch[j];
    const lang = target.lang || (env && env.cut && env.cut.lang) || 'ja';
    const mor = text.map((s) => S.morae(s, lang));
    const total = mor.reduce((a, b) => a + b, 0);
    const before = new Float64Array(count);
    let acc = 0;
    for (let u = 0; u < count; u++) { before[u] = total > 0 ? acc / total : (count > 0 ? u / count : 0); acc += mor[u]; }
    const out = new Float32Array(idx.length);
    for (let j = 0; j < idx.length; j++) out[j] = before[idx[j]];
    return out;
  }

  // staggerOf(env, target, order, each, unit) → Float32Array of per-glyph delays (s): rank · each, or for 'sung' the
  // sung time of the unit, (morae before it / all morae) · (t1 − t0) of the cut. Callers fit `each` first (§4.7).
  function staggerOf(env, target, order, each, unit) {
    if (order === 'sung') {
      const span = env && env.cut ? Math.max(0, env.cut.t1 - env.cut.t0) : 0;
      const frac = sungFractions(env, target, unit);
      for (let j = 0; j < frac.length; j++) frac[j] *= span;
      return frac;
    }
    const { rank } = ranksOf(env, target, order, unit);
    const e = Number.isFinite(each) && each > 0 ? each : 0;
    for (let j = 0; j < rank.length; j++) rank[j] *= e;
    return rank;
  }

  // --- sub-line sung timing (歌ハメ, DESIGN_2_2 §6) ---------------------------------------------------------------

  // A 歌ハメ glyph lands on its sung time (0 s ahead): P5's 出そろい leaves sung-order cuts alone.
  const SUNG_AHEAD = 0;
  const LETTER_STEP = 0.06, LETTER_SHARE = 0.8;

  // sungTimeAt(sung, off) → cut-local seconds of the sung unit that starts at or before text offset `off` (the first
  // unit's time before it). sung = cut.sung { at, t, end }.
  function sungTimeAt(sung, off) {
    const at = sung.at;
    if (!at.length) return 0;
    let lo = 0, hi = at.length - 1;
    if (off < at[0]) return sung.t[0];
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (at[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return sung.t[lo];
  }

  function unitIndexAt(at, off) {
    let lo = 0, hi = at.length - 1;
    if (hi < 0 || off < at[0]) return 0;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (at[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  function isLetterCls(c) { return c === 'latin' || c === 'fullLatin'; }

  // sungTimes(env, target, unit) → Float64Array per glyph: when it is sung (cut-local seconds from t0), or null when the
  // cut has no sung units (env.cut.sung). A glyph takes its sung unit's time (target.off = its offset in cut.text; a run
  // that shows its own text, off < 0, is sung at 0). The k ≥ 2 letters of a Latin word spread over its start:
  // letter i at t_u + (i / k) · min(0.8 · (t_next − t_u), 0.06 · k) (t_next = the cut's sung end after its last unit).
  // For a motion unit other than 'glyph', every glyph of a word, line or run takes the earliest time in it.
  function sungTimes(env, target, unit) {
    const sung = env && env.cut ? env.cut.sung : null;
    if (!sung || !sung.at || !sung.at.length || !target || !target.off) return null;
    const n = glyphCount(target);
    const out = new Float64Array(n);
    const at = sung.at, t = sung.t, m = at.length;
    // the glyphs of each unit that are letters (for the Latin spread): count per unit, then index in reading order
    const unitOf = new Int32Array(n).fill(-1);
    const letters = new Int32Array(m);
    for (let j = 0; j < n; j++) {
      const off = target.off[j];
      if (off < 0) continue;
      const u = unitIndexAt(at, off);
      unitOf[j] = u;
      if (isLetterCls(target.cls[j])) letters[u]++;
    }
    const seen = new Int32Array(m);
    for (let j = 0; j < n; j++) {
      const u = unitOf[j];
      if (u < 0) { out[j] = 0; continue; }
      const tu = t[u], k = letters[u];
      if (k < 2) { out[j] = tu; continue; }
      // a Latin word: its letters one after another; a glyph before them (an opening quote) with the first, one after
      // them (a comma, a space) with the last
      const next = u + 1 < m ? t[u + 1] : sung.end;
      const step = Math.min(LETTER_SHARE * Math.max(0, next - tu), LETTER_STEP * k) / k;
      let i;
      if (isLetterCls(target.cls[j])) { i = Math.min(seen[u], k - 1); seen[u]++; } else i = Math.max(0, seen[u] - 1);
      out[j] = tu + i * step;
    }
    if (unit !== undefined && unit !== 'glyph') {
      const idx = unitIndex(target, unit);
      const count = unitCountOf(idx);
      const min = new Float64Array(count).fill(Infinity);
      for (let j = 0; j < n; j++) if (out[j] < min[idx[j]]) min[idx[j]] = out[j];
      for (let j = 0; j < n; j++) out[j] = min[idx[j]];
    }
    return out;
  }

  // pivots(env, target, unit) → { px, py }: each glyph's offset from its own centre to its unit's centre (local du),
  // so rotation and scale can happen about the word, line or run. All zero for unit 'glyph'.
  function pivots(env, target, unit) {
    const n = glyphCount(target);
    const px = new Float32Array(n), py = new Float32Array(n);
    if (unit === undefined || unit === 'glyph') return { px, py };
    const idx = unitIndex(target, unit);
    const { cx, cy } = unitCentres(target, idx, unitCountOf(idx), 'local');
    for (let j = 0; j < n; j++) { px[j] = cx[idx[j]] - target.x[j]; py[j] = cy[idx[j]] - target.y[j]; }
    return { px, py };
  }

  return { ORDERS, UNITS, StaggerError, unitIndex, ranksOf, sungFractions, staggerOf, pivots, SUNG_AHEAD, sungTimeAt, sungTimes };
});
