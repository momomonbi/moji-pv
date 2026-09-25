/* 文字PVメーカー v2 — original work. 16-bit mono WAV encoder for the AI song features (§4.13). */
MV.def('audio/wav', [], () => {
  'use strict';

  const DEFAULT_RATE = 16000;      // speech-rate audio keeps the upload small
  const HEADER_BYTES = 44;
  const LIFT_BELOW = 0.5;          // quiet masters are lifted so their peak reaches this; nothing is ever clipped

  function writeAscii(view, offset, text) {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  }

  function writeHeader(view, rate, samples) {
    const dataBytes = samples * 2;
    writeAscii(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeAscii(view, 8, 'WAVE');
    writeAscii(view, 12, 'fmt ');
    view.setUint32(16, 16, true);          // fmt chunk size
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);    // bytes per second
    view.setUint16(32, 2, true);           // block align
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
    writeHeader(view, rate, nOut);
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

  return { DEFAULT_RATE, encodeWav };
});
