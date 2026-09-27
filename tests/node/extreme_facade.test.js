/* 文字PVメーカー v2 — original work. Tests: the engine facade's EXTREME members — the xshot sample plan, shotTrack's x fields, xJumps, viewAt / renderFrame calm — and the gate that keeps every other document on the old paths (DESIGN_EXTREME §2.4, §3.4, §3.6). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');

const MV = load();
const SHOT = MV.use('core/shot');
const FAC = MV.use('engine/facade');
const R = MV.use('engine/render/record');
const XS = MV.use('engine/scene/xshot');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');

const REG = MV.use('parts/catalog').defaultRegistry();
const TEXT = '夜明けの街を 走る光と 君の声';

function engineWith(plan) {
  const rec = R.createRecorder();
  const engine = FAC.createEngine({ registry: REG, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null });
  engine.setPlan(plan);
  return { rec, engine };
}

test('samplePlan kind xshot: the preset on the cut with cam.extreme, its segment marked EXTREME; unknown keys show none', () => {
  const plan = FAC.samplePlan(REG, { kind: 'xshot', key: 'spinIn~m', params: { extreme: 0.5 } }, { text: TEXT, aspect: '9:16' });
  const cut = plan.cuts[0];
  assert.equal(cut.slots['cam.shot'].v, 'spinIn~m');
  assert.equal(cut.slots['cam.extreme'].v, 0.5);
  assert.equal(plan.grounds[0].x, true);
  assert.equal(plan.grounds[0].zoomed, true);
  assert.equal(FAC.samplePlan(REG, { kind: 'xshot', key: 'crashZoom' }, {}).cuts[0].slots['cam.extreme'].v, 1, 'EXTREME at 最大 by default');
  const bad = FAC.samplePlan(REG, { kind: 'xshot', key: 'settle' }, {});
  assert.equal(bad.cuts[0].slots['cam.shot'].v, 'none', 'a normal preset is not an xshot');
  assert.equal(bad.grounds[0].x, undefined);
  assert.notEqual(FAC.samplePlan(REG, { kind: 'xshot', key: 'spinIn' }, {}).cuts[0].fp,
    FAC.samplePlan(REG, { kind: 'xshot', key: 'spinIn', params: { extreme: 0.5 } }, {}).cuts[0].fp, 'fp covers cam.extreme');
  // the normal kinds are unchanged: no cam.extreme, no x mark
  const shot = FAC.samplePlan(REG, { kind: 'shot', key: 'pushWord' }, {});
  assert.equal(shot.cuts[0].slots['cam.extreme'], undefined);
  assert.equal(shot.grounds[0].x, undefined);
  assert.equal(FAC.samplePlan(REG, { kind: 'rig', key: 'slowSwell' }, {}).grounds[0].x, undefined);
});

test('shotTrack adds x, gz and hit for an x-track; a normal track keeps its fields', () => {
  const { engine } = engineWith(FAC.samplePlan(REG, { kind: 'xshot', key: 'punchHit' }, { text: TEXT }));
  const tr = engine.shotTrack(engine.plan.cuts[0].key);
  assert.equal(tr.x, true);
  assert.deepEqual(Object.keys(tr.keys[0]).sort(), ['aim', 'gz', 'hit', 't', 'x', 'y', 'roll', 'zoom'].sort());
  assert.equal(tr.keys[2].hit, 0.8);
  engine.setPlan(FAC.samplePlan(REG, { kind: 'shot', key: 'snapZoom' }, { text: TEXT }));
  const n = engine.shotTrack(engine.plan.cuts[0].key);
  assert.equal(n.x, undefined);
  assert.deepEqual(Object.keys(n.keys[0]).sort(), ['aim', 't', 'x', 'y', 'roll', 'zoom'].sort());
  engine.dispose();
});

test('xJumps: the kept deliberate jumps of EXTREME tracks, absolute and sorted, within [t0, t1); none elsewhere', () => {
  const plan = FAC.samplePlan(REG, { kind: 'xshot', key: 'jumpRead' }, { text: TEXT });
  const { engine } = engineWith(plan);
  const all = engine.xJumps(0, plan.duration);
  const tr = engine.scene('cut', 0).shot;
  assert.deepEqual(all, Array.from(tr.jumps, (j) => plan.cuts[0].t0 + j));
  assert.ok(all.length >= 2);
  for (let i = 1; i < all.length; i++) assert.ok(all[i] - all[i - 1] >= XS.XJUMP_GAP - 1e-9, 'spaced ≥ 0.4 s (≤ 2.5 per second)');
  assert.deepEqual(engine.xJumps(all[0] + 1e-6, plan.duration), all.slice(1));
  engine.setPlan(FAC.samplePlan(REG, { kind: 'shot', key: 'readAlong' }, { text: TEXT }));
  assert.deepEqual(engine.xJumps(0, 10), []);
  engine.dispose();
});

test('viewAt and renderFrame take calm (preview): the modulators ×0.3; export and a normal document ignore it', () => {
  const plan = FAC.samplePlan(REG, { kind: 'xshot', key: 'dutchSwing' }, { text: TEXT });
  const { engine, rec } = engineWith(plan);
  const t = 1.0, tl = t - plan.cuts[0].t0;
  const full = engine.viewAt(t), calm = engine.viewAt(t, { calm: true });
  const tr = engine.scene('cut', 0).shot;
  const m = XS.modAt(tr, tl, {});
  approx(full.roll - calm.roll, (1 - XS.CALM) * (m.swing + m.jolt), 1e-6);
  assert.deepEqual(engine.viewAt(t), full, 'viewAt is pure in its options');
  const made = rec.factory.create(320, 180, { alpha: false });
  const surface = { canvas: made.canvas, ctx: made.ctx, w: 320, h: 180 };
  const hashOf = (opts) => { const k = rec.mark(); engine.renderFrame(surface, t, Object.assign({ pick: false, scale: 320 / 1920 }, opts)); return rec.hash(k); };
  hashOf({ quality: 'export' }); hashOf({ quality: 'preview' });                // warm: static rasters are drawn once
  assert.equal(hashOf({ quality: 'export', calm: true }), hashOf({ quality: 'export' }), 'export ignores calm');
  assert.notEqual(hashOf({ quality: 'preview', calm: true }), hashOf({ quality: 'preview' }), 'the preview tones down');
  // a normal document draws the same ops with or without calm (and with or without the sentinel)
  engine.setPlan(FAC.samplePlan(REG, { kind: 'shot', key: 'tiltHold' }, { text: TEXT }));
  hashOf({ quality: 'preview' });
  assert.equal(hashOf({ quality: 'preview', calm: true }), hashOf({ quality: 'preview' }));
  engine.dispose();
});

test('the sentinel (lab only) fills the scene backdrop; without it the backdrop is the ground colour as before', () => {
  const plan = FAC.samplePlan(REG, { kind: 'xshot', key: 'whipPan' }, { text: TEXT });
  const { engine, rec } = engineWith(plan);
  const made = rec.factory.create(320, 180, { alpha: false });
  const surface = { canvas: made.canvas, ctx: made.ctx, w: 320, h: 180 };
  const fills = (opts) => {
    const k = rec.mark();
    engine.renderFrame(surface, 1, Object.assign({ quality: 'export', pick: false, scale: 320 / 1920 }, opts));
    return rec.ops().slice(k).filter((o) => o[1] === 'set:fillStyle').map((o) => o[2]);
  };
  assert.ok(fills({ sentinel: '#FF00FF' }).includes('#FF00FF'));
  assert.ok(!fills({}).includes('#FF00FF'));
  engine.dispose();
});

test('every x-preset renders through the facade at 3 aspects without warnings, the recorder balanced', () => {
  for (const aspect of ['16:9', '9:16', '1:1']) {
    for (const key of SHOT.XSHOT_KEYS) {
      const plan = FAC.samplePlan(REG, { kind: 'xshot', key }, { text: TEXT, aspect });
      const { engine, rec } = engineWith(plan);
      const made = rec.factory.create(160, 160, { alpha: false });
      const surface = { canvas: made.canvas, ctx: made.ctx, w: 160, h: 160 };
      for (let t = 0; t < plan.duration; t += 0.1) engine.renderFrame(surface, t, { quality: 'export', pick: false, scale: 160 / plan.design.w });
      assert.deepEqual(engine.warnings().filter((w) => w.code === 'part-error'), [], key);
      const st = rec.stats();
      assert.ok(st.balanced && st.nan === 0 && st.alphaBad === 0, key + ' ' + aspect + ' ' + JSON.stringify(st));
      engine.dispose();
    }
  }
});
