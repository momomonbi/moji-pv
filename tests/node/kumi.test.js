/* 文字PVメーカー v2 — original work. Tests for engine/text/kumi: kana tiers and trims with word seams (T1), particles and heads with their sizes (T2) and the tagger's labelled sets, Latin words and their gaps (T3), the RunSpec field and its merge (DESIGN_2_2 §1). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');

const MV = load();
const KU = MV.use('engine/text/kumi');
const B = MV.use('engine/text/breaker');
const FACES = MV.use('engine/text/faces');
const H = MV.use('core/hash');
const LY = MV.use('core/lyrics');

const GOTHIC = Object.freeze({ family: 'Noto Sans JP', flavor: 'gothic', weight: 500 });
const INTER = Object.freeze({ family: 'Inter', flavor: 'gothic', weight: 500 });

// Font indices as engine/text/layout gives them: 1 on the Latin face (letters, digits, ASCII punctuation) unless the
// run is English; a space takes the font of the grapheme before it (else after).
function fontOf(u, lang) {
  const font = new Uint8Array(u.n);
  if (lang === 'en') return font;
  for (let i = 0; i < u.n; i++) font[i] = FACES.usesLatinFace(u.cls[i]) ? 1 : 0;
  for (let i = 0; i < u.n; i++) {
    if (!u.space[i]) continue;
    const p = u.prev[i], q = u.next[i];
    font[i] = p >= 0 ? font[p] : q < u.n ? font[q] : 0;
  }
  return font;
}

// KU.apply on a whole-text run (or the span [a, b) of `cut`), as layout.prepare calls it.
function applied(kumi, str, o = {}) {
  const cut = o.cut !== undefined ? o.cut : str;
  const base = o.base || 0;
  const lang = o.lang || 'ja';
  const u = B.analyze(str);
  const k = new Float64Array(u.n).fill(1);
  if (o.emph) for (const i of o.emph) k[i] = 1.15;
  const mark = new Uint8Array(u.n);
  if (o.emph) for (const i of o.emph) mark[i] = 1;
  const r = KU.apply(KU.normalize(kumi), { u, lang, font: fontOf(u, lang), vert: null, mark, k, text: cut, str, base,
    own: !!o.own, emphScale: 1.15, face: o.face || GOTHIC, latin: o.latin || INTER });
  return Object.assign({ u, k }, r);
}

const caps = (r) => Array.from(r.cap, (c) => (c === Infinity ? 1 : Math.round(c * 1e6) / 1e6));

// ---- T1: tiers ------------------------------------------------------------------------------------------------------

const SMALL = new Set([...'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ']);
const NARROW = new Set([...'くぐしじりノトドリ']);
const WIDE = new Set([...'あおすせなぬねのはひふへほまみむめやゆわゐゑをかれルハヱゟ']);
const VOICED = new Set([...'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽゔゞガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポヴヷヸヹヺヾ']);

test('T1 tiers: every kana of U+3041–U+30FF by the table; voiced kana are wide, ぐ じ ド narrow (wide in a column)', () => {
  for (let cp = 0x3041; cp <= 0x30ff; cp++) {
    const g = String.fromCodePoint(cp);
    const u = B.analyze(g);
    let want;
    if (g === '・' || g === '゛' || g === '゜') want = null;
    else if (g === 'ー') want = 'bar';
    else if (SMALL.has(g)) want = 'small';
    else if (NARROW.has(g)) want = 'narrow';
    else if (WIDE.has(g) || VOICED.has(g)) want = 'wide';
    else want = 'kana';
    assert.equal(KU.tier(u, 0), want, g + ' U+' + cp.toString(16));
    // a vertical column: the narrow kana are tall there and take the wide tier; every other tier is the same
    assert.equal(KU.tier(u, 0, true), want === 'narrow' ? 'wide' : want, g + ' U+' + cp.toString(16) + ' vertical');
  }
  const t = (g) => KU.tier(B.analyze(g), 0);
  for (const g of 'がぱヴ') assert.equal(t(g), 'wide', g);
  for (const g of 'ぐじド') assert.equal(t(g), 'narrow', g);
  for (const g of ['々', '・', 'ｱ', 'ｰ', '〜', '漢', 'A', '1', '。', '「', ' ', 'ㅎ']) assert.equal(t(g), null, g);
  assert.equal(t('ㇰ'), 'small');                                  // small katakana extension
  assert.equal(t('が'), 'wide');                            // a kana with a combining voiced mark
  for (const g of 'かれルハヱゟ') assert.equal(t(g), 'wide', g + ': its stroke reaches the edge of the em');
  for (const g of '゛゜') assert.equal(t(g), null, g + ': a spacing mark is no letter');
});

// ---- T1: trims --------------------------------------------------------------------------------------------------------

test('T1 trims: one grapheme at strength 0.7 and 1 equals the table; heavy, brush and weight ≥ 800 damp it', () => {
  const one = (g, s, face) => applied({ kana: s }, g, { face }).cap[0];
  const cases = [['あ', 'wide'], ['さ', 'kana'], ['く', 'narrow'], ['ゃ', 'small'], ['ー', 'bar'], ['ヴ', 'wide'], ['か', 'wide']];
  for (const [g, tier] of cases) {
    approx(one(g, 0.7), 1 - 0.7 * KU.TRIM[tier], 1e-12, g + ' 0.7');
    approx(one(g, 1), 1 - KU.TRIM[tier], 1e-12, g + ' 1');
  }
  // the table tuned on the ink check (glyph_parity.py check 6, docs/NOTES)
  assert.deepEqual(KU.TRIM, { wide: 0.06, kana: 0.12, narrow: 0.26, small: 0.20, bar: 0.08 });
  assert.deepEqual(KU.FLAVOR_DAMP, { heavy: 0.15, brush: 0.8 });
  // at strength 1: ordinary kana 0.88, wide 0.94, narrow 0.74, small 0.80, ー 0.92 (the ink-safe cells)
  assert.deepEqual(['さ', 'あ', 'く', 'ゃ', 'ー'].map((g) => Math.round(one(g, 1) * 100) / 100), [0.88, 0.94, 0.74, 0.8, 0.92]);
  // at the default 70 %: 0.916, 0.958, 0.818, 0.86, 0.944
  assert.deepEqual(['さ', 'あ', 'く', 'ゃ', 'ー'].map((g) => Math.round(one(g, 0.7) * 1000) / 1000), [0.916, 0.958, 0.818, 0.86, 0.944]);
  approx(one('さ', 1, { flavor: 'heavy', weight: 400 }), 1 - 0.12 * 0.15, 1e-12);
  approx(one('さ', 1, { flavor: 'brush', weight: 400 }), 1 - 0.12 * 0.8, 1e-12);
  approx(one('さ', 1, { flavor: 'gothic', weight: 900 }), 1 - 0.12 * 0.8, 1e-12);
  approx(one('さ', 1, { flavor: 'heavy', weight: 800 }), 1 - 0.12 * 0.15 * 0.8, 1e-12);
  approx(one('さ', 1, { flavor: 'mincho', weight: 700 }), 0.88, 1e-12);
  // a column trims く as wide (applied with a vertical classification)
  const u = B.analyze('く');
  const colCap = KU.apply(KU.normalize({ kana: 1 }), { u, lang: 'ja', font: new Uint8Array(1), vert: MV.use('engine/text/vert').classify(u.gs),
    mark: new Uint8Array(1), k: new Float64Array(1).fill(1), text: 'く', str: 'く', base: 0, own: false, emphScale: 1.15, face: GOTHIC,
    latin: INTER }).cap[0];
  approx(colCap, 0.94, 1e-12);
  // the spacing marks keep their advance
  assert.deepEqual(caps(applied({ kana: 1 }, 'ア゛')), [0.88, 1]);
  // kanji, Latin and punctuation keep their advance
  assert.deepEqual(caps(applied({ kana: 1 }, '夜A。「')), [1, 1, 1, 1]);
  // all strengths 0: nothing to apply
  assert.equal(KU.normalize({ kana: 0 }), null);
});

test('T1 seams: after a particle and at a phrase start both kana keep half the trim; never next to a space', () => {
  // きみのこえが: one phrase unit; の is a particle, so の|こ is a seam (and が ends the run: no seam after it)
  assert.deepEqual(Array.from(KU.partsOf('きみのこえが', 'ja').part), [0, 0, 1, 0, 0, 1]);
  assert.deepEqual(caps(applied({ kana: 0.7 }, 'きみのこえが')), [0.916, 0.958, 0.979, 0.958, 0.916, 0.958]);
  // …and in a longer run が|き is a seam too (a phrase start and after a particle)
  assert.deepEqual(caps(applied({ kana: 0.7 }, 'きみのこえがきこえた')),
    [0.916, 0.958, 0.979, 0.958, 0.916, 0.979, 0.958, 0.916, 0.916, 0.916]);
  // 夜明けのまち: の is a particle, の|ま a seam, both at half trim
  assert.deepEqual(caps(applied({ kana: 0.7 }, '夜明けのまち')), [1, 1, 0.916, 0.979, 0.979, 0.916]);
  // a phrase start after a space: the space separates the words already, so no kana is relaxed
  assert.deepEqual(caps(applied({ kana: 0.7 }, 'きみの こえ')), [0.916, 0.958, 0.958, 1, 0.916, 0.916]);
  // seams are Japanese only: the same kana in a zh-tagged run are trimmed evenly
  assert.deepEqual(caps(applied({ kana: 0.7 }, 'きみのこえが', { lang: 'zhHans' })), [0.916, 0.958, 0.958, 0.916, 0.916, 0.958]);
  // a run cut from the line reads the particles of the cut text: の is the last grapheme before the span
  const span = applied({ kana: 0.7 }, 'こえが', { cut: 'きみのこえが', base: 3 });
  assert.deepEqual(caps(span), [0.916, 0.916, 0.958]);                 // こ is the span's first: no seam at index 0
  const span2 = applied({ kana: 0.7 }, 'のこえ', { cut: 'きみのこえが', base: 2 });
  assert.deepEqual(caps(span2), [0.979, 0.958, 0.916]);
  // an own-text run reads its own particles
  assert.deepEqual(caps(applied({ kana: 0.7 }, 'きみのこえ', { cut: '夜', own: true })), [0.916, 0.958, 0.979, 0.958, 0.916]);
});

// ---- T3: Latin words ------------------------------------------------------------------------------------------------

const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
function latinOf(r) { return range(0, r.u.n).filter((i) => r.role[i] === KU.ROLE.latin); }
function gapsOf(r) { return r.gap ? range(0, r.u.n).filter((i) => r.gap[i] > 0).map((i) => [i, Math.round(r.gap[i] * 1e9) / 1e9]) : []; }

test('T3 segments: content bounds without edge spaces, gaps only where a word meets CJK', () => {
  let r = applied({ latin: 0.5 }, '夜明けのStationで');
  assert.deepEqual(latinOf(r), range(4, 11));
  assert.deepEqual(gapsOf(r), [[4, 0.15], [11, 0.15]]);
  assert.deepEqual(Array.from(r.k).map((v) => Math.round(v * 1e9) / 1e9), [1, 1, 1, 1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1.1, 1]);
  // one segment; its inner space is the word's (scaled), the gap is before G only
  r = applied({ latin: 0.5 }, '小さな声でGood morning');
  assert.deepEqual(latinOf(r), range(5, 17));
  assert.equal(r.u.gs[9], ' ');
  assert.deepEqual(gapsOf(r), [[5, 0.15]]);
  // the trailing space is not the word's: not scaled, and 君 after it gets no gap
  r = applied({ latin: 0.5 }, '声でGood morning 君');
  assert.deepEqual(latinOf(r), range(2, 14));
  assert.equal(r.k[14], 1);
  assert.deepEqual(gapsOf(r), [[2, 0.15]]);
  // trailing punctuation belongs to the word; the space after it does not
  r = applied({ latin: 0.5 }, 'Hello, 世界');
  assert.deepEqual(latinOf(r), range(0, 6));
  assert.equal(r.gap, null);
  // a leading space is not the word's either
  r = applied({ latin: 0.5 }, '君 Good');
  assert.deepEqual(latinOf(r), range(2, 6));
  assert.equal(r.gap, null);
  // digits alone are not a Latin word
  r = applied({ latin: 0.5 }, '12月の空');
  assert.deepEqual(latinOf(r), []);
  assert.equal(r.gap, null);
  assert.ok(Array.from(r.k).every((v) => v === 1));
  // ASCII punctuation inside the segment is the word's
  r = applied({ latin: 0.5 }, 'Hey!!君');
  assert.deepEqual(latinOf(r), range(0, 5));
  assert.deepEqual(gapsOf(r), [[5, 0.15]]);
  // brackets are not CJK: no gap next to them
  r = applied({ latin: 0.5 }, '「Love」の歌');
  assert.deepEqual(latinOf(r), range(1, 5));
  assert.equal(r.gap, null);
  // the gap follows the class change, not the phrase units (kinsoku moves the phrase start to て in Loveって)
  r = applied({ latin: 0.5 }, 'Loveって');
  assert.deepEqual(gapsOf(r), [[4, 0.15]]);
  // strength 1 and a Latin face with a small x-height
  r = applied({ latin: 1 }, '声でGood', { latin: { family: 'Caveat' } });
  approx(r.k[2], 1.3, 1e-12);
  assert.deepEqual(gapsOf(r), [[2, 0.3]]);
  r = applied({ latin: 1 }, '声でGood', { latin: { family: 'Cormorant Garamond' } });
  approx(r.k[2], 1.28, 1e-12);
  r = applied({ latin: 1 }, '声でGood', { latin: { family: 'default' } });
  approx(r.k[2], 1.2, 1e-12);
});

test('T3 gate: the cut text (or own text) must hold CJK; English runs and max() with emphasis', () => {
  // a Latin-only span of a Japanese cut is scaled, the same span of an English cut is not
  let r = applied({ latin: 0.5 }, 'Good', { cut: '小さな声Good morning', base: 4 });
  assert.deepEqual(latinOf(r), range(0, 4));
  assert.equal(r.gap, null);                                         // the run starts with the word: nothing before it
  r = applied({ latin: 0.5 }, 'Good', { cut: 'Good morning', base: 0 });
  assert.deepEqual(latinOf(r), []);
  // an own-text run gates on its own text
  r = applied({ latin: 0.5 }, 'Good', { cut: '小さな声', own: true });
  assert.deepEqual(latinOf(r), []);
  // lang 'en' is never set, whatever the text
  r = applied({ latin: 0.5 }, '声でGood', { lang: 'en' });
  assert.deepEqual(latinOf(r), []);
  // an emphasized Latin word keeps its emphasis size (max, not the product)
  r = applied({ latin: 0.5 }, '君のStar', { emph: [2, 3, 4, 5] });
  assert.deepEqual(Array.from(r.k).map((v) => Math.round(v * 1e9) / 1e9), [1, 1, 1.15, 1.15, 1.15, 1.15]);
  assert.deepEqual(latinOf(r), range(2, 6));
  assert.equal(KU.hasCjk('Good morning'), false);
  assert.equal(KU.hasCjk('小さな声'), true);
  assert.equal(KU.hasCjk('사랑 love'), true);
  assert.equal(KU.hasCjk(''), false);
  assert.equal(KU.hasCjk(undefined), false);
});

// ---- the particle tagger ------------------------------------------------------------------------------------------

const P = (text) => KU.particles(text, 'ja').map(([a, b]) => text.slice(a, b));

test('tagger: named positives and negatives; only Japanese is tagged', () => {
  const positives = [
    ['始発のホームに', ['の', 'に']], ['君にはない', ['には']], ['夢でもいい', ['でも']], ['どこまでも', ['までも']],
    ['このままで', ['で']], ['ありがとうを', ['を']], ['会いに行く', ['に']], ['寒いと思った', ['と']],
    ['夜が明けるまで', ['が', 'まで']], ['12月の', ['の']], ['Tokyoの', ['の']], ['「またね」と', ['と']],
    ['雪が積もる', ['が']], ['声が枯れても', ['が', 'も']], ['今日も明日も', ['も', 'も']],
  ];
  for (const [text, want] of positives) assert.deepEqual(P(text), want, text);
  const negatives = ['上がって', '広がる', '曲がれば', '急いで', '奏でる', '共に', '最も', '背のび', '手のひら', '君にはなしたい',
    '空にもえる', '君にもう一度', '揺らがない', '泳がせて', '白いはなが', '高いところ', '黒いとびら', '明けがた', '積もる', '籠もる',
    '光もれる', '涙もろい', '春です', '君でした', '夢でしょう', '待とう', '見とれる', '僕である', '見にくい'];
  const expected = { '君にはなしたい': ['に'], '空にもえる': ['に'], '君にもう一度': ['に'] };
  for (const text of negatives) {
    const got = P(text);
    const want = expected[text] || [];
    assert.deepEqual(got, want, text + ' → ' + JSON.stringify(got));
  }
  assert.deepEqual(KU.particles('始発のホームに', 'en'), []);
  assert.deepEqual(KU.particles('始発のホームに', 'zhHans'), []);
  assert.deepEqual(Array.from(KU.partsOf('始発のホームに', 'en').part), [0, 0, 0, 0, 0, 0, 0]);
});

// ---- the tagger on labelled lines (tests/fixtures/kumi_particles.json) -----------------------------------------------

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const LABELLED = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'kumi_particles.json'), 'utf8'));
const TARGETS = [...KU.P2, ...KU.P1];

// A labelled line → { text, gold }: gold[i] = 1 on the graphemes inside [..].
function parseLabelled(line) {
  let text = '', on = false;
  const flags = [];
  for (const ch of line) {
    if (ch === '[') { on = true; continue; }
    if (ch === ']') { on = false; continue; }
    text += ch;
    for (let j = 0; j < ch.length; j++) flags.push(on ? 1 : 0);   // per UTF-16 unit, mapped to graphemes below
  }
  const u = B.analyze(text);
  return { text, u, gold: Array.from({ length: u.n }, (_, i) => flags[u.offs[i]]) };
}

// Per-grapheme scores of the tagger (KU.particleMarks) on labelled lines.
function score(lines) {
  let tp = 0, fp = 0, fn = 0;
  const wrong = [];
  for (const line of lines) {
    const { u, gold } = parseLabelled(line);
    const got = KU.particleMarks(u);
    let bad = false;
    for (let i = 0; i < u.n; i++) {
      if (got[i] && gold[i]) tp++;
      else if (got[i]) { fp++; bad = true; }
      else if (gold[i]) fn++;
    }
    if (bad) wrong.push(line);
  }
  return { tp, fp, fn, precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1, wrong };
}
const pct = (v) => (v * 100).toFixed(1) + ' %';

// The rows of the app's sample sheet (lyric rows, cut pieces joined), computed from core/lyrics.SAMPLE_JA.
function sampleRows() {
  const rows = [];
  for (const src of LY.SAMPLE_JA.split('\n')) {
    const r = LY.parseRow(src, 'ja');
    if (r.kind === 'lyric' && !rows.includes(r.text)) rows.push(r.text);
  }
  return rows;
}

test('labelled sets: every sample-sheet row has one line, and every label is a run of targeted particles', () => {
  const gold = new Map(LABELLED.sets.sample.lines.map((l) => [parseLabelled(l).text, l]));
  const rows = sampleRows();
  assert.ok(rows.length >= 20);
  for (const row of rows) assert.ok(gold.has(row), 'no labelled line for the sample row ' + row);
  assert.equal(gold.size, rows.length, 'the sample set holds only rows of the sheet');
  for (const [name, set] of Object.entries(LABELLED.sets)) {
    assert.ok(set.role === 'regression' || set.role === 'heldout', name);
    assert.equal(new Set(set.lines).size, set.lines.length, name + ': no line twice');
    for (const line of set.lines) {
      assert.equal((line.match(/\[/g) || []).length, (line.match(/\]/g) || []).length, line);
      for (const [, inner] of line.matchAll(/\[([^\]]*)\]/g)) {
        let rest = inner;
        while (rest) {
          const t = TARGETS.find((p) => rest.startsWith(p));
          assert.ok(t, name + ': ' + line + ' labels ' + inner + ', not a run of targeted particles');
          rest = rest.slice(t.length);
        }
      }
    }
  }
  assert.deepEqual(Object.entries(LABELLED.sets).filter(([, v]) => v.role === 'heldout').map(([k]) => k), ['heldout4']);
});

// Regression floors on the in-sample sets: no false positive, and recall at most 0.02 below its value at v6. These
// guard against regressions; they are not evidence of precision (the tables were written while looking at them).
const FLOORS = { sample: 0.89, formerSample: 0.81, own: 0.72, heldout1: 0.78, heldout2: 0.80, heldout3: 0.89, probes: 0.90 };

for (const [name, floor] of Object.entries(FLOORS)) {
  test('regression: ' + name, (t) => {
    const set = LABELLED.sets[name];
    assert.equal(set.role, 'regression');
    // the sample set is scored in the order of the sheet's rows (computed from core/lyrics)
    const lines = name === 'sample'
      ? sampleRows().map((row) => set.lines.find((l) => parseLabelled(l).text === row)) : set.lines;
    const r = score(lines);
    t.diagnostic(`${name}: ${lines.length} lines, TP ${r.tp}, FP ${r.fp}, FN ${r.fn}, precision ${pct(r.precision)}, recall ${pct(r.recall)}`);
    assert.equal(r.fp, 0, 'false positives in ' + r.wrong.join(' / '));
    assert.ok(r.recall >= floor, name + ' recall ' + r.recall + ' < ' + floor);
  });
}

// The held-out gate: a set written after the tagger was frozen and never used for tuning. The target is the release
// target (≥ 97 % precision), not 100 %, so a later tagger change is not pushed into overfitting it.
test('held-out gate: heldout4 precision ≥ 0.97 and recall ≥ 0.85', (t) => {
  const set = LABELLED.sets.heldout4;
  assert.equal(set.role, 'heldout');
  assert.ok(set.lines.length >= 100);
  const r = score(set.lines);
  t.diagnostic(`heldout4: ${set.lines.length} lines, TP ${r.tp}, FP ${r.fp}, FN ${r.fn}, precision ${pct(r.precision)}, recall ${pct(r.recall)}`);
  assert.ok(r.precision >= 0.97, 'precision ' + r.precision + ': ' + r.wrong.join(' / '));
  assert.ok(r.recall >= 0.85, 'recall ' + r.recall);
});

// The release gate: at least 100 lines written and labelled by someone other than the tagger's author and never used
// for tuning, as { "lines": [...] } in the notation above. Pending (a todo that fails) until the file exists.
const INDEPENDENT = path.join(FIXTURES, 'kumi_independent.json');
const hasIndependent = fs.existsSync(INDEPENDENT);
test('release gate: precision ≥ 0.97 on an independent labelled set', {
  todo: hasIndependent ? false : 'tests/fixtures/kumi_independent.json: 100+ lines labelled by someone other than the tagger\'s author',
}, (t) => {
  assert.ok(hasIndependent, 'tests/fixtures/kumi_independent.json is missing');
  const lines = JSON.parse(fs.readFileSync(INDEPENDENT, 'utf8')).lines;
  assert.ok(Array.isArray(lines) && lines.length >= 100, 'at least 100 lines');
  const r = score(lines);
  t.diagnostic(`independent: ${lines.length} lines, TP ${r.tp}, FP ${r.fp}, FN ${r.fn}, precision ${pct(r.precision)}, recall ${pct(r.recall)}`);
  assert.ok(r.precision >= 0.97, 'precision ' + r.precision + ': ' + r.wrong.join(' / '));
});

// ---- T2: heads --------------------------------------------------------------------------------------------------------

// A cut as the marks see it: 【x】 a head, (x) a particle.
function marked(text, head, lang = 'ja') {
  const m = KU.marks(text, lang, head);
  let s = '';
  for (let i = 0; i < m.u.n; i++) s += m.heads[i] ? '【' + m.u.gs[i] + '】' : m.part[i] ? '(' + m.u.gs[i] + ')' : m.u.gs[i];
  return s;
}

// The cuts of the sample sheet, each once, in order.
function sampleCuts() {
  const cuts = [];
  for (const src of LY.SAMPLE_JA.split('\n')) {
    const r = LY.parseRow(src, 'ja');
    if (r.kind !== 'lyric') continue;
    for (const [a, b] of r.pieces) if (!cuts.includes(r.text.slice(a, b))) cuts.push(r.text.slice(a, b));
  }
  return cuts;
}

// Generated by running KU.marks on the sample cuts and reviewed against DESIGN_2_2 §1 (T2.4); never written by hand.
const SAMPLE_HEADS = {
  line: [
    '【始】発(の)ホーム(に)', '【白】い息', '【改】札(の)向こうで', '【朝】(が)ほどける', '【ポ】ケット(の)切符(を)', '【そ】っと握って', '【ま】だ名前(の)ない',
    '【今】日(へ)行く', '【パ】ン(の)匂い(の)', '【角】(を)曲がれば', '【電】線(の)上(で)', '【ツ】バメ(が)鳴いた', '【小】さな声(で)', 'Good morning',
    '【窓】(に)映った', '【寝】ぐせ(の)僕(も)', '【悪】くないねと', '【笑】ってみせる', '【飛】ばせ', '【紙】ひこうき', '【空】(の)果て(ま)(で)', '【折】り目(の)数だけ',
    '【強】くなれる', '【向】かい風(で)(も)', '【か】まわないさ', 'Hello', '【ま】だ見ぬ', '【青】い空', '【信】号待ち(の)', '【交】差点(で)',
    '【昨】日(の)ため息(を)', '【置】いてきた', '【ビ】ル(の)谷間(に)', '【光】(が)落ちて', '【影】ぼうしが', '【背】のび(を)する', '【約】束(の)丘(へ)', '【続】く坂道',
    '【遠】回りしても', '【た】どり着ける', 'Fly high', '【ど】こ(ま)(で)(も)', '【ほ】どけた靴ひも(を)', '【結】び直して', '【明】日(の)僕(へ)',
    '【手】紙(を)書こう', '【始】発(の)ベル(が)', '【鳴】り終わる(ま)(で)',
  ],
  phrase: [
    '【始】発(の)【ホ】ーム(に)', '【白】い息', '【改】札(の)【向】こうで', '【朝】(が)ほどける', '【ポ】ケット(の)【切】符(を)', '【そ】っと【握】って',
    '【ま】だ名前(の)ない', '【今】日(へ)【行】く', '【パ】ン(の)【匂】い(の)', '【角】(を)【曲】がれば', '【電】線(の)【上】(で)', '【ツ】バメ(が)【鳴】いた',
    '【小】さな【声】(で)', 'Good morning', '【窓】(に)【映】った', '【寝】ぐせ(の)【僕】(も)', '【悪】くないねと', '【笑】ってみせる', '【飛】ばせ',
    '【紙】ひこうき', '【空】(の)【果】て(ま)(で)', '【折】り目(の)【数】だけ', '【強】くなれる', '【向】かい風(で)(も)', '【か】まわないさ', 'Hello', '【ま】だ見ぬ',
    '【青】い空', '【信】号待ち(の)', '【交】差点(で)', '【昨】日(の)ため息(を)', '【置】いてきた', '【ビ】ル(の)【谷】間(に)', '【光】(が)【落】ちて', '【影】ぼうしが',
    '【背】のび(を)する', '【約】束(の)【丘】(へ)', '【続】く坂道', '【遠】回りしても', '【た】どり着ける', 'Fly high', '【ど】こ(ま)(で)(も)',
    '【ほ】どけた靴ひも(を)', '【結】び直して', '【明】日(の)【僕】(へ)', '【手】紙(を)【書】こう', '【始】発(の)【ベ】ル(が)', '【鳴】り終わる(ま)(で)',
  ],
};

test('heads on the sample cuts: line, phrase and none', () => {
  const cuts = sampleCuts();
  assert.deepEqual(cuts.map((c) => marked(c, 'line')), SAMPLE_HEADS.line);
  assert.deepEqual(cuts.map((c) => marked(c, 'phrase')), SAMPLE_HEADS.phrase);
  for (const c of cuts) assert.ok(!Array.from(KU.marks(c, 'ja', 'none').heads).some(Boolean), c);
  // 'none' keeps the particles: only the heads go
  assert.equal(marked('始発のホームに', 'none'), '始発(の)ホーム(に)');
});

test('heads: brackets skipped, hiragana at the line start only, too-short cuts and non-Japanese get none', () => {
  // the eye enters the line at its first character, whatever its script; opening brackets (and spaces) are skipped
  assert.equal(marked('まだ名前のない', 'line'), '【ま】だ名前(の)ない');
  assert.equal(marked('「始まり」の朝', 'line'), '「【始】まり」(の)朝');
  assert.equal(marked('『 夢の中へ』', 'line'), '『 【夢】(の)中(へ)』');
  assert.equal(marked('（ホーム）', 'line'), '（【ホ】ーム）');
  // no head at a Latin, digit, punctuation, ー or small-kana start
  for (const text of ['Hello世界', '12月の空', '…だね', 'ーっとね', 'っていうか', '！いこう']) {
    assert.ok(!Array.from(KU.marks(text, 'ja', 'line').heads).some(Boolean), text);
  }
  // MIN_HEAD_CONTENT content graphemes (spaces do not count)
  assert.equal(KU.MIN_HEAD_CONTENT, 3);
  assert.equal(marked('空に', 'line'), '空(に)');
  assert.equal(marked('き み', 'line'), 'き み');
  assert.equal(marked('夜空に', 'line'), '【夜】空(に)');
  // 言葉の頭 grows kanji and katakana phrase starts, never a hiragana one (な of ない) nor a particle
  assert.equal(marked('まだ名前のない', 'phrase'), '【ま】だ名前(の)ない');
  assert.equal(marked('始発のホームに', 'phrase'), '【始】発(の)【ホ】ーム(に)');
  // only Japanese cuts have heads; an unknown head setting reads as 'line'
  for (const lang of ['en', 'zhHans', 'ko']) assert.ok(!Array.from(KU.marks('始発のホームに', lang, 'phrase').heads).some(Boolean), lang);
  assert.equal(marked('始発のホームに', 'bogus'), '【始】発(の)ホーム(に)');
  assert.ok(Object.isFrozen(KU.marks('始発のホームに', 'ja', 'line')));
  assert.equal(KU.marks('始発のホームに', 'ja', 'line').part, KU.partsOf('始発のホームに', 'ja').part, 'one tagging per cut text');
});

// ---- T2: sizes and roles in apply -------------------------------------------------------------------------------------

const ks = (r) => Array.from(r.k, (v) => Math.round(v * 1e9) / 1e9);

test('T2 apply: particles 1 − 0.36 j and heads 1 + 0.40 j, roles 1 and 2; emphasis: product for particles, max for heads', () => {
  let r = applied({ jump: 0.5 }, '始発のホームに');
  assert.deepEqual(ks(r), [1.2, 1, 0.82, 1, 1, 1, 0.82]);
  assert.deepEqual(Array.from(r.role), [2, 0, 1, 0, 0, 0, 1]);
  assert.deepEqual(Array.from(r.cap, (c) => c === Infinity), [true, true, true, true, true, true, true], 'T2 alone trims nothing');
  assert.equal(r.gap, null);
  r = applied({ jump: 1 }, '始発のホームに');
  assert.deepEqual(ks(r), [1.4, 1, 0.64, 1, 1, 1, 0.64]);
  assert.deepEqual(KU.JUMP, { small: 0.36, big: 0.40 });
  // a stacked particle shrinks as one: には
  r = applied({ jump: 0.5 }, '君にはない');
  assert.deepEqual(ks(r), [1.2, 0.82, 0.82, 1, 1]);
  // emphasis (1.15): a particle inside it shrinks relative to it; a head takes the larger size, never the product
  r = applied({ jump: 0.5 }, '始発のホームに', { emph: [0, 1, 2] });
  assert.deepEqual(ks(r), [1.2, 1.15, 0.943, 1, 1, 1, 0.82]);
  r = applied({ jump: 0.25 }, '始発のホームに', { emph: [0] });
  assert.deepEqual(ks(r).slice(0, 1), [1.15], 'max(1.15, 1.10)');
  // 言葉の頭
  r = applied({ jump: 0.5, head: 'phrase' }, '始発のホームに');
  assert.deepEqual(Array.from(r.role), [2, 0, 1, 2, 0, 0, 1]);
  r = applied({ jump: 0.5, head: 'none' }, '始発のホームに');
  assert.deepEqual(Array.from(r.role), [0, 0, 1, 0, 0, 0, 1]);
});

test('T2 apply: read on the cut text; own-text runs and non-Japanese runs get none', () => {
  // a run cut from the line: に is a particle there, ホ is no head (the cut's head is 始, in the other run)
  let r = applied({ jump: 0.5 }, 'ホームに', { cut: '始発のホームに', base: 3 });
  assert.deepEqual(ks(r), [1, 1, 1, 0.82]);
  assert.deepEqual(Array.from(r.role), [0, 0, 0, 1]);
  r = applied({ jump: 0.5 }, '始発の', { cut: '始発のホームに', base: 0 });
  assert.deepEqual(Array.from(r.role), [2, 0, 1]);
  // tagged alone, 「のホ」 has no particle (nothing comes before の); cut from the line, の is the particle it is there
  assert.deepEqual(KU.particles('のホ', 'ja'), []);
  r = applied({ jump: 0.5 }, 'のホ', { cut: '始発のホームに', base: 2 });
  assert.deepEqual(Array.from(r.role), [1, 0]);
  // own text (notes, labels, title cards): never T2, whatever the cut text, even one with the same or related words
  for (const [str, cut] of [['始発のホームに', '夜'], ['始発のホームに', '始発のホームに'], ['ホームに', '始発のホームに']]) {
    r = applied({ jump: 0.5 }, str, { cut, own: true });
    assert.ok(ks(r).every((v) => v === 1), str + ' / ' + cut);
    assert.ok(Array.from(r.role).every((v) => v === 0), str + ' / ' + cut);
  }
  // Japanese only
  for (const lang of ['en', 'zhHans', 'ko']) {
    r = applied({ jump: 0.5 }, '始発のホームに', { lang });
    assert.ok(Array.from(r.role).every((v) => v === 0), lang);
  }
  // a Latin word keeps its T3 size and role; T2 never touches it
  r = applied({ jump: 0.5, latin: 0.5 }, '小さな声でGood');
  assert.deepEqual(ks(r), [1.2, 1, 1, 1, 0.82, 1.1, 1.1, 1.1, 1.1]);
  assert.deepEqual(Array.from(r.role), [2, 0, 0, 0, 1, 3, 3, 3, 3]);
});

test('memos: results are equal after the memos are cleared (pure caches)', () => {
  const texts = ['きみのこえがきこえた', '始発のホームに白い息', '小さな声でGood morning', 'Good morning'];
  const all = { kana: 0.7, jump: 0.5, latin: 0.5, head: 'phrase' };
  const snap = (t) => [Array.from(KU.partsOf(t, 'ja').part), Array.from(KU.marks(t, 'ja', 'phrase').heads), KU.hasCjk(t),
    caps(applied(all, t)), ks(applied(all, t)), Array.from(applied(all, t).role)];
  const first = texts.map(snap);
  KU.clearMemos();
  const again = texts.map(snap);
  assert.deepEqual(again, first);
  // …and in the other order, from cold memos
  KU.clearMemos();
  assert.deepEqual(texts.slice().reverse().map(snap).reverse(), first);
  // a memo that fills up is cleared and keeps answering
  for (let i = 0; i < KU.MEMO_MAX + 5; i++) KU.partsOf('きみの' + i, 'ja');
  assert.deepEqual(Array.from(KU.partsOf('きみのこえが', 'ja').part), [0, 0, 1, 0, 0, 1]);
});

// ---- the RunSpec field --------------------------------------------------------------------------------------------

test('normalize: clamp, all-zero is null, a bad head is line; key', () => {
  assert.equal(KU.normalize(undefined), null);
  assert.equal(KU.normalize(null), null);
  assert.equal(KU.normalize(0.7), null);
  assert.equal(KU.normalize({}), null);
  assert.equal(KU.normalize({ kana: 0, jump: 0, latin: 0, head: 'phrase' }), null);
  assert.equal(KU.normalize({ kana: -1, jump: 'x', latin: NaN }), null);
  const n = KU.normalize({ kana: 2, jump: 0.5, latin: Infinity, head: 'bogus', extra: 1 });
  assert.deepEqual(n, { kana: 1, jump: 0.5, head: 'line', latin: 0 });
  assert.ok(Object.isFrozen(n));
  assert.deepEqual(KU.normalize({ latin: 0.5, head: 'phrase' }), { kana: 0, jump: 0, head: 'phrase', latin: 0.5 });
  assert.equal(KU.key(null), '');
  assert.equal(KU.key(KU.normalize({ kana: 0.7, jump: 0.5, latin: 0.5 })), 'k0.7|j0.5|hline|l0.5');
  assert.equal(KU.key(KU.normalize({ latin: 0.5, jump: 0.5, kana: 0.7, head: 'line' })), 'k0.7|j0.5|hline|l0.5');
});

test('withCut: the merge rule of a cut-scoped service', () => {
  const cut = KU.normalize({ kana: 0.7, jump: 0.5, latin: 0.5 });
  const spec = { span: [0, 4], size: 100 };
  assert.equal(KU.withCut(spec, null), spec);                              // no cut setting: the spec as it is
  const merged = KU.withCut(spec, cut);
  assert.notEqual(merged, spec);
  assert.equal(merged.kumi, cut);
  assert.equal(spec.kumi, undefined);                                      // never written into the part's spec
  const plain = { span: [0, 4], size: 100, kumi: null };
  assert.equal(KU.withCut(plain, cut), plain);                             // the part asked for plain text
  const tracked = { span: [0, 4], size: 100, tracking: 0.1 };
  assert.equal(KU.withCut(tracked, cut), tracked);                         // a part that sets its own spacing
  const over = KU.withCut({ span: [0, 4], size: 100, kumi: { jump: 0 } }, cut);
  assert.deepEqual(over.kumi, { kana: 0.7, jump: 0, head: 'line', latin: 0.5 });
  // a partial override with tracking set still merges (the part named its kumi)
  assert.deepEqual(KU.withCut({ size: 1, tracking: 0.2, kumi: { latin: 0 } }, cut).kumi, { kana: 0.7, jump: 0.5, head: 'line', latin: 0 });
  // key order is irrelevant to the layout key (canonical JSON) and to KU.key
  const a = KU.withCut({ size: 1, kumi: { latin: 0, jump: 0 } }, cut), b = KU.withCut({ size: 1, kumi: { jump: 0, latin: 0 } }, cut);
  assert.equal(H.hashJSON(a), H.hashJSON(b));
  assert.equal(KU.key(KU.normalize(a.kumi)), KU.key(KU.normalize(b.kumi)));
});
