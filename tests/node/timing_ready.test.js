/* 文字PVメーカー v2 — original work. Tests: 入りの基準 出そろい — the planner's stage 6b, the capped entrance in the engine and the plan's encoding of `ready` (PV22 T4, DESIGN_2_2 §5). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const PL = MV.use('planner/plan');
const MO = MV.use('core/motion');
const N = MV.use('core/num');
const D = MV.use('core/doc');
const CMD = MV.use('core/commands');
const MIX = MV.use('parts/mix');
const BUILD = MV.use('engine/scene/build');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const BASE = MV.use('parts/catalog').defaultRegistry();
const MEASURER = fakeMeasurer();

const FOUR = ['basic', 'lrc', 'long', 'vertical'];
const SIX = FOUR.concat(['v21', 'repeat']);

function withTiming(doc, timing) { return Object.assign({}, doc, { timing: Object.assign({}, doc.timing, timing) }); }
function seeded(name, s) {
  const doc = corpus.project(name).doc;
  if (s === null) return doc;
  doc.look = Object.assign({}, doc.look, { seed: corpus.seedOf('ready', name, s), moodSeed: corpus.seedOf('readyMood', name, s) });
  return doc;
}
function regOf(doc) { return MIX.registryFor(BASE, doc.materials, doc.media) || BASE; }
function fresh(doc) { return PL.run(doc, regOf(doc), { fresh: true }); }

// The arrive unit count planner/plan uses (unitCount).
function countOf(reg, cut) {
  const d = cut.slots.arrive;
  const def = d ? reg.get('arrive', d.v) : null;
  const unit = def && def.unit ? def.unit : 'glyph';
  const u = cut.feat.units;
  return unit === 'word' ? u.word : unit === 'line' || unit === 'run' ? u.line : u.glyph;
}

test('absent 入りの基準 plans exactly as 動き始め (\'start\'): the same hash, no cut has ready', () => {
  for (const name of FOUR) {
    for (const s of [0, 1]) {
      const doc = seeded(name, s);
      const plain = fresh(doc), start = fresh(withTiming(doc, { enter: 'start' }));
      assert.equal(start.hash, plain.hash, name + '#' + s);
      assert.ok(plain.cuts.every((c) => c.ready === undefined));
    }
  }
});

test('出そろい: the invariants I1–I4 and the cuts it leaves alone (6 fixtures × 3 seeds × lead 0.2 and 0)', () => {
  let opened = 0, lines = 0;
  const bad = [];
  for (const lead of [0.2, 0]) {
    for (const name of SIX) {
      for (let s = 0; s < 3; s++) {
        const doc = withTiming(seeded(name, s), { lead });
        const reg = regOf(doc);
        const start = PL.run(doc, reg, { fresh: true });
        const plan = PL.run(withTiming(doc, { enter: 'ready' }), reg, { fresh: true });
        const where = name + '#' + s + ' lead ' + lead;
        assert.deepEqual(plan.cuts.map((c) => c.key), start.cuts.map((c) => c.key), where);
        plan.cuts.forEach((c, i) => {
          const was = start.cuts[i];
          if (c.line) lines++;
          if (i > 0 && c.a < plan.cuts[i - 1].a - 1e-9) bad.push(where + ' ' + c.key + ': I2 a decreases');
          if (c.ready === undefined) {
            if (c.a !== was.a) bad.push(where + ' ' + c.key + ': a moved without ready');
            return;
          }
          opened++;
          const prev = plan.cuts[i - 1];
          if (i >= 2 && c.a < plan.cuts[i - 2].b - 1e-9) bad.push(where + ' ' + c.key + ': I1 overlaps the cut two before');
          if (c.a < plan.grounds[c.ground].t0 - 1e-9) bad.push(where + ' ' + c.key + ': I3 before its ground segment');
          if (c.seamIn !== -1) bad.push(where + ' ' + c.key + ': I4 a transition into an opened cut');
          if (c.ready !== N.q6(c.t0 - lead)) bad.push(where + ' ' + c.key + ': ready ≠ t0 − lead');
          if (!(c.a <= c.ready - MO.MIN_DUR + 1e-9)) bad.push(where + ' ' + c.key + ': less than MIN_DUR to enter');
          if (!(c.a < was.a)) bad.push(where + ' ' + c.key + ': not opened');
          if (!c.line || c.impact) bad.push(where + ' ' + c.key + ': not a plain line cut');
          if (prev && prev.ground !== c.ground) bad.push(where + ' ' + c.key + ': a new background');
          const d = c.slots.arrive;
          if (!d || d.v === reg.fallback('arrive')) bad.push(where + ' ' + c.key + ': no entrance motion');
          if (d && d.p && d.p.order === 'sung') bad.push(where + ' ' + c.key + ': sung order');
          if (c.feat.kime) bad.push(where + ' ' + c.key + ': a キメ cut');
          if (c.a > c.t0) bad.push(where + ' ' + c.key + ': a after t0');
        });
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], bad.length + ' violations');
  assert.ok(opened > 0.35 * lines, 'opened ' + opened + ' of ' + lines + ' line cuts');
});

// The share of line cuts fully in (the engine's times.rest) by t0 − lead, and I5 on every opened cut.
function fullyIn(doc) {
  const plan = fresh(doc), reg = regOf(doc);
  const svc = { registry: reg, text: createTextService({ measurer: MEASURER, faces: plan.look.faces }) };
  let lines = 0, fully = 0, opened = 0;
  const late = [];
  for (const c of plan.cuts) {
    if (!c.line) continue;
    lines++;
    const times = BUILD.buildCut(c, plan, svc).times;
    if (c.t0 + times.rest <= c.t0 - doc.timing.lead + 1e-6) fully++;
    if (c.ready === undefined) { assert.equal(times.ready, null); continue; }
    opened++;
    assert.ok(Math.abs(times.ready - (c.ready - c.t0)) < 1e-9);
    if (times.rest > times.ready + 1e-9) late.push(c.key + ' rest ' + times.rest + ' > ready ' + times.ready);
  }
  return { share: fully / lines, opened, late };
}

test('出そろい: every opened cut is fully in by ready (I5); the fully-in share rises by ≥ 0.2 on each fixture', () => {
  for (const name of FOUR) {
    const doc = withTiming(corpus.project(name).doc, { lead: 0.2 });
    const start = fullyIn(doc), ready = fullyIn(withTiming(doc, { enter: 'ready' }));
    assert.deepEqual(ready.late, [], name + ': I5');
    assert.equal(start.opened, 0);
    assert.ok(ready.opened > 0, name);
    assert.ok(ready.share - start.share >= 0.2, name + ': fully in by t0 − lead ' + start.share.toFixed(2) + ' → ' + ready.share.toFixed(2));
  }
});

test('出そろい: repT is the hero time of the capped entrance', () => {
  const doc = withTiming(corpus.project('basic').doc, { lead: 0.2, enter: 'ready' });
  const reg = regOf(doc);
  const plan = PL.run(doc, reg, { fresh: true });
  const inst = (d, kind) => (!d || d.v === reg.fallback(kind) ? { dur: 0, each: 0 } : { dur: d.p ? d.p.dur : 0, each: d.p ? d.p.each : 0 });
  const opened = plan.cuts.filter((c) => c.ready !== undefined).slice(0, 3);
  assert.equal(opened.length, 3);
  let capped = 0;
  for (const c of opened) {
    const count = countOf(reg, c), win = c.b - c.a;
    const A = MO.fitMotion(Object.assign({ count, window: win, share: MO.SHARE.arrive, cap: c.ready - c.a }, inst(c.slots.arrive, 'arrive'))).total;
    const L = MO.fitMotion(Object.assign({ count, window: win, share: MO.SHARE.depart }, inst(c.slots.depart, 'depart'))).total;
    assert.ok(A <= c.ready - c.a + 1e-9, c.key + ': the entrance ends by ready');
    const free = MO.fitMotion(Object.assign({ count, window: win, share: MO.SHARE.arrive }, inst(c.slots.arrive, 'arrive'))).total;
    if (free > A + 1e-9) capped++;
    const t = c.a + A + 0.1 * Math.max(0, (c.b - L) - (c.a + A));
    assert.equal(c.repT, N.q6(Math.min(t, c.b)), c.key);
  }
  assert.ok(capped >= 1, 'the cap binds on at least one of them');
});

test('出そろい: deterministic; cached re-plans equal fresh ones through start → ready → lead 0.3 → lead 0 → start', () => {
  const doc0 = corpus.project('long').doc;
  const a = fresh(withTiming(doc0, { enter: 'ready' })), b = fresh(withTiming(doc0, { enter: 'ready' }));
  assert.equal(a.hash, b.hash);
  assert.deepEqual(JSON.parse(JSON.stringify(a.cuts)), JSON.parse(JSON.stringify(b.cuts)));
  let doc = D.normalize(corpus.project('lrc').doc);
  const steps = [{ key: 'enter', v: 'start' }, { key: 'enter', v: 'ready' }, { key: 'lead', v: 0.3 }, { key: 'lead', v: 0 },
    { key: 'enter', v: 'start' }];
  for (const st of steps) {
    doc = CMD.reduce(doc, { t: 'timing.set', key: st.key, v: st.v });
    const cached = PL.plan(doc, { registry: BASE });
    assert.equal(cached.hash, PL.run(doc, BASE, { fresh: true }).hash, 'after ' + st.key + ' ' + st.v);
  }
});

// Three LRC lines 0.8 s apart and a fourth later: the third cut opens to the end of the first (its floor) at lead 0.2
// and at 0.3 alike, so its window relative to t0 stays; only `ready` moves, and the scene must be rebuilt.
function floorDoc(lead) {
  const doc = D.defaultDoc();
  doc.sheet = { next: 5, rows: [{ id: 'r1', src: '[00:10.00]あいうえお' }, { id: 'r2', src: '[00:10.80]かきくけこ' },
    { id: 'r3', src: '[00:11.60]さしすせそ' }, { id: 'r4', src: '[00:14.00]たちつてと' }] };
  doc.timing = Object.assign({}, doc.timing, { lead, enter: 'ready' });
  doc.pins = { 'line/r3:arrive': { v: 'fogIn', by: 'user' }, 'line/r3:arrive.dur': { v: 0.6, by: 'user' },
    'line/r2:seam': { v: 'hardCut', by: 'user' }, 'line/r3:seam': { v: 'hardCut', by: 'user' } };
  return doc;
}

test('出そろい: the fingerprint follows ready where the window stays at its floor', () => {
  const [p2, p3] = [0.2, 0.3].map((lead) => fresh(floorDoc(lead)));
  const c2 = p2.cuts.find((c) => c.key === 'r3~0'), c3 = p3.cuts.find((c) => c.key === 'r3~0');
  const first = p2.cuts.find((c) => c.key === 'r1~0');
  assert.equal(c2.a, first.b, 'opened to the end of the cut two before');
  assert.deepEqual([c2.a, c2.b, c2.t0], [c3.a, c3.b, c3.t0], 'the same window at both leads');
  assert.deepEqual([c2.ready, c3.ready], [11.4, 11.3]);
  assert.notEqual(c2.fp, c3.fp, 'the scene differs (its entrance ends at ready)');
  // the plan prints ready between pinKey and repT
  const text = PL.canon(c2);
  assert.ok(text.indexOf('"ready":11.4,"repT":') > 0, text.slice(0, 200));
});

test('出そろい: a line whose entrance is revealed as sung keeps 動き始め', () => {
  const doc = withTiming(corpus.project('basic').doc, { lead: 0.2, enter: 'ready' });
  const plan = fresh(doc);
  const cut = plan.cuts.find((c) => c.ready !== undefined);
  assert.ok(cut);
  const sung = Object.assign({}, doc, { pins: Object.assign({}, doc.pins, { ['line/' + cut.line + ':arrive.order']: { v: 'sung', by: 'user' } }) });
  const p = fresh(sung);
  const again = p.cuts.find((c) => c.key === cut.key);
  assert.equal(again.slots.arrive.p.order, 'sung');
  assert.equal(again.ready, undefined);
  assert.equal(again.a, N.q6(again.t0 - 0.2));
});

test('入りの基準 in the document: validated, one timing.set per change, kept on save', () => {
  let doc = D.defaultDoc();
  assert.deepEqual(D.ENTER_MODES, ['start', 'ready']);
  doc = CMD.reduce(doc, { t: 'timing.set', key: 'enter', v: 'ready' });
  assert.equal(doc.timing.enter, 'ready');
  assert.deepEqual(D.validate(doc), []);
  assert.ok(D.serialize({ doc }).includes('"tapLatency": 0.06,\n   "enter": "ready"\n'));
  assert.throws(() => CMD.reduce(doc, { t: 'timing.set', key: 'enter', v: 'x' }), (e) => e instanceof CMD.CommandError);
  const bad = Object.assign({}, doc, { timing: Object.assign({}, doc.timing, { enter: 'soon', readCheck: 1 }) });
  const problems = D.validate(bad);
  assert.ok(problems.some((p) => p.startsWith('timing.enter')));
  assert.ok(problems.some((p) => p.startsWith('timing.readCheck')));
  assert.ok(!D.serialize({ doc: D.defaultDoc() }).includes('"enter"'));
});
