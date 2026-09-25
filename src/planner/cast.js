/* 文字PVメーカー v2 — original work. Casting: every cut slot in the FROZEN order, from pins, rules or the chooser (DESIGN §4.16.2, §3.4.3). */
MV.def('planner/cast', ['core/schema', 'core/registry', 'core/rng', 'core/num', 'core/pins', 'planner/choose',
  'planner/params', 'planner/look'], (S, REG, R, N, PINS, CH, PA, LK) => {
    'use strict';

    const LIST_KINDS = Object.freeze(['ornament', 'filter']);
    const LIST_MAX = 3;
    const MOTION_KINDS = Object.freeze(['arrive', 'dwell', 'depart']);
    const EL_FIELDS = Object.freeze(['nudge', 'fill', 'hide']);
    const EL_SORTED = Object.freeze(EL_FIELDS.slice().sort());
    const PER_CUT_ROLES = new Set(['lyric', 'focus']);
    const TALL_ASPECTS = new Set(['9:16', '3:4']);
    const FACE_WEIGHTS = Object.freeze({ display: 3, serif: 2, body: 1 });
    const AVOID_REPEAT = new Set(['arrange', 'arrive']);   // §8.2: no identical adjacent arrange/arrive (see choose.pick)

    // Specs of the non-part cut slots (§3.4.3); pins are coerced through them and planner/fields shows them.
    const SLOT_SPECS = Object.freeze({
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
    });
    const NUDGE_LIMITS = Object.freeze({ dx: [-4000, 4000, 0], dy: [-4000, 4000, 0], rot: [-360, 360, 0], s: [0.1, 10, 1] });

    // --- pools and part pins -----------------------------------------------------------------------------------

    // registry.pool, cached per plan: season, filters and amounts are fixed for one plan.
    function poolOf(ctx, kind, o) {
      const sub = (o.role || '') + '|' + (o.orient || '') + '|' + (o.script || '') + '|' + (o.aspect || '');
      return poolBy(ctx, kind, sub, o.role, o.orient, o.script, o.aspect, o.scope);
    }

    // The pool under kind and `sub` (role, orientation, script and aspect as text; a cut makes its text once). Gates
    // read the amounts as the backdrop allows them (planner/look gateAmounts). A cut's screen effects never take the
    // work texture again (it already runs over the whole video: risoPink's dotScreen texture plus a dotScreen effect
    // doubled the dots); a pin still can.
    function poolBy(ctx, kind, sub, role, orient, script, aspect, scope) {
      let byKind = ctx.pools.get(kind);
      if (!byKind) { byKind = new Map(); ctx.pools.set(kind, byKind); }
      const id = scope ? sub + '|' + scope : sub;
      let keys = byKind.get(id);
      if (!keys) {
        keys = ctx.registry.pool(kind, { role, orient, script, aspect, scope, season: ctx.look.season, filters: ctx.doc.filters,
          amounts: LK.gateAmounts(ctx.look.amounts, ctx.doc.look.backdrop, kind) });
        const texture = kind === 'filter' && ctx.look.plan && ctx.look.plan.texture ? ctx.look.plan.texture.v : null;
        if (texture && keys.includes(texture)) keys = keys.filter((k) => k !== texture);
        byKind.set(id, keys);
      }
      return keys;
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

    // Pins win over filters and the season gate, with a warning (§3.8).
    function pinWarnings(ctx, kind, key, pin) {
      if (key === 'none') return;
      if (!filterAllows(ctx.doc.filters, kind, key)) ctx.warn({ code: 'pin-filtered', path: pin.at });
      const def = ctx.registry.get(kind, key);
      if (def && def.season && ctx.look.season !== 'any' && def.season !== ctx.look.season) {
        ctx.warn({ code: 'pin-off-season', path: pin.at });
      }
    }

    // --- the chooser with its fallbacks (§4.16.4, §3.8) ---------------------------------------------------------

    // chooseAuto(ctx, req) → { v, from, stage, base, ref, win } (base / ref: the natural and reference picks, see
    // createHistory; win: the winner before req.avoid, which v differs from only when the winner was avoided). req = { kind, slot, path, feat, role, orient, script, scope, chosen, seed, recent, ref, echo,
    // avoid, list, orNone, cutKey, trace, silent }.
    // Stages (§4.16.4, §3.8): the full weights; the same pool without traitFit and fits; the pool without the text
    // traits (orient, script, aspect); then the kind's fallback — or 'none' for a list slot whose fallback does not
    // serve the cut's role, and for atmos (orNone). pool-empty is reported on lyric cuts, and elsewhere only when the
    // fallback itself is outside the user's filter (a seam filter of just the hard cut is fully honoured by the
    // fallback). silent: no warnings (explain's alternatives, the natural pass).
    function chooseAuto(ctx, req) {
      const trace = req.trace || null;
      const ask = {
        kind: req.kind, keys: null, noFit: false, trace: null, feat: req.feat, chosen: req.chosen, seed: req.seed,
        variety: ctx.look.variety, recent: req.recent, ref: req.ref || null, echo: req.echo,
        moodFilter: req.kind === 'filter', avoid: req.avoid || null,
      };
      const full = req.poolId !== undefined
        ? poolBy(ctx, req.kind, req.poolId, req.role, req.orient, req.script, ctx.aspect, req.scope)
        : poolOf(ctx, req.kind, { role: req.role, orient: req.orient, script: req.script, aspect: ctx.aspect, scope: req.scope });
      for (let stage = 0; stage < 3; stage++) {
        const keys = stage < 2 ? full : poolOf(ctx, req.kind, { role: req.role, scope: req.scope });
        if (!keys.length) continue;
        ask.keys = keys;
        ask.noFit = stage > 0;
        ask.trace = trace ? [] : null;
        const hit = ctx.chooser.pick(ask);
        const name = stage === 0 ? 'auto' : 'relaxed';
        if (trace) {
          Object.assign(trace, { keys, candidates: ask.trace, noFit: ask.noFit, stage: name,
            avoided: hit ? hit.avoided || null : null });
        }
        if (hit) return { v: hit.v, from: 'auto', stage: name, base: hit.base, ref: hit.ref, win: hit.avoided || hit.v };
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
      // push(cutKey, row): row = historyRow(…) of the cut.
      // The recency sets asked for since the last push (setsOf), per `which` and group.
      const sets = { both: new Map(), base: new Map() };
      function push(cutKey, row) {
        rows.push(row);
        byCut.set(cutKey, row);
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
      // What the earlier identical line's cut picked for this slot (its natural pick).
      function echo(repeatOf, slot) {
        const row = repeatOf ? byCut.get(repeatOf) : null;
        return row && row.own[slot] ? row.own[slot] : null;
      }
      return { push, recent, reference, previous, echo, rowsRead };
    }

    const NONE = Object.freeze([]);

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

    function isChoice(slot, v) {
      return typeof v === 'string' && v !== 'none' && slot.indexOf('.') < 0 && slot !== 'orient';
    }

    function addTo(map, g, v) {
      const list = map.get(g);
      if (!list) map.set(g, [v]); else if (!list.includes(v)) list.push(v);
    }

    // historyRow(slots, natural, refs) → what a cut leaves in the history: per group its natural picks (base) and its
    // natural and reference picks (both), per slot its final value (last) and natural pick (own). slots = the cut's
    // decisions (as its neighbours see them); natural / refs = { slot: pick }. Rows never change, so a cached cast
    // keeps its row.
    function historyRow(slots, natural, refs) {
      const row = { base: new Map(), both: new Map(), last: new Map(), own: {} };
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
    // picks (the reference pick weighs against them), both picks (recent) and final values (previous); the echoed
    // row for its own picks.
    const ROW_FIELDS = Object.freeze([['base'], ['base'], ['base'], ['base', 'both', 'last'], ['own']]);
    function sameRows(a, b) {
      for (let i = 0; i < ROW_FIELDS.length; i++) {
        const x = a[i], y = b[i];
        if (x === y) continue;
        if (!x || !y) return false;
        for (const f of ROW_FIELDS[i]) if (!(f === 'own' ? sameRecord(x.own, y.own) : sameMap(x[f], y[f]))) return false;
      }
      return true;
    }

    function sameMap(a, b) {
      if (a.size !== b.size) return false;
      for (const [k, v] of a) {
        const w = b.get(k);
        if (Array.isArray(v) ? !(Array.isArray(w) && v.length === w.length && v.every((x) => w.includes(x))) : v !== w) return false;
      }
      return true;
    }

    function sameRecord(a, b) {
      const ka = Object.keys(a);
      if (ka.length !== Object.keys(b).length) return false;
      for (const k of ka) if (a[k] !== b[k]) return false;
      return true;
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
      let d;
      if (pin) {
        pinWarnings(ctx, kind, pin.v, pin);
        d = pinDecision(pin);
        if (trace) Object.assign(shadow(st, kind, slot, seed, list, trace), { kind, stage: 'pin', pin });
      } else if (o.force) {
        d = { v: o.force, from: 'rule' };
        if (trace) Object.assign(shadow(st, kind, slot, seed, list, trace), { kind, stage: 'rule', rule: o.rule });
      } else {
        const own = list ? ownValues(st, kind, idx) : null;
        const recent = st.natural ? null : st.hist.recent(kind, slot, own);
        const ref = st.natural ? null : st.hist.reference(kind, slot, own);
        const echo = st.hist.echo(cut.feat.repeatOf, slot);
        if (trace) Object.assign(trace, { kind, recent, echo });
        const got = chooseAuto(ctx, {
          kind, slot, path: 'cut/' + cut.key + ':' + slot, feat: cut.feat, role: cut.role, orient: st.chosen.orient,
          script: cut.feat.script, scope: kind === 'ornament' ? 'cut' : null, chosen: st.chosen, seed, recent, echo,
          list, cutKey: cut.key, trace, silent: st.natural, ref, poolId: poolIdOf(st),
          avoid: AVOID_REPEAT.has(kind) && !st.natural ? st.hist.previous(slot) : null,
        });
        d = { v: got.v, from: got.from };
        if (got.base && got.base !== got.v) st.base[slot] = got.base;
        if (got.ref && got.ref !== got.v) st.ref[slot] = got.ref;
        if (trace && got.rule) trace.rule = got.rule;
      }
      if (d.v !== 'none' && !st.natural) {
        const def = ctx.registry.get(kind, d.v);
        const { p, pfrom } = PA.resolveParams(def, kind, idx, at, ctx.ix, {
          registry: ctx.registry, seed, salts: ctx.salts, warn: ctx.warn, f: cut.feat, look: lookAx(ctx),
        });
        d.p = p;
        if (pfrom) d.pfrom = pfrom;
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
      chooseAuto(ctx, { kind, slot, path: 'cut/' + cut.key + ':' + slot, feat: cut.feat, role: cut.role,
        orient: st.chosen.orient, script: cut.feat.script, scope: kind === 'ornament' ? 'cut' : null, chosen: st.chosen,
        seed, recent, echo, list, cutKey: cut.key, trace, silent: true });
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

    // A non-part slot: pin (coerced through its spec, plus an optional applicability check) or the auto value.
    function decideValue(st, slot, spec, autoFn, applies) {
      const { ctx, at } = st;
      const trace = tracing(st, slot);
      const pin = !PA.pinned(ctx.ix, slot) ? null : PA.resolvePin(ctx.ix, at, slot, (v) => {
        const c = S.coerce(spec, v);
        if (c === undefined) return { bad: true };
        return applies && !applies(c) ? { na: true } : { v: c };
      }, ctx.warn);
      const d = pin ? pinDecision(pin) : autoFn(seedOf(st, slot));
      if (trace) Object.assign(trace, { stage: pin ? 'pin' : d.from === 'rule' ? 'rule' : 'auto', pin, decision: d,
        rule: d.from === 'rule' ? d.rule || slot : slot });
      if (d.rule) delete d.rule;
      setDecision(st, slot, d);
      return d;
    }

    // orient (§4.16.4): 'h' when the text cannot stand vertically; else 'v' with probability
    // 0.12 + 0.25·norm(literary bias) + 0.15 on tall aspects. A pinned arrange that works in one orientation only
    // sets the orientation (rule).
    function decideOrient(st) {
      const { ctx, cut, at } = st;
      const allowed = cut.feat.orients;
      return decideValue(st, 'orient', SLOT_SPECS.orient, (seed) => {
        const pin = PA.resolvePin(ctx.ix, at, 'arrange', acceptPart(ctx, 'arrange', cut.role), null);
        if (pin) {
          const only = ctx.registry.traits('arrange', pin.v).orient;
          if (only.length === 1 && allowed.includes(only[0])) return { v: only[0], from: 'rule', rule: 'arrange' };
        }
        if (!allowed.includes('v')) return { v: 'h', from: 'auto' };
        const bias = ctx.look.mood.tagBias && typeof ctx.look.mood.tagBias.literary === 'number'
          ? ctx.look.mood.tagBias.literary : 1;
        const p = 0.12 + 0.25 * N.clamp((bias - 0.25) / 1.75) + (TALL_ASPECTS.has(ctx.aspect) ? 0.15 : 0);
        return { v: R.fromSeed(seed).next() < p ? 'v' : 'h', from: 'auto' };
      }, (v) => allowed.includes(v));
    }

    function decideText(st) {
      const { ctx, cut } = st;
      decideValue(st, 'text.face', SLOT_SPECS['text.face'], (seed) => {
        const serif = FACE_WEIGHTS.serif * (st.chosen.orient === 'v' ? 2 : 1);
        const v = R.fromSeed(seed).weighted(['display', 'serif', 'body'], [FACE_WEIGHTS.display, serif, FACE_WEIGHTS.body]);
        return { v, from: 'auto' };
      });
      decideValue(st, 'text.scale', SLOT_SPECS['text.scale'],
        () => ({ v: S.coerce(SLOT_SPECS['text.scale'], 1 + (cut.feat.energy - 0.5) * 0.2), from: 'auto' }));
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
    function decideList(st, kind) {
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
      for (let i = 0; i < st.slots[countSlot].v; i++) decidePart(st, kind, i);
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

    // The slots of one cut in the FROZEN order (§4.16.2): orient → arrange → text.* → arrive → dwell → depart →
    // ornament.count → ornament#i → lens → filter.count → filter#i. natural = the neighbours' view (no recency, no
    // runner-up rule, no parameters).
    function castSlots(ctx, cut, hist, natural) {
      const st = {
        ctx, cut, hist, natural, slots: {}, chosen: {}, base: {}, ref: {},
        at: { cutKey: cut.key, pinCutKey: cut.pinKey, lineId: cut.line },
        cutSeed: CH.cutSeed(ctx.doc.look.seed, cut.key, cut.line, ctx.salts), slotPrefix: 0, poolKey: null,
      };
      st.slotPrefix = CH.slotPrefix(st.cutSeed);
      decideOrient(st);
      const arrange = decidePart(st, 'arrange', null);
      decideText(st);
      const own = ctx.registry.get('arrange', arrange.v).motion === 'own';
      for (const kind of MOTION_KINDS) {
        decidePart(st, kind, null, own ? { force: ctx.registry.fallback(kind), rule: 'motion-own' } : null);
      }
      decideList(st, 'ornament');
      decidePart(st, 'lens', null);
      decideList(st, 'filter');
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
    // cut the natural pick comes from a second, silent pass without its salts, so a reroll changes only the streams
    // under its key (§3.7). A cut under lock pins records what it would be without them (another silent pass). A cut
    // whose inputs did not change since an earlier plan reuses that plan's cast (ctx.casts, see beginCasts); cast is
    // the cache entry (null without the cache), castHit says whether it was reused.
    function castCut(ctx, cut, hist) {
      const cache = ctx.casts || null;
      const inputs = cache ? castInputs(ctx, cut, hist) : null;
      const hit = cache ? cache.find(cut.key, inputs) : undefined;
      if (hit) {
        for (const w of hit.warnings) ctx.warn(w);
        hist.push(cut.key, hit.row);
        return { slots: Object.assign({}, hit.slots), els: hit.els, cast: hit, castHit: true };
      }
      const warnings = [];
      const warn = ctx.warn;
      if (cache) ctx.warn = (w) => { warnings.push(w); warn(w); };
      try {
        const st = castSlots(ctx, cut, hist, false);
        const els = decideEls(st);
        const free = lockFreeCtx(ctx, cut);
        const view = free ? castSlots(free, cut, hist, false) : st;
        const nat = isSalted(ctx, cut) ? castSlots(silentCtx(free || ctx), cut, hist, true) : view;
        const natural = {}, refs = {};
        for (const slot of Object.keys(nat.slots)) natural[slot] = nat.base[slot] || nat.slots[slot].v;
        for (const slot of Object.keys(view.slots)) refs[slot] = view.ref[slot] || view.slots[slot].v;
        const row = historyRow(view.slots, natural, refs);
        hist.push(cut.key, row);
        let entry = null;
        if (cache) {
          entry = { id: nextEntryId++, inputs, slots: freezeSlots(Object.assign({}, st.slots)), els: deepFreeze(els), warnings,
            row, rules: null, seam: null };
          cache.add(cut.key, entry);
        }
        return { slots: st.slots, els, cast: entry, castHit: false };
      } finally {
        ctx.warn = warn;
      }
    }

    // --- the cast cache (re-planning) ---------------------------------------------------------------------------

    // Casting is most of a plan's work, and an edit usually leaves most cuts' inputs as they were. A cut's cast is a
    // pure function of: the look and seed (plan-wide), the pins at the work, its line and its cut key, the salts under
    // its line and cut, its skeleton (key, line, pin key, role, impact) and features, and the history window its
    // recency reads (createHistory rowsRead). castInputs records them; an entry is reused when they compare equal
    // (sameInputs). Entries live for the last two plans. Cached decisions are frozen, and a plan gets its own copy of
    // each slots map (tracks may replace entries).
    const casts = new WeakMap();
    let nextEntryId = 1;
    function castCache(registry) {
      let c = casts.get(registry);
      if (!c) { c = { prev: new Map(), cur: new Map() }; casts.set(registry, c); }
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
      };
    }

    const INPUT_FIELDS = Object.freeze(['look', 'work', 'line', 'cut', 'salts', 'lineId', 'pinKey', 'role', 'impact', 'featId']);
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

    // Decisions hold primitives, p and pfrom (flat maps of primitives), so three freezes cover one.
    function freezeSlots(slots) {
      for (const slot of Object.keys(slots)) {
        const d = slots[slot];
        if (d.p) Object.freeze(d.p);
        if (d.pfrom) Object.freeze(d.pfrom);
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
      filterAllows, lookAx, lockFreeCtx, lockFreeIndex, beginCasts, castKeys, intern, deepFreeze, historyRow,
    };
  });
