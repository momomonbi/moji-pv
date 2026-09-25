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

    // show(text, { kind: 'info'|'ok'|'warn'|'error', action: { label, run }, actions: [{ label, run }], life, sticky,
    // quiet, onClose }) → { close, update(text, { announce }) }. The text is already localized (callers use t()).
    // `actions` (DESIGN_2_1 §11.7.2: [元に戻す] [ほかの使い方…]) adds buttons after `action`; a `sticky` toast (import and
    // file progress) stays until it is closed, and update() changes its text in place (the live region hears it only with
    // `announce`); a `quiet` toast is not read out when it appears (progress rows announce at most every 5 s, §11.7.10).
    function show(text, opts) {
      const o = opts || {};
      const kind = o.kind || 'info';
      if (!o.quiet) (kind === 'error' ? alert : live).textContent = text;
      const tapMode = app.view.state.mode === 'tap';
      const none = { close() {}, update() {} };
      if (tapMode && kind !== 'error') return none;
      if (!host || tapMode) {
        if (app.shell && app.shell.playbar) app.shell.playbar.flash(text, STRIP_MS);
        return none;
      }
      const acts = (o.action ? [o.action] : []).concat(Array.isArray(o.actions) ? o.actions : []);
      const buttons = acts.map((a) => h('button', { class: 'toast-act', type: 'button', text: a.label }));
      const closeBtn = h('button', { class: 'toast-x', type: 'button', 'aria-label': app.t('toast.close') }, I.icon('close', { size: 14 }));
      const textEl = h('span', { class: 'toast-text', text });
      // one action sits after the text; several go on a line of their own under it
      const many = buttons.length > 1;
      const el = h('div', { class: ['toast', 'toast-' + kind, o.sticky ? 'is-sticky' : '', many ? 'has-acts' : ''] },
        I.icon(ICON[kind] || 'info', { size: 16 }), textEl, many ? null : buttons, closeBtn,
        many ? h('div', { class: 'toast-acts' }, buttons) : null);
      const item = { el, timer: 0, kind };
      buttons.forEach((b, i) => b.addEventListener('click', () => { remove(item); acts[i].run(); }));
      closeBtn.addEventListener('click', () => { remove(item); if (o.onClose) o.onClose(); });
      const expire = (ms) => { if (!o.sticky) item.timer = setTimeout(() => remove(item), ms); };
      expire(o.life || LIFE_MS);
      el.addEventListener('pointerenter', () => clearTimeout(item.timer));
      el.addEventListener('pointerleave', () => expire(2500));
      items.push(item);
      stack.appendChild(el);
      // over the limit the oldest plain note goes first; a warning or an error outlives an ok or info toast
      const plain = (x) => !x.el.classList.contains('is-sticky');
      while (items.length > MAX) {
        remove(items.find((x) => plain(x) && x !== item && (x.kind === 'ok' || x.kind === 'info')) || items.find((x) => plain(x) && x !== item)
          || items.find(plain) || items[0]);
      }
      return {
        close: () => remove(item),
        update(next, u) {
          textEl.textContent = next;
          if (u && u.announce) live.textContent = next;
        },
      };
    }

    function clearAll() { while (items.length) remove(items[0]); }

    return { show, setHost, clearAll, count: () => items.length };
  }

  return { mount, MAX, LIFE_MS };
});
