/* 文字PVメーカー v2 — original work. Browser harness for the media parts (DESIGN_2_1 §11.8.3, package G.3; not shipped). */
// Evaluated in the built app page (index.html?fresh=1&test=1) after tests/helpers/exif_write.js and
// tests/helpers/media_gen.js, so everything runs under the app's real CSP with its real modules and device store.
// The engines made here get a store of their own (media/host/store over the app's device store); the app's own engine has
// the AssetStore ui/boot gives it (package G.4), and its forks (the export's) fork that store.
// window.__mediaParts = { exact, alpha, determinism, perf, importPng, boxOf } → plain JSON for Python:
//   media_exact.py        exact.prepare(), exact.run(job), exact.mp4(job)
//   media_alpha.py        alpha()
//   determinism.py        determinism(opts)
//   perf.py               perf(opts)
//   transparent_check.py  importPng(), boxOf(owner, t, w)
(function () {
  'use strict';
  const a = window.__mv;
  const G = window.MVMediaGen;
  const FAC = MV.use('engine/facade');
  const HC = MV.use('engine/host/canvas');
  const HM = MV.use('engine/host/measure');
  const SH = MV.use('engine/render/shapes');
  const BUILD = MV.use('engine/scene/build');
  const STORE = MV.use('media/host/store');
  const PR = MV.use('media/host/probe');
  const PNG = MV.use('export/host/png');
  const MP4 = MV.use('export/host/mp4');
  const SINK = MV.use('export/host/sink');
  const S = MV.use('export/schedule');
  const U = MV.use('export/unzip');
  const D = MV.use('core/doc');

  const factory = HC.createCanvasFactory();
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const entries = new Map();                   // every asset imported here: id → entry (the stores' metadata)

  // --- assets, stores, engines and documents ------------------------------------------------------------------------------

  async function importBytes(bytes, name, type) {
    const e = await a.io.importMedia(new File([bytes], name, type ? { type } : {}));
    if (!e) throw new Error('media_parts: the import of ' + name + ' failed');
    entries.set(e.id, e);
    return e;
  }

  // A still of one CSS colour (w × h), as PNG bytes.
  async function solidPng(w, h, css) {
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d');
    g.fillStyle = css;
    g.fillRect(0, 0, w, h);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  }

  function newStore() {
    return STORE.createMediaStore({ blobs: a.io.mediaBlobs, entries: (id) => entries.get(id) || null });
  }

  function newEngine(store) {
    return FAC.createEngine({ registry: a.reg, canvas: factory, measurer: HM.createCanvasMeasurer(factory, null), fonts: null,
      assets: store });
  }

  // Pins that keep a picture clean: no decorations, screen effects, texture, atmosphere, flash, shake or camerawork, the
  // fallback transition, and the text hidden (el.text.hide) unless the caller shows it.
  function quietPins() {
    return { 'work:ornament.count': 0, 'work:filter.count': 0, 'work:atmos': 'none', 'work:texture': 'none',
      'work:amount.flash': 0, 'work:amount.shake': 0, 'work:cam.shot': 'none', 'work:rig': 'none',
      'work:seam': a.reg.fallback('seam'), 'work:el.text.hide': true };
  }

  // A document of the library imported here: lyric lines, work pins (values; null drops a quiet pin), output and backdrop.
  function docOf(text, pins, output, backdrop) {
    const doc = D.defaultDoc();
    const lines = text.split('\n');
    doc.sheet = { next: lines.length + 1, rows: lines.map((src, i) => ({ id: 'r' + (i + 1), src })) };
    doc.media = { list: [...entries.values()].map(clone) };
    for (const [path, v] of Object.entries(Object.assign(quietPins(), pins || {}))) if (v !== null) doc.pins[path] = { v, by: 'user' };
    Object.assign(doc.output, { audio: false }, output || {});
    if (backdrop) doc.look.backdrop = backdrop;
    return doc;
  }

  // Work pins of one media part: the part in its slot and its params (part-qualified; the shared amount and ink at the
  // slot's shared path).
  const SHARED = ['amount', 'ink'];
  function partPins(slot, key, params) {
    const out = { ['work:' + slot]: key };
    for (const [k, v] of Object.entries(params)) out['work:' + slot + (SHARED.includes(k) ? '.' : '@' + key + '.') + k] = v;
    return out;
  }

  function surfaceOf(w, h, alpha) {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext('2d', { alpha: alpha !== false }), w, h };
  }

  // The export's PNG frames (export/host/png on a fork of the engine, a memory sink) → [Blob], in order.
  async function pngFrames(engine, doc, alpha) {
    const sink = SINK.createMemorySink({ type: 'application/zip' });
    const r = await PNG.exportPngs({ engine, doc, sink, alpha: !!alpha });
    const bytes = new Uint8Array(await r.blob.arrayBuffer());
    const read = async (at, n) => bytes.subarray(at, at + n);
    const z = await U.openZip(read, bytes.length);
    const list = [...z.entries.values()].filter((e) => e.name.endsWith('.png')).sort((x, y) => (x.name < y.name ? -1 : 1));
    const out = [];
    for (const e of list) {
      const start = await U.dataStart(read, e);
      out.push(new Blob([bytes.subarray(start, start + e.bytes)], { type: 'image/png' }));
    }
    return { frames: out, ms: r.ms };
  }

  // The counter code shown in a rect of an image (the whole image when rect is null), read at the pattern's own size.
  function codeIn(image, rect) {
    const c = new OffscreenCanvas(G.W, G.H);
    const g = c.getContext('2d');
    if (rect) g.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, G.W, G.H);
    else g.drawImage(image, 0, 0, G.W, G.H);
    return G.readCounter(g.getImageData(0, 0, G.W, G.H).data, G.W, G.H);
  }

  // The first lyric cut of a line in the engine's plan, with its scene times (absolute: t0 + local).
  function cutOf(engine, line) {
    const plan = engine.plan;
    const i = plan.cuts.findIndex((c) => c.line === line && c.role === 'lyric');
    const cut = plan.cuts[i];
    const s = surfaceOf(64, 36);
    engine.renderFrame(s, (cut.a + cut.b) / 2, { quality: 'preview', scale: 64 / plan.design.w });
    const tm = engine.scene('cut', i).times;
    return { cut, a: cut.t0 + tm.a, rest: cut.t0 + tm.rest, out: cut.t0 + tm.out, b: cut.t0 + tm.b };
  }

  // --- frame exactness (media_exact.py) ---------------------------------------------------------------------------------

  const clips = {};

  // The counter videos (media_gen.js): VP9 in WebM at 30 fps, VP9 in MP4 at 25 fps, VFR (VP9 in MP4: 1 s at 30 fps, then
  // 1 s at 15 fps) and H.264 in MP4 at 30 fps where this browser encodes it; 2 s each. → { name: { id, times, dur, fps } }.
  async function prepareExact() {
    const h264 = await G.h264();
    const specs = { webm30: { container: 'webm', fps: 30, frames: 60 }, mp4_25: { container: 'mp4', fps: 25, frames: 50 },
      vfr: { container: 'mp4', vfr: true, frames: 45 } };
    if (h264) specs.h264 = { container: 'mp4', fps: 30, frames: 60, codec: h264 };
    for (const [name, spec] of Object.entries(specs)) {
      if (clips[name]) continue;
      const made = await G.encodeCounter(spec);
      const e = await importBytes(made.bytes, name + (spec.container === 'webm' ? '.webm' : '.mp4'));
      clips[name] = { id: e.id, times: made.times, dur: e.dur, fps: e.fps, frames: e.frames, codec: e.codec, vfr: !!spec.vfr };
    }
    return { h264, clips };
  }

  // A store (and every fork of it: an export forks the engine, and the fork forks the store) whose frame() calls for id
  // with a blur are counted: baked (MediaFrame.blur > 0, the store's copy) or not.
  function bakeWatched(store, id, count) {
    return Object.assign({}, store, {
      frame(fid, m, want) {
        const f = store.frame(fid, m, want);
        if (fid === id && f && want && want.blur > 0) { if (f.blur > 0) count.yes++; else count.no++; }
        return f;
      },
      fork(o) { return bakeWatched(store.fork(o), id, count); },
    });
  }

  // One PNG export of a counter video and the code of every frame. job = { clip, fps, short, t0, t1, params, kind }:
  //   kind 'ground' (default): the work background (photoPan: cover, still depth, no motion, no veil, clock song unless
  //     params say otherwise); the code is read over the whole frame;
  //   kind 'frame': a photo frame in the middle of the first lyric cut (clock show: the clip starts when the cut appears),
  //     the export range inside the cut's hold (the text-following envelope at 1); the code is read in the frame's rect.
  // → { codes, t0, fps, n, w, h, cutA (absolute time the cut appears, kind 'frame'), baked: { yes, no } (the frames of the
  //   clip drawn with a blur: with the store's baked copy, or without) }
  async function runExact(job) {
    const clip = clips[job.clip];
    const media = Object.assign({ fit: 'cover', move: 'none', depth: 'still', clock: job.kind === 'frame' ? 'show' : 'song' }, job.params || {});
    const text = '[00:00.50]あいうえお\n[00:04.00]かきくけこ';
    const pins = job.kind === 'frame'
      ? Object.assign({ 'work:ornament.count': 1 }, partPins('ornament#0', 'photoFrame', Object.assign({ src: clip.id, place: 'free',
        shape: 'rect', size: 0.9, tilt: 0, border: 0, shadow: 0, appear: 'none' }, media)))
      : partPins('ground', 'photoPan', Object.assign({ image: clip.id, veil: 0 }, media));
    const output = { format: 'png', short: job.short, fps: job.fps, range: { t0: job.t0 || 0, t1: job.t1 } };
    let doc = docOf(text, pins, output);
    const store = newStore();
    const baked = { yes: 0, no: 0 };
    const engine = newEngine(bakeWatched(store, clip.id, baked));
    try {
      engine.setDoc(doc);
      let rect = null, cutA = null;
      if (job.kind === 'frame') {
        const c = cutOf(engine, 'r1');
        cutA = c.cut.a;
        const f = job.fps;
        const t0 = Math.ceil((c.rest + 0.05) * f) / f, t1 = Math.min(t0 + (job.seconds || 1.2), Math.floor((c.out - 0.05) * f) / f);
        doc = Object.assign({}, doc, { output: Object.assign({}, doc.output, { range: { t0, t1 } }) });
        engine.setDoc(doc);
        const plan = engine.plan, De = BUILD.designEnv(plan.design);
        const { w: W } = S.outputSize(plan.design.aspect, job.short);
        const k = W / plan.design.w, meta = plan.media[clip.id];
        const bw = 0.9 * De.short, bh = bw / (meta.w / meta.h);
        rect = { x: (De.cx - bw / 2) * k, y: (De.cy - bh / 2) * k, w: bw * k, h: bh * k };
      }
      const { t0 } = S.exportRange(doc, engine.plan);
      const { frames, ms } = await pngFrames(engine, doc);
      const codes = [];
      let w = 0, h = 0;
      for (const blob of frames) {
        const bmp = await createImageBitmap(blob);
        w = bmp.width; h = bmp.height;
        codes.push(codeIn(bmp, rect));
        bmp.close();
      }
      return { codes, t0, fps: job.fps, n: frames.length, w, h, cutA, ms: Math.round(ms), baked };
    } finally {
      engine.dispose();
      store.dispose();
    }
  }

  // An MP4 export of the counter background (H.264 where this browser encodes it, else VP9 in MP4), read back through the
  // demuxer and a software decoder: the code of every frame. job = { clip, seconds, fps, short } → { codes, codec, fps }
  async function mp4Exact(job) {
    const clip = clips[job.clip];
    const pins = partPins('ground', 'photoPan', { image: clip.id, veil: 0, fit: 'cover', move: 'none', depth: 'still', clock: 'song' });
    const doc = docOf('[00:00.50]あいうえお\n[00:04.00]かきくけこ', pins, { format: 'mp4', short: job.short, fps: job.fps,
      range: { t0: 0, t1: job.seconds } });
    const store = newStore();
    const engine = newEngine(store);
    let codes = [], entry = null;
    try {
      engine.setDoc(doc);
      const codecs = (await G.h264()) ? null : { video: 'vp09.00.40.08' };
      const sink = SINK.createMemorySink({ type: 'video/mp4' });
      const r = await MP4.exportVideo({ engine, doc, sink, audio: null, codecs });
      const bytes = new Uint8Array(await r.blob.arrayBuffer());
      const got = await PR.importFile(new File([bytes], 'exact_roundtrip.mp4'), { name: 'exact_roundtrip.mp4', store: a.io.device });
      entry = got.entry;
      entries.set(entry.id, entry);
      const reader = newStore();
      const soft = reader.fork();
      for (let k = 0; k < entry.frames; k++) {
        const m = k / job.fps;
        await soft.ready([{ id: entry.id, m }]);
        const f = soft.frame(entry.id, m, { px: 1280, blur: 0, exact: true, thumb: false });
        codes.push(f && f.exact && f.index === k ? codeIn(f.image, null) : -2);
      }
      soft.dispose();
      reader.dispose();
    } finally {
      engine.dispose();
      store.dispose();
    }
    return { codes, codec: entry && entry.codec, fps: entry && entry.fps, frames: entry && entry.frames };
  }

  // --- alpha, backdrops and depth (media_alpha.py) ------------------------------------------------------------------------

  // RGBA of an image drawn 1:1 (straight alpha, as getImageData gives it).
  async function rgbaOf(blob) {
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const img = g.getImageData(0, 0, bmp.width, bmp.height);
    bmp.close();
    return img;
  }

  const px = (img, x, y) => { const i = 4 * (Math.round(y) * img.width + Math.round(x)); return Array.from(img.data.subarray(i, i + 4)); };

  // How many pixels match fn(r, g, b, a), and whether every pixel does.
  function census(img, fn) {
    const d = img.data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (fn(d[i], d[i + 1], d[i + 2], d[i + 3])) n++;
    return { n, all: n === d.length / 4, of: d.length / 4 };
  }

  // The alpha checks of media_alpha.py (DESIGN_2_1 §11.4.10, §11.8.3, §11.9.7):
  //   merged     the alpha WebM of media_gen.js through the store: its merged frame's alpha at 5 times, inside and outside
  //              the half-transparent square (truth: 128 inside, 0 outside);
  //   frame      the same clip as a photo frame (shape free: its own alpha) in a transparent PNG export (透過PNG): the
  //              frame's alpha at the square and around it, and nothing outside the frame;
  //   backdrops  photoPan (a red still) and mediaLayer (a blue still) exported over each backdrop: drawn only over the
  //              scene backdrop; chroma, black and clear frames hold nothing but the backdrop;
  //   depth      a mediaLayer (a blue still, blend normal) in front of the text is drawn over the glyphs; behind it (anim,
  //              back) the glyphs keep their ink (a pixel probe on the glyphs of a frame without the overlay).
  async function alphaChecks() {
    const out = {};
    const made = await G.encodeCounter({ container: 'webm', fps: 30, frames: 30, alpha: true });
    const e = await importBytes(made.bytes, 'alpha.webm');
    out.entry = { alpha: e.alpha, frames: e.frames, dur: e.dur, fps: e.fps };
    const inside = (sx) => [[sx + 12, 88], [sx + 5, 81], [sx + 19, 95], [sx + 5, 95], [sx + 19, 81]];
    const outside = (sx) => [[100, 20], [20, 50], [sx + 12, 66], [sx + 12, 104], [Math.min(G.W - 3, sx + 34), 88]];
    const store = newStore();
    out.merged = [];
    for (const k of [0, 7, 13, 21, 29]) {
      await store.ready([{ id: e.id, m: k / 30 }]);
      const f = store.frame(e.id, k / 30, { px: G.W, blur: 0, exact: true, thumb: false });
      const c = new OffscreenCanvas(G.W, G.H);
      const g = c.getContext('2d');
      g.drawImage(f.image, 0, 0, G.W, G.H);
      const img = g.getImageData(0, 0, G.W, G.H);
      const sx = G.squareX(k);
      out.merged.push({ k, index: f.index, exact: f.exact, inside: inside(sx).map(([x, y]) => px(img, x, y)[3]),
        outside: outside(sx).map(([x, y]) => px(img, x, y)[3]) });
    }
    store.dispose();

    // the clip as a photo frame in a transparent PNG export
    const pins = Object.assign({ 'work:ornament.count': 1 }, partPins('ornament#0', 'photoFrame', { src: e.id, place: 'free', shape: 'free',
      size: 1, tilt: 0, appear: 'none', depth: 'still', move: 'none', fit: 'cover', clock: 'show' }));
    let doc = docOf('[00:00.50]あいうえお\n[00:04.00]かきくけこ', pins, { format: 'png', short: 720, fps: 30 });
    const fstore = newStore();
    const engine = newEngine(fstore);
    try {
      engine.setDoc(doc);
      const cut = cutOf(engine, 'r1');
      const t0 = Math.ceil((cut.rest + 0.05) * 30) / 30;
      doc = Object.assign({}, doc, { output: Object.assign({}, doc.output, { range: { t0, t1: t0 + 5 / 30 } }) });
      engine.setDoc(doc);
      const plan = engine.plan, De = BUILD.designEnv(plan.design);
      const { w: W } = S.outputSize(plan.design.aspect, 720);
      const k = W / plan.design.w, bw = De.short, bh = bw / (G.W / G.H);
      const rect = { x: (De.cx - bw / 2) * k, y: (De.cy - bh / 2) * k, w: bw * k, h: bh * k };
      const s = rect.w / G.W;
      const { frames } = await pngFrames(engine, doc, true);
      out.frame = { rect, frames: [] };
      for (let i = 0; i < frames.length; i++) {
        const t = t0 + i / 30, m = t - cut.cut.a;
        let kk = 0;
        for (let j = 0; j < made.times.length; j++) if (made.times[j] <= (m % 1) + 1e-4) kk = j;
        const img = await rgbaOf(frames[i]);
        const sx = G.squareX(kk);
        const at = ([x, y]) => px(img, rect.x + x * s, rect.y + y * s)[3];
        out.frame.frames.push({ t, k: kk, size: [img.width, img.height], inside: inside(sx).map(at), outside: outside(sx).map(at),
          beyond: [px(img, 8, 8)[3], px(img, img.width - 8, img.height - 8)[3], px(img, rect.x - 10, img.height / 2)[3]],
          clear: census(img, (r, g, b, al) => al === 0).n });
      }
    } finally {
      engine.dispose();
      fstore.dispose();
    }

    // photoPan and mediaLayer over each backdrop
    const red = await importBytes(await solidPng(160, 90, '#ff0000'), 'red.png', 'image/png');
    const blue = await importBytes(await solidPng(160, 90, '#0000ff'), 'blue.png', 'image/png');
    const setups = {
      photoPan: partPins('ground', 'photoPan', { image: red.id, depth: 'still', veil: 0, move: 'none' }),
      mediaLayer: partPins('atmos', 'mediaLayer', { src: blue.id, depth: 'still', blend: 'normal', move: 'none', amount: 1 }),
    };
    const isRed = (r, g, b, al) => al > 200 && r > 200 && g < 60 && b < 60;
    const isBlue = (r, g, b, al) => al > 200 && b > 200 && r < 60 && g < 60;
    out.backdrops = {};
    for (const [part, pinsOf] of Object.entries(setups)) {
      for (const backdrop of ['scene', 'chroma', 'black', 'clear']) {
        const d = docOf('[00:00.50]あいうえお\n[00:04.00]かきくけこ', pinsOf, { format: backdrop === 'clear' ? 'pngAlpha' : 'png', short: 360, fps: 30,
          range: { t0: 1, t1: 1 + 1 / 30 } }, backdrop === 'clear' ? 'scene' : backdrop);
        const st = newStore();
        const en = newEngine(st);
        try {
          en.setDoc(d);
          const { frames } = await pngFrames(en, d, backdrop === 'clear');
          const img = await rgbaOf(frames[0]);
          out.backdrops[part + ' ' + backdrop] = {
            red: census(img, isRed).n, blue: census(img, isBlue).n,
            green: census(img, (r, g, b, al) => al === 255 && r === 0x00 && g === 0xB1 && b === 0x40).all,
            black: census(img, (r, g, b, al) => al === 255 && r === 0 && g === 0 && b === 0).all,
            clear: census(img, (r, g, b, al) => al === 0).all,
          };
        } finally {
          en.dispose();
          st.dispose();
        }
      }
    }

    // depth: a mediaLayer in front of the text draws over the glyphs (§11.9.7)
    const INK = [0xF2, 0xC2, 0x30];
    const shown = { 'work:el.text.hide': null, 'work:el.text.fill': '#F2C230', 'work:text.scale': 1.6, 'work:text.style': 'plain' };
    const frameWith = async (depth) => {
      const p = Object.assign({}, shown, depth ? partPins('atmos', 'mediaLayer', { src: blue.id, depth, blend: 'normal', move: 'none',
        amount: 1 }) : {});
      const d = docOf('[00:00.50]あいうえおかき\n[00:04.00]かきくけこ', p, { format: 'png', short: 540, fps: 30 });
      const st = newStore();
      const en = newEngine(st);
      try {
        en.setDoc(d);
        const cut = cutOf(en, 'r1');
        const t = (cut.rest + cut.out) / 2;
        const surf = surfaceOf(960, 540, false);
        const scale = 960 / en.plan.design.w;
        await en.mediaReady(t, { scale });
        const stats = en.renderFrame(surf, t, { quality: 'export', scale });
        return { img: surf.ctx.getImageData(0, 0, 960, 540), stats };
      } finally {
        en.dispose();
        st.dispose();
      }
    };
    const base = await frameWith(null);
    const mask = [];
    for (let i = 0; i < base.img.data.length; i += 4) {
      const d = base.img.data;
      if (Math.abs(d[i] - INK[0]) <= 3 && Math.abs(d[i + 1] - INK[1]) <= 3 && Math.abs(d[i + 2] - INK[2]) <= 3) mask.push(i);
    }
    out.depth = { glyphPixels: mask.length };
    for (const depth of ['front', 'anim', 'back']) {
      const f = await frameWith(depth);
      const d = f.img.data;
      let ink = 0, raised = 0;
      for (const i of mask) {
        if (Math.abs(d[i] - INK[0]) <= 3 && Math.abs(d[i + 1] - INK[1]) <= 3 && Math.abs(d[i + 2] - INK[2]) <= 3) ink++;
        if (d[i + 2] - INK[2] >= 40) raised++;
      }
      out.depth[depth] = { ink, raised, media: f.stats.media.drawn, blueOutside: census(f.img, (r, g, b) => b > 150 && r < 120 && g < 120).n };
    }
    return out;
  }

  // --- determinism (determinism.py) --------------------------------------------------------------------------------------

  function hashOf(img) {
    const d = img.data;
    let h = 0x811c9dc5;
    for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(16).padStart(8, '0');
  }

  // A store whose frame() calls are seen (the test hook): the last MediaFrame index handed out per asset, whether it was
  // exact, and the blur already applied to it (MediaFrame.blur: a baked video frame, a blurred still).
  function watched(store) {
    const seen = new Map();
    const spy = Object.assign({}, store, {
      frame(id, m, want) {
        const f = store.frame(id, m, want);
        seen.set(id, f ? { index: f.index, exact: f.exact, baked: f.blur > 0 } : null);
        return f;
      },
    });
    return { store: spy, seen };
  }

  // A still with detail everywhere (so resampling shows), w × h, as JPEG bytes.
  async function patternJpeg(w, h) {
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#2a6fdb'); grad.addColorStop(0.5, '#f2c230'); grad.addColorStop(1, '#d9483b');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    for (let y = 0; y < h; y += 40) for (let x = ((y / 40) & 1) * 40; x < w; x += 80) g.fillRect(x, y, 40, 40);
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).arrayBuffer());
  }

  // determinism.py (DESIGN_2_1 §11.8.3): a project with a video ground (the VP9 counter, clock song), a photo frame of the
  // alpha WebM (clock show) and a still photo frame, the automatic camerawork on. In export quality (a software fork, the
  // frame awaited with mediaReady): frame N of a fresh engine equals frame N after 0..N−1 (pixel hashes), and the 60-fps
  // run equals the 30-fps run at their shared times. The paused preview (the root store, hardware preferred) after a
  // scrub, redrawn until it is exact, shows the export's source frames (MediaFrame.index through the store's frame
  // calls), with pixels within MAE ≤ 2/255. o = { fps, seconds, probes, w }
  async function determinism(o) {
    const q = Object.assign({ fps: 30, seconds: 2, probes: [7, 31, 59], w: 640 }, o || {});
    await prepareExact();
    const alphaClip = await G.encodeCounter({ container: 'webm', fps: 30, frames: 30, alpha: true });
    const alpha = await importBytes(alphaClip.bytes, 'determinism_alpha.webm');
    const still = await importBytes(await patternJpeg(1200, 800), 'determinism_still.jpg', 'image/jpeg');
    const pins = Object.assign({ 'work:ornament.count': 2, 'work:el.text.hide': null, 'work:cam.shot': null, 'work:rig': null },
      partPins('ground', 'photoPan', { image: clips.webm30.id, clock: 'song' }),
      partPins('ornament#0', 'photoFrame', { src: alpha.id, place: 'side', clock: 'show' }),
      partPins('ornament#1', 'photoFrame', { src: still.id, place: 'corner', shape: 'circle' }));
    const doc = docOf('[00:00.50]あいうえお\n[00:03.00]かきくけこ\n[00:05.50]さしすせそ', pins, { format: 'png', short: 360, fps: q.fps });
    const root = newStore();
    const sizing = newEngine(root);
    sizing.setDoc(doc);
    const plan = sizing.plan;
    const w = q.w, h = Math.round((w * plan.design.h) / plan.design.w), scale = w / plan.design.w;
    const c0 = cutOf(sizing, 'r1');
    const t0 = Math.ceil(c0.cut.a * 60) / 60;
    sizing.dispose();
    const run = async (fps, times) => {
      const fork = root.fork();
      const { store, seen } = watched(fork);
      const e = newEngine(store);
      e.setDoc(doc);
      const surf = surfaceOf(w, h, false);
      const out = [];
      try {
        for (const t of times) {
          await e.mediaReady(t, { fps, scale });
          const st = e.renderFrame(surf, t, { quality: 'export', scale });
          const img = surf.ctx.getImageData(0, 0, w, h);
          out.push({ hash: hashOf(img), img, media: st.media.drawn, fallback: st.media.fallback, index: Object.fromEntries(seen) });
        }
      } finally {
        e.dispose();
        fork.dispose();
      }
      return out;
    };
    const n = Math.round(q.seconds * q.fps);
    const at = (fps, k) => t0 + k / fps;
    const seq = await run(q.fps, Array.from({ length: n }, (_, k) => at(q.fps, k)));
    const res = { t0, n, w, h, media: seq.map((x) => x.media), distinct: new Set(seq.map((x) => x.hash)).size, alone: [], rate: null, preview: [],
      fallback: seq.map((x) => x.fallback), videoBaked: seq.map((x) => !!(x.index[clips.webm30.id] && x.index[clips.webm30.id].baked)) };
    for (const k of q.probes) {
      const [one] = await run(q.fps, [at(q.fps, k)]);
      res.alone.push({ k, same: one.hash === seq[k].hash, index: one.index, seqIndex: seq[k].index });
    }
    const seq2 = await run(2 * q.fps, Array.from({ length: 2 * n }, (_, k) => at(2 * q.fps, k)));
    res.rate = seq.every((x, k) => x.hash === seq2[2 * k].hash) ? 'same' : seq.map((x, k) => x.hash === seq2[2 * k].hash ? '.' : 'x').join('');
    // the paused preview after scrubbing: the root store (hardware preferred), redrawn until exact
    const { store, seen } = watched(root);
    const pe = newEngine(store);
    pe.setDoc(doc);
    const surf = surfaceOf(w, h, false);
    try {
      for (const k of q.probes) {
        const t = at(q.fps, k);
        let st = pe.renderFrame(surf, t, { quality: 'preview', scale });
        const first = st.provisional;
        let tries = 0;
        while (st.provisional && tries++ < 400) {
          store.want(pe.mediaAt(t, { scale }));
          await new Promise((r) => setTimeout(r, 10));
          st = pe.renderFrame(surf, t, { quality: 'preview', scale });
        }
        const img = surf.ctx.getImageData(0, 0, w, h);
        let sum = 0;
        for (let i = 0; i < img.data.length; i += 4) {
          for (let ch = 0; ch < 3; ch++) sum += Math.abs(img.data[i + ch] - seq[k].img.data[i + ch]);
        }
        res.preview.push({ k, first, provisional: st.provisional, tries, index: Object.fromEntries(seen), exportIndex: seq[k].index,
          mae: sum / (3 * w * h) / 255 });
      }
    } finally {
      pe.dispose();
      root.dispose();
    }
    res.ids = { video: clips.webm30.id, alpha: alpha.id, still: still.id };
    return res;
  }

  // --- performance (perf.py) ---------------------------------------------------------------------------------------------

  // A counter video at any size (the media_gen.js pattern scaled up), VP9 in WebM: { bytes, times }. With alpha, the
  // two-encoder path of media_gen.js (the alpha stream's square at 128). With bars, six saturated colour bars across the
  // lower quarter (so a colour matrix shows).
  const BARS = ['#e02020', '#20c040', '#2040e0', '#f0d020', '#20d0e0', '#d020c0'];
  async function bigCounter(W, H, fps, frames, keyEvery, alpha, bars) {
    const kx = W / G.W, ky = H / G.H;
    const times = Array.from({ length: frames }, (_, i) => i / fps);
    const encodeWith = async (source, bitrate) => {
      const chunks = [];
      let failure = null;
      const enc = new VideoEncoder({ output: (chunk) => { const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); chunks.push({ d, key: chunk.type === 'key', ts: chunk.timestamp }); },
        error: (err) => { failure = err; } });
      enc.configure({ codec: 'vp09.00.40.08', width: W, height: H, bitrate, framerate: fps, latencyMode: 'realtime' });
      for (let i = 0; i < frames; i++) {
        const ts = Math.round(times[i] * 1e6);
        const frame = source(i, ts);
        enc.encode(frame, { keyFrame: i % keyEvery === 0 });
        frame.close();
        while (enc.encodeQueueSize > 4) await new Promise((r) => setTimeout(r, 1));
      }
      await enc.flush();
      enc.close();
      if (failure) throw failure;
      return chunks;
    };
    const colour = await encodeWith((i, ts) => {
      const c = new OffscreenCanvas(W, H);
      const g = c.getContext('2d');
      g.scale(kx, ky);
      G.drawCounter(g, i, !!alpha);
      if (bars) BARS.forEach((ink, k) => { g.fillStyle = ink; g.fillRect(8 + k * 29, 80, 29, 20); });
      return new VideoFrame(c, { timestamp: ts, duration: Math.round(1e6 / fps), alpha: 'discard' });
    }, 4000000);
    const mask = alpha ? await encodeWith((i, ts) => {
      const y = new Uint8Array(W * H), uv = (W / 2) * (H / 2);
      const x0 = Math.round(G.squareX(i) * kx), y0 = Math.round(76 * ky), s = Math.round(24 * kx);
      for (let r = y0; r < y0 + s && r < H; r++) y.fill(128, r * W + x0, r * W + Math.min(W, x0 + s));
      const buf = new Uint8Array(W * H + 2 * uv);
      buf.set(y, 0);
      buf.fill(128, W * H);
      return new VideoFrame(buf, { format: 'I420', codedWidth: W, codedHeight: H, timestamp: ts, duration: Math.round(1e6 / fps),
        colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: true } });
    }, 1000000) : null;
    const Wm = MV.use('export/webm');
    let buf = new Uint8Array(0);
    const write = async (b, pos) => {
      const at = pos === undefined ? buf.length : pos;
      if (at + b.length > buf.length) { const nb = new Uint8Array(at + b.length); nb.set(buf); buf = nb; }
      buf.set(b, at);
    };
    const wr = Wm.createWebm({ write, w: W, h: H, fps, video: { codec: 'V_VP9', alpha: !!alpha } });
    for (let i = 0; i < frames; i++) await wr.video(colour[i].d, mask ? mask[i].d : null, colour[i].key && (!mask || mask[i].key), colour[i].ts);
    await wr.finish();
    return { bytes: buf, times };
  }

  function percentile(list, p) {
    const s = list.slice().sort((x, y) => x - y);
    return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
  }

  // Frame times of a document at 720p (export quality), measured as the whole iteration a player or an exporter runs:
  // `await engine.mediaReady(t)` (the store's main-thread work for that frame: decoder output, the alpha merge, the
  // blur bakes; decoding itself runs ahead through want(t + 3 / fps)) + renderFrame + a 1-pixel read (so the canvas
  // work is inside the measurement). The split into ready and render is reported, and so are the store's own
  // decodeMs / prepMs per frame (stats(), with the injected clock). Warm-up as lab.js perf() does it: a first frame,
  // prepare() around the playhead, then 5 frames. o = { doc, start, seconds, fps, short, prefer, video, still, flush, trace }
  //   drawMedia (engine/render/shapes.drawMedia wrapped): every call's time, split by medium (video: a record with a
  //   time; still), unflushed (as before: the gate of §11.8.3 until the lead decides). With o.flush a separate pass over
  //   the same frames reads 1 px of the call's target before the call (untimed) and after it (timed), so raster work
  //   the canvas defers is charged to the call, and counts the draws of each call (drawImage onto any 2D context while
  //   the call runs: the picture, its mirrored neighbours, a soft copy, an isolated surface's composite).
  //   video (an id): whether each frame of it came with its blur baked (MediaFrame.blur > 0), the effective depth of the
  //   ground that shows it (the plan's decision) and its blur in device px (mediaAt).
  async function timeFrames(o) {
    const q = Object.assign({ fps: 30, short: 720 }, o);
    const root = STORE.createMediaStore({ blobs: a.io.mediaBlobs, entries: (id) => entries.get(id) || null, now: () => performance.now() });
    const store = q.prefer === 'software' ? root.fork() : root;
    const seen = { baked: 0, unbaked: 0, blur: [] };
    const spy = Object.assign({}, store, {
      frame(id, m, want) {
        const f = store.frame(id, m, want);
        if (q.video && id === q.video && f && want && want.blur > 0) { if (f.blur > 0) seen.baked++; else seen.unbaked++; }
        return f;
      },
    });
    const e = newEngine(spy);
    e.setDoc(q.doc);
    const plan = e.plan;
    const k = q.short / Math.min(plan.design.w, plan.design.h);
    const w = Math.round(plan.design.w * k), h = Math.round(plan.design.h * k);
    const surf = surfaceOf(w, h, false);
    const ropts = { quality: 'export', pick: true, scale: w / plan.design.w };
    const rq = { fps: q.fps, scale: ropts.scale };
    const draw = SH.drawMedia;
    let calls = { video: [], still: [] }, inFrame = 0;
    const timed = function (g, rec) {
      const t0 = performance.now();
      const r = draw.apply(this, arguments);
      const ms = performance.now() - t0;
      calls[rec.time ? 'video' : 'still'].push(ms); inFrame += ms;
      return r;
    };
    const frames = [], ready = [], render = [], media = [], perFrame = [], decode = [], prep = [], fallback = [];
    const stages = { behave: 0, draw: 0, post: 0 };
    const n = Math.round(q.seconds * q.fps);
    let flushed = null, depth = null, bakedBytes = 0, decoder = null;
    try {
      SH.drawMedia = timed;
      await e.mediaReady(q.start, rq);
      e.renderFrame(surf, q.start, ropts);
      await e.prepare(q.start, q.start + q.seconds, { export: false });
      for (let i = 0; i < 5; i++) {
        await e.mediaReady(q.start + i / q.fps, rq);
        e.renderFrame(surf, q.start + i / q.fps, ropts);
        surf.ctx.getImageData(0, 0, 1, 1);
      }
      calls = { video: [], still: [] };
      seen.baked = 0; seen.unbaked = 0;
      const sStart = store.stats();
      for (let i = 0; i < n; i++) {
        const t = q.start + i / q.fps;
        const s0 = store.stats();
        inFrame = 0;
        const t0 = performance.now();
        await e.mediaReady(t, rq);
        const tR = performance.now();
        const st = e.renderFrame(surf, t, ropts);
        surf.ctx.getImageData(0, 0, 1, 1);
        const t1 = performance.now();
        const s1 = store.stats();
        frames.push(t1 - t0); ready.push(tR - t0); render.push(t1 - tR);
        perFrame.push(inFrame);
        media.push(st.media.drawn);
        fallback.push(st.media.fallback || 0);
        decode.push(s1.decodeMs - s0.decodeMs); prep.push((s1.prepMs || 0) - (s0.prepMs || 0));
        const sm = e.stats().stageMs;
        stages.behave += sm.behave / n; stages.draw += sm.draw / n; stages.post += sm.post / n;
      }
      const sEnd = store.stats();
      bakedBytes = sEnd.bakedBytes || 0;
      decoder = { fed: (sEnd.fed || 0) - (sStart.fed || 0), seeks: (sEnd.seeks || 0) - (sStart.seeks || 0) };
      if (q.video) {
        const g = plan.grounds.find((x) => x.ground && x.ground.p && x.ground.p.image === q.video);
        const item = e.mediaAt(q.start, { scale: ropts.scale }).find((x) => x.id === q.video);
        depth = { depth: g ? g.ground.p.depth : null, blurPx: item && item.blur !== undefined ? item.blur : null,
          px: item && item.px !== undefined ? item.px : null, baked: seen.baked, unbaked: seen.unbaked };
      }
      if (q.flush) flushed = await flushedPass(e, surf, ropts, rq, q, n, draw);
    } finally {
      SH.drawMedia = draw;
      e.dispose();
      if (store !== root) store.dispose();
      root.dispose();
    }
    const sum = (list) => list.reduce((x, y) => x + y, 0);
    const bucket = (list) => ({ calls: list.length, p50: percentile(list, 0.5), p95: percentile(list, 0.95) });
    const all = calls.video.concat(calls.still);
    // the slowest iterations, with their split (what the p95 is made of)
    const slowest = frames.map((ms, i) => ({ i, ms, ready: ready[i], render: render[i], prep: prep[i], decode: decode[i] }))
      .sort((x, y) => y.ms - x.ms).slice(0, 10);
    return { w, h, frames: frames.length, slowest, trace: q.trace ? { frames, ready, render, media } : null, p50: percentile(frames, 0.5), p95: percentile(frames, 0.95), max: Math.max(...frames),
      ready: { p50: percentile(ready, 0.5), p95: percentile(ready, 0.95), mean: sum(ready) / n },
      render: { p50: percentile(render, 0.5), p95: percentile(render, 0.95), mean: sum(render) / n },
      store: { decodeP50: percentile(decode, 0.5), decodeMean: sum(decode) / n, prepP50: percentile(prep, 0.5), prepMean: sum(prep) / n, bakedBytes,
        fed: decoder ? decoder.fed : 0, seeks: decoder ? decoder.seeks : 0 },
      drawMedia: Object.assign(bucket(all), { perFrameP50: percentile(perFrame, 0.5), video: bucket(calls.video), still: bucket(calls.still),
        stillPerFrame: sum(calls.still) / n }),
      flushed, depth, fallback: { max: Math.max(...fallback), sum: sum(fallback) },
      media: { min: Math.min(...media), max: Math.max(...media) }, stages };
  }

  // The flushed drawMedia pass of timeFrames (same frames, after the timed loop): each call is timed from a 1-px read of
  // its target before it (untimed) to one after it, and its drawImage calls on any 2D context are counted.
  async function flushedPass(e, surf, ropts, rq, q, n, draw) {
    const P = [typeof OffscreenCanvasRenderingContext2D !== 'undefined' ? OffscreenCanvasRenderingContext2D.prototype : null,
      typeof CanvasRenderingContext2D !== 'undefined' ? CanvasRenderingContext2D.prototype : null].filter(Boolean);
    const originals = P.map((pr) => pr.drawImage);
    let draws = 0, counting = false;
    P.forEach((pr, j) => { pr.drawImage = function () { if (counting) draws++; return originals[j].apply(this, arguments); }; });
    const calls = { video: [], still: [] }, drawsOf = { video: [], still: [] }, perFrame = [];
    let inFrame = 0;
    SH.drawMedia = function (g, rec) {
      if (g && g.getImageData) g.getImageData(0, 0, 1, 1);
      draws = 0; counting = true;
      const t0 = performance.now();
      const r = draw.apply(this, arguments);
      if (g && g.getImageData) g.getImageData(0, 0, 1, 1);
      const ms = performance.now() - t0;
      counting = false;
      const kind = rec.time ? 'video' : 'still';
      calls[kind].push(ms); drawsOf[kind].push(draws); inFrame += ms;
      return r;
    };
    try {
      for (let i = 0; i < n; i++) {
        const t = q.start + i / q.fps;
        await e.mediaReady(t, rq);
        inFrame = 0;
        e.renderFrame(surf, t, ropts);
        surf.ctx.getImageData(0, 0, 1, 1);
        perFrame.push(inFrame);
      }
    } finally {
      P.forEach((pr, j) => { pr.drawImage = originals[j]; });
      SH.drawMedia = draw;
    }
    const sum = (list) => list.reduce((x, y) => x + y, 0);
    const bucket = (k) => ({ calls: calls[k].length, p50: percentile(calls[k], 0.5), p95: percentile(calls[k], 0.95),
      perFrame: sum(calls[k]) / n, draws: { min: drawsOf[k].length ? Math.min(...drawsOf[k]) : 0, max: drawsOf[k].length ? Math.max(...drawsOf[k]) : 0,
        p50: percentile(drawsOf[k], 0.5) } });
    return { video: bucket('video'), still: bucket('still'), perFrameP50: percentile(perFrame, 0.5), trace: q.trace ? perFrame : null };
  }

  // perf.py (DESIGN_2_1 §11.8.3): project_basic with a 1080p30 video ground (VP9, clock song) and a still photoFrame, 10 s
  // at 30 fps at 720p. o = { project (the saved text of project_basic), seconds, start, rows, trace } — trace adds the
  // per-frame times (NOTES: what the p95 is made of); rows adds the other
  // §11.5.12 figures (still and video grounds alone, the isolated path, the WebM alpha merge, scrubbing, export overhead).
  const big = {};
  async function bigAssets() {
    if (!big.video) {
      const v = await bigCounter(1920, 1080, 30, 60, 60, false);
      big.video = await importBytes(v.bytes, 'perf_1080p30.webm');
      big.still = await importBytes(await patternJpeg(1600, 1200), 'perf_still.jpg', 'image/jpeg');
    }
    return big;
  }

  // project_basic (the saved text) with these work pins, the library imported here, no audio.
  function basicWith(project, pins) {
    const file = JSON.parse(project);
    const doc = clone(file.doc);
    doc.media = { list: [...entries.values()].map(clone) };
    doc.pins = Object.assign({}, doc.pins);
    for (const [path, v] of Object.entries(pins)) doc.pins[path] = { v, by: 'user' };
    doc.output = Object.assign({}, doc.output, { audio: false });
    return doc;
  }

  async function perf(o) {
    const q = Object.assign({ seconds: 10, start: 2, runs: 2 }, o || {});
    await bigAssets();
    const docWith = (pins) => basicWith(q.project, pins);
    const main = docWith(Object.assign({ 'work:ornament.count': 1 },
      partPins('ground', 'photoPan', { image: big.video.id, clock: 'song' }),
      partPins('ornament#0', 'photoFrame', { src: big.still.id, place: 'side' })));
    const runs = [];
    for (let r = 0; r < q.runs; r++) {
      runs.push(await timeFrames({ doc: main, start: q.start, seconds: q.seconds, video: big.video.id, still: big.still.id, flush: r === 0, trace: q.trace }));
    }
    const flushed = runs[0].flushed;
    runs.sort((x, y) => x.p95 - y.p95);
    // project_basic as it is (no media), in the same page and run: the baseline of the per-part split
    const baseline = await timeFrames({ doc: docWith({}), start: q.start, seconds: q.seconds, trace: q.trace });
    const out = { main: Object.assign({}, runs[0], { flushed }), others: runs.slice(1).map((x) => ({ p50: x.p50, p95: x.p95 })),
      baseline: { p50: baseline.p50, p95: baseline.p95, render: baseline.render, trace: baseline.trace }, rows: null };
    if (!q.rows) return out;
    // the other §11.5.12 rows, measured once (NOTES)
    const rows = {};
    const alone = async (pins) => timeFrames({ doc: docWith(Object.assign({ 'work:ornament.count': 0 }, pins)), start: q.start, seconds: 4, flush: true });
    rows.stillGround = await alone(partPins('ground', 'photoPan', { image: big.still.id, move: 'none', depth: 'anim', veil: 0 }));
    rows.videoGround = await alone(partPins('ground', 'photoPan', { image: big.video.id, move: 'none', depth: 'anim', veil: 0, clock: 'song' }));
    // the video ground alone at its automatic depth (back: the baked blur and the veil), for the per-part split
    const back = await timeFrames({ doc: docWith(Object.assign({ 'work:ornament.count': 0 }, partPins('ground', 'photoPan', { image: big.video.id, clock: 'song' }))),
      start: q.start, seconds: 4, flush: true, video: big.video.id });
    rows.videoBack = back;
    rows.plainGround = await alone({});
    const png = await importBytes((await G.stills()).png, 'perf_alpha.png', 'image/png');
    rows.isolated = await alone(partPins('ground', 'photoPan', { image: png.id, move: 'none', depth: 'anim', veil: 0 }));
    // the WebM alpha merge of a 1080p frame, and scrubbing to a new time (GOP 2 s, 1080p): time to the exact frame
    const av = await bigCounter(1920, 1080, 30, 20, 20, true);
    const alphaEntry = await importBytes(av.bytes, 'perf_alpha_1080p.webm');
    const st = newStore();
    const merge = [];
    for (let k = 0; k < 20; k++) {
      const t0 = performance.now();
      await st.ready([{ id: alphaEntry.id, m: k / 30 }]);
      merge.push(performance.now() - t0);
    }
    rows.alphaMergeMs = { p50: percentile(merge.slice(2), 0.5), max: Math.max(...merge.slice(2)) };
    const scrub = [];
    for (const m of [1.9, 0.95, 1.5]) {
      const s2 = newStore();
      await s2.ready([{ id: big.video.id, m: 0 }]);
      const t0 = performance.now();
      await s2.ready([{ id: big.video.id, m }]);
      scrub.push(performance.now() - t0);
      s2.dispose();
    }
    rows.scrubMs = scrub;
    st.dispose();
    // export overhead: a 1-s 1080p30 MP4 (VP9 here; H.264 where it encodes) of project_basic with and without the video
    // ground, same range
    const exportMs = async (doc) => {
      const d = Object.assign({}, doc, { output: Object.assign({}, doc.output, { format: 'mp4', short: 1080, fps: 30, range: { t0: q.start, t1: q.start + 1 } }) });
      const s3 = newStore();
      const e = newEngine(s3);
      e.setDoc(d);
      const t0 = performance.now();
      await MP4.exportVideo({ engine: e, doc: d, sink: SINK.createMemorySink({ type: 'video/mp4' }), audio: null,
        codecs: (await G.h264()) ? null : { video: 'vp09.00.40.08' } });
      const ms = performance.now() - t0;
      e.dispose();
      s3.dispose();
      return ms;
    };
    const plain = docWith({ 'work:ornament.count': 0 });
    const withVideo = docWith(Object.assign({ 'work:ornament.count': 0 }, partPins('ground', 'photoPan', { image: big.video.id, clock: 'song' })));
    rows.exportMs = { plain: await exportMs(plain), video: await exportMs(withVideo) };
    rows.exportMs.plain2 = await exportMs(plain);
    rows.exportMs.video2 = await exportMs(withVideo);
    out.rows = rows;
    return out;
  }

  // playback (media_exact.py; DESIGN_2_1 §11.4.5–§11.4.6): the preview playing in real time, as the stage does it. At
  // every 30-fps tick of the wall clock (a late tick skips frames, as a player does): want(mediaAt(t) and mediaAt(t +
  // k / 30), k = 1…ahead) with no await, then renderFrame in preview quality at 720p and a 1-px read. The document is
  // project_basic with the 1080p30 video ground (the 2-s clip loops) at its automatic depth (back: blurred), on the root
  // store (the preview's). Per frame: the source frame the store handed out for the ground (MediaFrame.index), exact
  // and baked or not, against the frame its time asks for. o = { project, seconds, ahead, start, skip } → { frames,
  // right (the frame asked for), rightBaked (that frame, exact, with its baked blur), provisional, fallback (frames the
  // engine blurred itself), lag { max, p95 } (source frames behind, after the first `skip` frames: the cold start),
  // bakes, seeks, fed, loops, renderP50, bad (the first wrong frames: [tick, want, got, exact, blur]) }
  async function playback(o) {
    const q = Object.assign({ seconds: 6, ahead: 8, start: 2, skip: 30 }, o || {});
    const { video } = await bigAssets();
    const id = video.id;
    const doc = basicWith(q.project, Object.assign({ 'work:ornament.count': 0 }, partPins('ground', 'photoPan', { image: id, clock: 'song' })));
    const root = STORE.createMediaStore({ blobs: a.io.mediaBlobs, entries: (x) => entries.get(x) || null, now: () => performance.now() });
    let got = null;
    const spy = Object.assign({}, root, {
      frame(fid, m, want) {
        const f = root.frame(fid, m, want);
        if (fid === id && got && want && want.blur > 0) got.push(f ? { index: f.index, exact: f.exact, blur: f.blur } : null);
        return f;
      },
    });
    const e = newEngine(spy);
    const rows = [], render = [];
    try {
      e.setDoc(doc);
      const plan = e.plan;
      const k = 720 / Math.min(plan.design.w, plan.design.h);
      const w = Math.round(plan.design.w * k), h = Math.round(plan.design.h * k);
      const surf = surfaceOf(w, h, false);
      const scale = w / plan.design.w;
      const ropts = { quality: 'preview', scale };
      e.renderFrame(surf, q.start, ropts);
      await e.prepare(q.start, q.start + q.seconds, { export: false });
      const n = Math.round(q.seconds * 30), fps = video.fps || 30;
      const s0 = root.stats();
      const T0 = performance.now() + 20;
      let last = -1;
      for (;;) {
        const due = T0 + ((last + 1) * 1000) / 30, now = performance.now();
        if (now < due) { await new Promise((r) => setTimeout(r, due - now)); continue; }
        const tick = Math.floor(((now - T0) * 30) / 1000);
        if (tick >= n) break;
        last = tick;
        const t = q.start + tick / 30;
        const list = e.mediaAt(t, { scale });
        const all = list.slice();
        for (let j = 1; j <= q.ahead; j++) all.push(...e.mediaAt(t + j / 30, { scale }));
        root.want(all);
        got = [];
        const r0 = performance.now();
        const st = e.renderFrame(surf, t, ropts);
        surf.ctx.getImageData(0, 0, 1, 1);
        render.push(performance.now() - r0);
        const item = list.find((x) => x.id === id);
        const want = item ? Math.floor(item.m * fps + 1e-4) % video.frames : -1;
        const f = got.find((x) => x) || null;
        rows.push({ tick, want, index: f ? f.index : -1, exact: !!(f && f.exact), blur: f ? f.blur : 0, fallback: st.media.fallback || 0,
          provisional: st.provisional });
        got = null;
      }
      const s1 = root.stats();
      const after = rows.filter((r) => r.tick >= q.skip);
      const lag = after.map((r) => ((r.want - r.index) % video.frames + video.frames) % video.frames);
      return { frames: rows.length, of: n, after: after.length,
        right: after.filter((r) => r.index === r.want).length,
        rightBaked: after.filter((r) => r.index === r.want && r.exact && r.blur > 0).length,
        provisional: after.filter((r) => r.provisional).length,
        fallback: after.filter((r) => r.fallback > 0).length,
        lag: { max: lag.length ? Math.max(...lag) : 0, p95: percentile(lag, 0.95) },
        bakes: (s1.routes.yuv + s1.routes.canvas) - (s0.routes.yuv + s0.routes.canvas),
        seeks: s1.seeks - s0.seeks, fed: s1.fed - s0.fed,
        loops: Math.floor((q.start + q.seconds) / video.dur) - Math.floor(q.start / video.dur),
        renderP50: percentile(render, 0.5),
        bad: rows.filter((r) => r.index !== r.want || !r.exact).slice(0, 12).map((r) => [r.tick, r.want, r.index, r.exact ? 1 : 0, r.blur]) };
    } finally {
      e.dispose();
      root.dispose();
    }
  }

  // bakeLook (media_exact.py; DESIGN_2_1 §11.4.6): the look of the baked blur against the per-frame blur it replaces. A
  // 1080p30 counter (the media_gen.js pattern scaled up: hard black and white edges, the worst case for a resampled blur)
  // as the work background at its automatic depth (back: blurred and veiled), exported at each short side, twice: once
  // as the store bakes it (the plain path), once from a store that hands the frames out unbaked (want.blur dropped for the
  // video, so the engine blurs each output frame itself: the isolated path of before). → per size: MAE and the largest
  // difference (0–255, per channel), the share of pixels off by more than 16, inside a 16-px border and inside the colour
  // bars (flat: the colour conversion alone), the fallbacks of each run, the variant
  // sizes baked; with o.crop ({ x, y, w, h } in output px) also PNG data URLs of that crop of the first time, baked and
  // unbaked (for looking at them). o = { times, shorts, crop }
  async function bakeLook(o) {
    const q = Object.assign({ times: [0.4, 0.75], shorts: [720, 1080] }, o || {});
    if (!big.look) {
      const v = await bigCounter(1920, 1080, 30, 30, 30, false, true);
      big.look = await importBytes(v.bytes, 'look_1080p30.webm');
    }
    const id = big.look.id;
    const doc = docOf('[00:00.50]あいうえお\n[00:04.00]かきくけこ', partPins('ground', 'photoPan', { image: id, clock: 'song', move: 'none' }),
      { format: 'png', short: 720, fps: 30 });
    const out = {};
    for (const short of q.shorts) {
      const run = async (unbaked) => {
        const root = newStore();
        const store = root.fork();
        const spy = unbaked ? Object.assign({}, store, {
          frame(fid, m, want) { return store.frame(fid, m, fid === id && want ? Object.assign({}, want, { blur: 0 }) : want); },
          ready(list, ro) { return store.ready((list || []).map((x) => (x.id === id ? { id: x.id, m: x.m } : x)), ro); },
        }) : store;
        const e = newEngine(spy);
        e.setDoc(doc);
        const plan = e.plan;
        const k = short / Math.min(plan.design.w, plan.design.h);
        const w = Math.round(plan.design.w * k), h = Math.round(plan.design.h * k);
        const surf = surfaceOf(w, h, false);
        const scale = w / plan.design.w;
        const imgs = [], fallback = [];
        let png = null;
        try {
          for (const t of q.times) {
            await e.mediaReady(t, { scale });
            const st = e.renderFrame(surf, t, { quality: 'export', scale });
            fallback.push(st.media.fallback);
            imgs.push(surf.ctx.getImageData(0, 0, w, h).data);
            if (q.crop && !png) {
              const c = new OffscreenCanvas(q.crop.w, q.crop.h);
              c.getContext('2d').drawImage(surf.canvas, q.crop.x, q.crop.y, q.crop.w, q.crop.h, 0, 0, q.crop.w, q.crop.h);
              const blob = await c.convertToBlob({ type: 'image/png' });
              png = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
            }
          }
          const item = e.mediaAt(q.times[0], { scale }).find((x) => x.id === id);
          return { imgs, fallback, w, h, item, stats: store.stats(), png };
        } finally {
          e.dispose();
          store.dispose();
          root.dispose();
        }
      };
      const a = await run(false), b = await run(true);
      // everything, and the inside apart from a 16-px border (where the per-frame blur of the isolated surface faded to
      // transparency over the ground colour: the fringe the mirrored border of the baked copy removes)
      let sum = 0, max = 0, off = 0, count = 0, isum = 0, imax = 0, icount = 0;
      const B = 16;
      for (let f = 0; f < a.imgs.length; f++) {
        const x = a.imgs[f], y = b.imgs[f];
        for (let i = 0; i < x.length; i += 4) {
          const px = (i >> 2) % a.w, py = Math.floor((i >> 2) / a.w);
          const inner = px >= B && py >= B && px < a.w - B && py < a.h - B;
          for (let c = 0; c < 3; c++) {
            const d = Math.abs(x[i + c] - y[i + c]);
            sum += d; if (d > max) max = d; if (d > 16) off++; count++;
            if (inner) { isum += d; if (d > imax) imax = d; icount++; }
          }
        }
      }
      // the inside of the six colour bars (flat colour: no blur shows there, only the colour conversion: the store's own
      // YUV → RGB against the browser's)
      let bsum = 0, bmax = 0, bcount = 0;
      const kx = a.w / G.W, ky = a.h / G.H;
      for (let f = 0; f < a.imgs.length; f++) {
        const x = a.imgs[f], y = b.imgs[f];
        for (let k = 0; k < BARS.length; k++) {
          for (let py = Math.ceil(84 * ky); py < Math.floor(96 * ky); py++) {
            for (let px = Math.ceil((14 + k * 29) * kx); px < Math.floor((31 + k * 29) * kx); px++) {
              const i = 4 * (py * a.w + px);
              for (let c = 0; c < 3; c++) { const d = Math.abs(x[i + c] - y[i + c]); bsum += d; if (d > bmax) bmax = d; bcount++; }
            }
          }
        }
      }
      out[short] = { w: a.w, h: a.h, mae: sum / count, max, over16: off / count, inner: { mae: isum / icount, max: imax },
        bars: { mae: bsum / Math.max(1, bcount), max: bmax },
        fallback: { baked: a.fallback, unbaked: b.fallback },
        blurPx: a.item && a.item.blur, px: a.item && a.item.px, routes: a.stats.routes, bakedBytes: a.stats.bakedBytes, baked: a.stats.baked,
        pngs: q.crop ? [a.png, b.png] : null };
    }
    return out;
  }

  // --- transparent_check.py ----------------------------------------------------------------------------------------------

  // The PNG with alpha of media_gen.js (a 96 × 64 picture: opaque on the left, a half-transparent square at 60–90 × 20–50,
  // cleared elsewhere on the right) into the library → its entry.
  async function importPng() {
    return importBytes((await G.stills()).png, 'transparent_frame.png', 'image/png');
  }

  // The rect (output px) an element's picks cover in a frame of the app's document at t (a fork of the preview engine, as
  // the export makes: its store is a fork of the app's): { x, y, w, h }, or null.
  async function boxOf(owner, t, w) {
    const e = a.engine.fork();
    try {
      const plan = e.plan;
      const scale = w / plan.design.w, h = Math.round(plan.design.h * scale);
      await e.mediaReady(t, { scale });
      e.renderFrame(surfaceOf(w, h, true), t, { quality: 'export', pick: true, scale });
      const b = e.boxes().find((x) => x.owner === owner);
      if (!b) return null;
      const xs = [0, 2, 4, 6].map((i) => b.quad[i] * scale), ys = [1, 3, 5, 7].map((i) => b.quad[i] * scale);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    } finally {
      e.dispose();
    }
  }

  window.__mediaParts = Object.freeze({
    exact: Object.freeze({ prepare: prepareExact, run: runExact, mp4: mp4Exact, look: bakeLook, play: playback }),
    alpha: alphaChecks,
    determinism,
    perf,
    importPng,
    boxOf,
  });
})();
