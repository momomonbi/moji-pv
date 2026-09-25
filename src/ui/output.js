/* 文字PVメーカー v2 — original work. Output rules shared by step ④, the stage and the inspector: format ↔ backdrop, filters per backdrop, UI pre-flight items (DESIGN §3.2, §4.19.4, §4.21, §6.4.3). */
MV.def('ui/output', ['export/schedule', 'engine/scene/frame'], (S, F) => {
  'use strict';

  const FORMATS = Object.freeze(['mp4', 'png', 'pngAlpha']);
  const BACKDROPS = Object.freeze(['scene', 'chroma', 'black', 'clear']);

  // Transparency exists only as the transparent PNG sequence (SPEC §6 "transparent (PNG export)", §7; DESIGN §3.2
  // `clear` "PNG export only"), so the pair is kept consistent: format 透過PNG ⇔ backdrop 透明. Each helper returns the
  // commands of one user choice (the caller dispatches them as one undo entry).

  // formatCmds(doc, format) → commands: 透過PNG makes the backdrop 透明; MP4 or PNG連番 turns 透明 back to 通常.
  function formatCmds(doc, format) {
    const cmds = [];
    if (doc.output.format !== format) cmds.push({ t: 'output.set', key: 'format', v: format });
    const backdrop = doc.look.backdrop;
    if (format === 'pngAlpha' && backdrop !== 'clear') cmds.push({ t: 'look.set', key: 'backdrop', v: 'clear' });
    if (format !== 'pngAlpha' && backdrop === 'clear') cmds.push({ t: 'look.set', key: 'backdrop', v: 'scene' });
    return cmds;
  }

  // backdropCmds(doc, backdrop) → commands: 透明 makes the output 透過PNG; another backdrop while 透過PNG keeps a PNG
  // sequence, now opaque, so the frames show the chosen background.
  function backdropCmds(doc, backdrop) {
    const cmds = [];
    if (doc.look.backdrop !== backdrop) cmds.push({ t: 'look.set', key: 'backdrop', v: backdrop });
    const format = doc.output.format;
    if (backdrop === 'clear' && format !== 'pngAlpha') cmds.push({ t: 'output.set', key: 'format', v: 'pngAlpha' });
    if (backdrop !== 'clear' && format === 'pngAlpha') cmds.push({ t: 'output.set', key: 'format', v: 'png' });
    return cmds;
  }

  // The backdrop the export renders (export/schedule.backdropFor); the preview renders the same one.
  function effectiveBackdrop(doc) { return S.backdropFor(doc.output.format, doc.look.backdrop); }

  // Whether the document's format and backdrop agree (a file saved before the pair was coupled may not).
  function consistent(doc) { return (doc.output.format === 'pngAlpha') === (doc.look.backdrop === 'clear'); }

  // skipOf(registry, key, backdrop) → null when the filter runs under the backdrop, else that backdrop (§4.19.4).
  function skipOf(registry, key, backdrop) {
    if (!key || key === 'none' || !registry || !registry.has('filter', key)) return null;
    return F.filterAllowed(registry.get('filter', key), backdrop) ? null : backdrop;
  }

  // usedFilters(plan, cutKeys?) → sorted keys of the screen effects the plan uses: the work texture and every
  // `filter#i` below the cut's count (only the given cuts when cutKeys is passed; the texture only for the whole plan).
  function usedFilters(plan, cutKeys) {
    const keys = new Set();
    if (!plan) return [];
    const only = cutKeys ? new Set(cutKeys) : null;
    if (!only && plan.look && plan.look.texture && plan.look.texture.v && plan.look.texture.v !== 'none') keys.add(plan.look.texture.v);
    for (const cut of plan.cuts || []) {
      if (only && !only.has(cut.key)) continue;
      const slots = cut.slots || {};
      const n = slots['filter.count'] ? slots['filter.count'].v || 0 : 0;
      for (let i = 0; i < n; i++) {
        const d = slots['filter#' + i];
        if (d && typeof d.v === 'string' && d.v !== 'none') keys.add(d.v);
      }
    }
    return [...keys].sort();
  }

  // skippedFilters(plan, registry, backdrop, cutKeys?) → the used filters the backdrop leaves out.
  function skippedFilters(plan, registry, backdrop, cutKeys) {
    return usedFilters(plan, cutKeys).filter((key) => skipOf(registry, key, backdrop) !== null);
  }

  // checks(doc, plan, registry) → the UI's own pre-flight items (export/schedule.preflight has the rest):
  //   fx-skipped (info)      the effective backdrop leaves out screen effects the video uses (params.keys)
  //   alpha-backdrop (warn)  透過PNG with a backdrop other than 透明: the export clears it anyway   (fix: backdrop 透明)
  //   clear-png (warn)       PNG連番 with 透明: the frames get the normal background              (fix: format 透過PNG)
  // A fix is a list of commands, dispatched as one undo entry.
  function checks(doc, plan, registry) {
    const out = [];
    const format = doc.output.format;
    const backdrop = doc.look.backdrop;
    if (format === 'pngAlpha' && backdrop !== 'clear') {
      out.push({ code: 'alpha-backdrop', level: 'warn', params: { bg: backdrop }, fix: backdropCmds(doc, 'clear') });
    }
    if (format === 'png' && backdrop === 'clear') out.push({ code: 'clear-png', level: 'warn', params: {}, fix: formatCmds(doc, 'pngAlpha') });
    const effective = effectiveBackdrop(doc);
    if (effective !== 'scene' && plan) {
      const keys = skippedFilters(plan, registry, effective);
      if (keys.length) out.push({ code: 'fx-skipped', level: 'info', params: { bg: effective, keys } });
    }
    return out;
  }

  // withFixes(items, doc) → pre-flight items where the schedule's `clear-mp4` gets its fix (switch to 透過PNG), an MP4 this
  // browser cannot encode at all (`no-webcodecs`, `no-h264`) offers PNG連番, and every `fix` is a command list.
  function withFixes(items, doc) {
    return items.map((c) => {
      if (c.code === 'clear-mp4' && !c.fix) return Object.assign({}, c, { fix: formatCmds(doc, 'pngAlpha') });
      if ((c.code === 'no-webcodecs' || c.code === 'no-h264') && !c.fix) return Object.assign({}, c, { fix: formatCmds(doc, 'png') });
      if (c.fix && !Array.isArray(c.fix)) return Object.assign({}, c, { fix: [c.fix] });
      return c;
    });
  }

  // mergeFonts(items) → the items with every `font-fallback` folded into the first one (params.families), so a
  // blocked font service gives one line instead of one per typeface.
  function mergeFonts(items) {
    const fonts = items.filter((c) => c.code === 'font-fallback');
    if (fonts.length < 2) return items.map((c) => (c.code === 'font-fallback' ? withFamilies(c, [c.params.family]) : c));
    const families = [...new Set(fonts.map((c) => c.params && c.params.family).filter(Boolean))];
    const out = [];
    let placed = false;
    for (const c of items) {
      if (c.code !== 'font-fallback') out.push(c);
      else if (!placed) { out.push(withFamilies(c, families)); placed = true; }
    }
    return out;
  }

  function withFamilies(c, families) {
    return Object.assign({}, c, { params: Object.assign({}, c.params, { families: families.filter(Boolean) }) });
  }

  // errorKey(code) → the string key that explains an export failure (export/schedule ExportError codes).
  const ERROR_KEYS = Object.freeze({
    cancelled: 'err.exp.cancelled', sink: 'err.exp.sink', 'range-empty': 'exp.pre.range-empty',
    'no-webcodecs': 'exp.pre.no-webcodecs', 'no-codec': 'err.exp.codec', codec: 'err.exp.codec', 'no-plan': 'err.exp.noPlan',
    media: 'err.exp.media',
  });
  function errorKey(code) { return ERROR_KEYS[code] || 'err.exp.encode'; }

  // errorParams(err) → the params of that message: for a photo or video the export could not read
  // (ExportError('media'), detail { id, name, code }, DESIGN_2_1 §11.4.4), the asset's name ('—' when the library no
  // longer names it).
  function errorParams(err) {
    if (!err || err.code !== 'media') return {};
    const name = err.detail && typeof err.detail.name === 'string' ? err.detail.name.trim() : '';
    return { name: name || '—' };
  }

  return {
    FORMATS, BACKDROPS, ERROR_KEYS, formatCmds, backdropCmds, effectiveBackdrop, consistent, skipOf, usedFilters,
    skippedFilters, checks, withFixes, mergeFonts, errorKey, errorParams,
  };
});
