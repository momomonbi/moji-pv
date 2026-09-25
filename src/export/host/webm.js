/* 文字PVメーカー v2 — original work. Transparent WebM export: engine fork → RGBA frames → two VP9 encoders (colour, alpha as luma) → export/webm with Opus → sink (DESIGN_2_1 §13.5). */
MV.def('export/host/webm', ['export/schedule', 'export/webm', 'export/host/mp4'], (S, W, J) => {
  'use strict';

  const CODEC_IDS = Object.freeze({ vp09: 'V_VP9', vp8: 'V_VP8' });
  const OPUS = Object.freeze(['opus']);
  const AUDIO_SLICE_US = 5000000;   // the song is fed to the Opus encoder 5 s at a time (cancel is checked in between)
  // The alpha stream's frame: I420 whose Y plane is the alpha bytes, full range, so 0 stays 0 and 255 stays 255.
  const ALPHA_SPACE = Object.freeze({ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: true });

  // 'vp09.00.40.08' → 'V_VP9', 'vp8' → 'V_VP8'.
  function codecId(codec) {
    const id = CODEC_IDS[String(codec).split('.')[0]];
    if (!id) throw new S.ExportError('codec', 'no WebM mapping for codec ' + codec);
    return id;
  }

  function bytesOf(chunk) {
    const out = new Uint8Array(chunk.byteLength);
    chunk.copyTo(out);
    return out;
  }

  function descriptionOf(meta) {
    const d = meta && meta.decoderConfig && meta.decoderConfig.description;
    if (!d) return null;
    if (d instanceof ArrayBuffer) return new Uint8Array(d.slice(0));
    return new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
  }

  // encodeSong(song, job, { codecs, signal }) → { config, description, packets: [{ data, ts }] } | null: the whole export
  // range of the song as Opus (48 kHz stereo, 160 kbps), made BEFORE the video (NOTES ## v2.1-H.1: the Tracks element,
  // and with it the OpusHead, is written when the WebM is created; audio that lags behind makes the writer hold video
  // clusters in memory). Exactly audioFrames(N) samples from t0, in 1024-frame chunks (the MP4's feeder). null when no
  // Opus encoder exists. `codecs.webmAudio` (tests) replaces the codec list.
  async function encodeSong(song, job, o) {
    const opts = o || {};
    const list = opts.codecs && Array.isArray(opts.codecs.webmAudio) ? opts.codecs.webmAudio : OPUS;
    const config = await J.audioConfig(null, song, list);
    if (!config) return null;
    const packets = [];
    let description = null, failure = null;
    const encoder = new AudioEncoder({
      output: (chunk, meta) => {
        if (!description) description = descriptionOf(meta);
        packets.push({ data: bytesOf(chunk), ts: chunk.timestamp });
      },
      error: (err) => { failure = failure || new S.ExportError('encode', 'audio encoding failed: ' + err.message, err); },
    });
    try {
      encoder.configure(config);
      const feeder = J.createAudioFeeder(encoder, song, job, config.sampleRate);
      const end = S.ts(job.N, job.fps);
      for (let us = 0; us < end + AUDIO_SLICE_US; us += AUDIO_SLICE_US) {
        J.checkAbort(opts.signal);
        if (failure) throw failure;
        feeder.until(us);
        await J.drain(encoder);
      }
      feeder.until(Infinity);
      await encoder.flush();
      if (failure) throw failure;
      return { config, description, packets };
    } finally {
      J.closeQuietly(encoder);
    }
  }

  // createAlphaOutput({ sink, job, config, audio }) → { frame(i, surface), flush(), end() → { bytes, blob?, stats },
  // close(), failure }: one transparent WebM (DESIGN_2_1 §13.5). `config` is the VP9 (or VP8) encoder config of the
  // colour stream (vp9Config); the alpha stream uses the same codec at alphaBitrate. `audio` is encodeSong()'s result
  // (its packets are handed to the writer before any video) or null.
  //   frame(i, surface): one readback of the surface (straight RGBA), then the colour frame (RGBA, alpha discarded by the
  //     encoder) and the alpha frame (I420, Y = alpha, U = V = 128, full range), both at ts(i) / frameDur(i), key frames
  //     forced on both every 2·fps; waits while either encoder queue is full.
  //   The two encoders' chunks are paired by timestamp and written as one BlockGroup each; `key` is true only when both
  //   chunks are key frames (NOTES ## v2.1-H.1).
  function createAlphaOutput(o) {
    const job = o.job, sink = o.sink, config = o.config;
    const w = job.w, h = job.h;
    let failure = null;
    const fail = (err) => { failure = failure || err; };
    const writer = W.createWebm({
      write: (bytes, position) => sink.write(bytes, position), w, h, fps: job.fps,
      video: { codec: codecId(config.codec), alpha: true },
      audio: o.audio ? { rate: o.audio.config.sampleRate, channels: 2, codecPrivate: o.audio.description } : null,
    });
    if (o.audio) for (const p of o.audio.packets) writer.audio(p.data, p.ts);
    const colours = [], alphas = [];
    let written = Promise.resolve();
    let frames = 0;
    function pair() {
      while (colours.length && alphas.length) {
        const c = colours.shift(), a = alphas.shift();
        if (c.timestamp !== a.timestamp) throw new S.ExportError('encode', 'the colour and alpha streams are out of step at ' + c.timestamp);
        written = writer.video(c, a, c.type === 'key' && a.type === 'key', c.timestamp);
        frames++;
      }
    }
    const encoder = (queue, what) => new VideoEncoder({
      output: (chunk) => { queue.push(chunk); try { pair(); } catch (err) { fail(err); } },
      error: (err) => fail(new S.ExportError('encode', what + ' encoding failed: ' + err.message, err)),
    });
    const colour = encoder(colours, 'colour');
    const alpha = encoder(alphas, 'alpha');
    try {
      colour.configure(config);
      alpha.configure(Object.assign({}, config, { bitrate: S.alphaBitrate(config.bitrate) }));
    } catch (err) {
      J.closeQuietly(colour);
      J.closeQuietly(alpha);
      throw err;
    }
    const ySize = w * h, cSize = Math.ceil(w / 2) * Math.ceil(h / 2);
    const plane = new Uint8Array(ySize + 2 * cSize);     // reused: VideoFrame copies it
    plane.fill(128, ySize);
    const keyEvery = S.keyInterval(job.fps);
    return {
      get failure() { return failure; },
      async frame(i, surface) {
        if (failure) throw failure;
        const px = surface.ctx.getImageData(0, 0, w, h).data;
        for (let k = 0, p = 3; k < ySize; k++, p += 4) plane[k] = px[p];
        const timestamp = S.ts(i, job.fps), duration = S.frameDur(i, job.fps);
        const keyFrame = i % keyEvery === 0;
        const c = new VideoFrame(px, { format: 'RGBA', codedWidth: w, codedHeight: h, timestamp, duration });
        try { colour.encode(c, { keyFrame }); } finally { c.close(); }
        const a = new VideoFrame(plane, { format: 'I420', codedWidth: w, codedHeight: h, timestamp, duration, colorSpace: ALPHA_SPACE });
        try { alpha.encode(a, { keyFrame }); } finally { a.close(); }
        await J.drain(colour);
        await J.drain(alpha);
        await written;
      },
      async flush() {
        await colour.flush();
        await alpha.flush();
        if (failure) throw failure;
        if (colours.length || alphas.length) throw new S.ExportError('encode', 'the colour and alpha streams have different lengths');
        if (frames !== job.N) throw new S.ExportError('encode', 'the encoders gave ' + frames + ' frames for ' + job.N);
      },
      async end() {
        if (failure) throw failure;
        J.closeQuietly(colour);
        J.closeQuietly(alpha);
        const stats = await writer.finish();
        const done = await sink.close();
        return { bytes: done.bytes, blob: done.blob, stats };
      },
      close() {
        J.closeQuietly(colour);
        J.closeQuietly(alpha);
      },
    };
  }

  // exportWebm({ engine, doc, audio: AudioBuffer | null, sink, signal, onProgress, canvas?, codecs? }) → Result
  // Result = { bytes, frames, ms, name, blob? (memory sink), codec, audio: boolean, audioCodec: 'opus' | null }: 透過動画
  // (WebM, VP9 alpha; DESIGN_2_1 §13.5). The frames render with the backdrop `clear`; the song (when 音声を入れる is on)
  // is Opus in WebM, encoded first. Each frame waits for its media frames (engine.mediaReady; a store failure is
  // ExportError('media')). Cancel or any failure closes the encoders and aborts the sink. Errors: 'no-webcodecs',
  // 'no-vp9' (neither VP9 nor VP8 encodes), 'cancelled', 'media', 'encode', 'sink', …
  // `codecs` (tests only): { webm: [codec strings] } replaces pickVp9's list; { webmAudio: [...] } the Opus list.
  async function exportWebm(opts) {
    const o = opts || {};
    const started = performance.now();
    const sink = o.sink;
    if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') {
      await sink.abort();
      throw new S.ExportError('no-webcodecs', 'WebCodecs is not available');
    }
    let job = null, out = null;
    try {
      job = await J.openJob({ engine: o.engine, doc: o.doc, format: 'webmAlpha', canvas: o.canvas });
      J.checkAbort(o.signal);
      const config = await J.vp9Config(o.codecs, job.w, job.h, job.fps, S.bitrate(job.w, job.h, job.fps, o.doc.output.quality));
      if (!config) throw new S.ExportError('no-vp9', 'neither VP9 nor VP8 encodes ' + job.w + '×' + job.h + '@' + job.fps);
      const song = o.audio && o.doc.output.audio ? o.audio : null;
      const audio = song ? await encodeSong(song, job, { codecs: o.codecs, signal: o.signal }) : null;
      out = createAlphaOutput({ sink, job, config, audio });
      const progress = J.createProgress(job.N, o.onProgress);
      for (let i = 0; i < job.N; i++) {
        J.checkAbort(o.signal);
        if (out.failure) throw out.failure;
        await job.ready(i, o.signal);
        job.render(i);
        await out.frame(i, job.surface);
        progress.frame(i);
      }
      await out.flush();
      J.checkAbort(o.signal);
      const done = await out.end();
      return { bytes: done.bytes, frames: job.N, ms: performance.now() - started, name: sink.name || S.fileName(o.doc, 'webm'),
        blob: done.blob, codec: config.codec, audio: !!audio, audioCodec: audio ? audio.config.codec : null };
    } catch (err) {
      if (out) out.close();
      await sink.abort();
      throw J.exportFailure(err, o.signal, out && out.failure);
    } finally {
      if (job) job.engine.dispose();
    }
  }

  return { exportWebm, encodeSong, createAlphaOutput, codecId };
});
