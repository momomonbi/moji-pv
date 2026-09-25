/* 文字PVメーカー v2 — original work. Wipe and shear entrances (slice reveal, curtain rise, seam join) and their mirrors. */
MV.def('parts/arrive/wipe', ['parts/kit'], (K) => {
  'use strict';

  const EVERY_ROLE = ['lyric', 'focus', 'title', 'interlude', 'outro'];

  // Unfolds upward from the cell's bottom edge: the glyph grows from its baseline like a raised curtain uncovering it.
  function curtain(P, g, k, u) {
    const s = k < 0 ? 0 : k > 1 ? 1 : k;
    P.sy *= s;
    P.y += (1 - s) * g.h * 0.5;
    P.alpha *= u < 0.25 ? u / 0.25 : 1;
  }

  // Sheared hard about the line's centre, snapping straight: across a horizontal line (top half one way, bottom half
  // the other); along a vertical column the shear turns with it (left half up, right half down).
  function shear(P, g, k, u, p) {
    const a = (1 - k) * p.shear;
    const squeeze = 0.8 + 0.2 * k;
    if (p.vertical) { P.ky += a; P.sx *= squeeze; } else { P.kx += a; P.sy *= squeeze; }
    P.alpha *= u < 0.2 ? u / 0.2 : 1;
  }

  // K.arrive for a per-glyph function that also needs the text orientation: it arrives as p.vertical, added at build.
  function oriented(def) {
    const bound = K.arrive(def);
    const make = bound.make;
    return K.variant(bound, { key: def.key,
      make: (env, target, p) => make(env, target, Object.assign({}, p, { vertical: env.orient === 'v' })) });
  }

  // A wipe across each glyph's cell (the run's reveal mode), lit in the accent ink while it opens.
  const sliceReveal = K.arrive({
    key: 'sliceReveal',
    label: { ja: '切り出し', en: 'Slice reveal' },
    blurb: { ja: '一文字ずつ、枠をなでるように切り出して見せる', en: 'Each glyph is uncovered by a wipe across its cell' },
    tags: ['hard', 'minimal'], family: 'wipe', needs: ['mask'],
    traits: { roles: EVERY_ROLE },
    shared: { dur: { auto: { range: [0.25, 0.45], follow: '-energy' } }, each: { auto: { range: [0.03, 0.06], follow: '-density' } },
      order: { auto: { pick: ['lead', 'sweepX'], weights: [3, 1] } }, ease: { auto: { value: 'expoOut' } } },
    ...K.moves({ unit: 'glyph', tracks: { reveal: [0, 1], tint: [0.9, 0] }, curve: { tint: 'quadIn' } }),
  });

  const curtainRise = K.arrive({
    key: 'curtainRise',
    label: { ja: '幕上げ', en: 'Curtain rise' },
    blurb: { ja: '言葉ごとに、下から上へ幕が上がるように現れる', en: 'Words are revealed from the bottom up, like a curtain rising' },
    tags: ['serious', 'slow'], family: 'wipe',
    traits: { energy: [0, 0.7], roles: EVERY_ROLE },
    shared: { dur: { auto: { range: [0.6, 1.0], follow: '-energy' } }, each: { auto: { range: [0.1, 0.18], follow: '-density' } },
      order: { auto: { value: 'word' } }, ease: { auto: { pick: ['cubicInOut', 'sineInOut'], weights: [2, 1] } } },
    make: K.perGlyph(curtain),
  });

  const seamJoin = oriented({
    key: 'seamJoin',
    label: { ja: '継ぎ目', en: 'Seam join' },
    blurb: { ja: '行の上半分と下半分が逆から滑り込んで合わさる', en: 'The top and bottom halves of the line slide in from opposite sides and join' },
    tags: ['hard', 'bold'], family: 'shear', unit: 'line',
    traits: { energy: [0.4, 1] },
    shared: { dur: { auto: { range: [0.45, 0.75], follow: '-energy' } }, each: { auto: { range: [0.06, 0.12] } },
      order: { auto: { value: 'lead' } }, ease: { auto: { pick: ['cubicOut', 'quadOut'], weights: [3, 1] } } },
    params: {
      shear: { type: 'num', min: 10, max: 80, step: 1, unit: 'deg', label: { ja: 'ずれの角度', en: 'Shear' },
        auto: { range: [64, 76] } },
    },
    make: K.perGlyph(shear),
  });

  const sliceHide = K.mirror(sliceReveal, {
    key: 'sliceHide',
    label: { ja: '切り隠し', en: 'Slice hide' },
    blurb: { ja: '一文字ずつ、枠をなでるように切り取って隠す', en: 'Each glyph is covered by a wipe across its cell' },
    tags: ['hard', 'minimal'],
  });

  // The exit's own order goes through K.variant: a K.mirror patch with `shared` would drop the mirrored dur/each/ease
  // (see docs/NOTES.md, WP5a2).
  const curtainFall = K.variant(K.mirror(curtainRise, {
    key: 'curtainFall',
    label: { ja: '幕下げ', en: 'Curtain fall' },
    blurb: { ja: '言葉ごとに、上から幕が下りるように沈んで消える', en: 'Words fold down into their baseline, like a curtain falling' },
    tags: ['serious', 'slow'],
  }), { key: 'curtainFall', shared: { order: { auto: { value: 'word' } } } });

  return [sliceReveal, curtainRise, seamJoin, sliceHide, curtainFall];
});
