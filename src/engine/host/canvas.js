/* 文字PVメーカー v2 — original work. Browser CanvasFactory: OffscreenCanvas (or a detached <canvas>) plus the host clock and yield (DESIGN §4.19.8, §9.2). */
MV.def('engine/host/canvas', [], () => {
  'use strict';

  // createCanvasFactory({ document?, offscreen? }) → CanvasFactory = { create(w, h, { alpha }) → { canvas, ctx }, now(), idle() }
  // `now` and `idle` are additive: the engine below L6 may not read clocks or use timers, so the host lends it a clock
  // (frame statistics, the adaptive preview, §7.4) and a yield (engine.prepare works in slices between yields, so
  // playback and typing are not held up). OffscreenCanvas is preferred; a detached <canvas> is the fallback.
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

    return Object.freeze({ create, now: clock, idle });
  }

  return { createCanvasFactory };
});
