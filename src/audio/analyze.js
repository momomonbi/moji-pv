/* 文字PVメーカー v2 — original work. Song analysis: loudness envelope, onset strength, tempo and beat offset (DESIGN §4.13). */
MV.def('audio/analyze', ['audio/fft'], (fft) => {
  'use strict';

  const HZ = 100;                  // envelope and onset frames per second (hop 10 ms)
  const WIN = 1024;                // onset FFT window in samples
  const DB_FLOOR = -60;            // −60 dB → 0, 0 dB → 1
  const COMPRESS = 1000;           // log(1 + C·|X|) before the spectral flux, so quiet onsets still count
  const BPM_MIN = 60;
  const BPM_MAX = 200;
  const BPM_STEP = 0.25;
  const MULTIPLES = 4;             // beat multiples summed by the tempo score
  const LOCAL_MEAN_S = 0.25;       // ± seconds of the local mean removed before the autocorrelation
  const OFFBEAT_DOUBLE = 0.5;      // off-beats this strong mean the real beat is twice as fast …
  const THIRDS_TRIPLE = 0.5;       // … and both thirds of the beat this strong mean it is three times as fast
  const LAG_REACH = 1;             // ± frames searched around each beat lag (periods are rarely whole frames)
  const PRIOR_CENTER = 120;        // octave choice: a log-normal preference around this tempo …
  const PRIOR_OCTAVES = 1;         // … with this width in octaves
  const MIN_CONFIDENCE = 0.15;     // below this the tempo is reported as unknown (null)
  const PERIODIC_FULL = 0.3;       // beat-lag correlation that counts as fully periodic in the confidence
  const FLUX_FLOOR = 10;           // spectral flux of a quiet noise floor: the smallest 99th percentile normalized to 1
  const MIN_ONSET = 0.1;           // a normalized 99th percentile below this means there are no onsets at all
  const DEFAULT_STEP = 1500;       // frames per yielded progress step (15 s of audio)

  function inputError(message) {
    const e = new TypeError(message);
    e.code = 'input';
    return e;
  }

  function checkInput(channels, sampleRate) {
    if (!Array.isArray(channels) || channels.length === 0) throw inputError('analyze: channels must be a non-empty array');
    for (const c of channels) if (!(c instanceof Float32Array)) throw inputError('analyze: each channel must be a Float32Array');
    if (!(Number.isFinite(sampleRate) && sampleRate > 0)) throw inputError('analyze: sampleRate must be a positive number');
  }

  function dbToUnit(meanSquare) {
    if (!(meanSquare > 0)) return 0;
    const u = (10 * Math.log10(meanSquare) - DB_FLOOR) / -DB_FLOOR;
    return u < 0 ? 0 : u > 1 ? 1 : u;
  }

  // Mono view of the channels (their average); samples outside [0, n) are 0.
  function createReader(channels) {
    const nc = channels.length;
    let n = channels[0].length;
    for (const c of channels) n = Math.min(n, c.length);
    function at(i) {
      if (i < 0 || i >= n) return 0;
      let s = 0;
      for (let c = 0; c < nc; c++) s += channels[c][i];
      return s / nc;
    }
    return { n, at };
  }

  function meanSquare(reader, a, b) {
    if (b <= a) return 0;
    let s = 0;
    for (let i = a; i < b; i++) { const v = reader.at(i); s += v * v; }
    return s / (b - a);
  }

  // Log-compressed magnitude spectrum of the Hann-windowed frame centred on sample `center`.
  function createSpectrum() {
    const real = fft.createRealFFT(WIN);
    const hann = new Float64Array(WIN);
    let sum = 0;
    for (let i = 0; i < WIN; i++) { hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN); sum += hann[i]; }
    const norm = 2 / sum;          // a full-scale sine gives a magnitude of about 1
    const frame = new Float64Array(WIN);
    const mags = new Float64Array(real.bins);
    return {
      bins: real.bins,
      at(reader, center, out) {
        const start = center - WIN / 2;
        for (let i = 0; i < WIN; i++) frame[i] = reader.at(start + i) * hann[i];
        real.magnitudes(frame, mags);
        for (let k = 0; k < real.bins; k++) out[k] = Math.log(1 + COMPRESS * norm * mags[k]);
        return out;
      },
    };
  }

  // Positive spectral change between two frames, DC bin excluded.
  function fluxOf(prev, cur) {
    let s = 0;
    for (let k = 1; k < cur.length; k++) { const d = cur[k] - prev[k]; if (d > 0) s += d; }
    return s;
  }

  function percentile99(values) {
    if (!values.length) return 0;
    const sorted = Float32Array.from(values).sort();
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  }

  // Onset strength scaled so the 99th percentile maps to 1 (clamped). The scale never goes below FLUX_FLOOR, so the
  // tiny frame-to-frame flux of a steady tone or silence stays near 0 instead of being blown up into onsets.
  function normalize(flux) {
    const ref = Math.max(percentile99(flux), FLUX_FLOOR);
    const out = new Float32Array(flux.length);
    for (let i = 0; i < flux.length; i++) out[i] = Math.min(1, flux[i] / ref);
    return out;
  }

  // analyze(channels, sampleRate, { step }) → Generator yielding progress 0..1 and returning the SongAnalysis (§4.13).
  function* analyze(channels, sampleRate, opts) {
    checkInput(channels, sampleRate);
    const step = Math.max(1, Math.floor((opts && opts.step) || DEFAULT_STEP));
    const reader = createReader(channels);
    const n = reader.n;
    const frames = Math.max(0, Math.ceil((n * HZ) / sampleRate - 1e-9));
    const loud = new Float32Array(frames);
    const flux = new Float32Array(frames);
    const spectrum = createSpectrum();
    let prev = new Float64Array(spectrum.bins);
    let cur = new Float64Array(spectrum.bins);
    spectrum.at(reader, Math.round((-1 * sampleRate) / HZ), prev);
    for (let k = 0; k < frames; k++) {
      const a = Math.round((k * sampleRate) / HZ);
      const b = Math.min(n, Math.round(((k + 1) * sampleRate) / HZ));
      loud[k] = dbToUnit(meanSquare(reader, a, b));
      spectrum.at(reader, a, cur);
      flux[k] = fluxOf(prev, cur);
      const swap = prev; prev = cur; cur = swap;
      if ((k + 1) % step === 0 && k + 1 < frames) yield (0.9 * (k + 1)) / frames;
    }
    const strength = normalize(flux);
    yield 0.9;
    const tempo = estimateTempo(strength, HZ);
    return {
      duration: n / sampleRate,
      env: { hz: HZ, loud },
      onset: { hz: HZ, strength },
      bpm: tempo.bpm,
      bpmConfidence: tempo.confidence,
      offset: tempo.offset,
      meter: 4,
    };
  }

  // Runs analyze() to the end (Node tests, short clips); hosts step the generator between idle callbacks instead.
  function analyzeSync(channels, sampleRate, opts) {
    const gen = analyze(channels, sampleRate, opts);
    for (;;) {
      const r = gen.next();
      if (r.done) return r.value;
    }
  }

  // --- tempo ------------------------------------------------------------------------------------------------------

  // Onset strength minus its local mean, floored at 0: isolated peaks stay, steady texture goes.
  function emphasize(s, hz) {
    const n = s.length;
    const reach = Math.round(LOCAL_MEAN_S * hz);
    const prefix = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + s[i];
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - reach);
      const b = Math.min(n, i + reach + 1);
      const v = s[i] - (prefix[b] - prefix[a]) / (b - a);
      d[i] = v > 0 ? v : 0;
    }
    return d;
  }

  // 5-tap binomial smoothing, so autocorrelation peaks are wide enough to interpolate between lags.
  function smooth(d) {
    const n = d.length;
    const g = new Float32Array(n);
    const at = (i) => (i < 0 || i >= n ? 0 : d[i]);
    for (let i = 0; i < n; i++) g[i] = (at(i - 2) + 4 * at(i - 1) + 6 * d[i] + 4 * at(i + 1) + at(i + 2)) / 16;
    return g;
  }

  function autocorrelation(g, maxLag) {
    const n = g.length;
    const ac = new Float64Array(maxLag + 2);
    for (let lag = 0; lag < ac.length && lag < n; lag++) {
      let s = 0;
      for (let i = 0; i + lag < n; i++) s += g[i] * g[i + lag];
      ac[lag] = s / (n - lag);
    }
    return ac;
  }

  function interp(arr, x) {
    if (x < 0) return 0;
    const i = Math.floor(x);
    if (i + 1 >= arr.length) return i < arr.length ? arr[i] : 0;
    return arr[i] + (arr[i + 1] - arr[i]) * (x - i);
  }

  // Largest autocorrelation within ±LAG_REACH frames of lag x. A beat period is rarely a whole number of frames
  // (180 BPM is 33.3 frames), and interpolating across a narrow peak would score it below its whole-frame multiples.
  function acNear(ac, x) {
    const lo = Math.max(0, Math.ceil(x - LAG_REACH));
    const hi = Math.min(ac.length - 1, Math.floor(x + LAG_REACH));
    let best = 0;
    for (let i = lo; i <= hi; i++) if (ac[i] > best) best = ac[i];
    return best;
  }

  function tempoScore(ac, hz, bpm) {
    const period = (60 * hz) / bpm;
    let s = 0;
    for (let m = 1; m <= MULTIPLES; m++) s += acNear(ac, m * period);
    return s / MULTIPLES;
  }

  // How far the beat lags stand out from the lags around them (0 flat … 1 isolated peaks): for each multiple, the peak
  // minus the mean over one period centred on it, relative to the peak.
  function contrast(ac, period) {
    let peaks = 0, around = 0;
    for (let m = 1; m <= MULTIPLES; m++) {
      const c = m * period;
      const lo = Math.max(0, Math.ceil(c - period / 2));
      const hi = Math.min(ac.length - 1, Math.floor(c + period / 2));
      if (hi < lo) break;
      let s = 0;
      for (let i = lo; i <= hi; i++) s += ac[i];
      peaks += acNear(ac, c);
      around += s / (hi - lo + 1);
    }
    return peaks > 0 ? Math.max(0, Math.min(1, (peaks - around) / peaks)) : 0;
  }

  // Correlation coefficient of g with itself 1…MULTIPLES beats later: about 0 for onsets at unrelated times (a random
  // pattern can still show a lone autocorrelation peak), about 1 for a strict pulse.
  function periodicity(g, ac, period) {
    let mean = 0;
    for (let i = 0; i < g.length; i++) mean += g[i];
    mean /= g.length;
    const variance = ac[0] - mean * mean;
    if (!(variance > 0)) return 0;
    let s = 0;
    for (let m = 1; m <= MULTIPLES; m++) s += acNear(ac, m * period) - mean * mean;
    return s / MULTIPLES / variance;
  }

  // Mean smoothed strength on the grid phase + k·period.
  function comb(g, period, phase) {
    let s = 0, count = 0;
    for (let x = phase; x < g.length - 1; x += period) { s += interp(g, x); count++; }
    return count ? s / count : 0;
  }

  function bestPhase(g, period) {
    let best = 0, bestScore = -1;
    for (let phase = 0; phase < period; phase += 0.25) {
      const s = comb(g, period, phase);
      if (s > bestScore) { bestScore = s; best = phase; }
    }
    return { phase: best, score: bestScore };
  }

  // Strength of the weakest of the `parts` − 1 subdivisions of the beat, relative to the beat itself.
  function subdivisionRatio(g, period, parts) {
    const on = bestPhase(g, period);
    if (!(on.score > 0)) return 0;
    let weakest = Infinity;
    for (let j = 1; j < parts; j++) weakest = Math.min(weakest, comb(g, period, (on.phase + (j * period) / parts) % period));
    return weakest / on.score;
  }

  function prior(bpm) {
    const x = Math.log2(bpm / PRIOR_CENTER) / PRIOR_OCTAVES;
    return Math.exp(-0.5 * x * x);
  }

  function inRange(bpm) { return bpm >= BPM_MIN - 1e-9 && bpm <= BPM_MAX + 1e-9; }

  // Octave check: among the tempo's octaves and its ×3 and ÷3 in range, the best score × prior. Then, while the beat
  // is evenly subdivided (both thirds, or the off-beat, as strong as half the beat), the real beat is that subdivision.
  function octave(g, ac, hz, bpm) {
    let c = bpm, best = -1;
    const consider = (x) => {
      if (!inRange(x)) return;
      const w = tempoScore(ac, hz, x) * prior(x);
      if (w > best) { best = w; c = x; }
    };
    for (let x = bpm; x >= BPM_MIN - 1e-9; x /= 2) consider(x);
    for (let x = bpm * 2; x <= BPM_MAX + 1e-9; x *= 2) consider(x);
    consider(bpm * 3);
    consider(bpm / 3);
    for (;;) {
      const period = (60 * hz) / c;
      if (inRange(c * 3) && subdivisionRatio(g, period, 3) > THIRDS_TRIPLE) c *= 3;
      else if (inRange(c * 2) && subdivisionRatio(g, period, 2) > OFFBEAT_DOUBLE) c *= 2;
      else return c;
    }
  }

  // Sub-frame peak (parabolic vertex) of the non-negative d near x, within ±reach frames; null when d is 0 there.
  // Used on the onset strength (beat times) and on the autocorrelation (beat lags).
  function peakNear(d, x, reach) {
    const lo = Math.max(1, Math.ceil(x - reach));
    const hi = Math.min(d.length - 2, Math.floor(x + reach));
    let j = -1, best = 0;
    for (let i = lo; i <= hi; i++) if (d[i] > best) { best = d[i]; j = i; }
    if (j < 0) return null;
    const y0 = d[j - 1], y1 = d[j], y2 = d[j + 1];
    const den = y0 - 2 * y1 + y2;
    let off = den < 0 ? (0.5 * (y0 - y2)) / den : 0;
    if (off > 0.5) off = 0.5; else if (off < -0.5) off = -0.5;
    return { t: j + off, w: y1 };
  }

  // The period from the autocorrelation peaks at every multiple of `period` the lags reach (sub-frame vertices,
  // least squares through lag 0). The tempo scan only knows the period to about a frame at its 4th multiple, too
  // coarse for refine() to follow a long song; this brings it to a small fraction of a frame.
  function acPeriod(ac, period) {
    let sum = 0, norm = 0, estimate = period;
    for (let m = 1; (m + 0.25) * period < ac.length - 2; m++) {
      const p = peakNear(ac, m * estimate, period / 4);
      if (!p) continue;
      sum += p.w * m * p.t;
      norm += p.w * m * m;
      estimate = sum / norm;
    }
    return estimate;
  }

  // Weighted least squares of peak times against beat numbers: refines period and phase (two passes).
  function refine(d, period, phase) {
    let fraction = 0;
    for (let pass = 0; pass < 2; pass++) {
      let sw = 0, sk = 0, st = 0, skk = 0, skt = 0, hits = 0, beats = 0;
      for (let k = 0; phase + k * period < d.length; k++) {
        beats++;
        const p = peakNear(d, phase + k * period, period / 4);
        if (!p) continue;
        hits++;
        sw += p.w; sk += p.w * k; st += p.w * p.t; skk += p.w * k * k; skt += p.w * k * p.t;
      }
      fraction = beats ? hits / beats : 0;
      const det = sw * skk - sk * sk;
      if (hits < 4 || !(det > 0)) break;
      const slope = (sw * skt - sk * st) / det;
      if (Math.abs(slope - period) / period > 0.03) break;
      phase = (st - slope * sk) / sw;
      period = slope;
    }
    return { period, phase, fraction };
  }

  // estimateTempo(strength, hz) → { bpm | null, confidence 0..1, offset (s, first beat in [0, period)) }
  function estimateTempo(strength, hz) {
    const none = { bpm: null, confidence: 0, offset: 0 };
    if (strength.length < 2 * hz || percentile99(strength) < MIN_ONSET) return none;
    const d = emphasize(strength, hz);
    const g = smooth(d);
    const maxLag = Math.ceil(((MULTIPLES + 0.5) * 60 * hz) / BPM_MIN) + LAG_REACH;   // contrast() reads ½ period past
    const ac = autocorrelation(g, maxLag);
    let best = 0, bestScore = 0;
    for (let bpm = BPM_MIN; bpm <= BPM_MAX + 1e-9; bpm += BPM_STEP) {
      const s = tempoScore(ac, hz, bpm);
      if (s > bestScore) { bestScore = s; best = bpm; }
    }
    if (!(bestScore > 0)) return none;
    const bpm = octave(g, ac, hz, best);
    const coarse = acPeriod(ac, (60 * hz) / bpm);
    const fit = refine(d, coarse, bestPhase(g, coarse).phase);
    const periodic = Math.max(0, Math.min(1, periodicity(g, ac, fit.period) / PERIODIC_FULL));
    const confidence = contrast(ac, fit.period) * periodic * (0.5 + 0.5 * fit.fraction);
    if (confidence < MIN_CONFIDENCE) return { bpm: null, confidence, offset: 0 };
    const offset = ((fit.phase % fit.period) + fit.period) % fit.period;
    return { bpm: (60 * hz) / fit.period, confidence, offset: offset / hz };
  }

  return { HZ, WIN, BPM_MIN, BPM_MAX, analyze, analyzeSync, estimateTempo, dbToUnit };
});
