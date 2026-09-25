/* 文字PVメーカー v2 — original work. Browser harness for tests/browser/kit_check.py (not shipped): the Filmora kit in the real page. */
// Evaluated in the built app page (index.html?fresh=1&test=1) after tests/helpers/media_gen.js and tests/www/webm_check.js
// (window.MVExportTest). Exposes window.__kitCheck(project, { requireH264 }); every result is plain JSON.
(function () {
  'use strict';
  const a = window.__mv;
  const G = window.MVMediaGen;
  const T = window.MVExportTest;
  const S = MV.use('export/schedule');
  const J = MV.use('export/host/mp4');
  const KIT = MV.use('export/host/kit');
  const SINK = MV.use('export/host/sink');
  const SUB = MV.use('export/subtitles');
  const MKV = MV.use('media/matroska');
  const ISO = MV.use('media/isobmff');
  const PR = MV.use('media/host/probe');
  const STORE = MV.use('media/host/store');
  const MEDIA = MV.use('core/media');
  const SM = MV.use('media/samples');

  const FPS = 30, SECONDS = 2;
  const CHROMA = [0x00, 0xb1, 0x40];
  const KIT_ALL = { overlay: true, bg: true, green: true, srt: true, lrc: true };

  // An engine like the preview's (ui/boot services), but with a real AssetStore over this device's media.
  function engineWith(store) {
    const canvas = MV.use('engine/host/canvas').createCanvasFactory();
    const fonts = MV.use('engine/host/fonts').createFontBook({ document });
    const measurer = MV.use('engine/host/measure').createCanvasMeasurer(canvas, fonts);
    return MV.use('engine/facade').createEngine({ registry: a.svc.registry, canvas, measurer, fonts, assets: store });
  }

  // project_basic with a still photo as the background of the whole video (a pooled asset's derived ground), and the
  // pins that make background under overlay equal the full render (§13.7): no screen effects, no texture, one ground.
  async function setUp(project, output) {
    const stills = await G.stills();
    const imported = await PR.importFile(new File([stills.jpeg], 'sky.jpg', { type: 'image/jpeg' }), { name: 'sky.jpg', store: a.io.device });
    const entry = Object.assign({}, imported.entry, { pool: true });
    const pin = (v) => ({ v, by: 'user' });
    const file = JSON.parse(project);
    file.doc.media = { list: [entry] };
    file.doc.pins = Object.assign({}, file.doc.pins, {
      'work:ground': pin(MEDIA.keyOf(entry.id)), 'work:filter.count': pin(0), 'work:texture': pin('none'),
    });
    const doc = T.loadProject(JSON.stringify(file), Object.assign({ format: 'kit', short: 1080, fps: FPS, audio: true, quality: 'high',
      seconds: SECONDS }, output));
    a.dispatch({ t: 'output.set', key: 'kit', v: KIT_ALL });
    const entries = new Map([[entry.id, entry]]);
    const store = STORE.createMediaStore({ blobs: a.io.mediaBlobs, entries: (id) => entries.get(id) || null });
    const engine = engineWith(store);
    engine.setDoc(a.doc);
    return { doc: a.doc, store, engine, entry };
  }

  async function opfsFolder(name) {
    const root = await navigator.storage.getDirectory();
    try { await root.removeEntry(name, { recursive: true }); } catch (e) { /* not there */ }
    return { root, folder: await root.getDirectoryHandle(name, { create: true }) };
  }

  async function namesIn(dir) {
    const out = [];
    for await (const key of dir.keys()) out.push(key);
    return out.sort();
  }

  async function has(dir, name) { return (await namesIn(dir)).includes(name); }

  const reader = (blob) => async (at, n) => new Uint8Array(await blob.slice(at, at + n).arrayBuffer());

  // Every decoded frame of an MP4's video track through media/isobmff and VideoDecoder: the count, and the pixels of
  // frame `keep`.
  async function decodeMp4(blob, keep) {
    const movie = await ISO.parse(reader(blob), blob.size);
    const track = movie.tracks.find((t) => t.kind === 'video');
    const t = track.table;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let count = 0, kept = null;
    const errors = [];
    const canvas = new OffscreenCanvas(track.w, track.h);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const dec = new VideoDecoder({
      output: (f) => {
        if (count === keep) { g.drawImage(f, 0, 0); kept = g.getImageData(0, 0, track.w, track.h).data; }
        count++;
        f.close();
      },
      error: (e) => errors.push(String(e)),
    });
    // the colour space the file declares (Chrome's canvas frames are encoded as BT.601 and tagged so; a decoder that
    // assumes BT.709 instead shows #00B140 as about (0, 152, 61))
    const config = { codec: track.codec, codedWidth: track.codedW, codedHeight: track.codedH };
    const space = SM.colorSpaceOf(track.color);
    if (space) config.colorSpace = space;
    if (track.description) config.description = track.description;
    dec.configure(config);
    for (let d = 0; d < t.key.length; d++) {
      dec.decode(new EncodedVideoChunk({ type: t.key[d] ? 'key' : 'delta', timestamp: Math.round(t.ts[d]),
        data: bytes.subarray(t.off[d], t.off[d] + t.size[d]) }));
    }
    await dec.flush();
    dec.close();
    return { codec: track.codec, n: t.n, decoded: count, errors, w: track.w, h: track.h, px: kept,
      audio: movie.tracks.filter((x) => x.kind === 'audio').map((x) => x.codec) };
  }

  // The green screen: how far the four corner patches (24×24) are from #00B140, and how much of the frame is within ±4.
  function greenOf(px, w, h) {
    let worst = 0, within = 0;
    const off = (i) => Math.max(Math.abs(px[i] - CHROMA[0]), Math.abs(px[i + 1] - CHROMA[1]), Math.abs(px[i + 2] - CHROMA[2]));
    for (const [x0, y0] of [[0, 0], [w - 24, 0], [0, h - 24], [w - 24, h - 24]]) {
      for (let y = y0; y < y0 + 24; y++) for (let x = x0; x < x0 + 24; x++) worst = Math.max(worst, off((y * w + x) * 4));
    }
    for (let i = 0; i < px.length; i += 4) if (off(i) <= 4) within++;
    return { corners: worst, share: within / (w * h) };
  }

  // Background under overlay against the full render (§13.7, FG6), from the frames the PNG export encodes (rendered
  // and read back, no codec): straight-alpha "over" per pixel, MAE over RGB in 0–255.
  async function composite(engine, doc, frames) {
    const full = await J.openJob({ engine, doc, format: 'kit' });
    const over = await J.openJob({ engine, doc, format: 'kit', backdrop: 'clear' });
    const bg = await J.openJob({ engine, doc, format: 'kit', layers: 'ground' });
    const out = [];
    try {
      for (const i of frames) {
        const px = [];
        for (const job of [full, over, bg]) {
          await job.ready(i);
          job.render(i);
          px.push(job.surface.ctx.getImageData(0, 0, job.w, job.h).data);
        }
        const [f, o, b] = px;
        let sum = 0, max = 0, overlayPx = 0, bgDiffers = 0;
        for (let k = 0; k < f.length; k += 4) {
          const al = o[k + 3] / 255;
          if (o[k + 3]) overlayPx++;
          for (let c = 0; c < 3; c++) {
            const v = Math.round(o[k + c] * al + b[k + c] * (1 - al));
            const d = Math.abs(v - f[k + c]);
            sum += d;
            if (d > max) max = d;
            if (b[k + c] !== f[k + c]) bgDiffers++;
          }
        }
        out.push({ i, mae: sum / ((f.length / 4) * 3), max, overlayPx, bgDiffers });
      }
    } finally {
      for (const job of [full, over, bg]) job.engine.dispose();
    }
    return out;
  }

  async function text(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    return { bom, text: new TextDecoder().decode(bom ? bytes.subarray(3) : bytes) };
  }

  window.__kitCheck = async function (project, opts) {
    const o = opts || {};
    const out = {};
    const { doc, store, engine } = await setUp(project, {});
    const plan = engine.plan;
    const { t0, t1 } = S.exportRange(doc, plan);
    const N = S.frameCount(t1 - t0, FPS);
    const { w, h } = S.outputSize(plan.design.aspect, doc.output.short);
    const probe = await J.probe({ w, h, fps: FPS });
    const codecs = probe.codec ? null : { video: S.pickVp9(w, h, FPS)[0] };
    Object.assign(out, { t0, t1, N, w, h, probe, fallback: !probe.codec, base: S.kitBase(doc) });
    out.lines = plan.lines.map((l) => ({ t0: l.t0, t1: l.t1, text: l.text }));
    out.lrcWant = SUB.lrc(plan, doc);
    out.preflight = S.preflight(doc, plan, { webcodecs: true, codec: probe.codec, audioCodec: probe.audioCodec, anyCodec: probe.anyCodec,
      vp9Codec: probe.vp9Codec, fontsReady: true, fsAccess: true, dirAccess: true, songReady: true, registry: engine.registry,
      warnings: [] }).map((x) => x.code);
    out.kitFiles = S.kitFiles(doc, plan, { audioCodec: probe.audioCodec, songReady: true }).map((f) => f.name);
    const song = T.toneBuffer(t1 + 1, 48000);

    // 1. the kit into a folder (OPFS through createDirSink), with the store shared by both engine forks
    const name = S.kitFolder(doc);
    const { root, folder } = await opfsFolder(name);
    const progress = [];
    const started = performance.now();
    const result = await KIT.exportKit({ engine, doc, audio: song, dir: SINK.createDirSink(folder, { parent: root, name }), assets: store,
      codecs, onProgress: (p) => progress.push({ i: p.i, N: p.N, phase: p.phase }) });
    out.ms = performance.now() - started;
    out.result = { files: result.files, audio: result.audio, frames: result.frames, folder: result.folder, codec: result.codec,
      overlayCodec: result.overlayCodec, bytes: result.bytes, blob: !!result.blob };
    out.progress = { frames: progress.filter((p) => p.phase === 'video').length, phases: [...new Set(progress.map((p) => p.phase))],
      last: progress[progress.length - 1] };
    out.names = await namesIn(folder);
    const blobOf = async (n) => (await folder.getFileHandle(n)).getFile();
    const files = {};
    for (const f of result.files) files[f.kind] = await blobOf(f.name);
    out.mp4 = {};
    for (const kind of ['main', 'bg', 'green']) out.mp4[kind] = T.toBase64(new Uint8Array(await files[kind].arrayBuffer()));
    if (files.wav) out.wav = T.toBase64(new Uint8Array(await files.wav.arrayBuffer()));
    out.srt = await text(files.srt);
    out.lrc = await text(files.lrc);
    out.readme = await text(files.readme);
    // decoded: the background has N frames, the green screen is #00B140 around the words, the main MP4's codec
    const bg = await decodeMp4(files.bg, 30);
    out.bg = { codec: bg.codec, n: bg.n, decoded: bg.decoded, errors: bg.errors };
    const green = await decodeMp4(files.green, 30);
    out.green = Object.assign({ n: green.n, decoded: green.decoded, errors: green.errors }, green.px ? greenOf(green.px, green.w, green.h) : {});
    const main = await decodeMp4(files.main, -1);
    out.main = { codec: main.codec, n: main.n, decoded: main.decoded, errors: main.errors, audio: main.audio };
    // the overlay: VP9 alpha through media/matroska, and Chrome shows it transparent around the words
    const movie = await MKV.parse(reader(files.overlay), files.overlay.size);
    const ov = movie.tracks.find((t) => t.kind === 'video');
    out.overlay = { codec: ov.codec, alpha: ov.alpha, n: ov.table.n, alphaFrames: ov.table.asize ? Array.from(ov.table.asize).filter((x) => x > 0).length : 0,
      audio: movie.tracks.filter((t) => t.kind === 'audio').length };
    const url = URL.createObjectURL(files.overlay);
    try {
      const video = document.createElement('video');
      video.muted = true;
      video.src = url;
      await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = () => reject(new Error('overlay does not load')); });
      const shown = new Promise((resolve) => video.requestVideoFrameCallback(() => resolve()));
      video.currentTime = 30.5 / FPS;
      await new Promise((resolve) => { video.onseeked = resolve; });
      await Promise.race([shown, new Promise((r) => setTimeout(r, 1000))]);
      const c = new OffscreenCanvas(w, h);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(video, 0, 0, w, h);
      const px = g.getImageData(0, 0, w, h).data;
      let clear = 0, solid = 0;
      for (let k = 3; k < px.length; k += 4) { if (px[k] === 0) clear++; if (px[k] === 255) solid++; }
      out.overlay.shown = { corner: px[3], clear: clear / (w * h), solid };
    } finally {
      URL.revokeObjectURL(url);
    }
    // 2. background under overlay equals the full render (frames of the PNG export, no codec)
    out.composite = await composite(engine, doc, [0, 30, 59]);

    // 3. without folder access: memory sinks and one ZIP with the same files (AAC forced away: the WAV is in it)
    const saved = Object.getOwnPropertyDescriptor(window, 'showDirectoryPicker');
    Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
    try {
      out.canDirectory = SINK.canDirectory();
      out.memoryPreflight = S.preflight(doc, plan, { webcodecs: true, codec: probe.codec, audioCodec: probe.audioCodec, anyCodec: probe.anyCodec,
        vp9Codec: probe.vp9Codec, fontsReady: true, fsAccess: SINK.canStream(), dirAccess: SINK.canDirectory(), songReady: true,
        warnings: [] }).filter((x) => x.code === 'kit-memory');
      const zipped = await KIT.exportKit({ engine, doc, audio: song, dir: null, assets: store,
        codecs: Object.assign({}, codecs || {}, { audioList: ['bogus.aac'] }) });
      out.zip = { name: zipped.name, audio: zipped.audio, files: zipped.files.map((f) => f.name), bytes: zipped.bytes,
        data: T.toBase64(new Uint8Array(await zipped.blob.arrayBuffer())) };
    } finally {
      if (saved) Object.defineProperty(window, 'showDirectoryPicker', saved);
      else delete window.showDirectoryPicker;
    }

    // 4. cancel: the folder and everything in it is removed
    const gone = await opfsFolder('kit_cancel');
    const ctl = new AbortController();
    try {
      await KIT.exportKit({ engine, doc, audio: song, dir: SINK.createDirSink(gone.folder, { parent: gone.root, name: 'kit_cancel' }),
        assets: store, codecs, signal: ctl.signal, onProgress: (p) => { if (p.i === 5) ctl.abort(); } });
      out.cancel = { ok: true };
    } catch (e) {
      out.cancel = { ok: false, code: e.code, folderLeft: await has(gone.root, 'kit_cancel') };
    }
    await root.removeEntry(name, { recursive: true });
    engine.dispose();
    store.dispose();
    return out;
  };
})();
