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

// --- EXTREME (DESIGN_EXTREME §1.1, §1.2, §1.7) -------------------------------------------------------------------------

test('XSHOTS: the twelve presets in canonical form (x: 1, tags, sorted keys, defaults omitted, frozen)', () => {
  assert.deepEqual(SHOT.XSHOT_KEYS, ['beatCrash', 'crashZoom', 'dutchSwing', 'jumpRead', 'orbit', 'punchHit', 'shakeHits', 'spinIn',
    'spinOut', 'vertigo', 'whipPan', 'whipRead']);
  for (const key of SHOT.XSHOT_KEYS) {
    const p = SHOT.XSHOTS[key];
    assert.ok(Object.isFrozen(p) && p.keys.every(Object.isFrozen), key + ' frozen');
    assert.equal(p.x, 1, key);
    assert.ok(p.keys.length >= 2 && p.keys.length <= 6, key);
    assert.ok(p.tags.length >= 1 && p.tags.every((t) => MV.use('core/schema').TAGS.includes(t)), key + ' tags');
    const { tags, ...shot } = p;
    assert.deepEqual(SHOT.coerceShot(shot), shot, key + ' is canonical');
    assert.equal(JSON.stringify(SHOT.coerceShot(shot)), H.canonical(shot), key + ' sorted');
    assert.equal(SHOT.SHOTS[key], undefined, 'not in the normal table');
    assert.ok(!SHOT.SHOT_KEYS.includes(key), 'not in the normal pool');
  }
  assert.deepEqual(SHOT.XSHOTS.crashZoom.keys.map((k) => k.at), ['a', 'accent', 'accent', 'accentEnd', 'accentEnd', 'b']);
  // (the values of the phase F tuning, docs/NOTES.md "カメラ EXTREME")
  assert.deepEqual(SHOT.XSHOTS.crashZoom.keys[2], { aim: 'emph', at: 'accent', curve: 'dashStop', dt: 0.05, fill: 0.9, hit: 1 });
  assert.deepEqual(SHOT.XSHOTS.dutchSwing.beat, { roll: 18, zoom: 0.08 }, 'every 1 is the default');
  assert.equal(SHOT.XSHOTS.dutchSwing.blur, 0.6);
  assert.equal(SHOT.XSHOTS.whipPan.blur, undefined, 'blur 1 is the default');
  assert.deepEqual(SHOT.XSHOTS.shakeHits.beat, { shake: 1, zoom: 0.06 });
  assert.deepEqual(SHOT.XSHOTS.beatCrash.beat, { zoom: 0.2 });
  assert.deepEqual(SHOT.XSHOTS.spinIn.keys[0], { aim: 'block', at: 'a', fill: 0.45, roll: -180 });
  assert.deepEqual(SHOT.XSHOTS.vertigo.keys.map((k) => [k.fill, k.gz]), [[0.72, undefined], [0.56, 1.6]], 'gz 1 omitted; the words pull back');
  assert.deepEqual(SHOT.XSHOTS.jumpRead.keys.filter((k) => k.aim === 'reading').map((k) => k.hop), [0, 0], 'hop 0 kept');
  assert.deepEqual(SHOT.XSHOTS.whipRead.keys[1], { aim: 'reading', at: 'sung', fill: 0.8, hop: 0.12, whip: 0.3 });
  assert.deepEqual(SHOT.MIRRORS, ['dutchSwing', 'orbit', 'spinIn', 'spinOut', 'whipPan']);
});

