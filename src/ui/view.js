/* 文字PVメーカー v2 — original work. The view store: selection, step, panels, playhead, modes and preferences (never undoable). */
MV.def('ui/view', ['ui/layout', 'ui/selection'], (L, S) => {
  'use strict';

  const STEPS = Object.freeze(['lyrics', 'song', 'look', 'export']);
  const PANELS = Object.freeze(['details', 'ai']);
  const MODES = Object.freeze(['normal', 'tap', 'tryon']);
  const PREF_KEY = 'mojipv.prefs';
  const DEFAULT_PREFS = Object.freeze({
    singleKeys: true,         // 1文字キーを使う (WCAG 2.1.4)
    autoFold: true,           // 詳細を開いたらたたむ
    autoplay: true,           // 貼り付け後に自動再生
    seekOnSelect: true,       // 選択で再生位置を移動
    follow: true,             // 再生位置に追従
    reduceFlash: false,       // 点滅を抑える (preview only)
    safeArea: false,          // 安全枠
    ai: true,                 // AIを使う
    quality: 'auto',          // プレビューの画質 auto | smooth | sharp
    muted: false,
    hintOmakase: true,        // the first-time おまかせ hint is still to be shown
    hintStacked: true,        // the one-time narrow-window note is still to be shown
  });

  // Whether the preview sound is off: the stored preference, or the one-off first-run autoplay mute.
  function isMuted(state) { return !!(state.prefs.muted || state.autoMuted); }

  function initialState(prefs) {
    return {
      sel: S.WORK, step: 'lyrics', panel: null, rail: false, railBy: null, drawer: false,
      playing: false, time: 0, mode: 'normal', compare: false, focusField: null, highlight: null, aiReview: false,
      autoMuted: false,         // the one-off mute of the first-run autoplay (§6.9.2); never stored in prefs
      prefs,
    };
  }

  // Reads stored preferences; unknown keys and wrong types are ignored; any storage failure gives the defaults.
  function readPrefs(storage, key) {
    const out = Object.assign({}, DEFAULT_PREFS);
    try {
      const raw = storage && storage.getItem(key);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && typeof saved === 'object') {
        for (const k of Object.keys(DEFAULT_PREFS)) {
          if (typeof saved[k] === typeof DEFAULT_PREFS[k]) out[k] = saved[k];
        }
      }
    } catch (e) { /* private mode, quota or corrupt JSON: defaults */ }
    return out;
  }

  // createView({ storage?, key? }) → view store. storage is an injected Storage-like object (localStorage in the
  // browser); every access is wrapped so the app works without it.
  function createView(opts) {
    const o = opts || {};
    const key = o.key || PREF_KEY;
    const storage = o.storage || null;
    let state = initialState(readPrefs(storage, key));
    const listeners = [];

    function emit(changed) {
      for (const fn of listeners.slice()) fn(changed, state);
    }

    // set(patch) → the list of changed keys (shallow compare; the selection compares by value).
    function set(patch) {
      const changed = [];
      const next = Object.assign({}, state);
      for (const k of Object.keys(patch || {})) {
        if (!(k in state) || k === 'prefs') continue;
        const v = patch[k];
        const same = k === 'sel' ? S.equal(v, state.sel) : v === state[k];
        if (!same) { next[k] = v; changed.push(k); }
      }
      if (!changed.length) return changed;
      state = next;
      emit(changed);
      return changed;
    }

    function setPref(name, value) {
      if (!(name in DEFAULT_PREFS) || typeof value !== typeof DEFAULT_PREFS[name] || state.prefs[name] === value) return false;
      const prefs = Object.assign({}, state.prefs, { [name]: value });
      state = Object.assign({}, state, { prefs });
      try { if (storage) storage.setItem(key, JSON.stringify(prefs)); } catch (e) { /* not persisted; still applied */ }
      emit(['prefs']);
      return true;
    }

    // Opening 詳細 / AI: auto-folds the step column (§6.2) and remembers that the fold was automatic.
    function openPanel(panel, how) {
      if (!PANELS.includes(panel)) return [];
      const h = how || {};
      const patch = { panel };
      if (!state.rail && L.autoFold({ layout: h.layout, openedFrom: h.from, pref: state.prefs.autoFold })) {
        patch.rail = true;
        patch.railBy = 'auto';
      }
      return set(patch);
    }

    // Closing restores a column that was auto-folded (not one the user folded).
    function closePanel() {
      const patch = { panel: null };
      if (state.rail && state.railBy === 'auto') { patch.rail = false; patch.railBy = null; }
      return set(patch);
    }

    function togglePanel(panel, how) {
      return state.panel === panel ? closePanel() : openPanel(panel, how);
    }

    // Folding by hand (« / the rail's expand button) is the user's choice and is never undone automatically.
    function setRail(on) { return set({ rail: !!on, railBy: on ? 'user' : null }); }

    function on(fn) {
      listeners.push(fn);
      return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }

    return {
      get state() { return state; },
      get: (k) => state[k],
      set, setPref, openPanel, closePanel, togglePanel, setRail, on,
    };
  }

  return { STEPS, PANELS, MODES, PREF_KEY, DEFAULT_PREFS, createView, readPrefs, isMuted };
});
