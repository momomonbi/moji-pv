/* 文字PVメーカー v2 — original work. Tests: the FROZEN WP0 interfaces exist exactly as DESIGN §2.2, §3.4, §4.1–§4.7, §4.20 and §4.24 write them. */
'use strict';
// Other packages code against these names from DESIGN.md alone, so a missing or renamed export breaks them silently.
// The lists below are copied from the DESIGN sections named next to them; the FROZEN code blocks are read from
// DESIGN.md itself and compared with the source.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, SRC } = require('../helpers/load.js');
const { throwsCode } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');
const fake = require('../helpers/fake_engine.js');

const MV = load();
const DESIGN = fs.readFileSync(path.resolve(SRC, '..', 'docs', 'DESIGN.md'), 'utf8');

const F = 'function';
const FROZEN_EXPORTS = {
  // §4.1.1–§4.1.4
  'core/hash': { hash32: F, hashJSON: F },
  'core/rng': { gen: F, stream: F, fromSeed: F, gumbel: F },
  'core/noise': { noise1: F, noise2: F, fbm1: F, tile: F },
  'core/num': { clamp: F, lerp: F, invLerp: F, remap: F, smooth: F, fract: F, wrap: F, q6: F, approxEq: F, TAU: 'number',
    DEG: 'number' },
  'core/ease': { EASES: 'array', get: F, reverse: F, bezier: F },
  'core/color': { parse: F, toHex: F, rgba: F, mix: F, luminance: F, contrast: F, fitContrast: F, shade: F, hueDeg: F,
    hueDistance: F, TOKENS: 'array' },
  'core/mat': { ident: F, mul: F, invert: F, apply: F, quad: F, compose: F },
  // §4.2
  'core/schema': { autoValue: F, coerce: F, describeAuto: F, validateSpec: F, ORDERS: 'array' },
  // §4.3
  'core/paths': { parse: F, format: F, scopeKey: F, lineOfCut: F, cutOffset: F, isUnder: F, slotParamPath: F },
  'core/pins': { index: F, attachCuts: F, lookup: F, pinsUnder: F },
  // §4.4
  'core/doc': { defaultDoc: F, defaultSide: F, validate: F, normalize: F, touched: F, serialize: F, DESIGN_SIZE: 'object' },
  'core/migrate': { parseFile: F, migrate: F, MIGRATIONS: 'object', CURRENT_SCHEMA: 'number' },
  // §4.5–§4.7
  'core/store': { createStore: F },
  'core/registry': { KINDS: 'array', createRegistry: F },
  'core/motion': { SHARE: 'object', MIN_DUR: 'number', fitMotion: F, heroTime: F },
  // §4.24 (kernel part)
  'i18n/t': { createT: F, fmtTime: F, fmtBytes: F, fmtMoney: F },
  'i18n/strings': {},
};

function kindOf(v) {
  if (Array.isArray(v)) return 'array';
  return v === null ? 'null' : typeof v;
}

function missingMembers(obj, expected) {
  return Object.keys(expected).filter((name) => kindOf(obj[name]) !== expected[name])
    .map((name) => name + ' (expected ' + expected[name] + ', got ' + kindOf(obj[name]) + ')');
}

// The fenced code block of DESIGN.md that contains `marker`.
function designBlock(marker) {
  const blocks = [...DESIGN.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const found = blocks.filter((b) => b.includes(marker));
  assert.equal(found.length, 1, 'exactly one DESIGN code block contains ' + marker);
  return found[0];
}

// The text of `function name(…) { … }` in `text`, with // comments removed and whitespace collapsed.
function functionText(text, name) {
  const start = text.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'function ' + name + ' not found');
  const open = text.indexOf('{', start);
  let depth = 0, end = open;
  for (; end < text.length; end++) {
    if (text[end] === '{') depth++;
    else if (text[end] === '}' && --depth === 0) break;
  }
  return text.slice(start, end + 1).replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
}

