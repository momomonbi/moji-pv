/* 文字PVメーカー v2 — original work. Text units: graphemes, character classes, scripts, cells, morae (DESIGN §4.8). */
MV.def('core/script', [], () => {
  'use strict';

  // ---- code point tables ----------------------------------------------------------------------------------------

  // Code points that never start a grapheme: they extend the cluster before them (§4.8 list, plus the two halfwidth
  // katakana voicing marks U+FF9E–FF9F, which Unicode also treats as extenders).
  function isExtend(cp) {
    return (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x1dc0 && cp <= 0x1dff)
      || (cp >= 0x20d0 && cp <= 0x20ff) || (cp >= 0xfe20 && cp <= 0xfe2f) || cp === 0x3099 || cp === 0x309a
      || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef) || cp === 0x200d
      || (cp >= 0x1f3fb && cp <= 0x1f3ff) || (cp >= 0xe0020 && cp <= 0xe007f) || cp === 0xff9e || cp === 0xff9f;
  }

  const ZWJ = 0x200d;
  const CR = 0x0d;
  const LF = 0x0a;

  function isRegional(cp) { return cp >= 0x1f1e6 && cp <= 0x1f1ff; }

  // Hangul syllable parts for the L+V(+T) rule: 1 = L, 2 = V, 3 = T, 4 = LV syllable, 5 = LVT syllable, 0 = none.
  const JAMO_L = 1, JAMO_V = 2, JAMO_T = 3, JAMO_LV = 4, JAMO_LVT = 5;
  function jamoType(cp) {
    if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0xa960 && cp <= 0xa97c)) return JAMO_L;
    if ((cp >= 0x1160 && cp <= 0x11a7) || (cp >= 0xd7b0 && cp <= 0xd7c6)) return JAMO_V;
    if ((cp >= 0x11a8 && cp <= 0x11ff) || (cp >= 0xd7cb && cp <= 0xd7fb)) return JAMO_T;
    if (cp >= 0xac00 && cp <= 0xd7a3) return (cp - 0xac00) % 28 === 0 ? JAMO_LV : JAMO_LVT;
    return 0;
  }

  function jamoJoins(prev, next) {
    if (prev === JAMO_L) return next === JAMO_L || next === JAMO_V || next === JAMO_LV || next === JAMO_LVT;
    if (prev === JAMO_V || prev === JAMO_LV) return next === JAMO_V || next === JAMO_T;
    if (prev === JAMO_T || prev === JAMO_LVT) return next === JAMO_T;
    return false;
  }

  // ---- graphemes ------------------------------------------------------------------------------------------------

  // Walks str once and calls visit(offset) at the start of every grapheme cluster.
  function eachBoundary(str, visit) {
    let prev = -1;          // previous code point
    let afterZwj = false;   // the previous code point was a ZWJ: the next one joins
    let regionals = 0;      // regional indicators in the current cluster
    let i = 0;
    while (i < str.length) {
      const cp = str.codePointAt(i);
      if (prev < 0 || !joins(prev, cp, afterZwj, regionals)) {
        visit(i);
        regionals = 0;
      }
      if (isRegional(cp)) regionals += 1;
      afterZwj = cp === ZWJ;
      prev = cp;
      i += cp > 0xffff ? 2 : 1;
    }
  }

  function joins(prev, cp, afterZwj, regionals) {
    if (prev === CR) return cp === LF;
    if (prev === LF || cp === CR || cp === LF) return false;
    if (isExtend(cp) || afterZwj) return true;
    if (isRegional(cp)) return isRegional(prev) && regionals % 2 === 1;
    return jamoJoins(jamoType(prev), jamoType(cp));
  }

  // UTF-16 start offset of each grapheme, then str.length.
  function graphemeOffsets(str) {
    const s = String(str);
    const out = new Int32Array(s.length + 1);
    let n = 0;
    eachBoundary(s, (i) => { out[n++] = i; });
    out[n++] = s.length;
    return out.slice(0, n);
  }

  function graphemes(str) {
    const s = String(str);
    const offs = graphemeOffsets(s);
    const out = new Array(offs.length - 1);
    for (let k = 0; k < out.length; k++) out[k] = s.slice(offs[k], offs[k + 1]);
    return out;
  }

  // The nearest grapheme boundary at or before (mode 'floor', default) or at or after (mode 'ceil') `offset`,
  // clamped to [0, str.length]. Additive export: lyrics and reconcile keep every offset on a boundary (§4.9.1 rule 9).
  function snapOffset(str, offset, mode = 'floor') {
    return snapToBoundary(graphemeOffsets(String(str)), offset, mode);
  }

  // Same as snapOffset, with the offsets of graphemeOffsets(str) already at hand.
  function snapToBoundary(offs, offset, mode = 'floor') {
    const end = offs[offs.length - 1];
    if (!(offset > 0)) return 0;
    if (offset >= end) return end;
    let lo = 0, hi = offs.length - 1;          // offs[lo] <= offset < offs[hi]
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (offs[mid] <= offset) lo = mid; else hi = mid;
    }
    if (offs[lo] === offset || mode !== 'ceil') return offs[lo];
    return offs[hi];
  }

  // ---- character classes ----------------------------------------------------------------------------------------

  const CLASS_NAMES = Object.freeze(['han', 'hira', 'kata', 'smallKana', 'hangul', 'latin', 'digit', 'fullLatin',
    'space', 'punctJa', 'punctLatin', 'emoji', 'symbol']);
  const [HAN, HIRA, KATA, SMALL, HANGUL, LATIN, DIGIT, FULL_LATIN, SPACE, PUNCT_JA, PUNCT_LATIN, EMOJI, SYMBOL] =
    CLASS_NAMES.map((_, i) => i);

  const SMALL_KANA = new Set([...'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶｧｨｩｪｫｬｭｮｯ'].map((c) => c.codePointAt(0)));
  // Wide general punctuation that lives with Japanese text: ― ‥ … ※ ‼ ⁉
  const PUNCT_JA_GENERAL = new Set([0x2015, 0x2025, 0x2026, 0x203b, 0x203c, 0x2049]);
  const LATIN1_PUNCT = new Set([0xa1, 0xa7, 0xab, 0xb6, 0xb7, 0xbb, 0xbf]);

  function classOfAscii(cp) {
    if (cp === 0x20 || (cp >= 0x09 && cp <= 0x0d)) return SPACE;
    if (cp >= 0x30 && cp <= 0x39) return DIGIT;
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) return LATIN;
    return cp > 0x20 && cp < 0x7f ? PUNCT_LATIN : SYMBOL;
  }

  function classOfLatinRange(cp) {
    if (cp === 0xa0) return SPACE;
    if (cp === 0xd7 || cp === 0xf7) return SYMBOL;
    if (cp >= 0xc0 || cp === 0xaa || cp === 0xb5 || cp === 0xba) return LATIN;
    return LATIN1_PUNCT.has(cp) ? PUNCT_LATIN : SYMBOL;
  }

  function classOfCjkPunct(cp) {
    if (cp === 0x3000) return SPACE;
    if (cp === 0x3005 || cp === 0x3006 || cp === 0x3007 || cp === 0x303b) return HAN;   // 々 〆 〇 〻
    return PUNCT_JA;
  }

  function classOfKana(cp) {
    if (cp === 0x30fb) return PUNCT_JA;                     // ・
    if (SMALL_KANA.has(cp)) return SMALL;
    return cp < 0x30a0 ? HIRA : KATA;
  }

  function classOfFullwidth(cp) {
    const letterOrDigit = (cp >= 0xff10 && cp <= 0xff19) || (cp >= 0xff21 && cp <= 0xff3a) || (cp >= 0xff41 && cp <= 0xff5a);
    if (letterOrDigit) return FULL_LATIN;
    if (cp <= 0xff65) return PUNCT_JA;
    if (cp <= 0xff9f) return SMALL_KANA.has(cp) ? SMALL : KATA;
    if (cp <= 0xffdc) return HANGUL;
    return SYMBOL;
  }

  function classOfGeneralPunct(cp) {
    if ((cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x205f) return SPACE;
    if (PUNCT_JA_GENERAL.has(cp)) return PUNCT_JA;
    if ((cp >= 0x2010 && cp <= 0x2027) || (cp >= 0x2030 && cp <= 0x205e)) return PUNCT_LATIN;
    return SYMBOL;
  }

  function isHanCp(cp) {
    return (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0xf900 && cp <= 0xfaff)
      || (cp >= 0x20000 && cp <= 0x3ffff) || (cp >= 0x2e80 && cp <= 0x2fdf) || (cp >= 0x31c0 && cp <= 0x31ef);
  }

  function classOf(cp) {
    if (cp < 0x80) return classOfAscii(cp);
    if (cp <= 0x24f) return classOfLatinRange(cp);
    if (cp <= 0x2af || (cp >= 0x370 && cp <= 0x52f) || (cp >= 0x1e00 && cp <= 0x1eff)) {
      return cp >= 0x370 && cp <= 0x3ff && !isGreekLetter(cp) ? SYMBOL : LATIN;
    }
    if (cp >= 0x1100 && cp <= 0x11ff) return HANGUL;
    if (cp >= 0x2000 && cp <= 0x206f) return classOfGeneralPunct(cp);
    if (cp >= 0x3000 && cp <= 0x303f) return classOfCjkPunct(cp);
    if (cp >= 0x3041 && cp <= 0x30ff) return classOfKana(cp);
    if (cp >= 0x31f0 && cp <= 0x31ff) return SMALL;
    if ((cp >= 0x3130 && cp <= 0x318f) || (cp >= 0xa960 && cp <= 0xa97f)) return HANGUL;
    if (cp >= 0xac00 && cp <= 0xd7ff) return HANGUL;
    if (isHanCp(cp)) return HAN;
    if (cp >= 0xff01 && cp <= 0xffef) return classOfFullwidth(cp);
    if (cp >= 0x1f000 && cp <= 0x1faff) return EMOJI;
    return SYMBOL;
  }

  function isGreekLetter(cp) { return (cp >= 0x386 && cp <= 0x3ff) && cp !== 0x387; }

  // A grapheme reads as an emoji when it carries emoji machinery (VS16, keycap, ZWJ) or its base is in the pictographic
  // planes (which include regional indicators and skin tones).
  function hasEmojiMarks(g) {
    for (let i = 1; i < g.length; i++) {
      const c = g.charCodeAt(i);
      if (c === 0xfe0f || c === 0x20e3 || c === 0x200d) return true;
    }
    return false;
  }

  function classCode(g) {
    if (!g) return SYMBOL;
    const base = classOf(g.codePointAt(0));
    if (base === EMOJI || g.length === 1) return base;
    return hasEmojiMarks(g) ? EMOJI : base;
  }

  // Class of a character or grapheme (its first code point; emoji sequences count as emoji).
  function charClass(ch) { return CLASS_NAMES[classCode(String(ch))]; }

  // ---- cells ----------------------------------------------------------------------------------------------------

  // Cell widths in twentieths, so sums stay exact: 1 → 20, 0.55 → 11, 0.3 → 6, 0.5 → 10, 0.6 → 12.
  const WIDE_CLASSES = new Set([HAN, HIRA, KATA, SMALL, HANGUL, FULL_LATIN, PUNCT_JA, EMOJI]);

  function isHalfwidthForm(cp) { return (cp >= 0xff61 && cp <= 0xffdc) || (cp >= 0xffe8 && cp <= 0xffee); }

  function isWideSymbol(cp) {
    return (cp >= 0x2e80 && cp <= 0x33ff) || (cp >= 0xfe10 && cp <= 0xfe19) || (cp >= 0xfe30 && cp <= 0xfe6f)
      || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6);
  }

  function cellUnits(g) {
    const cp = g.codePointAt(0);
    const cls = classCode(g);
    if (cls === EMOJI) return 20;
    if (isHalfwidthForm(cp)) return 10;
    if (cls === LATIN || cls === DIGIT) return 11;
    if (cls === SPACE) return cp === 0x3000 ? 20 : 6;
    if (WIDE_CLASSES.has(cls) || isWideSymbol(cp)) return 20;
    return 12;
  }

  // Layout-free width estimate: han/kana/hangul/fullwidth 1, halfwidth katakana 0.5, Latin letter/digit 0.55,
  // space 0.3, other 0.6. Used by the planner only, never for layout.
  function cells(str) {
    const s = String(str);
    const offs = graphemeOffsets(s);
    let units = 0;
    for (let k = 0; k + 1 < offs.length; k++) units += cellUnits(s.slice(offs[k], offs[k + 1]));
    return units / 20;
  }

  // ---- scripts --------------------------------------------------------------------------------------------------

  // Pairs of (traditional, simplified) forms where each form is used by only one of the two standards. Characters
  // that also exist with another meaning in the other standard (后 里 云 干 …) are left out on purpose.
  const PAIRS =
    '們们這这個个來来說说為为時时會会國国對对學学發发過过還还見见現现頭头長长開开關关間间問问門门聽听愛爱夢梦' +
    '風风讓让歲岁從从與与無无樂乐歡欢書书東东車车馬马鳥鸟魚鱼飛飞語语話话請请謝谢記记憶忆認认識识讀读誰谁變变' +
    '經经給给紅红綠绿藍蓝黃黄顏颜聲声燈灯點点熱热氣气電电視视腦脑媽妈爺爷親亲憂忧傷伤悶闷帶带邊边遠远進进運运' +
    '選选連连達达遲迟實实寫写寶宝將将當当盡尽輕轻輪轮軟软轉转鐘钟錢钱鏡镜錯错陽阳陰阴隊队際际雙双雖虽難难雞鸡' +
    '離离靈灵韓韩頁页順顺須须顧顾題题飯饭館馆體体麗丽麼么齊齐龍龙蘭兰藝艺華华萬万蘋苹處处號号衛卫補补覺觉觀观' +
    '規规計计訊讯許许論论設设試试詩诗該该誤误調调談谈講讲證证議议護护讚赞買买賣卖貨货費费貴贵質质賽赛贏赢趕赶' +
    '躍跃農农鄉乡醫医釋释鐵铁閃闪閉闭閒闲陣阵陸陆險险隨随隱隐雜杂靜静響响頂顶項项預预領领頻频顆颗飄飘餅饼驗验' +
    '驚惊髒脏鬧闹鮮鲜鳴鸣麥麦黨党齡龄嗎吗嘆叹團团圍围圖图園园圓圆場场塊块壞坏壓压奮奋婦妇孫孙寧宁專专尋寻層层' +
    '帥帅師师幫帮廣广張张彈弹戀恋應应懷怀戰战戲戏擁拥擇择擊击數数斷断燒烧爐炉牽牵獨独獻献環环產产畫画療疗睜睁' +
    '確确禮礼穩稳窮穷筆笔簡简糧粮緊紧線线練练總总織织繞绕繼继續续罷罢聯联聰聪職职膽胆臉脸興兴舉举舊旧';
  const TRAD_ONLY = [...PAIRS].filter((_, i) => i % 2 === 0).join('');
  const SIMP_ONLY = [...PAIRS].filter((_, i) => i % 2 === 1).join('');
  const TRAD_SET = new Set(TRAD_ONLY);
  const LANG_CODES = new Set(['ja', 'en', 'zhHant', 'zhHans', 'ko']);

  // Dominant script of one line (§4.8): kana → ja; hangul → ko; han without kana → ja when the sheet has kana
  // (docHint 'ja'), else zhHant when a TRAD_ONLY form occurs, else zhHans; only Latin/digits → en.
  // A line with no letters at all (symbols, emoji) follows docHint, else en.
  function lineScript(text, docHint) {
    const s = String(text);
    let kana = false, hangul = false, han = false, latin = false, trad = false;
    for (let i = 0; i < s.length; i++) {
      const cp = s.codePointAt(i);
      if (cp > 0xffff) i++;
      const cls = classOf(cp);
      if (cls === HIRA || cls === KATA || cls === SMALL) kana = true;
      else if (cls === HANGUL) hangul = true;
      else if (cls === HAN) {
        han = true;
        if (TRAD_SET.has(String.fromCodePoint(cp))) trad = true;
      } else if (cls === LATIN || cls === DIGIT || cls === FULL_LATIN) latin = true;
    }
    if (kana) return 'ja';
    if (hangul) return 'ko';
    if (han) {
      if (docHint === 'ja') return 'ja';
      if (trad) return 'zhHant';
      return 'zhHans';                                  // simplified forms, or nothing that decides
    }
    if (latin) return 'en';
    return LANG_CODES.has(docHint) ? docHint : 'en';
  }

  // ---- morae ----------------------------------------------------------------------------------------------------

  // Small kana that still take a beat of their own: っ ッ ｯ (geminate) and ヵ ヶ (read as ka / ke in counters).
  const FULL_MORA_SMALL = new Set([...'っッｯヵヶ'].map((c) => c.codePointAt(0)));
  const VOWELS = /[aeiouyаеёиоуыэюяαεηιουω]+/g;

  // Syllable estimate of one alphabetic word: vowel groups (a leading y is a consonant), at least 1.
  function wordMorae(word) {
    const plain = word.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^y/, '');
    const groups = plain.match(VOWELS);
    return Math.max(1, groups ? groups.length : 0);
  }

  function isWordJoiner(g) { return g === '\'' || g === '’' || g === '-'; }

  // Reading length in morae (§4.8), in tenths while counting so sums stay exact.
  //   ja: kana 1 (small ゃゅょ… 0; っ and ー 1), han 1.7 · ko: 1 per syllable · zh: 1 per han ·
  //   en (and Latin words in any line): vowel groups per word, min 1 · digits 1 each · punctuation, spaces, symbols 0.
  function morae(text, lang) {
    const gs = graphemes(String(text));
    const hanTenths = lang === 'ja' ? 17 : 10;
    let tenths = 0;
    let word = '';
    const flush = () => { if (word) { tenths += 10 * wordMorae(word); word = ''; } };
    for (let k = 0; k < gs.length; k++) {
      const g = gs[k];
      const cls = classCode(g);
      if (cls === LATIN || cls === FULL_LATIN) { word += g; continue; }
      if (word && isWordJoiner(g) && k + 1 < gs.length && classCode(gs[k + 1]) === LATIN) { word += g; continue; }
      flush();
      if (cls === HIRA || cls === KATA || cls === HANGUL || cls === DIGIT) tenths += 10;
      else if (cls === SMALL) tenths += FULL_MORA_SMALL.has(g.codePointAt(0)) ? 10 : 0;
      else if (cls === HAN) tenths += hanTenths;
    }
    flush();
    return tenths / 10;
  }

  return {
    graphemes, graphemeOffsets, charClass, lineScript, cells, morae, TRAD_ONLY, SIMP_ONLY,
    snapOffset, snapToBoundary, CLASSES: CLASS_NAMES,
  };
});
