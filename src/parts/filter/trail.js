/* 文字PVメーカー v2 — original work. After images: the words leave fading copies of where they were a moment ago. */
MV.def('parts/filter/trail', ['parts/kit'], (K) => {
  'use strict';

  const { clamp } = K.math;
  const L = (ja, en) => ({ ja, en });
  const MAX_TRAILS = 3;              // fx.textAt may be called at most 3 times per frame (§7.4)

  // The text layers re-rendered at t − k·gap (fx.textAt), oldest first, each fainter than the one after it, laid over
  // the frame. Where the words rest the copies coincide with them and nothing shows; where they move, they smear.
  // Copies are text only (transparent elsewhere), so a transparent frame keeps its empty areas empty.
  function trail(fx, src, p) {
    const n = Math.max(1, Math.min(MAX_TRAILS, p.trails | 0));
    if (!(p.amount > 0.01)) return src;
    const out = fx.own(src), g = out.ctx;
    for (let k = n; k >= 1; k--) {
      const ghost = fx.textAt(k * p.gap);
      g.globalAlpha = clamp(p.amount * p.strength * (1 - (k - 1) / (n + 0.5)));
      g.drawImage(ghost.canvas, 0, 0);
      fx.give(ghost);
    }
    g.globalAlpha = 1;
    return out;
  }

  const afterImage = K.filter({
    key: 'afterImage',
    label: L('残像', 'After image'),
    blurb: L('少し前の文字が薄い残像になって尾を引く', 'Fading trails of the text from a moment ago'),
    tags: ['wet', 'digital'], family: 'trail', needs: ['textAt'],
    stage: 'optic', cost: 5, passes: 4, alphaSafe: true,
    params: {
      trails: { type: 'int', min: 1, max: MAX_TRAILS, label: L('残像の数', 'Trails'), auto: { pick: [2, 3, 3] } },
      gap: { type: 'num', min: 0.02, max: 0.4, step: 0.01, unit: 's', label: L('残像の間隔', 'Gap'),
        auto: { range: [0.06, 0.12], follow: '-energy' } },
      strength: { type: 'num', min: 0.1, max: 1, step: 0.05, unit: 'frac', label: L('濃さ', 'Strength'), auto: { range: [0.45, 0.7] } },
    },
    apply: trail,
  });

  return [afterImage];
});
