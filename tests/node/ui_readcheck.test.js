/* 文字PVメーカー v2 — original work. Tests: ui/readcheck — the 読み切れない速さ switch, the notices, the gutter's codes and texts, and the 行 page's quick fixes (PV22 S4, DESIGN_2_2 §5). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const RC = MV.use('ui/readcheck');
const RD = MV.use('planner/readable');
const PL = MV.use('planner/plan');
const D = MV.use('core/doc');
const CMD = MV.use('core/commands');
const T = MV.use('i18n/t');
const STRINGS = MV.use('i18n/strings');
const BASE = MV.use('parts/catalog').defaultRegistry();
const ja = T.createT('ja', STRINGS, null, { strict: true });
const en = T.createT('en', STRINGS, null, { strict: true });

const SQUEEZED = '[00:10.00]あいう\nさしすせそたちつてとな\nはひふへほまみむめもや\n[00:11.50]らりるれろ';

function docOf(text, base) { return CMD.reduce(base || D.defaultDoc(), { t: 'lyrics.set', text }); }
function withTiming(doc, timing) { return Object.assign({}, doc, { timing: Object.assign({}, doc.timing, timing) }); }
function withPins(doc, pins) { return Object.assign({}, doc, { pins: Object.assign({}, doc.pins, pins) }); }
function plan(doc) { return PL.run(doc, BASE, { fresh: true }); }

test('enabled: an explicit switch wins; absent, it follows the work\'s generation (look.gen)', () => {
  assert.equal(RC.enabled(D.defaultDoc()), false, 'an older work (and every fixture): off');
  assert.equal(RC.enabled(D.newDoc()), true, 'a new work: on');
  assert.equal(RC.enabled(withTiming(D.newDoc(), { readCheck: false })), false);
  assert.equal(RC.enabled(withTiming(D.defaultDoc(), { readCheck: true })), true);
  assert.equal(RC.enabled(null), false);
  // the switch is a timing setting: one undoable command, validated
  const on = CMD.reduce(D.defaultDoc(), { t: 'timing.set', key: 'readCheck', v: true });
  assert.equal(on.timing.readCheck, true);
  assert.throws(() => CMD.reduce(D.defaultDoc(), { t: 'timing.set', key: 'readCheck', v: 1 }));
});

test('readWarnings: nothing while the notices are off; one too-fast notice per flagged cut when on', () => {
  const doc = docOf(SQUEEZED);
  const p = plan(doc);
  assert.deepEqual(RC.readWarnings(doc, p, BASE), []);
  const on = withTiming(doc, { readCheck: true });
  const list = RC.readWarnings(on, p, BASE);
  const ids = doc.sheet.rows.map((r) => r.id);
  assert.deepEqual(list.map((w) => [w.code, w.line]), [['too-fast', ids[1]], ['too-fast', ids[2]]]);
  const x = RD.check(p, BASE)[0];
  assert.deepEqual(list[0], { code: 'too-fast', line: x.line, cut: x.cut, detail: { rate: x.rate, units: x.units, legible: x.legible, limit: x.limit } });
  // a new work sees them without touching the switch
  const fresh = docOf(SQUEEZED, D.newDoc());
  assert.equal(RC.readWarnings(fresh, plan(fresh), BASE).length, 2);
});

test('expand: a squeezed range is marked on each of its lines; other warnings pass through', () => {
  const p = { lines: ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => ({ id })) };
  const first = { code: 'time-compressed', line: 'r2', detail: { lines: 3 } };
  const other = { code: 'overfull', line: 'r1', cut: 'r1~0' };
  const out = RC.expand([other, first], p);
  assert.deepEqual(out.map((w) => [w.code, w.line]), [['overfull', 'r1'], ['time-compressed', 'r2'], ['time-compressed', 'r3'], ['time-compressed', 'r4']]);
  assert.equal(out[1], first, 'the first line keeps the warning itself');
  assert.deepEqual(out[2].detail, { lines: 3, of: 'r2' });
  assert.deepEqual(RC.expand([{ code: 'time-compressed', line: 'r5', detail: { lines: 4 } }], p).length, 1, 'clipped at the last line');
  assert.deepEqual(RC.expand([{ code: 'time-compressed', line: 'zz', detail: { lines: 2 } }], p).length, 1, 'unknown line');
});

test('gutterCodes: today\'s set for older works; with the notices the too-fast and squeeze marks too', () => {
  const off = RC.gutterCodes(D.defaultDoc());
  assert.deepEqual([...off].sort(), ['lock-partial', 'orphan-pin', 'overfull', 'pin-not-applicable', 'shadowed-pin', 'time-order']);
  const on = RC.gutterCodes(D.newDoc());
  for (const code of ['too-fast', 'time-compressed', 'piece-merged']) assert.ok(on.has(code), code);
  assert.equal(on.size, off.size + 3);
});

test('byLine: the codes asked for, most severe first, one per code (the fastest too-fast)', () => {
  const p = { lines: [{ id: 'r1' }, { id: 'r2' }] };
  const slow = { code: 'too-fast', line: 'r1', cut: 'r1~0', detail: { rate: 13, units: 8, legible: 0.6, limit: 12 } };
  const fast = { code: 'too-fast', line: 'r1', cut: 'r1~4', detail: { rate: 19, units: 8, legible: 0.4, limit: 12 } };
  const ws = [slow, { code: 'piece-merged', line: 'r1' }, fast, { code: 'time-order', line: 'r1' }, { code: 'part-error', line: 'r1' },
    { code: 'overfull', line: 'r2' }, { code: 'overfull', line: 'r9' }, { code: 'font-fallback' }];
  const all = RC.byLine(ws, p, null);
  assert.deepEqual(all.get('r1').map((w) => w.code), ['time-order', 'too-fast', 'piece-merged', 'part-error']);
  assert.equal(all.get('r1')[1], fast);
  assert.ok(!all.has('r9'), 'a line the plan does not have');
  const gutter = RC.byLine(ws, p, RC.gutterCodes(D.defaultDoc()));
  assert.deepEqual(gutter.get('r1').map((w) => w.code), ['time-order']);
  assert.deepEqual(gutter.get('r2').map((w) => w.code), ['overfull']);
});

test('textOf and titleFor: the rate, the size of a squeezed range on its first line, one row per text', () => {
  const fast = { code: 'too-fast', line: 'r1', detail: { rate: 19.6, units: 8, legible: 0.4, limit: 12 } };
  assert.equal(RC.textOf(ja, fast), '速すぎて読み切れないかもしれません（1秒に約20音）');
  assert.equal(RC.textOf(en, fast), 'May be too fast to read (about 20 morae a second)');
  assert.equal(RC.textOf(ja, { code: 'time-compressed', line: 'r2', detail: { lines: 3 } }), 'ここから3行の間隔を詰めて収めました');
  assert.equal(RC.textOf(en, { code: 'time-compressed', line: 'r2', detail: { lines: 1 } }), 'The 1 line from here was squeezed to fit');
  assert.equal(RC.textOf(ja, { code: 'time-compressed', line: 'r3', detail: { lines: 3, of: 'r2' } }), ja('warn.time-compressed'));
  assert.equal(RC.textOf(ja, { code: 'overfull', line: 'r2' }), ja('warn.overfull'));
  assert.equal(RC.titleFor(ja, [{ code: 'time-order' }, fast, { code: 'time-order' }]),
    ja('warn.time-order') + '\n' + '速すぎて読み切れないかもしれません（1秒に約20音）');
  assert.equal(RC.titleFor(ja, []), '');
});

test('quick fix 動きを速くする: line pins of the shared motion parameters shorten the fitted motion', () => {
  const doc = docOf(SQUEEZED);
  const id = doc.sheet.rows[1].id;
  const cmds = RC.quickerCmds(id);
  assert.deepEqual(cmds.map((c) => [c.path, c.v, c.by]), [['line/' + id + ':arrive.dur', 0.2, 'user'],
    ['line/' + id + ':arrive.each', 0.01, 'user'], ['line/' + id + ':depart.dur', 0.15, 'user'], ['line/' + id + ':depart.each', 0, 'user']]);
  const fixed = CMD.reduce(doc, { t: 'batch', cmds });
  const before = plan(doc), after = plan(fixed);
  const i = before.cuts.findIndex((c) => c.line === id), j = after.cuts.findIndex((c) => c.line === id);
  const a = RD.legibleOf(before, i, BASE), b = RD.legibleOf(after, j, BASE);
  assert.ok(b.W > a.W, 'legible ' + a.W + ' → ' + b.W);
  assert.ok(after.warnings.every((w) => w.code !== 'pin-not-applicable' && w.code !== 'pin-bad-value'));
});

test('quick fix 終わりを延ばす: only before a gap; aims at the limit, 0.3 s before the next line', () => {
  let doc = docOf('はじまり\nさしすせそたちつてとなにぬね\nおわりのぎょう');
  const ids = doc.sheet.rows.map((r) => r.id);
  doc = withTiming(withPins(doc, {
    ['line/' + ids[0] + ':start']: { v: 6, by: 'tap' }, ['line/' + ids[1] + ':start']: { v: 10, by: 'tap' },
    ['line/' + ids[1] + ':end']: { v: 10.5, by: 'tap' }, ['line/' + ids[2] + ':start']: { v: 16, by: 'tap' },
  }), { readCheck: true });
  const p = plan(doc);
  const w = RC.readWarnings(doc, p, BASE).find((x) => x.line === ids[1]);
  assert.ok(w, 'the pinned short line is too fast');
  assert.equal(RC.worstOf([w], ids[1]), w);
  const v = RC.endFix(p, ids[1], w);
  assert.ok(v !== null && v >= 10.55 && v <= 16 - 0.3 + 1e-9, 'end ' + v);
  const need = w.detail.units / w.detail.limit;
  assert.ok(Math.abs(v - Math.min(15.7, Math.floor((10.5 + 1.25 * (need - w.detail.legible)) * 100) / 100)) < 1e-9);
  const longer = CMD.reduce(doc, { t: 'pin.set', path: 'line/' + ids[1] + ':end', v, by: 'user' });
  const after = RC.readWarnings(longer, plan(longer), BASE).filter((x) => x.line === ids[1]);
  // the longer window lets the automatic entrance grow and a transition into the gap starts at the new end − lead, so
  // one step may not clear it; it reads far slower
  assert.ok(!after.length || (after[0].detail.rate < w.detail.rate / 2 && after[0].detail.legible > 3 * w.detail.legible),
    after.length ? 'rate ' + after[0].detail.rate : '');
  // the next line right after it: nothing to extend into
  const tight = CMD.reduce(doc, { t: 'pin.set', path: 'line/' + ids[2] + ':start', v: 10.6, by: 'tap' });
  const pt = plan(tight);
  const wt = RC.readWarnings(tight, pt, BASE).find((x) => x.line === ids[1]);
  assert.ok(wt);
  assert.equal(RC.endFix(pt, ids[1], wt), null);
});
