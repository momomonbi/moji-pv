/* 文字PVメーカー v2 — original work. Tests for core/registry: validation, sorting, pools, one-part registries, v2.1 extend. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const R = MV.use('core/registry');

function stubsBy(kind, key) {
  return corpus.allStubParts().find((d) => d.kind === kind && d.key === key);
}

// Builds a strict registry from the stub set with one definition replaced (or added), and returns its problems.
function problemsWith(kind, key, change) {
  const defs = corpus.allStubParts();
  const i = defs.findIndex((d) => d.kind === kind && d.key === key);
  const def = Object.assign({}, defs[i]);
  change(def, defs);
  defs[i] = def;
  try {
    R.createRegistry(defs);
  } catch (e) {
    assert.equal(e.name, 'RegistryError');
    assert.equal(e.code, 'invalid');
    return e.problems;
  }
  return [];
}

function expectProblem(kind, key, change, fragment) {
  const problems = problemsWith(kind, key, change);
  assert.ok(problems.some((p) => p.includes(fragment)),
    `${kind}/${key}: expected a problem containing "${fragment}", got ${JSON.stringify(problems)}`);
}

test('the stub catalog validates in strict mode', () => {
  const reg = corpus.stubRegistry(MV);
  assert.deepEqual(reg.problems, []);
  for (const kind of R.KINDS) assert.equal(reg.keys(kind).length, 2, kind);
  assert.match(reg.version, /^[0-9a-f]{8}$/);
});

test('one-part registries validate: any single part plus the minimal fallbacks', () => {
  for (const def of corpus.stubParts()) {
    const reg = R.createRegistry([def, ...corpus.minimalFallbacks()]);
    assert.ok(reg.has(def.kind, def.key), def.key);
  }
  const reg = R.createRegistry(corpus.minimalFallbacks());
  for (const kind of R.KINDS) assert.equal(reg.keys(kind).length, 1);
  assert.equal(reg.fallback('theme'), 'sumiWashi');
  assert.equal(reg.fallback('mood'), 'quietHush');
  assert.equal(reg.fallback('arrive'), 'instantShow');
});

test('common field errors', () => {
  expectProblem('arrive', 'stubFade', (d) => { d.kind = 'entrance'; }, 'unknown kind');
  expectProblem('arrive', 'stubFade', (d) => { d.key = 'fade'; }, 'camelCase');
  expectProblem('arrive', 'stubFade', (d) => { d.key = 'Stub_fade'; }, 'camelCase');
  expectProblem('arrive', 'stubFade', (d) => { d.label = { ja: 'x', en: '' }; }, 'label needs');
  expectProblem('arrive', 'stubFade', (d) => { delete d.blurb; }, 'blurb needs');
  expectProblem('arrive', 'stubFade', (d) => { d.tags = ['soft', 'sparkly']; }, 'tags outside the vocabulary');
  expectProblem('arrive', 'stubFade', (d) => { d.season = 'monsoon'; }, 'season must be');
  expectProblem('arrive', 'stubFade', (d) => { d.weight = -1; }, 'weight');
  expectProblem('arrive', 'stubFade', (d) => { d.gate = 'loudness'; }, 'gate must be');
  expectProblem('arrive', 'stubFade', (d) => { d.needs = ['blur', 'magic']; }, 'needs must list');
  expectProblem('arrive', 'stubFade', (d) => { d.pool = 'no'; }, 'pool must be');
  expectProblem('arrive', 'stubFade', (d) => { d.fits = 3; }, 'fits must be');
  expectProblem('arrive', 'stubFade', (d) => { d.family = ''; }, 'family');
  expectProblem('arrive', 'stubFade', (d) => { d.traits = { orient: ['x'] }; }, 'traits.orient');
  expectProblem('arrive', 'stubFade', (d) => { d.traits = { cells: [5, 2] }; }, 'traits.cells');
  expectProblem('arrive', 'stubFade', (d) => { d.traits = { energy: [0, 2] }; }, 'traits.energy');
  expectProblem('arrive', 'stubFade', (d) => { d.traits = { roles: ['chorus'] }; }, 'traits.roles');
  expectProblem('arrive', 'stubFade', (d) => { d.traits = { scripts: ['fr'] }; }, 'traits.scripts');
  expectProblem('arrive', 'stubFade', (d) => { d.traits = { aspects: ['2:1'] }; }, 'traits.aspects');
  expectProblem('arrive', 'stubFade', (d) => { d.traits = { impact: 1 }; }, 'traits.impact');
});

test('duplicate keys and fallback counts', () => {
  expectProblem('arrive', 'stubFade', (d, defs) => { defs.push(Object.assign({}, d)); }, 'duplicate key');
  expectProblem('arrive', 'instantShow', (d) => { d.fallback = false; }, 'exactly one definition needs fallback: true (found 0)');
  expectProblem('arrive', 'stubFade', (d) => { d.fallback = true; }, '(found 2)');
  expectProblem('theme', 'sumiWashi', (d) => { d.fallback = false; }, 'found 0');
  expectProblem('theme', 'stubInk', (d, defs) => {
    d.fallback = true;
    defs.find((x) => x.key === 'sumiWashi').fallback = false;
  }, 'the theme fallback must be sumiWashi');
  expectProblem('mood', 'stubBright', (d, defs) => {
    d.fallback = true;
    defs.find((x) => x.key === 'quietHush').fallback = false;
  }, 'the mood fallback must be quietHush');
  assert.throws(() => R.createRegistry('nope'), (e) => e.name === 'RegistryError');
  assert.throws(() => R.createRegistry([]), (e) => e.problems.length === R.KINDS.length);
});

test('parameter errors', () => {
  const spec = (patch) => Object.assign({ type: 'num', min: 0, max: 1, label: { ja: 'あ', en: 'A' }, auto: { value: 0.5 } }, patch);
  expectProblem('arrive', 'stubFade', (d) => { d.params = { depth: spec({ auto: undefined }) }; }, 'params.depth: auto is required');
  expectProblem('arrive', 'stubFade', (d) => { d.params = { depth: spec({ label: undefined }) }; }, 'params.depth: label needs');
  expectProblem('arrive', 'stubFade', (d) => { d.params = { depth: spec({ type: 'size' }) }; }, 'unknown type');
  expectProblem('arrive', 'stubFade', (d) => { d.params = { dur: spec() }; }, 'clashes with the shared param');
  expectProblem('arrive', 'stubFade', (d) => { d.params = { 'bad.name': spec() }; }, 'bad param name');
  expectProblem('ornament', 'stubRule', (d) => { d.params = { count: spec() }; }, 'reserved name');
  expectProblem('arrive', 'stubFade', (d) => { d.params = 'x'; }, 'params must be an object');
  expectProblem('arrive', 'stubFade', (d) => { d.shared = { speed: { auto: { value: 1 } } }; }, 'not a shared param');
  expectProblem('arrive', 'stubFade', (d) => { d.shared = { dur: { max: 9 } }; }, 'may only narrow');
  expectProblem('arrive', 'stubFade', (d) => { d.shared = { dur: { type: 'int' } }; }, 'type cannot change');
  expectProblem('arrive', 'stubFade', (d) => { d.shared = { dur: { auto: { range: [0.1, 9] } } }; }, 'shared.dur: auto range is outside');
  expectProblem('arrive', 'stubFade', (d) => { d.shared = 3; }, 'shared must be an object');
  // narrowing and new autos are fine
  assert.deepEqual(problemsWith('arrive', 'stubFade', (d) => {
    d.shared = { dur: { min: 0.2, max: 1, auto: { range: [0.3, 0.6] } }, ease: { auto: { value: 'backOut' } } };
  }), []);
});

test('kind contract errors', () => {
  expectProblem('arrange', 'stubBlock', (d) => { delete d.build; }, 'build() is required for arrange');
  expectProblem('arrange', 'stubBlock', (d) => { d.motion = 'mine'; }, "motion must be 'own'");
  expectProblem('arrive', 'stubFade', (d) => { delete d.make; }, 'make() is required');
  expectProblem('arrive', 'stubFade', (d) => { d.unit = 'syllable'; }, 'unit must be one of');
  expectProblem('dwell', 'stubBob', (d) => { d.make = null; }, 'make() is required');
  expectProblem('depart', 'stubFadeOut', (d) => { d.unit = 'page'; }, 'unit must be one of');
  expectProblem('ground', 'stubTint', (d) => { d.animated = 'yes'; }, 'animated must be');
  expectProblem('ornament', 'stubRule', (d) => { delete d.scope; }, 'scope must be one of cut run');
  expectProblem('ornament', 'stubRule', (d) => { d.follow = 'camera'; }, 'follow must be one of');
  expectProblem('lens', 'stubDrift', (d) => { delete d.make; }, 'make() is required for lens');
  expectProblem('filter', 'stubDim', (d) => { d.stage = 'post'; }, 'stage must be one of');
  expectProblem('filter', 'stubDim', (d) => { d.cost = 9; }, 'cost must be');
  expectProblem('filter', 'stubDim', (d) => { d.passes = -1; }, 'passes must be');
  expectProblem('filter', 'stubDim', (d) => { delete d.alphaSafe; }, 'alphaSafe must be');
  expectProblem('filter', 'stubDim', (d) => { d.texture = 1; }, 'texture must be a boolean');
  expectProblem('filter', 'stubDim', (d) => { delete d.apply; }, 'apply() is required');
  expectProblem('seam', 'stubCross', (d) => { d.scope = 'both'; }, 'scope must be one of text world');
  expectProblem('seam', 'stubCross', (d) => { d.replaces = { exit: true }; }, 'replaces must be');
  expectProblem('seam', 'stubCross', (d) => { delete d.mix; }, 'mix() is required');
});

test('theme errors', () => {
  expectProblem('theme', 'stubInk', (d) => { d.swatch = Object.assign({}, d.swatch, { accent: 'orange' }); }, 'swatch needs');
  expectProblem('theme', 'stubInk', (d) => { d.swatch = Object.assign({}, d.swatch, { ink: '#20242B' }); }, 'contrast must be ≥ 4.5');
  expectProblem('theme', 'stubInk', (d) => { d.faces = Object.assign({}, d.faces, { body: { ja: 'Zen Kaku Gothic New' } }); },
    'faces.body needs ja and latin');
  expectProblem('theme', 'stubInk', (d) => { d.faces = Object.assign({}, d.faces, { serif: { ja: 'a', latin: 'b', weight: 950 } }); },
    'faces.serif.weight');
  expectProblem('theme', 'stubInk', (d) => { d.style = 'neon'; }, 'style must be one of');
  expectProblem('theme', 'stubInk', (d) => { delete d.dark; }, 'dark must be');
  expectProblem('theme', 'stubInk', (d) => { d.texture = 5; }, 'texture must be');
  expectProblem('theme', 'stubInk', (d) => { d.prefer = { arrive: { fade: 2 } }; }, 'prefer must map');
});

test('mood errors', () => {
  expectProblem('mood', 'stubBright', (d) => { d.amounts = Object.assign({}, d.amounts, { pace: 2 }); }, 'amounts needs every amount key');
  expectProblem('mood', 'stubBright', (d) => { d.amounts = Object.assign({}, d.amounts); delete d.amounts.shake; }, 'amounts needs');
  expectProblem('mood', 'stubBright', (d) => { d.amounts = Object.assign({}, d.amounts, { bass: 0.2 }); }, 'unknown keys');
  expectProblem('mood', 'stubBright', (d) => { d.tagBias = { sparkly: 2 }; }, 'tagBias must map');
  expectProblem('mood', 'stubBright', (d) => { d.themes = { goldLeaf: 2 }; }, 'themes names an unknown theme goldLeaf');
  expectProblem('mood', 'stubBright', (d) => { d.pace = { seam: 2, focus: 0.1 }; }, 'pace needs');
  expectProblem('mood', 'stubBright', (d) => { d.variety = 3; }, 'variety must be');
  expectProblem('mood', 'stubBright', (d) => { delete d.filters; }, 'filters must map');
  expectProblem('mood', 'stubBright', (d) => { d.keywords = ['ok', 3]; }, 'keywords');
});

test('non-strict registries skip invalid definitions and list the problems', () => {
  const defs = corpus.allStubParts();
  defs.push({ kind: 'arrive', key: 'badOne', label: { ja: 'x', en: 'x' } });
  const reg = R.createRegistry(defs, { strict: false });
  assert.equal(reg.has('arrive', 'badOne'), false);
  assert.ok(reg.problems.some((p) => p.startsWith('arrive/badOne:')));
  assert.equal(reg.keys('arrive').length, 2);
});

test('keys, all and version do not depend on registration order', () => {
  const a = corpus.stubRegistry(MV);
  const shuffled = corpus.allStubParts().reverse();
  const b = R.createRegistry(shuffled);
  for (const kind of R.KINDS) assert.deepEqual(b.keys(kind), a.keys(kind));
  assert.equal(a.version, b.version);
  assert.deepEqual(a.keys('arrive'), ['instantShow', 'stubFade']);
  const all = a.all().map((d) => [d.kind, d.key]);
  const byKindThenKey = (x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] < y[1] ? -1 : x[1] > y[1] ? 1 : 0);
  assert.deepEqual(all, all.slice().sort(byKindThenKey), 'all() is sorted by (kind, key)');
  assert.deepEqual(b.all().map((d) => [d.kind, d.key]), all);
  assert.equal(all.length, corpus.allStubParts().length);
  assert.deepEqual(a.all('seam').map((d) => d.key), ['hardCut', 'stubCross']);
  const withParam = corpus.allStubParts();
  const fade = withParam.find((d) => d.key === 'stubFade');
  fade.params = { lift: { type: 'num', min: 0, max: 1, label: { ja: 'あ', en: 'A' }, auto: { value: 0 } } };
  assert.notEqual(R.createRegistry(withParam).version, a.version, 'adding a param changes the version');
});

test('get, has, label, blurb, params and traits', () => {
  const reg = corpus.stubRegistry(MV);
  assert.equal(reg.get('arrive', 'nope'), null);
  assert.equal(reg.get('nope', 'stubFade'), null);
  assert.equal(reg.has('seam', 'stubCross'), true);
  assert.equal(reg.label('arrive', 'stubFade', 'ja'), 'ふわっと');
  assert.equal(reg.label('arrive', 'stubFade', 'en'), 'Stub fade');
  assert.equal(reg.label('arrive', 'missingKey', 'en'), 'missingKey');
  assert.equal(reg.blurb('seam', 'hardCut', 'en'), 'No transition');
  assert.deepEqual(reg.params('arrive', 'stubFade').map((p) => [p.name, p.shared]),
    [['dur', true], ['each', true], ['order', true], ['ease', true], ['flow', true]]);
  assert.deepEqual(reg.params('ground', 'stubTint').map((p) => p.name), ['amount', 'at']);
  assert.deepEqual(reg.params('theme', 'sumiWashi'), []);
  assert.equal(reg.params('arrive', 'nope'), null);
  assert.deepEqual(reg.traits('arrange', 'stubBlock').orient, ['h']);
  assert.deepEqual(reg.traits('arrive', 'stubFade').roles, ['lyric', 'focus']);
  for (const kind of R.PART_KINDS) {
    for (const [name, spec] of Object.entries(R.SHARED[kind])) {
      assert.deepEqual(MV.use('core/schema').validateSpec(name, spec), [], kind + '.' + name);
    }
  }
});

test('shared parameter overrides are merged into the part specs', () => {
  const defs = corpus.allStubParts();
  const fade = defs.find((d) => d.key === 'stubFade');
  fade.shared = { dur: { min: 0.2, max: 1, auto: { range: [0.3, 0.6] } } };
  const reg = R.createRegistry(defs);
  const dur = reg.params('arrive', 'stubFade').find((p) => p.name === 'dur').spec;
  assert.equal(dur.min, 0.2);
  assert.deepEqual(dur.auto, { range: [0.3, 0.6] });
  assert.deepEqual(dur.label, R.SHARED.arrive.dur.label);
});

// --- pools -------------------------------------------------------------------------------------------------------

function poolRegistry() {
  const base = stubsBy('arrive', 'stubFade');
  const extra = (key, patch) => Object.assign({}, base, { key, label: { ja: key, en: key } }, patch);
  return R.createRegistry([
    ...corpus.allStubParts(),
    extra('springDrift', { season: 'spring' }),
    extra('winterDust', { season: 'winter' }),
    extra('pinOnly', { pool: false }),
    extra('titleOnly', { traits: { roles: ['title'] } }),
    extra('verticalOnly', { traits: { orient: ['v'], scripts: ['ja', 'zhHant'], aspects: ['9:16'] } }),
    extra('glitchGate', { gate: 'glitch' }),
  ]);
}

test('pool honours only / deny filters', () => {
  const reg = poolRegistry();
  const all = reg.pool('arrive', {});
  assert.deepEqual(all, ['glitchGate', 'springDrift', 'stubFade', 'titleOnly', 'verticalOnly', 'winterDust'],
    'without a role every role passes');
  assert.deepEqual(reg.pool('arrive', { filters: { arrive: { only: ['stubFade', 'winterDust', 'pinOnly'], deny: null } } }),
    ['stubFade', 'winterDust']);
  assert.deepEqual(reg.pool('arrive', { filters: { arrive: { only: null, deny: ['stubFade', 'glitchGate'] } } }),
    ['springDrift', 'titleOnly', 'verticalOnly', 'winterDust']);
  assert.deepEqual(reg.pool('arrive', { filters: { seam: { only: ['hardCut'] } } }), all, 'other kinds\' filters do not apply');
});

test('pool honours the season gate', () => {
  const reg = poolRegistry();
  const has = (season, key) => reg.pool('arrive', { season }).includes(key);
  assert.ok(has('any', 'springDrift') && has('any', 'winterDust'));
  assert.ok(has(undefined, 'springDrift'));
  assert.ok(has('spring', 'springDrift') && !has('spring', 'winterDust') && has('spring', 'stubFade'));
  assert.ok(!has('none', 'springDrift') && !has('none', 'winterDust') && has('none', 'stubFade'));
});

test('pool honours pool:false, role, orient, script, aspect, gate, scope and texture', () => {
  const reg = poolRegistry();
  assert.ok(!reg.pool('arrive', {}).includes('pinOnly'));
  assert.ok(reg.has('arrive', 'pinOnly'), 'pool:false parts stay pinnable');
  assert.ok(!reg.pool('arrive', {}).includes('instantShow'), 'the fallback instantShow is pin/rule only');
  assert.deepEqual(reg.pool('arrive', { role: 'title' }), ['titleOnly']);
  assert.ok(!reg.pool('arrive', { role: 'lyric' }).includes('titleOnly'));
  assert.ok(reg.pool('arrive', { orient: 'v' }).includes('verticalOnly'));
  assert.ok(!reg.pool('arrive', { orient: 'h' }).includes('verticalOnly'));
  assert.ok(!reg.pool('arrive', { script: 'ko' }).includes('verticalOnly'));
  assert.ok(reg.pool('arrive', { script: 'ko' }).includes('stubFade'));
  assert.ok(!reg.pool('arrive', { aspect: '16:9' }).includes('verticalOnly'));
  assert.ok(!reg.pool('arrive', { amounts: { glitch: 0 } }).includes('glitchGate'));
  assert.ok(reg.pool('arrive', { amounts: { glitch: 0.4 } }).includes('glitchGate'));
  assert.deepEqual(reg.pool('arrange', { role: 'title' }), ['centerAnchor']);
  assert.deepEqual(reg.pool('ornament', { scope: 'run' }), []);
  assert.deepEqual(reg.pool('ornament', { scope: 'cut' }), ['hairFrame', 'stubRule']);
  assert.deepEqual(reg.pool('seam', { scope: 'world' }), []);
  assert.deepEqual(reg.pool('filter', { texture: true }), ['grainFilm']);
  assert.deepEqual(reg.pool('nope', {}), []);
});

// --- v2.1 (DESIGN_2_1 §2.3, §3.6): curve params, def fields, key rules, extend ------------------------------------------

const S = MV.use('core/schema');

test('v2.1 shared params: ease is a curve with the v2 picks; flow and the curve params default to linear', () => {
  assert.deepEqual(R.SHARED.arrive.ease.auto, { pick: ['expoOut', 'cubicOut', 'quadOut', 'backOut'], weights: [3, 3, 2, 1] });
  assert.deepEqual(R.SHARED.depart.ease.auto, { pick: ['quadIn', 'cubicIn', 'expoIn', 'sineIn'], weights: [3, 2, 2, 1] });
  assert.deepEqual({ ...R.SHARED.arrive.ease.label }, { ja: '緩急', en: 'Speed curve' });
  const labels = { 'arrive.flow': ['出方の緩急', 'Stagger curve'], 'depart.flow': ['出方の緩急', 'Stagger curve'],
    'dwell.curve': ['見せの緩急', 'Hold curve'], 'lens.curve': ['動きの緩急', 'Motion curve'],
    'seam.curve': ['切り替えの緩急', 'Transition curve'] };
  for (const [path, [ja, en]] of Object.entries(labels)) {
    const [kind, name] = path.split('.');
    const spec = R.SHARED[kind][name];
    assert.equal(spec.type, 'curve', path);
    assert.deepEqual({ ...spec.label }, { ja, en }, path);
    assert.deepEqual({ ...spec.auto }, { value: 'linear' }, path);
    assert.equal(spec.ui, path === 'lens.curve' ? undefined : 'advanced', path);
    assert.deepEqual(S.validateSpec(name, spec), [], path);
  }
  // an old ease pin value is still a valid curve, and a curve pick list validates (§3.5 checkCandidate)
  assert.equal(S.coerce(R.SHARED.arrive.ease, 'backOut'), 'backOut');
  assert.deepEqual(S.validateSpec('ease', { type: 'curve', label: { ja: 'a', en: 'a' }, auto: { pick: ['expoOut', 'holdThenDash'] } }), []);
  // a part may still narrow the ease auto
  const defs = corpus.allStubParts();
  defs.find((d) => d.key === 'stubFade').shared = { ease: { auto: { value: 'softEnds' } } };
  assert.deepEqual(R.createRegistry(defs).params('arrive', 'stubFade').find((p) => p.name === 'ease').spec.auto, { value: 'softEnds' });
});

test('v2.1 def fields: lens frames/warp, arrange cam; createRegistry refuses myMat/myMed keys and `mine`', () => {
  expectProblem('lens', 'stubDrift', (d) => { d.frames = 'yes'; }, 'frames must be a boolean');
  expectProblem('lens', 'stubDrift', (d) => { d.warp = 1; }, 'warp must be a boolean');
  expectProblem('arrange', 'stubBlock', (d) => { d.cam = 'soft'; }, 'cam must be one of any gentle none');
  assert.deepEqual(problemsWith('lens', 'stubDrift', (d) => { d.frames = true; d.warp = false; }), []);
  assert.deepEqual(problemsWith('arrange', 'stubBlock', (d) => { d.cam = 'gentle'; }), []);
  expectProblem('arrive', 'stubFade', (d) => { d.key = 'myMat3'; }, 'added only through extend');
  expectProblem('arrive', 'stubFade', (d) => { d.key = 'myMedAbc'; }, 'added only through extend');
  expectProblem('arrive', 'stubFade', (d) => { d.mine = { id: 'm1' }; }, 'mine is allowed only');
  assert.ok(R.NEEDS.includes('media'), 'needs: media (§11.5.7)');
});

function mat(kind, key, patch) {
  const base = corpus.allStubParts().find((d) => d.kind === kind && d.fallback !== true && !d.fallback);
  return Object.assign({}, base, { key, label: { ja: key, en: key }, pool: false, family: 'mine',
    mine: { id: 'm' + key.slice(5), rhash: '0000abcd', cost: 0.2, by: 'ai' } }, patch || {});
}

test('a material may name its ornament count knob `count`; a catalog part may not (the list slot keeps it)', () => {
  const base = corpus.stubRegistry(MV);
  const spec = { type: 'int', min: 1, max: 200, auto: { range: [30, 50] }, label: { ja: '数', en: 'Count' } };
  const ext = R.extend(base, [mat('ornament', 'myMat3', { params: { count: spec } })]);
  assert.deepEqual(ext.problems, []);
  assert.ok(ext.has('ornament', 'myMat3'));
  expectProblem('ornament', 'stubRule', (d) => { d.params = { count: spec }; }, 'reserved name');
});

test('extend: added defs join the base registry; the base is never mutated', () => {
  const base = corpus.stubRegistry(MV);
  const before = { version: base.version, keys: base.keys('ornament').slice(), all: base.all().length };
  Object.freeze(base);
  const ext = R.extend(base, [mat('ornament', 'myMat3'), mat('arrive', 'myMat1a', { pool: true })]);
  assert.deepEqual(ext.problems, []);
  assert.equal(ext.base, base);
  assert.equal(ext.baseVersion, base.version);
  assert.notEqual(ext.version, base.version);
  assert.deepEqual(ext.keys('ornament'), [...base.keys('ornament'), 'myMat3'].sort());
  assert.ok(ext.has('arrive', 'myMat1a') && ext.has('arrive', 'stubFade'));
  assert.equal(ext.get('arrive', 'stubFade'), base.get('arrive', 'stubFade'), 'base defs are reused');
  assert.deepEqual(ext.mine('ornament'), ['myMat3']);
  assert.deepEqual(ext.mine('arrive'), ['myMat1a']);
  assert.deepEqual(ext.mine('lens'), []);
  assert.deepEqual(Object.keys(ext.extra).sort(), ['myMat1a', 'myMat3']);
  assert.equal(ext.extra.myMat3.id, 'm3');
  assert.ok(ext.pool('arrive', {}).includes('myMat1a'));
  assert.ok(!ext.pool('ornament', {}).includes('myMat3'), 'pool: false materials are pin-only');
  assert.equal(ext.fallback('arrive'), base.fallback('arrive'));
  assert.equal(ext.label('ornament', 'myMat3', 'en'), 'myMat3');
  assert.deepEqual(ext.params('ornament', 'myMat3').map((p) => p.name), base.params('ornament', base.keys('ornament')[0]).map((p) => p.name));
  assert.deepEqual(ext.params('arrive', 'stubFade'), base.params('arrive', 'stubFade'));
  assert.equal(ext.all().length, before.all + 2);
  assert.deepEqual(base.keys('ornament'), before.keys);
  assert.equal(base.version, before.version);
  assert.equal(base.has('ornament', 'myMat3'), false);
});

test('extend: the key rule, required mine, duplicates and strict mode', () => {
  const base = corpus.stubRegistry(MV);
  const bad = [
    mat('ornament', 'myMat3', { mine: undefined }),
    Object.assign(mat('ornament', 'myMat4'), { key: 'stubRule' }),
    Object.assign(mat('ornament', 'myMat5'), { key: 'myMedxyz' }),
    mat('ornament', 'myMat6'), mat('ornament', 'myMat6'),
    mat('ornament', 'myMat7', { fallback: true }),
  ];
  const ext = R.extend(base, bad, { problems: ['ornament/myMat9: derive: bad-layer'] });
  assert.equal(ext.problems[0], 'ornament/myMat9: derive: bad-layer', "the caller's problems come first");
  const text = ext.problems.join('\n');
  assert.match(text, /ornament\/myMat3: mine must be an object/);
  assert.match(text, /ornament\/stubRule: an added key must be myMat<id> or myMed<10 hex digits>/);
  assert.match(text, /ornament\/myMedxyz: an added key/);
  assert.match(text, /ornament\/myMat6: duplicate key in ornament/);
  assert.match(text, /ornament\/myMat7: an added definition cannot be the fallback/);
  assert.deepEqual(ext.mine('ornament'), ['myMat6']);
  assert.ok(R.extend(base, [mat('ground', 'myMed3f9c2d17b0')]).has('ground', 'myMed3f9c2d17b0'), 'the media key rule');
  assert.throws(() => R.extend(base, bad.slice(0, 1), { strict: true }), (e) => e.name === 'RegistryError' && e.problems.length === 1);
  assert.throws(() => R.extend(null, []), (e) => e.name === 'RegistryError');
});

test('extend: version = base version + added keys, param names and what the planner reads', () => {
  const base = corpus.stubRegistry(MV);
  const v = (defs) => R.extend(base, defs).version;
  const one = v([mat('ornament', 'myMat3')]);
  assert.equal(v([mat('ornament', 'myMat3')]), one, 'deterministic');
  assert.equal(R.extend(base, []).version, v([]));
  assert.notEqual(v([]), base.version);
  assert.equal(v([mat('ornament', 'myMat3', { mine: { id: 'm3', rhash: 'ffff0000', cost: 0.2, by: 'ai' } })]), one,
    'a body edit (rhash) keeps the version');
  assert.equal(v([mat('ornament', 'myMat3', { label: { ja: '別名', en: 'Other' } })]), one, 'labels are not read by the planner');
  for (const patch of [{ tags: ['soft'] }, { season: 'spring' }, { weight: 2 }, { pool: true }, { family: 'petal' },
    { gate: 'ornament' }, { traits: { roles: ['title'] } }, { scope: 'run' }, { follow: 'own' },
    { params: { knob: { type: 'num', min: 0, max: 2, label: { ja: 'a', en: 'a' }, auto: { value: 1 } } } }]) {
    const def = mat('ornament', 'myMat3', patch);
    if (patch.params) def.params = Object.assign({}, mat('ornament', 'myMat3').params, patch.params);
    const ext = R.extend(base, [def]);
    assert.deepEqual(ext.problems, [], JSON.stringify(patch));
    assert.notEqual(ext.version, one, JSON.stringify(patch));
  }
  const ext = R.extend(base, [mat('ornament', 'myMat3')]);
  assert.equal(R.extend(ext, [mat('arrive', 'myMat4')]).baseVersion, base.version, 'extending an extension keeps the base version');
});

// parts/mix re-composes the registry on every material edit; the untouched definitions are the same frozen objects.
test('extend: a frozen definition is checked and hashed once; an unfrozen one again on every call', () => {
  const base = corpus.stubRegistry(MV);
  const frozenMat = (kind, key, patch) => {
    const d = mat(kind, key, patch);
    if (d.params) d.params = Object.freeze(JSON.parse(JSON.stringify(d.params)));
    return Object.freeze(d);
  };
  const frozen = frozenMat('ornament', 'myMat3');
  const a = R.extend(base, [frozen]);
  const b = R.extend(base, [frozen, mat('arrive', 'myMat4')]);
  assert.equal(a.params('ornament', 'myMat3'), b.params('ornament', 'myMat3'), 'the param list is re-used');
  assert.equal(a.version, R.extend(base, [mat('ornament', 'myMat3')]).version, 'the same version as an unfrozen copy');
  const bad = frozenMat('ornament', 'myMat5', { mine: undefined });
  for (let i = 0; i < 2; i++) assert.match(R.extend(base, [bad]).problems.join('\n'), /ornament\/myMat5: mine must be an object/);
  // an unfrozen definition may change between calls, so it is checked and hashed again
  const open = mat('ornament', 'myMat6');
  const first = R.extend(base, [open]);
  assert.deepEqual(first.problems, []);
  open.tags = ['soft'];
  assert.notEqual(R.extend(base, [open]).version, first.version, 'an edited unfrozen definition changes the version');
  open.mine = undefined;
  assert.match(R.extend(base, [open]).problems.join('\n'), /ornament\/myMat6: mine must be an object/);
});
