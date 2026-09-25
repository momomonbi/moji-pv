/* 文字PVメーカー v2 — original work. Tests for planner/areas: song sections, headings, blocks, line sets, cuts, stale refs (DESIGN_2_1 §3.8). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const A = MV.use('planner/areas');
const FE = MV.use('planner/features');
const M = MV.use('core/migrate');
const C = MV.use('core/commands');
const { plan } = MV.use('planner/plan');
const STRINGS = MV.use('i18n/strings');
const registry = MV.use('parts/catalog').defaultRegistry();

function v21() { return M.parseFile(corpus.projectText('v21')).doc; }
function planOf(doc) { return plan(doc, { registry }); }
function fixture() {
  const doc = v21();
  return { doc, p: planOf(doc) };
}
const ids = (area) => area.lineIds.slice();

test('areasOf: song sections in time order with ordinals, kinds with ≥ 2 sections, headings, blocks', () => {
  const { doc, p } = fixture();
  const all = A.areasOf(doc, p);
  assert.deepEqual(all.song.map((a) => a.label), [['area.song', { kind: 'intro', n: 1 }], ['area.song', { kind: 'verse', n: 1 }],
    ['area.song', { kind: 'chorus', n: 1 }], ['area.song', { kind: 'interlude', n: 1 }], ['area.song', { kind: 'chorus', n: 2 }]]);
  assert.deepEqual(all.song.map((a) => a.key), ['song:0@0-4', 'song:1@4-24', 'song:2@24-40', 'song:3@40-46', 'song:4@46-60']);
  assert.deepEqual(ids(all.song[1]), ['r4', 'r5', 'r7', 'r8']);
  assert.deepEqual(ids(all.song[2]), ['rb', 'rc']);
  assert.deepEqual(ids(all.song[4]), ['rb.1', 'rd', 're']);
  assert.equal(all.song[0].n, 0, 'the intro has no lines');
  assert.deepEqual([all.song[2].t0, all.song[2].t1, all.song[2].songKind], [24, 40, 'chorus']);
  assert.deepEqual(all.kinds.map((a) => [a.key, a.label, ids(a)]), [['kind:chorus', ['area.songAll', { kind: 'chorus' }],
    ['rb', 'rc', 'rb.1', 'rd', 're']]]);
  assert.deepEqual(all.heads.map((a) => [a.key, a.label[1].text, ids(a), a.songKind]), [
    ['head:r3', 'Aメロ', ['r4', 'r5', 'r7', 'r8'], 'verse'], ['head:ra', 'サビ', ['rb', 'rc', 'rb.1', 'rd', 're'], 'chorus']]);
  assert.deepEqual(all.paras.map((a) => [a.key, a.label, ids(a)]), [['para:r4', ['area.para', { n: 1 }], ['r4', 'r5']],
    ['para:r7', ['area.para', { n: 2 }], ['r7', 'r8']], ['para:rb', ['area.para', { n: 3 }], ['rb', 'rc', 'rb.1', 'rd', 're']]]);
  for (const list of Object.values(all)) {
    for (const a of list) {
      assert.ok(Object.isFrozen(a) && Object.isFrozen(a.scopes));
      assert.ok(a.label[0] in STRINGS, a.label[0]);
      assert.equal(a.n, a.lineIds.length);
    }
  }
});

test('song membership equals planner/features.songSection for every line and special cut', () => {
  const { doc, p } = fixture();
  const all = A.areasOf(doc, p);
  const owner = new Map();
  for (const a of all.song) for (const id of a.lineIds) { assert.ok(!owner.has(id), 'one song area per line'); owner.set(id, a); }
  for (const line of p.lines) {
    const kind = FE.songSection(doc.song.info, line.t0);
    assert.equal(owner.has(line.id) ? owner.get(line.id).songKind : null, kind, line.id);
  }
  for (const cut of p.cuts.filter((c) => !c.line)) {
    const area = all.song.find((a) => a.cutKeys.includes(cut.key));
    assert.equal(area ? area.songKind : null, FE.songSection(doc.song.info, cut.t0), cut.key);
  }
  const lyricCut = p.cuts.find((c) => c.line === 'rb');
  assert.equal(lyricCut.feat.section, all.song[2].songKind, 'the plan section of a cut is its area kind');
});

test('scopes: line scopes plus special cuts; a cut area is exactly its cut; work is everything', () => {
  const { doc, p } = fixture();
  const all = A.areasOf(doc, p);
  const gap = p.cuts.find((c) => c.key.startsWith('gap/'));
  assert.ok(gap && gap.t0 >= 24 && gap.t0 < 40, 'the fixture has an interlude cut starting inside chorus 1');
  assert.deepEqual(all.song[0].scopes, ['cut/title'], 'the intro owns the title card');
  assert.deepEqual(all.song[3].scopes, [], 'the analysed interlude starts after the gap cut does');
  assert.deepEqual(all.song[2].scopes, ['line/rb', 'line/rc', 'cut/' + gap.key], 'a special cut belongs by its t0');
  assert.deepEqual(all.song[2].cutKeys, p.cuts.filter((c) => c.line === 'rb' || c.line === 'rc' || c === gap).map((c) => c.key));
  assert.deepEqual(all.song[4].scopes.slice(-1), ['cut/outro']);
  const cut = A.resolve(doc, p, { kind: 'cut', key: 'rb~3' });
  assert.deepEqual([cut.scopes, cut.cutKeys, cut.lineIds, cut.label], [['cut/rb~3'], ['rb~3'], ['rb'], ['area.cut', { n: 5, k: 2 }]]);
  const work = A.resolve(doc, p, { kind: 'work' });
  assert.deepEqual([work.scopes, work.n, work.t0, work.t1, work.label], [['work'], p.lines.length, 0, p.duration, ['area.work', {}]]);
  assert.equal(work.cutKeys.length, p.cuts.length);
  const title = A.resolve(doc, p, { kind: 'cut', key: 'title' });
  assert.deepEqual([title.label, title.scopes, title.n], [['crumb.title', {}], ['cut/title'], 0]);
  assert.deepEqual(A.resolve(doc, p, { kind: 'cut', key: gap.key }).label, ['crumb.gap', { n: p.lines.find((l) => l.id === gap.key.slice(4)).index + 1 }]);
});

test('inArea: line, cut and special-cut paths', () => {
  const { doc, p } = fixture();
  const chorus1 = A.resolve(doc, p, { kind: 'song', n: 2, t0: 24, t1: 40 });
  assert.equal(A.inArea(chorus1, 'line/rb:cam.shot'), true);
  assert.equal(A.inArea(chorus1, 'cut/rc~0:arrive'), true, 'a cut of a member line');
  assert.equal(A.inArea(chorus1, 'line/rb.1:arrive'), false, 'the second occurrence sings in chorus 2');
  assert.equal(A.inArea(chorus1, 'work:mood'), false);
  assert.equal(A.inArea(chorus1, 'line/r4:arrive'), false);
  const gap = p.cuts.find((c) => c.key.startsWith('gap/')).key;
  assert.equal(A.inArea(chorus1, 'cut/' + gap + ':seam'), true, 'a special cut inside the section');
  const intro = A.resolve(doc, p, { kind: 'song', n: 0, t0: 0, t1: 4 });
  assert.equal(A.inArea(intro, 'cut/title:ground'), true);
  assert.equal(A.inArea(intro, 'cut/' + gap + ':seam'), false);
  const cut = A.resolve(doc, p, { kind: 'cut', key: 'rb~3' });
  assert.equal(A.inArea(cut, 'cut/rb~3:cam.shot'), true);
  assert.equal(A.inArea(cut, 'cut/rb~0:cam.shot'), false);
  assert.equal(A.inArea(cut, 'line/rb:cam.shot'), false, 'a cut area does not own line pins');
  const work = A.resolve(doc, p, { kind: 'work' });
  assert.equal(A.inArea(work, 'line/rb:x'), true);
  assert.equal(A.inArea(work, 'not a path'), false);
  assert.equal(A.inArea(null, 'work:mood'), false);
});

test('keyOf and sameRef are stable', () => {
  assert.equal(A.keyOf({ kind: 'work' }), 'work');
  assert.equal(A.keyOf({ t1: 62.8, n: 3, kind: 'song', t0: 41.2 }), 'song:3@41.2-62.8');
  assert.equal(A.keyOf({ kind: 'songKind', of: 'chorus' }), 'kind:chorus');
  assert.equal(A.keyOf({ kind: 'head', rowId: 'r12' }), 'head:r12');
  assert.equal(A.keyOf({ kind: 'para', rowId: 'r20' }), 'para:r20');
  assert.equal(A.keyOf({ kind: 'lines', ids: ['r4', 'r3', 'r4'] }), 'lines:r3,r4');
  assert.equal(A.keyOf({ kind: 'cut', key: 'r7~5' }), 'cut:r7~5');
  for (const bad of [null, {}, { kind: 'song', n: 1 }, { kind: 'lines', ids: 'r3' }, { kind: 'area' }]) assert.equal(A.keyOf(bad), '');
  assert.ok(A.sameRef({ kind: 'lines', ids: ['r3', 'r4'] }, { ids: ['r4', 'r3'], kind: 'lines' }));
  assert.ok(!A.sameRef({ kind: 'head', rowId: 'r3' }, { kind: 'para', rowId: 'r3' }));
  assert.ok(!A.sameRef({}, {}), 'unreadable refs are never the same');
});

test('resolve after a lyric edit, after re-analysis (drift → null), and for gone areas', () => {
  const { doc, p } = fixture();
  const song = { kind: 'song', n: 2, t0: 24, t1: 40 };
  // edit a line's words: the section, heading and block still resolve
  const edited = C.reduce(doc, { t: 'lyrics.row', rowId: 'rc', src: '[00:30.00]折り目の数だけ/強くなる' });
  const p2 = planOf(edited);
  assert.deepEqual(ids(A.resolve(edited, p2, song)), ['rb', 'rc']);
  assert.deepEqual(ids(A.resolve(edited, p2, { kind: 'head', rowId: 'ra' })), ['rb', 'rc', 'rb.1', 'rd', 're']);
  // re-analysis moves the section: the ref is stale
  const info = JSON.parse(JSON.stringify(doc.song.info));
  info.sections[2].start = 23.5;
  const reanalysed = C.reduce(doc, { t: 'song.info', info });
  const p3 = planOf(reanalysed);
  assert.equal(A.resolve(reanalysed, p3, song), null);
  assert.notEqual(A.resolve(reanalysed, p3, { kind: 'songKind', of: 'chorus' }), null, 'the kind still exists');
  assert.equal(A.resolve(reanalysed, p3, { kind: 'songKind', of: 'bridge' }), null);
  // remove the heading row: the head area is gone; the block survives
  const noHead = C.reduce(doc, { t: 'lyrics.set', text: doc.sheet.rows.filter((r) => r.id !== 'ra').map((r) => r.src).join('\n') });
  const p4 = planOf(noHead);
  assert.equal(A.resolve(noHead, p4, { kind: 'head', rowId: 'ra' }), null);
  assert.equal(A.resolve(noHead, p4, { kind: 'head', rowId: 'r3' }).n, 9, 'Aメロ now runs to the end');
  // a line set keeps the lines that still exist
  const noLine = C.reduce(doc, { t: 'lyrics.set', text: doc.sheet.rows.filter((r) => r.id !== 'rc').map((r) => r.src).join('\n') });
  const p5 = planOf(noLine);
  assert.deepEqual(ids(A.resolve(noLine, p5, { kind: 'lines', ids: ['rb', 'rc'] })), ['rb']);
  assert.equal(A.resolve(noLine, p5, { kind: 'lines', ids: ['rc'] }), null);
  assert.equal(A.resolve(noLine, p5, { kind: 'cut', key: 'rc~0' }), null);
  assert.equal(A.resolve(doc, p, { kind: 'para', rowId: 'r5' }), null, 'not the first row of a block');
  assert.equal(A.resolve(doc, p, { kind: 'nope' }), null);
  assert.equal(A.resolve(doc, p, null), null);
});

test('lines areas: labels with 1-based line numbers; locked lines are listed', () => {
  const { doc, p } = fixture();
  const one = A.resolve(doc, p, { kind: 'lines', ids: ['r7'] });
  assert.deepEqual(one.label, ['area.linesOne', { a: 3 }]);
  const two = A.resolve(doc, p, { kind: 'lines', ids: ['r8', 'r4'] });
  assert.deepEqual([two.label, two.lineIds], [['area.lines', { a: 1, b: 4 }], ['r4', 'r8']]);
  const locked = C.reduce(doc, { t: 'lock.set', lineId: 'r7', pins: {}, n: 1 });
  const lp = planOf(locked);
  assert.deepEqual(A.resolve(locked, lp, { kind: 'head', rowId: 'r3' }).locked, ['r7']);
  assert.deepEqual(A.resolve(doc, p, { kind: 'head', rowId: 'r3' }).locked, []);
});

test('ofLines: song > head > para, else a line set', () => {
  const { doc, p } = fixture();
  assert.deepEqual(A.ofLines(doc, p, ['rd', 'rb.1', 're']), { kind: 'song', n: 4, t0: 46, t1: 60 });
  assert.deepEqual(A.ofLines(doc, p, ['r4', 'r5', 'r7', 'r8']), { kind: 'song', n: 1, t0: 4, t1: 24 }, 'the verse wins over # Aメロ');
  assert.deepEqual(A.ofLines(doc, p, ['rb', 'rc', 'rb.1', 'rd', 're']), { kind: 'head', rowId: 'ra' });
  assert.deepEqual(A.ofLines(doc, p, ['r5', 'r4']), { kind: 'para', rowId: 'r4' });
  assert.deepEqual(A.ofLines(doc, p, ['r8', 'r4', 'zz']), { kind: 'lines', ids: ['r4', 'r8'] });
  assert.deepEqual(A.ofLines(doc, p, []), { kind: 'lines', ids: [] });
});

test('bands: song sections, else headings, else blocks (≥ 2)', () => {
  const { doc, p } = fixture();
  assert.deepEqual(A.bands(doc, p).map((b) => [b.key, b.kind, b.t0, b.t1, b.n]), [['song:0@0-4', 'song', 0, 4, 0],
    ['song:1@4-24', 'song', 4, 24, 4], ['song:2@24-40', 'song', 24, 40, 2], ['song:3@40-46', 'song', 40, 46, 0],
    ['song:4@46-60', 'song', 46, 60, 3]]);
  const noSong = C.reduce(doc, { t: 'song.clear' });
  const heads = A.bands(noSong, planOf(noSong));
  assert.deepEqual(heads.map((b) => [b.key, b.n]), [['head:r3', 4], ['head:ra', 5]]);
  const noHeads = C.reduce(noSong, { t: 'lyrics.set', text: noSong.sheet.rows.filter((r) => !r.src.startsWith('#')).map((r) => r.src).join('\n') });
  assert.deepEqual(A.bands(noHeads, planOf(noHeads)).map((b) => b.key), ['para:r4', 'para:r7', 'para:rb']);
  const oneBlock = C.reduce(noHeads, { t: 'lyrics.set', text: noHeads.sheet.rows.filter((r) => r.src !== '').map((r) => r.src).join('\n') });
  assert.deepEqual(A.bands(oneBlock, planOf(oneBlock)), [], 'a single block is no band');
  const basic = corpus.project('basic').doc;
  assert.deepEqual(A.areasOf(basic, planOf(basic)).song, [], 'no analysis, no song areas');
});

test('areas are memoized per plan and never change the plan', () => {
  const { doc, p } = fixture();
  const hash = p.hash;
  const first = A.areasOf(doc, p);
  assert.equal(A.areasOf(doc, p).song.length, first.song.length);
  assert.equal(p.hash, hash);
  assert.equal(planOf(doc).hash, hash, 'deterministic');
});
