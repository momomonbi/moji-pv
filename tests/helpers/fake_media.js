/* 文字PVメーカー v2 — original work. A fake AssetStore (DESIGN_2_1 §11.3.6) for Node tests and the lab: synthetic stills and sample tables. */
'use strict';
// createFakeMedia(MV, opts) → an AssetStore with synthetic assets, no decoding:
//   stills   delivered at the §11.4.6 tier the request asks for (core/media.tier); a blurred copy when want.blur > 0
//   videos   and animations: a sample table (any fps, VFR, explicit pts); frame(id, m) picks the source frame by the
//            §11.4.2 rule (the largest i with pts[i] ≤ m + 1e-4, else 0) and reports it as MediaFrame.index; with
//            want.blur > 0 the frame comes baked, as the real store bakes it (§11.4.6): a copy at 1/b of the frame
//            (media/yuv.factorFor) with MediaFrame.blur = want.blur (opts.bake: false hands out unbaked frames, blur 0)
//   images   in Node, stand-ins named by engine/render/record.mediaTag ('media:<id>@<m>#<index>'), so recorder op
//            hashes show the chosen source frame; with opts.canvas (a CanvasFactory, the lab) real canvases: a coloured
//            checkerboard per asset, a bar code of the index on video frames
// opts = { assets: [entry] (default FIXTURES), missing: [id] (not on this device), exact: 'always' | 'ready',
//          canvas: CanvasFactory | null, bake: boolean (default true) }. With exact 'ready' a video frame is exact only once ready() (or want() and
//          then settle()) asked for it; until then frame() returns the last held frame of that asset, marked not exact.
// Test hooks: calls (every frame() request), settle(), forks, disposed, table(id).
// This file is also loaded into the lab page (tests/browser/contact_sheet.py wraps it like the other fixtures), so it
// needs nothing from Node.

// Synthetic assets: the four of tests/fixtures/project_media.json (same ids and metadata) and a few edge cases.
const FIXTURES = [
  { name: 'png', id: 'a1c2e3f4a5b6c7d8e9f0a1b2c', kind: 'image', w: 800, h: 800, rot: 0, alpha: true, anim: false },
  { name: 'jpeg', id: 'a2d4f6a8b0c2d4e6f8a0b2c4d', kind: 'image', w: 4032, h: 3024, rot: 0, alpha: false, anim: false },
  { name: 'mp4', id: 'a3f9c2d17b0e4a5c6d7e8f901', kind: 'video', w: 1920, h: 1080, rot: 0, alpha: false, anim: false,
    fps: 29.97, frames: 375 },
  { name: 'webm', id: 'a4b5c6d7e8f9a0b1c2d3e4f50', kind: 'video', w: 1280, h: 720, rot: 0, alpha: true, anim: false,
    fps: 30, frames: 120 },
  { name: 'rot90', id: 'a5000000000000000000000a1', kind: 'video', w: 1080, h: 1920, rot: 90, alpha: false, anim: false,
    fps: 30, frames: 90 },
  { name: 'rot180', id: 'a5000000000000000000000a2', kind: 'video', w: 1920, h: 1080, rot: 180, alpha: false, anim: false,
    fps: 30, frames: 90 },
  { name: 'rot270', id: 'a5000000000000000000000a3', kind: 'video', w: 1080, h: 1920, rot: 270, alpha: false, anim: false,
    fps: 30, frames: 90 },
  // frames 0–29 at 30 fps, then 30–44 at 15 fps (the §11.8.1 VFR variant)
  { name: 'vfr', id: 'a5000000000000000000000a4', kind: 'video', w: 640, h: 360, rot: 0, alpha: false, anim: false,
    pts: Array.from({ length: 45 }, (_, i) => (i < 30 ? i / 30 : 1 + (i - 30) / 15)) },
  { name: 'fps24', id: 'a5000000000000000000000a5', kind: 'video', w: 1280, h: 720, rot: 0, alpha: false, anim: false,
    fps: 24, frames: 240 },
  { name: 'fps60', id: 'a5000000000000000000000a6', kind: 'video', w: 1280, h: 720, rot: 0, alpha: false, anim: false,
    fps: 60, frames: 600 },
  { name: 'gif', id: 'a5000000000000000000000a7', kind: 'image', w: 320, h: 240, rot: 0, alpha: true, anim: true,
    fps: 10, frames: 10 },
];

