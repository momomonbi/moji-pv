/* 文字PVメーカー v2 — original work. The cutter: lines → cut skeletons, special cuts, windows, pin reattachment (DESIGN §4.16.5). */
MV.def('planner/segment', ['core/script', 'core/num', 'core/pins', 'core/rng', 'engine/text/breaker', 'planner/choose',
  'planner/params'], (S, N, PINS, R, BR, CH, PA) => {
  'use strict';

  const BASE = Object.freeze({ '16:9': 14, '21:9': 16, '4:3': 12, '1:1': 10, '4:5': 10, '3:4': 9, '9:16': 8 });
  const LONG_PIECE = 4.5;       // a line longer than this (seconds) is split when it has ≥ 2 phrases
  const MAX_PIECES = 3;
  const MIN_AUTO_PIECE = 0.7;   // auto pieces are at least this long (seconds, shared by morae)
  const MIN_PIECE = 0.35;       // shorter pieces merge into the previous one
  const FOCUS_SHARE = 0.25, FOCUS_TIME = 1.2;
  const TITLE_ROOM = 1.5, TITLE_MIN = 0.8, TITLE_GAP = 0.2;
  const INTRO_ROOM = 3, OUTRO_ROOM = 3, GAP_MIN = 2.8;
  const SPECIAL_ROLES = new Set(['title', 'interlude', 'outro']);

  // Specs of the line- and cut-scope timing slots (§3.4.2, §3.4.3), shown by planner/fields.
  const LINE_SPECS = Object.freeze({
    start: { type: 'num', min: 0, max: 36000, step: 0.001, unit: 's' },
    end: { type: 'num', min: 0, max: 36000, step: 0.001, unit: 's' },
    t0: { type: 'num', min: 0, max: 36000, step: 0.001, unit: 's' },
    lang: { type: 'enum', of: ['ja', 'en', 'zhHant', 'zhHans', 'ko'] },
    split: { type: 'split' },
  });

  const q6 = N.q6;

  // --- pieces ----------------------------------------------------------------------------------------------

  // Small memo for the text measures the cutter asks for again and again on every re-plan (phrases, weights).
  let memoPrev = new Map(), memoCur = new Map();
  function memo(key, make) {
    let v = memoCur.get(key);
    if (v === undefined) {
      v = memoPrev.get(key);
      if (v === undefined) v = make();
      if (memoCur.size >= 4000) { memoPrev = memoCur; memoCur = new Map(); }
      memoCur.set(key, v);
    }
    return v;
  }

  function phrasesOf(text, lang) { return memo('p|' + lang + '|' + text, () => BR.phrases(text, lang)); }

  // Reading weight of text ranges: morae, else cells, else 1 each.
  function weightsOf(text, starts, lang) {
    return memo('w|' + lang + '|' + starts.join(',') + '|' + text, () => measureWeights(text, starts, lang));
  }

  function measureWeights(text, starts, lang) {
    const ranges = starts.map((a, i) => [a, i + 1 < starts.length ? starts[i + 1] : text.length]);
    const morae = ranges.map(([a, b]) => S.morae(text.slice(a, b), lang));
    if (morae.some((m) => m > 0)) return morae;
    const cells = ranges.map(([a, b]) => S.cells(text.slice(a, b)));
    return cells.some((c) => c > 0) ? cells : ranges.map(() => 1);
  }

  function sum(list) { let s = 0; for (const x of list) s += x; return s; }

  // A split pin: 'none' or sorted offsets starting with 0 (inside the text, on grapheme boundaries).
  function acceptSplit(text) {
    const offs = S.graphemeOffsets(text);
    const bounds = new Set(offs);
    return (v) => {
      if (v === 'none') return { v: [0] };
      if (!Array.isArray(v) || v[0] !== 0) return { bad: true };
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        if (!Number.isInteger(x) || x >= text.length || !bounds.has(x) || (i > 0 && x <= v[i - 1])) return { bad: true };
      }
      return { v: v.slice() };
    };
  }

  // Auto cutter: split at phrase boundaries into k pieces that minimize the spread of cells (Σ cells²), each piece
  // ≥ 0.7 s of the line (by morae). Falls back to fewer pieces when k is not feasible.
  function autoStarts(text, lang, dur, maxCells) {
    const cells = S.cells(text);
    const phrases = phrasesOf(text, lang);
    if (phrases.length < 2 || !(cells > maxCells || dur > LONG_PIECE)) return [0];
    const starts = phrases.map((r) => r[0]);
    starts[0] = 0;
    const m = starts.length;
    const unitCells = starts.map((a, i) => S.cells(text.slice(a, i + 1 < m ? starts[i + 1] : text.length)));
    const unitWeights = weightsOf(text, starts, lang);
    const total = sum(unitWeights);
    const want = Math.min(MAX_PIECES, Math.ceil(Math.max(cells / maxCells, dur / LONG_PIECE)), m);
    for (let k = want; k >= 2; k--) {
      const cut = bestSplit(unitCells, unitWeights, total, dur, k);
      if (cut) return cut.map((i) => starts[i]);
    }
    return [0];
  }

  // DP over units: first unit index of each of the k pieces, or null when no split keeps every piece ≥ 0.7 s.
  function bestSplit(cells, weights, total, dur, k) {
    const m = cells.length;
    const pre = [0], preW = [0];
    for (let i = 0; i < m; i++) { pre.push(pre[i] + cells[i]); preW.push(preW[i] + weights[i]); }
    const ok = (i, j) => total > 0 && dur * (preW[j] - preW[i]) / total >= MIN_AUTO_PIECE - 1e-9;
    const cost = (i, j) => (pre[j] - pre[i]) * (pre[j] - pre[i]);
    const best = [], from = [];
    for (let p = 0; p <= k; p++) { best.push(new Array(m + 1).fill(Infinity)); from.push(new Array(m + 1).fill(-1)); }
    best[0][0] = 0;
    for (let p = 1; p <= k; p++) {
      for (let j = p; j <= m; j++) {
        for (let i = p - 1; i < j; i++) {
          if (best[p - 1][i] === Infinity || !ok(i, j)) continue;
          const c = best[p - 1][i] + cost(i, j);
          if (c < best[p][j] - 1e-9) { best[p][j] = c; from[p][j] = i; }
        }
      }
    }
    if (best[k][m] === Infinity) return null;
    const out = [];
    for (let p = k, j = m; p > 0; p--) { const i = from[p][j]; out.push(i); j = i; }
    return out.reverse();
  }

  function cellsOf(text, a, b) { return S.cells(text.slice(a, b)); }

  // The emphasized range with the most cells, or the last phrase of an impact line.
  function focusRange(line) {
    let best = null, bestCells = -1;
    for (const [a, b] of line.emph || []) {
      const c = cellsOf(line.text, a, b);
      if (c > bestCells) { best = [a, b]; bestCells = c; }
    }
    if (best) return best;
    if (!line.impact) return null;
    const phrases = phrasesOf(line.text, line.lang);
    return phrases.length ? [phrases[phrases.length - 1][0], line.text.length] : null;
  }

  // A focus piece (§4.16.5): the range covers ≥ 25 % of the line's cells and gets ≥ 1.2 s, and the cutter's coin
  // (stream(cutSeed, 'cutter') of the line's first cut) comes up with probability mood.pace.focus. → [ra, rb] or null.
  function focusWins(ctx, line, dur) {
    const range = focusRange(line);
    if (!range) return null;
    const text = line.text;
    const [ra, rb] = range;
    if (ra === 0 && rb >= text.length) return null;
    const total = S.cells(text);
    const cuts = [0, ra, rb].filter((x, i, all) => x < text.length && (i === 0 || x > all[i - 1]));
    const w = weightsOf(text, cuts, line.lang);
    const share = w[cuts.indexOf(ra)] / sum(w);
    if (!(cellsOf(text, ra, rb) >= FOCUS_SHARE * total) || !(dur * share >= FOCUS_TIME)) return null;
    const seed = CH.cutSeed(ctx.doc.look.seed, line.id + '~0', line.id, ctx.salts);
    return R.stream(seed, 'cutter').chance(ctx.pace.focus) ? range : null;
  }

  // Auto pieces: the focus range becomes its own piece.
  function withFocus(ctx, line, starts, dur) {
    const range = focusWins(ctx, line, dur);
    if (!range) return { starts, focus: null };
    const [ra, rb] = range;
    const set = new Set(starts.filter((x) => x <= ra || x >= rb));
    set.add(ra);
    if (rb < line.text.length) set.add(rb);
    return { starts: [...set].sort((x, y) => x - y), focus: ra };
  }

  // Pieces from a split pin or '/' marks: a piece that is exactly the focus range has the focus role as it would have
  // from the auto cutter, so a role never depends on where the boundaries came from, and pinning the split as it
  // stands (a lock, or the cut points of the inspector) changes nothing.
  function givenFocus(ctx, line, starts, dur) {
    const range = focusWins(ctx, line, dur);
    if (!range) return null;
    const k = starts.indexOf(range[0]);
    const end = k + 1 < starts.length ? starts[k + 1] : line.text.length;
    return k >= 0 && end === Math.min(range[1], line.text.length) ? range[0] : null;
  }

  function piecesOf(ctx, line, spanEnd) {
    const text = line.text;
    const dur = spanEnd - line.t0;
    const pin = PA.resolvePin(ctx.ix, { pinCutKey: null, lineId: line.id, cutKey: null }, 'split',
      (v, rank) => (rank === 'pin:line' ? acceptSplit(text)(v) : { na: true }), ctx.warn);
    if (pin) return { starts: pin.v, from: pin.from, by: pin.by, focus: givenFocus(ctx, line, pin.v, dur) };
    if (line.pieces) {
      const starts = line.pieces.map((r) => r[0]);
      return { starts, from: 'mark', focus: givenFocus(ctx, line, starts, dur) };
    }
    const maxCells = (BASE[ctx.aspect] || BASE['16:9']) * N.lerp(1.3, 0.7, ctx.amounts.density);
    const starts = autoStarts(text, line.lang, dur, maxCells);
    return Object.assign({ from: 'auto' }, withFocus(ctx, line, starts, dur));
  }

  // --- piece times -----------------------------------------------------------------------------------------

  // Boundary times T[0..n]: t0, the inner boundaries (pinned by cut/<key>:t0, else shared by morae between the
  // pinned ones, snapped to the beat grid when timing.snap is on), t1. The inner boundaries lie inside
  // [t0, spanEnd): a line whose pinned end runs past the next line's start shares only the time before that start
  // among its pieces, and its last piece keeps the rest, so the cuts stay in time order (§3.12).
  function pieceTimes(ctx, line, starts, pinKeys, spanEnd) {
    const n = starts.length;
    const T = new Float64Array(n + 1);
    T[0] = line.t0; T[n] = spanEnd;
    const pinned = new Array(n + 1).fill(false);
    pinned[0] = pinned[n] = true;
    let last = line.t0;
    for (let i = 1; i < n; i++) {
      const key = pinKeys[i];
      if (!key) continue;
      const pin = PA.resolvePin(ctx.ix, { pinCutKey: key, lineId: null, cutKey: line.id + '~' + starts[i] }, 't0',
        (v, rank) => (rank !== 'pin:cut' ? { na: true }
          : typeof v === 'number' && v > last && v < spanEnd ? { v } : { bad: true }), ctx.warn);
      if (pin) { T[i] = pin.v; pinned[i] = true; last = pin.v; }
    }
    const w = weightsOf(line.text, starts, line.lang);
    let a = 0;
    for (let b = 1; b <= n; b++) {
      if (!pinned[b]) continue;
      let span = 0;
      for (let k = a; k < b; k++) span += w[k];
      let acc = 0;
      for (let k = a + 1; k < b; k++) {
        acc += w[k - 1];
        T[k] = T[a] + (T[b] - T[a]) * (span > 0 ? acc / span : (k - a) / (b - a));
      }
      a = b;
    }
    snapInner(ctx, T, pinned);
    T[n] = line.t1;
    return T;
  }

  function snapInner(ctx, T, pinned) {
    const g = ctx.grid;
    if (!g || ctx.timing.snap === 'off') return;
    const tol = Math.min(0.12, g.period / 4);
    for (let i = 1; i < T.length - 1; i++) {
      if (pinned[i]) continue;
      const s = g.snap(T[i], ctx.timing.snap, tol);
      if (s > T[i - 1] && s < T[i + 1]) T[i] = s;
    }
  }

  // Pieces shorter than 0.35 s merge into the previous piece (the first one absorbs the next).
  function mergeShort(ctx, line, starts, T) {
    let s = starts.slice(), t = Array.from(T);
    for (let guard = 0; guard < 64 && s.length > 1; guard++) {
      const i = s.findIndex((_, k) => t[k + 1] - t[k] < MIN_PIECE);
      if (i < 0) break;
      const drop = i === 0 ? 1 : i;
      ctx.warn({ code: 'piece-merged', line: line.id, cut: line.id + '~' + s[drop] });
      s.splice(drop, 1);
      t.splice(drop, 1);
    }
    return { starts: s, T: t };
  }

  // --- one line ----------------------------------------------------------------------------------------------

  function attach(ctx, line, starts) {
    const text = line.text;
    const list = starts.map((a, i) => {
      const b = i + 1 < starts.length ? starts[i + 1] : text.length;
      return { key: line.id + '~' + a, a, b, text: pieceText(text, a, b) };
    });
    return PINS.attachCuts(ctx.ix, line.id, list);
  }

  function pieceText(text, a, b) { return text.slice(a, b).replace(/\s+$/u, ''); }

  function fullyEmphasized(text, emph, a, b) {
    let covered = true;
    for (let i = a; i < b && covered; i++) {
      if (/\s/u.test(text[i])) continue;
      covered = emph.some(([x, y]) => i >= x && i < y);
    }
    return covered && b > a;
  }

  function pieceEmph(emph, a, b) {
    const out = [];
    for (const [x, y] of emph) {
      const lo = Math.max(x, a), hi = Math.min(y, b);
      if (hi > lo) out.push([lo - a, hi - a]);
    }
    return out;
  }

  // nextT0 = the next line's start (or null): the end of the time the pieces share (see pieceTimes).
  function cutsOfLine(ctx, line, nextT0) {
    const text = line.text;
    const spanEnd = nextT0 !== null && nextT0 > line.t0 ? Math.min(line.t1, nextT0) : line.t1;
    const pieces = piecesOf(ctx, line, spanEnd);
    let starts = pieces.starts;
    const first = attach(ctx, line, starts);
    const pinKeys = starts.map((a) => first.map[line.id + '~' + a] || null);
    let T = pieceTimes(ctx, line, starts, pinKeys, spanEnd);
    ({ starts, T } = mergeShort(ctx, line, starts, T));
    const att = attach(ctx, line, starts);
    for (const key of att.orphans) reportPins(ctx, 'orphan-pin', key, line.id);
    for (const key of att.shadowed) reportPins(ctx, 'shadowed-pin', key, line.id);
    const cuts = starts.map((a, i) => {
      const b = i + 1 < starts.length ? starts[i + 1] : text.length;
      const key = line.id + '~' + a;
      const focus = a === pieces.focus || fullyEmphasized(text, line.emph || [], a, b);
      return {
        key, line: line.id, role: focus ? 'focus' : 'lyric', text: pieceText(text, a, b),
        emph: pieceEmph(line.emph || [], a, b), impact: !!line.impact && i === starts.length - 1,
        note: i === starts.length - 1 ? line.note || null : null,
        t0: q6(T[i]), t1: q6(T[i + 1]), lang: line.lang, off: [a, b], pinKey: att.map[key] || null,
        heading: line.heading || null, splitFrom: pieces.from,
      };
    });
    checkLock(ctx, line, pieces, starts, att, cuts);
    return cuts;
  }

  function reportPins(ctx, code, pinCutKey, lineId) {
    const slots = ctx.ix.cut.get(pinCutKey);
    if (!slots) return;
    for (const slot of slots.keys()) ctx.warn({ code, path: 'cut/' + pinCutKey + ':' + slot, line: lineId });
  }

  // lock-partial (§3.6, §4.10.3): a locked line whose cuts are no longer the frozen ones, as after an edit the pins
  // could not follow (WP1 note: the planner derives it). The frozen split is gone or does not fit the text (the cuts
  // are made automatically), a frozen piece was too short to keep and was merged, a cut has no pins at all (a new
  // piece), or lock pins lost their piece (orphaned or shadowed; they are also reported as orphan-pin / shadowed-pin).
  // A split the user pinned over the lock is the user's choice, not a loss: the lock pins it leaves without a piece
  // are reported as orphans only. Relocking (lock.set with the lock pins that still have a piece plus lockPayload)
  // ends the warning; lost lock pins kept in the document keep it until they are removed or reattached.
  function checkLock(ctx, line, pieces, starts, att, cuts) {
    if (!ctx.doc.locks || !ctx.doc.locks[line.id]) return;
    const splitPinned = pieces.from === 'pin:line';
    const userSplit = splitPinned && pieces.by !== 'lock';
    const merged = starts.length !== pieces.starts.length;
    const bare = cuts.some((c) => !c.pinKey);
    const lockPinsLost = !userSplit && att.orphans.concat(att.shadowed).some((key) => holdsLockPin(ctx.ix, key));
    if (!splitPinned || merged || bare || lockPinsLost) ctx.warn({ code: 'lock-partial', line: line.id });
  }

  function holdsLockPin(ix, pinCutKey) {
    const slots = ix.cut.get(pinCutKey);
    if (slots) for (const pin of slots.values()) if (pin && pin.by === 'lock') return true;
    return false;
  }

  // --- special cuts ------------------------------------------------------------------------------------------

  function special(key, role, text, note, t0, t1, lang) {
    return { key, line: null, role, text, emph: [], impact: false, note: note || null, t0: q6(t0), t1: q6(t1), lang,
      off: null, pinKey: key, heading: null, splitFrom: null };
  }

  // titleCard slot: work pin, else a title is set and the first line starts ≥ 1.5 s (automatic timing keeps 2 s for
  // the card, planner/plan titleCardTime, so this holds unless a line is anchored earlier). Pinned true with less
  // room: the card is shortened to firstT0 − 0.2 (≥ 0.8 s), else skipped with title-skipped; pinned true without a
  // title ([ti:]) there is nothing to show, so it is skipped with title-skipped too.
  function titleCut(ctx, meta, lines, duration, lang) {
    const pin = PA.resolvePin(ctx.ix, { pinCutKey: null, lineId: null, cutKey: null }, 'titleCard',
      (v) => (typeof v === 'boolean' ? { v } : { bad: true }), ctx.warn);
    const room = lines.length ? lines[0].t0 : duration;
    if (!meta.title) {
      if (pin && pin.v) ctx.warn({ code: 'title-skipped', path: 'work:titleCard' });
      return null;
    }
    if (!pin) return room >= TITLE_ROOM ? special('title', 'title', meta.title, meta.artist, 0, room, lang) : null;
    if (!pin.v) return null;
    if (room >= TITLE_ROOM) return special('title', 'title', meta.title, meta.artist, 0, room, lang);
    if (room - TITLE_GAP >= TITLE_MIN) return special('title', 'title', meta.title, meta.artist, 0, room - TITLE_GAP, lang);
    ctx.warn({ code: 'title-skipped', path: 'work:titleCard' });
    return null;
  }

  // --- windows -----------------------------------------------------------------------------------------------

  // a = t0 − lead; b = next cut's start + tail, or t1 + tail when a special cut (or nothing) follows. A line pinned to
  // end after the next start keeps its text until its own end.
  function windows(cuts, timing) {
    for (let i = 0; i < cuts.length; i++) {
      const c = cuts[i], next = cuts[i + 1];
      c.a = q6(c.t0 - timing.lead);
      const nextSpecial = !next || SPECIAL_ROLES.has(next.role);
      c.b = q6((nextSpecial ? c.t1 : Math.max(c.t1, next.t0)) + timing.tail);
    }
  }

  // cutAll(ctx, lines, meta, duration) → cut skeletons in time order.
  // lines: timed lines ({ …Line, t0, t1 }); ctx = { doc, ix, timing, aspect, amounts, pace, grid, warn, hint }.
  function cutAll(ctx, lines, meta, duration) {
    const cuts = [];
    const titleLang = meta.title ? S.lineScript(meta.title, ctx.hint) : (lines[0] ? lines[0].lang : 'ja');
    const title = titleCut(ctx, meta, lines, duration, titleLang);
    if (title) cuts.push(title);
    else if (lines.length && lines[0].t0 >= INTRO_ROOM) {
      cuts.push(special('intro', 'interlude', '', lines[0].heading, 0, lines[0].t0, lines[0].lang));
    }
    const bars = ctx.grid ? 2 * ctx.grid.meter * ctx.grid.period : 0;
    lines.forEach((line, i) => {
      const own = cutsOfLine(ctx, line, i + 1 < lines.length ? lines[i + 1].t0 : null);
      cuts.push(...own);
      const next = lines[i + 1];
      if (next && next.t0 - line.t1 > Math.max(GAP_MIN, bars)) {
        cuts.push(special('gap/' + line.id, 'interlude', '', next.heading, line.t1, next.t0, next.lang));
      }
    });
    const last = lines[lines.length - 1];
    if (last && duration - last.t1 >= OUTRO_ROOM) {
      cuts.push(special('outro', 'outro', meta.title || '', meta.artist, last.t1, duration, titleLang));
    }
    windows(cuts, ctx.timing);
    return cuts;
  }

  return { cutAll, autoStarts, bestSplit, weightsOf, pieceText, LINE_SPECS, BASE, SPECIAL_ROLES, windows };
});
