/* 文字PVメーカー v2 — original work. Timing-target nudges through the real planner and undo store. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');
const corpus = require('../helpers/corpus');
const api = load();
const D = api.use('core/doc'), C = api.use('core/commands'), TT = api.use('ui/timing_targets');
const A = api.use('planner/areas'), PL = api.use('planner/plan'), ST = api.use('core/store');
const registry = api.use('parts/catalog').defaultRegistry();
const plan = (doc) => PL.plan(doc, { registry });
const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.00001, what + ': ' + a + ' vs ' + b);
const times = (p) => p.lines.map((l) => [l.id, l.t0, l.t1]);
const TEXT = '# A\n[00:05.00]abcdef/ghijkl/mnopqr\n[00:10.00]second line\n\n# B\n[00:15.00]third line\n[00:20.00]last line';
function fixture(text = TEXT) { return C.reduce(D.defaultDoc(), { t: 'lyrics.set', text }); }
function apply(doc, p, target, delta) {
  const result = TT.shift(doc, p, target, delta);
  const next = C.reduce(doc, { t: 'batch', cmds: result.cmds });
  assert.deepEqual(D.validate(next), []);
  return { doc: next, p: plan(next), result };
}

test('resolves all lines, exact selected cut and line element without broadening the selection', () => {
  const doc = fixture(), p = plan(doc), l = p.lines[0], cut = l.cuts[1];
  assert.deepEqual(TT.resolve(doc, p, 'all', { level: 'work' }).lineIds, p.lines.map((x) => x.id));
  assert.equal(TT.resolve(doc, p, 'selection', { level: 'cut', key: cut }).key, cut);
  assert.equal(TT.resolve(doc, p, 'selection', { level: 'el', scope: 'cut/' + cut, el: 'text' }).key, cut);
  assert.deepEqual(TT.resolve(doc, p, 'selection', { level: 'el', scope: 'line/' + l.id, el: 'text' }).lineIds, [l.id]);
  assert.equal(TT.resolve(doc, p, 'selection', { level: 'work' }), null);
  assert.equal(TT.resolve(doc, p, 'selection', { level: 'line', ids: ['rzz'] }), null);
});

test('moves only a selected line, preserving its duration and all other effective starts and ends', () => {
  const doc = fixture(), p = plan(doc), selected = p.lines[1];
  const target = TT.selected(doc, p, { level: 'line', ids: [selected.id] });
  const next = apply(doc, p, target, -1);
  p.lines.forEach((l, i) => {
    const offset = l.id === selected.id ? -1 : 0;
    near(next.p.lines[i].t0, l.t0 + offset, l.id + ' start');
    near(next.p.lines[i].t1, l.t1 + offset, l.id + ' end');
  });
  assert.equal(next.doc.sheet, doc.sheet);
  assert.equal(next.doc.song, doc.song);
  assert.equal(next.doc.timing, doc.timing);
});

test('pins automatic neighbours in the same atomic undo entry and restores all original timing modes on undo', () => {
  const doc = fixture('# A\nfirst line\nsecond line\n\n# B\nthird line\nfourth line'), before = plan(doc);
  const store = ST.createStore({ doc, reduce: C.reduce }), id = before.lines[1].id;
  for (let i = 0; i < 3; i++) {
    const p = plan(store.doc), target = TT.selected(store.doc, p, { level: 'line', ids: [id] });
    const r = TT.shift(store.doc, p, target, -0.1);
    store.batch({ label: ['undo.shift', { n: 1 }], mergeKey: 'timing-test:' + id }, r.cmds);
  }
  const after = plan(store.doc);
  before.lines.forEach((l, i) => {
    near(after.lines[i].t0, l.t0 + (l.id === id ? -0.3 : 0), l.id + ' start after repeated moves');
    near(after.lines[i].t1, l.t1 + (l.id === id ? -0.3 : 0), l.id + ' end after repeated moves');
  });
  assert.equal(store.list().filter((e) => e.done).length, 1);
  store.undo();
  assert.equal(store.doc, doc, 'the complete pre-shift document returns, including automatic neighbours');
  assert.deepEqual(times(plan(store.doc)), times(before));
  store.redo();
  assert.deepEqual(times(plan(store.doc)), times(after));
});

test('moves a chosen block by a common delta and retains its captured members across the audio section boundary', () => {
  const doc = fixture(), p = plan(doc), area = TT.areas(doc, p).find((a) => a.key === 'head:r1');
  const target = TT.resolve(doc, p, 'area', { level: 'work' }, area), next = apply(doc, p, target, -1);
  p.lines.forEach((l, i) => {
    const d = area.lineIds.includes(l.id) ? -1 : 0;
    near(next.p.lines[i].t0, l.t0 + d, l.id + ' block start');
    near(next.p.lines[i].t1, l.t1 + d, l.id + ' block end');
  });
  // A song area's members are derived from time. A selected target holds the original members instead.
  const captured = { lineIds: area.lineIds, label: area.label, ref: { kind: 'song', n: 0, t0: 5, t1: 11 } };
  assert.deepEqual(TT.resolve(next.doc, next.p, 'area', { level: 'work' }, captured).lineIds, area.lineIds);
});

test('a captured audio section remains available when every target line moves outside its original audio span', () => {
  const doc = api.use('core/migrate').parseFile(corpus.projectText('v21')).doc, p = plan(doc);
  const area = TT.areas(doc, p).find((a) => a.key === 'song:4@46-60');
  const target = TT.resolve(doc, p, 'area', { level: 'work' }, area), next = apply(doc, p, target, -15);
  assert.equal(A.resolve(next.doc, next.p, area.ref).lineIds.length, 0, 'all captured lines left their analysis span');
  assert.ok(TT.areas(next.doc, next.p, area).some((a) => a === area), 'the picker retains the chosen section');
  assert.deepEqual(TT.resolve(next.doc, next.p, 'area', { level: 'work' }, area).lineIds, area.lineIds);
  const later = apply(next.doc, next.p, target, 1);
  area.lineIds.forEach((id) => near(later.p.lines.find((l) => l.id === id).t0, p.lines.find((l) => l.id === id).t0 - 14, id));
});

test('selected moves stop at the neighbouring start order, preserving internal intervals and valid anchors', () => {
  const doc = fixture(), p = plan(doc), ids = p.lines.slice(1, 3).map((l) => l.id);
  const target = TT.selected(doc, p, { level: 'line', ids });
  const earlier = apply(doc, p, target, -100);
  near(earlier.result.delta, -4.9, 'common earlier delta');
  near(earlier.p.lines[1].t0, p.lines[0].t0 + 0.1, 'previous anchor margin');
  near(earlier.p.lines[2].t0 - earlier.p.lines[1].t0, 5, 'selected interval');
  assert.ok(!earlier.p.warnings.some((w) => w.code === 'time-order'));
  const later = apply(doc, p, target, 100);
  near(later.result.delta, 4.9, 'common later delta');
  near(later.p.lines[2].t0, p.lines[3].t0 - 0.1, 'next anchor margin');
});

test('the global shift reaches zero and moves unlocked cut times while preserving their provenance and signature', () => {
  let doc = fixture(), p = plan(doc), c = p.cuts.find((x) => x.key === p.lines[0].cuts[1]);
  const path = 'cut/' + c.key + ':t0';
  doc = C.reduce(doc, { t: 'pin.set', path, v: c.t0, by: 'ai', sig: c.text }); p = plan(doc);
  const target = TT.resolve(doc, p, 'all', { level: 'work' }), next = apply(doc, p, target, -100);
  near(next.result.delta, -5, 'zero clamp');
  near(next.p.lines[0].t0, 0, 'first lyric starts at zero');
  near(next.doc.pins[path].v, c.t0 - 5, 'cut timing moves with line');
  assert.equal(next.doc.pins[path].by, 'ai');
  assert.equal(next.doc.pins[path].sig, c.text);
});

test('a selected line moves only its attached cut pins, leaving unrelated cut pins intact', () => {
  let doc = fixture(), p = plan(doc), a = p.cuts.find((c) => c.key === p.lines[0].cuts[1]);
  const path = 'cut/' + a.key + ':t0';
  doc = C.reduce(doc, { t: 'pin.set', path, v: a.t0, by: 'tap', sig: a.text }); p = plan(doc);
  const next = apply(doc, p, TT.selected(doc, p, { level: 'line', ids: [p.lines[1].id] }), -1);
  assert.equal(next.doc.pins[path], doc.pins[path]);
  const moved = apply(doc, p, TT.selected(doc, p, { level: 'line', ids: [p.lines[0].id] }), -1);
  near(moved.doc.pins[path].v, a.t0 - 1, 'target pin moved');
});

test('locked timing pins stay untouched and block a target move; appearance-only locks still allow timing edits', () => {
  let doc = fixture(), p = plan(doc), l = p.lines[0], c = p.cuts.find((x) => x.key === l.cuts[1]);
  const path = 'cut/' + c.key + ':t0';
  doc = C.reduce(doc, { t: 'pin.set', path, v: c.t0, by: 'lock', sig: c.text }); p = plan(doc);
  assert.equal(TT.shift(doc, p, TT.selected(doc, p, { level: 'line', ids: [l.id] }), -1).reason, 'locked');
  assert.equal(TT.shift(doc, p, TT.selected(doc, p, { level: 'cut', key: c.key }), -1).reason, 'locked');
  assert.equal(doc.pins[path].by, 'lock');
  assert.equal(doc.pins[path].sig, c.text);
  let appearance = C.reduce(fixture(), { t: 'lock.set', lineId: l.id, pins: {
    ['cut/' + c.key + ':arrange']: { v: registry.fallback('arrange'), by: 'lock', sig: c.text } }, n: 1 });
  const ap = plan(appearance), next = apply(appearance, ap, TT.selected(appearance, ap, { level: 'line', ids: [l.id] }), -1);
  assert.equal(next.doc.locks, appearance.locks);
  assert.equal(next.doc.pins['cut/' + c.key + ':arrange'], appearance.pins['cut/' + c.key + ':arrange']);
});

test('a selected inner cut changes its own start boundary and keeps the other line and sibling starts stable', () => {
  const doc = fixture(), p = plan(doc), line = p.lines[0], cut = p.cuts.find((c) => c.key === line.cuts[1]);
  const next = apply(doc, p, TT.selected(doc, p, { level: 'cut', key: cut.key }), 0.1);
  assert.deepEqual(times(next.p), times(p));
  for (const c of p.cuts.filter((x) => x.line === line.id)) {
    const n = next.p.cuts.find((x) => x.key === c.key);
    near(n.t0, c.t0 + (c.key === cut.key ? 0.1 : 0), c.key + ' boundary');
  }
  const nextCut = next.p.cuts.find((c) => c.key === cut.key);
  near(nextCut.t1, cut.t1, 'selected end remains fixed');
  assert.ok(!next.p.warnings.some((w) => ['piece-merged', 'pin-bad-value'].includes(w.code)));
});

test('first-cut selection changes only its start, preserving the parent end and later sibling boundaries', () => {
  const doc = fixture(), p = plan(doc), line = p.lines[0], cut = p.cuts.find((c) => c.key === line.cuts[0]);
  const next = apply(doc, p, TT.selected(doc, p, { level: 'cut', key: cut.key }), 0.1);
  near(next.p.lines[0].t0, line.t0 + 0.1, 'first cut and line start');
  near(next.p.lines[0].t1, line.t1, 'line end');
  for (const key of line.cuts.slice(1)) near(next.p.cuts.find((c) => c.key === key).t0, p.cuts.find((c) => c.key === key).t0, key);
  assert.deepEqual(times(next.p).slice(1), times(p).slice(1));
});

test('inner-cut shifts stop before a sibling would merge and do not disappear after a large requested nudge', () => {
  const doc = fixture(), p = plan(doc), cut = p.cuts.find((c) => c.key === p.lines[0].cuts[1]);
  for (const delta of [-100, 100]) {
    const next = apply(doc, p, TT.selected(doc, p, { level: 'cut', key: cut.key }), delta);
    assert.deepEqual(next.p.lines[0].cuts, p.lines[0].cuts);
    assert.ok(!next.p.warnings.some((w) => w.code === 'piece-merged'));
  }
});

test('a sole cut start cannot pass the next line when its pinned end intentionally overlaps it', () => {
  let doc = fixture(), p = plan(doc), line = p.lines[1];
  doc = C.reduce(doc, { t: 'batch', cmds: [
    { t: 'pin.set', path: 'line/' + line.id + ':end', v: 19, by: 'user' },
    { t: 'pin.set', path: 'line/' + line.id + ':split', v: 'none', by: 'user' },
  ] }); p = plan(doc);
  const cut = p.cuts.find((c) => c.key === line.cuts[0]);
  const next = apply(doc, p, TT.selected(doc, p, { level: 'cut', key: cut.key }), 100);
  near(next.p.lines[1].t0, p.lines[2].t0 - 0.1, 'selected start remains before next line');
  near(next.p.lines[1].t1, 19, 'overlapping end is preserved');
  assert.deepEqual(times(next.p).filter((x) => x[0] !== line.id), times(p).filter((x) => x[0] !== line.id));
  assert.ok(!next.p.warnings.some((w) => w.code === 'time-order'));
});

test('a selected split interlude boundary moves within its parts, keeping lyrics and other gap boundaries intact', () => {
  let doc = fixture('[00:05.00]first line\n[00:20.00]second line'), p = plan(doc);
  const gap = p.cuts.find((c) => c.key === 'gap/' + p.lines[0].id);
  assert.ok(gap);
  const path = 'cut/' + gap.key + ':parts';
  doc = C.reduce(doc, { t: 'pin.set', path, v: [12, 16], by: 'user', sig: '' }); p = plan(doc);
  const cut = p.cuts.find((c) => c.key === gap.key + '~2');
  const next = apply(doc, p, TT.selected(doc, p, { level: 'cut', key: cut.key }), 0.1);
  assert.deepEqual(times(next.p), times(p));
  assert.deepEqual(next.doc.pins[path].v, [12.1, 16]);
  near(next.p.cuts.find((c) => c.key === cut.key).t0, 12.1, 'part start');
  assert.equal(TT.shift(doc, p, TT.selected(doc, p, { level: 'cut', key: gap.key }), -1).reason, 'boundary');
});
