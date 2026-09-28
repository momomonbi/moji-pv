/* 文字PVメーカー v2 — original work. 文字PVの定石 for one plan: ctx.pv, the hooks casting, tracks and the camera read (DESIGN_2_2 §2.0.3). */
MV.def('planner/conventions', ['core/num', 'core/shot', 'planner/arc', 'planner/kit', 'planner/flow', 'planner/encode'],
  (N, SHOT, ARC, KIT, FL, EN) => {
    'use strict';

    // prepare(ctx, cuts, timed, { sheet, pool, intern, cached }) → ctx.pv, made once per plan (planner/plan stage 4) when
    // some member of 文字PVの定石 that changes the cast is on (ctx.rules.any); null otherwise, and every caller reads
    // `ctx.pv ? … : <as before>`, so a document without them plans exactly as before. pool(kind) = the pool a kit draws
    // from and intern = planner/cast intern (handed in: this module does not import planner/cast).
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

    function prepare(ctx, cuts, timed, opts) {
      const o = opts || {};
      const rules = ctx.rules;
      const on = Object.freeze({ kit: !!rules.kit, alt: !!rules.alt, arc: !!rules.arc, fx: !!rules.fx, camAlt: false });
      const cached = !!o.cached;
      if (cached) beginBlends();
      const intern = o.intern || ((x) => x);
      const A = ARC.parts(ctx, cuts, timed, o.sheet || null);
      const arcOn = on.arc && !A.neutral;
      const kits = new Map();                       // part key → { kit, id }
      function kitOf(part) {
        if (!on.kit || !part) return null;
        let k = kits.get(part.key);
        if (!k) {
          const kit = KIT.select(ctx, part, o.pool, ARC.driveOfKind(part.kind));
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

      // partFactor(st, kind) → { f(key, s, trace) → number, member(key) → bool, block: null } for a lyric cut's part slot:
      // the kit's factor (KIT_PRIMARY, KIT or 1) × the arc's factor on the part's strength; null when neither applies.
      // trace (explain) receives pvKit and pvArc.
      const factors = new Map();
      function partFactor(st, kind) {
        const part = st.part;
        if (!part) return null;
        const k = KIT_PART_KINDS.has(kind) ? kitOf(part) : null;
        const drive = arcOn && ARC_KINDS.has(kind) ? part.drive : null;
        if (!k && drive === null) return null;
        const id = kind + '|' + part.key + '|' + drive;
        let fx = factors.get(id);
        if (!fx) {
          fx = makeFactor(kind, k ? k.kit : null, drive);
          factors.set(id, fx);
        }
        return fx;
      }

      function makeFactor(kind, kit, drive) {
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
          kind,
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
        if (!fx) { fx = makeFactor('ground', k.kit, null); factors.set(id, fx); }
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
        return Object.freeze({ on, pseudo: A.pseudo, neutral: A.neutral, kits: Object.freeze(kitsOut), parts });
      }

      return {
        on, arcOn, partOf, featOf, seamEnergy, idOf, partFactor, groundFactor, faceBoost, avoidAlso, flipParams, dirOf,
        flipSeam, seamDir, shotFactors, arcWhy, kimeAt: ARC.kimeAt, summary, kitOf,
      };
    }

    return { prepare, arcFactor, ARC_KINDS };
  });
