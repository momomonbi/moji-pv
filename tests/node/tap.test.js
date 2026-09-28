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

// --- 1字ずつタップ (歌ハメ, DESIGN_2_2 §6) -------------------------------------------------------------------------

const UNITS = [{ at: 0, text: 'き' }, { at: 1, text: 'み' }, { at: 2, text: 'の' }, { at: 3, text: '声' }];

function runUnits(events, opts) {
  let s = T.unitStart(UNITS, opts);
  for (const [type, t] of events) s = T.unitReduce(s, { type, t });
  return s;
}

test('unit tap: marks in unit order, relative to the first mark; the end is optional', () => {
  const s = T.unitStart(UNITS);
  assert.deepEqual([s.cursor, s.end, s.paused, s.done, s.atLoopEnd], [0, null, false, false, false]);
  assert.deepEqual(s.times, [null, null, null, null]);
  const m = runUnits([['mark', 12], ['mark', 12.2], ['mark', 12.45]]);
  assert.deepEqual(T.unitResult(m), { start: 12, times: [[0, 0], [1, 0.2], [2, 0.45]], end: null });
  const e = T.unitReduce(m, { type: 'end', t: 13.1 });
  assert.equal(e.end, 13.1);
  assert.equal(e.done, false, 'a unit is left');
  assert.deepEqual(T.unitResult(e).end, 1.1);
  const all = runUnits([['mark', 1], ['mark', 1.3], ['mark', 1.6], ['mark', 2.0004], ['end', 2.5]]);
  assert.equal(all.done, true, 'every unit and the end');
  assert.deepEqual(T.unitResult(all), { start: 1, times: [[0, 0], [1, 0.3], [2, 0.6], [3, 1]], end: 1.5 }, 'to the millisecond');
  assert.equal(T.unitReduce(all, { type: 'mark', t: 3 }), all, 'no unit left to mark');
});

test('unit tap: a mark closer than UNIT_GAP, and an end not after the last mark, are not taken', () => {
  const s = runUnits([['mark', 5]]);
  assert.equal(T.unitReduce(s, { type: 'mark', t: 5 }), s, 'the same time again');
  assert.equal(T.unitReduce(s, { type: 'mark', t: 5 + T.UNIT_GAP - 0.005 }), s);
  assert.notEqual(T.unitReduce(s, { type: 'mark', t: 5 + T.UNIT_GAP }), s, 'at the gap');
  assert.equal(T.unitReduce(s, { type: 'end', t: 5 }), s, 'an end at the last mark');
  const none = T.unitStart(UNITS);
  assert.equal(T.unitReduce(none, { type: 'end', t: 3 }), none, 'no end before a mark');
  const noEnd = runUnits([['mark', 1], ['mark', 2]], { end: false });
  assert.equal(T.unitReduce(noEnd, { type: 'end', t: 3 }), noEnd, 'opts.end false: the end is not marked');
});

test('unit tap: a mark after the end takes the end back; back forgets the end, then the last mark', () => {
  const s = runUnits([['mark', 1], ['mark', 1.5], ['end', 2]]);
  const on = T.unitReduce(s, { type: 'mark', t: 2.4 });
  assert.equal(on.end, null, 'the singing went on');
  assert.deepEqual(T.unitResult(on).times.map((p) => p[1]), [0, 0.5, 1.4]);
  const b1 = T.unitReduce(s, { type: 'back', t: 3 });
  assert.deepEqual([b1.cursor, b1.end], [2, null], 'the end first');
  const b2 = T.unitReduce(b1, { type: 'back', t: 3 });
  assert.deepEqual([b2.cursor, b2.times], [1, [1, null, null, null]]);
  const b3 = T.unitReduce(T.unitReduce(b2, { type: 'back', t: 3 }), { type: 'back', t: 3 });
  assert.equal(b3.cursor, 0);
  assert.equal(T.unitReduce(b3, { type: 'back', t: 3 }), b3, 'nothing to forget');
  assert.equal(T.unitResult(b2), null, 'fewer than 2 marks: nothing to record');
});

test('unit tap: pause, the loop end and restart', () => {
  const s = runUnits([['mark', 1], ['mark', 1.4]]);
  const p = T.unitReduce(s, { type: 'pause', t: 2 });
  assert.equal(p.paused, true);
  assert.equal(T.unitReduce(p, { type: 'mark', t: 3 }), p, 'marks are ignored while paused');
  assert.equal(T.unitReduce(p, { type: 'end', t: 3 }), p);
  assert.equal(T.unitReduce(p, { type: 'pause', t: 3 }), p);
  const r = T.unitReduce(p, { type: 'resume', t: 3 });
  assert.equal(r.paused, false);
  assert.equal(T.unitReduce(r, { type: 'resume', t: 3 }), r);
  const le = T.unitReduce(s, { type: 'loopEnd', t: 4 });
  assert.deepEqual([le.paused, le.atLoopEnd], [true, true]);
  assert.deepEqual(T.unitResult(le), T.unitResult(s), 'the loop end keeps the take');
  assert.equal(T.unitReduce(le, { type: 'loopEnd', t: 4 }), le);
  const again = T.unitReduce(le, { type: 'restart', t: 4 });
  assert.deepEqual([again.cursor, again.end, again.atLoopEnd], [0, null, false]);
  assert.deepEqual(again.times, [null, null, null, null]);
  assert.equal(again.paused, true, 'still stopped until playback starts again');
  const played = T.unitReduce(le, { type: 'resume', t: 4 });
  assert.deepEqual([played.paused, played.atLoopEnd], [false, false], 'playing again leaves the loop end');
  const fresh = T.unitStart(UNITS);
  assert.equal(T.unitReduce(fresh, { type: 'restart', t: 0 }), fresh);
});

test('unit tap: the reducer never mutates its input; bad units and events throw', () => {
  const s = runUnits([['mark', 1]]);
  Object.freeze(s);
  const next = T.unitReduce(s, { type: 'mark', t: 2 });
  assert.deepEqual(s.times, [1, null, null, null]);
  assert.deepEqual(next.times, [1, 2, null, null]);
  assert.ok(Object.isFrozen(s.times) && Object.isFrozen(s.units));
  assert.deepEqual(T.unitResult(runUnits([['mark', -0.3], ['mark', 0.2]])).times, [[0, 0], [1, 0.2]], 'negative times clamp to 0');
  throwsCode(() => T.unitReduce(s, { type: 'jump', t: 1 }), 'bad-event');
  throwsCode(() => T.unitReduce(s, { type: 'mark' }), 'bad-event');
  throwsCode(() => T.unitStart(null), 'bad-units');
  throwsCode(() => T.unitStart([{ at: 1 }, { at: 1 }]), 'bad-units');
  throwsCode(() => T.unitStart([{ at: -1 }]), 'bad-units');
  assert.deepEqual(T.UNIT_EVENTS, ['mark', 'end', 'back', 'pause', 'resume', 'restart', 'loopEnd']);
  assert.deepEqual(T.EVENTS, ['mark', 'end', 'back', 'pause', 'resume'], 'the line tap events are unchanged');
});
