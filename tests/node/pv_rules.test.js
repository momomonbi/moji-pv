/* 文字PVメーカー v2 — original work. Tests: the new-work defaults table planner/rules and the document generation look.gen (DESIGN_2_2 §0). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const D = MV.use('core/doc');
const RU = MV.use('planner/rules');
const PINS = MV.use('core/pins');

const withPins = (doc, pins) => Object.assign({}, doc, { pins: Object.assign({}, doc.pins, pins) });
const ix = (doc) => PINS.index(doc.pins);

test('rows: every slot once, scopes work (and line), a spec, a parent in the table and never a cycle', () => {
  const seen = new Set();
  for (const r of RU.ROWS) {
    assert.ok(!seen.has(r.slot), r.slot + ' twice');
    seen.add(r.slot);
    assert.ok(Array.isArray(r.scopes) && r.scopes.includes('work') && r.scopes.every((s) => s === 'work' || s === 'line'), r.slot);
    assert.ok(r.spec && typeof r.spec.type === 'string', r.slot);
    assert.equal(RU.SPECS[r.slot], r.spec);
    if (r.parent) {
      assert.ok(RU.isRule(r.parent), r.slot + ' parent ' + r.parent);
      let p = r.parent, n = 0;
      while (p && n++ < 10) p = RU.rowOf(p).parent;
      assert.equal(p, null, r.slot + ': the parent chain ends');
    }
  }
  assert.equal(RU.isRule('arrange'), false);
  assert.equal(RU.value(D.defaultDoc(), null, 'arrange'), undefined);
});

test('the generation decides the defaults: new documents get `on`, older ones and fixtures `off`', () => {
  const fresh = D.newDoc(), old = D.defaultDoc();
  assert.equal(RU.gen(fresh), D.GEN);
  assert.equal(RU.gen(old), 0);
  assert.equal(RU.gen(null), 0);
  for (const r of RU.ROWS) {
    const onNew = RU.value(fresh, null, r.slot), onOld = RU.value(old, null, r.slot);
    if (r.parent) {
      assert.equal(onNew, RU.value(fresh, null, r.parent), r.slot + ' follows its parent');
      assert.equal(onOld, RU.value(old, null, r.parent), r.slot + ' follows its parent');
    } else {
      assert.equal(onNew, r.on, r.slot);
      assert.equal(onOld, r.off, r.slot);
    }
  }
  assert.equal(RU.value(fresh, null, 'pv.rules'), true);
  assert.equal(RU.value(old, null, 'pv.rules'), false);
  assert.equal(RU.value(fresh, null, 'text.kana'), 0.7);
  assert.equal(RU.value(old, null, 'text.kana'), 0);
  assert.equal(RU.hasDefault('text.head'), false, 'the same in both generations');
  assert.equal(RU.hasDefault('pv.kit'), true, 'through its parent');
});

test('a pin wins: work pins, line pins where the row allows them, never cut pins; bad values fall back', () => {
  const old = D.defaultDoc();
  const on = withPins(old, { 'work:pv.rules': { v: true, by: 'user' } });
  assert.equal(RU.value(on, null, 'pv.rules'), true);
  assert.equal(RU.value(on, ix(on), 'pv.kit'), true, 'a member follows the pinned group switch');
  const memberOff = withPins(on, { 'work:pv.kit': { v: false, by: 'user' } });
  assert.equal(RU.value(memberOff, null, 'pv.kit'), false);
  assert.equal(RU.value(memberOff, null, 'pv.arc'), true);
  const groupOff = withPins(D.newDoc(), { 'work:pv.rules': { v: false, by: 'user' } });
  assert.equal(RU.value(groupOff, null, 'pv.alternate'), false, 'turning the group off turns unpinned members off');
  // strengths are coerced by the spec
  const kana = withPins(old, { 'work:text.kana': { v: 0.42, by: 'user' }, 'line/r2:text.kana': { v: 0, by: 'user' } });
  assert.equal(RU.value(kana, null, 'text.kana'), 0.4);
  assert.equal(RU.valueAt(kana, null, 'text.kana', 'r2'), 0);
  assert.equal(RU.valueAt(kana, null, 'text.kana', 'r3'), 0.4);
  // a line pin of a work-only row does not apply; a cut pin never does
  const lineOnly = withPins(old, { 'line/r2:pv.kit': { v: true, by: 'user' }, 'cut/r2~0:text.jump': { v: 1, by: 'user', sig: 'x' } });
  assert.equal(RU.valueAt(lineOnly, null, 'pv.kit', 'r2'), false);
  assert.equal(RU.valueAt(lineOnly, null, 'text.jump', 'r2'), 0);
  const bad = withPins(D.newDoc(), { 'work:text.head': { v: 'sideways', by: 'user' } });
  assert.equal(RU.value(bad, null, 'text.head'), 'line', 'a value the slot cannot hold falls back to the default');
  assert.equal(RU.sameValue(0.7, 0.7000000001), true);
  assert.equal(RU.sameValue('line', 'phrase'), false);
});
