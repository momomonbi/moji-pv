/* 文字PVメーカー v2 — original work. Tests for 文字組み in engine/text/layout: absent means identical, the worked numbers of T1 and T3 (horizontal and vertical), breaking with gaps and the fit-consistency sweep (DESIGN_2_2 §1). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');

const MV = load();
const L = MV.use('engine/text/layout');
const KU = MV.use('engine/text/kumi');
const FACES = MV.use('engine/text/faces');
const LY = MV.use('core/lyrics');
const S = MV.use('core/script');
const { fakeMeasurer, graphemeWidth } = MV.use('engine/text/fake_measure');

const faces = FACES.resolveFaces(null, null, ['ja']);
const measurer = fakeMeasurer();
const BIG = { x: 0, y: 0, w: 4000, h: 4000 };

function run(text, spec, cut, m = measurer) {
  return L.layoutRun({ span: [0, text.length], size: 100, box: BIG, fit: 'none', lang: 'ja', ...spec },
    cut === undefined ? text : cut, faces, m);
}

// A RunLayout as plain data (typed arrays to lists), for deepEqual.
function plainOf(r) {
  const out = {};
  for (const [k, v] of Object.entries(r)) out[k] = ArrayBuffer.isView(v) ? Array.from(v) : v;
  return out;
}

const r2 = (v) => Math.round(v * 100) / 100;
const along = (r, v) => Array.from(v ? r.y : r.x, r2);
const size = (r, v) => Array.from(v ? r.h : r.w, r2);

// ---- absent means identical ---------------------------------------------------------------------------------------

test('absent, null or all-zero kumi: the RunLayout equals the one without the field (kumi: null)', () => {
  const cases = [
    ['夜明けの街を走る', {}],
    ['夜明けの街を走る', { orient: 'v' }],
    ['12月の空へ', { orient: 'v' }],                                       // tcy
    ['小さな声でGood morning', { box: { x: 0, y: 0, w: 700, h: 400 }, fit: 'shrink' }],
    ['ポケットの切符を', { emph: [[5, 7]], emphScale: 1.3 }],
    ['Paper planes in the morning light', { lang: 'en', box: { x: 0, y: 0, w: 900, h: 400 }, fit: 'shrink' }],
  ];
  for (const [text, spec] of cases) {
    const plain = run(text, spec);
    assert.equal(plain.kumi, null, text);
    for (const kumi of [null, { kana: 0, jump: 0, latin: 0 }, { head: 'phrase' }, 'on', 1]) {
      assert.deepEqual(plainOf(run(text, { ...spec, kumi })), plainOf(plain), text + ' ' + JSON.stringify(kumi));
    }
  }
  // a sizeGroup pair
  const items = (kumi) => [
    { spec: { span: [0, 4], size: 100, box: { x: 0, y: 0, w: 300, h: 200 }, sizeGroup: 'g', lang: 'ja', kumi }, text: '夜明けの街' },
    { spec: { span: [0, 2], size: 100, box: { x: 0, y: 0, w: 900, h: 200 }, sizeGroup: 'g', lang: 'ja', kumi }, text: '夜明けの街' },
  ];
  const base = L.layoutRuns(items(undefined), faces, measurer).map(plainOf);
  assert.deepEqual(L.layoutRuns(items(null), faces, measurer).map(plainOf), base);
  assert.deepEqual(L.layoutRuns(items({ kana: 0 }), faces, measurer).map(plainOf), base);
});

// ---- T1 ---------------------------------------------------------------------------------------------------------

test('T1 worked numbers: 夜明けのまち (h and v), ショートケーキ, きみのこえがきこえた', () => {
  let r = run('夜明けのまち', { kumi: { kana: 0.7 } });
  assert.deepEqual(along(r), [50, 150, 245.1, 338.45, 434.95, 528.3]);
  assert.deepEqual(size(r), [100, 100, 90.2, 96.5, 96.5, 90.2]);
  approx(r.box.w, 573.4, 1e-3);
  assert.equal(run('夜明けのまち', {}).box.w, 600);
  assert.deepEqual(Array.from(r.em), [100, 100, 100, 100, 100, 100]);    // glyphs keep their size: only the gaps close
  assert.deepEqual(Array.from(r.kumi), [0, 0, 0, 0, 0, 0]);
  r = run('夜明けのまち', { kumi: { kana: 0.7 }, orient: 'v' });
  assert.deepEqual(along(r, true), [50, 150, 245.1, 338.45, 434.95, 528.3]);
  assert.deepEqual(size(r, true), [100, 100, 90.2, 96.5, 96.5, 90.2]);
  approx(r.box.h, 573.4, 1e-3);
  r = run('ショートケーキ', { kumi: { kana: 1 } });
  assert.deepEqual(size(r), [86, 66, 92, 70, 86, 92, 86]);
  approx(r.box.w, 578, 1e-3);
  r = run('ショートケーキ', { kumi: { kana: 1 }, orient: 'v' });           // ー is rotated in vertical text: still a cell
  assert.deepEqual(size(r, true), [86, 66, 92, 70, 86, 92, 86]);
  r = run('きみのこえがきこえた', { kumi: { kana: 0.7 } });
  assert.deepEqual(size(r), [90.2, 93, 96.5, 95.1, 90.2, 96.5, 95.1, 90.2, 90.2, 90.2]);
  approx(r.box.w, 927.2, 1e-3);
});

test('T1: never wider than measured (proportional kana), and emphasis multiplies the capped cell', () => {
  // a stub measurer whose kana advance 85 at 100 px (a proportional face)
  const prop = {
    key: 'prop',
    width(css, str) {
      let sum = 0;
      for (const g of S.graphemes(String(str))) {
        const c = S.charClass(g);
        sum += c === 'hira' || c === 'kata' || c === 'smallKana' ? 85 : graphemeWidth(g);
      }
      return (sum * FACES.cssSize(css)) / 100;
    },
    metrics(css) { const k = FACES.cssSize(css) / 100; return { ascent: 88 * k, descent: 12 * k }; },
  };
  // か: cap 90.2 at 0.7 and 86 at 1 are both above 85, so it stays at 85; く (narrow) is capped at 70 at strength 1
  assert.deepEqual(size(run('かかか', { kumi: { kana: 0.7 } }, undefined, prop)), [85, 85, 85]);
  assert.deepEqual(size(run('かかか', { kumi: { kana: 1 } }, undefined, prop)), [85, 85, 85]);
  assert.deepEqual(size(run('くくく', { kumi: { kana: 1 } }, undefined, prop)), [70, 70, 70]);
  // emphasis on a kana: w = cap × emphScale, em = size × emphScale
  const r = run('かかか', { kumi: { kana: 1 }, emph: [[1, 2]], emphScale: 1.15 });
  approx(r.w[1], 86 * 1.15, 1e-3);
  approx(r.em[1], 115, 1e-3);
  approx(r.w[0], 86, 1e-3);
});

// ---- T3 ---------------------------------------------------------------------------------------------------------

test('T3 worked numbers: 夜明けのStationで (h, v, and broken in two lines without edge gaps)', () => {
  let r = run('夜明けのStationで', { kumi: { latin: 0.5 } });
  approx(r.x[3] + r.w[3] / 2, 400, 1e-3);                              // の ends at 400
  approx(r.x[4] - r.w[4] / 2, 415, 1e-3);                              // S starts after a 0.15 em gap
  assert.deepEqual([r2(r.x[4]), r2(r.w[4]), r2(r.em[4])], [445.8, 61.6, 110]);
  approx(r.x[10] + r.w[10] / 2, 815.4, 1e-3);                          // n ends at 815.4
  approx(r.x[11] - r.w[11] / 2, 830.4, 1e-3);                          // で starts after the gap
  approx(r.box.w, 930.4, 1e-3);
  assert.equal(run('夜明けのStationで', {}).box.w, 864);
  assert.deepEqual(Array.from(r.kumi), [0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 0]);
  const v = run('夜明けのStationで', { kumi: { latin: 0.5 }, orient: 'v' });
  assert.deepEqual(along(v, true), along(r));
  assert.deepEqual(size(v, true), size(r));
  approx(v.box.h, 930.4, 1e-3);
  // in a 700 du box with two lines the break comes before S: line 1 ends without a gap, line 2 starts without one
  const b = run('夜明けのStationで', { kumi: { latin: 0.5 }, box: { x: 0, y: 0, w: 700, h: 1000 }, maxLines: 2 });
  assert.deepEqual(b.lines.map((l) => [l.from, l.to]), [[0, 4], [4, 12]]);
  approx(b.lines[0].w, 400, 1e-3);
  approx(b.x[4], 30.8, 1e-3);
  approx(b.lines[1].w, 515.4, 1e-3);
  // each line is centred by its measured width: the width the breaker used agrees with the glyphs placed
  approx(b.box.x + b.x[0] - b.w[0] / 2, (700 - 400) / 2, 1e-3);
  approx(b.box.x + b.x[4] - b.w[4] / 2, (700 - 515.4) / 2, 1e-3);
  const bv = run('夜明けのStationで', { kumi: { latin: 0.5 }, box: { x: 0, y: 0, w: 1000, h: 700 }, maxLines: 2, orient: 'v' });
  assert.deepEqual(bv.lines.map((l) => [l.from, l.to]), [[0, 4], [4, 12]]);
  approx(bv.lines[0].h, 400, 1e-3);
  approx(bv.y[4], 30.8, 1e-3);
  approx(bv.box.y + bv.y[4] - bv.h[4] / 2, (700 - 515.4) / 2, 1e-3);
});

test('T3: inner spaces scale, edge spaces do not and get no gap; English and Latin-only cuts are untouched', () => {
  let r = run('声でGood morning 君', { kumi: { latin: 0.5 } });
  assert.deepEqual([r2(r.w[6]), r2(r.em[6])], [33, 110]);               // the inner space is the word's
  assert.deepEqual([r2(r.w[14]), r2(r.x[14]), r2(r.em[14])], [30, 909.8, 100]);
  approx(r.x[15] - r.w[15] / 2, 924.8, 1e-3);                          // 君 right after the space: no gap
  approx(r.box.w, 1024.8, 1e-3);
  r = run('Hello, 世界', { kumi: { latin: 0.5 } });
  assert.deepEqual([r2(r.w[5]), r2(r.em[5])], [66, 110]);               // , is the word's
  approx(r.x[6] + r.w[6] / 2, 342.4, 1e-3);                            // the space ends at 342.4 …
  approx(r.x[7] - r.w[7] / 2, 342.4, 1e-3);                            // … and 世 starts there
  r = run('君 Good', { kumi: { latin: 0.5 } });
  assert.deepEqual([r2(r.w[1]), r2(r.em[1]), r2(r.em[2])], [30, 100, 110]);
  approx(r.x[2] - r.w[2] / 2, 130, 1e-3);
  // 12月の空: digits alone are not a Latin word
  assert.deepEqual(plainOf({ ...run('12月の空', { kumi: { latin: 0.5 } }), kumi: null }), plainOf(run('12月の空', {})));
  // a run with lang 'en', and a Latin-only span of a cut without CJK, are laid out as without kumi
  for (const [text, spec, cut] of [['Good morning', { lang: 'en' }, undefined], ['Good', { span: [0, 4] }, 'Good morning']]) {
    const a = run(text, { ...spec, kumi: { kana: 1, latin: 1 } }, cut), p = run(text, spec, cut);
    assert.deepEqual(plainOf({ ...a, kumi: null }), plainOf(p), text);
    assert.ok(Array.from(a.kumi).every((x) => x === 0));
  }
  // the same span of a cut with CJK is scaled
  r = run('Good', { span: [4, 8], kumi: { latin: 0.5 } }, '小さな声Good morning');
  assert.deepEqual(Array.from(r.em), [110, 110, 110, 110]);
  assert.deepEqual(Array.from(run('Good', { span: [0, 4], kumi: { latin: 0.5 } }, 'Good morning').em), [100, 100, 100, 100]);
  // the gap of Loveって sits between e and っ
  r = run('Loveって', { kumi: { latin: 0.5 } });
  approx((r.x[4] - r.w[4] / 2) - (r.x[3] + r.w[3] / 2), 15, 1e-3);
  approx((r.x[5] - r.w[5] / 2) - (r.x[4] + r.w[4] / 2), 0, 1e-3);
});

test('T3: vertical tcy digits keep their size; an emphasized Latin word keeps its emphasis size (max)', () => {
  const plain = run('2人でStationへ', { orient: 'v' });
  const r = run('2人でStationへ', { orient: 'v', kumi: { latin: 1 } });
  assert.equal(r.em[0], plain.em[0]);
  assert.equal(r.sx[0], plain.sx[0]);
  assert.equal(r.kumi[0], 0);
  assert.deepEqual(Array.from(r.em.slice(3, 10), r2), [120, 120, 120, 120, 120, 120, 120]);
  // a tcy cell inside a Latin segment (!! after Hey) keeps its size too
  const bang = run('君Hey!!', { orient: 'v', kumi: { latin: 1 } }), bang0 = run('君Hey!!', { orient: 'v' });
  assert.deepEqual(Array.from(bang.em, r2), [100, 120, 120, 120, 100, 100]);
  assert.deepEqual(Array.from(bang.sx.slice(4)), Array.from(bang0.sx.slice(4)));
  assert.deepEqual(Array.from(bang.kumi), [0, 3, 3, 3, 0, 0]);
  const e = run('君のStar', { kumi: { latin: 0.5 }, emph: [[2, 6]], emphScale: 1.15 });
  assert.deepEqual(Array.from(e.em.slice(2), r2), [115, 115, 115, 115]);
  assert.deepEqual(Array.from(e.emph), [0, 0, 1, 1, 1, 1]);             // RunLayout.emph stays the 強調 marks
  assert.deepEqual(Array.from(e.kumi), [0, 0, 3, 3, 3, 3]);
});

test('kumi with a sizeGroup: the grouped runs still end at one size', () => {
  const items = [
    { spec: { span: [0, 4], size: 100, box: { x: 0, y: 0, w: 300, h: 200 }, sizeGroup: 'g', lang: 'ja', kumi: { kana: 1 } }, text: 'ひかりのなか' },
    { spec: { span: [4, 6], size: 100, box: { x: 0, y: 0, w: 900, h: 200 }, sizeGroup: 'g', lang: 'ja', kumi: { kana: 1 } }, text: 'ひかりのなか' },
  ];
  const [a, b] = L.layoutRuns(items, faces, measurer);
  assert.equal(a.size, b.size);
  assert.ok(a.size > 300 / 4, 'the tightened kana fit a larger size than four full cells: ' + a.size);
});

// ---- fit consistency -----------------------------------------------------------------------------------------------

// The cut texts of the app's sample sheet (every piece of every lyric row), plus mixed cuts.
function sampleCuts() {
  const out = [];
  for (const src of LY.SAMPLE_JA.split('\n')) {
    const row = LY.parseRow(src);
    if (row.kind !== 'lyric') continue;
    for (const [a, b] of row.pieces) out.push(row.text.slice(a, b));
  }
  return out.concat(['声でGood morning 君', 'Hello, 世界', '夜明けのStationで', '2人でStationへ', 'きみのこえがきこえたよるに']);
}

test('fit consistency: with every setting at 100 %, a fitted run stays in its box and each line is centred by its width', () => {
  const cuts = sampleCuts();
  assert.equal(cuts.length, 56, 'cuts');
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let count = 0, fitted = 0, worst = 0, skew = 0;
  for (let rep = 0; rep < 60; rep++) {
    for (const text of cuts) {
      for (const orient of ['h', 'v']) {
        const w = 300 + Math.floor(rnd() * 900);
        const box = orient === 'h' ? { x: 0, y: 0, w, h: 600 } : { x: 0, y: 0, w: 600, h: w };
        const spec = { span: [0, text.length], size: 100, box, lang: 'ja', orient, maxLines: 3,
          kumi: { kana: 1, jump: 1, latin: 1, head: rep % 2 ? 'phrase' : 'line' } };
        const lay = L.layoutRun(spec, text, faces, measurer);
        count++;
        if (lay.overfull) continue;
        fitted++;
        let lo = Infinity, hi = -Infinity;
        for (let i = 0; i < lay.n; i++) {
          if (S.charClass(lay.ch[i]) === 'space') continue;
          const c = orient === 'h' ? lay.box.x + lay.x[i] : lay.box.y + lay.y[i];
          const half = (orient === 'h' ? lay.w[i] : lay.h[i]) / 2;
          lo = Math.min(lo, c - half); hi = Math.max(hi, c + half);
        }
        const room = orient === 'h' ? box.w : box.h;
        worst = Math.max(worst, hi - room, -lo);
        // align 'center': a line's margins are equal when the width the breaker measured is the width placed
        for (const line of lay.lines) {
          let a = Infinity, b = -Infinity;
          for (let i = line.from; i < line.to; i++) {
            if (S.charClass(lay.ch[i]) === 'space') continue;
            const c = orient === 'h' ? lay.box.x + lay.x[i] : lay.box.y + lay.y[i];
            const half = (orient === 'h' ? lay.w[i] : lay.h[i]) / 2;
            a = Math.min(a, c - half); b = Math.max(b, c + half);
          }
          if (a !== Infinity) skew = Math.max(skew, Math.abs(a - (room - b)));
        }
      }
    }
  }
  assert.ok(count >= 6720, 'layouts ' + count);
  assert.ok(fitted > count / 2, 'fitted ' + fitted);
  assert.ok(worst <= 1e-4, 'worst excess ' + worst);
  assert.ok(skew <= 1e-3, 'worst centring skew ' + skew);
});

test('RunLayout.kumi and the gap are per layout: KU.apply works on prepare-local arrays', () => {
  const a = run('夜明けのStationで', { kumi: { kana: 0.7, latin: 0.5 } });
  const b = run('夜明けのStationで', { kumi: { kana: 0.7, latin: 0.5 } });
  assert.notEqual(a.kumi, b.kumi);
  assert.deepEqual(plainOf(a), plainOf(b));
  assert.ok(a.kumi instanceof Uint8Array);
  assert.equal(KU.ROLE.latin, 3);
});
