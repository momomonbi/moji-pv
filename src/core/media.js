/* 文字PVメーカー v2 — original work. Photos and videos: asset entries, references, the media time model and fit math (DESIGN_2_1 §11.2, §11.3.2, §11.4.2, §11.5.2). */
MV.def('core/media', ['core/num', 'core/hash'], (N, H) => {
  'use strict';

  // An asset is addressed by its content: 'a' + the first 24 hex digits of the SHA-256 of its bytes. The document
  // keeps metadata only (doc.media.list, schema 2); the bytes live on the device and in the .mojipv package.
  // Everything here is pure, so the engine (time map, fit) and the reducers (references) share one definition.

  const PROBE_V = 1, INDEX_V = 1;
  const KINDS = Object.freeze(['image', 'video']);
  const FITS = Object.freeze(['cover', 'contain', 'soft']);
  const EDGES = Object.freeze(['mirror', 'zoom', 'plain']);
  const MOVES = Object.freeze(['auto', 'none', 'push', 'pull', 'drift']);
  const LOOPS = Object.freeze(['loop', 'hold']);
  const CLOCKS = Object.freeze(['show', 'song']);
  const COLORS = Object.freeze(['srgb', 'bt709', 'bt601', 'bt2020', 'p3', 'other']);
  const ROTATIONS = Object.freeze([0, 90, 180, 270]);
  const TAGS = Object.freeze(['soft', 'hard', 'fast', 'slow', 'playful', 'serious', 'digital', 'organic', 'literary',
    'bold', 'minimal', 'busy', 'dark', 'bright', 'retro', 'wet', 'airy']);   // D§4.18.1 (the vision tool's tags)
  const MB = 1024 * 1024;
  const LIMITS = deepFreeze({
    // §11.2.8
    imageBytes: 60 * MB, imagePixels: 40e6, animFrames: 600, animLong: 2048,
    videoBytes: 4 * 1024 * MB, videoLong: 4096, videoPixels: 4096 * 2176, videoDur: 3600, videoFps: 120,
    alphaVideo: [1920, 1080], library: 200, libraryBytes: 96 * 1024, warnTotal: 2 * 1024 * MB, warnFile: 1024 * MB,
    gopSlow: 5, nameMax: 80, captionMax: 60, colorsMax: 5,
    // §11.4.6 still tiers, §11.4.2 EPS_MEDIA
    tiers: [512, 1024, 2048, 4096, 6144, 8192], tierPixels: 24e6, eps: 1e-4, holdBack: 0.001,
    // §11.5.6 param ranges [min, max, step]
    params: {
      cropZoom: [1, 4, 0.01], cropX: [0, 1, 0.005], cropY: [0, 1, 0.005], zoom: [0, 0.4, 0.01], pan: [-180, 180, 1],
      blur: [0, 60, 0.5], veil: [0, 0.9, 0.01], tint: [0, 1, 0.01], clipIn: [0, 3600, 0.01], clipOut: [0, 3600, 0.01],
      speed: [0.25, 4, 0.05],
    },
  });
  const ID = /^a[0-9a-f]{24}$/;
  const KEY = /^myMed[0-9a-f]{10}$/;
  const HEX = /^#[0-9A-Fa-f]{6}$/;
  const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
  const ORDER = Object.freeze(['id', 'kind', 'name', 'mime', 'bytes', 'w', 'h', 'dur', 'fps', 'frames', 'rot', 'alpha',
    'anim', 'audio', 'codec', 'color', 'hdr', 'pv', 'pool', 'ai']);
  const AI_ORDER = Object.freeze(['caption', 'tags', 'colors', 'subject', 'text', 'depth', 'reason']);
  // The vision tool's suggestion for how the asset takes part in the animation (§11.9.4): kept only when it is one of these.
  const DEPTHS = Object.freeze(['anim', 'front', 'back', 'still']);
  const META_ORDER = Object.freeze(['kind', 'w', 'h', 'dur', 'fps', 'frames', 'rot', 'alpha', 'anim']);

  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
  function q3(x) { const r = Math.round(x * 1000) / 1000; return r === 0 ? 0 : r; }
  function isId(v) { return typeof v === 'string' && ID.test(v); }

  // The derived part key of a pooled asset (§11.5.9): 'myMed' + the first 10 hex digits of the id.
  function keyOf(id) { return 'myMed' + String(id).slice(1, 11); }

  // The asset id behind a derived key, through doc.media (the first entry whose key matches); null when none.
  function idOfKey(key, doc) {
    if (typeof key !== 'string' || !KEY.test(key)) return null;
    const list = doc && doc.media && Array.isArray(doc.media.list) ? doc.media.list : [];
    for (const e of list) if (e && isId(e.id) && keyOf(e.id) === key) return e.id;
    return null;
  }

  // --- entries (§11.2.1) --------------------------------------------------------------------------------------------

  function text(v, max) {
    return typeof v === 'string' && v.length >= 1 && Array.from(v).length <= max && !CONTROL.test(v);
  }

  function isBox01(b) {
    return isObject(b) && ['x', 'y', 'w', 'h'].every((k) => isNumber(b[k]) && b[k] >= 0 && b[k] <= 1)
      && b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9;
  }

  // Problems of one asset entry as readable strings ([] when valid): types, ranges, the id pattern (§11.2.1, §11.2.8).
  function entryProblems(entry) {
    const out = [];
    const bad = (field, what) => { out.push(field + ': ' + what); };
    if (!isObject(entry)) return ['entry: must be an object'];
    const e = entry;
    if (!isId(e.id)) bad('id', "must be 'a' + 24 lowercase hex digits");
    if (!KINDS.includes(e.kind)) { bad('kind', 'must be image or video'); return out; }
    const video = e.kind === 'video';
    const anim = e.anim === true;
    if (!text(e.name, LIMITS.nameMax)) bad('name', '1–' + LIMITS.nameMax + ' characters without control characters');
    if (typeof e.mime !== 'string' || !new RegExp('^' + e.kind + '/[a-z0-9.+-]+$').test(e.mime)) bad('mime', 'must be ' + e.kind + '/…');
    const maxBytes = video ? LIMITS.videoBytes : LIMITS.imageBytes;
    if (!Number.isInteger(e.bytes) || e.bytes < 1 || e.bytes > maxBytes) bad('bytes', 'must be an integer 1–' + maxBytes);
    if (!Number.isInteger(e.w) || e.w < 1 || !Number.isInteger(e.h) || e.h < 1) bad('w/h', 'must be integers ≥ 1');
    else if (video && (Math.max(e.w, e.h) > LIMITS.videoLong || e.w * e.h > LIMITS.videoPixels)) bad('w/h', 'video frame too large');
    else if (!video && e.w * e.h > LIMITS.imagePixels) bad('w/h', 'image too large');
    else if (anim && Math.max(e.w, e.h) > LIMITS.animLong) bad('w/h', 'animation too large');
    if (video || anim) {
      if (!isNumber(e.dur) || e.dur <= 0 || e.dur > LIMITS.videoDur) bad('dur', 'must be a number in (0, ' + LIMITS.videoDur + ']');
      if (!isNumber(e.fps) || e.fps <= 0 || e.fps > LIMITS.videoFps) bad('fps', 'must be a number in (0, ' + LIMITS.videoFps + ']');
      if (!Number.isInteger(e.frames) || e.frames < 1 || (anim && e.frames > LIMITS.animFrames)) bad('frames', 'must be an integer ≥ 1');
    } else {
      for (const k of ['dur', 'fps', 'frames']) if (e[k] !== null) bad(k, 'must be null for a still');
    }
    if (!ROTATIONS.includes(e.rot) || (!video && e.rot !== 0)) bad('rot', video ? 'must be 0, 90, 180 or 270' : 'must be 0 for images');
    for (const k of ['alpha', 'anim', 'audio', 'hdr', 'pool']) if (typeof e[k] !== 'boolean') bad(k, 'must be a boolean');
    if (video && e.anim === true) bad('anim', 'must be false for a video');
    if (!video && e.audio === true) bad('audio', 'must be false for an image');
    if (video ? !(typeof e.codec === 'string' && e.codec !== '' && !CONTROL.test(e.codec)) : e.codec !== null) {
      bad('codec', video ? 'must be a codec string' : 'must be null for an image');
    }
    if (!COLORS.includes(e.color)) bad('color', 'must be one of ' + COLORS.join(' '));
    if (!Number.isInteger(e.pv) || e.pv < 1) bad('pv', 'must be an integer ≥ 1');
    if (e.ai !== null) for (const p of aiProblems(e.ai)) bad('ai' + p[0], p[1]);
    return out;
  }

  function aiProblems(ai) {
    const out = [];
    if (!isObject(ai)) return [['', 'must be null or a vision result']];
    const cap = ai.caption;
    if (!isObject(cap) || !['ja', 'en'].every((k) => typeof cap[k] === 'string' && Array.from(cap[k]).length <= LIMITS.captionMax
      && !CONTROL.test(cap[k]))) out.push(['.caption', 'must be { ja, en } of ≤ ' + LIMITS.captionMax + ' characters']);
    if (!Array.isArray(ai.tags) || !ai.tags.every((t) => TAGS.includes(t))) out.push(['.tags', 'must list vocabulary tags']);
    if (!Array.isArray(ai.colors) || ai.colors.length > LIMITS.colorsMax || !ai.colors.every((c) => typeof c === 'string' && HEX.test(c))) {
      out.push(['.colors', 'must list ≤ ' + LIMITS.colorsMax + ' #RRGGBB colours']);
    }
    for (const k of ['subject', 'text']) if (ai[k] !== null && !isBox01(ai[k])) out.push(['.' + k, 'must be null or a box of fractions']);
    // §11.9.5: why the AI suggests that depth, shown on the asset page next to it.
    if (ai.reason !== undefined && !(typeof ai.reason === 'string' && Array.from(ai.reason).length <= LIMITS.captionMax
      && !CONTROL.test(ai.reason))) out.push(['.reason', 'must be a text of ≤ ' + LIMITS.captionMax + ' characters']);
    return out;
  }

  // The entry with q3 numbers and the field order of §11.2.1 (unknown fields dropped), deep-frozen. Assumes a valid entry.
  function normalizeEntry(entry) {
    const out = {};
    for (const k of ORDER) {
      let v = entry[k];
      if (v === undefined) continue;
      if ((k === 'dur' || k === 'fps') && isNumber(v)) v = q3(v);
      if (k === 'ai' && isObject(v)) v = normalizeAi(v);
      out[k] = v;
    }
    return deepFreeze(out);
  }

  function normalizeAi(ai) {
    const out = {};
    for (const k of AI_ORDER) {
      if (ai[k] === undefined || (k === 'depth' && !DEPTHS.includes(ai[k]))) continue;
      // The reason belongs to the depth: kept only with a valid depth, and only as text.
      if (k === 'reason' && (typeof ai[k] !== 'string' || !ai[k] || !DEPTHS.includes(ai.depth))) continue;
      let v = ai[k];
      if (k === 'caption' && isObject(v)) v = { ja: v.ja, en: v.en };
      else if (k === 'colors' && Array.isArray(v)) v = v.map((c) => (typeof c === 'string' ? c.toUpperCase() : c));
      else if ((k === 'subject' || k === 'text') && isObject(v)) v = { x: q3(v.x), y: q3(v.y), w: q3(v.w), h: q3(v.h) };
      else if (Array.isArray(v)) v = v.slice();
      out[k] = v;
    }
    return out;
  }

  // The plan subset of an entry (§11.2.6).
  function metaOf(entry) {
    const out = {};
    for (const k of META_ORDER) out[k] = entry[k] === undefined ? null : entry[k];
    return Object.freeze(out);
  }

  // --- references (§11.2.4) ----------------------------------------------------------------------------------------

  // { pins, materials }: pins whose value is the id or its derived key, pins part-qualified with the key (…@key…),
  // avoid pins listing '<kind>.<key>', and material ids whose recipe has a media layer with this src. Strings only.
  function refsOf(doc, id) {
    const key = keyOf(id);
    const pins = [];
    const all = doc && isObject(doc.pins) ? doc.pins : {};
    for (const path of Object.keys(all).sort()) {
      const pin = all[path];
      const v = pin ? pin.v : undefined;
      if (v === id || v === key || usesKey(path, key) || (Array.isArray(v) && v.some((x) => refIs(x, key)))) pins.push(path);
    }
    const materials = [];
    const list = doc && doc.materials && Array.isArray(doc.materials.list) ? doc.materials.list : [];
    for (const m of list) if (m && isObject(m.recipe) && recipeUses(m.recipe, id)) materials.push(m.id);
    return { pins, materials };
  }

  // True when the slot of the path is part-qualified with `key` ('…:ground@myMed3f9c2d17b0.blur').
  function usesKey(path, key) {
    const colon = path.indexOf(':');
    if (colon < 0) return false;
    const m = /@([A-Za-z0-9]+)/.exec(path.slice(colon + 1));
    return !!m && m[1] === key;
  }

  function refIs(item, key) {
    return typeof item === 'string' && item.slice(item.indexOf('.') + 1) === key && item.indexOf('.') > 0;
  }

  function recipeUses(recipe, id) {
    return Array.isArray(recipe.layers) && recipe.layers.some((l) => isObject(l) && l.prim === 'media' && l.src === id);
  }

  // --- time (§11.4.2, FROZEN math) -----------------------------------------------------------------------------------

  // timeSpec(meta, p, origin) → { clock, origin, clipIn, end, speed, loop, frame } in seconds, or null for stills.
  // p = the resolved media params (clipIn, clipOut, speed, loop, clock); origin = 0 (ground scenes) or times.a (cuts).
  function timeSpec(meta, p, origin) {
    if (!meta || !(meta.kind === 'video' || meta.anim === true)) return null;
    const q = p || {};
    const dur = isNumber(meta.dur) && meta.dur > 0 ? meta.dur : 0;
    const frame = isNumber(meta.fps) && meta.fps > 0 ? 1 / meta.fps : 1 / 30;
    const R = LIMITS.params;
    const clipIn = N.clamp(isNumber(q.clipIn) ? q.clipIn : 0, 0, Math.max(0, dur - frame));
    const clipOut = isNumber(q.clipOut) ? N.clamp(q.clipOut, R.clipOut[0], R.clipOut[1]) : 0;
    return Object.freeze({
      clock: CLOCKS.includes(q.clock) ? q.clock : 'show',
      origin: isNumber(origin) ? origin : 0,
      clipIn,
      end: clipOut > clipIn ? Math.min(clipOut, dur) : dur,
      speed: N.clamp(isNumber(q.speed) ? q.speed : 1, R.speed[0], R.speed[1]),
      loop: LOOPS.includes(q.loop) ? q.loop : 'loop',
      frame,
    });
  }

  // Media seconds m for the element: `tau` is the scene-local time for clock 'show' (the origin is subtracted here)
  // and the absolute frame time for clock 'song'. Closed form, so any frame can be rendered first.
  function mapTime(T, tau) {
    const t = T.clock === 'song' ? tau : tau - T.origin;
    const span = Math.max(T.frame, T.end - T.clipIn);
    const x = Math.max(0, t) * T.speed;
    if (T.loop === 'hold') return T.clipIn + Math.min(x, span - LIMITS.holdBack);
    return T.clipIn + (x - span * Math.floor(x / span));
  }

  // --- fit (§11.5.2, FROZEN math) -------------------------------------------------------------------------------------

  // fitRect(meta, box, fit, zoom, fx, fy, out?) → { sx, sy, sw, sh (source, displayed px), dx, dy, dw, dh (dest, du),
  // bx, by, bw, bh (box, du) }. cover fills the box and crops about the focus (fx, fy); contain shows the whole source
  // (its overflow, when zoomed, is placed by the focus); 'soft' is contain (the blurred cover copy is drawn separately).
  function fitRect(meta, box, fit, zoom, fx, fy, out) {
    const r = out || {};
    const W = Math.max(1, meta.w), Hh = Math.max(1, meta.h);
    const bx = box.x, by = box.y, bw = Math.max(0, box.w), bh = Math.max(0, box.h);
    const z = Math.max(1, isNumber(zoom) ? zoom : 1);
    const fX = N.clamp(isNumber(fx) ? fx : 0.5), fY = N.clamp(isNumber(fy) ? fy : 0.5);
    r.bx = bx; r.by = by; r.bw = bw; r.bh = bh;
    if (fit !== 'contain' && fit !== 'soft') {
      const s = z * Math.max(bw / W, bh / Hh);
      const sw = s > 0 ? Math.min(W, bw / s) : W, sh = s > 0 ? Math.min(Hh, bh / s) : Hh;
      r.sx = N.clamp(fX * W - sw / 2, 0, W - sw);
      r.sy = N.clamp(fY * Hh - sh / 2, 0, Hh - sh);
      r.sw = sw; r.sh = sh;
      r.dx = bx; r.dy = by; r.dw = bw; r.dh = bh;
      return r;
    }
    const s = z * Math.min(bw / W, bh / Hh);
    const dw = W * s, dh = Hh * s;
    const dx = bx + (bw - dw) * (dw > bw ? fX : 0.5);
    const dy = by + (bh - dh) * (dh > bh ? fY : 0.5);
    const x0 = Math.max(dx, bx), y0 = Math.max(dy, by);
    const x1 = Math.min(dx + dw, bx + bw), y1 = Math.min(dy + dh, by + bh);
    r.dx = x0; r.dy = y0; r.dw = Math.max(0, x1 - x0); r.dh = Math.max(0, y1 - y0);
    if (s > 0) {
      r.sx = N.clamp((x0 - dx) / s, 0, W); r.sy = N.clamp((y0 - dy) / s, 0, Hh);
      r.sw = Math.min(W - r.sx, r.dw / s); r.sh = Math.min(Hh - r.sy, r.dh / s);
    } else {
      r.sx = 0; r.sy = 0; r.sw = 0; r.sh = 0;
    }
    return r;
  }

  // The still size tier (long side, px) for a node that needs `needPx` device pixels (§11.4.6): the smallest tier ≥ need,
  // capped at the source long side and at 24 MP. Monotone in needPx.
  function tier(needPx, meta) {
    const long = Math.max(1, Math.max(meta.w, meta.h)), short = Math.max(1, Math.min(meta.w, meta.h));
    const need = isNumber(needPx) ? needPx : 0;
    let px = LIMITS.tiers[LIMITS.tiers.length - 1];
    for (const t of LIMITS.tiers) if (t >= need) { px = t; break; }
    const cap = Math.floor(Math.sqrt(LIMITS.tierPixels * long / short));
    return Math.max(1, Math.min(px, long, cap));
  }

  // A stable hash of the plan subset (mediaTerms, §11.2.6).
  function metaHash(entry) { return H.hashJSON(metaOf(entry)); }

  return {
    PROBE_V, INDEX_V, KINDS, FITS, EDGES, MOVES, LOOPS, CLOCKS, COLORS, LIMITS, ID, ORDER, AI_ORDER, DEPTHS,
    isId, keyOf, idOfKey, entryProblems, normalizeEntry, refsOf, metaOf, metaHash, timeSpec, mapTime, fitRect, tier,
  };
});
