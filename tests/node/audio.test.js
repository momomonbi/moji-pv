/* 文字PVメーカー v2 — original work. Tests for audio/* (DESIGN §8.2 audio.test.js): FFT, analysis, digest, level, WAV, peaks. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { load } = require('../helpers/load.js');
const { approx, throwsCode } = require('../helpers/assert_plus.js');

const MV = load();
const FFT = MV.use('audio/fft');
const A = MV.use('audio/analyze');
const D = MV.use('audio/digest');
const W = MV.use('audio/wav');
const P = MV.use('audio/peaks');
const rng = MV.use('core/rng');
const docs = MV.use('core/doc');

// --- signals -------------------------------------------------------------------------------------------------------

// A click track: a short decaying noise burst on every beat (every fourth one louder), over quiet noise.
function clickTrack({ bpm, offset, seconds = 16, rate = 44100, channels = 2, seed = 1 }) {
  const n = Math.round(seconds * rate);
  const noise = rng.stream('click', seed);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (noise.next() - 0.5) * 0.004;
  const period = 60 / bpm;
  const burst = Math.round(0.03 * rate);
  for (let k = 0, t = offset; t < seconds; k++, t = offset + k * period) {
    const start = Math.round(t * rate);
    const amp = k % 4 === 0 ? 0.9 : 0.6;
    for (let i = 0; i < burst && start + i < n; i++) {
      mono[start + i] += amp * (noise.next() * 2 - 1) * Math.exp(-i / (0.004 * rate));
    }
  }
  const out = [];
  for (let c = 0; c < channels; c++) out.push(Float32Array.from(mono));
  return out;
}

// Noise-burst clicks at random intervals of 0.1–1.0 s: onsets with no beat.
function randomClicks({ seconds = 30, rate = 22050, seed = 1 }) {
  const n = Math.round(seconds * rate);
  const s = rng.stream('random-clicks', seed);
  const mono = new Float32Array(n);
  for (let i = 0; i < n; i++) mono[i] = (s.next() - 0.5) * 0.004;
  for (let t = 0.2; t < seconds; t += s.range(0.1, 1.0)) {
    const start = Math.round(t * rate);
    for (let i = 0; i < 0.03 * rate && start + i < n; i++) mono[start + i] += 0.7 * (s.next() * 2 - 1) * Math.exp(-i / (0.004 * rate));
  }
  return [mono];
}

// Onset strength of a click track straight at 100 Hz: each click split between the two frames around its exact time
// (so the beat period is rarely a whole number of frames), with a short tail; every fourth click is accented.
function clickStrength(bpm, offset, seconds, hz = 100) {
  const s = new Float32Array(seconds * hz);
  const add = (x, w) => {
    const j = Math.floor(x), f = x - j;
    if (j < s.length) s[j] += w * (1 - f);
    if (j + 1 < s.length) s[j + 1] += w * f;
  };
  for (let k = 0; offset + (k * 60) / bpm < seconds; k++) {
    const x = (offset + (k * 60) / bpm) * hz;
    const w = k % 4 === 0 ? 1 : 0.7;
    add(x, w); add(x + 1, 0.4 * w); add(x + 2, 0.15 * w);
  }
  return s.map((v) => Math.min(1, v));
}

function sine(seconds, rate, freq, amp) {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
  return out;
}

function circularDiff(a, b, period) {
  const d = Math.abs(a - b) % period;
  return Math.min(d, period - d);
}

// --- FFT -------------------------------------------------------------------------------------------------------------

function naiveDft(re, im) {
  const n = re.length;
  const outRe = new Float64Array(n), outIm = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      const a = (-2 * Math.PI * j * k) / n;
      outRe[k] += re[j] * Math.cos(a) - im[j] * Math.sin(a);
      outIm[k] += re[j] * Math.sin(a) + im[j] * Math.cos(a);
    }
  }
  return [outRe, outIm];
}

test('fft: complex forward transform equals a naive DFT; inverse restores the input', () => {
  const s = rng.stream('fft', 7);
  const n = 64;
  const re = Float64Array.from({ length: n }, () => s.range(-1, 1));
  const im = Float64Array.from({ length: n }, () => s.range(-1, 1));
  const [wantRe, wantIm] = naiveDft(re, im);
  const f = FFT.createFFT(n);
  const r = Float64Array.from(re), i = Float64Array.from(im);
  f.forward(r, i);
  approx(Array.from(r), Array.from(wantRe), 1e-9);
  approx(Array.from(i), Array.from(wantIm), 1e-9);
  f.inverse(r, i);
  approx(Array.from(r), Array.from(re), 1e-12);
  approx(Array.from(i), Array.from(im), 1e-12);
});

test('fft: real magnitudes equal |DFT| for bins 0..n/2; a sine peaks at its bin', () => {
  const s = rng.stream('rfft', 3);
  const n = 256;
  const x = Float64Array.from({ length: n }, () => s.range(-1, 1));
  const [wr, wi] = naiveDft(x, new Float64Array(n));
  const real = FFT.createRealFFT(n);
  assert.equal(real.bins, n / 2 + 1);
  const mags = real.magnitudes(x, new Float64Array(real.bins));
  for (let k = 0; k <= n / 2; k++) approx(mags[k], Math.hypot(wr[k], wi[k]), 1e-9, 'bin ' + k);
  const tone = Float64Array.from({ length: n }, (_, j) => Math.cos((2 * Math.PI * 10 * j) / n));
  const tm = real.magnitudes(tone, new Float64Array(real.bins));
  let peak = 0;
  for (let k = 1; k < tm.length; k++) if (tm[k] > tm[peak]) peak = k;
  assert.equal(peak, 10);
  approx(tm[10], n / 2, 1e-9);
});

test('fft: sizes must be powers of 2', () => {
  throwsCode(() => FFT.createFFT(12), 'size');
  throwsCode(() => FFT.createRealFFT(2), 'size');
  assert.equal(FFT.isPow2(1024), true);
  assert.equal(FFT.isPow2(1000), false);
});

// --- analysis --------------------------------------------------------------------------------------------------------

for (const [bpm, offset] of [[90, 0.21], [128, 0.35], [174, 0.1]]) {
  test(`analyze: a ${bpm} BPM click track gives bpm ±1 and offset within 20 ms`, () => {
    const channels = clickTrack({ bpm, offset, seed: bpm });
    const r = A.analyzeSync(channels, 44100);
    assert.ok(r.bpm !== null, 'a tempo is found');
    assert.ok(Math.abs(r.bpm - bpm) <= 1, `bpm ${r.bpm} vs ${bpm}`);
    const period = 60 / bpm;
    const off = circularDiff(r.offset, offset % period, period);
    assert.ok(off <= 0.02, `offset ${r.offset} vs ${offset} (off by ${off})`);
    assert.ok(r.offset >= 0 && r.offset < 60 / r.bpm, 'offset is the first beat, inside one period');
    assert.ok(r.bpmConfidence > 0.5, 'confidence ' + r.bpmConfidence);
    assert.equal(r.meter, 4);
  });
}

// Beat periods that are not whole 10 ms frames (180 BPM = 33.3 frames) once scored below their whole-frame third
// (60 BPM = 100 frames) and came out at a third of the tempo.
for (const [bpm, offset] of [[180, 0.12], [183, 0.05], [195, 0.27], [198, 0.2]]) {
  test(`analyze: a ${bpm} BPM click track is not read as a third of it`, () => {
    const r = A.analyzeSync(clickTrack({ bpm, offset, seconds: 16, rate: 22050, channels: 1, seed: bpm }), 22050);
    assert.ok(r.bpm !== null && Math.abs(r.bpm - bpm) <= 1, `bpm ${r.bpm} vs ${bpm}`);
    const period = 60 / bpm;
    assert.ok(circularDiff(r.offset, offset % period, period) <= 0.02, `offset ${r.offset} vs ${offset}`);
    assert.ok(r.bpmConfidence > 0.5, 'confidence ' + r.bpmConfidence);
  });
}

test('estimateTempo: a 1-BPM sweep over 60–200 finds every tempo and its first beat', () => {
  const misses = [];
  for (let bpm = A.BPM_MIN; bpm <= A.BPM_MAX; bpm++) {
    const period = 60 / bpm;
    const offset = (((bpm * 37) % 100) / 100) * period;
    const r = A.estimateTempo(clickStrength(bpm, offset, 16), 100);
    const ok = r.bpm !== null && Math.abs(r.bpm - bpm) <= 1 && circularDiff(r.offset, offset, period) <= 0.02;
    if (!ok) misses.push(`${bpm} → ${r.bpm && r.bpm.toFixed(2)} @ ${r.offset.toFixed(3)}`);
  }
  assert.deepEqual(misses, []);
});

test('analyze: a steady tone has no onsets and no tempo', () => {
  const r = A.analyzeSync([sine(20, 44100, 440, 0.5)], 44100);   // a 441-sample hop never lines up with the sine
  assert.equal(r.bpm, null);
  const sorted = Float32Array.from(r.onset.strength).sort();
  assert.ok(sorted[Math.floor(sorted.length * 0.99)] < 0.05, 'strength stays near 0: ' + sorted[Math.floor(sorted.length * 0.99)]);
});

test('analyze: clicks at random intervals have no tempo', () => {
  for (const seed of [1, 2, 3]) {
    const r = A.analyzeSync(randomClicks({ seed }), 22050);
    assert.equal(r.bpm, null, `seed ${seed}: bpm ${r.bpm} (confidence ${r.bpmConfidence})`);
    assert.ok(r.bpmConfidence < 0.15);
  }
});

test('analyze: a quiet click track (−30 dB) keeps its tempo', () => {
  const quiet = clickTrack({ bpm: 132, offset: 0.1, seconds: 12, rate: 22050, channels: 1, seed: 4 }).map((c) => c.map((v) => v * 0.03));
  const r = A.analyzeSync(quiet, 22050);
  assert.ok(r.bpm !== null && Math.abs(r.bpm - 132) <= 1, 'bpm ' + r.bpm);
});

test('analyze: the tempo does not depend on the sample rate or the channel count', () => {
  const r = A.analyzeSync(clickTrack({ bpm: 128, offset: 0.2, rate: 48000, channels: 1, seed: 5 }), 48000);
  assert.ok(Math.abs(r.bpm - 128) <= 1, 'bpm ' + r.bpm);
  assert.ok(circularDiff(r.offset, 0.2, 60 / 128) <= 0.02, 'offset ' + r.offset);
});

test('analyze: output shape, 100 Hz arrays and the loudness mapping', () => {
  const rate = 8000;
  const full = sine(1, rate, 440, 1);
  const quiet = sine(1, rate, 440, 0.5);
  const silence = new Float32Array(rate);
  const mono = new Float32Array(3 * rate);
  mono.set(full, 0); mono.set(quiet, rate); mono.set(silence, 2 * rate);
  const r = A.analyzeSync([mono], rate);
  assert.equal(r.duration, 3);
  assert.equal(r.env.hz, 100);
  assert.equal(r.onset.hz, 100);
  assert.ok(r.env.loud instanceof Float32Array && r.onset.strength instanceof Float32Array);
  assert.equal(r.env.loud.length, 300);
  assert.equal(r.onset.strength.length, 300);
  approx(r.env.loud[50], (-3.0103 + 60) / 60, 0.002, 'full-scale sine ≈ −3 dB');
  approx(r.env.loud[150], (-9.0309 + 60) / 60, 0.002, 'half-scale sine ≈ −9 dB');
  assert.equal(r.env.loud[250], 0, 'silence');
  for (const v of r.onset.strength) assert.ok(v >= 0 && v <= 1);
  approx(A.dbToUnit(1), 1, 1e-12);
  approx(A.dbToUnit(1e-6), 0, 1e-12);
  assert.equal(A.dbToUnit(0), 0);
});

test('analyze: silence and very short clips have no tempo', () => {
  const silent = A.analyzeSync([new Float32Array(44100 * 4)], 44100);
  assert.equal(silent.bpm, null);
  assert.equal(silent.bpmConfidence, 0);
  assert.equal(silent.offset, 0);
  const short = A.analyzeSync(clickTrack({ bpm: 120, offset: 0, seconds: 1 }), 44100);
  assert.equal(short.bpm, null);
  const empty = A.analyzeSync([new Float32Array(0)], 44100);
  assert.equal(empty.duration, 0);
  assert.equal(empty.env.loud.length, 0);
});

test('analyze: the generator yields increasing progress in [0, 1] every `step` frames', () => {
  const gen = A.analyze(clickTrack({ bpm: 100, offset: 0, seconds: 5, rate: 8000, channels: 1 }), 8000, { step: 100 });
  const seen = [];
  let r;
  while (!(r = gen.next()).done) seen.push(r.value);
  assert.ok(seen.length >= 4, 'yields several times: ' + seen.length);
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1]);
  for (const p of seen) assert.ok(p >= 0 && p <= 1);
  assert.equal(r.value.env.loud.length, 500);
  throwsCode(() => A.analyze([], 44100).next(), 'input');
  throwsCode(() => A.analyze([[0, 1]], 44100).next(), 'input');
  throwsCode(() => A.analyze([new Float32Array(4)], 0).next(), 'input');
});

test('analyze: the same input gives the same analysis twice', () => {
  const channels = clickTrack({ bpm: 140, offset: 0.05, seconds: 8, seed: 9 });
  const a = A.analyzeSync(channels, 44100);
  const b = A.analyzeSync(channels, 44100);
  assert.equal(a.bpm, b.bpm);
  assert.equal(a.offset, b.offset);
  assert.deepEqual(Array.from(a.onset.strength), Array.from(b.onset.strength));
});

test('estimateTempo: impulses on a grid (off-beats weaker) give that grid', () => {
  const hz = 100, bpm = 150, n = 3000;
  const s = new Float32Array(n);
  const period = (60 * hz) / bpm;
  for (let k = 0; k * period + 17 < n; k++) s[Math.round(k * period + 17)] = 1;
  for (let k = 0; k * period + 17 + period / 2 < n; k++) s[Math.round(k * period + 17 + period / 2)] = 0.2;
  const r = A.estimateTempo(s, hz);
  assert.ok(Math.abs(r.bpm - bpm) <= 1, 'bpm ' + r.bpm);
  assert.ok(circularDiff(r.offset, 0.17, 0.4) <= 0.02, 'offset ' + r.offset);
});

// --- digest and level ----------------------------------------------------------------------------------------------

test('digest: 20 Hz max-pooled bytes, base64, and the envelope round trip', () => {
  const loud = Float32Array.from({ length: 23 }, (_, i) => (i % 7) / 6);
  const analysis = { env: { hz: 100, loud }, duration: 0.23 };
  const d = D.digest(analysis);
  assert.equal(d.hz, 20);
  const bytes = D.fromBase64(d.loud);
  assert.equal(bytes.length, 5, 'ceil(23 / 5) frames');
  const env = D.envFromDigest(d);
  assert.equal(env.hz, 20);
  for (let j = 0; j < 5; j++) {
    const pooled = Math.max(...loud.slice(5 * j, 5 * j + 5));
    approx(env.loud[j], pooled, 0.5 / 255 + 1e-7, 'frame ' + j);
  }
  const again = D.digest({ env: { hz: 20, loud: env.loud } });
  assert.equal(again.loud, d.loud, '20 Hz input is stored unchanged');
});

test('digest: base64 matches the standard encoding', () => {
  for (const len of [0, 1, 2, 3, 4, 5, 64, 257]) {
    const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255);
    const text = D.toBase64(bytes);
    assert.equal(text, Buffer.from(bytes).toString('base64'));
    assert.deepEqual(Array.from(D.fromBase64(text)), Array.from(bytes));
  }
  throwsCode(() => D.fromBase64('ab$c'), 'format');
  throwsCode(() => D.envFromDigest({ hz: 20 }), 'format');
});

test('digest: the song_digest fixture decodes to a 20 Hz envelope of the song length', () => {
  const song = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'song_digest.json'), 'utf8'));
  const env = D.envFromDigest(song.digest);
  assert.equal(env.hz, 20);
  assert.equal(env.loud.length, song.seconds * 20);
  for (const v of env.loud) assert.ok(v >= 0 && v <= 1);
});

test('level: linear interpolation between window centres, silence outside, 0.5 without a song', () => {
  const env = { hz: 20, loud: Float32Array.from([0, 1, 0.5]) };
  assert.equal(D.level(null, 3), 0.5);
  approx(D.level(env, 0.5 / 20), 0, 1e-7);
  approx(D.level(env, 1.5 / 20), 1, 1e-7);
  approx(D.level(env, 1 / 20), 0.5, 1e-7, 'half way between samples 0 and 1');
  approx(D.level(env, 2 / 20), 0.75, 1e-7);
  approx(D.level(env, 0.01), 0, 1e-7, 'before the first centre: the first sample');
  approx(D.level(env, 2.9 / 20), 0.5, 1e-7, 'after the last centre: the last sample');
  assert.equal(D.level(env, 3 / 20), 0, 'after the end');
  assert.equal(D.level(env, -0.1), 0, 'before the start');
  assert.equal(D.level({ hz: 20, loud: new Float32Array(0) }, 0), 0);
  const t = 0.0731;
  assert.equal(D.level(env, t), D.level(env, t), 'closed form');
});

test('songRecord: a valid doc.song with a digest the planner can read', () => {
  const r = A.analyzeSync(clickTrack({ bpm: 120, offset: 0.25, seconds: 6, seed: 2 }), 44100);
  const song = D.songRecord({ name: 'demo.wav', sha1: 'ab'.repeat(20) }, r);
  const doc = docs.defaultDoc();
  doc.song = song;
  assert.deepEqual(docs.validate(doc), []);
  assert.equal(song.seconds, 6);
  assert.equal(song.meter, 4);
  assert.equal(song.info, null);
  assert.ok(Math.abs(song.bpm - 120) <= 1);
  assert.equal(D.envFromDigest(song.digest).loud.length, 120);
  const unknown = D.songRecord({ name: 'x', sha1: 'y' }, Object.assign({}, r, { bpm: null }));
  assert.equal(unknown.bpm, null);
});

// --- WAV -------------------------------------------------------------------------------------------------------------

// SHA-256 of the exact bytes for fixed inputs: resampling, the level lift, clipping and the header must not drift.
test('encodeWav: bytes are pinned for fixed inputs', () => {
  const s = rng.stream('wav', 1);
  const noisy = (n, amp) => Float32Array.from({ length: n }, () => s.range(-amp, amp));
  const cases = [
    { name: 'stereo 44.1k → 16k', channels: [noisy(44100, 0.9), noisy(44100, 0.9)], rate: 44100, out: 16000,
      length: 32044, sha256: '8909e73382ccfd8ce734ec6295dd43cf0f30b8fb53dddaf9ab9da1b877eb1999' },
    { name: 'mono 48k → 12k', channels: [noisy(24000, 0.7)], rate: 48000, out: 12000,
      length: 12044, sha256: '46d4e73510b8c5e540099ea5411459df50934361589cb4f66ceeac47edb68090' },
    { name: 'quiet (lifted)', channels: [noisy(8000, 0.05), noisy(8000, 0.02)], rate: 22050, out: 16000,
      length: 11652, sha256: '33c045a4e4f87f0576b261bc828a829f28015b8f0dd2eceeef03bb4a8abe115c' },
    { name: 'over full scale (clipped)', channels: [noisy(5000, 1.8)], rate: 16000, out: 16000,
      length: 10044, sha256: 'e87f2f6227c4a69b71db8ee52abd32d0ec823ffaa5faab238f53f1c64387f10d' },
    { name: 'default rate', channels: [noisy(3000, 0.6)], rate: 44100,
      length: 2220, sha256: 'd8f6ea88bf61ea9ce72a8a8f1cf91d391ad9061e7bbdad1febb6e0239935f47d' },
    { name: 'upsampling', channels: [noisy(1000, 0.6)], rate: 8000, out: 16000,
      length: 4044, sha256: 'b7c3d148a1362202bef23590d0a00aa8798740f81d091a4fc59eb002054c59fd' },
    { name: 'silence', channels: [new Float32Array(2000)], rate: 44100, out: 8000,
      length: 768, sha256: 'b2d8ba774d1015b2b938f1524b8330d5d2730a7230b626bbbed6f408f06badd3' },
    { name: 'empty', channels: [new Float32Array(0)], rate: 44100, out: 16000,
      length: 44, sha256: 'ba584a378b11d9e9c98736fd8c256fe1453a84ee4139416d24b07acff424f0fb' },
  ];
  for (const c of cases) {
    const bytes = c.out === undefined ? W.encodeWav(c.channels, c.rate) : W.encodeWav(c.channels, c.rate, c.out);
    assert.ok(bytes instanceof Uint8Array, c.name);
    assert.equal(bytes.length, c.length, c.name + ': length');
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), c.sha256, c.name + ': bytes');
  }
});

test('encodeWav: header fields and size', () => {
  const bytes = W.encodeWav([new Float32Array(32000)], 32000);
  const view = new DataView(bytes.buffer);
  const ascii = (o, n) => String.fromCharCode(...bytes.subarray(o, o + n));
  assert.equal(ascii(0, 4), 'RIFF');
  assert.equal(ascii(8, 8), 'WAVEfmt ');
  assert.equal(ascii(36, 4), 'data');
  assert.equal(view.getUint32(24, true), W.DEFAULT_RATE);
  assert.equal(view.getUint32(40, true), 16000 * 2);
  assert.equal(bytes.length, 44 + 16000 * 2);
});

// --- peaks -----------------------------------------------------------------------------------------------------------

test('peaks: min/max per window over all channels, a halving mip chain, levelFor', () => {
  const rate = 8000;
  const a = sine(2, rate, 3, 0.8);
  const b = sine(2, rate, 5, 0.3);
  const p = P.peaks([a, b], rate, { base: 64, minLength: 16 });
  assert.equal(p.rate, rate);
  assert.equal(p.levels[0].spp, 64);
  assert.equal(p.levels[0].min.length, Math.ceil(16000 / 64));
  for (let l = 1; l < p.levels.length; l++) {
    assert.equal(p.levels[l].spp, 2 * p.levels[l - 1].spp);
    assert.equal(p.levels[l].min.length, Math.ceil(p.levels[l - 1].min.length / 2));
  }
  assert.ok(p.levels[p.levels.length - 1].min.length <= 16);
  for (const level of p.levels) {
    for (const idx of [0, 3, level.min.length - 1]) {
      const from = idx * level.spp, to = Math.min(16000, from + level.spp);
      let lo = Infinity, hi = -Infinity;
      for (const ch of [a, b]) for (let i = from; i < to; i++) { lo = Math.min(lo, ch[i]); hi = Math.max(hi, ch[i]); }
      assert.equal(level.min[idx], lo, `level ${level.spp} min[${idx}]`);
      assert.equal(level.max[idx], hi, `level ${level.spp} max[${idx}]`);
    }
  }
  assert.equal(P.levelFor(p, 10).spp, 64, 'finer than the finest level → the finest');
  assert.equal(P.levelFor(p, 300).spp, 256);
  assert.equal(P.levelFor(p, 1e9), p.levels[p.levels.length - 1]);
  const none = P.peaks([new Float32Array(0)], rate);
  assert.equal(none.levels.length, 1);
  assert.equal(none.levels[0].min.length, 0);
});