test('coerceShot: x-keys (with "~m") and x-objects by XLIMITS; every non-x value exactly as before', () => {
  for (const key of SHOT.XSHOT_KEYS) {
    assert.equal(SHOT.coerceShot(key), key);
    assert.equal(SHOT.coerceShot(key + '~m'), key + '~m');
  }
  for (const bad of ['settle~m', 'none~m', 'crashZoom~x', '~m', 'CrashZoom']) assert.equal(SHOT.coerceShot(bad), undefined, bad);
  const v = SHOT.coerceShot({ x: 1, blur: 1, follow: 0, beat: { zoom: 0.5, roll: 30, shake: -1, every: 3 }, keys: [
    { at: 'accent', aim: 'block', fill: 1.1, roll: 720, ox: 0.9, hit: 0, gz: 1, hop: 0.1, whip: 0.2 },
    { at: 'accentEnd', aim: 'reading', fill: 0.05, hop: 0, whip: 0.9, gz: 2, hit: 2 },
    { at: 'b', aim: 'frame', zoom: 1.2, gz: 1.2, hop: 0.1 },
    { at: 'mid', aim: 'point', px: 0.2, gz: 1.3, oy: -0.7 },
  ] });
  assert.deepEqual(v, { beat: { every: 4, roll: 20, zoom: 0.25 }, keys: [
    { aim: 'block', at: 'accent', fill: 0.95, ox: 0.6, roll: 360 },
    { aim: 'reading', at: 'accentEnd', fill: 0.1, gz: 1.6, hit: 1, hop: 0, whip: 0.4 },
    { aim: 'frame', at: 'b', gz: 1.2, zoom: 1.2 },
    { aim: 'point', at: 'mid', oy: -0.6, px: 0.2 },
  ], x: 1 });
  assert.equal(JSON.stringify(v), H.canonical(v));
  assert.ok(Object.isFrozen(v) && Object.isFrozen(v.keys[0]) && Object.isFrozen(v.beat));
  assert.deepEqual(SHOT.coerceShot(JSON.parse(JSON.stringify(v))), v, 'round trip');
  assert.deepEqual(SHOT.coerceShot({ x: 1, keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'block' }], beat: { every: 1 }, blur: 0.4 }),
    { blur: 0.4, keys: [{ aim: 'block', at: 'a' }, { aim: 'block', at: 'b' }], x: 1 }, 'an empty beat is omitted');
  assert.equal(SHOT.coerceShot({ x: 1, keys: [{ at: 'a', aim: 'block' }] }), undefined, '< 2 keys');
  // non-x values: accent anchors and x fields are not read; roll 30 still clamps to 15; x other than 1 is a normal shot
  assert.deepEqual(SHOT.coerceShot({ keys: [{ at: 'a', aim: 'block', roll: 30, hit: 1, gz: 1.2 }, { at: 'b', aim: 'block', ox: 0.9 }] }),
    { keys: [{ aim: 'block', at: 'a', roll: 15 }, { aim: 'block', at: 'b', ox: 0.4 }] });
  assert.deepEqual(SHOT.coerceShot({ x: 0, keys: [{ at: 'a', aim: 'block', fill: 1.1 }, { at: 'b', aim: 'block' }] }),
    { keys: [{ aim: 'block', at: 'a', fill: 1.1 }, { aim: 'block', at: 'b' }] });
  assert.deepEqual(SHOT.coerceShot({ x: true, keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'block' }] }),
    { keys: [{ aim: 'block', at: 'a' }, { aim: 'block', at: 'b' }] }, 'only x === 1 is EXTREME');
  assert.equal(SHOT.coerceShot({ keys: [{ at: 'accent', aim: 'block' }, { at: 'b', aim: 'block' }] }), undefined, 'accent is x only');
  assert.deepEqual(SHOT.LIMITS.roll, [-15, 15]);
  assert.deepEqual(SHOT.LIMITS.fill, [0.1, 1.2]);
  assert.deepEqual([SHOT.XLIMITS.roll, SHOT.XLIMITS.fill, SHOT.XLIMITS.ox, SHOT.XLIMITS.gz], [[-360, 360], [0.1, 0.95], [-0.6, 0.6], [1, 1.6]]);
  assert.deepEqual(SHOT.XLIMITS.mods, { zoom: [0, 0.25], roll: [0, 20], shake: [0, 1], every: [1, 2, 4] });
  assert.deepEqual(SHOT.XLIMITS.rig, SHOT.LIMITS.rig, 'rig limits unchanged');
});

