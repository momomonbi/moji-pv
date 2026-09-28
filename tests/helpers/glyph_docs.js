/* 文字PVメーカー v2 — original work. Test documents for the glyph morph and the weight animation (DESIGN_2_2 §4): invented lines that share letters. */
'use strict';
const corpus = require('./corpus.js');

// The basic fixture (its song, timing and look) with these lyric rows (ids r1, r2, … in base 36), a document marker
// (gen: 1 = a work made by core/doc newDoc(); absent = an older work) and pins.
function docWith(rows, opts) {
  const o = opts || {};
  const doc = corpus.project('basic').doc;
  doc.sheet = { next: rows.length + 1, rows: rows.map((src, i) => ({ id: rowId(i), src })) };
  doc.look = Object.assign({}, doc.look);
  if (o.gen !== undefined) doc.look.gen = o.gen; else delete doc.look.gen;
  if (o.seed !== undefined) doc.look.seed = o.seed;
  doc.pins = Object.assign({}, o.pins || {});
  return doc;
}

function rowId(i) { return 'r' + (i + 1).toString(36); }

// Lines that share letters, one background for the whole video (a work ground pin; `ground` is its key), so every
// boundary between two lyric lines is a text boundary: 青い空へ → 青い海へ (青い travels, 空 melts into 海, へ travels),
// 夜の町を歩く → 朝の町を歩く, a line cut in two that shares 青い across its own cut boundary (r7: 青い空/青い海), then
// lines that share nothing meaningful (君の手 → 夢の中: only の).
const MORPH_ROWS = Object.freeze(['[ti:ガラスの朝]', '# Aメロ', '青い空へ', '青い海へ', '夜の町を歩く', '朝の町を歩く', '# サビ', '青い空/青い海',
  '君の手', '夢の中', '光る窓', '光る窓の向こう']);

function morphDoc(ground, opts) {
  const o = Object.assign({ gen: 1 }, opts || {});
  const pins = Object.assign({ 'work:ground': { v: ground, by: 'user' } }, o.pins || {});
  return docWith(o.rows || MORPH_ROWS, Object.assign({}, o, { pins }));
}

module.exports = { docWith, morphDoc, rowId, MORPH_ROWS };
