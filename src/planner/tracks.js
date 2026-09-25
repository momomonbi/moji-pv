/* 文字PVメーカー v2 — original work. Tracks: background segments, seams (decided after grounds), rule overrides, impulses (DESIGN §4.16.6). */
MV.def('planner/tracks', ['core/rng', 'core/num', 'planner/choose', 'planner/params', 'planner/cast'],
  (R, N, CH, PA, CA) => {
    'use strict';

    const SPECIAL = new Set(['title', 'interlude', 'outro']);
    const WORLD_CHANCE = 0.7;
    const ATMOS_CHANCE = 0.6;
    const SEAM_SHARE = 0.4;         // a seam takes at most 40 % of the shorter of its two cuts
    const WORLD_MAX = 0.8;          // world seams are clamped to 0.8 s (§7.4)
    const GAP_BREAK = 1.5;

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

    function params(ctx, def, slotKind, at, seed, feat, partKind) {
      return PA.resolveParams(def, slotKind, null, at, ctx.ix, {
        registry: ctx.registry, seed, salts: ctx.salts, warn: ctx.warn, f: feat, look: CA.lookAx(ctx),
        partKind: partKind || slotKind,
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
    // cut (or line) applies to exactly the cuts it covers; with neither pinned, breakScore decides.
    function splitSegments(ctx, cuts) {
      const L = Math.round(N.lerp(8, 1, ctx.look.amounts.groundSwitch));
      const segs = [];
      let cur = null;
      cuts.forEach((cut, j) => {
        const pin = groundPin(ctx, cut, ctx.warn);
        const apin = atmosPin(ctx, cut, ctx.warn);
        const gp = pin ? pin.v : null, ap = apin ? apin.v : null;
        const fresh = !cur || gp !== cur.gp || ap !== cur.ap ||
          (gp === null && breakScore(ctx, cuts[j - 1], cut, L) >= 1);
        if (fresh) { cur = { gp, ap, pin, apin, idx: [] }; segs.push(cur); }
        cur.idx.push(j);
      });
      return segs;
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

    function decideGround(ctx, seg, first, seed, history) {
      const trace = tracing(ctx, first.key, 'ground');
      const rec = recentOf(ctx, 'ground', history);
      const req = { kind: 'ground', slot: 'ground', path: 'cut/' + first.key + ':ground', feat: first.feat, chosen: {}, seed,
        recent: rec.recent, ref: rec.ref, echo: null, cutKey: first.key, avoid: avoidOf(history, null) };
      let out;
      if (seg.pin) {
        CA.pinWarnings(ctx, 'ground', seg.pin.v, seg.pin);
        out = fixed(pinDecision(seg.pin));
        if (trace) shadow(ctx, req, trace, { kind: 'ground', stage: 'pin', pin: seg.pin, recent: rec.recent, echo: null });
      } else {
        if (trace) Object.assign(trace, { kind: 'ground', recent: rec.recent, echo: null });
        out = chosen(ctx, req, trace);
      }
      const d = out.decision = withParams(out.decision, params(ctx, ctx.registry.get('ground', out.decision.v), 'ground',
        atOf(first), seed, first.feat));
      if (trace) trace.decision = d;
      return out;
    }

    // atmos: its pin (the segment's, see splitSegments), else with probability 0.6·amount.ornament the chooser over
    // ornaments with scope 'run' (nothing eligible → 'none'), else 'none'.
    function decideAtmos(ctx, seg, first, seed, history) {
      const trace = tracing(ctx, first.key, 'atmos');
      const pin = seg.apin;
      let out;
      if (pin) {
        CA.pinWarnings(ctx, 'ornament', pin.v, pin);
        out = fixed(pinDecision(pin));
        if (trace) Object.assign(trace, { kind: 'ornament', stage: 'pin', pin });
      } else if (R.stream(seed, 'chance').next() < ATMOS_CHANCE * ctx.look.amounts.ornament) {
        const rec = recentOf(ctx, 'ornament', history);
        if (trace) Object.assign(trace, { kind: 'ornament', recent: rec.recent, echo: null });
        out = chosen(ctx, { kind: 'ornament', slot: 'atmos', path: 'cut/' + first.key + ':atmos', feat: first.feat,
          chosen: {}, seed, scope: 'run', recent: rec.recent, ref: rec.ref, echo: null, orNone: true, cutKey: first.key,
          avoid: avoidOf(history, 'none') }, trace);
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
    function segmentOf(ctx, seg, first, groundsSoFar, atmosSoFar) {
      const gRead = groundsSoFar.slice(Math.max(0, groundsSoFar.length - 4));
      const aRead = atmosSoFar.slice(Math.max(0, atmosSoFar.length - 4));
      const memo = first.cast ? first.cast.segment : null;
      if (memo && sameEntries(memo.gRead, gRead) && sameEntries(memo.aRead, aRead)) {
        for (const w of memo.warnings) ctx.warn(w);
        return memo;
      }
      const warnings = [];
      const warn = ctx.warn;
      if (first.cast) ctx.warn = (w) => { warnings.push(w); warn(w); };
      try {
        const segSeed = CH.segSeed(ctx.doc.look.seed, first.key, ctx.salts);
        const ground = decideGround(ctx, seg, first, CH.slotSeed(segSeed, first.key, first.line, 'ground', ctx.salts),
          groundsSoFar);
        const atmos = decideAtmos(ctx, seg, first, CH.slotSeed(segSeed, first.key, first.line, 'atmos', ctx.salts),
          atmosSoFar);
        if (first.cast) {
          CA.deepFreeze(ground.decision);
          CA.deepFreeze(atmos.decision);
          first.cast.segment = { gRead, aRead, warnings, ground, atmos };
        }
        return { ground, atmos };
      } finally {
        ctx.warn = warn;
      }
    }

    // grounds(ctx, cuts, duration) → Plan.grounds; sets cut.ground (index).
    function grounds(ctx, cuts, duration) {
      if (!cuts.length) return emptyGround(ctx, duration);
      const segs = splitSegments(ctx, cuts);
      const out = [];
      const groundsSoFar = [], atmosSoFar = [];
      segs.forEach((seg, k) => {
        const first = cuts[seg.idx[0]];
        const { ground, atmos } = segmentOf(ctx, seg, first, groundsSoFar, atmosSoFar);
        groundsSoFar.push(ground.entry);
        atmosSoFar.push(atmos.entry);
        for (const j of seg.idx) cuts[j].ground = k;
        out.push({ atmos: atmos.decision, cuts: seg.idx.map((j) => cuts[j].key), fp: '', ground: ground.decision,
          key: 'g' + first.key, t0: k === 0 ? 0 : N.q6(Math.max(0, first.a)), t1: 0 });
      });
      out.forEach((g, k) => { g.t1 = k + 1 < out.length ? out[k + 1].t0 : N.q6(Math.max(duration, g.t0)); });
      return out;
    }

    // --- seams ----------------------------------------------------------------------------------------------------

    function isPinned(d) { return !!d && typeof d.from === 'string' && d.from.startsWith('pin'); }

    // A seam that replaces an exit (entrance) turns the other cut's unpinned depart (arrive) into the kind's fallback,
    // from 'rule' (§4.16.6).
    function replaceMotion(ctx, cut, kind) {
      const old = cut.slots[kind];
      if (isPinned(old)) return;
      const make = () => {
        const key = ctx.registry.fallback(kind);
        const seed = CH.slotSeed(CH.cutSeed(ctx.doc.look.seed, cut.key, cut.line, ctx.salts), cut.key, cut.line, kind,
          ctx.salts);
        return withParams({ v: key, from: 'rule' }, PA.resolveParams(ctx.registry.get(kind, key), kind, null, atOf(cut),
          ctx.ix, { registry: ctx.registry, seed, salts: ctx.salts, warn: null, f: cut.feat, look: CA.lookAx(ctx) }));
      };
      // The same cast gives the same decision, kept on the cast's cache entry and reused with it across plans.
      let d;
      if (cut.cast) {
        const rules = cut.cast.rules || (cut.cast.rules = new Map());
        d = rules.get(kind);
        if (d === undefined) { d = CA.deepFreeze(make()); rules.set(kind, d); }
      } else d = make();
      cut.slots[kind] = d;
      const t = ctx.trace;
      if (t && t.cutKey === cut.key && t.slot === kind) t.out.override = { rule: 'seam', decision: d };
    }

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
      // A transition does not repeat the one into the previous cut while another candidate weighs > 0 (avoidOf; the
      // runner-up may be the hard cut). Hard cuts repeat freely.
      const req = { kind: 'seam', slot: 'seam', path: 'cut/' + B.key + ':seam', feat: B.feat, chosen: {}, seed,
        scope: world ? 'world' : 'text', recent: rec.recent, ref: rec.ref, echo: null, cutKey: B.key,
        avoid: avoidOf(history, hard) };
      let out;
      if (trace) trace.world = world;
      if (pin) {
        CA.pinWarnings(ctx, 'seam', pin.v, pin);
        out = fixed(pinDecision(pin));
        if (trace) shadow(ctx, req, trace, { kind: 'seam', stage: 'pin', pin, recent: rec.recent, echo: null });
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
    function seamOf(ctx, A, B, history) {
      const world = A.ground !== B.ground;
      const read = history.slice(Math.max(0, history.length - 4));
      const memo = B.cast ? B.cast.seam : null;
      if (memo && memo.world === world && sameEntries(memo.read, read)) {
        for (const w of memo.warnings) ctx.warn(w);
        return memo;
      }
      const warnings = [];
      const warn = ctx.warn;
      if (B.cast) ctx.warn = (w) => { warnings.push(w); warn(w); };
      try {
        const got = decideSeam(ctx, A, B, history);
        const out = { world, read, warnings, got, entry: seamEntry(ctx, A, B, history, got) };
        if (B.cast) B.cast.seam = { world, read, warnings, got: { decision: CA.deepFreeze(got.decision) }, entry: out.entry };
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
    function seams(ctx, cuts) {
      const out = [];
      const history = [];
      const hard = ctx.registry.fallback('seam');
      cuts.forEach((c) => { c.seamIn = -1; });
      let reach = -Infinity;                    // the latest b among the cuts before A
      for (let j = 1; j < cuts.length; j++) {
        const A = cuts[j - 1], B = cuts[j];
        const { got, entry } = seamOf(ctx, A, B, history);
        history.push(entry);
        const d = got.decision;
        if (d.v !== hard) {
          const def = ctx.registry.get('seam', d.v);
          const limit = SEAM_SHARE * Math.min(A.b - A.a, B.b - B.a);
          let dur = Math.min(typeof d.p.dur === 'number' ? d.p.dur : 0.5, limit);
          if (def.scope === 'world') dur = Math.min(dur, WORLD_MAX);
          // Rounded down to 1e-6 s so the window never exceeds its limit.
          dur = Math.floor(Math.max(0, dur) * 1e6) / 1e6;
          B.seamIn = out.length;
          out.push({ a: A.key, at: B.a, b: B.key, dur, into: B.key, scope: def.scope, slot: d });
          if (def.replaces && def.replaces.depart) replaceMotion(ctx, A, 'depart');
          if (def.replaces && def.replaces.arrive) replaceMotion(ctx, B, 'arrive');
          reach = endWithSeam(cuts, j, B.a + dur / 2, reach);
        }
        reach = Math.max(reach, A.b);
      }
      return out;
    }

    // A transition hands the picture over to B: at the end of its window (B.a + dur/2) the seam shows B alone, so
    // nothing before B may be drawn after it (§3.12 b). Each cut before B that reaches past the end gets b = the end —
    // never less than its sung end t1 — so its exit is fitted to finish with the transition instead of reappearing
    // after it (with a replaced exit, at full strength). Usually only A reaches that far; `reach` (the latest b before
    // A) skips the scan otherwise. Returns the new reach.
    function endWithSeam(cuts, j, end, reach) {
      const stop = Math.floor(end * 1e6) / 1e6;
      const clip = (c) => { if (c.b > stop) c.b = Math.max(c.t1, stop); };
      clip(cuts[j - 1]);
      if (reach <= stop) return reach;
      let next = -Infinity;
      for (let k = j - 2; k >= 0; k--) { clip(cuts[k]); next = Math.max(next, cuts[k].b); }
      return next;
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

    return { grounds, seams, impulses, breakScore, splitSegments };
  });
