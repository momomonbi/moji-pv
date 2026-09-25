/* 文字PVメーカー v2 — original work. The renderer: one frame of a Plan — evaluate, draw the layers per world, seams, post, picks (DESIGN §4.19.2–4, §7.4). */
MV.def('engine/render/renderer', ['core/hash', 'core/color', 'core/num', 'engine/scene/table', 'engine/scene/frame',
  'engine/render/surface', 'engine/render/sprites', 'engine/render/shapes', 'engine/render/draw', 'engine/render/post',
  'engine/render/seam', 'engine/render/pick'],
(H, C, N, T, F, SF, SP, SH, DR, PO, SE, PK) => {
  'use strict';

  const L = T.LAYER_INDEX;
  const WORLD_LAYERS = Object.freeze([L.ground, L.far, L.mid, L.text, L.near]);
  const BASE_LAYERS = Object.freeze([L.ground, L.far, L.mid]);
  const WARM_LAYERS = Object.freeze(WORLD_LAYERS.concat([L.hud]));
  const EMA_ALPHA = 0.1;
  const SLOW_MS = 14, FAST_MS = 9, SLOW_FRAMES = 30, FAST_FRAMES = 60, MAX_LEVEL = 4;   // adaptive preview (§7.4)
  const DPR_STEP = 0.75;
  const DPR_FLOOR = 720;           // the step applies only to outputs whose short side is above this
  const REDUCED_FLASH = 0.3;
  const STATIC_MAX = 8;
  const STATIC_BUDGET = 48 * 1024 * 1024;
  const IDENTITY = Object.freeze({ x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0 });
  const NO_FEATURES = Object.freeze({});

  // createRenderer({ canvas: CanvasFactory, registry, assets, now?, strict?, spriteBudget? }) → Renderer
  //   render(surface, plan, t, opts, source) → FrameStats   source = { cut(i), ground(i), fresh(kind, i), fontKey, face }
  //   warmAt(plan, source, t) · beginWarm() · warmBytes() · lastTime() · hitTest(x, y) · boxes() · stats() · level
  //   · setSpriteBudget(bytes) · clear() · dispose()
  // `now` (ms clock) comes from the host; without it frame times read 0 and the adaptive preview stays at level 0.
  function createRenderer(o) {
    const factory = o.canvas;
    const registry = o.registry;
    const now = typeof o.now === 'function' ? o.now : null;
    const pool = SF.createPool(factory);
    const sprites = SP.createSpriteCache(factory, { budget: o.spriteBudget });
    const paints = SH.createPaintCache(factory);
    const tiles = PO.createTileBank(factory);
    const ctl = PO.createFx({ pool, tiles });
    const scratch = SF.surfaceOf(factory, SP.MAX_SIDE, SP.MAX_SIDE, true);
    const dc = DR.createDrawContext({ sprites, paints, scratch });
    const picks = PK.createPickList();
    const statics = new Map();                     // static layers: scene → [raster per layer] (LRU)
    const errors = [];
    const q = { draft: false, scale: 1, pal: null,                       // the paints' helpers (§4.17.3)
      rgba: (ink, a) => C.rgba(DR.inkOf(q.pal, ink), a), tile: (name, seed) => tiles.tile(name, seed) };
    dc.q = q;

    let fg = null;
    let fontKey = null;
    const adapt = { level: 0, ema: 0, slow: 0, fast: 0 };
    // The latest frame's time, device scale, backdrop, glyph path and probe (sprite warm-up draws what it would draw).
    const lastLook = { t: NaN, scale: 0, backdrop: 'scene', glyphPath: 'auto', probe: null };
    const last = { ms: 0, behave: 0, draw: 0, post: 0, passes: 0 };
    const palettes = new WeakMap();                // palette → { black, ids }
    let palSeq = 0;
    const palIds = new WeakMap();

    // Pooled per-frame lists (no allocation per frame once warm).
    const items = [];                              // { scene, tl, cut, ground, cam, side }
    let nItems = 0;
    const entries = [];                            // post entries (pooled objects)
    const postList = [];
    const axPool = { f: {}, look: { amounts: {}, mood: null, bpm: null } };
    const frameInfo = { plan: null, w: 0, h: 0, unit: 1, quality: 'preview', alpha: false, textAt: null, flashScale: 1, pal: null,
      backdrop: 'scene' };
    const cams = [];
    const used = [];
    const seamCam = { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0 };   // the grounds' camera in a text seam

    function clock() { return now ? now() : 0; }

    // The key of cached paint and static-layer rasters: output scale, palette and draft mode (recomputed on change only).
    const paintKeyState = { scale: NaN, pal: 0, draft: false, key: 0 };
    function paintKeyOf(scale, pal, draft) {
      const s = paintKeyState;
      if (s.scale !== scale || s.pal !== pal || s.draft !== draft) {
        s.scale = scale; s.pal = pal; s.draft = draft; s.key = H.hash32(scale, pal, draft ? 1 : 0);
      }
      return s.key;
    }

    function paletteOf(pal, backdrop) {
      if (backdrop !== 'black') return pal;
      let v = palettes.get(pal);
      if (!v) { v = F.paletteFor(pal, 'black'); palettes.set(pal, v); }
      return v;
    }

    function palId(pal) {
      let id = palIds.get(pal);
      if (!id) { id = ++palSeq; palIds.set(pal, id); }
      return id;
    }

    function camOut(k) { return cams[k] || (cams[k] = { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0 }); }

    function item(k) { return items[k] || (items[k] = { scene: null, tl: 0, cut: -1, ground: -1, cam: IDENTITY, side: 0 }); }

    // --- gathering the active scenes -------------------------------------------------------------------------------

    function addCut(plan, source, i, t, side) {
      for (let k = 0; k < nItems; k++) if (items[k].cut === i) { if (side) items[k].side = side; return; }
      let scene = source.cut(i);
      if (!scene) return;
      if (used.includes(scene) && source.fresh) scene = source.fresh('cut', i) || scene;   // two cuts share one cached scene
      used.push(scene);
      const it = item(nItems++);
      it.scene = scene; it.cut = i; it.ground = -1; it.tl = t - plan.cuts[i].t0; it.side = side || 0;
      F.evaluate(scene, it.tl);
      it.cam = F.cameraAt(scene, plan, t, camOut(nItems - 1));
    }

    function addGround(plan, source, i, t, side) {
      const scene = source.ground(i);
      if (!scene) return;
      used.push(scene);
      const it = item(nItems++);
      it.scene = scene; it.cut = -1; it.ground = i; it.tl = t - plan.grounds[i].t0; it.side = side || 0; it.cam = IDENTITY;
      F.evaluate(scene, it.tl);
    }

    function gather(plan, source, t) {
      nItems = 0;
      used.length = 0;
      const seam = fg.seam;
      for (const c of fg.cuts) addCut(plan, source, c.i, t, 0);
      if (seam) {
        for (const i of seam.aCuts) addCut(plan, source, i, t, 1);
        for (const i of seam.bCuts) addCut(plan, source, i, t, 2);
        for (let k = 0; k < nItems; k++) if (items[k].side === 0) items[k].side = items[k].cut < seam.bCuts[0] ? 1 : 2;
      }
      const split = seam && seam.scope === 'world' && seam.aGround !== seam.bGround;   // one shared ground: both worlds
      for (const e of fg.grounds) addGround(plan, source, e.i, t, split ? (e.i === seam.aGround ? 1 : e.i === seam.bGround ? 2 : 0) : 0);
      // grounds follow the camera of the current cut; during a world seam, of their side's own cut (A or B); during a
      // text seam, a blend that moves from A's camera to B's over the window (switching at u = 0.5 made the ground jump
      // by the difference of two moving cameras in one frame)
      const cur = F.currentCut(plan, t, fg);
      const blend = seam && seam.scope !== 'world' ? textSeamCam(seam) : null;
      for (let k = 0; k < nItems; k++) {
        const it = items[k];
        if (it.ground < 0) continue;
        if (blend && !it.side) { it.cam = blend; continue; }
        const want = it.side === 1 && seam ? lastOf(seam.aCuts) : it.side === 2 && seam ? seam.bCuts[0] : cur;
        it.cam = camOfCut(want);
      }
    }

    function camOfCut(i) {
      for (let j = 0; j < nItems; j++) if (items[j].ground < 0 && items[j].cut === i) return items[j].cam;
      return IDENTITY;
    }

    // A's camera (the last cut before the seam) eased into B's (the first after it): smoothstep in u, so the ground
    // leaves A's motion and joins B's without a jump or a kink. Null when either cut is not on screen.
    function textSeamCam(seam) {
      const a = lastOf(seam.aCuts), b = seam.bCuts.length ? seam.bCuts[0] : -1;
      if (a < 0 || b < 0) return null;
      const A = camOfCut(a), B = camOfCut(b), w = N.smooth(seam.u), v = 1 - w, c = seamCam;
      c.x = A.x * v + B.x * w; c.y = A.y * v + B.y * w; c.roll = A.roll * v + B.roll * w;
      c.zoom = A.zoom * v + B.zoom * w; c.shakeX = A.shakeX * v + B.shakeX * w; c.shakeY = A.shakeY * v + B.shakeY * w;
      return c;
    }

    function lastOf(list) { return list.length ? list[list.length - 1] : -1; }

    // An item is on `side` when it belongs to that side or to both (side 0); side 0 asks for every item.
    function onSide(it, side) { return !side || !it.side || it.side === side; }

    // --- layers -------------------------------------------------------------------------------------------------------

    const VIEW = new Float32Array(6);

    function view(cam, Lk) {
      return F.viewMatrix(VIEW, cam, T.LAYERS[Lk].parallax, dc.W, dc.H);
    }

    // The raster of a static layer (cache: 'static'): drawn once per (scene, layer, scale, palette) without the camera,
    // then placed with the view like a paint (§4.19.6).
    function staticRaster(scene, Lk, it) {
      const key = scene;
      let byL = statics.get(key);
      const stamp = dc.paintKey;
      if (byL && byL[Lk] && byL[Lk].stamp === stamp) { statics.delete(key); statics.set(key, byL); return byL[Lk]; }
      const pad = 0.15;
      const s = dc.scale;
      const padX = Math.ceil(pad * dc.W * s), padY = Math.ceil(pad * dc.H * s);
      const w = Math.ceil(dc.W * s) + 2 * padX, h = Math.ceil(dc.H * s) + 2 * padY;
      if (w * h * 4 > STATIC_BUDGET / 2 || w > 8192 || h > 8192) return null;
      while (statics.size >= STATIC_MAX) statics.delete(statics.keys().next().value);
      const made = factory.create(w, h, { alpha: true });
      const g0 = dc.g, D0 = Float32Array.from(dc.D), pick = dc.pick;
      dc.g = made.ctx; dc.pick = null;
      dc.D[0] = s; dc.D[1] = 0; dc.D[2] = 0; dc.D[3] = s; dc.D[4] = padX; dc.D[5] = padY;
      F.viewMatrix(VIEW, IDENTITY, 1, dc.W, dc.H);
      DR.drawLayer(dc, scene, Lk, VIEW, it.tl, it.cut);
      dc.g = g0; dc.D.set(D0); dc.pick = pick;
      const r = { stamp, canvas: made.canvas, x: -padX / s, y: -padY / s, w: w / s, h: h / s };
      if (!byL) byL = [];
      byL[Lk] = r;
      statics.set(key, byL);
      return r;
    }

    function drawIsolated(g, it, Lk, spec) {
      if (spec.cache === 'static' && !spec.mask && !spec.filter) {
        const r = staticRaster(it.scene, Lk, it);
        if (r) {
          const V = view(it.cam, Lk);
          g.save();
          const D = dc.D;
          g.setTransform(D[0], D[1], D[2], D[3], D[4], D[5]);
          g.transform(V[0], V[1], V[2], V[3], V[4], V[5]);
          g.globalAlpha = spec.opacity;
          g.globalCompositeOperation = spec.blend;
          g.drawImage(r.canvas, r.x, r.y, r.w, r.h);
          g.restore();
          return;
        }
      }
      const S = pool.take();
      dc.g = S.ctx;
      DR.drawLayer(dc, it.scene, Lk, view(it.cam, Lk), it.tl, pickCut(it));
      if (spec.mask) {
        const M = pool.take();
        const pick = dc.pick;
        dc.g = M.ctx; dc.pick = null;
        const mL = L[spec.mask.layer];
        DR.drawLayer(dc, it.scene, mL, view(it.cam, mL), it.tl, it.cut);
        dc.pick = pick;
        S.ctx.setTransform(1, 0, 0, 1, 0, 0);
        S.ctx.globalCompositeOperation = spec.mask.invert ? 'destination-out' : 'destination-in';
        S.ctx.drawImage(M.canvas, 0, 0);
        S.ctx.globalCompositeOperation = 'source-over';
        pool.give(M);
      }
      let src = S;
      if (spec.filter && spec.filter.blur > 0) { src = PO.blurred(pool, S, spec.filter.blur * dc.scale, ctl.caps); pool.give(S); }
      dc.g = g;
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = spec.opacity;
      g.globalCompositeOperation = spec.blend;
      g.drawImage(src.canvas, 0, 0);
      g.restore();
      pool.give(src);
    }

    function drawItemLayer(g, it, Lk) {
      if (!DR.hasLayer(it.scene, Lk)) return;
      const spec = it.scene.layers[Lk];
      if (spec && T.isIsolated(spec)) { drawIsolated(g, it, Lk, spec); return; }
      dc.g = g;
      DR.drawLayer(dc, it.scene, Lk, view(it.cam, Lk), it.tl, pickCut(it));
    }

    // Picks of ground scenes belong to the current cut (the one the camera follows).
    let currentCut = -1;
    function pickCut(it) { return it.cut >= 0 ? it.cut : currentCut; }

    // Every item on `side` (0 = all) for one layer: grounds first, then cuts in `a` order.
    function drawSideLayer(g, Lk, side, groundsToo, cutsToo) {
      if (Lk === L.ground && !dc.groundOn) return;
      for (let pass = 0; pass < 2; pass++) {
        if (pass === 0 ? !groundsToo : !cutsToo) continue;
        for (let k = 0; k < nItems; k++) {
          const it = items[k];
          if ((it.ground >= 0) === (pass === 0) && onSide(it, side)) drawItemLayer(g, it, Lk);
        }
      }
    }

    // The target is reset first (the caller's surface keeps whatever state the last frame left on it).
    function fillBackdrop(g, w, h, backdrop, pal) {
      SF.resetState(g);
      const fill = F.backdropFill(backdrop);
      if (backdrop === 'clear') { g.clearRect(0, 0, w, h); return; }
      g.fillStyle = fill || pal.ground;
      g.fillRect(0, 0, w, h);
    }

    // A complete world (all layers, hud last) of one side into g.
    function drawWorld(g, w, h, side, backdrop) {
      fillBackdrop(g, w, h, backdrop, dc.pal);
      for (const Lk of WORLD_LAYERS) drawSideLayer(g, Lk, side, true, true);
      drawSideLayer(g, L.hud, side, true, true);
    }

    // No seam, or a text seam: the ground and the far layers once; A's and B's text/near layers mixed by the seam part.
    function drawTextSeam(g, w, h, backdrop, part, u) {
      fillBackdrop(g, w, h, backdrop, dc.pal);
      for (const Lk of BASE_LAYERS) drawSideLayer(g, Lk, 0, true, true);
      drawSideLayer(g, L.text, 0, true, false);
      const a = pool.take(), b = pool.take();
      for (const Lk of SE.TEXT_LAYERS) { drawSideLayer(a.ctx, Lk, 1, false, true); drawSideLayer(b.ctx, Lk, 2, false, true); }
      const out = SE.mix(ctl, pool, part, a, b, u, onPartError);
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.drawImage(out.canvas, 0, 0);
      if (out !== a && out !== b) pool.give(out);
      pool.give(a); pool.give(b);
      dc.g = g;
      drawSideLayer(g, L.near, 0, true, false);
      drawSideLayer(g, L.hud, 0, true, true);
    }

    function drawWorldSeam(g, w, h, backdrop, part, u) {
      const a = pool.take(), b = pool.take();
      drawWorld(a.ctx, w, h, 1, backdrop);
      drawWorld(b.ctx, w, h, 2, backdrop);
      const out = SE.mix(ctl, pool, part, a, b, u, onPartError);
      fillBackdrop(g, w, h, backdrop, dc.pal);        // whatever the mix leaves transparent shows the backdrop
      g.drawImage(out.canvas, 0, 0);
      if (out !== a && out !== b) pool.give(out);
      pool.give(a); pool.give(b);
    }

    function onPartError(part, err) {
      if (o.strict) throw err;
      const who = part.def ? part.def.kind + '/' + part.def.key : '?';
      if (errors.length < 32) errors.push({ code: 'part-error', detail: who + ': ' + String(err && err.message) });
    }

    // --- post ----------------------------------------------------------------------------------------------------------

    function entry(k) {
      return entries[k] || (entries[k] = { def: null, p: null, seed: 0, cut: null, info: { tl: 0, dur: 0, impact: false, energy: 0.5 },
        tl: 0, times: null, order: 0, slot: '' });
    }

    function sceneOfCut(i) {
      for (let k = 0; k < nItems; k++) if (items[k].cut === i) return items[k].scene;
      return null;
    }

    function collectPost(plan, backdrop, list) {
      list.length = 0;
      let n = 0;
      const tex = fg.post.texture;
      const ax = axPool;
      ax.f = NO_FEATURES; ax.look.amounts = plan.look.amounts || {}; ax.look.bpm = plan.beats ? plan.beats.bpm : null;
      if (tex) {
        const def = registry.get('filter', tex.v);
        if (def && F.filterAllowed(def, backdrop)) {
          const e = entry(n++);
          e.def = def; e.seed = H.hash32('fx', 'texture', def.key); e.p = PO.paramsFor(registry, def, tex, e.seed, ax);
          e.cut = null; e.tl = fg.t; e.times = null; e.order = 0; e.slot = 'texture';
          list.push(e);
        }
      }
      for (const acc of fg.post.accents) {
        const cut = plan.cuts[acc.cut];
        const d = cut.slots[acc.slot];
        const def = d ? registry.get('filter', d.v) : null;
        if (!def || !F.filterAllowed(def, backdrop)) continue;
        const e = entry(n++);
        e.def = def; e.seed = H.hash32('fx', cut.key, acc.slot, def.key);
        ax.f = cut.feat || {};
        e.p = PO.paramsFor(registry, def, d, e.seed, ax);
        const info = e.info, f = cut.feat || {};
        info.tl = acc.tl; info.dur = typeof f.dur === 'number' ? f.dur : cut.t1 - cut.t0;
        info.impact = !!(cut.impact || f.impact); info.energy = typeof f.energy === 'number' ? f.energy : 0.5;
        e.cut = info; e.tl = acc.tl; e.order = 1; e.slot = acc.slot;
        const sc = sceneOfCut(acc.cut);
        e.times = sc ? sc.times : null;
        list.push(e);
      }
      return PO.sortEntries(list);
    }

    // fx.textAt(dt): the visible cuts' text and near layers again at t − dt, into a pooled surface the size the FxContext
    // has now (a filter running at half resolution gets a half-size copy drawn at half scale, like its other surfaces).
    const D_SAVED = new Float32Array(6);
    function textAt(dt) {
      const fx = ctl.fx;
      const s = pool.take(fx.w, fx.h);
      const g0 = dc.g, pick = dc.pick;
      const k = fx.unit / frameInfo.unit;
      D_SAVED.set(dc.D);
      if (k !== 1) for (let j = 0; j < 6; j++) dc.D[j] *= k;
      dc.g = s.ctx; dc.pick = null;
      for (let n = 0; n < nItems; n++) {
        const it = items[n];
        if (it.ground >= 0) continue;
        F.evaluate(it.scene, it.tl - dt);
        for (const Lk of SE.TEXT_LAYERS) DR.drawLayer(dc, it.scene, Lk, view(it.cam, Lk), it.tl - dt, -1);
      }
      dc.D.set(D_SAVED);
      dc.g = g0; dc.pick = pick;
      return s;
    }

    // --- adaptive preview (§7.4) --------------------------------------------------------------------------------------

    function adaptTo(ms) {
      adapt.ema = adapt.ema === 0 ? ms : adapt.ema + EMA_ALPHA * (ms - adapt.ema);
      const slow = adapt.ema > SLOW_MS, fast = adapt.ema < FAST_MS;
      adapt.slow = slow ? adapt.slow + 1 : 0;
      adapt.fast = fast ? adapt.fast + 1 : 0;
      if (adapt.slow >= SLOW_FRAMES && adapt.level < MAX_LEVEL) { adapt.level++; adapt.slow = 0; adapt.ema = 0; }
      if (adapt.fast >= FAST_FRAMES && adapt.level > 0) { adapt.level--; adapt.fast = 0; }
    }

    // --- one frame --------------------------------------------------------------------------------------------------

    function render(surface, plan, t, opts, source) {
      const start = clock();
      const ro = opts || {};
      const quality = ro.quality === 'export' || ro.quality === 'draft' ? ro.quality : 'preview';
      const exporting = quality === 'export';
      const backdrop = ro.backdrop || plan.look.backdrop || 'scene';
      const W = plan.design.w, Hd = plan.design.h;
      const sw = surface.w || surface.canvas.width, sh = surface.h || surface.canvas.height;
      const scale = ro.scale > 0 ? ro.scale : Math.min(sw / W, sh / Hd);
      const level = exporting ? 0 : adapt.level;
      // adaptive level 3 draws at 0.75 of the output, but not below 720p: the stage already steps its backing down to
      // 720p at that level, and a second step would only add an upscale (ui-data perf-5)
      const dpr = level >= 3 && Math.min(sw, sh) > DPR_FLOOR ? DPR_STEP : 1;
      if (source.fontKey !== fontKey) { if (fontKey !== null) sprites.clear(); fontKey = source.fontKey; }

      fg = F.frameAt(plan, t, fg);
      gather(plan, source, t);
      currentCut = F.currentCut(plan, t, fg);
      const tBehave = clock();

      // draw context for this frame
      const pal = paletteOf(plan.look.palette, backdrop);
      dc.pal = pal; dc.W = W; dc.H = Hd; dc.scale = scale * dpr; dc.assets = o.assets || null; dc.face = source.face || null;
      dc.groundOn = F.groundVisible(backdrop);
      dc.glyphPath = !exporting && (ro.glyphPath === 'sprite' || ro.glyphPath === 'direct') ? ro.glyphPath : 'auto';
      dc.probe = !exporting && ro.probe ? ro.probe : null;
      q.draft = quality === 'draft' || (!exporting && level >= 2);
      q.scale = dc.scale; q.pal = pal;
      lastLook.t = t; lastLook.scale = dc.scale; lastLook.backdrop = backdrop;
      lastLook.glyphPath = dc.glyphPath; lastLook.probe = dc.probe;
      dc.paintKey = paintKeyOf(dc.scale, palId(pal), q.draft);
      DR.resetCounts(dc);
      const ox = (sw - W * scale) / 2, oy = (sh - Hd * scale) / 2;
      dc.D[0] = scale * dpr; dc.D[1] = 0; dc.D[2] = 0; dc.D[3] = scale * dpr; dc.D[4] = ox * dpr; dc.D[5] = oy * dpr;
      const fw = dpr === 1 ? sw : Math.max(1, Math.round(sw * dpr)), fh = dpr === 1 ? sh : Math.max(1, Math.round(sh * dpr));
      pool.frame(fw, fh);
      pool.begin();
      dc.pick = ro.pick ? picks : null;
      if (ro.pick) picks.begin(plan);

      const post = collectPost(plan, backdrop, postList);
      const fi = frameInfo;
      fi.plan = plan; fi.w = fw; fi.h = fh; fi.unit = scale * dpr; fi.quality = quality; fi.alpha = backdrop === 'clear';
      fi.textAt = textAt; fi.flashScale = !exporting && ro.reduceFlash ? REDUCED_FLASH : 1; fi.pal = pal; fi.backdrop = backdrop;
      ctl.frame(fi);
      const direct = post.length === 0 && dpr === 1;
      const frame = direct ? surface : pool.take(fw, fh);
      const g = frame.ctx;
      dc.g = g;

      const seam = fg.seam;
      if (seam) {
        const part = SE.seamPart(plan, registry, seam.i);
        if (seam.scope === 'world') drawWorldSeam(g, fw, fh, backdrop, part, seam.u);
        else drawTextSeam(g, fw, fh, backdrop, part, seam.u);
      } else drawWorld(g, fw, fh, 0, backdrop);
      const tDraw = clock();

      let passes = 0;
      if (!direct) {
        let out = frame;
        if (post.length) {
          const res = PO.run(ctl, pool, frame, post, t, level, onFilterError);
          out = res.out; passes = res.passes;
        }
        // The target is prepared first (cleared, or filled with the backdrop), so whatever a filter leaves transparent
        // shows the backdrop, never what an earlier frame left on the caller's surface.
        const tg = surface.ctx;
        fillBackdrop(tg, sw, sh, backdrop, pal);
        tg.drawImage(out.canvas, 0, 0, out.w, out.h, 0, 0, sw, sh);
      } else {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
      }
      pool.end();
      const end = clock();

      let provisional = false;
      for (let k = 0; k < nItems; k++) if (items[k].scene.provisional) provisional = true;
      last.ms = end - start; last.behave = tBehave - start; last.draw = tDraw - tBehave; last.post = end - tDraw; last.passes = passes;
      if (quality === 'preview' && now) adaptTo(last.ms);
      const c = dc.counts;
      return { ms: last.ms, drawn: { glyphs: c.glyphs, shapes: c.shapes, paints: c.paints, particles: c.particles }, passes,
        provisional, level };
    }

    // warmAt(plan, source, t) → glyphs visited: makes the glyph sprites the frame at t will draw, at the output scale,
    // backdrop, adaptive level and glyph path of the latest frame, without drawing (§7.4: a frame should not rasterize).
    // The cuts are gathered and evaluated as render() does, with their cameras, and every glyph off the direct path
    // looks up exactly the keys drawGlyph asks for (draw.warmLayer). Grounds are skipped (their text, if any, takes
    // the direct path), and so are static layers (drawn once into their raster). Nothing happens before the first frame.
    function warmAt(plan, source, t) {
      if (!(lastLook.scale > 0) || !plan) return 0;
      fg = F.frameAt(plan, t, fg);
      nItems = 0;
      used.length = 0;
      for (const c of fg.cuts) addCut(plan, source, c.i, t, 0);
      if (fg.seam) {
        for (const i of fg.seam.aCuts) addCut(plan, source, i, t, 0);
        for (const i of fg.seam.bCuts) addCut(plan, source, i, t, 0);
      }
      const s = lastLook.scale;
      dc.pal = paletteOf(plan.look.palette, lastLook.backdrop);
      dc.W = plan.design.w; dc.H = plan.design.h; dc.scale = s;
      dc.glyphPath = lastLook.glyphPath; dc.probe = lastLook.probe;
      dc.D[0] = s; dc.D[1] = 0; dc.D[2] = 0; dc.D[3] = s; dc.D[4] = 0; dc.D[5] = 0;
      let n = 0;
      for (let k = 0; k < nItems; k++) {
        const it = items[k];
        for (const Lk of WARM_LAYERS) {
          if (!DR.hasLayer(it.scene, Lk)) continue;
          const spec = it.scene.layers[Lk];
          if (spec && T.isIsolated(spec) && spec.cache === 'static' && !spec.mask && !spec.filter) continue;
          n += DR.warmLayer(dc, it.scene, Lk, view(it.cam, Lk));
        }
      }
      nItems = 0;
      return n;
    }

    function onFilterError(e, err) {
      if (o.strict) throw err;
      if (errors.length < 32) errors.push({ code: 'part-error', detail: 'filter/' + e.def.key + ': ' + String(err && err.message) });
    }

    return {
      render, warmAt,
      // beginWarm() starts counting the sprite working set; warmBytes() → { used, budget }: the bytes of the distinct
      // sprites found or made since (frames drawn meanwhile count too) and the sprite budget.
      beginWarm() { sprites.beginSpan(); },
      warmBytes: () => ({ used: sprites.spanBytes, budget: sprites.budget }),
      lastTime: () => (Number.isFinite(lastLook.t) ? lastLook.t : null),
      hitTest: (x, y) => picks.hitTest(x, y),
      boxes: () => picks.boxes(),
      stats: () => ({ frameMs: last.ms, stageMs: { behave: last.behave, draw: last.draw, post: last.post },
        spriteBytes: sprites.bytes, spritesMade: sprites.made, surfaces: pool.stats().live, surfaceBytes: pool.stats().bytes, passes: last.passes,
        level: adapt.level, ema: adapt.ema }),
      errors: () => errors.slice(),
      clearErrors() { errors.length = 0; },
      get level() { return adapt.level; },
      setLevel(v) { adapt.level = Math.max(0, Math.min(MAX_LEVEL, v | 0)); adapt.slow = 0; adapt.fast = 0; },
      setSpriteBudget(bytes) { sprites.setBudget(bytes); },
      clear() { sprites.clear(); paints.clear(); statics.clear(); tiles.clear(); },
      dispose() { sprites.clear(); paints.clear(); statics.clear(); tiles.clear(); pool.drop(); items.length = 0; nItems = 0; },
    };
  }

  return { createRenderer, WORLD_LAYERS };
});
