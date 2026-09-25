/* 文字PVメーカー v2 — original work. Run layout: horizontal lines and vertical columns, fitted to a box (DESIGN §4.15.4–6). */
MV.def('engine/text/layout', ['core/script', 'engine/text/vert', 'engine/text/breaker', 'engine/text/fit', 'engine/text/faces'],
(S, V, B, F, FACES) => {
  'use strict';

  // Everything is measured once at a nominal 100 px and scaled (§4.15.1). Advances below are in em (size 1).
  const BASE = 100;
  const EPS = 1e-9;
  const DEFAULTS = Object.freeze({
    orient: 'h', face: 'display', tracking: 0, leading: 1.3, align: 'center', valign: 'center',
    fit: 'shrink', maxLines: 2, breakAt: 'phrase', emphScale: 1.15,
  });
  const ALIGNS = new Set(['start', 'center', 'end']);
  const BREAKS = new Set(['phrase', 'char', 'none']);
  const CLASS_CODE = Object.freeze(Object.fromEntries(S.CLASSES.map((c, i) => [c, i])));
  const VC = V.CODE;

  class LayoutError extends Error {
    constructor(code, message) { super(message); this.name = 'LayoutError'; this.code = code; }
  }

  // ---- spec -----------------------------------------------------------------------------------------------------

  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }

  function normalizeSpec(spec) {
    if (!spec || typeof spec !== 'object') throw new LayoutError('bad-spec', 'RunSpec must be an object');
    const box = spec.box;
    if (!box || ![box.x, box.y, box.w, box.h].every(finite)) throw new LayoutError('bad-spec', 'RunSpec.box needs finite x, y, w, h');
    if (!finite(spec.size) || spec.size <= 0) throw new LayoutError('bad-spec', 'RunSpec.size must be a positive number');
    const pick = (key, ok) => (ok(spec[key]) ? spec[key] : DEFAULTS[key]);
    return {
      ...spec,
      orient: spec.orient === 'v' ? 'v' : 'h',
      face: pick('face', (v) => FACES.ROLES.includes(v)),
      tracking: pick('tracking', finite),
      leading: pick('leading', (v) => finite(v) && v > 0),
      align: pick('align', (v) => ALIGNS.has(v)),
      valign: pick('valign', (v) => ALIGNS.has(v)),
      fit: spec.fit === 'none' ? 'none' : 'shrink',
      maxLines: pick('maxLines', (v) => Number.isInteger(v) && v >= 1),
      breakAt: pick('breakAt', (v) => BREAKS.has(v)),
      emphScale: pick('emphScale', (v) => finite(v) && v > 0),
      box: { x: box.x, y: box.y, w: Math.max(0, box.w), h: Math.max(0, box.h) },
    };
  }

  // The run's own text and the offset of its first character in the source text (cut.text), for emphasis and `off`.
  function runSource(spec, text) {
    if (spec.text !== undefined && spec.text !== null) return { str: String(spec.text), base: 0 };
    const src = String(text === undefined || text === null ? '' : text);
    const span = Array.isArray(spec.span) ? spec.span : [0, src.length];
    const a = Math.max(0, Math.min(src.length, Math.floor(Number(span[0]) || 0)));
    const b = Math.max(a, Math.min(src.length, Math.floor(Number(span[1]) || 0)));
    return { str: src.slice(a, b), base: a };
  }

  // ---- preparation: classes, fonts and advances (measured once) --------------------------------------------------

  function prepare(rawSpec, text, fonts, measurer) {
    const spec = normalizeSpec(rawSpec);
    const { str, base } = runSource(spec, text);
    const lang = B.langOf(str, spec.lang);
    const u = B.analyze(str);
    const n = u.n;
    const refs = [FACES.fontFor(fonts, spec.face, lang), FACES.fontFor(fonts, spec.face, 'latin')];
    const font = fontIndices(u, lang);
    const mark = emphMarks(u, spec, base);
    const k = emphScales(mark, spec.emphScale);
    const vert = spec.orient === 'v' ? V.classify(u.gs) : null;
    const glue = glueOf(vert, n);
    const nat = naturalAdvances(u, font, refs, measurer, vert);
    const along = new Float64Array(n);
    const cellStart = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      cellStart[i] = glue[i] ? 0 : 1;
      along[i] = alongAdvance(u, vert, nat, i) * (glue[i] ? 0 : groupScale(vert, k, i));
    }
    const prep = {
      spec, str, base, lang, u, n, refs, font, mark, k, vert, glue, nat, along, cellStart, measurer,
      width: trackedWidth(u, along, cellStart, spec.tracking), opps: new Map(), balanced: new Map(),
    };
    prep.shift = baselineShifts(prep);
    Object.assign(prep, lineReach(prep));
    return prep;
  }

  // How far a line's cells reach across the line from its axis, in em: `up` (above / to the right) and `down`.
  // Emphasized glyphs are larger and, horizontally, sit on the shared baseline, so they reach further up.
  function lineReach(prep) {
    let up = 0, down = 0;
    for (let i = 0; i < prep.n; i++) {
      if (prep.u.space[i]) continue;
      const k = prep.k[i];
      const lift = prep.spec.orient === 'v' ? 0 : prep.shift[prep.font[i]] * (k - 1);
      up = Math.max(up, k / 2 + lift);
      down = Math.max(down, k / 2 - lift);
    }
    return up + down > 0 ? { up, down } : { up: 0.5, down: 0.5 };
  }

  function isTcy(vert, i) { return vert.groups[vert.group[i]].cls === 'tcy'; }

  // glue[i] = 1: no line break before grapheme i (the second glyph of a tate-chu-yoko cell).
  function glueOf(vert, n) {
    const glue = new Uint8Array(n);
    if (!vert) return glue;
    for (let i = 1; i < n; i++) {
      if (vert.group[i] >= 0 && vert.group[i] === vert.group[i - 1] && isTcy(vert, i)) glue[i] = 1;
    }
    return glue;
  }

  // Font per grapheme: 0 = the run's script face, 1 = its Latin face (Latin letters, digits, ASCII punctuation in CJK
  // lines). Spaces follow the grapheme before them (else after), so a measured segment is never split by a space.
  function fontIndices(u, lang) {
    const font = new Uint8Array(u.n);
    if (lang === 'en') return font;
    for (let i = 0; i < u.n; i++) font[i] = FACES.usesLatinFace(u.cls[i]) ? 1 : 0;
    for (let i = 0; i < u.n; i++) {
      if (!u.space[i]) continue;
      const p = u.prev[i], q = u.next[i];
      font[i] = p >= 0 ? font[p] : q < u.n ? font[q] : 0;
    }
    return font;
  }

  // mark[i] = 1 when grapheme i lies in one of RunSpec.emph's ranges (source-text offsets). This is RunLayout.emph,
  // whatever emphScale is: a scale of 1 still marks the glyphs for the accent ink and emphasis-first ordering.
  function emphMarks(u, spec, base) {
    const mark = new Uint8Array(u.n);
    const ranges = Array.isArray(spec.emph) ? spec.emph : [];
    for (const r of ranges) {
      if (!Array.isArray(r)) continue;
      const a = Number(r[0]), b = Number(r[1]);
      for (let i = 0; i < u.n; i++) {
        const at = base + u.offs[i];
        if (at >= a && at < b) mark[i] = 1;
      }
    }
    return mark;
  }

  // Size factor per grapheme: emphScale on marked glyphs, 1 elsewhere.
  function emphScales(mark, scale) {
    const k = new Float64Array(mark.length);
    for (let i = 0; i < mark.length; i++) k[i] = mark[i] ? scale : 1;
    return k;
  }

  // Horizontal advance of every grapheme in em (size 1). Advances come from prefix widths of each same-font segment,
  // so the run's kerning is kept (§4.15.5). In vertical runs, only Latin runs, tcy cells and single rotated or space
  // glyphs need a width; a Latin run or tcy cell is its own segment.
  function naturalAdvances(u, font, refs, measurer, vert) {
    const nat = new Float64Array(u.n);
    const segmentEnd = (i) => {
      if (vert && vert.group[i] >= 0) return vert.groups[vert.group[i]].to;
      if (vert) return i + 1;
      let j = i + 1;
      while (j < u.n && font[j] === font[i]) j++;
      return j;
    };
    for (let i = 0; i < u.n;) {
      const end = segmentEnd(i);
      const css = refs[font[i]].css(BASE);
      let before = 0, text = '';
      for (let j = i; j < end; j++) {
        text += u.gs[j];
        const w = measurer.width(css, text);
        nat[j] = Math.max(0, (w - before) / BASE);
        before = w;
      }
      i = end;
    }
    return nat;
  }

  // Advance along the line (em, before emphasis): the natural advance horizontally; vertically 1 em per upright cell,
  // the natural advance for rotated glyphs, Latin runs and spaces.
  function alongAdvance(u, vert, nat, i) {
    if (!vert) return nat[i];
    const c = vert.vcls[i];
    if (u.space[i] || c === VC.rotated || c === VC.latinRun) return nat[i];
    return 1;
  }

  // A tcy cell takes the largest emphasis scale of its glyphs.
  function groupScale(vert, k, i) {
    if (!vert || vert.group[i] < 0 || !isTcy(vert, i)) return k[i];
    const g = vert.groups[vert.group[i]];
    let m = 0;
    for (let j = g.from; j < g.to; j++) m = Math.max(m, k[j]);
    return m;
  }

  // Width of a grapheme range in em: trimmed sum of advances plus tracking between cells.
  function trackedWidth(u, along, cellStart, tracking) {
    const pre = new Float64Array(u.n + 1);
    for (let i = 0; i < u.n; i++) pre[i + 1] = pre[i] + along[i] + (cellStart[i] ? tracking : 0);
    return (a, b) => {
      const t = B.trimmed(u, a, b);
      if (!t) return 0;
      return pre[t[1]] - pre[t[0]] - tracking;
    };
  }

  // Horizontal runs: an emphasized glyph grows about its baseline centre, so its middle moves by d·(1 − k)·size,
  // d = (ascent − descent) / 2 of its font per em.
  function baselineShifts(prep) {
    if (prep.spec.orient === 'v') return [0, 0];
    return prep.refs.map((ref) => {
      const m = prep.measurer.metrics(ref.css(BASE));
      return m && finite(m.ascent) && finite(m.descent) ? (m.ascent - m.descent) / 2 / BASE : 0;
    });
  }

  // ---- lines at a size ------------------------------------------------------------------------------------------

  function opportunitiesFor(prep, mode) {
    let list = prep.opps.get(mode);
    if (!list) { list = B.opportunities(prep.u, prep.lang, mode, prep.glue); prep.opps.set(mode, list); }
    return list;
  }

  function balancedFor(prep, mode, count) {
    const key = mode + '|' + count;
    let lines = prep.balanced.get(key);
    if (!lines) { lines = B.balance(prep.u, opportunitiesFor(prep, mode), prep.width, count); prep.balanced.set(key, lines); }
    return lines;
  }

  function axes(prep) {
    const { box, orient } = prep.spec;
    return orient === 'v' ? { along: box.h, cross: box.w } : { along: box.w, cross: box.h };
  }

  // Lines (grapheme ranges covering the run) at size s: the fewest first-fit lines, re-balanced to even widths; when
  // more than maxLines are needed, maxLines balanced lines (then the widest line is too long and the fit shrinks).
  function linesAt(prep, s, cfg) {
    if (prep.u.next[0] >= prep.n) return [];
    if (cfg.breakAt === 'none') return [[0, prep.n]];
    const cap = axes(prep).along / s;
    const first = B.greedy(prep.u, opportunitiesFor(prep, cfg.breakAt), prep.width, cap);
    if (first.length <= 1) return first;
    return balancedFor(prep, cfg.breakAt, Math.min(first.length, cfg.maxLines));
  }

  function crossExtent(prep, count, s) { return count ? ((count - 1) * prep.spec.leading + prep.up + prep.down) * s : 0; }

  function fitsAt(prep, s, cfg) {
    const lines = linesAt(prep, s, cfg);
    const { along, cross } = axes(prep);
    let widest = 0;
    for (const [a, b] of lines) widest = Math.max(widest, prep.width(a, b));
    const within = (used, room) => used <= room + EPS * Math.max(1, room);
    return within(widest * s, along) && within(crossExtent(prep, lines.length, s), cross);
  }

  function fitPrepared(prep) {
    const { spec } = prep;
    const cfgSpec = { size: spec.size, fit: spec.fit, breakAt: spec.breakAt, maxLines: spec.maxLines };
    return F.fitSize(cfgSpec, (s, cfg) => fitsAt(prep, s, cfg));
  }

  // ---- placing glyphs -------------------------------------------------------------------------------------------

  function alignOffset(mode, room, used) {
    if (mode === 'start') return 0;
    if (mode === 'end') return room - used;
    return (room - used) / 2;
  }

  // Glyph positions in the spec box's frame (du). Returns the arrays of RunLayout plus cell boxes for the bounds.
  function place(prep, fitted) {
    const { spec, u, n } = prep;
    const s = fitted.size;
    const lines = linesAt(prep, s, fitted);
    const out = allocate(n);
    const { along, cross } = axes(prep);
    const extent = crossExtent(prep, lines.length, s);
    const pitch = spec.leading * s;
    const reach = prep.up * s;
    const blockStart = spec.orient === 'v'
      ? cross - alignOffset(spec.valign, cross, extent)            // right edge of the first column
      : alignOffset(spec.valign, cross, extent);                   // top of the first line
    lines.forEach(([a, b], j) => {
      const axis = spec.orient === 'v' ? blockStart - reach - j * pitch : blockStart + reach + j * pitch;
      const used = prep.width(a, b) * s;
      const t = B.trimmed(u, a, b) || [a, a];
      let pen = alignOffset(spec.align, along, used);
      for (let i = a; i < b; i++) {
        out.line[i] = j;
        const inside = i >= t[0] && i < t[1];
        const adv = inside ? prep.along[i] * s : 0;
        const at = pen + adv / 2;
        if (spec.orient === 'v') placeVertical(prep, out, i, axis, at, adv, s);
        else placeHorizontal(prep, out, i, axis, at, adv, s);
        if (inside) pen += adv + (prep.cellStart[i] ? spec.tracking * s : 0);
      }
    });
    return { out, lines };
  }

  function allocate(n) {
    return {
      x: new Float32Array(n), y: new Float32Array(n), w: new Float32Array(n), h: new Float32Array(n),
      rot: new Uint8Array(n), sx: new Float32Array(n).fill(1), em: new Float32Array(n), vcls: new Uint8Array(n),
      line: new Int16Array(n), cellX: new Float64Array(n), cellY: new Float64Array(n),
      cellW: new Float64Array(n), cellH: new Float64Array(n),
    };
  }

  function setCell(out, i, cx, cy, cw, ch) { out.cellX[i] = cx; out.cellY[i] = cy; out.cellW[i] = cw; out.cellH[i] = ch; }

  function placeHorizontal(prep, out, i, lineY, at, adv, s) {
    const em = prep.k[i] * s;
    const cy = lineY + prep.shift[prep.font[i]] * s * (1 - prep.k[i]);
    out.x[i] = at; out.y[i] = cy; out.w[i] = adv; out.h[i] = em; out.em[i] = em;
    setCell(out, i, at, cy, adv, em);
  }

  function placeVertical(prep, out, i, colX, at, adv, s) {
    const { vert, u } = prep;
    const code = vert.vcls[i];
    const cls = V.VCLS[code];
    out.vcls[i] = code;
    if (code === VC.tcy) { placeTcy(prep, out, i, colX, at, s); return; }
    const em = prep.k[i] * s;
    const family = prep.refs[prep.font[i]].family;
    const [dx, dy] = V.offsetFor(cls, family, prep.nat[i]);
    out.x[i] = colX + dx * em; out.y[i] = at + dy * em;
    out.w[i] = em; out.h[i] = adv; out.em[i] = em;
    out.rot[i] = V.rotOf(cls, u.gs[i]);
    setCell(out, i, colX, at, em, adv);
  }

  // A tate-chu-yoko cell: its glyphs side by side, centred in one em cell, condensed to at most 1 em wide.
  // The first glyph carries the whole cell advance, so `at` (its centre) is the cell centre.
  function placeTcy(prep, out, i, colX, at, s) {
    const grp = prep.vert.groups[prep.vert.group[i]];
    if (i !== grp.from) return;                                  // placed with the group's first glyph
    const em = groupScale(prep.vert, prep.k, i) * s;
    let total = 0;
    for (let j = grp.from; j < grp.to; j++) total += prep.nat[j] * em;
    const f = total > em ? em / total : 1;
    let x = colX - (f * total) / 2;
    for (let j = grp.from; j < grp.to; j++) {
      const w = prep.nat[j] * em * f;
      out.vcls[j] = VC.tcy;
      out.x[j] = x + w / 2; out.y[j] = at; out.w[j] = w; out.h[j] = em; out.sx[j] = f; out.em[j] = em;
      setCell(out, j, x + w / 2, at, w, em);
      x += w;
    }
  }

  // ---- bounds, words, lines -------------------------------------------------------------------------------------

  function inkBox(prep, out) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < prep.n; i++) {
      if (prep.u.space[i]) continue;
      x0 = Math.min(x0, out.cellX[i] - out.cellW[i] / 2); x1 = Math.max(x1, out.cellX[i] + out.cellW[i] / 2);
      y0 = Math.min(y0, out.cellY[i] - out.cellH[i] / 2); y1 = Math.max(y1, out.cellY[i] + out.cellH[i] / 2);
    }
    if (x0 === Infinity) {
      const { box } = prep.spec;
      return { x: box.w / 2, y: box.h / 2, w: 0, h: 0 };
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function unionOf(prep, out, from, to) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = from; i < to; i++) {
      if (prep.u.space[i]) continue;
      x0 = Math.min(x0, out.cellX[i] - out.cellW[i] / 2); x1 = Math.max(x1, out.cellX[i] + out.cellW[i] / 2);
      y0 = Math.min(y0, out.cellY[i] - out.cellH[i] / 2); y1 = Math.max(y1, out.cellY[i] + out.cellH[i] / 2);
    }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // Word units (phrases for ja/zh, space-separated for en/ko), split where a line ends. Spaces join the word before.
  function wordIndex(prep, out) {
    const word = new Int16Array(prep.n);
    const units = B.phraseUnits(prep.u, prep.lang);
    let w = -1, unit = -1, lastLine = -1;
    for (let i = 0; i < prep.n; i++) {
      if (prep.u.space[i]) { word[i] = Math.max(0, w); continue; }
      let u = unit;
      while (u + 1 < units.length && units[u + 1][0] <= i) u++;
      if (u !== unit || out.line[i] !== lastLine) { w++; unit = u; lastLine = out.line[i]; }
      word[i] = w;
    }
    return word;
  }

  function rangesOf(index, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const id = index[i];
      if (!out[id]) out[id] = { from: i, to: i + 1 };
      else out[id].to = i + 1;
    }
    return out.filter(Boolean);
  }

  // ---- building the RunLayout -----------------------------------------------------------------------------------

  function build(prep, fitted) {
    const { spec, u, n } = prep;
    const { out, lines } = place(prep, fitted);
    const ink = inkBox(prep, out);
    const word = wordIndex(prep, out);
    const cls = new Uint8Array(n), off = new Int32Array(n);
    const emph = prep.mark.slice();
    for (let i = 0; i < n; i++) {
      cls[i] = CLASS_CODE[u.cls[i]];
      off[i] = prep.base + u.offs[i];
      out.x[i] -= ink.x; out.y[i] -= ink.y;
    }
    const lineList = lines.map(([a, b]) => {
      const box = unionOf(prep, out, a, b) || { x: ink.x, y: ink.y, w: 0, h: 0 };
      return { from: a, to: b, x: box.x - ink.x, y: box.y - ink.y, w: box.w, h: box.h };
    });
    const hasContent = u.next[0] < n;
    const wordList = (hasContent ? rangesOf(word, n) : []).map(({ from, to }) => {
      const box = unionOf(prep, out, from, to) || { x: ink.x, y: ink.y, w: 0, h: 0 };
      return { from, to, cx: box.x + box.w / 2 - ink.x, cy: box.y + box.h / 2 - ink.y };
    });
    return {
      size: fitted.size,
      box: { x: spec.box.x + ink.x, y: spec.box.y + ink.y, w: ink.w, h: ink.h },
      n, ch: u.gs.slice(), cls, x: out.x, y: out.y, w: out.w, h: out.h, rot: out.rot,
      line: out.line, word, emph, lines: lineList, words: wordList,
      overfull: fitted.overfull,
      // additive fields (docs/NOTES.md, WP2)
      orient: spec.orient, lang: prep.lang, em: out.em, sx: out.sx, vcls: out.vcls, off,
      font: prep.font.slice(), fonts: prep.refs.slice(),
      clip: fitted.overfull ? { ...spec.box } : null,
      fitStep: fitted.step, breakAt: fitted.breakAt, maxLines: fitted.maxLines,
    };
  }

  // ---- public ---------------------------------------------------------------------------------------------------

  // layoutRun(spec, text, fonts, measurer) → RunLayout. `text` is the cut text (the run is text.slice(span)), unless
  // spec.text is given. `fonts` = resolved faces (resolveFaces, or plan.look.faces). sizeGroup needs layoutRuns.
  function layoutRun(spec, text, fonts, measurer) {
    const prep = prepare(spec, text, fonts, measurer);
    return build(prep, fitPrepared(prep));
  }

  // layoutRuns([{ spec, text }], fonts, measurer) → RunLayout[]. Runs sharing a `sizeGroup` end at one size: the
  // smallest of their fitted sizes (each keeps the breaking its own fit needed; `overfull` is re-checked).
  function layoutRuns(items, fonts, measurer) {
    const preps = items.map((it) => prepare(it.spec, it.text, fonts, measurer));
    const fitted = preps.map(fitPrepared);
    const groups = new Map();
    preps.forEach((p, i) => {
      const g = p.spec.sizeGroup;
      if (typeof g !== 'string' || !g) return;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(i);
    });
    for (const members of groups.values()) {
      const size = Math.min(...members.map((i) => fitted[i].size));
      for (const i of members) {
        if (fitted[i].size === size) continue;
        const cfg = { breakAt: fitted[i].breakAt, maxLines: fitted[i].maxLines };
        const overfull = preps[i].spec.fit === 'shrink' && !fitsAt(preps[i], size, cfg);
        fitted[i] = { ...fitted[i], size, overfull };
      }
    }
    return preps.map((p, i) => build(p, fitted[i]));
  }

  return { layoutRun, layoutRuns, normalizeSpec, LayoutError, DEFAULTS };
});
