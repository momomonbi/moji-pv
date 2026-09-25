/* 文字PVメーカー v2 — original work. Tests for engine/text/layout, fit and service with the fake measurer (DESIGN §4.15.4–6). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx, throwsCode } = require('../helpers/assert_plus.js');

const MV = load();
const L = MV.use('engine/text/layout');
const FIT = MV.use('engine/text/fit');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const FACES = MV.use('engine/text/faces');
const S = MV.use('core/script');

const THEME = { faces: {
  display: { ja: 'Yuji Syuku', latin: 'Fraunces', weight: 400, flavor: 'brush' },
  serif: { ja: 'Shippori Mincho B1', latin: 'Cormorant Garamond', weight: 600, flavor: 'mincho' },
  body: { ja: 'Zen Kaku Gothic New', latin: 'Inter', weight: 500, flavor: 'gothic' },
} };
const faces = FACES.resolveFaces(THEME, null, ['ja']);
const measurer = fakeMeasurer();
const KATA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';

function run(text, spec) {
  return L.layoutRun({ span: [0, text.length], size: 100, ...spec }, text, faces, measurer);
}

// The ink box lies inside the spec box (with float slack).
function inside(r, box, eps = 1e-3) {
  return r.box.x >= box.x - eps && r.box.y >= box.y - eps
    && r.box.x + r.box.w <= box.x + box.w + eps && r.box.y + r.box.h <= box.y + box.h + eps;
}

test('horizontal: one centred line, cells from measured advances, lines and words', () => {
  const text = '夜明けの街を走る';
  const r = run(text, { box: { x: 10, y: 20, w: 1000, h: 300 }, fit: 'none' });
  assert.equal(r.n, 8);
  assert.deepEqual(r.ch, [...text]);
  assert.equal(r.size, 100);
  assert.deepEqual(r.box, { x: 110, y: 120, w: 800, h: 100 });
  assert.deepEqual(Array.from(r.x), [50, 150, 250, 350, 450, 550, 650, 750]);
  assert.deepEqual(Array.from(r.y), [50, 50, 50, 50, 50, 50, 50, 50]);
  assert.deepEqual(Array.from(r.w), [100, 100, 100, 100, 100, 100, 100, 100]);
  assert.deepEqual(Array.from(r.h), [100, 100, 100, 100, 100, 100, 100, 100]);
  assert.deepEqual(r.lines, [{ from: 0, to: 8, x: 0, y: 0, w: 800, h: 100 }]);
  assert.deepEqual(r.words.map((w) => [w.from, w.to]), [[0, 4], [4, 6], [6, 8]]);
  assert.deepEqual(Array.from(r.word), [0, 0, 0, 0, 1, 1, 2, 2]);
  assert.deepEqual(Array.from(r.off), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(S.CLASSES[r.cls[0]], 'han');
  assert.equal(S.CLASSES[r.cls[2]], 'hira');
  assert.equal(r.overfull, false);
  assert.equal(r.clip, null);
  assert.equal(r.fitStep, 0);
  for (const k of ['x', 'y', 'w', 'h', 'em', 'sx']) assert.ok(r[k] instanceof Float32Array, k);
  for (const k of ['cls', 'rot', 'emph', 'vcls', 'font']) assert.ok(r[k] instanceof Uint8Array, k);
  for (const k of ['line', 'word']) assert.ok(r[k] instanceof Int16Array, k);
});

test('horizontal: align and valign place the block inside the box', () => {
  const box = { x: 0, y: 0, w: 1000, h: 300 };
  const at = (align, valign) => { const r = run('夜明け', { box, align, valign, fit: 'none' }); return [r.box.x, r.box.y]; };
  assert.deepEqual(at('start', 'start'), [0, 0]);
  assert.deepEqual(at('end', 'end'), [700, 200]);
  assert.deepEqual(at('center', 'center'), [350, 100]);
});

test('horizontal: Latin runs in a ja line use the Latin face; spaces follow their neighbour', () => {
  const r = run('君とLove you', { box: { x: 0, y: 0, w: 2000, h: 200 }, fit: 'none', align: 'start' });
  assert.deepEqual(Array.from(r.font), [0, 0, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(r.fonts[0].family, 'Yuji Syuku');
  assert.equal(r.fonts[1].family, 'Fraunces');
  assert.equal(r.lang, 'ja');
  approx(r.x[3] - r.x[2], 56, 1e-4);
  approx(r.w[6], 30, 1e-4, 'an ASCII space in the Latin face');
  const en = run('Love you', { box: { x: 0, y: 0, w: 2000, h: 200 }, fit: 'none' });
  assert.equal(en.lang, 'en');
  assert.ok(Array.from(en.font).every((f) => f === 0));
  assert.equal(en.fonts[0].family, 'Fraunces');
});

test('emphasis: scaled by emphScale about the baseline centre; offsets follow the source text', () => {
  const src = 'ああ君と夢を';
  const r = L.layoutRun({ span: [2, 6], size: 100, emph: [[4, 5]], box: { x: 0, y: 0, w: 1000, h: 300 }, fit: 'none' },
    src, faces, measurer);
  assert.deepEqual(Array.from(r.emph), [0, 0, 1, 0]);
  assert.deepEqual(Array.from(r.off), [2, 3, 4, 5]);
  approx(r.em[2], 115, 1e-4);
  approx(r.w[2], 115, 1e-4);
  approx(r.x[3] - r.x[1], 50 + 115 + 50, 1e-4);
  approx(r.y[2] - r.y[0], -0.38 * 100 * 0.15, 1e-4, 'grows up from the shared baseline (fake ascent 88, descent 12)');
  const custom = L.layoutRun({ span: [2, 6], size: 100, emph: [[4, 5]], emphScale: 1.5, box: { x: 0, y: 0, w: 1000, h: 300 },
    fit: 'none' }, src, faces, measurer);
  approx(custom.em[2], 150, 1e-4);
});

test('emphasis: RunLayout.emph marks the RunSpec.emph glyphs at any emphScale, 1 included (colour-only emphasis)', () => {
  const text = '君と夢を見た';
  for (const emphScale of [1.15, 0.9, 1]) {
    const r = run(text, { emph: [[2, 4]], emphScale, box: { x: 0, y: 0, w: 1000, h: 300 }, fit: 'none' });
    assert.deepEqual(Array.from(r.emph), [0, 0, 1, 1, 0, 0], `emphScale ${emphScale}`);
    approx(r.em[2], 100 * emphScale, 1e-4, 'the size factor still follows emphScale');
    approx(r.em[0], 100, 1e-4);
  }
  const vertical = run(text, { emph: [[2, 4]], emphScale: 1, orient: 'v', box: { x: 0, y: 0, w: 300, h: 1000 }, fit: 'none' });
  assert.deepEqual(Array.from(vertical.emph), [0, 0, 1, 1, 0, 0]);
  const svc = createTextService({ measurer, faces });
  const spec = { span: [0, 6], size: 100, emphScale: 1, box: { x: 0, y: 0, w: 1000, h: 300 } };
  const plainRun = svc.layout(spec, text);
  assert.deepEqual(Array.from(svc.layout({ ...spec, emph: [[2, 4]] }, text).emph), [0, 0, 1, 1, 0, 0], 'not a cache hit');
  assert.deepEqual(Array.from(plainRun.emph), [0, 0, 0, 0, 0, 0]);
});

test('words: an opening bracket is never a word of its own (it joins the word after it)', () => {
  const text = '夜明けの君「Love song」';
  const r = run(text, { box: { x: 0, y: 0, w: 3000, h: 300 }, fit: 'none' });
  const words = r.words.map((w) => r.ch.slice(w.from, w.to).join('').trim());
  assert.deepEqual(words, ['夜明けの', '君', '「Love', 'song」']);
  for (const w of words) assert.ok(!/[「『（［【〔〈《｛([{]$/.test(w), `"${w}" ends with an opener`);
});

test('tracking and leading', () => {
  const r = run('夜明け', { box: { x: 0, y: 0, w: 1000, h: 300 }, fit: 'none', tracking: 0.1 });
  approx(r.x[1] - r.x[0], 110, 1e-4);
  approx(r.box.w, 320, 1e-4, 'no tracking after the last glyph');
  const two = run('夜明けの街を走る', { box: { x: 0, y: 0, w: 450, h: 400 }, fit: 'none', leading: 1.5, maxLines: 2 });
  assert.equal(two.lines.length, 2);
  approx(two.lines[1].y - two.lines[0].y, 150, 1e-4);
  assert.deepEqual(two.lines.map((l) => [l.from, l.to]), [[0, 4], [4, 8]], 'balanced at phrase boundaries');
  assert.deepEqual(Array.from(two.line), [0, 0, 0, 0, 1, 1, 1, 1]);
});

test('fit: shrinks analytically to the largest size that fits (step 1)', () => {
  const box = { x: 0, y: 0, w: 900, h: 300 };
  const long = '君の名前を呼ぶ声が届くまで走り続けるよ夜明けの街を';
  const r = run(long, { box, size: 120, maxLines: 2 });
  assert.equal(r.fitStep, 1);
  assert.equal(r.lines.length, 2);
  approx(r.size, 900 / 13, 1e-4, 'two balanced lines of 13 cells fill the width');
  assert.ok(inside(r, box));
  assert.equal(r.overfull, false);
});

test('fit is monotonic: a larger box never gives a smaller size, a longer text never a larger one', () => {
  const texts = ['君の名前を呼ぶ声が届くまで', '夜明けの街を走る君とLove song', 'I will run to you tonight', KATA.slice(0, 30)];
  for (const text of texts) {
    for (const orient of ['h', 'v']) {
      let prev = 0;
      for (let w = 120; w <= 2400; w += 53) {
        const box = orient === 'h' ? { x: 0, y: 0, w, h: 360 } : { x: 0, y: 0, w: 360, h: w };
        const r = run(text, { box, orient, size: 140, maxLines: 3 });
        assert.ok(r.size >= prev - 1e-9, `${text} ${orient} w=${w}: ${r.size} < ${prev}`);
        if (!r.overfull) assert.ok(inside(r, box), `${text} ${orient} w=${w}: ink box leaves the box`);
        prev = r.size;
      }
    }
  }
  for (const breakAt of ['none', 'char']) {
    let prev = Infinity;
    for (let n = 1; n <= 40; n++) {
      const r = run(KATA.slice(0, n), { box: { x: 0, y: 0, w: 800, h: 300 }, size: 150, maxLines: 2, breakAt });
      assert.ok(r.size <= prev + 1e-9, `${breakAt} n=${n}: ${r.size} > ${prev}`);
      prev = r.size;
    }
  }
});

test('overfull fallback: the steps are deterministic and the last one clips and flags', () => {
  const box = { x: 0, y: 0, w: 500, h: 1000 };
  const step2 = run(KATA.slice(0, 20), { box, maxLines: 2 });
  assert.equal(step2.fitStep, 2, 'one 20-em phrase needs a character break');
  assert.equal(step2.breakAt, 'char');
  assert.equal(step2.maxLines, 3);
  assert.deepEqual(step2.lines.map((l) => l.to - l.from), [10, 10], 'at minSize two balanced lines are enough');
  approx(step2.size, 35, 1e-9, 'step 2 keeps minSize = 0.35 · 100');

  const flat = { x: 0, y: 0, w: 500, h: 120 };
  const step3 = run(KATA.slice(0, 40), { box: flat, maxLines: 1, breakAt: 'none' });
  assert.equal(step3.fitStep, 3);
  approx(step3.size, 25, 1e-4, '2 lines of 20 em, below minSize (35) but above 0.6 · minSize (21)');
  assert.equal(step3.overfull, false);

  const text = KATA + KATA;
  const a = run(text, { box: flat, maxLines: 1, breakAt: 'none' });
  const b = run(text, { box: flat, maxLines: 1, breakAt: 'none' });
  assert.equal(a.fitStep, 4);
  assert.equal(a.overfull, true);
  approx(a.size, 0.6 * 35, 1e-9);
  assert.deepEqual(a.clip, flat);
  assert.deepEqual(Array.from(a.x), Array.from(b.x));
  assert.deepEqual(Array.from(a.y), Array.from(b.y));
  assert.deepEqual(a.lines, b.lines);

  const none = run(text, { box: flat, fit: 'none' });
  assert.equal(none.overfull, false, 'fit: none never reports overfull');
  assert.equal(none.size, 100);
});

test('fitSize and largestFitting on their own', () => {
  assert.equal(FIT.minSizeOf(100), 35);
  assert.equal(FIT.minSizeOf(30), 18);
  assert.equal(FIT.minSizeOf(10), 10, 'a tiny run never grows');
  const limit = { phrase: 50, char: 70 };
  const fits = (s, cfg) => s <= limit[cfg.breakAt] + (cfg.maxLines - 2) * 5;
  const r = FIT.fitSize({ size: 100, fit: 'shrink', breakAt: 'phrase', maxLines: 2 }, fits);
  assert.equal(r.step, 1);
  approx(r.size, 50, 1e-6);
  assert.ok(fits(r.size, r));
  limit.phrase = 20;
  const r2 = FIT.fitSize({ size: 100, fit: 'shrink', breakAt: 'phrase', maxLines: 2 }, fits);
  assert.deepEqual([r2.step, r2.breakAt, r2.maxLines], [2, 'char', 3]);
  approx(r2.size, 35, 1e-9, 'the character re-break is used at minSize, not grown back');
  limit.char = 20;
  const r3 = FIT.fitSize({ size: 100, fit: 'shrink', breakAt: 'phrase', maxLines: 2 }, fits);
  assert.equal(r3.step, 3);
  approx(r3.size, 25, 1e-6);
  limit.char = 1;
  const r4 = FIT.fitSize({ size: 100, fit: 'shrink', breakAt: 'phrase', maxLines: 2 }, fits);
  assert.deepEqual([r4.step, r4.overfull, r4.size], [4, true, 0.6 * 35]);
  assert.equal(FIT.largestFitting(10, 20, () => false), null);
  assert.equal(FIT.largestFitting(10, 20, () => true), 20);
});

test('sizeGroup: runs of one group end at the smallest fitted size', () => {
  const box = { x: 0, y: 0, w: 600, h: 200 };
  const items = [
    { spec: { span: [0, 3], size: 100, box, maxLines: 1, sizeGroup: 'pair' }, text: '夜明け' },
    { spec: { span: [0, 12], size: 100, box, maxLines: 1, breakAt: 'none', sizeGroup: 'pair' }, text: '君の名前を呼ぶ声が届くまで' },
    { spec: { span: [0, 3], size: 100, box, maxLines: 1 }, text: '夜明け' },
  ];
  const [a, b, c] = L.layoutRuns(items, faces, measurer);
  approx(b.size, 50, 1e-4, '12 cells in 600');
  approx(a.size, b.size, 1e-9);
  assert.equal(c.size, 100, 'outside the group');
  assert.equal(a.overfull, false);
  const svc = createTextService({ measurer, faces });
  const viaService = svc.layoutAll(items);
  approx(viaService[0].size, b.size, 1e-9);
  assert.equal(svc.layoutAll(items), viaService, 'cached as one group');
});

test('text service: cached layouts keyed by spec, text, faces and measurer key', () => {
  const svc = createTextService({ measurer, faces });
  const spec = { span: [0, 3], size: 100, box: { x: 0, y: 0, w: 600, h: 200 }, ink: 'ink' };
  const a = svc.layout(spec, '夜明け');
  assert.equal(svc.layout({ ...spec, ink: 'accent', parent: 7 }, '夜明け'), a, 'ink and parent do not change a layout');
  assert.notEqual(svc.layout({ ...spec, size: 90 }, '夜明け'), a);
  assert.equal(svc.key, 'fake');
  const other = svc.withFaces(FACES.resolveFaces(null, null, ['ja']));
  assert.notEqual(other.layout(spec, '夜明け'), a, 'different faces → different entry');
  assert.equal(other.fontFor('display', 'ja').family, 'Noto Sans JP');
  let key = 'k1';
  const moving = { get key() { return key; }, width: measurer.width, metrics: measurer.metrics };
  const svc2 = createTextService({ measurer: moving, faces });
  const first = svc2.layout(spec, '夜明け');
  key = 'k2';
  assert.notEqual(svc2.layout(spec, '夜明け'), first, 'a new measurer key (fonts loaded) misses the cache');
  assert.deepEqual(svc.columns('君の名前を呼ぶ声が', 2, 'ja'), [[0, 5], [5, 9]]);
  assert.equal(svc.cells('夜明けLove'), 3 + 4 * 0.55);
  assert.throws(() => createTextService({ faces }), TypeError);
});

test('empty and space-only runs; bad specs are programmer errors', () => {
  const box = { x: 0, y: 0, w: 600, h: 200 };
  const empty = run('', { box });
  assert.equal(empty.n, 0);
  assert.deepEqual(empty.lines, []);
  assert.deepEqual(empty.words, []);
  assert.deepEqual(empty.box, { x: 300, y: 100, w: 0, h: 0 });
  const spaces = run('   ', { box });
  assert.equal(spaces.n, 3);
  assert.deepEqual(spaces.lines, []);
  assert.deepEqual(spaces.words, []);
  const extra = L.layoutRun({ text: '注釈', size: 50, box }, 'ignored', faces, measurer);
  assert.deepEqual(extra.ch, ['注', '釈'], 'spec.text replaces the cut text');
  throwsCode(() => L.layoutRun({ size: 100 }, 'x', faces, measurer), 'bad-spec');
  throwsCode(() => L.layoutRun({ size: -1, box }, 'x', faces, measurer), 'bad-spec');
  throwsCode(() => L.layoutRun({ size: 10, box: { x: 0, y: 0, w: NaN, h: 1 } }, 'x', faces, measurer), 'bad-spec');
});
