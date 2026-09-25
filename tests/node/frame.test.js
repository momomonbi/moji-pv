/* 文字PVメーカー v2 — original work. Tests for frameAt, scene evaluation, the kit adapters and the recording backend (DESIGN §8.2 frame). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');
const { approx } = require('../helpers/assert_plus.js');
const examples = require('../fixtures/example_parts.js');

const MV = load();
const H = MV.use('core/hash');
const RNG = MV.use('core/rng');
const MAT = MV.use('core/mat');
const DOC = MV.use('core/doc');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const T = MV.use('engine/scene/table');
const B = MV.use('engine/scene/builder');
const BH = MV.use('engine/scene/behave');
const STG = MV.use('engine/scene/stagger');
const BUILD = MV.use('engine/scene/build');
const CACHE = MV.use('engine/scene/cache');
const F = MV.use('engine/scene/frame');
const R = MV.use('engine/render/record');
const K = MV.use('parts/kit');

const stubReg = corpus.stubRegistry(MV);
const exReg = examples.exampleRegistry(MV);
const PLAN = corpus.planBasic();
Object.defineProperty(PLAN, 'env', { enumerable: false, value: envelope(PLAN.duration) });

function envelope(seconds) {
  const e = new Float32Array(Math.ceil(seconds * 20));
  for (let i = 0; i < e.length; i++) e[i] = 0.5 + 0.4 * Math.sin(i * 0.31);
  return e;
}

function svcFor(plan, reg) {
  return { registry: reg || stubReg, text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
}

// Scenes of every cut and segment of a plan (built once, like the facade's cache).
function scenesOf(plan, reg) {
  const svc = svcFor(plan, reg);
  return { cuts: plan.cuts.map((c) => BUILD.buildCut(c, plan, svc)), grounds: plan.grounds.map((g) => BUILD.buildGround(g, plan, svc)) };
}

// A reference frame through the recording backend: grounds, then visible cuts in `a` order, each with its camera.
function drawFrame(g, plan, scenes, t, scale) {
  const fg = F.frameAt(plan, t);
  const W = plan.design.w, Hh = plan.design.h;
  let cam = null;
  for (const c of fg.cuts) { F.evaluate(scenes.cuts[c.i], c.tl); cam = F.cameraAt(scenes.cuts[c.i], plan, t); }
  for (const e of fg.grounds) {
    F.evaluate(scenes.grounds[e.i], e.tl);
    R.drawScene(g, scenes.grounds[e.i], { scale, cam, W, H: Hh, pal: plan.look.palette, tl: e.tl });
  }
  for (const c of fg.cuts) {
    const sc = scenes.cuts[c.i];
    F.evaluate(sc, c.tl);
    R.drawScene(g, sc, { scale, cam: F.cameraAt(sc, plan, t), W, H: Hh, pal: plan.look.palette, tl: c.tl });
  }
  return fg;
}

function frameHashes(plan, scenes, times) {
  const rec = R.createRecorder();
  const scale = 360 / plan.design.short;
  const s = R.surfaceOf(rec.factory, Math.round(plan.design.w * scale), Math.round(plan.design.h * scale), false);
  return times.map((t) => { const m = rec.mark(); drawFrame(s.ctx, plan, scenes, t, scale); return rec.hash(m); });
}

// Op hashes of one scene drawn alone at 12 local times across its window.
function sceneHashes(scene, plan) {
  const rec = R.createRecorder();
  const scale = 360 / plan.design.short;
  const s = R.surfaceOf(rec.factory, Math.round(plan.design.w * scale), Math.round(plan.design.h * scale), false);
  const { a, b } = scene.times;
  return Array.from({ length: 12 }, (_, k) => {
    const tl = a + ((b - a) * (k + 0.5)) / 12;
    const m = rec.mark();
    F.evaluate(scene, tl);
    R.drawScene(s.ctx, scene, { scale, cam: F.cameraAt(scene, plan, scene.t0 + tl), W: plan.design.w, H: plan.design.h, pal: plan.look.palette, tl });
    return rec.hash(m);
  });
}

const GOLDEN_TIMES = (plan) => Array.from({ length: 40 }, (_, i) => (plan.duration * (i + 0.5)) / 40);

function plain(fg) { return JSON.parse(JSON.stringify(fg)); }

// --- frameAt ---------------------------------------------------------------------------------------------------

test('frameAt lists exactly the cuts with a ≤ t < b, sorted by a, with cut-local times', () => {
  for (const t of [-1, 0, 0.5, 4.13, 4.5, 8.13, 8.2, 23.4, 37.1, 59.99, 60, 61]) {
    const fg = F.frameAt(PLAN, t);
    const want = PLAN.cuts.map((c, i) => [c, i]).filter(([c]) => c.a <= t && t < c.b).sort((p, q) => p[0].a - q[0].a || p[1] - q[1]);
    assert.deepEqual(fg.cuts.map((e) => e.i), want.map((w) => w[1]), 't=' + t);
    for (const e of fg.cuts) assert.equal(e.tl, t - PLAN.cuts[e.i].t0);
    assert.equal(fg.t, t);
    assert.equal(fg.backdrop, 'scene');
  }
  const c = PLAN.cuts[3];
  assert.ok(F.frameAt(PLAN, c.a).cuts.some((e) => e.i === 3), 'a is inside the window');
  assert.ok(!F.frameAt(PLAN, c.b).cuts.some((e) => e.i === 3), 'b is outside');
});

test('frameAt: one ground segment normally; the texture decision; accents of the current cut', () => {
  assert.deepEqual(plain(F.frameAt(PLAN, 5).grounds), [{ i: 0, tl: 5 }]);
  assert.deepEqual(plain(F.frameAt(PLAN, 30).grounds), [{ i: 1, tl: 30 - PLAN.grounds[1].t0 }]);
  assert.deepEqual(F.frameAt(PLAN, 5).post.texture, PLAN.look.texture);
  const noTexture = Object.assign({}, PLAN, { look: Object.assign({}, PLAN.look, { texture: { v: 'none', from: 'auto' } }) });
  assert.equal(F.frameAt(noTexture, 5).post.texture, null);
  const focus = PLAN.cuts.findIndex((c) => c.key === 'ra~3');
  const fc = PLAN.cuts[focus];
  assert.deepEqual(plain(F.frameAt(PLAN, fc.t0 + 0.1).post.accents), [{ cut: focus, slot: 'filter#0', tl: 0.1 }].map((e) => Object.assign(e, { tl: fc.t0 + 0.1 - fc.t0 })));
  assert.deepEqual(F.frameAt(PLAN, fc.a + 0.01).post.accents, [], 'before its t0 the previous cut is current');
});

test('frameAt: a seam window is centred on `at`; A and B are listed; accents switch at u = 0.5', () => {
  const s = PLAN.seams[0];
  const iA = PLAN.cuts.findIndex((c) => c.key === s.a), iB = PLAN.cuts.findIndex((c) => c.key === s.into);
  const lo = s.at - s.dur / 2, hi = s.at + s.dur / 2;
  assert.equal(F.frameAt(PLAN, lo - 1e-6).seam, null);
  approx(F.frameAt(PLAN, lo).seam.u, 0, 1e-9);
  approx(F.frameAt(PLAN, s.at).seam.u, 0.5, 1e-9);
  assert.equal(F.frameAt(PLAN, hi).seam, null);
  const fg = F.frameAt(PLAN, lo + 0.01);
  assert.equal(fg.seam.i, 0);
  assert.equal(fg.seam.scope, 'text');
  assert.ok(fg.seam.aCuts.includes(iA) && fg.seam.bCuts.includes(iB), 'A and B even when B is not visible yet');
  assert.ok(!fg.cuts.some((e) => e.i === iB), 'B is not in cuts before its a');
  assert.equal(fg.grounds.length, 1, 'a text seam keeps one ground');

  // accents: give A and B filters and check the switch
  const plan = JSON.parse(JSON.stringify(PLAN));
  for (const i of [iA, iB]) {
    plan.cuts[i].slots['filter.count'] = { v: 1, from: 'auto' };
    plan.cuts[i].slots['filter#0'] = { v: 'stubDim', p: { amount: 0.5, when: 'always' }, from: 'auto' };
  }
  assert.equal(F.frameAt(plan, s.at - 0.01).post.accents[0].cut, iA);
  assert.equal(F.frameAt(plan, s.at + 0.01).post.accents[0].cut, iB);
});

test('frameAt: a world seam across segments shows both grounds', () => {
  const plan = JSON.parse(JSON.stringify(PLAN));
  const iB = plan.cuts.findIndex((c) => c.key === 'ra~0');
  const B0 = plan.cuts[iB], A0 = plan.cuts[iB - 1];
  plan.seams = [{ into: B0.key, at: B0.a, dur: 0.5, scope: 'world', a: A0.key, b: B0.key, slot: { v: 'irisGate', p: { dur: 0.5 }, from: 'auto' } }];
  const fg = F.frameAt(plan, B0.a - 0.1);
  assert.equal(fg.seam.scope, 'world');
  assert.deepEqual(fg.grounds.map((g) => g.i), [0, 1]);
  assert.equal(fg.seam.aGround, 0);
  assert.equal(fg.seam.bGround, 1);
  assert.equal(F.frameAt(plan, B0.a + 0.3).grounds.length, 1, 'after the window');
});

test('frameAt is pure: any evaluation order and pooled or fresh output give the same graphs', () => {
  const rng = RNG.stream('frame-order');
  const times = Array.from({ length: 300 }, () => rng.range(-1, PLAN.duration + 1));
  const direct = times.map((t) => JSON.stringify(F.frameAt(PLAN, t)));
  let pooled = null;
  const order = rng.shuffle(times.map((_, i) => i));
  const got = new Array(times.length);
  for (const i of order) { pooled = F.frameAt(PLAN, times[i], pooled); got[i] = JSON.stringify(pooled); }
  assert.deepEqual(got, direct);
  const fg = F.frameAt(PLAN, 8.2);
  assert.equal(F.frameAt(PLAN, 9, fg), fg, 'the pooled object is reused');
  assert.ok(!Object.keys(fg).includes('_pool'), 'the pool is not part of the graph');
});

// --- scene evaluation and frames ----------------------------------------------------------------------------------

test('scene evaluation is a pure function of local time (no state between frames)', () => {
  const scenes = scenesOf(PLAN);
  const rng = RNG.stream('eval-order');
  for (const sc of scenes.cuts.slice(0, 6)) {
    const times = Array.from({ length: 40 }, () => rng.range(sc.times.a, sc.times.b));
    const snap = (tl) => { F.evaluate(sc, tl); return H.hashJSON([T.POSE.map((c) => sc.table.live[c].slice(0, sc.table.n)), sc.table.m.slice(0, sc.table.n * 6)]); };
    const seq = times.map(snap);
    const shuffled = rng.shuffle(times.map((_, i) => i));
    const got = new Array(times.length);
    for (const i of shuffled) got[i] = snap(times[i]);
    assert.deepEqual(got, seq, sc.key);
  }
});

test('recorded frames: frame N directly equals frame N after 0..N−1, and two builds give the same op hashes', () => {
  const times = GOLDEN_TIMES(PLAN);
  const a = frameHashes(PLAN, scenesOf(PLAN), times);
  const b = frameHashes(PLAN, scenesOf(PLAN), times);
  assert.deepEqual(a, b);
  const scenes = scenesOf(PLAN);
  for (const n of [7, 23, 39]) assert.equal(frameHashes(PLAN, scenes, [times[n]])[0], a[n], 'frame ' + n);
  assert.equal(new Set(a).size > 20, true, 'frames differ over time');
});

// The golden-frame render of one document through the facade (update_golden.js does the same): a short side of 360 px,
// the 40 GOLDEN_TIMES, export quality.
async function goldenFrames(reg, doc) {
  const { createEngine } = MV.use('engine/facade');
  const rec = R.createRecorder();
  const engine = createEngine({ registry: reg, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null });
  const { plan } = engine.setDoc(doc);
  await engine.prepare(0, plan.duration, { export: true });
  const [w, h] = DOC.DESIGN_SIZE[doc.look.aspect];
  const k = 360 / Math.min(w, h);
  const made = rec.factory.create(Math.round(w * k), Math.round(h * k), { alpha: false });
  const surface = { canvas: made.canvas, ctx: made.ctx, w: Math.round(w * k), h: Math.round(h * k) };
  const got = GOLDEN_TIMES(plan).map((time) => {
    const m = rec.mark();
    engine.renderFrame(surface, time, { quality: 'export', pick: false, scale: surface.w / plan.design.w });
    return rec.hash(m);
  });
  engine.dispose();
  return got;
}

// Skipped only while there is nothing to compare (no facade, or no goldens written yet). A registry change fails: the
// goldens are then regenerated on purpose (§2.1), so a render regression cannot hide behind a catalog change.
test('golden frame hashes (tests/golden/frame_hashes.json) match the engine facade', async (t) => {
  const file = path.join(__dirname, '..', 'golden', 'frame_hashes.json');
  const golden = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!MV.has('engine/facade')) { t.skip('engine/facade is not built yet (WP4 part 2); goldens come from update_golden.js'); return; }
  if (!golden.registry || !Object.keys(golden.frames).length) { t.skip('no golden frames yet: run node tests/update_golden.js'); return; }
  const kind = MV.has('parts/catalog') ? 'catalog' : 'stub';            // the registry update_golden.js renders with
  const reg = kind === 'catalog' ? MV.use('parts/catalog').defaultRegistry() : stubReg;
  assert.ok(golden.registry.kind === kind && golden.registry.version === reg.version, 'goldens were made with the ' +
    golden.registry.kind + ' registry ' + golden.registry.version + ', the current one is the ' + kind + ' registry ' +
    reg.version + ': check the frames, then run node tests/update_golden.js');
  for (const { name, doc } of corpus.projects()) assert.deepEqual(await goldenFrames(reg, doc), golden.frames[name], name);
});

// DESIGN_2_1 §9: documents without the new pins differ from v2 only by the automatic camerawork. With the camerawork
// pinned off, every corpus project renders the v2 frames exactly (frame_hashes_v2.json is frozen; update_golden.js
// checks it before it writes anything). No registry check: a new part may change the registry, never these frames.
test('with the camerawork pinned off, every corpus project renders the v2 frames (tests/golden/frame_hashes_v2.json)', async () => {
  const v2 = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'golden', 'frame_hashes_v2.json'), 'utf8')).frames;
  const reg = MV.use('parts/catalog').defaultRegistry();
  assert.deepEqual(Object.keys(v2), corpus.PROJECTS.slice());
  for (const { name, doc } of corpus.projects()) {
    const off = corpus.withoutCamerawork(doc);
    const plan = MV.use('planner/plan').plan(off, { registry: reg });
    assert.ok(plan.cuts.every((c) => c.slots['cam.shot'].v === 'none') && plan.rigs.every((r) => r.rig.v === 'none'),
      name + ': the pins switch the camerawork off');
    assert.deepEqual(await goldenFrames(reg, off), v2[name], name);
  }
});

test('tick-based effects are identical at 30 and 60 fps sample times', () => {
  const grain = stubReg.get('filter', 'grainFilm');
  const scenes = scenesOf(PLAN);
  const frame = (t) => {
    const rec = R.createRecorder();
    const src = R.surfaceOf(rec.factory, 640, 360, true);
    drawFrame(src.ctx, PLAN, scenes, t, 1 / 3);
    const fx = R.createRecordingFx(rec, { w: 640, h: 360, unit: 1 / 3, plan: PLAN, cut: null, seed: 7 });
    fx.begin();
    grain.apply(fx, src, { amount: 0.5, when: 'always' }, t);
    return rec.hash();
  };
  const at30 = [], at60 = [];
  for (let i = 0; i < 60; i++) at30.push(frame(3 + i / 30));
  for (let j = 0; j < 120; j += 2) at60.push(frame(3 + j / 60));
  assert.deepEqual(at60, at30);
  assert.equal(F.tick(12, 3 + 1 / 12 - 1e-9), 37, 'tick absorbs float noise just below a boundary');
  assert.equal(F.tick(12, 3 + 1 / 12 - 1e-4), 36);
  const ticks30 = Array.from({ length: 30 }, (_, i) => F.tick(12, i / 30));
  const ticks60 = Array.from({ length: 60 }, (_, j) => F.tick(12, j / 60)).filter((_, j) => j % 2 === 0);
  assert.deepEqual(ticks60, ticks30);
  assert.notEqual(frame(3), frame(3 + 1 / 12), 'the grain tile changes with the tick');
});

// --- time lookups, camera, backdrops ------------------------------------------------------------------------------

test('impulses, beats and loudness are closed-form lookups', () => {
  const plan = Object.assign({}, PLAN, { impulses: [{ t: 10, kind: 'shake', amp: 0.5, decay: 0.4 }, { t: 10.2, kind: 'shake', amp: 0.2, decay: 0.1 }] });
  assert.equal(F.impulseAt(plan, 'shake', 9.99), 0);
  approx(F.impulseAt(plan, 'shake', 10), 0.5, 1e-12);
  approx(F.impulseAt(plan, 'shake', 10.3), 0.5 * Math.exp(-0.3 / 0.4) + 0.2 * Math.exp(-1), 1e-12);
  assert.equal(F.impulseAt(plan, 'shake', 10 + 6 * 0.4), 0, 'outside 6·decay');
  assert.equal(F.impulseAt(plan, 'flash', 10), 0);
  const many = Object.assign({}, PLAN, { impulses: Array.from({ length: 20 }, (_, i) => ({ t: i * 0.01, kind: 'punch', amp: 1, decay: 10 })) });
  assert.ok(F.impulseAt(many, 'punch', 0.2) <= 8, 'at most 8 terms');
  const beat = F.beatAt(PLAN, 0.25 + 0.5 * 5 + 0.1);
  assert.equal(beat.index, 5); approx(beat.since, 0.1, 1e-9); assert.equal(beat.bar, 1);
  assert.equal(F.beatAt(Object.assign({}, PLAN, { beats: null }), 3), null);
  const lv = F.levelAt(PLAN, 1.025);
  approx(lv, PLAN.env[20], 1e-6);
  assert.equal(F.levelAt(corpus.planBasic(), 3), 0.5, 'no envelope → 0.5');
  const g = F.gridAt(PLAN, 4.25);
  approx(g.beatAt(0).since, F.beatAt(PLAN, 4.25).since, 1e-9);
});

test('camera: identity view without motion, parallax 0 ignores the camera, impulses shake and punch', () => {
  const scenes = scenesOf(PLAN);
  const sc = scenes.cuts[0];
  F.evaluate(sc, 1);
  const cam = F.cameraAt(sc, Object.assign({}, PLAN, { impulses: [] }), 1);
  assert.deepEqual(plain(cam), { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0, fz: 1 });
  const V = new Float32Array(6), I = MAT.ident(new Float32Array(6));
  approx(F.viewMatrix(V, cam, 1, 1920, 1080), I, 1e-4);
  const moved = { x: 40, y: -10, zoom: 1.2, roll: 0.1, shakeX: 3, shakeY: 1 };
  approx(F.viewMatrix(V, moved, 0, 1920, 1080), I, 1e-4);
  const shaken = Object.assign({}, PLAN, { impulses: [{ t: 1, kind: 'shake', amp: 1, decay: 0.4 }, { t: 1, kind: 'punch', amp: 1, decay: 0.4 }] });
  const c2 = F.cameraAt(sc, shaken, 1.05);
  assert.ok(Math.abs(c2.shakeX) > 0 && Math.abs(c2.shakeX) <= 20, 'shake within ±20 du');
  approx(c2.zoom, 1 + 0.04 * Math.exp(-0.05 / 0.4), 1e-6);
  // view(k) centre point: the frame centre maps to itself shifted by −cam·k
  const pt = MAT.apply(F.viewMatrix(V, { x: 10, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0 }, 0.5, 1920, 1080), 960, 540, new Float32Array(2));
  approx(Array.from(pt), [955, 540], 1e-3);
});

test('backdrop modes: palettes, fills and allowed filters (§4.19.4)', () => {
  const pal = F.paletteFor(PLAN.look.palette, 'black');
  assert.equal(pal.ink, '#FFFFFF'); assert.equal(pal.accent, '#FFFFFF'); assert.equal(pal.ground, '#000000');
  assert.equal(F.paletteFor(PLAN.look.palette, 'scene'), PLAN.look.palette);
  assert.equal(F.backdropFill('chroma'), '#00B140');
  assert.equal(F.backdropFill('black'), '#000000');
  assert.equal(F.backdropFill('scene'), null);
  const f = (stage, alphaSafe) => ({ stage, alphaSafe });
  assert.equal(F.filterAllowed(f('tone', false), 'chroma'), false);
  assert.equal(F.filterAllowed(f('shape', false), 'chroma'), true);
  assert.equal(F.filterAllowed(f('tone', true), 'chroma'), true);
  assert.equal(F.filterAllowed(f('film', false), 'black'), true);
  assert.equal(F.filterAllowed(f('optic', true), 'black'), false);
  assert.equal(F.filterAllowed(f('film', false), 'clear'), false);
  assert.equal(F.filterAllowed(f('optic', false), 'scene'), true);
});

// --- the node table ----------------------------------------------------------------------------------------------

test('node table: FROZEN columns, local matrix formula, parents, clamps and growth', () => {
  assert.equal(T.POSE.length, 22);
  assert.deepEqual(T.LAYERS.map((l) => [l.name, l.parallax]), [['ground', 0.25], ['far', 0.5], ['mid', 0.8], ['text', 1], ['near', 1.2], ['hud', 0]]);
  const t = T.createTable();
  const root = T.addNode(t, { type: T.TYPE.group });
  const kid = T.addNode(t, { type: T.TYPE.glyph, parent: root });
  T.setBase(t, root, { x: 100, y: 50, rot: Math.PI / 2 });
  T.setBase(t, kid, { x: 10, y: 0, sx: 2, z: 1600, alpha: 0.5, px: 3, blur: -1, tint: 3 });
  T.resetLive(t);
  T.solve(t);
  // kid: s = 1600/3200 = 0.5 → scale 2·0.5 = 1 about the pivot; world = root(rotate 90°) · T(10, 0)
  const M = T.worldOf(t, kid, new Float32Array(6));
  const p = MAT.apply(M, 0, 0, new Float32Array(2));
  approx(Array.from(p), [100, 60], 1e-4);
  approx(t.wa[kid], 0.5, 1e-7);
  assert.equal(t.live.blur[kid], 0, 'blur clamps to ≥ 0');
  assert.equal(t.live.tint[kid], 1, 'tint clamps to ≤ 1');
  const L = T.localMatrix(new Float32Array(6), t.base, kid);
  const ref = MAT.compose(new Float32Array(6), 10, 0, 0, 0, 0, 2 * 0.5, 1 * 0.5, 3, 0);
  approx(Array.from(L), Array.from(ref), 1e-6);
  assert.throws(() => T.addNode(t, { type: T.TYPE.group, parent: 9 }), /parent/);
  for (let i = 0; i < 300; i++) T.addNode(t, { type: T.TYPE.group });
  assert.equal(t.cap, 512, 'grows in chunks of 256');
  assert.equal(t.base.x[kid], 10, 'growth keeps values');
});

// --- builder -----------------------------------------------------------------------------------------------------

test('builder: text commits one contiguous glyph block; bounds, freeAround, shapes and layers', () => {
  const D = BUILD.designEnv({ w: 1920, h: 1080, short: 1080 });
  const text = createTextService({ measurer: fakeMeasurer(), faces: PLAN.look.faces });
  const bld = B.createBuilder({ D, text, cutText: '夜明けの街を走る', defaults: { orient: 'h', lang: 'ja', emph: [[3, 4]] } });
  const g = bld.sb.group({ x: 0, y: 0 });
  const r1 = bld.sb.text({ parent: g, span: [0, 4], size: 120, box: { x: 200, y: 300, w: 800, h: 200 } });
  const mark = bld.sb.shape({ layer: 'near', path: K.shape.rect(10, 10, 100, 40, 8), fill: 'accent' });
  const r2 = bld.sb.text({ parent: g, span: [4, 8], size: 120, box: { x: 200, y: 520, w: 800, h: 200 } });
  const box = bld.sb.bounds(g);
  assert.ok(box.w > 0 && box.x >= 200 && box.y >= 300 && box.y + box.h <= 720 + 1e-3, 'bounds before commit (pending text)');
  const range = bld.commitText();
  assert.equal(range.to - range.from, 8);
  assert.ok(range.from > mark, 'glyphs are allocated after the shape, in one block');
  assert.deepEqual([bld.runs[0].from, bld.runs[1].to], [range.from, range.to]);
  assert.equal(bld.table.parent[range.from], r1.node);
  assert.equal(bld.table.parent[range.to - 1], r2.node);
  assert.equal(bld.stores.glyph[bld.table.payload[range.from + 3]].ink, 'accent', 'emphasis ink from cut.emph');
  const after = bld.sb.bounds(g);
  approx([after.x, after.y, after.w, after.h], [box.x, box.y, box.w, box.h], 1e-3);
  const free = bld.sb.freeAround(after);
  assert.ok(free.length >= 2 && free.every((q) => q.w >= 1 && q.h >= 1));
  assert.ok(free.every((q) => q.x >= D.safe.l - 1e-6 && q.x + q.w <= D.w - D.safe.r + 1e-6));
  bld.sb.layer('near', { blend: 'screen', opacity: 0.5 });
  assert.ok(T.isIsolated(bld.layers[4]));
  assert.throws(() => bld.sb.layer('near', { blend: 'nope' }), /blend/);
  assert.throws(() => bld.sb.shape({ path: [1, 2] }), /ShapeSpec/);
  assert.throws(() => bld.sb.text({ size: 10 }), /box/);
});

test('shapes: the ShapeSpec codec, bounds and replay', () => {
  const s = K.shape.path([['M', 0, 0], ['L', 10, 0], ['Q', 15, 5, 10, 10], ['C', 5, 12, 2, 12, 0, 10], ['Z']]);
  assert.deepEqual(Array.from(s.ops), [0, 1, 2, 3, 7]);
  assert.deepEqual(B.shapeBounds(s), [0, 0, 15, 12]);
  assert.deepEqual(B.shapeBounds(K.shape.ellipse(5, 5, 3, 2)), [2, 3, 8, 7]);
  assert.deepEqual(Array.from(K.shape.poly([[0, 0], [4, 0], [4, 4]], true).ops), [0, 1, 1, 7]);
  const rec = R.createRecorder();
  const { ctx } = rec.factory.create(10, 10, { alpha: true });
  B.replayShape(ctx, K.shape.rect(0, 0, 10, 10, 2));
  const names = rec.ops().map((o) => o[1]);
  assert.equal(names[0], 'beginPath');
  assert.ok(names.includes('arc') && names[names.length - 1] === 'closePath');
  assert.throws(() => K.shape.path([['M', 0]]), /needs 2/);
  assert.throws(() => K.shape.path([['X', 0, 0]]), /unknown/);
});

test('particles are closed-form in t (bursts included)', () => {
  const rng = RNG.stream('particles');
  const d = B.particleData(50, { area: { x: 0, y: 0, w: 100, h: 50 }, vx: 20, vy: -5, sway: 3, swayHz: 0.5, size: [2, 4], life: [1, 2] }, rng);
  const out = {}, again = {};
  for (const t of [0, 0.5, 3.25, 10]) {
    for (let j = 0; j < d.n; j++) {
      B.particleAt(d, j, t, out); B.particleAt(d, j, t, again);
      assert.deepEqual(out, again);
      assert.ok(out.x >= 0 && out.x < 100 && out.y >= 0 && out.y < 50, 'wrapped into the area');
      assert.ok(out.alpha >= 0 && out.alpha <= 1);
    }
  }
  const burst = B.particleData(10, { area: { x: 0, y: 0, w: 100, h: 100 }, life: [1, 1], bursts: { times: [2], speed: 50, gravity: 100 } }, rng);
  B.particleAt(burst, 0, 1.9, out); assert.equal(out.alpha, 0, 'before the burst');
  B.particleAt(burst, 0, 2.5, out); approx(out.alpha, 0.5, 1e-6);
});

// --- stagger and the kit -----------------------------------------------------------------------------------------

function sampleScene(reg, slots) {
  const plan = JSON.parse(JSON.stringify(PLAN));
  const cut = plan.cuts[1];
  Object.assign(cut.slots, slots);
  cut.els = {};
  return { scene: BUILD.buildCut(cut, plan, svcFor(plan, reg)), plan, cut };
}

test('stagger: ranks per order, unit sharing, sung timing and pivots', () => {
  const { scene } = sampleScene(stubReg, {});
  const target = scene.target;
  const env = { seed: 42, cut: PLAN.cuts[1], times: scene.times };
  const n = target.to - target.from;
  assert.deepEqual(Array.from(STG.ranksOf(env, target, 'lead', 'glyph').rank), [...Array(n).keys()]);
  assert.deepEqual(Array.from(STG.ranksOf(env, target, 'tail', 'glyph').rank), [...Array(n).keys()].reverse());
  const core = Array.from(STG.ranksOf(env, target, 'core', 'glyph').rank);
  assert.equal(Math.min(...core), 0); assert.equal(core[0], core[n - 1]);
  const scatter = STG.ranksOf(env, target, 'scatter', 'glyph');
  assert.deepEqual(Array.from(scatter.rank).sort((a, b) => a - b), [...Array(n).keys()]);
  assert.deepEqual(Array.from(STG.ranksOf(Object.assign({}, env), target, 'scatter', 'glyph').rank), Array.from(scatter.rank), 'seeded');
  const byWord = STG.ranksOf(env, target, 'lead', 'word');
  for (let j = 0; j < n; j++) assert.equal(byWord.rank[j], target.unitOf.word[j], 'glyphs of a word share its rank');
  const delays = STG.staggerOf(env, target, 'lead', 0.05, 'glyph');
  approx(delays[3], 0.15, 1e-6);
  const sung = STG.staggerOf(env, target, 'sung', 0, 'glyph');
  assert.equal(sung[0], 0);
  assert.ok(sung[n - 1] > 0 && sung[n - 1] < PLAN.cuts[1].t1 - PLAN.cuts[1].t0);
  for (let j = 1; j < n; j++) assert.ok(sung[j] >= sung[j - 1], 'sung delays follow the reading');
  const piv = STG.pivots(env, target, 'run');
  const cx = (j) => target.x[j] + piv.px[j];
  for (let j = 1; j < n; j++) approx(cx(j), cx(0), 1e-3, 'one pivot per run');
  assert.ok(Array.from(STG.pivots(env, target, 'glyph').px).every((v) => v === 0));
});

test('kit: moves adapter timing, identity at the ends, pivots and the dwell envelope', () => {
  const { scene } = sampleScene(exReg, {
    arrive: { v: 'inkRise', p: { dur: 0.6, each: 0.04, order: 'lead', ease: 'expoOut', yFrom: 0.55, blurFrom: 0.12 }, from: 'auto' },
    dwell: { v: 'waveRun', p: { amount: 0.5, speed: 1, height: 0.1 }, from: 'auto' },
    depart: { v: 'windBlow', p: { dur: 0.35, each: 0.02, order: 'lead', ease: 'quadIn', dir: 'right', lift: 1 }, from: 'auto' },
    arrange: { v: 'centerAnchor', p: { offsetX: 0, offsetY: 0 }, from: 'auto' },
    lens: { v: 'fixedFrame', p: { amount: 0.3 }, from: 'auto' }, 'ornament.count': { v: 0, from: 'auto' },
  });
  const [arrive, dwell, depart] = [BH.PH.MOTION, BH.PH.REST].map((ph) => scene.behaviours.filter((b) => b.phase === ph));
  assert.equal(arrive.length, 2, 'arrive + depart');
  const a = arrive.find((b) => b.live === 'until'), d = arrive.find((b) => b.live === 'after');
  approx(a.t0, scene.times.a, 1e-9);
  approx(a.t1, scene.times.rest, 1e-9, 'rest = end of the fitted entrance');
  approx(d.t1, scene.times.b, 1e-9, 'the exit ends at b');
  approx(d.t0, scene.times.out, 1e-9);
  assert.equal(dwell.length, 1);
  approx(dwell[0].t0, scene.times.rest, 1e-9);
  F.evaluate(scene, scene.times.a - 1);
  const y0 = scene.table.live.y[scene.text.from] - scene.table.base.y[scene.text.from];
  const em = scene.target.em[0];
  approx(y0, 0.55 * em, 1e-3, 'start pose before t0 (0.55 em below)');
  assert.equal(scene.table.live.alpha[scene.text.from], 0);
  F.evaluate(scene, scene.times.rest);
  assert.ok(Math.abs(scene.table.live.y[scene.text.from] - scene.table.base.y[scene.text.from]) < 1e-4, 'rest pose at rest');
  approx(BH.envelopeWeight(scene.times.rest, scene.times.rest, scene.times.out), 0, 0);
  approx(BH.envelopeWeight(scene.times.rest + 0.25, scene.times.rest, scene.times.out), 1, 1e-9);
  approx(BH.envelopeWeight(scene.times.out - 0.1, scene.times.rest, scene.times.out), 0.5, 1e-9);
  F.evaluate(scene, scene.times.b - 1e-6);
  assert.ok(scene.table.live.alpha[scene.text.from] < 0.01, 'gone at the end of the exit');
  assert.ok(Array.isArray(scene.glyphKeys) && scene.glyphKeys.length > 0);
});

test('kit: mirror reverses time, variant keeps functions, helpers check their input', () => {
  const rise = exReg.get('arrive', 'inkRise'), sink = exReg.get('depart', 'inkSink');
  assert.equal(sink.kind, 'depart');
  assert.deepEqual(sink.motion.tracks.y, { from: 0, to: 0.55, unit: 'em' });
  assert.equal(sink.motion.curve.alpha, 'quadIn');
  assert.equal(sink.shared.ease.auto.value, 'expoIn');
  assert.ok(sink.params.yTo && !sink.params.yFrom);
  const flip = exReg.get('arrive', 'hingeFlip');
  const flop = K.mirror(flip, { key: 'hingeFlop', label: { ja: '逆', en: 'Flop' }, blurb: { ja: '戻る', en: 'Swings away' } });
  assert.equal(typeof flop.make.glyphFn, 'function');
  const P = Object.fromEntries(BH.DELTA.map((c) => [c, ['sx', 'sy', 'alpha', 'reveal'].includes(c) ? 1 : 0]));
  flop.make.glyphFn(P, {}, 0, 0, { axis: 'y', depth: 100 });
  assert.equal(P.ry, 0, 'mirrored: identity at k = 0');
  const v = K.variant(rise, { key: 'inkRiseFast', label: { ja: '速い墨', en: 'Fast ink' }, shared: { dur: { auto: { value: 0.3 } } } });
  assert.equal(v.fallback, false);
  assert.equal(v.shared.dur.auto.value, 0.3);
  assert.deepEqual(v.shared.each, rise.shared.each, 'other shared fields kept');
  assert.equal(v.motion, rise.motion);
  assert.throws(() => K.arrive({ key: 'badMove', label: { ja: 'x', en: 'x' }, blurb: { ja: 'x', en: 'x' },
    ...K.moves({ tracks: { y: [0, 1] } }) }), /END at identity/);
  assert.throws(() => K.lens({ key: 'noMake', label: { ja: 'x', en: 'x' } }), /make\(\) is required/);
  assert.throws(() => K.moves({ tracks: { nope: [0, 1] } }), /unknown track/);
  const ornament = K.ornament({ key: 'plainMark', label: { ja: 'x', en: 'x' }, blurb: { ja: 'x', en: 'x' }, build() {} });
  assert.deepEqual([ornament.scope, ornament.follow, ornament.pool, ornament.fallback], ['cut', 'text', true, false]);
  assert.ok(Object.isFrozen(ornament));
});

const REG = MV.use('core/registry');
const EX_DEFS = examples.exampleParts(K).concat(corpus.minimalFallbacks().filter((d) => d.kind !== 'theme' && d.kind !== 'mood'));
const words = (ja, en) => ({ label: { ja, en }, blurb: { ja, en } });

test('kit: a definition or variant refines its exposed params; the mirror carries the refinement to the exit', () => {
  const rise = exReg.get('arrive', 'inkRise');
  const tall = K.variant(rise, Object.assign({ key: 'inkRiseTall', params: { yFrom: { auto: { value: 1.2 } },
    blurFrom: { label: { ja: 'にじみ', en: 'Smudge' } } } }, words('高い墨', 'Tall ink')));
  assert.deepEqual(tall.params.yFrom.auto, { value: 1.2 }, 'the variant\'s auto');
  assert.deepEqual(tall.params.yFrom.label, rise.params.yFrom.label, 'other fields kept');
  assert.deepEqual(tall.params.blurFrom.label, { ja: 'にじみ', en: 'Smudge' }, 'the variant\'s label');
  assert.deepEqual(tall.params.blurFrom.auto, rise.params.blurFrom.auto);
  const lift = K.arrive(Object.assign({ key: 'liftRise' }, words('持ち上げ', 'Lift rise'),
    K.moves({ tracks: { y: [0.55, 0], alpha: [0, 1] }, expose: ['y'] }),
    { params: { yFrom: { auto: { range: [0.3, 0.9], follow: 'energy' }, label: { ja: '高さ', en: 'Height' } },
      yTo: { type: 'num', min: 0, max: 1, label: { ja: 'x', en: 'x' }, auto: { value: 0 } } } }));
  assert.deepEqual(lift.params.yFrom.auto, { range: [0.3, 0.9], follow: 'energy' }, 'own auto next to K.moves');
  assert.deepEqual(lift.params.yFrom.label, { ja: '高さ', en: 'Height' });
  assert.deepEqual([lift.params.yFrom.type, lift.params.yFrom.unit, lift.params.yFrom.ui], ['num', 'em', 'advanced']);
  assert.ok(!('yTo' in lift.params), 'the exit name means nothing on an entrance');
  const sink = K.mirror(lift, Object.assign({ key: 'liftSink' }, words('沈み', 'Lift sink')));
  assert.deepEqual(sink.params.yTo.auto, { range: [0.3, 0.9], follow: 'energy' }, 'refinement carried to yTo');
  assert.equal(sink.params.yTo.label.ja, '終わりの縦の位置', 'the label names the end');
  assert.ok(!('yFrom' in sink.params));
  const far = K.variant(rise, Object.assign({ key: 'inkRiseFar', params: { yFrom: { auto: { value: 12 } } } }, words('遠い墨', 'Far ink')));
  assert.deepEqual([far.params.yFrom.max, far.params.yFrom.auto.value], [12, 12], 'the range widens to the refined auto');
  const reg = REG.createRegistry(EX_DEFS.concat([tall, lift, sink, far]));
  const yFrom = reg.params('arrive', 'inkRiseTall').find((q) => q.name === 'yFrom');
  assert.deepEqual(yFrom.spec.auto, { value: 1.2 });
  const { scene } = sampleScene(reg, { arrive: { v: 'inkRiseTall', p: { dur: 0.6, each: 0.04, order: 'lead', ease: 'expoOut' }, from: 'auto' } });
  F.evaluate(scene, scene.times.a - 1);
  const i = scene.text.from;
  approx(scene.table.live.y[i] - scene.table.base.y[i], 1.2 * scene.target.em[0], 1e-3, 'the refined auto reaches the scene');
});

test('kit: jx jy pixel tracks are du unless unit em (x y z blur are em); exposed ranges and units follow', () => {
  const m = K.moves({ tracks: { jx: [0.5, 0], x: [0.5, 0], pixel: [6, 0] }, expose: ['jx', 'x', 'pixel'] });
  assert.deepEqual([m.params.jxFrom.unit, m.params.jxFrom.min, m.params.jxFrom.max], ['du', -400, 400]);
  assert.deepEqual([m.params.pixelFrom.unit, m.params.pixelFrom.max], ['du', 200]);
  assert.deepEqual([m.params.xFrom.unit, m.params.xFrom.min, m.params.xFrom.max], ['em', -10, 10]);
  const SCH = MV.use('core/schema');
  assert.equal(SCH.coerce(m.params.jxFrom, 0.5), 0.5, 'the step keeps the authored default');
  const inEm = K.moves({ tracks: { jx: { from: 0.5, to: 0, unit: 'em' } }, expose: ['jx'] });
  assert.deepEqual([inEm.params.jxFrom.unit, inEm.params.jxFrom.max], ['em', 4]);
  const jolt = K.arrive(Object.assign({ key: 'joltIn' }, words('揺れ入り', 'Jolt in'), m));
  const reg = REG.createRegistry(EX_DEFS.concat([jolt]));
  const { scene } = sampleScene(reg, { arrive: { v: 'joltIn', p: { dur: 0.5, each: 0.02, order: 'lead', ease: 'linear' }, from: 'auto' } });
  F.evaluate(scene, scene.times.a - 1);
  const i = scene.text.from, L = scene.table.live, B0 = scene.table.base;
  approx(L.x[i] - B0.x[i], 0.5 * scene.target.em[0], 1e-3, 'x in em');
  approx(L.jx[i] - B0.jx[i], 0.5, 1e-6, 'jx in du');
  approx(L.pixel[i] - B0.pixel[i], 6, 1e-6, 'pixel in du');
});

// §4.1.3: the slot seed never depends on params or on the pin source. Locking a line (from 'pin:cut', by 'lock'),
// pinning a value to what it already is, or moving a slider must not reshuffle the randomness a part was built with.
test('slot seeds: lock and pin sources and param edits keep per-glyph randoms, scatter order and build randomness', () => {
  const blow = { v: 'windBlow', p: { dur: 0.35, each: 0.02, order: 'scatter', ease: 'quadIn', dir: 'right', lift: 1 }, from: 'auto' };
  const exitOf = (dep) => {
    const { scene, plan } = sampleScene(exReg, { depart: dep, arrange: { v: 'centerAnchor', p: { offsetX: 0, offsetY: 0 }, from: 'auto' } });
    const b = scene.behaviours.find((x) => x.run === BH.runGlyphMotion && x.exit);
    return { scene, plan, rnd: Array.from(b.rnd), rank: Array.from(b.rank) };
  };
  const base = exitOf(blow);
  assert.ok(new Set(base.rank).size > 2 && base.rank.some((r, j) => r !== j), 'scatter really permutes');
  const locked = exitOf(Object.assign({}, blow, { from: 'pin:cut', by: 'lock' }));
  const repinned = exitOf(Object.assign({}, blow, { from: 'pin:line', by: 'user', pfrom: { lift: 'pin:work' } }));
  for (const other of [locked, repinned]) {
    assert.deepEqual(other.rnd, base.rnd);
    assert.deepEqual(other.rank, base.rank);
    assert.deepEqual(sceneHashes(other.scene, other.plan), sceneHashes(base.scene, base.plan), 'the same picture');
  }
  for (const p of [{ dur: 0.41 }, { lift: 1.4 }, { dir: 'left' }]) {
    const moved = exitOf(Object.assign({}, blow, { p: Object.assign({}, blow.p, p) }));
    assert.deepEqual(moved.rnd, base.rnd, JSON.stringify(p));
    assert.deepEqual(moved.rank, base.rank, JSON.stringify(p));
  }
  const sink = exitOf({ v: 'inkSink', p: { dur: 0.35, each: 0.02, order: 'scatter', ease: 'expoIn', yTo: 0.55, blurTo: 0.12 }, from: 'auto' });
  assert.notDeepEqual(sink.rnd, base.rnd, 'another part draws other randoms');

  const tide = { v: 'tideBands', p: { amount: 0.6, bands: 6, swell: 40, speed: 0.05, tilt: 2, toward: 'shiftA' }, from: 'auto' };
  const phases = (ground) => {
    const plan = JSON.parse(JSON.stringify(PLAN));
    plan.grounds[1].ground = ground;
    const scene = BUILD.buildGround(plan.grounds[1], plan, svcFor(plan, exReg));
    return Array.from(scene.stores.paint[0].data.phase);
  };
  const p0 = phases(tide);
  assert.deepEqual(phases(Object.assign({}, tide, { from: 'pin:work', by: 'user' })), p0);
  assert.deepEqual(phases(Object.assign({}, tide, { p: Object.assign({}, tide.p, { speed: 0.09 }) })), p0);
});

test('dwell arrival times follow the entrance as built (scatter order included)', () => {
  const { scene } = sampleScene(exReg, {
    arrive: { v: 'inkRise', p: { dur: 0.5, each: 0.06, order: 'scatter', ease: 'expoOut', yFrom: 0.55, blurFrom: 0.12 }, from: 'auto' },
    dwell: { v: 'waveRun', p: { amount: 0.5, speed: 1, height: 0.1 }, from: 'auto' },
  });
  const a = scene.behaviours.find((b) => b.run === BH.runGlyphMotion && !b.exit);
  const hold = scene.behaviours.find((b) => b.run === BH.runHold);
  assert.ok(Array.from(a.rank).some((r, j) => r !== j), 'scatter really permutes');
  for (let j = 0; j < a.rank.length; j++) approx(hold.arrived[j], a.t0 + a.delay[j] + a.dur, 1e-5, 'glyph ' + j);
});

test('element pins: nudge moves and scales the text about its centre, fill recolours, hide flags', () => {
  const plan = JSON.parse(JSON.stringify(PLAN));
  const cut = plan.cuts[2];
  const svc = svcFor(plan);
  cut.els = {};
  const plainScene = BUILD.buildCut(cut, plan, svc);
  cut.els = { text: { nudge: { dx: 30, dy: -20, rot: 0, s: 2 }, fill: '#123456' } };
  const nudged = BUILD.buildCut(cut, plan, svc);
  const centre = (sc) => { const f = sc.target; let x = 0, y = 0; for (let j = 0; j < f.wx.length; j++) { x += f.wx[j]; y += f.wy[j]; } return [x / f.wx.length, y / f.wx.length]; };
  const [x0, y0] = centre(plainScene), [x1, y1] = centre(nudged);
  approx([x1 - x0, y1 - y0], [30, -20], 1, 'moved by (dx, dy) about the centre');
  const span = (sc) => sc.target.wx[sc.target.wx.length - 1] - sc.target.wx[0];
  approx(span(nudged) / span(plainScene), 2, 1e-3, 'scaled ×2');
  assert.ok(nudged.stores.glyph.every((g) => g.ink === '#123456'));
  cut.els = { text: { hide: true } };
  const hidden = BUILD.buildCut(cut, plan, svc);
  for (let i = hidden.text.from; i < hidden.text.to; i++) assert.ok(hidden.table.flags[i] & T.FLAG.hidden);
});

test('buildCut falls back to fallback parts (with a part-error warning) when a part throws, unless strict', () => {
  const broken = K.arrive({ key: 'brokenRise', label: { ja: 'x', en: 'x' }, blurb: { ja: 'x', en: 'x' }, make() { throw new Error('boom'); } });
  const reg = MV.use('core/registry').createRegistry([broken].concat(corpus.allStubParts()));
  const plan = JSON.parse(JSON.stringify(PLAN));
  plan.cuts[1].slots.arrive = { v: 'brokenRise', p: { dur: 0.5, each: 0.02, order: 'lead', ease: 'linear' }, from: 'pin:cut' };
  const svc = svcFor(plan, reg);
  assert.throws(() => BUILD.buildCut(plan.cuts[1], plan, svc), /boom/);
  const scene = BUILD.buildCut(plan.cuts[1], plan, Object.assign({}, svc, { strict: false }));
  assert.equal(scene.warnings[0].code, 'part-error');
  assert.ok(scene.text.to > scene.text.from);
  plan.cuts[1].slots.arrive = { v: 'goneAway', p: {}, from: 'pin:cut' };
  const unknown = BUILD.buildCut(plan.cuts[1], plan, svc);
  assert.ok(unknown.warnings.some((w) => w.code === 'part-error' && /unknown arrive/.test(w.detail)));
});

test('buildGround falls back to the fallback ground (part-error warning) when a ground or atmos throws, unless strict', () => {
  const brokenGround = K.ground(Object.assign({ key: 'brokenTide', build() { throw new Error('boom'); } }, words('壊れ', 'Broken')));
  const brokenAtmos = K.ornament(Object.assign({ key: 'brokenDust', scope: 'run', build() { throw new Error('dust'); } }, words('壊れ', 'Broken')));
  const reg = REG.createRegistry([brokenGround, brokenAtmos].concat(corpus.allStubParts()));
  const plan = JSON.parse(JSON.stringify(PLAN));
  const seg = plan.grounds[0];
  const svc = svcFor(plan, reg);
  for (const [slot, v, pattern] of [['ground', 'brokenTide', /boom/], ['atmos', 'brokenDust', /dust/]]) {
    const s2 = Object.assign({}, seg, { [slot]: { v, p: {}, from: 'pin:work', by: 'user' } });
    assert.throws(() => BUILD.buildGround(s2, plan, svc), pattern, 'strict rethrows');
    const scene = BUILD.buildGround(s2, plan, Object.assign({}, svc, { strict: false }));
    assert.equal(scene.warnings[0].code, 'part-error');
    assert.equal(scene.warnings[0].cut, seg.cuts[0]);
    assert.match(scene.warnings[0].detail, pattern);
    assert.equal(scene.kind, 'ground');
    assert.ok(scene.stores.paint.length > 0, 'the fallback ground is drawn');
    F.evaluate(scene, 1);
  }
});

test('overfull text gives an overfull warning for the cut', () => {
  const tiny = K.arrange({ key: 'tinyBox', label: { ja: '小箱', en: 'Tiny box' }, blurb: { ja: '小さな箱', en: 'A tiny box' },
    build(env) {
      const run = env.sb.text({ size: 120, box: { x: 100, y: 100, w: 60, h: 30 }, maxLines: 1, fit: 'shrink' });
      return { runs: [run] };
    } });
  const reg = MV.use('core/registry').createRegistry([tiny].concat(corpus.allStubParts()));
  const plan = JSON.parse(JSON.stringify(PLAN));
  const cut = plan.cuts[1];
  cut.slots.arrange = { v: 'tinyBox', p: { offsetX: 0, offsetY: 0 }, from: 'pin:cut' };
  const scene = BUILD.buildCut(cut, plan, svcFor(plan, reg));
  assert.deepEqual(scene.warnings.filter((w) => w.code === 'overfull').map((w) => w.cut), [cut.key]);
  assert.ok(scene.runs[0].clip, 'the overfull run carries its clip box');
  assert.ok(scene.focus.w > 0, 'focus defaults to the text bounds');
});

// --- cache and recorder ------------------------------------------------------------------------------------------

test('scene cache: LRU by (fp, measurer key); prefetch builds what is missing, nearest first', () => {
  const cache = CACHE.createSceneCache({ max: 3 });
  const svc = svcFor(PLAN);
  const built = [];
  const build = (item, kind) => { built.push(item.key); return kind === 'cut' ? BUILD.buildCut(item, PLAN, svc) : BUILD.buildGround(item, PLAN, svc); };
  const got = cache.prefetch(PLAN, 4.5, 6.5, build);
  assert.ok(got.length > 0 && got.length <= 3);
  assert.equal(cache.size, got.length);
  const first = PLAN.cuts.find((c) => c.key === got.find((k) => k.includes('~')));
  const hit = cache.get(first.fp, 'fake');
  assert.ok(hit && hit.fp === first.fp);
  assert.deepEqual(cache.prefetch(PLAN, 4.5, 6.5, build), [], 'nothing left to build');
  assert.equal(cache.get(first.fp, 'canvas:1'), null, 'another measurer key misses');
  assert.equal(cache.prefetch(PLAN, 4.5, 6.5, build).length, got.length, 'a new measurer key rebuilds');
  for (const c of PLAN.cuts.slice(10, 14)) cache.put(BUILD.buildCut(c, PLAN, svc));
  assert.equal(cache.size, 3, 'bounded');
  cache.clear();
  assert.equal(cache.size, 0);
});

// §7.3: prefetch ±10 s around the playhead in idle time. When the window holds more items than the cache, the scenes
// of the window must not evict each other, or every idle pass rebuilds what the pass before evicted.
test('scene cache: an idle prefetch every frame builds each scene of a moving window once', () => {
  for (const [len, perFrame] of [[1, 1], [1.5, 1], [3, 1], [1, 3]]) {
    const n = Math.floor(60 / len);
    const cuts = Array.from({ length: n }, (_, i) => ({ key: 'c' + i, fp: 'c' + i, t0: i * len, a: i * len - 0.12, b: (i + 1) * len + 0.25 }));
    const grounds = Array.from({ length: 10 }, (_, i) => ({ key: 'g' + i, fp: 'g' + i, t0: i * 6, t1: i * 6 + 6 }));
    const plan = { cuts, grounds };
    const cache = CACHE.createSceneCache({ max: 16 });
    const seen = new Set();
    let builds = 0;
    const build = (item) => { builds++; seen.add(item.key); return { fp: item.fp, fontKey: 'fake' }; };
    for (let f = 0; f <= 60 * 30; f++) {
      const t = f / 30;
      cache.get('c' + Math.min(n - 1, Math.floor(t / len)), 'fake');       // the renderer uses the current cut
      for (let k = 0; k < perFrame; k++) cache.prefetch(plan, t - 10, t + 10, build);
    }
    assert.equal(builds, seen.size, len + ' s cuts, ' + perFrame + ' prefetches per frame: no scene is built twice');
    assert.ok(cache.size <= 16);
  }
});

test('recorder: rounded args, save/restore balance, alpha range, NaN count, subset only', () => {
  const rec = R.createRecorder();
  const { canvas, ctx } = rec.factory.create(100, 50, { alpha: false });
  assert.equal(canvas.width, 100);
  ctx.save(); ctx.globalAlpha = 0.25; ctx.fillRect(0.12345, 1, 2, 3); ctx.restore();
  assert.deepEqual(rec.ops()[2], [canvas.id, 'fillRect', 0.123, 1, 2, 3]);
  assert.equal(ctx.globalAlpha, 1, 'restore brings the state back');
  let st = rec.stats();
  assert.ok(st.balanced); assert.deepEqual(st.alphaRange, [0.25, 1]); assert.equal(st.nan, 0);
  ctx.globalAlpha = 1.5; ctx.moveTo(NaN, 0); ctx.restore();
  st = rec.stats();
  assert.equal(st.alphaBad, 1); assert.equal(st.nan, 1); assert.equal(st.underflow, 1); assert.equal(st.balanced, false);
  assert.equal(typeof ctx.getImageData, 'undefined');
  assert.equal(typeof ctx.measureText, 'undefined');
  const grad = ctx.createLinearGradient(0, 0, 1, 1);
  grad.addColorStop(0, '#FFFFFF');
  ctx.fillStyle = grad;
  assert.equal(rec.ops().pop()[2], grad.id);
  const h1 = rec.hash();
  assert.equal(rec.hash(), h1);
  rec.reset();
  assert.equal(rec.ops().length, 0);
  assert.equal(rec.stats().balanced, true);
});

test('recording fx: pooled surfaces, channel isolation, textAt budget', () => {
  const rec = R.createRecorder();
  const fx = R.createRecordingFx(rec, { w: 64, h: 36, plan: PLAN, allowTextAt: true });
  const src = R.surfaceOf(rec.factory, 64, 36, true);
  const r = fx.isolate(src, 'r');
  assert.equal(fx.outstanding(), 1);
  fx.give(r);
  assert.equal(fx.take(), r, 'surfaces are reused');
  assert.throws(() => fx.isolate(src, 'q'), /r g b/);
  fx.begin();
  fx.textAt(0.1); fx.textAt(0.2); fx.textAt(0.3);
  assert.throws(() => fx.textAt(0.4), /at most 3/);
  const strictFx = R.createRecordingFx(rec, { w: 8, h: 8 });
  assert.throws(() => strictFx.textAt(0), /textAt/);
  assert.equal(fx.tick(12, 1), 12);
  assert.equal(fx.impulse('shake', 37), 0.05);
});

// ---- final fixes (engine): kit and stagger ---------------------------------------------------------------------------

test('sweepX / sweepY break ties along the other axis: a vertical column sweeps glyph by glyph', () => {
  // four glyphs in one vertical column (same x), then two in a column to its left
  const xs = [100, 100, 100, 100, 40, 40], ys = [0, 50, 100, 150, 0, 50];
  const n = xs.length;
  const target = { from: 0, to: n, wx: Float32Array.from(xs), wy: Float32Array.from(ys), x: Float32Array.from(xs),
    y: Float32Array.from(ys), w: new Float32Array(n).fill(40), h: new Float32Array(n).fill(40),
    unitOf: { word: new Int16Array(n), line: Int16Array.from([0, 0, 0, 0, 1, 1]), run: new Int16Array(n) },
    focus: { x: 20, y: -20, w: 100, h: 190 }, emph: new Uint8Array(n) };
  const env = { seed: 1 };
  assert.deepEqual(Array.from(STG.ranksOf(env, target, 'sweepX', 'glyph').rank), [2, 3, 4, 5, 0, 1],
    'the left column first, each column top to bottom (was [1, 1, 1, 1, 0, 0])');
  assert.deepEqual(Array.from(STG.ranksOf(env, target, 'sweepY', 'glyph').rank), [1, 3, 4, 5, 0, 2], 'rows top to bottom, left to right');
  const same = Object.assign({}, target, { wx: Float32Array.from([10, 10, 30, 30, 50, 50]), wy: Float32Array.from([5, 5, 5, 5, 5, 5]) });
  assert.deepEqual(Array.from(STG.ranksOf(env, same, 'sweepX', 'glyph').rank), [0, 0, 1, 1, 2, 2], 'only equal positions share a rank');
});

test('kit: K.variant with its own make on a K.moves part, K.mirror with shared/params in the patch, K.color helpers', () => {
  const K = MV.use('parts/kit');
  const C = MV.use('core/color');
  const base = K.arrive({ key: 'kitBase', label: { ja: 'b', en: 'b' }, blurb: { ja: 'b', en: 'b' },
    ...K.moves({ unit: 'glyph', tracks: { y: [0.5, 0], alpha: [0, 1] }, expose: ['y'] }), shared: { dur: { auto: { value: 0.4 } } } });
  const wrapped = function wrappedMake(env, target, p) { return base.make(env, target, p); };
  const v = K.variant(base, { key: 'kitWrapped', make: wrapped });
  assert.equal(v.make, wrapped, 'the variant keeps the make it was given (was rebuilt from the base motion)');
  assert.equal(v.motion, undefined);
  assert.ok(v.params.yFrom, 'the exposed params stay for the new make');
  assert.equal(K.variant(base, { key: 'kitPlain' }).make === base.make, false, 'without a make the motion is rebuilt as before');
  // mirror with patch.shared: the mirrored dur and the reversed ease stay, the patch adds its field
  const out = K.mirror(base, { key: 'kitOut', label: { ja: 'o', en: 'o' }, blurb: { ja: 'o', en: 'o' },
    shared: { order: { auto: { value: 'tail' } } } });
  const plain = K.mirror(base, { key: 'kitOut2', label: { ja: 'o', en: 'o' }, blurb: { ja: 'o', en: 'o' } });
  assert.deepEqual(out.shared.dur, plain.shared.dur, 'dur carried over (was lost)');
  assert.deepEqual(out.shared.ease, plain.shared.ease, 'reversed ease auto kept (was lost)');
  assert.deepEqual(out.shared.order, { auto: { value: 'tail' } });
  const outP = K.mirror(base, { key: 'kitOut3', label: { ja: 'o', en: 'o' }, blurb: { ja: 'o', en: 'o' },
    params: { yTo: { auto: { value: -0.8 } } } });
  assert.equal(outP.params.yTo.auto.value, -0.8);
  assert.ok(outP.params.yTo.min <= -0.8 && outP.params.yTo.label, 'merged over the generated exit spec');
  // colour helpers for parts (only the kit is allowed there)
  assert.equal(K.color.contrast('#000000', '#FFFFFF'), C.contrast('#000000', '#FFFFFF'));
  assert.ok(Math.abs(K.color.distance('#000000', '#FFFFFF') - 1) < 1e-3, 'OKLab: black to white is 1');
  assert.equal(K.color.distance('#3E6E8C', '#3E6E8C'), 0);
  assert.ok(K.color.distance('#FF0000', '#FF1000') < 0.05);
  assert.ok(K.color.contrast(K.color.fitContrast('#777777', '#000000', 7), '#000000') >= 7);
});

// --- camerawork (DESIGN_2_1 §3.10, §4.4, §4.6) -----------------------------------------------------------------------

const FAC = MV.use('engine/facade');
const catalogReg = () => MV.use('parts/catalog').defaultRegistry();

// A sample plan with rig runs replaced (a new plan object, so the frame index is built for it).
function withRigs(plan, runs) {
  const out = Object.assign({}, plan, { v: 2, rigs: runs.map((r, i) => Object.assign({ key: 'k' + i, cuts: [], blend: null,
    curve: { v: 'linear', from: 'auto' }, rig: { v: 'none', p: { amp: 1 }, from: 'auto' } }, r)) });
  Object.defineProperty(out, 'env', { enumerable: false, value: plan.env });
  return out;
}

const rigRef = (v, amp) => ({ v, p: { amp: amp === undefined ? 1 : amp }, from: 'auto' });

test('rigAt is pure: the same pose for (plan, t) in any order, with or without out, and the plan untouched', () => {
  const base = FAC.samplePlan(catalogReg(), { kind: 'rig', key: 'climbRise' }, {});
  const plan = withRigs(base, [
    { t0: 0, t1: 1.2, rig: rigRef('driftSide') },
    { t0: 1.2, t1: 2.4, rig: rigRef('leanTilt', 1.5), curve: { v: 'softEnds', from: 'auto' }, blend: { t0: 1.1, t1: 1.5 } },
    { t0: 2.4, t1: base.duration, rig: rigRef('pullAway'), curve: { v: 'fadeBrake', from: 'auto' } },
  ]);
  const before = JSON.stringify(plan);
  const rng = RNG.stream('rig-purity');
  const times = Array.from({ length: 200 }, () => rng.range(-1, base.duration + 1));
  const seq = times.map((t) => Object.assign({}, F.rigAt(plan, t)));
  const order = rng.shuffle(times.map((_, i) => i));
  const out = { x: 9, y: 9, zoom: 9, roll: 9 };
  for (const i of order) {
    assert.deepEqual(Object.assign({}, F.rigAt(plan, times[i], out)), seq[i], 'rigAt(' + times[i] + ')');
    assert.deepEqual(Object.assign({}, F.rigAt(plan, times[i])), seq[i]);
  }
  assert.equal(JSON.stringify(plan), before, 'the plan is not changed');
  assert.deepEqual(F.rigAt(withRigs(base, []), 1), { x: 0, y: 0, zoom: 1, roll: 0 }, 'no rigs: the identity');
  assert.deepEqual(F.rigAt(Object.assign({}, base, { rigs: undefined }), 1), { x: 0, y: 0, zoom: 1, roll: 0 }, 'a v1 plan: the identity');
  // held before the first run and after the last
  assert.deepEqual(F.rigAt(plan, -1), F.rigAt(plan, 0));
  assert.deepEqual(F.rigAt(plan, base.duration + 1), F.rigAt(plan, base.duration));
});

test('rig blends: continuous through the blend window (which may start before the run); a hard seam jumps', () => {
  const base = FAC.samplePlan(catalogReg(), { kind: 'rig', key: 'climbRise' }, {});
  const runs = (blend) => withRigs(base, [
    { t0: 0, t1: 1.5, rig: rigRef('driftSide') },
    { t0: 1.5, t1: 3, rig: rigRef('climbRise'), curve: { v: 'softEnds', from: 'auto' }, blend },
  ]);
  const smooth = runs({ t0: 1.3, t1: 1.8 }), hard = runs(null);
  const step = 1 / 1000;
  let worst = { x: 0, y: 0, lz: 0 };
  let prev = F.rigAt(smooth, 1.2, {});
  for (let t = 1.2 + step; t <= 2; t += step) {
    const cur = F.rigAt(smooth, t, {});
    worst = { x: Math.max(worst.x, Math.abs(cur.x - prev.x)), y: Math.max(worst.y, Math.abs(cur.y - prev.y)),
      lz: Math.max(worst.lz, Math.abs(Math.log(cur.zoom / prev.zoom))) };
    prev = cur;
  }
  assert.ok(worst.x < 0.5 && worst.y < 0.5 && worst.lz < 5e-4, 'no step above 0.5 du or 0.05 % zoom per ms: ' + JSON.stringify(worst));
  // the window starts before run 2: at its start the pose is still run 1's, at its end run 2's
  approx(F.rigAt(smooth, 1.3).x, F.rigAt(hard, 1.3).x, 1e-9, 'window start = the old run');
  approx(F.rigAt(smooth, 1.8).y, F.rigAt(hard, 1.8).y, 1e-9, 'window end = the new run');
  const a = F.rigAt(hard, 1.5 - 1e-6, {}), b = F.rigAt(hard, 1.5, {});
  assert.ok(Math.abs(a.y - b.y) > 20 || Math.abs(a.x - b.x) > 20, 'a hard seam cuts: ' + JSON.stringify([a, b]));
});

test('cameraAt equals applying the cut camera, then the rig (roll 0; 1e-6)', () => {
  const reg = catalogReg();
  const base = FAC.samplePlan(reg, { kind: 'shot', key: 'pushWord' }, {});
  const plan = withRigs(base, [{ t0: 0, t1: base.duration, rig: rigRef('driftSide', 2) }]);
  const svc = { registry: reg, text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
  const scene = BUILD.buildCut(plan.cuts[0], plan, svc);
  assert.ok(scene.shot, 'the shot is resolved');
  const W = plan.design.w, Hh = plan.design.h, c = [W / 2, Hh / 2];
  // view(p) = Z · (p − c − X − shake) + c for roll 0 (the §4.19 view matrix), in doubles
  const view = (cam, p) => [cam.zoom * (p[0] - c[0] - cam.x - cam.shakeX) + c[0], cam.zoom * (p[1] - c[1] - cam.y - cam.shakeY) + c[1]];
  const points = [[0, 0], [W, 0], [W / 3, Hh], [W, Hh], [712.5, 403.25]];
  let checked = 0;
  for (let k = 0; k <= 40; k++) {
    const tl = scene.times.a + ((scene.times.b - scene.times.a) * k) / 40, t = plan.cuts[0].t0 + tl;
    F.evaluate(scene, tl);
    const cut = F.cutCamera(scene, {}), rig = F.rigAt(plan, t, {});
    assert.equal(cut.roll, 0); assert.equal(rig.roll, 0);
    const both = F.cameraAt(scene, plan, t, {});
    const inner = { x: cut.x, y: cut.y, zoom: cut.zoom, shakeX: cut.jx, shakeY: cut.jy };
    const outer = { x: rig.x, y: rig.y, zoom: rig.zoom, shakeX: 0, shakeY: 0 };
    for (const p of points) {
      const seq = view(outer, view(inner, p)), one = view(both, p);
      assert.ok(Math.abs(seq[0] - one[0]) <= 1e-6 * Math.max(1, Math.abs(seq[0])) &&
        Math.abs(seq[1] - one[1]) <= 1e-6 * Math.max(1, Math.abs(seq[1])), 'at ' + t + ': ' + seq + ' vs ' + one);
      checked++;
    }
    approx(both.fz, scene.shot.live.zoom * rig.zoom, 1e-12, 'fz = the framing zoom (shot · rig)');
  }
  assert.ok(checked > 100);
  // and the drawn view matrix is that product too (Float32 inside: 1e-3 du)
  const M = new Float64Array(6), A = new Float64Array(6), Bm = new Float64Array(6), AB = new Float64Array(6);
  F.evaluate(scene, 1);
  const t = plan.cuts[0].t0 + 1, cut = F.cutCamera(scene, {}), rig = F.rigAt(plan, t, {});
  F.viewMatrix(M, F.cameraAt(scene, plan, t, {}), 1, W, Hh);
  F.viewMatrix(A, { x: rig.x, y: rig.y, zoom: rig.zoom, roll: 0, shakeX: 0, shakeY: 0 }, 1, W, Hh);
  F.viewMatrix(Bm, { x: cut.x, y: cut.y, zoom: cut.zoom, roll: 0, shakeX: cut.jx, shakeY: cut.jy }, 1, W, Hh);
  MAT.mul(AB, A, Bm);
  for (let i = 0; i < 6; i++) approx(M[i], AB[i], 1e-3, 'view matrix [' + i + ']');
});

// The frames of a corpus project through the facade (the golden-frame setup), with the plan changed by `patch` (a copy).
// `prepare` may change the document first (corpus.withoutCamerawork).
function facadeFrames(name, patch, prepare = (doc) => doc) {
  const doc = prepare(corpus.projects().find((p) => p.name === name).doc);
  const rec = R.createRecorder();
  const engine = FAC.createEngine({ registry: catalogReg(), canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null });
  const { plan } = engine.setDoc(doc);
  const next = JSON.parse(JSON.stringify(plan));
  Object.defineProperty(next, 'env', { enumerable: false, value: plan.env });
  patch(next, engine.registry);
  engine.setPlan(next);
  const [w, h] = DOC.DESIGN_SIZE[doc.look.aspect];
  const k = 360 / Math.min(w, h);
  const made = rec.factory.create(Math.round(w * k), Math.round(h * k), { alpha: false });
  const surface = { canvas: made.canvas, ctx: made.ctx, w: Math.round(w * k), h: Math.round(h * k) };
  const out = GOLDEN_TIMES(next).map((time) => {
    const m = rec.mark();
    engine.renderFrame(surface, time, { quality: 'export', pick: false, scale: surface.w / next.design.w });
    return rec.hash(m);
  });
  engine.dispose();
  return out;
}

// The v2 op hashes are the frames of the project with the camerawork pinned off (frame_hashes_v2.json): with the
// automatic camerawork on, the frames differ from v2 by design (DESIGN_2_1 §7.5 step (b)), whatever the curves.
test('the default lens.curve, seam.curve, dwell.curve and flow give the v2 op hashes exactly; other curves change them', () => {
  const read = (file) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'golden', file), 'utf8')).frames.basic;
  const golden = read('frame_hashes_v2.json');
  // every shared curve at its default: linear, and a glide lens at its own v2 ease (its auto)
  const defaults = (plan, reg) => {
    for (const c of plan.cuts) {
      const own = reg.params('lens', c.slots.lens.v).find((x) => x.name === 'curve');
      c.slots.lens.p.curve = own && own.spec.auto && own.spec.auto.value !== undefined ? own.spec.auto.value : 'linear';
      c.slots.dwell.p.curve = 'linear';
      c.slots.arrive.p.flow = 'linear';
      c.slots.depart.p.flow = 'linear';
    }
    for (const s of plan.seams) s.slot.p.curve = 'linear';
  };
  assert.deepEqual(facadeFrames('basic', defaults, corpus.withoutCamerawork), golden, 'defaults: the v2 frames');
  assert.deepEqual(facadeFrames('basic', defaults), read('frame_hashes.json'), 'with the camerawork: the golden frames');
  const changed = (patch) => facadeFrames('basic', (plan, reg) => { defaults(plan, reg); patch(plan); }, corpus.withoutCamerawork)
    .filter((h, i) => h !== golden[i]).length;
  const n = {
    dwell: changed((plan) => { for (const c of plan.cuts) c.slots.dwell.p.curve = 'hushRushHush'; }),
    flow: changed((plan) => { for (const c of plan.cuts) { c.slots.arrive.p.flow = 'slowBloom'; c.slots.depart.p.flow = 'dashStop'; } }),
    seam: changed((plan) => { for (const s of plan.seams) s.slot.p.curve = 'snapSettle'; }),
    lens: changed((plan) => { for (const c of plan.cuts) c.slots.lens.p.curve = 'holdThenDash'; }),
  };
  for (const [what, count] of Object.entries(n)) assert.ok(count > 0, what + ': a non-linear curve changes frames (' + count + ')');
});
