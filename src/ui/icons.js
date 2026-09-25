/* 文字PVメーカー v2 — original work. Original line icons drawn with createElementNS (24-unit grid, currentColor strokes). */
MV.def('ui/icons', ['ui/dom'], (dom) => {
  'use strict';

  // Each icon is a list of [tag, attrs]; strokes use currentColor, 'fill' marks solid shapes.
  const P = (d) => ['path', { d }];
  const SOLID = (d) => ['path', { d, fill: 'currentColor', stroke: 'none' }];
  const ICONS = {
    play: [SOLID('M8 5.5v13a.8.8 0 0 0 1.2.7l10.2-6.5a.8.8 0 0 0 0-1.4L9.2 4.8A.8.8 0 0 0 8 5.5z')],
    pause: [SOLID('M7 5h3.2v14H7zM13.8 5H17v14h-3.2z')],
    prev: [P('M15 6l-6 6 6 6')],
    next: [P('M9 6l6 6-6 6')],
    first: [P('M17 6l-6 6 6 6M7 6v12')],
    toStart: [P('M6.5 6v12'), SOLID('M18 6.6v10.8a.8.8 0 0 1-1.26.65L9.4 12.65a.8.8 0 0 1 0-1.3l7.34-5.4A.8.8 0 0 1 18 6.6z')],
    replay: [P('M5.5 12a6.5 6.5 0 1 0 1.9-4.6'), P('M5 4.5V8h3.5')],
    fold: [P('M13 6l-6 6 6 6M19 6l-6 6 6 6')],
    unfold: [P('M11 6l6 6-6 6M5 6l6 6-6 6')],
    undo: [P('M9 7L4.5 11.5 9 16'), P('M5 11.5h9a5 5 0 0 1 0 10h-2')],
    redo: [P('M15 7l4.5 4.5L15 16'), P('M19 11.5h-9a5 5 0 0 0 0 10h2')],
    menu: [P('M4 7h16M4 12h16M4 17h16')],
    details: [P('M5 7h9M18 7h1M5 12h3M12 12h7M5 17h11M20 17h-1'), ['circle', { cx: 16, cy: 7, r: 2 }],
      ['circle', { cx: 10, cy: 12, r: 2 }], ['circle', { cx: 18, cy: 17, r: 2 }]],
    ai: [P('M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6-4.6-1.7 4.6-1.7z'), P('M18.5 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z')],
    close: [P('M6 6l12 12M18 6L6 18')],
    timeline: [['rect', { x: 3.5, y: 5, width: 17, height: 14, rx: 2 }], P('M3.5 10h17M7 13.5h5M14 13.5h3.5M7 16h8')],
    sound: [P('M4 9.5h3.5L12 6v12l-4.5-3.5H4z'), P('M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11')],
    muted: [P('M4 9.5h3.5L12 6v12l-4.5-3.5H4z'), P('M16 9.5l5 5M21 9.5l-5 5')],
    dice: [['rect', { x: 4, y: 4, width: 16, height: 16, rx: 3.5 }], SOLID('M8.5 7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM15.5 14a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z')],
    omakase: [P('M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1'),
      ['circle', { cx: 12, cy: 12, r: 3.2 }]],
    pin: [P('M9 4h6l-1 5 3 3v1.5H7V12l3-3z'), P('M12 13.5V20')],
    ring: [['circle', { cx: 12, cy: 12, r: 6.5 }]],
    lock: [['rect', { x: 5.5, y: 10.5, width: 13, height: 9.5, rx: 2 }], P('M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5')],
    open: [P('M3.5 7.5V18a1.5 1.5 0 0 0 1.5 1.5h13.2a1.5 1.5 0 0 0 1.4-1l2-6A1.5 1.5 0 0 0 20.2 10.5H7.3a1.5 1.5 0 0 0-1.4 1L3.5 18'),
      P('M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2h6.5A1.5 1.5 0 0 1 19 9.5v1')],
    save: [P('M5 4.5h11l3.5 3.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5z'), P('M8 4.5v4.5h7V4.5M8 19.5v-5h8v5')],
    music: [P('M9 17.5V6l10-2v11.5'), ['circle', { cx: 6.5, cy: 17.5, r: 2.5 }], ['circle', { cx: 16.5, cy: 15.5, r: 2.5 }]],
    lyrics: [P('M5 6h14M5 10h10M5 14h14M5 18h7')],
    look: [['circle', { cx: 12, cy: 12, r: 8 }], SOLID('M12 4a8 8 0 0 1 0 16z')],
    export: [P('M12 4v11M7.5 8.5L12 4l4.5 4.5'), P('M5 13v5a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 18v-5')],
    check: [P('M5 12.5l4.5 4.5L19 7.5')],
    warn: [P('M12 4l9 15.5H3z'), P('M12 10v4'), SOLID('M12 16.3a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z')],
    info: [['circle', { cx: 12, cy: 12, r: 8.5 }], P('M12 11v5.5'), SOLID('M12 7a1.1 1.1 0 1 0 0 2.2A1.1 1.1 0 0 0 12 7z')],
    plus: [P('M12 5v14M5 12h14')],
    more: [SOLID('M6 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM18 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z')],
    tap: [['circle', { cx: 12, cy: 12, r: 3 }], ['circle', { cx: 12, cy: 12, r: 7.5 }], P('M12 2.5v2M12 19.5v2')],
    help: [['circle', { cx: 12, cy: 12, r: 8.5 }], P('M9.6 9.5a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8v.4'),
      SOLID('M12 16.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2z')],
    file: [P('M7 3.5h7l4.5 4.5v12H7z'), P('M14 3.5V8h4.5')],
    mark: [SOLID('M4 5h7l2 3h7v11H4z')],
  };

  // icon(name, { size, label }) → <svg>; decorative (aria-hidden) unless a label is given.
  function icon(name, opts) {
    const o = opts || {};
    const size = o.size || 18;
    const parts = ICONS[name] || ICONS.info;
    const el = dom.svg('svg', {
      viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', 'stroke-width': o.weight || 1.8,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', class: 'icon icon-' + name, focusable: 'false',
      'aria-hidden': o.label ? null : 'true', role: o.label ? 'img' : null, 'aria-label': o.label || null,
    }, parts.map(([tag, attrs]) => dom.svg(tag, attrs)));
    return el;
  }

  return { icon, names: () => Object.keys(ICONS) };
});
