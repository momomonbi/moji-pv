/* 文字PVメーカー v2 — original work. Falling and rising entrances: drop snap, rain drop, ribbon wave. */
MV.def('parts/arrive/fall', ['parts/kit'], (K) => {
  'use strict';

  const { fract } = K.math;
  const LAND = 0.55;             // drop snap: share of the motion spent falling; the rest is two small bounces
  const SPLASH = 0.8;            // rain drop: share spent falling; the rest is a small squash on landing
  const MIN_DROP = 0.45;         // em: the shortest fall of a glyph that lands just under a glyph already there
  const TOUCH = 0.5;             // du: cells that only touch (or overlap by less) are not above one another
  const SNUG = 0.5;              // du: glyphs of one run whose frame offsets agree this well share the frame's axes

  // --- room to fall ---------------------------------------------------------------------------------------------------
  // A falling glyph must not pass through another glyph. Below a glyph that lands no later than it does (the line above
  // in horizontal text, the glyph above it in a vertical column, which each glyph fell through before), it falls at most
  // as far as the room between them (down to MIN_DROP em, fading in while it overlaps). Below a glyph that is still
  // falling when it starts and lands later (rain drop's random order and heights, a column filled from the bottom), it
  // falls from no higher than that glyph does plus the room between them: the two then move alike, the lower one ahead,
  // so they never cross. Glyphs are compared in the frame when their runs are only shifted there (upright compositions:
  // every line and column together), otherwise within their own run (turned runs: haloRing, confettiWords, tiltedCard).

  // Per glyph: the space it is compared in (0 = the frame, r + 1 = run r's own frame) and its centre there.
  function spacesOf(target) {
    const n = target.to - target.from;
    const group = new Int32Array(n), x = new Float64Array(n), y = new Float64Array(n);
    const runs = target.runs || [];
    const shifted = runs.map(() => ({ count: 0, ox: 0, oy: 0, ok: true }));
    for (let j = 0; j < n; j++) {
      const s = shifted[target.unitOf.run[j]];
      if (!s || target.cls[j] === 'space') continue;
      const ox = target.wx[j] - target.x[j], oy = target.wy[j] - target.y[j];
      if (s.count === 0) { s.ox = ox; s.oy = oy; } else if (Math.abs(ox - s.ox) > SNUG || Math.abs(oy - s.oy) > SNUG) s.ok = false;
      s.count++;
    }
    for (let j = 0; j < n; j++) {
      const r = target.unitOf.run[j], s = shifted[r];
      const inFrame = !!s && s.ok && s.count >= 2;
      group[j] = inFrame ? 0 : r + 1;
      x[j] = inFrame ? target.wx[j] : target.x[j];
      y[j] = inFrame ? target.wy[j] : target.y[j];
    }
    return { group, x, y };
  }

  // Fills, per glyph j (du, its run's frame): fall.drop[j], the height it falls from; fall.room[j], the room below the
  // glyphs above it that land no later (Infinity when there is none; it fades in while it is still under them); and
  // fall.lid[j], the room below any glyph above it (its bounce never rises into one). `motion` is the entrance as made
  // (its stagger delays and per-glyph randoms: every glyph moves for the same time, so the later start lands later);
  // fullOf(em, rnd, p) is the height the glyph would fall from with nothing above it. A glyph is above j when their cells
  // overlap across the fall, or, with `rows`, when it sits on an earlier horizontal line anywhere (the whole line above
  // is a shelf: the next line falls from under it, also past its ends). Glyphs are visited top first, so the drop of a
  // glyph above is known when it caps the one below. Build time only (n² over the glyphs of one cut).
  function measureFalls(target, motion, p, rows, fullOf, fall) {
    const n = target.to - target.from;
    const at = spacesOf(target);
    const runs = target.runs || [];
    const start = motion.delay, len = motion.dur;
    const order = Array.from({ length: n }, (_, j) => j).sort((a, b) => at.y[a] - at.y[b] || a - b);
    for (const j of order) {
      const em = target.em[j], full = fullOf(em, motion.rnd[j], p);
      fall.drop[j] = full; fall.room[j] = Infinity; fall.lid[j] = Infinity;
      if (target.cls[j] === 'space') continue;
      const top = at.y[j] - target.h[j] / 2;
      const run = runs[target.unitOf.run[j]];
      const shelf = rows && !(run && run.spec && run.spec.orient === 'v');
      let room = Infinity, lid = Infinity, cap = Infinity;
      for (let i = 0; i < n; i++) {
        if (i === j || at.group[i] !== at.group[j] || target.cls[i] === 'space' || !(at.y[i] < at.y[j])) continue;
        const across = Math.abs(at.x[i] - at.x[j]) < (target.w[i] + target.w[j]) / 2 - TOUCH;
        const gap = Math.max(0, top - (at.y[i] + target.h[i] / 2));
        if (across) lid = Math.min(lid, gap);
        if (start[i] <= start[j]) {
          if (across || (shelf && target.unitOf.line[i] !== target.unitOf.line[j])) room = Math.min(room, gap);
        } else if (across && start[i] < start[j] + len) {
          cap = Math.min(cap, fall.drop[i] + gap);
        }
      }
      fall.room[j] = room;
      fall.lid[j] = Math.min(lid, room);
      fall.drop[j] = Math.min(room >= full ? full : Math.max(room, MIN_DROP * em), cap);
    }
  }

  // K.arrive for a falling entrance: the drops, rooms and lids of measureFalls reach the per-glyph function as p.drop,
  // p.room and p.lid. The arrays go into the params before the kit makes the behaviour and are filled from it right after
  // (build time); the make wrapper is made once per definition, as in wipe.js. `rows`: lines are shelves.
  function falling(def, rows, fullOf) {
    const bound = K.arrive(def);
    const make = bound.make;
    return K.variant(bound, { key: def.key, make: (env, target, p) => {
      const n = Math.max(0, target.to - target.from);
      const fall = { drop: new Float32Array(n), room: new Float32Array(n), lid: new Float32Array(n) };
      const list = make(env, target, Object.assign({}, p, fall));
      if (list.length > 0) measureFalls(target, list[0], p, rows, fullOf, fall);
      return list;
    } });
  }

  // The heights a glyph falls from with nothing above it: drop snap's one height, rain drop's seeded one.
  function snapHeight(em, rnd, p) { return p.height * em; }
  function rainHeight(em, rnd, p) { return (0.35 + 0.65 * fract(rnd * 7.31)) * p.height * em; }

  // Opacity while a glyph still overlaps the glyph above it (its top is `reach` du above its rest): a glyph that falls
  // from MIN_DROP em fades in from 0 as it comes out from under that glyph (at least over a quarter em, so a stretched
  // drop that only grazes it dims a little instead of blinking), and is fully there once its top has cleared the room.
  function clearing(reach, room, h, em) {
    if (!(reach > room)) return 1;
    return Math.max(0, 1 - (reach - room) / Math.max(h - room, 0.25 * em));
  }

  // Squash by `q` (0..1) standing on the cell's bottom edge: wider and lower, the baseline kept.
  function squash(P, g, q) {
    P.sx *= 1 + 0.6 * q;
    P.sy *= 1 - q;
    P.y += q * g.h * 0.5;
  }

  // Falls with gravity from p.height em above (or from its drop, see measureFalls), lands at LAND, then bounces twice
  // (0.16 and 0.04 of the fall, never into a glyph above) and rests.
  function dropSnap(P, g, k, u, p) {
    const c = k < 0 ? 0 : k > 1 ? 1 : k;
    const room = p.room[g.index], h = p.drop[g.index];
    if (c < LAND) {
      const f = c / LAND;
      const lift = h * (1 - f * f), stretch = 0.12 * f;
      P.y -= lift;
      P.sy *= 1 + stretch;
      P.sx *= 1 - 0.06 * f;
      P.alpha *= clearing(lift + stretch * g.h * 0.5, room, h, g.em);
    } else {
      const f = (c - LAND) / (1 - LAND);
      const b = f < 0.7 ? Math.sin((Math.PI * f) / 0.7) * 0.16 : Math.sin((Math.PI * (f - 0.7)) / 0.3) * 0.04;
      P.y -= Math.min(b * h, p.lid[g.index]);
      const hit = Math.max(0, 1 - f / 0.18);
      squash(P, g, 0.22 * hit * hit);
    }
    P.alpha *= u < 0.12 ? u / 0.12 : 1;
  }

  // Each glyph drops from its own seeded height (or from its drop, see measureFalls), stretched like a falling drop, and
  // squashes a little as it lands.
  function rainDrop(P, g, k, u, p) {
    const c = k < 0 ? 0 : k > 1 ? 1 : k;
    const room = p.room[g.index], h = p.drop[g.index];
    if (c < SPLASH) {
      const f = c / SPLASH;
      const lift = h * (1 - f * f), stretch = 0.35 * f;
      P.y -= lift;
      P.sy *= 1 + stretch;
      P.sx *= 1 - 0.15 * f;
      P.blur += 0.03 * g.em * f;
      P.alpha *= clearing(lift + stretch * g.h * 0.5, room, h, g.em);
    } else {
      const f = (c - SPLASH) / (1 - SPLASH);
      squash(P, g, 0.25 * Math.sin(Math.PI * f) * (1 - f));
    }
    P.alpha *= u < 0.25 ? u / 0.25 : 1;
  }

  // Rises from below through a damped swing (below → above → rest); staggered in reading order, the line reads as a
  // wave travelling from the first glyph to the last. Each glyph leans with the slope of its path.
  function ribbon(P, g, k, u, p) {
    const f = 1 - k;
    const ph = k * Math.PI * 1.5;
    P.y += p.height * g.em * f * Math.cos(ph);
    P.rot -= p.swing * f * Math.sin(ph);
    P.alpha *= u < 0.3 ? u / 0.3 : 1;
  }

  return [
    falling({
      key: 'dropSnap',
      label: { ja: '落下', en: 'Drop snap' },
      blurb: { ja: '上から落ちてきて、小さく弾んで着地する', en: 'Glyphs fall from above and land with a small bounce' },
      tags: ['playful', 'bold'], family: 'drop',
      traits: { energy: [0.3, 1] },
      shared: { dur: { auto: { range: [0.6, 0.9], follow: '-energy' } }, each: { auto: { range: [0.04, 0.08], follow: '-density' } },
        order: { auto: { pick: ['lead', 'scatter'], weights: [3, 1] } }, ease: { auto: { value: 'linear' } } },
      params: {
        height: { type: 'num', min: 0.5, max: 6, step: 0.05, unit: 'em', label: { ja: '落ちる高さ', en: 'Drop height' },
          auto: { range: [1.4, 2.6], follow: 'energy' } },
      },
      make: K.perGlyph(dropSnap),
    }, true, snapHeight),
    falling({
      key: 'rainDrop',
      label: { ja: '雨だれ', en: 'Rain drop' },
      blurb: { ja: 'ばらばらの高さから、ばらばらの順に落ちてくる', en: 'Glyphs drop in from random heights in random order' },
      tags: ['wet', 'organic'], family: 'drop', needs: ['blur'],
      shared: { dur: { auto: { range: [0.5, 0.85], follow: '-energy' } }, each: { auto: { range: [0.03, 0.07], follow: '-density' } },
        order: { auto: { value: 'scatter' } }, ease: { auto: { value: 'linear' } } },
      params: {
        height: { type: 'num', min: 0.5, max: 8, step: 0.05, unit: 'em', label: { ja: '最高の高さ', en: 'Highest drop' },
          auto: { range: [2.5, 4.5] } },
      },
      make: K.perGlyph(rainDrop),
    }, false, rainHeight),
    K.arrive({
      key: 'ribbonWave',
      label: { ja: 'リボン', en: 'Ribbon wave' },
      blurb: { ja: '文字が波打つリボンのように左から順に立ち上がる', en: 'Glyphs rise in a travelling sine wave from left to right' },
      tags: ['playful', 'organic'], family: 'wave',
      traits: { cells: [3, 40] },
      shared: { dur: { auto: { range: [0.75, 1.1], follow: '-energy' } }, each: { auto: { range: [0.04, 0.07], follow: '-density' } },
        order: { auto: { value: 'lead' } }, ease: { auto: { pick: ['sineOut', 'linear'], weights: [2, 1] } } },
      params: {
        height: { type: 'num', min: 0.2, max: 3, step: 0.05, unit: 'em', label: { ja: '波の高さ', en: 'Wave height' },
          auto: { range: [0.7, 1.4], follow: 'energy' } },
        swing: { type: 'num', min: 0, max: 45, step: 1, unit: 'deg', label: { ja: '傾き', en: 'Lean' },
          auto: { range: [8, 18] } },
      },
      make: K.perGlyph(ribbon),
    }),
  ];
});
