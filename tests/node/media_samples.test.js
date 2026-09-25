/* 文字PVメーカー v2 — original work. Tests for media/samples (DESIGN_2_1 §11.4.2, §11.8.2 media_samples.test.js). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const GEN = require('../helpers/make_media_fixtures.js');

const MV = load();
const SM = MV.use('media/samples');
const MEDIA = MV.use('core/media');

// A constant-rate table of `n` frames: frame k starts at tick k·step (decode order = presentation order).
function cfr(n, timescale, step, opts) {
  const o = opts || {};
  const cts = [], dur = [], key = [], off = [], size = [];
  for (let k = 0; k < n; k++) {
    cts.push(o.ticks ? o.ticks(k) : k * step);
    dur.push(step);
    key.push(k % (o.gop || 30) === 0 ? 1 : 0);
    off.push(1000 + k * 10);
    size.push(10);
  }
  return SM.build({ timescale, cts, dur, key, off, size });
}

// The MP4 timescales encoders write for these rates, with exact integer ticks per frame.
const RATES = [
  ['24 fps', 24, 12288, 512], ['25 fps', 25, 12800, 512], ['29.97 fps', 30000 / 1001, 30000, 1001], ['30 fps', 30, 15360, 512],
  ['60 fps', 60, 15360, 256],
];

test('sampleAt: m = k / fps picks frame k at every frame boundary, 100k boundaries per rate (the EPS rule)', () => {
  for (const [label, fps, timescale, step] of RATES) {
    const n = 100000;
    const t = cfr(n, timescale, step);
    for (let k = 0; k < n; k++) {
      const m = k / fps;
      const i = SM.sampleAt(t, m);
      if (i !== k) assert.fail(label + ': sampleAt(' + k + ' / fps) = ' + i);
    }
    // the EPS rule itself: a media time computed a little under a frame start (less than EPS) shows that frame; more
    // than EPS before it, the previous one (§11.4.2: 7/30 may come out as 0.23333…32)
    for (let k = 1; k < n; k += 97) {
      assert.equal(SM.sampleAt(t, k / fps - SM.EPS / 2), k, label + ' just under ' + k);
      assert.equal(SM.sampleAt(t, k / fps - 2 * SM.EPS), k - 1, label + ' before ' + k);
    }
    assert.equal(SM.sampleAt(t, -5), 0, label + ': before the start → 0');
    assert.equal(SM.sampleAt(t, 1e9), n - 1, label + ': after the end → the last frame');
    assert.ok(Math.abs(t.fps - fps) < 1e-9, label + ' fps');
    assert.equal(t.vfr, false, label + ' is constant rate');
  }
});

test('sampleAt: millisecond WebM timestamps at 29.97 fps pick frame k from its own start, and read as constant rate', () => {
  const t = cfr(30000, 1000, 33, { ticks: (k) => Math.round((k * 1001) / 30) });
  for (let k = 0; k < t.n; k++) {
    assert.equal(SM.sampleAt(t, t.pts[k]), k);
    if (k) assert.equal(SM.sampleAt(t, t.pts[k] - 2 * SM.EPS), k - 1);
  }
  assert.equal(t.vfr, false, '33 / 34 ms steps are not variable frame rate');
});

test('sampleAt and build: a VFR table (frames 0–29 at 30 fps, 30–44 at 15 fps)', () => {
  const ticks = (k) => (k < 30 ? k * 3000 : 90000 + (k - 30) * 6000);
  const t = SM.build({ timescale: 90000, cts: Array.from({ length: 45 }, (_, k) => ticks(k)), dur: Array.from({ length: 45 }, (_, k) => (k < 29 ? 3000 : 6000)),
    key: Array.from({ length: 45 }, (_, k) => (k % 15 === 0 ? 1 : 0)), off: new Array(45).fill(0), size: new Array(45).fill(1) });
  assert.equal(t.vfr, true);
  assert.ok(Math.abs(t.duration - (1 + 15 / 15)) < 1e-12, 'duration 2 s');
  for (let k = 0; k < 45; k++) {
    const start = ticks(k) / 90000;
    assert.equal(SM.sampleAt(t, start), k);
    assert.equal(SM.sampleAt(t, start + (k < 30 ? 1 / 60 : 1 / 30)), k, 'the middle of frame ' + k);
  }
  assert.ok(Math.abs(t.fps - 30) < 1e-9, 'fps = 1 / the median frame duration');
  const st = SM.stats(t);
  assert.equal(st.vfr, true);
  assert.ok(Math.abs(st.gopMean - 2 / 3) < 1e-12 && Math.abs(st.gopMax - 1) < 1e-12, JSON.stringify(st));
});

test('runFor and keyAtOrBefore with B-frames (and open-GOP leading pictures)', () => {
  const order = GEN.helpers.bOrder(30, 10);           // presentation index per decode index
  const t = SM.build({ timescale: 30, cts: order.map((p) => p), dur: order.map(() => 1), key: order.map((p) => (p % 10 === 0 ? 1 : 0)),
    off: order.map((_, d) => d * 10), size: order.map(() => 10) });
  for (let i = 0; i < 30; i++) {
    const d = order.indexOf(i);
    assert.equal(t.dec[i], d, 'dec ' + i);
    const run = SM.runFor(t, i);
    assert.equal(run.to, d);
    assert.equal(run.from, Math.floor(i / 10) * 10, 'the run of ' + i + ' starts at its GOP key frame');
    assert.equal(SM.keyAtOrBefore(t, d), run.from);
  }
  // an open GOP: decode order I0 P2 B1 | I4 B3 P6 B5 — B3 is shown before I4, so it needs the previous GOP
  const open = [0, 2, 1, 4, 3, 6, 5];
  const u = SM.build({ timescale: 30, cts: open, dur: open.map(() => 1), key: open.map((p) => (p === 0 || p === 4 ? 1 : 0)),
    off: open.map((_, d) => d), size: open.map(() => 1) });
  assert.deepEqual(SM.runFor(u, 3), { from: 0, to: 4 }, 'a leading picture decodes from the previous key frame');
  assert.deepEqual(SM.runFor(u, 5), { from: 3, to: 6 });
  assert.equal(SM.keyAtOrBefore(u, 2), 0);
  assert.equal(SM.keyAtOrBefore(u, 3), 3);
  const presentation = SM.presentationOf(u);
  assert.deepEqual(Array.from(presentation), [0, 2, 1, 4, 3, 6, 5]);
});

test('build: pre-roll, unique chunk timestamps, the last duration, and refusals', () => {
  const t = SM.build({ timescale: 1000, cts: [0, 40, 40, 80], dur: [40, 40, 40, 0], key: [1, 0, 0, 0], off: [0, 1, 2, 3], size: [1, 1, 1, 1], start: 40 });
  assert.equal(t.n, 3, 'the frame before the edit is pre-roll');
  assert.deepEqual(Array.from(t.dec), [1, 2, 3]);
  assert.deepEqual(Array.from(t.pts), [0, 0, 0.04]);
  assert.deepEqual(Array.from(t.ts), [-40000, 0, 1, 40000], 'two frames at the same time get distinct chunk timestamps');
  const u = SM.build({ timescale: 1000, cts: [0, 40, 80, 120], dur: [40, 40, 40, 0], key: [1, 0, 0, 0], off: [0, 1, 2, 3], size: [1, 1, 1, 1] });
  assert.equal(u.dur[3], 0.04, 'an unknown last duration is the median of the others');
  assert.equal(u.duration, 0.16);
  assert.equal(SM.sampleAt(t, 0), 1, 'equal start times: the later one is shown');
  assert.throws(() => SM.build({ timescale: 1000, cts: [0], dur: [1], key: [1], off: [0], size: [1], start: 10 }),
    (e) => e instanceof SM.MediaError && e.code === 'broken');
  assert.throws(() => SM.build({ timescale: 0, cts: [0], dur: [1], key: [1], off: [0], size: [1] }), (e) => e.code === 'broken');
  const one = SM.build({ timescale: 90000, cts: [0], dur: [0], key: [1], off: [0], size: [5] });
  assert.equal(one.n, 1);
  assert.ok(Math.abs(one.dur[0] - 1 / 30) < 1e-12 && one.fps === 30, 'a single frame of unknown length: 1/30 s');
  assert.equal(SM.sampleAt(one, 100), 0);
});

test('toData / fromData: the IndexedDB form round-trips with ArrayBuffers; a damaged record is null', () => {
  const t = cfr(50, 12800, 512, { gop: 10 });
  t.aoff = Float64Array.from({ length: 50 }, (_, d) => 5000 + d);
  t.asize = Uint32Array.from({ length: 50 }, () => 7);
  const data = SM.toData(t);
  for (const k of ['key', 'pts', 'dur', 'dec', 'off', 'size', 'ts', 'aoff', 'asize']) assert.ok(data[k] instanceof ArrayBuffer, k);
  const cloned = structuredClone(data);
  const back = SM.fromData(cloned);
  for (const k of Object.keys(t)) {
    if (ArrayBuffer.isView(t[k])) {
      assert.equal(back[k].constructor, t[k].constructor, k + ' type');
      assert.deepEqual(Array.from(back[k]), Array.from(t[k]), k);
    } else assert.equal(back[k], t[k], k);
  }
  t.pts[0] = 99;
  assert.equal(SM.fromData(data).pts[0], 0, 'toData copies');
  assert.equal(SM.fromData(null), null);
  assert.equal(SM.fromData({ n: 0 }), null);
  assert.equal(SM.fromData(Object.assign({}, data, { pts: new ArrayBuffer(3) })), null, 'a buffer of the wrong length');
  assert.equal(SM.fromData(Object.assign({}, data, { off: new ArrayBuffer(8) })), null, 'arrays of different lengths');
  const noAlpha = SM.fromData(SM.toData(cfr(3, 30, 1)));
  assert.equal(noAlpha.aoff, null);
});

test('stats: GOP mean and maximum in seconds; the long-GOP badge threshold', () => {
  const t = cfr(300, 30, 1, { gop: 90 });
  const s = SM.stats(t);
  assert.ok(Math.abs(s.gopMean - 2.5) < 1e-12, 'four GOPs over 10 s');
  assert.ok(Math.abs(s.gopMax - 3) < 1e-12);
  assert.equal(s.vfr, false);
  const long = SM.stats(cfr(300, 30, 1, { gop: 1000 }));
  assert.ok(long.gopMean > MEDIA.LIMITS.gopSlow, 'one key frame in 10 s is a long GOP');
});

test('colour: colorSpaceOf, colorClass and isHdr', () => {
  assert.deepEqual(SM.colorSpaceOf({ primaries: 1, transfer: 1, matrix: 1, fullRange: false }),
    { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false });
  assert.deepEqual(SM.colorSpaceOf({ primaries: 9, transfer: 16, matrix: 9, fullRange: null }), { primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020-ncl' });
  assert.equal(SM.colorSpaceOf({ primaries: 2, transfer: 2, matrix: 2, fullRange: null }), undefined);
  assert.equal(SM.colorSpaceOf(null), undefined);
  assert.equal(SM.colorClass({ primaries: 1, transfer: 1, matrix: 1 }), 'bt709');
  assert.equal(SM.colorClass({ primaries: 6, transfer: 6, matrix: 6 }), 'bt601');
  assert.equal(SM.colorClass({ primaries: 9, transfer: 18, matrix: 9 }), 'bt2020');
  assert.equal(SM.colorClass({ primaries: 12, transfer: 13, matrix: 1 }), 'p3');
  assert.equal(SM.colorClass({ primaries: 22, transfer: 2, matrix: 2 }), 'other');
  assert.equal(SM.colorClass(null, 'bt601'), 'bt601');
  assert.equal(SM.isHdr({ transfer: 16 }), true);
  assert.equal(SM.isHdr({ transfer: 18 }), true);
  assert.equal(SM.isHdr({ transfer: 1 }), false);
  for (const c of ['bt709', 'bt601', 'bt2020', 'p3', 'other']) assert.ok(MEDIA.COLORS.includes(c));
});
