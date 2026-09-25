/* 文字PVメーカー v2 — original work. Tests for the glyph budget of material phases: masked behaviours, the cover model and the fit (DESIGN_2_1 §5.9.5). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');

const MV = load();
const FAC = MV.use('engine/facade');
const REC = MV.use('engine/render/record');
const REG = MV.use('core/registry');
const MIX = MV.use('parts/mix');
const SCH = MV.use('core/schema');
const RNG = MV.use('core/rng');
const T = MV.use('engine/scene/table');
const BH = MV.use('engine/scene/behave');
const BG = MV.use('engine/scene/budget');
const DR = MV.use('engine/render/draw');
const SP = MV.use('engine/render/sprites');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');

const BASE = MV.use('parts/catalog').defaultRegistry();
const LONG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'project_long.json'), 'utf8')).doc;

// The heaviest glyph work §5.8 admits in each text kind (perf.py's camerawork + materials row uses the same).
const tr = (col, from, to) => ({ col, from, to });
const HEAVY = Object.freeze({
  arrive: { knobs: [{ what: 'amp' }], parts: [{ key: 'ghostConverge' }], motion: { unit: 'glyph', curve: 'expoOut', tracks: [
    tr('y', 0.6, 0), tr('alpha', 0, 1), tr('blur', 0.6, 0), tr('glow', 1, 0), tr('tint', 1, 0), tr('sx', 2, 1), tr('sy', 2, 1), tr('rot', -30, 0)] } },
  dwell: { knobs: [{ what: 'amp' }], parts: [{ key: 'shimmerSweep' }], osc: [{ col: 'glow', amp: 1, hz: 0, wave: 'beat' },
    { col: 'tint', amp: 1, hz: 0.5, wave: 'sine' }, { col: 'rot', amp: 30, hz: 0.3, wave: 'sine' }, { col: 'sx', amp: 0.3, hz: 0.5, wave: 'sine' }] },
  depart: { knobs: [{ what: 'amp' }], parts: [{ key: 'burnOut' }], motion: { unit: 'glyph', curve: 'quadIn', tracks: [
    tr('x', 0, 0.6), tr('alpha', 1, 0), tr('blur', 0, 0.6), tr('glow', 0, 1), tr('tint', 0, 1), tr('sx', 1, 2), tr('sy', 1, 2), tr('rot', 0, 30)] } },
});

function heavyRegistry() {
  const defs = Object.keys(HEAVY).map((kind) => {
    const got = MIX.derive({ id: 'mh' + kind, kind, by: 'user', name: { ja: kind, en: kind }, tags: ['soft'], season: null, pool: true,
      rv: 1, recipe: HEAVY[kind] }, BASE);
    assert.ok(got.def, JSON.stringify(got.problems));
    return got.def;
  });
  return { reg: REG.extend(BASE, defs), defs };
}

// project_long's plan with the given text materials in every cut (auto params, as the lab's withMaterials sets them).
function engineWith(reg, defs) {
  const rec = REC.createRecorder();
  const engine = FAC.createEngine({ registry: reg, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null, strict: true });
  engine.setDoc(LONG);
  if (!defs.length) return { engine, rec, plan: engine.plan };
  const src = engine.plan;
  const plan = JSON.parse(JSON.stringify(src));
  Object.defineProperty(plan, 'env', { enumerable: false, value: src.env });
  plan.cuts.forEach((c, i) => {
    for (const d of defs) {
      const p = {};
      for (const { name, spec } of reg.params(d.kind, d.key)) {
        p[name] = SCH.autoValue(spec, { f: c.feat, look: { amounts: plan.look.amounts, mood: null, bpm: 120 },
          rng: RNG.stream(i, 'param', d.kind, d.key, name) });
      }
      c.slots[d.kind] = { v: d.key, p, from: 'auto' };
    }
    c.fp += '|heavy';
  });
  engine.setPlan(plan);
  return { engine, rec, plan };
}

// The cuts of project_long's perf window (perf.py: 10 s from 20 s), by index.
function windowCuts(plan) {
  const out = [];
  plan.cuts.forEach((c, i) => { if (c.b >= 20 && c.a <= 30) out.push(i); });
  return out;
}

const orig = (b) => (b.run === BH.runMasked ? b.of : b);

// The cover of a scene's glyphs at the samples of a phase, evaluated directly with the phase's behaviours masked at
// LADDER step k (the scene's own behaviours are put back afterwards).
function coversAt(scene, D, ph, k) {
  const list = ph.list;
  const placed = list.map((b) => scene.behaviours.findIndex((x) => orig(x) === b));
  const keep = placed.map((at) => scene.behaviours[at]);
  placed.forEach((at, j) => { scene.behaviours[at] = BH.masked(list[j], BG.LADDER[k], scene.text.from, scene.text.to); });
  const [t0, t1] = ph.phase === 'arrive' ? [scene.times.a, scene.times.rest] : ph.phase === 'dwell'
    ? [scene.times.rest, scene.times.out] : [scene.times.out, scene.times.b];
  const times = BG.samplesOf(t0, t1, ph.phase === 'dwell' ? BG.HOLD_SAMPLES : BG.MAX_SAMPLES);
  const out = times.map((t) => BG.coverAt(scene, t, D));
  placed.forEach((at, j) => { scene.behaviours[at] = keep[j]; });
  return out;
}

const peakOver = (a, b) => a.reduce((m, v, s) => Math.max(m, v - (b ? b[s] : 0)), 0);

// --- masked behaviours ------------------------------------------------------------------------------------------------

test('masked: runs the behaviour and puts back what it wrote to the masked columns of the masked nodes only', () => {
  const P = {};
  for (const c of T.POSE) P[c] = new Float32Array(6).fill(T.POSE.indexOf(c) === -1 ? 0 : 0);
  for (let i = 0; i < 6; i++) { P.sx[i] = 1; P.sy[i] = 1; P.alpha[i] = 1; P.tint[i] = 0.1 * i; P.blur[i] = i; }
  const run = (Q, t, b) => {
    for (let i = b.from; i < b.to; i++) {
      Q.tint[i] += 0.5; Q.glow[i] += 0.25; Q.echo[i] += 0.5; Q.blur[i] += 3; Q.shard[i] += 1; Q.pixel[i] += 2;
      Q.sx[i] *= 2; Q.sy[i] *= 3; Q.z[i] += -100; Q.x[i] += 7; Q.alpha[i] *= 0.5;
    }
  };
  const beh = { phase: BH.PH.MOTION, live: 'always', from: 1, to: 5, t0: 0, t1: 1, run };
  assert.equal(BH.masked(beh, [], 0, 6), beh, 'nothing masked: the behaviour itself');
  assert.equal(BH.masked(beh, ['tint'], 5, 6), beh, 'no masked node in its range');
  const m = BH.masked(beh, ['tint', 'blur', 'grow'], 2, 6);
  BH.check(m);
  assert.deepEqual([m.phase, m.live, m.from, m.to, m.t0, m.t1], [beh.phase, beh.live, beh.from, beh.to, beh.t0, beh.t1]);
  const before = {};
  for (const c of T.POSE) before[c] = Float32Array.from(P[c]);
  m.run(P, 0.5, m);
  for (let i = 0; i < 6; i++) {
    const inRange = i >= 1 && i < 5, masked = i >= 2 && i < 5;
    const want = (c, v) => assert.ok(Math.abs(P[c][i] - v) < 1e-6, c + '[' + i + '] = ' + P[c][i] + ', want ' + v);
    // masked groups on masked nodes: back to what they were
    for (const c of ['tint', 'blur', 'shard', 'pixel', 'sx', 'sy', 'z']) {
      const ran = { tint: before.tint[i] + 0.5, blur: before.blur[i] + 3, shard: 1, pixel: 2, sx: 2, sy: 3, z: -100 }[c];
      want(c, masked || !inRange ? before[c][i] : ran);
    }
    // columns outside the masked groups keep what the behaviour wrote
    want('glow', inRange ? 0.25 : 0);
    want('echo', inRange ? 0.5 : 0);
    want('x', inRange ? 7 : 0);
    want('alpha', inRange ? 0.5 : 1);
  }
  // what an earlier behaviour wrote to a masked column stays; running again gives the same (the saved values are scratch)
  const again = {};
  for (const c of T.POSE) again[c] = Float32Array.from(before[c]);
  m.run(again, 0.5, m);
  for (const c of T.POSE) assert.deepEqual(Array.from(again[c]), Array.from(P[c]), c);
  assert.deepEqual(Object.keys(BH.MASK_GROUPS), ['tint', 'echo', 'glow', 'blur', 'grow']);
});

// --- the cover model --------------------------------------------------------------------------------------------------

test('glyphCover follows drawGlyph: the path, the sprites it draws (counted by a recording frame) and nothing when hidden', () => {
  const { engine, rec, plan } = engineWith(BASE, []);
  const i = windowCuts(plan)[0];
  engine.renderFrame(REC.surfaceOf(rec.factory, 640, 360), plan.cuts[i].a + 0.5, { quality: 'export', scale: 640 / plan.design.w });
  const scene = engine.scene('cut', i);
  const table = scene.table, P = table.live, store = scene.stores.glyph;
  const node = [...Array(table.n).keys()].find((j) => table.type[j] === T.TYPE.glyph && store[table.payload[j]].cls !== 'space');
  const g = store[table.payload[node]];
  const M = new Float32Array([1, 0, 0, 1, 900, 500]);
  const set = (o) => { for (const c of ['blur', 'glow', 'shard', 'pixel', 'echo', 'tint']) P[c][node] = o[c] || 0; P.reveal[node] = 1; };
  const cases = [
    [{}, 0, 1], [{ tint: 0.5 }, 0, 2], [{ echo: 0.5 }, 0, 3],                         // direct: ink, tint copy, echo copies
    [{ blur: 3 }, 2, 0], [{ blur: 2 }, 1, 0], [{ blur: 64 }, 1, 0],                  // a pair between levels; at a level; beyond
    [{ glow: 0.5 }, 2, 0], [{ glow: 0.5, tint: 0.5 }, 3, 0],                         // halo + level-0 body (+ tint)
    [{ blur: 3, tint: 1, echo: 1, glow: 1 }, 1 + 4 + 2 + 2, 0],                      // halo, two echo pairs, body pair, tint pair
    [{ shard: 0.5 }, 1, 0], [{ pixel: 6, blur: 3 }, 1, 0], [{ shard: 0.5, tint: 1 }, 2, 0],
  ];
  for (const [pose, sprites, inks] of cases) {
    set(pose);
    const count = { sprites: 0, inks: 0 };
    const area = DR.glyphCover(g, P, node, 1, M, plan.design.w, plan.design.h, count);
    assert.deepEqual([count.sprites, count.inks], [sprites, inks], JSON.stringify(pose));
    assert.ok(area > 0, JSON.stringify(pose));
    // the same pose drawn: drawGlyph asks the sprite cache for exactly that many rasters
    const asked = [];
    const dc = DR.createDrawContext({ sprites: { glyph: (...a) => { asked.push(a[6]); return { canvas: {}, w: 10, h: 10, cx: 5, cy: 5, F: 10, ink: null }; },
      particle: () => null }, paints: null, scratch: null });
    dc.g = null; dc.pal = plan.look.palette;
    DR.drawGlyph(dc, scene, node, M);
    assert.equal(asked.length, sprites, 'sprites looked up for ' + JSON.stringify(pose));
  }
  // the text style 'glow' draws its halo on either path
  const glowing = Object.assign({}, g, { style: 'glow' });
  for (const [pose, sprites, inks] of [[{}, 1, 1], [{ blur: 3 }, 3, 0], [{ glow: 0.2 }, 2, 0]]) {
    set(pose);
    const count = { sprites: 0, inks: 0 };
    DR.glyphCover(glowing, P, node, 1, M, plan.design.w, plan.design.h, count);
    assert.deepEqual([count.sprites, count.inks], [sprites, inks], 'style glow ' + JSON.stringify(pose));
  }
  set({ blur: 3 });
  assert.equal(DR.glyphCover(g, P, node, 0, M, plan.design.w, plan.design.h), 0, 'world alpha 0: not drawn');
  P.reveal[node] = 0;
  assert.equal(DR.glyphCover(g, P, node, 1, M, plan.design.w, plan.design.h), 0, 'not revealed');
  P.reveal[node] = 1;
  // the cover grows with the size and the blur, and is clipped to the frame
  const at = (m, blur) => { set({ blur }); return DR.glyphCover(g, P, node, 1, new Float32Array(m), plan.design.w, plan.design.h); };
  assert.ok(at([2, 0, 0, 2, 900, 500], 3) > at([1, 0, 0, 1, 900, 500], 3) * 3);
  assert.ok(at([1, 0, 0, 1, 900, 500], 20) > at([1, 0, 0, 1, 900, 500], 3));
  assert.equal(at([1, 0, 0, 1, -5000, -5000], 3), 0, 'off the frame');
  assert.ok(at([400, 0, 0, 400, 900, 500], 3) <= plan.design.w * plan.design.h * 2 + 1, 'each draw at most the frame');
});

// --- the fit --------------------------------------------------------------------------------------------------------

test('fit: a document without materials has no budget and its behaviours are the ones the parts made', () => {
  const { engine, plan } = engineWith(BASE, []);
  for (const i of windowCuts(plan)) {
    const scene = engine.scene('cut', i);
    assert.equal(scene.spriteBudget, null);
    assert.ok(scene.behaviours.every((b) => b.run !== BH.runMasked));
  }
});

test('fit: every material phase adds at most SHARE frames of cover (or has every mask on); the step before did not fit', () => {
  const { reg, defs } = heavyRegistry();
  const { engine, plan } = engineWith(reg, defs);
  const D = plan.design;
  let masked = 0, kept = 0, checked = 0;
  for (const i of windowCuts(plan)) {
    const scene = engine.scene('cut', i);
    const rec = scene.spriteBudget;
    assert.ok(rec && rec.share === BG.SHARE, scene.key);
    for (const ph of scene.budgetPhases) {
      const r = rec[ph.phase];
      if (!r) { assert.ok(BG.samplesOf(...(ph.phase === 'arrive' ? [scene.times.a, scene.times.rest] : [0, 0])).length === 0 || ph.phase !== 'arrive'); continue; }
      assert.equal(r.key, ph.def.key);
      assert.deepEqual(r.masks, BG.LADDER[r.step]);
      // the scene holds the masks of the chosen step: its cover as it is equals the chosen step's, evaluated directly
      for (const b of ph.list) {
        const now = scene.behaviours.find((x) => orig(x) === b);
        assert.ok(now, 'every behaviour of the phase is in the scene');
        if (r.step === 0) assert.equal(now, b);
      }
      if (r.step > 0) assert.ok(ph.list.some((b) => scene.behaviours.includes(b) === false), 'some behaviour is masked');
      const [w0, w1] = ph.phase === 'arrive' ? [scene.times.a, scene.times.rest] : ph.phase === 'dwell'
        ? [scene.times.rest, scene.times.out] : [scene.times.out, scene.times.b];
      const asIs = BG.samplesOf(w0, w1, ph.phase === 'dwell' ? BG.HOLD_SAMPLES : BG.MAX_SAMPLES).map((t) => BG.coverAt(scene, t, D));
      assert.deepEqual(asIs, coversAt(scene, D, ph, r.step), scene.key + ' ' + ph.phase + ': the scene draws the chosen step');
      // evaluated directly (each step on its own), the record holds
      const first = coversAt(scene, D, ph, 0);
      if (r.step === 0 && peakOver(first, null) <= BG.SHARE) {
        assert.ok(Math.abs(peakOver(first, null) - r.added) < 1e-6, scene.key + ' ' + ph.phase + ' total');
        kept++; checked++;
        continue;
      }
      const base = coversAt(scene, D, ph, BG.LADDER.length - 1);
      const addedAt = (k) => peakOver(coversAt(scene, D, ph, k), base);
      assert.ok(Math.abs(addedAt(0) - r.added) < 1e-6, scene.key + ' ' + ph.phase + ': added ' + addedAt(0) + ' vs ' + r.added);
      assert.ok(Math.abs(addedAt(r.step) - r.fitted) < 1e-6, scene.key + ' ' + ph.phase + ': fitted');
      assert.ok(r.step === BG.LADDER.length - 1 || r.fitted <= BG.SHARE, scene.key + ' ' + ph.phase + ' within the share');
      if (r.step > 0) { assert.ok(addedAt(r.step - 1) > BG.SHARE, scene.key + ' ' + ph.phase + ': the step before is over'); masked++; }
      // the ladder never adds cover
      for (let k = 1; k < BG.LADDER.length; k++) assert.ok(addedAt(k) <= addedAt(k - 1) + 1e-9, 'monotone at ' + k);
      checked++;
    }
  }
  assert.ok(masked > 5 && checked > 20, JSON.stringify({ masked, kept, checked }));
});

test('fit: pure — the same records and frames from two engines; the scene\'s live pose, matrices and alphas are left as they were', () => {
  const { reg, defs } = heavyRegistry();
  const a = engineWith(reg, defs), b = engineWith(reg, defs);
  const cuts = windowCuts(a.plan).slice(0, 6);
  for (const i of cuts) {
    const sa = a.engine.scene('cut', i), sb = b.engine.scene('cut', i);
    assert.deepEqual(sa.spriteBudget, sb.spriteBudget);
    const t = sa.table;
    for (const c of T.POSE) assert.deepEqual(Array.from(t.live[c].subarray(0, t.n)), Array.from(t.base[c].subarray(0, t.n)), c);
  }
  // a scene's matrices before its first frame are what the build left: the fit restores them
  const rec = REC.createRecorder();
  const engine = FAC.createEngine({ registry: reg, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null, strict: true });
  engine.setPlan(a.plan);
  const W = 480, H = 270;
  const hashes = (e, r) => {
    const s = REC.surfaceOf(r.factory, W, H);
    return a.plan.cuts.filter((c, i) => cuts.includes(i)).map((c) => {
      const m = r.mark();
      e.renderFrame(s, c.a + 0.3, { quality: 'export', scale: W / a.plan.design.w });
      return r.hash(m);
    });
  };
  assert.deepEqual(hashes(engine, rec), hashes(b.engine, b.rec), 'frames: identical op streams');
});

test('fit: the cover is in du, so every output size gets the same masks; a phase that fits keeps its behaviours', () => {
  const { reg, defs } = heavyRegistry();
  const { engine, plan } = engineWith(reg, defs);
  const i = windowCuts(plan)[0];
  const s1 = engine.scene('cut', i);
  // a second engine renders at another size first: the scene (and its budget) is built the same
  const other = engineWith(reg, defs);
  other.engine.renderFrame(REC.surfaceOf(other.rec.factory, 3840, 2160), plan.cuts[i].a + 0.2, { quality: 'export', scale: 2 });
  assert.deepEqual(other.engine.scene('cut', i).spriteBudget, s1.spriteBudget);
  // the sample materials on small text fit as they are
  const sample = MIX.sampleDefs(BASE).filter((d) => ['arrive', 'dwell', 'depart'].includes(d.kind))
    .map((d) => Object.freeze(Object.assign({}, d, { key: d.key.replace('myMatS', 'myMatz') })));
  const sr = engineWith(REG.extend(BASE, sample), sample);
  const small = sr.plan.cuts.findIndex((c, k) => windowCuts(sr.plan).includes(k) && c.text.length >= 5 &&
    sr.engine.scene('cut', k).target.em[0] < 100);
  assert.ok(small >= 0);
  const rec = sr.engine.scene('cut', small).spriteBudget;
  for (const ph of ['arrive', 'dwell', 'depart']) assert.equal(rec[ph].step, 0, ph);
});
