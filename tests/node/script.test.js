/* 文字PVメーカー v2 — original work. Tests for core/script: graphemes, classes, line scripts, cells, morae (DESIGN §4.8). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const S = MV.use('core/script');

function clusters(str) { return S.graphemes(str); }

test('graphemes: plain text, surrogate pairs and CR LF', () => {
  assert.deepEqual(clusters(''), []);
  assert.deepEqual(clusters('abc'), ['a', 'b', 'c']);
  assert.deepEqual(clusters('夜明け'), ['夜', '明', 'け']);
  assert.deepEqual(clusters('𠮷野家'), ['𠮷', '野', '家'], 'a supplementary han is one grapheme');
  assert.deepEqual(clusters('😀x'), ['😀', 'x']);
  assert.deepEqual(clusters('a\r\nb'), ['a', '\r\n', 'b'], 'CR LF stays together');
  assert.deepEqual(clusters('\n\r'), ['\n', '\r'], 'LF CR is two clusters');
  assert.deepEqual(clusters('\r\u0301'), ['\r', '\u0301'], 'nothing extends a control');
});

test('graphemes: combining marks, voicing marks and variation selectors', () => {
  assert.deepEqual(clusters('e\u0301te\u0302'), ['e\u0301', 't', 'e\u0302']);
  assert.deepEqual(clusters('x\u1ab0\u1dc0\u20d0\ufe20'), ['x\u1ab0\u1dc0\u20d0\ufe20']);
  assert.deepEqual(clusters('か\u3099き\u309a'), ['か\u3099', 'き\u309a'], 'kana voicing marks join');
  assert.deepEqual(clusters('ｶﾞｷﾟ'), ['ｶﾞ', 'ｷﾟ'], 'halfwidth voicing marks join');
  assert.deepEqual(clusters('❤\ufe0f!'), ['❤\ufe0f', '!'], 'VS16 joins');
  assert.deepEqual(clusters('葛\u{e0100}城'), ['葛\u{e0100}', '城'], 'ideographic variation selector joins');
  assert.deepEqual(clusters('\u0301a'), ['\u0301', 'a'], 'a leading mark is its own cluster');
});

test('graphemes: ZWJ families, skin tones, flags, keycaps and tag sequences', () => {
  const family = '👨\u200d👩\u200d👧\u200d👦';
  assert.deepEqual(clusters(family + 'x'), [family, 'x']);
  assert.deepEqual(clusters('👍🏽👍'), ['👍🏽', '👍'], 'skin tone modifier joins');
  assert.deepEqual(clusters('🇯🇵🇺🇸'), ['🇯🇵', '🇺🇸'], 'regional indicators pair up');
  assert.deepEqual(clusters('🇯🇵🇺'), ['🇯🇵', '🇺'], 'an odd indicator stays alone');
  assert.deepEqual(clusters('1\ufe0f\u20e3#\u20e3'), ['1\ufe0f\u20e3', '#\u20e3'], 'keycaps');
  const scotland = '🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f}';
  assert.deepEqual(clusters(scotland + 'z'), [scotland, 'z'], 'tag sequence');
  assert.deepEqual(clusters('a\u200db'), ['a\u200db'], 'ZWJ joins the next cluster');
});

test('graphemes: Hangul jamo L+V(+T) and precomposed syllables', () => {
  assert.deepEqual(clusters('각가'), ['각', '가']);
  assert.deepEqual(clusters('각'), ['각'], 'LV syllable + T');
  assert.deepEqual(clusters('각ᅡ'), ['각', 'ᅡ'], 'LVT + V breaks');
  assert.deepEqual(clusters('사랑해'), ['사', '랑', '해']);
});

test('graphemeOffsets and snapOffset', () => {
  assert.deepEqual(Array.from(S.graphemeOffsets('a😀b')), [0, 1, 3, 4]);
  assert.deepEqual(Array.from(S.graphemeOffsets('')), [0]);
  assert.ok(S.graphemeOffsets('ab') instanceof Int32Array);
  assert.equal(S.snapOffset('a😀b', 2), 1);
  assert.equal(S.snapOffset('a😀b', 2, 'ceil'), 3);
  assert.equal(S.snapOffset('a😀b', 3, 'ceil'), 3);
  assert.equal(S.snapOffset('ab', -4), 0);
  assert.equal(S.snapOffset('ab', 9), 2);
  const offs = S.graphemeOffsets('e\u0301x');
  assert.deepEqual([0, 1, 2, 3].map((x) => S.snapToBoundary(offs, x)), [0, 0, 2, 3]);
  assert.deepEqual([0, 1, 2, 3].map((x) => S.snapToBoundary(offs, x, 'ceil')), [0, 2, 2, 3]);
});

test('charClass covers every class', () => {
  const cases = {
    han: ['漢', '々', '〆', '𠮷'], hira: ['ひ', 'ゝ'], kata: ['カ', 'ー', 'ｱ', 'ｰ'], smallKana: ['ゃ', 'ッ', 'ヶ', 'ㇰ', 'ｯ'],
    hangul: ['한', 'ㄱ', 'ᄀ'], latin: ['A', 'z', 'é', 'Ω', 'Ж'], digit: ['0', '9'], fullLatin: ['Ａ', '５', 'ｚ'],
    space: [' ', '\u3000', '\u00a0', '\t'], punctJa: ['、', '。', '「', '〜', '・', '！', '（', '…', '‼', '｡'],
    punctLatin: ['!', '?', ',', '(', '-', '“', '¿'], emoji: ['😀', '👍🏽', '❤\ufe0f', '1\ufe0f\u20e3', '🇯🇵'],
    symbol: ['★', '♪', '©', '→', '\u0301'],
  };
  for (const [cls, chars] of Object.entries(cases)) {
    for (const ch of chars) assert.equal(S.charClass(ch), cls, JSON.stringify(ch));
  }
  assert.deepEqual([...S.CLASSES].sort(), Object.keys(cases).sort());
  assert.equal(S.charClass('漢字'), 'han', 'uses the first grapheme');
});

test('lineScript follows the §4.8 rules', () => {
  assert.equal(S.lineScript('夜明けの街', null), 'ja');
  assert.equal(S.lineScript('Fly highどこまでも', null), 'ja', 'kana wins over Latin');
  assert.equal(S.lineScript('사랑해 you', null), 'ko');
  assert.equal(S.lineScript('天空', 'ja'), 'ja', 'han with a Japanese sheet');
  assert.equal(S.lineScript('我愛你', null), 'zhHant');
  assert.equal(S.lineScript('我爱你', null), 'zhHans');
  assert.equal(S.lineScript('天空', null), 'zhHans', 'han with no unique form');
  assert.equal(S.lineScript('Good morning 2024', 'ja'), 'en', 'only Latin/digits → en');
  assert.equal(S.lineScript('１２３', null), 'en', 'fullwidth digits count as Latin/digits');
  assert.equal(S.lineScript('♪ ♪', 'ja'), 'ja', 'no letters → the sheet hint');
  assert.equal(S.lineScript('', null), 'en');
});

test('TRAD_ONLY and SIMP_ONLY are disjoint han tables of the same size', () => {
  const trad = [...S.TRAD_ONLY], simp = [...S.SIMP_ONLY];
  assert.equal(trad.length, simp.length);
  assert.ok(trad.length >= 180, 'about 200 characters each');
  assert.equal(new Set(trad).size, trad.length);
  assert.equal(new Set(simp).size, simp.length);
  for (const ch of trad) assert.ok(!S.SIMP_ONLY.includes(ch), ch);
  for (const ch of trad.concat(simp)) assert.equal(S.charClass(ch), 'han', ch);
  for (const ch of '后里云干台面只几才谷丑斗松表余复种据于伙') assert.ok(!S.SIMP_ONLY.includes(ch), 'shared form ' + ch);
});

test('cells: widths per class, exact sums', () => {
  assert.equal(S.cells(''), 0);
  assert.equal(S.cells('夜明けの街'), 5);
  assert.equal(S.cells('사랑'), 2);
  assert.equal(S.cells('ＡＢ、'), 3, 'fullwidth letters and punctuation');
  assert.equal(S.cells('ｱｲｳ'), 1.5, 'halfwidth katakana');
  assert.equal(S.cells('Fly high'), 4.15);
  assert.equal(S.cells('2024'), 2.2);
  assert.equal(S.cells('A B'), 1.4);
  assert.equal(S.cells('!?'), 1.2, 'other 0.6');
  assert.equal(S.cells('😀👨\u200d👩\u200d👧'), 2, 'emoji count as one cell each');
  assert.equal(S.cells('\u3000'), 1, 'ideographic space is fullwidth');
  assert.equal(S.cells('e\u0301'), 0.55, 'combining marks add nothing');
});

test('morae samples', () => {
  assert.equal(S.morae('きゃっと', 'ja'), 3, 'small ゃ 0, っ 1');
  assert.equal(S.morae('ラーメン', 'ja'), 4, 'ー 1');
  assert.equal(S.morae('東京', 'ja'), 3.4, 'han 1.7 in ja');
  assert.equal(S.morae('夜明けの街を走る', 'ja'), 1.7 * 4 + 4);
  assert.equal(S.morae('三ヶ月', 'ja'), 1.7 * 2 + 1, 'ヶ reads as a full mora');
  assert.equal(S.morae('사랑해요', 'ko'), 4);
  assert.equal(S.morae('我爱你', 'zhHans'), 3);
  assert.equal(S.morae('我愛你', 'zhHant'), 3);
  assert.equal(S.morae('Fly high morning', 'en'), 4);
  assert.equal(S.morae('rhythm', 'en'), 1, 'y inside a word is a vowel');
  assert.equal(S.morae('yesterday', 'en'), 3, 'a leading y is a consonant');
  assert.equal(S.morae('don’t stop', 'en'), 2, 'apostrophes stay inside words');
  assert.equal(S.morae('café', 'en'), 2);
  assert.equal(S.morae('2024年', 'ja'), 4 + 1.7, 'digits 1 each');
  assert.equal(S.morae('Fly highどこまでも', 'ja'), 7, 'Latin words inside ja lines');
  assert.equal(S.morae('…！ ♪', 'ja'), 0);
  assert.equal(S.morae('', 'en'), 0);
});

// The bound is on the least disturbed of several runs after a warm-up: one timed run failed now and then when the full
// suite shared the CPUs with other work (61.9 ms once, ≈ 10 ms alone), which measures the machine, not the code.
test('script functions are fast enough for the planner', () => {
  const line = '始発のホームに白い息 Good morning 🇯🇵 사랑해';
  const run = () => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 300; i++) { S.cells(line); S.morae(line, 'ja'); S.lineScript(line, null); S.graphemes(line); }
    return Number(process.hrtime.bigint() - t0) / 1e6;
  };
  run();
  const ms = Math.min(...Array.from({ length: 5 }, run));
  assert.ok(ms < 60, `300 lines took ${ms.toFixed(2)} ms (best of 5)`);
});
