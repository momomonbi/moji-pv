/* 文字PVメーカー v2 — original work. Tests for engine/text/vert and vertical layouts with the fake measurer (DESIGN §4.15.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');

const MV = load();
const V = MV.use('engine/text/vert');
const L = MV.use('engine/text/layout');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const FACES = MV.use('engine/text/faces');

const faces = FACES.resolveFaces(null, null, ['ja']);
const EM = 100;

// One column, no fitting: size 100 in a 100-wide box, cells from the top.
function column(text, extra = {}) {
  return L.layoutRun({ span: [0, text.length], orient: 'v', size: EM, box: { x: 0, y: 0, w: EM, h: 3000 },
    align: 'start', fit: 'none', breakAt: 'none', maxLines: 1, ...extra }, text, faces, fakeMeasurer());
}

// Cell centre of glyph i in the layout's frame (the draw position minus the class offset).
function drawOffset(r, i) {
  const axis = r.lines[r.line[i]].x + r.lines[r.line[i]].w / 2;
  return { dx: r.x[i] - axis };
}

const cls = (r) => Array.from(r.vcls, (c) => V.VCLS[c]);

test('the class table is the FROZEN one', () => {
  assert.deepEqual(V.VCLS, ['upright', 'smallKana', 'corner', 'centred', 'rotated', 'tcy', 'latinRun']);
  assert.deepEqual({ ...V.TABLE.smallKana }, { dx: 0.10, dy: -0.10, rot: 0 });
  assert.deepEqual({ ...V.TABLE.corner }, { dx: 0.55, dy: -0.55, rot: 0 });
  assert.equal(V.TABLE.rotated.rot, 1);
  assert.equal(V.TABLE.latinRun.rot, 1);
  for (const c of ['upright', 'centred', 'tcy']) assert.deepEqual({ ...V.TABLE[c] }, { dx: 0, dy: 0, rot: 0 });
});

test('classOf: every listed character lands in its class', () => {
  const expect = {
    upright: '夜明あアｱＡ１한😀',
    smallKana: 'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶㇰㇱㇿ',
    corner: '、。，．､｡',
    centred: '・：；！？‼⁉',
    rotated: 'ー―‐–—…‥〜～＝「」『』（）()［］【】〔〕〈〉《》｛｝＜＞',
  };
  for (const [name, chars] of Object.entries(expect)) {
    for (const ch of chars) assert.equal(V.classOf(ch), name, `${ch} should be ${name}`);
  }
  assert.equal(V.rotOf('rotated', '〜'), 2, '〜 is mirrored after rotation');
  assert.equal(V.rotOf('rotated', '～'), 2);
  assert.equal(V.rotOf('rotated', 'ー'), 1);
  assert.equal(V.rotOf('latinRun', 'a'), 1);
  assert.equal(V.rotOf('upright', 'あ'), 0);
});

test('segment: tcy for 1–2 ASCII digits and !? pairs, Latin runs of ≥ 3, short Latin upright', () => {
  const seg = (t) => V.segment(t).map((s) => [t.slice(s.a, s.b), s.cls]);
  assert.deepEqual(seg('12月'), [['12', 'tcy'], ['月', 'upright']]);
  assert.deepEqual(seg('3日'), [['3', 'tcy'], ['日', 'upright']]);
  assert.deepEqual(seg('2024年'), [['2024', 'latinRun'], ['年', 'upright']]);
  assert.deepEqual(seg('え!?'), [['え', 'upright'], ['!?', 'tcy']]);
  assert.deepEqual(seg('!!?'), [['!!', 'tcy'], ['?', 'centred']]);
  assert.deepEqual(seg('君とI love you'), [['君', 'upright'], ['と', 'upright'], ['I love you', 'latinRun']]);
  assert.deepEqual(seg('OK'), [['O', 'upright'], ['K', 'upright']], 'two letters stay upright');
  assert.deepEqual(seg("rock 'n' roll"), [["rock 'n' roll", 'latinRun']], 'inner spaces and apostrophes join');
  assert.deepEqual(seg('Yeah, です'), [['Yeah,', 'latinRun'], [' ', 'upright'], ['で', 'upright'], ['す', 'upright']]);
  assert.deepEqual(seg('あ、'), [['あ', 'upright'], ['、', 'corner']]);
  assert.equal(V.longestLatinRun('君とI love you'), 10);
  assert.equal(V.longestLatinRun('夜明け'), 0);
});

test('vertical cells: upright centred, small kana and corner marks offset toward the upper right', () => {
  const r = column('あっ、');
  assert.deepEqual(cls(r), ['upright', 'smallKana', 'corner']);
  // Cells stack from the top: centres at 0.5, 1.5, 2.5 em; the offsets are applied to the draw positions.
  approx(r.y[0], 50); approx(drawOffset(r, 0).dx, 0);
  approx(r.y[1], 150 - 0.10 * EM); approx(drawOffset(r, 1).dx, 0.10 * EM);
  approx(r.y[2], 250 - 0.55 * EM); approx(drawOffset(r, 2).dx, 0.55 * EM);
  assert.deepEqual(Array.from(r.rot), [0, 0, 0]);
  approx(r.box.h, 300, 1e-6, 'the ink box is the three cells');
});

test('vertical cells: a corner mark narrower than 1 em starts where a fullwidth one does, so it stays in its cell', () => {
  const r = column('ねえ,君｡､。');
  assert.deepEqual(cls(r), ['upright', 'upright', 'corner', 'upright', 'corner', 'corner', 'corner']);
  const m = fakeMeasurer();
  const advances = [];
  for (const i of [2, 4, 5, 6]) {
    const adv = m.width(r.fonts[r.font[i]].css(100), r.ch[i]) / 100;       // the glyph's own advance, em
    advances.push(adv);
    const dx = drawOffset(r, i).dx / EM;
    approx(dx, 0.55 - (1 - Math.min(1, adv)) / 2, 1e-6, `${r.ch[i]}: dx`);
    approx(dx - adv / 2, 0.05, 1e-6, `${r.ch[i]}: its advance box starts 0.05 em right of the column axis`);
    approx(r.y[i] - (r.lines[0].y + (i + 0.5) * EM), -0.55 * EM, 1e-4, `${r.ch[i]}: dy is the table's`);
  }
  assert.deepEqual(advances, [0.6, 0.5, 0.5, 1], 'the fake widths of , ｡ ､ 。');
  assert.equal(r.font[2], 1, 'ASCII , is drawn with the Latin face');
  assert.deepEqual(V.offsetFor('corner', 'Fraunces', 0.25), [0.55 - 0.375, -0.55]);
  for (const adv of [1, 1.2, undefined, NaN, -1]) assert.deepEqual(V.offsetFor('corner', 'Fraunces', adv), [0.55, -0.55], `adv ${adv}`);
  assert.deepEqual(V.offsetFor('smallKana', 'Fraunces', 0.5), [0.10, -0.10], 'only corner marks move by advance');
});

test('vertical cells: centred punctuation upright, brackets and long marks rotated, wave dashes mirrored', () => {
  const r = column('「ねー！」〜');
  assert.deepEqual(cls(r), ['rotated', 'upright', 'rotated', 'centred', 'rotated', 'rotated']);
  assert.deepEqual(Array.from(r.rot), [1, 0, 1, 0, 1, 2]);
  for (let i = 0; i < r.n; i++) approx(drawOffset(r, i).dx, 0, 1e-6, `glyph ${i} sits on the column axis`);
  // A rotated fullwidth mark advances by its width (1 em here), like an upright cell.
  approx(r.y[1] - r.y[0], EM, 1e-6);
});

test('tate-chu-yoko: digits and !? share one em cell, condensed to at most 1 em and centred', () => {
  const r = column('12月!?');
  assert.deepEqual(cls(r), ['tcy', 'tcy', 'upright', 'tcy', 'tcy']);
  const f = EM / (56 + 56);                               // two digits at 56 each → condensed
  approx(r.sx[0], f, 1e-6); approx(r.sx[1], f, 1e-6);
  approx(r.w[0] + r.w[1], EM, 1e-4, 'condensed to 1 em');
  approx(r.y[0], r.y[1], 1e-6, 'both digits on one cell');
  const axis = r.lines[0].x + r.lines[0].w / 2;
  approx((r.x[0] - r.w[0] / 2 + r.x[1] + r.w[1] / 2) / 2, axis, 1e-4, 'centred on the axis');
  approx(r.y[2] - r.y[0], EM, 1e-4, 'the cell advances 1 em');
  approx(r.sx[3], EM / 120, 1e-6, '!? condensed from 1.2 em');
  const one = column('3日');
  approx(one.sx[0], 1, 0, 'a single digit fits without condensing');
  assert.deepEqual(Array.from(one.rot), [0, 0]);
});

test('Latin runs rotate as one block: each glyph +90°, advancing by its measured width', () => {
  const r = column('君Love');
  assert.deepEqual(cls(r), ['upright', 'latinRun', 'latinRun', 'latinRun', 'latinRun']);
  assert.deepEqual(Array.from(r.rot), [0, 1, 1, 1, 1]);
  approx(r.y[2] - r.y[1], 56, 1e-4);
  approx(r.y[1] - r.y[0], 50 + 28, 1e-4, 'upright cell half (50) + half of L (28)');
  for (let i = 1; i < 5; i++) approx(r.h[i], 56, 1e-4);
  const x0 = r.x[1];
  for (let i = 2; i < 5; i++) approx(r.x[i], x0, 1e-6, 'the run stays on the column axis');
});

test('columns run right to left, glyphs top to bottom', () => {
  const text = '夜明けの街を走る';
  const r = L.layoutRun({ span: [0, text.length], orient: 'v', size: EM, box: { x: 0, y: 0, w: 400, h: 450 },
    align: 'start', valign: 'start', maxLines: 2, fit: 'none' }, text, faces, fakeMeasurer());
  assert.equal(r.lines.length, 2);
  assert.deepEqual([r.lines[0].from, r.lines[0].to, r.lines[1].from, r.lines[1].to], [0, 4, 4, 8]);
  assert.ok(r.lines[0].x > r.lines[1].x, 'the first column is to the right');
  approx(r.lines[0].x - r.lines[1].x, 1.3 * EM, 1e-4, 'columns are one leading apart');
  for (let i = 1; i < 4; i++) assert.ok(r.y[i] > r.y[i - 1], 'top to bottom');
  approx(r.y[4], r.y[0], 1e-6, 'the second column starts at the top too');
  // valign start = the right edge of the box
  approx(r.box.x + r.box.w, 400, 1e-4);
});

test('vertical layout is deterministic and keeps per-face adjustments optional', () => {
  const a = column('「夢」を12回見たLove!?');
  const b = column('「夢」を12回見たLove!?');
  assert.deepEqual(Array.from(a.x), Array.from(b.x));
  assert.deepEqual(Array.from(a.y), Array.from(b.y));
  assert.deepEqual(V.offsetFor('corner', 'Yuji Syuku'), [0.55, -0.55]);
  assert.deepEqual(V.offsetFor('smallKana', 'Unknown Face'), [0.10, -0.10]);
});
