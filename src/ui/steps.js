/* 文字PVメーカー v2 — original work. The step column: four tabs, the step body host, footer (次へ, « fold), toast slot, and the rail. */
MV.def('ui/steps', ['ui/dom', 'ui/icons', 'ui/step_lyrics', 'ui/step_song', 'ui/step_look', 'ui/step_export'],
  (dom, I, lyrics, song, look, exporter) => {
    'use strict';

    const { h } = dom;
    const STEPS = ['lyrics', 'song', 'look', 'export'];
    const MODULES = { lyrics, song, look, export: exporter };
    const NUMBERS = ['1', '2', '3', '4'];

    // Work-scope pins that choose the look (§3.4.1, §3.4.3 at work scope). The timing slots of step ② and the title card
    // (bpm, beatOffset, readRate, length, titleCard) are not look choices.
    const LOOK_PIN = /^work:(mood|theme|season|color\.|face\.|text\.|amount\.|texture|arrange|arrive|dwell|depart|ground|atmos|ornament|lens|filter|seam|orient|el\.)/;

    // Step status dots (§6.4.3): ① a lyric line exists; ② a song is loaded (optional); ③ after the first おまかせ or
    // look pin; ④ progress while exporting.
    function statusOf(app, step) {
      const plan = app.plan;
      if (step === 'lyrics') return plan && plan.lines.length ? 'done' : 'todo';
      if (step === 'song') return app.doc.song ? 'done' : 'optional';
      if (step === 'look') {
        const looks = app.store.side && app.store.side.looks;
        const list = looks && Array.isArray(looks.list) ? looks.list : [];
        const tried = list.some((e) => e && Array.isArray(e.label) && e.label[0] !== 'look.first');
        return tried || Object.keys(app.doc.pins).some((p) => LOOK_PIN.test(p)) ? 'done' : 'todo';
      }
      return app.exporting ? 'busy' : 'todo';
    }

    function mount(app, railEl) {
      const t = app.t;
      const bodies = {};
      for (const step of STEPS) bodies[step] = MODULES[step].mount(app);
      const tapPanel = app.tap;

      const tabs = STEPS.map((step, i) => h('button', {
        class: 'step-tab', type: 'button', role: 'tab', id: 'step-tab-' + step, 'data-step': step,
        'aria-controls': 'step-body', title: t('step.' + step),
      }, h('span', { class: 'step-num', 'aria-hidden': 'true', text: NUMBERS[i] }),
      h('span', { class: 'step-name', text: t('step.short.' + step) }),
      h('span', { class: 'step-dot', 'aria-hidden': 'true' })));
      const tabList = h('div', { class: 'step-tabs', role: 'tablist', 'aria-label': t('steps.region') }, tabs);
      const bodyHost = h('div', { class: 'step-body', id: 'step-body', role: 'tabpanel' });
      const toastHost = h('div', { class: 'toast-slot' });
      const fold = h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('steps.fold'), title: t('steps.fold') },
        I.icon('fold'));
      const next = h('button', { class: 'btn next-btn', type: 'button' });
      const footerExtra = h('div', { class: 'footer-main' });
      const footer = h('div', { class: 'step-footer' }, fold, footerExtra);
      const root = h('div', { class: 'stepcol' }, tabList, bodyHost, toastHost, footer);

      // Rail (48 px): step numbers and the expand button.
      const railTabs = STEPS.map((step, i) => h('button', {
        class: 'rail-step', type: 'button', 'data-step': step, title: t('step.' + step), 'aria-label': t('step.' + step),
      }, h('span', { text: NUMBERS[i] }), h('span', { class: 'step-dot', 'aria-hidden': 'true' })));
      const expand = h('button', { class: 'rail-step rail-expand', type: 'button', title: t('steps.unfold'), 'aria-label': t('steps.unfold') },
        I.icon('unfold'));
      railEl.append(...railTabs, h('span', { class: 'grow' }), expand);

      dom.on(tabList, 'click', '[data-step]', (ev, el) => app.goStep(el.dataset.step));
      tabList.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft' && ev.key !== 'Home' && ev.key !== 'End') return;
        const at = STEPS.indexOf(app.view.state.step);
        const to = ev.key === 'Home' ? 0 : ev.key === 'End' ? 3 : (at + (ev.key === 'ArrowRight' ? 1 : 3)) % 4;
        app.goStep(STEPS[to]);
        dom.focus(tabs[to]);
        ev.preventDefault();
      });
      dom.on(railEl, 'click', '[data-step]', (ev, el) => { app.view.setRail(false); app.goStep(el.dataset.step); });
      expand.addEventListener('click', () => app.view.setRail(false));
      fold.addEventListener('click', () => app.view.setRail(true));
      next.addEventListener('click', () => {
        const at = STEPS.indexOf(app.view.state.step);
        if (at < 3) app.goStep(STEPS[at + 1]);
      });

      let shown = null;
      function showBody() {
        const vs = app.view.state;
        const want = vs.mode === 'tap' ? tapPanel : bodies[vs.step];
        if (shown !== want) {
          dom.replace(bodyHost, want.root);
          shown = want;
          if (want.onShow) want.onShow();
        }
        bodyHost.setAttribute('aria-labelledby', 'step-tab-' + vs.step);
        const at = STEPS.indexOf(vs.step);
        const extra = vs.mode !== 'tap' && bodies[vs.step].footer ? bodies[vs.step].footer : null;
        if (extra) dom.replace(footerExtra, extra);
        else if (vs.mode === 'tap') dom.clear(footerExtra);
        else {
          // ② without a song: 「曲なしで次へ」 (§6.11 — the song is optional).
          const label = vs.step === 'song' && !app.doc.song ? t('step.nextNoSong') : t('step.next', { step: t('step.' + STEPS[at + 1]) });
          next.textContent = '';
          next.append(h('span', { text: label }), I.icon('next', { size: 16 }));
          dom.replace(footerExtra, next);
        }
      }

      function updateTabs() {
        const cur = app.view.state.step;
        STEPS.forEach((step, i) => {
          const st = statusOf(app, step);
          for (const el of [tabs[i], railTabs[i]]) {
            el.dataset.status = st;
            el.setAttribute(el === tabs[i] ? 'aria-selected' : 'aria-current', el === tabs[i] ? String(step === cur) : step === cur ? 'step' : 'false');
          }
          tabs[i].tabIndex = step === cur ? 0 : -1;
        });
      }

      function update() {
        updateTabs();
        showBody();
      }

      app.view.on((changed) => {
        if (changed.includes('step') || changed.includes('mode')) update();
      });
      app.bus.on('plan', () => { updateTabs(); for (const s of STEPS) bodies[s].update('plan'); if (app.view.state.step === 'song') showBody(); });
      app.bus.on('side', updateTabs);
      app.bus.on('export', updateTabs);
      update();

      return {
        root, toastHost, bodies,
        setRailMode(on) { root.classList.toggle('is-railed', on); },
      };
    }

    return { mount, STEPS, statusOf, LOOK_PIN };
  });
