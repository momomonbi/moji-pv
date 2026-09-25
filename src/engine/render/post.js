/* 文字PVメーカー v2 — original work. Post stack: the FxContext, texture tiles, blurs and the ordered screen-effect passes (DESIGN §4.18.11, §4.19.2). */
MV.def('engine/render/post', ['core/hash', 'core/rng', 'core/noise', 'core/schema', 'engine/scene/frame'],
(H, RNG, NZ, SCH, F) => {
  'use strict';

  const STAGES = Object.freeze(['shape', 'tone', 'light', 'optic', 'film']);
  const STAGE_INDEX = Object.freeze({ shape: 0, tone: 1, light: 2, optic: 3, film: 4 });
  const CHANNEL = Object.freeze({ r: '#FF0000', g: '#00FF00', b: '#0000FF', c: '#00FFFF', m: '#FF00FF', y: '#FFFF00' });
  const TEXT_AT_MAX = 3;               // fx.textAt calls per frame (§7.4)
  const TILE = 128;                    // texture tiles are 128 × 128 px and wrap seamlessly
  const TILE_VARIANTS = 24;
  const TILE_NAMES = Object.freeze(['grain', 'halftone', 'scan', 'dust', 'fiber']);
  const LAYER_MAX = 4;                 // cached frame-sized layers (fx.layer), least recently used dropped first
  const LAYER_BUDGET = 64 * 1024 * 1024;   // … and their bytes (one 2160p 21:9 layer is 44 MB)
  const WHEN_FADE = 0.2;               // 'arrive' / 'depart' filters fade over 0.2 s past their window
  const BEAT_DECAY = 0.15;             // 'beat' filters pulse and decay over ~0.15 s
  const IMPACT_DECAY = 0.6;
  const FALLBACK_BEAT = 0.5;           // without a beat grid, 'beat' filters pulse every 0.5 s from the cut start
  const HALF_COST = 3;                 // adaptive preview: filters with cost ≥ 3 run at half resolution (level ≥ 1)
  const SKIP_COST = 4;                 // … and filters with cost ≥ 4 are skipped (level ≥ 4)

  class FxError extends Error {
    constructor(code, message) { super(message); this.name = 'FxError'; this.code = code; }
  }

  // --- blur (the only place besides sprites where the engine sets ctx.filter) --------------------------------------

  // Whether a context applies ctx.filter blurs (Chrome does; some engines ignore the property). Probed once per renderer
  // (caps = { filter: null | boolean }), never per module, so a frame's calls do not depend on what ran before it.
  function filterWorks(g, caps) {
    if (caps && caps.filter !== null && caps.filter !== undefined) return caps.filter;
    let ok = false;
    if (g.filter !== undefined) {
      const before = g.filter;
      g.filter = 'blur(1px)';
      ok = g.filter === 'blur(1px)';
      g.filter = before;
    }
    if (caps) caps.filter = ok;
    return ok;
  }

  // blurred(pool, src, px, caps) → a new frame-sized surface: src blurred by px (device px, standard deviation),
  // computed on downscaled surfaces (½ per side below 8 px, ¼ above) so the cost stays small at any output size.
  function blurred(pool, src, px, caps) {
    const f = px >= 8 ? 4 : 2;
    const w = Math.max(1, Math.ceil(src.w / f)), h = Math.max(1, Math.ceil(src.h / f));
    const a = pool.take(w, h), b = pool.take(w, h);
    a.ctx.drawImage(src.canvas, 0, 0, w, h);
    const r = Math.round((Math.max(0, px) / f) * 1000) / 1000;
    if (filterWorks(b.ctx, caps)) {
      b.ctx.filter = 'blur(' + r + 'px)';
      b.ctx.drawImage(a.canvas, 0, 0);
      b.ctx.filter = 'none';
    } else {
      const d = Math.max(1, Math.ceil(r));        // no ctx.filter: one more downscale step stands in for the blur
      const sw = Math.max(1, Math.ceil(w / d)), sh = Math.max(1, Math.ceil(h / d));
      b.ctx.drawImage(a.canvas, 0, 0, w, h, 0, 0, sw, sh);
      a.ctx.clearRect(0, 0, w, h);
      a.ctx.drawImage(b.canvas, 0, 0, sw, sh, 0, 0, w, h);
      b.ctx.clearRect(0, 0, w, h);
      b.ctx.drawImage(a.canvas, 0, 0);
    }
    const out = pool.take(src.w, src.h);
    out.ctx.drawImage(b.canvas, 0, 0, w, h, 0, 0, src.w, src.h);
    pool.give(a); pool.give(b);
    return out;
  }

  // src × a pure colour, then destination-in src (keeps the alpha): one channel (or complement) of the frame.
  function isolate(pool, src, ch) {
    const colour = CHANNEL[ch];
    if (!colour) throw new FxError('bad-channel', 'isolate needs r g b c m or y');
    const s = pool.take(src.w, src.h), g = s.ctx;
    g.drawImage(src.canvas, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = colour;
    g.fillRect(0, 0, s.w, s.h);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(src.canvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
    return s;
  }

  // --- texture tiles -------------------------------------------------------------------------------------------------

  // createTileBank(factory) → { tile(name, seed) → CanvasImageSource, layer(key, w, h, paint), clear() }. Each name has
  // one 128 px base tile drawn once with plain Ctx2D calls from core/noise; a seed selects a wrapped offset of it (LRU of
  // 24 variants), so a tile that changes on fx.tick costs four drawImage calls, not a new texture.
  function createTileBank(factory) {
    const bases = new Map();
    const variants = new Map();
    const layers = new Map();          // 'key\0wxh' → { canvas, bytes }, least recently used first
    let layerBytes = 0;

    function canvas() { return factory.create(TILE, TILE, { alpha: true }); }

    function grain(g) {
      const px = NZ.tile(H.hash32('tile', 'grain'), TILE);
      for (let level = 0; level < 16; level++) {
        const v = 8 + level * 16;
        g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
        for (let i = 0; i < px.length; i++) if (px[i] >> 4 === level) g.fillRect(i % TILE, (i / TILE) | 0, 1, 1);
      }
    }

    function halftone(g) {
      g.fillStyle = '#FFFFFF';
      g.fillRect(0, 0, TILE, TILE);
      g.fillStyle = '#000000';
      for (let y = 0; y < TILE; y += 8) {
        for (let x = 0; x < TILE; x += 8) {
          g.beginPath();
          g.arc(x + 4 + ((y / 8) % 2) * 4, y + 4, 2.2, 0, 2 * Math.PI);
          g.fill();
        }
      }
      g.beginPath();
      for (let y = 0; y < TILE; y += 16) g.arc(0, y + 12, 2.2, 0, 2 * Math.PI);
      g.fill();
    }

    function scan(g) {
      g.fillStyle = 'rgba(0,0,0,0.55)';
      for (let y = 0; y < TILE; y += 3) g.fillRect(0, y, TILE, 1);
    }

    // Draws fn at the 9 wrapped copies needed for a seamless tile.
    function wrapped(g, fn) {
      for (let oy = -TILE; oy <= TILE; oy += TILE) for (let ox = -TILE; ox <= TILE; ox += TILE) fn(ox, oy);
    }

    function dust(g) {
      const r = RNG.stream('tile', 'dust');
      for (let k = 0; k < 42; k++) {
        const x = r.range(0, TILE), y = r.range(0, TILE), s = r.range(0.4, 1.6), light = r.chance(0.6);
        g.fillStyle = light ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)';
        wrapped(g, (ox, oy) => { g.beginPath(); g.arc(x + ox, y + oy, s, 0, 2 * Math.PI); g.fill(); });
      }
    }

    function fiber(g) {
      const r = RNG.stream('tile', 'fiber');
      g.lineCap = 'round';
      for (let k = 0; k < 36; k++) {
        const x = r.range(0, TILE), y = r.range(0, TILE), a = r.range(0, Math.PI), len = r.range(10, 34), bend = r.range(-8, 8);
        const dx = Math.cos(a) * len, dy = Math.sin(a) * len;
        g.strokeStyle = r.chance(0.7) ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.25)';
        g.lineWidth = r.range(0.4, 1.2);
        wrapped(g, (ox, oy) => {
          g.beginPath();
          g.moveTo(x + ox, y + oy);
          g.quadraticCurveTo(x + ox + dx / 2 - dy * bend / len, y + oy + dy / 2 + dx * bend / len, x + ox + dx, y + oy + dy);
          g.stroke();
        });
      }
    }

    const PAINTERS = { grain, halftone, scan, dust, fiber };

    function base(name) {
      let b = bases.get(name);
      if (b) return b;
      b = canvas();
      PAINTERS[name](b.ctx);
      bases.set(name, b);
      return b;
    }

    function tile(name, seed) {
      if (!PAINTERS[name]) throw new FxError('bad-tile', 'tile name must be one of ' + TILE_NAMES.join(' '));
      const s = Number.isFinite(seed) ? Math.floor(seed) : 0;
      let byName = variants.get(name);
      if (!byName) { byName = new Map(); variants.set(name, byName); }
      const hit = byName.get(s);
      if (hit) { byName.delete(s); byName.set(s, hit); return hit.canvas; }
      const b = base(name);
      const h = H.hash32('tile', name, s);
      const ox = h % TILE, oy = (h >>> 8) % TILE;
      let v = null;
      if (byName.size >= TILE_VARIANTS) { const old = byName.keys().next().value; v = byName.get(old); byName.delete(old); }
      if (!v) v = canvas();
      const g = v.ctx;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, TILE, TILE);
      g.drawImage(b.canvas, -ox, -oy);
      g.drawImage(b.canvas, TILE - ox, -oy);
      g.drawImage(b.canvas, -ox, TILE - oy);
      g.drawImage(b.canvas, TILE - ox, TILE - oy);
      byName.set(s, v);
      return v.canvas;
    }

    // layer(key, w, h, paint) → a w × h CanvasImageSource painted once by paint(ctx, w, h) on a new (clear, default
    // state) canvas and kept for later calls with the same key and size (LRU, LAYER_MAX layers within LAYER_BUDGET); null
    // when one layer alone would exceed the budget. The key names everything paint draws besides the size, so a kept
    // layer and a new one hold the same pixels: the cache only saves time (§7.1).
    function layer(key, w, h, paint) {
      const id = key + '\u0000' + w + 'x' + h;
      const hit = layers.get(id);
      if (hit) { layers.delete(id); layers.set(id, hit); return hit.canvas; }
      const bytes = w * h * 4;
      if (bytes > LAYER_BUDGET) return null;
      for (const [old, e] of layers) {
        if (layers.size < LAYER_MAX && layerBytes + bytes <= LAYER_BUDGET) break;
        layers.delete(old);
        layerBytes -= e.bytes;
      }
      const made = factory.create(w, h, { alpha: true });
      paint(made.ctx, w, h);
      layers.set(id, { canvas: made.canvas, bytes });
      layerBytes += bytes;
      return made.canvas;
    }

    return { tile, layer, clear() { bases.clear(); variants.clear(); layers.clear(); layerBytes = 0; } };
  }

  // --- the FxContext ---------------------------------------------------------------------------------------------------

  // createFx({ pool, tiles }) → the §4.18.11 FxContext, one per renderer. frame(o) sets the per-frame fields; use(seed,
  // cut, allowTextAt) prepares one filter or seam call. fx.cut is null for the work-level texture.
  function createFx(o) {
    const pool = o.pool, tiles = o.tiles;
    const caps = { filter: null };
    const st = { plan: null, seed: 0, allowTextAt: false, textAt: null, textCalls: 0, flashScale: 1,
      beat: { index: 0, phase: 0, since: 0, bar: 0 } };
    // Additive to the FROZEN §4.18.11 FxContext: `pal`, the frame palette after the backdrop rule (§4.19.4), the one the
    // paints draw with (duoTone maps the frame to its ground and accent); `flashScale`, the preview's reduce-flash
    // factor (0.3 with 点滅を抑える, 1 in export), which impulse('flash') already carries and parts apply to the flashes
    // they make themselves (flashPop, invertBlink, whiteFlash); `backdrop`, the frame's backdrop mode ('scene' |
    // 'chroma' | 'black' | 'clear', §4.19.4), so a part can adapt without testing the ground colour; `layer(key, paint)`,
    // a frame-sized picture that is the same on every frame (edgeShade's vignette) painted once per key and frame size
    // by paint(ctx, w, h) and kept (tile bank), so a costly full-frame paint becomes one drawImage. Too large to keep, it
    // is painted into a frame surface that the frame's pool.end() takes back.
    const fx = {
      w: 0, h: 0, unit: 1, quality: 'preview', alpha: false, cut: null, pal: null, flashScale: 1, backdrop: 'scene',
      take: () => pool.take(fx.w, fx.h),
      give: (s) => pool.give(s),
      isolate: (src, ch) => isolate(pool, src, ch),
      blurred: (src, px) => blurred(pool, src, px, caps),
      impulse: (kind, t) => (st.plan ? F.impulseAt(st.plan, kind, t) * (kind === 'flash' ? st.flashScale : 1) : 0),
      beat: (t) => (st.plan ? F.beatAt(st.plan, t, st.beat) : null),
      level: (t) => (st.plan ? F.levelAt(st.plan, t) : 0.5),
      tick: F.tick,
      rng: (...labels) => RNG.stream(st.seed, ...labels),
      noise: (x) => NZ.noise1(st.seed, x),
      tile: (name, seed) => tiles.tile(name, seed),
      layer(key, paint) {
        const kept = tiles.layer(String(key), fx.w, fx.h, paint);
        if (kept) return kept;
        const s = pool.take(fx.w, fx.h);
        paint(s.ctx, fx.w, fx.h);
        return s.canvas;
      },
      textAt(dt) {
        if (!st.allowTextAt) throw new FxError('no-text-at', "fx.textAt needs needs: ['textAt'] on the filter");
        if (++st.textCalls > TEXT_AT_MAX) throw new FxError('text-at-budget', 'fx.textAt may be called at most 3 times per frame');
        return st.textAt ? st.textAt(dt) : fx.take();
      },
    };
    const control = {
      fx, caps,
      frame(f) {
        st.plan = f.plan; st.textAt = f.textAt || null; st.textCalls = 0; st.flashScale = f.flashScale === undefined ? 1 : f.flashScale;
        fx.w = f.w; fx.h = f.h; fx.unit = f.unit; fx.quality = f.quality; fx.alpha = !!f.alpha; fx.cut = null;
        fx.pal = f.pal || null; fx.flashScale = st.flashScale; fx.backdrop = f.backdrop || (f.alpha ? 'clear' : 'scene');
      },
      size(w, h, unit) { fx.w = w; fx.h = h; fx.unit = unit; },
      use(seed, cut, allowTextAt) { st.seed = seed >>> 0; fx.cut = cut; st.allowTextAt = !!allowTextAt; },
    };
    return control;
  }

  // --- parameters (plans normally carry every param; hand-made plans may not) ---------------------------------------

  const completed = new WeakMap();

  // paramsFor(registry, def, decision, seed, ax) → the decision's params plus autos for any param it lacks (cached per
  // decision object).
  function paramsFor(registry, def, decision, seed, ax) {
    const hit = decision && completed.get(decision);
    if (hit && hit.def === def) return hit.p;
    const given = (decision && decision.p) || {};
    const out = Object.assign({}, given);
    const list = registry.params ? registry.params(def.kind, def.key) : [];
    for (const { name, spec } of list || []) {
      if (out[name] !== undefined) continue;
      out[name] = SCH.autoValue(spec, { f: ax.f || {}, look: ax.look, rng: RNG.stream(seed, 'param', name) });
    }
    if (decision && typeof decision === 'object') completed.set(decision, { def, p: out });
    return out;
  }

  // --- 'when' (the shared filter param): how strongly an accent filter acts at cut-local time tl --------------------

  // 'arrive' is full until the entrance rests, and at least until the sung start (tl 0): an instant entrance rests at
  // a − t0 < 0, which left only 40 % at the sung start. 'depart' is full from the exit's start, and at the latest from
  // the sung end (cutInfo.dur): a cut holds the screen effects only until the next one starts, so an exit a seam
  // replaced (times.out = b) never raised it before.
  function whenWeight(when, tl, t, times, cutInfo, fxBeat) {
    switch (when) {
      case 'arrive': {
        const rest = times ? Math.max(times.rest, 0) : 0;
        if (!times || tl <= rest) return 1;
        return Math.max(0, 1 - (tl - rest) / WHEN_FADE);
      }
      case 'depart': {
        const dur = cutInfo && Number.isFinite(cutInfo.dur) ? cutInfo.dur : Infinity;
        const out = times ? Math.min(times.out, dur) : 0;
        if (!times || tl >= out) return 1;
        return Math.max(0, 1 - (out - tl) / WHEN_FADE);
      }
      case 'beat': {
        const b = fxBeat(t);
        const since = b ? b.since : ((tl % FALLBACK_BEAT) + FALLBACK_BEAT) % FALLBACK_BEAT;
        return Math.exp(-since / BEAT_DECAY);
      }
      case 'impact':
        if (!cutInfo || !cutInfo.impact) return 0;
        return tl < 0 ? Math.max(0, 1 + tl / 0.08) : Math.exp(-tl / IMPACT_DECAY);
      default:
        return 1;
    }
  }

  // --- the stack -------------------------------------------------------------------------------------------------------

  // Entry = { def, p, seed, cut: { tl, dur, impact, energy } | null, times, tl, order, key, slot } — pooled by the renderer.
  function byStage(a, b) {
    return (STAGE_INDEX[a.def.stage] || 0) - (STAGE_INDEX[b.def.stage] || 0) || a.order - b.order
      || (a.def.key < b.def.key ? -1 : a.def.key > b.def.key ? 1 : 0) || (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0);
  }

  // Stage order (shape → tone → light → optic → film), the work texture before accents of its stage, then key and slot.
  function sortEntries(list) { return list.sort(byStage); }

  // One reused params object per decision params object: the 'when' weight scales `amount` without a new object.
  const scratchParams = new WeakMap();
  function pooledParams(p) {
    let out = scratchParams.get(p);
    if (!out) { out = Object.assign({}, p); scratchParams.set(p, out); }
    return out;
  }

  // run(ctl, pool, src, list, t, level, onError) → { out, passes }: each filter's apply(fx, src, p, t) in order,
  // ping-ponging pooled surfaces. level = the adaptive preview level (0 in export). A filter that throws is skipped and
  // reported through onError(entry, error).
  function run(ctl, pool, src, list, t, level, onError) {
    const fx = ctl.fx;
    const fullW = fx.w, fullH = fx.h, unit = fx.unit;
    let cur = src, passes = 0;
    for (let k = 0; k < list.length; k++) {
      const e = list[k];
      const cost = e.def.cost || 1;
      if (level >= 4 && cost >= SKIP_COST) continue;
      const w = e.cut ? whenWeight(e.p.when, e.tl, t, e.times, e.cut, fx.beat) : 1;
      if (!(w > 0)) continue;
      const p = pooledParams(e.p);
      if (typeof e.p.amount === 'number') p.amount = e.p.amount * w;
      ctl.use(e.seed, e.cut, (e.def.needs || []).includes('textAt'));
      const half = level >= 1 && cost >= HALF_COST;
      try {
        let input = cur;
        if (half) {
          ctl.size(Math.max(1, Math.ceil(fullW / 2)), Math.max(1, Math.ceil(fullH / 2)), unit / 2);
          input = pool.take(fx.w, fx.h);
          input.ctx.drawImage(cur.canvas, 0, 0, fx.w, fx.h);
        }
        let out = e.def.apply(fx, input, p, t);
        if (!out || !out.canvas) throw new FxError('bad-result', 'apply() must return a Surface');
        if (half) {
          ctl.size(fullW, fullH, unit);
          if (out === input) out = cur;
          else {
            const up = pool.take(fullW, fullH);
            up.ctx.drawImage(out.canvas, 0, 0, out.w, out.h, 0, 0, fullW, fullH);
            pool.give(out);
            out = up;
          }
          pool.give(input);
        }
        if (out !== cur) { if (cur !== src) pool.give(cur); cur = out; }
        passes += e.def.passes || 1;
      } catch (err) {
        ctl.size(fullW, fullH, unit);
        if (onError) onError(e, err);
      }
    }
    return { out: cur, passes };
  }

  return { STAGES, STAGE_INDEX, TILE, TILE_NAMES, FxError, blurred, isolate, createTileBank, createFx, paramsFor,
    whenWeight, sortEntries, run, filterWorks };
});
