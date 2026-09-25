/* 文字PVメーカー v2 — original work. 「AIに説明してもらう」: describing the user's photos and videos (Gemini only, after consent) (DESIGN_2_1 §11.6.2, §11.6.4, §11.9.4). */
MV.def('ai/vision', ['core/schema', 'core/media', 'ai/changes'], (S, MEDIA, CH) => {
  'use strict';

  // The only request that carries pixels: downscaled JPEGs the host made (768 px long side, no EXIF), given as image
  // parts that precede the prompt. The prompt holds no lyrics and no file names, only list numbers. The answer is a
  // caption, tags, colours, two boxes and a depth suggestion (how the picture takes part in the animation, §11.9) per
  // picture; it goes into the asset's `ai` field (media.meta), reviewed and undoable like every AI change. The direct
  // tool reads it, and the planner's depth rule takes the suggestion when nothing is pinned.

  const MAX_ITEMS = 8;
  const MAX_FRAMES = 3;                            // a video: frames at 10 %, 50 % and 90 % of the range it uses
  const MAX_CAPTION = MEDIA.LIMITS.captionMax;      // 60
  const MAX_COLORS = MEDIA.LIMITS.colorsMax;        // 5
  const MAX_TAGS = 8;
  const USES = Object.freeze(['ground', 'frame', 'fill', 'overlay']);
  const DEPTHS = MEDIA.DEPTHS;                      // anim front back still (§11.9.4)
  const MAX_REASON = 60;
  const JPEG = 'image/jpeg';
  const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
  const HEX = /^#[0-9A-Fa-f]{6}$/;
  const STRIP = /[\u0000-\u001f\u007f-\u009f|/*#{}[\]<>]/g;   // control characters and lyric / markup syntax

  const STR = { type: 'string' }, NUM = { type: 'number' }, INT = { type: 'integer' };
  const STRS = { type: 'array', items: STR };
  const closed = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
  const BOX = closed({ x: NUM, y: NUM, w: NUM, h: NUM });

  // Portable like every AI schema: objects closed, every property required, no numeric or string limits.
  const VISION_SCHEMA = deepFreeze(closed({ items: { type: 'array', items: closed({ n: INT, caption: STR, captionEn: STR,
    tags: STRS, colors: STRS, subject: BOX, text: BOX, use: { type: 'string', enum: USES.slice() },
    depth: { type: 'string', enum: DEPTHS.slice() }, reason: STR }) } }));

  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }

  function assetOf(doc, id) {
    const all = doc && doc.media && Array.isArray(doc.media.list) ? doc.media.list : [];
    return all.find((e) => e && e.id === id) || null;
  }

  // An inline JPEG part, in the REST spelling (inline_data / mime_type) or the SDK one (inlineData / mimeType);
  // anything else (another type, a file reference, text) is not sent.
  function isJpegPart(p) {
    const x = isObject(p) ? p.inline_data || p.inlineData : null;
    if (!isObject(x)) return false;
    const mime = x.mime_type !== undefined ? x.mime_type : x.mimeType;
    return mime === JPEG && typeof x.data === 'string' && x.data.length > 0 && BASE64.test(x.data);
  }

  const SYSTEM = [
    'You describe pictures for a lyric-motion video tool (文字PV). The pictures are the user\'s own photos and video frames.',
    'For each picture n: caption = what it shows, in Japanese, at most 60 characters; captionEn = the same in English; tags = '
      + 'mood words from the list; colors = up to 5 dominant colours as #RRGGBB; subject = the box of the main subject; text = '
      + 'a calm area where words could sit; use = the best use: ground (a background), frame (a framed photo near the words), '
      + 'fill (a texture inside the letters), overlay (footage over a scene).',
    'depth = how the picture takes part in the animation when it is a background: front only for see-through or overlay '
      + 'footage (light leaks, particles, rain); back for busy or detailed pictures and for videos with strong motion; still '
      + 'for pictures that must stay readable (a logo, text in the picture); anim otherwise. reason = why, in a few words (at '
      + 'most 60 characters, in the language of the captions the user reads).',
    'Boxes are fractions of the picture (x, y from the top left, w, h), all 0 when there is none. Describe only what is '
      + 'visible; never name or identify people.',
  ].join('\n');

  // visionRequest(doc, items: [{ id, parts: [{ inline_data: { mime_type: 'image/jpeg', data } }] }], { uiLang })
  //   → { system, prompt, schema: VISION_SCHEMA, effort: 'low', media: parts, sent: { items: [{ n, id, kind, frames }] } }
  // At most 8 assets that are in the library; a photo sends one image, a video or animation at most three. The image
  // parts go first (D§4.22.1), in the order the prompt lists them.
  function visionRequest(doc, items, opts) {
    const sent = [];
    const media = [];
    for (const item of list(items)) {
      if (sent.length >= MAX_ITEMS) break;
      const entry = isObject(item) ? assetOf(doc, item.id) : null;
      if (!entry || sent.some((x) => x.id === entry.id)) continue;
      const timed = entry.kind === 'video' || entry.anim === true;
      const parts = list(item.parts).filter(isJpegPart).slice(0, timed ? MAX_FRAMES : 1);
      if (!parts.length) continue;
      sent.push({ n: sent.length, id: entry.id, kind: timed ? 'video' : 'photo', frames: parts.length });
      media.push(...parts);
    }
    const lines = sent.map((x) => 'n=' + x.n + ': ' + (x.kind === 'photo' ? 'photo (1 image)'
      : 'video (' + x.frames + (x.frames === 1 ? ' frame' : ' frames, from its start, middle and end') + ')'));
    const prompt = ['The images above, in order:', lines.join('\n'), '', 'Tags (use only these): ' + S.TAGS.join(' ')].join('\n');
    return { system: SYSTEM, prompt, schema: VISION_SCHEMA, effort: 'low', media, sent: { items: sent, lang: opts && opts.uiLang === 'en' ? 'en' : 'ja' } };
  }

  function caption(v, max) {
    const s = typeof v === 'string' ? v.replace(STRIP, ' ').replace(/\s+/g, ' ').trim() : '';
    return Array.from(s).slice(0, max || MAX_CAPTION).join('');
  }

  function q3(x) { const r = Math.round(x * 1000) / 1000; return r === 0 ? 0 : r; }
  function clamp01(x) { return isNumber(x) ? Math.min(1, Math.max(0, x)) : 0; }

  // A box clamped into the picture (w ≤ 1 − x, h ≤ 1 − y); null when it is empty.
  function box(b) {
    if (!isObject(b)) return null;
    const x = q3(clamp01(b.x)), y = q3(clamp01(b.y));
    const w = q3(Math.min(clamp01(b.w), 1 - x)), h = q3(Math.min(clamp01(b.h), 1 - y));
    return w > 0 && h > 0 ? { x, y, w, h } : null;
  }

  // One answer item → the asset's `ai` value (§11.2.1): captions cleaned and cut to 60 characters, tags from the
  // vocabulary, #RRGGBB colours (≤ 5), boxes clamped, and the depth suggestion when it is one of the four values
  // (§11.9.4) with its reason (≤ 60 characters; kept so the asset page can show why, §11.9.5). `use` is advisory: it is
  // shown in the review and not stored.
  function aiOf(item) {
    const tags = [...new Set(list(item.tags).filter((x) => S.TAGS.includes(x)))].slice(0, MAX_TAGS);
    const colors = [...new Set(list(item.colors).filter((x) => typeof x === 'string' && HEX.test(x.trim())).map((x) => x.trim().toUpperCase()))]
      .slice(0, MAX_COLORS);
    const out = { caption: { ja: caption(item.caption), en: caption(item.captionEn) }, tags, colors, subject: box(item.subject), text: box(item.text) };
    if (DEPTHS.includes(item.depth)) {
      out.depth = item.depth;
      const why = caption(item.reason, MAX_REASON);
      if (why) out.reason = why;
    }
    return out;
  }

  // visionChanges(doc, json, sent, { rev }?) → { changes, warnings }: one change of kind 'media' (media.meta { id, ai })
  // per described asset, unless it holds that description already. An item whose n was not sent is warned about.
  function visionChanges(doc, json, sent, opts) {
    const o = opts || {};
    const warnings = [];
    const changes = [];
    if (!isObject(json) || !Array.isArray(json.items)) return { changes, warnings: [['ai.warn.empty', {}]] };
    const items = isObject(sent) ? list(sent.items) : [];
    const done = new Set();
    for (const item of json.items) {
      if (!isObject(item) || !Number.isInteger(item.n) || done.has(item.n)) continue;
      done.add(item.n);
      const s = items.find((x) => x.n === item.n);
      const entry = s ? assetOf(doc, s.id) : null;
      if (!entry) { warnings.push(['ai.warn.mediaUnknown', { name: 'n=' + item.n }]); continue; }
      const ai = MEDIA.normalizeEntry(Object.assign({}, entry, { ai: aiOf(item) })).ai;
      if (MEDIA.entryProblems(Object.assign({}, entry, { ai })).length || CH.sameJSON(ai, entry.ai)) continue;
      changes.push(CH.make(doc, {
        id: 'media:' + entry.id, kind: 'media', scope: 'work', assetId: entry.id, name: entry.name, from: entry.ai, to: ai,
        use: USES.includes(item.use) ? item.use : null, depth: ai.depth || null, reason: ai.depth ? caption(item.reason, MAX_REASON) : '',
        label: ['ai.ch.media', { name: entry.name, caption: ai.caption }],
      }, { rev: o.rev, prefix: o.prefix || '' }));
    }
    return { changes, warnings };
  }

  return { VISION_SCHEMA, MAX_ITEMS, MAX_FRAMES, USES, DEPTHS, visionRequest, visionChanges };
});
