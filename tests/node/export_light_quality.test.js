/* 文字PVメーカー v2 — original work. Light export preset: saved settings, unchanged sound, comparison and kit estimates. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const D = MV.use('core/doc');
const M = MV.use('core/migrate');
const C = MV.use('core/commands');
const STORE = MV.use('core/store');
const S = MV.use('export/schedule');
const OUT = MV.use('ui/output');

function sample(format = 'mp4', audio = true) {
  const doc = D.defaultDoc();
  doc.song = { sha1: 'song', name: 'song.wav', seconds: 20 };
  doc.output = { ...doc.output, format, audio, short: 1080, range: { t0: 2, t1: 12 } };
  return doc;
}
const plan = { duration: 20, design: { aspect: '16:9' }, lines: [], cuts: [] };
const env = { audioCodec: 'mp4a.40.2', audioBitrate: 320000, webmAudioCodec: 'opus', webmAudioBitrate: 320000,
  songReady: true, dirAccess: true };

test('light quality can be selected, saved and undone while old presets and the default remain valid', () => {
  const original = D.defaultDoc();
  const store = STORE.createStore({ doc: original, reduce: C.reduce });
  assert.equal(original.output.quality, 'high');
  store.dispatch({ t: 'output.set', key: 'quality', v: 'light' });
  const selected = store.doc;
  assert.deepEqual(D.validate(selected), []);
  assert.equal(selected.output.quality, 'light');
  assert.deepEqual(M.parseFile(D.serialize({ doc: selected })).doc, selected);
  assert.equal(selected.output.audio, original.output.audio);
  assert.equal(selected.pins, original.pins);
  store.undo();
  assert.equal(store.doc, original);
  store.redo();
  assert.equal(store.doc, selected);
  for (const { name } of corpus.projects()) {
    const opened = M.parseFile(corpus.projectText(name));
    const quality = opened.doc.output.quality;
    assert.ok(['standard', 'high', 'max'].includes(quality), name);
    assert.equal(M.parseFile(D.serialize(opened)).doc.output.quality, quality, name + ': old quality is preserved');
  }
  assert.deepEqual(S.QUALITY_LEVELS, ['light', 'standard', 'high', 'max']);
  assert.equal(Object.isFrozen(S.QUALITY_LEVELS), true);
  assert.deepEqual(D.OUTPUT_CHOICES.quality, S.QUALITY_LEVELS);
  assert.throws(() => C.reduce(original, { t: 'output.set', key: 'quality', v: 'tiny' }), { code: 'payload' });
});

test('light halves the video target at every output size and fps while keeping 320 kbps sound', () => {
  for (const aspect of D.ASPECTS) for (const short of D.OUTPUT_CHOICES.short) for (const fps of D.OUTPUT_CHOICES.fps) {
    const { w, h } = S.outputSize(aspect, short);
    const light = S.bitrate(w, h, fps, 'light'), low = S.bitrate(w, h, fps, 'standard');
    assert.ok(Math.abs(light * 2 - low) <= 1, aspect + '/' + short + '/' + fps);
    assert.equal(S.estimateBytes(10, light, true) - S.estimateBytes(10, light, false), 408000,
      'the audio budget stays at 320 kbps, with container overhead');
    assert.equal(S.estimateWebmBytes(10, light, true) - S.estimateWebmBytes(10, light, false), 408000);
  }
  assert.equal(S.AUDIO_BITRATE, 320000);
  assert.equal(S.OPUS_BITRATE, 320000);
});

test('the four comparison rows retain low as their baseline, and PNG stays lossless', () => {
  for (const format of ['mp4', 'webmAlpha']) {
    const result = OUT.qualityOptions(sample(format), plan, env);
    assert.equal(result.lossless, false);
    assert.deepEqual(result.rows.map((row) => row.quality), S.QUALITY_LEVELS);
    const baseline = result.rows.find((row) => row.quality === 'standard');
    for (const row of result.rows) assert.equal(row.ratio, row.bytes / baseline.bytes);
    assert.ok(result.rows[0].ratio > 0.5 && result.rows[0].ratio < 1, 'unchanged audio makes the full file ratio above half');
    const muted = OUT.qualityOptions(sample(format, false), plan, env);
    assert.equal(muted.rows[0].ratio, 0.5, 'without sound the video estimate is half of low');
  }
  for (const format of ['png', 'pngAlpha']) {
    const result = OUT.qualityOptions(sample(format), plan, env);
    assert.equal(result.lossless, true);
    assert.equal(new Set(result.rows.map((row) => row.bytes)).size, 1);
    assert.deepEqual(result.rows.map((row) => row.ratio), [1, 1, 1, 1]);
  }
});

test('a light Filmora kit lowers the selected video files and preserves maximum-quality chroma key', () => {
  const doc = sample('kit');
  doc.output.kit = { overlay: true, bg: true, green: true, srt: true, lrc: true };
  const comparison = OUT.qualityOptions(doc, plan, env);
  assert.deepEqual(comparison.rows.map((row) => row.quality), S.QUALITY_LEVELS);
  let previous = null;
  for (const row of comparison.rows) {
    const selected = { ...doc, output: { ...doc.output, quality: row.quality } };
    const files = S.kitFiles(selected, plan, env);
    assert.equal(row.bytes, files.reduce((n, file) => n + file.est, 0));
    assert.equal(files.find((file) => file.kind === 'green').est,
      S.estimateBytes(10, S.bitrate(1920, 1080, 30, 'max'), false));
    assert.equal(files.find((file) => file.kind === 'main').est,
      S.estimateBytes(10, S.bitrate(1920, 1080, 30, row.quality), true, 320000));
    if (previous) {
      for (const kind of ['main', 'overlay', 'bg']) {
        assert.ok(files.find((file) => file.kind === kind).est > previous.find((file) => file.kind === kind).est, kind);
      }
      for (const kind of ['green', 'srt', 'lrc', 'readme']) {
        assert.equal(files.find((file) => file.kind === kind).est, previous.find((file) => file.kind === kind).est, kind);
      }
    }
    previous = files;
  }
  assert.ok(comparison.rows[0].ratio > 0.5 && comparison.rows[0].ratio < 1,
    'fixed chroma-key and sidecar files are included in the light kit estimate');
  assert.equal(comparison.rows[1].ratio, 1);
});
