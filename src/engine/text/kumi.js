/* 文字PVメーカー v2 — original work. 文字組み (typesetting) of a text run: kana set closer, particles and Latin words sized apart from the Japanese around them (DESIGN_2_2 §1). */
MV.def('engine/text/kumi', ['core/script', 'engine/text/breaker'], (S, B) => {
  'use strict';

  // RunSpec.kumi = { kana, jump, head, latin } (DESIGN_2_2 §1): three strengths 0–1, where 0 is off, and which
  // graphemes grow ('line' | 'phrase' | 'none'). Metric-free: every number below is in em of the run's size and comes
  // from tables and the breaker's grapheme view (`u`, breaker.analyze); engine/text/layout applies the result.
  const HEADS = Object.freeze(['line', 'phrase', 'none']);
  const MEMO_MAX = 512;              // entries per memo below; a full memo is cleared (pure caches: results never change)

  // RunLayout.kumi: one role per grapheme.
  const ROLE = Object.freeze({ plain: 0, particle: 1, head: 2, latin: 3 });

  // ---- T1 かなを詰める: kana cells narrower than 1 em ------------------------------------------------------------

  // Trim per tier in em at strength 1: the tightest cell the ink allows in gothic and mincho faces (common kana ink
  // ≤ 0.86 em, the widest and the voiced kana ≤ 0.92, small kana ≈ 0.6, く し り 0.45–0.6). tests/browser/glyph_parity
  // measures the ink against these cells.
  const TRIM = Object.freeze({ wide: 0.10, kana: 0.14, narrow: 0.30, small: 0.34, bar: 0.08 });
  const WIDE_KANA = 'あおすせなぬねのはひふへほまみむめやゆわゐゑを';     // …and every voiced kana (が ぱ ヴ)
  const NARROW_KANA = 'くぐしじりノトドリ';                               // narrow wins over voiced (ぐ じ ド)
  // Heavy and brush faces carry more ink per cell: their trim is damped, and again for a layout weight ≥ 800.
  const FLAVOR_DAMP = Object.freeze({ heavy: 0.6, brush: 0.8 });
  const HEAVY_WEIGHT = 800;
  const WEIGHT_DAMP = 0.8;
  // Where two words meet (a phrase start, or right after a particle), both kana at the seam keep this share of their
  // trim, so the seam stays a little wider than the inside of a word and the words read as blocks.
  const BOUNDARY = 0.5;

  const WIDE_SET = new Set(WIDE_KANA);
  const NARROW_SET = new Set(NARROW_KANA);
  // The voiced kana of U+3041–U+30FF (a base plus ゛ or ゜ under NFD); other graphemes are decomposed when asked.
  const VOICED = new Set();
  for (let cp = 0x3041; cp <= 0x30ff; cp++) {
    const ch = String.fromCodePoint(cp);
    if (ch.normalize('NFD').length > 1) VOICED.add(ch);
  }
  function voiced(g) { return g.length === 1 ? VOICED.has(g) : g.normalize('NFD').length > 1; }

  // tier(u, i) → 'wide' | 'kana' | 'narrow' | 'small' | 'bar' | null: the trim class of grapheme i. Only full-width
  // hiragana, katakana, small kana and ー have one; kanji, Latin, digits, punctuation, halfwidth kana, ・ and 々 do not.
  function tier(u, i) {
    const g = u.gs[i], c = u.cls[i];
    if (g === 'ー') return 'bar';
    if (u.cells[i] !== 1) return null;
    if (c === 'smallKana') return 'small';
    if (c !== 'hira' && c !== 'kata') return null;
    if (NARROW_SET.has(g)) return 'narrow';
    return WIDE_SET.has(g) || voiced(g) ? 'wide' : 'kana';
  }

  // The damp of a run's script face (a FontRef: flavor, weight).
  function faceDamp(face) {
    if (!face) return 1;
    const f = Object.prototype.hasOwnProperty.call(FLAVOR_DAMP, face.flavor) ? FLAVOR_DAMP[face.flavor] : 1;
    return f * (Number(face.weight) >= HEAVY_WEIGHT ? WEIGHT_DAMP : 1);
  }

  // ---- T2 助詞を小さく・頭の字を大きく ---------------------------------------------------------------------------

  // Size factors at strength j: particles 1 − small × j, heads 1 + big × j (0.82 / 1.20 at 0.5; 0.64 / 1.40 at 1).
  const JUMP = Object.freeze({ small: 0.36, big: 0.40 });
  // Opening brackets and quotes before a cut's first character: skipped when looking for the line head (「始まり」 → 始).
  const OPENERS = '「『（【〔〈《"\'(［｛“‘';
  // A cut with fewer content (non-space) graphemes gets no head: a two-character cut has nothing to lead.
  const MIN_HEAD_CONTENT = 3;
  const OPENER_SET = new Set(OPENERS);

  // A line head: the first character where the eye enters the line, whatever its script (kanji, katakana, hiragana),
  // one cell wide, not ー, not small kana and not a particle.
  function lineHeadable(u, i, part) {
    const c = u.cls[i];
    return (c === 'han' || c === 'kata' || c === 'hira') && u.cells[i] === 1 && u.gs[i] !== 'ー' && !part[i];
  }
  // A phrase head inside the line: kanji or katakana only (a hiragana phrase start is mostly a verb tail or a function
  // word such as ない or して, and enlarging it reads as a mistake).
  function phraseHeadable(u, i, part) {
    const c = u.cls[i];
    return (c === 'han' || c === 'kata') && u.cells[i] === 1 && u.gs[i] !== 'ー' && !part[i];
  }

  // ---- T3 英字を少し大きく・和文との間をあける -------------------------------------------------------------------

  // Growth of a Latin word at strength 1, by the run's Latin family (faces with a small x-height grow more); and the
  // space in em added between the word and the CJK next to it.
  const LATIN_GROW = Object.freeze({ default: 0.20, 'Caveat': 0.30, 'Cormorant Garamond': 0.28 });
  const LATIN_GAP = 0.30;
  const CJK = new Set(['han', 'hira', 'kata', 'smallKana', 'hangul']);

  function latinGrow(ref) {
    const fam = ref && ref.family;
    return typeof fam === 'string' && fam !== 'default' && Object.prototype.hasOwnProperty.call(LATIN_GROW, fam)
      ? LATIN_GROW[fam] : LATIN_GROW.default;
  }

  // ---- the particle tagger (v6; DESIGN_2_2 §1 T2.4) ---------------------------------------------------------------

  // Particles the tagger looks for; sentence-final ones (よ ね な さ か わ), だけ, って and ながら are left alone.
  const P1 = Object.freeze([...'はがをにでとへもの']);
  const P2 = Object.freeze(['から', 'まで', 'より']);
  // A particle right after a particle: only these pairs.
  const STACK = Object.freeze(['には', 'では', 'とは', 'へは', 'からは', 'までは', 'よりは', 'にも', 'でも', 'とも', 'へも',
    'からも', 'までも', 'よりも', 'への', 'との', 'での', 'からの', 'までの', 'よりの']);
  // The grapheme after a particle that makes it a word ending or a word start instead (上がる, 奏でる, 待とう, 積もる).
  const VETO_NEXT = Object.freeze({
    'が': 'るれらりろっ', 'で': 'るれろっすし', 'に': 'っ', 'と': 'っうれ', 'の': 'っ', 'は': 'っ',
    'も': 'うっのえどらしるれりろ', 'へ': 'っ', 'を': '', 'から': 'だっ', 'まで': '', 'より': 'そ',
  });
  // The two graphemes after a particle that make it a copula (である) or a suffix (にくい).
  const VETO_NEXT2 = Object.freeze({ 'で': Object.freeze(['ある', 'あり', 'あれ', 'あろ']),
    'に': Object.freeze(['くい', 'くく', 'くか', 'くさ', 'くけ']) });
  // Kanji + kana that begin a verb or adverb ending (the kana is okurigana).
  const VETO_PAIR = Object.freeze(['死に', '落と', '逃が', '騒が', '急が', '稼が', '塞が', '防が', '泳が', '脱が', '嗅が', '仰が',
    '注が', '研が', '漕が', '担が', '剥が', '紡が', '繋が', '焦が', '転が', '揺が', '最も', '尤も', '遠の', '奏で', '撫で', '茹で', '詣で',
    '秀で', '更に', '既に', '共に', '特に', '遂に', '殊に', '常に', '正に', '誠に', '故に', '実に']);
  // Compounds written with a particle-looking kana inside.
  const VETO_TRIPLE = Object.freeze(['背のび', '手のひ', '目の当', '木の実']);
  // Hiragana words a particle may follow (where a word may start).
  const KANA_WORDS = Object.freeze(['あなた', 'あたし', 'わたし', 'きみ', 'ぼく', 'ぼくら', 'おれ', 'ふたり', 'ひとり', 'みんな',
    'だれ', 'なに', 'どこ', 'ここ', 'そこ', 'あそこ', 'いま', 'きょう', 'あした', 'あす', 'きのう', 'こと', 'もの', 'とき', 'ゆめ',
    'そら', 'こえ', 'ひかり', 'ことば', 'こころ', 'なみだ', 'えがお', 'さくら', 'はな', 'ほし', 'つき', 'ゆき', 'あめ', 'かぜ',
    'うみ', 'よる', 'せかい', 'みらい', 'きもち', 'いのち', 'からだ', 'まま', 'さよなら', 'なか', 'あと', 'そば', 'うそ']);
  // Short hiragana words after which a word may start (adverbs, demonstratives).
  const LEAD_WORDS = Object.freeze(['まだ', 'もう', 'ずっと', 'そっと', 'もっと', 'きっと', 'やっと', 'ただ', 'この', 'その',
    'あの', 'どの', 'こんな', 'そんな', 'あんな']);
  const MAX_KANA_WORD = 4;
  // After a kanji and one or two okurigana (思い, 終わり, 来る, 見た): OKURI_FREE particles before anything, OKURI_EDGE
  // ones only before a non-hiragana grapheme, a space or the end.
  const OKURI_KANA = 'いりしちきみびぎえけせてねめれくるたらうつ';
  const OKURI_FREE = Object.freeze(['の', 'を', 'まで', 'から', 'より']);
  const OKURI_EDGE = Object.freeze(['は', 'も', 'へ', 'に', 'が', 'と']);
  const CLOSERS = '」』）】〕〉》';

  const P1_SET = new Set(P1), P2_SET = new Set(P2), STACK_SET = new Set(STACK), PAIR_SET = new Set(VETO_PAIR);
  const TRIPLE_SET = new Set(VETO_TRIPLE), KANA_WORD_SET = new Set(KANA_WORDS), LEAD_SET = new Set(LEAD_WORDS);
  const OKURI_KANA_SET = new Set(OKURI_KANA), OKURI_FREE_SET = new Set(OKURI_FREE), OKURI_EDGE_SET = new Set(OKURI_EDGE);
  const CLOSER_SET = new Set(CLOSERS);

  function isHira(u, g) { return g >= 0 && g < u.n && (u.cls[g] === 'hira' || (u.cls[g] === 'smallKana' && u.gs[g] < '゠')); }

  // Content a particle may follow directly: kanji, katakana, Latin, digits, fullwidth letters or a closing bracket.
  function contentLeft(u, g) {
    const c = u.cls[g];
    return c === 'han' || c === 'kata' || (c === 'smallKana' && u.gs[g] >= '゠') || c === 'latin' || c === 'digit'
      || c === 'fullLatin' || CLOSER_SET.has(u.gs[g]);
  }

  function hiraWord(u, s, e) {
    if (s < 0) return null;
    let w = '';
    for (let j = s; j <= e; j++) { if (!isHira(u, j)) return null; w += u.gs[j]; }
    return w;
  }

  // particleMarks(u) → Uint8Array: 1 on the graphemes of each particle the tagger finds in a breaker.analyze() view.
  function particleMarks(u) {
    const mark = new Uint8Array(u.n);
    // a word may start at s: at the start, after a space, a non-hiragana grapheme or a marked particle, or (one level)
    // after a LEAD_WORDS word that itself starts a word
    const startsWord = (s, deep) => {
      const g = s - 1;
      if (g < 0 || u.space[g] || !isHira(u, g) || mark[g]) return true;
      if (!deep) return false;
      for (let k = 2; k <= MAX_KANA_WORD; k++) {
        const w = hiraWord(u, s - k, g);
        if (w && LEAD_SET.has(w) && startsWord(s - k, false)) return true;
      }
      return false;
    };
    for (let i = 0; i < u.n; i++) {
      if (u.space[i]) continue;
      let len = 0, p = null;
      if (i + 1 < u.n && P2_SET.has(u.gs[i] + u.gs[i + 1])) { len = 2; p = u.gs[i] + u.gs[i + 1]; }
      else if (P1_SET.has(u.gs[i])) { len = 1; p = u.gs[i]; }
      if (!len) continue;
      const L = i - 1;
      if (L < 0 || u.space[L]) continue;                  // no particle at the start or after a space
      const R = i + len;
      const rHira = R < u.n && !u.space[R] && isHira(u, R);
      let ok = false;
      if (p === 'を') {
        ok = true;                                         // を is only ever the object particle
      } else if (contentLeft(u, L)) {
        ok = !PAIR_SET.has(u.gs[L] + u.gs[i]) && !(R < u.n && TRIPLE_SET.has(u.gs[L] + p + u.gs[R]));
      } else if (mark[L]) {
        let prev = u.gs[L];
        if (L >= 1 && mark[L - 1] && P2_SET.has(u.gs[L - 1] + u.gs[L])) prev = u.gs[L - 1] + u.gs[L];
        ok = STACK_SET.has(prev + p);
        // a stacked は starts no word: before a non-hiragana grapheme, a space, the end or ない (ではない, にはない)
        if (ok && p === 'は' && rHira && !(u.gs[R] === 'な' && R + 1 < u.n && u.gs[R + 1] === 'い')) ok = false;
      } else if (isHira(u, L)) {
        for (let k = 2; k <= MAX_KANA_WORD && !ok; k++) {
          const w = hiraWord(u, L - k + 1, L);
          if (w && KANA_WORD_SET.has(w) && startsWord(L - k + 1, true)) ok = true;
        }
        if (!ok) {
          const one = L >= 1 && u.cls[L - 1] === 'han' && OKURI_KANA_SET.has(u.gs[L]);
          const two = L >= 2 && u.cls[L - 2] === 'han' && isHira(u, L - 1) && !mark[L - 1] && OKURI_KANA_SET.has(u.gs[L]);
          if ((one || two) && (OKURI_FREE_SET.has(p) || (OKURI_EDGE_SET.has(p) && !rHira))) ok = true;
        }
      }
      if (!ok) continue;
      if (R < u.n && !u.space[R] && VETO_NEXT[p] && VETO_NEXT[p].includes(u.gs[R])) continue;
      if (R + 1 < u.n && VETO_NEXT2[p] && VETO_NEXT2[p].includes(u.gs[R] + u.gs[R + 1])) continue;
      for (let j = i; j < R; j++) mark[j] = 1;
      i = R - 1;
    }
    return mark;
  }

  // ---- memos ------------------------------------------------------------------------------------------------------

  function remember(memo, key, value) {
    if (memo.size >= MEMO_MAX) memo.clear();
    memo.set(key, value);
    return value;
  }

  const partsMemo = new Map();
  // partsOf(text, lang) → { u, part }: the grapheme view of a text and its particle marks (all 0 unless lang is 'ja').
  // Shared, read-only.
  function partsOf(text, lang) {
    const s = String(text === undefined || text === null ? '' : text);
    const key = lang + '|' + s;
    const hit = partsMemo.get(key);
    if (hit) return hit;
    const u = B.analyze(s);
    return remember(partsMemo, key, Object.freeze({ u, part: lang === 'ja' ? particleMarks(u) : new Uint8Array(u.n) }));
  }

  // particles(text, lang) → [[a, b]]: UTF-16 ranges of the particles (stacked ones, such as には, form one range);
  // [] unless lang is 'ja'.
  function particles(text, lang) {
    if (lang !== 'ja') return [];
    const { u, part } = partsOf(text, lang);
    const out = [];
    for (let i = 0; i < u.n; i++) {
      if (!part[i]) continue;
      let j = i;
      while (j < u.n && part[j]) j++;
      out.push([u.offs[i], u.offs[j]]);
      i = j - 1;
    }
    return out;
  }

  const marksMemo = new Map();
  // marks(text, lang, head) → { u, part, heads }: partsOf(text, lang) plus the heads of the text as one cut (T2):
  //   'line'   the cut's first content grapheme after any opening brackets, when lineHeadable
  //   'phrase' 'line', plus the first grapheme of every later phrase unit (breaker.phraseUnits) when phraseHeadable
  //   'none'   no heads
  // No heads unless lang is 'ja' and the cut holds at least MIN_HEAD_CONTENT content graphemes. Shared, read-only.
  function marks(text, lang, head) {
    const s = String(text === undefined || text === null ? '' : text);
    const h = HEADS.includes(head) ? head : 'line';
    const key = lang + '|' + h + '|' + s;
    const hit = marksMemo.get(key);
    if (hit) return hit;
    const { u, part } = partsOf(s, lang);
    const heads = new Uint8Array(u.n);
    let content = 0;
    for (let i = 0; i < u.n; i++) if (!u.space[i]) content++;
    if (lang === 'ja' && h !== 'none' && content >= MIN_HEAD_CONTENT) {
      let first = u.next[0];
      while (first < u.n && OPENER_SET.has(u.gs[first])) first = u.next[first + 1];
      if (first < u.n && lineHeadable(u, first, part)) heads[first] = 1;
      if (h === 'phrase') {
        for (const [a] of B.phraseUnits(u, 'ja')) if (a > first && phraseHeadable(u, a, part)) heads[a] = 1;
      }
    }
    return remember(marksMemo, key, Object.freeze({ u, part, heads }));
  }

  const cjkMemo = new Map();
  // hasCjk(text) → whether the text holds a han, kana or hangul grapheme (the T3 gate, read on the cut text).
  function hasCjk(text) {
    const s = String(text === undefined || text === null ? '' : text);
    const hit = cjkMemo.get(s);
    if (hit !== undefined) return hit;
    let v = false;
    for (const g of S.graphemes(s)) if (CJK.has(S.charClass(g))) { v = true; break; }
    return remember(cjkMemo, s, v);
  }

  // Index of the grapheme that starts at UTF-16 offset `at` (binary search in u.offs), or -1.
  function indexAt(offs, n, at) {
    let lo = 0, hi = n - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offs[mid] === at) return mid;
      if (offs[mid] < at) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }

  // ---- the RunSpec field ------------------------------------------------------------------------------------------

  function strength(v) { return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0; }

  // normalize(k) → frozen { kana, jump, head, latin } | null: strengths clamped to 0–1 (anything else is 0), an
  // unknown head is 'line', and null when all three strengths are 0 (the run is set as it always was).
  function normalize(k) {
    if (!k || typeof k !== 'object') return null;
    const kana = strength(k.kana), jump = strength(k.jump), latin = strength(k.latin);
    if (!(kana > 0 || jump > 0 || latin > 0)) return null;
    return Object.freeze({ kana, jump, head: HEADS.includes(k.head) ? k.head : 'line', latin });
  }

  // key(k) → a string naming a normalized kumi ('' for null).
  function key(k) { return k ? 'k' + k.kana + '|j' + k.jump + '|h' + k.head + '|l' + k.latin : ''; }

  // withCut(spec, cut) → the RunSpec a cut-scoped text service lays out (cut = its normalized kumi, or null):
  //   cut null                      → spec as it is
  //   spec.kumi === null            → as it is (the part asked for plain text)
  //   spec.kumi absent, tracking set → as it is (a part that sets its own spacing)
  //   spec.kumi absent              → { ...spec, kumi: cut }
  //   spec.kumi an object           → { ...spec, kumi: { ...cut, ...spec.kumi } } (a part's partial override)
  function withCut(spec, cut) {
    if (!cut || !spec || typeof spec !== 'object') return spec;
    const own = spec.kumi;
    if (own === null) return spec;
    if (own === undefined) return spec.tracking !== undefined ? spec : Object.assign({}, spec, { kumi: cut });
    if (typeof own !== 'object') return spec;
    return Object.assign({}, spec, { kumi: Object.assign({}, cut, own) });
  }

  // ---- apply ------------------------------------------------------------------------------------------------------

  // The text a run's graphemes come from and the offset of its first one there: the run's own text (spec.text), or
  // the cut text (the run is a span of it). Marks and gates read the whole source, so a run cut from a line is set
  // like the same graphemes inside a whole-line run.
  function sourceOf(o) {
    return o.own ? { text: o.str, base: 0 } : { text: o.text, base: o.base };
  }

  // T1: the trim of each grapheme, halved on both sides of a word seam (Japanese runs only).
  function kanaTrims(s, o) {
    const { u } = o;
    const n = u.n;
    const trim = new Float64Array(n);
    let any = false;
    for (let i = 0; i < n; i++) {
      const t = tier(u, i);
      if (t) { trim[i] = s * TRIM[t]; any = true; }
    }
    if (!any || o.lang !== 'ja' || n < 2) return trim;
    const bound = new Uint8Array(n);
    for (const [a] of B.phraseUnits(u, 'ja')) bound[a] = 1;
    const src = sourceOf(o);
    const pm = partsOf(src.text, 'ja');
    for (let i = 1; i < n; i++) {
      if (bound[i]) continue;
      const j = indexAt(pm.u.offs, pm.u.n, src.base + u.offs[i]);
      if (j > 0 && pm.part[j - 1] && !pm.part[j]) bound[i] = 1;
    }
    for (let b = 1; b < n; b++) {
      const p = b - 1;
      if (!bound[b] || u.space[p] || !(trim[p] > 0) || !(trim[b] > 0)) continue;
      trim[p] *= BOUNDARY;
      trim[b] *= BOUNDARY;
    }
    return trim;
  }

  // T2: particles shrink and heads grow, read on the whole cut text (so a particle at a run boundary still sees its
  // neighbours, and a run cut from the line is set like the same graphemes in a whole-line run). k holds the emphasis
  // scale (or 1) on entry: a particle inside 強調 shrinks relative to it, and a head takes the larger of the two, never
  // their product (効果を重ねすぎない).
  function jumpSizes(kumi, o, role) {
    const { u, k } = o;
    const m = marks(o.text, 'ja', kumi.head);
    const small = 1 - JUMP.small * kumi.jump, big = 1 + JUMP.big * kumi.jump;
    for (let i = 0; i < u.n; i++) {
      const j = indexAt(m.u.offs, m.u.n, o.base + u.offs[i]);
      if (j < 0) continue;
      if (m.part[j]) { k[i] *= small; role[i] = ROLE.particle; }
      else if (m.heads[j]) { if (k[i] < big) k[i] = big; role[i] = ROLE.head; }
    }
  }

  // T3: Latin words (maximal runs on the Latin face holding a letter, without their edge spaces) grow to at least
  // `grow` and get LATIN_GAP × strength of space where they meet CJK. Vertical tcy cells keep their size.
  function latinWords(x, o, role, gap) {
    const { u, font, vert, k } = o;
    const n = u.n;
    const grow = 1 + x * latinGrow(o.latin);
    const add = LATIN_GAP * x;
    const cjk = (g) => g >= 0 && g < n && !u.space[g] && CJK.has(u.cls[g]);
    let any = false;
    for (let i = 0; i < n;) {
      if (font[i] !== 1) { i++; continue; }
      let j = i, letter = false;
      while (j < n && font[j] === 1) { if (u.cls[j] === 'latin') letter = true; j++; }
      const c0 = u.next[i], c1 = u.prev[j] + 1;          // content bounds: edge spaces are not the word's
      if (letter && c0 < c1) {
        for (let g = c0; g < c1; g++) {
          if (vert && vert.group[g] >= 0 && vert.groups[vert.group[g]].cls === 'tcy') continue;
          if (k[g] < grow) k[g] = grow;
          if (!role[g]) role[g] = ROLE.latin;
        }
        if (cjk(c0 - 1)) { gap[c0] = add; any = true; }
        if (cjk(c1)) { gap[c1] = add; any = true; }
      }
      i = j;
    }
    return any;
  }

  // apply(kumi, o) → { cap, gap, role }, for engine/text/layout.prepare. kumi: a normalized RunSpec.kumi. o = { u, lang,
  // font (layout font indices), vert (vert.classify or null), mark (emphasis marks), k (size factors: the emphasis
  // scale or 1 on entry; T2 and T3 write theirs here), text (the cut text), str, base (the run's text and its offset in
  // the cut text), own (the run has its own text), emphScale, face (the run's script FontRef), latin (its Latin FontRef) }.
  //   cap[i]  the most grapheme i may advance, in em before its size factor (Infinity: no limit)
  //   gap     em added before grapheme i when it is not the first of its line, or null when none
  //   role    RunLayout.kumi (ROLE per grapheme: particle and head from T2, latin from T3)
  function apply(kumi, o) {
    const n = o.u.n;
    const cap = new Float64Array(n).fill(Infinity);
    const role = new Uint8Array(n);
    let gap = null;
    if (kumi.kana > 0) {
      const trim = kanaTrims(kumi.kana * faceDamp(o.face), o);
      for (let i = 0; i < n; i++) if (trim[i] > 0) cap[i] = 1 - trim[i];
    }
    if (kumi.jump > 0 && o.lang === 'ja' && !o.own) jumpSizes(kumi, o, role);   // own-text runs never get T2
    if (kumi.latin > 0 && o.lang !== 'en' && hasCjk(sourceOf(o).text)) {
      const g = new Float64Array(n);
      if (latinWords(kumi.latin, o, role, g)) gap = g;
    }
    return { cap, gap, role };
  }

  // Test hook: empties the memos (results must not depend on them).
  function clearMemos() { partsMemo.clear(); marksMemo.clear(); cjkMemo.clear(); }

  return {
    normalize, key, withCut, particleMarks, partsOf, particles, marks, hasCjk, tier, apply, clearMemos,
    HEADS, ROLE, TRIM, WIDE_KANA, NARROW_KANA, FLAVOR_DAMP, HEAVY_WEIGHT, WEIGHT_DAMP, BOUNDARY, JUMP, OPENERS,
    MIN_HEAD_CONTENT, LATIN_GROW, LATIN_GAP,
    P1, P2, STACK, VETO_NEXT, VETO_NEXT2, VETO_PAIR, VETO_TRIPLE, KANA_WORDS, LEAD_WORDS, OKURI_KANA, OKURI_FREE,
    OKURI_EDGE, CLOSERS, MEMO_MAX,
  };
});
