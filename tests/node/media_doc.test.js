/* 文字PVメーカー v2 — original work. Tests: doc.media and the media.* reducers — put, meta, move, remove, relink, undo (DESIGN_2_1 §11.2.2, §11.2.4, §11.2.5). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { throwsCode, deepEqual } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const D = MV.use('core/doc');
const C = MV.use('core/commands');
const R = MV.use('core/recipe');
const ME = MV.use('core/media');
const { createStore } = MV.use('core/store');
const { hashJSON } = MV.use('core/hash');
const { stream } = MV.use('core/rng');

const reduce = C.reduce;
const TEXT = corpus.projectText('media');
const media = () => D.normalize(JSON.parse(TEXT).doc);    // pins and materials that reference the four assets
const basic = () => D.normalize(corpus.project('basic').doc);
const copy = (v) => JSON.parse(JSON.stringify(v));
const [LOGO, SKY, SEA, SPARK] = JSON.parse(TEXT).doc.media.list;
const withField = (entry, patch) => Object.assign(copy(entry), patch);
const NEW_VIDEO = withField(SEA, { id: 'a5a6b7c8d9e0f1a2b3c4d5e6f', name: '海辺2.mp4', dur: 8, frames: 240 });
const NEW_IMAGE = withField(SKY, { id: 'a6e7f8091a2b3c4d5e6f70812', name: '空2.jpg', ai: null });
const ids = (doc) => doc.media.list.map((e) => e.id);

test('validate: doc.media structure — entry problems, duplicate ids and the caps', () => {
  assert.deepEqual(D.validate(media()), []);
  const dup = media();
  dup.media = { list: dup.media.list.concat([dup.media.list[1]]) };
  assert.ok(D.validate(dup).some((p) => /media\.list\[4\]\.id.*duplicate/.test(p)), 'duplicate ids');
  const broken = media();
  broken.media = { list: [withField(SEA, { fps: 0 })] };
  assert.ok(D.validate(broken).some((p) => /media\.list\[0\].*fps/.test(p)));
  const notList = media();
  notList.media = { list: {} };
  assert.ok(D.validate(notList).some((p) => /media\.list/.test(p)));
  const newer = media();
  newer.media = { list: [withField(LOGO, { pv: 3 })] };
  assert.deepEqual(D.validate(newer), [], 'an unknown pv is kept');
});

test('media.put: appends, replaces the metadata of the same id, returns the same doc when unchanged', () => {
  const start = basic();
  const one = reduce(start, { t: 'media.put', entry: LOGO });
  deepEqual(one.media.list, [LOGO]);
  const touched = D.touched(start, one);
  assert.equal(touched.media, true);
  assert.equal(touched.pins.size, 0);
  assert.equal(one.pins, start.pins);
  assert.equal(reduce(one, { t: 'media.put', entry: copy(LOGO) }), one, 'unchanged → the same doc');
  const two = reduce(one, { t: 'media.put', entry: withField(SEA, { dur: 12.51249, extra: 'dropped' }) });
  deepEqual(ids(two), [LOGO.id, SEA.id]);
  assert.equal(two.media.list[1].dur, 12.512, 'q3');
  assert.equal(two.media.list[1].extra, undefined, 'unknown fields are dropped');
  deepEqual(Object.keys(two.media.list[1]), ME.ORDER.slice());
  const renamed = reduce(two, { t: 'media.put', entry: withField(LOGO, { name: 'logo.png', pv: 2 }) });
  deepEqual(ids(renamed), [LOGO.id, SEA.id], 'replaced in place');
  deepEqual([renamed.media.list[0].name, renamed.media.list[0].pv], ['logo.png', 2]);
  assert.equal(renamed.media.list[1], two.media.list[1], 'the other entries are kept');
  const raw = JSON.parse(corpus.projectText('basic')).doc;       // a raw schema-1 doc without media
  deepEqual(reduce(raw, { t: 'media.put', entry: SKY }).media, { list: [SKY] });
});

test('media.put refuses bad entries, a changed kind and full libraries (count and bytes)', () => {
  const doc = media();
  throwsCode(() => reduce(doc, { t: 'media.put' }), 'payload');
  throwsCode(() => reduce(doc, { t: 'media.put', entry: 'a1c2e3f4a5b6c7d8e9f0a1b2c' }), 'payload');
  throwsCode(() => reduce(doc, { t: 'media.put', entry: withField(LOGO, { id: 'A1' }) }), 'payload');
  throwsCode(() => reduce(doc, { t: 'media.put', entry: withField(SEA, { codec: null }) }), 'payload');
  throwsCode(() => reduce(doc, { t: 'media.put', entry: withField(SEA, { kind: 'image', mime: 'image/png', dur: null, fps: null,
    frames: null, audio: false, codec: null }) }), 'payload', 'the kind of an asset cannot change');
  assert.throws(() => reduce(doc, { t: 'media.put', entry: withField(LOGO, { rot: 90 }) }), /rot/);
  const entry = (i, name) => withField(LOGO, { id: 'a' + i.toString(16).padStart(24, '0'), name });
  let full = basic();
  for (let i = 0; i < ME.LIMITS.library; i++) full = reduce(full, { t: 'media.put', entry: entry(i, 'p' + i + '.png') });
  assert.equal(full.media.list.length, 200);
  assert.deepEqual(D.validate(full), []);
  throwsCode(() => reduce(full, { t: 'media.put', entry: entry(999, 'more.png') }), 'payload');
  assert.ok(reduce(full, { t: 'media.put', entry: entry(5, 'renamed.png') }) !== full, 'replacing still works when full');
  let heavy = basic(), refused = -1;
  for (let i = 0; i < ME.LIMITS.library && refused < 0; i++) {
    try { heavy = reduce(heavy, { t: 'media.put', entry: entry(i, 'と'.repeat(80)) }); } catch (e) { assert.equal(e.code, 'payload'); refused = i; }
  }
  assert.ok(refused > 50 && refused < 200, 'the 96 KB cap refuses before 200 long-named entries: ' + refused);
  assert.ok(Buffer.byteLength(MV.use('core/hash').canonical(heavy.media)) <= ME.LIMITS.libraryBytes);
});

test('media.meta: name, pool and ai only; ai: null clears; the same validation', () => {
  const doc = media();
  const out = reduce(doc, { t: 'media.meta', id: SKY.id, name: '夕焼け.jpg', pool: false, w: 1, kind: 'video', mime: 'x' });
  deepEqual(out.media.list[1], withField(SKY, { name: '夕焼け.jpg', pool: false }), 'other fields are not patched');
  assert.equal(out.media.list[0], doc.media.list[0]);
  assert.equal(out.pins, doc.pins, 'a pool change keeps the pins (the planner stops picking the key)');
  assert.equal(reduce(doc, { t: 'media.meta', id: SKY.id, ai: null }).media.list[1].ai, null);
  const ai = { caption: { ja: '海', en: 'Sea' }, tags: ['wet'], colors: ['#00aaff'], subject: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, text: null };
  deepEqual(reduce(doc, { t: 'media.meta', id: SEA.id, ai }).media.list[2].ai, withField(ai, { colors: ['#00AAFF'] }));
  assert.equal(reduce(doc, { t: 'media.meta', id: SKY.id, name: SKY.name }), doc, 'unchanged → the same doc');
  assert.equal(reduce(doc, { t: 'media.meta', id: SKY.id }), doc);
  throwsCode(() => reduce(doc, { t: 'media.meta', id: 'a000000000000000000000000', name: 'x' }), 'payload');
  throwsCode(() => reduce(doc, { t: 'media.meta', id: SKY.id, name: '' }), 'payload');
  throwsCode(() => reduce(doc, { t: 'media.meta', id: SKY.id, pool: 1 }), 'payload');
  throwsCode(() => reduce(doc, { t: 'media.meta', id: SKY.id, ai: { tags: ['sunny'] } }), 'payload');
});

test('media.move: before an entry or to the end; no-op moves return the same doc', () => {
  const doc = media();
  deepEqual(ids(reduce(doc, { t: 'media.move', id: SPARK.id, before: LOGO.id })), [SPARK.id, LOGO.id, SKY.id, SEA.id]);
  deepEqual(ids(reduce(doc, { t: 'media.move', id: LOGO.id, before: null })), [SKY.id, SEA.id, SPARK.id, LOGO.id]);
  deepEqual(ids(reduce(doc, { t: 'media.move', id: LOGO.id })), [SKY.id, SEA.id, SPARK.id, LOGO.id], 'before omitted = the end');
  deepEqual(ids(reduce(doc, { t: 'media.move', id: SEA.id, before: SKY.id })), [LOGO.id, SEA.id, SKY.id, SPARK.id]);
  assert.equal(reduce(doc, { t: 'media.move', id: SEA.id, before: SPARK.id }), doc);
  assert.equal(reduce(doc, { t: 'media.move', id: SPARK.id, before: null }), doc);
  assert.equal(reduce(doc, { t: 'media.move', id: SKY.id, before: SKY.id }), doc);
  throwsCode(() => reduce(doc, { t: 'media.move', id: SKY.id, before: 'a000000000000000000000000' }), 'payload');
  throwsCode(() => reduce(doc, { t: 'media.move', id: 'nope', before: null }), 'payload');
});

test('media.remove: the entry, id pins, derived-key pins, @key paths and avoid items; material recipes are unchanged', () => {
  const doc = media();
  const sky = reduce(doc, { t: 'media.remove', id: SKY.id });
  deepEqual(ids(sky), [LOGO.id, SEA.id, SPARK.id]);
  assert.equal(sky.pins['line/r3:ground'], undefined, 'derived key value');
  assert.equal(sky.pins['line/r3:ground@myMed2d4f6a8b0c.blur'], undefined, '@key path');
  deepEqual(sky.pins['line/r5:avoid'], { v: ['filter.sliceGlitch'], by: 'user' }, 'avoid item');
  deepEqual(ME.refsOf(sky, SKY.id), { pins: [], materials: [] });
  assert.equal(sky.materials, doc.materials);
  const logo = reduce(doc, { t: 'media.remove', id: LOGO.id });
  assert.equal(logo.pins['line/r2:ornament#0@photoFrame.src'], undefined, 'id value');
  deepEqual(logo.pins['line/r2:ornament#0'], { v: 'photoFrame', by: 'user' }, 'the part pin stays (the UI clears it in its batch)');
  const sea = reduce(doc, { t: 'media.remove', id: SEA.id });
  assert.equal(sea.pins['work:ground@photoPan.image'], undefined);
  assert.equal(sea.materials, doc.materials, 'the material keeps its src; its layer draws nothing');
  assert.equal(sea.materials.list[0].recipe.layers[0].src, SEA.id);
  deepEqual(ME.refsOf(sea, SEA.id), { pins: [], materials: ['m1'] });
  const onlyAvoid = reduce(doc, { t: 'pin.set', path: 'line/r4:avoid', v: ['ground.myMed2d4f6a8b0c'], by: 'user' });
  assert.equal(reduce(onlyAvoid, { t: 'media.remove', id: SKY.id }).pins['line/r4:avoid'], undefined, 'an emptied avoid list goes');
  const spark = reduce(doc, { t: 'media.remove', id: SPARK.id });
  assert.equal(spark.pins, doc.pins, 'no references → the same pins');
  throwsCode(() => reduce(doc, { t: 'media.remove', id: 'a000000000000000000000000' }), 'payload');
});

test('media.relink: a video — the entry takes the old place, pin values and material src move, rhash changes', () => {
  const doc = media();
  const out = reduce(doc, { t: 'media.relink', from: SEA.id, entry: NEW_VIDEO });
  deepEqual(ids(out), [LOGO.id, SKY.id, NEW_VIDEO.id, SPARK.id]);
  deepEqual(out.pins['work:ground@photoPan.image'], { v: NEW_VIDEO.id, by: 'user' });
  const m0 = doc.materials.list[0], m1 = out.materials.list[0];
  assert.equal(m1.recipe.layers[0].src, NEW_VIDEO.id);
  deepEqual(m1.recipe, R.normalize('ornament', withField(m0.recipe, { layers: [withField(m0.recipe.layers[0], { src: NEW_VIDEO.id })] })).recipe);
  assert.notEqual(R.hash(m1.recipe), R.hash(m0.recipe), 'the rhash changes');
  deepEqual(withField(m1, { recipe: null }), withField(m0, { recipe: null }), 'only the recipe changes');
  assert.equal(out.materials.next, doc.materials.next);
  deepEqual(ME.refsOf(out, SEA.id), { pins: [], materials: [] });
  deepEqual(ME.refsOf(out, NEW_VIDEO.id), { pins: ['work:ground@photoPan.image'], materials: ['m1'] });
  assert.deepEqual(D.validate(out), []);
});

test('media.relink: a pooled photo — derived key values, @key paths and avoid items move to the new key', () => {
  const doc = media();
  const key = ME.keyOf(NEW_IMAGE.id);
  assert.equal(key, 'myMed6e7f8091a2');
  const out = reduce(doc, { t: 'media.relink', from: SKY.id, entry: NEW_IMAGE });
  deepEqual(ids(out), [LOGO.id, NEW_IMAGE.id, SEA.id, SPARK.id]);
  deepEqual(out.pins['line/r3:ground'], { v: key, by: 'user' });
  assert.equal(out.pins['line/r3:ground@myMed2d4f6a8b0c.blur'], undefined);
  deepEqual(out.pins['line/r3:ground@' + key + '.blur'], { v: 12, by: 'user' });
  deepEqual(out.pins['line/r5:avoid'].v, ['filter.sliceGlitch', 'ground.' + key]);
  assert.equal(out.materials, doc.materials, 'no material uses the photo');
  deepEqual(ME.refsOf(out, NEW_IMAGE.id).pins, ['line/r3:ground', 'line/r3:ground@' + key + '.blur', 'line/r5:avoid']);
  // a rewritten path wins over a pin already at the new path
  const clash = reduce(doc, { t: 'pin.set', path: 'line/r3:ground@' + key + '.blur', v: 40, by: 'ai' });
  deepEqual(reduce(clash, { t: 'media.relink', from: SKY.id, entry: NEW_IMAGE }).pins['line/r3:ground@' + key + '.blur'], { v: 12, by: 'user' });
  // relinking to an asset already in the library keeps its place and removes `from`
  const existing = reduce(doc, { t: 'media.relink', from: SEA.id, entry: SPARK });
  deepEqual(ids(existing), [LOGO.id, SKY.id, SPARK.id]);
  assert.equal(existing.materials.list[0].recipe.layers[0].src, SPARK.id);
  assert.deepEqual(D.validate(existing), []);
});

test('media.relink refuses other kinds, the same asset, unknown sources and bad entries', () => {
  const doc = media();
  throwsCode(() => reduce(doc, { t: 'media.relink', from: SEA.id, entry: NEW_IMAGE }), 'payload');
  throwsCode(() => reduce(doc, { t: 'media.relink', from: SKY.id, entry: NEW_VIDEO }), 'payload');
  throwsCode(() => reduce(doc, { t: 'media.relink', from: SKY.id, entry: SKY }), 'payload');
  throwsCode(() => reduce(doc, { t: 'media.relink', from: NEW_IMAGE.id, entry: SKY }), 'payload');
  throwsCode(() => reduce(doc, { t: 'media.relink', from: SKY.id }), 'payload');
  throwsCode(() => reduce(doc, { t: 'media.relink', from: SKY.id, entry: withField(NEW_IMAGE, { w: 0 }) }), 'payload');
});

test('undo restores deep-equal documents across media commands; one relink is one undo step', () => {
  const start = media();
  const store = createStore({ doc: start, reduce, freeze: true });
  store.dispatch({ t: 'media.put', entry: NEW_IMAGE });
  store.dispatch({ t: 'media.meta', id: NEW_IMAGE.id, pool: true, name: '新しい空.jpg' });
  store.dispatch({ t: 'media.move', id: NEW_IMAGE.id, before: LOGO.id });
  const beforeRelink = store.doc;
  store.dispatch({ t: 'media.relink', from: SEA.id, entry: NEW_VIDEO });
  assert.ok(store.undo());
  assert.equal(store.doc, beforeRelink, 'one step');
  store.redo();
  store.dispatch({ t: 'media.remove', id: SKY.id });
  store.dispatch({ t: 'batch', cmds: [{ t: 'media.remove', id: LOGO.id }, { t: 'pin.clear', path: 'line/r2:ornament#0' }] });
  while (store.undo()) { /* all the way back */ }
  deepEqual(store.doc, start);
  store.redo();
  assert.equal(store.doc.media.list.length, 5);
});

