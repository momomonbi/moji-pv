/* 文字PVメーカー v2 — original work. Tests for core/recipe: normalization, limits, cost, the flash rule, knobs, entries, fuzzing (DESIGN_2_1 §5.7, §5.8, §11.5.8). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');

const MV = load();
const R = MV.use('core/recipe');
const S = MV.use('core/schema');
const REG = MV.use('core/registry');
const H = MV.use('core/hash');
const { stream } = MV.use('core/rng');

// The §5.7.4 example layer (the cherry flurry of §2.1).
const PETALS = Object.freeze({ prim: 'particles', shape: 'petal', glyph: '', inks: ['#F4B4C6', 'accent'], alpha: 0.85, layer: 'near',
  place: { anchor: 'frame', x: 0, y: 0, spread: 1.15 }, size: [0.012, 0.022], count: 90, stroke: 0, rot: [0, 360],
  field: { dir: 115, speed: 0.09, sway: 26, swayHz: 0.35, spin: 60, life: [0, 0], burst: 'none' },
  move: [{ what: 'scale', wave: 'beat', amp: 0.15, hz: 0, phase: 'rnd', curve: null }],
  appear: { at: 'start', draw: 'fade', dur: 0.6 }, style: '', pattern: '', gap: 0, fill: null });
const FLURRY = Object.freeze({ follow: 'own', knobs: [{ what: 'count' }], layers: [PETALS], parts: [], scope: 'run', seed: 7 });

const layer = (patch) => Object.assign({ prim: 'shape', shape: 'dot', size: [0.02, 0.03], count: 3 }, patch);
const orn = (layers, extra) => Object.assign({ layers }, extra || {});
const codes = (list) => list.map((p) => p.code);
function problemsOf(kind, recipe, ctx) { return R.problems(kind, R.normalize(kind, recipe).recipe, ctx); }
function hasProblem(kind, recipe, code, ctx) {
  const list = problemsOf(kind, recipe, ctx);
  assert.ok(list.some((p) => p.code === code), 'expected ' + code + ' in ' + JSON.stringify(list));
  return list;
}

test('the §2.1 cherry flurry normalizes to a valid run ornament (≤ 1.5 ms static cost)', () => {
  const { recipe, problems } = R.normalize('ornament', FLURRY);
  assert.deepEqual(problems, []);
  assert.deepEqual(R.problems('ornament', recipe), []);
  assert.equal(recipe.scope, 'run');
  assert.deepEqual(recipe.layers[0].inks, ['#F4B4C6', 'accent']);
  const c = R.cost('ornament', recipe);
  assert.equal(c.particles, 135, '90 petals × the count knob maximum 1.5');
  assert.ok(c.ms <= R.LIMITS.ms.ornamentRun, 'static cost ' + c.ms);
  assert.ok(Object.isFrozen(recipe) && Object.isFrozen(recipe.layers[0].field), 'deep-frozen');
  assert.equal(JSON.stringify(recipe), H.canonical(recipe), 'sorted keys at every depth');
});

test('every primitive normalizes with its own fields; others hold their defaults (one canonical form)', () => {
  const ground = { layers: [{ prim: 'fill', fill: { type: 'radial', stops: [['accent', 1], ['#102030', 0]] } }] };
  for (const prim of R.PRIMS) {
    const kind = prim === 'fill' ? 'ground' : 'ornament';
    const input = prim === 'fill' ? ground : orn([layer({ prim, shape: 'star', glyph: '★', style: 'ring', pattern: 'grid', gap: 0.1 })]);
    const { recipe, problems } = R.normalize(kind, input);
    const l = recipe.layers[0];
    assert.equal(l.prim, prim);
    assert.deepEqual(R.problems(kind, recipe), [], prim);
    assert.deepEqual(R.normalize(kind, recipe).recipe, recipe, 'idempotent: ' + prim);
    assert.deepEqual(R.normalize(kind, recipe).problems, []);
    if (prim === 'media') { assert.equal(l.src, ''); continue; }
    assert.equal(l.shape, prim === 'shape' || prim === 'particles' ? 'star' : prim === 'lines' ? 'bar' : '', prim + ' shape');
    assert.equal(l.glyph, prim === 'glyphs' ? '★' : '', prim + ' glyph');
    assert.equal(l.style, prim === 'frame' ? 'ring' : '');
    assert.equal(l.pattern, prim === 'pattern' ? 'grid' : '');
    assert.equal(l.gap, prim === 'pattern' ? 0.1 : 0);
    assert.equal(l.fill === null, prim !== 'fill');
    assert.ok(Array.isArray(problems));
  }
  const fill = R.normalize('ground', ground).recipe.layers[0].fill;
  assert.deepEqual(fill, { angle: 0, stops: [['#102030', 0], ['accent', 1]], type: 'radial' }, 'stops sorted, radial angle 0');
  const ornFill = R.normalize('ornament', orn([layer({ prim: 'fill', layer: 'near' })]));
  assert.equal(ornFill.recipe.layers[0].layer, 'far', 'a fill in an ornament goes to the far layer');
  assert.ok(ornFill.problems.some((p) => p.path === 'layers[0].layer'));
  const slot = R.normalize('ground', { layers: [layer({ inks: ['slot', 'ink'] })] });
  assert.deepEqual(slot.recipe.layers[0].inks, ['ink'], "grounds have no slot ink");
  assert.deepEqual(R.normalize('ground', { layers: [layer({ inks: ['slot'] })] }).recipe.layers[0].inks, ['ground2']);
});

test('every kind: variants, composites, required content (empty, no-base, ground-first)', () => {
  for (const kind of ['arrange', 'seam']) {
    const { recipe } = R.normalize(kind, { base: 'stairStep', params: { steps: 3, flip: true, label: 'x', bad: {} }, shared: {} });
    assert.deepEqual(Object.keys(recipe), ['base', 'params', 'shared'], kind + ' is a variant');
    assert.deepEqual(recipe.params, { flip: true, label: 'x', steps: 3 });
    hasProblem(kind, { layers: [layer()] }, 'no-base');
  }
  const v = R.normalize('arrive', { base: 'inkRise', params: { yFrom: 1.2 }, shared: { dur: { value: 1.1 }, ease: { value: 'softEnds' },
    flow: { value: { ramp: { edge: 0.1, ends: 'both', peak: 6 } } }, order: { value: 'nope' }, bogus: { value: 1 }, each: 0.1 } });
  assert.deepEqual(v.recipe, { base: 'inkRise', params: { yFrom: 1.2 }, shared: { dur: { value: 1.1 }, ease: { value: 'softEnds' },
    flow: { value: { ramp: { edge: 0.1, ends: 'both', peak: 6 } } } } });
  assert.deepEqual(codes(v.problems), ['dropped', 'dropped', 'dropped'], 'bogus, each (not an auto) and order (not an order)');
  assert.deepEqual(R.normalize('dwell', { base: 'breathePulse', shared: { dur: { value: 1 } } }).recipe.shared, {}, 'not a dwell shared param');
  assert.equal(R.normalize('ornament', { base: 'myMat3' }).recipe.base, undefined, 'materials cannot recurse: a composite');
  assert.ok(R.normalize('ornament', { base: 'myMed3f9c2d17b0' }).problems.some((p) => p.path === 'base' && p.code === 'dropped'));
  assert.equal(R.normalize('seam', { base: 'myMat3' }).recipe.base, '', 'seams are variants only');
  for (const kind of R.COMPOSITE_KINDS) hasProblem(kind, {}, 'empty');
  hasProblem('ground', { layers: [layer()] }, 'ground-first');
  assert.deepEqual(problemsOf('ground', { layers: [{ prim: 'fill' }, layer()] }), []);
  assert.deepEqual(problemsOf('ground', { parts: [{ key: 'washiFiber' }], layers: [layer()] }), []);
  assert.deepEqual(problemsOf('dwell', { osc: [{ col: 'y', amp: 0.06, hz: 0.5 }] }), []);
  assert.deepEqual(problemsOf('lens', { osc: [{ col: 'roll', amp: 2, hz: 0.3, phase: 'index' }] }), []);
  assert.equal(R.normalize('lens', { osc: [{ col: 'roll', amp: 2, phase: 'index', step: 0.5 }] }).recipe.osc[0].phase, 'same', 'lens: same');
  assert.deepEqual(problemsOf('filter', { parts: [{ key: 'grainFilm' }], mix: [0.5] }), []);
  assert.deepEqual(R.normalize('filter', { parts: [{ key: 'grainFilm' }, { key: 'rgbSplit' }], mix: [2] }).recipe.mix, [1, 1]);
  assert.deepEqual(problemsOf('depart', { mirrorOf: 'm3' }), []);
  const mirror = R.normalize('depart', { mirrorOf: 'm3', motion: { tracks: [{ col: 'alpha', from: 1, to: 0 }] } });
  assert.equal(mirror.recipe.motion, null, 'a mirror has no motion of its own');
  assert.equal(R.normalize('arrive', { mirrorOf: 'm3', parts: [{ key: 'inkRise' }] }).recipe.mirrorOf, undefined, 'arrive has no mirrorOf');
});

test('motion: arrive tracks end at identity, depart tracks start there; defaults from the shared params', () => {
  const a = R.normalize('arrive', { motion: { unit: 'word', tracks: [{ col: 'y', from: 1.5, to: 0.4 }, { col: 'alpha', from: 0, to: 0.5 },
    { col: 'y', from: 2, to: 0 }, { col: 'glitter', from: 0, to: 1 }, { col: 'sx', from: 20, to: 1 }], colCurve: { alpha: 'expoOut', x: 'expoIn' } } });
  assert.deepEqual(a.recipe.motion.tracks, [{ col: 'y', from: 1.5, to: 0 }, { col: 'alpha', from: 0, to: 1 }, { col: 'sx', from: 8, to: 1 }]);
  assert.deepEqual(a.recipe.motion.colCurve, { alpha: 'expoOut' });
  assert.equal(a.recipe.motion.curve, 'expoOut');
  assert.deepEqual(a.recipe.motion.dur, [...REG.SHARED.arrive.dur.auto.range]);
  assert.deepEqual(a.recipe.motion.order, ['lead']);
  const d = R.normalize('depart', { motion: { tracks: [{ col: 'blur', from: 0.3, to: 2 }], order: ['tail', 'bogus', 'tail'] } });
  assert.deepEqual(d.recipe.motion.tracks, [{ col: 'blur', from: 0, to: 0.6 }]);
  assert.equal(d.recipe.motion.curve, 'quadIn');
  assert.deepEqual(d.recipe.motion.order, ['tail']);
  assert.equal(R.normalize('arrive', { motion: { tracks: [] } }).recipe.motion, null);
});

test('limits: one over → the problem named (§5.8)', () => {
  const seven = Array.from({ length: 7 }, () => layer());
  assert.ok(R.normalize('ornament', orn(seven)).problems.some((p) => p.path === 'layers' && p.code === 'too-many' && p.params.max === 6));
  assert.equal(R.normalize('ornament', orn(seven)).recipe.layers.length, 6);
  assert.equal(R.normalize('ground', { layers: [{ prim: 'fill' }, layer(), layer(), layer(), layer()] }).recipe.layers.length, 4);
  // shapes per layer at knob max: 16 × 1.5 = 24 is fine, 17 × 1.5 = 26 is not
  assert.deepEqual(problemsOf('ornament', orn([layer({ count: 16 })], { knobs: ['count'] })), []);
  hasProblem('ornament', orn([layer({ count: 17 })], { knobs: ['count'] }), 'shapes');
  assert.equal(R.normalize('ornament', orn([layer({ count: 99 })])).recipe.layers[0].count, 24, 'shape count clamped');
  // particles over all layers (knobs at max) ≤ 240
  const p = (n) => layer({ prim: 'particles', count: n, size: [0.003, 0.004] });
  assert.deepEqual(problemsOf('ornament', orn([p(120), p(120)], { scope: 'run' })), []);
  hasProblem('ornament', orn([p(120), p(121)], { scope: 'run' }), 'particles');
  hasProblem('ornament', orn([p(100), p(100)], { knobs: ['count'], scope: 'run' }), 'particles');
  // shape nodes per recipe ≤ 48
  hasProblem('ornament', orn([layer({ count: 24 }), layer({ count: 24 }), layer({ prim: 'frame', style: 'box' })]), 'nodes');
  // static cost: cut 1.2 ms, run 1.5 ms, ground 2.0 ms
  const heavy = orn([p(140), p(100)]);                  // 0.96 ms
  assert.deepEqual(problemsOf('ornament', heavy), []);
  const over = hasProblem('ornament', orn([p(140), p(100)], { parts: [{ key: 'cornerTicks' }] }), 'cost');
  assert.equal(over.find((x) => x.code === 'cost').params.max, 1.2);
  assert.deepEqual(problemsOf('ornament', orn([p(140), p(100)], { parts: [{ key: 'cornerTicks' }], scope: 'run' })), [], 'run: 1.5');
  const glyphs = (n) => layer({ prim: 'glyphs', count: n, glyph: '✿', size: [0.003, 0.004] });
  assert.deepEqual(problemsOf('ground', { layers: [{ prim: 'fill' }, glyphs(120), glyphs(100)], parts: [{ key: 'washiFiber' }] }), []);
  hasProblem('ground', { layers: [{ prim: 'fill' }, glyphs(120), glyphs(120)], parts: [{ key: 'washiFiber' }] }, 'cost');
  // lists over their caps are cut and named
  const many = (n, x) => Array.from({ length: n }, (_, i) => Object.assign({}, x, typeof x.col === 'string' ? {} : { col: x.cols[i] }));
  const tracks = R.normalize('arrive', { motion: { tracks: many(9, { cols: R.MOTION_COLS }) } });
  assert.ok(tracks.problems.some((q) => q.path === 'motion.tracks' && q.code === 'too-many'));
  assert.equal(tracks.recipe.motion.tracks.length, 8);
  const osc = R.normalize('dwell', { osc: many(5, { col: 'y', amp: 0.1 }) });
  assert.ok(osc.problems.some((q) => q.path === 'osc' && q.code === 'too-many') && osc.recipe.osc.length === 4);
  const parts = R.normalize('ornament', { parts: [{ key: 'cornerTicks' }, { key: 'hankoSeal' }, { key: 'hairFrame' }] });
  assert.ok(parts.problems.some((q) => q.path === 'parts' && q.code === 'too-many') && parts.recipe.parts.length === 2);
  assert.equal(R.normalize('ground', { parts: [{ key: 'washiFiber' }, { key: 'inkWash' }] }).recipe.parts.length, 1);
  const knobs = R.normalize('ornament', orn([layer()], { knobs: ['count', 'size', 'speed', 'alpha', 'amp', 'count', 'amp'] }));
  assert.deepEqual(knobs.recipe.knobs.map((k) => k.what), ['count', 'size', 'speed', 'alpha', 'amp'], 'unique, ≤ 6');
  assert.ok(knobs.problems.some((q) => q.path === 'knobs' && q.code === 'too-many'));
  // numbers are clamped into their ranges and reported
  const big = R.normalize('ornament', orn([layer({ prim: 'particles', size: [0.0001, 3], field: { speed: 9, spin: 5000, swayHz: 7 },
    move: [{ what: 'x', wave: 'sine', amp: 3, hz: 20 }] })]));
  const l = big.recipe.layers[0];
  assert.deepEqual([l.size, l.field.speed, l.field.spin, l.field.swayHz, l.move[0].amp, l.move[0].hz],
    [[0.002, 1.2], 1.5, 720, 2, 0.5, 4]);
  assert.ok(big.problems.filter((q) => q.code === 'clamped').length >= 6);
  // a canonical recipe over 6 KB
  const params = {};
  for (let i = 0; i < 32; i++) params['p' + i] = 'x'.repeat(120);
  hasProblem('ornament', { parts: [{ key: 'cornerTicks', params }, { key: 'hankoSeal', params }] }, 'too-big');
});

test('glyph sprite columns: any mix of blur, glow and tint is within the limits; the scene decides what is drawn (§5.9.5)', () => {
  // no per-recipe count of glyph sprites: their cost depends on the text a material dresses, which only a scene knows
  assert.equal(R.LIMITS.glyphSprites, undefined);
  const tr = (col, from) => ({ col, from, to: col === 'alpha' ? 1 : 0 });
  const heavy = { motion: { tracks: [tr('y', 0.6), tr('blur', 0.6), tr('glow', 1), tr('alpha', 0), tr('tint', 1), tr('rot', 20),
    tr('sx', 8), tr('sy', 8)] } };
  assert.deepEqual(problemsOf('arrive', heavy), []);
  assert.equal(R.cost('arrive', heavy).sprites, undefined, 'cost() has no sprite count');
  const osc = (col, amp) => ({ col, amp, hz: 0.5, wave: 'sine' });
  assert.deepEqual(problemsOf('dwell', { osc: [osc('glow', 1), osc('tint', 1), osc('rot', 30), osc('sx', 0.3)] }), []);
  // the track limits still hold: a blur over 0.6 em is clamped (§5.8)
  const over = R.normalize('arrive', { motion: { tracks: [tr('blur', 0.9)] } });
  assert.equal(over.recipe.motion.tracks[0].from, 0.6);
});

test('filter stacks: inner cost and passes from the registry; flash parts are refused at derive', () => {
  const reg = { get: (kind, key) => ({ grainFilm: { cost: 2, passes: 1 }, rgbSplit: { cost: 5, passes: 6 } })[key] || null };
  const ok = R.normalize('filter', { parts: [{ key: 'grainFilm' }, { key: 'grainFilm' }] }).recipe;
  assert.deepEqual(R.cost('filter', ok, { registry: reg }).cost, 4);
  assert.deepEqual(R.problems('filter', ok, { registry: reg }), []);
  const heavy = R.normalize('filter', { parts: [{ key: 'grainFilm' }, { key: 'rgbSplit' }] }).recipe;
  assert.deepEqual(codes(R.problems('filter', heavy, { registry: reg })), ['filter-cost', 'filter-passes']);
  assert.deepEqual(R.problems('filter', heavy), [], 'without a registry the stack is not checked here');
  assert.equal(R.cost('filter', heavy).cost, null);
});

test('the flash rule: a big alpha beat is refused, a small layer is fine; knobs count at their maximum', () => {
  const pulse = (patch) => ({ what: 'alpha', wave: 'sine', amp: 0.2, hz: 1, phase: 'same', ...patch });
  const why = (recipe, kind = 'ornament') => (problemsOf(kind, recipe).find((p) => p.code === 'flash') || { params: {} }).params.why;
  const big = (move, extra) => ({ layers: [Object.assign({ prim: 'pattern', layer: 'far', move }, extra || {})] });
  assert.equal(why(big([pulse({ wave: 'beat' })])), 'beat');
  assert.equal(why(big([pulse({ hz: 3.5 })])), 'hz');
  assert.equal(why(big([pulse({ amp: 0.5 })])), 'amp');
  assert.equal(why(big([], { appear: { at: 'beat', draw: 'fade', dur: 0.1 } })), 'appear');
  assert.equal(why(big([], { appear: { at: 'impact', draw: 'none' } })), 'appear');
  assert.equal(why(big([pulse()])), undefined, 'hz ≤ 3 and amp ≤ 0.35 are fine');
  assert.equal(why(big([pulse({ what: 'scale', wave: 'beat', amp: 1 })])), undefined, 'only alpha counts');
  assert.equal(why(big([], { appear: { at: 'beat', draw: 'fade', dur: 0.2 } })), undefined);
  assert.equal(why({ layers: [layer({ prim: 'particles', count: 20, move: [pulse({ wave: 'beat', amp: 1 })] })] }), undefined,
    'a small layer may pulse on the beat');
  assert.equal(why(Object.assign(big([pulse({ amp: 0.2 })]), { knobs: ['amp'] })), 'amp', '0.2 × the amp knob maximum 2');
  assert.equal(why(Object.assign(big([pulse({ hz: 2 })]), { knobs: ['speed'] })), 'hz');
  const grow = { layers: [layer({ prim: 'particles', count: 200, size: [0.05, 0.06], move: [pulse({ wave: 'beat' })] })] };
  assert.equal(why(grow), 'beat', 'many large particles cover the frame too');
  // media layers: cover = size²
  const media = (size, appear) => ({ layers: [{ prim: 'media', size: [size, size], appear }] });
  assert.equal(why(media(0.6, { at: 'beat', draw: 'grow', dur: 0.1 })), 'appear');
  assert.equal(why(media(0.4, { at: 'beat', draw: 'grow', dur: 0.1 })), undefined, '0.16 of the frame');
});

test('media layers (§11.5.8): fields, limits (≤ 2, ≤ 1 video), cost, knob-like src', () => {
  const ID = 'a3f9c2d17b0e4a5c6d7e8f901', VID = 'a0b1c2d3e4f5a6b7c8d9e0f1a', VID2 = 'affffffffffffffffffffff01';
  const PNG = 'a111111111111111111111111';
  const n = R.normalize('ornament', { layers: [{ prim: 'media', src: ID, fit: 'contain', shape: 'arch', comp: 'screen', border: 80,
    time: { clipIn: -1, clipOut: 5, speed: 9, loop: 'hold' }, blur: 3 }] });
  const l = n.recipe.layers[0];
  assert.deepEqual([l.src, l.fit, l.shape, l.comp, l.border, l.blur, l.time], [ID, 'contain', 'arch', 'screen', 40, 3,
    { clipIn: 0, clipOut: 5, loop: 'hold', speed: 4 }]);
  assert.equal(R.normalize('ornament', { layers: [{ prim: 'media', src: 'photo.png' }] }).recipe.layers[0].src, '');
  assert.equal(R.normalize('ground', { layers: [{ prim: 'media', layer: 'near' }] }).recipe.layers[0].layer, 'ground');
  const three = { layers: [{ prim: 'media' }, { prim: 'media' }, { prim: 'media' }] };
  hasProblem('ornament', three, 'media-count');
  const docMedia = { list: [{ id: VID, kind: 'video', alpha: false }, { id: VID2, kind: 'video', alpha: false },
    { id: ID, kind: 'image', alpha: false }, { id: PNG, kind: 'image', alpha: true }] };
  const twoVideos = { layers: [{ prim: 'media', src: VID }, { prim: 'media', src: VID2 }] };
  hasProblem('ornament', twoVideos, 'media-video', { media: docMedia });
  assert.deepEqual(problemsOf('ornament', twoVideos), [], 'kinds need doc.media');
  assert.deepEqual(problemsOf('ornament', { layers: [{ prim: 'media', src: VID }, { prim: 'media', src: ID }] }, { media: docMedia }), []);
  const cost = (layers, ctx) => R.cost('ornament', R.normalize('ornament', { layers }).recipe, ctx).ms;
  approx(cost([{ prim: 'media' }]), 0.4);
  approx(cost([{ prim: 'media', blur: 2 }]), 1.9);
  approx(cost([{ prim: 'media', alpha: 0.5 }]), 0.4, 1e-9, 'a translucent layer is drawn with globalAlpha');
  approx(cost([{ prim: 'media', src: PNG }], { media: docMedia }), 1.9, 1e-9, 'an asset with alpha takes the isolated path');
  approx(cost([{ prim: 'media', src: ID }], { media: docMedia }), 0.4);
  hasProblem('ornament', { layers: [{ prim: 'media', src: PNG }] }, 'cost', { media: docMedia });
  assert.deepEqual(problemsOf('ground', { layers: [{ prim: 'fill' }, { prim: 'media', src: ID }] }, { media: docMedia }), []);
  for (const kind of ['arrive', 'dwell', 'lens', 'filter']) {
    assert.equal((R.normalize(kind, { layers: [{ prim: 'media' }] }).recipe.layers), undefined, kind + ' has no layers');
  }
  assert.deepEqual(Object.keys(R.knobSpecs('ornament', R.normalize('ornament', { layers: [{ prim: 'media' }] }).recipe)), ['src']);
  assert.deepEqual(Object.keys(R.knobSpecs('ornament', n.recipe)), [], 'a fixed asset needs no src param');
  const withSrc = R.withKnobs(R.normalize('ornament', { layers: [{ prim: 'media' }] }).recipe, { src: ID });
  assert.equal(withSrc.layers[0].src, ID);
});

test('cost is monotone in count and evaluated at knob maximum', () => {
  let prev = -1;
  for (let n = 1; n <= 240; n += 7) {
    const c = R.cost('ornament', R.normalize('ornament', orn([layer({ prim: 'particles', count: n })])).recipe);
    assert.ok(c.ms >= prev, 'monotone at ' + n);
    prev = c.ms;
  }
  const base = R.normalize('ornament', orn([layer({ prim: 'particles', count: 60 })])).recipe;
  const knob = R.normalize('ornament', orn([layer({ prim: 'particles', count: 60 })], { knobs: ['count'] })).recipe;
  assert.equal(R.cost('ornament', base).particles, 60);
  assert.equal(R.cost('ornament', knob).particles, 90);
  approx(R.cost('ornament', knob).ms, 0.36, 1e-9);
  const c = R.cost('ornament', R.normalize('ornament', { layers: [layer({ count: 4 }), { prim: 'fill' }, { prim: 'pattern' }],
    parts: [{ key: 'cornerTicks' }] }).recipe);
  assert.deepEqual([c.nodes, c.paints, c.parts, c.cover], [4, 2, 1, 1]);
  approx(c.ms, 0.04 + 0.25 + 0.3 + 0.35, 1e-9);
});

test('knobSpecs pass validateSpec, avoid the shared names, and label from mat.knob.*', () => {
  const STRINGS = MV.use('i18n/strings');
  for (const what of R.KNOB_WHATS) assert.deepEqual([R.KNOB_LABELS[what].ja, R.KNOB_LABELS[what].en], STRINGS['mat.knob.' + what]);
  for (const kind of R.COMPOSITE_KINDS) {
    const recipe = R.normalize(kind, { knobs: R.KNOB_WHATS.slice(), layers: [layer()], osc: [{ col: 'y', amp: 0.1 }], parts: [{ key: 'aPart' }],
      motion: { tracks: [{ col: 'y', from: 1 }] } }).recipe;
    const specs = R.knobSpecs(kind, recipe);
    const shared = Object.keys(REG.SHARED[kind]);
    for (const [name, spec] of Object.entries(specs)) {
      assert.deepEqual(S.validateSpec(name, spec), [], kind + '.' + name);
      assert.ok(!shared.includes(name), kind + ': ' + name + ' is a shared param');
      assert.equal(spec.max, name === 'count' ? 1.5 : 2);
    }
    assert.deepEqual(Object.keys(specs), [...R.KNOB_KINDS[kind]], kind);
  }
  assert.ok(!('speed' in R.knobSpecs('dwell', R.normalize('dwell', { knobs: ['speed', 'amp'], osc: [{ col: 'y', amp: 0.1 }] }).recipe)));
  const labelled = R.normalize('ornament', orn([layer()], { knobs: [{ what: 'count', label: { ja: '花びら' } }] })).recipe;
  assert.deepEqual(R.knobSpecs('ornament', labelled).count.label, { ja: '花びら', en: '花びら' });
});

test('withKnobs multiplies counts, sizes, speeds, alpha and amplitudes (pure)', () => {
  const recipe = R.normalize('ornament', orn([layer({ prim: 'particles', count: 40, size: [0.01, 0.02], alpha: 0.8,
    field: { speed: 0.1 }, move: [{ what: 'rot', wave: 'sine', amp: 10, hz: 1 }] })])).recipe;
  const out = R.withKnobs(recipe, { count: 1.5, size: 2, speed: 0.5, alpha: 2, amp: 0 });
  const l = out.layers[0];
  assert.deepEqual([l.count, l.size, l.field.speed, l.alpha, l.move[0].amp, l.move[0].hz], [60, [0.02, 0.04], 0.05, 1, 0, 0.5]);
  assert.equal(recipe.layers[0].count, 40, 'the recipe is not changed');
  const arrive = R.normalize('arrive', { knobs: ['amp'], motion: { tracks: [{ col: 'y', from: 2 }, { col: 'alpha', from: 0 }] } }).recipe;
  assert.deepEqual(R.withKnobs(arrive, { amp: 0.5 }).motion.tracks, [{ col: 'y', from: 1, to: 0 }, { col: 'alpha', from: 0.5, to: 1 }]);
  const dwell = R.normalize('dwell', { osc: [{ col: 'y', amp: 0.2 }] }).recipe;
  approx(R.withKnobs(dwell, { amp: 1.5 }).osc[0].amp, 0.3, 1e-12);
  assert.deepEqual(R.withKnobs(dwell, {}).osc, dwell.osc.map((o) => Object.assign({}, o)), 'no values → multipliers of 1');
});

test('normalize is idempotent; hash is stable across key order and 1e-12 noise', () => {
  const recipe = R.normalize('ornament', FLURRY).recipe;
  const shuffled = JSON.parse(JSON.stringify(recipe), (k, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).reverse()) : v));
  const noisy = JSON.parse(JSON.stringify(recipe), (k, v) => (typeof v === 'number' && v !== 0 ? v + 1e-12 : v));
  assert.equal(R.hash(shuffled), R.hash(recipe));
  assert.equal(R.hash(noisy), R.hash(recipe));
  assert.equal(R.hash(R.normalize('ornament', noisy).recipe), R.hash(recipe));
  assert.match(R.hash(recipe), /^[0-9a-f]{8}$/);
  assert.notEqual(R.hash(R.normalize('ornament', Object.assign({}, FLURRY, { seed: 8 })).recipe), R.hash(recipe));
  for (const dir of [359.9999999, -1e-7, -0.000001, 720.0000004, -359.9999996, 1e-7, 360, -90]) {
    const once = R.normalize('ornament', { layers: [{ prim: 'particles', field: { dir } }] }).recipe;
    const d = once.layers[0].field.dir;
    assert.ok(d >= 0 && d < 360, 'dir in [0, 360): ' + dir + ' → ' + d);
    assert.deepEqual(R.normalize('ornament', once).recipe, once, 'idempotent at the wrap: ' + dir);
  }
});

test('entryProblems: id, kind, by, name, blurb, tags, season, pool, rv, AI knobs', () => {
  const entry = { id: 'm3', kind: 'ornament', by: 'ai', name: { ja: '桜吹雪', en: 'Cherry flurry' }, blurb: { ja: '花びら', en: 'Petals' },
    tags: ['organic', 'soft'], season: 'spring', pool: false, rv: 1, recipe: R.normalize('ornament', FLURRY).recipe };
  assert.deepEqual(R.entryProblems(entry), []);
  const bad = (patch, code) => {
    const got = codes(R.entryProblems(Object.assign({}, entry, patch)));
    assert.ok(got.includes(code), code + ' for ' + JSON.stringify(patch) + ' → ' + got);
  };
  bad({ id: 'x3' }, 'bad-id'); bad({ id: 'm' }, 'bad-id'); bad({ kind: 'theme' }, 'bad-kind'); bad({ by: 'lock' }, 'bad-by');
  bad({ name: { ja: '' } }, 'bad-name'); bad({ name: { ja: 'あ'.repeat(25) } }, 'bad-name'); bad({ name: 'x' }, 'bad-name');
  bad({ name: { ja: 'a\nb' } }, 'bad-name'); bad({ blurb: { ja: 'あ'.repeat(81) } }, 'bad-blurb');
  bad({ tags: ['cute'] }, 'bad-tags'); bad({ tags: ['soft', 'soft'] }, 'bad-tags'); bad({ season: 'rainy' }, 'bad-season');
  bad({ pool: 'no' }, 'bad-pool'); bad({ rv: 0 }, 'bad-rv'); bad({ rv: 2 }, 'rv-newer'); bad({ recipe: [] }, 'bad-recipe');
  bad({ recipe: Object.assign({}, entry.recipe, { knobs: ['count', 'size', 'speed', 'alpha', 'amp'].map((what) => ({ what })) }) }, 'knobs-ai');
  assert.deepEqual(R.entryProblems(Object.assign({}, entry, { by: 'user', recipe: Object.assign({}, entry.recipe,
    { knobs: R.KNOB_WHATS.map((what) => ({ what })) }) })), [], 'users may have more knobs');
  assert.deepEqual(R.entryProblems(Object.assign({}, entry, { name: { ja: 'x' }, blurb: undefined, tags: undefined, season: undefined,
    pool: undefined, rv: undefined })), [], 'optional fields');
  assert.deepEqual(codes(R.entryProblems(null)), ['bad-entry']);
  assert.deepEqual(R.upgrade({ a: 1 }, 1), { recipe: { a: 1 }, rv: 1 });
  assert.equal(R.upgrade({}, 2), null);
});

// ---- fuzzing ----------------------------------------------------------------------------------------------------------

function randomJSON(rng, depth) {
  const r = rng.next();
  if (depth > 4 || r < 0.3) {
    return rng.pick([null, true, false, 0, -1, 1e9, -1e-9, NaN === NaN, 0.5, '', 'x', 'petal', 'alpha', 'beat', 'media', 'slot',
      '#FF0000', 'a3f9c2d17b0e4a5c6d7e8f901', 'm3', '__proto__', 'constructor', rng.range(-1000, 1000), rng.int(-5, 300)]);
  }
  if (r < 0.6) return Array.from({ length: rng.int(0, 6) }, () => randomJSON(rng, depth + 1));
  const keys = ['prim', 'layers', 'layer', 'knobs', 'parts', 'osc', 'motion', 'tracks', 'col', 'amp', 'hz', 'move', 'what', 'wave',
    'size', 'count', 'field', 'appear', 'fill', 'stops', 'base', 'params', 'shared', 'mirrorOf', 'src', 'time', 'inks', 'place',
    'scope', 'follow', 'seed', 'mix', 'curve', 'colCurve', 'order', 'dur', 'each', 'unit', '__proto__', 'toString'];
  const o = {};
  for (let i = rng.int(0, 7); i > 0; i--) o[rng.pick(keys)] = randomJSON(rng, depth + 1);
  return o;
}

// A valid recipe with one field replaced by random JSON (closer to real mistakes than pure noise).
function mutated(rng, kind) {
  const base = JSON.parse(JSON.stringify(kind === 'ornament' ? FLURRY : kind === 'arrive'
    ? { motion: { tracks: [{ col: 'y', from: 1 }], curve: 'softEnds' }, parts: [{ key: 'inkRise', params: { yFrom: 1 } }] }
    : { osc: [{ col: 'y', amp: 0.2 }], knobs: ['amp'] }));
  const paths = [['layers', 0, 'size'], ['layers', 0, 'move'], ['layers', 0], ['knobs'], ['motion', 'tracks'], ['osc', 0], ['parts', 0],
    ['layers', 0, 'field', 'life'], ['motion'], ['seed'], ['scope']];
  const path = rng.pick(paths);
  let at = base;
  for (let i = 0; i < path.length - 1; i++) at = at && typeof at === 'object' ? at[path[i]] : null;
  if (at && typeof at === 'object') at[path[path.length - 1]] = randomJSON(rng, 2);
  return base;
}

test('2,000 fuzzed JSON values never throw; normalize is idempotent on all of them', () => {
  const rng = stream('recipe-fuzz');
  const kinds = R.MAT_KINDS.concat(['theme', '']);
  for (let i = 0; i < 2000; i++) {
    const kind = rng.pick(kinds);
    const input = i % 2 ? randomJSON(rng, 0) : mutated(rng, rng.pick(['ornament', 'arrive', 'dwell']));
    const n = R.normalize(kind, input);
    assert.ok(n.recipe && Array.isArray(n.problems));
    assert.deepEqual(R.normalize(kind, n.recipe).recipe, n.recipe, 'idempotent');
    if (R.MAT_KINDS.includes(kind)) assert.deepEqual(R.normalize(kind, n.recipe).problems, [], 'a normalized recipe needs no more fixes');
    R.problems(kind, input);
    R.problems(kind, n.recipe, { media: { list: [] }, registry: { get: () => null } });
    R.cost(kind, n.recipe);
    R.cost(kind, input);
    R.knobSpecs(kind, n.recipe);
    R.withKnobs(n.recipe, randomJSON(rng, 2));
    R.hash(input);
    R.entryProblems(randomJSON(rng, 1));
    assert.equal(Object.getPrototypeOf(n.recipe), Object.prototype, 'no prototype pollution');
  }
  assert.equal({}.polluted, undefined);
});
