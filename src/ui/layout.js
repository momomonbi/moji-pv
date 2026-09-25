/* 文字PVメーカー v2 — original work. Screen geometry: one formula for every region and the canvas (DESIGN §6.1, §6.2). */
MV.def('ui/layout', ['core/doc'], (D) => {
  'use strict';

  const RAIL = 48;
  const SIDE = 320;                              // compact / stacked: one side column (手順 / 詳細 / AI)
  const COLUMNS = Object.freeze({
    wide: Object.freeze({ step: 320, detail: 352 }),
    standard: Object.freeze({ step: 296, detail: 312 }),
  });
  // Height tiers: tall and normal share the roomy metrics; short is tighter (§6.2).
  const ROOMY = Object.freeze({ header: 48, pad: 16, gap: 12, lane: 40, laneGap: 8, controls: 40, drawer: 144 });
  const TIGHT = Object.freeze({ header: 44, pad: 12, gap: 8, lane: 32, laneGap: 6, controls: 36, drawer: 112 });
  const MIN_PAGE_H = 600;                        // below this the page scrolls and the preview keeps MIN_PREVIEW_H
  const MIN_PREVIEW_H = 360;
  const STACKED_STAGE_SHARE = 0.7;               // stacked: the stage takes at most 70vh
  const STACKED_MIN_SIDE = 480;
  const EPS = 1e-7;                              // floor() guard against 538.9999… from float division

  function layoutOf(w) {
    if (w >= 1360) return 'wide';
    if (w >= 1200) return 'standard';
    if (w >= 1024) return 'compact';
    return 'stacked';
  }

  function tierOf(h) {
    if (h >= 860) return 'tall';
    if (h >= 740) return 'normal';
    return 'short';
  }

  function metricsOf(tier) {
    const m = tier === 'short' ? TIGHT : ROOMY;
    return Object.assign({ playbar: m.lane + m.laneGap + m.controls }, m);
  }

  function rect(x, y, w, h) { return { x, y, w: Math.max(0, w), h: Math.max(0, h) }; }

  function designSize(aspect) { return D.DESIGN_SIZE[aspect] || D.DESIGN_SIZE['16:9']; }

  // Largest canvas of the aspect inside aw × ah, integer CSS px, centred (§6.1 rule 4).
  function fitCanvas(area, aspect) {
    const [dw, dh] = designSize(aspect);
    const s = Math.max(0, Math.min(area.w / dw, area.h / dh));
    const w = Math.floor(dw * s + EPS);
    const h = Math.floor(dh * s + EPS);
    return { w, h, x: area.x + Math.floor((area.w - w) / 2), y: area.y + Math.floor((area.h - h) / 2), scale: s };
  }

  // Preview, drawer, lane and controls stacked inside the stage column (x0 = the stage's left edge).
  function stageRects(x0, top, width, ah, m, drawerOpen) {
    const aw = width - 2 * m.pad;
    const preview = rect(x0 + m.pad, top + m.pad, aw, ah);
    let y = preview.y + ah + m.gap;
    const drawer = drawerOpen ? rect(preview.x, y, aw, m.drawer) : null;
    if (drawer) y += m.drawer;
    const lane = rect(preview.x, y, aw, m.lane);
    const controls = rect(preview.x, y + m.lane + m.laneGap, aw, m.controls);
    return { preview, drawer, lane, controls };
  }

  function desktop(w, h, o, layout, tier, m) {
    const compact = layout === 'compact';
    const cols = COLUMNS[layout];
    const panelOpen = !!o.panel;
    const railOn = !compact && !!o.rail;
    const left = compact ? SIDE : railOn ? RAIL : cols.step;
    const right = compact || !panelOpen ? 0 : cols.detail;
    const drawerH = o.drawer ? m.drawer : 0;
    const fixed = m.header + m.pad + m.gap + m.playbar + m.pad + drawerH;
    let ah = h - fixed;
    let pageH = h;
    if (h < MIN_PAGE_H && ah < MIN_PREVIEW_H) {
      ah = MIN_PREVIEW_H;
      pageH = fixed + ah;
    }
    const bodyH = pageH - m.header;
    const inner = stageRects(left, m.header, w - left - right, ah, m, !!o.drawer);
    return {
      pageH,
      rects: {
        header: rect(0, 0, w, m.header),
        steps: !compact && !railOn ? rect(0, m.header, cols.step, bodyH) : null,
        rail: railOn ? rect(0, m.header, RAIL, bodyH) : null,
        side: compact ? rect(0, m.header, SIDE, bodyH) : null,
        panel: right ? rect(w - right, m.header, right, bodyH) : null,
        stage: rect(left, m.header, w - left - right, bodyH),
        preview: inner.preview, drawer: inner.drawer, lane: inner.lane, controls: inner.controls,
      },
    };
  }

  // Stacked (< 1024 px): the stage on top (≤ 70vh, shrunk to the canvas), the side column below; the page scrolls.
  function stacked(w, h, o, m) {
    const [dw, dh] = designSize(o.aspect);
    const drawerH = o.drawer ? m.drawer : 0;
    const aw = w - 2 * m.pad;
    const chrome = m.pad + m.gap + drawerH + m.playbar + m.pad;
    const ahMax = Math.max(160, Math.floor(STACKED_STAGE_SHARE * Math.max(h, MIN_PAGE_H)) - chrome);
    const ah = Math.min(ahMax, Math.floor(dh * (aw / dw) + EPS));
    const stageH = chrome + ah;
    const sideH = Math.max(STACKED_MIN_SIDE, h - m.header - stageH);
    const inner = stageRects(0, m.header, w, ah, m, !!o.drawer);
    return {
      pageH: m.header + stageH + sideH,
      rects: {
        header: rect(0, 0, w, m.header), steps: null, rail: null,
        side: rect(0, m.header + stageH, w, sideH), panel: null,
        stage: rect(0, m.header, w, stageH),
        preview: inner.preview, drawer: inner.drawer, lane: inner.lane, controls: inner.controls,
      },
    };
  }

  // computeLayout({ w, h }, { panel, rail, drawer, aspect }) → { layout, tier, rects, canvas, metrics, page }.
  // rects.drawer, canvas.{x, y, scale}, metrics and page are additive to the frozen shape (§4.23).
  function computeLayout(viewport, opts) {
    const w = Math.max(0, Math.floor(viewport.w));
    const h = Math.max(0, Math.floor(viewport.h));
    const o = opts || {};
    const layout = layoutOf(w);
    const tier = tierOf(h);
    const m = metricsOf(tier);
    const out = layout === 'stacked' ? stacked(w, h, o, m) : desktop(w, h, o, layout, tier, m);
    const canvas = fitCanvas(out.rects.preview, o.aspect);
    return {
      layout, tier, rects: out.rects, canvas, metrics: m,
      page: { w, h: out.pageH, scroll: out.pageH > h },
    };
  }

  // Opening 詳細 or AI folds the step column to its rail in wide/standard layouts, unless it was opened from the lyric
  // editor (so lyrics and inspector can sit side by side). pref = the 詳細を開いたらたたむ preference (default on).
  function autoFold({ layout, openedFrom, pref }) {
    if (pref === false) return false;
    if (layout !== 'wide' && layout !== 'standard') return false;
    return openedFrom !== 'lyrics';
  }

  // The four regions that must never overlap (§6.1 rule 1), present ones only.
  function regions(result) {
    const r = result.rects;
    return [['header', r.header], ['steps', r.steps || r.rail || r.side], ['stage', r.stage], ['panel', r.panel]]
      .filter(([, box]) => box);
  }

  function overlaps(a, b) {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  }

  return { RAIL, SIDE, COLUMNS, computeLayout, autoFold, layoutOf, tierOf, metricsOf, fitCanvas, regions, overlaps };
});
