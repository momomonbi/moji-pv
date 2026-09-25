/* 文字PVメーカー v2 — original work. Scale entrances: stamp press, word pop, zoom settle. */
MV.def('parts/arrive/pop', ['parts/kit'], (K) => {
  'use strict';

  const HIT = 0.5;               // stamp press: share of the motion before the stamp hits the page

  // Each word slams down from p.scale with gathering speed, flashes in the accent ink on impact and shakes briefly.
  // The shake is the same for every glyph of a word (keyed by the word index), so the word shakes as one stamp.
  function stamp(P, g, k, u, p) {
    const c = k < 0 ? 0 : k > 1 ? 1 : k;
    if (c < HIT) {
      const f = c / HIT;
      const s = 1 + (p.scale - 1) * (1 - f * f);
      P.sx *= s;
      P.sy *= s;
      P.alpha *= f < 0.4 ? f / 0.4 : 1;
      return;
    }
    const f = (c - HIT) / (1 - HIT);
    const decay = (1 - f) * (1 - f);
    const w = g.word * 1.7 + 0.3;
    P.jx += Math.sin(f * 40 + w) * p.shake * g.em * decay;
    P.jy += Math.cos(f * 33 + w * 1.3) * p.shake * 0.6 * g.em * decay;
    P.tint += 0.8 * decay;
    P.sx *= 1 + 0.04 * decay;
    P.sy *= 1 - 0.06 * decay;
  }

  // Starts large, soft and transparent, and settles onto its place.
  function settle(P, g, k, u, p) {
    const s = 1 + (p.scale - 1) * (1 - k);
    P.sx *= s;
    P.sy *= s;
    P.blur += 0.05 * g.em * (1 - k);
    P.alpha *= u < 0.35 ? (u / 0.35) * (2 - u / 0.35) : 1;
  }

  return [
    K.arrive({
      key: 'stampPress',
      label: { ja: '押印', en: 'Stamp press' },
      blurb: { ja: '言葉ごとに大きな判のように叩きつけられ、小さく揺れる', en: 'Each word slams down from 160% scale with a tiny shake' },
      tags: ['bold', 'hard'], family: 'zoom', unit: 'word',
      traits: { energy: [0.4, 1], impact: true },
      shared: { dur: { auto: { range: [0.4, 0.6], follow: '-energy' } }, each: { auto: { range: [0.12, 0.2], follow: '-density' } },
        order: { auto: { pick: ['lead', 'emphFirst'], weights: [3, 1] } }, ease: { auto: { value: 'linear' } } },
      params: {
        scale: { type: 'num', min: 1.1, max: 3, step: 0.05, unit: 'x', label: { ja: '最初の大きさ', en: 'Start scale' },
          auto: { value: 1.6 } },
        shake: { type: 'num', min: 0, max: 0.3, step: 0.01, unit: 'em', label: { ja: '揺れ', en: 'Shake' },
          auto: { range: [0.03, 0.08], follow: 'amount.shake' } },
      },
      make: K.perGlyph(stamp),
    }),
    K.arrive({
      key: 'wordPop',
      label: { ja: 'ぽん', en: 'Word pop' },
      blurb: { ja: '言葉がひとつずつ、弾むようにぽんと現れる', en: 'Whole words pop in with overshoot, one word at a time' },
      tags: ['playful', 'bright'], family: 'grow',
      shared: { dur: { auto: { range: [0.35, 0.55], follow: '-energy' } }, each: { auto: { range: [0.1, 0.18], follow: '-density' } },
        order: { auto: { value: 'lead' } }, ease: { auto: { pick: ['backOut', 'springOut'], weights: [3, 1] } } },
      ...K.moves({ unit: 'word', tracks: { sx: [0.1, 1], sy: [0.1, 1], y: [0.3, 0], alpha: [0, 1] },
        curve: { alpha: 'expoOut' }, expose: ['y'] }),
    }),
    K.arrive({
      key: 'zoomSettle',
      label: { ja: '寄せ', en: 'Zoom settle' },
      blurb: { ja: '大きく透けた文字が、すっと本来の大きさに収まる', en: 'Glyphs start large and transparent and settle to size' },
      tags: ['bold', 'fast'], family: 'zoom', needs: ['blur'],
      traits: { energy: [0.4, 1] },
      shared: { dur: { auto: { range: [0.35, 0.6], follow: '-energy' } }, each: { auto: { range: [0.02, 0.05], follow: '-density' } },
        ease: { auto: { pick: ['expoOut', 'cubicOut'], weights: [3, 1] } } },
      params: {
        scale: { type: 'num', min: 1.2, max: 6, step: 0.05, unit: 'x', label: { ja: '最初の大きさ', en: 'Start scale' },
          auto: { range: [2.2, 3.2], follow: 'energy' } },
      },
      make: K.perGlyph(settle),
    }),
  ];
});
