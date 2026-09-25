/* 文字PVメーカー v2 — original work. Browser harness for the media parts (DESIGN_2_1 §11.8.3, package G.3; not shipped). */
// Evaluated in the built app page (index.html?fresh=1&test=1) after tests/helpers/exif_write.js and
// tests/helpers/media_gen.js, so everything runs under the app's real CSP with its real modules and device store.
// Until G.4 wires the AssetStore into ui/boot (DESIGN_2_1 §8.7), the app's own engine has no store: every engine here is
// created (or the app's engine is forked) with a real one, media/host/store over the app's device store.
// window.__mediaParts = { exact, alpha, determinism, perf, importPng, wireExport, boxOf } → plain JSON for Python:
//   media_exact.py        exact.prepare(), exact.run(job), exact.mp4(job)
//   media_alpha.py        alpha()
//   determinism.py        determinism(opts)
//   perf.py               perf(opts)
//   transparent_check.py  importPng(), wireExport(), boxOf(owner, t, w)
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

  // One PNG export of a counter video and the code of every frame. job = { clip, fps, short, t0, t1, params, kind }:
  //   kind 'ground' (default): the work background (photoPan: cover, still depth, no motion, no veil, clock song unless
  //     params say otherwise); the code is read over the whole frame;
  //   kind 'frame': a photo frame in the middle of the first lyric cut (clock show: the clip starts when the cut appears),
  //     the export range inside the cut's hold (the text-following envelope at 1); the code is read in the frame's rect.
  // → { codes, t0, fps, n, w, h, cutA (absolute time the cut appears, kind 'frame') }
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
    const engine = newEngine(store);
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
      return { codes, t0, fps: job.fps, n: frames.length, w, h, cutA, ms: Math.round(ms) };
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

  // A store whose frame() calls are seen (the test hook): the last MediaFrame index handed out per asset.
  function watched(store) {
    const seen = new Map();
    const spy = Object.assign({}, store, {
      frame(id, m, want) { const f = store.frame(id, m, want); seen.set(id, f ? { index: f.index, exact: f.exact } : null); return f; },
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
          out.push({ hash: hashOf(img), img, media: st.media.drawn, index: Object.fromEntries(seen) });
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
    const res = { t0, n, w, h, media: seq.map((x) => x.media), distinct: new Set(seq.map((x) => x.hash)).size, alone: [], rate: null, preview: [] };
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
  // two-encoder path of media_gen.js (the alpha stream's square at 128).
  async function bigCounter(W, H, fps, frames, keyEvery, alpha) {
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

  // Frame times of a document at 720p (export quality, each frame awaited with mediaReady first, which is not timed; each
  // frame followed by a 1-pixel read), with drawMedia timed on its own (engine/render/shapes.drawMedia wrapped).
  async function timeFrames(doc, start, seconds, fps, short, prefer) {
    const root = newStore();
    const store = prefer === 'software' ? root.fork() : root;
    const e = newEngine(store);
    e.setDoc(doc);
    const plan = e.plan;
    const k = short / Math.min(plan.design.w, plan.design.h);
    const w = Math.round(plan.design.w * k), h = Math.round(plan.design.h * k);
    const surf = surfaceOf(w, h, false);
    const ropts = { quality: 'export', pick: true, scale: w / plan.design.w };
    const draw = SH.drawMedia;
    let calls = [], inFrame = 0;
    SH.drawMedia = function () {
      const t0 = performance.now();
      const r = draw.apply(this, arguments);
      const ms = performance.now() - t0;
      calls.push(ms); inFrame += ms;
      return r;
    };
    const frames = [], media = [], perFrame = [], stages = { behave: 0, draw: 0, post: 0 };
    try {
      for (let i = 0; i < 5; i++) { await e.mediaReady(start + i / fps, { fps, scale: ropts.scale }); e.renderFrame(surf, start + i / fps, ropts); }
      calls = [];
      const n = Math.round(seconds * fps);
      for (let i = 0; i < n; i++) {
        const t = start + i / fps;
        await e.mediaReady(t, { fps, scale: ropts.scale });
        inFrame = 0;
        const t0 = performance.now();
        const st = e.renderFrame(surf, t, ropts);
        surf.ctx.getImageData(0, 0, 1, 1);
        frames.push(performance.now() - t0);
        perFrame.push(inFrame);
        media.push(st.media.drawn);
        const sm = e.stats().stageMs;
        stages.behave += sm.behave / n; stages.draw += sm.draw / n; stages.post += sm.post / n;
      }
    } finally {
      SH.drawMedia = draw;
      e.dispose();
      if (store !== root) store.dispose();
      root.dispose();
    }
    return { w, h, frames: frames.length, p50: percentile(frames, 0.5), p95: percentile(frames, 0.95), max: Math.max(...frames),
      drawMedia: { calls: calls.length, p50: percentile(calls, 0.5), p95: percentile(calls, 0.95), perFrameP50: percentile(perFrame, 0.5) },
      media: { min: Math.min(...media), max: Math.max(...media) }, stages };
  }

  // perf.py (DESIGN_2_1 §11.8.3): project_basic with a 1080p30 video ground (VP9, clock song) and a still photoFrame, 10 s
  // at 30 fps at 720p. o = { project (the saved text of project_basic), seconds, start, rows } — rows adds the other
  // §11.5.12 figures (still and video grounds alone, the isolated path, the WebM alpha merge, scrubbing, export overhead).
  const big = {};
  async function perf(o) {
    const q = Object.assign({ seconds: 10, start: 2, runs: 2 }, o || {});
    if (!big.video) {
      const v = await bigCounter(1920, 1080, 30, 60, 60, false);
      big.video = await importBytes(v.bytes, 'perf_1080p30.webm');
      big.still = await importBytes(await patternJpeg(1600, 1200), 'perf_still.jpg', 'image/jpeg');
    }
    const file = JSON.parse(q.project);
    const docWith = (pins) => {
      const doc = clone(file.doc);
      doc.media = { list: [...entries.values()].map(clone) };
      doc.pins = Object.assign({}, doc.pins);
      for (const [path, v] of Object.entries(pins)) doc.pins[path] = { v, by: 'user' };
      doc.output = Object.assign({}, doc.output, { audio: false });
      return doc;
    };
    const main = docWith(Object.assign({ 'work:ornament.count': 1 },
      partPins('ground', 'photoPan', { image: big.video.id, clock: 'song' }),
      partPins('ornament#0', 'photoFrame', { src: big.still.id, place: 'side' })));
    const runs = [];
    for (let r = 0; r < q.runs; r++) runs.push(await timeFrames(main, q.start, q.seconds, 30, 720));
    runs.sort((x, y) => x.p95 - y.p95);
    const out = { main: runs[0], others: runs.slice(1).map((x) => x.p95), rows: null };
    if (!q.rows) return out;
    // the other §11.5.12 rows, measured once (NOTES)
    const rows = {};
    const alone = async (pins) => timeFrames(docWith(Object.assign({ 'work:ornament.count': 0 }, pins)), q.start, 4, 30, 720);
    rows.stillGround = await alone(partPins('ground', 'photoPan', { image: big.still.id, move: 'none', depth: 'anim', veil: 0 }));
    rows.videoGround = await alone(partPins('ground', 'photoPan', { image: big.video.id, move: 'none', depth: 'anim', veil: 0, clock: 'song' }));
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

  // --- transparent_check.py ----------------------------------------------------------------------------------------------

  // The PNG with alpha of media_gen.js (a 96 × 64 picture: opaque on the left, a half-transparent square at 60–90 × 20–50,
  // cleared elsewhere on the right) into the library → its entry.
  async function importPng() {
    return importBytes((await G.stills()).png, 'transparent_frame.png', 'image/png');
  }

  // The app's export forks the preview engine (ui/boot exportStart: app.engine.fork()), which has no AssetStore until G.4:
  // give its forks a real one (a software fork of the device store), as ui/boot will.
  let wired = null;
  function wireExport() {
    if (wired) return true;
    const root = newStore();
    wired = root.fork();
    const fork = a.engine.fork.bind(a.engine);
    a.engine.fork = (opts) => fork(Object.assign({ assets: wired }, opts || {}));
    return true;
  }

  // The rect (output px) an element's picks cover in a frame of the app's document at t (the preview engine's fork with a
  // real store): { x, y, w, h }, or null.
  async function boxOf(owner, t, w) {
    wireExport();
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
    exact: Object.freeze({ prepare: prepareExact, run: runExact, mp4: mp4Exact }),
    alpha: alphaChecks,
    determinism,
    perf,
    importPng,
    wireExport,
    boxOf,
  });
})();
