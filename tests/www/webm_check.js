/* 文字PVメーカー v2 — original work. Browser harness for tests/browser/webm_check.py and kit_check.py (not shipped). */
// Evaluated in the built app page (index.html?fresh=1&test=1) after tests/helpers/media_gen.js, so it runs under the real
// CSP with the real engine. Exposes window.__webmCheck(project) and the shared helpers window.MVExportTest; every
// result is plain JSON for the Python side.
(function () {
  'use strict';
  const a = window.__mv;
  const G = window.MVMediaGen;
  const S = MV.use('export/schedule');
  const J = MV.use('export/host/mp4');
  const PNG = MV.use('export/host/png');
  const WH = MV.use('export/host/webm');
  const SINK = MV.use('export/host/sink');
  const MKV = MV.use('media/matroska');
  const SM = MV.use('media/samples');

  // --- the test layer: the counter code and alpha steps drawn over every frame (except the background layer) -------

  const CODE_AT = { x: 24, y: 24 };                      // the counter pattern (192×108) at the top-left, opaque
  const STEPS = [0, 64, 128, 191, 255];                  // alpha steps: 48×48 squares of #F0C040 at the top-right
  const STEP = 48;
  function stepBox(k, w) { return { x: w - 24 - (STEPS.length - k) * (STEP + 8), y: 24, w: STEP, h: STEP }; }

  function drawTestLayer(surface, i) {
    const g = surface.ctx;
    g.save();
    g.setTransform(1, 0, 0, 1, CODE_AT.x, CODE_AT.y);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    G.drawCounter(g, i, false);
    g.setTransform(1, 0, 0, 1, 0, 0);
    STEPS.forEach((alpha, k) => {
      const b = stepBox(k, surface.w);
      g.clearRect(b.x, b.y, b.w, b.h);
      g.fillStyle = 'rgba(240, 192, 64, ' + alpha / 255 + ')';
      g.fillRect(b.x, b.y, b.w, b.h);
    });
    g.restore();
  }

  // wrapEngine(engine, t0, fps): the engine facade, whose frames also show the test layer (frame index i = (t − t0)·fps);
  // the background layer (layers 'ground') is left as it is. Forks are wrapped too.
  function wrapEngine(engine, t0, fps) {
    const w = {
      fork(opts) { return wrapEngine(opts ? engine.fork(opts) : engine.fork(), t0, fps); },
      setDoc: (doc) => engine.setDoc(doc),
      get plan() { return engine.plan; },
      prepare: (x, y, o) => engine.prepare(x, y, o),
      renderFrame(surface, t, ro) {
        const stats = engine.renderFrame(surface, t, ro);
        if (!(ro && ro.layers === 'ground')) drawTestLayer(surface, Math.round((t - t0) * fps));
        return stats;
      },
      dispose: () => engine.dispose(),
    };
    if (typeof engine.mediaReady === 'function') w.mediaReady = (t, o) => engine.mediaReady(t, o);
    return w;
  }

  // readCode(rgba, w, h) → the counter code of a frame, or -1.
  function readCode(px, w) {
    const sub = new Uint8ClampedArray(G.W * G.H * 4);
    for (let y = 0; y < G.H; y++) {
      const from = ((CODE_AT.y + y) * w + CODE_AT.x) * 4;
      sub.set(px.subarray(from, from + G.W * 4), y * G.W * 4);
    }
    return G.readCounter(sub, G.W, G.H);
  }

  // --- the project -------------------------------------------------------------------------------------------------

  // Loads the fixture into the app, sets the output, and returns the committed document: a range of `seconds` that
  // starts at the first lyric cut with text.
  function loadProject(project, output) {
    a.view.setPref('autoplay', false);
    const file = JSON.parse(project);
    file.doc.output = Object.assign({}, file.doc.output, output);
    a.store.load(file.doc, file.side);
    const cut = a.plan.cuts.find((c) => c.role === 'lyric' && c.text);
    const t0 = Math.max(0, Math.round((cut ? cut.a : 0) * 30) / 30);
    a.dispatch({ t: 'output.set', key: 'range', v: { t0, t1: t0 + output.seconds } });
    return a.doc;
  }

  // The engine the export gets, as the UI makes it: a fork of the preview engine planned from the committed document.
  function sourceFor(doc) {
    const e = a.engine.fork();
    e.setDoc(doc);
    return e;
  }

  function toneBuffer(seconds, rate) {
    const b = new AudioBuffer({ length: Math.round(seconds * rate), numberOfChannels: 2, sampleRate: rate });
    const l = b.getChannelData(0), r = b.getChannelData(1);
    for (let i = 0; i < b.length; i++) { l[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / rate); r[i] = 0.3 * Math.sin((2 * Math.PI * 660 * i) / rate); }
    return b;
  }

  // Swaps the global VideoEncoder for a subclass that records every instance's config and chunks (bytes, key, µs).
  function recordVideoEncoders() {
    const Real = window.VideoEncoder;
    const made = [];
    window.VideoEncoder = class extends Real {
      constructor(init) {
        const rec = { config: null, chunks: [] };
        super({
          output: (chunk, meta) => {
            const data = new Uint8Array(chunk.byteLength);
            chunk.copyTo(data);
            rec.chunks.push({ data, key: chunk.type === 'key', ts: chunk.timestamp });
            init.output(chunk, meta);
          },
          error: init.error,
        });
        made.push(rec);
        this.__rec = rec;
      }
      configure(config) { this.__rec.config = Object.assign({}, config); return super.configure(config); }
    };
    return { made, restore() { window.VideoEncoder = Real; } };
  }

  const toBase64 = (bytes) => {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };

  const same = (x, y) => x.length === y.length && x.every((v, k) => v === y[k]);

  // --- reading a WebM back ------------------------------------------------------------------------------------------

  async function demux(blob) {
    const read = async (at, n) => new Uint8Array(await blob.slice(at, at + n).arrayBuffer());
    return MKV.parse(read, blob.size);
  }

  // The file's frames through media/matroska equal what the two encoders produced: every colour frame's bytes at
  // (off, size), every alpha frame's at (aoff, asize), key = both keys, presentation times on the frame grid.
  async function roundTrip(blob, colour, alpha, fps) {
    const movie = await demux(blob);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const video = movie.tracks.find((t) => t.kind === 'video');
    const audio = movie.tracks.find((t) => t.kind === 'audio');
    const t = video.table;
    const out = { codec: video.codec, alpha: video.alpha, n: t.n, fps: t.fps, vfr: t.vfr, audio: audio ? audio.codec : null,
      colourBytes: 0, alphaBytes: 0, keys: [], wantKeys: [], ptsOff: 0, bad: [] };
    for (let d = 0; d < t.n; d++) {
      const c = colour[d], al = alpha[d];
      if (!c || !al) { out.bad.push(d); continue; }
      if (same(bytes.subarray(t.off[d], t.off[d] + t.size[d]), c.data)) out.colourBytes++;
      if (t.aoff && same(bytes.subarray(t.aoff[d], t.aoff[d] + t.asize[d]), al.data)) out.alphaBytes++;
      if (t.key[d]) out.keys.push(d);
      if (c.key && al.key) out.wantKeys.push(d);
      out.ptsOff = Math.max(out.ptsOff, Math.abs(t.pts[d] - d / fps));
    }
    return { out, movie, table: t };
  }

  // Decodes both streams with WebCodecs from the demuxed table: colour frames (whose counter codes are read) and alpha
  // frames (their count). → { colour, alpha, codes, errors }
  async function decodeStreams(blob, track) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const t = track.table;
    const codes = [];
    let alphaCount = 0;
    const errors = [];
    const canvas = new OffscreenCanvas(track.w, track.h);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const colour = new VideoDecoder({
      output: (f) => { g.drawImage(f, 0, 0); codes.push(readCode(g.getImageData(0, 0, track.w, track.h).data, track.w)); f.close(); },
      error: (e) => errors.push('colour: ' + e),
    });
    const alpha = new VideoDecoder({ output: (f) => { alphaCount++; f.close(); }, error: (e) => errors.push('alpha: ' + e) });
    colour.configure({ codec: track.codec, codedWidth: track.w, codedHeight: track.h });
    alpha.configure({ codec: track.codec, codedWidth: track.w, codedHeight: track.h });
    for (let d = 0; d < t.n; d++) {
      const type = t.key[d] ? 'key' : 'delta';
      const ts = Math.round(t.ts[d]);
      colour.decode(new EncodedVideoChunk({ type, timestamp: ts, data: bytes.subarray(t.off[d], t.off[d] + t.size[d]) }));
      alpha.decode(new EncodedVideoChunk({ type, timestamp: ts, data: bytes.subarray(t.aoff[d], t.aoff[d] + t.asize[d]) }));
    }
    await colour.flush();
    await alpha.flush();
    colour.close();
    alpha.close();
    return { colour: codes.length, alpha: alphaCount, codes, errors };
  }

  // Chrome's own decoder (<video src=blob:>): the frame shown at (i + ½) / fps, drawn to a canvas, read back.
  async function videoFrames(blob, frames, fps, w, h) {
    const url = URL.createObjectURL(blob);
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = url;
    const out = [];
    try {
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('video: ' + (video.error && video.error.message))); });
      const canvas = new OffscreenCanvas(w, h);
      const g = canvas.getContext('2d', { willReadFrequently: true });
      for (const i of frames) {
        const shown = new Promise((resolve) => video.requestVideoFrameCallback((now, meta) => resolve(meta)));
        video.currentTime = (i + 0.5) / fps;
        await new Promise((resolve) => { video.onseeked = resolve; });
        await Promise.race([shown, new Promise((r) => setTimeout(r, 1000))]);
        g.clearRect(0, 0, w, h);
        g.drawImage(video, 0, 0, w, h);
        out.push({ i, px: g.getImageData(0, 0, w, h).data });
      }
      return { duration: video.duration, width: video.videoWidth, height: video.videoHeight, frames: out };
    } finally {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
  }

  // The frames of a store-only ZIP of PNGs (export/host/png), as RGBA pixels.
  async function zipPngFrames(blob, wanted) {
    const out = new Map();
    let at = 0, index = 0;
    while (at + 30 <= blob.size) {
      const head = new DataView(await blob.slice(at, at + 30).arrayBuffer());
      if (head.getUint32(0, true) !== 0x04034b50) break;
      const size = head.getUint32(18, true);
      const start = at + 30 + head.getUint16(26, true) + head.getUint16(28, true);
      if (wanted.includes(index)) {
        const bitmap = await createImageBitmap(blob.slice(start, start + size, 'image/png'), { premultiplyAlpha: 'none' });
        const c = new OffscreenCanvas(bitmap.width, bitmap.height);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(bitmap, 0, 0);
        out.set(index, g.getImageData(0, 0, bitmap.width, bitmap.height).data);
        bitmap.close();
      }
      at = start + size;
      index++;
    }
    return out;
  }

  // near(mask, w, h, r) → 1 where some pixel within Chebyshev distance r has mask 1 (two separable prefix-sum passes).
  function near(mask, w, h, r) {
    const rows = new Uint8Array(w * h), out = new Uint8Array(w * h);
    const acc = new Int32Array(Math.max(w, h) + 1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) acc[x + 1] = acc[x] + mask[y * w + x];
      for (let x = 0; x < w; x++) rows[y * w + x] = acc[Math.min(w, x + r + 1)] - acc[Math.max(0, x - r)] > 0 ? 1 : 0;
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) acc[y + 1] = acc[y] + rows[y * w + x];
      for (let y = 0; y < h; y++) out[y * w + x] = acc[Math.min(h, y + r + 1)] - acc[Math.max(0, y - r)] > 0 ? 1 : 0;
    }
    return out;
  }

  const CLEAR_MARGIN = 4;     // "fully clear": no pixel of the PNG within 4 px has α > 0
  const CORE_MARGIN = 3;      // "core": every pixel of the PNG within 3 px has α = 255

  // Alpha of the decoded WebM against the PNG (DESIGN_2_1 §13.12): |Δα| (mean, 99th percentile, the share within ±6);
  // fully clear areas (α > 3 there: count, share, max); cores (α < 250 there: count, share, min); the alpha steps' centres.
  function compareAlpha(got, want, w, h) {
    const n = w * h;
    const content = new Uint8Array(n), notFull = new Uint8Array(n);
    for (let k = 0; k < n; k++) { content[k] = want[k * 4 + 3] > 0 ? 1 : 0; notFull[k] = want[k * 4 + 3] < 255 ? 1 : 0; }
    const nearContent = near(content, w, h, CLEAR_MARGIN), nearEdge = near(notFull, w, h, CORE_MARGIN);
    const hist = new Uint32Array(256);
    let sum = 0, clearN = 0, clearOver = 0, clearMax = 0, coreN = 0, coreUnder = 0, coreMin = 255;
    for (let k = 0; k < n; k++) {
      const ga = got[k * 4 + 3];
      const d = Math.abs(ga - want[k * 4 + 3]);
      hist[d]++;
      sum += d;
      if (!nearContent[k]) { clearN++; if (ga > 3) clearOver++; if (ga > clearMax) clearMax = ga; }
      if (!nearEdge[k]) { coreN++; if (ga < 250) coreUnder++; if (ga < coreMin) coreMin = ga; }
    }
    let p99 = 0;
    for (let k = 0, acc = 0; k < 256; k++) { acc += hist[k]; if (acc >= 0.99 * n) { p99 = k; break; } }
    let within6 = 0;
    for (let k = 0; k <= 6; k++) within6 += hist[k];
    const A = (px, x, y) => px[(y * w + x) * 4 + 3];
    const steps = STEPS.map((alpha, k) => {
      const b = stepBox(k, w);
      const x = b.x + b.w / 2, y = b.y + b.h / 2;
      return { want: A(want, x, y), got: A(got, x, y) };
    });
    return { mean: sum / n, p99, within6: within6 / n, clearN, clearOver, clearMax, coreN, coreUnder, coreMin, steps };
  }

  // --- the WebM check -------------------------------------------------------------------------------------------------

  const SAMPLES = [0, 17, 45, 59, 60, 89];         // frame indices compared with the PNG export (key frames 0 and 60)

  window.__webmCheck = async function (project) {
    const fps = 30, seconds = 3;
    const doc = loadProject(project, { format: 'webmAlpha', short: 720, fps, audio: true, quality: 'high', seconds });
    const t0 = doc.output.range.t0;
    const N = S.frameCount(seconds, fps);
    const out = { t0, N, probe: await J.probe({ w: 1280, h: 720, fps }) };
    const song = toneBuffer(t0 + seconds + 1, 48000);

    // 1. the transparent WebM, with the two encoders' chunks recorded
    const rec = recordVideoEncoders();
    let result;
    const progress = [];
    const started = performance.now();
    try {
      result = await WH.exportWebm({ engine: wrapEngine(sourceFor(doc), t0, fps), doc, audio: song,
        sink: SINK.createMemorySink({ type: 'video/webm' }), onProgress: (p) => progress.push(p) });
    } finally {
      rec.restore();
    }
    out.ms = performance.now() - started;
    out.result = { frames: result.frames, bytes: result.bytes, name: result.name, codec: result.codec, audio: result.audio,
      audioCodec: result.audioCodec };
    out.progress = { calls: progress.length, last: progress[progress.length - 1] };
    const [colourRec, alphaRec] = rec.made;
    out.encoders = rec.made.map((r) => ({ codec: r.config.codec, bitrate: r.config.bitrate, latencyMode: r.config.latencyMode,
      chunks: r.chunks.length, keys: r.chunks.map((c, i) => (c.key ? i : -1)).filter((i) => i >= 0),
      ts: r.chunks.every((c, i) => c.ts === S.ts(i, fps)) }));
    const blob = result.blob;
    out.file = toBase64(new Uint8Array(await blob.arrayBuffer()));

    // 2. read back through media/matroska: exactly the chunks written
    const rt = await roundTrip(blob, colourRec.chunks, alphaRec.chunks, fps);
    out.demux = rt.out;
    out.demux.level = SM.vp9Level(1280, 720, fps);
    // 3. decoded by WebCodecs from that table: N frames on both streams, each frame's code = its index
    out.decoded = await decodeStreams(blob, rt.movie.tracks.find((t) => t.kind === 'video'));
    // 4. decoded by Chrome's <video>: alpha against the transparent PNG export of the same frames
    const pngDoc = Object.assign({}, doc, { output: Object.assign({}, doc.output, { format: 'pngAlpha' }) });
    const png = await PNG.exportPngs({ engine: wrapEngine(sourceFor(pngDoc), t0, fps), doc: pngDoc, alpha: true,
      sink: SINK.createMemorySink() });
    const pngs = await zipPngFrames(png.blob, SAMPLES);
    const shown = await videoFrames(blob, SAMPLES, fps, 1280, 720);
    out.video = { duration: shown.duration, width: shown.width, height: shown.height, frames: shown.frames.map((f) => {
      const want = pngs.get(f.i);
      return Object.assign({ i: f.i, code: readCode(f.px, 1280), pngCode: readCode(want, 1280) }, compareAlpha(f.px, want, 1280, 720));
    }) };
    // 5. the sound: decodeAudioData of the WebM
    try {
      const ctx = new OfflineAudioContext(2, 48000, 48000);
      const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
      let sumSq = 0;
      const l = buffer.getChannelData(0);
      for (let i = 0; i < l.length; i++) sumSq += l[i] * l[i];
      out.sound = { frames: buffer.length, rate: buffer.sampleRate, rms: Math.sqrt(sumSq / Math.max(1, l.length)),
        want: S.audioFrames(N, fps, 48000) };
    } catch (e) {
      out.sound = { error: String(e && e.message) };
    }
    // 6. without the song, no audio track; cancel leaves nothing; no VP9 or VP8 → no-vp9
    const silentDoc = Object.assign({}, doc, { output: Object.assign({}, doc.output, { range: { t0, t1: t0 + 0.5 } }) });
    const silent = await WH.exportWebm({ engine: sourceFor(silentDoc), doc: silentDoc, audio: null, sink: SINK.createMemorySink() });
    const silentMovie = await demux(silent.blob);
    out.silent = { audio: silent.audio, tracks: silentMovie.tracks.map((t) => t.kind), frames: silent.frames };
    const sink = SINK.createMemorySink();
    const ctl = new AbortController();
    try {
      await WH.exportWebm({ engine: sourceFor(doc), doc, audio: song, sink, signal: ctl.signal,
        onProgress: (p) => { if (p.i === 4) ctl.abort(); } });
      out.cancel = { ok: true };
    } catch (e) {
      out.cancel = { ok: false, code: e.code, bytesLeft: sink.bytes };
    }
    try {
      await WH.exportWebm({ engine: sourceFor(silentDoc), doc: silentDoc, audio: null, sink: SINK.createMemorySink(), codecs: { webm: [] } });
      out.noVp9 = { ok: true };
    } catch (e) {
      out.noVp9 = { ok: false, code: e.code };
    }
    return out;
  };

  window.MVExportTest = { wrapEngine, drawTestLayer, readCode, loadProject, sourceFor, toneBuffer, demux, recordVideoEncoders,
    toBase64, compareAlpha, zipPngFrames, STEPS, stepBox, CODE_AT };
})();
