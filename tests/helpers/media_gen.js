/* 文字PVメーカー v2 — original work. Test media made in the browser: the counter video (VP9 / H.264, MP4 / WebM, VFR, alpha), stills, a WAV (DESIGN_2_1 §11.8.1). */
// Browser only (window.MVMediaGen); uses VideoEncoder, OffscreenCanvas, the vendored Mp4Muxer and the app's export/webm.
// The counter video: frame i shows i as a 12-bit code in 8×8-px cells (white = 1, most significant bit first) and the
// same bits inverted in the row below, inside a white guard frame, at 192×108. readCounter() reads a frame back and
// returns -1 unless the guard and the inverted row agree, so a wrong, blended or damaged frame never passes as another.
(function (G) {
  'use strict';

  const W = 192, H = 108, CELL = 8, BITS = 12;
  const X0 = (W - BITS * CELL) / 2, ROW1 = 40, ROW2 = 56, GUARD = 4;

  function drawCounter(ctx, i, alphaSquare) {
    ctx.fillStyle = '#202020';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, GUARD); ctx.fillRect(0, H - GUARD, W, GUARD); ctx.fillRect(0, 0, GUARD, H); ctx.fillRect(W - GUARD, 0, GUARD, H);
    for (let k = 0; k < BITS; k++) {
      const bit = (i >> (BITS - 1 - k)) & 1;
      ctx.fillStyle = bit ? '#ffffff' : '#000000';
      ctx.fillRect(X0 + k * CELL, ROW1, CELL, CELL);
      ctx.fillStyle = bit ? '#000000' : '#ffffff';
      ctx.fillRect(X0 + k * CELL, ROW2, CELL, CELL);
    }
    if (alphaSquare) {                                 // a square that moves 4 px per frame (its alpha is in the alpha stream)
      ctx.fillStyle = '#e04030';
      ctx.fillRect(squareX(i), 76, 24, 24);
    }
  }

  function squareX(i) { return 8 + ((i * 4) % (W - 40)); }

  // readCounter(rgba, w, h) → i, or -1. w × h is the size of the image read (the pattern scaled to it).
  function readCounter(px, w, h) {
    const sx = w / W, sy = h / H;
    const luma = (x, y) => {
      const p = 4 * (Math.floor(y * sy) * w + Math.floor(x * sx));
      return 0.299 * px[p] + 0.587 * px[p + 1] + 0.114 * px[p + 2];
    };
    if (luma(2, H / 2) < 160 || luma(W - 2, H / 2) < 160 || luma(W / 2, 2) < 160) return -1;
    let v = 0;
    for (let k = 0; k < BITS; k++) {
      const a = luma(X0 + k * CELL + CELL / 2, ROW1 + CELL / 2) > 128;
      const b = luma(X0 + k * CELL + CELL / 2, ROW2 + CELL / 2) > 128;
      if (a === b) return -1;
      v = (v << 1) | (a ? 1 : 0);
    }
    return v;
  }

  // Draws a CanvasImageSource (rotated by rot, clockwise, to upright) into a W×H canvas and reads its code.
  function codeOf(image, rot) {
    const c = new OffscreenCanvas(W, H);
    const ctx = c.getContext('2d');
    ctx.save();
    if (rot === 90) { ctx.translate(W, 0); ctx.rotate(Math.PI / 2); ctx.drawImage(image, 0, 0, H, W); }
    else if (rot === 180) { ctx.translate(W, H); ctx.rotate(Math.PI); ctx.drawImage(image, 0, 0, W, H); }
    else if (rot === 270) { ctx.translate(0, H); ctx.rotate(-Math.PI / 2); ctx.drawImage(image, 0, 0, H, W); }
    else ctx.drawImage(image, 0, 0, W, H);
    ctx.restore();
    return readCounter(ctx.getImageData(0, 0, W, H).data, W, H);
  }

  // Frame times (s): constant rate, or VFR (frames 0–29 at 30 fps, then 15 fps).
  function timesOf(frames, fps, vfr) {
    const out = [];
    for (let i = 0; i < frames; i++) out.push(vfr ? (i < 30 ? i / 30 : 1 + (i - 30) / 15) : i / fps);
    return out;
  }

  async function supported(codec, w, h, fps) {
    if (typeof VideoEncoder === 'undefined') return false;
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: 1500000, framerate: fps });
      return !!(r && r.supported);
    } catch (e) { return false; }
  }

  // The first H.264 profile this browser encodes, or null (the local Chromium has none).
  async function h264() {
    for (const c of ['avc1.42E01E', 'avc1.4D401E', 'avc1.64001E']) if (await supported(c, W, H, 30)) return c;
    return null;
  }

  // Encodes frames with a VideoEncoder → [{ data, key, ts (µs), dur (µs), meta }]. `source(i)` gives the VideoFrame.
  async function encode(codec, frames, times, keyEvery, source, opts) {
    const chunks = [];
    let failure = null;
    const enc = new VideoEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        chunks.push({ data, key: chunk.type === 'key', ts: chunk.timestamp, dur: chunk.duration, meta, chunk });
      },
      error: (e) => { failure = e; },
    });
    enc.configure(Object.assign({ codec, width: W, height: H, bitrate: 1500000, framerate: 30, latencyMode: 'quality' }, opts || {}));
    for (let i = 0; i < frames; i++) {
      const ts = Math.round(times[i] * 1e6);
      const next = i + 1 < frames ? Math.round(times[i + 1] * 1e6) : ts + (i ? ts - Math.round(times[i - 1] * 1e6) : 33333);
      const frame = source(i, ts, next - ts);
      enc.encode(frame, { keyFrame: i % keyEvery === 0 });
      frame.close();
      while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 1));
    }
    await enc.flush();
    enc.close();
    if (failure) throw failure;
    return chunks;
  }

  function colourFrame(i, ts, dur, alphaSquare) {
    const c = new OffscreenCanvas(W, H);
    drawCounter(c.getContext('2d'), i, alphaSquare);
    return new VideoFrame(c, { timestamp: ts, duration: dur, alpha: 'discard' });
  }

  // The alpha stream's frame: I420 with Y = alpha (a half-transparent square, 128, on 0), U = V = 128, full range.
  function alphaFrame(i, ts, dur) {
    const y = new Uint8Array(W * H), uv = (W / 2) * (H / 2);
    const x0 = squareX(i);
    for (let r = 76; r < 100; r++) for (let x = x0; x < x0 + 24; x++) y[r * W + x] = 128;
    const buf = new Uint8Array(W * H + 2 * uv);
    buf.set(y, 0);
    buf.fill(128, W * H);
    return new VideoFrame(buf, { format: 'I420', codedWidth: W, codedHeight: H, timestamp: ts, duration: dur,
      colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: true } });
  }

  const BT709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false };

  // encodeCounter({ codec, container: 'mp4' | 'webm', fps, frames, vfr, alpha, rotation, keyEvery })
  //   → { bytes: Uint8Array, times: [s], codec, keys: [bool] }
  async function encodeCounter(o) {
    const fps = o.fps || 30, frames = o.frames || 45, keyEvery = o.keyEvery || 30;
    const times = timesOf(frames, fps, !!o.vfr);
    const codec = o.codec || 'vp09.00.10.08';
    const chunks = await encode(codec, frames, times, keyEvery, (i, ts, dur) => colourFrame(i, ts, dur, !!o.alpha), { framerate: fps });
    if (chunks.length !== frames) throw new Error('media_gen: ' + chunks.length + ' chunks for ' + frames + ' frames');
    let alphaChunks = null;
    if (o.alpha) alphaChunks = await encode(codec, frames, times, keyEvery, alphaFrame, { framerate: fps, bitrate: 400000 });
    const keys = chunks.map((c, i) => c.key && (!alphaChunks || alphaChunks[i].key));
    let bytes;
    if (o.container === 'webm') {
      const Wm = MV.use('export/webm');
      let buf = new Uint8Array(0);
      const write = async (b, pos) => {
        const at = pos === undefined ? buf.length : pos;
        if (at + b.length > buf.length) { const n = new Uint8Array(at + b.length); n.set(buf); buf = n; }
        buf.set(b, at);
      };
      const w = Wm.createWebm({ write, w: W, h: H, fps, video: { codec: /^vp8/.test(codec) ? 'V_VP8' : 'V_VP9', alpha: !!o.alpha } });
      for (let i = 0; i < frames; i++) await w.video(chunks[i].data, alphaChunks ? alphaChunks[i].data : null, keys[i], chunks[i].ts);
      await w.finish();
      bytes = buf;
    } else {
      const avc = /^avc/.test(codec);
      const target = new Mp4Muxer.ArrayBufferTarget();
      const mux = new Mp4Muxer.Muxer({ target, video: { codec: avc ? 'avc' : /^av01/.test(codec) ? 'av1' : 'vp9', width: W, height: H,
        rotation: o.rotation || 0 }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
      for (let i = 0; i < frames; i++) {
        const c = chunks[i];
        const meta = c.meta && c.meta.decoderConfig ? { decoderConfig: Object.assign({}, c.meta.decoderConfig) } : undefined;
        if (meta && !meta.decoderConfig.colorSpace) meta.decoderConfig.colorSpace = BT709;
        const next = i + 1 < frames ? chunks[i + 1].ts : c.ts + (c.dur || Math.round(1e6 / fps));
        mux.addVideoChunkRaw(c.data, c.key ? 'key' : 'delta', c.ts, next - c.ts, meta);
      }
      mux.finalize();
      bytes = new Uint8Array(target.buffer);
    }
    for (const c of chunks) c.chunk = null;
    return { bytes, times, codec, keys };
  }

  // Stills: a PNG with a half-transparent area, a JPEG, a WebP, and a JPEG stored 64×32 with EXIF orientation 6 whose
  // stored bottom-left corner is blue (after turning upright it is the top-left one).
  async function stills() {
    const c = new OffscreenCanvas(96, 64);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3080d0'; ctx.fillRect(0, 0, 96, 64);
    ctx.fillStyle = '#f0c040'; ctx.fillRect(10, 10, 40, 30);
    const jpeg = await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    const webp = await c.convertToBlob({ type: 'image/webp', quality: 0.9 });
    ctx.clearRect(60, 0, 36, 64);
    ctx.fillStyle = 'rgba(200, 40, 40, 0.5)'; ctx.fillRect(60, 20, 30, 30);
    const png = await c.convertToBlob({ type: 'image/png' });
    const e = new OffscreenCanvas(64, 32);
    const ex = e.getContext('2d');
    ex.fillStyle = '#e0e0e0'; ex.fillRect(0, 0, 64, 32);
    ex.fillStyle = '#0000ff'; ex.fillRect(0, 16, 16, 16);       // stored bottom-left: blue
    ex.fillStyle = '#ff0000'; ex.fillRect(0, 0, 16, 16);        // stored top-left: red
    const plain = new Uint8Array(await (await e.convertToBlob({ type: 'image/jpeg', quality: 0.95 })).arrayBuffer());
    const exif6 = new Blob([MVExif.withOrientation(plain, 6)], { type: 'image/jpeg' });
    return { png, jpeg, webp, exif6 };
  }

  // A 16-bit stereo WAV of `seconds` of a 440 / 660 Hz tone at `rate`.
  function wav(seconds, rate) {
    const r = rate || 48000, n = Math.round(seconds * r);
    const buf = new ArrayBuffer(44 + n * 4);
    const v = new DataView(buf);
    const text = (at, s) => { for (let k = 0; k < s.length; k++) v.setUint8(at + k, s.charCodeAt(k)); };
    text(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); text(8, 'WAVE'); text(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, r, true);
    v.setUint32(28, r * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); text(36, 'data'); v.setUint32(40, n * 4, true);
    for (let i = 0; i < n; i++) {
      v.setInt16(44 + 4 * i, Math.round(9000 * Math.sin((2 * Math.PI * 440 * i) / r)), true);
      v.setInt16(46 + 4 * i, Math.round(9000 * Math.sin((2 * Math.PI * 660 * i) / r)), true);
    }
    return new Uint8Array(buf);
  }

  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="#204080"/>' +
    '<circle cx="50" cy="50" r="40" fill="#f0c040"/></svg>';

  G.MVMediaGen = { W, H, drawCounter, readCounter, codeOf, timesOf, supported, h264, encodeCounter, stills, wav, SVG, squareX };
})(typeof globalThis !== 'undefined' ? globalThis : this);
