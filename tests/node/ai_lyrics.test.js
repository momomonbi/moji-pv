/* 文字PVメーカー v2 — original work. Tests for ai/lyricio and ai/prep: checked rendering, row edits, 歌詞の下ごしらえ (DESIGN §4.22.2, §4.22.4, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { deepEqual } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const IO = MV.use('ai/lyricio');
const PREP = MV.use('ai/prep');
const CH = MV.use('ai/changes');
const L = MV.use('core/lyrics');
const D = MV.use('core/doc');
const CMD = MV.use('core/commands');
const ST = MV.use('core/store');

const SYNTAX = [
  '# comment', '[ti:テスト]', '夜明けの色を/覚えてる|よあけ', '*透明*なままじゃ終われない!', '', 'ほどけた声が遠くで鳴った',
  'Hello/world', '[00:12.50][00:30.00]ねえ、まだ間に合うかな',
].join('\n');

function docOf(text) { return CMD.reduce(D.defaultDoc(), { t: 'lyrics.set', text }); }
function idOf(doc, src) { return doc.sheet.rows.find((r) => r.src === src).id; }
function textOf(doc) { return doc.sheet.rows.map((r) => r.src).join('\n'); }
function answer(i, fields) { return Object.assign({ i, remove: false, reason: '', segments: [], emphasis: [], reading: '' }, fields); }

test('rowsView: one view per row, parsed fields on lyric rows, count = times sung', () => {
  const doc = docOf(SYNTAX);
  const view = IO.rowsView(doc);
  assert.equal(view.length, doc.sheet.rows.length);
  deepEqual(view.map((r) => [r.kind, r.lyric, r.count]), [
    ['comment', false, 0], ['meta', false, 0], ['lyric', true, 1], ['lyric', true, 1], ['blank', false, 0],
    ['lyric', true, 1], ['lyric', true, 1], ['lyric', true, 2]]);
  const r = view[2];
  deepEqual([r.text, r.pieces, r.note], ['夜明けの色を覚えてる', [[0, 6], [6, 10]], 'よあけ']);
  deepEqual([view[3].emph, view[3].impact], [[[0, 2]], true]);
  deepEqual(view[7].stamps, [12.5, 30]);
  assert.equal(view[0].rowId, doc.sheet.rows[0].id);
});

test('renderChecked: every fixture and sample row renders back to the same fields', () => {
  const texts = [SYNTAX, L.SAMPLE_JA, L.SAMPLE_EN, corpus.sampleLyrics(), 'a/b/c!|n', '*光*の中で!', '[01:02.03]タグ付き/の行|よみ'];
  for (const name of corpus.PROJECTS) texts.push(textOf(corpus.project(name).doc));
  for (const text of texts) {
    for (const row of IO.rowsView(docOf(text)).filter((r) => r.lyric)) {
      const res = IO.renderChecked(row, {});
      assert.ok(res.ok, row.src);
      const back = L.parseRow(res.src), orig = L.parseRow(row.src);
      deepEqual([back.text, back.stamps, back.pieces, back.emph, back.impact, back.note],
        [orig.text, orig.stamps, orig.pieces, orig.emph, orig.impact, orig.note], row.src);
    }
  }
});

test('renderChecked refuses what the lyric syntax cannot hold, and never changes words or stamps', () => {
  const row = IO.rowsView(docOf('夜明けの色を覚えてる'))[0];
  assert.equal(IO.renderChecked(row, { note: 'よ|み' }).ok, false, 'a note with a mark');
  assert.equal(IO.renderChecked(row, { note: 'よ\nみ' }).ok, false, 'a note with a line break');
  assert.equal(IO.renderChecked(row, { pieces: [[0, 6], [6, 99]] }).ok, false, 'pieces past the text');
  const ok = IO.renderChecked(row, { pieces: [[0, 6], [6, 10]], emph: [[0, 3]] });
  assert.ok(ok.ok);
  assert.equal(ok.src, '*夜明け*の色を/覚えてる');
  const moved = IO.renderChecked(row, { text: '別の歌詞', stamps: [3] });
  assert.equal(L.parseRow(moved.src).text, '夜明けの色を覚えてる', 'text and stamps come from the row, not the fields');
  assert.deepEqual(L.parseRow(moved.src).stamps, []);
  const emoji = IO.rowsView(docOf('手をふる👋🏽またね'))[0];
  assert.equal(IO.renderChecked(emoji, { pieces: [[0, 5], [5, 9]] }).ok, false, 'a cut inside a grapheme');
  assert.equal(IO.renderChecked(IO.rowsView(docOf('# note'))[0], { impact: true }).ok, false, 'not a lyric row');
});

test('renderChecked: v2 escapes keep the words where the old syntax could not', () => {
  const yeah = IO.rowsView(docOf('Yeah!!'))[0];
  deepEqual([yeah.text, yeah.impact], ['Yeah!', true]);
  const off = IO.renderChecked(yeah, { impact: false });
  assert.ok(off.ok);
  deepEqual([L.parseRow(off.src).text, L.parseRow(off.src).impact], ['Yeah!', false]);
  const spaced = IO.rowsView(docOf('君と 歌う夜'))[0];
  const cut = IO.renderChecked(spaced, { pieces: [[0, 3], [3, 6]] });
  assert.ok(cut.ok, 'the space stays at the end of the first piece');
  assert.equal(L.parseRow(cut.src).text, '君と 歌う夜');
});

test('editRows: removals squeeze the blank rows they leave; other blank rows stay', () => {
  const a = docOf('作詞：だれか\n\nA\n\n[Chorus]\n\nB');
  const r1 = IO.editRows(a, { [idOf(a, '作詞：だれか')]: { remove: true }, [idOf(a, '[Chorus]')]: { remove: true } });
  assert.equal(r1.text, 'A\n\nB');
  const b = docOf('ラベル\n一行目\n\n\n二行目\nX\n\n三行目');
  const r2 = IO.editRows(b, { [idOf(b, 'X')]: { remove: true } });
  assert.equal(r2.text, 'ラベル\n一行目\n\n\n二行目\n\n三行目', 'the double blank far from the removal stays');
  const c = docOf('A\nB\n\nC');
  assert.equal(IO.editRows(c, { [idOf(c, 'C')]: { remove: true } }).text, 'A\nB', 'no blank row left at the end');
  deepEqual(IO.editRows(c, {}), { text: 'A\nB\n\nC', skipped: [] });
});

test('editRows: field edits are checked; a failing one keeps the row and is reported', () => {
  const doc = docOf('夜明けの色を覚えてる\n本気で好きだった');
  const a = idOf(doc, '夜明けの色を覚えてる'), b = idOf(doc, '本気で好きだった');
  const res = IO.editRows(doc, { [a]: { fields: { pieces: [[0, 6], [6, 10]] } }, [b]: { fields: { note: 'ま|じ' } } });
  assert.equal(res.text, '夜明けの色を/覚えてる\n本気で好きだった');
  deepEqual(res.skipped, [b]);
});

test('prep.request sends only lyric rows, numbered in order, with their row ids', () => {
  const doc = docOf('# Aメロ\n作詞：だれか\n夜明けの色を覚えてる\n\n本気で好きだった\n短い');
  const q = PREP.request(doc, 'ja');
  deepEqual(q.lines.map((l) => [l.i, l.text]), [[0, '作詞：だれか'], [1, '夜明けの色を覚えてる'], [2, '本気で好きだった'], [3, '短い']]);
  deepEqual(q.lines.map((l) => l.rowId), [idOf(doc, '作詞：だれか'), idOf(doc, '夜明けの色を覚えてる'), idOf(doc, '本気で好きだった'), idOf(doc, '短い')]);
  assert.ok(q.prompt.includes('1: 夜明けの色を覚えてる'));
  assert.ok(!q.prompt.includes('Aメロ'), 'comments are not sent');
  assert.ok(!/audio|mp3|wav/i.test(q.prompt));
  assert.equal(q.effort, 'low');
  assert.match(q.system, /Japanese/);
  assert.match(PREP.request(doc, 'en').system, /English/);
});

test('prep.changes validates cuts, emphasis and readings (only real changes, in row order)', () => {
  const doc = docOf('作詞：だれか\n夜明けの色を覚えてる\n本気で好きだった\n短い');
  const ids = IO.rowsView(doc).map((r) => r.rowId);
  const { changes, warnings, summary } = PREP.changes(doc, { summary: 'まとめ', lines: [
    answer(2, { segments: ['本気で', 'スキだった'], emphasis: ['愛'], reading: 'まじですきだった' }),
    answer(0, { remove: true, reason: 'credit' }),
    answer(1, { segments: ['夜明けの色を', '覚えてる'], emphasis: ['夜明け'] }),
    answer(3, {}),
    answer(99, { remove: true }),
  ] });
  assert.equal(summary, 'まとめ');
  deepEqual(changes.map((c) => [c.kind, c.rowId]), [['remove', ids[0]], ['cut', ids[1]], ['emphasis', ids[1]], ['note', ids[2]]]);
  const cut = changes[1];
  deepEqual([cut.to, cut.from, cut.label], [[[0, 6], [6, 10]], null, ['ai.ch.cut', { n: 2, text: '夜明けの色を/覚えてる' }]]);
  deepEqual(changes[2].to, [0, 3]);
  assert.equal(cut.diff.after, '*夜明け*の色を/覚えてる');
  assert.equal(changes[3].to, 'まじですきだった');
  assert.equal(changes[3].diff.after, '本気で好きだった|まじですきだった');
  assert.equal(changes[0].reason, 'credit');
  for (const c of changes) {
    assert.equal(c.checked, true);
    assert.equal(c.stale, false);
    assert.equal(c.scope, 'rows');
    assert.ok(typeof c.base.src === 'string');
  }
  deepEqual(warnings.map((w) => w[0]).sort(), ['ai.warn.cutMismatch', 'ai.warn.emphasisNotFound', 'ai.warn.notLine']);
});

test('prep drops cuts, emphasis and readings that would alter the words or break lines', () => {
  const doc = docOf('本気で好き\n夜の街');
  const { changes, warnings } = PREP.changes(doc, { lines: [
    answer(0, { segments: ['本気', 'で\n好き'], emphasis: ['本*気'], reading: 'まじ\nで' }),
    answer(1, { segments: ['夜の', '町'], emphasis: ['朝'], reading: '夜の街' }),
  ] });
  deepEqual(changes, []);
  deepEqual(warnings.map((w) => w[0]), ['ai.warn.cutMismatch', 'ai.warn.emphasisNotFound', 'ai.warn.cutMismatch', 'ai.warn.emphasisNotFound']);
});

test('prep: a cut between words keeps the space; an emphasis must lie inside one piece; existing emphasis is not doubled', () => {
  const doc = docOf('君と 歌う夜\n*光*の中で\n始発のホームに白い息');
  const { changes, warnings } = PREP.changes(doc, { lines: [
    answer(0, { segments: ['君と', '歌う夜'] }),
    answer(1, { emphasis: ['光'] }),
    answer(2, { segments: ['始発のホームに', '白い息'], emphasis: ['ホームに白い'] }),
  ] });
  deepEqual(changes.map((c) => c.kind), ['cut', 'cut']);
  deepEqual(changes[0].to, [[0, 3], [3, 6]]);
  assert.equal(L.parseRow(changes[0].diff.after).text, '君と 歌う夜');
  deepEqual(warnings, [['ai.warn.emphasisNotFound', { n: 3, word: 'ホームに白い' }]]);
});

test('prep.changes tolerates empty or odd answers', () => {
  const doc = docOf('A\nB');
  deepEqual(PREP.changes(doc, null), { summary: '', changes: [], warnings: [] });
  deepEqual(PREP.changes(doc, { lines: 'x' }).changes, []);
  const dup = PREP.changes(doc, { lines: [answer(0, { remove: true }), answer(0, { remove: true }), { i: 'x' }] });
  assert.equal(dup.changes.length, 1);
  deepEqual(dup.warnings, [['ai.warn.notLine', { n: 0 }]]);
});

test('removing a row keeps every per-line setting on its line (now by id) and applies as one undo step', () => {
  let doc = docOf('ラベル\n一行目\n二行目\n三行目');
  const [r0, r1, r2, r3] = doc.sheet.rows.map((r) => r.id);
  doc = CMD.reduce(doc, { t: 'batch', cmds: [
    { t: 'pin.set', path: 'line/' + r1 + ':arrange', v: 'stubBlock', by: 'user' },
    { t: 'pin.set', path: 'line/' + r2 + ':start', v: 4, by: 'tap' },
    { t: 'lock.set', lineId: r3, pins: { ['cut/' + r3 + '~0:arrive']: { v: 'stubFade', by: 'lock', sig: '三行目' } }, n: 1 },
    { t: 'salt.bump', key: 'line/' + r1 },
  ] });
  const store = ST.createStore({ doc, reduce: CMD.reduce });
  const { changes } = PREP.changes(store.doc, { lines: [answer(0, { remove: true, reason: 'label' })] });
  const cmds = CH.toCommands(store.doc, null, changes);
  deepEqual(cmds, [{ t: 'lyrics.set', text: '一行目\n二行目\n三行目' }]);
  const before = store.doc;
  store.batch({ label: ['undo.ai', { tool: 'prep', n: 1 }] }, cmds);
  const after = store.doc;
  deepEqual(after.sheet.rows.map((r) => r.id), [r1, r2, r3]);
  assert.equal(after.pins['line/' + r1 + ':arrange'].v, 'stubBlock');
  assert.equal(after.pins['line/' + r2 + ':start'].v, 4);
  assert.equal(after.pins['cut/' + r3 + '~0:arrive'].by, 'lock');
  deepEqual(after.locks[r3], { n: 1 });
  assert.equal(after.salts['line/' + r1], 1);
  assert.ok(!after.sheet.rows.some((r) => r.id === r0));
  assert.equal(store.list().length, 1, 'one undo entry');
  store.undo();
  assert.equal(store.doc, before);
});

test('prep changes of several kinds on one row become one lyrics.row', () => {
  const doc = docOf('夜明けの色を覚えてる\n本気で好きだった');
  const id = doc.sheet.rows[0].id;
  const { changes } = PREP.changes(doc, { lines: [answer(0, { segments: ['夜明けの色を', '覚えてる'], emphasis: ['夜明け'], reading: 'よあけ' })] });
  assert.equal(changes.length, 3);
  const cmds = CH.toCommands(doc, null, changes);
  deepEqual(cmds, [{ t: 'lyrics.row', rowId: id, src: '*夜明け*の色を/覚えてる|よあけ' }]);
  const unchecked = changes.map((c) => (c.kind === 'cut' ? Object.assign({}, c, { checked: false }) : c));
  deepEqual(CH.toCommands(doc, null, unchecked), [{ t: 'lyrics.row', rowId: id, src: '*夜明け*の色を覚えてる|よあけ' }]);
  const next = CH.apply(doc, null, changes);
  assert.equal(next.sheet.rows[0].id, id);
  assert.equal(L.PLAIN(next.sheet.rows[0].src), '夜明けの色を覚えてる', 'the words never change');
});

test('stale rows: an edited row is unchecked and skipped; rows moved by other edits still apply by id', () => {
  const doc = docOf('A行です\nB行です\nC行です');
  const idB = idOf(doc, 'B行です');
  const { changes } = PREP.changes(doc, { lines: [answer(1, { remove: true })] });
  // a row inserted above: the id still points at B, so the change is not stale and removes B
  const moved = CMD.reduce(doc, { t: 'lyrics.set', text: 'X行です\nA行です\nB行です\nC行です' });
  const same = CH.markStale(moved, null, changes);
  assert.equal(same[0].stale, false);
  assert.equal(textOf(CH.apply(moved, null, same)), 'X行です\nA行です\nC行です');
  // B itself edited: stale, unchecked, and skipped even when checked again by hand
  const edited = CMD.reduce(doc, { t: 'lyrics.row', rowId: idB, src: 'B行でした' });
  const stale = CH.markStale(edited, null, changes);
  deepEqual([stale[0].stale, stale[0].checked], [true, false]);
  deepEqual(CH.toCommands(edited, null, stale), []);
  deepEqual(CH.toCommands(edited, null, [Object.assign({}, stale[0], { checked: true })]), []);
  // only marks changed: still stale (the row changed since), but the words are the same, so a re-checked change applies
  const marked = CMD.reduce(doc, { t: 'lyrics.row', rowId: idB, src: '*B*行です' });
  const s2 = CH.markStale(marked, null, changes);
  assert.equal(s2[0].stale, true);
  assert.equal(textOf(CH.apply(marked, null, [Object.assign({}, s2[0], { checked: true })])), 'A行です\nC行です');
});

test('prep log entry and selective revert', () => {
  const doc = docOf('夜明けの色を覚えてる\n作詞：だれか\n本気で好きだった');
  const store = ST.createStore({ doc, reduce: CMD.reduce });
  const { changes } = PREP.changes(doc, { lines: [answer(0, { segments: ['夜明けの色を', '覚えてる'] })] });
  const cmds = CH.toCommands(doc, null, changes);
  store.batch({ label: ['undo.ai', { tool: 'prep', n: 1 }] }, cmds);
  const entry = CH.logEntry(doc, cmds, { runId: 'run1', tool: 'prep' });
  deepEqual(entry, { runId: 'run1', tool: 'prep', n: 1,
    applied: [{ rowId: doc.sheet.rows[0].id, to: '夜明けの色を/覚えてる', prev: '夜明けの色を覚えてる' }] });
  const back = CH.revertCommands(store.doc, entry);
  deepEqual(back, { cmds: [{ t: 'lyrics.row', rowId: doc.sheet.rows[0].id, src: '夜明けの色を覚えてる' }], kept: 0 });
  store.dispatch({ t: 'lyrics.row', rowId: doc.sheet.rows[0].id, src: '夜明けの/色を覚えてる' });
  deepEqual(CH.revertCommands(store.doc, entry), { cmds: [], kept: 1 }, 'changed later: kept');
});

test('prep answers map through the request\'s row ids: a row typed while the request ran changes nothing', () => {
  const docA = docOf('作詞: だれか\n一行目\n二行目');
  const q = PREP.request(docA, 'ja');
  const credit = idOf(docA, '作詞: だれか');
  const docB = CMD.reduce(docA, { t: 'lyrics.set', text: '新しい一行\n作詞: だれか\n一行目\n二行目' });
  const json = { lines: [answer(0, { remove: true, reason: 'credit' })] };
  // as recommended: validate against the document that was sent, then mark against the current one
  const res = PREP.changes(docA, json, { rev: 4, lines: q.lines });
  deepEqual(res.changes.map((c) => [c.kind, c.rowId, c.base.rev]), [['remove', credit, 4]]);
  const marked = CH.markStale(docB, null, res.changes);
  assert.equal(marked[0].stale, false);
  assert.equal(textOf(CH.apply(docB, null, marked)), '新しい一行\n一行目\n二行目');
  // validated against the current document: the id still points at the credit row
  deepEqual(PREP.changes(docB, json, { lines: q.lines }).changes.map((c) => c.rowId), [credit]);
  // the credit row itself reworded meanwhile: skipped with a warning
  const docC = CMD.reduce(docB, { t: 'lyrics.row', rowId: credit, src: '作詞: だれかさん' });
  deepEqual(PREP.changes(docC, json, { lines: q.lines }), { summary: '', changes: [], warnings: [['ai.warn.changedSince', { n: 1 }]] });
  deepEqual(PREP.changes(docA, { lines: [answer(5, { remove: true })] }, { lines: q.lines }).warnings, [['ai.warn.notLine', { n: 6 }]]);
});

test('prep leaves cut marks alone where a split pin decides the cuts (a user pin or a lock)', () => {
  let doc = docOf('夜明けの色を覚えてる\n本気で好きだった\n[00:05.00][00:30.00]君の名前を呼ぶ声が\n遠くまで届くように');
  const [r1, r2, r3, r4] = doc.sheet.rows.map((r) => r.id);
  doc = CMD.reduce(doc, { t: 'batch', cmds: [
    { t: 'pin.set', path: 'line/' + r1 + ':split', v: 'none', by: 'user' },
    { t: 'lock.set', lineId: r2, pins: { ['line/' + r2 + ':split']: { v: [0], by: 'lock' } }, n: 1 },
    { t: 'pin.set', path: 'line/' + r3 + ':split', v: 'none', by: 'user' },           // the first time it is sung only
    { t: 'pin.set', path: 'line/' + r4 + ':split', v: [0, 4], by: 'user' },
  ] });
  const { changes, warnings } = PREP.changes(doc, { lines: [
    answer(0, { segments: ['夜明けの色を', '覚えてる'], emphasis: ['夜明け'] }),
    answer(1, { segments: ['本気で', '好きだった'] }),
    answer(2, { segments: ['君の名前を', '呼ぶ声が'] }),
    answer(3, { segments: ['遠くまで届くように'] }),
  ] });
  deepEqual(changes.map((c) => [c.kind, c.rowId]), [['emphasis', r1], ['cut', r3]]);
  deepEqual(warnings, [['ai.warn.splitPinned', { n: 1 }], ['ai.warn.locked', { n: 2 }]]);
  assert.equal(changes[0].diff.after, '*夜明け*の色を覚えてる', 'the emphasis still applies, without the cut');
});
