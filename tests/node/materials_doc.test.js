/* 文字PVメーカー v2 — original work. Tests: schema 2 and doc.materials — migration, saving, material.* reducers, undo (DESIGN_2_1 §2.1, §2.2, §2.6). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { throwsCode, deepEqual } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const D = MV.use('core/doc');
const M = MV.use('core/migrate');
const C = MV.use('core/commands');
const R = MV.use('core/recipe');
const { createStore } = MV.use('core/store');
const { hashJSON } = MV.use('core/hash');
const { stream } = MV.use('core/rng');

const reduce = C.reduce;
const PETALS = { prim: 'particles', shape: 'petal', inks: ['#F4B4C6', 'accent'], alpha: 0.85, layer: 'near', size: [0.012, 0.022],
  count: 90, field: { dir: 115, speed: 0.09, sway: 26, swayHz: 0.35, spin: 60 } };
const FLURRY = { follow: 'own', knobs: [{ what: 'count' }], layers: [PETALS], scope: 'run', seed: 7 };
function put(doc, id, patch) {
  return reduce(doc, Object.assign({ t: 'material.put', id, kind: 'ornament', by: 'ai', name: { ja: '桜吹雪', en: 'Cherry flurry' },
    recipe: FLURRY }, patch || {}));
}
function fresh() { return D.normalize(corpus.project('basic').doc); }

test('migrate 1 → 2 on every fixture: materials and media added, pins and everything else unchanged', () => {
  for (const name of corpus.PROJECTS) {
    const file = JSON.parse(corpus.projectText(name));
    assert.equal(file.schema, 1, name + ' is a v2.0 file');
    const out = M.migrate(file);
    assert.deepEqual(out.doc.materials, { next: 1, list: [] });
    assert.deepEqual(out.doc.media, { list: [] });
    for (const k of Object.keys(file.doc)) assert.equal(out.doc[k], file.doc[k], name + ': ' + k + ' is the same object');
    assert.equal(out.side, file.side);
    const step = M.MIGRATIONS[1](file);
    assert.equal(step.schema, 2);
    assert.equal(file.schema, 1, 'the input is not mutated');
    assert.equal(file.doc.materials, undefined);
    const opened = M.parseFile(corpus.projectText(name));
    assert.equal(JSON.stringify(opened.doc.pins), JSON.stringify(file.doc.pins), name + ': pins byte-identical');
    assert.deepEqual(D.validate(opened.doc), []);
  }
  const newer = JSON.parse(corpus.projectText('basic'));
  newer.schema = 3;
  throwsCode(() => M.parseFile(JSON.stringify(newer)), 'newer');
});

test('schema-2 files: the v21 fixture opens, validates and is stored in canonical form (§2.1 key order)', () => {
  for (const name of corpus.V21_PROJECTS) {
    const text = corpus.projectText(name);
    const file = M.parseFile(text);
    assert.equal(D.serialize(file), text, name + ' is canonical');
    assert.deepEqual(D.validate(file.doc), []);
  }
  const text = corpus.projectText('v21');
  const json = JSON.parse(text);
  assert.equal(json.schema, 2);
  assert.deepEqual(Object.keys(json.doc), ['meta', 'sheet', 'timing', 'song', 'look', 'pins', 'salts', 'locks', 'filters', 'materials',
    'media', 'output']);
  assert.deepEqual(Object.keys(json.doc.materials), ['next', 'list']);
  assert.deepEqual(json.doc.materials.list.map((m) => Object.keys(m)), json.doc.materials.list.map(() =>
    ['id', 'kind', 'by', 'name', 'blurb', 'tags', 'season', 'pool', 'rv', 'recipe']));
  const recipe = json.doc.materials.list[2].recipe;
  assert.equal(JSON.stringify(recipe), MV.use('core/hash').canonical(recipe), 'recipes are saved with sorted keys');
  assert.deepEqual(Object.keys(json.side), ['looks', 'aiLog', 'asks']);
  assert.deepEqual(json.side.asks, { 'song:2@24-40': { text: '季節感を足して、カメラはゆっくり寄る', at: 3 } });
  const missing = JSON.parse(text);
  delete missing.doc.materials;
  delete missing.doc.media;
  delete missing.doc.output.kit;
  const opened = M.parseFile(JSON.stringify(missing));
  assert.deepEqual([opened.doc.materials, opened.doc.media, opened.doc.output.kit], [{ next: 1, list: [] }, { list: [] }, D.KIT_DEFAULT],
    'normalize fills a missing materials, media and output.kit');
  const partial = JSON.parse(text);
  delete partial.doc.materials.next;
  assert.equal(M.parseFile(JSON.stringify(partial)).doc.materials.next, 4, 'a missing next is one past the highest id');
});

test('validate: structural checks of doc.materials (recipe semantics are not checked)', () => {
  const doc = put(fresh(), 'm1');
  const bad = (change, fragment) => {
    const d = JSON.parse(JSON.stringify(doc));
    change(d);
    const problems = D.validate(d);
    assert.ok(problems.some((p) => p.includes(fragment)), fragment + ' in ' + JSON.stringify(problems));
  };
  bad((d) => { d.materials = []; }, 'materials: must be');
  bad((d) => { d.materials.next = 0; }, 'materials.next');
  bad((d) => { d.materials.next = 1; }, 'must be greater than m1');
  bad((d) => { d.materials.list[0].id = 'x1'; }, 'must look like m<base36>');
  bad((d) => { d.materials.list.push(Object.assign({}, d.materials.list[0])); d.materials.next = 5; }, 'duplicate id m1');
  bad((d) => { d.materials.list[0].kind = 'theme'; }, '.kind');
  bad((d) => { d.materials.list[0].by = 'lock'; }, '.by');
  bad((d) => { d.materials.list[0].name = { ja: ' ' }; }, 'non-empty ja');
  bad((d) => { d.materials.list[0].recipe = 3; }, '.recipe');
  bad((d) => { d.materials.list[0].recipe = { junk: 'x'.repeat(7000) }; }, 'larger than 6144');
  bad((d) => { d.materials.list = Array.from({ length: 65 }, (_, i) => Object.assign({}, doc.materials.list[0], { id: 'm' + (i + 1).toString(36) })); d.materials.next = 99; }, 'at most 64');
  const future = JSON.parse(JSON.stringify(doc));
  future.materials.list[0].rv = 7;
  future.materials.list[0].recipe = { layers: 'from a newer version' };
  assert.deepEqual(D.validate(future), [], 'a recipe core/recipe cannot read keeps the file openable');
});

test('material.put creates only m<next>, next only grows, ids are never reused after a remove', () => {
  let doc = fresh();
  throwsCode(() => put(doc, 'm2'), 'payload');
  doc = put(doc, 'm1');
  assert.equal(doc.materials.next, 2);
  const e = doc.materials.list[0];
  assert.deepEqual(Object.keys(e), ['id', 'kind', 'by', 'name', 'blurb', 'tags', 'season', 'pool', 'rv', 'recipe']);
  assert.deepEqual([e.name, e.blurb, e.tags, e.season, e.pool, e.rv], [{ ja: '桜吹雪', en: 'Cherry flurry' }, null, [], null, false, 1]);
  assert.deepEqual(e.recipe, R.normalize('ornament', FLURRY).recipe, 'the stored recipe is normalized');
  assert.equal(put(doc, 'm2', { by: 'user' }).materials.list[1].pool, true, 'user materials default to pool: true');
  doc = put(doc, 'm2', { kind: 'dwell', recipe: { osc: [{ col: 'y', amp: 0.1 }] }, name: { ja: 'ゆらぎ' } });
  assert.equal(doc.materials.list[1].name.en, '', 'en falls back to ja at derive');
  doc = reduce(doc, { t: 'material.remove', id: 'm2' });
  assert.equal(doc.materials.next, 3, 'next is kept');
  throwsCode(() => put(doc, 'm2'), 'payload');
  doc = put(doc, 'm3');
  assert.deepEqual(doc.materials.list.map((m) => m.id), ['m1', 'm3']);
  // replacing: same id, same kind; unchanged → the same doc
  const again = put(doc, 'm1');
  assert.equal(again, doc, 'an unchanged entry returns the same doc');
  const renamed = put(doc, 'm1', { name: { ja: '夜桜' } });
  assert.equal(renamed.materials.list[0].name.ja, '夜桜');
  assert.equal(renamed.materials.next, doc.materials.next);
  throwsCode(() => put(doc, 'm1', { kind: 'ground', recipe: { layers: [{ prim: 'fill' }] } }), 'payload');
  // base-36 ids
  let many = fresh();
  for (let i = 1; i <= 12; i++) many = put(many, 'm' + i.toString(36));
  assert.deepEqual(many.materials.list.slice(8).map((m) => m.id), ['m9', 'ma', 'mb', 'mc']);
});

test('material.put refuses bad entries, unusable recipes and full lists', () => {
  const doc = fresh();
  const refuse = (patch, why) => throwsCode(() => put(doc, 'm1', patch), 'payload', why);
  refuse({ by: 'robot' }, 'by');
  refuse({ kind: 'mood' }, 'kind');
  refuse({ name: undefined }, 'name');
  refuse({ name: { ja: 'あ'.repeat(30) } }, 'long name');
  refuse({ tags: ['cute'] }, 'tags');
  refuse({ season: 'rainy' }, 'season');
  refuse({ recipe: {} }, 'empty recipe');
  refuse({ recipe: undefined }, 'no recipe');
  refuse({ recipe: { layers: [{ prim: 'pattern', move: [{ what: 'alpha', wave: 'beat', amp: 0.5 }] }] } }, 'flash');
  refuse({ recipe: Object.assign({}, FLURRY, { knobs: ['count', 'size', 'speed', 'alpha', 'amp'] }) }, 'AI knobs ≤ 4');
  refuse({ id: 'M1' }, 'id');
  assert.ok(put(doc, 'm1', { by: 'user', recipe: Object.assign({}, FLURRY, { knobs: ['count', 'size', 'speed', 'alpha', 'amp'] }) }));
  // depart mirrors name an entrance material that comes first
  let d = put(doc, 'm1', { kind: 'arrive', recipe: { motion: { tracks: [{ col: 'y', from: 1 }] } } });
  d = put(d, 'm2', { kind: 'depart', recipe: { mirrorOf: 'm1' } });
  assert.equal(d.materials.list[1].recipe.mirrorOf, 'm1');
  throwsCode(() => put(d, 'm3', { kind: 'depart', recipe: { mirrorOf: 'm2' } }), 'payload', 'm2 is not an entrance');
  throwsCode(() => put(d, 'm3', { kind: 'depart', recipe: { mirrorOf: 'm9' } }), 'payload');
  // 64 entries at most
  let full = fresh();
  for (let i = 1; i <= 64; i++) full = put(full, 'm' + i.toString(36), { recipe: { layers: [{ prim: 'shape' }] } });
  assert.equal(full.materials.list.length, 64);
  throwsCode(() => put(full, 'm' + (65).toString(36), { recipe: { layers: [{ prim: 'shape' }] } }), 'payload');
});

test('material.meta changes metadata only; material.remove clears pins, part-qualified pins and avoid refs', () => {
  let doc = put(put(fresh(), 'm1'), 'm2', { kind: 'arrive', recipe: { base: 'inkRise' } });
  const meta = reduce(doc, { t: 'material.meta', id: 'm1', pool: true, tags: ['soft'], season: 'spring', name: { ja: '夜桜', en: 'Night' } });
  const e = meta.materials.list[0];
  assert.deepEqual([e.pool, e.tags, e.season, e.name, e.recipe], [true, ['soft'], 'spring', { ja: '夜桜', en: 'Night' }, doc.materials.list[0].recipe]);
  assert.equal(reduce(meta, { t: 'material.meta', id: 'm1', pool: true }), meta, 'unchanged → same doc');
  throwsCode(() => reduce(doc, { t: 'material.meta', id: 'm1', tags: ['cute'] }), 'payload');
  throwsCode(() => reduce(doc, { t: 'material.meta', id: 'm9', pool: true }), 'payload');
  const pins = {
    'line/r4:atmos': { v: 'myMat1', by: 'ai' }, 'line/r4:atmos@myMat1.count': { v: 1.2, by: 'ai' },
    'cut/r4~0:ornament#1': { v: 'myMat1', by: 'user', sig: '始発のホームに' }, 'work:ornament#0@myMat1.amount': { v: 0.3, by: 'user' },
    'line/r5:avoid': { v: ['ornament.myMat1'], by: 'ai' }, 'line/r6:avoid': { v: ['arrive.myMat2', 'ornament.myMat1'], by: 'ai' },
    'line/r7:arrive': { v: 'myMat2', by: 'ai' }, 'line/r7:ornament#0': { v: 'myMat10', by: 'ai' }, 'work:mood': { v: 'quietHush', by: 'user' },
  };
  doc = Object.assign({}, doc, { pins });
  const out = reduce(doc, { t: 'material.remove', id: 'm1' });
  assert.deepEqual(Object.keys(out.pins).sort(), ['line/r6:avoid', 'line/r7:arrive', 'line/r7:ornament#0', 'work:mood']);
  assert.deepEqual(out.pins['line/r6:avoid'].v, ['arrive.myMat2']);
  assert.deepEqual(out.materials.list.map((m) => m.id), ['m2']);
  assert.equal(out.materials.next, 3);
  throwsCode(() => reduce(out, { t: 'material.remove', id: 'm1' }), 'payload');
});

test('undo restores deep-equal documents across material commands', () => {
  const start = fresh();
  const store = createStore({ doc: start, reduce, freeze: true });
  store.dispatch({ t: 'material.put', id: 'm1', kind: 'ornament', by: 'ai', name: { ja: 'x' }, recipe: FLURRY });
  store.dispatch({ t: 'pin.set', path: 'line/r4:atmos', v: 'myMat1', by: 'ai' });
  store.dispatch({ t: 'material.meta', id: 'm1', pool: true });
  store.dispatch({ t: 'material.remove', id: 'm1' });
  assert.equal(store.doc.pins['line/r4:atmos'], undefined);
  while (store.undo()) { /* all the way back */ }
  deepEqual(store.doc, start);
  store.redo();
  assert.equal(store.doc.materials.list[0].id, 'm1');
});

