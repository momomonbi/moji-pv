/* 文字PVメーカー v2 — original work. 読み切れない速さ: how long each line cut can be read, from a finished Plan — a pure reader, never in the Plan (PV22 S4, DESIGN_2_2 §5). */
MV.def('planner/readable', ['core/motion', 'core/script'], (MO, S) => {
  'use strict';

  const READ = Object.freeze({
    // units (morae; syllables for Latin words) per legible second. en 11, not the design's 9: the automatic timing reads
    // every language at the same nominal rate and gives English lines up to 10.1 (the app's English sample, NOTES P5)
    MAX: Object.freeze({ ja: 12, ko: 12, zhHans: 10, zhHant: 10, en: 11 }),
    MIN_UNITS: 4,          // the rate rule needs at least this many units
    // a cut with ≥ FLOOR_UNITS units legible for less than this is flagged whatever its rate. 0.25, not the design's 0.3:
    // a short automatic piece followed by a transition reads 0.265–0.296 s at lead 0.12 in the fixtures (NOTES, P5)
    MIN_LEGIBLE: 0.25,
    FLOOR_UNITS: 2,
    SUNG_AFTER: 0.4,       // a 歌ハメ cut (P6 cut.sung) stays readable this long after its last character
  });
  const RATE_MIN_W = 0.05; // the rate of a cut legible for less than this is computed over this (a finite number)

  function units(cut) { return S.morae(cut.text, cut.lang); }
  function limitOf(lang) { return READ.MAX[lang] || READ.MAX.ja; }

  // The arrive unit count the planner and the scene fit the stagger with (planner/plan unitCount).
  function countOf(registry, cut) {
    const d = cut.slots ? cut.slots.arrive : null;
    const def = d && registry ? registry.get('arrive', d.v) : null;
    const unit = def && def.unit ? def.unit : 'glyph';
    const u = cut.feat && cut.feat.units ? cut.feat.units : { glyph: 1, word: 1, line: 1 };
    return unit === 'word' ? u.word : unit === 'line' || unit === 'run' ? u.line : u.glyph;
  }

  // The fitted length of a motion slot (s): 0 without one, for the fallback part (instant), and for an entrance revealed
  // as sung (the text is read as it appears); else core/motion.fitMotion as the scene fits it.
  function motionTotal(registry, fallbacks, cut, kind, window, cap) {
    const d = cut.slots ? cut.slots[kind] : null;
    if (!d || d.v === null || d.v === undefined || d.v === fallbacks[kind]) return 0;
    const p = d.p || {};
    if (kind === 'arrive' && p.order === 'sung') return 0;
    return MO.fitMotion({ dur: p.dur, each: p.each, count: countOf(registry, cut), window, share: MO.SHARE[kind], cap }).total;
  }

  function fallbacksOf(registry) {
    return {
      arrive: registry && typeof registry.fallback === 'function' ? registry.fallback('arrive') : null,
      depart: registry && typeof registry.fallback === 'function' ? registry.fallback('depart') : null,
    };
  }

  // The outgoing transition of each cut (by the cut key of its A side).
  function seamsOut(plan) {
    const out = new Map();
    for (const s of plan.seams || []) if (s && s.a) out.set(s.a, s);
    return out;
  }

  // legibleOf(plan, i, registry) → { V, A, L, W } of plan.cuts[i]: the final window V = b − a (after 出そろい, the
  // hand-over tiers, the neighbour clamp and the seams' clips), the fitted entrance A (capped by `ready`) and exit L, and
  // the legible time W = V − A/2 − L/2, cut at the start of an outgoing transition (at; at − dur/2 for a transition whose
  // definition moves the glyphs themselves, P4's モーフ).
  function legibleOf(plan, i, registry, ctx) {
    const c = plan.cuts[i];
    const fb = ctx ? ctx.fallbacks : fallbacksOf(registry);
    const out = ctx ? ctx.out : seamsOut(plan);
    const V = c.b - c.a;
    const cap = typeof c.ready === 'number' ? c.ready - c.a : undefined;
    const A = motionTotal(registry, fb, c, 'arrive', V, cap);
    const L = motionTotal(registry, fb, c, 'depart', V);
    let W = V - A / 2 - L / 2;
    const seam = out.get(c.key);
    if (seam && typeof seam.at === 'number') {
      const def = registry && seam.slot && typeof seam.slot.v === 'string' ? registry.get('seam', seam.slot.v) : null;
      const readEnd = def && def.glyphs === true ? seam.at - (seam.dur || 0) / 2 : seam.at;
      W = Math.min(W, readEnd - c.a - A / 2);
    }
    return { V, A, L, W };
  }

  // A 歌ハメ cut (P6: cut.sung = { t: [character times from t0], end }, arrive order 'sung'): read as it is sung, so what
  // matters is how long it stays after its last character.
  function sungOf(c) {
    const s = c.sung;
    const d = c.slots ? c.slots.arrive : null;
    if (!s || !Array.isArray(s.t) || !s.t.length || typeof s.end !== 'number') return null;
    return d && d.p && d.p.order === 'sung' ? s : null;
  }

  const memo = new WeakMap();

  // check(plan, registry) → frozen [{ cut, line, rate, units, legible, limit }]: the line cuts too fast to read, in plan
  // order. A cut is flagged when it has ≥ MIN_UNITS units read at more than MAX[lang] units per legible second, or
  // ≥ FLOOR_UNITS units legible for less than MIN_LEGIBLE seconds; a 歌ハメ cut when it leaves the screen less than
  // SUNG_AFTER after its last character. Memoized per plan object.
  function check(plan, registry) {
    if (!plan || !Array.isArray(plan.cuts)) return Object.freeze([]);
    const hit = memo.get(plan);
    if (hit && hit.registry === registry) return hit.list;
    const ctx = { fallbacks: fallbacksOf(registry), out: seamsOut(plan) };
    const list = [];
    plan.cuts.forEach((c, i) => {
      if (!c.line || !c.text) return;
      const n = units(c);
      const limit = limitOf(c.lang);
      const sung = sungOf(c);
      if (sung) {
        const L = motionTotal(registry, ctx.fallbacks, c, 'depart', c.b - c.a);
        const after = c.b - (c.t0 + sung.end) - L / 2;
        if (n >= READ.FLOOR_UNITS && after < READ.SUNG_AFTER) {
          const rate = n / Math.max(RATE_MIN_W, sung.end - sung.t[0]);
          list.push(Object.freeze({ cut: c.key, line: c.line, rate, units: n, legible: after, limit }));
        }
        return;
      }
      const { W } = legibleOf(plan, i, registry, ctx);
      const rate = n / Math.max(RATE_MIN_W, W);
      if ((n >= READ.MIN_UNITS && rate > limit) || (n >= READ.FLOOR_UNITS && W < READ.MIN_LEGIBLE)) {
        list.push(Object.freeze({ cut: c.key, line: c.line, rate, units: n, legible: W, limit }));
      }
    });
    const frozen = Object.freeze(list);
    memo.set(plan, { registry, list: frozen });
    return frozen;
  }

  return { READ, check, legibleOf, units, limitOf };
});
