/* 文字PVメーカー v2 — original work. Tracks: background segments, seams (decided after grounds), rule overrides, impulses (DESIGN §4.16.6; DESIGN_2_1 §4.9, §11.2.6, §11.5.9). */
MV.def('planner/tracks', ['core/rng', 'core/num', 'core/paths', 'planner/choose', 'planner/params', 'planner/cast',
  'planner/camera', 'planner/morph', 'planner/rules'], (R, N, P, CH, PA, CA, CAM, MO, RU) => {
    'use strict';

    const SPECIAL = new Set(['title', 'interlude', 'outro']);
    const WORLD_CHANCE = 0.7;
    const ATMOS_CHANCE = 0.6;
    const LINE_SEASON_ATMOS = 0.85;  // at least this atmos chance where a line pins its own season (DESIGN_2_1 §4.9)
    const SEAM_SHARE = 0.4;         // a seam takes at most 40 % of the shorter of its two cuts
    const WORLD_MAX = 0.8;          // world seams are clamped to 0.8 s (§7.4)
    const GAP_BREAK = 1.5;
    const MEDIA_MIN_SEGMENT = 3;    // seconds: shorter segments never take a derived media ground (§11.5.9)
    const MORPH = 'glyphMorph';     // the glyph morph seam (v2.2, DESIGN_2_2 §4): chosen by the rule `morph`
    const MORPH_SLOT = 'morph.auto';
    const LYRIC_ROLES = new Set(['lyric', 'focus']);
    const GROW_KEY = 'weightGrow';

    function atOf(cut) { return { cutKey: cut.key, pinCutKey: cut.pinKey, lineId: cut.line }; }

    function tracing(ctx, cutKey, slot) {
      const t = ctx.trace;
      if (!t || t.cutKey !== cutKey || t.slot !== slot) return null;
      t.hit = true;
      return t.out;
    }

    // Recency over earlier segments or boundaries, read like the cuts' history (planner/cast createHistory): an entry
    // is { v, base, ref } (the value, its natural pick and its reference pick). `recent` weighs against the previous
    // entry's natural and reference picks; `ref` (the reference pick's recency) against its natural pick only; both
    // against the natural picks of the 3 entries before it.
    function recentOf(ctx, kind, entries) {
      const n = entries.length;
      const last = n ? entries[n - 1] : null;
      const near = [];
      for (let i = Math.max(0, n - 4); i < n - 1; i++) if (!near.includes(entries[i].base)) near.push(entries[i].base);
      return {
        recent: setsOf(ctx, kind, last ? [last.base, last.ref] : [], near),
        ref: setsOf(ctx, kind, last ? [last.base] : [], near),
      };
    }

    // { prev, near, families } as small arrays (planner/choose reads them with includes).
    function setsOf(ctx, kind, prevValues, near) {
      const prev = [];
      const families = [];
      for (const key of prevValues) {
        if (prev.includes(key)) continue;
        prev.push(key);
        const def = key && key !== 'none' ? ctx.registry.get(kind, key) : null;
        if (def && def.family && !families.includes(def.family)) families.push(def.family);
      }
      return { prev, near, families };
    }

    // The history entry of a decision; got = the chooser's answer (with its natural and reference picks) or null.
    function entryOf(d, got) {
      return { v: d.v, base: (got && got.base) || d.v, ref: (got && got.ref) || d.v, win: (got && got.win) || d.v };
    }

    // coverage: the segment's text coverage, for the depth of a background photo (PA.textCoverage, §11.9.2).
    function params(ctx, def, slotKind, at, seed, feat, partKind, coverage) {
      return PA.resolveParams(def, slotKind, null, at, ctx.ix, {
        registry: ctx.registry, seed, salts: ctx.salts, warn: ctx.warn, f: feat, look: CA.lookAx(ctx),
        partKind: partKind || slotKind, media: ctx.media, coverage: coverage || 0,
      });
    }

    // The decision with its parameters, as a new object with its keys in sorted order (planner/encode prints it
    // natively); d itself is left as it is.
    function withParams(d, got) {
      const out = {};
      if (d.by !== undefined) out.by = d.by;
      out.from = d.from;
      out.p = got.p;
      if (got.pfrom) out.pfrom = got.pfrom;
      out.v = d.v;
      return out;
    }

    function pinDecision(pin) { return { by: pin.by, from: pin.from, v: pin.v }; }

    // --- background segments ------------------------------------------------------------------------------------

    function groundPin(ctx, cut, warn) {
      return PA.resolvePin(ctx.ix, atOf(cut), 'ground', CA.acceptPart(ctx, 'ground', null, { checkRole: false }), warn);
    }

    function atmosPin(ctx, cut, warn) {
      return PA.resolvePin(ctx.ix, atOf(cut), 'atmos',
        CA.acceptPart(ctx, 'ornament', null, { none: true, scope: 'run', checkRole: false }), warn);
    }

    // breakScore (§4.16.6) for starting a new segment at cut B. The DESIGN's "(cuts in segment ≥ L ? 1 : 0)" is a
    // running counter: one inserted line shifts every later boundary and they never fall back into step (measured:
    // 12 of 12 later segments moved, taking their seams and the seams' replace rules with them). It is replaced by
    // its memoryless equivalent, a per-cut coin with probability 2 / (L + 1) (keyed by B, like the noise), which
    // gives the same mean segment length (L + 1 cuts when nothing else breaks) and keeps every boundary local.
    function breakScore(ctx, A, B, L) {
      const sa = A.feat.section, sb = B.feat.section;
      const seed = CH.segSeed(ctx.doc.look.seed, B.key, ctx.salts);
      const long = R.stream(seed, 'length').next() < 2 / (L + 1);
      return (sb && sa !== sb ? 1 : 0)
        + (SPECIAL.has(A.role) || SPECIAL.has(B.role) ? 1 : 0)
        + (B.impact ? 0.5 : 0)
        + (B.t0 - A.t1 > GAP_BREAK ? 0.4 : 0)
        + (long ? 1 : 0)
        + (R.stream(seed, 'break').next() - 0.5) * 0.6;
    }

    // Segments of consecutive cuts. The resolved ground pin (gp) and atmos pin (ap) of each cut split them like
    // §4.16.6 says for the ground: a new segment starts where either differs from the previous cut's, so a pin on any
    // cut (or line) applies to exactly the cuts it covers; with neither pinned, breakScore decides. DESIGN_2_1 adds
    // two more breaks: where the effective season of the cut differs from the previous cut's (only line season pins
    // make them differ, §4.9), and where the resolved value of a media param of the pinned ground or atmos part
    // changes (compared by string, §11.2.6), so two lines pinned to one photo part with different photos each show
    // their own.
    // Under 「くり返しの行をそろえる」 (DESIGN_2_1 §4.10) a cut that takes its decisions from an earlier copy (its source,
    // planner/cast alignments) starts a segment where its source does, instead of by breakScore, so a repeated chorus
    // is cut into backgrounds as its first copy was.
    function splitSegments(ctx, cuts) {
      const L = Math.round(N.lerp(8, 1, ctx.look.amounts.groundSwitch));
      const segs = [];
      const heads = ctx.align ? new Set() : null;
      let cur = null;
      cuts.forEach((cut, j) => {
        const pin = groundPin(ctx, cut, ctx.warn);
        const apin = atmosPin(ctx, cut, ctx.warn);
        const gp = pin ? pin.v : null, ap = apin ? apin.v : null;
        const season = CA.lineCond(ctx, cut.line).season;
        const src = gp === null && ap === null ? '' : mediaSource(ctx, cut, 'ground', gp) + '|' + mediaSource(ctx, cut, 'atmos', ap);
        const copy = heads && cur ? CA.alignedSource(ctx, cut, 'ground') : null;
        const fresh = !cur || gp !== cur.gp || ap !== cur.ap || season !== cur.season || src !== cur.src ||
          (gp === null && (copy ? heads.has(copy.key) : breakScore(ctx, cuts[j - 1], cut, L) >= 1));
        if (fresh) {
          cur = { gp, ap, pin, apin, season, src, idx: [] };
          segs.push(cur);
          if (heads) heads.add(cut.key);
        }
        cur.idx.push(j);
      });
      return segs;
    }

    // The media params of a part as [{ name, spec, slot }] (slot paths at `slotKind`), made once per definition.
    const mediaParamCache = new WeakMap();
    function mediaParams(ctx, slotKind, key) {
      const partKind = slotKind === 'atmos' ? 'ornament' : slotKind;
      const def = ctx.registry.get(partKind, key);
      if (!def) return NO_PARAMS;
      let byKind = mediaParamCache.get(def);
      if (!byKind) { byKind = new Map(); mediaParamCache.set(def, byKind); }
      let list = byKind.get(slotKind);
      if (!list) {
        list = (ctx.registry.params(partKind, key) || []).filter((x) => x.spec && x.spec.type === 'media')
          .map((x) => ({ name: x.name, spec: x.spec, slot: P.slotParamPath(slotKind, null, key, x.name, x.shared),
            accept: PA.acceptSpec(x.spec) }));
        byKind.set(slotKind, list);
      }
      return list;
    }
    const NO_PARAMS = Object.freeze([]);

    // The resolved values of the media params of the pinned part `key` at a cut, as one string ('' without any).
    function mediaSource(ctx, cut, slotKind, key) {
      if (key === null || key === 'none') return '';
      const list = mediaParams(ctx, slotKind, key);
      if (!list.length) return '';
      let out = '';
      for (const x of list) {
        const pin = PA.resolvePin(ctx.ix, atOf(cut), x.slot, x.accept, null);
        const v = pin ? pin.v : x.spec.auto && typeof x.spec.auto.value === 'string' ? x.spec.auto.value : '';
        out += x.name + '=' + v + ';';
      }
      return out;
    }

    // A decision of the chooser for a segment or boundary: { decision, entry } (entry = its history entry).
    function chosen(ctx, req, trace) {
      const got = CA.chooseAuto(ctx, Object.assign(req, { trace }));
      return { decision: { from: got.from, v: got.v }, entry: entryOf(got, got) };
    }

    // A decision that did not come from the chooser (a pin, or 'none' / the hard cut by chance).
    function fixed(d) { return { decision: d, entry: entryOf(d, null) }; }

    // For explain: the chooser's alternatives of a pinned slot.
    function shadow(ctx, req, trace, extra) {
      CA.chooseAuto(ctx, Object.assign(req, { trace, silent: true }));
      Object.assign(trace, extra);
    }

    // What the next segment or boundary must not pick (planner/choose pick `avoid`, SPEC §6 "avoids repeating the same
    // choice in neighbouring cuts"): the previous entry's winner before its own avoid (`win`). The ×0.03 recency alone
    // is not enough for small pools: with the catalog's two text transitions, 13 % of neighbouring ones repeated under
    // high-variety moods. Avoiding the previous *final* value (as arrange/arrive do) would chain: a changed value
    // changes what the next one avoids, and so on down the song. The winner depends only on the natural and reference
    // picks before it, so a change stays within the recency window; a repeat is left only when the previous entry was
    // itself avoided onto what this one wins (0.5 % of neighbouring transitions with the catalog, was 5.6 %).
    // `free` (the hard cut, 'none') is no choice to avoid, and a lock-frozen seam records its unlocked entry
    // (seamEntry), so locks stay invisible.
    function avoidOf(history, free) {
      const last = history.length ? history[history.length - 1] : null;
      return last && last.win !== free ? last.win : null;
    }

    // A segment's ground. The segment reads its first cut's line conditions (season and avoid list, DESIGN_2_1 §4.9);
    // noMedia: derived grounds of the user's media weigh 0 here (§11.5.9); seg.coverage: its text coverage (§11.9.2).
    // copy: the ground of the source's segment under 「くり返しの行をそろえる」 (groundCopy), taken with its parameters.
    function decideGround(ctx, seg, first, seed, history, noMedia, copy) {
      const trace = tracing(ctx, first.key, 'ground');
      const rec = recentOf(ctx, 'ground', history);
      const cond = CA.lineCond(ctx, first.line);
      const req = { kind: 'ground', slot: 'ground', path: 'cut/' + first.key + ':ground', feat: first.feat, chosen: {}, seed,
        recent: rec.recent, ref: rec.ref, echo: null, cutKey: first.key, avoid: avoidOf(history, null), cond, noMedia };
      let out;
      if (seg.pin) {
        CA.pinWarnings(ctx, 'ground', seg.pin.v, seg.pin, cond);
        out = fixed(pinDecision(seg.pin));
        if (trace) shadow(ctx, req, trace, { kind: 'ground', stage: 'pin', pin: seg.pin, recent: rec.recent, echo: null });
      } else if (copy) {
        out = fixed(copied(copy.d));
        if (trace) shadow(ctx, req, trace, { kind: 'ground', stage: 'auto', why: [alignWhy(copy.src)], recent: rec.recent, echo: null });
        if (trace) trace.decision = out.decision;
        return out;
      } else {
        if (trace) Object.assign(trace, { kind: 'ground', recent: rec.recent, echo: null, noMedia });
        out = chosen(ctx, req, trace);
      }
      const d = out.decision = withParams(out.decision, params(ctx, ctx.registry.get('ground', out.decision.v), 'ground',
        atOf(first), seed, first.feat, 'ground', seg.coverage));
      if (trace) trace.decision = d;
      return out;
    }

    // --- 「くり返しの行をそろえる」 (DESIGN_2_1 §4.10) -----------------------------------------------------------------

    function alignWhy(src) { return { code: 'repeat.same', params: { cut: src.key } }; }

    // A decision of the source's as the copy's own automatic one: its value and parameters (a pin of the source's
    // passes on as a value, like its parts', planner/cast).
    function copied(d) {
      const out = { from: 'auto' };
      if (d.p) out.p = d.p;
      out.v = d.v;
      return out;
    }

    // The ground a segment takes from its source's segment: its first cut has a source (planner/cast alignedSource) that
    // starts a segment of its own, neither is pinned (the segment's own pin wins; a work pin gives both the same), and
    // the ground fits (in the segment's pool; a derived media ground only where one may go, noMedia). → { src, d } | null.
    function groundCopy(ctx, seg, first, byHead, noMedia) {
      const src = seg.pin ? null : CA.alignedSource(ctx, first, 'ground');
      const s = src ? byHead.get(src.key) : null;
      if (!s) return null;
      const d = s.ground.decision;
      const def = ctx.registry.get('ground', d.v);
      if (!def || (noMedia && def.mine && def.mine.media === true)) return null;
      if (!isPinned(d) && !CA.poolOf(ctx, 'ground', { aspect: ctx.aspect, cond: CA.lineCond(ctx, first.line) }).includes(d.v)) {
        return null;
      }
      return { src, d };
    }

    // The atmosphere likewise (its own chance or pin at the source), unless the segment pins its own.
    function atmosCopy(ctx, seg, first, byHead) {
      const src = seg.apin ? null : CA.alignedSource(ctx, first, 'atmos');
      const s = src ? byHead.get(src.key) : null;
      return s ? { src, d: s.atmos.decision } : null;
    }

    // atmos: its pin (the segment's, see splitSegments), else with probability 0.6·amount.ornament the chooser over
    // ornaments with scope 'run' (nothing eligible → 'none'), else 'none'. Where the first cut's line pins its own
    // season the chance is at least 0.85, and run ornaments of that season weigh ×2.5 (the chooser's line season).
    function decideAtmos(ctx, seg, first, seed, history, copy) {
      const trace = tracing(ctx, first.key, 'atmos');
      const pin = seg.apin;
      const cond = CA.lineCond(ctx, first.line);
      const chance = cond.pinned ? Math.max(ATMOS_CHANCE * ctx.look.amounts.ornament, LINE_SEASON_ATMOS)
        : ATMOS_CHANCE * ctx.look.amounts.ornament;
      let out;
      if (pin) {
        CA.pinWarnings(ctx, 'ornament', pin.v, pin, cond);
        out = fixed(pinDecision(pin));
        if (trace) Object.assign(trace, { kind: 'ornament', stage: 'pin', pin });
      } else if (copy) {
        out = fixed(copied(copy.d));
        if (trace) Object.assign(trace, { kind: 'ornament', stage: 'auto', why: [alignWhy(copy.src)], decision: out.decision });
        return out;
      } else if (R.stream(seed, 'chance').next() < chance) {
        const rec = recentOf(ctx, 'ornament', history);
        if (trace) Object.assign(trace, { kind: 'ornament', recent: rec.recent, echo: null });
        out = chosen(ctx, { kind: 'ornament', slot: 'atmos', path: 'cut/' + first.key + ':atmos', feat: first.feat,
          chosen: {}, seed, scope: 'run', recent: rec.recent, ref: rec.ref, echo: null, orNone: true, cutKey: first.key,
          avoid: avoidOf(history, 'none'), cond }, trace);
      } else {
        out = fixed({ from: 'auto', v: 'none' });
        if (trace) Object.assign(trace, { kind: 'ornament', stage: 'rule', rule: 'chance' });
      }
      if (out.decision.v !== 'none') {
        out.decision = withParams(out.decision, params(ctx, ctx.registry.get('ornament', out.decision.v), 'atmos', atOf(first),
          seed, first.feat, 'ornament'));
      }
      const d = out.decision;
      if (trace) trace.decision = d;
      return out;
    }

    // A video with no cuts yet (nothing pasted) still gets its background: one segment with no cuts, key 'g', chosen
    // with the work-scope pins and a seed from look.seed alone.
    function emptyGround(ctx, duration) {
      const at = { cutKey: null, pinCutKey: null, lineId: null };
      const seed = CH.slotSeed(CH.segSeed(ctx.doc.look.seed, '', ctx.salts), '', null, 'ground', ctx.salts);
      const pin = PA.resolvePin(ctx.ix, at, 'ground', CA.acceptPart(ctx, 'ground', null, { checkRole: false }), ctx.warn);
      let d;
      if (pin) d = pinDecision(pin);
      else {
        const got = CA.chooseAuto(ctx, { kind: 'ground', slot: 'ground', path: 'work:ground', feat: null, chosen: {}, seed,
          recent: null, echo: null });
        d = { from: got.from, v: got.v };
      }
      d = withParams(d, params(ctx, ctx.registry.get('ground', d.v), 'ground', at, seed, null));
      return [{ atmos: { from: 'auto', v: 'none' }, cuts: [], fp: '', ground: d, key: 'g', t0: 0, t1: N.q6(Math.max(0, duration)) }];
    }

    // A segment's ground and atmos: { ground, atmos } (each { decision, entry }). They are a function of the first
    // cut's cast inputs (its pins, which also give the segment's pins, seeds, features, look) and the history entries
    // they read, so they are kept on that cut's cast entry (planner/cast) and reused while those are the same.
    // noMedia and the text coverage are part of the memo: they depend on the segment's length and cuts, which the
    // first cut's cast does not fix.
    // Under 「くり返しの行をそろえる」 a segment whose first cut has a source that starts a segment takes that segment's
    // ground and atmosphere (groundCopy, atmosCopy; byHead: the decided segments by their first cut), not memoized: the
    // copy is cheap and follows the source's segment.
    function segmentOf(ctx, seg, first, groundsSoFar, atmosSoFar, noMedia, byHead) {
      const gCopy = byHead ? groundCopy(ctx, seg, first, byHead, noMedia) : null;
      const aCopy = byHead ? atmosCopy(ctx, seg, first, byHead) : null;
      if (gCopy || aCopy) {
        const segSeed = CH.segSeed(ctx.doc.look.seed, first.key, ctx.salts);
        return {
          ground: decideGround(ctx, seg, first, CH.slotSeed(segSeed, first.key, first.line, 'ground', ctx.salts), groundsSoFar,
            noMedia, gCopy),
          atmos: decideAtmos(ctx, seg, first, CH.slotSeed(segSeed, first.key, first.line, 'atmos', ctx.salts), atmosSoFar, aCopy),
        };
      }
      const gRead = groundsSoFar.slice(Math.max(0, groundsSoFar.length - 4));
      const aRead = atmosSoFar.slice(Math.max(0, atmosSoFar.length - 4));
      const memo = first.cast ? first.cast.segment : null;
      if (memo && memo.noMedia === noMedia && memo.coverage === seg.coverage && sameEntries(memo.gRead, gRead) &&
          sameEntries(memo.aRead, aRead)) {
        for (const w of memo.warnings) ctx.warn(w);
        return memo;
      }
      const warnings = [];
      const warn = ctx.warn;
      if (first.cast) ctx.warn = (w) => { warnings.push(w); warn(w); };
      try {
        const segSeed = CH.segSeed(ctx.doc.look.seed, first.key, ctx.salts);
        const ground = decideGround(ctx, seg, first, CH.slotSeed(segSeed, first.key, first.line, 'ground', ctx.salts),
          groundsSoFar, noMedia);
        const atmos = decideAtmos(ctx, seg, first, CH.slotSeed(segSeed, first.key, first.line, 'atmos', ctx.salts),
          atmosSoFar);
        if (first.cast) {
          CA.deepFreeze(ground.decision);
          CA.deepFreeze(atmos.decision);
          first.cast.segment = { gRead, aRead, noMedia, coverage: seg.coverage, warnings, ground, atmos };
        }
        return { ground, atmos };
      } finally {
        ctx.warn = warn;
      }
    }

    // Whether the registry has derived grounds of the user's media (registry.extra[key].media, §11.5.9).
    const mediaGroundCache = new WeakMap();
    function hasMediaGrounds(registry) {
      let hit = mediaGroundCache.get(registry);
      if (hit === undefined) {
        const extra = registry.extra || {};
        hit = (registry.mine ? registry.mine('ground') : []).some((key) => !!(extra[key] && extra[key].media === true));
        mediaGroundCache.set(registry, hit);
      }
      return hit;
    }

    // grounds(ctx, cuts, duration) → Plan.grounds; sets cut.ground (index). A segment spans [t0, t1): t0 = its first
    // cut's a (0 for the first segment), t1 = the next segment's t0 (the duration for the last). A derived media ground
    // is never chosen for a segment shorter than 3 s or for the title card (§11.5.9).
    function grounds(ctx, cuts, duration) {
      if (!cuts.length) return emptyGround(ctx, duration);
      const segs = splitSegments(ctx, cuts);
      const starts = segs.map((seg, k) => (k === 0 ? 0 : N.q6(Math.max(0, cuts[seg.idx[0]].a))));
      const media = hasMediaGrounds(ctx.registry);
      const out = [];
      const groundsSoFar = [], atmosSoFar = [];
      const byHead = ctx.align ? new Map() : null;
      segs.forEach((seg, k) => {
        const first = cuts[seg.idx[0]];
        const t1 = k + 1 < segs.length ? starts[k + 1] : N.q6(Math.max(duration, starts[k]));
        const noMedia = media && (t1 - starts[k] < MEDIA_MIN_SEGMENT || first.role === 'title');
        seg.coverage = PA.textCoverage(seg.idx.map((j) => cuts[j]));
        const { ground, atmos } = segmentOf(ctx, seg, first, groundsSoFar, atmosSoFar, noMedia, byHead);
        if (byHead) byHead.set(first.key, { ground, atmos });
        groundsSoFar.push(ground.entry);
        atmosSoFar.push(atmos.entry);
        for (const j of seg.idx) cuts[j].ground = k;
        out.push({ atmos: atmos.decision, cuts: seg.idx.map((j) => cuts[j].key), fp: '', ground: ground.decision,
          key: 'g' + first.key, t0: starts[k], t1 });
      });
      return out;
    }

    // --- seams ----------------------------------------------------------------------------------------------------

    function isPinned(d) { return !!d && typeof d.from === 'string' && d.from.startsWith('pin'); }

    // A seam that replaces an exit (entrance) turns the other cut's unpinned depart (arrive) into the kind's fallback,
    // from 'rule' (§4.16.6). Its parameters follow the cut's motion speed like any motion's (DESIGN_2_1 §4.3).
    // Under 「くり返しの行をそろえる」 a cut whose source's motion the same rule replaced takes that decision, parameters
    // and all (planner/cast alignedSource; the source comes first, so its seams are decided).
    function replaceMotion(ctx, cut, kind) {
      const old = cut.slots[kind];
      if (isPinned(old)) return;
      const key = ctx.registry.fallback(kind);
      const src = CA.alignedSource(ctx, cut, kind);
      const mine = src ? src.slots[kind] : null;
      const theirs = mine && mine.from === 'rule' && mine.v === key && mine.p ? mine : null;
      const make = () => {
        if (theirs) return withParams({ v: key, from: 'rule' }, { p: theirs.p, pfrom: theirs.pfrom || null });
        const seed = CH.slotSeed(CH.cutSeed(ctx.doc.look.seed, cut.key, cut.line, ctx.salts), cut.key, cut.line, kind,
          ctx.salts);
        const got = PA.resolveParams(ctx.registry.get(kind, key), kind, null, atOf(cut), ctx.ix,
          { registry: ctx.registry, seed, salts: ctx.salts, warn: null, f: cut.feat, look: CA.lookAx(ctx) });
        const scaled = CAM.applySpeed({ ctx, slots: cut.slots }, kind, { v: key, p: got.p, pfrom: got.pfrom || undefined });
        return withParams({ v: key, from: 'rule' }, { p: scaled.p, pfrom: scaled.pfrom || null });
      };
      // The same cast gives the same decision, kept on the cast's cache entry and reused with it across plans (with the
      // source's decision it copied, which the cast does not fix).
      let d;
      if (cut.cast) {
        const rules = cut.cast.rules || (cut.cast.rules = new Map());
        const m = rules.get(kind);
        if (m !== undefined && m.theirs === theirs) d = m.d;
        else { d = CA.deepFreeze(make()); rules.set(kind, { theirs, d }); }
      } else d = make();
      cut.slots[kind] = d;
      const t = ctx.trace;
      if (t && t.cutKey === cut.key && t.slot === kind) t.out.override = { rule: 'seam', decision: d };
    }

    // --- the glyph morph rule (v2.2, DESIGN_2_2 §4, M4) -----------------------------------------------------------

    // Where 「同じ字をつなぐ」 is on, two lines in one background that share a meaningful run of letters and do not overlap
    // in time are joined by the glyph morph: the shared letters travel, the others melt. The rule reads the switch at
    // the boundary (the line pin of B's line only where B is the line's first cut; inside a line, and without a line pin,
    // the work's value), then guards that keep it where it can work, then the letters (planner/morph). Documents without
    // the switch (ctx.glyph.maybeMorph false) never evaluate any of it.

    function morphOn(ctx, A, B) {
      if (A.line !== B.line && B.line && PA.pinned(ctx.ix, MORPH_SLOT)) return RU.valueAt(ctx.doc, ctx.ix, MORPH_SLOT, B.line) === true;
      return ctx.glyph.morph;
    }

    // An arrange whose def.motion is 'own' moves the text itself; an edgeBleed knockout makes the text layer a mask.
    function ownMotion(ctx, c) {
      const d = c.slots.arrange;
      const def = d ? ctx.registry.get('arrange', d.v) : null;
      return !!def && def.motion === 'own';
    }
    function knockout(c) { const d = c.slots.arrange; return !!(d && d.p && d.p.knockout === true); }
    function utaAt(ctx, c) { return !!(ctx.uta && typeof ctx.uta.at === 'function' && ctx.uta.at(c)); }   // 歌ハメ hook

    // A motion the user chose (the rule then keeps away). A lock pin of the kind's fallback is not such a choice: locking
    // freezes the instant entrance and exit a morph gave its lines, and the rule must find the boundary as before the
    // lock (locking never changes a plan); a lock pin of any other motion is (it was no morph when the line was locked).
    function choseMotion(ctx, d, kind) {
      return isPinned(d) && !(d.by === 'lock' && d.v === ctx.registry.fallback(kind));
    }

    // Everything the rule reads except the letters (seamOf memoizes on it).
    function morphGuards(ctx, A, B) {
      if (!ctx.glyph || !ctx.glyph.maybeMorph || !ctx.registry.has('seam', MORPH)) return false;
      if (A.ground !== B.ground) return false;                                   // text seams only
      if (!LYRIC_ROLES.has(A.role) || !LYRIC_ROLES.has(B.role)) return false;
      if (!morphOn(ctx, A, B)) return false;
      if (!(A.t1 <= B.t0)) return false;                                         // the lines do not overlap (A is handed over)
      if (choseMotion(ctx, A.slots.depart, 'depart') || choseMotion(ctx, B.slots.arrive, 'arrive')) return false;
      if (ownMotion(ctx, A) || ownMotion(ctx, B)) return false;
      if (knockout(A) || knockout(B)) return false;
      if (A.kime === true || B.kime === true) return false;                      // キメ cuts (their own hard cut)
      if (utaAt(ctx, A) || utaAt(ctx, B)) return false;                          // letters that appear as sung
      if (ctx.pv && typeof ctx.pv.seamGate === 'function' && ctx.pv.seamGate(B)) return false;   // no room for a transition
      return true;
    }

    function morphRule(ctx, A, B) { return morphGuards(ctx, A, B) && MO.analyze(A.text, B.text).meaningful; }

    // The seam into B → { decision, entry }.
    function decideSeam(ctx, A, B, history) {
      const at = atOf(B);
      const seed = CH.slotSeed(CH.cutSeed(ctx.doc.look.seed, B.key, B.line, ctx.salts), B.key, B.line, 'seam',
        ctx.salts);
      const trace = tracing(ctx, B.key, 'seam');
      const hard = ctx.registry.fallback('seam');
      const world = A.ground !== B.ground;
      const pin = PA.resolvePin(ctx.ix, at, 'seam', CA.acceptPart(ctx, 'seam', null, { checkRole: false }), ctx.warn);
      const rec = recentOf(ctx, 'seam', history);
      // The receiving cut's line conditions (season, avoid list; DESIGN_2_1 §4.9).
      const cond = CA.lineCond(ctx, B.line);
      // A transition does not repeat the one into the previous cut while another candidate weighs > 0 (avoidOf; the
      // runner-up may be the hard cut). Hard cuts repeat freely.
      const req = { kind: 'seam', slot: 'seam', path: 'cut/' + B.key + ':seam', feat: B.feat, chosen: {}, seed,
        scope: world ? 'world' : 'text', recent: rec.recent, ref: rec.ref, echo: null, cutKey: B.key,
        avoid: avoidOf(history, hard), cond };
      let out;
      if (trace) trace.world = world;
      if (pin) {
        CA.pinWarnings(ctx, 'seam', pin.v, pin, cond);
        out = fixed(pinDecision(pin));
        if (trace) shadow(ctx, req, trace, { kind: 'seam', stage: 'pin', pin, recent: rec.recent, echo: null });
      } else if (morphRule(ctx, A, B)) {
        out = fixed({ from: 'rule', v: MORPH });
        if (trace) Object.assign(trace, { kind: 'seam', stage: 'rule', rule: 'morph' });
      } else {
        const chance = world ? WORLD_CHANCE : ctx.look.mood.pace.seam * (0.5 + 0.5 * B.feat.energy);
        if (R.stream(seed, 'chance').next() < chance) {
          if (trace) Object.assign(trace, { kind: 'seam', recent: rec.recent, echo: null, world });
          out = chosen(ctx, req, trace);
        } else {
          out = fixed({ from: 'auto', v: hard });
          if (trace) Object.assign(trace, { kind: 'seam', stage: 'rule', rule: world ? 'world-chance' : 'pace' });
        }
      }
      // The hard cut is not a transition (it is not listed in Plan.seams), so it has no parameters to resolve.
      if (out.decision.v !== hard) {
        out.decision = withParams(out.decision, params(ctx, ctx.registry.get('seam', out.decision.v), 'seam', at, seed, B.feat));
      }
      if (trace) trace.decision = out.decision;
      return out;
    }

    // The seam history's entry for a boundary. A seam frozen by a lock records what the boundary would get without
    // the lock pins, so locking a line never changes the seams after it (§3.6).
    function seamEntry(ctx, A, B, history, got) {
      const d = got.decision;
      if (d.by === 'lock' && isPinned(d)) {
        const free = CA.lockFreeCtx(ctx, B);
        if (free) return decideSeam(free, A, B, history).entry;
      }
      return got.entry;
    }

    // The seam into B with its history entry: { got, entry }. It is a function of B's cast inputs (seed, pins,
    // features, look), whether the background changes and the entries the seam history reads, so it is kept on B's
    // cast entry (planner/cast) and reused while those are the same, its warnings replayed like a cast's.
    // The glyph morph rule (v2.2) also reads A and values that are not B's cast inputs (A's slots and times, the line
    // pin, the texts: a cut's features do not hold its text), so the memo keeps `prev`: null where the rule is never
    // evaluated, '0' where its guards fail (whatever the texts), else '1' with both texts (the rule's result is then a
    // function of the two texts alone).
    function morphPrev(ctx, A, B) {
      if (!ctx.glyph || !ctx.glyph.maybeMorph) return null;
      return morphGuards(ctx, A, B) ? '1\u0001' + A.text + '\u0001' + B.text : '0';
    }

    function seamOf(ctx, A, B, history) {
      const world = A.ground !== B.ground;
      const read = history.slice(Math.max(0, history.length - 4));
      const memo = B.cast ? B.cast.seam : null;
      const prev = morphPrev(ctx, A, B);
      if (memo && memo.world === world && memo.prev === prev && sameEntries(memo.read, read)) {
        for (const w of memo.warnings) ctx.warn(w);
        return memo;
      }
      const warnings = [];
      const warn = ctx.warn;
      if (B.cast) ctx.warn = (w) => { warnings.push(w); warn(w); };
      try {
        const got = decideSeam(ctx, A, B, history);
        const out = { world, read, prev, warnings, got, entry: seamEntry(ctx, A, B, history, got) };
        if (B.cast) B.cast.seam = { world, read, prev, warnings, got: { decision: CA.deepFreeze(got.decision) }, entry: out.entry };
        return out;
      } finally {
        ctx.warn = warn;
      }
    }

    // History entries read alike: recentOf reads their natural and reference picks, avoidOf their winner.
    function sameEntries(a, b) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i] && (a[i].win !== b[i].win || a[i].base !== b[i].base || a[i].ref !== b[i].ref)) return false;
      }
      return true;
    }

    // seams(ctx, cuts) → Plan.seams (only boundaries that are not the hard cut); sets cut.seamIn, applies the
    // replace rules to the neighbouring cuts' motions and ends the cuts before B with the window (endWithSeam).
    // Seam lengths read the windows the cutter gave (A is shortened only after its own seam is decided).
    // Under 「くり返しの行をそろえる」 (DESIGN_2_1 §4.10) the boundary into a cut that takes its decisions from an earlier
    // copy takes the boundary into that copy (seamCopy).
    function seams(ctx, cuts) {
      const out = [];
      const history = [];
      const hard = ctx.registry.fallback('seam');
      cuts.forEach((c) => { c.seamIn = -1; });
      const at = ctx.align ? new Map(cuts.map((c, j) => [c.key, j])) : null;
      let reach = -Infinity;                    // the latest b among the cuts before A
      for (let j = 1; j < cuts.length; j++) {
        const A = cuts[j - 1], B = cuts[j];
        const copy = at ? seamCopy(ctx, cuts, at, out, A, B, hard) : null;
        const { got, entry } = copy || seamOf(ctx, A, B, history);
        history.push(entry);
        const d = got.decision;
        if (d.v !== hard) {
          const def = ctx.registry.get('seam', d.v);
          // a seam's share of the shorter cut (0.4; the glyph morph's own `share`, 0.5)
          const share = def.share > 0 ? def.share : SEAM_SHARE;
          const limit = share * Math.min(A.b - A.a, B.b - B.a);
          let dur = Math.min(typeof d.p.dur === 'number' ? d.p.dur : 0.5, limit);
          if (def.scope === 'world') dur = Math.min(dur, WORLD_MAX);
          // Rounded down to 1e-6 s so the window never exceeds its limit.
          dur = Math.floor(Math.max(0, dur) * 1e6) / 1e6;
          // a seam with `ends` (the glyph morph) ends at B.a, the start of B's window: [B.a − dur, B.a]; others are centred
          const seamAt = def.ends === true ? B.a - dur / 2 : B.a;
          B.seamIn = out.length;
          if (def.glyphs === true) {
            // the letters the two lines share (none when A is not on screen as the window starts: a special cut between)
            const glyphs = A.text && B.text && A.b > seamAt - dur / 2 ? MO.pairsOf(A.text, B.text, d.p ? d.p.melt : undefined) : [];
            out.push({ a: A.key, at: seamAt, b: B.key, dur, glyphs, into: B.key, scope: def.scope, slot: d });
          } else out.push({ a: A.key, at: seamAt, b: B.key, dur, into: B.key, scope: def.scope, slot: d });
          if (def.replaces && def.replaces.depart) replaceMotion(ctx, A, 'depart');
          if (def.replaces && def.replaces.arrive) { replaceMotion(ctx, B, 'arrive'); dropGrowWeight(B); }
          reach = endWithSeam(cuts, j, seamAt + dur / 2, reach, def.glyphs === true);
        }
        reach = Math.max(reach, A.b);
      }
      return out;
    }

    // The seam into B copied from the seam into its source S (planner/cast alignedSource): where S is not the first cut,
    // the background changes at both boundaries or at neither (the same kind of transition fits), and B has no seam pin
    // of its own (the pin wins). → { got, entry } | null. The copy keeps S's parameters; its window is fitted to B's cuts
    // like any seam's.
    function seamCopy(ctx, cuts, at, out, A, B, hard) {
      const src = CA.alignedSource(ctx, B, 'seam');
      const j = src ? at.get(src.key) : undefined;
      if (!j) return null;
      const before = cuts[j - 1];
      if ((A.ground !== B.ground) !== (before.ground !== src.ground)) return null;
      if (PA.pinned(ctx.ix, 'seam') && PA.resolvePin(ctx.ix, atOf(B), 'seam', CA.acceptPart(ctx, 'seam', null, { checkRole: false }), null)) {
        return null;
      }
      // a glyph morph the rule chose at the source is copied only where the rule holds at this boundary too (v2.2):
      // else the boundary takes its own seam (seamOf)
      const srcSlot = src.seamIn >= 0 ? out[src.seamIn].slot : null;
      if (srcSlot && srcSlot.v === MORPH && srcSlot.from === 'rule' && !morphRule(ctx, A, B)) return null;
      const d = src.seamIn >= 0 ? copied(out[src.seamIn].slot) : { from: 'auto', v: hard };
      const t = tracing(ctx, B.key, 'seam');
      if (t) Object.assign(t, { kind: 'seam', stage: 'auto', world: A.ground !== B.ground, why: [alignWhy(src)], decision: d });
      return { got: { decision: d }, entry: entryOf(d, null) };
    }

    // A transition hands the picture over to B: at the end of its window (B.a + dur/2) the seam shows B alone, so
    // nothing before B may be drawn after it (§3.12 b). Each cut before B that reaches past the end gets b = the end —
    // never less than its sung end t1 — so its exit is fitted to finish with the transition instead of reappearing
    // after it (with a replaced exit, at full strength). Usually only A reaches that far; `reach` (the latest b before
    // A) skips the scan otherwise. Returns the new reach.
    // handover (v2.2, a glyph seam): the seam hands A's letters to B, so its own A ends with the window even before its
    // sung end (drawn again after it, A would stand at rest over the new line); the cuts before A keep the rule.
    function endWithSeam(cuts, j, end, reach, handover) {
      const stop = Math.floor(end * 1e6) / 1e6;
      const clip = (c) => { if (c.b > stop) c.b = Math.max(c.t1, stop); };
      const A = cuts[j - 1];
      if (handover) { if (A.b > stop) A.b = stop; } else clip(A);
      if (reach <= stop) return reach;
      let next = -Infinity;
      for (let k = j - 2; k >= 0; k--) { clip(cuts[k]); next = Math.max(next, cuts[k].b); }
      return next;
    }

    // The grow rule's bold end weight (planner/cast growWeight) belongs to 太る: a seam that replaced the entrance takes it
    // away (a pinned 太る is never replaced, and keeps it).
    function dropGrowWeight(c) {
      const tw = c.slots['text.weight'];
      if (tw && tw.from === 'rule' && !(c.slots.arrive && c.slots.arrive.v === GROW_KEY)) delete c.slots['text.weight'];
    }

    // --- impulses -------------------------------------------------------------------------------------------------

    const IMPULSE_ORDER = { flash: 0, shake: 1, slip: 2, punch: 3 };

    function impulses(ctx, cuts, duration) {
      const a = ctx.look.amounts;
      const out = [];
      for (const cut of cuts) {
        if (!cut.impact) continue;
        if (a.flash > 0) out.push({ amp: a.flash, decay: 0.18, kind: 'flash', t: cut.t0 });
        if (a.shake > 0) out.push({ amp: a.shake, decay: 0.4, kind: 'shake', t: cut.t0 });
        if (a.glitch > 0.2) out.push({ amp: a.glitch, decay: 0.25, kind: 'slip', t: cut.t0 });
      }
      const info = ctx.doc.song && ctx.doc.song.info;
      const highlights = info && Array.isArray(info.highlights) ? info.highlights : [];
      if (a.camera > 0) {
        for (const h of highlights) {
          const t = h && typeof h.time === 'number' ? h.time : NaN;
          if (t >= 0 && t <= duration) out.push({ amp: N.q6(0.5 * a.camera), decay: 0.35, kind: 'punch', t: N.q6(t) });
        }
      }
      return out.sort((x, y) => x.t - y.t || IMPULSE_ORDER[x.kind] - IMPULSE_ORDER[y.kind] || x.amp - y.amp);
    }

    return { grounds, seams, impulses, breakScore, splitSegments, morphRule, morphGuards, MORPH };
  });
