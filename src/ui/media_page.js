/* 文字PVメーカー v2 — original work. 作品全体 › 写真・動画: the library rows, the asset page and the media picker (inspector sub-pages; DESIGN_2_1 §11.7.3, §11.7.5, §11.9.5). */
MV.def('ui/media_page', ['ui/dom', 'ui/icons', 'i18n/t', 'core/media', 'ui/media_io', 'ui/media_widgets', 'ui/fields',
  'ui/selection', 'planner/areas'],
(dom, I, T, MEDIA, MI, MW, F, S, AREAS) => {
  'use strict';

  const { h } = dom;
  const TILE_W = 288, TILE_H = 162;          // backing of a 144×81 picker tile at 2×
  const ROW_W = 128, ROW_H = 72;             // backing of a 64×36 library poster at 2×
  const TRYON_MS = 250;                      // hover / focus → try-on (D§6.7)
  const SCRUB_MS = 180;                      // a video tile's filmstrip steps while hovered or focused

  // --- words (pure) ---------------------------------------------------------------------------------------------------

  // The facts under an asset's name: 「動画 · 1920×1080 · 0:12.5 · 29.97fps · 48 MB」.
  function factsText(t, e) {
    const out = [t(MI.kindKey(e)), e.w + '×' + e.h];
    if (MI.isTimed(e)) out.push(MI.durText(e.dur, true), (Math.round(e.fps * 100) / 100) + 'fps');
    out.push(T.fmtBytes(e.bytes));
    return out.join(' · ');
  }

  // A place that uses an asset, in words: 「作品全体（背景）」, 「サビ1（枠）」, 「3行目（文字の中）」.
  function placeText(t, place, doc, plan) {
    const use = t('media.useWord.' + place.use);
    let where;
    if (place.area) where = F.areaTitle(t, place.area);
    else {
      const w = place.scope === 'work' ? null : place.scope.startsWith('line/')
        ? { kind: 'lines', scopes: [place.scope], lineIds: [place.scope.slice(5)], area: null } : { kind: 'cut', scopes: [place.scope] };
      where = MI.scopeWords(t, w, doc, plan);
    }
    return t('media.place', { where, use });
  }

  // --- the library (作品全体 › 写真・動画) -------------------------------------------------------------------------------

  // libraryRows(app, { open(id, o) }) → the section body: [＋ 読み込む], one row per asset (a listbox: ↑ ↓ move, Enter
  // opens, Del removes after asking, the context-menu key opens ⋯), and the total on this device.
  function libraryRows(app, o) {
    const t = app.t;
    const list = MI.libraryOf(app.doc);
    const add = h('button', { class: 'chip-btn med-import', type: 'button', text: t('media.import'),
      on: { click: () => app.media.pickAndImport({}) } });
    const head = h('div', { class: 'med-lib-head' }, h('span', { class: 'muted med-count', text: t('media.count', { n: list.length }) }),
      h('span', { class: 'grow' }), add);
    if (!list.length) return h('div', { class: 'med-lib' }, head, h('p', { class: 'note subtle', text: t('media.empty') }));
    const box = h('div', { class: 'med-list', role: 'listbox', 'aria-label': t('sec.media') });
    const rows = list.map((e, i) => row(app, e, i, o));
    box.append(...rows);
    const focusRow = (i) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      rows.forEach((x) => { x.tabIndex = x === r ? 0 : -1; });
      dom.focus(r);
    };
    // one tab stop: the row with focus (a click, the keys, or the library opened from step ④)
    box.addEventListener('focusin', (ev) => { if (rows.includes(ev.target)) rows.forEach((x) => { x.tabIndex = x === ev.target ? 0 : -1; }); });
    box.addEventListener('keydown', (ev) => {
      const at = rows.indexOf(ev.target);
      if (at < 0) return;
      const id = list[at].id;
      let done = true;
      if (ev.key === 'ArrowDown') focusRow(at + 1);
      else if (ev.key === 'ArrowUp') focusRow(at - 1);
      else if (ev.key === 'Home') focusRow(0);
      else if (ev.key === 'End') focusRow(rows.length - 1);
      else if (ev.key === 'Enter' || ev.key === ' ') o.open(id, {});
      else if (ev.key === 'Delete' || ev.key === 'Backspace') app.media.remove(id);
      else if (ev.key === 'ContextMenu' || (ev.key === 'F10' && ev.shiftKey)) openMenu(app, id, ev.target, o);
      else done = false;
      if (done) { ev.preventDefault(); ev.stopPropagation(); }
    });
    rows[0].tabIndex = 0;
    const total = h('p', { class: 'note subtle med-total', text: T.fmtBytes(MI.libraryBytes(app.doc)) });
    if (app.io && typeof app.io.storageInfo === 'function') {
      app.io.storageInfo().then((st) => {
        if (st.quota > 0) total.textContent = t('media.total', { size: T.fmtBytes(MI.libraryBytes(app.doc)), free: T.fmtBytes(Math.max(0, st.quota - st.usage)) });
      }, () => {});
    }
    return h('div', { class: 'med-lib' }, head, box, total);
  }

  // A library row, on two lines: the name at full width, then the facts (or この端末にありません), 使用 n, おまかせ and ⋯.
  // A picture the preview could not decode carries 再生できません (§11.7.9).
  function row(app, e, i, o) {
    const t = app.t;
    const st = app.media.state(e.id);
    const missing = st === 'missing', broken = st === 'error';
    const canvas = h('canvas', { class: 'med-thumb', width: ROW_W, height: ROW_H, 'aria-hidden': 'true' });
    if (!missing) MW.posterInto(app, canvas, e.id);
    const uses = MI.usePlaces(app.doc, app.plan, e.id).length;
    const info = missing ? t('media.missing') : MI.infoText(t, e);
    const pool = h('input', { type: 'checkbox', role: 'switch', tabindex: '-1', checked: e.pool === true, 'aria-label': t('media.pool') + ': ' + e.name,
      on: { change: (ev) => app.media.setPool(e.id, ev.target.checked), click: (ev) => ev.stopPropagation() } });
    const more = h('button', { class: 'icon-btn small med-more', type: 'button', tabindex: '-1', 'aria-haspopup': 'menu',
      title: t('fld.more', { field: e.name }), 'aria-label': t('fld.more', { field: e.name }),
      on: { click: (ev) => { ev.stopPropagation(); openMenu(app, e.id, ev.currentTarget, o); } } }, I.icon('more', { size: 14 }));
    const relink = missing ? h('button', { class: 'chip-btn med-relink', type: 'button', tabindex: '-1', text: t('media.relink'),
      on: { click: (ev) => { ev.stopPropagation(); app.media.relink(e.id); } } }) : null;
    // the accessible name says the kind once (the facts without their kind word), then the state and the uses
    const said = [missing ? t('media.missing') : MI.infoText(t, e, true)].concat(broken ? [t('media.cannotPlay')] : [],
      missing ? [] : [t('media.used', { n: uses })]).join(' · ');
    const el = h('div', { class: ['med-row', missing ? 'is-missing' : '', broken ? 'is-broken' : ''], role: 'option', tabindex: '-1', 'data-id': e.id,
      'aria-selected': 'false', 'aria-label': t('media.a11y.row', { name: e.name, kind: t(MI.kindKey(e)), info: said }),
      on: { click: () => o.open(e.id, {}) } },
    h('span', { class: 'med-thumb-box' }, canvas, missing ? h('span', { class: 'w-media-q', text: '？' }) : null),
    h('span', { class: 'med-main' },
      h('span', { class: 'med-name', text: e.name }),
      h('span', { class: 'med-sub' },
        h('span', { class: 'med-info muted', text: info }),
        broken ? h('span', { class: 'med-badge is-warn', text: t('media.cannotPlay') }) : null,
        h('span', { class: 'grow' }),
        missing ? relink : h('span', { class: 'med-used muted', text: t('media.used', { n: uses }) }),
        missing ? null : h('label', { class: 'med-pool', title: t('media.pool'), on: { click: (ev) => ev.stopPropagation() } }, pool,
          h('span', { class: 'muted', text: t('media.poolShort') })),
        more)));
    return el;
  }

  // ⋯ of a library row: 開く · 名前を変える · 上へ / 下へ · おまかせでも背景に使う · 置き換える… · この写真を使わない · 削除.
  function openMenu(app, id, at, o) {
    const t = app.t;
    const e = MI.entryOf(app.doc, id);
    if (!e || !app.menus) return;
    const list = MI.libraryOf(app.doc);
    const i = list.indexOf(e);
    const missing = app.media.state(id) === 'missing';
    app.menus.open(at, [
      { label: t('media.open'), run: () => o.open(id, {}) },
      { label: t('media.rename'), run: () => o.open(id, { rename: true }) },
      { label: t('media.up'), disabled: i <= 0, run: () => app.media.move(id, -1) },
      { label: t('media.down'), disabled: i >= list.length - 1, run: () => app.media.move(id, 1) },
      { label: t('media.pool'), checked: e.pool === true, run: () => app.media.setPool(id, !e.pool) },
      missing ? { label: t('media.relink'), run: () => app.media.relink(id) } : null,
      { label: t('media.replace'), run: () => app.media.replace(id) },
      { label: t(e.kind === 'video' ? 'media.notUseVideo' : 'media.notUse'), disabled: !MI.usePlaces(app.doc, app.plan, id).length && !e.pool,
        run: () => app.media.notUse(id) },
      { sep: true },
      { label: t('media.delete'), run: () => app.media.remove(id) },
    ]);
  }

  // --- the asset page (§11.7.3) --------------------------------------------------------------------------------------------

  // What a control of the asset page is, so the same control gets the focus back after the page is drawn again.
  function focusKeyOf(root, el) {
    if (!el || !root.contains(el)) return null;
    for (const attr of ['data-act', 'data-use', 'data-role']) {
      const x = el.closest('[' + attr + ']');
      if (x && root.contains(x)) return '[' + attr + '="' + x.getAttribute(attr) + '"]';
    }
    const place = el.closest('.med-place');
    if (place) return { place: [...root.querySelectorAll('.med-place')].indexOf(place) };
    return el.classList.contains('med-rename') ? '.med-rename' : null;
  }

  // assetPage(app, { id, rename, onSelect(sel), onGone(), onLibrary() }) → an inspector sub-page { id, crumb, crumbs,
  // bare, el, focus, refresh, destroy }. Its crumbs are 写真・動画 (the library) › the name; the page has no title bar of
  // its own (bare).
  function assetPage(app, o) {
    const t = app.t;
    const el = h('div', { class: 'med-page' });
    let renaming = !!o.rename;
    let scrubTimer = 0;
    let shownSig = null;
    let focusNext = null;                  // a control to focus once the page is drawn again (✎ after a rename)
    const entry = () => MI.entryOf(app.doc, o.id);

    function button(label, run, extra) {
      return h('button', Object.assign({ class: 'btn small', type: 'button', text: label, on: { click: run } }, extra || {}));
    }

    // 使う: the placement buttons, each naming where it places: 作品全体の背景, 「2行目の背景」, 「文字の中に（2行目）」.
    // The other scope is the current selection, or (while this page shows 作品全体) the latest line or cut selected
    // since the work was loaded. Each pins in one batch, then the element page with the new rows opens.
    function useButtons(e, off) {
      const sel = app.media.placeSel();
      const w = sel ? MI.whereOf(sel, app.plan, app.doc) : null;
      const at = w || { kind: 'work', scopes: ['work'], lineIds: [], area: null };
      const scope = app.media.scopeText(at);
      const go = (use, where) => {
        if (!app.media.place(e.id, use, where)) return;
        const sc = where.scopes[0];
        const idx = use === 'frame' ? slotIdxOf(sc, 'photoFrame', e.id) : null;
        const el2 = use === 'fill' ? 'text' : use === 'frame' ? 'ornament' : 'ground';
        if (o.onSelect) o.onSelect(Object.assign({ level: 'el', scope: sc, el: el2 }, idx !== null ? { idx } : {}));
      };
      const dis = off ? { disabled: true, title: t('media.needsFile') } : {};
      const kids = [button(t('media.use.work'), () => go('ground', { kind: 'work', scopes: ['work'], lineIds: [], area: null }),
        Object.assign({ 'data-use': 'work' }, dis))];
      if (w && w.kind !== 'work') kids.push(button(t('media.use.here', { scope }), () => go('ground', w), Object.assign({ 'data-use': w.kind }, dis)));
      const second = [
        button(t('media.use.fillAt', { scope }), () => go('fill', at), Object.assign({ 'data-use': 'fill' }, dis)),
        button(t('media.use.frameAt', { scope }), () => go('frame', at), Object.assign({ 'data-use': 'frame' }, dis)),
        button(t('media.use.overlayAt', { scope }), () => go('overlay', at), Object.assign({ 'data-use': 'overlay' }, dis)),
      ];
      return [h('div', { class: 'row-actions med-use' }, kids), h('div', { class: 'row-actions med-use' }, second)];
    }

    function slotIdxOf(scope, key, id) {
      for (let i = 0; i < 3; i++) {
        const pin = app.doc.pins[F.writePath(scope + ':ornament#' + i + '@' + key + '.src', app.plan)];
        if (pin && pin.v === id) return i;
      }
      return 0;
    }

    // The poster at column width. A still is a picture only (no tab stop); a video or an animation can take the focus
    // (role img), and hovering or focusing it walks its filmstrip (not with reduced motion unless focused).
    function posterBox(e, missing) {
      const canvas = h('canvas', { class: 'med-poster', width: 640, height: 360, 'aria-hidden': 'true' });
      const timed = MI.isTimed(e) && !missing;
      const box = h('div', { class: 'med-poster-box', role: 'img', 'aria-label': t('media.a11y.tile', { name: e.name, kind: t(MI.kindKey(e)) }),
        tabindex: timed ? '0' : null, 'data-role': 'poster' }, canvas, missing ? h('span', { class: 'w-media-q', text: '？' }) : null);
      if (missing) return box;
      MW.posterInto(app, canvas, e.id);
      if (!timed) return box;
      const drawTile = (k) => app.media.strip(e.id).then((st) => {
        if (!st) return;
        const g = canvas.getContext('2d');
        const tw = st.image.width / st.tiles;
        const kk = Math.max(0, Math.min(st.tiles - 1, k));
        const sc = Math.min(canvas.width / tw, canvas.height / st.image.height);
        const dw = tw * sc, dh = st.image.height * sc;
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.drawImage(st.image, kk * tw, 0, tw, st.image.height, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      });
      box.addEventListener('pointermove', (ev) => {
        const r = box.getBoundingClientRect();
        drawTile(Math.floor(Math.max(0, Math.min(0.999, (ev.clientX - r.left) / Math.max(1, r.width))) * 12));
      });
      box.addEventListener('pointerleave', () => MW.posterInto(app, canvas, e.id));
      box.addEventListener('focus', () => {
        let k = 0;
        clearInterval(scrubTimer);
        scrubTimer = setInterval(() => drawTile(k++ % 12), SCRUB_MS);
      });
      box.addEventListener('blur', () => { clearInterval(scrubTimer); MW.posterInto(app, canvas, e.id); });
      return box;
    }

    function colorsRow(e) {
      const sw = h('span', { class: 'med-swatches' });
      const match = button(t('media.matchColors'), () => app.media.matchColors(e.id), { disabled: true, 'data-act': 'colors',
        title: t('media.matchColorsTip') });
      app.media.colorsOf(e.id).then((list) => {
        dom.replace(sw, list.map((c) => h('span', { class: 'med-sw', title: c, style: { background: c } })));
        match.disabled = !list.length;
      });
      return h('div', { class: 'field-row med-colors' }, h('span', { class: 'field-label inline', text: t('media.colors') }), sw, match,
        h('p', { class: 'note subtle med-colors-tip', text: t('media.matchColorsTip') }));
    }

    // AI: the description, and 動きと重なり's suggestion with its reason (§11.9.5); [AIに説明してもらう…] when the AI
    // panel offers the photo description and the picture is on this device.
    function aiRow(e, st) {
      const ai = e.ai || null;
      const kids = [];
      if (ai && ai.caption) {
        const cap = ai.caption[t.lang] || ai.caption.ja || '';
        if (cap) kids.push(h('p', { class: 'note med-caption', text: t('media.aiCaption', { caption: cap }) }));
      }
      if (ai && ai.depth && t.has('opt.depth.' + ai.depth)) {
        kids.push(h('p', { class: 'note med-depth', 'data-depth': ai.depth }, h('strong', { text: t('media.ai.depth', { v: t('opt.depth.' + ai.depth) }) }),
          ai.reason ? h('span', { class: 'muted', text: ' ' + t('ai.review.reason', { text: ai.reason }) }) : null));
      }
      const can = app.ai && typeof app.ai.describeMedia === 'function' && app.view.state.prefs.ai;
      if (can) {
        kids.push(h('div', { class: 'row-actions' }, button(t('media.askAi'), () => app.ai.describeMedia([e.id]),
          { 'data-act': 'vision', disabled: st !== 'ok', title: st === 'missing' ? t('media.needsFile') : null }),
        st === 'missing' ? h('span', { class: 'note subtle', text: t('media.needsFile') }) : null));
      }
      return kids.length ? h('div', { class: 'med-ai' }, h('span', { class: 'field-label', text: t('media.aiLabel') }), kids) : null;
    }

    // What the page shows: it is drawn again only when this changes (a refresh never takes the focus away for nothing).
    function sigOf(e, st, places) {
      return JSON.stringify([e, st, places.map((p) => placeText(t, p, app.doc, app.plan)), app.view.state.prefs.ai, renaming,
        app.media.placeSel(), app.plan ? app.plan.hash : null]);
    }

    function render(force) {
      const e = entry();
      if (!e) { clearInterval(scrubTimer); shownSig = null; dom.replace(el, h('p', { class: 'note subtle', text: t('media.gone') })); return; }
      const st = app.media.state(e.id);
      const missing = st === 'missing';
      const places = MI.usePlaces(app.doc, app.plan, e.id);
      const sig = sigOf(e, st, places);
      if (!force && sig === shownSig) return;
      shownSig = sig;
      clearInterval(scrubTimer);
      const keep = focusNext || focusKeyOf(el, document.activeElement);
      focusNext = null;
      const nameEl = h('h3', { class: 'med-title', text: e.name, hidden: renaming });
      const box = h('input', { class: 'text-input med-rename', type: 'text', maxlength: String(MEDIA.LIMITS.nameMax), value: e.name,
        hidden: !renaming, 'aria-label': t('media.rename') });
      const pen = h('button', { class: 'icon-btn small med-pen', type: 'button', title: t('media.rename'), 'aria-label': t('media.rename'),
        'data-role': 'rename', on: { click: () => { renaming = true; nameEl.hidden = true; box.hidden = false; dom.focus(box); box.select(); } } }, '✎');
      const done = () => {
        if (!renaming) return;
        renaming = false;
        focusNext = '[data-role="rename"]';
        if (!app.media.rename(e.id, box.value)) render(true);
      };
      box.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); done(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); renaming = false; focusNext = '[data-role="rename"]'; render(true); }
      });
      box.addEventListener('change', done);
      const badges = h('div', { class: 'med-badges' }, MI.badgesOf(e, null).map((b) => h('span', { class: 'med-badge', text: t('media.badge.' + b) })),
        st === 'error' ? h('span', { class: 'med-badge is-warn', text: t('media.cannotPlay') }) : null);
      if (e.kind === 'video' && !missing) {
        app.media.statsOf(e.id).then((x) => {
          if (x && MI.badgesOf(e, x).includes('gop') && badges.isConnected) badges.appendChild(h('span', { class: 'med-badge', text: t('media.badge.gop') }));
        });
      }
      const pool = h('input', { type: 'checkbox', role: 'switch', checked: e.pool === true, 'aria-label': t('media.pool'), 'data-role': 'pool',
        on: { change: (ev) => app.media.setPool(e.id, ev.target.checked) } });
      const placeLinks = places.map((p) => (p.use === 'material'
        ? h('span', { class: 'muted', text: t('media.place', { where: t('sec.materials'), use: t('media.useWord.material') }) })
        : h('button', { class: 'link med-place', type: 'button', text: placeText(t, p, app.doc, app.plan),
          on: { click: () => { if (o.onSelect) o.onSelect(p.sel); } } })));
      const n = places.length;
      dom.replace(el,
        h('div', { class: 'med-head' }, nameEl, box, pen, h('span', { class: 'grow' })),
        h('p', { class: 'note subtle med-facts', text: factsText(t, e) }),
        badges,
        missing ? h('div', { class: 'insp-banner med-missing' }, I.icon('warn', { size: 14 }), h('span', { class: 'banner-text', text: t('media.missing') }),
          button(t('media.relink'), () => app.media.relink(e.id), { 'data-act': 'relink' })) : null,
        posterBox(e, missing),
        h('div', { class: 'field-label', text: t('media.useLabel') }),
        useButtons(e, missing),
        h('label', { class: 'check-row' }, pool, h('span', { text: t('media.pool') })),
        h('div', { class: 'med-places' }, h('span', { class: 'field-label inline', text: t('media.usedAt', { n }) }), placeLinks),
        missing ? null : colorsRow(e),
        aiRow(e, st),
        e.audio ? h('div', { class: 'row-actions' }, button(t('media.useAudio'), () => app.media.useAudio(e.id), { 'data-act': 'audio', disabled: missing })) : null,
        h('div', { class: 'row-actions med-delete' },
          button(t('media.replace'), () => app.media.replace(e.id), { 'data-act': 'replace' }),
          button(t('media.delete'), async () => { if (await app.media.remove(e.id) && o.onGone) o.onGone(); }, { 'data-act': 'delete' }),
          n ? h('span', { class: 'note subtle', text: t('media.deleteNote', { n }) }) : null));
      if (renaming) requestAnimationFrame(() => { dom.focus(box); box.select(); });
      else if (keep) {
        const to = typeof keep === 'string' ? el.querySelector(keep) : el.querySelectorAll('.med-place')[keep.place];
        dom.focus(to && !to.disabled ? to : el.querySelector('.med-use .btn:not(:disabled)') || el.querySelector('button:not(:disabled)'));
      }
    }

    render(true);
    const e0 = entry();
    return {
      id: 'media:' + o.id, crumb: ['media.crumb', { name: e0 ? e0.name : o.id }], el, bare: true,
      crumbs: () => { const e = entry(); return [{ label: ['sec.media', {}], run: o.onLibrary || null }, { label: e ? e.name : o.id }]; },
      focus() {
        dom.focus(el.querySelector(renaming ? '.med-rename' : '[data-act="relink"]') || el.querySelector('.med-use .btn:not(:disabled)')
          || el.querySelector('button'));
      },
      refresh: () => render(false),
      destroy() { clearInterval(scrubTimer); },
    };
  }

  // --- the media picker (§11.7.5) -----------------------------------------------------------------------------------------

  // pickerPage(app, { label, accept, value, tryDoc(id | ''), onPick(id | ''), onImported(id) → false when declined }) → a
  // sub-page: [＋ 読み込む], なし, then the assets that fit `accept` as 144×81 posters (a video's filmstrip walks while
  // hovered or focused); hover or focus tries one on in the preview after 250 ms; Enter or a click picks it. A file
  // imported from ＋ is offered to onImported when it fits (the import ends later; the owner decides whether it still
  // applies).
  function pickerPage(app, o) {
    const t = app.t;
    const grid = h('div', { class: 'pb-grid med-grid', role: 'listbox', 'aria-label': o.label });
    const el = h('div', { class: 'pb-page med-picker' }, grid);
    let tryTimer = 0, anim = 0;

    function tile(id, label, extra) {
      const current = id === (o.value || '');
      const kids = [];
      if (extra && extra.icon) kids.push(h('span', { class: 'pb-thumb pb-autoicon', 'aria-hidden': 'true' }, I.icon(extra.icon, { size: 26 })));
      else kids.push(h('canvas', { class: 'pb-thumb', width: TILE_W, height: TILE_H, 'aria-hidden': 'true' }));
      kids.push(h('span', { class: 'pb-name', text: label }));
      if (extra && extra.badge) kids.push(h('span', { class: 'pb-badge', text: extra.badge }));
      if (current) kids.push(h('span', { class: 'pb-cur' }, I.icon('check', { size: 14 })));
      return h('button', { class: ['pb-tile', current ? 'is-current' : '', extra && extra.cls ? extra.cls : ''], type: 'button', role: 'option',
        'aria-selected': String(current), 'data-id': id === null ? '' : id, 'aria-label': extra && extra.aria ? extra.aria : label }, kids);
    }

    function render() {
      const list = MI.libraryOf(app.doc).filter((e) => MI.fitsAccept(o.accept || 'any', e));
      const add = tile(null, t('pb.importTile'), { icon: 'plus', cls: 'pb-make med-add' });
      const none = tile('', t('fld.none'), { icon: 'ring' });
      const tiles = list.map((e) => {
        const missing = app.media.state(e.id) === 'missing';
        const badges = missing ? [t('media.missing')] : MW.shortBadges(t, e);
        const x = tile(e.id, e.name, { badge: badges.join(' · ') || null,
          aria: [t('media.a11y.tile', { name: e.name, kind: t(MI.kindKey(e)) })].concat(badges).join(t('media.a11y.sep')) });
        if (!missing) MW.posterInto(app, x.querySelector('canvas'), e.id);
        return x;
      });
      dom.replace(grid, [add, none].concat(tiles));
    }

    const idOf = (x) => (x.classList.contains('med-add') ? null : x.dataset.id);
    function tryOn(x) {
      clearTimeout(tryTimer);
      const id = idOf(x);
      if (id === null) return;
      tryTimer = setTimeout(() => {
        const doc = o.tryDoc ? o.tryDoc(id) : null;
        const e = id ? MI.entryOf(app.doc, id) : null;
        if (doc) app.tryOn(doc, t('look.tryOn', { name: e ? e.name : t('fld.none') }));
      }, TRYON_MS);
    }
    function stopTry() { clearTimeout(tryTimer); app.tryOn(null); }
    function animate(x) {
      clearInterval(anim);
      const id = idOf(x);
      const e = id ? MI.entryOf(app.doc, id) : null;
      if (!e || !MI.isTimed(e) || dom.prefersReducedMotion() && document.activeElement !== x) return;
      const canvas = x.querySelector('canvas');
      let k = 0;
      anim = setInterval(() => app.media.strip(id).then((s) => {
        if (!s || !canvas.isConnected) return;
        const g = canvas.getContext('2d');
        const tw = s.image.width / s.tiles;
        const sc = Math.min(canvas.width / tw, canvas.height / s.image.height);
        const dw = tw * sc, dh = s.image.height * sc;
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.drawImage(s.image, (k++ % s.tiles) * tw, 0, tw, s.image.height, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
      }), SCRUB_MS);
    }
    function stopAnim(x) { clearInterval(anim); if (x) { const id = idOf(x); if (id) MW.posterInto(app, x.querySelector('canvas'), id); } }

    function pick(x) {
      stopTry();
      const id = idOf(x);
      if (id === null) {
        const done = o.onImported || ((x) => { o.onPick(x); return true; });
        app.media.pickAndImport({ onPicked: (e) => (MI.fitsAccept(o.accept || 'any', e) ? done(e.id) : false) });
        return;
      }
      o.onPick(id);
    }

    dom.on(grid, 'click', '.pb-tile', (ev, x) => pick(x));
    dom.on(grid, 'pointerover', '.pb-tile', (ev, x) => { tryOn(x); animate(x); });
    dom.on(grid, 'focusin', '.pb-tile', (ev, x) => { tryOn(x); animate(x); });
    dom.on(grid, 'focusout', '.pb-tile', (ev, x) => stopAnim(x));
    grid.addEventListener('pointerleave', () => { stopTry(); stopAnim(null); });
    render();

    const focused = () => (grid.contains(document.activeElement) && document.activeElement.classList.contains('pb-tile') ? document.activeElement : null);
    return {
      id: 'media-pick:' + (o.path || ''), crumb: ['pb.crumb', { what: o.label }], el,
      focus() { dom.focus(grid.querySelector('.pb-tile.is-current') || grid.querySelectorAll('.pb-tile')[1] || grid.querySelector('.pb-tile')); },
      move(dx, dy) {
        const tiles = [...grid.querySelectorAll('.pb-tile')];
        const at = Math.max(0, tiles.indexOf(document.activeElement));
        const cols = Math.max(1, tiles.filter((x) => x.offsetTop === tiles[0].offsetTop).length);
        const to = Math.max(0, Math.min(tiles.length - 1, at + dx + dy * cols));
        dom.focus(tiles[to]);
        tiles[to].scrollIntoView({ block: 'nearest' });
        return true;
      },
      pick() { const x = focused(); if (!x) return false; pick(x); return true; },
      refresh: render,
      destroy() { stopTry(); clearInterval(anim); },
    };
  }

  return { factsText, placeText, libraryRows, assetPage, pickerPage, openMenu };
});
