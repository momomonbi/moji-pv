/* 文字PVメーカー v2 — original work. Tests for core/commands: every reducer, identity, remaps, undo/replay properties, v2.1 scope rules. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { throwsCode, deepEqual } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const C = MV.use('core/commands');
const D = MV.use('core/doc');
const L = MV.use('core/lyrics');
const { createStore } = MV.use('core/store');
const { hashJSON } = MV.use('core/hash');
const { stream } = MV.use('core/rng');

const reduce = C.reduce;
function fresh(name) { return corpus.project(name).doc; }
function textOf(doc) { return doc.sheet.rows.map((r) => r.src).join('\n'); }

// Top-level document keys each command may replace; every other key must keep its identity (structural sharing).
const MAY_CHANGE = {
  'lyrics.set': ['sheet', 'pins', 'salts', 'locks'], 'lyrics.row': ['sheet', 'pins', 'salts', 'locks'],
  'lyrics.move': ['sheet'], 'meta.set': ['sheet'], 'pin.set': ['pins'], 'pin.clear': ['pins'], 'pin.clearUnder': ['pins'],
  'pin.promote': ['pins'], 'pin.copy': ['pins'], 'salt.bump': ['salts'], 'look.omakase': ['look'], 'look.seed': ['look'],
  'look.restore': ['look', 'salts'], 'look.set': ['look'], 'lock.set': ['pins', 'locks'], 'lock.clear': ['pins', 'locks'],
  'filter.set': ['filters'], 'time.shift': ['pins'], 'time.tap': ['pins'], 'timing.set': ['timing'], 'song.set': ['song'],
  'song.clear': ['song'], 'song.info': ['song'], 'output.set': ['output'],
  'material.put': ['materials'], 'material.meta': ['materials'], 'material.remove': ['materials', 'pins'],
  'media.put': ['media'], 'media.meta': ['media'], 'media.move': ['media'], 'media.remove': ['media', 'pins'],
  'media.relink': ['media', 'pins', 'materials'],
};

function checkSharing(before, after, cmd) {
  const types = cmd.t === 'batch' ? cmd.cmds.map((c) => c.t) : [cmd.t];
  const allowed = new Set([].concat(...types.map((t) => MAY_CHANGE[t])));
  for (const k of Object.keys(before)) {
    if (!allowed.has(k)) assert.equal(after[k], before[k], cmd.t + ' must not replace ' + k);
  }
}

test('unknown commands and bad payloads throw CommandError', () => {
  const doc = fresh('basic');
  throwsCode(() => reduce(doc, { t: 'nope' }), 'unknown');
  throwsCode(() => reduce(doc, { t: 'toString' }), 'unknown');
  throwsCode(() => reduce(doc, {}), 'payload');
  throwsCode(() => reduce(doc, null), 'payload');
  const bad = [
    { t: 'lyrics.set', text: 3 }, { t: 'lyrics.row', rowId: 'zz', src: 'x' }, { t: 'lyrics.row', rowId: 'r4', src: 'a\nb' },
    { t: 'lyrics.move', rowIds: [], beforeRowId: null }, { t: 'lyrics.move', rowIds: ['r4'], beforeRowId: 'r4' },
    { t: 'meta.set', title: 5 }, { t: 'pin.set', path: 'nowhere', v: 1, by: 'user' },
    { t: 'pin.set', path: 'work:mood', v: 1, by: 'robot' }, { t: 'pin.set', path: 'cut/r4~0:arrive', v: 'x', by: 'user' },
    { t: 'pin.set', path: 'work:mood', by: 'user' }, { t: 'pin.set', path: 'work:x', v: NaN, by: 'user' },
    { t: 'pin.clearUnder', scope: 'work:mood' }, { t: 'pin.promote', path: 'work:mood', to: 'work' },
    { t: 'pin.promote', path: 'line/r4:start', to: 'work' }, { t: 'pin.promote', path: 'cut/title:arrive', to: 'line' },
    { t: 'pin.copy', from: 'line/r4', to: ['cut/r5~0'], sigs: {} }, { t: 'salt.bump', key: 'nope' },
    { t: 'look.omakase', seed: -1, moodSeed: 1 }, { t: 'look.seed', seed: 1.5 }, { t: 'look.set', key: 'aspect', v: '2:1' },
    { t: 'look.restore', seed: 1, moodSeed: 1, salts: { 'line/r4': 0 } },
    { t: 'lock.set', lineId: 'r4', pins: { 'line/r5:split': { v: [0], by: 'lock' } } },
    { t: 'lock.set', lineId: 'r4', pins: { 'line/r4:split': { v: [0], by: 'user' } } },
    { t: 'filter.set', kind: 'mood', only: null, deny: null },
    { t: 'filter.set', kind: 'seam', only: 'hardCut', deny: null }, { t: 'time.shift', lineIds: ['r4'], delta: 1, base: {} },
    { t: 'time.tap', marks: [{ lineId: 'r4' }] }, { t: 'timing.set', key: 'lead', v: -1 }, { t: 'timing.set', key: 'speed', v: 1 },
    { t: 'output.set', key: 'fps', v: 25 }, { t: 'song.set', song: { name: 'x' } }, { t: 'song.info', info: 3 },
    { t: 'batch', cmds: 'no' },
  ];
  for (const cmd of bad) throwsCode(() => reduce(doc, cmd), 'payload', JSON.stringify(cmd));
  throwsCode(() => reduce(Object.assign({}, doc, { song: null }), { t: 'song.info', info: {} }), 'payload');
});

test('every command returns the same doc when nothing changes', () => {
  const doc = fresh('vertical');
  const same = [
    { t: 'lyrics.set', text: textOf(doc) }, { t: 'lyrics.row', rowId: 'r4', src: doc.sheet.rows[3].src },
    { t: 'lyrics.move', rowIds: ['r4'], beforeRowId: 'r5' }, { t: 'meta.set', title: '紙ひこうきの朝' },
    { t: 'meta.set', artist: null }, { t: 'meta.set' }, { t: 'pin.set', path: 'work:mood', v: 'quietHush', by: 'user' },
    { t: 'pin.clear', path: 'work:nothing' }, { t: 'pin.clearUnder', scope: 'line/r9' },
    { t: 'pin.clearUnder', scope: 'line/r6', by: 'lock' }, { t: 'pin.promote', path: 'cut/r4~0:arrive', to: 'line' },
    { t: 'pin.copy', from: 'line/r9', to: ['line/r3'], sigs: {} },
    { t: 'look.omakase', seed: doc.look.seed, moodSeed: doc.look.moodSeed },
    { t: 'look.seed', seed: doc.look.seed }, { t: 'look.set', key: 'aspect', v: doc.look.aspect },
    { t: 'look.restore', seed: doc.look.seed, moodSeed: doc.look.moodSeed, salts: JSON.parse(JSON.stringify(doc.salts)) },
    { t: 'lock.clear', lineId: 'r4' }, { t: 'filter.set', kind: 'lens', only: null, deny: null },
    { t: 'filter.set', kind: 'seam', only: ['hardCut'], deny: null },
    { t: 'time.tap', marks: [] }, { t: 'time.tap', marks: [{ lineId: 'r5', start: 12.5 }] }, { t: 'batch', cmds: [] },
    { t: 'timing.set', key: 'snap', v: doc.timing.snap }, { t: 'output.set', key: 'range', v: null },
    { t: 'song.clear' }, { t: 'batch', cmds: [{ t: 'pin.clear', path: 'x' }] },
  ];
  for (const cmd of same) assert.equal(reduce(doc, cmd), doc, JSON.stringify(cmd));
  const locked = reduce(doc, { t: 'lock.set', lineId: 'r6', pins: lockPinsOf(doc, 'r6'), n: 7 });
  assert.equal(locked, doc, 'lock.set with the current lock pins');
  const withSong = Object.assign({}, doc, { song: corpus.songDigest() });
  assert.equal(reduce(withSong, { t: 'song.set', song: JSON.parse(JSON.stringify(withSong.song)) }), withSong);
  assert.equal(reduce(withSong, { t: 'song.info', info: null }), withSong);
});

function lockPinsOf(doc, lineId) {
  const out = {};
  for (const [path, pin] of Object.entries(doc.pins)) {
    if (pin.by === 'lock' && (path.startsWith('line/' + lineId + ':') || path.startsWith('cut/' + lineId + '~'))) out[path] = pin;
  }
  return out;
}

test('lyrics.set: ids through reconcile; pins, salts and locks remapped or deleted (§4.10.3)', () => {
  const doc = fresh('vertical');
  const srcs = doc.sheet.rows.map((r) => r.src);
  srcs[5] = '影ぼうしが/大きく背のびをする';      // r6 (locked) gains 3 characters before 背
  srcs.splice(2, 1);                              // r3 removed
  srcs.push('新しい/最後の行');
  const out = reduce(doc, { t: 'lyrics.set', text: srcs.join('\n') });
  assert.deepEqual(out.sheet.rows.map((r) => r.id), ['r1', 'r2', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'ra', 'rb']);
  assert.equal(out.sheet.next, 12);
  assert.ok(!Object.keys(out.pins).some((p) => p.includes('r3')), 'pins of the removed line are gone');
  assert.deepEqual(out.salts, { 'line/r5': 2 });
  assert.deepEqual(out.pins['cut/r6~8:arrange'], doc.pins['cut/r6~5:arrange'], 'moved by the offset map, sig kept');
  assert.deepEqual(out.pins['line/r6:split'], { v: [0, 8], by: 'lock' });
  assert.equal(out.pins['cut/r6~0:arrange'], doc.pins['cut/r6~0:arrange']);
  assert.equal(out.locks, doc.locks);
  assert.deepEqual(D.validate(out), []);
  checkSharing(doc, out, { t: 'lyrics.set' });
  const gone = reduce(out, { t: 'lyrics.set', text: out.sheet.rows.filter((r) => r.id !== 'r6').map((r) => r.src).join('\n') });
  assert.deepEqual(gone.locks, {}, 'removing a locked line removes its lock');
  assert.ok(!Object.keys(gone.pins).some((p) => p.includes('r6')));
  assert.deepEqual(reduce(doc, { t: 'lyrics.set', text: '' }).sheet.rows, [], 'the empty text has no rows');
});

test('lyrics.set: a lone CR ends a row too, so the document stays valid', () => {
  const doc = fresh('basic');
  const out = reduce(doc, { t: 'lyrics.set', text: 'いち\rに\r\nさん\rよん' });
  assert.deepEqual(out.sheet.rows.map((r) => r.src), ['いち', 'に', 'さん', 'よん']);
  assert.deepEqual(D.validate(out), []);
  assert.equal(reduce(doc, { t: 'lyrics.set', text: textOf(doc).replace(/\n/g, '\r') }), doc,
    'the same rows with other line breaks change nothing');
});

test('lyrics.set: swapping two look-alike rows moves their lock, tap times and cut pins with the text', () => {
  const srcs = ['[ti:夜明け]', '夜明けの街を/走る', '遠くの空に', '君の声が', '風に揺れる', '夜明けの街を/歩く', '最後の行'];
  let doc = reduce(D.defaultDoc(), { t: 'lyrics.set', text: srcs.join('\n') });
  assert.deepEqual(doc.sheet.rows.map((r) => r.id), ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
  doc = reduce(doc, { t: 'time.tap', marks: [{ lineId: 'r2', start: 10, end: 13 }, { lineId: 'r6', start: 40 }] });
  doc = reduce(doc, { t: 'lock.set', lineId: 'r2', n: 3, pins: {
    'cut/r2~6:arrange': { v: 'stairStep', by: 'lock', sig: '走る' }, 'line/r2:split': { v: [0, 6], by: 'lock' } } });
  doc = reduce(doc, { t: 'pin.set', path: 'cut/r6~6:arrive', v: 'inkRise', by: 'user', sig: '歩く' });
  const swapped = srcs.slice();
  [swapped[1], swapped[5]] = [swapped[5], swapped[1]];
  const out = reduce(doc, { t: 'lyrics.set', text: swapped.join('\n') });
  assert.deepEqual(out.sheet.rows.map((r) => r.id + ' ' + r.src), ['r1 [ti:夜明け]', 'r6 夜明けの街を/歩く', 'r3 遠くの空に',
    'r4 君の声が', 'r5 風に揺れる', 'r2 夜明けの街を/走る', 'r7 最後の行']);
  assert.equal(out.pins, doc.pins, 'nothing to remap: each id still has its own text');
  assert.equal(out.locks, doc.locks);
  assert.deepEqual([out.pins['line/r2:start'].v, out.pins['line/r2:end'].v, out.pins['line/r6:start'].v], [10, 13, 40]);
  assert.deepEqual(D.validate(out), []);
});

test('lyrics.set: stamp occurrences follow their index', () => {
  let doc = fresh('lrc');
  doc = reduce(doc, { t: 'pin.set', path: 'line/r8.1:arrive', v: 'x', by: 'user' });
  doc = reduce(doc, { t: 'pin.set', path: 'line/r8:arrive', v: 'y', by: 'user' });
  doc = reduce(doc, { t: 'lock.set', lineId: 'r8.1', pins: {}, n: 1 });
  const edited = reduce(doc, { t: 'lyrics.row', rowId: 'r8', src: '[00:22.00]飛ばせ/*紙ひこうき*/空の果てまで' });
  assert.equal(edited.pins['line/r8.1:arrive'], undefined, 'the second stamp is gone, so is r8.1');
  assert.deepEqual(edited.locks, {});
  assert.equal(edited.pins['line/r8:arrive'].v, 'y');
  const kept = reduce(doc, { t: 'lyrics.row', rowId: 'r8', src: '[00:22.00][00:49.00]飛ばせ/空の果てまで' });
  assert.equal(kept.pins['line/r8.1:arrive'].v, 'x', 'r8.1 stays while the row has two stamps');
});

