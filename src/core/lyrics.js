/* 文字PVメーカー v2 — original work. Lyric rows: parser, line order and renderer (DESIGN §3.11, §4.9). */
MV.def('core/lyrics', ['core/script'], (S) => {
  'use strict';

  // §4.9.1 rule 3: the standard LRC ID tags (ti → title, ar → artist; the others, length, author, tool, '#' comment …
  // are ignored). ui/lyric_editor and ui/project_io use this one pattern (isMetaRow) so all three agree.
  const META_ROW = /^\[(ti|ar|al|au|by|length|offset|re|tool|ve|#):(.*)\]$/i;
  const STAMP = /^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]\s*/;
  const WORD_TAG = /<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g;
  const ESCAPABLE = '/*|!#[\\';
  const KANA = /[\u3041-\u3096\u309d-\u309f\u30a1-\u30fa\u30fc-\u30ff\u31f0-\u31ff\uff66-\uff9d]/;
  const SPACE = /\s/;
  // 'words' (DESIGN_2_2 §6): the enhanced-LRC word tags of a row, kept as data ([[at, t], …]; absent without tags).
  const FIELD_KEYS = ['stamps', 'text', 'pieces', 'emph', 'impact', 'note', 'words'];

  // ---- parseRow ------------------------------------------------------------------------------------------------

  // One row of the lyric box → ParsedRow (§3.11, without id). Rows follow the FROZEN grammar of §4.9.1.
  // Additive fields: `tag` and `value` of a meta row ([ti:…] → tag 'ti'); null on other rows.
  // `hint` is the sheet's script hint for lineScript ('ja' when the sheet has kana anywhere).
  function parseRow(src, hint = null) {
    const trimmed = String(src).trim();
    if (trimmed === '') return makeRow('blank', { hint });
    if (trimmed[0] === '#') return makeRow('comment', { heading: trimmed.slice(1).trim() || null, hint });
    const meta = META_ROW.exec(trimmed);
    if (meta) return makeRow('meta', { tag: meta[1].toLowerCase(), value: meta[2].trim(), hint });
    let rest = trimmed;
    const stamps = [];
    for (let m = STAMP.exec(rest); m; m = STAMP.exec(rest)) {
      stamps.push(stampSeconds(m));
      rest = rest.slice(m[0].length);
    }
    const tags = stripTags(rest);
    return makeRow('lyric', Object.assign(scanText(tags.text, tags.at.length ? tags : null), { stamps, hint }));
  }

  // Enhanced-LRC word tags <mm:ss.xx> (DESIGN_2_2 §6): removed from the text as v2 did (the stripped text is exactly
  // rest.replace(WORD_TAG, '')), with where each stood: at[k] = its index in the stripped text, t[k] = its seconds.
  function stripTags(rest) {
    const at = [], t = [];
    let text = '', last = 0;
    const re = new RegExp(WORD_TAG.source, 'g');
    for (let m = re.exec(rest); m; m = re.exec(rest)) {
      text += rest.slice(last, m.index);
      last = m.index + m[0].length;
      at.push(text.length);
      t.push(tagSeconds(m[0]));
    }
    return { text: text + rest.slice(last), at, t };
  }

  function tagSeconds(tag) {
    const m = /^<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?>$/.exec(tag);
    return Number(Number(m[1]) * 60 + Number(m[2]) + '.' + (m[3] || '0'));
  }

  // `words` is present only on a lyric row with at least one word tag (so the other rows keep their exact keys).
  function makeRow(kind, f) {
    const text = f.text || '';
    const row = {
      kind, stamps: f.stamps || [], text, pieces: f.pieces || null, emph: f.emph || [], impact: !!f.impact,
      note: f.note === undefined ? null : f.note, heading: f.heading === undefined ? null : f.heading,
      script: S.lineScript(text, f.hint), tag: f.tag || null, value: f.value === undefined ? null : f.value,
    };
    if (f.words && f.words.length) row.words = f.words;
    return row;
  }

  // '[mm:ss.xx]' parts → seconds; the fraction is read as decimal digits so 41.20 gives exactly 41.2.
  function stampSeconds(m) {
    const whole = Number(m[1]) * 60 + Number(m[2]);
    return Number(whole + '.' + (m[3] || '0'));
  }

  // Splits text into single UTF-16 units; `mark[i]` is true for an unescaped / * | ! (the only marks inside a line).
  // tokAt[p] = the token that source index p starts (or belongs to), tokAt[rest.length] = the token count: where a
  // word tag stood among the tokens.
  function tokenize(rest) {
    const chars = [], mark = [], tokAt = new Int32Array(rest.length + 1);
    for (let i = 0; i < rest.length; i++) {
      tokAt[i] = chars.length;
      const c = rest[i];
      if (c === '\\' && i + 1 < rest.length && ESCAPABLE.includes(rest[i + 1])) {
        tokAt[i + 1] = chars.length;
        chars.push(rest[++i]);
        mark.push(false);
      } else {
        chars.push(c);
        mark.push(c === '/' || c === '*' || c === '|' || c === '!');
      }
    }
    tokAt[rest.length] = chars.length;
    return { chars, mark, tokAt };
  }

  function isSpaceToken(tok, i) { return !tok.mark[i] && SPACE.test(tok.chars[i]); }

  // Rules 5–9 of §4.9.1 on the text after the stamps. tags = stripTags(…) when the row had word tags: each is placed
  // on the output text through the token maps (before the text → 0, after it → the end, where the singing ends).
  function scanText(rest, tags) {
    const tok = tokenize(rest);
    const bar = tok.mark.findIndex((m, i) => m && tok.chars[i] === '|');
    const end0 = bar < 0 ? tok.chars.length : bar;
    const note = bar < 0 ? null : (tok.chars.slice(bar + 1).join('').trim() || null);
    let lo = 0, hi = end0;
    while (lo < hi && isSpaceToken(tok, lo)) lo++;
    while (hi > lo && isSpaceToken(tok, hi - 1)) hi--;
    let impact = false;
    if (hi > lo && tok.mark[hi - 1] && tok.chars[hi - 1] === '!') { impact = true; hi--; }
    const body = build(tok, lo, hi);
    const words = tags ? tags.at.map((p, k) => {
      const ti = tok.tokAt[p];
      return [ti <= lo ? 0 : ti >= hi ? -1 : body.outAt[ti - lo], tags.t[k]];
    }) : null;
    return Object.assign(trimAndSnap(body, words), { impact, note });
  }

  // Builds plain text, piece boundaries and emphasis ranges from tokens [lo, hi). outAt[i − lo] = the output length
  // when token i is read (tokens a '/' consumes, the whitespace around it, included): where a word tag lands.
  function build(tok, lo, hi) {
    let stars = 0;
    for (let i = lo; i < hi; i++) if (tok.mark[i] && tok.chars[i] === '*') stars++;
    let starsLeft = stars - (stars % 2);            // an unmatched final '*' is literal
    const out = [];
    const cuts = [0];
    const emph = [];
    const outAt = new Int32Array(Math.max(0, hi - lo) + 1);
    let open = -1, slashes = 0;
    for (let i = lo; i < hi; i++) {
      outAt[i - lo] = out.length;
      const c = tok.chars[i];
      if (!tok.mark[i] || c === '!' || (c === '*' && starsLeft === 0)) { out.push(c); continue; }
      if (c === '*') {
        starsLeft--;
        if (open < 0) open = out.length;
        else { if (out.length > open) emph.push([open, out.length]); open = -1; }
        continue;
      }
      slashes++;
      const from = i;
      i = pieceBreak(tok, i, hi, out, cuts, emph);
      for (let k = from + 1; k <= i; k++) outAt[k - lo] = out.length;
      if (open > out.length) open = out.length;
    }
    outAt[Math.max(0, hi - lo)] = out.length;
    return { text: out.join(''), cuts, emph, slashes, outAt };
  }

  // Rule 8 at one '/': whitespace directly around it collapses to one space kept at the end of the earlier piece.
  // Returns the index of the last token consumed.
  function pieceBreak(tok, i, hi, out, cuts, emph) {
    const start = cuts[cuts.length - 1];
    let removed = false;
    while (out.length > start && SPACE.test(out[out.length - 1])) { out.pop(); removed = true; }
    let j = i;
    while (j + 1 < hi && isSpaceToken(tok, j + 1)) { j++; removed = true; }
    if (removed && out.length > start) out.push(' ');
    for (const r of emph) if (r[1] > out.length) r[1] = out.length;
    if (out.length > start) cuts.push(out.length);
    return j;
  }

  // Trims whitespace at both ends, shifts ranges, widens them to grapheme boundaries and drops empty pieces. Word tags
  // (rawWords [[out offset | −1 = end, t]]) are clipped to the text and snapped to a grapheme start (at === text.length:
  // a tag after the last character, where the singing ends).
  function trimAndSnap(body, rawWords) {
    const full = body.text;
    let a = 0, b = full.length;
    while (a < b && SPACE.test(full[a])) a++;
    while (b > a && SPACE.test(full[b - 1])) b--;
    const text = full.slice(a, b);
    const offs = S.graphemeOffsets(text);
    const clip = (x) => Math.min(Math.max(x - a, 0), text.length);
    const emph = [];
    for (const [x, y] of body.emph) {
      const r = [S.snapToBoundary(offs, clip(x)), S.snapToBoundary(offs, clip(y), 'ceil')];
      if (r[1] > r[0]) emph.push(r);
    }
    let pieces = null;
    if (body.slashes > 0 && text.length > 0) {
      const bounds = [0];
      for (const c of body.cuts.slice(1)) {
        const x = S.snapToBoundary(offs, clip(c));
        if (x > bounds[bounds.length - 1] && x < text.length) bounds.push(x);
      }
      bounds.push(text.length);
      pieces = bounds.slice(1).map((y, k) => [bounds[k], y]);
    }
    const words = rawWords && rawWords.length
      ? rawWords.map(([x, t]) => [x < 0 ? text.length : S.snapToBoundary(offs, clip(x)), t]) : null;
    return { text, pieces, emph, words };
  }

  // ---- sheet and lines -----------------------------------------------------------------------------------------

  // rows [{ id, src }] → Sheet (§3.11). Meta comes from the first [ti:] / [ar:] rows (an empty value is null).
  function parseSheet(rows) {
    const hint = rows.some((r) => KANA.test(r.src)) ? 'ja' : null;
    const meta = { title: null, artist: null };
    const seen = { ti: false, ar: false };
    const parsed = rows.map((r) => {
      const row = Object.assign({ id: r.id }, parseRow(r.src, hint));
      if (row.kind === 'meta' && (row.tag === 'ti' || row.tag === 'ar') && !seen[row.tag]) {
        seen[row.tag] = true;
        meta[row.tag === 'ti' ? 'title' : 'artist'] = row.value || null;
      }
      return row;
    });
    return { meta, rows: parsed };
  }

  // A lyric row whose text is empty (only stamps or marks) is not a sung line; like a blank row it marks a pause.
  function isPause(row) { return row.kind === 'blank' || (row.kind === 'lyric' && row.text === ''); }
  function isLine(row) { return row.kind === 'lyric' && row.text !== ''; }

  // Sheet → Line[] in the FROZEN order of §4.9.3. `lang` forces every line's language unless it is 'auto'.
  function linesOf(sheet, { lang = 'auto' } = {}) {
    const rows = sheet.rows;
    const list = [];
    const extras = [];
    let pauses = 0;
    rows.forEach((row, i) => {
      if (isPause(row)) { pauses++; return; }
      if (!isLine(row)) return;                     // comments and meta rows do not break a run of blank rows
      const heading = headingAbove(rows, i);
      const lineLang = lang === 'auto' ? row.script : lang;
      list.push(makeLine(row, 0, row.stamps.length ? row.stamps[0] : null, pauses, heading, lineLang));
      pauses = 0;
      for (let k = 1; k < row.stamps.length; k++) {
        extras.push({ stamp: row.stamps[k], at: i, line: makeLine(row, k, row.stamps[k], 0, heading, lineLang) });
      }
    });
    extras.sort((x, y) => x.stamp - y.stamp || x.at - y.at || x.line.occ - y.line.occ);
    for (const e of extras) list.splice(insertionIndex(list, e.stamp), 0, e.line);
    list.forEach((line, index) => { line.index = index; });
    return list;
  }

  // Right after the last line whose stamp is known and ≤ stamp (ties go after); the start when there is none.
  function insertionIndex(list, stamp) {
    for (let j = list.length - 1; j >= 0; j--) {
      if (list[j].stamp !== null && list[j].stamp <= stamp) return j + 1;
    }
    return 0;
  }

  function headingAbove(rows, i) {
    for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
      if (rows[j].kind === 'comment' && rows[j].heading) return rows[j].heading;
    }
    return null;
  }

  // A row with word tags gives each of its lines `words` (the same array) and `wordsRef`: the time the tags are counted
  // from (the row's first stamp, else its first tag), so every occurrence reads them relative to its own start.
  function makeLine(row, occ, stamp, pauseBefore, heading, lang) {
    const line = {
      id: occ === 0 ? row.id : row.id + '.' + occ, row: row.id, occ, index: -1,
      text: row.text, pieces: row.pieces, emph: row.emph, impact: row.impact, note: row.note, lang,
      stamp, pauseBefore, heading,
    };
    if (row.words && row.words.length) {
      line.words = row.words;
      line.wordsRef = row.stamps.length ? row.stamps[0] : row.words[0][1];
    }
    return line;
  }

  // ---- renderRow -----------------------------------------------------------------------------------------------

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  // seconds → '[mm:ss.xx]' (minutes zero-padded to 2, seconds to 2 decimals).
  function lrcTag(seconds) {
    const cs = Math.max(0, Math.round(seconds * 100));
    const m = Math.floor(cs / 6000);
    const rest = cs - m * 6000;
    return '[' + pad2(m) + ':' + pad2(Math.floor(rest / 100)) + '.' + pad2(rest % 100) + ']';
  }

  // Like lrcTag, but keeps milliseconds when centiseconds would change the value (so parsed stamps round-trip).
  function stampTag(seconds) {
    if (Math.round(seconds * 100) / 100 === seconds || !(seconds > 0)) return lrcTag(seconds);
    const ms = Math.round(seconds * 1000);
    const m = Math.floor(ms / 60000);
    const rest = ms - m * 60000;
    return '[' + pad2(m) + ':' + pad2(Math.floor(rest / 1000)) + '.' + String(rest % 1000).padStart(3, '0') + ']';
  }

  // A word tag '<mm:ss.xx>' (milliseconds when needed, like stampTag).
  function tagText(seconds) { return '<' + stampTag(seconds).slice(1, -1) + '>'; }

  // Row text for the given fields (§4.9.2): stamps, then the text with marks inserted at their offsets, then '!' and
  // '|note'. Literal marks are escaped where they would be read as marks: / * | \ anywhere, a leading # or [, and a
  // final ! when impact is false. A single piece is written with a trailing '/', so it survives a round trip.
  function renderRow(fields) {
    const f = fields || {};
    const stamps = f.stamps || [];
    const text = String(f.text || '');
    let out = stamps.map(stampTag).join('');
    out += markedText(text, f.pieces || null, sortedRanges(f.emph), !!f.impact, stamps.length > 0, f.words || null);
    if (Array.isArray(f.pieces) && f.pieces.length === 1 && text) out += '/';
    if (f.impact) out += '!';
    if (f.note !== null && f.note !== undefined && f.note !== '') out += '|' + String(f.note).replace(/\\/g, '\\\\');
    return out;
  }

  function sortedRanges(list) {
    return (list || []).map((r) => [r[0], r[1]]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  }

  // Word tags are written at their offsets after the marks and before the character (a tag at the end before '!' and
  // '|'); a tag outside the text goes to the nearer end.
  function markedText(text, pieces, emph, impact, stamped, words) {
    const opens = new Map(), closes = new Map(), cuts = new Set(), tags = new Map();
    for (const [a, b] of emph) {
      opens.set(a, (opens.get(a) || 0) + 1);
      closes.set(b, (closes.get(b) || 0) + 1);
    }
    if (Array.isArray(pieces)) for (let k = 1; k < pieces.length; k++) cuts.add(pieces[k][0]);
    if (Array.isArray(words)) {
      for (const w of words) {
        const at = Math.min(Math.max(0, Math.trunc(Number(w[0])) || 0), text.length);
        tags.set(at, (tags.get(at) || '') + tagText(w[1]));
      }
    }
    let out = '';
    for (let i = 0; i <= text.length; i++) {
      out += '*'.repeat(closes.get(i) || 0);
      if (cuts.has(i)) out += text[i - 1] === ' ' ? '/ ' : '/';
      out += '*'.repeat(opens.get(i) || 0);
      if (tags.size) out += tags.get(i) || '';
      if (i < text.length) out += escapeChar(text, i, impact, stamped);
    }
    return out;
  }

  function escapeChar(text, i, impact, stamped) {
    const c = text[i];
    if (c === '/' || c === '*' || c === '|' || c === '\\') return '\\' + c;
    if (i === 0 && (c === '[' || (c === '#' && !stamped))) return '\\' + c;
    if (c === '!' && i === text.length - 1 && !impact) return '\\!';
    return c;
  }

  // Renders `parsed` with `fields` merged over it; ok when parsing the result gives back exactly the merged fields.
  // Word tags (DESIGN_2_2 §6) stay unless the text changes (then they are dropped, unless `fields` gives new ones), and
  // move with the first stamp when it changes (shiftWords).
  function roundTrip(parsed, fields) {
    const merged = {};
    for (const k of FIELD_KEYS) merged[k] = fields && fields[k] !== undefined ? fields[k] : parsed[k];
    if (!(fields && fields.words !== undefined)) {
      if (merged.text !== parsed.text) merged.words = null;
      else if (merged.words && (merged.stamps || []).length && (parsed.stamps || [])[0] !== merged.stamps[0]) {
        merged.words = shiftWords(parsed, merged.stamps[0]);
      }
    }
    const src = renderRow(merged);
    const again = parseRow(src);
    const ok = (again.kind === 'lyric' || again.kind === 'blank') && sameFields(again, merged);
    return { src, ok };
  }

  function sameFields(row, want) {
    return sameList(row.stamps, want.stamps || [])
      && row.text === String(want.text || '')
      && samePairs(row.pieces, want.pieces || null)
      && samePairs(row.emph, sortedRanges(want.emph))
      && row.impact === !!want.impact
      && row.note === (want.note === '' || want.note === undefined ? null : want.note)
      && samePairs(row.words && row.words.length ? row.words : null, want.words && want.words.length ? want.words : null);
  }

  // shiftWords(parsed, newFirstStamp) → the row's word tags moved by newFirstStamp − ref (ref = its first stamp, else
  // its first tag), so they keep their place in the line when its start is rewritten (≡ › 時刻を歌詞に書き込む).
  // null without tags; the tags as they are when newFirstStamp is not a time.
  function shiftWords(parsed, newFirstStamp) {
    const words = parsed && Array.isArray(parsed.words) && parsed.words.length ? parsed.words : null;
    if (!words) return null;
    if (typeof newFirstStamp !== 'number' || !Number.isFinite(newFirstStamp)) return words;
    const ref = parsed.stamps && parsed.stamps.length ? parsed.stamps[0] : words[0][1];
    const d = newFirstStamp - ref;
    if (d === 0) return words;
    return words.map(([at, t]) => [at, Math.max(0, Math.round((t + d) * 1000) / 1000)]);
  }

  function sameList(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  function samePairs(a, b) {
    if (a === null || b === null) return a === b;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
    return true;
  }

  // Plain text of a row (marks, stamps and escapes resolved); '' for blank, comment and meta rows.
  function PLAIN(src) { return parseRow(src).text; }

  // ---- samples -------------------------------------------------------------------------------------------------

  const SAMPLE_JA = [
    '[ti:紙ひこうきの朝]', '[ar:サンプル楽団]', '# Aメロ', '始発のホームに/白い息', '改札の向こうで/朝がほどける',
    'ポケットの*切符*を/そっと握って', 'まだ名前のない/今日へ行く', 'パンの匂いの/角を曲がれば', '電線の上で/ツバメが鳴いた',
    '小さな声で/Good morning', '窓に映った/寝ぐせの僕も', '悪くないねと/笑ってみせる', '', '# サビ',
    '飛ばせ/*紙ひこうき*/空の果てまで', '折り目の数だけ/強くなれる', '向かい風でも/かまわないさ', 'Hello/まだ見ぬ/青い空',
    '# Bメロ', '信号待ちの/交差点で', '昨日の*ため息*を/置いてきた', 'ビルの谷間に/光が落ちて', '影ぼうしが/背のびをする',
    '約束の丘へ/続く坂道|ひとりごと', '遠回りしても/たどり着ける', '# 大サビ', '飛ばせ/*紙ひこうき*/空の果てまで',
    'Fly high/どこまでも!', 'ほどけた靴ひもを/結び直して', '明日の僕へ/手紙を書こう', '始発のベルが/鳴り終わるまで',
  ].join('\n');

  const SAMPLE_EN = [
    '[ti:Paper Plane Morning]', '[ar:Sample Band]', '# Verse', 'The first train hums / along the platform',
    'My breath turns / into little clouds', 'I hold my *ticket* / close to my chest',
    'And walk into / a day without a name',
    '', '# Chorus', 'Fly, / *paper plane*, / to the edge of the sky', 'Every fold / makes you a little stronger',
    'Into the headwind / I don\'t mind', 'Hello, / sky I have never seen', '# Bridge',
    'Waiting at the crossing / for the green light', 'I left my *sighs* / on yesterday\'s street|to myself',
    'The long way round / still gets me there', '# Last chorus', 'Fly, / *paper plane*, / to the edge of the sky',
    'Fly high, / all the way!', 'I tie my loose laces / once again', 'And write a letter / to tomorrow\'s me',
  ].join('\n');

  // True when a row's src is a meta row (rule 3), whitespace around it ignored.
  function isMetaRow(src) { return META_ROW.test(String(src).trim()); }

  return {
    parseRow, parseSheet, linesOf, renderRow, roundTrip, lrcTag, PLAIN, SAMPLE_JA, SAMPLE_EN, META_ROW, isMetaRow,
    shiftWords, FIELD_KEYS,
  };
});
