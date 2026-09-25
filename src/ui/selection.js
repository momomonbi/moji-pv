/* 文字PVメーカー v2 — original work. The selection: one Sel for the whole app, drill up/down, crumbs, preview picks (DESIGN §6.5, §4.23). */
MV.def('ui/selection', ['core/paths'], (P) => {
  'use strict';

  const WORK = Object.freeze({ level: 'work' });
  const ELS = Object.freeze(['text', 'ornament', 'ground', 'lens', 'filter', 'seam']);
  const LIST_ELS = Object.freeze(['ornament', 'filter']);
  const SPECIAL_LABEL = { title: 'crumb.title', intro: 'crumb.intro', outro: 'crumb.outro' };

  // Per-plan lookup tables (plans are immutable, so a WeakMap cache is safe).
  const cache = new WeakMap();
  function indexOf(plan) {
    if (!plan || typeof plan !== 'object') return { lines: [], lineById: new Map(), cuts: [], cutByKey: new Map(), cutPos: new Map() };
    let ix = cache.get(plan);
    if (ix) return ix;
    const lines = Array.isArray(plan.lines) ? plan.lines : [];
    const cuts = Array.isArray(plan.cuts) ? plan.cuts : [];
    ix = {
      lines, cuts,
      lineById: new Map(lines.map((l, i) => [l.id, Object.assign({ pos: i }, l)])),
      cutByKey: new Map(cuts.map((c) => [c.key, c])),
      cutPos: new Map(cuts.map((c, i) => [c.key, i])),
    };
    cache.set(plan, ix);
    return ix;
  }

  function lineSel(id) { return { level: 'line', ids: [id] }; }
  function cutSel(key) { return { level: 'cut', key }; }

  function cutsOfLine(ix, lineId) {
    const line = ix.lineById.get(lineId);
    return line && Array.isArray(line.cuts) ? line.cuts : [];
  }

  function lineOfCutKey(key) {
    try { return P.lineOfCut(key); } catch (e) { return null; }
  }

  // A lyric cut whose line has exactly one cut is shown at line level (the cut level is skipped, §6.4.6).
  function isSoleCut(ix, key) {
    const lineId = lineOfCutKey(key);
    return lineId !== null && cutsOfLine(ix, lineId).length === 1;
  }

  function ownerToEl(owner) {
    const m = /^(text|ornament|ground|lens|filter|seam|atmos)(?:#([012]))?$/.exec(String(owner || 'text'));
    if (!m) return { el: 'text' };
    const el = m[1] === 'atmos' ? 'ground' : m[1];
    return LIST_ELS.includes(el) ? { el, idx: m[2] === undefined ? 0 : Number(m[2]) } : { el };
  }

  function elSel(scope, owner) {
    return Object.assign({ level: 'el', scope }, ownerToEl(owner));
  }

  function scopeOfCut(ix, key) {
    return isSoleCut(ix, key) ? 'line/' + lineOfCutKey(key) : 'cut/' + key;
  }

  // --- down / up ----------------------------------------------------------------------------------------------

  function down(sel, plan) {
    const ix = indexOf(plan);
    const s = validate(sel, plan);
    if (s.level === 'work') return ix.lines.length ? lineSel(ix.lines[0].id) : s;
    if (s.level === 'line') {
      const id = s.ids[0];
      const cuts = cutsOfLine(ix, id);
      return cuts.length > 1 ? cutSel(cuts[0]) : { level: 'el', scope: 'line/' + id, el: 'text' };
    }
    if (s.level === 'cut') return { level: 'el', scope: scopeOfCut(ix, s.key), el: 'text' };
    return s;
  }

  function up(sel, plan) {
    const ix = indexOf(plan);
    const s = validate(sel, plan);
    if (s.level === 'el') {
      if (s.scope === 'work') return WORK;
      if (s.scope.startsWith('line/')) return lineSel(s.scope.slice(5));
      const key = s.scope.slice(4);
      return isSoleCut(ix, key) ? lineSel(lineOfCutKey(key)) : cutSel(key);
    }
    if (s.level === 'cut') {
      const lineId = lineOfCutKey(s.key);
      return lineId && ix.lineById.has(lineId) ? lineSel(lineId) : WORK;
    }
    return WORK;
  }

  // --- validate -----------------------------------------------------------------------------------------------

  // Keeps the selection when everything it names still exists; otherwise climbs to the nearest surviving ancestor.
  function validate(sel, plan) {
    const ix = indexOf(plan);
    if (!sel || typeof sel !== 'object') return WORK;
    switch (sel.level) {
      case 'work': return WORK;
      case 'line': {
        const ids = Array.isArray(sel.ids) ? sel.ids.filter((id) => ix.lineById.has(id)) : [];
        if (!ids.length) return WORK;
        return ids.length === sel.ids.length ? sel : { level: 'line', ids };
      }
      case 'cut': return validCut(ix, sel.key, sel);
      case 'el': return validEl(ix, sel);
      default: return WORK;
    }
  }

  function validCut(ix, key, keep) {
    if (ix.cutByKey.has(key)) return keep || cutSel(key);
    const lineId = lineOfCutKey(key);
    return lineId && ix.lineById.has(lineId) ? lineSel(lineId) : WORK;
  }

  function validEl(ix, sel) {
    if (!ELS.includes(sel.el) || typeof sel.scope !== 'string') return WORK;
    const idxOk = !LIST_ELS.includes(sel.el) || [0, 1, 2].includes(sel.idx === undefined ? 0 : sel.idx);
    if (!idxOk) return WORK;
    if (sel.scope === 'work') return sel;
    if (sel.scope.startsWith('line/')) {
      const id = sel.scope.slice(5);
      return ix.lineById.has(id) ? sel : WORK;
    }
    if (sel.scope.startsWith('cut/')) {
      const key = sel.scope.slice(4);
      return ix.cutByKey.has(key) ? sel : validCut(ix, key, null);
    }
    return WORK;
  }

  // --- crumbs -------------------------------------------------------------------------------------------------

  function lineCrumb(ix, id) {
    const line = ix.lineById.get(id);
    return { sel: lineSel(id), label: ['crumb.line', { n: line ? (line.index === undefined ? line.pos : line.index) + 1 : '?' }] };
  }

  function cutCrumbs(ix, key) {
    const cut = ix.cutByKey.get(key);
    const lineId = lineOfCutKey(key);
    if (lineId) {
      const k = cutsOfLine(ix, lineId).indexOf(key) + 1;
      const out = [lineCrumb(ix, lineId)];
      if (!isSoleCut(ix, key)) out.push({ sel: cutSel(key), label: ['crumb.cut', { k: k > 0 ? k : '?' }] });
      return out;
    }
    if (SPECIAL_LABEL[key]) return [{ sel: cutSel(key), label: [SPECIAL_LABEL[key], {}] }];
    const after = String(key).startsWith('gap/') ? ix.lineById.get(key.slice(4)) : null;
    const n = after ? (after.index === undefined ? after.pos : after.index) + 1 : '?';
    return cut || after ? [{ sel: cutSel(key), label: ['crumb.gap', { n }] }] : [];
  }

  function elCrumb(sel) {
    if (LIST_ELS.includes(sel.el)) return { sel, label: ['crumb.' + sel.el, { k: (sel.idx || 0) + 1 }] };
    return { sel, label: ['el.' + sel.el, {}] };
  }

  // crumbs(sel, plan) → [{ sel, label: [stringKey, params] }], the root first (「全体 › 12行 › カット2 › 文字」).
  function crumbs(sel, plan) {
    const ix = indexOf(plan);
    const s = validate(sel, plan);
    const out = [{ sel: WORK, label: ['crumb.work', {}] }];
    if (s.level === 'line') {
      out.push(s.ids.length === 1 ? lineCrumb(ix, s.ids[0]) : { sel: s, label: ['crumb.lines', { n: s.ids.length }] });
    } else if (s.level === 'cut') {
      out.push(...cutCrumbs(ix, s.key));
    } else if (s.level === 'el') {
      if (s.scope.startsWith('line/')) out.push(lineCrumb(ix, s.scope.slice(5)));
      else if (s.scope.startsWith('cut/')) out.push(...cutCrumbs(ix, s.scope.slice(4)));
      out.push(elCrumb(s));
    }
    return out;
  }

  // --- preview clicks -----------------------------------------------------------------------------------------

  function hitScope(ix, hit) { return scopeOfCut(ix, hit.cut); }
  function sameEl(sel, ix, hit) {
    if (sel.level !== 'el') return false;
    const want = elSel(hitScope(ix, hit), hit.owner);
    return want.scope === sel.scope && want.el === sel.el && (want.idx || 0) === (sel.idx || 0);
  }

  // The level the current selection sits at, relative to one hit.
  function matches(sel, ix, hit) {
    const lineId = hit.line || lineOfCutKey(hit.cut);
    if (sel.level === 'line') return !!lineId && sel.ids.includes(lineId);
    if (sel.level === 'cut') return sel.key === hit.cut;
    if (sel.level === 'el') return sameEl(sel, ix, hit);
    return false;
  }

  // The selection one hit gives at a level ('line' | 'cut' | 'el').
  function selAt(level, ix, hit) {
    const lineId = hit.line || lineOfCutKey(hit.cut);
    if (level === 'line') return lineId ? lineSel(lineId) : cutSel(hit.cut);
    if (level === 'cut') return lineId && isSoleCut(ix, hit.cut) ? lineSel(lineId) : cutSel(hit.cut);
    return elSel(hitScope(ix, hit), hit.owner);
  }

  function key(sel) { return JSON.stringify(sel); }

  // Alt+click without movement: the next hit below the current one at the same level (wrapping).
  function cycle(sel, ix, hits) {
    const level = sel.level === 'work' ? 'line' : sel.level;
    const options = [];
    for (const hit of hits) {
      const s = selAt(level, ix, hit);
      if (!options.some((o) => key(o) === key(s))) options.push(s);
    }
    const at = options.findIndex((o) => key(o) === key(sel) || (sel.level === 'line' && o.level === 'line' && sel.ids.includes(o.ids[0])));
    return at < 0 ? options[0] : options[(at + 1) % options.length];
  }

  // Drill: first click → the line under the pointer; again on the same spot → its cut (skipped for single-cut lines)
  // → the element. Double-click → straight to the element. opts.plan (additive) lets single-cut lines skip a level.
  function onPreviewClick(sel, hits, opts) {
    const o = opts || {};
    const ix = indexOf(o.plan);
    const s = sel && sel.level ? sel : WORK;
    const list = Array.isArray(hits) ? hits.filter((h) => h && h.cut) : [];
    if (!list.length) return WORK;
    if (o.alt) return cycle(s, ix, list);
    const top = list.find((h) => matches(s, ix, h)) || list[0];
    if (o.dbl) return selAt('el', ix, top);
    if (!matches(s, ix, top)) {
      const topLine = top.line || lineOfCutKey(top.cut);
      const sameLine = topLine && lineOfSel(s) === topLine;
      if (sameLine && (s.level === 'cut' || s.level === 'el')) return selAt(s.level === 'el' ? 'el' : 'cut', ix, top);
      return selAt('line', ix, top);
    }
    if (s.level === 'line') {
      const next = selAt('cut', ix, top);
      return next.level === 'line' ? selAt('el', ix, top) : next;
    }
    if (s.level === 'cut') return selAt('el', ix, top);
    return s;
  }

  // --- walking and helpers ------------------------------------------------------------------------------------

  // The line a selection belongs to (the first one for several lines), or null.
  function lineOfSel(sel) {
    if (!sel) return null;
    if (sel.level === 'line') return sel.ids[0] || null;
    if (sel.level === 'cut') return lineOfCutKey(sel.key);
    if (sel.level === 'el') {
      if (sel.scope.startsWith('line/')) return sel.scope.slice(5);
      if (sel.scope.startsWith('cut/')) return lineOfCutKey(sel.scope.slice(4));
    }
    return null;
  }

  // The cut keys a selection covers (every cut of the selected lines), in time order.
  function cutsOf(sel, plan) {
    const ix = indexOf(plan);
    const s = validate(sel, plan);
    if (s.level === 'line') return [].concat(...s.ids.map((id) => cutsOfLine(ix, id)));
    if (s.level === 'cut') return [s.key];
    if (s.level === 'el' && s.scope.startsWith('cut/')) return [s.scope.slice(4)];
    if (s.level === 'el' && s.scope.startsWith('line/')) return cutsOfLine(ix, s.scope.slice(5)).slice();
    return [];
  }

  // ↑/↓: the previous / next line (from nothing: the first or the last).
  function nextLine(sel, plan, d) {
    const ix = indexOf(plan);
    if (!ix.lines.length) return WORK;
    const cur = lineOfSel(validate(sel, plan));
    const at = cur ? ix.lineById.get(cur).pos : -1;
    let to = at < 0 ? (d > 0 ? 0 : ix.lines.length - 1) : at + (d > 0 ? 1 : -1);
    to = Math.max(0, Math.min(ix.lines.length - 1, to));
    return lineSel(ix.lines[to].id);
  }

  // , / .: the previous / next cut in time order, across lines; single-cut lines land at line level.
  function nextCut(sel, plan, d) {
    const ix = indexOf(plan);
    if (!ix.cuts.length) return WORK;
    const own = cutsOf(sel, plan);
    const at = own.length ? ix.cutPos.get(d > 0 ? own[own.length - 1] : own[0]) : -1;
    let to = at === undefined || at < 0 ? (d > 0 ? 0 : ix.cuts.length - 1) : at + (d > 0 ? 1 : -1);
    to = Math.max(0, Math.min(ix.cuts.length - 1, to));
    const cutKey = ix.cuts[to].key;
    return isSoleCut(ix, cutKey) ? lineSel(lineOfCutKey(cutKey)) : cutSel(cutKey);
  }

  // The hero time to seek to when something is selected (plan.cuts[i].repT), or null.
  function seekTime(sel, plan) {
    const ix = indexOf(plan);
    const keys = cutsOf(sel, plan);
    const cut = keys.length ? ix.cutByKey.get(keys[0]) : null;
    return cut && Number.isFinite(cut.repT) ? cut.repT : null;
  }

  // The pin scope of a selection: 'work' | 'line/<id>' | 'cut/<key>' (element pages use their own scope).
  function scopeOf(sel, plan) {
    const s = validate(sel, plan);
    if (s.level === 'line') return 'line/' + s.ids[0];
    if (s.level === 'cut') return scopeOfCut(indexOf(plan), s.key);
    if (s.level === 'el') return s.scope;
    return 'work';
  }

  function equal(a, b) { return key(validateShape(a)) === key(validateShape(b)); }
  function validateShape(s) { return s && s.level ? s : WORK; }

  // Toggle / range for gutter clicks (Ctrl / Shift): a line selection over plan order.
  function withLine(sel, plan, lineId, mode) {
    const ix = indexOf(plan);
    if (!ix.lineById.has(lineId)) return validate(sel, plan);
    const cur = sel && sel.level === 'line' ? sel.ids.filter((id) => ix.lineById.has(id)) : [];
    if (mode === 'toggle') {
      const ids = cur.includes(lineId) ? cur.filter((id) => id !== lineId) : cur.concat([lineId]);
      return ids.length ? { level: 'line', ids: sortIds(ix, ids) } : WORK;
    }
    if (mode === 'range' && cur.length) {
      const a = ix.lineById.get(cur[0]).pos, b = ix.lineById.get(lineId).pos;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      return { level: 'line', ids: ix.lines.slice(lo, hi + 1).map((l) => l.id) };
    }
    return lineSel(lineId);
  }

  function sortIds(ix, ids) { return ids.slice().sort((a, b) => ix.lineById.get(a).pos - ix.lineById.get(b).pos); }

  return {
    WORK, ELS, down, up, validate, crumbs, onPreviewClick, lineOfSel, cutsOf, nextLine, nextCut, seekTime, scopeOf,
    equal, withLine,
  };
});
