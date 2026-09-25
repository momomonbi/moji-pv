/* 文字PVメーカー v2 — original work. Tests for ai/recipe and the recipe text of ai/catalog: AI materials, answer → entry and back, the standalone material tool (DESIGN_2_1 §5.10, §5.11, §11.5.8). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { deepEqual } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const RECIPE = MV.use('ai/recipe');
const CAT = MV.use('ai/catalog');
const CH = MV.use('ai/changes');
const RC = MV.use('core/recipe');
const REG = MV.use('core/registry');
const S = MV.use('core/schema');
const CMD = MV.use('core/commands');
const M = MV.use('core/migrate');
const PL = MV.use('planner/plan');

const reg = MV.use('parts/catalog').defaultRegistry();
const DOC = M.parseFile(corpus.projectText('v21')).doc;
const PLAN = PL.plan(DOC, { registry: reg });

const CURVE = (name, x) => Object.assign({ name, ends: 'both', edge: -1, peak: -1 }, x);
function layer(x) {
  return Object.assign({ prim: 'particles', shape: 'petal', glyph: '', inks: ['#F4B4C6', 'accent'], alpha: 0.85, layer: 'near', anchor: 'frame',
    x: 0, y: 0, spread: 1.15, sizeMin: 0.012, sizeMax: 0.022, count: 60, stroke: 0, dir: 115, speed: 0.09, sway: 26, swayHz: 0.35,
    spin: 60, burst: 'none', move: 'none', moveWhat: 'scale', moveAmp: 0, moveHz: 0, appear: 'always', draw: 'fade', style: '',
    pattern: '', stops: [], angle: 0 }, x);
}
function ai(x) {
  return Object.assign({ name: '桜吹雪', nameEn: 'Cherry flurry', kind: 'ornament', scope: 'run', season: 'spring', tags: ['organic', 'soft'],
    blurb: '花びらが斜めに舞う', base: '', params: [], parts: [], layers: [layer({})], unit: 'glyph', order: 'lead', dur: -1, each: -1,
    tracks: [], curve: CURVE(''), osc: [], knobs: [], use: { slot: 'none', s: 0, lines: [], cuts: [] } }, x);
}
const MEDIA_LIST = [{ n: 0, id: 'a1c2e3f4a5b6c7d8e9f0a1b2c', kind: 'image', anim: false, alpha: true, dur: null },
  { n: 1, id: 'a3f9c2d17b0e4a5c6d7e8f901', kind: 'video', anim: false, alpha: false, dur: 12.512 }];

// Every property of a closed schema present with its type (the answers the AI writes must pass this).
function conforms(value, schema, where = '') {
  if (schema.type === 'object') {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), where + ' object');
    deepEqual(Object.keys(value).sort(), [...schema.required].sort(), where + ' keys');
    for (const k of schema.required) conforms(value[k], schema.properties[k], where + '.' + k);
  } else if (schema.type === 'array') {
    assert.ok(Array.isArray(value), where + ' array');
    value.forEach((v, i) => conforms(v, schema.items, where + '[' + i + ']'));
  } else if (schema.type === 'integer') assert.ok(Number.isInteger(value), where + ' integer');
  else if (schema.type === 'number') assert.ok(Number.isFinite(value), where + ' number');
  else if (schema.type === 'boolean') assert.equal(typeof value, 'boolean', where);
  else {
    assert.equal(typeof value, 'string', where + ' string');
    if (schema.enum) assert.ok(schema.enum.includes(value), where + ' in enum: ' + value);
  }
}

function valid(entry) {
  deepEqual(RC.entryProblems(Object.assign({ id: 'm9' }, entry)), [], 'entry');
  deepEqual(RC.problems(entry.kind, entry.recipe, { registry: reg }), [], 'recipe');
}

// ---- schema ------------------------------------------------------------------------------------------------------------

test('AI_MATERIAL: the flat closed form of §5.10; the media variant adds layers.media and the prim media', () => {
  const p = RECIPE.AI_MATERIAL.properties;
  deepEqual(Object.keys(p), ['name', 'nameEn', 'kind', 'scope', 'season', 'tags', 'blurb', 'base', 'params', 'parts', 'layers', 'unit', 'order',
    'dur', 'each', 'tracks', 'curve', 'osc', 'knobs', 'use']);
  deepEqual(p.kind.enum, RC.MAT_KINDS);
  deepEqual(p.season.enum, ['', 'any', 'none', 'spring', 'summer', 'autumn', 'winter']);
  deepEqual(p.use.properties.slot.enum, ['none', 'atmos', 'ornament', 'ground', 'arrange', 'arrive', 'depart', 'dwell', 'lens', 'filter', 'seam']);
  const l = p.layers.items.properties;
  assert.ok(!('media' in l) && !l.prim.enum.includes('media'));
  deepEqual(l.shape.enum, [''].concat(RC.SHAPES));
  deepEqual(p.osc.items.properties.col.enum, ['x', 'y', 'rot', 'sx', 'alpha', 'glow', 'tint', 'roll', 'zoom']);
  deepEqual(p.osc.items.properties.phase.enum, ['same', 'index', 'rnd', 'word']);
  const lm = RECIPE.AI_MATERIAL_MEDIA.properties.layers.items.properties;
  assert.ok(lm.media.type === 'string' && lm.prim.enum.includes('media'));
  deepEqual(Object.keys(RECIPE.MATERIAL_SCHEMA.properties), ['understood', 'question', 'material']);
  assert.equal(RECIPE.MATERIAL_SCHEMA_MEDIA.properties.material, RECIPE.AI_MATERIAL_MEDIA);
  assert.ok(Object.isFrozen(RECIPE.AI_MATERIAL.properties.layers.items.properties.inks));
  conforms(ai({}), RECIPE.AI_MATERIAL);
});

// ---- fromAi -----------------------------------------------------------------------------------------------------------

test('fromAi: numbers clamped, enums defaulted, knobs from words, seed from the name; the entry is valid', () => {
  const res = RECIPE.fromAi(ai({ name: '  ', nameEn: 'x'.repeat(40), season: 'any', tags: ['soft', 'loud', 'soft'], knobs: ['count', 'speed', 'nope', 'count', 'amp', 'size', 'alpha'],
    layers: [layer({ alpha: 3, x: 2, spread: -1, sizeMin: 5, sizeMax: 0.001, shape: '', layer: 'ground', count: 30, dir: 400, burst: 'boom',
      move: 'sine', moveWhat: 'x', moveAmp: 5, moveHz: 9, appear: 'arrive', draw: 'grow' })] }), reg);
  assert.deepEqual(res.warnings, []);
  const e = res.entry;
  valid(e);
  deepEqual(e.name, { ja: '名前のない素材', en: 'x'.repeat(24) });
  assert.deepEqual([e.by, e.pool, e.season, e.kind], ['ai', false, null, 'ornament']);
  deepEqual(e.tags, ['soft']);
  deepEqual(e.recipe.knobs, [{ what: 'count' }, { what: 'speed' }, { what: 'amp' }, { what: 'size' }], 'known words, ≤ 4');
  assert.deepEqual([e.recipe.scope, e.recipe.follow], ['run', 'own']);
  assert.equal(e.recipe.seed, MV.use('core/hash').hash32('material', '名前のない素材'));
  const l = e.recipe.layers[0];
  assert.deepEqual([l.alpha, l.place.x, l.place.spread, l.shape, l.layer, l.field.dir, l.field.burst], [1, 0.5, 0, 'dot', 'mid', 40, 'none']);
  deepEqual(l.size, [0.002, 1.2]);
  deepEqual(l.move, [{ amp: 0.5, curve: null, hz: 4, phase: 'rnd', wave: 'sine', what: 'x' }]);
  deepEqual(l.appear, { at: 'arrive', draw: 'grow', dur: 0.5 });
  deepEqual(l.rot, [0, 360], 'particles spin from any angle');
  const plain = RECIPE.fromAi(ai({ layers: [layer({ appear: 'always', move: 'none' })] }), reg).entry.recipe.layers[0];
  deepEqual(plain.appear, { at: 'start', draw: 'none', dur: 0 });
  deepEqual(plain.move, []);
});

test('fromAi: "ink@pos" stops; a ground starts with a fill', () => {
  const g = RECIPE.fromAi(ai({ kind: 'ground', scope: 'cut', season: '', layers: [
    layer({ prim: 'pattern', pattern: 'dots', layer: 'far', inks: ['ground2'], count: 1 }),
    layer({ prim: 'fill', layer: 'ground', stops: ['accent@1', '#f7e3ea@0', 'bad', 'ink@x', '@1'], angle: 30 }),
  ] }), reg);
  valid(g.entry);
  const [fill, pattern] = g.entry.recipe.layers;
  assert.equal(fill.prim, 'fill', 'the fill moves to the front');
  deepEqual(fill.fill, { angle: 30, stops: [['#F7E3EA', 0], ['accent', 1]], type: 'linear' });
  assert.equal(pattern.pattern, 'dots');
  const none = RECIPE.fromAi(ai({ kind: 'ground', layers: [layer({ prim: 'shape', shape: 'star', count: 5, layer: 'far' })] }), reg).entry;
  valid(none);
  deepEqual(none.recipe.layers[0].fill.stops, [['ground', 0], ['ground2', 1]], 'a default fill is added');
});

test('fromAi: variants read params through the base part\'s specs; arrive/depart shared autos; bases are base parts only', () => {
  const v = RECIPE.fromAi(ai({ kind: 'arrive', base: 'inkRise', params: [{ name: 'yFrom', value: '1.2' }, { name: 'blurFrom', value: 'lots' },
    { name: 'bogus', value: '1' }, { name: 'amount', value: '0.5' }], dur: 1.1, each: 0.02, curve: CURVE('softEnds'), order: 'word', layers: [] }), reg);
  valid(v.entry);
  deepEqual(v.entry.recipe, { base: 'inkRise', params: { yFrom: 1.2 },
    shared: { dur: { value: 1.1 }, each: { value: 0.02 }, ease: { value: 'softEnds' }, order: { value: 'word' } } });
  const arrange = RECIPE.fromAi(ai({ kind: 'arrange', base: 'stairStep', params: [{ name: 'steps', value: '9' }, { name: 'dir', value: 'back' }], layers: [] }), reg).entry;
  deepEqual(arrange.recipe, { base: 'stairStep', params: { dir: 'back', steps: 4 }, shared: {} });
  const seam = RECIPE.fromAi(ai({ kind: 'seam', base: 'blendDissolve', params: [{ name: 'soften', value: '8' }] }), reg).entry;
  deepEqual(seam.recipe.params, { soften: 8 });
  for (const base of ['myMat3', 'flashPop', 'nope']) {
    const r = RECIPE.fromAi(ai({ kind: 'filter', base, parts: [] }), reg);
    assert.equal(r.entry, null, base);
    assert.ok(r.warnings.some((w) => w[0] === 'ai.warn.unknown' && w[1].key === base) && r.warnings.some((w) => w[0] === 'ai.warn.matEmpty'));
  }
  assert.equal(RECIPE.fromAi(ai({ kind: 'arrange', base: '' }), reg).entry, null, 'arrange is a variant only');
  assert.equal(RECIPE.fromAi(ai({ kind: 'seam', base: '' }), reg).entry, null, 'seam is a variant only');
  assert.equal(RECIPE.fromAi(ai({ kind: 'dwell' }), reg, 'ornament').entry.kind, 'ornament', 'the kind asked for wins');
});

test('fromAi: composite motion, oscillators, parts and filters', () => {
  const arrive = RECIPE.fromAi(ai({ kind: 'arrive', layers: [], unit: 'word', order: 'core', dur: 0.8, each: -1, curve: CURVE('ramp', { ends: 'start', edge: 0.2, peak: 5 }),
    tracks: [{ col: 'y', from: 0.6, to: 0.3 }, { col: 'alpha', from: 0, to: 0.5 }, { col: 'y', from: 1, to: 0 }] }), reg).entry;
  valid(arrive);
  deepEqual(arrive.recipe.motion, { colCurve: {}, curve: { ramp: { edge: 0.2, ends: 'start', peak: 5 } }, dur: [0.8, 0.8],
    each: REG.SHARED.arrive.each.auto.range, order: ['core'], tracks: [{ col: 'y', from: 0.6, to: 0 }, { col: 'alpha', from: 0, to: 1 }], unit: 'word' },
  'an entrance ends at rest; a repeated column is dropped');
  const dwell = RECIPE.fromAi(ai({ kind: 'dwell', layers: [], osc: [{ col: 'y', amp: 0.06, hz: 0.5, wave: 'sine', phase: 'index' },
    { col: 'roll', amp: 1, hz: 1, wave: 'sine', phase: 'same' }], parts: [{ key: 'swaySwing', params: [{ name: 'angle', value: '2' }] }] }), reg).entry;
  valid(dwell);
  deepEqual(dwell.recipe.osc, [{ amp: 0.06, col: 'y', hz: 0.5, phase: 'index', step: 0.3, wave: 'sine' }], 'roll is a lens column');
  deepEqual(dwell.recipe.parts, [{ key: 'swaySwing', params: { angle: 2 } }]);
  const lens = RECIPE.fromAi(ai({ kind: 'lens', layers: [], osc: [{ col: 'zoom', amp: 0.5, hz: 1, wave: 'beat', phase: 'index' }] }), reg).entry;
  deepEqual(lens.recipe.osc, [{ amp: 0.08, col: 'zoom', hz: 1, phase: 'same', step: 0, wave: 'beat' }]);
  const filter = RECIPE.fromAi(ai({ kind: 'filter', layers: [], parts: [{ key: 'grainFilm', params: [] }, { key: 'flashPop', params: [] }, { key: 'paperTooth', params: [] }] }), reg);
  deepEqual(filter.entry.recipe, { mix: [1, 1], parts: [{ key: 'grainFilm', params: {} }, { key: 'paperTooth', params: {} }] }, 'a flash-gated effect never');
  valid(filter.entry);
  const orn = RECIPE.fromAi(ai({ scope: 'cut', layers: [], parts: [{ key: 'petalFall', params: [] }, { key: 'cornerTicks', params: [{ name: 'size', value: '0.05' }] }] }), reg).entry;
  deepEqual(orn.recipe.parts, [{ key: 'cornerTicks', params: { size: 0.05 } }], 'inner ornaments have the material\'s scope');
});

test('fromAi: over the budget → counts × 0.9 until it fits (ai.warn.matScaled)', () => {
  const heavy = ai({ scope: 'cut', knobs: ['count'], layers: [0, 1, 2].map(() => layer({ count: 200 })).concat([layer({ prim: 'shape', shape: 'star', count: 24, layer: 'mid', anchor: 'corners' })]) });
  const res = RECIPE.fromAi(heavy, reg);
  assert.ok(res.warnings.some((w) => w[0] === 'ai.warn.matScaled' && w[1].name === '桜吹雪'));
  valid(res.entry);
  const c = RC.cost('ornament', res.entry.recipe);
  assert.ok(c.particles <= RC.LIMITS.particles && c.ms <= RC.LIMITS.ms.ornamentCut, JSON.stringify(c));
  const counts = res.entry.recipe.layers.map((l) => l.count);
  assert.ok(counts[0] < 200 && counts[0] === counts[1], counts.join(','));
  // deterministic
  deepEqual(RECIPE.fromAi(heavy, reg), res);
});

test('fromAi: the flash rule: a big layer that blinks is calmed (ai.warn.matFlash)', () => {
  const blink = ai({ scope: 'cut', layers: [layer({ prim: 'fill', layer: 'far', stops: ['accent@0', 'ground@1'], move: 'beat', moveWhat: 'alpha', moveAmp: 0.9, moveHz: 2 }),
    layer({ prim: 'pattern', pattern: 'stripes', layer: 'far', move: 'sine', moveWhat: 'alpha', moveAmp: 0.2, moveHz: 4, count: 1 })], knobs: ['speed'] });
  assert.ok(RC.problems('ornament', RC.normalize('ornament', {
    layers: [{ prim: 'fill', layer: 'far', move: [{ what: 'alpha', wave: 'beat', amp: 0.9, hz: 2 }] }] }).recipe).some((p) => p.code === 'flash'), 'refused as it is');
  const res = RECIPE.fromAi(blink, reg);
  assert.ok(res.warnings.some((w) => w[0] === 'ai.warn.matFlash'));
  valid(res.entry);
  const [a, b] = res.entry.recipe.layers;
  deepEqual(a.move, [{ amp: 0.35, curve: null, hz: 1, phase: 'rnd', wave: 'sine', what: 'alpha' }]);
  deepEqual([b.move[0].hz, b.move[0].amp], [1.5, 0.2], 'hz × the speed knob maximum (2) ≤ 3');
  const small = RECIPE.fromAi(ai({ layers: [layer({ move: 'beat', moveWhat: 'alpha', moveAmp: 0.9 })] }), reg);
  assert.ok(!small.warnings.length, 'small particles may blink');
  assert.equal(small.entry.recipe.layers[0].move[0].wave, 'beat');
});

test('fromAi: an empty or unreadable answer gives null (ai.warn.matEmpty)', () => {
  for (const x of [null, 'x', {}, ai({ kind: 'nope' }), ai({ layers: [] }), ai({ kind: 'dwell', layers: [] }), ai({ kind: 'arrive', layers: [], tracks: [] })]) {
    const r = RECIPE.fromAi(x, reg);
    assert.equal(r.entry, null);
    assert.ok(r.warnings.some((w) => w[0] === 'ai.warn.matEmpty'));
  }
});

test('media layers: "asset:<n>" from the request list, "" is the part param; unknown warns; not offered → none', () => {
  const x = ai({ scope: 'cut', layers: [layer({ prim: 'media', media: '', shape: 'roundRect', stroke: 0.008, sizeMin: 0.4, sizeMax: 0.4, layer: 'mid', anchor: 'focus' }),
    layer({ prim: 'media', media: 'asset:1', shape: 'ellipse', sizeMin: 0.3, sizeMax: 0.3 }), layer({ prim: 'media', media: 'asset:7' })] });
  const res = RECIPE.fromAi(x, reg, null, { media: MEDIA_LIST });
  assert.ok(res.warnings.some((w) => w[0] === 'ai.warn.mediaUnknown' && w[1].name === 'asset:7'));
  valid(res.entry);
  const [free, fixed] = res.entry.recipe.layers;
  assert.deepEqual([free.prim, free.src, free.shape, free.border, free.fit, free.comp], ['media', '', 'round', 8, 'cover', 'over']);
  assert.deepEqual([fixed.src, fixed.shape], [MEDIA_LIST[1].id, 'circle']);
  assert.equal(res.entry.recipe.layers.length, 2);
  assert.ok(RC.knobSpecs('ornament', res.entry.recipe).src, 'the part param src for the free layer');
  const without = RECIPE.fromAi(x, reg);
  assert.equal(without.entry, null, 'no media offered: the media layers are left out');
  const toAiMedia = RECIPE.toAi(res.entry, { media: MEDIA_LIST });
  deepEqual(toAiMedia.layers.map((l) => l.media), ['', 'asset:1']);
  conforms(toAiMedia, RECIPE.AI_MATERIAL_MEDIA);
});

// ---- toAi ---------------------------------------------------------------------------------------------------------

test('toAi ∘ fromAi: every material fromAi makes survives the round trip, and toAi answers the closed schema', () => {
  const cases = [
    ai({}),
    ai({ scope: 'cut', season: '', knobs: ['count', 'alpha'], layers: [layer({ move: 'sine', moveWhat: 'rot', moveAmp: 20, moveHz: 0.5, appear: 'beat', draw: 'grow' }),
      layer({ prim: 'frame', style: 'brackets', stroke: 0.004, layer: 'near', anchor: 'focus' }), layer({ prim: 'glyphs', glyph: '♪', count: 12 })],
      parts: [{ key: 'cornerTicks', params: [{ name: 'size', value: '0.05' }] }] }),
    ai({ kind: 'ground', layers: [layer({ prim: 'fill', layer: 'ground', stops: ['ground@0', '#112233@1'], angle: 45 }),
      layer({ prim: 'pattern', pattern: 'waves', layer: 'far', count: 1, move: 'ramp', moveWhat: 'x', moveAmp: 0.1 })] }),
    ai({ kind: 'arrive', layers: [], tracks: [{ col: 'x', from: -2, to: 0 }], dur: 0.9, each: 0.05, curve: CURVE('holdThenDash'), unit: 'line', order: 'tail' }),
    ai({ kind: 'depart', layers: [], tracks: [{ col: 'sy', from: 1, to: 3 }], curve: CURVE('ramp', { ends: 'end', edge: 0.1, peak: 3 }) }),
    ai({ kind: 'dwell', layers: [], osc: [{ col: 'rot', amp: 4, hz: 1, wave: 'tri', phase: 'word' }] }),
    ai({ kind: 'lens', layers: [], osc: [{ col: 'x', amp: 10, hz: 0.2, wave: 'noise', phase: 'same' }] }),
    ai({ kind: 'filter', layers: [], parts: [{ key: 'grainFilm', params: [{ name: 'size', value: '2' }] }] }),
    ai({ kind: 'arrive', base: 'inkRise', params: [{ name: 'yFrom', value: '1.2' }], dur: 1.1, curve: CURVE('softEnds'), order: 'word', layers: [] }),
    ai({ kind: 'arrange', base: 'stairStep', params: [{ name: 'dir', value: 'back' }], layers: [] }),
    ai({ kind: 'seam', base: 'blendDissolve', params: [] }),
  ];
  for (const x of cases) {
    const e = RECIPE.fromAi(x, reg).entry;
    assert.ok(e, x.kind);
    const back = RECIPE.toAi(e);
    conforms(back, RECIPE.AI_MATERIAL, x.kind);
    deepEqual(RECIPE.fromAi(back, reg, e.kind).entry, e, x.kind + ' round trip');
    deepEqual(RECIPE.toAi(RECIPE.fromAi(back, reg, e.kind).entry), back, x.kind + ' toAi is stable');
  }
  // hand-made entries read too (the fixture's materials), within what the flat form can say
  for (const m of DOC.materials.list) conforms(RECIPE.toAi(m), RECIPE.AI_MATERIAL, m.id);
});

// ---- the recipe text (§5.10 drift guard) -------------------------------------------------------------------------------

test('recipeText: ≤ 2,000 characters with and without media, and it names every vocabulary word of core/recipe', () => {
  const plain = CAT.recipeText(), media = CAT.recipeText({ media: true });
  for (const text of [plain, media]) assert.ok(text.length <= 2000 && Array.from(text).length <= 2000, text.length + ' characters');
  const words = new Set(media.split(/[\s,;:()[\]{}|."]+/));
  const vocab = [].concat(RC.MAT_KINDS, RC.PRIMS, RC.SHAPES, RC.GLYPHS, RC.ANCHORS, RC.LAYERS.ornament, RC.LAYERS.ground, RC.WAVES, RC.MOVE_WHAT,
    RC.APPEAR_AT, RC.DRAWS, RC.FRAME_STYLES, RC.PATTERNS, RC.BURSTS, RC.MOTION_COLS, RC.OSC_COLS_DWELL, RC.OSC_COLS_LENS, RC.PHASES,
    RC.KNOB_WHATS, RC.UNITS);
  assert.deepEqual(vocab.filter((w) => !words.has(w)), [], 'every word is listed');
  assert.ok(!plain.split(/[\s,;:()[\]{}|."]+/).includes('media'), 'no media without media');
  assert.ok(plain.includes('mat:<name>') && plain.includes('use:'));
});

// ---- the standalone tool ------------------------------------------------------------------------------------------

test('materialRequest: the kind, the description, the parts of the kind and the recipe text; a remake sends the material', () => {
  const q = RECIPE.materialRequest(DOC, PLAN, reg, { description: '文字が花びらのように\n舞って着地する', kind: 'arrive', uiLang: 'ja' });
  assert.equal(q.effort, 'medium');
  assert.equal(q.schema, RECIPE.MATERIAL_SCHEMA);
  assert.ok(q.system.includes('kind must be "arrive"') && q.system.includes('never code'));
  assert.ok(q.prompt.includes('Description: 文字が花びらのように 舞って着地する'));
  assert.ok(q.prompt.includes('[arrive] ') && q.prompt.includes('inkRise=墨のぼり') && !q.prompt.includes('[dwell] '));
  assert.ok(q.prompt.includes(CAT.recipeText()));
  assert.ok(!/飛ばせ|始発のホーム/.test(q.prompt), 'no lyrics');
  deepEqual(q.sent, { kind: 'arrive', current: null, media: [], lang: 'ja' });
  const remake = RECIPE.materialRequest(DOC, PLAN, reg, { description: 'もっと多く', current: DOC.materials.list[2], uiLang: 'en', media: MEDIA_LIST });
  assert.equal(remake.sent.kind, 'ornament');
  assert.equal(remake.sent.current, 'm3');
  assert.ok(remake.prompt.includes('Current material (remake it): ' + JSON.stringify(RECIPE.toAi(DOC.materials.list[2], { media: MEDIA_LIST }))));
  assert.ok(remake.prompt.includes('[atmos] ') && remake.prompt.includes('[media]'));
  assert.equal(remake.schema, RECIPE.MATERIAL_SCHEMA_MEDIA);
});

test('materialChanges: one material change, plus with useAt one pin that requires it; a remake keeps the id', () => {
  const q = RECIPE.materialRequest(DOC, PLAN, reg, { description: 'x', kind: 'ornament', uiLang: 'ja' });
  const json = { understood: true, question: '', material: ai({ scope: 'cut', season: '' }) };
  const r = RECIPE.materialChanges(DOC, PLAN, reg, json, { rev: 2, sent: q.sent, useAt: { scope: 'line/rc', slot: 'ornament' } });
  assert.equal(r.changes.length, 2);
  const [mat, pin] = r.changes;
  assert.deepEqual([mat.kind, mat.group, mat.plannedId, mat.materialId, mat.base.rev], ['material', 'materials', 'm4', null, 2]);
  assert.deepEqual([pin.path, pin.to, pin.requires, pin.group], ['line/rc:ornament#0', 'mat:桜吹雪', [mat.id], 'lines']);
  const cmds = CH.toCommands(DOC, PLAN, r.changes);
  deepEqual(cmds.map((c) => [c.t, c.id || c.path, c.v]), [['material.put', 'm4', undefined], ['pin.set', 'line/rc:ornament#0', 'myMat4']]);
  const after = CMD.reduce(DOC, { t: 'batch', cmds });
  assert.equal(after.materials.list[3].name.ja, '桜吹雪');
  // a cut scope carries the cut's words; a free list index is picked around user pins
  const busy = CMD.reduce(DOC, { t: 'pin.set', path: 'line/rb:ornament#0', v: 'barCode', by: 'user' });
  const c = RECIPE.materialChanges(busy, PLAN, reg, json, { rev: 2, sent: q.sent, useAt: { scope: 'cut/rb~3', slot: 'ornament' } });
  assert.deepEqual([c.changes[1].path, c.changes[1].cutSig], ['cut/rb~3:ornament#1', '紙ひこうき']);
  deepEqual(CH.toCommands(busy, PLAN, c.changes)[1], { t: 'pin.set', path: 'cut/rb~3:ornament#1', v: 'myMat4', by: 'ai', sig: '紙ひこうき' });
  // the remake of m3: same id and name, the AI's recipe
  const rq = RECIPE.materialRequest(DOC, PLAN, reg, { description: 'x', current: DOC.materials.list[2], uiLang: 'ja' });
  const rm = RECIPE.materialChanges(DOC, PLAN, reg, { understood: true, question: '', material: ai({ name: '別名', layers: [layer({ count: 30 })] }) }, { rev: 2, sent: rq.sent });
  assert.deepEqual([rm.changes[0].materialId, rm.changes[0].entry.name.ja, rm.changes[0].label[0]], ['m3', '桜吹雪', 'ai.ch.materialUpdate']);
  const put = CH.toCommands(DOC, PLAN, rm.changes);
  assert.equal(CMD.reduce(DOC, { t: 'batch', cmds: put }).materials.list[2].recipe.layers[0].count, 30);
  // not understood / empty
  deepEqual(RECIPE.materialChanges(DOC, PLAN, reg, { understood: false, question: 'どんな？', material: ai({}) }, { sent: q.sent }),
    { understood: false, question: 'どんな？', changes: [], warnings: [] });
  assert.deepEqual(RECIPE.materialChanges(DOC, PLAN, reg, null, { sent: q.sent }).warnings, [['ai.warn.empty', {}]]);
});

test('materials with a registry that holds materials: variant bases come from the base registry only', () => {
  const def = Object.assign({}, reg.get('arrive', 'inkRise'), { key: 'myMat9', mine: { id: 'm9', rhash: '00000000', cost: 0, by: 'user' } });
  const ext = REG.extend(reg, [def]);
  assert.ok(ext.has('arrive', 'myMat9'));
  const r = RECIPE.fromAi(ai({ kind: 'arrive', base: 'myMat9', layers: [] }), ext);
  assert.equal(r.entry, null, 'a material is never a base');
  assert.ok(CAT.materialsText(ext, 'ja').includes('[mine] myMat9='));
  assert.ok(!CAT.catalogText(CAT.catalog(ext, DOC, ['arrive'], 'ja', { mine: false })).includes('myMat9'));
  assert.equal(CAT.materialsText(reg, 'ja'), '', 'no materials, no list');
  assert.ok(S.coerce({ type: 'partRefs' }, ['arrive.myMat9']), 'material keys are part refs');
});
