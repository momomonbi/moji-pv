/* 文字PVメーカー v2 — original work. Line timing solver: anchors, fills, snapping, ends, duration (DESIGN §4.11). */
MV.def('core/timing', ['core/pins', 'core/script', 'core/num', 'core/beats'], (PINS, S, N, B) => {
  'use strict';

  const ANCHOR_GAP = 0.1;       // an anchor closer than this to the previous one is out of order
  const MIN_LEN = 0.2;          // t1 ≥ t0 + 0.2
  const MIN_READ = 1.2;         // the shortest reading slot of a line
  const PAUSE_WEIGHT = 0.8;     // seconds of weight per blank row above a line
  const TIMING_DEFAULTS = Object.freeze({ snap: 'off', lead: 0.12, tail: 0.25, leadIn: 1, outro: 2, tapLatency: 0.06 });

  function isTime(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0; }

  // readRate slot (pin) → clamp(bpm / 20, 3, 14) with a BPM → 7 morae per second.
  function readRateOf(ctx) {
    if (typeof ctx.readRate === 'number' && ctx.readRate > 0 && Number.isFinite(ctx.readRate)) {
      return N.clamp(ctx.readRate, 3, 14);
    }
    if (typeof ctx.bpm === 'number' && ctx.bpm > 0) return N.clamp(ctx.bpm / 20, 3, 14);
    return 7;
  }

  // Accepts a PinIndex (core/pins.index) or a plain pins map.
  function pinIndexOf(pins) {
    if (pins && pins.line instanceof Map) return pins;
    return PINS.index(pins || {});
  }

  // Line-scope time pins ('start' / 'end'); a bad value is ignored with pin-bad-value.
  function linePin(ix, lineId, slot, warnings) {
    const hit = PINS.lookup(ix, { cutKey: null, pinCutKey: null, lineId }, slot);
    if (!hit || hit.from !== 'pin:line') return null;
    if (isTime(hit.v)) return hit.v;
    warnings.push({ code: 'pin-bad-value', path: hit.at, line: lineId });
    return null;
  }

  // Rule 1: anchors in line order; an anchor < previous anchor + 0.1 is demoted (LRC before pins; between two pins the
  // later one). The lines above the first anchor also need 0.1 s each from time 0, as forward-fill compression keeps:
  // a first anchor earlier than that (e.g. '[00:00.00]' below untagged rows, or a tap clamped to 0) is demoted too, so
  // starts stay strictly increasing. Returns start[i] (NaN = auto), kind[i] ('pin' | 'lrc' | 'auto') and the anchors.
  function chooseAnchors(lines, pinStart, warnings) {
    const n = lines.length;
    const start = new Float64Array(n).fill(NaN);
    const kind = new Array(n).fill('auto');
    const stack = [];
    const demote = (i) => {
      warnings.push(kind[i] === 'pin'
        ? { code: 'time-order', line: lines[i].id, path: 'line/' + lines[i].id + ':start' }
        : { code: 'time-order', line: lines[i].id });
      start[i] = NaN;
      kind[i] = 'auto';
    };
    for (let i = 0; i < n; i++) {
      if (pinStart[i] !== null) [start[i], kind[i]] = [pinStart[i], 'pin'];
      else if (isTime(lines[i].stamp)) [start[i], kind[i]] = [lines[i].stamp, 'lrc'];
      else continue;
      const pops = conflictsWon(i, stack, start, kind);
      if (pops < 0 || (pops === stack.length && start[i] < roomBefore(i))) { demote(i); continue; }
      for (let p = 0; p < pops; p++) demote(stack.pop());
      stack.push(i);
    }
    return { start, kind, anchors: stack };
  }

  // How many anchors at the top of the stack conflict with candidate i and lose to it (only LRC anchors lose to a
  // pin); −1 when i loses instead. Nothing is demoted when i loses, so an anchor that cannot stand never costs another.
  function conflictsWon(i, stack, start, kind) {
    let pops = 0;
    while (pops < stack.length) {
      const top = stack[stack.length - 1 - pops];
      if (start[i] >= start[top] + ANCHOR_GAP) break;
      if (kind[i] !== 'pin' || kind[top] !== 'lrc') return -1;
      pops++;
    }
    return pops;
  }

  // The earliest start of a first anchor with `count` lines above it: 0.1 s each (with a tolerance for float noise).
  function roomBefore(count) { return ANCHOR_GAP * count - 1e-9; }

  function solveTimes(lines, ctx) {
    const c = ctx || {};
    const timing = Object.assign({}, TIMING_DEFAULTS, c.timing || {});
    const warnings = [];
    const n = lines.length;
    const ix = pinIndexOf(c.pins);
    const song = typeof c.songSeconds === 'number' && c.songSeconds > 0 ? c.songSeconds : null;
    const titleCard = typeof c.titleCard === 'number' && c.titleCard > 0 ? c.titleCard : 0;
    const spm = 1 / readRateOf(c);

    const read = new Float64Array(n), pause = new Float64Array(n);
    lines.forEach((line, i) => {
      read[i] = Math.max(MIN_READ, S.morae(line.text, line.lang) * spm);
      pause[i] = PAUSE_WEIGHT * (line.pauseBefore || 0);
    });
    // The time from line k−1's start to line k's start at the nominal rate: its reading plus the pause above line k.
    const gap = (k) => read[k - 1] + pause[k];

    const pinStart = lines.map((l) => linePin(ix, l.id, 'start', warnings));
    const pinEnd = lines.map((l) => linePin(ix, l.id, 'end', warnings));
    const { start, kind, anchors } = chooseAnchors(lines, pinStart, warnings);
    const t0 = Float64Array.from(start);

    if (anchors.length === 0) {
      if (n) forwardFill(t0, 0, Math.max(titleCard, timing.leadIn), gap, read, song, timing, lines, warnings);
    } else {
      backFill(t0, anchors[0], gap, titleCard, lines, warnings);
      for (let a = 0; a + 1 < anchors.length; a++) spread(t0, anchors[a], anchors[a + 1], gap);
      const last = anchors[anchors.length - 1];
      forwardFill(t0, last, t0[last], gap, read, song, timing, lines, warnings);
    }
    snapAutoStarts(t0, kind, c, timing);

    const lengthPin = lengthOf(c, warnings);
    const known = lengthPin !== null ? lengthPin : song;
    // Rule 7: the end pin, else before the next line (minus a breath when blank rows separate them), else by the
    // duration; never later than the natural length t0 + max(4, 1.5·w).
    const autoEnd = (i) => {
      const natural = t0[i] + Math.max(4, 1.5 * (read[i] + pause[i]));
      if (i + 1 < n) {
        const pb = lines[i + 1].pauseBefore || 0;
        return Math.min(t0[i + 1] - (pb ? Math.min(0.4 * pb, 1.2) : 0), natural);
      }
      return known !== null ? Math.min(known - timing.outro * 0.5, natural) : natural;
    };
    const t1 = new Float64Array(n);
    const endBy = pinEnd.map((pin) => (pin !== null ? 'pin' : 'auto'));
    for (let i = 0; i < n; i++) t1[i] = Math.max(pinEnd[i] !== null ? pinEnd[i] : autoEnd(i), t0[i] + MIN_LEN);
    const duration = known !== null ? known
      : n ? t1[n - 1] + timing.outro : Math.max(titleCard, timing.leadIn) + timing.outro;

    const times = lines.map((line, i) => ({
      id: line.id, t0: N.q6(t0[i]), t1: N.q6(t1[i]), by: { start: kind[i], end: endBy[i] },
    }));
    return { times, duration: N.q6(duration), warnings };
  }

  function lengthOf(c, warnings) {
    if (c.lengthPin === null || c.lengthPin === undefined) return null;
    if (typeof c.lengthPin === 'number' && c.lengthPin > 0 && Number.isFinite(c.lengthPin)) return c.lengthPin;
    warnings.push({ code: 'pin-bad-value', path: 'work:length' });
    return null;
  }

  // Rule 4: lines before the first anchor, back-filled at the nominal rate; compressed into [titleCard, anchor]
  // when they would start before max(titleCard, 0). When the title card leaves them less than 0.1 s each, they
  // compress into [0, anchor] instead (chooseAnchors keeps at least that much room).
  function backFill(t0, first, gap, titleCard, lines, warnings) {
    if (first === 0) return;
    for (let k = first - 1; k >= 0; k--) t0[k] = t0[k + 1] - gap(k + 1);
    const lo = Math.max(titleCard, 0);
    if (t0[0] >= lo) return;
    const anchor = t0[first];
    mapSpan(t0, 0, first, [t0[0], anchor], [anchor - lo >= roomBefore(first) ? lo : 0, anchor]);
    warnings.push({ code: 'time-compressed', line: lines[0].id, detail: { lines: first } });
  }

  // Rule 3: starts between two anchors, proportional to the cumulative gaps.
  function spread(t0, p, q, gap) {
    if (q - p < 2) return;
    let total = 0;
    for (let k = p + 1; k <= q; k++) total += gap(k);
    let acc = 0;
    for (let k = p + 1; k < q; k++) {
      acc += gap(k);
      t0[k] = t0[p] + (t0[q] - t0[p]) * (acc / total);
    }
  }

  // Rule 5: from line `from` (at time `at`) onwards at the nominal rate; with a song, compressed so the fill ends by
  // songSeconds − outro.
  function forwardFill(t0, from, at, gap, read, song, timing, lines, warnings) {
    const n = t0.length;
    t0[from] = at;
    for (let k = from + 1; k < n; k++) t0[k] = t0[k - 1] + gap(k);
    if (song === null || from === n - 1) return;
    const end = t0[n - 1] + read[n - 1];
    const limit = song - timing.outro;
    if (end <= limit) return;
    const room = Math.max(limit - at, ANCHOR_GAP * (n - 1 - from));
    mapSpan(t0, from + 1, n, [at, end], [at, at + room]);
    warnings.push({ code: 'time-compressed', line: lines[from + 1].id, detail: { lines: n - 1 - from } });
  }

  // Maps t0[a..b) linearly from the span [x0, x1] onto [y0, y1].
  function mapSpan(t0, a, b, [x0, x1], [y0, y1]) {
    if (!(x1 > x0)) return;
    for (let k = a; k < b; k++) t0[k] = y0 + (y1 - y0) * ((t0[k] - x0) / (x1 - x0));
  }

  // Rule 6: auto starts move to the nearest grid time within ±min(0.12, period / 4), keeping the order strict.
  function snapAutoStarts(t0, kind, c, timing) {
    if (timing.snap === 'off') return;
    const g = c.grid || B.grid({ bpm: c.bpm, offset: c.beatOffset || 0, meter: c.meter || 4 });
    if (!g) return;
    const tol = Math.min(0.12, g.period / 4);
    for (let i = 0; i < t0.length; i++) {
      if (kind[i] !== 'auto') continue;
      const s = g.snap(t0[i], timing.snap, tol);
      const prevOk = i === 0 ? s >= 0 : s > t0[i - 1];
      const nextOk = i + 1 === t0.length || s < t0[i + 1];
      if (prevOk && nextOk) t0[i] = s;
    }
  }

  return { solveTimes, readRateOf, TIMING_DEFAULTS };
});
