/* 文字PVメーカー v2 — original work. Tests for ui/tap_units: the steps of 1字ずつタップ, its loop, the pin it writes and the tap panel's two modes (歌ハメ, DESIGN_2_2 §6). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const TU = MV.use('ui/tap_units');
const TAP = MV.use('core/tap');
const SU = MV.use('planner/sung');
const C = MV.use('core/commands');
const PL = MV.use('planner/plan');
const REG = MV.use('parts/catalog').defaultRegistry();

test('steps: 1字 are the sung units, 言葉 the word starts; the first starts at 0', () => {
  const mora = TU.unitsFor('しゅっぱつ しんこう！', 'ja', 'mora');
  assert.deepEqual(mora.map((u) => u.at), Array.from(SU.unitsOf('しゅっぱつ しんこう！', 'ja').at));
  assert.deepEqual(mora.map((u) => u.text), ['しゅ', 'っ', 'ぱ', 'つ', 'し', 'ん', 'こ', 'う！']);
  assert.deepEqual(TU.unitsFor('Hello new world', 'en', 'phrase').map((u) => [u.at, u.text]), [[0, 'Hello'], [6, 'new'], [10, 'world']]);
  const words = TU.unitsFor(' Hello world', 'en', 'phrase');
  assert.deepEqual(words.map((u) => u.at), [0, 7], 'what comes before the first word goes with it');
  assert.deepEqual(TU.unitsFor('「きみ」の声', 'ja', 'phrase').map((u) => u.at), [0, 5]);
  assert.ok(TU.unitsFor('あ'.repeat(500), 'ja', 'mora').length <= 399, 'a pin holds at most 400 pairs with the end');
});

test('the loop: 1.5 s before the line to 0.8 s after its singing ends (or after its end without sung timing)', () => {
  assert.deepEqual(TU.loopOf({ t0: 10, t1: 14 }, null), { a: 8.5, b: 14.8 });
  assert.deepEqual(TU.loopOf({ t0: 10, t1: 14 }, { end: 12.2 }), { a: 8.5, b: 13 });
  assert.deepEqual(TU.loopOf({ t0: 1, t1: 3 }, null), { a: 0, b: 3.8 }, 'never before 0');
});

test('a take becomes a sung.times pin the planner accepts, and the line\'s start (one undo step, two commands)', () => {
  for (const [text, lang, step] of [['きみの声がきこえた', 'ja', 'mora'], ['Hello new world', 'en', 'phrase'], ['しゅっぱつ しんこう！', 'ja', 'phrase']]) {
    const units = TU.unitsFor(text, lang, step);
    let s = TAP.unitStart(units);
    units.forEach((u, i) => { s = TAP.unitReduce(s, { type: 'mark', t: 20 + i * 0.237 }); });
    const withEnd = TAP.unitReduce(s, { type: 'end', t: 20 + units.length * 0.237 + 0.3 });
    for (const st of [s, withEnd]) {
      const pin = TU.pinOf(TAP.unitResult(st), text);
      const got = SU.acceptSungTimes(text)(pin, 'pin:line');
      assert.ok(got.v, text + ' ' + step + ': ' + JSON.stringify(pin));
      assert.equal(pin[0][1], 0, 'relative to the first mark');
    }
    assert.equal(TU.pinOf(TAP.unitResult(withEnd), text).slice(-1)[0][0], text.length, 'the end pair');
  }
  // applied to a document: the line starts at the first mark, and its characters follow the take
  const doc = corpus.project('basic').doc;
  const line = PL.plan(doc, { registry: REG }).lines.find((l) => l.id === 'r5');
  const units = TU.unitsFor(line.text, line.lang, 'mora');
  let s = TAP.unitStart(units);
  const t0 = line.t0 + 0.4;
  units.forEach((u, i) => { s = TAP.unitReduce(s, { type: 'mark', t: t0 + i * 0.2 }); });
  const res = TAP.unitResult(s);
  let d = C.reduce(doc, { t: 'time.tap', marks: [{ lineId: 'r5', start: res.start }] });
  d = C.reduce(d, { t: 'pin.set', path: 'line/r5:sung.times', v: TU.pinOf(res, line.text), by: 'tap' });
  const p = PL.plan(d, { registry: REG });
  const l = p.lines.find((x) => x.id === 'r5');
  assert.ok(Math.abs(l.t0 - t0) < 1e-6);
  const ls = p.sung.get('r5');
  assert.deepEqual([ls.by, ls.pinBy], ['pin', 'tap']);
  assert.deepEqual(Array.from(ls.t).map((x) => Math.round((x - l.t0) * 1000) / 1000), units.map((u, i) => Math.round(i * 200) / 1000));
});

test('the tap panel: one API over line tapping and 1字ずつタップ; keys go to the running mode', () => {
  const calls = [];
  const panel = (name) => {
    let on = false;
    const p = { root: { name } };
    for (const m of ['mark', 'end', 'back', 'seekBy', 'pause', 'finish', 'update']) p[m] = (a) => calls.push(name + '.' + m + (a ? ':' + JSON.stringify(a) : ''));
    p.cancel = () => { calls.push(name + '.cancel'); on = false; };
    p.strip = () => ({ text: name });
    p.active = () => on;
    p.start = () => { on = true; calls.push(name + '.start'); return true; };
    p.extra = () => 'kept';
    return p;
  };
  const line = panel('line'), units = panel('units');
  const tap = TU.combine(line, units);
  assert.equal(tap.root.name, 'line');
  assert.equal(tap.extra(), 'kept', 'other members of the line panel pass through');
  assert.equal(tap.active(), false);
  assert.equal(tap.startUnits('r5', { step: 'mora' }), true);
  assert.equal(tap.mode(), 'units');
  assert.equal(tap.root.name, 'units', 'the step column shows the running mode');
  assert.equal(tap.start(), false, 'no line tapping while a unit session runs');
  tap.mark({ timeStamp: 1 });
  tap.seekBy({ seconds: 3 });
  tap.finish();
  assert.deepEqual(calls.slice(-3), ['units.mark:{"timeStamp":1}', 'units.seekBy:{"seconds":3}', 'units.finish']);
  assert.equal(tap.strip().text, 'units');
  tap.cancel();
  assert.equal(tap.mode(), null);
  assert.equal(tap.start(), true);
  assert.equal(tap.startUnits('r5'), false, 'no unit session while line tapping runs');
  tap.mark();
  assert.equal(calls.slice(-1)[0], 'line.mark');
});
