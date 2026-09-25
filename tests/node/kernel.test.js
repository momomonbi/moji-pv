/* 文字PVメーカー v2 — original work. Tests: module kernel (MV.def/use/ids) and the math kernel (num, ease, color, mat, noise). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load, listSources, SRC } = require('../helpers/load.js');
const { approx, throwsCode } = require('../helpers/assert_plus.js');

const KERNEL_SOURCE = fs.readFileSync(path.join(SRC, 'core', 'define.js'), 'utf8');

// A kernel in its own global object, so these tests never touch the shared MV.
function freshKernel(dev) {
  const context = vm.createContext({});
  vm.runInContext(KERNEL_SOURCE, context);
  context.MV.DEV = dev;
  return context.MV;
}

test('MV.def / MV.use: dependencies arrive in order and factories are lazy', () => {
  const K = freshKernel(true);
  const calls = [];
  K.def('core/a', [], () => { calls.push('a'); return { name: 'a' }; });
  K.def('core/b', [], () => { calls.push('b'); return { name: 'b' }; });
  K.def('planner/c', ['core/b', 'core/a'], (b, a) => { calls.push('c'); return { order: [b.name, a.name] }; });
  assert.deepEqual(calls, [], 'no factory runs at definition time');
  assert.deepEqual([...K.use('planner/c').order], ['b', 'a']);
  assert.deepEqual(calls, ['b', 'a', 'c']);
});

test('MV.use runs each factory once and returns the same export', () => {
  const K = freshKernel(true);
  let runs = 0;
  K.def('core/once', [], () => { runs++; return { n: runs }; });
  K.def('core/user1', ['core/once'], (o) => ({ o }));
  K.def('core/user2', ['core/once'], (o) => ({ o }));
  const first = K.use('core/once');
  assert.equal(K.use('core/once'), first);
  assert.equal(K.use('core/user1').o, first);
  assert.equal(K.use('core/user2').o, first);
  assert.equal(runs, 1);
});

test('MV.ids lists sorted ids, optionally by prefix; MV.has', () => {
  const K = freshKernel(true);
  for (const id of ['parts/seam/shapes', 'core/z', 'core/a', 'parts/arrive/soft']) K.def(id, [], () => ({}));
  assert.deepEqual([...K.ids()], ['core/a', 'core/z', 'parts/arrive/soft', 'parts/seam/shapes']);
  assert.deepEqual([...K.ids('parts/')], ['parts/arrive/soft', 'parts/seam/shapes']);
  assert.deepEqual([...K.ids('nothing/')], []);
  assert.equal(K.has('core/a'), true);
  assert.equal(K.has('core/b'), false);
});

test('MV.def rejects bad ids, duplicates and malformed definitions', () => {
  const K = freshKernel(true);
  for (const bad of ['', 'Core/a', 'core//a', 'core/', '/core', 'core/a-b', 'core/a.js', 'core a']) {
    assert.throws(() => K.def(bad, [], () => ({})), /bad module id/, bad);
  }
  K.def('core/dup', [], () => ({}));
  assert.throws(() => K.def('core/dup', [], () => ({})), /duplicate module core\/dup/);
  assert.throws(() => K.def('core/x', 'core/a', () => ({})), /bad definition core\/x/);
  assert.throws(() => K.def('core/y', [], {}), /bad definition core\/y/);
  assert.equal(K.has('core/x'), false);
});

test('MV.use reports missing modules and dependency cycles', () => {
  const K = freshKernel(true);
  assert.throws(() => K.use('core/ghost'), /missing module core\/ghost/);
  K.def('core/needs_ghost', ['core/ghost'], () => ({}));
  assert.throws(() => K.use('core/needs_ghost'), /missing module core\/ghost/);
  K.def('core/p', ['core/q'], () => ({}));
  K.def('core/q', ['core/r'], () => ({}));
  K.def('core/r', ['core/p'], () => ({}));
  assert.throws(() => K.use('core/p'), /dependency cycle at core\/p/);
  K.def('core/self', ['core/self'], () => ({}));
  assert.throws(() => K.use('core/self'), /dependency cycle at core\/self/);
});

test('MV.DEV freezes object exports; shipped pages (DEV false) do not', () => {
  const dev = freshKernel(true);
  dev.def('core/obj', [], () => ({ a: 1 }));
  dev.def('parts/list', [], () => [{ key: 'x' }]);
  dev.def('core/fn', [], () => () => 1);
  assert.ok(Object.isFrozen(dev.use('core/obj')));
  assert.ok(Object.isFrozen(dev.use('parts/list')));
  assert.equal(typeof dev.use('core/fn'), 'function');
  const ship = freshKernel(false);
  ship.def('core/obj', [], () => ({ a: 1 }));
  assert.equal(Object.isFrozen(ship.use('core/obj')), false);
});

test('load() defines every src file on the global MV with DEV and LANG set (DESIGN §2.7)', () => {
  const MV = load();
  assert.equal(globalThis.MV, MV);
  assert.equal(MV.DEV, true);
  assert.equal(MV.LANG, 'ja');
  assert.equal(load(), MV, 'a second load is a no-op');
  const kernel = ['core/color', 'core/ease', 'core/hash', 'core/mat', 'core/motion', 'core/noise', 'core/num',
    'core/paths', 'core/pins', 'core/rng', 'core/schema', 'core/types'];
  for (const id of kernel) {
    assert.ok(MV.has(id), id);
    assert.equal(typeof MV.use(id), 'object', id);
  }
  assert.deepEqual({ ...MV.use('core/types') }, {});
  const files = listSources();
  assert.ok(files.includes('core/define.js'));
  assert.deepEqual(files, [...files].sort(), 'files load in sorted path order');
});

test('kernel files start with the header and hold exactly one MV.def whose id is the path', () => {
  const header = '/* 文字PVメーカー v2 — original work. ';
  const own = ['hash', 'rng', 'noise', 'num', 'ease', 'color', 'mat', 'schema', 'paths', 'pins', 'motion', 'types'];
  assert.ok(KERNEL_SOURCE.startsWith(header));
  for (const name of own) {
    const text = fs.readFileSync(path.join(SRC, 'core', name + '.js'), 'utf8');
    assert.ok(text.startsWith(header), name);
    assert.equal(text.split('MV.def(').length, 2, name);
    assert.match(text, new RegExp("^MV\\.def\\(\\s*'core/" + name + "'\\s*,\\s*\\[", 'm'), name);
  }
});

// ----- core/num --------------------------------------------------------------------------------------------------

test('num: clamp, lerp, invLerp, remap, smooth, fract, wrap, q6, approxEq, constants', () => {
  const N = load().use('core/num');
  assert.equal(N.clamp(-1), 0);
  assert.equal(N.clamp(2), 1);
  assert.equal(N.clamp(5, 0, 3), 3);
  assert.equal(N.clamp(0.25), 0.25);
  assert.equal(N.lerp(10, 20, 0.25), 12.5);
  assert.equal(N.invLerp(10, 20, 12.5), 0.25);
  assert.equal(N.invLerp(3, 3, 7), 0);
  assert.equal(N.remap(5, 0, 10, 100, 200), 150);
  assert.equal(N.smooth(-1), 0);
  assert.equal(N.smooth(2), 1);
  assert.equal(N.smooth(0.5), 0.5);
  assert.equal(N.fract(2.75), 0.75);
  assert.equal(N.fract(-0.25), 0.75);
  assert.equal(N.wrap(370, 0, 360), 10);
  assert.equal(N.wrap(-1, 0, 360), 359);
  assert.equal(N.wrap(5, 2, 2), 2);
  assert.equal(N.wrap(720, 0, 360), 0);
  assert.equal(N.wrap(-1e-20, 0, 360), 0);
  assert.equal(N.q6(0.1 + 0.2), 0.3);
  assert.equal(N.q6(1.23456789), 1.234568);
  assert.ok(N.approxEq(0.1 + 0.2, 0.3));
  assert.ok(!N.approxEq(1, 1.001));
  assert.ok(N.approxEq(1, 1.001, 0.01));
  assert.equal(N.TAU, Math.PI * 2);
  assert.equal(N.DEG, Math.PI / 180);
});

// ----- core/ease -------------------------------------------------------------------------------------------------

test('ease: the FROZEN list; every curve has exact ends and finite values', () => {
  const E = load().use('core/ease');
  assert.deepEqual([...E.EASES], ['linear', 'sineIn', 'sineOut', 'sineInOut', 'quadIn', 'quadOut', 'quadInOut',
    'cubicIn', 'cubicOut', 'cubicInOut', 'expoIn', 'expoOut', 'expoInOut', 'backIn', 'backOut', 'backInOut',
    'elasticOut', 'bounceOut', 'springOut', 'steps']);
  for (const name of E.EASES) {
    const f = E.get(name);
    assert.equal(f(0), 0, name);
    assert.equal(f(1), 1, name);
    assert.equal(f(-0.5), 0, name);
    assert.equal(f(1.5), 1, name);
    for (let i = 1; i < 100; i++) assert.ok(Number.isFinite(f(i / 100)), name);
  }
  assert.equal(E.get('steps')(0.3), 0.25);
  assert.equal(E.get('steps')(0.999), 0.875);
  throwsCode(() => E.get('wobble'), 'bad-ease');
});

test('ease: curves without overshoot are monotonic and stay in [0, 1]', () => {
  const E = load().use('core/ease');
  const calm = E.EASES.filter((n) => !/^(back|elastic|spring|bounce)/.test(n));
  for (const name of calm) {
    const f = E.get(name);
    let prev = 0;
    for (let i = 1; i <= 200; i++) {
      const v = f(i / 200);
      assert.ok(v >= prev - 1e-12 && v <= 1, name + ' at ' + i);
      prev = v;
    }
  }
  assert.ok(E.get('backIn')(0.3) < 0, 'backIn anticipates');
  assert.ok(E.get('springOut')(0.33) > 1, 'springOut overshoots');
});

test('ease: reverse swaps In/Out, keeps InOut, and names the time-reversed curve', () => {
  const E = load().use('core/ease');
  assert.equal(E.reverse('quadIn'), 'quadOut');
  assert.equal(E.reverse('expoOut'), 'expoIn');
  assert.equal(E.reverse('cubicInOut'), 'cubicInOut');
  assert.equal(E.reverse('linear'), 'linear');
  assert.equal(E.reverse('steps'), 'steps');
  for (const name of E.EASES) assert.ok(E.EASES.includes(E.reverse(name)), name);
  for (const name of ['sineIn', 'sineOut', 'sineInOut', 'quadIn', 'quadOut', 'quadInOut', 'cubicIn', 'cubicOut',
    'cubicInOut', 'expoIn', 'expoOut', 'expoInOut', 'backIn', 'backOut', 'linear']) {
    const f = E.get(name), g = E.get(E.reverse(name));
    assert.equal(E.reverse(E.reverse(name)), name);
    for (let i = 1; i < 20; i++) approx(g(i / 20), 1 - f(1 - i / 20), 1e-9, name);
  }
  throwsCode(() => E.reverse('nope'), 'bad-ease');
});

test('ease: bezier solves x(s) = u to 1e-6', () => {
  const E = load().use('core/ease');
  const lin = E.bezier(0, 0, 1, 1);
  for (let i = 0; i <= 20; i++) approx(lin(i / 20), i / 20, 1e-6);
  const cssEase = E.bezier(0.25, 0.1, 0.25, 1);
  approx(cssEase(0.5), 0.8024033877, 1e-6);
  const sym = E.bezier(0.42, 0, 0.58, 1);
  approx(sym(0.5), 0.5, 1e-6);
  for (let i = 1; i < 20; i++) approx(sym(i / 20) + sym(1 - i / 20), 1, 1e-6);
  const steep = E.bezier(0, 0.9, 0, 1.4);
  assert.equal(steep(0), 0);
  assert.equal(steep(1), 1);
  assert.ok(steep(0.5) > 1, 'y may overshoot');
});

// ----- core/color ------------------------------------------------------------------------------------------------

test('color: parse / toHex / isHex and TOKENS', () => {
  const C = load().use('core/color');
  assert.deepEqual({ ...C.parse('#C2413A') }, { r: 194, g: 65, b: 58 });
  assert.deepEqual({ ...C.parse('#c2413a') }, { r: 194, g: 65, b: 58 });
  assert.equal(C.toHex({ r: 194, g: 65, b: 58 }), '#C2413A');
  assert.equal(C.toHex({ r: 300, g: -4, b: 10.6 }), '#FF000B');
  for (const bad of ['C2413A', '#C2413', '#GG0000', 'red', null, '#C2413AFF']) throwsCode(() => C.parse(bad), 'bad-color');
  assert.equal(C.isHex('#a0B1c2'), true);
  assert.equal(C.isHex('ink'), false);
  assert.deepEqual([...C.TOKENS], ['ground', 'ground2', 'ink', 'accent', 'shiftA', 'shiftB', 'muted']);
});

test('color: rgba quantizes alpha to 1/64 and returns stable strings', () => {
  const C = load().use('core/color');
  assert.equal(C.rgba('#C2413A', 0.5), 'rgba(194,65,58,0.5)');
  assert.equal(C.rgba('#C2413A', 0.5 + 1 / 200), 'rgba(194,65,58,0.5)');
  assert.equal(C.rgba('#C2413A', 1 / 64), 'rgba(194,65,58,0.015625)');
  assert.equal(C.rgba('#C2413A', 3), 'rgba(194,65,58,1)');
  assert.equal(C.rgba('#C2413A', -1), 'rgba(194,65,58,0)');
  assert.equal(C.rgba('#C2413A', NaN), 'rgba(194,65,58,0)');
  assert.equal(C.rgba('#C2413A', 0.5), C.rgba('#C2413A', 0.5));
  for (let i = 0; i < 1100; i++) C.rgba(C.toHex({ r: i % 256, g: (i >> 8) * 40, b: 7 }), 0.25);   // overflows the cache
  assert.equal(C.rgba('#C2413A', 0.25), 'rgba(194,65,58,0.25)');
  throwsCode(() => C.rgba('accent', 0.5), 'bad-color');
});

test('color: OKLab mix, shade, luminance and contrast', () => {
  const C = load().use('core/color');
  assert.equal(C.mix('#c2413a', '#000000', 0), '#C2413A');
  assert.equal(C.mix('#C2413A', '#1c1a17', 1), '#1C1A17');
  const mid = C.parse(C.mix('#000000', '#FFFFFF', 0.5));
  assert.ok(mid.r === mid.g && mid.g === mid.b && mid.r > 0x58 && mid.r < 0x6A, 'OKLab mid grey is perceptual');
  assert.equal(C.mix('#336699', '#336699', 0.37), '#336699');
  assert.equal(C.shade('#C2413A', 0), '#C2413A');
  assert.equal(C.shade('#C2413A', 1), '#000000');
  assert.ok(C.luminance(C.shade('#C2413A', 0.35)) < C.luminance('#C2413A'));
  assert.equal(C.luminance('#FFFFFF'), 1);
  assert.equal(C.luminance('#000000'), 0);
  approx(C.contrast('#000000', '#FFFFFF'), 21, 1e-9);
  approx(C.contrast('#FFFFFF', '#000000'), 21, 1e-9);
  assert.equal(C.contrast('#777777', '#777777'), 1);
  approx(C.contrast('#777777', '#FFFFFF'), 4.48, 0.01);
});

test('color: fitContrast moves lightness only as far as needed', () => {
  const C = load().use('core/color');
  assert.equal(C.fitContrast('#1c1a17', '#EFE9DC', 4.5), '#1C1A17', 'already fine → unchanged');
  const cases = [['#777777', '#FFFFFF', 4.5], ['#C2413A', '#1C1A17', 4.5], ['#EEEEEE', '#FFFFFF', 3],
    ['#FFFF00', '#FFFFFF', 4.5], ['#3E6E8C', '#1C1A17', 4.5]];
  for (const [fg, bg, min] of cases) {
    const out = C.fitContrast(fg, bg, min);
    assert.ok(C.contrast(out, bg) >= min, fg + ' on ' + bg);
    assert.ok(C.contrast(out, bg) < min + 0.25, 'minimal change for ' + fg);
    assert.equal(C.fitContrast(fg, bg, min), out, 'deterministic');
  }
  const grey = C.parse(C.fitContrast('#777777', '#FFFFFF', 4.5));
  assert.ok(grey.r === grey.g && grey.g === grey.b, 'greys stay neutral');
  assert.ok(C.hueDistance(C.fitContrast('#C2413A', '#1C1A17', 4.5), '#C2413A') < 8, 'hue kept');
  assert.equal(C.fitContrast('#808080', '#808080', 21), '#000000', 'unreachable → best end');
});

test('color: hueDeg and hueDistance (HSL hue)', () => {
  const C = load().use('core/color');
  assert.equal(C.hueDeg('#FF0000'), 0);
  assert.equal(C.hueDeg('#00FF00'), 120);
  assert.equal(C.hueDeg('#0000FF'), 240);
  assert.equal(C.hueDeg('#FF00FF'), 300);
  assert.equal(C.hueDeg('#808080'), 0);
  approx(C.hueDeg('#00B140'), 141.69, 0.01);
  assert.equal(C.hueDistance('#FF0000', '#0000FF'), 120);
  assert.equal(C.hueDistance('#FF0000', '#FF00FF'), 60);
  assert.equal(C.hueDistance('#FF00FF', '#FF0000'), 60);
});

// ----- core/mat --------------------------------------------------------------------------------------------------

function explicitCompose(M, x, y, rot, kx, ky, sx, sy, px, py) {
  const out = M.ident(new Float32Array(6));
  const step = (m) => M.mul(out, out, Float32Array.from(m));
  step([1, 0, 0, 1, x + px, y + py]);
  step([Math.cos(rot), Math.sin(rot), -Math.sin(rot), Math.cos(rot), 0, 0]);
  step([1, Math.tan(ky), Math.tan(kx), 1, 0, 0]);
  step([sx, 0, 0, sy, 0, 0]);
  step([1, 0, 0, 1, -px, -py]);
  return out;
}

test('mat: compose equals T·R·K·S·T(−p); mul, invert, apply, quad', () => {
  const M = load().use('core/mat');
  const I = M.ident(new Float32Array(6));
  assert.deepEqual([...I], [1, 0, 0, 1, 0, 0]);
  const A = M.compose(new Float32Array(6), 120, -40, 0.7, 0.2, -0.1, 1.5, 0.8, 10, -6);
  approx(A, explicitCompose(M, 120, -40, 0.7, 0.2, -0.1, 1.5, 0.8, 10, -6), 1e-3);
  approx(M.mul(new Float32Array(6), A, I), A, 1e-6);
  approx(M.mul(new Float32Array(6), I, A), A, 1e-6);
  const inv = M.invert(new Float32Array(6), A);
  approx(M.mul(new Float32Array(6), A, inv), [1, 0, 0, 1, 0, 0], 1e-4);
  assert.equal(M.invert(new Float32Array(6), Float32Array.from([0, 0, 0, 0, 5, 5])), null);
  const p = M.apply(A, 10, -6, [0, 0]);
  approx(p, [130, -46], 1e-3, 'the pivot maps to (x + px, y + py)');
  const B = M.compose(new Float32Array(6), 5, 7, 0, 0, 0, 2, 3, 0, 0);
  assert.deepEqual([...M.quad(new Float32Array(8), B, 0, 0, 10, 20)], [5, 7, 25, 7, 25, 67, 5, 67]);
  const C = Float32Array.from(A);
  M.mul(C, C, C);                                   // aliasing is allowed
  approx(C, M.mul(new Float32Array(6), A, A), 1e-3);
});

// ----- core/noise ------------------------------------------------------------------------------------------------

test('noise: lattice values equal hash32 / 2^32 (allocation-free path matches core/hash)', () => {
  const MV = load();
  const Z = MV.use('core/noise'), H = MV.use('core/hash');
  const seeds = [0, 1, 7, 123456789, 4294967295, -3, 2.5, 'grain', 9007199254740991];
  for (const seed of seeds) {
    for (let i = -40; i <= 40; i += 3) {
      assert.equal(Z.noise1(seed, i), H.hash32(seed, i) / 4294967296, `noise1 ${seed} ${i}`);
      assert.equal(Z.noise2(seed, i, 11 - i), H.hash32(seed, i, 11 - i) / 4294967296, `noise2 ${seed} ${i}`);
    }
  }
  const tile = Z.tile(42, 16);
  assert.equal(tile.length, 256);
  for (let y = 0; y < 16; y += 5) for (let x = 0; x < 16; x += 3) assert.equal(tile[y * 16 + x], H.hash32(42, x, y) >>> 24);
});

test('noise: ranges, continuity, fbm and determinism', () => {
  const Z = load().use('core/noise');
  let prev = Z.noise1(9, 0);
  for (let i = 1; i <= 2000; i++) {
    const x = i * 0.01;
    const v = Z.noise1(9, x), w = Z.noise2(9, x, x * 0.7), f = Z.fbm1(9, x);
    for (const u of [v, w, f]) assert.ok(u >= 0 && u < 1);
    assert.ok(Math.abs(v - prev) < 0.05, 'continuous');
    prev = v;
  }
  assert.equal(Z.fbm1(9, 3.3, 1), Z.noise1(9, 3.3));
  assert.equal(Z.fbm1(9, 3.3), Z.fbm1(9, 3.3));
  assert.notEqual(Z.noise1(9, 3.3), Z.noise1(10, 3.3));
  const t = Z.tile(1, 64);
  const mean = t.reduce((s, v) => s + v, 0) / t.length;
  assert.ok(mean > 118 && mean < 137, 'tile values are spread over 0..255');
});
