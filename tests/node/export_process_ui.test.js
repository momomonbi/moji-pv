/* 文字PVメーカー v2 — original work. Running-export explanation and actual installed encoder preferences. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const MV = load(), OUT = MV.use('ui/output'), T = MV.use('i18n/t'), STRINGS = MV.use('i18n/strings');
const state = (process, extra) => Object.assign({ phase: 'running', format: 'mp4', i: 12, N: 60, process }, extra);
const installed = (selected, extra) => Object.assign({ requested: 'gpu', selected, fallback: false }, extra);

test('actual video startup replaces converter download byte counts with the installed job frame count', () => {
  const before = state({ stage: 'audioLoading', audioSource: 'local' },
    { part: 'audioLocalLoading', i: 32232419, N: 32232419, eta: 0 });
  const after = OUT.advanceProcess(before, { stage: 'video', frameCount: 60, codec: 'avc1.640028' });
  assert.equal(after.i, 0); assert.equal(after.N, 60); assert.equal(after.eta, null); assert.equal(after.part, null);
  assert.equal(after.process.audioSource, 'local', 'sparse stage metadata retains the established audio path');
  assert.equal(after.process.codec, 'avc1.640028');
  assert.equal(before.i, 32232419, 'the previous event state is not mutated');
  assert.equal(OUT.advanceProcess(before, { stage: 'video' }).N, 0, 'missing frame metadata never reuses bytes');
});

test('real stage transitions clear old legacy phases, while sparse metadata keeps progress in that stage', () => {
  const before = state({ stage: 'audio', audioSource: 'local', acceleration: installed('prefer-hardware') },
    { part: 'audioLocal', i: 10, N: 60, eta: 2 });
  const final = OUT.advanceProcess(before, { stage: 'finalize' });
  assert.equal(final.part, null); assert.equal(final.i, 10); assert.equal(final.N, 60);
  assert.equal(final.process.acceleration.selected, 'prefer-hardware');
  assert.equal(OUT.processInfo(final).indeterminate, true);
  const same = OUT.advanceProcess(before, { audioCodec: 'mp4a.40.2' });
  assert.equal(same.part, 'audioLocal'); assert.equal(same.i, 10); assert.equal(same.eta, 2);
});

test('legacy progress gets a useful stage without inventing an installed codec or GPU preference', () => {
  const p = OUT.processInfo({ phase: 'running', i: 5, N: 60 });
  assert.equal(p.stage, 'video'); assert.equal(p.gpu, 'pending'); assert.equal(p.codec, '');
  assert.equal(p.indeterminate, false);
  assert.equal(OUT.processInfo({ phase: 'running', i: 0, N: 0 }).stage, 'prepare');
  assert.equal(OUT.processInfo(state({ audioSource: 'pending' })).stage, 'video', 'initial sparse boot metadata preserves old progress-only exporters');
  assert.equal(OUT.processInfo({ phase: 'running', part: 'audioLocalLoading' }).stage, 'audioLoading');
  assert.equal(OUT.processInfo({ phase: 'running', part: 'audioServer' }).audio, 'server');
  assert.equal(OUT.processInfo({ phase: 'running', part: 'zip', i: 1, N: 1 }).indeterminate, true);
});

test('GPU / CPU / browser preference comes from an installed output, including actual fallback', () => {
  for (const [selected, expected] of [['prefer-hardware', 'hardware'], ['prefer-software', 'software'], ['no-preference', 'browser']]) {
    const p = OUT.processInfo(state({ stage: 'video', codec: 'avc1.640028', acceleration: installed(selected) }));
    assert.equal(p.gpu, expected); assert.equal(p.codec, 'H.264');
  }
  assert.equal(OUT.processInfo(state({ stage: 'video', acceleration: installed('no-preference', { fallback: true }) })).gpu, 'fallback');
  assert.equal(OUT.processInfo(state({ stage: 'video', acceleration: { requested: 'gpu' } })).gpu, 'pending');
});

test('transparent color and alpha encoder preferences can differ', () => {
  const p = OUT.processInfo(state({ stage: 'video', codec: 'vp09.00.10.08',
    acceleration: installed('prefer-hardware', { alphaSelected: 'prefer-software' }), audioSource: 'none' }, { format: 'webmAlpha' }));
  assert.equal(p.gpu, 'mixed'); assert.equal(p.codec, 'VP9'); assert.equal(p.detailKey, 'exp.process.detail.transparent');
  assert.equal(p.routeKey, 'exp.process.route.webmSilent');
});

test('Filmora uses all installed outputs rather than hiding differences behind its main video', () => {
  const outputs = [{ kind: 'main', codec: 'avc1.640028', acceleration: installed('prefer-hardware') },
    { kind: 'overlay', codec: 'vp09.00.10.08', acceleration: installed('prefer-software') }];
  const p = OUT.processInfo(state({ stage: 'video', outputs }, { format: 'kit' }));
  assert.equal(p.gpu, 'mixed'); assert.equal(p.codec, 'H.264 / VP9');
  assert.deepEqual(p.outputs.map((o) => o.kind), ['main', 'overlay']);
  assert.equal(p.routeKey, 'exp.process.route.kit');
});

test('local and server audio routes survive their silent intermediate video and captured outer format', () => {
  for (const audioRoute of ['local', 'server']) {
    const p = OUT.processInfo(state({ stage: 'mux', format: 'mp4', temporary: true,
      audioSource: null, audioCodec: null, codec: 'avc1.640028', acceleration: installed('prefer-hardware') }, { audioRoute }));
    assert.equal(p.audio, audioRoute); assert.equal(p.routeKey, 'exp.process.route.' + audioRoute);
    assert.equal(p.detailKey, 'exp.process.detail.muxTemporary'); assert.equal(p.gpu, 'hardware');
    assert.equal(p.indeterminate, true);
  }
  const kit = OUT.processInfo(state({ stage: 'video', format: 'mp4', temporary: true, audioSource: null }, { format: 'kit', audioRoute: 'local' }));
  assert.equal(kit.format, 'kit'); assert.equal(kit.routeKey, 'exp.process.route.kit'); assert.equal(kit.audio, 'local');
});

test('native unsupported audio is omitted, while Filmora WAV fallback is explicit', () => {
  const silent = OUT.processInfo(state({ stage: 'video', audioSource: null, audioCodec: null }, { audioRoute: 'browser' }));
  assert.equal(silent.audio, 'none'); assert.equal(silent.routeKey, 'exp.process.route.silent');
  const pendingWav = OUT.processInfo(state({ stage: 'video', audioSource: null, audioCodec: null,
    codec: 'avc1.640028' }, { format: 'kit', audioRoute: 'browser' }));
  assert.equal(pendingWav.audio, 'wav', 'installed unsupported AAC confirms the set’s later original-song WAV');
  assert.equal(pendingWav.codec, 'H.264', 'a separate WAV never changes the video codec');
  assert.equal(OUT.processInfo(state({ stage: 'video', audioSource: null, audioCodec: null },
    { format: 'kit', audioRoute: 'none' })).audio, 'none', 'a set without the original song does not promise a WAV');
  assert.equal(OUT.processInfo(state({ stage: 'prepare', audioSource: 'pending' },
    { format: 'kit', audioRoute: 'browser' })).audio, 'pending', 'pending support is not an actual fallback');
  const wav = OUT.processInfo(state({ stage: 'files', audioSource: 'wav', audioCodec: 'pcm-s16le' }, { format: 'kit' }));
  assert.equal(wav.audio, 'wav'); assert.equal(wav.audioCodec, 'PCM');
  const opus = OUT.processInfo(state({ stage: 'audio', audioSource: 'browser', audioCodec: 'opus' }, { format: 'webmAlpha' }));
  assert.equal(opus.audioCodec, 'Opus'); assert.equal(opus.detailKey, 'exp.process.detail.audio');
});

test('local CPU audio stage retains video metadata without claiming ongoing GPU use', () => {
  const p = OUT.processInfo(state({ stage: 'audio', backend: 'ffmpeg', audioSource: 'local', audioExecution: 'cpu',
    audioCodec: 'mp4a.40.2', codec: 'avc1.640028', acceleration: installed('prefer-hardware') }, { audioRoute: 'local' }));
  assert.equal(p.stage, 'audio'); assert.equal(p.detailKey, 'exp.process.detail.audioLocal');
  assert.equal(p.gpu, 'hardware'); assert.equal(p.audioCodec, 'AAC'); assert.equal(p.indeterminate, true);
});

test('encoder drain, conversion, container assembly and saving never reuse a completed frame percentage', () => {
  for (const stage of ['prepare', 'audioLoading', 'audioPrepare', 'audio', 'finalize', 'mux', 'files', 'zip', 'save']) {
    assert.equal(OUT.processInfo(state({ stage }, { i: 60, N: 60 })).indeterminate, true, stage);
  }
  assert.equal(OUT.processInfo(state({ stage: 'video' }, { i: 60, N: 60 })).indeterminate, false, 'frame submission itself can be complete');
});

test('PNG has no video encoder, no audio path and no GPU preference inference from stale metadata', () => {
  for (const format of ['png', 'pngAlpha']) {
    const p = OUT.processInfo(state({ stage: 'video', codec: 'png', audioSource: 'browser',
      acceleration: installed('prefer-hardware') }, { format }));
    assert.equal(p.gpu, 'not-video'); assert.equal(p.audio, 'none'); assert.equal(p.codec, 'PNG');
    assert.equal(p.detailKey, 'exp.process.detail.images'); assert.equal(p.routeKey, 'exp.process.route.png');
  }
});

test('all stage and mechanism strings exist in both languages and explicitly leave actual GPU use unknown', () => {
  const stages = ['prepare', 'video', 'audioLoading', 'audioPrepare', 'audio', 'finalize', 'mux', 'files', 'zip', 'save'];
  const sources = ['local', 'server', 'browser', 'none', 'wav', 'pending'];
  for (const lang of ['ja', 'en']) {
    const t = T.createT(lang, STRINGS, null, { strict: true });
    for (const stage of stages) for (const audioSource of sources) for (const format of ['mp4', 'kit', 'webmAlpha', 'png', 'pngAlpha']) {
      const p = OUT.processInfo(state({ stage, audioSource, audioCodec: 'mp4a.40.2' }, { format }));
      for (const key of [p.stageKey, p.detailKey, p.routeKey, p.gpuKey, p.audioKey]) assert.ok(t(key, { codec: ' (AAC)' }), key);
    }
    assert.ok(t('exp.process.gpuUnknown'));
    assert.ok(t('exp.process.frameCaption'));
    assert.doesNotMatch(t('exp.process.gpu.hardware'), lang === 'ja' ? /GPU使用中|GPUを使用しています/ : /GPU is in use|using the GPU/);
  }
});
