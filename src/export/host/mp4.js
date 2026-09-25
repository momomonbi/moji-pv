/* 文字PVメーカー v2 — original work. MP4 export: engine fork → frames → VideoEncoder / AudioEncoder → muxer → sink (§4.21); the export job, encoder choice and MP4 output shared with the PNG, WebM and kit exports (DESIGN_2_1 §13). */
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

  // openJob({ engine, doc, format, canvas, backdrop?, layers?, assets?, replan? }) → the frozen engine fork, the frame range,
  // the output size and render options, ready(i, signal) and render(i, target?, ropts?).
  //   backdrop  overrides backdropFor(format, doc.look.backdrop) (the kit's overlay renders `clear`)
  //   layers    'all' (default) | 'ground': the renderer's layers option (DESIGN_2_1 §13.7, the kit's background)
  //   assets    the AssetStore the fork uses (engine.fork({ assets }): two jobs of one kit share one store)
  //   replan    the fork plans `doc` even when it already has a plan (the kit's green screen: the document with backdrop
  //             'chroma', so its palette is adjusted as the planner does it)
  // ready(i) awaits the photo and video frames of frame i (engine.mediaReady, DESIGN_2_1 §11.4.5), so export frames are
  // always exact; a store that cannot deliver one stops the export with ExportError('media') naming the asset. Engines
  // without mediaReady (no media) resolve at once. job.options(over) → the render options with `over` applied (made once
  // per output, not per frame); job.surfaceFor(alpha) → another surface of the output size.
  async function openJob({ engine, doc, format, canvas, backdrop, layers, assets, replan }) {
    const e = assets ? engine.fork({ assets }) : engine.fork();
    try {
      if (replan || !e.plan) e.setDoc(doc);
      const plan = e.plan;
      if (!plan) throw new S.ExportError('no-plan', 'the engine has no plan');
      const { t0, t1 } = S.exportRange(doc, plan);
      const fps = doc.output.fps;
      const N = S.frameCount(t1 - t0, fps);
      if (N <= 0) throw new S.ExportError('range-empty', 'nothing to export');
      const { w, h } = S.outputSize(plan.design.aspect, doc.output.short);
      const ropts = { quality: 'export', scale: S.renderScale(plan.design, w, h), backdrop: backdrop || S.backdropFor(format, doc.look.backdrop) };
      if (layers && layers !== 'all') ropts.layers = layers;
      const surface = makeSurface(canvas || null, w, h, ropts.backdrop === 'clear');
      await e.prepare(t0, t1, { export: true });
      return {
        engine: e, plan, t0, t1, fps, N, w, h, surface, ropts,
        async ready(i, signal) {
          if (typeof e.mediaReady !== 'function') return;
          try {
            await e.mediaReady(t0 + i / fps, { signal, fps, scale: ropts.scale });
          } catch (err) {
            if (signal && signal.aborted) throw cancelled();
            throw new S.ExportError('media', 'a photo or video could not be read: ' + ((err && err.message) || err), mediaDetail(err, doc));
          }
        },
        options(over) { return Object.assign({}, ropts, over || {}); },
        surfaceFor(alpha) { return makeSurface(canvas || null, w, h, !!alpha); },
        render(i, target, ro) { return e.renderFrame(target || surface, t0 + i / fps, ro || ropts); },
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

  // The first config of `list` that VideoEncoder supports, else null. A malformed or unknown codec string is simply
  // unsupported.
  async function firstVideoConfig(list, configOf) {
    for (const codec of list) {
      const config = configOf(codec);
      try {
        if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
      } catch (err) { /* unsupported */ }
    }
    return null;
  }

  function encoderConfig(codec, w, h, fps, bits) {
    const config = { codec, width: w, height: h, bitrate: bits, framerate: fps, latencyMode: 'quality' };
    if (codec.startsWith('avc1')) config.avc = { format: 'avc' };
    return config;
  }

  // The first supported video config: the AVC list of pickAvc(), or `codecs.video` (tests, other codecs).
  async function videoConfig(codecs, job, bits) {
    const list = codecs && codecs.video ? [codecs.video] : S.pickAvc(job.w, job.h, job.fps);
    const config = await firstVideoConfig(list, (codec) => encoderConfig(codec, job.w, job.h, job.fps, bits));
    if (!config) throw new S.ExportError('no-codec', 'no supported video codec for ' + job.w + '×' + job.h + '@' + job.fps, list);
    return config;
  }

  // The VP9 / VP8 codec strings tried for a transparent WebM (DESIGN_2_1 §13.5): pickVp9(), or `codecs.webm` (tests: a
  // list, e.g. ['vp8'], or [] for a browser without either).
  function vp9Codecs(codecs, w, h, fps) {
    return codecs && Array.isArray(codecs.webm) ? codecs.webm : S.pickVp9(w, h, fps);
  }

  // vp9Config(codecs, w, h, fps, bits) → the first supported VP9 (else VP8) encoder config at `bits`, or null.
  function vp9Config(codecs, w, h, fps, bits) {
    return firstVideoConfig(vp9Codecs(codecs, w, h, fps), (codec) => encoderConfig(codec, w, h, fps, bits));
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
  // also the Opus rate): AAC at 192 kbps, Opus at 160 kbps. null when none encodes (the MP4 is then silent). `list`
  // overrides the order (the kit's MP4 tries AAC only, the WebM Opus only).
  async function audioConfig(codecs, buffer, list) {
    if (typeof AudioEncoder !== 'function') return null;
    for (const codec of list || audioCodecs(codecs)) {
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

  // Waits while the encoder holds more than MAX_QUEUE frames (FROZEN §4.21).
  async function drain(encoder) {
    while (encoder.encodeQueueSize > MAX_QUEUE) await dequeued(encoder);
  }

  // --- one MP4 output (exportVideo, and each MP4 of the kit) -----------------------------------------------------------

  // createMp4Output({ lib, sink, job, vcfg, acfg, song }) → { frame(i, source), flush(), end() → sink.close()'s result,
  // close(), failure }. The muxer writes to the sink (the stream target for a file, the in-memory target for a memory
  // sink); a key frame every 2·fps; frame i gets ts(i) and frameDur(i); with `acfg` the song is fed 0.5 s ahead of the
  // video in 1024-frame chunks, trimmed or padded to audioFrames(N). frame(i, source) encodes `source` (a canvas) as frame
  // i and waits while the encoder queue is full; flush() waits for every chunk; end() finishes the file and closes the
  // sink; close() closes the encoders (after a failure). An encoder or muxer error is kept in `failure` and thrown by
  // the next call.
  function createMp4Output(o) {
    const job = o.job, sink = o.sink;
    let failure = null;
    const fail = (err) => { failure = failure || err; };
    const muxer = M.createMuxer({
      lib: o.lib, target: sink.kind === 'memory' ? 'memory' : 'stream', write: (bytes, position) => sink.write(bytes, position),
      w: job.w, h: job.h, fps: job.fps, codec: M.muxCodec(o.vcfg.codec),
      audio: o.acfg ? { rate: o.acfg.sampleRate, channels: 2, codec: M.muxCodec(o.acfg.codec) } : null,
    });
    const video = new VideoEncoder({
      output: (chunk, meta) => { try { muxer.video(chunk, meta); } catch (err) { fail(err); } },
      error: (err) => fail(new S.ExportError('encode', 'video encoding failed: ' + err.message, err)),
    });
    let audio = null, feeder = null;
    try {
      video.configure(o.vcfg);
      if (o.acfg) {
        audio = new AudioEncoder({
          output: (chunk, meta) => { try { muxer.audio(chunk, meta); } catch (err) { fail(err); } },
          error: (err) => fail(new S.ExportError('encode', 'audio encoding failed: ' + err.message, err)),
        });
        audio.configure(o.acfg);
        feeder = createAudioFeeder(audio, o.song, job, o.acfg.sampleRate);
      }
    } catch (err) {
      closeQuietly(video);
      closeQuietly(audio);
      throw err;
    }
    const keyEvery = S.keyInterval(job.fps);
    return {
      get failure() { return failure; },
      async frame(i, source) {
        if (failure) throw failure;
        const frame = new VideoFrame(source, { timestamp: S.ts(i, job.fps), duration: S.frameDur(i, job.fps) });
        try { video.encode(frame, { keyFrame: i % keyEvery === 0 }); } finally { frame.close(); }
        if (feeder) feeder.until(S.ts(i + 1, job.fps) + AUDIO_LEAD_US);
        await drain(video);
        await muxer.ready();
      },
      async flush() {
        await video.flush();
        if (feeder) {
          feeder.until(Infinity);
          await audio.flush();
        }
        if (failure) throw failure;
      },
      async end() {
        if (failure) throw failure;
        closeQuietly(video);
        closeQuietly(audio);
        const buffer = await muxer.finish();
        if (buffer) await sink.write(new Uint8Array(buffer), 0);
        return sink.close();
      },
      close() {
        closeQuietly(video);
        closeQuietly(audio);
      },
    };
  }

  // The error an export throws for `err`: ExportErrors as they are; a cancel as 'cancelled'; an encoder's own failure;
  // anything else as 'encode'.
  function exportFailure(err, signal, failure) {
    if (err instanceof S.ExportError) return err;
    if (signal && signal.aborted) return cancelled();
    if (failure instanceof S.ExportError) return failure;
    return new S.ExportError(err && err.code === 'sink' ? 'sink' : 'encode', (err && err.message) || 'export failed', err);
  }

  // --- exportVideo ---------------------------------------------------------------------------------------------------

  // exportVideo({ engine, doc, audio: AudioBuffer | null, sink, signal, onProgress, canvas?, lib?, codecs? }) → Result
  // Result = { bytes, frames, ms, name, blob? (memory sink), codec, audio: boolean, audioCodec: string | null }. Steps as
  // FROZEN in §4.21: fork, prepare, N = frameCount, AVC from pickAvc with a key frame every 2·fps, frame i at t0 + i/fps
  // with ts(i)/frameDur(i) after its media frames are ready, queue ≤ 6, AAC (else Opus) in 1024-frame chunks. Cancel
  // (signal) or any failure closes the encoders and aborts the sink, so no partial file is left; the error is an
  // ExportError ('cancelled', 'no-webcodecs', 'no-codec', 'encode', 'sink', 'media', …).
  async function exportVideo(opts) {
    const o = opts || {};
    const started = performance.now();
    const lib = o.lib || globalThis.Mp4Muxer;
    const sink = o.sink;
    if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function') {
      await sink.abort();
      throw new S.ExportError('no-webcodecs', 'WebCodecs is not available');
    }
    let job = null, out = null;
    try {
      job = await openJob({ engine: o.engine, doc: o.doc, format: 'mp4', canvas: o.canvas });
      checkAbort(o.signal);
      const vcfg = await videoConfig(o.codecs, job, S.bitrate(job.w, job.h, job.fps, o.doc.output.quality));
      const song = o.audio && o.doc.output.audio ? o.audio : null;
      const acfg = song ? await audioConfig(o.codecs, song) : null;
      out = createMp4Output({ lib, sink, job, vcfg, acfg, song });
      const progress = createProgress(job.N, o.onProgress);
      for (let i = 0; i < job.N; i++) {
        checkAbort(o.signal);
        if (out.failure) throw out.failure;
        await job.ready(i, o.signal);
        job.render(i);
        await out.frame(i, job.surface.canvas);
        progress.frame(i);
      }
      await out.flush();
      checkAbort(o.signal);
      const done = await out.end();
      return { bytes: done.bytes, frames: job.N, ms: performance.now() - started, name: sink.name || S.fileName(o.doc, 'mp4'),
        blob: done.blob, codec: vcfg.codec, audio: !!acfg, audioCodec: acfg ? acfg.codec : null };
    } catch (err) {
      if (out) out.close();
      await sink.abort();
      throw exportFailure(err, o.signal, out && out.failure);
    } finally {
      if (job) job.engine.dispose();
    }
  }

  async function firstAvc(w, h, fps) {
    const config = await firstVideoConfig(S.pickAvc(w, h, fps), (c) => encoderConfig(c, w, h, fps, S.bitrate(w, h, fps, 'high')));
    return config ? config.codec : null;
  }

  // probe({ w, h, fps, rate, codecs? }) → { webcodecs, codec, audioCodec, anyCodec, vp9Codec } for the pre-flight. codec:
  // the first AVC string this size and frame rate encode with, else null. anyCodec: whether H.264 encodes at all (checked
  // at 640×360@30 when this size fails), so the pre-flight can tell "choose a smaller size" from "this browser has no
  // H.264 encoder". audioCodec: 'mp4a.40.2' | 'opus' | null, the codec the MP4 audio would use (`codecs` as in
  // exportVideo). vp9Codec: the first VP9 (else VP8) string a transparent WebM of this size encodes with, else null
  // (DESIGN_2_1 §13.10).
  async function probe({ w, h, fps, rate = 48000, codecs = null }) {
    if (typeof VideoEncoder !== 'function') return { webcodecs: false, codec: null, audioCodec: null, anyCodec: false, vp9Codec: null };
    const codec = await firstAvc(w, h, fps);
    const anyCodec = codec !== null || (await firstAvc(640, 360, 30)) !== null;
    const a = await audioConfig(codecs, { sampleRate: rate });
    const v = await vp9Config(codecs, w, h, fps, S.bitrate(w, h, fps, 'high'));
    return { webcodecs: true, codec, audioCodec: a ? a.codec : null, anyCodec, vp9Codec: v ? v.codec : null };
  }

  return {
    AUDIO_CODECS, exportVideo, probe, openJob, makeSurface, createProgress, checkAbort, audioConfig, videoConfig, vp9Config,
    channelsOf, createAudioFeeder, createMp4Output, drain, closeQuietly, exportFailure,
  };
});
