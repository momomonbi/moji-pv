/* 文字PVメーカー v2 — original work. The store: the only mutable state; history and undo by snapshot swap (DESIGN §3.10, §4.5). */
MV.def('core/store', ['core/doc'], (D) => {
  'use strict';

  const DEFAULT_LIMIT = 300;
  const MERGE_WINDOW_MS = 2000;                 // same mergeKey within 2 s coalesces (typing bursts)
  const DEFAULT_LABEL = Object.freeze(['undo.edit', Object.freeze({})]);
  const EVENTS = ['doc', 'side'];

  class StoreError extends Error {
    constructor(code, message) { super(message || code); this.name = 'StoreError'; this.code = code; }
  }

  function deepFreeze(v) {
    if (v === null || typeof v !== 'object' || Object.isFrozen(v) || ArrayBuffer.isView(v)) return v;
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    return v;
  }

  function devMode() { return typeof MV !== 'undefined' && MV.DEV === true; }

  // createStore({ doc, side, reduce, limit = 300 }) plus two optional hooks:
  //   now()  → milliseconds, for the 2 s typing window (the store itself never reads a clock; without it only seal()
  //            and gestures end a coalescing run); meta.at (ms) overrides it per dispatch.
  //   freeze → deep-freeze documents (default: MV.DEV).
  function createStore(opts) {
    if (!opts || typeof opts.reduce !== 'function') throw new StoreError('bad-options', 'createStore needs { doc, reduce }');
    const reduce = opts.reduce;
    const limit = opts.limit === undefined ? DEFAULT_LIMIT : opts.limit;
    if (!Number.isInteger(limit) || limit < 1) throw new StoreError('bad-options', 'limit must be a positive integer');
    const clock = typeof opts.now === 'function' ? opts.now : null;
    const freeze = opts.freeze === undefined ? devMode() : !!opts.freeze;
    const listeners = { doc: [], side: [] };

    let doc = freeze ? deepFreeze(opts.doc) : opts.doc;
    let side = opts.side === undefined ? D.defaultSide() : opts.side;
    let rev = 0;
    let entries = [];          // history, oldest first
    let pos = 0;               // entries[0 .. pos) are applied; the rest can be redone
    let counter = 0;           // entry numbers (n) are never reused
    let gesture = null;        // { key } while a gesture is open

    function emit(event, payload) {
      let failure = null;
      for (const fn of listeners[event].slice()) {
        try { fn(payload); } catch (e) { if (!failure) failure = e; }
      }
      if (failure) throw failure;
    }

    function timeOf(meta) {
      if (typeof meta.at === 'number') return meta.at;
      return clock ? clock() : null;
    }

    function canMerge(top, key, at) {
      if (!top || !top.open || key === undefined || key === null || top.mergeKey !== key || pos !== entries.length) return false;
      if (gesture && top.gesture === gesture) return true;
      return at === null || top.at === null || at - top.at <= MERGE_WINDOW_MS;
    }

    function record(before, after, meta, cmds, at) {
      const sel = meta.sel || {};
      const top = pos > 0 ? entries[pos - 1] : null;
      const key = meta.mergeKey;
      if (canMerge(top, key, at)) {
        top.after = after;
        top.at = at;
        top.cmds.push(...cmds);
        if ('after' in sel) top.selAfter = sel.after;
        if (top.after === top.before) { entries.pop(); pos -= 1; }   // the run cancelled itself out
        return;
      }
      if (top) top.open = false;
      entries.length = pos;
      entries.push({
        n: ++counter, before, after, label: meta.label || DEFAULT_LABEL, where: meta.where === undefined ? null : meta.where,
        mergeKey: key === undefined ? null : key, selBefore: 'before' in sel ? sel.before : null,
        selAfter: 'after' in sel ? sel.after : null, cmds: cmds.slice(), open: key !== undefined && key !== null,
        gesture: gesture && gesture.key === key ? gesture : null, at,
      });
      while (entries.length > limit) entries.shift();
      pos = entries.length;
    }

    function apply(cmd, meta, cmds) {
      const m = meta || {};
      const before = doc;
      const after = reduce(before, cmd);
      if (after === before) return rev;
      if (freeze) deepFreeze(after);
      record(before, after, m, cmds, timeOf(m));
      doc = after;
      rev += 1;
      const sel = m.sel && 'after' in m.sel ? m.sel.after : null;
      emit('doc', { rev, kind: 'do', cmds, touched: D.touched(before, after), where: m.where === undefined ? null : m.where, sel });
      return rev;
    }

    function dispatch(cmd, meta) {
      if (!cmd || typeof cmd.t !== 'string') throw new StoreError('bad-command', 'a command needs a string t');
      return apply(cmd, meta, [cmd]);
    }

    function batch(meta, cmds) {
      if (!Array.isArray(cmds)) throw new StoreError('bad-command', 'batch needs a list of commands');
      if (cmds.length === 0) return rev;
      return apply({ t: 'batch', cmds }, meta, cmds);
    }

    function seal() {
      if (pos > 0) entries[pos - 1].open = false;
    }

    function openGesture(mergeKey) {
      seal();
      const token = { key: mergeKey };
      gesture = token;
      return {
        end() {
          if (gesture !== token) return;
          gesture = null;
          seal();
        },
      };
    }

    // Moves to the state where the first `target` entries are applied; one 'doc' event.
    function moveTo(target, kind) {
      const prev = doc;
      const crossed = kind === 'undo' ? entries.slice(target, pos).reverse() : entries.slice(pos, target);
      const edge = kind === 'undo' ? entries[target] : entries[target - 1];
      seal();
      doc = target === 0 ? entries[0].before : entries[target - 1].after;
      pos = target;
      rev += 1;
      const sel = kind === 'undo' ? edge.selBefore : edge.selAfter;
      const cmds = [].concat(...crossed.map((e) => e.cmds));
      emit('doc', { rev, kind, cmds, touched: D.touched(prev, doc), where: edge.where, sel });
      return { where: edge.where, sel };
    }

    function undo() { return pos === 0 ? null : moveTo(pos - 1, 'undo'); }
    function redo() { return pos === entries.length ? null : moveTo(pos + 1, 'redo'); }

    // jump(n): the state right after entry n (n = 0: before every entry).
    function jump(n) {
      const i = n === 0 ? -1 : entries.findIndex((e) => e.n === n);
      if (n !== 0 && i < 0) throw new StoreError('unknown-entry', 'no history entry ' + n);
      const target = i + 1;
      if (target === pos) return null;
      return moveTo(target, target < pos ? 'undo' : 'redo');
    }

    function peek() {
      return {
        undo: pos > 0 ? entries[pos - 1].label : null,
        redo: pos < entries.length ? entries[pos].label : null,
      };
    }

    function list() {
      return entries.map((e, i) => ({ n: e.n, label: e.label, done: i < pos }));
    }

    function setSide(fn) {
      const next = fn(side);
      if (next === side) return;
      side = next;
      emit('side', { side });
    }

    function load(nextDoc, nextSide) {
      const prev = doc;
      doc = freeze ? deepFreeze(nextDoc) : nextDoc;
      side = nextSide === undefined ? D.defaultSide() : nextSide;
      entries = [];
      pos = 0;
      gesture = null;
      rev += 1;
      const touched = Object.assign(D.touched(prev, doc), { rows: 'all' });
      emit('doc', { rev, kind: 'load', cmds: [], touched, where: null, sel: null });
      emit('side', { side });
    }

    function on(event, fn) {
      if (!EVENTS.includes(event)) throw new StoreError('bad-event', 'unknown store event ' + event);
      listeners[event].push(fn);
      return () => {
        const i = listeners[event].indexOf(fn);
        if (i >= 0) listeners[event].splice(i, 1);
      };
    }

    return Object.freeze({
      get doc() { return doc; },
      get side() { return side; },
      get rev() { return rev; },
      dispatch, batch, gesture: openGesture, seal, undo, redo, peek, list, jump, setSide, load, on,
    });
  }

  return { createStore, deepFreeze, StoreError, DEFAULT_LIMIT, MERGE_WINDOW_MS };
});
