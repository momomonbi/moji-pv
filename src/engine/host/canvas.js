/* 文字PVメーカー v2 — original work. Browser CanvasFactory: OffscreenCanvas (or a detached <canvas>) plus the host clock and yield (DESIGN §4.19.8, §9.2). */
MV.def('engine/host/canvas', [], () => {
  'use strict';

  // createCanvasFactory({ document?, offscreen? }) → CanvasFactory = { create(w, h, { alpha }) → { canvas, ctx }, now(), idle(),
  //   settle(canvas), inkBox(css, text) }
  // `now` and `idle` are additive: the engine below L6 may not read clocks or use timers, so the host lends it a clock
  // (frame statistics, the adaptive preview, §7.4) and a yield (engine.prepare works in slices between yields, so
  // playback and typing are not held up). OffscreenCanvas is preferred; a detached <canvas> is the fallback.
  // `settle(canvas)` is additive too (DESIGN_2_1 §3.10, NOTES "Perf: camerawork + materials row"): a canvas
  // records its drawing calls and rasterizes them only when its picture is first used, so a glyph sprite made during
  // engine.prepare was still painted (and blurred) inside the first frame that drew it. settle() uses the picture once,
  // on a private 1 × 1 canvas of the same kind that is cleared at once, so the raster work happens when the sprite is
  // made. It changes no pixel and draws nothing the engine can see; the recording factory has no settle, so op streams
  // are unchanged.
  // `inkBox(css, text)` is additive as well: { left, right, ascent, descent } (px) of the ink of `text` in the font
  // `css`, drawn with textAlign 'center' and textBaseline 'middle' (measureText's actual bounding box; left and ascent
  // are distances to the left of and above the draw point), or null. The sprite cache crops blurred glyph rasters to
  // it (engine/render/sprites). Only the host has it: the engine never measures, and the recording factory's canvases
  // (and so the Node op streams) do not change.
  function createCanvasFactory(opts) {
    const o = opts || {};
    const doc = o.document || (typeof document !== 'undefined' ? document : null);
    const useOffscreen = o.offscreen !== false && typeof OffscreenCanvas === 'function';

    function size(v) { return Math.max(1, Math.min(16384, Math.round(v) || 1)); }

    function create(w, h, copts) {
      const alpha = !(copts && copts.alpha === false);
      let canvas;
      if (useOffscreen) canvas = new OffscreenCanvas(size(w), size(h));
      else if (doc) {
        canvas = doc.createElement('canvas');
        canvas.width = size(w);
        canvas.height = size(h);
      } else throw new Error('engine/host/canvas: no OffscreenCanvas and no document');
      const ctx = canvas.getContext('2d', { alpha });
      if (!ctx) throw new Error('engine/host/canvas: 2d context unavailable');
      return { canvas, ctx };
    }

    const clock = typeof performance !== 'undefined' && performance && typeof performance.now === 'function'
      ? () => performance.now() : () => 0;

    // idle() → a Promise that settles in a later task, once the browser could handle input and paint. scheduler.yield
    // or a message-channel task is not throttled like timers in a hidden tab, so an export preparing in the background
    // still moves on.
    function idle() {
      const sch = typeof scheduler !== 'undefined' ? scheduler : null;
      if (sch && typeof sch.yield === 'function') return sch.yield();
      if (typeof MessageChannel === 'function') {
        return new Promise((resolve) => {
          const ch = new MessageChannel();
          ch.port1.addEventListener('message', () => { ch.port1.close(); resolve(); }, { once: true });
          ch.port1.start();
          ch.port2.postMessage(0);
        });
      }
      return new Promise((resolve) => setTimeout(resolve, 0));
    }

    // The private 1 × 1 context of settle(): made on first use, never handed out.
    let tiny = null;
    function tinyCtx() {
      if (!tiny) tiny = create(1, 1, { alpha: true }).ctx;
      return tiny;
    }

    function settle(canvas) {
      if (!canvas || !(canvas.width > 0) || !(canvas.height > 0)) return;
      const g = tinyCtx();
      g.drawImage(canvas, 0, 0, 1, 1);
      g.clearRect(0, 0, 1, 1);
    }

    function inkBox(css, text) {
      const g = tinyCtx();
      if (typeof g.measureText !== 'function') return null;
      g.font = css;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const m = g.measureText(text);
      const box = { left: m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight, ascent: m.actualBoundingBoxAscent,
        descent: m.actualBoundingBoxDescent };
      return Number.isFinite(box.left) && Number.isFinite(box.right) && Number.isFinite(box.ascent) && Number.isFinite(box.descent)
        ? box : null;
    }

    return Object.freeze({ create, now: clock, idle, settle, inkBox });
  }

  return { createCanvasFactory };
});
