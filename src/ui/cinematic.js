/* 文字PVメーカー v2 — original work. Timed cinematic overlays, applied at the exact selected scope. */
MV.def('ui/cinematic', ['ui/dom', 'ui/fields', 'ui/selection', 'ui/camera_preview', 'i18n/t', 'planner/fields', 'core/schema'], (dom, F, S, CP, T, PF, SC) => {
  'use strict';
  const { h } = dom;
  const KEYS = Object.freeze(['universeJourney', 'singularityBurst', 'windMeadow', 'fluidClouds', 'wavePuddle']);
  const SAMPLE_DURATION = 8;

  function isEffect(registry, key) {
    const def = registry && registry.get('ornament', key);
    return KEYS.includes(key) && !!def && def.scope === 'run';
  }

  function parent(sel) {
    if (!sel || sel.level !== 'el') return sel;
    if (sel.scope === 'work') return S.WORK;
    return sel.scope.startsWith('line/') ? { level: 'line', ids: [sel.scope.slice(5)] }
      : { level: 'cut', key: sel.scope.slice(4) };
  }

  // The same scopes drive application and the generated parameter rows, including a song area's interludes.
  function selectionInfo(doc, plan, registry, selection) {
    const base = parent(selection || S.WORK), sel = S.validate(base, plan, doc);
    const ctx = F.contextOf(sel, plan, registry, doc);
    const valid = JSON.stringify(base) === JSON.stringify(sel);
    const scopes = sel.level === 'cut' ? ['cut/' + sel.key]
      : ctx.cinematicScopes || F.pathsFor({ path: 'atmos' }, ctx).map((p) => p.slice(0, -6));
    let t0 = 0, t1 = Number.isFinite(plan && plan.duration) ? plan.duration : 0;
    if (ctx.scopeKind !== 'work' && ctx.cuts.length) {
      t0 = Math.min(...ctx.cuts.map((c) => c.t0));
      t1 = Math.max(...ctx.cuts.map((c) => c.t1));
    }
    if (ctx.cinematicRange) { t0 = ctx.cinematicRange[0]; t1 = ctx.cinematicRange[1]; }
    return { selection: sel, ctx, scopes, t0, t1, valid };
  }

  function applyCommands(doc, plan, registry, selection, key, pinSig) {
    if (!isEffect(registry, key)) return [];
    const info = selectionInfo(doc, plan, registry, selection);
    if (!info.valid || !(info.t1 > info.t0)) return [];
    const values = [
      ['atmos', key], ['atmos.amount', 0.65],
      ['atmos@' + key + '.clock', 'song'], ['atmos@' + key + '.start', info.t0],
      ['atmos@' + key + '.duration', Math.round((info.t1 - info.t0) * 1000000) / 1000000],
      ['atmos@' + key + '.seed', 741],
    ];
    return info.scopes.flatMap((scope) => values.map(([slot, v]) => F.pinCmd(scope + ':' + slot, v, plan, pinSig)));
  }

  function removeCommands(doc, plan, registry, selection, pinSig) {
    const info = selectionInfo(doc, plan, registry, selection);
    return info.valid ? info.scopes.map((scope) => F.pinCmd(scope + ':atmos', 'none', plan, pinSig)) : [];
  }

  function ownedParam(doc, plan, registry, path, key, name) {
    if (!isEffect(registry, key)) return null;
    const stored = F.writePath(path, plan), pin = doc && doc.pins && doc.pins[stored];
    const param = registry.params('ornament', key).find((p) => p.name === name);
    if (!pin || !param) return null;
    const value = SC.coerce(param.spec, pin.v);
    return value === undefined ? null : { path: stored, pin, value };
  }

  function paramValue(doc, plan, registry, scope, key, name) {
    const path = scope + ':atmos@' + key + '.' + name;
    const own = ownedParam(doc, plan, registry, path, key, name);
    return own ? own.value : PF.fieldState(doc, plan, null, path, { registry }).value;
  }

  // Effective first-cut values may contain narrower overrides. A scope's own control must show its own authored
  // setting, including shared strength, while inactive settings retain their existing inactive explanation.
  function ownedParamState(doc, plan, registry, path, key, name, state) {
    const own = ownedParam(doc, plan, registry, path, key, name);
    if (!own) return state;
    const kind = path.startsWith('cut/') ? 'cut' : path.startsWith('line/') ? 'line' : 'work';
    return Object.assign({}, state, { value: own.value, by: own.pin.by, pinnedAt: kind, pinAt: own.path,
      state: state && state.state === 'inactive' ? 'inactive' : own.pin.by === 'lock' ? 'locked' : own.pin.by === 'ai' ? 'ai' : 'pinned' });
  }

  function previewParams(doc, plan, registry, selection, key) {
    const info = selectionInfo(doc, plan, registry, selection);
    const decisions = F.decisionsOf(F.cinematicContext(info.ctx), 'atmos');
    const current = decisions.find((d) => d && d.v === key);
    const params = Object.assign({}, current && current.p);
    for (const param of registry.params('ornament', key) || []) {
      const slot = param.shared ? 'atmos.' + param.name : 'atmos@' + key + '.' + param.name;
      const values = info.scopes.map((scope) => ownedParam(doc, plan, registry, scope + ':' + slot, key, param.name));
      if (values.length && values.every((v) => v && JSON.stringify(v.value) === JSON.stringify(values[0].value))) params[param.name] = values[0].value;
    }
    return params;
  }

  // A song-clock effect cannot infer the selected range from one background scene. Resolve "fill range" before
  // saving the edit, so every split scene receives the same explicit interval instead of its own segment length.
  function fillDurationCommands(doc, plan, registry, selection, key, pinSig) {
    if (!isEffect(registry, key)) return [];
    const info = selectionInfo(doc, plan, registry, selection);
    if (!info.valid) return [];
    const cmds = [];
    for (const scope of info.scopes) {
      const slot = 'atmos@' + key + '.';
      const read = (name) => paramValue(doc, plan, registry, scope, key, name);
      const clock = read('clock');
      let duration = 0;
      if (clock === 'song') {
        const start = read('start');
        const left = info.t1 - (Number.isFinite(start) ? start : info.t0);
        // No remaining range: reject the edit as one transaction, retaining the explicit inactive interval.
        if (!(left > 0)) return [];
        duration = Math.max(0.01, Math.round(left * 1000000) / 1000000);
      }
      cmds.push(F.pinCmd(scope + ':' + slot + 'duration', duration, plan, pinSig));
    }
    return cmds;
  }

  // The legacy atmosphere picker starts with a section clock and automatic length. Changing its reference to the
  // song must resolve that automatic length in the same edit; an already explicit duration is kept as authored.
  function songClockCommands(doc, plan, registry, selection, key, pinSig) {
    if (!isEffect(registry, key)) return [];
    const info = selectionInfo(doc, plan, registry, selection);
    if (!info.valid) return [];
    const cmds = [];
    for (const scope of info.scopes) {
      const slot = 'atmos@' + key + '.';
      const read = (name) => paramValue(doc, plan, registry, scope, key, name);
      cmds.push(F.pinCmd(scope + ':' + slot + 'clock', 'song', plan, pinSig));
      if (read('duration') === 0) {
        const start = read('start');
        const left = info.t1 - (Number.isFinite(start) ? start : info.t0);
        if (!(left > 0)) return [];
        const duration = Math.max(0.01, Math.round(left * 1000000) / 1000000);
        cmds.push(F.pinCmd(scope + ':' + slot + 'duration', duration, plan, pinSig));
      }
    }
    return cmds;
  }

  function previewRef(key, params) {
    return { kind: 'ornament', key, params: Object.assign({}, params, { clock: 'section', start: 0, duration: SAMPLE_DURATION }) };
  }

  function panel(app, ctx) {
    const t = app.t, info = selectionInfo(app.doc, app.plan, app.reg, ctx.sel);
    const decisions = F.decisionsOf(F.cinematicContext(ctx), 'atmos');
    const chosen = decisions.length && decisions.every((d) => d.v === decisions[0].v) ? decisions[0].v : null;
    const selected = F.cinematicKey(ctx, app.doc);
    const name = chosen && chosen !== 'none' ? app.label('ornament', chosen) : chosen === 'none' ? t('cinematic.none') : t('cinematic.mixed');
    const run = (cmds, label) => {
      // A stale inspector callback must never broaden a selection that has disappeared during a re-plan.
      if (!cmds.length || JSON.stringify(app.view.state.sel) !== JSON.stringify(ctx.sel)) return;
      app.batch({ label }, cmds);
    };
    const currentParams = (key) => previewParams(app.doc, app.plan, app.reg, ctx.sel, key);
    const labelOf = (key) => app.label('ornament', key);
    const cards = KEYS.filter((key) => isEffect(app.reg, key)).map((key) => {
      const def = app.reg.get('ornament', key), label = labelOf(key), on = key === selected;
      return h('div', { class: ['cinematic-card', on ? 'is-on' : ''] },
        h('button', { class: 'cinematic-apply', type: 'button', 'data-cinematic-apply': key, 'aria-pressed': String(on),
          'aria-label': t('cinematic.apply', { name: label }),
          on: { click: () => run(applyCommands(app.doc, app.plan, app.reg, ctx.sel, key, app.svc.pinSig), ['cinematic.undoApply', { name: label }]) } },
        h('strong', { text: label }), h('span', { class: 'note subtle', text: def.blurb && (def.blurb[t.lang] || def.blurb.ja) || '' })),
        h('button', { class: 'btn small cinematic-preview', type: 'button', 'data-cinematic-preview': key,
          'aria-label': t('cinematic.preview', { name: label }), on: { click: () => {
            if (JSON.stringify(app.view.state.sel) !== JSON.stringify(ctx.sel)) return;
            CP.open(app, previewRef(key, currentParams(key)), { duration: SAMPLE_DURATION, name: label });
          } } }, t('camera.sample.open')));
    });
    return h('div', { class: 'cinematic-panel', 'data-cinematic-scope': info.scopes.join(' ') },
      h('p', { class: 'note subtle', text: t('cinematic.note') }),
      h('p', { class: 'cinematic-range', text: t('cinematic.range', { start: T.fmtTime(info.t0), end: T.fmtTime(info.t1) }) }),
      h('p', { class: 'note', text: t('cinematic.current', { name }) }),
      chosen && chosen !== 'none' && !isEffect(app.reg, chosen)
        ? h('p', { class: 'note subtle', text: t('cinematic.replace', { name }) }) : null,
      h('div', { class: 'cinematic-cards', role: 'group', 'aria-label': t('sec.cinematic') }, cards),
      h('div', { class: 'row-actions' }, h('button', { class: 'btn small', type: 'button', 'data-cinematic-remove': '1',
        disabled: chosen === 'none', on: { click: () => run(removeCommands(app.doc, app.plan, app.reg, ctx.sel, app.svc.pinSig), ['cinematic.undoRemove', {}]) } },
      t('cinematic.remove'))));
  }

  return { KEYS, SAMPLE_DURATION, isEffect, parent, selectionInfo, applyCommands, removeCommands, ownedParamState,
    paramValue, previewParams, fillDurationCommands, songClockCommands, previewRef, panel };
});
