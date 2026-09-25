/* 文字PVメーカー v2 — original work. Dialogs: <dialog> confirmations, the shortcut sheet, about and licences (DESIGN §6.4.12, §6.8, §1.4). */
MV.def('ui/dialogs', ['ui/dom', 'ui/icons', 'ui/keys', 'core/doc'], (dom, I, K, D) => {
  'use strict';

  const { h } = dom;

  // Licence texts are legal texts: shown verbatim in every UI language (THIRD_PARTY_NOTICES.md, §1.4).
  const MIT_BODY = 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated '
    + 'documentation files (the "Software"), to deal in the Software without restriction, including without limitation the '
    + 'rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit '
    + 'persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice '
    + 'and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS '
    + 'PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF '
    + 'MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT '
    + 'HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, '
    + 'ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.';
  const UNLICENSE = 'This is free and unencumbered software released into the public domain.\n\nAnyone is free to copy, modify, '
    + 'publish, use, compile, sell, or distribute this software, either in source code form or as a compiled binary, for any '
    + 'purpose, commercial or non-commercial, and by any means.\n\nIn jurisdictions that recognize copyright laws, the author '
    + 'or authors of this software dedicate any and all copyright interest in the software to the public domain. We make this '
    + 'dedication for the benefit of the public at large and to the detriment of our heirs and successors. We intend this '
    + 'dedication to be an overt act of relinquishment in perpetuity of all present and future rights to this software under '
    + 'copyright law.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT '
    + 'LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE '
    + 'AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING '
    + 'FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n\nFor more information, '
    + 'please refer to <http://unlicense.org>';
  // The SDK bundle (vendor/ai-sdk.min.js) also carries three packages it depends on (tools/vendor/package-lock.json).
  const LICENCES = [
    { name: 'mp4-muxer', what: 'about.muxer', text: 'MIT License\n\nCopyright (c) 2023 Vanilagy\n\n' + MIT_BODY },
    { name: '@anthropic-ai/sdk 0.128.0', what: 'about.sdk', text: 'MIT License\n\nCopyright 2023 Anthropic, PBC.\n\n' + MIT_BODY },
    { name: 'standardwebhooks 1.1.1', what: 'about.bundled',
      text: 'The MIT License\n\nCopyright (c) 2023 Svix (https://www.svix.com)\n\n' + MIT_BODY },
    { name: '@stablelib/base64 1.0.1', what: 'about.bundled',
      text: 'This software is licensed under the MIT license:\n\nCopyright (C) 2016 Dmitry Chestnykh\n\n' + MIT_BODY },
    { name: 'fast-sha256 1.3.0', what: 'about.bundled', text: UNLICENSE },
  ];
  const KEY_GROUPS = [['global', 'keys.global'], ['text', 'keys.text'], ['tap', 'keys.tap']];

  // keyRows(ctx, named) → [{ cmd, keys }]: the ? sheet's rows of one keymap context, one row per command (named ones
  // only) with every key bound to it, in keymap order (← and → of 3秒移動 are one row).
  function keyRows(ctx, named) {
    const rows = new Map();
    for (const b of K.KEYMAP) {
      if (b.ctx !== ctx || !named(b.cmd)) continue;
      if (!rows.has(b.cmd)) rows.set(b.cmd, { cmd: b.cmd, keys: [] });
      const r = rows.get(b.cmd);
      if (!r.keys.includes(b.key)) r.keys.push(b.key);
    }
    return [...rows.values()];
  }

  function mount(app) {
    const t = app.t;
    let current = null;

    // open(build, { label, wide }) → Promise<value>; build(body, done) fills the dialog and calls done(value) to close.
    function open(build, o) {
      const opt = o || {};
      if (current) current.done(undefined);
      return new Promise((resolve) => {
        const title = h('h2', { class: 'dlg-title', id: 'dlg-title', text: opt.title || '' });
        const close = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('dlg.close'), title: t('dlg.close') }, I.icon('close'));
        const body = h('div', { class: 'dlg-body' });
        const dlg = h('dialog', { class: ['dlg', opt.wide ? 'is-wide' : ''], 'aria-labelledby': 'dlg-title' },
          h('div', { class: 'dlg-head' }, title, close), body);
        const before = document.activeElement;
        let settled = false;
        function done(value) {
          if (settled) return;
          settled = true;
          if (dlg.open) dlg.close();
          dlg.remove();
          if (app.popover && app.popover.close === cancel) app.popover = null;
          current = null;
          if (before && before.isConnected) dom.focus(before);
          resolve(value);
        }
        const cancel = () => done(undefined);
        close.addEventListener('click', cancel);
        dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); cancel(); });
        dlg.addEventListener('click', (ev) => { if (ev.target === dlg) cancel(); });
        build(body, done);
        document.body.appendChild(dlg);
        if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
        app.popover = { close: cancel, anchor: null };          // app shortcuts stay quiet while a dialog is open
        current = { done };
        const first = body.querySelector('[data-autofocus]') || dom.focusables(body)[0];
        if (first) dom.focus(first);
      });
    }

    // confirm({ title, text, ok, cancel, danger }) → Promise<boolean>. A danger question (it cannot be undone) starts
    // with the focus on キャンセル, so Enter alone never confirms it.
    function confirm(o) {
      return open((body, done) => {
        const ok = h('button', { class: ['btn', o.danger ? 'danger' : 'primary'], type: 'button', 'data-autofocus': o.danger ? null : '1',
          on: { click: () => done(true) } }, o.ok || t('dlg.ok'));
        const no = h('button', { class: 'btn', type: 'button', 'data-autofocus': o.danger ? '1' : null, on: { click: () => done(false) } },
          o.cancel || t('dlg.cancel'));
        body.append(h('p', { class: 'dlg-text', text: o.text || '' }), h('div', { class: 'dlg-actions' }, no, ok));
      }, { title: o.title || t('dlg.confirm') }).then((v) => v === true);
    }

    // The ? sheet, generated from the keymap (§6.8).
    function keys() {
      return open((body) => {
        for (const [ctx, label] of KEY_GROUPS) {
          const rows = keyRows(ctx, (cmd) => t.has('cmd.' + cmd)).map((r) => h('div', { class: 'key-row' },
            h('span', { class: 'key-cmd', text: t('cmd.' + r.cmd) }),
            h('span', { class: 'key-keys' }, r.keys.map((k) => h('kbd', { text: K.display(k, { space: t('key.space') }) })))));
          body.append(h('h3', { class: 'dlg-sub', text: t(label) }), h('div', { class: 'key-list' }, rows));
        }
        // §6.6: the rule is shown in step ③ and in this sheet.
        body.append(h('p', { class: 'note', text: t('look.rule') }), h('p', { class: 'note subtle', text: t('keys.singleNote') }));
      }, { title: t('keys.title'), wide: true });
    }

    function about() {
      return open((body) => {
        body.append(
          h('p', { class: 'dlg-text' }, h('strong', { text: t('app.name') }), ' ', h('span', { class: 'muted', text: 'v' + D.APP_VERSION })),
          h('p', { class: 'dlg-text', text: t('about.original') }),
          h('p', { class: 'dlg-text', text: t('about.fonts') }),
          h('h3', { class: 'dlg-sub', text: t('about.licences') }),
          // Node.append does not flatten arrays (an array became the text "[object HTMLDetailsElement],…"): spread it.
          ...LICENCES.map((l) => h('details', { class: 'dlg-licence' }, h('summary', {}, h('strong', { text: l.name }), ' — ', t(l.what)),
            h('pre', { class: 'dlg-pre', text: l.text }))));
      }, { title: t('about.title'), wide: true });
    }

    return { open, confirm, keys, about, isOpen: () => !!current };
  }

  return { mount, LICENCES, keyRows };
});
