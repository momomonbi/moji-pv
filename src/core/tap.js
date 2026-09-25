/* 文字PVメーカー v2 — original work. Tap-sync as a pure reducer: marks, ends, stepping back, one command (DESIGN §4.11). */
MV.def('core/tap', [], () => {
  'use strict';

  const EVENTS = Object.freeze(['mark', 'end', 'back', 'pause', 'resume']);

  class TapError extends Error {
    constructor(code, message) { super(message || code); this.name = 'TapError'; this.code = code; }
  }

  // TapState = { lineIds, cursor, current, starts, ends, paused, next, active }
  //   cursor: index of the next line to mark; current: index of the line whose start was marked last (−1 = none);
  //   starts / ends: marked times per line (null = not marked); next / active: the lines at cursor / current, as ids.
  function state(lineIds, cursor, current, starts, ends, paused) {
    return {
      lineIds, cursor, current, starts, ends, paused,
      next: cursor < lineIds.length ? lineIds[cursor] : null,
      active: current >= 0 ? lineIds[current] : null,
    };
  }

  // Starts a session at `fromLineId` (the first line when it is null or unknown). `lines` are Line objects or ids.
  function tapStart(lines, fromLineId) {
    if (!Array.isArray(lines)) throw new TapError('bad-lines', 'tapStart needs a list of lines');
    const lineIds = Object.freeze(lines.map((l) => (typeof l === 'string' ? l : l.id)));
    const at = Math.max(0, lineIds.indexOf(fromLineId));
    const empty = new Array(lineIds.length).fill(null);
    return state(lineIds, at, -1, empty, empty.slice(), false);
  }

  function timeOf(ev) {
    const ok = typeof ev.t === 'number' && Number.isFinite(ev.t);
    if (!ok) throw new TapError('bad-event', 'a tap event needs a time t');
    return Math.max(0, ev.t);
  }

  function withTime(list, i, t) {
    const out = list.slice();
    out[i] = t;
    return out;
  }

  // mark: start of the next line (and advance) · end: end of the current line · back: forget the last line's marks and
  // step back one line · pause / resume: marks are ignored while paused. Returns the same state when nothing changes.
  function tapReduce(s, ev) {
    if (!ev || !EVENTS.includes(ev.type)) throw new TapError('bad-event', 'unknown tap event ' + (ev && ev.type));
    switch (ev.type) {
      case 'mark': {
        const t = timeOf(ev);
        if (s.paused || s.cursor >= s.lineIds.length) return s;
        const starts = withTime(s.starts, s.cursor, t);
        return state(s.lineIds, s.cursor + 1, s.cursor, starts, withTime(s.ends, s.cursor, null), false);
      }
      case 'end': {
        const t = timeOf(ev);
        if (s.paused || s.current < 0 || !(t > s.starts[s.current])) return s;
        return state(s.lineIds, s.cursor, s.current, s.starts, withTime(s.ends, s.current, t), false);
      }
      case 'back': {
        if (s.cursor === 0) return s;
        const i = s.cursor - 1;
        const prev = i - 1 >= 0 && s.starts[i - 1] !== null ? i - 1 : -1;
        return state(s.lineIds, i, prev, withTime(s.starts, i, null), withTime(s.ends, i, null), s.paused);
      }
      case 'pause':
        return s.paused ? s : state(s.lineIds, s.cursor, s.current, s.starts, s.ends, true);
      default:
        return s.paused ? state(s.lineIds, s.cursor, s.current, s.starts, s.ends, false) : s;
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

  return { tapStart, tapReduce, tapCommand, TapError, EVENTS };
});
