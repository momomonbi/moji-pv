/* 文字PVメーカー v2 — original work. The stage: canvas host, DPR sizing, render loop, overlay, drill clicks, direct manipulation, try-on, compare, the keyframe markers (DESIGN_2_1 §6.7). */
MV.def('ui/stage', ['ui/dom', 'ui/selection', 'ui/output', 'i18n/t', 'ui/shot_editor'], (dom, S, OUT, T, KE) => {
  'use strict';

  const { h } = dom;
  const DRAG_MIN_PX = 4;
  const SNAP_DU = 14;                     // snapping distance in design units
  const MAX_BACKING = 2560;               // longest backing-store side in preview
  const SHORT_CAP = 1080;                 // 自動 / なめらか優先: the backing's short side at most this (§7.4 budgets are at 720p)
  const ADAPT_SHORT = 720;                // … and at most 720p while the adaptive preview is at level ≥ 3
  const ADAPT_ENTER = 3, ADAPT_LEAVE = 1; // levels where the stage steps its backing down / back up (hysteresis)
  const LABEL_MS = 400;                   // a11y label debounce
  const HANDLE_PX = 7;
  const SELECT_INK = '#7cc4ff';
  const HIGHLIGHT_INK = '#f0b64d';        // the line a review row points at (§6.4.10.6)
  const DOUBLE_MS = 600;                  // a second click this soon after the first belongs to the same double-click
  const MARK_PX = 13;                     // the keyframe markers ①②③ (radius, CSS px)
  const MARK_INK = '#f0b64d';
  const MARKS = ['①', '②', '③', '④', '⑤', '⑥'];
  const PROVISIONAL_RETRY_MS = 120;       // a paused provisional frame (fonts, scenes still coming) is redrawn after this
  const PROVISIONAL_RETRIES = 50;         // … at most this many times in a row (the font book's epoch repaints later loads)

  function mount(app, stageEl) {
    const t = app.t;
    const main = h('canvas', { class: 'canvas-main' });
    const overlay = h('canvas', { class: 'canvas-overlay', 'aria-hidden': 'true' });
    const badge = h('div', { class: 'stage-badge', hidden: true });
    // 軽量表示 (§7.4): shown while the adaptive preview draws below full quality.
    const lightBadge = h('div', { class: 'stage-badge stage-light', hidden: true, text: t('play.lightPreview') });
    const wrap = h('div', { class: 'canvas-wrap', tabindex: '0', role: 'img', 'aria-label': t('empty.preview') },
      main, overlay, badge, lightBadge);
    const area = h('div', { class: 'preview-area' }, wrap);
    const drawer = h('div', { class: 'drawer-mount', 'data-mount': 'timeline', hidden: true },
      h('div', { class: 'placeholder small' }, h('p', { text: t('drawer.soon') })));
    stageEl.append(area, drawer);

    const ctx = main.getContext('2d');
    const octx = overlay.getContext('2d');
    const surface = { canvas: main, ctx, w: 0, h: 0 };
    let css = { w: 0, h: 0 };
    let alt = null;                        // { doc, badge } while trying on or comparing
    let frame = 0;
    let dirty = false;
    let lastLabel = '';
    let labelTimer = 0;
    let retryTimer = 0;
    let retries = 0;
    let lastRes = null;                    // the latest layout, laid out again when the quality or the step-down changes
    let quality = app.view.state.prefs.quality;
    let steppedDown = false;               // the adaptive preview reached ADAPT_ENTER: the backing is at most 720p

    // --- sizing ----------------------------------------------------------------------------------------------

    // Backing pixels per CSS pixel: the device ratio (≤ 2; なめらか優先 × 0.75), at most MAX_BACKING on the long side;
    // except with きれい優先, the short side stays ≤ SHORT_CAP, and ≤ ADAPT_SHORT while stepped down. The stage owns
    // this step: the canvas keeps its CSS size and the compositor scales it, at no canvas cost.
    function backingScale(c) {
      const q = app.view.state.prefs.quality;
      const short = Math.max(1, Math.min(c.w, c.h));
      let k = Math.min(2, window.devicePixelRatio || 1) * (q === 'smooth' ? 0.75 : 1);
      k = Math.min(k, MAX_BACKING / Math.max(1, c.w, c.h));
      if (q !== 'sharp') k = Math.min(k, SHORT_CAP / short, steppedDown ? ADAPT_SHORT / short : Infinity);
      return k;
    }

    function layout(res) {
      lastRes = res;
      const st = res.rects.stage;
      const pv = res.rects.preview;
      dom.place(area, { x: pv.x - st.x, y: pv.y - st.y, w: pv.w, h: pv.h });
      const c = res.canvas;
      dom.place(wrap, { x: c.x - pv.x, y: c.y - pv.y, w: c.w, h: c.h });
      if (res.rects.drawer) {
        const d = res.rects.drawer;
        dom.place(drawer, { x: d.x - st.x, y: d.y - st.y, w: d.w, h: d.h });
      } else drawer.hidden = true;
      css = { w: c.w, h: c.h };
      const k = backingScale(c);
      const bw = Math.max(1, Math.round(c.w * k));
      const bh = Math.max(1, Math.round(c.h * k));
      for (const cv of [main, overlay]) {
        if (cv.width !== bw) cv.width = bw;
        if (cv.height !== bh) cv.height = bh;
        dom.setStyle(cv, { width: c.w, height: c.h });
      }
      surface.w = bw;
      surface.h = bh;
      invalidate();
    }

    // --- rendering -------------------------------------------------------------------------------------------

    function engineDoc() { return alt ? alt.doc : app.doc; }

    // The idle card before there are lyrics (§6.9.1): calm and dark, whatever the theme.
    function drawIdle() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const g = ctx.createLinearGradient(0, 0, 0, surface.h);
      g.addColorStop(0, '#1a1e26');
      g.addColorStop(1, '#101318');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, surface.w, surface.h);
      const size = Math.round(Math.min(surface.w, surface.h) * 0.075);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ece9e2';
      ctx.font = '600 ' + size + 'px "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';
      ctx.fillText(t('empty.preview'), surface.w / 2, surface.h / 2 - size * 0.3);
      ctx.fillStyle = '#e8573f';
      ctx.fillRect(surface.w / 2 - size * 0.6, surface.h / 2 + size * 0.45, size * 1.2, Math.max(2, size * 0.05));
      ctx.fillStyle = 'rgba(236, 233, 226, 0.6)';
      ctx.font = Math.round(size * 0.34) + 'px system-ui, sans-serif';
      ctx.fillText(t('empty.previewHint'), surface.w / 2, surface.h / 2 + size * 1.1);
    }

    // The preview shows the backdrop the export will render (ui/output.effectiveBackdrop): a transparent frame is
    // shown over a checkerboard (CSS on the wrap), never over a colour that could pass for part of the video.
    function showBackdrop(backdrop) {
      if (wrap.dataset.backdrop !== backdrop) wrap.dataset.backdrop = backdrop;
    }

    function render() {
      frame = 0;
      dirty = false;
      const tNow = app.time();
      const plan = app.engine.plan;
      if (!plan || !plan.cuts || !plan.lines.length) {
        showBackdrop('scene');
        drawIdle();
      } else {
        const backdrop = OUT.effectiveBackdrop(engineDoc());
        showBackdrop(backdrop);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const sharp = app.view.state.prefs.quality === 'sharp';
        if (sharp && typeof app.engine.setLevel === 'function') app.engine.setLevel(0);   // きれい優先: never steps down
        const stats = app.engine.renderFrame(surface, tNow, {
          scale: surface.w / plan.design.w, pick: true, quality: 'preview', reduceFlash: app.view.state.prefs.reduceFlash, backdrop,
        });
        if (stats && stats.provisional && !app.view.state.playing) retrySoon(); else retries = 0;
        adaptBacking(sharp ? 0 : levelOf(stats));
      }
      drawOverlay(plan);
      scheduleLabel(plan, tNow);
      if (app.view.state.playing) frame = requestAnimationFrame(tick);
    }

    // A provisional frame (§4.20: fallback faces or scenes still building) is not final: redraw it shortly, since the
    // render loop only runs while playing or invalidated.
    function retrySoon() {
      if (retryTimer || retries >= PROVISIONAL_RETRIES) return;
      retries += 1;
      retryTimer = setTimeout(() => { retryTimer = 0; invalidate(); }, PROVISIONAL_RETRY_MS);
    }

    function levelOf(stats) {
      if (stats && Number.isFinite(stats.level)) return stats.level;
      const s = typeof app.engine.stats === 'function' ? app.engine.stats() : null;
      return s && Number.isFinite(s.level) ? s.level : 0;
    }

    // After each frame: the 軽量表示 badge follows the adaptive level, and the backing steps down to 720p at level ≥ 3
    // (back up at ≤ 1), laid out again when that changes.
    function adaptBacking(level) {
      lightBadge.hidden = !(level >= 1);
      const want = level >= ADAPT_ENTER ? true : level <= ADAPT_LEAVE ? false : steppedDown;
      if (want === steppedDown) return;
      steppedDown = want;
      if (lastRes) layout(lastRes);
    }

    function tick() {
      frame = 0;
      app.onTick();
      render();
    }

    function invalidate() {
      dirty = true;
      if (!frame) frame = requestAnimationFrame(render);
    }

    function startLoop() { if (!frame) frame = requestAnimationFrame(tick); }

    // --- overlay (selection outlines, handles, review highlight, safe area) --------------------------------------

    function drawnBoxes() { return typeof app.engine.boxes === 'function' ? app.engine.boxes() : []; }

    function quadsFor(plan, all) {
      const sel = S.validate(app.view.state.sel, app.plan);
      const cuts = new Set(S.cutsOf(sel, app.plan));
      return { sel, cuts, boxes: (all || drawnBoxes()).filter((b) => cuts.has(b.cut)), plan };
    }

    function drawQuad(q, k) {
      octx.beginPath();
      octx.moveTo(q[0] * k, q[1] * k);
      for (let i = 2; i < 8; i += 2) octx.lineTo(q[i] * k, q[i + 1] * k);
      octx.closePath();
      octx.stroke();
    }

    function drawOverlay(plan) {
      const k = plan && plan.design ? overlay.width / plan.design.w : 1;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.clearRect(0, 0, overlay.width, overlay.height);
      if (!plan || !plan.design) return;
      const dpr = overlay.width / Math.max(1, css.w);
      if (app.view.state.prefs.safeArea) drawSafeArea(plan, k, dpr);
      const all = drawnBoxes();
      if (alt) { drawHighlight(all, null, k, dpr); return; }
      const { sel, cuts, boxes } = quadsFor(plan, all);
      drawHighlight(all, cuts, k, dpr);
      octx.lineWidth = 1.5 * dpr;
      octx.strokeStyle = SELECT_INK;
      octx.shadowColor = 'rgba(0,0,0,0.6)';
      octx.shadowBlur = 3 * dpr;
      const dashed = sel.level === 'line' || (sel.level === 'el' && sel.el !== 'text');
      octx.setLineDash(dashed ? [6 * dpr, 4 * dpr] : []);
      for (const b of boxes) {
        if (sel.level === 'el' && sel.el === 'text' && b.owner !== 'text') continue;
        drawQuad(b.quad, k);
      }
      octx.setLineDash([]);
      if (sel.level === 'el' && sel.el === 'ground') {
        const inset = 6 * dpr;
        octx.strokeRect(inset, inset, overlay.width - 2 * inset, overlay.height - 2 * inset);
      }
      if (sel.level === 'el' && sel.el === 'text') for (const hd of handles(boxes, k)) drawHandle(hd, dpr);
      octx.shadowBlur = 0;
      drawMarks(k, dpr);
    }

    // The keyframe editor's markers ①②③ where each key places its aim (DESIGN_2_1 §6.7), while its page is open and
    // 「プレビューに印を出す」 is on.
    function marks() {
      const edit = app.shotEdit;
      return edit && edit.markers ? edit.marks() : [];
    }

    function drawMarks(k, dpr) {
      const list = marks();
      if (!list.length) return;
      octx.save();
      octx.lineWidth = 2 * dpr;
      octx.strokeStyle = MARK_INK;
      octx.fillStyle = 'rgba(15,17,21,0.78)';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      octx.font = Math.round(13 * dpr) + 'px system-ui, sans-serif';
      for (const m of list) {
        const x = m.x * k, y = m.y * k;
        octx.beginPath();
        octx.arc(x, y, MARK_PX * dpr, 0, Math.PI * 2);
        octx.fill();
        octx.stroke();
        octx.fillStyle = MARK_INK;
        octx.fillText(MARKS[m.i] || String(m.i + 1), x, y + dpr);
        octx.fillStyle = 'rgba(15,17,21,0.78)';
      }
      octx.restore();
    }

    // The marker under a point (design units), or null.
    function markAt(p) {
      const plan = app.engine.plan;
      if (!plan || !plan.design) return null;
      const du = MARK_PX * 1.4 * plan.design.w / Math.max(1, css.w);
      return marks().find((m) => Math.hypot(m.x - p.x, m.y - p.y) <= du) || null;
    }

    // The line a hovered review row points at (view.highlight, §6.4.10.6): its drawn boxes in their own ink, except
    // the cuts the selection already outlines (`skip`). An area highlights all of its lines (an array).
    function drawHighlight(all, skip, k, dpr) {
      const hl = app.view.state.highlight;
      if (!hl) return;
      const lines = new Set(Array.isArray(hl) ? hl : [hl]);
      const boxes = all.filter((b) => lines.has(b.line) && !(skip && skip.has(b.cut)));
      if (!boxes.length) return;
      octx.save();
      octx.lineWidth = 2.5 * dpr;
      octx.strokeStyle = HIGHLIGHT_INK;
      octx.shadowColor = 'rgba(0,0,0,0.6)';
      octx.shadowBlur = 3 * dpr;
      for (const b of boxes) drawQuad(b.quad, k);
      octx.restore();
    }

    function drawSafeArea(plan, k, dpr) {
      octx.save();
      octx.strokeStyle = 'rgba(255,255,255,0.35)';
      octx.lineWidth = dpr;
      octx.setLineDash([4 * dpr, 4 * dpr]);
      for (const f of [0.9, 0.8]) {
        const w = plan.design.w * f * k, hh = plan.design.h * f * k;
        octx.strokeRect((overlay.width - w) / 2, (overlay.height - hh) / 2, w, hh);
      }
      octx.restore();
    }

    // Handles of the selected text block (backing px): four scale corners and one rotation knob above.
    function handles(boxes, k) {
      const text = boxes.filter((b) => b.owner === 'text');
      if (!text.length) return [];
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const b of text) {
        for (let i = 0; i < 8; i += 2) {
          x0 = Math.min(x0, b.quad[i] * k); x1 = Math.max(x1, b.quad[i] * k);
          y0 = Math.min(y0, b.quad[i + 1] * k); y1 = Math.max(y1, b.quad[i + 1] * k);
        }
      }
      const dpr = overlay.width / Math.max(1, css.w);
      return [
        { kind: 'scale', x: x0, y: y0 }, { kind: 'scale', x: x1, y: y0 }, { kind: 'scale', x: x1, y: y1 },
        { kind: 'scale', x: x0, y: y1 }, { kind: 'rotate', x: (x0 + x1) / 2, y: y0 - 22 * dpr },
      ].map((hd) => Object.assign(hd, { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }));
    }

    function drawHandle(hd, dpr) {
      octx.fillStyle = '#0f1115';
      octx.strokeStyle = SELECT_INK;
      octx.beginPath();
      if (hd.kind === 'rotate') octx.arc(hd.x, hd.y, HANDLE_PX * 0.8 * dpr, 0, Math.PI * 2);
      else octx.rect(hd.x - HANDLE_PX / 2 * dpr, hd.y - HANDLE_PX / 2 * dpr, HANDLE_PX * dpr, HANDLE_PX * dpr);
      octx.fill();
      octx.stroke();
    }

    // --- a11y label ------------------------------------------------------------------------------------------

    function scheduleLabel(plan, tNow) {
      if (labelTimer) return;
      labelTimer = setTimeout(() => {
        labelTimer = 0;
        const cut = plan && plan.cuts ? plan.cuts.find((c) => c.a <= tNow && tNow < c.b && c.text) : null;
        // Between lines (lead-in, gaps, outro) the label says so; the idle card's text only while there are no lyrics.
        const label = cut ? t('a11y.preview', { line: cut.text, time: T.fmtTime(tNow) })
          : plan && plan.lines && plan.lines.length ? t('a11y.previewGap', { time: T.fmtTime(tNow) }) : t('empty.preview');
        if (label !== lastLabel) { wrap.setAttribute('aria-label', label); lastLabel = label; }
      }, LABEL_MS);
    }

    // --- pointer: picks and direct manipulation ----------------------------------------------------------------

    function toDesign(ev) {
      const r = wrap.getBoundingClientRect();
      const plan = app.engine.plan;
      if (!plan || !plan.design || !r.width) return null;
      return { x: (ev.clientX - r.left) / r.width * plan.design.w, y: (ev.clientY - r.top) / r.height * plan.design.h,
        px: (ev.clientX - r.left) * (overlay.width / r.width), py: (ev.clientY - r.top) * (overlay.height / r.height) };
    }

    let press = null;                       // { x, y, alt, drag, gesture, base, handle, … }
    let suppressClick = false;

    function textSelected() {
      const sel = app.view.state.sel;
      return sel.level === 'el' && sel.el === 'text' ? sel : null;
    }

    wrap.addEventListener('pointerdown', (ev) => {
      // Tap mode (§6.4.15): a press on the preview is a tap, the start of the next line at the press's own time; it
      // neither selects nor pauses (a pause would freeze the clock the next taps read).
      if (app.view.state.mode === 'tap') {
        if (ev.button === 0 && app.tap) app.tap.mark({ timeStamp: ev.timeStamp });
        return;
      }
      if (ev.button !== 0 || alt) return;
      const p = toDesign(ev);
      if (!p) return;
      press = { sx: ev.clientX, sy: ev.clientY, p, alt: ev.altKey, drag: null };
      // A keyframe marker: dragging it places its key freely (ox / oy, one gesture = one undo entry).
      const mark = markAt(p);
      if (mark) {
        press.mark = mark;
        wrap.setPointerCapture(ev.pointerId);
        return;
      }
      const sel = textSelected();
      if (sel) {
        const plan = app.engine.plan;
        const k = overlay.width / plan.design.w;
        const { boxes } = quadsFor(plan);
        const hd = handles(boxes, k).find((x) => Math.hypot(x.x - p.px, x.y - p.py) <= HANDLE_PX * 1.6 * (overlay.width / css.w));
        const inside = hd || app.engine.hitTest(p.x, p.y).some((hit) => S.cutsOf(sel, app.plan).includes(hit.cut) && hit.owner === 'text');
        if (inside) press.drag = { sel, handle: hd || null, base: app.nudgeOf(sel), k, view: viewNow() };
      }
      wrap.setPointerCapture(ev.pointerId);
    });

    wrap.addEventListener('pointermove', (ev) => {
      if (press && press.mark && app.shotEdit) {
        const moved = Math.hypot(ev.clientX - press.sx, ev.clientY - press.sy);
        if (!press.markGesture && moved < DRAG_MIN_PX) return;
        const key = 'mark:' + press.mark.i;
        if (!press.markGesture) press.markGesture = app.shotEdit.gesture(key);
        const p = toDesign(ev);
        if (p) app.shotEdit.place(press.mark.i, p, app.engine.plan.design, press.markGesture.key);
        return;
      }
      if (!press || !press.drag) return;
      const moved = Math.hypot(ev.clientX - press.sx, ev.clientY - press.sy);
      if (!press.gesture && moved < DRAG_MIN_PX) return;
      if (!press.gesture) {
        press.gesture = app.beginNudge(press.drag.sel);
        if (app.view.state.playing) app.pause();
      }
      const p = toDesign(ev);
      if (p) press.gesture.set(nudgeFrom(press, p, ev));
    });

    function nudgeFrom(pr, p, ev) {
      const base = pr.drag.base;
      const hd = pr.drag.handle;
      if (hd) {
        const k = pr.drag.k;
        const cx = hd.cx / k, cy = hd.cy / k;
        if (hd.kind === 'rotate') {
          const a0 = Math.atan2(pr.p.y - cy, pr.p.x - cx), a1 = Math.atan2(p.y - cy, p.x - cx);
          let rot = base.rot + (a1 - a0) * 180 / Math.PI;
          if (!ev.altKey) rot = snapAngle(rot);
          return Object.assign({}, base, { rot: Math.round(rot * 10) / 10 });
        }
        const d0 = Math.hypot(pr.p.x - cx, pr.p.y - cy) || 1;
        const s = Math.max(0.2, Math.min(4, base.s * Math.hypot(p.x - cx, p.y - cy) / d0));
        return Object.assign({}, base, { s: Math.round(s * 100) / 100 });
      }
      // The drag is on the screen; the nudge is in the world under the camera: invert its zoom and roll (engine.viewAt,
      // DESIGN_2_1 §6.7) so the text stays under the pointer at any closeness.
      const w = KE.screenToWorld(p.x - pr.p.x, p.y - pr.p.y, pr.drag.view);
      let dx = base.dx + w.dx;
      let dy = base.dy + w.dy;
      if (ev.shiftKey) { if (Math.abs(w.dx) > Math.abs(w.dy)) dy = base.dy; else dx = base.dx; }
      if (!ev.altKey) { dx = snap(dx); dy = snap(dy); }
      return Object.assign({}, base, { dx: Math.round(dx), dy: Math.round(dy) });
    }

    // Snapping (off while Alt is held): back to the base position and onto the thirds of the frame.
    function snap(v) {
      const plan = app.engine.plan;
      const targets = [0, plan.design.w / 6, -plan.design.w / 6, plan.design.h / 6, -plan.design.h / 6];
      for (const x of targets) if (Math.abs(v - x) <= SNAP_DU) return x;
      return v;
    }
    function snapAngle(rot) {
      const near = Math.round(rot / 15) * 15;
      return Math.abs(rot - near) <= 3 ? near : rot;
    }

    // The camera at this moment ({ x, y, zoom, roll } of engine.viewAt: the current cut's camera composed with the rig).
    function viewNow() { return app.engine.viewAt(app.time()); }

    wrap.addEventListener('pointerup', (ev) => {
      if (!press) return;
      if (press.gesture) { press.gesture.end(); suppressClick = true; }
      if (press.mark) { if (press.markGesture && app.shotEdit) app.shotEdit.end(); suppressClick = true; }
      press = null;
    });
    wrap.addEventListener('pointercancel', () => {
      if (press && press.gesture) press.gesture.end();
      if (press && press.markGesture && app.shotEdit) app.shotEdit.end();
      press = null;
    });
    // The wheel over a marker sets its key's closeness (DESIGN_2_1 §6.7).
    wrap.addEventListener('wheel', (ev) => {
      const p = toDesign(ev);
      const mark = p ? markAt(p) : null;
      if (!mark || !app.shotEdit) return;
      ev.preventDefault();
      app.shotEdit.grow(mark.i, ev.deltaY < 0 ? 1 : -1);
    }, { passive: false });

    // The first click opens 詳細, and auto-fold can move the canvas before the second click of a double-click lands:
    // the second click reuses the first one's design-space point instead of mapping its screen point again.
    let firstClick = null;                  // { p, at } of the last single click

    function clickPoint(ev) {
      const again = ev.detail >= 2 && firstClick && ev.timeStamp - firstClick.at <= DOUBLE_MS;
      const p = again ? firstClick.p : toDesign(ev);
      firstClick = ev.detail >= 2 ? null : p && { p, at: ev.timeStamp };
      return p;
    }

    wrap.addEventListener('click', (ev) => {
      if (suppressClick) { suppressClick = false; return; }
      if (alt || app.view.state.mode === 'tap') return;
      const p = clickPoint(ev);
      if (!p) return;
      const hits = app.engine.hitTest(p.x, p.y);
      const next = S.onPreviewClick(app.view.state.sel, hits, { alt: ev.altKey, dbl: ev.detail >= 2, plan: app.plan });
      app.select(next, { from: 'preview', open: next.level !== 'work', pause: true, seek: false });
    });

    // --- try-on and compare ------------------------------------------------------------------------------------

    // setAlt(doc | null, badgeText): render another document (try-on, compare) without committing it.
    function setAlt(doc, badgeText) {
      alt = doc ? { doc } : null;
      app.engine.setDoc(engineDoc());
      badge.hidden = !doc;
      badge.textContent = doc ? badgeText || '' : '';
      invalidate();
    }

    function fullscreen() {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (wrap.requestFullscreen) wrap.requestFullscreen();
    }

    app.view.on((changed) => {
      // プレビューの画質 takes effect at once: the backing is laid out again (not only after the next resize).
      if (changed.includes('prefs') && app.view.state.prefs.quality !== quality) {
        quality = app.view.state.prefs.quality;
        if (quality === 'sharp') steppedDown = false;
        if (lastRes) layout(lastRes);
      }
      if (['sel', 'time', 'prefs', 'highlight'].some((k) => changed.includes(k))) invalidate();
      if (changed.includes('playing') && app.view.state.playing) startLoop();
    });
    app.bus.on('plan', () => { if (!alt) invalidate(); });
    app.bus.on('shotEdit', () => invalidate());

    return {
      layout, invalidate, setAlt, fullscreen, focus: () => dom.focus(wrap), element: wrap,
      isDirty: () => dirty, hasAlt: () => !!alt, steppedDown: () => steppedDown,
    };
  }

  return { mount };
});
