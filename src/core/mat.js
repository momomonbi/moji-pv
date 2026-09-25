/* 文字PVメーカー v2 — original work. 2-D affine matrices as Float32Array(6) [a, b, c, d, e, f] (DESIGN §4.1.4). */
MV.def('core/mat', [], () => {
  'use strict';
  // Same layout as Canvas setTransform(a, b, c, d, e, f):  x' = a·x + c·y + e,  y' = b·x + d·y + f.
  // Every function writes into `out` (which may alias an input) and allocates nothing.

  function ident(out) {
    out[0] = 1; out[1] = 0; out[2] = 0; out[3] = 1; out[4] = 0; out[5] = 0;
    return out;
  }

  // out = A · B (B is applied first).
  function mul(out, A, B) {
    const a = A[0] * B[0] + A[2] * B[1], b = A[1] * B[0] + A[3] * B[1];
    const c = A[0] * B[2] + A[2] * B[3], d = A[1] * B[2] + A[3] * B[3];
    const e = A[0] * B[4] + A[2] * B[5] + A[4], f = A[1] * B[4] + A[3] * B[5] + A[5];
    out[0] = a; out[1] = b; out[2] = c; out[3] = d; out[4] = e; out[5] = f;
    return out;
  }

  // out = A⁻¹; returns null (out untouched) when A is singular.
  function invert(out, A) {
    const det = A[0] * A[3] - A[1] * A[2];
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
    const k = 1 / det;
    const a = A[3] * k, b = -A[1] * k, c = -A[2] * k, d = A[0] * k;
    const e = -(a * A[4] + c * A[5]), f = -(b * A[4] + d * A[5]);
    out[0] = a; out[1] = b; out[2] = c; out[3] = d; out[4] = e; out[5] = f;
    return out;
  }

  // out2 = M · (x, y).
  function apply(M, x, y, out2) {
    out2[0] = M[0] * x + M[2] * y + M[4];
    out2[1] = M[1] * x + M[3] * y + M[5];
    return out2;
  }

  // Corners of the rectangle (x0, y0)–(x1, y1) under M, clockwise from the top-left: TL, TR, BR, BL.
  function quad(out8, M, x0, y0, x1, y1) {
    corner(out8, 0, M, x0, y0);
    corner(out8, 2, M, x1, y0);
    corner(out8, 4, M, x1, y1);
    corner(out8, 6, M, x0, y1);
    return out8;
  }

  function corner(out, i, M, x, y) {
    out[i] = M[0] * x + M[2] * y + M[4];
    out[i + 1] = M[1] * x + M[3] * y + M[5];
  }

  // out = T(x + px, y + py) · R(rot) · K(kx, ky) · S(sx, sy) · T(−px, −py); angles in radians.
  // K is the CSS skew matrix [1, tan ky, tan kx, 1, 0, 0].
  function compose(out, x, y, rot, kx, ky, sx, sy, px, py) {
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const tx = kx === 0 ? 0 : Math.tan(kx), ty = ky === 0 ? 0 : Math.tan(ky);
    const a = sx * (cos - sin * ty), b = sx * (sin + cos * ty);
    const c = sy * (cos * tx - sin), d = sy * (sin * tx + cos);
    out[0] = a; out[1] = b; out[2] = c; out[3] = d;
    out[4] = x + px - (a * px + c * py);
    out[5] = y + py - (b * px + d * py);
    return out;
  }

  return { ident, mul, invert, apply, quad, compose };
});
