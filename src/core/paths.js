/* 文字PVメーカー v2 — original work. Slot paths: parse, format and scope helpers for the FROZEN grammar (DESIGN §3.4, §4.3). */
MV.def('core/paths', [], () => {
  'use strict';

  const KINDS = Object.freeze(['arrange', 'arrive', 'dwell', 'depart', 'ornament', 'lens', 'filter', 'ground', 'atmos',
    'seam', 'texture']);
  const SPECIAL_CUTS = Object.freeze(['title', 'intro', 'outro']);
  const LINE_ID = /^r[0-9a-z]+(?:\.[1-9][0-9]*)?$/;
  const LINE_CUT = /^(r[0-9a-z]+(?:\.[1-9][0-9]*)?)~([0-9]+)$/;
  const PART_SLOT = /^([a-z]+)(?:#([012]))?(?:@([a-z][A-Za-z0-9]{2,31}))?(?:\.([a-z][A-Za-z0-9]{0,31}))?$/;
  const EL_SLOT = /^el\.(text|ornament#[012])\.(nudge|fill|hide)$/;
  const NAME_SLOT = /^[a-z][A-Za-z0-9]{0,31}(?:\.[a-z][A-Za-z0-9]{0,31})*$/;
  const PART_KEY = /^[a-z][A-Za-z0-9]{2,31}$/;
  const PARAM = /^[a-z][A-Za-z0-9]{0,31}$/;

  class PathError extends Error {
    constructor(code, message) { super(message); this.name = 'PathError'; this.code = code; }
  }

  function fail(code, what) { throw new PathError(code, code + ': ' + JSON.stringify(what)); }

  function isLineId(id) { return typeof id === 'string' && LINE_ID.test(id); }

  // Cut key → its line id ('r3~4' → 'r3'); null for special cuts; throws 'bad-cut-key' for anything else.
  function lineOfCut(cutKey) {
    if (typeof cutKey === 'string') {
      const m = LINE_CUT.exec(cutKey);
      if (m) return m[1];
      if (SPECIAL_CUTS.includes(cutKey)) return null;
      if (cutKey.startsWith('gap/') && isLineId(cutKey.slice(4))) return null;
    }
    return fail('bad-cut-key', cutKey);
  }

  // Cut key → its character offset ('r3~4' → 4); null for special cuts.
  function cutOffset(cutKey) {
    const m = typeof cutKey === 'string' ? LINE_CUT.exec(cutKey) : null;
    if (m) return Number(m[2]);
    lineOfCut(cutKey);                       // throws for a malformed key
    return null;
  }

  // 'work' | 'line/<id>' | 'cut/<key>' → { kind, id, lineId }.
  function parseScope(text) {
    if (text === 'work') return { kind: 'work', id: null, lineId: null };
    if (text.startsWith('line/')) {
      const id = text.slice(5);
      if (!isLineId(id)) fail('bad-line-id', id);
      return { kind: 'line', id, lineId: id };
    }
    if (text.startsWith('cut/')) {
      const id = text.slice(4);
      return { kind: 'cut', id, lineId: lineOfCut(id) };
    }
    return fail('bad-scope', text);
  }

  // Slot text → { part, el, name } following the grammar of §3.4: the first token (up to '#', '@' or '.') decides
  // the branch — a KIND takes the part grammar, 'el' the element grammar, anything else the NAME grammar.
  function parseSlot(slot) {
    const first = /^[^#@.]*/.exec(slot)[0];
    if (KINDS.includes(first)) {
      const m = PART_SLOT.exec(slot);
      if (!m || m[1] !== first) fail('bad-slot', slot);
      const part = { kind: first, idx: m[2] === undefined ? null : Number(m[2]), key: m[3] || null, param: m[4] || null };
      return { part, el: null, name: null };
    }
    if (first === 'el') {
      const m = EL_SLOT.exec(slot);
      if (!m) fail('bad-slot', slot);
      return { part: null, el: { owner: m[1], field: m[2] }, name: null };
    }
    if (!NAME_SLOT.test(slot)) fail('bad-slot', slot);
    return { part: null, el: null, name: slot };
  }

  function parse(path) {
    if (typeof path !== 'string') fail('bad-scope', path);
    const colon = path.indexOf(':');
    const scopeText = colon < 0 ? path : path.slice(0, colon);
    const scope = parseScope(scopeText);
    if (colon < 0) fail('bad-slot', path);
    const slot = path.slice(colon + 1);
    const { part, el, name } = parseSlot(slot);
    return { scope, slot, part, el, name };
  }

  function scopeText(scope) {
    if (typeof scope === 'string') return scope;
    if (!scope || typeof scope !== 'object') return fail('bad-scope', scope);
    if (scope.kind === 'work') return 'work';
    if (scope.kind === 'line' || scope.kind === 'cut') return scope.kind + '/' + scope.id;
    return fail('bad-scope', scope.kind);
  }

  // Exact inverse of parse: format(parse(p)) === p. Throws PathError when the result would not parse.
  function format({ scope, slot }) {
    const path = scopeText(scope) + ':' + slot;
    parse(path);
    return path;
  }

  // The scope part of a path. Also accepts a bare scope (salt keys such as 'cut/r3~0').
  function scopeKey(path) {
    if (typeof path === 'string' && path.indexOf(':') < 0) {
      parseScope(path);
      return path;
    }
    return scopeText(parse(path).scope);
  }

  // True when the path's scope is `scope`, or a cut of that line (scope 'line/<id>'), or anything (scope 'work').
  // Special cuts belong to no line. Bare scopes are accepted as the path.
  function isUnder(path, scope) {
    const own = scopeKey(path);
    if (scope === 'work' || own === scope) return true;
    if (!scope.startsWith('line/') || !own.startsWith('cut/')) return false;
    return lineOfCut(own.slice(4)) === scope.slice(5);
  }

  // Slot string for a part choice or parameter:
  //   ('arrive', null, 'inkRise', 'dur', true)      → 'arrive.dur'
  //   ('arrive', null, 'inkRise', 'yFrom', false)   → 'arrive@inkRise.yFrom'
  //   ('ornament', 1, 'hankoSeal', 'size', false)   → 'ornament#1@hankoSeal.size'
  //   ('ornament', 1, null, null)                   → 'ornament#1'
  function slotParamPath(kind, idx, partKey, param, shared) {
    if (!KINDS.includes(kind)) fail('bad-slot', kind);
    let slot = kind;
    if (idx !== null && idx !== undefined) {
      if (idx !== 0 && idx !== 1 && idx !== 2) fail('bad-slot', kind + '#' + idx);
      slot += '#' + idx;
    }
    if (!shared && partKey !== null && partKey !== undefined) {
      if (!PART_KEY.test(partKey)) fail('bad-slot', partKey);
      slot += '@' + partKey;
    }
    if (param !== null && param !== undefined) {
      if (!PARAM.test(param)) fail('bad-slot', param);
      slot += '.' + param;
    }
    return slot;
  }

  return { KINDS, parse, format, scopeKey, lineOfCut, cutOffset, isUnder, slotParamPath, isLineId, PathError };
});
