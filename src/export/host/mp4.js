/* 文字PVメーカー v2 — original work. MP4 export: engine fork → frames → VideoEncoder / AudioEncoder → muxer → sink (§4.21). */
MV.def('export/host/mp4', ['export/schedule', 'export/muxer'], (S, M) => {
  'use strict';

  const MAX_QUEUE = 6;              // frames waiting in the encoder before the loop waits (FROZEN §4.21)
  const AUDIO_LEAD_US = 500000;     // audio is encoded this far ahead of the video
  const ETA_WINDOW = 64;            // per-frame times kept for the ETA

  // --- shared by the MP4 and PNG exports ---------------------------------------------------------------------------

  function cancelled() { return new S.ExportError('cancelled', 'export cancelled'); }

  function checkAbort(signal) { if (signal && signal.aborted) throw cancelled(); }

  // makeSurface(factory | null, w, h, alpha) → Surface { canvas, ctx, w, h }; OffscreenCanvas unless a factory is given.
  function makeSurface(factory, w, h, alpha) {
    if (factory) {
      const s = factory.create(w, h, { alpha });
      return { canvas: s.canvas, ctx: s.ctx, w, h };
    }
    let canvas;
    if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(w, h);
    else {
      canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
    }
    return { canvas, ctx: canvas.getContext('2d', { alpha }), w, h };
  }

  // The asset that a failed store request names, for ExportError('media').detail (DESIGN_2_1 §11.4.4).
  function mediaDetail(err, doc) {
    const id = (err && err.id) || null;
    const list = (doc.media && doc.media.list) || [];
    const entry = id ? list.find((a) => a.id === id) : null;
    return { id, name: entry ? entry.name : null, code: (err && err.code) || null };
  }

  // openJob({ engine, doc, format, canvas }) → the frozen engine fork, the frame range, ready(i, signal) and render(i).
  // ready(i) awaits the photo and video frames of frame i (engine.mediaReady, DESIGN_2_1 §11.4.5), so export frames are
  // always exact; a store that cannot deliver one stops the export with ExportError('media') naming the asset. Engines
  // without mediaReady (no media) resolve at once.
  async function openJob({ engine, doc, format, canvas }) {
    const e = engine.fork();
    try {
      if (!e.plan) e.setDoc(doc);
      const plan = e.plan;
      if (!plan) throw new S.ExportError('no-plan', 'the engine has no plan');
      const { t0, t1 } = S.exportRange(doc, plan);
      const fps = doc.output.fps;
      const N = S.frameCount(t1 - t0, fps);
      if (N <= 0) throw new S.ExportError('range-empty', 'nothing to export');
      const { w, h } = S.outputSize(plan.design.aspect, doc.output.short);
      const surface = makeSurface(canvas || null, w, h, format === 'pngAlpha');
      const ropts = { quality: 'export', scale: S.renderScale(plan.design, w, h), backdrop: S.backdropFor(format, doc.look.backdrop) };
      await e.prepare(t0, t1, { export: true });
      return {
        engine: e, plan, t0, t1, fps, N, w, h, surface,
        async ready(i, signal) {
          if (typeof e.mediaReady !== 'function') return;
          try {
            await e.mediaReady(t0 + i / fps, { signal, fps, scale: ropts.scale });
          } catch (err) {
            if (signal && signal.aborted) throw cancelled();
            throw new S.ExportError('media', 'a photo or video could not be read: ' + ((err && err.message) || err), mediaDetail(err, doc));
          }
        },
        render(i) { return e.renderFrame(surface, t0 + i / fps, ropts); },
      };
    } catch (err) {
      e.dispose();
      throw err;
    }
  }

  // createProgress(N, onProgress) → { frame(i) }: after frame i, reports { i: frames done, N, eta: seconds | null }.
  function createProgress(N, onProgress) {
    const samples = [];
    let last = performance.now();
    return {
      frame(i) {
        const now = performance.now();
        samples.push({ i, ms: now - last });
        if (samples.length > ETA_WINDOW) samples.shift();
        last = now;
        if (onProgress) onProgress({ i: i + 1, N, eta: S.eta(samples, N - i - 1) });
      },
    };
  }

  function closeQuietly(coder) {
    try { if (coder && coder.state !== 'closed') coder.close(); } catch (err) { /* already closed */ }
  }

  // --- encoders ----------------------------------------------------------------------------------------------------

  // The first supported video config: the AVC list of pickAvc(), or `codecs.video` (tests, other codecs).
  async function videoConfig(codecs, job, bits) {
    const list = codecs && codecs.video ? [codecs.video] : S.pickAvc(job.w, job.h, job.fps);
    for (const codec of list) {
      const config = { codec, width: job.w, height: job.h, bitrate: bits, framerate: job.fps, latencyMode: 'quality' };
      if (codec.startsWith('avc1')) config.avc = { format: 'avc' };
      try {
        if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
      } catch (err) { /* a malformed or unknown codec string is simply unsupported */ }
    }
    throw new S.ExportError('no-codec', 'no supported video codec for ' + job.w + '×' + job.h + '@' + job.fps, list);
  }

  // The audio codecs tried in order (DESIGN_2_1 §13.4): AAC-LC, then Opus in MP4 where the browser has no AAC encoder
  // (Chrome on Linux, Chromium builds). `codecs.audioList` (tests) or `codecs.audio` (one codec) override the list.
  const AUDIO_CODECS = Object.freeze(['mp4a.40.2', 'opus']);

  function audioCodecs(codecs) {
    if (codecs && Array.isArray(codecs.audioList)) return codecs.audioList;
    if (codecs && codecs.audio) return [codecs.audio];
    return AUDIO_CODECS;
  }

  // The first audio config that encodes, stereo at the song's rate (songs are decoded at 48 kHz, DECODE_RATE, which is
  // also the Opus rate): AAC at 192 kbps, Opus at 160 kbps. null when none encodes (the MP4 is then silent).
  async function audioConfig(codecs, buffer) {
    if (typeof AudioEncoder !== 'function') return null;
    for (const codec of audioCodecs(codecs)) {
      const config = { codec, sampleRate: buffer.sampleRate, numberOfChannels: 2,
        bitrate: codec === 'opus' ? S.OPUS_BITRATE : S.AUDIO_BITRATE };
      try {
        if ((await AudioEncoder.isConfigSupported(config)).supported) return config;
      } catch (err) { /* a malformed or unknown codec string is simply unsupported */ }
    }
    return null;
  }

  function channelsOf(buffer) {
    const out = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c));
    return out;
  }

  // Feeds 1024-frame AudioData covering [t0, t1) of the song, trimmed or zero-padded to exactly audioFrames(N) samples.
  function createAudioFeeder(encoder, buffer, job, rate) {
    const channels = channelsOf(buffer);
    const total = S.audioFrames(job.N, job.fps, rate);
    const count = S.audioChunkCount(total);
    const start = Math.round(job.t0 * rate);
    let k = 0;
    return {
      until(us) {
        for (; k < count; k++) {
          const c = S.audioChunk(k, rate, total);
          if (c.timestamp > us) return;
          const data = S.fillPlanar(new Float32Array(c.frames * 2), channels, start + c.from, c.frames);
          const chunk = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfFrames: c.frames, numberOfChannels: 2,
            timestamp: c.timestamp, data });
          try { encoder.encode(chunk); } finally { chunk.close(); }
        }
      },
    };
  }

  // Resolves when the encoder takes a frame off its queue (or after a short wait where 'dequeue' is not supported).
  function dequeued(encoder) {
    return new Promise((resolve) => {
      let timer = null;
      const done = () => {
        if (encoder.removeEventListener) encoder.removeEventListener('dequeue', done);
        clearTimeout(timer);
        resolve();
      };
      if (encoder.addEventListener) encoder.addEventListener('dequeue', done);
      timer = setTimeout(done, 20);
    });
  }

  // --- exportVideo ---------------------------------------------------------------------------------------------------

  // exportVideo({ engine, doc, audio: AudioBuffer | null, sink, signal, onProgress, canvas?, lib?, codecs? }) → Result
  // Result = { bytes, frames, ms, name, blob? (memory sink), codec, audio: boolean, audioCodec: string | null }. Steps as
  // FROZEN in §4.21: fork, prepare, N = frameCount, AVC from pickAvc with a key frame every 2·fps, frame i at t0 + i/fps
  // with ts(i)/frameDur(i) after its media frames are ready, queue ≤ 6, AAC (else Opus) in 1024-frame chunks. Cancel (signal) or any failure closes the encoders and aborts the sink, so no
  // partial file is left; the error is an ExportError ('cancelled', 'no-webcodecs', 'no-codec', 'encode', 'sink', …).
  async function exportVideo(opts) {
    const o = opts || {};
    const started = performance.now();
    const lib = o.lib || globalThis.Mp4Muxer;
    const sink = o.sink;
    if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') {
      await sink.abort();
      throw new S.ExportError('no-webcodecs', 'WebCodecs is not available');
    }
    let job = null, video = null, audio = null, failure = null;
    const fail = (err) => { failure = failure || err; };
    try {
      job = await openJob({ engine: o.engine, doc: o.doc, format: 'mp4', canvas: o.canvas });
      checkAbort(o.signal);
      const vcfg = await videoConfig(o.codecs, job, S.bitrate(job.w, job.h, job.fps, o.doc.output.quality));
      const song = o.audio && o.doc.output.audio ? o.audio : null;
      const acfg = song ? await audioConfig(o.codecs, song) : null;
      const muxer = M.createMuxer({
        lib, target: sink.kind === 'memory' ? 'memory' : 'stream', write: (bytes, position) => sink.write(bytes, position),
        w: job.w, h: job.h, fps: job.fps, codec: M.muxCodec(vcfg.codec),
        audio: acfg ? { rate: acfg.sampleRate, channels: 2, codec: M.muxCodec(acfg.codec) } : null,
      });
      video = new VideoEncoder({
        output: (chunk, meta) => { try { muxer.video(chunk, meta); } catch (err) { fail(err); } },
        error: (err) => fail(new S.ExportError('encode', 'video encoding failed: ' + err.message, err)),
      });
      video.configure(vcfg);
      let feeder = null;
      if (acfg) {
        audio = new AudioEncoder({
          output: (chunk, meta) => { try { muxer.audio(chunk, meta); } catch (err) { fail(err); } },
          error: (err) => fail(new S.ExportError('encode', 'audio encoding failed: ' + err.message, err)),
        });
        audio.configure(acfg);
        feeder = createAudioFeeder(audio, song, job, acfg.sampleRate);
      }
      const progress = createProgress(job.N, o.onProgress);
      const keyEvery = S.keyInterval(job.fps);
      for (let i = 0; i < job.N; i++) {
        checkAbort(o.signal);
        if (failure) throw failure;
        await job.ready(i, o.signal);
        job.render(i);
        const frame = new VideoFrame(job.surface.canvas, { timestamp: S.ts(i, job.fps), duration: S.frameDur(i, job.fps) });
        try { video.encode(frame, { keyFrame: i % keyEvery === 0 }); } finally { frame.close(); }
        if (feeder) feeder.until(S.ts(i + 1, job.fps) + AUDIO_LEAD_US);
        while (video.encodeQueueSize > MAX_QUEUE) await dequeued(video);
        await muxer.ready();
        progress.frame(i);
      }
      await video.flush();
      if (feeder) {
        feeder.until(Infinity);
        await audio.flush();
      }
      checkAbort(o.signal);
      if (failure) throw failure;
      closeQuietly(video);
      closeQuietly(audio);
      const buffer = await muxer.finish();
      if (buffer) await sink.write(new Uint8Array(buffer), 0);
      const done = await sink.close();
      return { bytes: done.bytes, frames: job.N, ms: performance.now() - started, name: sink.name || S.fileName(o.doc, 'mp4'),
        blob: done.blob, codec: vcfg.codec, audio: !!acfg, audioCodec: acfg ? acfg.codec : null };
    } catch (err) {
      closeQuietly(video);
      closeQuietly(audio);
      await sink.abort();
      if (err instanceof S.ExportError) throw err;
      if (o.signal && o.signal.aborted) throw cancelled();
      throw failure instanceof S.ExportError ? failure : new S.ExportError('encode', (err && err.message) || 'export failed', err);
    } finally {
      if (job) job.engine.dispose();
    }
  }

  async function firstAvc(w, h, fps) {
    for (const c of S.pickAvc(w, h, fps)) {
      const config = { codec: c, width: w, height: h, bitrate: S.bitrate(w, h, fps, 'high'), framerate: fps, avc: { format: 'avc' } };
      try { if ((await VideoEncoder.isConfigSupported(config)).supported) return c; } catch (err) { /* unsupported */ }
    }
    return null;
  }

  // probe({ w, h, fps, rate, codecs? }) → { webcodecs, codec, audioCodec, anyCodec } for the pre-flight. codec: the first
  // AVC string this size and frame rate encode with, else null. anyCodec: whether H.264 encodes at all (checked at
  // 640×360@30 when this size fails), so the pre-flight can tell "choose a smaller size" from "this browser has no H.264
  // encoder". audioCodec: 'mp4a.40.2' | 'opus' | null, the codec the MP4 audio would use (`codecs` as in exportVideo).
  async function probe({ w, h, fps, rate = 48000, codecs = null }) {
    if (typeof VideoEncoder !== 'function') return { webcodecs: false, codec: null, audioCodec: null, anyCodec: false };
    const codec = await firstAvc(w, h, fps);
    const anyCodec = codec !== null || (await firstAvc(640, 360, 30)) !== null;
    const a = await audioConfig(codecs, { sampleRate: rate });
    return { webcodecs: true, codec, audioCodec: a ? a.codec : null, anyCodec };
  }

  return { AUDIO_CODECS, exportVideo, probe, openJob, makeSurface, createProgress, checkAbort, audioConfig };
});
