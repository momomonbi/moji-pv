/* 文字PVメーカー v2 — original work. AI change sets: stale detection, conversion to commands, log entries and selective revert (DESIGN §4.22.5). */
MV.def('ai/changes', ['core/commands', 'core/lyrics', 'core/doc', 'ai/lyricio', 'i18n/t'], (CMD, L, D, IO, T) => {
  'use strict';

  // Change = { id, kind, scope: 'work' | 'line' | 'rows', lineId?, rowId?, path?, from, to,
  //            base: { rev, value?, src? }, label: [stringKey, params], checked: true, stale: false, …kind extras }
  const KINDS = Object.freeze(['theme', 'mood', 'season', 'amount', 'flash', 'palette', 'avoid', 'allow', 'part', 'impact',
    'emphasis', 'cut', 'note', 'remove', 'time', 'rows', 'songInfo']);
  const LYRIC_KINDS = Object.freeze(['cut', 'note', 'emphasis', 'impact']);       // also the order they apply in
  const WORK_PIN_KINDS = Object.freeze(['theme', 'mood', 'season', 'amount', 'flash']);
  const PALETTE_TOKENS = Object.freeze(['accent', 'shiftA', 'shiftB']);
  const FLASH_ON = 0.7;
  const GROUPS = Object.freeze({
    lyrics: ['cut', 'note', 'emphasis', 'impact', 'remove', 'rows'],
    work: ['theme', 'mood', 'season', 'amount', 'flash', 'palette', 'avoid', 'allow', 'songInfo'],
    lines: ['part'],
    time: ['time'],
  });

  function sameJSON(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameJSON(a[k], b[k]));
  }

  function pinValue(doc, path) {
    const pin = doc.pins[path];
    return pin ? pin.v : null;
  }

  // rowId → src for every row. Build it once per call that makes or checks many changes (a per-change search would
  // make big reviews quadratic) and pass it on as `srcs`.
  function rowSrcs(doc) {
    const out = new Map();
    for (const r of doc.sheet.rows) out.set(r.id, r.src);
    return out;
  }

  function rowSrc(doc, rowId, srcs) {
    if (srcs) return srcs.has(rowId) ? srcs.get(rowId) : null;
    const row = doc.sheet.rows.find((r) => r.id === rowId);
    return row ? row.src : null;
  }

  // ---- making changes ------------------------------------------------------------------------------------------------

  // What the project holds for this change's target now (compared with `base` for stale detection). srcs: rowSrcs(doc).
  function snapshot(doc, c, srcs) {
    if (WORK_PIN_KINDS.includes(c.kind) || c.kind === 'part') return { value: pinValue(doc, c.path) };
    if (c.kind === 'palette') {
      const value = {};
      for (const k of PALETTE_TOKENS) value[k] = pinValue(doc, 'work:color.' + k);
      return { value };
    }
    if (c.kind === 'avoid' || c.kind === 'allow') return { value: doc.filters[c.filterKind] || null };
    if (c.kind === 'time') return { value: pinValue(doc, c.path), src: rowSrc(doc, c.rowId, srcs) };
    if (c.kind === 'rows') return { src: IO.sheetText(doc) };
    if (c.kind === 'songInfo') return { value: doc.song ? doc.song.sha1 : null };
    return { src: rowSrc(doc, c.rowId, srcs) };
  }

  // A Change from its fields: checked, not stale, with `base` taken from the document the request was made from.
  // opts = { rev, prefix, srcs } (prefix keeps ids unique across the three proposals; srcs = rowSrcs(doc) when many
  // changes are made from one document).
  function make(doc, fields, opts) {
    const o = opts || {};
    const c = Object.assign({ checked: true, stale: false }, fields);
    c.id = (o.prefix || '') + fields.id;
    c.base = Object.assign({ rev: o.rev === undefined ? null : o.rev }, snapshot(doc, c, o.srcs));
    return c;
  }

  function isStale(doc, c, srcs) {
    const now = snapshot(doc, c, srcs);
    const base = c.base || {};
    if ('value' in now && !sameJSON(now.value, base.value === undefined ? null : base.value)) return true;
    if ('src' in now && now.src !== (base.src === undefined ? null : base.src)) return true;
    return false;
  }

  // stale = the project no longer holds what it held when the request was made; newly stale rows are unchecked.
  function markStale(doc, plan, changes) {
    const srcs = rowSrcs(doc);
    return changes.map((c) => {
      const stale = isStale(doc, c, srcs);
      if (stale === c.stale) return c;
      return Object.assign({}, c, { stale, checked: stale ? false : c.checked });
    });
  }

  // Maps an answer's line number `i` to a plan line. With the request's own list (sent = the request's `lines`,
  // [{ i, lineId, text }]) it goes through the line id, so an edit made while the request ran cannot move a change onto
  // another line, and a line whose words changed since is skipped. Without it, i is the index in plan.lines.
  // → (i) → { line } | { warn: [stringKey, params] }
  function lineResolver(plan, sent) {
    const lines = plan && Array.isArray(plan.lines) ? plan.lines : [];
    if (!Array.isArray(sent)) {
      return (i) => (i >= 0 && i < lines.length ? { line: lines[i] } : { warn: ['ai.warn.notLine', { n: i + 1 }] });
    }
    const byId = new Map(lines.map((l) => [l.id, l]));
    return (i) => {
      const s = i >= 0 ? sent[i] : null;
      if (!s) return { warn: ['ai.warn.notLine', { n: i + 1 }] };
      const line = byId.get(s.lineId);
      return line && line.text === s.text ? { line } : { warn: ['ai.warn.changedSince', { n: i + 1 }] };
    };
  }

  function groupOf(c) {
    for (const g of Object.keys(GROUPS)) if (GROUPS[g].includes(c.kind)) return g;
    return 'work';
  }

  // ---- changes → commands --------------------------------------------------------------------------------------------

  function workPinCmds(c) {
    if (c.kind === 'season' && c.to === 'any') return [{ t: 'pin.clear', path: c.path }];
    if (c.kind === 'flash') return [{ t: 'pin.set', path: c.path, v: c.to ? FLASH_ON : 0, by: 'ai' }];
    return [{ t: 'pin.set', path: c.path, v: c.to, by: 'ai' }];
  }

  function paletteCmds(c) {
    return PALETTE_TOKENS.map((k) => ({ t: 'pin.set', path: 'work:color.' + k, v: c.to[k], by: 'ai' }));
  }

  // avoid / allow per filter kind → one filter.set each. avoid adds to `deny`; allow removes from `deny` or adds to
  // `only`. An avoid that would empty an `only` list is dropped.
  function filterCmds(doc, list) {
    const byKind = new Map();
    for (const c of list) {
      if (!byKind.has(c.filterKind)) byKind.set(c.filterKind, []);
      byKind.get(c.filterKind).push(c);
    }
    const cmds = [];
    for (const [kind, items] of byKind) {
      const cur = doc.filters[kind] || { only: null, deny: null };
      let only = cur.only ? cur.only.slice() : null;
      const deny = cur.deny ? cur.deny.slice() : [];
      for (const c of items) {
        if (c.kind === 'avoid') {
          if ((only && !only.includes(c.partKey)) || deny.includes(c.partKey)) continue;
          if (only && only.every((k) => k === c.partKey || deny.includes(k))) continue;
          deny.push(c.partKey);
        } else if (deny.includes(c.partKey)) {
          deny.splice(deny.indexOf(c.partKey), 1);
        } else if (only && !only.includes(c.partKey)) {
          only = only.concat([c.partKey]);
        }
      }
      const cmd = { t: 'filter.set', kind, only, deny: deny.length ? deny : null };
      if (!sameJSON({ only: cmd.only, deny: cmd.deny }, { only: cur.only || null, deny: cur.deny || null })) cmds.push(cmd);
    }
    return cmds;
  }

  function overlaps(ranges, r) { return ranges.some(([a, b]) => r[0] < b && a < r[1]); }

  // One lyric change on top of the fields so far, or null when it adds nothing.
  function lyricStep(f, c) {
    if (c.kind === 'cut') return Object.assign({}, f, { pieces: c.to.map((p) => p.slice()) });
    if (c.kind === 'note') return f.note === c.to ? null : Object.assign({}, f, { note: c.to });
    if (c.kind === 'impact') return f.impact === c.to ? null : Object.assign({}, f, { impact: c.to });
    if (overlaps(f.emph, c.to)) return null;
    return Object.assign({}, f, { emph: f.emph.concat([c.to.slice()]) });
  }

  // The row's new src after its lyric changes, each step checked by renderChecked; null when nothing changes or the
  // row's words changed since the request.
  function rowEdit(row, list) {
    if (!row || !row.lyric) return null;
    const ok = list.filter((c) => c.base && typeof c.base.src === 'string' && L.PLAIN(c.base.src) === row.text);
    let f = { pieces: row.pieces, emph: row.emph, impact: row.impact, note: row.note };
    for (const kind of LYRIC_KINDS) {
      for (const c of ok.filter((x) => x.kind === kind)) {
        const next = lyricStep(f, c);
        if (next && IO.renderChecked(row, next).ok) f = next;
      }
    }
    const res = IO.renderChecked(row, f);
    return res.ok && res.src !== row.src ? { fields: f, src: res.src } : null;
  }

  // The lyric changes grouped by row, in the order their rows first appear in the list.
  function byRowId(list) {
    const out = new Map();
    for (const c of list) {
      if (!LYRIC_KINDS.includes(c.kind)) continue;
      const bucket = out.get(c.rowId);
      if (bucket) bucket.push(c); else out.set(c.rowId, [c]);
    }
    return out;
  }

  function lyricCmds(doc, list) {
    const groups = byRowId(list);
    const removals = list.filter((x) => x.kind === 'remove');
    if (!groups.size && !removals.length) return [];
    const needed = new Set(groups.keys());
    for (const c of removals) needed.add(c.rowId);
    const byRow = new Map(IO.rowsView(doc, needed).map((r) => [r.rowId, r]));
    const edits = {};
    const rowCmds = [];
    for (const [rowId, rowChanges] of groups) {
      const edit = rowEdit(byRow.get(rowId), rowChanges);
      if (!edit) continue;
      edits[rowId] = { fields: edit.fields };
      rowCmds.push({ t: 'lyrics.row', rowId, src: edit.src });
    }
    let removed = 0;
    for (const c of removals) {
      const row = byRow.get(c.rowId);
      if (!row || !c.base || typeof c.base.src !== 'string' || L.PLAIN(c.base.src) !== row.text) continue;
      edits[c.rowId] = { remove: true };
      removed++;
    }
    if (!removed) return rowCmds;
    const text = IO.editRows(doc, edits).text;
    return text === IO.sheetText(doc) ? [] : [{ t: 'lyrics.set', text }];
  }

  function rowsCmds(doc, c) {
    const cur = IO.sheetText(doc);
    const text = c.mode === 'append' && cur.trim() !== '' ? cur.replace(/\s+$/, '') + '\n\n' + c.to : c.to;
    return text === cur ? [] : [{ t: 'lyrics.set', text }];
  }

  function lineKnown(plan, lineId) {
    return !plan || !Array.isArray(plan.lines) || plan.lines.some((l) => l.id === lineId);
  }

  // The commands for the checked changes (§4.22.5 table), in this order: work pins, palette, filters, line part pins,
  // start times, lyric edits, a transcript, the song analysis. Dispatch them with one store.batch (one undo step).
  function toCommands(doc, plan, changes) {
    const list = changes.filter((c) => c && c.checked !== false);
    const of = (...kinds) => list.filter((c) => kinds.includes(c.kind));
    const cmds = [];
    for (const c of of(...WORK_PIN_KINDS)) cmds.push(...workPinCmds(c));
    for (const c of of('palette')) cmds.push(...paletteCmds(c));
    cmds.push(...filterCmds(doc, of('avoid', 'allow')));
    for (const c of of('part', 'time')) {
      if (lineKnown(plan, c.lineId)) cmds.push({ t: 'pin.set', path: c.path, v: c.to, by: 'ai' });
    }
    cmds.push(...lyricCmds(doc, of('cut', 'note', 'emphasis', 'impact', 'remove')));
    for (const c of of('rows')) cmds.push(...rowsCmds(doc, c));
    for (const c of of('songInfo')) {
      if (doc.song && doc.song.sha1 === c.base.value) cmds.push({ t: 'song.info', info: c.to });
    }
    return dropNoops(doc, cmds);
  }

  // Leaves out commands that would change nothing (a pin already holding that value, a clear of a missing pin).
  function dropNoops(doc, cmds) {
    return cmds.filter((cmd) => {
      if (cmd.t === 'pin.set') {
        const pin = doc.pins[cmd.path];
        return !(pin && sameJSON(pin.v, cmd.v));
      }
      if (cmd.t === 'pin.clear') return !!doc.pins[cmd.path];
      return true;
    });
  }

  // The document with the checked changes applied (try-on renders plan(apply(…)) without committing).
  function apply(doc, plan, changes) {
    const cmds = toCommands(doc, plan, changes);
    return cmds.length ? CMD.reduce(doc, { t: 'batch', cmds }) : doc;
  }

  // ---- log and selective revert --------------------------------------------------------------------------------------

  // The side.aiLog entry for commands dispatched on `docBefore`: { runId, tool, n, applied: [...] } where each item
  // records the target, the AI's value (`to`) and what was there before (`prev`):
  //   { path, to, prev }  { filter, to, prev }  { rowId, to, prev }  { rows: 'all', to, prev }  { songInfo: true, to, prev }
  function logEntry(docBefore, cmds, meta) {
    const m = meta || {};
    const applied = [];
    const srcs = rowSrcs(docBefore);
    for (const cmd of cmds) {
      if (cmd.t === 'pin.set') applied.push({ path: cmd.path, to: cmd.v, prev: docBefore.pins[cmd.path] || null });
      else if (cmd.t === 'pin.clear') applied.push({ path: cmd.path, to: null, prev: docBefore.pins[cmd.path] || null });
      else if (cmd.t === 'filter.set') {
        const to = cmd.only === null && cmd.deny === null ? null : { only: cmd.only, deny: cmd.deny };
        applied.push({ filter: cmd.kind, to, prev: docBefore.filters[cmd.kind] || null });
      } else if (cmd.t === 'lyrics.row') applied.push({ rowId: cmd.rowId, to: cmd.src, prev: rowSrc(docBefore, cmd.rowId, srcs) });
      else if (cmd.t === 'lyrics.set') applied.push({ rows: 'all', to: cmd.text, prev: IO.sheetText(docBefore) });
      else if (cmd.t === 'song.info') applied.push({ songInfo: true, to: cmd.info, prev: docBefore.song ? docBefore.song.info : null });
    }
    return { runId: m.runId === undefined ? null : m.runId, tool: m.tool || null, n: m.n === undefined ? applied.length : m.n, applied };
  }

  function revertOne(doc, item, srcs) {
    if (item.path) {
      const cur = doc.pins[item.path];
      const holds = item.to === null ? !cur : !!cur && cur.by === 'ai' && sameJSON(cur.v, item.to);
      if (!holds) return null;
      if (!item.prev) return item.to === null ? [] : [{ t: 'pin.clear', path: item.path }];
      const cmd = { t: 'pin.set', path: item.path, v: item.prev.v, by: item.prev.by };
      if (item.prev.sig !== undefined) cmd.sig = item.prev.sig;
      return [cmd];
    }
    if (item.filter) {
      if (!sameJSON(doc.filters[item.filter] || null, item.to)) return null;
      const p = item.prev || { only: null, deny: null };
      return [{ t: 'filter.set', kind: item.filter, only: p.only || null, deny: p.deny || null }];
    }
    if (item.rowId) return rowSrc(doc, item.rowId, srcs) === item.to ? [{ t: 'lyrics.row', rowId: item.rowId, src: item.prev }] : null;
    if (item.rows) return IO.sheetText(doc) === item.to ? [{ t: 'lyrics.set', text: item.prev }] : null;
    if (item.songInfo) return doc.song && sameJSON(doc.song.info, item.to) ? [{ t: 'song.info', info: item.prev }] : null;
    return null;
  }

  // Selective revert: only where the document still holds the AI's value; `kept` = items changed since (not reverted).
  function revertCommands(doc, entry) {
    const cmds = [];
    let kept = 0;
    const srcs = rowSrcs(doc);
    for (const item of (entry && entry.applied) || []) {
      const out = revertOne(doc, item, srcs);
      if (out === null) kept++;
      else cmds.push(...out);
    }
    return { cmds: cmds.reverse(), kept };
  }

  // ---- review text ---------------------------------------------------------------------------------------------------

  const NAMED = Object.freeze({ theme: 'theme', mood: 'mood' });
  const AUTO_LABEL = 'ai.ch.auto';                 // 「自動（{v}）」 around a value the planner chose

  function shown(t, c, key, v) {
    if (v === null || v === undefined) return '';
    if (c.kind === 'part') return t.part(c.partKind, v);
    if (NAMED[c.kind]) return t.part(NAMED[c.kind], v);
    if (c.kind === 'season') return t('fld.season.' + v);
    if (c.kind === 'time') return T.fmtTime(v);
    if (typeof v === 'number') return String(Math.round(v * 100) / 100);
    return String(v);
  }

  // The review row text: t(label key) with part, theme, mood and season names, and times, resolved.
  function describe(c, t) {
    const [key, params] = c.label;
    const p = Object.assign({}, params);
    if ('from' in p) p.from = shown(t, c, 'from', p.from);
    if ('to' in p) p.to = shown(t, c, 'to', p.to);
    if ('kind' in p) p.kind = t('kind.' + p.kind);
    if ('part' in p && c.filterKind) p.part = t.part(c.filterKind, p.part);
    if ('what' in p) p.what = t('fld.amount.' + p.what);
    if (c.fromSource === 'auto' && 'from' in params && params.from !== null) p.from = t(AUTO_LABEL, { v: p.from });
    // a change that hands the value back to the planner shows what the planner will choose (e.g. a season pin cleared)
    if (c.toSource === 'auto' && 'to' in params && params.to !== null) p.to = t(AUTO_LABEL, { v: p.to });
    return t(key, p);
  }

  // A validator warning ([stringKey, params]) as text: part kinds and keys become their names.
  function warningText(w, t) {
    const [key, params] = w;
    const p = Object.assign({}, params);
    if (p.kind && p.key) p.key = t.part(p.kind, p.key);
    if (p.kind) p.kind = t('kind.' + p.kind);
    return t(key, p);
  }

  return {
    KINDS, GROUPS, FLASH_ON, make, snapshot, rowSrcs, lineResolver, markStale, groupOf, toCommands, apply, logEntry,
    revertCommands, describe, warningText, sameJSON,
  };
});
