/* 文字PVメーカー v2 — original work. Phrases, words, balanced columns and line breaking with kinsoku (DESIGN §4.15.3). */
MV.def('engine/text/breaker', ['core/script'], (S) => {
  'use strict';

  // FROZEN sets (§4.15.3): a line may not start with a NO_START character or end with a NO_END character.
  const NO_START = '、。，．・：；？！‼⁉ー」』）］】〕〉》｝ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ々〻…‥〜～)]},.!?:;';
  const NO_END = '「『（［【〔〈《｛([{';
  const NO_START_SET = new Set(NO_START);
  const NO_END_SET = new Set(NO_END);

  const PARTICLES_1 = new Set([...'はがをにでとへものやかねよなさ']);
  const PARTICLES_2 = new Set(['から', 'まで', 'より']);
  // Before hiragana only these may end a (long) phrase: な か や ね よ さ also begin or sit inside common words (ない,
  // なんて, かった, よう, さよなら), so a break after them split 「言えなかった」; も not before う or っ (もう, もっと).
  const CASE_PARTICLES = new Set([...'はがをにでとへの']);
  const LONG_KANA = new Set([...'はがをにでとへのも']);
  const NOT_AFTER_MO = new Set([...'うっ']);
  // …and the case particles that are never okurigana end a phrase after a kanji or katakana word (名前の|ない).
  const NOUN_PARTICLES = new Set([...'のはをへ']);
  const SENTENCE_END = new Set([...'、。，．！？‼⁉']);
  const LONG_CHUNK = 6;             // a particle may end a phrase before hiragana once the phrase is this long
  const KANA_PREFIX = new Set([...'おご']);
  const NOUN_CHUNK = 3;             // …or after a word of two or more graphemes (not 背の|び or 手の|ひら)
  const ZH_PAIR_ABOVE = 8;          // zh: han are paired when the text has more graphemes than this
  const EPS = 1e-9;

  const KIND_NEUTRAL = 0, KIND_LATIN = 1, KIND_CJK = 2;
  const CJK_CLASSES = new Set(['han', 'hira', 'kata', 'smallKana', 'hangul']);

  // ---- units ----------------------------------------------------------------------------------------------------

  // Grapheme view of a text with the per-grapheme facts every rule below needs.
  function analyze(text) {
    const s = String(text);
    const gs = S.graphemes(s);
    const offs = S.graphemeOffsets(s);
    const n = gs.length;
    const space = new Uint8Array(n), kind = new Uint8Array(n), cls = new Array(n);
    const cells = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const c = S.charClass(gs[i]);
      cls[i] = c;
      space[i] = c === 'space' ? 1 : 0;
      kind[i] = c === 'latin' ? KIND_LATIN : CJK_CLASSES.has(c) ? KIND_CJK : KIND_NEUTRAL;
      cells[i] = S.cells(gs[i]);
    }
    return { text: s, gs, offs, n, space, kind, cls, cells, ...contentLinks(space) };
  }

  // next[i]: first non-space index ≥ i (n when none); prev[i]: last non-space index < i (−1 when none).
  function contentLinks(space) {
    const n = space.length;
    const next = new Int32Array(n + 1), prev = new Int32Array(n + 1);
    next[n] = n;
    for (let i = n - 1; i >= 0; i--) next[i] = space[i] ? next[i + 1] : i;
    prev[0] = -1;
    for (let i = 1; i <= n; i++) prev[i] = space[i - 1] ? prev[i - 1] : i - 1;
    return { next, prev };
  }

  // Content bounds of graphemes [a, b): [first, last + 1], or null when the range holds only spaces.
  function trimmed(u, a, b) {
    const first = u.next[a];
    if (first >= b) return null;
    return [first, u.prev[b] + 1];
  }

  function langOf(text, lang) {
    return lang === 'ja' || lang === 'en' || lang === 'ko' || lang === 'zhHant' || lang === 'zhHans'
      ? lang : S.lineScript(text, 'ja');
  }

  function isZh(lang) { return lang === 'zhHant' || lang === 'zhHans'; }

  // ---- phrases --------------------------------------------------------------------------------------------------

  function endsWithParticle(u, g, chunk) {
    const one = u.gs[g - 1];
    if (PARTICLES_1.has(one) && chunk > 1) return true;
    return g >= 2 && chunk > 2 && PARTICLES_2.has(u.gs[g - 2] + one);
  }

  function isHiragana(u, g) { return u.cls[g] === 'hira' || (u.cls[g] === 'smallKana' && u.gs[g] < '゠'); }

  // A particle ends the phrase before the hiragana at g (endsWithParticle already holds): one of LONG_KANA (or a
  // two-kana particle) once the chunk is long, or の は を へ after a kanji/katakana word; never when the hiragana at g
  // is itself a particle stacked on it (では, のは, でも…: a case particle, or a one-kana particle before non-hiragana).
  function particleBeforeKana(u, g, chunk) {
    const one = u.gs[g - 1], next = u.gs[g];
    if (PARTICLES_1.has(next) && (CASE_PARTICLES.has(next) || g + 1 >= u.n || !isHiragana(u, g + 1))) return false;
    if (g >= 2 && chunk > 2 && PARTICLES_2.has(u.gs[g - 2] + one)) return chunk >= LONG_CHUNK;
    if (chunk >= LONG_CHUNK && LONG_KANA.has(one)) return one !== 'も' || !NOT_AFTER_MO.has(next);
    return chunk >= NOUN_CHUNK && NOUN_PARTICLES.has(one) && (u.cls[g - 2] === 'han' || u.cls[g - 2] === 'kata');
  }

  // Raw phrase starts for Japanese (a start at g = a new phrase begins with grapheme g).
  function startsJa(u) {
    const starts = new Uint8Array(u.n);
    let chunk = 0, lastKind = KIND_NEUTRAL;
    for (let g = 0; g < u.n; g++) {
      if (u.space[g]) { chunk = 0; continue; }
      if (chunk > 0) {
        const particle = endsWithParticle(u, g, chunk) && (!isHiragana(u, g) || particleBeforeKana(u, g, chunk));
        const sentence = SENTENCE_END.has(u.gs[g - 1]);
        const scriptTurn = u.kind[g] !== KIND_NEUTRAL && lastKind !== KIND_NEUTRAL && u.kind[g] !== lastKind;
        if (particle || sentence || scriptTurn || kanjiAfterKana(u, g, chunk) || NO_END_SET.has(u.gs[g])) {
          starts[g] = 1;
          chunk = 0;
        }
      }
      chunk++;
      if (u.kind[g] !== KIND_NEUTRAL) lastKind = u.kind[g];
    }
    return starts;
  }

  // In a long chunk a kanji after hiragana starts the next word (…ってもう|一度…): the kana before it are a word's
  // tail or function words. Not after the prefixes お ご (お|祭り would split a word).
  function kanjiAfterKana(u, g, chunk) {
    return chunk >= LONG_CHUNK && u.cls[g] === 'han' && isHiragana(u, g - 1) && !KANA_PREFIX.has(u.gs[g - 1]);
  }

  // Raw phrase starts for Chinese: every han (paired when the text is long), plus script turns and openers.
  function startsZh(u) {
    const starts = new Uint8Array(u.n);
    let content = 0;
    for (let g = 0; g < u.n; g++) if (!u.space[g]) content++;
    const per = content > ZH_PAIR_ABOVE ? 2 : 1;
    let chunk = 0, han = 0, lastKind = KIND_NEUTRAL;
    for (let g = 0; g < u.n; g++) {
      if (u.space[g]) { chunk = 0; han = 0; continue; }
      const isHan = u.cls[g] === 'han';
      if (chunk > 0) {
        const full = isHan && (han >= per || lastKind !== KIND_CJK);
        const scriptTurn = u.kind[g] !== KIND_NEUTRAL && lastKind !== KIND_NEUTRAL && u.kind[g] !== lastKind;
        if (full || scriptTurn || NO_END_SET.has(u.gs[g])) { starts[g] = 1; chunk = 0; han = 0; }
      }
      chunk++;
      if (isHan) han++;
      if (u.kind[g] !== KIND_NEUTRAL) lastKind = u.kind[g];
    }
    return starts;
  }

  // Moves each start so that no phrase begins with a NO_START character or ends with a NO_END character: closers
  // stay with the phrase before, openers go to the phrase after. A start that would leave the previous phrase holding
  // only openers is dropped, so those openers join the next phrase instead of standing alone.
  function applyKinsoku(u, starts) {
    const out = new Uint8Array(u.n);
    let lastStart = 0;
    for (let g = 1; g < u.n; g++) {
      if (!starts[g]) continue;
      let h = g;
      while (h < u.n && NO_START_SET.has(u.gs[h])) h++;
      while (h > lastStart && NO_END_SET.has(u.gs[h - 1])) h--;
      if (h > lastStart && h < u.n) { out[h] = 1; lastStart = h; }
    }
    return out;
  }

  // Phrase list in grapheme indices: [[first, last + 1]] of content, split at starts and at spaces.
  function phraseUnits(u, lang) {
    const starts = lang === 'ja' ? applyKinsoku(u, startsJa(u)) : isZh(lang) ? applyKinsoku(u, startsZh(u))
      : new Uint8Array(u.n);
    const out = [];
    let from = -1;
    for (let g = 0; g <= u.n; g++) {
      const cut = g === u.n || u.space[g] || starts[g];
      if (cut && from >= 0) { out.push([from, g]); from = -1; }
      if (g < u.n && !u.space[g] && from < 0) from = g;
    }
    return out;
  }

  function toOffsets(u, pairs) { return pairs.map(([a, b]) => [u.offs[a], u.offs[b]]); }

  // phrases(text, lang) → [[a, b]] UTF-16 ranges of content (spaces excluded), in order.
  function phrases(text, lang) {
    const u = analyze(text);
    return toOffsets(u, phraseUnits(u, langOf(u.text, lang)));
  }

  // words(text, lang): the motion 'word' unit — phrases for ja/zh, space-separated for en/ko (same rule here).
  function words(text, lang) { return phrases(text, lang); }

  // ---- break opportunities --------------------------------------------------------------------------------------

  // Grapheme indices where a line may start (0 and n excluded), obeying NO_START/NO_END. `glue[g] = 1` forbids a
  // break just before g (a tate-chu-yoko cell).
  function opportunities(u, lang, mode, glue) {
    if (mode === 'none' || u.n === 0) return [];
    const cand = mode === 'char' ? charStarts(u) : phraseUnits(u, langOf(u.text, lang)).slice(1).map((p) => p[0]);
    const out = [];
    for (const g of cand) {
      const before = u.prev[g];
      if (before < 0 || u.next[g] >= u.n) continue;
      if (glue && glue[g]) continue;
      if (NO_START_SET.has(u.gs[u.next[g]]) || NO_END_SET.has(u.gs[before])) continue;
      out.push(g);
    }
    return out;
  }

  function charStarts(u) {
    const out = [];
    for (let g = 1; g < u.n; g++) if (!u.space[g] && u.prev[g] >= 0) out.push(g);
    return out;
  }

  // ---- width of a range -----------------------------------------------------------------------------------------

  // A width function over grapheme ranges from per-grapheme advances: trimmed sum plus `gap` between content cells.
  function widthFn(u, adv, gap = 0) {
    const pre = new Float64Array(u.n + 1);
    for (let i = 0; i < u.n; i++) pre[i + 1] = pre[i] + adv[i];
    return (a, b) => {
      const t = trimmed(u, a, b);
      if (!t) return 0;
      return pre[t[1]] - pre[t[0]] + gap * (t[1] - t[0] - 1);
    };
  }

  // ---- greedy and balanced breaking -----------------------------------------------------------------------------

  // Fewest lines of width ≤ cap (first fit). A piece wider than cap on its own becomes an overlong line.
  function greedy(u, opps, width, cap) {
    if (u.next[0] >= u.n) return [];
    const ends = opps.concat([u.n]);
    const lines = [];
    let start = 0, k = 0;
    while (start < u.n && k < ends.length) {
      let best = -1;
      for (let j = k; j < ends.length; j++) {
        if (width(start, ends[j]) <= cap + EPS) best = j;
        else break;
      }
      if (best < 0) best = k;
      lines.push([start, ends[best]]);
      start = ends[best];
      k = best + 1;
    }
    return lines;
  }

  // Exactly min(count, opps + 1) lines minimising the widest line, then the sum of squared widths (earliest break wins
  // ties). Returns [[a, b]] grapheme ranges that cover [0, n).
  function balance(u, opps, width, count) {
    if (u.next[0] >= u.n) return [];
    const pos = [0].concat(opps, [u.n]);
    const m = pos.length - 1;
    const k = Math.max(1, Math.min(count, m));
    let best = new Array(m + 1).fill(null);
    best[0] = { max: 0, sq: 0, from: -1, prev: null };
    for (let line = 1; line <= k; line++) {
      const next = new Array(m + 1).fill(null);
      for (let e = line; e <= m; e++) {
        if (line === k && e !== m) continue;
        for (let s = line - 1; s < e; s++) {
          const base = best[s];
          if (!base) continue;
          const w = width(pos[s], pos[e]);
          const cand = { max: Math.max(base.max, w), sq: base.sq + w * w, from: s, prev: base };
          if (!next[e] || better(cand, next[e])) next[e] = cand;
        }
      }
      best = next;
    }
    const cuts = [];
    for (let node = best[m], e = m; node && node.from >= 0; e = node.from, node = node.prev) cuts.push([pos[node.from], pos[e]]);
    return cuts.reverse();
  }

  function better(a, b) {
    if (a.max < b.max - EPS) return true;
    if (a.max > b.max + EPS) return false;
    return a.sq < b.sq - EPS;
  }

  // Grapheme ranges → trimmed UTF-16 ranges (lines of only spaces are dropped).
  function trimmedOffsets(u, pairs) {
    const out = [];
    for (const [a, b] of pairs) {
      const t = trimmed(u, a, b);
      if (t) out.push([u.offs[t[0]], u.offs[t[1]]]);
    }
    return out;
  }

  // ---- public splitters -----------------------------------------------------------------------------------------

  // columns(text, n, lang): n pieces of balanced cell width at phrase boundaries (fewer when there are fewer phrases).
  function columns(text, n, lang) {
    const u = analyze(text);
    const count = Math.max(1, Math.floor(Number(n) || 1));
    const opps = opportunities(u, lang, 'phrase');
    return trimmedOffsets(u, balance(u, opps, widthFn(u, u.cells), count));
  }

  // breakLines(text, maxCells, lang, mode): first-fit lines of at most maxCells cells ('phrase' | 'char' | 'none').
  function breakLines(text, maxCells, lang, mode = 'phrase') {
    const u = analyze(text);
    const opps = opportunities(u, lang, mode);
    return trimmedOffsets(u, greedy(u, opps, widthFn(u, u.cells), Number(maxCells) || 0));
  }

  return {
    NO_START, NO_END, phrases, words, columns, breakLines,
    analyze, trimmed, opportunities, widthFn, greedy, balance, phraseUnits, langOf,
  };
});
