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

test('preflight: Opus in MP4 is an info note; no-audio-codec only when neither AAC nor Opus encodes (DESIGN_2_1 §13.4)', () => {
  const doc = sampleDoc({ short: 720, fps: 30 });
  doc.song = { name: 's.mp3', sha1: 'x', seconds: 30, bpm: null, offset: 0, meter: 4, bpmConfidence: null, digest: null, info: null };
  const plan = samplePlan(doc);
  const opus = Object.assign({}, READY, { audioCodec: 'opus' });
  assert.deepEqual(S.preflight(doc, plan, opus), [{ code: 'opus-audio', level: 'info', params: {} }]);
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, READY, { audioCodec: null }))), ['no-audio-codec']);
  assert.deepEqual(S.preflight(doc, plan, READY), [], 'AAC: no note');
  const silent = sampleDoc({ short: 720, fps: 30, audio: false });
  silent.song = doc.song;
  assert.deepEqual(S.preflight(silent, plan, opus), [], 'no sound asked for: no note');
  assert.deepEqual(S.preflight(sampleDoc({ short: 720, fps: 30 }), plan, opus), [], 'no song: no note');
  const png = sampleDoc({ format: 'png' });
  png.song = doc.song;
  assert.deepEqual(S.preflight(png, plan, opus), [], 'a PNG sequence has no sound');
  assert.equal(S.OPUS_BITRATE, 160000);
  assert.equal(S.AUDIO_BITRATE, 192000);
});

// --- export/host/mp4 in Node: the audio codec order, the media wait (WebCodecs stubbed) ------------------------------

const MP4 = MV.use('export/host/mp4');

// Runs fn with a stub AudioEncoder (and VideoEncoder) whose isConfigSupported accepts only `codecs`; 'throw' codecs throw.
async function withEncoders(codecs, fn) {
  const saved = { a: globalThis.AudioEncoder, v: globalThis.VideoEncoder };
  const asked = [];
  globalThis.AudioEncoder = class {
    static async isConfigSupported(config) {
      asked.push(Object.assign({}, config));
      if (config.codec.startsWith('throw')) throw new TypeError('bad codec string');
      return { supported: codecs.includes(config.codec), config };
    }
  };
  globalThis.VideoEncoder = class { static async isConfigSupported(config) { return { supported: config.codec.startsWith('avc1'), config }; } };
  try { return await fn(asked); } finally {
    if (saved.a === undefined) delete globalThis.AudioEncoder; else globalThis.AudioEncoder = saved.a;
    if (saved.v === undefined) delete globalThis.VideoEncoder; else globalThis.VideoEncoder = saved.v;
  }
}

