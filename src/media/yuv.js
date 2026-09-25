/* 文字PVメーカー v2 — original work. Reduced RGBA copies of 8-bit YUV video frames: a box average at 1/b with the colour matrix of the frame, and a mirrored border for a blur (DESIGN_2_1 §11.3.4, §11.4.6). */
MV.def('media/yuv', [], () => {
  'use strict';

  // The store bakes the blur of a video frame once per source frame (DESIGN_2_1 §11.4.6 "Blur of a video or animation
  // frame"): the host copies the frame's planes out (VideoFrame.copyTo, the visible rect only), this module turns them
  // into a small RGBA copy, and the host blurs that copy with ctx.filter. Pure: typed arrays in, typed arrays out; the
  // result is a function of the bytes and the options only (IEEE doubles, rounded by Uint8ClampedArray), so every run
  // and every machine gives the same copy of the same decoded frame.
  //
  //   FORMATS                         the VideoFrame formats this module reads: 8-bit 4:2:0, planar or semi-planar
  //   MATRICES                        colour matrix name (VideoColorSpace.matrix) → [Kr, Kb]
  //   supports(format, cs)            → boolean: FORMATS, a known matrix, SDR (no PQ / HLG transfer, no BT.2020
  //                                     primaries); anything else goes through the browser's own conversion (the host's
  //                                     canvas route), chosen by these properties only, never by history
  //   factorFor(long, px, blur)       → b ∈ {1, 2, 4, 8}: the largest power of two ≤ 8 with long / b ≥ px / 4 (px / 8
  //                                     when blur ≥ 8 device px), so the copy's long side lies in [px / 4, px / 2); 1
  //                                     when even the whole frame is smaller than that
  //   sigmaFor(blur, long, b, px)     → the blur in copy px (blur device px × copy px per device px), in 1/32 px, > 0
  //   padFor(sigma, cw, ch)           → the border a blur of sigma needs: ceil(3σ), at most the copy's shorter side
  //   toRgba(src, o) → { data, w, h, cw, ch, pad }
  //       src = { format: 'I420' | 'NV12', data: Uint8Array, layout: [{ offset, stride }], w, h }   (w × h visible px)
  //       o   = { b: 2 | 4 | 8, matrix, full: boolean, pad, out?: Uint8ClampedArray (reused when large enough) }
  //       data: RGBA (alpha 255) of (cw + 2·pad) × (ch + 2·pad) px, cw = ceil(w / b), ch = ceil(h / b): each copy pixel
  //       is the average of its b × b block of Y and its (b/2) × (b/2) block of U and V (the last row and column
  //       average what they cover), converted with the matrix (limited or full range); the border mirrors the copy
  //       (pixel −1 − k shows pixel k), as the engine's mirrored edges do.

  const FORMATS = ['I420', 'NV12'];
  const MATRICES = Object.freeze({ bt709: [0.2126, 0.0722], bt470bg: [0.299, 0.114], smpte170m: [0.299, 0.114] });
  const SIGMA_STEP = 32;

  function supports(format, cs) {
    if (!FORMATS.includes(format)) return false;
    const c = cs || {};
    if (!c.matrix || !Object.prototype.hasOwnProperty.call(MATRICES, c.matrix)) return false;
    if (c.transfer === 'pq' || c.transfer === 'hlg') return false;
    if (c.primaries === 'bt2020') return false;
    return true;
  }

  function factorFor(long, px, blur) {
    const need = (blur >= 8 ? px / 8 : px / 4);
    let b = 1;
    for (const k of [2, 4, 8]) if (long / k >= need) b = k;
    return b;
  }

  function sigmaFor(blur, long, b, px) {
    const s = (blur * (long / b)) / Math.max(1, px);
    return Math.max(1, Math.round(s * SIGMA_STEP)) / SIGMA_STEP;
  }

  function padFor(sigma, cw, ch) { return Math.max(0, Math.min(Math.ceil(3 * sigma), cw, ch)); }

  // Colour conversion constants: R = ky·(Y − y0) + kr·V', G = ky·(Y − y0) − kgu·U' − kgv·V', B = ky·(Y − y0) + kbu·U',
  // with U' = U − 128, V' = V − 128 (8-bit codes); limited range scales Y by 255/219 and chroma by 255/224.
  function coefficients(matrix, full) {
    const [kr, kb] = MATRICES[matrix] || MATRICES.bt709;
    const kg = 1 - kr - kb;
    const cy = full ? 1 : 255 / 219, cc = full ? 1 : 255 / 224;
    return { y0: full ? 0 : 16, ky: cy, kr: 2 * (1 - kr) * cc, kbu: 2 * (1 - kb) * cc,
      kgu: ((2 * kb * (1 - kb)) / kg) * cc, kgv: ((2 * kr * (1 - kr)) / kg) * cc };
  }

  const LITTLE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

  // Sums of one plane's rows [r0, r1) into acc, block by block: block width bw (1, 2, 4 or 8 px), n output columns, a
  // plane pw px wide; `step` 2 reads every other byte (the interleaved chroma of NV12). The last block sums what it
  // covers. Scalar, unrolled per block width.
  function sumRows(d, off, stride, r0, r1, pw, bw, n, acc, step) {
    const full = Math.min(n, Math.floor(pw / bw));
    for (let r = r0; r < r1; r++) {
      let p = off + r * stride;
      let o = 0;
      if (step === 1) {
        if (bw === 1) for (; o < full; o++, p++) acc[o] += d[p];
        else if (bw === 2) for (; o < full; o++, p += 2) acc[o] += d[p] + d[p + 1];
        else if (bw === 4) for (; o < full; o++, p += 4) acc[o] += d[p] + d[p + 1] + d[p + 2] + d[p + 3];
        else for (; o < full; o++, p += 8) acc[o] += d[p] + d[p + 1] + d[p + 2] + d[p + 3] + d[p + 4] + d[p + 5] + d[p + 6] + d[p + 7];
      } else {
        if (bw === 1) for (; o < full; o++, p += 2) acc[o] += d[p];
        else if (bw === 2) for (; o < full; o++, p += 4) acc[o] += d[p] + d[p + 2];
        else if (bw === 4) for (; o < full; o++, p += 8) acc[o] += d[p] + d[p + 2] + d[p + 4] + d[p + 6];
        else for (; o < full; o++, p += 16) acc[o] += d[p] + d[p + 2] + d[p + 4] + d[p + 6] + d[p + 8] + d[p + 10] + d[p + 12] + d[p + 14];
      }
      for (let x = o * bw; o < n; o++) {                        // the last, partial block
        const x1 = Math.min(pw, x + bw);
        let s = 0;
        for (; x < x1; x++, p += step) s += d[p];
        acc[o] += s;
      }
    }
  }

  // The same over whole 32-bit words (a planar plane on a little-endian machine, word-aligned rows, bw 2, 4 or 8): two
  // bytes per 16-bit lane, lanes summed over the rows (≤ 8 rows × 4 bytes × 255 < 2^16) and folded once; the columns
  // past the last whole word are summed as above. The sums are the same as sumRows' (integers), only faster.
  function sumRowsWords(d, u32, off, stride, r0, r1, pw, bw, n, acc, lanes) {
    const words = bw === 2 ? pw >> 2 : bw === 4 ? pw >> 2 : pw >> 3;      // lane groups of whole words
    lanes.fill(0, 0, words);
    for (let r = r0; r < r1; r++) {
      let p = (off + r * stride) >> 2;
      if (bw === 8) {
        for (let k = 0; k < words; k++, p += 2) {
          const v = u32[p], x = u32[p + 1];
          lanes[k] += (v & 0x00ff00ff) + ((v >>> 8) & 0x00ff00ff) + (x & 0x00ff00ff) + ((x >>> 8) & 0x00ff00ff);
        }
      } else {
        for (let k = 0; k < words; k++, p++) { const v = u32[p]; lanes[k] += (v & 0x00ff00ff) + ((v >>> 8) & 0x00ff00ff); }
      }
    }
    let o = 0;
    if (bw === 2) {
      for (let k = 0; k < words; k++) { const l = lanes[k]; acc[o++] += l & 0xffff; acc[o++] += l >>> 16; }
    } else {
      for (let k = 0; k < words; k++) { const l = lanes[k]; acc[o++] += (l & 0xffff) + (l >>> 16); }
    }
    if (o < n) sumTail(d, off, stride, r0, r1, pw, bw, o, n, acc);   // columns past the whole words: scalar
  }

  // Whole square blocks (bw rows of bw px, bw 2, 4 or 8) over whole words, the rows read side by side (no lane array):
  // → the number of output columns summed; the caller sums the columns past them.
  const M8 = 0x00ff00ff;
  function sumBlocksWords(u32, p, ws, bw, n, acc) {
    let o = 0;
    if (bw === 2) {
      const words = Math.min(n >> 1, ws);
      for (let k = 0; k < words; k++, p++) {
        const v0 = u32[p], v1 = u32[p + ws];
        const s = (v0 & M8) + ((v0 >>> 8) & M8) + (v1 & M8) + ((v1 >>> 8) & M8);
        acc[o++] += s & 0xffff; acc[o++] += s >>> 16;
      }
    } else if (bw === 4) {
      const w2 = 2 * ws, w3 = 3 * ws;
      for (; o < n; o++, p++) {
        const v0 = u32[p], v1 = u32[p + ws], v2 = u32[p + w2], v3 = u32[p + w3];
        const s = (v0 & M8) + ((v0 >>> 8) & M8) + (v1 & M8) + ((v1 >>> 8) & M8) + (v2 & M8) + ((v2 >>> 8) & M8) + (v3 & M8) + ((v3 >>> 8) & M8);
        acc[o] += (s & 0xffff) + (s >>> 16);
      }
    } else {
      for (; o < n; o++, p += 2) {
        let s = 0;
        for (let r = 0, q = p; r < 8; r++, q += ws) {
          const v = u32[q], x = u32[q + 1];
          s += (v & M8) + ((v >>> 8) & M8) + (x & M8) + ((x >>> 8) & M8);
        }
        acc[o] += (s & 0xffff) + (s >>> 16);
      }
    }
    return o;
  }

  function sumPlane(d, u32, off, stride, r0, r1, pw, bw, n, acc, lanes, step) {
    if (u32 && step === 1 && bw >= 2 && (off & 3) === 0 && (stride & 3) === 0) {
      if (r1 - r0 === bw) {
        // whole blocks of whole words first (bw 2: pairs of columns in one word; bw 4: one word; bw 8: two words)
        const full = bw === 2 ? (pw >> 2) << 1 : bw === 4 ? pw >> 2 : pw >> 3;
        const o = sumBlocksWords(u32, (off + r0 * stride) >> 2, stride >> 2, bw, Math.min(n, full), acc);
        if (o < n) sumTail(d, off, stride, r0, r1, pw, bw, o, n, acc);
      } else sumRowsWords(d, u32, off, stride, r0, r1, pw, bw, n, acc, lanes);
    } else sumRows(d, off, stride, r0, r1, pw, bw, n, acc, step);
  }

  // Columns [o, n) of rows [r0, r1), byte by byte (the part of a row past its whole words).
  function sumTail(d, off, stride, r0, r1, pw, bw, o, n, acc) {
    for (let r = r0; r < r1; r++) {
      let x = o * bw, p = off + r * stride + x;
      for (let q = o; q < n; q++) {
        const x1 = Math.min(pw, x + bw);
        let s = 0;
        for (; x < x1; x++, p++) s += d[p];
        acc[q] += s;
      }
    }
  }

  const FIX = 14, ONE = 1 << FIX, HALF = 1 << (FIX - 1);

  // Copy pixels [o0, o1) of one row from block sums, in fixed point (FIX fraction bits; every product stays below
  // 2^31): R = (ay·ΣY + rv·ΣV + r0) >> FIX, and alike, where ay = ky / nY, rv = kr / nC, … and the constants fold the
  // offsets (y0, 128); each channel rounded half up and clamped to 0..255. Integers only: the same on every machine.
  function convert(accY, accU, accV, o0, o1, nY, nC, K, out, out32, row) {
    const ay = Math.round((K.ky * ONE) / nY) | 0, rv = Math.round((K.kr * ONE) / nC) | 0, gu = Math.round((K.kgu * ONE) / nC) | 0;
    const gv = Math.round((K.kgv * ONE) / nC) | 0, bu = Math.round((K.kbu * ONE) / nC) | 0;
    const cy = (Math.round(-K.ky * K.y0 * ONE) + HALF) | 0;
    const r0 = (cy - Math.round(128 * K.kr * ONE)) | 0, g0 = (cy + Math.round(128 * (K.kgu + K.kgv) * ONE)) | 0;
    const b0 = (cy - Math.round(128 * K.kbu * ONE)) | 0;
    if (out32 !== null) {
      for (let o = o0; o < o1; o++) {
        const y = ay * accY[o], u = accU[o], v = accV[o];
        let r = (y + rv * v + r0) >> FIX, g = (y - gu * u - gv * v + g0) >> FIX, bb = (y + bu * u + b0) >> FIX;
        r = r < 0 ? 0 : r > 255 ? 255 : r;
        g = g < 0 ? 0 : g > 255 ? 255 : g;
        bb = bb < 0 ? 0 : bb > 255 ? 255 : bb;
        out32[row + o] = r | (g << 8) | (bb << 16) | -16777216;        // little-endian RGBA; 0xff000000 as an int32
      }
      return;
    }
    for (let o = o0; o < o1; o++) {
      const y = ay * accY[o], u = accU[o], v = accV[o], q = (row + o) * 4;
      out[q] = (y + rv * v + r0) >> FIX;                                // Uint8ClampedArray clamps
      out[q + 1] = (y - gu * u - gv * v + g0) >> FIX;
      out[q + 2] = (y + bu * u + b0) >> FIX;
      out[q + 3] = 255;
    }
  }

  function toRgba(src, o) {
    const b = o.b | 0;
    if (!(b === 2 || b === 4 || b === 8)) throw new Error('yuv: b must be 2, 4 or 8');
    if (!FORMATS.includes(src.format)) throw new Error('yuv: format ' + src.format);
    const w = src.w, h = src.h, d = src.data, L = src.layout;
    const cw = Math.ceil(w / b), ch = Math.ceil(h / b);
    const pad = Math.max(0, Math.min(o.pad | 0, cw, ch));
    const pw = cw + 2 * pad, ph = ch + 2 * pad;
    const size = pw * ph * 4;
    const out = o.out && o.out.length >= size ? o.out.subarray(0, size) : new Uint8ClampedArray(size);
    const K = coefficients(o.matrix, !!o.full);
    const out32 = LITTLE ? new Int32Array(out.buffer, out.byteOffset, pw * ph) : null;
    const hb = b >> 1;
    const cwp = (w + 1) >> 1, chp = (h + 1) >> 1;                  // chroma plane size
    const nv12 = src.format === 'NV12';
    const accY = new Int32Array(cw), accU = new Int32Array(cw), accV = new Int32Array(cw);
    const words = LITTLE && (d.byteOffset & 3) === 0 ? new Uint32Array(d.buffer, d.byteOffset, d.byteLength >> 2) : null;
    const lanes = words ? new Uint32Array((w >> 2) + 1) : null;
    for (let oy = 0; oy < ch; oy++) {
      accY.fill(0); accU.fill(0); accV.fill(0);
      const r0 = oy * b, r1 = Math.min(h, r0 + b);
      const c0 = oy * hb, c1 = Math.min(chp, c0 + hb);
      sumPlane(d, words, L[0].offset, L[0].stride, r0, r1, w, b, cw, accY, lanes, 1);
      if (nv12) {
        sumRows(d, L[1].offset, L[1].stride, c0, c1, cwp, hb, cw, accU, 2);
        sumRows(d, L[1].offset + 1, L[1].stride, c0, c1, cwp, hb, cw, accV, 2);
      } else {
        sumPlane(d, words, L[1].offset, L[1].stride, c0, c1, cwp, hb, cw, accU, lanes, 1);
        sumPlane(d, words, L[2].offset, L[2].stride, c0, c1, cwp, hb, cw, accV, lanes, 1);
      }
      const ny = r1 - r0, nc = c1 - c0;
      const row = (oy + pad) * pw + pad;
      // whole blocks: one set of factors per row (every block of the row has ny rows and b × b/2 columns)
      const full = Math.min(cw, Math.floor(w / b), Math.floor(cwp / hb));
      convert(accY, accU, accV, 0, full, b * ny, hb * nc, K, out, out32, row);
      for (let ox = full; ox < cw; ox++) {                        // the partial last column
        const nx = Math.min(w, (ox + 1) * b) - ox * b, ncx = Math.min(cwp, (ox + 1) * hb) - ox * hb;
        convert(accY, accU, accV, ox, ox + 1, nx * ny, ncx * nc, K, out, out32, row);
      }
    }
    if (pad > 0) mirror(out, pw, ph, cw, ch, pad);
    return { data: out, w: pw, h: ph, cw, ch, pad };
  }

  // The border: columns of the copy's rows first, then whole rows (so the corners mirror both ways).
  function mirror(out, pw, ph, cw, ch, pad) {
    const u32 = new Uint32Array(out.buffer, out.byteOffset, pw * ph);
    for (let y = pad; y < pad + ch; y++) {
      const row = y * pw;
      for (let k = 0; k < pad; k++) {
        u32[row + pad - 1 - k] = u32[row + pad + k];
        u32[row + pad + cw + k] = u32[row + pad + cw - 1 - k];
      }
    }
    for (let k = 0; k < pad; k++) {
      u32.copyWithin((pad - 1 - k) * pw, (pad + k) * pw, (pad + k + 1) * pw);
      u32.copyWithin((pad + ch + k) * pw, (pad + ch - 1 - k) * pw, (pad + ch - k) * pw);
    }
  }

  return { FORMATS, MATRICES, SIGMA_STEP, supports, factorFor, sigmaFor, padFor, coefficients, toRgba };
});
