/* 文字PVメーカー v2 — original work. Tests: photos and videos in the engine — sb.media, K.media, drawMedia, the recorder, mediaAt / mediaReady, export exactness, depth (DESIGN_2_1 §11.3.6–§11.3.7, §11.5, §11.9.3, §11.8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');
const FM = require('../helpers/fake_media.js');
const { approx, throwsCode } = require('../helpers/assert_plus.js');

// The kit and the engine are tested with the four test parts of tests/helpers/fake_media.js (testParts), one per `use`;
// the catalog's media parts (package G.3: photoPan upgraded, photoFrame, textFill, mediaLayer, §11.5.7) have their own
// section below, with their conformance, and the media golden (tests/golden/project_media.json) closes the file.

const MV = load();
const H = MV.use('core/hash');
const MEDIA = MV.use('core/media');
const REGM = MV.use('core/registry');
const DOC = MV.use('core/doc');
const K = MV.use('parts/kit');
const B = MV.use('engine/scene/builder');
const T = MV.use('engine/scene/table');
const BUILD = MV.use('engine/scene/build');
const SH = MV.use('engine/render/shapes');
const R = MV.use('engine/render/record');
const FAC = MV.use('engine/facade');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');

const TEST_PARTS = FM.testParts(K);
const REG = REGM.createRegistry(MV.use('parts/catalog').defs().concat(TEST_PARTS));
const ID = Object.fromEntries(FM.FIXTURES.map((a) => [a.name, a.id]));

function recorder() { return R.createRecorder(); }

// An engine over the test registry with a fake store; `plan` a sample plan of one part with its media param set.
function mediaEngine(o) {
  const rec = o.rec || recorder();
  const store = o.store || FM.createFakeMedia(MV, o.storeOpts);
  const engine = FAC.createEngine({ registry: REG, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: store,
    strict: true });
  return { rec, store, engine };
}

function partPlan(kind, key, asset, params, opts) {
  const srcName = kind === 'ground' ? 'image' : 'src';
  const plan = FAC.samplePlan(REG, { kind, key, params: Object.assign({ [srcName]: ID[asset] || asset || '' }, params || {}) },
    opts || {});
  plan.media = FM.planMedia(asset && ID[asset] ? [asset] : []);
  return plan;
}

function surface(rec, w, h) { return R.surfaceOf(rec.factory, w || 640, h || 360, false); }

// The media draws of the ops since mark: [{ tag, id, m, index, args, transform }].
function mediaOps(rec, mark) {
  const out = [];
  let tf = null;
  for (const op of rec.ops().slice(mark)) {
    if (op[1] === 'setTransform') tf = op.slice(2);
    if (op[1] !== 'drawImage' || typeof op[2] !== 'string' || !op[2].startsWith('media:')) continue;
    const m = /^media:(a[0-9a-f]{24})@([-0-9.e]+)#(\d+)(~b\d+)?$/.exec(op[2]);
    out.push({ tag: op[2], id: m[1], m: Number(m[2]), index: Number(m[3]), blur: !!m[4], args: op.slice(3), transform: tf, canvas: op[0] });
  }
  return out;
}

function render(e, rec, t, opts, s) {
  const mark = rec.mark();
  const stats = e.engine.renderFrame(s || surface(rec), t, Object.assign({ quality: 'export', scale: 640 / e.engine.plan.design.w }, opts));
  return { stats, ops: mediaOps(rec, mark), hash: rec.hash(mark) };
}

// --- sb.media -----------------------------------------------------------------------------------------------------

function builderWith(media) {
  const D = BUILD.designEnv({ w: 1920, h: 1080, short: 1080 });
  return B.createBuilder({ D, text: createTextService({ measurer: fakeMeasurer(), faces: null }), cutText: '', defaults: {}, media });
}

test('sb.media checks every field, stores the fit at build and refuses a timed node on a static layer', () => {
  const media = FM.planMedia(['png', 'mp4']);
  const T0 = MEDIA.timeSpec(media[ID.mp4], {}, 0);
  const ok = { layer: 'ground', src: ID.png, box: { x: 0, y: 0, w: 1920, h: 1080 }, fit: 'cover', crop: { zoom: 1.2, x: 0.3, y: 0.6 } };
  const b = builderWith(media);
  const i = b.sb.media(ok);
  const rec = b.stores.image[b.table.payload[i]];
  assert.equal(rec.media, true);
  assert.deepEqual(rec.rect, MEDIA.fitRect(media[ID.png], ok.box, 'cover', 1.2, 0.3, 0.6), 'FitRect at build');
  assert.equal(rec.cam, 1); assert.equal(rec.still, false); assert.equal(rec.comp, 'over'); assert.equal(rec.edge, 'plain');
  assert.equal(b.table.type[i], T.TYPE.image);
  assert.ok(b.table.flags[i] & T.FLAG.pickable, 'pickable');
  const bad = (patch) => throwsCode(() => builderWith(media).sb.media(Object.assign({}, ok, patch)), 'bad-media', JSON.stringify(patch));
  bad({ src: '' });
  bad({ src: 'a000000000000000000000000' });            // a valid id that is not in the plan
  bad({ box: { x: 0, y: 0, w: -1, h: 5 } });
  bad({ fit: 'stretch' });
  bad({ crop: { zoom: 0.5, x: 0.5, y: 0.5 } });
  bad({ crop: { zoom: 1, x: 1.5, y: 0.5 } });
  bad({ edge: 'wrap' });
  bad({ bleed: 1 });
  bad({ mask: { ops: [], pts: [] } });
  bad({ comp: 'lighter' });
  bad({ blur: -1 });
  bad({ veil: { ink: 'ground', a: 2 } });
  bad({ tint: { a: 0.5 } });
  bad({ time: { clock: 'wall' } });
  bad({ headroom: 0 });
  bad({ sceneOnly: 'yes' });
  bad({ cam: 3 });
  bad({ still: 1 });
  // a video on a static layer is refused whichever comes first
  const s1 = builderWith(media);
  s1.sb.layer('far', { cache: 'static' });
  throwsCode(() => s1.sb.media(Object.assign({}, ok, { layer: 'far', src: ID.mp4, time: T0 })), 'bad-media');
  const s2 = builderWith(media);
  s2.sb.media(Object.assign({}, ok, { layer: 'far', src: ID.mp4, time: T0 }));
  throwsCode(() => s2.sb.layer('far', { cache: 'static' }), 'bad-layer');
  // a still may sit on a static layer (the renderer draws that layer live)
  const s3 = builderWith(media);
  s3.sb.layer('far', { cache: 'static' });
  s3.sb.media(Object.assign({}, ok, { layer: 'far' }));
  // the scene's media list, in node order
  const s4 = builderWith(media);
  const n1 = s4.sb.media(ok), n2 = s4.sb.media(Object.assign({}, ok, { src: ID.mp4, time: T0 }));
  assert.deepEqual(s4.mediaList().map((x) => [x.node, x.id, x.time]), [[n1, ID.png, null], [n2, ID.mp4, T0]]);
});

// --- K.media --------------------------------------------------------------------------------------------------------

function kitEnv(media, cut) {
  const D = BUILD.designEnv({ w: 1920, h: 1080, short: 1080 });
  const b = builderWith(media);
  const env = { D, sb: b.sb, media, cut: cut ? { t0: 1, t1: 3 } : null,
    times: cut ? { a: -0.12, rest: 0.3, out: 2, b: 2.25 } : { a: 0, rest: 0, out: 8, b: 8 } };
  return { env, b };
}

function recOf(b, node) { return b.stores.image[b.table.payload[node]]; }

test('K.media: −1 without a source; the ground edge rules; frame, fill and layer uses; the time origin', () => {
  const media = FM.planMedia(['png', 'jpeg', 'mp4']);
  const p = (x) => Object.assign({ depth: 'anim', move: 'none' }, x);
  const { env } = kitEnv(media, false);
  assert.equal(K.media(env, { layer: 'ground', use: 'ground', src: '', p: p() }), -1);
  assert.equal(K.media(env, { layer: 'ground', use: 'ground', src: 'a000000000000000000000000', p: p() }), -1);
  const frame = { x: 0, y: 0, w: 1920, h: 1080 };
  // mirror (the default): fit to the frame, the bleed ring from flipped copies
  let k = kitEnv(media, false), n = K.media(k.env, { layer: 'ground', use: 'ground', src: ID.jpeg, p: p() });
  assert.deepEqual([recOf(k.b, n).edge, recOf(k.b, n).bleed, recOf(k.b, n).box], ['mirror', 0.15, frame]);
  // zoom: fit to the bleed rect (the frame × 1.3), plus the drift travel when the picture drifts
  k = kitEnv(media, false); n = K.media(k.env, { layer: 'ground', use: 'ground', src: ID.jpeg, p: p({ edge: 'zoom' }) });
  assert.deepEqual(recOf(k.b, n).box, { x: -288, y: -162, w: 2496, h: 1404 });
  k = kitEnv(media, false); n = K.media(k.env, { layer: 'ground', use: 'ground', src: ID.jpeg, p: p({ edge: 'zoom', move: 'auto', zoom: 0.1 }) });
  approx(recOf(k.b, n).box.x, -288 - 0.04 * 1080, 1e-9);
  k = kitEnv(media, false); n = K.media(k.env, { layer: 'ground', use: 'ground', src: ID.jpeg, p: p({ edge: 'plain' }) });
  assert.deepEqual([recOf(k.b, n).edge, recOf(k.b, n).bleed], ['plain', 0]);
  // fill: comp atop; layer: sceneOnly; frame: the box as given
  k = kitEnv(media, true); n = K.media(k.env, { layer: 'text', use: 'fill', src: ID.png, p: p(), box: frame });
  assert.equal(recOf(k.b, n).comp, 'atop');
  k = kitEnv(media, true); n = K.media(k.env, { layer: 'far', use: 'layer', src: ID.mp4, p: p() });
  assert.equal(recOf(k.b, n).sceneOnly, true);
  const box = { x: 100, y: 200, w: 300, h: 300 };
  k = kitEnv(media, true); n = K.media(k.env, { layer: 'mid', use: 'frame', src: ID.png, p: p(), box });
  assert.deepEqual(recOf(k.b, n).box, box);
  // the time: null for stills; origin 0 in a ground scene, times.a in a cut
  k = kitEnv(media, false); n = K.media(k.env, { layer: 'ground', use: 'ground', src: ID.mp4, p: p({ clipIn: 1.5, speed: 2 }) });
  assert.deepEqual(recOf(k.b, n).time, MEDIA.timeSpec(media[ID.mp4], { clipIn: 1.5, speed: 2 }, 0));
  k = kitEnv(media, true); n = K.media(k.env, { layer: 'mid', use: 'frame', src: ID.mp4, p: p(), box });
  assert.equal(recOf(k.b, n).time.origin, -0.12);
  assert.equal(recOf(k.b, n).time.clock, 'show');
  k = kitEnv(media, true); n = K.media(k.env, { layer: 'mid', use: 'frame', src: ID.png, p: p(), box });
  assert.equal(recOf(k.b, n).time, null);
});

test('K.media Ken Burns: push, pull, drift and auto (v2 photoPan: push + drift for stills, none for videos)', () => {
  const media = FM.planMedia(['jpeg', 'mp4']);
  const kb = (src, move, extra) => {
    const k = kitEnv(media, false);
    const n = K.media(k.env, { layer: 'ground', use: 'ground', src, p: Object.assign({ depth: 'anim', move, zoom: 0.1, pan: 90 }, extra) });
    return k.b.behaviours.find((b) => b.run === K.runKenBurns && b.from === n) || null;
  };
  assert.equal(kb(ID.mp4, 'auto'), null, 'auto: a video keeps still');
  assert.equal(kb(ID.jpeg, 'none'), null);
  const P = { px: new Float32Array(1), py: new Float32Array(1), sx: new Float32Array(1), sy: new Float32Array(1),
    x: new Float32Array(1), y: new Float32Array(1) };
  const run = (b, t) => {
    P.px[0] = 0; P.py[0] = 0; P.sx[0] = 1; P.sy[0] = 1; P.x[0] = 0; P.y[0] = 0;
    b.run(P, t, Object.assign({}, b, { from: 0 }));
    return { s: P.sx[0], x: P.x[0], y: P.y[0], px: P.px[0] };
  };
  const travel = 0.04 * 1080;
  const auto = kb(ID.jpeg, 'auto');
  // the pose columns are Float32: scales compare to 1e-7
  approx(run(auto, 0).s, 1, 1e-7); approx(run(auto, 8).s, 1.1, 1e-7);
  approx(run(auto, 8).y, travel, 1e-4, 'auto drifts along pan (90°: down)');
  assert.equal(run(auto, 4).px, 960, 'the pivot is the box centre');
  const push = kb(ID.jpeg, 'push'), pull = kb(ID.jpeg, 'pull'), drift = kb(ID.jpeg, 'drift');
  approx(run(push, 0).s, 1, 1e-7); approx(run(push, 8).s, 1.1, 1e-7); assert.equal(run(push, 8).y, 0, 'push has no drift');
  approx(run(pull, 0).s, 1.1, 1e-7); approx(run(pull, 8).s, 1, 1e-7);
  approx(run(drift, 0).s, 1.05, 1e-7); approx(run(drift, 8).s, 1.05, 1e-7);
  approx(run(drift, 8).y, travel, 1e-4);
});

test('K.mediaParams: the §11.5.6 table (ai: false), depth for ground, frame and layer (ai: true), edge for grounds', () => {
  const g = K.mediaParams({ src: 'image', use: 'ground', autos: { veil: { range: [0.3, 0.45] } } });
  assert.deepEqual(Object.keys(g), ['image', 'depth', 'fit', 'cropZoom', 'cropX', 'cropY', 'edge', 'move', 'zoom', 'pan', 'blur', 'veil',
    'veilInk', 'tint', 'tintInk', 'clipIn', 'clipOut', 'speed', 'loop', 'clock']);
  assert.deepEqual(g.veil.auto, { range: [0.3, 0.45] });
  for (const [name, spec] of Object.entries(g)) {
    assert.equal(spec.ai, name === 'depth', name + ' ai');
    assert.deepEqual(MV.use('core/schema').validateSpec(name, spec), [], name);
  }
  assert.deepEqual(g.depth.of, ['auto', 'anim', 'front', 'back', 'still']);
  assert.deepEqual(g.image, { type: 'media', accept: 'any', label: { ja: '写真・動画', en: 'Photo or video' }, auto: { value: '' }, ai: false });
  assert.ok(!('edge' in K.mediaParams({ use: 'frame' })) && 'depth' in K.mediaParams({ use: 'frame' }));
  assert.ok('depth' in K.mediaParams({ use: 'layer' }));
  assert.ok(!('depth' in K.mediaParams({ use: 'fill' })), 'inside the text has no depth');
  assert.deepEqual(Object.keys(K.mediaParams({ use: 'frame', only: ['fit', 'blur'] })), ['src', 'fit', 'blur']);
  assert.equal(K.mediaParams({ accept: 'video', use: 'frame' }).src.accept, 'video');
  assert.deepEqual(K.MEDIA.SHAPES, ['rect', 'round', 'circle', 'arch', 'free']);
  assert.deepEqual(K.MEDIA.PLACES, ['behind', 'side', 'corner', 'free']);
  assert.deepEqual(K.MEDIA.BLENDS, ['screen', 'multiply', 'overlay', 'normal']);
});

// --- drawing ----------------------------------------------------------------------------------------------------------

test('the recorder op hash covers media time: the source index equals sampleAt at 24, 30 and 60 fps (60 s of frames)', () => {
  for (const fps of [24, 30, 60]) {
    for (const asset of ['fps24', 'mp4', 'fps60', 'vfr']) {
      const e = mediaEngine({});
      const plan = partPlan('ground', 'mediaTestGround', asset, { clock: 'song', loop: 'loop', depth: 'anim', move: 'none' });
      plan.cuts = [];
      plan.duration = 60; plan.grounds = [Object.assign({}, plan.grounds[0], { t1: 60 })];
      plan.lines = [];
      e.engine.setPlan(plan);
      const pts = e.store.table(ID[asset]);
      const meta = plan.media[ID[asset]];
      const T0 = MEDIA.timeSpec(meta, { clock: 'song', loop: 'loop' }, 0);
      const s = surface(e.rec, 64, 36);
      let bad = 0, seen = 0;
      for (let i = 0; i < 60 * fps; i++) {
        const t = i / fps;
        const m = MEDIA.mapTime(T0, t);
        const ops = render(e, e.rec, t, { scale: 64 / plan.design.w }, s).ops;
        const want = FM.sampleAt(pts, m);
        if (ops.length !== 1 || ops[0].index !== want || Math.abs(ops[0].m - m) > 1e-6) bad++;
        seen++;
        if (i % 97 === 0) e.rec.reset();
      }
      assert.equal(bad, 0, asset + ' at ' + fps + ' fps: ' + bad + ' of ' + seen + ' frames show another source frame');
    }
  }
  // the source frame reaches the op hash: two times with the same frame hash equal only when the media time is equal
  const e = mediaEngine({});
  e.engine.setPlan(partPlan('ground', 'mediaTestGround', 'mp4', { clock: 'song', depth: 'anim', move: 'none' }));
  const s = surface(e.rec);
  render(e, e.rec, 0.5, {}, s);                                          // fills the layer caches
  const a = render(e, e.rec, 1.0, {}, s), b = render(e, e.rec, 1.0, {}, s), c = render(e, e.rec, 1.0 + 1 / 29.97, {}, s);
  assert.equal(a.hash, b.hash);
  assert.notEqual(a.hash, c.hash);
});

test('mirror edges: neighbours are drawn only when they show; rest shows one picture', () => {
  const e = mediaEngine({});
  const plan = partPlan('ground', 'mediaTestGround', 'jpeg', { depth: 'anim', move: 'none', edge: 'mirror' });
  e.engine.setPlan(plan);
  const still = render(e, e.rec, 1.3);
  assert.equal(still.ops.length, 1, 'camera at rest: the picture alone');
  // move the camera with a rig (x +5 %): the left neighbour comes into view
  const moved = Object.assign({}, plan, { v: 2, rigs: [{ blend: null, cuts: [], curve: { v: 'linear' }, key: 'k',
    rig: { v: { keys: [{ u: 0, x: 0.05, zoom: 1.1 }, { u: 1, x: 0.05, zoom: 1.1 }] }, p: { amp: 1 } }, t0: 0, t1: plan.duration }] });
  e.engine.setPlan(moved);
  const shifted = render(e, e.rec, 1.3);
  assert.ok(shifted.ops.length >= 2 && shifted.ops.length <= 3, 'one or two flipped neighbours: ' + shifted.ops.length);
  // a flipped copy has a negative scale on its transform
  assert.ok(shifted.ops.slice(1).every((o) => o.transform[0] < 0 || o.transform[3] < 0), 'neighbours are mirrored');
});

test('rotation 0 / 90 / 180 / 270: the source rect is turned back into coded pixels and drawn upright', () => {
  const fit = { sx: 100, sy: 50, sw: 400, sh: 300 }, meta = { w: 1000, h: 800 };
  const f = (rot) => ({ w: 1000, h: 800, rot });
  const r = (rot) => { const o = SH.codedRect(fit, meta, f(rot), {}); return [o.x, o.y, o.w, o.h]; };
  assert.deepEqual(r(0), [100, 50, 400, 300]);
  assert.deepEqual(r(90), [50, 1000 - 100 - 400, 300, 400]);
  assert.deepEqual(r(180), [1000 - 100 - 400, 800 - 50 - 300, 400, 300]);
  assert.deepEqual(r(270), [800 - 50 - 300, 100, 300, 400]);
  // a tier smaller than the asset scales the rect first
  const half = SH.codedRect(fit, meta, { w: 500, h: 400, rot: 0 }, {});
  assert.deepEqual([half.x, half.y, half.w, half.h], [50, 25, 200, 150]);
  // drawn: 90 and 270 swap the dest size inside a turned transform; the dest centre stays put
  for (const [asset, rot] of [['rot90', 90], ['rot180', 180], ['rot270', 270]]) {
    const e = mediaEngine({});
    e.engine.setPlan(partPlan('ground', 'mediaTestGround', asset, { depth: 'anim', move: 'none', edge: 'plain', fit: 'contain' }));
    const [op] = render(e, e.rec, 1.3).ops;
    const [, , sw, sh, dx, dy, dw, dh] = op.args;
    const turned = rot !== 180;
    const tf = op.transform;
    const angle = Math.round((Math.atan2(tf[1], tf[0]) * 180) / Math.PI);
    assert.equal((angle + 360) % 360, rot, asset + ' transform turns by rot');
    approx(dx, -dw / 2, 1e-3); approx(dy, -dh / 2, 1e-3);
    if (turned) assert.ok(Math.abs(sw / sh - dw / dh) < 0.01, asset + ': source and dest aspect agree in coded pixels');
  }
});

test("fit 'soft' draws the blurred cover copy first, then the contained picture", () => {
  const e = mediaEngine({});
  e.engine.setPlan(partPlan('ground', 'mediaTestGround', 'jpeg', { depth: 'anim', move: 'none', edge: 'plain', fit: 'soft' }));
  const ops = render(e, e.rec, 1.3).ops;
  assert.equal(ops.length, 2);
  assert.ok(ops[0].blur && !ops[1].blur, 'the blurred copy (a still blur from the store) comes first');
  const call = e.store.calls.filter((c) => c.id === ID.jpeg).slice(-2);
  assert.ok(call[0].blur > 0 && call[1].blur === 0);
  // the soft copy covers (its dest is the whole box); the picture is contained (4:3 in 16:9: narrower)
  assert.ok(ops[1].args[6] < ops[0].args[6] - 1, 'contained is narrower than the cover copy');
});

test('overlay footage (sceneOnly) is skipped for chroma, black and clear; the ground layer is off there too', () => {
  for (const backdrop of ['scene', 'chroma', 'black', 'clear']) {
    const e = mediaEngine({});
    e.engine.setPlan(partPlan('ornament', 'mediaTestLayer', 'mp4', { depth: 'anim' }, { backdrop }));
    const ops = render(e, e.rec, 1.3, { backdrop }).ops;
    assert.equal(ops.length, backdrop === 'scene' ? 1 : 0, backdrop);
    const g = mediaEngine({});
    g.engine.setPlan(partPlan('ground', 'mediaTestGround', 'jpeg', { depth: 'anim' }, { backdrop }));
    assert.equal(render(g, g.rec, 1.3, { backdrop }).ops.length, backdrop === 'scene' ? 1 : 0, 'ground ' + backdrop);
  }
});

test("renderFrame { layers: 'ground' } draws the backdrop and the ground layers only (the work texture, no accents)", () => {
  const e = mediaEngine({});
  const plan = partPlan('ground', 'mediaTestGround', 'jpeg', { depth: 'anim' });
  e.engine.setPlan(plan);
  const full = render(e, e.rec, 1.3);
  assert.ok(full.stats.drawn.glyphs > 0);
  const mark = e.rec.mark();
  const bg = e.engine.renderFrame(surface(e.rec), 1.3, { quality: 'export', scale: 640 / plan.design.w, layers: 'ground' });
  const ops = e.rec.ops().slice(mark);
  assert.equal(bg.drawn.glyphs, 0);
  assert.ok(!ops.some((op) => op[1] === 'fillText'), 'no text');
  assert.equal(mediaOps(e.rec, mark).length, 1, 'the ground picture');
  assert.equal(bg.media.drawn, 1);
});

test('mediaAt(t) lists exactly what the frame draws (sorted, deduplicated), with no behaviour run', () => {
  const e = mediaEngine({});
  const plan = partPlan('ornament', 'mediaTestFrame', 'mp4', { depth: 'anim', clock: 'show' });
  const g = partPlan('ground', 'mediaTestGround', 'vfr', { depth: 'anim', clock: 'song' });
  plan.grounds = g.grounds;
  plan.media = FM.planMedia(['mp4', 'vfr']);
  e.engine.setPlan(plan);
  for (const t of [0.05, 0.4, 1.1, 2.2, 3.0]) {
    const drawn = render(e, e.rec, t).ops.map((o) => ({ id: o.id, m: o.m }));
    const listed = e.engine.mediaAt(t).map((x) => ({ id: x.id, m: Math.round(x.m * 1e6) / 1e6 }));
    const sorted = drawn.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.m - b.m));
    assert.deepEqual(listed, sorted, 't = ' + t);
  }
  e.engine.setPlan(Object.assign({}, plan, { media: undefined }));
  assert.deepEqual(e.engine.mediaAt(1), [], 'no plan media: nothing to list');
});

test('mediaAt(t, { scale }): every medium carries the px and blur its draw asks the store for; mediaReady readies exactly those', async () => {
  const e = mediaEngine({});
  const plan = partPlan('ornament', 'mediaTestFrame', 'png', { depth: 'anim', blur: 4 });
  const g = partPlan('ground', 'mediaTestGround', 'jpeg', { depth: 'anim', fit: 'soft', move: 'none' });
  plan.grounds = g.grounds;
  plan.media = FM.planMedia(['png', 'jpeg']);
  e.engine.setPlan(plan);
  assert.ok(e.engine.mediaAt(1.2).every((x) => x.px === undefined && x.blur === undefined), 'no scale and no frame yet: no tier');
  const scale = 640 / plan.design.w;
  const listed = e.engine.mediaAt(1.2, { scale });
  assert.ok(listed.length === 3 && listed.every((x) => x.px > 0), 'the frame, the ground and its soft copy: ' + JSON.stringify(listed));
  e.store.calls.length = 0;
  render(e, e.rec, 1.2);
  const key = (x) => [x.id, x.px, x.blur].join('|');
  const asked = [...new Map(e.store.calls.map((c) => [key(c), { id: c.id, m: 0, px: c.px, blur: c.blur }])).values()]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.px - b.px || a.blur - b.blur));
  assert.deepEqual(listed, asked, 'what the draw asked the store for');
  assert.deepEqual(e.engine.mediaAt(1.2), listed, 'after a frame, its scale');
  const readied = [];
  const ready = e.store.ready;
  e.store.ready = (items, o) => { readied.push(items); return ready(items, o); };
  await e.engine.mediaReady(1.2, { scale: 2 * scale });
  assert.deepEqual(readied[0].map((x) => x.px), listed.map((x) => 2 * x.px), 'mediaReady at the export scale');
  // videos too (DESIGN_2_1 §11.4.6: the store bakes their blur from these values): the media time plus exactly the px and
  // blur of the draw's requests, the soft copy's included — bit for bit, so the store's keys match
  const v = mediaEngine({});
  const vp = partPlan('ground', 'mediaTestGround', 'mp4', { depth: 'back', clock: 'song', fit: 'soft', move: 'none' });
  v.engine.setPlan(vp);
  const vl = v.engine.mediaAt(1.2, { scale });
  assert.deepEqual(Object.keys(vl[0]), ['id', 'm', 'px', 'blur']);
  assert.ok(vl.length === 2 && vl.every((x) => x.blur > 0), 'the picture and its soft copy, both blurred at depth back: ' + JSON.stringify(vl));
  v.store.calls.length = 0;
  render(v, v.rec, 1.2);
  const vAsked = [...new Map(v.store.calls.map((c) => [key(c), { id: c.id, m: Math.round(c.m * 1e9) / 1e9, px: c.px, blur: c.blur }])).values()]
    .sort((a, b) => a.px - b.px || a.blur - b.blur);
  assert.deepEqual(vl.map((x) => ({ id: x.id, m: Math.round(x.m * 1e9) / 1e9, px: x.px, blur: x.blur })), vAsked, 'what the video draw asked for');
  const fresh = mediaEngine({});
  fresh.engine.setPlan(vp);
  assert.deepEqual(Object.keys(fresh.engine.mediaAt(1.2)[0]), ['id', 'm'], 'no scale and no frame yet: the media time only');
});

test('a blurred video comes baked from the store (MediaFrame.blur > 0) and is drawn straight; the per-frame blur runs only for an unbaked frame, counted', () => {
  const plan = partPlan('ground', 'mediaTestGround', 'mp4', { depth: 'back', clock: 'song', move: 'none', edge: 'plain', veil: 0 });
  const blurOps = (rec, mark) => rec.ops().slice(mark).filter((op) => op[1] === 'set:filter' && /blur\(/.test(String(op[2])));
  // baked: one drawImage of the baked copy (at 1/b: 1920 → 480 for 640 px at depth back), no filter, no isolated surface
  const e = mediaEngine({});
  e.engine.setPlan(plan);
  const mark = e.rec.mark();
  const r = render(e, e.rec, 1.3);
  assert.equal(r.stats.media.fallback, 0);
  assert.equal(r.ops.length, 1);
  assert.ok(r.ops[0].blur, 'the baked copy (its stand-in names the blur)');
  assert.equal(blurOps(e.rec, mark).length, 0, 'no per-frame blur');
  assert.equal(r.ops[0].canvas, 'c1', 'drawn straight onto the frame, no isolated surface: ' + r.ops[0].canvas);
  const f = e.store.calls.filter((c) => c.id === ID.mp4).pop();
  assert.ok(f.blur > 0, 'want.blur is asked for a video too');
  // unbaked (a store that hands out the plain frame): the isolated path blurs it per frame, and the fallback is counted
  const u = mediaEngine({ storeOpts: { bake: false } });
  u.engine.setPlan(plan);
  const um = u.rec.mark();
  const ur = render(u, u.rec, 1.3);
  assert.equal(ur.stats.media.fallback, 1);
  assert.ok(!ur.ops[0].blur);
  assert.ok(blurOps(u.rec, um).length >= 1, 'the per-frame blur of the isolated path');
  assert.notEqual(ur.ops[0].canvas, 'c1', 'drawn into a pooled surface');
  // a still with blur never counts as a fallback (the store blurs it), nor does an unblurred video
  const st = mediaEngine({ storeOpts: { bake: false } });
  st.engine.setPlan(partPlan('ground', 'mediaTestGround', 'jpeg', { depth: 'back', move: 'none' }));
  assert.equal(render(st, st.rec, 1.3).stats.media.fallback, 0);
  const nb = mediaEngine({ storeOpts: { bake: false } });
  nb.engine.setPlan(partPlan('ground', 'mediaTestGround', 'mp4', { depth: 'anim', clock: 'song' }));
  assert.equal(render(nb, nb.rec, 1.3).stats.media.fallback, 0);
});

test("export quality never draws a substitute: EngineError 'media-not-ready' / 'media-missing'; mediaReady first", async () => {
  const e = mediaEngine({ storeOpts: { exact: 'ready' } });
  const plan = partPlan('ground', 'mediaTestGround', 'mp4', { depth: 'anim', clock: 'song' });
  e.engine.setPlan(plan);
  throwsCode(() => e.engine.renderFrame(surface(e.rec), 2.0, { quality: 'export', scale: 1 / 3 }), 'media-not-ready');
  // the preview draws the nearest held frame, provisional
  const pv = e.engine.renderFrame(surface(e.rec), 2.0, { quality: 'preview', scale: 1 / 3 });
  assert.equal(pv.provisional, true);
  assert.equal(pv.media.waiting, 1);
  await e.engine.mediaReady(2.0);
  const ok = e.engine.renderFrame(surface(e.rec), 2.0, { quality: 'export', scale: 1 / 3 });
  assert.equal(ok.media.waiting, 0);
  assert.equal(ok.provisional, false);
  // missing bytes: export throws, the preview shows the checkerboard placeholder (provisional)
  const m = mediaEngine({ storeOpts: { missing: [ID.jpeg] } });
  m.engine.setPlan(partPlan('ground', 'mediaTestGround', 'jpeg', { depth: 'anim' }));
  throwsCode(() => m.engine.renderFrame(surface(m.rec), 1.0, { quality: 'export', scale: 1 / 3 }), 'media-missing');
  const mark = m.rec.mark();
  const ph = m.engine.renderFrame(surface(m.rec), 1.0, { quality: 'preview', scale: 1 / 3 });
  assert.ok(ph.provisional && ph.media.waiting === 1);
  assert.ok(m.rec.ops().slice(mark).some((op) => op[1] === 'clip'), 'the placeholder clips to the dest');
  await assert.rejects(m.engine.mediaReady(1.0), (err) => err.code === 'media-missing');
});

test('mediaReady(t) asks the store for the frames at t (ready) and every frame ahead (want); forks own their store', async () => {
  const e = mediaEngine({});
  const calls = [];
  const store = e.store;
  const spy = Object.assign(Object.create(null), store, {
    ready(list, o) { calls.push(['ready', list]); return store.ready(list, o); },
    want(list) { calls.push(['want', list]); },
  });
  const rec = recorder();
  const engine = FAC.createEngine({ registry: REG, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: spy, strict: true });
  engine.setPlan(partPlan('ground', 'mediaTestGround', 'mp4', { depth: 'anim', clock: 'song' }));
  await engine.mediaReady(1, { fps: 30 });
  assert.deepEqual(calls.map((c) => c[0]), ['want', 'ready']);
  assert.deepEqual(calls[1][1], engine.mediaAt(1));
  // ahead = 3 / fps: every output frame of it (a look-ahead naming only the last one lets the session close the frames
  // before it as they pass, to be decoded again from their key frame when they are asked for)
  assert.deepEqual(calls[0][1], [1, 2, 3].flatMap((k) => engine.mediaAt(1 + (3 / 30) * k / 3)), 'ahead = 3 / fps, every frame of it');
  calls.length = 0;
  await engine.mediaReady(1, { fps: 30, ahead: 0 });
  assert.deepEqual(calls.map((c) => c[0]), ['ready'], 'ahead 0: no look-ahead');
  // fork(): the store's own fork, disposed with the forked engine; fork({ assets }) uses the given one
  const forked = e.engine.fork();
  assert.equal(e.store.forks.length, 1);
  forked.dispose();
  assert.equal(e.store.forks[0].disposed, true);
  const given = FM.createFakeMedia(MV);
  const f2 = e.engine.fork({ assets: given });
  f2.dispose();
  assert.equal(given.disposed, false, 'a given store is not the fork\'s to dispose');
  // no store: resolved at once
  const bare = FAC.createEngine({ registry: REG, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null });
  await bare.mediaReady(0);
});

test("a ghost of fx.textAt (残像 over a text fill) draws the media frame of the frame's own time: only what mediaAt listed", async () => {
  const reg = MV.use('parts/catalog').defaultRegistry();
  const base = FM.goldenDoc(corpus.project('media').doc);         // 文字の中に: the WebM clip on line r5 (show clock)
  const doc = Object.assign({}, base, { pins: Object.assign({}, base.pins, {
    'line/r5:filter.count': { v: 1, by: 'user' }, 'line/r5:filter#0': { v: 'afterImage', by: 'user' } }) });
  const rec = recorder();
  const store = FM.createFakeMedia(MV);
  const engine = FAC.createEngine({ registry: reg, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: store });
  const { plan } = engine.setDoc(doc);
  const cut = plan.cuts.find((c) => c.slots['ornament#0'] && c.slots['ornament#0'].v === 'textFill'
    && c.slots['filter#0'] && c.slots['filter#0'].v === 'afterImage');
  assert.ok(cut, 'a cut with the text fill and 残像');
  await engine.prepare(cut.t0, cut.t1, { export: true });
  const [dw, dh] = DOC.DESIGN_SIZE[doc.look.aspect];
  const w = 640, h = Math.round((640 * dh) / dw), scale = w / plan.design.w;
  const made = rec.factory.create(w, h, { alpha: false });
  const s = { canvas: made.canvas, ctx: made.ctx, w, h };
  const webm = FM.fixture('webm').id;
  let ghosts = 0;
  for (let t = cut.t0 + 0.2; t < cut.t1; t += 1 / 15) {
    const listed = engine.mediaAt(t, { scale });
    store.calls.length = 0;
    engine.renderFrame(s, t, { quality: 'export', scale });
    const stray = store.calls.filter((x) => !listed.some((y) => y.id === x.id && y.m === x.m)).map((x) => [x.id.slice(0, 5), x.m]);
    assert.deepEqual(stray, [], 'every media frame drawn at t = ' + t.toFixed(3) + ' is one mediaAt listed');
    if (store.calls.filter((x) => x.id === webm).length > listed.filter((y) => y.id === webm).length) ghosts++;
  }
  assert.ok(ghosts > 0, 'the ghosts draw the text fill too (' + ghosts + ' frames)');
  engine.dispose();
});

test('thumbnails ask the store for posters only', () => {
  const e = mediaEngine({});
  const plan = partPlan('ground', 'mediaTestGround', 'mp4', { depth: 'anim' });
  e.engine.setPlan(plan);
  e.store.calls.length = 0;
  const rec = recorder();
  const engine = FAC.createEngine({ registry: REG, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: e.store, strict: true });
  engine.thumb({ kind: 'ground', key: 'mediaTestGround', params: { image: ID.mp4 } }, surface(rec, 320, 180), {});
  // the sample plan of a thumbnail has no plan.media (the UI passes posters of the part's own tiles), so nothing is asked
  assert.ok(e.store.calls.every((c) => c.thumb), 'every request from a thumbnail is a poster request');
  // with media in the plan (the lab's sample plans), a thumbnail-quality render asks for posters
  const r2 = R.createRecorder();
  const thumbs = R.surfaceOf(r2.factory, 320, 180, false);
  const e2 = mediaEngine({ rec: r2, store: e.store });
  e2.engine.setPlan(plan);
  e.store.calls.length = 0;
  e2.engine.renderFrame(thumbs, 1, { quality: 'export', scale: 320 / plan.design.w, thumb: true });
  assert.ok(e.store.calls.length > 0 && e.store.calls.every((c) => c.thumb && !c.exact));
});

test('frame N rendered directly equals frame N after frames 0..N−1 (the media draws, video and still)', () => {
  // The layer caches of a facade fill on first use, so whole-frame op hashes depend on what was drawn before; the
  // media draws (source frame, rects, transform) must not.
  const plan = partPlan('ground', 'mediaTestGround', 'mp4', { depth: 'anim', clock: 'song', move: 'none' });
  const fr = partPlan('ornament', 'mediaTestFrame', 'png', { depth: 'anim' });
  plan.cuts = fr.cuts;
  plan.media = FM.planMedia(['mp4', 'png']);
  const times = Array.from({ length: 30 }, (_, i) => i / 10);
  const draws = (r) => JSON.stringify(r.ops.map((o) => [o.tag, o.transform, o.args]));
  const seq = mediaEngine({});
  seq.engine.setPlan(plan);
  const s = surface(seq.rec);
  const got = times.map((t) => draws(render(seq, seq.rec, t, {}, s)));
  assert.ok(got.some((d) => d.includes(ID.png)) && got.every((d) => d.includes(ID.mp4)), 'both media are drawn');
  assert.ok(new Set(got).size > 20, 'the video advances');
  for (const n of [0, 7, 19, 29]) {
    const alone = mediaEngine({});
    alone.engine.setPlan(plan);
    assert.equal(draws(render(alone, alone.rec, times[n])), got[n], 'frame ' + n);
  }
});

test('conformance of the test media parts: no NaN, balanced save/restore, same op hash twice (× 7 aspects × 24 times)', () => {
  const parts = [['ground', 'mediaTestGround', 'jpeg'], ['ground', 'mediaTestGround', 'mp4'], ['ornament', 'mediaTestFrame', 'png'],
    ['ornament', 'mediaTestFill', 'webm'], ['ornament', 'mediaTestLayer', 'mp4']];
  for (const [kind, key, asset] of parts) {
    for (const aspect of DOC.ASPECTS) {
      for (const depth of ['auto', 'anim', 'front', 'back', 'still']) {
        const hashes = [];
        for (let run = 0; run < 2; run++) {
          const e = mediaEngine({});
          const plan = partPlan(kind, key, asset, { depth }, { aspect });
          e.engine.setPlan(plan);
          const [w, h] = plan.design.w >= plan.design.h ? [640, Math.round((640 * plan.design.h) / plan.design.w)]
            : [Math.round((640 * plan.design.w) / plan.design.h), 640];
          const s = surface(e.rec, w, h);
          const list = [];
          for (let k = 0; k < 24; k++) {
            const t = (plan.duration * (k + 0.5)) / 24;
            list.push(render(e, e.rec, t, { scale: w / plan.design.w }, s).hash);
          }
          const st = e.rec.stats();
          const where = kind + '/' + key + ' ' + asset + ' ' + aspect + ' ' + depth;
          assert.ok(st.balanced, where + ': save/restore balanced');
          assert.equal(st.nan, 0, where + ': NaN');
          assert.equal(st.alphaBad, 0, where + ': alpha');
          hashes.push(list);
        }
        assert.deepEqual(hashes[0], hashes[1], kind + '/' + key + ' ' + aspect + ' ' + depth + ': same op hashes twice');
      }
    }
  }
});

// --- the catalog's media parts (§11.5.7, package G.3): photoPan (upgraded), photoFrame, textFill, mediaLayer ---------

const SCH = MV.use('core/schema');
const BH = MV.use('engine/scene/behave');
const FR = MV.use('engine/scene/frame');
const CAT = MV.use('parts/catalog').defaultRegistry();
const DEG = Math.PI / 180;

// The nodes an element owns in a scene (in index order), and small readers of a node.
function nodesOf(scene, el) {
  const out = [];
  for (let i = 0; i < scene.table.n; i++) if (scene.owners[scene.table.owner[i]].el === el) out.push(i);
  return out;
}
const typeOf = (scene, i) => T.TYPE_NAMES[scene.table.type[i]];
const layerOf = (scene, i) => T.LAYERS[scene.table.layer[i]].name;
const imageOf = (scene, i) => scene.stores.image[scene.table.payload[i]];
const shapeOf = (scene, i) => scene.stores.shape[scene.table.payload[i]];

// One media part in the sample cut, built: its scene (the cut; the segment for grounds and atmospheres).
function partScene(kind, key, asset, params, opts) {
  const e = mediaEngine({});
  const plan = partPlan(kind, key, asset, params, opts);
  e.engine.setPlan(plan);
  render(e, e.rec, (plan.cuts[0].a + plan.cuts[0].b) / 2);
  const inGround = kind === 'ground' || REG.get(kind, key).scope === 'run';
  return { e, plan, scene: e.engine.scene(inGround ? 'ground' : 'cut', 0) };
}

// A part built straight into a builder with chosen cut times (the sample cut enters at once) and text hints: { b, env,
// p, behaviours (sorted) }. params over the part's autos as the sample plan resolves them.
function directBuild(key, asset, params, times, hints) {
  const media = FM.planMedia(asset ? [asset] : []);
  const { env, b } = kitEnv(media, true);
  const p = FAC.samplePlan(REG, { kind: 'ornament', key, params: Object.assign({ src: ID[asset] || '' }, params) }, {}).cuts[0].slots['ornament#0'].p;
  const focus = { x: 760, y: 470, w: 400, h: 140 };
  Object.assign(env, { times, owner: 'ornament#0', hints: hints || { focus, free: b.sb.freeAround(focus) } });
  b.setContext({ owner: 'ornament#0', rng: null });
  REG.get('ornament', key).build(env, p);
  return { b, env, p, behaviours: b.seal() };
}

// The live world pose of a direct build at local time tl.
function poseAt(d, tl) {
  T.resetLive(d.b.table);
  BH.runBehaviours(d.b.table.live, d.behaviours, tl);
  T.solve(d.b.table);
  return d.b.table;
}

test('photoPan (upgraded in place): 写真・動画, an image param of type media, v2\'s zoom, pan and veil kept; the base paint and one media node', () => {
  const def = CAT.get('ground', 'photoPan');
  assert.deepEqual([def.key, def.label, def.blurb, def.pool, def.tags, def.needs], ['photoPan', { ja: '写真・動画', en: 'Photo or video' },
    { ja: '写真や動画を背景にする（選んだときだけ）', en: 'Your photo or video as the background (only when chosen)' }, false, ['soft'],
    ['media']]);
  assert.deepEqual(Object.keys(def.params), Object.keys(K.mediaParams({ src: 'image', use: 'ground' })), 'the §11.5.6 params for grounds');
  assert.deepEqual(def.params.image, { type: 'media', accept: 'any', label: { ja: '写真・動画', en: 'Photo or video' }, auto: { value: '' },
    ai: false });
  // v2's three params keep their names and ranges (pins are forever); only the veil's auto differs from other media parts
  const v2 = { zoom: [0, 0.4, 0.01, 'x', { range: [0.06, 0.14] }], pan: [-180, 180, 1, 'deg', { range: [-180, 180] }],
    veil: [0, 0.9, 0.01, undefined, { range: [0.3, 0.45] }] };
  for (const [name, [min, max, step, unit, auto]] of Object.entries(v2)) {
    const s = def.params[name];
    assert.deepEqual([s.type, s.min, s.max, s.step, s.unit, s.auto], ['num', min, max, step, unit, auto], name);
  }
  // the base paint, then K.media with use 'ground': mirror edges, the frame as its box, the veil in the node (v2's strength)
  const { scene } = partScene('ground', 'photoPan', 'jpeg', { depth: 'anim', veil: 0.4, amount: 0.5, move: 'none' });
  const own = nodesOf(scene, 'ground');
  assert.deepEqual(own.map((i) => typeOf(scene, i)), ['paint', 'image']);
  const r = imageOf(scene, own[1]);
  assert.deepEqual([layerOf(scene, own[1]), r.media, r.src, r.edge, r.bleed, r.cam, r.box], ['ground', true, ID.jpeg, 'mirror', 0.15, 1,
    { x: 0, y: 0, w: 1920, h: 1080 }]);
  approx(r.veil.a, 0.4 * (0.6 + 0.4 * 0.5), 1e-9, 'the veil strength of v2: veil · (0.6 + 0.4 · amount)');
  assert.equal(r.veil.ink, 'ground');
  // the depth and the params reach the node through K.media: pushed back adds the depth cue to the veil
  const back = partScene('ground', 'photoPan', 'mp4', { depth: 'back', veil: 0.4, amount: 0.5, clock: 'song', edge: 'zoom' }).scene;
  const rb = imageOf(back, nodesOf(back, 'ground')[1]);
  assert.deepEqual([rb.cam, rb.edge, rb.time.clock, rb.blur], [0.5, 'zoom', 'song', 3]);
  approx(rb.veil.a, 0.4 * 0.8 + 0.15, 1e-9);
  // no picture (none chosen, or an id the plan does not hold): the base paint only, as v2 drew without an image
  for (const asset of ['', 'a000000000000000000000000']) {
    const none = partScene('ground', 'photoPan', asset, {}).scene;
    assert.deepEqual(nodesOf(none, 'ground').map((i) => typeOf(none, i)), ['paint'], JSON.stringify(asset));
  }
});

test('photoFrame: the picture in a group, its stepped shadow below and its border above, all on the layer of its depth', () => {
  for (const depth of ['auto', 'anim', 'front', 'back', 'still']) {
    const { scene } = partScene('ornament', 'photoFrame', 'jpeg', { depth, place: 'side', shape: 'round', tilt: 3, border: 10,
      borderInk: 'accent', shadow: 0.4 });
    const own = nodesOf(scene, 'ornament#0');
    assert.deepEqual(own.map((i) => typeOf(scene, i)), ['group', 'shape', 'shape', 'shape', 'shape', 'image', 'shape'], depth);
    const layer = { auto: 'mid', anim: 'mid', still: 'mid', front: 'near', back: 'far' }[depth];
    assert.deepEqual([...new Set(own.slice(1).map((i) => layerOf(scene, i)))], [layer], depth + ': picture, shadow and border share a layer');
    assert.ok(own.slice(1).every((i) => scene.table.parent[i] === own[0]), 'one group holds the frame');
    approx(scene.table.base.rot[own[0]], 3 * DEG, 1e-6, 'the tilt');
    const rec = imageOf(scene, own[5]);
    assert.ok(rec.mask && rec.fit === 'cover', 'the round mask clips the picture');
    const border = shapeOf(scene, own[6]);
    assert.deepEqual([border.stroke, border.width, border.fill], ['accent', 10, null]);
    assert.equal(border.path, rec.mask, 'the border strokes the mask');
    const steps = own.slice(1, 5).map((i) => shapeOf(scene, i));
    assert.ok(steps.every((s) => s.fill === '#000000' && s.stroke === null), 'the shadow: fills, no filter');
    for (const i of own.slice(1, 5)) approx(scene.table.base.alpha[i], 0.08, 1e-6);
    const step = 0.015 * 1080 * 0.4;
    steps.forEach((s, k) => {
      approx(s.bounds[0] - border.bounds[0], (k + 1) * step, 1e-3, 'shadow step ' + k + ' x');
      approx(s.bounds[1] - border.bounds[1], (k + 1) * step, 1e-3, 'shadow step ' + k + ' y');
    });
  }
  // border 0 and shadow 0 leave them out; a cut-out (shape free) shows the picture's own alpha with neither
  const plain = partScene('ornament', 'photoFrame', 'png', { border: 0, shadow: 0 }).scene;
  assert.deepEqual(nodesOf(plain, 'ornament#0').map((i) => typeOf(plain, i)), ['group', 'image']);
  const cut = partScene('ornament', 'photoFrame', 'png', { shape: 'free', border: 20, shadow: 1 }).scene;
  const cutOwn = nodesOf(cut, 'ornament#0');
  assert.deepEqual(cutOwn.map((i) => typeOf(cut, i)), ['group', 'image']);
  assert.equal(imageOf(cut, cutOwn[1]).mask, null);
  // no picture: nothing at all
  for (const asset of ['', 'a000000000000000000000000']) {
    const none = partScene('ornament', 'photoFrame', asset, {}).scene;
    assert.deepEqual(nodesOf(none, 'ornament#0'), [], JSON.stringify(asset));
  }
});

test('photoFrame: sizes and shapes (a circle is square, an arch upright, the others take the picture\'s aspect)', () => {
  const box = (asset, shape, size) => {
    const { scene } = partScene('ornament', 'photoFrame', asset, { shape, size, place: 'free' });
    return imageOf(scene, nodesOf(scene, 'ornament#0').find((i) => typeOf(scene, i) === 'image')).box;
  };
  const short = 1080;
  let b = box('mp4', 'rect', 0.5);                                            // 16:9
  assert.deepEqual([b.w, b.h], [0.5 * short, (0.5 * short * 9) / 16]);
  approx(b.x, -b.w / 2, 1e-9, 'centred on the group');
  b = box('rot90', 'round', 0.5);                                             // 9:16 upright
  assert.deepEqual([b.w, b.h], [(0.5 * short * 9) / 16, 0.5 * short]);
  b = box('mp4', 'circle', 0.4);
  assert.deepEqual([b.w, b.h], [0.4 * short, 0.4 * short]);
  b = box('mp4', 'arch', 0.4);
  approx(b.w / b.h, 0.85, 1e-9, 'an arch is never wider than 0.85 of its height');
  b = box('jpeg', 'free', 1);                                                 // 4:3, the long side = size × short
  assert.deepEqual([b.w, b.h], [short, (short * 3) / 4]);
});

test('photoFrame: placements — behind the text (far), beside it in a free band, the corner of the safe area, the middle (free)', () => {
  const D = BUILD.designEnv({ w: 1920, h: 1080, short: 1080 });
  const at = (place, extra) => {
    const { scene } = partScene('ornament', 'photoFrame', 'jpeg', Object.assign({ place, tilt: 0, size: 0.3, depth: 'anim' }, extra));
    const own = nodesOf(scene, 'ornament#0');
    const g = own[0], rec = imageOf(scene, own.find((i) => typeOf(scene, i) === 'image'));
    const x = scene.table.base.x[g], y = scene.table.base.y[g];
    return { scene, layer: layerOf(scene, own[1]), x, y, box: { x: x + rec.box.x, y: y + rec.box.y, w: rec.box.w, h: rec.box.h } };
  };
  const inside = (a, b) => a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.y + a.h <= b.y + b.h + 1e-6;
  const meets = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const behind = at('behind');
  const f = behind.scene.focus;
  approx(behind.x, f.x + f.w / 2, 1e-3); approx(behind.y, f.y + f.h / 2, 1e-3);
  assert.equal(behind.layer, 'far');
  const side = at('side');
  const bands = builderWith({}).sb.freeAround(side.scene.focus);
  assert.ok(bands.some((band) => inside(side.box, band)), 'inside a free band: ' + JSON.stringify(side.box));
  assert.ok(!meets(side.box, side.scene.focus), 'off the text block');
  assert.equal(side.layer, 'mid');
  const corner = at('corner');
  approx(corner.box.x + corner.box.w, D.w - D.safe.r - 0.03 * D.short, 1e-3);
  approx(corner.box.y + corner.box.h, D.h - D.safe.b - 0.03 * D.short, 1e-3);
  const free = at('free');
  assert.deepEqual([free.x, free.y, free.layer], [D.cx, D.cy, 'mid']);
  // in front of the text a frame goes to the near layer wherever it is placed
  assert.equal(at('behind', { depth: 'front' }).layer, 'near');
  // a big frame is scaled into its band
  const big = at('side', { size: 1 });
  assert.ok(bands.some((band) => inside(big.box, band)) && big.box.w < 1080, JSON.stringify(big.box));
  // with no band that takes it, the corner, scaled into the lower right quarter of the safe area
  const times = { a: 0, rest: 0.4, out: 2, b: 2.4 };
  const focus = { x: 200, y: 150, w: 1520, h: 780 };
  const d = directBuild('photoFrame', 'jpeg', { place: 'side', size: 1, tilt: 0, depth: 'anim' }, times, { focus, free: [{ x: 100, y: 60, w: 1720, h: 90 }] });
  const t = d.b.table, rec = d.b.stores.image[t.payload[t.n - 2]];
  const x0 = t.base.x[0] + rec.box.x, y0 = t.base.y[0] + rec.box.y;
  assert.ok(x0 >= (D.safe.l + D.w - D.safe.r) / 2 - 1e-3 && y0 >= (D.safe.t + D.h - D.safe.b) / 2 - 1e-3, 'the lower right quarter');
  approx(x0 + rec.box.w, D.w - D.safe.r - 0.03 * D.short, 1e-3);
});

test('photoFrame: the border and the shadow keep the picture\'s pose (its Ken Burns and depth fade) at every time', () => {
  const times = { a: -0.12, rest: 0.4, out: 2, b: 2.4 };
  const d = directBuild('photoFrame', 'jpeg', { depth: 'anim', move: 'push', zoom: 0.2, pan: 30, appear: 'grow', shadow: 0.5, border: 12 }, times);
  const t = d.b.table;
  const kinds = Array.from({ length: t.n }, (_, i) => T.TYPE_NAMES[t.type[i]]);
  assert.deepEqual(kinds, ['group', 'shape', 'shape', 'shape', 'shape', 'image', 'shape']);
  const media = 5, companions = [1, 2, 3, 4, 6];
  assert.ok(d.behaviours.some((b) => b.run === K.runKenBurns && b.from === media), 'K.media moves the picture');
  const scale = [], alpha = [];
  for (let k = 0; k <= 48; k++) {
    const tl = times.a + ((times.b - times.a) * k) / 48;
    poseAt(d, tl);
    for (const i of companions) {
      for (let c = 0; c < 6; c++) approx(t.m[i * 6 + c], t.m[media * 6 + c], 1e-3, 'node ' + i + ' matrix at ' + tl.toFixed(3));
      approx(t.wa[i], t.wa[media] * t.base.alpha[i], 1e-6, 'node ' + i + ' alpha at ' + tl.toFixed(3));
    }
    scale.push(Math.hypot(t.m[media * 6], t.m[media * 6 + 1]));
    alpha.push(t.wa[media]);
  }
  assert.ok(scale[48] > scale[24] + 0.01, 'the picture pushes in: ' + scale[24] + ' → ' + scale[48]);
  assert.ok(alpha[0] < 0.05 && alpha[24] > 0.99 && alpha[48] < 0.05, 'the anim depth fade: ' + [alpha[0], alpha[24], alpha[48]].join(' '));
});

test('photoFrame: entrances over the text\'s — grow from 0.8, slide in from the outer side, a slower fade, none', () => {
  const times = { a: 0, rest: 0.5, out: 2, b: 2.4 };
  const group = (appear, place) => directBuild('photoFrame', 'jpeg', { appear, place: place || 'side', depth: 'still', move: 'none', tilt: 0 }, times);
  const g = group('grow');
  let t = poseAt(g, 0);
  approx(Math.hypot(t.m[0], t.m[1]), 0.8, 1e-6, 'grow starts at 0.8');
  t = poseAt(g, 0.5);
  approx(Math.hypot(t.m[0], t.m[1]), 1, 1e-6, 'full size when the text has entered');
  const s = group('slide');
  const x1 = poseAt(s, 0.5).m[4], y1 = s.b.table.m[5];
  const x0 = poseAt(s, 0).m[4], y0 = s.b.table.m[5];
  const off = Math.hypot(x0 - x1, y0 - y1);
  approx(off, 0.06 * 1080, 1e-3, 'slides 0.06 × short');
  const f = s.env.hints.focus, fc = [f.x + f.w / 2, f.y + f.h / 2];
  assert.ok(Math.hypot(x0 - fc[0], y0 - fc[1]) > Math.hypot(x1 - fc[0], y1 - fc[1]), 'from the side away from the text');
  const fade = group('fade');
  assert.ok(poseAt(fade, 0).wa[0] < 1e-6 && poseAt(fade, 0.5).wa[0] < 1 && poseAt(fade, 0.9).wa[0] > 0.999, 'fades over the entrance + 0.4 s');
  const none = group('none');
  assert.equal(none.behaviours.filter((b) => b.from === 0).length, 0, 'no entrance of its own (the follow-text envelope still applies)');
  // an instant text entrance still shows the frame arrive (0.3 s)
  const inst = directBuild('photoFrame', 'jpeg', { appear: 'grow', depth: 'still', move: 'none' }, { a: 0, rest: 0, out: 2, b: 2.4 });
  assert.ok(Math.hypot(poseAt(inst, 0.15).m[0], inst.b.table.m[1]) < 0.99);
  approx(Math.hypot(poseAt(inst, 0.3).m[0], inst.b.table.m[1]), 1, 1e-6);
});

test('textFill: the picture atop the glyphs in the isolated text layer; alpha 0.4 + 0.6 · amount; fitted to the frame or the text', () => {
  const { scene, e } = partScene('ornament', 'textFill', 'webm', { place: 'frame', amount: 0.5, move: 'none' });
  const own = nodesOf(scene, 'ornament#0');
  assert.equal(own.length, 1);
  const i = own[0], rec = imageOf(scene, i);
  assert.deepEqual([layerOf(scene, i), rec.comp, rec.box], ['text', 'atop', { x: 0, y: 0, w: 1920, h: 1080 }]);
  assert.equal(scene.layers[T.LAYER_INDEX.text].isolate, true, 'the text layer is isolated');
  const glyphs = [];
  for (let j = 0; j < scene.table.n; j++) if (typeOf(scene, j) === 'glyph') glyphs.push(j);
  assert.ok(glyphs.length > 0 && glyphs.every((j) => j < i), 'the picture comes after every glyph');
  approx(scene.table.base.alpha[i], 0.7, 1e-6);
  assert.equal(CAT.get('ornament', 'textFill').shared.amount.auto.value, 1, 'full strength by default');
  assert.ok(!('depth' in CAT.get('ornament', 'textFill').params), 'inside the text is its own place: no depth');
  // drawn: the glyphs, then the picture composited 'source-atop' onto the same (isolated) surface
  const mark = e.rec.mark();
  render(e, e.rec, 1.4);
  const ops = e.rec.ops().slice(mark);
  const k = ops.findIndex((op, n) => op[1] === 'drawImage' && n > 0 && ops[n - 1][1] === 'set:globalCompositeOperation' &&
    ops[n - 1][2] === 'source-atop');
  assert.ok(k > 0, 'a source-atop composite');
  const onto = ops[k][0];
  assert.ok(ops.slice(0, k).some((op) => op[0] === onto && op[1] === 'fillText'), 'onto the surface that holds the glyphs');
  // 'text': the text block enlarged by 10 %
  const t = partScene('ornament', 'textFill', 'jpeg', { place: 'text' }).scene;
  const f = t.focus, bx = imageOf(t, nodesOf(t, 'ornament#0')[0]).box;
  for (const [a, b] of [[bx.w, 1.1 * f.w], [bx.h, 1.1 * f.h], [bx.x + bx.w / 2, f.x + f.w / 2], [bx.y + bx.h / 2, f.y + f.h / 2]]) approx(a, b, 1e-3);
  // no picture: nothing, and the text layer is left as it is
  const none = partScene('ornament', 'textFill', '', {}).scene;
  assert.deepEqual(nodesOf(none, 'ornament#0'), []);
  assert.equal(none.layers[T.LAYER_INDEX.text].isolate, false);
});

test('mediaLayer: footage over the frame and its bleed; blend → comp, alpha 0.2 + 0.8 · amount, scene backdrop only; depth replaces over', () => {
  const def = CAT.get('ornament', 'mediaLayer');
  assert.deepEqual([def.scope, def.follow, def.pool, def.needs], ['run', 'own', false, ['media']]);
  assert.ok(!('over' in def.params) && def.params.depth.of.includes('front'), 'depth replaces the draft over param');
  const built = (params) => {
    const { scene } = partScene('ornament', 'mediaLayer', 'mp4', Object.assign({ move: 'none' }, params));
    const own = nodesOf(scene, 'atmos');
    assert.equal(own.length, 1);
    return { rec: imageOf(scene, own[0]), layer: layerOf(scene, own[0]), alpha: scene.table.base.alpha[own[0]] };
  };
  const anim = built({ depth: 'anim', blend: 'multiply', amount: 0.5 });
  assert.deepEqual([anim.layer, anim.rec.comp, anim.rec.sceneOnly, anim.rec.box], ['far', 'multiply', true,
    { x: -288, y: -162, w: 2496, h: 1404 }]);
  approx(anim.alpha, 0.6, 1e-6);
  assert.equal(built({ depth: 'anim', blend: 'normal' }).rec.comp, 'over');
  assert.equal(built({ depth: 'anim', blend: 'overlay' }).rec.comp, 'overlay');
  // in front of the text (the old over: text): the near layer, with the readability guard; pushed back (over: behind): far
  const front = built({ depth: 'front', blend: 'screen', amount: 1 });
  assert.deepEqual([front.layer, front.rec.comp], ['near', 'screen']);
  assert.ok(front.alpha <= 0.45 + 1e-6);
  // the guard caps the alpha but keeps a blend the part passes: 重ね方 = 通常 (a pin; the auto is スクリーン) stays normal
  const normal = built({ depth: 'front', blend: 'normal', amount: 1 });
  assert.deepEqual([normal.layer, normal.rec.comp], ['near', 'over'], 'a pinned 通常 is not turned into screen');
  assert.ok(normal.alpha <= 0.45 + 1e-6);
  assert.equal(built({ depth: 'back' }).layer, 'far');
  // no picture: nothing
  const none = partScene('ornament', 'mediaLayer', '', {}).scene;
  assert.deepEqual(nodesOf(none, 'atmos'), []);
});

test('mediaLayer in front of the text is drawn after the glyphs; behind it (back, anim), before them', () => {
  const order = (depth) => {
    const e = mediaEngine({});
    const plan = partPlan('ornament', 'mediaLayer', 'jpeg', { depth, blend: 'normal', move: 'none' });
    e.engine.setPlan(plan);
    const s = surface(e.rec);
    render(e, e.rec, 1.3, {}, s);
    const mark = e.rec.mark();
    render(e, e.rec, 1.4, {}, s);
    const ops = e.rec.ops().slice(mark);
    const media = ops.findIndex((op) => op[1] === 'drawImage' && String(op[2]).startsWith('media:'));
    const glyphs = ops.map((op, n) => (op[1] === 'fillText' ? n : -1)).filter((n) => n >= 0);
    assert.ok(media >= 0 && glyphs.length > 0, depth);
    return { before: glyphs.filter((n) => n < media).length, after: glyphs.filter((n) => n > media).length };
  };
  const front = order('front');
  assert.deepEqual([front.after, front.before > 0], [0, true], 'front: after every glyph');
  for (const depth of ['back', 'anim']) {
    const o = order(depth);
    assert.deepEqual([o.before, o.after > 0], [0, true], depth + ': before every glyph');
  }
});

test('mediaLayer is skipped for the chroma, black and clear backdrops; photoFrame and textFill are drawn there', () => {
  for (const backdrop of ['scene', 'chroma', 'black', 'clear']) {
    const drawn = (key, asset) => {
      const e = mediaEngine({});
      e.engine.setPlan(partPlan('ornament', key, asset, { move: 'none', appear: 'none' }, { backdrop }));
      return render(e, e.rec, 1.4, { backdrop }).stats.media.drawn;
    };
    assert.equal(drawn('mediaLayer', 'mp4'), backdrop === 'scene' ? 1 : 0, 'mediaLayer ' + backdrop);
    assert.equal(drawn('photoFrame', 'png'), 1, 'photoFrame ' + backdrop);
    assert.equal(drawn('textFill', 'jpeg'), 1, 'textFill ' + backdrop);
  }
});

test('conformance of photoPan, photoFrame, textFill and mediaLayer: no NaN, balanced save/restore, same op hash twice (× 7 aspects × 24 times)', () => {
  const DEPTHS = ['auto', 'anim', 'front', 'back', 'still'];
  const SHAPES = K.MEDIA.SHAPES, PLACES = K.MEDIA.PLACES, APPEARS = ['fade', 'grow', 'slide', 'none'];
  const cases = [];
  DOC.ASPECTS.forEach((aspect, a) => {
    DEPTHS.forEach((depth, d) => {
      const n = a + d;
      cases.push(['ground', 'photoPan', ['jpeg', 'mp4', 'gif', 'rot90'][n % 4], { depth, edge: K.MEDIA.EDGES[n % 3], fit: K.MEDIA.FITS[n % 3],
        move: K.MEDIA.MOVES[n % 5], clock: n % 2 ? 'song' : 'show', blur: n % 3 ? 0 : 6 }, aspect]);
      cases.push(['ornament', 'photoFrame', ['png', 'jpeg', 'mp4', 'webm', 'vfr'][n % 5], { depth, shape: SHAPES[n % 5], place: PLACES[(n + 1) % 4],
        appear: APPEARS[n % 4], tilt: (n % 7) - 3 }, aspect]);
      cases.push(['ornament', 'mediaLayer', ['mp4', 'jpeg', 'webm'][n % 3], { depth, blend: K.MEDIA.BLENDS[n % 4] }, aspect]);
    });
    for (const place of ['frame', 'text']) cases.push(['ornament', 'textFill', a % 2 ? 'webm' : 'jpeg', { place, clock: 'song' }, aspect]);
  });
  for (const [kind, key, asset, params, aspect] of cases) {
    const where = kind + '/' + key + ' ' + asset + ' ' + aspect + ' ' + JSON.stringify(params);
    const hashes = [];
    let drawn = 0;
    for (let run = 0; run < 2; run++) {
      const e = mediaEngine({});
      const plan = partPlan(kind, key, asset, params, { aspect });
      e.engine.setPlan(plan);
      const [w, h] = plan.design.w >= plan.design.h ? [640, Math.round((640 * plan.design.h) / plan.design.w)]
        : [Math.round((640 * plan.design.w) / plan.design.h), 640];
      const s = surface(e.rec, w, h);
      const list = [];
      for (let k = 0; k < 24; k++) {
        const r = render(e, e.rec, (plan.duration * (k + 0.5)) / 24, { scale: w / plan.design.w }, s);
        list.push(r.hash);
        drawn += r.ops.length;
      }
      const st = e.rec.stats();
      assert.ok(st.balanced, where + ': save/restore balanced');
      assert.equal(st.nan, 0, where + ': NaN');
      assert.equal(st.alphaBad, 0, where + ': alpha');
      assert.deepEqual(e.engine.warnings().filter((x) => x.code === 'part-error'), [], where);
      hashes.push(list);
    }
    assert.ok(drawn > 0, where + ': the medium is drawn');
    assert.deepEqual(hashes[0], hashes[1], where + ': same op hashes twice');
  }
});

test('おまかせ with the user\'s media: a pooled video becomes a derived photoPan that plays with the song and keeps still', () => {
  const MIX = MV.use('parts/mix');
  const media = { list: corpus.project('media').doc.media.list.map((a) => Object.assign({}, a, { pool: true })) };
  const reg = MIX.registryFor(CAT, { next: 1, list: [] }, media);
  const video = media.list.find((a) => a.kind === 'video'), still = media.list.find((a) => a.kind === 'image');
  const dv = reg.get('ground', MEDIA.keyOf(video.id)), ds = reg.get('ground', MEDIA.keyOf(still.id));
  assert.deepEqual([dv.params.image.auto, dv.params.clock.auto, dv.params.move.auto, dv.pool, dv.build], [{ value: video.id },
    { value: 'song' }, { value: 'none' }, true, CAT.get('ground', 'photoPan').build]);
  assert.deepEqual([ds.params.clock.auto, ds.params.move.auto], [{ value: 'show' }, { value: 'auto' }], 'a still keeps photoPan\'s autos');
  assert.deepEqual(SCH.validateSpec('image', dv.params.image), []);
});

// --- depth (§11.9.3) ------------------------------------------------------------------------------------------------

test('K.depthCam: the identity at 1, no camera at 0, factor · pose (zoom in log space), the ≤ 4 zoom clamp above 1', () => {
  const cam = { x: 40, y: -20, zoom: 1.6, roll: 0.05, shakeX: 3, shakeY: -2, fz: 1.3 };
  assert.deepEqual(K.depthCam(cam, 1), cam, 'f = 1 is the camera itself');
  const zero = K.depthCam(cam, 0);
  assert.deepEqual(zero, { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0, fz: 1 });
  assert.deepEqual(K.depthCam(cam, -1), zero, 'below 0 is 0');
  const half = K.depthCam(cam, 0.5);
  approx(half.x, 20, 1e-12); approx(half.zoom, Math.sqrt(1.6), 1e-12); approx(half.shakeY, -1, 1e-12); approx(half.roll, 0.025, 1e-12);
  const near = K.depthCam(cam, 1.15);
  approx(near.zoom, Math.pow(1.6, 1.15), 1e-12);
  const big = K.depthCam(Object.assign({}, cam, { zoom: 3.6 }), 1.15);
  approx(big.zoom, 4, 1e-12, 'clamped so the zoom stays ≤ 4');
  assert.ok(big.x < 1.15 * 40, 'the whole factor is lowered');
  assert.equal(K.depthCam, K.depthCam, 'exported');
});

test('depth: each value\'s layer, camera factor, seam flag, Ken Burns and look', () => {
  const media = FM.planMedia(['jpeg', 'mp4', 'png']);
  const built = (use, src, depth, extra, layer, cut) => {
    const k = kitEnv(media, cut !== false);
    const n = K.media(k.env, Object.assign({ layer: layer || (use === 'ground' ? 'ground' : 'mid'), use, src,
      p: Object.assign({ depth, move: 'auto', zoom: 0.14, blur: 0, veil: 0 }, extra) }, use === 'frame' ? { box: { x: 700, y: 300, w: 400, h: 400 } } : {}));
    const rec = recOf(k.b, n);
    return { rec, layer: T.LAYERS[k.b.table.layer[n]].name, kb: k.b.behaviours.find((b) => b.run === K.runKenBurns && b.from === n) || null,
      fade: k.b.behaviours.find((b) => b.from === n && b.run !== K.runKenBurns) || null, alpha: k.b.table.base.alpha[n] };
  };
  // anim: as placed, factor 1, Ken Burns as move says; frames and layers fade with the cut
  let x = built('ground', ID.jpeg, 'anim');
  assert.deepEqual([x.layer, x.rec.cam, x.rec.still, !!x.kb, x.kb.zoom], ['ground', 1, false, true, 0.14]);
  x = built('frame', ID.png, 'anim');
  assert.deepEqual([x.layer, x.rec.cam, !!x.fade], ['mid', 1, true]);
  x = built('layer', ID.mp4, 'anim', {}, 'near');
  assert.equal(x.layer, 'far', 'overlay footage at anim: far');
  // front: near, 1.15, the readability guard for large media (not for photo frames)
  x = built('ground', ID.jpeg, 'front');
  assert.deepEqual([x.layer, x.rec.cam, x.alpha <= 0.45, x.rec.comp], ['near', 1.15, true, 'screen']);
  x = built('layer', ID.mp4, 'front', {}, 'far');
  assert.ok(x.alpha <= 0.45 && x.rec.comp === 'screen');
  const pinned = (() => { const k = kitEnv(media, true); const n = K.media(k.env, { layer: 'far', use: 'layer', src: ID.mp4, comp: 'multiply',
    p: { depth: 'front' } }); return recOf(k.b, n); })();
  assert.equal(pinned.comp, 'multiply', 'a blend the part asks for is kept');
  x = built('frame', ID.png, 'front');
  assert.deepEqual([x.layer, x.alpha, x.rec.comp], ['near', 1, 'over'], 'a photo frame keeps its alpha');
  // back: far (grounds: ground), 0.5, Ken Burns zoom ≤ 0.06, blur + 3 and veil + 0.15 (clamped)
  x = built('ground', ID.jpeg, 'back');
  assert.deepEqual([x.layer, x.rec.cam, x.kb.zoom, x.rec.blur, x.rec.veil.a], ['ground', 0.5, 0.06, 3, 0.15]);
  x = built('frame', ID.png, 'back', { blur: 59, veil: 0.85 });
  assert.deepEqual([x.layer, x.rec.blur, x.rec.veil.a], ['far', 60, 0.9]);
  // still: as placed, no camera, no Ken Burns, outside the seam composite; a video still plays
  x = built('ground', ID.mp4, 'still', { move: 'push' });
  assert.deepEqual([x.layer, x.rec.cam, x.rec.still, x.kb], ['ground', 0, true, null]);
  assert.ok(x.rec.time, 'a video still plays');
  // auto without the planner: layer → front, frame → anim, a video ground → back, a still ground → anim
  assert.equal(built('layer', ID.mp4, 'auto', {}, 'far').rec.cam, 1.15);
  assert.equal(built('frame', ID.png, 'auto').rec.cam, 1);
  assert.equal(built('ground', ID.mp4, 'auto').rec.cam, 0.5);
  assert.equal(built('ground', ID.jpeg, 'auto').rec.cam, 1);
});

test('depth in the frame: the op hashes differ per value; the camera factor reaches the drawn transform', () => {
  const at = {};
  for (const depth of ['anim', 'front', 'back', 'still']) {
    const e = mediaEngine({});
    const plan = partPlan('ground', 'mediaTestGround', 'jpeg', { depth, move: 'none' });
    plan.v = 2;
    plan.rigs = [{ blend: null, cuts: [], curve: { v: 'linear' }, key: 'k', rig: { v: { keys: [{ u: 0, x: 0.04, zoom: 1.12 },
      { u: 1, x: 0.04, zoom: 1.12 }] }, p: { amp: 1 } }, t0: 0, t1: plan.duration }];
    e.engine.setPlan(plan);
    at[depth] = render(e, e.rec, 1.3);
  }
  assert.equal(new Set(Object.values(at).map((r) => r.hash)).size, 4, 'four different frames');
  const scale = (r) => Math.hypot(r.ops[0].transform[0], r.ops[0].transform[1]);
  // the ground layer (parallax 0.25) under the rig zoom 1.12: still sees none of it, back half of it, anim all
  const s0 = scale(at.still), sBack = scale(at.back), sAnim = scale(at.anim);
  approx(s0, 640 / 1920, 1e-3, 'still: no camera');
  assert.ok(sBack > s0 && sAnim > sBack, 'the factor orders the zoom: ' + [s0, sBack, sAnim].join(' '));
});

test('a still medium stays in place across a seam (text and world seams); others take part', () => {
  const seamPlan = (seamKey, depth) => {
    const plan = FAC.samplePlan(REG, { kind: 'seam', key: seamKey }, {});
    const g = partPlan('ground', 'mediaTestGround', 'jpeg', { depth, move: 'none' });
    plan.grounds = [Object.assign({}, plan.grounds[0], { ground: g.grounds[0].ground, fp: 'g:' + depth })];
    plan.media = g.media;
    return plan;
  };
  const worldKey = REG.keys('seam').find((k) => REG.get('seam', k).scope === 'world' && k !== REG.fallback('seam'));
  const textKey = REG.keys('seam').find((k) => REG.get('seam', k).scope === 'text' && k !== REG.fallback('seam'));
  for (const key of [worldKey, textKey]) {
    const draws = {};
    for (const depth of ['still', 'anim']) {
      const e = mediaEngine({});
      const plan = seamPlan(key, depth);
      e.engine.setPlan(plan);
      const out = surface(e.rec);
      const sm = plan.seams[0];
      draws[depth] = [0.1, 0.5, 0.9].map((u) => {
        const r = render(e, e.rec, sm.at - sm.dur / 2 + u * sm.dur, {}, out);
        return r.ops.map((o) => (o.canvas === out.canvas.id ? 'out' : 'buffer') + ':' + o.transform.join(',') + ':' + o.args.join(',')).join('|');
      });
    }
    assert.equal(new Set(draws.still).size, 1, key + ': the still picture is the same draw on the frame at every u');
    assert.ok(/^out:[^|]*$/.test(draws.still[0]), key + ': one draw, on the target, outside the composite: ' + draws.still[0]);
    // a world seam composites whole scenes: an animated ground goes through the buffers (a text seam leaves the ground
    // under the composite either way)
    if (key === worldKey) assert.ok(draws.anim.some((d) => d.includes('buffer:')), key + ': an animated ground takes part: ' + draws.anim.join(' / '));
  }
});

test('mediaAt costs ≤ 0.05 ms on project_long, with a video ground on every segment and a photo frame on every cut', () => {
  const { doc } = corpus.project('long');
  const e = mediaEngine({});
  const base = e.engine.setDoc(doc).plan;
  const ground = partPlan('ground', 'mediaTestGround', 'mp4', { clock: 'song' }).grounds[0].ground;
  const frame = partPlan('ornament', 'mediaTestFrame', 'png', {}).cuts[0].slots['ornament#0'];
  const plan = JSON.parse(JSON.stringify(base));
  Object.defineProperty(plan, 'env', { enumerable: false, value: base.env });
  plan.media = FM.planMedia(['mp4', 'png']);
  plan.grounds.forEach((g) => { g.ground = ground; g.fp += '|media'; });
  plan.cuts.forEach((c) => { c.slots['ornament.count'] = { v: 1, from: 'auto' }; c.slots['ornament#0'] = frame; c.fp += '|media'; });
  e.engine.setPlan(plan);
  const N = 3000;
  const times = Array.from({ length: N }, (_, i) => (plan.duration * ((i * 7919) % N)) / N);
  for (const t of times) e.engine.mediaAt(t, { scale: 0.5 });            // every scene built once (then remembered)
  let best = Infinity, items = 0;
  for (let run = 0; run < 3; run++) {
    const t0 = process.hrtime.bigint();
    for (const t of times) items += e.engine.mediaAt(t, { scale: 0.5 }).length;
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6 / N);
  }
  assert.ok(items > 3 * N, 'the ground and the frame are listed');
  assert.ok(best <= 0.05, 'mediaAt ' + best.toFixed(4) + ' ms per call (random times over the song)');
  assert.ok(e.engine.stats().scenes <= 16, 'the scene cache stays bounded: media lists are remembered, not scenes');
});

// With an asset store and no media, the media hooks change nothing: the frames are the golden frames (the automatic
// camerawork on), and with the camerawork pinned off they are the v2 frames.
test('frame hashes of the media-free fixtures are unchanged (tests/golden/frame_hashes.json, frame_hashes_v2.json)', async () => {
  const golden = (file) => JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'golden', file), 'utf8')).frames;
  const reg = MV.use('parts/catalog').defaultRegistry();
  const frames = async (doc) => {
    const rec = recorder();
    const engine = FAC.createEngine({ registry: reg, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null,
      assets: FM.createFakeMedia(MV) });
    const { plan } = engine.setDoc(doc);
    await engine.prepare(0, plan.duration, { export: true });
    const [dw, dh] = DOC.DESIGN_SIZE[doc.look.aspect];
    const k = 360 / Math.min(dw, dh);
    const [w, h] = [Math.round(dw * k), Math.round(dh * k)];
    const made = rec.factory.create(w, h, { alpha: false });
    const s = { canvas: made.canvas, ctx: made.ctx, w, h };
    const list = [];
    for (let i = 0; i < 40; i++) {
      const before = rec.ops().length;
      engine.renderFrame(s, (plan.duration * (i + 0.5)) / 40, { quality: 'export', pick: false, scale: w / plan.design.w });
      list.push(H.hashJSON(rec.ops().slice(before)));
    }
    engine.dispose();
    return list;
  };
  const withCamera = golden('frame_hashes.json'), v2 = golden('frame_hashes_v2.json');
  for (const { name, doc } of corpus.projects(['basic', 'vertical'])) {
    assert.deepEqual(await frames(doc), withCamera[name], name + ': with an asset store the frames are the golden frames');
    assert.deepEqual(await frames(corpus.withoutCamerawork(doc)), v2[name], name + ': and without the camerawork the v2 frames');
  }
});

// DESIGN_2_1 §7.5 step (c): the media golden, made by tests/update_golden.js. The v2.1 media fixture with a text fill
// (tests/helpers/fake_media.js goldenDoc) holds a still background, a photo frame, a text fill and a video background;
// rendered with the fake store, its op hashes include the media times.
test('the media golden: project_media plans and renders the golden frames with the fake store (tests/golden/project_media.json)', async () => {
  const golden = JSON.parse(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'golden', 'project_media.json'), 'utf8'));
  const reg = MV.use('parts/catalog').defaultRegistry();
  assert.deepEqual(golden.registry, { kind: 'catalog', version: reg.version }, 'made with this catalog');
  const doc = FM.goldenDoc(corpus.project('media').doc);
  const rec = recorder();
  const engine = FAC.createEngine({ registry: reg, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: FM.createFakeMedia(MV) });
  const { plan } = engine.setDoc(doc);
  assert.equal(plan.hash, golden.plan, 'the plan hash');
  // what the golden covers: a video background, a still one (a pooled asset), a photo frame and a text fill
  const grounds = plan.grounds.map((g) => [g.ground.v, g.ground.p.image || g.ground.p.src]);
  assert.ok(grounds.some(([k, id]) => k === 'photoPan' && id === ID.mp4), 'the video background');
  assert.ok(grounds.some(([k]) => k === MEDIA.keyOf(ID.jpeg)), 'the still background');
  const slots = plan.cuts.flatMap((c) => ['ornament#0', 'ornament#1'].map((s) => c.slots[s] && c.slots[s].v));
  assert.ok(slots.includes('photoFrame') && slots.includes('textFill'), 'a photo frame and a text fill');
  await engine.prepare(0, plan.duration, { export: true });
  const [dw, dh] = DOC.DESIGN_SIZE[doc.look.aspect];
  const k = 360 / Math.min(dw, dh);
  const [w, h] = [Math.round(dw * k), Math.round(dh * k)];
  const made = rec.factory.create(w, h, { alpha: false });
  const s = { canvas: made.canvas, ctx: made.ctx, w, h };
  const list = [];
  let media = 0;
  for (let i = 0; i < golden.frames.length; i++) {
    const before = rec.ops().length;
    const st = engine.renderFrame(s, (plan.duration * (i + 0.5)) / golden.frames.length, { quality: 'export', pick: false, scale: w / plan.design.w });
    media += st.media.drawn;
    list.push(H.hashJSON(rec.ops().slice(before)));
  }
  engine.dispose();
  assert.equal(golden.frames.length, 40);
  assert.ok(media >= 60, 'the media are drawn (' + media + ' media draws in 40 frames)');
  assert.deepEqual(list, golden.frames);
});
