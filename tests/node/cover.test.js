/* 文字PVメーカー v2 — original work. Tests: the ground coverage limiter of EXTREME segments, and the camera hooks it rides on (cover, gz) in engine/scene/frame (DESIGN_EXTREME §1.5). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');

const MV = load();
const N = MV.use('core/num');
const MAT = MV.use('core/mat');
const RNG = MV.use('core/rng');
const DOC = MV.use('core/doc');
const CO = MV.use('engine/scene/cover');
const F = MV.use('engine/scene/frame');
const T = MV.use('engine/scene/table');

const DEG = N.DEG;
const KS = [0.25, 0.5, 0.8, 1.2];

// The view of engine/scene/frame before EXTREME, copied here: a camera without `cover` must give exactly this.
function oldView(out, cam, k, W, H) {
  const V1 = new Float32Array(6), V2 = new Float32Array(6);
  const s = 1 + (cam.zoom - 1) * k;
  MAT.compose(V1, W / 2, H / 2, -cam.roll * k, 0, 0, s, s, 0, 0);
  MAT.ident(V2);
  V2[4] = -W / 2 - (cam.x + cam.shakeX) * k;
  V2[5] = -H / 2 - (cam.y + cam.shakeY) * k;
  return MAT.mul(out, V1, V2);
}

// How far the frame's preimage under V pokes out of the painted rectangle frame ± 0.15·(W, H) (≤ 0: covered).
function uncovered(V, W, H) {
  const I = MAT.invert(new Float32Array(6), V);
  let worst = -Infinity;
  for (const [x, y] of [[0, 0], [W, 0], [W, H], [0, H]]) {
    const px = I[0] * x + I[2] * y + I[4], py = I[1] * x + I[3] * y + I[5];
    worst = Math.max(worst, -CO.BLEED * W - px, px - (1 + CO.BLEED) * W, -CO.BLEED * H - py, py - (1 + CO.BLEED) * H);
  }
  return worst;
}

test('knee: the identity below 0.8·L, never above L, monotonic and C¹', () => {
  const L = 100;
  for (const v of [0, 10, 50, 79.9, 80]) assert.equal(CO.knee(v, L), v);
  let prev = -1, prevSlope = 1;
  for (let v = 0; v <= 1000; v += 0.25) {
    const y = CO.knee(v, L);
    assert.ok(y <= L && y >= prev, 'monotonic, at most L at ' + v);
    const slope = (CO.knee(v + 1e-4, L) - CO.knee(v - 1e-4, L)) / 2e-4;
    assert.ok(Math.abs(slope - prevSlope) < 0.01, 'slope continuous at ' + v);
    prev = y; prevSlope = slope;
  }
  assert.equal(CO.knee(5, 0), 0, 'no room: 0');
});

test('θmax: the worked limits of §1.5.1 (≈ 8.5° on 16:9 and 9:16 with the reserve, ≈ 6.4° on 21:9, more on 1:1)', () => {
  const at = (aspect) => CO.thetaMax(1, ...DOC.DESIGN_SIZE[aspect]) / DEG;
  approx(at('16:9'), 8.5, 0.35);
  approx(at('9:16'), at('16:9'), 1e-9, 'symmetric in W and H');
  approx(at('21:9'), 6.4, 0.35);
  assert.ok(at('1:1') > 15, '1:1 ' + at('1:1'));
  assert.ok(CO.thetaMax(1.5, 1920, 1080) > at('16:9') * DEG, 'a larger scale leaves more room');
  // without the reserve and the margin the exact coverage limit is ≈ 10.2°: check it directly on the formula
  const W = 1920, H = 1080, R = Math.hypot(W, H);
  approx((Math.asin((2 * 0.65 * H) / R) - Math.atan2(H, W)) / DEG, 10.2, 0.2);
});

test('10k random EXTREME cameras × 7 aspects × parallax .25/.5/.8/1.2: the painted rectangle always covers the frame', () => {
  const rng = RNG.stream('cover-test');
  const V = new Float32Array(6);
  let n = 0;
  for (const aspect of DOC.ASPECTS) {
    const [W, H] = DOC.DESIGN_SIZE[aspect];
    for (let i = 0; i < 10000 / DOC.ASPECTS.length + 1; i++) {
      const cam = { x: rng.range(-1.2, 1.2) * W, y: rng.range(-1.2, 1.2) * H, zoom: rng.range(0.9, 3.4), roll: rng.range(-400, 400) * DEG,
        shakeX: rng.range(-40, 40), shakeY: rng.range(-40, 40), fz: 1, gz: rng.range(1, 1.35), cover: 1 };
      for (const k of KS) {
        const bad = uncovered(CO.coverView(V, cam, k, W, H), W, H);
        assert.ok(bad <= 1e-3 * W, aspect + ' k ' + k + ': uncovered by ' + bad + ' at ' + JSON.stringify(cam));
        n++;
      }
    }
  }
  assert.ok(n >= 40000);
});

test('below the knee the limiter is the identity: the same view as the camera without cover (gz 1)', () => {
  const V = new Float32Array(6), U = new Float32Array(6);
  for (const [W, H] of [[1920, 1080], [1080, 1920], [1080, 1080]]) {
    for (const cam of [{ x: 30, y: -20, zoom: 1.2, roll: 4 * DEG, shakeX: 3, shakeY: -2 }, { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0 },
      { x: -120, y: 60, zoom: 2, roll: -20 * DEG, shakeX: 0, shakeY: 0 }]) {
      for (const k of KS) {
        CO.coverView(V, Object.assign({ cover: 1, gz: 1 }, cam), k, W, H);
        approx(Array.from(V), Array.from(oldView(U, cam, k, W, H)), 1e-3, JSON.stringify(cam) + ' k ' + k);
      }
    }
  }
});

test('the limited ground moves smoothly (C¹) as a whip or a spin runs past the knee', () => {
  const W = 1920, H = 1080, L = { s: 1, theta: 0, tx: 0, ty: 0 };
  for (const [what, make] of [['whip', (u) => ({ x: u * 3 * W, y: 0, roll: 0 })], ['spin', (u) => ({ x: 0, y: 0, roll: u * 2 * Math.PI })],
    ['both', (u) => ({ x: u * 2 * W, y: -u * H, roll: u * 1.5 * Math.PI })]]) {
    let prev = null, prevD = null;
    for (let i = 0; i <= 2000; i++) {
      const u = i / 2000;
      const c = Object.assign({ zoom: 1.4, shakeX: 0, shakeY: 0, gz: 1.2, cover: 1 }, make(u));
      CO.limit(c, 0.25, W, H, L);
      const v = [L.theta * 1000, L.tx, L.ty];
      if (prev) {
        const d = v.map((x, j) => x - prev[j]);
        for (let j = 0; j < 3; j++) assert.ok(Math.abs(d[j]) < 3, what + ': continuous at ' + u);
        if (prevD) for (let j = 0; j < 3; j++) assert.ok(Math.abs(d[j] - prevD[j]) < 0.05, what + ': no kink at ' + u);
        prevD = d;
      }
      prev = v;
    }
  }
});

test('viewMatrix: a camera without cover takes the old code path bit for bit; with cover, the limiter', () => {
  const rng = RNG.stream('view-test');
  const A = new Float32Array(6), B = new Float32Array(6);
  for (let i = 0; i < 2000; i++) {
    const cam = { x: rng.range(-300, 300), y: rng.range(-300, 300), zoom: rng.range(0.8, 3), roll: rng.range(-1, 1),
      shakeX: rng.range(-20, 20), shakeY: rng.range(-20, 20), fz: 1 };
    const k = rng.pick([0, 0.25, 0.5, 0.8, 1, 1.2]);
    assert.deepEqual(Array.from(F.viewMatrix(A, cam, k, 1920, 1080)), Array.from(oldView(B, cam, k, 1920, 1080)));
    const gz = Object.assign({}, cam, { gz: 1.3 });
    assert.deepEqual(Array.from(F.viewMatrix(A, gz, k, 1920, 1080)), Array.from(oldView(B, cam, k, 1920, 1080)), 'gz alone does nothing');
    const cov = Object.assign({}, cam, { gz: 1.3, cover: 1 });
    assert.deepEqual(Array.from(F.viewMatrix(A, cov, k, 1920, 1080)), Array.from(CO.coverView(B, cov, k, 1920, 1080)));
  }
  // the hud (parallax 0) of a covered camera stays the identity: gz scales only layers that move with the camera
  approx(Array.from(F.viewMatrix(A, { x: 50, y: 0, zoom: 2, roll: 0.3, shakeX: 0, shakeY: 0, gz: 1.3, cover: 1 }, 0, 1920, 1080)),
    [1, 0, 0, 1, 0, 0], 1e-6);
  // gz magnifies the ground about the frame centre (vertigo)
  const g = F.viewMatrix(A, { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0, gz: 1.3, cover: 1 }, T.LAYERS[0].parallax, 1920, 1080);
  approx([g[0], g[3], g[4]], [1.3, 1.3, 960 - 1.3 * 960], 1e-3);
});

test('depthCam passes cover and scales gz like the zoom; a reused output drops them for a plain camera', () => {
  const cam = { x: 40, y: -20, zoom: 1.6, roll: 0.05, shakeX: 3, shakeY: -2, fz: 1.3, gz: 1.2, cover: 1 };
  const one = F.depthCam(cam, 1);
  assert.equal(one.cover, 1); assert.equal(one.gz, 1.2);
  const half = F.depthCam(cam, 0.5);
  assert.equal(half.cover, 1); approx(half.gz, Math.sqrt(1.2), 1e-12); approx(half.zoom, Math.sqrt(1.6), 1e-12);
  const zero = F.depthCam(cam, 0);
  assert.equal(zero.cover, 0); assert.equal(zero.gz, 1);
  const out = F.depthCam(cam, 0.5, {});
  F.depthCam({ x: 1, y: 2, zoom: 1.1, roll: 0, shakeX: 0, shakeY: 0, fz: 1 }, 0.5, out);
  assert.equal(out.cover, 0, 'a plain camera after an EXTREME one is not limited');
  assert.equal(out.gz, 1);
  assert.deepEqual(F.depthCam({ x: 1, y: 2, zoom: 1.1, roll: 0, shakeX: 0, shakeY: 0, fz: 1 }, 0.5),
    { x: 0.5, y: 1, zoom: Math.sqrt(1.1), roll: 0, shakeX: 0, shakeY: 0, fz: 1 }, 'a fresh output of a plain camera gains no field');
});

test('composeCamera passes gz through, and a reused output gets gz 1 back; a plain cut camera gains no field', () => {
  const plan = { rigs: [], impulses: [], design: { w: 1920, h: 1080 } };
  const rig = { x: 0, y: 0, zoom: 1, roll: 0 };
  const k = { x: 5, y: 0, zoom: 1.2, roll: 0, jx: 0, jy: 0, fz: 1.2, gz: 1.25 };
  const out = F.composeCamera(k, rig, plan, 0, {});
  assert.equal(out.gz, 1.25);
  F.composeCamera({ x: 5, y: 0, zoom: 1.2, roll: 0, jx: 0, jy: 0, fz: 1.2 }, rig, plan, 0, out);
  assert.equal(out.gz, 1);
  assert.deepEqual(Object.keys(F.composeCamera({ x: 5, y: 0, zoom: 1.2, roll: 0, jx: 0, jy: 0, fz: 1.2 }, rig, plan, 0, {})).sort(),
    ['fz', 'roll', 'shakeX', 'shakeY', 'x', 'y', 'zoom']);
});