function source(id) { return fs.readFileSync(path.join(SRC, id + '.js'), 'utf8'); }

test('every FROZEN export of §4.1–§4.7 and §4.24 exists with the right kind', () => {
  const gaps = [];
  for (const [id, expected] of Object.entries(FROZEN_EXPORTS)) {
    assert.ok(MV.has(id), 'module ' + id + ' is defined');
    for (const miss of missingMembers(MV.use(id), expected)) gaps.push(id + '.' + miss);
  }
  assert.deepEqual(gaps, []);
});

test('FROZEN code is verbatim: define.js (§2.2), hash32 (§4.1.1), gen (§4.1.2)', () => {
  const kernel = designBlock('Module kernel: MV.def / MV.use / MV.ids.');
  assert.equal(source('core/define').trimEnd(), kernel.trimEnd(), 'src/core/define.js equals the DESIGN block');
  const hashBlock = designBlock('function hash32(...parts)');
  assert.equal(functionText(source('core/hash'), 'hash32'), functionText(hashBlock, 'hash32'));
  const genBlock = designBlock('function gen(seed)');
  assert.equal(functionText(source('core/rng'), 'gen'), functionText(genBlock, 'gen'));
});

test('FROZEN lists and constants have their DESIGN values', () => {
  assert.deepEqual([...MV.use('core/ease').EASES], ['linear', 'sineIn', 'sineOut', 'sineInOut', 'quadIn', 'quadOut',
    'quadInOut', 'cubicIn', 'cubicOut', 'cubicInOut', 'expoIn', 'expoOut', 'expoInOut', 'backIn', 'backOut', 'backInOut',
    'elasticOut', 'bounceOut', 'springOut', 'steps']);
  assert.deepEqual([...MV.use('core/schema').ORDERS], ['lead', 'tail', 'core', 'rim', 'scatter', 'word', 'line', 'sweepX',
    'sweepY', 'radial', 'emphFirst', 'sung']);
  assert.deepEqual([...MV.use('core/color').TOKENS], ['ground', 'ground2', 'ink', 'accent', 'shiftA', 'shiftB', 'muted']);
  assert.deepEqual([...MV.use('core/registry').KINDS], ['arrange', 'arrive', 'dwell', 'depart', 'ground', 'ornament',
    'lens', 'filter', 'seam', 'theme', 'mood']);
  const motion = MV.use('core/motion');
  assert.deepEqual({ ...motion.SHARE }, { arrive: 0.45, depart: 0.35 });
  assert.equal(motion.MIN_DUR, 0.12);
  const sizes = MV.use('core/doc').DESIGN_SIZE;
  assert.deepEqual(Object.fromEntries(Object.entries(sizes).map(([k, v]) => [k, [...v]])), {
    '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '4:3': [1440, 1080],
    '3:4': [1080, 1440], '21:9': [2520, 1080],
  });
  assert.equal(MV.use('core/migrate').CURRENT_SCHEMA, 2, 'DESIGN_2_1 §2.2');
  assert.equal(MV.use('core/num').TAU, 2 * Math.PI);
  assert.equal(MV.use('core/num').DEG, Math.PI / 180);
});

test('vocabularies agree across modules (§3.2, §3.4, §4.18.1)', () => {
  const schema = MV.use('core/schema');
  const doc = MV.use('core/doc');
  const REG = MV.use('core/registry');
  assert.deepEqual([...schema.AMOUNT_KEYS], ['motion', 'glitch', 'chroma', 'ornament', 'density', 'texture', 'groundSwitch',
    'flash', 'shake', 'camera', 'pace'], '§3.4.1 amount keys');
  assert.deepEqual([...schema.TAGS], ['soft', 'hard', 'fast', 'slow', 'playful', 'serious', 'digital', 'organic', 'literary',
    'bold', 'minimal', 'busy', 'dark', 'bright', 'retro', 'wet', 'airy'], '§4.18.1 tag vocabulary');
  assert.deepEqual([...MV.use('core/paths').KINDS], ['arrange', 'arrive', 'dwell', 'depart', 'ornament', 'lens', 'filter',
    'ground', 'atmos', 'seam', 'texture'], '§3.4 KIND');
  assert.deepEqual([...doc.FILTER_KINDS], REG.KINDS.filter((k) => k !== 'mood'), '§3.2 filter kinds');
  assert.deepEqual([...doc.ASPECTS], Object.keys(doc.DESIGN_SIZE));
});

