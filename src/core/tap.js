/* 文字PVメーカー v2 — original work. Tap-sync as a pure reducer: marks, ends, stepping back, one command (DESIGN §4.11). */
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

  // mark: start of the next line (and advance); a mark less than MIN_GAP after the last start is ignored · end: end of the
  // current line · back: forget the last line's marks and step back one line · pause / resume: marks are ignored while
  // paused. Returns the same state when nothing changes.
  function tapReduce(s, ev) {
    if (!ev || !EVENTS.includes(ev.type)) throw new TapError('bad-event', 'unknown tap event ' + (ev && ev.type));
    switch (ev.type) {
      case 'mark': {
        const t = timeOf(ev);
        if (s.paused || s.cursor >= s.lineIds.length || t < lastStart(s) + MIN_GAP) return s;
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

  // --- 1字ずつタップ: the sung units of one line (歌ハメ, DESIGN_2_2 §6) ------------------------------------------------

  const UNIT_EVENTS = Object.freeze(['mark', 'end', 'back', 'pause', 'resume', 'restart', 'loopEnd']);
  // A unit mark closer than this to the one before is not taken (a double press); it also keeps every stored time at
  // least planner/sung's 0.01 s after the one before once rounded to the millisecond.
  const UNIT_GAP = 0.04;

  // UnitTapState = { units, cursor, times, end, paused, done, atLoopEnd, endOk }
  //   units: [{ at, text }] (at = the unit's offset in the line text); cursor: the next unit to mark; times: marked times
  //   per unit (null = not marked); end: where the singing ends (null = not marked); paused: playback is stopped (marks
  //   are ignored); done: every unit and the end are marked; atLoopEnd: playback stopped at the loop's end (the take is
  //   kept until 決定 or もう一度); endOk: whether the end may be marked (opts.end, default true).
  function unitState(units, cursor, times, end, paused, atLoopEnd, endOk) {
    return { units, cursor, times, end, paused, done: cursor === units.length && end !== null, atLoopEnd, endOk };
  }

  function unitNext(s, cursor, times, end, paused, atLoopEnd) {
    return unitState(s.units, cursor, times, end, paused, atLoopEnd, s.endOk);
  }

  // unitStart(units, { end }) → a session over the units of one line, in text order.
  function unitStart(units, opts) {
    if (!Array.isArray(units)) throw new TapError('bad-units', 'unitStart needs a list of units');
    const list = Object.freeze(units.map((u) => {
      if (!u || !Number.isInteger(u.at) || u.at < 0) throw new TapError('bad-units', 'each unit needs an offset at');
      return Object.freeze({ at: u.at, text: typeof u.text === 'string' ? u.text : '' });
    }));
    for (let i = 1; i < list.length; i++) {
      if (list[i].at <= list[i - 1].at) throw new TapError('bad-units', 'unit offsets must increase');
    }
    return unitState(list, 0, Object.freeze(new Array(list.length).fill(null)), null, false, false,
      !(opts && opts.end === false));
  }

  function lastMark(s) { return s.cursor > 0 ? s.times[s.cursor - 1] : -Infinity; }

  // mark: the next unit (not paused, a unit left, at least UNIT_GAP after the last mark); a mark after the end takes
  // the end back (the singing went on) · end: where the singing ends (at least one mark, UNIT_GAP after the last) · back:
  // forget the end, else the last mark · restart: forget everything (もう一度) · loopEnd: playback stopped at the loop's
  // end: paused, the take kept · pause / resume as tapReduce (resume leaves the loop's end). Returns the same state
  // when nothing changes.
  function unitReduce(s, ev) {
    if (!ev || !UNIT_EVENTS.includes(ev.type)) throw new TapError('bad-event', 'unknown unit tap event ' + (ev && ev.type));
    switch (ev.type) {
      case 'mark': {
        const t = timeOf(ev);
        if (s.paused || s.cursor >= s.units.length || t < lastMark(s) + UNIT_GAP) return s;
        const times = s.times.slice();
        times[s.cursor] = t;
        return unitNext(s, s.cursor + 1, Object.freeze(times), null, false, false);
      }
      case 'end': {
        const t = timeOf(ev);
        if (!s.endOk || s.paused || s.cursor === 0 || t < lastMark(s) + UNIT_GAP) return s;
        return unitNext(s, s.cursor, s.times, t, false, false);
      }
      case 'back': {
        if (s.end !== null) return unitNext(s, s.cursor, s.times, null, s.paused, s.atLoopEnd);
        if (s.cursor === 0) return s;
        const times = s.times.slice();
        times[s.cursor - 1] = null;
        return unitNext(s, s.cursor - 1, Object.freeze(times), null, s.paused, s.atLoopEnd);
      }
      case 'restart':
        if (s.cursor === 0 && s.end === null && !s.atLoopEnd) return s;
        return unitNext(s, 0, Object.freeze(new Array(s.units.length).fill(null)), null, s.paused, false);
      case 'loopEnd':
        return s.paused && s.atLoopEnd ? s : unitNext(s, s.cursor, s.times, s.end, true, true);
      case 'pause':
        return s.paused ? s : unitNext(s, s.cursor, s.times, s.end, true, s.atLoopEnd);
      default:
        return s.paused ? unitNext(s, s.cursor, s.times, s.end, false, false) : s;
    }
  }

  const q3 = (x) => Math.round(x * 1000) / 1000;

  // unitResult(s) → null (fewer than 2 marks) | { start, times: [[at, dt], …], end: dt | null }: the first mark is the
  // line's start (unit 0 is always marked first), every time is relative to it, to the millisecond.
  function unitResult(s) {
    if (s.cursor < 2) return null;
    const start = q3(s.times[0]);
    const times = [];
    for (let i = 0; i < s.cursor; i++) times.push([s.units[i].at, Math.max(0, q3(s.times[i] - start))]);
    return { start, times, end: s.end !== null ? q3(s.end - start) : null };
  }

  return { tapStart, tapReduce, tapCommand, TapError, EVENTS, MIN_GAP, UNIT_EVENTS, UNIT_GAP, unitStart, unitReduce, unitResult };
});
