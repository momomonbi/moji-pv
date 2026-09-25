/* 文字PVメーカー v2 — original work. Photo background: a user image with a slow pan and zoom (DESIGN §5.5). */
MV.def('parts/ground/photo', ['parts/kit'], (K) => {
  'use strict';

  const BLEED = 0.15;              // share of the frame covered beyond each edge, so camera moves never show an edge

  function flatDraw(g, t, d) {
    g.fillStyle = d.fill;
    g.fillRect(d.x0, d.y0, d.W, d.H);
  }

  // A ground-coloured veil over the photo, so the lyrics keep reading on busy pictures.
  function veilDraw(g, t, d, q) {
    g.fillStyle = q.rgba(d.fill, d.veil);
    g.fillRect(d.x0, d.y0, d.W, d.H);
  }

  // Ken Burns on the image node: zoom from 1 to 1 + zoom and drift along `dir` over the segment (closed form in t),
  // scaling about the image's centre (px, py).
  function panZoom(P, t, b) {
    const u = b.len > 0 ? K.math.clamp(t / b.len) : 0, s = 1 + b.zoom * u;
    const i = b.from;
    P.px[i] = b.cx; P.py[i] = b.cy;
    P.sx[i] *= s; P.sy[i] *= s;
    P.x[i] += b.dx * u; P.y[i] += b.dy * u;
  }

  const photoPan = K.ground({
    key: 'photoPan', pool: false,
    label: { ja: '写真', en: 'Photo pan' },
    blurb: { ja: '好きな画像をゆっくり動かして背景にする（画像を指定したときだけ）', en: 'A user image with a slow pan and zoom (only when an image is given)' },
    tags: ['soft'],
    params: {
      image: { type: 'text', max: 64, label: { ja: '画像', en: 'Image' }, auto: { value: '' }, ai: false },
      zoom: { type: 'num', min: 0, max: 0.4, step: 0.01, unit: 'x', label: { ja: 'ズーム', en: 'Zoom' }, auto: { range: [0.06, 0.14] } },
      pan: { type: 'num', min: -180, max: 180, step: 1, unit: 'deg', label: { ja: '動く向き', en: 'Pan direction' }, auto: { range: [-180, 180] } },
      veil: { type: 'num', min: 0, max: 0.9, step: 0.01, label: { ja: '文字のための薄幕', en: 'Veil' }, auto: { range: [0.3, 0.45] } },
    },
    build(env, p) {
      const { sb, pal, D } = env;
      const area = { x0: -BLEED * D.w, y0: -BLEED * D.h, W: D.w * (1 + 2 * BLEED), H: D.h * (1 + 2 * BLEED), fill: pal.ground };
      sb.paint({ layer: 'ground', bleed: BLEED, animated: false, owner: env.owner, data: area, draw: flatDraw });
      if (!p.image) return;
      // the image covers the bleed area plus the pan travel, so its edge never shows
      const travel = 0.04 * D.short, a = p.pan * K.math.DEG;
      const w = area.W + 2 * travel, h = area.H + 2 * travel;
      const holder = sb.group({ layer: 'ground', x: area.x0 - travel, y: area.y0 - travel, owner: env.owner });
      const img = sb.image({ parent: holder, layer: 'ground', asset: p.image, fit: 'cover', x: 0, y: 0, w, h, owner: env.owner });
      sb.behave({ phase: K.PH.ORNAMENT, live: 'always', from: img, to: img + 1, t0: 0, t1: env.times.b, run: panZoom,
        len: env.times.b, zoom: p.zoom, cx: w / 2, cy: h / 2, dx: Math.cos(a) * travel, dy: Math.sin(a) * travel });
      sb.paint({ layer: 'ground', bleed: BLEED, animated: false, owner: env.owner, data: Object.assign({ veil: p.veil * (0.6 + 0.4 * p.amount) }, area),
        draw: veilDraw });
    },
  });

  return [photoPan];
});
