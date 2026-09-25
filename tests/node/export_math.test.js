/* 文字PVメーカー v2 — original work. Tests for export/schedule and export/muxer (DESIGN §8.2 export_math.test.js). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx, throwsCode, deepEqual } = require('../helpers/assert_plus.js');
const F = require('../helpers/fake_engine.js');

const MV = load();
const S = MV.use('export/schedule');
const M = MV.use('export/muxer');
const SINK = MV.use('export/host/sink');
const docs = MV.use('core/doc');

function sampleDoc(output) {
  const doc = docs.defaultDoc();
  doc.sheet = { next: 5, rows: [
    { id: 'r1', src: '[ti:夜明け/のうた]' }, { id: 'r2', src: '一行目の歌詞' }, { id: 'r3', src: '二行目!' }, { id: 'r4', src: 'three' },
  ] };
  Object.assign(doc.output, output || {});
  return doc;
}

function samplePlan(doc, extra) {
  return Object.assign(F.trivialPlan(doc || sampleDoc()), extra || {});
}

// --- frame math ---------------------------------------------------------------------------------------------------

test('frameCount: exact multiples, float noise and fractions', () => {
  assert.equal(S.frameCount(2, 30), 60);
  assert.equal(S.frameCount(0, 30), 0);
  assert.equal(S.frameCount(10 / 3, 30), 100, '10/3 · 30 = 100.00000000000001 is still 100 frames');
  assert.equal(S.frameCount(0.1 + 0.2, 30), 9, '0.30000000000000004 s');
  assert.equal(S.frameCount(2 + 1e-12, 30), 60, 'noise below 1e-9 frames adds nothing');
  assert.equal(S.frameCount(2 + 1e-6, 30), 61, 'a real remainder adds a frame');
  assert.equal(S.frameCount(2.01, 30), 61);
  assert.equal(S.frameCount(1, 24), 24);
  assert.equal(S.frameCount(1 / 60, 60), 1);
  assert.equal(S.frameCount(214.6, 60), 12876);
});

test('ts / frameDur: µs timestamps, durations never a constant, Σ frameDur = ts(N)', () => {
  assert.deepEqual([0, 1, 2, 3].map((i) => S.ts(i, 30)), [0, 33333, 66667, 100000]);
  for (const fps of [24, 30, 60]) {
    const N = S.frameCount(7.3, fps);
    let sum = 0;
    const seen = new Set();
    for (let i = 0; i < N; i++) {
      const d = S.frameDur(i, fps);
      sum += d;
      seen.add(d);
      assert.equal(S.ts(i + 1, fps) - S.ts(i, fps), d);
    }
    assert.equal(sum, S.ts(N, fps), 'fps ' + fps);
    const nominal = 1e6 / fps;
    for (const d of seen) assert.ok(Math.abs(d - nominal) < 1, `fps ${fps}: ${d}`);
  }
  assert.equal(new Set([0, 1, 2].map((i) => S.frameDur(i, 30))).size, 2, '33333 and 33334 both occur at 30 fps');
  assert.equal(S.keyInterval(30), 60);
});

test('audioFrames: the audio track length for exactly N frames', () => {
  assert.equal(S.audioFrames(60, 30, 48000), 96000);
  assert.equal(S.audioFrames(61, 30, 44100), 89670);
  assert.equal(S.audioFrames(1, 24, 44100), 1838, '1837.5 rounds up');
  assert.equal(S.audioFrames(0, 30, 48000), 0);
});

test('audio chunks: 1024-frame AudioData covering exactly audioFrames, zero-padded, mono copied to both channels', () => {
  const total = S.audioFrames(61, 30, 44100);
  const count = S.audioChunkCount(total);
  assert.equal(count, Math.ceil(total / 1024));
  let covered = 0;
  for (let k = 0; k < count; k++) {
    const c = S.audioChunk(k, 44100, total);
    assert.equal(c.from, covered);
    assert.equal(c.timestamp, Math.round((c.from * 1e6) / 44100));
    covered += c.frames;
    assert.ok(c.frames > 0 && c.frames <= 1024);
  }
  assert.equal(covered, total);
  const src = [Float32Array.from([1, 2, 3, 4, 5])];
  const out = S.fillPlanar(new Float32Array(8), src, 3, 4);
  assert.deepEqual(Array.from(out), [4, 5, 0, 0, 4, 5, 0, 0]);
  const stereo = [Float32Array.from([1, 2]), Float32Array.from([-1, -2]), Float32Array.from([9, 9])];
  assert.deepEqual(Array.from(S.fillPlanar(new Float32Array(6), stereo, -1, 3)), [0, 1, 2, 0, -1, -2]);
});

test('fillPlanar: songs with more channels are mixed down like Web Audio speakers (5.1 centre kept, LFE dropped)', () => {
  const one = (v) => Float32Array.from([v, v]);
  // 5.1 in Web Audio order L R C LFE SL SR, each channel a different power of two so every term is visible.
  const surround = [one(1), one(2), one(4), one(8), one(16), one(32)];
  const out = S.fillPlanar(new Float32Array(4).fill(99), surround, 0, 2);
  const h = Math.SQRT1_2;
  approx(Array.from(out), [1 + h * (4 + 16), 1 + h * (4 + 16), 2 + h * (4 + 32), 2 + h * (4 + 32)], 1e-6);
  // The case that exported silence: sound on the centre channel only.
  const centre = [one(0), one(0), one(0.5), one(0), one(0), one(0)];
  approx(Array.from(S.fillPlanar(new Float32Array(4), centre, 0, 2)), [0.5 * h, 0.5 * h, 0.5 * h, 0.5 * h], 1e-6);
  const quad = [one(1), one(2), one(4), one(8)];
  approx(Array.from(S.fillPlanar(new Float32Array(4), quad, 0, 2)), [2.5, 2.5, 5, 5], 1e-6, 'quad: ½ (L + SL), ½ (R + SR)');
  approx(Array.from(S.fillPlanar(new Float32Array(6), surround, -1, 3)), [0, 1 + h * 20, 1 + h * 20, 0, 2 + h * 36, 2 + h * 36], 1e-6,
    'zero outside the source');
  deepEqual(S.mixMatrix(1, 2), [[[0, 1]], [[0, 1]]]);
  deepEqual(S.mixMatrix(3, 2), [[[0, 1]], [[1, 1]]], 'other layouts are discrete');
  deepEqual(S.mixMatrix(2, 1), [[[0, 1]]]);
});

// --- sizes and codecs -------------------------------------------------------------------------------------------------

test('outputSize: the short side exact, the long side even and close to the aspect', () => {
  deepEqual(S.outputSize('16:9', 720), { w: 1280, h: 720 });
  deepEqual(S.outputSize('9:16', 1080), { w: 1080, h: 1920 });
  deepEqual(S.outputSize('21:9', 720), { w: 1680, h: 720 });
  deepEqual(S.outputSize('4:5', 720), { w: 720, h: 900 });
  deepEqual(S.outputSize('3:4', 720), { w: 720, h: 960 });
  deepEqual(S.outputSize('1:1', 1440), { w: 1440, h: 1440 });
  deepEqual(S.outputSize('4:3', 2160), { w: 2880, h: 2160 });
  for (const aspect of docs.ASPECTS) {
    const [a, b] = aspect.split(':').map(Number);
    for (const short of [720, 1080, 1440, 2160]) {
      const { w, h } = S.outputSize(aspect, short);
      assert.equal(Math.min(w, h), short);
      assert.equal(w % 2, 0);
      assert.equal(h % 2, 0);
      assert.ok(Math.abs(w / h - a / b) < 2 / short, `${aspect} @ ${short}: ${w}×${h}`);
    }
  }
  throwsCode(() => S.outputSize('wide', 720), 'aspect');
});

test('bitrate, estimateBytes, estimatePngBytes and eta', () => {
  assert.equal(S.bitrate(1920, 1080, 30, 'high'), Math.round(1920 * 1080 * 30 * 0.12));
  assert.equal(S.bitrate(1280, 720, 30, 'standard'), Math.round(1280 * 720 * 30 * 0.08));
  assert.equal(S.bitrate(3840, 2160, 60, 'max'), Math.round(3840 * 2160 * 60 * 0.18));
  throwsCode(() => S.bitrate(1, 1, 30, 'ultra'), 'quality');
  assert.equal(S.estimateBytes(10, 8e6, false), Math.ceil(10 * 1e6 * 1.02));
  assert.equal(S.estimateBytes(10, 8e6, true), Math.ceil(((10 * (8e6 + 192000)) / 8) * 1.02));
  assert.ok(S.estimatePngBytes(10, 100, 100, true) > S.estimatePngBytes(10, 100, 100, false));
  assert.equal(S.eta([], 10), null);
  approx(S.eta([{ i: 0, ms: 100 }], 10), 1);
  approx(S.eta([{ i: 0, ms: 100 }, { i: 1, ms: 200 }], 10), (110 * 10) / 1000, 1e-12, 'EMA α = 0.1');
  approx(S.eta([{ i: 0, ms: 50 }, { i: 1, ms: 50 }], 0), 0);
});

test('pickAvc: High, Main, Baseline at the smallest level that holds the frame size and rate', () => {
  const avc = (w, h, fps) => S.pickAvc(w, h, fps);
  assert.deepEqual(avc(1920, 1080, 30), ['avc1.640028', 'avc1.4D0028', 'avc1.42E028']);
  assert.deepEqual(avc(1280, 720, 60), ['avc1.640028', 'avc1.4D0028', 'avc1.42E028']);
  assert.deepEqual(avc(1920, 1080, 60), ['avc1.64002A', 'avc1.4D002A', 'avc1.42E02A']);
  assert.deepEqual(avc(2560, 1440, 30), ['avc1.640032', 'avc1.4D0032', 'avc1.42E032']);
  assert.deepEqual(avc(3840, 2160, 30), ['avc1.640033', 'avc1.4D0033', 'avc1.42E033']);
  assert.deepEqual(avc(3840, 2160, 60), ['avc1.640034', 'avc1.4D0034', 'avc1.42E034']);
  assert.equal(avc(1080, 1920, 30)[0], 'avc1.640028', 'portrait 1080p30');
  assert.equal(avc(2520, 1080, 30)[0], 'avc1.640032', '21:9 1080p does not fit level 4.2 (8704 MBs)');
  assert.equal(avc(5040, 2160, 60)[0], 'avc1.64003C', '21:9 2160p60 needs level 6');
  for (const fps of [24, 30, 60]) {
    for (const aspect of docs.ASPECTS) {
      for (const short of [720, 1080, 1440, 2160]) {
        const { w, h } = S.outputSize(aspect, short);
        const list = avc(w, h, fps);
        assert.equal(list.length, 3);
        assert.match(list[0], /^avc1\.6400[0-9A-F]{2}$/);
        assert.equal(list[1], list[0].replace('6400', '4D00'));
        assert.equal(list[2], list[0].replace('6400', '42E0'));
      }
    }
  }
});

// --- what to render --------------------------------------------------------------------------------------------------

test('exportRange, backdropFor, renderScale, fileName and frameName', () => {
  const doc = sampleDoc();
  const plan = samplePlan(doc);
  deepEqual(S.exportRange(doc, plan), { t0: 0, t1: plan.duration });
  doc.output.range = { t0: 1, t1: 1e6 };
  deepEqual(S.exportRange(doc, plan), { t0: 1, t1: plan.duration });
  doc.output.range = { t0: 1e6, t1: 2e6 };
  deepEqual(S.exportRange(doc, plan), { t0: plan.duration, t1: plan.duration });
  assert.equal(S.backdropFor('pngAlpha', 'scene'), 'clear');
  assert.equal(S.backdropFor('mp4', 'clear'), 'scene');
  assert.equal(S.backdropFor('png', 'clear'), 'scene');
  assert.equal(S.backdropFor('mp4', 'chroma'), 'chroma');
  approx(S.renderScale({ w: 1920, h: 1080 }, 1280, 720), 2 / 3);
  assert.equal(S.fileName(doc, 'mp4'), '夜明け のうた.mp4', 'title from [ti:], slash removed');
  doc.output.name = '  my: video?.MP4 ';
  assert.equal(S.fileName(doc, 'mp4'), 'my video.mp4');
  doc.output.name = '***';
  assert.equal(S.fileName(doc, 'zip'), '夜明け のうた.zip');
  assert.equal(S.fileName(docs.defaultDoc(), 'zip'), 'mojipv.zip');
  assert.equal(S.frameName('a', 7, 60), 'a_00007.png');
  assert.equal(S.frameName('a', 7, 123456), 'a_000007.png');
});

test('fileName: long names are cut at 80 UTF-16 units on a grapheme boundary, never inside an emoji', () => {
  const titled = (title) => {
    const doc = sampleDoc();
    doc.sheet.rows[0].src = '[ti:' + title + ']';
    return doc;
  };
  const a79 = 'a'.repeat(79);
  const cut = S.fileName(titled(a79 + '🎵 live'), 'zip');
  assert.equal(cut, a79 + '.zip', 'the note would end at unit 81: it is left out whole');
  assert.ok(cut.isWellFormed(), 'no lone surrogate');
  assert.equal(S.fileName(titled('a'.repeat(78) + '🎵 live'), 'mp4'), 'a'.repeat(78) + '🎵.mp4', 'an emoji that fits stays');
  const family = '👩‍👩‍👧';                 // one grapheme, 8 UTF-16 units
  assert.equal(S.fileName(titled('b'.repeat(75) + family + 'c'), 'mp4'), 'b'.repeat(75) + '.mp4', 'a ZWJ family is not split');
  assert.equal(S.fileName(titled('x\ud83cy'), 'mp4'), 'xy.mp4', 'lone surrogates in the input are dropped');
  const doc = sampleDoc({ name: 'え'.repeat(100) });
  assert.equal(S.fileName(doc, 'mp4'), 'え'.repeat(80) + '.mp4');
  for (const name of [cut, S.fileName(doc, 'mp4')]) assert.ok(Buffer.byteLength(name) <= 255, 'fits a file-system name');
});

// --- pre-flight ----------------------------------------------------------------------------------------------------

const READY = { webcodecs: true, codec: 'avc1.640028', audioCodec: 'mp4a.40.2', fontsReady: true, fsAccess: true, warnings: [] };

function codes(items) { return items.map((x) => x.code); }

test('preflight: flash-rate detection (> 3 flashes in any 1 s window) with the fix command', () => {
  const doc = sampleDoc();
  const flash = (t, amp = 0.6) => ({ t, kind: 'flash', amp, decay: 0.18 });
  const shake = (t) => ({ t, kind: 'shake', amp: 0.9, decay: 0.4 });
  const busy = samplePlan(doc, { impulses: [flash(1), flash(1.2), flash(1.5), flash(1.9), shake(1.3), flash(5)] });
  const items = S.preflight(doc, busy, READY);
  const item = items.find((x) => x.code === 'flash-rate');
  assert.ok(item, 'four flashes inside one second');
  assert.equal(item.level, 'warn');
  assert.deepEqual(item.params, { n: 4, at: 1 });
  assert.deepEqual(item.jump, { t: 1 });
  assert.deepEqual(item.fix, { t: 'pin.set', path: 'work:amount.flash', v: 0.3, by: 'user' });
  const spread = samplePlan(doc, { impulses: [flash(1), flash(1.3), flash(1.6), flash(2.0), flash(2.35)] });
  assert.ok(!codes(S.preflight(doc, spread, READY)).includes('flash-rate'), 'never four inside one second');
  const weak = samplePlan(doc, { impulses: [flash(1, 0.3), flash(1.1, 0.3), flash(1.2, 0.3), flash(1.3, 0.3)] });
  assert.ok(!codes(S.preflight(doc, weak, READY)).includes('flash-rate'), 'flashes at the fixed amount are not counted');
  const seamPlan = samplePlan(doc, {
    impulses: [flash(3), flash(3.2)],
    seams: [2.9, 3.4].map((at) => ({ into: 'x', at, dur: 0.4, scope: 'world', a: 'a', b: 'b', slot: { v: 'whiteFlash', from: 'auto' } })),
  });
  assert.equal(S.flashRate(seamPlan).count, 4, 'white flash seams count');
  const dup = samplePlan(doc, { impulses: [flash(1), flash(1.001), flash(1.002), flash(1.003)] });
  assert.equal(S.flashRate(dup).count, 1, 'simultaneous events are one flash');
});

// The count follows what parts/filter/flash.js draws (NOTES ## WP5b2 review fixes, ## INT-LEAD): 'beat' flashes fire
// on every stride-th beat (flashPop ≥ 1/3 s apart, invertBlink ≥ 1 s), none without a grid; 'depart' fires so the
// flashes are over by the sung end; invertBlink blinks `blinks` times, 2/rate apart; a cut's effects count only while it
// is the current cut, [t0, next cut's t0).
test('preflight: flashPop and invertBlink flash on beats, arrivals, departures or impacts, as they render', () => {
  const doc = sampleDoc();
  const plan = samplePlan(doc, { beats: { bpm: 300, offset: 0, meter: 4 } });
  const cut = plan.cuts[0], next = plan.cuts[1];
  const own = (times) => times.filter((t) => t >= cut.t0 && t < next.t0);
  cut.slots['filter.count'] = { v: 1, from: 'auto' };
  cut.slots['filter#0'] = { v: 'flashPop', p: { amount: 0.8, when: 'beat', decay: 0.2 }, from: 'auto' };
  const beats = own(Array.from({ length: 400 }, (_, k) => k * 0.2));
  deepEqual(S.flashEvents(plan), beats.filter((t) => Math.round(t / 0.2) % 2 === 0), 'every other beat at 300 BPM');
  assert.ok(!codes(S.preflight(doc, plan, READY)).includes('flash-rate'), 'at most 3 flashes in any second');
  deepEqual(S.flashEvents(Object.assign({}, plan, { beats: null })), [], 'no beat flashes without a grid');
  cut.slots['filter#0'].p.when = 'arrive';
  deepEqual(S.flashEvents(plan), [cut.t0]);
  cut.slots['filter#0'].p.when = 'depart';
  const dur = typeof cut.feat.dur === 'number' ? cut.feat.dur : cut.t1 - cut.t0;
  deepEqual(S.flashEvents(plan), [cut.t0 + dur - 0.4], 'over by the sung end (2 × decay before it)');
  cut.slots['filter#0'].p.amount = 0.2;
  deepEqual(S.flashEvents(plan), [], 'a faint flash pop does not count');

  cut.slots['filter#0'] = { v: 'invertBlink', p: { amount: 0.8, when: 'arrive', blinks: 3, rate: 12 }, from: 'auto' };
  deepEqual(S.flashEvents(plan), [0, 1, 2].map((j) => cut.t0 + j / 6), 'three blinks, 2/rate apart');
  cut.slots['filter#0'].p.when = 'beat';
  const blinkBeats = S.flashEvents(plan);
  assert.ok(blinkBeats.length > 0 && blinkBeats.every((t) => Math.round(t / 0.2) % 5 === 0), 'one event per second (every 5th beat)');
  assert.ok(blinkBeats.every((t, k) => k === 0 || t - blinkBeats[k - 1] >= 1 - 1e-9), 'one blink per beat event at 300 BPM, 12 Hz');
  cut.slots['filter#0'].p.amount = 0.3;
  deepEqual(S.flashEvents(plan), [], 'invertBlink does not blink at the safe amount');

  // Two neighbouring cuts that each keep the rule can break it together: the pre-flight catches that.
  cut.slots['filter#0'] = { v: 'invertBlink', p: { amount: 0.8, when: 'depart', blinks: 3, rate: 12 }, from: 'auto' };
  next.slots['filter.count'] = { v: 1, from: 'auto' };
  next.slots['filter#0'] = { v: 'invertBlink', p: { amount: 0.8, when: 'arrive', blinks: 3, rate: 12 }, from: 'auto' };
  const both = S.flashRate(plan);
  deepEqual(S.flashEvents(plan).length, 6, 'three blinks ending by the sung end, three from the next start');
  assert.equal(both.count, 5, 'five of them inside one second');
  assert.ok(codes(S.preflight(doc, plan, READY)).includes('flash-rate'));
});

test('preflight: blocking and informational items', () => {
  const doc = sampleDoc({ short: 720, fps: 30 });
  doc.song = { name: 's.mp3', sha1: 'x', seconds: 30, bpm: null, offset: 0, meter: 4, bpmConfidence: null, digest: null, info: null };
  const plan = samplePlan(doc);
  assert.deepEqual(S.preflight(doc, plan, READY), []);
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, READY, { webcodecs: false }))), ['no-webcodecs']);
  const noCodec = S.preflight(doc, plan, Object.assign({}, READY, { codec: null }));
  assert.deepEqual(noCodec, [{ code: 'no-codec', level: 'block', params: { w: 1280, h: 720, fps: 30 } }]);
  assert.deepEqual(S.preflight(doc, plan, Object.assign({}, READY, { codec: null, anyCodec: true })), noCodec,
    'H.264 encodes at a smaller size: choose a smaller size or frame rate');
  assert.deepEqual(S.preflight(doc, plan, Object.assign({}, READY, { codec: null, anyCodec: false })),
    [{ code: 'no-h264', level: 'block', params: {} }], 'no H.264 encoder at all: no size would help');
  assert.deepEqual(S.preflight(sampleDoc({ format: 'png' }), plan, Object.assign({}, READY, { codec: null, anyCodec: false })), [],
    'a PNG sequence needs no encoder');
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, READY, { audioCodec: null }))), ['no-audio-codec']);
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, READY, { songReady: false }))), ['song-missing']);
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, READY, { fontsReady: false }))), ['fonts-loading']);
  const mem = S.preflight(doc, plan, Object.assign({}, READY, { fsAccess: false }));
  assert.equal(mem.length, 1);
  assert.equal(mem[0].code, 'memory');
  assert.equal(mem[0].level, 'warn');
  assert.ok(mem[0].params.bytes > 0);
  const long = Object.assign({}, plan, { duration: 3600 });
  const big = sampleDoc({ short: 2160, fps: 60, quality: 'max' });
  assert.equal(S.preflight(big, long, Object.assign({}, READY, { fsAccess: false }))[0].level, 'confirm', '> 1.5 GB asks');
  const png = sampleDoc({ format: 'png' });
  assert.deepEqual(S.preflight(png, plan, { fsAccess: true, webcodecs: false }), [], 'PNG needs no WebCodecs');
  const clear = sampleDoc();
  clear.look.backdrop = 'clear';
  assert.deepEqual(codes(S.preflight(clear, plan, READY)), ['clear-mp4']);
  const empty = sampleDoc();
  empty.output.range = { t0: 999, t1: 1000 };
  assert.deepEqual(codes(S.preflight(empty, plan, READY)), ['range-empty']);
});

test('preflight: overfull (one per line, with a jump) and font-fallback warnings', () => {
  const doc = sampleDoc();
  const plan = samplePlan(doc);
  const line = plan.lines[1];
  const warnings = [
    { code: 'overfull', cut: line.cuts[0], line: line.id }, { code: 'overfull', cut: line.cuts[0], line: line.id },
    { code: 'font-fallback', detail: { family: 'Yuji Syuku' } }, { code: 'font-fallback', detail: { family: 'Yuji Syuku' } },
    { code: 'orphan-pin', path: 'cut/r9~0:arrive' },
  ];
  const items = S.preflight(doc, plan, Object.assign({}, READY, { warnings }));
  assert.deepEqual(items, [
    { code: 'overfull', level: 'warn', params: { line: 2 }, jump: { cut: line.cuts[0] } },
    { code: 'font-fallback', level: 'info', params: { family: 'Yuji Syuku' } },
  ]);
  const fromPlan = samplePlan(doc, { warnings: [{ code: 'overfull', cut: 'r4~0', line: 'r4' }] });
  assert.deepEqual(codes(S.preflight(doc, fromPlan, Object.assign({}, READY, { warnings: undefined }))), ['overfull']);
});

test('ExportError carries a code', () => {
  const e = new S.ExportError('cancelled', 'stopped', { i: 3 });
  assert.ok(e instanceof Error);
  assert.equal(e.code, 'cancelled');
  assert.equal(e.name, 'ExportError');
  assert.deepEqual(e.detail, { i: 3 });
});

// --- muxer adapter (with a fake Mp4Muxer namespace) --------------------------------------------------------------------

function fakeLib() {
  const log = [];
  class ArrayBufferTarget { constructor() { this.buffer = null; } }
  class StreamTarget { constructor(o) { this.options = o; } }
  class Muxer {
    constructor(options) { this.options = options; log.push(['new', options]); }
    addVideoChunk(chunk, meta) {
      log.push(['video', chunk, meta]);
      if (this.options.target instanceof StreamTarget) this.options.target.options.onData(Uint8Array.from(chunk.bytes), chunk.at);
    }
    addAudioChunk(chunk, meta) { log.push(['audio', chunk, meta]); }
    finalize() {
      log.push(['finalize']);
      if (this.options.target instanceof ArrayBufferTarget) this.options.target.buffer = new ArrayBuffer(8);
      else this.options.target.options.onData(Uint8Array.from([9, 9]), 0);
    }
  }
  return { lib: { Muxer, ArrayBufferTarget, StreamTarget }, log };
}

test('muxer: stream target forwards every piece to write(bytes, position) in order', async () => {
  const { lib, log } = fakeLib();
  const writes = [];
  const m = M.createMuxer({ lib, target: 'stream', write: async (b, p) => { writes.push([Array.from(b), p]); }, w: 1280, h: 720,
    fps: 30, audio: { rate: 48000, channels: 2 } });
  const opts = log[0][1];
  assert.equal(opts.fastStart, false);
  assert.ok(opts.target instanceof lib.StreamTarget);
  assert.equal(opts.target.options.onData.length, 2, 'onData takes (data, position)');
  assert.equal(opts.target.options.chunked, true);
  assert.deepEqual(opts.video, { codec: 'avc', width: 1280, height: 720, frameRate: 30 });
  assert.deepEqual(opts.audio, { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 });
  const source = [1, 2, 3];
  m.video({ bytes: source, at: 0 }, { decoderConfig: {} });
  source[0] = 7;                                    // the adapter copied the bytes before queuing them
  m.video({ bytes: [4, 5], at: 3 }, {});
  m.audio({ a: 1 }, {});
  await m.ready();
  assert.equal(await m.finish(), null);
  assert.deepEqual(writes, [[[1, 2, 3], 0], [[4, 5], 3], [[9, 9], 0]]);
  assert.equal(m.backlog, 0);
  assert.deepEqual(log.map((x) => x[0]), ['new', 'video', 'video', 'audio', 'finalize']);
  await assert.rejects(m.finish(), (e) => e.code === 'finished');
  assert.throws(() => m.video({ bytes: [], at: 0 }, {}), (e) => e.code === 'finished');
});

test('muxer: memory target returns the file; codec mapping; argument and sink errors', async () => {
  const { lib, log } = fakeLib();
  const m = M.createMuxer({ lib, target: 'memory', w: 640, h: 360, fps: 24, codec: M.muxCodec('vp09.00.10.08'),
    audio: { rate: 48000, channels: 2, codec: M.muxCodec('opus') } });
  assert.equal(log[0][1].fastStart, 'in-memory');
  assert.ok(log[0][1].target instanceof lib.ArrayBufferTarget);
  assert.equal(log[0][1].video.codec, 'vp9');
  assert.equal(log[0][1].audio.codec, 'opus');
  assert.equal(log[0][1].firstTimestampBehavior, 'cross-track-offset');
  const buf = await m.finish();
  assert.ok(buf instanceof ArrayBuffer);
  assert.equal(M.muxCodec('avc1.42E028'), 'avc');
  assert.equal(M.muxCodec('mp4a.40.2'), 'aac');
  throwsCode(() => M.muxCodec('theora'), 'codec');
  throwsCode(() => M.createMuxer({ lib: {}, target: 'memory', w: 1, h: 1, fps: 1 }), 'args');
  throwsCode(() => M.createMuxer({ lib, target: 'disk', w: 1, h: 1, fps: 1 }), 'args');
  throwsCode(() => M.createMuxer({ lib, target: 'stream', w: 1, h: 1, fps: 1 }), 'args');
  throwsCode(() => M.createMuxer({ lib, target: 'memory', w: 1.5, h: 1, fps: 1 }), 'args');
  const failing = M.createMuxer({ lib, target: 'stream', write: async () => { throw new Error('disk full'); }, w: 2, h: 2, fps: 30 });
  failing.video({ bytes: [1], at: 0 }, {});
  await assert.rejects(failing.finish(), (e) => e.code === 'sink' && /disk full/.test(e.message));
});

// --- sinks (export/host/sink with a fake File System Access handle) --------------------------------------------------

function fakeHandle({ closeFails = false } = {}) {
  const log = [];
  const handle = {
    name: 'song.mp4',
    removed: false,
    async createWritable(opts) {
      log.push(['open', opts]);
      return {
        async write(op) { log.push(['write', op.position, op.data.byteLength]); },
        async close() {
          log.push(['close']);
          if (closeFails) throw Object.assign(new Error('disk full'), { name: 'QuotaExceededError' });
        },
        async abort() { log.push(['abort']); },
      };
    },
    async remove() { log.push(['remove']); handle.removed = true; },
  };
  return { handle, log };
}

test('file sink: writes at positions, closes once, and a closed file is kept', async () => {
  const { handle, log } = fakeHandle();
  const sink = SINK.createFileSink(handle);
  assert.equal(sink.kind, 'file');
  assert.equal(sink.name, 'song.mp4');
  await sink.write(new Uint8Array(10));
  await sink.write(new Uint8Array(4), 2);
  assert.equal(sink.bytes, 10);
  deepEqual(await sink.close(), { bytes: 10 });
  await sink.abort();
  assert.equal(handle.removed, false, 'abort after a successful close keeps the file');
  deepEqual(log, [['open', { keepExistingData: false }], ['write', 0, 10], ['write', 2, 4], ['close']]);
  await assert.rejects(sink.write(new Uint8Array(1)), (e) => e.code === 'sink');
  await assert.rejects(sink.close(), (e) => e.code === 'sink');
});

test('file sink: when close() fails, abort() still removes the file (no partial file is left)', async () => {
  const { handle, log } = fakeHandle({ closeFails: true });
  const sink = SINK.createFileSink(handle);
  await sink.write(new Uint8Array(8));
  await assert.rejects(sink.close(), (e) => e instanceof S.ExportError && e.code === 'sink' && /disk full/.test(e.message));
  await sink.abort();
  assert.equal(handle.removed, true);
  assert.equal(sink.bytes, 0);
  deepEqual(log.map((x) => x[0]), ['open', 'write', 'close', 'abort', 'remove']);
  await sink.abort();
  assert.equal(log.filter((x) => x[0] === 'remove').length, 1, 'abort is idempotent');
});

test('file sink: a cancelled export aborts the stream and removes the file; memory sink keeps nothing', async () => {
  const { handle, log } = fakeHandle();
  const sink = SINK.createFileSink(handle);
  await sink.write(new Uint8Array(3));
  await sink.abort();
  assert.equal(handle.removed, true);
  deepEqual(log.map((x) => x[0]), ['open', 'write', 'abort', 'remove']);
  await assert.rejects(sink.write(new Uint8Array(1)), (e) => e.code === 'sink');
  const untouched = fakeHandle();
  await SINK.createFileSink(untouched.handle).abort();
  assert.equal(untouched.handle.removed, true, 'the empty file from the save dialog goes too');
  const memory = SINK.createMemorySink({ type: 'video/mp4' });
  await memory.write(Uint8Array.from([1, 2, 3]));
  await memory.write(Uint8Array.from([9]), 1);
  const done = await memory.close();
  assert.equal(done.bytes, 3);
  deepEqual(Array.from(new Uint8Array(await done.blob.arrayBuffer())), [1, 9, 3]);
  const dropped = SINK.createMemorySink();
  await dropped.write(new Uint8Array(5));
  await dropped.abort();
  assert.equal(dropped.bytes, 0);
});

test('downloadBlob saves through a link that is in the page only for its click, and always releases the URL', () => {
  const log = [];
  const timers = [];
  const saved = { document: globalThis.document, URL: globalThis.URL, setTimeout: globalThis.setTimeout };
  const makeDoc = (clickFails) => ({
    createElement: (tag) => ({ tag, click() { log.push(['click', this.href, this.download, this.rel]); if (clickFails) throw new Error('blocked'); },
      remove() { log.push(['remove']); } }),
    body: { append: (el) => log.push(['append', el.tag]) },
  });
  try {
    globalThis.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: (u) => log.push(['revoke', u]) };
    globalThis.setTimeout = (fn, ms) => { timers.push([fn, ms]); return 0; };
    globalThis.document = makeDoc(false);
    SINK.downloadBlob({ size: 3 }, 'clip.mp4');
    assert.deepEqual(log, [['append', 'a'], ['click', 'blob:x', 'clip.mp4', 'noopener'], ['remove']]);
    assert.equal(timers.length, 1);
    assert.equal(timers[0][1], 60000, 'released a minute later, once the download has read it');
    timers[0][0]();
    assert.deepEqual(log[log.length - 1], ['revoke', 'blob:x']);
    // a click that throws still removes the link and releases the URL
    log.length = 0; timers.length = 0;
    globalThis.document = makeDoc(true);
    assert.throws(() => SINK.downloadBlob({ size: 3 }, 'clip.zip'), /blocked/);
    assert.deepEqual(log.map((x) => x[0]), ['append', 'click', 'remove']);
    assert.equal(timers.length, 1, 'the release is scheduled even so');
  } finally {
    Object.assign(globalThis, saved);
  }
});
