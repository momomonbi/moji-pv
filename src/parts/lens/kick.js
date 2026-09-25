/* 文字PVメーカー v2 — original work. Restless cameras: hand-held sway, beat punch-ins and the impact kick. */
MV.def('parts/lens/kick', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, smooth, DEG, noise2 } = K.math;
  const L = (ja, en) => ({ ja, en });
  const SEED_MAX = 2147483646;
  const ATTACK = 0.035;                 // s: a punch reaches its peak this fast (one or two frames, no hard pop)
  const NO_GRID_PERIOD = 0.5;           // s: without a BPM, beat parts pulse every half second from the cut start

  // Same scale as parts/lens/glide: amount 0.5 is the move as authored.
  function strength(p) { return 0.5 + p.amount; }

  // The beat and impact cameras are locked to the beat grid and the sung start, so the lens curve does not warp their
  // clock (`warp: false`) and their curve row is an advanced one the AI does not set (DESIGN_2_1 §3.11). handHeld is a
  // wander and keeps the kit's time warp.
  const LOCKED_CURVE = Object.freeze({ curve: { ui: 'advanced', ai: false } });

  function cameraBehaviour(env, cam, run, fields) {
    return Object.assign({ phase: K.PH.LENS, live: 'always', from: cam, to: cam + 1, t0: env.times.a, t1: env.times.b, run },
      fields);
  }

  // Signed value noise in [−1, 1): channel `ch` is an independent lattice row, so x/y/roll never move together.
  function wobble(seed, x, ch) { return 2 * noise2(seed, x, ch) - 1; }

  // --- run functions (module level, pure in t, no allocation) -----------------------------------------------------

  // Slow sway on a coarse lattice plus a finer tremble on top, like a camera held by hand.
  function hand(P, t, b) {
    const x = t * b.rate, n = b.from;
    P.x[n] += b.sway * (wobble(b.seed, x, 0) + 0.3 * wobble(b.seed, x * 3.7, 2));
    P.y[n] += b.sway * (wobble(b.seed, x, 1) + 0.3 * wobble(b.seed, x * 3.7, 3));
    P.rot[n] += b.roll * wobble(b.seed, x * 0.7, 4);
    const z = 1 + b.breath * wobble(b.seed, x * 0.5, 5);
    P.sx[n] *= z; P.sy[n] *= z;
  }

  // A punch-in on every beat that decays before the next one; the bar's first beat hits harder.
  function beat(P, t, b) {
    const x = (t - b.offset) / b.period;
    const index = Math.floor(x);
    const since = (x - index) * b.period;
    const accent = ((index % b.meter) + b.meter) % b.meter === 0 ? b.accent : 1;
    const env = since < ATTACK ? since / ATTACK : Math.exp(-(since - ATTACK) / b.decay);
    const z = 1 + b.punch * accent * env;
    P.sx[b.from] *= z; P.sy[b.from] *= z;
  }

  // The kick at the sung start (cut-local 0): a small pull back just before, a sharp punch-in, a shake that dies out.
  function kick(P, t, b) {
    const n = b.from;
    if (t < -b.pre) return;
    let z;
    if (t < 0) z = -b.dip * smooth((t + b.pre) / b.pre);
    else if (t < ATTACK) z = -b.dip + (b.kick + b.dip) * (t / ATTACK);
    else z = b.kick * Math.exp(-(t - ATTACK) / b.decay);
    P.sx[n] *= 1 + z; P.sy[n] *= 1 + z;
    if (t < 0) return;
    const e = Math.exp(-t / b.shakeDecay);
    P.jx[n] += b.shake * e * wobble(b.seed, t * b.jitter, 0);
    P.jy[n] += b.shake * e * wobble(b.seed, t * b.jitter, 1);
    P.rot[n] += b.jolt * e * wobble(b.seed, t * b.jitter * 0.5, 2);
  }

  // --- handHeld ------------------------------------------------------------------------------------------------------

  const handHeld = K.lens({
    key: 'handHeld',
    label: L('手持ち', 'Hand held'),
    blurb: L('手で持ったカメラのように、決まった揺れが小さく続く', 'Small seeded wandering, like a camera held by hand'),
    tags: ['organic'], family: 'shake',
    traits: { energy: [0.2, 1] },
    params: {
      sway: { type: 'num', min: 1, max: 60, step: 0.5, unit: 'du', label: L('揺れ幅', 'Sway'),
        auto: { range: [7, 16], follow: 'energy' } },
      rate: { type: 'num', min: 0.1, max: 3, step: 0.05, unit: 'Hz', label: L('揺れの速さ', 'Rate'),
        auto: { range: [0.45, 0.9], follow: 'tempo' } },
      roll: { type: 'num', min: 0, max: 3, step: 0.05, unit: 'deg', label: L('傾き', 'Roll'), auto: { range: [0.2, 0.6] } },
    },
    make(env, cam, p) {
      const s = strength(p);
      return [cameraBehaviour(env, cam, hand, { seed: env.rng.int(1, SEED_MAX), rate: p.rate, sway: p.sway * s,
        roll: p.roll * DEG * s, breath: 0.006 * s })];
    },
  });

  // --- beatZoom (the §4.18.10 example, with a softened attack and a bar accent) --------------------------------------

  const beatZoom = K.lens({
    key: 'beatZoom',
    label: L('拍ズーム', 'Beat zoom'),
    blurb: L('拍ごとに少し寄ってすぐ戻る', 'A small punch-in on every beat'),
    tags: ['fast', 'bold'], family: 'beat', needs: ['beats'], warp: false, shared: LOCKED_CURVE,
    fits: (f) => (f.beat ? 1.3 : 0),
    traits: { energy: [0.35, 1], roles: ['lyric', 'focus', 'interlude'] },
    params: {
      punch: { type: 'num', min: 0, max: 0.2, step: 0.005, unit: 'x', label: L('寄り', 'Punch'),
        auto: { range: [0.015, 0.06], follow: 'amount.camera' } },
      decay: { type: 'num', min: 0.05, max: 0.6, step: 0.01, unit: 's', label: L('戻り', 'Decay'), auto: { range: [0.12, 0.3] } },
      accent: { type: 'num', min: 1, max: 2.5, step: 0.05, unit: 'x', label: L('小節頭の強さ', 'Downbeat accent'),
        auto: { range: [1.2, 1.7] }, ui: 'advanced' },
    },
    make(env, cam, p) {
      const g = env.grid;
      return [cameraBehaviour(env, cam, beat, { punch: p.punch * strength(p), decay: Math.max(0.01, p.decay), accent: p.accent,
        period: g ? g.period : NO_GRID_PERIOD, offset: g ? g.offset : 0, meter: g ? g.meter : 4 })];
    },
  });

  // --- impactKick ----------------------------------------------------------------------------------------------------

  // The shake follows amount.shake from zero (SPEC §6: moods set effect amounts; the 揺れ control can switch it off),
  // and the rotational jolt with it; the punch-in itself is the camera's and stays.
  const SHAKE_FULL = 26;                // du of shake that gives the full jolt
  const impactKick = K.lens({
    key: 'impactKick',
    label: L('衝撃', 'Impact kick'),
    blurb: L('歌い出しで鋭く寄り、画面が揺れて収まる', 'A sharp punch-in and a shake right at the sung start'),
    tags: ['hard', 'bold'], family: 'shake', warp: false, shared: LOCKED_CURVE,
    traits: { energy: [0.35, 1], impact: true },
    fits: (f) => (f.impact ? 1 : 0.25),                   // mostly for `!` lines (×6 there); rare on plain ones
    params: {
      kick: { type: 'num', min: 0.02, max: 0.3, step: 0.005, unit: 'x', label: L('寄り', 'Kick'),
        auto: { range: [0.06, 0.12], follow: 'energy' } },
      shake: { type: 'num', min: 0, max: 80, step: 1, unit: 'du', label: L('揺れ', 'Shake'),
        auto: { range: [0, 30], follow: 'amount.shake', jitter: 0 } },
      decay: { type: 'num', min: 0.1, max: 1.2, step: 0.01, unit: 's', label: L('収まるまで', 'Settle'),
        auto: { range: [0.3, 0.5] } },
    },
    make(env, cam, p) {
      const s = strength(p);
      return [cameraBehaviour(env, cam, kick, { seed: env.rng.int(1, SEED_MAX), kick: p.kick * s, dip: 0.2 * p.kick * s,
        pre: 0.12, decay: Math.max(0.02, p.decay), shake: p.shake * s, shakeDecay: Math.max(0.02, p.decay * 0.6),
        jolt: 0.8 * DEG * clamp(p.shake / SHAKE_FULL) * s, jitter: 24 })];
    },
  });

  return [handHeld, beatZoom, impactKick];
});
