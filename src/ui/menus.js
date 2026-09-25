/* 文字PVメーカー v2 — original work. Menus: the ≡ menu, field ⋯ menus and context menus; transient popovers (DESIGN §6.4.12). */
MV.def('ui/menus', ['ui/dom', 'ui/icons', 'ui/keys'], (dom, I, K) => {
  'use strict';

  const { h } = dom;
  const RECENT_SHOWN = 5;

  // Item: { label, keys?, run?, disabled?, checked? (bool → check mark), radio?, sub?: () → items | Promise<items>,
  //         heading?: text, sep?: true, note?: text }. Labels are already localized.

  // A transient popover at an element or a point; closes on Esc, outside press, blur of the window or a pick.
  // While it is open app.popover is set, so app shortcuts stay quiet (ui/boot).
  function popover(app, at, build) {
    const box = h('div', { class: 'popover menu', role: 'menu' });
    let open = true;
    function close() {
      if (!open) return;
      open = false;
      box.remove();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', close);
      if (app.popover && app.popover.close === close) app.popover = null;
      if (at && at.focus && document.activeElement === document.body) dom.focus(at);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); close(); return; }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        const items = dom.focusables(box);
        const i = items.indexOf(document.activeElement);
        dom.focus(items[(i + (ev.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]);
        ev.preventDefault();
      }
    }
    function onDown(ev) { if (!box.contains(ev.target) && !(at && at.contains && at.contains(ev.target))) close(); }
    if (app.popover) app.popover.close();
    build(box, close);
    document.body.appendChild(box);
    place(box, at);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', close);
    app.popover = { close, anchor: at && at.nodeType ? at : null };
    dom.focus(dom.focusables(box)[0]);
    return { close, box };
  }

  function place(box, at) {
    const w = Math.max(220, box.offsetWidth), hh = box.offsetHeight;
    let x, y;
    if (at && typeof at.getBoundingClientRect === 'function') {
      const r = at.getBoundingClientRect();
      x = r.right - w;
      y = r.bottom + 6;
      if (y + hh > window.innerHeight - 8 && r.top - hh - 6 > 8) y = r.top - hh - 6;
    } else { x = at.x; y = at.y; }
    dom.setStyle(box, { left: Math.max(8, Math.min(x, window.innerWidth - w - 8)), top: Math.max(8, Math.min(y, window.innerHeight - hh - 8)) });
  }

  function renderItems(app, box, items, close) {
    for (const item of items) {
      if (!item) continue;
      if (item.heading) { box.appendChild(h('div', { class: 'menu-heading', text: item.heading })); continue; }
      if (item.sep) { box.appendChild(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
      if (item.note) { box.appendChild(h('div', { class: 'menu-empty', text: item.note })); continue; }
      box.appendChild(item.sub ? subItem(app, item, close) : leaf(item, close));
    }
  }

  function leaf(item, close) {
    const role = item.radio ? 'menuitemradio' : item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem';
    return h('button', {
      class: 'menu-item', type: 'button', role, disabled: !!item.disabled,
      'aria-checked': item.checked !== undefined ? String(!!item.checked) : null,
      on: { click: () => { close(); if (item.run) item.run(); } },
    }, h('span', { class: 'menu-check', 'aria-hidden': 'true' }, item.checked ? I.icon('check', { size: 14 }) : null),
    h('span', { class: 'menu-label', text: item.label }),
    item.keys ? h('kbd', { text: item.keys }) : null);
  }

  // A submenu opens inline under its item (an accordion keeps the popover inside the viewport).
  function subItem(app, item, close) {
    const group = h('div', { class: 'menu-sub', role: 'group', hidden: true });
    const btn = h('button', { class: 'menu-item', type: 'button', role: 'menuitem', 'aria-haspopup': 'true', 'aria-expanded': 'false',
      disabled: !!item.disabled },
    h('span', { class: 'menu-check', 'aria-hidden': 'true' }), h('span', { class: 'menu-label', text: item.label }),
    I.icon('next', { size: 14 }));
    btn.addEventListener('click', async () => {
      const opening = group.hidden;
      group.hidden = !opening;
      btn.setAttribute('aria-expanded', String(opening));
      if (!opening) return;
      dom.clear(group);
      const items = await item.sub();
      renderItems(app, group, items && items.length ? items : [{ note: app.t('menu.empty') }], close);
      dom.focus(dom.focusables(group)[0]);
    });
    return h('div', { class: 'menu-subwrap' }, btn, group);
  }

  function open(app, at, items) {
    return popover(app, at, (box, close) => renderItems(app, box, items, close));
  }

  // --- the ≡ menu (§6.4.12) ------------------------------------------------------------------------------------------

  function actionItem(app, id, extra) {
    const A = app.actions;
    if (!A.has(id)) return null;
    const keys = K.keysFor(id);
    return Object.assign({ label: app.t('cmd.' + id), keys: keys.length ? K.display(keys[0], { space: app.t('key.space') }) : null,
      disabled: !A.enabled(id), run: () => A.run(id, { from: 'menu' }) }, extra || {});
  }

  function checkItem(app, id) { return actionItem(app, id, { checked: app.actions.checked(id) }); }

  function mainItems(app) {
    const t = app.t;
    const a = (id) => actionItem(app, id);
    const c = (id) => checkItem(app, id);
    const quality = ['auto', 'smooth', 'sharp'].map((q) => ({ label: t('menu.quality.' + q), radio: true,
      checked: app.view.state.prefs.quality === q, run: () => app.actions.run('view.quality', { q }) }));
    return [
      // ≡ › ファイル (DESIGN_2_1 §12.7): 保存 writes the one file with everything (.mojipv), 軽い保存 the .json without
      // pictures, videos or the song; 字幕（.srt）appears once its action exists (package H).
      { heading: t('menu.file') }, a('file.new'), a('file.open'), a('file.save'), a('file.saveAs'), a('file.saveLight'),
      a('media.import'), { label: t('menu.recent'), sub: () => recentItems(app) }, a('file.saveLrc'), a('file.saveSrt'),
      a('lyrics.bakeTimes'),
      { sep: true }, { heading: t('menu.edit') }, a('edit.undo'), a('edit.redo'), a('edit.history'), a('palette.open'),
      { sep: true }, { heading: t('menu.view') }, c('pref.safeArea'), { label: t('menu.quality'), sub: () => quality },
      c('pref.reduceFlash'), c('view.foldSteps'), c('pref.autoFold'), c('pref.seekOnSelect'), c('pref.follow'),
      { sep: true }, { heading: t('menu.settings') }, c('pref.singleKeys'), c('pref.autoplay'), c('pref.ai'), a('file.clearDevice'),
      { sep: true }, { heading: t('menu.help') }, a('help.keys'), a('help.syntax'), a('help.about'),
      { sep: true }, { heading: t('menu.lang') }, a('app.lang'),
    ];
  }

  async function recentItems(app) {
    const list = app.io && app.io.recent ? await app.io.recent() : [];
    const fmt = (ms) => { try { return new Date(ms).toLocaleString(app.lang === 'en' ? 'en' : 'ja'); } catch (e) { return ''; } };
    return list.slice(0, RECENT_SHOWN).map((w) => ({ label: (w.name || app.t('hdr.untitled')) + ' · ' + fmt(w.at),
      run: () => app.io.openRecent(w.id) }));
  }

  // 時刻を歌詞に書き込む (§3.5): one lyrics.set that bakes every effective start into LRC stamps and clears the start pins.
  function bakeTimes(app) {
    const L = MV.has('core/lyrics') ? MV.use('core/lyrics') : null;
    const plan = app.plan;
    if (!L || !plan || !plan.lines.length) return false;
    const byRow = new Map();
    for (const l of plan.lines) {
      const row = l.row || l.id.split('.')[0];
      if (!byRow.has(row)) byRow.set(row, []);
      byRow.get(row).push(Math.round(l.t0 * 1000) / 1000);
    }
    const text = app.doc.sheet.rows.map((r) => {
      const stamps = byRow.get(r.id);
      if (!stamps) return r.src;
      const parsed = L.parseRow(r.src);
      return L.renderRow(Object.assign({}, parsed, { stamps: stamps.sort((x, y) => x - y) }));
    }).join('\n');
    const clears = Object.keys(app.doc.pins).filter((p) => /^line\/[^:]+:start$/.test(p)).map((path) => ({ t: 'pin.clear', path }));
    app.batch({ label: ['undo.bakeTimes', {}] }, clears.concat([{ t: 'lyrics.set', text }]));
    app.toast(app.t('toast.baked', { n: plan.lines.length }), { kind: 'ok' });
    return true;
  }

  // この端末に保存した作品と曲を消す: asks first (what goes, that the open work closes, that it cannot be undone), then
  // clears the autosaved works, the stored songs and the AI keys (ui/project_io.clearDevice). → Promise<boolean>
  async function clearDevice(app) {
    const t = app.t;
    const yes = await app.confirm({ title: t('clear.title'), text: t('clear.text'), ok: t('clear.ok'), danger: true });
    if (!yes) return false;
    const done = await app.io.clearDevice();
    app.toast(t(done ? 'clear.done' : 'clear.failed'), { kind: done ? 'ok' : 'error' });
    return done;
  }

  function defineActions(app) {
    const view = app.view;
    const def = (id, run, extra) => {
      if (!app.actions.has(id)) app.actions.defineAction(Object.assign({ id, label: 'cmd.' + id, run }, extra || {}));
    };
    for (const pref of ['safeArea', 'reduceFlash', 'seekOnSelect', 'follow']) {
      def('pref.' + pref, () => view.setPref(pref, !view.state.prefs[pref]), { checked: () => !!view.state.prefs[pref] });
    }
    def('view.quality', (c, a) => view.setPref('quality', a && a.q ? a.q : 'auto'), { checked: () => view.state.prefs.quality !== 'auto' });
    def('view.foldSteps', () => view.setRail(!view.state.rail), { checked: () => view.state.rail });
    def('lyrics.bakeTimes', () => bakeTimes(app), { enabled: () => !!(app.plan && app.plan.lines.length && MV.has('core/lyrics')) });
    def('edit.history', () => {
      const anchor = document.querySelector('[data-act="edit.undo"]');
      if (app.shell && anchor) app.shell.header.openHistory(anchor);
    });
    def('help.syntax', () => {
      app.goStep('lyrics');
      const btn = document.querySelector('[data-ctl="syntax"]');
      if (btn && btn.getAttribute('aria-expanded') !== 'true') btn.click();
      if (btn) dom.focus(btn);
    });
    def('help.about', () => { if (app.dialogs) app.dialogs.about(); });
    def('file.clearDevice', () => clearDevice(app), { enabled: () => !!(app.io && app.io.clearDevice && app.confirm) });
  }

  function mount(app) {
    defineActions(app);
    // The header's ≡ button opens this menu (it replaces the header's built-in list; its own listener sits on an
    // ancestor, so stopping the event here keeps one menu).
    const btn = document.querySelector('[data-act="menu.open"]');
    if (btn) {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (app.popover && app.popover.anchor === btn) { app.popover.close(); return; }
        open(app, btn, mainItems(app));
      });
    }
    return {
      open: (at, items) => open(app, at, items),
      openMain: (at) => open(app, at, mainItems(app)),
      context: (ev, items) => open(app, { x: ev.clientX, y: ev.clientY }, items),
      bakeTimes: () => bakeTimes(app),
    };
  }

  return { mount, popover, bakeTimes };
});
