/* 文字PVメーカー v2 — original work. Non-text draw paths: shapes, paints (with the static raster cache), particles and images (DESIGN §4.19.6). */
MV.def('engine/render/shapes', ['engine/scene/table', 'engine/scene/builder', 'engine/render/sprites'], (T, B, SP) => {
  'use strict';

  const NO_DASH = Object.freeze([]);
  const PAINT_BUDGET = 48 * 1024 * 1024;   // static layer rasters, bytes (§7.3: LRU 8)
  const PAINT_MAX = 8;
  const MAX_CANVAS = 8192;                 // the largest canvas side we ask any browser for

  function setMatrix(g, M) { g.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]); }

  // Device px per du of a transform along its longer axis (a glyph flipped edge-on keeps its full height, so its raster
  // is not made smaller than what shows).
  function scaleOf(M) { return Math.max(Math.hypot(M[0], M[1]), Math.hypot(M[2], M[3])); }

  // --- shapes ----------------------------------------------------------------------------------------------------

  // drawShape(g, rec, M, alpha, fill, stroke): rec = the scene's shape record; fill/stroke = resolved colours or null.
  function drawShape(g, rec, M, alpha, fill, stroke) {
    setMatrix(g, M);
    g.globalAlpha = alpha;
    B.replayShape(g, rec.path);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) {
      g.strokeStyle = stroke;
      g.lineWidth = rec.width;
      g.lineCap = rec.cap;
      if (rec.dash && rec.dash.length) g.setLineDash(rec.dash);
      g.stroke();
      if (rec.dash && rec.dash.length) g.setLineDash(NO_DASH);
    }
  }

  // --- paints ----------------------------------------------------------------------------------------------------

  // drawPaint(g, rec, M, alpha, tl, q): the part's draw(g, t, data, q) under the node's transform, state saved around it.
  function drawPaint(g, rec, M, alpha, tl, q) {
    g.save();
    setMatrix(g, M);
    g.globalAlpha = alpha;
    rec.draw(g, tl, rec.data, q);
    g.restore();
  }

  // createPaintCache(factory) → { draw(g, rec, M, alpha, q, W, H, scale, key) → boolean, clear(), bytes }
  // A paint that is not animated is drawn once per (record, output scale, palette, draft) into a raster with the paint's
  // bleed around the frame, then only moved by the camera (§4.19.6). Returns false when the raster would not fit the
  // budget (the caller then draws the paint directly).
  function createPaintCache(factory) {
    const entries = new Map();             // rec → { key, canvas, pad, w, h, bytes }
    let bytes = 0;

    function drop(rec) {
      const e = entries.get(rec);
      if (!e) return;
      entries.delete(rec);
      bytes -= e.bytes;
    }

    function raster(rec, q, W, H, scale, key) {
      const padX = Math.ceil(rec.bleed * W * scale), padY = Math.ceil(rec.bleed * H * scale);
      const w = Math.ceil(W * scale) + 2 * padX, h = Math.ceil(H * scale) + 2 * padY;
      const size = w * h * 4;
      if (w > MAX_CANVAS || h > MAX_CANVAS || size > PAINT_BUDGET / 2) return null;
      while (entries.size >= PAINT_MAX || (entries.size && bytes + size > PAINT_BUDGET)) drop(entries.keys().next().value);
      const made = factory.create(w, h, { alpha: true });
      const g = made.ctx;
      g.setTransform(scale, 0, 0, scale, padX, padY);
      rec.draw(g, 0, rec.data, q);
      g.setTransform(1, 0, 0, 1, 0, 0);
      const e = { key, canvas: made.canvas, padX: padX / scale, padY: padY / scale, w: w / scale, h: h / scale, bytes: size };
      entries.set(rec, e);
      bytes += size;
      return e;
    }

    function draw(g, rec, M, alpha, q, W, H, scale, key) {
      let e = entries.get(rec);
      if (e && e.key !== key) { drop(rec); e = null; }
      if (e) { entries.delete(rec); entries.set(rec, e); }
      else e = raster(rec, q, W, H, scale, key);
      if (!e) return false;
      setMatrix(g, M);
      g.globalAlpha = alpha;
      g.drawImage(e.canvas, -e.padX, -e.padY, e.w, e.h);
      return true;
    }

    return {
      draw,
      clear() { entries.clear(); bytes = 0; },
      get bytes() { return bytes; },
      get size() { return entries.size; },
    };
  }

  // --- particles -------------------------------------------------------------------------------------------------

  const PT = { x: 0, y: 0, size: 0, rot: 0, alpha: 0 };

  // drawParticles(g, rec, M, alpha, tl, ink, sprites, font) → particles drawn. Positions are closed-form in tl; each
  // particle is one cached sprite (shape, glyph or square) placed with its own transform.
  function drawParticles(g, rec, M, alpha, tl, ink, sprites, font) {
    const d = rec.data;
    if (!d || d.n === 0) return 0;
    const S = scaleOf(M);
    const k = SP.bucketOf(Math.max(d.field.size[0], d.field.size[1]) * S);
    const sp = sprites.particle(rec, ink, k, font);
    const inv = 1 / sp.F;
    const x0 = -sp.cx * inv, y0 = -sp.cy * inv, w = sp.w * inv, h = sp.h * inv;
    let drawn = 0;
    for (let j = 0; j < d.n; j++) {
      B.particleAt(d, j, tl, PT);
      const a = alpha * PT.alpha;
      if (!(a >= T.MIN_ALPHA) || !(PT.size > 0)) continue;
      const c = Math.cos(PT.rot) * PT.size, s = Math.sin(PT.rot) * PT.size;
      // M · T(x, y) · R(rot) · S(size)
      g.setTransform(M[0] * c + M[2] * s, M[1] * c + M[3] * s, -M[0] * s + M[2] * c, -M[1] * s + M[3] * c,
        M[0] * PT.x + M[2] * PT.y + M[4], M[1] * PT.x + M[3] * PT.y + M[5]);
      g.globalAlpha = a > 1 ? 1 : a;
      g.drawImage(sp.canvas, x0, y0, w, h);
      drawn++;
    }
    return drawn;
  }

  // --- images ----------------------------------------------------------------------------------------------------

  function sizeOf(img) {
    return [img.naturalWidth || img.videoWidth || img.displayWidth || img.width || 0,
      img.naturalHeight || img.videoHeight || img.displayHeight || img.height || 0];
  }

  // drawImage(g, rec, M, alpha, assets) → boolean: the asset fitted into the node's box ('cover' crops, 'contain' fits).
  function drawImage(g, rec, M, alpha, assets) {
    const img = rec.asset && assets && typeof assets.get === 'function' ? assets.get(rec.asset) : null;
    if (!img) return false;
    const [iw, ih] = sizeOf(img);
    if (!(iw > 0 && ih > 0)) return false;
    const b = rec.box;
    setMatrix(g, M);
    g.globalAlpha = alpha;
    if (rec.fit === 'contain') {
      const s = Math.min(b.w / iw, b.h / ih);
      g.drawImage(img, b.x + (b.w - iw * s) / 2, b.y + (b.h - ih * s) / 2, iw * s, ih * s);
    } else {
      const s = Math.max(b.w / iw, b.h / ih);
      const sw = b.w / s, sh = b.h / s;
      g.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, b.x, b.y, b.w, b.h);
    }
    return true;
  }

  return { setMatrix, scaleOf, drawShape, drawPaint, createPaintCache, drawParticles, drawImage };
});
