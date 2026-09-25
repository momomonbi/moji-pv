/* 文字PVメーカー v2 — original work. Inspector field states, lock payloads and plan-value readers (DESIGN §4.16.8, §3.13, §3.6). */
MV.def('planner/fields', ['core/paths', 'core/pins', 'core/registry', 'core/lyrics', 'core/schema', 'core/timing',
  'planner/cast', 'planner/look', 'planner/segment', 'planner/plan'], (P, PINS, REG, LY, S, TM, CA, LK, SG, PL) => {
  'use strict';

  const LOOK_NAMES = new Set(['mood', 'theme', 'season', 'bpm', 'beatOffset', 'readRate', 'length', 'titleCard']);
  const LOOK_PREFIX = /^(color|amount|face)\./;
  const LINE_NAMES = new Set(['start', 'end', 'split', 'lang']);
  const TRACK_KINDS = new Set(['ground', 'atmos', 'seam']);
  const EL_DEFAULT = Object.freeze({ nudge: Object.freeze({ dx: 0, dy: 0, rot: 0, s: 1 }), fill: null, hide: false });

  // --- what a path addresses ---------------------------------------------------------------------------------

  // 'look' (work-scope slots), 'line' (start/end/split/lang), 't0', 'el', 'count', 'part', 'param' or 'value'
  // (orient, text.*).
  function categoryOf(parsed) {
    const slot = parsed.slot;
    if (LOOK_NAMES.has(slot) || LOOK_PREFIX.test(slot) || (parsed.part && parsed.part.kind === 'texture')) return 'look';
    if (LINE_NAMES.has(slot)) return 'line';
    if (slot === 't0') return 't0';
    if (parsed.el) return 'el';
    if (parsed.part) {
      if (parsed.part.param === 'count' && parsed.part.idx === null && CA.LIST_KINDS.includes(parsed.part.kind)) return 'count';
      return parsed.part.param ? 'param' : 'part';
    }
    return 'value';
  }

  // The decision slot of a part path ('ornament#1@hankoSeal.size' → 'ornament#1').
  function choiceSlot(part) { return part.idx === null ? part.kind : part.kind + '#' + part.idx; }

  function cutIndex(plan) {
    let ix = cutIndexCache.get(plan);
    if (!ix) {
      ix = { byKey: new Map(), byPinKey: new Map(), lines: new Map() };
      for (const c of plan.cuts) {
        ix.byKey.set(c.key, c);
        if (c.pinKey) ix.byPinKey.set(c.pinKey, c);
      }
      for (const l of plan.lines) ix.lines.set(l.id, l);
      cutIndexCache.set(plan, ix);
    }
    return ix;
  }
  const cutIndexCache = new WeakMap();

  function cutOf(plan, key) {
    const ix = cutIndex(plan);
    return ix.byKey.get(key) || ix.byPinKey.get(key) || null;
  }

  // The plan cuts a path covers: its cut; its line's cuts (every selected line's cuts for a multi-line selection that
  // contains it); every cut for work scope.
  function cutsFor(plan, sel, parsed) {
    const scope = parsed.scope;
    if (scope.kind === 'cut') { const c = cutOf(plan, scope.id); return c ? [c] : []; }
    if (scope.kind === 'line') {
      const ids = sel && sel.level === 'line' && Array.isArray(sel.ids) && sel.ids.includes(scope.id) ? sel.ids : [scope.id];
      const ix = cutIndex(plan);
      const out = [];
      for (const id of ids) { const l = ix.lines.get(id); if (l) for (const k of l.cuts) out.push(ix.byKey.get(k)); }
      return out.filter(Boolean);
    }
    return plan.cuts.slice();
  }

  // The Decision a cut holds for a part/value/count slot (seams: the boundary into the cut; grounds: its segment).
  // A boundary without a seam entry is the hard cut (registry.fallback('seam')).
  function decisionAt(plan, cut, parsed, registry) {
    const part = parsed.part;
    if (part && part.kind === 'ground') return plan.grounds[cut.ground] ? plan.grounds[cut.ground].ground : null;
    if (part && part.kind === 'atmos') return plan.grounds[cut.ground] ? plan.grounds[cut.ground].atmos : null;
    if (part && part.kind === 'seam') {
      if (cut.seamIn >= 0) return plan.seams[cut.seamIn].slot;
      return registry ? { v: registry.fallback('seam'), from: 'auto' } : null;
    }
    const slot = part ? (part.param === 'count' && part.idx === null ? part.kind + '.count' : choiceSlot(part)) : parsed.slot;
    return (cut.slots && cut.slots[slot]) || null;
  }

  // A work pin's value coerced through the slot's spec, or undefined (no pin, or one the planner ignores).
  function workPinValue(ix, slot, spec) {
    const pin = ix ? PINS.lookup(ix, LK.WORK_AT, slot) : null;
    return pin && pin.from === 'pin:work' && pin.v !== undefined ? S.coerce(spec, pin.v) : undefined;
  }

  function lookValue(plan, parsed, registry, ix) {
    const slot = parsed.slot;
    const L = plan.look;
    if (slot === 'mood' || slot === 'theme' || slot === 'season') return L[slot].v;
    if (parsed.part && parsed.part.kind === 'texture') {
      if (!parsed.part.param) return L.texture ? L.texture.v : 'none';
      return L.texture && L.texture.p ? L.texture.p[parsed.part.param] : undefined;
    }
    if (slot.startsWith('color.')) return L.palette[slot.slice(6)];
    if (slot.startsWith('amount.')) return L.amounts[slot.slice(7)];
    if (slot.startsWith('face.')) {
      const [, role, x] = slot.split('.');
      if (x === 'weight') return faceWeight(plan, role, registry, ix);
      const f = L.faces[role];
      return f && f[x] ? f[x].family : undefined;
    }
    if (slot === 'bpm') return plan.beats ? plan.beats.bpm : null;
    if (slot === 'beatOffset') {
      if (plan.beats) return plan.beats.offset;
      const pinned = workPinValue(ix, slot, LK.LOOK_SPECS.beatOffset);
      return pinned === undefined ? 0 : pinned;
    }
    if (slot === 'readRate') return readRate(plan, ix);
    if (slot === 'length') return plan.duration;
    if (slot === 'titleCard') return plan.cuts.some((c) => c.key === 'title');
    return undefined;
  }

  // The reading rate the timing solver used (§3.4.1, §4.11): the pin, else clamp(bpm / 20, 3, 14) with a tempo,
  // else 7 morae per second — core/timing.readRateOf, the solver's own rule.
  function readRate(plan, ix) {
    const pinned = workPinValue(ix, 'readRate', LK.LOOK_SPECS.readRate);
    return TM.readRateOf({ readRate: pinned === undefined ? null : pinned, bpm: plan.beats ? plan.beats.bpm : null });
  }

  // The weight a role asks for (§3.4.1 face.<role>.weight): the pin, else the theme's. The Plan's faces hold the
  // weights each family serves (resolveFaces snaps them), which can differ per script; the field shows the request.
  function faceWeight(plan, role, registry, ix) {
    const pinned = workPinValue(ix, 'face.' + role + '.weight', LK.LOOK_SPECS.weight);
    if (pinned !== undefined) return pinned;
    const theme = registry ? registry.get('theme', plan.look.theme.v) : null;
    const tf = theme && theme.faces ? theme.faces[role] : null;
    if (tf && Number(tf.weight) > 0) return Number(tf.weight);
    const f = plan.look.faces[role];
    return f ? (f.ja || f.latin).weight : undefined;
  }

  function lineValue(plan, parsed, lineId) {
    const line = cutIndex(plan).lines.get(lineId);
    if (!line) return undefined;
    if (parsed.slot === 'start') return line.t0;
    if (parsed.slot === 'end') return line.t1;
    if (parsed.slot === 'lang') return line.lang;
    return line.cuts.map((k) => P.cutOffset(k));        // split
  }

  // valueAt(plan, cut, parsed, registry, ix?) → the value a path shows at one cut (cut may be null for work/line
  // slots). ix = the document's pin index, for the look values that are requests rather than Plan values (weights,
  // the reading rate).
  function valueAt(plan, cut, parsed, registry, ix) {
    const cat = categoryOf(parsed);
    if (cat === 'look') return lookValue(plan, parsed, registry, ix);
    if (cat === 'line') return lineValue(plan, parsed, cut ? cut.line : parsed.scope.lineId);
    if (!cut) return undefined;
    if (cat === 't0') return cut.t0;
    if (cat === 'el') {
      const e = cut.els && cut.els[parsed.el.owner];
      return e && e[parsed.el.field] !== undefined ? e[parsed.el.field] : EL_DEFAULT[parsed.el.field];
    }
    const d = decisionAt(plan, cut, parsed, registry);
    if (cat === 'count') return d ? d.v : 0;
    if (cat === 'part') return d ? d.v : 'none';
    if (cat === 'param') {
      if (!d || d.v === 'none' || (parsed.part.key && parsed.part.key !== d.v)) return undefined;
      return d.p ? d.p[parsed.part.param] : undefined;
    }
    return d ? d.v : undefined;
  }

  // --- field states ------------------------------------------------------------------------------------------

  const SCOPE_OF = { 'pin:cut': 'cut', 'pin:line': 'line', 'pin:work': 'work' };

  function sameValue(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

  function partKindOf(kind) { return kind === 'atmos' ? 'ornament' : kind === 'texture' ? 'filter' : kind; }

  function schemaOf(registry, plan, parsed, cuts) {
    const cat = categoryOf(parsed);
    const slot = parsed.slot;
    if (cat === 'look') {
      if (slot === 'mood' || slot === 'theme') return { type: 'part', kind: slot, of: registry.keys(slot), none: false };
      if (parsed.part && !parsed.part.param) {
        return { type: 'part', kind: 'filter', of: registry.all('filter').filter((d) => d.texture).map((d) => d.key), none: true };
      }
      if (parsed.part) return paramSpec(registry, plan, parsed, cuts);
      if (slot.startsWith('color.')) return LK.LOOK_SPECS.color;
      if (slot.startsWith('amount.')) return LK.LOOK_SPECS.amount;
      if (slot.startsWith('face.')) return slot.endsWith('.weight') ? LK.LOOK_SPECS.weight : LK.LOOK_SPECS.family;
      return LK.LOOK_SPECS[slot] || null;
    }
    if (cat === 'line' || cat === 't0') return SG.LINE_SPECS[slot];
    if (cat === 'el') return CA.SLOT_SPECS['el.' + parsed.el.field];
    if (cat === 'count') return CA.SLOT_SPECS[parsed.part.kind + '.count'];
    if (cat === 'part') {
      const kind = partKindOf(parsed.part.kind);
      const keys = registry.all(kind).filter((d) => {
        if (parsed.part.kind === 'atmos') return d.scope === 'run';
        return kind !== 'ornament' || d.scope === 'cut';
      }).map((d) => d.key);
      const none = CA.LIST_KINDS.includes(parsed.part.kind) || parsed.part.kind === 'atmos';
      return { type: 'part', kind, of: keys, none };
    }
    if (cat === 'param') return paramSpec(registry, plan, parsed, cuts);
    return CA.SLOT_SPECS[slot] || null;
  }

  // The ParamSpec of a part parameter: of the named part, else of the part chosen at the first covered cut, else the
  // kind's shared spec.
  function paramSpec(registry, plan, parsed, cuts) {
    const part = parsed.part;
    const kind = partKindOf(part.kind);
    let key = part.key;
    if (!key) {
      const d = part.kind === 'texture' ? plan.look.texture : cuts[0] ? decisionAt(plan, cuts[0], parsed, registry) : null;
      key = d && d.v !== 'none' ? d.v : null;
    }
    const list = key && registry.has(kind, key) ? registry.params(kind, key) : null;
    const hit = list && list.find((x) => x.name === part.param);
    if (hit) return hit.spec;
    const shared = REG.SHARED[kind];
    return shared && shared[part.param] ? shared[part.param] : null;
  }

  // Where a slot may be pinned from this path: look slots at work; start/end/split/lang at line; t0 at cut; cut slots
  // at the path's scope and every broader one (special cuts have no line).
  function canPinAt(parsed) {
    const cat = categoryOf(parsed);
    if (cat === 'look') return ['work'];
    if (cat === 'line') return ['line'];
    if (cat === 't0') return ['cut'];
    const kind = parsed.scope.kind;
    if (kind === 'work') return ['work'];
    if (kind === 'line') return ['line', 'work'];
    return parsed.scope.lineId ? ['cut', 'line', 'work'] : ['cut', 'work'];
  }

  // The decision source of a path at one cut: { from, by } (pins, marks, rules, auto).
  function sourceAt(doc, plan, cut, parsed, registry, ix) {
    const cat = categoryOf(parsed);
    if (cat === 'look') return lookSource(plan, parsed, ix);
    if (cat === 'line') return lineSource(doc, plan, parsed, cut ? cut.line : parsed.scope.lineId, ix);
    if (!cut) return { from: 'auto' };
    const at = { cutKey: cut.key, pinCutKey: cut.pinKey || cut.key, lineId: cut.line };
    if (cat === 't0' || cat === 'el') {
      const hit = PINS.lookup(ix, cat === 't0' ? { cutKey: null, pinCutKey: at.pinCutKey, lineId: null } : at, parsed.slot);
      return hit ? { from: hit.from, by: hit.by, at: hit.at } : { from: 'auto' };
    }
    if (cat === 'part' && parsed.part.kind === 'seam') {
      const hard = hardCutSource(plan, cut, registry, ix, at);
      if (hard) return hard;
    }
    const d = decisionAt(plan, cut, parsed, registry);
    if (!d) return { from: 'auto' };
    if (cat === 'param') {
      const from = d.pfrom && d.pfrom[parsed.part.param] ? d.pfrom[parsed.part.param] : 'auto';
      if (from === 'auto') return { from };
      const hit = PINS.lookup(ix, at, parsed.slot) || PINS.lookup(ix, at, sharedOrPartSlot(parsed, d));
      return { from, by: hit ? hit.by : undefined, at: hit ? hit.at : undefined };
    }
    const src = { from: d.from, by: d.by };
    if (d.from && d.from.startsWith('pin')) {
      const slot = decisionSlot(parsed);
      const probe = parsed.part && TRACK_KINDS.has(parsed.part.kind) && parsed.part.kind !== 'seam' && plan.grounds[cut.ground]
        ? cutOf(plan, plan.grounds[cut.ground].cuts[0]) : cut;
      const pat = { cutKey: probe.key, pinCutKey: probe.pinKey || probe.key, lineId: probe.line };
      const hit = PINS.lookup(ix, pat, slot);
      if (hit) src.at = hit.at;
    }
    return src;
  }

  // A hard cut is not listed in Plan.seams (tracks.seams), so its decision keeps no source. When a pin chose it, the
  // planner applied that pin: report the pin, or a pinned 切り替え「なし」 would read as not applicable (無効).
  function hardCutSource(plan, cut, registry, ix, at) {
    if (!registry || cut.seamIn >= 0 || !plan.cuts.length || cut.key === plan.cuts[0].key) return null;
    const hit = PINS.lookup(ix, at, 'seam');
    return hit && hit.v === registry.fallback('seam') ? { from: hit.from, by: hit.by, at: hit.at } : null;
  }

  function decisionSlot(parsed) {
    const part = parsed.part;
    if (!part) return parsed.slot;
    if (part.param === 'count' && part.idx === null) return part.kind + '.count';
    return choiceSlot(part);
  }

  function sharedOrPartSlot(parsed, d) {
    const part = parsed.part;
    return P.slotParamPath(part.kind, part.idx, d.v, part.param, !part.key);
  }

  function lookSource(plan, parsed, ix) {
    const slot = parsed.slot;
    const L = plan.look;
    const at = (d) => (d.from === 'pin:work' ? 'work:' + slot : undefined);
    if (slot === 'mood' || slot === 'theme' || slot === 'season') return { from: L[slot].from, by: L[slot].by, at: at(L[slot]) };
    if (parsed.part && parsed.part.kind === 'texture' && !parsed.part.param && L.texture) {
      return { from: L.texture.from, by: L.texture.by, at: at(L.texture) };
    }
    const hit = PINS.lookup(ix, LK.WORK_AT, slot);
    return hit ? { from: hit.from, by: hit.by, at: hit.at } : { from: 'auto' };
  }

  function lineSource(doc, plan, parsed, lineId, ix) {
    const hit = lineId ? PINS.lookup(ix, { cutKey: null, pinCutKey: null, lineId }, parsed.slot) : null;
    if (hit && hit.from === 'pin:line') return { from: hit.from, by: hit.by, at: hit.at };
    const line = cutIndex(plan).lines.get(lineId);
    if (parsed.slot === 'start' && line && line.by && line.by.start === 'lrc') return { from: 'mark' };
    if (parsed.slot === 'split' && line) {
      const row = doc.sheet.rows.find((r) => r.id === line.row);
      if (row && LY.parseRow(row.src).pieces) return { from: 'mark' };
    }
    return { from: 'auto' };
  }

  function displayOf(parsed, value, registry, cat) {
    if (value === undefined || value === null) return ['val.none', {}];
    if (cat === 'part' || (cat === 'look' && (parsed.slot === 'mood' || parsed.slot === 'theme' ||
        (parsed.part && parsed.part.kind === 'texture' && !parsed.part.param)))) {
      if (value === 'none') return ['val.none', {}];
      const kind = cat === 'look' ? (parsed.part ? 'filter' : parsed.slot) : partKindOf(parsed.part.kind);
      return ['val.part', { kind, key: value }];
    }
    if (typeof value === 'boolean') return [value ? 'val.on' : 'val.off', {}];
    if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  function warnOf(plan, paths) {
    for (const w of plan.warnings) {
      if (w.path && paths.includes(w.path)) return { code: w.code, params: w.line ? { line: w.line } : {} };
    }
    return null;
  }

  // The pin index of a pins map, built once per map (the inspector asks for many fields of the same document).
  const pinIndexCache = new WeakMap();
  function pinIndexOf(pins) {
    const key = pins || EMPTY;
    let ix = pinIndexCache.get(key);
    if (!ix) { ix = PINS.index(pins || {}); pinIndexCache.set(key, ix); }
    return ix;
  }
  const EMPTY = Object.freeze({});

  // fieldState(doc, plan, sel, path, { registry }) → FieldState (§3.13).
  function fieldState(doc, plan, sel, path, opts) {
    const registry = opts && opts.registry;
    const parsed = P.parse(path);
    const cat = categoryOf(parsed);
    const ix = pinIndexOf(doc.pins);
    const perCut = cat !== 'look' && !(cat === 'line' && parsed.scope.kind === 'line');
    const cuts = perCut ? cutsFor(plan, sel, parsed) : [];
    const values = perCut ? cuts.map((c) => valueAt(plan, c, parsed, registry, ix)) : [valueAt(plan, null, parsed, registry, ix)];
    const sources = perCut ? cuts.map((c) => sourceAt(doc, plan, c, parsed, registry, ix))
      : [sourceAt(doc, plan, null, parsed, registry, ix)];
    const own = ownPin(doc, parsed, cuts);
    const fs = {
      path, value: values.length ? values[0] : undefined, display: null, state: 'auto', pinnedAt: null, by: null,
      schema: registry ? schemaOf(registry, plan, parsed, cuts) : null, autoText: null, canPinAt: canPinAt(parsed),
      inactiveReason: null, warn: warnOf(plan, [path].concat(own ? [own.path] : [])),
    };
    const uniform = values.every((v) => sameValue(v, values[0]));
    const partMissing = cat === 'param' && parsed.part.key && cuts.length > 0 && values.every((v) => v === undefined);
    if (partMissing) {
      fs.state = 'inactive';
      fs.inactiveReason = 'part-changed';
      if (own) { fs.value = own.pin.v; fs.pinnedAt = parsed.scope.kind; fs.by = own.pin.by; }
    } else if (own) {
      const applied = sources.some((s) => s.at === own.path);
      fs.pinnedAt = parsed.scope.kind;
      fs.by = own.pin.by;
      if (!applied && sources.length) {
        fs.state = 'inactive';
        fs.inactiveReason = 'not-applicable';
        fs.value = own.pin.v;
      } else fs.state = own.pin.by === 'lock' ? 'locked' : own.pin.by === 'ai' ? 'ai' : 'pinned';
    } else if (!uniform) {
      fs.state = 'mixed';
    } else if (sources.length && sources.every((s) => s.from === sources[0].from && s.from.startsWith('pin'))) {
      sharedPin(fs, sources, parsed.scope.kind);
    } else if (sources.length && sources.every((s) => s.from === 'mark')) fs.state = 'mark';
    else if (sources.length && sources.every((s) => s.from === 'rule')) fs.state = 'derived';
    else if (sources.some((s) => s.from.startsWith('pin'))) fs.state = 'mixed';
    fs.display = fs.state === 'mixed' ? ['state.mixed', {}] : displayOf(parsed, fs.value, registry, cat);
    fs.pinAt = own ? own.path : null;
    return fs;
  }

  const SCOPE_RANK = { cut: 0, line: 1, work: 2 };

  // Every covered cut takes the value from pins of one rank. From a broader scope than the selection's it is
  // inherited (↑, §4.16.8); from the selection's own scope or a narrower one (every cut of a line pinned at cut scope)
  // it is pinned, locked or AI-pinned there — pinnedAt says where — or mixed when the pins were made by different hands.
  function sharedPin(fs, sources, scopeKind) {
    const at = SCOPE_OF[sources[0].from];
    const by = sources[0].by || null;
    if (SCOPE_RANK[at] > SCOPE_RANK[scopeKind]) {
      Object.assign(fs, { state: 'inherited', pinnedAt: at, by });
    } else if (sources.every((s) => (s.by || null) === by)) {
      Object.assign(fs, { state: by === 'lock' ? 'locked' : by === 'ai' ? 'ai' : 'pinned', pinnedAt: at, by });
    } else fs.state = 'mixed';
  }

  // The pin stored at exactly this path, or (cut paths) under the older key the cut's pins still use.
  function ownPin(doc, parsed, cuts) {
    const pins = doc.pins || {};
    const path = P.format(parsed);
    if (pins[path]) return { path, pin: pins[path] };
    if (parsed.scope.kind === 'cut' && cuts[0] && cuts[0].pinKey && cuts[0].pinKey !== parsed.scope.id) {
      const alt = 'cut/' + cuts[0].pinKey + ':' + parsed.slot;
      if (pins[alt]) return { path: alt, pin: pins[alt] };
    }
    return null;
  }

  function fieldStates(doc, plan, sel, paths, opts) { return paths.map((p) => fieldState(doc, plan, sel, p, opts)); }

  // --- lock payload (§3.6) ---------------------------------------------------------------------------------------

  function isAuto(d) { return !!d && (d.from === 'auto' || d.from === 'rule' || d.from === 'fallback'); }

  // lockPayload(doc, plan, lineId) → { t: 'lock.set', lineId, pins }: every resolved cut-slot value of the line that
  // is not a pin (auto, rule, fallback) — part choices and their parameters, counts, orient, text.*, the seam into
  // each cut — as cut pins by 'lock' with the cut's sig, plus line/<id>:split with the current offsets. Pins are
  // written under the key the cut's pins already use (so earlier user pins stay attached). Background segments are
  // not frozen: they span several cuts, and a cut pin would split the segment around the locked line. Motions
  // forced by an arrange with motion: 'own' are not frozen either (their parameters are): the arrange decides them.
  function lockPayload(doc, plan, lineId, opts) {
    const registry = opts && opts.registry;
    const line = cutIndex(plan).lines.get(lineId);
    const pins = {};
    if (!line) return { t: 'lock.set', lineId, pins };
    const existing = doc.pins || {};
    const reg = registry || LK.currentRegistry();
    for (const key of line.cuts) {
      const cut = cutOf(plan, key);
      const pinKey = cut.pinKey || cut.key;
      const sig = cut.text;
      const put = (slot, v) => {
        const path = 'cut/' + pinKey + ':' + slot;
        if (!existing[path]) pins[path] = { v, by: 'lock', sig };
      };
      const forced = ownMotion(reg, cut);
      for (const slot of Object.keys(cut.slots)) {
        const d = cut.slots[slot];
        if (isAuto(d) && !(forced && CA.MOTION_KINDS.includes(slot) && d.from === 'rule')) put(slot, d.v);
        if (d.p && d.v !== 'none') putParams(put, slot, d);
      }
      const seam = cut.seamIn >= 0 ? plan.seams[cut.seamIn].slot : null;
      if (seam) {
        if (isAuto(seam)) put('seam', seam.v);
        if (seam.p) putParams(put, 'seam', seam);
      } else if (!(cut.key === plan.cuts[0].key)) {
        const hard = reg ? reg.fallback('seam') : 'hardCut';
        const hit = PINS.lookup(pinIndexOf(doc.pins), { cutKey: cut.key, pinCutKey: pinKey, lineId: cut.line }, 'seam');
        if (!hit) put('seam', hard);
      }
    }
    pins['line/' + lineId + ':split'] = { v: line.cuts.map((k) => P.cutOffset(k)), by: 'lock' };
    return { t: 'lock.set', lineId, pins };
  }

  // Whether the cut's arrange moves the text itself (motion: 'own'): its entrance, hold and exit are then forced by
  // that rule (from 'rule'), and the arrange's own pin keeps them; a lock pin on them could never apply.
  function ownMotion(registry, cut) {
    const d = cut.slots.arrange;
    const def = registry && d ? registry.get('arrange', d.v) : null;
    return !!def && def.motion === 'own';
  }

  // Parameters that are not pins: shared ones at 'kind.param' / 'kind#i.param', part ones at 'kind@key.param'.
  function putParams(put, slot, d) {
    const m = /^([a-z]+)(?:#(\d))?$/.exec(slot);
    if (!m) return;
    const kind = m[1], idx = m[2] === undefined ? null : Number(m[2]);
    const shared = REG.SHARED[kind] || {};
    for (const name of Object.keys(d.p)) {
      if (d.pfrom && d.pfrom[name]) continue;
      put(P.slotParamPath(kind, idx, d.v, name, !!shared[name]), d.p[name]);
    }
  }

  return {
    fieldState, fieldStates, lockPayload, pinSig: PL.pinSig, valueAt, decisionAt, categoryOf, cutsFor, cutOf, choiceSlot,
    schemaOf, canPinAt,
  };
});
