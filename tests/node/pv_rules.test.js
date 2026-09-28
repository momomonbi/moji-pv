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

// --- 文字PVの定石 (P2, DESIGN_2_2 §2) ---------------------------------------------------------------------------------

const fs = require('node:fs');
const path = require('node:path');
const corpus = require('../helpers/corpus.js');
const PL = MV.use('planner/plan');
const CMD = MV.use('core/commands');
const M = MV.use('core/migrate');
const CAT = MV.use('parts/catalog').defaultRegistry();

const clone = (x) => JSON.parse(JSON.stringify(x));
const ON = (v) => ({ v, by: 'user' });
const P2 = ['pv.rules', 'repeat.same', 'pv.kit', 'pv.alternate', 'pv.arc', 'pv.fxCap', 'pv.fxMax'];
const MEMBERS = ['repeat.same', 'pv.kit', 'pv.alternate', 'pv.arc', 'pv.fxCap'];

// The other packages' switches at their off values (their rows of the table; DESIGN_2_2 §2.1.8 OTHER_OFF), so a
// document of generation 1 differs from an older one only by P2's rules.
function otherOff() {
  const out = {};
  for (const r of RU.ROWS) if (!P2.includes(r.slot) && r.off !== null) out['work:' + r.slot] = ON(r.off);
  return out;
}

// A document of generation 1 (a new work) with some pins.
function gen1(doc, pins) {
  const out = clone(doc);
  out.look.gen = D.GEN;
  out.pins = Object.assign({}, out.pins, otherOff(), pins || {});
  return out;
}

function resolved(doc) { return RU.resolve({ doc, ix: PINS.index(doc.pins), warn: null }); }

test('newDoc carries only the marker; normalize never adds it or a pv pin (fixtures and corpus)', () => {
  const fresh = D.newDoc();
  assert.equal(fresh.look.gen, D.GEN);
  assert.deepEqual(fresh.pins, {});
  assert.equal(D.defaultDoc().look.gen, undefined);
  const docs = corpus.ALL_PROJECTS.concat(corpus.EXTRA_PROJECTS).map((n) => corpus.project(n).doc)
    .concat(corpus.corpus(1).map((x) => x.doc));
  for (const doc of docs) {
    const n = D.normalize(clone(doc));
    assert.equal(n.look.gen, undefined);
    assert.ok(!Object.keys(n.pins).some((p) => /:pv\./.test(p)), 'no pv pin');
    assert.equal(resolved(doc).any, false, 'an older document plans without 文字PVの定石');
    assert.equal(resolved(doc).repeatDefault, false);
  }
  const back = M.parseFile(D.serialize({ doc: gen1(D.defaultDoc()) }));
  assert.equal(back.doc.look.gen, D.GEN);
});

test('resolve: the group switch, its members and a new work\'s defaults cascade', () => {
  const old = D.defaultDoc();
  const r0 = resolved(old);
  assert.deepEqual([r0.rules, r0.repeatDefault, r0.kit, r0.alt, r0.arc, r0.fx, r0.fxMax, r0.any], [false, false, false, false, false, false, null, false]);
  assert.equal(r0.id, 'g0|r0|k0a0c0f0|m-');
  const r1 = resolved(D.newDoc());
  assert.deepEqual([r1.rules, r1.repeatDefault, r1.kit, r1.alt, r1.arc, r1.fx, r1.any], [true, true, true, true, true, true, true]);
  const off = resolved(gen1(D.newDoc(), { 'work:pv.rules': ON(false) }));
  assert.deepEqual([off.rules, off.repeatDefault, off.kit, off.alt, off.arc, off.fx, off.any], [false, false, false, false, false, false, false]);
  const onlyKit = resolved(gen1(D.newDoc(), { 'work:pv.rules': ON(false), 'work:pv.kit': ON(true) }));
  assert.deepEqual([onlyKit.kit, onlyKit.alt, onlyKit.arc, onlyKit.fx, onlyKit.any], [true, false, false, false, true]);
  // an older work turns them on with one pin
  const oldOn = resolved(Object.assign(clone(old), { pins: { 'work:pv.rules': ON(true) } }));
  assert.deepEqual([oldOn.kit, oldOn.alt, oldOn.arc, oldOn.repeatDefault], [true, true, true, true]);
  // 固定を外す returns to the document's default
  let doc = gen1(D.newDoc(), { 'work:pv.rules': ON(false) });
  doc = CMD.reduce(doc, { t: 'pin.clearUnder', scope: 'work' });
  assert.equal(resolved(doc).rules, true);
  assert.equal(RU.repeatDefault(doc, null), true);
  assert.equal(RU.repeatDefault(null, null), false, 'no document: the v2.1 opt-in');
  // 1カットに重ねる効果の目安: a pin 4–8, else automatic from the cut pace
  assert.equal(resolved(gen1(D.newDoc(), { 'work:pv.fxMax': ON(6) })).fxMax, 6);
  assert.equal(RU.baseCap({ pace: 0 }), 4);
  assert.equal(RU.baseCap({ pace: 0.5 }), 5);
  assert.equal(RU.baseCap({ pace: 1 }), 6);
});

