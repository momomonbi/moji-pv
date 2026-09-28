/* 文字PVメーカー v2 — original work. Tests for ui/sung_ticks: the timeline's character ticks — which are drawn, where a tick may move, and the pins a drag, a nudge or a double-click writes (歌ハメ, DESIGN_2_2 §6). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const TK = MV.use('ui/sung_ticks');
const SU = MV.use('planner/sung');
const C = MV.use('core/commands');
const PL = MV.use('planner/plan');
const T = MV.use('i18n/t');
const STRINGS = MV.use('i18n/strings');
const REG = MV.use('parts/catalog').defaultRegistry();

const pin = (v, by = 'user') => ({ v, by });
const withPins = (doc, pins) => Object.assign({}, doc, { pins: Object.assign({}, doc.pins, pins) });
const planOf = (doc) => PL.plan(doc, { registry: REG });
const apply = (doc, cmds) => cmds.reduce((d, c) => C.reduce(d, c), doc);
const lineOf = (p, id) => p.lines.find((l) => l.id === id);

// The basic fixture with 「字の時間を歌に合わせる」: every line has estimated character times and an automatic start.
function estimated() {
  const doc = withPins(corpus.project('basic').doc, { 'work:sung.real': pin(true) });
  const p = planOf(doc);
  // a line whose estimated singing ends well before its span
  const line = p.lines.find((l, i) => l.by.start === 'auto' && p.sung.get(l.id) && p.sung.get(l.id).t.length >= 5
    && p.sung.get(l.id).end < TK.spanEndOf(p.lines, i) - 0.1);
  return { doc, p, line, ls: p.sung.get(line.id) };
}

test('ticks: every unit after the first, the first only when it is sung after the line\'s start', () => {
  const { line, ls } = estimated();
  const list = TK.ticksOf(ls, line);
  assert.deepEqual(list.map((k) => k.u), Array.from({ length: ls.t.length - 1 }, (_, i) => i + 1));
  assert.ok(list.every((k) => k.src === SU.SRC.est));
  const later = Object.assign({}, ls, { t: Float64Array.from(ls.t, (x, u) => (u === 0 ? line.t0 + 0.2 : x + 0.2)) });
  assert.equal(TK.ticksOf(later, line)[0].u, 0);
  assert.deepEqual(TK.ticksOf(null, line), []);
  // drawn with room (≥ 5 px per unit) or on a selected line
  const px = (k) => (x) => x * k;
  const perUnit = (ls.end - line.t0) / ls.t.length;
  assert.equal(TK.shown(ls, line, px(4.9 / perUnit), false), false);
  assert.equal(TK.shown(ls, line, px(5.1 / perUnit), false), true);
  assert.equal(TK.shown(ls, line, px(1), true), true, 'always on a selected line');
});

test('hit: the nearest tick within 4 px; step walks the ticks (Alt+←/→)', () => {
  const { line, ls } = estimated();
  const xOf = (t) => (t - line.t0) * 200;
  assert.equal(TK.hit(ls, line, xOf(ls.t[2]) + 3, xOf), 2);
  assert.equal(TK.hit(ls, line, xOf(ls.t[2]) + 4.5, xOf), -1);
  assert.equal(TK.step(ls, line, -1, 1), 1, 'Alt+→ from the line: the first tick');
  assert.equal(TK.step(ls, line, -1, -1), ls.t.length - 1, 'Alt+← from the line: the last tick');
  assert.equal(TK.step(ls, line, 2, 1), 3);
  assert.equal(TK.step(ls, line, 1, -1), 1, 'stays on the first');
});

test('bounds: 0.02 s from the neighbours; the last unit up to an explicit end, else up to the span', () => {
  const { p, line, ls } = estimated();
  const i = p.lines.indexOf(line);
  const spanEnd = TK.spanEndOf(p.lines, i);
  const b = TK.bounds(ls, line, 2, spanEnd);
  assert.ok(Math.abs(b.lo - (ls.t[1] + 0.02)) < 1e-9 && Math.abs(b.hi - (ls.t[3] - 0.02)) < 1e-9);
  const n = ls.t.length;
  assert.equal(ls.endSrc, SU.SRC.est);
  assert.ok(Math.abs(TK.bounds(ls, line, n - 1, spanEnd).hi - (spanEnd - 0.02)) < 1e-9, 'estimated end: the span');
  const pinned = Object.assign({}, ls, { endSrc: SU.SRC.pin });
  assert.ok(Math.abs(TK.bounds(pinned, line, n - 1, spanEnd).hi - (ls.end - 0.02)) < 1e-9, 'explicit end: the end');
  assert.equal(TK.bounds(ls, line, 0, spanEnd).lo, line.t0);
});

test('a drag writes every unit where it is, the moved one where it went, and pins an automatic start (one batch)', () => {
  const { doc, p, line, ls } = estimated();
  const u = 3;
  const b = TK.bounds(ls, line, u, TK.spanEndOf(p.lines, p.lines.indexOf(line)));
  const to = Math.round((b.lo + (b.hi - b.lo) * 0.8) * 1000) / 1000;
  const cmds = TK.moveCmds(ls, line, u, to);
  assert.deepEqual(cmds.map((c) => c.path), ['line/' + line.id + ':start', 'line/' + line.id + ':sung.times']);
  assert.ok(cmds.every((c) => c.by === 'user'));
  assert.ok(SU.acceptSungTimes(line.text)(cmds[1].v, 'pin:line').v, 'the planner accepts the pin');
  assert.equal(cmds[1].v.length, ls.t.length, 'no end pair while the end is estimated');
  const p2 = planOf(apply(doc, cmds));
  const l2 = lineOf(p2, line.id), ls2 = p2.sung.get(line.id);
  assert.ok(Math.abs(l2.t0 - line.t0) < 0.001, 'the start stays where it was');
  assert.equal(l2.by.start, 'pin');
  assert.ok(Math.abs(ls2.t[u] - to) < 0.002, 'the moved unit is where it was dropped');
  for (let k = 0; k < ls.t.length; k++) if (k !== u) assert.ok(Math.abs(ls2.t[k] - ls.t[k]) < 0.002, 'unit ' + k + ' stays');
  assert.equal(ls2.by, 'pin');
  assert.equal(ls2.pinBy, 'user');
  // a pinned start is not pinned again; an explicit end keeps its pair
  const again = TK.moveCmds(ls2, l2, u, to + 0.01);
  assert.deepEqual(again.map((c) => c.path), ['line/' + line.id + ':sung.times']);
  const tapped = withPins(corpus.project('basic').doc, { 'line/r5:sung.times': pin([[0, 0], [3, 0.6], [lineOf(p, 'r5').text.length, 1.8]], 'tap') });
  const pt = planOf(tapped), lt = lineOf(pt, 'r5'), lst = pt.sung.get('r5');
  assert.equal(lst.endSrc, SU.SRC.pin);
  const v = TK.moveCmds(lst, lt, 1, lst.t[1] + 0.05).slice(-1)[0].v;
  assert.deepEqual(v[v.length - 1], [lt.text.length, 1.8], 'the end pair is kept');
  assert.ok(SU.acceptSungTimes(lt.text)(v, 'pin:line').v);
});

test('a pair closer than the planner\'s gap to the one before is left out; the moved one is kept', () => {
  const line = { id: 'x', text: 'あいうえお', lang: 'ja', t0: 10, t1: 12, by: { start: 'pin', end: 'auto' } };
  const ls = { at: Int32Array.from([0, 1, 2, 3, 4]), t: Float64Array.from([10, 10.004, 10.008, 10.5, 11]), end: 11.5,
    endSrc: SU.SRC.est, src: new Uint8Array(5) };
  const v = TK.movedPin(ls, line, 10, 3, 10.6);
  assert.deepEqual(v, [[0, 0], [3, 0.6], [4, 1]]);
  assert.ok(SU.acceptSungTimes(line.text)(v, 'pin:line').v);
});

test('double-click / Delete: the unit\'s pair leaves the pin (interpolated again); the last pair clears it', () => {
  const doc = withPins(corpus.project('basic').doc, { 'line/r5:sung.times': pin([[0, 0], [3, 0.6], [5, 1.2]], 'tap') });
  const p = planOf(doc), line = lineOf(p, 'r5'), ls = p.sung.get('r5');
  const u3 = SU.unitAt(SU.unitsOf(line.text, line.lang), 3);
  const cmd = TK.removeCmd(line, u3, doc.pins['line/r5:sung.times']);
  assert.deepEqual(cmd, { t: 'pin.set', path: 'line/r5:sung.times', v: [[0, 0], [5, 1.2]], by: 'user' });
  const ls2 = planOf(C.reduce(doc, cmd)).sung.get('r5');
  assert.equal(ls2.src[u3], SU.SRC.est, 'estimated again');
  assert.notEqual(ls2.t[u3], ls.t[u3]);
  assert.equal(TK.removeCmd(line, 1, doc.pins['line/r5:sung.times']), null, 'a unit without a pair: nothing');
  assert.equal(TK.removeCmd(line, u3, undefined), null, 'no pin: nothing');
  assert.deepEqual(TK.removeCmd(line, 0, pin([[0, 0]])), { t: 'pin.clear', path: 'line/r5:sung.times' });
});

test('the listbox names a focused tick: 「{ch}の時間 {time}」', () => {
  const { line, ls } = estimated();
  const ja = T.createT('ja', STRINGS), en = T.createT('en', STRINGS);
  const ch = TK.unitText(ls, line, 2);
  assert.equal(TK.label(ja, ls, line, 2), ch + 'の時間 ' + T.fmtTime(ls.t[2]));
  assert.equal(TK.label(en, ls, line, 2), ch + ' at ' + T.fmtTime(ls.t[2]));
});
