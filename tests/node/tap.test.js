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

// --- PV22 S2: the one-line mode and the pins that keep the other lines still (DESIGN_2_2 §5) ---------------------------

test('one-line mode: one mark is taken; back re-arms the same line and stops there; the command has one mark', () => {
  const s = T.tapStart(LINES, 'r5', { only: true });
  assert.deepEqual([s.only, s.from, s.stop, s.next, T.done(s)], [true, 2, 3, 'r5', false]);
  const marked = T.tapReduce(s, { type: 'mark', t: 20 });
  assert.deepEqual([marked.next, marked.active, T.done(marked)], [null, 'r5', true]);
  assert.equal(T.tapReduce(marked, { type: 'mark', t: 22 }), marked, 'a second mark does nothing');
  const ended = T.tapReduce(marked, { type: 'end', t: 24 });
  assert.deepEqual(T.tapCommand(ended), { t: 'time.tap', marks: [{ lineId: 'r5', start: 20, end: 24 }] });
  const again = T.tapReduce(ended, { type: 'back', t: 25 });
  assert.deepEqual([again.next, again.active, T.done(again), again.only, again.stop], ['r5', null, false, true, 3]);
  assert.equal(T.tapCommand(again), null);
  assert.equal(T.tapReduce(again, { type: 'back', t: 26 }), again, 'never above the line');
  const redo = T.tapReduce(again, { type: 'mark', t: 21 });
  assert.deepEqual(T.tapCommand(redo).marks, [{ lineId: 'r5', start: 21 }]);
  // paused / resumed keep the mode
  const paused = T.tapReduce(s, { type: 'pause', t: 1 });
  assert.deepEqual([paused.only, paused.stop], [true, 3]);
  assert.equal(T.tapReduce(paused, { type: 'mark', t: 2 }), paused);
  // the normal mode runs to the end of the song as before
  const normal = T.tapStart(LINES, 'r5');
  assert.deepEqual([normal.only, normal.stop], [false, LINES.length]);
  assert.equal(T.done(run('r7.1', [['mark', 50]])), true);
  assert.equal(T.tapStart([], null, { only: true }).only, false, 'no lines: nothing to mark');
});

// plan.lines-like rows: ids, starts and how each start was set
function rows(spec) { return spec.map(([id, t0, by]) => ({ id, t0, by: { start: by || 'auto', end: 'auto' } })); }

test('stillPins: the ends of each run of moved automatic lines, pinned at their old starts', () => {
  const before = rows([['a', 1], ['b', 2], ['c', 3], ['d', 4, 'pin'], ['e', 5], ['f', 6], ['g', 7]]);
  // the target d moved to 4.5; b, c and e, f, g moved with it; a did not
  const after = rows([['a', 1], ['b', 2.2], ['c', 3.3], ['d', 4.5, 'pin'], ['e', 5.4], ['f', 6.3], ['g', 7.1]]);
  assert.deepEqual(T.stillPins(before, after, 'd', 4.5), [{ lineId: 'b', start: 2 }, { lineId: 'c', start: 3 },
    { lineId: 'e', start: 5 }, { lineId: 'g', start: 7 }]);
  // one moved line: pinned once
  const one = rows([['a', 1], ['b', 2.3], ['c', 3], ['d', 4.5, 'pin'], ['e', 5], ['f', 6], ['g', 7]]);
  assert.deepEqual(T.stillPins(before, one, 'd', 4.5), [{ lineId: 'b', start: 2 }]);
  // moves under STILL_EPS are not moves; pins, LRC and the target itself are never candidates
  const tiny = rows([['a', 1.004], ['b', 2], ['c', 3], ['d', 4.5, 'pin'], ['e', 5], ['f', 6], ['g', 7]]);
  assert.deepEqual(T.stillPins(before, tiny, 'd', 4.5), []);
  const fixed = rows([['a', 1, 'lrc'], ['b', 2, 'pin'], ['c', 3], ['d', 4, 'pin'], ['e', 5], ['f', 6], ['g', 7]]);
  const shiftAll = rows([['a', 1.5, 'lrc'], ['b', 2.5, 'pin'], ['c', 3.5], ['d', 4.5, 'pin'], ['e', 5.5], ['f', 6.5], ['g', 7.5]]);
  assert.deepEqual(T.stillPins(fixed, shiftAll, 'd', 4.5).map((x) => x.lineId), ['c', 'e', 'g']);
});

test('stillPins: a pin that would cross the new start is skipped; different line lists give nothing', () => {
  const before = rows([['a', 1], ['b', 2], ['c', 3], ['d', 4], ['e', 5]]);
  // c re-tapped at 4.6: d (old start 4) would come before it, so d is not pinned; e is
  const after = rows([['a', 1], ['b', 2], ['c', 4.6], ['d', 5.0], ['e', 5.4]]);
  assert.deepEqual(T.stillPins(before, after, 'c', 4.6), [{ lineId: 'e', start: 5 }]);
  // b re-tapped earlier than a: a is not pinned
  const early = rows([['a', 0.7], ['b', 0.8], ['c', 3], ['d', 4], ['e', 5]]);
  assert.deepEqual(T.stillPins(before, early, 'b', 0.8), []);
  assert.deepEqual(T.stillPins(before, after.slice(1), 'c', 4.6), []);
  assert.deepEqual(T.stillPins(before, rows([['a', 1], ['x', 2], ['c', 3], ['d', 4], ['e', 5]]), 'c', 4.6), []);
  assert.deepEqual(T.stillPins(before, after, 'zz', 4.6), []);
});
