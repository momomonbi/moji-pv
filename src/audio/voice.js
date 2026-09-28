/* 文字PVメーカー v2 — original work. The song's voice: one pass over the decoded song gives the vocal activity and vocal peaks (歌ハメ) and the phrase-start candidates (曲から下書き), stored as doc.song.voice (DESIGN_2_2 §5, §6). */
MV.def('audio/voice', ['audio/fft', 'audio/digest'], (fft, DG) => {
  'use strict';

  // The joint contract of PV22 P5 (曲から下書き) and P6 (歌ハメ), DESIGN_2_2 §5.2: one module, one record.
  const VC = Object.freeze({
    HZ: 100, WIN: 1024, BAND: Object.freeze([250, 3500]),   // frames per second (hop 10 ms), FFT window, vocal band (Hz)
    SIDE: 1,                                      // centred power per bin: max(0, |M|² − SIDE·|S|²)
    MED: 4,                                       // median filter half-width (±40 ms): drops drum hits
    FLOOR_P: 0.10, TOP_P: 0.95,                   // activity 0 at the song's 10th percentile, 1 at its 95th
    LOW: 0.35, HIGH: 0.55,                        // hysteresis on the activity
    GAP_S: 0.15, AFTER_S: 0.3, FULL_GAP_S: 0.5,   // pause before a phrase start; look-ahead; the pause for a full score
    REFINE: Object.freeze([-6, 3]),               // frames around the rise searched for the strongest band flux
    WEAK: 0.3, WEAK_MIN: 0.5, WEAK_SEP_S: 0.25,   // weak candidates: band-flux peaks inside voiced stretches
    STORE_HZ: 25,                                 // the stored activity (mean of 4 frames)
    PEAK_MIN: 0.2, PEAK_REACH: 3, PEAK_SEP_S: 0.06, VFLUX_FLOOR: 10,   // the vocal peaks (歌ハメ)
    STRONG: 0.4, TAIL_S: 0.5,                     // 曲から下書き's voiced span
    COMPRESS: 1000, DEFAULT_STEP: 1500,
    DIGEST_MED: 1,                                // fromDigest: the median half-width at 20 Hz
  });
  const DB_FLOOR = -60;                           // −60 dB → 0, 0 dB → 1 (as audio/analyze)
  const RECORD_V = 1;

  function inputError(message) {
    const e = new TypeError(message);
    e.code = 'input';
    return e;
  }

  function formatError(message) {
    const e = new TypeError(message);
    e.code = 'format';
    return e;
  }

  function checkInput(channels, sampleRate) {
    if (!Array.isArray(channels) || channels.length === 0) throw inputError('voice: channels must be a non-empty array');
    for (const c of channels) if (!(c instanceof Float32Array)) throw inputError('voice: each channel must be a Float32Array');
    if (!(Number.isFinite(sampleRate) && sampleRate > 0)) throw inputError('voice: sampleRate must be a positive number');
  }

  function dbToUnit(power) {
    if (!(power > 0)) return 0;
    const u = (10 * Math.log10(power) - DB_FLOOR) / -DB_FLOOR;
    return u < 0 ? 0 : u > 1 ? 1 : u;
  }

  // percentile(values, p) → sorted[min(n − 1, floor(p·n))]; 0 for an empty list.
  function percentile(values, p) {
    if (!values.length) return 0;
    const sorted = Float32Array.from(values).sort();
    return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  }

  // The running median over ±r frames (the window shrinks at the ends; the upper median of an even count).
  function median(a, r) {
    const n = a.length, out = new Float32Array(n), w = new Float32Array(2 * r + 1);
    for (let i = 0; i < n; i++) {
      const lo = Math.max(0, i - r), hi = Math.min(n - 1, i + r);
      const m = hi - lo + 1;
      for (let j = 0; j < m; j++) w[j] = a[lo + j];
      const s = w.subarray(0, m).sort();
      out[i] = s[m >> 1];
    }
    return out;
  }

  // The mean over ±r frames (the window shrinks at the ends).
  function boxMean(a, r) {
    const n = a.length, out = new Float32Array(n), pre = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + a[i];
    for (let i = 0; i < n; i++) {
      const x = Math.max(0, i - r), y = Math.min(n, i + r + 1);
      out[i] = (pre[y] - pre[x]) / (y - x);
    }
    return out;
  }

  // The activity 0 at the song's FLOOR_P percentile and 1 at its TOP_P percentile (not clamped at 1).
  function normalizeActivity(a0) {
    const lo = percentile(a0, VC.FLOOR_P);
    const span = Math.max(1e-3, percentile(a0, VC.TOP_P) - lo);
    const a = new Float32Array(a0.length);
    for (let i = 0; i < a0.length; i++) a[i] = Math.max(0, (a0[i] - lo) / span);
    return a;
  }

  // Phrase starts: a rise of the activity to LOW after at least GAP_S below it that reaches HIGH within AFTER_S. Its
  // time is the strongest band flux in REFINE frames around the rise (fx given), else the rise itself; its strength is
  // how much the activity rose, times how long the pause was (full at FULL_GAP_S). → [{ k (frame), s }]
  function phraseStarts(a, hz, fx) {
    const n = a.length, gapF = Math.round(VC.GAP_S * hz), afterF = Math.round(VC.AFTER_S * hz);
    const out = [];
    let quiet = 0;
    for (let k = 0; k < n; k++) {
      if (a[k] < VC.LOW) { quiet++; continue; }
      if (quiet >= gapF) {
        const end = Math.min(n, k + afterF);
        let peak = 0;
        for (let j = k; j < end; j++) if (a[j] > peak) peak = a[j];
        if (peak >= VC.HIGH) {
          let best = k;
          if (fx) {
            let bf = -1;
            for (let j = Math.max(0, k + VC.REFINE[0]); j <= Math.min(n - 1, k + VC.REFINE[1]); j++) if (fx[j] > bf) { bf = fx[j]; best = j; }
          }
          let mb = 0;
          for (let j = k - quiet; j < k; j++) mb += a[j];
          mb /= Math.max(1, quiet);
          let ma = 0;
          for (let j = k; j < end; j++) ma += a[j];
          ma /= Math.max(1, end - k);
          const rise = Math.max(0, Math.min(1, ma - mb));
          out.push({ k: best, s: rise * Math.min(1, quiet / hz / VC.FULL_GAP_S) });
        }
      }
      quiet = 0;
    }
    return out;
  }

  // analyze(channels, sampleRate, { step }) → Generator yielding progress 0..1 and returning the VoiceResult
  //   { hz: 100, a: Float32Array (activity), phrases: [{ t, s, phrase }], peaks: [{ t, s }] }.
  // Per 10 ms frame (Hann window centred on the frame, the first frame primed with k = −1), from mid M = (L + R)/2
  // and side S = (L − R)/2 (mono: S = 0) over the vocal band: the centred power per bin c_b = max(0, |M_b|² − |S_b|²),
  // raw = level of Σ c_b × (1 − spectral flatness of c_b), and the band flux of log(1 + C·|M_b|). The activity is raw
  // median-filtered (±MED) and normalized to the song. Deterministic on the PCM (fixed order, no randomness).
  function* analyze(channels, sampleRate, opts) {
    checkInput(channels, sampleRate);
    const step = Math.max(1, Math.floor((opts && opts.step) || VC.DEFAULT_STEP));
    const HZ = VC.HZ, WIN = VC.WIN;
    const Lc = channels[0], Rc = channels.length > 1 ? channels[1] : channels[0];
    const mono = Lc === Rc;
    const n = Math.min(Lc.length, Rc.length);
    const frames = Math.max(0, Math.ceil((n * HZ) / sampleRate - 1e-9));
    const real = fft.createRealFFT(WIN);
    const hann = new Float64Array(WIN);
    let sum = 0;
    for (let i = 0; i < WIN; i++) { hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / WIN); sum += hann[i]; }
    const norm = 2 / sum;                        // a full-scale sine gives a magnitude of about 1 (audio/analyze)
    const fm = new Float64Array(WIN), fs = new Float64Array(WIN);
    const mm = new Float64Array(real.bins), ms = new Float64Array(real.bins);
    const binHz = sampleRate / WIN;
    const k0 = Math.max(1, Math.ceil(VC.BAND[0] / binHz)), k1 = Math.min(real.bins - 1, Math.floor(VC.BAND[1] / binHz));
    const nb = Math.max(1, k1 - k0 + 1);
    const raw = new Float32Array(frames), vflux = new Float32Array(frames);
    let prev = new Float64Array(real.bins), cur = new Float64Array(real.bins);
    for (let k = -1; k < frames; k++) {
      const c = Math.round((k * sampleRate) / HZ) - WIN / 2;
      for (let i = 0; i < WIN; i++) {
        const j = c + i;
        const l = j >= 0 && j < n ? Lc[j] : 0;
        const r = mono ? l : j >= 0 && j < n ? Rc[j] : 0;
        fm[i] = 0.5 * (l + r) * hann[i];
        fs[i] = 0.5 * (l - r) * hann[i];
      }
      real.magnitudes(fm, mm);
      if (!mono) real.magnitudes(fs, ms);
      let em = 0, lg = 0, fl = 0;
      for (let b = k0; b <= k1; b++) {
        const pm = (norm * mm[b]) ** 2;
        const ps = mono ? 0 : (norm * ms[b]) ** 2;
        const cb = Math.max(0, pm - VC.SIDE * ps);
        em += cb;
        lg += Math.log(cb + 1e-10);
        cur[b] = Math.log(1 + VC.COMPRESS * norm * mm[b]);
        const d = cur[b] - prev[b];
        if (d > 0) fl += d;
      }
      const swap = prev; prev = cur; cur = swap;
      if (k < 0) continue;
      const flat = em > 0 ? Math.exp(lg / nb) / (em / nb) : 1;
      raw[k] = dbToUnit(em) * (1 - Math.min(1, flat));
      vflux[k] = fl;
      if ((k + 1) % step === 0 && k + 1 < frames) yield (0.9 * (k + 1)) / frames;
    }
    yield 0.9;
    const a = normalizeActivity(median(raw, VC.MED));
    const fx = boxMean(vflux, 1);
    const found = phraseStarts(a, HZ, fx);
    const phrases = found.map((p) => ({ t: p.k / HZ, s: p.s, phrase: true }));
    // weak candidates: band-flux peaks inside voiced stretches, away from every phrase start
    const fref = Math.max(1e-6, percentile(fx, 0.99));
    const sepF = Math.round(VC.WEAK_SEP_S * HZ);
    let at = 0;
    for (let j = 2; j < frames - 2; j++) {
      const v = fx[j] / fref;
      if (v < VC.WEAK_MIN || fx[j] < fx[j - 1] || fx[j] < fx[j + 1] || a[j] < VC.LOW) continue;
      while (at < found.length && found[at].k <= j - sepF) at++;
      if (at < found.length && Math.abs(found[at].k - j) < sepF) continue;
      phrases.push({ t: j / HZ, s: VC.WEAK * Math.min(1, v), phrase: false });
    }
    phrases.sort((x, y) => x.t - y.t || (x.phrase === y.phrase ? 0 : x.phrase ? -1 : 1));
    yield 0.95;
    // the vocal peaks (歌ハメ): local maxima of the band onset times the activity over ±PEAK_REACH frames
    const ref = Math.max(percentile(vflux, 0.99), VC.VFLUX_FLOOR);
    const pv = new Float32Array(frames);
    for (let k = 0; k < frames; k++) pv[k] = Math.min(1, vflux[k] / ref) * Math.min(1, a[k]);
    const peaks = [];
    const peakSep = Math.round(VC.PEAK_SEP_S * HZ);
    let lastK = -Infinity;
    for (let k = 0; k < frames; k++) {
      const v = pv[k];
      if (v < VC.PEAK_MIN) continue;
      let top = true;
      for (let j = Math.max(0, k - VC.PEAK_REACH); j <= Math.min(frames - 1, k + VC.PEAK_REACH); j++) {
        if (pv[j] > v || (pv[j] === v && j < k)) { top = false; break; }
      }
      if (!top || k - lastK < peakSep) continue;
      peaks.push({ t: k / HZ, s: v });
      lastK = k;
    }
    return { hz: HZ, a, phrases, peaks };
  }

  // Runs analyze() to the end (Node tests, short clips); hosts step the generator between idle callbacks instead.
  function analyzeSync(channels, sampleRate, opts) {
    const gen = analyze(channels, sampleRate, opts);
    for (;;) {
      const r = gen.next();
      if (r.done) return r.value;
    }
  }

  // --- the stored record -------------------------------------------------------------------------------------------

  function leb128(out, v) {
    let x = Math.max(0, Math.floor(v));
    for (;;) {
      const byte = x & 0x7f;
      x = Math.floor(x / 128);
      if (x) out.push(byte | 0x80); else { out.push(byte); return; }
    }
  }

  // Centiseconds of a time (the stream's unit).
  function cs(t) { return Math.max(0, Math.round(t * 100)); }

  // encode(res) → doc.song.voice = { v: 1, hz: 25, act, peaks, phrases } (base64 byte streams):
  //   act[j] = round(255 · min(1, mean of the activity frames 4j … 4j+3));
  //   peaks = records (Δ centiseconds since the previous peak as unsigned LEB128, round(255·s));
  //   phrases = records (Δ centiseconds as LEB128, one byte: bit 7 = phrase candidate, bits 0–6 = round(127·s)).
  function encode(res) {
    const per = Math.round(res.hz / VC.STORE_HZ);
    const a = res.a;
    const count = Math.ceil(a.length / per);
    const act = new Uint8Array(count);
    for (let j = 0; j < count; j++) {
      let s = 0, c = 0;
      for (let k = per * j; k < Math.min(a.length, per * j + per); k++) { s += a[k]; c++; }
      act[j] = Math.round(255 * Math.min(1, s / Math.max(1, c)));
    }
    const peaks = [];
    let last = 0;
    for (const p of res.peaks) {
      const t = cs(p.t);
      leb128(peaks, t - last);
      peaks.push(Math.round(255 * Math.max(0, Math.min(1, p.s))));
      last = t;
    }
    const phrases = [];
    last = 0;
    for (const p of res.phrases) {
      const t = cs(p.t);
      leb128(phrases, t - last);
      phrases.push((p.phrase ? 0x80 : 0) | Math.round(127 * Math.max(0, Math.min(1, p.s))));
      last = t;
    }
    return { v: RECORD_V, hz: VC.STORE_HZ, act: DG.toBase64(act), peaks: DG.toBase64(Uint8Array.from(peaks)),
      phrases: DG.toBase64(Uint8Array.from(phrases)) };
  }

  // Reads (Δ LEB128, byte) records → { t: Float64Array (s), b: Uint8Array }.
  function readRecords(text) {
    const bytes = DG.fromBase64(text);
    const ts = [], bs = [];
    let i = 0, at = 0;
    while (i < bytes.length) {
      let v = 0, mul = 1, byte;
      do {
        if (i >= bytes.length) throw formatError('voice: cut-off record');
        byte = bytes[i++];
        v += (byte & 0x7f) * mul;
        mul *= 128;
      } while (byte & 0x80 && mul < 2 ** 42);
      if (i >= bytes.length) throw formatError('voice: record without a value');
      at += v;
      ts.push(at / 100);
      bs.push(bytes[i++]);
    }
    return { t: Float64Array.from(ts), b: Uint8Array.from(bs) };
  }

  // decode(v) → { hz, act: Float32Array 0..1, pt: Float64Array, ps: Float32Array, ph: { t, s, phrase } | null }
  // (ph is null for a record without phrases: 曲から下書き reads that as "voice not read"). Memoized by object identity;
  // a damaged record throws code 'format'.
  const decoded = new WeakMap();
  function decode(v) {
    if (v && typeof v === 'object' && decoded.has(v)) return decoded.get(v);
    if (!isRecord(v)) throw formatError('voice: expected { v: 1, hz, act, peaks }');
    const actBytes = DG.fromBase64(v.act);
    const act = new Float32Array(actBytes.length);
    for (let i = 0; i < actBytes.length; i++) act[i] = actBytes[i] / 255;
    const pk = readRecords(v.peaks);
    const ps = new Float32Array(pk.b.length);
    for (let i = 0; i < ps.length; i++) ps[i] = pk.b[i] / 255;
    let ph = null;
    if (typeof v.phrases === 'string') {
      const r = readRecords(v.phrases);
      const s = new Float32Array(r.b.length), phrase = new Uint8Array(r.b.length);
      for (let i = 0; i < s.length; i++) { s[i] = (r.b[i] & 0x7f) / 127; phrase[i] = r.b[i] & 0x80 ? 1 : 0; }
      ph = { t: r.t, s, phrase };
    }
    const out = Object.freeze({ hz: v.hz, act, pt: pk.t, ps, ph });
    decoded.set(v, out);
    return out;
  }

  function isRecord(v) {
    return !!v && typeof v === 'object' && v.v === RECORD_V && typeof v.hz === 'number' && v.hz > 0
      && typeof v.act === 'string' && typeof v.peaks === 'string' && (v.phrases === undefined || typeof v.phrases === 'string');
  }

  // hasPhrases(v) → whether a stored record carries the phrase stream 曲から下書き reads.
  function hasPhrases(v) { return isRecord(v) && typeof v.phrases === 'string'; }

  // candidatesIn(dec, a, b) → [{ t, s, kind: 'phrase' | 'weak' }] with a ≤ t < b, in time order.
  function candidatesIn(dec, a, b) {
    const ph = dec && dec.ph;
    const out = [];
    if (!ph) return out;
    for (let i = 0; i < ph.t.length; i++) {
      const t = ph.t[i];
      if (t >= a && t < b) out.push({ t, s: ph.s[i], kind: ph.phrase[i] ? 'phrase' : 'weak' });
    }
    return out;
  }

  // peaksIn(dec, a, b) → [{ t, s }] with a ≤ t < b (歌ハメ's vocal peaks).
  function peaksIn(dec, a, b) {
    const out = [];
    if (!dec) return out;
    for (let i = 0; i < dec.pt.length; i++) if (dec.pt[i] >= a && dec.pt[i] < b) out.push({ t: dec.pt[i], s: dec.ps[i] });
    return out;
  }

  // voiced(cands, act, hz) → { t0, t1 } | null: where singing starts (the first phrase candidate of strength ≥ STRONG,
  // else the first candidate) and ends (the last activity frame ≥ LOW, + TAIL_S); null without candidates.
  function voiced(cands, act, hz) {
    if (!cands || !cands.length) return null;
    const strong = cands.find((c) => c.kind === 'phrase' && c.s >= VC.STRONG);
    const t0 = (strong || cands[0]).t;
    let last = act.length - 1;
    while (last >= 0 && act[last] < VC.LOW) last--;
    const t1 = last >= 0 ? (last + 1) / hz + VC.TAIL_S : null;
    return { t0, t1: t1 !== null && t1 > t0 ? t1 : null };
  }

  // digestActivity(digest) → { hz: 20, act }: the persisted loudness digest (full mix) as an activity, with the same
  // median (±DIGEST_MED) and normalization as the voice (never stored).
  function digestActivity(digest) {
    const env = DG.envFromDigest(digest);
    return { hz: env.hz, act: normalizeActivity(median(env.loud, VC.DIGEST_MED)) };
  }

  // fromDigest(digest) → [{ t, s, kind: 'phrase' }]: phrase starts from the loudness digest alone (a song imported by
  // an older build whose file is not linked): the same phrase rule at 20 Hz, no refinement, no weak candidates, every
  // strength halved.
  function fromDigest(digest) {
    const d = digestActivity(digest);
    return phraseStarts(d.act, d.hz, null).map((p) => ({ t: p.k / d.hz, s: p.s / 2, kind: 'phrase' }));
  }

  // (歌ハメ, PV22 P6, adds activityEnd(dec, a, b, C) here: where the voice stops, by its own constants.)
  return { VC, analyze, analyzeSync, encode, decode, hasPhrases, isRecord, candidatesIn, peaksIn, voiced, digestActivity,
    fromDigest };
});
