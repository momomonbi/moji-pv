/* 文字PVメーカー v2 — original work. External AAC mode: saved preference, effective capabilities, estimates and preflight. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');
const corpus = require('../helpers/corpus');
const api = load();
const D = api.use('core/doc'), C = api.use('core/commands'), M = api.use('core/migrate'), ST = api.use('core/store');
const OUT = api.use('ui/output'), S = api.use('export/schedule'), WAV = api.use('audio/wav');
const PREVIEW = api.use('ui/export_quality_preview');
const READY = { webcodecs: true, codec: 'avc1.640028', vp9Codec: 'vp09.00.40.08', audioCodec: null,
  audioBitrate: 192000, audioBitrateMode: 'constant', audioServerConfigured: true, songReady: true,
  fsAccess: true, dirAccess: true, fontsReady: true };
function doc(format = 'mp4') {
  const d = D.defaultDoc();
  d.song = corpus.songDigest();
  Object.assign(d.output, { format, short: 720, fps: 30, audio: true, audioEncoding: 'server' });
  return d;
}
const plan = { duration: 10, design: { aspect: '16:9' }, cuts: [], lines: [], seams: [], grounds: [], rigs: [], warnings: [] };
const codes = (items) => items.map((x) => x.code);

test('older works without an audio encoding choice keep browser audio and all original values on open/save', () => {
  const old = doc(); delete old.output.audioEncoding;
  const before = JSON.stringify(old), normalized = D.normalize(old);
  assert.deepEqual(D.validate(old), []);
  assert.equal(normalized.output.audioEncoding, 'browser');
  assert.deepEqual(normalized.output, { ...old.output, audioEncoding: 'browser' });
  assert.equal(normalized.song, old.song);
  assert.equal(normalized.sheet, old.sheet);
  assert.equal(JSON.stringify(old), before);
  assert.deepEqual(M.parseFile(D.serialize({ doc: old })).doc, normalized);
  for (const name of corpus.ALL_PROJECTS) {
    const opened = M.parseFile(corpus.projectText(name));
    assert.equal(opened.doc.output.audioEncoding, 'browser', name);
    assert.deepEqual(M.parseFile(D.serialize(opened)).doc, opened.doc, name + ' keeps the complete work');
  }
});

test('browser/server mode is an undoable saved preference, with no endpoint or credential in the document', () => {
  const original = doc(); original.output.audioEncoding = 'browser';
  const store = ST.createStore({ doc: original, reduce: C.reduce });
  assert.equal(store.dispatch({ t: 'output.set', key: 'audioEncoding', v: 'browser' }), 0);
  store.dispatch({ t: 'output.set', key: 'audioEncoding', v: 'server' });
  const selected = store.doc;
  assert.deepEqual(selected, { ...original, output: { ...original.output, audioEncoding: 'server' } });
  assert.deepEqual(M.parseFile(D.serialize({ doc: selected })).doc, selected);
  const outputKeys = Object.keys(JSON.parse(D.serialize({ doc: selected })).doc.output);
  assert.equal(outputKeys[outputKeys.indexOf('audio') + 1], 'audioEncoding');
  assert.ok(!outputKeys.some((key) => /url|token|endpoint|credential|key/i.test(key)));
  assert.throws(() => C.reduce(selected, { t: 'output.set', key: 'audioServerUrl', v: 'https://private.example' }), { code: 'payload' });
  assert.equal(store.list().filter((e) => e.done).length, 1);
  store.undo(); assert.equal(store.doc, original);
  store.redo(); assert.equal(store.doc, selected);
});

test('unsupported mode values are rejected by validation, file opening and commands without changing the work', () => {
  for (const value of ['external', 'aac', '', null, false, 320000, [], {}]) {
    const invalid = doc(); invalid.output.audioEncoding = value;
    assert.ok(D.validate(invalid).some((problem) => problem.includes('output.audioEncoding')), String(value));
    assert.throws(() => M.parseFile(D.serialize({ doc: invalid })), { code: 'invalid' });
    const original = doc(), store = ST.createStore({ doc: original, reduce: C.reduce });
    assert.throws(() => store.dispatch({ t: 'output.set', key: 'audioEncoding', v: value }), { code: 'payload' });
    assert.equal(store.doc, original);
    assert.deepEqual(store.list(), []);
  }
});

test('server processing is active only for MP4/Filmora with a song and sound enabled', () => {
  for (const format of D.OUTPUT_CHOICES.format) {
    const d = doc(format), active = format === 'mp4' || format === 'kit';
    assert.equal(S.usesAudioServer(d), active);
    assert.equal(OUT.usesAudioServer(d), active);
    for (const override of [{ audio: false }, { audioEncoding: 'browser' }]) {
      assert.equal(OUT.usesAudioServer({ ...d, output: { ...d.output, ...override } }), false);
    }
    assert.equal(OUT.usesAudioServer({ ...d, song: null }), false);
  }
  assert.equal(OUT.usesAudioServer(null), false);
});

test('server capabilities report an AAC 320 target instead of browser fallback/CBR without mutating the environment', () => {
  const d = doc(), env = { ...READY, audioCodec: 'opus', custom: { id: 7 } }, before = JSON.stringify(env);
  const e = OUT.audioEnv(d, env);
  assert.deepEqual([e.audioCodec, e.audioBitrate, e.audioBitrateMode, e.audioSource], ['mp4a.40.2', 320000, null, 'server']);
  assert.equal(e.custom, env.custom);
  assert.equal(JSON.stringify(env), before);
  assert.deepEqual(OUT.audioInfo(d, env), { state: 'ready', codec: 'mp4a.40.2', bitrate: 320000, mode: null,
    preferred: 320000, fallback: false, source: 'server' });
  assert.equal(OUT.audioEnv({ ...d, output: { ...d.output, audioEncoding: 'browser' } }, env), env);
  assert.equal(OUT.audioInfo(d, { ...env, songReady: false }).state, 'missing');
});

test('MP4 and all quality-card estimates include AAC 320 even when browser audio cannot encode', () => {
  const d = doc(), estimate = OUT.summary(d, plan, READY), size = S.outputSize('16:9', 720);
  assert.equal(estimate.params.bytes, S.estimateBytes(10, S.bitrate(size.w, size.h, 30, d.output.quality), true, 320000));
  const browser = { ...d, output: { ...d.output, audioEncoding: 'browser' } };
  const silent = OUT.summary(browser, plan, READY);
  assert.ok(estimate.params.bytes > silent.params.bytes, 'a missing native audio codec does not make the server estimate silent');
  for (const row of OUT.qualityOptions(d, plan, READY).rows) {
    assert.equal(row.bytes, S.estimateBytes(10, S.bitrate(size.w, size.h, 30, row.quality), true, 320000), row.quality);
  }
});

test('Filmora estimates and fixed rows use server AAC and never add the fallback WAV', () => {
  const d = doc('kit');
  for (const audioCodec of [undefined, null, 'opus', 'mp4a.40.2']) {
    const env = { ...READY, audioCodec }, files = S.kitFiles(d, plan, env);
    assert.ok(!files.some((f) => f.kind === 'wav'), String(audioCodec));
    assert.deepEqual(OUT.kitAlways(d, plan, env), ['readme']);
    assert.equal(OUT.summary(d, plan, env).params.bytes, files.reduce((sum, f) => sum + f.est, 0));
    assert.equal(OUT.audioInfo(d, env).source, 'server');
    const size = S.outputSize('16:9', 720);
    assert.equal(files[0].est, S.estimateBytes(10, S.bitrate(size.w, size.h, 30, d.output.quality), true, 320000));
  }
});

test('server preflight blocks missing configuration and replaces unavailable browser audio warnings', () => {
  for (const format of ['mp4', 'kit']) {
    const d = doc(format), good = S.preflight(d, plan, READY);
    assert.ok(!codes(good).some((code) => ['no-audio-codec', 'opus-audio', 'kit-wav', 'audio-server-config'].includes(code)), format);
    const bad = S.preflight(d, plan, { ...READY, audioServerConfigured: false });
    assert.equal(bad.find((c) => c.code === 'audio-server-config').level, 'block');
    assert.ok(!codes(bad).includes('no-audio-codec'));
    const browser = { ...d, output: { ...d.output, audioEncoding: 'browser' } };
    assert.ok(!codes(S.preflight(browser, plan, { ...READY, audioServerConfigured: false })).includes('audio-server-config'));
    const silent = { ...d, output: { ...d.output, audio: false } };
    assert.ok(!codes(S.preflight(silent, plan, { ...READY, audioServerConfigured: false })).includes('audio-server-config'));
    const missing = S.preflight(d, plan, { ...READY, songReady: false }).find((c) => c.code === 'song-missing');
    assert.equal(missing.level, 'block');
    assert.equal(OUT.checkKey(missing), 'exp.pre.audio-server-song-missing');
    assert.equal(S.preflight(browser, plan, { ...READY, songReady: false }).find((c) => c.code === 'song-missing').level, 'warn');
  }
});

test('external MP4 buffers include the silent video, source WAV and returned AAC movie even with direct disk output', () => {
  const d = doc(), size = S.outputSize('16:9', d.output.short), bits = S.bitrate(size.w, size.h, 30, d.output.quality);
  const bytes = S.estimateBytes(10, bits, false) + WAV.HEADER_BYTES + 48000 * 10 * 4 + S.estimateBytes(10, bits, true, 320000);
  for (const fsAccess of [true, false]) {
    const item = S.preflight(d, plan, { ...READY, fsAccess }).find((c) => c.code === 'memory');
    assert.equal(item.params.bytes, bytes, 'external buffers for fsAccess=' + fsAccess);
  }
  const big = { ...d, output: { ...d.output, short: 2160, fps: 60, quality: 'max' } }, long = { ...plan, duration: 600 };
  assert.equal(S.preflight(big, long, READY).find((c) => c.code === 'memory').level, 'confirm');
});

test('Filmora disk output counts transient main-movie upload buffers while ZIP also counts its auxiliary files', () => {
  const d = doc('kit'), disk = S.preflight(d, plan, READY).find((c) => c.code === 'kit-memory');
  const zip = S.preflight(d, plan, { ...READY, dirAccess: false }).find((c) => c.code === 'kit-memory');
  const files = S.kitFiles(d, plan, READY);
  assert.equal(zip.params.bytes - disk.params.bytes, files.slice(1).reduce((sum, f) => sum + f.est, 0));
  const missing = S.preflight(d, plan, { ...READY, songReady: false });
  assert.ok(!codes(missing).includes('kit-memory'), 'missing source does not create an external upload estimate');
});

test('silent quality comparison remains valid when only the audio encoding preference changes', () => {
  const d = doc(), browser = { ...d, output: { ...d.output, audioEncoding: 'browser' } };
  assert.equal(PREVIEW.signature(d, plan), PREVIEW.signature(browser, plan));
});

test('every external-audio failure has its specific message key', () => {
  for (const [code, tail] of Object.entries({ config: 'Config', auth: 'Auth', network: 'Network', 'too-large': 'TooLarge',
    response: 'Response', media: 'Media', busy: 'Busy', timeout: 'Timeout', convert: 'Convert' })) {
    assert.equal(OUT.errorKey('audio-server-' + code), 'err.exp.audioServer' + tail);
  }
});