test('commands: the pv switches live at work scope; kit salts are valid salt keys', () => {
  const doc = D.newDoc();
  assert.throws(() => CMD.reduce(doc, { t: 'pin.set', path: 'line/r1:pv.kit', v: true, by: 'user' }), /whole video/);
  assert.throws(() => CMD.reduce(doc, { t: 'pin.set', path: 'cut/r1~0:pv.arc', v: true, by: 'user', sig: 'x' }), /whole video/);
  assert.throws(() => CMD.reduce(doc, { t: 'lock.set', lineId: 'r1', pins: { 'line/r1:pv.alternate': { v: false, by: 'lock' } } }));
  let d = CMD.reduce(doc, { t: 'pin.set', path: 'work:pv.kit', v: false, by: 'user' });
  assert.equal(d.pins['work:pv.kit'].v, false);
  // 「くり返しの行をそろえる」 keeps its line scope
  d = CMD.reduce(d, { t: 'pin.set', path: 'line/r1:repeat.same', v: false, by: 'user' });
  for (const key of ['work:kit.chorus', 'work:kit.br1a', 'work:kit.hr5', 'work:kit.verse2']) d = CMD.reduce(d, { t: 'salt.bump', key });
  assert.equal(d.salts['work:kit.chorus'], 1);
  assert.deepEqual(D.validate(d), []);
});

test('a bad pv pin warns once and falls back; 1カットに重ねる効果の目安 takes 4–8', () => {
  const base = corpus.project('basic').doc;
  const bad = gen1(base, { 'work:pv.kit': ON('yes'), 'work:pv.fxMax': ON(3) });
  const p = PL.run(bad, CAT, { fresh: true });
  const warns = p.warnings.filter((w) => w.code === 'pin-bad-value').map((w) => w.path).sort();
  assert.deepEqual(warns, ['work:pv.fxMax', 'work:pv.kit']);
  for (const v of [4, 8]) assert.equal(resolved(gen1(base, { 'work:pv.fxMax': ON(v) })).fxMax, v);
  assert.equal(resolved(bad).kit, true, 'a value the switch cannot hold falls back to the default');
});

// Completeness of the gate (DESIGN_2_2 §2.1.7 item 4): a new work with 文字PVの定石 pinned off (and the other packages'
// switches off) plans exactly as the same document made before PV22.
test('gate: generation 1 with 文字PVの定石 off plans byte-identically to the older document', () => {
  const docs = corpus.ALL_PROJECTS.concat(['repeat']).map((name) => ({ name, doc: corpus.project(name).doc }))
    .concat(corpus.corpus(2, ['16:9', '9:16']));
  for (const { name, doc } of docs) {
    // the repeat fixture pins 「くり返しの行をそろえる」 itself: its pin stays, so both plans align the same cuts
    const off = gen1(doc, { 'work:pv.rules': ON(false) });
    assert.equal(PL.run(off, CAT, { fresh: true }).hash, PL.run(doc, CAT, { fresh: true }).hash, name);
  }
});

// Every rule is live (item 5): each alone changes the plan of the repeat fixture without its pin.
test('every rule of 文字PVの定石 changes the plan on its own', () => {
  const doc = clone(corpus.project('repeat').doc);
  delete doc.pins['work:repeat.same'];
  const none = gen1(doc, { 'work:pv.rules': ON(false) });
  const h0 = PL.run(none, CAT, { fresh: true }).hash;
  assert.equal(h0, PL.run(doc, CAT, { fresh: true }).hash);
  for (const slot of ['repeat.same', 'pv.kit', 'pv.alternate', 'pv.arc']) {
    const one = gen1(doc, { 'work:pv.rules': ON(false), ['work:' + slot]: ON(true) });
    assert.notEqual(PL.run(one, CAT, { fresh: true }).hash, h0, slot);
  }
});

test('the three new-work sites call D.newDoc(), never D.defaultDoc()', () => {
  const SRC = path.join(__dirname, '..', '..', 'src', 'ui');
  const boot = fs.readFileSync(path.join(SRC, 'boot.js'), 'utf8');
  const io = fs.readFileSync(path.join(SRC, 'project_io.js'), 'utf8');
  assert.equal((boot.match(/D\.newDoc\(\)/g) || []).length, 1);
  assert.equal((io.match(/D\.newDoc\(\)/g) || []).length, 2);
  assert.ok(!/D\.defaultDoc\(\)/.test(boot) && !/D\.defaultDoc\(\)/.test(io));
});
