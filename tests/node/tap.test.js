/* 文字PVメーカー v2 — original work. Tests for core/tap: mark / end / back sequences and the session command (§4.11). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { throwsCode } = require('../helpers/assert_plus.js');

const MV = load();
const T = MV.use('core/tap');

const LINES = ['r3', 'r4', 'r5', 'r7', 'r7.1'].map((id) => ({ id, text: id }));

function run(from, events) {
  let s = T.tapStart(LINES, from);
  for (const [type, t] of events) s = T.tapReduce(s, { type, t });
  return s;
}

test('tapStart begins at the given line, or the first one', () => {
  const s = T.tapStart(LINES, 'r5');
  assert.deepEqual([s.cursor, s.current, s.next, s.active, s.paused], [2, -1, 'r5', null, false]);
  assert.equal(T.tapStart(LINES, 'nope').next, 'r3');
  assert.equal(T.tapStart(LINES, null).next, 'r3');
  assert.equal(T.tapStart(['a', 'b'], 'b').next, 'b', 'ids work too');
  assert.equal(T.tapStart([], null).next, null);
});

test('mark: starts of successive lines; end: end of the current line', () => {
  const s = run('r4', [['mark', 10], ['mark', 12.5], ['end', 14], ['mark', 15]]);
  assert.equal(s.next, 'r7.1');
  assert.equal(s.active, 'r7');
  assert.deepEqual(T.tapCommand(s), { t: 'time.tap', marks: [
    { lineId: 'r4', start: 10 }, { lineId: 'r5', start: 12.5, end: 14 }, { lineId: 'r7', start: 15 },
  ] });
});

test('back forgets the last line and steps back; marking again replaces it', () => {
  const s = run('r3', [['mark', 1], ['mark', 3], ['end', 4], ['back', 5]]);
  assert.deepEqual([s.next, s.active], ['r4', 'r3']);
  assert.deepEqual(T.tapCommand(s), { t: 'time.tap', marks: [{ lineId: 'r3', start: 1 }] });
  const again = T.tapReduce(s, { type: 'mark', t: 3.2 });
  assert.deepEqual(T.tapCommand(again).marks, [{ lineId: 'r3', start: 1 }, { lineId: 'r4', start: 3.2 }]);
  const twice = run('r4', [['mark', 1], ['back', 2], ['back', 3]]);
  assert.deepEqual([twice.next, twice.active], ['r3', null], 'stepping back past the start line');
  assert.equal(T.tapCommand(twice), null);
  const atTop = T.tapStart(LINES, 'r3');
  assert.equal(T.tapReduce(atTop, { type: 'back', t: 0 }), atTop, 'nothing before the first line');
});

test('ignored events return the same state', () => {
  const s = T.tapStart(LINES, 'r3');
  assert.equal(T.tapReduce(s, { type: 'end', t: 3 }), s, 'end without a current line');
  const marked = T.tapReduce(s, { type: 'mark', t: 5 });
  assert.equal(T.tapReduce(marked, { type: 'end', t: 4 }), marked, 'an end before the start');
  const paused = T.tapReduce(marked, { type: 'pause', t: 6 });
  assert.equal(paused.paused, true);
  assert.equal(T.tapReduce(paused, { type: 'mark', t: 7 }), paused, 'marks are ignored while paused');
  assert.equal(T.tapReduce(paused, { type: 'pause', t: 7 }), paused);
  const resumed = T.tapReduce(paused, { type: 'resume', t: 8 });
  assert.equal(resumed.paused, false);
  assert.equal(T.tapReduce(resumed, { type: 'resume', t: 8 }), resumed);
  const done = run('r7.1', [['mark', 50]]);
  assert.equal(done.next, null);
  assert.equal(T.tapReduce(done, { type: 'mark', t: 51 }), done, 'no line left to mark');
});

test('negative times clamp to 0; bad events throw', () => {
  assert.deepEqual(T.tapCommand(run('r3', [['mark', -0.04]])).marks, [{ lineId: 'r3', start: 0 }]);
  const s = T.tapStart(LINES, 'r3');
  throwsCode(() => T.tapReduce(s, { type: 'jump', t: 1 }), 'bad-event');
  throwsCode(() => T.tapReduce(s, { type: 'mark' }), 'bad-event');
  throwsCode(() => T.tapStart(null), 'bad-lines');
});

test('one command per session; an empty session gives null', () => {
  assert.equal(T.tapCommand(T.tapStart(LINES, 'r3')), null);
  assert.equal(T.tapCommand(run('r3', [['pause', 0], ['mark', 1], ['resume', 2]])), null);
  const s = run('r3', [['mark', 1], ['mark', 2], ['mark', 3], ['mark', 4], ['mark', 5], ['end', 6]]);
  const cmd = T.tapCommand(s);
  assert.equal(cmd.t, 'time.tap');
  assert.deepEqual(cmd.marks.map((m) => m.lineId), ['r3', 'r4', 'r5', 'r7', 'r7.1']);
  assert.deepEqual(cmd.marks[4], { lineId: 'r7.1', start: 5, end: 6 });
});

test('the reducer never mutates its input', () => {
  const s = Object.freeze(T.tapStart(LINES, 'r3'));
  Object.freeze(s.starts);
  Object.freeze(s.ends);
  const next = T.tapReduce(s, { type: 'mark', t: 1 });
  assert.deepEqual(s.starts, [null, null, null, null, null]);
  assert.deepEqual(next.starts, [1, null, null, null, null]);
});

test('a mark less than MIN_GAP after the last start is not taken (timing would drop it with time-order)', () => {
  assert.ok(T.MIN_GAP > 0.1, 'more than timing\'s 0.1 s anchor gap');
  const s = run('r3', [['mark', 2]]);
  assert.equal(T.tapReduce(s, { type: 'mark', t: 2 }), s, 'the frozen clock of stopped playback: the same time again');
  assert.equal(T.tapReduce(s, { type: 'mark', t: 1.5 }), s, 'earlier than the last start');
  assert.equal(T.tapReduce(s, { type: 'mark', t: 2 + T.MIN_GAP - 0.01 }), s, 'just under the gap');
  const ok = T.tapReduce(s, { type: 'mark', t: 2 + T.MIN_GAP });
  assert.deepEqual(T.tapCommand(ok).marks.map((m) => m.start), [2, 2 + T.MIN_GAP], 'at the gap');
  const back = T.tapReduce(ok, { type: 'back', t: 3 });
  assert.notEqual(T.tapReduce(back, { type: 'mark', t: 2.5 }), back, 'after back, the gap is measured from the line above');
  const first = T.tapStart(LINES, 'r4');
  assert.notEqual(T.tapReduce(first, { type: 'mark', t: 0 }), first, 'nothing above the first mark of a session');
});
