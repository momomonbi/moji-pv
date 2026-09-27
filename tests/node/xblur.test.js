/* 文字PVメーカー v2 — original work. Tests: EXTREME camera motion blur and the renderer's EXTREME paths — taps, shutter in seconds, gating (seams, calm, adaptive levels), the ground coverage of whole frames and the boundary blend (DESIGN_EXTREME §1.5, §1.6). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');

const MV = load();
const MAT = MV.use('core/mat');
const SHOT = MV.use('core/shot');
const DOC = MV.use('core/doc');
const FAC = MV.use('engine/facade');
const BUILD = MV.use('engine/scene/build');
const F = MV.use('engine/scene/frame');
const XS = MV.use('engine/scene/xshot');
const XB = MV.use('engine/render/xblur');
const R = MV.use('engine/render/record');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');

const REG = MV.use('parts/catalog').defaultRegistry();
const TEXT = '夜明けの街を 走る光と 君の声';

function engineOf() {
  const rec = R.createRecorder();
  const engine = FAC.createEngine({ registry: REG, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null });
  return { rec, engine };
}

function surfaceOf(rec, plan, short, alpha) {
  const k = short / plan.design.short;
  const w = Math.round(plan.design.w * k), h = Math.round(plan.design.h * k);
  const made = rec.factory.create(w, h, { alpha: alpha === true });
  return { canvas: made.canvas, ctx: made.ctx, w, h };
}

function xPlan(shot, o) {
  const opt = o || {};
  return FAC.samplePlan(REG, { kind: 'xshot', key: shot, params: { extreme: opt.extreme } }, { text: TEXT, aspect: opt.aspect || '16:9',
    backdrop: opt.backdrop });
}

function sceneOf(plan) {
  const svc = { registry: REG, text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
  return BUILD.buildCut(plan.cuts[0], plan, svc);
}

test('maxTaps: export 6; preview 4 at level 0, 3 at levels 1–2, none from level 3', () => {
  assert.equal(XB.maxTaps('export', 0), 6);
  assert.equal(XB.maxTaps('export', 4), 6, 'export never degrades');
  assert.equal(XB.maxTaps('preview', 0), 4);
  assert.equal(XB.maxTaps('preview', 1), 3);
  assert.equal(XB.maxTaps('draft', 2), 3);
  assert.equal(XB.maxTaps('preview', 3), 0);
});

test('taps: none at rest; n from the displacement over the shutter; each tap is V(t_j)·V(t)⁻¹ of the closed-form camera', () => {
  // a still x-shot with blur: no taps
  const still = { x: 1, keys: [{ at: 'a', aim: 'block', fill: 0.6 }, { at: 'b', aim: 'block', fill: 0.6 }] };
  const sp = FAC.samplePlan(REG, { kind: 'xshot', key: still }, { text: TEXT });
  const ss = sceneOf(sp);
  F.evaluate(ss, 1);
  assert.equal(XB.taps(ss, sp, ss.t0 + 1, F.cameraAt(ss, sp, ss.t0 + 1, {}), 1920, 1080, 6), null);
  // a whip in motion
  const plan = xPlan('whipPan');
  const scene = sceneOf(plan);
  const tr = scene.shot;
  let found = 0;
  for (let tl = tr.a; tl < tr.b; tl += 1 / 60) {
    const t = scene.t0 + tl;
    F.evaluate(scene, tl);
    const cam = F.cameraAt(scene, plan, t, {});
    const tp = XB.taps(scene, plan, t, cam, 1920, 1080, 6);
    if (!tp) continue;
    found++;
    assert.equal(tp.n, Math.max(2, Math.min(6, Math.ceil(tp.d / XB.MIN_DU))), 'n from d');
    assert.ok(tp.d >= XB.MIN_DU);
    // the last tap: the camera moved by the closed-form difference over the whole shutter
    const c0 = F.composeCamera(XS.camAt(tr, tl, {}), F.rigAt(plan, t), plan, t, {});
    const te = t - tr.shutter;
    const ce = F.composeCamera(XS.camAt(tr, te - scene.t0, {}), F.rigAt(plan, te), plan, te, {});
    const moved = { x: cam.x + ce.x - c0.x, y: cam.y + ce.y - c0.y, zoom: (cam.zoom * ce.zoom) / c0.zoom, roll: cam.roll + ce.roll - c0.roll,
      shakeX: cam.shakeX + ce.shakeX - c0.shakeX, shakeY: cam.shakeY + ce.shakeY - c0.shakeY };
    const V = F.viewMatrix(new Float32Array(6), cam, 1, 1920, 1080), Vi = MAT.invert(new Float32Array(6), V);
    const M = MAT.mul(new Float32Array(6), F.viewMatrix(new Float32Array(6), moved, 1, 1920, 1080), Vi);
    approx(Array.from(tp.M.slice((tp.n - 2) * 6, (tp.n - 1) * 6)), Array.from(M), 1e-3, 'last tap at t − SH');
    approx(tp.d, XB.displacement(M, 1920, 1080), 1e-3);
  }
  assert.ok(found >= 3, 'the whip frames are blurred (' + found + ')');
  // blur 0 (jumpRead, vertigo) never blurs
  for (const key of ['jumpRead', 'vertigo']) {
    const p = xPlan(key), s = sceneOf(p);
    for (let tl = s.times.a; tl < s.times.b; tl += 0.05) {
      F.evaluate(s, tl);
      assert.equal(XB.taps(s, p, s.t0 + tl, F.cameraAt(s, p, s.t0 + tl, {}), 1920, 1080, 6), null, key);
    }
  }
});

test('the shutter is in seconds: the taps at t are the same whatever frame rate (or order) the frames are drawn at', () => {
  const plan = xPlan('spinIn');
  const scene = sceneOf(plan);
  const at = (t) => {
    F.evaluate(scene, t - scene.t0);
    const tp = XB.taps(scene, plan, t, F.cameraAt(scene, plan, t, {}), 1920, 1080, 6);
    return tp ? [tp.n, Array.from(tp.M.slice(0, 6 * (tp.n - 1)))] : null;
  };
  const t = 0.1;
  const direct = at(t);
  assert.ok(direct, 'spinIn is blurred at 0.1 s');
  for (const fps of [30, 60, 24]) for (let k = 0; k * (1 / fps) < t; k++) at(k / fps);
  assert.deepEqual(at(t), direct);
});

test('renderFrame: blurred frames report their copies (≤ 6 in export, ≤ 4 / 3 / none in preview), take no direct path, and are deterministic', () => {
  const plan = xPlan('whipPan');
  const run = (quality, level, opts) => {
    const { rec, engine } = engineOf();
    engine.setPlan(plan);
    if (level) engine.setLevel(level);
    const surface = surfaceOf(rec, plan, 360);
    const out = [];
    for (let t = 0; t < plan.duration; t += 1 / 30) {
      const m = rec.mark();
      const st = engine.renderFrame(surface, t, Object.assign({ quality, pick: false, scale: surface.w / plan.design.w }, opts));
      const ops = rec.ops().slice(m);
      out.push({ t, blur: st.blur || 0, hash: rec.hash(m), direct: !ops.some((o) => o[0] === surface.canvas.id && o[1] === 'drawImage') });
    }
    engine.dispose();
    return out;
  };
  const exp = run('export', 0);
  assert.ok(exp.filter((f) => f.blur).length >= 3, 'some frames are blurred');
  assert.ok(exp.every((f) => f.blur <= 6));
  assert.ok(exp.filter((f) => f.blur).every((f) => !f.direct), 'a blurred frame is drawn on a pool surface and copied');
  assert.deepEqual(run('export', 0).map((f) => f.hash), exp.map((f) => f.hash), 'the op streams are the same twice');
  const pre = run('preview', 0);
  assert.ok(pre.some((f) => f.blur) && pre.every((f) => f.blur <= 4));
  assert.ok(run('preview', 1).every((f) => f.blur <= 3));
  assert.ok(run('preview', 3).every((f) => !f.blur), 'adaptive level 3: no blur');
  assert.ok(run('preview', 0, { calm: true }).every((f) => !f.blur), 'calm: no blur in the preview');
  assert.deepEqual(run('export', 0, { calm: true }).map((f) => f.hash), exp.map((f) => f.hash), 'export ignores calm');
});

// The copies are averaged on a half-size pooled surface and drawn back over the frame (phase F): the frame is then the
// mean of the sharp base and the n − 1 copies.
test('a clear backdrop averages the copies with lighter; other backdrops keep a running average over the base', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-3;
  for (const backdrop of ['clear', 'scene']) {
    const plan = xPlan('whipPan', { backdrop });
    const { rec, engine } = engineOf();
    engine.setPlan(plan);
    const surface = surfaceOf(rec, plan, 360, backdrop === 'clear');
    let lighter = 0, blurred = 0;
    for (let t = 0; t < plan.duration; t += 1 / 30) {
      const m = rec.mark();
      const st = engine.renderFrame(surface, t, { quality: 'export', pick: false, scale: surface.w / plan.design.w, backdrop });
      if (!st.blur) continue;
      blurred++;
      const n = st.blur;
      const ops = rec.ops().slice(m);
      if (ops.some((o) => o[1] === 'set:globalCompositeOperation' && o[2] === 'lighter')) lighter++;
      // the copies: drawImage calls of a whole surface onto the half-size one
      const half = ops.filter((o) => o[1] === 'drawImage' && o.length === 5);
      const alphas = ops.filter((o) => o[1] === 'set:globalAlpha').map((o) => o[2]);
      if (backdrop === 'clear') {
        assert.ok(alphas.filter((a) => near(a, 1 / (n - 1))).length >= n - 1, 'n − 1 copies at 1/(n − 1)');
        assert.ok(ops.some((o) => o[1] === 'set:globalCompositeOperation' && o[2] === 'destination-out'), 'the base scaled by 1/n');
        assert.ok(alphas.some((a) => near(a, 1 - 1 / n)), 'destination-out at 1 − 1/n');
      } else {
        const want = [1].concat(Array.from({ length: n - 2 }, (_, j) => 1 / (j + 2)));
        for (const w of want) assert.ok(alphas.some((a) => near(a, w)), 'a running average: ' + w);
      }
      assert.ok(alphas.some((a) => near(a, (n - 1) / n)), 'the average drawn back at (n − 1)/n');
      // the average comes back with one scaled draw of the half-size surface over the whole frame
      const back = ops.filter((o) => o[1] === 'drawImage' && o.length === 11 && o[9] === surface.w && o[10] === surface.h);
      assert.ok(back.length >= 1, 'drawn back over the frame');
      assert.ok(half.length >= n - 1, 'the copies');
    }
    engine.dispose();
    assert.ok(blurred >= 3, backdrop + ': blurred frames');
    if (backdrop === 'clear') assert.equal(lighter, blurred);
  }
});

test('no blur while a seam is active', () => {
  const plan = FAC.samplePlan(REG, { kind: 'seam', key: REG.keys('seam')[0] }, { text: TEXT, textB: '光のなかへ' });
  for (const c of plan.cuts) {
    c.slots = Object.assign({}, c.slots, { 'cam.shot': { v: 'spinIn', from: 'pin:line' }, 'cam.extreme': { v: 1, from: 'pin:work' } });
    c.fp += ':x';
  }
  const { rec, engine } = engineOf();
  engine.setPlan(plan);
  const surface = surfaceOf(rec, plan, 360);
  const sm = plan.seams[0];
  for (let t = sm.at - sm.dur / 2 + 0.01; t < sm.at + sm.dur / 2; t += 0.02) {
    const st = engine.renderFrame(surface, t, { quality: 'export', pick: false, scale: surface.w / plan.design.w });
    assert.equal(st.blur, undefined, 'seam frame at ' + t.toFixed(2));
  }
  engine.dispose();
});

// The ground's static raster is placed with one setTransform before its drawImage (renderer drawIsolated): inverting
// that placement shows whether the raster covers the whole output frame.
function rasterGaps(ops, surfaceId, w, h) {
  let M = null, worst = -Infinity, n = 0;
  for (const o of ops) {
    if (o[0] !== surfaceId && o[0] !== ops.frameId) continue;
    if (o[1] === 'setTransform') M = o.slice(2);
    else if (o[1] === 'drawImage' && o.length === 7 && M && typeof o[2] === 'string') {
      const [, , , x, y, rw, rh] = o;
      if (!(rw > w * 0.5)) continue;                          // a full-frame raster (the ground), not a sprite
      const I = MAT.invert(new Float32Array(6), Float32Array.from(M));
      for (const [px, py] of [[0, 0], [w, 0], [w, h], [0, h]]) {
        const lx = I[0] * px + I[2] * py + I[4], ly = I[1] * px + I[3] * py + I[5];
        worst = Math.max(worst, x - lx, lx - (x + rw), y - ly, ly - (y + rh));
      }
      n++;
    }
  }
  return { worst, n };
}

test('whole frames: the ground raster of an EXTREME segment covers the frame at every 1/30 s of every preset, 3 aspects', () => {
  for (const aspect of ['16:9', '9:16', '1:1']) {
    for (const key of SHOT.XSHOT_KEYS) {
      const plan = xPlan(key, { aspect });
      const { rec, engine } = engineOf();
      engine.setPlan(plan);
      const surface = surfaceOf(rec, plan, 180);
      let placed = 0;
      for (let t = 0; t < plan.duration; t += 1 / 30) {
        const m = rec.mark();
        engine.renderFrame(surface, t, { quality: 'export', pick: false, scale: surface.w / plan.design.w });
        const ops = rec.ops().slice(m);
        // the frame surface is the canvas the world is drawn on: the first canvas cleared to the frame size
        const frame = ops.find((o) => o[1] === 'clearRect' && o[4] === surface.w && o[5] === surface.h);
        ops.frameId = frame ? frame[0] : surface.canvas.id;
        const g = rasterGaps(ops, surface.canvas.id, surface.w, surface.h);
        placed += g.n;
        assert.ok(g.worst <= 1e-3 * surface.w, key + ' ' + aspect + ' at ' + t.toFixed(3) + ': the ground leaves ' + g.worst.toFixed(2) + ' px');
      }
      assert.ok(placed > 20, key + ' ' + aspect + ': the ground raster is placed (' + placed + ')');
      engine.dispose();
    }
  }
});

test('a hard boundary between two EXTREME cuts of one segment eases the ground from A\'s camera to B\'s', () => {
  const plan = FAC.samplePlan(REG, { kind: 'seam', key: REG.keys('seam')[0] }, { text: TEXT, textB: '光のなかへ' });
  plan.seams = [];
  plan.cuts[1].seamIn = -1;
  for (const c of plan.cuts) {
    c.slots = Object.assign({}, c.slots, { 'cam.shot': { v: 'whipPan', from: 'pin:line' }, 'cam.extreme': { v: 1, from: 'pin:work' } });
    c.fp += ':x';
  }
  const B = plan.cuts[1];
  const placement = (engine, rec, surface, t) => {
    const m = rec.mark();
    engine.renderFrame(surface, t, { quality: 'export', pick: false, scale: surface.w / plan.design.w });
    const ops = rec.ops().slice(m);
    let M = null;
    for (const o of ops) {
      if (o[1] === 'setTransform') M = o.slice(2);
      else if (o[1] === 'drawImage' && o.length === 7 && o[5] > surface.w * 0.5) return M;
    }
    return null;
  };
  const { rec, engine } = engineOf();
  engine.setPlan(plan);
  const surface = surfaceOf(rec, plan, 360);
  let prev = null, worst = 0;
  for (let t = B.t0 - 0.1; t < B.t0 + 0.1; t += 1 / 480) {
    const M = placement(engine, rec, surface, t);
    if (prev) worst = Math.max(worst, Math.abs(M[4] - prev[4]), Math.abs(M[5] - prev[5]));
    prev = M;
  }
  engine.dispose();
  assert.ok(worst < 4, 'the ground moves at most ' + worst.toFixed(2) + ' px per 1/480 s across the boundary');
});