test('lyrics.row replaces one row and remaps its cut keys', () => {
  const doc = reduce(fresh('basic'), { t: 'pin.set', path: 'cut/r4~7:arrive', v: 'a', by: 'user', sig: '白い息' });
  const out = reduce(doc, { t: 'lyrics.row', rowId: 'r4', src: '始発の駅のホームに/白い息' });
  assert.equal(out.sheet.rows[3].id, 'r4');
  assert.equal(out.sheet.rows[3].src, '始発の駅のホームに/白い息');
  assert.equal(out.sheet.next, doc.sheet.next);
  assert.deepEqual(Object.keys(out.pins), ['cut/r4~9:arrive']);
  assert.equal(out.sheet.rows[4], doc.sheet.rows[4], 'other rows keep their objects');
  const marksOnly = reduce(doc, { t: 'lyrics.row', rowId: 'r4', src: '始発のホームに/*白い息*!' });
  assert.equal(marksOnly.pins, doc.pins, 'marks only: nothing to remap');
});

test('lyrics.move keeps the moved block in order', () => {
  const doc = fresh('basic');
  const ids = (d) => d.sheet.rows.map((r) => r.id);
  assert.deepEqual(ids(reduce(doc, { t: 'lyrics.move', rowIds: ['r6', 'r5'], beforeRowId: 'r4' })).slice(3, 6), ['r5', 'r6', 'r4']);
  assert.deepEqual(ids(reduce(doc, { t: 'lyrics.move', rowIds: ['r1'], beforeRowId: null })).slice(-2), ['rd', 'r1']);
  const moved = reduce(doc, { t: 'lyrics.move', rowIds: ['rd'], beforeRowId: 'r4' });
  assert.equal(moved.pins, doc.pins);
  assert.equal(moved.sheet.next, doc.sheet.next);
});