const EPS_MEDIA = 1e-4;

function round3(x) { return Math.round(x * 1000) / 1000; }

// The presentation times of an asset's sample table (videos and animations), seconds from 0.
function ptsOf(a) {
  if (Array.isArray(a.pts)) return Float64Array.from(a.pts);
  const n = a.frames || 1, fps = a.fps || 30;
  return Float64Array.from({ length: n }, (_, i) => i / fps);
}

// The MediaMeta of an asset (the plan.media record, DESIGN_2_1 §11.2.6).
function metaOf(a) {
  const timed = a.kind === 'video' || a.anim === true;
  if (!timed) return { kind: a.kind, w: a.w, h: a.h, dur: null, fps: null, frames: null, rot: a.rot || 0, alpha: !!a.alpha, anim: false };
  const pts = ptsOf(a);
  const n = pts.length;
  const last = n > 1 ? pts[n - 1] - pts[n - 2] : 1 / (a.fps || 30);
  const dur = pts[n - 1] + last;
  const fps = a.fps || round3((n - 1) / pts[n - 1]);
  return { kind: a.kind, w: a.w, h: a.h, dur: round3(dur), fps: round3(fps), frames: n, rot: a.rot || 0, alpha: !!a.alpha,
    anim: !!a.anim };
}

// plan.media for some assets (ids or fixture names): { [id]: MediaMeta }.
function planMedia(list, assets) {
  const all = assets || FIXTURES;
  const out = {};
  for (const x of list) {
    const a = all.find((e) => e.id === x || e.name === x);
    if (!a) throw new Error('fake_media: unknown asset ' + x);
    out[a.id] = metaOf(a);
  }
  return out;
}

function fixture(nameOrId) { return FIXTURES.find((a) => a.name === nameOrId || a.id === nameOrId) || null; }

// The largest presentation index i with pts[i] ≤ m + 1e-4, else 0 (§11.4.2 step 3).
function sampleAt(pts, m) {
  let lo = 0, hi = pts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid] <= m + EPS_MEDIA) lo = mid + 1; else hi = mid; }
  return Math.max(0, lo - 1);
}

// A stable colour per asset id (the lab's checkerboards).
function colourOf(id) {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const hue = (h >>> 0) % 360;
  return 'hsl(' + hue + ', 70%, 55%)';
}

