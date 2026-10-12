/* 文字PVメーカー v2 — original work. Full sample ranges, slow playback and canonical camera previews. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');
const MV = load(), CP = MV.use('ui/camera_preview'), FAC = MV.use('engine/facade'), SHOT = MV.use('core/shot');
const reg = MV.use('parts/catalog').defaultRegistry();
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' ≠ ' + b);

test('full camera samples include every shot key and the section camera end, beyond the old 3-second loop', () => {
  for (const [kind, keys] of [['shot', SHOT.SHOT_KEYS], ['xshot', SHOT.XSHOT_KEYS], ['rig', SHOT.RIG_KEYS]]) {
    for (const key of keys) {
      const sample = FAC.samplePlan(reg, { kind, key }, { text: 'Camera movement sample', aspect: '16:9' });
      assert.ok(sample.duration > 3, kind + '/' + key + ' includes the complete sample');
      assert.equal(sample.cuts[0].a, 0, 'full-cycle playback begins at the entrance');
      assert.ok(sample.duration >= sample.cuts[0].b, 'the final camera/exit pose is reachable');
      if (kind === 'rig') assert.equal(sample.rigs[0].t1, sample.duration);
      const finish = CP.advance(0, sample.duration * 2, sample.duration, 0.5, false);
      near(finish.time, sample.duration); assert.equal(finish.ended, true);
    }
  }
});

test('slow playback exposes early camera movement and looping keeps the full final interval', () => {
  near(CP.advance(0, 1, 3.4, 0.5, true).time, 0.5);
  near(CP.advance(0, 1, 3.4, 0.25, true).time, 0.25);
  near(CP.advance(3.1, 0.2, 3.4, 1, true).time, 3.3);
  near(CP.advance(3.3, 0.2, 3.4, 1, true).time, 0.1);
  assert.deepEqual(CP.advance(3.3, 0.2, 3.4, 1, false), { time: 3.4, ended: true });
  assert.deepEqual(CP.advance(0, 1, 0, 0.5, true), { time: 0, ended: true });
});

test('EXTREME preview preserves mirrored keys and custom shot objects without changing the reference', () => {
  const key = SHOT.XSHOT_KEYS[0] + '~m';
  const ref = Object.freeze({ kind: 'shot', key, params: Object.freeze({ zoom: 1.4, follow: 0.2, extreme: 0.75 }) });
  const normalized = CP.normalize(ref);
  assert.equal(normalized.kind, 'xshot'); assert.equal(normalized.key, key); assert.equal(normalized.params, ref.params);
  assert.equal(ref.kind, 'shot');
  const sample = FAC.samplePlan(reg, normalized, { text: 'Mirrored camera sample' });
  assert.equal(sample.cuts[0].slots['cam.shot'].v, key);
  assert.equal(sample.cuts[0].slots['cam.zoom'].v, 1.4);
  assert.equal(sample.cuts[0].slots['cam.extreme'].v, 0.75);
  const custom = SHOT.coerceShot({ keys: [{ at: 'a', aim: 'frame', zoom: 1 }, { at: 'b', aim: 'frame', zoom: 1.3 }] });
  const customSample = FAC.samplePlan(reg, CP.normalize({ kind: 'shot', key: custom }), { text: 'Custom sample' });
  assert.deepEqual(customSample.cuts[0].slots['cam.shot'].v, custom);
});

test('all camera sample aspects retain their exact design ratio and readable sample text', () => {
  for (const aspect of ['16:9', '9:16', '1:1', '4:3']) {
    const sample = FAC.samplePlan(reg, { kind: 'rig', key: SHOT.RIG_KEYS[0] }, { aspect, text: 'Large camera sample' });
    const [w, h] = aspect.split(':').map(Number);
    near(sample.design.w / sample.design.h, w / h);
    assert.equal(sample.cuts[0].text, 'Large camera sample');
  }
});
