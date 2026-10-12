/* 文字PVメーカー v2 — original work. Built-in AAC preferences, compatibility, capacities and output math. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');
const corpus = require('../helpers/corpus');
const api = load();
const D = api.use('core/doc'), C = api.use('core/commands'), M = api.use('core/migrate'), ST = api.use('core/store');
const OUT = api.use('ui/output'), S = api.use('export/schedule'), WAV = api.use('audio/wav');
const P = api.use('ui/export_quality_preview');
const READY = { webcodecs: true, codec: 'avc1.640028', vp9Codec: 'vp09.00.40.08', audioCodec: null,
  audioBitrate: 192000, audioBitrateMode: 'constant', audioServerConfigured: false, localAudioAvailable: true,
  songReady: true, fsAccess: true, dirAccess: true, fontsReady: true };
function doc(format = 'mp4') {
  const d = D.defaultDoc();
  d.song = corpus.songDigest();
  Object.assign(d.output, { format, short: 720, fps: 30 });
  return d;
}
const plan = { duration: 10, design: { aspect: '16:9' }, cuts: [], lines: [], seams: [], grounds: [], rigs: [], warnings: [] };
const codes = (items) => items.map((x) => x.code);

test('new works default to built-in AAC while older missing/native/server choices remain unchanged on opening', () => {
  assert.equal(D.defaultDoc().output.audioEncoding, 'local');
  assert.deepEqual(D.validate(D.defaultDoc()), []);
  const old = doc(); delete old.output.audioEncoding;
  const before = JSON.stringify(old);
  assert.equal(D.normalize(old).output.audioEncoding, 'browser');
  assert.equal(M.parseFile(D.serialize({ doc: old })).doc.output.audioEncoding, 'browser');
  assert.equal(JSON.stringify(old), before);
  for (const mode of D.OUTPUT_CHOICES.audioEncoding) {
    const d = doc(); d.output.audioEncoding = mode;
    assert.equal(D.normalize(d), d, mode + ' normalization is unchanged');
    assert.deepEqual(M.parseFile(D.serialize({ doc: d })).doc, d, mode + ' entire save/open round trip');
  }
  for (const name of corpus.ALL_PROJECTS) assert.equal(M.parseFile(corpus.projectText(name)).doc.output.audioEncoding, 'browser', name);
});

test('switching from an existing browser/server preference to built-in AAC is one undoable output edit', () => {
  for (const mode of ['browser', 'server']) {
    const original = doc(); original.output.audioEncoding = mode;
    const store = ST.createStore({ doc: original, reduce: C.reduce });
    store.dispatch({ t: 'output.set', key: 'audioEncoding', v: 'local' });
    const selected = store.doc;
    assert.deepEqual(selected, { ...original, output: { ...original.output, audioEncoding: 'local' } });
    assert.equal(store.list().filter((e) => e.done).length, 1);
    assert.deepEqual(M.parseFile(D.serialize({ doc: selected })).doc, selected);
    store.undo(); assert.equal(store.doc, original);
    store.redo(); assert.equal(store.doc, selected);
    const rev = store.rev;
    store.dispatch({ t: 'output.set', key: 'audioEncoding', v: 'local' });
    assert.equal(store.rev, rev, 'choosing the existing mode has no undo entry');
  }
});

test('dedicated local audio is active only for enabled MP4/Filmora songs and has no server dependency', () => {
  for (const format of D.OUTPUT_CHOICES.format) {
    const d = doc(format), active = format === 'mp4' || format === 'kit';
    assert.equal(OUT.usesLocalAudio(d), active);
    assert.equal(OUT.usesDedicatedAudio(d), active);
    assert.equal(OUT.usesAudioServer(d), false);
    assert.equal(OUT.usesLocalAudio({ ...d, song: null }), false);
    assert.equal(OUT.usesLocalAudio({ ...d, output: { ...d.output, audio: false } }), false);
  }
  const local = doc();
  assert.ok(!codes(S.preflight(local, plan, READY)).includes('audio-server-config'), 'no URL or token is needed');
  assert.ok(!codes(S.preflight(local, plan, READY)).includes('no-audio-codec'), 'native audio availability does not restrict built-in AAC');
});

test('built-in audio reports AAC 320 as a target and retains the native environment for an explicit native choice', () => {
  const d = doc(), before = JSON.stringify(READY), env = OUT.audioEnv(d, READY);
  assert.deepEqual([env.audioCodec, env.audioBitrate, env.audioBitrateMode, env.audioSource], ['mp4a.40.2', 320000, null, 'local']);
  assert.equal(JSON.stringify(READY), before);
  assert.deepEqual(OUT.audioInfo(d, READY), { state: 'ready', codec: 'mp4a.40.2', bitrate: 320000, mode: null,
    preferred: 320000, fallback: false, source: 'local' });
  assert.equal(OUT.audioEnv({ ...d, output: { ...d.output, audioEncoding: 'browser' } }, READY), READY);
  assert.equal(OUT.audioInfo({ ...d, song: null }, READY).state, 'no-song');
});

test('all quality estimates include AAC 320, and Filmora fixed rows never add a native fallback WAV', () => {
  for (const format of ['mp4', 'kit']) {
    const d = doc(format), size = S.outputSize('16:9', 720);
    assert.equal(OUT.audioInfo(d, READY).source, 'local');
    if (format === 'mp4') for (const row of OUT.qualityOptions(d, plan, READY).rows) {
      assert.equal(row.bytes, S.estimateBytes(10, S.bitrate(size.w, size.h, 30, row.quality), true, 320000), row.quality);
    }
    else {
      const files = S.kitFiles(d, plan, READY);
      assert.ok(!files.some((f) => f.kind === 'wav'));
      assert.deepEqual(OUT.kitAlways(d, plan, READY), ['readme']);
      assert.equal(OUT.summary(d, plan, READY).params.bytes, files.reduce((sum, f) => sum + f.est, 0));
      assert.equal(files[0].est, S.estimateBytes(10, S.bitrate(size.w, size.h, 30, d.output.quality), true, 320000));
    }
  }
});

test('a host-resolved native Filmora codec keeps the actual WAV fallback even under the new default preference', () => {
  const d = doc('kit'), resolved = { ...READY, audioResolved: true, audioCodec: null };
  assert.equal(OUT.audioEnv(d, resolved), resolved);
  assert.ok(S.kitFiles(d, plan, resolved).some((f) => f.kind === 'wav'), 'the actual native execution must not lose its song');
  assert.deepEqual(OUT.kitAlways(d, plan, resolved), ['wav', 'readme']);
  assert.equal(OUT.audioInfo(d, resolved).state, 'wav');
  const actualLocal = { ...resolved, audioCodec: 'mp4a.40.2', audioBitrate: 320000, audioSource: 'local' };
  assert.ok(!S.kitFiles(d, plan, actualLocal).some((f) => f.kind === 'wav'));
  assert.equal(OUT.audioInfo(d, actualLocal).source, 'local');
});

test('missing original audio or unavailable Wasm blocks only active built-in conversion, with a truthful message', () => {
  const d = doc();
  const missing = S.preflight(d, plan, { ...READY, songReady: false }).find((i) => i.code === 'song-missing');
  assert.equal(missing.level, 'block');
  assert.equal(OUT.checkKey(missing), 'exp.pre.audio-local-song-missing');
  assert.equal(S.preflight(d, plan, { ...READY, localAudioAvailable: false }).find((i) => i.code === 'audio-local-unavailable').level, 'block');
  for (const patch of [{ audioEncoding: 'browser' }, { audio: false }, { format: 'webmAlpha' }]) {
    const changed = { ...d, output: { ...d.output, ...patch } };
    assert.ok(!codes(S.preflight(changed, plan, { ...READY, localAudioAvailable: false })).includes('audio-local-unavailable'));
  }
});

test('local memory includes three movies, exact PCM and the runtime even with disk output', () => {
  const d = doc(), size = S.outputSize('16:9', 720), movie = S.estimateBytes(10, S.bitrate(size.w, size.h, 30, d.output.quality), true, 320000);
  const bytes = movie * 3 + WAV.HEADER_BYTES + 48000 * 10 * 4 + S.LOCAL_AUDIO_RUNTIME_BYTES;
  for (const fsAccess of [true, false]) {
    const memory = S.preflight(d, plan, { ...READY, fsAccess }).find((i) => i.code === 'memory');
    assert.equal(memory.params.bytes, bytes);
  }
  const kit = doc('kit'), disk = S.preflight(kit, plan, READY).find((i) => i.code === 'kit-memory');
  const zip = S.preflight(kit, plan, { ...READY, dirAccess: false }).find((i) => i.code === 'kit-memory');
  assert.equal(disk.params.bytes, bytes);
  assert.equal(zip.params.bytes - bytes, S.kitFiles(kit, plan, READY).slice(1).reduce((sum, f) => sum + f.est, 0));
});

test('known PCM capacity and rendered-duration limits block before rendering, but size estimates never hard-block', () => {
  const d = doc(), pcmLimit = S.LOCAL_AUDIO_MAX_INPUT_BYTES;
  const maxFrames = Math.floor((pcmLimit - WAV.HEADER_BYTES) / (48000 / 30 * 4));
  const fits = { ...plan, duration: maxFrames / 30 }, tooLong = { ...plan, duration: (maxFrames + 1) / 30 };
  assert.ok(!codes(S.preflight(d, fits, READY)).includes('audio-local-too-large'));
  assert.equal(S.preflight(d, tooLong, READY).find((i) => i.code === 'audio-local-too-large').level, 'block');
  const length = { ...plan, duration: S.LOCAL_AUDIO_MAX_SECONDS + 0.001 };
  assert.ok(codes(S.preflight(d, length, READY)).includes('audio-local-too-large'));
  const detailed = { ...d, output: { ...d.output, short: 2160, fps: 60, quality: 'max' } }, simple = { ...plan, duration: 60 };
  const items = S.preflight(detailed, simple, READY);
  assert.ok(items.find((i) => i.code === 'memory').params.bytes > S.LOCAL_AUDIO_MAX_INPUT_BYTES);
  assert.ok(!items.some((i) => i.level === 'block'), 'a conservative video estimate cannot reject possibly small actual output');
});

test('local capacity follows the chosen export range rather than rejecting a long song with a short selected clip', () => {
  const d = doc(), long = { ...plan, duration: 5000 };
  d.output.range = { t0: 4000, t1: 4010 };
  assert.ok(!codes(S.preflight(d, long, READY)).includes('audio-local-too-large'));
  assert.equal(OUT.summary(d, long, READY).params.seconds, 10);
});

test('switching audio processing never invalidates the silent encoded picture-comparison clips', () => {
  const d = doc(), sig = P.signature(d, plan);
  for (const audioEncoding of ['browser', 'local', 'server']) assert.equal(P.signature({ ...d, output: { ...d.output, audioEncoding } }, plan), sig);
});

test('built-in AAC errors each retain a specific actionable message', () => {
  for (const [code, suffix] of Object.entries({ unavailable: 'Unavailable', load: 'Load', memory: 'Memory', 'too-large': 'TooLarge',
    convert: 'Convert', response: 'Response', busy: 'Busy', media: 'Media' })) {
    assert.equal(OUT.errorKey('audio-local-' + code), 'err.exp.audioLocal' + suffix);
  }
});
