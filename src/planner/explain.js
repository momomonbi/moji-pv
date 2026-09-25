/* 文字PVメーカー v2 — original work. explain(): why a slot has its value, and the alternatives — lazy, never in the Plan (DESIGN §4.16.8; DESIGN_2_1 §2.8, §3.9, §11.2.6). */
MV.def('planner/explain', ['core/paths', 'core/pins', 'core/lyrics', 'core/media', 'planner/choose', 'planner/look',
  'planner/plan', 'planner/fields'], (P, PINS, LY, MEDIA, CH, LK, PL, F) => {
  'use strict';

  const SCOPE_OF = { 'pin:cut': 'cut', 'pin:line': 'line', 'pin:work': 'work' };
  const TRACED = new Set(['part', 'value', 'count']);
  const ROLE_GATED = new Set(['arrange', 'arrive', 'dwell', 'depart', 'ornament', 'lens', 'filter']);
  const ALT_SLOTS = new Set(['cam.shot', 'rig']);           // value slots with alternatives (planner/camera weights)

  function r2(x) { return Math.round(x * 100) / 100; }

  // The cut an explanation is about: the path's cut; a line's first cut; for work scope the first lyric cut.
  function cutFor(plan, parsed) {
    const scope = parsed.scope;
    if (scope.kind === 'cut') return F.cutOf(plan, scope.id);
    if (scope.kind === 'line') {
      const line = plan.lines.find((l) => l.id === scope.id);
      return line && line.cuts.length ? F.cutOf(plan, line.cuts[0]) : null;
    }
    return plan.cuts.find((c) => c.role === 'lyric' || c.role === 'focus') || plan.cuts[0] || null;
  }

  function pinWhy(from, by) {
    return by === 'lock' ? [{ code: 'lock', params: {} }] : [{ code: 'pin', params: { scope: SCOPE_OF[from], by: by || 'user' } }];
  }

  // --- factor list of a chooser pick ------------------------------------------------------------------------------

  function strongestTag(def, mood) {
    let best = null, bestAbs = 0;
    for (const tag of def.tags || []) {
      const b = mood.tagBias && typeof mood.tagBias[tag] === 'number' ? mood.tagBias[tag] : 1;
      const a = Math.abs(Math.log(Math.max(b, 1e-6)));
      if (a > bestAbs) { best = { tag, x: b }; bestAbs = a; }
    }
    return best;
  }

  // The name of a derived media part's asset (the doc.media entry, else the part's label).
  function mediaName(doc, registry, kind, key) {
    const id = MEDIA.idOfKey(key, doc);
    const entry = id ? doc.media.list.find((e) => e && e.id === id) : null;
    if (entry) return String(entry.name);
    const def = registry.get(kind, key);
    return def && def.label ? def.label.ja : key;
  }

  function factorWhy(registry, plan, cut, trace, kind, value, seasonWord, doc) {
    const why = [];
    const cand = (trace.candidates || []).find((c) => c.key === value);
    const def = registry.get(kind, value);
    const cond = trace.cond || null;
    if (def && def.mine && def.mine.media === true) {
      why.push({ code: 'media.pool', params: { name: mediaName(doc, registry, kind, value) } });
    }
    if (cand && cand.f && def) {
      const f = cand.f;
      const mood = registry.get('mood', plan.look.mood.v);
      if (f.mood !== 1 && mood) {
        const t = strongestTag(def, mood);
        if (t) why.push({ code: 'mood.tag', params: { mood: mood.key, tag: t.tag, x: r2(t.x) } });
      }
      const fit = f.fit * f.fits;
      if (fit !== 1) why.push({ code: 'fit', params: { x: r2(fit) } });
      if (f.impact > 1) why.push({ code: 'impact', params: {} });
      if (f.echo > 1) why.push({ code: 'echo', params: { cut: cut.feat.repeatOf } });
      if (f.season !== 1 && cond && cond.pinned) why.push({ code: 'season.line', params: { season: cond.season } });
      else if (f.season !== 1) why.push({ code: 'season', params: { season: plan.look.season.v, word: seasonWord || '' } });
      if (f.prefer !== 1) why.push({ code: 'theme.prefer', params: { x: r2(f.prefer) } });
      if (def.gate) why.push({ code: 'gate', params: { amount: def.gate } });
    }
    const refs = cond && cond.deny ? cond.deny[kind] : null;
    if (refs && refs.length && !trace.avoidRelaxed) why.push({ code: 'avoid', params: { n: refs.length } });
    const recent = trace.recent;
    if (recent && recent.prev) {
      const other = [...recent.prev].filter((k) => k !== value).sort()[0];
      if (other) why.push({ code: 'recent', params: { key: other } });
      const fam = [...(recent.families || [])].sort()[0];
      if (fam && !(def && def.family === fam)) why.push({ code: 'family', params: { family: fam } });
    }
    if (trace.stage === 'relaxed' || trace.stage === 'fallback') why.push({ code: 'rule', params: { rule: trace.stage } });
    return why;
  }

  // --- alternatives ---------------------------------------------------------------------------------------------

  function filterMasks(filters, kind, key) {
    const f = filters && filters[kind];
    if (!f) return false;
    if (Array.isArray(f.only) && !f.only.includes(key)) return true;
    return Array.isArray(f.deny) && f.deny.includes(key);
  }

  // Why a registry part is not a candidate here: 'filter' | 'season' | 'gate' | 'role' | 'trait' | null. ctx.season is
  // the cut's effective season and ctx.deny its line's avoid list for the kind (DESIGN_2_1 §4.9; not when relaxed).
  function maskOf(registry, doc, plan, kind, key, ctx) {
    const def = registry.get(kind, key);
    const t = registry.traits(kind, key);
    const season = ctx.season || plan.look.season.v;
    if (filterMasks(doc.filters, kind, key) || (ctx.deny && ctx.deny.includes(key))) return 'filter';
    if (def.season && season !== 'any' && season !== def.season) return 'season';
    if (def.gate && !(LK.gateAmounts(plan.look.amounts, plan.look.backdrop, kind)[def.gate] > 0)) return 'gate';
    if (ctx.role && ROLE_GATED.has(kind) && !t.roles.includes(ctx.role)) return 'role';
    if (ctx.scope && def.scope !== undefined && def.scope !== ctx.scope) return 'trait';
    if (ctx.orient && !t.orient.includes(ctx.orient)) return 'trait';
    if (ctx.script && !(t.scripts.includes('*') || t.scripts.includes(ctx.script))) return 'trait';
    if (ctx.aspect && !(t.aspects.includes('*') || t.aspects.includes(ctx.aspect))) return 'trait';
    return null;
  }

  function altsOf(registry, doc, plan, kind, trace, mctx) {
    const weights = new Map((trace.candidates || []).map((c) => [c.key, c.w]));
    const out = [];
    for (const def of registry.all(kind)) {
      if (def.pool === false) continue;
      const masked = maskOf(registry, doc, plan, kind, def.key, mctx);
      out.push({ key: def.key, w: masked ? 0 : weights.has(def.key) ? weights.get(def.key) : 0, masked });
    }
    return out.sort((a, b) => b.w - a.w || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  // --- look slots -----------------------------------------------------------------------------------------------

  function explainLook(doc, plan, parsed, registry) {
    const slot = parsed.slot;
    const L = plan.look;
    const ix = PINS.index(doc.pins);
    const value = F.valueAt(plan, null, parsed, registry, ix);
    const src = slot === 'mood' || slot === 'theme' || slot === 'season' ? L[slot]
      : parsed.part && parsed.part.kind === 'texture' && !parsed.part.param && L.texture ? L.texture
        : PINS.lookup(ix, LK.WORK_AT, slot) || { from: 'auto' };
    const base = { path: P.format(parsed), value, from: src.from, by: src.by };
    if (src.from && src.from.startsWith('pin')) return Object.assign(base, { why: pinWhy(src.from, src.by), alts: [] });
    if (slot === 'season') {
      const scan = LK.scanSeason(LY.parseSheet(doc.sheet.rows));
      const why = scan.word ? [{ code: 'season', params: { season: scan.v, word: scan.word } }]
        : [{ code: 'rule', params: { rule: 'season' } }];
      return Object.assign(base, { why, alts: [] });
    }
    if (slot === 'mood') {
      const sheet = LY.parseSheet(doc.sheet.rows);
      const facts = LK.moodFacts(doc, sheet, LK.envOf(doc.song && doc.song.digest));
      const alts = LK.moodPool(registry)
        .map((key) => ({ key, w: r2(LK.moodWeight(registry.get('mood', key), facts)), masked: null }))
        .sort((a, b) => b.w - a.w || (a.key < b.key ? -1 : 1));
      return Object.assign(base, { why: [{ code: 'rule', params: { rule: 'mood' } }], alts });
    }
    if (slot === 'theme') {
      const mood = registry.get('mood', L.mood.v);
      const pool = new Set(registry.pool('theme', { season: L.season.v, filters: doc.filters }));
      const alts = registry.keys('theme').filter((key) => registry.get('theme', key).pool !== false).map((key) => {
        const def = registry.get('theme', key);
        const masked = filterMasks(doc.filters, 'theme', key) ? 'filter' : pool.has(key) ? null : 'season';
        const listed = mood && typeof mood.themes[key] === 'number' ? mood.themes[key] : LK.THEME_DEFAULT_WEIGHT;
        const w = masked ? 0 : r2(listed * CH.seasonFactor(def.season, L.season.v));
        return { key, w, masked };
      }).sort((a, b) => b.w - a.w || (a.key < b.key ? -1 : 1));
      return Object.assign(base, { why: [{ code: 'rule', params: { rule: 'mood' } }], alts });
    }
    const rule = lookRule(plan, slot);
    return Object.assign(base, { why: [{ code: 'rule', params: { rule } }], alts: [] });
  }

  // What an automatic work value follows: the mood (amounts), the song analysis (tempo, beat offset), the tempo
  // (reading rate with a BPM), the theme (colors, faces, texture), or the slot's own rule (§3.4.1).
  function lookRule(plan, slot) {
    if (slot.startsWith('amount.')) return 'mood';
    if (slot === 'bpm' || slot === 'beatOffset') return 'song';
    if (slot === 'readRate') return plan.beats ? 'bpm' : 'readRate';
    if (slot === 'length' || slot === 'titleCard') return slot;
    return 'theme';
  }

  // --- line, t0, el and parameter slots (read from the Plan and the pins) ---------------------------------------

  function explainRead(doc, plan, parsed, registry, cut) {
    const cat = F.categoryOf(parsed);
    const ix = PINS.index(doc.pins);
    const value = F.valueAt(plan, cut, parsed, registry, ix);
    const path = P.format(parsed);
    if (cat === 'line' && (parsed.slot === 'season' || parsed.slot === 'avoid')) {
      return explainLineCond(doc, plan, parsed, registry, cut, ix, value, path);
    }
    let from = 'auto', by;
    let spec = null;
    if (cat === 'line') {
      const lineId = cut ? cut.line : parsed.scope.lineId;
      const hit = lineId ? PINS.lookup(ix, { cutKey: null, pinCutKey: null, lineId }, parsed.slot) : null;
      const line = plan.lines.find((l) => l.id === lineId);
      if (hit && hit.from === 'pin:line') { from = hit.from; by = hit.by; }
      else if (parsed.slot === 'start' && line && line.by.start === 'lrc') from = 'mark';
      else if (parsed.slot === 'split' && line) {
        const row = doc.sheet.rows.find((r) => r.id === line.row);
        if (row && LY.parseRow(row.src).pieces) from = 'mark';
      }
    } else if (cut && (cat === 't0' || cat === 'el')) {
      const at = { cutKey: cut.key, pinCutKey: cut.pinKey || cut.key, lineId: cat === 't0' ? null : cut.line };
      const hit = PINS.lookup(ix, at, parsed.slot);
      if (hit) { from = hit.from; by = hit.by; }
    } else if (cut && cat === 'param') {
      const d = F.decisionAt(plan, cut, parsed, registry);
      spec = d && d.v !== 'none' ? F.schemaOf(registry, plan, parsed, [cut]) : null;
      if (d && d.pfrom && d.pfrom[parsed.part.param]) {
        from = d.pfrom[parsed.part.param];
        const at = { cutKey: cut.key, pinCutKey: cut.pinKey || cut.key, lineId: cut.line };
        const shared = !parsed.part.key;
        const hit = PINS.lookup(ix, at, P.slotParamPath(parsed.part.kind, parsed.part.idx, d.v, parsed.part.param, shared));
        by = hit ? hit.by : undefined;
      }
    }
    let why;
    if (from.startsWith('pin')) why = pinWhy(from, by);
    else if (from === 'mark') why = [{ code: 'rule', params: { rule: parsed.slot === 'split' ? 'marks' : 'lrc' } }];
    else if (from === 'rule') why = [{ code: 'rule', params: { rule: 'speed' } }];     // scaled by motion.speed (§4.3)
    else why = [{ code: 'rule', params: { rule: cat === 'param' ? 'auto' : parsed.slot } }];
    // The automatic depth of a photo or video: the §11.9.2 rule that decided it.
    const depthRule = cat === 'param' && from === 'auto' ? F.depthRuleAt(doc, plan, cut, parsed, registry) : null;
    if (depthRule) why = [{ code: 'media.depth.' + depthRule, params: {} }];
    // A photo or video (a media param, §11.2.6): chosen by the user or the AI (media.pin), or the asset of a derived
    // おまかせ ground (media.pool).
    if (spec && spec.type === 'media' && typeof value === 'string' && value !== '') {
      const entry = doc.media && Array.isArray(doc.media.list) ? doc.media.list.find((e) => e && e.id === value) : null;
      const name = entry ? String(entry.name) : value;
      if (from.startsWith('pin')) why.push({ code: 'media.pin', params: { name } });
      else why = [{ code: 'media.pool', params: { name } }];
    }
    return { path, value, from, by, why, alts: [] };
  }

  // The line slots season and avoid (DESIGN_2_1 §4.9). A line season follows the work's season unless the line pins
  // its own; its reasons are then the work season's. An avoid list is the line's own pin, else empty.
  function explainLineCond(doc, plan, parsed, registry, cut, ix, value, path) {
    const lineId = cut ? cut.line : parsed.scope.lineId;
    const hit = lineId ? PINS.lookup(ix, { cutKey: null, pinCutKey: null, lineId }, parsed.slot) : null;
    if (hit && hit.from === 'pin:line') {
      const why = pinWhy(hit.from, hit.by);
      if (parsed.slot === 'season') why.push({ code: 'season.line', params: { season: value } });
      else why.push({ code: 'avoid', params: { n: Array.isArray(value) ? value.length : 0 } });
      return { path, value, from: hit.from, by: hit.by, why, alts: [] };
    }
    if (parsed.slot === 'avoid') return { path, value, from: 'auto', by: undefined, why: [], alts: [] };
    const work = explainLook(doc, plan, P.parse('work:season'), registry);
    return { path, value, from: work.from, by: work.by, why: work.why, alts: [] };
  }

  // --- chooser slots (re-run with tracing) ----------------------------------------------------------------------

  function traceTarget(plan, parsed, cut) {
    const part = parsed.part;
    if (part && (part.kind === 'ground' || part.kind === 'atmos')) {
      const seg = plan.grounds[cut.ground];
      return { cutKey: seg ? seg.cuts[0] : cut.key, slot: part.kind };
    }
    if (parsed.slot === 'rig' || parsed.slot === 'rig.curve') {
      const run = plan.rigs ? plan.rigs[cut.rig] : null;
      return { cutKey: run && run.cuts.length ? run.cuts[0] : cut.key, slot: parsed.slot };
    }
    if (part) return { cutKey: cut.key, slot: part.param === 'count' ? part.kind + '.count' : F.choiceSlot(part) };
    return { cutKey: cut.key, slot: parsed.slot };
  }

  // What masks alternatives of a slot: the cut's role, orientation, script and aspect for per-cut kinds; only the
  // scope for backgrounds, atmospheres and seams (they belong to a segment or a boundary, not to the cut's text); and
  // the line conditions the pick was made under (season, avoid list).
  function maskContext(plan, cut, parsed, kind, trace) {
    const slotKind = parsed.part.kind;
    const cond = trace.cond || null;
    const lineCtx = { season: cond ? cond.season : null, deny: cond && cond.deny && !trace.avoidRelaxed ? cond.deny[kind] || null : null };
    if (kind === 'ground') return lineCtx;
    if (kind === 'seam') return Object.assign(lineCtx, { scope: trace.world ? 'world' : 'text' });
    if (slotKind === 'atmos') return Object.assign(lineCtx, { scope: 'run' });
    return Object.assign(lineCtx, {
      role: cut.role, orient: cut.slots && cut.slots.orient ? cut.slots.orient.v : null, script: cut.feat.script,
      aspect: plan.design.aspect, scope: kind === 'ornament' ? 'cut' : null,
    });
  }

  function tracedWhy(doc, registry, plan, cut, parsed, trace, d, value) {
    if (d.from && d.from.startsWith('pin')) {
      const pinned = pinWhy(d.from, d.by);
      return trace.override && trace.override.rule === 'carry' ? pinned.concat([{ code: 'rule', params: { rule: 'carry' } }]) : pinned;
    }
    if (trace.override && trace.override.rule === 'carry') {
      return (trace.why || []).concat([{ code: 'rule', params: { rule: 'carry' } }]);
    }
    if (trace.override) return [{ code: 'rule', params: { rule: trace.override.rule } }];
    if (trace.why) return trace.why.slice();
    if (d.from === 'rule') return [{ code: 'rule', params: { rule: trace.rule || 'rule' } }];
    if (d.from === 'fallback') return [{ code: 'rule', params: { rule: 'fallback' } }];
    if (F.categoryOf(parsed) === 'part' && trace.candidates) {
      const seasonWord = LK.scanSeason(LY.parseSheet(doc.sheet.rows)).word;
      return factorWhy(registry, plan, cut, trace, trace.kind || parsed.part.kind, value, seasonWord, doc);
    }
    return [{ code: 'rule', params: { rule: trace.rule || parsed.slot } }];
  }

  function explainTraced(doc, plan, parsed, registry, cut) {
    const res = PL.trace(doc, { registry }, traceTarget(plan, parsed, cut));
    const p = res.plan, t = res.out;
    const tcut = F.cutOf(p, cut.key) || cut;
    const value = F.valueAt(p, tcut, parsed, registry);
    const d = F.decisionAt(p, tcut, parsed, registry) || { v: value, from: 'auto' };
    const why = tracedWhy(doc, registry, p, tcut, parsed, t, d, value);
    const out = { path: P.format(parsed), value, from: d.from, by: d.by, why, alts: [] };
    if (ALT_SLOTS.has(parsed.slot) && Array.isArray(t.candidates)) {
      out.alts = t.candidates.map((c) => ({ key: c.key, w: c.masked ? 0 : c.w, masked: c.masked || null }))
        .sort((a, b) => b.w - a.w || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      return out;
    }
    const kind = t.kind || (parsed.part ? parsed.part.kind : null);
    if (F.categoryOf(parsed) !== 'part' || !kind) return out;
    out.alts = altsOf(registry, doc, p, kind, t, maskContext(p, tcut, parsed, kind, t));
    return out;
  }

  // explain(doc, plan, path, { registry }) → { path, value, from, by, why: [{ code, params }], alts: [{ key, w, masked }] }
  // Chooser slots re-run the planner with tracing on for exactly that slot (the same inputs, so the same value as
  // the Plan); other slots are read from the Plan and the pins. Nothing here touches `plan` or `doc`.
  function explain(doc, plan, path, opts) {
    const registry = opts && opts.registry;
    if (!registry) throw new Error('planner/explain: { registry } is required');
    const parsed = P.parse(path);
    const cat = F.categoryOf(parsed);
    if (cat === 'look') return explainLook(doc, plan, parsed, registry);
    const cut = cutFor(plan, parsed);
    if (!cut && cat !== 'line') {
      return { path, value: undefined, from: 'auto', by: undefined, why: [], alts: [] };
    }
    if (TRACED.has(cat)) return explainTraced(doc, plan, parsed, registry, cut);
    return explainRead(doc, plan, parsed, registry, cut);
  }

  return { explain, maskOf };
});
