/* 文字PVメーカー v2 — original work. Areas (区画): song sections, lyric headings, blocks, line sets, cuts and the whole video (DESIGN_2_1 §3.8, §5.1). */
MV.def('planner/areas', ['core/paths', 'core/lyrics', 'planner/features'], (P, LY, FE) => {
  'use strict';

  // An area names a part of the video by what the user sees: a song section of the AI analysis (サビ1), all sections of
  // one kind, a '# heading' block, a blank-line block, a set of lines, one cut, or everything. Areas are derived from
  // (doc, plan) and never saved; an AreaRef is small and stable, and `resolve` turns it back into lines, cuts and pin
  // scopes (null once the area is gone, which is how stale AI changes are found).
  //
  // AreaRef = { kind: 'work' } | { kind: 'song', n, t0, t1 } | { kind: 'songKind', of } | { kind: 'head', rowId }
  //         | { kind: 'para', rowId } | { kind: 'lines', ids } | { kind: 'cut', key }

  const AREA_KINDS = Object.freeze(['work', 'song', 'songKind', 'head', 'para', 'lines', 'cut']);

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  // --- the index of one (doc, plan) --------------------------------------------------------------------------------

  const memo = new WeakMap();

  // Everything the areas need, made once per plan (and sheet rows and song analysis).
  function indexOf(doc, plan) {
    const rows = doc && doc.sheet && Array.isArray(doc.sheet.rows) ? doc.sheet.rows : [];
    const info = doc && doc.song && doc.song.info ? doc.song.info : null;
    const hit = memo.get(plan);
    if (hit && hit.rows === rows && hit.info === info) return hit;
    const lines = Array.isArray(plan.lines) ? plan.lines : [];
    const cuts = Array.isArray(plan.cuts) ? plan.cuts : [];
    const lineById = new Map(lines.map((l) => [l.id, l]));
    const cutsOfLine = new Map();
    const cutByKey = new Map();
    const special = [];
    for (const c of cuts) {
      cutByKey.set(c.key, c);
      if (!c.line) { special.push(c); continue; }
      if (cutsOfLine.has(c.line)) cutsOfLine.get(c.line).push(c.key); else cutsOfLine.set(c.line, [c.key]);
    }
    const ix = { rows, info, plan, lines, lineById, cutsOfLine, cutByKey, special, duration: isNumber(plan.duration) ? plan.duration : 0 };
    ix.sections = songSections(info, lines, special);
    Object.assign(ix, rowGroups(rows, lines));
    memo.set(plan, ix);
    return ix;
  }

  // Song sections of doc.song.info in list order ({ n, kind, start, end, ordinal, lineIds, specialKeys }). A line or
  // special cut belongs to the first section (in list order) whose [start, end) holds its t0: the rule of
  // planner/features.songSection, so a line's area and its feat.section always agree.
  function songSections(info, lines, special) {
    const list = info && Array.isArray(info.sections) ? info.sections : [];
    const out = [];
    list.forEach((s, n) => {
      if (isObject(s) && isNumber(s.start) && isNumber(s.end) && s.start < s.end && typeof s.kind === 'string') {
        out.push({ n, kind: s.kind, start: s.start, end: s.end, ordinal: 0, lineIds: [], specialKeys: [] });
      }
    });
    const first = (t) => out.find((s) => t >= s.start && t < s.end) || null;
    for (const line of lines) { const s = first(line.t0); if (s) s.lineIds.push(line.id); }
    for (const c of special) { const s = first(c.t0); if (s) s.specialKeys.push(c.key); }
    const byTime = out.slice().sort((a, b) => a.start - b.start || a.n - b.n);
    const count = new Map();
    for (const s of byTime) { count.set(s.kind, (count.get(s.kind) || 0) + 1); s.ordinal = count.get(s.kind); }
    return out;
  }

  // Heading blocks (lines whose row lies after a '# heading' row and before the next heading row) and blank-line
  // blocks (a new block starts at a line with pauseBefore > 0), both in sheet order, with every occurrence of a row.
  function rowGroups(rows, lines) {
    const sheet = LY.parseSheet(rows);
    const headOfRow = new Map();
    const heads = [];
    let current = null;
    for (const row of sheet.rows) {
      if (row.kind === 'comment' && row.heading) {
        current = { rowId: row.id, text: row.heading, lineIds: [] };
        heads.push(current);
      } else if (row.kind === 'lyric' && row.text !== '' && current) headOfRow.set(row.id, current);
    }
    const paraOfRow = new Map();
    const paras = [];
    for (const line of LY.linesOf(sheet).filter((l) => l.occ === 0)) {
      if (!paras.length || line.pauseBefore > 0) paras.push({ rowId: line.row, n: paras.length + 1, lineIds: [] });
      paraOfRow.set(line.row, paras[paras.length - 1]);
    }
    for (const line of lines) {
      const h = headOfRow.get(line.row);
      if (h) h.lineIds.push(line.id);
      const p = paraOfRow.get(line.row);
      if (p) p.lineIds.push(line.id);
    }
    return { heads, paras };
  }

  // --- refs ----------------------------------------------------------------------------------------------------------

  function keyOf(ref) {
    if (!isObject(ref)) return '';
    switch (ref.kind) {
      case 'work': return 'work';
      case 'song': return isNumber(ref.n) && isNumber(ref.t0) && isNumber(ref.t1) ? 'song:' + ref.n + '@' + ref.t0 + '-' + ref.t1 : '';
      case 'songKind': return typeof ref.of === 'string' ? 'kind:' + ref.of : '';
      case 'head': return typeof ref.rowId === 'string' ? 'head:' + ref.rowId : '';
      case 'para': return typeof ref.rowId === 'string' ? 'para:' + ref.rowId : '';
      case 'lines': return Array.isArray(ref.ids) && ref.ids.every((x) => typeof x === 'string')
        ? 'lines:' + [...new Set(ref.ids)].sort().join(',') : '';
      case 'cut': return typeof ref.key === 'string' ? 'cut:' + ref.key : '';
      default: return '';
    }
  }

  function sameRef(a, b) {
    const ka = keyOf(a);
    return ka !== '' && ka === keyOf(b);
  }

  // --- areas ---------------------------------------------------------------------------------------------------------

  function lineNumber(ix, id) { const l = ix.lineById.get(id); return l ? l.index + 1 : 0; }

  // An Area from its ref and member lines (time order kept from plan.lines) plus special cuts.
  function makeArea(ix, ref, kind, label, lineIds, specialKeys, span, songKind) {
    const ids = new Set(lineIds);
    const members = ix.lines.filter((l) => ids.has(l.id));
    // A cut area is exactly its cut (its lineIds name the cut's line, for context); others own every cut of their lines.
    const cutKeys = [];
    if (kind === 'cut') cutKeys.push(ref.key);
    else {
      for (const l of members) for (const k of ix.cutsOfLine.get(l.id) || []) cutKeys.push(k);
      for (const k of specialKeys) cutKeys.push(k);
      const order = new Map(ix.plan.cuts.map((c, i) => [c.key, i]));
      cutKeys.sort((a, b) => order.get(a) - order.get(b));
    }
    let t0 = span ? span[0] : 0, t1 = span ? span[1] : 0;
    if (!span && members.length) {
      t0 = Math.min(...members.map((l) => l.t0));
      t1 = Math.max(...members.map((l) => l.t1));
    }
    let scopes;
    if (kind === 'work') scopes = ['work'];
    else if (kind === 'cut') scopes = ['cut/' + cutKeys[0]];
    else scopes = members.map((l) => 'line/' + l.id).concat(specialKeys.map((k) => 'cut/' + k));
    return deepFreeze({
      ref, key: keyOf(ref), kind, label, lineIds: members.map((l) => l.id), cutKeys, scopes, t0, t1, n: members.length,
      locked: members.filter((l) => l.locked).map((l) => l.id), songKind: songKind || null,
    });
  }

  function songArea(ix, s) {
    const ref = { kind: 'song', n: s.n, t0: s.start, t1: s.end };
    return makeArea(ix, ref, 'song', ['area.song', { kind: s.kind, n: s.ordinal }], s.lineIds, s.specialKeys,
      [s.start, s.end], s.kind);
  }

  function kindArea(ix, of) {
    const list = ix.sections.filter((s) => s.kind === of);
    if (!list.length) return null;
    const lineIds = [].concat(...list.map((s) => s.lineIds));
    const specialKeys = [].concat(...list.map((s) => s.specialKeys));
    const span = [Math.min(...list.map((s) => s.start)), Math.max(...list.map((s) => s.end))];
    return makeArea(ix, { kind: 'songKind', of }, 'songKind', ['area.songAll', { kind: of }], lineIds, specialKeys, span, of);
  }

  function headArea(ix, h) {
    return makeArea(ix, { kind: 'head', rowId: h.rowId }, 'head', ['area.head', { text: h.text }], h.lineIds, [], null,
      FE.sectionOfHeading(h.text));
  }

  function paraArea(ix, p) {
    return makeArea(ix, { kind: 'para', rowId: p.rowId }, 'para', ['area.para', { n: p.n }], p.lineIds, [], null, null);
  }

  function linesArea(ix, ids) {
    const known = ids.filter((id) => ix.lineById.has(id));
    if (!known.length) return null;
    const nums = known.map((id) => lineNumber(ix, id));
    const a = Math.min(...nums), b = Math.max(...nums);
    const label = a === b ? ['area.linesOne', { a }] : ['area.lines', { a, b }];
    return makeArea(ix, { kind: 'lines', ids: ids.slice() }, 'lines', label, known, [], null, null);
  }

  function cutArea(ix, key) {
    const cut = ix.cutByKey.get(key);
    if (!cut) return null;
    let label;
    if (cut.line) {
      const keys = ix.cutsOfLine.get(cut.line) || [];
      label = ['area.cut', { n: lineNumber(ix, cut.line), k: keys.indexOf(key) + 1 }];
    } else if (key.startsWith('gap/')) {
      label = ['crumb.gap', { n: lineNumber(ix, key.slice(4)) }];
    } else label = ['crumb.' + key, {}];
    return makeArea(ix, { kind: 'cut', key }, 'cut', label, cut.line ? [cut.line] : [], cut.line ? [] : [key],
      [cut.t0, cut.t1], null);
  }

  function workArea(ix) {
    return makeArea(ix, { kind: 'work' }, 'work', ['area.work', {}], ix.lines.map((l) => l.id), ix.special.map((c) => c.key),
      [0, ix.duration], null);
  }

  // resolve(doc, plan, ref) → Area | null. null when the area no longer exists: an unknown or re-analysed song section
  // (the ref records its times), a heading or block start that is gone, no remaining line of a line set, a cut that
  // is gone.
  function resolve(doc, plan, ref) {
    if (!isObject(ref) || !plan) return null;
    const ix = indexOf(doc, plan);
    switch (ref.kind) {
      case 'work': return workArea(ix);
      case 'song': {
        const s = ix.sections.find((x) => x.n === ref.n);
        return s && s.start === ref.t0 && s.end === ref.t1 ? songArea(ix, s) : null;
      }
      case 'songKind': return typeof ref.of === 'string' ? kindArea(ix, ref.of) : null;
      case 'head': {
        const h = ix.heads.find((x) => x.rowId === ref.rowId);
        return h ? headArea(ix, h) : null;
      }
      case 'para': {
        const p = ix.paras.find((x) => x.rowId === ref.rowId);
        return p ? paraArea(ix, p) : null;
      }
      case 'lines': return Array.isArray(ref.ids) ? linesArea(ix, ref.ids.filter((x) => typeof x === 'string')) : null;
      case 'cut': return typeof ref.key === 'string' ? cutArea(ix, ref.key) : null;
      default: return null;
    }
  }

  // The picker lists (§6.8): song sections in time order; kinds with ≥ 2 sections; headings with lines; blocks when
  // the lyrics have ≥ 2 of them.
  function areasOf(doc, plan) {
    const ix = indexOf(doc, plan);
    const song = ix.sections.slice().sort((a, b) => a.start - b.start || a.n - b.n).map((s) => songArea(ix, s));
    const kinds = [];
    const seen = new Set();
    for (const s of ix.sections.slice().sort((a, b) => a.start - b.start || a.n - b.n)) {
      if (seen.has(s.kind)) continue;
      seen.add(s.kind);
      if (ix.sections.filter((x) => x.kind === s.kind).length >= 2) kinds.push(kindArea(ix, s.kind));
    }
    const heads = ix.heads.filter((h) => h.lineIds.length).map((h) => headArea(ix, h));
    const paras = ix.paras.length >= 2 ? ix.paras.map((p) => paraArea(ix, p)) : [];
    return { song, kinds, heads, paras };
  }

  // inArea(area, path) → true when the path lies under one of the area's scopes (paths.isUnder).
  function inArea(area, path) {
    if (!area || !Array.isArray(area.scopes)) return false;
    for (const s of area.scopes) {
      try { if (P.isUnder(path, s)) return true; } catch (e) { return false; }
    }
    return false;
  }

  // ofLines(doc, plan, lineIds) → the named area with exactly these lines (song > head > para), else
  // { kind: 'lines', ids } (the known ids, in time order).
  function ofLines(doc, plan, lineIds) {
    const ix = indexOf(doc, plan);
    const want = new Set((Array.isArray(lineIds) ? lineIds : []).filter((id) => ix.lineById.has(id)));
    const same = (ids) => ids.length === want.size && ids.length > 0 && ids.every((id) => want.has(id));
    const song = ix.sections.slice().sort((a, b) => a.start - b.start || a.n - b.n).find((s) => same(s.lineIds));
    if (song) return { kind: 'song', n: song.n, t0: song.start, t1: song.end };
    const head = ix.heads.find((h) => same(h.lineIds));
    if (head) return { kind: 'head', rowId: head.rowId };
    const para = ix.paras.length >= 2 ? ix.paras.find((p) => same(p.lineIds)) : null;
    if (para) return { kind: 'para', rowId: para.rowId };
    return { kind: 'lines', ids: ix.lines.filter((l) => want.has(l.id)).map((l) => l.id) };
  }

  // Timeline bands: song sections if any, else headings, else blocks (≥ 2); in time order.
  function bands(doc, plan) {
    const all = areasOf(doc, plan);
    const list = all.song.length ? all.song : all.heads.length ? all.heads : all.paras;
    return list.map((a) => ({ key: a.key, ref: a.ref, kind: a.kind, t0: a.t0, t1: a.t1, n: a.n }))
      .sort((a, b) => a.t0 - b.t0 || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  return { AREA_KINDS, keyOf, areasOf, resolve, inArea, ofLines, bands, sameRef };
});
