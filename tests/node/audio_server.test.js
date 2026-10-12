/* 文字PVメーカー v2 — original work. External original-PCM AAC conversion: URL/auth/protocol, frozen ranges, single render, streaming and cleanup. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const F = require('../helpers/fake_engine.js');
const H = require('../helpers/make_media_fixtures.js').helpers;
const api = load(), AS = api.use('export/host/audio_server'), KIT = api.use('export/host/kit');
const D = api.use('core/doc'), S = api.use('export/schedule'), SINK = api.use('export/host/sink'), UNZIP = api.use('export/unzip');
const CONFIG = { url: 'https://audio.example.test/prefix/', token: 'PRIVATE_TOKEN_NOT_FOR_LOGS' };
const HEALTH = { service: 'moji-pv-audio', version: 1, targetBitrate: 320000, maxUploadBytes: 1024 ** 3 };
function convertedMovie(frames, fps = 30, audio = true, durationFps = fps) {
  const u32 = (n) => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
  const tracks = [{ id: 1, tag: 'vid', timescale: durationFps, per: frames,
    samples: Array.from({ length: frames }, (_, i) => ({ size: 24, dur: 1, cts: i, cto: 0, key: i === 0 })),
    entry: H.visualEntry('avc1', 1280, 720, H.box('avcC', H.avcC(0x64, 0, 0x1f))) }];
  if (audio) tracks.push({ id: 2, tag: 'snd', audio: true, timescale: 48000, per: 1,
    samples: [{ size: 24, dur: Math.round(frames / fps * 48000), cts: 0, cto: 0, key: true }], entry: H.box('mp4a', new Uint8Array(28)) });
  return H.movie({ ftyp: H.box('ftyp', 'isom', u32(512), 'isom', 'mp41'), fast: true,
    movieScale: 48000, movieDuration: Math.round(frames / fps * 48000), tracks }).bytes;
}
const converted = convertedMovie(7);

function sampleDoc(over) {
  const doc = D.defaultDoc();
  doc.sheet = { next: 3, rows: [{ id: 'r1', src: '[00:00.10]歌詞' }, { id: 'r2', src: '[00:02.00]second' }] };
  doc.song = { name: 'song.wav', sha1: 'x', seconds: 10, bpm: null, offset: 0, meter: 4, bpmConfidence: null, digest: null, info: null };
  Object.assign(doc.output, { short: 720, fps: 30, range: { t0: .123, t1: .123 + 7 / 30 } }, over || {});
  return doc;
}

function songBuffer(length = 96000, mono = false) {
  const channels = Array.from({ length: mono ? 1 : 2 }, (_, c) => Float32Array.from({ length }, (v, i) => ((i % 5000) / 5000 - .5) * (c ? -1 : 1)));
  return { sampleRate: 48000, numberOfChannels: channels.length, getChannelData: (c) => channels[c] };
}

function response(frames, over) {
  const bytes = convertedMovie(frames);
  return new Response(bytes, { headers: Object.assign({ 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length),
    'X-Audio-Bitrate-Target': '320000', 'X-Audio-Bitrate-Measured': '317123', 'X-Audio-Codec': 'aac', 'X-Video-Frames': String(frames) }, over || {}) });
}

function serverFetch(log, options) {
  const o = options || {};
  return async (url, init) => {
    log.push({ url, init });
    if (url.endsWith('/health')) return new Response(JSON.stringify(o.health || HEALTH), { headers: { 'Content-Type': 'application/json' } });
    if (o.status) return new Response('error body containing ' + CONFIG.token, { status: o.status });
    if (o.onPost) return o.onPost(init);
    return response(Number(init.body.get('frames')), o.headers);
  };
}

function trackingSink(name, file = false) {
  const inner = SINK.createMemorySink({ name, type: 'video/mp4' });
  const state = { aborted: false, closed: false, bytes: 0 };
  return Object.assign(state, { name, kind: file ? 'file' : 'memory', async write(part) { await inner.write(part); state.bytes = inner.bytes; },
    async close() { state.closed = true; const done = await inner.close(); return file ? { bytes: done.bytes } : done; },
    async abort() { state.aborted = true; state.bytes = 0; await inner.abort(); } });
}

async function withEncoders(fn) {
  const saved = {};
  for (const key of ['VideoEncoder', 'VideoFrame', 'AudioEncoder', 'AudioData']) saved[key] = globalThis[key];
  const log = { video: [], audio: 0, frames: [] };
  class VideoEncoder {
    static async isConfigSupported(c) { return { supported: c.hardwareAcceleration !== 'prefer-hardware', config: c }; }
    constructor(init) { this.init = init; this.inputs = []; this.state = 'unconfigured'; this.encodeQueueSize = 0; log.video.push(this); }
    configure(config) { this.config = config; this.state = 'configured'; }
    encode(f, o) {
      this.inputs.push(f.timestamp);
      const data = Uint8Array.of(1, 2, 3);
      this.init.output({ timestamp: f.timestamp, type: o.keyFrame ? 'key' : 'delta', byteLength: 3, copyTo: (dst) => dst.set(data) }, {});
    }
    async flush() {}
    close() { this.state = 'closed'; }
  }
  class VideoFrame { constructor(src, init) { Object.assign(this, init); log.frames.push(this); } close() { this.closed = true; } }
  class AudioEncoder {
    static async isConfigSupported(c) { throw new Error('external mode must never query a browser audio encoder'); }
    constructor() { log.audio++; throw new Error('external mode must not encode AAC192'); }
  }
  Object.assign(globalThis, { VideoEncoder, VideoFrame, AudioEncoder });
  try { return await fn(log); } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
}

function mp4Lib() {
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

function engineFor(doc, events) {
  const wrap = (e) => ({
    get plan() { return e.plan; }, setDoc: (d) => e.setDoc(d), prepare: (...args) => e.prepare(...args),
    renderFrame: (...args) => { events.push(args[1]); return e.renderFrame(...args); },
    fork: () => wrap(e.fork()), dispose: () => e.dispose(),
  });
  const engine = F.createEngine(); engine.setDoc(doc); return wrap(engine);
}

test('HTTPS config normalizes a reverse-proxy prefix and rejects insecure/credentialed/secret-bearing URLs', () => {
  assert.deepEqual(AS.validateConfig(CONFIG), { url: 'https://audio.example.test/prefix', token: CONFIG.token });
  assert.deepEqual(AS.validateConfig({ url: ' https://audio.example.test/ ' }), { url: 'https://audio.example.test', token: '' });
  for (const url of ['', 'http://audio.example.test', 'https://user:password@audio.example.test',
    'https://audio.example.test?token=secret', 'https://audio.example.test/#token', 'https://audio.example.test?',
    'https://audio.example.test#', 'data:text/plain,test']) {
    assert.throws(() => AS.validateConfig({ url }), (e) => e.code === 'audio-server-config' && !e.message.includes('secret'));
  }
  for (const token of ['bearer\r\nAttack: yes', 'space separated', 'あ', 123, 'x'.repeat(4097)]) {
    assert.throws(() => AS.validateConfig({ url: CONFIG.url, token }), (e) => e.code === 'audio-server-config');
  }
});

test('health confirms protocol/limits without transmitting the token, credentials or a song', async () => {
  const log = [], value = await AS.check(CONFIG, { fetchImpl: serverFetch(log) });
  assert.deepEqual(value, Object.assign({}, HEALTH, { authChecked: false }));
  assert.equal(log[0].url, 'https://audio.example.test/prefix/health');
  assert.equal(log[0].init.headers.Authorization, undefined);
  assert.equal(log[0].init.body, undefined);
  assert.deepEqual([log[0].init.credentials, log[0].init.redirect, log[0].init.referrerPolicy], ['omit', 'error', 'no-referrer']);
  for (const bad of [{ service: 'other' }, { version: 2 }, { targetBitrate: 192000 }, { maxUploadBytes: 0 }, { maxUploadBytes: 100 }]) {
    await assert.rejects(AS.check(CONFIG, { fetchImpl: serverFetch([], { health: Object.assign({}, HEALTH, bad) }) }), (e) => e.code === 'audio-server-response');
  }
});

test('PCM is trimmed to the rendered N/fps, stereo downmixed and silence-padded from the original buffer', async () => {
  const song = songBuffer(6200, true), job = { t0: .123, N: 7, fps: 30 };
  const blob = await AS.audioBlob(song, job), bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer);
  assert.equal(bytes.length, 44 + 11200 * 4);
  assert.deepEqual([view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)], [2, 48000, 16]);
  const wanted = Math.round(song.getChannelData(0)[5904] * 32767);
  assert.equal(view.getInt16(44, true), wanted);
  assert.equal(view.getInt16(46, true), wanted, 'mono is copied to both output channels');
  assert.equal(view.getInt16(44 + (6200 - 5904) * 4, true), 0, 'the song tail is silence-padded');
  assert.equal(view.getInt16(bytes.length - 2, true), 0);
});

test('convert uploads the exact source WAV and a silent video once, then streams the returned AAC320 MP4', async () => {
  const sink = trackingSink('done.mp4'), log = [], progress = [];
  const result = await AS.convert({ video: new Blob(['SILENT ORIGINAL VIDEO']), audio: songBuffer(), job: { t0: .123, N: 7, fps: 30 },
    sink, audioServer: CONFIG, fetchImpl: serverFetch(log), onProgress: (p) => progress.push(p) });
  assert.equal(log.length, 2);
  const request = log[1];
  assert.equal(request.url, 'https://audio.example.test/prefix/v1/convert');
  assert.equal(request.init.headers.Authorization, 'Bearer ' + CONFIG.token);
  assert.equal(request.init.headers['Content-Type'], undefined, 'the browser supplies the multipart boundary');
  assert.deepEqual([request.init.body.get('frames'), request.init.body.get('fps')], ['7', '30']);
  assert.equal(request.init.body.get('audio').size, 44 + 11200 * 4);
  assert.equal(await request.init.body.get('video').text(), 'SILENT ORIGINAL VIDEO');
  assert.deepEqual([result.audioCodec, result.audioBitrate, result.audioBitrateMode, result.audioSource, result.audioMeasuredBitrate],
    ['mp4a.40.2', 320000, null, 'server', 317123]);
  assert.equal(await result.blob.text(), new TextDecoder().decode(converted));
  assert.deepEqual(progress[0], { phase: 'audioServer', i: 0, N: 0, eta: null });
});

test('server size, auth and invalid-rate failures occur before sending any media', async () => {
  for (const [extra, expected] of [
    [{ audioServer: { url: CONFIG.url, token: '' } }, 'audio-server-auth'],
    [{ audio: Object.assign({}, songBuffer(), { sampleRate: 44100 }) }, 'audio-server-media'],
    [{ health: Object.assign({}, HEALTH, { maxUploadBytes: 65537 }) }, 'audio-server-too-large'],
  ]) {
    const log = [];
    await assert.rejects(AS.convert(Object.assign({ video: new Blob(['x']), audio: songBuffer(), job: { t0: 0, N: 7, fps: 30 },
      sink: trackingSink('no.mp4'), audioServer: CONFIG, health: HEALTH, fetchImpl: serverFetch(log) }, extra)), (e) => e.code === expected);
    assert.equal(log.length, 0);
  }
});

test('server status codes are actionable and never echo the response or transport secret', async () => {
  const expected = { 401: 'auth', 403: 'auth', 413: 'too-large', 422: 'media', 429: 'busy', 504: 'timeout', 500: 'convert' };
  for (const [status, kind] of Object.entries(expected)) {
    await assert.rejects(AS.convert({ video: new Blob(['x']), audio: songBuffer(), job: { t0: 0, N: 1, fps: 30 }, sink: trackingSink('no.mp4'),
      audioServer: CONFIG, health: HEALTH, fetchImpl: serverFetch([], { status: Number(status) }) }),
    (e) => e.code === 'audio-server-' + kind && !JSON.stringify(e).includes(CONFIG.token));
  }
  await assert.rejects(AS.check(CONFIG, { fetchImpl: async () => { throw new Error('failed bearer ' + CONFIG.token); } }),
    (e) => e.code === 'audio-server-network' && !e.message.includes(CONFIG.token) && !JSON.stringify(e).includes(CONFIG.token));
});

test('mismatched output headers and truncated streams cannot be saved as a successful 320 kbps export', async () => {
  for (const headers of [{ 'X-Audio-Bitrate-Target': '192000' }, { 'X-Audio-Codec': 'opus' }, { 'X-Video-Frames': '6' },
    { 'Content-Type': 'text/html' }, { 'X-Audio-Bitrate-Measured': 'NaN' }, { 'Content-Length': '100000' }]) {
    await assert.rejects(AS.convert({ video: new Blob(['x']), audio: songBuffer(), job: { t0: 0, N: 7, fps: 30 }, sink: trackingSink('no.mp4'),
      audioServer: CONFIG, health: HEALTH, fetchImpl: serverFetch([], { headers }) }), (e) => e.code === 'audio-server-response');
  }
});

test('a 200 response must contain a faststart MP4 with the promised video/AAC tracks, frames and duration', async () => {
  for (const bytes of [new TextEncoder().encode('not an MP4 file'), convertedMovie(7, 30, false), convertedMovie(1), convertedMovie(7, 30, true, 60)]) {
    const sink = trackingSink('bad.mp4');
    await assert.rejects(AS.convert({ video: new Blob(['x']), audio: songBuffer(), job: { t0: 0, N: 7, fps: 30 }, sink,
      audioServer: CONFIG, health: HEALTH, fetchImpl: serverFetch([], { onPost: () => new Response(bytes, { headers: {
        'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length), 'X-Audio-Bitrate-Target': '320000',
        'X-Audio-Codec': 'aac', 'X-Video-Frames': '7' } }) }) }), (e) => e.code === 'audio-server-response');
    assert.equal(sink.closed, false);
    assert.equal(sink.bytes, 0, 'invalid metadata is rejected before writing the returned video');
  }
});

test('fragmented download chunks are validated at moov before streaming mdat, without a second video-sized copy', async () => {
  const sink = trackingSink('valid.mp4'), source = convertedMovie(7);
  let offset = 0;
  const stream = new ReadableStream({ pull(controller) {
    if (offset === source.length) { controller.close(); return; }
    controller.enqueue(source.slice(offset, Math.min(source.length, offset + 13))); offset = Math.min(source.length, offset + 13);
  } });
  const result = await AS.convert({ video: new Blob(['x']), audio: songBuffer(), job: { t0: 0, N: 7, fps: 30 }, sink,
    audioServer: CONFIG, health: HEALTH, fetchImpl: serverFetch([], { onPost: () => new Response(stream, { headers: {
      'Content-Type': 'video/mp4', 'Content-Length': String(source.length), 'X-Audio-Bitrate-Target': '320000',
      'X-Audio-Codec': 'aac', 'X-Video-Frames': '7' } }) }) });
  assert.deepEqual(new Uint8Array(await result.blob.arrayBuffer()), source);
  assert.equal(result.audioMeasuredBitrate, null);
});

test('invalid response headers and non-success HTTP responses cancel the unread body', async () => {
  for (const status of [200, 401]) {
    let cancelled = 0;
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(8)); }, cancel() { cancelled++; } });
    const fetchImpl = serverFetch([], { onPost: () => new Response(body, { status, headers: { 'Content-Type': 'video/mp4',
      'X-Audio-Bitrate-Target': '192000', 'X-Audio-Codec': 'aac', 'X-Video-Frames': '7' } }) });
    await assert.rejects(AS.convert({ video: new Blob(['x']), audio: songBuffer(), job: { t0: 0, N: 7, fps: 30 },
      sink: trackingSink('bad.mp4'), audioServer: CONFIG, health: HEALTH, fetchImpl }),
    (e) => e.code === (status === 401 ? 'audio-server-auth' : 'audio-server-response'));
    assert.equal(cancelled, 1);
  }
});

test('standalone export renders/encodes once, never calls a browser AAC encoder, and returns only the converted blob', async () => {
  await withEncoders(async (encoders) => {
    const doc = sampleDoc(), draws = [], log = [], sink = trackingSink('done.mp4');
    const result = await AS.exportVideo({ engine: engineFor(doc, draws), doc, audio: songBuffer(), sink, canvas: F.createRecorder().factory,
      lib: mp4Lib(), audioServer: CONFIG, fetchImpl: serverFetch(log) });
    assert.equal(draws.length, 7);
    assert.equal(encoders.video.length, 1);
    assert.equal(encoders.audio, 0);
    assert.equal(encoders.video[0].inputs.length, 7);
    assert.equal(JSON.parse(await log[1].init.body.get('video').text()).audio, null);
    assert.equal(await result.blob.text(), new TextDecoder().decode(converted));
    assert.equal(result.name, 'done.mp4');
    assert.equal(result.audioSource, 'server');
    assert.ok(encoders.video.every((e) => e.state === 'closed'));
    assert.ok(encoders.frames.every((f) => f.closed));
  });
});

test('a converted file-sink export never returns the temporary silent blob for a second download', async () => {
  await withEncoders(async () => {
    const doc = sampleDoc(), sink = trackingSink('done.mp4', true);
    const result = await AS.exportVideo({ engine: engineFor(doc, []), doc, audio: songBuffer(), sink, canvas: F.createRecorder().factory,
      lib: mp4Lib(), audioServer: CONFIG, fetchImpl: serverFetch([]) });
    assert.equal(result.blob, undefined);
    assert.equal(result.bytes, converted.length);
    assert.equal(sink.closed, true);
  });
});

test('conversion failure aborts the chosen file and never falls back to browser AAC192', async () => {
  await withEncoders(async (encoders) => {
    const doc = sampleDoc(), draws = [], sink = trackingSink('no.mp4');
    await assert.rejects(AS.exportVideo({ engine: engineFor(doc, draws), doc, audio: songBuffer(), sink, canvas: F.createRecorder().factory,
      lib: mp4Lib(), audioServer: CONFIG, fetchImpl: serverFetch([], { status: 401 }) }), (e) => e.code === 'audio-server-auth');
    assert.equal(sink.aborted, true);
    assert.equal(sink.bytes, 0);
    assert.equal(draws.length, 7);
    assert.equal(encoders.audio, 0);
    assert.ok(encoders.video.every((e) => e.state === 'closed'));
  });
});

test('cancel during converted download discards the partially written file', async () => {
  await withEncoders(async () => {
    const doc = sampleDoc(), control = new AbortController(), sink = trackingSink('no.mp4');
    const write = sink.write; sink.write = async (part) => { await write(part); control.abort(); };
    await assert.rejects(AS.exportVideo({ engine: engineFor(doc, []), doc, audio: songBuffer(), sink, signal: control.signal,
      canvas: F.createRecorder().factory, lib: mp4Lib(), audioServer: CONFIG, fetchImpl: serverFetch([]) }), (e) => e.code === 'cancelled');
    assert.equal(sink.aborted, true);
    assert.equal(sink.bytes, 0);
  });
});

test('audio-off and no-source exports remain local without any health request', async () => {
  for (const audioOff of [true, false]) await withEncoders(async () => {
    const doc = sampleDoc({ audio: !audioOff }), log = [];
    const result = await AS.exportVideo({ engine: engineFor(doc, []), doc, audio: audioOff ? songBuffer() : null,
      sink: trackingSink('silent.mp4'), canvas: F.createRecorder().factory, lib: mp4Lib(), audioServer: CONFIG, fetchImpl: serverFetch(log) });
    assert.equal(log.length, 0);
    assert.equal(result.audio, false);
    assert.equal(result.audioSource, undefined);
  });
});

test('Filmora server audio converts only main once, preserves background output, and omits the fallback WAV', async () => {
  await withEncoders(async (encoders) => {
    const doc = sampleDoc({ format: 'kit', kit: { overlay: false, bg: true, green: false, srt: false, lrc: false } }), draws = [], log = [];
    const result = await KIT.exportKit({ engine: engineFor(doc, draws), doc, audio: songBuffer(), canvas: F.createRecorder().factory,
      lib: mp4Lib(), audioServer: CONFIG, fetchImpl: serverFetch(log) });
    assert.deepEqual(result.files.map((f) => f.kind), ['main', 'bg', 'readme']);
    assert.equal(result.audioCodec, 'mp4a.40.2');
    assert.equal(result.audioSource, 'server');
    assert.equal(result.audioBitrate, 320000);
    assert.equal(result.audioMeasuredBitrate, 317123);
    assert.equal(draws.length, 14);
    assert.equal(encoders.video.length, 2);
    assert.equal(encoders.audio, 0);
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    const read = async (at, n) => bytes.subarray(at, at + n);
    const zip = await UNZIP.openZip(read, bytes.length);
    const main = zip.entries.get(result.files[0].name), bg = zip.entries.get(result.files[1].name);
    const mainBytes = await read(await UNZIP.dataStart(read, main), main.bytes);
    const bgBytes = await read(await UNZIP.dataStart(read, bg), bg.bytes);
    assert.equal(new TextDecoder().decode(mainBytes), new TextDecoder().decode(converted));
    assert.deepEqual(JSON.parse(new TextDecoder().decode(bgBytes)).audio, null);
  });
});

test('Filmora conversion failure aborts every created folder file and keeps no misleading silent main', async () => {
  await withEncoders(async (encoders) => {
    const doc = sampleDoc({ format: 'kit', kit: { overlay: false, bg: true, green: false, srt: false, lrc: false } }), sinks = [];
    const dir = { name: 'kit', aborted: false, async file(name) { const sink = trackingSink(name); sinks.push(sink); return sink; },
      async close() {}, async abort() { this.aborted = true; for (const sink of sinks) await sink.abort(); } };
    await assert.rejects(KIT.exportKit({ engine: engineFor(doc, []), doc, audio: songBuffer(), dir, canvas: F.createRecorder().factory,
      lib: mp4Lib(), audioServer: CONFIG, fetchImpl: serverFetch([], { status: 500 }) }), (e) => e.code === 'audio-server-convert');
    assert.equal(dir.aborted, true);
    assert.ok(sinks.every((s) => s.aborted && s.bytes === 0));
    assert.equal(encoders.audio, 0);
    assert.ok(encoders.video.every((e) => e.state === 'closed'));
  });
});
