/* 文字PVメーカー v2 — original work. Tests for core/lyrics: row grammar, sheet, line order, renderer (DESIGN §4.9). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const L = MV.use('core/lyrics');
const S = MV.use('core/script');
const { stream } = MV.use('core/rng');

function fields(row) {
  const { stamps, text, pieces, emph, impact, note } = row;
  return { stamps, text, pieces, emph, impact, note };
}
function lyric(src) { return fields(L.parseRow(src)); }
function base(over) {
  return Object.assign({ stamps: [], text: '', pieces: null, emph: [], impact: false, note: null }, over);
}

test('row kinds: blank, comment, meta, lyric', () => {
  assert.equal(L.parseRow('').kind, 'blank');
  assert.equal(L.parseRow('   \t ').kind, 'blank');
  const c = L.parseRow('  # サビ  ');
  assert.equal(c.kind, 'comment');
  assert.equal(c.heading, 'サビ');
  assert.equal(L.parseRow('#').heading, null, 'an empty heading is null');
  const m = L.parseRow('[ti:夜明けのうた]');
  assert.deepEqual([m.kind, m.tag, m.value, m.text], ['meta', 'ti', '夜明けのうた', '']);
  for (const tag of ['ar', 'al', 'by', 'offset', 're', 've', 'AR', 'Ti']) {
    assert.equal(L.parseRow('[' + tag + ':x]').kind, 'meta', tag);
  }
  assert.equal(L.parseRow('[mood:blue]').kind, 'lyric', 'unknown tags are text');
  assert.equal(L.parseRow('[ti:x] more').kind, 'lyric', 'meta must be the whole row');
  assert.equal(L.parseRow('\\# not a comment').text, '# not a comment');
  const r = L.parseRow('夜明けの街');
  assert.deepEqual(Object.keys(r), ['kind', 'stamps', 'text', 'pieces', 'emph', 'impact', 'note', 'heading', 'script',
    'tag', 'value']);
  assert.equal(r.script, 'ja');
});

test('LRC stamps in every accepted form, enhanced word tags removed', () => {
  assert.deepEqual(lyric('[00:41.20][01:32.00]君の名前を'), base({ stamps: [41.2, 92], text: '君の名前を' }));
  assert.deepEqual(lyric('[00:12]a').stamps, [12]);
  assert.deepEqual(lyric('[00:12:05]a').stamps, [12.05]);
  assert.deepEqual(lyric('[0:44.125]a').stamps, [44.125]);
  assert.deepEqual(lyric('[01:02.5]a').stamps, [62.5]);
  assert.deepEqual(lyric('[00:01.00] [00:02.00] a').stamps, [1, 2], 'spaces between stamps');
  assert.equal(lyric('[00:01.00] a').text, 'a');
  assert.deepEqual(lyric('a [00:01.00]'), base({ text: 'a [00:01.00]' }), 'only leading stamps count');
  assert.equal(lyric('Good <00:09.10>morning, <00:10.00>little bird').text, 'Good morning, little bird');
  assert.deepEqual(lyric('[00:30.00]'), base({ stamps: [30] }), 'a stamp alone is a lyric row with empty text');
});

test('pieces, whitespace around "/" and empty pieces', () => {
  assert.deepEqual(lyric('夜明けの/街を走る'), base({ text: '夜明けの街を走る', pieces: [[0, 4], [4, 8]] }));
  assert.deepEqual(lyric('Hello / world').pieces, [[0, 6], [6, 11]]);
  assert.equal(lyric('Hello   /   world').text, 'Hello world', 'whitespace collapses to one space');
  assert.equal(lyric('Hello/ world').text, 'Hello world');
  assert.equal(lyric('Hello /world').text, 'Hello world');
  assert.equal(lyric('Hello/world').text, 'Helloworld', 'no space is added when there was none');
  assert.deepEqual(lyric('a//b').pieces, [[0, 1], [1, 2]], 'empty pieces are dropped');
  assert.deepEqual(lyric('/ a /').pieces, [[0, 1]]);
  assert.deepEqual(lyric('a / / b'), base({ text: 'a b', pieces: [[0, 2], [2, 3]] }));
  assert.equal(lyric('abc').pieces, null, 'null when there is no "/"');
  assert.equal(lyric('a\\/b').pieces, null, 'an escaped "/" is text');
});

test('emphasis: ranges, unmatched final star, escapes', () => {
  assert.deepEqual(lyric('夜明けの/*街*を走る'), base({ text: '夜明けの街を走る', pieces: [[0, 4], [4, 8]], emph: [[4, 5]] }));
  assert.deepEqual(lyric('*a* b *c*').emph, [[0, 1], [4, 5]]);
  assert.deepEqual(lyric('*a*/b').emph, [[0, 1]]);
  assert.deepEqual(lyric('*a/b*').emph, [[0, 2]], 'emphasis may span a cut');
  assert.deepEqual(lyric('*a*b*'), base({ text: 'ab*', emph: [[0, 1]] }), 'unmatched final "*" is literal');
  assert.deepEqual(lyric('*odd'), base({ text: '*odd' }));
  assert.deepEqual(lyric('a**b').emph, [], 'empty emphasis is dropped');
  assert.deepEqual(lyric('\\*a\\*').emph, []);
  assert.equal(lyric('\\*a\\*').text, '*a*');
});

