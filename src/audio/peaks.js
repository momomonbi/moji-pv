/* 文字PVメーカー v2 — original work. Waveform peaks: a min/max mip chain for drawing the song on the timeline (§4.13). */
MV.def('audio/peaks', [], () => {
  'use strict';

  const BASE_SPP = 128;            // samples per peak at the finest level
  const MIN_LENGTH = 256;          // the chain stops once a level has at most this many peaks

  function firstLevel(channels, n, spp) {
    const count = Math.ceil(n / spp);
    const min = new Float32Array(count);
    const max = new Float32Array(count);
    for (let p = 0; p < count; p++) {
      const a = p * spp;
      const b = Math.min(n, a + spp);
      let lo = Infinity, hi = -Infinity;
      for (const data of channels) {
        for (let i = a; i < b; i++) {
          const v = data[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      min[p] = lo;
      max[p] = hi;
    }
    return { spp, min, max };
  }

  function halve(level) {
    const count = Math.ceil(level.min.length / 2);
    const min = new Float32Array(count);
    const max = new Float32Array(count);
    for (let p = 0; p < count; p++) {
      const a = 2 * p, b = Math.min(level.min.length - 1, a + 1);
      min[p] = Math.min(level.min[a], level.min[b]);
      max[p] = Math.max(level.max[a], level.max[b]);
    }
    return { spp: level.spp * 2, min, max };
  }

  // peaks(channels, sampleRate, { base, minLength }) → { rate, levels: [{ spp, min, max }] }, finest level first; each
  // level doubles the samples per peak. Min/max run over every channel.
  function peaks(channels, sampleRate, opts) {
    const base = (opts && opts.base) || BASE_SPP;
    const minLength = (opts && opts.minLength) || MIN_LENGTH;
    let n = channels.length ? channels[0].length : 0;
    for (const c of channels) n = Math.min(n, c.length);
    const levels = [firstLevel(channels, n, base)];
    while (levels[levels.length - 1].min.length > minLength) levels.push(halve(levels[levels.length - 1]));
    return { rate: sampleRate, levels };
  }

  // levelFor(peaks, samplesPerPixel) → the coarsest level that still has at least one peak per pixel.
  function levelFor(p, samplesPerPixel) {
    let pick = p.levels[0];
    for (const level of p.levels) if (level.spp <= samplesPerPixel) pick = level;
    return pick;
  }

  return { BASE_SPP, peaks, levelFor };
});