test('shared parameters: the FROZEN names of §3.4, each a valid ParamSpec (registry ↔ schema)', () => {
  const { SHARED } = MV.use('core/registry');
  const schema = MV.use('core/schema');
  const names = Object.fromEntries(Object.entries(SHARED).map(([kind, params]) => [kind, Object.keys(params)]));
  // v2.1 (DESIGN_2_1 §2.3): flow, dwell.curve, lens.curve and seam.curve; ease is a curve.
  assert.deepEqual(names, {
    arrange: ['offsetX', 'offsetY'], arrive: ['dur', 'each', 'order', 'ease', 'flow'], dwell: ['amount', 'speed', 'curve'],
    depart: ['dur', 'each', 'order', 'ease', 'flow'], ground: ['amount'], ornament: ['amount', 'ink'], lens: ['amount', 'curve'],
    filter: ['amount', 'when'], seam: ['dur', 'curve'], theme: [], mood: [],
  });
  for (const kind of ['arrive', 'depart']) {
    assert.equal(SHARED[kind].ease.type, 'curve');
    assert.deepEqual(SHARED[kind].flow.auto, { value: 'linear' });
  }
  for (const [kind, name] of [['dwell', 'curve'], ['lens', 'curve'], ['seam', 'curve']]) {
    assert.equal(SHARED[kind][name].type, 'curve');
    assert.deepEqual(SHARED[kind][name].auto, { value: 'linear' }, 'linear: no v2 frame changes');
  }
  for (const [kind, params] of Object.entries(SHARED)) {
    for (const [name, spec] of Object.entries(params)) {
      assert.deepEqual(schema.validateSpec(name, spec), [], kind + '.' + name);
    }
  }
});

test('rng streams have the §4.1.2 Stream members', () => {
  const rng = MV.use('core/rng');
  for (const s of [rng.stream('a', 1), rng.fromSeed(7), rng.stream('a').fork('b')]) {
    assert.equal(typeof s.seed, 'number');
    for (const m of ['next', 'range', 'int', 'chance', 'pick', 'weighted', 'shuffle', 'floats', 'fork']) {
      assert.equal(typeof s[m], F, 'Stream.' + m);
    }
  }
  assert.equal(typeof rng.gen(1), F);
  assert.equal(typeof rng.gumbel(1, 'k'), 'number');
});

