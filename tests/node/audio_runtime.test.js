/* 文字PVメーカー v2 — original work. Local WASM controller: pinned assets, shared load cancellation, bounded inputs and disposable workers. Real codec coverage lives in browser/audio_local.py. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { resolveObjectURL } = require('node:buffer');
const { webcrypto, createHash } = require('node:crypto');
const { load } = require('../helpers/load.js');

const api = load(), root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'src/export/host/audio_runtime.js'), 'utf8');
const binaries = Object.fromEntries(['ffmpeg-core.js', 'ffmpeg-core.wasm'].map((name) => [name, fs.readFileSync(path.join(root, 'vendor/ffmpeg', name))]));

function harness(opts = {}) {
  const requests = [], workers = [], urls = new Set(), timers = new Set(), stored = new Map();
  let factory;
  class LocalURL extends URL {
    static createObjectURL(blob) { const url = URL.createObjectURL(blob); urls.add(url); return url; }
    static revokeObjectURL(url) { urls.delete(url); URL.revokeObjectURL(url); }
  }
  class Worker {
    constructor(url) {
      this.url = url; this.messages = []; this.terminated = false; workers.push(this);
      if (opts.probeStreams) {
        this.bridgeReady = resolveObjectURL(url).text().then((program) => {
          // Execute the actual original worker bridge, while replacing only the native FFmpeg module for malformed
          // probe fixtures. Codec behaviour itself has separate real-WASM and browser coverage.
          const core = { setLogger() {}, setProgress() {}, setTimeout() {}, reset() {}, exec: () => 0, ffprobe: () => -1,
            FS: { filesystems: { WORKERFS: {} }, mkdir() {}, mount() {}, stat: () => ({ size: 4 }),
              readFile(file) { return file === '/result.json' ? JSON.stringify({ streams: opts.probeStreams }) : Uint8Array.of(0, 1, 2, 3); },
              unlink() {}, unmount() {}, rmdir() {} } };
          const scope = { self: { postMessage: (data) => queueMicrotask(() => { if (this.onmessage) this.onmessage({ data }); }) },
            createFFmpegCore: async () => core, FileReaderSync: function () {}, Uint8Array, ArrayBuffer };
          vm.runInNewContext(program.slice(binaries['ffmpeg-core.js'].length + 1), scope, { filename: 'actual-worker-bridge.js' });
          this.bridge = scope.self;
        });
      }
    }
    postMessage(message) {
      this.messages.push(message);
      if (opts.throwAt === message.kind) throw new Error('Failed to clone worker input');
      if (this.bridgeReady) {
        this.bridgeReady.then(() => this.bridge.onmessage({ data: message })).catch((error) => {
          if (this.onerror) this.onerror({ error, preventDefault() {} });
        });
        return;
      }
      if (message.kind === 'init') queueMicrotask(() => { if (this.onmessage) this.onmessage({ data: { kind: 'ready' } }); });
      else if (message.kind === 'convert' && !opts.hold) {
        queueMicrotask(() => {
          if (!this.onmessage) return;
          if (opts.workerError) this.onmessage({ data: { kind: 'error', code: opts.workerError } });
          else this.onmessage({ data: { kind: 'done', bytes: Uint8Array.of(0, 1, 2, 3).buffer, measuredBitrate: 313167 } });
        });
      }
    }
    terminate() { this.terminated = true; }
  }
  class LocalBlob extends Blob {
    constructor(parts, options) {
      if (opts.failOutputBlob && options && options.type === 'video/mp4') throw new RangeError('Output Blob allocation failed');
      super(parts, options);
    }
    static [Symbol.hasInstance](value) { return value instanceof Blob; }
  }
  const cache = {
    async match(url) { const item = stored.get(url); return item ? new Response(item) : undefined; },
    async put(url, response) { stored.set(url, await response.arrayBuffer()); },
    async delete(url) { return stored.delete(url); },
  };
  const context = {
    MV: { ASSET_BASE: opts.base || 'vendor/ffmpeg/', def(id, deps, fn) { factory = fn; } },
    location: { href: opts.href || 'https://moji.example.test/moji-pv/' },
    Worker, Blob: LocalBlob, URL: LocalURL, WebAssembly, crypto: webcrypto, TextDecoder, TextEncoder,
    AbortController, ArrayBuffer, Uint8Array, RangeError, Response,
    setTimeout(fn, delay) { const timer = setTimeout(fn, delay); timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); clearTimeout(timer); },
    caches: { open: async () => cache },
    async fetch(url, init) {
      requests.push({ url, init });
      if (opts.fetch) return opts.fetch(url, init);
      const name = new URL(url).pathname.split('/').pop();
      return new Response(binaries[name]);
    },
  };
  if (opts.unavailable) context.Worker = undefined;
  vm.runInNewContext(source, context, { filename: 'audio_runtime.js' });
  const runtime = factory(api.use('export/schedule'), api.use('export/host/mp4'));
  return { runtime, context, requests, workers, urls, timers, stored };
}

function input(over = {}) {
  return Object.assign({ video: new Blob([Uint8Array.of(1)]), audio: new Blob([new Uint8Array(48)]), frames: 49, fps: 24 }, over);
}

test('vendored core bytes, hashes and npm lock agree with the immutable runtime manifest', () => {
  const h = harness(), lock = require('../../tools/vendor/package-lock.json');
  assert.equal(lock.packages['node_modules/@ffmpeg/core'].version, h.runtime.VERSION);
  let bytes = 0;
  for (const asset of h.runtime.ASSETS) {
    assert.equal(binaries[asset.name].byteLength, asset.bytes);
    assert.equal(createHash('sha256').update(binaries[asset.name]).digest('hex'), asset.hash);
    bytes += asset.bytes;
  }
  assert.equal(bytes, h.runtime.CORE_BYTES);
  const schedule = api.use('export/schedule');
  assert.equal(schedule.LOCAL_AUDIO_MAX_INPUT_BYTES, h.runtime.LIMITS.maxInputBytes);
  assert.equal(schedule.LOCAL_AUDIO_MAX_OUTPUT_BYTES, h.runtime.LIMITS.maxOutputBytes);
  assert.equal(schedule.LOCAL_AUDIO_MAX_SECONDS, h.runtime.LIMITS.maxSeconds);
});

test('asset base works in JA/EN/lab and a downloaded file fetches only canonical HTTPS core assets', () => {
  for (const [base, href] of [
    ['vendor/ffmpeg/', 'https://moji.example.test/moji-pv/'],
    ['../vendor/ffmpeg/', 'https://moji.example.test/moji-pv/en/'],
    ['../../vendor/ffmpeg/', 'https://moji.example.test/moji-pv/tests/www/lab.html'],
  ]) assert.equal(harness({ base, href }).runtime.baseURL(), 'https://moji.example.test/moji-pv/vendor/ffmpeg/');
  assert.equal(harness({ href: 'file:///tmp/index.html' }).runtime.baseURL(), 'https://momomonbi.github.io/moji-pv/vendor/ffmpeg/');
});

test('missing worker support is reported and does not download assets', async () => {
  const h = harness({ unavailable: true });
  assert.equal(h.runtime.support().supported, false);
  await assert.rejects(h.runtime.prepare(), (e) => e.code === 'audio-local-unavailable');
  assert.equal(h.requests.length, 0);
});

test('hash mismatch fails before any worker, and a new attempt can load valid assets', async () => {
  let wrong = true;
  const h = harness({ fetch(url) {
    const name = new URL(url).pathname.split('/').pop(), bytes = binaries[name];
    if (wrong) { const changed = Buffer.from(bytes); changed[0] ^= 1; return new Response(changed); }
    return new Response(bytes);
  } });
  await assert.rejects(h.runtime.prepare(), (e) => e.code === 'audio-local-load');
  assert.equal(h.workers.length, 0);
  wrong = false;
  await h.runtime.prepare();
  assert.equal(h.runtime.support().cached, true);
});

test('corrupt persistent entries are discarded; verified assets warm the next preparation', async () => {
  const h = harness();
  h.stored.set(h.runtime.baseURL() + 'ffmpeg-core.js', Buffer.alloc(112059, 1));
  await h.runtime.prepare();
  const count = h.requests.length;
  assert.equal(count, 2);
  await h.runtime.prepare();
  assert.equal(h.requests.length, count);
  assert.equal(h.workers.length, 0);
});

test('one preparation subscriber can cancel while the other finishes the same downloads', async () => {
  const h = harness(), a = new AbortController(), b = new AbortController();
  const one = h.runtime.prepare({ signal: a.signal }), two = h.runtime.prepare({ signal: b.signal });
  a.abort();
  await assert.rejects(one, (e) => e.code === 'cancelled');
  await two;
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests.every((r) => !r.init.signal.aborted), true);
  assert.equal(h.runtime.support().cached, true);
});

test('last preparation cancellation aborts its download and a later preparation starts independently', async () => {
  let hold = true;
  const h = harness({ fetch(url, init) {
    if (!hold) return Promise.resolve(new Response(binaries[new URL(url).pathname.split('/').pop()]));
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      if (init.signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
    });
  } });
  const controller = new AbortController(), pending = h.runtime.prepare({ signal: controller.signal });
  while (!h.requests.length) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, (e) => e.code === 'cancelled');
  assert.equal(h.requests[0].init.signal.aborted, true);
  hold = false;
  await h.runtime.prepare();
  assert.equal(h.runtime.support().cached, true);
});

test('input limits and duration failures occur before any download or worker', async () => {
  const h = harness(), large = new Blob([new Uint8Array(h.runtime.MAX_INPUT_BYTES)]);
  for (const value of [input({ video: large }), input({ frames: 24 * 3600 + 1 }), input({ fps: 0 }), input({ audio: new Blob([]) })]) {
    await assert.rejects(h.runtime.convert(value), (e) => ['audio-local-too-large', 'audio-local-media'].includes(e.code));
  }
  assert.equal(h.requests.length, 0); assert.equal(h.workers.length, 0);
});

test('successful jobs keep immutable Blob inputs and dispose each worker; loaded assets are reused', async () => {
  const h = harness(), value = input();
  const one = await h.runtime.convert(value), two = await h.runtime.convert(value);
  assert.equal(one.blob.type, 'video/mp4'); assert.equal(one.measuredBitrate, 313167);
  assert.equal(two.blob.size, 4); assert.equal(h.requests.length, 2);
  assert.equal(h.workers.length, 2);
  for (const worker of h.workers) {
    const convert = worker.messages.find((m) => m.kind === 'convert');
    assert.equal(convert.video, value.video); assert.equal(convert.audio, value.audio);
    assert.equal(worker.terminated, true);
  }
  assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0);
});

test('postMessage failures during init and conversion settle and clean every timer, listener and worker', async () => {
  for (const throwAt of ['init', 'convert']) {
    const h = harness({ throwAt }), controller = new AbortController();
    let listeners = 0;
    const add = controller.signal.addEventListener.bind(controller.signal), remove = controller.signal.removeEventListener.bind(controller.signal);
    controller.signal.addEventListener = (...args) => { if (args[0] === 'abort') listeners++; return add(...args); };
    controller.signal.removeEventListener = (...args) => { if (args[0] === 'abort') listeners--; return remove(...args); };
    await assert.rejects(h.runtime.convert(input({ signal: controller.signal })), (e) => e.code === 'audio-local-convert');
    assert.equal(listeners, 0); assert.equal(h.timers.size, 0); assert.equal(h.urls.size, 0);
    assert.equal(h.workers[0].terminated, true); assert.equal(h.workers[0].onmessage, null);
  }
});

test('cancel during conversion terminates the owned worker and releases the next job', async () => {
  const h = harness({ hold: true }), controller = new AbortController();
  let reached;
  const ready = new Promise((resolve) => { reached = resolve; });
  const pending = h.runtime.convert(input({ signal: controller.signal, onProgress(p) { if (p.phase === 'audioLocal') reached(); } }));
  await ready;
  await assert.rejects(h.runtime.convert(input()), (e) => e.code === 'audio-local-busy');
  controller.abort();
  await assert.rejects(pending, (e) => e.code === 'cancelled');
  assert.equal(h.workers[0].terminated, true); assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0);
});

test('cancellation at worker-ready progress prevents even queuing the conversion', async () => {
  const h = harness(), controller = new AbortController();
  await assert.rejects(h.runtime.convert(input({ signal: controller.signal,
    onProgress(p) { if (p.phase === 'audioLocal') controller.abort(); } })), (e) => e.code === 'cancelled');
  assert.equal(h.workers[0].messages.filter((m) => m.kind === 'convert').length, 0);
  assert.equal(h.workers[0].terminated, true); assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0);
});

test('output allocation failure reports memory and still disposes worker, timer and URL', async () => {
  const h = harness({ failOutputBlob: true });
  await assert.rejects(h.runtime.convert(input()), (e) => e.code === 'audio-local-memory');
  assert.equal(h.workers[0].terminated, true); assert.equal(h.workers[0].onmessage, null);
  assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0);
});

test('an observer error during a worker event cannot leave a conversion pending', async () => {
  const h = harness();
  await assert.rejects(h.runtime.convert(input({ onProgress(p) { if (p.phase === 'audioLocal') throw new Error('Observer failed'); } })),
    (e) => e.code === 'audio-local-convert');
  assert.equal(h.workers[0].terminated, true); assert.equal(h.workers[0].onmessage, null);
  assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0);
});

test('actual worker bridge rejects missing or nonfinite probe timing metadata without producing a result', async () => {
  const valid = [
    { codec_type: 'video', codec_name: 'h264', nb_frames: '49', start_time: '0.000000', duration: '2.041667' },
    { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, start_time: '0.000000', duration: '2.041667', bit_rate: '313167' },
  ];
  const streams = structuredClone(valid), h = harness({ probeStreams: streams });
  await h.runtime.prepare();
  assert.equal((await h.runtime.convert(input())).measuredBitrate, 313167);
  for (const track of [0, 1]) for (const field of ['start_time', 'duration']) {
    for (const value of [undefined, 'NaN', 'Infinity', null, '', false]) {
      for (let i = 0; i < streams.length; i++) { for (const key of Object.keys(streams[i])) delete streams[i][key]; Object.assign(streams[i], valid[i]); }
      if (value === undefined) delete streams[track][field]; else streams[track][field] = value;
      await assert.rejects(h.runtime.convert(input()), (e) => e.code === 'audio-local-response', track + '/' + field + '/' + value);
      assert.equal(h.workers.at(-1).terminated, true); assert.equal(h.urls.size, 0); assert.equal(h.timers.size, 0);
    }
  }
});
