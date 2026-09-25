/* 文字PVメーカー v2 — original work. Part browser: tile pages with try-on, filter pages ("use only these"), thumbnails via engine.thumb, マイ素材, the 写真・動画 tab (DESIGN §6.4.12; DESIGN_2_1 §6.9, §11.7.5). */
MV.def('ui/part_browser', ['ui/dom', 'ui/icons', 'ui/output', 'ui/media_widgets', 'ui/media_io'], (dom, I, OUT, MW, MI) => {
  'use strict';

  const { h } = dom;
  const THUMB_W = 288, THUMB_H = 162;           // backing size of a 144×81 tile at 2× (§6.4.12)
  const CACHE_MAX = 200;                        // §7.3 thumbnails (UI): LRU 200
  const SLICE_MS = 8;
  const TRYON_MS = 250;
  const TABS = ['rec', 'all', 'season', 'mine', 'media'];
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const FILTER_KINDS = ['arrange', 'arrive', 'dwell', 'depart', 'seam', 'ornament', 'ground', 'lens', 'filter'];
  // The moment a still thumbnail shows (the sample cut spans 0–3 s): entrances mid-way, exits on their way out.
  const STILL_T = { arrive: 0.32, depart: 2.86 };

  // --- thumbnails: cached per (kind, key, theme, aspect), rendered in idle slices ---------------------------------

  function createThumbs(app) {
    const cache = new Map();
    const queue = [];
    let scheduled = false;

    function themeKey() { return app.plan && app.plan.look ? app.plan.look.theme.v : ''; }
    // A material's thumbnail follows its recipe (registry.extra[key].rhash, DESIGN_2_1 §6.9).
    function rhashOf(ref) {
      const extra = app.reg && app.reg.extra ? app.reg.extra[ref.key] : null;
      return extra && extra.rhash ? extra.rhash : '';
    }
    function keyOf(ref) { return [ref.kind, ref.key, ref.theme || themeKey(), app.doc.look.aspect, rhashOf(ref)].join('|'); }

    function paintSwatch(g, w, hh, sw, label) {
      g.fillStyle = sw.ground || '#333';
      g.fillRect(0, 0, w, hh);
      g.fillStyle = sw.ground2 || sw.ground || '#444';
      g.fillRect(0, hh * 0.72, w, hh * 0.28);
      g.fillStyle = sw.ink || '#fff';
      g.font = '700 ' + Math.round(hh * 0.34) + 'px "Hiragino Mincho ProN", "Noto Serif JP", serif';
      g.textBaseline = 'middle';
      g.fillText(label, w * 0.08, hh * 0.38);
      const bars = [sw.accent, sw.shiftA, sw.shiftB];
      bars.forEach((c, i) => { g.fillStyle = c || '#888'; g.fillRect(w * (0.08 + i * 0.14), hh * 0.8, w * 0.1, hh * 0.08); });
    }

    function render(ref) {
      const canvas = document.createElement('canvas');
      canvas.width = THUMB_W;
      canvas.height = THUMB_H;
      const g = canvas.getContext('2d');
      const reg = app.reg;
      if (ref.kind === 'theme') {
        const def = reg.get('theme', ref.key);
        paintSwatch(g, THUMB_W, THUMB_H, (def && def.swatch) || {}, app.t('look.swatchGlyph'));
      } else if (ref.kind === 'mood') {
        const def = reg.get('mood', ref.key);
        const top = def && def.themes ? Object.keys(def.themes).sort((a, b) => def.themes[b] - def.themes[a])[0] : null;
        const th = top ? reg.get('theme', top) : null;
        paintSwatch(g, THUMB_W, THUMB_H, (th && th.swatch) || {}, app.label('mood', ref.key));
      } else if (ref.key && ref.key !== 'none') {
        try {
          // The sample lines are UI text: in the page's language (the engine's own samples are Japanese); textB is the
          // line a transition (seam) cuts to.
          app.engine.thumb({ kind: ref.kind, key: ref.key }, { canvas, ctx: g, w: THUMB_W, h: THUMB_H },
            { t: ref.t !== undefined ? ref.t : STILL_T[ref.kind], text: ref.text || app.t('pb.sampleText'),
              textB: app.t('pb.sampleTextB'), theme: ref.theme || themeKey(), aspect: app.doc.look.aspect });
        } catch (e) { g.fillStyle = '#222'; g.fillRect(0, 0, THUMB_W, THUMB_H); }
      } else {
        g.fillStyle = '#1a1e26';
        g.fillRect(0, 0, THUMB_W, THUMB_H);
      }
      return canvas;
    }

    function blit(target, src) {
      const g = target.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, target.width, target.height);
      g.drawImage(src, 0, 0, target.width, target.height);
    }

    function pump() {
      scheduled = false;
      const until = performance.now() + SLICE_MS;
      while (queue.length && performance.now() < until) {
        const job = queue.shift();
        if (!job.target.isConnected) continue;
        const k = keyOf(job.ref);
        let img = cache.get(k);
        if (!img) {
          img = render(job.ref);
          cache.set(k, img);
          while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
        }
        if (job.target.dataset.thumb === k) blit(job.target, img);
      }
      if (queue.length) schedule();
    }

    function schedule() {
      if (scheduled) return;
      scheduled = true;
      if (typeof requestIdleCallback === 'function') requestIdleCallback(pump, { timeout: 120 });
      else setTimeout(pump, 16);
    }

    // draw(canvas, ref): paints now when cached, otherwise in the next idle slice.
    function draw(target, ref) {
      if (!ref || !ref.key) { target.dataset.thumb = ''; blit(target, render({ kind: 'none', key: null })); return; }
      const k = keyOf(ref);
      target.dataset.thumb = k;
      const hit = cache.get(k);
      if (hit) { cache.delete(k); cache.set(k, hit); blit(target, hit); return; }
      queue.push({ target, ref });
      schedule();
    }

    // Hover / focus: the tile animates (uncached frames) until the pointer leaves.
    function animate(target, ref) {
      if (!ref.key || ref.key === 'none' || ref.kind === 'theme' || ref.kind === 'mood' || dom.prefersReducedMotion()) return () => {};
      let frame = 0;
      const start = performance.now();
      const tick = () => {
        const tt = ((performance.now() - start) / 1000) % 3;
        blit(target, render(Object.assign({}, ref, { t: tt })));
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => { cancelAnimationFrame(frame); draw(target, ref); };
    }

    return { draw, animate, clear: () => cache.clear(), size: () => cache.size };
  }

  // --- helpers -------------------------------------------------------------------------------------------------------

  function allowedBy(filter, key) {
    if (!filter) return true;
    if (Array.isArray(filter.only) && !filter.only.includes(key)) return false;
    return !(Array.isArray(filter.deny) && filter.deny.includes(key));
  }

  function tagWeight(def, mood) {
    if (!mood || !mood.tagBias || !def || !Array.isArray(def.tags) || !def.tags.length) return 1;
    let w = 1;
    for (const tag of def.tags) w *= mood.tagBias[tag] === undefined ? 1 : mood.tagBias[tag];
    return Math.pow(w, 1 / def.tags.length);
  }

  // The keys a kind offers in the browser (pool:false parts only by pin; run-scope ornaments for atmos only).
  function keysFor(reg, kind, o) {
    const opt = o || {};
    return reg.keys(kind).filter((key) => {
      const def = reg.get(kind, key);
      if (opt.texture && def.texture !== true) return false;
      if (kind === 'ornament' && opt.run !== undefined && (def.scope === 'run') !== !!opt.run) return false;
      return true;
    });
  }

  // A ground derived from a pooled photo or video (registry.extra[key].media === true, DESIGN_2_1 §11.5.9): the tile page
  // shows the asset in its 写真・動画 tab instead of a part tile. A material's `media` is a list of ids, so the test is
  // strict (NOTES v2.1-C). The filter page lists them by the asset's name (「これだけ使う」 can mean "only my photos").
  function isDerivedMedia(reg, key) {
    const extra = reg && reg.extra ? reg.extra[key] : null;
    return !!extra && extra.media === true;
  }

  // Grid navigation: the tiles in rows by their offsetTop.
  function moveFocus(grid, dx, dy) {
    const tiles = [...grid.querySelectorAll('.pb-tile:not([hidden])')];
    if (!tiles.length) return;
    const at = Math.max(0, tiles.indexOf(document.activeElement));
    const cols = Math.max(1, tiles.filter((x) => x.offsetTop === tiles[0].offsetTop).length);
    const to = Math.max(0, Math.min(tiles.length - 1, at + dx + dy * cols));
    dom.focus(tiles[to]);
    tiles[to].scrollIntoView({ block: 'nearest' });
  }

  // --- the tile page of one slot ----------------------------------------------------------------------------------------

  // The material keys of a kind in the (effective) registry, as keysFor would offer them (DESIGN_2_1 §3.6 mine()).
  // The grounds derived from pooled photos and videos (extra[key].media === true, §11.5.9) are not materials; a material's
  // `media` is an id array, so the test is strict (NOTES v2.1-C).
  function mineFor(reg, kind, o) {
    const list = typeof reg.mine === 'function' ? reg.mine(kind) : [];
    const offered = new Set(keysFor(reg, kind, o));
    const extra = reg.extra || {};
    return list.filter((k) => offered.has(k) && !(extra[k] && extra[k].media === true));
  }

  // pickerPage(app, o) → page { id, crumb, el, focus, move, pick, destroy, refresh }
  //   o: { kind (registry kind), slotKind (path kind), path (full slot path at the page scope), label, value, allowNone,
  //        texture, run, onPick(key | null), tryDoc(key) → doc | null, alts: () → [{ key, w, masked }] | null }
  //   Additive (DESIGN_2_1 §6.5, §6.9): o.keys + o.info(key) → { text, blurb, tags } for tiles that are not registry
  //   parts (the shot presets); o.make → the マイ素材 tab and its inline 「AIで素材を作る」 form ({ scopeWord, blocked() →
  //   reason key | null, run({ description, use }) }); o.menuFor(key) → the context-menu items of a tile (materials);
  //   o.startTab.
  // The tiles are built once per plan. Tabs, tags and the search only choose and order the tiles the grid holds (§7.4:
  // a keystroke must not rebuild them). おすすめ comes from o.alts() — explain(), which re-runs the planner for the
  // slot — computed once per plan in an idle slice after the page shows. Until the first answer the tab holds only
  // 自動に戻す and the current part (so no tile shows that the answer would take away); after a new plan it keeps the
  // last answer until the next one lands. Without o.alts, or when it has nothing, おすすめ is the mood's tag fit.
  function pickerPage(app, o) {
    const t = app.t;
    const reg = app.reg;
    const thumbs = app.thumbs;
    const listed = Array.isArray(o.keys);
    let tab = o.kind === 'theme' || o.kind === 'mood' || (listed && !o.alts) ? 'all' : 'rec';
    let query = '';
    let tag = null;
    let tryTimer = 0;
    let stopAnim = null;
    let alts = null;                          // { plan, keys | null }: the おすすめ order explain() gave for that plan
    let altsJob = null;
    let destroyed = false;
    let tiles = new Map();                    // part key → its tile (the 自動 / なし tiles lead the grid)
    let leading = [];
    let emptyNote = null;
    const tabs = h('div', { class: 'segmented pb-tabs', role: 'tablist' });
    const search = h('input', { class: 'text-input pb-search', type: 'search', placeholder: t('pb.search'), 'aria-label': t('pb.search'),
      spellcheck: false });
    const tags = h('div', { class: 'chips pb-tags', role: 'group', 'aria-label': t('pb.tags') });
    const grid = h('div', { class: 'pb-grid', role: 'listbox', 'aria-label': o.label });
    const el = h('div', { class: 'pb-page' }, tabs, search, tags, grid);

    const all = listed ? o.keys.slice() : keysFor(reg, o.kind, o).filter((k) => !isDerivedMedia(reg, k));
    const mine = listed ? [] : mineFor(reg, o.kind, o);
    // What a tile shows and is searched by: a registry part's def, or o.info for listed keys.
    const defOf = (k) => (listed ? Object.assign({ tags: [], text: k }, o.info(k)) : reg.get(o.kind, k));
    const searchOf = (k) => { const d = defOf(k); return listed ? [k, d.text] : [k, d.label.ja, d.label.en]; };
    const tagList = [...new Set(all.flatMap((k) => (defOf(k).tags || [])))].sort();
    const moodNow = () => (app.plan && app.plan.look ? reg.get('mood', app.plan.look.mood.v) : null);

    // おすすめ without explain(): the mood's theme weights, else its tag fit.
    function fitOrder() {
      const mood = moodNow();
      if (o.kind === 'theme' && mood && mood.themes) return all.slice().sort((a, b) => (mood.themes[b] || 0) - (mood.themes[a] || 0));
      return all.slice().sort((a, b) => tagWeight(defOf(b), mood) - tagWeight(defOf(a), mood) || (a < b ? -1 : 1));
    }

    function altsReady() { return !!alts && alts.plan === app.plan; }

    function computeAlts() {
      let list = null;
      try { list = o.alts ? o.alts() : null; } catch (e) { list = null; }
      const keys = list && list.length ? list.filter((a) => !a.masked && all.includes(a.key)).map((a) => a.key) : null;
      alts = { plan: app.plan, keys };
    }

    // explain() runs once per plan, in an idle slice; the おすすめ tab is arranged again when it lands.
    function scheduleAlts() {
      if (altsJob || altsReady() || !o.alts) return;
      const run = () => {
        altsJob = null;
        if (destroyed || altsReady()) return;
        computeAlts();
        if (tab === 'rec') arrange();
      };
      altsJob = typeof requestIdleCallback === 'function' ? { idle: requestIdleCallback(run, { timeout: 150 }) }
        : { timer: setTimeout(run, 0) };
    }

    function cancelAlts() {
      if (!altsJob) return;
      if (altsJob.idle !== undefined && typeof cancelIdleCallback === 'function') cancelIdleCallback(altsJob.idle);
      if (altsJob.timer !== undefined) clearTimeout(altsJob.timer);
      altsJob = null;
    }

    // おすすめ: the latest answer of explain() (possibly for the previous plan while the new one is asked); before the
    // first one only the current part; the tag fit without an answer.
    function recommended() {
      if (alts) return alts.keys || fitOrder();
      return !o.alts ? fitOrder() : all.includes(o.value) ? [o.value] : [];
    }
    const pending = () => tab === 'rec' && !alts && !!o.alts;

    // The part keys of the current tab, in its order (before the tag and the search).
    function tabKeys() {
      if (tab === 'rec') return recommended();
      if (tab === 'mine') return mine;
      if (tab !== 'season') return all;
      return all.filter((k) => defOf(k).season)
        .sort((a, b) => SEASONS.indexOf(defOf(a).season) - SEASONS.indexOf(defOf(b).season));
    }

    function matches(key) {
      const def = defOf(key);
      if (tag && !(def.tags || []).includes(tag)) return false;
      const q = query.trim().toLowerCase();
      return !q || searchOf(key).some((s) => String(s).toLowerCase().includes(q));
    }

    function tile(key, label, extra) {
      const canvas = key === null ? h('span', { class: 'pb-thumb pb-autoicon', 'aria-hidden': 'true' }, I.icon('ring', { size: 26 }))
        : h('canvas', { class: 'pb-thumb', width: THUMB_W, height: THUMB_H, 'aria-hidden': 'true' });
      const current = key === o.value;
      const el2 = h('button', {
        class: ['pb-tile', current ? 'is-current' : '', extra && extra.dim ? 'is-dim' : ''], type: 'button', role: 'option',
        'aria-selected': String(current), 'data-key': key === null ? '' : key, title: extra && extra.blurb ? extra.blurb : label,
      }, canvas, h('span', { class: 'pb-name', text: label }),
      extra && extra.badge ? h('span', { class: 'pb-badge', text: extra.badge }) : null,
      current ? h('span', { class: 'pb-cur' }, I.icon('check', { size: 14 })) : null);
      if (key === null) el2.classList.add('pb-auto');
      return el2;
    }

    // A tile's thumbnail is drawn the first time the tile shows (hidden tiles cost nothing).
    let drawn = new Set();
    function drawThumb(key, x) {
      if (drawn.has(key)) return;
      drawn.add(key);
      const canvas = x.querySelector('canvas');
      if (canvas) thumbs.draw(canvas, { kind: o.kind, key });
    }

    // Tabs and tag chips are built once; a click updates their state in place (so the focus stays on them). マイ素材 is
    // offered for every kind a material can be made of (DESIGN_2_1 §6.9), even while it is empty: its first tile makes one.
    // 写真・動画 {n} (DESIGN_2_1 §11.7.5): for ground, ornament and atmosphere slots while the library holds something.
    const library = () => (app.doc.media && app.doc.media.list ? app.doc.media.list : []);
    const tabList = listed ? (o.alts ? ['rec', 'all'] : []) : TABS.filter((x) => (x !== 'season' || all.some((k) => defOf(k).season))
      && (x !== 'mine' || (!!o.make && FILTER_KINDS.includes(o.kind))) && (x !== 'media' || (!!o.media && library().length > 0)));
    const tabButtons = tabList.map((x) => h('button', { class: 'seg', type: 'button', role: 'tab', 'data-tab': x,
      on: { click: () => { tab = x; arrange(); } } }, x === 'mine' ? t('pb.tab.mine', { n: mine.length })
      : x === 'media' ? t('pb.tab.media', { n: library().length }) : t('pb.tab.' + x)));
    tabs.hidden = !tabList.length;
    const tagButtons = tagList.length > 1 ? tagList.map((x) => h('button', { class: 'chip pb-tag', type: 'button', 'data-tag': x,
      on: { click: () => { tag = tag === x ? null : x; arrange(); } } }, t.has('tag.' + x) ? t('tag.' + x) : x)) : [];
    dom.replace(tabs, tabButtons);
    dom.replace(tags, tagButtons);

    function showControls() {
      tabButtons.forEach((b, i) => {
        const on = tabList[i] === tab;
        b.setAttribute('aria-selected', String(on));
        b.setAttribute('aria-checked', String(on));
      });
      tagButtons.forEach((b, i) => {
        const on = tagList[i] === tag;
        b.classList.toggle('is-pinned', on);
        b.setAttribute('aria-pressed', String(on));
      });
    }

    // マイ素材 › ＋ AIで作る: the inline form under the grid (never a popover, DESIGN_2_1 §6.9).
    const makeTitle = o.make ? t('pb.makeTitle', { kind: t('kind.' + o.kind) }) : '';
    const makeText = h('textarea', { class: 'ai-text pb-make-text', rows: '2', maxlength: '300', placeholder: t('pb.makePlaceholder'),
      'aria-label': makeTitle });
    const makeUse = h('input', { type: 'checkbox', checked: true });
    const makeWhy = h('p', { class: 'ai-reason', role: 'status', hidden: true });
    const makeGo = h('button', { class: 'btn small primary', type: 'button', text: t('pb.make') });
    const makeForm = h('div', { class: 'pb-make-form', id: 'pb-make-form', hidden: true, role: 'group', 'aria-label': makeTitle },
      h('div', { class: 'field-label', text: makeTitle }), makeText,
      h('div', { class: 'ai-edit-row' }, h('label', { class: 'check-row' }, makeUse,
        h('span', { text: o.make ? t('pb.makeUse', { scope: o.make.scopeWord || '' }) : '' })), h('span', { class: 'grow' }), makeGo),
      makeWhy);
    if (o.make) el.appendChild(makeForm);

    function showMakeState() {
      if (!o.make) return;
      const why = o.make.blocked ? o.make.blocked() : null;
      makeWhy.hidden = !why;
      makeWhy.textContent = why ? t(why) : '';
      makeGo.disabled = !!why || !makeText.value.trim();
    }
    let makeTile = null;
    function toggleMake(on) {
      makeForm.hidden = on === undefined ? !makeForm.hidden : !on;
      if (makeTile) makeTile.setAttribute('aria-expanded', String(!makeForm.hidden));
      showMakeState();
      if (!makeForm.hidden) dom.focus(makeText);
    }
    makeText.addEventListener('input', showMakeState);
    makeText.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Enter' || ev.shiftKey || ev.isComposing || ev.keyCode === 229) return;
      ev.preventDefault();
      if (!makeGo.disabled) makeGo.click();
    });
    makeGo.addEventListener('click', () => {
      const description = makeText.value.trim();
      if (description && o.make) o.make.run({ description, use: makeUse.checked });
    });

    // The 写真・動画 tab's tiles: [＋ 読み込む], then the assets (posters). A pick pins the kind's media part and its source.
    let mediaTiles = [];
    function buildMedia() {
      if (!o.media) { mediaTiles = []; return; }
      const add = h('button', { class: 'pb-tile pb-make pb-media-add', type: 'button' },
        h('span', { class: 'pb-thumb pb-autoicon', 'aria-hidden': 'true' }, I.icon('plus', { size: 26 })),
        h('span', { class: 'pb-name', text: t('pb.importTile') }));
      mediaTiles = [add].concat(library().map((e) => {
        const missing = app.media && app.media.state(e.id) === 'missing';
        const canvas = h('canvas', { class: 'pb-thumb', width: THUMB_W, height: THUMB_H, 'aria-hidden': 'true' });
        if (!missing) MW.posterInto(app, canvas, e.id);
        return h('button', { class: 'pb-tile pb-media', type: 'button', role: 'option', 'aria-selected': 'false', 'data-media': e.id,
          'aria-label': t('media.a11y.tile', { name: e.name, kind: t(MI.kindKey(e)) }) + (missing ? t('media.a11y.sep') + t('media.missing') : '') },
        canvas, h('span', { class: 'pb-name', text: e.name }),
        missing ? h('span', { class: 'pb-badge', text: t('media.missing') }) : null);
      }));
    }

    // Every tile of the page, for the document and plan as they are now.
    function build() {
      buildMedia();
      leading = [tile(null, o.allowNone ? t('pb.none') : t('pb.auto'), { blurb: t('pb.autoTip') })];
      tiles = new Map();
      drawn = new Set();
      if (o.allowNone) {
        leading.push(tile('none', t('fld.none'), {}));
        drawThumb('none', leading[1]);
      }
      makeTile = o.make ? h('button', { class: 'pb-tile pb-make', type: 'button', 'aria-expanded': String(!makeForm.hidden),
        'aria-controls': 'pb-make-form', on: { click: () => toggleMake() } },
      h('span', { class: 'pb-thumb pb-autoicon', 'aria-hidden': 'true' }, I.icon('plus', { size: 26 })),
      h('span', { class: 'pb-name', text: t('pb.makeAi') })) : null;
      const filter = listed ? null : app.doc.filters[o.kind] || null;
      // Screen effects the backdrop mode leaves out (§4.19.4) are dimmed with a badge; the tooltip says why.
      const backdrop = o.kind === 'filter' ? OUT.effectiveBackdrop(app.doc) : 'scene';
      for (const key of all) {
        const def = defOf(key);
        const excluded = !allowedBy(filter, key);
        const skip = backdrop !== 'scene' ? OUT.skipOf(reg, key, backdrop) : null;
        const name = listed ? def.text : app.label(o.kind, key);
        const blurb = listed ? def.blurb || name : (def.blurb && def.blurb[t.lang]) || name;
        tiles.set(key, tile(key, name, {
          dim: excluded || !!skip,
          badge: excluded ? t('pb.excluded') : skip ? t('pb.skipped') : def.season ? t('fld.season.' + def.season) : null,
          blurb: skip ? blurb + '\n' + t('fld.fxSkipped', { bg: t('exp.bg.' + skip) }) : blurb,
        }));
      }
      emptyNote = h('p', { class: 'note subtle', text: t('pb.empty') });
      dom.clear(grid);
    }

    // Puts the tiles the tab, the tag and the search leave in the grid, in the tab's order; the others wait outside it
    // (the same elements come back). The grid changes only when its content does, and a focused tile keeps the focus.
    function arrange() {
      showControls();
      if (tab === 'media') {
        const now = grid.children;
        if (mediaTiles.length !== now.length || mediaTiles.some((n, i) => now[i] !== n)) dom.replace(grid, mediaTiles);
        return;
      }
      const keys = tabKeys().filter(matches);
      const want = leading.concat(tab === 'mine' && makeTile ? [makeTile] : [], keys.map((k) => tiles.get(k)));
      if (!keys.length && !pending()) want.push(emptyNote);
      const now = grid.children;
      if (want.length !== now.length || want.some((n, i) => now[i] !== n)) {
        const focused = grid.contains(document.activeElement) ? document.activeElement : null;
        dom.replace(grid, want);
        // A focused tile that stays keeps the focus; one that leaves hands it to 自動に戻す (never to the page).
        if (focused && document.activeElement !== focused) dom.focus(want.includes(focused) ? focused : leading[0]);
      }
      for (const key of keys) drawThumb(key, tiles.get(key));
    }

    function render() {
      build();
      arrange();
      scheduleAlts();
    }

    // --- try-on, picking, context menu -------------------------------------------------------------------------

    function tryKey(key) {
      clearTimeout(tryTimer);
      tryTimer = setTimeout(() => {
        const doc = key === undefined ? null : o.tryDoc(key);
        if (doc) app.tryOn(doc, t('look.tryOn', { name: key === null ? t('pb.auto') : key === 'none' ? t('fld.none') : app.label(o.kind, key) }));
      }, TRYON_MS);
    }
    function stopTry() { clearTimeout(tryTimer); app.tryOn(null); }
    const keyOfTile = (el2) => (el2.dataset.key === '' ? null : el2.dataset.key);

    // ＋ AIで作る (.pb-make) is a tile of its own: it opens the form and is never picked or tried on; so are the 写真・動画
    // tab's tiles (.pb-media, and its ＋ 読み込む).
    const PICKABLE = '.pb-tile:not(.pb-make):not(.pb-media)';
    const pickMedia = (id) => { stopTry(); if (o.media) o.media.onPick(id); };
    dom.on(grid, 'click', '.pb-media', (ev, el2) => pickMedia(el2.dataset.media));
    dom.on(grid, 'click', '.pb-media-add', () => {
      // the import ends later: the tab's owner places it only while this browser is still shown (o.media.onImported)
      if (app.media) app.media.pickAndImport({ onPicked: (e) => (o.media && o.media.onImported ? o.media.onImported(e.id) : false) });
    });
    const tryMedia = (el2) => {
      clearTimeout(tryTimer);
      tryTimer = setTimeout(() => {
        const doc = o.media ? o.media.tryDoc(el2.dataset.media) : null;
        const e = MI.entryOf(app.doc, el2.dataset.media);
        if (doc) app.tryOn(doc, t('look.tryOn', { name: e ? e.name : '' }));
      }, TRYON_MS);
    };
    dom.on(grid, 'pointerover', '.pb-media', (ev, el2) => tryMedia(el2));
    dom.on(grid, 'focusin', '.pb-media', (ev, el2) => tryMedia(el2));
    dom.on(grid, 'click', PICKABLE, (ev, el2) => { stopTry(); o.onPick(keyOfTile(el2)); });
    dom.on(grid, 'pointerover', PICKABLE, (ev, el2) => {
      tryKey(keyOfTile(el2));
      if (stopAnim) stopAnim();
      const canvas = el2.querySelector('canvas');
      stopAnim = canvas && keyOfTile(el2) ? thumbs.animate(canvas, { kind: o.kind, key: keyOfTile(el2) }) : null;
    });
    dom.on(grid, 'focusin', PICKABLE, (ev, el2) => tryKey(keyOfTile(el2)));
    grid.addEventListener('pointerleave', () => { stopTry(); if (stopAnim) { stopAnim(); stopAnim = null; } });
    dom.on(grid, 'contextmenu', '.pb-tile', (ev, el2) => {
      const key = keyOfTile(el2);
      if (!key || key === 'none' || !app.menus || !FILTER_KINDS.includes(o.kind) || el2.classList.contains('pb-make')) return;
      ev.preventDefault();
      // A material tile has its own menu: 素材を開く / 複製 / AIで作り直す… / この素材を使わない / 削除 (DESIGN_2_1 §6.9).
      const own = o.menuFor ? o.menuFor(key) : null;
      app.menus.context(ev, own || [
        { label: t('pb.deny'), run: () => setFilter(app, o.kind, denyOne(app, o.kind, key)) },
        { label: t('pb.only'), run: () => setFilter(app, o.kind, { only: [key], deny: null }) },
      ]);
    });
    search.addEventListener('input', () => { query = search.value; arrange(); });

    const focusedTile = () => {
      const at = document.activeElement;
      return at && at.classList && at.classList.contains('pb-tile') && grid.contains(at) ? at : null;
    };

    render();
    if (o.startTab && tabList.includes(o.startTab)) { tab = o.startTab; arrange(); }
    return {
      id: 'pick:' + o.path, crumb: ['pb.crumb', { what: o.label }], el,
      tab: () => tab,
      // The マイ素材 tab with its form open (AIで作り直す… and the keyboard path to 「AIで作る」).
      openMake() {
        if (!o.make) return;
        if (tabList.includes('mine')) { tab = 'mine'; arrange(); }
        toggleMake(true);
      },
      showMake: showMakeState,
      focus() { dom.focus(grid.querySelector('.pb-tile.is-current') || grid.querySelector('.pb-tile')); },
      move(dx, dy) {
        if (document.activeElement === search && dx) return false;
        moveFocus(grid, dx, dy);
        return true;
      },
      pick() {
        const at = focusedTile();
        if (at && at.classList.contains('pb-media')) { pickMedia(at.dataset.media); return true; }
        if (at && at.classList.contains('pb-media-add')) { at.click(); return true; }
        if (at && at.classList.contains('pb-make')) { toggleMake(); return true; }
        if (at) { stopTry(); o.onPick(keyOfTile(at)); return true; }
        return false;
      },
      destroy() { destroyed = true; cancelAlts(); stopTry(); if (stopAnim) stopAnim(); },
      // A new plan (undo, a filter change …): the tiles are built again, and the focused one keeps the focus.
      refresh() {
        const at = focusedTile();
        const key = at ? keyOfTile(at) : undefined;
        if (stopAnim) { stopAnim(); stopAnim = null; }
        render();
        if (key === undefined) return;
        const again = key === null ? leading[0] : key === 'none' && o.allowNone ? leading[1] : tiles.get(key);
        dom.focus(again && grid.contains(again) ? again : leading[0]);
      },
    };
  }

  // --- filters ("use only these", §6.4.5 部品) -------------------------------------------------------------------------

  function filterOf(app, kind) {
    const f = app.doc.filters[kind];
    return { only: f && Array.isArray(f.only) ? f.only.slice() : null, deny: f && Array.isArray(f.deny) ? f.deny.slice() : null };
  }

  function counts(app, kind) {
    const keys = keysFor(app.reg, kind).filter((k) => app.reg.get(kind, k).pool !== false);
    const f = app.doc.filters[kind] || null;
    return { on: keys.filter((k) => allowedBy(f, k)).length, total: keys.length };
  }

  function normalize(app, kind, f) {
    const keys = keysFor(app.reg, kind).filter((k) => app.reg.get(kind, k).pool !== false);
    let only = f.only && f.only.length ? [...new Set(f.only)].sort() : null;
    let deny = f.deny && f.deny.length ? [...new Set(f.deny)].sort() : null;
    if (only && keys.every((k) => only.includes(k))) only = null;
    if (deny && only) deny = deny.filter((k) => only.includes(k));
    if (deny && !deny.length) deny = null;
    return { only, deny };
  }

  // The last usable part of a kind never goes: 「少なくとも1つは使います」 (§3.8, §6.11).
  function setFilter(app, kind, next) {
    const f = normalize(app, kind, next);
    const keys = keysFor(app.reg, kind).filter((k) => app.reg.get(kind, k).pool !== false);
    if (!keys.some((k) => allowedBy(f, k))) { app.toast(app.t('pb.keepOne'), { kind: 'warn' }); return false; }
    app.dispatch({ t: 'filter.set', kind, only: f.only, deny: f.deny }, { label: ['undo.filter', { kind: app.t('kind.' + kind) }] });
    return true;
  }

  function denyOne(app, kind, key) {
    const f = filterOf(app, kind);
    if (f.only) return { only: f.only.filter((k) => k !== key), deny: f.deny };
    return { only: null, deny: (f.deny || []).concat([key]) };
  }

  function allowOne(app, kind, key) {
    const f = filterOf(app, kind);
    if (f.only) return { only: f.only.concat([key]), deny: f.deny ? f.deny.filter((k) => k !== key) : null };
    return { only: null, deny: f.deny ? f.deny.filter((k) => k !== key) : null };
  }

  function presetOf(app, kind, preset) {
    const reg = app.reg;
    const keys = keysFor(reg, kind).filter((k) => reg.get(kind, k).pool !== false);
    if (preset === 'all') return { only: null, deny: null };
    if (preset === 'mood') {
      const mood = app.plan && app.plan.look ? reg.get('mood', app.plan.look.mood.v) : null;
      const fit = keys.filter((k) => tagWeight(reg.get(kind, k), mood) >= 1);
      return { only: fit.length ? fit : [reg.fallback(kind)], deny: null };
    }
    const minimal = keys.filter((k) => (reg.get(kind, k).tags || []).includes('minimal') || reg.get(kind, k).fallback === true);
    return { only: minimal.length ? minimal : [reg.fallback(kind)], deny: null };
  }

  function filterPage(app, o) {
    const t = app.t;
    const reg = app.reg;
    const kind = o.kind;
    let query = '';
    let season = null;
    const presets = h('div', { class: 'row-actions pb-presets' }, ['all', 'mood', 'min'].map((p) => h('button', {
      class: 'chip-btn', type: 'button', on: { click: () => setFilter(app, kind, presetOf(app, kind, p)) },
    }, t('pb.preset.' + p))));
    const search = h('input', { class: 'text-input pb-search', type: 'search', placeholder: t('pb.search'), 'aria-label': t('pb.search') });
    const seasons = h('div', { class: 'chips pb-tags', role: 'group', 'aria-label': t('fld.season') });
    const count = h('div', { class: 'pb-count', role: 'status' });
    const grid = h('div', { class: 'pb-grid is-filter', role: 'group', 'aria-label': t('kind.' + kind) });
    const el = h('div', { class: 'pb-page' }, h('p', { class: 'note subtle', text: t('pb.filterHelp') }), presets, search, seasons, count, grid);
    const keys = keysFor(reg, kind).filter((k) => reg.get(kind, k).pool !== false);
    const hasSeasons = keys.some((k) => reg.get(kind, k).season);

    function render() {
      const f = app.doc.filters[kind] || null;
      dom.replace(seasons, hasSeasons ? [null, 'none'].concat(SEASONS).map((s) => h('button', {
        class: ['chip', s === season ? 'is-pinned' : ''], type: 'button', 'aria-pressed': String(s === season),
        on: { click: () => { season = s; render(); } },
      }, s === null ? t('pb.allSeasons') : t('fld.season.' + s))) : []);
      const c = counts(app, kind);
      count.textContent = t('pb.count', { on: c.on, total: c.total });
      const q = query.trim().toLowerCase();
      const shown = keys.filter((k) => {
        const def = reg.get(kind, k);
        if (season === 'none' && def.season) return false;
        if (season && season !== 'none' && def.season !== season) return false;
        return !q || [k, def.label.ja, def.label.en].some((s) => String(s).toLowerCase().includes(q));
      });
      dom.replace(grid, shown.map((key) => {
        const on = allowedBy(f, key);
        const canvas = h('canvas', { class: 'pb-thumb', width: THUMB_W, height: THUMB_H, 'aria-hidden': 'true' });
        const box = h('input', { type: 'checkbox', checked: on, 'aria-label': app.label(kind, key) });
        box.addEventListener('change', () => {
          const ok = setFilter(app, kind, on ? denyOne(app, kind, key) : allowOne(app, kind, key));
          if (!ok) box.checked = true;
        });
        app.thumbs.draw(canvas, { kind, key });
        return h('label', { class: ['pb-tile', 'pb-check', on ? '' : 'is-dim'] }, canvas,
          h('span', { class: 'pb-name' }, box, app.label(kind, key)));
      }));
    }
    search.addEventListener('input', () => { query = search.value; render(); });
    render();
    return {
      id: 'filter:' + kind, crumb: ['pb.filterCrumb', { what: t('kind.' + kind) }], el,
      focus() { dom.focus(grid.querySelector('input') || search); },
      move(dx, dy) {
        if (document.activeElement === search && dx) return false;
        const tiles = [...grid.querySelectorAll('input')];
        const at = Math.max(0, tiles.indexOf(document.activeElement));
        const cols = Math.max(1, Math.round(grid.clientWidth / 140));
        const to = Math.max(0, Math.min(tiles.length - 1, at + dx + dy * cols));
        if (tiles[to]) dom.focus(tiles[to]);
        return true;
      },
      pick() { return false; },
      destroy() {},
      refresh: render,
    };
  }

  return { createThumbs, pickerPage, filterPage, counts, setFilter, denyOne, allowedBy, keysFor, mineFor, tagWeight, isDerivedMedia,
    FILTER_KINDS, THUMB_W, THUMB_H };
});
