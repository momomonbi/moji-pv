/* 文字PVメーカー v2 — original work. The user's photos and videos near the words: photo frame, inside the text, overlay footage (DESIGN_2_1 §11.5.7, §11.9). */
MV.def('parts/ornament/media', ['parts/kit'], (K) => {
  'use strict';

  // Every part here is pool: false (it shows only where a user, the AI or a material pins it) and needs: ['media'].
  // The picture itself is always drawn by K.media, which also applies the depth (§11.9.3: layer, camera factor, Ken
  // Burns, look) and the clip's time; a part with no picture (src '' or not in the plan's media) builds nothing.

  const TEXT_ROLES = ['lyric', 'focus', 'title', 'outro'];   // text-bound decorations also dress title and outro cards
  const EASE_OUT = K.ease('cubicOut');
  const DEG = K.math.DEG;
  const SHADOW_INK = '#000000';
  const SHADOW_STEPS = 4;           // the stepped shadow: 4 offset copies of the outline, alpha 0.08 each, no filter
  const SHADOW_ALPHA = 0.08;
  const SHADOW_STEP = 0.015;        // × short side × shadow: the offset of one step (4 steps: 0.024 short at shadow 0.4)
  const ROUND = 0.12;               // corner radius of the round shape, × the frame's shorter side
  const MARGIN = 0.03;              // × short side: the gap a side or corner frame keeps from the text and the safe edge
  const MIN_SIDE = 0.12;            // × short side: a free band smaller than this takes no frame (it goes to the corner)
  const SLIDE = 0.06;               // × short side: how far a frame slides in from
  const GROW = 0.8;                 // a growing frame starts at this scale
  const MIN_APPEAR = 0.3;           // s: the shortest entrance of a frame (an instant text entrance still shows it arrive)
  const SLOW_FADE = 0.4;            // s: a fading frame blooms this much longer than the text's entrance
  const BLEED = 0.15;               // overlay footage covers the frame plus this share on every side (camera moves)
  const BLEND_COMP = Object.freeze({ screen: 'screen', multiply: 'multiply', overlay: 'overlay', normal: 'over' });
  const APPEAR = Object.freeze({ fade: 0, grow: 1, slide: 2 });
  const L2 = (ja, en) => ({ ja, en });

  // The params of a media part: the source and the depth first (the element page shows the depth right under the source
  // row, §11.9.5), then the part's own params, then the other K.mediaParams of its use (§11.5.6 order).
  function mediaFirst(use, own) {
    const all = K.mediaParams({ use });
    const out = {};
    for (const name of ['src', 'depth']) if (all[name]) out[name] = all[name];
    Object.assign(out, own);
    for (const name of Object.keys(all)) if (!(name in out)) out[name] = all[name];
    return out;
  }

  // The plan's MediaMeta of a source, or null (no picture: the part builds nothing).
  function metaOf(env, src) {
    return typeof src === 'string' && src !== '' && env.media && Object.prototype.hasOwnProperty.call(env.media, src)
      ? env.media[src] : null;
  }

  // --- photoFrame geometry ---------------------------------------------------------------------------------------------

  // The frame's box (w × h du, centred on its origin): the long side is size × short; a circle is square; an arch is
  // upright (never wider than 0.85 of its height); the other shapes take the picture's own aspect (within 1:2 and 2:1),
  // so the default fit (cover) shows the whole picture.
  function frameSize(shape, meta, s) {
    if (shape === 'circle') return { w: s, h: s };
    const aspect = meta.w > 0 && meta.h > 0 ? meta.w / meta.h : 1;
    const a = shape === 'arch' ? K.math.clamp(aspect, 0.5, 0.85) : K.math.clamp(aspect, 0.5, 2);
    return a >= 1 ? { w: s, h: s / a } : { w: s * a, h: s };
  }

  // The outline of a shape as path commands, around the box (w × h) centred on (dx, dy). null for 'free': the picture's
  // own alpha is the cut-out, so there is no outline to clip, stroke or shadow.
  function outline(shape, w, h, dx, dy) {
    const x0 = dx - w / 2, y0 = dy - h / 2, x1 = dx + w / 2, y1 = dy + h / 2, q = Math.PI / 2;
    switch (shape) {
      case 'rect': return [['R', x0, y0, w, h]];
      case 'round': {
        const r = ROUND * Math.min(w, h);
        return [['M', x0 + r, y0], ['L', x1 - r, y0], ['A', x1 - r, y0 + r, r, -q, 0], ['L', x1, y1 - r],
          ['A', x1 - r, y1 - r, r, 0, q], ['L', x0 + r, y1], ['A', x0 + r, y1 - r, r, q, 2 * q], ['L', x0, y0 + r],
          ['A', x0 + r, y0 + r, r, 2 * q, 3 * q], ['Z']];
      }
      case 'circle': return [['E', dx, dy, w / 2, h / 2]];
      case 'arch': {
        const r = w / 2;
        return [['M', x0, y1], ['L', x0, y0 + r], ['A', dx, y0 + r, r, 2 * q, 4 * q], ['L', x1, y1], ['Z']];
      }
      default: return null;
    }
  }

  // Where the frame goes: { cx, cy, k (scale of the box), layer }. behind: on the text block, in the far layer; side: in
  // the free band around the text where it fits largest, keeping MARGIN from the text and the band's edges (the corner
  // when no band takes at least MIN_SIDE); corner: the lower right of the safe area, scaled into that quarter; free: the
  // middle of the frame, moved by the element's nudge (el.ornament#i.nudge).
  function placeOf(env, place, w, h) {
    const D = env.D, m = MARGIN * D.short;
    const f = env.hints && env.hints.focus;
    const focus = f && [f.x, f.y, f.w, f.h].every(Number.isFinite) ? f : { x: D.cx, y: D.cy, w: 0, h: 0 };
    if (place === 'behind') return { cx: focus.x + focus.w / 2, cy: focus.y + focus.h / 2, k: 1, layer: 'far' };
    if (place === 'free') return { cx: D.cx, cy: D.cy, k: 1, layer: 'mid' };
    if (place === 'side') {
      let best = null;
      for (const b of (env.hints && env.hints.free) || []) {
        const k = Math.min(1, (b.w - 2 * m) / w, (b.h - 2 * m) / h);
        if (k * Math.max(w, h) >= MIN_SIDE * D.short && (!best || k > best.k)) best = { cx: b.x + b.w / 2, cy: b.y + b.h / 2, k, layer: 'mid' };
      }
      if (best) return best;
    }
    const sx0 = D.safe.l, sy0 = D.safe.t, sx1 = D.w - D.safe.r, sy1 = D.h - D.safe.b;
    const k = Math.min(1, ((sx1 - sx0) / 2 - m) / w, ((sy1 - sy0) / 2 - m) / h);
    return { cx: sx1 - m - (k * w) / 2, cy: sy1 - m - (k * h) / 2, k, layer: 'mid' };
  }

  // The layer the picture is drawn on at its effective depth (§11.9.3, the FROZEN table K.media applies): in front →
  // near, pushed back → far, otherwise as placed. The frame's border and shadow go on the same layer, so they stay
  // with the picture in the draw order ('auto' is resolved by the planner; the kit reads it as anim for a frame). Only
  // media nodes carry a camera factor, so at front, back and still the border and the shadow see the layer's own camera
  // (NOTES v2.1-G.3, requests to B).
  function depthLayer(depth, placed) {
    return depth === 'front' ? 'near' : depth === 'back' ? 'far' : placed;
  }

  // --- behaviours (module level, pure in t, allocation-free) ------------------------------------------------------------

  // The border and the shadow take the picture's own pose (K.media's Ken Burns and its depth fade), so the frame moves
  // as one: their base pose is the picture's (the identity in the frame group, their offsets are in their paths), and
  // this behaviour is added after K.media's, so it runs after them in the same phase.
  function runTrack(P, t, b) {
    const m = b.media;
    for (let k = 0; k < b.nodes.length; k++) {
      const i = b.nodes[k];
      P.px[i] = P.px[m]; P.py[i] = P.py[m];
      P.x[i] += P.x[m]; P.y[i] += P.y[m];
      P.sx[i] *= P.sx[m]; P.sy[i] *= P.sy[m];
      P.alpha[i] *= P.alpha[m];
    }
  }

  // The frame's own entrance over [s, s + d] (the text's entrance; the exit is the automatic follow-text envelope):
  // fade blooms in, grow scales up from GROW, slide comes in from (dx, dy).
  function runAppear(P, t, b) {
    const u = K.math.clamp((t - b.s) / b.d), k = EASE_OUT(u), i = b.from;
    if (b.mode === APPEAR.fade) P.alpha[i] *= K.math.smooth(u);
    else if (b.mode === APPEAR.grow) { const s = b.grow + (1 - b.grow) * k; P.sx[i] *= s; P.sy[i] *= s; }
    else { P.x[i] += b.dx * (1 - k); P.y[i] += b.dy * (1 - k); }
  }

  // --- photoFrame -------------------------------------------------------------------------------------------------------

  const photoFrame = K.ornament({
    key: 'photoFrame', scope: 'cut', follow: 'text', pool: false,
    label: L2('写真の枠', 'Photo frame'),
    blurb: L2('写真や動画を枠に入れて文字のそばに置く（選んだときだけ）', 'Your photo or video in a frame near the words (only when chosen)'),
    tags: ['soft'],
    needs: ['media'],
    traits: { roles: TEXT_ROLES },
    params: mediaFirst('frame', {
      place: { type: 'enum', of: ['behind', 'side', 'corner', 'free'], label: L2('置き方', 'Placement'), auto: { value: 'side' } },
      size: { type: 'num', min: 0.15, max: 1, step: 0.01, unit: 'frac', label: L2('大きさ', 'Size'), auto: { value: 0.42 } },
      shape: { type: 'enum', of: ['rect', 'round', 'circle', 'arch', 'free'], label: L2('形', 'Shape'), auto: { value: 'round' } },
      border: { type: 'num', min: 0, max: 40, step: 1, unit: 'du', label: L2('縁の太さ', 'Border'), auto: { value: 10 } },
      borderInk: { type: 'ink', label: L2('縁の色', 'Border color'), auto: { value: 'ground' } },
      shadow: { type: 'num', min: 0, max: 1, step: 0.01, label: L2('影', 'Shadow'), auto: { value: 0.4 } },
      tilt: { type: 'num', min: -15, max: 15, step: 0.5, unit: 'deg', label: L2('傾き', 'Tilt'), auto: { range: [-4, 4] } },
      appear: { type: 'enum', of: ['fade', 'grow', 'slide', 'none'], label: L2('出方', 'Entrance'), auto: { value: 'grow' } },
    }),
    build(env, p) {
      const meta = metaOf(env, p.src);
      if (!meta) return;
      const { sb, D } = env;
      const size = frameSize(p.shape, meta, p.size * D.short);
      const at = placeOf(env, p.place, size.w, size.h);
      const w = size.w * at.k, h = size.h * at.k;
      const group = sb.group({ layer: depthLayer(p.depth, at.layer), x: at.cx, y: at.cy, rot: p.tilt * DEG, owner: env.owner });
      const cmds = outline(p.shape, w, h, 0, 0);
      const companions = [];
      if (cmds && p.shadow > 0) {
        const step = SHADOW_STEP * D.short * p.shadow;
        for (let k = 1; k <= SHADOW_STEPS; k++) {
          companions.push(sb.shape({ parent: group, owner: env.owner, path: K.shape.path(outline(p.shape, w, h, k * step, k * step)),
            fill: SHADOW_INK, alpha: SHADOW_ALPHA }));
        }
      }
      const mask = cmds ? K.shape.path(cmds) : null;
      const media = K.media(env, { parent: group, layer: at.layer, owner: env.owner, use: 'frame', src: p.src,
        box: { x: -w / 2, y: -h / 2, w, h }, p, mask });
      if (media === -1) return;
      if (mask && p.border > 0) {
        companions.push(sb.shape({ parent: group, owner: env.owner, path: mask, stroke: p.borderInk, width: p.border }));
      }
      if (companions.length) {
        sb.behave({ phase: K.PH.ORNAMENT, live: 'always', from: companions[0], to: companions[companions.length - 1] + 1,
          t0: env.times.a, t1: env.times.b, run: runTrack, media, nodes: Int32Array.from(companions) });
      }
      const mode = APPEAR[p.appear];
      if (mode !== undefined) {
        const T = env.times, s = T.a;
        const d = Math.max(Math.min(MIN_APPEAR, 0.45 * (T.b - T.a)), T.rest - T.a) + (mode === APPEAR.fade ? SLOW_FADE : 0);
        const f = env.hints && env.hints.focus;
        const vx = f ? at.cx - (f.x + f.w / 2) : 0, vy = f ? at.cy - (f.y + f.h / 2) : 0, len = Math.hypot(vx, vy);
        // a side frame slides in from its outer side (away from the text); the others rise from below
        const dir = p.place === 'side' && len > 1 ? [vx / len, vy / len] : [0, 1];
        sb.behave({ phase: K.PH.ORNAMENT, live: 'always', from: group, to: group + 1, t0: s, t1: s + d, run: runAppear, mode,
          s, d, grow: GROW, dx: dir[0] * SLIDE * D.short, dy: dir[1] * SLIDE * D.short });
      }
    },
  });

  // --- textFill ---------------------------------------------------------------------------------------------------------

  // The picture shows through the glyphs: it is drawn in the text layer after the glyphs with comp 'atop' (K.media, use
  // 'fill'), and the text layer is isolated, so it paints only where the glyphs are (their glow and shadow included).
  const textFill = K.ornament({
    key: 'textFill', scope: 'cut', follow: 'text', pool: false,
    label: L2('文字の中に', 'Inside the text'),
    blurb: L2('写真や動画を文字の形に切り抜いて見せる（選んだときだけ）', 'Your photo or video seen through the letters (only when chosen)'),
    tags: ['soft'],
    needs: ['media'],
    traits: { roles: TEXT_ROLES },
    shared: { amount: { auto: { value: 1 } } },
    params: mediaFirst('fill', {
      place: { type: 'enum', of: ['frame', 'text'], label: L2('合わせる範囲', 'Fit to'), auto: { value: 'frame' } },
    }),
    build(env, p) {
      if (!metaOf(env, p.src)) return;
      const D = env.D, f = env.hints && env.hints.focus;
      const ok = p.place === 'text' && f && [f.x, f.y, f.w, f.h].every(Number.isFinite) && f.w >= 1 && f.h >= 1;
      // 'text': the text block enlarged by 10 %, so the picture is framed on the words; 'frame': the whole frame
      const box = ok ? { x: f.x - 0.05 * f.w, y: f.y - 0.05 * f.h, w: 1.1 * f.w, h: 1.1 * f.h } : { x: 0, y: 0, w: D.w, h: D.h };
      const node = K.media(env, { layer: 'text', owner: env.owner, use: 'fill', src: p.src, p, box, alpha: 0.4 + 0.6 * p.amount });
      if (node !== -1) env.sb.layer('text', { isolate: true });
    },
  });

  // --- mediaLayer -------------------------------------------------------------------------------------------------------

  // Overlay footage over the whole scene (light leaks, dust, rain), covering the frame and its bleed so camera moves never
  // show an edge. Drawn only over the normal backdrop (K.media sets sceneOnly for use 'layer'). The depth replaces v2.1's
  // draft `over` param: in front of the text (front, the automatic choice) or behind it (back, anim, still).
  const mediaLayer = K.ornament({
    key: 'mediaLayer', scope: 'run', follow: 'own', pool: false,
    label: L2('重ねる映像', 'Overlay footage'),
    blurb: L2('光や粒の映像を場面に重ねる（選んだときだけ）', 'Footage such as light leaks or dust over the scene (only when chosen)'),
    tags: ['soft'],
    needs: ['media'],
    params: mediaFirst('layer', {
      blend: { type: 'enum', of: K.MEDIA.BLENDS.slice(), label: L2('重ね方', 'Blend'), auto: { value: 'screen' } },
    }),
    build(env, p) {
      if (!metaOf(env, p.src)) return;
      const D = env.D;
      const box = { x: -BLEED * D.w, y: -BLEED * D.h, w: (1 + 2 * BLEED) * D.w, h: (1 + 2 * BLEED) * D.h };
      K.media(env, { layer: 'far', owner: env.owner, use: 'layer', src: p.src, p, box, comp: BLEND_COMP[p.blend] || 'screen',
        alpha: 0.2 + 0.8 * p.amount });
    },
  });

  return [photoFrame, textFill, mediaLayer];
});
