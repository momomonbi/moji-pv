/* 文字PVメーカー v2 — original work. Tests: planner/readable — the legible time of each line cut and the 読み切れない速さ rule (PV22 S4, DESIGN_2_2 §5). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const PL = MV.use('planner/plan');
const RD = MV.use('planner/readable');
const MO = MV.use('core/motion');
const D = MV.use('core/doc');
const CMD = MV.use('core/commands');
const MIX = MV.use('parts/mix');
const BUILD = MV.use('engine/scene/build');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const BASE = MV.use('parts/catalog').defaultRegistry();
const MEASURER = fakeMeasurer();

const NAMES = ['basic', 'vertical', 'lrc', 'long', 'v21', 'media', 'repeat'];

function regOf(doc) { return MIX.registryFor(BASE, doc.materials, doc.media) || BASE; }
function fresh(doc, reg) { return PL.run(doc, reg || regOf(doc), { fresh: true }); }
function docOf(text) { return CMD.reduce(D.defaultDoc(), { t: 'lyrics.set', text }); }
function withPins(doc, pins) { return Object.assign({}, doc, { pins: Object.assign({}, doc.pins, pins) }); }
function withTiming(doc, timing) { return Object.assign({}, doc, { timing: Object.assign({}, doc.timing, timing) }); }
function variant(name, s, aspect) {
  const doc = corpus.project(name).doc;
  doc.look = Object.assign({}, doc.look, { seed: corpus.seedOf('readable', name, s), moodSeed: corpus.seedOf('readableMood', name, s), aspect });
  return doc;
}

// Three tapped lines: a 0.2 s line of `text` between two others, with a transition pinned into the one after it.
function tappedShort(text) {
  let doc = docOf(['はじまりのぎょう', text, 'つぎのぎょうです'].join('\n'));
  const ids = doc.sheet.rows.map((r) => r.id);
  doc = withPins(doc, {
    ['line/' + ids[0] + ':start']: { v: 8, by: 'tap' }, ['line/' + ids[1] + ':start']: { v: 10, by: 'tap' },
    ['line/' + ids[2] + ':start']: { v: 10.2, by: 'tap' }, ['line/' + ids[2] + ':seam']: { v: 'blendDissolve', by: 'user' },
  });
  return { doc, ids };
}

test('the fixtures at their own settings: no line cut is too fast (7 fixtures × 3 seeds × 3 aspects)', () => {
  const flagged = [];
  let cuts = 0, top = 0;
  for (const name of NAMES) {
    for (let s = 0; s < 3; s++) {
      for (const aspect of ['16:9', '9:16', '1:1']) {
        const doc = variant(name, s, aspect);
        const reg = regOf(doc);
        const plan = fresh(doc, reg);
        for (const x of RD.check(plan, reg)) flagged.push(name + '#' + s + ' ' + aspect + ' ' + x.cut + ' ' + x.rate.toFixed(1) + '/s ' + x.legible.toFixed(3) + ' s');
        plan.cuts.forEach((c, i) => {
          if (!c.line || !c.text) return;
          cuts++;
          const u = RD.units(c);
          if (u >= RD.READ.MIN_UNITS) top = Math.max(top, u / RD.legibleOf(plan, i, reg).W);
        });
      }
    }
  }
  assert.ok(cuts > 3000, 'line cuts: ' + cuts);
  assert.deepEqual(flagged, []);
  // the automatic timing reads at most about 10 units per legible second; the Japanese limit (12) leaves a margin
  assert.ok(top > 8 && top < RD.READ.MAX.ja, 'fastest automatic cut ' + top.toFixed(2));
});

test('the app\'s samples (ja, en), timed automatically in a new work and an older one: nothing is flagged', () => {
  const L = MV.use('core/lyrics');
  for (const text of [L.SAMPLE_JA, L.SAMPLE_EN]) {
    for (const base of [D.newDoc(), D.defaultDoc()]) {
      for (const seed of [1, 2, 3]) {
        let doc = CMD.reduce(base, { t: 'lyrics.set', text });
        doc = Object.assign({}, doc, { look: Object.assign({}, doc.look, { seed }) });
        assert.deepEqual(RD.check(fresh(doc, BASE), BASE).map((x) => x.cut + ' ' + x.rate.toFixed(1)), [], text.slice(0, 8) + ' #' + seed);
      }
    }
  }
});

test('two automatic lines squeezed between LRC stamps 1.5 s apart are both too fast', () => {
  const doc = docOf('[00:10.00]あいう\nさしすせそたちつてとな\nはひふへほまみむめもや\n[00:11.50]らりるれろ');
  const plan = fresh(doc, BASE);
  const list = RD.check(plan, BASE);
  const ids = doc.sheet.rows.map((r) => r.id);
  assert.deepEqual(list.map((x) => x.line), [ids[1], ids[2]]);
  for (const x of list) {
    assert.ok(x.rate > 20, x.cut + ' rate ' + x.rate);
    assert.equal(x.units, 11);
    assert.equal(x.limit, 12);
    assert.ok(Object.isFrozen(x));
  }
  assert.ok(Object.isFrozen(list));
});

test('the legible-time floor: a tapped 0.2 s cut before a transition — 2 morae flagged, 1 mora not', () => {
  const two = tappedShort('あい');
  const plan = fresh(two.doc, BASE);
  const i = plan.cuts.findIndex((c) => c.line === two.ids[1]);
  const seam = plan.seams.find((s) => s.a === plan.cuts[i].key);
  assert.ok(seam, 'a transition leaves the cut');
  const W = RD.legibleOf(plan, i, BASE).W;
  assert.ok(W < RD.READ.MIN_LEGIBLE, 'legible ' + W);
  const hit = RD.check(plan, BASE).find((x) => x.line === two.ids[1]);
  assert.ok(hit, 'flagged');
  assert.ok(hit.rate < hit.limit, 'by the floor, not by the rate');
  const one = tappedShort('あ');
  assert.equal(RD.check(fresh(one.doc, BASE), BASE).filter((x) => x.line === one.ids[1]).length, 0);
});

test('an outgoing transition ends the reading at its centre; a glyph transition (P4) where it starts', () => {
  const { doc, ids } = tappedShort('あいうえおかきく');
  const plan = fresh(doc, BASE);
  const i = plan.cuts.findIndex((c) => c.line === ids[1]);
  const c = plan.cuts[i], seam = plan.seams.find((s) => s.a === c.key);
  const plain = RD.legibleOf(plan, i, BASE);
  assert.ok(Math.abs(plain.W - Math.min(plain.V - plain.A / 2 - plain.L / 2, seam.at - c.a - plain.A / 2)) < 1e-9);
  // a registry whose seams move the glyphs themselves (P4's glyphs: true)
  const glyphReg = {
    get: (kind, key) => (kind === 'seam' ? Object.assign({}, BASE.get(kind, key), { glyphs: true }) : BASE.get(kind, key)),
    fallback: (kind) => BASE.fallback(kind),
  };
  const glyph = RD.legibleOf(plan, i, glyphReg);
  assert.ok(Math.abs(glyph.W - Math.min(plain.V - plain.A / 2 - plain.L / 2, seam.at - seam.dur / 2 - c.a - plain.A / 2)) < 1e-9);
  assert.ok(glyph.W < plain.W - 0.05);
});

test('an entrance revealed as sung counts as reading time; a 歌ハメ cut needs SUNG_AFTER after its last character', () => {
  const base = docOf('あいうえおかきくけこ\nさしすせそ');
  const id = base.sheet.rows[0].id;
  const doc = withPins(base, { ['line/' + id + ':arrive.order']: { v: 'sung', by: 'user' } });
  const plan = fresh(doc, BASE);
  const i = plan.cuts.findIndex((c) => c.line === id);
  assert.equal(plan.cuts[i].slots.arrive.p.order, 'sung');
  const r = RD.legibleOf(plan, i, BASE);
  assert.equal(r.A, 0, 'no entrance time is taken off');
  const plain = fresh(base, BASE);
  const j = plain.cuts.findIndex((c) => c.line === id);
  assert.ok(RD.legibleOf(plain, j, BASE).A > 0);
  // P6's cut.sung (character times from t0 and the end of the last one): flagged when the cut leaves less than
  // SUNG_AFTER after it (a hand-made field on a copy of the plan)
  const c = plan.cuts[i];
  const L = RD.legibleOf(plan, i, BASE).L;
  const at = (after) => {
    const end = c.b - c.t0 - L / 2 - after;
    const cuts = plan.cuts.slice();
    cuts[i] = Object.assign({}, c, { sung: { t: [0, end / 2], end } });
    return RD.check(Object.assign({}, plan, { cuts }), BASE).filter((x) => x.cut === c.key);
  };
  const late = at(0.2);
  assert.equal(late.length, 1);
  assert.ok(Math.abs(late[0].legible - 0.2) < 1e-9);
  assert.equal(at(0.6).length, 0);
});

test('English uses its own limit (11); a 出そろい cut uses the capped entrance', () => {
  assert.equal(RD.limitOf('en'), 11);
  assert.equal(RD.limitOf('ja'), 12);
  assert.equal(RD.limitOf('zhHans'), 10);
  const doc = docOf('[00:10.00]one\nwe are running through the city lights tonight\nall the colours of the night sky\n[00:11.50]end');
  const plan = fresh(doc, BASE);
  const list = RD.check(plan, BASE);
  assert.ok(list.length >= 1);
  for (const x of list) assert.equal(x.limit, 11);
  // 出そろい at lead 0.2: A is fitted within ready − a, as the scene fits it
  const ready = fresh(withTiming(corpus.project('basic').doc, { lead: 0.2, enter: 'ready' }), BASE);
  const opened = ready.cuts.map((c, i) => [c, i]).filter(([c]) => c.ready !== undefined);
  assert.ok(opened.length > 3);
  let capped = 0;
  for (const [c, i] of opened) {
    const r = RD.legibleOf(ready, i, BASE);
    assert.ok(r.A <= c.ready - c.a + 1e-9, c.key);
    const d = c.slots.arrive;
    const def = BASE.get('arrive', d.v);
    const u = c.feat.units, unit = def && def.unit ? def.unit : 'glyph';
    const count = unit === 'word' ? u.word : unit === 'line' || unit === 'run' ? u.line : u.glyph;
    const free = MO.fitMotion({ dur: d.p.dur, each: d.p.each, count, window: c.b - c.a, share: MO.SHARE.arrive }).total;
    if (free > r.A + 1e-9) capped++;
  }
  assert.ok(capped >= 1, 'the cap binds on at least one opened cut');
});

test('the plan-level estimate agrees with the scene: legible time within ±20 % for ≥ 98 % of line cuts', () => {
  let n = 0, close = 0;
  const off = [];
  for (const name of ['basic', 'vertical', 'lrc', 'long']) {
    const doc = corpus.project(name).doc;
    const reg = regOf(doc);
    const plan = fresh(doc, reg);
    const svc = { registry: reg, text: createTextService({ measurer: MEASURER, faces: plan.look.faces }) };
    plan.cuts.forEach((c, i) => {
      if (!c.line || !c.text) return;
      const est = RD.legibleOf(plan, i, reg);
      const times = BUILD.buildCut(c, plan, svc).times;
      const A = times.rest - times.a, L = times.b - times.out;
      let W = est.V - A / 2 - L / 2;
      if (est.W < est.V - est.A / 2 - est.L / 2 - 1e-9) W = Math.min(W, est.W + est.A / 2 - A / 2);   // the same seam end
      n++;
      if (Math.abs(est.W - W) <= 0.2 * Math.abs(W)) close++; else off.push(name + ' ' + c.key + ' ' + est.W.toFixed(3) + ' vs ' + W.toFixed(3));
    });
  }
  assert.ok(n > 250, 'cuts ' + n);
  assert.ok(close / n >= 0.98, close + '/' + n + ' ' + off.slice(0, 5).join('; '));
});

test('check is memoized per plan object and deterministic', () => {
  const doc = corpus.project('lrc').doc;
  const a = fresh(doc, BASE), b = fresh(doc, BASE);
  assert.equal(RD.check(a, BASE), RD.check(a, BASE));
  assert.deepEqual(RD.check(a, BASE), RD.check(b, BASE));
  assert.deepEqual(RD.check(null, BASE), []);
});