test('paths and pins return the §4.3 shapes; PathError carries the four codes', () => {
  const P = MV.use('core/paths');
  const pins = MV.use('core/pins');
  const part = P.parse('cut/r3~0:ornament#1@hankoSeal.size');
  assert.deepEqual(Object.keys(part).sort(), ['el', 'name', 'part', 'scope', 'slot']);
  assert.deepEqual({ ...part.scope }, { kind: 'cut', id: 'r3~0', lineId: 'r3' });
  assert.deepEqual({ ...part.part }, { kind: 'ornament', idx: 1, key: 'hankoSeal', param: 'size' });
  assert.deepEqual({ ...P.parse('line/r7.1:el.text.nudge').el }, { owner: 'text', field: 'nudge' });
  assert.equal(P.parse('work:face.display.ja').name, 'face.display.ja');
  assert.equal(P.format({ scope: part.scope, slot: part.slot }), 'cut/r3~0:ornament#1@hankoSeal.size');
  throwsCode(() => P.parse('scene:mood'), 'bad-scope');
  throwsCode(() => P.parse('work:arrive@X'), 'bad-slot');
  throwsCode(() => P.parse('line/7:start'), 'bad-line-id');
  throwsCode(() => P.parse('cut/r3-0:arrive'), 'bad-cut-key');

  const ix = pins.index({ 'work:mood': { v: 'quietHush', by: 'user' }, 'line/r3:arrive': { v: 'stubFade', by: 'ai' } });
  for (const k of ['work', 'line', 'cut']) assert.ok(ix[k] instanceof Map, 'PinIndex.' + k + ' is a Map');
  const hit = pins.lookup(ix, { cutKey: 'r3~0', pinCutKey: 'r3~0', lineId: 'r3' }, 'arrive');
  assert.deepEqual(Object.keys(hit).sort(), ['at', 'by', 'from', 'v']);
  const attached = pins.attachCuts(ix, 'r3', [{ key: 'r3~0', a: 0, b: 4, text: 'abcd' }]);
  assert.deepEqual(Object.keys(attached).sort(), ['map', 'orphans', 'shadowed']);
  assert.ok(Array.isArray(pins.pinsUnder({ 'work:mood': { v: 1, by: 'user' } }, 'work')));
});

test('doc and migrate: touched keys (§4.4) and the four MigrateError codes', () => {
  const D = MV.use('core/doc');
  const M = MV.use('core/migrate');
  const a = D.defaultDoc();
  const b = { ...a, pins: { 'work:mood': { v: 'quietHush', by: 'user' } } };
  const tch = D.touched(a, b);
  for (const k of ['rows', 'pins', 'look', 'timing', 'song', 'output', 'filters', 'salts', 'locks', 'materials', 'media']) {
    assert.ok(k in tch, k);
  }
  assert.ok(tch.pins instanceof Set && tch.pins.has('work:mood'));
  const text = D.serialize({ doc: a, side: D.defaultSide() });
  assert.deepEqual(Object.keys(M.parseFile(text)).sort(), ['doc', 'side']);
  throwsCode(() => M.parseFile('{'), 'bad-json');
  throwsCode(() => M.parseFile('{"format":"other"}'), 'not-a-project');
  throwsCode(() => M.parseFile(text.replace('"schema": 2', '"schema": 3')), 'newer');
  throwsCode(() => M.parseFile(text.replace('"aspect": "16:9"', '"aspect": "2:1"')), 'invalid');
});

test('store: the §4.5 API, event payloads and return shapes', () => {
  const D = MV.use('core/doc');
  const reduce = (doc, cmd) => (cmd.t === 'look.seed' ? { ...doc, look: { ...doc.look, seed: cmd.seed } } : doc);
  const store = MV.use('core/store').createStore({ doc: D.defaultDoc(), side: D.defaultSide(), reduce });
  for (const m of ['dispatch', 'batch', 'gesture', 'seal', 'undo', 'redo', 'peek', 'list', 'jump', 'setSide', 'load', 'on']) {
    assert.equal(typeof store[m], F, 'store.' + m);
  }
  const events = [];
  const off = store.on('doc', (e) => events.push(e));
  store.on('side', (e) => events.push(e));
  assert.equal(store.rev, 0);
  const rev = store.dispatch({ t: 'look.seed', seed: 5 }, { label: ['undo.edit', {}], sel: { before: 'A', after: 'B' } });
  assert.equal(rev, store.rev);
  assert.deepEqual(Object.keys(events[0]).sort(), ['cmds', 'kind', 'rev', 'sel', 'touched', 'where']);
  const gesture = store.gesture('drag');
  assert.equal(typeof gesture.end, F);
  gesture.end();
  assert.deepEqual(Object.keys(store.peek()).sort(), ['redo', 'undo']);
  const [entry] = store.list();
  assert.ok(typeof entry.n === 'number' && Array.isArray(entry.label), 'list() entries are { n, label }');
  assert.deepEqual(store.undo(), { where: null, sel: 'A' });
  assert.deepEqual(store.redo(), { where: null, sel: 'B' });
  store.setSide((side) => ({ ...side, aiLog: [] }));
  assert.deepEqual(Object.keys(events[events.length - 1]), ['side']);
  off();
});