function createFakeMedia(MV, options) {
  const opts = options || {};
  const R = MV.use('engine/render/record');
  const M = MV.use('core/media');
  const YUV = MV.use('media/yuv');
  const list = opts.assets || FIXTURES;
  const byId = new Map(list.map((a) => [a.id, { a, meta: metaOf(a), pts: a.kind === 'video' || a.anim ? ptsOf(a) : null }]));
  const missing = new Set(opts.missing || []);
  const mode = opts.exact === 'ready' ? 'ready' : 'always';
  const factory = opts.canvas || null;
  const held = new Set(), pending = new Set();
  const lastShown = new Map();                 // id → the last index handed out as exact
  const frames = new Map();                    // id → pooled MediaFrame
  const canvases = new Map();                  // lab: 'id#index#blur' → canvas
  const listeners = { ready: new Set(), state: new Set() };
  const store = { calls: [], forks: [], disposed: false };

  function entryOf(id) { return !missing.has(id) && byId.has(id) ? byId.get(id) : null; }
  function keyOf(id, index) { return id + '#' + index; }
  function indexOf(e, m) { return e.pts ? sampleAt(e.pts, m) : 0; }

  // The lab's picture: a coloured checkerboard (w × h coded px), video frames with their index as a bar code.
  function canvasOf(id, index, w, h, blur) {
    const key = id + '#' + index + '#' + blur + '#' + w + 'x' + h;
    if (canvases.has(key)) return canvases.get(key);
    const made = factory.create(w, h, { alpha: true });
    const g = made.ctx, cell = Math.max(8, Math.round(Math.min(w, h) / 8));
    g.fillStyle = colourOf(id); g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let y = 0; y < h; y += cell) for (let x = ((y / cell) & 1) * cell; x < w; x += 2 * cell) g.fillRect(x, y, cell, cell);
    if (byId.get(id).pts) {
      g.fillStyle = '#000000';
      for (let b = 0; b < 12; b++) if ((index >> b) & 1) g.fillRect((b * w) / 12, h * 0.8, w / 12 - 2, h * 0.15);
    }
    if (blur > 0) { g.fillStyle = 'rgba(128,128,128,0.35)'; g.fillRect(0, 0, w, h); }
    canvases.set(key, made.canvas);
    return made.canvas;
  }

  function imageOf(id, m, index, w, h, blur) {
    if (factory) return canvasOf(id, index, w, h, blur);
    const img = R.mediaImage(id, m, index, w, h);
    if (blur > 0) img.id += '~b' + Math.round(blur);
    return img;
  }

  // frame(id, m, want) → MediaFrame | null (pooled per asset: valid until the next frame() call for the same id)
  function frame(id, m, want) {
    const w = want || {};
    store.calls.push({ id, m, px: w.px, blur: w.blur, exact: !!w.exact, thumb: !!w.thumb });
    const e = entryOf(id);
    if (store.disposed || !e) return null;
    const meta = e.meta;
    let index = indexOf(e, m), exact = true, shownM = m;
    if (w.thumb) { index = 0; shownM = 0; exact = false; }
    else if (e.pts && mode === 'ready' && !held.has(keyOf(id, index))) {
      exact = false;
      index = lastShown.has(id) ? lastShown.get(id) : 0;
      shownM = e.pts[index];
    } else if (e.pts) lastShown.set(id, index);
    // stills come at the tier the node needs, blurred as asked; videos at their size, or baked (blurred, at 1/b)
    const long = Math.max(meta.w, meta.h);
    const blur = w.blur > 0 && (!e.pts || (opts.bake !== false && !w.thumb)) ? w.blur : 0;
    const b = e.pts && blur > 0 ? YUV.factorFor(long, w.px > 0 ? w.px : long, blur) : 1;
    const tier = e.pts ? long / b : M.tier(w.px || long, meta);
    const dw = Math.max(1, Math.round((meta.w * tier) / long)), dh = Math.max(1, Math.round((meta.h * tier) / long));
    const turned = meta.rot === 90 || meta.rot === 270;
    const f = frames.get(id) || {};
    f.image = imageOf(id, shownM, index, turned ? dh : dw, turned ? dw : dh, blur);
    f.w = dw; f.h = dh; f.rot = meta.rot; f.exact = exact; f.index = index; f.blur = blur;
    frames.set(id, f);
    return f;
  }

  function mark(set, items) {
    for (const x of items || []) {
      const e = entryOf(x.id);
      if (e) set.add(keyOf(x.id, indexOf(e, x.m)));
    }
  }

  function emit(event) { for (const fn of listeners[event]) fn(); }

  Object.assign(store, {
    get(id) {
      const e = entryOf(id);
      return e && !e.pts ? imageOf(id, 0, 0, e.meta.w, e.meta.h, 0) : null;
    },
    frame,
    want(items) { if (mode === 'ready') mark(pending, items); },
    ready(items, o) {
      const bad = (items || []).find((x) => !entryOf(x.id));
      if (bad) {
        const err = new Error('media not on this device: ' + bad.id);
        err.code = 'media-missing';
        err.id = bad.id;
        return Promise.reject(err);
      }
      if (o && o.signal && o.signal.aborted) return Promise.reject(Object.assign(new Error('aborted'), { code: 'aborted' }));
      mark(held, items);
      return Promise.resolve();
    },
    settle() {
      for (const k of pending) held.add(k);
      pending.clear();
      emit('ready');
    },
    has(id) { return !!entryOf(id); },
    info(id) { return entryOf(id) ? { state: 'ok' } : { state: 'missing' }; },
    on(event, fn) {
      const set = listeners[event];
      if (!set) throw new Error('fake_media: unknown event ' + event);
      set.add(fn);
      return () => set.delete(fn);
    },
    fork() {
      const child = createFakeMedia(MV, opts);
      store.forks.push(child);
      return child;
    },
    stats() {
      let sessions = 0, pixels = 0;
      for (const [id] of frames) { const e = byId.get(id); if (e && e.pts) { sessions++; pixels += e.meta.w * e.meta.h; } }
      return { stillBytes: 0, sessions, sessionPixels: pixels, held: held.size, decodeMs: 0 };
    },
    dispose() { store.disposed = true; frames.clear(); canvases.clear(); },
    table(id) { const e = byId.get(id); return e && e.pts ? e.pts : null; },
  });
  return store;
}

