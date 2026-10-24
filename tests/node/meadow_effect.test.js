/* 文字PVメーカー v2 — original work. Seek, compositing and bounded-cost checks for the imported meadow elements. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');
const modules = load(), FAC = modules.use('engine/facade'), H = modules.use('core/hash');
const R = modules.use('engine/render/record'), reg = modules.use('parts/catalog').defaultRegistry();
const def = reg.get('ornament', 'windMeadow');

function picture(overrides, aspect = '16:9', envSeed = 1) {
  const plan = FAC.samplePlan(reg, { kind: 'ornament', key: def.key, params: Object.assign({ duration: 10, fade: 0, amount: 1 }, overrides) }, { aspect });
  const p = plan.grounds[0].atmos.p, records = [];
  def.build({ D: plan.design, times: { a: 0, b: 10 }, pal: plan.look.palette, rng: { seed: envSeed }, sb: { paint: (o) => records.push(o) } }, p);
  return { record: records[0], pal: plan.look.palette };
}

function draw(pic, time, songTime = time, draft = false) {
  const rec = R.createRecorder(), surf = R.surfaceOf(rec.factory, 320, 180, true);
  const mark = rec.mark();
  const q = { time: songTime, draft, rgba: (ink, alpha) => modules.use('core/color').rgba(ink, alpha) };
  pic.record.draw(surf.ctx, time, pic.record.data, q);
  const ops = rec.ops().slice(mark).map((op) => op.slice(1));
  assert.equal(rec.stats().nan, 0);
  assert.equal(rec.stats().alphaBad, 0);
  assert.equal(rec.stats().balanced, true);
  return { hash: H.hashJSON(ops), ops };
}

test('meadow has three source-derived scenes and remains an explicitly chosen transparent overlay', () => {
  assert.equal(def.pool, false);
  assert.equal(def.scope, 'run');
  assert.equal(def.family, 'cinematic');
  assert.ok(!reg.pool('ornament', { scope: 'run' }).includes(def.key));
  const hashes = ['day', 'night', 'snow'].map((mode) => {
    const frame = draw(picture({ mode }), 3);
    assert.ok(frame.ops.some((op) => op[0] === 'bezierCurveTo'), 'real curved grass geometry is drawn');
    assert.ok(!frame.ops.some((op) => op[0] === 'fillRect'), 'no opaque canvas rectangle replaces an existing picture');
    return frame.hash;
  });
  assert.equal(new Set(hashes).size, 3, 'day foliage, moonlit lights and snow are distinct');
});

test('meadow geometry is identical across scene seeds and arbitrary seek order in landscape and portrait', () => {
  for (const aspect of ['16:9', '9:16']) for (const mode of ['day', 'night', 'snow']) {
    const first = picture({ mode }, aspect, 1), second = picture({ mode }, aspect, 981);
    const untouched = H.hashJSON(first.record.data);
    const expected = new Map([1.1, 3.5, 7.9].map((t) => [t, draw(first, t).hash]));
    for (const time of [7.9, 1.1, 3.5, 1.1]) {
      assert.equal(draw(first, time).hash, expected.get(time));
      assert.equal(draw(second, time).hash, expected.get(time), 'background-segment seeds cannot change the meadow');
    }
    assert.equal(H.hashJSON(first.record.data), untouched, 'drawing does not integrate or mutate simulation state');
  }
});

test('timing and strength genuinely omit the meadow outside its interval and respect absolute song time', () => {
  const pic = picture({ clock: 'song', start: 20, duration: 5 });
  assert.equal(draw(pic, 1, 19.9).ops.length, 0);
  assert.equal(draw(pic, 1, 25).ops.length, 0);
  assert.ok(draw(pic, 0.5, 22).ops.length > 0);
  assert.equal(draw(pic, 0.5, 22).hash, draw(pic, 200, 22).hash, 'cached scene origin does not restart a selected song interval');
  assert.equal(draw(picture({ amount: 0 }), 3).ops.length, 0);
  const frozen = picture({ speed: 0 });
  assert.equal(draw(frozen, 2).hash, draw(frozen, 7).hash, 'zero motion speed freezes the whole picture');
  assert.notEqual(draw(picture({ speed: 1 }), 2).hash, draw(picture({ speed: 1 }), 7).hash);
});

test('the heaviest meadow stays bounded and draft rendering reduces work without losing its scene', () => {
  const pic = picture({ mode: 'snow', density: 600, height: 0.38, gust: 1, wind: 14, sway: 2 }, '21:9');
  const full = draw(pic, 4), draft = draw(pic, 4, 4, true);
  assert.ok(full.ops.length < 9000, 'the largest density remains inside the world-parts operation budget: ' + full.ops.length);
  assert.ok(draft.ops.length < full.ops.length * 0.6, 'draft work is substantially reduced');
  assert.ok(draft.ops.some((op) => op[0] === 'bezierCurveTo'));
  assert.ok(draft.ops.some((op) => op[0] === 'ellipse'));
});
