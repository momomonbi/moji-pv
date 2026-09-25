/* 文字PVメーカー v2 — original work. Tests for core/timing and core/beats (DESIGN §4.11). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const T = MV.use('core/timing');
const B = MV.use('core/beats');
const L = MV.use('core/lyrics');
const P = MV.use('core/pins');

const KANA = 'あいうえおかきくけこさしすせそたちつてと';
const TIMING = { snap: 'off', lead: 0.12, tail: 0.25, leadIn: 1, outro: 2, tapLatency: 0.06 };

// A line of `n` kana (n morae); with readRate 5 its reading slot is n / 5 seconds (at least 1.2).
function line(id, n = 10, extra = {}) {
  return Object.assign({ id, row: id, occ: 0, index: 0, text: KANA.slice(0, n), pieces: null, emph: [], impact: false,
    note: null, lang: 'ja', stamp: null, pauseBefore: 0, heading: null }, extra);
}
function solve(lines, ctx = {}) {
  return T.solveTimes(lines, Object.assign({ pins: P.index(ctx.pinMap || {}), timing: TIMING, songSeconds: null,
    bpm: null, readRate: 5, lengthPin: null, titleCard: 0 }, ctx));
}
function starts(res) { return res.times.map((t) => t.t0); }
function ends(res) { return res.times.map((t) => t.t1); }
function froms(res) { return res.times.map((t) => t.by.start); }
function codes(res) { return res.warnings.map((w) => w.code + (w.line ? ':' + w.line : '')); }

test('no anchors: forward fill from max(titleCard, leadIn) at the nominal rate', () => {
  const res = solve([line('r1'), line('r2'), line('r3', 5)]);
  assert.deepEqual(starts(res), [1, 3, 5]);
  assert.deepEqual(froms(res), ['auto', 'auto', 'auto']);
  assert.deepEqual(solve([line('r1'), line('r2')], { titleCard: 2 }).times[0].t0, 2);
  assert.deepEqual(starts(solve([line('r1'), line('r2', 10, { pauseBefore: 2 })])), [1, 3 + 1.6], 'pauses add 0.8 s each');
  assert.deepEqual(res.warnings, []);
});

test('anchors and interpolation between them', () => {
  const lines = [line('r1', 10, { stamp: 10 }), line('r2', 5), line('r3', 15), line('r4', 10, { stamp: 20 })];
  const res = solve(lines);
  // gaps: r1→r2 2, r2→r3 1.2 (minimum reading), r3→r4 3; total 6.2 over 10 s
  approx(starts(res), [10, 10 + 10 * 2 / 6.2, 10 + 10 * 3.2 / 6.2, 20], 1e-6);
  assert.deepEqual(froms(res), ['lrc', 'auto', 'auto', 'lrc']);
});

test('back-fill before the first anchor, compressed when it would start too early', () => {
  assert.deepEqual(starts(solve([line('r1'), line('r2'), line('r3', 10, { stamp: 10 })])), [6, 8, 10]);
  const tight = solve([line('r1'), line('r2'), line('r3', 10, { stamp: 3 })]);
  approx(starts(tight), [0, 1.5, 3], 1e-9);
  assert.deepEqual(codes(tight), ['time-compressed:r1']);
  const titled = solve([line('r1'), line('r2'), line('r3', 10, { stamp: 3 })], { titleCard: 2 });
  approx(starts(titled), [2, 2.5, 3], 1e-9, 'compressed into [titleCard, anchor]');
});

test('a first anchor with less than 0.1 s per line above it is demoted, so starts stay strictly increasing', () => {
  // '[00:00.00]' below two untagged rows: they cannot start before 0, so the stamp is out of order.
  const zero = solve([line('r1'), line('r2'), line('r3', 10, { stamp: 0 }), line('r4', 10, { stamp: 10 })]);
  assert.deepEqual(froms(zero), ['auto', 'auto', 'auto', 'lrc']);
  assert.deepEqual(starts(zero), [4, 6, 8, 10]);
  assert.deepEqual(codes(zero), ['time-order:r3']);
  const onlyZero = solve([line('r1'), line('r2', 10, { stamp: 0 })]);
  assert.deepEqual(starts(onlyZero), [1, 3], 'no anchor left: forward fill from leadIn');

  // A tap clamped to 0 under an untagged line: the pin is reported with its path.
  const tap = solve([line('r1'), line('r2')], { pinMap: { 'line/r2:start': { v: 0, by: 'tap' } } });
  assert.deepEqual(tap.warnings, [{ code: 'time-order', line: 'r2', path: 'line/r2:start' }]);
  assert.deepEqual(froms(tap), ['auto', 'auto']);

  const near = solve([line('r1'), line('r2'), line('r3', 10, { stamp: 0.15 })]);
  assert.deepEqual(froms(near), ['auto', 'auto', 'auto'], '0.15 s cannot hold two lines of 0.1 s');
  const room = solve([line('r1'), line('r2'), line('r3', 10, { stamp: 0.25 })]);
  approx(starts(room), [0, 0.125, 0.25], 1e-9);
  assert.deepEqual(codes(room), ['time-compressed:r1']);
  assert.deepEqual(solve([line('r1', 10, { stamp: 0 }), line('r2')]).warnings, [], 'a first line may start at 0');
});

test('back-fill ignores the title card when it leaves less than 0.1 s per line', () => {
  const res = solve([line('r1'), line('r2'), line('r3', 10, { stamp: 2.1 })], { titleCard: 2 });
  approx(starts(res), [0, 1.05, 2.1], 1e-9);
  assert.deepEqual(codes(res), ['time-compressed:r1']);
});

test('an anchor that cannot stand does not demote others', () => {
  // The pin beats the LRC stamp it conflicts with, but would then be first with no room above it: the pin is
  // demoted and the stamp stays.
  const crowded = solve([line('r1'), line('r2', 10, { stamp: 5 }), line('r3'), line('r4')],
    { pinMap: { 'line/r4:start': { v: 0.2, by: 'tap' } } });
  assert.deepEqual(froms(crowded), ['auto', 'lrc', 'auto', 'auto']);
  assert.deepEqual(crowded.warnings, [{ code: 'time-order', line: 'r4', path: 'line/r4:start' }]);
  // The later of two pins loses; the stamp between them no longer conflicts with anything.
  const pins = solve([line('r1'), line('r2', 10, { stamp: 12 }), line('r3')],
    { pinMap: { 'line/r1:start': { v: 10, by: 'user' }, 'line/r3:start': { v: 10.05, by: 'user' } } });
  assert.deepEqual(froms(pins), ['pin', 'lrc', 'auto']);
  assert.deepEqual(codes(pins), ['time-order:r3']);
});

test('fuzz: starts are non-negative and strictly increasing; every line lasts at least 0.2 s', () => {
  const rng = MV.use('core/rng').stream('timing-fuzz');
  const known = new Set(['time-order', 'time-compressed', 'pin-bad-value']);
  for (let n = 0; n < 400; n++) {
    const lines = [], pinMap = {};
    const count = rng.int(1, 12);
    for (let i = 0; i < count; i++) {
      const id = 'r' + (i + 1).toString(36);
      const stamp = rng.chance(0.3) ? (rng.chance(0.2) ? 0 : rng.range(0, 20)) : null;
      lines.push(line(id, rng.int(1, 20), { stamp, pauseBefore: rng.chance(0.2) ? rng.int(1, 3) : 0 }));
      if (rng.chance(0.15)) pinMap['line/' + id + ':start'] = { v: rng.chance(0.2) ? 0 : rng.range(0, 20), by: 'tap' };
      if (rng.chance(0.1)) pinMap['line/' + id + ':end'] = { v: rng.range(0, 25), by: 'user' };
    }
    const timing = Object.assign({}, TIMING, { snap: rng.pick(['off', 'beat', 'half', 'bar']) });
    const res = solve(lines, { pinMap, timing, titleCard: rng.chance(0.3) ? 2 : 0,
      songSeconds: rng.chance(0.5) ? rng.range(5, 60) : null, bpm: rng.chance(0.5) ? rng.range(60, 180) : null });
    const where = JSON.stringify({ lines: lines.map((l) => [l.text.length, l.stamp, l.pauseBefore]), pinMap });
    res.times.forEach((t, i) => {
      assert.ok(Number.isFinite(t.t0) && t.t0 >= 0, where);
      if (i) assert.ok(t.t0 > res.times[i - 1].t0, 'order at ' + t.id + ' ' + where);
      assert.ok(t.t1 >= t.t0 + 0.2 - 1e-9, where);
    });
    for (const w of res.warnings) assert.ok(known.has(w.code), w.code);
  }
});

test('forward fill after the last anchor; compressed to end by songSeconds − outro', () => {
  const lines = [line('r1', 10, { stamp: 10 }), line('r2'), line('r3'), line('r4'), line('r5'), line('r6')];
  assert.deepEqual(starts(solve(lines)), [10, 12, 14, 16, 18, 20], 'no song: no compression');
  const res = solve(lines, { songSeconds: 20 });
  // nominal fill ends at 20 + 2 = 22 > 20 − 2: [10, 22] maps onto [10, 18]
  approx(starts(res), [10, 10 + 2 * 8 / 12, 10 + 4 * 8 / 12, 10 + 6 * 8 / 12, 10 + 8 * 8 / 12, 10 + 10 * 8 / 12], 1e-6);
  assert.deepEqual(codes(res), ['time-compressed:r2']);
  assert.deepEqual(solve(lines, { songSeconds: 40 }).warnings, [], 'enough room: nominal');
  const noAnchor = solve([line('r1'), line('r2'), line('r3')], { songSeconds: 6 });
  approx(starts(noAnchor), [1, 1 + 2 * 3 / 6, 1 + 4 * 3 / 6], 1e-6, 'also without anchors');
});

test('a single tag never discards the others', () => {
  const lines = [line('r1'), line('r2'), line('r3', 10, { stamp: 30 }), line('r4'), line('r5')];
  const res = solve(lines);
  assert.equal(res.times.length, 5);
  assert.deepEqual(starts(res), [26, 28, 30, 32, 34]);
  const { doc } = corpus.project('lrc');
  const all = L.linesOf(L.parseSheet(doc.sheet.rows));
  const lrc = solve(all, { readRate: null });
  assert.deepEqual(lrc.warnings, []);
  for (const [i, l] of all.entries()) if (l.stamp !== null) assert.equal(lrc.times[i].t0, l.stamp, l.id);
  assert.deepEqual(lrc.times.map((t) => t.id), all.map((l) => l.id));
});

test('demotion order: LRC before pins, the later of two pins', () => {
  const lrcBack = solve([line('r1', 10, { stamp: 10 }), line('r2', 10, { stamp: 5 }), line('r3')]);
  assert.deepEqual(froms(lrcBack), ['lrc', 'auto', 'auto']);
  assert.deepEqual(lrcBack.warnings, [{ code: 'time-order', line: 'r2' }]);

  const pinOverLrc = solve([line('r1', 10, { stamp: 10 }), line('r2')], { pinMap: { 'line/r2:start': { v: 5, by: 'tap' } } });
  assert.deepEqual(froms(pinOverLrc), ['auto', 'pin']);
  assert.deepEqual(codes(pinOverLrc), ['time-order:r1']);
  assert.equal(pinOverLrc.times[1].t0, 5);

  const twoPins = solve([line('r1'), line('r2')], {
    pinMap: { 'line/r1:start': { v: 10, by: 'user' }, 'line/r2:start': { v: 5, by: 'user' } },
  });
  assert.deepEqual(froms(twoPins), ['pin', 'auto']);
  assert.deepEqual(twoPins.warnings, [{ code: 'time-order', line: 'r2', path: 'line/r2:start' }]);

  const tooClose = solve([line('r1'), line('r2', 10, { stamp: 10.05 })], { pinMap: { 'line/r1:start': { v: 10, by: 'tap' } } });
  assert.deepEqual(froms(tooClose), ['pin', 'auto'], 'closer than 0.1 s is out of order');

  const cascade = solve([line('r1', 10, { stamp: 10 }), line('r2', 10, { stamp: 12 }), line('r3')],
    { pinMap: { 'line/r3:start': { v: 11, by: 'ai' } } });
  assert.deepEqual(froms(cascade), ['lrc', 'auto', 'pin'], 'the pin demotes only the LRC anchors it conflicts with');
});

test('pins beat LRC stamps; bad and misplaced pins are ignored', () => {
  const res = solve([line('r1', 10, { stamp: 10 }), line('r2', 10, { stamp: 20 })],
    { pinMap: { 'line/r1:start': { v: 12, by: 'tap' }, 'work:start': { v: 1, by: 'user' } } });
  assert.deepEqual(starts(res), [12, 20]);
  assert.deepEqual(froms(res), ['pin', 'lrc']);
  const bad = solve([line('r1', 10, { stamp: 10 })], { pinMap: { 'line/r1:start': { v: 'soon', by: 'user' } } });
  assert.deepEqual(froms(bad), ['lrc']);
  assert.deepEqual(bad.warnings, [{ code: 'pin-bad-value', path: 'line/r1:start', line: 'r1' }]);
  const plain = T.solveTimes([line('r1')], { pins: { 'line/r1:start': { v: 3, by: 'user' } }, timing: TIMING });
  assert.equal(plain.times[0].t0, 3, 'a plain pins map is indexed on the fly');
});

test('snap moves only auto starts, to beat / half / bar within ±min(0.12, period/4)', () => {
  const lines = [line('r1', 10, { stamp: 1.1 }), line('r2', 10), line('r3', 10)];
  const off = solve(lines, { bpm: 120 });
  assert.deepEqual(starts(off), [1.1, 3.1, 5.1]);
  const beat = solve(lines, { bpm: 120, timing: Object.assign({}, TIMING, { snap: 'beat' }) });
  assert.deepEqual(starts(beat), [1.1, 3, 5], 'LRC anchor unchanged, auto starts on the beat');
  const bar = solve(lines, { bpm: 120, timing: Object.assign({}, TIMING, { snap: 'bar' }) });
  assert.deepEqual(starts(bar), [1.1, 3.1, 5.1], 'bar lines at 2 s are too far away');
  const half = solve([line('r1', 11, { stamp: 1 }), line('r2')], { bpm: 120, timing: Object.assign({}, TIMING, { snap: 'half' }) });
  assert.deepEqual(starts(half), [1, 3.25], 'auto 3.2 → 3.25 on the half-beat grid');
  const offset = solve(lines, { bpm: 120, beatOffset: 0.2, timing: Object.assign({}, TIMING, { snap: 'beat' }) });
  assert.deepEqual(starts(offset), [1.1, 3.2, 5.2], 'beatOffset shifts the grid');
  const noBpm = solve(lines, { timing: Object.assign({}, TIMING, { snap: 'beat' }) });
  assert.deepEqual(starts(noBpm), [1.1, 3.1, 5.1], 'no BPM: no snapping');
  const pinned = solve(lines, { bpm: 120, timing: Object.assign({}, TIMING, { snap: 'beat' }),
    pinMap: { 'line/r2:start': { v: 3.1, by: 'user' } } });
  assert.deepEqual(starts(pinned)[1], 3.1, 'pins never move');
});

test('readRate: pin, then bpm / 20 clamped to 3..14, then 7', () => {
  const ctx = (o) => Object.assign({ readRate: null, bpm: null }, o);
  assert.equal(T.readRateOf(ctx({ readRate: 10 })), 10);
  assert.equal(T.readRateOf(ctx({ readRate: 20, bpm: 100 })), 14);
  assert.equal(T.readRateOf(ctx({ bpm: 100 })), 5);
  assert.equal(T.readRateOf(ctx({ bpm: 300 })), 14);
  assert.equal(T.readRateOf(ctx({ bpm: 30 })), 3);
  assert.equal(T.readRateOf(ctx({})), 7);
  const lines = [line('r1', 20), line('r2', 20)];
  assert.deepEqual(starts(solve(lines, { readRate: 10 })), [1, 3]);
  assert.deepEqual(starts(solve(lines, { readRate: null, bpm: 80 })), [1, 6], 'bpm 80 → 4 morae/s');
  approx(starts(solve(lines, { readRate: null })), [1, 1 + 20 / 7], 1e-6);
  assert.deepEqual(starts(solve([line('r1', 1), line('r2')], { readRate: 5 })), [1, 2.2], 'at least 1.2 s per line');
});

test('end rules: pins, the pause above the next line, the natural length, the last line, the 0.2 s minimum', () => {
  const lines = [line('r1', 10, { stamp: 10 }), line('r2', 10, { stamp: 20, pauseBefore: 1 }),
    line('r3', 10, { stamp: 21, pauseBefore: 5 }), line('r4', 10, { stamp: 40 }), line('r5', 30, { stamp: 50 })];
  const res = solve(lines, { songSeconds: 55, pinMap: { 'line/r4:end': { v: 42.5, by: 'user' } } });
  // r1: min(20 − 0.4·1, 10 + max(4, 1.5·2)) = 14 · r2: min(21 − min(0.4·5, 1.2), …) = 19.8, raised to t0 + 0.2
  // r3: min(40, 21 + max(4, 1.5·(2 + 0.8·5))) = 30 · r4: pin · r5 (last): min(55 − 2·0.5, 50 + max(4, 1.5·4)) = 54
  assert.deepEqual(ends(res), [14, 20.2, 30, 42.5, 54]);
  assert.deepEqual(res.times.map((t) => t.by.end), ['auto', 'auto', 'auto', 'pin', 'auto']);
  const close = solve([line('r1', 10, { stamp: 10 }), line('r2', 10, { stamp: 10.1 })]);
  assert.deepEqual(ends(close)[0], 10.2, 't1 ≥ t0 + 0.2');
  const early = solve([line('r1', 10, { stamp: 10 })], { pinMap: { 'line/r1:end': { v: 9, by: 'user' } } });
  assert.deepEqual(ends(early), [10.2]);
  const long = solve([line('r1', 20, { stamp: 10 })], { readRate: 3 });
  approx(ends(long), [10 + 1.5 * 20 / 3], 1e-6, 'max(4, 1.5·w)');
});

test('duration: length pin → song → last end + outro', () => {
  const lines = [line('r1'), line('r2')];
  assert.equal(solve(lines).duration, 3 + 4 + 2);
  assert.equal(solve(lines, { songSeconds: 90 }).duration, 90);
  assert.equal(solve(lines, { songSeconds: 90, lengthPin: 30 }).duration, 30);
  const bad = solve(lines, { lengthPin: -1 });
  assert.equal(bad.duration, 9);
  assert.deepEqual(bad.warnings, [{ code: 'pin-bad-value', path: 'work:length' }]);
  assert.equal(solve([]).duration, 3, 'no lines: leadIn + outro');
  assert.deepEqual(solve([]).times, []);
  const lastCut = solve([line('r1', 10, { stamp: 10 })], { songSeconds: 12 });
  assert.equal(lastCut.times[0].t1, 11, 'the last line ends by duration − outro / 2');
});

test('solveTimes is deterministic, monotonic on the fixtures, and fast for 300 lines', () => {
  for (const { name, doc } of corpus.projects()) {
    const lines = L.linesOf(L.parseSheet(doc.sheet.rows));
    const ctx = { pins: P.index(doc.pins), timing: doc.timing, songSeconds: doc.song ? doc.song.seconds : null,
      bpm: doc.song ? doc.song.bpm : null, beatOffset: doc.song ? doc.song.offset : 0, readRate: null, lengthPin: null,
      titleCard: 0 };
    const a = T.solveTimes(lines, ctx), b = T.solveTimes(lines, ctx);
    assert.deepEqual(a, b, name);
    a.times.forEach((t, i) => {
      assert.ok(t.t1 >= t.t0 + 0.2 - 1e-9, name + ' ' + t.id);
      if (i) assert.ok(t.t0 > a.times[i - 1].t0, name + ' order at ' + t.id);
    });
    assert.ok(a.duration > 0);
  }
  const { doc } = corpus.project('long');
  const base = L.linesOf(L.parseSheet(doc.sheet.rows));
  const lines = [];
  for (let i = 0; lines.length < 300; i++) lines.push(Object.assign({}, base[i % base.length], { id: 'r' + (i + 1).toString(36) }));
  const ctx = { pins: P.index({}), timing: doc.timing, songSeconds: 240, bpm: 128, readRate: null, lengthPin: null, titleCard: 0 };
  for (let i = 0; i < 5; i++) T.solveTimes(lines, ctx);
  const times = [];
  for (let i = 0; i < 9; i++) {
    const t0 = process.hrtime.bigint();
    T.solveTimes(lines, ctx);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((x, y) => x - y);
  assert.ok(times[4] < 2 * 3, `median ${times[4].toFixed(3)} ms (budget 2 ms, CI margin ×3)`);
});

test('beats.grid: beatAt, barAt, snap, beatsIn', () => {
  assert.equal(B.grid({ bpm: null }), null);
  assert.equal(B.grid({ bpm: 0 }), null);
  const g = B.grid({ bpm: 120, offset: 0.25, meter: 4 });
  assert.equal(g.period, 0.5);
  assert.deepEqual([g.bpm, g.offset, g.meter], [120, 0.25, 4]);
  assert.deepEqual(g.beatAt(0.25), { index: 0, phase: 0, since: 0 });
  const b = g.beatAt(1.5);
  assert.equal(b.index, 2);
  approx(b.phase, 0.5);
  approx(b.since, 0.25);
  assert.equal(g.beatAt(0).index, -1, 'before the offset');
  assert.deepEqual(g.barAt(2.25), { index: 1, phase: 0 });
  approx(g.barAt(3.25).phase, 0.5);
  assert.equal(g.snap(1.2, 'beat', 0.1), 1.25);
  assert.equal(g.snap(1.1, 'beat', 0.1), 1.1, 'outside the tolerance');
  assert.equal(g.snap(1.1, 'half'), 1);
  assert.equal(g.snap(1.1, 'bar'), 0.25);
  assert.equal(g.snap(1.4), 1.25, 'beat and no tolerance by default');
  assert.deepEqual(Array.from(g.beatsIn(0, 2)), [0.25, 0.75, 1.25, 1.75]);
  assert.deepEqual(Array.from(g.beatsIn(0.25, 0.75)), [0.25], '[t0, t1)');
  assert.equal(g.beatsIn(2, 1).length, 0);
  assert.deepEqual(B.UNITS, ['beat', 'half', 'bar']);
});
