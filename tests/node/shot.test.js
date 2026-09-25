/* 文字PVメーカー v2 — original work. Tests for core/shot: shot and rig values, presets, expansion, carry, the AI move table (DESIGN_2_1 §3.3, §4.5, §4.6). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');

const MV = load();
const SHOT = MV.use('core/shot');
const CV = MV.use('core/curve');
const H = MV.use('core/hash');

const TEXT_AIMS = ['block', 'emph', 'first', 'last', 'reading'];

test('presets: the §4.5.1 and §4.6 tables in canonical form, with tags', () => {
  assert.deepEqual(SHOT.SHOTS.pushWord, {
    tags: ['bold', 'serious'],
    keys: [{ aim: 'block', at: 'a' }, { aim: 'emph', at: 'emph', dt: -0.1, fill: 0.82 }, { aim: 'emph', at: 'b', curve: 'linear', fill: 0.88 }],
  });
  assert.deepEqual(SHOT.SHOTS.readAlong.follow, 0.25);
  assert.deepEqual(SHOT.SHOTS.snapZoom.keys.map((k) => k.curve || '-'), ['-', 'linear', 'dashStop', 'fadeBrake']);
  assert.deepEqual(SHOT.SHOTS.sweepAcross.keys.map((k) => k.ox), [-0.12, 0.12]);
  assert.deepEqual(SHOT.SHOTS.wideHold.keys, [{ aim: 'frame', at: 'a', zoom: 0.94 }, { aim: 'frame', at: 'b', curve: 'linear', zoom: 0.98 }]);
  assert.deepEqual(SHOT.SHOTS.tiltHold.keys.map((k) => k.roll), [-4, -2]);
  for (const key of SHOT.SHOT_KEYS) {
    const p = SHOT.SHOTS[key];
    assert.ok(Object.isFrozen(p) && p.keys.every(Object.isFrozen), key + ' is frozen');
    assert.ok(p.tags.length >= 1 && p.tags.every((t) => MV.use('core/schema').TAGS.includes(t)), key + ' tags');
    assert.deepEqual(SHOT.coerceShot({ keys: p.keys, follow: p.follow }), { keys: p.keys, ...(p.follow ? { follow: p.follow } : {}) });
  }
  assert.deepEqual(SHOT.RIGS.slowSwell, { tags: ['slow', 'soft'], curve: 'softEnds', keys: [{ u: 0 }, { u: 1, zoom: 1.08 }] });
  assert.deepEqual(SHOT.RIGS.climbRise.keys, [{ u: 0, y: 0.025, zoom: 1.02 }, { u: 1, y: -0.025, zoom: 1.06 }]);
  assert.deepEqual(SHOT.RIGS.pullAway.curve, 'fadeBrake');
  assert.deepEqual(SHOT.RIGS.leanTilt.keys, [{ u: 0, zoom: 1.02 }, { roll: 2.5, u: 1, zoom: 1.04 }]);
  assert.deepEqual(SHOT.RIGS.driftSide, { tags: ['airy'], curve: 'linear', keys: [{ u: 0, x: -0.02, zoom: 1.03 }, { u: 1, x: 0.02, zoom: 1.03 }] });
});

test('coerceShot: canonical keys (defaults omitted, sorted, q3, frozen), clamped ranges, ox kept at 0', () => {
  const v = SHOT.coerceShot({ follow: 0.2, keys: [
    { at: 'a', aim: 'block', fill: 0.6, dt: 0, roll: 0, zoom: 1.1, px: 0.2 },
    { aim: 'word:1', at: 'word:1', curve: 'holdThenDash', fill: 0.9, ox: 0.1 },
    { at: 0.5, aim: 'point', px: 0.25, py: 0.5, zoom: 1.2, ox: 0 },
    { at: 'b', aim: 'frame', fill: 0.3, curve: { ramp: { edge: 0.1, ends: 'both', peak: 6 } } },
  ] });
  assert.deepEqual(v, { follow: 0.2, keys: [
    { aim: 'block', at: 'a' },
    { aim: 'word:1', at: 'word:1', curve: 'holdThenDash', fill: 0.9, ox: 0.1 },
    { aim: 'point', at: 0.5, ox: 0, px: 0.25, zoom: 1.2 },
    { aim: 'frame', at: 'b', curve: { ramp: { edge: 0.1, ends: 'both', peak: 6 } } },
  ] });
  assert.ok(Object.isFrozen(v) && Object.isFrozen(v.keys[1]));
  assert.equal(JSON.stringify(v), H.canonical(v), 'sorted keys');
  assert.deepEqual(SHOT.coerceShot(JSON.parse(JSON.stringify(v))), v, 'round trip');
  const clamped = SHOT.coerceShot({ follow: 3, keys: [
    { at: 7, aim: 'block', dt: -9, fill: 5, ox: 1, oy: -1, roll: 99 },
    { at: 'word:-99', aim: 'glyph:500', fill: 0.01 },
    { at: 'beat:40', aim: 'line:-3' },
  ] });
  assert.deepEqual(clamped, { follow: 1, keys: [
    { aim: 'block', at: 1, dt: -2, fill: 1.2, ox: 0.4, oy: -0.4, roll: 15 },
    { aim: 'glyph:80', at: 'word:-20', fill: 0.1 },
    { aim: 'line:0', at: 'beat:16' },
  ] });
  // unreadable keys are dropped; < 2 keys → undefined; > 6 → the first 6
  assert.equal(SHOT.coerceShot({ keys: [{ at: 'a', aim: 'block' }, { at: 'later', aim: 'block' }] }), undefined);
  assert.equal(SHOT.coerceShot({ keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'nowhere' }, { aim: 'block' }] }), undefined);
  const seven = Array.from({ length: 7 }, (_, i) => ({ at: i / 6, aim: 'block' }));
  assert.equal(SHOT.coerceShot({ keys: seven }).keys.length, 6);
  const withBad = SHOT.coerceShot({ keys: [{ at: 'a', aim: 'block', curve: 'wobble' }, { at: 'x', aim: 'block' }, { at: 'b', aim: 'last' }] });
  assert.deepEqual(withBad.keys, [{ aim: 'block', at: 'a' }, { aim: 'last', at: 'b' }], 'a bad curve is dropped, a bad key skipped');
  for (const bad of ['slowSwell', 'wobble', '', null, 3, [], {}, { keys: 'x' }]) assert.equal(SHOT.coerceShot(bad), undefined, JSON.stringify(bad));
  assert.equal(SHOT.coerceShot('none'), 'none');
  assert.equal(SHOT.coerceShot('settle'), 'settle');
  assert.equal(SHOT.isCustom(v), true);
  assert.equal(SHOT.isCustom('settle'), false);
});

test('coerceRig: canonical keys, clamped ranges, 2–4 keys in u order', () => {
  assert.deepEqual(SHOT.coerceRig({ keys: [{ u: 0, zoom: 1, x: 0, roll: 0 }, { u: 1.5, zoom: 3, x: 1, y: -1, roll: -9, curve: 'expoOut' }] }),
    { keys: [{ u: 0 }, { curve: 'expoOut', roll: -4, u: 1, x: 0.05, y: -0.05, zoom: 1.15 }] });
  assert.equal(SHOT.coerceRig({ keys: [{ u: 0.6 }, { u: 0.2 }] }), undefined, 'u must not decrease');
  assert.equal(SHOT.coerceRig({ keys: [{ u: 0 }] }), undefined);
  assert.equal(SHOT.coerceRig({ keys: Array.from({ length: 6 }, (_, i) => ({ u: i / 5 })) }).keys.length, 4);
  assert.equal(SHOT.coerceRig('slowSwell'), 'slowSwell');
  assert.equal(SHOT.coerceRig('none'), 'none');
  assert.equal(SHOT.coerceRig('pushWord'), undefined);
  assert.ok(Object.isFrozen(SHOT.coerceRig({ keys: [{ u: 0 }, { u: 1 }] })));
});

test('expandShot: zoom scales closeness, keys get the curve, carry replaces key 0 at a, follow replaces', () => {
  assert.equal(SHOT.expandShot('none'), null);
  assert.equal(SHOT.expandShot('wobble'), null);
  const push = SHOT.expandShot('pushWord');
  assert.deepEqual(push.keys.map((k) => [k.at, k.dt, k.aim, k.fill, k.roll, k.curve]),
    [['a', 0, 'block', 0.6, 0, 'softEnds'], ['emph', -0.1, 'emph', 0.82, 0, 'softEnds'], ['b', 0, 'emph', 0.88, 0, 'linear']]);
  assert.equal(push.follow, 0);
  const closer = SHOT.expandShot('pushWord', { zoom: 1.4, curve: 'holdThenDash' });
  assert.deepEqual(closer.keys.map((k) => k.fill), [0.84, 1.148, 1.2], 'fill·zoom clamped to 1.2');
  assert.deepEqual(closer.keys.map((k) => k.curve), ['holdThenDash', 'holdThenDash', 'linear']);
  const wide = SHOT.expandShot('wideHold', { zoom: 2 });
  assert.deepEqual(wide.keys.map((k) => k.zoom), [0.9, 0.96], '1 + (zoom − 1)·z clamped to [0.9, 1.25]');
  assert.equal(wide.keys[0].fill, undefined);
  assert.equal(SHOT.expandShot('readAlong').follow, 0.25);
  assert.equal(SHOT.expandShot('readAlong', { follow: 0.6 }).follow, 0.6);
  assert.equal(SHOT.expandShot('readAlong', { follow: null }).follow, 0.25);
  const carried = SHOT.expandShot('settle', { carry: { fill: 0.9, ox: 0.1, roll: -2 } });
  assert.deepEqual(carried.keys[0], { at: 'a', dt: 0, aim: 'block', fill: 0.9, ox: 0.1, roll: -2, curve: 'softEnds' });
  assert.deepEqual(carried.keys[1].fill, 0.66, 'only key 0 changes');
  const sweep = SHOT.expandShot('sweepAcross', { carry: { fill: 0.7, roll: 0 } });
  assert.equal(sweep.keys[0].ox, undefined, 'carry without ox keeps the composition');
  const noCarry = SHOT.expandShot('wideHold', { carry: { fill: 0.9, roll: 3 } });
  assert.equal(noCarry.keys[0].roll, 0, 'a frame aim at key 0 takes no carry');
  const point = SHOT.expandShot({ keys: [{ at: 'a', aim: 'point' }, { at: 'b', aim: 'point', px: 0.1 }] });
  assert.deepEqual(point.keys.map((k) => [k.px, k.py, k.zoom]), [[0.5, 0.5, 1], [0.1, 0.5, 1]]);
  assert.ok(Object.isFrozen(push.keys[0]));
});

test('lastFraming and maxFill', () => {
  assert.deepEqual(SHOT.lastFraming('pushWord'), { fill: 0.88, roll: 0 });
  assert.deepEqual(SHOT.lastFraming('pushWord', { zoom: 1.2 }), { fill: 1.056, roll: 0 });
  assert.deepEqual(SHOT.lastFraming('sweepAcross'), { fill: 0.8, ox: 0.12, roll: 0 });
  assert.deepEqual(SHOT.lastFraming('tiltHold'), { fill: 0.68, roll: -2 });
  assert.equal(SHOT.lastFraming('wideHold'), null, 'a frame aim has no symbolic closeness');
  assert.equal(SHOT.lastFraming('none'), null);
  // carry = lastFraming of A fed to expandShot of B: B starts where A ended
  const B = SHOT.expandShot('settle', { carry: SHOT.lastFraming('sweepAcross', { zoom: 1.1 }) });
  assert.deepEqual([B.keys[0].fill, B.keys[0].ox], [0.88, 0.12]);
  assert.equal(SHOT.maxFill('pushWord'), 0.88);
  assert.equal(SHOT.maxFill('pullReveal'), 0.95);
  assert.equal(SHOT.maxFill('wideHold'), 0);
  assert.equal(SHOT.maxFill('none'), 0);
  assert.equal(SHOT.maxFill({ keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'frame' }] }), 0.6);
});

test('expandRig: amp scales deviations; key curves fall back to the given curve, the preset curve, linear', () => {
  assert.equal(SHOT.expandRig('none'), null);
  const r = SHOT.expandRig('climbRise', { amp: 0.5 });
  approx(r.keys[0].zoom, Math.exp(0.5 * Math.log(1.02)), 1e-12);
  approx(r.keys[1].y, -0.0125, 1e-12);
  assert.deepEqual(r.keys.map((k) => k.curve), ['softEnds', 'softEnds']);
  assert.deepEqual(SHOT.expandRig('climbRise', { curve: 'slowBloom' }).keys.map((k) => k.curve), ['slowBloom', 'slowBloom']);
  assert.deepEqual(SHOT.expandRig({ keys: [{ u: 0 }, { u: 1, zoom: 1.1, curve: 'dashStop' }] }).keys.map((k) => k.curve), ['linear', 'dashStop']);
  const same = SHOT.expandRig('leanTilt');
  assert.deepEqual(same.keys.map((k) => [k.u, k.zoom, k.x, k.y, k.roll]), [[0, 1.02, 0, 0, 0], [1, 1.04, 0, 0, 2.5]]);
});

test('fromMove: every move × timing × focus gives a valid shot of 2–6 keys (§4.5.8 table)', () => {
  let n = 0;
  for (const move of SHOT.MOVES) {
    for (const timing of SHOT.TIMINGS) {
      for (const focus of SHOT.FOCI) {
        for (const fill of [-1, 0.2, 0.75, 1.5]) {
          const ref = SHOT.fromMove({ move, focus, timing, fill });
          assert.ok(ref && typeof ref === 'object', move + ' ' + timing + ' ' + focus);
          assert.deepEqual(SHOT.coerceShot(ref), ref, 'already canonical');
          assert.ok(ref.keys.length >= 2 && ref.keys.length <= 6);
          n++;
        }
      }
    }
  }
  assert.equal(n, SHOT.MOVES.length * 4 * 5 * 4);
  assert.equal(SHOT.fromMove({ move: 'zoomOut', focus: 'text', timing: 'whole', fill: 1 }), undefined);
  assert.equal(SHOT.fromMove(null), undefined);
  assert.deepEqual(SHOT.fromMove({ move: 'pushIn', focus: 'emphasis', timing: 'arrive', fill: 0.9 }),
    { keys: [{ aim: 'emph', at: 'a', fill: 0.65 }, { aim: 'emph', at: 'rest', fill: 0.9 }] });
  assert.deepEqual(SHOT.fromMove({ move: 'pullOut', focus: 'text', timing: 'depart', fill: -1 }),
    { keys: [{ aim: 'block', at: 'out', fill: 0.75 }, { aim: 'block', at: 'b', fill: 0.5 }] });
  assert.deepEqual(SHOT.fromMove({ move: 'panLeft', focus: 'first', timing: 'hold', fill: 0.8 }),
    { keys: [{ aim: 'first', at: 'rest', fill: 0.8, ox: -0.12 }, { aim: 'first', at: 'out', fill: 0.8, ox: 0.12 }] });
  assert.deepEqual(SHOT.fromMove({ move: 'pushIn', focus: 'center', timing: 'whole', fill: 1.1 }),
    { keys: [{ aim: 'frame', at: 'a', zoom: 1.172 }, { aim: 'frame', at: 'b', zoom: 1.25 }] }, 'the frame takes a zoom from fill');
  assert.deepEqual(SHOT.fromMove({ move: 'drift', focus: 'last', timing: 'arrive', fill: 0.6 }),
    { keys: [{ aim: 'last', at: 'a', ox: -0.06 }, { aim: 'last', at: 'b', curve: 'linear', ox: 0.06 }] }, 'fill 0.6 is the default');
  assert.deepEqual(SHOT.fromMove({ move: 'follow', focus: 'center', timing: 'hold', fill: 0.8 }),
    { follow: 0.25, keys: [{ aim: 'first', at: 'a', fill: 0.8 }, { aim: 'reading', at: 'sung', fill: 0.8 }, { aim: 'block', at: 'end', fill: 0.55 }] });
  assert.deepEqual(SHOT.fromMove({ move: 'punch', focus: 'emphasis', timing: 'whole', fill: 1 }).keys, [
    { aim: 'block', at: 'a', fill: 0.75 }, { aim: 'block', at: 'emph', curve: 'linear', dt: -0.06, fill: 0.75 },
    { aim: 'emph', at: 'emph', curve: 'dashStop', dt: 0.12, fill: 1 }, { aim: 'emph', at: 'b', fill: 0.95 }]);
  assert.equal(SHOT.fromMove({ move: 'punch', focus: 'text' }).keys[1].at, 'sung');
  assert.deepEqual(SHOT.fromMove({ move: 'tilt', focus: 'text', timing: 'whole', fill: 0.75 }).keys.map((k) => k.roll), [-4, 4]);
});

test('usesBeats, labels and the string table', () => {
  assert.equal(SHOT.usesBeats('pushWord'), false);
  assert.equal(SHOT.usesBeats({ keys: [{ at: 'a', aim: 'block' }, { at: 'beat:2', aim: 'emph' }] }), true);
  assert.deepEqual(SHOT.label('pushWord'), ['shot.pushWord', {}]);
  assert.deepEqual(SHOT.label('none'), ['shot.none', {}]);
  assert.deepEqual(SHOT.label({ keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'block' }, { at: 'mid', aim: 'emph' }] }), ['shot.custom', { n: 3 }]);
  assert.deepEqual(SHOT.label(42), ['shot.none', {}]);
  assert.deepEqual(SHOT.rigLabel('slowSwell'), ['rig.slowSwell', {}]);
  assert.deepEqual(SHOT.rigLabel({ keys: [{ u: 0 }, { u: 1 }] }), ['rig.custom', {}]);
  assert.deepEqual(SHOT.rigLabel('none'), ['rig.none', {}]);
  const STRINGS = MV.use('i18n/strings');
  for (const key of SHOT.SHOT_KEYS) assert.ok(('shot.' + key) in STRINGS && ('shot.blurb.' + key) in STRINGS, key);
  for (const key of SHOT.RIG_KEYS) assert.ok(('rig.' + key) in STRINGS, key);
  assert.equal(CV.isCurve(SHOT.SHOTS.snapZoom.keys[2].curve), true);
  assert.ok(TEXT_AIMS.every((a) => SHOT.coerceShot({ keys: [{ at: 'a', aim: a }, { at: 'b', aim: a }] })));
});
