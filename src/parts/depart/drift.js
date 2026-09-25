/* 文字PVメーカー v2 — original work. Drifting exits: wind blow, skew exit, fog out. */
MV.def('parts/depart/drift', ['parts/kit'], (K) => {
  'use strict';

  // Blown sideways one by one: pushed ever faster, lifted along a seeded flutter and tumbling as it fades. Every glyph
  // follows the same path, so one that leaves while those downwind of it still wait flies over them, and the glyphs
  // blown before it bunch up with it: the wind takes them from its downwind edge first. The autos agree (the wind
  // blows left, order sweepX: the leftmost glyphs leave first, in horizontal and vertical text alike).
  function blow(P, g, k, u, p) {
    const s = p.dir === 'right' ? 1 : -1;
    P.x += s * k * k * 6 * g.em;
    P.y -= (k * p.lift + Math.sin(k * 3 + g.rnd * 6) * 0.2 * k) * g.em;
    P.rot += s * k * (120 + g.rnd * 180);
    P.alpha *= 1 - k;
  }

  // K.moves for a sideways slide that keeps clear of the words still there: its tracks are written for horizontal text,
  // where each word leaves to the left, the side the line came from (the words before it have gone, and a word ahead in
  // the stagger is always further out); vertical columns come from the right, so there the slide is mirrored (x and kx
  // negated, the params included) and leaves to the right. The kit rebuilds a K.moves make from `motion`, so the
  // definition gets the make and the params without it (made once per definition). (parts/arrive/gather.js has the same
  // helper for skewSlide: parts share code only through the kit.)
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
    K.depart({
      key: 'windBlow',
      label: { ja: '吹き流し', en: 'Wind blow' },
      blurb: { ja: '文字が一つずつ横へ吹き飛ばされる', en: 'Glyphs are blown sideways one by one' },
      tags: ['organic', 'airy', 'fast'], family: 'scatter',
      shared: { order: { auto: { value: 'sweepX' } }, ease: { auto: { value: 'quadIn' } } },
      params: {
        dir: { type: 'enum', of: ['left', 'right'], label: { ja: '向き', en: 'Direction' }, auto: { value: 'left' } },
        lift: { type: 'num', min: 0, max: 3, step: 0.05, unit: 'em', label: { ja: '舞い上がり', en: 'Lift' }, auto: { range: [0.5, 1.5] } },
      },
      make: K.perGlyph(blow),
    }),
    K.depart({
      key: 'skewExit',
      label: { ja: '斜め抜け', en: 'Skew exit' },
      blurb: { ja: '言葉が前のめりに傾き、先へ滑り抜けていく', en: 'Words skew and slide out the far side' },
      tags: ['fast', 'hard'], family: 'shear',
      traits: { energy: [0.4, 1] },
      shared: { dur: { auto: { range: [0.3, 0.5], follow: '-energy' } }, each: { auto: { range: [0.05, 0.1], follow: '-density' } },
        order: { auto: { value: 'lead' } }, ease: { auto: { pick: ['expoIn', 'cubicIn'], weights: [3, 1] } } },
      ...advancing(K.moves({ unit: 'word', tracks: { x: [0, -2.6], kx: [0, 40], alpha: [1, 0] }, curve: { alpha: 'expoIn' },
        expose: ['x', 'kx'] }), ['xTo', 'kxTo']),
    }),
    K.depart({
      key: 'fogOut',
      label: { ja: '霧隠れ', en: 'Fog out' },
      blurb: { ja: '行がぼやけながら少し大きくなり、霧に消える', en: 'The line blurs and fades while growing slightly' },
      tags: ['soft', 'airy'], family: 'fog', needs: ['blur'],
      traits: { energy: [0, 0.7], roles: ['lyric', 'focus', 'title', 'interlude', 'outro'] },
      shared: { dur: { auto: { range: [0.6, 1.0], follow: '-energy' } }, each: { auto: { range: [0.06, 0.12] } },
        order: { auto: { value: 'lead' } }, ease: { auto: { pick: ['sineIn', 'quadIn'], weights: [2, 1] } } },
      ...K.moves({ unit: 'line', tracks: { sx: [1, 1.07], sy: [1, 1.07], blur: [0, 0.3], alpha: [1, 0] },
        curve: { alpha: 'quadIn' }, expose: ['blur'] }),
    }),
  ];
});
