/* 文字PVメーカー v2 — original work. Lively holds: wave, jitter, flicker, beat pulse, shimmer. */
MV.def('parts/dwell/lively', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, smooth, fract, noise1, TAU } = K.math;
  const L = (ja, en) => ({ ja, en });
  const FLICKER_MAX_HZ = 12;      // dips stay smooth (no single-frame pops) and gentle for the eyes
  // Compositions whose words sit on a fixed decoration: the beat pulse (a block scale) is not paired with them (see
  // parts/dwell/calm).
  const BOUND = new Set(['gridMosaic', 'hangingTags', 'tiltedCard', 'slantBand', 'titlePlate', 'magazineHead']);

  // K.perGlyphHold with more context in the params its function sees (see parts/dwell/calm): the hold window, the
  // reading axis, the scene's seed (for closed-form noise), the text block's half size and a typical glyph size.
  function holdOf(fn) {
    const inner = K.perGlyphHold(fn);
    function make(env, target, p) {
      const f = target.focus || { w: 0, h: 0 };
      let em = 0;
      for (let j = 0; j < target.em.length; j++) em += target.em[j];
      em = target.em.length ? em / target.em.length : 100;
      return inner(env, target, Object.assign({}, p, { rest: env.times.rest, out: env.times.out, vertical: env.orient === 'v',
        seed: (Number.isFinite(env.seed) ? env.seed : 1) >>> 0, halfW: f.w / 2, halfH: f.h / 2, em }));
    }
    make.holdFn = fn;
    return make;
  }

  // --- waveRun ---------------------------------------------------------------------------------------------------

  // A small wave travels along the text, across the reading axis.
  function wave(P, g, time, w, p, fc) {
    const ph = TAU * ((fc.tl - p.rest) * 0.9 * p.speed - g.index / p.length);
    const d = Math.sin(ph) * p.height * 2 * p.amount * w * g.em;
    if (p.vertical) P.x += d; else P.y -= d;
  }

  const waveRun = K.dwell({
    key: 'waveRun',
    label: L('波', 'Wave run'),
    blurb: L('文字の並びを小さな波が流れていく', 'A small wave travels along the text'),
    tags: ['playful', 'organic'], family: 'wave',
    traits: { energy: [0.2, 1] },
    params: {
      height: { type: 'num', min: 0, max: 0.4, step: 0.01, unit: 'em', label: L('高さ', 'Height'),
        auto: { range: [0.04, 0.12], follow: 'energy' } },
      length: { type: 'num', min: 2, max: 20, step: 0.5, label: L('波の長さ（字）', 'Wavelength (glyphs)'),
        auto: { range: [5, 9] } },
    },
    make: holdOf(wave),
  });

  // --- jitterShake -----------------------------------------------------------------------------------------------

  // Each glyph trembles on its own seeded value noise (closed form in time), at most a few design units.
  function jitter(P, g, time, w, p, fc) {
    const x = fc.tl * p.rate * p.speed;
    const seed = (p.seed + g.index * 7919) >>> 0;
    const a = Math.min(p.size * g.em, 14) * 2 * p.amount * w;
    P.jx += (noise1(seed, x) * 2 - 1) * a;
    P.jy += (noise1((seed + 1) >>> 0, x + 17.3) * 2 - 1) * a;
    P.rot += (noise1((seed + 2) >>> 0, x + 5.1) * 2 - 1) * p.turn * 2 * p.amount * w;
  }

  const jitterShake = K.dwell({
    key: 'jitterShake',
    label: L('震え', 'Jitter'),
    blurb: L('一文字ずつが小さく細かく震える', 'A tiny seeded tremble on every glyph'),
    tags: ['hard', 'digital'], family: 'tremble',
    traits: { energy: [0.4, 1] },
    params: {
      size: { type: 'num', min: 0.004, max: 0.08, step: 0.001, unit: 'em', label: L('震えの幅', 'Size'),
        auto: { range: [0.012, 0.03], follow: 'energy' } },
      rate: { type: 'num', min: 2, max: 30, step: 0.5, unit: 'Hz', label: L('細かさ', 'Rate'), auto: { range: [9, 16] } },
      turn: { type: 'num', min: 0, max: 6, step: 0.1, unit: 'deg', label: L('傾きの揺れ', 'Turn'), auto: { range: [0.4, 1.4] } },
    },
    make: holdOf(jitter),
  });

  // --- flickerLight ----------------------------------------------------------------------------------------------

  // At a fixed tick rate (so preview and export flicker alike), some ticks dip the whole block and a few dip single
  // glyphs; each dip is a smooth sin² pulse within its tick.
  function flicker(P, g, time, w, p, fc) {
    const x = fc.tl * Math.min(FLICKER_MAX_HZ, p.rate * p.speed);
    const tick = Math.floor(x + 1e-6);
    const all = noise1(p.seed, tick) < p.chance;
    const one = noise1((p.seed + 1 + g.index * 131) >>> 0, tick) < p.chance * 0.35;
    if (!all && !one) return;
    const s = Math.sin(Math.PI * clamp(x - tick));
    P.alpha *= 1 - Math.min(0.8, p.depth * (0.5 + p.amount)) * w * s * s;
  }

  const flickerLight = K.dwell({
    key: 'flickerLight',
    label: L('ちらつき', 'Flicker'),
    blurb: L('ときどき一瞬だけ明るさが落ちる', 'Occasional brief dips in opacity at a fixed tick rate'),
    tags: ['dark', 'retro'], family: 'light',
    traits: { energy: [0.15, 1] },
    params: {
      rate: { type: 'num', min: 2, max: 12, step: 0.5, unit: 'Hz', label: L('刻み', 'Tick rate'), auto: { range: [7, 10] } },
      chance: { type: 'num', min: 0.02, max: 0.6, step: 0.01, label: L('頻度', 'Chance'),
        auto: { range: [0.12, 0.28], follow: 'energy' } },
      depth: { type: 'num', min: 0.1, max: 0.8, step: 0.01, label: L('暗くなる量', 'Depth'), auto: { range: [0.35, 0.6] } },
    },
    make: holdOf(flicker),
  });

  // --- thumpSwell -------------------------------------------------------------------------------------------------

  // The block punches out on every beat: a 30 ms rise, an exponential fall, and a release to rest before the next
  // beat, so the scale never jumps. Without a beat grid it pulses every half second.
  function pulse(P, g, time, w, p, fc) {
    let since, phase;
    if (fc.beat) { since = fc.beat.since; phase = fc.beat.phase; }
    else { phase = fract(fc.tl / 0.5); since = phase * 0.5; }
    const env = smooth(since / 0.03) * Math.exp((-since * p.speed) / p.decay) * (1 - phase * phase);
    const s = p.punch * (0.5 + p.amount) * w * env;
    P.sx *= 1 + s;
    P.sy *= 1 + s;
    P.x += g.cx * s;
    P.y += g.cy * s;
  }

  const thumpSwell = K.dwell({
    key: 'thumpSwell',
    label: L('拍動', 'Beat pulse'),
    blurb: L('拍ごとに文字のまとまりがどくんと脈打つ', 'The block pulses in scale on every beat'),
    tags: ['fast', 'bold'], family: 'scale', needs: ['beats'],
    traits: { energy: [0.4, 1] },
    fits: (f, chosen) => (f.beat ? 1.3 : 0.05) * (chosen && BOUND.has(chosen.arrange) ? 0 : 1),
    params: {
      punch: { type: 'num', min: 0.005, max: 0.1, step: 0.001, unit: 'x', label: L('脈の強さ', 'Punch'),
        auto: { range: [0.02, 0.05], follow: 'energy' } },
      decay: { type: 'num', min: 0.05, max: 0.5, step: 0.01, unit: 's', label: L('戻り', 'Decay'),
        auto: { range: [0.1, 0.2], follow: '-tempo' } },
    },
    make: holdOf(pulse),
  });

  // --- shimmerSweep ----------------------------------------------------------------------------------------------

  // A soft band of accent tint sweeps across the block (slanted a little), once per period.
  function shimmer(P, g, time, w, p, fc) {
    const band = Math.max(1, p.width * p.em);
    const along = p.vertical ? g.cy - p.slant * g.cx : g.cx + p.slant * g.cy;
    const reach = (p.vertical ? p.halfH + p.slant * p.halfW : p.halfW + p.slant * p.halfH) + 2 * band;
    const pos = -reach + 2 * reach * fract(((fc.tl - p.rest) * p.speed) / p.period);
    const d = (along - pos) / band;
    P.tint += Math.min(1, 0.35 + 0.65 * p.amount) * w * Math.exp(-d * d);
  }

  const shimmerSweep = K.dwell({
    key: 'shimmerSweep',
    label: L('きらめき', 'Shimmer'),
    blurb: L('アクセント色の光の帯が文字の上を横切っていく', 'A band of accent tint sweeps across the glyphs'),
    tags: ['bright', 'playful'], family: 'light',
    traits: { energy: [0.25, 1] },
    params: {
      width: { type: 'num', min: 0.3, max: 6, step: 0.1, unit: 'em', label: L('帯の幅', 'Band width'), auto: { range: [1.2, 2.4] } },
      period: { type: 'num', min: 0.6, max: 6, step: 0.1, unit: 's', label: L('一巡の長さ', 'Sweep length'),
        auto: { range: [1.5, 2.6], follow: '-energy' } },
      slant: { type: 'num', min: 0, max: 1, step: 0.01, label: L('帯の傾き', 'Slant'), auto: { range: [0.2, 0.6] } },
    },
    make: holdOf(shimmer),
  });

  return [waveRun, jitterShake, flickerLight, thumpSwell, shimmerSweep];
});
