/* 文字PVメーカー v2 — original work. Seeded value noise and noise tiles, closed-form in their inputs (DESIGN §4.1.4). */
MV.def('core/noise', [], () => {
  'use strict';
  const TWO32 = 4294967296;
  const PRIME = 0x01000193;
  const DIGITS = new Uint8Array(24);         // scratch for feedNumber; never escapes

  // Lattice values are hash32(seed, i[, j]) / 2^32. Paints call noise every frame, so latticeHash computes exactly
  // what hash32 would return for the same parts without building strings (kernel.test.js asserts the equality).
  function latticeHash(n, a, b, c) {
    let h = seedState(a);
    if (n > 1) h = feed(h, b);
    if (n > 2) h = feed(h, c);
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  }

  // One-entry memo of the FNV state after the seed part: a paint samples many lattice points with one seed.
  const memo = { seed: NaN, state: 0 };
  function seedState(seed) {
    if (seed !== memo.seed) { memo.state = feed(0x811c9dc5, seed); memo.seed = seed; }
    return memo.state;
  }

  function feed(h, part) {
    return typeof part === 'number' && Number.isSafeInteger(part) ? feedNumber(h, part) : feedString(h, String(part));
  }

  // FNV-1a over the decimal digits of a safe integer (the characters String(n) would give), then the separator.
  function feedNumber(h, n) {
    if (n < 0) { h = Math.imul(h ^ 45, PRIME); n = -n; }       // '-'
    let k = 0;
    do { const r = n % 10; DIGITS[k++] = r; n = (n - r) / 10; } while (n > 0);
    while (k > 0) h = Math.imul(h ^ (48 + DIGITS[--k]), PRIME);
    return Math.imul(h ^ 0x1f, PRIME);
  }

  function feedString(h, s) {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), PRIME);
    return Math.imul(h ^ 0x1f, PRIME);
  }

  function ease3(f) { return f * f * (3 - 2 * f); }

  // 1-D value noise in [0, 1).
  function noise1(seed, x) {
    const i = Math.floor(x);
    const u = ease3(x - i);
    const a = latticeHash(2, seed, i) / TWO32;
    const b = latticeHash(2, seed, i + 1) / TWO32;
    return a + (b - a) * u;
  }

  // 2-D value noise in [0, 1), bilinear over the lattice with smoothstep weights.
  function noise2(seed, x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    const u = ease3(x - i), v = ease3(y - j);
    const v00 = latticeHash(3, seed, i, j) / TWO32;
    const v10 = latticeHash(3, seed, i + 1, j) / TWO32;
    const v01 = latticeHash(3, seed, i, j + 1) / TWO32;
    const v11 = latticeHash(3, seed, i + 1, j + 1) / TWO32;
    const top = v00 + (v10 - v00) * u;
    const bottom = v01 + (v11 - v01) * u;
    return top + (bottom - top) * v;
  }

  // Fractal sum of noise1: octave o has frequency 2^o and weight 2^-o; normalised back to [0, 1).
  // Octave 0 uses the seed itself, so fbm1(seed, x, 1) === noise1(seed, x).
  function fbm1(seed, x, octaves = 3) {
    let sum = 0, norm = 0, amp = 1, freq = 1;
    for (let o = 0; o < octaves; o++) {
      const s = o === 0 ? seed : latticeHash(2, seed, o);
      sum += amp * noise1(s, x * freq);
      norm += amp;
      amp *= 0.5; freq *= 2;
    }
    return norm > 0 ? sum / norm : 0;
  }

  // size×size bytes of seeded white noise (0..255), row-major. Each cell is independent, so the tile repeats seamlessly.
  function tile(seed, size) {
    const n = Math.max(1, Math.floor(size));
    const out = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) out[y * n + x] = latticeHash(3, seed, x, y) >>> 24;
    }
    return out;
  }

  return { noise1, noise2, fbm1, tile };
});
