/* 文字PVメーカー v2 — original work. Live export mechanisms follow installed encoders and actual work, without adding completed frames. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const F = require('../helpers/fake_engine.js');
const api = load();
const J = api.use('export/host/mp4'), W = api.use('export/host/webm'), PNG = api.use('export/host/png');
const KIT = api.use('export/host/kit'), D = api.use('core/doc'), SINK = api.use('export/host/sink');

function docFor(format = 'mp4', extra = {}) {
  const doc = D.defaultDoc();
  doc.sheet = { next: 2, rows: [{ id: 'r1', src: '[00:00.00]live export' }] };
  doc.song = { name: 'song.wav', sha1: 'song', seconds: 2, bpm: null, offset: 0, meter: 4 };
  Object.assign(doc.output, { format, short: 180, fps: 30, audio: false, audioEncoding: 'browser',
    range: { t0: .1, t1: .2 }, kit: { overlay: true, bg: true, green: true, srt: false, lrc: false } }, extra);
  return doc;
}

function engine(doc) { const e = F.createEngine(); e.setDoc(doc); return e; }
function canvas() {
  const recorder = F.createRecorder();
  return { create(w, h, opts) {
    const surface = recorder.factory.create(w, h, opts);
    surface.ctx.getImageData = () => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) });
    surface.canvas.convertToBlob = async () => new Blob([Uint8Array.of(137, 80, 78, 71)]);
    return surface;
  } };
}

function mp4Lib() {
  class ArrayBufferTarget { constructor() { this.buffer = null; } }
  class StreamTarget { constructor(options) { this.options = options; } }
  class Muxer {
    constructor(o) { this.options = o; }
    addVideoChunk() {} addAudioChunk() {}
    finalize() {
      const bytes = Uint8Array.of(1, 2, 3);
      if (this.options.target instanceof StreamTarget) this.options.target.options.onData(bytes, 0);
      else this.options.target.buffer = bytes.buffer;
    }
  }
  return { ArrayBufferTarget, StreamTarget, Muxer };
}

function chunk(frame, key) {
  return { timestamp: frame.timestamp, duration: frame.duration || 1000, type: key ? 'key' : 'delta',
    byteLength: 3, copyTo: (dest) => dest.set([1, 2, 3]) };
}

async function withCodecs(options, run) {
  const names = ['VideoEncoder', 'VideoFrame', 'AudioEncoder', 'AudioData'];
  const saved = Object.fromEntries(names.map((name) => [name, globalThis[name]]));
  const log = { video: [], audio: [], order: [] };
  class VideoFrame {
    constructor(source, opts) { Object.assign(this, opts); this.source = source; }
    close() {}
  }
  class VideoEncoder {
    static async isConfigSupported(config) { return { supported: true, config }; }
    constructor(init) { this.init = init; this.index = log.video.length; this.state = 'unconfigured'; this.encodeQueueSize = 0; this.inputs = []; log.video.push(this); }
    configure(config) {
      this.config = config;
      if (options.configure) options.configure(config, this);
      this.state = 'configured';
    }
    encode(frame, opts) { this.inputs.push(frame.timestamp); log.order.push('video'); this.init.output(chunk(frame, opts.keyFrame), {}); }
    async flush() { log.order.push('videoFlush'); if (options.flush) await options.flush(this); }
    close() { this.state = 'closed'; }
  }
  class AudioData { constructor(opts) { Object.assign(this, opts); } close() {} }
  class AudioEncoder {
    static async isConfigSupported(config) { return { supported: options.audio !== false, config }; }
    constructor(init) { this.init = init; this.state = 'unconfigured'; this.encodeQueueSize = 0; this.inputs = []; log.audio.push(this); }
    configure(config) { this.config = config; this.state = 'configured'; }
    encode(frame) {
      this.inputs.push(frame.timestamp); log.order.push('audio');
      this.init.output(chunk(frame, true), { decoderConfig: { codec: this.config.codec,
        description: Uint8Array.from([79, 112, 117, 115, 72, 101, 97, 100, 1, 2, 56, 1, 128, 187, 0, 0, 0, 0, 0]) } });
    }
    async flush() { log.order.push('audioFlush'); }
    close() { this.state = 'closed'; }
  }
  Object.assign(globalThis, { VideoEncoder, VideoFrame, AudioEncoder, AudioData });
  try { return await run(log); } finally {
    for (const name of names) { if (saved[name] === undefined) delete globalThis[name]; else globalThis[name] = saved[name]; }
  }
}

function args(doc, extra = {}) {
  return Object.assign({ engine: engine(doc), doc, audio: null, sink: SINK.createMemorySink(), canvas: canvas(), lib: mp4Lib() }, extra);
}

test('live MP4 reports the installed automatic fallback before frames, not the successful hardware support probe', async () => {
  await withCodecs({ configure(config) { if (config.hardwareAcceleration === 'prefer-hardware') throw new Error('GPU busy'); } }, async (log) => {
    const process = [], progress = [];
    const result = await J.exportVideo(args(docFor('mp4', { acceleration: 'gpu' }), {
      onProcess(p) {
        process.push(p);
        if (p.stage === 'video') {
          assert.equal(log.video.length, 2);
          assert.equal(log.video[0].state, 'closed');
          assert.equal(log.video[1].state, 'configured');
          assert.equal(log.video[1].inputs.length, 0);
        }
      }, onProgress(p) { progress.push(p.i); },
    }));
    assert.deepEqual(process.map((p) => p.stage), ['prepare', 'video', 'finalize', 'mux', 'save']);
    assert.deepEqual(process[1].acceleration, { requested: 'gpu', selected: 'no-preference', fallback: true });
    assert.equal(process[1].codec, result.codec);
    assert.equal(process[1].frameCount, result.frames);
    assert.deepEqual(progress, [1, 2, 3]);
    assert.ok(log.video.every((e) => e.state === 'closed'));
  });
});

test('finalizing starts before a blocked encoder flush and does not emit completed-frame progress', async () => {
  let release, reached;
  const flushed = new Promise((resolve) => { reached = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  await withCodecs({ async flush() { reached(); await gate; } }, async () => {
    const process = [], progress = [], doc = docFor('mp4', { acceleration: 'cpu' });
    const pending = J.exportVideo(args(doc, { onProcess: (p) => process.push(p), onProgress: (p) => progress.push(p) }));
    await flushed;
    assert.equal(process.at(-1).stage, 'finalize');
    assert.deepEqual(process.find((p) => p.stage === 'video').acceleration,
      { requested: 'cpu', selected: 'prefer-software', fallback: false });
    assert.equal(progress.length, 3);
    assert.equal(progress.at(-1).i, 3);
    assert.ok(!process.some((p) => p.stage === 'mux'));
    release(); await pending;
    assert.equal(process.at(-1).stage, 'save');
    assert.equal(progress.length, 3, 'flush and mux did not invent additional frames');
  });
});

test('native MP4 audio is reported from the installed audio encoder and remains concurrent with video', async () => {
  await withCodecs({}, async (log) => {
    const song = { sampleRate: 48000, numberOfChannels: 2, getChannelData: () => new Float32Array(20000) };
    const process = [], result = await J.exportVideo(args(docFor('mp4', { audio: true }), {
      audio: song, onProcess(p) {
        process.push(p);
        if (p.stage === 'video') assert.equal(log.audio[0].state, 'configured');
      },
    }));
    const video = process.find((p) => p.stage === 'video');
    assert.equal(video.audioSource, 'browser');
    assert.equal(video.audioCodec, result.audioCodec);
    assert.ok(!process.some((p) => p.stage === 'audio'), 'native MP4 audio is fed during the video pass');
    assert.ok(log.order.indexOf('audio') < log.order.lastIndexOf('video'));
  });
});

test('WebM completes native Opus first, then reports independent installed colour and alpha preferences', async () => {
  await withCodecs({ configure(config, encoder) {
    if (config.hardwareAcceleration === 'prefer-hardware' && encoder.index === 1) throw new Error('alpha GPU busy');
  } }, async (log) => {
    const process = [], doc = docFor('webmAlpha', { audio: true, acceleration: 'gpu' });
    const song = { sampleRate: 48000, numberOfChannels: 2, getChannelData: () => new Float32Array(20000) };
    const result = await W.exportWebm(args(doc, { audio: song, onProcess(p) {
      process.push(p);
      if (p.stage === 'audio') {
        assert.equal(log.video.length, 0);
        assert.equal(log.audio[0].state, 'configured');
      }
      if (p.stage === 'video') {
        assert.equal(log.audio[0].state, 'closed');
        assert.ok(log.video.every((e) => e.inputs.length === 0));
      }
    } }));
    assert.deepEqual(process.map((p) => p.stage), ['prepare', 'audioPrepare', 'audio', 'video', 'finalize', 'mux', 'save']);
    assert.deepEqual(process.find((p) => p.stage === 'video').acceleration,
      { requested: 'gpu', selected: 'prefer-hardware', fallback: false, alphaSelected: 'no-preference' });
    assert.equal(result.audioCodec, 'opus');
    assert.equal(process.find((p) => p.stage === 'video').frameCount, result.frames);
    assert.ok(log.order.indexOf('audioFlush') < log.order.indexOf('video'));
  });
});

test('PNG names its canvas/PNG/ZIP path and does not instantiate or claim a video encoder', async () => {
  await withCodecs({}, async (log) => {
    const process = [], progress = [];
    const result = await PNG.exportPngs(args(docFor('pngAlpha'), { alpha: true,
      onProcess: (p) => process.push(p), onProgress: (p) => progress.push(p.i) }));
    assert.deepEqual(process.map((p) => p.stage), ['prepare', 'video', 'zip', 'save']);
    assert.deepEqual([process[0].format, process[0].backend, process[0].codec, process[0].acceleration],
      ['pngAlpha', 'canvas', 'png', null]);
    assert.deepEqual(progress, [1, 2, 3]);
    assert.equal(result.frames, 3);
    assert.equal(process.find((p) => p.stage === 'video').frameCount, result.frames);
    assert.equal(log.video.length, 0);
    assert.equal(log.audio.length, 0);
  });
});

test('Filmora names every installed output preference and exposes WAV fallback during auxiliary files', async () => {
  await withCodecs({ audio: false, configure(config, encoder) {
    if (config.hardwareAcceleration === 'prefer-hardware' && encoder.index === 2) throw new Error('alpha GPU busy');
  } }, async (log) => {
    const process = [], doc = docFor('kit', { audio: true, acceleration: 'gpu' });
    const song = { sampleRate: 48000, numberOfChannels: 2, getChannelData: () => new Float32Array(20000) };
    const result = await KIT.exportKit(args(doc, { audio: song, onProcess(p) {
      process.push(p);
      if (p.stage === 'video') assert.ok(log.video.every((e) => e.inputs.length === 0));
    } }));
    assert.deepEqual(process.map((p) => p.stage), ['prepare', 'video', 'finalize', 'mux', 'files', 'zip']);
    const video = process.find((p) => p.stage === 'video');
    assert.equal(video.frameCount, result.frames);
    assert.deepEqual(video.outputs.map((o) => o.kind), ['main', 'overlay', 'bg', 'green']);
    assert.equal(video.outputs[1].acceleration.alphaSelected, 'no-preference');
    for (const output of video.outputs) {
      assert.deepEqual(output.acceleration, result.accelerationByOutput[output.kind]);
      assert.equal(output.temporary, false);
      assert.ok(output.codec);
    }
    const files = process.find((p) => p.stage === 'files');
    assert.deepEqual([files.audioSource, files.audioCodec, result.audio], ['wav', 'pcm-s16le', 'wav']);
  });
});

test('a failing live observer aborts the partial file and closes the newly installed encoder', async () => {
  await withCodecs({}, async (log) => {
    const sink = SINK.createMemorySink();
    await assert.rejects(J.exportVideo(args(docFor(), { sink,
      onProcess(p) { if (p.stage === 'video') throw new Error('observer failed'); } })), /observer failed/);
    assert.equal(sink.bytes, 0);
    assert.ok(log.video.every((e) => e.state === 'closed' && e.inputs.length === 0));
  });
});

test('direct-to-disk MP4 and WebM report saving only after mux writes finish and while file close is pending', async () => {
  for (const format of ['mp4', 'webmAlpha']) await withCodecs({}, async (log) => {
    let release, reached;
    const closing = new Promise((resolve) => { reached = resolve; });
    const gate = new Promise((resolve) => { release = resolve; });
    const inner = SINK.createMemorySink(), process = [], progress = [];
    let stage = null, closed = false;
    const sink = { kind: 'file', name: format === 'mp4' ? 'disk.mp4' : 'disk.webm', get bytes() { return inner.bytes; },
      async write(part, position) { await inner.write(part, position); },
      async close() {
        assert.equal(stage, 'save');
        assert.ok(inner.bytes > 0, 'the container has written its actual payload before closing the file');
        assert.ok(log.video.every((e) => e.state === 'closed'));
        reached(); await gate;
        const result = await inner.close(); closed = true;
        return { bytes: result.bytes };
      }, async abort() { await inner.abort(); } };
    const exporter = format === 'mp4' ? J.exportVideo : W.exportWebm;
    const pending = exporter(args(docFor(format), { sink, onProcess(p) {
      stage = p.stage; process.push(p);
      if (stage === 'save') assert.ok(inner.bytes > 0, 'save follows container finalization and awaited stream writes');
    }, onProgress(p) { progress.push(p.i); } }));
    await closing;
    assert.equal(stage, 'save');
    assert.equal(closed, false);
    assert.deepEqual(process.map((p) => p.stage), ['prepare', 'video', 'finalize', 'mux', 'save']);
    assert.deepEqual(progress, [1, 2, 3]);
    release(); const result = await pending;
    assert.equal(closed, true);
    assert.equal(result.blob, undefined, 'this path needs no post-export download to report saving');
  });
});

test('a save observer failure aborts the finalized streamed container before committing the file', async () => {
  for (const format of ['mp4', 'webmAlpha']) await withCodecs({}, async (log) => {
    const inner = SINK.createMemorySink();
    let closed = false, aborted = false;
    const sink = { kind: 'file', get bytes() { return inner.bytes; },
      write: (part, position) => inner.write(part, position),
      async close() { closed = true; return inner.close(); },
      async abort() { aborted = true; await inner.abort(); } };
    const exporter = format === 'mp4' ? J.exportVideo : W.exportWebm;
    await assert.rejects(exporter(args(docFor(format), { sink, onProcess(p) {
      if (p.stage === 'save') { assert.ok(sink.bytes > 0); throw new Error('save observer failed'); }
    } })), /save observer failed/);
    assert.equal(closed, false);
    assert.equal(aborted, true);
    assert.equal(sink.bytes, 0);
    assert.ok(log.video.every((e) => e.state === 'closed'));
  });
});
