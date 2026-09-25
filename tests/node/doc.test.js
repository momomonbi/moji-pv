/* 文字PVメーカー v2 — original work. Tests for core/doc and core/migrate: defaults, validation, touched, files. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const D = MV.use('core/doc');
const M = MV.use('core/migrate');

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function problemsOf(change) {
  const doc = clone(D.defaultDoc());
  change(doc);
  return D.validate(doc);
}
function expectProblem(change, fragment) {
  const problems = problemsOf(change);
  assert.ok(problems.some((p) => p.includes(fragment)), `expected "${fragment}" in ${JSON.stringify(problems)}`);
}

test('defaultDoc and defaultSide follow §4.4 and validate', () => {
  const doc = D.defaultDoc();
  assert.deepEqual(D.validate(doc), []);
  assert.deepEqual(doc.sheet, { next: 1, rows: [] });
  assert.deepEqual(doc.timing, { snap: 'off', lead: 0.12, tail: 0.25, leadIn: 1, outro: 2, tapLatency: 0.06 });
  assert.equal(doc.song, null);
  assert.deepEqual(doc.look, { seed: 1, moodSeed: 1, aspect: '16:9', backdrop: 'scene' });
  assert.deepEqual([doc.pins, doc.salts, doc.locks, doc.filters], [{}, {}, {}, {}]);
  assert.deepEqual(doc.output, { format: 'mp4', short: 1080, fps: 30, quality: 'high', audio: true, range: null, name: null });
  assert.deepEqual(doc.meta, { app: D.APP_VERSION, lang: 'auto' });
  assert.deepEqual(D.defaultSide(), { looks: { list: [], cap: 50 }, aiLog: [] });
  assert.notEqual(D.defaultDoc(), D.defaultDoc(), 'fresh objects every call');
});

test('DESIGN_SIZE has the seven aspects with a short side of 1080', () => {
  assert.deepEqual(Object.keys(D.DESIGN_SIZE), ['16:9', '9:16', '1:1', '4:5', '4:3', '3:4', '21:9']);
  for (const [w, h] of Object.values(D.DESIGN_SIZE)) assert.equal(Math.min(w, h), 1080);
  assert.deepEqual(D.DESIGN_SIZE['21:9'], [2520, 1080]);
});

test('every fixture project validates and parses', () => {
  for (const { name, doc, side } of corpus.projects()) {
    assert.deepEqual(D.validate(doc), [], name);
    const file = M.parseFile(corpus.projectText(name));
    assert.deepEqual(file.doc, doc, name);
    assert.deepEqual(file.side, side, name);
  }
  assert.equal(corpus.project('long').doc.sheet.rows.filter((r) => r.src && !r.src.startsWith('#') && !r.src.startsWith('[')).length, 120);
  const song = corpus.songDigest();
  const withSong = Object.assign(D.defaultDoc(), { song });
  assert.deepEqual(D.validate(withSong), []);
  assert.equal(Buffer.from(song.digest.loud, 'base64').length, song.seconds * song.digest.hz);
});

test('validate reports structural problems', () => {
  expectProblem((d) => { d.meta.lang = 'fr'; }, 'meta.lang');
  expectProblem((d) => { d.sheet.rows = [{ id: 'r1', src: 'a' }, { id: 'r1', src: 'b' }]; d.sheet.next = 2; }, 'duplicate id r1');
  expectProblem((d) => { d.sheet.rows = [{ id: 'rz', src: 'a' }]; d.sheet.next = 5; }, 'must be greater than rz');
  expectProblem((d) => { d.sheet.rows = [{ id: 'x1', src: 'a' }]; }, 'must look like');
  expectProblem((d) => { d.sheet.rows = [{ id: 'r1', src: 'a\nb' }]; d.sheet.next = 2; }, 'single line');
  expectProblem((d) => { d.sheet.next = 0; }, 'sheet.next');
  expectProblem((d) => { d.timing.snap = 'bars'; }, 'timing.snap');
  expectProblem((d) => { d.timing.lead = -1; }, 'timing.lead');
  expectProblem((d) => { d.song = { name: 'x' }; }, 'song.sha1');
  expectProblem((d) => { d.song = Object.assign(corpus.songDigest(), { digest: { hz: 20 } }); }, 'song.digest');
  expectProblem((d) => { d.look.seed = -3; }, 'look.seed');
  expectProblem((d) => { d.look.moodSeed = 2 ** 33; }, 'look.moodSeed');
  expectProblem((d) => { d.look.aspect = '2:1'; }, 'look.aspect');
  expectProblem((d) => { d.look.backdrop = 'green'; }, 'look.backdrop');
  expectProblem((d) => { d.pins['work:'] = { v: 1, by: 'user' }; }, 'path does not parse');
  expectProblem((d) => { d.pins['line/x7:start'] = { v: 1, by: 'user' }; }, 'path does not parse');
  expectProblem((d) => { d.pins['work:mood'] = { v: 'quietHush', by: 'robot' }; }, '.by');
  expectProblem((d) => { d.pins['work:mood'] = { by: 'user' }; }, '.v');
  expectProblem((d) => { d.pins['cut/r1~0:arrive'] = { v: 'stubFade', by: 'user' }; }, 'is required on cut pins');
  expectProblem((d) => { d.salts['line/r1'] = 0; }, 'positive integer');
  expectProblem((d) => { d.salts['nonsense'] = 1; }, 'does not parse');
  expectProblem((d) => { d.locks.r1 = { n: -1 }; }, 'locks[r1]');
  expectProblem((d) => { d.locks.x = { n: 1 }; }, 'key must be a line id');
  expectProblem((d) => { d.filters.planet = { only: null, deny: null }; }, 'unknown kind');
  expectProblem((d) => { d.filters.seam = { only: 'hardCut', deny: null }; }, 'filters.seam.only');
  expectProblem((d) => { d.output.fps = 25; }, 'output.fps');
  expectProblem((d) => { d.output.short = 1000; }, 'output.short');
  expectProblem((d) => { d.output.range = { t0: 5, t1: 2 }; }, 'output.range');
  expectProblem((d) => { d.output.audio = 'yes'; }, 'output.audio');
  expectProblem((d) => { delete d.look; }, 'look: must be an object');
  assert.deepEqual(D.validate(null), ['doc: must be an object']);
  assert.deepEqual(problemsOf((d) => { d.extra = { mine: true }; }), [], 'unknown keys are allowed');
  assert.deepEqual(problemsOf((d) => {
    d.pins['cut/r1~0:arrive'] = { v: 'stubFade', by: 'user', sig: 'あ' };
    d.salts['cut/r1~0:arrive'] = 2;
    d.salts.work = 1;
    d.locks['r2.1'] = { n: 3 };
  }), []);
});

test('normalize fills missing defaults and never changes present values', () => {
  const full = D.defaultDoc();
  assert.equal(D.normalize(full), full, 'nothing missing → the same object');
  const partial = { meta: { app: '1.9' }, sheet: { rows: [{ id: 'r9', src: 'x' }, { id: 'ra', src: 'y' }] },
    look: { seed: 77 }, pins: { 'work:mood': { v: 'quietHush', by: 'user' } }, song: { name: 's', sha1: 'a', seconds: 3 },
    custom: 'kept' };
  const doc = D.normalize(partial);
  assert.deepEqual(D.validate(doc), []);
  assert.equal(doc.meta.app, '1.9');
  assert.equal(doc.meta.lang, 'auto');
  assert.equal(doc.sheet.next, 11, 'next is one past the highest row id (ra = 10)');
  assert.equal(doc.look.seed, 77);
  assert.equal(doc.look.aspect, '16:9');
  assert.equal(doc.pins, partial.pins, 'untouched parts are shared');
  assert.deepEqual(doc.song, { name: 's', sha1: 'a', seconds: 3, bpm: null, offset: 0, meter: 4, bpmConfidence: null,
    digest: null, info: null });
  assert.equal(doc.custom, 'kept');
  assert.deepEqual(doc.timing, D.defaultDoc().timing);
  assert.equal(partial.meta.lang, undefined, 'the input is not mutated');
  assert.deepEqual(D.normalize('x'), D.defaultDoc());
  assert.deepEqual(D.normalizeSide(undefined), D.defaultSide());
  assert.deepEqual(D.normalizeSide({ looks: { list: [{ n: 1 }] } }), { looks: { list: [{ n: 1 }], cap: 50 }, aiLog: [] });
});

test('touched reports what changed, by reference', () => {
  const a = corpus.project('basic').doc;
  assert.deepEqual(D.touched(a, a), { rows: new Set(), pins: new Set(), meta: false, look: false, timing: false, song: false,
    output: false, filters: false, salts: false, locks: false });
  const rows = a.sheet.rows.slice();
  rows[3] = { id: rows[3].id, src: rows[3].src + '!' };
  rows.push({ id: 'rz', src: '新しい行' });
  const b = Object.assign({}, a, { sheet: { next: 36, rows }, pins: Object.assign({}, a.pins, { 'work:mood': { v: 'quietHush', by: 'user' } }),
    look: Object.assign({}, a.look, { seed: 5 }) });
  const t = D.touched(a, b);
  assert.deepEqual([...t.rows].sort(), [rows[3].id, 'rz'].sort());
  assert.deepEqual([...t.pins], ['work:mood']);
  assert.equal(t.look, true);
  assert.equal(t.timing, false);
  assert.equal(t.song, false);
  const removed = Object.assign({}, a, { sheet: { next: a.sheet.next, rows: a.sheet.rows.slice(1) } });
  assert.deepEqual([...D.touched(a, removed).rows], [a.sheet.rows[0].id]);
  const sameText = Object.assign({}, a, { sheet: { next: a.sheet.next, rows: a.sheet.rows.map((r) => ({ id: r.id, src: r.src })) } });
  assert.equal(D.touched(a, sameText).rows.size, 0, 'rebuilt rows with the same text are not touched');
  const moved = a.sheet.rows.slice();
  [moved[3], moved[4]] = [moved[4], moved[3]];
  assert.equal(D.touched(a, Object.assign({}, a, { sheet: { next: a.sheet.next, rows: moved } })).rows, 'all');
  const unpinned = Object.assign({}, b, { pins: {} });
  assert.deepEqual([...D.touched(b, unpinned).pins], ['work:mood']);
});

test('parseFile errors: bad JSON, not a project, newer schema, invalid', () => {
  const code = (text) => { try { M.parseFile(text); } catch (e) { assert.equal(e.name, 'MigrateError'); return e.code; } return null; };
  assert.equal(code('{ not json'), 'bad-json');
  assert.equal(code('[]'), 'not-a-project');
  assert.equal(code(JSON.stringify({ format: 'something', schema: 1, doc: {} })), 'not-a-project');
  assert.equal(code(JSON.stringify({ format: 'mojipv.project', doc: {} })), 'not-a-project');
  assert.equal(code(JSON.stringify({ format: 'mojipv.project', schema: 1 })), 'not-a-project');
  assert.equal(code(JSON.stringify({ format: 'mojipv.project', schema: M.CURRENT_SCHEMA + 1, doc: {} })), 'newer');
  const bad = JSON.parse(corpus.projectText('basic'));
  bad.doc.look.aspect = 'wide';
  try {
    M.parseFile(JSON.stringify(bad));
    assert.fail('expected invalid');
  } catch (e) {
    assert.equal(e.code, 'invalid');
    assert.ok(e.problems.some((p) => p.startsWith('look.aspect')));
  }
  const sparse = M.parseFile(JSON.stringify({ format: 'mojipv.project', schema: 1, doc: { sheet: { rows: [{ id: 'r1', src: 'a' }] } } }));
  assert.equal(sparse.doc.sheet.next, 2);
  assert.deepEqual(sparse.side, D.defaultSide());
  assert.equal(M.CURRENT_SCHEMA, 1);
  assert.deepEqual(Object.keys(M.MIGRATIONS), []);
});

test('serialize: round trip, §3.1 key order, sorted maps, unknown keys kept', () => {
  for (const { name, doc, side } of corpus.projects()) {
    const text = D.serialize({ doc, side });
    assert.deepEqual(M.parseFile(text), { doc, side }, name);
    assert.equal(text, corpus.projectText(name), name + ' fixture is stored in canonical form');
    assert.equal(D.serialize(M.parseFile(text)), text, name + ' is stable');
  }
  const doc = Object.assign({ zeta: 1 }, D.defaultDoc(), { alpha: { x: 1 } });
  doc.pins = { 'work:theme': { by: 'ai', v: 'sumiWashi' }, 'line/r1:arrange': { sig: undefined, v: 'stubBlock', by: 'user' } };
  doc.output = Object.assign({ name: 'x', audio: false }, doc.output, { range: { t1: 9, t0: 1 } });
  const text = D.serialize({ doc });
  const file = JSON.parse(text);
  assert.deepEqual(Object.keys(file), ['format', 'schema', 'doc', 'side']);
  assert.equal(file.format, 'mojipv.project');
  assert.equal(file.schema, 1);
  assert.deepEqual(Object.keys(file.doc), ['meta', 'sheet', 'timing', 'song', 'look', 'pins', 'salts', 'locks', 'filters',
    'output', 'zeta', 'alpha']);
  assert.deepEqual(Object.keys(file.doc.pins), ['line/r1:arrange', 'work:theme']);
  assert.deepEqual(Object.keys(file.doc.pins['work:theme']), ['v', 'by']);
  assert.deepEqual(Object.keys(file.doc.output), ['format', 'short', 'fps', 'quality', 'audio', 'range', 'name']);
  assert.deepEqual(Object.keys(file.doc.output.range), ['t0', 't1']);
  assert.deepEqual(file.side, D.defaultSide());
  assert.ok(text.startsWith('{\n "format": "mojipv.project",\n "schema": 1,'), 'one-space indent');
  assert.ok(text.endsWith('}\n'));
});

// ---- final fixes (engine): the side and doc.song.info are checked when a file is read (flows-1, security-1) ----------

function fileWith(change) {
  const file = JSON.parse(corpus.projectText('basic'));
  change(file);
  return JSON.stringify(file);
}

test('parseFile cleans a malformed side instead of passing it to the UI', () => {
  const entry = { n: 1, seed: 918273645, moodSeed: 44120771, salts: {}, scope: 'work', label: ['look.first', {}], star: false };
  const logEntry = { runId: 'k1-0', tool: 'looks', n: 1, applied: [{ path: 'work:theme', to: 'sumiWashi', prev: null }], at: 5,
    groups: [[0]] };
  const sideOf = (side) => M.parseFile(fileWith((f) => { f.side = side; })).side;
  const empty = D.defaultSide();
  for (const bad of [null, 'x', [], { looks: null }, { looks: 'x' }, { looks: { list: 'abc' } }, { looks: { list: null } },
    { looks: { list: [null, 3, 'e', []] } }, { aiLog: 'x' }, { aiLog: [null, 1, 'a', []] }]) {
    assert.deepEqual(sideOf(bad), empty, JSON.stringify(bad));
  }
  const good = sideOf({ looks: { list: [entry], cap: 20 }, aiLog: [logEntry] });
  assert.deepEqual(good, { looks: { list: [entry], cap: 20 }, aiLog: [logEntry] }, 'a valid side is kept as it is');
  const mixed = sideOf({ looks: { list: [null, entry, Object.assign({}, entry, { seed: 2 }), 'x'], cap: 50 }, aiLog: [null, logEntry] });
  assert.deepEqual(mixed.looks.list, [entry], 'bad entries and a second entry with the same n are dropped');
  assert.deepEqual(mixed.aiLog, [logEntry]);
  const badEntries = [{ n: 0 }, { n: 1.5 }, { seed: -1 }, { moodSeed: 2 ** 32 }, { salts: null }, { salts: { nonsense: 1 } },
    { salts: { 'line/r4': 0 } }, { salts: { 'line/r4': '2' } }, { scope: 3 }, { label: 'look.first' }, { label: ['look.first'] },
    { label: [1, {}] }, { label: ['look.first', null] }, { star: 'yes' }];
  for (const change of badEntries) {
    assert.deepEqual(sideOf({ looks: { list: [Object.assign({}, entry, change)], cap: 50 }, aiLog: [] }).looks.list, [],
      JSON.stringify(change));
  }
  assert.deepEqual(sideOf({ looks: { list: [Object.assign({}, entry, { salts: { 'line/r4': 2, 'cut/r3~0:depart': 1 } })] } })
    .looks.list.length, 1, 'salt keys may be scopes or scope plus slot');
  const badLogs = [{ runId: null }, { runId: 3 }, { tool: null }, { at: undefined }, { at: 'noon' }, { at: Infinity }, { n: -1 },
    { n: 'one' }, { applied: null }, { applied: [null] }, { applied: ['x'] }, { groups: 'x' }];
  for (const change of badLogs) {
    assert.deepEqual(sideOf({ aiLog: [Object.assign({}, logEntry, change)] }).aiLog, [], JSON.stringify(change));
  }
  for (const [cap, want] of [[0, 50], [-3, 50], [2.5, 50], ['9', 50], [501, 50], [1, 1], [500, 500]]) {
    assert.equal(sideOf({ looks: { list: [], cap } }).looks.cap, want, 'cap ' + cap);
  }
  assert.deepEqual(Object.keys(sideOf({ looks: { list: [] }, aiLog: [], extra: { a: 1 } })), ['looks', 'aiLog'], 'other keys go');
  // what the UI does with the side right after an open must not throw
  const side = sideOf({ looks: { list: 'abc', cap: 50 }, aiLog: [null] });
  assert.equal(side.looks.list.some((e) => e.star), false);
  assert.deepEqual(side.aiLog.map((e) => e.at), []);
});

test('doc.song.info must have the shape of a song analysis', () => {
  const info = { summary: 's', mood: 'm', bpm: 120, sections: [{ kind: 'chorus', start: 1, end: 2 }],
    highlights: [{ time: 1, what: 'hit' }], duration: 60 };
  const problems = (inf) => D.validate(Object.assign(D.defaultDoc(), { song: Object.assign(corpus.songDigest(), { info: inf }) }));
  assert.deepEqual(problems(info), []);
  assert.deepEqual(problems(null), []);
  assert.deepEqual(problems({ mood: 'bright' }), [], 'a key may be missing');
  const bad = [
    [3, 'song.info'], [[], 'song.info'], [{ summary: 1 }, 'song.info.summary'], [{ mood: null }, 'song.info.mood'],
    [{ bpm: '120' }, 'song.info.bpm'], [{ duration: NaN }, 'song.info.duration'], [{ sections: 'x' }, 'song.info.sections'],
    [{ sections: [null] }, 'song.info.sections[0]'], [{ sections: [{ kind: 'chorus', start: '1', end: 2 }] }, 'song.info.sections[0]'],
    [{ sections: [{ kind: 'chorus', start: 2, end: 1 }] }, 'song.info.sections[0]'],
    [{ sections: [{ kind: 'rap', start: 1, end: 2 }] }, 'song.info.sections[0]'], [{ highlights: {} }, 'song.info.highlights'],
    [{ highlights: [{ time: 'x', what: 'a' }] }, 'song.info.highlights[0]'], [{ highlights: [{ time: 1 }] }, 'song.info.highlights[0]'],
  ];
  for (const [inf, where] of bad) {
    const got = problems(inf);
    assert.ok(got.length && got.every((p) => p.startsWith(where + ':')), JSON.stringify(inf) + ' → ' + JSON.stringify(got));
  }
  // a file with such an analysis is refused, like any other malformed document field
  const text = fileWith((f) => { f.doc.song.info = { sections: [{ kind: 'chorus', start: '1', end: 2 }] }; });
  assert.throws(() => M.parseFile(text), (e) => e.code === 'invalid' && e.problems.some((p) => p.startsWith('song.info.sections[0]')));
  assert.deepEqual(D.SECTION_KINDS, ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'interlude', 'solo', 'outro', 'other']);
  // the store can never hold one: the song.info command checks the same rule
  const CMD = MV.use('core/commands');
  const withSong = Object.assign(D.defaultDoc(), { song: corpus.songDigest() });
  assert.throws(() => CMD.reduce(withSong, { t: 'song.info', info: { sections: [{ kind: 'chorus', start: '1', end: 2 }] } }),
    (e) => e.code === 'payload');
  assert.deepEqual(CMD.reduce(withSong, { t: 'song.info', info }).song.info, info);
});