test('meta.set rewrites, inserts at the top, and removes [ti:] / [ar:] rows', () => {
  const doc = fresh('basic');
  const renamed = reduce(doc, { t: 'meta.set', title: '新しい朝', artist: null });
  assert.deepEqual(renamed.sheet.rows.slice(0, 2), [{ id: 'r1', src: '[ti:新しい朝]' }, { id: 'r3', src: '# Aメロ' }]);
  const empty = reduce(fresh('basic'), { t: 'lyrics.set', text: 'いち\nに' });
  const added = reduce(empty, { t: 'meta.set', artist: '歌い手', title: '題' });
  assert.deepEqual(added.sheet.rows.map((r) => r.src), ['[ti:題]', '[ar:歌い手]', 'いち', 'に']);
  assert.equal(added.sheet.next, empty.sheet.next + 2);
  assert.deepEqual(L.parseSheet(added.sheet.rows).meta, { title: '題', artist: '歌い手' });
  const onlyArtist = reduce(empty, { t: 'meta.set', artist: 'A\nB ' });
  assert.equal(onlyArtist.sheet.rows[0].src, '[ar:A B]', 'line breaks become spaces');
  assert.deepEqual(D.validate(added), []);
});

test('pin.set, pin.clear, pin.clearUnder', () => {
  const doc = fresh('vertical');
  const set = reduce(doc, { t: 'pin.set', path: 'cut/r4~0:arrive', v: 'inkRise', by: 'ai', sig: '昨日のため息を' });
  assert.deepEqual(set.pins['cut/r4~0:arrive'], { v: 'inkRise', by: 'ai', sig: '昨日のため息を' });
  const line = reduce(doc, { t: 'pin.set', path: 'line/r4:arrive', v: 'x', by: 'user', sig: 'ignored' });
  assert.deepEqual(line.pins['line/r4:arrive'], { v: 'x', by: 'user' }, 'sig only on cut pins');
  const v = { dx: 1, dy: 2, rot: 0, s: 1 };
  const nudged = reduce(doc, { t: 'pin.set', path: 'cut/r4~0:el.text.nudge', v, by: 'user', sig: 's' });
  v.dx = 99;
  assert.equal(nudged.pins['cut/r4~0:el.text.nudge'].v.dx, 1, 'the payload value is copied');
  assert.equal(Object.keys(reduce(doc, { t: 'pin.clear', path: 'work:mood' }).pins).includes('work:mood'), false);
  const cleared = reduce(doc, { t: 'pin.clearUnder', scope: 'line/r6' });
  assert.equal(cleared, doc, 'lock pins are never removed by clearUnder');
  const all = reduce(doc, { t: 'pin.clearUnder', scope: 'work' });
  assert.ok(Object.values(all.pins).every((p) => p.by === 'lock'));
  const onlyTap = reduce(doc, { t: 'pin.clearUnder', scope: 'work', by: 'tap' });
  assert.equal(onlyTap.pins['line/r5:start'], undefined);
  assert.equal(Object.keys(onlyTap.pins).length, Object.keys(doc.pins).length - 1);
  const cutOnly = reduce(doc, { t: 'pin.clearUnder', scope: 'cut/r3~0' });
  assert.deepEqual(Object.keys(doc.pins).filter((p) => !(p in cutOnly.pins)), ['cut/r3~0:el.text.nudge', 'cut/r3~0:orient']);
});

