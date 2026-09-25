/* 文字PVメーカー v2 — original work. Step ① 歌詞: the lyric editor, inline syntax help, open, AI tidy-up, and a one-line summary (DESIGN §6.4.3). */
MV.def('ui/step_lyrics', ['ui/dom', 'ui/icons', 'ui/lyric_editor', 'i18n/t'], (dom, I, editor, T) => {
  'use strict';

  const { h } = dom;
  const SYNTAX = ['syn.line', 'syn.blank', 'syn.cut', 'syn.emph', 'syn.impact', 'syn.note', 'syn.comment', 'syn.time', 'syn.meta'];

  function mount(app) {
    const t = app.t;
    const syntaxBtn = h('button', { class: 'chip-btn', type: 'button', 'data-ctl': 'syntax', 'aria-expanded': 'false', 'aria-controls': 'syntax-help' },
      t('lyr.syntax'));
    const openBtn = h('button', { class: 'chip-btn', type: 'button', 'data-act': 'file.open', 'data-ctl': 'open' }, I.icon('open', { size: 15 }), t('lyr.open'));
    const aiBtn = h('button', { class: 'chip-btn', type: 'button', 'data-act': 'ai.prep', 'data-ctl': 'ai' }, I.icon('ai', { size: 15 }), t('lyr.aiTidy'));
    const help = h('div', { class: 'syntax-help', id: 'syntax-help', hidden: true },
      h('dl', {}, SYNTAX.map((k) => [h('dt', { text: t(k + '.mark') }), h('dd', { text: t(k) })])));
    const ed = editor.mount(app, {
      onSample: () => app.loadSample(),
      onFirstPaste: () => app.firstRun(),
    });
    const summary = h('div', { class: 'step-summary', role: 'status' });
    const root = h('div', { class: 'step step-lyrics' },
      h('div', { class: 'step-head' }, h('h2', { class: 'step-title', text: t('step.short.lyrics') }), h('span', { class: 'grow' }),
        syntaxBtn, openBtn, aiBtn),
      help, ed.root, summary);

    syntaxBtn.addEventListener('click', () => {
      help.hidden = !help.hidden;
      syntaxBtn.setAttribute('aria-expanded', String(!help.hidden));
    });
    dom.on(root, 'click', '.step-head [data-act]', (ev, b) => app.actions.run(b.dataset.act, { from: 'lyrics' }));

    function updateSummary() {
      const plan = app.plan;
      const n = plan ? plan.lines.length : 0;
      const rows = app.doc.sheet.rows;
      if (!n) {
        const onlyComments = rows.some((r) => r.src.trim()) && !n;
        summary.textContent = onlyComments ? t('lyr.noLines') : '';
        return;
      }
      const langs = new Map();
      for (const l of plan.lines) langs.set(l.lang, (langs.get(l.lang) || 0) + 1);
      const main = [...langs].sort((a, b) => b[1] - a[1])[0][0];
      summary.textContent = [t('count.lines', { n }), T.fmtTime(plan.duration).replace(/\.\d+$/, ''), t('lang.' + main)].join(' · ');
    }

    function update(what) {
      if (what === 'plan') updateSummary();
      aiBtn.hidden = !app.view.state.prefs.ai;
    }

    app.bus.on('plan', (e) => ed.sync(e));
    app.bus.on('time', (tNow) => ed.onTime(tNow));
    app.view.on((changed) => { if (changed.includes('sel')) ed.refreshGutter(); if (changed.includes('prefs')) update(); });
    updateSummary();
    update();

    return { root, update, editor: ed, onShow: () => requestAnimationFrame(ed.renderMirror) };
  }

  return { mount };
});