// ---- the property test ----------------------------------------------------------------------------------------------

const POOL = [LOGO, SKY, SEA, SPARK, NEW_VIDEO, NEW_IMAGE,
  withField(LOGO, { id: 'a7c8d9e0f1a2b3c4d5e6f7081', name: 'gif.gif', mime: 'image/gif', anim: true, dur: 2, fps: 10, frames: 20, pool: true }),
  withField(SPARK, { id: 'a8d9e0f1a2b3c4d5e6f708192', name: 'loop.webm', pool: true })];

function randomCommand(rng, doc) {
  const list = doc.media.list;
  const pick = list.length ? rng.pick(list) : null;
  switch (rng.int(0, 9)) {
    case 0: case 1: return { t: 'media.put', entry: rng.chance(0.2) && pick ? withField(pick, { name: 'n' + rng.int(0, 3) }) : rng.pick(POOL) };
    case 2: return pick ? { t: 'media.meta', id: pick.id, pool: rng.chance(0.5), ai: rng.chance(0.3) ? null : undefined } : null;
    case 3: return pick ? { t: 'media.move', id: pick.id, before: rng.chance(0.3) ? null : rng.pick(list).id } : null;
    case 4: return pick ? { t: 'media.remove', id: pick.id } : null;
    case 5: case 6: {
      if (!pick) return null;
      const to = POOL.filter((e) => e.kind === pick.kind && e.id !== pick.id);
      return { t: 'media.relink', from: pick.id, entry: rng.pick(to) };
    }
    case 7: return pick ? { t: 'pin.set', path: rng.pick(['work:ground@photoPan.image', 'line/r2:ornament#0@photoFrame.src']), v: pick.id, by: 'user' } : null;
    case 8: return pick ? { t: 'pin.set', path: 'line/r' + rng.int(2, 5) + ':ground', v: ME.keyOf(pick.id), by: 'ai' } : null;
    default: return pick ? { t: 'batch', cmds: [
      { t: 'pin.set', path: 'work:ground@' + ME.keyOf(pick.id) + '.blur', v: rng.int(0, 60), by: 'user' },
      { t: 'pin.set', path: 'line/r' + rng.int(2, 5) + ':avoid', v: ['ground.' + ME.keyOf(pick.id)], by: 'user' }] } : null;
  }
}

test('property: 500 random media command sequences — valid docs, references follow, replay and undo', () => {
  const rng = stream('media-property');
  const startText = JSON.stringify(media());
  let commands = 0;
  for (let n = 0; n < 500; n++) {
    const store = createStore({ doc: JSON.parse(startText), reduce, freeze: true });
    const log = [];
    for (let s = rng.int(1, 14); s > 0; s--) {
      const cmd = randomCommand(rng, store.doc);
      if (!cmd) continue;
      const before = store.doc;
      store.dispatch(cmd);
      log.push(cmd);
      commands++;
      assert.deepEqual(D.validate(store.doc), [], JSON.stringify(cmd));
      if (cmd.t === 'media.remove') assert.deepEqual(ME.refsOf(store.doc, cmd.id).pins, [], 'no pin refers to a removed asset');
      if (cmd.t === 'media.relink') {
        deepEqual(ME.refsOf(store.doc, cmd.from), { pins: [], materials: [] }, 'nothing refers to the old asset');
        const moved = ME.refsOf(before, cmd.from);
        assert.ok(ME.refsOf(store.doc, cmd.entry.id).pins.length >= Math.min(1, moved.pins.length), 'references moved');
      }
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
