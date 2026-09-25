/* 文字PVメーカー v2 — original work. Dominant colours of a small image: OKLab k-means++ seeded by the pixels (DESIGN_2_1 §11.3.4, §11.6.3). */
MV.def('media/palette', ['core/hash', 'core/rng', 'core/color'], (H, R, C) => {
  'use strict';

  // dominant(rgba, w, h, { k = 5 }) → ['#RRGGBB', …] (at most k, sorted by weight, heaviest first).
  // The host decodes a still (or a video poster) at 64×64 and passes its RGBA bytes. Pixels count by their alpha, and
  // nearly transparent ones not at all. The result is a pure function of the bytes: the k-means++ seeds come from a
  // stream keyed by hash32 of the pixels, and 8 Lloyd iterations run in OKLab (perceptually even distances).

  const ITERATIONS = 8;
  const MIN_ALPHA = 16;

  const LINEAR = new Float64Array(256);
  for (let i = 0; i < 256; i++) { const c = i / 255; LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }

  // sRGB bytes → OKLab (Björn Ottosson's matrices, as in core/color).
  function toLab(r8, g8, b8, out, at) {
    const r = LINEAR[r8], g = LINEAR[g8], b = LINEAR[b8];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    out[at] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    out[at + 1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    out[at + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  }

  function gamma(c) {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, v)) * 255;
  }

  function toHex(L, A, B) {
    const l = cube(L + 0.3963377774 * A + 0.2158037573 * B);
    const m = cube(L - 0.1055613458 * A - 0.0638541728 * B);
    const s = cube(L - 0.0894841775 * A - 1.2914855480 * B);
    return C.toHex({
      r: gamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      g: gamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      b: gamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    });
  }

  function cube(x) { return x * x * x; }

  // hash32 of the pixel bytes (as one latin-1 string, in slices).
  function seedOf(bytes) {
    const parts = [];
    for (let at = 0; at < bytes.length; at += 8192) parts.push(String.fromCharCode.apply(null, bytes.subarray(at, at + 8192)));
    return H.hash32('palette', parts.join(''));
  }

  function dist2(p, i, c, j) {
    const dl = p[i] - c[j], da = p[i + 1] - c[j + 1], db = p[i + 2] - c[j + 2];
    return dl * dl + da * da + db * db;
  }

  function dominant(rgba, w, h, opts) {
    const k = Math.max(1, Math.min(16, Math.round((opts && opts.k) || 5)));
    const bytes = rgba instanceof Uint8Array || rgba instanceof Uint8ClampedArray ? rgba : new Uint8ClampedArray(rgba);
    const count = Math.min(w * h, Math.floor(bytes.length / 4));
    const lab = new Float64Array(count * 3), weight = new Float64Array(count);
    let n = 0;
    for (let p = 0; p < count; p++) {
      const a = bytes[4 * p + 3];
      if (a < MIN_ALPHA) continue;
      toLab(bytes[4 * p], bytes[4 * p + 1], bytes[4 * p + 2], lab, 3 * n);
      weight[n++] = a / 255;
    }
    if (!n) return [];
    const rng = R.fromSeed(seedOf(bytes.subarray(0, count * 4)));
    // k-means++: the first centre ∝ weight, each next one ∝ weight · (distance to the nearest centre)²
    const centres = new Float64Array(k * 3);
    const near = new Float64Array(n).fill(Infinity);
    let made = 0;
    for (; made < k; made++) {
      let total = 0;
      for (let p = 0; p < n; p++) {
        if (made) near[p] = Math.min(near[p], dist2(lab, 3 * p, centres, 3 * (made - 1)));
        total += weight[p] * (made ? near[p] : 1);
      }
      if (!(total > 1e-12)) break;                    // every pixel already sits on a centre: fewer colours than k
      let r = rng.next() * total, pick = n - 1;
      for (let p = 0; p < n; p++) {
        r -= weight[p] * (made ? near[p] : 1);
        if (r < 0) { pick = p; break; }
      }
      centres[3 * made] = lab[3 * pick]; centres[3 * made + 1] = lab[3 * pick + 1]; centres[3 * made + 2] = lab[3 * pick + 2];
    }
    // Lloyd iterations
    const sums = new Float64Array(made * 4);
    const assign = new Int32Array(n);
    for (let it = 0; it < ITERATIONS; it++) {
      sums.fill(0);
      for (let p = 0; p < n; p++) {
        let best = 0, bestD = Infinity;
        for (let c = 0; c < made; c++) {
          const d = dist2(lab, 3 * p, centres, 3 * c);
          if (d < bestD) { bestD = d; best = c; }
        }
        assign[p] = best;
        const wgt = weight[p];
        sums[4 * best] += lab[3 * p] * wgt; sums[4 * best + 1] += lab[3 * p + 1] * wgt; sums[4 * best + 2] += lab[3 * p + 2] * wgt;
        sums[4 * best + 3] += wgt;
      }
      for (let c = 0; c < made; c++) {
        const wgt = sums[4 * c + 3];
        if (wgt > 0) for (let j = 0; j < 3; j++) centres[3 * c + j] = sums[4 * c + j] / wgt;
      }
    }
    const out = [];
    for (let c = 0; c < made; c++) if (sums[4 * c + 3] > 0) out.push({ c, w: sums[4 * c + 3] });
    out.sort((a, b) => b.w - a.w || a.c - b.c);
    const hexes = [];
    for (const { c } of out) {
      const hex = toHex(centres[3 * c], centres[3 * c + 1], centres[3 * c + 2]);
      if (!hexes.includes(hex)) hexes.push(hex);
    }
    return hexes;
  }

  return { dominant, ITERATIONS };
});
