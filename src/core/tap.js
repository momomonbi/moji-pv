/* 文字PVメーカー v2 — original work. Tap-sync as a pure reducer: marks, ends, stepping back, one command; the one-line mode and the pins that keep the other lines still (DESIGN §4.11; DESIGN_2_2 §5). */
MV.def('core/tap', [], () => {
  'use strict';

  const EVENTS = Object.freeze(['mark', 'end', 'back', 'pause', 'resume']);
  // core/timing drops a start less than 0.1 s after the start above it (time-order): such a mark would be recorded and
  // then never used, so it is not taken (as with the frozen clock of stopped playback, where every mark is equal).
  // A little more than 0.1 s, so that rounding the stored times can never bring two marks under timing's gap.
  const MIN_GAP = 0.12;

  class TapError extends Error {
    constructor(code, message) { super(message || code); this.name = 'TapError'; this.code = code; }
  }

  // A start that moved less than this between two plans has not moved (stillPins).
  const STILL_EPS = 0.005;

  // TapState = { lineIds, cursor, current, starts, ends, paused, next, active, only, from, stop }
  //   cursor: index of the next line to mark; current: index of the line whose start was marked last (−1 = none);
  //   starts / ends: marked times per line (null = not marked); next / active: the lines at cursor / current, as ids;
  //   only: the one-line mode (この行だけ打ち直す, PV22 S2) — from is the session's line and stop = from + 1, so one mark
  //   is taken; in the normal mode stop = lineIds.length (the session runs through the song).
  function state(lineIds, cursor, current, starts, ends, paused, only, from, stop) {
    return {
      lineIds, cursor, current, starts, ends, paused, only, from, stop,
      next: cursor < stop ? lineIds[cursor] : null,
      active: current >= 0 ? lineIds[current] : null,
    };
  }

  // A state like s with other marks and positions (the mode, first line and stop are kept).
  function next(s, cursor, current, starts, ends, paused) {
    return state(s.lineIds, cursor, current, starts, ends, paused, s.only, s.from, s.stop);
  }

  // Starts a session at `fromLineId` (the first line when it is null or unknown). `lines` are Line objects or ids.
  // opts.only: the one-line mode — exactly that line is marked (DESIGN_2_2 §5, S2).
  function tapStart(lines, fromLineId, opts) {
    if (!Array.isArray(lines)) throw new TapError('bad-lines', 'tapStart needs a list of lines');
    const lineIds = Object.freeze(lines.map((l) => (typeof l === 'string' ? l : l.id)));
    const at = Math.max(0, lineIds.indexOf(fromLineId));
    const only = !!(opts && opts.only) && lineIds.length > 0;
    const empty = new Array(lineIds.length).fill(null);
    return state(lineIds, at, -1, empty, empty.slice(), false, only, at, only ? at + 1 : lineIds.length);
  }

  // Every line the session may mark is marked.
  function done(s) { return s.cursor >= s.stop; }

  function timeOf(ev) {
    const ok = typeof ev.t === 'number' && Number.isFinite(ev.t);
    if (!ok) throw new TapError('bad-event', 'a tap event needs a time t');
    return Math.max(0, ev.t);
  }

  // The latest start marked above the cursor (−Infinity when none).
  function lastStart(s) {
    for (let i = s.cursor - 1; i >= 0; i--) if (s.starts[i] !== null) return s.starts[i];
    return -Infinity;
  }

  function withTime(list, i, t) {
    const out = list.slice();
    out[i] = t;
    return out;
  }

  // mark: start of the next line (and advance); a mark less than MIN_GAP after the last start is ignored, and so is a
  // mark past the session's stop (the one-line mode takes one) · end: end of the current line · back: forget the last
  // line's marks and step back one line (never above the one-line mode's line) · pause / resume: marks are ignored
  // while paused. Returns the same state when nothing changes.
  function tapReduce(s, ev) {
    if (!ev || !EVENTS.includes(ev.type)) throw new TapError('bad-event', 'unknown tap event ' + (ev && ev.type));
    switch (ev.type) {
      case 'mark': {
        const t = timeOf(ev);
        if (s.paused || s.cursor >= s.stop || t < lastStart(s) + MIN_GAP) return s;
        const starts = withTime(s.starts, s.cursor, t);
        return next(s, s.cursor + 1, s.cursor, starts, withTime(s.ends, s.cursor, null), false);
      }
      case 'end': {
        const t = timeOf(ev);
        if (s.paused || s.current < 0 || !(t > s.starts[s.current])) return s;
        return next(s, s.cursor, s.current, s.starts, withTime(s.ends, s.current, t), false);
      }
      case 'back': {
        if (s.cursor === 0 || (s.only && s.cursor <= s.from)) return s;
        const i = s.cursor - 1;
        const prev = i - 1 >= 0 && s.starts[i - 1] !== null ? i - 1 : -1;
        return next(s, i, prev, withTime(s.starts, i, null), withTime(s.ends, i, null), s.paused);
      }
      case 'pause':
        return s.paused ? s : next(s, s.cursor, s.current, s.starts, s.ends, true);
      default:
        return s.paused ? next(s, s.cursor, s.current, s.starts, s.ends, false) : s;
    }
  }

  // One time.tap command for the whole session, in line order; null when nothing was marked.
  function tapCommand(s) {
    const marks = [];
    s.lineIds.forEach((lineId, i) => {
      if (s.starts[i] === null && s.ends[i] === null) return;
      const m = { lineId };
      if (s.starts[i] !== null) m.start = s.starts[i];
      if (s.ends[i] !== null) m.end = s.ends[i];
      marks.push(m);
    });
    return marks.length ? { t: 'time.tap', marks } : null;
  }

  // stillPins(before, after, lineId, start) → [{ lineId, start }]: the start pins that keep the automatic lines where
  // they were (「前後の行を動かさない」, PV22 S2). before / after: plan.lines of the document before the re-tap and of a
  // trial with it (the same ids in the same order, else []). The automatic lines other than lineId that moved form
  // runs; pinning the two ends of each run at their old starts puts the run back (between two anchors the automatic
  // starts are linear in their weights, and the fills are linear maps), as long as the pin keeps the order with the
  // new start (at least MIN_GAP from it). Callers repeat with a new trial until nothing is added (at most 3 rounds).
  function stillPins(before, after, lineId, start) {
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return [];
    if (before.some((l, k) => l.id !== after[k].id)) return [];
    const target = before.findIndex((l) => l.id === lineId);
    if (target < 0) return [];
    const moved = before.map((l, k) => k !== target && l.by && l.by.start === 'auto' &&
      Math.abs(after[k].t0 - l.t0) >= STILL_EPS);
    const picks = [];
    for (let k = 0; k < moved.length; k++) {
      if (!moved[k]) continue;
      let e = k;
      while (e + 1 < moved.length && moved[e + 1]) e++;
      for (const i of e === k ? [k] : [k, e]) {
        const t0 = before[i].t0;
        if (i < target ? t0 <= start - MIN_GAP : t0 >= start + MIN_GAP) picks.push({ lineId: before[i].id, start: t0 });
      }
      k = e;
    }
    return picks;
  }

  return { tapStart, tapReduce, tapCommand, done, stillPins, TapError, EVENTS, MIN_GAP, STILL_EPS };
});