test('MP4 audio: AAC-LC at 192 kbps, else Opus at 160 kbps (48 kHz stereo), else none; codecs.audioList overrides', async () => {
  const song = { sampleRate: 48000 };
  assert.deepEqual(MP4.AUDIO_CODECS, ['mp4a.40.2', 'opus']);
  await withEncoders(['mp4a.40.2', 'opus'], async () => {
    assert.deepEqual(await MP4.audioConfig(null, song), { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
    assert.equal((await MP4.probe({ w: 1280, h: 720, fps: 30 })).audioCodec, 'mp4a.40.2');
  });
  await withEncoders(['opus'], async (asked) => {
    assert.deepEqual(await MP4.audioConfig(null, song), { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 },
      'no AAC encoder (Chrome on Linux): Opus in MP4');
    assert.deepEqual(asked.map((c) => c.codec), ['mp4a.40.2', 'opus'], 'AAC is tried first');
    const pr = await MP4.probe({ w: 1280, h: 720, fps: 30 });
    assert.deepEqual([pr.webcodecs, pr.audioCodec], [true, 'opus']);
  });
  await withEncoders(['mp4a.40.2', 'opus'], async (asked) => {
    const forced = await MP4.audioConfig({ audioList: ['throw.aac', 'bogus.aac', 'opus'] }, song);
    assert.equal(forced.codec, 'opus', 'the test override: an unknown or throwing codec is skipped');
    assert.deepEqual(asked.map((c) => c.codec), ['throw.aac', 'bogus.aac', 'opus']);
    assert.equal((await MP4.probe({ w: 1280, h: 720, fps: 30, codecs: { audioList: ['bogus.aac', 'opus'] } })).audioCodec, 'opus');
    assert.equal((await MP4.audioConfig({ audio: 'mp4a.40.2' }, song)).codec, 'mp4a.40.2', 'codecs.audio: that codec only');
  });
  await withEncoders([], async () => {
    assert.equal(await MP4.audioConfig(null, song), null, 'neither encodes: the MP4 is silent');
    assert.equal((await MP4.probe({ w: 1280, h: 720, fps: 30 })).audioCodec, null);
  });
});

test('export jobs await engine.mediaReady(t) before each frame; a store failure stops with ExportError(media) naming the asset', async () => {
  const REC = MV.use('engine/render/record');
  const doc = sampleDoc({ short: 360, fps: 30, range: { t0: 1, t1: 2 } });
  doc.media = { list: [{ id: 'a3f9c2d17b0e4a5c6d7e8f901', name: '海辺.mp4' }] };
  const log = [];
  const engineWith = (mediaReady) => ({
    fork() {
      const e = { plan: samplePlan(doc), async prepare() {}, renderFrame(s, t) { log.push(['render', t]); }, dispose() { log.push(['dispose']); } };
      if (mediaReady) e.mediaReady = mediaReady;
      return e;
    },
  });
  const rec = REC.createRecorder();
  const signal = new AbortController().signal;
  const job = await MP4.openJob({ engine: engineWith(async (t, o) => { log.push(['ready', t, o.fps, o.signal === signal, o.scale]); }), doc,
    format: 'mp4', canvas: rec.factory });
  for (let i = 0; i < 3; i++) { await job.ready(i, signal); job.render(i); }
  assert.deepEqual(log.map((x) => x.slice(0, 2)), [['ready', 1], ['render', 1], ['ready', 1 + 1 / 30], ['render', 1 + 1 / 30],
    ['ready', 1 + 2 / 30], ['render', 1 + 2 / 30]]);
  assert.ok(log.filter((x) => x[0] === 'ready').every((x) => x[2] === 30 && x[3]), 'with the fps and the signal');
  const scale = S.renderScale(job.plan.design, job.w, job.h);
  assert.ok(scale > 0 && log.filter((x) => x[0] === 'ready').every((x) => x[4] === scale), 'and the output scale (the still tiers)');
  // engines without media (the fake engine) resolve at once
  const plain = await MP4.openJob({ engine: engineWith(null), doc, format: 'mp4', canvas: rec.factory });
  await plain.ready(0, signal);
  // the store cannot deliver: ExportError('media') with the asset's id and name, never a substitute frame
  const failing = await MP4.openJob({ engine: engineWith(async () => {
    throw Object.assign(new Error('media not on this device: a3f9c2d17b0e4a5c6d7e8f901'), { code: 'media-missing', id: 'a3f9c2d17b0e4a5c6d7e8f901' });
  }), doc, format: 'mp4', canvas: rec.factory });
  await assert.rejects(failing.ready(0, signal), (err) => err instanceof S.ExportError && err.code === 'media' &&
    err.detail.name === '海辺.mp4' && err.detail.id === 'a3f9c2d17b0e4a5c6d7e8f901' && err.detail.code === 'media-missing');
  // cancelled while waiting: 'cancelled', not a media error
  const ctl = new AbortController();
  const waiting = await MP4.openJob({ engine: engineWith(async () => { ctl.abort(); throw Object.assign(new Error('aborted'), { code: 'aborted' }); }),
    doc, format: 'mp4', canvas: rec.factory });
  await assert.rejects(waiting.ready(0, ctl.signal), (err) => err.code === 'cancelled');
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

// 保存 over the open project hands the sink the file the user already has: a cancelled or failed save must leave it.
test('file sink with removeOnAbort false: a cancelled or failed write drops the swap file and keeps the user\'s file', async () => {
  const cancelled = fakeHandle();
  const sink = SINK.createFileSink(cancelled.handle, { removeOnAbort: false });
  await sink.write(new Uint8Array(3));
  await sink.abort();
  assert.equal(cancelled.handle.removed, false);
  deepEqual(cancelled.log.map((x) => x[0]), ['open', 'write', 'abort']);
  const failed = fakeHandle({ closeFails: true });
  const again = SINK.createFileSink(failed.handle, { removeOnAbort: false });
  await again.write(new Uint8Array(8));
  await assert.rejects(again.close(), (e) => e.code === 'sink');
  await again.abort();
  assert.equal(failed.handle.removed, false, 'a failed close keeps the file too');
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

// --- DESIGN_2_1 §13: formats, VP9, the kit's files, its pre-flight, the WAV writer, subtitles (package H.2) ----------

const WAV = MV.use('audio/wav');
const SUB = MV.use('export/subtitles');
const SM = MV.use('media/samples');

function withSong(doc) {
  doc.song = { name: 's.mp3', sha1: 'x', seconds: 30, bpm: null, offset: 0, meter: 4, bpmConfidence: null, digest: null, info: null };
  return doc;
}

const KIT_READY = Object.assign({}, READY, { vp9Codec: 'vp09.00.40.08', anyCodec: true, dirAccess: true });

test('FORMATS: one entry per output.format, in the document order, and backdropFor clears exactly the transparent ones', () => {
  deepEqual(Object.keys(S.FORMATS), docs.OUTPUT_CHOICES.format);
  deepEqual(Object.fromEntries(Object.entries(S.FORMATS).map(([k, f]) => [k, [f.ext, f.alpha, f.video, f.codec, f.audio, f.folder]])), {
    mp4: ['mp4', false, true, 'avc', 'aac-opus', false], kit: ['zip', false, true, 'avc+vp9', 'aac-wav', true],
    webmAlpha: ['webm', true, true, 'vp9', 'opus', false], png: ['zip', false, false, null, null, false],
    pngAlpha: ['zip', true, false, null, null, false],
  });
  assert.ok(Object.isFrozen(S.FORMATS) && Object.values(S.FORMATS).every(Object.isFrozen));
  for (const format of docs.OUTPUT_CHOICES.format) {
    for (const backdrop of ['scene', 'chroma', 'black', 'clear']) {
      const want = S.FORMATS[format].alpha ? 'clear' : backdrop === 'clear' ? 'scene' : backdrop;
      assert.equal(S.backdropFor(format, backdrop), want, format + ' / ' + backdrop);
    }
  }
  assert.equal(S.backdropFor('kit', 'chroma'), 'chroma', 'the kit renders the document backdrop');
  assert.equal(S.backdropFor('webmAlpha', 'black'), 'clear');
});

test('pickVp9: VP9 profile 0, 8-bit, at the smallest level that holds the size and rate, then VP8', () => {
  const cases = [['16:9', 720, 30, '31'], ['16:9', 1080, 24, '40'], ['16:9', 1080, 30, '40'], ['16:9', 1080, 60, '41'],
    ['16:9', 1440, 30, '50'], ['16:9', 2160, 30, '50'], ['16:9', 2160, 60, '51'], ['9:16', 1080, 30, '40'], ['1:1', 720, 30, '30'],
    ['21:9', 2160, 60, '62']];   // 5040×2160 is past the table's 8.9 M pixels: level 6.2
  for (const [aspect, short, fps, level] of cases) {
    const { w, h } = S.outputSize(aspect, short);
    deepEqual(S.pickVp9(w, h, fps), ['vp09.00.' + level + '.08', 'vp8'], aspect + ' ' + short + 'p' + fps);
    assert.equal(Number(level), SM.vp9Level(w, h, fps), 'the level table of media/samples');
  }
  deepEqual(S.pickVp9(192, 108, 30), ['vp09.00.10.08', 'vp8'], 'two digits even at level 1.0');
});

test('transparent WebM sizes: the alpha stream at ALPHA_SHARE of the colour bitrate, Opus when there is sound', () => {
  assert.equal(S.ALPHA_SHARE, 1);
  assert.equal(S.alphaBitrate(3317760), 3317760);
  const bits = S.bitrate(1920, 1080, 30, 'high');
  assert.equal(S.estimateWebmBytes(10, bits, false), Math.ceil(((10 * (bits + S.alphaBitrate(bits))) / 8) * 1.02));
  assert.equal(S.estimateWebmBytes(10, bits, true) - S.estimateWebmBytes(10, bits, false), Math.ceil(((10 * (2 * bits + 160000)) / 8) * 1.02)
    - Math.ceil(((10 * 2 * bits) / 8) * 1.02), 'Opus at 160 kbps');
  assert.equal(S.estimateWebmBytes(0, bits, true), 0);
});

test('kitFiles: the §13.9 names and order, the WAV only without AAC, estimates from the bitrates and audioFrames', () => {
  const doc = withSong(sampleDoc({ format: 'kit', short: 1080, fps: 30, quality: 'high', range: { t0: 1, t1: 5 } }));
  const plan = samplePlan(doc);
  const base = '夜明け のうた';
  assert.equal(S.kitBase(doc), base);
  assert.equal(S.kitFolder(doc), base + '_filmora');
  // defaults: overlay and SRT on (core/doc KIT_DEFAULT)
  const aac = S.kitFiles(doc, plan, { audioCodec: 'mp4a.40.2' });
  deepEqual(aac.map((f) => [f.name, f.kind]), [[base + '.mp4', 'main'], [base + '_overlay.webm', 'overlay'], [base + '.srt', 'srt'],
    ['README_Filmora.txt', 'readme']]);
  const bits = S.bitrate(1920, 1080, 30, 'high');
  assert.equal(aac[0].est, S.estimateBytes(4, bits, true), 'the main MP4 carries AAC');
  assert.equal(aac[1].est, S.estimateWebmBytes(4, bits, false), 'the overlay is silent');
  assert.ok(aac[2].est > 3 && aac[2].est < 400, 'SRT: a few cues');
  doc.output.kit = { overlay: true, bg: true, green: true, srt: true, lrc: true };
  const all = S.kitFiles(doc, plan, { audioCodec: 'opus' });
  deepEqual(all.map((f) => f.name), [base + '.mp4', base + '_overlay.webm', base + '_bg.mp4', base + '_green.mp4', base + '.srt', base + '.lrc',
    base + '.wav', 'README_Filmora.txt']);
  const by = Object.fromEntries(all.map((f) => [f.kind, f.est]));
  assert.equal(by.main, S.estimateBytes(4, bits, false), 'no AAC: the MP4 is silent');
  assert.equal(by.bg, S.estimateBytes(4, bits, false));
  assert.equal(by.green, S.estimateBytes(4, S.bitrate(1920, 1080, 30, 'max'), false), 'the green screen at quality max (§13.6)');
  assert.equal(by.wav, 44 + S.audioFrames(S.frameCount(4, 30), 30, 48000) * 4, 'the WAV: exact');
  assert.ok(by.lrc > 0 && by.readme > 0);
  assert.ok(S.kitFiles(doc, plan, { audioCodec: null }).some((f) => f.kind === 'wav'), 'no audio encoder at all: the WAV');
  assert.ok(!S.kitFiles(doc, plan, {}).some((f) => f.kind === 'wav'), 'not probed yet: the MP4 is expected to carry AAC');
  assert.ok(!S.kitFiles(doc, plan, { audioCodec: 'opus', songReady: false }).some((f) => f.kind === 'wav'), 'no song loaded: no WAV');
  const silent = Object.assign({}, doc, { output: Object.assign({}, doc.output, { audio: false }) });
  assert.ok(!S.kitFiles(silent, plan, { audioCodec: 'opus' }).some((f) => f.kind === 'wav'), '音声を入れる off: no WAV');
  const songless = Object.assign({}, doc, { song: null });
  assert.ok(!S.kitFiles(songless, plan, { audioCodec: 'opus' }).some((f) => f.kind === 'wav'), 'no song: no WAV');
  doc.output.kit = { overlay: false, bg: false, green: false, srt: false, lrc: false };
  deepEqual(S.kitFiles(doc, plan, { audioCodec: 'mp4a.40.2' }).map((f) => f.kind), ['main', 'readme'], 'the main MP4 and the README always');
  delete doc.output.kit;
  deepEqual(S.kitOptions(doc.output), docs.KIT_DEFAULT, 'a document without output.kit gets the defaults');
  // file names from output.name, with an emoji cut on a grapheme boundary: every suffix is ASCII after the title
  const named = sampleDoc({ format: 'kit', name: 'a'.repeat(79) + '🎵 live' });
  assert.equal(S.kitBase(named), 'a'.repeat(79));
  assert.ok(S.kitFiles(named, samplePlan(named), {}).every((f) => f.name === 'README_Filmora.txt' || /^a{79}(_overlay\.webm|\.mp4|\.srt)$/.test(f.name)));
});

test('preflight: the kit — kit-wav, kit-fps, kit-size, no-vp9, kit-memory, and the MP4 codec blocks', () => {
  const doc = withSong(sampleDoc({ format: 'kit', short: 1080, fps: 30 }));
  const plan = samplePlan(doc);
  deepEqual(S.preflight(doc, plan, KIT_READY), [{ code: 'kit-fps', level: 'info', params: { fps: 30, w: 1920, h: 1080 } }]);
  for (const audioCodec of ['opus', null]) {
    deepEqual(S.preflight(doc, plan, Object.assign({}, KIT_READY, { audioCodec })).slice(0, 1),
      [{ code: 'kit-wav', level: 'info', params: { name: '夜明け のうた' } }], 'no AAC (' + audioCodec + '): the WAV, never opus-audio or no-audio-codec');
  }
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, KIT_READY, { audioCodec: undefined }))), ['kit-fps'], 'not probed: no note');
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, KIT_READY, { audioCodec: 'opus', songReady: false }))),
    ['song-missing', 'kit-fps'], 'the song is not loaded: song-missing instead of kit-wav');
  const silent = sampleDoc({ format: 'kit', short: 1080, fps: 30, audio: false });
  withSong(silent);
  assert.deepEqual(codes(S.preflight(silent, plan, Object.assign({}, KIT_READY, { audioCodec: 'opus' }))), ['kit-fps']);
  for (const [short, note] of [[720, true], [1080, false], [1440, true], [2160, false]]) {
    const d = sampleDoc({ format: 'kit', short, fps: 24 });
    const items = S.preflight(d, samplePlan(d), KIT_READY);
    assert.equal(items.some((x) => x.code === 'kit-size'), note, short + 'p');
    if (note) deepEqual(items.find((x) => x.code === 'kit-size'), { code: 'kit-size', level: 'info', params: { short } });
  }
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, KIT_READY, { vp9Codec: null }))), ['no-vp9', 'kit-fps'], 'the overlay needs VP9');
  assert.equal(S.preflight(doc, plan, Object.assign({}, KIT_READY, { vp9Codec: null }))[0].level, 'block');
  const noOverlay = Object.assign({}, doc, { output: Object.assign({}, doc.output, { kit: Object.assign({}, docs.KIT_DEFAULT, { overlay: false }) }) });
  assert.deepEqual(codes(S.preflight(noOverlay, plan, Object.assign({}, KIT_READY, { vp9Codec: null }))), ['kit-fps'], 'without the overlay VP9 is not needed');
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, KIT_READY, { codec: null, anyCodec: false }))), ['no-h264', 'kit-fps']);
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, KIT_READY, { codec: null }))), ['no-codec', 'kit-fps']);
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, KIT_READY, { webcodecs: false }))), ['no-webcodecs', 'kit-fps']);
  // no folder access: the set is built in memory; the D§4.21 confirmation applies to its total
  const mem = S.preflight(doc, plan, Object.assign({}, KIT_READY, { dirAccess: false, audioCodec: 'opus' })).find((x) => x.code === 'kit-memory');
  const total = S.kitFiles(doc, plan, { audioCodec: 'opus' }).reduce((s, f) => s + f.est, 0);
  deepEqual(mem, { code: 'kit-memory', level: 'warn', params: { bytes: total } });
  assert.ok(!S.preflight(doc, plan, Object.assign({}, KIT_READY, { dirAccess: false })).some((x) => x.code === 'memory'), 'not the file memory item');
  assert.ok(S.preflight(doc, plan, Object.assign({}, KIT_READY, { dirAccess: undefined, fsAccess: false })).some((x) => x.code === 'kit-memory'),
    'dirAccess defaults to fsAccess');
  assert.ok(!S.preflight(doc, plan, Object.assign({}, KIT_READY, { dirAccess: true, fsAccess: false })).some((x) => /memory/.test(x.code)),
    'a folder can be written although a file picker is missing');
  const big = sampleDoc({ format: 'kit', short: 2160, fps: 60, quality: 'max' });
  assert.equal(S.preflight(big, Object.assign({}, samplePlan(big), { duration: 3600 }), Object.assign({}, KIT_READY, { dirAccess: false }))
    .find((x) => x.code === 'kit-memory').level, 'confirm', '> 1.5 GB asks');
  assert.ok(!S.preflight(sampleDoc({ format: 'kit' }), plan, KIT_READY).some((x) => x.code === 'clear-mp4'), 'no clear-mp4 for the kit');
});

