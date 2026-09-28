/* 文字PVメーカー v2 — original work. 読み切れない速さの行を知らせる: the switch, the too-fast notices and the texts of a line's warnings for the gutter, the 行 list, the timeline and the 行 page (PV22 S4, DESIGN_2_2 §5). */
MV.def('ui/readcheck', ['planner/readable', 'planner/rules'], (RD, RULES) => {
  'use strict';

  // The warnings the lyric editor's gutter marks in every work (DESIGN §6.4.14); with the notices on it also marks the
  // too-fast lines and every line of a squeezed range.
  const BASE_CODES = Object.freeze(['overfull', 'orphan-pin', 'shadowed-pin', 'lock-partial', 'pin-not-applicable', 'time-order']);
  const NOTICE_CODES = Object.freeze(['too-fast', 'time-compressed', 'piece-merged']);
  // A line's mark shows its most severe warning first.
  const PRIORITY = Object.freeze(['time-order', 'overfull', 'lock-partial', 'orphan-pin', 'shadowed-pin', 'pin-not-applicable',
    'too-fast', 'time-compressed', 'piece-merged']);

  // On when the work says so (timing.readCheck, the switch), else for the new-work generation (look.gen, DESIGN_2_2 §0).
  function enabled(doc) {
    const timing = doc && doc.timing;
    if (timing && typeof timing.readCheck === 'boolean') return timing.readCheck;
    return !!doc && RULES.gen(doc) >= 1;
  }

  // The too-fast notices of a plan ([] when the notices are off): UI-computed, never in plan.warnings or the plan hash.
  function readWarnings(doc, plan, registry) {
    if (!enabled(doc) || !plan) return [];
    return RD.check(plan, registry).map((x) => ({ code: 'too-fast', line: x.line, cut: x.cut,
      detail: { rate: x.rate, units: x.units, legible: x.legible, limit: x.limit } }));
  }

  // A time-compressed warning names the first line of its range and how many lines it has (core/timing): repeated for
  // every line of the range, the later ones with detail.of = the first line.
  function expand(warnings, plan) {
    const lines = plan && Array.isArray(plan.lines) ? plan.lines : [];
    const out = [];
    for (const w of warnings) {
      out.push(w);
      if (!w || w.code !== 'time-compressed' || !w.line || !w.detail || !(w.detail.lines > 1)) continue;
      const at = lines.findIndex((l) => l.id === w.line);
      if (at < 0) continue;
      for (let k = 1; k < w.detail.lines && at + k < lines.length; k++) {
        out.push(Object.assign({}, w, { line: lines[at + k].id, detail: Object.assign({}, w.detail, { of: w.line }) }));
      }
    }
    return out;
  }

  function gutterCodes(doc) { return new Set(enabled(doc) ? BASE_CODES.concat(NOTICE_CODES) : BASE_CODES); }

  function rank(code) {
    const i = PRIORITY.indexOf(code);
    return i < 0 ? PRIORITY.length : i;
  }

  // byLine(warnings, plan, codes) → Map<lineId, Warning[]>: the warnings of each line of the plan whose code is in
  // `codes` (a Set; null = every code), one per code (for too-fast the fastest cut), most severe first.
  function byLine(warnings, plan, codes) {
    const known = plan && Array.isArray(plan.lines) ? new Set(plan.lines.map((l) => l.id)) : null;
    const map = new Map();
    for (const w of warnings || []) {
      if (!w || !w.line || (codes && !codes.has(w.code)) || (known && !known.has(w.line))) continue;
      let list = map.get(w.line);
      if (!list) { list = []; map.set(w.line, list); }
      const i = list.findIndex((x) => x.code === w.code);
      if (i < 0) list.push(w);
      else if (w.code === 'too-fast' && w.detail && list[i].detail && w.detail.rate > list[i].detail.rate) list[i] = w;
    }
    for (const list of map.values()) list.sort((a, b) => rank(a.code) - rank(b.code));
    return map;
  }

  // The text of one warning: the too-fast rate, a squeezed range's size on its first line, else warn.<code>.
  function textOf(t, w) {
    const d = w.detail || {};
    if (w.code === 'too-fast') return t('warn.too-fast.n', { n: Math.round(d.rate) });
    if (w.code === 'time-compressed' && d.lines > 0 && !d.of) return t('warn.time-compressed.n', { n: d.lines });
    const key = 'warn.' + w.code;
    return t.has && !t.has(key) ? w.code : t(key);
  }

  // A tooltip for one line's warnings: one text per row, each once.
  function titleFor(t, warnings) {
    return [...new Set((warnings || []).map((w) => textOf(t, w)))].join('\n');
  }

  // --- the 行 page's quick fixes -------------------------------------------------------------------------------------

  // The fastest too-fast notice of a line, or null.
  function worstOf(warnings, lineId) {
    let worst = null;
    for (const w of warnings || []) {
      if (w && w.code === 'too-fast' && w.line === lineId && w.detail && (!worst || w.detail.rate > worst.detail.rate)) worst = w;
    }
    return worst;
  }

  // [動きを速くする]: the line's entrance and exit made quick with the shared motion parameters at line scope (they apply
  // to every piece of the line and to whatever part is chosen), by 'user'.
  const QUICK = Object.freeze({ 'arrive.dur': 0.2, 'arrive.each': 0.01, 'depart.dur': 0.15, 'depart.each': 0 });
  function quickerCmds(lineId) {
    return Object.keys(QUICK).map((slot) => ({ t: 'pin.set', path: 'line/' + lineId + ':' + slot, v: QUICK[slot], by: 'user' }));
  }

  // [終わりを延ばす]: a later end for a too-fast line whose last cut is followed by a gap, an interlude or the outro (or
  // by nothing), not by another line. It aims at the time the rate limit (or the legible floor) needs, with some room,
  // and stays 0.3 s before the next line and 0.5 s before the end. null when that gains less than 0.05 s.
  const END_ROOM = Object.freeze({ NEXT: 0.3, END: 0.5, FACTOR: 1.25, MIN_GAIN: 0.05 });
  function endFix(plan, lineId, w) {
    const lines = plan && Array.isArray(plan.lines) ? plan.lines : [];
    const i = lines.findIndex((l) => l.id === lineId);
    if (i < 0 || !w || !w.detail || !lines[i].cuts.length) return null;
    const line = lines[i];
    const lastKey = line.cuts[line.cuts.length - 1];
    const at = plan.cuts.findIndex((c) => c.key === lastKey);
    const after = at >= 0 ? plan.cuts[at + 1] : null;
    if (at < 0 || (after && after.line)) return null;
    const d = w.detail;
    const need = Math.max(d.units / d.limit, RD.READ.MIN_LEGIBLE);
    const next = lines[i + 1];
    const v = Math.min(next ? next.t0 - END_ROOM.NEXT : Infinity, plan.duration - END_ROOM.END,
      line.t1 + END_ROOM.FACTOR * (need - d.legible));
    const r = Math.floor(v * 100) / 100;
    return r - line.t1 >= END_ROOM.MIN_GAIN - 1e-9 ? r : null;
  }

  return { BASE_CODES, NOTICE_CODES, PRIORITY, QUICK, END_ROOM, enabled, readWarnings, expand, gutterCodes, byLine, textOf,
    titleFor, worstOf, quickerCmds, endFix };
});
