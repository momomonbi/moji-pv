/* 文字PVメーカー v2 — original work. The AI's thinking animation: the orb of the running line and the HUD over the preview while a request runs. */
MV.def('ui/ai_thinking', ['ui/dom'], (dom) => {
  'use strict';

  const { h } = dom;
  const TICK_MS = 1000;
  const STAGES = Object.freeze(['prepare', 'upload', 'process', 'think']);   // a song tool goes through all four
  const BARS = 5;                                                              // the thinking wave

  // The orb: two counter-rotating rings, a pulsing core and three orbiting sparks. CSS only, so the animation costs no
  // script time; under prefers-reduced-motion the global rule stills it.
  function orb(large) {
    return h('span', { class: ['ai-orb', large ? 'is-large' : null], 'aria-hidden': 'true' },
      h('span', { class: 'ai-orb-ring' }), h('span', { class: 'ai-orb-ring is-inner' }), h('span', { class: 'ai-orb-core' }),
      h('span', { class: 'ai-orb-orbit' }, h('i'), h('i'), h('i')));
  }

  // The HUD over the preview while a request runs: corner brackets, a faint grid, a scan beam and a card with the orb,
  // 「タイミング合わせ: 考え中…」, the stage steps of a song tool, a thinking wave and the elapsed seconds. It is DOM over
  // the canvas (an export never sees it) and ignores the pointer (the preview stays usable). The AI panel's running line
  // is the live region; the HUD is not announced a second time. While a request runs, <body> carries is-ai-thinking,
  // which makes the AI buttons glow.
  function mountHud(app, ctl, host) {
    const t = app.t;
    const text = h('span', { class: 'ai-hud-text' });
    const time = h('span', { class: 'ai-hud-time' });
    const steps = h('span', { class: 'ai-hud-steps' }, STAGES.map((s) => h('i', { dataset: { stage: s } })));
    const wave = h('span', { class: 'ai-hud-wave' }, Array.from({ length: BARS }, () => h('i')));
    const corners = ['tl', 'tr', 'bl', 'br'].map((c) => h('span', { class: 'ai-hud-corner is-' + c }));
    const root = h('div', { class: 'ai-hud', hidden: true, 'aria-hidden': 'true' },
      h('span', { class: 'ai-hud-grid' }), h('span', { class: 'ai-hud-scan' }), corners,
      h('div', { class: 'ai-hud-card' }, orb(true),
        h('span', { class: 'ai-hud-lines' }, h('span', { class: 'ai-hud-head' }, text, time), h('span', { class: 'ai-hud-foot' }, steps, wave))));
    host.appendChild(root);

    let runId = null;
    let audio = false;                     // the run started with the audio stages (a song tool)
    let ticker = 0;

    const elapsed = (run) => t('ai.runningTime', { sec: Math.max(0, Math.floor((Date.now() - run.started) / 1000)) });

    function update(st) {
      const run = st.run;
      root.hidden = !run;
      if (typeof document !== 'undefined' && document.body) document.body.classList.toggle('is-ai-thinking', !!run);
      if (!run) {
        runId = null;
        if (ticker) { clearInterval(ticker); ticker = 0; }
        return;
      }
      if (run.id !== runId) { runId = run.id; audio = run.stage !== 'think'; }
      const label = t('ai.runningStage', { tool: t('ai.name.' + run.tool), stage: t('ai.stage.' + run.stage) });
      if (text.textContent !== label) text.textContent = label;
      time.textContent = elapsed(run);
      steps.hidden = !audio;
      const at = STAGES.indexOf(run.stage);
      steps.childNodes.forEach((dot, i) => { dot.className = i < at ? 'is-done' : i === at ? 'is-now' : ''; });
      root.dataset.stage = run.stage;
      if (!ticker) ticker = setInterval(() => { if (ctl.state.run) time.textContent = elapsed(ctl.state.run); }, TICK_MS);
    }

    ctl.on(update);
    update(ctl.state);
    return { root, update };
  }

  return { orb, mountHud, STAGES };
});
