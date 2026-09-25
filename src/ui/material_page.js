/* 文字PVメーカー v2 — original work. マイ素材: the material page (knobs, weight, uses, recipe JSON, remake, duplicate, delete) and the material menus (DESIGN_2_1 §6.9). */
MV.def('ui/material_page', ['ui/dom', 'ui/icons', 'ui/widgets', 'ui/part_browser', 'ui/fields', 'ui/selection', 'core/recipe',
  'core/paths', 'planner/areas', 'parts/mix'],
(dom, I, W, PB, F, S, RC, P, AREAS, MIX) => {
  'use strict';

  const { h } = dom;
  const COST_BARS = 5;
  // The static-cost budget a material's weight is shown against (DESIGN_2_1 §5.8); kinds without a scene budget use
  // the cut ornament's.
  const BUDGET_MS = Object.freeze({ ornamentCut: 1.2, ornamentRun: 1.5, ground: 2.0, other: 1.2 });

  // --- pure helpers (Node-tested) ----------------------------------------------------------------------------------

  function keyOfId(id) { return 'myMat' + String(id).slice(1); }
  function idOfKey(key) { return /^myMat[0-9a-z]+$/.test(String(key)) ? 'm' + String(key).slice(5) : null; }
  function entryOf(doc, id) {
    const list = doc && doc.materials && Array.isArray(doc.materials.list) ? doc.materials.list : [];
    return list.find((m) => m.id === id) || null;
  }

  // usesOf(doc, key) → the pin paths that use the material: its key as a value, part-qualified slots (…@key…), and
  // avoid lists that name it (what material.remove cleans, §2.6).
  function usesOf(doc, key) {
    const out = [];
    for (const path of Object.keys((doc && doc.pins) || {}).sort()) {
      const pin = doc.pins[path];
      const slot = path.slice(path.indexOf(':') + 1);
      const v = pin ? pin.v : null;
      if (v === key || slot.includes('@' + key + '.') || slot.endsWith('@' + key)
        || (Array.isArray(v) && v.some((x) => typeof x === 'string' && x.endsWith('.' + key)))) out.push(path);
    }
    return out;
  }

  // usePlaces(doc, plan, key) → [{ sel, label }] of the places that use it: the lines of one named area together
  // (「サビ1（5行）」), other lines and cuts one by one, the whole video last. `label` is [stringKey, params] or text.
  function usePlaces(doc, plan, key) {
    const scopes = [...new Set(usesOf(doc, key).map((p) => p.slice(0, p.indexOf(':'))))];
    const lineIds = scopes.filter((s) => s.startsWith('line/')).map((s) => s.slice(5));
    const out = [];
    if (lineIds.length > 1 && plan) {
      const ref = AREAS.ofLines(doc, plan, lineIds);
      const area = ref.kind !== 'lines' ? AREAS.resolve(doc, plan, ref) : null;
      if (area) { out.push({ sel: S.areaSel(area), area }); lineIds.length = 0; }
    }
    for (const id of lineIds) out.push({ sel: { level: 'line', ids: [id] }, crumbs: true });
    for (const s of scopes.filter((x) => x.startsWith('cut/'))) out.push({ sel: { level: 'cut', key: s.slice(4) }, crumbs: true });
    if (scopes.includes('work')) out.push({ sel: S.WORK, work: true });
    return out;
  }

  // weightOf(entry) → { ms, max, bars (1–5), word: 'light' | 'normal' | 'heavy' } from core/recipe.cost at knob max.
  function weightOf(entry) {
    let c = null;
    try { c = RC.cost(entry.kind, entry.recipe); } catch (e) { c = null; }
    const ms = c && Number.isFinite(c.ms) ? c.ms : 0;
    const max = entry.kind === 'ground' ? BUDGET_MS.ground : entry.kind === 'ornament'
      ? (entry.recipe && entry.recipe.scope === 'run' ? BUDGET_MS.ornamentRun : BUDGET_MS.ornamentCut) : BUDGET_MS.other;
    const bars = Math.max(1, Math.min(COST_BARS, Math.ceil(ms / max * COST_BARS)));
    return { ms, max, bars, word: bars <= 2 ? 'light' : bars <= 3 ? 'normal' : 'heavy' };
  }

  // duplicateCmd(doc, entry) → material.put of a copy under the next id, made by the user (§6.9 複製).
  function duplicateCmd(doc, entry) {
    const next = doc.materials && Number.isInteger(doc.materials.next) ? doc.materials.next : 1;
    return { t: 'material.put', id: 'm' + next.toString(36), kind: entry.kind, by: 'user', name: entry.name, blurb: entry.blurb,
      tags: entry.tags, season: entry.season, pool: entry.pool, recipe: entry.recipe };
  }

  // putCmd(entry, recipe) → material.put of the same entry with another recipe.
  function putCmd(entry, recipe) {
    return { t: 'material.put', id: entry.id, kind: entry.kind, by: entry.by, name: entry.name, blurb: entry.blurb, tags: entry.tags,
      season: entry.season, pool: entry.pool, recipe };
  }

  // checkRecipe(kind, text, derive?) → { recipe | null, problems: [{ path, code, params }], bad: 'json' | null } (the recipe
  // textarea: JSON.parse, then core/recipe; nothing is executed). derive(recipe) → the problems of parts/mix.derive (the
  // base part, inner parts and their params, which core/recipe cannot see); it includes core/recipe's own.
  function checkRecipe(kind, text, derive) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { return { recipe: null, problems: [], bad: 'json' }; }
    const n = RC.normalize(kind, raw);
    const list = derive ? derive(n.recipe) : n.problems.concat(RC.problems(kind, n.recipe));
    const seen = new Set();
    const problems = [];
    for (const p of list) {
      const k = p.path + '|' + p.code;
      if (!seen.has(k)) { seen.add(k); problems.push({ path: p.path, code: p.code, params: p.params || {} }); }
    }
    return { recipe: n.recipe, problems, bad: null };
  }

  // A problem in words: 「layers[0].count: 数が多すぎます」 (mat.why.<code>; an unknown code as it is).
  function problemText(t, p) {
    const what = t.has('mat.why.' + p.code) ? t('mat.why.' + p.code, Object.assign({ key: '', name: '' }, p.params)) : p.code;
    return t('mat.problem', { path: p.path || '—', what });
  }

  // Whether the recipe makes a part (parts/mix.derive gives a definition; problems it only drops are listed, not fatal).
  function usable(app, e, recipe) {
    try {
      const reg = app.reg;
      const doc = app.doc;
      return !!MIX.derive(Object.assign({}, e, { recipe }), reg && reg.base ? reg.base : reg,
        { list: doc.materials ? doc.materials.list : [], media: doc.media ? doc.media.list : null }).def;
    } catch (err) { return RC.problems(e.kind, recipe).length === 0; }
  }

  // The problems parts/mix.derive finds in an entry with this recipe (against the base registry and the project's list).
  function deriveProblems(app, e, recipe) {
    try {
      const reg = app.reg;
      const base = reg && reg.base ? reg.base : reg;
      const doc = app.doc;
      return MIX.derive(Object.assign({}, e, { recipe }), base, { list: doc.materials ? doc.materials.list : [],
        media: doc.media ? doc.media.list : null }).problems;
    } catch (err) { return RC.problems(e.kind, recipe); }
  }

  // The words of a material's kind: 「装飾・空気」 for a run ornament (an atmosphere).
  function kindText(t, entry) {
    const kind = t('kind.' + entry.kind);
    return entry.kind === 'ornament' && entry.recipe && entry.recipe.scope === 'run' ? t('mat.kindRun', { kind, run: t('mat.run') }) : kind;
  }

  function nameText(t, entry) {
    const n = entry.name || {};
    return (t.lang === 'en' ? n.en || n.ja : n.ja) || t('mat.untitled');
  }

  // --- actions shared by the page, the マイ素材 section and the part browser's tile menu -----------------------------------

  function remove(app, entry) {
    const n = usesOf(app.doc, keyOfId(entry.id)).length;
    app.dispatch({ t: 'material.remove', id: entry.id }, { label: ['undo.material.remove', {}] });
    const text = n ? app.t('mat.deleted', { name: nameText(app.t, entry) }) + ' ' + app.t('mat.deleteNote', { n })
      : app.t('mat.deleted', { name: nameText(app.t, entry) });
    app.toast(text, { kind: 'ok', action: { label: app.t('cmd.edit.undo'), run: () => app.actions.run('edit.undo') } });
  }

  function duplicate(app, entry) {
    if (app.doc.materials.list.length >= 64) { app.toast(app.t('mat.full'), { kind: 'warn' }); return; }
    app.dispatch(duplicateCmd(app.doc, entry), { label: ['undo.material.put', {}] });
  }

  // menuItems(app, key, open) → 素材を開く / 複製 / AIで作り直す… / この素材を使わない / 削除 for a material key, or null
  // for a part that is not one of this project's materials. open(id, { remake }) shows the material page.
  function menuItems(app, key, open) {
    const id = idOfKey(key);
    const entry = id ? entryOf(app.doc, id) : null;
    if (!entry) return null;
    const t = app.t;
    const kind = entry.kind;
    return [
      { label: t('mat.open'), run: () => open(entry.id, {}) },
      { label: t('mat.duplicate'), run: () => duplicate(app, entry) },
      { label: t('mat.remake'), run: () => open(entry.id, { remake: true }) },
      { label: t('mat.notUse'), run: () => PB.setFilter(app, kind, PB.denyOne(app, kind, key)) },
      { sep: true },
      { label: t('mat.delete'), run: () => remove(app, entry) },
    ];
  }

  // --- the page ----------------------------------------------------------------------------------------------------------

  // page(app, { id, remake, onSelect(sel) }) → an inspector sub-page { id, crumb, el, focus, refresh, destroy }.
  function page(app, o) {
    const t = app.t;
    const el = h('div', { class: 'mat-page' });
    let base = null;                       // the recipe the knobs multiply, and their values since then
    let factors = {};
    let gesture = null;
    let remakeOpen = !!o.remake;
    let editOpen = false;
    let stopAnim = null;

    const entry = () => entryOf(app.doc, o.id);

    function knobRows(e) {
      const specs = RC.knobSpecs(e.kind, e.recipe);
      const names = Object.keys(specs);
      if (!names.length) return [];
      // The knobs multiply the recipe as it was when the page opened (or last changed from elsewhere, e.g. undo).
      const want = base ? RC.hash(RC.withKnobs(base, factors)) : null;
      if (!base || RC.hash(e.recipe) !== want) { base = e.recipe; factors = {}; }
      return names.map((name) => {
        const spec = specs[name];
        const label = spec.label ? spec.label[t.lang] || spec.label.ja : t('mat.knob.' + name);
        const field = { id: 'mat/' + name, widget: 'number', spec, label: 'fld.param', path: null };
        const env = {
          app, t, label, field,
          commit: (v) => write(Object.assign({}, factors, { [name]: v }), null),
          gesture: () => {
            gesture = app.store.gesture('mat:' + e.id + ':' + name);
            return { set: (v) => write(Object.assign({}, factors, { [name]: v }), 'mat:' + e.id + ':' + name),
              end: () => { if (gesture) { gesture.end(); gesture = null; } render(); } };
          },
          unpin: () => write(Object.assign({}, factors, { [name]: 1 }), null),
          open() {}, thumb() {}, slot() {},
        };
        const w = W.make(field, env);
        w.update({ value: factors[name] === undefined ? 1 : factors[name], mixed: false, auto: false, readOnly: false });
        return h('div', { class: 'frow mat-knob', 'data-knob': name }, h('div', { class: 'fr-top' }, h('span', { class: 'fr-label', text: label })), w.el);
      });
    }

    function write(next, merge) {
      const e = entry();
      if (!e || !base) return;
      factors = next;
      const meta = { label: ['undo.material.put', {}] };
      if (merge) meta.mergeKey = merge;
      app.dispatch(putCmd(e, RC.withKnobs(base, factors)), meta);
    }

    function place(p) {
      const text = p.area ? F.areaTitle(t, p.area) : p.work ? t('area.work')
        : S.crumbs(p.sel, app.plan).slice(1).map((c) => t.label(c.label)).join(' ');
      return h('button', { class: 'link mat-use', type: 'button', text,
        on: { click: () => (o.onSelect ? o.onSelect(p.sel) : app.select(p.sel, { from: 'crumbs' })) } });
    }

    function render() {
      if (gesture) return;
      const e = entry();
      if (stopAnim) { stopAnim(); stopAnim = null; }
      if (!e) { dom.replace(el, h('p', { class: 'note subtle', text: t('mat.gone') })); return; }
      const key = keyOfId(e.id);
      const w = weightOf(e);
      const places = app.plan ? usePlaces(app.doc, app.plan, key) : [];
      const uses = usesOf(app.doc, key).length;
      // 桜吹雪 ✎ (rename in the page's language) · 装飾・空気 · 春 · AI作成
      const nameEl = h('h3', { class: 'mat-name', text: nameText(t, e) });
      const renameBox = h('input', { class: 'text-input mat-rename', type: 'text', maxlength: '24', hidden: true, value: nameText(t, e),
        'aria-label': t('mat.rename') });
      const renameBtn = h('button', { class: 'icon-btn small', type: 'button', title: t('mat.rename'), 'aria-label': t('mat.rename'),
        on: { click: () => { renameBox.hidden = false; nameEl.hidden = true; dom.focus(renameBox); renameBox.select(); } } }, '✎');
      renameBox.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); rename(e, renameBox.value); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); render(); }
      });
      renameBox.addEventListener('change', () => rename(e, renameBox.value));
      const meta = [kindText(t, e), e.season ? t('fld.season.' + e.season) : null, t(e.by === 'ai' ? 'mat.byAi' : 'mat.byUser')]
        .filter(Boolean).join(' · ');
      // ▶ the thumbnail (animated only while hovered or focused, and never with reduced motion).
      const canvas = h('canvas', { class: 'mat-thumb', width: PB.THUMB_W, height: PB.THUMB_H, 'aria-hidden': 'true' });
      const refKind = e.kind === 'ornament' && e.recipe && e.recipe.scope === 'run' ? 'ornament' : e.kind;
      if (app.thumbs) app.thumbs.draw(canvas, { kind: refKind, key });
      const thumbBtn = h('button', { class: 'mat-thumb-btn', type: 'button', title: t('mat.preview'), 'aria-label': t('mat.preview') },
        canvas, h('span', { class: 'mat-play', 'aria-hidden': 'true' }, I.icon('play', { size: 18 })));
      const animOn = () => { if (!stopAnim && app.thumbs) stopAnim = app.thumbs.animate(canvas, { kind: refKind, key }); };
      const animOff = () => { if (stopAnim) { stopAnim(); stopAnim = null; } };
      thumbBtn.addEventListener('pointerenter', animOn);
      thumbBtn.addEventListener('focus', animOn);
      thumbBtn.addEventListener('pointerleave', animOff);
      thumbBtn.addEventListener('blur', animOff);
      const pool = h('input', { type: 'checkbox', role: 'switch', checked: e.pool === true, 'aria-label': t('mat.pool'),
        on: { change: (ev) => app.dispatch({ t: 'material.meta', id: e.id, pool: ev.target.checked }, { label: ['undo.material.meta', {}] }) } });
      const bars = h('span', { class: 'mat-bars', 'aria-hidden': 'true', text: '■'.repeat(w.bars) + '□'.repeat(COST_BARS - w.bars) });
      const recipeText = JSON.stringify(e.recipe, null, 2);
      const kids = [
        h('div', { class: 'mat-head' }, nameEl, renameBox, renameBtn, h('span', { class: 'grow' })),
        h('p', { class: 'note subtle mat-meta', text: meta }),
        thumbBtn,
        knobRows(e),
        h('div', { class: 'field-row mat-cost', role: 'group', 'aria-label': t('mat.cost') },
          h('span', { class: 'field-label inline', text: t('mat.cost') }), bars, h('span', { text: t('mat.' + w.word) })),
        h('label', { class: 'check-row' }, pool, h('span', { text: t('mat.pool') })),
        h('div', { class: 'mat-uses' }, h('span', { class: 'field-label inline', text: t('mat.used', { n: places.length }) }),
          places.map(place)),
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn small', type: 'button', 'aria-expanded': String(remakeOpen), text: t('mat.remake'),
            on: { click: () => { remakeOpen = !remakeOpen; render(); if (remakeOpen) dom.focus(el.querySelector('.mat-remake-text')); } } }),
          h('button', { class: 'btn small', type: 'button', text: t('mat.duplicate'), on: { click: () => duplicate(app, e) } })),
        remakeOpen ? remakeForm(e) : null,
        recipeBlock(e, recipeText),
        h('div', { class: 'row-actions mat-delete' },
          h('button', { class: 'btn small', type: 'button', text: t('mat.delete'),
            on: { click: () => { remove(app, e); if (o.onGone) o.onGone(); } } }),
          uses ? h('span', { class: 'note subtle', text: t('mat.deleteNote', { n: uses }) }) : null),
      ];
      const active = document.activeElement && el.contains(document.activeElement) ? document.activeElement : null;
      const again = active ? active.getAttribute('aria-label') || active.textContent : null;
      dom.replace(el, kids);
      if (again) {
        const match = [...el.querySelectorAll('button, input, textarea, select')].find((x) => (x.getAttribute('aria-label') || x.textContent) === again);
        if (match) dom.focus(match);
      }
    }

    function rename(e, text) {
      const v = String(text || '').trim().slice(0, 24);
      if (!v) { render(); return; }
      const name = Object.assign({}, e.name);
      if (t.lang === 'en') name.en = v;
      else { if (!name.en || name.en === name.ja) name.en = v; name.ja = v; }
      app.dispatch({ t: 'material.meta', id: e.id, name }, { label: ['undo.material.meta', {}] });
    }

    // AIで作り直す…: the material tool with this material as the starting point (DESIGN_2_1 §5.10).
    function remakeForm(e) {
      const text = h('textarea', { class: 'ai-text mat-remake-text', rows: '2', maxlength: '300', placeholder: t('pb.makePlaceholder'),
        'aria-label': t('mat.remake') });
      const why = app.ai && app.ai.blocked ? app.ai.blocked('material') : 'boot.soon';
      const go = h('button', { class: 'btn small primary', type: 'button', text: t('pb.make'), disabled: true });
      const reason = h('p', { class: 'ai-reason', role: 'status', hidden: !why, text: why ? t(why) : '' });
      text.addEventListener('input', () => { go.disabled = !!why || !text.value.trim(); });
      go.addEventListener('click', () => {
        if (!app.ai) return;
        app.openPanel('ai', 'ai');
        app.ai.run('material', { description: text.value.trim(), kind: e.kind, current: e });
      });
      return h('div', { class: 'pb-make-form' }, text, h('div', { class: 'row-actions' }, h('span', { class: 'grow' }), go), reason);
    }

    // ▸ レシピ（JSON）: read-only; ▸ 編集 → a textarea, [確かめる] lists the problems, [反映] saves (material.put).
    function recipeBlock(e, recipeText) {
      const pre = h('pre', { class: 'mat-json', text: recipeText });
      const area = h('textarea', { class: 'mat-json-edit', rows: '10', spellcheck: false, 'aria-label': t('mat.recipe') });
      area.value = recipeText;
      const out = h('ul', { class: 'mat-problems', role: 'status' });
      const check = () => {
        const r = checkRecipe(e.kind, area.value, (recipe) => deriveProblems(app, e, recipe));
        dom.replace(out, r.bad ? h('li', { text: t('mat.badJson') }) : r.problems.map((p) => h('li', { text: problemText(t, p) })));
        if (!r.bad && !r.problems.length) out.appendChild(h('li', { class: 'muted', text: t('mat.recipeOk') }));
        return r;
      };
      const editBox = h('div', { class: 'mat-json-box', hidden: !editOpen }, area,
        h('div', { class: 'row-actions' },
          h('button', { class: 'btn small', type: 'button', text: t('mat.check'), on: { click: check } }),
          h('button', { class: 'btn small primary', type: 'button', text: t('mat.apply'), on: { click: () => {
            const r = check();
            if (!r.recipe || r.bad || !usable(app, e, r.recipe)) return;
            app.dispatch(putCmd(e, r.recipe), { label: ['undo.material.put', {}] });
          } } })), out);
      const editBtn = h('button', { class: 'link', type: 'button', 'aria-expanded': String(editOpen), text: t('mat.edit'),
        on: { click: () => { editOpen = !editOpen; editBox.hidden = !editOpen; pre.hidden = editOpen; editBtn.setAttribute('aria-expanded', String(editOpen)); } } });
      pre.hidden = editOpen;
      return h('details', { class: 'mat-recipe' }, h('summary', { text: t('mat.recipe') }), editBtn, pre, editBox);
    }

    render();
    const e0 = entry();
    return {
      id: 'mat:' + o.id, crumb: ['mat.crumb', { name: e0 ? nameText(t, e0) : o.id }], el,
      focus() { dom.focus(el.querySelector(remakeOpen ? '.mat-remake-text' : '.mat-thumb-btn') || el.querySelector('button')); },
      refresh: render,
      destroy() { if (stopAnim) stopAnim(); if (gesture) gesture.end(); },
    };
  }

  // The rows of 作品全体 › マイ素材 (§6.9): kind · name · season · 使用 n · おまかせでも使う · ⋯; a click opens the page.
  function listRows(app, open) {
    const t = app.t;
    const list = app.doc.materials && Array.isArray(app.doc.materials.list) ? app.doc.materials.list : [];
    return h('div', { class: 'insp-list mat-list' }, list.map((e) => {
      const key = keyOfId(e.id);
      const uses = usePlaces(app.doc, app.plan, key).length;
      const more = h('button', { class: 'icon-btn small', type: 'button', title: t('fld.more', { field: nameText(t, e) }),
        'aria-label': t('fld.more', { field: nameText(t, e) }), 'aria-haspopup': 'menu',
        on: { click: (ev) => app.menus.open(ev.currentTarget, menuItems(app, key, open)) } }, I.icon('more', { size: 14 }));
      const pool = h('input', { type: 'checkbox', role: 'switch', checked: e.pool === true, title: t('mat.pool'),
        'aria-label': t('mat.pool') + ': ' + nameText(t, e),
        on: { change: (ev) => app.dispatch({ t: 'material.meta', id: e.id, pool: ev.target.checked }, { label: ['undo.material.meta', {}] }) } });
      return h('div', { class: 'mat-row', 'data-mat': e.id },
        h('button', { class: 'insp-item', type: 'button', on: { click: () => open(e.id, {}) } },
          h('span', { class: 'mat-kind muted', text: kindText(t, e) }), h('span', { class: 'grow ell', text: nameText(t, e) }),
          e.season ? h('span', { class: 'muted', text: t('fld.season.' + e.season) }) : null,
          h('span', { class: 'muted', text: t('mat.usedShort', { n: uses }) }), I.icon('next', { size: 14 })),
        pool, more);
    }));
  }

  return {
    keyOfId, idOfKey, entryOf, usesOf, usePlaces, weightOf, duplicateCmd, putCmd, checkRecipe, problemText, usable, kindText, nameText,
    menuItems, remove, duplicate, page, listRows,
  };
});
