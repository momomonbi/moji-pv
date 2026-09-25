/* 文字PVメーカー v2 — original work. The action registry: buttons, keys, menus, the palette and tests share it (DESIGN §6.1.6, §4.23). */
MV.def('ui/actions', ['ui/keys'], (K) => {
  'use strict';

  const ID = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)+$/;

  class ActionError extends Error {
    constructor(code, message) { super(message); this.name = 'ActionError'; this.code = code; }
  }

  // createActions(getCtx) → { defineAction, run, list, get, has, enabled, checked }. getCtx() is called on every
  // run/enabled/checked so actions always see the current app state.
  function createActions(getCtx) {
    const defs = new Map();
    const ctxOf = typeof getCtx === 'function' ? getCtx : () => ({});

    // defineAction({ id, label: stringKey, keys?, run(ctx, args), enabled?(ctx), checked?(ctx) })
    function defineAction(def) {
      if (!def || typeof def.id !== 'string' || !ID.test(def.id)) throw new ActionError('bad-id', 'bad action id ' + (def && def.id));
      if (defs.has(def.id)) throw new ActionError('duplicate', 'duplicate action ' + def.id);
      if (typeof def.run !== 'function') throw new ActionError('bad-run', def.id + ': run must be a function');
      const keys = Array.isArray(def.keys) ? def.keys.slice() : K.keysFor(def.id);
      defs.set(def.id, Object.freeze({
        id: def.id, label: def.label || 'cmd.' + def.id, keys: Object.freeze(keys), run: def.run,
        enabled: typeof def.enabled === 'function' ? def.enabled : null,
        checked: typeof def.checked === 'function' ? def.checked : null,
      }));
      return def.id;
    }

    function get(id) { return defs.get(id) || null; }
    function has(id) { return defs.has(id); }

    function isEnabled(id) {
      const def = defs.get(id);
      if (!def) return false;
      return def.enabled ? !!def.enabled(ctxOf()) : true;
    }

    function isChecked(id) {
      const def = defs.get(id);
      return !!(def && def.checked && def.checked(ctxOf()));
    }

    // run(id, args) → true when the action ran and handled the input, false when it is disabled or declined
    // (an action may return false to let the browser keep the key, e.g. Ctrl+← outside the timeline).
    function run(id, args) {
      const def = defs.get(id);
      if (!def) throw new ActionError('unknown', 'unknown action ' + id);
      const ctx = ctxOf();
      if (def.enabled && !def.enabled(ctx)) return false;
      return def.run(ctx, args || null) !== false;
    }

    // list(filter?) → [{ id, label, keys, enabled, checked }] sorted by id. filter: a substring of the id, or a predicate.
    function list(filter) {
      const pick = typeof filter === 'function' ? filter
        : typeof filter === 'string' && filter ? (d) => d.id.includes(filter) : () => true;
      return [...defs.values()].filter(pick).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((d) => ({ id: d.id, label: d.label, keys: d.keys, enabled: isEnabled(d.id), checked: isChecked(d.id) }));
    }

    return { defineAction, run, list, get, has, enabled: isEnabled, checked: isChecked };
  }

  // The app-wide registry (the frozen names defineAction / run / list). ui/boot sets its context once.
  let appContext = () => ({});
  const main = createActions(() => appContext());
  function setContext(fn) { appContext = typeof fn === 'function' ? fn : () => ({}); }

  return {
    ActionError, createActions, setContext,
    defineAction: main.defineAction, run: main.run, list: main.list, get: main.get, has: main.has,
    enabled: main.enabled, checked: main.checked,
  };
});
