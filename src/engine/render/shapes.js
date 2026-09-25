/* 文字PVメーカー v2 — original work. Non-text draw paths: shapes, paints (with the static raster cache), particles, images and media (DESIGN §4.19.6; DESIGN_2_1 §11.5.4–§11.5.5). */
MV.def('engine/render/shapes', ['core/color', 'core/media', 'engine/scene/table', 'engine/scene/builder', 'engine/render/sprites'],
(C, MEDIA, T, B, SP) => {
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

  // --- media (DESIGN_2_1 §11.5.4–§11.5.5) --------------------------------------------------------------------------

  const COMP_OP = Object.freeze({ over: 'source-over', atop: 'source-atop', screen: 'screen', multiply: 'multiply',
    overlay: 'overlay' });
  const PLACEHOLDER_CELL = 48;          // du: the checkerboard a missing picture shows in the preview (§11.7.8)
  const WANT = { px: 0, blur: 0, exact: false, thumb: false };     // pooled request of drawMedia (one call at a time)
  const RM = new Float32Array(6);
  const SRC = { x: 0, y: 0, w: 0, h: 0 };
  const CORNER = new Float32Array(2);

  function inkHex(pal, ink) {
    if (typeof ink === 'string' && pal && pal[ink]) return pal[ink];
    return typeof ink === 'string' && /^#[0-9A-Fa-f]{6}$/.test(ink) ? ink : (pal && pal.ink) || '#000000';
  }

  // The source rectangle of a fit (displayed px of the asset) in the delivered image's coded px: scaled from the
  // asset's displayed size to the frame's (a still's tier), then turned back through the frame's rotation (§11.5.5):
  //   90: (sx, sy, sw, sh) → (sy, W − sx − sw, sh, sw);  180: (W − sx − sw, H − sy − sh, sw, sh);  270: (H − sy − sh, sx, sh, sw)
  function codedRect(fit, meta, f, out) {
    const kx = f.w / Math.max(1, meta.w), ky = f.h / Math.max(1, meta.h);
    const sx = fit.sx * kx, sy = fit.sy * ky, sw = fit.sw * kx, sh = fit.sh * ky, W = f.w, H = f.h;
    if (f.rot === 90) { out.x = sy; out.y = W - sx - sw; out.w = sh; out.h = sw; }
    else if (f.rot === 180) { out.x = W - sx - sw; out.y = H - sy - sh; out.w = sw; out.h = sh; }
    else if (f.rot === 270) { out.x = H - sy - sh; out.y = sx; out.w = sh; out.h = sw; }
    else { out.x = sx; out.y = sy; out.w = sw; out.h = sh; }
    return out;
  }

  // The transform that draws a picture of rotation `rot` upright into the dest rect (dx, dy, dw, dh), flipped by
  // (fx, fy) = ±1 about the rect's centre: M · T(centre) · S(fx, fy) · R(rot). Its local rect is centred on 0.
  function placeInto(g, M, dx, dy, dw, dh, rot, fx, fy) {
    const cx = dx + dw / 2, cy = dy + dh / 2;
    const a = (rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    // R(rot) then S(fx, fy) then T(cx, cy), all under M
    const m0 = fx * c, m1 = fy * s, m2 = -fx * s, m3 = fy * c;
    RM[0] = M[0] * m0 + M[2] * m1; RM[1] = M[1] * m0 + M[3] * m1;
    RM[2] = M[0] * m2 + M[2] * m3; RM[3] = M[1] * m2 + M[3] * m3;
    RM[4] = M[0] * cx + M[2] * cy + M[4]; RM[5] = M[1] * cx + M[3] * cy + M[5];
    setMatrix(g, RM);
  }

  // An upright, unflipped picture is one drawImage(image, source rect, dest rect) under the node's transform (the op the
  // recorder logs as drawImage('media:<id>@<m>#<index>', sx, sy, sw, sh, dx, dy, dw, dh)); a turned or mirrored one is
  // drawn about the dest centre.
  function drawPicture(g, f, src, M, dx, dy, dw, dh, fx, fy) {
    const rot = f.rot || 0;
    if (rot === 0 && fx === 1 && fy === 1) {
      setMatrix(g, M);
      g.drawImage(f.image, src.x, src.y, src.w, src.h, dx, dy, dw, dh);
      return;
    }
    const turned = rot === 90 || rot === 270;
    const w = turned ? dh : dw, h = turned ? dw : dh;
    placeInto(g, M, dx, dy, dw, dh, rot, fx, fy);
    g.drawImage(f.image, src.x, src.y, src.w, src.h, -w / 2, -h / 2, w, h);
  }

  // Whether the rect (du, under M) reaches into the device rect [x0, x1] × [y0, y1].
  function visible(M, x, y, w, h, vis) {
    let lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity;
    for (let k = 0; k < 4; k++) {
      const px = k & 1 ? x + w : x, py = k & 2 ? y + h : y;
      CORNER[0] = M[0] * px + M[2] * py + M[4]; CORNER[1] = M[1] * px + M[3] * py + M[5];
      if (CORNER[0] < lx) lx = CORNER[0]; if (CORNER[0] > hx) hx = CORNER[0];
      if (CORNER[1] < ly) ly = CORNER[1]; if (CORNER[1] > hy) hy = CORNER[1];
    }
    return hx > vis[0] && lx < vis[2] && hy > vis[1] && ly < vis[3];
  }

  // The picture of one fit into its dest, plus (edge 'mirror') the flipped neighbours that reach into the visible
  // device rect, usually none or two (§11.5.2). → draws made.
  function drawFit(g, f, fit, meta, M, mirror, vis) {
    if (!(fit.dw > 0 && fit.dh > 0 && fit.sw > 0 && fit.sh > 0)) return 0;
    const src = codedRect(fit, meta, f, SRC);
    drawPicture(g, f, src, M, fit.dx, fit.dy, fit.dw, fit.dh, 1, 1);
    let n = 1;
    if (!mirror) return n;
    for (let j = -1; j <= 1; j++) {
      for (let i = -1; i <= 1; i++) {
        if (!i && !j) continue;
        const x = fit.dx + i * fit.dw, y = fit.dy + j * fit.dh;
        if (!visible(M, x, y, fit.dw, fit.dh, vis)) continue;
        drawPicture(g, f, src, M, x, y, fit.dw, fit.dh, i ? -1 : 1, j ? -1 : 1);
        n++;
      }
    }
    return n;
  }

  // A fill over the picture: its dest, or with mirrored edges the dest and its eight neighbours.
  function fillRect(g, M, fit, mirror, style, alpha, op) {
    setMatrix(g, M);
    g.globalAlpha = alpha;
    g.globalCompositeOperation = op;
    g.fillStyle = style;
    if (mirror) g.fillRect(fit.dx - fit.dw, fit.dy - fit.dh, 3 * fit.dw, 3 * fit.dh);
    else g.fillRect(fit.dx, fit.dy, fit.dw, fit.dh);
  }

  // Veil (a fill of the veil ink over the picture) and tint (the tint ink blended as 'color'); drawn straight over an
  // opaque picture, or 'source-atop' inside the isolated surface, so only the picture's pixels change.
  function lookOf(g, rec, fit, M, alpha, pal, veil, atop, mirror) {
    if (veil && veil.a > 0) {
      fillRect(g, M, fit, mirror, C.rgba(inkHex(pal, veil.ink), veil.a), alpha, atop ? 'source-atop' : 'source-over');
    }
    if (rec.tint && rec.tint.a > 0) {
      fillRect(g, M, fit, mirror, inkHex(pal, rec.tint.ink), alpha * rec.tint.a, atop ? 'source-atop' : 'color');
    }
  }

  // The preview's stand-in for a picture that is not on this device: a checkerboard of muted / ground2 over the dest.
  function drawPlaceholder(g, rec, M, alpha, pal) {
    const r = rec.rect;
    if (!(r.dw > 0 && r.dh > 0)) return;
    g.save();
    setMatrix(g, M);
    g.globalAlpha = alpha;
    g.beginPath();
    g.rect(r.dx, r.dy, r.dw, r.dh);
    g.clip();
    g.fillStyle = inkHex(pal, 'ground2');
    g.fillRect(r.dx, r.dy, r.dw, r.dh);
    g.fillStyle = inkHex(pal, 'muted');
    const s = PLACEHOLDER_CELL;
    for (let y = 0, row = 0; y < r.dh; y += s, row++) {
      for (let x = (row & 1) * s; x < r.dw; x += 2 * s) g.fillRect(r.dx + x, r.dy + y, Math.min(s, r.dw - x), Math.min(s, r.dh - y));
    }
    g.restore();
  }

  // One frame of the media: frame() for the source at media time m. Returns the MediaFrame (valid until the next call
  // for the same id) or null; counts a missing or provisional frame, and in export quality records the error the
  // facade raises (EngineError 'media-missing' / 'media-not-ready') instead of drawing a substitute.
  function frameFor(dc, rec, m, blur) {
    const store = dc.assets;
    WANT.px = Math.max(rec.box.w, rec.box.h) * dc.scale * rec.headroom;
    WANT.blur = rec.time ? 0 : blur * dc.scale;
    WANT.thumb = dc.thumb === true;
    WANT.exact = dc.quality === 'export' && !WANT.thumb;     // a thumbnail shows the poster, never waits for a frame
    const f = store && typeof store.frame === 'function' ? store.frame(rec.src, m, WANT) : null;
    if (!f) {
      if (WANT.exact) dc.mediaError = dc.mediaError || { code: 'media-missing', id: rec.src };
      else dc.mediaWaiting++;
      return null;
    }
    if (!f.exact) {
      if (WANT.exact) { dc.mediaError = dc.mediaError || { code: 'media-not-ready', id: rec.src }; return null; }
      dc.mediaWaiting++;
    }
    return f;
  }

  // drawMedia(g, rec, M, alpha, dc, tl) → boolean (§11.5.5): one media node. Its media time is closed-form (clock
  // 'song': the frame's absolute time dc.t; 'show': the scene-local tl); the store picks the source frame. An opaque
  // picture without blur is drawn straight (veil and tint over it); a picture with alpha, a text fill ('atop') or a
  // blurred video goes through a pooled full-frame surface (veil and tint 'source-atop', then the blur), composited
  // with `comp`. 'soft' draws the blurred cover copy first. The mask (a K.shape in box coordinates) clips. Allocation-free.
  function drawMedia(g, rec, M, alpha, dc, tl) {
    const T0 = rec.time;
    const m = T0 ? MEDIA.mapTime(T0, T0.clock === 'song' ? dc.t : tl) : 0;
    const pal = dc.pal;
    const vis = dc.visible;
    const mirror = rec.edge === 'mirror' && rec.bleed > 0;
    let drew = false;
    if (rec.soft) {
      const f = frameFor(dc, rec, m, rec.softBlur);
      if (f) {
        drawLayered(g, rec, f, rec.soft, M, alpha, dc, vis, mirror, rec.softVeil, T0 ? rec.softBlur : 0, 'over');
        drew = true;
      }
    }
    const f = frameFor(dc, rec, m, rec.blur);
    if (!f) {
      if (dc.quality !== 'export' && !drew) drawPlaceholder(g, rec, M, alpha, pal);
      return drew;
    }
    drawLayered(g, rec, f, rec.rect, M, alpha, dc, vis, mirror, rec.veil, T0 ? rec.blur : 0, rec.comp);
    dc.counts.media++;
    return true;
  }

  function drawLayered(g, rec, f, fit, M, alpha, dc, vis, mirror, veil, videoBlur, comp) {
    const looks = (veil && veil.a > 0) || (rec.tint && rec.tint.a > 0);
    const isolated = rec.meta.alpha || comp === 'atop' || videoBlur > 0 || (comp !== 'over' && looks);
    if (!isolated) {
      g.save();
      if (rec.mask) { setMatrix(g, M); B.replayShape(g, rec.mask); g.clip(); }
      g.globalAlpha = alpha;
      g.globalCompositeOperation = COMP_OP[comp] || 'source-over';
      drawFit(g, f, fit, rec.meta, M, mirror, vis);
      g.globalCompositeOperation = 'source-over';
      lookOf(g, rec, fit, M, alpha, dc.pal, veil, false, mirror);
      g.restore();
      return;
    }
    const S = dc.pool.take();
    const s = S.ctx;
    s.globalAlpha = 1;
    drawFit(s, f, fit, rec.meta, M, mirror, vis);
    lookOf(s, rec, fit, M, 1, dc.pal, veil, true, mirror);
    s.globalCompositeOperation = 'source-over';
    let out = S;
    if (videoBlur > 0) { out = dc.blurred(S, videoBlur * dc.scale); dc.pool.give(S); }
    g.save();
    if (rec.mask) { setMatrix(g, M); B.replayShape(g, rec.mask); g.clip(); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = alpha;
    g.globalCompositeOperation = COMP_OP[comp] || 'source-over';
    g.drawImage(out.canvas, 0, 0);
    g.restore();
    dc.pool.give(out);
  }

  // The dest quad of a media record (for picks and bounds): its fitted dest rect.
  function mediaDest(rec) { return rec.rect; }

  return { setMatrix, scaleOf, drawShape, drawPaint, createPaintCache, drawParticles, drawImage, drawMedia, mediaDest, codedRect,
    COMP_OP };
});