test('preflight: 透過動画（WebM） — no-vp9 blocks, Opus is its sound, memory by its own estimate', () => {
  const doc = withSong(sampleDoc({ format: 'webmAlpha', short: 720, fps: 30 }));
  const plan = samplePlan(doc);
  assert.deepEqual(S.preflight(doc, plan, KIT_READY), []);
  deepEqual(S.preflight(doc, plan, Object.assign({}, KIT_READY, { vp9Codec: null })), [{ code: 'no-vp9', level: 'block', params: {} }]);
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, KIT_READY, { codec: null, anyCodec: false }))), [], 'H.264 is not needed');
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, KIT_READY, { webcodecs: false }))), ['no-webcodecs']);
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, KIT_READY, { audioCodec: 'opus' }))), [], 'Opus is the WebM standard: no note');
  assert.deepEqual(codes(S.preflight(doc, plan, Object.assign({}, KIT_READY, { audioCodec: null }))), ['no-audio-codec']);
  const mem = S.preflight(doc, plan, Object.assign({}, KIT_READY, { fsAccess: false }));
  deepEqual(mem, [{ code: 'memory', level: 'warn', params: { bytes: S.estimateWebmBytes(plan.duration, S.bitrate(1280, 720, 30, 'high'), true) } }]);
  const clear = withSong(sampleDoc({ format: 'webmAlpha' }));
  clear.look.backdrop = 'clear';
  assert.deepEqual(codes(S.preflight(clear, plan, KIT_READY)), [], 'no clear-mp4');
});

