/* 文字PVメーカー v2 — original work. Native encoder preference/fallback, device hints and transparent streams. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const api = load();
const J = api.use('export/host/mp4');
const W = api.use('export/host/webm');
const S = api.use('export/schedule');
const SINK = api.use('export/host/sink');

async function withVideo(o, fn) {
  const saved = { VideoEncoder: globalThis.VideoEncoder, VideoFrame: globalThis.VideoFrame, AudioEncoder: globalThis.AudioEncoder };
  const log = { probes: [], encoders: [], frames: [] };
  class VideoEncoder {
    static async isConfigSupported(config) {
      log.probes.push(config);
      return { supported: o.support ? o.support(config) : true, config: o.normalize ? o.normalize(config) : config };
    }
    constructor(init) { this.init = init; this.index = log.encoders.length; this.state = 'unconfigured'; this.encodeQueueSize = 0; this.inputs = []; log.encoders.push(this); }
    configure(config) {
      this.config = config;
      if (o.configure) o.configure(config, this);
      this.state = 'configured';
    }
    encode(frame, opts) {
      assert.equal(this.state, 'configured');
      this.inputs.push({ timestamp: frame.timestamp, duration: frame.duration, key: opts.keyFrame });
      const bytes = Uint8Array.of(1, 2, 3);
      this.init.output({ type: opts.keyFrame ? 'key' : 'delta', timestamp: frame.timestamp, duration: frame.duration,
        byteLength: bytes.length, copyTo: (dest) => dest.set(bytes) }, {});
    }
    async flush() {}
    close() { this.state = 'closed'; }
  }
  class VideoFrame {
    constructor(source, opts) { Object.assign(this, opts); this.source = source; this.closed = false; log.frames.push(this); }
    close() { this.closed = true; }
  }
  Object.assign(globalThis, { VideoEncoder, VideoFrame });
  delete globalThis.AudioEncoder;
  try { return await fn(log); } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
}

const job = { w: 2, h: 2, fps: 30, N: 2, acceleration: 'auto' };

test('GPU preference is checked across codecs before accepting an automatic encoder', async () => {
  await withVideo({ support: (c) => c.hardwareAcceleration !== 'prefer-hardware' || c.codec === 'vp8' }, async (log) => {
    const config = await J.vp9Config({ webm: ['vp09.00.10.08', 'vp8'] }, 640, 360, 30, 900000);
    assert.equal(config.codec, 'vp8');
    assert.equal(config.hardwareAcceleration, 'prefer-hardware');
    assert.deepEqual(J.accelerationOf(config), { requested: 'auto', selected: 'prefer-hardware', fallback: false });
    assert.deepEqual(log.probes.map((c) => [c.codec, c.hardwareAcceleration]), [
      ['vp09.00.10.08', 'prefer-hardware'], ['vp8', 'prefer-hardware'], ['vp8', 'no-preference'],
    ]);
  });
});

test('unsupported GPU preference falls back without changing frame rate, bitrate or codec order', async () => {
  await withVideo({ support: (c) => c.hardwareAcceleration === 'no-preference' }, async () => {
    const config = await J.videoConfig({ video: 'avc1.64001f' }, job, 7654321, 'gpu');
    assert.deepEqual([config.codec, config.width, config.height, config.framerate, config.bitrate], ['avc1.64001f', 2, 2, 30, 7654321]);
    assert.deepEqual(J.accelerationOf(config), { requested: 'gpu', selected: 'no-preference', fallback: true });
  });
});

test('CPU preference selects software and probes MP4 and transparent WebM consistently', async () => {
  await withVideo({}, async () => {
    const config = await J.videoConfig({ video: 'avc1.64001f' }, Object.assign({}, job, { acceleration: 'cpu' }), 1000000);
    assert.equal(config.hardwareAcceleration, 'prefer-software');
    const probe = await J.probe({ w: 640, h: 360, fps: 30, acceleration: 'cpu' });
    for (const info of [probe.acceleration, probe.webmAcceleration]) {
      assert.deepEqual(info, { requested: 'cpu', selected: 'prefer-software', fallback: false });
    }
  });
});

test('a browser that ignores device hints is reported as automatic, never as GPU-supported', async () => {
  await withVideo({ normalize: (c) => { const copy = Object.assign({}, c); delete copy.hardwareAcceleration; return copy; } }, async () => {
    const config = await J.videoConfig({ video: 'avc1.64001f' }, job, 1000000);
    assert.deepEqual(J.accelerationOf(config), { requested: 'auto', selected: 'no-preference', fallback: true });
  });
});

test('changed codec, dimensions or nonfinite bitrate in a support reply do not reach configure', async () => {
  for (const bad of [{ codec: 'vp8' }, { width: 7 }, { height: 9 }, { framerate: 60 }, { bitrate: NaN }, { bitrate: 0 }]) {
    await withVideo({ normalize: (c) => Object.assign({}, c, c.hardwareAcceleration === 'prefer-hardware' ? bad : {}) }, async () => {
      const config = await J.videoConfig({ video: 'avc1.64001f' }, job, 1000000);
      assert.equal(config.hardwareAcceleration, 'no-preference');
      assert.equal(config.bitrate, 1000000);
    });
  }
});

test('a GPU configure failure is retried on a fresh automatic encoder before any input', async () => {
  await withVideo({ configure: (c) => { if (c.hardwareAcceleration === 'prefer-hardware') throw new Error('GPU unavailable'); } }, async (log) => {
    const config = await J.videoConfig({ video: 'avc1.64001f' }, job, 1000000);
    const errors = [], configured = J.configureVideo(config, { output() {}, error: (e) => errors.push(e) });
    assert.equal(log.encoders.length, 2);
    assert.equal(log.encoders[0].state, 'closed');
    assert.equal(log.encoders[0].inputs.length, 0);
    assert.equal(configured.encoder.state, 'configured');
    assert.deepEqual(J.accelerationOf(configured.config), { requested: 'auto', selected: 'no-preference', fallback: true });
    log.encoders[0].init.error(new Error('late GPU failure'));
    assert.equal(errors.length, 0, 'an abandoned encoder must not abort its replacement');
    configured.encoder.close();
    assert.equal(config.hardwareAcceleration, 'prefer-hardware', 'shared kit configurations are never mutated');
  });
});

test('synchronous error callbacks during GPU configure also trigger the safe fallback', async () => {
  await withVideo({ configure: (c, e) => { if (c.hardwareAcceleration === 'prefer-hardware') e.init.error(new Error('device lost')); } }, async (log) => {
    const config = await J.videoConfig({ video: 'avc1.64001f' }, job, 1000000);
    let reported = false;
    const chosen = J.configureVideo(config, { output() {}, error() { reported = true; } });
    assert.equal(chosen.config.hardwareAcceleration, 'no-preference');
    assert.equal(log.encoders[0].state, 'closed');
    assert.equal(reported, false);
    chosen.encoder.close();
  });
});

test('a GPU encoder quota failure releases the device before configuring the automatic fallback', async () => {
  await withVideo({ configure: (c) => {
    if (c.hardwareAcceleration === 'prefer-hardware') throw new DOMException('GPU encoder occupied', 'QuotaExceededError');
  } }, async (log) => {
    const config = await J.videoConfig({ video: 'avc1.64001f' }, job, 1000000);
    const chosen = J.configureVideo(config, { output() {}, error() {} });
    assert.equal(log.encoders[0].state, 'closed');
    assert.equal(log.encoders[0].inputs.length, 0);
    assert.equal(chosen.config.hardwareAcceleration, 'no-preference');
    chosen.encoder.close();
  });
});

test('if every supported configure fails, each encoder closes and the final error propagates', async () => {
  await withVideo({ configure: () => { throw new Error('device exhausted'); } }, async (log) => {
    const config = await J.videoConfig({ video: 'avc1.64001f' }, job, 1000000);
    assert.throws(() => J.configureVideo(config, { output() {}, error() {} }), /device exhausted/);
    assert.equal(log.encoders.length, 2);
    assert.ok(log.encoders.every((e) => e.state === 'closed' && e.inputs.length === 0));
  });
});

function mp4Lib() {
  class ArrayBufferTarget { constructor() { this.buffer = null; } }
  class StreamTarget { constructor(options) { this.options = options; } }
  class Muxer {
    constructor(o) { this.options = o; }
    addVideoChunk() {}
    finalize() { this.options.target.buffer = new Uint8Array([1, 2, 3]).buffer; }
  }
  return { ArrayBufferTarget, StreamTarget, Muxer };
}

test('MP4 output reports the installed fallback and preserves exact frame timing and cleanup', async () => {
  await withVideo({ configure: (c) => { if (c.hardwareAcceleration === 'prefer-hardware') throw new Error('GPU busy'); } }, async (log) => {
    const config = await J.videoConfig({ video: 'avc1.64001f' }, job, 1000000);
    const out = J.createMp4Output({ lib: mp4Lib(), sink: SINK.createMemorySink({ name: 'gpu.mp4' }), job, vcfg: config });
    assert.deepEqual(out.acceleration, { requested: 'auto', selected: 'no-preference', fallback: true });
    for (let i = 0; i < job.N; i++) await out.frame(i, {});
    await out.flush(); await out.end();
    assert.deepEqual(log.encoders[1].inputs.map((f) => f.timestamp), [0, 33333]);
    assert.ok(log.encoders.every((e) => e.state === 'closed'));
    assert.ok(log.frames.every((f) => f.closed));
  });
});

test('transparent colour and alpha can independently fall back, with exact paired frames', async () => {
  const bits = 1000000;
  await withVideo({ configure: (c, encoder) => {
    if (c.hardwareAcceleration === 'prefer-hardware' && encoder.index === 1) throw new Error('alpha GPU busy');
  } }, async (log) => {
    const config = await J.vp9Config({ webm: ['vp8'] }, job.w, job.h, job.fps, bits, 'gpu');
    const out = W.createAlphaOutput({ sink: SINK.createMemorySink({ name: 'gpu.webm' }), job, config, audio: null });
    assert.deepEqual(out.acceleration, { requested: 'gpu', selected: 'prefer-hardware', fallback: false, alphaSelected: 'no-preference' });
    const surface = { ctx: { getImageData: () => ({ data: new Uint8ClampedArray([10, 20, 30, 0, 10, 20, 30, 255, 10, 20, 30, 127, 10, 20, 30, 191]) }) } };
    for (let i = 0; i < job.N; i++) await out.frame(i, surface);
    await out.flush(); const result = await out.end();
    assert.equal(result.stats.frames, job.N);
    assert.deepEqual(log.encoders.filter((e) => e.inputs.length).map((e) => e.inputs.map((f) => f.timestamp)), [[0, 33333], [0, 33333]]);
    assert.equal(log.encoders[1].inputs.length, 0, 'the failed alpha encoder received no frame');
    assert.ok(log.encoders.every((e) => e.state === 'closed'));
    assert.ok(log.frames.every((f) => f.closed));
    assert.equal(config.bitrate, bits);
  });
});
