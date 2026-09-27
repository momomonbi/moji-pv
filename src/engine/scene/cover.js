/* 文字PVメーカー v2 — original work. Ground coverage limiter: the view of a ground-scene layer under an EXTREME camera, limited so the painted rectangle always covers the frame (DESIGN_EXTREME §1.5). */
MV.def('engine/scene/cover', ['core/mat'], (MAT) => {
  'use strict';

  // Grounds paint the frame ± BLEED·(W, H) (parts/kit GROUND_BLEED, every ground's BLEED, static rasters' pad). A layer
  // with parallax k sees the camera through
  //   view(k) = T(C)·S(s)·R(−θ)·T(−C − T),   s = (1 + (Z − 1)·k)·gz,  θ = roll·k,  T = (x + shakeX, y + shakeY)·k.
  // The frame's preimage is a rotated rectangle centred on C + T with half extents e(θ)/s; it lies inside the painted
  // rectangle exactly when, per axis,
  //   ex(θ)/s + |Tx| ≤ (½ + b)·W − m     ex(θ) = (W|cos θ| + H|sin θ|)/2
  //   ey(θ)/s + |Ty| ≤ (½ + b)·H − m     ey(θ) = (W|sin θ| + H|cos θ|)/2          m = 0.004·short
  // The limiter keeps both true: θ' = sign θ · knee(|θ|, θmax) with θmax the largest |θ| that leaves RESERVE·(W, H) for
  // the translation, then T' = sign T · knee(|T|, A) per axis with A = (½ + b)·L − m − e(θ')/s. knee is the identity
  // below 0.8 of its limit and C¹ everywhere, so a limited ground never jerks. Pure; allocation-free.

  const BLEED = 0.15;
  const MARGIN = 0.004;
  const RESERVE = 0.02;
  const KNEE = 0.8;
  const HALF_PI = Math.PI / 2;

  // knee(v, L) = v for v ≤ 0.8·L, else 0.8·L + 0.2·L·tanh((v − 0.8·L)/(0.2·L)): ≤ L, continuous with a continuous slope.
  function knee(v, L) {
    if (!(L > 0)) return 0;
    const a = KNEE * L;
    if (v <= a) return v;
    const r = L - a;
    return a + r * Math.tanh((v - a) / r);
  }

  // The largest |θ| in [0, π/2] with e(θ)/s ≤ L' on both axes (L' = (½ + b)·L − m − RESERVE·L): with R = √(W² + H²),
  // ex(θ) = (R/2)·sin(θ + atan2(W, H)) and ey(θ) = (R/2)·sin(θ + atan2(H, W)) rise until they peak, so each bound is
  // asin(2·L'·s/R) − φ, or π/2 when 2·L'·s ≥ R.
  function thetaMax(s, W, H) {
    const m = MARGIN * Math.min(W, H), R = Math.sqrt(W * W + H * H);
    const lx = ((0.5 + BLEED - RESERVE) * W - m) * s, ly = ((0.5 + BLEED - RESERVE) * H - m) * s;
    const bound = (L, phi) => {
      const q = (2 * L) / R;
      return q >= 1 ? HALF_PI : Math.max(0, Math.asin(q) - phi);
    };
    return Math.min(bound(lx, Math.atan2(W, H)), bound(ly, Math.atan2(H, W)));
  }

  // limit(cam, k, W, H, out) → out { s, theta, tx, ty }: the limited scale, rotation and translation of layer k.
  function limit(cam, k, W, H, out) {
    const o = out || { s: 1, theta: 0, tx: 0, ty: 0 };
    const gz = k > 0 && cam.gz > 0 ? cam.gz : 1;
    const s = (1 + (cam.zoom - 1) * k) * gz;
    const m = MARGIN * Math.min(W, H);
    const th = cam.roll * k;
    const lim = thetaMax(s, W, H);
    const t = Math.sign(th) * knee(Math.abs(th), lim);
    const c = Math.abs(Math.cos(t)), n = Math.abs(Math.sin(t));
    const ax = (0.5 + BLEED) * W - m - (W * c + H * n) / 2 / s;
    const ay = (0.5 + BLEED) * H - m - (W * n + H * c) / 2 / s;
    const tx = (cam.x + (cam.shakeX || 0)) * k, ty = (cam.y + (cam.shakeY || 0)) * k;
    o.s = s; o.theta = t;
    o.tx = Math.sign(tx) * knee(Math.abs(tx), ax);
    o.ty = Math.sign(ty) * knee(Math.abs(ty), ay);
    return o;
  }

  const LIM = { s: 1, theta: 0, tx: 0, ty: 0 };
  const V1 = new Float32Array(6), V2 = new Float32Array(6);

  // coverView(out, cam, k, W, H): the view of a ground-scene layer with parallax k under cam (a CamPose with cover set),
  //   T(W/2, H/2) · S(s) · R(−θ') · T(−W/2 − T'x, −H/2 − T'y)
  function coverView(out, cam, k, W, H) {
    const L = limit(cam, k, W, H, LIM);
    MAT.compose(V1, W / 2, H / 2, -L.theta, 0, 0, L.s, L.s, 0, 0);
    MAT.ident(V2);
    V2[4] = -W / 2 - L.tx;
    V2[5] = -H / 2 - L.ty;
    return MAT.mul(out, V1, V2);
  }

  return { BLEED, MARGIN, RESERVE, knee, thetaMax, limit, coverView };
});
