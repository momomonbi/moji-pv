/* 文字PVメーカー v2 — original work. The video sample table and its pure operations: build, sampleAt, runFor, codec strings (DESIGN_2_1 §11.3.4, §11.4.2, §11.4.3). */
MV.def('media/samples', ['core/media'], (MEDIA) => {
  'use strict';

  // A SampleTable describes every frame of one video track:
  //   n, duration, fps, vfr               n = shown frames; duration = presentation length (s); fps = 1 / median frame
  //   key: Uint8Array                     DECODE order: 1 when sample d is a key frame
  //   pts, dur: Float64Array, dec: Int32Array   PRESENTATION order (length n): start (s, the first shown = 0), duration
  //                                       (s), decode index
  //   off: Float64Array, size: Uint32Array, ts: Float64Array   DECODE order: byte offset, size, chunk timestamp (µs)
  //   aoff: Float64Array | null, asize: Uint32Array | null     DECODE order: WebM alpha (BlockAdditional id 1) ranges
  // Decode-order arrays may be longer than n: pre-roll samples (before the first edit) are fed, never shown.
  // Everything here is arithmetic on typed arrays, so a source frame is chosen the same way in Node and every browser.

  const EPS = MEDIA.LIMITS.eps;          // 1e-4 s (§11.4.2): frame starts round toward the later frame

  class MediaError extends Error {
    // code: one of the media.err.* keys of §11.7.9 ('broken', 'container', 'type', 'heic', 'codec', …)
    constructor(code, message, detail) {
      super(message || code);
      this.name = 'MediaError';
      this.code = code;
      this.detail = detail || null;
    }
  }

  function median(values, n) {
    if (!n) return 0;
    const s = Array.prototype.slice.call(values, 0, n).sort((a, b) => a - b);
    return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  // build(src) → SampleTable from decode-order samples in integer ticks:
  //   src = { timescale, cts: number[] (presentation time of each decode-order sample, ticks), dur: number[] (ticks;
  //           0 = unknown), key: number[] (0/1), off: number[], size: number[], aoff?, asize?, start?: ticks }
  // Samples with cts < start (the first non-empty edit's media_time) are pre-roll. The shown samples are sorted by
  // time and shifted so that the first starts at 0. Throws MediaError('broken') when no sample is shown.
  function build(src) {
    const nd = src.cts.length;
    const scale = src.timescale;
    if (!(scale > 0)) throw new MediaError('broken', 'samples: bad timescale');
    const start = typeof src.start === 'number' ? src.start : -Infinity;
    const shown = [];
    for (let d = 0; d < nd; d++) if (src.cts[d] >= start) shown.push(d);
    if (!shown.length) throw new MediaError('broken', 'samples: no frame is shown');
    shown.sort((a, b) => src.cts[a] - src.cts[b] || a - b);       // presentation order (ties keep decode order)
    const n = shown.length;
    const shift = src.cts[shown[0]];
    const pts = new Float64Array(n), dur = new Float64Array(n), dec = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      dec[i] = shown[i];
      pts[i] = (src.cts[shown[i]] - shift) / scale;
    }
    for (let i = 0; i + 1 < n; i++) dur[i] = pts[i + 1] - pts[i];
    const typical = n > 1 ? median(dur, n - 1) : 0;
    const last = src.dur[shown[n - 1]] / scale;
    dur[n - 1] = last > 0 ? last : typical > 0 ? typical : 1 / 30;
    // Decode order: every sample gets a unique chunk timestamp (µs) in presentation order, pre-roll first.
    const ts = new Float64Array(nd);
    const order = Array.from({ length: nd }, (_, d) => d).sort((a, b) => src.cts[a] - src.cts[b] || a - b);
    let prev = -Infinity;
    for (const d of order) {
      let t = Math.round(((src.cts[d] - shift) / scale) * 1e6);
      if (t <= prev) t = prev + 1;
      ts[d] = t;
      prev = t;
    }
    const table = {
      n,
      duration: pts[n - 1] + dur[n - 1],
      fps: 0,
      vfr: false,
      key: Uint8Array.from(src.key, (k) => (k ? 1 : 0)),
      pts, dur, dec,
      off: Float64Array.from(src.off),
      size: Uint32Array.from(src.size),
      ts,
      aoff: src.aoff ? Float64Array.from(src.aoff) : null,
      asize: src.asize ? Uint32Array.from(src.asize) : null,
    };
    const med = median(dur, n > 1 ? n - 1 : 1);
    table.fps = med > 0 ? 1 / med : 30;
    table.vfr = isVfr(dur, n, med);
    return table;
  }

  // Variable frame rate: some frame (the last one aside, which a file may cut short) differs from the median by more
  // than 1.5 ms or 5 %. Millisecond timestamps of a 29.97 fps WebM (33/34 ms) are constant rate.
  function isVfr(dur, n, med) {
    const tol = Math.max(0.0015, 0.05 * med);
    for (let i = 0; i + 1 < n; i++) if (Math.abs(dur[i] - med) > tol) return true;
    return false;
  }

  // sampleAt(table, m) → the presentation index shown at media time m: the largest i with pts[i] ≤ m + EPS, else 0.
  function sampleAt(table, m) {
    const pts = table.pts;
    const x = m + EPS;
    let lo = 0, hi = table.n - 1;
    if (!(pts[0] <= x)) return 0;
    while (lo < hi) {                        // invariant: pts[lo] ≤ x
      const mid = (lo + hi + 1) >> 1;
      if (pts[mid] <= x) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // keyAtOrBefore(table, d) → the decode index of the key frame that starts d's GOP (0 when none is before it).
  function keyAtOrBefore(table, d) {
    for (let k = Math.min(d, table.key.length - 1); k >= 0; k--) if (table.key[k]) return k;
    return 0;
  }

  // runFor(table, i) → { from, to }: the decode-order samples to feed so that presentation sample i can be shown.
  // A frame shown before its GOP's key frame (a leading picture of an open GOP) needs the previous GOP too.
  function runFor(table, i) {
    const to = table.dec[i];
    let from = keyAtOrBefore(table, to);
    const want = table.ts[to];
    while (from > 0 && table.ts[from] > want) from = keyAtOrBefore(table, from - 1);
    return { from, to };
  }

  // The presentation index of each decode-order sample (-1 for pre-roll); the session matches decoder output with it.
  function presentationOf(table) {
    const out = new Int32Array(table.key.length).fill(-1);
    for (let i = 0; i < table.n; i++) out[table.dec[i]] = i;
    return out;
  }

  const ARRAYS = [['key', Uint8Array], ['pts', Float64Array], ['dur', Float64Array], ['dec', Int32Array],
    ['off', Float64Array], ['size', Uint32Array], ['ts', Float64Array], ['aoff', Float64Array], ['asize', Uint32Array]];

  // toData(table) → the IndexedDB form: numbers as they are, typed arrays as ArrayBuffers (copies).
  function toData(table) {
    const out = { n: table.n, duration: table.duration, fps: table.fps, vfr: table.vfr };
    for (const [k] of ARRAYS) out[k] = table[k] ? table[k].slice().buffer : null;
    return out;
  }

  // fromData(data) → SampleTable, or null when the record does not have the table's shape (a damaged cache entry).
  function fromData(data) {
    if (!data || typeof data !== 'object' || !(data.n >= 1)) return null;
    const out = { n: data.n, duration: data.duration, fps: data.fps, vfr: !!data.vfr };
    for (const [k, Type] of ARRAYS) {
      const buf = data[k];
      if (buf === null || buf === undefined) { out[k] = null; continue; }
      if (!(buf instanceof ArrayBuffer) || buf.byteLength % Type.BYTES_PER_ELEMENT) return null;
      out[k] = new Type(buf.slice(0));
    }
    const nd = out.key ? out.key.length : 0;
    const ok = out.key && out.off && out.size && out.ts && out.pts && out.dur && out.dec && out.pts.length === out.n
      && out.dur.length === out.n && out.dec.length === out.n && out.off.length === nd && out.size.length === nd && out.ts.length === nd
      && (!out.aoff || out.aoff.length === nd) && (!out.asize || out.asize.length === nd);
    return ok ? out : null;
  }

  // stats(table) → { gopMean, gopMax, vfr }: the mean and largest distance between key frames in seconds of
  // presentation (the §11.2.8 "long GOP" badge reads gopMean > 5 s).
  function stats(table) {
    const pres = presentationOf(table);
    const times = [];
    for (let d = 0; d < table.key.length; d++) if (table.key[d] && pres[d] >= 0) times.push(table.pts[pres[d]]);
    times.sort((a, b) => a - b);
    if (!times.length) return { gopMean: table.duration, gopMax: table.duration, vfr: table.vfr };
    times.push(table.duration);
    let max = 0;
    for (let k = 1; k < times.length; k++) max = Math.max(max, times[k] - times[k - 1]);
    return { gopMean: table.duration / (times.length - 1), gopMax: max, vfr: table.vfr };
  }

  // --- codec strings (§11.4.3) ----------------------------------------------------------------------------------------

  const h2 = (v) => (v & 255).toString(16).toUpperCase().padStart(2, '0');
  const d2 = (v) => String(v).padStart(2, '0');

  // VP9 levels by picture size and sample rate (the VP9 level table, §11.4.3: 10 … 52; 52 is 3840×2160 from 71 fps).
  const VP9_LEVELS = [
    [10, 36864, 829440], [11, 73728, 2764800], [20, 122880, 4608000], [21, 245760, 9216000], [30, 552960, 20736000],
    [31, 983040, 36864000], [40, 2228224, 83558400], [41, 2228224, 160432128], [50, 8912896, 311951360],
    [51, 8912896, 588251136], [52, 8912896, 1176502272],
  ];

  // vp9Level(w, h, fps) → the smallest level whose picture size and luma sample rate hold the stream.
  function vp9Level(w, h, fps) {
    const pixels = w * h, rate = pixels * (fps > 0 ? fps : 30);
    for (const [level, maxPixels, maxRate] of VP9_LEVELS) if (pixels <= maxPixels && rate <= maxRate) return level;
    return 62;
  }

  // codecString(info) → the WebCodecs codec string of a track:
  //   { fourcc: 'avc1'|'avc3', config: avcC }             → avc1.PPCCLL (profile, constraint and level bytes of avcC)
  //   { fourcc: 'hvc1'|'hev1', config: hvcC }             → hvc1.<space+idc>.<compat, reversed>.<tier+level>.<constraints>
  //   { fourcc: 'vp09', config: vpcC }                    → vp09.PP.LL.DD
  //   { fourcc: 'vp09', profile, level, depth }           → vp09.PP.LL.DD (WebM: from the first key frame and the size)
  //   { fourcc: 'av01', config: av1C }                    → av01.P.LLT.DD
  //   { fourcc: 'vp08' }                                  → vp8
  // Any other fourcc comes back unchanged (ProRes 'apch', 'mp4v', …), and VideoDecoder.isConfigSupported refuses it.
  function codecString(info) {
    const c = info.config;
    switch (info.fourcc) {
      case 'avc1': case 'avc3':
        if (!c || c.length < 4) return info.fourcc;
        return info.fourcc + '.' + h2(c[1]) + h2(c[2]) + h2(c[3]);
      case 'hvc1': case 'hev1':
        return c && c.length >= 13 ? hevcString(info.fourcc, c) : info.fourcc;
      case 'vp09':
        if (c && c.length >= 7) return 'vp09.' + d2(c[4]) + '.' + d2(c[5]) + '.' + d2(c[6] >> 4);
        return 'vp09.' + d2(info.profile || 0) + '.' + d2(info.level || 10) + '.' + d2(info.depth || 8);
      case 'av01':
        return c && c.length >= 4 ? av1String(c) : 'av01';
      case 'vp08':
        return 'vp8';
      default:
        return String(info.fourcc || '');
    }
  }

  // ISO/IEC 14496-15 Annex E: hvc1.<A><idc>.<compatibility flags, bit-reversed, hex>.<L|H><level>[.<constraint bytes>]
  function hevcString(fourcc, c) {
    const space = c[1] >> 6, tier = (c[1] >> 5) & 1, idc = c[1] & 31;
    let flags = ((c[2] << 24) | (c[3] << 16) | (c[4] << 8) | c[5]) >>> 0;
    let rev = 0;
    for (let k = 0; k < 32; k++) { rev = (rev << 1) | (flags & 1); flags >>>= 1; }
    const cons = Array.from(c.subarray(6, 12));
    while (cons.length && cons[cons.length - 1] === 0) cons.pop();
    const parts = [fourcc, ['', 'A', 'B', 'C'][space] + idc, (rev >>> 0).toString(16).toUpperCase(), (tier ? 'H' : 'L') + c[12]];
    for (const b of cons) parts.push(h2(b));
    return parts.join('.');
  }

  // av01.<profile>.<level><tier>.<bit depth> from the av1C record (AV1 codec ISO BMFF binding, §5).
  function av1String(c) {
    const profile = c[1] >> 5, level = c[1] & 31, tier = c[2] >> 7, high = (c[2] >> 6) & 1, twelve = (c[2] >> 5) & 1;
    const depth = profile === 2 && high ? (twelve ? 12 : 10) : high ? 10 : 8;
    return 'av01.' + profile + '.' + d2(level) + (tier ? 'H' : 'M') + '.' + d2(depth);
  }

  // --- colour (ISO/IEC 23091-4 code points, as in MP4 'colr' and Matroska 'Colour') ------------------------------------

  // ColorInfo = { primaries, transfer, matrix, fullRange } (numbers; 2 = unspecified; fullRange null when unknown)
  const PRIMARIES = { 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020', 12: 'smpte432' };
  const TRANSFERS = { 1: 'bt709', 6: 'smpte170m', 8: 'linear', 13: 'iec61966-2-1', 16: 'pq', 18: 'hlg' };
  const MATRICES = { 0: 'rgb', 1: 'bt709', 5: 'bt470bg', 6: 'smpte170m', 9: 'bt2020-ncl' };

  // colorSpaceOf(color) → the VideoDecoderConfig.colorSpace init (only the members WebCodecs names), or undefined.
  function colorSpaceOf(color) {
    if (!color) return undefined;
    const out = {};
    if (PRIMARIES[color.primaries]) out.primaries = PRIMARIES[color.primaries];
    if (TRANSFERS[color.transfer]) out.transfer = TRANSFERS[color.transfer];
    if (MATRICES[color.matrix]) out.matrix = MATRICES[color.matrix];
    if (typeof color.fullRange === 'boolean') out.fullRange = color.fullRange;
    return Object.keys(out).length ? out : undefined;
  }

  // colorClass(color, fallback) → entry.color: 'bt709' | 'bt601' | 'bt2020' | 'p3' | 'other'; without a description the
  // fallback ('bt709' for HD video, 'bt601' for SD, the way decoders guess).
  function colorClass(color, fallback) {
    const p = color ? color.primaries : 2, m = color ? color.matrix : 2;
    if (p === 9 || m === 9 || m === 10) return 'bt2020';
    if (p === 12 || p === 11) return 'p3';
    if (p === 1 || m === 1) return 'bt709';
    if (p === 5 || p === 6 || m === 5 || m === 6) return 'bt601';
    if (p === 2 && m === 2) return fallback || 'bt709';
    return 'other';
  }

  // HDR: PQ (16) or HLG (18) transfer.
  function isHdr(color) { return !!color && (color.transfer === 16 || color.transfer === 18); }

  return { EPS, MediaError, build, sampleAt, keyAtOrBefore, runFor, presentationOf, toData, fromData, stats, codecString,
    vp9Level, median, colorSpaceOf, colorClass, isHdr };
});
