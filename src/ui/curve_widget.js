/* 文字PVメーカー v2 — original work. The curve widget (緩急): presets, eases, the かんたん ramp and custom Bézier / speed-step curves on a small canvas (DESIGN_2_1 §6.6). */
MV.def('ui/curve_widget', ['ui/dom', 'ui/icons', 'core/curve', 'core/ease'], (dom, I, CV, E) => {
  'use strict';

  const { h } = dom;

  // --- the choices of the select ---------------------------------------------------------------------------------

  // 自動 · the 7 presets (in the order of the §4.1 table) · 一定 · the other eases · かんたん · カスタム.
  const PRESET_ORDER = Object.freeze(['softEnds', 'hushRushHush', 'holdThenDash', 'dashStop', 'slowBloom', 'fadeBrake',
    'snapSettle']);
  const OTHER_EASES = Object.freeze(E.EASES.filter((e) => e !== 'linear'));
  const CHOICES = Object.freeze(['auto'].concat(PRESET_ORDER, ['linear'], OTHER_EASES, ['simple', 'custom']));
  // かんたん starts at 「最初と最後は一瞬遅く、途中はすごく速い」 (§4.1: 10 % of the time covers 2 % of the way).
  const DEFAULT_RAMP = Object.freeze({ edge: 0.1, ends: 'both', peak: 6 });
  const EDGE = Object.freeze([0, 0.4]);
  const PEAK_LOG2 = Object.freeze([-3, 3]);         // peak 0.125–8 on a log slider
  const BZ_Y = Object.freeze([-0.5, 1.5]);
  const SPEED_MAX = 8;
  const STEP = 0.01, STEP_BIG = 0.1;                // arrow keys; Shift ×10
  // Time-warp fields (§6.6): an overshoot does not show there, only position curves use it.
  const TIME_WARP = /(^|\.)flow$|^dwell\.curve$|^seam\.curve$/;
  const PAD = 8;                                    // canvas padding (CSS px)
  const PLOT_H = 80;
  const PLAY_MS = 1200;

  // Bézier stand-ins for the eases when they turn into a custom curve (the usual CSS approximations; an ease with
  // oscillations reads as the nearest overshooting Bézier).
  const EASE_BZ = Object.freeze({
    linear: [0.333, 0.333, 0.667, 0.667],
    sineIn: [0.12, 0, 0.39, 0], sineOut: [0.61, 1, 0.88, 1], sineInOut: [0.37, 0, 0.63, 1],
    quadIn: [0.11, 0, 0.5, 0], quadOut: [0.5, 1, 0.89, 1], quadInOut: [0.45, 0, 0.55, 1],
    cubicIn: [0.32, 0, 0.67, 0], cubicOut: [0.33, 1, 0.68, 1], cubicInOut: [0.65, 0, 0.35, 1],
    expoIn: [0.7, 0, 0.84, 0], expoOut: [0.16, 1, 0.3, 1], expoInOut: [0.87, 0, 0.13, 1],
    backIn: [0.36, 0, 0.66, -0.5], backOut: [0.34, 1.5, 0.64, 1], backInOut: [0.68, -0.5, 0.32, 1.5],
    elasticOut: [0.34, 1.5, 0.64, 1], bounceOut: [0.16, 1, 0.3, 1], springOut: [0.34, 1.5, 0.64, 1],
    steps: [0.333, 0.333, 0.667, 0.667],
  });

  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function q3(x) { const r = Math.round(x * 1000) / 1000; return r === 0 ? 0 : r; }

  // --- pure helpers (Node-tested) ------------------------------------------------------------------------------------

  // formOf(curve) → 'preset' | 'ease' | 'simple' | 'bz' | 'sp' (an unreadable value reads as the ease 'linear').
  function formOf(v) {
    const c = CV.coerce(v);
    if (c === undefined) return 'ease';
    if (typeof c === 'string') return PRESET_ORDER.includes(c) ? 'preset' : 'ease';
    if (c.ramp) return 'simple';
    return c.bz ? 'bz' : 'sp';
  }

  // choiceOf(curve, auto) → the select's value: 'auto', a preset or ease name, 'simple' or 'custom'.
  function choiceOf(v, auto) {
    if (auto) return 'auto';
    const form = formOf(v);
    if (form === 'preset' || form === 'ease') { const c = CV.coerce(v); return c === undefined ? 'linear' : c; }
    return form === 'simple' ? 'simple' : 'custom';
  }

  // The curve's data as a custom form: presets expand to their Bézier or speed steps, a ramp to its speed steps, an
  // ease to its Bézier stand-in. `form` ('bz' | 'sp') converts between the two custom forms.
  function toCustom(v, form) {
    const c = CV.coerce(v) === undefined ? 'linear' : CV.coerce(v);
    let data;
    if (typeof c === 'string' && !PRESET_ORDER.includes(c)) data = { bz: (EASE_BZ[c] || EASE_BZ.linear).slice() };
    else {
      const x = CV.expand(c);
      data = x.bz ? { bz: x.bz.slice() } : { sp: x.sp.map((k) => k.slice()) };
    }
    if (form === 'sp' && data.bz) data = bzToSp(data.bz);
    if (form === 'bz' && data.sp) data = spToBz(data.sp);
    return CV.coerce(data);
  }

  // A Bézier as speed steps: its speed at seven even times (speeds are kept ≥ 0, so an overshoot flattens).
  function bzToSp(bz) {
    const knots = [];
    for (let i = 0; i <= 6; i++) {
      const u = i / 6;
      knots.push([q3(u), q3(clamp(CV.speedAt({ bz }, u), 0, SPEED_MAX))]);
    }
    if (!knots.some((k) => k[1] > 0)) return { sp: [[0, 1], [1, 1]] };
    return { sp: knots };
  }

  // Speed steps as a Bézier whose end slopes are the end speeds (a cubic Hermite with handles at 1/3 and 2/3).
  function spToBz(sp) {
    const c = { sp };
    const s0 = CV.speedAt(c, 0), s1 = CV.speedAt(c, 1);
    return { bz: [0.333, q3(clamp(s0 / 3, BZ_Y[0], BZ_Y[1])), 0.667, q3(clamp(1 - s1 / 3, BZ_Y[0], BZ_Y[1]))] };
  }

  // valueForChoice(choice, current) → the curve to pin, or null for 自動 (unpin).
  function valueForChoice(choice, current) {
    if (choice === 'auto') return null;
    if (choice === 'simple') return formOf(current) === 'simple' ? CV.coerce(current) : CV.coerce({ ramp: DEFAULT_RAMP });
    if (choice === 'custom') {
      const form = formOf(current);
      return form === 'bz' || form === 'sp' ? CV.coerce(current) : toCustom(current);
    }
    return CV.coerce(choice) === undefined ? null : CV.coerce(choice);
  }

  // rampOf(curve) → its { edge, ends, peak }, or the default ramp for any other curve.
  function rampOf(v) {
    const c = CV.coerce(v);
    return c && typeof c === 'object' && c.ramp ? c.ramp : DEFAULT_RAMP;
  }

  // withRamp(curve, patch) → the ramp with the patch (edge 0–0.4, peak 0.125–8), canonical.
  function withRamp(v, patch) {
    const r = Object.assign({}, rampOf(v), patch || {});
    return CV.coerce({ ramp: { edge: clamp(r.edge, EDGE[0], EDGE[1]), ends: r.ends, peak: clamp(r.peak, 0.125, 8) } });
  }

  // The handles of a custom (or custom-able) curve: Bézier → its two control points (x, y); speed steps → every knot
  // (u, s), the first and last fixed in time.
  function handlesOf(v) {
    const c = CV.coerce(v);
    if (!c || typeof c !== 'object' || c.ramp) return handlesOf(toCustom(v));
    if (c.bz) return [{ i: 0, kind: 'bz', x: c.bz[0], y: c.bz[1] }, { i: 1, kind: 'bz', x: c.bz[2], y: c.bz[3] }];
    const n = c.sp.length;
    return c.sp.map((k, i) => ({ i, kind: 'sp', x: k[0], y: k[1], fixedX: i === 0 || i === n - 1 }));
  }

  // moveHandle(curve, i, x, y) → the custom curve with handle i at (x, y), clamped (Bézier x 0–1, y −0.5–1.5; a knot
  // stays between its neighbours in time, speed 0–8). A result the grammar refuses (no area left) keeps the curve.
  function moveHandle(v, i, x, y) {
    const c = toCustomKeep(v);
    if (c.bz) {
      const bz = c.bz.slice();
      bz[i * 2] = q3(clamp(x, 0, 1));
      bz[i * 2 + 1] = q3(clamp(y, BZ_Y[0], BZ_Y[1]));
      return CV.coerce({ bz }) || c;
    }
    const sp = c.sp.map((k) => k.slice());
    const n = sp.length;
    if (i < 0 || i >= n) return c;
    const lo = i === 0 ? 0 : sp[i - 1][0], hi = i === n - 1 ? 1 : sp[i + 1][0];
    sp[i][0] = i === 0 ? 0 : i === n - 1 ? 1 : q3(clamp(x, lo, hi));
    sp[i][1] = q3(clamp(y, 0, SPEED_MAX));
    return CV.coerce({ sp }) || c;
  }

  // nudgeHandle(curve, i, dx, dy) → moveHandle by a step (the arrow keys).
  function nudgeHandle(v, i, dx, dy) {
    const hs = handlesOf(v);
    const hd = hs[i];
    return hd ? moveHandle(v, i, hd.x + dx, hd.y + dy) : toCustomKeep(v);
  }

  function toCustomKeep(v) {
    const f = formOf(v);
    return f === 'bz' || f === 'sp' ? CV.coerce(v) : toCustom(v);
  }

  // addKnot(curve, i) → speed steps with a knot halfway between knot i and the next (Enter); at most 8 knots.
  function addKnot(v, i) {
    const c = toCustomKeep(v);
    if (!c.sp || c.sp.length >= CV.MAX_KNOTS) return c;
    const j = Math.min(i, c.sp.length - 2);
    const a = c.sp[j], b = c.sp[j + 1];
    return insertKnot(c.sp, j + 1, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]) || c;
  }

  // addKnotAt(curve, u, s) → speed steps with a knot at time u (a double-click on the canvas); at most 8 knots.
  function addKnotAt(v, u, s) {
    const c = toCustomKeep(v);
    if (!c.sp || c.sp.length >= CV.MAX_KNOTS || !(u > 0 && u < 1)) return c;
    let at = c.sp.findIndex((k) => k[0] > u);
    if (at <= 0) at = c.sp.length - 1;
    return insertKnot(c.sp, at, [u, clamp(s, 0, SPEED_MAX)]) || c;
  }

  function insertKnot(sp, at, knot) {
    const next = sp.map((k) => k.slice());
    next.splice(at, 0, [q3(knot[0]), q3(knot[1])]);
    return CV.coerce({ sp: next });
  }

  // removeKnot(curve, i) → speed steps without knot i (Delete). The first and last knots stay; so do two knots.
  function removeKnot(v, i) {
    const c = toCustomKeep(v);
    if (!c.sp || c.sp.length <= 2 || i <= 0 || i >= c.sp.length - 1) return c;
    const next = c.sp.filter((k, j) => j !== i);
    return CV.coerce({ sp: next }) || c;
  }

  // positionOnly(path, curve) → true when the curve overshoots on a time-warp field (§6.6 「位置の動きだけ」).
  function positionOnly(path, v) {
    if (!TIME_WARP.test(String(path || ''))) return false;
    const c = CV.coerce(v);
    if (c === 'snapSettle') return true;
    if (typeof c === 'string') return /^(back|elastic|spring)/.test(c);
    return !!(c && c.bz && (c.bz[1] < 0 || c.bz[1] > 1 || c.bz[3] < 0 || c.bz[3] > 1));
  }

  // The display ranges of a curve: positions [lo, hi] (at least 0–1, wider for overshoots and Bézier handles) and the
  // top speed of the speed fill. A drag keeps the ranges it started with, so the plot never rescales under the pointer.
  function rangesOf(v) {
    const samples = CV.sample(v, 64);
    let lo = 0, hi = 1, smax = 0;
    for (let i = 0; i < samples.length; i++) { lo = Math.min(lo, samples[i]); hi = Math.max(hi, samples[i]); }
    for (const hd of handlesOf(v)) {
      if (hd.kind === 'bz') { lo = Math.min(lo, hd.y); hi = Math.max(hi, hd.y); } else smax = Math.max(smax, hd.y);
    }
    const k = speedScale(v);
    for (let i = 0; i <= 32; i++) smax = Math.max(smax, CV.speedAt(v, i / 32) * k);
    const pad = (hi - lo) * 0.06;
    return { lo: lo - pad, hi: hi + pad, smax: Math.max(2, Math.ceil(smax * 1.15 * 2) / 2) };
  }

  // speedScale(curve) → the factor from core/curve's speed (mean 1) to the units the handles use: speed steps are drawn
  // in their own knot units (so the fill runs through the handles), a Bézier's speed as it is.
  function speedScale(v) {
    const hs = handlesOf(v);
    if (!hs.length || hs[0].kind !== 'sp') return 1;
    let area = 0;
    for (let i = 1; i < hs.length; i++) area += (hs[i].x - hs[i - 1].x) * (hs[i].y + hs[i - 1].y) / 2;
    return area > 1e-9 ? area : 1;
  }

  // Canvas geometry (CSS px): the plot box, positions and speeds to pixels and back.
  function geometry(w, hh, ranges) {
    const box = { x: PAD, y: PAD, w: Math.max(1, w - 2 * PAD), h: Math.max(1, hh - 2 * PAD) };
    const r = ranges;
    return {
      box,
      px: (u) => box.x + u * box.w,
      posY: (v) => box.y + (r.hi - v) / (r.hi - r.lo) * box.h,
      speedY: (s) => box.y + box.h - s / r.smax * box.h,
      u: (px) => (px - box.x) / box.w,
      pos: (py) => r.hi - (py - box.y) / box.h * (r.hi - r.lo),
      speed: (py) => (box.y + box.h - py) / box.h * r.smax,
    };
  }

  function handleXY(g, hd) {
    return { x: g.px(hd.x), y: hd.kind === 'bz' ? g.posY(hd.y) : g.speedY(hd.y) };
  }

  // curveText(t, curve) → the curve in words: core/curve.label with the params that are string keys (an ease's family
  // and direction) resolved.
  function curveText(t, v) {
    const [key, params] = CV.label(v);
    const args = {};
    for (const k of Object.keys(params || {})) {
      const x = params[k];
      args[k] = typeof x === 'string' && t.has(x) ? t(x) : x;
    }
    return t(key, args);
  }

  // The text of a choice (the select states the curve in words, §6.10).
  function choiceText(t, choice, v, auto) {
    if (choice === 'auto') return auto ? t('curve.autoOf', { name: curveText(t, v) }) : t('curve.auto');
    if (choice === 'simple') return formOf(v) === 'simple' && !auto ? curveText(t, v) : t('curve.simple');
    if (choice === 'custom') {
      const f = formOf(v);
      return (f === 'bz' || f === 'sp') && !auto ? curveText(t, v) : t('curve.custom');
    }
    return curveText(t, choice);
  }

  // --- the widget ------------------------------------------------------------------------------------------------------

  const OWN = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', 'Delete', 'Backspace', 'Escape']);

  // make(field, env) → { el, update(state), focus() }: the ui/widgets contract. field.compact → the select only (the
  // keyframe editor's per-key curve).
  function make(field, env) {
    const t = env.t;
    const path = field.path || '';
    const compact = !!field.compact;
    const select = h('select', { class: 'select w-select cw-select', 'aria-label': env.label });
    const optionEls = CHOICES.map((c) => h('option', { value: c }));
    const mixedOpt = h('option', { value: 'mixed', text: t('state.mixed'), disabled: true });
    select.append(mixedOpt, ...optionEls);
    const reduced = dom.prefersReducedMotion();
    const play = h('button', { class: 'icon-btn small cw-play', type: 'button', title: t('curve.play'), 'aria-label': t('curve.play'),
      disabled: reduced }, I.icon('play', { size: 14 }));
    const canvas = h('canvas', { class: 'cw-canvas', 'aria-hidden': 'true' });
    const handleLayer = h('div', { class: 'cw-handles', role: 'group', 'aria-label': env.label });
    const plot = h('div', { class: 'cw-plot' }, canvas, handleLayer);
    const note = h('p', { class: 'note subtle cw-note', hidden: true, text: t('curve.positionOnly') });
    // かんたん: ゆっくりにする所 [最初と最後|最初|最後], ゆっくりの長さ, 速さの差.
    const endsBtns = CV.RAMP_ENDS.map((e) => h('button', { class: 'seg', type: 'button', role: 'radio', 'data-ends': e,
      'aria-checked': 'false', tabindex: '-1' }, t('curve.' + e)));
    const ends = h('div', { class: 'segmented cw-seg cw-ends', role: 'radiogroup', 'aria-label': t('curve.ends') }, endsBtns);
    const edge = h('input', { class: 'w-range', type: 'range', min: '0', max: String(EDGE[1] * 100), step: '1', 'aria-label': t('curve.edge') });
    const edgeText = h('output', { class: 'cw-val mono' });
    const peak = h('input', { class: 'w-range', type: 'range', min: String(PEAK_LOG2[0]), max: String(PEAK_LOG2[1]), step: '0.05',
      'aria-label': t('curve.peak') });
    const peakText = h('output', { class: 'cw-val mono' });
    const simple = h('div', { class: 'cw-simple', hidden: true },
      h('div', { class: 'cw-line' }, h('span', { class: 'cw-lab', text: t('curve.ends') }), ends),
      h('label', { class: 'cw-line' }, h('span', { class: 'cw-lab', text: t('curve.edge') }), edge, edgeText),
      h('label', { class: 'cw-line' }, h('span', { class: 'cw-lab', text: t('curve.peak') }), peak, peakText));
    // カスタム: 形 (ベジェ | 速さの段) and the double-click hint.
    const formBtns = ['bz', 'sp'].map((f) => h('button', { class: 'seg', type: 'button', role: 'radio', 'data-form': f,
      'aria-checked': 'false', tabindex: '-1' }, t('curve.form.' + f)));
    const forms = h('div', { class: 'segmented cw-seg cw-forms', role: 'radiogroup', 'aria-label': t('curve.custom') }, formBtns);
    const hint = h('p', { class: 'note subtle cw-hint', text: t('curve.hint') });
    const custom = h('div', { class: 'cw-custom', hidden: true }, forms, hint);
    const el = compact ? h('div', { class: 'w-curve is-compact' }, select)
      : h('div', { class: 'w-curve' }, select, h('div', { class: 'cw-row' }, plot, play), note, simple, custom);

    let st = { value: 'linear', auto: true, mixed: false, readOnly: false };
    let cur = 'linear';                       // the curve shown (the pinned or automatic value)
    let drag = null;                          // { g, i, ranges }
    let slide = null;                         // a slider's gesture
    let playing = 0;
    let size = { w: 0, h: PLOT_H };
    let handles = [];

    const commit = (v, o) => { if (v === null) env.unpin(); else env.commit(v, o); };

    // --- select ---
    select.addEventListener('change', () => {
      if (select.value === 'mixed') return;
      commit(valueForChoice(select.value, cur));
    });

    // --- かんたん ---
    const radioKeys = (group, btns, apply) => group.addEventListener('keydown', (ev) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const at = Math.max(0, btns.indexOf(document.activeElement));
      const to = (at + (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : btns.length - 1)) % btns.length;
      dom.focus(btns[to]);
      apply(btns[to]);
    });
    const setEnds = (b) => commit(withRamp(cur, { ends: b.dataset.ends }));
    endsBtns.forEach((b) => b.addEventListener('click', () => setEnds(b)));
    radioKeys(ends, endsBtns, setEnds);
    const setForm = (b) => { const next = toCustom(cur, b.dataset.form); if (next) commit(next); };
    formBtns.forEach((b) => b.addEventListener('click', () => setForm(b)));
    radioKeys(forms, formBtns, setForm);

    // Slider drags are one gesture each (one undo entry); keyboard steps merge per field.
    function slider(input, valueOf) {
      input.addEventListener('keydown', (ev) => { if (ev.key.startsWith('Arrow') || ev.key === 'Home' || ev.key === 'End') ev.stopPropagation(); });
      input.addEventListener('pointerdown', () => { if (!slide) slide = env.gesture(); });
      input.addEventListener('input', () => {
        const v = withRamp(cur, valueOf());
        cur = v;
        showSimple();
        draw();
        if (slide) slide.set(v); else env.commit(v, { merge: true });
      });
      const end = () => { if (slide) { slide.end(); slide = null; } };
      input.addEventListener('change', end);
      input.addEventListener('pointerup', end);
      input.addEventListener('pointercancel', end);
    }
    slider(edge, () => ({ edge: Number(edge.value) / 100 }));
    slider(peak, () => ({ peak: Math.pow(2, Number(peak.value)) }));

    // --- handles ---
    function handleLabel(hd) {
      return hd.kind === 'bz' ? t('curve.handle', { i: hd.i + 1, x: Math.round(hd.x * 100) / 100, y: Math.round(hd.y * 100) / 100 })
        : t('curve.point', { i: hd.i + 1, u: Math.round(hd.x * 100), s: Math.round(hd.y * 100) / 100 });
    }

    function syncHandles(g) {
      const list = st.mixed ? [] : handlesOf(cur);
      const focusedAt = handles.indexOf(document.activeElement);
      while (handles.length > list.length) handles.pop().remove();
      while (handles.length < list.length) {
        const b = h('button', { class: 'cw-h', type: 'button' });
        wireHandle(b);
        handleLayer.appendChild(b);
        handles.push(b);
      }
      list.forEach((hd, k) => {
        const b = handles[k];
        const p = handleXY(g, hd);
        b.dataset.i = String(k);
        b.dataset.kind = hd.kind;
        b.setAttribute('aria-label', handleLabel(hd));
        b.disabled = !!st.readOnly;
        dom.setStyle(b, { left: p.x, top: p.y });
      });
      if (focusedAt >= 0 && handles[Math.min(focusedAt, handles.length - 1)]) dom.focus(handles[Math.min(focusedAt, handles.length - 1)]);
    }

    function wireHandle(b) {
      b.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0 || st.readOnly) return;
        ev.preventDefault();
        dom.focus(b);
        // Dragging a preset, an ease or a ramp turns it into its data (custom) within the same gesture.
        drag = { g: env.gesture(), i: Number(b.dataset.i), ranges: rangesOf(cur), base: toCustomKeep(cur) };
        b.setPointerCapture(ev.pointerId);
      });
      b.addEventListener('pointermove', (ev) => {
        if (!drag) return;
        const r = canvas.getBoundingClientRect();
        const g = geometry(r.width, r.height, drag.ranges);
        const hd = handlesOf(drag.base)[drag.i];
        if (!hd) return;
        const x = g.u(ev.clientX - r.left);
        const y = hd.kind === 'bz' ? g.pos(ev.clientY - r.top) : g.speed(ev.clientY - r.top);
        const v = moveHandle(drag.base, drag.i, x, y);
        drag.base = v;
        cur = v;
        draw(drag.ranges);
        drag.g.set(v);
      });
      const end = () => { if (drag) { drag.g.end(); drag = null; } };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
      b.addEventListener('keydown', (ev) => {
        if (!OWN.has(ev.key) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        const i = Number(b.dataset.i);
        const step = ev.shiftKey ? STEP_BIG : STEP;
        let v = null;
        if (ev.key === 'ArrowLeft') v = nudgeHandle(cur, i, -step, 0);
        else if (ev.key === 'ArrowRight') v = nudgeHandle(cur, i, step, 0);
        else if (ev.key === 'ArrowUp') v = nudgeHandle(cur, i, 0, step);
        else if (ev.key === 'ArrowDown') v = nudgeHandle(cur, i, 0, -step);
        else if (ev.key === 'Enter' && formOf(cur) === 'sp') v = addKnot(cur, i);
        else if ((ev.key === 'Delete' || ev.key === 'Backspace') && formOf(cur) === 'sp') v = removeKnot(cur, i);
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); dom.focus(select); return; }
        // Enter and Delete belong to the handle even where they do nothing (a Bézier has no knots to add or remove):
        // Delete must not reach the app's 「固定を外す」 of the whole row.
        ev.preventDefault();
        ev.stopPropagation();
        if (!v || st.readOnly || (!st.auto && CV.keyOf(v) === CV.keyOf(cur))) return;
        cur = v;
        draw();
        env.commit(v, { merge: true });
      });
    }

    // A double-click on the plot adds a speed step there (speed-step curves only).
    canvas.addEventListener('dblclick', (ev) => {
      if (st.readOnly || st.mixed || formOf(cur) !== 'sp') return;
      const r = canvas.getBoundingClientRect();
      const g = geometry(r.width, r.height, rangesOf(cur));
      const v = addKnotAt(cur, g.u(ev.clientX - r.left), g.speed(ev.clientY - r.top));
      if (CV.keyOf(v) !== CV.keyOf(cur)) env.commit(v);
    });

    // --- drawing ---
    function measure() {
      const r = canvas.getBoundingClientRect();
      size = { w: Math.round(r.width) || size.w, h: Math.round(r.height) || PLOT_H };
      return size.w > 0;
    }

    function draw(frozen, dotU) {
      if (compact) return;
      if (!measure()) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = size.w, H = size.h;
      if (canvas.width !== Math.round(W * dpr)) canvas.width = Math.round(W * dpr);
      if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
      const g2 = canvas.getContext('2d');
      g2.setTransform(dpr, 0, 0, dpr, 0, 0);
      g2.clearRect(0, 0, W, H);
      const ranges = frozen || rangesOf(cur);
      const g = geometry(W, H, ranges);
      g2.fillStyle = '#101318';
      g2.fillRect(0, 0, W, H);
      // 0 and 1 guides
      g2.strokeStyle = 'rgba(242,239,232,0.14)';
      g2.lineWidth = 1;
      g2.setLineDash([3, 3]);
      for (const v of [0, 1]) { g2.beginPath(); g2.moveTo(g.box.x, g.posY(v)); g2.lineTo(g.box.x + g.box.w, g.posY(v)); g2.stroke(); }
      g2.setLineDash([]);
      if (st.mixed) return syncHandles(g);
      // speed: the filled area
      g2.fillStyle = 'rgba(124,196,255,0.22)';
      g2.beginPath();
      g2.moveTo(g.px(0), g.speedY(0));
      const N = 64;
      const k = speedScale(cur);
      for (let i = 0; i <= N; i++) g2.lineTo(g.px(i / N), g.speedY(clamp(CV.speedAt(cur, i / N) * k, 0, ranges.smax)));
      g2.lineTo(g.px(1), g.speedY(0));
      g2.closePath();
      g2.fill();
      // position: the line
      const pos = CV.sample(cur, 96);
      g2.strokeStyle = '#f0b64d';
      g2.lineWidth = 2;
      g2.beginPath();
      for (let i = 0; i < pos.length; i++) {
        const x = g.px(i / (pos.length - 1)), y = g.posY(pos[i]);
        if (i) g2.lineTo(x, y); else g2.moveTo(x, y);
      }
      g2.stroke();
      // Bézier arms
      const f = formOf(cur);
      const hs = handlesOf(cur);
      g2.strokeStyle = 'rgba(242,239,232,0.35)';
      g2.lineWidth = 1;
      if (hs[0] && hs[0].kind === 'bz') {
        g2.beginPath(); g2.moveTo(g.px(0), g.posY(0)); g2.lineTo(g.px(hs[0].x), g.posY(hs[0].y)); g2.stroke();
        g2.beginPath(); g2.moveTo(g.px(1), g.posY(1)); g2.lineTo(g.px(hs[1].x), g.posY(hs[1].y)); g2.stroke();
      }
      if (dotU !== undefined) {
        g2.fillStyle = '#e8573f';
        g2.beginPath();
        g2.arc(g.px(dotU), g.posY(CV.fn(cur)(dotU)), 5, 0, Math.PI * 2);
        g2.fill();
      }
      el.dataset.form = f;
      syncHandles(g);
    }

    play.addEventListener('click', () => {
      if (dom.prefersReducedMotion() || playing) return;
      const start = performance.now();
      const step = () => {
        const u = Math.min(1, (performance.now() - start) / PLAY_MS);
        draw(undefined, u);
        playing = u < 1 ? requestAnimationFrame(step) : 0;
        if (!playing) draw();
      };
      playing = requestAnimationFrame(step);
    });

    function showSimple() {
      const r = rampOf(cur);
      endsBtns.forEach((b) => {
        const on = b.dataset.ends === r.ends;
        b.setAttribute('aria-checked', String(on));
        b.tabIndex = on ? 0 : -1;
        b.disabled = !!st.readOnly;
      });
      if (!slide) { edge.value = String(Math.round(r.edge * 100)); peak.value = String(Math.log2(r.peak)); }
      edgeText.textContent = Math.round(r.edge * 100) + '%';
      peakText.textContent = '×' + (Math.round(r.peak * 100) / 100);
      edge.disabled = peak.disabled = !!st.readOnly;
    }

    if (typeof ResizeObserver === 'function' && !compact) new ResizeObserver(() => { if (!drag) draw(); }).observe(plot);

    return {
      el,
      focus: () => dom.focus(select),
      update(state) {
        st = state || st;
        const v = CV.coerce(st.value);
        if (!drag && !slide) cur = v === undefined ? 'linear' : v;
        const choice = st.mixed ? 'mixed' : choiceOf(cur, !!st.auto);
        CHOICES.forEach((c, k) => { optionEls[k].textContent = choiceText(t, c, cur, !!st.auto && c === 'auto'); });
        mixedOpt.hidden = choice !== 'mixed';
        if (document.activeElement !== select) select.value = choice;
        select.disabled = !!st.readOnly;
        if (compact) return;
        const form = st.mixed ? null : formOf(cur);
        simple.hidden = st.auto || form !== 'simple';
        custom.hidden = st.auto || !(form === 'bz' || form === 'sp');
        hint.hidden = form !== 'sp';
        formBtns.forEach((b) => {
          const on = b.dataset.form === form;
          b.setAttribute('aria-checked', String(on));
          b.tabIndex = on ? 0 : -1;
          b.disabled = !!st.readOnly;
        });
        if (!simple.hidden) showSimple();
        note.hidden = st.mixed || !positionOnly(path, cur);
        play.disabled = reduced || !!st.mixed;
        if (!drag) draw();
      },
    };
  }

  return {
    CHOICES, PRESET_ORDER, DEFAULT_RAMP, EASE_BZ, make, formOf, choiceOf, toCustom, bzToSp, spToBz, valueForChoice, rampOf,
    withRamp, handlesOf, moveHandle, nudgeHandle, addKnot, addKnotAt, removeKnot, positionOnly, rangesOf, geometry, choiceText,
    curveText, speedScale,
  };
});