test('notes, impact, and every escape', () => {
  assert.deepEqual(lyric('まだ遠い空の|そら'), base({ text: 'まだ遠い空の', note: 'そら' }));
  assert.deepEqual(lyric('a | b | c'), base({ text: 'a', note: 'b | c' }), 'the first "|" splits');
  assert.equal(lyric('a|  ').note, null, 'an empty note is null');
  assert.deepEqual(lyric('届くまで!'), base({ text: '届くまで', impact: true }));
  assert.deepEqual(lyric('Yeah!!'), base({ text: 'Yeah!', impact: true }), '"!!" removes one');
  assert.deepEqual(lyric('Yeah ! '), base({ text: 'Yeah', impact: true }));
  assert.deepEqual(lyric('届くまで!|note'), base({ text: '届くまで', impact: true, note: 'note' }));
  assert.deepEqual(lyric('a|note!'), base({ text: 'a', note: 'note!' }), '"!" after the note is note text');
  assert.deepEqual(lyric('Hi! there'), base({ text: 'Hi! there' }), 'an inner "!" is text');
  assert.deepEqual(lyric('やった！'), base({ text: 'やった！' }), 'fullwidth ！ is text');
  assert.deepEqual(lyric('a\\!'), base({ text: 'a!' }));
  assert.equal(lyric('\\/\\*\\|\\!\\#\\[\\\\').text, '/*|!#[\\');
  assert.equal(lyric('a\\b').text, 'a\\b', 'a backslash before another character is literal');
  assert.equal(lyric('\\[00:01.00]a').text, '[00:01.00]a');
  assert.deepEqual(lyric('x|a\\\\b').note, 'a\\b', 'escapes resolve in notes too');
});

test('offsets fall on grapheme boundaries (rule 9)', () => {
  const r = lyric('e*\u0301x*');
  assert.equal(r.text, 'e\u0301x');
  assert.deepEqual(r.emph, [[0, 3]], 'a range that splits a grapheme is widened');
  assert.deepEqual(lyric('e/\u0301x').pieces, [[0, 3]], 'a cut inside a grapheme moves to its start');
  assert.deepEqual(lyric('😀/😀').pieces, [[0, 2], [2, 4]]);
  assert.deepEqual(lyric('*👨\u200d👩*\u200d👧').emph, [[0, 8]]);
});

test('parseRow never throws and keeps its invariants on random rows', () => {
  const alphabet = ['あ', 'A', ' ', '/', '*', '|', '!', '#', '[', ']', '\\', ':', '0', '漢', '😀', '\u0301', '<', '>', '.'];
  const rng = stream('lyrics-fuzz');
  for (let n = 0; n < 2000; n++) {
    let src = '';
    const len = rng.int(0, 16);
    for (let i = 0; i < len; i++) src += rng.pick(alphabet);
    const r = L.parseRow(src);
    const offs = new Set(S.graphemeOffsets(r.text));
    assert.equal(r.text, r.text.trim(), src);
    for (const [a, b] of r.emph) assert.ok(a < b && offs.has(a) && offs.has(b), src);
    if (r.pieces) {
      assert.equal(r.pieces[0][0], 0, src);
      assert.equal(r.pieces[r.pieces.length - 1][1], r.text.length, src);
      r.pieces.forEach(([a, b], k) => {
        assert.ok(a < b && offs.has(a) && offs.has(b), src);
        if (k > 0) assert.equal(a, r.pieces[k - 1][1], src);
      });
    }
  }
});

