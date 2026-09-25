/* 文字PVメーカー v2 — original work. Tests: core/motion — fitMotion cases and heroTime bounds (DESIGN §4.7). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx, deepEqual } = require('../helpers/assert_plus.js');

const MV = load();
const M = MV.use('core/motion');
const R = MV.use('core/rng');

test('constants', () => {
  deepEqual(M.SHARE, { arrive: 0.45, depart: 0.35 });
  assert.equal(M.MIN_DUR, 0.12);
});

test('fitMotion: a motion that fits is unchanged', () => {
  deepEqual(M.fitMotion({ dur: 0.6, each: 0.05, count: 5, window: 4, share: 0.45 }), { dur: 0.6, each: 0.05, total: 0.8 });
  deepEqual(M.fitMotion({ dur: 0.6, each: 0.05, count: 1, window: 4, share: 0.45 }), { dur: 0.6, each: 0.05, total: 0.6 });
});

test('fitMotion: the stagger shrinks first', () => {
  // limit = 0.45 · 2 = 0.9; total 0.6 + 0.1 · 9 = 1.5 > 0.9 and dur < limit → each = 0.3 / 9.
  const out = M.fitMotion({ dur: 0.6, each: 0.1, count: 10, window: 2, share: 0.45 });
  approx(out.dur, 0.6);
  approx(out.each, 0.3 / 9);
  approx(out.total, 0.9);
});

test('fitMotion: then the duration, never below MIN_DUR', () => {
  deepEqual(M.fitMotion({ dur: 1, each: 0.1, count: 4, window: 2, share: 0.45 }), { dur: 0.9, each: 0, total: 0.9 });
  deepEqual(M.fitMotion({ dur: 1, each: 0, count: 1, window: 2, share: 0.35 }), { dur: 0.7, each: 0, total: 0.7 });
  deepEqual(M.fitMotion({ dur: 0.5, each: 0.05, count: 3, window: 0.1, share: 0.45 }), { dur: 0.12, each: 0, total: 0.12 });
  deepEqual(M.fitMotion({ dur: 0.5, each: 0.05, count: 3, window: 0, share: 0.45 }), { dur: 0.12, each: 0, total: 0.12 });
});

test('fitMotion: share defaults to 1; odd counts; total invariant', () => {
  deepEqual(M.fitMotion({ dur: 1, each: 0.5, count: 3, window: 1.5 }), { dur: 1, each: 0.25, total: 1.5 });
  deepEqual(M.fitMotion({ dur: 0.4, each: 0.1, count: 0, window: 3, share: 0.45 }), { dur: 0.4, each: 0.1, total: 0.4 });
  deepEqual(M.fitMotion({ dur: 0.4, each: 0.1, window: 3, share: 0.45 }), { dur: 0.4, each: 0.1, total: 0.4 });
  const s = R.stream('fit');
  for (let i = 0; i < 2000; i++) {
    const input = { dur: s.range(0, 2), each: s.range(0, 0.2), count: s.int(1, 40), window: s.range(0, 6), share: s.pick([0.45, 0.35]) };
    const out = M.fitMotion(input);
    approx(out.total, out.dur + out.each * (input.count - 1), 1e-9);
    assert.ok(out.total <= Math.max(M.MIN_DUR, input.share * input.window) + 1e-9);
    assert.ok(out.dur <= input.dur + 1e-12 || out.dur === M.MIN_DUR);
    assert.ok(out.each >= 0 && out.each <= input.each + 1e-12);
  }
});

test('heroTime: the frozen formula', () => {
  // window 4: A = 0.6 + 0.05·4 = 0.8 (fits 1.8); L = 0.4 + 0.02·4 = 0.48 (fits 1.4).
  const cut = { a: 10, b: 14 };
  const t = M.heroTime(cut, { dur: 0.6, each: 0.05 }, { dur: 0.4, each: 0.02 }, 5);
  approx(t, 10 + 0.8 + 0.1 * ((14 - 0.48) - 10.8), 1e-12);
  approx(M.heroTime(cut, null, null, 5), 10 + 0.1 * 4, 1e-12, 'instant motions');
});

test('heroTime is always inside [a, b)', () => {
  const s = R.stream('hero');
  for (let i = 0; i < 3000; i++) {
    const a = s.range(-1, 200), b = a + s.pick([0, 1e-9, 0.01, 0.1, s.range(0, 8)]);
    const arrive = { dur: s.range(0, 3), each: s.range(0, 0.3) }, depart = { dur: s.range(0, 3), each: s.range(0, 0.3) };
    const t = M.heroTime({ a, b }, arrive, depart, s.int(1, 60));
    assert.ok(Number.isFinite(t));
    if (b > a) assert.ok(t >= a && t < b, `t=${t} a=${a} b=${b}`);
    else assert.equal(t, a);
  }
});
