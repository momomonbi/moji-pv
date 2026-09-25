/* 文字PVメーカー v2 — original work. Tests for engine/text/breaker: kinsoku sets, phrases, words, columns, lines (DESIGN §4.15.3). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const B = MV.use('engine/text/breaker');
const S = MV.use('core/script');

const pieces = (text, ranges) => ranges.map(([a, b]) => text.slice(a, b));

// Brute force: the smallest possible widest piece when `widths` (in order) are split into exactly k groups.
function bestSplit(widths, k) {
  if (k === 1) return widths.reduce((a, b) => a + b, 0);
  let best = Infinity;
  for (let i = 1; i <= widths.length - k + 1; i++) {
    const head = widths.slice(0, i).reduce((a, b) => a + b, 0);
    best = Math.min(best, Math.max(head, bestSplit(widths.slice(i), k - 1)));
  }
  return best;
}
const phr = (text, lang) => pieces(text, B.phrases(text, lang));

test('NO_START and NO_END are the FROZEN sets', () => {
  assert.equal(B.NO_START, '、。，．・：；？！‼⁉ー」』）］】〕〉》｝ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ々〻…‥〜～)]},.!?:;');
  assert.equal(B.NO_END, '「『（［【〔〈《｛([{');
});

test('phrases (ja): particles end a phrase before non-hiragana, or once the phrase is 6 graphemes long', () => {
  assert.deepEqual(phr('夜明けの街を走る', 'ja'), ['夜明けの', '街を', '走る']);
  assert.deepEqual(phr('君の名前を呼ぶ声が', 'ja'), ['君の', '名前を', '呼ぶ声が']);
  assert.deepEqual(phr('私はここにいる', 'ja'), ['私はここにいる'], 'short chunks before hiragana stay whole');
  assert.deepEqual(phr('ずっとずっとまでも', 'ja'), ['ずっとずっと', 'までも'], 'a 6-grapheme chunk may end before hiragana');
  assert.deepEqual(phr('空から降る', 'ja'), ['空から', '降る'], 'two-character particles');
  assert.deepEqual(phr('はな', 'ja'), ['はな'], 'a lone particle character does not form a phrase');
});

test('phrases (ja): after 、 and 。, at spaces and at script changes; brackets obey kinsoku', () => {
  assert.deepEqual(phr('ねえ、聞いて。まだ', 'ja'), ['ねえ、', '聞いて。', 'まだ']);
  assert.deepEqual(phr('君とLove', 'ja'), ['君と', 'Love']);
  assert.deepEqual(phr('Love!君', 'ja'), ['Love!', '君']);
  assert.deepEqual(phr('夜 明け', 'ja'), ['夜', '明け']);
  assert.deepEqual(phr('「夢を」見た', 'ja'), ['「夢を」', '見た'], 'a closing bracket stays with its phrase');
  assert.deepEqual(phr('君と「夢」を', 'ja'), ['君と', '「夢」を'], 'an opening bracket starts the next phrase');
  assert.deepEqual(phr('12月に', 'ja'), ['12月に'], 'digits do not count as a script change');
});

test('phrases for en, ko and zh', () => {
  assert.deepEqual(phr('I love you', 'en'), ['I', 'love', 'you']);
  assert.deepEqual(phr('  spaced   out ', 'en'), ['spaced', 'out']);
  assert.deepEqual(phr('사랑해 너를', 'ko'), ['사랑해', '너를']);
  assert.deepEqual(phr('我爱你', 'zhHans'), ['我', '爱', '你']);
  assert.deepEqual(phr('你好，世界', 'zhHans'), ['你', '好，', '世', '界'], 'punctuation joins the han before it');
  assert.deepEqual(phr('我们一起走过春夏秋冬', 'zhHans'), ['我们', '一起', '走过', '春夏', '秋冬'], 'paired when > 8 graphemes');
  assert.deepEqual(phr('我愛你', undefined), ['我愛你'], 'without a lang the script is detected (ja hint: han alone reads as ja)');
  assert.deepEqual(phr('', 'ja'), []);
});

test('words: phrases for ja/zh, space-separated for en/ko', () => {
  assert.deepEqual(B.words('夜明けの街を走る', 'ja'), B.phrases('夜明けの街を走る', 'ja'));
  assert.deepEqual(pieces('run to you', B.words('run to you', 'en')), ['run', 'to', 'you']);
});

// Every boundary between two touching ranges (no space between them) obeys kinsoku: the range before does not end
// with an opener and the range after does not start with a NO_START character. Edges of the text and spaces are
// hard boundaries, so only touching ranges are checked.
function kinsokuViolations(text, ranges) {
  const bad = [];
  for (let i = 1; i < ranges.length; i++) {
    const [a0, a1] = ranges[i - 1], [b0, b1] = ranges[i];
    if (a1 !== b0) continue;
    const before = [...text.slice(a0, a1)].pop(), after = [...text.slice(b0, b1)][0];
    if (B.NO_END.includes(before)) bad.push(`"${text.slice(a0, a1)}" ends with ${before}`);
    if (B.NO_START.includes(after)) bad.push(`"${text.slice(b0, b1)}" starts with ${after}`);
  }
  return bad;
}

test('phrases and words: an opening bracket never ends a unit or stands alone (kinsoku on every boundary)', () => {
  assert.deepEqual(phr('君「Love」', 'ja'), ['君', '「Love」']);
  assert.deepEqual(phr('夜明けの君「Love song」', 'ja'), ['夜明けの', '君', '「Love', 'song」']);
  assert.deepEqual(phr('君「「Love」」', 'ja'), ['君', '「「Love」」'], 'several openers go together');
  assert.deepEqual(phr('「你好」世界', 'zhHant'), ['「你', '好」', '世', '界']);
  assert.deepEqual(phr('（笑）', 'zhHans'), ['（笑）']);
  assert.deepEqual(phr('我们一起「走过」春夏秋冬', 'zhHans'), ['我们', '一起', '「走过」', '春夏', '秋冬']);
  const samples = [['君「Love」', 'ja'], ['夜明けの君「Love song」', 'ja'], ['「你好」世界', 'zhHant'], ['（笑）', 'zhHans'],
    ['私は（笑）ね', 'ja'], ['ねえ「君」、『夢』を見た', 'ja'], ['【速報】君が好き', 'ja'], ['「我」爱《你》', 'zhHans']];
  for (const [text, lang] of samples) {
    for (const fn of [B.phrases, B.words]) {
      const ranges = fn(text, lang);
      assert.deepEqual(kinsokuViolations(text, ranges), [], `${fn.name}(${text}, ${lang})`);
      for (const [a, b] of ranges) assert.ok(!B.NO_END.includes(text.slice(a, b)), `a lone opener in ${text}`);
    }
  }
});

test('phrases: kinsoku holds on every boundary of random ja and zh texts', () => {
  const alphabet = [...'夜明けの君と夢を見た走るぁっャー「」『』（）【】、。！？'].concat(['Love', 'song', '12', ' ']);
  let seed = 12345;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 1500; k++) {
    let text = '';
    const len = 1 + Math.floor(next() * 14);
    for (let i = 0; i < len; i++) text += alphabet[Math.floor(next() * alphabet.length)];
    for (const lang of ['ja', 'zhHans']) {
      const ranges = B.phrases(text, lang);
      assert.deepEqual(kinsokuViolations(text, ranges), [], `${lang}: ${JSON.stringify(text)} → ${JSON.stringify(pieces(text, ranges))}`);
    }
  }
});

test('breakLines: first fit within maxCells; no line starts with NO_START or ends with NO_END', () => {
  const text = 'あいうえお、かきくけこ。さしすせそ「たちつ」てと';
  for (const mode of ['phrase', 'char']) {
    for (let max = 2; max <= 12; max++) {
      const lines = pieces(text, B.breakLines(text, max, 'ja', mode));
      assert.equal(lines.join(''), text, `${mode}/${max}: lines cover the text`);
      for (const line of lines) {
        assert.ok(!B.NO_START.includes(line[0]), `${mode}/${max}: "${line}" starts with ${line[0]}`);
        assert.ok(!B.NO_END.includes(line[line.length - 1]), `${mode}/${max}: "${line}" ends with an opener`);
      }
    }
  }
  const lines = pieces(text, B.breakLines(text, 6, 'ja', 'char'));
  for (const line of lines) assert.ok(S.cells(line) <= 7, `"${line}" is at most one kinsoku character over`);
  assert.deepEqual(pieces('I love you so', B.breakLines('I love you so', 4, 'en', 'phrase')), ['I love', 'you so']);
  assert.deepEqual(pieces('I love you so', B.breakLines('I love you so', 6, 'en', 'phrase')), ['I love you', 'so']);
  assert.deepEqual(pieces('夜明けの街', B.breakLines('夜明けの街', 2, 'ja', 'none')), ['夜明けの街']);
});

test('columns: balanced pieces at phrase boundaries, never more pieces than phrases', () => {
  const text = '君の名前を呼ぶ声が';
  assert.deepEqual(pieces(text, B.columns(text, 1, 'ja')), [text]);
  assert.deepEqual(pieces(text, B.columns(text, 2, 'ja')), ['君の名前を', '呼ぶ声が'], 'max 5 cells beats 2 + 7');
  assert.deepEqual(pieces(text, B.columns(text, 3, 'ja')), ['君の', '名前を', '呼ぶ声が']);
  assert.deepEqual(pieces(text, B.columns(text, 5, 'ja')), ['君の', '名前を', '呼ぶ声が']);
  const long = '春の日差しの中で君と歩いた道をいつまでも覚えている';
  const units = pieces(long, B.phrases(long, 'ja'));
  for (let n = 1; n <= 5; n++) {
    const cols = pieces(long, B.columns(long, n, 'ja'));
    assert.equal(cols.length, Math.min(n, units.length));
    assert.equal(cols.join(''), long);
    for (const c of cols) assert.ok(!B.NO_START.includes(c[0]));
    const widest = Math.max(...cols.map((c) => S.cells(c)));
    assert.equal(widest, bestSplit(units.map((p) => S.cells(p)), cols.length), `${n}: ${cols} is not the most balanced`);
  }
  assert.deepEqual(B.columns('', 3, 'ja'), []);
});

test('balance picks the smallest widest line, then the most even split, earliest break on ties', () => {
  const u = B.analyze('あいうえおかきくけこ');
  const opps = B.opportunities(u, 'ja', 'char');
  const lines = B.balance(u, opps, B.widthFn(u, u.cells), 3);
  assert.deepEqual(lines, [[0, 3], [3, 6], [6, 10]]);
  const two = B.balance(u, opps, B.widthFn(u, u.cells), 2);
  assert.deepEqual(two, [[0, 5], [5, 10]]);
  assert.deepEqual(B.balance(u, [], B.widthFn(u, u.cells), 4), [[0, 10]], 'no opportunities: one line');
});

test('phrases (ja): a particle never splits a word before hiragana (final fixes, ux-8 and the QA な/も note)', () => {
  // the lines that split words mid-way (「まだ名前のな」「い今日へ」, 「強くな|れる」, 「世界な|んて」, 「靴ひも|を」,
  // 「っても|う一度」, 「言えな|かった」)
  assert.deepEqual(phr('まだ名前のない今日へ行く', 'ja'), ['まだ名前の', 'ない今日へ', '行く']);
  assert.deepEqual(phr('折り目の数だけ強くなれる', 'ja'), ['折り目の', '数だけ強くなれる']);
  assert.deepEqual(phr('君のいない世界なんて', 'ja'), ['君のいない世界なんて']);
  assert.deepEqual(phr('ほどけた靴ひもを結び直して', 'ja'), ['ほどけた靴ひもを', '結び直して']);
  assert.deepEqual(phr('「ねえ、ちょっと待って」ってもう一度言えなかったー', 'ja'),
    ['「ねえ、', 'ちょっと', '待って」ってもう', '一度言えなかったー']);
  // what still ends a phrase before hiragana: a long chunk's case particle or も, and の は を へ after a word
  assert.deepEqual(phr('向かい風でもかまわないさ', 'ja'), ['向かい風でも', 'かまわないさ']);
  assert.deepEqual(phr('そしてここでもう一度', 'ja'), ['そしてここで', 'もう一度']);
  assert.deepEqual(phr('昨日のため息を置いてきた', 'ja'), ['昨日の', 'ため息を', '置いてきた']);
  assert.deepEqual(phr('切符をそっと握って', 'ja'), ['切符を', 'そっと', '握って']);
  // …but not inside one-kanji words written with kana, nor between stacked particles
  assert.deepEqual(phr('影ぼうしが背のびをする', 'ja'), ['影ぼうしが', '背のびをする']);
  assert.deepEqual(phr('手のひら', 'ja'), ['手のひら']);
  assert.deepEqual(phr('何度繰り返してでも', 'ja'), ['何度繰り返してでも']);
  assert.deepEqual(phr('今日のは誰', 'ja'), ['今日のは', '誰']);
  assert.deepEqual(phr('もっともっと遠くへ', 'ja'), ['もっともっと', '遠くへ']);
  // a long chunk also ends before a kanji that follows hiragana (not after the prefixes お ご)
  assert.deepEqual(phr('飛ばせ紙ひこうき空の果てまで', 'ja'), ['飛ばせ紙ひこうき', '空の', '果てまで']);
  assert.deepEqual(phr('たくさんのお祭り', 'ja'), ['たくさんのお祭り']);
  assert.deepEqual(phr('ここにいる時', 'ja'), ['ここにいる時'], 'a short chunk stays whole');
  // the emphasis chips and per-word motions use the same units
  assert.deepEqual(pieces('まだ名前のない今日へ行く', B.words('まだ名前のない今日へ行く', 'ja')), ['まだ名前の', 'ない今日へ', '行く']);
});
