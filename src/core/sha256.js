/* 文字PVメーカー v2 — original work. Streaming SHA-256 (FIPS 180-4) for content-addressed assets (DESIGN_2_1 §11.3.3). */
MV.def('core/sha256', [], () => {
  'use strict';

  // The host hashes files up to 256 MB with crypto.subtle.digest (one buffer). Above that, and in Node tests, this
  // streaming implementation runs, so a 4 GB video never sits in memory. Both give the same digest (tested).

  // The first 32 bits of the fractional parts of the cube roots of the first 64 primes (FIPS 180-4 §4.2.2).
  const K = Uint32Array.from([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  // The initial hash value (FIPS 180-4 §5.3.3).
  const H0 = Uint32Array.from([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);

  // One 64-byte block at bytes[at…] into the state h (w is the 64-word message schedule, reused).
  function block(h, w, bytes, at) {
    for (let i = 0; i < 16; i++) {
      const p = at + 4 * i;
      w[i] = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
    }
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (k + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + k) | 0;
  }

  // createSha256() → { update(bytes) → this, digest() → Uint8Array(32) }. update() may be called with chunks of any
  // size, and the digest does not depend on where the chunks split. digest() finishes the hash; update() after it throws.
  function createSha256() {
    const h = Uint32Array.from(H0);
    const w = new Int32Array(64);
    const buf = new Uint8Array(64);      // the pending partial block
    let fill = 0;
    let total = 0;                       // bytes seen (a double: exact far beyond 4 GB)
    let done = false;

    const api = {
      update(bytes) {
        if (done) throw new Error('sha256: update after digest');
        if (!(bytes instanceof Uint8Array)) throw new TypeError('sha256: update takes a Uint8Array');
        let i = 0;
        const n = bytes.length;
        total += n;
        if (fill) {
          const take = Math.min(64 - fill, n);
          buf.set(bytes.subarray(0, take), fill);
          fill += take;
          i = take;
          if (fill < 64) return api;
          block(h, w, buf, 0);
          fill = 0;
        }
        for (; i + 64 <= n; i += 64) block(h, w, bytes, i);
        if (i < n) { buf.set(bytes.subarray(i), 0); fill = n - i; }
        return api;
      },
      digest() {
        if (done) throw new Error('sha256: digest twice');
        done = true;
        const bits = total * 8;
        buf[fill++] = 0x80;
        if (fill > 56) { buf.fill(0, fill); block(h, w, buf, 0); fill = 0; }
        buf.fill(0, fill, 56);
        const hi = Math.floor(bits / 0x100000000), lo = bits >>> 0;
        buf[56] = hi >>> 24; buf[57] = hi >>> 16; buf[58] = hi >>> 8; buf[59] = hi;
        buf[60] = lo >>> 24; buf[61] = lo >>> 16; buf[62] = lo >>> 8; buf[63] = lo;
        block(h, w, buf, 0);
        const out = new Uint8Array(32);
        for (let j = 0; j < 8; j++) {
          out[4 * j] = h[j] >>> 24; out[4 * j + 1] = h[j] >>> 16; out[4 * j + 2] = h[j] >>> 8; out[4 * j + 3] = h[j];
        }
        return out;
      },
    };
    return api;
  }

  const HEX = '0123456789abcdef';

  // hex(bytes) → lowercase hex string.
  function hex(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += HEX[bytes[i] >> 4] + HEX[bytes[i] & 15];
    return s;
  }

  // sha256(bytes) → Uint8Array(32), in one call.
  function sha256(bytes) { return createSha256().update(bytes).digest(); }

  return { createSha256, sha256, hex };
});