test('registry: the §4.6 Registry members; strict mode throws RegistryError entries "kind/key: message"', () => {
  const REG = MV.use('core/registry');
  const reg = REG.createRegistry(corpus.allStubParts());
  assert.equal(typeof reg.version, 'string');
  for (const m of ['get', 'has', 'keys', 'all', 'pool', 'fallback', 'label']) assert.equal(typeof reg[m], F, 'Registry.' + m);
  assert.equal(reg.fallback('theme'), 'sumiWashi');
  assert.equal(reg.fallback('mood'), 'quietHush');
  const bad = { ...corpus.stubParts()[0], key: 'Bad' };
  assert.throws(() => REG.createRegistry([bad, ...corpus.minimalFallbacks()]), (e) => {
    assert.ok(e instanceof REG.RegistryError);
    assert.ok(e.problems.every((p) => /^[a-z]+\/[^:]+: ./.test(p)), e.problems.join('\n'));
    return true;
  });
});

test('every registered part key and param forms a slot path (registry ↔ paths)', () => {
  const P = MV.use('core/paths');
  const reg = corpus.stubRegistry(MV);
  const LIST_KINDS = ['ornament', 'filter'];
  for (const kind of MV.use('core/registry').PART_KINDS) {
    for (const key of reg.keys(kind)) {
      const idx = LIST_KINDS.includes(kind) ? 2 : null;
      for (const { name, shared } of reg.params(kind, key)) {
        const slot = P.slotParamPath(kind, idx, key, name, shared);
        assert.equal(P.format({ scope: 'cut/r3~0', slot }), 'cut/r3~0:' + slot);
      }
      assert.equal(P.parse('work:' + P.slotParamPath(kind, idx, key, 'x', false)).part.key, key);
    }
  }
  // The registry key pattern alone allows keys longer than PARTKEY; the registry refuses them.
  const REG = MV.use('core/registry');
  const longest = 'stub' + 'X'.repeat(28);
  const withKey = (key) => [{ ...corpus.stubParts()[1], key }, ...corpus.minimalFallbacks()];
  assert.equal(REG.createRegistry(withKey(longest)).has('arrive', longest), true);
  assert.equal(P.parse('work:arrive@' + longest).part.key, longest);
  assert.throws(() => REG.createRegistry(withKey(longest + 'Y')), /at most 32 characters/);
});

test('plan_basic slot names and cut keys use the path grammar (plan ↔ paths)', () => {
  const P = MV.use('core/paths');
  const plan = corpus.planBasic();
  for (const cut of plan.cuts) {
    P.lineOfCut(cut.key);
    for (const slot of Object.keys(cut.slots)) P.parse('cut/' + cut.key + ':' + slot);
  }
});

test('i18n: createT gives t with part, why and err (§4.24)', () => {
  const T = MV.use('i18n/t');
  const strings = MV.use('i18n/strings');
  const reg = corpus.stubRegistry(MV);
  const t = T.createT('en', strings, reg);
  assert.equal(typeof t, F);
  assert.equal(t('app.name'), 'Moji PV Maker');
  assert.equal(t.part('theme', 'sumiWashi'), 'Sumi & washi');
  assert.equal(t.why('recent'), t('why.recent'));
  assert.equal(t.err('auth'), t('err.ai.auth'));
  assert.equal(T.fmtTime(61.234), '1:01.23');
  assert.equal(typeof T.fmtBytes(2048), 'string');
  assert.equal(typeof T.fmtMoney(0.5, 'ja'), 'string');
});

