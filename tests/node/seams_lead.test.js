/* 文字PVメーカー v2 — original work. Tests: the long-lead hand-over of transitions and the neighbour clamp of windows at any 入りの早さ (PV22 T4, DESIGN_2_2 §5; DESIGN §3.12 b, §4.16.5, §4.16.6). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const PL = MV.use('planner/plan');
const MIX = MV.use('parts/mix');
const BASE = MV.use('parts/catalog').defaultRegistry();

const NAMES = ['basic', 'lrc', 'long', 'vertical', 'v21', 'repeat'];
const LEADS = [0.12, 0.2, 0.3, 0.5, 1.0];
const MODES = ['start', 'ready'];
const floor6 = (x) => Math.floor(x * 1e6) / 1e6;

// A fixture at a seed of this test, with its lead and 入りの基準 (enter) set.
function docOf(name, seed, lead, enter) {
  const doc = corpus.project(name).doc;
  doc.look = Object.assign({}, doc.look, { seed: corpus.seedOf('lead', name, seed), moodSeed: corpus.seedOf('leadMood', name, seed) });
  doc.timing = Object.assign({}, doc.timing, { lead }, enter === 'ready' ? { enter } : {});
  return doc;
}

function planOf(doc) {
  const reg = MIX.registryFor(BASE, doc.materials, doc.media) || BASE;
  return { plan: PL.run(doc, reg, { fresh: true }), reg };
}

// The violations of the hand-over and window rules in one plan, as readable strings.
function violations(plan, reg, where) {
  const out = [];
  const at = new Map(plan.cuts.map((c, i) => [c.key, i]));
  for (const s of plan.seams) {
    if (reg.get('seam', s.slot.v).ends === true) continue;       // a seam that places its own window (P4's glyph seams)
    const j = at.get(s.into), A = plan.cuts[j - 1], B = plan.cuts[j];
    if (A.t1 > B.t0 + 1e-9) continue;                          // a duet: A keeps its text until its pinned end (§3.12)
    // the old cut is gone when the transition has handed the picture over (1 µs of rounding: the window end is floored)
    if (A.b > floor6(s.at + s.dur / 2) + 2e-6) out.push(where + ' ' + B.key + ': A past the window by ' + (A.b - s.at - s.dur / 2));
    // the new cut is not drawn before its transition starts
    if (s.at - s.dur / 2 > B.a + 1e-6) out.push(where + ' ' + B.key + ': B before its window by ' + (s.at - s.dur / 2 - B.a));
  }
  plan.cuts.forEach((c, i) => {
    if (c.a > c.t0 + 1e-9) out.push(where + ' ' + c.key + ': a after t0');
    const two = i >= 2 ? plan.cuts[i - 2] : null;
    if (two && two.b <= c.t0 && c.a < two.b - 1e-9) out.push(where + ' ' + c.key + ': overlaps the cut two before by ' + (two.b - c.a));
  });
  return out;
}

test('hand-over and neighbour invariants over 6 fixtures × 3 seeds × 5 leads × 2 modes', () => {
  const bad = [];
  let seams = 0, moved = 0;
  for (const lead of LEADS) {
    for (const enter of MODES) {
      for (const name of NAMES) {
        for (let s = 0; s < 3; s++) {
          const { plan, reg } = planOf(docOf(name, s, lead, enter));
          bad.push(...violations(plan, reg, name + '#' + s + ' lead ' + lead + ' ' + enter));
          const at = new Map(plan.cuts.map((c, i) => [c.key, i]));
          for (const x of plan.seams) { seams++; if (x.at !== plan.cuts[at.get(x.into)].a) moved++; }
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], bad.length + ' violations');
  assert.ok(seams > 1000, 'the corpus has transitions (' + seams + ')');
  assert.ok(moved > 100, 'the long leads move transition windows (' + moved + ')');
});

// The basic project with one transition pinned into a cut, its duration pinned too (by the user, as the inspector does).
function pinnedSeam(lead, seam, key) {
  const doc = corpus.project('basic').doc;
  const sig = PL.pinSig(PL.run(doc, BASE, { fresh: true }), key);
  doc.timing = Object.assign({}, doc.timing, { lead });
  doc.pins = Object.assign({}, doc.pins, {
    ['cut/' + key + ':seam']: { v: seam, by: 'user', sig }, ['cut/' + key + ':seam.dur']: { v: 0.3, by: 'user', sig } });
  const { plan, reg } = planOf(doc);
  const j = plan.cuts.findIndex((c) => c.key === key);
  const B = plan.cuts[j];
  assert.ok(B.seamIn >= 0, key + ' has a transition');
  assert.deepEqual(violations(plan, reg, 'pinned'), []);
  return { s: plan.seams[B.seamIn], A: plan.cuts[j - 1], B };
}

test('tier 1: a short centred transition slides later so that it ends at the old line\'s sung end', () => {
  // lead 0.2, a 0.3 s dissolve into r5~0 (A = r4~7 ends at 4.25 where r5~0 is sung): the window [3.95, 4.25]
  const { s, A, B } = pinnedSeam(0.2, 'blendDissolve', 'r5~0');
  assert.equal(B.a, 4.05);
  assert.equal(s.dur, 0.3);
  assert.equal(s.at, 4.1, 'at = A.t1 − dur/2');
  assert.equal(A.b, A.t1);
  assert.ok(s.at - s.dur / 2 <= B.a, 'B.a stays inside the window');
  // at the lead of every older document nothing moves: the window is centred on B.a and A ends with it
  const old = pinnedSeam(0.12, 'blendDissolve', 'r5~0');
  assert.equal(old.s.at, old.B.a);
  assert.equal(old.A.b, 4.28);
});

test('tier 2: where sliding would start the window after B.a, the transition lengthens to [B.a, A.t1]', () => {
  const { s, A, B } = pinnedSeam(0.5, 'blendDissolve', 'r5~0');
  assert.equal(B.a, 3.75);
  assert.equal(s.dur, 0.5, 'dur = A.t1 − B.a');
  assert.equal(s.at, 4);
  assert.equal(A.b, A.t1);
});

test('tier 3: beyond the transition\'s own limit (a world seam, 0.8 s), the old line ends with the window', () => {
  // lead 1.0 into r7~7 (a new background): A.t1 − B.a = 1.0 s > WORLD_MAX
  const { s, A, B } = pinnedSeam(1.0, 'shoveAcross', 'r7~7');
  assert.equal(s.scope, 'world');
  assert.equal(s.dur, 0.3, 'the pinned length is kept');
  assert.equal(s.at, B.a, 'the window stays centred on B.a');
  assert.equal(A.b, floor6(s.at + s.dur / 2), 'A ends with the window');
  assert.ok(A.b < A.t1, 'before its sung end');
});

test('neighbour clamp: a cut starts no earlier than the end of the cut two before it, never after its sung start', () => {
  // at lead 1.0 the basic project's r5~0 would start at 3.25, inside the window of r4~0 (b 3.726563)
  const doc = corpus.project('basic').doc;
  doc.timing = Object.assign({}, doc.timing, { lead: 1.0 });
  const { plan } = planOf(doc);
  const i = plan.cuts.findIndex((c) => c.key === 'r5~0');
  assert.equal(plan.cuts[i].a, plan.cuts[i - 2].b);
  assert.equal(plan.cuts[i - 2].b, 3.726563);
  // a cut whose sung start comes before the end of the cut two before keeps a ≤ t0
  const SG = MV.use('planner/segment');
  const cuts = [{ t0: 0, t1: 5, role: 'lyric' }, { t0: 5, t1: 5.1, role: 'lyric' }, { t0: 5.1, t1: 8, role: 'lyric' }];
  SG.windows(cuts, { lead: 0.2, tail: 0.25 });
  assert.equal(cuts[0].b, 5.25);
  assert.equal(cuts[2].a, 5.1, 'capped at its sung start (the cut two before ends later)');
  const two = [{ t0: 0, t1: 5, role: 'lyric' }, { t0: 5, t1: 5.3, role: 'lyric' }, { t0: 5.3, t1: 8, role: 'lyric' }];
  SG.windows(two, { lead: 0.2, tail: 0.25 });
  assert.equal(two[2].a, 5.25, 'starts where the cut two before ends');
  SG.windows(two, { lead: 0.12, tail: 0.25 });
  assert.equal(two[2].a, 5.25);
  SG.windows(two, { lead: 0.04, tail: 0.25 });
  assert.equal(two[2].a, 5.26, 'not clamped when it starts later anyway');
});

test('a duet (the old line pinned to end after the new line\'s sung start) keeps its text until its own end', () => {
  const doc = corpus.project('basic').doc;
  const sig = PL.pinSig(PL.run(doc, BASE, { fresh: true }), 'r5~0');
  doc.timing = Object.assign({}, doc.timing, { lead: 0.5 });
  doc.pins = Object.assign({}, doc.pins, { 'line/r4:end': { v: 5, by: 'user' },
    'cut/r5~0:seam': { v: 'blendDissolve', by: 'user', sig }, 'cut/r5~0:seam.dur': { v: 0.3, by: 'user', sig } });
  const { plan } = planOf(doc);
  const j = plan.cuts.findIndex((c) => c.key === 'r5~0');
  const A = plan.cuts[j - 1], B = plan.cuts[j], s = plan.seams[B.seamIn];
  assert.equal(A.t1, 5);
  assert.ok(A.t1 > B.t0);
  assert.deepEqual([s.at, s.dur], [B.a, 0.3], 'the window stays centred on B.a');
  assert.ok(A.b >= A.t1, 'A is shown until its pinned end');
});
