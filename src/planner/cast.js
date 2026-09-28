/* 文字PVメーカー v2 — original work. Casting: every cut slot in the FROZEN order, from pins, rules or the chooser (DESIGN §4.16.2, §3.4.3; DESIGN_2_1 §3.9, §4.9). */
MV.def('planner/cast', ['core/schema', 'core/registry', 'core/rng', 'core/num', 'core/pins', 'core/paths', 'planner/choose',
  'planner/params', 'planner/look', 'planner/camera', 'planner/rules'], (S, REG, R, N, PINS, P, CH, PA, LK, CAM, RU) => {
    'use strict';

    const LIST_KINDS = Object.freeze(['ornament', 'filter']);
    const LIST_MAX = 3;
    const MOTION_KINDS = Object.freeze(['arrive', 'dwell', 'depart']);
    const EL_FIELDS = Object.freeze(['nudge', 'fill', 'hide']);
    const EL_SORTED = Object.freeze(EL_FIELDS.slice().sort());
    const PER_CUT_ROLES = new Set(['lyric', 'focus']);
    const TALL_ASPECTS = new Set(['9:16', '3:4']);
    const FACE_WEIGHTS = Object.freeze({ display: 3, serif: 2, body: 1 });
    const FACE_KIT = 8;                                    // the face of the part's set of looks (DESIGN_2_2 §2.1.4)
    const FACES = Object.freeze(['display', 'serif', 'body']);
    const AVOID_REPEAT = new Set(['arrange', 'arrive']);   // §8.2: no identical adjacent arrange/arrive (see choose.pick)

    // Specs of the non-part cut slots (§3.4.3, and the v2.1 camera slots of planner/camera); pins are coerced through
    // them and planner/fields shows them.
    const SLOT_SPECS = Object.freeze(Object.assign({
      orient: { type: 'enum', of: ['h', 'v'] },
      'text.face': { type: 'face' },
      'text.scale': { type: 'num', min: 0.5, max: 2, step: 0.01 },
      'text.ink': { type: 'ink' },
      'text.style': { type: 'enum', of: REG.TEXT_STYLES },
      'ornament.count': { type: 'int', min: 0, max: LIST_MAX },
      'filter.count': { type: 'int', min: 0, max: LIST_MAX },
      'el.nudge': { type: 'nudge' },
      'el.fill': { type: 'ink' },
      'el.hide': { type: 'bool' },
      // 「くり返しの行をそろえる」 (DESIGN_2_1 §4.10): pinned at work or line scope, never at a cut (core/commands).
      'repeat.same': { type: 'bool' },
    }, CAM.SLOT_SPECS));
    const SEASON_SPEC = LK.LOOK_SPECS.season;
    const AVOID_SPEC = Object.freeze({ type: 'partRefs' });
    const NUDGE_LIMITS = Object.freeze({ dx: [-4000, 4000, 0], dy: [-4000, 4000, 0], rot: [-360, 360, 0], s: [0.1, 10, 1] });

    // --- line conditions: season and avoid (DESIGN_2_1 §4.9) ------------------------------------------------------

    // The conditions a cut's automatic picks work under: the effective season (the line pin 'season', rank pin:line
    // only, else the look's season; special cuts have no line) and the line's avoid list ('line/<id>:avoid', line only),
    // made once per plan and line. { season, pinned, deny: { kind: keys } | null, n: { kind: count }, id, line, warnings }.
    // A line's pin warnings are kept on it and replayed wherever it is read (the warner reports each once), so a cast
    // taken from the cache reports them like a fresh one.
    function lineCond(ctx, lineId) {
      if (!lineId) return workCond(ctx);
      const seen = ctx.lineConds || (ctx.lineConds = new Map());
      let c = seen.get(lineId);
      if (c === undefined) {
        const warnings = [];
        const warn = (w) => { warnings.push(w); };
        const at = { cutKey: null, pinCutKey: null, lineId };
        const lineOnly = (spec) => (v, rank) => {
          if (rank !== 'pin:line') return { na: true };
          const x = S.coerce(spec, v);
          return x === undefined ? { bad: true } : { v: x };
        };
        const sp = PA.pinned(ctx.ix, 'season') ? PA.resolvePin(ctx.ix, at, 'season', lineOnly(SEASON_SPEC), warn) : null;
        const ap = PA.pinned(ctx.ix, 'avoid') ? PA.resolvePin(ctx.ix, at, 'avoid', lineOnly(AVOID_SPEC), warn) : null;
        const refs = ap ? ap.v : [];
        if (!sp && !refs.length && !warnings.length) c = workCond(ctx);
        else {
          const deny = refs.length ? {} : null;
          const n = {};
          for (const ref of refs) {
            const dot = ref.indexOf('.');
            const kind = ref.slice(0, dot);
            (deny[kind] || (deny[kind] = [])).push(ref.slice(dot + 1));
            n[kind] = (n[kind] || 0) + 1;
          }
          const season = sp ? sp.v : ctx.look.season;
          c = { season, pinned: !!sp, deny, n, id: (sp ? season + '!' : season) + (refs.length ? '|a:' + refs.join(',') : ''),
            line: lineId, warnings };
        }
        seen.set(lineId, c);
      }
      for (const w of c.warnings) ctx.warn(w);
      return c;
    }

    function workCond(ctx) {
      return ctx.workCond || (ctx.workCond = { season: ctx.look.season, pinned: false, deny: null, n: {}, id: '', line: null,
        warnings: [] });
    }

    // --- pools and part pins -----------------------------------------------------------------------------------

    // registry.pool, cached per plan: filters and amounts are fixed for one plan, the season and avoid list per line.
    function poolOf(ctx, kind, o) {
      const sub = (o.role || '') + '|' + (o.orient || '') + '|' + (o.script || '') + '|' + (o.aspect || '');
      return poolBy(ctx, kind, sub, o.role, o.orient, o.script, o.aspect, o.scope, o.cond);
    }

    function poolBy(ctx, kind, sub, role, orient, script, aspect, scope, cond) {
      return poolEntry(ctx, kind, sub, role, orient, script, aspect, scope, cond).keys;
    }

    // The pool under kind and `sub` (role, orientation, script and aspect as text; a cut makes its text once) and the
    // line conditions: { keys, relaxed }. Gates read the amounts as the backdrop allows them (planner/look gateAmounts).
    // A cut's screen effects never take the work texture again (it already runs over the whole video: risoPink's
    // dotScreen texture plus a dotScreen effect doubled the dots); a pin still can. The line's avoid list is added to
    // the kind's deny filter; when that would empty a pool that is not empty without it, the avoid list is relaxed for
    // that kind (relaxed: the chooser reports avoid-empty).
    function poolEntry(ctx, kind, sub, role, orient, script, aspect, scope, cond) {
      const c = cond || workCond(ctx);
      let byKind = ctx.pools.get(kind);
      if (!byKind) { byKind = new Map(); ctx.pools.set(kind, byKind); }
      const id = (scope ? sub + '|' + scope : sub) + (c.id ? '|' + c.id : '');
      let entry = byKind.get(id);
      if (!entry) {
        let keys = ctx.registry.pool(kind, { role, orient, script, aspect, scope, season: c.season, filters: ctx.doc.filters,
          amounts: LK.gateAmounts(ctx.look.amounts, ctx.doc.look.backdrop, kind) });
        const texture = kind === 'filter' && ctx.look.plan && ctx.look.plan.texture ? ctx.look.plan.texture.v : null;
        if (texture && keys.includes(texture)) keys = keys.filter((k) => k !== texture);
        let relaxed = false;
        const deny = c.deny ? c.deny[kind] : null;
        if (deny && keys.length) {
          const kept = keys.filter((k) => !deny.includes(k));
          if (kept.length) keys = kept; else relaxed = true;
        }
        entry = { keys, relaxed };
        byKind.set(id, entry);
      }
      return entry;
    }

    function serves(ctx, kind, key, role) {
      if (!role) return true;
      const t = ctx.registry.traits(kind, key);
      return !!t && t.roles.includes(role);
    }

    // accept() for a part pin (§3.5): an unknown key (or the wrong ornament scope) is a bad value; a part that does
    // not serve the cut's role is not applicable. List slots and atmos also take 'none'.
    function acceptPart(ctx, kind, role, opts) {
      const o = opts || {};
      return (v) => {
        if (o.none && v === 'none') return { v };
        if (typeof v !== 'string' || !ctx.registry.has(kind, v)) return { bad: true };
        const def = ctx.registry.get(kind, v);
        if (o.scope && def.scope !== o.scope) return { bad: true };
        if (o.checkRole !== false && !serves(ctx, kind, v, role)) return { na: true };
        return { v };
      };
    }

    function filterAllows(filters, kind, key) {
      const f = filters && filters[kind];
      if (!f) return true;
      if (Array.isArray(f.only) && !f.only.includes(key)) return false;
      return !(Array.isArray(f.deny) && f.deny.includes(key));
    }

    function hasFilter(ctx, kind) {
      const f = ctx.doc.filters && ctx.doc.filters[kind];
      return !!f && (Array.isArray(f.only) || Array.isArray(f.deny));
    }

    // Pins win over filters and the season gate, with a warning (§3.8). The season is the cut's effective season
    // (cond, DESIGN_2_1 §4.9); a pinned part on the line's avoid list is used without a warning (pins still win).
    function pinWarnings(ctx, kind, key, pin, cond) {
      if (key === 'none' || typeof key !== 'string') return;
      if (!filterAllows(ctx.doc.filters, kind, key)) ctx.warn({ code: 'pin-filtered', path: pin.at });
      const def = ctx.registry.get(kind, key);
      const season = (cond || workCond(ctx)).season;
      if (def && def.season && season !== 'any' && def.season !== season) {
        ctx.warn({ code: 'pin-off-season', path: pin.at });
      }
    }

    // --- the chooser with its fallbacks (§4.16.4, §3.8) ---------------------------------------------------------

    // chooseAuto(ctx, req) → { v, from, stage, base, ref, win } (base / ref: the natural and reference picks, see
    // createHistory; win: the winner before req.avoid, which v differs from only when the winner was avoided).
    // req = { kind, slot, path, feat, role, orient, script, scope, chosen, seed, recent, ref, echo, avoid, list, orNone,
    // cutKey, trace, silent, cond (the line conditions of lineCond; default the work's), noMedia (derived media grounds
    // weigh 0 here, DESIGN_2_1 §11.5.9), pv (文字PVの定石's factor of the cut's part, planner/conventions partFactor) }.
    // Stages (§4.16.4, §3.8): the full weights; the same pool without traitFit and fits; the pool without the text
    // traits (orient, script, aspect); then the kind's fallback — or 'none' for a list slot whose fallback does not
    // serve the cut's role, and for atmos (orNone). pool-empty is reported on lyric cuts, and elsewhere only when the
    // fallback itself is outside the user's filter (a seam filter of just the hard cut is fully honoured by the
    // fallback). A pick from a pool whose avoid list had to be relaxed reports avoid-empty. silent: no warnings
    // (explain's alternatives, the natural pass).
    function chooseAuto(ctx, req) {
      const trace = req.trace || null;
      const cond = req.cond || workCond(ctx);
      const ask = {
        kind: req.kind, keys: null, noFit: false, trace: null, feat: req.feat, chosen: req.chosen, seed: req.seed,
        variety: ctx.look.variety, recent: req.recent, ref: req.ref || null, echo: req.echo,
        moodFilter: req.kind === 'filter', avoid: req.avoid || null, season: cond.season, seasonPinned: cond.pinned,
        noMedia: !!req.noMedia, pv: req.pv || null,
      };
      const sub = req.poolId !== undefined ? req.poolId
        : (req.role || '') + '|' + (req.orient || '') + '|' + (req.script || '') + '|' + (ctx.aspect || '');
      const full = poolEntry(ctx, req.kind, sub, req.role, req.orient, req.script, ctx.aspect, req.scope, cond);
      if (trace) trace.cond = cond;
      for (let stage = 0; stage < 3; stage++) {
        const entry = stage < 2 ? full
          : poolEntry(ctx, req.kind, (req.role || '') + '|||', req.role, undefined, undefined, undefined, req.scope, cond);
        const keys = entry.keys;
        if (!keys.length) continue;
        ask.keys = keys;
        ask.noFit = stage > 0;
        ask.trace = trace ? [] : null;
        const hit = ctx.chooser.pick(ask);
        const name = stage === 0 ? 'auto' : 'relaxed';
        if (trace) {
          Object.assign(trace, { keys, candidates: ask.trace, noFit: ask.noFit, stage: name,
            avoided: hit ? hit.avoided || null : null, avoidRelaxed: entry.relaxed });
          if (hit && hit.letterFallback) trace.letterFallback = true;
        }
        if (hit) {
          if (entry.relaxed && !req.silent) ctx.warn({ code: 'avoid-empty', path: 'line/' + cond.line + ':avoid', line: cond.line });
          return { v: hit.v, from: 'auto', stage: name, base: hit.base, ref: hit.ref, win: hit.avoided || hit.v };
        }
      }
      if (req.orNone) {
        if (trace) trace.stage = 'none';
        return { v: 'none', from: 'auto', stage: 'none' };
      }
      const fb = ctx.registry.fallback(req.kind);
      if (req.list && !serves(ctx, req.kind, fb, req.role)) {
        if (trace) trace.stage = 'none';
        return { v: 'none', from: 'rule', stage: 'none', rule: 'role' };
      }
      const excluded = !filterAllows(ctx.doc.filters, req.kind, fb);
      if (!req.silent && (PER_CUT_ROLES.has(req.role) || excluded)) {
        ctx.warn({ code: 'pool-empty', path: req.path, cut: req.cutKey || undefined });
      }
      if (trace) trace.stage = 'fallback';
      return { v: fb, from: 'fallback', stage: 'fallback' };
    }

    // --- history (recency and echo) -----------------------------------------------------------------------------

    // What earlier cuts chose, for recency and echoes (§4.16.4). Every cut leaves, per choice slot, its natural pick
    // (the argmax without recency factors and, for a rerolled cut, without its salts) and its reference pick (the
    // argmax with recency against its neighbours' natural picks); pins, rules and fallbacks are facts, so both are the
    // value. A cut then weighs ×0.03 against the previous cut's natural and reference picks (×0.5 against their
    // families) and ×0.35 against the natural picks of the 3 cuts before that. A cut's final value is usually its
    // reference pick and differs where that pick would repeat the previous cut, so neighbours rarely repeat (about
    // 0.5 %). Neither pick depends on anything but the few cuts before, so a changed cut reaches only the next 5 cuts
    // (the runner-up rule of arrange/arrive, which looks at the previous cut's final value, rarely passes it on once
    // more) and a reroll stays local (§3.7). A list kind is one group over all its indices.
    function createHistory(registry) {
      const rows = [];
      const byCut = new Map();
      let lastCopyOf = null;
      // push(cutKey, row, copyOf): row = historyRow(…) of the cut; copyOf = the first sung copy's cut key of the line
      // cut it sings (its feat.repeatOf, or its own key; see follows).
      // The recency sets asked for since the last push (setsOf), per `which` and group.
      const sets = { both: new Map(), base: new Map() };
      function push(cutKey, row, copyOf) {
        rows.push(row);
        byCut.set(cutKey, row);
        lastCopyOf = copyOf || null;
        sets.both.clear();
        sets.base.clear();
      }
      // The rows the next cut's choices read (for the cast cache): the three before the previous one (their natural
      // picks), the previous one (its natural and reference picks and final values) and the row of the cut it echoes.
      function rowsRead(repeatOf) {
        const n = rows.length;
        const row = (i) => (i >= 0 && i < n ? rows[i] : null);
        return [row(n - 4), row(n - 3), row(n - 2), row(n - 1), repeatOf ? byCut.get(repeatOf) || null : null];
      }
      function at(i, which, g) { return i >= 0 && i < rows.length ? rows[i][which].get(g) || NONE : NONE; }
      // The sets (small arrays, read only) of one kind and group against the previous row's `which` values, made once
      // per push; own values (see recent) are added to a copy.
      function setsOf(kind, g, which, own) {
        const cache = sets[which];
        let base = cache.get(g);
        if (base === undefined) {
          const n = rows.length;
          const prev = at(n - 1, which, g);
          const families = [];
          for (const key of prev) {
            const def = registry.get(kind, key);
            if (def && def.family && !families.includes(def.family)) families.push(def.family);
          }
          const near = [];
          for (let i = n - 4; i < n - 1; i++) for (const key of at(i, 'base', g)) if (!near.includes(key)) near.push(key);
          base = { prev, near, families };
          cache.set(g, base);
        }
        if (!own || !own.length) return base;
        const prev = base.prev.slice();
        for (const key of own) if (!prev.includes(key)) prev.push(key);
        return { prev, near: base.near, families: base.families };
      }
      // { prev, near, families } for the cut after the last pushed one; `own` = values already chosen in this cut
      // for the same list kind (they count as the previous cut: no two equal decorations in one cut). The sets are
      // shared: callers only read them.
      function recent(kind, slot, own) { return setsOf(kind, groupOf(slot), 'both', own); }
      // The same for the reference pick: against the previous cut's natural pick only.
      function reference(kind, slot, own) { return setsOf(kind, groupOf(slot), 'base', own); }
      // The previous cut's final value of a slot, or null.
      function previous(slot) {
        const v = rows.length ? rows[rows.length - 1].last.get(slot) : undefined;
        return v === undefined ? null : v;
      }
      // The previous cut's shot as it would be without any salt (its row's shadow; see castCut), or null.
      function unsaltedShot() { return rows.length ? rows[rows.length - 1].shadow : null; }
      // What the earlier identical line's cut picked for this slot: its natural pick; for cam.shot the preset it shows
      // (its heir, planner/camera heirOf), which its repeats inherit or, where they may not, weigh as the echo.
      function echo(repeatOf, slot) {
        const row = repeatOf ? byCut.get(repeatOf) : null;
        if (!row) return null;
        if (slot === 'cam.shot') return row.heir && row.heir.v !== 'none' ? row.heir.v : null;
        return row.own[slot] || null;
      }
      // What a repeat of that cut inherits from it (planner/camera heirOf), or null.
      function heir(repeatOf) {
        const row = repeatOf ? byCut.get(repeatOf) : null;
        return row ? row.heir : null;
      }
      // Whether the previous cut sings the same line cut as a repeat of repeatOf: that cut itself or another repeat of
      // it (a line sung twice or more in a row).
      function follows(repeatOf) { return !!repeatOf && lastCopyOf === repeatOf; }
      // Whether a row the next cut reads (rowsRead) has a salt-free twin (row.free; castCut) that differs from it where
      // the next cut's parts read that row (TWIN_FIELDS at its place): then the cut's salt-free cast reads the twins.
      function twinned(repeatOf) {
        const n = rows.length;
        for (let i = Math.max(0, n - 4); i < n; i++) if (twinDiffers(rows[i], TWIN_FIELDS[i - n + 4])) return true;
        const e = repeatOf ? byCut.get(repeatOf) : null;
        return !!e && twinDiffers(e, TWIN_FIELDS[4]);
      }
      // The same reads for the next cut with each row that has a twin replaced by it (the cut's salt-free re-cast,
      // planner/cast unsaltedCast): a history of just the rows those reads touch.
      function unsalted(repeatOf) {
        const h = createHistory(registry);
        const twin = (row) => (row.free ? Object.assign({}, row, row.free, { free: null }) : row);
        const n = rows.length;
        for (let i = Math.max(0, n - 4); i < n; i++) h.push(null, twin(rows[i]), i === n - 1 ? lastCopyOf : null);
        const e = repeatOf ? byCut.get(repeatOf) : null;
        if (e) h.name(repeatOf, twin(e));
        return h;
      }
      // Registers a row under a cut key without adding it to the window (unsalted: the echoed row).
      function name(cutKey, row) { byCut.set(cutKey, row); }
      // The packed directions of the k-th cut before the next one (文字PVの定石, planner/flow), or NO_DIR (13).
      function prevDir(k) {
        const row = rows.length >= k ? rows[rows.length - k] : null;
        return row && typeof row.dir === 'number' ? row.dir : NO_DIR;
      }
      return { push, recent, reference, previous, unsaltedShot, echo, heir, follows, rowsRead, twinned, unsalted, name, prevDir };
    }

    const NONE = Object.freeze([]);
    const NO_DIR = 13;

    // The recency group of a slot: its kind for list slots ('ornament#1' → 'ornament'), else the slot itself.
    const groups = new Map();
    function groupOf(slot) {
      let g = groups.get(slot);
      if (g === undefined) {
        const m = /^(ornament|filter)#/.exec(slot);
        g = m ? m[1] : slot;
        groups.set(slot, g);
      }
      return g;
    }

    // A slot whose value takes part in recency and echoes: part choices, and the preset shots of cam.shot (DESIGN_2_1
    // §3.9; a custom shot object is not a choice).
    function isChoice(slot, v) {
      return typeof v === 'string' && v !== 'none' && ((slot.indexOf('.') < 0 && slot !== 'orient') || slot === 'cam.shot');
    }

    function addTo(map, g, v) {
      const list = map.get(g);
      if (!list) map.set(g, [v]); else if (!list.includes(v)) list.push(v);
    }

    // historyRow(slots, natural, refs) → what a cut leaves in the history: per group its natural picks (base) and its
    // natural and reference picks (both), per slot its final value (last) and natural pick (own), and what its repeats
    // inherit (heir), its shot without salts (shadow) and, for a salted cut or one whose picks the salts reached, the
    // same four fields as they would be without any salt (free; heir, shadow and free are set by castCut). slots = the cut's decisions (as its neighbours
    // see them); natural / refs = { slot: pick }. Rows never change, so a cached cast keeps its row.
    function historyRow(slots, natural, refs) {
      const row = { base: new Map(), both: new Map(), last: new Map(), own: {}, heir: null, shadow: null, free: null, dir: NO_DIR };
      for (const slot of Object.keys(natural)) {
        const v = natural[slot];
        if (!isChoice(slot, v)) continue;
        row.own[slot] = v;
        addTo(row.base, groupOf(slot), v);
        addTo(row.both, groupOf(slot), v);
      }
      for (const slot of Object.keys(refs)) if (isChoice(slot, refs[slot])) addTo(row.both, groupOf(slot), refs[slot]);
      for (const slot of Object.keys(slots)) {
        const d = slots[slot];
        if (d && isChoice(slot, d.v)) row.last.set(slot, d.v);
      }
      return row;
    }

    // Whether two history windows (createHistory rowsRead) lead to the same choices: the same rows, or rows with the
    // same values where the next cut reads them (recency reads memberships, so the order inside a group is free). The
    // three rows before the previous one are read for their natural picks (near); the previous one for its natural
    // picks (the reference pick weighs against them), both picks (recent), final values (previous) and shadow; the
    // echoed row for its own picks and its heir (the shot its repeats inherit, and whether that cut shows it). A cut's
    // salt-free re-cast reads the same fields of each row's twin (row.free; unsaltedCast), and whether a twin differs
    // from its row decides whether it re-casts, so the twins compare too (a row with one never equals a row without).
    // (文字PVの定石: the two rows before the next cut also give their packed directions, dir, which its alternation reads.)
    const ROW_FIELDS = Object.freeze([['base'], ['base'], ['base', 'dir'], ['base', 'both', 'last', 'shadow', 'dir'], ['own', 'heir']]);
    const TWIN_FIELDS = Object.freeze([['base'], ['base'], ['base'], ['base', 'both', 'last'], ['own']]);
    const TWIN_ALL = Object.freeze(['base', 'both', 'last', 'own']);
    function sameRows(a, b) {
      for (let i = 0; i < ROW_FIELDS.length; i++) {
        const x = a[i], y = b[i];
        if (x === y) continue;
        if (!x || !y || !sameFields(x, y, ROW_FIELDS[i])) return false;
        if (x.free !== y.free && (!x.free || !y.free || !sameFields(x.free, y.free, TWIN_FIELDS[i]))) return false;
      }
      return true;
    }

    // Whether a row's twin differs from the row in the fields a cut's salt-free re-cast (up to its camera slots) reads
    // of it. The shot and the screen effects are left out: the re-cast reads the previous shot from the shadow and the
    // near shots from base, whose shot the twin shares (castCut), and it stops before the screen effects (twinOf has
    // none).
    function twinDiffers(row, fields) {
      const t = row ? row.free : null;
      if (!t) return false;
      for (const f of fields) {
        if (!(f === 'own' ? sameRecord(row.own, t.own, unread) : sameMap(row[f], t[f], unread))) return true;
      }
      return false;
    }
    function unread(key) { return key === 'cam.shot' || key.startsWith('filter'); }

    function sameFields(x, y, fields) {
      for (const f of fields) {
        const same = f === 'own' ? sameRecord(x.own, y.own) : f === 'heir' ? sameHeir(x.heir, y.heir)
          : f === 'shadow' || f === 'dir' ? x[f] === y[f] : sameMap(x[f], y[f]);
        if (!same) return false;
      }
      return true;
    }

    // skip(key): the keys left out of the comparison (twinDiffers), or undefined.
    function sameMap(a, b, skip) {
      if (skip === undefined && a.size !== b.size) return false;
      for (const [k, v] of a) {
        if (skip && skip(k)) continue;
        const w = b.get(k);
        if (Array.isArray(v) ? !(Array.isArray(w) && v.length === w.length && v.every((x) => w.includes(x))) : v !== w) return false;
      }
      if (skip) for (const k of b.keys()) if (!skip(k) && !a.has(k)) return false;
      return true;
    }

    function sameHeir(a, b) {
      return a === b || (!!a && !!b && a.v === b.v && a.cause === b.cause && a.frames === b.frames && a.curve === b.curve &&
        a.shows === b.shows && a.showsCurve === b.showsCurve);
    }

    function sameRecord(a, b, skip) {
      const ka = Object.keys(a);
      if (skip === undefined && ka.length !== Object.keys(b).length) return false;
      for (const k of ka) if (!(skip && skip(k)) && a[k] !== b[k]) return false;
      if (skip) for (const k of Object.keys(b)) if (!skip(k) && !(k in a)) return false;
      return true;
    }

    // --- repeated lines the same way (「くり返しの行をそろえる」, DESIGN_2_1 §4.10) ---------------------------------

    // The opt-in, a pin (work or line; off without one): a cut of a line sung again takes the cut decisions of the
    // same cut of an earlier copy (its source, alignments), as the Plan shows them, with that copy's pins, locks and
    // rerolls: orientation, layout, text, motion speed, entrance, hold and exit with their parameters, decorations,
    // lens, camerawork and screen effects. The cut's own pins win, a reroll of the cut or of its line leaves every slot
    // to the chooser and a die on one slot that slot (and a die on a parameter that parameter); a value that does not
    // fit the cut (not in its pool, or a part whose fits gives 0 there) is chosen as usual. Element pins (nudge, fill,
    // hide) stay the cut's own.
    const REPEAT = 'repeat.same';
    function acceptRepeat(v) { return typeof v === 'boolean' ? { v } : { bad: true }; }
    function atOfCut(cut) { return { cutKey: cut.key, pinCutKey: cut.pinKey, lineId: cut.line }; }

    // alignments(ctx, cuts) → Map<cut key, source cut> | null (null when no scope pins the opt-in and it is off by
    // default; plan.run keeps it as ctx.align before casting). The default is 文字PVの定石's (DESIGN_2_2 §2.1.4 a): on in
    // a new work unless pinned off (ctx.rules; without it, as planner/rules reads ctx.doc; a stub { ix } is off). A run is consecutive lines that sing the same line (a line sung twice in a row is a
    // run of two). A copy takes the line at its place in the first run of that line: the first copy for a copy sung
    // alone, the second of the first run for the second of a later run; cut by cut, the cut at the same offset. The
    // first run's own copies are chosen (so a line sung twice in a row does not play the same thing back to back), and
    // so is a copy past the end of the first run. The two cuts must have the same text, role and impact mark (another
    // split, or an impact the first copy lacks, keeps the cut's own look), and the opt-in must resolve on at the copy.
    function alignments(ctx, cuts) {
      const pinnedAny = PA.pinned(ctx.ix, REPEAT);
      const def = ctx.rules ? ctx.rules.repeatDefault : RU.repeatDefault(ctx.doc || null, ctx.ix);
      if (!pinnedAny && !def) return null;
      const out = new Map(), byKey = new Map(), runs = new Map();
      let line = null, source = null, open = null, prev = null, pos = 0;
      for (const cut of cuts) {
        byKey.set(cut.key, cut);
        if (cut.line !== line) {
          line = cut.line;
          source = null;
          const first = cut.feat.repeatOf ? byKey.get(cut.feat.repeatOf) : null;
          const group = !line ? null : first ? first.line : line;
          pos = group !== null && group === prev ? pos + 1 : 0;
          prev = group;
          if (open !== group) open = null;
          if (group === null) continue;
          if (group === line) { runs.set(group, [line]); open = group; } else {
            const run = runs.get(group);
            if (run && open === group) run.push(line);
            else if (run && pos < run.length) source = run[pos];
          }
        }
        if (source === null) continue;
        const src = byKey.get(source + cut.key.slice(cut.key.indexOf('~')));
        if (!src || src.text !== cut.text || src.role !== cut.role || !!src.impact !== !!cut.impact) continue;
        const pin = pinnedAny ? PA.resolvePin(ctx.ix, atOfCut(cut), REPEAT, acceptRepeat, null) : null;
        if (pin ? pin.v === true : def) out.set(cut.key, src);
      }
      return out;
    }

    // The opt-in as the cut sees it (the pin that applies there), kept among its decisions so the inspector shows it.
    function decideRepeat(st) {
      const { ctx, at } = st;
      if (!PA.pinned(ctx.ix, REPEAT)) return;
      const trace = tracing(st, REPEAT);
      const pin = PA.resolvePin(ctx.ix, at, REPEAT, acceptRepeat, ctx.warn);
      if (pin) setDecision(st, REPEAT, pinDecision(pin));
      if (trace) {
        Object.assign(trace, { stage: pin ? 'pin' : 'auto', pin, decision: pin ? st.slots[REPEAT] : null, rule: REPEAT,
          why: pin ? null : [{ code: 'rule', params: { rule: REPEAT } }] });
      }
    }

    // The source's decision of one slot, or null: no source, the cut or its line rerolled (st.rerolled), or a die on
    // the slot. st.aligned = this, for planner/camera.
    function alignedDecision(st, slot) {
      const src = st.align;
      if (!src || st.rerolled || fieldSalted(st.ctx, st.cut, slot)) return null;
      return src.slots[slot] || null;
    }

    function alignWhy(st) { return { code: 'repeat.same', params: { cut: st.align.key } }; }

    // neighboursOf(align, cuts) → { ahead, before } | null (plan.run keeps it as ctx.alignNear): ahead = Map<key of the
    // cut right before a repeat that has a source, that source>; before = Map<source key, the cut right before it>.
    function neighboursOf(align, cuts) {
      if (!align) return null;
      const ahead = new Map(), before = new Map();
      for (let i = 1; i < cuts.length; i++) {
        const src = align.get(cuts[i].key);
        if (src) ahead.set(cuts[i - 1].key, src);
      }
      const sources = new Set();
      for (const src of align.values()) sources.add(src.key);
      for (let i = 1; i < cuts.length; i++) if (sources.has(cuts[i].key)) before.set(cuts[i].key, cuts[i - 1]);
      return { ahead, before };
    }

    // §8.2 (no identical neighbouring layout or entrance) for a repeat: its source's value is passed over when the cut
    // right before already shows it, unless the cut before the source showed it too (the pair is as it was then).
    function nearClash(st, slot, v) {
      if (st.hist.previous(slot) !== v) return false;
      const pb = st.ctx.alignNear ? st.ctx.alignNear.before.get(st.align.key) : null;
      return !(pb && pb.slots && pb.slots[slot] && pb.slots[slot].v === v);
    }

    // What the chooser passes over for a layout or an entrance (§8.2 no identical neighbours): the previous cut's value,
    // and on the cut right before a repeat (st.ahead) also the value the repeat takes from its source.
    function avoidOf(st, slot) {
      const prev = st.hist.previous(slot);
      const next = st.ahead && st.ahead.slots ? st.ahead.slots[slot] : null;
      return next && next.v !== prev ? [prev, next.v] : prev;
    }

    // alignedSource(ctx, cut, slot) → the cut's source for a slot planner/tracks decides (ground, atmos, seam), or null:
    // the cut has none, or it or its line is rerolled, or a die is on that slot.
    function alignedSource(ctx, cut, slot) {
      const src = ctx.align ? ctx.align.get(cut.key) || null : null;
      if (!src) return null;
      const s = ctx.salts;
      if (s && (s['cut/' + cut.key] || (cut.line && s['line/' + cut.line]) || fieldSalted(ctx, cut, slot))) return null;
      return src;
    }

    function pinnedFrom(d) { return typeof d.from === 'string' && d.from.startsWith('pin'); }

    // The value slots that follow the source (orient: in its own auto, after the rule of a pinned layout).
    const ALIGN_VALUES = new Set(['text.face', 'text.scale', 'text.ink', 'text.style', 'motion.speed', 'ornament.count',
      'filter.count']);

    function alignedValue(st, slot, spec, applies, withWhy) {
      const ad = alignedDecision(st, slot);
      if (!ad) return null;
      const v = S.coerce(spec, ad.v);
      if (v === undefined || (applies && !applies(v))) return null;
      const d = { v, from: 'auto' };
      if (withWhy) d.why = [alignWhy(st)];
      return d;
    }

    // The source's part for one slot where it fits the cut: an automatic pick in the cut's own pool (its role,
    // orientation, script, aspect and line conditions) whose fits does not give 0; a pinned or locked part where it
    // serves the cut's role and orientation (a pin wins over the pools there too); 'none' of a list slot. A rule's or a
    // fallback's value is left to the cut's own rules.
    function alignedPart(st, kind, slot, list) {
      const ad = alignedDecision(st, slot);
      if (!ad || typeof ad.v !== 'string') return null;
      const { ctx, cut } = st;
      if (ad.v === 'none') return list && (ad.from === 'auto' || pinnedFrom(ad)) ? ad : null;
      if (!ctx.registry.has(kind, ad.v)) return null;
      const scope = kind === 'ornament' ? 'cut' : null;
      const traits = ctx.registry.traits(kind, ad.v);
      if (traits && Array.isArray(traits.orient) && st.chosen.orient && !traits.orient.includes(st.chosen.orient)) return null;
      if (pinnedFrom(ad)) return 'v' in acceptPart(ctx, kind, cut.role, { none: list, scope })(ad.v) ? ad : null;
      if (ad.from !== 'auto') return null;
      if (AVOID_REPEAT.has(kind) && !st.natural && nearClash(st, slot, ad.v)) return null;
      if (!poolEntry(ctx, kind, poolIdOf(st), cut.role, st.chosen.orient, cut.feat.script, ctx.aspect, scope, st.cond).keys
        .includes(ad.v)) return null;
      const def = ctx.registry.get(kind, ad.v);
      if (typeof def.fits === 'function' && !(Number(def.fits(st.feat, st.chosen)) > 0)) return null;
      return ad;
    }

    // An aligned part (or a part a rule gives the cut and its source alike) keeps the source's parameters (a value the
    // motion speed scaled, 'rule', or 文字PVの定石 turned, 'alt', is the cut's own automatic value), except those
    // pinned at the cut or rerolled there (a die on the
    // parameter, 'cut/<key>:<param path>' or 'line/<id>:<param path>'), which the cut resolved itself (d, after its
    // motion speed). The copies are plain values: the source's motion speed is already in them (the speed is aligned
    // too), and a lock of the line pins them as they are.
    // → the decision with the copies (d itself when nothing changed).
    function copyParams(st, kind, idx, d, ad) {
      if (!d.p || !ad.p) return d;
      const { ctx, cut } = st;
      const pfrom = d.pfrom || null;
      let p = null, dropped = null;
      for (const { name, shared } of ctx.registry.params(kind, d.v) || []) {
        if (!(name in d.p) || !(name in ad.p)) continue;
        const from = pfrom ? pfrom[name] : undefined;
        if (from !== undefined && from !== 'rule' && from !== 'alt') continue;
        if (ctx.salts && fieldSalted(ctx, cut, P.slotParamPath(kind, idx, d.v, name, shared))) continue;
        (p || (p = Object.assign({}, d.p)))[name] = ad.p[name];
        if (from === 'rule' || from === 'alt') (dropped || (dropped = new Set())).add(name);
      }
      if (!p) return d;
      const out = { v: d.v, from: d.from, p };
      if (pfrom) {
        const rest = {};
        let any = false;
        for (const k of Object.keys(pfrom)) if (!dropped || !dropped.has(k)) { rest[k] = pfrom[k]; any = true; }
        if (any) out.pfrom = rest;
      }
      return out;
    }

    // --- one cut -------------------------------------------------------------------------------------------------

    // The look as parameter autos read it (made once per plan; silent copies of ctx share it).
    function lookAx(ctx) {
      return ctx.lookAxis || (ctx.lookAxis = { amounts: ctx.look.amounts, mood: ctx.look.mood, bpm: ctx.bpm });
    }

    function tracing(st, slot) {
      const t = st.ctx.trace;
      if (!t || t.cutKey !== st.cut.key || t.slot !== slot) return null;
      t.hit = true;
      return t.out;
    }

    // The pool text of a cut (poolOf's `sub`), made once its orientation is decided.
    function poolIdOf(st) {
      if (st.poolKey === null) {
        st.poolKey = (st.cut.role || '') + '|' + (st.chosen.orient || '') + '|' + (st.cut.feat.script || '') + '|' +
          (st.ctx.aspect || '');
      }
      return st.poolKey;
    }

    function seedOf(st, slot) {
      return CH.slotSeedAt(st.slotPrefix, st.cut.key, st.cut.line, slot, st.ctx.salts);
    }

    function setDecision(st, slot, d) {
      st.slots[slot] = d;
      st.chosen[slot] = d.v;
    }

    function pinDecision(pin) { return { v: pin.v, from: pin.from, by: pin.by }; }

    // The kinds that pass over the previous cut's value (§8.2), and under 「パートごとに演出をそろえる」 holds and camera
    // textures too (planner/kit KIT_AVOID).
    function avoids(ctx, kind) { return AVOID_REPEAT.has(kind) || (!!ctx.pv && ctx.pv.avoidAlso(kind)); }

    // A part slot: pin (cut > line > work) → rule (forced value) → chooser; then its parameters.
    function decidePart(st, kind, idx, opts) {
      const o = opts || {};
      const { ctx, cut, at } = st;
      const slot = idx === null ? kind : kind + '#' + idx;
      const seed = seedOf(st, slot);
      const list = LIST_KINDS.includes(kind);
      const trace = tracing(st, slot);
      const pin = !PA.pinned(ctx.ix, slot) ? null : PA.resolvePin(ctx.ix, at, slot, o.force ? () => ({ na: true })
        : acceptPart(ctx, kind, cut.role, { none: list, scope: kind === 'ornament' ? 'cut' : null }), ctx.warn);
      let d, ad = null;
      if (pin) {
        pinWarnings(ctx, kind, pin.v, pin, st.cond);
        d = pinDecision(pin);
        if (trace) Object.assign(shadow(st, kind, slot, seed, list, trace), { kind, stage: 'pin', pin });
      } else if (o.force) {
        d = { v: o.force, from: 'rule' };
        if (trace) Object.assign(shadow(st, kind, slot, seed, list, trace), { kind, stage: 'rule', rule: o.rule });
      } else if (st.align && (ad = alignedPart(st, kind, slot, list)) !== null) {
        d = { v: ad.v, from: 'auto' };
        if (trace) Object.assign(shadow(st, kind, slot, seed, list, trace), { kind, stage: 'auto', why: [alignWhy(st)] });
      } else {
        const own = list ? ownValues(st, kind, idx) : null;
        const recent = st.natural ? null : st.hist.recent(kind, slot, own);
        const ref = st.natural ? null : st.hist.reference(kind, slot, own);
        const echo = st.hist.echo(cut.feat.repeatOf, slot);
        if (trace) Object.assign(trace, { kind, recent, echo });
        const got = chooseAuto(ctx, {
          kind, slot, path: 'cut/' + cut.key + ':' + slot, feat: st.feat, role: cut.role, orient: st.chosen.orient,
          script: cut.feat.script, scope: kind === 'ornament' ? 'cut' : null, chosen: st.chosen, seed, recent, echo,
          list, cutKey: cut.key, trace, silent: st.natural, ref, poolId: poolIdOf(st), cond: st.cond,
          avoid: avoids(ctx, kind) && !st.natural ? avoidOf(st, slot) : null,
          pv: ctx.pv ? ctx.pv.partFactor(st, kind, idx) : null,
        });
        d = { v: got.v, from: got.from };
        if (got.base && got.base !== got.v) st.base[slot] = got.base;
        if (got.ref && got.ref !== got.v) st.ref[slot] = got.ref;
        if (trace && got.rule) trace.rule = got.rule;
      }
      if (d.v !== 'none' && !st.natural) {
        const def = ctx.registry.get(kind, d.v);
        const { p, pfrom } = PA.resolveParams(def, kind, idx, at, ctx.ix, {
          registry: ctx.registry, seed, salts: ctx.salts, warn: ctx.warn, f: st.feat, look: lookAx(ctx), media: ctx.media,
        });
        d.p = p;
        if (pfrom) d.pfrom = pfrom;
        if (MOTION_KINDS.includes(kind)) CAM.applySpeed(st, kind, d);
        // The source's parameters wherever the cut shows the source's part: taken from it, or given by the same rule (a
        // layout that moves the text itself forces the same motions).
        const same = ad || (st.align && !pin ? alignedDecision(st, slot) : null);
        const copied = !!same && same.v === d.v;
        if (copied) d = copyParams(st, kind, idx, d, same);
        // 「動きの向きを交互にする」 (DESIGN_2_2 §2.2.4 b): the cut's directional parameters against the previous cut's (an
        // aligned copy keeps its source's, which still give the cut its direction).
        if (ctx.pv) {
          const why = ctx.pv.flipParams(st, kind, idx, seed, d, copied);
          if (trace && why) trace.pvFlip = why;
        }
      }
      if (trace) trace.decision = d;
      setDecision(st, slot, d);
      return d;
    }

    // For explain: what the chooser would weigh here if the slot were automatic (alternatives of a pinned slot).
    function shadow(st, kind, slot, seed, list, trace) {
      const { ctx, cut } = st;
      const idx = slot.indexOf('#') > 0 ? Number(slot.slice(slot.indexOf('#') + 1)) : 0;
      const recent = st.hist.recent(kind, slot, list ? ownValues(st, kind, idx) : null);
      const echo = st.hist.echo(cut.feat.repeatOf, slot);
      chooseAuto(ctx, { kind, slot, path: 'cut/' + cut.key + ':' + slot, feat: st.feat, role: cut.role,
        orient: st.chosen.orient, script: cut.feat.script, scope: kind === 'ornament' ? 'cut' : null, chosen: st.chosen,
        seed, recent, echo, list, cutKey: cut.key, trace, silent: true, cond: st.cond,
        pv: ctx.pv ? ctx.pv.partFactor(st, kind, list ? idx : null) : null });
      return Object.assign(trace, { recent, echo });
    }

    function ownValues(st, kind, idx) {
      const out = [];
      for (let i = 0; i < idx; i++) {
        const d = st.slots[kind + '#' + i];
        if (d && d.v !== 'none') out.push(d.v);
      }
      return out;
    }

    // A non-part slot: pin (coerced through its spec, plus an optional applicability check) or the auto value,
    // autoFn(seed, withWhy). The auto may return `rule` (its rule name) and, when asked (withWhy: explain is tracing
    // this slot), `why` (explain's reasons, planner/camera); both go to the trace, never into the Plan.
    function decideValue(st, slot, spec, autoFn, applies) {
      const { ctx, at } = st;
      const trace = tracing(st, slot);
      const pin = !PA.pinned(ctx.ix, slot) ? null : PA.resolvePin(ctx.ix, at, slot, (v) => {
        const c = S.coerce(spec, v);
        if (c === undefined) return { bad: true };
        return applies && !applies(c) ? { na: true } : { v: c };
      }, ctx.warn);
      const al = !pin && st.align && ALIGN_VALUES.has(slot) ? alignedValue(st, slot, spec, applies, !!trace) : null;
      if (al) (st.fromAlign || (st.fromAlign = new Set())).add(slot);
      const got = pin ? pinDecision(pin) : al || autoFn(seedOf(st, slot), !!trace);
      const d = got.rule !== undefined || got.why !== undefined ? withoutTrace(got) : got;
      if (trace) Object.assign(trace, { stage: pin ? 'pin' : d.from === 'rule' ? 'rule' : 'auto', pin, decision: d,
        rule: d.from === 'rule' ? got.rule || slot : slot, why: pin ? null : got.why || null });
      setDecision(st, slot, d);
      return d;
    }

    // A decision without the trace-only fields rule and why. A new object rather than `delete`, which would leave the
    // decision a slow (dictionary) object for everything that reads it later: encoding, freezing, copying.
    function withoutTrace(d) {
      const out = {};
      for (const k of Object.keys(d)) if (k !== 'rule' && k !== 'why') out[k] = d[k];
      return out;
    }

    // orient (§4.16.4): 'h' when the text cannot stand vertically; else 'v' with probability
    // 0.12 + 0.25·norm(literary bias) + 0.15 on tall aspects. A pinned arrange that works in one orientation only
    // sets the orientation (rule).
    function decideOrient(st) {
      const { ctx, cut, at } = st;
      const allowed = cut.feat.orients;
      return decideValue(st, 'orient', SLOT_SPECS.orient, (seed, withWhy) => {
        const pin = PA.resolvePin(ctx.ix, at, 'arrange', acceptPart(ctx, 'arrange', cut.role), null);
        if (pin) {
          const only = ctx.registry.traits('arrange', pin.v).orient;
          if (only.length === 1 && allowed.includes(only[0])) return { v: only[0], from: 'rule', rule: 'arrange' };
        }
        const aligned = st.align ? alignedValue(st, 'orient', SLOT_SPECS.orient, (v) => allowed.includes(v), withWhy) : null;
        if (aligned) return aligned;
        if (!allowed.includes('v')) return { v: 'h', from: 'auto' };
        const bias = ctx.look.mood.tagBias && typeof ctx.look.mood.tagBias.literary === 'number'
          ? ctx.look.mood.tagBias.literary : 1;
        const p = 0.12 + 0.25 * N.clamp((bias - 0.25) / 1.75) + (TALL_ASPECTS.has(ctx.aspect) ? 0.15 : 0);
        return { v: R.fromSeed(seed).next() < p ? 'v' : 'h', from: 'auto' };
      }, (v) => allowed.includes(v));
    }

    function decideText(st) {
      const { ctx } = st;
      decideValue(st, 'text.face', SLOT_SPECS['text.face'], (seed) => {
        const serif = FACE_WEIGHTS.serif * (st.chosen.orient === 'v' ? 2 : 1);
        const w = [FACE_WEIGHTS.display, serif, FACE_WEIGHTS.body];
        // the face class of the part's set of looks (「パートごとに演出をそろえる」)
        const kit = ctx.pv ? ctx.pv.faceBoost(st) : null;
        if (kit) w[FACES.indexOf(kit)] *= FACE_KIT;
        const v = R.fromSeed(seed).weighted(FACES, w);
        return { v, from: 'auto' };
      });
      decideValue(st, 'text.scale', SLOT_SPECS['text.scale'],
        () => ({ v: S.coerce(SLOT_SPECS['text.scale'], 1 + (st.feat.energy - 0.5) * 0.2), from: 'auto' }));
      decideValue(st, 'text.ink', SLOT_SPECS['text.ink'], () => ({ v: 'ink', from: 'auto' }));
      decideValue(st, 'text.style', SLOT_SPECS['text.style'], () => {
        const style = S.coerce(SLOT_SPECS['text.style'], ctx.look.theme.style);
        return { v: style === undefined ? 'plain' : style, from: 'auto' };
      });
    }

    // How much a mood wants screen effects on its cuts (filter.count, §4.16.4): its glitch or chroma amount, or its
    // film side — the texture amount times the weight of its favourite screen effect (mood.filters). Glitch and chroma
    // alone left the film moods almost bare although their blurbs promise their effects: silverReel 0.15 effects per
    // cut (letterbox bars on 3 % of cuts), printColumn 0.07, quietHush 0.05.
    function filterDrive(look) {
      const a = look.amounts;
      const weights = look.mood && look.mood.filters ? Object.values(look.mood.filters) : [];
      const top = weights.length ? Math.max(...weights) : 0;
      return Math.max(a.glitch, a.chroma, a.texture * N.clamp(top));
    }

    // ornament.count / filter.count (§4.16.4), raised to i + 1 by a part pinned on slot i (§3.4.3), then the slots.
    // Under 「効果を重ねすぎない」 (DESIGN_2_2 §2.3.4 b) a busy cut lowers its counts after the filter count, before the
    // filter slots (every slot keeps its own stream, so a lower count changes no other value).
    function decideList(st, kind) {
      const need = decideCount(st, kind);
      if (kind === 'filter' && st.ctx.pv) trimLists(st, need);
      for (let i = 0; i < st.slots[kind + '.count'].v; i++) decidePart(st, kind, i);
    }

    // The count of a list kind, raised by a pinned index; → the pinned index (need).
    function decideCount(st, kind) {
      const { ctx, cut, at } = st;
      const countSlot = kind + '.count';
      const a = ctx.look.amounts;
      const count = decideValue(st, countSlot, SLOT_SPECS[countSlot], (seed) => {
        const r = R.stream(seed, 'count').next();
        const v = kind === 'ornament'
          ? Math.min(LIST_MAX, Math.floor(a.ornament * 2.5 + r))
          : Math.min(2, Math.floor(0.8 * filterDrive(ctx.look) + r)) + (cut.impact && a.flash > 0 ? 1 : 0);
        return { v, from: 'auto' };
      });
      let need = 0;
      let accept = null;
      for (let i = 0; i < LIST_MAX; i++) {
        const slot = kind + '#' + i;
        if (!PA.pinned(ctx.ix, slot)) continue;
        accept = accept || acceptPart(ctx, kind, cut.role, { none: true, scope: kind === 'ornament' ? 'cut' : null });
        const pin = PA.resolvePin(ctx.ix, at, slot, accept, null);
        if (pin && pin.v !== 'none') need = i + 1;
      }
      if (need > count.v) {
        const raised = { v: need, from: 'rule' };
        setDecision(st, countSlot, raised);
        const trace = tracing(st, countSlot);
        if (trace) Object.assign(trace, { stage: 'rule', rule: 'index', decision: raised });
      }
      return need;
    }

    // 「効果を重ねすぎない」: the lower counts planner/conventions gives a busy cut (decorations first, then screen
    // effects), from 'rule' (explained as rule pv.fx); the dropped decorations go (the filter slots are not decided yet).
    function trimLists(st, needF) {
      const got = st.ctx.pv.trimLists(st, needF);
      if (!got) return;
      for (const kind of LIST_KINDS) {
        const n = got[kind];
        if (n === undefined) continue;
        const countSlot = kind + '.count';
        const old = st.slots[countSlot].v;
        const d = { v: n, from: 'rule' };
        setDecision(st, countSlot, d);
        for (let i = n; i < old; i++) {
          const slot = kind + '#' + i;
          delete st.slots[slot]; delete st.chosen[slot]; delete st.base[slot]; delete st.ref[slot];
        }
        const trace = tracing(st, countSlot);
        if (trace) Object.assign(trace, { stage: 'rule', rule: 'pv.fx', decision: d, why: null });
      }
    }

    function acceptEl(field) {
      return (v) => {
        if (field === 'hide') return typeof v === 'boolean' ? { v } : { bad: true };
        if (field === 'fill') {
          const c = S.coerce(SLOT_SPECS['el.fill'], v);
          return c === undefined ? { bad: true } : { v: c };
        }
        if (!v || typeof v !== 'object' || Array.isArray(v)) return { bad: true };
        const out = {};
        for (const k of Object.keys(NUDGE_LIMITS)) {
          const [lo, hi, dflt] = NUDGE_LIMITS[k];
          const x = v[k] === undefined ? dflt : v[k];
          if (typeof x !== 'number' || !Number.isFinite(x)) return { bad: true };
          out[k] = N.clamp(x, lo, hi);
        }
        return { v: out };
      };
    }

    // Element pins (§3.4.3): el.<owner>.nudge | fill | hide for the text and each existing decoration slot.
    // The map gets its keys in sorted order at both levels (planner/encode prints it natively); the pins are read in
    // the owner order text, ornament#0…, which is the order of their warnings.
    function decideEls(st) {
      const { ctx, at } = st;
      if (!PA.pinnedUnder(ctx.ix, 'el.')) return {};
      const found = new Map();
      const owners = ['text'];
      const n = st.slots['ornament.count'] ? st.slots['ornament.count'].v : 0;
      for (let i = 0; i < n; i++) owners.push('ornament#' + i);
      for (const owner of owners) {
        for (const field of EL_FIELDS) {
          const pin = PA.resolvePin(ctx.ix, at, 'el.' + owner + '.' + field, acceptEl(field), ctx.warn);
          if (!pin) continue;
          if (!found.has(owner)) found.set(owner, {});
          found.get(owner)[field] = pin.v;
        }
      }
      const els = {};
      for (const owner of [...found.keys()].sort()) {
        const fields = found.get(owner);
        els[owner] = {};
        for (const field of EL_SORTED) if (field in fields) els[owner][field] = fields[field];
      }
      return els;
    }

    // The slots of one cut in the FROZEN order (§4.16.2, DESIGN_2_1 §3.9): orient → arrange → text.* → motion.speed →
    // arrive → dwell → depart → ornament.count → ornament#i → lens → cam.shot → cam.zoom → cam.curve → cam.follow →
    // filter.count → filter#i. Every slot keeps its own stream, so the camera slots change no part choice. natural =
    // the neighbours' view (no recency, no runner-up rule, no parameters). st.decide = decideValue, for planner/camera.
    // camOnly: stop after the camera slots (what a row's natural shot, heir and shadow read; see unsaltedCast).
    function castSlots(ctx, cut, hist, natural, camOnly) {
      const st = stateOf(ctx, cut, hist, natural);
      decideRepeat(st);
      decideOrient(st);
      const arrange = decidePart(st, 'arrange', null);
      decideText(st);
      CAM.decideSpeed(st);
      const own = ctx.registry.get('arrange', arrange.v).motion === 'own';
      for (const kind of MOTION_KINDS) {
        decidePart(st, kind, null, own ? { force: ctx.registry.fallback(kind), rule: 'motion-own' } : null);
      }
      decideList(st, 'ornament');
      decidePart(st, 'lens', null);
      CAM.decideCamera(st);
      if (!camOnly) decideList(st, 'filter');
      // a camera-only pass trims its decorations as the full pass does (the rows its neighbours read), so it decides
      // the screen-effect count too (its own stream), but no screen effect
      else if (ctx.pv && ctx.pv.on.fx) trimLists(st, decideCount(st, 'filter'));
      return st;
    }

    function stateOf(ctx, cut, hist, natural) {
      const st = {
        ctx, cut, hist, natural, slots: {}, chosen: {}, base: {}, ref: {},
        at: { cutKey: cut.key, pinCutKey: cut.pinKey, lineId: cut.line },
        cutSeed: CH.cutSeed(ctx.doc.look.seed, cut.key, cut.line, ctx.salts), slotPrefix: 0, poolKey: null,
        cond: lineCond(ctx, cut.line), decide: decideValue, shotSalted: false, curveSalted: false, heirCurve: null,
        align: ctx.align ? ctx.align.get(cut.key) || null : null, rerolled: false, aligned: alignedDecision, shotAligned: false,
        ahead: ctx.alignNear ? ctx.alignNear.ahead.get(cut.key) || null : null,
        // 文字PVの定石 (DESIGN_2_2 §2): the features the choices weigh (the arc's blended energy), the cut's song part, its
        // directions so far (planner/flow) and the value slots it took from its aligned source.
        feat: ctx.pv ? ctx.pv.featOf(cut) : cut.feat, part: ctx.pv ? ctx.pv.partOf(cut) : null,
        dirOwn: ctx.pv ? { h: 0, side: 0, rot: 0 } : null, fromAlign: null,
      };
      if (st.align && ctx.salts) st.rerolled = !!(ctx.salts['cut/' + cut.key] || (cut.line && ctx.salts['line/' + cut.line]));
      if (!natural && isSalted(ctx, cut)) {
        st.shotSalted = shotSalted(ctx, cut);
        st.curveSalted = fieldSalted(ctx, cut, 'cam.curve');
      }
      st.slotPrefix = CH.slotPrefix(st.cutSeed);
      return st;
    }

    // The camera slots of a cut cast again over another history whose rows read the same for its parts (only the
    // previous shot differs): the slots before them are those of `from` (unsaltedCast, for an unsalted cut).
    function recastCamera(ctx, cut, hist, from) {
      const st = stateOf(ctx, cut, hist, false);
      for (const slot of Object.keys(from.slots)) {
        if (slot.startsWith('cam.') || slot.startsWith('filter')) continue;
        st.slots[slot] = from.slots[slot];
        st.chosen[slot] = from.chosen[slot];
        if (slot in from.base) st.base[slot] = from.base[slot];
        if (slot in from.ref) st.ref[slot] = from.ref[slot];
      }
      CAM.decideCamera(st);
      return st;
    }

    // Cuts and lines that a reroll salt reaches (cut/<key>, line/<id>, with or without a slot).
    const saltedCache = new WeakMap();
    function saltedScopes(salts) {
      let set = saltedCache.get(salts);
      if (!set) {
        set = new Set();
        for (const key of Object.keys(salts)) if (salts[key]) set.add(key.split(':')[0]);
        saltedCache.set(salts, set);
      }
      return set;
    }

    // Whether a salt reaches the stream of the cut's shot: a reroll of the cut or its line, or of their cam.shot field
    // (a field die on another slot leaves the shot's stream, and so its inheritance, alone).
    function shotSalted(ctx, cut) {
      const s = ctx.salts;
      if (!s) return false;
      const own = 'cut/' + cut.key, line = cut.line ? 'line/' + cut.line : null;
      return !!(s[own] || s[own + ':cam.shot'] || (line && (s[line] || s[line + ':cam.shot'])));
    }

    // Whether a field die of the cut or its line reaches one slot's stream (cut/<key>:<slot>, line/<id>:<slot>).
    function fieldSalted(ctx, cut, slot) {
      const s = ctx.salts;
      if (!s) return false;
      return !!(s['cut/' + cut.key + ':' + slot] || (cut.line && s['line/' + cut.line + ':' + slot]));
    }

    // Field dice that cannot change a cut's heir or shadow: slots decided after its lens and shot that neither reads
    // (cam.zoom, cam.follow and the screen effects, with their parameters; §4.16.2 order). Every other salt of the cut
    // or its line (a reroll, a die on a part, the orientation, a parameter before them, the shot or the curve) does.
    const AFTER_HEIR = /^(cam\.zoom|cam\.follow|filter\.count|filter#\d+)(\.|$)/;
    function saltReachesHeir(ctx, cut) {
      const own = 'cut/' + cut.key, line = cut.line ? 'line/' + cut.line : null;
      for (const key of Object.keys(ctx.salts)) {
        if (!ctx.salts[key]) continue;
        const i = key.indexOf(':');
        const scope = i < 0 ? key : key.slice(0, i);
        if (scope !== own && scope !== line) continue;
        if (i < 0 || !AFTER_HEIR.test(key.slice(i + 1))) return true;
      }
      return false;
    }

    function isSalted(ctx, cut) {
      if (!ctx.salts) return false;
      const set = saltedScopes(ctx.salts);
      return set.has('cut/' + cut.key) || (!!cut.line && set.has('line/' + cut.line));
    }

    function silentCtx(ctx) { return Object.assign(Object.create(ctx), { salts: null, warn: () => {}, trace: null }); }

    // --- lock pins and the history ------------------------------------------------------------------------------

    // lockFreeIndex(pins) → the pin index of a document without its lock pins, or null when there are none. plan.run
    // makes it once per plan (ctx.lockFree).
    function lockFreeIndex(pins) {
      const free = {};
      let locked = false;
      for (const path of Object.keys(pins || {})) {
        if (pins[path] && pins[path].by === 'lock') locked = true; else free[path] = pins[path];
      }
      return locked ? PINS.index(free) : null;
    }

    function hasLockPin(map) {
      if (!map) return false;
      for (const pin of map.values()) if (pin && pin.by === 'lock') return true;
      return false;
    }

    // A silent copy of ctx that does not see lock pins, when this cut sees some (else null). A locked line must look
    // to its neighbours exactly as it did before it was locked (§3.6: the lock only freezes it), so the history
    // records what the cut would choose without its lock pins.
    function lockFreeCtx(ctx, cut) {
      const free = ctx.lockFree;
      if (!free) return null;
      const ix = ctx.ix;
      const sees = hasLockPin(ix.cut.get(cut.pinKey || cut.key)) || (!!cut.line && hasLockPin(ix.line.get(cut.line))) ||
        hasLockPin(ix.work);
      return sees ? Object.assign(Object.create(ctx), { ix: free, warn: () => {}, trace: null }) : null;
    }

    // castCut(ctx, cut, hist) → { slots, els, cast, castHit }. cut = skeleton with feat; ctx = { doc, registry, ix,
    // look, chooser, pools, salts, warn, aspect, bpm, trace, casts, castKeys, lockFree }. After the slots come the
    // element pins. The history records each slot's natural and reference picks (see createHistory); for a rerolled
    // cut the natural picks of its parts come from a second, silent pass without its salts, so a reroll changes only
    // the streams under its key (§3.7). Its shot (the natural shot, the heir and the shadow) comes from the cut as it
    // would be without any salt (unsaltedCast). A cut under lock pins records what it would be without them (another
    // silent pass). A cut whose inputs did not change since an earlier plan reuses that plan's cast (ctx.casts, see
    // beginCasts); cast is the cache entry (null without the cache), castHit says whether it was reused.
    function castCut(ctx, cut, hist) {
      const cache = ctx.casts || null;
      const inputs = cache ? castInputs(ctx, cut, hist) : null;
      const hit = cache ? cache.find(cut.key, inputs) : undefined;
      if (hit) {
        for (const w of hit.warnings) ctx.warn(w);
        hist.push(cut.key, hit.row, cut.feat.repeatOf || cut.key);
        const out = { slots: Object.assign({}, hit.slots), els: hit.els, cast: hit, castHit: true };
        if (ctx.pv) out.dir = hit.dir;
        return out;
      }
      const warnings = [];
      const warn = ctx.warn;
      if (cache) ctx.warn = (w) => { warnings.push(w); warn(w); };
      try {
        const st = castSlots(ctx, cut, hist, false);
        const els = decideEls(st);
        const free = lockFreeCtx(ctx, cut);
        const view = free ? castSlots(free, cut, hist, false) : st;
        const salted = isSalted(ctx, cut);
        const nat = salted ? castSlots(silentCtx(free || ctx), cut, hist, true) : view;
        const twins = hist.twinned(cut.feat.repeatOf);
        const src = unsaltedCast(ctx, cut, hist, view, free, salted, twins);
        const natural = {}, refs = {};
        for (const slot of Object.keys(nat.slots)) natural[slot] = nat.base[slot] || nat.slots[slot].v;
        natural['cam.shot'] = src.base['cam.shot'] || src.slots['cam.shot'].v;
        for (const slot of Object.keys(view.slots)) refs[slot] = view.ref[slot] || view.slots[slot].v;
        const row = historyRow(view.slots, natural, refs);
        row.heir = echoed(ctx, cut) ? CAM.heirOf(src, st) : null;
        const shot = src.slots['cam.shot'];
        row.shadow = isChoice('cam.shot', shot.v) ? shot.v : null;
        if (salted) row.free = twinOf(src);
        else if (twins) { const t = twinOf(src); if (twinDiffers(Object.assign({}, row, { free: t }), TWIN_ALL)) row.free = t; }
        // 文字PVの定石: the directions the next cuts alternate against, from the cut as its neighbours see it (without
        // its lock pins, like the rest of its row), and the cut's own as the Plan shows it (stage 6).
        const dir = ctx.pv ? ctx.pv.dirOf(st) : NO_DIR;
        if (ctx.pv) row.dir = ctx.pv.dirOf(view);
        hist.push(cut.key, row, cut.feat.repeatOf || cut.key);
        let entry = null;
        if (cache) {
          entry = { id: nextEntryId++, inputs, slots: freezeSlots(Object.assign({}, st.slots)), els: deepFreeze(els), warnings,
            row, rules: null, seam: null, dir };
          cache.add(cut.key, entry);
        }
        const out = { slots: st.slots, els, cast: entry, castHit: false };
        if (ctx.pv) out.dir = dir;
        return out;
      } finally {
        ctx.warn = warn;
      }
    }

    // unsaltedCast(ctx, cut, hist, view, free, salted, twins) → the cut's cast as it would be without any salt, as far
    // as what its neighbours read of its shot: the natural shot (the next cuts' near sets), the shadow (the next cut's
    // heir, below) and the heir (what its repeats inherit, planner/camera heirOf). Its view (without its lock pins, like
    // the rest of its row, so locking a line changes nothing outside it) when no salt reaches them, else a silent
    // re-cast up to its camera slots. A salt reaches a later cut's shot through the previous cut's final shot
    // (×SHOT_RECENT), so each row keeps its shot without salts (row.shadow), and a cut whose salts reach its heir
    // (saltReachesHeir), or whose previous shadow differs from the previous final shot, is re-cast without its salts
    // and with that shadow as the previous shot. It reaches the parts of the cuts after it too (the v2 path: their
    // recency weighs against the salted cut's picks), so a row whose picks differ without salts keeps a twin (row.free,
    // twinOf): every salted row, and every unsalted row whose own re-cast over the twins came out otherwise. A cut whose
    // window (the 4 rows before it and its echoed row) holds a twin that differs where it reads (twins: hist.twinned)
    // is re-cast in full, up to its camera slots, over the twins (hist.unsalted). So the heir, the shadow and the natural
    // shot of every cut are exactly those of the plan without salts, whatever the salts did to its parts: a first copy
    // whose layout follows a reroll next to it shows another shot, but passes on the one it shows without the reroll
    // (round 3 re-cast such a cut's camera alone over its Plan parts, a mix that neither plan shows). Only a changed
    // span (other features) changes what the plan without salts is. Without twins an unsalted cut's parts read the rows
    // as its view did, so only its camera is re-cast (recastCamera), and only when the previous shadow differs. The
    // natural shot comes from the same cast, not from the natural pass (whose parts, without recency, differ from the
    // view's), so a reroll changes neither the near sets of the cuts after it nor, through them, what a first copy there
    // passes on (§3.7). The heir also records whether the cut shows that shot and curve in the Plan (st in castCut,
    // with its salts and lock pins), so a repeat's why says which it matches.
    function unsaltedCast(ctx, cut, hist, view, free, salted, twins) {
      const prev = hist.previous('cam.shot'), shadow = hist.unsaltedShot();
      if (!twins && !(salted && saltReachesHeir(ctx, cut)) && prev === shadow) return view;
      const base = free || ctx;
      const quiet = salted ? silentCtx(base) : Object.assign(Object.create(base), { warn: () => {}, trace: null });
      const read = twins ? hist.unsalted(cut.feat.repeatOf) : hist;
      const shadowed = Object.assign(Object.create(read), { previous: (slot) => (slot === 'cam.shot' ? shadow : read.previous(slot)) });
      // Without twins, an unsalted cut's parts read the rows as its view did (only the previous shot differs): its
      // camera alone.
      return salted || twins ? castSlots(quiet, cut, shadowed, false, true) : recastCamera(quiet, cut, shadowed, view);
    }

    // A cut's row as it would be without any salt (row.free), as far as a silent re-cast of a later cut reads it (up to
    // the camera slots): its natural, reference and final picks in its salt-free cast. The natural pass of a salted cut
    // (castCut nat) chooses without recency, and its view with its salts, so its row differs from this; an unsalted cut
    // keeps one only where its re-cast over its neighbours' twins came out otherwise (twinDiffers), so the chain of
    // twins ends where the salt no longer reaches the parts.
    function twinOf(src) {
      const natural = {}, refs = {}, slots = {};
      for (const slot of Object.keys(src.slots)) {
        if (slot.startsWith('filter')) continue;
        slots[slot] = src.slots[slot];
        natural[slot] = src.base[slot] || src.slots[slot].v;
        refs[slot] = src.ref[slot] || src.slots[slot].v;
      }
      const t = historyRow(slots, natural, refs);
      return { base: t.base, both: t.both, last: t.last, own: t.own };
    }

    // --- the cast cache (re-planning) ---------------------------------------------------------------------------

    // Casting is most of a plan's work, and an edit usually leaves most cuts' inputs as they were. A cut's cast is a
    // pure function of: the look and seed (plan-wide), the pins at the work, its line and its cut key, the salts under
    // its line and cut, its skeleton (key, line, pin key, role, impact) and features, and the history window its
    // recency reads (createHistory rowsRead, and whether the previous cut sings the same line cut: follows). castInputs
    // records them; an entry is reused when they compare equal (sameInputs). Entries live for the last two plans.
    // Cached decisions are frozen, and a plan gets its own copy of each slots map (tracks may replace entries).
    // The cache is keyed by the base registry (registry.base ?? registry, DESIGN_2_1 §3.9), then by registry.version
    // (the last 4 versions): an effective registry is a new object after every material edit, and an edit that keeps
    // what the planner reads keeps the version, so the casts stay warm (the fingerprints still see the new material
    // hash, planner/plan matTerms).
    const casts = new WeakMap();
    const VERSIONS_KEPT = 4;
    let nextEntryId = 1;
    function castCache(registry) {
      const root = registry.base || registry;
      let byVersion = casts.get(root);
      if (!byVersion) { byVersion = new Map(); casts.set(root, byVersion); }
      let c = byVersion.get(registry.version);
      if (!c) {
        c = { prev: new Map(), cur: new Map() };
        byVersion.set(registry.version, c);
        if (byVersion.size > VERSIONS_KEPT) byVersion.delete(byVersion.keys().next().value);
      }
      return c;
    }

    // A cache view for one plan (by cut key): reads this plan's and the previous plan's entries, keeps what this plan
    // uses.
    function beginCasts(registry) {
      const c = castCache(registry);
      if (c.cur.size) { c.prev = c.cur; c.cur = new Map(); }
      const search = (list, inputs) => (list ? list.find((e) => sameInputs(e.inputs, inputs)) : undefined);
      return {
        find(cutKey, inputs) {
          let e = search(c.cur.get(cutKey), inputs);
          if (e === undefined) {
            e = search(c.prev.get(cutKey), inputs);
            if (e !== undefined) this.add(cutKey, e);
          }
          return e;
        },
        add(cutKey, e) {
          const list = c.cur.get(cutKey);
          if (list) list.push(e); else c.cur.set(cutKey, [e]);
        },
      };
    }

    // The inputs of a cut's cast (see the cache above): ids of the look, pins and salts (ctx.castKeys), the skeleton
    // fields, the features id and the history rows it reads.
    function castInputs(ctx, cut, hist) {
      const k = ctx.castKeys;
      return {
        look: k.look, work: k.pins(k.work, 'work', ''), line: cut.line ? k.pins(k.line, 'line', cut.line) : '-',
        cut: k.pins(k.cut, 'cut', cut.pinKey || cut.key), salts: k.salts(cut), lineId: cut.line, pinKey: cut.pinKey,
        role: cut.role, impact: !!cut.impact, featId: cut.featId, rows: hist.rowsRead(cut.feat.repeatOf),
        follows: hist.follows(cut.feat.repeatOf), echoed: echoed(ctx, cut), aligned: alignedId(ctx.align, cut),
        ahead: alignedId(ctx.alignNear && ctx.alignNear.ahead, cut), pv: ctx.pv ? ctx.pv.idOf(cut) : '',
      };
    }

    // The cast of the source a cut takes its decisions from (ctx.align), or of the source of the repeat right after it
    // (ctx.alignNear.ahead), by its cache entry: 0 without one. (A source's entry also stands for the cut right before
    // it, whose final values its own choices read.)
    function alignedId(map, cut) {
      const src = map ? map.get(cut.key) : null;
      return src ? (src.cast ? src.cast.id : -1) : 0;
    }

    // Whether a later cut sings this cut again (it is some cut's feat.repeatOf; ctx.echoed, planner/plan), so its row
    // needs an heir. Without ctx.echoed (tests casting single cuts) every row gets one.
    function echoed(ctx, cut) { return !ctx.echoed || ctx.echoed.has(cut.key); }

    // follows: whether the previous cut sings the same line cut (a line sung twice in a row; planner/camera recencyOf);
    // echoed: whether a later cut sings this one again (its row keeps an heir).
    // aligned: the source's cast entry under 「くり返しの行をそろえる」, ahead: that of the next cut's source (alignedId).
    // pv: what 文字PVの定石 adds to the cut's inputs (its part, run start, drive and kit; planner/conventions idOf).
    const INPUT_FIELDS = Object.freeze(['look', 'work', 'line', 'cut', 'salts', 'lineId', 'pinKey', 'role', 'impact', 'featId',
      'follows', 'echoed', 'aligned', 'ahead', 'pv']);
    function sameInputs(a, b) {
      for (const f of INPUT_FIELDS) if (a[f] !== b[f]) return false;
      return sameRows(a.rows, b.rows);
    }

    // Strings interned to short ids ('#' + n); ids are never reused, so equal ids always mean equal texts. When the
    // table is full it starts again: texts seen before get new ids, which only costs cache misses.
    const INTERN_MAX = 10000;
    let internTable = new Map();
    let internNext = 1;
    function intern(text) {
      let id = internTable.get(text);
      if (id === undefined) {
        if (internTable.size >= INTERN_MAX) internTable = new Map();
        id = '#' + (internNext++).toString(36);
        internTable.set(text, id);
      }
      return id;
    }

    // castKeys(ctx, lookText) → the per-plan ids of castInputs (ctx.castKeys): the look, and the pins and salts of each
    // scope, made once per plan and scope.
    function castKeys(ctx, lookText) {
      const ix = ctx.ix;
      const memo = { work: new Map(), line: new Map(), cut: new Map() };
      const pinsText = (map) => {
        if (!map || !map.size) return '';
        let out = '';
        for (const [slot, pin] of map) out += slot + '=' + JSON.stringify([pin.v, pin.by || null, pin.sig || null]) + ';';
        return out;
      };
      const saltsOf = new Map();
      if (ctx.salts) {
        for (const k of Object.keys(ctx.salts).sort()) {
          const scope = k.split(':')[0];
          saltsOf.set(scope, (saltsOf.get(scope) || '') + k + '=' + ctx.salts[k] + ';');
        }
      }
      return {
        look: intern(lookText), work: memo.work, line: memo.line, cut: memo.cut,
        pins(m, kind, id) {
          let v = m.get(id);
          if (v === undefined) {
            const map = kind === 'work' ? ix.work : kind === 'line' ? ix.line.get(id) : ix.cut.get(id);
            v = map && map.size ? intern(pinsText(map)) : '';
            m.set(id, v);
          }
          return v;
        },
        salts(cut) {
          if (!saltsOf.size) return '';
          return (saltsOf.get('cut/' + cut.key) || '') + '/' + (cut.line ? saltsOf.get('line/' + cut.line) || '' : '');
        },
      };
    }

    // Decisions hold a value, p and pfrom; values and parameters may be objects since v2.1 (curves, shots), which are
    // canonical and already frozen when they come from core/curve or core/shot, so deepFreeze stops at them.
    function freezeSlots(slots) {
      for (const slot of Object.keys(slots)) {
        const d = slots[slot];
        if (d.p) {
          const p = Object.freeze(d.p);
          for (const k in p) { const x = p[k]; if (x !== null && typeof x === 'object') deepFreeze(x); }
        }
        if (d.pfrom) Object.freeze(d.pfrom);
        if (d.v !== null && typeof d.v === 'object') deepFreeze(d.v);
        Object.freeze(d);
      }
      return Object.freeze(slots);
    }

    function deepFreeze(v) {
      if (v && typeof v === 'object' && !Object.isFrozen(v)) {
        Object.freeze(v);
        for (const k of Object.keys(v)) deepFreeze(v[k]);
      }
      return v;
    }

    return {
      SLOT_SPECS, LIST_KINDS, MOTION_KINDS, castCut, createHistory, chooseAuto, poolOf, acceptPart, pinWarnings, serves,
      filterAllows, lookAx, lockFreeCtx, lockFreeIndex, beginCasts, castKeys, intern, deepFreeze, historyRow, lineCond,
      isChoice, alignments, neighboursOf, alignedSource, REPEAT, fieldSalted, filterDrive,
    };
  });