test('isExtreme, limitsOf, presetOf, xKeyOf', () => {
  assert.equal(SHOT.isExtreme('crashZoom'), true);
  assert.equal(SHOT.isExtreme('whipPan~m'), true);
  assert.equal(SHOT.isExtreme({ x: 1, keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'block' }] }), true);
  for (const v of ['settle', 'none', undefined, null, 3, { keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'block' }] }, { x: 1, keys: [] }]) {
    assert.equal(SHOT.isExtreme(v), false, JSON.stringify(v));
  }
  assert.equal(SHOT.limitsOf('spinIn'), SHOT.XLIMITS);
  assert.equal(SHOT.limitsOf('settle'), SHOT.LIMITS);
  assert.equal(SHOT.limitsOf({ keys: [] }), SHOT.LIMITS);
  assert.equal(SHOT.presetOf('settle'), SHOT.SHOTS.settle);
  assert.equal(SHOT.presetOf('orbit'), SHOT.XSHOTS.orbit);
  const m = SHOT.presetOf('orbit~m');
  assert.deepEqual(m.keys.map((k) => [k.ox, k.roll]), [[0.16, 24], [0, undefined], [-0.16, -24]], 'mirrored: ox and roll negated');
  assert.equal(SHOT.presetOf('orbit~m'), m, 'one frozen record');
  assert.deepEqual(m.tags, SHOT.XSHOTS.orbit.tags);
  for (const v of ['none', 'nope', { x: 1 }]) assert.equal(SHOT.presetOf(v), null);
  assert.deepEqual(SHOT.xKeyOf('spinOut~m'), { key: 'spinOut', m: true });
  assert.deepEqual(SHOT.xKeyOf('spinOut'), { key: 'spinOut', m: false });
  assert.equal(SHOT.xKeyOf('settle'), null);
});

function deepEqualClose(a, b) {
  assert.equal(JSON.stringify(a, (k, v) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v)),
    JSON.stringify(b, (k, v) => (typeof v === 'number' ? Math.round(v * 1e9) / 1e9 : v)));
}

