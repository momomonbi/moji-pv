/* 文字PVメーカー v2 — original work. Tests for core/reconcile: row ids, offset maps, pin/salt/lock remapping (§4.10). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const R = MV.use('core/reconcile');
const L = MV.use('core/lyrics');
const { stream } = MV.use('core/rng');

const KANA = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';

function sheetOf(srcs, first = 1) {
  return srcs.map((src, i) => ({ id: 'r' + (first + i).toString(36), src }));
}
function nextOf(rows) { return rows.reduce((n, r) => Math.max(n, parseInt(r.id.slice(1), 36) + 1), 1); }
function ids(rows) { return rows.map((r) => r.id); }
function kanaRow(rng, len) {
  let s = '';
  for (let i = 0; i < len; i++) s += KANA[rng.int(0, KANA.length - 1)];
  return s;
}
function randomRow(rng) {
  const s = kanaRow(rng, rng.int(6, 12));
  return rng.chance(0.3) ? s.slice(0, 3) + '/' + s.slice(3) : s;
}
// Every single-character edit of src: insertion, substitution and deletion at every position.
function oneCharEdits(src, ch) {
  const out = [];
  for (let at = 0; at <= src.length; at++) {
    out.push(src.slice(0, at) + ch + src.slice(at));
    if (at < src.length) out.push(src.slice(0, at) + ch + src.slice(at + 1), src.slice(0, at) + src.slice(at + 1));
  }
  return out;
}
function randomSheet(rng, n) {
  const srcs = [];
  for (let i = 0; i < n; i++) srcs.push(rng.chance(0.1) ? '' : randomRow(rng));
  return sheetOf(srcs);
}

test('reconcile: unchanged text keeps every row object', () => {
  const rows = corpus.project('basic').doc.sheet.rows;
  const res = R.reconcile(rows, rows.map((r) => r.src).join('\n'), 14);
  assert.deepEqual(ids(res.rows), ids(rows));
  res.rows.forEach((r, i) => assert.equal(r, rows[i], 'same object'));
  assert.equal(res.next, 14);
  assert.deepEqual([res.removed, res.added, [...res.edited]], [[], [], []]);
  assert.deepEqual([...res.same.keys()], ids(rows));
  assert.deepEqual([...res.same].every(([a, b]) => a === b), true);
});

test('reconcile: the empty text has no rows; CR LF, a lone CR and LF all end a row', () => {
  const rows = sheetOf(['a', 'b']);
  const empty = R.reconcile(rows, '', 3);
  assert.deepEqual(empty.rows, []);
  assert.deepEqual(empty.removed, ['r1', 'r2']);
  const crlf = R.reconcile(rows, 'a\r\nb\r\n', 3);
  assert.deepEqual(crlf.rows.map((r) => r.src), ['a', 'b', '']);
  assert.deepEqual(ids(crlf.rows), ['r1', 'r2', 'r3']);
  const cr = R.reconcile(rows, 'a\rb\r\rc', 3);
  assert.deepEqual(cr.rows.map((r) => r.src), ['a', 'b', '', 'c']);
  assert.deepEqual(R.splitRows('x\r\r\ny\n'), ['x', '', 'y', '']);
  assert.ok(cr.rows.every((r) => !/[\r\n]/.test(r.src)), 'every src is one line');
});

test('property: editing one character keeps every id, in rows of every length', () => {
  const rng = stream('reconcile-edit');
  for (let n = 0; n < 200; n++) {
    const rows = sheetOf(Array.from({ length: rng.int(1, 20) }, () => (rng.chance(0.1) ? '' : kanaRow(rng, rng.int(1, 12)))));
    const i = rng.int(0, rows.length - 1);
    for (const edit of oneCharEdits(rows[i].src, KANA[rng.int(0, KANA.length - 1)])) {
      const srcs = rows.map((r) => r.src);
      srcs[i] = edit;
      if (srcs.join('\n') === '') continue;                   // the empty text has no rows
      const res = R.reconcile(rows, srcs.join('\n'), nextOf(rows));
      assert.deepEqual(ids(res.rows), ids(rows), JSON.stringify(srcs));
      assert.deepEqual([res.added, res.removed], [[], []]);
    }
  }
});

test('short rows keep their id by padded-bigram Dice when the gap is not one-to-one', () => {
  // A new row typed next to the edited one: rule 3's similarity decides which row keeps the id.
  const cases = [['届くまで', '届けまで'], ['届くまで', '届まで'], ['あいう', 'あう'], ['あいう', 'あえう'], ['ねえ', 'ねえよ']];
  for (const [a, b] of cases) {
    const rows = sheetOf(['始まりの行', a, '終わりの行']);
    const res = R.reconcile(rows, ['始まりの行', b, 'まったく新しい行', '終わりの行'].join('\n'), 4);
    assert.deepEqual(ids(res.rows), ['r1', 'r2', 'r4', 'r3'], a + ' → ' + b);
    assert.deepEqual([...res.edited], ['r2']);
  }
  const rows = sheetOf(['始まりの行', 'ねえ', '終わりの行']);
  const below = R.reconcile(rows, ['始まりの行', 'ねぇ', 'まったく新しい行', '終わりの行'].join('\n'), 4);
  assert.deepEqual(ids(below.rows), ['r1', 'r4', 'r5', 'r3'], 'Dice 1/3: a two-character row with a new character');
});

test('a gap with one old and one new row pairs them whatever their similarity (an edit in place)', () => {
  const rows = sheetOf(['始まりの行', 'まるで違う行です', '終わりの行']);
  const res = R.reconcile(rows, ['始まりの行', 'ぜんぜんべつのもの', '終わりの行'].join('\n'), 4);
  assert.deepEqual(ids(res.rows), ['r1', 'r2', 'r3']);
  assert.deepEqual([...res.edited], ['r2']);
  assert.deepEqual([res.added, res.removed], [[], []]);
});

test('property: inserting a row adds exactly one id; the others keep theirs in order', () => {
  const rng = stream('reconcile-insert');
  for (let n = 0; n < 300; n++) {
    const rows = randomSheet(rng, rng.int(0, 30));
    const srcs = rows.map((r) => r.src);
    const at = rng.int(0, srcs.length);
    srcs.splice(at, 0, randomRow(rng));
    const next = nextOf(rows);
    const res = R.reconcile(rows, srcs.join('\n'), next);
    assert.deepEqual(res.added, ['r' + next.toString(36)]);
    assert.equal(res.next, next + 1);
    assert.deepEqual(ids(res.rows).filter((id) => id !== res.added[0]), ids(rows));
    assert.equal(ids(res.rows)[at], res.added[0]);
  }
});

test('property: swapping two unique rows keeps both ids', () => {
  const rng = stream('reconcile-swap');
  for (let n = 0; n < 300; n++) {
    const rows = sheetOf(Array.from({ length: rng.int(2, 25) }, () => randomRow(rng)));
    const i = rng.int(0, rows.length - 1);
    let j = rng.int(0, rows.length - 1);
    if (i === j) j = (i + 1) % rows.length;
    const order = rows.slice();
    [order[i], order[j]] = [order[j], order[i]];
    const res = R.reconcile(rows, order.map((r) => r.src).join('\n'), nextOf(rows));
    assert.deepEqual(ids(res.rows), ids(order));
  }
});

test('swapping two look-alike unique rows keeps both ids with their text', () => {
  const srcs = ['[ti:夜明け]', '夜明けの街を走る', '遠くの空に', '君の声が', '風に揺れる', '夜明けの街を歩く', '最後の行'];
  const swapped = srcs.slice();
  [swapped[1], swapped[5]] = [swapped[5], swapped[1]];
  const res = R.reconcile(sheetOf(srcs), swapped.join('\n'), 8);
  assert.deepEqual(ids(res.rows), ['r1', 'r6', 'r3', 'r4', 'r5', 'r2', 'r7']);
  assert.deepEqual([...res.edited], [], 'moved, not edited');
  assert.deepEqual([res.added, res.removed], [[], []]);
});

test('property: swapping or moving a row with a look-alike twin keeps every id with its text', () => {
  const rng = stream('reconcile-lookalike');
  for (let n = 0; n < 300; n++) {
    const base = kanaRow(rng, rng.int(4, 12));
    const at = rng.int(0, base.length - 1);
    const twin = base.slice(0, at) + (base[at] === 'ん' ? 'あ' : 'ん') + base.slice(at + 1);   // Dice ≥ 0.5
    const srcs = Array.from({ length: rng.int(1, 20) }, () => kanaRow(rng, rng.int(6, 12)));
    srcs.splice(rng.int(0, srcs.length), 0, base);
    srcs.splice(rng.int(0, srcs.length), 0, twin);
    if (new Set(srcs).size !== srcs.length) continue;
    const rows = sheetOf(srcs);
    const order = rows.slice();
    const a = srcs.indexOf(base), b = srcs.indexOf(twin);
    if (rng.chance(0.5)) [order[a], order[b]] = [order[b], order[a]];
    else order.splice(rng.int(0, order.length - 1), 0, order.splice(rng.pick([a, b]), 1)[0]);
    const res = R.reconcile(rows, order.map((r) => r.src).join('\n'), nextOf(rows));
    assert.deepEqual(ids(res.rows), ids(order), JSON.stringify(order.map((r) => r.src)));
    assert.deepEqual([...res.edited], []);
  }
});

test('property: duplicated chorus rows keep their ids in order', () => {
  const rng = stream('reconcile-chorus');
  for (let n = 0; n < 200; n++) {
    const chorus = randomRow(rng);
    const srcs = [];
    for (let i = 0; i < 20; i++) srcs.push(rng.chance(0.3) ? chorus : randomRow(rng));
    const rows = sheetOf(srcs);
    const chorusIds = ids(rows.filter((r) => r.src === chorus));
    const edited = srcs.slice();
    const verses = edited.map((s, i) => i).filter((i) => edited[i] !== chorus);
    if (rng.chance(0.5) && verses.length) edited.splice(rng.pick(verses), 1);
    else edited.splice(rng.int(0, edited.length), 0, randomRow(rng));
    const res = R.reconcile(rows, edited.join('\n'), nextOf(rows));
    assert.deepEqual(ids(res.rows.filter((r) => r.src === chorus)), chorusIds);
  }
});

test('property: ids are never reused across a chain of edits', () => {
  const rng = stream('reconcile-chain');
  let rows = randomSheet(rng, 10);
  let next = nextOf(rows);
  const everRemoved = new Set();
  for (let step = 0; step < 400; step++) {
    const srcs = rows.map((r) => r.src);
    const op = rng.int(0, 3);
    if (op === 0 || srcs.length === 0) srcs.splice(rng.int(0, srcs.length), 0, randomRow(rng));
    else if (op === 1) srcs.splice(rng.int(0, srcs.length - 1), 1);
    else if (op === 2) srcs[rng.int(0, srcs.length - 1)] = randomRow(rng);
    else srcs.reverse();
    const res = R.reconcile(rows, srcs.join('\n'), next);
    for (const id of res.added) assert.ok(!everRemoved.has(id) && parseInt(id.slice(1), 36) >= next, id);
    for (const id of res.removed) everRemoved.add(id);
    assert.ok(res.next >= next);
    assert.equal(new Set(ids(res.rows)).size, res.rows.length, 'ids unique');
    rows = res.rows;
    next = res.next;
  }
});

test('reconcile: keys ignore marks, stamps, spacing and Latin case; edited means the plain text changed', () => {
  const rows = sheetOf(['Hello world', '夜明けの街', '[00:01.00]君の名前', '# サビ', '[ti:T]', '']);
  const res = R.reconcile(rows, ['HELLO   World', '夜明けの/*街*', '君の名前!', '#サビ', '[ti:Other]', '  '].join('\n'), 7);
  assert.deepEqual(ids(res.rows), ids(rows));
  assert.deepEqual([...res.edited], ['r1'], 'only the row whose plain text differs');
  assert.equal(R.rowKey('Ｈｅｌｌｏ\u3000Ｗｏｒｌｄ'), 'helloworld', 'NFKC and Latin lower case');
  assert.equal(R.rowKey('# Aメロ'), '#Aメロ');
  assert.equal(R.rowKey('[AR:x]'), '@ar');
  assert.equal(R.rowKey('   '), '');
});

test('reconcile: similar rows pair inside a gap only with Dice ≥ 0.5', () => {
  const rows = sheetOf(['始発のホームに白い息', 'まるで違う行です', '最後の行']);
  const res = R.reconcile(rows, ['始発のホームで白い息', 'ぜんぜんべつのもの', '最後の行'].join('\n'), 4);
  assert.deepEqual(ids(res.rows), ['r1', 'r4', 'r3']);
  assert.deepEqual([...res.edited], ['r1']);
  assert.deepEqual(res.removed, ['r2']);
  assert.deepEqual(res.added, ['r4']);
});

test('reconcile info reports plain text and sung occurrences per row', () => {
  const rows = sheetOf(['[00:01.00][00:20.00]a/b', '# c', 'x']);
  const res = R.reconcile(rows, ['[00:01.00]ab', '# c', '[00:05.00]'].join('\n'), 4);
  assert.deepEqual(res.info.before.get('r1'), { text: 'ab', lines: 2 });
  assert.deepEqual(res.info.after.get('r1'), { text: 'ab', lines: 1 });
  assert.deepEqual(res.info.after.get('r2'), { text: '', lines: 0 });
  assert.equal(res.info.after.get(res.rows[2].id).lines, 0, 'a stamp without text is not a line');
  assert.deepEqual([...R.rowInfo(rows).keys()], ['r1', 'r2', 'r3']);
});

test('offsetMap: kept characters, deletions, ends and grapheme snapping', () => {
  const same = R.offsetMap('夜明けの街', '夜明けの街');
  assert.deepEqual([0, 1, 4, 5].map(same), [0, 1, 4, 5]);
  const ins = R.offsetMap('夜明けの街を走る', '夜明けの大きな街を走る');
  assert.deepEqual([0, 4, 5, 8].map(ins), [0, 7, 8, 11]);
  const del = R.offsetMap('abcd', 'axd');
  assert.deepEqual([0, 1, 2, 3, 4].map(del), [0, 2, 2, 2, 3], 'deleted characters go to the next kept one');
  const front = R.offsetMap('xab', 'ab');
  assert.deepEqual([0, 1, 2, 3].map(front), [0, 0, 1, 2], '0 always maps to 0');
  const tail = R.offsetMap('abcd', 'ab');
  assert.deepEqual([2, 3, 4].map(tail), [2, 2, 2], 'old length → new length');
  const snap = R.offsetMap('a\u0301b', 'e\u0301b');
  assert.equal(snap(1), 0, 'snapped to the start of the grapheme');
  assert.equal(snap(2), 2);
  assert.equal(R.offsetMap('😀x', '😀yx')(2), 3);
  assert.equal(R.offsetMap('abc', 'abc')(99), 3, 'out-of-range offsets clamp');
});

test('lcsPairs agrees with a dynamic-programming LCS length', () => {
  const rng = stream('lcs');
  for (let n = 0; n < 600; n++) {
    const letters = n < 300 ? 4 : 30;                          // many repeats, then values missing on one side
    const a = Int32Array.from({ length: rng.int(0, n < 300 ? 25 : 70) }, () => rng.int(0, letters));
    const b = Int32Array.from({ length: rng.int(0, n < 300 ? 25 : 70) }, () => rng.int(0, letters));
    const pairs = R.lcsPairs(a, b);
    const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) {
      for (let j = b.length - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    assert.equal(pairs.length, dp[0][0]);
    pairs.forEach(([i, j], k) => {
      assert.equal(a[i], b[j]);
      if (k) assert.ok(i > pairs[k - 1][0] && j > pairs[k - 1][1]);
    });
  }
});

test('lcsPairs handles long reorders and full replacements in linear space', () => {
  const n = 3000;
  const a = Int32Array.from({ length: n }, (_, i) => i);
  const t0 = process.hrtime.bigint();
  assert.equal(R.lcsPairs(a, a.slice().reverse()).length, 1, 'a reversal keeps one element');
  assert.deepEqual(R.lcsPairs(a, Int32Array.from({ length: n }, (_, i) => n + i)), [], 'nothing in common');
  const moved = Array.from(a);
  moved.splice(10, 0, ...moved.splice(2500, 400));
  assert.equal(R.lcsPairs(a, Int32Array.from(moved)).length, n - 400, 'a block of 400 moved up');
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 3000, `${ms.toFixed(0)} ms`);
});

// ---- remapKeyed -------------------------------------------------------------------------------------------------

function remapAfter(rows, newText, keyed) {
  const res = R.reconcile(rows, newText, nextOf(rows));
  return { res, out: R.remapKeyed(keyed, res.info.before, res.info.after, res.edited) };
}

test('remap: removed lines lose their pins, salts, locks and gap pins', () => {
  const rows = sheetOf(['夜明けの/街を走る', '[00:10.00][00:40.00]君の名前を呼ぶ', 'まだ遠い空の']);
  const keyed = {
    pins: {
      'work:mood': { v: 'x', by: 'user' }, 'line/r1:arrive': { v: 'a', by: 'user' },
      'cut/r1~4:depart': { v: 'b', by: 'user', sig: '街を走る' }, 'line/r2:start': { v: 10, by: 'tap' },
      'line/r2.1:start': { v: 41, by: 'tap' }, 'cut/r2.1~0:lens': { v: 'c', by: 'user', sig: '君の名前を呼ぶ' },
      'cut/gap/r2.1:ground': { v: 'd', by: 'user', sig: '' }, 'line/r3:arrive': { v: 'e', by: 'user' },
    },
    salts: { 'line/r1': 1, 'cut/r1~4:depart': 2, 'line/r2.1': 3, 'cut/r3~0': 1 },
    locks: { r1: { n: 1 }, 'r2.1': { n: 2 }, r3: { n: 3 } },
  };
  const { out } = remapAfter(rows, ['[00:10.00]君の名前を呼ぶ', 'まだ遠い空の'].join('\n'), keyed);
  assert.deepEqual(Object.keys(out.pins).sort(), ['line/r2:start', 'line/r3:arrive', 'work:mood']);
  assert.deepEqual(out.salts, { 'cut/r3~0': 1 });
  assert.deepEqual(out.locks, { r3: { n: 3 } });
  assert.equal(out.pins['line/r3:arrive'], keyed.pins['line/r3:arrive'], 'survivors are the same objects');
});

test('remap: nothing to do returns the same maps', () => {
  const rows = sheetOf(['夜明けの/街を走る', 'まだ遠い空の']);
  const keyed = { pins: { 'cut/r1~4:depart': { v: 'b', by: 'user', sig: '街を走る' } }, salts: { 'line/r2': 1 }, locks: {} };
  const { out } = remapAfter(rows, ['夜明けの/*街*を走る', 'まだ遠い空の', '新しい行'].join('\n'), keyed);
  assert.equal(out.pins, keyed.pins);
  assert.equal(out.salts, keyed.salts);
  assert.equal(out.locks, keyed.locks);
});

test('remap: cut keys of edited lines follow the offset map; collisions keep the smaller offset', () => {
  const rows = sheetOf(['夜明けの街を走る', 'abcdef']);
  const keyed = {
    pins: {
      'cut/r1~4:arrive': { v: 'a', by: 'user', sig: '街を走る' },
      'cut/r1~4:el.text.nudge': { v: { dx: 1, dy: 0, rot: 0, s: 1 }, by: 'user', sig: '街を走る' },
      'cut/r2~2:arrive': { v: 'c2', by: 'user', sig: 'cdef' }, 'cut/r2~3:arrive': { v: 'c3', by: 'user', sig: 'def' },
      'cut/r2~3:lens': { v: 'l3', by: 'user', sig: 'def' }, 'cut/r2~99:lens': { v: 'far', by: 'user', sig: '?' },
    },
    salts: { 'cut/r1~4': 1, 'cut/r1~4:depart': 2, 'cut/r2~3': 5 },
    locks: {},
  };
  const { out } = remapAfter(rows, ['夜明けの大きな街を走る', 'abef'].join('\n'), keyed);
  assert.deepEqual(out.pins['cut/r1~7:arrive'], keyed.pins['cut/r1~4:arrive'], 'sig kept as it was');
  assert.ok(out.pins['cut/r1~7:el.text.nudge']);
  assert.deepEqual(out.pins['cut/r2~2:arrive'].v, 'c2', 'r2~2 and r2~3 collide at 2: the smaller original wins');
  assert.deepEqual(out.pins['cut/r2~2:lens'].v, 'l3', 'other slots do not collide');
  assert.ok(out.pins['cut/r2~99:lens'], 'an offset beyond the old text is left alone');
  assert.equal(Object.keys(out.pins).length, 5);
  assert.deepEqual(out.salts, { 'cut/r1~7': 1, 'cut/r1~7:depart': 2, 'cut/r2~2': 5 });
});

test('remap: split pins are mapped and deduplicated; a split that no longer starts at 0 is removed', () => {
  const rows = sheetOf(['夜明けの街を走る', 'abcdef', 'ghij']);
  const keyed = {
    pins: {
      'line/r1:split': { v: [0, 4], by: 'user' }, 'line/r2:split': { v: [0, 2, 3, 5], by: 'lock' },
      'line/r3:split': { v: 'none', by: 'user' },
    },
    salts: {}, locks: {},
  };
  const { out } = remapAfter(rows, ['夜明けの大きな街を走る', 'abef', 'gxhij'].join('\n'), keyed);
  assert.deepEqual(out.pins['line/r1:split'], { v: [0, 7], by: 'user' });
  assert.deepEqual(out.pins['line/r2:split'], { v: [0, 2, 3], by: 'lock' }, '2 and 3 collide; 5 → 3');
  assert.equal(out.pins['line/r3:split'], keyed.pins['line/r3:split'], "'none' is untouched");
  const lockSplit = { pins: { 'line/r1:split': { v: [0, 3], by: 'lock' } }, salts: {}, locks: {} };
  const trimmed = remapAfter(sheetOf(['abcdef']), 'abc', lockSplit);
  assert.deepEqual(trimmed.out.pins['line/r1:split'].v, [0], 'an offset at the new end is dropped');
});

// DESIGN §9.1: parse + reconcile of 300 rows < 5 ms in Node. Measured for the two ends of the range: a few local edits
// (the lyric editor's case) and a full replacement (pasting new lyrics over old ones). The assertion keeps a ×3 margin
// for shared CI machines.
function median(run) {
  for (let i = 0; i < 5; i++) run();
  const times = [];
  for (let i = 0; i < 9; i++) {
    const t0 = process.hrtime.bigint();
    run();
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  return times[4];
}

test('parse + reconcile + remap of 300 rows is fast: local edits and a full replacement', () => {
  const rng = stream('reconcile-perf');
  const rows = sheetOf(Array.from({ length: 300 }, () => (rng.chance(0.1) ? '' : randomRow(rng))));
  const srcs = rows.map((r) => r.src);
  srcs[150] = srcs[150] + 'ね';
  srcs.splice(40, 1);
  srcs.splice(200, 0, randomRow(rng));
  const local = srcs.join('\n');
  const fresh = Array.from({ length: 300 }, () => (rng.chance(0.1) ? '' : randomRow(rng))).join('\n');
  const pins = {};
  for (let i = 0; i < 300; i += 3) pins['cut/' + rows[i].id + '~3:arrive'] = { v: 'x', by: 'user', sig: 's' };
  const runWith = (text) => () => {
    const sheet = L.parseSheet(rows);
    const res = R.reconcile(rows, text, 301);
    R.remapKeyed({ pins, salts: {}, locks: {} }, res.info.before, res.info.after, res.edited);
    return sheet;
  };
  const edits = median(runWith(local)), replace = median(runWith(fresh));
  assert.ok(edits < 5 * 3, `local edits: median ${edits.toFixed(2)} ms (budget 5 ms, CI margin ×3)`);
  assert.ok(replace < 5 * 3, `full replacement: median ${replace.toFixed(2)} ms (budget 5 ms, CI margin ×3)`);
});
