/* 文字PVメーカー v2 — original work. Camera wireframe parity, closed-form seeks and preview/export separation. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const WIRE = MV.use('ui/camera_wireframe');
const MAT = MV.use('core/mat');
const F = MV.use('engine/scene/frame');
const FAC = MV.use('engine/facade');
const REC = MV.use('engine/render/record');
const VIEW = MV.use('ui/view');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const REG = MV.use('parts/catalog').defaultRegistry();
const TEXT = '夜明けの街を 走る光と 君の声';

function engineWith(plan) {
  const rec = REC.createRecorder();
  const engine = FAC.createEngine({ registry: REG, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null });
  engine.setPlan(plan);
  return { rec, engine };
}
function surface(rec, w = 640, h = 360) {
  const made = rec.factory.create(w, h, { alpha: true });
  return { ...made, w, h };
}
function close(actual, expected, tolerance = 0.002) {
  assert.equal(actual.length, expected.length);
  actual.forEach((v, i) => assert.ok(Math.abs(v - expected[i]) <= tolerance, i + ': ' + v + ' ≠ ' + expected[i]));
}

test('camera footprint maps back to the exact viewport under the renderer matrix at every aspect, zoom and roll', () => {
  for (const [w, h] of [[1280, 720], [720, 1280], [720, 720], [1680, 720]]) {
    for (const zoom of [0.3, 1, 1.8, 12]) for (const roll of [-2.7, -0.4, 0, 1.8]) {
      const d = { w, h }, v = { x: w * 0.24, y: -h * 0.16, zoom, roll };
      const g = WIRE.geometry(d, v);
      const expected = F.viewMatrix(new Float32Array(6), { ...v, shakeX: 0, shakeY: 0 }, 1, w, h);
      assert.deepEqual(g.matrix, Array.from(expected));
      const actual = [];
      for (let i = 0; i < 8; i += 2) actual.push(...MAT.apply(g.matrix, g.frame[i], g.frame[i + 1], new Float32Array(2)));
      close(actual, [0, 0, w, 0, w, h, 0, h], 0.008);
      close(g.centre, [w / 2 + v.x, h / 2 + v.y]);
    }
  }
  assert.equal(WIRE.geometry({ w: 0, h: 720 }, { x: 0, y: 0, zoom: 1, roll: 0 }), null);
  assert.equal(WIRE.geometry({ w: 1280, h: 720 }, { x: 0, y: 0, zoom: 0, roll: 0 }), null);
});

test('combined shot, lens, area rig and impulses match the renderer camera after arbitrary seek and pause', () => {
  const plan = FAC.samplePlan(REG, { kind: 'shot', key: 'sweepAcross' }, { text: TEXT, aspect: '9:16' });
  const cut = plan.cuts[0];
  cut.slots.lens = { v: 'handHeld', p: { sway: 20, rate: 0.9, roll: 0.6, amount: 0.5 }, from: 'pin' };
  cut.fp += ':wire-lens';
  plan.rigs = [{ t0: 0, t1: plan.duration, rig: { v: 'slowSwell', p: { amp: 0.9 } } }];
  plan.impulses = [{ kind: 'shake', t: 0.7, amp: 0.8, decay: 0.3 }, { kind: 'punch', t: 0.9, amp: 0.7, decay: 0.4 }];
  const { engine } = engineWith(plan), cache = {};
  for (const t of [1.2, 0.85, 2.1, 0.85]) {
    const data = WIRE.snapshot(engine, plan, t, false, cache), scene = engine.scene('cut', 0);
    F.evaluate(scene, t - cut.t0);
    const cam = F.cameraAt(scene, plan, t);
    const expected = F.viewMatrix(new Float32Array(6), cam, 1, plan.design.w, plan.design.h);
    assert.deepEqual(data.current.matrix, Array.from(expected));
    assert.equal(data.time, t);
    assert.equal(data.path.points.length >= WIRE.SAMPLES, true);
    for (const p of data.path.points) {
      const v = engine.viewAt(p.t);
      close([p.x, p.y], [plan.design.w / 2 + v.x, plan.design.h / 2 + v.y]);
    }
  }
  engine.dispose();
});

test('EXTREME path samples use actual camera motion and separate deliberate jumps, including calm preview mode', () => {
  for (const key of ['jumpRead', 'spinIn', 'dutchSwing']) {
    const plan = FAC.samplePlan(REG, { kind: 'xshot', key }, { text: TEXT, aspect: '16:9' });
    const { engine } = engineWith(plan), cache = {}, t = 1.15;
    const full = WIRE.snapshot(engine, plan, t, false, cache);
    assert.deepEqual(full.current.view, engine.viewAt(t));
    const calm = WIRE.snapshot(engine, plan, t, true, cache);
    assert.deepEqual(calm.current.view, engine.viewAt(t, { calm: true }));
    for (const p of calm.path.points) {
      const v = engine.viewAt(p.t, { calm: true });
      close([p.x, p.y], [plan.design.w / 2 + v.x, plan.design.h / 2 + v.y]);
    }
    for (const j of engine.xJumps(calm.path.a, calm.path.b)) {
      assert.ok(calm.path.points.some((p) => p.break && p.t === j), key + ' separates jump ' + j);
    }
    engine.dispose();
  }
});

test('path cache evaluates only the current camera per playback frame and rebuilds when its interval or calm setting changes', () => {
  const plan = FAC.samplePlan(REG, { kind: 'shot', key: 'pushWord' }, { text: TEXT });
  const cut = plan.cuts[0], calls = [], cache = {};
  const engine = { viewAt(t, o) { calls.push({ t, calm: !!(o && o.calm) }); return { x: t * 25, y: -t * 10, zoom: 1.2, roll: t * 0.1 }; },
    shotTrack() { return { keys: [{ t: cut.a }, { t: cut.b }] }; }, xJumps() { return []; } };
  const first = WIRE.snapshot(engine, plan, 1, false, cache), n = calls.length;
  assert.ok(n >= WIRE.SAMPLES);
  assert.equal(calls[calls.length - 1].t, 1, 'the current scene is restored after future samples');
  const next = WIRE.snapshot(engine, plan, 1.3, false, cache);
  assert.equal(calls.length, n + 1);
  assert.equal(next.path, first.path);
  const calm = WIRE.snapshot(engine, plan, 1.3, true, cache);
  assert.notEqual(calm.path, first.path);
  assert.equal(calls[calls.length - 1].calm, true);
  const gap = WIRE.snapshot(engine, plan, plan.duration - 0.01, true, cache);
  assert.equal(gap.window.cut, null);
  assert.notEqual(gap.path, calm.path);
});

test('overview is bounded and Canvas state stays balanced across landscape, portrait, ultrawide and tiny previews', () => {
  for (const aspect of ['16:9', '9:16', '1:1', '21:9']) {
    const plan = FAC.samplePlan(REG, { kind: 'xshot', key: 'whipPan' }, { text: TEXT, aspect });
    const { engine } = engineWith(plan);
    const data = WIRE.snapshot(engine, plan, 1.1, false, {});
    for (const [w, h] of [[640, 360], [300, 533], [2560, 1080], [10, 10]]) {
      const rec = REC.createRecorder(), target = surface(rec, w, h), bounds = WIRE.overviewBounds(data);
      assert.ok([bounds.x0, bounds.y0, bounds.w, bounds.h].every(Number.isFinite));
      WIRE.draw(target.ctx, data, { scale: w / plan.design.w, width: w, height: h, dpr: 1, label: 'Frame / path' });
      const stats = rec.stats();
      assert.equal(stats.nan, 0, aspect);
      assert.equal(stats.balanced, true, aspect);
      assert.equal(stats.alphaBad, 0, aspect);
    }
    engine.dispose();
  }
});

test('preview overlay and path sampling do not change export render operations or its immutable plan', () => {
  const plan = FAC.samplePlan(REG, { kind: 'xshot', key: 'spinIn' }, { text: TEXT });
  const beforePlan = JSON.stringify(plan), a = engineWith(plan), b = engineWith(plan);
  const sa = surface(a.rec), sb = surface(b.rec), opts = { quality: 'export', scale: 640 / plan.design.w };
  a.engine.renderFrame(sa, 1.2, opts); b.engine.renderFrame(sb, 1.2, opts);
  const data = WIRE.snapshot(a.engine, plan, 1.2, true, {});
  const overlay = REC.createRecorder(), overlaySurface = surface(overlay);
  WIRE.draw(overlaySurface.ctx, data, { scale: 640 / plan.design.w, width: 640, height: 360, dpr: 1 });
  a.rec.reset(); b.rec.reset();
  a.engine.renderFrame(sa, 1.2, opts); b.engine.renderFrame(sb, 1.2, opts);
  assert.deepEqual(a.rec.ops(), b.rec.ops(), 'export recovers normal motion and contains no wireframe operations');
  assert.equal(JSON.stringify(plan), beforePlan);
  a.engine.dispose(); b.engine.dispose();
});

test('wireframe toggle is a typed preview preference, outside document history, with safe stored defaults', () => {
  const writes = [], storage = { getItem() { return null; }, setItem(k, v) { writes.push([k, JSON.parse(v)]); } };
  const view = VIEW.createView({ storage });
  assert.equal(view.state.prefs.cameraWireframe, false);
  assert.equal(view.setPref('cameraWireframe', true), true);
  assert.equal(view.state.prefs.cameraWireframe, true);
  assert.equal(writes[0][0], VIEW.PREF_KEY);
  assert.equal(writes[0][1].cameraWireframe, true);
  assert.equal(VIEW.createView({ storage: { getItem: () => JSON.stringify(writes[0][1]) } }).state.prefs.cameraWireframe, true);
  assert.equal(VIEW.readPrefs({ getItem: () => '{"cameraWireframe":"yes"}' }, 'k').cameraWireframe, false);
  assert.equal(view.setPref('cameraWireframe', 'yes'), false);
});
