/* 文字PVメーカー v2 — original work. Tests for ui/selection: drill, Alt cycle, double-click, up/down, validate (DESIGN §6.5, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const S = MV.use('ui/selection');
const PLAN = corpus.planBasic();

// A small plan with a single-cut line, a title and an interlude cut.
function smallPlan(extra) {
  const lines = [
    { id: 'r1', index: 0, cuts: ['r1~0', 'r1~4'] },
    { id: 'r2', index: 1, cuts: ['r2~0'] },
    { id: 'r3', index: 2, cuts: ['r3~0', 'r3~3'] },
  ];
  const cuts = [
    { key: 'title', line: null, repT: 0.5 }, { key: 'r1~0', line: 'r1', repT: 2 }, { key: 'r1~4', line: 'r1', repT: 3 },
    { key: 'r2~0', line: 'r2', repT: 5 }, { key: 'gap/r2', line: null, repT: 7 }, { key: 'r3~0', line: 'r3', repT: 9 },
    { key: 'r3~3', line: 'r3', repT: 10 },
  ];
  return Object.assign({ lines, cuts }, extra || {});
}
const SMALL = smallPlan();
const hit = (cut, line, owner) => ({ cut, line, owner: owner || 'text', node: 0 });

test('drill: line → cut → element, the same spot each time', () => {
  let sel = S.WORK;
  const hits = [hit('r4~7', 'r4')];
  sel = S.onPreviewClick(sel, hits, { plan: PLAN });
  assert.deepEqual(sel, { level: 'line', ids: ['r4'] });
  sel = S.onPreviewClick(sel, hits, { plan: PLAN });
  assert.deepEqual(sel, { level: 'cut', key: 'r4~7' });
  sel = S.onPreviewClick(sel, hits, { plan: PLAN });
  assert.deepEqual(sel, { level: 'el', scope: 'cut/r4~7', el: 'text' });
  assert.deepEqual(S.onPreviewClick(sel, hits, { plan: PLAN }), sel, 'the element stays');
  assert.deepEqual(S.onPreviewClick(sel, [hit('r5~0', 'r5')], { plan: PLAN }), { level: 'line', ids: ['r5'] }, 'another line');
  assert.deepEqual(S.onPreviewClick({ level: 'cut', key: 'r4~0' }, hits, { plan: PLAN }), { level: 'cut', key: 'r4~7' },
    'a sibling cut of the same line stays at cut level');
  assert.deepEqual(S.onPreviewClick(sel, [], { plan: PLAN }), S.WORK, 'empty space → 全体');
});

test('drill skips the cut level for single-cut lines', () => {
  let sel = S.onPreviewClick(S.WORK, [hit('r2~0', 'r2')], { plan: SMALL });
  assert.deepEqual(sel, { level: 'line', ids: ['r2'] });
  sel = S.onPreviewClick(sel, [hit('r2~0', 'r2')], { plan: SMALL });
  assert.deepEqual(sel, { level: 'el', scope: 'line/r2', el: 'text' });
  assert.deepEqual(S.onPreviewClick(S.WORK, [hit('title', null)], { plan: SMALL }), { level: 'cut', key: 'title' },
    'special cuts select the cut directly');
});

test('double-click goes straight to the element; decorations keep their index', () => {
  assert.deepEqual(S.onPreviewClick(S.WORK, [hit('r4~0', 'r4')], { dbl: true, plan: PLAN }),
    { level: 'el', scope: 'cut/r4~0', el: 'text' });
  assert.deepEqual(S.onPreviewClick(S.WORK, [hit('r4~0', 'r4', 'ornament#1')], { dbl: true, plan: PLAN }),
    { level: 'el', scope: 'cut/r4~0', el: 'ornament', idx: 1 });
  assert.deepEqual(S.onPreviewClick(S.WORK, [hit('r2~0', 'r2', 'filter#0')], { dbl: true, plan: SMALL }),
    { level: 'el', scope: 'line/r2', el: 'filter', idx: 0 });
});

test('Alt+click cycles through the hits under the pointer at the same level', () => {
  const hits = [hit('r4~7', 'r4'), hit('r4~7', 'r4', 'ornament#0'), hit('r5~0', 'r5'), hit('r6~0', 'r6')];
  let sel = S.onPreviewClick(S.WORK, hits, { alt: true, plan: PLAN });
  assert.deepEqual(sel, { level: 'line', ids: ['r4'] });
  sel = S.onPreviewClick(sel, hits, { alt: true, plan: PLAN });
  assert.deepEqual(sel, { level: 'line', ids: ['r5'] });
  sel = S.onPreviewClick(sel, hits, { alt: true, plan: PLAN });
  assert.deepEqual(sel, { level: 'line', ids: ['r6'] });
  sel = S.onPreviewClick(sel, hits, { alt: true, plan: PLAN });
  assert.deepEqual(sel, { level: 'line', ids: ['r4'] }, 'wraps');
  const el = { level: 'el', scope: 'cut/r4~7', el: 'text' };
  assert.deepEqual(S.onPreviewClick(el, hits, { alt: true, plan: PLAN }), { level: 'el', scope: 'cut/r4~7', el: 'ornament', idx: 0 });
});

test('down and up walk the ladder 全体 → 行 → カット → 要素 and back', () => {
  let sel = S.down(S.WORK, PLAN);
  assert.deepEqual(sel, { level: 'line', ids: ['r4'] });
  sel = S.down(sel, PLAN);
  assert.deepEqual(sel, { level: 'cut', key: 'r4~0' });
  sel = S.down(sel, PLAN);
  assert.deepEqual(sel, { level: 'el', scope: 'cut/r4~0', el: 'text' });
  assert.deepEqual(S.down(sel, PLAN), sel, 'no deeper than an element');
  sel = S.up(sel, PLAN);
  assert.deepEqual(sel, { level: 'cut', key: 'r4~0' });
  sel = S.up(sel, PLAN);
  assert.deepEqual(sel, { level: 'line', ids: ['r4'] });
  assert.deepEqual(S.up(sel, PLAN), S.WORK);
  assert.deepEqual(S.up(S.WORK, PLAN), S.WORK);
  assert.deepEqual(S.down({ level: 'line', ids: ['r2'] }, SMALL), { level: 'el', scope: 'line/r2', el: 'text' });
  assert.deepEqual(S.up({ level: 'el', scope: 'line/r2', el: 'text' }, SMALL), { level: 'line', ids: ['r2'] });
  assert.deepEqual(S.up({ level: 'cut', key: 'gap/r2' }, SMALL), S.WORK);
  assert.deepEqual(S.up({ level: 'el', scope: 'work', el: 'ground' }, SMALL), S.WORK);
  assert.deepEqual(S.down(S.WORK, { lines: [], cuts: [] }), S.WORK, 'nothing to go down to');
});

test('validate keeps what exists and climbs after deletions (lyric edits, undo, AI apply)', () => {
  const sel = { level: 'line', ids: ['r1', 'r2'] };
  assert.equal(S.validate(sel, SMALL), sel, 'unchanged selection is returned as is');
  const without2 = smallPlan({ lines: SMALL.lines.filter((l) => l.id !== 'r2'), cuts: SMALL.cuts.filter((c) => c.line !== 'r2') });
  assert.deepEqual(S.validate(sel, without2), { level: 'line', ids: ['r1'] });
  assert.deepEqual(S.validate({ level: 'line', ids: ['r2'] }, without2), S.WORK);
  assert.deepEqual(S.validate({ level: 'cut', key: 'r1~9' }, SMALL), { level: 'line', ids: ['r1'] }, 'a re-split cut climbs to its line');
  assert.deepEqual(S.validate({ level: 'cut', key: 'r9~0' }, SMALL), S.WORK);
  assert.deepEqual(S.validate({ level: 'el', scope: 'cut/r1~9', el: 'text' }, SMALL), { level: 'line', ids: ['r1'] });
  assert.deepEqual(S.validate({ level: 'el', scope: 'line/r9', el: 'text' }, SMALL), S.WORK);
  assert.deepEqual(S.validate({ level: 'el', scope: 'work', el: 'bogus' }, SMALL), S.WORK);
  assert.deepEqual(S.validate(null, SMALL), S.WORK);
  assert.deepEqual(S.validate({ level: 'cut', key: 'gap/r2' }, SMALL), { level: 'cut', key: 'gap/r2' });
});

test('crumbs: 全体 › 12行 › カット2 › 文字, several lines, special cuts, list elements', () => {
  const labels = (sel, plan) => S.crumbs(sel, plan || PLAN).map((c) => c.label);
  assert.deepEqual(labels(S.WORK), [['crumb.work', {}]]);
  assert.deepEqual(labels({ level: 'line', ids: ['r5'] }), [['crumb.work', {}], ['crumb.line', { n: 2 }]]);
  assert.deepEqual(labels({ level: 'el', scope: 'cut/ra~3', el: 'text' }),
    [['crumb.work', {}], ['crumb.line', { n: 5 }], ['crumb.cut', { k: 2 }], ['el.text', {}]]);
  assert.deepEqual(labels({ level: 'line', ids: ['r4', 'r5', 'r6'] }), [['crumb.work', {}], ['crumb.lines', { n: 3 }]]);
  assert.deepEqual(labels({ level: 'cut', key: 'title' }), [['crumb.work', {}], ['crumb.title', {}]]);
  assert.deepEqual(labels({ level: 'cut', key: 'gap/r2' }, SMALL), [['crumb.work', {}], ['crumb.gap', { n: 2 }]]);
  assert.deepEqual(labels({ level: 'el', scope: 'line/r2', el: 'ornament', idx: 1 }, SMALL),
    [['crumb.work', {}], ['crumb.line', { n: 2 }], ['crumb.ornament', { k: 2 }]]);
  assert.deepEqual(labels({ level: 'el', scope: 'work', el: 'ground' }), [['crumb.work', {}], ['el.ground', {}]]);
  const crumbs = S.crumbs({ level: 'el', scope: 'cut/ra~3', el: 'text' }, PLAN);
  assert.deepEqual(crumbs[2].sel, { level: 'cut', key: 'ra~3' }, 'each crumb selects its level');
});

test('↑/↓ and , / . walk lines and cuts in time order', () => {
  assert.deepEqual(S.nextLine(S.WORK, PLAN, 1), { level: 'line', ids: ['r4'] });
  assert.deepEqual(S.nextLine(S.WORK, PLAN, -1), { level: 'line', ids: ['rd'] });
  assert.deepEqual(S.nextLine({ level: 'cut', key: 'r5~7' }, PLAN, 1), { level: 'line', ids: ['r6'] });
  assert.deepEqual(S.nextLine({ level: 'line', ids: ['rd'] }, PLAN, 1), { level: 'line', ids: ['rd'] }, 'clamped');
  assert.deepEqual(S.nextCut({ level: 'cut', key: 'r4~7' }, PLAN, 1), { level: 'cut', key: 'r5~0' }, 'crosses lines');
  assert.deepEqual(S.nextCut({ level: 'cut', key: 'r4~0' }, PLAN, -1), { level: 'cut', key: 'title' });
  assert.deepEqual(S.nextCut({ level: 'line', ids: ['r1'] }, SMALL, 1), { level: 'line', ids: ['r2'] }, 'single-cut line');
  assert.deepEqual(S.nextCut({ level: 'line', ids: ['r2'] }, SMALL, 1), { level: 'cut', key: 'gap/r2' });
});

test('helpers: cutsOf, seekTime (hero frame), scopeOf, withLine (Shift / Ctrl on the gutter)', () => {
  assert.deepEqual(S.cutsOf({ level: 'line', ids: ['r4', 'r5'] }, PLAN), ['r4~0', 'r4~7', 'r5~0', 'r5~7']);
  assert.equal(S.seekTime({ level: 'line', ids: ['r5'] }, PLAN), 8.956);
  assert.equal(S.seekTime(S.WORK, PLAN), null);
  assert.equal(S.scopeOf({ level: 'cut', key: 'r4~7' }, PLAN), 'cut/r4~7');
  assert.equal(S.scopeOf({ level: 'line', ids: ['r2'] }, SMALL), 'line/r2');
  assert.equal(S.scopeOf(S.WORK, SMALL), 'work');
  assert.deepEqual(S.withLine({ level: 'line', ids: ['r4'] }, PLAN, 'r6', 'range'), { level: 'line', ids: ['r4', 'r5', 'r6'] });
  assert.deepEqual(S.withLine({ level: 'line', ids: ['r4'] }, PLAN, 'r6', 'toggle'), { level: 'line', ids: ['r4', 'r6'] });
  assert.deepEqual(S.withLine({ level: 'line', ids: ['r4'] }, PLAN, 'r4', 'toggle'), S.WORK);
  assert.deepEqual(S.withLine(S.WORK, PLAN, 'r5'), { level: 'line', ids: ['r5'] });
});

test('after undo the stored selection is validated against the new plan', () => {
  // selBefore of an entry may name a line that the undone edit re-creates or removes.
  const before = { level: 'cut', key: 'r3~3' };
  const afterEdit = smallPlan({ lines: SMALL.lines.map((l) => (l.id === 'r3' ? Object.assign({}, l, { cuts: ['r3~0'] }) : l)),
    cuts: SMALL.cuts.filter((c) => c.key !== 'r3~3') });
  assert.deepEqual(S.validate(before, afterEdit), { level: 'line', ids: ['r3'] });
  assert.deepEqual(S.validate(before, SMALL), before);
});

// --- lyric editor: the caret after undo / redo, and which mirror rows a change rebuilds (§6.4.14, §7.4) --------------

test('lyric editor: undo puts the caret where the typing burst started; redo after the redone text', () => {
  const E = MV.use('ui/lyric_editor');
  // Caret at 4, type XYZ (one merged entry whose where comes from the first keystroke: caret 5, before 4).
  const typed = 'abcdXYZefg', plain = 'abcdefg';
  const where = { kind: 'lyrics', caret: 5, end: 5, before: 4 };
  assert.equal(E.caretAfterHistory({ kind: 'undo', where }, typed, plain), 4, 'not 5 (after the first key)');
  assert.equal(E.caretAfterHistory({ kind: 'redo', where }, plain, typed), 7, 'after XYZ, not after X');
  assert.equal(E.caretAfterHistory({ kind: 'undo', where: { kind: 'lyrics', caret: 5 } }, typed, plain), 4,
    'an entry without `before` falls back to the start of the change');
  assert.equal(E.caretAfterHistory({ kind: 'undo', where: { kind: 'field', path: 'work:mood' } }, 'ab\ncd', 'ab\nc'), 4);
  assert.equal(E.caretAfterHistory({ kind: 'undo', where: { kind: 'lyrics', before: 99 } }, 'abc', 'ab'), 2, 'clamped');
  assert.equal(E.changeEnd('aa', 'aaa'), 3);
  assert.equal(E.changeEnd('one\ntwo\nfour', 'one\nfour'), 4, 'a deleted row: the caret where it was');
});

// The textarea and its coloured mirror must lay text out alike (docs/NOTES.md, "Lyric editor: iOS drift").
// tests/browser/editor_metrics.py compares the computed styles, but Chromium drops the WebKit-only declarations, so
// they are checked here in the source.
test('lyric editor: one rule lays out the text of both layers, WebKit-only values included', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { SRC } = require('../helpers/load.js');
  const css = fs.readFileSync(path.join(SRC, 'ui', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    sels: m[1].trim().split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
    decls: m[2].split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean),
  }));
  const shared = rules.filter((r) => r.sels.join(', ') === '.le-mirror, .le-text');
  assert.equal(shared.length, 1, 'one rule for both layers');
  for (const d of ['-webkit-nbsp-mode: space', 'line-break: after-white-space', '-webkit-text-size-adjust: none',
    'text-size-adjust: none', 'font: 16px/var(--le-lh) var(--font)', 'font-kerning: none', 'font-variant-ligatures: none',
    'white-space: pre-wrap', 'word-break: normal', 'overflow-wrap: anywhere', 'border: 0', 'box-sizing: border-box']) {
    assert.ok(shared[0].decls.includes(d), 'the shared rule sets ' + d);
  }
  assert.match(css, /\.lyric-editor \{ --le-lh: \d+px; \}/, 'a whole-px line height (Safari rounds line boxes)');
  // Every other rule on a layer, a row or a token leaves text layout alone, unless it names both layers alike
  // (.is-empty .le-text with .is-empty .le-mirror); a token only changes the colour.
  const LAYOUT = /^(font(-.+)?|line-height|letter-spacing|word-spacing|white-space(-collapse)?|word-break|overflow-wrap|word-wrap|line-break|hyphens|tab-size|text-(indent|transform|align|align-last|rendering|autospace|spacing-trim|size-adjust|wrap(-mode|-style)?|justify)|-webkit-(nbsp-mode|text-size-adjust)|hanging-punctuation|padding(-.+)?|margin(-.+)?|border(-(top|right|bottom|left))?(-width)?|box-sizing|writing-mode|direction|unicode-bidi|zoom)$/;
  for (const r of rules) {
    if (r === shared[0] || !r.sels.some((s) => /\.le-(text|mirror|row)\b|tok-/.test(s))) continue;
    const layers = r.sels.map((s) => s.replace(/\.le-(text|mirror)\b/, '.LAYER'));
    const both = r.sels.every((s, i) => /\.le-(text|mirror)\b/.test(s) && layers.filter((x) => x === layers[i]).length === 2);
    for (const d of r.decls) {
      const prop = d.split(':')[0].trim();
      if (r.sels.some((s) => /tok-/.test(s))) assert.equal(prop, 'color', r.sels.join(', ') + ' only colours: ' + d);
      else if (!both) assert.ok(!LAYOUT.test(prop), r.sels.join(', ') + ' sets ' + d + ' on one layer only');
    }
  }
});

test('lyric editor: only the changed middle of the rows is rebuilt', () => {
  const E = MV.use('ui/lyric_editor');
  const rows = (n) => Array.from({ length: n }, (_, i) => 'row ' + i);
  const a = rows(1500);
  const b = a.slice();
  b[700] = 'row 700!';
  assert.deepEqual(E.changedRows(a, b), { a: 700, oldEnd: 701, newEnd: 701 }, 'one keystroke → one row');
  const c = a.slice(0, 10).concat(['new'], a.slice(10));
  assert.deepEqual(E.changedRows(a, c), { a: 10, oldEnd: 10, newEnd: 11 }, 'Enter → one row inserted');
  assert.deepEqual(E.changedRows(c, a), { a: 10, oldEnd: 11, newEnd: 10 }, 'a row removed');
  assert.deepEqual(E.changedRows([], ['']), { a: 0, oldEnd: 0, newEnd: 1 }, 'first render');
  assert.deepEqual(E.changedRows(a, a), { a: 1500, oldEnd: 1500, newEnd: 1500 }, 'no change');
  assert.deepEqual(E.changedRows(['x', 'x'], ['x', 'x', 'x']), { a: 2, oldEnd: 2, newEnd: 3 }, 'repeated rows');
});

// --- v2.1 (package F): a line selection that names an area (DESIGN_2_1 §5.1, §6.3, §6.8) -----------------------------

function v21() {
  const M = MV.use('core/migrate');
  const doc = M.parseFile(corpus.projectText('v21')).doc;
  const plan = MV.use('planner/plan').plan(doc, { registry: MV.use('parts/catalog').defaultRegistry() });
  return { doc, plan };
}

test('v2.1 areaSel: an area selects its lines with the ref, a cut area its cut, the work area 全体', () => {
  const AREAS = MV.use('planner/areas');
  const { doc, plan } = v21();
  const all = AREAS.areasOf(doc, plan);
  const verse = all.song.find((a) => a.n > 1);
  const sel = S.areaSel(verse);
  assert.deepEqual(sel, { level: 'line', ids: verse.lineIds.slice(), area: verse.ref });
  assert.notEqual(sel.ids, verse.lineIds, 'a copy of the frozen list');
  assert.deepEqual(S.areaSel(all.song.find((a) => a.n === 0)), S.WORK, 'a section without lines (the intro)');
  assert.deepEqual(S.areaSel(AREAS.resolve(doc, plan, { kind: 'work' })), S.WORK);
  const cutKey = plan.cuts.find((c) => c.line).key;
  assert.deepEqual(S.areaSel(AREAS.resolve(doc, plan, { kind: 'cut', key: cutKey })), { level: 'cut', key: cutKey });
  assert.deepEqual(S.areaSel(null), S.WORK);
  // Crumbs and the scope of an area selection are those of its lines (the last crumb keeps the area).
  const labels = (s) => S.crumbs(s, plan).map((c) => c.label);
  assert.deepEqual(labels(sel), labels({ level: 'line', ids: sel.ids }));
  assert.deepEqual(S.crumbs(sel, plan).pop().sel, sel);
  assert.deepEqual(S.scopeOf(sel), S.scopeOf({ level: 'line', ids: sel.ids }));
});

test('v2.1 validate: the area stays while it has exactly the selected lines, else it is dropped and the ids stay', () => {
  const AREAS = MV.use('planner/areas');
  const { doc, plan } = v21();
  const head = AREAS.areasOf(doc, plan).heads[0];
  const sel = S.areaSel(head);
  assert.equal(S.validate(sel, plan, doc), sel, 'unchanged');
  assert.equal(S.validate(sel, plan), sel, 'without the document a well-formed ref is kept');
  // A bad or non-line ref is dropped even without the document.
  for (const area of [{ kind: 'cut', key: plan.cuts[0].key }, { kind: 'work' }, { kind: 'head' }, 'head:r3', null]) {
    assert.deepEqual(S.validate(Object.assign({}, sel, { area }), plan), { level: 'line', ids: sel.ids }, JSON.stringify(area));
  }
  // Fewer ids than the heading has (a line typed into it since): the area is dropped.
  const fewer = { level: 'line', ids: sel.ids.slice(0, -1), area: head.ref };
  assert.deepEqual(S.validate(fewer, plan, doc), { level: 'line', ids: fewer.ids });
  // More ids than it has (a line added to the selection with Shift): the area is dropped too.
  const extra = plan.lines.find((l) => !sel.ids.includes(l.id)).id;
  const more = { level: 'line', ids: sel.ids.concat([extra]), area: head.ref };
  assert.deepEqual(S.validate(more, plan, doc), { level: 'line', ids: more.ids });
  // The heading row is deleted: the ref no longer resolves.
  const gone = { level: 'line', ids: sel.ids, area: { kind: 'head', rowId: 'nope' } };
  assert.deepEqual(S.validate(gone, plan, doc), { level: 'line', ids: sel.ids });
  // A line of the area deleted: the ids shrink first (the area goes with them).
  const plan2 = Object.assign({}, plan, { lines: plan.lines.filter((l) => l.id !== sel.ids[0]) });
  assert.deepEqual(S.validate(sel, plan2, doc), { level: 'line', ids: sel.ids.slice(1) });
  // A "lines" ref (the board's 選択中の行を区画にする) holds while those lines exist.
  const ids = plan.lines.slice(0, 2).map((l) => l.id);
  const lines = { level: 'line', ids, area: { kind: 'lines', ids } };
  assert.equal(S.validate(lines, plan, doc), lines);
});

test('v2.1 timeline: the area band under a time; the highlight names one line or an area\'s lines', () => {
  const TL = MV.use('ui/timeline');
  const AREAS = MV.use('planner/areas');
  const { doc, plan } = v21();
  const bands = AREAS.bands(doc, plan);
  assert.ok(bands.length >= 2);
  assert.equal(TL.bandAt(bands, bands[1].t0), bands[1], 'a band starts at its t0');
  assert.equal(TL.bandAt(bands, bands[0].t1), bands[1], 'and ends before its t1');
  assert.equal(TL.bandAt(bands, -1), null);
  assert.equal(TL.bandAt(null, 3), null);
  // The band's selection is its area's lines (ui/selection.areaSel of the resolved ref).
  const verse = bands.find((b) => b.n > 1);
  const sel = S.areaSel(AREAS.resolve(doc, plan, verse.ref));
  assert.equal(sel.ids.length, verse.n);
  assert.deepEqual([...TL.highlighted(['r4', 'r5'])], ['r4', 'r5']);
  assert.deepEqual([...TL.highlighted('r4')], ['r4']);
  assert.deepEqual([...TL.highlighted(null)], []);
});
