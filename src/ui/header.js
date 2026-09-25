/* 文字PVメーカー v2 — original work. Header: title and save state, undo/redo with history popover, 詳細/AI toggles, ≡ menu (DESIGN §6.4.1). */
MV.def('ui/header', ['ui/dom', 'ui/icons', 'ui/keys'], (dom, I, K) => {
  'use strict';

  const { h } = dom;
  const HISTORY_SHOWN = 50;
  const TITLE_ROW = /^\s*\[ti:(.*)\]\s*$/i;

  function titleOf(doc) {
    for (const row of doc.sheet.rows) {
      const m = TITLE_ROW.exec(row.src);
      if (m && m[1].trim()) return m[1].trim();
    }
    return null;
  }

  // A small floating list under a button (transient: closes on Esc, blur, outside click, or after a pick).
  function popover(app, anchor, build) {
    const box = h('div', { class: 'popover', role: 'menu' });
    build(box, close);
    document.body.appendChild(box);
    const r = anchor.getBoundingClientRect();
    const width = Math.max(220, box.offsetWidth);
    dom.setStyle(box, { top: r.bottom + 6, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) });
    const first = dom.focusables(box)[0];
    dom.focus(first);
    function onKey(ev) {
      if (ev.key === 'Escape') { ev.stopPropagation(); close(); dom.focus(anchor); }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        const items = dom.focusables(box);
        const at = items.indexOf(document.activeElement);
        dom.focus(items[(at + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]);
        ev.preventDefault();
      }
    }
    function onDown(ev) { if (!box.contains(ev.target) && ev.target !== anchor && !anchor.contains(ev.target)) close(); }
    let open = true;
    function close() {
      if (!open) return;
      open = false;
      box.remove();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      app.popover = null;
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    if (app.popover) app.popover.close();
    app.popover = { close, anchor };
    return { close };
  }

  function menuItem(app, item, close) {
    const t = app.t;
    if (item.heading) return h('div', { class: 'menu-heading', text: t(item.heading) });
    if (item.sep) return h('div', { class: 'menu-sep', role: 'separator' });
    const enabled = app.actions.has(item.act) ? app.actions.enabled(item.act) : false;
    const checked = app.actions.has(item.act) && app.actions.checked(item.act);
    const keys = K.keysFor(item.act);
    return h('button', {
      class: 'menu-item', type: 'button', role: item.check ? 'menuitemcheckbox' : 'menuitem', disabled: !enabled,
      'aria-checked': item.check ? String(checked) : null,
      on: { click: () => { close(); app.actions.run(item.act, item.args || null); } },
    }, h('span', { class: 'menu-check', 'aria-hidden': 'true' }, item.check && checked ? I.icon('check', { size: 14 }) : null),
    h('span', { class: 'menu-label', text: item.label ? t(item.label) : t('cmd.' + item.act) }),
    keys.length ? h('kbd', { text: K.display(keys[0]) }) : null);
  }

  const MENU = [
    { heading: 'menu.file' },
    { act: 'file.new' }, { act: 'file.open' }, { act: 'file.save' }, { act: 'file.saveAs' }, { act: 'file.saveLrc' },
    { sep: true }, { heading: 'menu.settings' },
    { act: 'pref.singleKeys', check: true }, { act: 'pref.autoFold', check: true }, { act: 'pref.autoplay', check: true },
    { act: 'pref.ai', check: true },
    { sep: true }, { heading: 'menu.help' },
    { act: 'help.keys' }, { act: 'app.lang' },
  ];

  function mount(app, el) {
    const t = app.t;
    const brand = h('div', { class: 'brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true', text: '文' }),
      h('span', { class: 'brand-name', text: t('app.name') }));
    const titleText = h('span', { class: 'doc-title-text' });
    const saveState = h('span', { class: 'save-state', role: 'status' });
    const title = h('button', { class: 'doc-title', type: 'button', title: t('hdr.titleTip'), 'data-act': 'header.title' },
      titleText, saveState);
    const btn = (act, icon, label, extra) => h('button', Object.assign({ class: 'hbtn', type: 'button', 'data-act': act,
      'aria-label': label }, extra || {}), I.icon(icon), h('span', { class: 'hbtn-label', text: label }));
    const undo = btn('edit.undo', 'undo', t('hdr.undoShort'));
    const redo = btn('edit.redo', 'redo', t('hdr.redoShort'));
    const details = btn('panel.details', 'details', t('panel.details'), { 'aria-pressed': 'false' });
    const ai = btn('panel.ai', 'ai', t('panel.ai'), { 'aria-pressed': 'false' });
    const menu = h('button', { class: 'hbtn icon-only', type: 'button', 'data-act': 'menu.open', 'aria-label': t('hdr.menu'),
      'aria-haspopup': 'menu', title: t('hdr.menu') }, I.icon('menu'));
    el.append(brand, h('span', { class: 'hdr-sep', 'aria-hidden': 'true' }), title, h('span', { class: 'grow' }),
      h('div', { class: 'hgroup hist-group' }, undo, redo), h('div', { class: 'hgroup' }, details, ai, menu));

    dom.on(el, 'click', '[data-act]', (ev, b) => {
      if (b.dataset.act === 'menu.open') { openMenu(); return; }
      if (b.dataset.act === 'header.title') { app.select({ level: 'work' }, { from: 'header', open: true }); return; }
      app.actions.run(b.dataset.act, { from: 'header' });
    });
    for (const b of [undo, redo]) {
      b.addEventListener('contextmenu', (ev) => { ev.preventDefault(); openHistory(b); });
    }

    function openMenu() {
      popover(app, menu, (box, close) => {
        box.classList.add('menu');
        for (const item of MENU) box.appendChild(menuItem(app, item, close));
      });
    }

    // Edit-history popover (right-click ↶ / ↷): the last 50 entries, newest first; click = jump there.
    function openHistory(anchor) {
      popover(app, anchor, (box, close) => {
        box.classList.add('menu', 'history');
        box.appendChild(h('div', { class: 'menu-heading', text: t('hdr.history') }));
        const list = app.store.list().slice(-HISTORY_SHOWN).reverse();
        if (!list.length) box.appendChild(h('div', { class: 'menu-empty', text: t('hdr.historyEmpty') }));
        for (const e of list) {
          box.appendChild(h('button', {
            class: ['menu-item', e.done ? 'done' : 'undone'], type: 'button', role: 'menuitem',
            on: { click: () => { close(); app.jump(e.n); } },
          }, h('span', { class: 'menu-check', 'aria-hidden': 'true' }, e.done ? I.icon('check', { size: 14 }) : null),
          h('span', { class: 'menu-label', text: t.label(e.label) })));
        }
        box.appendChild(h('button', { class: 'menu-item', type: 'button', role: 'menuitem',
          on: { click: () => { close(); app.jump(0); } } }, h('span', { class: 'menu-check' }),
        h('span', { class: 'menu-label', text: t('hdr.historyStart') })));
      });
    }

    function update() {
      const doc = app.doc;
      titleText.textContent = titleOf(doc) || t('hdr.untitled');
      const st = app.io ? app.io.state() : 'idle';
      saveState.textContent = st === 'idle' ? '' : t('hdr.save.' + st);
      saveState.dataset.state = st;
      const peek = app.store.peek();
      undo.disabled = !peek.undo;
      redo.disabled = !peek.redo;
      undo.title = peek.undo ? t('hdr.undo', { what: t.label(peek.undo) }) + ' (Ctrl+Z)' : t('hdr.nothingToUndo');
      redo.title = peek.redo ? t('hdr.redo', { what: t.label(peek.redo) }) + ' (Ctrl+Shift+Z)' : t('hdr.nothingToRedo');
      const vs = app.view.state;
      details.setAttribute('aria-pressed', String(vs.panel === 'details'));
      ai.setAttribute('aria-pressed', String(vs.panel === 'ai'));
      details.disabled = vs.aiReview;
      details.title = vs.aiReview ? t('panel.reviewLocked') : t('cmd.panel.details') + ' (I)';
      ai.hidden = !vs.prefs.ai;
      ai.title = t('cmd.panel.ai') + ' (A)';
    }

    app.bus.on('plan', update);
    app.bus.on('save', update);
    app.view.on((changed) => { if (changed.includes('panel') || changed.includes('prefs') || changed.includes('aiReview')) update(); });
    update();
    return { update, openMenu, openHistory };
  }

  return { mount, titleOf, popover };
});