// testParts(K) → four parts built on the kit's media helpers, one per `use` (ground, frame, fill, layer), written the
// way the §11.5.7 parts are described. The catalog's media parts are package G's; until they land, the Node tests and
// the lab's media mode (#media:…, parts_gallery.py) cover K.media and K.mediaParams with these (pool: false).
function testParts(K) {
  const L = (ja, en) => ({ ja, en });
  return [
    K.ground({ key: 'mediaTestGround', label: L('テスト背景', 'Test ground'), blurb: L('写真の背景', 'A photo ground'), pool: false,
      params: K.mediaParams({ src: 'image', use: 'ground' }),
      build(env, p) {
        env.sb.paint({ layer: 'ground', bleed: 0.15, animated: false, owner: env.owner, data: null,
          draw: (g, t, d, q) => { g.fillStyle = q.pal.ground; g.fillRect(-0.15 * env.D.w, -0.15 * env.D.h, 1.3 * env.D.w, 1.3 * env.D.h); } });
        K.media(env, { layer: 'ground', use: 'ground', src: p.image, p, owner: env.owner });
      } }),
    K.ornament({ key: 'mediaTestFrame', label: L('テスト枠', 'Test frame'), blurb: L('写真の枠', 'A photo frame'), pool: false,
      scope: 'cut', follow: 'text', params: K.mediaParams({ use: 'frame' }),
      build(env, p) {
        const f = env.hints.focus, s = 0.42 * env.D.short;
        const box = { x: f.x + f.w / 2 - s / 2, y: f.y + f.h / 2 - s / 2, w: s, h: s };
        K.media(env, { layer: 'mid', use: 'frame', src: p.src, p, box, mask: K.shape.rect(box.x, box.y, box.w, box.h, 24) });
      } }),
    K.ornament({ key: 'mediaTestFill', label: L('テスト文字', 'Test fill'), blurb: L('文字の中に', 'Inside the text'), pool: false,
      scope: 'cut', follow: 'text', params: K.mediaParams({ use: 'fill' }),
      build(env, p) {
        env.sb.layer('text', { isolate: true });
        K.media(env, { layer: 'text', use: 'fill', src: p.src, p, box: { x: 0, y: 0, w: env.D.w, h: env.D.h } });
      } }),
    K.ornament({ key: 'mediaTestLayer', label: L('テスト映像', 'Test layer'), blurb: L('重ねる映像', 'Overlay footage'), pool: false,
      scope: 'run', follow: 'own', params: Object.assign({ blend: { type: 'enum', of: K.MEDIA.BLENDS.slice(), label: L('重ね方', 'Blend'),
        auto: { value: 'screen' } } }, K.mediaParams({ use: 'layer' })),
      build(env, p) {
        K.media(env, { layer: 'far', use: 'layer', src: p.src, p, comp: p.blend === 'normal' ? 'over' : p.blend });
      } }),
  ];
}

// goldenDoc(doc) → the document of the media golden (tests/golden/project_media.json, DESIGN_2_1 §7.5 step (c)): the
// v2.1 media fixture (tests/fixtures/project_media.json: a video background, a pooled still background on r3, a photo
// frame on r2, a material with the MP4 on r5) plus a text fill on r5 (ornament#0, the alpha WebM), so the golden holds a
// still background, a photoFrame, a textFill and a video background. A copy; the fixture itself is not changed.
function goldenDoc(doc) {
  const webm = FIXTURES.find((a) => a.name === 'webm').id;
  const add = { 'line/r5:ornament#0': { v: 'textFill', by: 'user' }, 'line/r5:ornament#0@textFill.src': { v: webm, by: 'user' } };
  return Object.assign({}, doc, { pins: Object.assign({}, doc.pins, add) });
}

module.exports = { FIXTURES, EPS_MEDIA, metaOf, planMedia, fixture, sampleAt, createFakeMedia, testParts, goldenDoc };
