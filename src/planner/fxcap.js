/* 文字PVメーカー v2 — original work. 「効果を重ねすぎない」 (T5 of 文字PVの定石): the lettering rule and the cut budget (DESIGN_2_2 §2.3). */
MV.def('planner/fxcap', ['core/num', 'planner/extreme', 'planner/rules'], (N, XT, RU) => {
  'use strict';

  // Two layers. The lettering rule (primary): the letters never carry two effects of the same kind — no glowing move
  // on glowing text, no after-image on outlined text, never more than two effect channels at once — a hard block on
  // the chooser's automatic picks (planner/choose pick, with a fallback when every candidate clashes). The cut budget
  // (secondary): a cut still too busy chooses fewer decorations, then fewer screen effects, and gets no transition on
  // top unless the background changes. The camera, the motions (except by the lettering block), impact hits, pins,
  // locks, aligned copies, EXTREME and キメ lines are never touched.

  const PER_CUT_ROLES = new Set(['lyric', 'focus']);
  const MOTION_KINDS = Object.freeze(['arrive', 'dwell', 'depart']);
  // A motion counts in the load (MOT) when it is loud: hard or busy, or made for impacts.
  const LOUD_TAGS = Object.freeze(['hard', 'busy']);

  // The effect channels of a text style (core/registry TEXT_STYLES): an outline or a two-tone fill is an edge, a glow
  // style a glow. A shadow is not a stacked effect.
  const STYLE_CH = Object.freeze({ plain: Object.freeze([]), shadow: Object.freeze([]), outline: Object.freeze(['edge']),
    duo: Object.freeze(['edge']), glow: Object.freeze(['glow']) });
  // The styles a weight animation (P4's wt channel) must not run on: their fill is painted in two layers.
  const WT_STYLES = new Set(['outline', 'shadow', 'duo']);

  // The glyph channels each motion part puts on the letters (the pose columns glow, echo, tint, blur, shard, pixel it
  // moves away from rest; and wt, P4's weight animation). Derived from the engine and locked by fx_cap.test.js: every
  // catalog motion part must have exactly the channels its scene shows. Every other motion part has none.
  const GLYPH = Object.freeze({
    'arrive/bloomOpen': ['glow', 'tint'], 'arrive/fogIn': ['blur'], 'arrive/ghostConverge': ['echo'],
    'arrive/inkRise': ['blur', 'tint'], 'arrive/pixelStep': ['pixel', 'tint'], 'arrive/rainDrop': ['blur'],
    'arrive/shardGather': ['shard'], 'arrive/sliceReveal': ['tint'], 'arrive/stampPress': ['tint'],
    'arrive/staticJoin': ['echo', 'tint'], 'arrive/strobeIn': ['tint'], 'arrive/zoomSettle': ['blur'],
    'dwell/shimmerSweep': ['tint'],
    'depart/burnOut': ['glow', 'tint'], 'depart/fogOut': ['blur'], 'depart/inkSink': ['blur', 'tint'],
    'depart/meltDown': ['blur'], 'depart/pointImplode': ['blur', 'tint'], 'depart/shardBurst': ['shard', 'tint'],
    'depart/sliceHide': ['tint'], 'depart/strobeOut': ['tint'], 'depart/zoomPast': ['blur'],
    // P4's weight parts (太る・脈打つ太さ・細る): inert while they are not in the registry
    'arrive/weightGrow': ['wt'], 'dwell/weightPulse': ['wt'], 'depart/weightThin': ['wt'],
  });
  for (const k of Object.keys(GLYPH)) Object.freeze(GLYPH[k]);
  const NONE = Object.freeze([]);
  // The screen effects that act on the lettering as a channel of their own.
  const TEXT_FILTER_CH = Object.freeze({ glowSpill: 'glow', afterImage: 'echo', chromaSlip: 'split' });

  function glyphOf(kind, key) { return typeof key === 'string' ? GLYPH[kind + '/' + key] || NONE : NONE; }

  // chan(C): the channels that stack (a colour shift, tint, is not a stacked effect).
  function chan(list) { return list.filter((c) => c !== 'tint'); }

  // clash(S, C, style): the letters of style channels S would carry C on top — glow on glow, an after-image on an
  // edge, a weight animation on a two-layer fill, or more than two channels at once.
  function clash(S, C, style) {
    if (S.includes('glow') && C.includes('glow')) return true;
    if (S.includes('edge') && C.includes('echo')) return true;
    if (style && WT_STYLES.has(style) && C.includes('wt')) return true;
    const all = new Set(S);
    for (const c of chan(C)) all.add(c);
    return all.size > 2;
  }

  // --- the lettering block ---------------------------------------------------------------------------------------

  // letterBlock(kind, style, chosen, prior) → { id, has(key) } | null: which automatic candidates of a motion or screen
  // effect slot would clash with the cut's lettering. style = the cut's text.style; chosen = the cut's decided values
  // (its entrance, hold and exit, for a screen effect); prior = the channels of the text screen effects the cut already
  // has (earlier filter slots). Motions run one after another, so a screen effect adds to one phase at a time.
  const blocks = new Map();
  function letterBlock(kind, style, chosen, prior) {
    const S = STYLE_CH[style] || NONE;
    if (MOTION_KINDS.includes(kind)) {
      const id = 'm|' + kind + '|' + style;
      let b = blocks.get(id);
      if (b === undefined) {
        const set = new Set();
        for (const name of Object.keys(GLYPH)) {
          const [k, key] = name.split('/');
          if (k === kind && clash(S, GLYPH[name], style)) set.add(key);
        }
        b = set.size ? Object.freeze({ id, has: (key) => set.has(key) }) : null;
        blocks.set(id, b);
      }
      return b;
    }
    if (kind !== 'filter') return null;
    const phases = MOTION_KINDS.map((k) => (chosen ? chosen[k] : null));
    const pre = prior && prior.length ? prior.slice().sort().join('+') : '';
    const id = 'f|' + style + '|' + phases.join('|') + '|' + pre;
    let b = blocks.get(id);
    if (b === undefined) {
      const set = new Set();
      const base = S.concat(prior || NONE);
      for (const key of Object.keys(TEXT_FILTER_CH)) {
        const c = TEXT_FILTER_CH[key];
        let bad = clash(base, [c], style) || base.includes(c);
        for (let i = 0; i < 3 && !bad; i++) {
          const G = glyphOf(MOTION_KINDS[i], phases[i]);
          if (G.includes(c)) bad = true;
          else {
            const all = new Set(base);
            for (const x of chan(G)) all.add(x);
            all.add(c);
            if (all.size > 2) bad = true;
          }
        }
        if (bad) set.add(key);
      }
      b = set.size ? Object.freeze({ id, has: (key) => set.has(key) }) : null;
      if (blocks.size > 4096) blocks.clear();
      blocks.set(id, b);
    }
    return b;
  }

  // The channels of a cut's text screen effects decided before filter slot `idx` (slots filter#0 … filter#idx−1).
  function priorFilters(slots, idx) {
    let out = null;
    for (let i = 0; i < idx; i++) {
      const d = slots['filter#' + i];
      const c = d && typeof d.v === 'string' ? TEXT_FILTER_CH[d.v] : undefined;
      if (c) (out || (out = [])).push(c);
    }
    return out;
  }

  // --- the cut budget -----------------------------------------------------------------------------------------------

  function atOf(cut) { return { cutKey: cut.key, pinCutKey: cut.pinKey || null, lineId: cut.line || null }; }

  // xOn(ctx, cut) → the EXTREME switch resolves on at the cut (its moves are the camera's and never trimmed).
  function xOn(ctx, cut) { return XT.valueAt(ctx.ix, atOf(cut)) > 0; }

  // capOf(ctx, cut, x) → the cut's budget: 1カットに重ねる効果の目安 (its pin, else 3 + round(3 · cut pace)), one more on
  // an impact line and one more where EXTREME is on (x = xOn, computed when omitted).
  function capOf(ctx, cut, x) {
    const pinned = ctx.rules && typeof ctx.rules.fxMax === 'number' ? ctx.rules.fxMax : null;
    const base = pinned !== null ? pinned : RU.baseCap(ctx.look ? ctx.look.amounts : null);
    const on = x === undefined ? xOn(ctx, cut) : x;
    return base + (cut.impact ? 1 : 0) + (on ? 1 : 0);
  }

  function countOf(slots, slot) {
    const d = slots[slot];
    return d && typeof d.v === 'number' ? d.v : 0;
  }

  // fixedOf(ctx, slots, cut, x) → the layers T5 never trims: a moving camera texture (LENS), the camera move (CAM: a
  // shot, or a framing lens, which is the cut's camera move; EXTREME counts 2), a loud motion (MOT) and the hit (IMP).
  function fixedOf(ctx, slots, cut, x) {
    const reg = ctx.registry;
    let lens = 0, frames = false;
    const l = slots.lens;
    if (l && typeof l.v === 'string' && l.v !== 'none' && reg.has('lens', l.v)) {
      const def = reg.get('lens', l.v);
      frames = !!def.frames;
      if (!frames && def.family !== 'still') lens = 1;
    }
    const shot = slots['cam.shot'];
    const cam = x ? 2 : (shot && shot.v !== 'none' && shot.v !== undefined && shot.v !== null) || frames ? 1 : 0;
    let mot = 0;
    for (const kind of MOTION_KINDS) {
      const d = slots[kind];
      if (!d || typeof d.v !== 'string' || d.v === 'none' || !reg.has(kind, d.v)) continue;
      const def = reg.get(kind, d.v);
      const traits = reg.traits(kind, d.v);
      if ((def.tags || []).some((t) => LOUD_TAGS.includes(t)) || (traits && traits.impact)) { mot = 1; break; }
    }
    return lens + cam + mot + (cut.impact ? 1 : 0);
  }

  // loadOf(ctx, slots, cut, x) → the cut's load as cast: decorations + screen effects + the fixed layers. Not counted:
  // the section rig, the atmosphere, the work texture and the background.
  function loadOf(ctx, slots, cut, x) {
    const on = x === undefined ? xOn(ctx, cut) : x;
    return countOf(slots, 'ornament.count') + countOf(slots, 'filter.count') + fixedOf(ctx, slots, cut, on);
  }

  // keepOf(ctx, cut, film, fv) → the screen effects a trim keeps: one for a film mood's look (its filter drive ≥ 0.5)
  // and one for the impact line's flash, at most the cut's own count fv.
  const FILM = 0.5;
  function keepOf(ctx, cut, film, fv) {
    const flash = cut.impact && ctx.look && ctx.look.amounts && ctx.look.amounts.flash > 0 ? 1 : 0;
    return Math.min(fv, (film >= FILM ? 1 : 0) + flash);
  }

  // needOf(slots) → the decorations a trim keeps: up to the highest pinned decoration slot.
  function needOf(slots, count) {
    let need = 0;
    for (let i = 0; i < count; i++) {
      const d = slots['ornament#' + i];
      if (d && typeof d.from === 'string' && d.from.startsWith('pin')) need = i + 1;
    }
    return need;
  }

  // A count the trim may lower: automatic (or raised by a pinned index, 'rule', which keeps it at the pin), and not taken
  // from the cut's aligned source (「くり返しの行をそろえる」).
  function free(d, slot, fromAlign) {
    return !!d && (d.from === 'auto' || d.from === 'rule') && !(fromAlign && fromAlign.has(slot));
  }

  // trim(ctx, st, needF, film, kime) → { ornament?: n, filter?: m } | null: the lower counts that bring the cut under
  // its cap — decorations first (never below the highest pinned one), then screen effects (never below a pinned index,
  // the film keep and the hit's flash). Called after the filter count and before the filter slots (planner/cast
  // decideList), and in the camera-only passes after the camera, so every pass trims alike.
  function trim(ctx, st, needF, film, kime) {
    const cut = st.cut;
    if (kime || !PER_CUT_ROLES.has(cut.role)) return null;
    const slots = st.slots;
    const o = slots['ornament.count'], f = slots['filter.count'];
    if (!o || !f) return null;
    const x = xOn(ctx, cut);
    const cap = capOf(ctx, cut, x);
    let over = fixedOf(ctx, slots, cut, x) + o.v + f.v - cap;
    if (over <= 0) return null;
    const out = {};
    if (free(o, 'ornament.count', st.fromAlign)) {
      const n = Math.max(needOf(slots, o.v), o.v - over);
      if (n < o.v) { out.ornament = n; over -= o.v - n; }
    }
    if (over > 0 && free(f, 'filter.count', st.fromAlign)) {
      const m = Math.max(needF || 0, keepOf(ctx, cut, film, f.v), f.v - over);
      if (m < f.v) out.filter = m;
    }
    return out.ornament !== undefined || out.filter !== undefined ? out : null;
  }

  // gate(ctx, B, slots, world, kime) → whether T5 gives B no automatic transition: B is still over its cap after its
  // trim and the background does not change (a new background always may come in with a transition).
  function gate(ctx, B, slots, world, kime) {
    if (world || kime || !PER_CUT_ROLES.has(B.role)) return false;
    const x = xOn(ctx, B);
    return loadOf(ctx, slots, B, x) > capOf(ctx, B, x);
  }

  return {
    PER_CUT_ROLES, LOUD_TAGS, STYLE_CH, GLYPH, TEXT_FILTER_CH, MOTION_KINDS, chan, clash, glyphOf, letterBlock, priorFilters,
    xOn, capOf, fixedOf, loadOf, keepOf, needOf, trim, gate,
  };
});
