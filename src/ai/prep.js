/* 文字PVメーカー v2 — original work. 歌詞の下ごしらえ: removals, cut points, emphasis and readings suggested per lyric row (DESIGN §4.22.4). */
MV.def('ai/prep', ['core/pins', 'ai/lyricio', 'ai/changes'], (PINS, IO, CH) => {
  'use strict';

  const MAX_EMPHASIS = 3;
  const MAX_READING = 40;
  const MAX_REASON = 120;
  const MAX_SUMMARY = 300;
  const SPACE = /\s/;

  const SCHEMA = Object.freeze({
    type: 'object', additionalProperties: false, required: ['summary', 'lines'],
    properties: {
      summary: { type: 'string' },
      lines: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['i', 'remove', 'reason', 'segments', 'emphasis', 'reading'],
          properties: {
            i: { type: 'integer' }, remove: { type: 'boolean' }, reason: { type: 'string' },
            segments: { type: 'array', items: { type: 'string' } }, emphasis: { type: 'array', items: { type: 'string' } },
            reading: { type: 'string' },
          },
        },
      },
    },
  });

  function outLang(lang) { return lang === 'en' ? 'English' : 'Japanese'; }

  // The lyric rows in order, numbered 0..n (the number the AI answers with → rowId).
  function numberedRows(doc) {
    return IO.rowsView(doc).filter((r) => r.lyric).map((r, i) => Object.assign({ i }, r));
  }

  // → { system, prompt, schema, effort: 'low', lines: [{ i, rowId, text }] }. Only lyric text is sent.
  function request(doc, uiLang) {
    const lines = numberedRows(doc).map((r) => ({ i: r.i, rowId: r.rowId, text: r.text }));
    const system = [
      'You prepare song lyrics for a lyric-motion video (文字PV) tool. Each lyric line becomes on-screen text, cut into short phrases.',
      'For each line decide only these four things. Never change, add or reorder the words themselves.',
      '1. remove: true for lines that are not sung lyrics: section labels ([Verse], 【サビ】, 1番), credits (作詞・作曲・編曲・歌), '
        + 'repeat marks (×2, 繰り返し), website text (歌詞をコピー, シェア), chord names, URLs. Give a short reason.',
      '2. segments: where the line should be cut into on-screen phrases. List the pieces in order; joined together they must '
        + 'equal the line exactly (spaces aside). Cut at natural phrase boundaries (文節), 2-4 pieces for long lines, none '
        + '(empty list) for short lines.',
      '3. emphasis: at most one or two key words per line that carry the meaning or the hook (copied exactly from the line). '
        + 'Most lines need none.',
      '4. reading: a hiragana reading only where the lyrics give a word an unusual reading (当て字, e.g. 本気→まじ, 運命→さだめ). '
        + 'Otherwise an empty string.',
      'Return only lines that need at least one change. Keep "reason" and "summary" short and write them in ' + outLang(uiLang) + '.',
    ].join('\n');
    const prompt = 'Lyrics (line number: text):\n' + lines.map((l) => l.i + ': ' + l.text).join('\n');
    return { system, prompt, schema: SCHEMA, effort: 'low', lines };
  }

  // segments → pieces [[a, b], …] of `text`, or null when they do not join to the text (spaces aside). A space between
  // two segments stays at the end of the earlier piece, as the '/' mark keeps it.
  function piecesOf(text, segs) {
    const starts = [0];
    let pos = 0;
    for (let k = 0; k < segs.length; k++) {
      for (const ch of segs[k]) {
        if (SPACE.test(ch)) continue;
        while (pos < text.length && SPACE.test(text[pos])) pos++;
        if (text.slice(pos, pos + ch.length) !== ch) return null;
        pos += ch.length;
      }
      while (pos < text.length && SPACE.test(text[pos])) pos++;
      if (k < segs.length - 1) {
        if (pos <= starts[starts.length - 1] || pos >= text.length) return null;
        starts.push(pos);
      }
    }
    if (pos !== text.length) return null;
    return starts.map((a, k) => [a, k + 1 < starts.length ? starts[k + 1] : text.length]);
  }

  function cleanList(list, max) {
    return (Array.isArray(list) ? list : []).map((s) => String(s).trim()).filter(Boolean).slice(0, max);
  }

  // The split pin that beats this row's '/' marks on every line it is sung as (§3.5: a `line/<id>:split` pin wins over
  // the marks; lock.set writes one for every locked line), or null when the marks decide for at least one line.
  function splitPin(ix, row) {
    let pin = null;
    for (let k = 0; k < Math.max(1, row.count); k++) {
      const hit = PINS.lookup(ix, { cutKey: null, pinCutKey: null, lineId: k ? row.rowId + '.' + k : row.rowId }, 'split');
      if (!hit) return null;
      pin = pin || hit;
    }
    return pin;
  }

  // Changes for one answered row; warnings are pushed as [stringKey, params].
  function rowChanges(ctx, row, a, warn) {
    const { doc, opts } = ctx;
    const n = row.i + 1;
    const reason = String(a.reason || '').slice(0, MAX_REASON);
    const common = { scope: 'rows', rowId: row.rowId, n };
    if (a.remove === true) {
      return [CH.make(doc, Object.assign({ id: 'remove:' + row.rowId, kind: 'remove', from: row.src, to: null, reason,
        diff: { before: row.src, after: null }, label: ['ai.ch.remove', { n, text: row.text }] }, common), opts)];
    }
    const out = [];
    let pieces = row.pieces;
    const segs = cleanList(a.segments, Infinity);
    if (segs.length >= 2) {
      const next = segs.some((s) => IO.SYNTAX_CHARS.test(s)) ? null : piecesOf(row.text, segs);
      const changed = !!next && JSON.stringify(next) !== JSON.stringify(row.pieces);
      // with a split pin, new marks would change the text but not the cuts on screen
      const pinned = changed ? splitPin(ctx.ix, row) : null;
      if (!next) warn(['ai.warn.cutMismatch', { n }]);
      else if (pinned) warn(pinned.by === 'lock' ? ['ai.warn.locked', { n }] : ['ai.warn.splitPinned', { n }]);
      else if (IO.renderChecked(row, { pieces: next }).ok) {
        pieces = next;
        const text = next.map(([x, y]) => row.text.slice(x, y).trim()).join('/');
        if (changed) {
          out.push(Object.assign({ id: 'cut:' + row.rowId, kind: 'cut', from: row.pieces, to: next,
            label: ['ai.ch.cut', { n, text }] }, common));
        }
      } else warn(['ai.warn.cannotWrite', { n }]);
    }
    const taken = row.emph.slice();
    for (const word of cleanList(a.emphasis, MAX_EMPHASIS)) {
      const hit = IO.SYNTAX_CHARS.test(word) ? null : IO.findWord(row.text, pieces, word, taken);
      if (!hit) { warn(['ai.warn.emphasisNotFound', { n, word }]); continue; }
      if (!hit.free) continue;                                   // already (part of) an emphasis
      taken.push(hit.range);
      out.push(Object.assign({ id: 'emphasis:' + row.rowId + ':' + hit.range.join('-'), kind: 'emphasis', from: null,
        to: hit.range, word, label: ['ai.ch.emphasis', { n, word }] }, common));
    }
    const reading = String(a.reading || '').trim();
    if (reading && row.note === null && reading.length <= MAX_READING && reading !== row.text && !IO.SYNTAX_CHARS.test(reading)) {
      out.push(Object.assign({ id: 'note:' + row.rowId, kind: 'note', from: row.note, to: reading,
        label: ['ai.ch.note', { n, note: reading }] }, common));
    }
    return checkedTogether(doc, row, out, warn, opts, reason);
  }

  // All of a row's changes must render together without altering the words; each carries the combined diff.
  function checkedTogether(doc, row, list, warn, opts, reason) {
    if (!list.length) return [];
    const fields = { pieces: row.pieces, emph: row.emph.slice(), impact: row.impact, note: row.note };
    for (const c of list) {
      if (c.kind === 'cut') fields.pieces = c.to;
      else if (c.kind === 'note') fields.note = c.to;
      else fields.emph.push(c.to);
    }
    const res = IO.renderChecked(row, fields);
    if (!res.ok) { warn(['ai.warn.cannotWrite', { n: row.i + 1 }]); return []; }
    if (res.src === row.src) return [];
    return list.map((c) => CH.make(doc, Object.assign(c, { reason, diff: { before: row.src, after: res.src } }), opts));
  }

  // The row an answer's `i` means. With the request's own numbering (opts.lines = request().lines) it goes through
  // the row id, and a row whose words changed since the request is skipped; without it, i is the position among the
  // lyric rows of `doc`.
  function rowFor(ctx, i, warn) {
    if (!ctx.sent) {
      const row = ctx.rows[i];
      if (!row) warn(['ai.warn.notLine', { n: i + 1 }]);
      return row || null;
    }
    const sent = i >= 0 ? ctx.sent[i] : null;
    if (!sent) { warn(['ai.warn.notLine', { n: i + 1 }]); return null; }
    const row = ctx.byId.get(sent.rowId);
    if (!row || row.text !== sent.text) { warn(['ai.warn.changedSince', { n: i + 1 }]); return null; }
    return Object.assign({}, row, { i });
  }

  // Validates the answer → { summary, changes, warnings } (only real changes, in row order). Validate against the
  // document the request was built from, so that `base` is what was sent; markStale then compares with the current
  // one. opts = { rev, lines } (lines: the request's i → rowId list).
  function changes(doc, json, opts) {
    const o = opts || {};
    const rows = numberedRows(doc);
    const ctx = {
      doc, rows, ix: PINS.index(doc.pins), sent: Array.isArray(o.lines) ? o.lines : null,
      byId: new Map(rows.map((r) => [r.rowId, r])), opts: { rev: o.rev, srcs: CH.rowSrcs(doc) },
    };
    const warnings = [];
    const warn = (w) => { warnings.push(w); };
    const out = [];
    const seen = new Set();
    const answers = json && Array.isArray(json.lines) ? json.lines : [];
    for (const a of answers) {
      const i = a && Number.isInteger(a.i) ? a.i : -1;
      if (seen.has(i)) continue;
      const row = rowFor(ctx, i, warn);
      if (!row) continue;
      seen.add(i);
      out.push(...rowChanges(ctx, row, a, warn));
    }
    const order = new Map(rows.map((r, k) => [r.rowId, k]));
    out.sort((x, y) => order.get(x.rowId) - order.get(y.rowId));
    return { summary: String((json && json.summary) || '').slice(0, MAX_SUMMARY), changes: out, warnings };
  }

  return { SCHEMA, request, changes, piecesOf };
});
