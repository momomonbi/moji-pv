/* 文字PVメーカー v2 — original work. 文字PVの定石 for one plan: ctx.pv, the hooks casting, tracks and the camera read (DESIGN_2_2 §2.0.3). */
MV.def('planner/conventions', ['core/num', 'core/shot', 'planner/arc', 'planner/kit', 'planner/flow', 'planner/encode',
  'planner/fxcap'], (N, SHOT, ARC, KIT, FL, EN, FX) => {
    'use strict';

    // prepare(ctx, cuts, timed, { sheet, pool, intern, cached, film }) → ctx.pv, made once per plan (planner/plan stage 4)
    // when some member of 文字PVの定石 that changes the cast is on (ctx.rules.any); null otherwise, and every caller reads
    // `ctx.pv ? … : <as before>`, so a document without them plans exactly as before. pool(kind) = the pool a kit draws
    // from, intern = planner/cast intern and film = the look's screen-effect drive (planner/cast filterDrive), handed in:
    // this module does not import planner/cast.
    const ARC_KINDS = new Set(['arrange', 'arrive', 'dwell', 'depart', 'lens']);
    const KIT_PART_KINDS = new Set(['arrange', 'arrive', 'dwell', 'depart', 'lens', 'filter', 'ornament']);

    function q3(x) { return Math.round(x * 1000) / 1000; }

    // The arc's factor for a part of strength s (planner/arc strength) at drive d: strong parts ×(0.4 + 1.2d), calm
    // ones ×(1.6 − 1.2d); both 1 at d = 0.5.
    function arcFactor(s, d) { return s > 0 ? 0.4 + 1.2 * d : s < 0 ? 1.6 - 1.2 * d : 1; }

    // Blended features (the arc): a frozen copy of the cut's features whose energy is halfway to its part's drive, kept
    // for the last two cached plans by features id and drive (planner/plan keeps features the same way).
    let blendPrev = new Map(), blendCur = new Map();
    function beginBlends() { if (blendCur.size) { blendPrev = blendCur; blendCur = new Map(); } }
    function blended(feat, featId, drive, cached) {
      const make = () => Object.freeze(Object.assign({}, feat, { energy: q3(N.clamp(0.5 * feat.energy + 0.5 * drive)) }));
      if (!cached || !featId) return make();
      const key = featId + '|' + drive;
      let f = blendCur.get(key);
      if (f === undefined) {
        f = blendPrev.get(key);
        if (f === undefined) f = make();
        blendCur.set(key, f);
      }
      return f;
    }

    // The kit weights (KIT.weights) of the last two cached plans, by what they read: the registry, the look the chooser's
    // look-only factors come from (as the cast cache keys it: mood, theme, season, amounts), the pools, the beat, the
    // energy and whether the arc leans them. Typing a line changes none of them.
    let weightsPrev = new Map(), weightsCur = new Map();
    function beginWeights() { if (weightsCur.size) { weightsPrev = weightsCur; weightsCur = new Map(); } }
    function weightsKey(ctx, pool, drive, arcOn) {
      const look = ctx.look;
      let text = EN.canon([look.mood ? look.mood.key : null, look.theme ? look.theme.key : null, look.season, look.amounts,
        ctx.grid ? ctx.grid.period : 0, drive, arcOn]);
      for (const kind of KIT.KIT_KINDS) text += '|' + pool(kind).join(',');
      return text;
    }

    function prepare(ctx, cuts, timed, opts) {
      const o = opts || {};
      const rules = ctx.rules;
      const on = Object.freeze({ kit: !!rules.kit, alt: !!rules.alt, arc: !!rules.arc, fx: !!rules.fx, camAlt: false });
      const cached = !!o.cached;
      const film = typeof o.film === 'number' ? o.film : 0;
      if (cached) { beginBlends(); beginWeights(); }
      const intern = o.intern || ((x) => x);
      const A = ARC.parts(ctx, cuts, timed, o.sheet || null);
      const arcOn = on.arc && !A.neutral;
      const kits = new Map();                       // part key → { kit, id }
      const weights = new Map();                    // drive → the kit weights at that energy (KIT.weights)
      function kitOf(part) {
        if (!on.kit || !part) return null;
        let k = kits.get(part.key);
        if (!k) {
          const drive = ARC.driveOfKind(part.kind);
          let W = weights.get(drive);
          if (!W) {
            const key = cached ? weightsKey(ctx, o.pool, drive, arcOn) : null;
            const hit = key !== null ? weightsCur.get(key) || weightsPrev.get(key) : undefined;
            if (hit && hit.registry === ctx.registry) W = hit.W;
            else {
              // under the arc the set leans the way the part's kind does (its drive; the part's own cuts vary around it)
              const lean = arcOn ? (kind, def, traits) => (ARC_KINDS.has(kind) ? arcFactor(ARC.strength(def, traits), drive) : 1) : null;
              W = KIT.weights(ctx, o.pool, drive, lean);
            }
            if (key !== null) weightsCur.set(key, { registry: ctx.registry, W });
            weights.set(drive, W);
          }
          const kit = KIT.select(ctx, part, o.pool, drive, null, W);
          k = { kit, id: intern(EN.canon([kit.key, kit.kind, kit.face, kit.groups, kit.primary])) };
          kits.set(part.key, k);
        }
        return k;
      }

      function partOf(cut) { return cut ? A.byCut.get(cut.key) || null : null; }

      function featOf(cut) {
        if (!arcOn) return cut.feat;
        const part = partOf(cut);
        return part ? blended(cut.feat, cut.featId, part.drive, cached) : cut.feat;
      }

      // The energy a transition into B reads (its chance): B's blended energy; a special cut blends with its own drive.
      function seamEnergy(B) {
        if (!arcOn) return B.feat.energy;
        const part = partOf(B);
        return q3(N.clamp(0.5 * B.feat.energy + 0.5 * (part ? part.drive : ARC.SPECIAL_DRIVE)));
      }

      // What 文字PVの定石 adds to a cut's cast inputs (planner/cast castInputs): its part, run start, drive and kit.
      const ids = new Map();
      function idOf(cut) {
        const part = partOf(cut);
        if (!part) return '';
        let id = ids.get(cut.key);
        if (id === undefined) {
          const k = kitOf(part);
          id = intern(part.key + '|' + (part.first ? 1 : 0) + '|' + (arcOn ? part.drive : '-') + '|' + (k ? k.id : '-'));
          ids.set(cut.key, id);
        }
        return id;
      }

      // partFactor(st, kind, idx) → { f(key, s, trace) → number, member(key) → bool, block(key) → bool | null } for a
      // cut's part slot: the kit's factor (KIT_PRIMARY, KIT or 1) × the arc's factor on the part's strength (a lyric cut
      // with a part), and 「効果を重ねすぎない」's lettering block (every cut, motions and screen effects; idx = the
      // screen effect's index); null when none applies. trace (explain) receives pvKit and pvArc.
      const factors = new Map();
      const combos = new Map();
      function partFactor(st, kind, idx) {
        const base = kitArcFactor(st, kind);
        const lb = on.fx ? letterOf(st, kind, idx) : null;
        if (!lb) return base;
        const id = (base ? base.id : '-') + '#' + lb.id;
        let fx = combos.get(id);
        if (!fx) {
          fx = Object.freeze({ kind, id, f: base ? base.f : one, member: base ? base.member : no, block: lb.has });
          combos.set(id, fx);
        }
        return fx;
      }
      function one() { return 1; }
      function no() { return false; }

      // The lettering block of a motion or screen effect slot: by the cut's text style (and, for a screen effect, its
      // entrance, hold and exit and the text screen effects before it); null when nothing clashes.
      function letterOf(st, kind, idx) {
        if (kind !== 'filter' && !FX.MOTION_KINDS.includes(kind)) return null;
        const style = st.chosen['text.style'];
        return FX.letterBlock(kind, typeof style === 'string' ? style : 'plain', st.chosen,
          kind === 'filter' ? FX.priorFilters(st.slots, idx || 0) : null);
      }

      function kitArcFactor(st, kind) {
        const part = st.part;
        if (!part) return null;
        const k = KIT_PART_KINDS.has(kind) ? kitOf(part) : null;
        const drive = arcOn && ARC_KINDS.has(kind) ? part.drive : null;
        if (!k && drive === null) return null;
        const id = kind + '|' + part.key + '|' + drive;
        let fx = factors.get(id);
        if (!fx) {
          fx = makeFactor(kind, k ? k.kit : null, drive, id);
          factors.set(id, fx);
        }
        return fx;
      }

      function makeFactor(kind, kit, drive, id) {
        const byKey = new Map();
        function parts(key, def, traits) {
          let x = byKey.get(key);
          if (x === undefined) {
            const d = def || ctx.registry.get(kind, key);
            const kf = kit ? KIT.factorOf(kit, kind, KIT.groupOf(kind, d)) : 1;
            const af = drive !== null ? arcFactor(ARC.strength(d, traits || ctx.registry.traits(kind, key)), drive) : 1;
            x = { kf, af, w: kf * af };
            byKey.set(key, x);
          }
          return x;
        }
        return Object.freeze({
          kind, id,
          f(key, s, trace) {
            const x = parts(key, s ? s.def : null, s ? s.traits : null);
            if (trace) { trace.pvKit = x.kf; trace.pvArc = x.af; }
            return x.w;
          },
          member(key) { return !!kit && parts(key, null, null).kf > 1; },
          block: null,
        });
      }

      // The kit's factor on a segment's background, by the part of the segment's first cut (none for a special one).
      function groundFactor(first) {
        const part = partOf(first);
        const k = part ? kitOf(part) : null;
        if (!k) return null;
        const id = 'ground|' + part.key;
        let fx = factors.get(id);
        if (!fx) { fx = makeFactor('ground', k.kit, null, id); factors.set(id, fx); }
        return fx;
      }

      function faceBoost(st) {
        const k = st.part ? kitOf(st.part) : null;
        return k ? k.kit.face : null;
      }

      function avoidAlso(kind) { return on.kit && KIT.KIT_AVOID.includes(kind); }

      // Directions (M2): the cast's parameters and the seams.
      function flipParams(st, kind, idx, seed, d, aligned) {
        return on.alt ? FL.flipParams(st, kind, idx, seed, d, st.part, aligned) : null;
      }
      function dirOf(st) { return on.alt && st && st.dirOwn ? FL.pack(st.dirOwn) : FL.NO_DIR; }
      function flipSeam(B, d, history, seed) { return on.alt ? FL.flipSeam(ctx, B, d, history, seed) : d; }
      function seamDir(d) { return on.alt ? FL.seamDir(d) : 0; }

      // 「効果を重ねすぎない」 (T5, DESIGN_2_2 §2.3): the cut budget. trimLists(st, needF) → the lower counts that bring a
      // lyric cut under its cap ({ ornament?, filter? }, planner/cast applies them) or null; seamGate(B, world) → whether B
      // gets no automatic transition (still over its cap, and the background stays). キメ lines are left alone.
      function trimLists(st, needF) { return on.fx ? FX.trim(ctx, st, needF, film, ARC.kimeAt(st.cut)) : null; }
      function seamGate(B, world) { return on.fx && !!B && !!B.slots && FX.gate(ctx, B, B.slots, !!world, ARC.kimeAt(B)); }

      // The loads and caps of the lyric cuts as cast (before the tracks replace motions or shots), for plan.pv and the
      // tests (also with the budget off, to compare): { load, cap, kime, aligned }.
      let loads = null;
      function castDone(list) {
        loads = new Map();
        for (const cut of list) {
          if (!FX.PER_CUT_ROLES.has(cut.role)) continue;
          const x = FX.xOn(ctx, cut);
          loads.set(cut.key, Object.freeze({ load: FX.loadOf(ctx, cut.slots, cut, x), cap: FX.capOf(ctx, cut, x),
            kime: ARC.kimeAt(cut), aligned: !!(ctx.align && ctx.align.get(cut.key)) }));
        }
      }

      // The arc's factor on a shot preset (planner/camera weighShots, on the cut's own weights): a function of the shot
      // key, or null. 'none' counts as calm.
      function shotFactors(st) {
        if (!arcOn || !st.part) return null;
        const drive = st.part.drive;
        return (key) => arcFactor(key === 'none' ? -1 : ARC.strength(SHOT.SHOTS[key] || null, null), drive);
      }

      // arcWhy(st, factor) → the reason the arc gives a pick its factor x at the cut (explain): the last chorus (the
      // peak), the hold before a chorus, or the part's kind favouring stronger (drive above 0.5) or calmer moves; null
      // when the arc left the pick alone.
      function arcWhy(st, x) {
        const part = st ? st.part : null;
        if (!arcOn || !part || Math.abs(x - 1) < 1e-9 || part.drive === 0.5) return null;
        if (part.peak) return { code: 'pv.peak', params: {} };
        if (part.tame) return { code: 'pv.tame', params: {} };
        return { code: part.drive > 0.5 ? 'pv.arc.up' : 'pv.arc.down', params: { section: part.kind || 'other' } };
      }

      function summary() {
        const kitsOut = [];
        for (const entry of A.keys) {
          const k = on.kit ? kitOf({ key: entry.key, kind: entry.kind }) : null;
          const out = { key: entry.key, kind: entry.kind, label: { kind: entry.kind, n: entry.n, pseudo: A.pseudo } };
          if (k) {
            for (const kind of KIT.KIT_KINDS) out[kind] = k.kit.groups[kind].slice();
            out.primary = Object.assign({}, k.kit.primary);
            out.face = k.kit.face;
          }
          kitsOut.push(Object.freeze(out));
        }
        const parts = new Map();
        for (const [key, p] of A.byCut) parts.set(key, Object.freeze({ key: p.key, kind: p.kind, drive: p.drive, tame: p.tame, peak: p.peak, head: p.head }));
        return Object.freeze({ on, pseudo: A.pseudo, neutral: A.neutral, kits: Object.freeze(kitsOut), parts, loads });
      }

      return {
        on, arcOn, partOf, featOf, seamEnergy, idOf, partFactor, groundFactor, faceBoost, avoidAlso, flipParams, dirOf,
        flipSeam, seamDir, shotFactors, arcWhy, kimeAt: ARC.kimeAt, summary, kitOf, trimLists, seamGate, castDone,
      };
    }

    return { prepare, arcFactor, ARC_KINDS };
  });