test('the fake engine hashes exactly like core/hash (its plans and recorder hashes are comparable)', () => {
  const H = MV.use('core/hash');
  for (const parts of [[''], ['a'], ['ab', 'c'], ['a', 'bc'], [1, 'r3~0', 0.5]]) {
    assert.equal(fake.hash32(...parts), H.hash32(...parts), JSON.stringify(parts));
  }
  const plans = [corpus.planBasic(), ...corpus.PROJECTS.map((name) => fake.trivialPlan(corpus.project(name).doc))];
  for (const plan of plans) {
    const { hash, ...rest } = plan;
    assert.equal(fake.hashJSON(rest), H.hashJSON(rest));
    assert.equal(hash, H.hashJSON(rest), 'plan.hash = hashJSON(plan without hash)');
  }
});

test('fake engine implements the §4.20 facade (createEngine, Engine members, FrameStats)', async () => {
  const members = ['setDoc', 'prepare', 'renderFrame', 'hitTest', 'boxes', 'thumb', 'warnings', 'fork', 'stats', 'dispose'];
  const rec = fake.createRecorder();
  const services = { registry: corpus.stubRegistry(MV), canvas: rec.factory, measurer: null, fonts: null, assets: null };
  const engine = fake.createEngine(services);
  for (const m of members) assert.equal(typeof engine[m], F, 'Engine.' + m);
  const doc = corpus.project('basic').doc;
  const result = engine.setDoc(doc);
  assert.deepEqual(Object.keys(result).sort(), ['changedCuts', 'changedGrounds', 'plan']);
  assert.equal(engine.plan, result.plan);
  await engine.prepare(0, 1, { export: false });
  const surface = fake.surfaceOf(rec.factory, 640, 360);
  const stats = engine.renderFrame(surface, engine.plan.cuts[0].repT, { quality: 'preview', pick: true, scale: 1 / 3 });
  assert.deepEqual(Object.keys(stats).sort(), ['drawn', 'ms', 'passes', 'provisional']);
  assert.deepEqual(Object.keys(stats.drawn).sort(), ['glyphs', 'paints', 'particles', 'shapes']);
  const copy = engine.fork();
  for (const m of members) assert.equal(typeof copy[m], F, 'fork().' + m);
  assert.equal(copy.plan, engine.plan);
  const t = engine.plan.cuts[1].repT;
  const hashes = [engine, copy].map((e) => {
    const r = fake.createRecorder();
    e.renderFrame(fake.surfaceOf(r.factory, 640, 360), t, { quality: 'export', pick: false, scale: 1 / 3 });
    return r.hash();
  });
  assert.equal(hashes[0], hashes[1], 'a fork renders the same frame');
});

// ---- v2.1: the FROZEN interfaces of DESIGN_2_1 (package A) -----------------------------------------------------------

