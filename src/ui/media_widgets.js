/* 文字PVメーカー v2 — original work. Media rows of the inspector: the FieldSpecs of a part's media params (source, depth, crop, the video rows) and the media, trim and crop widgets (DESIGN_2_1 §11.7.4, §11.7.5, §11.7.7, §11.9.5). */
MV.def('ui/media_widgets', ['ui/dom', 'ui/icons', 'i18n/t', 'core/media'], (dom, I, T, MEDIA) => {
  'use strict';

  const { h } = dom;
  // The params of the video rows (§11.5.6: video and animation only); clipIn and clipOut are one trim row.
  const VIDEO_PARAMS = Object.freeze(['clipIn', 'clipOut', 'speed', 'loop', 'clock']);
  // Shares shown in % (動きの強さ 10 %, 薄幕 35 %, 色味; DESIGN_2_1 §11.7.4; 速さ 100 % among the video rows), and ぼかし
  // as a plain number.
  const PCT_PARAMS = Object.freeze(['zoom', 'veil', 'tint']);
  const POSTER_W = 128, POSTER_H = 72;       // backing of the 64×36 poster at 2×
  const STRIP_H = 72;
  const SHIFT_S = 1;                         // Shift+←/→ moves a trim handle by this many seconds

  // --- FieldSpecs (pure, Node-tested) ----------------------------------------------------------------------------------

  // The media part a generated row belongs to: { kind, idx, key, src, slot } (src = the name of its media param).
  function mediaOf(gen) {
    const src = gen.find((f) => f.spec && f.spec.type === 'media' && f.param);
    if (!src) return null;
    const p = src.param;
    const slot = p.kind === 'ornament' || p.kind === 'filter' ? p.kind + '#' + p.idx : p.kind;
    return Object.freeze({ kind: p.kind, idx: p.idx, key: p.key, src: p.name, slot });
  }

  // sourcesOf(ctx, media) → the asset ids the context's decisions show in that part's media param (unique, in order).
  function sourcesOf(ctx, media) {
    const plan = ctx && ctx.plan;
    if (!plan || !media) return [];
    const out = [];
    for (const c of ctx.cuts || []) {
      let d = null;
      if (media.kind === 'ground' || media.kind === 'atmos') {
        const g = Array.isArray(plan.grounds) ? plan.grounds[c.ground] : null;
        d = g ? g[media.kind] : null;
      } else d = c.slots ? c.slots[media.slot] : null;
      const id = d && d.v === media.key && d.p ? d.p[media.src] : null;
      if (MEDIA.isId(id) && !out.includes(id)) out.push(id);
    }
    return out;
  }

  // timedIn(ctx, media) → true when a source the context shows is a video or an animation (plan.media[id].kind): the
  // `when` of the video rows (§11.5.6).
  function timedIn(ctx, media) {
    const pm = ctx && ctx.plan && ctx.plan.media ? ctx.plan.media : {};
    return sourcesOf(ctx, media).some((id) => pm[id] && (pm[id].kind === 'video' || pm[id].anim === true));
  }

  // mediaRows(gen) → the rows of a part with a media param, for the element pages (§11.7.4, §11.9.5):
  //   the source first, with the media widget; 動きと重なり right under it, a radiogroup of its five options whose
  //   おまかせ is 自動 (unpin); 拡大 as 切り抜き [画面で調整] with the zoom in %; 動きの強さ, 薄幕 and 色味 in %, ぼかし
  //   without a unit; a background's shared 強さ, which only strengthens its 薄幕, as 薄幕の強さ right after 薄幕; 重ね方
  //   in plain words; 使う範囲 (clipIn and clipOut) as one trim row; the video rows (range, speed, at the end, clock)
  //   marked `video` and shown only when the source is a video or an animation. Rows of other parts come back unchanged.
  function mediaRows(gen) {
    const media = mediaOf(gen);
    if (!media) return gen;
    const byName = new Map(gen.filter((f) => f.param).map((f) => [f.param.name, f]));
    const when = (ctx) => timedIn(ctx, media);
    const out = [];
    const put = (f, extra) => out.push(Object.freeze(Object.assign({}, f, { media }, extra || {})));
    const pct = (f) => ({ scale: 100, spec: Object.freeze(Object.assign({}, f.spec, { unit: 'pct' })) });
    // photoPan draws its veil at veil · (0.6 + 0.4 · amount): for a background the shared 強さ is the veil's strength
    const amount = media.kind === 'ground' ? gen.find((f) => f.param && f.param.shared && f.param.name === 'amount') : null;
    put(byName.get(media.src));
    const depth = byName.get('depth');
    if (depth) put(depth, { radio: true, autoValue: 'auto', depth: true });
    for (const f of gen) {
      const name = f.param ? f.param.name : null;
      if (name === media.src || name === 'depth' || name === 'clipOut' || f === amount) continue;
      if (name === 'clipIn') {
        const clipOut = byName.get('clipOut');
        put(f, { widget: 'trim', label: 'fld.trim', labelText: undefined, video: true, when, trimOut: clipOut ? clipOut.path : null });
      } else if (name === 'cropZoom') {
        put(f, { widget: 'crop', label: 'fld.crop', labelText: undefined, scale: 100 });
      } else if (VIDEO_PARAMS.includes(name)) {
        put(f, Object.assign({ video: true, when }, name === 'speed' ? pct(f) : {}));   // 速さ 100 %
      } else if (f.param && f.param.key === media.key) {
        if (PCT_PARAMS.includes(name)) put(f, pct(f));
        else if (name === 'blur') put(f, { spec: Object.freeze(Object.assign({}, f.spec, { unit: '' })) });
        else if (name === 'blend') put(f, { options: (f.options || []).map((o) => Object.assign({}, o, { label: 'opt.blend.' + o.v })) });
        else put(f);
        if (name === 'veil' && amount) out.push(Object.freeze(Object.assign({}, amount, { label: 'fld.veilAmount', labelText: undefined }, pct(amount))));
      } else out.push(f);                 // shared params of the kind (ink): not media rows
    }
    if (amount && !out.some((f) => f.path === amount.path)) out.push(amount);   // a part without a veil keeps its 強さ
    return out;
  }

  // The asset a media row shows: the pinned or automatic id when the context agrees, else null.
  function shownId(value) { return MEDIA.isId(value) ? value : null; }

  // paramSpec(registry, media, name) → the ParamSpec of another param of a row's media part (the crop overlay's focus
  // and zoom, the trim's end): the part's own spec from the registry, else a number spec of core/media's limits. A
  // sibling never borrows the row's spec (切り抜き is cropZoom, 1–4; cropX and cropY are 0–1).
  function paramSpec(registry, media, name) {
    let list = null;
    if (media && registry && typeof registry.params === 'function') {
      try { list = registry.params(media.kind === 'atmos' ? 'ornament' : media.kind, media.key); } catch (e) { list = null; }
    }
    const p = (list || []).find((x) => x.name === name);
    if (p && p.spec) return p.spec;
    const lim = MEDIA.LIMITS.params[name];
    return lim ? Object.freeze({ type: 'num', min: lim[0], max: lim[1], step: lim[2] }) : null;
  }

  // Trim handle maths (pure). stepFrame(t, dir, pts, fps, dur, quant, edge) → the handle one source frame later (dir +1)
  // or earlier (−1), by the presentation times (else 1 / fps); 0 and dur at the ends. quant is the param's step
  // (clipIn / clipOut: 0.01 s), and the value is one the pin can hold that still means that frame:
  //   edge 'in' (clipIn): t shows the frame whose start is ≤ t; the result is the start of the next / previous frame,
  //     rounded up;
  //   edge 'out' (clipOut): the frames that start before t are shown; one more / one fewer, the end rounded down.
  function stepFrame(t, dir, pts, fps, dur, quant, edge) {
    const x = Number(t) || 0;
    const q = quant > 0 ? quant : 0;
    const out = edge === 'out';
    const hold = (v) => {
      const r = !q ? v : out ? Math.floor(v / q + 1e-6) * q : Math.ceil(v / q - 1e-6) * q;
      return Math.round(Math.min(dur, r) * 1e6) / 1e6;
    };
    let k, n, at;
    if (pts && pts.length) {
      n = pts.length;
      at = (i) => pts[i];
      k = 0;
      if (out) { while (k < n && pts[k] < x - 1e-6) k++; }            // the frames shown before the end
      else { k = -1; while (k + 1 < n && pts[k + 1] <= x + 1e-6) k++; }  // the frame shown at the start
    } else {
      const f = fps > 0 ? 1 / fps : 1 / 30;
      n = Math.max(1, Math.ceil(dur / f - 1e-6));
      at = (i) => i * f;
      k = out ? Math.ceil(x / f - 1e-6) : Math.floor(x / f + 1e-6);
    }
    const j = k + dir;
    if (j <= 0) return 0;
    if (j >= n) return dur;
    return hold(at(j));
  }

  // The range a trim row shows: { a, b } in seconds, b = the end when clipOut is 0 (to the end) or past it.
  function rangeOf(clipIn, clipOut, dur) {
    const d = Math.max(0, Number(dur) || 0);
    const a = Math.max(0, Math.min(d, Number(clipIn) || 0));
    const out = Number(clipOut) || 0;
    const b = out > a ? Math.min(out, d) : d;
    return { a, b };
  }

  // --- the media widget (§11.7.5): poster, name, badges, › → the picker ---------------------------------------------------

  function drawPoster(canvas, img) {
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (!img) return;
    const s = Math.min(canvas.width / img.width, canvas.height / img.height);
    const w = img.width * s, hh = img.height * s;
    g.drawImage(img, (canvas.width - w) / 2, (canvas.height - hh) / 2, w, hh);
  }

  // Poster of an asset into a canvas (the media widget, library rows, picker tiles): '？' while it is not on this device.
  function posterInto(app, canvas, id) {
    canvas.dataset.poster = id || '';
    drawPoster(canvas, null);
    if (!id || !app.media) return;
    const now = app.media.posterNow(id);
    if (now) { drawPoster(canvas, now); return; }
    app.media.poster(id).then((img) => { if (canvas.dataset.poster === id) drawPoster(canvas, img); });
  }

  // The short badges of a media widget: 動画 0:12 · 透明 · GIF (the long badges are on the asset page).
  function shortBadges(t, entry) {
    const out = [];
    if (entry.kind === 'video' || entry.anim) out.push(t(entry.kind === 'video' ? 'media.kind.video' : 'media.kind.anim') + ' '
      + durText(entry.dur));
    if (entry.alpha) out.push(t('media.badge.alpha'));
    if (entry.mime === 'image/gif') out.push(t('media.badge.gif'));
    return out;
  }

  function durText(sec) {
    const x = Math.max(0, Number(sec) || 0);
    return Math.floor(x / 60) + ':' + String(Math.floor(x % 60)).padStart(2, '0');
  }

  function media(field, env) {
    const t = env.t;
    const app = env.app;
    const canvas = h('canvas', { class: 'w-media-poster', width: POSTER_W, height: POSTER_H, 'aria-hidden': 'true' });
    const missing = h('span', { class: 'w-media-q', 'aria-hidden': 'true', text: '？', hidden: true });
    const name = h('span', { class: 'w-media-name ell' });
    const badges = h('span', { class: 'w-media-badges' });
    const btn = h('button', { class: 'w-media', type: 'button', 'aria-haspopup': 'true', 'aria-label': env.label },
      h('span', { class: 'w-media-thumb' }, canvas, missing), h('span', { class: 'w-media-text' }, name, badges), I.icon('next', { size: 16 }));
    btn.addEventListener('click', () => env.open());
    let shown;
    return {
      el: btn,
      focus: () => dom.focus(btn),
      update(st) {
        const id = st.mixed ? null : shownId(st.value);
        const e = id && app.media ? app.media.entry(id) : null;
        const state = e ? app.media.state(id) : null;
        const gone = state === 'missing';
        const text = st.mixed ? t('state.mixed') : e ? e.name : t('fld.none');
        name.textContent = text;
        // この端末にありません, 再生できません (§11.7.9) or the short badges; the accessible name says them too
        const list = !e ? [] : gone ? [t('media.missing')] : (state === 'error' ? [t('media.cannotPlay')] : []).concat(shortBadges(t, e));
        dom.replace(badges, list.map((b) => h('span', { class: ['w-media-badge', b === t('media.cannotPlay') ? 'is-warn' : ''], text: b })));
        missing.hidden = !gone;
        btn.setAttribute('aria-label', [env.label + ': ' + text].concat(list).join(t('media.a11y.sep')));
        btn.disabled = !!st.readOnly;
        const key = (id || '') + (gone ? '?' : '');
        if (key !== shown) { shown = key; posterInto(app, canvas, gone ? null : id); }
      },
    };
  }

  // --- the crop row (§11.7.4): 切り抜き [画面で調整] 拡大 ──●── 100% ------------------------------------------------------------

  // crop(field, env, number) — number: the number widget maker of ui/widgets (the zoom slider in %).
  function crop(field, env, number) {
    const t = env.t;
    const edit = h('button', { class: 'chip-btn w-crop-edit', type: 'button', 'aria-pressed': 'false', text: t('fld.cropEdit') });
    const zoom = number(Object.assign({}, field, { spec: Object.assign({}, field.spec, { unit: 'pct' }) }), Object.assign({}, env,
      { label: env.label + ' ' + t('fld.cropZoom') }));
    const el = h('div', { class: 'w-crop' }, edit, h('span', { class: 'w-crop-zoom muted', text: t('fld.cropZoom') }), zoom.el);
    edit.addEventListener('click', () => { if (env.cropEdit) env.cropEdit(edit.getAttribute('aria-pressed') !== 'true'); });
    return {
      el, scrub: zoom.scrub,
      focus: () => dom.focus(edit),
      update(st) {
        zoom.update(st);
        const on = !!(env.cropActive && env.cropActive());
        edit.setAttribute('aria-pressed', String(on));
        edit.classList.toggle('is-on', on);
        edit.disabled = !!st.readOnly || !(st.extra && st.extra.canCrop);
      },
    };
  }

  // --- the trim widget (§11.7.7) ---------------------------------------------------------------------------------------------

  // 使う範囲  ▮▯▯▯▯▯▯▯▯▯▯▯▮   0:02.10 – 0:09.50  （7.40 秒）  [▶ 範囲を見る]
  // env.other(field.trimOut) → { commit, gesture } of the out handle (clipOut); st.extra = { out, entry }.
  function trim(field, env) {
    const t = env.t;
    const app = env.app;
    const strip = h('canvas', { class: 'w-trim-strip', width: 480, height: STRIP_H, 'aria-hidden': 'true' });
    const shadeA = h('span', { class: 'w-trim-shade', 'aria-hidden': 'true' });
    const shadeB = h('span', { class: 'w-trim-shade', 'aria-hidden': 'true' });
    // the handles are buttons with the slider role: a screen reader passes ← → to them and says their time as a value
    const hIn = h('button', { class: 'w-trim-h is-in', type: 'button', role: 'slider', 'aria-valuemin': '0' });
    const hOut = h('button', { class: 'w-trim-h is-out', type: 'button', role: 'slider', 'aria-valuemin': '0' });
    const bar = h('div', { class: 'w-trim-bar' }, strip, shadeA, shadeB, hIn, hOut);
    const times = h('span', { class: 'w-trim-times mono' });
    const len = h('span', { class: 'w-trim-len muted' });
    const play = h('button', { class: 'chip-btn w-trim-play', type: 'button' }, I.icon('play', { size: 13 }), t('fld.trimPlay'));
    const el = h('div', { class: 'w-trim' }, bar, h('div', { class: 'w-trim-row' }, times, len, h('span', { class: 'grow' }), play));
    let st0 = { value: 0, extra: {} };
    let drag = null;
    // A key press written but not shown yet (the inspector refreshes on the next frame): { which, v, from }. Fast
    // presses step on from it, so three presses of → are three frames.
    let ahead = null;
    let pts = null, ptsFor = null;
    let stripFor;

    const e = () => (st0.extra && st0.extra.entry) || null;
    const dur = () => { const x = e(); return x && x.dur > 0 ? x.dur : 0; };
    const range = () => rangeOf(st0.value, st0.extra ? st0.extra.out : 0, dur());
    const other = () => env.other(field.trimOut);
    const pct = (s) => (dur() > 0 ? (s / dur()) * 100 : 0);

    function layout() {
      const r = range();
      dom.setStyle(hIn, { left: pct(r.a) + '%' });
      dom.setStyle(hOut, { left: pct(r.b) + '%' });
      dom.setStyle(shadeA, { left: 0, width: pct(r.a) + '%' });
      dom.setStyle(shadeB, { left: pct(r.b) + '%', width: (100 - pct(r.b)) + '%' });
      times.textContent = T.fmtTime(r.a) + ' – ' + T.fmtTime(r.b);
      len.textContent = t('media.trimLen', { s: (r.b - r.a).toFixed(2) });
      for (const [btn, v, key] of [[hIn, r.a, 'media.a11y.in'], [hOut, r.b, 'media.a11y.out']]) {
        btn.setAttribute('aria-label', t(key, { time: T.fmtTime(v) }));
        btn.setAttribute('aria-valuemax', String(Math.round(dur() * 100) / 100));
        btn.setAttribute('aria-valuenow', String(Math.round(v * 100) / 100));
        btn.setAttribute('aria-valuetext', T.fmtTime(v));
      }
    }

    function drawStrip() {
      const x = e();
      const key = x ? x.id : '';
      if (key === stripFor) return;
      stripFor = key;
      const g = strip.getContext('2d');
      g.clearRect(0, 0, strip.width, strip.height);
      if (!x || !app.media) return;
      app.media.strip(x.id).then((s) => {
        if (!s || stripFor !== x.id) return;
        const tw = s.image.width / s.tiles;
        const cell = strip.width / s.tiles;
        for (let k = 0; k < s.tiles; k++) {
          const sw = tw, sh = s.image.height;
          const k2 = Math.min(cell / sw, strip.height / sh);
          const dw = sw * k2, dh = sh * k2;
          g.drawImage(s.image, k * tw, 0, sw, sh, k * cell + (cell - dw) / 2, (strip.height - dh) / 2, dw, dh);
        }
      });
    }

    function loadPts() {
      const x = e();
      if (!x || ptsFor === x.id || !app.media) return;
      ptsFor = x.id;
      app.media.tableOf(x.id).then((p) => { if (ptsFor === x.id) pts = p; });
    }

    // A handle value in the document's terms: clipIn in [0, out − one frame]; clipOut in (in, end], 0 meaning the end.
    function clampIn(v) { const r = range(); const f = frameOf(); return Math.max(0, Math.min(r.b - f, v)); }
    function clampOut(v) {
      const r = range(); const f = frameOf();
      const x = Math.max(r.a + f, Math.min(dur(), v));
      return x >= dur() - f / 2 ? 0 : x;
    }
    function frameOf() { const x = e(); return x && x.fps > 0 ? 1 / x.fps : 1 / 30; }

    function write(which, v, o) {
      if (which === 'in') env.commit(clampIn(v), o);
      else other().commit(clampOut(v), o);
    }
    const shownAt = (which) => { const r = range(); return which === 'in' ? r.a : r.b; };
    function at(which) {
      const now = shownAt(which);
      return ahead && ahead.which === which && ahead.from === now ? ahead.v : now;
    }

    function peek(v) {
      const x = e();
      if (x && app.shell && app.shell.stage.peek) app.shell.stage.peek(x.id, v);
    }
    function endPeek() { if (app.shell && app.shell.stage.peek) app.shell.stage.peek(null); }

    // Dragging a handle: one gesture, and the stage peeks at the source frame under it (使う範囲を調整中).
    for (const [btn, which] of [[hIn, 'in'], [hOut, 'out']]) {
      btn.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0 || !dur()) return;
        ev.preventDefault();
        btn.setPointerCapture(ev.pointerId);
        dom.focus(btn);
        drag = { which, g: which === 'in' ? env.gesture() : other().gesture() };
      });
      btn.addEventListener('pointermove', (ev) => {
        if (!drag || drag.which !== which) return;
        const r = bar.getBoundingClientRect();
        const s = Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width))) * dur();
        const v = which === 'in' ? clampIn(s) : clampOut(s);
        drag.g.set(v);
        peek(which === 'in' ? v : (v || dur()) - frameOf() / 2);
      });
      const end = () => { if (drag && drag.which === which) { drag.g.end(); drag = null; endPeek(); } };
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointercancel', end);
      // Keys (§11.7.7): ←/→ one source frame (the sample table), Shift+←/→ one second, Home / End the ends.
      btn.addEventListener('keydown', (ev) => {
        const cur = at(which);
        let v = null;
        if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
          const dir = ev.key === 'ArrowRight' ? 1 : -1;
          v = ev.shiftKey ? cur + dir * SHIFT_S : stepFrame(cur, dir, pts, e() ? e().fps : 30, dur(), field.spec ? field.spec.step : 0, which);
        } else if (ev.key === 'Home') v = 0;
        else if (ev.key === 'End') v = dur();
        if (v === null || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        ev.preventDefault();
        ev.stopPropagation();
        const from = shownAt(which);
        const shown = which === 'in' ? clampIn(v) : clampOut(v) || dur();
        write(which, v, { mergeKey: 'trim:' + which + ':' + field.id });
        ahead = { which, v: shown, from };
      });
      btn.addEventListener('focus', loadPts);
    }
    play.addEventListener('click', () => { if (env.playRange) env.playRange(); });

    return {
      el,
      focus: () => dom.focus(hIn),
      update(st) {
        st0 = st;
        if (ahead && shownAt(ahead.which) !== ahead.from) ahead = null;   // the written value is shown now
        layout();
        drawStrip();
        const off = !!st.readOnly || !dur();
        hIn.disabled = hOut.disabled = off;
        play.disabled = !env.playRange;
      },
    };
  }

  return { VIDEO_PARAMS, PCT_PARAMS, mediaOf, sourcesOf, timedIn, mediaRows, shownId, paramSpec, stepFrame, rangeOf, shortBadges, posterInto,
    drawPoster, media, crop, trim };
});
