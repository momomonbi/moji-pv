/* 文字PVメーカー v2 — original work. Command palette (Ctrl+K): actions, @line / @time jumps, #kind part pins, ? help (DESIGN §6.4.12). */
MV.def('ui/palette', ['ui/dom', 'ui/icons', 'ui/keys', 'ui/selection', 'i18n/strings', 'i18n/t', 'ui/playbar', 'ui/fields'],
  (dom, I, K, S, STRINGS, T, PB, F) => {
    'use strict';

    const { h } = dom;
    const WIDTH = 600;
    const LIMIT = 60;
    const RECENT_KEY = 'mojipv.palette.recent';
    const RECENT_MAX = 8;
    const PART_KINDS = ['arrange', 'arrive', 'dwell', 'depart', 'ornament', 'ground', 'lens', 'filter', 'seam', 'mood', 'theme'];
    // Actions that need a context the palette cannot give (a mode, a focused editor, a held key) are not listed.
    const HIDDEN = new Set(['tap.mark', 'tap.end', 'tap.back', 'tap.seek', 'tap.pause', 'tap.finish', 'palette.open', 'palette.move',
      'palette.run', 'palette.close', 'picker.move', 'picker.pick', 'picker.back', 'timeline.nudge', 'lyrics.moveRows', 'lyrics.emphasis',
      'view.compare', 'seek.step', 'sel.line', 'sel.cut', 'sel.down', 'sel.up', 'region.next', 'region.prev', 'export.cancel', 'step.go',
      'view.quality']);
    const STEPS = ['lyrics', 'song', 'look', 'export'];
    // An empty query lists what a first visit needs first (after the recent commands); settings and the language switch
    // are always last, so Ctrl+K then Enter never flips a setting.
    const STARTERS = ['look.omakase', 'play.toggle', 'panel.details', 'step.go:lyrics', 'step.go:song', 'step.go:look',
      'step.go:export', 'timeline.toggle', 'tap.start', 'export.start', 'help.keys'];
    const isSetting = (id) => id.startsWith('pref.') || id === 'app.lang';

    // order(items, recent, query) → the palette's row order: settings last; then recent first; with an empty query the
    // starters next, in their order; ties by label.
    function order(items, recent, query) {
      const empty = !String(query || '').trim();
      const tier = (x) => {
        if (isSetting(x.id)) return [3, 0];
        const r = recent.indexOf(x.id);
        if (r >= 0) return [0, r];
        const s = empty ? STARTERS.indexOf(x.id) : -1;
        return s >= 0 ? [1, s] : [2, 0];
      };
      return items.map((x) => ({ x, k: tier(x) })).sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1]
        || (a.x.text < b.x.text ? -1 : a.x.text > b.x.text ? 1 : 0)).map((e) => e.x);
    }
    // Romaji search aliases (never shown), so 'omakase' finds おまかせ on any keyboard layout.
    const ALIASES = {
      'look.omakase': 'omakase', 'play.toggle': 'saisei teishi', 'edit.undo': 'modosu undo', 'edit.redo': 'yarinaosu redo',
      'look.reroll': 'furinaosu', 'lock.toggle': 'rokku', 'export.start': 'kakidasu kakidashi', 'panel.details': 'shousai syousai',
      'panel.ai': 'eeai', 'timeline.toggle': 'taimurain', 'file.save': 'hozon', 'file.saveAs': 'namae hozon', 'file.open': 'hiraku',
      'file.new': 'atarashiku shinki', 'tap.start': 'tappu awaseru', 'look.prev': 'mae', 'look.next': 'tsugi', 'looks.open': 'tameshita',
      'help.keys': 'kibodo shotokatto', 'help.about': 'raisensu', 'audio.mute': 'myuto oto', 'stage.fullscreen': 'zengamen',
      'pin.clearSelection': 'kotei hazusu', 'pin.clearField': 'kotei hazusu', 'look.copy': 'kopi', 'look.paste': 'haritsuke',
      'time.pinStart': 'kaishi kotei', 'range.in': 'hani', 'range.out': 'hani', 'file.saveLrc': 'lrc', 'lyrics.bakeTimes': 'jikoku kakikomu',
      'edit.history': 'rireki', 'help.syntax': 'kihou', 'app.lang': 'gengo english nihongo', 'look.details': 'kuwashiku',
      'play.fromLine': 'kono gyou saisei', 'view.foldSteps': 'tatamu', 'pref.safeArea': 'anzen waku', 'ai.prep': 'shitagoshirae',
      'ai.looks': 'sanan', 'ai.align': 'taimingu',
    };

    function norm(s) { return String(s || '').toLowerCase().normalize('NFKC'); }

    function readRecent() {
      try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
      catch (e) { return []; }
    }
    function writeRecent(list) { try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* not kept */ } }

    function mount(app) {
      const t = app.t;
      const input = h('input', { class: 'pal-input', type: 'text', spellcheck: false, role: 'combobox', 'aria-expanded': 'true',
        'aria-controls': 'pal-list', 'aria-autocomplete': 'list', 'aria-label': t('pal.label'), placeholder: t('pal.placeholder') });
      const list = h('div', { class: 'pal-list', id: 'pal-list', role: 'listbox', 'aria-label': t('pal.label') });
      const hint = h('div', { class: 'pal-hint', text: t('pal.hint') });
      const box = h('div', { class: 'palette', hidden: true, role: 'dialog', 'aria-label': t('cmd.palette.open') },
        h('div', { class: 'pal-row' }, I.icon('menu', { size: 16 }), input), list, hint);
      document.body.appendChild(box);
      let items = [];
      let at = 0;
      let before = null;
      let recent = readRecent();

      // --- items ---------------------------------------------------------------------------------------------------

      function labelsOf(id) {
        const pair = STRINGS['cmd.' + id];
        return pair ? [pair[0], pair[1]] : [id, id];
      }

      function matches(words, hay) { return words.every((w) => hay.includes(w)); }

      function actionItems(q) {
        const words = norm(q).split(/\s+/).filter(Boolean);
        const out = [];
        for (const a of app.actions.list()) {
          if (HIDDEN.has(a.id) || !t.has('cmd.' + a.id)) continue;
          const [ja, en] = labelsOf(a.id);
          if (words.length && !matches(words, norm([ja, en, a.id, ALIASES[a.id] || ''].join(' ')))) continue;
          out.push({ id: a.id, text: t('cmd.' + a.id), keys: a.keys.length ? K.display(a.keys[0], { space: t('key.space') }) : '',
            disabled: !a.enabled, checked: a.checked, run: () => app.actions.run(a.id, { from: 'palette' }) });
        }
        STEPS.forEach((step, i) => {
          const text = t('pal.step', { step: t('step.' + step) });
          if (words.length && !matches(words, norm(text + ' tejun step ' + step))) return;
          out.push({ id: 'step.go:' + step, text, keys: String(i + 1), run: () => app.goStep(step) });
        });
        return order(out, recent, q);
      }

      // @12 → line 12; @1:23 / @83.5 → a time.
      function jumpItems(q) {
        const s = q.trim();
        const plan = app.plan;
        if (!s) return [{ text: t('pal.jumpHelp'), disabled: true }];
        if (/^\d+$/.test(s) && plan) {
          const line = plan.lines[Number(s) - 1];
          if (line) {
            return [{ text: t('pal.jumpLine', { n: Number(s), text: line.text }), run: () => app.select({ level: 'line', ids: [line.id] },
              { from: 'key', seek: true }) }];
          }
        }
        const tt = PB.parseTime(s);
        if (tt !== null && plan) return [{ text: t('pal.jumpTime', { time: T.fmtTime(Math.min(tt, plan.duration)) }), run: () => app.seek(tt) }];
        return [{ text: t('pal.noMatch'), disabled: true }];
      }

      // #入り 墨のぼり → pin that part on the selection.
      function partItems(q) {
        const reg = app.reg;
        const [kindWord, ...rest] = q.trim().split(/\s+/);
        const kw = norm(kindWord || '');
        const pw = norm(rest.join(' '));
        const out = [];
        for (const kind of PART_KINDS) {
          const kindText = t('kind.' + kind);
          const kindHay = norm([STRINGS['kind.' + kind][0], STRINGS['kind.' + kind][1], kind].join(' '));
          if (kw && !kindHay.includes(kw)) continue;
          for (const key of reg.keys(kind)) {
            const def = reg.get(kind, key);
            if (def.pool === false || (kind === 'ornament' && def.scope === 'run')) continue;
            if (pw && !norm([def.label.ja, def.label.en, key].join(' ')).includes(pw)) continue;
            out.push({ text: t('pal.pin', { kind: kindText, part: app.label(kind, key) }), run: () => pinPart(kind, key) });
            if (out.length >= LIMIT) return out;
          }
        }
        return out.length ? out : [{ text: t('pal.noMatch'), disabled: true }];
      }

      function pinPart(kind, key) {
        const plan = app.plan;
        const sel = S.validate(app.view.state.sel, plan);
        const work = kind === 'mood' || kind === 'theme';
        const scopes = work ? ['work'] : sel.level === 'line' ? sel.ids.map((id) => 'line/' + id) : [S.scopeOf(sel, plan)];
        const slot = kind === 'ornament' || kind === 'filter' ? kind + '#0' : kind;
        const cmds = scopes.map((scope) => F.pinCmd(scope + ':' + slot, key, plan, app.svc.pinSig));
        app.batch({ label: ['undo.pin', { field: t('kind.' + kind), scope: t.label(S.crumbs(sel, plan).slice(-1)[0].label) }] }, cmds);
      }

      function helpItems() {
        return [
          { text: t('pal.help.actions'), disabled: true }, { text: t('pal.help.jump'), disabled: true },
          { text: t('pal.help.part'), disabled: true },
          { text: t('cmd.help.keys'), keys: '?', run: () => app.actions.run('help.keys') },
        ];
      }

      function compute(q) {
        if (q.startsWith('@')) return jumpItems(q.slice(1));
        if (q.startsWith('#')) return partItems(q.slice(1));
        if (q.startsWith('?')) return helpItems();
        return actionItems(q.startsWith('>') ? q.slice(1) : q).slice(0, LIMIT);
      }

      function render() {
        items = compute(input.value);
        at = Math.max(0, Math.min(at, items.length - 1));
        const firstRunnable = items.findIndex((x) => x.run && !x.disabled);
        if (items[at] && (!items[at].run || items[at].disabled) && firstRunnable >= 0) at = firstRunnable;
        dom.replace(list, items.map((x, i) => h('div', {
          class: ['pal-item', i === at ? 'is-on' : '', x.disabled ? 'is-off' : ''], role: 'option', id: 'pal-opt-' + i,
          'aria-selected': String(i === at), 'aria-disabled': x.disabled ? 'true' : null,
          on: { pointerdown: (ev) => ev.preventDefault(), click: () => { at = i; runAt(); } },
        }, h('span', { class: 'pal-check', 'aria-hidden': 'true' }, x.checked ? I.icon('check', { size: 14 }) : null),
        h('span', { class: 'pal-text', text: x.text }), x.keys ? h('kbd', { text: x.keys }) : null)));
        input.setAttribute('aria-activedescendant', items.length ? 'pal-opt-' + at : '');
        const on = list.children[at];
        if (on) on.scrollIntoView({ block: 'nearest' });
      }

      function runAt() {
        const x = items[at];
        if (!x || !x.run || x.disabled) return false;
        close();
        if (x.id) {
          recent = [x.id].concat(recent.filter((r) => r !== x.id)).slice(0, RECENT_MAX);
          writeRecent(recent);
        }
        x.run();
        // A setting changed from the palette says so, and where to change it back.
        if (x.id && x.id.startsWith('pref.')) {
          const now = app.actions.list((d) => d.id === x.id)[0];
          app.toast(t(now && now.checked ? 'pal.prefOn' : 'pal.prefOff', { name: x.text }), { kind: 'info' });
        }
        return true;
      }

      // --- open / close ---------------------------------------------------------------------------------------------

      function placeBox() {
        const stage = document.querySelector('.region-stage');
        const r = stage ? stage.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth };
        const w = Math.min(WIDTH, Math.max(280, r.width - 24));
        dom.setStyle(box, { width: w, left: r.left + (r.width - w) / 2, top: r.top + 12 });
      }

      function open(prefix) {
        if (app.popover) app.popover.close();
        before = document.activeElement;
        box.hidden = false;
        app.paletteOpen = true;
        input.value = prefix || '';
        at = 0;
        placeBox();
        render();
        dom.focus(input);
        return true;
      }

      function close() {
        if (box.hidden) return false;
        box.hidden = true;
        app.paletteOpen = false;
        if (before && before.isConnected && before !== document.body) dom.focus(before);
        return true;
      }

      input.addEventListener('input', () => { at = 0; render(); });
      input.addEventListener('blur', () => setTimeout(() => { if (!box.contains(document.activeElement)) close(); }, 0));

      const def = (id, run) => { if (!app.actions.has(id)) app.actions.defineAction({ id, label: 'cmd.' + id, run }); };
      def('palette.open', (c, a) => open(a && a.prefix ? a.prefix : ''));
      def('palette.close', () => close());
      def('palette.move', (c, a) => {
        if (!items.length) return true;
        at = (at + (a && a.d < 0 ? items.length - 1 : 1)) % items.length;
        render();
        return true;
      });
      def('palette.run', () => { runAt(); return true; });

      return { open, close, isOpen: () => !box.hidden, items: () => items.map((x) => x.text) };
    }

    return { mount, ALIASES, STARTERS, order };
  });
