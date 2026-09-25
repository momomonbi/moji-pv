/* 文字PVメーカー v2 — original work. Seeded random streams and Gumbel noise (DESIGN §4.1.2, §4.1.3). */
MV.def('core/rng', ['core/hash'], (H) => {
  'use strict';
  const TWO32 = 4294967296;

  // splitmix-style 32-bit generator; integer-exact in every JS engine  (FROZEN code, DESIGN §4.1.2)
  function gen(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x9e3779b9) >>> 0;
      let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
      t ^= t >>> 15; t = Math.imul(t, 0x735a2d97); t ^= t >>> 15;
      return (t >>> 0) / 4294967296;         // [0, 1)
    };
  }

  // A Stream runs the same arithmetic as gen() with its state on the instance, so the planner can create
  // thousands of streams without allocating a closure per method.
  class Stream {
    constructor(seed) {
      this.seed = seed >>> 0;
      this._a = this.seed;
    }

    next() {
      const a = this._a = (this._a + 0x9e3779b9) >>> 0;
      let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
      t ^= t >>> 15; t = Math.imul(t, 0x735a2d97); t ^= t >>> 15;
      return (t >>> 0) / TWO32;
    }

    range(lo, hi) { return lo + (hi - lo) * this.next(); }

    // Integer in [lo, hi], both ends inclusive.
    int(lo, hi) { return lo + Math.floor(this.next() * (hi - lo + 1)); }

    chance(p) { return this.next() < p; }

    // Always advances once, even for an empty array (which yields undefined).
    pick(array) { return array[Math.floor(this.next() * array.length)]; }

    // Picks values[i] with probability weights[i] / Σ weights; negative or non-finite weights count as 0.
    // Advances exactly once. When every weight is 0 the pick is uniform.
    weighted(values, weights) {
      const u = this.next();
      let total = 0;
      for (let i = 0; i < values.length; i++) total += weightAt(weights, i);
      if (!(total > 0)) return values[Math.floor(u * values.length)];
      const r = u * total;
      let acc = 0, last = -1;
      for (let i = 0; i < values.length; i++) {
        const w = weightAt(weights, i);
        if (w <= 0) continue;
        acc += w; last = i;
        if (r < acc) return values[i];
      }
      return values[last];                   // float round-off at the very top of the range
    }

    // Fisher–Yates on a copy; the input is untouched.
    shuffle(array) {
      const out = Array.prototype.slice.call(array);
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        const tmp = out[i]; out[i] = out[j]; out[j] = tmp;
      }
      return out;
    }

    floats(n) {
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = this.next();
      return out;
    }

    // A child stream seeded by (this.seed, ...labels); does not advance this stream.
    fork(...labels) { return stream(this.seed, ...labels); }
  }

  function weightAt(weights, i) {
    const w = weights[i];
    return typeof w === 'number' && w > 0 && w !== Infinity ? w : 0;
  }

  function fromSeed(seed) { return new Stream(seed); }

  function stream(...labels) { return new Stream(H.hash32(...labels)); }

  // Standard Gumbel noise keyed by (seed, key); independent of any stream. Argmax of ln(w) + gumbel samples ∝ w.
  function gumbel(seed, key) {
    return -Math.log(-Math.log((H.hash32('gumbel', seed, key) + 0.5) / TWO32));
  }

  return { gen, stream, fromSeed, gumbel, Stream };
});
