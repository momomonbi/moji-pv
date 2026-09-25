/* 文字PVメーカー v2 — original work. Typewriter exit: the caret erases the line from its end (type erase). */
MV.def('parts/depart/type', ['parts/kit'], (K) => {
  'use strict';

  const EVERY_ROLE = ['lyric', 'focus', 'title', 'interlude', 'outro'];

  const CARET_W = 0.07;          // caret bar thickness (em of the run)
  const CARET_L = 0.92;          // caret bar length (em)
  const CARET_GAP = 0.05;        // space between a glyph and the caret (em of the glyph)
  const BLINK = 0.5;             // caret blink period (s); it blinks while waiting and stays lit while erasing
  const ANTICIPATE = 0.35;       // the caret shows up this long before the first deletion

  // Erased: untouched until the caret reaches it, then gone in a blink.
  function eraseGlyph(P, g, k, u) {
    if (u <= 0) return;
    const c = k > 1 ? 1 : k;
    P.alpha *= 1 - c;
    P.sx *= 1 - 0.3 * c;
  }

  // --- the caret -------------------------------------------------------------------------------------------------------
  // (parts/arrive/digital.js has the typing counterpart for typeOn: parts share code only through the kit.)

  // One caret bar per run: a shape parented to the run node (so it follows the run's turn and nudges), drawn over its
  // glyphs. A behaviour moves the bar of the active run in front of the glyph erased last and hides the others. It runs
  // in the ORNAMENT phase: the caret is an extra mark, not a glyph pose.
  function runCaret(P, t, b) {
    let j = -1, tj = -Infinity;
    for (let q = 0; q < b.when.length; q++) {
      const w = b.when[q];
      if (w <= t && w > tj) { j = q; tj = w; }                 // the glyph erased last (the earlier one on a tie)
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

  // The caret behaviour for the kit's per-glyph behaviour `glyphs` (its delays give each glyph's deletion time), drawn
  // in `ink`: after the first glyph to go while waiting, then in front of each glyph as it is erased.
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
      caretSpot(cells, target, j, false, vertical[runOf[j]], spot);
      posX[j] = spot[0]; posY[j] = spot[1];
      if (when[j] < when[first]) first = j;
      if (when[j] > when[last]) last = j;
    }
    caretSpot(cells, target, first, true, vertical[runOf[first]], spot);
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
    return {
      phase: K.PH.ORNAMENT, live: 'always', from, to: from + runs.length,
      t0: Math.max(times.rest, firstT - ANTICIPATE), t1: times.b, run: runCaret,
      when, posX, posY, runOf, baseX, baseY, startRun: runOf[first], startX: spot[0], startY: spot[1], firstT, lastT,
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

  const bound = K.depart({
    key: 'typeErase',
    label: { ja: '消去', en: 'Type erase' },
    blurb: { ja: 'カーソルが末尾から一文字ずつ消していく', en: 'The caret deletes glyphs from the end' },
    tags: ['digital', 'minimal'], family: 'type',
    traits: { cells: [1, 32], roles: EVERY_ROLE },
    shared: { dur: { auto: { range: [0.05, 0.08] } }, each: { auto: { range: [0.04, 0.08], follow: '-density' } },
      order: { auto: { value: 'tail' } }, ease: { auto: { value: 'quadOut' } } },
    make: K.perGlyph(eraseGlyph),
  });

  return [K.variant(bound, { key: 'typeErase', make: withCaret(bound.make) })];
});
