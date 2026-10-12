/* 文字PVメーカー v2 — original work. Absolute-time paints, bounded placement and live rendering through cached scenes. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');
const corpus = require('../helpers/corpus');
const api = load();
const B = api.use('engine/scene/builder'), BUILD = api.use('engine/scene/build'), T = api.use('engine/scene/table');
const FAC = api.use('engine/facade'), REG = api.use('core/registry'), K = api.use('parts/kit'), R = api.use('engine/render/record');
const TEXT = api.use('engine/text/service'), FM = api.use('engine/text/fake_measure');
const FRAME = api.use('engine/scene/frame');
const L = (ja, en) => ({ ja, en });
function builder() {
  const D = BUILD.designEnv({ w: 1920, h: 1080, short: 1080 });
  return B.createBuilder({ D, text: TEXT.createTextService({ measurer: FM.fakeMeasurer() }), cutText: '', defaults: {} });
}

test('bounded paints inherit their parent and pose, and measure their actual local box instead of the entire frame', () => {
  const b = builder(), box = { x: 5, y: 6, w: 40, h: 20 };
  const parent = b.sb.group({ x: 50, y: 70, alpha: 0.8 });
  const node = b.sb.paint({ parent, x: 10, y: 20, sx: 2, sy: 0.5, alpha: 0.5, box, draw() {} });
  assert.equal(b.table.parent[node], parent);
  assert.deepEqual(b.sb.bounds(parent), { x: 70, y: 93, w: 80, h: 10 });
  assert.equal(b.table.base.alpha[node], 0.5);
  assert.ok(b.table.flags[node] & T.FLAG.pickable);
  box.w = 1000;
  assert.equal(b.stores.paint[0].box.w, 40, 'the builder owns a copy of its extent');
  b.nudge('text', { dx: 25, dy: -10, rot: 0, s: 1 });
  assert.deepEqual(b.sb.bounds(parent), { x: 95, y: 83, w: 80, h: 10 });
});

test('unbounded legacy paints keep full-frame bounds and remain unpickable; invalid bounded options are rejected', () => {
  const b = builder(), node = b.sb.paint({ draw() {} });
  assert.deepEqual(b.sb.bounds(node), { x: 0, y: 0, w: 1920, h: 1080 });
  assert.equal(b.table.flags[node] & T.FLAG.pickable, 0);
  for (const box of [null, {}, { x: 0, y: 0, w: -1, h: 2 }, { x: NaN, y: 0, w: 2, h: 2 }]) {
    assert.throws(() => b.sb.paint({ box, draw() {} }), { code: 'bad-paint' });
  }
});

function fixture({ isolated = false, ghost = false, camera = false, twin = false } = {}) {
  const seen = [];
  const probe = K.arrange({ key: 'clockProbe', label: L('時計', 'Clock'), blurb: L('時計', 'Clock'), cam: 'any',
    build(env) {
      const root = env.sb.group({ x: 50, y: 20 });
      env.sb.text({ parent: root, text: 'A', size: 60, box: { x: 600, y: 400, w: 120, h: 80 } });
      env.sb.paint({ parent: root, box: { x: 600, y: 300, w: 240, h: 80 }, animated: true,
        data: { builtAt: env.cut.t0 }, draw(g, tl, d, q) {
          seen.push({ tl, time: q.time, builtAt: d.builtAt });
          g.fillRect(600, 300, 40 + Math.floor(q.time), 80);
        } });
      if (isolated) env.sb.layer('text', { isolate: true, cache: 'static' });
      return { focus: env.sb.bounds(root), free: [] };
    } });
  const trail = K.filter({ key: 'clockTrail', label: L('残像', 'Ghost'), blurb: L('残像', 'Ghost'), stage: 'optic', cost: 1,
    passes: 1, alphaSafe: true, needs: ['textAt'], apply(fx, src) { const copy = fx.textAt(0.1); fx.give(copy); return src; } });
  const reg = REG.createRegistry([probe, trail, ...corpus.minimalFallbacks()]);
  const plan = FAC.samplePlan(reg, { kind: 'arrange', key: 'clockProbe' }, { text: 'A' });
  Object.assign(plan.cuts[0], { t0: 58, t1: 66, a: 58, b: 66, repT: 62 });
  plan.seams = []; plan.cuts[0].seamIn = -1; plan.cuts[0].seamOut = -1;
  plan.duration = 75;
  for (const g of plan.grounds) { g.t0 = 0; g.t1 = 75; }
  if (camera) {
    plan.cuts[0].slots['cam.shot'] = { v: 'settle', from: 'pin:cut', by: 'user' };
    plan.cuts[0].slots['cam.curve'] = { v: 'holdThenDash', from: 'pin:cut', by: 'user' };
  }
  if (ghost) {
    plan.cuts[0].slots['filter.count'] = { v: 1, from: 'pin:cut', by: 'user' };
    plan.cuts[0].slots['filter#0'] = { v: 'clockTrail', p: { amount: 1 }, from: 'pin:cut', by: 'user' };
  }
  if (twin) {
    plan.cuts.push({ ...plan.cuts[0], key: 'r2~0', line: 'r2', t0: 66, t1: 74, a: 66, b: 74, repT: 70 });
    plan.lines.push({ ...plan.lines[0], id: 'r2', index: 1, cuts: ['r2~0'], t0: 66, t1: 74 });
  }
  const rec = R.createRecorder(), engine = FAC.createEngine({ registry: reg, canvas: rec.factory, measurer: FM.fakeMeasurer(),
    fonts: null, assets: null, strict: true });
  engine.setPlan(plan);
  const made = rec.factory.create(640, 360, { alpha: true });
  const surface = { canvas: made.canvas, ctx: made.ctx, w: 640, h: 360 };
  function render(t, quality = 'export') {
    seen.length = 0;
    engine.renderFrame(surface, t, { quality, pick: true });
    assert.ok(seen.length, 'the probe paint is visible at ' + t);
    assert.ok(rec.stats().balanced);
    assert.equal(rec.stats().nan, 0);
    return seen.map((p) => ({ ...p }));
  }
  return { engine, rec, plan, render, seen };
}

test('paint q.time follows exact absolute playback/seek/export time while callback t remains scene-local', () => {
  const f = fixture();
  for (const time of [59.8, 60.2, 62.25, 58.5, 59.8, 65.9]) {
    for (const quality of ['preview', 'export']) for (const p of f.render(time, quality)) {
      assert.equal(p.time, time);
      assert.ok(Math.abs(p.tl - (time - 58)) < 1e-10);
    }
  }
  assert.deepEqual(f.render(60.2), f.render(60.2), 'pause/repeated rendering does not advance the clock');
});

test('equal-fingerprint cuts can share a cached scene without inheriting the earlier cut’s absolute clock origin', () => {
  const f = fixture({ twin: true });
  assert.equal(f.engine.scene('cut', 0), f.engine.scene('cut', 1), 'a real cached scene is shared');
  const early = f.render(60.2)[0], later = f.render(68.2)[0];
  assert.equal(early.builtAt, later.builtAt);
  assert.ok(Math.abs(early.tl - later.tl) < 1e-10);
  assert.equal(early.time, 60.2); assert.equal(later.time, 68.2);
  assert.deepEqual(f.render(60.2)[0], early, 'seeking back restores the same clock despite the cache history');
});

test('reference drawing uses explicit absolute paint time, with the scene origin only as an independent-scene fallback', () => {
  const f = fixture({ twin: true }), scene = f.engine.scene('cut', 0);
  const target = f.rec.factory.create(640, 360, { alpha: true });
  FRAME.evaluate(scene, 4.2);
  for (const t of [62.2, 70.2, 0]) {
    f.seen.length = 0;
    R.drawScene(target.ctx, scene, { pal: f.plan.look.palette, tl: 4.2, t });
    assert.ok(f.seen.length);
    assert.equal(f.seen[0].time, t, 'an explicit clock overrides a cached scene’s origin, including zero');
    assert.equal(f.seen[0].tl, 4.2, 'the pose clock remains scene-local');
  }
  f.seen.length = 0;
  R.drawScene(target.ctx, scene, { pal: f.plan.look.palette, tl: 4.2 });
  assert.equal(f.seen[0].time, 62.2);
});

test('camera timing curves and textAt ghost poses leave the displayed clock on the current absolute frame', () => {
  const f = fixture({ ghost: true, camera: true }), samples = f.render(62.2);
  assert.ok(f.engine.scene('cut', 0).shot, 'the camera shot is active');
  assert.ok(samples.length >= 2, 'the effect actually redraws text at an earlier pose');
  assert.ok(samples.some((p) => Math.abs(p.tl - 4.1) < 1e-8), 'a ghost uses the earlier scene-local pose');
  assert.ok(samples.every((p) => p.time === 62.2), 'all passes show the current playback time');
});

test('animated paints stay live inside an isolated layer requesting a static raster', () => {
  const f = fixture({ isolated: true });
  assert.equal(f.render(59.8)[0].time, 59.8);
  assert.equal(f.render(60.2)[0].time, 60.2);
  assert.equal(f.render(60.8)[0].time, 60.8);
});

test('bounded paint picks follow its parent and identify the original text owner, without claiming the whole frame', () => {
  const f = fixture(); f.render(62);
  const scene = f.engine.scene('cut', 0), timerNode = scene.table.type.findIndex((type) => type === T.TYPE.paint);
  const hit = f.engine.hitTest(700, 340).find((h) => h.node === timerNode);
  assert.ok(hit, 'the clock can still be selected on the stage');
  assert.equal(hit.owner, 'text');
  assert.equal(hit.cut, f.plan.cuts[0].key);
  assert.equal(f.engine.hitTest(100, 100).length, 0, 'empty frame space does not become a clock pick');
});
