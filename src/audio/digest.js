/* 文字PVメーカー v2 — original work. The persisted 20 Hz loudness digest, its envelope and closed-form level lookups (§4.13). */
MV.def('audio/digest', [], () => {
  'use strict';

  const HZ = 20;
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const B64_INDEX = (() => {
    const map = new Int16Array(128).fill(-1);
    for (let i = 0; i < B64.length; i++) map[B64.charCodeAt(i)] = i;
    return map;
  })();

  function formatError(message) {
    const e = new TypeError(message);
    e.code = 'format';
    return e;
  }

  function toBase64(bytes) {
    let out = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + B64[v & 63];
    }
    const rest = bytes.length - i;
    if (rest === 1) {
      const v = bytes[i] << 16;
      out += B64[v >> 18] + B64[(v >> 12) & 63] + '==';
    } else if (rest === 2) {
      const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += B64[v >> 18] + B64[(v >> 12) & 63] + B64[(v >> 6) & 63] + '=';
    }
    return out;
  }

  // Standard base64 with optional padding; whitespace is ignored. Throws code 'format' on other characters.
  function fromBase64(text) {
    const s = String(text).replace(/[\s=]+/g, '');
    const out = new Uint8Array(Math.floor((s.length * 3) / 4));
    let acc = 0, bits = 0, o = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      const v = c < 128 ? B64_INDEX[c] : -1;
      if (v < 0) throw formatError('fromBase64: bad character at ' + i);
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[o++] = (acc >> bits) & 255;
      }
    }
    return o === out.length ? out : out.subarray(0, o);
  }

  // A track max-pooled from its rate to 20 Hz, as bytes 0..255.
  function pooled(src, hz) {
    const count = Math.max(0, Math.ceil((src.length * HZ) / hz - 1e-9));
    const bytes = new Uint8Array(count);
    for (let j = 0; j < count; j++) {
      const a = Math.floor((j * hz) / HZ + 1e-9);
      const b = Math.min(src.length, Math.ceil(((j + 1) * hz) / HZ - 1e-9));
      let m = 0;
      for (let i = a; i < b; i++) if (src[i] > m) m = src[i];
      bytes[j] = Math.round((m > 1 ? 1 : m) * 255);
    }
    return bytes;
  }

  // digest(analysis) → { hz: 20, loud: base64, nb?, bands? }: the analysis envelope max-pooled to 20 Hz, as bytes
  // 0..255, and the loudness of its nb spectrum bands (bass → treble) the same way, interleaved (sample j, band k at
  // j·nb + k).
  function digest(analysis) {
    const env = analysis.env;
    const out = { hz: HZ, loud: toBase64(pooled(env.loud, env.hz)) };
    if (Array.isArray(env.bands) && env.bands.length) {
      const per = env.bands.map((b) => pooled(b, env.hz)), nb = per.length, n = per[0].length;
      const bytes = new Uint8Array(n * nb);
      for (let j = 0; j < n; j++) for (let k = 0; k < nb; k++) bytes[j * nb + k] = per[k][j];
      out.nb = nb;
      out.bands = toBase64(bytes);
    }
    return out;
  }

  // envFromDigest(digest) → { hz, loud: Float32Array 0..1, nb?, bands? }. This is what `plan.env` holds. Bands that do
  // not match the loudness in length are left out (an older digest has none).
  function envFromDigest(d) {
    if (!d || !(d.hz > 0) || typeof d.loud !== 'string') throw formatError('envFromDigest: expected { hz, loud: base64 }');
    const bytes = fromBase64(d.loud);
    const loud = new Float32Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) loud[i] = bytes[i] / 255;
    const out = { hz: d.hz, loud };
    if (Number.isInteger(d.nb) && d.nb > 0 && typeof d.bands === 'string') {
      const b = fromBase64(d.bands);
      if (b.length === loud.length * d.nb) {
        out.nb = d.nb;
        out.bands = new Float32Array(b.length);
        for (let i = 0; i < b.length; i++) out.bands[i] = b[i] / 255;
      }
    }
    return out;
  }

  // band(env, k, t) → 0..1, the loudness of spectrum band k (0 the bass), as level reads the envelope; null when the
  // envelope keeps no bands.
  function band(env, k, t) {
    if (!env || !env.bands) return null;
    const nb = env.nb, n = env.loud.length, kk = Math.max(0, Math.min(nb - 1, k));
    if (n === 0 || !(t >= 0) || t >= n / env.hz) return 0;
    const u = t * env.hz - 0.5;
    if (u <= 0) return env.bands[kk];
    if (u >= n - 1) return env.bands[(n - 1) * nb + kk];
    const i = Math.floor(u), a = env.bands[i * nb + kk];
    return a + (env.bands[(i + 1) * nb + kk] - a) * (u - i);
  }

  // level(env, t) → 0..1. Sample i stands for the middle of its window, (i + 0.5) / hz; between samples the value is
  // interpolated linearly; before 0 and after the envelope's end the song is silent (0). No env (no song) → 0.5.
  function level(env, t) {
    if (!env) return 0.5;
    const loud = env.loud;
    const n = loud.length;
    if (n === 0 || !(t >= 0) || t >= n / env.hz) return 0;
    const u = t * env.hz - 0.5;
    if (u <= 0) return loud[0];
    if (u >= n - 1) return loud[n - 1];
    const i = Math.floor(u);
    return loud[i] + (loud[i + 1] - loud[i]) * (u - i);
  }

  function round(x, digits) {
    const k = 10 ** digits;
    return Math.round(x * k) / k;
  }

  // songRecord({ name, sha1 }, analysis) → the doc.song object for `song.set` (§3.1); numbers rounded for the file.
  function songRecord(file, analysis) {
    return {
      name: String(file.name || ''),
      sha1: String(file.sha1 || ''),
      seconds: round(analysis.duration, 3),
      bpm: analysis.bpm === null ? null : round(analysis.bpm, 2),
      offset: round(analysis.offset, 3),
      meter: analysis.meter,
      bpmConfidence: round(analysis.bpmConfidence, 2),
      digest: digest(analysis),
      info: null,
    };
  }

  return { HZ, digest, envFromDigest, level, band, songRecord, toBase64, fromBase64 };
});
