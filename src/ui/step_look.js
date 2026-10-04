/* 文字PVメーカー v2 — original work. Step ③ 見た目: mood chips, theme swatches (hover = try-on), screen shape, 詳しく…, AI 3 looks (DESIGN §6.4.3). */
MV.def('ui/step_look', ['ui/dom', 'ui/icons', 'core/doc', 'ui/fields', 'i18n/t', 'planner/areas'], (dom, I, D, F, T, AREAS) => {
  'use strict';

  const { h } = dom;
  const THEMES_SHOWN = 12;
  const TRYON_MS = 250;
  const MAIN_ASPECTS = ['16:9', '9:16', '1:1'];
  // 間奏の演出: per interlude of the song, its effect (自動 or one of the three, pinned at that interlude's cut); its
  // name seeks there.
  const IL_KEYS = ['lightMotes', 'soundHorizon', 'kineticShapes', 'neonWave', 'ringPulse', 'warpField', 'tileRipple', 'burstBloom',
    'harmonicString', 'ridgeLines', 'polarWave', 'peakBars'];

  function mount(app) {
    const t = app.t;
    const moods = h('div', { class: 'chips', role: 'group', 'aria-label': t('kind.mood'), 'data-ctl': 'mood' });
    const themes = h('div', { class: 'swatches', role: 'group', 'aria-label': t('kind.theme'), 'data-ctl': 'theme' });
    const shapes = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': t('look.shape'), 'data-ctl': 'shape' });
    const moreBtn = h('button', { class: 'chip-btn', type: 'button', 'data-act': 'look.details', 'data-ctl': 'more' },
      I.icon('details', { size: 15 }), t('look.more'));
    const aiBtn = h('button', { class: 'chip-btn', type: 'button', 'data-act': 'ai.looks', 'data-ctl': 'ai' },
      I.icon('ai', { size: 15 }), t('look.ai3'));
    const ilList = h('div', { class: 'il-list' });
    let ilRows = [], ilSig = null;
    const root = h('div', { class: 'step step-look' },
      h('div', { class: 'step-head' }, h('h2', { class: 'step-title', text: t('step.short.look') })),
      // DESIGN_2_1 §11.7.1: one more sentence, text only (step ③ keeps its five controls)
      h('p', { class: 'note', text: t('look.hint') + ' ' + t('media.lookHint') }),
      h('div', { class: 'field' }, h('div', { class: 'field-label', text: t('kind.mood') }), moods,
        h('div', { class: 'legend', text: t('look.autoMark') })),
      h('div', { class: 'field' }, h('div', { class: 'field-label', text: t('kind.theme') }), themes),
      h('div', { class: 'field' }, h('div', { class: 'field-label', text: t('look.shape') }), shapes),
      h('div', { class: 'field', 'data-ctl': 'ilwork' }, h('div', { class: 'field-label', text: t('il.title') }), ilList),
      h('div', { class: 'row-actions' }, moreBtn, aiBtn),
      h('p', { class: 'note subtle', text: t('look.rule') }));

    let expanded = false;
    let tryTimer = 0;

    dom.on(root, 'click', '.row-actions [data-act]', (ev, b) => app.actions.run(b.dataset.act, { from: 'look' }));

    function pinToggle(slot, key) {
      const path = 'work:' + slot;
      const pinned = app.doc.pins[path];
      if (pinned && pinned.v === key) app.dispatch({ t: 'pin.clear', path }, { label: ['undo.unpinWork', { field: t('kind.' + slot) }] });
      else app.dispatch({ t: 'pin.set', path, v: key, by: 'user' }, { label: ['undo.pinWork', { field: t('kind.' + slot) }] });
    }

    dom.on(moods, 'click', '[data-key]', (ev, b) => pinToggle('mood', b.dataset.key));
    dom.on(themes, 'click', '[data-key]', (ev, b) => { stopTry(); pinToggle('theme', b.dataset.key); });
    dom.on(themes, 'click', '[data-more]', () => { expanded = !expanded; renderThemes(); });

    // Hover / focus on a swatch = try-on of that theme in the main preview (no commit).
    function startTry(key) {
      clearTimeout(tryTimer);
      tryTimer = setTimeout(() => {
        const doc = app.reduce(app.doc, { t: 'pin.set', path: 'work:theme', v: key, by: 'user' });
        app.tryOn(doc, t('look.tryOn', { name: app.label('theme', key) }));
      }, TRYON_MS);
    }
    function stopTry() {
      clearTimeout(tryTimer);
      app.tryOn(null);
    }
    dom.on(themes, 'pointerover', '[data-key]', (ev, b) => startTry(b.dataset.key));
    dom.on(themes, 'focusin', '[data-key]', (ev, b) => startTry(b.dataset.key));
    themes.addEventListener('pointerleave', stopTry);
    themes.addEventListener('focusout', (ev) => { if (!themes.contains(ev.relatedTarget)) stopTry(); });

    dom.on(shapes, 'click', '[data-aspect]', (ev, b) => setAspect(b.dataset.aspect));
    function setAspect(aspect) {
      app.dispatch({ t: 'look.set', key: 'aspect', v: aspect }, { label: ['undo.aspect', {}] });
    }

    function current(slot) {
      const pin = app.doc.pins['work:' + slot];
      const plan = app.plan;
      const dec = plan && plan.look ? plan.look[slot] : null;
      return { pinned: pin ? pin.v : null, auto: !pin && dec ? dec.v : null };
    }

    function renderMoods() {
      const { pinned, auto } = current('mood');
      dom.replace(moods, app.reg.all('mood').map((def) => h('button', {
        class: ['chip', def.key === pinned ? 'is-pinned' : '', def.key === auto ? 'is-auto' : ''], type: 'button',
        'data-key': def.key, 'aria-pressed': String(def.key === pinned),
        title: def.key === pinned ? t('look.unpinTip') : t('look.pinTip'),
      }, def.key === pinned ? I.icon('pin', { size: 13 }) : null, app.label('mood', def.key), def.key === auto ? h('span', { class: 'auto-mark', text: t('look.autoStar') }) : null)));
    }

    function renderThemes() {
      const { pinned, auto } = current('theme');
      const all = app.reg.all('theme');
      const shown = expanded ? all : all.slice(0, THEMES_SHOWN);
      const now = all.find((def) => def.key === (pinned || auto));
      if (now && !shown.includes(now)) shown[shown.length - 1] = now;   // the current theme is always visible
      const tiles = shown.map((def) => {
        const sw = def.swatch || {};
        return h('button', {
          class: ['swatch', def.key === pinned ? 'is-pinned' : '', def.key === auto ? 'is-auto' : ''], type: 'button',
          'data-key': def.key, 'aria-pressed': String(def.key === pinned), 'aria-label': app.label('theme', def.key),
          title: app.label('theme', def.key), style: { background: sw.ground || '#333', color: sw.ink || '#eee' },
        }, h('span', { class: 'sw-glyph', text: t('look.swatchGlyph') }),
        h('span', { class: 'sw-accent', style: { background: sw.accent || '#e2553b' } }),
        h('span', { class: 'sw-accent2', style: { background: sw.shiftA || '#3e6e8c' } }),
        def.key === pinned ? h('span', { class: 'sw-pin' }, I.icon('pin', { size: 12 })) : null,
        def.key === auto ? h('span', { class: 'sw-auto', text: t('look.autoStar') }) : null);
      });
      if (all.length > THEMES_SHOWN) {
        tiles.push(h('button', { class: 'swatch more', type: 'button', 'data-more': '1', 'aria-expanded': String(expanded) },
          expanded ? t('look.fewer') : t('look.moreThemes', { n: all.length - THEMES_SHOWN })));
      }
      dom.replace(themes, tiles);
    }

    function renderShapes() {
      const aspect = app.doc.look.aspect;
      const main = MAIN_ASPECTS.map((a) => h('button', {
        class: 'seg', type: 'button', role: 'radio', 'aria-checked': String(a === aspect), 'data-aspect': a,
      }, h('span', { class: 'aspect-icon aspect-' + a.replace(':', 'x') }), a));
      const others = D.ASPECTS.filter((a) => !MAIN_ASPECTS.includes(a));
      const select = h('select', { class: 'seg-select', 'aria-label': t('look.otherShapesLabel') },
        h('option', { value: '', text: others.includes(aspect) ? aspect : t('look.otherShapes') }),
        others.map((a) => h('option', { value: a, text: a, selected: a === aspect })));
      select.classList.toggle('is-on', others.includes(aspect));
      select.addEventListener('change', () => { if (select.value) setAspect(select.value); });
      dom.replace(shapes, main, select);
    }

    // --- 間奏の動き ---
    const fmt = (x) => T.fmtTime(x).replace(/\.\d+$/, '');

    const ilName = (info) => (info.of > 1 ? t('il.namePart', { n: info.n, k: info.k }) : t('il.name', { n: info.n }));

    function ilRow(key, info) {
      const name = ilName(info);
      const head = h('button', { class: 'link il-name', type: 'button' });
      head.addEventListener('click', () => { const c = app.plan && app.plan.cuts.find((x) => x.key === key); if (c) app.seek(c.t0); });
      // the effect of this interlude: 自動 or one of the three, pinned at its cut (a tap on the pinned one unpins it)
      const fx = h('div', { class: 'chips il-fx', role: 'group', 'aria-label': name },
        IL_KEYS.map((k) => h('button', { class: 'chip', type: 'button', 'data-key': k, text: app.label('arrange', k) })));
      dom.on(fx, 'click', '[data-key]', (ev, b) => {
        const path = 'cut/' + key + ':arrange', at = F.writePath(path, app.plan), pin = app.doc.pins[at];
        const label = ['undo.pin', { field: t('kind.arrange'), scope: name }];
        if (pin && pin.v === b.dataset.key) app.dispatch({ t: 'pin.clear', path: at }, { label });
        else app.dispatch(F.pinCmd(path, b.dataset.key, app.plan, app.svc.pinSig), { label });
      });
      return { key, info, head, fx, el: h('div', { class: 'il-row', 'data-cut': key }, head, fx) };
    }

    function renderInterludes() {
      const plan = app.plan;
      const cuts = plan && Array.isArray(plan.cuts) ? plan.cuts.filter((c) => c.role === 'interlude') : [];
      const sig = cuts.map((c) => c.key).join('|');
      if (sig !== ilSig) {
        ilSig = sig;
        const names = AREAS.interludes(plan);
        ilRows = cuts.map((c) => ilRow(c.key, names.get(c.key)));
        dom.replace(ilList, ilRows.length ? ilRows.map((r) => r.el) : [h('p', { class: 'note subtle', text: t('il.none') })]);
      }
      ilRows.forEach((r, i) => {
        const c = cuts[i];
        r.head.textContent = ilName(r.info) + '　' + fmt(c.t0) + '–' + fmt(c.t1);
        const pin = app.doc.pins[F.writePath('cut/' + r.key + ':arrange', plan)];
        const now = c.slots && c.slots.arrange ? c.slots.arrange.v : null;
        for (const b of r.fx.children) {
          const pinned = !!pin && pin.v === b.dataset.key, on = b.dataset.key === now;
          b.classList.toggle('is-pinned', pinned);
          b.classList.toggle('is-auto', on && !pinned);
          b.setAttribute('aria-pressed', String(pinned));
          b.textContent = app.label('arrange', b.dataset.key) + (on && !pinned ? ' ' + t('look.autoStar') : '');
        }
      });
    }

    function update() {
      renderMoods();
      renderThemes();
      renderShapes();
      renderInterludes();
      aiBtn.hidden = !app.view.state.prefs.ai;
    }

    app.view.on((changed) => { if (changed.includes('prefs')) update(); });
    update();
    return { root, update: () => update(), onShow: update };
  }

  return { mount };
});
