/* 文字PVメーカー v2 — original work. Photo or video background: the user's picture or clip over the ground, with fit, crop, edges, Ken Burns, blur, veil and tint (DESIGN §5.5; DESIGN_2_1 §11.5.7). */
MV.def('parts/ground/photo', ['parts/kit'], (K) => {
  'use strict';

  const BLEED = 0.15;              // share of the frame covered beyond each edge, so camera moves never show an edge

  // The base paint: the ground colour over the frame and its bleed (what shows around a contained picture, through a
  // transparent one, and everywhere when no picture is chosen).
  function flatDraw(g, t, d) {
    g.fillStyle = d.fill;
    g.fillRect(d.x0, d.y0, d.W, d.H);
  }

  // photoPan (v2's key, kept: keys are forever). v2.0 shipped no asset store, so no v2.0 document holds a working image
  // id; the image param is now of type `media`, and the media node (K.media, use 'ground') draws the picture or clip
  // with the §11.5.6 params. The v2 veil paint is now the node's own veil, with v2's strength veil · (0.6 + 0.4 · amount).
  const photoPan = K.ground({
    key: 'photoPan', pool: false,
    label: { ja: '写真・動画', en: 'Photo or video' },
    blurb: { ja: '写真や動画を背景にする（選んだときだけ）', en: 'Your photo or video as the background (only when chosen)' },
    tags: ['soft'],
    needs: ['media'],
    params: K.mediaParams({ src: 'image', use: 'ground', autos: { veil: { range: [0.3, 0.45] } } }),
    build(env, p) {
      const { sb, pal, D } = env;
      const area = { x0: -BLEED * D.w, y0: -BLEED * D.h, W: D.w * (1 + 2 * BLEED), H: D.h * (1 + 2 * BLEED), fill: pal.ground };
      // Drawn live (not animated: false): one fillRect costs about 0.2 ms, whereas a cached raster of the frame and its
      // bleed is resampled under the camera every frame (a full-frame scaled draw: ≈ 3 ms in software raster).
      sb.paint({ layer: 'ground', bleed: BLEED, owner: env.owner, data: area, draw: flatDraw });
      const media = Object.assign({}, p, { veil: p.veil * (0.6 + 0.4 * p.amount) });
      K.media(env, { layer: 'ground', owner: env.owner, use: 'ground', src: p.image, box: { x: 0, y: 0, w: D.w, h: D.h }, p: media });
    },
  });

  return [photoPan];
});