test('layerDiffs and layers-approx: world seams and screen effects where background under overlay is not the full render', () => {
  const doc = withSong(sampleDoc({ format: 'kit', short: 1080, fps: 30 }));
  doc.output.kit = { overlay: true, bg: true, green: false, srt: true, lrc: false };
  const base = samplePlan(doc);
  const setFilters = (plan, i, keys) => {
    const cut = plan.cuts[i];
    const slots = Object.assign({}, cut.slots, { 'filter.count': { v: keys.length } });
    keys.forEach((k, j) => { slots['filter#' + j] = { v: k }; });
    plan.cuts = plan.cuts.map((c, k) => (k === i ? Object.assign({}, c, { slots }) : c));
  };
  const plain = Object.assign({}, base);
  deepEqual(S.layerDiffs(doc, plain, null), { keys: [], seams: 0 });
  assert.ok(!S.preflight(doc, plain, KIT_READY).some((x) => x.code === 'layers-approx'));
  const registry = { get: (kind, key) => ({ grainFilm: { key, stage: 'film', alphaSafe: false }, sliceGlitch: { key, stage: 'shape', alphaSafe: true },
    edgeShade: { key, stage: 'tone', alphaSafe: false } })[key] || null };
  const fx = Object.assign({}, base, { cuts: base.cuts.slice() });
  setFilters(fx, 1, ['sliceGlitch', 'edgeShade']);
  fx.look = Object.assign({}, fx.look, { texture: { v: 'grainFilm' } });
  deepEqual(S.layerDiffs(doc, fx, registry), { keys: ['edgeShade', 'grainFilm', 'sliceGlitch'], seams: 0 },
    'every accent (absent from the background), the texture that is not alphaSafe (absent from the overlay)');
  deepEqual(S.layerDiffs(doc, Object.assign({}, fx, { look: Object.assign({}, fx.look, { texture: { v: 'sliceGlitch' } }) }), registry).keys,
    ['edgeShade', 'sliceGlitch'], 'an alphaSafe texture is in both layers');
  const chroma = Object.assign({}, doc, { look: Object.assign({}, doc.look, { backdrop: 'chroma' }) });
  deepEqual(S.layerDiffs(chroma, fx, registry).keys, ['sliceGlitch'], 'under the green screen only alphaSafe and shape filters run');
  const item = S.preflight(doc, fx, Object.assign({}, KIT_READY, { registry })).find((x) => x.code === 'layers-approx');
  deepEqual(item, { code: 'layers-approx', level: 'info', params: { keys: ['edgeShade', 'grainFilm', 'sliceGlitch'], seams: 0 } });
  // outside the export range the effects do not count
  const cut1 = fx.cuts[1];
  const outside = Object.assign({}, doc, { output: Object.assign({}, doc.output, { range: { t0: cut1.b + 0.5, t1: cut1.b + 1 } }) });
  deepEqual(S.layerDiffs(outside, Object.assign({}, fx, { look: base.look }), registry).keys.includes('edgeShade'), false);
  // world seams in the range; text seams do not count
  const seams = Object.assign({}, base, { seams: [{ at: 2, dur: 0.6, scope: 'world' }, { at: 3, dur: 0.6, scope: 'text' },
    { at: 999, dur: 0.6, scope: 'world' }] });
  deepEqual(S.layerDiffs(doc, seams, null), { keys: [], seams: 1 });
  deepEqual(S.preflight(doc, seams, KIT_READY).find((x) => x.code === 'layers-approx').params, { keys: [], seams: 1 });
  const overlayOnly = Object.assign({}, doc, { output: Object.assign({}, doc.output, { kit: Object.assign({}, doc.output.kit, { bg: false }) }) });
  assert.ok(!S.preflight(overlayOnly, seams, KIT_READY).some((x) => x.code === 'layers-approx'), 'only when both layers are written');
  assert.ok(!S.preflight(Object.assign({}, doc, { output: Object.assign({}, doc.output, { format: 'mp4' }) }), seams, KIT_READY)
    .some((x) => x.code === 'layers-approx'), 'only for the kit');
});

