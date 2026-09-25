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
  const FIELD_KEYS = ['stamps', 'text', 'pieces', 'emph', 'impact', 'note'];

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
    return makeRow('lyric', Object.assign(scanText(rest.replace(WORD_TAG, '')), { stamps, hint }));
  }

  function makeRow(kind, f) {
    const text = f.text || '';
    return {
      kind, stamps: f.stamps || [], text, pieces: f.pieces || null, emph: f.emph || [], impact: !!f.impact,
      note: f.note === undefined ? null : f.note, heading: f.heading === undefined ? null : f.heading,
      script: S.lineScript(text, f.hint), tag: f.tag || null, value: f.value === undefined ? null : f.value,
    };
  }

  // '[mm:ss.xx]' parts → seconds; the fraction is read as decimal digits so 41.20 gives exactly 41.2.
  function stampSeconds(m) {
    const whole = Number(m[1]) * 60 + Number(m[2]);
    return Number(whole + '.' + (m[3] || '0'));
  }

  // Splits text into single UTF-16 units; `mark[i]` is true for an unescaped / * | ! (the only marks inside a line).
  function tokenize(rest) {
    const chars = [], mark = [];
    for (let i = 0; i < rest.length; i++) {
      const c = rest[i];
      if (c === '\\' && i + 1 < rest.length && ESCAPABLE.includes(rest[i + 1])) {
        chars.push(rest[++i]);
        mark.push(false);
      } else {
        chars.push(c);
        mark.push(c === '/' || c === '*' || c === '|' || c === '!');
      }
    }
    return { chars, mark };
  }

  function isSpaceToken(tok, i) { return !tok.mark[i] && SPACE.test(tok.chars[i]); }

  // Rules 5–9 of §4.9.1 on the text after the stamps.
  function scanText(rest) {
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
    return Object.assign(trimAndSnap(body), { impact, note });
  }

  // Builds plain text, piece boundaries and emphasis ranges from tokens [lo, hi).
  function build(tok, lo, hi) {
    let stars = 0;
    for (let i = lo; i < hi; i++) if (tok.mark[i] && tok.chars[i] === '*') stars++;
    let starsLeft = stars - (stars % 2);            // an unmatched final '*' is literal
    const out = [];
    const cuts = [0];
    const emph = [];
    let open = -1, slashes = 0;
    for (let i = lo; i < hi; i++) {
      const c = tok.chars[i];
      if (!tok.mark[i] || c === '!' || (c === '*' && starsLeft === 0)) { out.push(c); continue; }
      if (c === '*') {
        starsLeft--;
        if (open < 0) open = out.length;
        else { if (out.length > open) emph.push([open, out.length]); open = -1; }
        continue;
      }
      slashes++;
      i = pieceBreak(tok, i, hi, out, cuts, emph);
      if (open > out.length) open = out.length;
    }
    return { text: out.join(''), cuts, emph, slashes };
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

  // Trims whitespace at both ends, shifts ranges, widens them to grapheme boundaries and drops empty pieces.
  function trimAndSnap(body) {
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
    return { text, pieces, emph };
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

  function makeLine(row, occ, stamp, pauseBefore, heading, lang) {
    return {
      id: occ === 0 ? row.id : row.id + '.' + occ, row: row.id, occ, index: -1,
      text: row.text, pieces: row.pieces, emph: row.emph, impact: row.impact, note: row.note, lang,
      stamp, pauseBefore, heading,
    };
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

  // Row text for the given fields (§4.9.2): stamps, then the text with marks inserted at their offsets, then '!' and
  // '|note'. Literal marks are escaped where they would be read as marks: / * | \ anywhere, a leading # or [, and a
  // final ! when impact is false. A single piece is written with a trailing '/', so it survives a round trip.
  function renderRow(fields) {
    const f = fields || {};
    const stamps = f.stamps || [];
    const text = String(f.text || '');
    let out = stamps.map(stampTag).join('');
    out += markedText(text, f.pieces || null, sortedRanges(f.emph), !!f.impact, stamps.length > 0);
    if (Array.isArray(f.pieces) && f.pieces.length === 1 && text) out += '/';
    if (f.impact) out += '!';
    if (f.note !== null && f.note !== undefined && f.note !== '') out += '|' + String(f.note).replace(/\\/g, '\\\\');
    return out;
  }

  function sortedRanges(list) {
    return (list || []).map((r) => [r[0], r[1]]).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  }

  function markedText(text, pieces, emph, impact, stamped) {
    const opens = new Map(), closes = new Map(), cuts = new Set();
    for (const [a, b] of emph) {
      opens.set(a, (opens.get(a) || 0) + 1);
      closes.set(b, (closes.get(b) || 0) + 1);
    }
    if (Array.isArray(pieces)) for (let k = 1; k < pieces.length; k++) cuts.add(pieces[k][0]);
    let out = '';
    for (let i = 0; i <= text.length; i++) {
      out += '*'.repeat(closes.get(i) || 0);
      if (cuts.has(i)) out += text[i - 1] === ' ' ? '/ ' : '/';
      out += '*'.repeat(opens.get(i) || 0);
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
  function roundTrip(parsed, fields) {
    const merged = {};
    for (const k of FIELD_KEYS) merged[k] = fields && fields[k] !== undefined ? fields[k] : parsed[k];
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
      && row.note === (want.note === '' || want.note === undefined ? null : want.note);
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

  return { parseRow, parseSheet, linesOf, renderRow, roundTrip, lrcTag, PLAIN, SAMPLE_JA, SAMPLE_EN, META_ROW, isMetaRow };
});
