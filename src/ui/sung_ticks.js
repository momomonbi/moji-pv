/* 文字PVメーカー v2 — original work. 歌ハメ on the timeline: a line's character times as ticks under its bar, and the pins a tick drag, a double-click or a nudge writes (DESIGN_2_2 §6). */
MV.def('ui/sung_ticks', ['planner/sung', 'i18n/t'], (SU, T) => {
  'use strict';

  const TICK_PX = 7;            // a tick's height, at the bottom of the line's bar
  const HIT_PX = 4;             // a tick within this many px of the pointer is hit (selected lines only)
  const MIN_UNIT_PX = 5;        // ticks are drawn from this many px per unit (always on a selected line)
  const CHAR_UNIT_PX = 12;      // … and a selected line's characters above them from this many
  const GAP = 0.02;             // a moved tick keeps this far from its neighbours and the end (seconds)
  const CHAR_FONT = 9;
  // By source (planner/sung SRC: est, voice, copy, lrc, pin): a time set by hand or a tap bright, a word tag or a copy
  // like an LRC stamp, the voice blue, an estimate faint.
  const SRC_COLORS = Object.freeze(['rgba(242,239,232,0.35)', 'rgba(124,196,255,0.8)', '#c9b27a', '#c9b27a', '#f2efe8']);
  const FOCUS = '#7cc4ff';
  const CHAR_INK = 'rgba(242,239,232,0.85)';

  const q3 = (x) => Math.round(x * 1000) / 1000;

  // spanEndOf(lines, i) → where line i's characters must be sung by: its end, or the next line's start when earlier
  // (the span planner/sung reads; a pair after it is not used).
  function spanEndOf(lines, i) {
    const l = lines[i], next = lines[i + 1];
    return next && next.t0 > l.t0 ? Math.min(l.t1, next.t0) : l.t1;
  }

  // ticksOf(ls, line) → [{ u, t, src }]: a tick for every unit after the first, and for the first when it is sung
  // after the line's start (at the start it is the start edge). ls = plan.sung.get(line.id); times absolute.
  function ticksOf(ls, line) {
    const out = [];
    if (!ls) return out;
    for (let u = 0; u < ls.t.length; u++) {
      if (u === 0 && !(ls.t[0] > line.t0 + 0.0005)) continue;
      out.push({ u, t: ls.t[u], src: ls.src[u] });
    }
    return out;
  }

  // shown(ls, line, xOf, selected) → whether the line's ticks are drawn: always on a selected line, else with room.
  function shown(ls, line, xOf, selected) {
    if (!ls || !ls.t.length) return false;
    return !!selected || (xOf(ls.end) - xOf(line.t0)) / ls.t.length >= MIN_UNIT_PX;
  }

  // hit(ls, line, x, xOf) → the unit whose tick is nearest to x within HIT_PX, or -1.
  function hit(ls, line, x, xOf) {
    let best = -1, dist = HIT_PX + 1e-9;
    for (const k of ticksOf(ls, line)) {
      const d = Math.abs(xOf(k.t) - x);
      if (d <= dist) { dist = d; best = k.u; }
    }
    return best;
  }

  // bounds(ls, line, u, spanEnd) → { lo, hi } (absolute seconds): where unit u may move — GAP after the unit before it
  // (the line's start for the first), GAP before the unit after it; the last unit up to the sung end when that is
  // explicit (a pin, a word tag or a copy), else up to the line's span (the end is estimated again from the new times).
  function bounds(ls, line, u, spanEnd) {
    const n = ls.t.length;
    const lo = u > 0 ? ls.t[u - 1] + GAP : line.t0;
    const hi = u + 1 < n ? ls.t[u + 1] - GAP : (ls.endSrc > 0 ? ls.end : spanEnd) - GAP;
    return { lo, hi: Math.max(lo, hi) };
  }

  // movedPin(ls, line, t0, u, t) → the line's sung.times value with unit u at t (absolute) and every other unit where it
  // is now (so nothing else moves), relative to t0; plus the end pair where the end is explicit. A pair closer than
  // the planner's DT_GAP to the one kept before it is left out (it is interpolated again); the moved unit is always
  // kept. null when u lies past the pin's size.
  function movedPin(ls, line, t0, u, t) {
    const n = Math.min(ls.t.length, SU.C.PIN_MAX - 1);
    if (u >= n) return null;
    const out = [];
    const gapOK = (dt) => !out.length || dt >= out[out.length - 1][1] + SU.C.DT_GAP - 1e-9;
    for (let k = 0; k < n; k++) {
      const dt = Math.max(0, q3((k === u ? t : ls.t[k]) - t0));
      if (k === u) while (!gapOK(dt)) out.pop();
      else if (!gapOK(dt)) continue;
      out.push([ls.at[k], dt]);
    }
    if (ls.endSrc > 0) {
      const e = q3(ls.end - t0);
      if (gapOK(e) && e <= SU.C.DT_MAX) out.push([String(line.text).length, e]);
    }
    return out;
  }

  // moveCmds(ls, line, u, t) → the commands of one tick move: the line's automatic start pinned where it is now (the
  // characters' times are relative to it, and a floating start would carry them off the voice when lines above
  // change), then the pin. null when nothing can be written.
  function moveCmds(ls, line, u, t) {
    const auto = !line.by || line.by.start === 'auto';
    const t0 = auto ? q3(line.t0) : line.t0;
    const v = movedPin(ls, line, t0, u, t);
    if (!v) return null;
    const cmds = [];
    if (auto) cmds.push({ t: 'pin.set', path: 'line/' + line.id + ':start', v: t0, by: 'user' });
    cmds.push({ t: 'pin.set', path: 'line/' + line.id + ':sung.times', v, by: 'user' });
    return cmds;
  }

  // removeCmd(line, u, pin) → the command that gives unit u back to the estimate: the pin without the pairs on that
  // unit, cleared when nothing is left; null when the line has no pin or the unit no pair in it.
  function removeCmd(line, u, pin) {
    if (!pin || !Array.isArray(pin.v)) return null;
    const path = 'line/' + line.id + ':sung.times';
    const text = String(line.text), units = SU.unitsOf(text, line.lang);
    const keep = pin.v.filter((p) => !Array.isArray(p) || p[0] >= text.length || SU.unitAt(units, p[0]) !== u);
    if (keep.length === pin.v.length) return null;
    return keep.length ? { t: 'pin.set', path, v: keep, by: 'user' } : { t: 'pin.clear', path };
  }

  // unitText(ls, line, u) → what unit u sings (trimmed), for the listbox and the characters above the ticks.
  function unitText(ls, line, u) {
    const text = String(line.text);
    const s = text.slice(ls.at[u], u + 1 < ls.at.length ? ls.at[u + 1] : text.length).trim();
    return s || text.slice(ls.at[u], ls.at[u] + 1);
  }

  // label(t, ls, line, u) → 「きの時間 0:12.41」 (the listbox reads it for a focused tick).
  function label(t, ls, line, u) {
    return t('tl.tick', { ch: unitText(ls, line, u), time: T.fmtTime(ls.t[u]) });
  }

  // step(ls, line, u, d) → the tick d (±1) from unit u, or the first / last tick when u is not a tick; -1 when none.
  function step(ls, line, u, d) {
    const list = ticksOf(ls, line).map((k) => k.u);
    if (!list.length) return -1;
    const i = list.indexOf(u);
    if (i < 0) return d > 0 ? list[0] : list[list.length - 1];
    return list[Math.max(0, Math.min(list.length - 1, i + d))];
  }

  // charsFrom(ls, line, xOf, selected) → the x where a selected line's characters over its ticks begin (its name is
  // drawn before it), Infinity when they are not drawn.
  function charsFrom(ls, line, xOf, selected) {
    if (!selected || !ls || (xOf(ls.end) - xOf(line.t0)) / Math.max(1, ls.t.length) < CHAR_UNIT_PX) return Infinity;
    const first = ticksOf(ls, line)[0];
    return first ? xOf(first.t) - CHAR_UNIT_PX / 2 : Infinity;
  }

  let fontCss = null;
  // draw(g, o): a line's ticks at the bottom of its bar (y1), the end bracket, and on a selected line with room each
  // unit's first character above its tick. o = { ls, line, xOf, y1, selected, focus (unit or -1), W }.
  function draw(g, o) {
    const { ls, line, xOf, y1 } = o;
    const list = ticksOf(ls, line);
    const room = (xOf(ls.end) - xOf(line.t0)) / Math.max(1, ls.t.length);
    const chars = o.selected && room >= CHAR_UNIT_PX;
    g.save();
    if (chars) {
      if (!fontCss) fontCss = CHAR_FONT + 'px ' + getComputedStyle(document.body).fontFamily;
      g.font = fontCss;
      g.textBaseline = 'bottom';
      g.textAlign = 'center';
    }
    for (const k of list) {
      const x = Math.round(xOf(k.t)) + 0.5;
      if (x < -4 || x > o.W + 4) continue;
      const focused = k.u === o.focus;
      g.fillStyle = focused ? FOCUS : SRC_COLORS[k.src] || SRC_COLORS[0];
      g.fillRect(x - (focused ? 1.5 : 0.5), y1 - TICK_PX, focused ? 3 : 1, TICK_PX);
      if (chars) {
        g.fillStyle = focused ? FOCUS : CHAR_INK;
        g.fillText([...unitText(ls, line, k.u)][0] || '', x, y1 - TICK_PX - 1);
      }
    }
    // the sung end: a small bracket ⌋
    const xe = Math.round(xOf(ls.end)) + 0.5;
    if (xe >= -4 && xe <= o.W + 4) {
      g.fillStyle = SRC_COLORS[ls.endSrc] || SRC_COLORS[0];
      g.fillRect(xe - 0.5, y1 - TICK_PX, 1, TICK_PX);
      g.fillRect(xe - 3.5, y1 - 1, 3, 1);
      g.fillRect(xe - 3.5, y1 - TICK_PX, 3, 1);
    }
    g.restore();
  }

  return { TICK_PX, HIT_PX, MIN_UNIT_PX, CHAR_UNIT_PX, GAP, SRC_COLORS, spanEndOf, ticksOf, shown, hit, bounds, movedPin,
    moveCmds, removeCmd, unitText, label, step, charsFrom, draw };
});
