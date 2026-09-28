/* 文字PVメーカー v2 — original work. 歌ハメ: per-character sung timing of a line and the 歌ハメ switch (DESIGN_2_2 §6). */
MV.def('planner/sung', ['core/script', 'core/num', 'core/motion', 'engine/text/vert', 'planner/params', 'planner/rules'],
(S, N, MO, V, PA, RU) => {
  'use strict';

  // Constants (DESIGN_2_2 §6.4). The Phase C entries (voice end, snapping) stay off until a lab gate enables them.
  const C = Object.freeze({
    EST_SLACK: 1.1,        // estimated singing = morae / rate × 1.1
    RATE_MIN: 2, RATE_MAX: 16,   // a line's own measured rate (morae / s) is clamped to this range
    UNIT_MIN: 0.05,        // the sung end is at least 0.05 s per unit after the last anchored unit
    ANCHOR_GAP: 0.02,      // a word anchor closer than this to the one before is dropped (pins are refused instead)
    MIN_PIECE: 0.35, PIECE_EPS: 1e-6,   // = planner/segment MIN_PIECE: sung-derived piece boundaries keep every piece ≥ it
    HOOK_EVERY: 3,         // a chorus run's lines at positions 0, 3, 6, … are hook lines
    HAME_DUR_MIN: 0.06, HAME_DUR_MAX: 0.25,
    LETTER_STEP: 0.06, LETTER_SHARE: 0.8,
    PIN_MAX: 400, DT_MAX: 600, DT_GAP: 0.01,
    // Phase C (off until the lab gate passes):
    VOICE_END: false, SNAP_GAIN: 0, VOICE_UI: false,
  });

  // The entrances that read well one character at a time (歌ハメ restricts the arrive pool to them); English lines may
  // also take the word-at-a-time pop and stamp. Layouts that move the text themselves (def.motion === 'own') are left
  // out of a 歌ハメ cut's arrange pool.
  const HAME_ARRIVE = Object.freeze(['typeOn', 'sliceReveal', 'inkRise', 'bloomOpen', 'zoomSettle', 'dropSnap',
    'riseFromFlat', 'pixelStep']);
  const HAME_ARRIVE_LATIN = Object.freeze(HAME_ARRIVE.concat(['wordPop', 'stampPress']));
  const OPENERS = new Set(['「', '『', '（', '(', '“', '‘', '〈', '《', '【', '〔', '［', '[', '｛', '{', '"', "'"]);
  const SRC = Object.freeze({ est: 0, voice: 1, copy: 2, lrc: 3, pin: 4 });
  const SRC_NAMES = Object.freeze(['est', 'voice', 'copy', 'lrc', 'pin']);

  const q3 = (x) => Math.round(x * 1000) / 1000;
  const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

  // The document's generation (look.gen, DESIGN_2_2 §0).
  function gen(doc) { return RU.gen(doc); }

  // A decision pfrom value set by a named rule ('rule:sung'); plain 'rule' (motion speed, P3) is not a tag.
  function isRuleTag(x) { return typeof x === 'string' && x.startsWith('rule:'); }
  function isRuleFrom(x) { return x === 'rule' || isRuleTag(x); }

  // --- (a) sung units -----------------------------------------------------------------------------------------

  // Two-generation memo, like planner/segment's.
  let memoPrev = new Map(), memoCur = new Map();
  function memo(key, make) {
    let v = memoCur.get(key);
    if (v === undefined) {
      v = memoPrev.get(key);
      if (v === undefined) v = make();
      if (memoCur.size >= 2000) { memoPrev = memoCur; memoCur = new Map(); }
      memoCur.set(key, v);
    }
    return v;
  }

  function isLetter(c) { return c === 'latin' || c === 'fullLatin'; }
  function isWordJoiner(g) { return g === '\'' || g === '’' || g === '-'; }

  // unitsOf(text, lang) → { at: Int32Array (unit start offsets, at[0] = 0), w: Float64Array (weights, morae ≥ 0.5),
  // latin: Uint8Array (the unit is a Latin word), n }: what is sung as one beat and appears as one step. A Latin word is
  // one unit (' ’ - inside it continue it); a run of ≤ MAX_TCY_DIGITS digits is one unit (one tate-chu-yoko cell), a
  // longer run one unit per digit; an opening bracket or quote joins the unit after it; a grapheme with morae, or a han,
  // starts a unit; anything else (small kana ゃ…, closing punctuation, spaces, symbols, emoji) joins the unit before it
  // (before the first unit: the first). A text without any unit is one unit.
  function unitsOf(text, lang) {
    const t = String(text);
    return memo(lang + '|' + t, () => makeUnits(t, lang));
  }

  function makeUnits(text, lang) {
    const offs = S.graphemeOffsets(text);
    const n = offs.length - 1;
    const gs = new Array(n), cls = new Array(n);
    for (let k = 0; k < n; k++) { gs[k] = text.slice(offs[k], offs[k + 1]); cls[k] = S.charClass(gs[k]); }
    const starts = [], latin = [];
    let inWord = false, open = -1;
    const start = (k, word) => { starts.push(open >= 0 ? open : k); latin.push(word ? 1 : 0); open = -1; };
    for (let k = 0; k < n; k++) {
      const g = gs[k], c = cls[k];
      if (isLetter(c)) {
        if (!inWord) start(k, true);
        inWord = true;
        continue;
      }
      if (inWord && isWordJoiner(g) && k + 1 < n && isLetter(cls[k + 1])) continue;
      inWord = false;
      if (c === 'digit') {
        let e = k;
        while (e < n && cls[e] === 'digit') e++;
        if (e - k <= V.MAX_TCY_DIGITS) start(k, false);
        else for (let q = k; q < e; q++) start(q, false);
        k = e - 1;
        continue;
      }
      if (OPENERS.has(g)) { if (open < 0) open = k; continue; }
      // a quote or bracket followed by a space was closing something: it stays with the unit before
      if (c === 'space') { open = -1; continue; }
      if (c === 'han' || S.morae(g, lang) > 0) start(k, false);
    }
    if (!starts.length && n > 0) { starts.push(0); latin.push(0); }
    const m = starts.length;
    const at = new Int32Array(m), w = new Float64Array(m), lat = Uint8Array.from(latin);
    for (let u = 0; u < m; u++) at[u] = offs[starts[u]];
    if (m) at[0] = 0;
    for (let u = 0; u < m; u++) w[u] = Math.max(0.5, S.morae(text.slice(at[u], u + 1 < m ? at[u + 1] : text.length), lang));
    return Object.freeze({ at, w, latin: lat, n: m, text });
  }

  // Graphemes that join the unit before them when a time is set at their offset (whitespace, closing punctuation):
  // a time there belongs to the unit after them.
  function joinsBack(g) {
    const c = S.charClass(g);
    return c === 'space' || ((c === 'punctJa' || c === 'punctLatin') && !OPENERS.has(g));
  }

  // unitAt(units, off) → the unit u with at[u] ≤ off < at[u + 1]; when the grapheme at off joins backward (a space or
  // closing punctuation inside unit u) and u + 1 exists, u + 1.
  function unitAt(units, off) {
    const at = units.at;
    let lo = 0, hi = at.length - 1;
    if (hi < 0) return -1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (at[mid] <= off) lo = mid; else hi = mid - 1;
    }
    if (at[lo] !== off && lo + 1 < at.length) {
      const text = units.text;
      const cp = text.codePointAt(off);
      if (cp !== undefined && joinsBack(String.fromCodePoint(cp))) return lo + 1;
    }
    return lo;
  }

  // --- the sung.times pin ---------------------------------------------------------------------------------------

  // acceptSungTimes(text) → accept(v, rank) for `line/<id>:sung.times` (line pins only): 1–400 pairs [off, dt]; off an
  // integer grapheme start of the text, or the text's length (where the singing ends; the last pair only); offsets
  // strictly increasing; dt finite, 0 ≤ dt ≤ 600 and each ≥ the one before + 0.01.
  function acceptSungTimes(text) {
    const t = String(text);
    const offs = S.graphemeOffsets(t);
    const starts = new Set(offs);
    return (v, rank) => {
      if (rank !== 'pin:line') return { na: true };
      if (!Array.isArray(v) || v.length < 1 || v.length > C.PIN_MAX) return { bad: true };
      const out = [];
      for (let i = 0; i < v.length; i++) {
        const x = v[i];
        if (!Array.isArray(x) || x.length !== 2) return { bad: true };
        const [off, dt] = x;
        if (!Number.isInteger(off) || off < 0 || off > t.length || !starts.has(off)) return { bad: true };
        if (off === t.length && i !== v.length - 1) return { bad: true };
        if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0 || dt > C.DT_MAX) return { bad: true };
        if (i > 0 && (off <= out[i - 1][0] || dt < out[i - 1][1] + C.DT_GAP - 1e-9)) return { bad: true };
        out.push([off, dt]);
      }
      return { v: out };
    };
  }

  // --- (b) anchors ----------------------------------------------------------------------------------------------

  // A line's own anchors: [{ u, dt, src }] in unit order and endRel (seconds after the line's start, or undefined), from
  // its validated pin, else (sourcesOK) its word tags. Anchors later than the line's span are not used; a word before
  // the start, after the span or closer than ANCHOR_GAP to the one kept before it is dropped (counted). The first anchor
  // on a unit wins.
  function ownAnchors(units, pinV, line, span, sourcesOK) {
    const list = [];
    let endRel, dropped = 0;
    const taken = new Set();
    if (pinV) {
      const len = units.text.length;
      for (const [off, dt] of pinV) {
        if (dt > span + 1e-9) continue;
        if (off === len) { endRel = dt; continue; }
        const u = unitAt(units, off);
        if (u < 0 || taken.has(u)) continue;
        taken.add(u);
        list.push({ u, dt, src: SRC.pin });
      }
      return { list, endRel, dropped };
    }
    if (!sourcesOK || !Array.isArray(line.words) || !line.words.length) return { list, endRel, dropped };
    const ref = typeof line.wordsRef === 'number' ? line.wordsRef : line.words[0][1];
    const len = units.text.length;
    let prev = null;
    for (const [off, t] of line.words) {
      const dt = q3(t - ref);
      const u = off >= len ? -1 : unitAt(units, off);
      // the time before the first anchor: the line's start (unit 0), which a later unit must also clear
      const floor = prev !== null ? prev : u === 0 ? -Infinity : 0;
      if (dt < 0 || dt > span + 1e-9 || dt < floor + C.ANCHOR_GAP - 1e-9) { dropped++; continue; }
      if (off >= len) { endRel = dt; prev = dt; continue; }
      if (u < 0 || taken.has(u) || endRel !== undefined) continue;
      taken.add(u);
      list.push({ u, dt, src: SRC.lrc });
      prev = dt;
    }
    return { list, endRel, dropped };
  }

  // --- (c) filling a line ---------------------------------------------------------------------------------------

  // fillLine({ units, anchors, endRel, span, rate, sourcesOK, anchoredStart }) → LineTiming (relative to the line's
  // start; frozen): { at, t, end, src, by, explicit, anchored, sourcesOK }. Unit 0 starts with the line unless anchored.
  // The sung end: the end anchor, else (with ≥ 2 anchors or the sources on) the last anchor plus the rest of the line's
  // morae at its own measured rate (≥ 2 anchors) or the reading rate, × EST_SLACK, else the span (the v2 window, for a
  // line timed only for the colour fill); at least UNIT_MIN per unit after the last anchor, never past the span.
  // Unanchored units are interpolated by weight between their anchored neighbours (the end counts as one at unit n).
  function fillLine(o) {
    const units = o.units, n = units.n, w = units.w;
    const T = new Float64Array(n + 1).fill(NaN);
    const src = new Uint8Array(n);
    let first = -1, last = 0;
    for (const a of o.anchors) {
      T[a.u] = a.dt;
      src[a.u] = a.src;
      if (first < 0) first = a.u;
      if (a.u > last) last = a.u;
    }
    if (Number.isNaN(T[0])) T[0] = 0;
    const count = o.anchors.length;
    let rateLine = o.rate;
    if (count >= 2 && T[last] > T[first]) {
      let sw = 0;
      for (let u = first; u < last; u++) sw += w[u];
      rateLine = clamp(sw / (T[last] - T[first]), C.RATE_MIN, C.RATE_MAX);
    }
    const span = Math.max(0, o.span);
    let E = o.endRel;
    if (E === undefined) {
      if (count >= 2 || o.sourcesOK) {
        let rest = 0;
        for (let u = last; u < n; u++) rest += w[u];
        E = T[last] + (rest / rateLine) * C.EST_SLACK;
      } else E = span;
    }
    E = Math.max(Math.min(E, span), Math.min(T[last] + C.UNIT_MIN * (n - last), span), T[last]);
    T[n] = E;
    // interpolation between fixed units (0, the anchors, n)
    let i = 0;
    for (let j = 1; j <= n; j++) {
      if (j < n && Number.isNaN(T[j])) continue;
      if (j - i > 1) {
        let tot = 0;
        for (let k = i; k < j; k++) tot += w[k];
        let acc = 0;
        for (let u = i + 1; u < j; u++) {
          acc += w[u - 1];
          T[u] = T[i] + (T[j] - T[i]) * (tot > 0 ? acc / tot : (u - i) / (j - i));
        }
      }
      i = j;
    }
    const t = new Float64Array(n);
    for (let u = 0; u < n; u++) t[u] = q3(T[u]);
    let best = 0;
    for (let u = 0; u < n; u++) if (src[u] > best) best = src[u];
    return Object.freeze({
      at: units.at, t, end: q3(E), src, by: SRC_NAMES[best], explicit: o.anchors.some((a) => a.src >= SRC.copy),
      anchored: count, sourcesOK: !!o.sourcesOK, n, units,
    });
  }

  // The sung time (relative to the line's start) of the unit containing text offset `off`.
  function timeOf(ls, off) {
    const u = unitAt(ls.units, off);
    return u < 0 ? 0 : ls.t[u];
  }

  // Line timings, reused across plans for equal inputs (an unchanged line returns the same frozen object).
  let fillPrev = new Map(), fillCur = new Map();
  function filled(key, make) {
    let v = fillCur.get(key);
    if (v === undefined) {
      v = fillPrev.get(key);
      if (v === undefined) v = make();
      if (fillCur.size >= 4000) { fillPrev = fillCur; fillCur = new Map(); }
      fillCur.set(key, v);
    }
    return v;
  }

  // --- (d) prepare: plan stage 1b, after the lines are timed, before the cutter ---------------------------------

  const LINE_AT = (lineId) => ({ cutKey: null, pinCutKey: null, lineId });
  function acceptBool(v) { return typeof v === 'boolean' ? { v } : { bad: true }; }

  // prepare(ctx, timed) → SungContext | null. null (the v2 plan, exactly) unless 「字の時間を歌に合わせる」 resolves on
  // or a sung.times / sung.hame pin exists. ctx = { doc, ix, warn, timing, readRate }. Every timed line gets a timing
  // when it has a sung.times pin, or 「字の時間を歌に合わせる」 is on, or its 歌ハメ pin resolves on; the others get null.
  function prepare(ctx, timed) {
    const { doc, ix } = ctx;
    const real = RU.value(doc, ix, 'sung.real') === true;
    const pinnedTimes = PA.pinned(ix, 'sung.times'), pinnedHame = PA.pinned(ix, 'sung.hame');
    if (!real && !pinnedTimes && !pinnedHame) return null;
    const g = gen(doc);
    const rate = typeof ctx.readRate === 'number' && ctx.readRate > 0 ? ctx.readRate : 7;
    const n = timed.length;
    const own = new Array(n);
    for (let i = 0; i < n; i++) {
      const line = timed[i], next = timed[i + 1];
      const spanEnd = next && next.t0 > line.t0 ? Math.min(line.t1, next.t0) : line.t1;
      const at = LINE_AT(line.id);
      const hp = pinnedHame ? PA.resolvePin(ix, at, 'sung.hame', acceptBool, ctx.warn) : null;
      const linePin = hp && hp.from === 'pin:line' ? hp : null, workPin = hp && hp.from === 'pin:work' ? hp : null;
      const kime = !!line.kime;
      const hamePinOn = linePin ? linePin.v : kime ? false : workPin ? workPin.v : null;
      const pin = pinnedTimes ? PA.resolvePin(ix, at, 'sung.times', acceptSungTimes(line.text), ctx.warn) : null;
      const sourcesOK = real || hamePinOn === true;
      const need = !!pin || real || hamePinOn === true;
      const units = unitsOf(line.text, line.lang);
      const span = Math.max(0, spanEnd - line.t0);
      const anchors = need ? ownAnchors(units, pin ? pin.v : null, line, span, sourcesOK) : null;
      if (anchors && anchors.dropped > 0) ctx.warn({ code: 'sung-words', line: line.id, detail: { n: anchors.dropped } });
      own[i] = {
        line, need, units, span, sourcesOK, pin, anchors, kime, hamePinOn,
        hameFrom: linePin ? 'pin:line' : kime ? 'kime' : workPin ? 'pin:work' : 'auto',
        best: anchors && anchors.list.length ? Math.max(...anchors.list.map((a) => a.src)) : 0,
      };
    }
    // group sources: per lyric text, the occurrence with the best own explicit anchors (pin > word tags; ties: earliest)
    const source = new Map();
    for (let i = 0; i < n; i++) {
      const o = own[i];
      if (!o.need || o.best < SRC.lrc) continue;
      const cur = source.get(o.line.text);
      if (!cur || o.best > cur.best) source.set(o.line.text, o);
    }
    const lines = new Map(), meta = new Map();
    const timingOf = (o, anchors, endRel, copyKey) => filled(JSON.stringify([o.line.text, o.line.lang, N.q6(o.span),
      anchors.map((a) => [a.u, a.dt, a.src]), endRel === undefined ? null : endRel, o.sourcesOK, rate,
      o.line.by && o.line.by.start !== 'auto', copyKey]), () => fillLine({ units: o.units, anchors, endRel, span: o.span,
      rate, sourcesOK: o.sourcesOK, anchoredStart: !!(o.line.by && o.line.by.start !== 'auto') }));
    // sources first (their sung end scales the copies)
    const done = new Map();
    for (const src of source.values()) done.set(src, timingOf(src, src.anchors.list, src.anchors.endRel, null));
    for (let i = 0; i < n; i++) {
      const o = own[i];
      const line = o.line;
      if (!o.need) { lines.set(line.id, null); continue; }
      let ls = done.get(o);
      if (!ls) {
        const src = o.sourcesOK && !o.anchors.list.length ? source.get(line.text) : null;
        if (src && src !== o) {
          const srcLs = done.get(src);
          const k = srcLs.end > 0 ? Math.min(1, o.span / srcLs.end) : 1;
          const anchors = src.anchors.list.map((a) => ({ u: a.u, dt: q3(a.dt * k), src: SRC.copy }));
          const endRel = src.anchors.endRel === undefined ? undefined : q3(src.anchors.endRel * k);
          ls = timingOf(o, anchors, endRel, src.line.id + ':' + k);
        } else ls = timingOf(o, o.anchors.list, o.anchors.endRel, null);
      }
      lines.set(line.id, ls);
      meta.set(line.id, { hamePinOn: o.hamePinOn, kime: o.kime, hameFrom: o.hameFrom,
        pinBy: o.pin && ls.by === 'pin' ? o.pin.by || null : null, dropped: o.anchors.dropped });
    }
    const hame = new Map();
    const lead = ctx.timing ? ctx.timing.lead : 0.12;
    return {
      lines, meta, real, gen: g, hame, lead,
      // → null, or { latin } for a lyric or focus cut of a 歌ハメ line (planner/cast; P4's モーフ rule reads it too)
      hameAt(cut) {
        if (!cut || !cut.line || (cut.role !== 'lyric' && cut.role !== 'focus')) return null;
        const h = hame.get(cut.line);
        return h && h.hame ? (cut.lang === 'en' ? HAME_LATIN : HAME_PLAIN) : null;
      },
      // what 歌ハメ adds to a cut's cast inputs ('' without it): the pool and the dur rule, which reads the lead
      idOf(cut) {
        const h = this.hameAt(cut);
        return h ? 'h' + (h.latin ? 'l' : '') + ':' + lead : '';
      },
    };
  }
  const HAME_PLAIN = Object.freeze({ latin: false }), HAME_LATIN = Object.freeze({ latin: true });

  // --- (d2) decideHame: plan stage 4b, after the features (and P2's ctx.pv), before casting ----------------------

  // The song's hook lines (歌い出し and the chorus lines at run positions 0, 3, 6, …), decided per lyric text so every
  // occurrence of a lyric gets the same answer; then each line's 歌ハメ: its pin, else off on a キメ line, else the work
  // pin, else 自動 (a new work: on for lines with explicit character times — tier E — and, with the sources on, for
  // hook lines — tier H). Parts: P2's (ctx.pv.partOf) when present, else runs of the real section kind of the cuts.
  function decideHame(ctx, cuts, timed) {
    const sung = ctx.sung;
    if (!sung) return;
    const hooks = new Set();
    if (sung.real && sung.gen >= 1) {
      const firstCut = new Map();
      for (const c of cuts) {
        if (!c.line || (c.role !== 'lyric' && c.role !== 'focus') || firstCut.has(c.line)) continue;
        firstCut.set(c.line, c);
      }
      const lyricLines = timed.filter((l) => firstCut.has(l.id));
      if (lyricLines.length) hooks.add(lyricLines[0].text);
      let prevRun = null, pos = 0;
      for (const l of lyricLines) {
        const c = firstCut.get(l.id);
        const part = partOf(ctx, c);
        const run = part.kind === 'chorus' ? part.run : null;
        if (run === null) { prevRun = null; continue; }
        pos = run === prevRun ? pos + 1 : 0;
        prevRun = run;
        if (pos % C.HOOK_EVERY === 0) hooks.add(l.text);
      }
    }
    for (const line of timed) {
      const ls = sung.lines.get(line.id);
      if (!ls) continue;
      const m = sung.meta.get(line.id);
      const tierE = ls.explicit;
      const tierH = sung.real && hooks.has(line.text);
      const auto = sung.gen >= 1 && !m.kime && (tierE || tierH);
      const hame = m.hamePinOn !== null ? m.hamePinOn : auto;
      const why = m.hameFrom !== 'auto' ? m.hameFrom : tierE && auto ? 'times' : tierH && auto ? 'hook' : 'off';
      sung.hame.set(line.id, { hame, why });
    }
    sung.hooks = hooks;
  }

  // A cut's song part: P2's (kind and run) when its conventions are on, else the real section of its features (a run
  // is a stretch of lines of one kind).
  function partOf(ctx, c) {
    if (ctx.pv && typeof ctx.pv.partOf === 'function') {
      const p = ctx.pv.partOf(c);
      return p ? { kind: p.kind || null, run: p.run !== undefined ? p.run : p.key } : { kind: null, run: null };
    }
    const kind = c.feat ? c.feat.section || null : null;
    return { kind, run: kind };
  }

  // --- (e) the cut's share ------------------------------------------------------------------------------------

  // sliceCut(ls, a, b, cutT0, cutT1, lineT0) → cut.sung { at, end, t } | null: the units starting inside the piece
  // [a, b) of the line text, at = offsets in the cut's text, t = seconds after the cut's t0 (≥ 0), end = where the cut's
  // singing ends (≤ its t1, after its last unit).
  function sliceCut(ls, a, b, cutT0, cutT1, lineT0) {
    if (!ls) return null;
    const at = [], t = [];
    for (let k = 0; k < ls.n; k++) {
      const off = ls.at[k];
      if (off < a || off >= b) continue;
      at.push(off - a);
      t.push(Math.max(0, q3(lineT0 + ls.t[k] - cutT0)));
    }
    if (!at.length) return null;
    const last = t[t.length - 1];
    const end = Math.max(q3(Math.min(lineT0 + ls.end, cutT1) - cutT0), q3(last + 0.02));
    return Object.freeze({ at: Object.freeze(at), end, t: Object.freeze(t) });
  }

  // --- the Plan's views -----------------------------------------------------------------------------------------

  // Whether a cast cut's entrance follows the singing (its order is 'sung').
  function isSungCut(cut) {
    const d = cut && cut.slots ? cut.slots.arrive : null;
    return !!(d && d.p && d.p.order === 'sung');
  }

  // repT of a cut whose entrance follows sung times (DESIGN_2_2 §6.4 g): the last character lands on its sung time
  // (or after its dur), then 10 % of the calm stretch before the exit, clamped to [a, b) like core/motion heroTime.
  // arrive / depart = { dur, each } (null = instant); count = number of stagger units.
  function heroSung(c, arrive, depart, count) {
    const a = c.a, b = c.b, window = b - a;
    const t = c.sung.t;
    const dur = arrive ? Math.max(0, arrive.dur) : 0;
    const A = Math.min(window, Math.max(dur, c.t0 + t[t.length - 1] - a));
    const L = MO.fitMotion({ dur: depart ? depart.dur : 0, each: depart ? depart.each : 0, count, window,
      share: MO.SHARE.depart }).total;
    const x = a + A + 0.1 * Math.max(0, (b - L) - (a + A));
    if (!(b > a)) return a;
    if (x < a) return a;
    if (x < b) return x;
    const below = b - Math.max(Math.abs(b), 1) * Number.EPSILON;
    return below >= a ? below : a;
  }

  // plan.sung (non-enumerable): Map<lineId, LineSung> for the inspector and the timeline, times absolute.
  function summary(ctx, timed) {
    const sung = ctx.sung;
    if (!sung) return null;
    const out = new Map();
    for (const line of timed) {
      const ls = sung.lines.get(line.id);
      if (!ls) continue;
      const m = sung.meta.get(line.id), h = sung.hame.get(line.id) || { hame: false, why: 'off' };
      const t = new Float64Array(ls.n);
      for (let u = 0; u < ls.n; u++) t[u] = N.q6(line.t0 + ls.t[u]);
      out.set(line.id, Object.freeze({
        at: ls.at, t, end: N.q6(line.t0 + ls.end), src: ls.src, by: ls.by, pinBy: m.pinBy, explicit: ls.explicit,
        hame: h.hame, hameWhy: h.why, fill: false, dropped: m.dropped,
      }));
    }
    return out;
  }

  return {
    C, HAME_ARRIVE, HAME_ARRIVE_LATIN, OPENERS, SRC, SRC_NAMES, gen, isRuleTag, isRuleFrom, unitsOf, unitAt, acceptSungTimes,
    ownAnchors, fillLine, timeOf, prepare, decideHame, sliceCut, isSungCut, heroSung, summary,
  };
});
