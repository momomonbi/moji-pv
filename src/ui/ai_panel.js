/* 文字PVメーカー v2 — original work. The AI panel (tab AI of the detail column): connection, what is sent, guide, tools with the instruction block, the board, running, review, log (DESIGN §6.4.10; DESIGN_2_1 §6.2–§6.4). */
MV.def('ui/ai_panel', ['ui/dom', 'ui/icons', 'ai/providers', 'ai/changes', 'ui/ai_controller', 'ui/ai_review', 'ui/ai_thinking',
  'ui/ai_board', 'planner/areas', 'ui/fields', 'ui/selection', 'i18n/t'],
  (dom, I, PR, CH, AC, AR, AT, BOARD, AREAS, F, S, T) => {
    'use strict';

    const { h } = dom;
    const TICK_MS = 1000;                 // the elapsed time of a running request
    const CHIPS = Object.freeze(['season', 'slow', 'ramp', 'push', 'material']);   // ai.chip.* → ai.chipText.*
    const TARGETS = Object.freeze(['work', 'sel', 'area']);

    // The areas the 区画▾ list offers (DESIGN_2_1 §6.2): song sections, all sections of a kind, headings, blocks, and the
    // selected cut. → [{ group, items: [{ ref, area }] }], empty groups left out.
    function areaGroups(doc, plan, sel) {
      if (!plan) return [];
      const all = AREAS.areasOf(doc, plan);
      const out = [];
      const song = all.song.concat(all.kinds);
      if (song.length) out.push({ group: 'song', items: song.map((area) => ({ ref: area.ref, area })) });
      if (all.heads.length) out.push({ group: 'head', items: all.heads.map((area) => ({ ref: area.ref, area })) });
      if (all.paras.length) out.push({ group: 'para', items: all.paras.map((area) => ({ ref: area.ref, area })) });
      const s = S.validate(sel, plan, doc);
      if (s.level === 'cut') {
        const area = AREAS.resolve(doc, plan, { kind: 'cut', key: s.key });
        if (area) out.push({ group: 'sel', items: [{ ref: area.ref, area }] });
      }
      return out;
    }

    // 「サビ1 · 0:41–1:02 · 5行」: the target chip and the list rows.
    function areaLine(t, area) {
      const time = (x) => T.fmtTime(x).replace(/\.\d+$/, '');
      const parts = [F.areaLabel(t, area)];
      if (area.kind !== 'work') parts.push(time(area.t0) + '–' + time(area.t1));
      parts.push(area.n ? t('count.lines', { n: area.n }) : '—');
      return parts.join(' · ');
    }

    function storageOf(kind) {
      try { const s = window[kind]; s.getItem('mojipv.probe'); return s; } catch (e) { return null; }
    }

    // The app as the controller sees it (ui/ai_controller createController's host).
    function hostOf(app) {
      return {
        t: app.t, lang: app.lang, registry: app.reg,
        get doc() { return app.doc; },
        get plan() { return app.plan; },
        get rev() { return app.store.rev; },
        get side() { return app.store.side; },
        batch: (meta, cmds) => app.batch(meta, cmds),
        setSide: (fn) => app.store.setSide(fn),
        undo: () => app.actions.run('edit.undo'),
        toast: (text, opts) => app.toast(text, opts),
        setReviewOpen: (on) => setReviewOpen(app, on),
        tryOn: (doc, badge) => app.tryOn(doc, badge),
        altShown: () => !!(app.shell && app.shell.stage.hasAlt()),
        song: () => songOf(app),
        now: () => Date.now(),
        nextFrame: () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
      };
    }

    // A review is shown in the AI tab and locks 詳細 (§6.4.10.6). The user may have switched to 詳細 (or closed the
    // column) while the request ran, so an opening review brings the AI tab up: the inspector is never left on screen,
    // editable, behind a disabled tab.
    function setReviewOpen(app, on) {
      app.view.set({ aiReview: !!on, highlight: null });
      if (on && app.view.state.panel !== 'ai') app.openPanel('ai', 'ai');
    }

    // doc.song with its decoded audio when that is the same song (the buffer is null until it is re-linked).
    function songOf(app) {
      const s = app.doc.song;
      if (!s) return null;
      const ready = typeof app.songReady === 'function' ? app.songReady() : !!app.buffer;
      const buffer = ready ? app.buffer : null;
      return { sha1: s.sha1, seconds: buffer ? buffer.duration : s.seconds, buffer };
    }

    // ---- the connection card (§6.4.10.1) ------------------------------------------------------------------------

    function connectionCard(app, ctl) {
      const t = app.t;
      const ids = { key: 'ai-key-input', service: 'ai-service', model: 'ai-model' };
      const service = h('select', { class: 'select', id: ids.service },
        Object.keys(PR.PROVIDERS).map((p) => h('option', { value: p, text: PR.PROVIDERS[p].label })));
      const model = h('select', { class: 'select', id: ids.model });
      const key = h('input', { class: 'text-input', id: ids.key, type: 'password', autocomplete: 'off', spellcheck: false,
        placeholder: t('ai.conn.keyPlaceholder'), 'aria-describedby': 'ai-key-state ai-key-hint' });
      const show = h('button', { class: 'btn small', type: 'button', 'data-ctl': 'show', 'aria-pressed': 'false', 'aria-controls': ids.key, text: t('ai.conn.show') });
      const hint = h('div', { class: 'ai-key-hint', id: 'ai-key-hint' });
      const check = h('button', { class: 'btn small', type: 'button', 'data-ctl': 'check', text: t('ai.conn.check') });
      const stateTag = h('span', { class: 'state-tag ai-key-state', id: 'ai-key-state', role: 'status' });
      const remember = h('input', { type: 'checkbox', 'data-ctl': 'remember' });
      const makeKey = h('a', { class: 'link', target: '_blank', rel: 'noopener noreferrer', text: t('ai.conn.makeKey') });
      const forget = h('button', { class: 'link', type: 'button', 'data-ctl': 'forget', text: t('ai.conn.forget') });
      const lineText = h('span', { class: 'ai-conn-name' });
      const lineTag = h('span', { class: 'state-tag', 'data-state': 'ai' });
      const change = h('button', { class: 'link', type: 'button', 'data-ctl': 'change', text: t('ai.conn.change'), 'aria-expanded': 'false' });
      const line = h('div', { class: 'ai-conn-line' }, I.icon('ai', { size: 16 }), lineText, lineTag, h('span', { class: 'grow' }), change);
      const body = h('div', { class: 'ai-conn-body' },
        h('h3', { class: 'ai-h', text: t('ai.conn.title') }),
        h('div', { class: 'field' }, h('label', { class: 'field-label', htmlFor: ids.service, text: t('ai.conn.service') }), service),
        h('div', { class: 'field' }, h('label', { class: 'field-label', htmlFor: ids.model, text: t('ai.conn.model') }), model),
        h('div', { class: 'field' }, h('label', { class: 'field-label', htmlFor: ids.key, text: t('ai.conn.key') }),
          h('div', { class: 'field-row' }, key, show), hint),
        h('div', { class: 'field-row' }, check, stateTag),
        h('p', { class: 'note subtle', text: t('ai.conn.freeCheck') }),
        h('label', { class: 'check-row' }, remember, h('span', { text: t('ai.conn.remember') })),
        h('div', { class: 'row-actions' }, makeKey, forget));
      const root = h('section', { class: 'ai-sec ai-conn', 'aria-label': t('ai.conn.title') }, line, body);
      let open = null;                   // null: follow the key state (collapsed once it works); true / false: by hand

      service.addEventListener('change', () => ctl.setProvider(service.value));
      model.addEventListener('change', () => ctl.setModel(model.value));
      key.addEventListener('input', () => ctl.setKey(key.value));
      key.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229) { ev.preventDefault(); ctl.checkKey(); }
      });
      show.addEventListener('click', () => {
        const visible = key.type === 'password';
        key.type = visible ? 'text' : 'password';
        show.textContent = visible ? t('ai.conn.hide') : t('ai.conn.show');
        show.setAttribute('aria-pressed', String(visible));
      });
      check.addEventListener('click', () => { ctl.checkKey(); });
      remember.addEventListener('change', () => ctl.setRemember(remember.checked));
      forget.addEventListener('click', () => {
        ctl.forgetKey();
        app.toast(t('ai.conn.forgotten'));
        dom.focus(key);
      });
      change.addEventListener('click', () => { open = true; update(ctl.state); dom.focus(service); });

      function update(st) {
        const p = PR.PROVIDERS[st.provider];
        if (service.value !== st.provider) service.value = st.provider;
        if (model.dataset.provider !== st.provider) {
          dom.replace(model, p.models.map((m) => h('option', { value: m, text: m })));
          model.dataset.provider = st.provider;
        }
        if (model.value !== st.model) model.value = st.model;
        if (key.value.trim() !== st.key) key.value = st.key;
        const running = !!st.run;
        service.disabled = running;
        model.disabled = running;
        check.disabled = !st.key || st.keyStatus === 'checking';
        forget.disabled = !st.key;
        remember.checked = st.remember;
        makeKey.href = p.keyUrl;
        stateTag.textContent = t('ai.key.' + st.keyStatus);
        stateTag.dataset.state = st.keyStatus;
        const hints = [];
        if (st.keyStatus === 'shape') hints.push(t('ai.conn.shapeHint', { service: p.label, prefix: ctl.keyPrefix() }));
        if (st.keyError && st.keyError !== 'aborted') hints.push(st.keyError === 'internal' ? t('ai.error.internal') : t.err(st.keyError));
        hint.textContent = hints.join(' ');
        hint.hidden = !hints.length;
        const collapsed = open === null ? st.keyStatus === 'ok' : !open;
        body.hidden = collapsed;
        line.hidden = !collapsed;
        change.setAttribute('aria-expanded', String(!collapsed));
        lineText.textContent = t('ai.conn.summary', { service: p.label, model: st.model });
        lineTag.textContent = t('ai.key.' + st.keyStatus);
        lineTag.dataset.state = st.keyStatus;
        root.dataset.state = st.keyStatus;
      }

      return {
        root, update, keyInput: key,
        // After a check succeeds, the card follows the key state again (it collapses).
        release() { open = null; },
      };
    }

    // ---- what is sent and the guide (§6.4.10.2, SPEC §8) -----------------------------------------------------------

    function noticeBlock(t) {
      const more = h('p', { class: 'note subtle', id: 'ai-sends-more', hidden: true, text: t('ai.sendsMore') });
      const btn = h('button', { class: 'link', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'ai-sends-more',
        text: t('ai.sendsMoreBtn') });
      btn.addEventListener('click', () => {
        more.hidden = !more.hidden;
        btn.setAttribute('aria-expanded', String(!more.hidden));
      });
      return h('div', { class: 'ai-sends', role: 'note' },
        h('div', { class: 'ai-sends-line' }, I.icon('info', { size: 15 }), h('span', { class: 'grow', text: t('ai.sends') }), btn), more);
    }

    function guideBlock(t) {
      return h('details', { class: 'ai-guide' }, h('summary', { text: t('ai.guide.title') }),
        h('ul', {}, AC.GUIDE_TOPICS.map((k) => h('li', { text: t('ai.guide.' + k) }))));
    }

    // ---- tools (§6.4.10.3) ------------------------------------------------------------------------------------------

    function toolButton(t, tool, icon, hint) {
      return h('button', { class: 'btn wide tall ai-tool', type: 'button', 'data-tool': tool },
        I.icon(icon, { size: 17 }), h('span', { class: 'btn-main', text: t('ai.tool.' + tool) }),
        hint ? h('span', { class: 'btn-hint', text: t(hint) }) : null);
    }

    // 指示 (DESIGN_2_1 §6.2; it replaces ひとこと修正): 対象 [全体|選択中|区画▾] with the target chip, the instruction
    // (300 characters, Enter sends), phrase chips, ▸ 詳しく (新しい素材を作ってもよい), [カメラワークをAIに任せる], [送る],
    // and 区画ごとに頼む… (the board).
    function directBlock(app, ctl, openBoard) {
      const t = app.t;
      let target = { mode: 'work', ref: null };
      let listOpen = false;
      const segs = TARGETS.map((m) => h('button', { class: 'seg', type: 'button', role: 'radio', 'data-target': m, tabindex: '-1',
        'aria-checked': 'false' }, m === 'area' ? [t('ai.direct.area'), h('span', { 'aria-hidden': 'true', text: ' ▾' })] : t('ai.direct.' + m)));
      const seg = h('div', { class: 'segmented ai-targets', role: 'radiogroup', 'aria-label': t('ai.direct.target') }, segs);
      const list = h('div', { class: 'ai-area-list', role: 'listbox', id: 'ai-area-list', 'aria-label': t('ai.direct.area'), hidden: true });
      const chipText = h('span', { class: 'grow ell ai-chip-text' });
      const chipX = h('button', { class: 'icon-btn small', type: 'button', title: t('ai.direct.clearTarget'), 'aria-label': t('ai.direct.clearTarget') },
        I.icon('close', { size: 12 }));
      const chip = h('div', { class: 'ai-target-chip', hidden: true, role: 'status' }, h('span', { class: 'ai-diamond', 'aria-hidden': 'true', text: '◆' }),
        chipText, chipX);
      const text = h('textarea', { class: 'ai-text', id: 'ai-direct-text', rows: '2', maxlength: String(AC.MAX_INSTRUCTION),
        placeholder: t('ai.direct.placeholder'), 'aria-describedby': 'ai-direct-hint', 'aria-label': t('ai.tool.direct') });
      const counter = h('span', { class: 'ai-count muted' });
      const chips = h('div', { class: 'chips ai-chips', role: 'group', 'aria-label': t('ai.direct.phrases') },
        CHIPS.map((c) => h('button', { class: 'chip', type: 'button', 'data-chip': c, text: t('ai.chip.' + c) })));
      const allow = h('input', { type: 'checkbox', 'data-ctl': 'allowMaterials' });
      const more = h('details', { class: 'ai-direct-more' }, h('summary', { text: t('ai.direct.more') }),
        h('label', { class: 'check-row' }, allow, h('span', { text: t('ai.direct.allowMaterials') })));
      const camera = h('button', { class: 'btn small', type: 'button', 'data-tool': 'camera', text: t('ai.camera.run') });
      const send = h('button', { class: 'btn small primary', type: 'button', 'data-tool': 'direct', text: t('ai.direct.send') });
      const board = h('button', { class: 'link ai-board-link', type: 'button', text: t('ai.board.open') });
      const questions = h('div', { class: 'ai-questions', role: 'status' });
      const root = h('div', { class: 'ai-edit ai-direct' },
        h('div', { class: 'ai-edit-row' }, h('span', { class: 'field-label', text: t('ai.direct.target') }), seg),
        list, chip,
        h('label', { class: 'field-label', htmlFor: 'ai-direct-text', text: t('ai.tool.direct') }), text,
        h('div', { class: 'ai-edit-row' }, h('span', { class: 'muted small', id: 'ai-direct-hint', text: t('ai.edit.enterHint') }),
          h('span', { class: 'grow' }), counter),
        chips, more,
        h('div', { class: 'ai-edit-row' }, camera, h('span', { class: 'grow' }), send),
        questions, board);

      // The AreaRef the box sends now (null: nothing to send to).
      const ref = () => AC.targetRef(target, app.view.state.sel, app.doc, app.plan);
      const areaOf = (r) => (r && app.plan ? AREAS.resolve(app.doc, app.plan, r) : null);

      function setTarget(mode, r) {
        target = { mode: TARGETS.includes(mode) ? mode : 'work', ref: mode === 'area' ? r || target.ref : null };
        listOpen = mode === 'area' && !r;
        update();
        if (listOpen) dom.focus(list.querySelector('[role="option"]') || segs[2]);
      }

      function highlight(r) {
        const area = areaOf(r);
        app.view.set({ highlight: area && area.kind !== 'work' ? area.lineIds.slice() : null });
      }

      segs.forEach((b) => b.addEventListener('click', () => {
        if (b.dataset.target === 'area') { target = { mode: 'area', ref: target.mode === 'area' ? target.ref : null }; listOpen = !listOpen; update();
          if (listOpen) dom.focus(list.querySelector('[role="option"]') || b); return; }
        setTarget(b.dataset.target);
      }));
      seg.addEventListener('keydown', (ev) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
        ev.preventDefault();
        ev.stopPropagation();
        const at = TARGETS.indexOf(target.mode);
        const next = TARGETS[(at + (ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : TARGETS.length - 1)) % TARGETS.length];
        target = { mode: next, ref: next === 'area' ? target.ref : null };
        listOpen = next === 'area' && !target.ref;
        update();
        // 区画 without an area yet: the list opens with the focus on its first area (Esc goes back to the radio).
        dom.focus((listOpen && list.querySelector('[role="option"]')) || segs[TARGETS.indexOf(next)]);
      });
      list.addEventListener('keydown', (ev) => {
        const opts = [...list.querySelectorAll('[role="option"]')];
        const at = opts.indexOf(document.activeElement);
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
          ev.preventDefault();
          ev.stopPropagation();
          const to = Math.max(0, Math.min(opts.length - 1, at + (ev.key === 'ArrowDown' ? 1 : -1)));
          if (opts[to]) dom.focus(opts[to]);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          listOpen = false;
          update();
          dom.focus(segs[2]);
        }
      });
      chipX.addEventListener('click', () => { setTarget('work'); dom.focus(segs[0]); });
      chip.addEventListener('pointerenter', () => highlight(ref()));
      chip.addEventListener('pointerleave', () => highlight(null));
      chips.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-chip]');
        if (!b) return;
        const phrase = t('ai.chipText.' + b.dataset.chip);
        const cur = text.value.trim();
        text.value = (cur ? cur + t('ai.chipJoin') : '') + phrase;
        text.value = text.value.slice(0, AC.MAX_INSTRUCTION);
        if (b.dataset.chip === 'material') { allow.checked = true; more.open = true; }
        update();
        dom.focus(text);
      });
      text.addEventListener('input', () => update());
      text.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || ev.keyCode === 229) return;
        ev.preventDefault();
        if (!send.disabled) sendNow('all');
      });
      send.addEventListener('click', () => sendNow('all'));
      camera.addEventListener('click', () => sendNow('camera'));
      board.addEventListener('click', () => openBoard());

      function sendNow(mode) {
        const r = ref();
        const instruction = text.value.trim();
        if (!r || (mode !== 'camera' && !instruction)) { dom.focus(text); return; }
        ctl.run('direct', { briefs: [{ ref: r, instruction }], mode, allowMaterials: mode === 'camera' ? false : allow.checked });
      }

      function renderList() {
        const groups = areaGroups(app.doc, app.plan, app.view.state.sel);
        const cur = target.ref ? AREAS.keyOf(target.ref) : null;
        const kids = [];
        const hasSong = groups.some((g) => g.group === 'song');
        for (const g of groups) {
          kids.push(h('div', { class: 'ai-area-group', role: 'presentation', text: t('area.group.' + g.group) }));
          for (const it of g.items) {
            const key = AREAS.keyOf(it.ref);
            const opt = h('button', { class: ['ai-area-opt', key === cur ? 'is-current' : null], type: 'button', role: 'option',
              'aria-selected': String(key === cur), 'data-area': key, text: areaLine(t, it.area) });
            opt.addEventListener('click', () => { setTarget('area', it.ref); dom.focus(text); });
            opt.addEventListener('pointerenter', () => highlight(it.ref));
            opt.addEventListener('pointerleave', () => highlight(null));
            kids.push(opt);
          }
        }
        if (!hasSong) {
          kids.push(h('p', { class: 'note subtle ai-need-song' }, t('area.needSong'), ' ',
            h('button', { class: 'link', type: 'button', text: t('ai.song.title'), on: { click: () => app.bus.emit('ai.tool', 'analyze') } })));
        }
        dom.replace(list, kids);
      }

      function update() {
        const st = ctl.state;
        segs.forEach((b) => {
          const on = b.dataset.target === target.mode;
          b.setAttribute('aria-checked', String(on));
          b.tabIndex = on ? 0 : -1;
          b.disabled = !!st.run;
        });
        segs[2].setAttribute('aria-expanded', String(listOpen));
        segs[2].setAttribute('aria-controls', 'ai-area-list');
        const focusedInList = list.contains(document.activeElement) ? document.activeElement.dataset.area : null;
        list.hidden = !listOpen;
        if (listOpen) {
          renderList();
          if (focusedInList) { const again = list.querySelector('[data-area="' + CSS.escape(focusedInList) + '"]'); if (again) dom.focus(again); }
        }
        const r = ref();
        const area = target.mode === 'work' ? null : areaOf(r);
        chip.hidden = !area;
        chipText.textContent = area ? areaLine(t, area) : '';
        counter.textContent = t('ai.edit.count', { n: text.value.length, max: AC.MAX_INSTRUCTION });
        const why = !r ? (target.mode === 'sel' ? 'ai.edit.noLine' : 'ai.direct.pickArea') : ctl.blocked('direct');
        send.disabled = !!why || !text.value.trim();
        send.title = why ? t(why) : '';
        camera.disabled = !!why;
        camera.title = why ? t(why) : '';
        text.disabled = !!st.run;
        board.disabled = !!st.run || !!st.review;
        // A question from the AI, under the box and per area (DESIGN_2_1 §6.2).
        const n = st.notice && st.notice.kind === 'question' && st.notice.tool === 'direct' ? st.notice : null;
        dom.replace(questions, n ? (n.questions || [{ areaKey: null, text: n.text }]).map((q) => {
          const b = (n.briefs || []).find((x) => x.key === q.areaKey);
          const area2 = b ? areaOf(b.ref) : null;
          return h('p', { class: 'ai-question', text: area2 ? t('ai.review.question', { area: F.areaLabel(t, area2), q: q.text }) : t('ai.edit.question', { q: q.text }) });
        }) : []);
      }

      // Opened for 「この行 / この区画 / このカットをAIに頼む…」: that target, the text focused.
      function preset(r) {
        if (!r || r.kind === 'work') setTarget('work');
        else setTarget('area', r);
      }

      return { root, update, text, preset, highlight };
    }

    function toolsBlock(app, ctl, openBoard) {
      const t = app.t;
      const reason = h('p', { class: 'ai-reason', role: 'status' });
      const prep = toolButton(t, 'prep', 'lyrics', 'ai.hint.prep');
      const looks = toolButton(t, 'looks', 'look', 'ai.hint.looks');
      const direct = directBlock(app, ctl, openBoard);
      const edit = direct.root;
      const songReason = h('p', { class: 'ai-reason' });
      const consentText = h('p', { class: 'note' });
      const agree = h('input', { type: 'checkbox', 'data-ctl': 'consent' });
      const consentCard = h('div', { class: 'ai-consent' }, consentText,
        h('label', { class: 'check-row' }, agree, h('span', { text: t('ai.song.agree') })));
      const songTools = ['transcribe', 'align', 'analyze'].map((tool) => h('button', { class: 'btn small', type: 'button',
        'data-tool': tool, text: t('ai.tool.' + tool) }));
      const song = h('div', { class: 'ai-song' }, h('h4', { class: 'ai-h4' }, I.icon('music', { size: 15 }), t('ai.song.title')),
        songReason, consentCard, h('div', { class: 'row-actions' }, songTools));
      const root = h('section', { class: 'ai-sec ai-tools', 'aria-label': t('ai.tools') },
        h('h3', { class: 'ai-h', text: t('ai.tools') }), reason, prep, looks, edit, song);

      dom.on(root, 'click', '[data-tool]', (ev, b) => {
        if (b.dataset.tool !== 'direct' && b.dataset.tool !== 'camera') ctl.run(b.dataset.tool);
      });
      agree.addEventListener('change', () => ctl.consent(agree.checked));

      function setDisabled(btn, why) {
        btn.disabled = !!why;
        btn.title = why ? t(why) : '';
      }

      function update(st) {
        const common = st.run ? 'ai.needIdle' : st.review ? 'ai.needReview' : !st.key ? 'ai.needKey' : null;
        reason.textContent = common ? t(common) : '';
        reason.hidden = !common;
        setDisabled(prep, ctl.blocked('prep'));
        setDisabled(looks, ctl.blocked('looks'));
        direct.update();
        const songWhy = ctl.songBlocked();
        songReason.textContent = songWhy ? t(songWhy) : '';
        songReason.hidden = !songWhy;
        consentCard.hidden = !!songWhy;
        if (!songWhy) {
          const facts = AC.consentFacts(app.buffer);
          consentText.textContent = t('ai.consent', { khz: facts.khz, mb: facts.mb, dur: facts.dur });
          agree.checked = ctl.hasConsent();
          agree.disabled = !!st.run;
        }
        for (const b of songTools) setDisabled(b, songWhy ? songWhy : ctl.blocked(b.dataset.tool));
      }

      // Opened for a tool (AIで整える, AIに3案, AIでタイミング, この行 / この区画 / このカットをAIに頼む…): scroll to it
      // and focus it; an instruction target comes preselected (app.aiTarget, DESIGN_2_1 §6.2).
      function focusTool(tool) {
        const instruct = tool === 'direct' || tool === 'edit';
        if (instruct && app.aiTarget) {
          const r = app.aiTarget.ref || (app.aiTarget.lines && app.aiTarget.lines.length && app.plan
            ? AREAS.ofLines(app.doc, app.plan, app.aiTarget.lines) : null);
          direct.preset(r);
          app.aiTarget = null;
        }
        const el = instruct ? direct.text : tool === 'align' ? (agree.checked || consentCard.hidden ? songTools[1] : agree)
          : root.querySelector('[data-tool="' + tool + '"]');
        if (!el) return;
        el.scrollIntoView({ block: 'nearest' });
        dom.focus(el);
        el.classList.remove('is-called');
        void el.offsetWidth;
        el.classList.add('is-called');
      }

      return { root, update, focusTool, direct };
    }

    // ---- mount ------------------------------------------------------------------------------------------------------------

    // ai/direct and ai/recipe (package E) when they are in the build; without them the tools say boot.soon.
    const optional = (id) => (MV.has(id) ? MV.use(id) : null);

    function mount(app, el) {
      const t = app.t;
      const ctl = AC.createController(hostOf(app), { session: storageOf('sessionStorage'), local: storageOf('localStorage'),
        direct: optional('ai/direct'), recipe: optional('ai/recipe') });
      const conn = connectionCard(app, ctl);
      // 区画ごとに指示 (the board): a sub-page of the AI tab; it takes the place of the tools while it is open.
      let board = null;
      let boardWanted = false;
      const boardHost = h('div', { class: 'ai-board-host', hidden: true });
      function openBoard() {
        if (!board) board = BOARD.mount(app, ctl, { onBack: closeBoard });
        dom.replace(boardHost, board.el);
        boardWanted = true;
        boardHost.hidden = !!ctl.state.review;
        tools.root.hidden = true;
        board.update();
        board.focus();
      }
      function closeBoard() {
        if (board) board.destroy();
        boardWanted = false;
        boardHost.hidden = true;
        tools.root.hidden = !!ctl.state.review;
        dom.focus(tools.root.querySelector('.ai-board-link'));
      }
      const tools = toolsBlock(app, ctl, openBoard);
      // The stage is a polite live region; the elapsed seconds next to it are not announced (they change every second).
      const runText = h('span', { class: 'ai-run-stage ai-shimmer', role: 'status', 'aria-live': 'polite' });
      const runTime = h('span', { class: 'ai-run-time muted', 'aria-hidden': 'true' });
      const stop = h('button', { class: 'btn small', type: 'button', 'data-ctl': 'stop', text: t('ai.stop') });
      const runLine = h('div', { class: 'ai-run' }, AT.orb(false), runText, runTime,
        h('span', { class: 'grow' }), stop);
      const message = h('div', { class: 'ai-message', hidden: true });
      const review = h('section', { class: 'ai-sec ai-review' });
      const log = h('section', { class: 'ai-sec ai-log', 'aria-label': t('ai.log.title') });
      const root = h('div', { class: 'ai-panel', role: 'region', 'aria-label': t('ai.region') },
        conn.root, noticeBlock(t), guideBlock(t), runLine, message, tools.root, boardHost, review, log);
      dom.replace(el, root);

      const openCards = new Set();
      const openAggs = new Set();         // aggregate rows expanded to their lines (an area review, DESIGN_2_1 §6.4)
      const shown = { error: null, notice: null };
      let shownReview = null;
      let shownTryOn = null;
      let ticker = 0;
      let lastStatus = ctl.state.keyStatus;

      stop.addEventListener('click', () => ctl.abort());
      // The thinking animation over the preview, wherever the request was started from (step ①/②, Ctrl+K or this tab).
      if (app.shell && app.shell.stage && app.shell.stage.element) AT.mountHud(app, ctl, app.shell.stage.element);

      // Hovering (or focusing) a review row highlights its line on the lane and the timeline and scrolls the lyric
      // editor to it (§6.4.10.6); an aggregate row highlights all of its lines (view.highlight is then an array).
      function hover(lineId) {
        app.view.set({ highlight: lineId || null });
        if (!lineId) return;
        const first = Array.isArray(lineId) ? lineId[0] : lineId;
        const line = app.plan ? app.plan.lines.find((l) => l.id === first) : null;
        const rowId = line ? line.row : first;
        const row = app.doc.sheet.rows.findIndex((r) => r.id === rowId);
        const body = app.shell && app.shell.steps && app.shell.steps.bodies.lyrics;
        if (row >= 0 && body && body.editor) body.editor.scrollToRow(row);
      }
      const rowLine = (target) => {
        const row = target instanceof Element ? target.closest('[data-line], [data-lines]') : null;
        if (!row || !review.contains(row)) return null;
        if (row.dataset.lines) { const ids = row.dataset.lines.split(',').filter(Boolean); return ids.length ? ids : null; }
        return row.dataset.line || null;
      };
      const sameHover = (a, b) => (Array.isArray(a) && Array.isArray(b) ? a.join(',') === b.join(',') : a === b);
      review.addEventListener('mouseover', (ev) => {
        const id = rowLine(ev.target);
        if (!sameHover(id, app.view.state.highlight)) hover(id);
      });
      review.addEventListener('mouseleave', () => hover(null));
      review.addEventListener('focusin', (ev) => { const id = rowLine(ev.target); if (id) hover(id); });
      review.addEventListener('focusout', (ev) => { if (!review.contains(ev.relatedTarget)) hover(null); });

      function elapsed(run) {
        return t('ai.runningTime', { sec: Math.max(0, Math.floor((Date.now() - run.started) / 1000)) });
      }

      // 音声を準備中 → アップロード中 → 処理中 → 考え中, the elapsed time and [中止] (§6.4.10.4).
      function updateRun(st) {
        runLine.hidden = !st.run;
        if (st.run) {
          const stage = t('ai.runningStage', { tool: t('ai.name.' + st.run.tool), stage: t('ai.stage.' + st.run.stage) });
          if (runText.textContent !== stage) runText.textContent = stage;
          runTime.textContent = elapsed(st.run);
          if (!ticker) ticker = setInterval(() => { if (ctl.state.run) runTime.textContent = elapsed(ctl.state.run); }, TICK_MS);
        } else if (ticker) { clearInterval(ticker); ticker = 0; }
      }

      // The error / notice line, rebuilt only when it changes (it is a live region).
      function updateMessage(st) {
        if (st.error === shown.error && st.notice === shown.notice) return;
        shown.error = st.error;
        shown.notice = st.notice;
        const nodes = [];
        if (st.error) {
          const text = st.error.code === 'internal' ? t('ai.error.internal') : t.err(st.error.code);
          nodes.push(h('div', { class: ['inline-error', 'ai-error', st.error.code === 'aborted' ? 'is-quiet' : null], role: 'alert' },
            I.icon('warn', { size: 16 }), h('span', { class: 'grow', text }),
            h('button', { class: 'btn small', type: 'button', text: t('ai.dismiss'), on: { click: () => ctl.dismiss() } })));
        }
        // A question of the instruction box is shown under the box, per area (DESIGN_2_1 §6.2).
        if (st.notice && !(st.notice.kind === 'question' && st.notice.tool === 'direct')) {
          const n = st.notice;
          const main = n.kind === 'question'
            ? (n.text ? t('ai.edit.question', { q: n.text }) : t('ai.edit.unclear'))
            : n.kind === 'empty' ? t('ai.tr.empty') : t('ai.review.nothing');
          const warn = n.warnings && n.warnings.length ? h('details', { class: 'ai-unusable' },
            h('summary', { text: t('ai.review.unusable', { n: n.warnings.length }) }),
            h('ul', {}, n.warnings.map((w) => h('li', { text: CH.warningText(w, t) })))) : null;
          nodes.push(h('div', { class: 'ai-note', role: 'status' }, I.icon(n.kind === 'question' ? 'help' : 'info', { size: 16 }),
            h('div', { class: 'grow' }, h('p', { class: 'note', text: main }),
              n.kind !== 'question' && n.text ? h('p', { class: 'note subtle', text: n.text }) : null, warn),
            h('button', { class: 'btn small', type: 'button', text: t('ai.dismiss'), on: { click: () => ctl.dismiss() } })));
        }
        dom.replace(message, nodes);
        message.hidden = !nodes.length;
      }

      // Updates the review when it or the try-on changed: in place when only checks, stale marks or the try-on differ
      // (AR.patchReview), otherwise rebuilt (`force`: a look card opened or closed, or the lyrics changed under a
      // transcript). The focused control keeps the focus (data-fkey).
      function updateReview(st, force) {
        const r = st.review;
        if (!force && r === shownReview && st.tryOn === shownTryOn) return;
        const prev = shownReview;
        const reopened = r && (!prev || prev.id !== r.id);
        if (!r || reopened) openCards.clear();
        shownReview = r;
        shownTryOn = st.tryOn;
        const active = document.activeElement;
        const fkey = active && review.contains(active) && active.dataset ? active.dataset.fkey : null;
        review.hidden = !r;
        // The review takes the place of the tools and the board; the board comes back after it (its rows then say 反映済み).
        tools.root.hidden = !!r || boardWanted;
        boardHost.hidden = !!r || !boardWanted;
        if (!r) { dom.clear(review); openAggs.clear(); return; }
        if (reopened) openAggs.clear();
        const ctx = { t, app, ctl, state: st, openCards, setCardOpen, openAggs, setAggOpen };
        if (force || !AR.patchReview(ctx, review, prev, r)) dom.replace(review, AR.renderReview(ctx, r));
        if (review.contains(document.activeElement)) return;
        const again = fkey ? review.querySelector('[data-fkey="' + CSS.escape(fkey) + '"]') : null;
        if (again) dom.focus(again);
        else if (reopened) dom.focus(review.querySelector('[data-fkey="review-head"]'));
      }

      function setCardOpen(i, open) {
        if (openCards.has(i) === !!open) return;
        if (open) openCards.add(i); else openCards.delete(i);
        updateReview(ctl.state, true);
      }

      function setAggOpen(agg, open) {
        if (openAggs.has(agg) === !!open) return;
        if (open) openAggs.add(agg); else openAggs.delete(agg);
        updateReview(ctl.state, true);
      }

      function updateLog() {
        const active = document.activeElement;
        const fkey = active && log.contains(active) && active.dataset ? active.dataset.fkey : null;
        const nodes = AR.renderLog({ t, app, ctl });
        dom.replace(log, nodes);
        log.hidden = !nodes.length;
        const again = fkey ? log.querySelector('[data-fkey="' + CSS.escape(fkey) + '"]') : null;
        if (again) dom.focus(again);
      }

      const render = dom.createBatcher((parts) => {
        const st = ctl.state;
        if (st.keyStatus === 'ok' && lastStatus !== 'ok') conn.release();
        lastStatus = st.keyStatus;
        conn.update(st);
        updateRun(st);
        updateMessage(st);
        tools.update(st);
        if (board && boardWanted) board.update();
        updateReview(st, parts.has('doc') && !!st.review && st.review.kind === 'transcript');   // [後ろに足す] needs lyrics
        if (parts.has('doc') || parts.has('log') || parts.has('all')) updateLog();
        if (app.shell) app.shell.playbar.updateStrip();
      });

      ctl.on(() => render('state'));
      app.bus.on('plan', () => { ctl.docChanged(); render('doc'); });
      app.bus.on('side', () => render('log'));
      app.bus.on('ai.tool', (tool) => requestAnimationFrame(() => {
        if (boardWanted) closeBoard();
        tools.focusTool(tool);
      }));
      app.store.on('doc', (e) => { if (e.kind === 'load') ctl.projectChanged(); });
      app.view.on((changed) => {
        if (changed.includes('sel')) render('sel');
        // AIを使う switched off: nothing of the AI stays open (a hidden review would keep 詳細 disabled).
        if (changed.includes('prefs') && !app.view.state.prefs.ai) {
          ctl.abort();
          ctl.discard();
          if (app.view.state.panel === 'ai') app.closePanel();
        }
      });
      render('all');
      return { root, ctl, render, openBoard, closeBoard };
    }

    return { mount, hostOf, songOf, areaGroups, areaLine, CHIPS, TARGETS };
  });
