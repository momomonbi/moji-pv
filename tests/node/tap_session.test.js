/* 文字PVメーカー v2 — original work. Tests: the rules of the one-line tap session (この行だけ打ち直す) — the loop point, the finish time, the user's seeks and the end pin that moves with the start (PV22 S2, DESIGN_2_2 §5). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const TS = MV.use('ui/tap').TS;
const O = TS.ONLY;

test('loopAt: past the later of the line\'s end and the next line\'s start', () => {
  assert.equal(TS.loopAt({ t0: 10, t1: 12 }, { t0: 13 }), 13 + O.LOOP_PAD);
  assert.equal(TS.loopAt({ t0: 10, t1: 14 }, { t0: 13 }), 14 + O.LOOP_PAD, 'a line pinned past the next start');
  assert.equal(TS.loopAt({ t0: 10, t1: 12 }, null), 12 + O.LOOP_PAD, 'the last line');
});

test('stopAt: after the line\'s old length and the next start still ahead; at least 1 s, at most 12 s', () => {
  // a 6 s line: the session runs at least 6.5 s after the mark
  assert.ok(TS.stopAt(20, { t0: 15, t1: 21 }, 21.2) >= 20 + 6.5);
  // a line whose automatic start was 5 s early (the mark comes at the old next start): at least 1 s
  const late = TS.stopAt(25, { t0: 20, t1: 20.5 }, 20.5);
  assert.ok(late >= 25 + O.STOP_MIN && late <= 25 + O.STOP_MIN + 1e-9, 'late ' + late);
  // the next line's old start still ahead is waited for
  assert.equal(TS.stopAt(10, { t0: 10, t1: 11 }, 14), 14 + O.STOP_PAD);
  // capped
  assert.equal(TS.stopAt(10, { t0: 0, t1: 40 }, null), 10 + O.STOP_MAX);
  assert.equal(TS.stopAt(10, { t0: 9, t1: 9.2 }, null), 10 + O.STOP_MIN, 'a short line');
});

test('userSeek: a jump the session did not make; the session\'s own seek and playback are not', () => {
  assert.equal(TS.userSeek(10, 13, null), true, 'a 3 s jump');
  assert.equal(TS.userSeek(10, 7, null), true, 'backwards');
  assert.equal(TS.userSeek(10, 10.016, null), false, 'one frame of playback');
  assert.equal(TS.userSeek(10, 10 + O.JUMP, null), false, 'at the threshold');
  assert.equal(TS.userSeek(14, 8, 8), false, 'the loop seeking back');
  assert.equal(TS.userSeek(14, 8.5, 8), true, 'a seek elsewhere');
  assert.equal(TS.userSeek(null, 30, null), false, 'the first time seen');
});

test('endShift: a paired start and end pin keeps its length; lone ends, lock pins and too-short ends are left', () => {
  const pins = { 'line/r4:start': { v: 10, by: 'user' }, 'line/r4:end': { v: 12.5, by: 'user' } };
  assert.equal(TS.endShift(pins, 'r4', 11, 10, 60), 13.5, 'the end moves by the same delta');
  assert.equal(TS.endShift(pins, 'r4', 9.2, 10, 60), 11.7, 'earlier too');
  assert.equal(TS.endShift(pins, 'r4', 11, 10, 13), 13, 'never past the end of the video');
  assert.equal(TS.endShift(pins, 'r4', 12.9, 10, 13), null, 'clipped below start + MIN_LEN');
  assert.equal(TS.endShift({ 'line/r4:end': { v: 12.5, by: 'user' } }, 'r4', 11, 10, 60), null, 'a lone end pin stays');
  assert.equal(TS.endShift(Object.assign({}, pins, { 'line/r4:end': { v: 12.5, by: 'lock' } }), 'r4', 11, 10, 60), null, 'lock end');
  assert.equal(TS.endShift(Object.assign({}, pins, { 'line/r4:start': { v: 10, by: 'lock' } }), 'r4', 11, 10, 60), null, 'lock start');
  assert.equal(TS.endShift({ 'line/r4:start': { v: 10, by: 'tap' } }, 'r4', 11, 10, 60), null, 'no end pin');
  assert.equal(TS.endShift(Object.assign({}, pins, { 'line/r4:end': { v: 'x', by: 'user' } }), 'r4', 11, 10, 60), null, 'a bad end value');
});
