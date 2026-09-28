/* 文字PVメーカー v2 — original work. A deterministic synthetic song for the voice and draft tests (PV22 S1, DESIGN_2_2 §5):
   centred sung phrases (4–13 syllables with consonant bursts and vibrato) over a centred kick, snare and bass, hats that
   alternate sides and a wide detuned pad. Dependency-free: `module.exports` in Node, `globalThis.__songGen` in a page
   (tests/browser/ui_flows.py injects it with page.add_init_script). */
(function (root) {
  'use strict';

  // mulberry32: a small seeded generator (never Math.random, so every run makes the same song)
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // song(opts) → { channels: [Float32Array L, Float32Array R], rate, phrases: [{ start, end, syl }], bpm }
  //   seconds, rate, bpm, seed; vocal / acc: the voice and accompaniment levels; pan: −1 … 1 (0 = centred voice);
  //   reverb: feedback of a 43 ms comb on the voice; gapMin / gapMax: the pause between phrases (s); legato: 1 = no
  //   dips between syllables. The voice starts 4–6 s in and stops 4 s before the end.
  function song(opts) {
    const o = Object.assign({ seconds: 60, rate: 48000, bpm: 120, seed: 1, vocal: 0.25, acc: 0.2, pan: 0, reverb: 0,
      gapMin: 0.3, gapMax: 1.2, legato: 0 }, opts || {});
    const { seconds, rate, bpm, vocal, acc, pan, reverb, gapMin, gapMax, legato } = o;
    const R = rng(o.seed);
    const n = Math.floor(seconds * rate);
    const L = new Float32Array(n), Rr = new Float32Array(n);
    const beat = 60 / bpm;
    // drums: kick on every beat (centre), snare on 2 and 4 (centre, noise), hats on the off-beats (alternating sides)
    for (let b = 0; b * beat < seconds; b++) {
      const t0 = Math.floor(b * beat * rate);
      for (let i = 0; i < 0.15 * rate && t0 + i < n; i++) {
        const tt = i / rate;
        const v = acc * 1.2 * Math.sin(2 * Math.PI * (50 + 60 * Math.exp(-tt * 30)) * tt) * Math.exp(-tt * 18);
        L[t0 + i] += v; Rr[t0 + i] += v;
      }
      if (b % 2 === 1) {
        for (let i = 0; i < 0.12 * rate && t0 + i < n; i++) {
          const v = acc * 0.8 * (R() * 2 - 1) * Math.exp(-i / rate * 25);
          L[t0 + i] += v; Rr[t0 + i] += v;
        }
      }
      const th = Math.floor((b + 0.5) * beat * rate);
      for (let i = 0; i < 0.04 * rate && th + i < n; i++) {
        const v = acc * 0.3 * (R() * 2 - 1) * Math.exp(-i / rate * 80);
        if (b % 2) L[th + i] += v; else Rr[th + i] += v;
      }
    }
    // bass: centre, one note per beat
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const b = Math.floor(i / rate / beat);
      const f = [55, 55, 73.4, 65.4][b % 4];
      ph += 2 * Math.PI * f / rate;
      const env = 0.6 + 0.4 * Math.exp(-((i / rate) % beat) * 6);
      const v = acc * 0.7 * Math.sin(ph) * env;
      L[i] += v; Rr[i] += v;
    }
    // pad: wide (slightly different voicings left and right), one chord per bar
    const chords = [[220, 277, 330], [196, 247, 294], [175, 220, 262], [196, 247, 311]];
    const pl = [0, 0, 0], pr = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const bar = Math.floor(i / rate / (4 * beat));
      const c = chords[bar % 4];
      let l = 0, r = 0;
      for (let k = 0; k < 3; k++) {
        pl[k] += 2 * Math.PI * c[k] / rate;
        pr[k] += 2 * Math.PI * c[k] * 1.004 / rate;
        l += Math.sin(pl[k]) + 0.3 * Math.sin(2 * pl[k]);
        r += Math.sin(pr[k] + k) + 0.3 * Math.sin(2 * pr[k]);
      }
      L[i] += acc * 0.25 * l; Rr[i] += acc * 0.25 * r;
    }
    // the sung phrases: harmonics shaped by two formants, a consonant burst on most syllables, 5.5 Hz vibrato
    const phrases = [];
    let t = 4 + R() * 2;
    const V = new Float32Array(n);
    while (t < seconds - 4) {
      const syl = 4 + Math.floor(R() * 10);
      const start = t;
      let vp = 0;
      for (let s = 0; s < syl; s++) {
        const d = 0.16 + R() * 0.22;
        const f0 = 180 + R() * 170;
        const a = Math.floor(t * rate), bnd = Math.floor((t + d) * rate);
        if (R() < 0.7) for (let i = a; i < a + 0.03 * rate && i < n; i++) V[i] += 0.25 * (R() * 2 - 1) * (1 - (i - a) / (0.03 * rate));
        for (let i = a; i < bnd && i < n; i++) {
          const tt = (i - a) / rate;
          const env = Math.min(1, tt / 0.02) * Math.min(1, (bnd - i) / rate / (legato ? 0.01 : 0.03)) * (legato ? 1 : 0.9);
          vp += 2 * Math.PI * f0 * (1 + 0.01 * Math.sin(2 * Math.PI * 5.5 * (i / rate))) / rate;
          let v = 0;
          for (let hh = 1; hh <= 14; hh++) {
            const fh = f0 * hh;
            const form = Math.exp(-Math.pow((fh - 700) / 500, 2)) + 0.6 * Math.exp(-Math.pow((fh - 2200) / 700, 2)) + 0.1;
            v += form * Math.sin(hh * vp) / hh;
          }
          V[i] += env * v;
        }
        t += d;
      }
      phrases.push({ start, end: t, syl });
      t += gapMin + R() * (gapMax - gapMin);
    }
    if (reverb > 0) {
      const dl = Math.floor(0.043 * rate);
      for (let i = dl; i < n; i++) V[i] += reverb * V[i - dl];
    }
    const gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    for (let i = 0; i < n; i++) { L[i] += vocal * V[i] * gl * Math.SQRT2; Rr[i] += vocal * V[i] * gr * Math.SQRT2; }
    return { channels: [L, Rr], rate, phrases, bpm };
  }

  const api = { song, rng };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__songGen = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
