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
  const FX_MAX = Object.freeze({ type: 'int', min: 2, max: 8 });
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
    // P3 キメ (DESIGN_2_2 §3): 「キメの前を静かにする」, on in every generation (it acts only next to a line the user marked
    // キメ, line/<id>:kime, which is a line pin of its own and not a table row)
    row('kime.calm', null, WORK, BOOL, true, true),
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
      // a cut pin never applies (refused by core/commands; a stray one in a hand-edited file is skipped)
      const coerce = PA.acceptSpec(spec);
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

  return { ROWS, SPECS, isRule, rowOf, scopesOf, gen, defaultValue, value, valueAt, hasDefault, sameValue };
});