test('parseSheet: meta from the first [ti:]/[ar:] rows, the kana hint, ids', () => {
  const sheet = L.parseSheet([
    { id: 'r1', src: '[ti:最初]' }, { id: 'r2', src: '[ti:二番目]' }, { id: 'r3', src: '[ar:]' },
    { id: 'r4', src: '天空' }, { id: 'r5', src: 'ひかり' },
  ]);
  assert.deepEqual(sheet.meta, { title: '最初', artist: null });
  assert.deepEqual(sheet.rows.map((r) => r.id), ['r1', 'r2', 'r3', 'r4', 'r5']);
  assert.equal(sheet.rows[3].script, 'ja', 'han-only line in a sheet with kana');
  assert.equal(L.parseSheet([{ id: 'r1', src: '天空' }]).rows[0].script, 'zhHans');
  assert.deepEqual(L.parseSheet([]), { meta: { title: null, artist: null }, rows: [] });
});

test('linesOf: primary lines, pauses, headings, languages', () => {
  const rows = ['[ti:T]', '# Aメロ', 'いち', '', '', '# サビ', 'に', 'three', 'よん', 'ご', '[00:30.00]', 'ろく']
    .map((src, i) => ({ id: 'r' + (i + 1).toString(36), src }));
  const lines = L.linesOf(L.parseSheet(rows));
  assert.deepEqual(lines.map((l) => l.id), ['r3', 'r7', 'r8', 'r9', 'ra', 'rc']);
  assert.deepEqual(lines.map((l) => l.index), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(lines.map((l) => l.pauseBefore), [0, 2, 0, 0, 0, 1], 'comments are transparent; stamp-only rows pause');
  assert.deepEqual(lines.map((l) => l.heading), ['Aメロ', 'サビ', 'サビ', 'サビ', null, null], 'within 3 rows above');
  assert.deepEqual(lines.map((l) => l.lang), ['ja', 'ja', 'en', 'ja', 'ja', 'ja']);
  assert.deepEqual(L.linesOf(L.parseSheet(rows), { lang: 'ko' }).map((l) => l.lang), Array(6).fill('ko'));
  const first = lines[0];
  assert.deepEqual(Object.keys(first), ['id', 'row', 'occ', 'index', 'text', 'pieces', 'emph', 'impact', 'note', 'lang',
    'stamp', 'pauseBefore', 'heading']);
  assert.deepEqual([first.row, first.occ, first.stamp, first.text], ['r3', 0, null, 'いち']);
});

function order(srcs) {
  const rows = srcs.map((src, i) => ({ id: 'r' + (i + 1), src }));
  return L.linesOf(L.parseSheet(rows)).map((l) => l.id + (l.stamp === null ? '' : '@' + l.stamp));
}

test('linesOf: the FROZEN multi-stamp order (§4.9.3)', () => {
  const { doc } = corpus.project('lrc');
  const lines = L.linesOf(L.parseSheet(doc.sheet.rows));
  assert.deepEqual(lines.map((l) => l.id),
    ['r3', 'r4', 'r5', 'r6', 'r8', 'r9', 'ra', 'rb', 'rc', 'r8.1', 'r9.1', 'rd']);
  const extra = lines.find((l) => l.id === 'r8.1');
  assert.deepEqual([extra.row, extra.occ, extra.stamp, extra.pauseBefore], ['r8', 1, 48, 0]);
  assert.equal(lines.find((l) => l.id === 'r8').pauseBefore, 1, 'first occurrence only');

  assert.deepEqual(order(['[00:10]a', '[00:20][00:05]b']), ['r2.1@5', 'r1@10', 'r2@20'], 'no earlier stamp → start');
  assert.deepEqual(order(['[00:10]a', '[00:20][00:10]b']), ['r1@10', 'r2.1@10', 'r2@20'], 'ties go after');
  assert.deepEqual(order(['[00:10][00:40]a', 'b', '[00:30]c', 'd']), ['r1@10', 'r2', 'r3@30', 'r1.1@40', 'r4'],
    'untagged lines stay where they were written');
  assert.deepEqual(order(['[00:50]a', '[00:20]b', '[00:30][00:25]c']), ['r1@50', 'r2@20', 'r3.1@25', 'r3@30'],
    'the last line (in list order) whose stamp is ≤');
  assert.deepEqual(order(['[00:10][00:30][00:20]a']), ['r1@10', 'r1.2@20', 'r1.1@30'], 'extras sorted by stamp');
});

test('lrcTag and PLAIN', () => {
  assert.equal(L.lrcTag(0), '[00:00.00]');
  assert.equal(L.lrcTag(41.2), '[00:41.20]');
  assert.equal(L.lrcTag(92), '[01:32.00]');
  assert.equal(L.lrcTag(59.996), '[01:00.00]', 'rounds to centiseconds before splitting');
  assert.equal(L.lrcTag(6005.5), '[100:05.50]');
  assert.equal(L.lrcTag(-3), '[00:00.00]');
  assert.equal(L.PLAIN('[00:01.00]夜明けの/*街*を走る!|note'), '夜明けの街を走る');
  assert.equal(L.PLAIN('# heading'), '');
  assert.equal(L.PLAIN('[ti:x]'), '');
});

test('renderRow: marks at offsets and escapes', () => {
  assert.equal(L.renderRow(base({ stamps: [41.2, 92], text: '君の名前を呼ぶ声が', pieces: [[0, 5], [5, 9]] })),
    '[00:41.20][01:32.00]君の名前を/呼ぶ声が');
  assert.equal(L.renderRow(base({ text: '夜明けの街を走る', pieces: [[0, 4], [4, 8]], emph: [[4, 5]] })), '夜明けの/*街*を走る');
  assert.equal(L.renderRow(base({ text: 'Hello world', pieces: [[0, 6], [6, 11]] })), 'Hello / world');
  assert.equal(L.renderRow(base({ text: 'a/b*c|d\\e' })), 'a\\/b\\*c\\|d\\\\e');
  assert.equal(L.renderRow(base({ text: '#tag' })), '\\#tag');
  assert.equal(L.renderRow(base({ stamps: [1], text: '#tag' })), '[00:01.00]#tag');
  assert.equal(L.renderRow(base({ text: '[ti:x]' })), '\\[ti:x]');
  assert.equal(L.renderRow(base({ text: 'Yeah!' })), 'Yeah\\!');
  assert.equal(L.renderRow(base({ text: 'Yeah!', impact: true })), 'Yeah!!');
  assert.equal(L.renderRow(base({ text: 'Hi! there' })), 'Hi! there');
  assert.equal(L.renderRow(base({ text: 'a', note: 'x\\y' })), 'a|x\\\\y');
  assert.equal(L.renderRow(base({ text: 'ab', emph: [[1, 2], [0, 1]] })), '*a**b*', 'emphasis sorted');
  assert.equal(L.renderRow(base({ text: 'abc', pieces: [[0, 3]] })), 'abc/', 'a single piece keeps its "/"');
  assert.equal(L.renderRow(base({ stamps: [44.125], text: 'x' })), '[00:44.125]x', 'milliseconds survive');
  assert.equal(L.renderRow({ text: 'plain' }), 'plain', 'missing fields default');
});

test('roundTrip over every fixture and sample row', () => {
  const srcs = [];
  for (const { doc } of corpus.projects()) for (const r of doc.sheet.rows) srcs.push(r.src);
  srcs.push(...L.SAMPLE_JA.split('\n'), ...L.SAMPLE_EN.split('\n'));
  let lyricRows = 0;
  for (const src of srcs) {
    const parsed = L.parseRow(src);
    if (parsed.kind !== 'lyric') continue;
    lyricRows++;
    const { src: again, ok } = L.roundTrip(parsed, {});
    assert.ok(ok, src + ' → ' + again);
    assert.deepEqual(fields(L.parseRow(again)), fields(parsed), src);
  }
  assert.ok(lyricRows > 150);
});

test('roundTrip applies field changes and refuses what cannot be written', () => {
  const parsed = L.parseRow('夜明けの/街を走る');
  assert.deepEqual(L.roundTrip(parsed, { emph: [[4, 5]] }), { src: '夜明けの/*街*を走る', ok: true });
  assert.deepEqual(L.roundTrip(parsed, { impact: true, note: 'よあけ' }), { src: '夜明けの/街を走る!|よあけ', ok: true });
  assert.deepEqual(L.roundTrip(parsed, { pieces: null }), { src: '夜明けの街を走る', ok: true });
  assert.equal(L.roundTrip(parsed, { stamps: [3.5] }).src, '[00:03.50]夜明けの/街を走る');
  assert.equal(L.roundTrip(parsed, { emph: [[0, 3], [2, 5]] }).ok, false, 'overlapping emphasis');
  assert.equal(L.roundTrip(L.parseRow('😀x'), { pieces: [[0, 1], [1, 3]] }).ok, false, 'a cut inside a grapheme');
  assert.equal(L.roundTrip(parsed, { text: ' 夜明け' }).ok, false, 'leading whitespace is lost');
  assert.equal(L.roundTrip(parsed, { text: 'a <00:01.00> b', pieces: null }).ok, false, 'word tags are removed');
  assert.equal(L.roundTrip(L.parseRow('a b'), { pieces: [[0, 1], [1, 3]] }).ok, false, 'a piece cannot start with a space');
  assert.deepEqual(L.roundTrip(L.parseRow('a b'), { pieces: [[0, 2], [2, 3]] }), { src: 'a / b', ok: true });
});

test('renderRow ∘ parseRow is the identity on random writable fields', () => {
  const chars = ['あ', 'い', 'A', 'b', '/', '*', '|', '!', '#', '[', '\\', '漢', '😀', 'e\u0301', '.'];
  const rng = stream('render-fuzz');
  for (let n = 0; n < 1500; n++) {
    const gs = [];
    const len = rng.int(1, 10);
    for (let i = 0; i < len; i++) gs.push(rng.pick(chars));
    const text = gs.join('');
    const offs = Array.from(S.graphemeOffsets(text));
    const cutAt = offs.slice(1, -1).filter(() => rng.chance(0.3));
    const pieces = cutAt.length ? [0, ...cutAt].map((a, k, all) => [a, k + 1 < all.length ? all[k + 1] : text.length]) : null;
    const emph = [];
    for (let k = 0; k + 1 < offs.length; k++) if (rng.chance(0.25)) emph.push([offs[k], offs[k + 1]]);
    const want = base({ text, pieces, emph, impact: rng.chance(0.3), note: rng.chance(0.3) ? 'n\\o|te' : null,
      stamps: rng.chance(0.3) ? [rng.int(0, 5999) / 100] : [] });
    const src = L.renderRow(want);
    assert.deepEqual(fields(L.parseRow(src)), want, src);
    assert.equal(L.roundTrip(L.parseRow(src), {}).ok, true, src);
  }
});

test('samples: SAMPLE_JA is the fixture text; SAMPLE_EN parses cleanly', () => {
  assert.equal(L.SAMPLE_JA, corpus.sampleLyrics().replace(/\n$/, ''));
  const en = L.parseSheet(L.SAMPLE_EN.split('\n').map((src, i) => ({ id: 'r' + (i + 1).toString(36), src })));
  assert.deepEqual(en.meta, { title: 'Paper Plane Morning', artist: 'Sample Band' });
  const lines = L.linesOf(en);
  assert.equal(lines.length, 15);
  assert.ok(lines.every((l) => l.lang === 'en'));
  assert.ok(lines.some((l) => l.emph.length) && lines.some((l) => l.impact) && lines.some((l) => l.note));
});

test('the other standard LRC ID tags are meta rows too (final fixes, flows-10 / spec-2)', () => {
  for (const src of ['[length: 03:20]', '[length:04:12]', '[au:作者]', '[AU:someone]', '[tool:LRC Maker]', '[#:comment]',
    '  [Length:3:12]  ', '[ti:x]', '[offset:+250]']) {
    const row = L.parseRow(src);
    assert.equal(row.kind, 'meta', src);
    assert.equal(L.isMetaRow(src), true, src);
  }
  assert.equal(L.parseRow('[#:a note]').tag, '#');
  assert.equal(L.parseRow('[au:作詞者]').value, '作詞者');
  for (const src of ['[mood:blue]', '[00:05.00]はじまり', '[au:x] more', '夜明け', '#:x']) assert.equal(L.isMetaRow(src), false, src);
  const text = '[ti:夜明け]\n[ar:誰か]\n[au:作詞者]\n[length:03:12]\n[by:me]\n[tool:LRC Maker]\n[#:made by hand]\n'
    + '[00:05.00]はじまりの朝\n[00:09.50]窓をあけて';
  const sheet = L.parseSheet(text.split('\n').map((src, i) => ({ id: 'r' + (i + 1), src })));
  const lines = L.linesOf(sheet, {});
  assert.deepEqual(lines.map((l) => [l.text, l.stamp]), [['はじまりの朝', 5], ['窓をあけて', 9.5]]);
  assert.deepEqual(sheet.meta, { title: '夜明け', artist: '誰か' });
  // a lyric that really starts with such a tag stays a lyric through the renderer's escape
  const src = L.renderRow({ text: '[au:x]' });
  assert.equal(L.parseRow(src).kind, 'lyric');
  assert.equal(L.parseRow(src).text, '[au:x]');
});
