/* 文字PVメーカー v2 — original work. Song decoding (OfflineAudioContext), SHA-1 and chunked analysis in the browser (§4.13; the song's voice, DESIGN_2_2 §5.2). */
MV.def('audio/host/decode', ['audio/analyze', 'audio/digest', 'audio/peaks', 'audio/voice'], (A, D, P, VO) => {
  'use strict';

  const DECODE_RATE = 48000;        // every song is decoded at this rate (AAC export takes it as is)
  const SLICE_MS = 12;              // analysis runs in slices of about this long between yields to the page
  // loadSong's progress: the tempo analysis, then the voice (audio/voice costs about as much as the analysis)
  const VOICE_FROM = 0.5;

  class DecodeError extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = 'DecodeError';
      this.code = code;
    }
  }

  function hex(buffer) {
    const bytes = new Uint8Array(buffer);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
  }

  // sha1Hex(bytes: ArrayBuffer | Uint8Array) → Promise<string> (40 hex digits), the song's key in IndexedDB.
  async function sha1Hex(bytes) {
    return hex(await crypto.subtle.digest('SHA-1', bytes));
  }

  // decodeFile(file: Blob, { rate }) → Promise<{ buffer: AudioBuffer, sha1, name }>. Errors: DecodeError 'empty' (no
  // bytes), 'decode' (not audio the browser can read), 'unsupported' (no Web Audio); analyzeBuffer adds 'cancelled'.
  async function decodeFile(file, opts) {
    const rate = (opts && opts.rate) || DECODE_RATE;
    if (typeof OfflineAudioContext !== 'function') throw new DecodeError('unsupported', 'Web Audio is not available');
    const bytes = await file.arrayBuffer();
    if (!bytes.byteLength) throw new DecodeError('empty', 'the file is empty');
    const sha1 = await sha1Hex(bytes);
    const context = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: rate });
    let buffer;
    try {
      buffer = await context.decodeAudioData(bytes);
    } catch (err) {
      throw new DecodeError('decode', (err && err.message) || 'decoding failed');
    }
    if (!buffer || !buffer.length) throw new DecodeError('decode', 'no audio in the file');
    return { buffer, sha1, name: file.name || '' };
  }

  function channelsOf(buffer) {
    const out = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c));
    return out;
  }

  function pause() { return new Promise((resolve) => setTimeout(resolve, 0)); }

  // Steps a progress generator (audio/analyze, audio/voice) in slices of about SLICE_MS; onProgress(0..1) after each
  // slice and 1 at the end. A set signal stops it with DecodeError 'cancelled'.
  async function stepped(gen, o) {
    let sliceStart = performance.now();
    for (;;) {
      if (o.signal && o.signal.aborted) throw new DecodeError('cancelled', 'analysis cancelled');
      const r = gen.next();
      if (r.done) {
        if (o.onProgress) o.onProgress(1);
        return r.value;
      }
      if (performance.now() - sliceStart >= SLICE_MS) {
        if (o.onProgress) o.onProgress(r.value);
        await pause();
        sliceStart = performance.now();
      }
    }
  }

  // Progress reports of a stage mapped onto [a, b] of the whole.
  function part(o, a, b) {
    return Object.assign({}, o, { onProgress: o.onProgress ? (p) => o.onProgress(a + (b - a) * p) : null });
  }

  // analyzeBuffer(buffer, { signal, onProgress }) → Promise<SongAnalysis>: steps the analyze() generator in short slices
  // so the page stays responsive; onProgress(0..1) after each slice.
  function analyzeBuffer(buffer, opts) {
    return stepped(A.analyze(channelsOf(buffer), buffer.sampleRate, { step: 200 }), opts || {});
  }

  // analyzeVoice(buffer, { signal, onProgress }) → Promise<SongVoice>: the song's voice (audio/voice), encoded for
  // doc.song.voice. 曲の声を読む runs it for a song imported by an older build.
  async function analyzeVoice(buffer, opts) {
    const res = await stepped(VO.analyze(channelsOf(buffer), buffer.sampleRate, { step: 200 }), opts || {});
    return VO.encode(res);
  }

  // loadSong(file, { signal, onProgress }) → Promise<{ buffer, song, analysis, peaks }>: decode, analyze and build the
  // doc.song record (for `song.set`, with the song's voice) and the waveform peaks in one go.
  async function loadSong(file, opts) {
    const o = opts || {};
    const decoded = await decodeFile(file, o);
    const analysis = await analyzeBuffer(decoded.buffer, part(o, 0, VOICE_FROM));
    const voice = await analyzeVoice(decoded.buffer, part(o, VOICE_FROM, 1));
    const song = Object.assign(D.songRecord({ name: decoded.name, sha1: decoded.sha1 }, analysis), { voice });
    return {
      buffer: decoded.buffer,
      analysis,
      song,
      peaks: P.peaks(channelsOf(decoded.buffer), decoded.buffer.sampleRate),
    };
  }

  return { DECODE_RATE, DecodeError, sha1Hex, decodeFile, channelsOf, analyzeBuffer, analyzeVoice, loadSong };
});
