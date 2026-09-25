/* 文字PVメーカー v2 — original work. The shell: regions placed by computeLayout, breakpoints, rail, side tabs and the detail-column mounts. */
MV.def('ui/shell', ['ui/dom', 'ui/icons', 'ui/layout', 'ui/selection', 'ui/header', 'ui/steps', 'ui/stage', 'ui/playbar', 'ui/toasts'],
  (dom, I, L, S, header, steps, stage, playbar, toasts) => {
    'use strict';

    const { h } = dom;
    const REGION_ORDER = ['header', 'steps', 'stage', 'panel'];

    // The detail column (詳細 / AI). UI part 2 fills the two mounts: [data-mount="inspector"] and [data-mount="ai"];
    // until then each shows the current place (crumbs) and a short placeholder note.
    function createPanel(app) {
      const t = app.t;
      const tabDetails = h('button', { class: 'tab', type: 'button', role: 'tab', 'data-act': 'panel.details' }, I.icon('details'), t('panel.details'));
      const tabAi = h('button', { class: 'tab', type: 'button', role: 'tab', 'data-act': 'panel.ai' }, I.icon('ai'), t('panel.ai'));
      const close = h('button', { class: 'icon-btn', type: 'button', 'data-act': 'panel.close', title: t('panel.close'), 'aria-label': t('panel.close') },
        I.icon('close'));
      const tabs = h('div', { class: 'panel-tabs', role: 'tablist', 'aria-label': t('panel.tabs') }, tabDetails, tabAi, h('span', { class: 'grow' }), close);
      const crumbs = h('nav', { class: 'crumbs', 'aria-label': t('panel.crumbs') });
      const inspector = h('div', { class: 'mount', 'data-mount': 'inspector', role: 'tabpanel' }, crumbs,
        h('div', { class: 'placeholder' }, I.icon('details', { size: 28 }), h('p', { text: t('panel.soonDetails') })));
      const ai = h('div', { class: 'mount', 'data-mount': 'ai', role: 'tabpanel' },
        h('div', { class: 'placeholder' }, I.icon('ai', { size: 28 }), h('p', { text: t('panel.soonAi') })));
      const toastHost = h('div', { class: 'toast-slot' });
      const root = h('div', { class: 'panelbox' }, tabs, h('div', { class: 'panel-body' }, inspector, ai), toastHost);
      dom.on(root, 'click', '[data-crumb]', (ev, el) => app.select(JSON.parse(el.dataset.crumb), { from: 'crumbs' }));
      // WP8c: the tabs switch the column (a click on the current tab keeps it) and × closes it; 詳細 is disabled while
      // an AI review is open (§6.4.10.6).
      dom.on(tabs, 'click', '[data-act]', (ev, el) => {
        if (el.getAttribute('aria-selected') === 'true') return;
        app.actions.run(el.dataset.act, { from: 'header' });
      });

      function update() {
        const panel = app.view.state.panel || 'details';
        tabDetails.setAttribute('aria-selected', String(panel === 'details'));
        tabAi.setAttribute('aria-selected', String(panel === 'ai'));
        tabDetails.disabled = !!app.view.state.aiReview;                                  // WP8c
        tabDetails.title = app.view.state.aiReview ? t('panel.reviewLocked') : '';     // WP8c
        tabAi.hidden = !app.view.state.prefs.ai;                                        // WP8c
        inspector.hidden = panel !== 'details';
        ai.hidden = panel !== 'ai';
        const list = S.crumbs(app.view.state.sel, app.plan);
        dom.replace(crumbs, list.map((c, i) => [
          i ? h('span', { class: 'sep', 'aria-hidden': 'true', text: '›' }) : null,
          h('button', { class: 'crumb', type: 'button', 'data-crumb': JSON.stringify(c.sel),
            'aria-current': i === list.length - 1 ? 'location' : null }, t.label(c.label)),
        ]));
      }
      return { root, tabs, toastHost, update };
    }

    // Compact / stacked: one side column that switches 手順 / 詳細 / AI.
    function createSideTabs(app) {
      const t = app.t;
      const mk = (id, iconName, label) => h('button', { class: 'tab', type: 'button', role: 'tab', 'data-side': id }, I.icon(iconName), label);
      const bSteps = mk('steps', 'lyrics', t('panel.steps'));
      const bDetails = mk('details', 'details', t('panel.details'));
      const bAi = mk('ai', 'ai', t('panel.ai'));
      const root = h('div', { class: 'side-tabs', role: 'tablist', 'aria-label': t('panel.tabs') }, bSteps, bDetails, bAi);
      dom.on(root, 'click', '[data-side]', (ev, el) => {
        const id = el.dataset.side;
        if (id === 'steps') app.view.closePanel();
        else app.openPanel(id, 'header');
      });
      function update() {
        const cur = app.view.state.panel || 'steps';
        for (const b of [bSteps, bDetails, bAi]) b.setAttribute('aria-selected', String(b.dataset.side === cur));
        bAi.hidden = !app.view.state.prefs.ai;
        bDetails.disabled = !!app.view.state.aiReview;                                  // WP8c: §6.4.10.6
        bDetails.title = app.view.state.aiReview ? t('panel.reviewLocked') : '';       // WP8c
      }
      return { root, update };
    }

    function mount(app, host) {
      const t = app.t;
      const regions = {
        header: h('header', { class: 'region region-header', role: 'banner' }),
        steps: h('section', { class: 'region region-steps', 'aria-label': t('steps.region') }),
        rail: h('nav', { class: 'region region-rail', 'aria-label': t('steps.region') }),
        side: h('section', { class: 'region region-side', 'aria-label': t('panel.side') }),
        stage: h('main', { class: 'region region-stage', 'aria-label': t('stage.region') }),
        panel: h('aside', { class: 'region region-panel', 'aria-label': t('panel.region') }),
      };
      const root = h('div', { class: 'mv' }, Object.values(regions));
      dom.replace(host, root);

      const hdr = header.mount(app, regions.header);
      const stepCol = steps.mount(app, regions.rail);
      const panel = createPanel(app);
      const sideTabs = createSideTabs(app);
      const sideBody = h('div', { class: 'side-body' });
      regions.side.append(sideTabs.root, sideBody);
      regions.panel.append(panel.root);
      const stg = stage.mount(app, regions.stage);
      const bar = playbar.mount(app, regions.stage);
      const toast = toasts.mount(app);
      let current = null;

      function viewport() {
        const el = document.documentElement;
        return { w: el.clientWidth || window.innerWidth, h: el.clientHeight || window.innerHeight };
      }

      // Moves the step column and the panel box between the desktop columns and the compact side column.
      function arrange(res) {
        const compact = res.layout === 'compact' || res.layout === 'stacked';
        const panelOpen = !!app.view.state.panel;
        const wantSteps = compact ? (panelOpen ? null : sideBody) : regions.steps;
        const wantPanel = compact ? (panelOpen ? sideBody : null) : regions.panel;
        if (wantSteps && stepCol.root.parentNode !== wantSteps) wantSteps.appendChild(stepCol.root);
        if (!wantSteps && stepCol.root.parentNode) stepCol.root.remove();
        if (wantPanel && panel.root.parentNode !== wantPanel) wantPanel.appendChild(panel.root);
        if (!wantPanel && panel.root.parentNode) panel.root.remove();
        panel.tabs.hidden = compact;
        stepCol.setRailMode(!!res.rects.rail);
        toast.setHost(toastHostFor(res, compact, panelOpen));
      }

      // §6.4.11: the step column bottom when expanded; else the detail column; compact: the side column;
      // neither (rail + closed panel): the mode strip.
      function toastHostFor(res, compact, panelOpen) {
        if (compact) return panelOpen ? panel.toastHost : stepCol.toastHost;
        if (res.rects.steps) return stepCol.toastHost;
        if (res.rects.panel) return panel.toastHost;
        return null;
      }

      function apply() {
        const vs = app.view.state;
        const res = L.computeLayout(viewport(), {
          panel: vs.panel, rail: vs.rail, drawer: vs.drawer, aspect: app.doc.look.aspect,
        });
        current = res;
        app.layout = res;
        root.dataset.layout = res.layout;
        root.dataset.tier = res.tier;
        root.dataset.panel = vs.panel || 'none';
        dom.setStyle(root, { width: res.page.w, height: res.page.h });
        document.documentElement.classList.toggle('mv-scroll', res.page.scroll);
        const r = res.rects;
        dom.place(regions.header, r.header);
        dom.place(regions.steps, r.steps);
        dom.place(regions.rail, r.rail);
        dom.place(regions.side, r.side);
        dom.place(regions.stage, r.stage);
        dom.place(regions.panel, r.panel);
        arrange(res);
        stg.layout(res);
        bar.layout(res);
        hdr.update();
        sideTabs.update();
        panel.update();
        app.bus.emit('layout', res);
        return res;
      }

      const reflow = dom.createBatcher(apply);
      window.addEventListener('resize', () => reflow('resize'));
      if (typeof ResizeObserver === 'function') new ResizeObserver(() => reflow('resize')).observe(document.documentElement);

      app.view.on((changed) => {
        if (changed.some((k) => k === 'panel' || k === 'rail' || k === 'drawer')) apply();
        else if (['sel', 'prefs', 'aiReview'].some((k) => changed.includes(k))) { panel.update(); sideTabs.update(); }   // WP8c: aiReview
      });
      app.bus.on('plan', (e) => {
        if (!current || e.touched.look) apply();
        else panel.update();
      });

      // F6 / Shift+F6: the next / previous region that is on screen.
      function cycleRegion(d) {
        const order = REGION_ORDER.map((k) => (k === 'steps' ? (regions.steps.hidden ? (regions.side.hidden ? regions.rail : regions.side) : regions.steps) : regions[k]))
          .filter((el) => el && !el.hidden);
        const at = order.findIndex((el) => el.contains(document.activeElement));
        const next = order[at < 0 ? 0 : (at + (d > 0 ? 1 : order.length - 1)) % order.length];
        let target = dom.focusables(next)[0];
        if (!target) { next.tabIndex = -1; target = next; }
        dom.focus(target);
      }

      apply();
      return { root, regions, apply, cycleRegion, stage: stg, playbar: bar, header: hdr, steps: stepCol, toasts: toast, panel };
    }

    return { mount };
  });
