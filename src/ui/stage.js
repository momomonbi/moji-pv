/* 文字PVメーカー v2 — original work. The stage: canvas host, DPR sizing, render loop, overlay, drill clicks, direct manipulation, try-on, compare, the keyframe markers (DESIGN_2_1 §6.7), photos and videos: the drop target, the crop overlay, decoding ahead, missing pictures and the trim peek (§11.7.1, §11.7.6–§11.7.8). */
MV.def('ui/stage', ['ui/dom', 'ui/selection', 'ui/output', 'i18n/t', 'ui/shot_editor', 'core/media'], (dom, S, OUT, T, KE, MEDIA) => {
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
  const LOOK_AHEAD = 8;                   // while playing, the store is asked for the frames at t + k / 30, k = 1…8 (assets.want)
  const CROP_DIM = 'rgba(0, 0, 0, 0.4)';  // §11.7.6: everything outside the chosen crop is dimmed at 40 %
  const CROP_STEP = 0.01, CROP_STEP_BIG = 0.1;   // arrow keys move the focus by 1 % (Shift 10 %)
  const CROP_WHEEL = 1.05;                // the wheel zooms ×1.05 per notch
  const CROP_SNAP = 0.02;                 // the focus snaps to the centre and the thirds within this share (not with Alt)
  const CROP_WHEEL_END_MS = 400;          // a wheel gesture ends after this pause
  const MAP_SHARE = 0.26;                 // the whole picture's inset on the overlay, as a share of its width

  function mount(app, stageEl) {
    const t = app.t;
    const main = h('canvas', { class: 'canvas-main' });
    const overlay = h('canvas', { class: 'canvas-overlay', 'aria-hidden': 'true' });
    const badge = h('div', { class: 'stage-badge', hidden: true });
    // 軽量表示 (§7.4): shown while the adaptive preview draws below full quality.
    const lightBadge = h('div', { class: 'stage-badge stage-light', hidden: true, text: t('play.lightPreview') });
    // 映像を準備中: a paused frame whose video frame is still decoding (§11.4.5 provisional).
    const mediaBadge = h('div', { class: 'stage-badge stage-media', hidden: true, text: t('media.preparing') });
    // The drop target (§11.7.1): while files are dragged over the preview its outline reads 「背景にする（{scope}）」.
    const dropText = h('span', { class: 'stage-drop-text' });
    const dropBox = h('div', { class: 'stage-drop', hidden: true, 'aria-hidden': 'true' }, dropText);
    const wrap = h('div', { class: 'canvas-wrap', tabindex: '0', role: 'img', 'aria-label': t('empty.preview') },
      main, overlay, badge, lightBadge, mediaBadge, dropBox);
    const said = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    const area = h('div', { class: 'preview-area' }, wrap, said);
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
    let lastMedia = false;                 // the last frame drew (or waited for) a photo or video
    let lastProvisional = false;
    let crop = null;                       // { target, drag, wheel } while 切り抜き › 画面で調整 is on (§11.7.6)
    let peekAt = null;                     // { id, m } while a trim handle is dragged (§11.7.7)

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
      if (peekAt) {
        showBackdrop('scene');
        drawPeek();
      } else if (!plan || !plan.cuts || !plan.lines.length) {
        showBackdrop('scene');
        drawIdle();
        lastMedia = lastProvisional = false;
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
        mediaAfter(stats, tNow);
      }
      drawOverlay(plan);
      if (!peekAt) drawMediaNotes(plan, tNow);
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
      if (crop && !alt && !peekAt) { drawCrop(plan, k, dpr); return; }
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
      if (crop) { cropDown(ev, p); return; }
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
      if (crop && crop.drag) { cropMove(ev); return; }
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
      if (crop && crop.drag) { cropUp(); return; }
      if (!press) return;
      if (press.gesture) { press.gesture.end(); suppressClick = true; }
      if (press.mark) { if (press.markGesture && app.shotEdit) app.shotEdit.end(); suppressClick = true; }
      press = null;
    });
    wrap.addEventListener('pointercancel', () => {
      if (crop && crop.drag) cropUp();
      if (press && press.gesture) press.gesture.end();
      if (press && press.markGesture && app.shotEdit) app.shotEdit.end();
      press = null;
    });
    // The wheel over a marker sets its key's closeness (DESIGN_2_1 §6.7).
    wrap.addEventListener('wheel', (ev) => {
      if (crop) { ev.preventDefault(); cropWheel(ev); return; }
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
      if (alt || crop || app.view.state.mode === 'tap') return;
      const p = clickPoint(ev);
      if (!p) return;
      const hits = app.engine.hitTest(p.x, p.y);
      const next = S.onPreviewClick(app.view.state.sel, hits, { alt: ev.altKey, dbl: ev.detail >= 2, plan: app.plan });
      app.select(next, { from: 'preview', open: next.level !== 'work', pause: true, seek: false });
    });

    // --- photos and videos (DESIGN_2_1 §11.7) -------------------------------------------------------------------

    // After a frame: while playing, the store decodes a little ahead (assets.want); a paused frame that waits for a video
    // frame says 映像を準備中 and is drawn again when the store has it ('ready').
    function mediaAfter(stats, tNow) {
      const m = stats && stats.media ? stats.media : null;
      lastMedia = !!m && (m.drawn > 0 || m.waiting > 0);
      lastProvisional = !!(stats && stats.provisional);
      const playing = app.view.state.playing;
      // 映像を準備中 only while a picture this device has is still on its way: one whose bytes are loading, or whose
      // frame is not the exact one yet (a missing or broken picture has its placeholder instead, whatever else waits)
      const coming = !playing && !!m && m.waiting > 0 && (!app.assets || typeof app.engine.mediaAt !== 'function'
        || app.engine.mediaAt(tNow).some((x) => {
          const st = app.assets.info(x.id).state;
          if (st !== 'ok') return st === 'loading';
          const f = app.assets.frame(x.id, x.m, { px: x.px, blur: x.blur || 0, exact: false, thumb: false });
          return !f || !f.exact;
        }));
      mediaBadge.hidden = !coming;
      if (playing && lastMedia && app.assets && typeof app.engine.mediaAt === 'function') {
        const next = lookAhead(app.engine, tNow);
        if (next.length) app.assets.want(next);
      }
    }

    function onMediaEvent() {
      if (peekAt || (!app.view.state.playing && (lastMedia || lastProvisional))) invalidate();
    }
    if (app.assets && typeof app.assets.on === 'function') {
      app.assets.on('ready', onMediaEvent);
      app.assets.on('state', onMediaEvent);
    }

    function entryOf(id) {
      const list = app.doc.media && app.doc.media.list ? app.doc.media.list : [];
      return list.find((e) => e.id === id) || null;
    }

    // Where a picture is drawn at t (design units): the box of the element that shows it (a photo frame's corner, the
    // text for 文字の中に), from the plan's decisions of the cut at t and the engine's boxes; null for a background, an
    // overlay or a material (they cover the frame).
    function mediaBox(plan, tNow, id) {
      const cut = plan.cuts.find((c) => c.t0 <= tNow && tNow < c.t1) || null;
      if (!cut) return null;
      const owners = Object.keys(cut.slots || {}).filter((slot) => /^ornament#\d$/.test(slot)).filter((slot) => {
        const d = cut.slots[slot];
        return !!d && !!d.p && Object.values(d.p).includes(id);
      });
      if (!owners.length) return null;
      const d = cut.slots[owners[0]];
      const b = drawnBoxes().find((x) => x.cut === cut.key && (x.owner === owners[0] || (d.v === 'textFill' && x.owner === 'text')));
      if (!b) return null;
      const xs = [b.quad[0], b.quad[2], b.quad[4], b.quad[6]], ys = [b.quad[1], b.quad[3], b.quad[5], b.quad[7]];
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    }

    // A missing picture (§11.7.8): the engine draws the checkerboard at the element's place; the overlay names it there —
    // 「写真がありません: {name}」 (「動画がありません」 for a video), or 「この動画を再生できませんでした」 for one that cannot
    // be decoded here. A background's plate is in the middle.
    function drawMediaNotes(plan, tNow) {
      if (!lastMedia || !app.assets || !plan || typeof app.engine.mediaAt !== 'function') return;
      const notes = [];
      for (const item of app.engine.mediaAt(tNow)) {
        const info = app.assets.info(item.id);
        const e = entryOf(item.id);
        let text = null;
        if (info.state === 'missing') text = t(e && e.kind === 'video' ? 'media.placeholderVideo' : 'media.placeholder', { name: e ? e.name : '?' });
        else if (info.state === 'error') text = t('media.cannotPlay');
        if (text && !notes.some((n) => n.text === text)) notes.push({ text, at: mediaBox(plan, tNow, item.id) });
      }
      if (!notes.length) return;
      const dpr = overlay.width / Math.max(1, css.w);
      const k = overlay.width / plan.design.w;
      const size = Math.round(13 * dpr);
      const hh = size * 2;
      octx.save();
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.font = '600 ' + size + 'px system-ui, sans-serif';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      const centred = notes.filter((n) => !n.at);
      notes.forEach((n) => {
        const w = octx.measureText(n.text).width + size * 1.6;
        const i = centred.indexOf(n);
        let x = n.at ? n.at.x * k : overlay.width / 2;
        let y = n.at ? n.at.y * k : overlay.height / 2 + (i - (centred.length - 1) / 2) * (hh + 6 * dpr);
        x = Math.max(w / 2 + 4 * dpr, Math.min(overlay.width - w / 2 - 4 * dpr, x));      // the plate stays on the preview
        y = Math.max(hh / 2 + 4 * dpr, Math.min(overlay.height - hh / 2 - 4 * dpr, y));
        octx.fillStyle = 'rgba(15, 17, 21, 0.82)';
        octx.fillRect(x - w / 2, y - hh / 2, w, hh);
        octx.fillStyle = '#ece9e2';
        octx.fillText(n.text, x, y);
      });
      octx.restore();
    }

    // The trim peek (§11.7.7): the source frame at a handle's time, fitted to the preview, instead of the video.
    function drawPeek() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, surface.w, surface.h);
      const e = entryOf(peekAt.id);
      const f = e && app.assets ? app.assets.frame(peekAt.id, peekAt.m, { px: Math.max(surface.w, surface.h), blur: 0, exact: false, thumb: false }) : null;
      if (!f) return;
      const rot = f.rot || 0;
      const k = Math.min(surface.w / f.w, surface.h / f.h);
      const dw = f.w * k, dh = f.h * k;
      ctx.save();
      ctx.translate(surface.w / 2, surface.h / 2);
      ctx.rotate(rot * Math.PI / 180);
      const cw = rot % 180 ? dh : dw, ch = rot % 180 ? dw : dh;
      ctx.drawImage(f.image, -cw / 2, -ch / 2, cw, ch);
      ctx.restore();
    }

    function peek(id, m) {
      const was = !!peekAt;
      peekAt = id ? { id, m: Math.max(0, Number(m) || 0) } : null;
      if (was !== !!peekAt && app.shell) app.shell.playbar.updateStrip();
      invalidate();
    }

    // --- the crop overlay (§11.7.6): drawn on the overlay canvas only ---

    // The drawn place of the target's picture: the box of its owner's picks (the fitted dest rect under the camera),
    // else the frame; and the crop (core/media.fitRect) with the current fit, zoom and focus.
    function cropGeom(plan) {
      const tg = crop.target;
      const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
      const zoom = num(tg.value('cropZoom'), 1), fx = num(tg.value('cropX'), 0.5), fy = num(tg.value('cropY'), 0.5);
      const fit = tg.value('fit') || 'cover';
      const b = drawnBoxes().find((x) => x.owner === tg.owner && (tg.owner === 'ground' || tg.owner === 'atmos' || tg.cutKeys.includes(x.cut)));
      let dest = { x: 0, y: 0, w: plan.design.w, h: plan.design.h };
      if (b) {
        const xs = [b.quad[0], b.quad[2], b.quad[4], b.quad[6]], ys = [b.quad[1], b.quad[3], b.quad[5], b.quad[7]];
        dest = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      }
      const r = MEDIA.fitRect(tg.meta, dest, fit === 'cover' ? 'cover' : 'contain', zoom, fx, fy);
      return { dest, r, zoom, fx, fy };
    }

    function drawCrop(plan, k, dpr) {
      const g = cropGeom(plan);
      const d = { x: g.r.dx * k, y: g.r.dy * k, w: g.r.dw * k, h: g.r.dh * k };
      octx.save();
      // outside the crop, dimmed
      octx.fillStyle = CROP_DIM;
      octx.beginPath();
      octx.rect(0, 0, overlay.width, overlay.height);
      octx.rect(d.x, d.y, d.w, d.h);
      octx.fill('evenodd');
      // its frame, the thirds and the focus cross
      octx.strokeStyle = '#ffffff';
      octx.shadowColor = 'rgba(0,0,0,0.7)';
      octx.shadowBlur = 3 * dpr;
      octx.lineWidth = 1.5 * dpr;
      octx.strokeRect(d.x, d.y, d.w, d.h);
      octx.shadowBlur = 0;
      octx.lineWidth = dpr;
      octx.strokeStyle = 'rgba(255,255,255,0.35)';
      octx.beginPath();
      for (const f of [1 / 3, 2 / 3]) {
        octx.moveTo(d.x + d.w * f, d.y); octx.lineTo(d.x + d.w * f, d.y + d.h);
        octx.moveTo(d.x, d.y + d.h * f); octx.lineTo(d.x + d.w, d.y + d.h * f);
      }
      octx.stroke();
      const W = crop.target.meta.w, H = crop.target.meta.h;
      const cx = d.x + ((g.fx * W - g.r.sx) / Math.max(1e-6, g.r.sw)) * d.w;
      const cy = d.y + ((g.fy * H - g.r.sy) / Math.max(1e-6, g.r.sh)) * d.h;
      const arm = 12 * dpr;
      octx.strokeStyle = '#ffffff';
      octx.lineWidth = 2 * dpr;
      octx.shadowColor = 'rgba(0,0,0,0.7)';
      octx.shadowBlur = 3 * dpr;
      octx.beginPath();
      octx.moveTo(cx - arm, cy); octx.lineTo(cx + arm, cy);
      octx.moveTo(cx, cy - arm); octx.lineTo(cx, cy + arm);
      octx.stroke();
      octx.shadowBlur = 0;
      drawCropMap(g, dpr);
      octx.restore();
    }

    // The whole picture in a corner (the source's frame): the crop framed, the rest dimmed at 40 %.
    function drawCropMap(g, dpr) {
      const img = app.media ? app.media.posterNow(crop.target.id) : null;
      if (!img) { if (app.media) app.media.poster(crop.target.id).then(() => { if (crop) invalidate(); }); return; }
      const W = crop.target.meta.w, H = crop.target.meta.h;
      const mw = overlay.width * MAP_SHARE, mh = mw * H / Math.max(1, W);
      const pad = 10 * dpr;
      const x = pad, y = overlay.height - mh - pad;
      octx.drawImage(img, x, y, mw, mh);
      const s = { x: x + g.r.sx / W * mw, y: y + g.r.sy / H * mh, w: g.r.sw / W * mw, h: g.r.sh / H * mh };
      octx.fillStyle = CROP_DIM;
      octx.beginPath();
      octx.rect(x, y, mw, mh);
      octx.rect(s.x, s.y, s.w, s.h);
      octx.fill('evenodd');
      octx.strokeStyle = '#ffffff';
      octx.lineWidth = 1.5 * dpr;
      octx.strokeRect(s.x, s.y, s.w, s.h);
      octx.strokeStyle = 'rgba(255,255,255,0.5)';
      octx.lineWidth = dpr;
      octx.strokeRect(x, y, mw, mh);
    }

    function snapFocus(v, alt) {
      if (alt) return v;
      for (const x of [0.5, 1 / 3, 2 / 3]) if (Math.abs(v - x) <= CROP_SNAP) return x;
      return v;
    }
    const round3 = (v) => Math.round(v * 1000) / 1000;
    const clamp01 = (v) => Math.max(0, Math.min(1, v));

    // Dragging moves the picture under the pointer (the focus the other way), one gesture for the whole drag.
    function cropDown(ev, p) {
      const plan = app.engine.plan;
      const g = cropGeom(plan);
      crop.drag = { p, fx: g.fx, fy: g.fy, perX: g.r.sw / Math.max(1e-6, g.r.dw) / crop.target.meta.w,
        perY: g.r.sh / Math.max(1e-6, g.r.dh) / crop.target.meta.h, g: null };
      wrap.setPointerCapture(ev.pointerId);
    }
    function cropMove(ev) {
      const p = toDesign(ev);
      const dr = crop.drag;
      if (!p) return;
      if (!dr.g) dr.g = crop.target.gestureOf();
      dr.g.set({ cropX: round3(snapFocus(clamp01(dr.fx - (p.x - dr.p.x) * dr.perX), ev.altKey)),
        cropY: round3(snapFocus(clamp01(dr.fy - (p.y - dr.p.y) * dr.perY), ev.altKey)) });
    }
    function cropUp() {
      const dr = crop.drag;
      crop.drag = null;
      if (dr && dr.g) { dr.g.end(); suppressClick = true; }
    }
    function cropZoomBy(f) {
      const z = crop.target.value('cropZoom');
      const lim = MEDIA.LIMITS.params.cropZoom;
      const next = Math.max(lim[0], Math.min(lim[1], Math.round((typeof z === 'number' ? z : 1) * f * 100) / 100));
      return next;
    }
    // The wheel zooms ×1.05 a notch; the notches of one turn of the wheel are one gesture.
    function cropWheel(ev) {
      if (!crop.wheel) crop.wheel = { g: crop.target.gesture('cropZoom'), timer: 0 };
      const w = crop.wheel;
      w.g.set(cropZoomBy(ev.deltaY < 0 ? CROP_WHEEL : 1 / CROP_WHEEL));
      clearTimeout(w.timer);
      w.timer = setTimeout(() => { w.g.end(); if (crop && crop.wheel === w) crop.wheel = null; }, CROP_WHEEL_END_MS);
    }
    // Keys while the overlay is on and the stage has focus: arrows 1 % (Shift 10 %), + and − zoom, 0 resets, Esc leaves.
    // In tap mode they are the tap session's (D§6.4.15: ←/→ ±3 s, Esc finishes).
    wrap.addEventListener('keydown', (ev) => {
      if (!crop || ev.ctrlKey || ev.metaKey || app.view.state.mode === 'tap') return;
      const tg = crop.target;
      const step = ev.shiftKey ? CROP_STEP_BIG : CROP_STEP;
      const at = (name) => { const v = tg.value(name); return typeof v === 'number' ? v : 0.5; };
      const merge = { mergeKey: 'crop:' + tg.key };
      let handled = true;
      if (ev.key === 'ArrowLeft') tg.set('cropX', round3(clamp01(at('cropX') - step)), merge);
      else if (ev.key === 'ArrowRight') tg.set('cropX', round3(clamp01(at('cropX') + step)), merge);
      else if (ev.key === 'ArrowUp') tg.set('cropY', round3(clamp01(at('cropY') - step)), merge);
      else if (ev.key === 'ArrowDown') tg.set('cropY', round3(clamp01(at('cropY') + step)), merge);
      else if (ev.key === '+' || ev.key === '=' || ev.key === ';') tg.set('cropZoom', cropZoomBy(CROP_WHEEL), merge);
      else if (ev.key === '-' || ev.key === '_') tg.set('cropZoom', cropZoomBy(1 / CROP_WHEEL), merge);
      else if (ev.key === '0') tg.reset();
      else if (ev.key === 'Escape') {
        // D§6.12: Esc gives the focus back to [画面で調整] (its row, if the inspector has drawn it again meanwhile)
        const back = crop.returnTo && crop.returnTo.isConnected ? crop.returnTo
          : document.querySelector('.frow[data-field="' + CSS.escape(tg.fieldId || '') + '"] .w-crop-edit');
        setCrop(null);
        if (back) dom.focus(back);
      } else handled = false;
      if (handled) { ev.preventDefault(); ev.stopPropagation(); }
    });
    // A double-click resets the crop (the three pins go).
    wrap.addEventListener('dblclick', (ev) => { if (crop) { ev.stopImmediatePropagation(); crop.target.reset(); } }, true);

    // setCrop(target | null, returnTo?): the crop overlay on or off. On, the play bar's strip says what the mouse does
    // (with [終わる]) and the live region what the keys do; returnTo is the control that Esc gives the focus back to.
    // Never on in tap mode: the keys, the wheel and a double-click on the preview are the tap session's (D§6.4.15).
    function setCrop(target, returnTo) {
      if (target && app.view.state.mode === 'tap') return;
      if (crop && crop.wheel) { clearTimeout(crop.wheel.timer); crop.wheel.g.end(); }
      if (crop && crop.drag) cropUp();
      crop = target ? { target, drag: null, wheel: null, returnTo: returnTo || null } : null;
      wrap.classList.toggle('is-cropping', !!crop);
      if (crop) said.textContent = t('media.cropKeys');
      app.bus.emit('crop', crop ? crop.target.key : null);
      if (app.shell && app.shell.playbar) app.shell.playbar.updateStrip();
      invalidate();
    }

    // --- the drop target (§11.7.1): files dragged over the preview become its background at the current scope ---

    const hasFiles = (ev) => ev.dataTransfer && [...ev.dataTransfer.types].includes('Files');
    let dropDepth = 0;
    wrap.addEventListener('dragenter', (ev) => {
      if (!hasFiles(ev)) return;
      if (!dropDepth++) {
        dropText.textContent = t('media.dropStage', { scope: app.media ? app.media.scopeText(app.media.where()) : t('area.work') });
        dropBox.hidden = false;
        said.textContent = dropText.textContent;
      }
    });
    wrap.addEventListener('dragleave', () => { dropDepth = Math.max(0, dropDepth - 1); if (!dropDepth) dropBox.hidden = true; });
    wrap.addEventListener('drop', (ev) => {
      dropDepth = 0;
      dropBox.hidden = true;
      if (hasFiles(ev)) ev.mvTarget = 'stage';        // ui/project_io's drop listener imports them for the stage
    });
    window.addEventListener('drop', () => { dropDepth = 0; dropBox.hidden = true; });

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

    // A new selection or the tap mode ends the crop overlay, and so does a new plan in which its element no longer shows
    // its picture (an undo, another part: the target's alive()), before a key could pin a crop nothing shows.
    app.view.on((changed) => {
      if (crop && (changed.includes('sel') || (changed.includes('mode') && app.view.state.mode === 'tap'))) setCrop(null);
    });
    app.bus.on('plan', () => { if (crop && typeof crop.target.alive === 'function' && !crop.target.alive()) setCrop(null); });

    return {
      layout, invalidate, setAlt, fullscreen, focus: () => dom.focus(wrap), element: wrap,
      isDirty: () => dirty, hasAlt: () => !!alt, steppedDown: () => steppedDown,
      crop: setCrop, cropKey: () => (crop ? crop.target.key : null), peek, peeking: () => !!peekAt,
    };
  }

  // lookAhead(engine, t) → the preview's want() list while playing (DESIGN_2_1 §11.4.5 step 1): the media of the frame
  // at t, then of t + k / 30 for k = 1…LOOK_AHEAD (0.27 s), in that order. Every frame on the way is listed: a single
  // time further on let the session close the frames between the shown one and it as they came out, and each was then
  // decoded again from its key frame when it was drawn. media_exact.py plays through this function.
  function lookAhead(engine, t) {
    const out = [];
    for (let k = 0; k <= LOOK_AHEAD; k++) for (const x of engine.mediaAt(t + k / 30)) out.push(x);
    return out;
  }

  return { mount, lookAhead, LOOK_AHEAD };
});
