/* 文字PVメーカー v2 — original work. Tests for core/curve: canonical values, presets, speed ramps, reversal, labels (DESIGN_2_1 §3.2, §4.1, §7.3). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');

const MV = load();
const CV = MV.use('core/curve');
const E = MV.use('core/ease');
const H = MV.use('core/hash');
const { stream } = MV.use('core/rng');

// Every data form, in canonical form, for the round-trip and property tests.
const SAMPLES = [
  'linear', 'expoOut', 'backInOut', 'softEnds', 'hushRushHush', 'holdThenDash', 'dashStop', 'slowBloom', 'fadeBrake', 'snapSettle',
  { bz: [0.7, 0, 0.2, 1] }, { bz: [0.25, -0.4, 0.5, 1.4] }, { sp: [[0, 1], [0.5, 3], [1, 0.5]] },
  { sp: [[0, 1], [0.4, 1], [0.4, 4], [1, 4]] }, { sp: [[0, 0], [1, 1]] },
  { ramp: { edge: 0.1, ends: 'both', peak: 6 } }, { ramp: { edge: 0.25, ends: 'start', peak: 3 } },
  { ramp: { edge: 0, ends: 'end', peak: 0.5 } },
];

test('coerce: names pass, data becomes canonical (q3, sorted keys, frozen) and round-trips', () => {
  for (const c of SAMPLES) {
    const v = CV.coerce(c);
    assert.notEqual(v, undefined, JSON.stringify(c));
    assert.deepEqual(CV.coerce(v), v, 'idempotent: ' + JSON.stringify(c));
    assert.deepEqual(CV.coerce(JSON.parse(JSON.stringify(v))), v, 'JSON round trip');
    if (typeof v === 'object') {
      assert.ok(Object.isFrozen(v) && Object.values(v).every(Object.isFrozen), 'deep-frozen');
      assert.equal(JSON.stringify(v), H.canonical(v), 'sorted keys at every depth');
    }
  }
  assert.deepEqual(CV.coerce({ bz: [0.70004, 0.0001, 0.19996, 1] }), { bz: [0.7, 0, 0.2, 1] }, 'q3 numbers');
  assert.deepEqual(CV.coerce({ ramp: { peak: 6, ends: 'both', edge: 0.1 } }), { ramp: { edge: 0.1, ends: 'both', peak: 6 } });
  assert.deepEqual(CV.coerce({ bz: [0.6, -0.9, 0.4, 2] }), { bz: [0.6, -0.5, 0.4, 1.5] }, 'Bézier y is clamped');
  assert.deepEqual(CV.coerce({ sp: [[0, -1], [1, 9]] }), { sp: [[0, 0], [1, 8]] }, 'speeds are clamped to [0, 8]');
  assert.deepEqual(CV.coerce({ ramp: { edge: 0.9, ends: 'start', peak: 20 } }), { ramp: { edge: 0.4, ends: 'start', peak: 8 } });
  assert.equal(CV.isCurve('holdThenDash'), true);
  assert.equal(CV.isCurve('hold'), false);
});

test('coerce rejects what it cannot read', () => {
  const nine = Array.from({ length: 9 }, (_, i) => [i / 8, 1]);
  const bad = [
    { sp: nine },                                  // 9 knots
    { sp: [[0, 0], [0.5, 0], [1, 0]] },            // all-zero speed
    { sp: [[0, 1], [0.6, 1], [0.4, 1], [1, 1]] },  // u out of order
    { sp: [[0, 1], [0.5, 1], [0.5, 2], [0.5, 3], [1, 1]] },  // three equal u in a row
    { sp: [[0.1, 1], [1, 1]] }, { sp: [[0, 1], [0.9, 1]] }, { sp: [[0, 1]] }, { sp: [[0, 1], [1, 'x']] },
    { bz: [1.2, 0, 0.4, 1] }, { bz: [0.2, 0, -0.1, 1] }, { bz: [0.2, 0, 0.4] }, { bz: ['0.2', 0, 0.4, 1] }, // bad bz x, shape
    { ramp: { edge: 0.1, ends: 'middle', peak: 2 } }, { ramp: { edge: 0.1, ends: 'both' } },
    { bz: [0.2, 0, 0.4, 1], sp: [[0, 1], [1, 1]] }, { curve: 'linear' }, 'hold', '', null, undefined, 3, [], {},
    { bz: [NaN, 0, 0.4, 1] }, { sp: [[0, Infinity], [1, 1]] },
  ];
  for (const c of bad) assert.equal(CV.coerce(c), undefined, JSON.stringify(c));
  assert.equal(CV.fn({ sp: nine })(0.3), 0.3, 'an unreadable value evaluates as linear');
  assert.equal(CV.keyOf(null), 'n:linear');
});

test('every preset and ease is pinned: f(0) = 0 and f(1) = 1; the preset data is FROZEN (§4.1 table)', () => {
  for (const c of [...CV.PRESET_KEYS, ...E.EASES]) {
    const f = CV.fn(c);
    assert.equal(f(0), 0, c);
    assert.equal(f(1), 1, c);
    assert.equal(CV.warp(c)(-1), 0);
    assert.equal(CV.warp(c)(2), 1);
  }
  assert.deepEqual(CV.PRESETS.hushRushHush, { sp: [[0, 0.15], [0.12, 0.3], [0.22, 1.9], [0.78, 1.9], [0.88, 0.3], [1, 0.15]] });
  assert.deepEqual(CV.PRESETS.snapSettle, { bz: [0.2, 0.9, 0.25, 1.15] });
  assert.deepEqual(CV.expand('softEnds'), { bz: [0.6, 0, 0.4, 1] });
  assert.equal(CV.expand('expoOut'), 'expoOut');
  // the profiles the table promises
  approx(CV.fn('hushRushHush')(0.22), 0.1024, 1e-3);                 // 10 % of the way by 22 % of the time
  approx(CV.fn('hushRushHush')(0.78) - CV.fn('hushRushHush')(0.22), 0.795, 1e-3);   // the middle covers 80 %
  assert.ok(CV.fn('holdThenDash')(0.28) < 0.012, '1 % of the way by 28 %');
  approx(CV.fn('dashStop')(0.86), 0.954, 1e-3);                      // 95 % of the way by 86 %
  assert.ok(Math.max(...CV.sample('snapSettle', 200)) > 1, 'snapSettle overshoots');
  assert.equal(Math.max(...Array.from({ length: 201 }, (_, i) => CV.warp('snapSettle')(i / 200))), 1, 'its warp is clamped');
});

test('speed ramps are monotone, equal the integral of their speed (1e-9), and the ramp checks of §4.1 hold', () => {
  const rng = stream('curve-sp');
  const curves = SAMPLES.filter((c) => typeof c === 'object' && !c.bz).concat(['hushRushHush', 'holdThenDash', 'dashStop', 'slowBloom',
    'fadeBrake']);
  for (let i = 0; i < 40; i++) {
    const n = rng.int(2, 8);
    const us = [0].concat(Array.from({ length: n - 2 }, () => rng.next()).sort((a, b) => a - b), [1]);
    curves.push({ sp: us.map((u) => [u, rng.range(0, 8)]) });
    curves.push({ ramp: { edge: rng.range(0, 0.4), ends: rng.pick(CV.RAMP_ENDS), peak: rng.range(0.125, 8) } });
  }
  for (const c of curves) {
    const v = CV.coerce(c);
    if (v === undefined) continue;
    const f = CV.fn(v);
    let prev = 0;
    for (let k = 0; k <= 1000; k++) {
      const y = f(k / 1000);
      assert.ok(y >= prev - 1e-12, 'monotone: ' + CV.keyOf(v) + ' at ' + k);
      prev = y;
    }
    // Simpson's rule over speedAt (exact for piecewise-linear speeds) against f.
    const steps = 4000;
    let acc = 0;
    for (let k = 0; k < steps; k++) {
      const a = k / steps, b = (k + 1) / steps, m = (a + b) / 2;
      acc += (b - a) / 6 * (CV.speedAt(v, a + 1e-15) + 4 * CV.speedAt(v, m) + CV.speedAt(v, b - 1e-15));
      if ((k + 1) % 400 === 0) approx(f(b), acc, 1e-9);
    }
  }
  const ramp = { ramp: { edge: 0.1, ends: 'both', peak: 6 } };
  approx(CV.fn(ramp)(0.1), 0.0213, 1e-4);
  approx(CV.fn(ramp)(0.84) - CV.fn(ramp)(0.16), 0.868, 1e-3);
  assert.deepEqual(CV.expand(ramp), { sp: [[0, 1], [0.1, 1], [0.16, 6], [0.84, 6], [0.9, 1], [1, 1]] });
  assert.deepEqual(CV.expand({ ramp: { edge: 0, ends: 'both', peak: 2 } }), { sp: [[0, 1], [0.06, 2], [0.94, 2], [1, 1]] },
    'knots equal to the previous one are dropped');
  assert.ok(CV.fn({ ramp: { edge: 0.1, ends: 'both', peak: 0.5 } })(0.1) > 0.1, 'peak < 1: fast ends, slow middle');
});

test('jump knots change the speed, never the position', () => {
  const c = { sp: [[0, 1], [0.5, 1], [0.5, 3], [1, 3]] };
  const f = CV.fn(c);
  approx(f(0.5 - 1e-9), f(0.5), 1e-8);
  approx(f(0.5), 0.5 / 2, 1e-12);                   // area 0.5 of 2
  approx(CV.speedAt(c, 0.25), 0.5, 1e-12);
  approx(CV.speedAt(c, 0.75), 1.5, 1e-12);
});

test('Béziers are core/ease.bezier; isLinear; keyOf is stable under key order', () => {
  const rng = stream('curve-bz');
  for (let i = 0; i < 20; i++) {
    const bz = [rng.next(), rng.range(-0.5, 1.5), rng.next(), rng.range(-0.5, 1.5)].map((x) => Math.round(x * 1000) / 1000);
    const f = CV.fn({ bz }), g = E.bezier(...bz);
    for (let k = 0; k <= 50; k++) assert.equal(f(k / 50), g(k / 50));
  }
  for (const c of ['linear', { bz: [0.3, 0.3, 0.8, 0.8] }, { sp: [[0, 2], [0.5, 2], [1, 2]] }, { ramp: { edge: 0.2, ends: 'start', peak: 1 } }]) {
    assert.equal(CV.isLinear(c), true, JSON.stringify(c));
    assert.equal(CV.compile(c).linear, true);
    approx(CV.fn(c)(0.37), 0.37, 1e-6);
  }
  for (const c of ['expoOut', 'softEnds', { bz: [0.3, 0.2, 0.8, 0.8] }, { sp: [[0, 1], [1, 2]] }, { ramp: { edge: 0.2, ends: 'start', peak: 2 } }]) {
    assert.equal(CV.isLinear(c), false, JSON.stringify(c));
  }
  assert.equal(CV.keyOf({ ramp: { peak: 6, edge: 0.1, ends: 'both' } }), 'rp:both,0.1,6');
  assert.equal(CV.keyOf({ ramp: { ends: 'both', edge: 0.1, peak: 6 } }), 'rp:both,0.1,6');
  assert.equal(CV.keyOf('expoOut'), 'n:expoOut');
  assert.equal(CV.keyOf({ bz: [0.6, 0, 0.4, 1] }), 'bz:0.6,0,0.4,1');
  assert.equal(CV.keyOf({ sp: [[0, 0.15], [0.12, 0.3], [1, 0.2]] }), 'sp:0,0.15;0.12,0.3;1,0.2');
  assert.equal(CV.compile('expoOut'), CV.compile('expoOut'), 'memoized');
  assert.equal(CV.compile({ bz: [0.1, 0, 0.2, 1] }).key, 'bz:0.1,0,0.2,1');
});

test('reverse: g(u) = 1 − f(1 − u) on 1k samples; reverse(reverse(c)) ≡ c; the named pairs', () => {
  // elasticOut, springOut and bounceOut have no In form in the frozen EASES list, and steps is not symmetric (NOTES WP0a).
  const approximate = new Set(['elasticOut', 'springOut', 'bounceOut', 'steps']);
  const all = SAMPLES.concat(E.EASES.filter((e) => !approximate.has(e)));
  for (const c of all) {
    const f = CV.fn(c), g = CV.fn(CV.reverse(c));
    for (let k = 0; k <= 1000; k++) {
      const u = k / 1000;
      approx(g(u), 1 - f(1 - u), 2e-6, JSON.stringify(c) + ' at ' + u);
    }
    const back = CV.fn(CV.reverse(CV.reverse(c)));
    for (let k = 0; k <= 100; k++) approx(back(k / 100), f(k / 100), 2e-6);
    assert.equal(CV.keyOf(CV.expand(CV.reverse(CV.reverse(c)))), CV.keyOf(CV.expand(c)), 'same data: ' + JSON.stringify(c));
  }
  assert.equal(CV.reverse('slowBloom'), 'fadeBrake');
  assert.equal(CV.reverse('fadeBrake'), 'slowBloom');
  assert.equal(CV.reverse('softEnds'), 'softEnds');
  assert.equal(CV.reverse('hushRushHush'), 'hushRushHush');
  assert.equal(CV.reverse('expoOut'), 'expoIn');
  assert.deepEqual(CV.reverse('holdThenDash'), { sp: [[0, 0], [0.2, 1.1], [0.66, 2.4], [0.72, 0.08], [1, 0]] });
  assert.deepEqual(CV.reverse({ bz: [0.7, 0, 0.2, 1] }), { bz: [0.8, 0, 0.3, 1] });
  assert.deepEqual(CV.reverse({ ramp: { edge: 0.1, ends: 'start', peak: 4 } }), { ramp: { edge: 0.1, ends: 'end', peak: 4 } });
  assert.equal(CV.reverse('nonsense'), 'linear');
});

test('sample, speedAt and label', () => {
  const s = CV.sample('softEnds', 8);
  assert.ok(s instanceof Float32Array);
  assert.equal(s.length, 9);
  assert.equal(s[0], 0);
  assert.equal(s[8], 1);
  approx(CV.speedAt('linear', 0.5), 1, 1e-6);
  approx(CV.speedAt('quadIn', 0.5), 1, 1e-6);
  approx(CV.speedAt('slowBloom', 0), 0.08 / 1.04, 1e-12);
  assert.deepEqual(CV.label('hushRushHush'), ['curve.hushRushHush', {}]);
  assert.deepEqual(CV.label('expoOut'), ['opt.ease', { family: 'opt.ease.expo', dir: 'opt.easeDir.Out' }]);
  assert.deepEqual(CV.label('sineInOut'), ['opt.ease', { family: 'opt.ease.sine', dir: 'opt.easeDir.InOut' }]);
  assert.deepEqual(CV.label('linear'), ['opt.ease.linear', {}]);
  assert.deepEqual(CV.label('steps'), ['opt.ease.steps', {}]);
  assert.deepEqual(CV.label({ bz: [0.7, 0, 0.2, 1] }), ['curve.bz', {}]);
  assert.deepEqual(CV.label({ sp: [[0, 1], [0.5, 3], [1, 0.5]] }), ['curve.sp', { n: 3 }]);
  assert.deepEqual(CV.label({ ramp: { edge: 0.1, ends: 'both', peak: 6 } }), ['curve.ramp.both', { peak: 6 }]);
  assert.deepEqual(CV.label('wobble'), ['opt.ease.linear', {}]);
  const STRINGS = MV.use('i18n/strings');
  for (const c of SAMPLES.concat(E.EASES)) {
    const [key, params] = CV.label(c);
    assert.ok(key in STRINGS, key);
    for (const v of Object.values(params)) if (typeof v === 'string') assert.ok(v in STRINGS, v);
  }
});

test('golden: 10k samples of each preset hash to fixed values (q9)', () => {
  const GOLDEN = { dashStop: '9877eea2', fadeBrake: '8a9b17b7', holdThenDash: 'e5957c15', hushRushHush: '3911bcd8',
    slowBloom: '8861ef43', snapSettle: '518803dc', softEnds: '7f97bda5' };
  for (const key of CV.PRESET_KEYS) {
    const f = CV.fn(key);
    const samples = [];
    for (let i = 0; i <= 10000; i++) samples.push(Math.round(f(i / 10000) * 1e9) / 1e9);
    assert.equal(H.hashJSON(samples), GOLDEN[key], key);
  }
});
