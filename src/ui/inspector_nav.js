/* 文字PVメーカー v2 — original work. Scope-preserving inspector bookmarks. */
MV.def('ui/inspector_nav', ['ui/selection'], (S) => {
  'use strict';

  const KEYS = Object.freeze(['camera', 'cinematic', 'layout', 'text', 'background', 'ornament', 'effects', 'timing', 'media', 'scope']);

  // Keep a selected cut's exact pin scope, including a line with only one cut. Walking up via Selection.up would
  // deliberately collapse that cut to its line; a settings bookmark must not broaden the edit instead.
  function parent(sel) {
    if (sel.level !== 'el') return sel;
    if (sel.scope === 'work') return S.WORK;
    if (sel.scope.startsWith('line/')) return { level: 'line', ids: [sel.scope.slice(5)] };
    return { level: 'cut', key: sel.scope.slice(4) };
  }

  function target(key, selection, plan, doc) {
    if (!KEYS.includes(key)) return null;
    const current = S.validate(selection, plan, doc), base = parent(current);
    const multi = base.level === 'line' && (base.ids.length > 1 || !!base.area);
    const scope = current.level === 'el' ? current.scope : base.level === 'cut' ? 'cut/' + base.key
      : base.level === 'line' ? 'line/' + base.ids[0] : 'work';
    const element = (el) => ({ level: 'el', scope, el,
      ...(['ornament', 'filter'].includes(el) ? { idx: current.level === 'el' && current.el === el ? current.idx || 0 : 0 } : {}) });
    const out = (sel, section, slot) => ({ sel, section, slot });
    if (key === 'scope') return out(base, null, null);
    // The media library is project-wide. Other tabs keep using the bookmark's original selection after visiting it.
    if (key === 'media') return out(S.WORK, 'media', null);
    if (key === 'cinematic') return out(base, 'cinematic', null);
    if (key === 'camera') return multi ? out(base, 'direction', 'cam.shot') : out(element('lens'), 'camwork', 'cam.shot');
    if (key === 'layout') {
      if (base.level === 'line') return out(base, 'direction', 'arrange');
      if (base.level === 'cut') return out(element('text'), 'layout', 'arrange');
      return out(element('text'), 'layout', 'arrange');
    }
    if (key === 'text') return multi ? out(base, 'colortype', 'text.face') : out(element('text'), 'text', 'text.face');
    if (key === 'background') return multi ? out(base, 'ground', 'ground') : out(element('ground'), 'ground', 'ground');
    if (key === 'ornament') return multi ? out(base, 'multiornament', 'ornament.count') : out(element('ornament'), 'list', 'ornament.count');
    if (key === 'effects') return multi ? out(base, 'multifilter', 'filter.count') : out(element('filter'), 'list', 'filter.count');
    if (key === 'timing') {
      // A sole cut has no independent cut-start setting: its line owns that same start/end interval.
      const sole = base.level === 'cut' && plan && plan.lines && plan.lines.find((l) => l.cuts.length === 1 && l.cuts[0] === base.key);
      if (sole) return out({ level: 'line', ids: [sole.id] }, 'time', 'start');
      return out(base, multi ? 'shift' : base.level === 'work' ? 'timing' : 'time',
        multi ? null : base.level === 'work' ? 'readRate' : base.level === 'line' ? 'start' : null);
    }
    return null;
  }

  return { KEYS, parent, target };
});
