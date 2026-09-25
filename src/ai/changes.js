/* 文字PVメーカー v2 — original work. AI change sets: stale detection, conversion to commands, log entries and selective revert (DESIGN §4.22.5; DESIGN_2_1 §5.6, §11.6). */
MV.def('ai/changes', ['core/commands', 'core/lyrics', 'core/doc', 'core/hash', 'core/paths', 'core/curve', 'core/shot',
  'ai/lyricio', 'i18n/t'], (CMD, L, D, H, P, CV, SHOT, IO, T) => {
  'use strict';

  // Change = { id, kind, scope: 'work' | 'line' | 'cut' | 'rows', lineId?, rowId?, path?, from, to,
  //            base: { rev, value?, src? }, label: [stringKey, params], checked: true, stale: false, …kind extras }
  // v2.1 (DESIGN_2_1 §5.6) adds: group, areaKey, agg, requires: [changeId], staleWhy, field, cutKey, cutSig, matName and
  // entry, and the kinds `value` (any pin by path; `to: null` clears it), `material` (material.put) and `media`
  // (media.meta of a vision result, §11.6.2).
  const KINDS = Object.freeze(['theme', 'mood', 'season', 'amount', 'flash', 'palette', 'avoid', 'allow', 'part', 'impact',
    'emphasis', 'cut', 'note', 'remove', 'time', 'rows', 'songInfo', 'value', 'material', 'media']);
  const LYRIC_KINDS = Object.freeze(['cut', 'note', 'emphasis', 'impact']);       // also the order they apply in
  const WORK_PIN_KINDS = Object.freeze(['theme', 'mood', 'season', 'amount', 'flash']);
  const PALETTE_TOKENS = Object.freeze(['accent', 'shiftA', 'shiftB']);
  const FLASH_ON = 0.7;
  // kind → review group (§4.22.5).
  const GROUPS = Object.freeze({
    lyrics: ['cut', 'note', 'emphasis', 'impact', 'remove', 'rows'],
    work: ['theme', 'mood', 'season', 'amount', 'flash', 'palette', 'avoid', 'allow', 'songInfo', 'media'],
    lines: ['part', 'value'],
    time: ['time'],
  });
  // The v2.1 groups of area instructions (§5.6 GROUPS +=): a change's own `group` wins, then material changes
  // ('materials'), cut changes ('cuts') and area changes ('area'); 'outside' is set by ai/direct. They are listed apart
  // from GROUPS until the review (ui/ai_controller GROUP_ORDER, package F) has their headings.
  const AREA_GROUPS = Object.freeze({ materials: ['material'], area: [], cuts: [], outside: [] });
  const STALE_WHY = Object.freeze(['changed', 'left', 'gone', 'material']);
  // value slots that are line-level settings (applied before part pins, §5.6 step 3)
  const LINE_VALUE_SLOTS = Object.freeze(['season', 'avoid']);
  const MAT_PREFIX = 'mat:';

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

  // entryHash(entry) → 'xxxxxxxx': the hash of a stored material entry (hashJSON of the whole entry, which material.put
  // stores normalized: the definition of parts/mix.materialHash, §3.12). null for no entry.
  function entryHash(entry) { return entry ? H.hashJSON(entry) : null; }

  function materialOf(doc, id) {
    const list = doc.materials && Array.isArray(doc.materials.list) ? doc.materials.list : [];
    return id ? list.find((m) => m.id === id) || null : null;
  }

  function assetOf(doc, id) {
    const list = doc.media && Array.isArray(doc.media.list) ? doc.media.list : [];
    return list.find((e) => e.id === id) || null;
  }

  // What the project holds for this change's target now (compared with `base` for stale detection). srcs: rowSrcs(doc).
  function snapshot(doc, c, srcs) {
    if (WORK_PIN_KINDS.includes(c.kind) || c.kind === 'part' || c.kind === 'value') return { value: pinValue(doc, c.path) };
    // a new material has no entry yet (base null): it is stale once an entry with its planned id exists
    if (c.kind === 'material') return { value: entryHash(materialOf(doc, c.materialId || c.plannedId)) };
    if (c.kind === 'media') {
      const e = assetOf(doc, c.assetId);
      return { value: e ? e.ai : false };                   // false: the asset is gone
    }
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

  // ---- areas --------------------------------------------------------------------------------------------------------

  // inArea(area, path): the rule of planner/areas.inArea (paths.isUnder against one of the area's scopes), with the
  // scopes in a Set so a review of many rows stays linear. The Set is made once per Area object.
  const scopeSets = new WeakMap();
  function inArea(area, path) {
    if (!area || !Array.isArray(area.scopes)) return false;
    let scopes = scopeSets.get(area);
    if (!scopes) { scopes = new Set(area.scopes); scopeSets.set(area, scopes); }
    if (scopes.has('work')) return true;
    let own;
    try { own = P.scopeKey(path); } catch (e) { return false; }
    if (scopes.has(own)) return true;
    if (!own.startsWith('cut/')) return false;
    try {
      const line = P.lineOfCut(own.slice(4));
      return line !== null && scopes.has('line/' + line);
    } catch (e) { return false; }
  }

  // resolveArea called once per area key within one call (the caller may resolve afresh each time).
  function areaCache(resolveArea) {
    if (!resolveArea) return null;
    const seen = new Map();
    return (key) => {
      if (!seen.has(key)) seen.set(key, resolveArea(key));
      return seen.get(key);
    };
  }

  // The cuts of a plan: key → text (what cut pins carry as `sig`).
  function cutTexts(plan) {
    const out = new Map();
    for (const cut of plan && Array.isArray(plan.cuts) ? plan.cuts : []) out.set(cut.key, cut.text);
    return out;
  }

  // Why a change no longer fits the project: 'gone' (its cut is gone or holds other words), 'changed' (its target holds
  // another value), 'material' (the material changed), 'left' (with resolveArea: its path left the area, or the area
  // is gone); null while it still fits.
  function whyStale(doc, c, srcs, cuts, resolveArea) {
    if (c.cutKey && cuts && cuts.get(c.cutKey) !== c.cutSig) return 'gone';
    if (isStale(doc, c, srcs)) return c.kind === 'material' ? 'material' : 'changed';
    if (resolveArea && c.areaKey && c.path && c.group !== 'outside' && c.kind !== 'material') {
      const area = resolveArea(c.areaKey);
      if (area === null) return 'left';
      if (area && !inArea(area, areaPath(c))) return 'left';
    }
    return null;
  }

  // The path a change is checked against its area with: a cut pin written under an older key (the plan cut's pinKey)
  // still belongs to the cut it was made for.
  function areaPath(c) { return c.cutKey ? 'cut/' + c.cutKey + ':' + slotOf(c.path) : c.path; }

  // stale = the project no longer holds what it held when the request was made; newly stale rows are unchecked.
  // staleWhy says why: 'changed' | 'left' | 'gone' | 'material' (null while fresh). opts.resolveArea(areaKey) → the Area
  // now, null when it is gone, undefined when the caller does not know the key (then no area check).
  function markStale(doc, plan, changes, opts) {
    const srcs = rowSrcs(doc);
    const resolveArea = areaCache(opts && typeof opts.resolveArea === 'function' ? opts.resolveArea : null);
    const cuts = changes.some((c) => c && c.cutKey) && plan && Array.isArray(plan.cuts) ? cutTexts(plan) : null;
    return changes.map((c) => {
      const why = whyStale(doc, c, srcs, cuts, resolveArea);
      const stale = why !== null;
      const known = c.staleWhy === undefined ? (stale ? 'changed' : null) : c.staleWhy;
      if (stale === c.stale && known === why) return c;
      return Object.assign({}, c, { stale, staleWhy: why, checked: stale && !c.stale ? false : c.checked });
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
    const own = typeof c.group === 'string' ? c.group : '';
    if (Object.prototype.hasOwnProperty.call(GROUPS, own) || Object.prototype.hasOwnProperty.call(AREA_GROUPS, own)) return own;
    if (c.kind === 'material') return 'materials';
    if (c.cutKey && (c.kind === 'part' || c.kind === 'value')) return 'cuts';
    if (c.areaKey && (c.kind === 'part' || c.kind === 'value')) return 'area';
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

  // The material.put of an entry under `id`: its metadata and recipe.
  function materialPut(id, e) {
    const cmd = { t: 'material.put', id, kind: e.kind, by: e.by, name: e.name, recipe: e.recipe };
    for (const k of ['blurb', 'tags', 'season', 'pool']) if (e[k] !== undefined) cmd[k] = e[k];
    return cmd;
  }

  // Materials first (§5.6 step 1): new ids 'm' + (materials.next + k) in list order, so try-on and apply agree.
  // → { cmds, keyOf: Map<material change id, part key> }
  function materialCmds(doc, list) {
    const next = doc.materials && Number.isInteger(doc.materials.next) ? doc.materials.next : 1;
    const cmds = [];
    const keyOf = new Map();
    let k = 0;
    for (const c of list) {
      if (!c.entry) continue;
      const id = c.materialId || 'm' + (next + k++).toString(36);
      keyOf.set(c.id, 'myMat' + id.slice(1));
      cmds.push(materialPut(id, c.entry));
    }
    return { cmds, keyOf };
  }

  // The value a pin gets: a 'mat:<name>' placeholder becomes the key of the material the change requires.
  function pinValueOf(c, keyOf) {
    if (typeof c.to === 'string' && c.to.startsWith(MAT_PREFIX)) {
      for (const id of Array.isArray(c.requires) ? c.requires : []) if (keyOf.has(id)) return keyOf.get(id);
      return undefined;
    }
    return c.to;
  }

  // The pin command of a part or value change (cut paths carry the cut's text as sig); undefined when it has none.
  function pinCmd(c, keyOf) {
    const v = pinValueOf(c, keyOf);
    if (v === undefined) return undefined;
    if (v === null) return { t: 'pin.clear', path: c.path };
    const cmd = { t: 'pin.set', path: c.path, v, by: 'ai' };
    if (c.path.startsWith('cut/')) cmd.sig = typeof c.cutSig === 'string' ? c.cutSig : '';
    return cmd;
  }

  // Whether a checked change may be applied: the changes it requires are checked too, its line and cut still exist,
  // and (with resolveArea) its path still lies in its area (§5.5 area guarantee, repeated at apply time).
  function applicable(c, ctx) {
    if (Array.isArray(c.requires) && !c.requires.every((id) => ctx.checked.has(id))) return false;
    if (c.lineId && !lineKnown(ctx.plan, c.lineId)) return false;
    if (c.cutKey && ctx.cuts && !ctx.cuts.has(c.cutKey)) return false;
    if (ctx.resolveArea && c.areaKey && c.group !== 'outside' && c.path) {
      const area = ctx.resolveArea(c.areaKey);
      if (area === null || (area && !inArea(area, areaPath(c)))) return false;
    }
    return true;
  }

  // The commands for the checked changes (§4.22.5 table; DESIGN_2_1 §5.6), in this order: materials, photo and video
  // descriptions, work pins, palette, filters, line season and avoid, part pins, value pins, start times, lyric edits,
  // a transcript, the song analysis. A change whose required material is unchecked is dropped. Dispatch them with one
  // store.batch (one undo step). opts.resolveArea as in markStale.
  function toCommands(doc, plan, changes, opts) {
    const list = changes.filter((c) => c && c.checked !== false);
    const of = (...kinds) => list.filter((c) => kinds.includes(c.kind));
    const resolveArea = areaCache(opts && typeof opts.resolveArea === 'function' ? opts.resolveArea : null);
    const ctx = { plan, resolveArea, checked: new Set(list.map((c) => c.id)),
      cuts: list.some((c) => c.cutKey) && plan && Array.isArray(plan.cuts) ? cutTexts(plan) : null };
    const cmds = [];
    const mats = materialCmds(doc, of('material'));
    cmds.push(...mats.cmds);
    for (const c of of('media')) cmds.push({ t: 'media.meta', id: c.assetId, ai: c.to });
    for (const c of of(...WORK_PIN_KINDS)) if (applicable(c, ctx)) cmds.push(...workPinCmds(c));
    for (const c of of('palette')) cmds.push(...paletteCmds(c));
    cmds.push(...filterCmds(doc, of('avoid', 'allow')));
    const pin = (c) => {
      const cmd = applicable(c, ctx) ? pinCmd(c, mats.keyOf) : undefined;
      if (cmd) cmds.push(cmd);
    };
    const lineValue = (c) => LINE_VALUE_SLOTS.includes(slotOf(c.path));
    for (const c of of('value')) if (lineValue(c)) pin(c);
    for (const c of of('part')) pin(c);
    for (const c of of('value')) if (!lineValue(c)) pin(c);
    for (const c of of('time')) {
      if (lineKnown(plan, c.lineId)) cmds.push({ t: 'pin.set', path: c.path, v: c.to, by: 'ai' });
    }
    cmds.push(...lyricCmds(doc, of('cut', 'note', 'emphasis', 'impact', 'remove')));
    for (const c of of('rows')) cmds.push(...rowsCmds(doc, c));
    for (const c of of('songInfo')) {
      if (doc.song && doc.song.sha1 === c.base.value) cmds.push({ t: 'song.info', info: c.to });
    }
    return dropNoops(doc, cmds);
  }

  function slotOf(path) {
    const at = typeof path === 'string' ? path.indexOf(':') : -1;
    return at < 0 ? '' : path.slice(at + 1);
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

  // The document with the checked changes applied (try-on renders plan(apply(…)) without committing; the stage's
  // alternate engine composes the registry of the tried document, so new materials show).
  function apply(doc, plan, changes, opts) {
    const cmds = toCommands(doc, plan, changes, opts);
    return cmds.length ? CMD.reduce(doc, { t: 'batch', cmds }) : doc;
  }

  // ---- log and selective revert --------------------------------------------------------------------------------------

  // The side.aiLog entry for commands dispatched on `docBefore`: { runId, tool, n, applied: [...] } where each item
  // records the target, the AI's value (`to`) and what was there before (`prev`):
  //   { path, to, prev }  { filter, to, prev }  { rowId, to, prev }  { rows: 'all', to, prev }  { songInfo: true, to, prev }
  //   { material: id, to: entryHash of the stored entry, prev: entry | null }  { media: id, to: ai, prev: ai }
  // meta may add `areas` ([{ key, label }]) and `instructions` ([text], each cut to 300 characters) (§5.6).
  function logEntry(docBefore, cmds, meta) {
    const m = meta || {};
    const applied = [];
    const srcs = rowSrcs(docBefore);
    let run = docBefore;                                   // the materials as stored, one put after the other
    for (const cmd of cmds) {
      if (cmd.t === 'material.put') {
        const prev = materialOf(run, cmd.id);
        try { run = CMD.reduce(run, cmd); } catch (e) { continue; }
        applied.push({ material: cmd.id, to: entryHash(materialOf(run, cmd.id)), prev: prev || null });
      } else if (cmd.t === 'media.meta') {
        const e = assetOf(docBefore, cmd.id);
        applied.push({ media: cmd.id, to: cmd.ai === undefined ? null : cmd.ai, prev: e ? e.ai : null });
      } else if (cmd.t === 'pin.set') applied.push({ path: cmd.path, to: cmd.v, prev: docBefore.pins[cmd.path] || null });
      else if (cmd.t === 'pin.clear') applied.push({ path: cmd.path, to: null, prev: docBefore.pins[cmd.path] || null });
      else if (cmd.t === 'filter.set') {
        const to = cmd.only === null && cmd.deny === null ? null : { only: cmd.only, deny: cmd.deny };
        applied.push({ filter: cmd.kind, to, prev: docBefore.filters[cmd.kind] || null });
      } else if (cmd.t === 'lyrics.row') applied.push({ rowId: cmd.rowId, to: cmd.src, prev: rowSrc(docBefore, cmd.rowId, srcs) });
      else if (cmd.t === 'lyrics.set') applied.push({ rows: 'all', to: cmd.text, prev: IO.sheetText(docBefore) });
      else if (cmd.t === 'song.info') applied.push({ songInfo: true, to: cmd.info, prev: docBefore.song ? docBefore.song.info : null });
    }
    const out = { runId: m.runId === undefined ? null : m.runId, tool: m.tool || null, n: m.n === undefined ? applied.length : m.n, applied };
    if (Array.isArray(m.areas)) out.areas = m.areas.map((a) => ({ key: String(a.key), label: a.label }));
    if (Array.isArray(m.instructions)) out.instructions = m.instructions.map((x) => Array.from(String(x)).slice(0, 300).join(''));
    return out;
  }

  // Whether a pin that is not the AI's refers to the part key (as its value, part-qualified, or in an avoid list).
  function keyInUse(doc, key) {
    for (const path of Object.keys(doc.pins)) {
      const pin = doc.pins[path];
      if (!pin || pin.by === 'ai') continue;
      if (pin.v === key || path.includes('@' + key + '.') || path.endsWith('@' + key)) return true;
      if (Array.isArray(pin.v) && pin.v.some((x) => typeof x === 'string' && x.slice(x.indexOf('.') + 1) === key)) return true;
    }
    return false;
  }

  function revertOne(doc, item, srcs) {
    if (item.material) {
      const cur = materialOf(doc, item.material);
      if (!cur || entryHash(cur) !== item.to) return null;
      // kept while pins that are not the AI's use it (the AI pins of the run go back first, §5.6)
      if (keyInUse(doc, 'myMat' + item.material.slice(1))) return null;
      return [item.prev ? materialPut(item.prev.id, item.prev) : { t: 'material.remove', id: item.material }];
    }
    if (item.media) {
      const cur = assetOf(doc, item.media);
      if (!cur || !sameJSON(cur.ai, item.to)) return null;
      return [{ t: 'media.meta', id: item.media, ai: item.prev === undefined ? null : item.prev }];
    }
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
  // Pins go back first (the log lists materials first and the commands come in reverse order). Pass a one-item entry
  // ({ applied: [item] }) to revert one path or one material.
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
  const CURVE_SLOT = /(^|\.)(ease|flow|curve)$/;
  const PARAM_OF = /^[a-z]+(?:#[0-9])?@[A-Za-z0-9]+\./;

  // A [stringKey, params] label as text, with the params that name string keys (ease families) resolved.
  function labelText(t, label) {
    const p = Object.assign({}, label[1]);
    for (const k of ['family', 'dir']) if (typeof p[k] === 'string' && t.has(p[k])) p[k] = t(p[k]);
    return t(label[0], p);
  }

  // A value of a `value` change as text, by the slot it is pinned to.
  function valueText(t, c, v) {
    const slot = c.slot || slotOf(c.path);
    const param = slot.replace(PARAM_OF, '');
    if (c.toName && c.to === v) return c.toName;
    if (slot === 'cam.shot') return labelText(t, SHOT.label(v));
    if (slot === 'rig') return labelText(t, SHOT.rigLabel(v));
    if (CURVE_SLOT.test(slot)) return labelText(t, CV.label(v));
    if (slot === 'motion.speed') return Math.round(v * 100) + '%';
    if (slot === 'cam.zoom' || (param === 'speed' && slot !== param)) return '×' + v;
    if (slot === 'season') return t('fld.season.' + v);
    if (param === 'depth' && slot !== param && t.has('opt.depth.' + v)) return t('opt.depth.' + v);
    if (slot === 'avoid' && Array.isArray(v)) return v.map((ref) => t.part(ref.split('.')[0], ref.split('.')[1])).join('・');
    if (typeof v === 'number') return String(Math.round(v * 100) / 100);
    return String(v);
  }

  // The label text of a part kind or slot: 'kind.<kind>', 'fld.atmos' for the atmosphere, else the text itself.
  function kindText(t, kind) {
    const base = String(kind).replace(/#[0-9]$/, '');
    if (base === 'atmos') return t('fld.atmos');
    return t.has('kind.' + base) ? t('kind.' + base) : base;
  }

  function shown(t, c, key, v) {
    if (v === null || v === undefined) return c.kind === 'value' || c.areaKey || c.cutKey ? t('curve.auto') : '';
    if (typeof v === 'string' && v.startsWith(MAT_PREFIX) && c.matName) return c.matName;
    if (c.kind === 'part') return v === 'none' ? t('opt.none') : t.part(c.partKind, v);
    if (c.kind === 'value') return valueText(t, c, v);
    if (NAMED[c.kind]) return t.part(NAMED[c.kind], v);
    if (c.kind === 'season') return t('fld.season.' + v);
    if (c.kind === 'time') return T.fmtTime(v);
    if (typeof v === 'number') return String(Math.round(v * 100) / 100);
    return String(v);
  }

  // The field of a value or part change as text: its field key, plus the kind it belongs to ('緩急 · 入り').
  function fieldText(t, c, field) {
    const text = t.has(field) ? t(field) : field;
    return c.fieldKind ? text + ' · ' + kindText(t, c.fieldKind) : text;
  }

  // The review row text: t(label key) with part, theme, mood and season names, and times, resolved.
  function describe(c, t) {
    const [key, params] = c.label;
    const p = Object.assign({}, params);
    if ('from' in p) p.from = shown(t, c, 'from', p.from);
    if ('to' in p) p.to = shown(t, c, 'to', p.to);
    if (Array.isArray(p.where)) p.where = t(p.where[0], p.where[1]);
    if (typeof p.field === 'string') p.field = fieldText(t, c, p.field);
    if (c.kind === 'material') {
      if ('kind' in p) p.kind = kindText(t, p.kind);
      if ('season' in p) p.season = t('fld.season.' + (p.season || 'none'));
      return t(key, p);
    }
    if (c.kind === 'media' && p.caption && typeof p.caption === 'object') p.caption = p.caption[t.lang] || p.caption.ja || '';
    if ('kind' in p) p.kind = kindText(t, p.kind);
    if ('part' in p && c.filterKind) p.part = t.part(c.filterKind, p.part);
    if ('what' in p) p.what = t('fld.amount.' + p.what);
    if (c.fromSource === 'auto' && 'from' in params && params.from !== null) p.from = t(AUTO_LABEL, { v: p.from });
    // a change that hands the value back to the planner shows what the planner will choose (e.g. a season pin cleared)
    if (c.toSource === 'auto' && 'to' in params && params.to !== null) p.to = t(AUTO_LABEL, { v: p.to });
    return t(key, p);
  }

  // The text of an aggregate row (the changes sharing one `agg`): 「動きの速さ: 100% → 50%（5行）」; `from` is shown when
  // every row has the same one, else as auto.
  function describeAgg(list, t) {
    const first = list[0];
    const params = first.label && first.label[1] ? first.label[1] : {};
    const field = typeof params.field === 'string' ? params.field : 'kind.' + first.partKind;
    const same = list.every((c) => sameJSON(c.from, first.from));
    return t('ai.ch.agg', { field: fieldText(t, first, field), from: shown(t, first, 'from', same ? first.from : null),
      to: shown(t, first, 'to', first.to), n: list.length });
  }

  // A validator warning ([stringKey, params]) as text: part kinds and keys become their names; a `field` (value
  // slots) names the setting instead of a kind.
  function warningText(w, t) {
    const [key, params] = w;
    const p = Object.assign({}, params);
    if (p.kind && p.key) p.key = t.part(String(p.kind).replace(/#[0-9]$/, '').replace(/^atmos$/, 'ornament'), p.key);
    if (p.field) p.kind = fieldText(t, {}, p.field);
    else if (p.kind) p.kind = kindText(t, p.kind);
    return t(key, p);
  }

  return {
    KINDS, GROUPS, AREA_GROUPS, STALE_WHY, FLASH_ON, make, snapshot, rowSrcs, lineResolver, markStale, groupOf, toCommands, apply,
    logEntry, revertCommands, describe, describeAgg, warningText, sameJSON, entryHash, keyInUse, inArea,
  };
});
