/* 文字PVメーカー v2 — original work. Tests for engine/text/kumi: kana tiers and trims with word seams (T1), Latin words and their gaps (T3), the particle tagger, the RunSpec field and its merge (DESIGN_2_2 §1). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');

const MV = load();
const KU = MV.use('engine/text/kumi');
const B = MV.use('engine/text/breaker');
const FACES = MV.use('engine/text/faces');
const H = MV.use('core/hash');

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
const WIDE = new Set([...'あおすせなぬねのはひふへほまみむめやゆわゐゑを']);
const VOICED = new Set([...'がぎぐげござじずぜぞだぢづでどばびぶべぼぱぴぷぺぽゔゞガギグゲゴザジズゼゾダヂヅデドバビブベボパピプペポヴヷヸヹヺヾ']);

test('T1 tiers: every kana of U+3041–U+30FF by the table; voiced kana are wide, ぐ じ ド narrow', () => {
  for (let cp = 0x3041; cp <= 0x30ff; cp++) {
    const g = String.fromCodePoint(cp);
    const u = B.analyze(g);
    let want;
    if (g === '・') want = null;
    else if (g === 'ー') want = 'bar';
    else if (SMALL.has(g)) want = 'small';
    else if (NARROW.has(g)) want = 'narrow';
    else if (WIDE.has(g) || VOICED.has(g)) want = 'wide';
    else want = 'kana';
    assert.equal(KU.tier(u, 0), want, g + ' U+' + cp.toString(16));
  }
  const t = (g) => KU.tier(B.analyze(g), 0);
  for (const g of 'がぱヴ') assert.equal(t(g), 'wide', g);
  for (const g of 'ぐじド') assert.equal(t(g), 'narrow', g);
  for (const g of ['々', '・', 'ｱ', 'ｰ', '〜', '漢', 'A', '1', '。', '「', ' ', 'ㅎ']) assert.equal(t(g), null, g);
  assert.equal(t('ㇰ'), 'small');                                  // small katakana extension
  assert.equal(t('が'), 'wide');                            // a kana with a combining voiced mark
});

// ---- T1: trims --------------------------------------------------------------------------------------------------------

test('T1 trims: one grapheme at strength 0.7 and 1 equals the table; heavy, brush and weight ≥ 800 damp it', () => {
  const one = (g, s, face) => applied({ kana: s }, g, { face }).cap[0];
  const cases = [['あ', 'wide'], ['か', 'kana'], ['く', 'narrow'], ['ゃ', 'small'], ['ー', 'bar'], ['ヴ', 'wide']];
  for (const [g, tier] of cases) {
    approx(one(g, 0.7), 1 - 0.7 * KU.TRIM[tier], 1e-12, g + ' 0.7');
    approx(one(g, 1), 1 - KU.TRIM[tier], 1e-12, g + ' 1');
  }
  assert.deepEqual(KU.TRIM, { wide: 0.10, kana: 0.14, narrow: 0.30, small: 0.34, bar: 0.08 });
  // at strength 1: ordinary kana 0.86, wide 0.90, narrow 0.70, small 0.66, ー 0.92 (the ink-safe cells)
  assert.deepEqual(['か', 'あ', 'く', 'ゃ', 'ー'].map((g) => Math.round(one(g, 1) * 100) / 100), [0.86, 0.9, 0.7, 0.66, 0.92]);
  approx(one('か', 1, { flavor: 'heavy', weight: 400 }), 1 - 0.14 * 0.6, 1e-12);
  approx(one('か', 1, { flavor: 'brush', weight: 400 }), 1 - 0.14 * 0.8, 1e-12);
  approx(one('か', 1, { flavor: 'gothic', weight: 900 }), 1 - 0.14 * 0.8, 1e-12);
  approx(one('か', 1, { flavor: 'heavy', weight: 800 }), 1 - 0.14 * 0.6 * 0.8, 1e-12);
  approx(one('か', 1, { flavor: 'mincho', weight: 700 }), 0.86, 1e-12);
  // kanji, Latin and punctuation keep their advance
  assert.deepEqual(caps(applied({ kana: 1 }, '夜A。「')), [1, 1, 1, 1]);
  // all strengths 0: nothing to apply
  assert.equal(KU.normalize({ kana: 0 }), null);
});

test('T1 seams: after a particle and at a phrase start both kana keep half the trim; never next to a space', () => {
  // きみのこえが: one phrase unit; の is a particle, so の|こ is a seam (and が ends the run: no seam after it)
  assert.deepEqual(Array.from(KU.partsOf('きみのこえが', 'ja').part), [0, 0, 1, 0, 0, 1]);
  assert.deepEqual(caps(applied({ kana: 0.7 }, 'きみのこえが')), [0.902, 0.93, 0.965, 0.951, 0.902, 0.93]);
  // …and in a longer run が|き is a seam too (a phrase start and after a particle)
  assert.deepEqual(caps(applied({ kana: 0.7 }, 'きみのこえがきこえた')),
    [0.902, 0.93, 0.965, 0.951, 0.902, 0.965, 0.951, 0.902, 0.902, 0.902]);
  // 夜明けのまち: の is a particle, の|ま a seam, both at half trim
  assert.deepEqual(caps(applied({ kana: 0.7 }, '夜明けのまち')), [1, 1, 0.902, 0.965, 0.965, 0.902]);
  // a phrase start after a space: the space separates the words already, so no kana is relaxed
  assert.deepEqual(caps(applied({ kana: 0.7 }, 'きみの こえ')), [0.902, 0.93, 0.93, 1, 0.902, 0.902]);
  // seams are Japanese only: the same kana in a zh-tagged run are trimmed evenly
  assert.deepEqual(caps(applied({ kana: 0.7 }, 'きみのこえが', { lang: 'zhHans' })), [0.902, 0.93, 0.93, 0.902, 0.902, 0.93]);
  // a run cut from the line reads the particles of the cut text: の is the last grapheme before the span
  const span = applied({ kana: 0.7 }, 'こえが', { cut: 'きみのこえが', base: 3 });
  assert.deepEqual(caps(span), [0.902, 0.902, 0.93]);                 // こ is the span's first: no seam at index 0
  const span2 = applied({ kana: 0.7 }, 'のこえ', { cut: 'きみのこえが', base: 2 });
  assert.deepEqual(caps(span2), [0.965, 0.951, 0.902]);
  // an own-text run reads its own particles
  assert.deepEqual(caps(applied({ kana: 0.7 }, 'きみのこえ', { cut: '夜', own: true })), [0.902, 0.93, 0.965, 0.951, 0.902]);
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

test('memos: results are equal after the memos are cleared (pure caches)', () => {
  const texts = ['きみのこえがきこえた', '始発のホームに白い息', '小さな声でGood morning', 'Good morning'];
  const first = texts.map((t) => [Array.from(KU.partsOf(t, 'ja').part), KU.hasCjk(t), caps(applied({ kana: 0.7, latin: 0.5 }, t))]);
  KU.clearMemos();
  const again = texts.map((t) => [Array.from(KU.partsOf(t, 'ja').part), KU.hasCjk(t), caps(applied({ kana: 0.7, latin: 0.5 }, t))]);
  assert.deepEqual(again, first);
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
