/* 文字PVメーカー v2 — original work. Automatic camerawork: motion speed, the shot of each cut, carry between phrases and section rigs (DESIGN_2_1 §3.9, §4.3, §4.5.7, §4.6, §4.7). */
MV.def('planner/camera', ['core/hash', 'core/num', 'core/rng', 'core/schema', 'core/shot', 'planner/choose', 'planner/params'],
  (H, N, R, S, SHOT, CH, PA) => {
    'use strict';

    // Specs of the v2.1 cut slots (§2.3); planner/cast merges them into its SLOT_SPECS, planner/fields shows them.
    const SLOT_SPECS = Object.freeze({
      'motion.speed': { type: 'num', min: 0.25, max: 4, step: 0.05, unit: 'x' },
      'cam.shot': { type: 'shot' },
      'cam.zoom': { type: 'num', min: 0.5, max: 2, step: 0.01, unit: 'x' },
      'cam.curve': { type: 'curve' },
      'cam.follow': { type: 'num', min: 0, max: 1, step: 0.01 },
      rig: { type: 'rig' },
      'rig.curve': { type: 'curve' },
    });
    const CAM_SLOTS = Object.freeze(['cam.shot', 'cam.zoom', 'cam.curve', 'cam.follow']);

    // --- §4.7 constants (FROZEN formulas; the lead may tune them after visual QA, §7.5 step (b)) --------------------
    const NONE = 'none';
    const SHOT_POOL = Object.freeze(SHOT.SHOT_KEYS.concat([NONE]).sort());
    const AMOUNT_OFF = 0.1;                         // A below this: no automatic shot
    const SHORT_CUT = 0.8;                          // seconds
    const SHORT_POOL = Object.freeze(['none', 'settle']);
    const ROLE_POOLS = Object.freeze({
      title: Object.freeze(['pullReveal', 'settle', 'wideHold']),
      interlude: Object.freeze(['driftOff', 'none', 'wideHold']),
      outro: Object.freeze(['none', 'pullReveal', 'wideHold']),
    });
    const GENTLE_POOL = Object.freeze(['driftOff', 'settle', 'tiltHold', 'wideHold']);
    // × section (verse or no section share a row).
    const SHOT_SECTION = Object.freeze({
      chorus: Object.freeze({ pushWord: 1.5, snapZoom: 1.5, sweepAcross: 1.5, none: 0.6 }),
      verse: Object.freeze({ settle: 1.3, driftOff: 1.3, none: 1.3 }),
      bridge: Object.freeze({ tiltHold: 1.5, wideHold: 1.5 }),
      intro: Object.freeze({ pullReveal: 1.5, wideHold: 1.5 }),
      outro: Object.freeze({ pullReveal: 1.5, wideHold: 1.5 }),
    });
    const SHOT_RECENT = 0.1, SHOT_NEAR = 0.4, SHOT_ECHO = 3;
    const RIG_OFF = 0.15;                           // A below this: no automatic rig
    const RIG_WEIGHTS = Object.freeze({
      chorus: Object.freeze({ slowSwell: 3, climbRise: 2, leanTilt: 0.5, none: 1 }),
      prechorus: Object.freeze({ climbRise: 3, slowSwell: 1 }),
      verse: Object.freeze({ driftSide: 2, slowSwell: 1, none: 2 }),
      bridge: Object.freeze({ leanTilt: 2, driftSide: 1, none: 1 }),
      intro: Object.freeze({ slowSwell: 2, none: 1 }),
      outro: Object.freeze({ pullAway: 4, none: 1 }),
      interlude: Object.freeze({ driftSide: 2, none: 1 }),
      other: Object.freeze({ slowSwell: 1, climbRise: 1 }),
    });
    const LAST_CHORUS_AMP = 1.25, AMP_MAX = 1.3;
    const SPECIAL = new Set(['title', 'interlude', 'outro']);

    function q2(x) { return Math.round(x * 100) / 100; }

    function tracing(ctx, cutKey, slot) {
      const t = ctx.trace;
      if (!t || t.cutKey !== cutKey || t.slot !== slot) return null;
      t.hit = true;
      return t.out;
    }

    function seedOf(st, slot) { return CH.slotSeedAt(st.slotPrefix, st.cut.key, st.cut.line, slot, st.ctx.salts); }

    function setDecision(st, slot, d) {
      st.slots[slot] = d;
      st.chosen[slot] = d.v;
    }

    const acceptShot = PA.acceptSpec(SLOT_SPECS['cam.shot']);
    const acceptRig = PA.acceptSpec(SLOT_SPECS.rig);

    // --- motion speed (§4.3) -------------------------------------------------------------------------------------

    // decideSpeed(st): the motion.speed slot of a cut; a pin coerced through its spec, else 1.
    function decideSpeed(st) {
      return st.decide(st, 'motion.speed', SLOT_SPECS['motion.speed'], () => ({ v: 1, from: 'auto' }));
    }

    const SPEED_PARAMS = Object.freeze({ arrive: ['dur', 'each'], depart: ['dur', 'each'], dwell: ['speed'] });

    // applySpeed(st, kind, d): right after the parameters of arrive, dwell and depart are resolved. Unpinned durations
    // and staggers are divided by the cut's motion speed and an unpinned hold speed is multiplied by it, each coerced
    // through the part's own spec, with pfrom 'rule'. Nothing happens at speed 1. st needs { ctx: { registry }, slots };
    // d.p must still be writable (the decision is frozen later).
    function applySpeed(st, kind, d) {
      const s = st.slots['motion.speed'];
      const speed = s && typeof s.v === 'number' ? s.v : 1;
      const names = SPEED_PARAMS[kind];
      if (speed === 1 || !names || !d || !d.p || d.v === NONE) return d;
      const list = st.ctx.registry.params(kind, d.v) || [];
      let pfrom = null;
      for (const name of names) {
        const x = d.p[name];
        if (typeof x !== 'number' || (d.pfrom && d.pfrom[name])) continue;
        const item = list.find((e) => e.name === name);
        if (!item) continue;
        const c = S.coerce(item.spec, kind === 'dwell' ? x * speed : x / speed);
        if (c === undefined) continue;
        d.p[name] = c;
        (pfrom || (pfrom = Object.assign({}, d.pfrom || {})))[name] = 'rule';
      }
      if (pfrom) d.pfrom = sortedCopy(pfrom);
      return d;
    }

    function sortedCopy(o) {
      const out = {};
      for (const k of Object.keys(o).sort()) out[k] = o[k];
      return out;
    }

    // --- shots (§4.7) --------------------------------------------------------------------------------------------

    // Pools are bit sets over SHOT_POOL (10 keys).
    const bitsOf = (keys) => keys.reduce((m, key) => m | (1 << SHOT_POOL.indexOf(key)), 0);
    const ALL_BITS = bitsOf(SHOT_POOL), SHORT_BITS = bitsOf(SHORT_POOL), GENTLE_BITS = bitsOf(GENTLE_POOL);
    const ROLE_BITS = Object.freeze(Object.fromEntries(Object.keys(ROLE_POOLS).map((role) => [role, bitsOf(ROLE_POOLS[role])])));

    // The pool of a cut after the rules and what limited it: { bits, gentle, arrange } or a forced value
    // { forced: { v, from, rule }, mask, arrange }. rulesWhy and maskOf give explain's view of them.
    function shotRules(st) {
      const { ctx, cut } = st;
      const A = ctx.look.amounts.camera;
      const arrange = st.chosen.arrange ? ctx.registry.get('arrange', st.chosen.arrange) : null;
      const cam = arrange && arrange.cam ? arrange.cam : 'any';
      if (!(A >= AMOUNT_OFF)) return { forced: { v: NONE, from: 'auto', rule: 'none-camera' }, mask: 'gate', arrange };
      if (cam === 'none') return { forced: { v: NONE, from: 'rule', rule: 'arrange' }, mask: 'trait', arrange };
      let bits = ALL_BITS;
      if (cut.feat.dur < SHORT_CUT) bits &= SHORT_BITS;
      if (ROLE_BITS[cut.role] !== undefined) bits &= ROLE_BITS[cut.role];
      if (cam === 'gentle') bits &= GENTLE_BITS;
      return { bits, gentle: cam === 'gentle', arrange };
    }

    // The reasons of the rules (explain), in their order: forced values, then each pool that limited the cut.
    function rulesWhy(st, rules) {
      const A = st.ctx.look.amounts.camera;
      if (rules.forced) {
        return rules.forced.rule === 'none-camera'
          ? [{ code: 'rule', params: { rule: 'none-camera' } }, { code: 'cam.amount', params: { x: A } }]
          : [{ code: 'cam.arrange', params: { key: rules.arrange.key } }];
      }
      const why = [];
      if (st.cut.feat.dur < SHORT_CUT) why.push({ code: 'cam.short', params: {} });
      if (ROLE_BITS[st.cut.role] !== undefined) why.push({ code: 'rule', params: { rule: 'role' } });
      if (rules.gentle) why.push({ code: 'cam.arrange', params: { key: rules.arrange.key } });
      return why;
    }

    // Explain's mask of a shot key the rules left out: the first rule (in order) that removed it.
    function maskOf(st, rules, i) {
      const bit = 1 << i;
      if (st.cut.feat.dur < SHORT_CUT && !(SHORT_BITS & bit)) return 'trait';
      if (ROLE_BITS[st.cut.role] !== undefined && !(ROLE_BITS[st.cut.role] & bit)) return 'role';
      return rules.gentle && !(GENTLE_BITS & bit) ? 'trait' : null;
    }

    // The §4.7 base weight of one shot key (before mood, section, recency and echo).
    function baseWeight(key, f, A, orient, frames) {
      switch (key) {
        case 'none': return 3 * (1 - A) * (1 - A) + (frames ? 4 : 0);
        case 'settle': return 1.2;
        case 'pushWord': return (f.emph ? 3 : f.words >= 2 ? 0.8 : 0.2) * (0.6 + f.energy);
        case 'readAlong': return (f.words >= 3 && f.dur >= 2.2 ? 1.6 : 0) * (orient === 'v' ? 0.7 : 1);
        case 'snapZoom': return f.impact ? 5 : (f.energy >= 0.75 && f.onBeat ? 0.5 : 0);
        case 'pullReveal': return f.sectionStart ? 2 : 0.4;
        case 'sweepAcross': return f.words >= 2 && f.cells >= 8 && orient === 'h' ? 0.9 : 0;
        case 'tiltHold': return 0.6 * (f.energy >= 0.4 ? 1 : 0.3);
        case 'driftOff': return f.cells <= 10 ? 0.7 : 0.2;
        case 'wideHold': return f.dur >= 3 && f.energy < 0.45 ? 1 : 0.1;
        default: return 0;
      }
    }

    // The reasons behind one key's base weight (explain): the feature that raised it.
    function baseWhy(key, f, A, orient, lensKey, frames) {
      switch (key) {
        case 'none': return (frames ? [{ code: 'cam.lens', params: { key: lensKey } }] : []).concat([{ code: 'cam.amount', params: { x: A } }]);
        case 'pushWord': return f.emph ? [{ code: 'cam.emph', params: {} }] : f.words >= 2 ? [{ code: 'cam.words', params: { n: f.words } }] : [];
        case 'readAlong': return f.words >= 3 && f.dur >= 2.2 ? [{ code: 'cam.words', params: { n: f.words } }] : [];
        case 'snapZoom': return f.impact ? [{ code: 'cam.impact', params: {} }] : [];
        case 'pullReveal': return f.sectionStart ? [{ code: 'cam.sectionStart', params: {} }] : [];
        case 'sweepAcross': return f.words >= 2 && f.cells >= 8 && orient === 'h' ? [{ code: 'cam.words', params: { n: f.words } }] : [];
        case 'wideHold': return f.dur >= 3 && f.energy < 0.45 ? [{ code: 'cam.long', params: {} }] : [];
        default: return [];
      }
    }

    // The mood factor of every shot key (moodBias of the preset's tags; 1 for none), made once per plan.
    function moodFactors(ctx) {
      let m = ctx.shotMood;
      if (!m) {
        m = new Float64Array(SHOT_POOL.length);
        SHOT_POOL.forEach((key, i) => { m[i] = key === NONE ? 1 : CH.moodBias(SHOT.SHOTS[key].tags, ctx.look.mood); });
        ctx.shotMood = m;
      }
      return m;
    }

    // The mood factor of a shot preset and its strongest tag (explain).
    function moodWhy(tags, mood) {
      let best = null, bestAbs = 0;
      for (const tag of tags || []) {
        const b = mood && mood.tagBias && typeof mood.tagBias[tag] === 'number' ? mood.tagBias[tag] : 1;
        const a = Math.abs(Math.log(Math.max(b, 1e-6)));
        if (a > bestAbs) { best = { code: 'mood.tag', params: { mood: mood.key, tag, x: q2(b) } }; bestAbs = a; }
      }
      return best;
    }

    // weighShots(st, rules, rec, withWhy) → [{ key, w, wBase, why }] over the whole shot pool in sorted order (w = 0
    // outside the rules' pool). w is q6 of every factor; wBase leaves out the recency factors (the cut's natural pick).
    // rec = { prev, near, echo } (keys or null / arrays). why is null unless withWhy.
    function weighShots(st, rules, rec, withWhy) {
      const { ctx, cut } = st;
      const f = cut.feat;
      const A = ctx.look.amounts.camera;
      const mood = ctx.look.mood;
      const orient = st.chosen.orient;
      const lensKey = st.chosen.lens && st.chosen.lens !== NONE ? st.chosen.lens : null;
      const lens = lensKey ? ctx.registry.get('lens', lensKey) : null;
      const frames = !!(lens && lens.frames === true);
      const bySection = SHOT_SECTION[f.section === null || f.section === undefined ? 'verse' : f.section] || null;
      const moods = moodFactors(ctx);
      const out = new Array(SHOT_POOL.length);
      for (let i = 0; i < SHOT_POOL.length; i++) {
        const key = SHOT_POOL[i];
        if (!(rules.bits & (1 << i))) { out[i] = { key, w: 0, wBase: 0, why: withWhy ? [] : null }; continue; }
        const m = moods[i];
        const sec = bySection && bySection[key] ? bySection[key] : 1;
        const echo = rec.echo === key;
        // Left to right, like the factors are listed in §4.7 (the product is rounded once, by q6).
        const w = baseWeight(key, f, A, orient, frames) * m * sec * (echo ? SHOT_ECHO : 1);
        const wBase = N.q6(w);
        let wr = w;
        if (rec.prev === key) wr *= SHOT_RECENT;
        if (rec.near.includes(key)) wr *= SHOT_NEAR;
        let why = null;
        if (withWhy) {
          why = baseWhy(key, f, A, orient, lensKey, frames);
          if (m !== 1) { const t = moodWhy(SHOT.SHOTS[key].tags, mood); if (t) why.push(t); }
          if (sec !== 1 && f.section) why.push({ code: 'cam.section', params: { section: f.section } });
          if (echo) why.push({ code: 'echo', params: { cut: f.repeatOf } });
          if (rec.prev && rec.prev !== key) why.push({ code: 'recent', params: { key: rec.prev } });
        }
        out[i] = { key, w: wr === w ? wBase : N.q6(wr), wBase, why };
      }
      return out;
    }

    // The recency and echo a cut's shot reads (§4.7): the previous cut's final shot (×0.1), the natural shots of the
    // 3 cuts before it (×0.4) and the natural shot of the cut it echoes (×3). The natural pass (st.natural) weighs
    // without recency, like the part slots.
    function recencyOf(st) {
      const hist = st.hist;
      const echo = hist.echo(st.cut.feat.repeatOf, 'cam.shot');
      if (st.natural) return { prev: null, near: EMPTY, echo };
      return { prev: hist.previous('cam.shot'), near: hist.recent('cam.shot', 'cam.shot', null).near, echo };
    }
    const EMPTY = Object.freeze([]);

    // shotWeights(st) → [{ key, w, why }] for the cut in st (tests and tools; the planner picks from the same numbers).
    function shotWeights(st) {
      const rules = shotRules(st);
      const poolWhy = rulesWhy(st, rules);
      if (rules.forced) {
        return SHOT_POOL.map((key) => ({ key, w: 0, why: key === rules.forced.v ? poolWhy.slice() : [] }));
      }
      const list = weighShots(st, rules, recencyOf(st), true);
      return list.map((c) => ({ key: c.key, w: c.w, why: poolWhy.concat(c.why) }));
    }

    // The automatic shot: { v, from, base, gentle, rule?, why?, candidates?, recent? }. Gumbel-max over q6 weights keyed
    // by shot key (ties → the smaller key, keys sorted); base = the same argmax without the recency factors. why,
    // candidates and recent (explain) only with withWhy.
    function autoShot(st, withWhy) {
      const rules = shotRules(st);
      if (rules.forced) {
        const out = { v: rules.forced.v, from: rules.forced.from, rule: rules.forced.rule, base: rules.forced.v, gentle: false };
        if (withWhy) {
          out.why = rulesWhy(st, rules);
          out.candidates = SHOT_POOL.map((key) => ({ key, w: 0, masked: key === rules.forced.v ? null : rules.mask }));
        }
        return out;
      }
      const rec = recencyOf(st);
      const list = weighShots(st, rules, rec, withWhy);
      const prefix = CH.gumbelPrefix(seedOf(st, 'cam.shot'));
      let best = null, bestScore = -Infinity, base = null, baseScore = -Infinity;
      for (const c of list) {
        if (!(c.w > 0) && !(c.wBase > 0)) continue;
        const noise = CH.gumbelAt(prefix, c.key);
        if (c.w > 0) { const s = Math.log(c.w) + noise; if (s > bestScore) { best = c.key; bestScore = s; } }
        if (c.wBase > 0) { const s = Math.log(c.wBase) + noise; if (s > baseScore) { base = c.key; baseScore = s; } }
      }
      const v = best === null ? NONE : best;
      const out = { v, from: 'auto', base: base === null ? v : base, gentle: rules.gentle };
      if (withWhy) {
        const own = list[SHOT_POOL.indexOf(v)];
        out.why = rulesWhy(st, rules).concat(own.why);
        if (!out.why.length) out.why.push({ code: 'cam.amount', params: { x: st.ctx.look.amounts.camera } });
        out.candidates = list.map((c, i) => ({ key: c.key, w: c.w, masked: maskOf(st, rules, i) }));
        out.recent = rec;
      }
      return out;
    }

    function decideShot(st) {
      const { ctx, at } = st;
      const slot = 'cam.shot';
      const trace = tracing(ctx, st.cut.key, slot);
      const pin = PA.pinned(ctx.ix, slot) ? PA.resolvePin(ctx.ix, at, slot, acceptShot, ctx.warn) : null;
      let d, gentle = false;
      if (pin) {
        d = { v: pin.v, from: pin.from, by: pin.by };
        if (trace) {
          const shadow = autoShot(st, true);
          Object.assign(trace, { kind: 'cam.shot', stage: 'pin', pin, candidates: shadow.candidates });
        }
        gentle = gentleArrange(st);
      } else {
        const got = autoShot(st, !!trace);
        d = { v: got.v, from: got.from };
        gentle = !!got.gentle;
        if (got.base !== got.v) st.base[slot] = got.base;
        if (trace) {
          Object.assign(trace, { kind: 'cam.shot', stage: got.from === 'rule' ? 'rule' : 'auto', rule: got.rule || null,
            why: got.why, candidates: got.candidates, recent: got.recent || null });
        }
      }
      if (trace) trace.decision = d;
      setDecision(st, slot, d);
      return gentle;
    }

    function gentleArrange(st) {
      const arrange = st.chosen.arrange ? st.ctx.registry.get('arrange', st.chosen.arrange) : null;
      return !!arrange && arrange.cam === 'gentle';
    }

    // decideCamera(st): cam.shot → cam.zoom → cam.curve → cam.follow (§4.7), each with its own slot seed. The natural
    // pass (neighbours' view) needs only the shot.
    function decideCamera(st) {
      const gentle = decideShot(st);
      if (st.natural) return;
      const { ctx, cut } = st;
      const f = cut.feat;
      const A = ctx.look.amounts.camera;
      const shot = st.chosen['cam.shot'];
      st.decide(st, 'cam.zoom', SLOT_SPECS['cam.zoom'], (seed, withWhy) => {
        let z = q2(N.lerp(0.85, 1.2, N.clamp(0.5 * A + 0.5 * f.energy)) * (f.impact ? 1.1 : 1));
        let capped = false;
        if (gentle) {
          const fill = SHOT.maxFill(shot);
          if (fill > 0 && 0.7 / fill < z) { z = 0.7 / fill; capped = true; }
        }
        const d = { v: S.coerce(SLOT_SPECS['cam.zoom'], z), from: 'auto' };
        if (withWhy) {
          d.why = [{ code: 'cam.amount', params: { x: A } }];
          if (f.impact) d.why.push({ code: 'cam.impact', params: {} });
          if (capped) d.why.push({ code: 'rule', params: { rule: 'gentle' } });
        }
        return d;
      });
      st.decide(st, 'cam.curve', SLOT_SPECS['cam.curve'], (seed, withWhy) => {
        const bias = ctx.look.mood && ctx.look.mood.tagBias ? ctx.look.mood.tagBias.fast : undefined;
        let v;
        if (f.impact) v = R.fromSeed(seed).weighted(['dashStop', 'holdThenDash'], [3, 2]);
        else if (f.energy >= 0.65 || (typeof bias === 'number' && bias > 1.2)) {
          v = R.fromSeed(seed).weighted(['hushRushHush', 'holdThenDash', 'softEnds'], [3, 2, 1]);
        } else v = R.fromSeed(seed).weighted(['softEnds', 'fadeBrake', 'slowBloom'], [3, 2, 1]);
        return withWhy && f.impact ? { v, from: 'auto', why: [{ code: 'cam.impact', params: {} }] } : { v, from: 'auto' };
      });
      st.decide(st, 'cam.follow', SLOT_SPECS['cam.follow'], () => {
        let x;
        if (shot === NONE || shot === 'wideHold') x = 0;
        else {
          const own = typeof shot === 'string' ? SHOT.SHOTS[shot] && SHOT.SHOTS[shot].follow : shot && shot.follow;
          if (typeof own === 'number' && own > 0) x = own;
          else {
            const arrive = st.chosen.arrive ? ctx.registry.get('arrive', st.chosen.arrive) : null;
            const fast = !!(arrive && Array.isArray(arrive.tags) && arrive.tags.includes('fast'));
            x = q2(N.clamp(0.1 + 0.4 * ctx.look.amounts.motion + (fast ? 0.1 : 0)));
          }
        }
        return { v: S.coerce(SLOT_SPECS['cam.follow'], x), from: 'auto' };
      });
    }

    // --- carry (§4.5.7; stage 6, after the seams) ------------------------------------------------------------------

    // Whether a shot starts by framing the text at the cut's start (the key expandShot's carry replaces).
    function opensOnText(v) {
      const shot = typeof v === 'string' ? SHOT.SHOTS[v] : null;
      if (!shot) return false;
      const k0 = shot.keys[0];
      return k0.at === 'a' && k0.aim !== 'frame' && k0.aim !== 'point';
    }

    // carry(ctx, cuts, seams = ctx.seams): consecutive cuts A → B of the same line, both with a shot, B's shot a preset
    // (not a custom object), across a hard cut or a text transition: B's cam.shot becomes a new frozen decision with
    // p.carry = SHOT.lastFraming(A's shot, { zoom: A's cam.zoom }) and pfrom.carry 'rule', so B opens at A's closeness,
    // screen position and roll (a match cut). Skipped when there is nothing to carry (A ends on the frame) or nothing
    // to carry it into (B opens on the frame). The decision is kept on B's cast entry while its inputs are the same.
    function carry(ctx, cuts, seams) {
      const list = seams || ctx.seams || [];
      for (let j = 1; j < cuts.length; j++) {
        const A = cuts[j - 1], B = cuts[j];
        if (!A.line || A.line !== B.line) continue;
        const a = A.slots['cam.shot'], b = B.slots['cam.shot'];
        if (!a || !b || a.v === NONE || typeof b.v !== 'string' || b.v === NONE || !opensOnText(b.v)) continue;
        if (B.seamIn >= 0 && list[B.seamIn] && list[B.seamIn].scope !== 'text') continue;
        const zoom = A.slots['cam.zoom'] ? A.slots['cam.zoom'].v : 1;
        const framing = SHOT.lastFraming(a.v, { zoom });
        if (!framing) continue;
        const text = JSON.stringify(framing);
        const memo = B.cast ? B.cast.carry : null;
        let d;
        if (memo && memo.base === b && memo.text === text) d = memo.d;
        else {
          d = {};
          if (b.by !== undefined) d.by = b.by;
          d.from = b.from;
          d.p = { carry: framing };
          d.pfrom = { carry: 'rule' };
          d.v = b.v;
          d = deepFreeze(d);
          if (B.cast) B.cast.carry = { base: b, text, d };
        }
        B.slots['cam.shot'] = d;
        const t = tracing(ctx, B.key, 'cam.shot');
        if (t) t.override = { rule: 'carry', decision: d };
      }
    }

    function deepFreeze(v) {
      if (v && typeof v === 'object' && !Object.isFrozen(v)) {
        Object.freeze(v);
        for (const k of Object.keys(v)) deepFreeze(v[k]);
      }
      return v;
    }

    // --- rigs (§4.6, §4.7; stage 6, after the seams) ---------------------------------------------------------------

    function atOf(cut) { return { cutKey: cut.key, pinCutKey: cut.pinKey, lineId: cut.line }; }

    // The weight row of a run (§4.7 table): its first cut's section (none → the verse row). A special cut is a run of
    // its own and reads its role's row — title → the intro row, interlude and outro their own — unless its section is
    // one of those instructional sections itself (an intro cut inside the song's intro section reads intro).
    const ROLE_ROWS = Object.freeze({ title: 'intro', interlude: 'interlude', outro: 'outro' });
    const EDGE_SECTIONS = new Set(['intro', 'interlude', 'outro']);
    function rigRow(first) {
      const s = first.feat.section;
      if (first.role === 'title') return { row: 'intro', why: { code: 'rule', params: { rule: 'role' } } };
      if (ROLE_ROWS[first.role]) {
        const row = s && EDGE_SECTIONS.has(s) ? s : ROLE_ROWS[first.role];
        return { row, why: { code: 'rig.section', params: { section: row } } };
      }
      if (s) return { row: RIG_WEIGHTS[s] ? s : 'other', why: { code: 'rig.section', params: { section: s } } };
      return { row: 'verse', why: null };
    }

    // The last chorus run: the last run of lyric cuts whose section is chorus.
    function lastChorusOf(cuts, runs) {
      let last = -1;
      runs.forEach((run, r) => {
        const first = cuts[run.idx[0]];
        if (first.feat.section === 'chorus' && !SPECIAL.has(first.role)) last = r;
      });
      return last;
    }

    // The resolved rig pin of a cut (cut > line > work), or null.
    function rigPin(ctx, cut) {
      return PA.pinned(ctx.ix, 'rig') ? PA.resolvePin(ctx.ix, atOf(cut), 'rig', acceptRig, ctx.warn) : null;
    }

    // Runs of consecutive cuts: a new run where the section changes (null counts as its own value), around every title,
    // interlude and outro cut, and where the resolved rig pin changes (compared by canonical JSON).
    function splitRuns(ctx, cuts) {
      const runs = [];
      let cur = null, prevText = null;
      cuts.forEach((cut, j) => {
        const pin = rigPin(ctx, cut);
        const text = pin ? JSON.stringify(pin.v) : null;
        const prev = j ? cuts[j - 1] : null;
        const fresh = !cur || prev.feat.section !== cut.feat.section || SPECIAL.has(prev.role) || SPECIAL.has(cut.role) ||
          text !== prevText;
        if (fresh) { cur = { idx: [], pin }; runs.push(cur); }
        cur.idx.push(j);
        prevText = text;
      });
      return runs;
    }

    // The automatic rig of a run: Gumbel-max over the row's weights × moodBias(tags), keyed by rig key (sorted, ties →
    // the smaller key), avoiding the previous run's winner while another candidate weighs > 0 ('none' is exempt).
    // → { v, win, why, candidates }.
    function autoRig(ctx, row, seed, avoid, withWhy) {
      const weights = RIG_WEIGHTS[row.row];
      const mood = ctx.look.mood;
      const keys = SHOT.RIG_KEYS.concat([NONE]).sort();
      const prefix = CH.gumbelPrefix(seed);
      let best = null, bestScore = -Infinity, next = null, nextScore = -Infinity;
      const candidates = [];
      for (const key of keys) {
        const base = weights[key] || 0;
        const w = N.q6(key === NONE ? base : base * CH.moodBias(SHOT.RIGS[key].tags, mood));
        candidates.push({ key, w, masked: null });
        if (!(w > 0)) continue;
        const s = Math.log(w) + CH.gumbelAt(prefix, key);
        if (s > bestScore) { next = best; nextScore = bestScore; best = key; bestScore = s; }
        else if (s > nextScore) { next = key; nextScore = s; }
      }
      const win = best === null ? NONE : best;
      const v = avoid && win === avoid && next !== null ? next : win;
      const out = { v, win, candidates };
      if (withWhy) {
        out.why = row.why ? [row.why] : [];
        if (v !== NONE) { const t = moodWhy(SHOT.RIGS[v].tags, mood); if (t) out.why.push(t); }
        if (v !== win) out.why.push({ code: 'recent', params: { key: win } });
      }
      return out;
    }

    function withAmp(d, amp) {
      const out = {};
      if (d.by !== undefined) out.by = d.by;
      out.from = d.from;
      if (d.v !== NONE) out.p = { amp };
      out.v = d.v;
      return out;
    }

    // rigs(ctx, cuts, seams, duration) → Plan.rigs; sets cut.rig (the run index). A run's rig and rig.curve come from
    // its first cut (pins cut > line > work; seed hash32('rig', look.seed, first cut key, its cut salt)); amp =
    // q2(0.4 + 0.6·A); the last chorus run gets amp ×1.25 (≤ 1.3) and, unless rig.curve is pinned, the curve slowBloom;
    // other runs take the preset's own curve ('linear' for none and custom rigs). blend = the window of a transition
    // (not the hard cut) into the run's first cut, else null. t0 = the first cut's a (0 for the first run), t1 = the
    // next run's t0 (the duration for the last).
    function rigs(ctx, cuts, seams, duration) {
      const A = ctx.look.amounts.camera;
      if (!cuts.length) {
        return [{ blend: null, cuts: [], curve: { from: 'auto', v: 'linear' }, key: 'k', rig: { from: 'auto', v: NONE }, t0: 0,
          t1: N.q6(Math.max(0, duration)) }];
      }
      const runs = splitRuns(ctx, cuts);
      const lastChorus = lastChorusOf(cuts, runs);
      const out = [];
      let avoid = null;
      runs.forEach((run, r) => {
        const first = cuts[run.idx[0]];
        const row = rigRow(first);
        const trace = tracing(ctx, first.key, 'rig');
        const seed = H.hash32('rig', ctx.doc.look.seed, first.key, CH.saltOf(ctx.salts, 'cut/' + first.key));
        const chorusEnd = r === lastChorus;
        let d, win;
        if (run.pin) {
          d = { from: run.pin.from, by: run.pin.by, v: run.pin.v };
          win = typeof d.v === 'string' ? d.v : null;
          if (trace) {
            const shadow = autoRig(ctx, row, seed, avoid, false);
            Object.assign(trace, { kind: 'rig', stage: 'pin', pin: run.pin, candidates: shadow.candidates });
          }
        } else if (!(A >= RIG_OFF)) {
          d = { from: 'auto', v: NONE };
          win = NONE;
          if (trace) {
            Object.assign(trace, { kind: 'rig', stage: 'rule', rule: 'none-camera', why: [{ code: 'cam.amount', params: { x: A } }],
              candidates: SHOT.RIG_KEYS.concat([NONE]).sort().map((key) => ({ key, w: 0, masked: key === NONE ? null : 'gate' })) });
          }
        } else {
          const got = autoRig(ctx, row, seed, avoid, !!trace);
          d = { from: 'auto', v: got.v };
          win = got.win;
          if (trace) {
            const why = got.why.slice();
            if (chorusEnd && got.v !== NONE) why.push({ code: 'rig.lastChorus', params: {} });
            Object.assign(trace, { kind: 'rig', stage: 'auto', why, candidates: got.candidates });
          }
        }
        avoid = win && win !== NONE ? win : null;
        const amp = q2(Math.min(AMP_MAX, q2(0.4 + 0.6 * A) * (chorusEnd ? LAST_CHORUS_AMP : 1)));
        const rig = withAmp(d, amp);
        if (trace) trace.decision = rig;
        const curve = rigCurve(ctx, first, rig.v, chorusEnd);
        for (const j of run.idx) cuts[j].rig = r;
        const s = first.seamIn >= 0 && seams && seams[first.seamIn] ? seams[first.seamIn] : null;
        out.push({ blend: r > 0 && s ? { t0: N.q6(s.at - s.dur / 2), t1: N.q6(s.at + s.dur / 2) } : null,
          cuts: run.idx.map((j) => cuts[j].key), curve, key: 'k' + first.key, rig, t0: r === 0 ? 0 : N.q6(Math.max(0, first.a)),
          t1: 0 });
      });
      out.forEach((g, k) => { g.t1 = k + 1 < out.length ? out[k + 1].t0 : N.q6(Math.max(duration, g.t0)); });
      return out;
    }

    // rig.curve of a run: its pin at the first cut, else slowBloom on the last chorus, else the preset's own curve.
    function rigCurve(ctx, first, v, chorusEnd) {
      const trace = tracing(ctx, first.key, 'rig.curve');
      const pin = PA.pinned(ctx.ix, 'rig.curve')
        ? PA.resolvePin(ctx.ix, atOf(first), 'rig.curve', PA.acceptSpec(SLOT_SPECS['rig.curve']), ctx.warn) : null;
      let d, why;
      if (pin) d = { by: pin.by, from: pin.from, v: pin.v };
      else if (chorusEnd && v !== NONE) {
        d = { from: 'auto', v: 'slowBloom' };
        why = [{ code: 'rig.lastChorus', params: {} }];
      } else {
        d = { from: 'auto', v: typeof v === 'string' && SHOT.RIGS[v] ? SHOT.RIGS[v].curve : 'linear' };
        why = [{ code: 'rule', params: { rule: 'rig.curve' } }];
      }
      if (trace) Object.assign(trace, { kind: 'rig.curve', stage: pin ? 'pin' : 'auto', pin, why: why || null, decision: d });
      return d;
    }

    return {
      SLOT_SPECS, CAM_SLOTS, SHOT_POOL, decideSpeed, applySpeed, decideCamera, shotWeights, carry, rigs,
      FACTORS: Object.freeze({ AMOUNT_OFF, SHORT_CUT, SHOT_RECENT, SHOT_NEAR, SHOT_ECHO, RIG_OFF, LAST_CHORUS_AMP, AMP_MAX }),
    };
  });