test('lock semantics: lock.set payload, line user pins release that slot, lock.clear', () => {
  const doc = fresh('vertical');
  const payload = {
    'cut/r4~0:arrange': { v: 'centerAnchor', by: 'lock', sig: '昨日のため息を' },
    'cut/r4~0:arrive': { v: 'inkRise', by: 'lock', sig: '昨日のため息を' },
    'cut/r4~7:arrange': { v: 'stairStep', by: 'lock', sig: '置いてきた' },
    'line/r4:split': { v: [0, 7], by: 'lock' },
    'line/r4:arrange': { v: 'ignored', by: 'lock' },
  };
  const locked = reduce(doc, { t: 'lock.set', lineId: 'r4', pins: payload, n: 12 });
  assert.deepEqual(locked.locks.r4, { n: 12 });
  assert.equal(locked.pins['line/r4:arrange'], doc.pins['line/r4:arrange'], 'an existing user pin is never overwritten');
  assert.deepEqual(locked.pins['cut/r4~7:arrange'], payload['cut/r4~7:arrange']);
  assert.deepEqual(locked.pins['line/r4:split'], { v: [0, 7], by: 'lock' });
  const relocked = reduce(locked, { t: 'lock.set', lineId: 'r4', pins: { 'line/r4:split': { v: [0], by: 'lock' } } });
  assert.equal(relocked.pins['cut/r4~0:arrive'], undefined, 'lock.set replaces the previous lock pins');
  assert.deepEqual(relocked.locks.r4, { n: 12 }, 'n is kept when not given');

  const user = reduce(locked, { t: 'pin.set', path: 'line/r4:arrange', v: 'giantWhisper', by: 'user' });
  assert.equal(user.pins['cut/r4~0:arrange'], undefined, 'the lock pins of that slot are released');
  assert.equal(user.pins['cut/r4~7:arrange'], undefined);
  assert.ok(user.pins['cut/r4~0:arrive'], 'other slots stay locked');
  const ai = reduce(locked, { t: 'pin.set', path: 'line/r4:arrange', v: 'x', by: 'ai' });
  assert.ok(ai.pins['cut/r4~0:arrange'], 'only user pins release lock pins');
  const edit = reduce(locked, { t: 'pin.set', path: 'cut/r4~0:arrive', v: 'fogIn', by: 'user', sig: '昨日のため息を' });
  assert.equal(edit.pins['cut/r4~0:arrive'].by, 'user', 'editing a locked value replaces that pin');

  const unlocked = reduce(edit, { t: 'lock.clear', lineId: 'r4' });
  assert.equal(unlocked.locks.r4, undefined);
  assert.ok(Object.keys(unlocked.pins).every((p) => unlocked.pins[p].by !== 'lock' || !p.includes('r4')));
  assert.equal(unlocked.pins['cut/r4~0:arrive'].by, 'user', 'user pins stay');
  assert.deepEqual(D.validate(unlocked), []);
});

test('pin.promote moves one pin up; siblings are kept', () => {
  let doc = fresh('vertical');
  doc = reduce(doc, { t: 'pin.set', path: 'cut/r3~5:arrive', v: 'a', by: 'user', sig: '交差点で' });
  const up = reduce(doc, { t: 'pin.promote', path: 'cut/r3~0:orient', to: 'line' });
  assert.equal(up.pins['cut/r3~0:orient'], undefined);
  assert.deepEqual(up.pins['line/r3:orient'], { v: 'v', by: 'user' });
  assert.ok(up.pins['cut/r3~5:arrive.each'], 'sibling cut pins stay');
  const work = reduce(doc, { t: 'pin.promote', path: 'line/r4:arrange', to: 'work' });
  assert.deepEqual(work.pins['work:arrange'], { v: 'centerAnchor', by: 'user' });
  const fromLock = reduce(doc, { t: 'pin.promote', path: 'cut/r6~0:dwell', to: 'work' });
  assert.deepEqual(fromLock.pins['work:dwell'], { v: 'stillHold', by: 'user' }, 'a promoted lock value becomes a user pin');
  assert.equal(reduce(doc, { t: 'pin.promote', path: 'cut/r9~0:arrive', to: 'line' }), doc, 'no pin: nothing to move');
});

