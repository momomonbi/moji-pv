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

// 出そろい (PV22 T4, DESIGN_2_2 §5): an optional cap on when the motion ends.
test('fitMotion with cap: the stagger shrinks first, then the duration down to the cap itself', () => {
  // fits both: unchanged
  deepEqual(M.fitMotion({ dur: 0.2, each: 0.02, count: 5, window: 4, share: 0.45, cap: 0.4 }), { dur: 0.2, each: 0.02, total: 0.28 });
  // the stagger shrinks: 0.3 + 4·each = 0.4
  const s = M.fitMotion({ dur: 0.3, each: 0.05, count: 5, window: 4, share: 0.45, cap: 0.4 });
  approx(s.each, 0.025, 1e-12);
  deepEqual([s.dur, s.total], [0.3, 0.4]);
  // then the duration: the cap itself (no MIN_DUR floor above it: the planner keeps cap ≥ MIN_DUR)
  deepEqual(M.fitMotion({ dur: 0.6, each: 0.05, count: 5, window: 4, share: 0.45, cap: 0.25 }), { dur: 0.25, each: 0, total: 0.25 });
  deepEqual(M.fitMotion({ dur: 0.6, each: 0, count: 1, window: 4, share: 0.45, cap: 0.12 }), { dur: 0.12, each: 0, total: 0.12 });
  // a cap at or above share·window is ignored
  deepEqual(M.fitMotion({ dur: 1, each: 0.1, count: 4, window: 2, share: 0.45, cap: 0.9 }), { dur: 0.9, each: 0, total: 0.9 });
  deepEqual(M.fitMotion({ dur: 1, each: 0.1, count: 4, window: 2, share: 0.45, cap: 5 }), { dur: 0.9, each: 0, total: 0.9 });
  // heroTime reads cut.ready: the capped entrance ends at ready
  const cut = { a: 10, b: 14, ready: 10.3 };
  approx(M.heroTime(cut, { dur: 0.6, each: 0.05 }, { dur: 0.4, each: 0.02 }, 5), 10.3 + 0.1 * ((14 - 0.48) - 10.3), 1e-12);
});

test('fitMotion without cap is the v2 formula (1000 seeded inputs)', () => {
  // a frozen copy of the formula before the cap
  const old = ({ dur, each, count, window: w, share = 1 }) => {
    const d = dur > 0 ? dur : 0, e = each > 0 ? each : 0;
    const gaps = Number.isFinite(count) && count > 1 ? Math.floor(count) - 1 : 0;
    const limit = share * (w > 0 ? w : 0);
    const total = d + e * gaps;
    if (total <= limit) return { dur: d, each: e, total };
    if (d < limit && gaps > 0) return { dur: d, each: (limit - d) / gaps, total: limit };
    const fitted = Math.max(0.12, limit);
    return { dur: fitted, each: 0, total: fitted };
  };
  const s = R.stream('fit-cap');
  for (let i = 0; i < 1000; i++) {
    const input = { dur: s.range(-0.5, 2), each: s.range(-0.05, 0.2), count: s.pick([0, 1, s.int(2, 40), 7.5, NaN]),
      window: s.range(-1, 6), share: s.pick([0.45, 0.35, undefined]) };
    assert.deepEqual(M.fitMotion(input), old(input), JSON.stringify(input));
    // with a cap the motion ends within it (the cap ≥ MIN_DUR, as the planner guarantees)
    const cap = s.range(M.MIN_DUR, 1);
    const out = M.fitMotion(Object.assign({ cap }, input));
    assert.ok(out.total <= cap + 1e-9, 'ends within the cap');
    assert.ok(out.total <= old(input).total + 1e-12, 'a cap never lengthens a motion');
  }
});
