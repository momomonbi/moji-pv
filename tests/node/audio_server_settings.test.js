/* 文字PVメーカー v2 — original work. Audio server device/tab storage, manual health checks and stale request ownership. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const UI = MV.use('ui/audio_server_settings');
const CLIENT = MV.use('export/host/audio_server');
const HEALTH = { service: 'moji-pv-audio', version: 1, targetBitrate: 320000, maxUploadBytes: 1024 * 1024, authChecked: false };

function storage(entries) {
  const values = new Map(entries || []);
  return { values, getItem(k) { return values.get(k) || null; }, setItem(k, v) { values.set(k, String(v)); }, removeItem(k) { values.delete(k); } };
}

function fixture(check, stores) {
  const local = stores && stores.local || storage();
  const session = stores && stores.session || storage();
  const calls = [], events = [], changes = [];
  const app = { doc: { output: { audioEncoding: 'server' } }, store: { rev: 5 },
    bus: { emit(...event) { events.push(event); } },
    svc: { exporter: { audioServer: { validateConfig: CLIENT.validateConfig,
      async check(config, opts) { calls.push({ config, signal: opts.signal }); return check ? check(config, opts) : HEALTH; },
    } } },
  };
  const controller = UI.createController(app, { local, session, onChange(s) { changes.push(s); } });
  return { app, controller, local, session, calls, events, changes };
}

test('getConfig alone initializes from device URL and tab token without a network, project write or mutable shared return', () => {
  const local = storage([[UI.URL_KEY, ' https://audio.example/service/ ']]);
  const session = storage([[UI.TOKEN_KEY, 'tab-only-value']]);
  const savedLocal = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const savedSession = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: local });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: session });
    const app = { doc: { output: {} } };
    const before = JSON.stringify(app.doc);
    assert.deepEqual(UI.getConfig(app), { url: 'https://audio.example/service/', token: 'tab-only-value' });
    const copy = UI.getConfig(app); copy.url = 'https://other.example'; copy.token = 'edited copy';
    assert.deepEqual(UI.getConfig(app), { url: 'https://audio.example/service/', token: 'tab-only-value' });
    assert.equal(JSON.stringify(app.doc), before);
  } finally {
    if (savedLocal) Object.defineProperty(globalThis, 'localStorage', savedLocal); else delete globalThis.localStorage;
    if (savedSession) Object.defineProperty(globalThis, 'sessionStorage', savedSession); else delete globalThis.sessionStorage;
  }
});

test('only URL is stored on the device; tokens are tab-only, clearing removes keys, and events contain no credentials', () => {
  const { app, controller, local, session, calls, events } = fixture();
  const doc = JSON.stringify(app.doc);
  controller.setConfig({ url: ' https://audio.example/service/ ', token: ' tab-only-value ' });
  assert.deepEqual(UI.getConfig(app), { url: 'https://audio.example/service/', token: 'tab-only-value' });
  assert.deepEqual([...local.values], [[UI.URL_KEY, 'https://audio.example/service/']]);
  assert.deepEqual([...session.values], [[UI.TOKEN_KEY, 'tab-only-value']]);
  assert.deepEqual(events, [['audio.server']]);
  assert.equal(JSON.stringify(app.doc), doc);
  assert.equal(app.store.rev, 5);
  assert.equal(calls.length, 0, 'editing or opening settings never starts a request');
  controller.setConfig({ token: '' });
  assert.equal(session.values.has(UI.TOKEN_KEY), false);
  assert.equal(UI.getConfig(app).token, '');
  controller.setConfig({ url: '' });
  assert.equal(local.values.has(UI.URL_KEY), false);
  assert.ok(events.every((event) => event.length === 1 && event[0] === 'audio.server'));
  controller.destroy();
});

test('invalid endpoints are never persisted or checked, and cannot silently restore a previous destination after reload', async () => {
  for (const url of ['http://audio.example', 'https://user:pass@audio.example', 'https://audio.example?token=hidden',
    'https://audio.example#secret', 'https://audio.example?', 'https://audio.example#', 'not a URL']) {
    const { app, controller, local, calls } = fixture();
    controller.setConfig({ url: 'https://old.example' });
    controller.setConfig({ url });
    assert.equal(UI.getConfig(app).url, url);
    assert.equal(local.values.has(UI.URL_KEY), false);
    assert.equal(await controller.check(), false);
    assert.equal(controller.state.note, 'exp.server.configError');
    assert.equal(calls.length, 0);
    controller.destroy();
  }
  const local = storage([[UI.URL_KEY, 'https://user:pass@audio.example']]);
  const { app, controller } = fixture(null, { local, session: storage() });
  assert.equal(UI.getConfig(app).url, '');
  assert.equal(local.values.has(UI.URL_KEY), false);
  controller.destroy();
});

test('manual health checks use normalized client configuration, allow an empty token and make no authentication claim', async () => {
  const { controller, calls } = fixture();
  controller.setConfig({ url: 'https://audio.example/service/' });
  assert.equal(calls.length, 0);
  assert.equal(await controller.check(), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].config, { url: 'https://audio.example/service', token: '' });
  assert.equal(controller.state.phase, 'ready');
  assert.equal(controller.state.note, 'exp.server.ready');
  assert.equal(controller.state.health.authChecked, false);
  assert.equal(controller.state.health.targetBitrate, 320000);
  assert.equal(calls[0].signal.aborted, false);
  controller.destroy();
});

test('editing a pending URL or token aborts its check and late results cannot overwrite the latest check', async () => {
  for (const field of ['url', 'token']) {
    const pending = [];
    const { controller, calls } = fixture(() => new Promise((resolve) => pending.push(resolve)));
    controller.setConfig({ url: 'https://audio.example', token: 'first-tab-value' });
    const first = controller.check();
    assert.equal(controller.state.phase, 'checking');
    assert.equal(await controller.check(), false, 'the check button cannot start concurrent checks');
    controller.setConfig({ [field]: field === 'url' ? 'https://new.example' : 'new-tab-value' });
    assert.equal(calls[0].signal.aborted, true);
    assert.equal(controller.state.phase, 'idle');
    assert.equal(controller.state.note, 'exp.server.changed');
    const second = controller.check();
    pending[0](HEALTH);
    assert.equal(await first, false);
    assert.equal(controller.state.phase, 'checking');
    assert.equal(controller.busy, true);
    pending[1](HEALTH);
    assert.equal(await second, true);
    assert.equal(controller.state.phase, 'ready');
    controller.destroy();
  }
});

test('storage failures preserve current in-memory settings with visible failure flags, including clearing a token', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const { app, controller } = fixture(null, { local: broken, session: broken });
  controller.setConfig({ url: 'https://audio.example', token: 'tab-only-value' });
  assert.deepEqual(UI.getConfig(app), { url: 'https://audio.example', token: 'tab-only-value' });
  assert.deepEqual(controller.persistence, { urlFailed: true, tokenFailed: true });
  controller.setConfig({ token: '' });
  assert.equal(UI.getConfig(app).token, '');
  assert.equal(controller.persistence.tokenFailed, true);
  controller.destroy();
});

test('errors use fixed translated keys and never retain unsafe response messages or tokens', async () => {
  for (const [code, note] of [['audio-server-network', 'exp.server.networkError'], ['audio-server-timeout', 'exp.server.timeout'],
    ['audio-server-response', 'exp.server.responseError'], ['audio-server-convert', 'exp.server.error']]) {
    const { controller } = fixture(async () => { throw Object.assign(new Error('unsafe remote body: tab-only-value'), { code }); });
    controller.setConfig({ url: 'https://audio.example', token: 'tab-only-value' });
    assert.equal(await controller.check(), false);
    assert.deepEqual(controller.state, { phase: 'error', note, health: null });
    assert.equal(JSON.stringify(controller.state).includes('tab-only-value'), false);
    controller.destroy();
  }
  const { controller, calls } = fixture();
  controller.setConfig({ url: 'https://audio.example', token: 'has spaces' });
  assert.equal(await controller.check(), false);
  assert.equal(controller.state.note, 'exp.server.tokenError');
  assert.equal(calls.length, 0);
  controller.destroy();
});

test('destroy aborts and ignores late results; another mount of the same app retains settings without reviving old listeners', async () => {
  let finish;
  const { app, controller, local, session, calls, changes } = fixture(() => new Promise((resolve) => { finish = resolve; }));
  controller.setConfig({ url: 'https://audio.example', token: 'tab-only-value' });
  const task = controller.check();
  const count = changes.length;
  controller.destroy();
  assert.equal(calls[0].signal.aborted, true);
  finish(HEALTH);
  assert.equal(await task, false);
  assert.equal(changes.length, count);
  const next = UI.createController(app, { local, session });
  assert.deepEqual(next.getConfig(), { url: 'https://audio.example', token: 'tab-only-value' });
  next.setConfig({ token: '' });
  assert.equal(changes.length, count);
  assert.equal(await controller.check(), false);
  next.destroy();
});