test('pin.copy pastes slot pins (not timing, not el.*) as user pins', () => {
  let doc = fresh('vertical');
  doc = reduce(doc, { t: 'pin.set', path: 'line/r4:arrive', v: 'inkRise', by: 'ai' });
  doc = reduce(doc, { t: 'pin.set', path: 'line/r4:arrive@inkRise.yFrom', v: 0.4, by: 'user' });
  doc = reduce(doc, { t: 'pin.set', path: 'line/r4:start', v: 3, by: 'tap' });
  doc = reduce(doc, { t: 'pin.set', path: 'line/r4:el.text.fill', v: 'accent', by: 'user' });
  const out = reduce(doc, { t: 'pin.copy', from: 'line/r4', to: ['line/r5', 'cut/r7~0'], sigs: { 'r7~0': '約束の丘へ' } });
  assert.deepEqual(out.pins['line/r5:arrange'], { v: 'centerAnchor', by: 'user' });
  assert.deepEqual(out.pins['line/r5:arrive'], { v: 'inkRise', by: 'user' });
  assert.deepEqual(out.pins['line/r5:arrive@inkRise.yFrom'], { v: 0.4, by: 'user' });
  assert.deepEqual(out.pins['cut/r7~0:arrange'], { v: 'centerAnchor', by: 'user', sig: '約束の丘へ' });
  assert.deepEqual(out.pins['line/r5:start'], doc.pins['line/r5:start'], 'timing is not copied');
  assert.equal(out.pins['line/r5:el.text.fill'], undefined, 'el.* is not copied');
  const toLocked = reduce(doc, { t: 'pin.copy', from: 'line/r4', to: ['line/r6'], sigs: {} });
  assert.equal(toLocked.pins['cut/r6~0:arrange'], undefined, 'a pasted line pin releases the lock of that slot');
});

test('salts and look commands', () => {
  const doc = fresh('vertical');
  const bumped = reduce(reduce(doc, { t: 'salt.bump', key: 'cut/r3~0:depart' }), { t: 'salt.bump', key: 'cut/r4~0' });
  assert.deepEqual(bumped.salts, { 'cut/r3~0:depart': 2, 'line/r5': 2, 'cut/r4~0': 1 });
  const om = reduce(doc, { t: 'look.omakase', seed: 7, moodSeed: 4294967295 });
  assert.deepEqual([om.look.seed, om.look.moodSeed, om.look.aspect], [7, 4294967295, '9:16']);
  assert.equal(om.salts, doc.salts);
  assert.equal(reduce(doc, { t: 'look.seed', seed: 8 }).look.moodSeed, doc.look.moodSeed);
  const restored = reduce(bumped, { t: 'look.restore', seed: 1, moodSeed: 2, salts: {} });
  assert.deepEqual([restored.look.seed, restored.look.moodSeed, restored.salts], [1, 2, {}]);
  assert.equal(reduce(doc, { t: 'look.set', key: 'backdrop', v: 'chroma' }).look.backdrop, 'chroma');
});

test('filters, time, timing, song and output commands', () => {
  const doc = fresh('basic');
  const f = reduce(doc, { t: 'filter.set', kind: 'seam', only: ['hardCut'], deny: null });
  assert.deepEqual(f.filters, { seam: { only: ['hardCut'], deny: null } });
  assert.deepEqual(reduce(f, { t: 'filter.set', kind: 'seam', only: null, deny: null }).filters, {});

  const shifted = reduce(doc, { t: 'time.shift', lineIds: ['r4', 'r5'], delta: 0.5,
    base: { r4: { start: 4.25, end: 8 }, r5: { start: 8.25, end: 12 } } });
  assert.deepEqual(shifted.pins['line/r4:start'], { v: 4.75, by: 'user' });
  assert.deepEqual(shifted.pins['line/r5:end'], { v: 12.5, by: 'user' });
  const clamped = reduce(doc, { t: 'time.shift', lineIds: ['r4'], delta: -9, base: { r4: { start: 4.25, end: 8 } } });
  assert.deepEqual([clamped.pins['line/r4:start'].v, clamped.pins['line/r4:end'].v], [0, 3.75], 'never before 0');

  const tapped = reduce(doc, { t: 'time.tap', marks: [{ lineId: 'r4', start: 4.1234567 }, { lineId: 'r5', end: 11 }] });
  assert.deepEqual(tapped.pins['line/r4:start'], { v: 4.123457, by: 'tap' });
  assert.deepEqual(tapped.pins['line/r5:end'], { v: 11, by: 'tap' });

  assert.equal(reduce(doc, { t: 'timing.set', key: 'snap', v: 'bar' }).timing.snap, 'bar');
  assert.equal(reduce(doc, { t: 'timing.set', key: 'lead', v: 0.2 }).timing.lead, 0.2);
  assert.equal(reduce(doc, { t: 'output.set', key: 'fps', v: 60 }).output.fps, 60);
  assert.deepEqual(reduce(doc, { t: 'output.set', key: 'range', v: { t0: 1, t1: 5 } }).output.range, { t0: 1, t1: 5 });

  const noSong = reduce(doc, { t: 'song.clear' });
  assert.equal(noSong.song, null);
  const song = reduce(noSong, { t: 'song.set', song: { name: 'a.wav', sha1: 'ab', seconds: 12 } });
  assert.deepEqual(song.song, { name: 'a.wav', sha1: 'ab', seconds: 12, bpm: null, offset: 0, meter: 4,
    bpmConfidence: null, digest: null, info: null }, 'missing fields get their defaults');
  const info = reduce(song, { t: 'song.info', info: { mood: 'bright' } });
  assert.deepEqual(info.song.info, { mood: 'bright' });
  for (const d of [f, shifted, tapped, song, info]) assert.deepEqual(D.validate(d), []);
});