test('encodePcm16: a WAV of exactly `frames` stereo 16-bit frames from `start`, mixed down, padded with silence', () => {
  const L = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, NaN, 0.25]);
  const R = Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
  const bytes = WAV.encodePcm16([L, R], 48000, 2, 8);
  const v = new DataView(bytes.buffer);
  const text = (at, n) => String.fromCharCode(...bytes.subarray(at, at + n));
  assert.equal(bytes.length, 44 + 8 * 4);
  deepEqual([text(0, 4), v.getUint32(4, true), text(8, 4), text(12, 4), v.getUint32(16, true), v.getUint16(20, true), v.getUint16(22, true),
    v.getUint32(24, true), v.getUint32(28, true), v.getUint16(32, true), v.getUint16(34, true), text(36, 4), v.getUint32(40, true)],
  ['RIFF', 36 + 32, 'WAVE', 'fmt ', 16, 1, 2, 48000, 192000, 4, 16, 'data', 32]);
  const samples = [];
  for (let k = 0; k < 16; k++) samples.push(v.getInt16(44 + 2 * k, true));
  const q = (x) => Math.round(x * 32767);
  deepEqual(samples, [q(-0.5), q(0.3), 32767, q(0.4), -32767, q(0.5), 32767, q(0.6), 0, q(0.7), q(0.25), q(0.8), 0, 0, 0, 0],
    'from sample 2: clamped to ±1 (symmetric), NaN is silence, zeros past the end');
  const before = WAV.encodePcm16([L, R], 48000, -2, 3);
  deepEqual(Array.from(new Int16Array(before.buffer.slice(44))), [0, 0, 0, 0, 0, q(0.1)], 'zeros before the start');
  const mono = WAV.encodePcm16([Float32Array.from([0.5, -0.25])], 44100, 0, 2);
  deepEqual(Array.from(new Int16Array(mono.buffer.slice(44))), [q(0.5), q(0.5), q(-0.25), q(-0.25)], 'mono goes to both sides');
  assert.equal(new DataView(mono.buffer).getUint32(24, true), 44100);
  const c = Float32Array.from([0.3, 0.3]);
  const z = new Float32Array(2);
  const surround = WAV.encodePcm16([z, z, c, z, z, z], 48000, 0, 2);
  const h = q(0.3 * Math.SQRT1_2);
  assert.ok(Array.from(new Int16Array(surround.buffer.slice(44))).every((x) => Math.abs(x - h) <= 1), '5.1: the centre at √½ on both sides (D§4.21)');
  assert.equal(WAV.encodePcm16([L, R], 48000, 0, 0).length, 44, 'zero frames: the header only');
  assert.throws(() => WAV.encodePcm16([L, R], 48000, 0.5, 2), RangeError);
  assert.throws(() => WAV.encodePcm16([L, R], 0, 0, 2), RangeError);
  assert.throws(() => WAV.pcm16Header(48000, 2 ** 30), RangeError, 'more than 4 GB');
});

