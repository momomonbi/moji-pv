/* 文字PVメーカー v2 — original work. Tests for media/palette (DESIGN_2_1 §11.6.3, §11.8.2 media_palette.test.js). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const P = MV.use('media/palette');
const rng = MV.use('core/rng');

// CIELAB (D65) ΔE*76, the usual "just noticeable" scale: ΔE < 2 is hard to tell apart.
function lab(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const X = (0.4124 * v[0] + 0.3576 * v[1] + 0.1805 * v[2]) / 0.95047;
  const Y = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  const Z = (0.0193 * v[0] + 0.1192 * v[1] + 0.9505 * v[2]) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
function deltaE(a, b) { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); }

const BANDS = [['#1D3557', 22], ['#E63946', 16], ['#F1FAEE', 12], ['#A8DADC', 9], ['#E9C46A', 5]];   // colour, band width (px)

// A 64×64 image of vertical bands, optionally with ±noise per channel, and an optional transparent margin.
function bands(noise, transparentRows) {
  const img = new Uint8ClampedArray(64 * 64 * 4);
  const s = rng.stream('palette-noise', noise);
  for (let y = 0; y < 64; y++) {
    let x = 0;
    for (const [hex, width] of BANDS) {
      const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      for (let k = 0; k < width; k++, x++) {
        const p = 4 * (y * 64 + x);
        for (let c = 0; c < 3; c++) img[p + c] = rgb[c] + (noise ? s.int(-noise, noise) : 0);
        img[p + 3] = y < (transparentRows || 0) ? 0 : 255;
        if (y < (transparentRows || 0)) { img[p] = 0; img[p + 1] = 255; img[p + 2] = 0; }   // green, but invisible
      }
    }
  }
  return img;
}

test('dominant: the 5 colours of a 5-band image, within ΔE < 2, heaviest first', () => {
  for (const noise of [0, 3]) {
    const got = P.dominant(bands(noise), 64, 64, { k: 5 });
    assert.equal(got.length, 5, 'noise ' + noise + ': ' + got);
    BANDS.forEach(([hex], i) => assert.ok(deltaE(got[i], hex) < 2, `noise ${noise}: ${got[i]} vs ${hex} (ΔE ${deltaE(got[i], hex).toFixed(2)})`));
    for (const hex of got) assert.match(hex, /^#[0-9A-F]{6}$/);
  }
});

test('dominant: deterministic (same bytes, same answer; the seed comes from the pixels)', () => {
  const img = bands(3);
  const a = P.dominant(img, 64, 64, { k: 5 });
  for (let k = 0; k < 3; k++) assert.deepEqual(P.dominant(new Uint8ClampedArray(img), 64, 64, { k: 5 }), a);
  assert.deepEqual(P.dominant(Uint8Array.from(img), 64, 64), a, 'k defaults to 5; Uint8Array input works too');
  const s = rng.stream('palette-photo', 1);
  const photo = Uint8ClampedArray.from({ length: 64 * 64 * 4 }, (_, i) => (i % 4 === 3 ? 255 : s.int(0, 255)));
  assert.deepEqual(P.dominant(photo, 64, 64, { k: 5 }), P.dominant(photo, 64, 64, { k: 5 }), 'random pixels, twice');
  assert.equal(P.dominant(photo, 64, 64, { k: 5 }).length, 5);
});

test('dominant: pixels count by their alpha — a faint colour over most of the image is not the dominant one', () => {
  const img = bands(0);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      if (y >= 20) { const p = 4 * (y * 64 + x); img[p] = 0; img[p + 1] = 255; img[p + 2] = 0; img[p + 3] = 20; }   // faint green
    }
  }
  const got = P.dominant(img, 64, 64, { k: 6 });
  assert.ok(deltaE(got[0], '#1D3557') < 2, 'the heaviest colour is the widest opaque band: ' + got);
  assert.ok(!got.slice(0, 3).some((hex) => deltaE(hex, '#00FF00') < 10), 'faint green is not among the top three: ' + got);
});

test('dominant: transparent pixels do not count; fewer colours than k; nothing visible', () => {
  const got = P.dominant(bands(0, 40), 64, 64, { k: 5 });
  assert.ok(got.every((hex) => deltaE(hex, '#00FF00') > 20), 'the invisible green is never picked: ' + got);
  const flat = new Uint8ClampedArray(64 * 64 * 4);
  for (let p = 0; p < 64 * 64; p++) flat.set([200, 100, 50, 255], 4 * p);
  assert.deepEqual(P.dominant(flat, 64, 64, { k: 5 }), ['#C86432'], 'one colour → one entry');
  assert.deepEqual(P.dominant(new Uint8ClampedArray(64 * 64 * 4), 64, 64), [], 'fully transparent → none');
  const two = P.dominant(bands(0).slice(0, 64 * 4 * 4), 64, 4, { k: 1 });
  assert.equal(two.length, 1, 'k = 1');
});
