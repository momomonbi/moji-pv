/* 文字PVメーカー v2 — original work. Tests: core/hash vectors and hashJSON, core/rng streams, Gumbel-max sampling. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');

const MV = load();
const H = MV.use('core/hash');
const R = MV.use('core/rng');

// Upper critical values of χ² at p = 0.001, by degrees of freedom.
const CHI2_999 = { 1: 10.83, 3: 16.27, 4: 18.47, 5: 20.52, 7: 24.32, 15: 37.70 };

function chiSquare(counts, expected) {
  return counts.reduce((sum, c, i) => sum + ((c - expected[i]) ** 2) / expected[i], 0);
}

test('hash32: FROZEN test vectors (DESIGN §4.1.1)', () => {
  assert.equal(H.hash32(''), 3192004061);
  assert.equal(H.hash32('a'), 483993982);
  assert.equal(H.hash32('ab', 'c'), 2642534310);
  assert.equal(H.hash32('a', 'bc'), 1379158772);
});

test('hash32: the separator keeps part boundaries; parts are stringified', () => {
  assert.notEqual(H.hash32('ab', 'c'), H.hash32('a', 'bc'));
  assert.notEqual(H.hash32('a', ''), H.hash32('a'));
  assert.notEqual(H.hash32('', 'a'), H.hash32('a'));
  assert.notEqual(H.hash32(), H.hash32(''));
  assert.equal(H.hash32(12, 'x'), H.hash32('12', 'x'));
  assert.equal(H.hash32(null), H.hash32('null'));
  for (const parts of [['cut', 918273645, 'r3~0', 0, 0], ['slot', 5, 'arrive'], ['日本語', '🎵']]) {
    const h = H.hash32(...parts);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  }
});

test('hashJSON: canonical JSON with sorted keys, 8 hex characters', () => {
  assert.equal(H.canonical({ b: 1, a: [1, { d: 2, c: null }], u: undefined, f: () => 1 }),
    '{"a":[1,{"c":null,"d":2}],"b":1}');
  assert.equal(H.canonical([undefined, NaN, Infinity, 'x']), '[null,null,null,"x"]');
  assert.equal(H.canonical(new Float32Array([0.5, 2])), '[0.5,2]');
  assert.equal(H.canonical(undefined), 'null');
  const plan = { z: 1, a: { y: [3, 2, 1], x: 'é' } };
  Object.defineProperty(plan, 'env', { value: new Float32Array(4), enumerable: false });
  const same = { a: { x: 'é', y: [3, 2, 1] }, z: 1 };
  assert.match(H.hashJSON(plan), /^[0-9a-f]{8}$/);
  assert.equal(H.hashJSON(plan), H.hashJSON(same));
  assert.equal(H.hashJSON(plan), H.hash32(H.canonical(same)).toString(16).padStart(8, '0'));
  assert.notEqual(H.hashJSON({ a: [1, 2] }), H.hashJSON({ a: [2, 1] }));
  assert.equal(H.hashJSON({ a: 1, b: undefined }), H.hashJSON({ a: 1 }));
});

test('gen: FROZEN test vector (DESIGN §4.1.2)', () => {
  const g = R.gen(1);
  assert.equal(g(), 0.3678755429573357);
  assert.equal(g(), 0.08161311969161034);
  assert.equal(g(), 0.8205357783008367);
});

test('Stream.next is exactly gen() for any seed', () => {
  for (const seed of [0, 1, 42, 0xffffffff, 918273645, -5, 2 ** 32 + 7]) {
    const g = R.gen(seed), s = R.fromSeed(seed);
    assert.equal(s.seed, seed >>> 0);
    for (let i = 0; i < 1000; i++) assert.equal(s.next(), g());
  }
});

test('stream(...labels) is seeded by hash32(...labels) and is deterministic', () => {
  const a = R.stream('slot', 12345, 'arrive', 0, 0), b = R.stream('slot', 12345, 'arrive', 0, 0);
  assert.equal(a.seed, H.hash32('slot', 12345, 'arrive', 0, 0));
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
  const c = R.stream('slot', 12345, 'arrive', 0, 1);
  assert.notEqual(R.stream('slot', 12345, 'arrive', 0, 0).next(), c.next());
});

test('streams: uniform values and independent neighbouring labels', () => {
  const n = 100000, buckets = new Array(16).fill(0);
  const s = R.stream('uniform');
  let sum = 0, sq = 0;
  for (let i = 0; i < n; i++) {
    const v = s.next();
    assert.ok(v >= 0 && v < 1);
    buckets[Math.floor(v * 16)]++;
    sum += v; sq += v * v;
  }
  approx(sum / n, 0.5, 0.005);
  approx(sq / n - (sum / n) ** 2, 1 / 12, 0.002);
  assert.ok(chiSquare(buckets, new Array(16).fill(n / 16)) < CHI2_999[15]);

  // First draws of streams whose labels differ only in the last part (as cut/slot seeds do) are uncorrelated.
  const m = 20000, xs = [], ys = [];
  for (let i = 0; i < m; i++) {
    xs.push(R.stream('cut', 7, 'r' + i.toString(36) + '~0').next());
    ys.push(R.stream('cut', 7, 'r' + (i + 1).toString(36) + '~0').next());
  }
  const mx = xs.reduce((p, v) => p + v, 0) / m, my = ys.reduce((p, v) => p + v, 0) / m;
  let cov = 0, vx = 0, vy = 0;
  for (let i = 0; i < m; i++) { cov += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; vy += (ys[i] - my) ** 2; }
  assert.ok(Math.abs(cov / Math.sqrt(vx * vy)) < 0.03);
});

test('fork does not advance its parent and equals stream(seed, ...labels)', () => {
  const a = R.stream('parent'), b = R.stream('parent');
  a.next(); b.next();
  const child = a.fork('build', 'inkRise');
  assert.equal(a.next(), b.next());
  assert.equal(child.seed, R.stream(b.seed, 'build', 'inkRise').seed);
  assert.equal(child.next(), R.stream(b.seed, 'build', 'inkRise').next());
});

test('range, int, chance, pick', () => {
  const s = R.stream('helpers');
  const seen = new Set();
  for (let i = 0; i < 5000; i++) {
    const r = s.range(-2, 3);
    assert.ok(r >= -2 && r < 3);
    const k = s.int(1, 6);
    assert.ok(Number.isInteger(k) && k >= 1 && k <= 6);
    seen.add(k);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6], 'int is inclusive at both ends');
  assert.equal(s.chance(0), false);
  assert.equal(s.chance(1), true);
  const picked = new Set();
  for (let i = 0; i < 200; i++) picked.add(s.pick(['a', 'b', 'c']));
  assert.equal(picked.size, 3);
  const t = R.stream('x'), u = R.stream('x');
  assert.equal(t.pick([]), undefined);
  u.next();
  assert.equal(t.next(), u.next(), 'pick on an empty array still advances once');
});

test('weighted: frequencies follow the weights and each call advances once', () => {
  const s = R.stream('weighted');
  const counts = [0, 0, 0, 0], n = 40000;
  for (let i = 0; i < n; i++) counts[['a', 'b', 'c', 'd'].indexOf(s.weighted(['a', 'b', 'c', 'd'], [1, 0, 3, 4]))]++;
  assert.equal(counts[1], 0, 'zero weight is never picked');
  assert.ok(chiSquare([counts[0], counts[2], counts[3]], [n / 8, n * 3 / 8, n / 2]) < CHI2_999[3]);
  const all = new Set();
  for (let i = 0; i < 300; i++) all.add(s.weighted(['x', 'y', 'z'], [0, 0, 0]));
  assert.equal(all.size, 3, 'all-zero weights fall back to uniform');
  const a = R.stream('w1'), b = R.stream('w1');
  a.weighted([1, 2], [-1, NaN]);
  b.next();
  assert.equal(a.next(), b.next());
});

test('shuffle returns a new permutation; floats fills a Float32Array', () => {
  const src = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
  const a = R.stream('shuffle').shuffle(src), b = R.stream('shuffle').shuffle(src);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), [...src]);
  assert.notDeepEqual(a, [...src]);
  const f = R.stream('floats').floats(5), g = R.stream('floats');
  assert.ok(f instanceof Float32Array);
  assert.equal(f.length, 5);
  for (let i = 0; i < 5; i++) assert.equal(f[i], Math.fround(g.next()));
});

test('gumbel: keyed noise, independent of any stream', () => {
  const expected = -Math.log(-Math.log((H.hash32('gumbel', 99, 'inkRise') + 0.5) / 4294967296));
  assert.equal(R.gumbel(99, 'inkRise'), expected);
  assert.equal(R.gumbel(99, 'inkRise'), R.gumbel(99, 'inkRise'));
  assert.notEqual(R.gumbel(99, 'inkRise'), R.gumbel(99, 'fogOut'));
  assert.ok(Number.isFinite(R.gumbel(0, '')));
});

test('Gumbel-max sampling frequencies match the weights (χ² over 100k draws)', () => {
  const keys = ['alphaOne', 'betaTwo', 'gammaThree', 'deltaFour', 'epsilonFive'];
  const weights = [1, 2, 3, 4, 0.5];
  const logs = weights.map(Math.log);
  const counts = new Array(keys.length).fill(0), n = 100000;
  for (let seed = 0; seed < n; seed++) {
    let best = -1, bestScore = -Infinity;
    for (let k = 0; k < keys.length; k++) {
      const score = logs[k] + R.gumbel(seed, keys[k]);
      if (score > bestScore) { bestScore = score; best = k; }
    }
    counts[best]++;
  }
  const total = weights.reduce((p, w) => p + w, 0);
  const chi = chiSquare(counts, weights.map((w) => (n * w) / total));
  assert.ok(chi < CHI2_999[4], 'χ² = ' + chi.toFixed(2) + ' counts ' + counts.join(','));
});
