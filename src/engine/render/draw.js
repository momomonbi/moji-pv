/* 文字PVメーカー v2 — original work. Drawing an evaluated scene layer: glyphs on the direct or sprite path, shapes, paints, particles, images, picks (DESIGN §4.19.5–7). */
MV.def('engine/render/draw', ['core/color', 'core/mat', 'engine/scene/table', 'engine/scene/frame', 'engine/render/sprites',
  'engine/render/shapes'],
(C, MAT, T, F, SP, SH) => {
  'use strict';

  // The glyph path is chosen from the glyph's pose at this frame only — never from its size or the output scale — so
  // preview and export always take the same path (§4.19.5).
  const GLOW_LEVEL = 3;                 // the 8 du sprite
  const STYLE_GLOW = 0.45;              // text.style 'glow' is a steady glow under every glyph
  const ECHO_SHIFT = 0.08;              // em per unit of echo
  const REVEAL_PAD = 1.3;               // reveal shapes cover the cell plus overhanging ink
  const SLATS = 4;
  const SHARDS = 6;
  const FLIP_SHADE = 0.35;
  const TYPE = T.TYPE;

  // --- colours -----------------------------------------------------------------------------------------------------

  const shadeCache = new Map();         // hex → Array(17) of darker hexes (flip shading, quantized to 1/16)
  const shadowInks = new WeakMap();     // palette → shadow ink

  function inkOf(pal, ink) {
    if (typeof ink === 'string') {
      const v = pal[ink];
      if (v) return v;
      if (C.isHex(ink)) return ink;
    }
    return pal.ink;
  }

  function shaded(hex, q) {
    if (q <= 0) return hex;
    let row = shadeCache.get(hex);
    if (!row) { row = new Array(17).fill(null); shadeCache.set(hex, row); }
    return row[q] || (row[q] = C.shade(hex, q / 16));
  }

  function shadowInk(pal) {
    let v = shadowInks.get(pal);
    if (!v) { v = C.shade(pal.ground || '#000000', 0.62); shadowInks.set(pal, v); }
    return v;
  }

  function secondInk(pal, style) {
    if (style === 'outline') return pal.ground || null;
    if (style === 'shadow') return shadowInk(pal);
    if (style === 'duo') return pal.shiftA || null;
    return null;
  }

  // --- font css strings, cached per face and size (no string is built per frame) ------------------------------------

  const cssCache = new WeakMap();
  function cssOf(font, px) {
    let m = cssCache.get(font);
    if (!m) { m = new Map(); cssCache.set(font, m); }
    let s = m.get(px);
    if (s === undefined) { s = font.css(px); if (m.size > 256) m.clear(); m.set(px, s); }
    return s;
  }

  // --- draw context ------------------------------------------------------------------------------------------------

  // createDrawContext({ sprites, paints, scratch, pool?, blurred? }) → dc, mutated per frame by the renderer:
  //   g (current target), D (device matrix), pal, W, H, scale (device px per du), q (paint helpers), assets, pick,
  //   glyphPath ('auto' | 'sprite' | 'direct'), probe ({ blur, glow, shard, pixel } added to glyph poses; lab only),
  //   face (FontRef for glyph particles), counts { glyphs, shapes, paints, particles, media, mediaFallback (blurred
  //   timed media drawn with the per-frame blur: the store handed out a frame without its baked blur, §11.5.4) }
  //   (DESIGN_2_1) t (absolute frame time, for media on the song clock), backdrop, quality, thumb (posters only),
  //   visible (device rect x0 y0 x1 y1), mediaWaiting, mediaError, pool and blurred (the isolated media path), over and
  //   overKey (the raster oversampling of paints in a zoomed ground and its cache key), cam and layerK (the camera and
  //   parallax of the layer being drawn: a medium at another camera factor gets its own view, §11.9.3), stillMode
  //   (0 every node, 1 all but `still` media, 2 only `still` media: those are drawn outside a seam composite) and
  //   ghostTl (null, or while fx.textAt draws the text layers at an earlier time, the scene time of the frame itself:
  //   media on the show clock keep that frame's media time)
  function createDrawContext(o) {
    return {
      g: null, D: new Float32Array([1, 0, 0, 1, 0, 0]), pal: null, W: 0, H: 0, scale: 1, q: null, assets: null,
      pick: null, glyphPath: 'auto', probe: null, face: null, sprites: o.sprites, paints: o.paints, scratch: o.scratch,
      counts: { glyphs: 0, shapes: 0, paints: 0, particles: 0, media: 0, mediaFallback: 0 },
      font: null, pair: { lo: 0, hi: 0, f: 0 },
      VD: new Float32Array(6), VW: new Float32Array(6), M: new Float32Array(6), W6: new Float32Array(6),
      RM: new Float32Array(6), quad: new Float32Array(8),
      t: 0, backdrop: 'scene', quality: 'preview', thumb: false, visible: new Float32Array(4), mediaWaiting: 0, mediaError: null,
      pool: o.pool || null, blurred: o.blurred || null, over: 1, overKey: 0,
      cam: null, layerK: 1, stillMode: 0, ghostTl: null, depthCam: { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0, fz: 1 },
      VM: new Float32Array(6),
    };
  }

  function resetCounts(dc) {
    const c = dc.counts;
    c.glyphs = 0; c.shapes = 0; c.paints = 0; c.particles = 0; c.media = 0; c.mediaFallback = 0;
    dc.mediaWaiting = 0; dc.mediaError = null;
  }

  function setMatrix(g, M) { g.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]); }

  // The glyph's own turn (rot flag) and tate-chu-yoko squeeze, after the node transform.
  function localTurn(g, rec) {
    if (rec.rot === 2) g.scale(-1, 1);
    if (rec.rot) g.rotate(Math.PI / 2);
    if (rec.sx !== 1) g.scale(rec.sx, 1);
  }

  function textSetup(dc, g, css) {
    if (dc.font !== css) { g.font = css; dc.font = css; }
  }

  // --- reveal clips (in the node frame, before the glyph's own turn) -------------------------------------------------

  function clipReveal(g, mode, w, h, r) {
    const W = w * REVEAL_PAD, H = h * REVEAL_PAD, x0 = -W / 2, y0 = -H / 2;
    g.beginPath();
    if (mode === 'wipeY') g.rect(x0, y0, W, H * r);
    else if (mode === 'iris') g.arc(0, 0, Math.max(0.01, r * 0.5 * Math.sqrt(W * W + H * H)), 0, 2 * Math.PI);
    else if (mode === 'lines') { for (let s = 0; s < SLATS; s++) g.rect(x0, y0 + (s * H) / SLATS, W, (H / SLATS) * r); }
    else if (mode === 'diag') {
      const d = 2 * r;
      g.moveTo(x0, y0);
      if (d <= 1) { g.lineTo(x0 + d * W, y0); g.lineTo(x0, y0 + d * H); }
      else { g.lineTo(x0 + W, y0); g.lineTo(x0 + W, y0 + (d - 1) * H); g.lineTo(x0 + (d - 1) * W, y0 + H); g.lineTo(x0, y0 + H); }
      g.closePath();
    } else g.rect(x0, y0, W * r, H);
    g.clip();
  }

  // --- glyphs ----------------------------------------------------------------------------------------------------------

  // Integer hash for the shard strips of one glyph (pure arithmetic, no allocation).
  function mix32(a) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function drawDirect(dc, g, rec, M, alpha, ink, ink2, tint, echo) {
    const pal = dc.pal;
    textSetup(dc, g, cssOf(rec.font, rec.em));
    if (echo > 0) {
      const a = 0.5 * echo * alpha, dx = ECHO_SHIFT * echo * rec.em;
      for (let s = -1; s <= 1; s += 2) {
        setMatrix(g, M);
        g.translate(s * dx, 0);
        localTurn(g, rec);
        g.globalAlpha = a;
        g.fillStyle = s < 0 ? pal.shiftB : pal.shiftA;
        g.fillText(rec.ch, 0, 0);
      }
    }
    setMatrix(g, M);
    localTurn(g, rec);
    g.globalAlpha = alpha;
    SP.paintStyled(g, rec.ch, rec.em, ink, rec.style, ink2, 0, 0);
    if (tint > 0) {
      g.globalAlpha = alpha * tint;
      g.fillStyle = pal.accent;
      g.fillText(rec.ch, 0, 0);
    }
  }

  // One sprite at the glyph's origin, e du per raster px, drawn whole. A raster that carries its ink rect (sp.ink: a host
  // with inkBox; outside the rect it is transparent, engine/render/sprites inkRect) and is drawn scaled up on both axes
  // is clipped to that rect widened by INK_CLIP texels, so a canvas without a GPU spends its time only there. The clip
  // is chosen so that every pixel is what the unclipped draw gives (clip, from inkClip):
  //   INK_ALL  — a draw whose transform turns or skews the raster: all four sides. A canvas maps each pixel on its own
  //              then; a pixel cut or touched by the clip samples only transparent texels (a texel is ≥ 1 device px when
  //              scaling up, and the bilinear footprint is 2 × 2 texels), so its value stays;
  //   INK_OPEN_LEFT / INK_OPEN_RIGHT — a scale-and-translate draw: the top, the bottom and the side where the canvas's
  //              rows end. A software canvas steps along each row from the row's first pixel in fixed point, so a row
  //              that starts elsewhere rounds a few texel weights differently (1–5/255, measured); the side where rows
  //              start (the device's left: the raster's left, or its right when the draw is mirrored) stays open.
  // A draw that scales down on any axis (a canvas may sample it through mip levels, whose footprint is wider) and every
  // draw on the recorder (no ink rects) are not clipped (INK_NONE).
  const INK_CLIP = 2;
  const INK_NONE = 0, INK_ALL = 1, INK_OPEN_LEFT = 2, INK_OPEN_RIGHT = 3;
  function spriteAt(g, sp, e, alpha, clip, meter) {
    g.globalAlpha = alpha;
    const r = clip !== INK_NONE ? sp.ink : null;
    const x = -sp.cx * e, y = -sp.cy * e, w = sp.w * e, h = sp.h * e;
    if (!r) {
      if (meter) metered(g, meter, x, y, x + w, y + h);
      g.drawImage(sp.canvas, x, y, w, h);
      return;
    }
    // (an open side lies a texel beyond the quad, so no row of the quad starts on the clip's edge)
    const cy0 = (r.y - INK_CLIP - sp.cy) * e, cy1 = (r.y + r.h + INK_CLIP - sp.cy) * e;
    const cx0 = clip === INK_OPEN_LEFT ? x - e : (r.x - INK_CLIP - sp.cx) * e;
    const cx1 = clip === INK_OPEN_RIGHT ? x + w + e : (r.x + r.w + INK_CLIP - sp.cx) * e;
    if (meter) metered(g, meter, Math.max(x, cx0), Math.max(y, cy0), Math.min(x + w, cx1), Math.min(y + h, cy1));
    g.save();
    g.beginPath();
    g.rect(cx0, cy0, cx1 - cx0, cy1 - cy0);
    g.clip();
    g.drawImage(sp.canvas, x, y, w, h);
    g.restore();
  }

  // The lab's sprite meter (render option `meter`, never set by the app or an export): the device px of the frame a
  // sprite draw covers (the bounding box of its drawn rect, within the frame) and the number of draws.
  function metered(g, meter, x0, y0, x1, y1) {
    const m = g.getTransform();
    let lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity;
    for (let k = 0; k < 4; k++) {
      const px = k & 1 ? x1 : x0, py = k & 2 ? y1 : y0;
      const X = m.a * px + m.c * py + m.e, Y = m.b * px + m.d * py + m.f;
      if (X < lx) lx = X; if (X > hx) hx = X; if (Y < ly) ly = Y; if (Y > hy) hy = Y;
    }
    const w = Math.min(hx, meter.w) - Math.max(lx, 0), h = Math.min(hy, meter.h) - Math.max(ly, 0);
    if (w > 0 && h > 0) meter.px += w * h;
    meter.n++;
  }

  // The smallest device scale of a glyph's draw (device px per du along its shortest axis): the smaller singular value
  // of M, times the tate-chu-yoko squeeze.
  function minScaleOf(M, rec) {
    const a = M[0], b = M[1], c = M[2], d = M[3];
    const t = a * a + b * b + c * c + d * d, det = a * d - b * c;
    const s = Math.sqrt(Math.max(0, (t - Math.sqrt(Math.max(0, t * t - 4 * det * det))) / 2));
    return rec.sx < 1 ? s * rec.sx : s;
  }

  // The clip spriteAt gives a raster drawn under M and the glyph's own turn (localTurn): none unless it has an ink rect
  // and is scaled up on both axes; all sides when the transform turns (a turned glyph, or M with a rotation or skew);
  // else open on the side where device rows start (M's x scale times the squeeze: positive → the raster's left).
  function inkClip(sp, rec, M) {
    if (!sp.ink || (rec.em / sp.F) * minScaleOf(M, rec) < 1) return INK_NONE;
    if (rec.rot || M[1] !== 0 || M[2] !== 0) return INK_ALL;
    return M[0] * rec.sx > 0 ? INK_OPEN_LEFT : INK_OPEN_RIGHT;
  }

  // The crossfaded pair of blur levels of one ink/style (§4.19.5: alpha 1 − f and f). Without a target (g null: a
  // warm-up walk) only the two sprites are looked up.
  function spritePair(dc, g, rec, M, k, ink, style, ink2, alpha, dx) {
    const pr = dc.pair;
    const lo = dc.sprites.glyph(rec.font, rec.ch, ink, style, ink2, k, pr.lo, rec.em);
    const hi = pr.f > 0 ? dc.sprites.glyph(rec.font, rec.ch, ink, style, ink2, k, pr.hi, rec.em) : null;
    if (!g) return;
    setMatrix(g, M);
    if (dx) g.translate(dx, 0);
    localTurn(g, rec);
    if (pr.f < 1) spriteAt(g, lo, rec.em / lo.F, alpha * (1 - pr.f), inkClip(lo, rec, M), dc.meter);
    if (hi) spriteAt(g, hi, rec.em / hi.F, alpha * pr.f, inkClip(hi, rec, M), dc.meter);
  }

  function drawPixelated(dc, g, sp, e, alpha, pixel) {
    const sc = dc.scratch;
    const block = Math.max(1, (pixel / e));             // raster px per mosaic block
    const w = Math.max(1, Math.min(sc.w, Math.ceil(sp.w / block))), h = Math.max(1, Math.min(sc.h, Math.ceil(sp.h / block)));
    const s = sc.ctx;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.clearRect(0, 0, w, h);
    s.drawImage(sp.canvas, 0, 0, sp.w, sp.h, 0, 0, w, h);
    const smooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    g.globalAlpha = alpha;
    g.drawImage(sc.canvas, 0, 0, w, h, -sp.cx * e, -sp.cy * e, sp.w * e, sp.h * e);
    g.imageSmoothingEnabled = smooth;
  }

  function drawShards(g, sp, e, alpha, shard, em, seed) {
    g.globalAlpha = alpha;
    const sh = sp.h / SHARDS;
    for (let j = 0; j < SHARDS; j++) {
      const dx = (mix32(seed + j * 2) - 0.5) * 1.2 * shard * em;
      const dy = (mix32(seed + j * 2 + 1) - 0.5) * 0.8 * shard * em;
      g.drawImage(sp.canvas, 0, j * sh, sp.w, sh, -sp.cx * e + dx, (j * sh - sp.cy) * e + dy, sp.w * e, sh * e);
    }
  }

  // The glow under a glyph: the 8 du sprite in the accent ink, added with 'lighter'. It is blurred, so a sprite raster
  // scaled up for a large glyph does not show.
  function drawHalo(dc, g, rec, M, k, alpha, glow) {
    const gl = dc.sprites.glyph(rec.font, rec.ch, dc.pal.accent, 'plain', null, k, GLOW_LEVEL, rec.em);
    if (!g) return;
    setMatrix(g, M);
    localTurn(g, rec);
    g.globalCompositeOperation = 'lighter';
    spriteAt(g, gl, rec.em / gl.F, alpha * (glow > 1 ? 1 : glow), inkClip(gl, rec, M), dc.meter);
    g.globalCompositeOperation = 'source-over';
  }

  function drawSprite(dc, g, rec, M, alpha, ink, ink2, tint, echo, blur, glow, shard, pixel, seed) {
    const pal = dc.pal;
    const k = SP.bucketOf(rec.em * SH.scaleOf(M));
    SP.levelPair(blur, dc.pair);
    if (glow > 0) drawHalo(dc, g, rec, M, k, alpha, glow);
    if (echo > 0) {
      const dx = ECHO_SHIFT * echo * rec.em;
      spritePair(dc, g, rec, M, k, pal.shiftA, 'plain', null, 0.5 * echo * alpha, dx);
      spritePair(dc, g, rec, M, k, pal.shiftB, 'plain', null, 0.5 * echo * alpha, -dx);
    }
    if (pixel >= 1 || shard > 0) {
      const sp = dc.sprites.glyph(rec.font, rec.ch, ink, rec.style, ink2, k, dc.pair.lo, rec.em);
      if (g) {
        const e = rec.em / sp.F;
        setMatrix(g, M);
        localTurn(g, rec);
        if (pixel >= 1) drawPixelated(dc, g, sp, e, alpha, pixel);
        else drawShards(g, sp, e, alpha, shard, rec.em, seed);
      }
    } else {
      spritePair(dc, g, rec, M, k, ink, rec.style, ink2, alpha, 0);
    }
    if (tint > 0) spritePair(dc, g, rec, M, k, pal.accent, 'plain', null, alpha * tint, 0);
  }

  // drawGlyph(dc, scene, i, M): one glyph node under the full device transform M. With dc.g null it draws nothing and
  // only looks up the sprites the glyph would draw (warmLayer): the keys come from this one code path.
  function drawGlyph(dc, scene, i, M) {
    const table = scene.table, P = table.live;
    const rec = scene.stores.glyph[table.payload[i]];
    if (!rec || !rec.font || rec.cls === 'space') return false;
    const reveal = P.reveal[i];
    if (!(reveal > 0.001)) return false;
    const alpha = table.wa[i];
    const pr = dc.probe;
    const blur = P.blur[i] + (pr ? pr.blur || 0 : 0);
    const glow = P.glow[i] + (pr ? pr.glow || 0 : 0);
    const shard = P.shard[i] + (pr ? pr.shard || 0 : 0);
    const pixel = P.pixel[i] + (pr ? pr.pixel || 0 : 0);
    const flip = 1 - Math.min(Math.abs(Math.cos(P.rx[i])), Math.abs(Math.cos(P.ry[i])));
    const pal = dc.pal;
    const ink = shaded(inkOf(pal, rec.ink), Math.round(FLIP_SHADE * flip * 16));
    const ink2 = secondInk(pal, rec.style);
    const direct = dc.glyphPath === 'direct' ||
      (dc.glyphPath !== 'sprite' && blur < SP.DIRECT_BLUR && glow < 0.01 && shard === 0 && pixel < 1);
    const g = dc.g;
    if (reveal < 1 && g) {
      g.save();
      setMatrix(g, M);
      clipReveal(g, rec.reveal, rec.w, rec.h, reveal);
      dc.font = null;
    }
    // Text style 'glow' is a style, not a pose: a steady halo under the glyph, while the body takes the path its pose
    // selects (direct at rest).
    const halo = rec.style === 'glow' && glow < STYLE_GLOW ? STYLE_GLOW : glow;
    if (direct) {
      if (halo > 0) drawHalo(dc, g, rec, M, SP.bucketOf(rec.em * SH.scaleOf(M)), alpha, halo);
      if (g) drawDirect(dc, g, rec, M, alpha, ink, ink2, P.tint[i], P.echo[i]);
    } else {
      const seed = rec.run * 7919 + rec.i;
      drawSprite(dc, g, rec, M, alpha, ink, ink2, P.tint[i], P.echo[i], blur < 0 ? 0 : blur, halo, shard, pixel, seed);
    }
    if (reveal < 1 && g) { g.restore(); dc.font = null; }
    return true;
  }

  // --- the glyph cost model (DESIGN_2_1 §5.9.5) ------------------------------------------------------------------

  // glyphCover(rec, P, i, wa, M, W, H) → the du² of the frame [0, W] × [0, H] that drawing glyph node i (pose P, world
  // alpha wa) covers under the screen matrix M (du → frame du), summed over what drawGlyph draws (a spot drawn twice
  // counts twice), each draw counted by the bounding box of its rect within the frame:
  //   - the direct path: the glyph's ink (fillText), its two echo copies and its tint copy;
  //   - the sprite path: the halo (a glow, or the text style's; also on the direct path), the echo pairs, the body (a
  //     crossfaded pair of blur levels, or one raster for shards and pixels) and the tint pair. Each sprite counts at
  //     least the rect spriteAt draws of it at 720p or larger: a raster of level ≤ 2 whole (it may be drawn scaled down,
  //     which is never clipped), shards (widened by the strips' spread) and the mosaic whole, and a level ≥ 3 raster from
  //     its box's left edge to the ink's right edge plus the clip's pad (the open side of the scale-and-translate clip)
  //     by the ink's height plus the pad.
  // The ink is taken as inkEm(style) em (or half the cell, if larger) either side of the glyph's centre. Allocation-free.
  const COVER_INK = 0.66;        // the ink's reach from the centre in em: descenders and emoji reach 0.63 (textBaseline middle)
  const COVER_PX = 3;            // 2 device px of antialiasing at 720p (1.5 du per px)
  // what a text style adds to the reach (engine/render/sprites: half the outline, the shadow's or duo's larger offset)
  const COVER_STYLE = Object.freeze({ outline: SP.OUTLINE_WIDTH / 2, shadow: Math.max(...SP.SHADOW_OFFSET),
    duo: Math.max(...SP.DUO_OFFSET) });
  // inkEm(style) → the ink's reach from the glyph's centre (em) the model assumes for a text style
  // (tests/browser/glyph_parity.py holds every measured ink rect to it).
  function inkEm(style) { return COVER_INK + (COVER_STYLE[style] || 0); }
  function inkReach(rec) { return Math.max(inkEm(rec.style) * rec.em, 0.5 * (rec.w || 0), 0.5 * (rec.h || 0)); }
  const COVER_M = new Float64Array(6);          // M · the glyph's own turn (localTurn)
  const COVER_PAIR = { lo: 0, hi: 0, f: 0 };

  // count (optional, tests): { sprites, inks } incremented per sprite and per direct-path ink draw counted.
  function glyphCover(rec, P, i, wa, M, W, H, count) {
    if (!(P.reveal[i] > 0.001) || !(wa >= T.MIN_ALPHA)) return 0;
    return poseCover(rec, P.blur[i], P.glow[i], P.shard[i], P.pixel[i], P.echo[i], P.tint[i], M, W, H, count);
  }

  // poseCover(rec, blur, glow, shard, pixel, echo, tint, M, W, H, count?) → glyphCover for a visible glyph with these
  // pose values.
  let COUNT = null;
  function poseCover(rec, blurIn, glow, shard, pixel, echo, tint, M, W, H, count) {
    COUNT = count || null;
    if (!rec || !rec.font || rec.cls === 'space') return 0;
    const blur = blurIn > 0 ? blurIn : 0;
    const halo = rec.style === 'glow' && glow < STYLE_GLOW ? STYLE_GLOW : glow;
    const direct = blur < SP.DIRECT_BLUR && glow < 0.01 && shard === 0 && pixel < 1;
    const N = COVER_M;
    N[0] = M[0]; N[1] = M[1]; N[2] = M[2]; N[3] = M[3]; N[4] = M[4]; N[5] = M[5];
    if (rec.rot === 2) { N[0] = -N[0]; N[1] = -N[1]; }                      // scale(−1, 1)
    if (rec.rot) { const a = N[0], b = N[1]; N[0] = N[2]; N[1] = N[3]; N[2] = -a; N[3] = -b; }   // rotate(π/2)
    if (rec.sx !== 1) { N[0] *= rec.sx; N[1] *= rec.sx; }                  // scale(sx, 1)
    let sum = 0;
    if (halo > 0) sum += rasterCover(rec, M, GLOW_LEVEL, 0, 0, false, W, H);
    if (direct) {
      if (echo > 0) { const dx = ECHO_SHIFT * echo * rec.em; sum += inkCover(rec, M, dx, W, H) + inkCover(rec, M, -dx, W, H); }
      sum += inkCover(rec, M, 0, W, H);
      if (tint > 0) sum += inkCover(rec, M, 0, W, H);
      return sum;
    }
    const pr = SP.levelPair(blur, COVER_PAIR);
    if (echo > 0) {
      const dx = ECHO_SHIFT * echo * rec.em;
      sum += pairCover(rec, M, pr, dx, W, H) + pairCover(rec, M, pr, -dx, W, H);
    }
    if (pixel >= 1 || shard > 0) sum += rasterCover(rec, M, pr.lo, 0, pixel >= 1 ? 0 : shard, true, W, H);
    else sum += pairCover(rec, M, pr, 0, W, H);
    if (tint > 0) sum += pairCover(rec, M, pr, 0, W, H);
    return sum;
  }

  // The frame du² of the glyph's ink (a direct-path fillText), dx = an echo shift before the glyph's own turn.
  function inkCover(rec, M, dx, W, H) {
    if (COUNT) COUNT.inks++;
    const ink = inkReach(rec) + COVER_PX;
    return rectCover(M, -ink, -ink, ink, ink, dx, W, H);
  }

  function pairCover(rec, M, pr, dx, W, H) {
    const lo = pr.lo, hi = pr.hi, f = pr.f;       // (read before rasterCover: pr is shared)
    return (f < 1 ? rasterCover(rec, M, lo, dx, 0, false, W, H) : 0) + (f > 0 ? rasterCover(rec, M, hi, dx, 0, false, W, H) : 0);
  }

  // The frame du² one raster of blur level `level` covers: whole (level ≤ 2, shards spread by `shard`, the mosaic) or
  // clipped to the ink (level ≥ 3); dx = the echo shift, in the node frame before the glyph's own turn (spritePair).
  function rasterCover(rec, M, level, dx, shard, whole, W, H) {
    if (COUNT) COUNT.sprites++;
    const em = rec.em, blurDu = SP.LEVELS[level];
    // a raster px is at most max(blur/4, 0.0035 em) du (BLUR_RASTER_PX, MAX_SIDE), so its 2 px margins are within the
    // added 0.5·blur + 0.01 em, and the clip's pad (3σ + 2 px, widened by INK_CLIP texels) within 4·blur + 0.015 em
    const half = (SP.BOX_EM * em) / 2 + SP.BLUR_REACH * blurDu + 0.5 * blurDu + 0.01 * em + COVER_PX;
    let x0 = -half, x1 = half, y0 = -half, y1 = half;
    if (!whole && level >= 3) {
      const ink = inkReach(rec);
      const pad = 4 * blurDu + 0.015 * em + COVER_PX;
      x1 = ink + pad; y0 = -ink - pad; y1 = ink + pad;
    }
    if (shard > 0) { const sx = 0.6 * shard * em, sy = 0.4 * shard * em; x0 -= sx; x1 += sx; y0 -= sy; y1 += sy; }
    return rectCover(M, x0, y0, x1, y1, dx, W, H);
  }

  // The frame du² of the bounding box of the rect x0..x1 × y0..y1 (after the glyph's own turn, COVER_M) moved by dx in
  // the node frame (M's own axes).
  function rectCover(M, x0, y0, x1, y1, dx, W, H) {
    const N = COVER_M, ox = N[4] + M[0] * dx, oy = N[5] + M[1] * dx;
    let lx = Infinity, ly = Infinity, hx = -Infinity, hy = -Infinity;
    for (let k = 0; k < 4; k++) {
      const u = k & 1 ? x1 : x0, v = k & 2 ? y1 : y0;
      const X = N[0] * u + N[2] * v + ox, Y = N[1] * u + N[3] * v + oy;
      if (X < lx) lx = X; if (X > hx) hx = X; if (Y < ly) ly = Y; if (Y > hy) hy = Y;
    }
    const w = Math.min(hx, W) - Math.max(lx, 0), h = Math.min(hy, H) - Math.max(ly, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  // --- a scene layer ------------------------------------------------------------------------------------------------

  const layerLists = new WeakMap();

  // Node indexes per layer in index order (parents first), computed once per scene.
  function nodesByLayer(scene) {
    let lists = layerLists.get(scene);
    if (lists) return lists;
    const t = scene.table;
    const per = T.LAYERS.map(() => []);
    for (let i = 0; i < t.n; i++) if (t.type[i] !== TYPE.group && t.type[i] !== TYPE.camera) per[t.layer[i]].push(i);
    lists = per.map((a) => Int32Array.from(a));
    layerLists.set(scene, lists);
    return lists;
  }

  function hasLayer(scene, L) { return nodesByLayer(scene)[L].length > 0; }

  // Whether a layer of the scene holds a media node (never baked into a static raster, DESIGN_2_1 §11.5.10).
  const mediaLayers = new WeakMap();
  function mediaFlags(scene) {
    let per = mediaLayers.get(scene);
    if (!per) {
      per = new Uint8Array(T.LAYERS.length);
      for (const m of scene.media || []) {
        const rec = scene.stores.image[scene.table.payload[m.node]];
        per[scene.table.layer[m.node]] |= 1 | (rec && rec.still ? 2 : 0);
      }
      mediaLayers.set(scene, per);
    }
    return per;
  }

  function hasMedia(scene, L) { return (mediaFlags(scene)[L] & 1) !== 0; }

  // Whether a layer of the scene holds a `still` medium (DESIGN_2_1 §11.9.3).
  function hasStill(scene, L) { return (mediaFlags(scene)[L] & 2) !== 0; }

  function worldInto(out, table, i) {
    const o = i * 6, m = table.m;
    out[0] = m[o]; out[1] = m[o + 1]; out[2] = m[o + 2]; out[3] = m[o + 3]; out[4] = m[o + 4]; out[5] = m[o + 5];
    return out;
  }

  function pickNode(dc, scene, i, VW, cutIndex, x0, y0, x1, y1) {
    const t = scene.table;
    if (!dc.pick || (t.flags[i] & T.FLAG.pickable) === 0) return;
    MAT.quad(dc.quad, VW, x0, y0, x1, y1);
    const own = scene.owners[t.owner[i]];
    const el = scene.kind === 'ground' ? (own && own.el === 'atmos' ? 'atmos' : 'ground') : (own ? own.el : 'text');
    dc.pick.add(dc.quad, cutIndex, el, own ? own.slot : null, i);
  }

  // drawLayer(dc, scene, L, view, tl, cutIndex): every visible node of one layer of an evaluated scene, in index order.
  // view = the camera view of this layer (du → du); cutIndex = the plan cut the picks belong to (−1: none).
  function drawLayer(dc, scene, L, view, tl, cutIndex) {
    const list = nodesByLayer(scene)[L];
    if (list.length === 0) return;
    const t = scene.table, g = dc.g, stores = scene.stores, pal = dc.pal;
    MAT.mul(dc.VD, dc.D, view);
    let clipRun = -1;
    dc.font = null;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let k = 0; k < list.length; k++) {
      const i = list[k];
      if (T.isHidden(t, i)) continue;
      const type = t.type[i];
      // media depth (DESIGN_2_1 §11.9.3): a `still` medium is drawn on its own pass when a seam is on screen, and a
      // medium at a camera factor other than 1 sees the layer's camera through K.depthCam
      let nodeView = view;
      const media = type === TYPE.image ? stores.image[t.payload[i]] : null;
      const still = !!media && media.media === true && media.still === true;
      if (dc.stillMode === 1 && still) continue;
      if (dc.stillMode === 2 && !still) continue;
      if (media && media.media && media.cam !== 1 && dc.cam) {
        nodeView = F.viewMatrix(dc.VM, F.depthCam(dc.cam, media.cam, dc.depthCam), dc.layerK, dc.W, dc.H);
      }
      const VW = MAT.mul(dc.VW, nodeView, worldInto(dc.W6, t, i));
      const M = MAT.mul(dc.M, dc.D, VW);
      const alpha = t.wa[i] > 1 ? 1 : t.wa[i];
      if (type === TYPE.glyph) {
        const rec = stores.glyph[t.payload[i]];
        const run = scene.runs[rec.run];
        const clip = run && run.clip ? run : null;
        if (clip && clipRun !== rec.run) {
          if (clipRun >= 0) g.restore();
          g.save();
          MAT.mul(dc.RM, dc.VD, worldInto(dc.RM, t, clip.node));
          setMatrix(g, dc.RM);
          g.beginPath();
          g.rect(clip.clip.x, clip.clip.y, clip.clip.w, clip.clip.h);
          g.clip();
          clipRun = rec.run;
          dc.font = null;
        } else if (!clip && clipRun >= 0) { g.restore(); clipRun = -1; dc.font = null; }
        if (drawGlyph(dc, scene, i, M)) {
          dc.counts.glyphs++;
          pickNode(dc, scene, i, VW, cutIndex, -rec.w / 2, -rec.h / 2, rec.w / 2, rec.h / 2);
        }
        continue;
      }
      if (clipRun >= 0) { g.restore(); clipRun = -1; dc.font = null; }
      if (type === TYPE.shape) {
        const rec = stores.shape[t.payload[i]];
        const fill = rec.fill === null ? null : inkOf(pal, rec.fill), stroke = rec.stroke === null ? null : inkOf(pal, rec.stroke);
        SH.drawShape(g, rec, M, alpha, fill, stroke);
        dc.counts.shapes++;
        const pad = rec.stroke !== null ? rec.width / 2 : 0, b = rec.bounds;
        pickNode(dc, scene, i, VW, cutIndex, b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad);
      } else if (type === TYPE.paint) {
        const rec = stores.paint[t.payload[i]];
        const still = rec.animated === false && (t.flags[i] & T.FLAG.static) !== 0;
        // a still paint of a zoomed ground is rasterized oversampled (dc.over, DESIGN_2_1 §4.8)
        if (!still || !dc.paints.draw(g, rec, M, alpha, dc.q, dc.W, dc.H, dc.scale * dc.over, dc.over === 1 ? dc.paintKey : dc.overKey)) {
          SH.drawPaint(g, rec, M, alpha, rec.animated === false ? 0 : tl, dc.q);
        }
        dc.font = null;
        dc.counts.paints++;
      } else if (type === TYPE.particles) {
        const rec = stores.particles[t.payload[i]];
        dc.counts.particles += SH.drawParticles(g, rec, M, alpha, tl, inkOf(pal, rec.ink), dc.sprites, dc.face);
      } else if (type === TYPE.image) {
        const rec = stores.image[t.payload[i]];
        if (rec.media) {
          // media (DESIGN_2_1 §11.3.7): overlay footage (sceneOnly) is drawn only over the scene backdrop
          if (rec.sceneOnly && dc.backdrop !== 'scene') continue;
          if (SH.drawMedia(g, rec, M, alpha, dc, tl)) {
            const r = rec.rect;
            pickNode(dc, scene, i, VW, cutIndex, r.dx, r.dy, r.dx + r.dw, r.dy + r.dh);
          }
          dc.font = null;
        } else if (SH.drawImage(g, rec, M, alpha, dc.assets)) {
          const b = rec.box;
          pickNode(dc, scene, i, VW, cutIndex, b.x, b.y, b.x + b.w, b.y + b.h);
        }
      }
    }
    if (clipRun >= 0) { g.restore(); dc.font = null; }
    g.globalAlpha = 1;
  }

  // warmLayer(dc, scene, L, view, stop?) → glyphs visited: the sprite lookups drawLayer would make for the glyphs of one
  // layer (the same keys: size bucket from the full transform with pose scale and camera zoom, blur level pair,
  // flip-shaded ink, halo, echo and tint inks, level 0 for pixel and shard), without drawing. Missing sprites are
  // rasterized now. stop() is asked after each glyph that made a sprite; when it answers true the walk ends there and
  // the result is −(glyphs visited) − 1.
  function warmLayer(dc, scene, L, view, stop) {
    const list = nodesByLayer(scene)[L];
    if (list.length === 0) return 0;
    const t = scene.table, g0 = dc.g;
    let n = 0;
    dc.g = null;
    try {
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        if (t.type[i] !== TYPE.glyph || T.isHidden(t, i)) continue;
        const VW = MAT.mul(dc.VW, view, worldInto(dc.W6, t, i));
        const made = dc.sprites.made;
        if (drawGlyph(dc, scene, i, MAT.mul(dc.M, dc.D, VW))) n++;
        if (stop && dc.sprites.made !== made && stop()) return -n - 1;
      }
    } finally {
      dc.g = g0;
    }
    return n;
  }

  return { createDrawContext, resetCounts, drawLayer, warmLayer, drawGlyph, hasLayer, hasMedia, hasStill, nodesByLayer, inkOf,
    secondInk, shaded, cssOf, clipReveal, minScaleOf, inkClip, INK_CLIP, glyphCover, poseCover, inkEm, STYLE_GLOW, GLOW_LEVEL };
});
