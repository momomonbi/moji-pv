/* 文字PVメーカー v2 — original work. Recording backend: a logging Ctx2D (CanvasFactory), a recording FxContext and reference drawing (DESIGN §4.19.8; DESIGN_2_1 §11.3.7). */
MV.def('engine/render/record', ['core/hash', 'core/rng', 'core/noise', 'core/color', 'core/mat', 'core/media',
  'engine/scene/table', 'engine/scene/builder', 'engine/scene/frame'],
(H, RNG, NZ, C, MAT, MEDIA, T, B, F) => {
  'use strict';

  // --- the recording context -------------------------------------------------------------------------------------

  // The §4.19.8 Ctx2D subset. Anything else is missing on purpose: a part that calls getImageData, measureText or
  // Path2D fails loudly here (and so in the conformance test).
  const METHODS = Object.freeze(['setTransform', 'transform', 'translate', 'rotate', 'scale', 'setLineDash', 'beginPath',
    'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'ellipse', 'rect', 'closePath', 'fill', 'stroke', 'clip',
    'fillRect', 'clearRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage']);
  const PROPS = Object.freeze({ globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000000',
    strokeStyle: '#000000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', font: '10px sans-serif', textAlign: 'start',
    textBaseline: 'alphabetic', imageSmoothingEnabled: true, filter: 'none' });
  const ROUND = 1000;

  function freshStats() {
    return { saves: 0, restores: 0, depth: 0, maxDepth: 0, underflow: 0, alphaMin: 1, alphaMax: 1, alphaBad: 0, nan: 0 };
  }

  // createRecorder() → { factory: CanvasFactory, ops() → Op[], hash(from?) → hex, stats(), reset(), mark() }
  // Op = [canvasId, name, ...args]; numbers rounded to 1e-3; canvases, gradients and patterns appear by id.
  function createRecorder() {
    let ops = [];
    let st = freshStats();
    let ids = 0;

    function arg(v) {
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) { st.nan++; return String(v); }
        const r = Math.round(v * ROUND) / ROUND;
        return r === 0 ? 0 : r;
      }
      if (v && typeof v === 'object') return typeof v.id === 'string' ? v.id : ArrayBuffer.isView(v) ? 'data' : 'object';
      if (typeof v === 'function') return 'function';
      return v === undefined ? null : v;
    }

    function log(id, name, args) {
      const op = [id, name];
      for (let k = 0; k < args.length; k++) op.push(arg(args[k]));
      ops.push(op);
    }

    function makeCtx(canvas) {
      const id = canvas.id;
      const state = Object.assign({}, PROPS);
      const stack = [];
      const ctx = { canvas };
      for (const name of METHODS) ctx[name] = function () { log(id, name, arguments); };
      ctx.setLineDash = function (list) { log(id, 'setLineDash', [Array.isArray(list) ? list.map(arg).join(',') : String(list)]); };
      ctx.save = () => {
        stack.push(Object.assign({}, state));
        st.saves++; st.depth++; if (st.depth > st.maxDepth) st.maxDepth = st.depth;
        log(id, 'save', []);
      };
      ctx.restore = () => {
        if (stack.length) { Object.assign(state, stack.pop()); st.depth--; } else st.underflow++;
        st.restores++;
        log(id, 'restore', []);
      };
      ctx.createLinearGradient = function () { return gradient(id, 'createLinearGradient', arguments); };
      ctx.createRadialGradient = function () { return gradient(id, 'createRadialGradient', arguments); };
      ctx.createPattern = function (img, rep) {
        const p = { id: 'p' + ids++ };
        log(id, 'createPattern', [p, img, rep]);
        return p;
      };
      for (const prop of Object.keys(PROPS)) {
        Object.defineProperty(ctx, prop, {
          enumerable: true,
          get: () => state[prop],
          set: (v) => {
            if (prop === 'globalAlpha') {
              if (typeof v !== 'number' || !(v >= 0 && v <= 1)) st.alphaBad++;
              if (typeof v === 'number' && Number.isFinite(v)) { st.alphaMin = Math.min(st.alphaMin, v); st.alphaMax = Math.max(st.alphaMax, v); }
            }
            state[prop] = v;
            log(id, 'set:' + prop, [v]);
          },
        });
      }
      return ctx;
    }

    function gradient(canvasId, name, args) {
      const g = { id: 'g' + ids++ };
      g.addColorStop = function () { log(canvasId, g.id + '.addColorStop', arguments); };
      log(canvasId, name, [g].concat(Array.from(args)));
      return g;
    }

    const factory = Object.freeze({
      create(w, h, opts) {
        const canvas = { id: 'c' + ids++, width: w, height: h, alpha: !(opts && opts.alpha === false) };
        const ctx = makeCtx(canvas);
        canvas.getContext = () => ctx;
        return { canvas, ctx };
      },
    });

    return {
      factory,
      ops: () => ops.slice(),
      mark: () => ops.length,
      hash: (from) => H.hashJSON(from ? ops.slice(from) : ops),
      stats: () => ({ saves: st.saves, restores: st.restores, maxDepth: st.maxDepth, depth: st.depth, underflow: st.underflow,
        alphaRange: [st.alphaMin, st.alphaMax], alphaBad: st.alphaBad, nan: st.nan,
        balanced: st.depth === 0 && st.underflow === 0 && st.saves === st.restores, ops: ops.length }),
      reset() { ops = []; st = freshStats(); },
    };
  }

  function surfaceOf(factory, w, h, alpha) {
    const s = factory.create(w, h, { alpha: alpha !== false });
    return { canvas: s.canvas, ctx: s.ctx, w, h };
  }

  // --- media in recordings (DESIGN_2_1 §11.3.7) --------------------------------------------------------------------

  // A decoded media frame appears in the op log by this name, 'media:<id>@<q6(m)>#<index>': the asset, the media time
  // and the source frame the store chose. A test store names its images with it (tests/helpers/fake_media.js), so the op
  // hashes cover media timing: a frame showing another source frame hashes differently.
  function mediaTag(id, m, index) {
    const q = Math.round(m * 1e6) / 1e6;
    return 'media:' + id + '@' + (q === 0 ? 0 : q) + '#' + index;
  }

  // mediaImage(id, m, index, w, h) → a stand-in CanvasImageSource for recordings: { id: mediaTag(…), width, height }.
  function mediaImage(id, m, index, w, h) { return { id: mediaTag(id, m, index), width: w, height: h }; }

  // --- a recording FxContext (§4.18.11) for filters and seams in Node ---------------------------------------------

  class FxError extends Error {
    constructor(code, message) { super(message); this.name = 'FxError'; this.code = code; }
  }

  const CHANNEL = Object.freeze({ r: '#FF0000', g: '#00FF00', b: '#0000FF', c: '#00FFFF', m: '#FF00FF', y: '#FFFF00' });
  const TEXT_AT_MAX = 3;

  // createRecordingFx(recorder, { w, h, unit = 1, quality = 'export', alpha = false, plan = null, cut = null, seed = 0,
  //   textAt = null, allowTextAt = false }) → FxContext drawing into recorder surfaces. Additive: begin() starts a
  // frame (resets the textAt budget), outstanding() counts surfaces taken and not given back.
  function createRecordingFx(recorder, o) {
    const w = o.w, h = o.h;
    const pool = [];
    const tiles = new Map();
    const layers = new Map();
    let out = 0, textCalls = 0;
    const fx = {
      w, h, unit: o.unit || 1, quality: o.quality || 'export', alpha: !!o.alpha, cut: o.cut || null,
      take() {
        const s = pool.pop() || surfaceOf(recorder.factory, w, h, true);
        s.ctx.setTransform(1, 0, 0, 1, 0, 0);
        s.ctx.clearRect(0, 0, w, h);
        out++;
        return s;
      },
      give(s) { if (s && s.canvas) { pool.push(s); out--; } },
      isolate(src, ch) {
        if (!CHANNEL[ch]) throw new FxError('bad-channel', 'isolate needs r g b c m or y');
        const s = fx.take(), g = s.ctx;
        g.drawImage(src.canvas, 0, 0);
        g.globalCompositeOperation = 'multiply';
        g.fillStyle = CHANNEL[ch];
        g.fillRect(0, 0, w, h);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(src.canvas, 0, 0);
        g.globalCompositeOperation = 'source-over';
        return s;
      },
      blurred(src, px) {
        const s = fx.take(), g = s.ctx;
        g.filter = 'blur(' + (Math.round(Math.max(0, px) * ROUND) / ROUND) + 'px)';
        g.drawImage(src.canvas, 0, 0);
        g.filter = 'none';
        return s;
      },
      impulse: (kind, t) => (o.plan ? F.impulseAt(o.plan, kind, t) : 0),
      beat: (t) => (o.plan ? F.beatAt(o.plan, t) : null),
      level: (t) => (o.plan ? F.levelAt(o.plan, t) : 0.5),
      tick: F.tick,
      rng: (...labels) => RNG.stream(o.seed || 0, ...labels),
      noise: (x) => NZ.noise1(o.seed || 0, x),
      // A stand-in texture tile; its id names (name, seed), so op hashes change exactly when the tile would.
      tile(name, seed) {
        const key = name + ':' + seed;
        if (!tiles.has(key)) {
          const canvas = surfaceOf(recorder.factory, 256, 256, true).canvas;
          canvas.id = 'tile:' + key;
          tiles.set(key, canvas);
        }
        return tiles.get(key);
      },
      // A kept layer, as in engine/render/post: painted once per key (its ops are recorded then) on a canvas whose id
      // names the key and size, so the draws of it show which picture they lay down.
      layer(key, paint) {
        const id = 'layer:' + key + ':' + w + 'x' + h;
        if (!layers.has(id)) {
          const s = surfaceOf(recorder.factory, w, h, true);
          paint(s.ctx, w, h);
          s.canvas.id = id;
          layers.set(id, s.canvas);
        }
        return layers.get(id);
      },
      textAt(dt) {
        if (!o.allowTextAt) throw new FxError('no-text-at', "fx.textAt needs needs: ['textAt'] on the filter");
        if (++textCalls > TEXT_AT_MAX) throw new FxError('text-at-budget', 'fx.textAt may be called at most 3 times per frame');
        return o.textAt ? o.textAt(dt) : fx.take();
      },
      begin() { textCalls = 0; },
      outstanding: () => out,
    };
    return fx;
  }

  // --- reference drawing ---------------------------------------------------------------------------------------------

  const TMP = new Float32Array(6), VIEW = new Float32Array(6), BASE = new Float32Array(6), WORLD = new Float32Array(6);
  const PT = { x: 0, y: 0, size: 0, rot: 0, alpha: 0 };

  function inkOf(pal, ink) {
    if (typeof ink === 'string' && pal[ink]) return pal[ink];
    return C.isHex(ink) ? ink : pal.ink;
  }

  function setMatrix(g, M) { g.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]); }

  // drawScene(g, scene, { scale = 1, cam = null, W, H, pal, backdrop = 'scene', tl = 0, draft = false }) draws an
  // evaluated scene (frame.evaluate) through any Ctx2D: every visible node in LAYERS order with the camera view per
  // layer. It is the simple, complete reference the Node tests use; the Canvas2D renderer (sprites, reveal clips, glow,
  // post) is engine/render/renderer. Returns the number of nodes drawn.
  function drawScene(g, scene, opts) {
    const o = opts || {};
    if (!o.pal) throw new TypeError('drawScene needs opts.pal (the plan palette)');
    const table = scene.table;
    const pal = F.paletteFor(o.pal, o.backdrop || 'scene');
    const q = { draft: !!o.draft, scale: o.scale || 1, pal, rgba: (ink, a) => C.rgba(inkOf(pal, ink), a),
      tile: o.tile || (() => null) };
    let drawn = 0;
    for (let L = 0; L < T.LAYERS.length; L++) {
      if (L === T.LAYER_INDEX.ground && !F.groundVisible(o.backdrop)) continue;
      layerView(BASE, o, L);
      for (let i = 0; i < table.n; i++) {
        if (table.layer[i] !== L || T.isHidden(table, i)) continue;
        drawNode(g, scene, i, pal, q, o);
        drawn++;
      }
    }
    return drawn;
  }

  function layerView(out, o, L) {
    const s = o.scale || 1;
    MAT.ident(VIEW);
    if (o.cam) F.viewMatrix(VIEW, o.cam, T.LAYERS[L].parallax, o.W, o.H);
    MAT.ident(TMP);
    TMP[0] = s; TMP[3] = s;
    return MAT.mul(out, TMP, VIEW);
  }

  function drawNode(g, scene, i, pal, q, o) {
    const table = scene.table, type = table.type[i];
    const rec = type === T.TYPE.glyph ? scene.stores.glyph[table.payload[i]] : type === T.TYPE.shape ? scene.stores.shape[table.payload[i]]
      : type === T.TYPE.paint ? scene.stores.paint[table.payload[i]] : type === T.TYPE.particles ? scene.stores.particles[table.payload[i]]
        : type === T.TYPE.image ? scene.stores.image[table.payload[i]] : null;
    if (!rec) return;
    MAT.mul(WORLD, BASE, T.worldOf(table, i, TMP));
    const alpha = table.wa[i];
    if (type === T.TYPE.glyph) drawGlyph(g, rec, pal, alpha, table.live.tint[i]);
    else if (type === T.TYPE.shape) drawShape(g, rec, pal, alpha);
    else if (type === T.TYPE.paint) drawPaint(g, rec, alpha, q, o);
    else if (type === T.TYPE.particles) drawParticles(g, rec, pal, alpha, o.tl || 0);
    else if (type === T.TYPE.image && rec.media) drawMediaRef(g, rec, alpha, o);
    else if (type === T.TYPE.image && rec.asset) {
      setMatrix(g, WORLD);
      g.globalAlpha = alpha;
      g.drawImage(rec.asset, rec.box.x, rec.box.y, rec.box.w, rec.box.h);
    }
  }

  const WANT = { px: 0, blur: 0, exact: true, thumb: false };

  // A media record in the reference drawing (opts.assets; opts.t = the absolute time for the song clock): the fitted
  // source rect into the dest rect, upright (no edges, looks or masks: those are the renderer's). Skipped without a store.
  function drawMediaRef(g, rec, alpha, o) {
    const store = o.assets;
    if (!store || typeof store.frame !== 'function') return;
    const tm = rec.time;
    const m = tm ? MEDIA.mapTime(tm, tm.clock === 'song' ? (o.t || 0) : (o.tl || 0)) : 0;
    WANT.px = Math.max(rec.box.w, rec.box.h) * (o.scale || 1) * rec.headroom;
    const f = store.frame(rec.src, m, WANT);
    if (!f) return;
    const r = rec.rect, kx = f.w / Math.max(1, rec.meta.w), ky = f.h / Math.max(1, rec.meta.h);
    setMatrix(g, WORLD);
    g.globalAlpha = alpha;
    g.drawImage(f.image, r.sx * kx, r.sy * ky, r.sw * kx, r.sh * ky, r.dx, r.dy, r.dw, r.dh);
  }

  function drawGlyph(g, rec, pal, alpha, tint) {
    setMatrix(g, WORLD);
    if (rec.rot === 2) g.scale(-1, 1);
    if (rec.rot) g.rotate(Math.PI / 2);
    if (rec.sx !== 1) g.scale(rec.sx, 1);
    g.font = rec.font.css(rec.em);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.globalAlpha = alpha;
    g.fillStyle = inkOf(pal, rec.ink);
    g.fillText(rec.ch, 0, 0);
    if (tint > 0) {
      g.globalAlpha = alpha * tint;
      g.fillStyle = pal.accent;
      g.fillText(rec.ch, 0, 0);
    }
  }

  function drawShape(g, rec, pal, alpha) {
    setMatrix(g, WORLD);
    g.globalAlpha = alpha;
    B.replayShape(g, rec.path);
    if (rec.fill !== null) { g.fillStyle = inkOf(pal, rec.fill); g.fill(); }
    if (rec.stroke !== null) {
      g.strokeStyle = inkOf(pal, rec.stroke);
      g.lineWidth = rec.width;
      g.lineCap = rec.cap;
      g.setLineDash(rec.dash || []);
      g.stroke();
    }
  }

  function drawPaint(g, rec, alpha, q, o) {
    g.save();
    setMatrix(g, WORLD);
    g.globalAlpha = alpha;
    rec.draw(g, o.tl || 0, rec.data, q);
    g.restore();
  }

  function drawParticles(g, rec, pal, alpha, tl) {
    const d = rec.data;
    g.fillStyle = inkOf(pal, rec.ink);
    for (let j = 0; j < d.n; j++) {
      B.particleAt(d, j, tl, PT);
      const a = alpha * PT.alpha;
      if (!(a >= T.MIN_ALPHA)) continue;
      setMatrix(g, WORLD);
      g.translate(PT.x, PT.y);
      g.rotate(PT.rot);
      g.globalAlpha = a;
      if (B.isShape(rec.sprite)) { g.scale(PT.size, PT.size); B.replayShape(g, rec.sprite); g.fill(); }
      else if (typeof rec.sprite === 'string' && rec.sprite.startsWith('glyph:')) {
        g.font = Math.round(PT.size * ROUND) / ROUND + 'px sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(rec.sprite.slice(6), 0, 0);
      } else g.fillRect(-PT.size / 2, -PT.size / 2, PT.size, PT.size);
    }
  }

  return { METHODS, PROPS, createRecorder, surfaceOf, createRecordingFx, FxError, drawScene, inkOf, mediaTag, mediaImage };
});
