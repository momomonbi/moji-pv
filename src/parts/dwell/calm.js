/* 文字PVメーカー v2 — original work. Calm holds: still, breathe, slow drift, sway, creep. */
MV.def('parts/dwell/calm', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, smooth, TAU, DEG } = K.math;
  const L = (ja, en) => ({ ja, en });

  // Every hold is K.perGlyphHold with a little more context in the params its function sees: the hold window (rest,
  // out; cut-local) for progress and phase, and the reading axis. Block motions (scale, drift, turn) move each glyph
  // about the text block's centre (g.cx, g.cy), so the block moves as one piece. Amplitudes scale with the shared
  // `amount` (0.5 = as authored) and the envelope weight w; rates scale with the shared `speed`.
  function holdOf(fn) {
    const inner = K.perGlyphHold(fn);
    function make(env, target, p) {
      return inner(env, target, Object.assign({}, p, { rest: env.times.rest, out: env.times.out, vertical: env.orient === 'v' }));
    }
    make.holdFn = fn;
    return make;
  }

  // Progress through the hold, 0 at the end of the entrance and 1 when the exit starts.
  function progress(p, tl) { return clamp((tl - p.rest) / Math.max(0.01, p.out - p.rest)); }

  // Block holds move only the glyphs. Compositions that set the words on or in a fixed decoration (grid cells, tag
  // cards, a card, a band, a rule right under the line) would lose that picture, so the planner does not pair them
  // (fits = 0 while that composition is chosen; a pin still can).
  const BOUND = new Set(['gridMosaic', 'hangingTags', 'tiltedCard', 'slantBand', 'titlePlate', 'magazineHead']);
  function freeBlock(f, chosen) { return chosen && BOUND.has(chosen.arrange) ? 0 : 1; }

  // --- stillHold (fallback) --------------------------------------------------------------------------------------

  const stillHold = K.dwell({
    key: 'stillHold',
    label: L('静止', 'Still hold'),
    blurb: L('動かさずにそのまま見せる', 'No motion while the text is on screen'),
    tags: ['minimal'], family: 'still', fallback: true,
    traits: { roles: ['lyric', 'focus', 'title', 'interlude', 'outro'] },
    make() { return []; },
  });

  // --- breathePulse ----------------------------------------------------------------------------------------------

  function breathe(P, g, time, w, p, fc) {
    const s = p.depth * 2 * p.amount * w * Math.sin((TAU * (fc.tl - p.rest) * p.speed) / p.period);
    P.sx *= 1 + s;
    P.sy *= 1 + s;
    P.x += g.cx * s;
    P.y += g.cy * s;
  }

  const breathePulse = K.dwell({
    key: 'breathePulse',
    label: L('呼吸', 'Breathe'),
    blurb: L('文字のまとまりが息をするように少しだけ伸び縮みする', 'The text block swells and settles by a few percent, like a slow breath'),
    tags: ['soft', 'slow'], family: 'scale',
    traits: { energy: [0, 0.8], roles: ['lyric', 'focus', 'title', 'outro'] },
    fits: freeBlock,
    params: {
      depth: { type: 'num', min: 0.004, max: 0.06, step: 0.001, unit: 'x', label: L('ふくらみ', 'Depth'),
        auto: { range: [0.012, 0.026], follow: 'energy' } },
      period: { type: 'num', min: 1.5, max: 8, step: 0.1, unit: 's', label: L('一呼吸の長さ', 'Breath length'),
        auto: { range: [2.6, 4.2], follow: '-tempo' } },
    },
    make: holdOf(breathe),
  });

  // --- slowDrift -------------------------------------------------------------------------------------------------

  // The block floats out along one direction and settles back by the time the exit starts (a half sine over the hold).
  function drift(P, g, time, w, p, fc) {
    const d = p.dist * p.speed * 2 * p.amount * w * Math.sin(Math.PI * progress(p, fc.tl));
    const a = p.angle * DEG;
    P.x += Math.cos(a) * d;
    P.y += Math.sin(a) * d;
  }

  const slowDrift = K.dwell({
    key: 'slowDrift',
    label: L('漂い', 'Slow drift'),
    blurb: L('文字のまとまりが一方向へゆっくり数du漂う', 'The block drifts a few design units in one slow direction'),
    tags: ['airy', 'slow'], family: 'drift',
    traits: { energy: [0, 0.75], roles: ['lyric', 'focus', 'title', 'outro'] },
    fits: freeBlock,
    params: {
      angle: { type: 'num', min: -180, max: 180, step: 1, unit: 'deg', label: L('向き', 'Direction'),
        auto: { pick: [-90, -60, -120, 0, 180], weights: [3, 2, 2, 1, 1] } },
      dist: { type: 'num', min: 2, max: 90, step: 1, unit: 'du', label: L('距離', 'Distance'),
        auto: { range: [12, 30], follow: 'dur' } },
    },
    make: holdOf(drift),
  });

  // --- swaySwing -------------------------------------------------------------------------------------------------

  function sway(P, g, time, w, p, fc) {
    const deg = p.angle * 2 * p.amount * w * Math.sin((TAU * (fc.tl - p.rest) * p.speed) / p.period);
    const r = deg * DEG, c = Math.cos(r), s = Math.sin(r);
    P.rot += deg;
    P.x += g.cx * (c - 1) - g.cy * s;
    P.y += g.cx * s + g.cy * (c - 1);
  }

  const swaySwing = K.dwell({
    key: 'swaySwing',
    label: L('揺れ', 'Sway'),
    blurb: L('行全体が中心のまわりをゆっくり揺れる', 'The line rocks slowly around its centre'),
    tags: ['soft', 'organic'], family: 'drift',
    traits: { energy: [0, 0.8] },
    fits: freeBlock,
    params: {
      angle: { type: 'num', min: 0.2, max: 8, step: 0.1, unit: 'deg', label: L('揺れ幅', 'Swing'),
        auto: { range: [1, 2.6], follow: 'energy' } },
      period: { type: 'num', min: 1.5, max: 10, step: 0.1, unit: 's', label: L('一往復の長さ', 'Swing length'),
        auto: { range: [3.2, 5.6], follow: '-tempo' } },
    },
    make: holdOf(sway),
  });

  // --- creepTrack ------------------------------------------------------------------------------------------------

  // Letter spacing opens slowly along the reading axis (glyphs move away from the block centre), easing out, and
  // closes again over the last part of the hold (a quarter of it, at least 0.6 s), so the envelope's short ramp before
  // the exit never snaps it shut: the return is at most a few times as fast as the opening.
  function creep(P, g, time, w, p, fc) {
    const u = progress(p, fc.tl);
    const back = smooth((p.out - fc.tl) / Math.max(0.6, 0.25 * (p.out - p.rest)));
    const k = p.spread * 2 * p.amount * w * back * (1 - Math.pow(1 - u, 1 + p.speed));
    if (p.vertical) P.y += g.cy * k; else P.x += g.cx * k;
  }

  const creepTrack = K.dwell({
    key: 'creepTrack',
    label: L('にじり', 'Creep'),
    blurb: L('字間がとてもゆっくり広がっていく', 'The letter spacing widens very slowly'),
    tags: ['slow', 'serious'], family: 'spacing',
    traits: { energy: [0, 0.7] },
    fits: freeBlock,
    params: {
      spread: { type: 'num', min: 0.01, max: 0.25, step: 0.005, unit: 'x', label: L('広がり', 'Spread'),
        auto: { range: [0.035, 0.08], follow: 'dur' } },
    },
    make: holdOf(creep),
  });

  return [stillHold, breathePulse, slowDrift, swaySwing, creepTrack];
});