// ---- the property test ----------------------------------------------------------------------------------------------

const KINDS_RECIPES = [
  ['ornament', FLURRY], ['ornament', { layers: [{ prim: 'frame', style: 'brackets' }] }],
  ['arrive', { motion: { tracks: [{ col: 'y', from: 1.5 }, { col: 'alpha', from: 0 }] } }], ['dwell', { osc: [{ col: 'rot', amp: 5 }] }],
  ['lens', { osc: [{ col: 'zoom', amp: 0.03, hz: 0.2 }] }], ['ground', { layers: [{ prim: 'fill' }] }],
  ['arrange', { base: 'stairStep', params: { steps: 3 } }], ['filter', { parts: [{ key: 'grainFilm' }] }],
];

function randomCommand(rng, doc) {
  const mats = doc.materials ? doc.materials.list : [];
  const next = doc.materials ? doc.materials.next : 1;
  const pick = mats.length ? rng.pick(mats) : null;
  switch (rng.int(0, 7)) {
    case 0: case 1: {
      const [kind, recipe] = rng.pick(KINDS_RECIPES);
      return { t: 'material.put', id: 'm' + next.toString(36), kind, by: rng.pick(['ai', 'user']), name: { ja: '素材' + rng.int(0, 9) },
        tags: rng.chance(0.5) ? ['soft'] : undefined, recipe };
    }
    case 2: return pick ? { t: 'material.put', id: pick.id, kind: pick.kind, by: pick.by, name: { ja: 'かえた' + rng.int(0, 3) },
      recipe: pick.recipe } : null;
    case 3: return pick ? { t: 'material.meta', id: pick.id, pool: rng.chance(0.5), season: rng.pick([null, 'spring', 'winter']) } : null;
    case 4: return pick ? { t: 'material.remove', id: pick.id } : null;
    case 5: return pick ? { t: 'pin.set', path: rng.pick(['work:atmos', 'line/r4:arrive', 'line/r5:ornament#1']), by: 'ai',
      v: 'myMat' + pick.id.slice(1) } : null;
    case 6: return pick ? { t: 'pin.set', path: 'line/r' + rng.int(4, 7) + ':avoid', by: 'ai',
      v: [pick.kind + '.myMat' + pick.id.slice(1), 'filter.sliceGlitch'] } : null;
    default: return pick ? { t: 'batch', cmds: [{ t: 'material.meta', id: pick.id, pool: true },
      { t: 'pin.set', path: 'work:ornament#0@myMat' + pick.id.slice(1) + '.count', v: 1.1, by: 'user' }] } : null;
  }
}

