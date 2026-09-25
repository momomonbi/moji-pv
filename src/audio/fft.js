/* 文字PVメーカー v2 — original work. Radix-2 FFT: complex in-place transform and real-input magnitudes (DESIGN §4.13). */
MV.def('audio/fft', [], () => {
  'use strict';

  function isPow2(n) { return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0; }

  function sizeError(n) {
    const e = new RangeError('FFT size must be a power of 2 (got ' + n + ')');
    e.code = 'size';
    return e;
  }

  function bitReversal(n) {
    let bits = 0;
    while ((1 << bits) < n) bits++;
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    return rev;
  }

  // createFFT(n) → { n, forward(re, im), inverse(re, im) }: iterative in-place transform of length n (a power of 2).
  // forward uses e^(−2πi·jk/n); inverse uses e^(+2πi·jk/n) and divides by n. Nothing is allocated per call.
  function createFFT(n) {
    if (!isPow2(n)) throw sizeError(n);
    const half = n >> 1;
    const cos = new Float64Array(half);
    const sin = new Float64Array(half);
    for (let k = 0; k < half; k++) {
      const a = (2 * Math.PI * k) / n;
      cos[k] = Math.cos(a);
      sin[k] = Math.sin(a);
    }
    const rev = bitReversal(n);

    function transform(re, im, sign) {
      for (let i = 0; i < n; i++) {
        const j = rev[i];
        if (j > i) {
          const tr = re[i]; re[i] = re[j]; re[j] = tr;
          const ti = im[i]; im[i] = im[j]; im[j] = ti;
        }
      }
      for (let size = 2; size <= n; size <<= 1) {
        const h = size >> 1;
        const stride = n / size;
        for (let start = 0; start < n; start += size) {
          for (let k = 0; k < h; k++) {
            const wr = cos[k * stride];
            const wi = sign * sin[k * stride];
            const a = start + k;
            const b = a + h;
            const xr = re[b] * wr - im[b] * wi;
            const xi = re[b] * wi + im[b] * wr;
            re[b] = re[a] - xr; im[b] = im[a] - xi;
            re[a] += xr; im[a] += xi;
          }
        }
      }
    }

    return {
      n,
      forward(re, im) { transform(re, im, -1); },
      inverse(re, im) {
        transform(re, im, 1);
        for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
      },
    };
  }

  // createRealFFT(n) → { n, bins, magnitudes(x, out) }: |X[k]| for k = 0 … n/2 of a real signal x of length n. One complex
  // transform of length n/2 runs on the even/odd samples packed as re/im; the two halves are then separated.
  function createRealFFT(n) {
    if (!isPow2(n) || n < 4) throw sizeError(n);
    const m = n >> 1;
    const inner = createFFT(m);
    const re = new Float64Array(m);
    const im = new Float64Array(m);
    const cos = new Float64Array(m);
    const sin = new Float64Array(m);
    for (let k = 0; k < m; k++) {
      const a = (2 * Math.PI * k) / n;
      cos[k] = Math.cos(a);
      sin[k] = Math.sin(a);
    }

    function magnitudes(x, out) {
      for (let j = 0; j < m; j++) { re[j] = x[2 * j]; im[j] = x[2 * j + 1]; }
      inner.forward(re, im);
      out[0] = Math.abs(re[0] + im[0]);
      out[m] = Math.abs(re[0] - im[0]);
      for (let k = 1; k < m; k++) {
        // Z[k] packs E (even samples) and O (odd samples): E = (Z[k] + conj Z[m−k]) / 2, O = (Z[k] − conj Z[m−k]) / 2i.
        const zr = re[k], zi = im[k];
        const cr = re[m - k], ci = -im[m - k];
        const er = (zr + cr) / 2, ei = (zi + ci) / 2;
        const or = (zi - ci) / 2, oi = (cr - zr) / 2;
        const wr = cos[k], wi = -sin[k];
        const xr = er + or * wr - oi * wi;
        const xi = ei + or * wi + oi * wr;
        out[k] = Math.sqrt(xr * xr + xi * xi);
      }
      return out;
    }

    return { n, bins: m + 1, magnitudes };
  }

  return { isPow2, createFFT, createRealFFT };
});
