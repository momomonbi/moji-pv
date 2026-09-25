/* 文字PVメーカー v2 — original work. Tests for ui/looks: pointer derivation, append/coalesce, cap and stars (DESIGN §3.7, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const LK = MV.use('ui/looks');
const D = MV.use('core/doc');

function docWith(seed, moodSeed, salts) {
  const doc = D.defaultDoc();
  doc.look = Object.assign({}, doc.look, { seed, moodSeed });
  doc.salts = salts || {};
  return doc;
}
function entry(n, seed, moodSeed, salts, extra) {
  return Object.assign({ n, seed, moodSeed, salts: salts || {}, scope: 'work', label: ['look.omakase', {}], star: false }, extra);
}
function sideWith(list, cap) { return { looks: { list, cap: cap || 50 }, aiLog: [] }; }

test('pointer: the newest entry equal to the current look; modified when none', () => {
  const side = sideWith([entry(1, 1, 1), entry(2, 5, 6), entry(3, 1, 1), entry(4, 9, 9, { 'line/r4': 1 })]);
  assert.deepEqual(LK.pointer(side, docWith(1, 1)), { index: 3, modified: false, total: 4 }, 'duplicates → the newest');
  assert.deepEqual(LK.pointer(side, docWith(5, 6)), { index: 2, modified: false, total: 4 });
  assert.deepEqual(LK.pointer(side, docWith(9, 9, { 'line/r4': 1 })), { index: 4, modified: false, total: 4 });
  assert.deepEqual(LK.pointer(side, docWith(9, 9)), { index: null, modified: true, total: 4 }, 'salts differ');
  assert.deepEqual(LK.pointer(side, docWith(9, 9, { 'line/r4': 2 })), { index: null, modified: true, total: 4 });
  assert.deepEqual(LK.pointer(sideWith([]), docWith(1, 1)), { index: null, modified: false, total: 0 });
  const reordered = sideWith([entry(1, 3, 3, { b: 1, a: 2 })]);
  assert.equal(LK.pointer(reordered, docWith(3, 3, { a: 2, b: 1 })).index, 1, 'salt key order does not matter');
});

test('appendKind: おまかせ, root and scope rerolls append; field dice coalesce; ◀ ▶ and edits do nothing', () => {
  assert.equal(LK.appendKind({ t: 'look.omakase', seed: 1, moodSeed: 2 }), 'append');
  assert.equal(LK.appendKind({ t: 'look.seed', seed: 1 }), 'append');
  assert.equal(LK.appendKind({ t: 'salt.bump', key: 'line/r4' }), 'append');
  assert.equal(LK.appendKind({ t: 'salt.bump', key: 'cut/r3~0' }), 'append');
  assert.equal(LK.appendKind({ t: 'salt.bump', key: 'cut/r3~0:depart' }), 'coalesce');
  assert.equal(LK.appendKind({ t: 'look.restore', seed: 1, moodSeed: 1, salts: {} }), 'none');
  assert.equal(LK.appendKind({ t: 'pin.set', path: 'work:mood', v: 'quietHush', by: 'user' }), 'none');
  assert.equal(LK.appendKind({ t: 'lyrics.set', text: 'a' }), 'none');
  assert.equal(LK.appendKind({ t: 'batch', cmds: [{ t: 'pin.clear', path: 'cut/r3~0:depart' }, { t: 'salt.bump', key: 'cut/r3~0:depart' }] }),
    'coalesce', 'unpin + reroll on a pinned field');
  assert.equal(LK.appendKind(null), 'none');
});

test('record appends with growing numbers and the complete salts map', () => {
  let side = sideWith([]);
  side = LK.recordCmd(side, docWith(1, 1), { t: 'look.omakase', seed: 1, moodSeed: 1 });
  side = LK.recordCmd(side, docWith(2, 3), { t: 'look.omakase', seed: 2, moodSeed: 3 });
  side = LK.recordCmd(side, docWith(2, 3, { 'line/r4': 1 }), { t: 'salt.bump', key: 'line/r4' });
  const list = side.looks.list;
  assert.deepEqual(list.map((e) => e.n), [1, 2, 3]);
  assert.deepEqual(list[2].salts, { 'line/r4': 1 });
  assert.equal(list[2].scope, 'line/r4');
  assert.deepEqual(list[0].label, ['look.omakase', {}]);
  assert.equal(LK.pointer(side, docWith(2, 3, { 'line/r4': 1 })).index, 3);
  assert.equal(LK.record(side, docWith(2, 3, { 'line/r4': 1 }), { kind: 'append' }), side, 'the same look is not added twice');
  assert.equal(LK.recordCmd(side, docWith(7, 7), { t: 'look.restore' }), side, 'none leaves side untouched');
});

test('field dice replace the newest entry only when it was field dice at the same scope', () => {
  let side = LK.recordCmd(sideWith([]), docWith(1, 1), { t: 'look.omakase' });
  side = LK.recordCmd(side, docWith(1, 1, { 'cut/r3~0:arrive': 1 }), { t: 'salt.bump', key: 'cut/r3~0:arrive' });
  side = LK.recordCmd(side, docWith(1, 1, { 'cut/r3~0:arrive': 2 }), { t: 'salt.bump', key: 'cut/r3~0:arrive' });
  side = LK.recordCmd(side, docWith(1, 1, { 'cut/r3~0:arrive': 2, 'cut/r3~0:depart': 1 }), { t: 'salt.bump', key: 'cut/r3~0:depart' });
  assert.equal(side.looks.list.length, 2, 'three dice at one cut make one entry');
  assert.deepEqual(side.looks.list[1].salts, { 'cut/r3~0:arrive': 2, 'cut/r3~0:depart': 1 });
  assert.equal(side.looks.list[1].n, 2);
  side = LK.recordCmd(side, docWith(1, 1, { 'cut/r3~0:arrive': 2, 'cut/r3~0:depart': 1, 'cut/r4~0:dwell': 1 }),
    { t: 'salt.bump', key: 'cut/r4~0:dwell' });
  assert.equal(side.looks.list.length, 3, 'another scope appends');
  side = LK.recordCmd(side, docWith(4, 4), { t: 'look.omakase' });
  side = LK.recordCmd(side, docWith(4, 4, { 'cut/r4~0:dwell': 2 }), { t: 'salt.bump', key: 'cut/r4~0:dwell' });
  assert.equal(side.looks.list.length, 5, 'dice after おまかせ append');
});

test('cap: the oldest non-starred entries go first; starred entries stay', () => {
  let side = sideWith([], 3);
  for (let i = 1; i <= 3; i++) side = LK.recordCmd(side, docWith(i, i), { t: 'look.omakase' });
  side = LK.toggleStar(side, 1);
  assert.equal(side.looks.list[0].star, true);
  for (let i = 4; i <= 7; i++) side = LK.recordCmd(side, docWith(i, i), { t: 'look.omakase' });
  const ns = side.looks.list.map((e) => e.n);
  assert.deepEqual(ns, [1, 5, 6, 7], 'starred #1 kept, 3 newest non-starred kept');
  assert.equal(side.looks.list.filter((e) => !e.star).length, 3);
  assert.equal(LK.toggleStar(side, 99), side, 'unknown entry');
  assert.equal(LK.toggleStar(LK.toggleStar(side, 5), 5).looks.list[1].star, false);
});

test('◀ ▶: neighbours of the pointer; modified → ◀ = newest, ▶ disabled; restore commands', () => {
  const side = sideWith([entry(1, 1, 1), entry(2, 2, 2), entry(3, 3, 3)]);
  assert.equal(LK.prev(side, docWith(2, 2)).n, 1);
  assert.equal(LK.next(side, docWith(2, 2)).n, 3);
  assert.equal(LK.prev(side, docWith(1, 1)), null);
  assert.equal(LK.next(side, docWith(3, 3)), null);
  assert.equal(LK.prev(side, docWith(8, 8)).n, 3, 'modified: ◀ goes to the newest');
  assert.equal(LK.next(side, docWith(8, 8)), null, 'modified: ▶ is disabled');
  assert.deepEqual(LK.restoreCmd(entry(5, 11, 12, { 'line/r1': 1 })),
    { t: 'look.restore', seed: 11, moodSeed: 12, salts: { 'line/r1': 1 } });
  assert.equal(LK.prev(sideWith([]), docWith(1, 1)), null);
});

// --- the diff readout after おまかせ / reroll / undo (§6.7) -----------------------------------------------------------

function diffPlan() {
  return {
    lines: [{ id: 'r1', index: 0 }, { id: 'r2', index: 1 }, { id: 'r3', index: 11 }],
    cuts: [{ key: 'title', line: null }, { key: 'r1~0', line: 'r1' }, { key: 'r2~0', line: 'r2' }, { key: 'r3~0', line: 'r3' },
      { key: 'r3~2', line: 'r3' }],
  };
}
function fakeT() {
  const table = {
    'diff.line': (p) => p.n + '行を振り直し', 'diff.lines': (p) => p.n + '行が変わりました', 'diff.work': () => '全体が変わりました',
    'diff.sep': () => ': ', 'diff.join': () => ', ', 'kind.arrange': () => '構図', 'kind.arrive': () => '入り',
    'kind.depart': () => '抜け', 'kind.lens': () => 'カメラ', 'kind.theme': () => 'テーマ',
  };
  const t = (key, params) => table[key](params || {});
  t.part = (kind, key) => '«' + key + '»';
  return t;
}

test('diffSummary: changed lines by number, part changes by kind in the fixed order; parameters are not listed', () => {
  const entries = [
    { cut: 'r3~2', path: 'cut/r3~2:arrive', from: 'rise', to: 'drop' },
    { cut: 'r3~0', path: 'cut/r3~0:arrange', from: 'column', to: 'bigSmall' },
    { cut: 'r3~2', path: 'cut/r3~2:arrange', from: 'row', to: 'stack' },
    { cut: 'r3~0', path: 'cut/r3~0:arrange.size', from: 0.4, to: 0.6 },
    { cut: 'r3~0', path: 'cut/r3~0:ornament#1', from: 'none', to: 'rule' },
  ];
  const sum = LK.diffSummary(entries, diffPlan());
  assert.deepEqual(sum.lines, [12]);
  assert.deepEqual(sum.items.map((x) => [x.kind, x.from, x.to, x.count]),
    [['arrange', 'column', 'bigSmall', 2], ['arrive', 'rise', 'drop', 1], ['ornament', 'none', 'rule', 1]]);
  const work = LK.diffSummary([{ cut: '*', path: 'work:theme', from: 'dawn', to: 'ink' },
    { cut: 'r1~0', path: 'cut/r1~0:lens', from: 'push', to: 'still' }, { cut: 'r2~0', path: 'cut/r2~0:lens', from: 'a', to: 'b' }], diffPlan());
  assert.deepEqual(work.lines, [1, 2]);
  assert.deepEqual(work.items.map((x) => x.kind), ['theme', 'lens'], 'the theme comes first');
  assert.deepEqual(LK.diffSummary(null, null), { lines: [], items: [] });
});

test('diffText: 「12行を振り直し: 構図 A→B, 入り …」 for a line reroll; changed-line count otherwise; empty when nothing changed', () => {
  const t = fakeT();
  const line = LK.diffSummary([
    { cut: 'r3~0', path: 'cut/r3~0:arrange', from: 'column', to: 'bigSmall' },
    { cut: 'r3~2', path: 'cut/r3~2:arrive', from: 'rise', to: 'drop' },
  ], diffPlan());
  assert.equal(LK.diffText(line, t, { scope: 'line/r3' }), '12行を振り直し: 構図 «column»→«bigSmall», 入り');
  assert.equal(LK.diffText(line, t, { scope: 'work' }), '1行が変わりました: 構図 «column»→«bigSmall», 入り',
    'おまかせ that touched one line does not call it a line reroll');
  const many = LK.diffSummary(['arrange', 'arrive', 'depart', 'lens'].map((k, i) => (
    { cut: i % 2 ? 'r1~0' : 'r2~0', path: (i % 2 ? 'cut/r1~0:' : 'cut/r2~0:') + k, from: 'a' + i, to: 'b' + i })), diffPlan());
  assert.equal(LK.diffText(many, t), '2行が変わりました: 構図 «a0»→«b0», 入り, 抜け …', 'more kinds → …');
  const theme = LK.diffSummary([{ cut: '*', path: 'work:theme', from: 'dawn', to: 'ink' }], diffPlan());
  assert.equal(LK.diffText(theme, t), '全体が変わりました: テーマ «dawn»→«ink»');
  assert.equal(LK.diffText(LK.diffSummary([{ cut: 'r1~0', path: 'cut/r1~0:arrange.size', from: 1, to: 2 }], diffPlan()), t), '');
});

test('diffText reads the real string table (ja and en)', () => {
  const T = MV.use('i18n/t');
  const strings = MV.use('i18n/strings');
  const sum = LK.diffSummary([{ cut: 'r3~0', path: 'cut/r3~0:arrange', from: 'x', to: 'y' }], diffPlan());
  assert.equal(LK.diffText(sum, T.createT('ja', strings), { scope: 'line/r3' }), '12行を振り直し: 構図 x→y');
  assert.equal(LK.diffText(sum, T.createT('en', strings), { scope: 'cut/r3~0' }), 'Line 12 rerolled: Layout x→y');
  assert.equal(LK.diffText(sum, T.createT('en', strings)), '1 line changed: Layout x→y');
});
