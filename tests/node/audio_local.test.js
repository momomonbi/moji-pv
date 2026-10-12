/* 文字PVメーカー v2 — original work. Browser AAC host: original PCM, exact timing, one render/encode, bounded local conversion and Filmora output. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const F = require('../helpers/fake_engine.js');
const H = require('../helpers/make_media_fixtures.js').helpers;
const api = load(), AL = api.use('export/host/audio_local'), KIT = api.use('export/host/kit');
const S = api.use('export/schedule'), D = api.use('core/doc'), SINK = api.use('export/host/sink'), UNZIP = api.use('export/unzip');

function movie(frames = 7, fps = 30, audio = true, wrongFrames = false) {
  const u32 = (n) => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
  const count = wrongFrames ? frames - 1 : frames;
  const tracks = [{ id: 1, tag: 'vid', timescale: fps, per: count,
    samples: Array.from({ length: count }, (_, i) => ({ size: 24, dur: 1, cts: i, cto: 0, key: i === 0 })),
    entry: H.visualEntry('avc1', 1280, 720, H.box('avcC', H.avcC(0x64, 0, 0x1f))) }];
  if (audio) tracks.push({ id: 2, tag: 'snd', audio: true, timescale: 48000, per: 1,
    samples: [{ size: 24, dur: Math.round(frames / fps * 48000), cts: 0, cto: 0, key: true }], entry: H.box('mp4a', new Uint8Array(28)) });
  return new Blob([H.movie({ ftyp: H.box('ftyp', 'isom', u32(512), 'isom', 'mp41'), fast: true,
    movieScale: 48000, movieDuration: Math.round(frames / fps * 48000), tracks }).bytes], { type: 'video/mp4' });
}

function docFor(output) {
  const doc = D.defaultDoc();
  doc.sheet = { next: 3, rows: [{ id: 'r1', src: '[00:00.10]歌詞' }, { id: 'r2', src: '[00:02.00]two' }] };
  doc.song = { name: 'song.wav', sha1: 'x', seconds: 10, bpm: null, offset: 0, meter: 4, bpmConfidence: null, digest: null, info: null };
  Object.assign(doc.output, { short: 720, fps: 30, audio: true, range: { t0: .123, t1: .123 + 7 / 30 } }, output || {});
  return doc;
}

function song() {
  const channels = [Float32Array.from({ length: 6400 }, (v, i) => i / 12800), new Float32Array(6400)];
  return { sampleRate: 48000, numberOfChannels: 2, getChannelData: (c) => channels[c] };
}

function runtime(log, opts) {
  const o = opts || {};
  return {
    async prepare(args) { log.push({ type: 'prepare', args }); if (o.prepare) return o.prepare(args); },
    async convert(args) {
      log.push({ type: 'convert', args });
      if (o.convert) return o.convert(args);
      return { blob: movie(args.frames, args.fps), measuredBitrate: 318999 };
    },
  };
}

function sinkFor(name, file = false) {
  const inner = SINK.createMemorySink({ name, type: 'video/mp4' });
  const state = { name, kind: file ? 'file' : 'memory', aborted: false, closed: false, bytes: 0 };
  return Object.assign(state, { async write(part) { await inner.write(part); state.bytes = inner.bytes; },
    async close() { state.closed = true; const done = await inner.close(); return file ? { bytes: done.bytes } : done; },
    async abort() { state.aborted = true; state.bytes = 0; await inner.abort(); } });
}

function engineFor(doc, log) {
  const wrap = (e) => ({ get plan() { return e.plan; }, setDoc: (d) => e.setDoc(d), prepare: (...args) => e.prepare(...args),
    renderFrame: (...args) => { log.push({ type: 'render', time: args[1] }); return e.renderFrame(...args); },
    fork: () => wrap(e.fork()), dispose: () => e.dispose() });
  const engine = F.createEngine(); engine.setDoc(doc); return wrap(engine);
}

function muxerLib() {
  class ArrayBufferTarget { constructor() { this.buffer = null; } }
  class StreamTarget { constructor(o) { this.options = o; } }
  class Muxer {
    constructor(o) { this.options = o; this.frames = []; }
    addVideoChunk(chunk) { this.frames.push(chunk.timestamp); }
    finalize() {
      const bytes = new TextEncoder().encode(JSON.stringify({ frames: this.frames, audio: this.options.audio || null }));
      if (this.options.target instanceof ArrayBufferTarget) this.options.target.buffer = bytes.buffer;
      else this.options.target.options.onData(bytes, 0);
    }
  }
  return { ArrayBufferTarget, StreamTarget, Muxer };
}

async function withEncoders(fn) {
  const saved = { VideoEncoder: globalThis.VideoEncoder, VideoFrame: globalThis.VideoFrame, AudioEncoder: globalThis.AudioEncoder, fetch: globalThis.fetch };
  const log = { videos: [], frames: [] };
  class VideoEncoder {
    static async isConfigSupported(c) { return { supported: c.hardwareAcceleration !== 'prefer-hardware', config: c }; }
    constructor(init) { this.init = init; this.inputs = []; this.state = 'unconfigured'; this.encodeQueueSize = 0; log.videos.push(this); }
    configure(config) { this.config = config; this.state = 'configured'; }
    encode(frame, o) {
      this.inputs.push(frame.timestamp);
      const bytes = Uint8Array.of(1, 2, 3);
      this.init.output({ timestamp: frame.timestamp, type: o.keyFrame ? 'key' : 'delta', byteLength: 3, copyTo: (dst) => dst.set(bytes) }, {});
    }
    async flush() {}
    close() { this.state = 'closed'; }
  }
  class VideoFrame { constructor(source, init) { Object.assign(this, init); log.frames.push(this); } close() { this.closed = true; } }
  class AudioEncoder {
    static async isConfigSupported() { throw new Error('local mode must not query the platform AAC192 encoder'); }
    constructor() { throw new Error('local mode must not instantiate the platform AAC192 encoder'); }
  }
  Object.assign(globalThis, { VideoEncoder, VideoFrame, AudioEncoder,
    fetch: async () => { throw new Error('local conversion must not contact an external server'); } });
  try { return await fn(log); } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
}

function exportArgs(doc, events, extra) {
  return Object.assign({ engine: engineFor(doc, events), doc, audio: song(), sink: sinkFor('done.mp4'),
    canvas: F.createRecorder().factory, lib: muxerLib(), runtime: runtime(events) }, extra || {});
}

test('standalone local export prepares first and renders/encodes the original video exactly once', async () => {
  await withEncoders(async (encoders) => {
    const events = [], doc = docFor(), progress = [];
    const result = await AL.exportVideo(exportArgs(doc, events, { onProgress: (p) => progress.push(p) }));
    assert.equal(events[0].type, 'prepare');
    assert.equal(events.filter((x) => x.type === 'render').length, 7);
    assert.equal(events.filter((x) => x.type === 'convert').length, 1);
    assert.equal(encoders.videos.length, 1);
    assert.deepEqual(encoders.videos[0].inputs, Array.from({ length: 7 }, (_, i) => S.ts(i, 30)));
    const input = events.find((x) => x.type === 'convert').args;
    assert.equal(JSON.parse(await input.video.text()).audio, null);
    assert.equal(input.audio.size, 44 + 11200 * 4);
    const pcm = new DataView(await input.audio.arrayBuffer());
    assert.equal(pcm.getInt16(44, true), Math.round(song().getChannelData(0)[5904] * 32767));
    assert.equal(pcm.getInt16(pcm.byteLength - 4, true), 0, 'source ends before the range, so the rest is silence');
    assert.deepEqual([result.frames, result.audioSource, result.audioCodec, result.audioBitrate, result.audioBitrateMode, result.audioMeasuredBitrate],
      [7, 'local', 'mp4a.40.2', 320000, null, 318999]);
    assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), new Uint8Array(await movie().arrayBuffer()));
    assert.ok(progress.some((p) => p.phase === 'audioLocalLoading'));
    assert.ok(progress.some((p) => p.phase === 'audioLocal'));
    assert.ok(encoders.videos.every((e) => e.state === 'closed'));
    assert.ok(encoders.frames.every((f) => f.closed));
  });
});

test('a file sink never exposes the temporary silent MP4 blob for download', async () => {
  await withEncoders(async () => {
    const result = await AL.exportVideo(exportArgs(docFor(), [], { sink: sinkFor('file.mp4', true) }));
    assert.equal(result.blob, undefined);
    assert.equal(result.name, 'file.mp4');
    assert.equal(result.bytes, movie().size);
  });
});

test('converter metadata is verified before writing: reject silent, corrupt, wrong-frame and wrong-rate output', async () => {
  for (const blob of [new Blob(['not an MP4']), movie(7, 30, false), movie(7, 30, true, true), movie(7, 60)]) {
    const sink = sinkFor('bad.mp4');
    await assert.rejects(AL.convert({ video: new Blob(['silent']), audio: song(), job: { t0: .123, N: 7, fps: 30 }, sink,
      runtime: runtime([], { convert: async () => ({ blob }) }) }), (e) => e.code === 'audio-local-response');
    assert.equal(sink.bytes, 0);
    assert.equal(sink.closed, false);
  }
});

test('actual input size and duration are bounded before PCM allocation or worker conversion', async () => {
  class LargeBlob extends Blob { get size() { return AL.MAX_INPUT_BYTES; } }
  const events = [];
  await assert.rejects(AL.convert({ video: new LargeBlob(['small backing store']), audio: song(), job: { t0: 0, N: 7, fps: 30 },
    sink: sinkFor('no.mp4'), runtime: runtime(events) }), (e) => e.code === 'audio-local-too-large');
  await assert.rejects(AL.convert({ video: new Blob(['x']), audio: song(), job: { t0: 0, N: (AL.MAX_SECONDS + 1) * 30, fps: 30 },
    sink: sinkFor('no.mp4'), runtime: runtime(events) }), (e) => e.code === 'audio-local-too-large');
  assert.equal(events.length, 0);
});

test('asset-load failure happens before rendering and discards the chosen file', async () => {
  await withEncoders(async (encoders) => {
    const events = [], sink = sinkFor('no.mp4');
    await assert.rejects(AL.exportVideo(exportArgs(docFor(), events, { sink,
      runtime: runtime(events, { prepare: async () => { throw new Error('asset download failed'); } }) })), (e) => e.code === 'audio-local-load');
    assert.equal(sink.aborted, true);
    assert.equal(events.filter((x) => x.type === 'render').length, 0);
    assert.equal(encoders.videos.length, 0);
  });
});

test('a worker failure never silently downgrades to platform AAC192 or rerenders the video', async () => {
  await withEncoders(async (encoders) => {
    const events = [], sink = sinkFor('no.mp4');
    await assert.rejects(AL.exportVideo(exportArgs(docFor(), events, { sink,
      runtime: runtime(events, { convert: async () => { throw new Error('worker allocation failed'); } }) })), (e) => e.code === 'audio-local-convert');
    assert.equal(events.filter((x) => x.type === 'render').length, 7);
    assert.equal(encoders.videos.length, 1);
    assert.equal(sink.aborted, true);
    assert.ok(encoders.videos.every((e) => e.state === 'closed'));
  });
});

test('cancellation during prepare or conversion saves no partial file and a subsequent local export succeeds', async () => {
  for (const phase of ['prepare', 'convert']) await withEncoders(async (encoders) => {
    const ctl = new AbortController(), events = [], sink = sinkFor('no.mp4');
    const stop = async () => { ctl.abort(); return { blob: movie() }; };
    await assert.rejects(AL.exportVideo(exportArgs(docFor(), events, { sink, signal: ctl.signal, runtime: runtime(events, { [phase]: stop }) })),
      (e) => e.code === 'cancelled');
    assert.equal(sink.aborted, true);
    assert.equal(sink.bytes, 0);
    assert.equal(events.filter((x) => x.type === 'render').length, phase === 'prepare' ? 0 : 7);
    assert.ok(encoders.videos.every((e) => e.state === 'closed'));
    const result = await AL.exportVideo(exportArgs(docFor(), []));
    assert.equal(result.audioSource, 'local');
  });
});

test('audio-off or missing source skips runtime preparation and conversion', async () => {
  for (const noSource of [false, true]) await withEncoders(async () => {
    const events = [], result = await AL.exportVideo(exportArgs(docFor({ audio: noSource }), events, { audio: noSource ? null : song() }));
    assert.equal(result.audio, false);
    assert.equal(events.some((x) => x.type === 'prepare' || x.type === 'convert'), false);
  });
});

test('Filmora local mode transforms only main and keeps native background encoding and one frame pass', async () => {
  await withEncoders(async (encoders) => {
    const doc = docFor({ format: 'kit', kit: { overlay: false, bg: true, green: false, srt: false, lrc: false } }), events = [];
    const result = await KIT.exportKit(exportArgs(doc, events, { audioLocal: runtime(events) }));
    assert.equal(events[0].type, 'prepare');
    assert.equal(events.filter((x) => x.type === 'render').length, 14);
    assert.equal(events.filter((x) => x.type === 'convert').length, 1);
    assert.equal(encoders.videos.length, 2);
    assert.deepEqual(result.files.map((f) => f.kind), ['main', 'bg', 'readme']);
    assert.deepEqual([result.audioSource, result.audioCodec, result.audioBitrate, result.audioBitrateMode], ['local', 'mp4a.40.2', 320000, null]);
    const bytes = new Uint8Array(await result.blob.arrayBuffer()), read = async (at, n) => bytes.subarray(at, at + n);
    const zip = await UNZIP.openZip(read, bytes.length), entry = zip.entries.get(result.files[0].name);
    assert.deepEqual(await read(await UNZIP.dataStart(read, entry), entry.bytes), new Uint8Array(await movie().arrayBuffer()));
  });
});

test('Filmora conversion failure removes every created folder file', async () => {
  await withEncoders(async () => {
    const doc = docFor({ format: 'kit', kit: { overlay: false, bg: true, green: false, srt: false, lrc: false } }), events = [], sinks = [];
    const dir = { name: 'kit', aborted: false, async file(name) { const sink = sinkFor(name); sinks.push(sink); return sink; },
      async close() {}, async abort() { this.aborted = true; for (const sink of sinks) await sink.abort(); } };
    await assert.rejects(KIT.exportKit(exportArgs(doc, events, { dir, audioLocal: runtime(events,
      { convert: async () => { throw new S.ExportError('audio-local-memory', 'local audio memory'); } }) })), (e) => e.code === 'audio-local-memory');
    assert.equal(dir.aborted, true);
    assert.ok(sinks.every((s) => s.aborted && !s.bytes));
  });
});

test('host and preflight share the actual input and duration limits', () => {
  assert.equal(AL.MAX_INPUT_BYTES, S.LOCAL_AUDIO_MAX_INPUT_BYTES);
  assert.equal(AL.MAX_SECONDS, S.LOCAL_AUDIO_MAX_SECONDS);
});

test('a direct native Filmora caller still receives its WAV with a local-default document', async () => {
  await withEncoders(async () => {
    globalThis.AudioEncoder = class { static async isConfigSupported(c) { return { supported: false, config: c }; } };
    const doc = docFor({ format: 'kit', audioEncoding: 'local', kit: { overlay: false, bg: false, green: false, srt: false, lrc: false } });
    const events = [];
    const result = await KIT.exportKit(exportArgs(doc, events));
    assert.deepEqual(result.files.map((f) => f.kind), ['main', 'wav', 'readme']);
    assert.equal(result.audio, 'wav');
    assert.equal(result.audioCodec, 'pcm-s16le');
    assert.equal(events.some((e) => e.type === 'prepare' || e.type === 'convert'), false);
    assert.deepEqual(result.files.map((f) => f.name), S.kitFiles(doc, engineFor(doc, []).plan,
      { audioResolved: true, audioCodec: null, songReady: true }).map((f) => f.name));
  });
});