test('batch applies in order', () => {
  const doc = fresh('basic');
  const out = reduce(doc, { t: 'batch', cmds: [
    { t: 'pin.set', path: 'work:mood', v: 'a', by: 'ai' }, { t: 'pin.set', path: 'work:mood', v: 'b', by: 'ai' },
    { t: 'salt.bump', key: 'line/r4' },
  ] });
  assert.deepEqual(out.pins['work:mood'], { v: 'b', by: 'ai' });
  assert.deepEqual(out.salts, { 'line/r4': 1 });
});

test('effectiveTimes reads start and end from the plan', () => {
  const plan = corpus.planBasic();
  assert.deepEqual(C.effectiveTimes(plan, ['r5', 'ra', 'zz']), { r5: { start: 8.25, end: 12 }, ra: { start: 22.25, end: 27 } });
  assert.deepEqual(C.COMMANDS.length, 33);
  for (const t of ['material.put', 'material.meta', 'material.remove', 'media.put', 'media.meta', 'media.move', 'media.remove',
    'media.relink']) assert.ok(C.COMMANDS.includes(t), t);
});

// ---- the property test ----------------------------------------------------------------------------------------------

const EXTRA_ROWS = ['新しい朝が/来た', 'Fly away / tonight', '', '# ブリッジ', '[00:30.00]時を刻む', '*光*の中へ!', 'ささやく声|こえ'];
const PARTS = ['inkRise', 'fogIn', 'stairStep', 'centerAnchor'];

function linesNow(doc) { return L.linesOf(L.parseSheet(doc.sheet.rows)); }

// A random command that is valid for `doc` (or null when the chosen kind does not apply right now).
function randomCommand(rng, doc) {
  const lines = linesNow(doc);
  const rows = doc.sheet.rows;
  const line = lines.length ? rng.pick(lines) : null;
  const cutOf = (l) => {
    const pieces = l.pieces || [[0, l.text.length]];
    const [a, b] = rng.pick(pieces);
    return { key: l.id + '~' + a, sig: l.text.slice(a, b) };
  };
  const pinPaths = Object.keys(doc.pins).sort();
  switch (rng.int(0, 21)) {
    case 0: case 1: {
      const srcs = rows.map((r) => r.src);
      const op = rng.int(0, 3);
      if (op === 0 || !srcs.length) srcs.splice(rng.int(0, srcs.length), 0, rng.pick(EXTRA_ROWS));
      else if (op === 1) srcs.splice(rng.int(0, srcs.length - 1), 1);
      else if (op === 2) { const i = rng.int(0, srcs.length - 1); srcs[i] = srcs[i] + rng.pick(['ね', '!', ' / よ', '']); } else {
        const i = rng.int(0, srcs.length - 1), j = rng.int(0, srcs.length - 1);
        [srcs[i], srcs[j]] = [srcs[j], srcs[i]];
      }
      return { t: 'lyrics.set', text: srcs.join(rng.pick(['\n', '\n', '\r\n', '\r'])) };
    }
    case 2: return rows.length ? { t: 'lyrics.row', rowId: rng.pick(rows).id, src: rng.pick(EXTRA_ROWS) } : null;
    case 3: {
      if (rows.length < 2) return null;
      const r = rng.pick(rows), other = rng.pick(rows.filter((x) => x !== r).concat([null]));
      return { t: 'lyrics.move', rowIds: [r.id], beforeRowId: other ? other.id : null };
    }
    case 4: return { t: 'meta.set', title: rng.pick(['朝', null, 'Night']), artist: rng.pick([undefined, null, '誰か']) };
    case 5: case 6: {
      const choices = [{ path: 'work:mood', v: rng.pick(PARTS) }, { path: 'work:amount.glitch', v: rng.next() }];
      if (line) {
        const cut = cutOf(line);
        choices.push({ path: 'line/' + line.id + ':arrive', v: rng.pick(PARTS) },
          { path: 'line/' + line.id + ':start', v: rng.int(0, 90) },
          { path: 'cut/' + cut.key + ':arrange', v: rng.pick(PARTS), sig: cut.sig },
          { path: 'cut/' + cut.key + ':el.text.nudge', v: { dx: rng.int(-9, 9), dy: 0, rot: 0, s: 1 }, sig: cut.sig });
      }
      const c = rng.pick(choices);
      return Object.assign({ t: 'pin.set', by: rng.pick(['user', 'ai', 'tap']) }, c);
    }
    case 7: return pinPaths.length ? { t: 'pin.clear', path: rng.pick(pinPaths) } : null;
    case 8: return { t: 'pin.clearUnder', scope: line ? rng.pick(['work', 'line/' + line.id]) : 'work' };
    case 9: {
      const promotable = pinPaths.filter((p) => /^cut\/r[^:]*:(arrange|arrive|el\.)|^line\/[^:]*:(arrive|arrange)$/.test(p));
      if (!promotable.length) return null;
      const path = rng.pick(promotable);
      return { t: 'pin.promote', path, to: path.startsWith('cut/') ? rng.pick(['line', 'work']) : 'work' };
    }
    case 10: {
      if (lines.length < 2) return null;
      const [a, b] = [rng.pick(lines), rng.pick(lines)];
      return { t: 'pin.copy', from: 'line/' + a.id, to: ['line/' + b.id], sigs: {} };
    }
    case 11: return { t: 'salt.bump', key: line ? rng.pick(['line/' + line.id, 'cut/' + cutOf(line).key + ':arrive']) : 'cut/title' };
    case 12: return rng.pick([{ t: 'look.omakase', seed: rng.int(0, 1e9), moodSeed: rng.int(0, 1e9) },
      { t: 'look.seed', seed: rng.int(0, 1e9) }, { t: 'look.set', key: 'aspect', v: rng.pick(D.ASPECTS) },
      { t: 'look.restore', seed: rng.int(0, 9), moodSeed: rng.int(0, 9), salts: rng.chance(0.5) ? {} : { 'line/r4': 2 } }]);
    case 13: {
      if (!line) return null;
      const cut = cutOf(line);
      return { t: 'lock.set', lineId: line.id, n: rng.int(0, 50), pins: {
        ['cut/' + cut.key + ':arrange']: { v: rng.pick(PARTS), by: 'lock', sig: cut.sig },
        ['line/' + line.id + ':split']: { v: (line.pieces || [[0]]).map((p) => p[0]), by: 'lock' },
      } };
    }
    case 14: return line ? { t: 'lock.clear', lineId: line.id } : null;
    case 15: return { t: 'filter.set', kind: rng.pick(D.FILTER_KINDS), only: rng.chance(0.5) ? [rng.pick(PARTS)] : null,
      deny: rng.chance(0.5) ? [rng.pick(PARTS)] : null };
    case 16: return line ? { t: 'time.shift', lineIds: [line.id], delta: rng.range(-5, 5),
      base: { [line.id]: { start: rng.range(0, 60), end: rng.range(60, 90) } } } : null;
    case 17: return line ? { t: 'time.tap', marks: [{ lineId: line.id, start: rng.range(0, 60) }] } : null;
    case 18: return rng.pick([{ t: 'timing.set', key: 'snap', v: rng.pick(['off', 'beat', 'half', 'bar']) },
      { t: 'timing.set', key: 'lead', v: rng.range(0, 1) }, { t: 'output.set', key: 'fps', v: rng.pick([24, 30, 60]) },
      { t: 'output.set', key: 'name', v: rng.pick([null, 'clip']) }]);
    case 19: return rng.pick([{ t: 'song.set', song: { name: 's.wav', sha1: 'ff', seconds: rng.int(30, 300), bpm: 120 } },
      { t: 'song.clear' }].concat(doc.song ? [{ t: 'song.info', info: { mood: rng.pick(['calm', 'loud']) } }] : []));
    default: return { t: 'batch', cmds: [{ t: 'salt.bump', key: 'cut/intro' }, { t: 'look.seed', seed: rng.int(0, 99) },
      { t: 'pin.set', path: 'work:theme', v: rng.pick(PARTS), by: 'user' }] };
  }
}

