/* 文字PVメーカー v2 — original work. Tests: ui/draft's pure parts — which lines 曲から下書き drafts, the one time.tap it applies, the default checks and counts (PV22 S1, DESIGN_2_2 §5.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const DR = MV.use('ui/draft');
const CD = MV.use('core/draft');
const TM = MV.use('core/timing');
const PL = MV.use('planner/plan');
const D = MV.use('core/doc');
const CMD = MV.use('core/commands');
const BASE = MV.use('parts/catalog').defaultRegistry();

// Six lines of placeholder kana; line 4 has an LRC time, a blank row above line 5.
const TEXT = 'あいうえおかき\nさしすせそ\nたちつてとなにぬ\n[00:20.00]はひふへほ\n\nまみむめも\nやゆよらりるれろ';

function docOf(pins) {
  const doc = CMD.reduce(D.defaultDoc(), { t: 'lyrics.set', text: TEXT });
  return Object.assign({}, doc, { pins: Object.assign({}, doc.pins, pins || {}) });
}
function plan(doc) { return PL.run(doc, BASE, { fresh: true }); }
function ids(doc) { return plan(doc).lines.map((l) => l.id); }

test('input: automatic starts are drafted; LRC, AI and lock starts are anchors; redo adds tapped and hand-set starts', () => {
  const [a, b, c, d, e, f] = ids(docOf());
  const doc = docOf({ ['line/' + a + ':start']: { v: 3, by: 'tap' }, ['line/' + b + ':start']: { v: 6, by: 'user' },
    ['line/' + c + ':start']: { v: 9, by: 'ai' }, ['line/' + e + ':start']: { v: 25, by: 'lock' } });
  const p = plan(doc);
  const plain = DR.input(doc, p, {});
  const by = (inp) => Object.fromEntries(inp.lines.map((l) => [l.id, l.draft]));
  assert.deepEqual(by(plain), { [a]: false, [b]: false, [c]: false, [d]: false, [e]: false, [f]: true });
  assert.deepEqual(by(DR.input(doc, p, { redo: true })), { [a]: true, [b]: true, [c]: false, [d]: false, [e]: false, [f]: true },
    'tap and user starts only; never the LRC time, the AI time or the lock');
  assert.deepEqual([...plain.tapped], [a], 'the tapped start (the agreement readout)');
  assert.deepEqual(plain.lines.map((l) => l.auto), [false, false, false, false, false, true]);
  plain.lines.forEach((l, i) => assert.equal(l.t0, p.lines[i].t0));
});

test('input: the gap weights are core/timing\'s (the read rate pin, the blank row above a line)', () => {
  const doc = docOf({ 'work:readRate': { v: 5, by: 'user' } });
  const p = plan(doc);
  const inp = DR.input(doc, p, {});
  const want = TM.gapWeights(p.lines.map((l, i) => ({ text: l.text, lang: l.lang, pauseBefore: i === 4 ? 1 : 0 })), { readRate: 5 });
  assert.deepEqual(inp.lines.map((l) => l.w), [...want]);
  assert.ok(inp.lines[3].w > TM.gapWeights([{ text: p.lines[3].text, lang: 'ja' }], { readRate: 5 })[0], 'the pause above line 5 counts');
});

test('applyCmd: one time.tap with the checked starts in line order; pins by tap after reduce', () => {
  const doc = docOf();
  const p = plan(doc);
  const inp = DR.input(doc, p, {});
  const L = inp.lines;
  const res = {
    proposals: [{ lineId: L[4].id, from: L[4].t0, to: 24.5, conf: 'high', kind: 'phrase' },
      { lineId: L[0].id, from: L[0].t0, to: 1.5, conf: 'mid', kind: 'weak' },
      { lineId: L[2].id, from: L[2].t0, to: 12.25, conf: 'low', kind: 'filler' }],
    kept: [{ lineId: L[1].id, from: L[1].t0, to: L[1].t0 + 0.02, conf: 'mid', kind: 'phrase' },
      { lineId: L[5].id, from: L[5].t0, to: L[5].t0, conf: 'low', kind: 'filler' }],
    skipped: [],
  };
  const checked = DR.checkedByDefault(res);
  assert.deepEqual([...checked].sort(), [L[0].id, L[4].id].sort(), '確か and たぶん are checked, 自信なし is not');
  assert.deepEqual(DR.counts(res), { a: 1, b: 1, c: 1 });
  assert.equal(DR.drafted(L, res), 4, 'three proposals and the kept line on an onset');
  const cmd = DR.applyCmd(L, res, checked);
  assert.equal(cmd.t, 'time.tap');
  assert.deepEqual(cmd.marks, [{ lineId: L[0].id, start: 1.5 }, { lineId: L[1].id, start: L[1].t0 + 0.02 }, { lineId: L[4].id, start: 24.5 }],
    'line order; a kept line on an onset is pinned where it is; the unchecked and the kept filler are not');
  const out = CMD.reduce(doc, cmd);
  for (const m of cmd.marks) assert.deepEqual(out.pins['line/' + m.lineId + ':start'], { v: m.start, by: 'tap' });
  assert.equal(DR.applyCmd(L, res, new Set()).marks.length, 1, 'only the kept line');
  assert.equal(DR.applyCmd(L, { proposals: [], kept: [], skipped: [] }, new Set()), null);
});

test('the whole path: a draft of the automatic lines applies as one undoable command', () => {
  const doc = docOf();
  const p = plan(doc);
  const inp = DR.input(doc, p, {});
  const cands = [3.1, 7.4, 11.2, 23.6, 27.9].map((t) => ({ t, s: 0.9, kind: 'phrase' }));
  const res = CD.draftStarts({ lines: inp.lines, cands, voiced: { t0: 3.1, t1: 32 }, duration: p.duration, grid: null, snap: 'off' });
  const cmd = DR.applyCmd(inp.lines, res, DR.checkedByDefault(res));
  const out = CMD.reduce(doc, cmd);
  const after = plan(out);
  // the LRC line stays at its time; every drafted line is pinned at its proposal
  assert.equal(after.lines[3].t0, 20);
  for (const m of cmd.marks) assert.equal(after.lines.find((l) => l.id === m.lineId).t0, m.start);
  for (let i = 1; i < after.lines.length; i++) assert.ok(after.lines[i].t0 > after.lines[i - 1].t0, 'order kept');
  assert.deepEqual(after.warnings.filter((w) => w.code === 'time-order'), []);
});
