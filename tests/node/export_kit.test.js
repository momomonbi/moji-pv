/* 文字PVメーカー v2 — original work. Tests for export/host/webm, export/host/kit and the folder sinks with fake WebCodecs (DESIGN_2_1 §13.5, §13.9, §13.11). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { deepEqual } = require('../helpers/assert_plus.js');
const F = require('../helpers/fake_engine.js');

const MV = load();
const S = MV.use('export/schedule');
const J = MV.use('export/host/mp4');
const WH = MV.use('export/host/webm');
const KIT = MV.use('export/host/kit');
const SINK = MV.use('export/host/sink');
const MKV = MV.use('media/matroska');
const U = MV.use('export/unzip');
const docs = MV.use('core/doc');

const FPS = 30;

function sampleDoc(output) {
  const doc = docs.defaultDoc();
  doc.sheet = { next: 5, rows: [
    { id: 'r1', src: '[ti:夜明け]' }, { id: 'r2', src: '[00:00.10]一行目の歌詞' }, { id: 'r3', src: '[00:00.20]two' }, { id: 'r4', src: 'three' },
  ] };
  doc.song = { name: 's.mp3', sha1: 'x', seconds: 30, bpm: null, offset: 0, meter: 4, bpmConfidence: null, digest: null, info: null };
  Object.assign(doc.output, { short: 720, fps: FPS, quality: 'standard', range: { t0: 0.1, t1: 0.1 + 7 / FPS } }, output || {});
  return doc;
}

// --- fake WebCodecs ------------------------------------------------------------------------------------------------

class FakeChunk {
  constructor(type, timestamp, duration, bytes) { Object.assign(this, { type, timestamp, duration, bytes }); }
  get byteLength() { return this.bytes.length; }
  copyTo(dst) { dst.set(this.bytes); }
}

const OPUS_HEAD = Uint8Array.from([79, 112, 117, 115, 72, 101, 97, 100, 1, 2, 56, 1, 128, 187, 0, 0, 0, 0, 0]);

// installCodecs({ video(codec) → supported, audio(codec) → supported, lag(encoder index) → ms, spontaneous(index, n) })
// → { log, restore() }. Encoders output one chunk per input, asynchronously (after `lag` ms), whose bytes name the
// encoder and the input: [encoder index, n, key, …the first 4 bytes of the input's data].
function installCodecs(o) {
  const log = { video: [], audio: [], frames: [], order: [] };
  const saved = {};
  for (const k of ['VideoEncoder', 'VideoFrame', 'AudioEncoder', 'AudioData']) saved[k] = globalThis[k];
  class VideoFrame {
    constructor(src, init) {
      Object.assign(this, init);
      this.data = ArrayBuffer.isView(src) ? new Uint8Array(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength)) : null;
      this.source = ArrayBuffer.isView(src) ? null : src;
      this.closed = false;
      log.frames.push(this);
    }
    close() { this.closed = true; }
  }
  class VideoEncoder {
    static async isConfigSupported(config) { return { supported: o.video(config.codec), config }; }
    constructor(init) {
      this.init = init; this.index = log.video.length; this.n = 0; this.pending = []; this.inputs = []; this.state = 'unconfigured';
      this.encodeQueueSize = 0;
      log.video.push(this);
    }
    configure(config) { this.config = config; this.state = 'configured'; }
    encode(frame, opts) {
      if (this.state !== 'configured') throw new Error('encode on a ' + this.state + ' encoder');
      const n = this.n++;
      log.order.push('video' + this.index);
      const key = !!(opts && opts.keyFrame) || !!(o.spontaneous && o.spontaneous(this.index, n));
      this.inputs.push({ format: frame.format || 'canvas', timestamp: frame.timestamp, duration: frame.duration, key: !!(opts && opts.keyFrame),
        data: frame.data, colorSpace: frame.colorSpace, codedWidth: frame.codedWidth });
      const head = frame.data ? Array.from(frame.data.subarray(0, 4)) : [];
      const chunk = new FakeChunk(key ? 'key' : 'delta', frame.timestamp, frame.duration, Uint8Array.from([this.index, n & 255, key ? 1 : 0, ...head]));
      const lag = o.lag ? o.lag(this.index) : 0;
      if (o.drop && o.drop(this.index, n)) return;
      this.pending.push(new Promise((resolve) => setTimeout(resolve, lag)).then(() => {
        if (this.state === 'closed') return;
        this.init.output(chunk, n === 0 ? { decoderConfig: { codec: this.config.codec } } : undefined);
      }));
    }
    async flush() { await Promise.all(this.pending); }
    close() { this.state = 'closed'; }
  }
  class AudioData { constructor(init) { Object.assign(this, init); } close() {} }
  class AudioEncoder {
    static async isConfigSupported(config) { return { supported: o.audio(config.codec), config }; }
    constructor(init) { this.init = init; this.n = 0; this.encodeQueueSize = 0; this.state = 'unconfigured'; log.audio.push(this); this.inputs = []; }
    configure(config) { this.config = config; this.state = 'configured'; }
    encode(data) {
      log.order.push('audio');
      this.inputs.push({ timestamp: data.timestamp, frames: data.numberOfFrames });
      const n = this.n++;
      const meta = n === 0 ? { decoderConfig: { codec: this.config.codec, description: this.config.codec === 'opus' ? OPUS_HEAD : undefined } } : undefined;
      this.init.output(new FakeChunk('key', data.timestamp, Math.round((data.numberOfFrames * 1e6) / data.sampleRate), Uint8Array.from([0xa0, n & 255])), meta);
    }
    async flush() {}
    close() { this.state = 'closed'; }
  }
  Object.assign(globalThis, { VideoFrame, VideoEncoder, AudioData, AudioEncoder });
  return {
    log,
    restore() {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
      }
    },
  };
}

async function withCodecs(o, fn) {
  const c = installCodecs(Object.assign({ video: (codec) => /^(vp09|vp8|avc1)/.test(codec), audio: () => true }, o));
  try { return await fn(c.log); } finally { c.restore(); }
}

// --- a fake engine, surfaces and muxer -------------------------------------------------------------------------------

// The facade subset the exports use. Every fork records what it is asked; renderFrame marks the surface with the frame
// index, so getImageData returns frame-specific pixels (alpha of pixel k = (k + 7·i) mod 256, colour 10, 20, 30).
function fakeEngine(doc, log, opts) {
  let forks = 0;
  const o = opts || {};
  const make = (id, plan) => ({
    id, plan, doc: null,
    setDoc(d) { this.doc = d; this.plan = F.trivialPlan(d); log.push(['setDoc', this.id, d.look.backdrop]); },
    async prepare(t0, t1, p) { log.push(['prepare', this.id, !!(p && p.export)]); },
    renderFrame(surface, t, ro) {
      const i = Math.round((t - this.doc.output.range.t0) * FPS);
      log.push(['render', this.id, i, ro.backdrop, ro.layers || 'all', ro.quality]);
      surface.ctx.frame = i;
      return {};
    },
    async mediaReady(t, r) {
      log.push(['ready', this.id, Math.round((t - this.doc.output.range.t0) * FPS)]);
      if (o.failAt !== undefined && Math.round((t - this.doc.output.range.t0) * FPS) === o.failAt) {
        throw Object.assign(new Error('gone'), { code: 'media-missing', id: 'a' + '1'.repeat(24) });
      }
      if (r && r.signal && o.abortAt !== undefined && Math.round((t - this.doc.output.range.t0) * FPS) === o.abortAt) o.abortAt = undefined;
    },
    dispose() { log.push(['dispose', this.id]); },
    fork(f) {
      const e = make(++forks, this.plan);
      e.doc = this.doc;
      log.push(['fork', e.id, f && f.assets ? f.assets.name : null]);
      return e;
    },
  });
  const root = make(0, null);
  root.doc = doc;
  root.plan = F.trivialPlan(doc);
  return root;
}

function canvasFactory() {
  return {
    create(w, h, { alpha }) {
      const ctx = {
        frame: -1, alpha,
        getImageData(x, y, ww, hh) {
          const data = new Uint8ClampedArray(ww * hh * 4);
          for (let k = 0; k < ww * hh; k++) { data[4 * k] = 10; data[4 * k + 1] = 20; data[4 * k + 2] = 30; data[4 * k + 3] = (k + 7 * this.frame) & 255; }
          return { data, width: ww, height: hh };
        },
      };
      return { canvas: { width: w, height: h, tag: 'canvas' }, ctx };
    },
  };
}

// A fake Mp4Muxer namespace: the file is a JSON record of the chunks it was given.
function fakeMp4Lib() {
  class ArrayBufferTarget { constructor() { this.buffer = null; } }
  class StreamTarget { constructor(o) { this.options = o; } }
  class Muxer {
    constructor(options) { this.options = options; this.video = []; this.audio = []; }
    addVideoChunk(chunk) { this.video.push({ ts: chunk.timestamp, key: chunk.type === 'key', enc: chunk.bytes[0] }); }
    addAudioChunk(chunk) { this.audio.push(chunk.timestamp); }
    finalize() {
      const bytes = new TextEncoder().encode(JSON.stringify({ codec: this.options.video.codec, audio: this.options.audio || null,
        video: this.video, sound: this.audio.length }));
      if (this.options.target instanceof ArrayBufferTarget) this.options.target.buffer = bytes.buffer;
      else this.options.target.options.onData(bytes, 0);
    }
  }
  return { Muxer, ArrayBufferTarget, StreamTarget };
}

function toneBuffer(seconds, rate) {
  const n = Math.round(seconds * rate);
  const ch = [new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) { ch[0][i] = 0.25 * Math.sin(i / 10); ch[1][i] = -0.25 * Math.sin(i / 10); }
  return { sampleRate: rate, numberOfChannels: 2, length: n, getChannelData: (c) => ch[c] };
}

async function blobBytes(blob) { return new Uint8Array(await blob.arrayBuffer()); }

async function demux(bytes) {
  return MKV.parse(async (at, n) => bytes.subarray(at, at + n), bytes.length);
}

// The audio SimpleBlocks (track 2) of a WebM, in file order: their first data byte (a separate walk over the clusters).
function audioBlocks(bytes) {
  const vint = (at, marker) => {
    let len = 1;
    while (!(bytes[at] & (0x80 >> (len - 1)))) len++;
    let v = marker ? bytes[at] : bytes[at] & (0xff >> len);
    for (let k = 1; k < len; k++) v = v * 256 + bytes[at + k];
    return { v, len, unknown: !marker && v === 2 ** (7 * len) - 1 };
  };
  const out = [];
  const walk = (start, end, depth) => {
    for (let at = start; at < end;) {
      const id = vint(at, true), size = vint(at + id.len, false);
      const body = at + id.len + size.len, stop = size.unknown ? end : body + size.v;
      if (id.v === 0x18538067 || id.v === 0x1f43b675) walk(body, stop, depth + 1);
      else if (id.v === 0xa3 && (bytes[body] & 0x7f) === 2) out.push(bytes[body + 4]);
      at = stop;
    }
  };
  walk(0, bytes.length, 0);
  return out;
}

// --- export/host/webm ------------------------------------------------------------------------------------------------

test('exportWebm: colour + alpha-as-luma frames, paired into one BlockGroup each; media/matroska reads the file back', async () => {
  const doc = sampleDoc({ format: 'webmAlpha', audio: true });
  const log = [];
  await withCodecs({ lag: (i) => (i === 1 ? 3 : 0), spontaneous: (i, n) => i === 0 && n === 3 }, async (c) => {
    const progress = [];
    const res = await WH.exportWebm({ engine: fakeEngine(doc, log), doc, audio: toneBuffer(2, 48000), sink: SINK.createMemorySink(),
      canvas: canvasFactory(), onProgress: (p) => progress.push(p.i) });
    const N = 7;
    assert.equal(res.frames, N);
    deepEqual([res.codec, res.audio, res.audioCodec, res.name], ['vp09.00.31.08', true, 'opus', '夜明け.webm']);
    deepEqual(progress, [1, 2, 3, 4, 5, 6, 7]);
    // the encoders: colour (RGBA, the readback) and alpha (I420, Y = alpha, U = V = 128, full range)
    const [colour, alpha] = c.video;
    assert.equal(c.video.length, 2);
    deepEqual([colour.config.codec, colour.config.bitrate, colour.config.latencyMode], ['vp09.00.31.08', S.bitrate(1280, 720, FPS, 'standard'), 'quality']);
    assert.equal(alpha.config.bitrate, S.alphaBitrate(colour.config.bitrate));
    for (let i = 0; i < N; i++) {
      const ci = colour.inputs[i], ai = alpha.inputs[i];
      deepEqual([ci.format, ci.timestamp, ci.duration, ci.key], ['RGBA', S.ts(i, FPS), S.frameDur(i, FPS), i === 0]);
      deepEqual([ai.format, ai.timestamp, ai.duration, ai.key, ai.colorSpace.fullRange], ['I420', S.ts(i, FPS), S.frameDur(i, FPS), i === 0, true]);
      deepEqual(Array.from(ci.data.subarray(0, 8)), [10, 20, 30, (7 * i) & 255, 10, 20, 30, (1 + 7 * i) & 255], 'straight RGBA from getImageData');
      const W = 1280, H = 720;
      assert.equal(ai.data.length, W * H * 1.5);
      assert.ok([0, 1, 2, 1000, W * H - 1].every((k) => ai.data[k] === ((k + 7 * i) & 255)), 'the Y plane is the alpha');
      assert.ok(ai.data.subarray(W * H).every((v) => v === 128), 'U and V are 128');
    }
    assert.ok(c.frames.every((f) => f.closed), 'every VideoFrame is closed');
    // the audio was encoded before the first video frame
    assert.ok(c.order.indexOf('video0') > c.order.lastIndexOf('audio'), 'Opus first (NOTES ## v2.1-H.1)');
    const opus = c.audio[0];
    assert.equal(opus.config.codec, 'opus');
    assert.equal(opus.inputs.reduce((s, x) => s + x.frames, 0), S.audioFrames(N, FPS, 48000), 'exactly audioFrames(N)');
    // the file
    const bytes = await blobBytes(res.blob);
    assert.equal(bytes.length, res.bytes);
    const movie = await demux(bytes);
    const v = movie.tracks.find((t) => t.kind === 'video');
    const a = movie.tracks.find((t) => t.kind === 'audio');
    deepEqual([v.alpha, v.table.n, a.codec], [true, N, 'A_OPUS']);
    assert.equal(audioBlocks(bytes).length, opus.inputs.length, 'every Opus packet is in the file');
    assert.ok(audioBlocks(bytes).every((b) => b === 0xa0), 'as SimpleBlocks on track 2');
    const chunkOf = (enc, n) => Uint8Array.from(bytes.subarray(enc === 0 ? v.table.off[n] : v.table.aoff[n],
      (enc === 0 ? v.table.off[n] + v.table.size[n] : v.table.aoff[n] + v.table.asize[n])));
    for (let n = 0; n < N; n++) {
      assert.equal(chunkOf(0, n)[0], 0);
      assert.equal(chunkOf(0, n)[1], n, 'the colour chunk of frame ' + n);
      assert.equal(chunkOf(1, n)[0], 1);
      assert.equal(chunkOf(1, n)[1], n, 'its alpha chunk, paired although the alpha encoder lags');
    }
    deepEqual(Array.from(v.table.key), [1, 0, 0, 0, 0, 0, 0], 'a spontaneous key frame in one stream is not a key (both must be)');
    assert.ok(Math.abs(movie.duration - 7 / FPS) < 1e-3);
  });
  deepEqual(log.filter((x) => x[0] === 'render').map((x) => [x[2], x[3], x[4], x[5]]),
    Array.from({ length: 7 }, (x, i) => [i, 'clear', 'all', 'export']), 'rendered with the backdrop clear');
  deepEqual(log.filter((x) => x[0] !== 'render' && x[0] !== 'ready').map((x) => x[0]), ['fork', 'prepare', 'dispose']);
  assert.ok(log.filter((x) => x[0] === 'ready').every((x, i) => x[2] === i), 'mediaReady before every frame');
});

test('exportWebm: VP8 where VP9 does not encode; no audio track without a song or with 音声を入れる off; no-vp9', async () => {
  const doc = sampleDoc({ format: 'webmAlpha', audio: true });
  await withCodecs({ video: (codec) => codec === 'vp8' }, async (c) => {
    const res = await WH.exportWebm({ engine: fakeEngine(doc, []), doc, audio: null, sink: SINK.createMemorySink(), canvas: canvasFactory() });
    deepEqual([res.codec, res.audio, res.audioCodec], ['vp8', false, null]);
    const movie = await demux(await blobBytes(res.blob));
    deepEqual(movie.tracks.map((t) => [t.kind, t.codec]), [['video', 'vp8']]);
    assert.equal(c.audio.length, 0);
  });
  const off = sampleDoc({ format: 'webmAlpha', audio: false });
  await withCodecs({}, async (c) => {
    const res = await WH.exportWebm({ engine: fakeEngine(off, []), doc: off, audio: toneBuffer(1, 48000), sink: SINK.createMemorySink(),
      canvas: canvasFactory() });
    assert.equal(res.audio, false);
    assert.equal(c.audio.length, 0, 'the song is not encoded at all');
  });
  await withCodecs({ video: () => false }, async () => {
    const sink = SINK.createMemorySink();
    await assert.rejects(WH.exportWebm({ engine: fakeEngine(doc, []), doc, audio: null, sink, canvas: canvasFactory() }),
      (e) => e instanceof S.ExportError && e.code === 'no-vp9');
    assert.equal(sink.bytes, 0);
  });
  await withCodecs({}, async () => {
    const res = await WH.exportWebm({ engine: fakeEngine(doc, []), doc, audio: null, sink: SINK.createMemorySink(), canvas: canvasFactory(),
      codecs: { webm: ['vp8'] } });
    assert.equal(res.codec, 'vp8', 'codecs.webm (tests) replaces pickVp9');
  });
});

test('exportWebm: cancel, a store failure, and streams out of step stop the export and leave nothing', async () => {
  const doc = sampleDoc({ format: 'webmAlpha' });
  await withCodecs({}, async (c) => {
    const ctl = new AbortController();
    const sink = SINK.createMemorySink();
    await assert.rejects(WH.exportWebm({ engine: fakeEngine(doc, []), doc, audio: null, sink, canvas: canvasFactory(), signal: ctl.signal,
      onProgress: (p) => { if (p.i === 2) ctl.abort(); } }), (e) => e.code === 'cancelled');
    assert.equal(sink.bytes, 0);
    assert.ok(c.video.every((e) => e.state === 'closed'), 'both encoders closed');
  });
  await withCodecs({}, async () => {
    const sink = SINK.createMemorySink();
    doc.media = { list: [{ id: 'a' + '1'.repeat(24), name: '海.mp4' }] };
    await assert.rejects(WH.exportWebm({ engine: fakeEngine(doc, [], { failAt: 3 }), doc, audio: null, sink, canvas: canvasFactory() }),
      (e) => e.code === 'media' && e.detail.name === '海.mp4');
    assert.equal(sink.bytes, 0);
  });
  await withCodecs({ drop: (i, n) => i === 1 && n === 4 }, async () => {
    const sink = SINK.createMemorySink();
    await assert.rejects(WH.exportWebm({ engine: fakeEngine(doc, []), doc, audio: null, sink, canvas: canvasFactory() }),
      (e) => e.code === 'encode');
    assert.equal(sink.bytes, 0);
  });
});

test('openJob: the backdrop and layers options, a shared asset store, and re-planning a document', async () => {
  const doc = sampleDoc({ format: 'kit' });
  const log = [];
  const job = await J.openJob({ engine: fakeEngine(doc, log), doc, format: 'kit', canvas: canvasFactory(), backdrop: 'clear', layers: 'ground',
    assets: { name: 'store' } });
  deepEqual([job.ropts.backdrop, job.ropts.layers, job.ropts.quality, job.surface.ctx.alpha], ['clear', 'ground', 'export', true]);
  deepEqual(log[0], ['fork', 1, 'store']);
  deepEqual(job.options({ backdrop: 'scene' }), Object.assign({}, job.ropts, { backdrop: 'scene' }));
  assert.equal(job.ropts.backdrop, 'clear', 'options() leaves the job\'s own options alone');
  assert.equal(job.surfaceFor(false).ctx.alpha, false);
  job.render(2, null, job.options({ layers: undefined }));
  deepEqual(log[log.length - 1].slice(2, 5), [2, 'clear', 'all']);
  const all = await J.openJob({ engine: fakeEngine(doc, log), doc, format: 'kit', canvas: canvasFactory(), layers: 'all' });
  deepEqual([all.ropts.backdrop, 'layers' in all.ropts, all.surface.ctx.alpha], ['scene', false, false]);
  const green = Object.assign({}, doc, { look: Object.assign({}, doc.look, { backdrop: 'chroma' }) });
  const log2 = [];
  const g = await J.openJob({ engine: fakeEngine(doc, log2), doc: green, format: 'kit', canvas: canvasFactory(), replan: true });
  deepEqual(log2.filter((x) => x[0] === 'setDoc'), [['setDoc', 1, 'chroma']], 'the fork already had a plan: replan makes it plan `doc`');
  assert.equal(g.ropts.backdrop, 'chroma');
  const log3 = [];
  await J.openJob({ engine: fakeEngine(doc, log3), doc, format: 'mp4', canvas: canvasFactory() });
  assert.ok(!log3.some((x) => x[0] === 'setDoc'), 'without replan a planned fork keeps its plan');
});

// --- export/host/sink: folders -------------------------------------------------------------------------------------

// An in-memory directory handle with the File System Access calls the sinks use.
function fakeDir(name, log) {
  const entries = new Map();
  const dir = {
    name, kind: 'directory', entries,
    async getFileHandle(n, o) {
      if (!entries.has(n)) {
        if (!(o && o.create)) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
        const file = { name: n, kind: 'file', data: new Uint8Array(0), removed: false };
        file.createWritable = async () => ({
          async write(x) {
            const part = x.data instanceof Uint8Array ? x.data : new Uint8Array(await x.data.arrayBuffer());
            const end = Math.max(file.data.length, x.position + part.length);
            const next = new Uint8Array(end);
            next.set(file.data);
            next.set(part, x.position);
            file.data = next;
          },
          async close() { log.push(['close', n]); },
          async abort() { log.push(['abort', n]); },
        });
        file.remove = async () => { entries.delete(n); file.removed = true; log.push(['remove', n]); };
        entries.set(n, file);
      }
      return entries.get(n);
    },
    async getDirectoryHandle(n, o) {
      if (!entries.has(n)) {
        if (!(o && o.create)) throw Object.assign(new Error('not found'), { name: 'NotFoundError' });
        entries.set(n, fakeDir(n, log));
      }
      return entries.get(n);
    },
    async removeEntry(n, o) { log.push(['removeEntry', n, !!(o && o.recursive)]); entries.delete(n); },
    async* keys() { for (const k of entries.keys()) yield k; },
  };
  return dir;
}

test('createDirSink: one file sink per name, close lists the files, abort removes the folder (or every file)', async () => {
  const log = [];
  const parent = fakeDir('Videos', log);
  const folder = await parent.getDirectoryHandle('clip_filmora', { create: true });
  const dir = SINK.createDirSink(folder, { parent, name: 'clip_filmora' });
  deepEqual([dir.kind, dir.name], ['dir', 'clip_filmora']);
  const a = await dir.file('a.mp4');
  await a.write(Uint8Array.from([1, 2, 3]));
  await a.write(Uint8Array.from([9]), 1);
  await a.close();
  const b = await dir.file('b.txt');
  await b.write(Uint8Array.from([7]));
  await assert.rejects(dir.file('a.mp4'), (e) => e.code === 'sink', 'a name is used once');
  deepEqual(dir.files, [{ name: 'a.mp4', bytes: 3 }, { name: 'b.txt', bytes: 1 }]);
  deepEqual(await dir.close(), { files: [{ name: 'a.mp4', bytes: 3 }, { name: 'b.txt', bytes: 1 }] }, 'b.txt is closed by the folder');
  deepEqual(Array.from(folder.entries.get('a.mp4').data), [1, 9, 3]);
  deepEqual(log.filter((x) => x[0] === 'close'), [['close', 'a.mp4'], ['close', 'b.txt']]);
  await assert.rejects(dir.file('c'), (e) => e.code === 'sink');
  await dir.abort();
  assert.ok(parent.entries.has('clip_filmora'), 'abort after close keeps the folder');
  // cancelled: every file sink aborted, then the folder removed from its parent
  const log2 = [];
  const parent2 = fakeDir('Videos', log2);
  const folder2 = await parent2.getDirectoryHandle('x_filmora', { create: true });
  const dir2 = SINK.createDirSink(folder2, { parent: parent2, name: 'x_filmora' });
  await (await dir2.file('m.mp4')).write(new Uint8Array(4));
  await dir2.file('n.webm');
  await dir2.abort();
  deepEqual(log2.filter((x) => x[0] !== 'close'), [['abort', 'm.mp4'], ['remove', 'm.mp4'], ['remove', 'n.webm'], ['removeEntry', 'x_filmora', true]]);
  assert.ok(!parent2.entries.has('x_filmora'));
  // without a parent: the files it made are removed one by one
  const log3 = [];
  const bare = fakeDir('bare', log3);
  const dir3 = SINK.createDirSink(bare);
  const f = await dir3.file('only.srt');
  await f.write(new Uint8Array(1));
  await dir3.abort();
  assert.equal(bare.entries.size, 0);
  assert.equal(dir3.name, 'bare');
});

test('openDirectory: the picker (read-write, id mojipv-kit), a new folder never overwriting one, null on cancel', async () => {
  const saved = globalThis.showDirectoryPicker;
  const log = [];
  const parent = fakeDir('Movies', log);
  await parent.getDirectoryHandle('song_filmora', { create: true });
  await parent.getFileHandle('song_filmora (2)', { create: true });
  let asked = null;
  try {
    assert.equal(SINK.canDirectory(), false);
    await assert.rejects(SINK.openDirectory({ name: 'x' }), (e) => e.code === 'sink');
    globalThis.showDirectoryPicker = async (o) => { asked = o; return parent; };
    assert.equal(SINK.canDirectory(), true);
    const dir = await SINK.openDirectory({ name: 'song_filmora' });
    deepEqual(asked, { mode: 'readwrite', id: 'mojipv-kit' });
    assert.equal(dir.name, 'song_filmora (3)', 'the taken names (a folder, a file) are skipped');
    assert.ok(parent.entries.has('song_filmora (3)'));
    await dir.abort();
    assert.ok(!parent.entries.has('song_filmora (3)') && parent.entries.has('song_filmora'), 'abort removes only its own folder');
    globalThis.showDirectoryPicker = async () => { throw Object.assign(new Error('closed'), { name: 'AbortError' }); };
    assert.equal(await SINK.openDirectory({ name: 'y' }), null);
    globalThis.showDirectoryPicker = async () => { throw Object.assign(new Error('denied'), { name: 'SecurityError' }); };
    await assert.rejects(SINK.openDirectory({ name: 'y' }), (e) => e.code === 'sink');
  } finally {
    if (saved === undefined) delete globalThis.showDirectoryPicker; else globalThis.showDirectoryPicker = saved;
  }
});

test('openSink: the WebM kind (a memory sink of video/webm without File System Access)', async () => {
  const sink = await SINK.openSink({ name: 'a.webm', kind: 'webm' });
  assert.equal(sink.kind, 'memory');
  await sink.write(new Uint8Array(2));
  assert.equal((await sink.close()).blob.type, 'video/webm');
});

test('probe: vp9Codec is the first VP9 (else VP8) string that encodes, else null', async () => {
  await withCodecs({ video: (c) => c.startsWith('vp09') }, async () => {
    assert.equal((await J.probe({ w: 1920, h: 1080, fps: 30 })).vp9Codec, 'vp09.00.40.08');
  });
  await withCodecs({ video: (c) => c === 'vp8' }, async () => {
    const pr = await J.probe({ w: 1280, h: 720, fps: 30 });
    deepEqual([pr.codec, pr.vp9Codec], [null, 'vp8']);
  });
  await withCodecs({ video: (c) => c.startsWith('avc1') }, async () => {
    assert.equal((await J.probe({ w: 1280, h: 720, fps: 30 })).vp9Codec, null);
  });
});

// --- export/host/kit ---------------------------------------------------------------------------------------------------

function kitDoc(kit, output) {
  return sampleDoc(Object.assign({ format: 'kit', audio: true, kit: Object.assign({ overlay: true, bg: true, green: true, srt: true, lrc: true }, kit) },
    output || {}));
}

function fakeStore(log) {
  return {
    name: 'root',
    fork() { log.push(['store.fork']); return { name: 'shared', dispose() { log.push(['store.dispose']); } }; },
  };
}

async function kitRun(doc, o) {
  const log = [];
  const opts = Object.assign({ engine: fakeEngine(doc, log, o && o.engineOpts), doc, audio: toneBuffer(2, 48000), dir: null,
    canvas: canvasFactory(), lib: fakeMp4Lib() }, o || {});
  delete opts.engineOpts;
  return { log, result: await KIT.exportKit(opts) };
}

async function unzip(blob) {
  const bytes = await blobBytes(blob);
  const read = async (at, n) => bytes.subarray(at, at + n);
  const zip = await U.openZip(read, bytes.length);
  const out = new Map();
  for (const [name, e] of zip.entries) {
    const start = await U.dataStart(read, e);
    out.set(name, bytes.subarray(start, start + e.bytes));
  }
  return out;
}

test('exportKit: one pass — per frame both forks\' media, then main, overlay, background and green, each rendered its way', async () => {
  const doc = kitDoc({});
  const storeLog = [];
  await withCodecs({ audio: (codec) => codec === 'opus' }, async (c) => {
    const { log, result } = await kitRun(doc, { assets: fakeStore(storeLog) });
    const N = 7;
    // two forks, both on the one store fork; the green one re-planned with the backdrop chroma
    deepEqual(log.filter((x) => x[0] === 'fork').map((x) => x[2]), ['shared', 'shared']);
    deepEqual(log.filter((x) => x[0] === 'setDoc').map((x) => [x[1], x[2]]), [[2, 'chroma']]);
    deepEqual(storeLog, [['store.fork'], ['store.dispose']]);
    const frameLog = log.filter((x) => x[0] === 'ready' || x[0] === 'render');
    const want = [];
    for (let i = 0; i < N; i++) {
      want.push(['ready', 1, i], ['ready', 2, i], ['render', 1, i, 'scene', 'all', 'export'], ['render', 1, i, 'clear', 'all', 'export'],
        ['render', 1, i, 'scene', 'ground', 'export'], ['render', 2, i, 'chroma', 'all', 'export']);
    }
    deepEqual(frameLog, want);
    deepEqual(log.filter((x) => x[0] === 'dispose').map((x) => x[1]), [1, 2]);
    // encoders: main, overlay colour and alpha, background, green — each its own, all at ts(i)
    deepEqual(c.video.map((e) => [e.config.codec, e.config.bitrate]), [
      ['avc1.640028', S.bitrate(1280, 720, FPS, 'standard')], ['vp09.00.31.08', S.bitrate(1280, 720, FPS, 'standard')],
      ['vp09.00.31.08', S.alphaBitrate(S.bitrate(1280, 720, FPS, 'standard'))], ['avc1.640028', S.bitrate(1280, 720, FPS, 'standard')],
      ['avc1.640028', S.bitrate(1280, 720, FPS, 'max')]]);
    assert.ok(c.video.every((e) => e.inputs.length === N && e.inputs.every((x, i) => x.timestamp === S.ts(i, FPS) && x.key === (i === 0))));
    assert.equal(c.audio.length, 0, 'no AAC encoder: the kit never falls back to Opus in MP4');
    deepEqual([result.audio, result.frames, result.codec, result.overlayCodec, result.folder], ['wav', N, 'avc1.640028', 'vp09.00.31.08', '夜明け_filmora']);
    // the ZIP (no folder): every file of kitFiles, in its order
    const base = '夜明け';
    const names = [base + '.mp4', base + '_overlay.webm', base + '_bg.mp4', base + '_green.mp4', base + '.srt', base + '.lrc', base + '.wav', 'README_Filmora.txt'];
    deepEqual(result.files.map((f) => f.name), names);
    deepEqual(result.files.map((f) => f.name), S.kitFiles(doc, F.trivialPlan(doc), { audioCodec: null }).map((f) => f.name));
    assert.equal(result.name, base + '_filmora.zip');
    const files = await unzip(result.blob);
    deepEqual([...files.keys()], names);
    assert.equal(result.bytes, (await blobBytes(result.blob)).length);
    for (const f of result.files) assert.equal(files.get(f.name).length, f.bytes, f.name);
    const mp4 = (n) => JSON.parse(new TextDecoder().decode(files.get(n)));
    const main = mp4(base + '.mp4');
    deepEqual([main.codec, main.audio, main.video.length, main.video.map((v) => v.enc)], ['avc', null, N, Array(N).fill(0)]);
    deepEqual(mp4(base + '_bg.mp4').video.map((v) => v.enc), Array(N).fill(3));
    deepEqual(mp4(base + '_green.mp4').video.map((v) => v.enc), Array(N).fill(4));
    const movie = await demux(files.get(base + '_overlay.webm'));
    deepEqual(movie.tracks.map((t) => [t.kind, t.alpha, t.table && t.table.n]), [['video', true, N]], 'the overlay: alpha, no sound');
    // the WAV: audioFrames(N) frames of the song from t0
    const wav = files.get(base + '.wav');
    const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const frames = S.audioFrames(N, FPS, 48000);
    deepEqual([v.getUint16(22, true), v.getUint32(24, true), v.getUint32(40, true)], [2, 48000, frames * 4]);
    const start = Math.round(0.1 * 48000);
    assert.equal(v.getInt16(44, true), Math.round(0.25 * Math.sin(start / 10) * 32767), 'sample-exact from t0');
    // SRT (BOM, the export range), LRC (song times), README (BOM, CRLF)
    const text = (n) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(files.get(n));
    assert.equal(text(base + '.srt'), '﻿' + MV.use('export/subtitles').srt(F.trivialPlan(doc), { t0: 0.1, t1: 0.1 + 7 / FPS }));
    assert.equal(text(base + '.lrc'), MV.use('export/subtitles').lrc(F.trivialPlan(doc), doc));
    const readme = text('README_Filmora.txt');
    assert.ok(readme.startsWith('﻿文字PVメーカーの書き出しファイル（Filmora用）\r\n'));
    assert.ok(names.slice(0, -1).every((n) => readme.includes(n)), 'every file by its real name');
    assert.ok(readme.includes('1280×720・30fps') && readme.includes('1280×720, 30 fps') && readme.includes('#00B140'));
    assert.ok(readme.indexOf('Files exported by Moji PV Maker') > readme.indexOf('Filmoraで新しいプロジェクト'), 'Japanese, then English');
    assert.ok(!/(^|[^\r])\n/.test(readme), 'CRLF only');
  });
});

test('exportKit: AAC in the main MP4 where it encodes (no WAV); no song, no sound; the optional files follow output.kit', async () => {
  await withCodecs({ audio: (codec) => codec === 'mp4a.40.2' }, async (c) => {
    const { result } = await kitRun(kitDoc({ bg: false, green: false, lrc: false }));
    deepEqual(result.files.map((f) => f.kind), ['main', 'overlay', 'srt', 'readme']);
    assert.equal(result.audio, 'aac');
    deepEqual(c.audio.map((e) => e.config.codec), ['mp4a.40.2']);
    const main = JSON.parse(new TextDecoder().decode((await unzip(result.blob)).get('夜明け.mp4')));
    deepEqual(main.audio, { codec: 'aac', numberOfChannels: 2, sampleRate: 48000 });
    assert.ok(main.sound > 0);
  });
  await withCodecs({ audio: () => true }, async (c) => {
    const { result } = await kitRun(kitDoc({ overlay: false, green: false }), { audio: null });
    deepEqual([result.audio, result.files.map((f) => f.kind)], ['none', ['main', 'bg', 'srt', 'lrc', 'readme']]);
    assert.equal(c.audio.length, 0);
    assert.equal(c.video.length, 2, 'main and background only');
  });
  await withCodecs({ audio: (codec) => codec === 'mp4a.40.2' || codec === 'opus' }, async () => {
    const { result } = await kitRun(kitDoc({ green: false }), { codecs: { audioList: ['bogus.aac', 'opus'] } });
    assert.equal(result.audio, 'wav', 'codecs.audioList (tests) without AAC: the WAV, never Opus');
  });
  await withCodecs({ audio: () => true }, async () => {
    const { result, log } = await kitRun(kitDoc({ green: false }), {});
    assert.equal(log.filter((x) => x[0] === 'fork').length, 1, 'without the green screen one fork');
    assert.ok(log.filter((x) => x[0] === 'fork').every((x) => x[2] === null), 'no store given: the forks make their own');
    deepEqual(result.files.map((f) => f.kind), ['main', 'overlay', 'bg', 'srt', 'lrc', 'readme']);
  });
});

test('exportKit into a folder: one file sink each; cancel, a missing VP9 or a store failure remove the folder', async () => {
  await withCodecs({ audio: () => false }, async () => {
    const fsLog = [];
    const parent = fakeDir('Videos', fsLog);
    const folder = await parent.getDirectoryHandle('夜明け_filmora', { create: true });
    const progress = [];
    const { result } = await kitRun(kitDoc({}), { dir: SINK.createDirSink(folder, { parent, name: '夜明け_filmora' }),
      onProgress: (p) => progress.push(p.phase + p.i) });
    deepEqual([...folder.entries.keys()].sort(), result.files.map((f) => f.name).sort());
    assert.ok(result.files.every((f) => folder.entries.get(f.name).data.length === f.bytes));
    deepEqual([result.blob, result.name, result.folder], [undefined, undefined, '夜明け_filmora']);
    deepEqual(progress, ['video1', 'video2', 'video3', 'video4', 'video5', 'video6', 'video7', 'files7']);
  });
  for (const [what, setup, code] of [
    ['cancel', (o) => { const ctl = new AbortController(); o.signal = ctl.signal; o.onProgress = (p) => { if (p.i === 3) ctl.abort(); }; }, 'cancelled'],
    ['no VP9', (o) => { o.codecs = { webm: [] }; }, 'no-vp9'],
    ['a store failure', (o) => { o.engineOpts = { failAt: 4 }; }, 'media'],
  ]) {
    await withCodecs({ audio: () => false }, async (c) => {
      const fsLog = [];
      const parent = fakeDir('Videos', fsLog);
      const folder = await parent.getDirectoryHandle('k', { create: true });
      const o = { dir: SINK.createDirSink(folder, { parent, name: 'k' }) };
      setup(o);
      await assert.rejects(kitRun(kitDoc({}), o), (e) => e instanceof S.ExportError && e.code === code, what);
      assert.ok(!parent.entries.has('k'), what + ': the folder is removed');
      assert.ok(c.video.every((e) => e.state === 'closed'), what + ': every encoder closed');
    });
  }
  await withCodecs({ audio: () => false }, async () => {
    const saved = globalThis.VideoEncoder;
    delete globalThis.VideoEncoder;
    const parent = fakeDir('Videos', []);
    const folder = await parent.getDirectoryHandle('k', { create: true });
    try {
      await assert.rejects(kitRun(kitDoc({}), { dir: SINK.createDirSink(folder, { parent, name: 'k' }) }), (e) => e.code === 'no-webcodecs');
    } finally {
      globalThis.VideoEncoder = saved;
    }
    assert.ok(!parent.entries.has('k'));
  });
});

test('readme: the files with their labels and the guide\'s steps (only those that apply), Japanese then English', () => {
  const files = [{ name: 'a.mp4', kind: 'main' }, { name: 'a.wav', kind: 'wav' }, { name: 'README_Filmora.txt', kind: 'readme' }];
  const text = KIT.readme(files, { w: 1920, h: 1080, fps: 24 });
  deepEqual(text.split('\r\n'), [
    '文字PVメーカーの書き出しファイル（Filmora用）', '', '- a.mp4 : 完成動画（MP4）', '- a.wav', '',
    '1. Filmoraで新しいプロジェクトを作り、1920×1080・24fps にします。', '2. 「a.mp4」を読み込み、タイムラインの 0:00 に置きます。',
    '3. 音が入っていないときは「a.wav」を 0:00 に置きます。', '-'.repeat(60), '',
    'Files exported by Moji PV Maker (for Filmora)', '', '- a.mp4 : Finished video (MP4)', '- a.wav', '',
    '1. Create a new Filmora project at 1920×1080, 24 fps.', '2. Import "a.mp4" and place it at 0:00 on the timeline.',
    '3. If there is no sound, place "a.wav" at 0:00.', '']);
  assert.equal(KIT.KEY_COLOUR, '#00B140');
});
