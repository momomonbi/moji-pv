/* 文字PVメーカー v2 — original work. Subtitles from the plan's timing: SRT cues per sung line or cut, and timed lyrics (.lrc) (DESIGN_2_1 §13.8). */
MV.def('export/subtitles', ['core/lyrics', 'export/schedule'], (L, S) => {
  'use strict';

  const BOM = '\uFEFF';                // SRT files are written as UTF-8 with this BOM; srt() leaves it to the caller
  const CRLF = '\r\n';
  const MIN_CUE_MS = 100;              // a cue shorter than 0.1 s is dropped
  const PER = Object.freeze(['line', 'cut']);
  const BREAKS = /\r\n|[\r\n\u2028\u2029]/g;   // a cue's text is one line: a blank line would end the cue

  function argsError(message) { return new S.ExportError('args', 'subtitles: ' + message); }

  // Seconds → whole microseconds. Every time is quantized here first, so the rounding below is exact and cannot tip over
  // on binary noise (0.1 + 0.2, or a t0 subtracted from a line time).
  function micros(s) { return Math.round(s * 1e6); }

  // Microseconds → milliseconds, halves rounded up.
  function millis(us) { return Math.floor((us + 500) / 1000); }

  function pad(n, width) { return String(n).padStart(width, '0'); }

  // 'HH:MM:SS,mmm' (hours keep more digits past 99).
  function srtTime(ms) {
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return pad(h, 2) + ':' + pad(m, 2) + ':' + pad(s, 2) + ',' + pad(ms % 1000, 3);
  }

  function cueText(text) { return String(text === null || text === undefined ? '' : text).replace(BREAKS, ' ').trim(); }

  function finite(v, what) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw argsError(what + ' must be a number');
    return v;
  }

  // The timed items of the plan: its sung lines, or the cuts of sung lines (title, intro, gap and outro cuts have no line).
  function itemsOf(plan, per) {
    if (per === 'cut') return (plan.cuts || []).filter((c) => c.line);
    return plan.lines || [];
  }

  // srt(plan, { t0 = 0, t1 = plan.duration, per = 'line' | 'cut' }) → the SubRip text (CRLF line endings, no BOM).
  // One cue per sung line (or cut) that overlaps [t0, t1), in time order, with times relative to t0:
  //   start = max(0, item.t0 − t0), end = min(item.t1, t1) − t0, both rounded to ms (halves up);
  //   a cue ending after the next cue's start is cut back to it; then cues shorter than 0.1 s are dropped (measured
  //   on the written milliseconds, so what a player shows is what was checked).
  // Items whose text is empty are left out before that. Each cue: its number, 'HH:MM:SS,mmm --> HH:MM:SS,mmm', the
  // plain text (marks are already removed in the plan) on one line, then an empty line. No cues gives ''.
  function srt(plan, opts) {
    const o = opts || {};
    const per = o.per === undefined ? 'line' : o.per;
    if (!PER.includes(per)) throw argsError("per is 'line' or 'cut'");
    const T0 = micros(finite(o.t0 === undefined ? 0 : o.t0, 't0'));
    const T1 = micros(finite(o.t1 === undefined ? plan.duration : o.t1, 't1'));
    const cues = [];
    for (const item of itemsOf(plan, per)) {
      const a = micros(item.t0), b = micros(item.t1);
      const text = cueText(item.text);
      if (!(a < T1 && b > T0) || !text) continue;
      cues.push({ start: millis(Math.max(0, a - T0)), end: millis(Math.min(b, T1) - T0), text });
    }
    cues.sort((x, y) => x.start - y.start);               // stable: equal starts keep the plan's order
    for (let i = 0; i + 1 < cues.length; i++) cues[i].end = Math.min(cues[i].end, cues[i + 1].start);
    let out = '';
    let n = 0;
    for (const c of cues) {
      if (c.end - c.start < MIN_CUE_MS) continue;
      n++;
      out += n + CRLF + srtTime(c.start) + ' --> ' + srtTime(c.end) + CRLF + c.text + CRLF + CRLF;
    }
    return out;
  }

  // lrc(plan, doc) → 時間つき歌詞 (.lrc), row by row in sheet order: a meta row as written (trimmed); a lyric row as the
  // start of every sung occurrence ([mm:ss.xx], ascending) and the first occurrence's text. Rows the plan did not
  // time are left out; LF line endings; plan null gives the meta rows only. The same bytes as ui/project_io's lrcText
  // before it moved here.
  function lrc(plan, doc) {
    const byRow = new Map();
    for (const l of plan ? plan.lines : []) {
      const row = l.row || l.id;
      if (!byRow.has(row)) byRow.set(row, []);
      byRow.get(row).push(l);
    }
    const out = [];
    for (const row of doc.sheet.rows) {
      if (L.isMetaRow(row.src)) { out.push(row.src.trim()); continue; }
      const lines = byRow.get(row.id);
      if (!lines) continue;
      const tags = lines.map((l) => l.t0).sort((a, b) => a - b).map(L.lrcTag).join('');
      out.push(tags + lines[0].text);
    }
    return out.join('\n') + '\n';
  }

  return { BOM, srt, lrc };
});
