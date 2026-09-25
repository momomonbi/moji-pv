/* 文字PVメーカー v2 — original work. The inspector (詳細): crumbs, level header, sections from FIELDS, field rows, sub-pages (DESIGN §6.4.4–§6.4.9, §6.6). */
MV.def('ui/inspector', ['ui/dom', 'ui/icons', 'ui/fields', 'ui/widgets', 'ui/part_browser', 'ui/selection', 'ui/looks',
  'ui/output', 'i18n/t', 'core/paths', 'core/pins'],
(dom, I, F, W, PB, S, LK, OUT, T, P, PINS) => {
  'use strict';

  const { h } = dom;
  const FLASH_MS = 200;
  const LINE_ROW_PX = 30;
  const LINES_BOX_PX = 300;
  const STATE_ICON = { auto: 'ring', pinned: 'pin', inherited: 'ring', ai: 'pin', locked: 'lock', mark: 'mark', derived: 'info',
    inactive: 'close', mixed: 'more' };
  const DICE_WIDGETS = new Set(['part', 'number', 'choice']);
  const NO_DICE = /^(mood|theme|season|texture|start|end|split|lang|t0|titleCard|bpm|beatOffset|readRate|length|color\.|amount\.|face\.|el\.)/;
  const ELEMENTS = ['text', 'ornament', 'ground', 'lens', 'filter', 'seam'];
  // Custom sections redrawn even while they hold focus (their buttons change state); focus is put back (§6.12).
  const REDRAW_FOCUSED = new Set(['looks', 'colorsReset', 'amountsReset', 'lockPartial', 'multi']);

  function tryUse(id) { return MV.has(id) ? MV.use(id) : null; }

  function mount(app, host) {
    const t = app.t;
    app.thumbs = app.thumbs || PB.createThumbs(app);
    const crumbsEl = h('nav', { class: 'crumbs insp-crumbs', 'aria-label': t('panel.crumbs') });
    const headEl = h('div', { class: 'level-head' });
    const bodyEl = h('div', { class: 'insp-body' });
    const subEl = h('div', { class: 'insp-sub', hidden: true });
    dom.replace(host, crumbsEl, headEl, bodyEl, subEl);

    const stack = [];                       // sub-pages: part browser, filter pages (§6.4.4 item 4)
    const openState = new Map();            // page kind → Map(section id → open)
    let page = null;                        // { sig, ctx, rows: [], customs: [] }
    let headSig = null;
    let lastRow = null;                     // the most recently focused field (for [なぜ])
    let dirty = true;

    // --- small helpers -----------------------------------------------------------------------------------------

    const visible = () => host.isConnected && !host.hidden && !host.closest('[hidden]');
    const doc = () => app.doc;
    const plan = () => app.plan;
    const lyrics = () => tryUse('core/lyrics');

    function iconBtn(icon, label, run, extra) {
      return h('button', Object.assign({ class: 'icon-btn small', type: 'button', title: label, 'aria-label': label,
        on: { click: run } }, extra || {}), I.icon(icon, { size: 15 }));
    }

    // A field's label: its string key with labelArgs (keys) resolved; generated part parameters ('fld.param' =
    // '{name}') take their name from the registry's { ja, en } label.
    function labelOf(field) {
      const args = {};
      for (const k of Object.keys(field.labelArgs || {})) args[k] = t(field.labelArgs[k]);
      if (field.labelText) args.name = field.labelText[t.lang] || field.labelText.ja || field.key;
      return field.label ? t(field.label, args) : args.name || field.key;
    }

    const listText = (items) => items.join(t('list.sep'));

    function scopeLabel(ctx) {
      const list = S.crumbs(ctx.sel, plan());
      const last = list.filter((c) => c.sel.level !== 'el').slice(-1)[0];
      return last ? t.label(last.label) : t('crumb.work');
    }

    // Paths a field writes (F.pathsFor): the page scope, every selected line on the several-lines page, or the first
    // cut of the line for the line page's 切り替え.
    function pathsOf(field, ctx) { return F.pathsFor(field, ctx); }

    const scopeKindOf = (path) => (path.startsWith('cut/') ? 'cut' : path.startsWith('line/') ? 'line' : 'work');

    function lineLocked(ctx) {
      const ids = ctx.lineIds.length ? ctx.lineIds : ctx.cut && ctx.cut.line ? [ctx.cut.line] : [];
      return ids.some((id) => doc().locks[id]);
    }

    // A pin of a displayed path, written where the cut's pins live (F.writePath, §4.10.4) with the cut text as sig.
    function pinCmd(path, v) { return F.pinCmd(path, v, plan(), app.svc.pinSig); }

    function run(cmds, meta) {
      if (!cmds.length) return;
      if (cmds.length === 1) app.dispatch(cmds[0], meta); else app.batch(meta, cmds);
    }

    // --- field states ----------------------------------------------------------------------------------------------

    // FieldStates per row (keyed by the row's first path). A row that writes several cut paths (切り替え on the
    // several-lines page) reads each of them and shows いろいろ when they differ.
    function statesFor(rows, ctx) {
      const withPath = rows.filter((r) => r.path);
      if (!withPath.length) return new Map();
      const readPaths = (r) => (r.field.firstCut && r.paths.length > 1 ? r.paths : [r.path]);
      const all = [...new Set(withPath.flatMap(readPaths))];
      let list = null;
      try { list = app.svc.fieldStates(doc(), plan(), ctx.sel, all, { registry: app.reg }); } catch (e) {
        if (typeof console !== 'undefined') console.error(e);
      }
      const byPath = new Map();
      all.forEach((p, i) => byPath.set(p, list && list[i] ? list[i] : { path: p, value: null, state: 'auto', pinnedAt: null, by: null }));
      const out = new Map();
      for (const r of withPath) out.set(r.path, mergeStates(readPaths(r).map((p) => byPath.get(p))));
      return out;
    }

    function mergeStates(list) {
      const a = list[0];
      const same = (x) => x.state === a.state && x.pinnedAt === a.pinnedAt && JSON.stringify(x.value) === JSON.stringify(a.value);
      return list.every(same) ? a : Object.assign({}, a, { state: 'mixed', value: null, pinnedAt: null, by: null });
    }

    // The state tag's text. A value pinned below the row's scope (every cut of a line pinned at cut scope, §4.16.8)
    // says where: 「カットで固定」 / 「行で固定」, since this row's × cannot remove those pins.
    const NARROWER = { cut: 'state.pinnedCut', line: 'state.pinnedLine' };
    function tagOf(fs, row) {
      const below = !!row && fs.pinnedAt && !row.hereKinds.includes(fs.pinnedAt) && NARROWER[fs.pinnedAt];
      switch (fs.state) {
        case 'pinned': return fs.by === 'tap' ? t('state.tap') : below ? t(below) : t('state.pinned');
        case 'inherited': return fs.pinnedAt === 'work' ? t('state.pinnedWork') + ' ↑' : fs.pinnedAt === 'line' ? t('state.pinnedLine') + ' ↑'
          : t('state.pinnedCut');
        case 'ai': return t('state.ai');
        case 'locked': return t('state.locked');
        case 'mark': return t('state.mark');
        case 'derived': return t('state.derived');
        case 'inactive': return t('state.inactive');
        case 'mixed': return t('state.mixed');
        default: return t('state.auto');
      }
    }

    // Whether the row's value is a pin this row may remove (×, Del, the tag, ⋯ 自動に戻す): a user / AI / tap pin, or an
    // inactive one (無効), at the scope the row writes. Lock pins never (Unlock removes them, §3.6). A firstCut row also
    // owns the line-scope pin of its slot, which it shows as inherited.
    function pinnedHere(fs, row) {
      if (!fs || !row || !row.path || fs.by === 'lock') return false;
      if (fs.state === 'pinned' || fs.state === 'ai' || fs.state === 'inactive') return row.hereKinds.includes(fs.pinnedAt);
      return fs.state === 'inherited' && !!row.field.firstCut && fs.pinnedAt === 'line' && row.hereKinds.includes('line');
    }

    // --- values of command and derived fields -----------------------------------------------------------------

    function rowOfLine(line) {
      const id = line.row || line.id.split('.')[0];
      return doc().sheet.rows.find((r) => r.id === id) || null;
    }

    function parsedRow(line) {
      const L = lyrics();
      const row = line ? rowOfLine(line) : null;
      return L && row ? L.parseRow(row.src) : null;
    }

    function metaValue(tag) {
      const re = new RegExp('^\\s*\\[' + tag + ':(.*)\\]\\s*$', 'i');
      const row = doc().sheet.rows.find((r) => re.test(r.src));
      return row ? re.exec(row.src)[1].trim() : '';
    }

    function cmdValue(field, ctx) {
      const c = field.cmd;
      if (c.t === 'look.set') return doc().look[c.key];
      if (c.t === 'look.seed') return doc().look.seed;
      if (c.t === 'timing.set') return doc().timing[c.key];
      if (c.t === 'meta.set') return metaValue(c.key === 'title' ? 'ti' : 'ar');
      if (c.t === 'lyrics.row') {
        const lines = ctx.lineIds.map((id) => plan().lines.find((l) => l.id === id)).filter(Boolean);
        const vals = lines.map((l) => { const p = parsedRow(l); return p ? p[c.key] : null; });
        if (c.key === 'impact' && vals.length > 1 && vals.some((v) => v !== vals[0])) return { mixed: true };
        return vals[0];
      }
      return null;
    }

    function derivedValue(field, ctx) {
      if (field.derived === 'lineLength') return ctx.line ? ctx.line.t1 - ctx.line.t0 : 0;
      if (field.derived === 'cutEnd') return ctx.cut ? ctx.cut.t1 : 0;
      return null;
    }

    // --- extra data per widget -----------------------------------------------------------------------------------

    function familiesFor(field) {
      const set = new Set();
      for (const def of app.reg.all('theme')) {
        const f = def.faces && def.faces[field.role];
        if (!f) continue;
        if (field.script === 'ja' && f.ja) set.add(f.ja);
        if (field.script === 'latin' && f.latin) set.add(f.latin);
        if (f[field.script]) set.add(f[field.script]);
      }
      return [...set].sort();
    }

    function wordsOf(text, lang) {
      const B = tryUse('engine/text/breaker');
      let pairs = null;
      if (B && typeof B.words === 'function') { try { pairs = B.words(text, lang); } catch (e) { pairs = null; } }
      if (!pairs) {
        pairs = [];
        const re = /[^\s、。，,.!?！？・]+/g;
        for (let m = re.exec(text); m; m = re.exec(text)) pairs.push([m.index, m.index + m[0].length]);
      }
      return pairs.map(([a, b]) => ({ a, b, text: text.slice(a, b) })).filter((w) => w.text.trim());
    }

    function graphemesOf(text) {
      const SC = tryUse('core/script');
      if (SC && SC.graphemeOffsets) {
        const offs = SC.graphemeOffsets(text);
        const out = [];
        for (let i = 0; i + 1 < offs.length; i++) out.push({ off: offs[i], text: text.slice(offs[i], offs[i + 1]) });
        return out;
      }
      const out = [];
      let off = 0;
      for (const ch of Array.from(text)) { out.push({ off, text: ch }); off += ch.length; }
      return out;
    }

    function extraFor(field, fs, ctx) {
      const p = plan();
      if (field.widget === 'color') return { palette: p ? p.look.palette : {} };
      if (field.widget === 'font') return { families: familiesFor(field), sample: ctx.line ? ctx.line.text : p && p.lines[0] ? p.lines[0].text : '' };
      if (field.path && field.path.startsWith('amount.')) {
        const mood = p ? app.reg.get('mood', p.look.mood.v) : null;
        return { ghost: mood && mood.amounts ? mood.amounts[field.path.slice(7)] : undefined };
      }
      if (field.widget === 'words' && ctx.line) {
        const pr = parsedRow(ctx.line);
        return { words: wordsOf(ctx.line.text, ctx.line.lang), emph: pr ? pr.emph : [] };
      }
      if (field.widget === 'cutpoints' && ctx.line) {
        const pr = parsedRow(ctx.line);
        const pinned = doc().pins['line/' + ctx.line.id + ':split'];
        const cuts = ctx.line.cuts.map((k) => P.cutOffset(k));
        return { graphemes: graphemesOf(ctx.line.text), cuts, source: pinned ? 'pin' : pr && pr.pieces ? 'mark' : 'auto' };
      }
      if (field.widget === 'slots') return { items: slotItems(field.kind, ctx) };
      return null;
    }

    // The ornament / filter list of a scope. A screen effect the backdrop mode leaves out (§4.19.4) is listed greyed
    // with the reason (§6.4.8).
    function slotItems(kind, ctx) {
      const d = F.decisionsOf(ctx, kind + '.count');
      const n = d.length ? Math.max(...d.map((x) => x.v || 0)) : 0;
      const backdrop = OUT.effectiveBackdrop(doc());
      const out = [];
      for (let i = 0; i < n; i++) {
        const keys = F.decisionsOf(ctx, kind + '#' + i).map((x) => x.v);
        const key = keys.length && keys.every((k) => k === keys[0]) ? keys[0] : null;
        const hidePin = doc().pins[F.writePath(ctx.scope + ':el.' + kind + '#' + i + '.hide', plan())];
        const skip = kind === 'filter' ? OUT.skipOf(app.reg, key, backdrop) : null;
        out.push({ idx: i, key, label: key === null ? t('state.mixed') : key === 'none' ? t('fld.none') : app.label(kind, key),
          hidden: !!(hidePin && hidePin.v), current: ctx.idx === i, skip: skip ? skipText(skip) : null });
      }
      return out;
    }

    function skipText(backdrop) { return t('fld.fxSkipped', { bg: t('exp.bg.' + backdrop) }); }

    function stateOf(row, fs, ctx) {
      const f = row.field;
      if (f.cmd) {
        const v = cmdValue(f, ctx);
        const mixed = !!(v && v.mixed);
        return { value: mixed ? null : v, mixed, auto: false, readOnly: false, extra: extraFor(f, null, ctx) };
      }
      if (!f.path) return { value: derivedValue(f, ctx), mixed: false, auto: false, readOnly: true, extra: extraFor(f, null, ctx) };
      return { value: fs ? fs.value : null, mixed: !!fs && fs.state === 'mixed', auto: !fs || fs.state === 'auto' || fs.state === 'mark',
        readOnly: !!f.readOnly || (!!fs && fs.state === 'derived'), extra: extraFor(f, fs, ctx) };
    }

    // --- writing -------------------------------------------------------------------------------------------------

    function commitCmd(field, v, ctx) {
      const c = field.cmd;
      const label = labelOf(field);
      if (c.t === 'look.set' && c.key === 'backdrop') { setBackdrop(v); return; }
      if (c.t === 'look.set') { app.dispatch({ t: 'look.set', key: c.key, v }, { label: ['undo.aspect', {}] }); return; }
      if (c.t === 'look.seed') { app.dispatch({ t: 'look.seed', seed: Math.max(0, Math.round(v)) >>> 0 }, { label: ['undo.seed', {}] }); return; }
      if (c.t === 'timing.set') { app.dispatch({ t: 'timing.set', key: c.key, v }, { label: ['undo.setting', { field: label }] }); return; }
      if (c.t === 'meta.set') {
        app.dispatch({ t: 'meta.set', [c.key]: v === '' ? null : String(v) }, { label: ['undo.setting', { field: label }] });
        return;
      }
      if (c.t === 'lyrics.row') {
        const L = lyrics();
        if (!L) return;
        const cmds = [];
        for (const id of ctx.lineIds) {
          const line = plan().lines.find((l) => l.id === id);
          const row = line ? rowOfLine(line) : null;
          if (!row || cmds.some((x) => x.rowId === row.id)) continue;
          const pr = L.parseRow(row.src);
          const next = Object.assign({}, pr, { [c.key]: c.key === 'note' ? (v ? String(v) : null) : v });
          const src = L.renderRow(next);
          if (src !== row.src) cmds.push({ t: 'lyrics.row', rowId: row.id, src });
        }
        run(cmds, { label: ['undo.marks', { field: label }], where: { scope: ctx.scope, field: field.key } });
      }
    }

    // 背景の種類 keeps the export format in step (透明 ⇔ 透過PNG, ui/output); the format is not on this page, so a toast
    // says when it followed.
    function setBackdrop(v) {
      const before = doc().output.format;
      run(OUT.backdropCmds(doc(), v), { label: ['undo.backdrop', {}] });
      const after = doc().output.format;
      if (after !== before) app.toast(t('toast.formatFollows', { format: t('exp.fmt.' + after) }));
    }

    // A value set at line or work scope that cut pins of the same slot still override (§3.5 cut > line > work) is said
    // once per field, as ⋯ › 範囲を広げる does (「3カットは個別の固定を保持」).
    let shadowTold = null;
    function reportShadowed(row, ctx) {
      const slot = row.field.path;
      if (!slot || ctx.scopeKind === 'cut' || row.field.firstCut || shadowTold === row.path) return;
      const pins = doc().pins;
      const n = ctx.cuts.filter((c) => pins[F.writePath('cut/' + c.key + ':' + slot, plan())]).length;
      if (!n) return;
      shadowTold = row.path;
      app.toast(t('toast.promoteKept', { n }));
    }

    function valueFor(field, v, fs) {
      if (field.flashToggle) {
        const p = plan();
        const mood = p ? app.reg.get('mood', p.look.mood.v) : null;
        const moodV = mood && mood.amounts ? mood.amounts.flash : 0;
        if (v) return moodV > 0 ? W.AUTO : 0.5;
        return 0;
      }
      if (field.path === 'split') return Array.isArray(v) && v.length <= 1 ? 'none' : v;
      const spec = field.spec;
      if (spec && ['num', 'int', 'enum', 'ease', 'order', 'ink', 'color', 'face', 'text'].includes(spec.type)) {
        const coerced = MV.use('core/schema').coerce(spec, v);
        return coerced === undefined ? (fs ? fs.value : v) : coerced;
      }
      return v;
    }

    function commit(row, v, opts) {
      const ctx = page.ctx;
      const field = row.field;
      if (field.cmd) { commitCmd(field, v, ctx); return; }
      const value = valueFor(field, v, row.fs);
      if (value === W.AUTO) { unpin(row); return; }
      const o = opts || {};
      const meta = { label: ['undo.pin', { field: labelOf(field), scope: scopeLabel(ctx) }], where: { scope: ctx.scope, field: field.path } };
      if (o.mergeKey) meta.mergeKey = o.mergeKey;
      else if (o.merge) meta.mergeKey = 'field:' + row.path;
      run(pathsOf(field, ctx).map((path) => pinCmd(path, value)), meta);
      reportShadowed(row, ctx);
    }

    function unpin(row) {
      const ctx = page.ctx;
      const cmds = removablePaths(row.clearPaths).map((path) => ({ t: 'pin.clear', path }));
      run(cmds, { label: ['undo.unpinField', { field: labelOf(row.field) }], where: { scope: ctx.scope, field: row.field.path } });
    }

    function removablePaths(paths) { return paths.filter((p) => doc().pins[p] && doc().pins[p].by !== 'lock'); }

    // [d]: on a pinned field unpin + reroll, one batch (§6.7). The pins go where × would clear them (row.clearPaths has
    // the older key of §4.10.4); the salts stay keyed by the displayed cut, which is what the planner reads.
    function reroll(row) {
      const ctx = page.ctx;
      if (lineLocked(ctx)) { app.toast(t('toast.lockedNoReroll'), { kind: 'warn' }); return; }
      const cmds = removablePaths(row.clearPaths).map((path) => ({ t: 'pin.clear', path }));
      for (const path of pathsOf(row.field, ctx)) cmds.push({ t: 'salt.bump', key: path });
      run(cmds, { label: ['undo.dice', { field: labelOf(row.field) }], where: { scope: ctx.scope, field: row.field.path } });
    }

    function gestureFor(row) {
      const key = 'gesture:' + row.path;
      const g = app.store.gesture(key);
      return { set: (v) => commit(row, v, { mergeKey: key }), end: () => g.end() };
    }

    // --- field rows ----------------------------------------------------------------------------------------------

    function rerollable(field) {
      return !!field.path && DICE_WIDGETS.has(field.widget) && !NO_DICE.test(field.path) && !field.cmd && !field.path.includes('@breathMark');
    }

    function makeRow(field, ctx) {
      const paths = pathsOf(field, ctx);
      const clearPaths = F.clearPathsFor(field, ctx);
      const path = paths.length ? paths[0] : null;
      const label = labelOf(field);
      const row = { field, path, paths, clearPaths, hereKinds: [...new Set(clearPaths.map(scopeKindOf))], fs: null, whyKind: null };
      const tag = h('button', { class: 'state-tag', type: 'button', 'aria-live': 'off' });
      const lab = h('span', { class: 'fr-label', text: label });
      const dice = rerollable(field) ? iconBtn('dice', t('act.rerollField', { field: label }), () => reroll(row), { 'data-role': 'dice' }) : null;
      const x = path ? iconBtn('close', t('act.unpinField', { field: label }), () => unpin(row), { 'data-role': 'unpin' }) : null;
      const more = path ? iconBtn('more', t('fld.more', { field: label }), (ev) => openFieldMenu(row, ev.currentTarget),
        { 'aria-haspopup': 'menu' }) : null;
      const why = h('div', { class: 'fr-why', hidden: true, role: 'note' });
      const env = {
        app, t, label, field,
        commit: (v, o) => commit(row, v, o),
        gesture: () => gestureFor(row),
        unpin: () => unpin(row),
        open: () => openPicker(row),
        thumb: (canvas, key) => app.thumbs.draw(canvas, key ? { kind: field.partKind || field.kind, key } : null),
        slot: (action, i) => slotAction(field.kind, action, i),
      };
      const widget = W.make(field, env);
      const el = h('div', { class: 'frow', 'data-widget': field.widget, 'data-slot': field.path || field.key, 'data-field': field.id },
        h('div', { class: 'fr-top' }, lab, tag, h('span', { class: 'grow' }), dice, x, more), widget.el, why);
      Object.assign(row, { el, tag, dice, x, more, why, widget, lab });
      // Del / Backspace unpin the focused field (§6.8): the row publishes the paths it may clear while it has focus;
      // ui/boot's pin.clearField removes the ones that hold a pin (never a lock pin).
      el.addEventListener('focusin', () => {
        lastRow = row;
        focusRow(row);
      });
      el.addEventListener('focusout', (ev) => { if (!el.contains(ev.relatedTarget)) blurRow(row); });
      el.addEventListener('contextmenu', (ev) => { if (path) { ev.preventDefault(); openFieldMenu(row, { x: ev.clientX, y: ev.clientY }); } });
      el.addEventListener('keydown', (ev) => {
        if (path && (ev.key === 'F10' && ev.shiftKey || ev.key === 'ContextMenu')) { ev.preventDefault(); openFieldMenu(row, more || el); }
      });
      tag.addEventListener('click', () => {
        const fs = row.fs;
        if (pinnedHere(fs, row)) unpin(row);
        else if (fs && fs.state === 'inherited') goOwner(row);
      });
      if (widget.scrub) { lab.classList.add('is-scrub'); scrubLabel(row); }
      return row;
    }

    let focusedRow = null;
    function focusRow(row) {
      focusedRow = row;
      const list = row.clearPaths;
      app.view.set({ focusField: !list.length ? null : list.length === 1 ? list[0] : list.slice() });
    }
    function blurRow(row) {
      if (focusedRow !== row) return;
      focusedRow = null;
      app.view.set({ focusField: null });
    }
    function forgetFocus() { if (focusedRow) blurRow(focusedRow); }

    // Dragging a number field's label scrubs its value (one gesture = one undo entry).
    function scrubLabel(row) {
      const sc = row.widget.scrub;
      let start = null;
      row.lab.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        start = { x: ev.clientX, v: sc.get(), g: null };
        row.lab.setPointerCapture(ev.pointerId);
      });
      row.lab.addEventListener('pointermove', (ev) => {
        if (!start) return;
        const dx = ev.clientX - start.x;
        if (!start.g && Math.abs(dx) < 3) return;
        if (!start.g) start.g = gestureFor(row);
        const per = (sc.max - sc.min) / 240;
        const v = Math.max(sc.min, Math.min(sc.max, start.v + Math.round(dx * per / sc.step) * sc.step));
        sc.preview(v);
        start.g.set(v);
      });
      const end = () => { if (start && start.g) start.g.end(); start = null; };
      row.lab.addEventListener('pointerup', end);
      row.lab.addEventListener('pointercancel', end);
    }

    function updateRow(row, fs, ctx) {
      row.fs = fs;
      const st = stateOf(row, fs, ctx);
      row.widget.update(st);
      if (!row.path) { row.tag.hidden = true; return; }
      const state = fs ? fs.state : 'auto';
      row.tag.hidden = false;
      row.tag.dataset.state = state;
      dom.replace(row.tag, I.icon(STATE_ICON[state] || 'ring', { size: 12 }), tagOf(fs || { state: 'auto' }, row));
      const here = pinnedHere(fs, row);
      row.tag.title = here ? t('act.unpin') : state === 'inherited' ? t('fld.goOwner') : '';
      row.tag.disabled = !(here || state === 'inherited');
      row.x.hidden = !here;
      if (row.dice) row.dice.disabled = lineLocked(ctx);
      row.el.dataset.state = state;
      showInactive(row, fs);
      showSkip(row, fs);
    }

    // A screen-effect row whose part the backdrop mode leaves out (§4.19.4) says so under the row (§6.4.8).
    function showSkip(row, fs) {
      const kind = row.field.widget === 'part' ? row.field.partKind || row.field.kind : null;
      const skip = kind === 'filter' && fs && typeof fs.value === 'string' ? OUT.skipOf(app.reg, fs.value, OUT.effectiveBackdrop(doc())) : null;
      row.el.classList.toggle('is-skipped', !!skip);
      if (skip && (row.whyKind === null || row.whyKind === 'skip')) {
        row.why.textContent = skipText(skip);
        row.why.hidden = false;
        row.whyKind = 'skip';
      } else if (!skip && row.whyKind === 'skip') {
        row.why.hidden = true;
        row.whyKind = null;
      }
    }

    // 無効 (§6.6): a pinned value that does not apply says why, under the row, until it applies again.
    function showInactive(row, fs) {
      if (fs && fs.state === 'inactive') {
        row.why.textContent = t(fs.inactiveReason === 'not-applicable' ? 'fld.inactiveNotApplicable' : 'fld.inactiveWhy');
        row.why.hidden = false;
        row.whyKind = 'inactive';
      } else if (row.whyKind === 'inactive') {
        row.why.hidden = true;
        row.whyKind = null;
      }
    }

    // --- the ⋯ menu of a field (§6.4.4 item 6) ------------------------------------------------------------------------

    function openFieldMenu(row, at) {
      if (!app.menus) return;
      const ctx = page.ctx;
      const fs = row.fs || { state: 'auto' };
      const here = pinnedHere(fs, row);
      const stored = storedPath(row);
      const pin = stored ? doc().pins[stored] : null;
      const parsed = row.path ? P.parse(row.path) : null;
      const canPin = (to) => (Array.isArray(fs.canPinAt) ? fs.canPinAt.includes(to) : true);
      const canLine = here && !!parsed && parsed.scope.kind === 'cut' && !!parsed.scope.lineId && canPin('line');
      const canWork = here && !!parsed && parsed.scope.kind !== 'work' && canPin('work');
      const clip = app.fieldClipboard;
      app.menus.open(at, [
        { label: t('fm.unpin'), keys: 'Del', disabled: !here, run: () => unpin(row) },
        rerollable(row.field) ? { label: t('act.reroll'), disabled: lineLocked(ctx), run: () => reroll(row) } : null,
        { label: t('fm.pinNow'), disabled: here || fs.state === 'mixed' || fs.value === null || fs.value === undefined,
          run: () => commit(row, fs.value) },
        { label: t('fm.copy'), disabled: fs.value === null || fs.value === undefined || fs.state === 'mixed',
          run: () => { app.fieldClipboard = { slot: row.field.path, v: fs.value }; app.toast(t('toast.fieldCopied')); } },
        { label: t('fm.paste'), disabled: !clip || clip.slot !== row.field.path, run: () => commit(row, clip.v) },
        { sep: true },
        { label: t('fm.promoteLine'), disabled: !canLine || !pin, run: () => promote(row, 'line') },
        { label: t('fm.promoteWork'), disabled: !canWork || !pin, run: () => promote(row, 'work') },
        { label: t('fm.goOwner'), disabled: fs.state !== 'inherited', run: () => goOwner(row) },
        { sep: true },
        { label: t('fm.why'), run: () => showWhy(row, true) },
      ]);
    }

    // Where the row's own pin is stored: the displayed path, or the older key of a cut (§4.10.4).
    function storedPath(row) { return row.path ? F.writePath(row.path, plan()) : null; }

    // pin.promote of the pin where it is stored: the toast names how many cut pins keep their own value (§6.4.4).
    function promote(row, to) {
      const path = storedPath(row);
      const parsed = P.parse(path);
      const slot = parsed.slot;
      const target = to === 'line' ? 'line/' + parsed.scope.lineId : 'work';
      app.dispatch({ t: 'pin.promote', path, to }, { label: ['undo.promote', { field: labelOf(row.field) }] });
      const kept = Object.keys(doc().pins).filter((p) => {
        if (!p.endsWith(':' + slot) || p === target + ':' + slot) return false;
        try { return P.isUnder(p, target); } catch (e) { return false; }
      }).length;
      if (kept) app.toast(t('toast.promoteKept', { n: kept }));
    }

    function goOwner(row) {
      const fs = row.fs;
      if (!fs || !fs.pinnedAt) return;
      const ctx = page.ctx;
      const lineId = ctx.line ? ctx.line.id : ctx.cut ? ctx.cut.line : null;
      let scope = fs.pinnedAt === 'work' ? 'work' : fs.pinnedAt === 'line' && lineId ? 'line/' + lineId : null;
      if (!scope) return;
      const sel = ctx.el ? Object.assign({ level: 'el', scope, el: ctx.el }, ctx.idx !== null ? { idx: ctx.idx } : {})
        : scope === 'work' ? S.WORK : { level: 'line', ids: [lineId] };
      app.select(sel, { from: 'crumbs' });
      requestAnimationFrame(() => flashField(row.field.path));
    }

    // なぜ: the explanation of the value (auto values; lazy, §4.16.8), in words (F.whyParts: no planner ids).
    function showWhy(row, force) {
      if (!row || !row.path) return;
      if (!row.why.hidden && !force) { row.why.hidden = true; return; }
      let ex = null;
      try { ex = app.svc.explain(doc(), plan(), row.path, { registry: app.reg }); } catch (e) { ex = null; }
      lastRow = row;
      const parts = F.whyParts(ex, row.path, t, plan());
      row.why.textContent = t('fld.whyPrefix', { why: parts.length ? listText(parts) : t('fld.whyNone') });
      row.why.hidden = false;
      row.whyKind = 'explain';
    }

    // --- sub-pages -----------------------------------------------------------------------------------------------

    function push(pg) {
      stack.push(pg);
      showStack();
      scrollTop();
      pg.focus();
    }

    function pop() {
      const pg = stack.pop();
      if (!pg) return false;
      pg.destroy();
      showStack();
      if (!stack.length && pg.returnTo) pg.returnTo();
      else if (stack.length) stack[stack.length - 1].focus();
      return true;
    }

    function clearStack() {
      if (!stack.length) return;
      while (stack.length) stack.pop().destroy();
      showStack();
    }

    // The picker keys (§6.8 ctx 'picker': arrows move between tiles, Enter picks, Esc pops) apply only while focus is
    // inside the sub-page; everywhere else the app keymap and the lyric editor keep their keys.
    const inPicker = () => stack.length > 0 && !subEl.hidden && subEl.contains(document.activeElement);
    Object.defineProperty(app, 'pickerOpen', { configurable: true, enumerable: true, get: inPicker });

    function showStack() {
      const top = stack[stack.length - 1] || null;
      subEl.hidden = !top;
      bodyEl.hidden = !!top;
      headEl.hidden = !!top;
      if (top) {
        dom.replace(subEl, h('div', { class: 'sub-head' },
          h('button', { class: 'btn small', type: 'button', on: { click: () => pop() } }, I.icon('prev', { size: 14 }), t('sub.back')),
          h('h3', { class: 'sub-title', text: t.label(top.crumb) })), top.el);
      } else dom.clear(subEl);
      renderCrumbs();
    }

    function openPicker(row) {
      const ctx = page.ctx;
      const field = row.field;
      const kind = field.partKind || field.kind;
      const paths = pathsOf(field, ctx);
      // The document a tile would give: the pick written like commit(), 自動 cleared like unpin() (both where stored).
      const tryDoc = (key) => {
        const cmds = key === null ? removablePaths(row.clearPaths).map((path) => ({ t: 'pin.clear', path }))
          : paths.map((path) => pinCmd(path, key));
        let d = doc();
        try { for (const cmd of cmds) d = app.reduce(d, cmd); } catch (e) { return null; }
        return d;
      };
      push(Object.assign(PB.pickerPage(app, {
        kind, path: row.path, label: labelOf(field), value: row.fs && row.fs.state !== 'mixed' ? row.fs.value : null,
        allowNone: !!field.noneOk, texture: !!field.texture, run: kind === 'ornament' ? !!field.run : undefined, tryDoc,
        alts: () => { const ex = app.svc.explain(doc(), plan(), row.path, { registry: app.reg }); return ex ? ex.alts : null; },
        onPick: (key) => {
          pop();
          if (key === null) unpin(row); else commit(row, key);
        },
      }), { returnTo: () => { const r = findRow(field.path); if (r) r.widget.focus(); } }));
    }

    function openFilter(kind) {
      push(Object.assign(PB.filterPage(app, { kind }), { returnTo: () => dom.focus(bodyEl.querySelector('[data-kind="' + kind + '"]')) }));
    }

    function slotAction(kind, action, i) {
      const ctx = page.ctx;
      const scope = ctx.scope;
      const items = slotItems(kind, ctx);
      const n = items.length;
      if (action === 'select') { app.select({ level: 'el', scope, el: kind, idx: i }, { from: 'crumbs' }); return; }
      if (action === 'add') {
        if (n >= 3) return;
        app.dispatch(pinCmd(scope + ':' + kind + '.count', n + 1), { label: ['undo.addSlot', { kind: t('kind.' + kind) }] });
        app.select({ level: 'el', scope, el: kind, idx: n }, { from: 'crumbs' });
        return;
      }
      if (action === 'remove') {
        app.dispatch(pinCmd(scope + ':' + kind + '#' + i, 'none'), { label: ['undo.removeSlot', { kind: t('kind.' + kind) }] });
        return;
      }
      if (action === 'hide') {
        const path = scope + ':el.' + kind + '#' + i + '.hide';
        const stored = F.writePath(path, plan());
        const pin = doc().pins[stored];
        app.dispatch(pin && pin.v ? { t: 'pin.clear', path: stored } : pinCmd(path, true), { label: ['undo.hideSlot', {}] });
        return;
      }
      // up / down: swap the two slots' part pins (their current values), one undo entry.
      const j = action === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= n) return;
      const a = items[i], b = items[j];
      if (a.key === null || b.key === null) return;
      const cmds = [pinCmd(scope + ':' + kind + '#' + i, b.key), pinCmd(scope + ':' + kind + '#' + j, a.key)];
      app.batch({ label: ['undo.moveSlot', { kind: t('kind.' + kind) }] }, cmds);
    }

    // --- crumbs and level header ------------------------------------------------------------------------------------

    function renderCrumbs() {
      const sel = S.validate(app.view.state.sel, plan());
      const list = S.crumbs(sel, plan());
      const kids = [];
      list.forEach((c, i) => {
        if (i) kids.push(h('span', { class: 'sep', 'aria-hidden': 'true', text: '›' }));
        const last = i === list.length - 1 && !stack.length;
        kids.push(h('button', { class: 'crumb', type: 'button', 'aria-current': last ? 'location' : null,
          on: { click: () => { clearStack(); app.select(c.sel, { from: 'crumbs' }); } } }, t.label(c.label)));
      });
      for (const pg of stack) {
        kids.push(h('span', { class: 'sep', 'aria-hidden': 'true', text: '›' }));
        kids.push(h('span', { class: 'crumb is-sub', 'aria-current': pg === stack[stack.length - 1] ? 'location' : null, text: t.label(pg.crumb) }));
      }
      dom.replace(crumbsEl, kids);
    }

    function timeRange(a, b) { return T.fmtTime(a) + ' – ' + T.fmtTime(b); }

    function pinCount(scope) {
      const own = F.writeScope(scope, plan());
      const all = [...new Set(PINS.pinsUnder(doc().pins, scope).concat(own === scope ? [] : PINS.pinsUnder(doc().pins, own)))];
      return { user: all.filter((p) => doc().pins[p].by !== 'lock'), lock: all.filter((p) => doc().pins[p].by === 'lock') };
    }

    function headButton(icon, label, run, extra) {
      return h('button', Object.assign({ class: 'chip-btn lh-btn', type: 'button', on: { click: run } }, extra || {}),
        I.icon(icon, { size: 14 }), label);
    }

    function renderHead(ctx) {
      const p = plan();
      const sel = ctx.sel;
      const sig = JSON.stringify(sel) + '|' + (p ? p.hash : '') + '|' + JSON.stringify(doc().locks) + '|' + Object.keys(doc().pins).length;
      if (sig === headSig && headEl.contains(document.activeElement)) return;
      headSig = sig;
      const kids = [];
      const buttons = [];
      const title = h('div', { class: 'lh-title', tabindex: '-1', role: 'heading', 'aria-level': '2' });
      const sub = h('div', { class: 'lh-sub' });
      if (ctx.page === 'work') {
        title.textContent = app.titleOf() || t('hdr.untitled');
        sub.textContent = p && p.lines.length ? [t('count.lines', { n: p.lines.length }), T.fmtTime(p.duration)].join(' · ') : t('lh.empty');
        buttons.push(headButton('dice', t('act.reroll'), () => app.actions.run('look.reroll'), { title: t('lh.rerollWork') }));
      } else if (ctx.page === 'lines') {
        title.textContent = t('crumb.lines', { n: ctx.lineIds.length });
        sub.textContent = t('lh.multi');
      } else {
        const line = ctx.line || (ctx.cut && ctx.cut.line ? p.lines.find((l) => l.id === ctx.cut.line) : null);
        if (line && (ctx.page === 'line' || ctx.el === 'text')) kids.push(lineInput(line));
        else title.textContent = ctx.page.startsWith('el.') ? t('el.' + ctx.el) : ctx.cut ? ctx.cut.text || t.label(S.crumbs(sel, p).slice(-1)[0].label) : '';
        if (ctx.page === 'cut' && ctx.cut) {
          const own = ctx.cut.line ? p.lines.find((l) => l.id === ctx.cut.line) : null;
          const k = own ? own.cuts.indexOf(ctx.cut.key) + 1 : 0;
          sub.textContent = (own ? t('lh.cutOf', { k, n: own.cuts.length }) + ' · ' : '') + timeRange(ctx.cut.t0, ctx.cut.t1);
        } else if (ctx.cut) sub.textContent = timeRange(ctx.cut.t0, ctx.cut.t1);
        else if (line) sub.textContent = timeRange(line.t0, line.t1);
        if (line && ctx.page === 'line') {
          const locked = !!doc().locks[line.id];
          buttons.push(headButton('lock', locked ? t('act.unlock') : t('act.lock'), () => app.actions.run('lock.toggle'),
            { 'aria-pressed': String(locked), class: ['chip-btn', 'lh-btn', locked ? 'is-on' : ''] }));
        }
        buttons.push(headButton('dice', t('act.reroll'), () => app.actions.run('look.reroll'), { disabled: lineLocked(ctx) }));
      }
      if (ctx.page !== 'lines') buttons.push(headButton('info', t('lh.why'), () => showWhy(lastRow || page.rows.find((r) => r.path), true)));
      if (ctx.page === 'line' || ctx.page === 'cut') {
        const d = ctx.page === 'line' ? 'sel.line' : 'sel.cut';
        buttons.push(h('span', { class: 'lh-nav' },
          iconBtn('prev', t('lh.prev'), () => app.actions.run(d, { d: -1 })), iconBtn('next', t('lh.next'), () => app.actions.run(d, { d: 1 }))));
      }
      const counts = pinCount(ctx.scope);
      if (ctx.page !== 'lines') {
        const pinsBtn = headButton('pin', t('lh.pins', { n: counts.user.length }), (ev) => openPins(ctx, ev.currentTarget),
          { 'aria-haspopup': 'menu', disabled: !counts.user.length && !counts.lock.length });
        buttons.push(pinsBtn);
      }
      if (ctx.page === 'line' && ctx.line) {
        const same = p.lines.filter((l) => l.text === ctx.line.text);
        if (same.length > 1) {
          buttons.push(h('button', { class: 'link lh-same', type: 'button',
            on: { click: () => app.select({ level: 'line', ids: same.map((l) => l.id) }, { from: 'crumbs' }) } }, t('lh.same', { n: same.length }), ' ›'));
        }
      }
      if (!kids.length) kids.push(title);
      dom.replace(headEl, kids, sub, h('div', { class: 'lh-actions' }, buttons));
    }

    // The line's text (raw, with its marks) is edited in place and committed as lyrics.row (§6.4.6).
    function lineInput(line) {
      const row = rowOfLine(line);
      const input = h('input', { class: 'lh-input', type: 'text', spellcheck: false, value: row ? row.src : line.text,
        'aria-label': t('lh.text') });
      const commitText = () => {
        if (row && input.value !== row.src) app.dispatch({ t: 'lyrics.row', rowId: row.id, src: input.value }, { label: ['undo.lineText', {}] });
      };
      input.addEventListener('change', commitText);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { commitText(); input.blur(); ev.preventDefault(); }
        else if (ev.key === 'Escape' && row) { input.value = row.src; }
      });
      return input;
    }

    function prettyPath(path) {
      let parsed;
      try { parsed = P.parse(path); } catch (e) { return path; }
      const f = F.FIELDS.find((x) => x.path === parsed.slot);
      const name = f ? labelOf(f) : parsed.part ? t('kind.' + (parsed.part.kind === 'atmos' ? 'ornament' : parsed.part.kind === 'texture' ? 'filter' : parsed.part.kind))
        + (parsed.part.idx !== null ? ' ' + (parsed.part.idx + 1) : '') + (parsed.part.param ? ' · ' + parsed.part.param : '') : parsed.slot;
      if (parsed.scope.kind === 'work') return t('crumb.work') + ' · ' + name;
      const sc = parsed.scope.kind === 'line' ? { level: 'line', ids: [parsed.scope.id] } : { level: 'cut', key: parsed.scope.id };
      const cr = S.crumbs(sc, plan()).slice(1).map((c) => t.label(c.label)).join(' ');
      return (cr || parsed.scope.id) + ' · ' + name;
    }

    function openPins(ctx, anchor) {
      const counts = pinCount(ctx.scope);
      const items = counts.user.map((path) => ({ label: prettyPath(path) + ' — ' + t('act.unpin'),
        run: () => app.dispatch({ t: 'pin.clear', path }, { label: ['undo.unpin', {}] }) }));
      if (counts.lock.length) items.push({ sep: true }, { note: t('lh.lockPins', { n: counts.lock.length }) });
      items.push({ sep: true }, { label: t('lh.unpinAll'), disabled: !counts.user.length,
        run: () => app.dispatch({ t: 'pin.clearUnder', scope: ctx.scope }, { label: ['undo.unpinAll', {}] }) });
      app.menus.open(anchor, items);
    }

    // --- custom sections -----------------------------------------------------------------------------------------

    function customOf(id, ctx) {
      const fn = CUSTOM[id];
      return fn ? fn(ctx) : null;
    }

    const CUSTOM = {
      parts() {
        return h('div', { class: 'insp-list' }, PB.FILTER_KINDS.map((kind) => {
          const c = PB.counts(app, kind);
          return h('button', { class: 'insp-item', type: 'button', 'data-kind': kind, on: { click: () => openFilter(kind) } },
            h('span', { class: 'grow', text: t('kind.' + kind) }), h('span', { class: ['muted', c.on < c.total ? 'is-on' : ''], text: c.on + ' / ' + c.total }),
            I.icon('next', { size: 14 }));
        }));
      },
      titleLink() {
        const has = plan() && plan().cuts.some((c) => c.key === 'title');
        return h('button', { class: 'chip-btn', type: 'button', disabled: !has, title: has ? '' : t('insp.noTitleCut'),
          on: { click: () => app.select({ level: 'cut', key: 'title' }, { from: 'crumbs' }) } }, t('insp.titleCut'), I.icon('next', { size: 14 }));
      },
      lines: linesList,
      looks: looksGrid,
      elements(ctx) {
        const scope = ctx.scope;
        const chips = [];
        const count = (kind) => { const d = F.decisionsOf(ctx, kind + '.count'); return d.length ? Math.max(...d.map((x) => x.v || 0)) : 0; };
        for (const el of ELEMENTS) {
          if (el === 'seam' && ctx.scopeKind !== 'cut') continue;
          const n = el === 'ornament' || el === 'filter' ? count(el) : null;
          chips.push(h('button', { class: 'chip', type: 'button', 'data-el': el,
            on: { click: () => app.select(Object.assign({ level: 'el', scope, el }, n !== null ? { idx: 0 } : {}), { from: 'crumbs' }) } },
          t('el.' + el), n !== null ? h('span', { class: 'muted', text: ' ' + n }) : null));
        }
        const add = ctx.page === 'cut' ? [['ornament', 'insp.addDeco'], ['filter', 'insp.addFx']].map(([kind, label]) => h('button', {
          class: 'chip-btn', type: 'button', disabled: count(kind) >= 3,
          on: { click: () => slotAction(kind, 'add') },
        }, I.icon('plus', { size: 13 }), t(label))) : [];
        return h('div', { class: 'chips' }, chips, add);
      },
      other() {
        const warn = (plan() ? plan().warnings : []).filter((w) => w.code === 'orphan-pin' || w.code === 'shadowed-pin');
        const box = h('div', { class: 'insp-other' },
          h('div', { class: 'row-actions' },
            h('button', { class: 'btn small', type: 'button', on: { click: () => app.dispatch({ t: 'pin.clearUnder', scope: 'work' }, { label: ['undo.unpinAll', {}] }) } },
              t('insp.unpinAll')),
            h('button', { class: 'btn small', type: 'button', on: { click: () => app.dispatch({ t: 'pin.clearUnder', scope: 'work', by: 'ai' }, { label: ['undo.unpinAi', {}] }) } },
              t('insp.unpinAi'))),
          h('div', { class: 'field-label', text: t('insp.orphans', { n: warn.length }) }));
        for (const w of warn) {
          box.appendChild(h('div', { class: 'insp-orphan' }, h('span', { class: 'grow', text: prettyPath(w.path) }),
            h('button', { class: 'link', type: 'button', on: { click: () => app.dispatch({ t: 'pin.clear', path: w.path }, { label: ['undo.unpin', {}] }) } }, t('insp.delete')),
            w.line ? h('button', { class: 'link', type: 'button', on: { click: () => reattach(w) } }, t('insp.reattach')) : null));
        }
        return box;
      },
      cuts(ctx) {
        if (!ctx.line) return null;
        const byKey = new Map(plan().cuts.map((c) => [c.key, c]));
        return h('div', { class: 'insp-list' }, ctx.line.cuts.map((key, i) => {
          const c = byKey.get(key);
          return h('button', { class: 'insp-item', type: 'button', on: { click: () => app.select({ level: 'cut', key }, { from: 'crumbs' }) } },
            h('span', { class: 'insp-num', text: String(i + 1) }), h('span', { class: 'grow ell', text: c ? c.text : key }),
            c ? h('span', { class: 'muted mono', text: T.fmtTime(c.t0) }) : null, I.icon('next', { size: 14 }));
        }));
      },
      ai(ctx) {
        return h('button', { class: 'chip-btn', type: 'button', disabled: !app.view.state.prefs.ai, on: { click: () => {
          app.aiTarget = { lines: ctx.lineIds.slice() };
          app.openPanel('ai', 'ai');
          app.bus.emit('ai.tool', 'edit');
        } } }, I.icon('ai', { size: 14 }), t('insp.askAi'));
      },
      multi(ctx) {
        const allLocked = ctx.lineIds.every((id) => doc().locks[id]);
        const a = (id, icon, label, off) => h('button', { class: 'btn small', type: 'button',
          disabled: !!off || (app.actions.has(id) && !app.actions.enabled(id)), title: off || null,
          on: { click: () => app.actions.run(id, { from: 'inspector' }) } }, I.icon(icon, { size: 14 }), label);
        // Reroll is disabled while any selected line is locked (§3.6).
        const locked = lineLocked(ctx) ? t('toast.lockedNoReroll') : null;
        return h('div', { class: 'row-actions' }, a('lock.toggle', 'lock', allLocked ? t('act.unlock') : t('act.lock')),
          a('look.reroll', 'dice', t('act.reroll'), locked), a('pin.clearSelection', 'close', t('act.unpin')),
          a('look.copy', 'file', t('cmd.look.copy')), a('look.paste', 'file', t('cmd.look.paste')));
      },
      shift(ctx) {
        const nudgeBy = (ev, dir) => {
          const d = (ev.shiftKey ? 1 / (doc().output.fps || 30) : 0.1) * dir;
          const cmds = tryUse('core/commands');
          const base = cmds && cmds.effectiveTimes ? cmds.effectiveTimes(plan(), ctx.lineIds)
            : Object.fromEntries(plan().lines.filter((l) => ctx.lineIds.includes(l.id)).map((l) => [l.id, { start: l.t0, end: l.t1 }]));
          app.dispatch({ t: 'time.shift', lineIds: ctx.lineIds.slice(), delta: Math.round(d * 1000) / 1000, base },
            { label: ['undo.shift', { n: ctx.lineIds.length }], mergeKey: 'shift:' + ctx.lineIds.join(',') });
        };
        const impact = { key: 'impact', widget: 'toggle', cmd: { t: 'lyrics.row', key: 'impact' }, label: 'fld.impact', id: 'lines/shift/impact' };
        const row = makeRow(impact, ctx);
        page.rows.push(row);
        return h('div', { class: 'insp-shift' },
          h('div', { class: 'field-row' }, h('span', { class: 'field-label inline', text: t('insp.shiftAll') }),
            h('button', { class: 'btn small', type: 'button', title: t('insp.shiftTip'), on: { click: (ev) => nudgeBy(ev, -1) } }, '−'),
            h('button', { class: 'btn small', type: 'button', title: t('insp.shiftTip'), on: { click: (ev) => nudgeBy(ev, 1) } }, '+')),
          row.el);
      },
      groundRun(ctx) {
        const seg = plan() && ctx.cuts[0] ? plan().grounds[ctx.cuts[0].ground] : null;
        const n = seg ? seg.cuts.length : 0;
        const lineId = ctx.line ? ctx.line.id : ctx.cut ? ctx.cut.line : null;
        const go = (scope) => app.select({ level: 'el', scope, el: 'ground' }, { from: 'crumbs' });
        const backdrop = OUT.effectiveBackdrop(doc());
        return h('div', { class: 'insp-note' },
          backdrop !== 'scene' ? h('p', { class: 'insp-banner', role: 'note' }, I.icon('info', { size: 14 }),
            h('span', { class: 'banner-text', text: t('insp.groundOff', { bg: t('exp.bg.' + backdrop) }) })) : null,
          h('p', { class: 'note subtle', text: t('insp.groundRun', { n }) }),
          h('div', { class: 'row-actions' },
            ctx.cuts[0] && ctx.scopeKind !== 'cut' && ctx.cuts.length === 1 ? null
              : ctx.cuts[0] ? h('button', { class: 'chip-btn', type: 'button', disabled: ctx.scopeKind === 'cut',
                on: { click: () => go('cut/' + ctx.cuts[0].key) } }, t('insp.groundCut')) : null,
            lineId ? h('button', { class: 'chip-btn', type: 'button', disabled: ctx.scopeKind === 'line', on: { click: () => go('line/' + lineId) } }, t('insp.groundLine')) : null,
            h('button', { class: 'chip-btn', type: 'button', disabled: ctx.scopeKind === 'work', on: { click: () => go('work') } }, t('insp.groundWork'))));
      },
      // 色 › [テーマの色に戻す] and 強さ › [雰囲気の値に戻す] (§6.4.5): clear the work pins of that family, one entry.
      colorsReset() { return resetButton('work:color.', 'insp.colorsReset', 'undo.colorsReset'); },
      amountsReset() { return resetButton('work:amount.', 'insp.amountsReset', 'undo.amountsReset'); },
      // 書体: the font-failure banner (§6.11).
      fontBanner() {
        if (!allWarnings().some((w) => w.code === 'font-fallback')) return null;
        return h('p', { class: 'insp-banner', role: 'status' }, I.icon('warn', { size: 14 }), t('insp.fontFailed'));
      },
      // 行 › 文字の記号: a locked line whose frozen split no longer fits (§3.6, §6.11) → tag + [ロックし直す].
      lockPartial(ctx) {
        const line = ctx.line;
        if (!line || !doc().locks[line.id] || !allWarnings().some((w) => w.code === 'lock-partial' && w.line === line.id)) return null;
        return h('div', { class: 'insp-banner' }, h('span', { class: 'state-tag is-warn' }, I.icon('lock', { size: 12 }), t('insp.lockPartial')),
          h('button', { class: 'chip-btn', type: 'button', on: { click: () => relock(line.id) } }, t('insp.relock')));
      },
      // 画面効果 under グリーンバック / 黒 / 透明 (§4.19.4, §6.4.8): the mode's rule, and the effects of this scope it leaves out.
      backdropNote(ctx) {
        const backdrop = OUT.effectiveBackdrop(doc());
        if (backdrop === 'scene') return null;
        const off = OUT.skippedFilters(plan(), app.reg, backdrop, ctx.scopeKind === 'work' ? null : ctx.cutKeys);
        return h('div', { class: 'insp-note' }, h('p', { class: 'note subtle', text: t('insp.fxRule.' + backdrop) }),
          off.length ? h('p', { class: 'note subtle is-skip', text: t('insp.fxSkippedHere', { list: listText(off.map((k) => app.label('filter', k))) }) }) : null);
      },
    };

    function allWarnings() { return (plan() ? plan().warnings : []).concat(app.warnings()); }

    function resetButton(prefix, label, undoLabel) {
      const paths = removablePaths(Object.keys(doc().pins).filter((p) => p.startsWith(prefix)));
      return h('div', { class: 'row-actions' }, h('button', { class: 'btn small', type: 'button', disabled: !paths.length,
        on: { click: () => run(paths.map((path) => ({ t: 'pin.clear', path })), { label: [undoLabel, {}] }) } }, t(label)));
    }

    // ロックし直す: freeze the line again from the current Plan. Its lock pins stay and the values that went back to
    // auto (the split that no longer fitted, and what follows from it) join them; lock.set replaces the line's lock pins.
    function relock(lineId) {
      const kept = {};
      for (const path of PINS.pinsUnder(doc().pins, 'line/' + lineId)) if (doc().pins[path].by === 'lock') kept[path] = doc().pins[path];
      const payload = app.svc.lockPayload(doc(), plan(), lineId, { registry: app.reg });
      const cmd = Object.assign({}, payload, { pins: Object.assign(kept, payload.pins), n: app.store.rev });
      app.dispatch(cmd, { label: ['undo.relock', {}] });
    }

    function reattach(w) {
      const p = plan();
      const line = p.lines.find((l) => l.id === w.line);
      if (!line) return;
      const from = P.scopeKey(w.path);
      const off = P.cutOffset(from.slice(4));
      const target = line.cuts.slice().sort((a, b) => Math.abs(P.cutOffset(a) - off) - Math.abs(P.cutOffset(b) - off))[0];
      if (!target) return;
      const moved = Object.keys(doc().pins).filter((path) => path.startsWith(from + ':'));
      const into = F.writeScope('cut/' + target, p);        // where the target's own pins live (§4.10.4)
      const cmds = [];
      for (const path of moved) {
        const pin = doc().pins[path];
        const to = into + path.slice(from.length);
        cmds.push({ t: 'pin.clear', path });
        cmds.push({ t: 'pin.set', path: to, v: pin.v, by: pin.by === 'lock' ? 'user' : pin.by, sig: app.svc.pinSig(p, target) });
      }
      app.batch({ label: ['undo.reattach', {}] }, cmds);
    }

    // 行 list: a virtual list (fixed row height) of every line; click drills down (§6.4.5).
    function linesList() {
      const p = plan();
      const lines = p ? p.lines : [];
      const inner = h('div', { class: 'vl-inner', style: { height: lines.length * LINE_ROW_PX } });
      const box = h('div', { class: 'vl', role: 'listbox', 'aria-label': t('sec.lines'), tabindex: '0',
        style: { height: Math.min(LINES_BOX_PX, Math.max(LINE_ROW_PX, lines.length * LINE_ROW_PX)) } }, inner);
      const warnLines = new Set(app.warnings().map((w) => w.line).filter(Boolean));
      const pinsOf = (id) => Object.keys(doc().pins).filter((path) => { try { return P.isUnder(path, 'line/' + id) && doc().pins[path].by !== 'lock'; } catch (e) { return false; } }).length;
      function paint() {
        const top = box.scrollTop;
        const first = Math.max(0, Math.floor(top / LINE_ROW_PX) - 4);
        const last = Math.min(lines.length, Math.ceil((top + box.clientHeight) / LINE_ROW_PX) + 4);
        const kids = [];
        for (let i = first; i < last; i++) {
          const l = lines[i];
          // grey = auto, bold' = pinned, LRC badge = the stamp in the text (a mark, not a pin; §3.5, §6.4.5)
          const src = l.by ? l.by.start : 'auto';
          const n = pinsOf(l.id);
          kids.push(h('button', { class: 'vl-row', type: 'button', role: 'option', style: { top: i * LINE_ROW_PX },
            'aria-label': t('insp.lineRow', { n: i + 1, time: T.fmtTime(l.t0), text: l.text }),
            on: { click: () => app.select({ level: 'line', ids: [l.id] }, { from: 'crumbs' }) } },
          h('span', { class: 'insp-num', text: String(i + 1) }),
          h('span', { class: ['mono', 'vl-time', src === 'pin' ? 'is-pinned' : src === 'lrc' ? 'is-mark' : ''],
            text: T.fmtTime(l.t0) + (src === 'pin' ? "'" : '') }),
          src === 'lrc' ? h('span', { class: 'g-badge', text: 'LRC' }) : null,
          h('span', { class: 'grow ell', text: l.text }),
          l.locked ? I.icon('lock', { size: 13 }) : null,
          n ? h('span', { class: 'g-pins', text: '●' + n }) : null,
          warnLines.has(l.id) ? h('span', { class: 'g-warn', text: '!' }) : null));
        }
        dom.replace(inner, kids);
      }
      box.addEventListener('scroll', paint);
      requestAnimationFrame(paint);
      paint();
      return box;
    }

    // 試した見た目: thumbnails of side.looks (rendered in idle slices on a forked engine), ★ keeps an entry (§6.4.5).
    const lookThumbs = new Map();
    function looksGrid() {
      const side = app.store.side;
      const list = side.looks && side.looks.list ? side.looks.list : [];
      if (!list.length) return h('p', { class: 'note subtle', text: t('insp.noLooks') });
      const ptr = LK.pointer(side, doc());
      const grid = h('div', { class: 'looks-grid' });
      const jobs = [];
      list.slice().reverse().forEach((e) => {
        const i = list.indexOf(e);
        const canvas = h('canvas', { class: 'look-thumb', width: 192, height: 108, 'aria-hidden': 'true' });
        const cur = ptr.index === i + 1;
        const star = h('button', { class: ['look-star', e.star ? 'is-on' : ''], type: 'button', 'aria-pressed': String(!!e.star),
          title: t('insp.star'), 'aria-label': t('insp.star'), on: { click: (ev) => { ev.stopPropagation(); app.store.setSide((s) => LK.toggleStar(s, e.n)); } } }, '★');
        grid.appendChild(h('div', { class: ['look-tile', cur ? 'is-current' : ''], 'data-n': String(e.n) },
          h('button', { class: 'look-pick', type: 'button', 'aria-current': cur ? 'true' : null,
            'aria-label': t('insp.lookN', { n: i + 1, scope: lookScope(e.scope), what: t.label(e.label) }),
            on: { click: () => app.dispatch(LK.restoreCmd(e), { label: ['undo.lookRestore', {}] }) } },
          canvas, h('span', { class: 'look-label', text: (i + 1) + ' · ' + lookScope(e.scope) })), star));
        jobs.push({ canvas, e });
      });
      paintLooks(jobs);
      return grid;
    }

    function lookScope(scope) {
      if (!scope || scope === 'work') return t('crumb.work');
      const sel = scope.startsWith('line/') ? { level: 'line', ids: [scope.slice(5)] } : { level: 'cut', key: scope.slice(4) };
      const cr = S.crumbs(sel, plan()).slice(1);
      return cr.length ? t.label(cr[cr.length - 1].label) : scope;
    }

    function paintLooks(jobs) {
      let fork = null;
      const step = () => {
        const job = jobs.shift();
        if (!job) return;
        if (job.canvas.isConnected) {
          const key = [job.e.seed, job.e.moodSeed, JSON.stringify(job.e.salts), doc().look.aspect, plan() ? plan().hash : ''].join('|');
          let img = lookThumbs.get(key);
          if (!img) {
            img = document.createElement('canvas');
            img.width = 192; img.height = 108;
            try {
              fork = fork || app.engine.fork();
              const d = app.reduce(doc(), LK.restoreCmd(job.e));
              fork.setDoc(d);
              const fp = fork.plan;
              const cut = fp && fp.cuts.find((c) => c.line) || null;
              fork.renderFrame({ canvas: img, ctx: img.getContext('2d'), w: 192, h: 108 }, cut ? cut.repT : 0.5,
                { scale: 192 / fp.design.w, quality: 'preview' });
            } catch (e) { /* the tile stays blank */ }
            lookThumbs.set(key, img);
            if (lookThumbs.size > 60) lookThumbs.delete(lookThumbs.keys().next().value);
          }
          const g = job.canvas.getContext('2d');
          g.drawImage(img, 0, 0, job.canvas.width, job.canvas.height);
        }
        if (jobs.length) (typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 16))(step);
      };
      (typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn) => setTimeout(fn, 16))(step);
    }

    // --- building and refreshing the page ------------------------------------------------------------------------

    function sectionOpen(ctx, s) {
      const m = openState.get(ctx.page);
      return m && m.has(s.id) ? m.get(s.id) : s.open;
    }

    function setSectionOpen(ctx, id, on) {
      if (!openState.has(ctx.page)) openState.set(ctx.page, new Map());
      openState.get(ctx.page).set(id, on);
    }

    function scrollTop() {
      const scroller = host.closest('.panel-body');
      if (scroller) scroller.scrollTop = 0;
    }

    function build(ctx, sections, sig) {
      const rows = [];
      forgetFocus();
      if (!page || JSON.stringify(page.ctx.sel) !== JSON.stringify(ctx.sel)) scrollTop();
      page = { sig, ctx, rows, customs: [] };
      shadowTold = null;
      const els = sections.map((s) => {
        const open = sectionOpen(ctx, s);
        const body = h('div', { class: 'isec-body', hidden: !open });
        const head = h('button', { class: 'isec-head', type: 'button', 'aria-expanded': String(open) },
          I.icon('next', { size: 14 }), h('span', { text: t.label(s.label) }));
        head.addEventListener('click', () => {
          const on = body.hidden;
          body.hidden = !on;
          head.setAttribute('aria-expanded', String(on));
          setSectionOpen(ctx, s.id, on);
          if (on) refreshCustoms();
        });
        const basic = [], advanced = [];
        let group = null;
        for (const f of s.fields) {
          const row = makeRow(f, ctx);
          rows.push(row);
          if (f.group && f.group !== group) {
            group = f.group;
            const key = F.agreedKey(ctx, f.group);
            (f.basic ? basic : advanced).push(h('div', { class: 'isec-group', text: t('kind.' + f.group) + (key ? ' · ' + app.label(f.group, key) : '') }));
          }
          (f.basic ? basic : advanced).push(row.el);
        }
        body.append(...basic);
        if (advanced.length) {
          body.appendChild(h('details', { class: 'isec-more' }, h('summary', { text: t('insp.advanced', { n: advanced.filter((x) => x.classList.contains('frow')).length }) }),
            advanced));
        }
        if (s.custom) {
          const slotEl = h('div', { class: 'isec-custom', 'data-custom': s.custom });
          if (s.customTop) body.prepend(slotEl); else body.appendChild(slotEl);
          page.customs.push({ id: s.custom, el: slotEl, body, head });
        }
        return h('section', { class: 'isec', 'data-sec': s.id }, head, body);
      });
      if (!els.length) els.push(h('p', { class: 'note subtle', text: t('insp.nothing') }));
      dom.replace(bodyEl, els);
      refresh();
    }

    function refreshCustoms() {
      const ctx = page.ctx;
      for (const c of page.customs) {
        if (c.body.hidden) continue;
        const active = c.el.contains(document.activeElement) ? document.activeElement : null;
        if (active && !REDRAW_FOCUSED.has(c.id)) continue;
        // 試した見た目 is redrawn even with focus inside (the current tile moves); focus returns to the same entry.
        const keep = active && active.closest('[data-n]') ? { n: active.closest('[data-n]').dataset.n, cls: active.className.split(' ')[0] } : null;
        const scroll = c.el.querySelector('.vl') ? c.el.querySelector('.vl').scrollTop : 0;
        page.rows = page.rows.filter((r) => !c.el.contains(r.el));
        const el = customOf(c.id, ctx);
        dom.replace(c.el, el);
        const vl = c.el.querySelector('.vl');
        if (vl && scroll) { vl.scrollTop = scroll; vl.dispatchEvent(new Event('scroll')); }
        if (keep) dom.focus(c.el.querySelector('[data-n="' + keep.n + '"] .' + keep.cls) || c.el.querySelector('[data-n="' + keep.n + '"] button'));
        else if (active) dom.focus(c.el.querySelector('button:not(:disabled)') || c.head);
      }
    }

    function refresh() {
      const ctx = page.ctx;
      refreshCustoms();
      const fsMap = statesFor(page.rows, ctx);
      for (const row of page.rows) updateRow(row, row.path ? fsMap.get(row.path) : null, ctx);
    }

    function findRow(slot) { return page ? page.rows.find((r) => r.field.path === slot || r.field.key === slot) : null; }

    function flashField(slot) {
      const row = findRow(slot);
      if (!row) return;
      row.el.scrollIntoView({ block: 'nearest' });
      row.el.classList.add('is-flash');
      setTimeout(() => row.el.classList.remove('is-flash'), FLASH_MS);
    }

    function render() {
      if (!visible()) { dirty = true; return; }
      dirty = false;
      const sel = S.validate(app.view.state.sel, plan());
      const ctx = F.contextOf(sel, plan(), app.reg);
      // Pinned parameters of parts that are no longer chosen stay listed (無効), never hidden (§3.4).
      const sections = F.withPinnedParams(F.sectionsFor(sel, plan(), app.reg), ctx, F.pinnedSlots(ctx, doc().pins));
      const sig = JSON.stringify(sel) + '|' + sections.map((s) => s.id + ':' + s.fields.map((f) => f.id).join(',')).join(';');
      renderCrumbs();
      renderHead(ctx);
      if (!page || page.sig !== sig) build(ctx, sections, sig);
      else { page.ctx = ctx; refresh(); }
    }

    // --- wiring ------------------------------------------------------------------------------------------------------

    const soon = dom.createBatcher(() => render());
    app.bus.on('plan', () => { for (const pg of stack) if (pg.refresh) pg.refresh(); soon('plan'); });
    app.bus.on('side', () => soon('side'));
    app.view.on((changed, state) => {
      // Sub-pages live inside 詳細: closing it, or switching the column to AI, closes them (and ends their try-on).
      if (changed.includes('panel') && state.panel !== 'details') { clearStack(); forgetFocus(); }
      if (changed.includes('sel')) {
        const inside = host.contains(document.activeElement);
        forgetFocus();
        clearStack();
        render();
        // Focus follows a drill made from inside the inspector (§6.12); never into the text box, so single keys still work.
        if (inside) { const target = headEl.querySelector('.lh-title') || headEl.querySelector('.lh-btn'); if (target) dom.focus(target); }
      } else if (changed.includes('panel') || changed.includes('prefs')) { if (state.panel === 'details' || dirty) soon('panel'); }
    });
    app.bus.on('layout', () => { if (dirty) soon('layout'); });
    app.store.on('doc', (e) => {
      if ((e.kind === 'undo' || e.kind === 'redo') && e.where && e.where.field) {
        requestAnimationFrame(() => requestAnimationFrame(() => flashField(e.where.field)));
      }
    });
    // Double-click on the preview text goes to the element and focuses the line text for editing (§6.5).
    if (app.shell && app.shell.stage && app.shell.stage.element) {
      app.shell.stage.element.addEventListener('dblclick', () => {
        requestAnimationFrame(() => { const input = headEl.querySelector('.lh-input'); if (input) { dom.focus(input); input.select(); } });
      });
    }

    const def = (id, fn) => { if (!app.actions.has(id)) app.actions.defineAction({ id, label: 'cmd.' + id, run: fn }); };
    def('picker.move', (c, a) => (inPicker() ? stack[stack.length - 1].move(a ? a.dx : 0, a ? a.dy : 0) !== false : false));
    def('picker.pick', () => (inPicker() ? stack[stack.length - 1].pick() : false));
    def('picker.back', () => (inPicker() ? pop() : false));

    // Opens one section of the current page and scrolls to it (e.g. 試した見た目 from the play bar's n/m).
    function openSection(id) {
      const sel = S.validate(app.view.state.sel, plan());
      setSectionOpen({ page: F.pageOf(sel, plan()) }, id, true);
      if (page) page.sig = null;
      render();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const sec = bodyEl.querySelector('[data-sec="' + id + '"]');
        if (sec) sec.scrollIntoView({ block: 'start' });
      }));
    }

    render();
    return {
      render, push, pop, clearStack, openFilter, openSection, showWhy: () => showWhy(lastRow, true), flashField,
      rows: () => (page ? page.rows.map((r) => ({ id: r.field.id, path: r.path, paths: r.paths.slice(), state: r.fs ? r.fs.state : null,
        unpin: !!r.x && !r.x.hidden, why: r.why.hidden ? null : r.why.textContent })) : []),
      stackSize: () => stack.length,
    };
  }

  return { mount };
});