test('property: 500 random command sequences with materials — undo all restores the start, replay gives the same hash', () => {
  const rng = stream('materials-property');
  const startText = JSON.stringify(corpus.project('basic').doc);
  let commands = 0;
  for (let n = 0; n < 500; n++) {
    const start = JSON.parse(startText);                  // a raw schema-1 document: reducers add materials themselves
    const store = createStore({ doc: start, reduce, freeze: true });
    const log = [];
    for (let s = rng.int(1, 16); s > 0; s--) {
      const cmd = randomCommand(rng, store.doc);
      if (!cmd) continue;
      store.dispatch(cmd);
      log.push(cmd);
      commands++;
      assert.deepEqual(D.validate(store.doc), [], JSON.stringify(cmd));
      const ids = store.doc.materials ? store.doc.materials.list.map((m) => parseInt(m.id.slice(1), 36)) : [];
      assert.ok(ids.every((x) => x < store.doc.materials.next), 'ids < next');
    }
    const end = store.doc;
    assert.equal(hashJSON(log.reduce(reduce, JSON.parse(startText))), hashJSON(end), 'replay');
    while (store.undo()) { /* undo everything */ }
    deepEqual(store.doc, JSON.parse(startText), 'undo all → the start document');
    while (store.redo()) { /* redo everything */ }
    assert.equal(store.doc, end);
  }
  assert.ok(commands > 2000, 'enough commands: ' + commands);
});
