/* 文字PVメーカー v2 — original work. Source-derived weather overlays: random access, alpha and bounded rendering. */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { load } = require('../helpers/load');
const MV = load(), FAC = MV.use('engine/facade'), BUILD = MV.use('engine/scene/build');
const RECORD = MV.use('engine/render/record'), COLOR = MV.use('core/color');
const { createTextService } = MV.use('engine/text/service'), { fakeMeasurer } = MV.use('engine/text/fake_measure');
const REG = MV.use('parts/catalog').defaultRegistry();
const KEYS = ['fluidClouds', 'wavePuddle'];

function effect(key, values = {}, aspect = '16:9', black = false) {
  const params = Object.assign({ start: 0, duration: 10, fade: 0, amount: 1 }, values);
  const plan = FAC.samplePlan(REG, { kind: 'ornament', key, params }, { aspect, text: '雨と光をたどる' });
  if (black) plan.look.palette = Object.assign({}, plan.look.palette, { ground: '#000000', ink: '#FFFFFF', accent: '#FFFFFF' });
  plan.duration = plan.grounds[0].t1 = 10;
  const scene = BUILD.buildGround(plan.grounds[0], plan, { registry: REG, strict: true,
    text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }) });
  return { plan, rec: scene.stores.paint.find((p) => ['section', 'song'].includes(p.data.clock)) };
}

function draw(effect, t, absolute = t, draft = false) {
  const recorder = RECORD.createRecorder(), { w, h } = effect.plan.design;
  const surface = RECORD.surfaceOf(recorder.factory, w, h, true), pal = effect.plan.look.palette;
  const q = { draft, scale: 1, time: absolute, pal, rgba: (ink, a) => COLOR.rgba(pal[ink] || ink, a) };
  const mark = recorder.mark();
  effect.rec.draw(surface.ctx, t, effect.rec.data, q);
  return { ops: recorder.ops().slice(mark), stats: recorder.stats() };
}

test('weather effects are explicitly selected segment overlays with fixed, editable source controls', () => {
  for (const key of KEYS) {
    const def = REG.get('ornament', key);
    assert.equal(def.family, 'cinematic'); assert.equal(def.scope, 'run'); assert.equal(def.pool, false);
    assert.ok(!REG.pool('ornament', { scope: 'run' }).includes(key));
    for (const { name, spec } of REG.params('ornament', key).filter((p) => !p.shared)) {
      assert.ok(spec.label.ja && spec.label.en, key + '/' + name);
      assert.ok(Object.hasOwn(spec.auto, 'value'), key + '/' + name + ' does not change at a scene split');
    }
  }
});

test('cloud advection and water waves redraw exactly after backwards seeking and scene-clock changes', () => {
  for (const key of KEYS) {
    const e = effect(key, { clock: 'song', start: 2, duration: 7 }), first = draw(e, 0.4, 4.3);
    draw(e, 8, 8.5); draw(e, 0.1, 2.1);
    assert.deepEqual(draw(e, 3.7, 4.3).ops, first.ops, key + ': q.time controls a reused scene');
    assert.notDeepEqual(draw(e, 3.7, 5.6).ops, first.ops, key + ': visible continuous movement');
    assert.ok(first.stats.balanced); assert.equal(first.stats.nan, 0); assert.equal(first.stats.alphaBad, 0);
  }
});

test('weather overlays make no drawing calls outside their window or at zero strength', () => {
  for (const key of KEYS) {
    const timed = effect(key, { start: 2, duration: 4, fade: 0.5 });
    for (const t of [0, 1.99, 2, 6, 15]) assert.equal(draw(timed, t).ops.length, 0, key + ' t=' + t);
    assert.ok(draw(timed, 3).ops.some((op) => ['fillRect', 'stroke'].includes(op[1])));
    assert.equal(draw(effect(key, { amount: 0 }), 4).ops.length, 0, key + ': zero strength');
  }
});

test('cloud density and rain controls govern their own visible components without opaque sky fills', () => {
  const empty = draw(effect('fluidClouds', { density: 0 }), 3);
  assert.equal(empty.ops.length, 0, 'no cloud field when its density is zero');
  const cloudy = draw(effect('fluidClouds'), 3);
  assert.ok(cloudy.ops.some((op) => op[1] === 'createRadialGradient'));
  assert.ok(!cloudy.ops.some((op) => op[1] === 'fillRect' && op[2] === 0 && op[3] === 0 && op[4] === 1920 && op[5] === 1080));
  const quiet = draw(effect('wavePuddle', { rain: 0, reflection: 0 }), 3);
  const rainy = draw(effect('wavePuddle', { rain: 1 }), 3);
  assert.ok(!quiet.ops.some((op) => op[1] === 'ellipse'), 'rain-off removes the concentric drop waves');
  assert.ok(rainy.ops.some((op) => op[1] === 'ellipse'), 'rain creates projected rings');
  assert.notDeepEqual(draw(effect('wavePuddle', { seed: 987 }), 3).ops, rainy.ops);
});

test('weather geometry stays finite and bounded at maximum controls across wide and portrait outputs', () => {
  const limits = { fluidClouds: { density: 1.5, wind: 14, thickness: 0.5 }, wavePuddle: { rain: 1, wind: 14, spread: 1, height: 0.45 } };
  for (const key of KEYS) for (const aspect of ['16:9', '9:16', '21:9']) for (const draft of [false, true]) {
    const frame = draw(effect(key, limits[key], aspect), 4.7, 4.7, draft);
    assert.ok(frame.stats.balanced, key + ': balanced'); assert.equal(frame.stats.nan, 0); assert.equal(frame.stats.alphaBad, 0);
    assert.ok(frame.ops.length <= 9000, key + '/' + aspect + ': ' + frame.ops.length + ' operations');
    assert.ok(frame.ops.filter((op) => /Gradient$/.test(op[1])).length <= 16, key + ': gradient budget');
  }
});

test('weather source swatches remain monochrome on a black export backdrop', () => {
  for (const key of KEYS) {
    const frame = draw(effect(key, {}, '16:9', true), 3);
    const colors = frame.ops.flatMap((op) => op.filter((v) => typeof v === 'string' && /^rgba?\(/.test(v)));
    assert.ok(colors.length > 0, key + ': visible swatches checked');
    for (const color of colors) {
      const channels = color.match(/[\d.]+/g).map(Number);
      assert.equal(channels[0], channels[1], key + ': ' + color); assert.equal(channels[1], channels[2], key + ': ' + color);
    }
  }
});