test('expandShot of an x-ref: mirror, intensity g on roll/hit/gz−1/whip/beat, fills × cam.zoom within XLIMITS, carry ignored', () => {
  const e = SHOT.expandShot('whipPan~m', { g: 0.5, zoom: 2, curve: 'linear', carry: { fill: 0.3, roll: 5 } });
  assert.equal(e.x, 1);
  assert.equal(e.m, -1);
  assert.equal(e.g, 0.5);
  // an offset beyond X_AWAY (a whip: the words leave the frame) keeps X_AWAY and scales its excess by g (phase F)
  assert.deepEqual(e.keys.map((k) => k.ox), [-0.375, undefined, undefined, 0.375], 'mirrored; 0.25 + (0.5 − 0.25)·g');
  assert.deepEqual(SHOT.expandShot('whipPan', { g: 1 }).keys.map((k) => k.ox), [0.5, undefined, undefined, -0.5], 'at 最大 the preset');
  assert.deepEqual(e.keys.map((k) => k.fill), [0.95, 0.95, 0.95, 0.95], 'fill · zoom clamped to 0.95');
  // a fill moves toward X_FILL_MID by g; an offset within X_AWAY scales by g
  const c = SHOT.expandShot('crashZoom', { g: 0.5 });
  approx(c.keys.map((k) => k.fill), [0.54, 0.54, 0.76, 0.76, 0.64, 0.66], 1e-12);
  deepEqualClose(SHOT.expandShot('orbit', { g: 0.5 }).keys.map((k) => [k.ox, k.oy]), [[-0.08, 0.02], [0, -0.02], [0.08, 0.02]]);
  deepEqualClose(SHOT.expandShot('crashZoom', { g: 1 }).keys.map((k) => k.fill), SHOT.XSHOTS.crashZoom.keys.map((k) => k.fill));
  assert.deepEqual(e.keys.map((k) => k.curve), ['linear', 'dashStop', 'linear', 'slowBloom']);
  assert.equal(e.blur, 1);
  const d = SHOT.expandShot('dutchSwing', { g: 0.5 });
  assert.deepEqual(d.keys.map((k) => k.roll), [-7, 7]);
  assert.deepEqual(d.beat, { zoom: 0.04, roll: 9, shake: 0, every: 1 });
  assert.equal(d.blur, 0.6);
  const v = SHOT.expandShot('vertigo', { g: 0.5 });
  approx(v.keys.map((k) => k.gz), [1, 1.3], 1e-12);
  const w = SHOT.expandShot('whipRead', {});
  assert.equal(w.g, 1, 'no g → 1');
  assert.deepEqual(w.keys.map((k) => [k.hop, k.whip]), [[null, 0], [0.12, 0.3], [null, 0]]);
  const p = SHOT.expandShot('punchHit', { g: 0.3 });
  approx(p.keys[2].hit, 0.3, 1e-12);
  assert.equal(SHOT.expandShot('spinIn', { follow: 0.4 }).follow, 0.4);
  assert.ok(Object.isFrozen(e.keys[0]) && Object.isFrozen(e.beat));
  // the intensity of a cam.extreme value: max(0.3, v), 1 without a decision
  assert.deepEqual([SHOT.xIntensity(null), SHOT.xIntensity(undefined), SHOT.xIntensity(0), SHOT.xIntensity(0.5), SHOT.xIntensity(2)],
    [1, 1, 0.3, 0.5, 1]);
  // a normal ref expands exactly as before
  assert.deepEqual(SHOT.expandShot('settle', { g: 0.3 }), SHOT.expandShot('settle'));
});

test('lastFraming of an x-ref is null (no carry reaches or leaves an EXTREME cut); usesBeats; maxFill; labels', () => {
  for (const key of SHOT.XSHOT_KEYS) {
    assert.equal(SHOT.lastFraming(key), null, key);
    assert.equal(SHOT.lastFraming(key + '~m'), null, key);
    assert.equal(SHOT.usesBeats(key), true, key);
    assert.deepEqual(SHOT.label(key), ['shot.' + key, {}]);
    assert.deepEqual(SHOT.label(key + '~m'), ['shot.' + key, {}]);
  }
  for (const key of SHOT.SHOT_KEYS) assert.equal(SHOT.usesBeats(key), false, key);
  assert.equal(SHOT.lastFraming({ x: 1, keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'block', fill: 0.8 }] }), null);
  assert.equal(SHOT.maxFill('crashZoom'), 0.9);
  assert.equal(SHOT.maxFill('vertigo~m'), 0.72);
  assert.deepEqual(SHOT.label({ x: 1, keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'block' }] }), ['shot.custom', { n: 2 }]);
  const STRINGS = MV.use('i18n/strings');
  for (const key of SHOT.XSHOT_KEYS) assert.ok(('shot.' + key) in STRINGS && ('shot.blurb.' + key) in STRINGS, key);
});

