/* 文字PVメーカー v2 — original work. Ranked pin resolution and part parameters (DESIGN §3.5, §4.16.8; DESIGN_2_1 §11.2.6, §11.9.2). */
MV.def('planner/params', ['core/pins', 'core/schema', 'core/paths', 'planner/choose'], (PINS, S, P, CH) => {
  'use strict';

  const RANKS = ['pin:cut', 'pin:line', 'pin:work'];

  // The `at` object that makes core/pins.lookup look at exactly one rank (it still cascades downwards, so the
  // result is accepted only when its `from` is that rank).
  function rankAt(rank, at) {
    if (rank === 'pin:cut') return at.pinCutKey ? { cutKey: null, pinCutKey: at.pinCutKey, lineId: null } : null;
    if (rank === 'pin:line') return at.lineId ? { cutKey: null, pinCutKey: null, lineId: at.lineId } : null;
    return { cutKey: null, pinCutKey: null, lineId: null };
  }

  // Every slot that has a pin at some scope (most slots have none, so most lookups end here).
  const slotCache = new WeakMap();
  function slotsOf(ix) {
    let set = slotCache.get(ix);
    if (!set) {
      set = new Set(ix.work.keys());
      for (const m of ix.line.values()) for (const k of m.keys()) set.add(k);
      for (const m of ix.cut.values()) for (const k of m.keys()) set.add(k);
      slotCache.set(ix, set);
    }
    return set;
  }

  // Whether any scope pins `slot` (callers skip building an accept function when none does).
  function pinned(ix, slot) { return slotsOf(ix).has(slot); }

  // Whether any pinned slot starts with `prefix` ('el.'), per pin index.
  const prefixCache = new WeakMap();
  function pinnedUnder(ix, prefix) {
    let m = prefixCache.get(ix);
    if (!m) { m = new Map(); prefixCache.set(ix, m); }
    let hit = m.get(prefix);
    if (hit === undefined) {
      hit = false;
      for (const slot of slotsOf(ix)) if (slot.startsWith(prefix)) { hit = true; break; }
      m.set(prefix, hit);
    }
    return hit;
  }

  // resolvePin(ix, at, slot, accept, warn) → { v, from, by, at } | null
  // Walks cut > line > work with core/pins.lookup (the single precedence implementation). accept(v, rank) returns
  // { v } to take the pin (with the coerced value), { bad: true } for a value the slot cannot hold (warning
  // pin-bad-value, next rank), or { na: true } for a pin that does not apply here (a cut pin warns
  // pin-not-applicable; line and work pins are skipped silently). at = { pinCutKey, lineId, cutKey? }.
  function resolvePin(ix, at, slot, accept, warn) {
    if (!slotsOf(ix).has(slot)) return null;
    for (const rank of RANKS) {
      const where = rankAt(rank, at);
      if (!where) continue;
      const hit = PINS.lookup(ix, where, slot);
      if (!hit || hit.from !== rank) continue;
      const verdict = accept ? accept(hit.v, rank) : { v: hit.v };
      if (verdict && 'v' in verdict) return { v: verdict.v, from: rank, by: hit.by, at: hit.at };
      // A warning names the line and cut only for a pin that lives there: a work pin is one warning, not one per cut.
      const line = rank !== 'pin:work' && at.lineId ? at.lineId : undefined;
      if (warn && verdict && verdict.bad) warn({ code: 'pin-bad-value', path: hit.at, line });
      else if (warn && verdict && verdict.na && rank === 'pin:cut') {
        warn({ code: 'pin-not-applicable', path: hit.at, line, cut: at.cutKey || undefined });
      }
    }
    return null;
  }

  // accept function for a ParamSpec-typed slot: the coerced value or bad.
  function acceptSpec(spec) {
    return (v) => {
      const c = S.coerce(spec, v);
      return c === undefined ? { bad: true } : { v: c };
    };
  }

  function paramSalt(salts, at, slot) {
    if (!salts) return 0;
    const cut = at.cutKey ? CH.saltOf(salts, 'cut/' + at.cutKey + ':' + slot) : 0;
    const line = at.lineId ? CH.saltOf(salts, 'line/' + at.lineId + ':' + slot) : 0;
    return cut + line;
  }

  // A part's parameters for one slot KIND and index: [{ name, spec, slot, accept }], built once per registry entry
  // (slot paths are validated by core/paths once; the registry's param list keeps the declared order).
  const paramCache = new WeakMap();
  function paramList(registry, partKind, def, kind, idx) {
    let byDef = paramCache.get(def);
    if (!byDef) { byDef = new Map(); paramCache.set(def, byDef); }
    const id = kind + '#' + idx;
    let list = byDef.get(id);
    if (!list) {
      list = (registry.params(partKind, def.key) || []).map(({ name, spec, shared }) => ({
        name, spec, slot: P.slotParamPath(kind, idx, def.key, name, shared), accept: acceptSpec(spec),
      }));
      // The positions of the params in name order: p and pfrom are built with sorted keys (see planner/encode asIs).
      list.sorted = list.map((x, i) => i).sort((a, b) => (list[a].name < list[b].name ? -1 : 1));
      // A media part's source (its first media param), its `depth` (§11.9.1: an enum with 'auto') and `place`.
      list.media = list.findIndex((x) => x.spec.type === 'media');
      list.depth = list.findIndex((x) => x.name === 'depth' && x.spec.type === 'enum' && Array.isArray(x.spec.of) &&
        x.spec.of.includes(DEPTH_AUTO));
      list.place = list.findIndex((x) => x.name === 'place');
      byDef.set(id, list);
    }
    return list;
  }

  // core/schema.coerce of a stepped number clamps it, snaps it to base + k·step and rounds that to 12 digits, so its
  // answer depends only on k = round((clamped value − base) / step), base = min (or 0). The rounding is the costly
  // part of a parameter auto, so the answers are kept per spec and k (tests/node/planner_pins.test.js checks them
  // against core/schema.coerce on random values).
  const steppedAnswers = new WeakMap();
  const STEPPED_MAX = 4096;
  function coerceStepped(spec, v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return S.coerce(spec, v);
    let x = v;
    if (typeof spec.min === 'number' && Number.isFinite(spec.min) && x < spec.min) x = spec.min;
    if (typeof spec.max === 'number' && Number.isFinite(spec.max) && x > spec.max) x = spec.max;
    const base = typeof spec.min === 'number' && Number.isFinite(spec.min) ? spec.min : 0;
    const k = Math.round((x - base) / spec.step);
    let answers = steppedAnswers.get(spec);
    if (!answers) { answers = new Map(); steppedAnswers.set(spec, answers); }
    let c = answers.get(k);
    if (c === undefined) {
      if (answers.size >= STEPPED_MAX) answers.clear();
      c = S.coerce(spec, v);
      answers.set(k, c);
    }
    return c;
  }

  function isStepped(spec) { return spec.type === 'num' && typeof spec.step === 'number' && spec.step > 0; }

  // S.autoValue(spec, ax): the raw auto, coerced; stepped numbers through coerceStepped. Anything but a finite raw
  // number takes S.autoValue itself, on a fresh copy of the same stream (its fallbacks are core/schema's).
  function autoOf(spec, auto, stream) {
    auto.rng = stream();
    if (!isStepped(spec)) return S.autoValue(spec, auto);
    const raw = S.autoValue(spec.auto, auto);
    if (typeof raw === 'number' && Number.isFinite(raw)) return coerceStepped(spec, raw);
    auto.rng = stream();
    return S.autoValue(spec, auto);
  }

  // A media parameter's value against the document's library (DESIGN_2_1 §11.2.6): an id that is not in doc.media
  // warns media-missing and an entry whose kind does not fit spec.accept warns media-kind (detail { id }); both give
  // ''. media = { entries: Map<id, AssetEntry> } (planner/plan). Pinned values warn at the pin's path.
  function checkMedia(media, v, spec, pin, at, warn) {
    if (typeof v !== 'string' || v === '') return v;
    const entry = media.entries.get(v);
    const accept = spec.accept || 'any';
    const code = !entry ? 'media-missing' : accept !== 'any' && entry.kind !== accept ? 'media-kind' : null;
    if (!code) return v;
    if (warn) {
      const line = pin && pin.from !== 'pin:work' && at.lineId ? at.lineId : undefined;
      warn({ code, path: pin ? pin.at : undefined, line, detail: { id: v } });
    }
    return '';
  }

  // --- depth of a photo or video (DESIGN_2_1 §11.9.2) -----------------------------------------------------------

  const DEPTH_AUTO = 'auto';
  const DEPTHS = Object.freeze(['anim', 'front', 'back', 'still']);
  const DEPTH_BUSY = 0.35;          // share of the frame the text covers
  const DEPTH_LONG_ANIM = 2;        // seconds: an animated image this long moves on its own, like a video

  // How a media part uses its picture: 'ground' (a background), 'layer' (a run ornament: overlay footage) or 'frame'
  // (a cut ornament: a photo frame). A spec may name it (`use`), else the part's kind and scope tell.
  function useOf(def, partKind, spec) {
    if (spec && (spec.use === 'ground' || spec.use === 'frame' || spec.use === 'layer')) return spec.use;
    if (partKind === 'ground') return 'ground';
    return def && def.scope === 'run' ? 'layer' : 'frame';
  }

  // depthRule(use, id, entries, coverage) → { v, rule }: the effective depth of an automatic `depth` and the rule
  // (the why code media.depth.<rule>). The first that applies: the asset's AI suggestion (entry.ai.depth); overlay
  // footage in front; a photo frame with the animation; a background video (or an animation of 2 s or more) pushed
  // back; a still photo behind busy text (coverage ≥ 0.35, textCoverage) pushed back; otherwise with the animation.
  function depthRule(use, id, entries, coverage) {
    const entry = entries && typeof id === 'string' && id !== '' ? entries.get(id) || null : null;
    const ai = entry && entry.ai && typeof entry.ai === 'object' && DEPTHS.includes(entry.ai.depth) ? entry.ai.depth : null;
    if (ai) return { v: ai, rule: 'ai' };
    if (use === 'layer') return { v: 'front', rule: 'overlay' };
    if (use === 'frame') return { v: 'anim', rule: 'frame' };
    const moving = !!entry && (entry.kind === 'video' ||
      (entry.anim === true && typeof entry.dur === 'number' && entry.dur >= DEPTH_LONG_ANIM));
    if (moving) return { v: 'back', rule: 'video' };
    const still = !entry || (entry.kind === 'image' && entry.anim !== true);
    if (still && coverage >= DEPTH_BUSY) return { v: 'back', rule: 'busy' };
    return { v: 'anim', rule: 'still' };
  }

  // textCoverage(cuts) → the share of the frame the text of a segment covers, estimated (0..1). The planner has no
  // layout (fonts and measuring are the engine's, DESIGN §7.1.3), so the §11.9.2 "hints.focus boxes" are estimated
  // from what it knows: a lyric cut's text set to fill the width takes about 1.5 / cells of the frame, times the
  // square of its text.scale; the segment's value is the mean over its lyric cuts weighted by their durations (what
  // the picture spends its time behind). cuts = plan or cast cuts ({ role, feat, slots }).
  function textCoverage(cuts) {
    let sum = 0, time = 0;
    for (const c of cuts) {
      if (!c || (c.role !== 'lyric' && c.role !== 'focus') || !c.feat) continue;
      const d = c.slots && c.slots['text.scale'];
      const s = d && typeof d.v === 'number' ? d.v : 1;
      const dur = Math.max(0, c.feat.dur || 0);
      sum += dur * Math.min(1, 1.5 * s * s / Math.max(1, c.feat.cells || 0));
      time += dur;
    }
    return time > 0 ? Math.round((sum / time) * 1000) / 1000 : 0;
  }

  // resolveParams(def, kind, idx, at, pinIndex, ax) → { p, pfrom }
  // For each param in declared order (shared first, as registry.params lists them): the pin at the shared path
  // (`kind.param` / `kind#i.param`) or the part path (`kind@key.param`), else the AutoSpec with
  // ax.rng = stream(slotSeed, 'param', name); always coerced. `kind` is the slot KIND of the path grammar
  // ('atmos' and 'texture' address ornament and filter parts). ax = { f, look: { amounts, mood, bpm }, seed,
  // registry, partKind?, salts?, warn?, fixed?: { name: value } (values set by a rule, e.g. the texture amount),
  // media? (the document's library: media params are checked against it, checkMedia), coverage? (textCoverage of
  // the segment, for a background's depth) }.
  // Every param has a stream of its own, so the order only decides the order of warnings; p and pfrom get their keys
  // in name order.
  function resolveParams(def, kind, idx, at, pinIndex, ax) {
    const list = paramList(ax.registry, ax.partKind || kind, def, kind, idx);
    const n = list.length;
    const values = new Array(n), from = new Array(n);
    let pinned = false;
    const prefix = CH.paramPrefix(ax.seed);
    const auto = { f: ax.f, look: ax.look, rng: null };
    for (let i = 0; i < n; i++) {
      const { name, spec, slot, accept } = list[i];
      const pin = resolvePin(pinIndex, at, slot, accept, ax.warn);
      if (pin) {
        values[i] = pin.v;
        from[i] = pin.from;
        pinned = true;
      } else if (ax.fixed && name in ax.fixed && S.coerce(spec, ax.fixed[name]) !== undefined) {
        values[i] = S.coerce(spec, ax.fixed[name]);
      } else {
        const salt = ax.salts ? paramSalt(ax.salts, at, slot) : 0;
        values[i] = autoOf(spec, auto, () => CH.paramStream(ax.seed, name, salt, prefix));
      }
      if (spec.type === 'media' && ax.media) values[i] = checkMedia(ax.media, values[i], spec, pin, at, ax.warn);
    }
    // depth 'auto' of a media part → its effective value (DESIGN_2_1 §11.9.2). A pin of 'auto' is no pin: the value is
    // the rule's, and a lock freezes that.
    const di = list.depth, mi = list.media;
    if (di >= 0 && mi >= 0) {
      const use = useOf(def, ax.partKind || kind, list[di].spec);
      if (values[di] === DEPTH_AUTO) {
        values[di] = depthRule(use, values[mi], ax.media ? ax.media.entries : null, ax.coverage || 0).v;
        if (from[di] !== undefined) { from[di] = undefined; pinned = from.some((x) => x !== undefined); }
      }
      // In front of the text, a photo frame is never placed behind it: an automatic 'behind' becomes 'side' (§11.9.3).
      const pi = list.place;
      if (values[di] === 'front' && use === 'frame' && pi >= 0 && from[pi] === undefined && values[pi] === 'behind') {
        values[pi] = 'side';
      }
    }
    const p = {};
    const pfrom = pinned ? {} : null;
    for (const i of list.sorted) {
      p[list[i].name] = values[i];
      if (from[i] !== undefined) pfrom[list[i].name] = from[i];
    }
    return { p, pfrom };
  }

  // paramInfo(registry, partKind, def) → { media, depth, place } names ('' when absent) of a part's params.
  function paramInfo(registry, partKind, def) {
    const list = paramList(registry, partKind, def, partKind, null);
    const name = (i) => (i >= 0 ? list[i].name : '');
    return { media: name(list.media), depth: name(list.depth), place: name(list.place), depthSpec: list.depth >= 0 ? list[list.depth].spec : null };
  }

  return {
    resolvePin, resolveParams, acceptSpec, pinned, pinnedUnder, coerceStepped, RANKS, depthRule, useOf, textCoverage,
    paramInfo, DEPTHS,
  };
});