const FROZEN_EXPORTS_21 = {
  // §3.2
  'core/curve': { PRESETS: 'object', PRESET_KEYS: 'array', RAMP_ENDS: 'array', MAX_KNOTS: 'number', RAMP_W: 'number',
    isCurve: F, coerce: F, keyOf: F, expand: F, compile: F, fn: F, warp: F, isLinear: F, reverse: F, speedAt: F, sample: F,
    label: F },
  // §3.3
  'core/shot': { SHOTS: 'object', SHOT_KEYS: 'array', RIGS: 'object', RIG_KEYS: 'array', MOVES: 'array', FOCI: 'array',
    TIMINGS: 'array', LIMITS: 'object', coerceShot: F, coerceRig: F, isCustom: F, expandShot: F, lastFraming: F, maxFill: F,
    expandRig: F, fromMove: F, usesBeats: F, label: F, rigLabel: F },
  // §3.4
  'core/recipe': { RECIPE_V: 'number', MAT_KINDS: 'array', COMPOSITE_KINDS: 'array', PRIMS: 'array', SHAPES: 'array',
    GLYPHS: 'array', ANCHORS: 'array', LAYERS: 'object', WAVES: 'array', MOVE_WHAT: 'array', APPEAR_AT: 'array', DRAWS: 'array',
    FRAME_STYLES: 'array', PATTERNS: 'array', BURSTS: 'array', MOTION_COLS: 'array', OSC_COLS_DWELL: 'array',
    OSC_COLS_LENS: 'array', PHASES: 'array', KNOB_WHATS: 'array', LIMITS: 'object', normalize: F, problems: F,
    entryProblems: F, hash: F, cost: F, knobSpecs: F, withKnobs: F, upgrade: F },
  // §3.6
  'core/registry': { extend: F, SHARED: 'object' },
  // §3.8
  'planner/areas': { AREA_KINDS: 'array', keyOf: F, areasOf: F, resolve: F, inArea: F, ofLines: F, bands: F, sameRef: F },
  // §3.12 (the stub signatures)
  'parts/mix': { SHAPE_LIB: 'object', derive: F, registryFor: F, materialHash: F, sampleDefs: F },
  // §11.3.2
  'core/media': { PROBE_V: 'number', INDEX_V: 'number', KINDS: 'array', FITS: 'array', EDGES: 'array', MOVES: 'array',
    LOOPS: 'array', CLOCKS: 'array', LIMITS: 'object', ID: 'object', isId: F, keyOf: F, idOfKey: F, entryProblems: F,
    normalizeEntry: F, refsOf: F, metaOf: F, timeSpec: F, mapTime: F, fitRect: F, tier: F },
};

