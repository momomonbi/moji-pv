/* 文字PVメーカー v2 — original work. The real-encode comparison's range, editor isolation, stale work and Blob ownership. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const P = MV.use('ui/export_quality_preview');
const D = MV.use('core/doc');
const S = MV.use('export/schedule');

function bus() {
  const events = new Map();
  return {
    on(name, fn) {
      if (!events.has(name)) events.set(name, new Set());
      events.get(name).add(fn);
      return () => events.get(name).delete(fn);
    },
    emit(name, payload) { for (const fn of [...events.get(name) || []]) fn(payload); },
    listeners() { return [...events.values()].reduce((n, list) => n + list.size, 0); },
  };
}

function fixture(encode) {
  const doc = D.defaultDoc();
  doc.sheet.rows = [{ id: 'r1', src: 'The same scene in every quality' }];
  doc.sheet.next = 2;
  const log = { forks: 0, mainWrites: 0, sourceDoc: null, disposed: 0, exports: [], created: [], revoked: [], notifications: [] };
  const app = {
    doc, plan: { duration: 12, design: { aspect: '16:9' }, lines: [{}] }, view: { state: { time: 5.25 } },
    bus: bus(), store: bus(), env: () => ({ webcodecs: true }), exportProbe: () => ({ codec: 'avc1.640028', vp9Codec: 'vp09.00.31.08' }),
    exportState: () => ({ phase: 'idle' }),
    engine: {
      setDoc() { log.mainWrites += 1; },
      fork() {
        log.forks += 1;
        return { setDoc(d) { log.sourceDoc = d; }, dispose() { log.disposed += 1; } };
      },
    },
    svc: { exporter: {
      sink: { createMemorySink(o) { return { kind: 'memory', ...o }; } },
      mp4: { async exportVideo(o) {
        log.exports.push(o);
        if (encode) return encode(o, log);
        o.onProgress({ i: 45, N: 90 });
        return { bytes: 111 + log.exports.length, blob: new Blob(['real clip stand-in']), codec: 'avc1.640028', frames: 90 };
      } },
    } },
  };
  app.svc.exporter.webm = { exportWebm: (o) => app.svc.exporter.mp4.exportVideo(o) };
  const controller = P.createController(app, {
    urls: {
      createObjectURL(blob) { const url = 'blob:' + log.created.length; log.created.push({ url, blob }); return url; },
      revokeObjectURL(url) { log.revoked.push(url); },
    },
    onChange(s) { log.notifications.push(s.phase); },
  });
  return { app, controller, log };
}

test('comparison range stays within the selected output and uses up to three seconds near the playhead', () => {
  const doc = D.defaultDoc();
  const plan = { duration: 20 };
  assert.deepEqual(P.previewRange(doc, plan, 5.25), { t0: 5.25, t1: 8.25 });
  assert.deepEqual(P.previewRange(doc, plan, 19), { t0: 17, t1: 20 });
  assert.deepEqual(P.previewRange(doc, plan, -10), { t0: 0, t1: 3 });
  doc.output.range = { t0: 4, t1: 8 };
  assert.deepEqual(P.previewRange(doc, plan, 7), { t0: 5, t1: 8 });
  doc.output.range = { t0: 4, t1: 5.2 };
  assert.deepEqual(P.previewRange(doc, plan, Infinity), { t0: 4, t1: 5.2 });
  doc.output.range = { t0: 21, t1: 23 };
  assert.equal(P.previewRange(doc, plan, 0), null);
});

test('comparison qualities are the single shared output list, including the smallest light preset', () => {
  assert.equal(P.QUALITIES, S.QUALITY_LEVELS);
  assert.deepEqual(P.QUALITIES, ['light', 'standard', 'high', 'max']);
  assert.equal(S.bitrate(1280, 720, 30, 'light'), S.bitrate(1280, 720, 30, 'standard') / 2);
});

test('each quality uses the same committed snapshot, selected full size and fps, silent memory MP4s and no editor writes', async () => {
  const { app, controller, log } = fixture();
  app.doc = { ...app.doc, output: { ...app.doc.output, short: 2160, fps: 60, format: 'kit', quality: 'light', acceleration: 'cpu' } };
  app.plan = { ...app.plan, design: { aspect: '9:16' } };
  const original = JSON.stringify(app.doc);
  assert.equal(await controller.start(), true);
  assert.equal(controller.state.phase, 'done');
  assert.equal(log.forks, 1);
  assert.equal(log.disposed, 1);
  assert.equal(log.mainWrites, 0);
  assert.equal(log.sourceDoc, app.doc, 'a temporary try-on is replaced only on the owned source fork');
  assert.deepEqual(log.exports.map((x) => x.doc.output.quality), ['light', 'standard', 'high', 'max']);
  assert.ok(log.exports.every((x) => x.engine === log.exports[0].engine));
  for (const o of log.exports) {
    assert.deepEqual(o.doc.output.range, { t0: 5.25, t1: 8.25 });
    assert.equal(o.doc.output.short, 2160);
    assert.equal(o.doc.output.fps, 60);
    assert.equal(o.doc.output.acceleration, 'cpu');
    assert.equal(o.doc.output.format, 'mp4');
    assert.equal(o.doc.output.audio, false);
    assert.equal(o.audio, null);
    assert.equal(o.sink.type, 'video/mp4');
    assert.equal(o.signal.aborted, false);
  }
  assert.equal(JSON.stringify(app.doc), original);
  assert.equal(app.view.state.time, 5.25);
  assert.equal(app.exportState().phase, 'idle');
  assert.deepEqual([controller.state.w, controller.state.h, controller.state.fps], [2160, 3840, 60]);
  assert.deepEqual(controller.state.clips.map((x) => x.bytes), [112, 113, 114, 115]);
  controller.destroy();
  assert.deepEqual(log.revoked, ['blob:0', 'blob:1', 'blob:2', 'blob:3']);
});

test('quality, audio, names and kit extras reuse the clips; every visual or output geometry change revokes them', async () => {
  const { app, controller, log } = fixture();
  assert.equal(await controller.start(), true);
  const clips = controller.state.clips;
  app.doc = { ...app.doc, output: { ...app.doc.output, quality: 'light', audio: false, name: 'new name', kit: { bg: true } } };
  app.bus.emit('plan', { kind: 'do' });
  assert.equal(controller.state.clips, clips);
  assert.deepEqual(log.revoked, []);
  assert.equal(P.signature(app.doc, app.plan), P.signature({ ...app.doc, output: { ...app.doc.output, quality: 'max' } }, app.plan));
  for (const change of [
    (d) => ({ ...d, output: { ...d.output, short: 720 } }),
    (d) => ({ ...d, output: { ...d.output, fps: 24 } }),
    (d) => ({ ...d, output: { ...d.output, range: { t0: 1, t1: 3 } } }),
    (d) => ({ ...d, output: { ...d.output, acceleration: 'cpu' } }),
    (d) => ({ ...d, look: { ...d.look, moodSeed: d.look.moodSeed + 1 } }),
    (d) => ({ ...d, media: { list: [{ id: 'a1', sha1: 'new image' }] } }),
  ]) {
    const before = controller.state.clips.map((x) => x.url);
    app.doc = change(app.doc);
    controller.update();
    assert.equal(controller.state.clips.length, 0);
    assert.ok(before.every((url) => log.revoked.includes(url)));
    assert.equal(await controller.start(), true);
  }
  controller.destroy();
});

test('older implicit auto encoding matches explicit auto, but changing processing mode invalidates a running comparison', async () => {
  let finish;
  const { app, controller, log } = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const output = { ...app.doc.output };
  delete output.acceleration;
  assert.equal(P.signature({ ...app.doc, output }, app.plan), P.signature({ ...app.doc,
    output: { ...output, acceleration: 'auto' } }, app.plan));
  const task = controller.start();
  const signal = log.exports[0].signal;
  app.doc = { ...app.doc, output: { ...app.doc.output, acceleration: 'cpu' } };
  app.store.emit('doc', { kind: 'do' });
  assert.equal(signal.aborted, true);
  finish({ bytes: 9, blob: new Blob(['old auto encode']), codec: 'avc1' });
  assert.equal(await task, false);
  assert.equal(log.created.length, 0);
  assert.equal(controller.state.note, 'exp.preview.stale');
  controller.destroy();
});

test('main export frame reports do not redraw hidden comparisons; busy transitions, probes and device changes still update', async () => {
  const { app, controller, log } = fixture();
  let phase = 'idle', probe = null;
  app.exportState = () => ({ phase });
  app.exportProbe = () => probe;
  app.bus.emit('export', { phase });
  probe = { webcodecs: true, codec: null, vp9Codec: null };
  let count = log.notifications.length;
  app.bus.emit('export', { phase });
  assert.equal(log.notifications.length, count + 1, 'a completed idle probe redraws availability');
  assert.equal(controller.availability(), 'exp.preview.codecNote');
  phase = 'running'; app.exporting = {};
  count = log.notifications.length;
  app.bus.emit('export', { phase, i: 0 });
  assert.equal(log.notifications.length, count + 1, 'beginning an export redraws the busy state');
  assert.equal(controller.availability(), 'exp.preview.busy');
  count = log.notifications.length;
  for (let i = 1; i <= 200; i++) app.bus.emit('export', { phase, i, N: 200, part: 'video' });
  assert.equal(log.notifications.length, count, 'per-frame progress causes no comparison DOM renders');
  probe = { webcodecs: true, codec: 'avc1', vp9Codec: 'vp09' };
  app.bus.emit('export', { phase });
  assert.equal(log.notifications.length, count + 1, 'a new probe is observed even during a running export');
  count = log.notifications.length;
  for (let i = 201; i <= 400; i++) app.bus.emit('export', { phase, i, N: 400, part: 'zip' });
  assert.equal(log.notifications.length, count);
  phase = 'done'; app.exporting = null;
  app.bus.emit('export', { phase });
  assert.equal(log.notifications.length, count + 1, 'finishing an export redraws availability');
  assert.equal(controller.availability(), null);
  assert.equal(await controller.start(), true);
  count = log.notifications.length;
  app.bus.emit('device', { cleared: true });
  assert.equal(controller.state.clips.length, 0);
  assert.equal(log.revoked.length, P.QUALITIES.length);
  assert.ok(log.notifications.length > count, 'device invalidation is independent of export event deduplication');
  assert.equal(await controller.start(), true);
  phase = 'running'; app.exporting = {};
  app.bus.emit('export', { phase });
  assert.equal(controller.state.note, 'exp.preview.busy');
  phase = 'idle'; app.exporting = null;
  app.bus.emit('export', { phase });
  assert.notEqual(controller.state.note, 'exp.preview.busy', 'finished exports do not leave a stale busy message');
  controller.destroy();
});

test('starting a real export cancels a live comparison once, and suppressed frame reports do not disturb cancellation', async () => {
  let finish;
  const { app, controller, log } = fixture(() => new Promise((resolve) => { finish = resolve; }));
  let phase = 'idle';
  app.exportState = () => ({ phase });
  const task = controller.start();
  const signal = log.exports[0].signal;
  phase = 'running'; app.exporting = {};
  app.bus.emit('export', { phase });
  assert.equal(signal.aborted, true);
  assert.equal(controller.state.phase, 'cancelling');
  const count = log.notifications.length;
  for (let i = 0; i < 200; i++) app.bus.emit('export', { phase, i });
  assert.equal(log.notifications.length, count);
  controller.cancel();
  assert.equal(controller.state.note, 'exp.preview.cancelled', 'explicit cancellation remains available');
  finish({ bytes: 9, blob: new Blob(['late cancelled encode']), codec: 'avc1' });
  assert.equal(await task, false);
  assert.equal(controller.state.note, 'exp.preview.cancelled');
  assert.equal(log.created.length, 0);
  phase = 'idle'; app.exporting = null;
  app.bus.emit('export', { phase });
  assert.equal(controller.availability(), null);
  controller.destroy();
});

test('cancel or a real export aborts work, drops late encoded results, and refuses a second concurrent comparison', async () => {
  for (const how of ['cancel', 'export', 'edit', 'destroy']) {
    let finish;
    const { app, controller, log } = fixture((o) => new Promise((resolve) => { finish = resolve; }));
    const task = controller.start();
    assert.equal(controller.busy, true);
    assert.equal(await controller.start(), false);
    const signal = log.exports[0].signal;
    if (how === 'cancel') controller.cancel();
    else if (how === 'export') { app.exporting = {}; app.bus.emit('export'); }
    else if (how === 'edit') {
      app.doc = { ...app.doc, look: { ...app.doc.look, seed: 2 } };
      app.store.emit('doc', { kind: 'do' });
    } else controller.destroy();
    assert.equal(signal.aborted, true);
    finish({ bytes: 12, blob: new Blob(['late']), codec: 'avc1' });
    assert.equal(await task, false);
    assert.equal(log.exports.length, 1);
    assert.equal(log.created.length, 0, 'late results acquire no Blob URL');
    assert.equal(log.disposed, 1);
    assert.equal(controller.busy, false);
    assert.equal(controller.state.clips.length, 0);
    controller.destroy();
  }
});

test('a failure after the first quality frees its URL and preserves a useful export error', async () => {
  const { controller, log } = fixture(async (o, l) => {
    if (l.exports.length === 2) throw new S.ExportError('media', 'missing photo', { name: 'portrait.png' });
    return { bytes: 9, blob: new Blob(['one']), codec: 'avc1' };
  });
  assert.equal(await controller.start(), false);
  assert.equal(controller.state.phase, 'error');
  assert.equal(controller.state.error.code, 'media');
  assert.equal(controller.state.error.detail.name, 'portrait.png');
  assert.deepEqual(log.revoked, ['blob:0']);
  assert.equal(log.disposed, 1);
  controller.destroy();
});

test('cancelling the next encode immediately frees completed private clips before the outstanding encoder settles', async () => {
  let finish, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const { controller, log } = fixture(async (o, l) => {
    if (l.exports.length === 2) {
      entered();
      return new Promise((resolve) => { finish = resolve; });
    }
    return { bytes: 9, blob: new Blob(['one']), codec: 'avc1' };
  });
  const task = controller.start();
  await waiting;
  assert.equal(log.created.length, 1);
  controller.cancel();
  assert.deepEqual(log.revoked, ['blob:0']);
  finish({ bytes: 9, blob: new Blob(['late second']), codec: 'avc1' });
  assert.equal(await task, false);
  assert.deepEqual(log.revoked, ['blob:0'], 'the immediate release is not repeated');
  controller.destroy();
});

test('lossless PNG, empty range and unsupported current video geometry never encode a false comparison', async () => {
  const { app, controller, log } = fixture();
  for (const format of ['png', 'pngAlpha']) {
    app.doc = { ...app.doc, output: { ...app.doc.output, format } };
    assert.equal(controller.availability(), 'exp.preview.unavailable');
    assert.equal(await controller.start(), false);
  }
  app.doc = { ...app.doc, output: { ...app.doc.output, format: 'mp4', range: { t0: 12, t1: 12 } } };
  assert.equal(controller.availability(), 'exp.preview.empty');
  app.doc = { ...app.doc, output: { ...app.doc.output, range: null } };
  app.exportProbe = () => ({ codec: null, anyCodec: true });
  assert.equal(controller.availability(), 'exp.preview.codecNote');
  assert.equal(await controller.start(), false);
  assert.equal(log.exports.length, 0);
  controller.destroy();
});

test('transparent comparisons use the actual WebM alpha exporter, its supported codec and WebM memory files at every quality', async () => {
  const { app, controller, log } = fixture();
  app.doc = { ...app.doc, look: { ...app.doc.look, backdrop: 'clear' }, output: { ...app.doc.output, format: 'webmAlpha' } };
  let webmCalls = 0;
  const original = app.svc.exporter.webm.exportWebm;
  app.svc.exporter.webm.exportWebm = (o) => { webmCalls += 1; return original(o); };
  app.exportProbe = () => ({ codec: null, vp9Codec: 'vp09.00.31.08' });
  assert.equal(controller.availability(), null, 'an AVC encoder is not needed for actual WebM comparison');
  assert.equal(await controller.start(), true);
  assert.equal(webmCalls, P.QUALITIES.length);
  assert.deepEqual(log.exports.map((o) => o.doc.output.quality), ['light', 'standard', 'high', 'max']);
  for (const o of log.exports) {
    assert.equal(o.doc.output.format, 'webmAlpha');
    assert.equal(o.doc.output.audio, false);
    assert.equal(o.audio, null);
    assert.equal(o.sink.type, 'video/webm');
    assert.match(o.sink.name, /\.webm$/);
  }
  assert.equal(controller.state.alpha, true);
  assert.equal(controller.state.mime, 'video/webm');
  assert.ok(controller.state.clips.every((c) => c.alpha && c.format === 'webmAlpha' && c.mime === 'video/webm'));
  app.exportProbe = () => ({ codec: 'avc1', vp9Codec: null });
  assert.equal(controller.availability(), 'exp.preview.codecNote', 'AVC support cannot substitute for alpha WebM');
  controller.destroy();
});

test('a browser that cannot play its encoded comparison gets an honest unavailable state and releases every clip', async () => {
  const { app, controller, log } = fixture();
  assert.equal(await controller.start(), true);
  controller.playbackUnavailable();
  assert.equal(controller.state.clips.length, 0);
  assert.equal(controller.state.note, 'exp.preview.playbackUnsupported');
  assert.equal(controller.availability(), 'exp.preview.playbackUnsupported');
  assert.equal(await controller.start(), false);
  assert.deepEqual(log.revoked, ['blob:0', 'blob:1', 'blob:2', 'blob:3']);
  app.doc = { ...app.doc, output: { ...app.doc.output, format: 'webmAlpha' } };
  controller.update();
  assert.equal(controller.availability(), null, 'a different output format can be compared again');
  controller.destroy();
});

test('loading the same project or clearing device media revokes previews; destruction removes every observer', async () => {
  const { app, controller, log } = fixture();
  assert.equal(await controller.start(), true);
  app.store.emit('doc', { kind: 'load' });
  assert.equal(controller.state.clips.length, 0);
  assert.equal(log.revoked.length, P.QUALITIES.length);
  assert.equal(await controller.start(), true);
  app.bus.emit('device', { cleared: true });
  assert.equal(log.revoked.length, P.QUALITIES.length * 2);
  controller.destroy();
  assert.equal(app.bus.listeners(), 0);
  assert.equal(app.store.listeners(), 0);
  const before = log.notifications.length;
  app.bus.emit('export');
  controller.update();
  assert.equal(await controller.start(), false);
  assert.equal(log.notifications.length, before);
});
