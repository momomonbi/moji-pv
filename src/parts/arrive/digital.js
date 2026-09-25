/* 文字PVメーカー v2 — original work. Digital entrances (type on, strobe in, pixel step, glitch in) and the strobe-out mirror. */
MV.def('parts/arrive/digital', ['parts/kit'], (K) => {
  'use strict';

  const EVERY_ROLE = ['lyric', 'focus', 'title', 'interlude', 'outro'];

  const CARET_W = 0.07;          // caret bar thickness (em of the run)
  const CARET_L = 0.92;          // caret bar length (em)
  const CARET_GAP = 0.05;        // space between a glyph and the caret (em of the glyph)
  const BLINK = 0.5;             // caret blink period (s); it blinks while waiting and stays lit while typing
  const LINGER = 0.7;            // the caret keeps blinking this long after the last glyph
  const STROBE_HOLD = 0.8;       // share of a glyph's time after which a strobing glyph stays lit
  const STROBE_DARK = 0.15;      // share of the flicker a strobing glyph starts with dark (strobe out: ends with)
  const PIXEL_STEPS = 4;         // mosaic halvings before the sharp glyph

  // --- small pure helpers -------------------------------------------------------------------------------------------

  // Hash of two integers → [0, 1): integer arithmetic only, so every engine gives the same flicker pattern.
  function bits(a, b) {
    let h = Math.imul((a | 0) ^ 0x2c1b3c6d, 0x297a2d39) ^ Math.imul(b | 0, 0x68e31da4);
    h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  function seedOf(g) { return (g.rnd * 4294967296) >>> 0; }

  // --- per-glyph functions ------------------------------------------------------------------------------------------

  // Typed: hidden until its key is struck, then a quick settle from a slightly larger size.
  function typeGlyph(P, g, k, u) {
    if (u <= 0) { P.alpha *= 0; return; }
    const pop = 1 + 0.2 * (1 - k);
    P.sx *= pop;
    P.sy *= pop;
  }

  // Flickers on and off on a fixed tick (the same instants at any frame rate), more often on as it goes, then holds.
  // It starts dark, so the mirrored strobe out ends dark: no glyph lights up again in the frames before its exit ends.
  function strobe(P, g, k, u, p, fc) {
    if (u <= 0) { P.alpha *= 0; return; }
    const q = k / STROBE_HOLD;
    if (q >= 1) return;
    const tick = Math.floor(fc.tl * p.rate);
    if (q < STROBE_DARK || bits(tick, seedOf(g) + g.index) >= 0.2 + 0.75 * q) { P.alpha *= 0; return; }
    P.tint += 0.8 * (1 - q);
  }

  // Coarse mosaic blocks that halve in size step by step until the glyph is sharp, which it greets with a short accent
  // flash. Never tinted while in blocks: the renderer draws a tint as a whole glyph over the mosaic.
  function pixelate(P, g, k, u, p) {
    if (u <= 0) { P.alpha *= 0; return; }
    const q = (k < 0 ? 0 : k) * (PIXEL_STEPS + 1);
    const step = Math.floor(q);
    if (step < PIXEL_STEPS) P.pixel += (p.block * g.em) / (1 << step);
    else P.tint += 0.5 * (1 - Math.min(1, q - PIXEL_STEPS));
  }

  // Sideways jumps with colour echoes, drop-outs and accent flashes on a fixed tick, all decaying to a locked glyph.
  function glitch(P, g, k, u, p, fc) {
    if (u <= 0) { P.alpha *= 0; return; }
    const left = 1 - (k > 1 ? 1 : k);
    if (left <= 0) return;
    const tick = Math.floor(fc.tl * p.rate);
    const s = seedOf(g);
    const r1 = bits(tick, s), r2 = bits(tick + 7919, s ^ 0x5bd1e995);
    P.jx += (r1 - 0.5) * 2 * p.spread * g.em * left;
    if (r2 > 0.75) P.jy += (r2 - 0.875) * 2 * p.spread * g.em * left;
    P.echo += left;
    if (r2 < 0.3 * left) P.alpha *= 0;
    else if (r1 > 0.8) P.tint += left;
  }

  // --- the caret -------------------------------------------------------------------------------------------------------
  // (parts/depart/type.js has the erasing counterpart: parts share code only through the kit.)

  // One caret bar per run: a shape parented to the run node (so it follows the run's turn and nudges), drawn over its
  // glyphs. A behaviour moves the bar of the active run next to the glyph typed last and hides the others. It runs in
  // the ORNAMENT phase: the caret is an extra mark, not a glyph pose, and it is gone once the text rests.
  function runCaret(P, t, b) {
    let j = -1, tj = -Infinity;
    for (let q = 0; q < b.when.length; q++) {
      const w = b.when[q];
      if (w <= t && w >= tj) { j = q; tj = w; }                // the glyph struck last (the later one on a tie)
    }
    const run = j < 0 ? b.startRun : b.runOf[j];
    const x = j < 0 ? b.startX : b.posX[j], y = j < 0 ? b.startY : b.posY[j];
    const busy = t >= b.firstT && t <= b.lastT;
    const since = t < b.firstT ? t - b.t0 : t - b.lastT;
    const lit = t >= b.t0 && t < b.t1 && (busy || since % BLINK < BLINK / 2);
    for (let r = 0; r < b.to - b.from; r++) {
      const i = b.from + r;
      if (r === run && lit) { P.x[i] += x - b.baseX[r]; P.y[i] += y - b.baseY[r]; } else P.alpha[i] *= 0;
    }
  }

  // The centres of the glyphs' cells in their runs' frames. In a vertical run, punctuation and small kana are drawn
  // off-centre in their cell, shifted right and up by the same amount (DESIGN §4.15.2: 、。 by 0.55 em, small kana by
  // 0.1 em), so their glyph centre is not where the caret belongs: the cell sits on its column's axis (the centre of
  // the column's line box) and is as far below the glyph as the glyph is right of that axis.
  function cellsOf(target) {
    const n = target.to - target.from;
    const x = Float64Array.from(target.x), y = Float64Array.from(target.y);
    const runs = target.runs || [];
    for (let j = 0; j < n; j++) {
      const run = runs[target.unitOf.run[j]];
      const lay = run && run.layout;
      if (!lay || !run.spec || run.spec.orient !== 'v' || !lay.lines || !lay.box || !lay.line) continue;
      const line = lay.lines[lay.line[target.from + j - run.from]];
      if (!line || !(line.w > 0)) continue;
      const shift = x[j] - (lay.box.x + line.x + line.w / 2);
      if (shift > 1e-3) { x[j] -= shift; y[j] += shift; }
    }
    return { x, y };
  }

  // Where the caret stands just before (lead) or just after (trail) glyph j, in its run's frame (next to its cell).
  function caretSpot(cells, target, j, trail, vertical, out) {
    const gap = CARET_GAP * target.em[j];
    const s = trail ? 1 : -1;
    out[0] = vertical ? cells.x[j] : cells.x[j] + s * (target.w[j] / 2 + gap);
    out[1] = vertical ? cells.y[j] + s * (target.h[j] / 2 + gap) : cells.y[j];
    return out;
  }

  // The caret behaviour for the kit's per-glyph behaviour `glyphs` (its delays give each glyph's key time), drawn in
  // `ink`: after each glyph as it is typed, before the first one while waiting.
  function caretOf(env, target, glyphs, ink) {
    const n = target.to - target.from;
    const runs = target.runs;
    const vertical = runs.map((r) => r.spec.orient === 'v');
    const when = new Float32Array(n), posX = new Float32Array(n), posY = new Float32Array(n);
    const runOf = new Int16Array(n);
    const spot = [0, 0];
    const cells = cellsOf(target);
    let first = 0, last = 0;
    for (let j = 0; j < n; j++) {
      when[j] = glyphs.t0 + glyphs.delay[j];
      runOf[j] = target.unitOf.run[j];
      caretSpot(cells, target, j, true, vertical[runOf[j]], spot);
      posX[j] = spot[0]; posY[j] = spot[1];
      if (when[j] < when[first]) first = j;
      if (when[j] >= when[last]) last = j;
    }
    caretSpot(cells, target, first, false, vertical[runOf[first]], spot);
    const baseX = new Float32Array(runs.length), baseY = new Float32Array(runs.length);
    let from = -1;
    runs.forEach((run, r) => {
      const j0 = run.to > run.from ? run.from - target.from : first;
      const em = target.em[j0];
      const w = CARET_W * em, l = CARET_L * em;
      const path = vertical[r] ? K.shape.rect(-l / 2, -w / 2, l, w) : K.shape.rect(-w / 2, -l / 2, w, l);
      baseX[r] = target.x[j0]; baseY[r] = target.y[j0];
      const node = env.sb.shape({ parent: run.node, path, fill: ink, x: baseX[r], y: baseY[r] });
      if (from < 0) from = node;
    });
    const firstT = when[first], lastT = when[last], times = env.times;
    const t0 = times.a, t1 = Math.max(lastT, Math.min(lastT + LINGER, times.out));
    return {
      phase: K.PH.ORNAMENT, live: 'always', from, to: from + runs.length, t0, t1, run: runCaret,
      when, posX, posY, runOf, baseX, baseY, startRun: runOf[first], startX: spot[0], startY: spot[1],
      firstT, lastT,
    };
  }

  // The caret belongs to the text element, so the text's element pins (§3.4.3) reach it: a hidden text has no caret,
  // and a pinned fill recolours it like the glyphs. env.cut.els is part of the cut fingerprint, so this is cache-safe.
  function textPins(env) {
    const els = env.cut && env.cut.els;
    return (els && els.text) || {};
  }

  // A make that adds the caret behaviour to the kit's per-glyph behaviour (created once per part, never per build).
  function withCaret(make) {
    return function caretMake(env, target, p) {
      const list = make(env, target, p);
      const pins = textPins(env);
      if (list.length === 0 || target.runs.length === 0 || pins.hide) return list;
      return list.concat([caretOf(env, target, list[0], pins.fill || 'accent')]);
    };
  }

  // --- definitions ----------------------------------------------------------------------------------------------------

  const typeOn = K.arrive({
    key: 'typeOn',
    label: { ja: '打鍵', en: 'Type on' },
    blurb: { ja: '動くカーソルのあとに一文字ずつ打ち込まれる', en: 'Typewriter: glyphs appear one by one behind a moving caret' },
    tags: ['digital', 'minimal'], family: 'type',
    traits: { cells: [1, 32], roles: EVERY_ROLE },
    shared: { dur: { auto: { range: [0.06, 0.1] } }, each: { auto: { range: [0.05, 0.1], follow: '-density' } },
      order: { auto: { value: 'lead' } }, ease: { auto: { value: 'expoOut' } } },
    make: withCaret(K.perGlyph(typeGlyph)),
  });

  const strobeIn = K.arrive({
    key: 'strobeIn',
    label: { ja: '点滅入り', en: 'Strobe in' },
    blurb: { ja: '文字が決まった間隔で何度か点滅してから灯る', en: 'Glyphs flicker on and off a few times before holding (fixed tick rate)' },
    tags: ['digital', 'hard'], family: 'flicker',
    traits: { energy: [0.3, 1] },
    shared: { dur: { auto: { range: [0.45, 0.75], follow: '-energy' } }, each: { auto: { range: [0.01, 0.04], follow: '-density' } },
      order: { auto: { pick: ['scatter', 'lead'], weights: [2, 1] } }, ease: { auto: { value: 'linear' } } },
    params: {
      rate: { type: 'num', min: 6, max: 20, step: 1, unit: 'Hz', label: { ja: '点滅の速さ', en: 'Flicker rate' },
        auto: { range: [10, 15], follow: 'energy' } },
    },
    make: K.perGlyph(strobe),
  });

  // The exit's own order goes through K.variant (a K.mirror patch with `shared` drops the mirrored dur/each/ease).
  const strobeOut = K.variant(K.mirror(strobeIn, {
    key: 'strobeOut',
    label: { ja: '点滅抜け', en: 'Strobe out' },
    blurb: { ja: '文字が点滅しながら消えていく', en: 'Glyphs flicker off' },
    tags: ['digital', 'hard'],
  }), { key: 'strobeOut', shared: { order: { auto: { pick: ['scatter', 'tail'], weights: [2, 1] } } } });

  const pixelStep = K.arrive({
    key: 'pixelStep',
    label: { ja: '粗から', en: 'Pixel step' },
    blurb: { ja: '粗いブロックから段階的にくっきりしていく', en: 'Glyphs appear as coarse blocks that sharpen step by step' },
    tags: ['digital', 'retro'], family: 'pixel',
    shared: { dur: { auto: { range: [0.45, 0.75], follow: '-energy' } }, each: { auto: { range: [0.03, 0.06], follow: '-density' } },
      ease: { auto: { value: 'linear' } } },
    params: {
      block: { type: 'num', min: 0.1, max: 1, step: 0.05, unit: 'em', label: { ja: '最初の粗さ', en: 'First block size' },
        auto: { range: [0.35, 0.55] } },
    },
    make: K.perGlyph(pixelate),
  });

  const staticJoin = K.arrive({
    key: 'staticJoin',
    label: { ja: '乱入', en: 'Glitch in' },
    blurb: { ja: '色ずれを伴って横に震え、ぴたりと止まる', en: 'Glyphs jitter sideways with color echoes, then lock in place' },
    tags: ['digital', 'hard', 'fast'], family: 'flicker', gate: 'glitch',
    traits: { energy: [0.4, 1] },
    shared: { dur: { auto: { range: [0.35, 0.6], follow: '-energy' } }, each: { auto: { range: [0.01, 0.03] } },
      order: { auto: { pick: ['scatter', 'lead'], weights: [2, 1] } }, ease: { auto: { pick: ['quadOut', 'sineOut'], weights: [2, 1] } } },
    params: {
      spread: { type: 'num', min: 0.05, max: 1.5, step: 0.05, unit: 'em', label: { ja: '揺れ幅', en: 'Spread' },
        auto: { range: [0.3, 0.8], follow: 'amount.glitch' } },
      rate: { type: 'num', min: 6, max: 30, step: 1, unit: 'Hz', label: { ja: '乱れの速さ', en: 'Glitch rate' },
        auto: { value: 18 } },
    },
    make: K.perGlyph(glitch),
  });

  return [typeOn, strobeIn, pixelStep, staticJoin, strobeOut];
});
