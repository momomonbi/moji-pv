/* 文字PVメーカー v2 — original work. WAV encoders: 16-bit mono for the AI song features (§4.13), 16-bit PCM of the export range for the Filmora kit, and the export down-mix (§4.21; DESIGN_2_1 §13.4). */
MV.def('audio/wav', [], () => {
  'use strict';

  const DEFAULT_RATE = 16000;      // speech-rate audio keeps the upload small
  const HEADER_BYTES = 44;
  const LIFT_BELOW = 0.5;          // quiet masters are lifted so their peak reaches this; nothing is ever clipped
  const PCM_BLOCK = 65536;         // frames converted per step by pcm16Data (bounds the planar scratch buffer)

  function writeAscii(view, offset, text) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }

  // The 44-byte RIFF header of 16-bit PCM: `channels` interleaved channels at `rate`, `frames` sample frames.
  function writeHeader(view, rate, frames, channels) {
    const block = channels * 2;
    const dataBytes = frames * block;
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);          // fmt chunk size
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, channels, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * block, true);  // bytes per second
    view.setUint16(32, block, true);       // block align
    view.setUint16(34, 16, true);          // bits per sample
    writeAscii(view, 36, 'data');
    view.setUint32(40, dataBytes, true);
  }

  // encodeWav(channels, sampleRate, rate = 16000) → Uint8Array. Each output sample is the mean of the source samples
  // (all channels) that fall into it. The arithmetic order is fixed, so the bytes never drift (audio.test.js pins them).
  function encodeWav(channels, sampleRate, rate = DEFAULT_RATE) {
    const nIn = channels[0].length;
    const ratio = sampleRate / rate;
    const nOut = Math.max(0, Math.floor(nIn / ratio));
    const view = new DataView(new ArrayBuffer(HEADER_BYTES + nOut * 2));
    writeHeader(view, rate, nOut, 1);
    const nc = channels.length;
    const mono = new Float32Array(nOut);
    let peak = 0;
    for (let j = 0; j < nOut; j++) {
      const a = Math.floor(j * ratio);
      const b = Math.max(a + 1, Math.min(nIn, Math.floor((j + 1) * ratio)));
      let sum = 0;
      for (let c = 0; c < nc; c++) {
        const data = channels[c];
        for (let i = a; i < b; i++) sum += data[i];
      }
      const v = sum / ((b - a) * nc);
      mono[j] = v;
      const mag = v < 0 ? -v : v;
      if (mag > peak) peak = mag;
    }
    const gain = peak > 0 && peak < LIFT_BELOW ? LIFT_BELOW / peak : 1;
    for (let j = 0; j < nOut; j++) {
      const v = Math.max(-1, Math.min(1, mono[j] * gain));
      view.setInt16(HEADER_BYTES + j * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return new Uint8Array(view.buffer);
  }

  // --- the export down-mix (§4.21) -----------------------------------------------------------------------------------

  const HALF = 0.5;
  const ROOT_HALF = Math.SQRT1_2;

  // mixMatrix(inCount, outCount) → for each output channel, its [source channel, gain] terms. Stereo output follows the
  // Web Audio 'speakers' down-mix, which is what the player plays: mono goes to both sides; quad (L R SL SR) folds each
  // surround into its side at ½; 5.1 (L R C LFE SL SR) adds √½ of the centre and of each surround and drops the LFE.
  // Other layouts, and other output counts, are 'discrete': channel c from channel c, a mono source copied everywhere.
  function mixMatrix(inCount, outCount) {
    if (outCount === 2 && inCount === 4) return [[[0, HALF], [2, HALF]], [[1, HALF], [3, HALF]]];
    if (outCount === 2 && inCount === 6) {
      return [[[0, 1], [2, ROOT_HALF], [4, ROOT_HALF]], [[1, 1], [2, ROOT_HALF], [5, ROOT_HALF]]];
    }
    const out = [];
    for (let c = 0; c < outCount; c++) out.push(inCount === 1 ? [[0, 1]] : c < inCount ? [[c, 1]] : []);
    return out;
  }

  // fillPlanar(out, channels, start, frames, outChannels = 2): planar f32 samples [start, start + frames) of the source,
  // zero outside it, mixed down (or copied) to outChannels by mixMatrix.
  function fillPlanar(out, channels, start, frames, outChannels = 2) {
    const matrix = mixMatrix(channels.length, outChannels);
    for (let c = 0; c < outChannels; c++) {
      const base = c * frames;
      out.fill(0, base, base + frames);
      for (const [from, gain] of matrix[c]) {
        const src = channels[from];
        const a = Math.max(0, -start), b = Math.min(frames, src.length - start);
        for (let i = a; i < b; i++) out[base + i] += gain * src[start + i];
      }
    }
    return out;
  }

  // --- 16-bit PCM of the export range (the kit's song file, DESIGN_2_1 §13.4) ------------------------------------------

  // A sample in [-1, 1] (clamped; NaN is silence) → a 16-bit value: × 32767, rounded to the nearest (halves up).
  function toInt16(v) {
    if (!(v > -1)) return v <= -1 ? -32767 : 0;
    if (v >= 1) return 32767;
    return Math.round(v * 32767);
  }

  function checkFrames(start, frames) {
    if (!Number.isInteger(start)) throw new RangeError('wav: start must be an integer (a sample index)');
    if (!(Number.isInteger(frames) && frames >= 0)) throw new RangeError('wav: frames must be an integer ≥ 0');
    if (frames * 4 + 36 > 0xffffffff) throw new RangeError('wav: more than 4 GB of samples');
  }

  // pcm16Header(rate, frames, outChannels = 2) → the 44-byte RIFF header of `frames` frames of 16-bit PCM.
  function pcm16Header(rate, frames, outChannels = 2) {
    if (!(Number.isInteger(rate) && rate > 0)) throw new RangeError('wav: rate must be a positive integer');
    checkFrames(0, frames);
    const bytes = new Uint8Array(HEADER_BYTES);
    writeHeader(new DataView(bytes.buffer), rate, frames, outChannels);
    return bytes;
  }

  // pcm16Data(channels, start, frames, outChannels = 2) → Uint8Array: the samples [start, start + frames) of the source
  // (Float32Array per channel; silence outside it), mixed down by fillPlanar and interleaved as 16-bit little-endian.
  // Consecutive ranges concatenate to exactly the bytes of one call over their union, so a long song can be written in
  // pieces.
  function pcm16Data(channels, start, frames, outChannels = 2) {
    checkFrames(start, frames);
    const bytes = new Uint8Array(frames * outChannels * 2);
    const view = new DataView(bytes.buffer);
    const planar = new Float32Array(Math.min(frames, PCM_BLOCK) * outChannels);
    for (let from = 0; from < frames; from += PCM_BLOCK) {
      const n = Math.min(PCM_BLOCK, frames - from);
      fillPlanar(planar, channels, start + from, n, outChannels);
      for (let c = 0; c < outChannels; c++) {
        const base = c * n;
        for (let i = 0; i < n; i++) view.setInt16(((from + i) * outChannels + c) * 2, toInt16(planar[base + i]), true);
      }
    }
    return bytes;
  }

  // encodePcm16(channels, rate, start, frames) → Uint8Array: a complete WAV file (PCM 16-bit stereo at `rate`) of exactly
  // `frames` frames starting at source sample `start` — zero-padded past the song's end, mixed down like the MP4 sound.
  function encodePcm16(channels, rate, start, frames) {
    const head = pcm16Header(rate, frames, 2);
    const data = pcm16Data(channels, start, frames, 2);
    const out = new Uint8Array(HEADER_BYTES + data.length);
    out.set(head, 0);
    out.set(data, HEADER_BYTES);
    return out;
  }

  return { DEFAULT_RATE, HEADER_BYTES, encodeWav, mixMatrix, fillPlanar, pcm16Header, pcm16Data, encodePcm16 };
});
