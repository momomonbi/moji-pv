/* 文字PVメーカー v2 — original work. Toasts: never over the preview; host follows the layout; ≤ 2 stacked, 6 s; polite live region (DESIGN §6.4.11). */
MV.def('ui/toasts', ['ui/dom', 'ui/icons'], (dom, I) => {
  'use strict';

  const { h } = dom;
  const MAX = 2;
  const LIFE_MS = 6000;
  const STRIP_MS = 4000;
  const ICON = { info: 'info', ok: 'check', error: 'warn', warn: 'warn' };

  function mount(app) {
    const live = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    const alert = h('div', { class: 'sr-only', role: 'alert' });
    document.body.append(live, alert);
    const stack = h('div', { class: 'toasts' });
    let host = null;
    const items = [];

    function setHost(el) {
      host = el;
      if (el) { if (stack.parentNode !== el) el.appendChild(stack); } else if (stack.parentNode) stack.remove();
    }

    function remove(item) {
      const i = items.indexOf(item);
      if (i < 0) return;
      items.splice(i, 1);
      clearTimeout(item.timer);
      item.el.remove();
    }

    // show(text, { kind: 'info'|'ok'|'warn'|'error', action: { label, run }, life }) → { close }.
    // The text is already localized (callers use t()).
    function show(text, opts) {
      const o = opts || {};
      const kind = o.kind || 'info';
      (kind === 'error' ? alert : live).textContent = text;
      const tapMode = app.view.state.mode === 'tap';
      if (tapMode && kind !== 'error') return { close() {} };
      if (!host || tapMode) {
        if (app.shell && app.shell.playbar) app.shell.playbar.flash(text, STRIP_MS);
        return { close() {} };
      }
      const actionBtn = o.action ? h('button', { class: 'toast-act', type: 'button', text: o.action.label }) : null;
      const closeBtn = h('button', { class: 'toast-x', type: 'button', 'aria-label': app.t('toast.close') }, I.icon('close', { size: 14 }));
      const el = h('div', { class: ['toast', 'toast-' + kind] }, I.icon(ICON[kind] || 'info', { size: 16 }),
        h('span', { class: 'toast-text', text }), actionBtn, closeBtn);
      const item = { el, timer: 0 };
      if (actionBtn) actionBtn.addEventListener('click', () => { remove(item); o.action.run(); });
      closeBtn.addEventListener('click', () => remove(item));
      item.timer = setTimeout(() => remove(item), o.life || LIFE_MS);
      el.addEventListener('pointerenter', () => clearTimeout(item.timer));
      el.addEventListener('pointerleave', () => { item.timer = setTimeout(() => remove(item), 2500); });
      items.push(item);
      stack.appendChild(el);
      while (items.length > MAX) remove(items[0]);
      return { close: () => remove(item) };
    }

    function clearAll() { while (items.length) remove(items[0]); }

    return { show, setHost, clearAll, count: () => items.length };
  }

  return { mount, MAX, LIFE_MS };
});
