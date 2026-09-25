/* 文字PVメーカー v2 — original work. Lyric rows in and out for the AI tools: parsed views, checked rendering, row edits (DESIGN §4.22.2). */
MV.def('ai/lyricio', ['core/lyrics', 'ai/providers'], (L, PR) => {
  'use strict';

  const KANA = /[ぁ-ゖゝ-ゟァ-ヺー-ヿ]/;
  const SYNTAX_CHARS = /[\r\n|/*]/;

  function sheetHint(rows) { return rows.some((r) => KANA.test(r.src)) ? 'ja' : null; }

  // One view per row of the lyric box. Lyric rows (rows that are sung lines) carry the parsed fields; `count` is the
  // number of times the row is sung (one per LRC stamp, at least one). Other rows have lyric: false and count 0.
  // only: a Set of row ids to view (in sheet order), so an edit of a few rows does not parse the whole sheet.
  function rowsView(doc, only) {
    const rows = doc.sheet.rows;
    const hint = sheetHint(rows);
    const out = [];
    for (const r of rows) if (!only || only.has(r.id)) out.push(viewOf(r, L.parseRow(r.src, hint)));
    return out;
  }

  function viewOf(row, p) {
    const lyric = p.kind === 'lyric' && p.text !== '';
    return {
      rowId: row.id, src: row.src, kind: p.kind, lyric, count: lyric ? Math.max(1, p.stamps.length) : 0,
      stamps: p.stamps.slice(), text: p.text, pieces: p.pieces ? p.pieces.map((x) => x.slice()) : null,
      emph: p.emph.map((x) => x.slice()), impact: p.impact, note: p.note,
    };
  }

  // Renders a lyric row with new mark fields (pieces, emph, impact, note) and checks that parsing the result gives
  // exactly those fields back. The words and the stamps never change: whatever the lyric syntax cannot express fails
  // here, and the caller drops that change instead of altering the lyrics.
  function renderChecked(row, fields) {
    if (!row || !row.lyric) return { src: row ? row.src : '', ok: false };
    const f = fields || {};
    const merged = {
      stamps: row.stamps, text: row.text,
      pieces: f.pieces !== undefined ? f.pieces : row.pieces,
      emph: f.emph !== undefined ? f.emph : row.emph,
      impact: f.impact !== undefined ? !!f.impact : row.impact,
      note: f.note !== undefined ? f.note : row.note,
    };
    if (merged.note !== null && merged.note !== undefined && SYNTAX_CHARS.test(String(merged.note))) {
      return { src: row.src, ok: false };
    }
    const out = L.roundTrip(row, merged);
    if (/[\r\n]/.test(out.src)) return { src: out.src, ok: false };
    const again = L.parseRow(out.src);
    return { src: out.src, ok: out.ok && again.kind === 'lyric' && again.text === row.text };
  }

  function isBlank(src) { return String(src).trim() === ''; }

  // edits: { [rowId]: { remove: true } | { fields } } → { text, skipped: rowId[] } (the new lyric box text).
  // A field edit that fails renderChecked keeps the row as it is and is listed in `skipped`. Blank rows around removed
  // rows are squeezed: never two in a row there, and none left at the start or the end; other blank rows stay as
  // written. The caller dispatches lyrics.set(text): ids survive through reconcile, so per-line settings follow.
  function editRows(doc, edits) {
    const view = rowsView(doc);
    const out = [];
    const skipped = [];
    let blanks = [];
    let sawRemoved = false;
    const flush = (atEnd) => {
      let keep = blanks;
      if (sawRemoved && keep.length) keep = out.length === 0 || atEnd ? [] : keep.slice(0, 1);
      out.push(...keep);
      blanks = [];
    };
    for (const row of view) {
      const e = edits && edits[row.rowId];
      if (e && e.remove) { sawRemoved = true; continue; }
      if (isBlank(row.src)) { blanks.push(row.src); continue; }
      flush(false);
      sawRemoved = false;
      out.push(editedSrc(row, e, skipped));
    }
    flush(true);
    for (const src of out) {
      if (/[\r\n]/.test(src)) throw new PR.AIError('bad_edit', 'an edited row would span several lines');
    }
    return { text: out.join('\n'), skipped };
  }

  function editedSrc(row, e, skipped) {
    if (!e || !e.fields) return row.src;
    const res = renderChecked(row, e.fields);
    if (res.ok) return res.src;
    skipped.push(row.rowId);
    return row.src;
  }

  // The row's current view by id, or null.
  function rowById(doc, rowId) {
    return rowsView(doc, new Set([rowId]))[0] || null;
  }

  // The whole lyric box text.
  function sheetText(doc) { return doc.sheet.rows.map((r) => r.src).join('\n'); }

  // Piece texts of a row view ([text] when there is no '/').
  function pieceTexts(row) {
    return (row.pieces || [[0, row.text.length]]).map(([a, b]) => row.text.slice(a, b));
  }

  // Where `word` first lies inside one piece of the row's text → { range, free }, or null when it is in no piece.
  // `free` is false when every such place overlaps a `taken` range (the word is already (part of) an emphasis).
  function findWord(text, pieces, word, taken) {
    const list = pieces || [[0, text.length]];
    let first = null;
    for (let at = word ? text.indexOf(word) : -1; at >= 0; at = text.indexOf(word, at + 1)) {
      const r = [at, at + word.length];
      if (!list.some(([a, b]) => r[0] >= a && r[1] <= b)) continue;
      if (!first) first = r;
      if (!(taken || []).some(([a, b]) => r[0] < b && a < r[1])) return { range: r, free: true };
    }
    return first ? { range: first, free: false } : null;
  }

  return { SYNTAX_CHARS, rowsView, renderChecked, editRows, rowById, sheetText, pieceTexts, findWord };
});