test('v2.1: every FROZEN export of DESIGN_2_1 §3.2–§3.8, §3.12 and §11.3.2 exists with the right kind', () => {
  const gaps = [];
  for (const [id, expected] of Object.entries(FROZEN_EXPORTS_21)) {
    assert.ok(MV.has(id), 'module ' + id + ' is defined');
    for (const miss of missingMembers(MV.use(id), expected)) gaps.push(id + '.' + miss);
  }
  assert.deepEqual(gaps, []);
  const CV = MV.use('core/curve');
  assert.deepEqual([...CV.PRESET_KEYS], ['dashStop', 'fadeBrake', 'holdThenDash', 'hushRushHush', 'slowBloom', 'snapSettle', 'softEnds']);
  assert.deepEqual([...CV.RAMP_ENDS], ['both', 'start', 'end']);
  assert.equal(CV.MAX_KNOTS, 8);
  assert.equal(CV.RAMP_W, 0.06);
  const SHOT = MV.use('core/shot');
  assert.deepEqual([...SHOT.SHOT_KEYS], ['driftOff', 'pullReveal', 'pushWord', 'readAlong', 'settle', 'snapZoom', 'sweepAcross',
    'tiltHold', 'wideHold']);
  assert.deepEqual([...SHOT.RIG_KEYS], ['climbRise', 'driftSide', 'leanTilt', 'pullAway', 'slowSwell']);
  assert.deepEqual([...SHOT.MOVES], ['drift', 'follow', 'panDown', 'panLeft', 'panRight', 'panUp', 'pullOut', 'punch', 'pushIn', 'tilt']);
  assert.deepEqual([...SHOT.FOCI], ['center', 'emphasis', 'first', 'last', 'text']);
  assert.deepEqual([...SHOT.TIMINGS], ['arrive', 'depart', 'hold', 'whole']);
  const R = MV.use('core/recipe');
  assert.equal(R.RECIPE_V, 1);
  assert.deepEqual([...R.MAT_KINDS], ['arrange', 'arrive', 'depart', 'dwell', 'filter', 'ground', 'lens', 'ornament', 'seam']);
  assert.deepEqual([...R.COMPOSITE_KINDS], ['arrive', 'depart', 'dwell', 'filter', 'ground', 'lens', 'ornament']);
  assert.deepEqual([...R.SHAPES], ['rect', 'roundRect', 'ellipse', 'ring', 'star', 'petal', 'leaf', 'flake', 'drop', 'heart',
    'diamond', 'triangle', 'cross', 'dot', 'bar', 'arc', 'wave', 'spark']);
  assert.deepEqual([...R.GLYPHS].join(''), '♪♫★☆♡❄✿❀☀☂☁✦✧〇△□◇');
  assert.deepEqual([...R.ANCHORS], ['frame', 'focus', 'around', 'under', 'behind', 'corners', 'edges', 'free']);
  assert.deepEqual([...R.WAVES], ['sine', 'tri', 'saw', 'noise', 'beat', 'ramp']);
  assert.deepEqual([...R.MOVE_WHAT], ['x', 'y', 'rot', 'scale', 'alpha']);
  assert.deepEqual([...R.PHASES], ['same', 'index', 'rnd']);
  assert.deepEqual([...R.APPEAR_AT], ['start', 'arrive', 'rest', 'beat', 'impact']);
  assert.deepEqual([...R.DRAWS], ['fade', 'grow', 'wipe', 'none']);
  assert.deepEqual([...R.BURSTS], ['none', 'beat', 'impact', 'arrive']);
  assert.deepEqual([...R.KNOB_WHATS], ['count', 'size', 'speed', 'alpha', 'amp']);
  assert.deepEqual([...MV.use('planner/areas').AREA_KINDS], ['work', 'song', 'songKind', 'head', 'para', 'lines', 'cut']);
  const MEDIA = MV.use('core/media');
  assert.deepEqual([MEDIA.PROBE_V, MEDIA.INDEX_V], [1, 1]);
  assert.deepEqual([...MEDIA.FITS], ['cover', 'contain', 'soft']);
  assert.deepEqual([...MEDIA.EDGES], ['mirror', 'zoom', 'plain']);
  assert.deepEqual([...MEDIA.MOVES], ['auto', 'none', 'push', 'pull', 'drift']);
  assert.deepEqual([...MEDIA.LOOPS], ['loop', 'hold']);
  assert.deepEqual([...MEDIA.CLOCKS], ['show', 'song']);
  // §3.5, §11.2.3: the ParamSpec types
  assert.deepEqual([...MV.use('core/schema').TYPES], ['num', 'int', 'bool', 'enum', 'ease', 'order', 'ink', 'color', 'face', 'text',
    'curve', 'shot', 'rig', 'partRefs', 'media']);
});

test('v2.1: registries have the §3.6 members; registryFor returns the base itself without materials', () => {
  const REG = MV.use('core/registry');
  const reg = corpus.stubRegistry(MV);
  assert.equal(reg.base, null);
  assert.equal(reg.baseVersion, reg.version);
  assert.deepEqual({ ...reg.extra }, {});
  assert.deepEqual([...reg.mine('ornament')], []);
  const ext = REG.extend(reg, []);
  for (const m of ['get', 'has', 'keys', 'all', 'pool', 'fallback', 'label', 'blurb', 'params', 'traits', 'mine']) {
    assert.equal(typeof ext[m], F, 'extended Registry.' + m);
  }
  assert.equal(ext.base, reg);
  assert.equal(ext.baseVersion, reg.version);
  const MIX = MV.use('parts/mix');
  assert.equal(MIX.registryFor(reg, { next: 1, list: [] }), reg);
  assert.equal(MIX.registryFor(reg, { next: 1, list: [] }, { list: [] }), reg);
  // package C replaced A's stub (§3.12): an unreadable entry derives to no definition, with its problems
  const bad = MIX.derive({}, reg);
  assert.equal(bad.def, null);
  assert.ok(Array.isArray(bad.problems) && bad.problems.length > 0);
  assert.match(MIX.materialHash({}), /^[0-9a-f]{8}$/);
  assert.ok(MIX.sampleDefs().length > 0 && MIX.sampleDefs().every((d) => d.key.startsWith('myMatS')));
});
