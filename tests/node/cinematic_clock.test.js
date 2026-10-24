/* 文字PVメーカー v2 — original work. Cinematic overlay windows, exact clocks and backdrop-safe swatches. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const modules = require('../helpers/load').load();
const K = modules.use('parts/kit'), FX = K.cinematic, SCHEMA = modules.use('core/schema');
const env = { D: { w: 1920, h: 1080, short: 1080 }, times: { a: 0, b: 12 } };
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, a + ' ≠ ' + b);

test('cinematic controls are valid editable specs and the kit exposes the shared clock', () => {
  assert.equal(FX, modules.use('engine/scene/cinematic'));
  for (const [name, spec] of Object.entries(FX.params)) assert.deepEqual(SCHEMA.validateSpec(name, spec), [], name);
  const data = FX.setup(env, { start: 2, amount: 0.7 });
  assert.equal(data.duration, 10, 'automatic duration fills only the remaining selected span');
  assert.equal(data.layer, 'far');
  assert.equal(FX.setup(env, { placement: 'front' }).layer, 'near');
  assert.equal(FX.setup(env, { start: 20 }).duration, 0);
  assert.equal(FX.setup(env, { clock: 'song', start: 60 }).duration, 12,
    'an absolute start is not subtracted from the local range length');
});

test('one-pass windows clip the start and end and smoothly fade without a hidden loop', () => {
  const data = FX.setup(env, { start: 2, duration: 6, fade: 1, amount: 0.8 });
  assert.deepEqual(FX.frame(1, data), { active: false, time: 0, u: 0, alpha: 0 });
  assert.equal(FX.frame(2, data).active, false);
  near(FX.frame(2.5, data).alpha, 0.4);
  near(FX.frame(5, data).alpha, 0.8);
  near(FX.frame(7.5, data).alpha, 0.4);
  assert.deepEqual(FX.frame(8, data), { active: false, time: 6, u: 1, alpha: 0 });
  assert.deepEqual(FX.frame(80, data), FX.frame(8, data));
  assert.equal(FX.frame(2, FX.setup(env, { start: 2, duration: 6, fade: 0 })).active, true);
  assert.equal(FX.setup(env, { duration: 0.2, fade: 5 }).fade, 0.1, 'short windows still reach their full strength');
});

test('paused and out-of-order song frames follow q.time independently of reused scene clocks', () => {
  const data = FX.setup(env, { clock: 'song', start: 60, duration: 8, fade: 0.5 });
  const times = [60.2, 64, 67.8, 59, 68, 62];
  const expected = new Map(times.map((time) => [time, FX.frame(0, data, { time })]));
  for (const time of [68, 59, 67.8, 60.2, 64, 62, 64, 60.2]) {
    assert.deepEqual(FX.frame(999, data, { time }), expected.get(time));
    assert.deepEqual(FX.frame(-50, data, { time }), expected.get(time));
  }
  assert.equal(FX.frame(64, data).active, false, 'a missing absolute clock cannot silently use local time');
  assert.equal(FX.frame(64, data, { time: NaN }).active, false);
  const section = FX.setup(env, { start: 2, duration: 6, fade: 0 });
  assert.equal(FX.frame(3, section, { time: 999 }).time, 1, 'a section clock deliberately ignores song time');
});

test('zero strength and empty windows produce no active overlay even at visible times', () => {
  for (const clock of ['section', 'song']) {
    const empty = FX.setup(env, { clock, duration: 6, amount: 0 });
    for (const time of [0, 1, 3, 6, 100]) assert.equal(FX.frame(time, empty, { time }).active, false);
  }
  assert.equal(FX.frame(0, FX.setup({ D: env.D, times: { a: 2, b: 2 } }, {})).active, false);
  assert.equal(FX.frame(Infinity, FX.setup(env, {})).active, false);
});

test('pattern streams are deterministic and do not share mutable state across scenes', () => {
  const a = FX.random(741), b = FX.random(741), other = FX.random(742);
  const expected = Array.from({ length: 50 }, a);
  assert.deepEqual(Array.from({ length: 50 }, b), expected);
  assert.ok(expected.every((v) => v >= 0 && v < 1));
  assert.notDeepEqual(Array.from({ length: 50 }, other), expected);
  assert.deepEqual(Array.from({ length: 50 }, FX.random(741)), expected, 'rebuilding after a seek restores the same geometry');
});

test('source swatches resolve theme tokens, retain normal colours and respect black and keyed backdrops', () => {
  const scene = { ground: '#112233', ink: '#FAFAFA', accent: '#FEDCBA' };
  assert.equal(FX.color(scene, 'accent'), '#FEDCBA');
  assert.equal(FX.color(scene, '#abcDef'), '#ABCDEF');
  assert.equal(FX.color(scene, 'unavailable'), '#FEDCBA');
  const black = { ground: '#000000', ink: '#FFFFFF', accent: '#FFFFFF' };
  const grey = FX.color(black, '#EAA844');
  assert.match(grey, /^#([0-9A-F]{2})\1\1$/);
  const keyed = { ...scene, ground: '#00B140' };
  assert.equal(FX.color(keyed, '#EAA844'), '#EAA844', 'source colours are not mixed with green');
  assert.notEqual(FX.color(keyed, 'ground'), '#00B140', 'the backdrop key is never emitted as an effect colour');
  assert.match(FX.color(keyed, '#33AA55'), /^#([0-9A-F]{2})\1\1$/);
});