test('pcm16Data in pieces concatenates to the whole; the export down-mix is one function (schedule re-exports audio/wav)', () => {
  const n = 200003;
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = Math.sin(i / 7); R[i] = Math.cos(i / 11) * 0.8; }
  const whole = WAV.encodePcm16([L, R], 48000, 1000, 150000);
  const parts = [WAV.pcm16Header(48000, 150000, 2), WAV.pcm16Data([L, R], 1000, 70001, 2), WAV.pcm16Data([L, R], 71001, 79999, 2)];
  const joined = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { joined.set(p, at); at += p.length; }
  assert.deepEqual(joined, whole);
  assert.equal(S.fillPlanar, WAV.fillPlanar);
  assert.equal(S.mixMatrix, WAV.mixMatrix);
});

// ui/project_io's lrcText before it moved to export/subtitles (DESIGN_2_1 §13.8), kept as the reference.
function previousLrcText(app) {
  const L = MV.use('core/lyrics');
  const lrcTag = (s) => {
    const cs = Math.max(0, Math.round(s * 100));
    const m = Math.floor(cs / 6000), sec = Math.floor(cs / 100) % 60, c = cs % 100;
    return '[' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(c).padStart(2, '0') + ']';
  };
  const byRow = new Map();
  for (const l of app.plan ? app.plan.lines : []) {
    const row = l.row || l.id;
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push(l);
  }
  const out = [];
  for (const row of app.doc.sheet.rows) {
    if (L.isMetaRow(row.src)) { out.push(row.src.trim()); continue; }
    const lines = byRow.get(row.id);
    if (!lines) continue;
    out.push(lines.map((l) => l.t0).sort((a, b) => a - b).map(lrcTag).join('') + lines[0].text);
  }
  return out.join('\n') + '\n';
}

test('ui/project_io lrcText delegates to export/subtitles.lrc: the previous bytes on every fixture, for the current plan', () => {
  const corpus = require('../helpers/corpus.js');
  const IO = MV.use('ui/project_io');
  const PL = MV.use('planner/plan');
  const MIG = MV.use('core/migrate');
  const T = MV.use('i18n/t');
  const t = T.createT('ja', MV.use('i18n/strings'));
  const reg = corpus.stubRegistry(MV);
  for (const name of corpus.ALL_PROJECTS) {
    const doc = MIG.parseFile(corpus.projectText(name)).doc;
    const app = { t, bus: { emit() {} }, doc, plan: PL.run(doc, reg, null) };
    const io = IO.create(app);
    const text = io.lrcText();
    assert.equal(text, previousLrcText(app), name);
    assert.equal(text, SUB.lrc(app.plan, app.doc), name);
    app.plan = null;
    assert.equal(io.lrcText(), previousLrcText(app), name + ': without a plan, the meta rows (read at call time)');
  }
});
