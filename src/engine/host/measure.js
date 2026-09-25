/* 文字PVメーカー v2 — original work. Canvas measurer: measureText at 100 px, scaled and cached (DESIGN §4.15.1). */
MV.def('engine/host/measure', ['engine/text/faces'], (FACES) => {
  'use strict';

  const BASE = 100;
  const SAMPLE = 'Hg国';                   // any text: font-level bounding metrics do not depend on it

  // createCanvasMeasurer(canvasFactory, fontBook) → Measurer. Widths and metrics are measured once per
  // (css at 100 px, string) and cached; the cache empties and `key` changes whenever fontBook.epoch moves, because a
  // face that finished loading changes the widths.
  function createCanvasMeasurer(canvasFactory, fontBook) {
    let ctx = null, font = '';
    let epoch = epochOf(fontBook);
    const widths = new Map(), metricsCache = new Map();

    function context() {
      if (ctx) return ctx;
      const made = canvasFactory && typeof canvasFactory.create === 'function'
        ? canvasFactory.create(1, 1, { alpha: true })
        : { ctx: new OffscreenCanvas(1, 1).getContext('2d') };
      ctx = made.ctx;
      return ctx;
    }

    function sync() {
      const e = epochOf(fontBook);
      if (e === epoch) return;
      epoch = e;
      widths.clear();
      metricsCache.clear();
    }

    function useFont(css100) {
      const g = context();
      if (font !== css100) { g.font = css100; font = css100; }
      return g;
    }

    function width(css, str) {
      sync();
      const css100 = FACES.cssAt(css, BASE);
      const key = css100 + '\u0000' + str;
      let w = widths.get(key);
      if (w === undefined) {
        w = useFont(css100).measureText(String(str)).width || 0;
        widths.set(key, w);
      }
      return (w * FACES.cssSize(css)) / BASE;
    }

    function metrics(css) {
      sync();
      const css100 = FACES.cssAt(css, BASE);
      let m = metricsCache.get(css100);
      if (!m) {
        const t = useFont(css100).measureText(SAMPLE);
        const ascent = Number.isFinite(t.fontBoundingBoxAscent) ? t.fontBoundingBoxAscent : 0.88 * BASE;
        const descent = Number.isFinite(t.fontBoundingBoxDescent) ? t.fontBoundingBoxDescent : 0.12 * BASE;
        m = { ascent, descent };
        metricsCache.set(css100, m);
      }
      const k = FACES.cssSize(css) / BASE;
      return { ascent: m.ascent * k, descent: m.descent * k };
    }

    return {
      get key() { sync(); return 'canvas:' + epoch; },
      width,
      metrics,
    };
  }

  function epochOf(book) { return book && Number.isFinite(book.epoch) ? book.epoch : 0; }

  return { createCanvasMeasurer };
});
