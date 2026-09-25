/* 文字PVメーカー v2 — original work. Glyph and particle sprites: cached rasters keyed by face, grapheme, size bucket, ink, style and blur level (DESIGN §4.19.5–6). */
MV.def('engine/render/sprites', ['engine/scene/builder'], (B) => {
  'use strict';

  const LEVELS = Object.freeze([0, 2, 4, 8, 16, 32]);   // blur levels, du
  const DIRECT_BLUR = 0.05;       // below this blur (du) a glyph may take the direct path
  const MAX_SIDE = 512;           // largest sprite raster side; bigger sprites are rasterized smaller and scaled up
  const LEVEL0_SUPERSAMPLE = 2;
  const BOX_EM = 1.6;             // sprite box in em: room for overhanging glyphs and the style offsets
  const BLUR_REACH = 2.5;         // padding in blur standard deviations
  const BLUR_RASTER_PX = 4;       // a blurred raster needs no more resolution than a blur of this many raster px (below)
  const MIN_K = 8;                // smallest size bucket: 2^(8/4) = 4 px
  const MAX_K = 40;               // largest: 2^10 = 1024 px
  const BUDGET = 96 * 1024 * 1024;
  const BUDGET_SHARED = 48 * 1024 * 1024;               // output ≥ 1440p while the preview runs too (§4.19.5)
  const STYLES = Object.freeze(['plain', 'outline', 'shadow', 'glow', 'duo']);
  const STYLE_INDEX = Object.freeze({ plain: 0, outline: 1, shadow: 2, glow: 3, duo: 4 });
  const BLUR_STEPS = 8;           // a blurred raster's blur is keyed (and drawn) in 1/8 raster px
  const BLUR_CODES = 1 << 20;     // room for the blur steps in a numeric sprite code
  // Style geometry in em (shared by the direct path and the sprites, so both draw the same glyph).
  const OUTLINE_WIDTH = 0.045;
  const SHADOW_OFFSET = Object.freeze([0.06, 0.07]);
  const DUO_OFFSET = Object.freeze([0.045, 0.045]);

  // Size bucket index k of a device em size: the nearest 2^(k/4) px (§4.19.5), clamped.
  function bucketOf(px) {
    const k = Math.round(4 * Math.log2(px > 1e-6 ? px : 1e-6));
    return k < MIN_K ? MIN_K : k > MAX_K ? MAX_K : k;
  }

  function bucketPx(k) { return Math.pow(2, k / 4); }

  // The blur level pair around a blur (du): writes { lo, hi, f } — draw level lo at alpha 1 − f and hi at alpha f.
  function levelPair(blur, out) {
    let lo = 0;
    while (lo < LEVELS.length - 1 && blur >= LEVELS[lo + 1]) lo++;
    if (lo === LEVELS.length - 1) { out.lo = lo; out.hi = lo; out.f = 0; return out; }
    out.lo = lo; out.hi = lo + 1;
    out.f = (blur - LEVELS[lo]) / (LEVELS[lo + 1] - LEVELS[lo]);
    return out;
  }

  // Draws one styled glyph centred at (x, y) with the context's font already set at F px per em. The direct path calls
  // it with F = em (du) under the glyph's transform; sprites call it with F = raster px. ink2 is the style's second ink:
  // outline → the fill inside the stroke, shadow → the shadow, duo → the offset copy.
  function paintStyled(g, ch, F, ink, style, ink2, x, y) {
    if (style === 'outline') {
      g.fillStyle = ink2 || ink;
      g.fillText(ch, x, y);
      g.lineWidth = OUTLINE_WIDTH * F;
      g.lineJoin = 'round';
      g.strokeStyle = ink;
      g.strokeText(ch, x, y);
      return;
    }
    if (style === 'shadow' && ink2) {
      g.fillStyle = ink2;
      g.fillText(ch, x + SHADOW_OFFSET[0] * F, y + SHADOW_OFFSET[1] * F);
    } else if (style === 'duo' && ink2) {
      g.fillStyle = ink2;
      g.fillText(ch, x + DUO_OFFSET[0] * F, y + DUO_OFFSET[1] * F);
    }
    g.fillStyle = ink;
    g.fillText(ch, x, y);
  }

  function round3(v) { return Math.round(v * 1000) / 1000; }

  // Whether this context applies ctx.filter blurs (Chrome does; some engines ignore the property).
  function filterWorks(g) {
    if (g.filter === undefined) return false;
    const before = g.filter;
    g.filter = 'blur(1px)';
    const ok = g.filter === 'blur(1px)';
    g.filter = before;
    return ok;
  }

  // The blur of a blurred sprite in 1/BLUR_STEPS raster px: level (du) × raster px per du. It is part of the sprite
  // key, and the raster is drawn with exactly this quantized blur, so a raster is a function of its key alone: two
  // glyphs of the same grapheme and bucket but different em (du) never share a raster that only suits one of them.
  function blurStepsOf(level, k, emDu) {
    if (level === 0) return 0;
    const px = (LEVELS[level] * bucketPx(k)) / (emDu > 1e-6 ? emDu : 1e-6);
    const q = Math.round(px * BLUR_STEPS);
    return q < BLUR_CODES ? q : BLUR_CODES - 1;
  }

  // inkRect(box, F, style, blurPx, side) → { x, y, w, h } | null: the part of a side × side glyph raster (the glyph drawn
  // at its centre, F px per em) that its blurred ink can reach. box = the host's inkBox of the grapheme at F px
  // ({ left, right, ascent, descent } from the draw point, measureText's actual bounding box); widened by half the
  // outline, extended by the shadow or duo offset, padded by 3 blur standard deviations + 2 px (the blur's reach and the
  // edge antialiasing), in whole px and clamped to the raster. Null without a box, or when the rect would be the whole
  // raster. Outside the rect the whole raster holds nothing but transparency (tests/browser/glyph_parity.py checks
  // it, and the rect's border too).
  const INK_PAD_SIGMA = 3;
  const INK_PAD_PX = 2;
  function inkRect(box, F, style, blurPx, side) {
    if (!box || !Number.isFinite(box.left) || !Number.isFinite(box.right) || !Number.isFinite(box.ascent) ||
      !Number.isFinite(box.descent) || !(side > 0)) return null;
    const c = side / 2;
    let x0 = c - box.left, x1 = c + box.right, y0 = c - box.ascent, y1 = c + box.descent;
    if (style === 'outline') {
      const o = (OUTLINE_WIDTH * F) / 2;
      x0 -= o; x1 += o; y0 -= o; y1 += o;
    } else if (style === 'shadow') {
      x1 += SHADOW_OFFSET[0] * F; y1 += SHADOW_OFFSET[1] * F;
    } else if (style === 'duo') {
      x1 += DUO_OFFSET[0] * F; y1 += DUO_OFFSET[1] * F;
    }
    const pad = INK_PAD_SIGMA * Math.max(0, blurPx) + INK_PAD_PX;
    const clampPx = (v) => (v < 0 ? 0 : v > side ? side : v);
    const ix = clampPx(Math.floor(Math.min(x0, x1) - pad)), iy = clampPx(Math.floor(Math.min(y0, y1) - pad));
    const ix1 = clampPx(Math.ceil(Math.max(x0, x1) + pad)), iy1 = clampPx(Math.ceil(Math.max(y0, y1) + pad));
    if (ix1 <= ix || iy1 <= iy) return null;
    if (ix === 0 && iy === 0 && ix1 === side && iy1 === side) return null;
    return { x: ix, y: iy, w: ix1 - ix, h: iy1 - iy };
  }

  // Descends one level of the nested key maps, creating it when missing (only on a cache miss).
  function child(map, key) {
    let m = map.get(key);
    if (!m) { m = new Map(); map.set(key, m); }
    return m;
  }

  // createSpriteCache(factory, { budget }) → { glyph, particle, setBudget, clear, bytes, count, made, madeBytes, beginSpan,
  // spanBytes }. A span counts the bytes of the distinct sprites used (found or made) since beginSpan(): the working set
  // of a warm-up, which must stay below the budget or the LRU drops the sprites it made first.
  // LRU by bytes. Keys are nested maps (font → grapheme → ink → second ink → numeric code; particle record → ink →
  // bucket): a hit allocates nothing, and no unbounded id is packed into a fixed-width number.
  function createSpriteCache(factory, opts) {
    let budget = (opts && opts.budget) || BUDGET;
    let bytes = 0, count = 0;
    let made = 0, madeBytes = 0;                 // rasters (and their bytes) made since the cache was created
    let span = 0, spanBytes = 0;
    const lru = new Map();                       // entry → true, oldest first
    let byFont = new WeakMap();                  // FontRef → Map(grapheme → Map(ink → Map(ink2 → Map(code → entry))))
    let byRec = new WeakMap();                   // particle record → Map(ink → Map(bucket → entry))
    let blurOk = null;
    let scratch = null;

    function inSpan(e) { if (e.span !== span) { e.span = span; spanBytes += e.bytes; } }

    function touch(e) { lru.delete(e); lru.set(e, true); inSpan(e); }

    // chain = [map0, key0, map1, key1, …, leaf]: the maps above the entry, so an eviction can drop emptied levels.
    function remember(chain, code, e) {
      const leaf = chain[chain.length - 1];
      e.chain = chain; e.code = code;
      leaf.set(code, e);
      lru.set(e, true);
      bytes += e.bytes; count++; made++; madeBytes += e.bytes;
      inSpan(e);
      evict();
      return e;
    }

    function forget(e) {
      const c = e.chain;
      let m = c[c.length - 1];
      m.delete(e.code);
      for (let j = c.length - 3; j >= 0 && m.size === 0; j -= 2) { c[j].delete(c[j + 1]); m = c[j]; }
    }

    function evict() {
      if (bytes <= budget) return;
      for (const e of lru.keys()) {
        if (bytes <= budget || count <= 1) break;
        lru.delete(e);
        forget(e);
        bytes -= e.bytes; count--;
      }
    }

    function canvasOf(w, h) { return factory.create(w, h, { alpha: true }); }

    // A host factory's settle(canvas) rasterizes a new sprite now (engine/host/canvas), so a sprite made while the
    // engine prepares is not painted inside the first frame that draws it. The recording factory has none.
    function settled(e) {
      if (typeof factory.settle === 'function') factory.settle(e.canvas);
      return e;
    }

    // A blurred draw: ctx.filter when it works, else the glyph drawn small and scaled up (a soft stand-in).
    function blurredDraw(ctx, side, blurPx, paint) {
      if (blurOk === null) blurOk = filterWorks(ctx);
      if (blurOk) {
        ctx.filter = 'blur(' + round3(blurPx) + 'px)';
        paint(ctx);
        ctx.filter = 'none';
        return;
      }
      const d = Math.max(1, blurPx / 1.5);
      const small = Math.max(2, Math.ceil(side / d));
      if (!scratch || scratch.canvas.width < small || scratch.canvas.height < small) {
        scratch = canvasOf(Math.max(64, small), Math.max(64, small));
      }
      const s = scratch.ctx;
      s.setTransform(1, 0, 0, 1, 0, 0);
      s.clearRect(0, 0, small, small);
      s.setTransform(1 / d, 0, 0, 1 / d, 0, 0);
      paint(s);
      s.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(scratch.canvas, 0, 0, small, small, 0, 0, small * d, small * d);
    }

    // Level-0 sprites are rasterized at twice their bucket (within MAX_SIDE): drawn back at the glyph's subpixel position,
    // they then match the direct path's edges closely (§4.19.5 parity). Blurred levels need no extra detail: a raster
    // whose blur is wider than BLUR_RASTER_PX is made smaller (a Gaussian that wide holds nothing finer than the grid,
    // so drawing it scaled up shows the same picture) — a 32 du blur of a large glyph takes kilobytes, not a megabyte.
    // On a host factory that measures ink (inkBox) the entry keeps `ink`, the rect of the raster its ink can reach
    // (inkRect: 2 px round the ink at level 0; 3 blur standard deviations + 2 px when blurred, only where ctx.filter
    // blurs, since the small-and-scaled stand-in spreads differently): draw.spriteAt clips a draw that scales the raster
    // up to it. The raster itself is made and kept whole, exactly as without inkBox, so its texels never change.
    // Whether an entry has `ink` depends only on its key and the factory, never on the cache's history.
    function rasterGlyph(font, ch, ink, style, ink2, k, level, steps) {
      const F0 = bucketPx(k) * (level === 0 ? LEVEL0_SUPERSAMPLE : 1);
      const blur0 = steps / BLUR_STEPS;
      const need = BOX_EM * F0 + 2 * (BLUR_REACH * blur0 + 2);
      const r = Math.min(need > MAX_SIDE ? MAX_SIDE / need : 1, blur0 > BLUR_RASTER_PX ? BLUR_RASTER_PX / blur0 : 1);
      const F = F0 * r, blurPx = blur0 * r;
      let side = Math.ceil(BOX_EM * F + 2 * (BLUR_REACH * blurPx + 2));
      side += side & 1;
      if (side > MAX_SIDE) side = MAX_SIDE;
      const made = canvasOf(side, side);
      const c = side / 2;
      const css = font.css(F);
      const paint = (ctx) => {
        ctx.font = css;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        paintStyled(ctx, ch, F, ink, style, ink2, c, c);
      };
      if (blurPx > 0.01) blurredDraw(made.ctx, side, blurPx, paint);
      else paint(made.ctx);
      let rect = null;
      if (typeof factory.inkBox === 'function' && (blurPx <= 0.01 || blurOk)) {    // (blurredDraw has probed blurOk)
        rect = inkRect(factory.inkBox(css, ch), F, style, blurPx > 0.01 ? blurPx : 0, side);
      }
      return { canvas: made.canvas, w: side, h: side, cx: c, cy: c, F, bytes: side * side * 4, ink: rect, chain: null, code: 0,
        span: -1 };
    }

    // glyph(font, ch, ink, style, ink2, k, level, emDu) → { canvas, w, h, cx, cy, F, ink } with F = raster px per em and
    // ink = null, or on a host with inkBox the rect { x, y, w, h } of the raster outside which it is transparent
    // (inkRect; draw.spriteAt clips the draws that scale it up to it).
    // Key (§4.19.5): font, grapheme, ink, second ink, bucket k, blur level, style, and for blurred levels the blur in
    // raster px (it depends on the glyph's em in du).
    function glyph(font, ch, ink, style, ink2, k, level, emDu) {
      let chars = byFont.get(font);
      if (!chars) { chars = new Map(); byFont.set(font, chars); }
      const inks = child(chars, ch), seconds = child(inks, ink), second = ink2 || '', leaf = child(seconds, second);
      const steps = blurStepsOf(level, k, emDu);
      const code = ((k * 8 + level) * 8 + (STYLE_INDEX[style] || 0)) * BLUR_CODES + steps;
      const hit = leaf.get(code);
      if (hit) { touch(hit); return hit; }
      return remember([chars, ch, inks, ink, seconds, second, leaf], code,
        settled(rasterGlyph(font, ch, ink, style, ink2, k, level, steps)));
    }

    // The extent of one particle shape in its unit space (1 unit = the particle's size in du).
    function particleBox(sprite) {
      if (B.isShape(sprite)) return B.shapeBounds(sprite);
      if (typeof sprite === 'string' && sprite.startsWith('glyph:')) return [-0.8, -0.8, 0.8, 0.8];
      return [-0.5, -0.5, 0.5, 0.5];
    }

    function rasterParticle(rec, ink, k, font) {
      const box = particleBox(rec.sprite);
      const F0 = bucketPx(k);
      const bw = Math.max(1e-3, box[2] - box[0]), bh = Math.max(1e-3, box[3] - box[1]);
      const r = Math.max(bw, bh) * F0 + 4 > MAX_SIDE ? (MAX_SIDE - 4) / (Math.max(bw, bh) * F0) : 1;
      const F = F0 * r;
      const w = Math.ceil(bw * F) + 4, h = Math.ceil(bh * F) + 4;
      const made = canvasOf(w, h);
      const g = made.ctx;
      const cx = 2 - box[0] * F, cy = 2 - box[1] * F;
      g.setTransform(F, 0, 0, F, cx, cy);
      g.fillStyle = ink;
      if (B.isShape(rec.sprite)) { B.replayShape(g, rec.sprite); g.fill(); }
      else if (typeof rec.sprite === 'string' && rec.sprite.startsWith('glyph:')) {
        g.setTransform(1, 0, 0, 1, cx, cy);
        g.font = font ? font.css(F) : Math.round(F) + 'px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(rec.sprite.slice(6), 0, 0);
      } else g.fillRect(-0.5, -0.5, 1, 1);
      g.setTransform(1, 0, 0, 1, 0, 0);
      return { canvas: made.canvas, w, h, cx, cy, F, bytes: w * h * 4, chain: null, code: 0, span: -1 };
    }

    // particle(rec, ink, k, font) → { canvas, w, h, cx, cy, F } with F = raster px per particle unit.
    function particle(rec, ink, k, font) {
      let inks = byRec.get(rec);
      if (!inks) { inks = new Map(); byRec.set(rec, inks); }
      const leaf = child(inks, ink);
      const hit = leaf.get(k);
      if (hit) { touch(hit); return hit; }
      return remember([inks, ink, leaf], k, settled(rasterParticle(rec, ink, k, font)));
    }

    function clear() {
      lru.clear();
      byFont = new WeakMap();
      byRec = new WeakMap();
      bytes = 0; count = 0;
    }

    return {
      glyph, particle, clear,
      setBudget(b) { budget = b > 0 ? b : BUDGET; evict(); },
      get budget() { return budget; },
      get bytes() { return bytes; },
      get count() { return count; },
      get made() { return made; },
      get madeBytes() { return madeBytes; },
      beginSpan() { span++; spanBytes = 0; },
      get spanBytes() { return spanBytes; },
    };
  }

  return {
    LEVELS, DIRECT_BLUR, MAX_SIDE, BOX_EM, BLUR_REACH, BUDGET, BUDGET_SHARED, STYLES, OUTLINE_WIDTH, SHADOW_OFFSET, DUO_OFFSET, BLUR_STEPS,
    bucketOf, bucketPx, levelPair, blurStepsOf, paintStyled, createSpriteCache, inkRect,
  };
});
