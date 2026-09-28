/* 文字PVメーカー v2 — original work. The one table of new-work defaults: switches and strengths whose default depends on the document's generation (look.gen, DESIGN_2_2 §0). */
MV.def('planner/rules', ['core/pins', 'planner/params'], (PINS, PA) => {
  'use strict';

  // A document made by core/doc newDoc() carries look.gen (D.GEN = 1); older documents, opened files and every
  // fixture have none. Each row below says what its slot is when nothing pins it: `on` in a document of generation ≥ 1,
  // `off` in an older one — or, for a row with a parent, whatever the parent resolves to (a member of a switch group
  // follows the group's switch). A pin always wins, so 固定を外す returns a switch to the document's default, and
  // turning a switch on in an older document is one work (or line) pin.
  //
  // Row fields: slot; parent (a row slot, or null); scopes (where a pin of the slot may live: 'work', 'line'); spec
  // (the value's ParamSpec, core/schema); on, off (the defaults; null = automatic, decided elsewhere).
  // Packages add their rows here (P1 typesetting, P2 conventions, P4 glyph motion, P5 timing, P6 歌ハメ).
  const BOOL = Object.freeze({ type: 'bool' });
  const STRENGTH = Object.freeze({ type: 'num', min: 0, max: 1, step: 0.05 });
  const HEAD = Object.freeze({ type: 'enum', of: Object.freeze(['line', 'phrase', 'none']) });
  // 1カットに重ねる効果の目安: 4–8 (a cap below 4 could not be kept: the camera, the motions and the hit are never trimmed).
  const FX_MAX = Object.freeze({ type: 'int', min: 4, max: 8 });
  const WORK = Object.freeze(['work']);
  const WORK_LINE = Object.freeze(['work', 'line']);

  function row(slot, parent, scopes, spec, on, off) {
    return Object.freeze({ slot, parent, scopes, spec, on, off });
  }

  const ROWS = Object.freeze([
    // P2 文字PVの定石: one group switch and its members (DESIGN_2_2 §2)
    row('pv.rules', null, WORK, BOOL, true, false),
    row('repeat.same', 'pv.rules', WORK_LINE, BOOL, true, false),
    row('pv.kit', 'pv.rules', WORK, BOOL, true, false),
    row('pv.alternate', 'pv.rules', WORK, BOOL, true, false),
    row('pv.arc', 'pv.rules', WORK, BOOL, true, false),
    row('pv.fxCap', 'pv.rules', WORK, BOOL, true, false),
    row('pv.fxMax', null, WORK, FX_MAX, null, null),
    // P1 文字組み (DESIGN_2_2 §1)
    row('text.kana', null, WORK_LINE, STRENGTH, 0.7, 0),
    row('text.jump', null, WORK_LINE, STRENGTH, 0.5, 0),
    row('text.latin', null, WORK_LINE, STRENGTH, 0.5, 0),
    row('text.head', null, WORK_LINE, HEAD, 'line', 'line'),
    // P4 モーフ・太さ (DESIGN_2_2 §4)
    row('morph.auto', null, WORK_LINE, BOOL, true, false),
    row('weight.auto', null, WORK, BOOL, true, false),
  ]);

  const BY_SLOT = new Map(ROWS.map((r) => [r.slot, r]));
  const SPECS = Object.freeze(Object.fromEntries(ROWS.map((r) => [r.slot, r.spec])));

  function isRule(slot) { return BY_SLOT.has(slot); }
  function rowOf(slot) { return BY_SLOT.get(slot) || null; }
  function scopesOf(slot) { const r = BY_SLOT.get(slot); return r ? r.scopes : null; }

  // gen(doc) → the document's generation: look.gen when it is an integer ≥ 0, else 0.
  function gen(doc) {
    const g = doc && doc.look ? doc.look.gen : undefined;
    return Number.isInteger(g) && g >= 0 ? g : 0;
  }

  // The pin index of a document when the caller has none (planner ctx.ix is preferred: it is cached per document).
  function indexOf(doc, ix) { return ix || PINS.index((doc && doc.pins) || {}); }

  const accepts = new Map();
  function acceptOf(slot) {
    let a = accepts.get(slot);
    if (!a) {
      const spec = BY_SLOT.get(slot).spec;
      // a cut pin never applies (refused by core/commands; a stray one in a hand-edited file is skipped). A switch takes
      // only true or false, and a count only an integer of its range (1カットに重ねる効果の目安 3 is not 4): anything
      // else is a bad value (pin-bad-value where the planner reads it) and the default applies.
      const coerce = spec.type === 'bool' ? (v) => (typeof v === 'boolean' ? { v } : { bad: true })
        : spec.type === 'int' ? (v) => (Number.isInteger(v) && v >= spec.min && v <= spec.max ? { v } : { bad: true })
          : PA.acceptSpec(spec);
      a = (v, rank) => (rank === 'pin:cut' ? { na: true } : coerce(v));
      accepts.set(slot, a);
    }
    return a;
  }

  // pinAt(ix, slot, at) → the pin that applies at a place ({ lineId } for a line, nothing for the whole work), coerced by
  // the row's spec: { v, from, by, at } | null. A line pin counts only where the row allows line scope.
  function pinAt(ix, slot, at) {
    const r = BY_SLOT.get(slot);
    if (!r || !ix || !PA.pinned(ix, slot)) return null;
    const lineId = at && at.lineId && r.scopes.includes('line') ? at.lineId : null;
    return PA.resolvePin(ix, { cutKey: null, pinCutKey: null, lineId }, slot, acceptOf(slot), null);
  }

  // defaultValue(doc, ix, slot) → what the slot is at the whole work without its own pin: the parent's value, else
  // `on` (generation ≥ 1) or `off`. undefined for a slot that is not in the table.
  function defaultValue(doc, ix, slot) {
    const r = BY_SLOT.get(slot);
    if (!r) return undefined;
    if (r.parent) return value(doc, ix, r.parent);
    return gen(doc) >= 1 ? r.on : r.off;
  }

  // value(doc, ix, slot) → the slot at the whole work: its work pin (coerced), else defaultValue.
  function value(doc, ix, slot) {
    const r = BY_SLOT.get(slot);
    if (!r) return undefined;
    const pin = pinAt(indexOf(doc, ix), slot, null);
    return pin ? pin.v : defaultValue(doc, ix, slot);
  }

  // valueAt(doc, ix, slot, lineId) → the slot at a line: its line pin (where allowed), else value(doc, ix, slot).
  function valueAt(doc, ix, slot, lineId) {
    const r = BY_SLOT.get(slot);
    if (!r) return undefined;
    const pin = lineId ? pinAt(indexOf(doc, ix), slot, { lineId }) : null;
    return pin ? pin.v : value(doc, ix, slot);
  }

  // hasDefault(slot) → whether new and older documents differ for the slot (the inspector says 自動（オン）/自動（オフ）
  // only for those).
  function hasDefault(slot) {
    const r = BY_SLOT.get(slot);
    if (!r) return false;
    return r.parent ? hasDefault(r.parent) : r.on !== r.off;
  }

  function sameValue(a, b) {
    return typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : a === b;
  }

  // --- 文字PVの定石 (P2, DESIGN_2_2 §2) ----------------------------------------------------------------------------

  // The members of the group switch pv.rules whose behaviour the planner reads through ctx.rules, and the slot of
  // 1カットに重ねる効果の目安 (no parent: pinned, else automatic from the mood's cut pace, baseCap).
  const PV = Object.freeze({ rules: 'pv.rules', repeat: 'repeat.same', kit: 'pv.kit', alt: 'pv.alternate', arc: 'pv.arc',
    fx: 'pv.fxCap', fxMax: 'pv.fxMax' });

  // repeatDefault(doc, ix) → what 「くり返しの行をそろえる」 is where no pin applies: the value of 文字PVの定石 (on in a new
  // work unless pinned off). false without a document (callers that plan a stub context keep the v2.1 opt-in).
  function repeatDefault(doc, ix) {
    return doc && typeof doc === 'object' ? defaultValue(doc, ix, PV.repeat) === true : false;
  }

  // The work value of a P2 slot for resolve: its work pin (coerced; a value the slot cannot hold warns pin-bad-value
  // once through `warn`, and falls back), else the parent's value, else the generation's default.
  function resolveSlot(doc, ix, slot, warn, seen) {
    if (seen.has(slot)) return seen.get(slot);
    const r = BY_SLOT.get(slot);
    const pin = ix && PA.pinned(ix, slot)
      ? PA.resolvePin(ix, { cutKey: null, pinCutKey: null, lineId: null }, slot, acceptOf(slot), warn) : null;
    const v = pin ? pin.v : r.parent ? resolveSlot(doc, ix, r.parent, warn, seen) : gen(doc) >= 1 ? r.on : r.off;
    seen.set(slot, v);
    return v;
  }

  // resolve(ctx) → the work-level values of 文字PVの定石 for one plan (planner/plan stage 2, ctx.rules): frozen
  // { gen, rules, repeatDefault, kit, alt, arc, fx, fxMax, any, id }. any = some member that changes the cast is on
  // (then planner/conventions builds ctx.pv); id = a short text of all of it for the cast cache's look key. A legacy
  // document (no look.gen, no pv pin) gives every value false and fxMax null. 「くり返しの行をそろえる」 keeps its own
  // pins (work and line), which planner/cast reads cut by cut; only its default is here. Its bad pins warn there.
  function resolve(ctx) {
    const doc = ctx.doc, ix = ctx.ix || indexOf(doc, null);
    const warn = ctx.warn || null;
    const seen = new Map();
    const g = gen(doc);
    const on = (slot) => resolveSlot(doc, ix, slot, warn, seen) === true;
    const rules = on(PV.rules);
    const kit = on(PV.kit), alt = on(PV.alt), arc = on(PV.arc), fx = on(PV.fx);
    const max = resolveSlot(doc, ix, PV.fxMax, warn, seen);
    const fxMax = typeof max === 'number' ? max : null;
    const b = (x) => (x ? '1' : '0');
    const id = 'g' + g + '|r' + b(rules) + '|k' + b(kit) + 'a' + b(alt) + 'c' + b(arc) + 'f' + b(fx) + '|m' + (fxMax === null ? '-' : fxMax);
    return Object.freeze({ gen: g, rules, repeatDefault: rules, kit, alt, arc, fx, fxMax, any: kit || alt || arc || fx, id });
  }

  // baseCap(amounts) → the automatic 1カットに重ねる効果の目安 of a look: 3 + round(3 · cut pace), clamped to the slot's
  // range (4 for calm moods, 6 for the fastest).
  function baseCap(amounts) {
    const pace = amounts && typeof amounts.pace === 'number' && Number.isFinite(amounts.pace) ? amounts.pace : 0.5;
    return Math.min(FX_MAX.max, Math.max(FX_MAX.min, 3 + Math.round(3 * pace)));
  }

  // The whole-video switches a rule field shows (planner/fields category 'rule'): a slot of the table at work scope.
  function isWorkRule(parsed) {
    return !!parsed && parsed.scope && parsed.scope.kind === 'work' && !parsed.part && !parsed.el && BY_SLOT.has(parsed.slot);
  }

  return {
    ROWS, SPECS, PV, isRule, rowOf, scopesOf, gen, defaultValue, value, valueAt, hasDefault, sameValue, repeatDefault, resolve,
    baseCap, isWorkRule,
  };
});
