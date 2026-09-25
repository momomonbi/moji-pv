/* 文字PVメーカー v2 — original work. Vertical Japanese: per-character classes, offsets and rotations (DESIGN §4.15.2). */
MV.def('engine/text/vert', ['core/script'], (S) => {
  'use strict';

  // Canvas2D cannot switch on the OpenType `vert` feature, so every vertical adjustment is explicit. Offsets are in em,
  // relative to the cell centre, x right, y down. Columns stack top to bottom and run right to left.
  const VCLS = Object.freeze(['upright', 'smallKana', 'corner', 'centred', 'rotated', 'tcy', 'latinRun']);
  const CODE = Object.freeze(Object.fromEntries(VCLS.map((name, i) => [name, i])));

  // FROZEN table (§4.15.2): offset [dx, dy] in em and rotation (0 upright, 1 = +90°, 2 = +90° then mirrored).
  const TABLE = Object.freeze({
    upright: Object.freeze({ dx: 0, dy: 0, rot: 0 }),
    smallKana: Object.freeze({ dx: 0.10, dy: -0.10, rot: 0 }),
    corner: Object.freeze({ dx: 0.55, dy: -0.55, rot: 0 }),
    centred: Object.freeze({ dx: 0, dy: 0, rot: 0 }),
    rotated: Object.freeze({ dx: 0, dy: 0, rot: 1 }),
    tcy: Object.freeze({ dx: 0, dy: 0, rot: 0 }),
    latinRun: Object.freeze({ dx: 0, dy: 0, rot: 1 }),
  });

  // Characters of the listed classes. The ASCII counterparts of listed fullwidth marks (, . : ; ! ? - = [ ] { } < > ~)
  // are an addition for text typed without an IME: they behave like their fullwidth forms (docs/NOTES.md, WP2).
  const CORNER = new Set([...'、。，．､｡', ',', '.']);
  const CENTRED = new Set([...'・：；！？‼⁉', ':', ';', '!', '?']);
  const ROTATED = new Set([...'ー―‐–—…‥〜～＝「」『』（）()［］【】〔〕〈〉《》｛｝＜＞', '-', '=', '[', ']', '{', '}', '<', '>', '~']);
  const MIRRORED = new Set(['〜', '～', '~']);
  const BANG = new Set(['!', '?']);
  // Inside a Latin run: spaces, hyphens and apostrophes (§4.15.2), plus '.', ',' and '&' between letters.
  const JOINERS = new Set([' ', '-', '\'', '’', '.', ',', '&']);
  const TRAILERS = new Set(['.', ',']);
  const MIN_LATIN_RUN = 3;
  const MAX_TCY_DIGITS = 2;

  // Optional per-family corrections: FACE_ADJUST[family][cls] = { dx, dy } replaces the table offset for that face.
  // Empty until a face is seen to need one on real-font screenshots; the lookup below already honours it.
  const FACE_ADJUST = Object.freeze({});

  function isLatinContent(g) {
    const c = S.charClass(g);
    return c === 'latin' || c === 'digit';
  }

  function isAsciiDigit(g) { return g.length === 1 && g >= '0' && g <= '9'; }

  // Class of one grapheme on its own (runs are decided by classify).
  function classOf(g) {
    if (ROTATED.has(g)) return 'rotated';
    if (CORNER.has(g)) return 'corner';
    if (CENTRED.has(g)) return 'centred';
    if (S.charClass(g) === 'smallKana') return 'smallKana';
    return 'upright';
  }

  // End (exclusive) of the Latin run that starts at gs[i], and how many letters/digits it holds.
  function latinRunAt(gs, i) {
    let k = i, count = 0, last = i;
    while (k < gs.length) {
      if (isLatinContent(gs[k])) { count++; last = k; k++; continue; }
      if (!JOINERS.has(gs[k])) break;
      let m = k;
      while (m < gs.length && JOINERS.has(gs[m])) m++;
      if (m < gs.length && isLatinContent(gs[m])) { k = m; continue; }
      break;
    }
    let end = last + 1;
    if (count >= MIN_LATIN_RUN && end < gs.length && TRAILERS.has(gs[end])) end++;
    return { end, count };
  }

  function allDigits(gs, from, to) {
    for (let k = from; k < to; k++) if (!isAsciiDigit(gs[k])) return false;
    return true;
  }

  // Classifies graphemes into vertical cells. Returns per-grapheme class codes, the group each grapheme belongs to
  // (a tcy cell or a Latin run; -1 for single cells) and the group list [{ cls, from, to }] in grapheme indices.
  function classify(gs) {
    const n = gs.length;
    const vcls = new Uint8Array(n);
    const group = new Int32Array(n).fill(-1);
    const groups = [];
    const addGroup = (cls, from, to) => {
      for (let k = from; k < to; k++) { vcls[k] = CODE[cls]; group[k] = groups.length; }
      groups.push({ cls, from, to });
    };
    let i = 0;
    while (i < n) {
      const g = gs[i];
      if (isLatinContent(g)) {
        const { end, count } = latinRunAt(gs, i);
        if (count >= MIN_LATIN_RUN) addGroup('latinRun', i, end);
        else if (end - i <= MAX_TCY_DIGITS && allDigits(gs, i, end)) addGroup('tcy', i, end);
        else for (let k = i; k < end; k++) vcls[k] = CODE[classOf(gs[k])];
        i = end;
        continue;
      }
      if (BANG.has(g) && i + 1 < n && BANG.has(gs[i + 1])) { addGroup('tcy', i, i + 2); i += 2; continue; }
      vcls[i] = CODE[classOf(g)];
      i++;
    }
    return { vcls, group, groups };
  }

  // Metric-free cells of a text: [{ cls, a, b }] in UTF-16 offsets; a tcy cell or a Latin run is one entry.
  function segment(text) {
    const s = String(text);
    const offs = S.graphemeOffsets(s);
    const gs = S.graphemes(s);
    const { vcls, group, groups } = classify(gs);
    const out = [];
    for (let k = 0; k < gs.length;) {
      if (group[k] >= 0) {
        const grp = groups[group[k]];
        out.push({ cls: grp.cls, a: offs[grp.from], b: offs[grp.to] });
        k = grp.to;
      } else {
        out.push({ cls: VCLS[vcls[k]], a: offs[k], b: offs[k + 1] });
        k++;
      }
    }
    return out;
  }

  // Longest Latin run in graphemes (0 when none); the planner allows 'v' only when it is ≤ 12 (§4.16.7).
  function longestLatinRun(text) {
    const { groups } = classify(S.graphemes(String(text)));
    let best = 0;
    for (const grp of groups) if (grp.cls === 'latinRun') best = Math.max(best, grp.to - grp.from);
    return best;
  }

  // Offset [dx, dy] in em for a class, with the face's correction when FACE_ADJUST has one. The table's corner offset
  // assumes a 1 em advance, whose ink sits in the left part of its box. `adv` (the glyph's advance in em, optional)
  // moves a narrower corner mark (',' '.' '､' '｡', proportional faces) so its advance box starts where a fullwidth one
  // would: dx − (1 − adv) / 2. Its ink then stays in the cell's upper right instead of crossing the cell's right edge.
  function offsetFor(cls, family, adv) {
    const adj = family && FACE_ADJUST[family] && FACE_ADJUST[family][cls];
    const base = TABLE[cls] || TABLE.upright;
    const dx = adj ? adj.dx : base.dx, dy = adj ? adj.dy : base.dy;
    if (cls !== 'corner' || !(adv >= 0) || adv >= 1) return [dx, dy];
    return [dx - (1 - adv) / 2, dy];
  }

  // Rotation code of a grapheme in a class: 0 upright, 1 = +90°, 2 = +90° mirrored (〜 ～).
  function rotOf(cls, g) {
    if (cls === 'rotated') return MIRRORED.has(g) ? 2 : 1;
    return TABLE[cls] ? TABLE[cls].rot : 0;
  }

  return {
    VCLS, CODE, TABLE, FACE_ADJUST, CORNER, CENTRED, ROTATED, MIRRORED,
    classOf, classify, segment, longestLatinRun, offsetFor, rotOf,
  };
});
