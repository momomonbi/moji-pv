/* 文字PVメーカー v2 — original work. Drawing an evaluated scene layer: glyphs on the direct or sprite path, shapes, paints, particles, images, picks (DESIGN §4.19.5–7). */
MV.def('engine/render/draw', ['core/color', 'core/mat', 'engine/scene/table', 'engine/render/sprites', 'engine/render/shapes'],
(C, MAT, T, SP, SH) => {
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

  // createDrawContext({ sprites, paints, scratch }) → dc, mutated per frame by the renderer:
  //   g (current target), D (device matrix), pal, W, H, scale (device px per du), q (paint helpers), assets, pick,
  //   glyphPath ('auto' | 'sprite' | 'direct'), probe ({ blur, glow, shard, pixel } added to glyph poses; lab only),
  //   face (FontRef for glyph particles), counts { glyphs, shapes, paints, particles }
  function createDrawContext(o) {
    return {
      g: null, D: new Float32Array([1, 0, 0, 1, 0, 0]), pal: null, W: 0, H: 0, scale: 1, q: null, assets: null,
      pick: null, glyphPath: 'auto', probe: null, face: null, sprites: o.sprites, paints: o.paints, scratch: o.scratch,
      counts: { glyphs: 0, shapes: 0, paints: 0, particles: 0 },
      font: null, pair: { lo: 0, hi: 0, f: 0 },
      VD: new Float32Array(6), VW: new Float32Array(6), M: new Float32Array(6), W6: new Float32Array(6),
      RM: new Float32Array(6), quad: new Float32Array(8),
    };
  }

  function resetCounts(dc) { const c = dc.counts; c.glyphs = 0; c.shapes = 0; c.paints = 0; c.particles = 0; }

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

  function spriteAt(g, sp, e, alpha) {
    g.globalAlpha = alpha;
    g.drawImage(sp.canvas, -sp.cx * e, -sp.cy * e, sp.w * e, sp.h * e);
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
    if (pr.f < 1) spriteAt(g, lo, rec.em / lo.F, alpha * (1 - pr.f));
    if (hi) spriteAt(g, hi, rec.em / hi.F, alpha * pr.f);
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
    spriteAt(g, gl, rec.em / gl.F, alpha * (glow > 1 ? 1 : glow));
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
      const VW = MAT.mul(dc.VW, view, worldInto(dc.W6, t, i));
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
        if (!still || !dc.paints.draw(g, rec, M, alpha, dc.q, dc.W, dc.H, dc.scale, dc.paintKey)) {
          SH.drawPaint(g, rec, M, alpha, rec.animated === false ? 0 : tl, dc.q);
        }
        dc.font = null;
        dc.counts.paints++;
      } else if (type === TYPE.particles) {
        const rec = stores.particles[t.payload[i]];
        dc.counts.particles += SH.drawParticles(g, rec, M, alpha, tl, inkOf(pal, rec.ink), dc.sprites, dc.face);
      } else if (type === TYPE.image) {
        const rec = stores.image[t.payload[i]];
        if (SH.drawImage(g, rec, M, alpha, dc.assets)) {
          const b = rec.box;
          pickNode(dc, scene, i, VW, cutIndex, b.x, b.y, b.x + b.w, b.y + b.h);
        }
      }
    }
    if (clipRun >= 0) { g.restore(); dc.font = null; }
    g.globalAlpha = 1;
  }

  // warmLayer(dc, scene, L, view) → glyphs visited: the sprite lookups drawLayer would make for the glyphs of one layer
  // (the same keys: size bucket from the full transform with pose scale and camera zoom, blur level pair, flip-shaded
  // ink, halo, echo and tint inks, level 0 for pixel and shard), without drawing. Missing sprites are rasterized now.
  function warmLayer(dc, scene, L, view) {
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
        if (drawGlyph(dc, scene, i, MAT.mul(dc.M, dc.D, VW))) n++;
      }
    } finally {
      dc.g = g0;
    }
    return n;
  }

  return { createDrawContext, resetCounts, drawLayer, warmLayer, drawGlyph, hasLayer, nodesByLayer, inkOf, secondInk, shaded, cssOf,
    clipReveal, STYLE_GLOW, GLOW_LEVEL };
});