test('property: 500 random command sequences — undo all restores the start, replay gives the same hash', () => {
  const rng = stream('commands-property');
  const starts = ['basic', 'vertical', 'lrc'].map((name) => ({ name, text: JSON.stringify(fresh(name)) }));
  let commands = 0;
  for (let n = 0; n < 500; n++) {
    const pick = starts[n % starts.length];
    const start = JSON.parse(pick.text);
    const store = createStore({ doc: start, reduce, freeze: true });
    const log = [];
    const steps = rng.int(1, 24);
    for (let s = 0; s < steps; s++) {
      const cmd = randomCommand(rng, store.doc);
      if (!cmd) continue;
      const before = store.doc;
      store.dispatch(cmd);
      log.push(cmd);
      commands++;
      checkSharing(before, store.doc, cmd);
      const problems = D.validate(store.doc);
      assert.deepEqual(problems, [], pick.name + ' after ' + JSON.stringify(cmd));
    }
    const end = store.doc;
    const replayed = log.reduce(reduce, JSON.parse(pick.text));
    assert.equal(hashJSON(replayed), hashJSON(end), 'replaying the log gives the same document');
    while (store.undo()) { /* undo everything */ }
    deepEqual(store.doc, JSON.parse(pick.text), 'undo all → the start document');
    assert.equal(JSON.stringify(start), pick.text, 'the start document was never mutated');
    while (store.redo()) { /* redo everything */ }
    assert.equal(store.doc, end);
  }
  assert.ok(commands > 3000, 'enough commands were exercised: ' + commands);
});

// ---- v2.1 (DESIGN_2_1 §2.3, §2.6, §3.7, §13.3): scope refusals, promote and copy rules, output.kit ---------------------

test('v2.1 pin.set refuses cut/…:season, cut/…:avoid and work:avoid; line and work season are fine', () => {
  const doc = fresh('basic');
  throwsCode(() => reduce(doc, { t: 'pin.set', path: 'cut/r4~0:season', v: 'spring', by: 'ai', sig: '始発の' }), 'payload');
  throwsCode(() => reduce(doc, { t: 'pin.set', path: 'cut/r4~0:avoid', v: ['filter.sliceGlitch'], by: 'ai', sig: '始発の' }), 'payload');
  throwsCode(() => reduce(doc, { t: 'pin.set', path: 'work:avoid', v: ['filter.sliceGlitch'], by: 'user' }), 'payload');
  const ok = reduce(reduce(reduce(doc, { t: 'pin.set', path: 'line/r4:season', v: 'spring', by: 'ai' }),
    { t: 'pin.set', path: 'line/r4:avoid', v: ['filter.sliceGlitch'], by: 'ai' }), { t: 'pin.set', path: 'work:season', v: 'winter', by: 'user' });
  assert.deepEqual([ok.pins['line/r4:season'].v, ok.pins['line/r4:avoid'].v, ok.pins['work:season'].v],
    ['spring', ['filter.sliceGlitch'], 'winter']);
  for (const path of ['cut/r4~0:motion.speed', 'cut/r4~0:cam.shot', 'cut/r4~0:rig', 'cut/r4~0:rig.curve', 'line/r4:cam.zoom',
    'work:cam.curve', 'work:seam.curve', 'cut/r4~0:arrive.flow', 'line/r4:dwell.curve', 'work:lens.curve']) {
    assert.ok(reduce(doc, { t: 'pin.set', path, v: 1, by: 'user', sig: '始発の' }).pins[path], path + ' is pinnable');
  }
  throwsCode(() => reduce(doc, { t: 'lock.set', lineId: 'r4', pins: { 'cut/r4~0:season': { v: 'spring', by: 'lock', sig: '始発の' } } }),
    'payload');
});

