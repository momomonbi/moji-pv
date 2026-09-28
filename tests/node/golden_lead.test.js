/* 文字PVメーカー v2 — original work. Tests: the timing fixes of PV22 T4 leave every golden document as it was — no neighbour clamp, no 出そろい, today's transition windows (DESIGN_2_2 §5, 0.4). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');
const FM = require('../helpers/fake_media.js');
const XD = require('../helpers/extreme_docs.js');

const MV = load();
const PL = MV.use('planner/plan');
const TM = MV.use('core/timing');
const N = MV.use('core/num');
const MIX = MV.use('parts/mix');
const SG = MV.use('planner/segment');
const BASE = MV.use('parts/catalog').defaultRegistry();

// planner/tracks: a seam takes at most 40 % of the shorter of its two cuts' windows; a world seam at most 0.8 s.
const SEAM_SHARE = 0.4, WORLD_MAX = 0.8;

// The 253 documents of tests/golden (update_golden.js): the corpus, the fixture projects with and without the automatic
// camerawork, 'repeat', the media golden, 'v21' and the EXTREME documents.
function goldenDocs() {
  const out = corpus.corpus().map(({ name, doc }) => ({ name, doc }));
  for (const { name, doc } of corpus.projects()) {
    out.push({ name, doc }, { name: name + ' (no camerawork)', doc: corpus.withoutCamerawork(doc) });
  }
  out.push({ name: 'repeat', doc: corpus.project('repeat').doc });
  out.push({ name: 'media', doc: FM.goldenDoc(corpus.project('media').doc) });
  out.push({ name: 'v21', doc: corpus.project('v21').doc });
  for (const { name, doc } of XD.goldenDocs()) out.push({ name, doc });
  return out;
}

// segment.windows as it was: a = t0 − lead, b = the next cut's start (or t1) + tail.
function plainWindows(cuts, timing) {
  return cuts.map((c, i) => {
    const next = cuts[i + 1];
    const nextSpecial = !next || SG.SPECIAL_ROLES.has(next.role);
    return { a: N.q6(c.t0 - timing.lead), b: N.q6((nextSpecial ? c.t1 : Math.max(c.t1, next.t0)) + timing.tail) };
  });
}

test('the 253 golden documents: plain windows, no 出そろい, centred transitions of today\'s length', () => {
  const docs = goldenDocs();
  assert.equal(docs.length, 253);
  const bad = [];
  let seams = 0;
  for (const { name, doc } of docs) {
    const reg = MIX.registryFor(BASE, doc.materials, doc.media) || BASE;
    const plan = PL.run(doc, reg, { fresh: true });
    const timing = Object.assign({}, TM.TIMING_DEFAULTS, doc.timing);
    assert.equal(timing.lead, 0.12, name);
    assert.equal(timing.enter, undefined, name);
    const win = plainWindows(plan.cuts, timing);
    plan.cuts.forEach((c, i) => {
      if (c.a !== win[i].a) bad.push(name + ' ' + c.key + ': a ' + c.a + ' ≠ ' + win[i].a);
      if (c.ready !== undefined) bad.push(name + ' ' + c.key + ': ready');
    });
    const at = new Map(plan.cuts.map((c, i) => [c.key, i]));
    for (const s of plan.seams) {
      const def = reg.get('seam', s.slot.v);
      if (def.ends === true) continue;
      seams++;
      const j = at.get(s.into), A = plan.cuts[j - 1], B = plan.cuts[j];
      const limit = SEAM_SHARE * Math.min(win[j - 1].b - win[j - 1].a, win[j].b - win[j].a);
      let dur = Math.min(typeof s.slot.p.dur === 'number' ? s.slot.p.dur : 0.5, limit);
      if (def.scope === 'world') dur = Math.min(dur, WORLD_MAX);
      dur = Math.floor(Math.max(0, dur) * 1e6) / 1e6;
      if (s.at !== B.a) bad.push(name + ' ' + B.key + ': seam at ' + s.at + ' ≠ ' + B.a);
      if (s.dur !== dur) bad.push(name + ' ' + B.key + ': seam dur ' + s.dur + ' ≠ ' + dur);
      if (def.glyphs !== true && A.b < A.t1) bad.push(name + ' ' + A.key + ': ends before its sung end');
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], bad.length + ' differences');
  assert.ok(seams > 1000, 'transitions checked: ' + seams);
});