test('fromXMove: every move × focus × timing × power × dir gives a canonical x-shot of 2–6 keys (§1.7 table)', () => {
  let n = 0;
  for (const move of SHOT.XMOVES) {
    for (const focus of SHOT.FOCI) {
      for (const timing of SHOT.TIMINGS) {
        for (const power of [-1, 0, 0.3, 0.65, 1, 3]) {
          for (const dir of SHOT.DIRS.concat(['sideways'])) {
            const ref = SHOT.fromXMove({ move, focus, timing, fill: 0.8, power, dir });
            assert.ok(ref && ref.x === 1, [move, focus, timing, power, dir].join(' '));
            assert.deepEqual(SHOT.coerceShot(ref), ref, 'canonical');
            assert.ok(ref.keys.length >= 2 && ref.keys.length <= 6);
            assert.ok(SHOT.isExtreme(ref));
            n++;
          }
        }
      }
    }
  }
  assert.equal(n, SHOT.XMOVES.length * 5 * 4 * 6 * 4);
  assert.deepEqual(SHOT.XMOVES, ['crash', 'dutch', 'jump', 'orbit', 'pulse', 'shake', 'spin', 'vertigo', 'whip']);
  assert.equal(SHOT.fromXMove({ move: 'pushIn' }), undefined, 'a normal move is not an extreme one');
  assert.equal(SHOT.fromXMove(null), undefined);
  // crash: emphasis keeps accent, hit = .5 + .5p, the crash fill is f1
  const crash = SHOT.fromXMove({ move: 'crash', focus: 'emphasis', fill: 0.8, power: 1 });
  assert.deepEqual(crash.keys[2], { aim: 'emph', at: 'accent', curve: 'dashStop', dt: 0.05, fill: 0.8, hit: 1 });
  assert.deepEqual(SHOT.fromXMove({ move: 'crash', focus: 'text' }).keys.map((k) => k.at), ['a', 'beat:0', 'beat:0', 'end', 'end', 'b']);
  assert.deepEqual(SHOT.fromXMove({ move: 'crash', focus: 'first' }).keys.map((k) => k.at).slice(1, 5), ['sung', 'sung', 'word:1', 'word:1']);
  // whip: ox = ±(.3 + .3p) by dir; arrive → in only; depart → out only; hold → whipRead
  const whip = (timing, dir) => SHOT.fromXMove({ move: 'whip', timing, power: 0.5, dir });
  assert.deepEqual(whip('whole', 'left').keys.map((k) => k.ox), [0.45, undefined, undefined, -0.45]);
  assert.deepEqual(whip('whole', 'right').keys.map((k) => k.ox), [-0.45, undefined, undefined, 0.45]);
  assert.deepEqual(whip('whole', 'auto'), whip('whole', 'left'));
  assert.equal(whip('arrive').keys.length, 3);
  assert.equal(whip('depart').keys[0].ox, undefined);
  approx(whip('hold').keys[1].whip, 0.275, 1e-12);
  // spin: arrive → roll −(90 + 270p); depart → 360p
  approx(SHOT.fromXMove({ move: 'spin', timing: 'arrive', power: 1 }).keys[0].roll, -360, 1e-12);
  approx(SHOT.fromXMove({ move: 'spin', timing: 'depart', power: 0.5 }).keys[2].roll, 180, 1e-12);
  const dutch = SHOT.fromXMove({ move: 'dutch', power: 0.5 });
  assert.deepEqual([dutch.keys[0].roll, dutch.beat.roll], [-11, 14]);
  approx(dutch.beat.zoom, 0.055, 1e-12);
  assert.deepEqual(SHOT.fromXMove({ move: 'shake', power: 0.6 }).beat, { shake: 0.6, zoom: 0.06 });
  const vertigo = SHOT.fromXMove({ move: 'vertigo', power: 1, fill: 0.8 });
  assert.deepEqual(vertigo.keys.map((k) => [k.fill, k.gz]), [[0.8, undefined], [0.55, 1.6]], 'the words pull back, the ground swells');
  approx(SHOT.fromXMove({ move: 'pulse', power: 1 }).beat.zoom, 0.22, 1e-12);
  approx(SHOT.fromXMove({ move: 'pulse' }).beat.zoom, 0.08 + 0.14 * 0.8, 1e-12, 'no power → 0.8');
  assert.equal(SHOT.fromXMove({ move: 'jump', timing: 'depart' }).keys.length, 4, 'no jump back to wide');
  assert.equal(SHOT.fromXMove({ move: 'jump' }).keys.length, 5);
});
