/* 文字PVメーカー v2 — original work. Independent Filmora outputs share a frame barrier, not an encoder wait. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');
const F = require('../helpers/fake_engine');
const api = load();
// Resolve the production factories without the developer freeze so their output adapters can be injected in this
// isolated Node test process. Canvas snapshots, media readiness and the kit loop still use the real implementations.
api.DEV = false;
const J = api.use('export/host/mp4'), WH = api.use('export/host/webm'), KIT = api.use('export/host/kit');
const S = api.use('export/schedule'), D = api.use('core/doc');
api.DEV = true;

async function run(options = {}) {
  const doc = D.defaultDoc();
  doc.sheet = { next: 2, rows: [{ id: 'r1', src: 'shared source / independent outputs' }] };
  Object.assign(doc.output, { format: 'kit', fps: 30, short: 720, audio: false, range: { t0: 0, t1: 2 / 30 },
    kit: { overlay: true, bg: true, green: true, srt: false, lrc: false } });
  const saved = { mp4: J.createMp4Output, alpha: WH.createAlphaOutput, ve: globalThis.VideoEncoder, vf: globalThis.VideoFrame };
  const outputs = [], captures = [], ready = new Map(), disposed = [], groups = new Map(), ctl = new AbortController();
  let nextJob = 0;
  const engine = (source = doc, isRoot = false) => {
    const id = isRoot ? 0 : ++nextJob;
    let current = source, plan = F.trivialPlan(source);
    return { fork: () => engine(current), get plan() { return plan; }, setDoc(d) { current = d; plan = F.trivialPlan(d); },
      async prepare() {}, async mediaReady(t) { ready.set(id, t); },
      renderFrame(surface, t, ro) {
        assert.equal(ready.size, 2, 'both forks are ready before any output renders');
        assert.ok([...ready.values()].every((at) => at === t), 'the shared source cannot advance before the frame barrier');
        surface.canvas.snapshot = { t, job: id, backdrop: ro.backdrop, layers: ro.layers || 'all' };
      }, dispose() { disposed.push(id); } };
  };
  const canvas = { create() { return { canvas: {}, ctx: {} }; } };
  const gate = (key, value) => new Promise((resolve, reject) => {
    let group = groups.get(key);
    if (!group) { group = []; groups.set(key, group); }
    group.push({ resolve, reject, value });
    if (group.length === 4) {
      for (const task of group) {
        if (options.failure && key === 'frame0' && task.value === 1) task.reject(new S.ExportError('encode', 'independent encoder failed'));
        else task.resolve();
      }
    } else setImmediate(() => {
      if (group.length !== 4) reject(new Error('an independent encoder or sink wait prevented the other outputs from receiving this frame'));
    });
  });
  const makeOutput = (opts) => {
    const index = outputs.length;
    const out = { sink: opts.sink, closed: false, failure: null, frames: 0,
      acceleration: { requested: 'auto', selected: 'no-preference', fallback: false },
      async frame(i, surface) {
        const source = surface.canvas || surface;
        captures.push({ index, i, snapshot: Object.assign({}, source.snapshot) });
        out.frames++;
        await gate('frame' + i, index);
      },
      async flush() { await gate('flush', index); },
      async end() { await opts.sink.write(Uint8Array.from([index, out.frames])); return opts.sink.close(); },
      close() { out.closed = true; },
    };
    outputs.push(out); return out;
  };
  J.createMp4Output = WH.createAlphaOutput = makeOutput;
  globalThis.VideoEncoder = class { static async isConfigSupported(config) { return { supported: true, config }; } };
  globalThis.VideoFrame = class {};
  try {
    let result = null, error = null;
    try { result = await KIT.exportKit({ engine: engine(doc, true), doc, audio: null, canvas, signal: ctl.signal,
      onProgress(p) { if (options.cancel && p.i === 1) ctl.abort(); } }); } catch (e) { error = e; }
    return { result, error, outputs, captures, disposed };
  } finally {
    J.createMp4Output = saved.mp4; WH.createAlphaOutput = saved.alpha;
    if (saved.ve === undefined) delete globalThis.VideoEncoder; else globalThis.VideoEncoder = saved.ve;
    if (saved.vf === undefined) delete globalThis.VideoFrame; else globalThis.VideoFrame = saved.vf;
  }
}

test('Filmora: independent encoders and sinks receive each frame before waiting; snapshots and media barriers remain exact', async () => {
  const r = await run();
  assert.equal(r.error, null);
  assert.equal(r.result.frames, 2);
  assert.deepEqual(r.outputs.map((x) => x.frames), [2, 2, 2, 2]);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(r.captures.filter((x) => x.i === i).map((x) => x.snapshot), [
      { t: i / 30, job: 1, backdrop: 'scene', layers: 'all' },
      { t: i / 30, job: 1, backdrop: 'clear', layers: 'all' },
      { t: i / 30, job: 1, backdrop: 'scene', layers: 'ground' },
      { t: i / 30, job: 2, backdrop: 'chroma', layers: 'all' },
    ]);
  }
  assert.deepEqual(r.disposed, [1, 2]);
});

test('Filmora: an independent output failure aborts every sink and closes every output and fork', async () => {
  const r = await run({ failure: true });
  assert.equal(r.error.code, 'encode');
  assert.deepEqual(r.outputs.map((x) => [x.closed, x.frames, x.sink.bytes]), Array.from({ length: 4 }, () => [true, 1, 0]));
  assert.deepEqual(r.disposed, [1, 2]);
});

test('Filmora: cancellation at a completed frame leaves all independent outputs at that boundary and removes their partial data', async () => {
  const r = await run({ cancel: true });
  assert.equal(r.error.code, 'cancelled');
  assert.deepEqual(r.outputs.map((x) => [x.closed, x.frames, x.sink.bytes]), Array.from({ length: 4 }, () => [true, 1, 0]));
  assert.deepEqual(r.disposed, [1, 2]);
});
