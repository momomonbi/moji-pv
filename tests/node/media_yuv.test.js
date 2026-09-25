/* 文字PVメーカー v2 — original work. Tests for media/yuv: the reduced RGBA copy of a YUV frame that the store blurs (DESIGN_2_1 §11.3.4, §11.4.6). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const Y = MV.use('media/yuv');

// Planes of a w × h 4:2:0 frame (smooth gradients plus a hard edge, so averages and clamps both show), as I420 in one
// buffer: { data, layout, w, h }. gap > 0 pads every row with `gap` bytes of 255 (a stride wider than the picture), and
// shift moves the whole buffer by that many bytes inside a larger one (not word-aligned: the byte-by-byte sums).
function i420(w, h, o) {
  const q = Object.assign({ gap: 0, shift: 0, seed: 1 }, o);
  const cw = (w + 1) >> 1, ch = (h + 1) >> 1;
  const ys = w + q.gap, cs = cw + q.gap;
  const size = ys * h + 2 * cs * ch;
  const buf = new Uint8Array(size + q.shift).fill(255);
  const data = buf.subarray(q.shift);
  const layout = [{ offset: 0, stride: ys }, { offset: ys * h, stride: cs }, { offset: ys * h + cs * ch, stride: cs }];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * ys + x] = x > w / 2 && y < h / 3 ? 235 : 16 + ((x * 3 + y * 5 + q.seed * 7) % 220);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      data[layout[1].offset + y * cs + x] = 64 + ((x * 5 + y * 2 + q.seed) % 128);
      data[layout[2].offset + y * cs + x] = 200 - ((x * 2 + y * 7 + q.seed) % 150);
    }
  }
  return { format: 'I420', data, layout, w, h };
}

// The same planes as NV12 (U and V interleaved in one plane).
function toNv12(src) {
  const { w, h } = src;
  const cw = (w + 1) >> 1, ch = (h + 1) >> 1;
  const data = new Uint8Array(w * h + 2 * cw * ch);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = src.data[src.layout[0].offset + y * src.layout[0].stride + x];
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      data[w * h + y * 2 * cw + 2 * x] = src.data[src.layout[1].offset + y * src.layout[1].stride + x];
      data[w * h + y * 2 * cw + 2 * x + 1] = src.data[src.layout[2].offset + y * src.layout[2].stride + x];
    }
  }
  return { format: 'NV12', data, layout: [{ offset: 0, stride: w }, { offset: w * h, stride: 2 * cw }], w, h };
}

// The reference: block averages in doubles, the matrix from Kr and Kb, rounded and clamped — per copy pixel.
function reference(src, b, matrix, full) {
  const [kr, kb] = { bt709: [0.2126, 0.0722], bt470bg: [0.299, 0.114], smpte170m: [0.299, 0.114] }[matrix];
  const kg = 1 - kr - kb;
  const { w, h, data, layout } = src;
  const cw = Math.ceil(w / b), ch = Math.ceil(h / b), pw = (w + 1) >> 1, ph = (h + 1) >> 1, hb = b / 2;
  const plane = (k, x, y) => data[layout[k].offset + y * layout[k].stride + x];
  const out = [];
  for (let oy = 0; oy < ch; oy++) {
    for (let ox = 0; ox < cw; ox++) {
      let sy = 0, ny = 0, su = 0, sv = 0, nc = 0;
      for (let y = oy * b; y < Math.min(h, oy * b + b); y++) for (let x = ox * b; x < Math.min(w, ox * b + b); x++) { sy += plane(0, x, y); ny++; }
      for (let y = oy * hb; y < Math.min(ph, oy * hb + hb); y++) {
        for (let x = ox * hb; x < Math.min(pw, ox * hb + hb); x++) { su += plane(1, x, y); sv += plane(2, x, y); nc++; }
      }
      const yy = full ? sy / ny : ((sy / ny - 16) * 255) / 219;
      const cs = full ? 1 : 255 / 224;
      const u = (su / nc - 128) * cs, v = (sv / nc - 128) * cs;
      const r = yy + 2 * (1 - kr) * v, bb = yy + 2 * (1 - kb) * u, g = yy - ((2 * kb * (1 - kb)) / kg) * u - ((2 * kr * (1 - kr)) / kg) * v;
      out.push([r, g, bb].map((c) => Math.max(0, Math.min(255, Math.round(c)))));
    }
  }
  return { out, cw, ch };
}

function pixel(r, x, y) { const i = 4 * ((y + r.pad) * r.w + x + r.pad); return Array.from(r.data.subarray(i, i + 4)); }

test('supports: 8-bit I420 and NV12 with a known SDR matrix; everything else is the browser\'s (the canvas route)', () => {
  const cs = { matrix: 'bt709', primaries: 'bt709', transfer: 'bt709', fullRange: false };
  assert.equal(Y.supports('I420', cs), true);
  assert.equal(Y.supports('NV12', cs), true);
  assert.equal(Y.supports('I420', { matrix: 'smpte170m' }), true);
  assert.equal(Y.supports('I420', { matrix: 'bt470bg', fullRange: true }), true);
  for (const f of ['I420A', 'I420P10', 'I422', 'I444', 'RGBA', 'BGRX', null, undefined]) assert.equal(Y.supports(f, cs), false, String(f));
  assert.equal(Y.supports('I420', { matrix: null }), false, 'an unknown matrix is the browser\'s to guess');
  assert.equal(Y.supports('I420', null), false);
  assert.equal(Y.supports('I420', { matrix: 'bt2020-ncl' }), false);
  assert.equal(Y.supports('I420', Object.assign({}, cs, { transfer: 'pq' })), false, 'HDR is tone-mapped by the browser');
  assert.equal(Y.supports('I420', Object.assign({}, cs, { transfer: 'hlg' })), false);
  assert.equal(Y.supports('I420', Object.assign({}, cs, { primaries: 'bt2020' })), false);
});

test('factorFor: the largest power of two ≤ 8 whose copy keeps a long side ≥ px / 4 (px / 8 from blur 8 px up)', () => {
  assert.equal(Y.factorFor(1920, 1472, 2), 4, '720p preview of a 1080p ground: 480 × 270');
  assert.equal(Y.factorFor(1920, 2208, 3), 2, '1080p export: 960 × 540');
  assert.equal(Y.factorFor(1920, 1472, 16), 8, 'a large blur: px / 8');
  assert.equal(Y.factorFor(1920, 100, 2), 8, 'at most 8');
  assert.equal(Y.factorFor(192, 1472, 2), 1, 'a small clip drawn large: the whole frame (the canvas route)');
  assert.equal(Y.factorFor(3840, 1472, 2), 8);
  for (let long = 64; long <= 4096; long += 97) {
    for (const px of [200, 700, 1472, 2208, 4416]) {
      for (const blur of [1, 3, 8, 20]) {
        const b = Y.factorFor(long, px, blur), need = blur >= 8 ? px / 8 : px / 4;
        assert.ok([1, 2, 4, 8].includes(b));
        if (b > 1) assert.ok(long / b >= need, 'long side ≥ need');
        if (b < 8 && long / b >= need) assert.ok(long / (2 * b) < need, 'the largest such b: [need, 2·need) ' + [long, px, blur, b]);
      }
    }
  }
});

test('sigmaFor: blur × copy px per device px, in 1/32 copy px and never 0; padFor: ceil(3σ) within the copy', () => {
  assert.equal(Y.sigmaFor(2, 1920, 4, 1472), 21 / 32, '2 px at 480 / 1472 copy px per device px = 0.652 → 0.65625');
  assert.equal(Y.sigmaFor(3, 1920, 2, 2208), Math.round(((3 * 960) / 2208) * 32) / 32);
  assert.equal(Y.sigmaFor(0.001, 1920, 8, 5000), 1 / 32, 'a blur never rounds to none');
  assert.equal(Y.padFor(21 / 32, 480, 270), 2);
  assert.equal(Y.padFor(10, 480, 270), 30);
  assert.equal(Y.padFor(10, 12, 8), 8, 'at most the shorter side');
});

test('toRgba: the box average and the matrix within 1 of a double-precision reference (bt709, bt601, limited and full range, b 2/4/8, odd sizes)', () => {
  for (const [w, h] of [[64, 36], [67, 35], [16, 8], [9, 5]]) {
    for (const b of [2, 4, 8]) {
      for (const [matrix, full] of [['bt709', false], ['bt709', true], ['bt470bg', false], ['smpte170m', true]]) {
        const src = i420(w, h, { seed: w + b });
        const r = Y.toRgba(src, { b, matrix, full, pad: 0 });
        const ref = reference(src, b, matrix, full);
        assert.equal(r.cw, ref.cw); assert.equal(r.ch, ref.ch);
        assert.equal(r.w, r.cw); assert.equal(r.h, r.ch);
        let worst = 0;
        for (let y = 0; y < r.ch; y++) {
          for (let x = 0; x < r.cw; x++) {
            const p = pixel(r, x, y), q = ref.out[y * r.cw + x];
            assert.equal(p[3], 255);
            for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(p[c] - q[c]));
          }
        }
        assert.ok(worst <= 1, [w, h, b, matrix, full, 'worst', worst].join(' '));
      }
    }
  }
});

test('toRgba: known colours (black, white, grey, pure red in bt709 and bt601), and the matrices differ where they should', () => {
  const flat = (yv, u, v, w = 8, h = 8) => {
    const s = i420(w, h);
    s.data.fill(yv, 0, s.layout[1].offset);
    s.data.fill(u, s.layout[1].offset, s.layout[2].offset);
    s.data.fill(v, s.layout[2].offset);
    return s;
  };
  const at = (src, matrix, full) => pixel(Y.toRgba(src, { b: 2, matrix, full, pad: 0 }), 0, 0).slice(0, 3);
  assert.deepEqual(at(flat(16, 128, 128), 'bt709', false), [0, 0, 0]);
  assert.deepEqual(at(flat(235, 128, 128), 'bt709', false), [255, 255, 255]);
  assert.deepEqual(at(flat(0, 128, 128), 'bt709', true), [0, 0, 0]);
  assert.deepEqual(at(flat(255, 128, 128), 'bt709', true), [255, 255, 255]);
  assert.deepEqual(at(flat(126, 128, 128), 'bt709', false), [128, 128, 128], '(126 − 16) · 255 / 219 = 128.08');
  const near = (got, want) => assert.ok(got.every((c, i) => Math.abs(c - want[i]) <= 2), JSON.stringify(got) + ' ≈ ' + JSON.stringify(want));
  near(at(flat(63, 102, 240), 'bt709', false), [255, 0, 0]);
  near(at(flat(81, 90, 240), 'bt470bg', false), [255, 0, 0]);
  near(at(flat(76, 85, 255), 'bt470bg', true), [255, 0, 0]);
  const green = flat(150, 60, 70);
  assert.notDeepEqual(at(green, 'bt709', false), at(green, 'bt470bg', false), 'bt709 and bt601 decode the same code differently');
  assert.deepEqual(at(green, 'smpte170m', false), at(green, 'bt470bg', false), 'smpte170m is bt601');
  assert.notDeepEqual(at(green, 'bt709', false), at(green, 'bt709', true), 'limited and full range differ');
});

test('toRgba: word-aligned and byte-by-byte sums agree exactly; the stride padding is never read; NV12 equals I420', () => {
  for (const [w, h] of [[64, 36], [67, 35], [40, 24]]) {
    for (const b of [2, 4, 8]) {
      const plain = Y.toRgba(i420(w, h), { b, matrix: 'bt709', full: false, pad: 2 });
      const shifted = Y.toRgba(i420(w, h, { shift: 1 }), { b, matrix: 'bt709', full: false, pad: 2 });
      const gapped = Y.toRgba(i420(w, h, { gap: 5 }), { b, matrix: 'bt709', full: false, pad: 2 });
      const gapped4 = Y.toRgba(i420(w, h, { gap: 4, shift: 4 }), { b, matrix: 'bt709', full: false, pad: 2 });
      const nv = Y.toRgba(toNv12(i420(w, h)), { b, matrix: 'bt709', full: false, pad: 2 });
      for (const [name, r] of [['unaligned', shifted], ['stride + 5', gapped], ['stride + 4', gapped4], ['NV12', nv]]) {
        assert.deepEqual(Array.from(r.data), Array.from(plain.data), [w, h, b, name].join(' '));
      }
    }
  }
});

test('toRgba: the visible rect of a larger coded frame (planes copied from an offset) equals the same picture on its own', () => {
  // coded 80 × 48 with the visible 64 × 36 at (8, 6): copyTo gives the visible rect's planes; a layout that points into
  // the coded planes at that offset must read exactly the same pixels
  const coded = i420(80, 48, { seed: 3 });
  const vis = i420(64, 36);
  for (let y = 0; y < 36; y++) for (let x = 0; x < 64; x++) vis.data[vis.layout[0].offset + y * 64 + x] = coded.data[(y + 6) * 80 + x + 8];
  for (let k = 1; k <= 2; k++) {
    for (let y = 0; y < 18; y++) for (let x = 0; x < 32; x++) vis.data[vis.layout[k].offset + y * 32 + x] = coded.data[coded.layout[k].offset + (y + 3) * 40 + x + 4];
  }
  const view = { format: 'I420', data: coded.data, w: 64, h: 36, layout: [{ offset: 6 * 80 + 8, stride: 80 },
    { offset: coded.layout[1].offset + 3 * 40 + 4, stride: 40 }, { offset: coded.layout[2].offset + 3 * 40 + 4, stride: 40 }] };
  for (const b of [2, 4, 8]) {
    assert.deepEqual(Array.from(Y.toRgba(view, { b, matrix: 'bt709', pad: 1 }).data), Array.from(Y.toRgba(vis, { b, matrix: 'bt709', pad: 1 }).data), 'b ' + b);
  }
});

test('toRgba: the border mirrors the copy (pixel −1 − k shows pixel k, corners both ways); out is reused when large enough', () => {
  const src = i420(67, 35);
  const pad = 3;
  const r = Y.toRgba(src, { b: 4, matrix: 'bt709', pad });
  assert.equal(r.w, r.cw + 2 * pad); assert.equal(r.h, r.ch + 2 * pad); assert.equal(r.pad, pad);
  const at = (x, y) => { const i = 4 * (y * r.w + x); return Array.from(r.data.subarray(i, i + 4)).join(','); };
  const mirror = (v, n) => (v < 0 ? -1 - v : v >= n ? 2 * n - 1 - v : v);
  for (let y = -pad; y < r.ch + pad; y++) {
    for (let x = -pad; x < r.cw + pad; x++) assert.equal(at(x + pad, y + pad), at(mirror(x, r.cw) + pad, mirror(y, r.ch) + pad), x + ',' + y);
  }
  const big = new Uint8ClampedArray(r.data.length + 400).fill(7);
  const again = Y.toRgba(src, { b: 4, matrix: 'bt709', pad, out: big });
  assert.equal(again.data.buffer, big.buffer, 'written into the given buffer');
  assert.deepEqual(Array.from(again.data), Array.from(r.data), 'and the same bytes');
  assert.deepEqual(Array.from(Y.toRgba(src, { b: 4, matrix: 'bt709', pad }).data), Array.from(r.data), 'a pure function');
  assert.throws(() => Y.toRgba(src, { b: 1, matrix: 'bt709' }), /b must be/);
  assert.throws(() => Y.toRgba(Object.assign({}, src, { format: 'RGBA' }), { b: 2, matrix: 'bt709' }), /format/);
});
