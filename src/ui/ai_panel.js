/* 文字PVメーカー v2 — original work. The AI panel (tab AI of the detail column): connection, what is sent, guide, tools, running, review, log (DESIGN §6.4.10). */
MV.def('ui/ai_panel', ['ui/dom', 'ui/icons', 'ai/providers', 'ai/changes', 'ui/ai_controller', 'ui/ai_review', 'ui/ai_thinking'],
  (dom, I, PR, CH, AC, AR, AT) => {
    'use strict';

    const { h } = dom;
    const TICK_MS = 1000;                 // the elapsed time of a running request

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

    function toolsBlock(app, ctl) {
      const t = app.t;
      const reason = h('p', { class: 'ai-reason', role: 'status' });
      const prep = toolButton(t, 'prep', 'lyrics', 'ai.hint.prep');
      const looks = toolButton(t, 'looks', 'look', 'ai.hint.looks');
      const text = h('textarea', { class: 'ai-text', id: 'ai-edit-text', rows: '2', maxlength: String(AC.MAX_INSTRUCTION),
        placeholder: t('ai.edit.placeholder'), 'aria-describedby': 'ai-edit-hint' });
      const counter = h('span', { class: 'ai-count muted' });
      const tWork = h('button', { class: 'seg', type: 'button', role: 'radio', 'data-target': 'work', text: t('ai.edit.work') });
      const tLines = h('button', { class: 'seg', type: 'button', role: 'radio', 'data-target': 'lines' });
      const send = h('button', { class: 'btn small primary', type: 'button', 'data-tool': 'edit', text: t('ai.edit.send') });
      const edit = h('div', { class: 'ai-edit' },
        h('label', { class: 'field-label', htmlFor: 'ai-edit-text', text: t('ai.tool.edit') }), text,
        h('div', { class: 'ai-edit-row' }, h('span', { class: 'muted small', id: 'ai-edit-hint', text: t('ai.edit.enterHint') }),
          h('span', { class: 'grow' }), counter),
        h('div', { class: 'ai-edit-row' }, h('span', { class: 'field-label', text: t('ai.edit.target') }),
          h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': t('ai.edit.target') }, tWork, tLines),
          h('span', { class: 'grow' }), send));
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
      let target = 'work';

      const lineIds = () => AC.selectedLines(app.view.state.sel, app.plan);
      function sendEdit() {
        const instruction = text.value.trim();
        if (!instruction) { dom.focus(text); return; }
        const ids = target === 'lines' ? lineIds() : [];
        ctl.run('edit', { instruction, lineIds: ids });
      }
      dom.on(root, 'click', '[data-tool]', (ev, b) => {
        if (b.dataset.tool === 'edit') sendEdit(); else ctl.run(b.dataset.tool);
      });
      dom.on(root, 'click', '[data-target]', (ev, b) => { setTarget(b.dataset.target); });
      edit.querySelector('.segmented').addEventListener('keydown', (ev) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
        const next = target === 'work' && !tLines.disabled ? 'lines' : 'work';
        setTarget(next);
        dom.focus(next === 'work' ? tWork : tLines);
        ev.preventDefault();
      });
      text.addEventListener('input', () => update(ctl.state));
      text.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Enter' || ev.shiftKey || ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing || ev.keyCode === 229) return;
        ev.preventDefault();
        if (!send.disabled) sendEdit();
      });
      agree.addEventListener('change', () => ctl.consent(agree.checked));

      function setTarget(v) {
        target = v === 'lines' ? 'lines' : 'work';
        update(ctl.state);
      }

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
        const ids = lineIds();
        tLines.disabled = !ids.length;
        tLines.title = ids.length ? '' : t('ai.edit.noLine');
        tLines.textContent = ids.length > 1 ? t('ai.edit.lines', { n: ids.length }) : t('ai.edit.line');
        const tgt = target === 'lines' && ids.length ? 'lines' : 'work';
        for (const b of [tWork, tLines]) {
          const onOff = b.dataset.target === tgt;
          b.setAttribute('aria-checked', String(onOff));
          b.tabIndex = onOff ? 0 : -1;
        }
        counter.textContent = t('ai.edit.count', { n: text.value.length, max: AC.MAX_INSTRUCTION });
        const editWhy = ctl.blocked('edit');
        setDisabled(send, editWhy);
        if (!text.value.trim()) send.disabled = true;
        text.disabled = !!st.run;
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

      // Opened for a tool (AIで整える, AIに3案, AIでタイミング, この行をAIに頼む…): scroll to it and focus it.
      function focusTool(tool) {
        if (tool === 'edit') { if (app.aiTarget && app.aiTarget.lines && app.aiTarget.lines.length) setTarget('lines'); }
        const el = tool === 'edit' ? text : tool === 'align' ? (agree.checked || consentCard.hidden ? songTools[1] : agree)
          : root.querySelector('[data-tool="' + tool + '"]');
        if (!el) return;
        el.scrollIntoView({ block: 'nearest' });
        dom.focus(el);
        el.classList.remove('is-called');
        void el.offsetWidth;
        el.classList.add('is-called');
      }

      return { root, update, focusTool };
    }

    // ---- mount ------------------------------------------------------------------------------------------------------------

    function mount(app, el) {
      const t = app.t;
      const ctl = AC.createController(hostOf(app), { session: storageOf('sessionStorage'), local: storageOf('localStorage') });
      const conn = connectionCard(app, ctl);
      const tools = toolsBlock(app, ctl);
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
        conn.root, noticeBlock(t), guideBlock(t), runLine, message, tools.root, review, log);
      dom.replace(el, root);

      const openCards = new Set();
      const shown = { error: null, notice: null };
      let shownReview = null;
      let shownTryOn = null;
      let ticker = 0;
      let lastStatus = ctl.state.keyStatus;

      stop.addEventListener('click', () => ctl.abort());
      // The thinking animation over the preview, wherever the request was started from (step ①/②, Ctrl+K or this tab).
      if (app.shell && app.shell.stage && app.shell.stage.element) AT.mountHud(app, ctl, app.shell.stage.element);

      // Hovering (or focusing) a review row highlights its line on the lane and the timeline and scrolls the lyric
      // editor to it (§6.4.10.6).
      function hover(lineId) {
        app.view.set({ highlight: lineId || null });
        if (!lineId) return;
        const line = app.plan ? app.plan.lines.find((l) => l.id === lineId) : null;
        const rowId = line ? line.row : lineId;
        const row = app.doc.sheet.rows.findIndex((r) => r.id === rowId);
        const body = app.shell && app.shell.steps && app.shell.steps.bodies.lyrics;
        if (row >= 0 && body && body.editor) body.editor.scrollToRow(row);
      }
      const rowLine = (target) => {
        const row = target instanceof Element ? target.closest('[data-line]') : null;
        return row && review.contains(row) ? row.dataset.line : null;
      };
      review.addEventListener('mouseover', (ev) => {
        const id = rowLine(ev.target);
        if (id !== app.view.state.highlight) hover(id);
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
        if (st.notice) {
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
        tools.root.hidden = !!r;
        if (!r) { dom.clear(review); return; }
        const ctx = { t, app, ctl, state: st, openCards, setCardOpen };
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
        updateReview(st, parts.has('doc') && !!st.review && st.review.kind === 'transcript');   // [後ろに足す] needs lyrics
        if (parts.has('doc') || parts.has('log') || parts.has('all')) updateLog();
        if (app.shell) app.shell.playbar.updateStrip();
      });

      ctl.on(() => render('state'));
      app.bus.on('plan', () => { ctl.docChanged(); render('doc'); });
      app.bus.on('side', () => render('log'));
      app.bus.on('ai.tool', (tool) => requestAnimationFrame(() => tools.focusTool(tool)));
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
      return { root, ctl, render };
    }

    return { mount, hostOf, songOf };
  });
