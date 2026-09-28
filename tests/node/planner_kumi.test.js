/* 文字PVメーカー v2 — original work. Tests: 文字組み in the plan — the new-work defaults behind look.gen, work and line pins, the gate's completeness, locks, field states, explain and the cast cache (DESIGN_2_2 §1, S.2–S.4). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const CMD = MV.use('core/commands');
const PL = MV.use('planner/plan');
const CA = MV.use('planner/cast');
const F = MV.use('planner/fields');
const EX = MV.use('planner/explain');
const RU = MV.use('planner/rules');
const CAT = MV.use('parts/catalog').defaultRegistry();

const KUMI = ['text.kana', 'text.jump', 'text.latin', 'text.head'];
const clone = (x) => JSON.parse(JSON.stringify(x));
const gen = (doc) => Object.assign({}, doc, { look: Object.assign({}, doc.look, { gen: 1 }) });
const withPins = (doc, pins) => Object.assign({}, doc, { pins: Object.assign({}, doc.pins, pins) });
const run = (doc, reg = CAT) => PL.run(doc, reg, { fresh: true });
const user = (v) => ({ v, by: 'user' });
const OFF = { 'work:text.kana': user(0), 'work:text.jump': user(0), 'work:text.latin': user(0) };
const ALL = corpus.ALL_PROJECTS.concat(corpus.EXTRA_PROJECTS);

// A plan without the 文字組み slots and the fingerprints they feed (cut.fp, the plan hash).
function withoutKumi(p) {
  return p.cuts.map((c) => {
    const slots = Object.assign({}, c.slots);
    for (const k of KUMI) delete slots[k];
    return { key: c.key, slots, els: c.els, ground: c.ground, rig: c.rig, seamIn: c.seamIn, t0: c.t0, t1: c.t1 };
  });
}

test('the slot specs: the same in planner/cast and planner/rules; KUMI_SLOTS head last', () => {
  assert.deepEqual(CA.KUMI_SLOTS, KUMI);
  assert.deepEqual(F.KUMI_SLOTS, KUMI);
  for (const slot of KUMI) {
    assert.deepEqual(CA.SLOT_SPECS[slot], RU.SPECS[slot], slot);
    assert.deepEqual(RU.scopesOf(slot), ['work', 'line'], slot);
  }
});

test('without the marker and without pins no cut has a 文字組み slot (every fixture and corpus document)', () => {
  let n = 0;
  for (const { name, doc } of corpus.corpus(1, ['16:9', '9:16'], ALL)) {
    const p = run(doc);
    for (const c of p.cuts) for (const k of KUMI) assert.equal(c.slots[k], undefined, name + ' ' + c.key + ' ' + k);
    n++;
  }
  assert.ok(n >= 14);
});

test('a new work (look.gen = 1): every cut holds the automatic defaults, interned; no cut holds text.head', () => {
  let special = 0;
  for (const name of ['basic', 'vertical', 'lrc', 'repeat']) {
    const p = run(gen(corpus.project(name).doc));
    const first = p.cuts[0].slots;
    assert.deepEqual(first['text.kana'], { v: 0.7, from: 'auto' });
    assert.deepEqual(first['text.jump'], { v: 0.5, from: 'auto' });
    assert.deepEqual(first['text.latin'], { v: 0.5, from: 'auto' });
    for (const c of p.cuts) {
      for (const k of ['text.kana', 'text.jump', 'text.latin']) assert.equal(c.slots[k], first[k], name + ' ' + c.key + ' ' + k);
      assert.equal(c.slots['text.head'], undefined, name + ' ' + c.key);
    }
    special += p.cuts.filter((c) => !c.line).length;
  }
  assert.ok(special > 0, 'special cuts (title, interlude: no line) take the default too');
});

test('gate completeness: a new work with the three switches pinned off plans exactly like the document without the marker', () => {
  let n = 0;
  for (const { name, doc } of corpus.corpus(1, ['16:9', '1:1'], ALL)) {
    const base = run(doc);
    const off = run(withPins(gen(doc), OFF));
    assert.equal(off.hash, base.hash, name);
    assert.deepEqual(off.warnings, base.warnings, name);
    n++;
  }
  assert.ok(n >= 14);
});

test('line pins: 0 turns a setting off on that line only, 0.7 turns it on in an older work; text.head only where jump is on', () => {
  const doc = corpus.project('basic').doc;
  const p0 = run(doc);
  const lines = p0.lines.filter((l) => l.cuts.length);
  const [a, b] = [lines[0], lines[1]];
  // a new work with line a's kana turned off
  let p = run(withPins(gen(doc), { ['line/' + a.id + ':text.kana']: user(0) }));
  for (const c of p.cuts) {
    if (c.line === a.id) assert.equal(c.slots['text.kana'], undefined, c.key);
    else assert.deepEqual(c.slots['text.kana'], { v: 0.7, from: 'auto' }, c.key);
    assert.deepEqual(c.slots['text.jump'], { v: 0.5, from: 'auto' }, c.key);
  }
  // an older work with line b's jump turned on (a pin decision), and a work pin text.head = 'phrase'
  p = run(withPins(doc, { ['line/' + b.id + ':text.jump']: user(0.7), 'work:text.head': user('phrase') }));
  for (const c of p.cuts) {
    if (c.line === b.id) {
      assert.deepEqual(c.slots['text.jump'], { v: 0.7, from: 'pin:line', by: 'user' }, c.key);
      assert.deepEqual(c.slots['text.head'], { v: 'phrase', from: 'pin:work', by: 'user' }, c.key);
    } else {
      assert.equal(c.slots['text.jump'], undefined, c.key);
      assert.equal(c.slots['text.head'], undefined, c.key);
    }
    assert.equal(c.slots['text.kana'], undefined, c.key);
  }
  // a work pin wins over the default; a line pin wins over the work pin
  p = run(withPins(gen(doc), { 'work:text.latin': user(1), ['line/' + a.id + ':text.latin']: user(0.25) }));
  for (const c of p.cuts) {
    const want = c.line === a.id ? { v: 0.25, from: 'pin:line', by: 'user' } : { v: 1, from: 'pin:work', by: 'user' };
    assert.deepEqual(c.slots['text.latin'], want, c.key);
  }
  // a stray cut pin (a hand-edited file) never applies; a bad value warns and falls back to the default
  const cut = a.cuts[0];
  p = run(withPins(gen(doc), { ['cut/' + cut + ':text.kana']: { v: 0, by: 'user', sig: 'x' }, 'work:text.jump': user('loud') }));
  assert.deepEqual(p.cuts.find((c) => c.key === cut).slots['text.kana'], { v: 0.7, from: 'auto' });
  assert.deepEqual(p.cuts[0].slots['text.jump'], { v: 0.5, from: 'auto' });
  assert.ok(p.warnings.some((w) => w.code === 'pin-bad-value' && w.path === 'work:text.jump'));
});

test('the settings move no other decision: every other slot and the history equal the plan without them', () => {
  for (const { name, doc } of corpus.corpus(1, ['16:9'], ALL)) {
    const base = run(doc);
    const on = run(gen(doc));
    assert.deepEqual(withoutKumi(on), withoutKumi(base), name);
    assert.deepEqual(on.grounds.map((g) => [g.ground, g.atmos, g.cuts]), base.grounds.map((g) => [g.ground, g.atmos, g.cuts]), name);
    assert.deepEqual(on.seams.map((s) => [s.at, s.slot]), base.seams.map((s) => [s.at, s.slot]), name);
    assert.deepEqual(on.rigs, base.rigs, name);
    // the settings reach the fingerprint of every cut (the scene cache follows them)
    assert.ok(on.cuts.every((c, i) => c.fp !== base.cuts[i].fp), name);
  }
});

test('固定を外す on the whole video brings the automatic settings back; undo is one command per change', () => {
  const doc = gen(corpus.project('basic').doc);
  let d = doc;
  for (const [path, v] of Object.entries(OFF)) d = CMD.reduce(d, { t: 'pin.set', path, v: v.v, by: 'user' });
  assert.equal(run(d).cuts[0].slots['text.kana'], undefined);
  const back = CMD.reduce(d, { t: 'pin.clearUnder', scope: 'work' });
  assert.equal(run(back).hash, run(doc).hash);
  assert.deepEqual(run(back).cuts[0].slots['text.kana'], { v: 0.7, from: 'auto' });
});

test('a lock never freezes the settings: lockPayload of a new work writes no 文字組み pin, and lock.set takes it', () => {
  const doc = gen(corpus.project('basic').doc);
  const p = run(doc);
  for (const line of p.lines.filter((l) => l.cuts.length).slice(0, 4)) {
    const payload = F.lockPayload(doc, p, line.id, { registry: CAT });
    for (const k of Object.keys(payload.pins)) assert.ok(!/:text\.(kana|jump|latin|head)$/.test(k), k);
    assert.ok(Object.keys(payload.pins).length > 1);
    const locked = CMD.reduce(doc, payload);
    // the locked line keeps its typesetting (a line or work setting, never a lock pin)
    const lp = run(locked);
    for (const k of line.cuts) assert.deepEqual(lp.cuts.find((c) => c.key === k).slots['text.kana'], { v: 0.7, from: 'auto' });
  }
});

test('field states: the work switch shows the work pin or the default, never a cut; a line under a work pin is inherited', () => {
  const base = gen(corpus.project('basic').doc);
  let p = run(base);
  const line = p.lines.find((l) => l.cuts.length);
  const fs = (doc, plan, path, sel) => F.fieldState(doc, plan, sel || { level: 'work' }, path, { registry: CAT });
  // a new work: auto, the default, pinnable at work only
  let s = fs(base, p, 'work:text.kana');
  assert.equal(s.state, 'auto');
  assert.equal(s.value, 0.7);
  assert.deepEqual(s.canPinAt, ['work']);
  assert.deepEqual(s.schema, RU.SPECS['text.kana']);
  assert.equal(fs(base, p, 'work:text.head').value, 'line');
  // a line turned off does not flip the work switch, nor make it read 'mixed'
  const lineOff = withPins(base, { ['line/' + line.id + ':text.kana']: user(0) });
  p = run(lineOff);
  assert.equal(fs(lineOff, p, 'work:text.kana').value, 0.7);
  assert.equal(fs(lineOff, p, 'work:text.kana').state, 'auto');
  const ls = fs(lineOff, p, 'line/' + line.id + ':text.kana', { level: 'line', ids: [line.id] });
  assert.equal(ls.value, 0);
  assert.equal(ls.state, 'pinned');
  assert.deepEqual(ls.canPinAt, ['line', 'work']);
  // a work pin: the switch is pinned; a line follows it (inherited)
  const workPin = withPins(base, { 'work:text.kana': user(0.9) });
  p = run(workPin);
  s = fs(workPin, p, 'work:text.kana');
  assert.equal(s.state, 'pinned');
  assert.equal(s.value, 0.9);
  const inh = fs(workPin, p, 'line/' + line.id + ':text.kana', { level: 'line', ids: [line.id] });
  assert.equal(inh.state, 'inherited');
  assert.equal(inh.pinnedAt, 'work');
  assert.equal(inh.value, 0.9);
  // an older work: off by default; a work pin 0 in an older work reads 0 and pinned
  const old = corpus.project('basic').doc;
  p = run(old);
  assert.equal(fs(old, p, 'work:text.kana').value, 0);
  assert.equal(fs(old, p, 'work:text.kana').state, 'auto');
  const lineAuto = fs(old, p, 'line/' + line.id + ':text.jump', { level: 'line', ids: [line.id] });
  assert.equal(lineAuto.value, 0);
  assert.equal(lineAuto.state, 'auto');
  // a cut path never offers the cut scope, and a stray cut pin (a hand-edited file) shows as not applicable
  const cutPath = 'cut/' + line.cuts[0] + ':text.jump';
  assert.deepEqual(F.canPinAt(MV.use('core/paths').parse(cutPath)), ['line', 'work']);
  const stray = withPins(base, { [cutPath]: { v: 0, by: 'user', sig: 'x' }, ['line/' + line.id + ':text.jump']: user(1) });
  p = run(stray);
  const cs = fs(stray, p, cutPath, { level: 'cut', ids: [line.cuts[0]] });
  assert.equal(cs.state, 'inactive');
  assert.equal(cs.inactiveReason, 'not-applicable');
  assert.deepEqual(p.cuts.find((c) => c.key === line.cuts[0]).slots['text.jump'], { v: 1, from: 'pin:line', by: 'user' });
});

test('explain: the new-work default names its rule, an older work says off, pins give the pin reasons', () => {
  const base = gen(corpus.project('basic').doc);
  let p = run(base);
  const line = p.lines.find((l) => l.cuts.length);
  const ex = (doc, plan, path) => EX.explain(doc, plan, path, { registry: CAT });
  let e = ex(base, p, 'line/' + line.id + ':text.kana');
  assert.equal(e.value, 0.7);
  assert.deepEqual(e.why, [{ code: 'rule', params: { rule: 'kumi.gen' } }]);
  e = ex(base, p, 'work:text.jump');
  assert.equal(e.value, 0.5);
  assert.deepEqual(e.why, [{ code: 'rule', params: { rule: 'kumi.gen' } }]);
  assert.deepEqual(ex(base, p, 'work:text.head').why, []);
  const old = corpus.project('basic').doc;
  p = run(old);
  e = ex(old, p, 'line/' + line.id + ':text.latin');
  assert.equal(e.value, 0);
  assert.deepEqual(e.why, [{ code: 'rule', params: { rule: 'kumi.off' } }]);
  assert.deepEqual(ex(old, p, 'work:text.latin').why, [{ code: 'rule', params: { rule: 'kumi.off' } }]);
  // pinned: at the line (0 leaves no decision: the pin that turned it off), and at the work
  const pinned = withPins(base, { ['line/' + line.id + ':text.kana']: user(0), 'work:text.jump': { v: 1, by: 'ai' } });
  p = run(pinned);
  e = ex(pinned, p, 'line/' + line.id + ':text.kana');
  assert.equal(e.value, 0);
  assert.deepEqual(e.why, [{ code: 'pin', params: { scope: 'line', by: 'user' } }]);
  e = ex(pinned, p, 'work:text.jump');
  assert.equal(e.value, 1);
  assert.deepEqual(e.why, [{ code: 'pin', params: { scope: 'work', by: 'ai' } }]);
  e = ex(pinned, p, 'line/' + line.id + ':text.jump');
  assert.deepEqual(e.why, [{ code: 'pin', params: { scope: 'work', by: 'ai' } }]);
});

test('the cast cache tells a new work from an older one with the same text and seed', () => {
  for (const name of ['basic', 'vertical']) {
    const doc = corpus.project(name).doc;
    const a = PL.plan(clone(doc), { registry: CAT });
    const b = PL.plan(gen(clone(doc)), { registry: CAT });
    assert.equal(b.hash, run(gen(clone(doc))).hash, name + ': the second plan equals a fresh plan');
    assert.notEqual(a.hash, b.hash, name);
    assert.equal(PL.plan(clone(doc), { registry: CAT }).hash, a.hash, name + ': and back');
  }
});

test('re-planning a new work after edits of its settings gives exactly the plan made from scratch', () => {
  const R = MV.use('core/rng');
  const VALUES = { 'text.kana': [0, 0.35, 0.7, 1], 'text.jump': [0, 0.5, 1], 'text.latin': [0, 0.5], 'text.head': ['line', 'phrase', 'none'] };
  let steps = 0;
  for (const name of ['basic', 'vertical', 'repeat']) {
    const rng = R.stream('kumi-replan', name);
    let doc = gen(clone(corpus.project(name).doc));
    for (let i = 0; i < 16; i++) {
      const p = PL.plan(doc, { registry: CAT });
      assert.equal(p.hash, run(doc).hash, name + ' step ' + i);
      steps++;
      const slot = rng.pick(KUMI);
      const line = rng.pick(p.lines.filter((l) => l.cuts.length));
      const where = rng.pick(['work', 'line/' + line.id]);
      const r = rng.next();
      if (r < 0.6) doc = CMD.reduce(doc, { t: 'pin.set', path: where + ':' + slot, v: rng.pick(VALUES[slot]), by: 'user' });
      else if (r < 0.8) doc = CMD.reduce(doc, { t: 'pin.clear', path: where + ':' + slot });
      else doc = CMD.reduce(doc, { t: 'look.seed', seed: rng.int(0, 1e9) });
    }
  }
  assert.ok(steps >= 48);
});
