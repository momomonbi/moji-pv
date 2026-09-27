/* 文字PVメーカー v2 — original work. カメラ EXTREME in the editor: the switch's flow (the motion-sickness notice, the turn-off question), what is on where, and the notice before an EXTREME move is picked by hand (DESIGN_EXTREME §2.6, §3.5). */
MV.def('ui/extreme', ['ui/dom', 'core/pins', 'core/paths', 'core/shot', 'planner/extreme', 'planner/areas'],
  (dom, PINS, P, SHOT, XT, AREAS) => {
    'use strict';

    const { h } = dom;

    // The switch is the pin cam.extreme at the whole video or a line (planner/extreme, DESIGN_EXTREME §2.1). A scope here
    // is 'work' or 'line/<id>'; a cut stands for its line (a special cut without a line for the whole video).
    function lineOfScope(scope) { return scope.startsWith('line/') ? scope.slice(5) : null; }

    // valueOf(doc, scope, ix?) → the switch's strength there (0 = off): the line's pin, else the whole video's.
    function valueOf(doc, scope, ix) {
      return XT.valueAt(ix || PINS.index((doc && doc.pins) || {}), { lineId: lineOfScope(scope) });
    }

    // scopesValue(doc, scopes) → the one strength every scope has, or null when they differ (the several-lines page).
    function scopesValue(doc, scopes) {
      const ix = PINS.index((doc && doc.pins) || {});
      const list = scopes.map((s) => valueOf(doc, s, ix));
      if (!list.length) return 0;
      return list.every((v) => v === list[0]) ? list[0] : null;
    }

    // linesOn(doc, scopes) → how many lines have their own switch on under these scopes (the whole video's row says so
    // while its own switch is off: 「3 行で EXTREME がオンです」).
    function linesOn(doc, scopes) {
      return new Set(scopes.flatMap((s) => XT.lineSwitches(doc, s))).size;
    }

    // scopeOfPath(path) → the switch scope a pin path belongs to: its line for a cut of a line, else the whole video.
    function scopeOfPath(path, plan) {
      const key = P.scopeKey(path);
      if (key === 'work' || key.startsWith('line/')) return key;
      const lineId = P.lineOfCut(key.slice(4));
      if (lineId && plan && Array.isArray(plan.lines) && plan.lines.some((l) => l.id === lineId)) return 'line/' + lineId;
      return 'work';
    }

    // areaValue(doc, plan, ref) → the strength EXTREME has on every line of an AreaRef (0 when it is off on any), for the
    // AI panel's 「EXTREME」 chip: the whole video reads the work switch; a cut reads its line's.
    function areaValue(doc, plan, ref) {
      if (!ref || !plan) return 0;
      const area = AREAS.resolve(doc, plan, ref);
      if (!area) return 0;
      const ix = PINS.index(doc.pins || {});
      if (area.kind === 'work') return XT.valueAt(ix, { lineId: null });
      const ids = area.lineIds && area.lineIds.length ? area.lineIds
        : area.kind === 'cut' && area.cutKeys && area.cutKeys.length ? [P.lineOfCut(area.cutKeys[0])].filter(Boolean) : [];
      if (!ids.length) return XT.valueAt(ix, { lineId: null });
      const list = ids.map((lineId) => XT.valueAt(ix, { lineId }));
      return Math.min(...list);
    }

    // --- the notice and the turn-off question (DESIGN_EXTREME §3.5, §2.6) ---------------------------------------------

    // notice(app, { ok }) → Promise<boolean>: 「激しいカメラワークについて」 with [やめる] [オンにする] (ok: another string key
    // for the confirming button) and 「次から表示しない」 (the preference hintExtreme). true at once once it was ticked, or
    // without dialogs. The reduced-motion line shows while the preview tones EXTREME down (calmCamera) because the
    // device asks for less motion.
    function notice(app, o) {
      const opts = o || {};
      if (!app.dialogs || !app.view.state.prefs.hintExtreme) return Promise.resolve(true);
      const t = app.t;
      let again = null;
      return app.dialogs.open((body, done) => {
        again = h('input', { type: 'checkbox', 'data-x': 'again' });
        const reduced = dom.prefersReducedMotion() && !!app.view.state.prefs.calmCamera;
        const ok = h('button', { class: 'btn primary', type: 'button', 'data-autofocus': '1', 'data-x': 'ok', on: { click: () => done(true) } },
          t(opts.ok || 'x.notice.ok'));
        const no = h('button', { class: 'btn', type: 'button', 'data-x': 'cancel', on: { click: () => done(false) } }, t('x.notice.cancel'));
        body.appendChild(h('div', { class: 'x-notice' },
          h('p', { class: 'dlg-text', text: t('x.notice.text') }),
          reduced ? h('p', { class: 'dlg-text x-reduced', role: 'note', text: t('x.notice.reduced') }) : null,
          h('label', { class: 'check-row x-again' }, again, h('span', { text: t('x.notice.again') })),
          h('div', { class: 'dlg-actions' }, no, ok)));
      }, { title: t('x.notice.title') }).then((v) => {
        if (v === true && again && again.checked) app.view.setPref('hintExtreme', false);
        return v === true;
      });
    }

    // offChoice(app, { moves, lines }) → Promise<'keep' | 'remove' | null>: what else turning the switch off would leave
    // on — moves picked by hand or by the AI (「手で選んだ EXTREME の動きが n か所あります。これも元に戻しますか？」), lines
    // whose own switch is on under the whole video's (「EXTREME がオンの行が n 行あります。これもオフにしますか？」), or both
    // (one question, with the two counts) — [残す] [元に戻す] with the focus on 元に戻す; null when the dialog is closed
    // (nothing changes then). A number n stands for { moves: n }.
    function offChoice(app, what) {
      if (!app.dialogs) return Promise.resolve('remove');
      const t = app.t;
      const o = typeof what === 'number' ? { moves: what, lines: 0 } : Object.assign({ moves: 0, lines: 0 }, what);
      const n = o.moves + o.lines;
      return app.dialogs.open((body, done) => {
        const keep = h('button', { class: 'btn', type: 'button', 'data-x': 'keep', on: { click: () => done('keep') } }, t('x.off.keep', { n }));
        const remove = h('button', { class: 'btn primary', type: 'button', 'data-autofocus': '1', 'data-x': 'remove',
          on: { click: () => done('remove') } }, t('x.off.remove', { n }));
        const text = o.lines && o.moves ? t('x.off.both') : o.lines ? t('x.off.lines', { n: o.lines }) : t('x.off.text', { n: o.moves });
        const counts = o.lines && o.moves ? h('ul', { class: 'x-off-counts' },
          h('li', { text: t('x.off.countLines', { n: o.lines }) }), h('li', { text: t('x.off.countMoves', { n: o.moves }) })) : null;
        body.appendChild(h('div', { class: 'x-off' }, h('p', { class: 'dlg-text', text }), counts,
          h('div', { class: 'dlg-actions' }, keep, remove)));
      }, { title: t('x.off.title') }).then((v) => (v === 'keep' || v === 'remove' ? v : null));
    }

    // --- the switch ------------------------------------------------------------------------------------------------

    function uniqueCmds(lists) {
      const out = [];
      const seen = new Set();
      for (const cmd of [].concat(...lists)) {
        const k = cmd.t + '|' + cmd.path;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(cmd);
      }
      return out;
    }

    function run(app, cmds, meta) {
      if (!cmds.length) return;
      if (cmds.length === 1) app.dispatch(cmds[0], meta); else app.batch(meta, cmds);
    }

    // setSwitch(app, { scopes, v, meta }) → Promise<boolean>: turns EXTREME on at the strength v (1 = 最大, 0.75, 0.5) or
    // off (v 0) at every scope, as one undo step (meta: its label). Turning it on where it was off asks the notice first;
    // turning it off where moves were picked by hand or by the AI, or (for the whole video) where lines have their own
    // switch on, asks whether to turn those back too (元に戻す preselected: EXTREME is then off everywhere; lock pins
    // stay). false when the user cancelled (nothing changed).
    async function setSwitch(app, o) {
      const scopes = [...new Set(o.scopes || [])];
      if (!scopes.length) return false;
      const v = typeof o.v === 'number' && o.v > 0 ? o.v : 0;
      if (v > 0) {
        const ix = PINS.index(app.doc.pins);
        if (scopes.some((s) => valueOf(app.doc, s, ix) <= 0) && !(await notice(app))) return false;
        run(app, uniqueCmds(scopes.map((s) => XT.switchCommands(app.doc, s, v, { by: 'user' }))), o.meta);
        return true;
      }
      const picked = new Set(scopes.flatMap((s) => XT.handPicked(app.doc, s)));
      const lines = new Set(scopes.flatMap((s) => XT.lineSwitches(app.doc, s)));
      let remove = false;
      if (picked.size || lines.size) {
        const choice = await offChoice(app, { moves: picked.size, lines: lines.size });
        if (!choice) return false;
        remove = choice === 'remove';
      }
      run(app, uniqueCmds(scopes.map((s) => XT.switchCommands(app.doc, s, 0, { remove, by: 'user' }))), o.meta);
      return true;
    }

    // pickShot(app, paths, value) → Promise<boolean>: before an EXTREME preset is pinned by hand (the shot picker) where
    // the switch is off, the notice (its button says 「この動きを使う」); true for every other value.
    function pickShot(app, paths, value) {
      if (!SHOT.isExtreme(value)) return Promise.resolve(true);
      const ix = PINS.index(app.doc.pins);
      const off = paths.some((p) => valueOf(app.doc, scopeOfPath(p, app.plan), ix) <= 0);
      return off ? notice(app, { ok: 'x.notice.use' }) : Promise.resolve(true);
    }

    // The EXTREME cuts of a plan (their cam.shot is an EXTREME value), for step ④ and the timeline.
    function isXCut(cut) {
      const d = cut && cut.slots ? cut.slots['cam.shot'] : null;
      return !!d && d.v !== null && d.v !== undefined && SHOT.isExtreme(d.v);
    }

    return { valueOf, scopesValue, linesOn, scopeOfPath, areaValue, notice, offChoice, setSwitch, pickShot, isXCut };
  });
