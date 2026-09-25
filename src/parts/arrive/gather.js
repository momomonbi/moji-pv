/* 文字PVメーカー v2 — original work. Converging entrances: shard gather, ghost converge, skew slide. */
MV.def('parts/arrive/gather', ['parts/kit'], (K) => {
  'use strict';

  const { fract, TAU } = K.math;

  // Broken into strips that fly in from a seeded direction and distance, turning, and close up into the glyph.
  function gather(P, g, k, u, p) {
    const f = 1 - k;
    const a = g.rnd * TAU;
    const r = p.spread * g.em * (0.5 + fract(g.rnd * 7.13)) * f;
    P.x += Math.cos(a) * r;
    P.y += Math.sin(a) * r;
    P.rot += (fract(g.rnd * 3.77) - 0.5) * 140 * f;
    P.shard += f > 0 ? Math.min(1, f * 1.6) : 0;
    P.alpha *= u < 0.2 ? u / 0.2 : 1;
  }

  // The glyph slides in from alternating sides flanked by its two colour ghosts (the echo copies); the ghosts stay
  // wide apart while it travels and close into the glyph as it lands.
  function converge(P, g, k, u, p) {
    const f = 1 - k;
    const side = g.index % 2 === 0 ? -1 : 1;
    P.echo += f > 0 ? Math.min(1, f * 4) : 0;
    P.x += side * p.spread * g.em * f;
    P.alpha *= u < 0.3 ? u / 0.3 : 1;
  }

  // K.moves for a sideways slide that keeps clear of the words already there: its tracks are written for horizontal
  // text, where each word comes in from the right, the side the line goes on to (no word has arrived there yet, and a
  // word ahead in the stagger is always nearer its place); vertical columns go on to the left, so there the slide is
  // mirrored (x and kx negated, the params included) and comes in from the left. The kit rebuilds a K.moves make
  // from `motion`, so the definition gets the make and the params without it (made once per definition).
  function advancing(moved, names) {
    const make = moved.make;
    const plain = {};
    for (const name of names) plain[name] = moved.params[name].auto.value;
    const mirrored = (p) => {
      const out = Object.assign({}, p);
      for (const name of names) out[name] = -(Number.isFinite(p[name]) ? p[name] : plain[name]);
      return out;
    };
    return { unit: moved.unit, params: moved.params,
      make: (env, target, p) => make(env, target, env.orient === 'v' ? mirrored(p || {}) : p) };
  }

  return [
    K.arrive({
      key: 'shardGather',
      label: { ja: '集合', en: 'Shard gather' },
      blurb: { ja: 'ばらばらの破片が飛んできて文字に組み上がる', en: 'Glyph fragments fly in from scattered positions and assemble' },
      tags: ['digital', 'busy'], family: 'gather', needs: ['shard'],
      traits: { energy: [0.35, 1] },
      shared: { dur: { auto: { range: [0.55, 0.9], follow: '-energy' } }, each: { auto: { range: [0.02, 0.05], follow: '-density' } },
        order: { auto: { pick: ['scatter', 'lead'], weights: [2, 1] } }, ease: { auto: { pick: ['expoOut', 'cubicOut'], weights: [2, 1] } } },
      params: {
        spread: { type: 'num', min: 0.5, max: 8, step: 0.1, unit: 'em', label: { ja: '散らばり', en: 'Spread' },
          auto: { range: [1.5, 3], follow: 'energy' } },
      },
      make: K.perGlyph(gather),
    }),
    K.arrive({
      key: 'ghostConverge',
      label: { ja: '残像寄せ', en: 'Ghost converge' },
      blurb: { ja: '色の残像がふたつ、文字へ滑り込んで重なる', en: 'Two colored ghost copies slide together into each glyph' },
      tags: ['digital', 'wet'], family: 'gather',
      shared: { dur: { auto: { range: [0.5, 0.8], follow: '-energy' } }, each: { auto: { range: [0.03, 0.06], follow: '-density' } },
        order: { auto: { pick: ['lead', 'scatter'], weights: [2, 1] } }, ease: { auto: { pick: ['cubicOut', 'expoOut'], weights: [2, 1] } } },
      params: {
        spread: { type: 'num', min: 0, max: 3, step: 0.05, unit: 'em', label: { ja: '滑り込み', en: 'Slide' },
          auto: { range: [0.6, 1.2] } },
      },
      make: K.perGlyph(converge),
    }),
    K.arrive({
      key: 'skewSlide',
      label: { ja: '斜め滑り', en: 'Skew slide' },
      blurb: { ja: '言葉が大きく傾いたまま横から滑り込み、着いてまっすぐになる', en: 'Words slide in sideways with a heavy skew that straightens on arrival' },
      tags: ['fast', 'hard'], family: 'shear',
      traits: { energy: [0.4, 1] },
      shared: { dur: { auto: { range: [0.35, 0.6], follow: '-energy' } }, each: { auto: { range: [0.07, 0.13], follow: '-density' } },
        order: { auto: { value: 'lead' } }, ease: { auto: { pick: ['expoOut', 'cubicOut'], weights: [3, 1] } } },
      ...advancing(K.moves({ unit: 'word', tracks: { x: [2.4, 0], kx: [-50, 0], alpha: [0, 1] }, curve: { alpha: 'expoOut' },
        expose: ['x', 'kx'] }), ['xFrom', 'kxFrom']),
    }),
  ];
});
