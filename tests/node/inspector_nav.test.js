/* 文字PVメーカー v2 — original work. Inspector bookmarks retain editing scope and selected areas. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');
const MV = load(), NAV = MV.use('ui/inspector_nav'), F = MV.use('ui/fields');
const D = MV.use('core/doc'), C = MV.use('core/commands'), PL = MV.use('planner/plan');
const reg = MV.use('parts/catalog').defaultRegistry();
const doc = C.reduce(D.defaultDoc(), { t: 'lyrics.set', text: '# A\n[00:05.00]first/second\n[00:10.00]one cut\n\n# B\n[00:15.00]another line' });
const plan = PL.plan(doc, { registry: reg });
const line = plan.lines.find((l) => l.cuts.length === 1);
const cut = line.cuts[0];
const area = { level: 'line', ids: plan.lines.slice(0, 2).map((l) => l.id),
  area: { kind: 'lines', ids: plan.lines.slice(0, 2).map((l) => l.id) } };
const find = (target) => F.sectionsFor(target.sel, plan, reg, doc).find((s) => s.id === target.section);

test('camera bookmarks retain whole-work, line, exact cut and existing element scope', () => {
  const samples = [
    [{ level: 'work' }, 'work'], [{ level: 'line', ids: [line.id] }, 'line/' + line.id],
    [{ level: 'cut', key: cut }, 'cut/' + cut], [{ level: 'el', scope: 'cut/' + cut, el: 'text' }, 'cut/' + cut],
  ];
  for (const [selection, scope] of samples) {
    const target = NAV.target('camera', selection, plan, doc);
    assert.deepEqual(target.sel, { level: 'el', scope, el: 'lens' });
    assert.ok(find(target).fields.some((f) => f.path === 'cam.shot'));
  }
});

test('camera, layout, background, decorations and effects keep all selected area lines', () => {
  for (const key of ['camera', 'layout', 'text', 'background', 'ornament', 'effects', 'timing']) {
    const target = NAV.target(key, area, plan, doc);
    assert.equal(target.sel, area, key + ' retains the same validated selection, including its area');
    const section = find(target);
    assert.ok(section, key + ' opens a section that exists');
    if (target.slot) {
      const field = section.fields.find((f) => f.path === target.slot);
      assert.ok(field, key + ' has a relevant field');
      assert.deepEqual(F.pathsFor(field, F.contextOf(target.sel, plan, reg, doc)), area.ids.map((id) => 'line/' + id + ':' + target.slot));
    }
  }
});

test('one-line areas still keep their area camera and multi-selection field behavior', () => {
  const selection = { level: 'line', ids: [line.id], area: { kind: 'lines', ids: [line.id] } };
  for (const key of ['camera', 'ornament', 'effects']) {
    const target = NAV.target(key, selection, plan, doc);
    assert.equal(target.sel, selection);
    assert.equal(F.pageOf(target.sel, plan), 'lines');
    assert.ok(find(target));
  }
});

test('all settings bookmarks resolve existing fields and sections across work, line and cut contexts', () => {
  for (const selection of [{ level: 'work' }, { level: 'line', ids: [line.id] }, { level: 'cut', key: cut }]) {
    for (const key of NAV.KEYS.filter((k) => k !== 'scope')) {
      const target = NAV.target(key, selection, plan, doc), section = find(target);
      assert.ok(section, selection.level + '/' + key);
      if (target.slot) assert.ok(section.fields.some((f) => f.path === target.slot), selection.level + '/' + key + '/' + target.slot);
    }
  }
});

test('scope return retains a sole cut and selected decoration index stays chosen', () => {
  const selection = { level: 'el', scope: 'cut/' + cut, el: 'ornament', idx: 2 };
  assert.deepEqual(NAV.target('scope', selection, plan, doc).sel, { level: 'cut', key: cut });
  assert.equal(NAV.target('ornament', selection, plan, doc).sel.idx, 2);
  assert.equal(NAV.target('effects', selection, plan, doc).sel.idx, 0);
});

test('new multi-selection slots apply and undo without affecting unselected lines', () => {
  const target = NAV.target('ornament', area, plan, doc), ctx = F.contextOf(target.sel, plan, reg, doc);
  const fields = find(target).fields.filter((f) => /^ornament#[012]$/.test(f.path));
  assert.equal(fields.length, 3, 'each decoration slot is directly accessible');
  const cmds = fields.flatMap((field) => F.pathsFor(field, ctx).map((path) => ({ t: 'pin.set', path, v: 'none', by: 'user' })));
  const changed = C.reduce(doc, { t: 'batch', cmds });
  assert.deepEqual(D.validate(changed), []);
  assert.equal(Object.keys(changed.pins).length, area.ids.length * 3);
  for (const l of plan.lines.filter((l) => !area.ids.includes(l.id))) {
    assert.ok(!Object.keys(changed.pins).some((p) => p.startsWith('line/' + l.id + ':')));
  }
  const store = MV.use('core/store').createStore({ doc, reduce: C.reduce });
  store.dispatch({ t: 'batch', cmds }); store.undo();
  assert.deepEqual(store.doc, doc);
});

test('unknown bookmarks are ignored and stale selection falls back to the whole work', () => {
  assert.equal(NAV.target('missing', area, plan, doc), null);
  assert.equal(NAV.target('camera', { level: 'cut', key: 'missing' }, plan, doc).sel.scope, 'work');
});
