/* 文字PVメーカー v2 — original work. Inspector widgets: part, choice, number, time, color, font, toggle, words, cutpoints, text, slots (DESIGN §6.4.4). */
MV.def('ui/widgets', ['ui/dom', 'ui/icons', 'i18n/t', 'core/color', 'ui/playbar'], (dom, I, T, C, PB) => {
  'use strict';

  const { h } = dom;
  const AUTO = '\u0000auto';                       // the 自動 choice (unpin); never a real value
  const SEGMENTS_MAX = 4;

  // Every widget is make(field, env) → { el, update(state), focus(), scrub? }.
  //   env: { app, t, lang, commit(v, { merge }), gesture() → { set(v), end() }, unpin(), open(), thumb(canvas, key),
  //          slot(action, i), label }
  //   state: { value, mixed, auto, readOnly, extra }  (extra: widget data the inspector computes, e.g. the palette)

  function optionText(t, o) {
    if (o.text !== undefined) return o.text;
    if (o.labelArgs) {
      const args = {};
      for (const k of Object.keys(o.labelArgs)) args[k] = t.has(o.labelArgs[k]) ? t(o.labelArgs[k]) : o.labelArgs[k];
      return t(o.label, args);
    }
    if (t.has(o.label)) return t(o.label);
    // A value without its string (a part parameter the table does not cover yet) shows the value itself; dev builds
    // say so, since user-facing text must come from the string table (DESIGN §0, §4.24).
    if (MV.DEV && typeof console !== 'undefined') console.warn('ui/widgets: no string ' + o.label);
    return o.fallback !== undefined ? o.fallback : String(o.v);
  }

  function same(a, b) { return a === b || JSON.stringify(a) === JSON.stringify(b); }

  function round(v, step) {
    if (!(step > 0)) return Math.round(v * 1000) / 1000;
    const digits = Math.max(0, Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)));
    return Number(v.toFixed(digits));
  }

  function unitText(t, unit) { return unit && t.has('unit.' + unit) ? t('unit.' + unit) : ''; }

  // Keys a focused control handles itself; the app keymap (§6.8: ← → frames, ↑ ↓ lines) must not take them.
  const OWN_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
  function ownsKey(ev) { return OWN_KEYS.has(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey; }

  // The number a field box shows: empty when there is no value (never a stand-in such as the spec minimum).
  function numberText(v, scale, step) { return typeof v === 'number' && Number.isFinite(v) ? String(round(v * scale, step)) : ''; }

  // --- part ------------------------------------------------------------------------------------------------------

  function part(field, env) {
    const t = env.t;
    const canvas = h('canvas', { class: 'w-thumb', width: 128, height: 72, 'aria-hidden': 'true' });
    const name = h('span', { class: 'w-part-name' });
    const btn = h('button', { class: 'w-part', type: 'button', 'aria-haspopup': 'true', 'aria-label': env.label },
      canvas, name, I.icon('next', { size: 16 }));
    btn.addEventListener('click', () => env.open());
    let shown = null;
    return {
      el: btn,
      focus: () => dom.focus(btn),
      update(st) {
        const v = st.value;
        const text = st.mixed ? t('state.mixed') : v === 'none' || v === null || v === undefined ? t('fld.none')
          : env.app.label(field.partKind || field.kind, v);
        name.textContent = text;
        btn.setAttribute('aria-label', env.label + ': ' + text);
        btn.disabled = !!st.readOnly;
        const key = st.mixed ? null : v;
        if (key !== shown) { shown = key; env.thumb(canvas, key); }
      },
    };
  }

  // --- choice (segmented ≤ 4 options, else a select) ---------------------------------------------------------------

  function choice(field, env) {
    const t = env.t;
    const options = (field.auto ? [{ v: AUTO, label: 'state.auto' }] : []).concat(field.options || []);
    const segmented = options.length <= SEGMENTS_MAX && !field.select;
    let current = null;
    const pick = (o) => (o.v === AUTO ? env.unpin() : env.commit(o.v));
    if (segmented) {
      const buttons = options.map((o) => h('button', { class: 'seg', type: 'button', role: 'radio', 'aria-checked': 'false',
        tabindex: '-1', on: { click: () => pick(o) } }, optionText(t, o)));
      const el = h('div', { class: 'segmented w-seg', role: 'radiogroup', 'aria-label': env.label }, buttons);
      // Radio-group keys (§6.12): arrows move to the next option and choose it; one tab stop for the group.
      el.addEventListener('keydown', (ev) => {
        if (!ownsKey(ev) || ev.key === 'PageUp' || ev.key === 'PageDown') return;
        ev.preventDefault();
        ev.stopPropagation();
        const at = buttons.indexOf(document.activeElement);
        const n = buttons.length;
        const to = ev.key === 'Home' ? 0 : ev.key === 'End' ? n - 1
          : (Math.max(0, at) + (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : n - 1)) % n;
        if (buttons[to].disabled || to === at) return;
        dom.focus(buttons[to]);
        pick(options[to]);
      });
      return {
        el, focus: () => dom.focus(buttons.find((b) => b.getAttribute('aria-checked') === 'true') || buttons[0]),
        update(st) {
          current = st.auto && field.auto ? AUTO : st.mixed ? null : st.value;
          let stop = -1;
          options.forEach((o, i) => {
            const on = !st.mixed && same(o.v, current);
            buttons[i].setAttribute('aria-checked', String(on));
            buttons[i].disabled = !!st.readOnly;
            if (on) stop = i;
          });
          buttons.forEach((b, i) => { b.tabIndex = i === Math.max(0, stop) ? 0 : -1; });
        },
      };
    }
    const mixedOpt = h('option', { value: 'mixed', text: t('state.mixed'), disabled: true });
    const sel = h('select', { class: 'select w-select', 'aria-label': env.label }, mixedOpt,
      options.map((o, i) => h('option', { value: String(i), text: optionText(t, o) })));
    sel.addEventListener('change', () => { const o = options[Number(sel.value)]; if (o) pick(o); });
    return {
      el: sel, focus: () => dom.focus(sel),
      update(st) {
        current = st.auto && field.auto ? AUTO : st.value;
        const at = st.mixed ? -1 : options.findIndex((o) => same(o.v, current));
        mixedOpt.hidden = at >= 0;
        if (document.activeElement !== sel) sel.value = at >= 0 ? String(at) : 'mixed';
        sel.disabled = !!st.readOnly;
      },
    };
  }

  // --- number (slider + field + unit; the label scrubs) ----------------------------------------------------------------

  function number(field, env) {
    const spec = field.spec || {};
    if (spec.type === 'nudge') return nudge(field, env);
    const t = env.t;
    const scale = field.scale || 1;
    const min = typeof spec.min === 'number' ? spec.min : 0;
    const max = typeof spec.max === 'number' ? spec.max : 1;
    const step = spec.step > 0 ? spec.step : spec.type === 'int' ? 1 : (max - min) / 200;
    const shownStep = scale !== 1 ? Math.max(step * scale, 1) : step;
    const range = h('input', { class: 'w-range', type: 'range', min: String(min * scale), max: String(max * scale),
      step: String(step * scale), 'aria-label': env.label });
    const box = h('input', { class: 'num-input w-num', type: 'text', inputmode: 'decimal', spellcheck: false, 'aria-label': env.label });
    const ghost = h('span', { class: 'w-ghost', hidden: true, 'aria-hidden': 'true' });
    const unit = unitText(t, spec.unit);
    const el = h('div', { class: 'w-number' }, h('div', { class: 'w-track' }, range, ghost), box,
      unit ? h('span', { class: 'unit', text: unit }) : null);
    let value = null;                                 // null: no value to show (e.g. no tempo)
    let g = null;
    const clampV = (v) => Math.max(min, Math.min(max, v));
    const show = (v) => { box.value = numberText(v, scale, shownStep); };

    // The slider takes its own arrow keys; each key's input event commits, merged per field (store typing window).
    range.addEventListener('keydown', (ev) => { if (ownsKey(ev)) ev.stopPropagation(); });
    range.addEventListener('pointerdown', () => { if (!g) g = env.gesture(); });
    range.addEventListener('input', () => {
      value = clampV(Number(range.value) / scale);
      show(value);
      if (g) g.set(value); else env.commit(value, { merge: true });
    });
    const endDrag = () => { if (g) { g.end(); g = null; } };
    range.addEventListener('change', endDrag);
    range.addEventListener('pointerup', endDrag);
    range.addEventListener('pointercancel', endDrag);
    box.addEventListener('change', () => {
      const v = Number(String(box.value).replace(',', '.').replace('％', '').replace('%', ''));
      if (Number.isFinite(v)) env.commit(clampV(v / scale));
      else show(value);
    });
    box.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { box.blur(); ev.preventDefault(); }
    });
    return {
      el, focus: () => dom.focus(range),
      // Label scrubbing (§6.4.4): px → value steps; one gesture per drag.
      scrub: { get: () => (value === null ? min : value), step: step, min, max,
        preview(v) { value = clampV(v); range.value = String(value * scale); show(value); } },
      update(st) {
        value = typeof st.value === 'number' && Number.isFinite(st.value) ? st.value : null;
        // Without a value the slider rests at its start, drawn as unset, and the box is empty with 自動 / いろいろ.
        if (!g) range.value = String((value === null ? min : value) * scale);
        el.classList.toggle('is-unset', value === null || !!st.mixed);
        if (document.activeElement !== box) { if (st.mixed) box.value = ''; else show(value); }
        box.placeholder = st.mixed ? t('state.mixed') : value === null ? (st.auto ? t('state.auto') : '—') : '';
        range.disabled = box.disabled = !!st.readOnly;
        const gv = st.extra && typeof st.extra.ghost === 'number' ? st.extra.ghost : null;
        ghost.hidden = gv === null;
        if (gv !== null) dom.setStyle(ghost, { left: ((gv - min) / Math.max(1e-9, max - min) * 100) + '%' });
      },
    };
  }

  // 位置・回転・拡大 (el.*.nudge): four small numbers, one pin value { dx, dy, rot, s }.
  const NUDGE = [['dx', 'w.nudge.x', 1], ['dy', 'w.nudge.y', 1], ['rot', 'w.nudge.rot', 0.5], ['s', 'w.nudge.s', 0.01]];

  function nudge(field, env) {
    const t = env.t;
    let value = { dx: 0, dy: 0, rot: 0, s: 1 };
    const boxes = NUDGE.map(([k, label]) => h('input', { class: 'num-input w-nudge-num', type: 'text', inputmode: 'decimal',
      spellcheck: false, 'aria-label': env.label + ' ' + t(label), 'data-k': k }));
    const el = h('div', { class: 'w-nudge' }, NUDGE.map(([k, label], i) => h('label', { class: 'w-nudge-cell' },
      h('span', { class: 'w-nudge-key', text: t(label) }), boxes[i])),
    h('button', { class: 'icon-btn small', type: 'button', title: t('w.nudge.reset'), 'aria-label': t('w.nudge.reset'),
      on: { click: () => env.unpin() } }, I.icon('close', { size: 14 })));
    boxes.forEach((box, i) => {
      box.addEventListener('change', () => {
        const v = Number(String(box.value).replace(',', '.'));
        if (!Number.isFinite(v)) { box.value = String(value[NUDGE[i][0]]); return; }
        const next = Object.assign({}, value, { [NUDGE[i][0]]: NUDGE[i][0] === 's' ? Math.max(0.2, Math.min(4, v)) : v });
        env.commit(next);
      });
      box.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { box.blur(); ev.preventDefault(); } });
    });
    return {
      el, focus: () => dom.focus(boxes[0]),
      update(st) {
        value = Object.assign({ dx: 0, dy: 0, rot: 0, s: 1 }, st.value && typeof st.value === 'object' ? st.value : {});
        boxes.forEach((box, i) => {
          if (document.activeElement !== box) box.value = st.mixed ? '' : String(round(value[NUDGE[i][0]], NUDGE[i][2]));
          box.placeholder = st.mixed ? '—' : '';
          box.disabled = !!st.readOnly;
        });
      },
    };
  }

  // --- time (m:ss.cc, ±1 frame, [今]) ---------------------------------------------------------------------------------

  function time(field, env) {
    const t = env.t;
    if (field.readOnly) {
      const out = h('output', { class: 'w-time-ro' });
      return { el: out, focus() {}, update(st) { out.textContent = st.mixed ? t('state.mixed') : T.fmtTime(st.value || 0); } };
    }
    const box = h('input', { class: 'num-input w-time', type: 'text', spellcheck: false, 'aria-label': env.label });
    const frame = () => 1 / (env.app.doc.output.fps || 30);
    let value = 0;
    const btn = (text, label, run) => h('button', { class: 'btn small w-time-btn', type: 'button', 'aria-label': label, title: label,
      on: { click: run } }, text);
    const el = h('div', { class: 'w-timebox' }, box,
      btn('−', t('w.time.minus'), () => env.commit(Math.max(0, value - frame()))),
      btn('+', t('w.time.plus'), () => env.commit(value + frame())),
      btn(t('w.time.now'), t('w.time.nowTip'), () => env.commit(Math.round(env.app.time() * 1000) / 1000)));
    box.addEventListener('change', () => {
      const v = PB.parseTime(box.value);
      if (v === null) box.value = T.fmtTime(value); else env.commit(v);
    });
    box.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { box.blur(); ev.preventDefault(); } });
    return {
      el, focus: () => dom.focus(box),
      update(st) {
        value = typeof st.value === 'number' ? st.value : 0;
        if (document.activeElement !== box) box.value = st.mixed ? '' : T.fmtTime(value);
        box.placeholder = st.mixed ? t('state.mixed') : '';
        for (const x of el.querySelectorAll('input, button')) x.disabled = !!st.readOnly;
      },
    };
  }

  // --- color (theme swatches + native picker + hex + contrast; inline expansion) -------------------------------------

  // colorView(value, path, palette) → what a color row shows. A hex or a palette token resolves to its hex. No value
  // means the owner keeps its own inks (el.<owner>.fill unpinned, §3.4.3): the row says 自動 with the palette colors
  // that stand for it (the text element: text + accent) and has no hex and no contrast; the picker then starts at the
  // accent. It never shows a stand-in such as black.
  //   → { hex: '#RRGGBB' | null, token: palette token | null, chips: ['#RRGGBB', …], auto: bool, autoKey, pickAt }
  function colorView(value, path, palette) {
    const pal = palette || {};
    const hexOf = (x) => (C.isHex(x) ? x.toUpperCase() : null);
    const pickAt = hexOf(pal.accent) || hexOf(pal.ink) || '#FFFFFF';
    if (C.isHex(value)) return { hex: value.toUpperCase(), token: null, chips: [value.toUpperCase()], auto: false, autoKey: null, pickAt: value.toUpperCase() };
    if (typeof value === 'string' && C.TOKENS.includes(value) && hexOf(pal[value])) {
      const hex = hexOf(pal[value]);
      return { hex, token: value, chips: [hex], auto: false, autoKey: null, pickAt: hex };
    }
    const text = path === 'el.text.fill';
    const chips = (text ? [pal.ink, pal.accent] : []).map(hexOf).filter(Boolean);
    return { hex: null, token: null, chips, auto: true, autoKey: text ? 'w.color.autoText' : 'state.auto', pickAt };
  }

  function color(field, env) {
    const t = env.t;
    const tokens = field.spec && field.spec.type === 'ink';
    const chip = h('span', { class: 'w-chip', 'aria-hidden': 'true' });
    const name = h('span', { class: 'w-color-name' });
    const toggle = h('button', { class: 'w-color', type: 'button', 'aria-expanded': 'false' }, chip, name, I.icon('next', { size: 14 }));
    const swatches = h('div', { class: 'w-swatches', role: 'group', 'aria-label': t('w.color.theme') });
    const picker = h('input', { class: 'w-picker', type: 'color', 'aria-label': t('w.color.pick') });
    const hex = h('input', { class: 'num-input w-hex', type: 'text', spellcheck: false, maxlength: 7, 'aria-label': t('w.color.hex') });
    const contrast = h('span', { class: 'w-contrast', role: 'status' });
    const panel = h('div', { class: 'w-color-panel', hidden: true }, swatches, h('div', { class: 'w-color-row' }, picker, hex, contrast));
    const el = h('div', { class: 'w-colorbox' }, toggle, panel);
    let st0 = { value: null, extra: {} };
    let g = null;

    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
    });
    picker.addEventListener('input', () => {
      if (!g) g = env.gesture();
      g.set(picker.value.toUpperCase());
    });
    picker.addEventListener('change', () => { if (g) { g.end(); g = null; } });
    hex.addEventListener('change', () => {
      const v = hex.value.trim().replace(/^([0-9a-f]{6})$/i, '#$1');
      if (C.isHex(v)) env.commit(v.toUpperCase()); else hex.value = view().hex || '';
    });
    hex.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { hex.blur(); ev.preventDefault(); } });

    function palette() { return (st0.extra && st0.extra.palette) || {}; }
    function view() { return colorView(st0.value, field.path, palette()); }
    function renderSwatches() {
      const pal = palette();
      dom.replace(swatches, C.TOKENS.filter((k) => pal[k]).map((k) => h('button', {
        class: ['w-sw', st0.value === k || (!tokens && st0.value === pal[k]) ? 'is-on' : ''], type: 'button',
        title: t('fld.color.' + k), 'aria-label': t('fld.color.' + k), style: { background: pal[k] },
        on: { click: () => env.commit(tokens ? k : pal[k]) },
      })));
    }
    return {
      el, focus: () => dom.focus(toggle),
      update(st) {
        st0 = st;
        const v = view();
        const hexV = v.hex;
        const [c0, c1] = v.chips;
        // One color fills the chip; the two colors of an automatic text fill split it diagonally.
        dom.setStyle(chip, { background: st.mixed || !c0 ? 'transparent' : c1 ? 'linear-gradient(135deg, ' + c0 + ' 50%, ' + c1 + ' 50%)' : c0 });
        el.classList.toggle('is-auto', !st.mixed && v.auto);
        name.textContent = st.mixed ? t('state.mixed') : v.auto ? t(v.autoKey) : v.token ? t('fld.color.' + v.token) + ' ' + hexV : hexV;
        toggle.setAttribute('aria-label', env.label + ': ' + name.textContent);
        if (!g) picker.value = (hexV || v.pickAt).toLowerCase();
        if (document.activeElement !== hex) hex.value = hexV || '';
        const ground = palette().ground;
        if (hexV && ground && C.isHex(ground) && field.path !== 'color.ground') {
          const x = C.contrast(hexV, ground);
          contrast.textContent = t('w.color.contrast', { x: x.toFixed(1) });
          contrast.classList.toggle('is-low', x < 3);
        } else {
          contrast.textContent = '';
          contrast.classList.remove('is-low');
        }
        renderSwatches();
        toggle.disabled = !!st.readOnly;
      },
    };
  }

  // --- font (families in their own face, with the selected line's text) --------------------------------------------

  function font(field, env) {
    const t = env.t;
    const name = h('span', { class: 'w-font-name' });
    const toggle = h('button', { class: 'w-font', type: 'button', 'aria-expanded': 'false' }, name, I.icon('next', { size: 14 }));
    const list = h('div', { class: 'w-font-list', role: 'listbox', 'aria-label': env.label, hidden: true });
    const free = h('input', { class: 'text-input w-font-free', type: 'text', spellcheck: false, 'aria-label': t('w.font.free'),
      placeholder: t('w.font.free') });
    const panel = h('div', { class: 'w-font-panel', hidden: true }, list, free);
    const el = h('div', { class: 'w-fontbox' }, toggle, panel);
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      list.hidden = panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
    });
    free.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && free.value.trim()) { env.commit(free.value.trim()); free.value = ''; ev.preventDefault(); }
    });
    return {
      el, focus: () => dom.focus(toggle),
      update(st) {
        const fam = st.mixed ? t('state.mixed') : st.value || t('fld.none');
        name.textContent = fam;
        dom.setStyle(name, { fontFamily: st.value ? '"' + st.value + '", var(--font)' : null });
        toggle.setAttribute('aria-label', env.label + ': ' + fam);
        const x = st.extra || {};
        dom.replace(list, (x.families || []).map((f) => h('button', {
          class: ['w-font-opt', f === st.value ? 'is-on' : ''], type: 'button', role: 'option', 'aria-selected': String(f === st.value),
          on: { click: () => env.commit(f) },
        }, h('span', { class: 'w-font-family', text: f }), h('span', { class: 'w-font-sample', text: x.sample || t('w.font.sample'),
          style: { fontFamily: '"' + f + '", var(--font)' } }))));
        toggle.disabled = !!st.readOnly;
      },
    };
  }

  // --- toggle ------------------------------------------------------------------------------------------------------

  function toggle(field, env) {
    const box = h('input', { type: 'checkbox', role: 'switch', 'aria-label': env.label });
    const el = h('label', { class: 'w-toggle' }, box, h('span', { class: 'w-switch', 'aria-hidden': 'true' }));
    box.addEventListener('change', () => env.commit(box.checked));
    return {
      el, focus: () => dom.focus(box),
      update(st) {
        box.indeterminate = !!st.mixed;
        box.checked = !st.mixed && (typeof st.value === 'number' ? st.value > 0 : !!st.value);
        box.disabled = !!st.readOnly;
      },
    };
  }

  // --- words (emphasis chips) -----------------------------------------------------------------------------------------

  function covered(emph, a, b) { return emph.some(([x, y]) => x <= a && b <= y); }

  // Toggling a word adds [a, b) to the emphasis ranges (merging touching ranges) or cuts it out of them.
  function toggleRange(emph, a, b) {
    if (covered(emph, a, b)) {
      const out = [];
      for (const [x, y] of emph) {
        if (y <= a || x >= b) out.push([x, y]);
        else { if (x < a) out.push([x, a]); if (y > b) out.push([b, y]); }
      }
      return out;
    }
    const all = emph.concat([[a, b]]).sort((p, q) => p[0] - q[0]);
    const out = [];
    for (const r of all) {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else out.push([r[0], r[1]]);
    }
    return out;
  }

  function words(field, env) {
    const t = env.t;
    const el = h('div', { class: 'chips w-words', role: 'group', 'aria-label': env.label });
    let emph = [];
    return {
      el, focus: () => dom.focus(el.querySelector('button')),
      update(st) {
        const x = st.extra || {};
        emph = Array.isArray(x.emph) ? x.emph.map((r) => r.slice()) : [];
        const list = x.words || [];
        if (!list.length) { dom.replace(el, h('span', { class: 'muted small', text: t('w.words.none') })); return; }
        dom.replace(el, list.map((w) => h('button', {
          class: ['chip', 'w-word', covered(emph, w.a, w.b) ? 'is-pinned' : ''], type: 'button',
          'aria-pressed': String(covered(emph, w.a, w.b)), disabled: !!st.readOnly,
          on: { click: () => env.commit(toggleRange(emph, w.a, w.b)) },
        }, w.text)));
      },
    };
  }

  // --- cutpoints (┃ pinned or marked, ┊ current auto cut) ------------------------------------------------------------

  // cutClick(cuts, off, source) → the split to pin after a click on the gap at `off` (§6.4.4, §6.4.6): an empty gap
  // gains a cut; a current auto cut ┊ is pinned as it stands (the whole current split); a pinned or marked cut ┃ goes.
  function cutClick(cuts, off, source) {
    const next = new Set(cuts);
    if (!next.has(off)) next.add(off);
    else if (source !== 'auto') next.delete(off);
    next.add(0);
    return [...next].sort((a, b) => a - b);
  }

  function cutpoints(field, env) {
    const t = env.t;
    const el = h('div', { class: 'w-cuts', role: 'group', 'aria-label': env.label });
    return {
      el, focus: () => dom.focus(el.querySelector('button')),
      update(st) {
        const x = st.extra || {};
        const cuts = x.cuts || [0];
        const kids = [];
        (x.graphemes || []).forEach((g, i) => {
          if (i > 0) {
            const off = g.off;
            const on = cuts.includes(off);
            const auto = on && x.source === 'auto';
            const tip = t(auto ? 'w.cuts.pin' : on ? 'w.cuts.remove' : 'w.cuts.add', { n: i });
            kids.push(h('button', {
              class: ['w-gap', on ? 'is-cut' : '', auto ? 'is-auto' : ''], type: 'button', disabled: !!st.readOnly,
              'aria-pressed': String(on), 'aria-label': tip, title: tip,
              on: { click: () => env.commit(cutClick(cuts, off, x.source)) },
            }, on ? (auto ? '┊' : '┃') : ''));
          }
          kids.push(h('span', { class: 'w-g', text: g.text }));
        });
        dom.replace(el, kids);
      },
    };
  }

  // --- text ----------------------------------------------------------------------------------------------------------

  function text(field, env) {
    const t = env.t;
    const max = field.spec && field.spec.max ? field.spec.max : 200;
    const box = h('input', { class: 'text-input w-text', type: 'text', maxlength: max, spellcheck: false, 'aria-label': env.label });
    const presets = (field.presets || []).map((o) => h('button', { class: 'chip-btn', type: 'button', on: { click: () => env.commit(o.v) } },
      optionText(t, o)));
    const el = h('div', { class: 'w-textbox' }, box, presets.length ? h('div', { class: 'row-actions w-presets' }, presets) : null);
    let value = '';
    const commit = () => { if (box.value !== value) env.commit(box.value); };
    box.addEventListener('change', commit);
    box.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { commit(); box.blur(); ev.preventDefault(); }
      else if (ev.key === 'Escape') { box.value = value; }
    });
    return {
      el, focus: () => dom.focus(box),
      update(st) {
        value = st.value === null || st.value === undefined ? '' : String(st.value);
        if (document.activeElement !== box) box.value = st.mixed ? '' : value;
        box.placeholder = st.mixed ? t('state.mixed') : '';
        box.disabled = !!st.readOnly;
      },
    };
  }

  // --- slots (ornament / filter list: select, hide, reorder, remove, add) ------------------------------------------

  function slots(field, env) {
    const t = env.t;
    const list = h('div', { class: 'w-slots', role: 'list', 'aria-label': env.label });
    const add = h('button', { class: 'chip-btn', type: 'button', on: { click: () => env.slot('add') } }, I.icon('plus', { size: 14 }),
      t(field.kind === 'filter' ? 'w.slots.addFx' : 'w.slots.addDeco'));
    const el = h('div', { class: 'w-slotsbox' }, list, add);
    const small = (label, iconOrText, run, disabled) => h('button', { class: 'icon-btn small', type: 'button', title: label,
      'aria-label': label, disabled: !!disabled, on: { click: run } }, typeof iconOrText === 'string' ? iconOrText : iconOrText);
    return {
      el, focus: () => dom.focus(list.querySelector('button') || add),
      update(st) {
        const x = st.extra || {};
        const items = x.items || [];
        // A skipped item (a screen effect the backdrop mode leaves out) is greyed and names the reason (§6.4.8).
        dom.replace(list, items.map((it, n) => h('div', { class: ['w-slot', it.current ? 'is-current' : '', it.hidden ? 'is-hidden' : '',
          it.skip ? 'is-skipped' : ''], role: 'listitem' },
        h('button', { class: 'w-slot-name', type: 'button', title: it.skip || null, on: { click: () => env.slot('select', it.idx) } },
          h('span', { class: 'w-slot-idx', text: String(it.idx + 1) }), it.label,
          it.skip ? h('span', { class: 'w-slot-skip', text: it.skip }) : null),
        field.kind === 'ornament' ? small(t(it.hidden ? 'w.slots.show' : 'w.slots.hide'), I.icon(it.hidden ? 'ring' : 'check', { size: 14 }),
          () => env.slot('hide', it.idx)) : null,
        small(t('w.slots.up'), '↑', () => env.slot('up', it.idx), n === 0),
        small(t('w.slots.down'), '↓', () => env.slot('down', it.idx), n === items.length - 1),
        small(t('w.slots.remove'), I.icon('close', { size: 14 }), () => env.slot('remove', it.idx)))));
        add.disabled = !!st.readOnly || items.length >= 3;
        add.hidden = !!st.readOnly;
      },
    };
  }

  const MAKERS = { part, choice, number, time, color, font, toggle, words, cutpoints, text, slots };

  function make(field, env) {
    const maker = MAKERS[field.widget];
    if (!maker) throw new Error('ui/widgets: no widget ' + field.widget);
    return maker(field, env);
  }

  return { make, AUTO, toggleRange, covered, optionText, round, cutClick, numberText, ownsKey, colorView, names: () => Object.keys(MAKERS) };
});
