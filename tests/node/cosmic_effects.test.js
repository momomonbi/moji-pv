/* 文字PVメーカー v2 — source-derived cosmic overlays: random access, phase changes and native draw budgets. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');
const MV = load(), FAC = MV.use('engine/facade'), BUILD = MV.use('engine/scene/build');
const REC = MV.use('engine/render/record'), COLOR = MV.use('core/color'), HASH = MV.use('core/hash');
const registry = MV.use('parts/catalog').defaultRegistry();
const { createTextService } = MV.use('engine/text/service'), { fakeMeasurer } = MV.use('engine/text/fake_measure');
const KEYS = ['universeJourney', 'singularityBurst'];

function sample(key, params = {}, aspect = '16:9') {
  const plan = FAC.samplePlan(registry, { kind: 'ornament', key,
    params: Object.assign({ duration: 8, fade: 0, amount: 0.7 }, params) }, { aspect });
  const scene = BUILD.buildGround(plan.grounds[0], plan, { registry,
    text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true });
  return { plan, paint: scene.stores.paint.at(-1) };
}
function canvas() {
  const rec = REC.createRecorder(), { ctx } = rec.factory.create(320, 180, { alpha: true });
  return { rec, ctx };
}
function draw(item, target, time, absolute = time, draft = false) {
  target.rec.reset();
  item.paint.draw(target.ctx, time, item.paint.data, { time: absolute, draft, pal: item.plan.look.palette,
    rgba: (ink, alpha) => COLOR.rgba(item.plan.look.palette[ink] || ink, alpha) });
  const names = new Map();
  const ops = target.rec.ops().map((op) => op.map((v) => typeof v === 'string' ? v.replace(/^([gp]\d+)(?=$|\.)/, (id) => {
    if (!names.has(id)) names.set(id, id[0] + names.size);
    return names.get(id);
  }) : v));
  const stats = target.rec.stats();
  assert.equal(stats.nan, 0); assert.equal(stats.alphaBad, 0); assert.equal(stats.balanced, true);
  return { ops, hash: HASH.hashJSON(ops), gradients: ops.filter((op) => op[1] === 'createRadialGradient').length };
}

test('cosmic presets are explicit transparent run effects and keep all other automatic looks unchanged', () => {
  for (const key of KEYS) {
    const def = registry.get('ornament', key);
    assert.equal(def.scope, 'run'); assert.equal(def.follow, 'own'); assert.equal(def.pool, false);
    assert.equal(def.family, 'cinematic');
    const item = sample(key), painted = draw(item, canvas(), 1);
    assert.ok(painted.ops.some((op) => op[1] === 'arc'), key + ' paints actual lights');
    assert.ok(!painted.ops.some((op) => ['fillRect', 'clearRect', 'drawImage'].includes(op[1])), key + ' does not replace the existing image');
  }
});

test('both cosmic effects reproduce the same picture after backward and out-of-order song seeks', () => {
  for (const key of KEYS) {
    const item = sample(key, { clock: 'song', start: 20, duration: 8, seed: 731 }), target = canvas();
    const wanted = draw(item, target, 0.3, 21.7).hash;
    draw(item, target, 0.8, 27.4); draw(item, target, 0.1, 20.2);
    assert.equal(draw(item, target, 0.05, 21.7).hash, wanted, key + ' uses absolute song time across scene splits');
    assert.equal(draw(item, target, 0, 19.9).ops.length, 0);
    assert.equal(draw(item, target, 1, 28).ops.length, 0);
    assert.equal(draw(sample(key, { amount: 0 }), target, 1).ops.length, 0);
  }
});

test('the universe journey shows curved web filaments, spiral stars and a close stellar surface in sequence', () => {
  const item = sample('universeJourney'), target = canvas();
  const web = draw(item, target, 0.5), galaxy = draw(item, target, 4), star = draw(item, target, 5.8);
  assert.ok(web.ops.some((op) => op[1] === 'bezierCurveTo'), 'the source curved cosmic network appears');
  assert.ok(!galaxy.ops.some((op) => op[1] === 'bezierCurveTo'), 'the network gives way to the galaxy');
  assert.ok(galaxy.ops.some((op) => op[1] === 'arc'), 'individual orbital lights remain in the galaxy');
  assert.ok(star.ops.some((op) => op[1] === 'ellipse'), 'the close star has convection and magnetic arches');
  assert.equal(new Set([web.hash, galaxy.hash, star.hash]).size, 3);
});

test('the singularity changes from accretion to compression and a single expanding shock front', () => {
  const item = sample('singularityBurst', { duration: 110 }), target = canvas();
  const feast = draw(item, target, 30), critical = draw(item, target, 82), bang = draw(item, target, 85), newStars = draw(item, target, 100);
  const ellipses = (frame) => frame.ops.filter((op) => op[1] === 'ellipse');
  assert.ok(ellipses(feast).length >= 3, 'rotating accretion bands are visible before the Big Bang');
  assert.ok(ellipses(critical)[0][4] < ellipses(feast)[0][4], 'the source critical phase contracts the horizon');
  assert.equal(ellipses(bang).length, 1, 'one shock front replaces the accretion bands');
  assert.equal(new Set([feast.hash, critical.hash, bang.hash, newStars.hash]).size, 4);
});

test('maximum cosmic settings retain bounded native work and fewer than sixteen gradient allocations per frame', () => {
  for (const key of KEYS) {
    const item = sample(key, { density: 1200, size: 1.5, amount: 1 }, '21:9'), target = canvas();
    for (const t of [0.3, 1, 3, 4.8, 5.8, 6.2, 7.4]) {
      const full = draw(item, target, t), draft = draw(item, target, t, t, true);
      assert.ok(full.ops.length <= 9000, key + '@' + t + ': ' + full.ops.length + ' recorded operations');
      assert.ok(full.gradients <= 16, key + '@' + t + ': ' + full.gradients + ' gradients');
      assert.ok(draft.ops.length <= full.ops.length, 'draft lowers representative density without changing the phase');
    }
  }
});
