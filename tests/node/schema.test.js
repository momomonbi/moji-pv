/* 文字PVメーカー v2 — original work. Tests: core/schema — coerce, AutoSpec forms, sources, describeAuto, validateSpec. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx, throwsCode } = require('../helpers/assert_plus.js');

const MV = load();
const S = MV.use('core/schema');
const R = MV.use('core/rng');

const label = { ja: 'テスト', en: 'Test' };
const JAPANESE = /[぀-ヿ一-鿿]/;

function ax(extra = {}) {
  return {
    f: { energy: 0.8, cps: 6, cells: 16, dur: 3.25, pos: 0.25, emph: true, impact: false },
    look: { amounts: { glitch: 0.3, motion: 0.6 }, mood: { tagBias: { soft: 1.8, fast: 0.3 } }, bpm: 120 },
    rng: R.stream('schema-test'),
    ...extra,
  };
}

test('ORDERS and the other vocabularies', () => {
  assert.deepEqual([...S.ORDERS], ['lead', 'tail', 'core', 'rim', 'scatter', 'word', 'line', 'sweepX', 'sweepY', 'radial',
    'emphFirst', 'sung']);
  assert.deepEqual([...S.TYPES], ['num', 'int', 'bool', 'enum', 'ease', 'order', 'ink', 'color', 'face', 'text']);
  assert.equal(S.AMOUNT_KEYS.length, 11);
  assert.equal(S.TAGS.length, 17);
});

test('coerce num: clamp → snap to step → clamp', () => {
  const spec = { type: 'num', min: 0, max: 1, step: 0.05 };
  assert.equal(S.coerce(spec, 0.37), 0.35);
  assert.equal(S.coerce(spec, 0.3000000001), 0.3);
  assert.equal(S.coerce(spec, 5), 1);
  assert.equal(S.coerce(spec, -5), 0);
  assert.equal(S.coerce({ type: 'num', min: 0, max: 1, step: 0.1 }, 0.1 + 0.2), 0.3);
  assert.equal(S.coerce({ type: 'num', min: 0.02, max: 0.2, step: 0.005 }, 0.0612), 0.06, 'steps count from min');
  assert.equal(S.coerce({ type: 'num', min: 0.15, max: 1.2, step: 0.1 }, 1.2), 1.2, 'snapped past max (1.25), clamped again');
  assert.equal(S.coerce({ type: 'num', min: 0.15, max: 1.2, step: 0.1 }, 1.13), 1.15);
  assert.equal(S.coerce({ type: 'num', min: -20, max: 20 }, 3.14159), 3.14159, 'no step → no snapping');
  assert.equal(Object.is(S.coerce({ type: 'num', min: -1, max: 1, step: 0.5 }, -0.1), 0), true, 'no -0');
  for (const bad of ['0.5', NaN, Infinity, null, undefined, true, [1]]) assert.equal(S.coerce(spec, bad), undefined);
});

test('coerce int, bool, enum, ease, order, face', () => {
  const int = { type: 'int', min: 1, max: 5 };
  assert.equal(S.coerce(int, 2.5), 3);
  assert.equal(S.coerce(int, 2.4), 2);
  assert.equal(S.coerce(int, 99), 5);
  assert.equal(S.coerce(int, '3'), undefined);
  assert.equal(S.coerce({ type: 'bool' }, 1), true);
  assert.equal(S.coerce({ type: 'bool' }, 0), false);
  assert.equal(S.coerce({ type: 'bool' }, 'no'), true);
  const en = { type: 'enum', of: ['right', 'center', 0, 90] };
  assert.equal(S.coerce(en, 'center'), 'center');
  assert.equal(S.coerce(en, 90), 90);
  assert.equal(S.coerce(en, '90'), undefined);
  assert.equal(S.coerce(en, 'left'), undefined);
  assert.equal(S.coerce({ type: 'ease' }, 'expoOut'), 'expoOut');
  assert.equal(S.coerce({ type: 'ease' }, 'expoout'), undefined);
  assert.equal(S.coerce({ type: 'order' }, 'emphFirst'), 'emphFirst');
  assert.equal(S.coerce({ type: 'order' }, 'random'), undefined);
  assert.equal(S.coerce({ type: 'face' }, 'serif'), 'serif');
  assert.equal(S.coerce({ type: 'face' }, 'mono'), undefined);
});

test('coerce ink, color, text', () => {
  assert.equal(S.coerce({ type: 'ink' }, 'accent'), 'accent');
  assert.equal(S.coerce({ type: 'ink' }, '#c2413a'), '#C2413A');
  assert.equal(S.coerce({ type: 'ink' }, 'red'), undefined);
  assert.equal(S.coerce({ type: 'color' }, '#00b140'), '#00B140');
  assert.equal(S.coerce({ type: 'color' }, 'ink'), undefined);
  assert.equal(S.coerce({ type: 'color' }, '#00B14'), undefined);
  const text = { type: 'text' };
  assert.equal(S.coerce(text, 'a\nb\r\nc\rd e'), 'a b c d e');
  assert.equal(S.coerce(text, 'x'.repeat(50)), 'x'.repeat(40), 'default max 40');
  assert.equal(S.coerce({ type: 'text', max: 3 }, '夜明けの街'), '夜明け');
  assert.equal(S.coerce({ type: 'text', max: 2 }, '🎵🎶♪'), '🎵🎶', 'never splits a surrogate pair');
  assert.equal(S.coerce(text, 12), '12');
  assert.equal(S.coerce(text, null), undefined);
  assert.equal(S.coerce(text, { a: 1 }), undefined);
  throwsCode(() => S.coerce({ type: 'weird' }, 1), 'bad-spec');
});

test('autoValue: { value } and { pick } (with and without weights)', () => {
  assert.equal(S.autoValue({ type: 'ease', auto: { value: 'expoOut' } }, ax()), 'expoOut');
  assert.equal(S.autoValue({ type: 'num', min: 0, max: 1, auto: { value: 7 } }, ax()), 1, 'result is coerced');
  const pick = { type: 'enum', of: ['a', 'b', 'c'], auto: { pick: ['a', 'b', 'c'] } };
  const counts = { a: 0, b: 0, c: 0 };
  const rng = R.stream('pick');
  for (let i = 0; i < 3000; i++) counts[S.autoValue(pick, { rng })]++;
  for (const k of ['a', 'b', 'c']) assert.ok(counts[k] > 850 && counts[k] < 1150, k);
  const weighted = { type: 'bool', auto: { pick: [false, true], weights: [3, 1] } };
  let yes = 0;
  const rng2 = R.stream('weights');
  for (let i = 0; i < 4000; i++) if (S.autoValue(weighted, { rng: rng2 })) yes++;
  assert.ok(yes > 880 && yes < 1120, 'true ≈ 25%: ' + yes);
  const same = (seed) => S.autoValue(pick, { rng: R.stream(seed) });
  assert.equal(same('fixed'), same('fixed'), 'deterministic for the same stream');
});

test('autoValue: { range } is lo + (hi − lo)·r from the param stream', () => {
  const spec = { type: 'num', min: 0, max: 1000, auto: { range: [120, 360] } };
  const r = R.stream('p').next();
  approx(S.autoValue(spec, { rng: R.stream('p') }), 120 + 240 * r, 1e-9);
  const int = { type: 'int', min: 1, max: 5, auto: { range: [1, 3] } };
  const rng = R.stream('ints');
  for (let i = 0; i < 200; i++) {
    const v = S.autoValue(int, { rng });
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 3);
  }
});

test('autoValue: { range, follow, jitter } = lerp(lo, hi, clamp(src + (r − 0.5)·jitter))', () => {
  const exact = { type: 'num', min: 0, max: 10, auto: { range: [2, 6], follow: 'energy', jitter: 0 } };
  approx(S.autoValue(exact, ax()), 2 + 4 * 0.8, 1e-12);
  const inverted = { type: 'num', min: 0, max: 10, auto: { range: [2, 6], follow: '-energy', jitter: 0 } };
  approx(S.autoValue(inverted, ax()), 2 + 4 * 0.2, 1e-12);
  const jittered = { type: 'num', min: 0, max: 10, auto: { range: [2, 6], follow: 'energy' } };
  const r = R.stream('schema-test').next();
  approx(S.autoValue(jittered, ax()), 2 + 4 * Math.min(1, 0.8 + (r - 0.5) * 0.2), 1e-12);
  for (let i = 0; i < 200; i++) {
    const v = S.autoValue(jittered, ax({ rng: R.stream('j', i) }));
    assert.ok(v >= 2 + 4 * 0.7 - 1e-9 && v <= 6, 'default jitter 0.2 keeps it within ±0.1 of the source');
  }
});

test('autoValue: { fn, why } gets (f, rng, look); invalid results fall back; bare AutoSpecs are raw', () => {
  const seen = [];
  const spec = { type: 'int', min: 0, max: 10, auto: { fn: (f, rng, look) => { seen.push(f.cells, typeof rng.next, look.bpm); return 4.6; }, why: label } };
  assert.equal(S.autoValue(spec, ax()), 5);
  assert.deepEqual(seen, [16, 'function', 120]);
  const broken = { type: 'enum', of: ['x', 'y'], auto: { fn: () => 'zzz', why: label } };
  assert.equal(S.autoValue(broken, ax()), 'x', 'falls back to a value the type accepts');
  assert.equal(S.autoValue({ value: 7 }, ax()), 7, 'bare AutoSpec: raw value');
  approx(S.autoValue({ range: [0, 1], follow: 'energy', jitter: 0 }, ax()), 0.8, 1e-12);
  throwsCode(() => S.autoValue({ type: 'num', min: 0, max: 1, auto: { range: [0, 1] } }, {}), 'no-rng');
  throwsCode(() => S.autoValue({ type: 'num', min: 0, max: 1, auto: {} }, ax()), 'bad-auto');
});

test('source normalization table (DESIGN §4.2, FROZEN)', () => {
  const at = (source, f = {}, look = {}) => S.sourceValue(source, { f, look });
  approx(at('energy', { energy: 0.42 }), 0.42);
  approx(at('density', { cps: 6 }), 0.5);
  approx(at('density', { cps: 30 }), 1);
  approx(at('cells', { cells: 16 }), 0.5);
  approx(at('cells', { cells: 1 }), 0);
  approx(at('dur', { dur: 3.25 }), 0.5);
  approx(at('dur', { dur: 0.2 }), 0);
  approx(at('tempo', {}, { bpm: 120 }), 0.5);
  approx(at('tempo', {}, { bpm: 60 }), 0);
  approx(at('tempo', {}, { bpm: 240 }), 1);
  approx(at('tempo', {}, { bpm: null }), 0.5);
  approx(at('position', { pos: 0.3 }), 0.3);
  assert.equal(at('emph', { emph: true }), 1);
  assert.equal(at('emph', { emph: false }), 0);
  assert.equal(at('impact', { impact: true }), 1);
  approx(at('amount.glitch', {}, { amounts: { glitch: 0.3 } }), 0.3);
  approx(at('mood.soft', {}, { mood: { tagBias: { soft: 1.8 } } }), (1.8 - 0.25) / 1.75);
  approx(at('mood.retro', {}, { mood: { tagBias: {} } }), (1 - 0.25) / 1.75);
  approx(at('mood.fast', {}, { mood: { tagBias: { fast: 0.1 } } }), 0);
  approx(at('-energy', { energy: 0.42 }), 0.58);
  approx(at('energy', {}), 0.5, 1e-12, 'a missing input reads as the middle');
  // The same table through autoValue: range [0, 1] with no jitter is the identity on the source.
  const spec = (follow) => ({ type: 'num', min: 0, max: 1, auto: { range: [0, 1], follow, jitter: 0 } });
  approx(S.autoValue(spec('cells'), ax()), 0.5);
  approx(S.autoValue(spec('amount.motion'), ax()), 0.6);
  throwsCode(() => S.sourceValue('loudness', ax()), 'bad-source');
});

test('describeAuto in ja and en', () => {
  const follow = { type: 'num', min: 0, max: 1, auto: { range: [0.45, 0.9], follow: 'energy' } };
  assert.equal(S.describeAuto(follow, 'ja'), '0.45–0.9 · エネルギーに連動');
  assert.equal(S.describeAuto(follow, 'en'), '0.45–0.9 · follows energy');
  const fn = { type: 'num', min: 0, max: 1, auto: { fn: () => 0.5, why: { ja: '行の長さで決める', en: 'Set by the line length' } } };
  assert.equal(S.describeAuto(fn, 'ja'), '行の長さで決める');
  assert.equal(S.describeAuto(fn, 'en'), 'Set by the line length');
  const specs = [
    { type: 'ease', auto: { value: 'expoOut' } },
    { type: 'bool', auto: { pick: [false, true], weights: [3, 2] } },
    { type: 'num', min: 0, max: 1, auto: { pick: [0, 0, 90, 30] } },
    { type: 'num', min: -6, max: 6, auto: { range: [-6, 6] } },
    { type: 'num', min: 0, max: 1, auto: { range: [0, 0.9], follow: '-amount.density', jitter: 0.4 } },
    { type: 'num', min: 0, max: 1, auto: { range: [0.1, 0.3], follow: 'mood.literary' } },
    { value: 0.123456 },
  ];
  for (const spec of specs) {
    const ja = S.describeAuto(spec, 'ja'), en = S.describeAuto(spec, 'en');
    assert.ok(ja.length > 0 && en.length > 0);
    assert.ok(!JAPANESE.test(en), 'no Japanese in en: ' + en);
  }
  assert.equal(S.describeAuto(specs[2], 'en'), 'one of 0 / 90 / 30');
  assert.equal(S.describeAuto(specs[1], 'ja'), 'オフ / オン から選ぶ');
  assert.equal(S.describeAuto(specs[3], 'en'), '-6–6 · random');
  assert.equal(S.describeAuto(specs[4], 'en'), '0–0.9 · inverse of density amount');
  assert.equal(S.describeAuto(specs[5], 'ja'), '0.1–0.3 · 雰囲気（文学的）に連動');
  assert.equal(S.describeAuto(specs[6], 'en'), 'always 0.123');
});

// Every param spec shown in DESIGN §4.18 examples validates.
const EXAMPLES = {
  cols: { type: 'int', min: 1, max: 5, label, auto: { range: [1, 3], follow: 'cells' } },
  anchor: { type: 'enum', of: ['right', 'center', 'left'], label, auto: { pick: ['right', 'center'], weights: [2, 1] } },
  step: { type: 'num', min: 0, max: 1.5, step: 0.05, unit: 'em', label, auto: { range: [0, 0.9], follow: 'amount.density', jitter: 0.4 } },
  rule: { type: 'bool', label, auto: { pick: [false, true], weights: [3, 2] } },
  depth: { type: 'num', min: 0, max: 600, step: 10, unit: 'du', label, auto: { range: [120, 360], follow: 'energy' } },
  speed: { type: 'num', min: 0, max: 0.5, step: 0.01, unit: 'Hz', label, auto: { range: [0.03, 0.11], follow: 'energy' } },
  toward: { type: 'ink', label, auto: { pick: ['shiftA', 'accent', 'muted'], weights: [3, 1, 1] } },
  width: { type: 'num', min: 1, max: 8, step: 0.5, unit: 'du', label, auto: { pick: [2, 3] } },
  angle: { type: 'num', min: -180, max: 180, unit: 'deg', label, auto: { pick: [0, 0, 90, 30] } },
  kick: { type: 'num', min: 0, max: 4, step: 0.1, label, auto: { range: [1, 3], follow: 'amount.glitch' } },
  ease: { type: 'ease', label, auto: { value: 'expoOut' }, ui: 'advanced', ai: false },
  note: { type: 'text', max: 20, label, auto: { value: '' } },
  tint: { type: 'color', label, auto: { fn: () => '#FFFFFF', why: label } },
};

test('validateSpec accepts the DESIGN examples', () => {
  for (const [name, spec] of Object.entries(EXAMPLES)) assert.deepEqual(S.validateSpec(name, spec), [], name);
  assert.deepEqual(S.validateSpec('dur', { type: 'num', min: 0.1, max: 2, auto: { value: 0.5 } }, { label: false }), []);
});

test('validateSpec reports each broken rule, naming the param', () => {
  const num = (extra) => ({ type: 'num', min: 0, max: 1, label, auto: { value: 0.5 }, ...extra });
  const cases = [
    [null, /spec must be an object/],
    [{ type: 'float', label, auto: { value: 1 } }, /unknown type/],
    [{ type: 'num', label, auto: { value: 1 } }, /min and max/],
    [num({ min: 2, max: 1, auto: { value: 1 } }), /min must be ≤ max/],
    [{ type: 'int', min: 0.5, max: 3, label, auto: { value: 1 } }, /int bounds/],
    [num({ step: 0 }), /step must be a positive number/],
    [{ type: 'enum', of: [], label, auto: { value: 'a' } }, /non-empty "of"/],
    [{ type: 'enum', of: ['a', 'a'], label, auto: { value: 'a' } }, /unique/],
    [{ type: 'enum', of: ['a', {}], label, auto: { value: 'a' } }, /strings or numbers/],
    [{ type: 'text', max: 0, label, auto: { value: '' } }, /text max/],
    [num({ unit: 'px' }), /unknown unit/],
    [num({ label: undefined }), /label needs/],
    [num({ label: { ja: '量' } }), /label needs/],
    [num({ ui: 'expert' }), /ui must be/],
    [num({ ai: 'yes' }), /ai must be a boolean/],
    [num({ auto: undefined }), /auto is required/],
    [num({ auto: { value: 0.1, range: [0, 1] } }), /exactly one of/],
    [num({ auto: {} }), /exactly one of/],
    [num({ auto: { value: 0.5, weights: [1] } }), /weights only go with pick/],
    [num({ auto: { value: 0.5, follow: 'energy' } }), /follow\/jitter only go with range/],
    [num({ auto: { value: 'x' } }), /not a valid num/],
    [num({ auto: { value: 3 } }), /outside min\.\.max/],
    [{ type: 'bool', label, auto: { pick: [0, 1] } }, /not a valid bool/],
    [num({ auto: { pick: [] } }), /non-empty array/],
    [num({ auto: { pick: [0, 1], weights: [1] } }), /match pick in length/],
    [num({ auto: { pick: [0, 1], weights: [1, -1] } }), /≥ 0/],
    [num({ auto: { pick: [0, 1], weights: [0, 0] } }), /not all be 0/],
    [{ type: 'enum', of: ['a'], label, auto: { range: [0, 1] } }, /num or int/],
    [num({ auto: { range: [1] } }), /\[lo, hi\]/],
    [num({ auto: { range: [0.8, 0.2] } }), /lo must be ≤ hi/],
    [num({ auto: { range: [0, 2] } }), /outside min\.\.max/],
    [num({ auto: { range: [0, 1], follow: 'loudness' } }), /unknown auto follow/],
    [num({ auto: { range: [0, 1], follow: 'amount.speed' } }), /unknown auto follow/],
    [num({ auto: { range: [0, 1], follow: 'mood.happy' } }), /unknown auto follow/],
    [num({ auto: { range: [0, 1], jitter: -1 } }), /jitter/],
    [num({ auto: { fn: () => 1 } }), /needs why/],
    [num({ auto: { fn: 'x', why: label } }), /must be a function/],
  ];
  for (const [spec, rule] of cases) {
    const errors = S.validateSpec('amount', spec);
    assert.ok(errors.length > 0, 'expected an error for ' + rule);
    assert.ok(errors.some((e) => rule.test(e)), rule + ' in ' + JSON.stringify(errors));
    for (const e of errors) assert.ok(e.startsWith('amount: '), e);
  }
});