test('v2.1 pin.promote: season may move line → work; avoid never moves', () => {
  let doc = fresh('basic');
  doc = reduce(doc, { t: 'pin.set', path: 'line/r4:season', v: 'spring', by: 'ai' });
  doc = reduce(doc, { t: 'pin.set', path: 'line/r4:avoid', v: ['filter.sliceGlitch'], by: 'ai' });
  const up = reduce(doc, { t: 'pin.promote', path: 'line/r4:season', to: 'work' });
  assert.deepEqual(up.pins['work:season'], { v: 'spring', by: 'ai' });
  assert.equal(up.pins['line/r4:season'], undefined);
  throwsCode(() => reduce(doc, { t: 'pin.promote', path: 'line/r4:avoid', to: 'work' }), 'payload');
  const stray = Object.assign({}, doc, { pins: Object.assign({}, doc.pins, { 'cut/r4~0:avoid': { v: [], by: 'user', sig: '始発の' },
    'cut/r4~0:season': { v: 'summer', by: 'user', sig: '始発の' } }) });
  throwsCode(() => reduce(stray, { t: 'pin.promote', path: 'cut/r4~0:avoid', to: 'line' }), 'payload');
  throwsCode(() => reduce(stray, { t: 'pin.promote', path: 'cut/r4~0:season', to: 'line' }), 'payload');
  const cam = reduce(reduce(doc, { t: 'pin.set', path: 'cut/r4~0:cam.shot', v: 'pushWord', by: 'user', sig: '始発の' }),
    { t: 'pin.promote', path: 'cut/r4~0:cam.shot', to: 'line' });
  assert.deepEqual(cam.pins['line/r4:cam.shot'], { v: 'pushWord', by: 'user' });
});

test('v2.1 pin.copy copies motion.speed and cam.*, not rig*, season or avoid', () => {
  let doc = fresh('basic');
  const shot = { keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'emph', fill: 0.9 }] };
  for (const [slot, v] of [['motion.speed', 0.5], ['cam.shot', shot], ['cam.zoom', 1.2], ['cam.curve', 'holdThenDash'],
    ['cam.follow', 0.3], ['rig', 'slowSwell'], ['rig.curve', 'softEnds'], ['season', 'spring'], ['avoid', ['lens.handHeld']],
    ['arrive.flow', 'softEnds']]) {
    doc = reduce(doc, { t: 'pin.set', path: 'line/r4:' + slot, v, by: 'ai' });
  }
  const out = reduce(doc, { t: 'pin.copy', from: 'line/r4', to: ['line/r5', 'cut/r6~0'], sigs: { 'r6~0': 'x' } });
  for (const slot of ['motion.speed', 'cam.shot', 'cam.zoom', 'cam.curve', 'cam.follow', 'arrive.flow']) {
    assert.deepEqual(out.pins['line/r5:' + slot], { v: doc.pins['line/r4:' + slot].v, by: 'user' }, slot);
    assert.ok(out.pins['cut/r6~0:' + slot], slot + ' at cut scope');
  }
  for (const slot of ['rig', 'rig.curve', 'season', 'avoid']) {
    assert.equal(out.pins['line/r5:' + slot], undefined, slot + ' is area-level');
    assert.equal(out.pins['cut/r6~0:' + slot], undefined, slot + ' is area-level');
  }
});

test('v2.1 output: formats kit and webmAlpha; output.set kit takes the whole object of five booleans', () => {
  const doc = D.normalize(fresh('basic'));
  assert.deepEqual(doc.output.kit, { overlay: true, bg: false, green: false, srt: true, lrc: false });
  for (const v of ['kit', 'webmAlpha', 'mp4', 'png', 'pngAlpha']) assert.equal(reduce(doc, { t: 'output.set', key: 'format', v }).output.format, v);
  throwsCode(() => reduce(doc, { t: 'output.set', key: 'format', v: 'mov' }), 'payload');
  const kit = { overlay: false, bg: true, green: true, srt: false, lrc: true };
  const out = reduce(doc, { t: 'output.set', key: 'kit', v: kit });
  assert.deepEqual(out.output.kit, kit);
  assert.equal(reduce(out, { t: 'output.set', key: 'kit', v: kit }), out, 'unchanged → the same doc');
  for (const bad of [{ overlay: true }, Object.assign({}, kit, { lrc: 'yes' }), Object.assign({}, kit, { extra: true }), null, true]) {
    throwsCode(() => reduce(doc, { t: 'output.set', key: 'kit', v: bad }), 'payload');
  }
  const raw = fresh('basic');
  assert.equal(raw.output.kit, undefined, 'a schema-1 document has no kit');
  assert.deepEqual(D.validate(raw), [], 'and still validates (normalize fills it)');
  assert.deepEqual(reduce(raw, { t: 'output.set', key: 'kit', v: kit }).output.kit, kit);
});
