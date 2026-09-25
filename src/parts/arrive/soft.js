/* 文字PVメーカー v2 — original work. Soft entrances (ink rise, fog in, bloom open) and the ink-sink mirror. */
MV.def('parts/arrive/soft', ['parts/kit'], (K) => {
  'use strict';

  // Quiet parts that also dress title cards, interludes and the outro (a special cut no part serves appears at once).
  const EVERY_ROLE = ['lyric', 'focus', 'title', 'interlude', 'outro'];

  const inkRise = K.arrive({
    key: 'inkRise',
    label: { ja: '墨のぼり', en: 'Ink rise' },
    blurb: { ja: 'ぼかしが晴れながら一文字ずつ浮かぶ', en: 'Each glyph floats up while its blur clears' },
    tags: ['soft', 'literary', 'slow'], family: 'rise', needs: ['blur'],
    traits: { energy: [0, 0.8], roles: EVERY_ROLE },
    shared: { dur: { auto: { range: [0.45, 0.8], follow: '-energy' } }, each: { auto: { range: [0.03, 0.06] } },
      ease: { auto: { value: 'expoOut' } } },
    ...K.moves({ unit: 'glyph', tracks: { y: [0.55, 0], alpha: [0, 1], blur: [0.12, 0], tint: [1, 0] },
      curve: { alpha: 'quadOut' }, expose: ['y', 'blur'] }),
  });

  // The whole line (each laid-out line in turn) comes out of a heavy haze and settles from 94 %.
  const fogIn = K.arrive({
    key: 'fogIn',
    label: { ja: '霧晴れ', en: 'Fog in' },
    blurb: { ja: '強いぼかしの中から行全体が浮かび、少し縮んで落ち着く', en: 'The whole line fades up from a heavy blur while settling from 94% scale' },
    tags: ['soft', 'airy'], family: 'fog', needs: ['blur'],
    traits: { energy: [0, 0.7], roles: EVERY_ROLE },
    shared: { dur: { auto: { range: [0.8, 1.3], follow: '-energy' } }, each: { auto: { range: [0.1, 0.2] } },
      order: { auto: { value: 'lead' } }, ease: { auto: { value: 'cubicOut' } } },
    ...K.moves({ unit: 'line', tracks: { sx: [0.94, 1], sy: [0.94, 1], blur: [0.3, 0], alpha: [0, 1] },
      curve: { alpha: 'sineOut' }, expose: ['blur'] }),
    params: { blurFrom: { auto: { range: [0.2, 0.4] } } },
  });

  // Glyphs open from their centres, centre-out, lit by an accent glow (and tint, which also reads on light grounds)
  // that fades as they reach full size.
  const bloomOpen = K.arrive({
    key: 'bloomOpen',
    label: { ja: '花開き', en: 'Bloom open' },
    blurb: { ja: '文字が中心から開き、光がすっと消える', en: 'Glyphs grow from their centres with a glow that fades' },
    tags: ['bright', 'soft'], family: 'grow',
    traits: { energy: [0, 0.8], roles: EVERY_ROLE },
    shared: { dur: { auto: { range: [0.55, 0.9], follow: '-energy' } }, each: { auto: { range: [0.03, 0.06] } },
      order: { auto: { pick: ['core', 'lead'], weights: [2, 1] } }, ease: { auto: { pick: ['cubicOut', 'backOut'], weights: [2, 1] } } },
    ...K.moves({ unit: 'glyph', tracks: { sx: [0.2, 1], sy: [0.2, 1], alpha: [0, 1], glow: [1, 0], tint: [0.9, 0] },
      curve: { alpha: 'expoOut', glow: 'quadIn', tint: 'quadIn' }, expose: ['glow'] }),
  });

  const inkSink = K.mirror(inkRise, {
    key: 'inkSink',
    label: { ja: '墨しずみ', en: 'Ink sink' },
    blurb: { ja: 'ぼけながら沈んで消える', en: 'Glyphs sink and blur away' },
    tags: ['soft', 'literary'], family: 'sink',
  });

  return [inkRise, fogIn, bloomOpen, inkSink];
});
