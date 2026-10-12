/* 文字PVメーカー v2 — original work. Export acceleration preferences and one-step speed changes preserve older works and unrelated output choices. */
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
const OUT = MV.use('ui/output');

function sample(format = 'mp4', short = 2160, fps = 60) {
  const doc = D.defaultDoc();
  doc.sheet = { next: 3, rows: [{ id: 'r1', src: '# Chorus' }, { id: 'r2', src: 'Keep the same words' }] };
  doc.output = { ...doc.output, format, short, fps, quality: 'light', acceleration: 'cpu', audio: false,
    range: { t0: 2, t1: 9 }, name: 'my-finished-work',
    kit: { overlay: false, bg: true, green: true, srt: false, lrc: true } };
  return doc;
}

test('older projects without acceleration validate and reopen with auto without changing existing output choices', () => {
  assert.equal(D.defaultDoc().output.acceleration, 'auto');
  const old = sample();
  delete old.output.acceleration;
  const before = JSON.stringify(old);
  assert.deepEqual(D.validate(old), []);
  const normalized = D.normalize(old);
  assert.equal(normalized.output.acceleration, 'auto');
  assert.deepEqual(normalized.output, { ...old.output, acceleration: 'auto' });
  assert.equal(normalized.sheet, old.sheet);
  assert.equal(JSON.stringify(old), before, 'normalization does not mutate an older document');
  assert.deepEqual(M.parseFile(D.serialize({ doc: old })).doc, normalized);
  assert.deepEqual(M.parseFile(D.serialize({ doc: normalized })).doc, normalized);
  for (const { name } of corpus.projects()) {
    const opened = M.parseFile(corpus.projectText(name));
    assert.equal(opened.doc.output.acceleration, 'auto', name);
    assert.deepEqual(M.parseFile(D.serialize(opened)).doc, opened.doc, name + ': complete save/reopen preserves the work');
  }
});

test('auto and cpu preferences each save, reopen and undo without changing the remaining document', () => {
  const original = sample();
  original.output.acceleration = 'auto';
  const store = STORE.createStore({ doc: original, reduce: C.reduce });
  assert.equal(store.dispatch({ t: 'output.set', key: 'acceleration', v: 'auto' }), 0);
  assert.equal(store.list().length, 0, 'selecting the current preference has no undo entry');
  for (const preference of ['cpu', 'auto']) {
    const before = store.doc;
    store.dispatch({ t: 'output.set', key: 'acceleration', v: preference });
    const selected = store.doc;
    assert.deepEqual(selected, { ...before, output: { ...before.output, acceleration: preference } });
    assert.deepEqual(D.validate(selected), []);
    assert.deepEqual(M.parseFile(D.serialize({ doc: selected })).doc, selected);
    assert.ok(store.undo());
    assert.equal(store.doc, before);
    assert.ok(store.redo());
    assert.equal(store.doc, selected);
  }
  assert.equal(store.list().filter((entry) => entry.done).length, 2);
});

test('invalid acceleration is rejected by validation, file opening and output commands without recording an edit', () => {
  for (const value of ['gpu', 'software', '', null, false, 2, [], {}]) {
    const invalid = sample();
    invalid.output.acceleration = value;
    assert.ok(D.validate(invalid).some((problem) => problem.includes('output.acceleration')), JSON.stringify(value));
    assert.throws(() => M.parseFile(D.serialize({ doc: invalid })), { code: 'invalid' });
    const original = sample();
    const store = STORE.createStore({ doc: original, reduce: C.reduce });
    assert.throws(() => store.dispatch({ t: 'output.set', key: 'acceleration', v: value }), { code: 'payload' });
    assert.equal(store.doc, original);
    assert.deepEqual(store.list(), []);
  }
});

test('speed choice lowers only excessive resolution and fps for each format and keeps 24 fps or a smaller size', () => {
  for (const format of ['mp4', 'webmAlpha', 'png', 'pngAlpha', 'kit']) {
    for (const short of D.OUTPUT_CHOICES.short) for (const fps of D.OUTPUT_CHOICES.fps) {
      const original = sample(format, short, fps);
      const snapshot = JSON.stringify(original);
      const commands = OUT.speedCmds(original);
      const updated = C.reduce(original, { t: 'batch', cmds: commands });
      const expectedShort = short > (format === 'kit' ? 1080 : 720) ? (format === 'kit' ? 1080 : 720) : short;
      const expectedFps = fps > 30 ? 30 : fps;
      assert.deepEqual(OUT.speedProfile(original), { short: expectedShort, fps: expectedFps });
      assert.deepEqual(updated, { ...original, output: { ...original.output, short: expectedShort, fps: expectedFps } },
        format + '/' + short + '/' + fps + ': content, compression, audio, acceleration, range and kit are retained');
      assert.deepEqual(D.validate(updated), []);
      assert.equal(JSON.stringify(original), snapshot);
      assert.ok(commands.every((command) => ['short', 'fps'].includes(command.key) && command.v < original.output[command.key]));
      assert.deepEqual(OUT.speedCmds(updated), [], 'the speed setting is idempotent');
    }
  }
});

test('one speed click is one undoable batch and restores both resolution and fps together', () => {
  for (const format of ['mp4', 'webmAlpha', 'png', 'pngAlpha', 'kit']) {
    const original = sample(format);
    const store = STORE.createStore({ doc: original, reduce: C.reduce });
    const events = [];
    store.on('doc', (event) => events.push(event));
    store.batch({ label: ['undo.output', {}] }, OUT.speedCmds(store.doc));
    const selected = store.doc;
    assert.equal(store.list().filter((entry) => entry.done).length, 1, format);
    assert.equal(events.length, 1);
    assert.equal(events[0].cmds.length, 2, 'both changes are committed together');
    assert.ok(store.undo());
    assert.equal(store.doc, original, 'one undo restores the complete original snapshot');
    assert.equal(store.undo(), null);
    assert.ok(store.redo());
    assert.equal(store.doc, selected);
    const rev = store.rev;
    store.batch({ label: ['undo.output', {}] }, OUT.speedCmds(store.doc));
    assert.equal(store.rev, rev, 'a repeated click has no additional edit');
    assert.equal(store.list().length, 1);
  }
});
