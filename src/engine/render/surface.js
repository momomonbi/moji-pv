/* 文字PVメーカー v2 — original work. Surfaces: canvases from the CanvasFactory, pooled per size and reclaimed per frame (DESIGN §4.18.11, §7.2). */
MV.def('engine/render/surface', [], () => {
  'use strict';

  // Surface = { canvas, ctx, w, h } (§4.18.11). Every canvas comes from the injected CanvasFactory, so the same code
  // runs on OffscreenCanvas in the browser and on the recording context in Node.

  const LIMIT_SMALL = 10;          // full-frame surfaces below 1440p (§7.2)
  const LIMIT_LARGE = 6;           // … and at 1440p and above
  const GRACE = 4;                 // a frame may briefly go over the limit by this much before take() refuses

  class SurfaceError extends Error {
    constructor(code, message) { super(message); this.name = 'SurfaceError'; this.code = code; }
  }

  function surfaceOf(factory, w, h, alpha) {
    const made = factory.create(w, h, { alpha: alpha !== false });
    return { canvas: made.canvas, ctx: made.ctx, w, h };
  }

  const NO_DASH = Object.freeze([]);

  // Puts a context back to its defaults. Unconditional, so a reused surface and a new one receive the same calls (a
  // frame's drawing never depends on what an earlier frame left behind). The line state and styles are reset too: a
  // stroke that relies on a default (a cap, a join, no dash) drew differently on a surface an earlier frame had used
  // (determinism.py: a frame alone differed from the same frame after others, only in the pixels).
  function resetState(g) {
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.imageSmoothingEnabled = true;
    if (g.filter !== undefined) g.filter = 'none';
    g.lineWidth = 1;
    g.lineCap = 'butt';
    g.lineJoin = 'miter';
    if (typeof g.setLineDash === 'function') g.setLineDash(NO_DASH);
    g.strokeStyle = '#000000';
    g.fillStyle = '#000000';
  }

  function clear(s) {
    resetState(s.ctx);
    s.ctx.clearRect(0, 0, s.w, s.h);
    return s;
  }

  // The full-frame surface limit for an output size (§7.2).
  function limitFor(w, h) { return Math.min(w, h) >= 1440 ? LIMIT_LARGE : LIMIT_SMALL; }

  // createPool(factory) → a pool of surfaces keyed by size.
  //   frame(w, h)        declares the frame size (the limit applies to surfaces of that size). A new frame size
  //                      releases the free surfaces of the old one and its derived sizes (½, ¼ …), so a pool that sees
  //                      many output sizes (a resized preview) holds the surfaces of one size family only (§7.2, §7.3)
  //   take(w?, h?)       a cleared surface (default: frame size); throws SurfaceError('pool-exhausted') past the limit
  //   give(s)            returns a surface (anything that is not a pooled surface is ignored)
  //   begin() / end()    a frame scope: end() takes back every surface still out, so a leaky part cannot drain the pool
  //   stats()            { live, out, bytes, created }  live/bytes = surfaces held now; created = ever made
  //   drop()             forgets every canvas
  function createPool(factory) {
    const free = new Map();          // 'w×h' → Surface[]
    const out = new Set();
    const mine = new WeakMap();      // pooled surface → the frame-size generation it was taken in
    let frameW = 0, frameH = 0, limit = LIMIT_SMALL, gen = 0;
    let created = 0, live = 0, bytes = 0, fullOut = 0;

    function keyOf(w, h) { return w * 65536 + h; }

    function release(s) { live--; bytes -= s.w * s.h * 4; }

    function frame(w, h) {
      if (w === frameW && h === frameH) return;
      frameW = w; frameH = h;
      limit = limitFor(w, h);
      gen++;
      fullOut = 0;                               // surfaces still out belong to the old size and are dropped on give()
      for (const list of free.values()) for (const s of list) release(s);
      free.clear();
    }

    function take(w, h) {
      const W = w === undefined ? frameW : w, H = h === undefined ? frameH : h;
      if (!(W > 0 && H > 0)) throw new SurfaceError('bad-size', 'surface size must be positive');
      const full = W === frameW && H === frameH;
      if (full && fullOut >= limit + GRACE) {
        throw new SurfaceError('pool-exhausted', 'more than ' + (limit + GRACE) + ' frame surfaces are in use');
      }
      const list = free.get(keyOf(W, H));
      let s = list && list.length ? list.pop() : null;
      if (!s) {
        s = surfaceOf(factory, W, H, true);
        created++; live++;
        bytes += W * H * 4;
      }
      mine.set(s, gen);
      clear(s);
      out.add(s);
      if (full) fullOut++;
      return s;
    }

    function give(s) {
      if (!s || !mine.has(s) || !out.has(s)) return;
      out.delete(s);
      const stale = mine.get(s) !== gen;          // taken under an earlier frame size: not kept
      if (!stale && s.w === frameW && s.h === frameH) fullOut--;
      if (stale) { release(s); mine.delete(s); return; }
      const k = keyOf(s.w, s.h);
      if (!free.has(k)) free.set(k, []);
      free.get(k).push(s);
    }

    function begin() { end(); }

    function end() {
      for (const s of out) give(s);           // deleting the visited entry during for…of is safe for a Set
    }

    function isPooled(s) { return !!s && mine.has(s); }

    function drop() {
      free.clear();
      out.clear();
      fullOut = 0;
      live = 0;
      bytes = 0;
      gen++;
    }

    // warm(n, touch, stop) → the surfaces made: makes sure n full-frame surfaces (at most the limit) can be taken
    // without making one, so the first frame of a seam (which takes several at once) does not pay for them. The missing
    // ones are made cleared, passed to touch(surface) (the host rasterizes it now) and put in the free list; the free
    // ones are left alone, so a warm pool costs nothing. stop() (optional) is asked after each surface made: true ends
    // the call there (a time slice is due), and the next call makes the rest.
    function warm(n, touch, stop) {
      if (!(frameW > 0 && frameH > 0)) return 0;
      const k = keyOf(frameW, frameH);
      if (!free.has(k)) free.set(k, []);
      const list = free.get(k);
      let made = 0;
      for (let have = list.length + fullOut; have < Math.min(n, limit); have++) {
        const s = clear(surfaceOf(factory, frameW, frameH, true));
        created++; live++; made++;
        bytes += frameW * frameH * 4;
        mine.set(s, gen);
        if (touch) touch(s);
        list.push(s);
        if (stop && stop()) break;
      }
      return made;
    }

    return {
      frame, take, give, begin, end, isPooled, drop, warm,
      get limit() { return limit; },
      stats: () => ({ live, out: out.size, bytes, created }),
    };
  }

  return { LIMIT_SMALL, LIMIT_LARGE, SurfaceError, surfaceOf, resetState, clear, limitFor, createPool };
});
