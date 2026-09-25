/* 文字PVメーカー v2 — original work. 区画ごとに指示: the board sub-page of the AI tab, one instruction per area, sent together (DESIGN_2_1 §6.3). */
MV.def('ui/ai_board', ['ui/dom', 'ui/icons', 'planner/areas', 'ui/fields', 'ui/ai_controller', 'i18n/t'], (dom, I, AREAS, F, AC, T) => {
  'use strict';

  const { h } = dom;
  const SAVE_MS = 400;                  // drafts go to side.asks this long after the last keystroke (and on blur)

  // --- pure (Node-tested) ------------------------------------------------------------------------------------------

  // rowsOf(doc, plan, asks, added) → the board's rows: the song sections (else the headings, else the blocks), then
  // the areas the user added and the areas that still have a draft, each once and only while it exists.
  //   → [{ key, ref, area }]
  function rowsOf(doc, plan, asks, added) {
    if (!plan) return [];
    const all = AREAS.areasOf(doc, plan);
    const base = all.song.length ? all.song : all.heads.length ? all.heads : all.paras;
    const out = base.map((area) => ({ key: area.key, ref: area.ref, area }));
    const seen = new Set(out.map((r) => r.key));
    const extra = (added || []).concat(Object.keys(asks || {}).sort());
    for (const key of extra) {
      if (seen.has(key)) continue;
      const ref = AC.refOfKey(key);
      const area = ref ? AREAS.resolve(doc, plan, ref) : null;
      if (!area) continue;
      seen.add(key);
      out.push({ key, ref, area });
    }
    return out;
  }

  // The row's state: 反映済み when its area was in the last applied review, else 未送信.
  const STATES = Object.freeze(['new', 'done']);   // ai.board.state.*
  function stateOf(key, applied) { return (applied || []).includes(key) ? 'done' : 'new'; }

  // The line numbers an area covers: 「12–16行」.
  function linesText(t, plan, area) {
    const nums = area.lineIds.map((id) => { const l = plan.lines.find((x) => x.id === id); return l ? l.index + 1 : 0; }).filter(Boolean);
    if (!nums.length) return t('count.lines', { n: 0 });
    const a = Math.min(...nums), b = Math.max(...nums);
    return a === b ? t('area.linesOne', { a }) : t('area.lines', { a, b });
  }

  // --- the page ------------------------------------------------------------------------------------------------------

  // mount(app, ctl, { onBack }) → { el, update(), focus(), destroy() }: the board replaces the tools while it is open.
  function mount(app, ctl, o) {
    const t = app.t;
    const back = h('button', { class: 'btn small', type: 'button', 'data-fkey': 'board-back' }, I.icon('prev', { size: 14 }), t('sub.back'));
    const title = h('h3', { class: 'ai-h', tabindex: '-1', text: t('ai.board.title') });
    const list = h('div', { class: 'ai-board-rows' });
    const addSel = h('button', { class: 'chip-btn', type: 'button', text: t('ai.board.addSel') });
    const allow = h('input', { type: 'checkbox' });
    const send = h('button', { class: 'btn small primary', type: 'button', text: t('ai.board.send') });
    const why = h('p', { class: 'ai-reason', role: 'status', hidden: true });
    const empty = h('p', { class: 'note subtle', text: t('ai.board.empty') });
    const el = h('section', { class: 'ai-sec ai-board', 'aria-label': t('ai.board.title') },
      h('div', { class: 'sub-head' }, back, title), list, empty,
      h('div', { class: 'row-actions ai-board-foot' }, addSel,
        h('label', { class: 'check-row' }, allow, h('span', { text: t('ai.direct.allowMaterials') }))),
      h('div', { class: 'ai-edit-row' }, why, h('span', { class: 'grow' }), send));
    const added = [];
    const timers = new Map();
    let rows = [];

    back.addEventListener('click', () => o.onBack());

    const asks = () => (app.store.side && app.store.side.asks) || {};
    function save(key, text) {
      clearTimeout(timers.get(key));
      timers.delete(key);
      app.store.setSide((side) => AC.withAsk(side, key, text, app.store.rev));
    }

    addSel.addEventListener('click', () => {
      const ids = AC.selectedLines(app.view.state.sel, app.plan);
      if (!ids.length) return;
      const k = AREAS.keyOf(AREAS.ofLines(app.doc, app.plan, ids));
      if (!added.includes(k)) added.push(k);
      update();
      const input = list.querySelector('[data-key="' + CSS.escape(k) + '"] input');
      if (input) dom.focus(input);
    });

    send.addEventListener('click', () => {
      flush();
      const b = AC.boardBriefs(rows, asks());
      if (!b.briefs.length || b.over) return;
      // the library's pictures on this device may be placed, as in the instruction block, and only while its
      // 写真・動画をAIが使ってよい switch is on (DESIGN_2_1 §11.6.1)
      const allowed = typeof o.allowMedia === 'function' && o.allowMedia();
      const here = !allowed ? [] : (app.doc.media && app.doc.media.list ? app.doc.media.list : []).filter((e) => !app.media || app.media.state(e.id) !== 'missing');
      ctl.run('direct', { briefs: b.briefs, mode: 'all', allowMaterials: allow.checked, media: here.length ? here.map((e) => e.id) : false });
    });

    function flush() {
      for (const input of list.querySelectorAll('.ai-board-input[data-key]')) {
        if (timers.has(input.dataset.key)) save(input.dataset.key, input.value);
      }
    }

    function hover(area) { app.view.set({ highlight: area ? area.lineIds.slice() : null }); }

    // The draft box as tall as its text.
    function fit(input) {
      dom.setStyle(input, { height: 'auto' });
      dom.setStyle(input, { height: input.scrollHeight + 2 });
    }

    function rowEl(r) {
      const st = stateOf(r.key, ctl.state.applied);
      const label = F.areaLabel(t, r.area);
      const head = [label, linesText(t, app.plan, r.area)].join(' · ');
      const draft = asks()[r.key];
      // One line of text (Enter never adds a line break) that wraps and grows, so a draft of up to 120 characters shows whole.
      const input = h('textarea', { class: 'text-input ai-board-input', rows: '1', maxlength: String(AC.ASK_MAX), spellcheck: false,
        'data-key': r.key, 'data-fkey': 'ask:' + r.key, 'aria-label': t('ai.board.rowLabel', { area: head }) });
      input.value = draft ? draft.text : '';
      input.addEventListener('input', () => {
        if (/[\r\n]/.test(input.value)) input.value = input.value.replace(/[\r\n]+/g, ' ');
        fit(input);
        clearTimeout(timers.get(r.key));
        timers.set(r.key, setTimeout(() => save(r.key, input.value), SAVE_MS));
        updateFoot();
      });
      input.addEventListener('change', () => save(r.key, input.value));
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); save(r.key, input.value); }
      });
      const box = h('fieldset', { class: ['ai-board-row', st === 'done' ? 'is-done' : null], 'data-key': r.key },
        h('legend', { class: 'ai-board-head' }, h('span', { class: 'grow ell', text: head }),
          h('span', { class: ['state-tag', 'ai-board-state'], 'data-state': st, text: t('ai.board.state.' + st) })), input);
      box.addEventListener('pointerenter', () => hover(r.area));
      box.addEventListener('pointerleave', () => hover(null));
      box.addEventListener('focusin', () => hover(r.area));
      box.addEventListener('focusout', (ev) => { if (!box.contains(ev.relatedTarget)) hover(null); });
      return box;
    }

    // The count of drafts, what is typed but not saved yet included.
    function pending() {
      const now = Object.assign({}, asks());
      for (const input of list.querySelectorAll('.ai-board-input[data-key]')) {
        if (input.value.trim()) now[input.dataset.key] = { text: input.value, at: 0 }; else delete now[input.dataset.key];
      }
      return AC.boardBriefs(rows, now);
    }

    function updateFoot() {
      const b = pending();
      const blocked = ctl.blocked('direct');
      const reason = b.over ? 'ai.board.max' : blocked;
      why.hidden = !reason;
      why.textContent = reason ? t(reason) : '';
      send.disabled = !!reason || !b.briefs.length;
      addSel.disabled = !AC.selectedLines(app.view.state.sel, app.plan).length;
    }

    // Rebuilt only when the rows or their states change: typing (a draft saved to side.asks) keeps the inputs.
    let built = '';
    function update() {
      rows = rowsOf(app.doc, app.plan, asks(), added);
      const sig = rows.map((r) => r.key + ':' + r.area.lineIds.join(',') + ':' + stateOf(r.key, ctl.state.applied)).join('|');
      if (sig === built) { updateFoot(); return; }
      built = sig;
      const active = document.activeElement;
      const fkey = active && list.contains(active) ? active.dataset.fkey : null;
      const typed = new Map([...list.querySelectorAll('.ai-board-input[data-key]')].filter((x) => timers.has(x.dataset.key))
        .map((x) => [x.dataset.key, x.value]));
      dom.replace(list, rows.map(rowEl));
      for (const [key, value] of typed) {
        const input = list.querySelector('.ai-board-input[data-key="' + CSS.escape(key) + '"]');
        if (input) input.value = value;
      }
      // Heights once the rows are in the page (scrollHeight is 0 while detached).
      requestAnimationFrame(() => { for (const input of list.querySelectorAll('.ai-board-input')) fit(input); });
      empty.hidden = rows.length > 0;
      if (fkey) {
        const again = list.querySelector('[data-fkey="' + CSS.escape(fkey) + '"]');
        if (again) dom.focus(again);
      }
      updateFoot();
    }

    // A narrower or wider panel wraps the drafts differently: their heights follow.
    let lastWidth = 0;
    const sizer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (list.clientWidth === lastWidth) return;
      lastWidth = list.clientWidth;
      for (const input of list.querySelectorAll('.ai-board-input')) fit(input);
    }) : null;
    if (sizer) sizer.observe(list);

    return {
      el, update,
      focus() {
        for (const input of list.querySelectorAll('.ai-board-input')) fit(input);
        dom.focus(list.querySelector('.ai-board-input') || title);
      },
      destroy() { flush(); hover(null); if (sizer) sizer.disconnect(); },
    };
  }

  return { rowsOf, stateOf, linesText, mount, STATES };
});
