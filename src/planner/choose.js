/* 文字PVメーカー v2 — original work. The chooser: stream seeds, candidate weights and Gumbel-max picks (DESIGN §4.16.4, §4.1.3). */
MV.def('planner/choose', ['core/hash', 'core/rng', 'core/num'], (H, R, N) => {
  'use strict';

  const FIT_FLOOR = 0.15;        // weight a numeric trait falls to at 50 % beyond its range
  const RECENT_PREV = 0.03;      // same value as the previous cut
  const RECENT_NEAR = 0.35;      // same value in the 3 cuts before that
  const SAME_FAMILY = 0.5;       // same family as the previous cut
  const ECHO = 2.5;              // what the first sung copy of a repeated line used
  const IMPACT = 6;              // impact cut and a part made for impacts
  const MOOD_FILTER_DEFAULT = 0.2;
  // The mood factor is the geometric mean of the tag biases raised to this power. Averaged over a part's tags and
  // under the Gumbel noise and recency, the plain mean left moods picking alike (QA-LOOK: quietHush took fast-tagged
  // parts in 6 % of picks against dashSprint's 13 %; every composition got 6–10 % of picks under every mood).
  const MOOD_POWER = 1.5;
  // Seasonal parts under the season 'any' (no season pinned or found in the lyrics): ×0.5 when they are the theme's
  // own season (a seasonal theme is its season's picture; its prefer map damps the other seasons), else ×0.25 — under
  // a non-seasonal theme a stray petal wash or maple paper reads as a mistake (QA-LOOK). Themes themselves ×0.5.
  const SEASON_ANY = 0.5, SEASON_ANY_STRAY = 0.25, SEASON_MATCH = 1.5;
  // The smallest scale "50 % beyond" a numeric trait is measured against (so a bound of 0 still has a slope).
  const CELLS_SCALE = 2, ENERGY_SCALE = 0.2;

  // --- stream seeds (FROZEN names, §4.1.3) ---------------------------------------------------------------------

  function saltOf(salts, key) { return (salts && salts[key]) || 0; }

  // cutSeed = hash32('cut', look.seed, cutKey, salts['line/'+lineId] or 0, salts['cut/'+cutKey] or 0);
  // special cuts have no line, so their line salt is 0.
  function cutSeed(seed, cutKey, lineId, salts) {
    return H.hash32('cut', seed, cutKey, lineId ? saltOf(salts, 'line/' + lineId) : 0, saltOf(salts, 'cut/' + cutKey));
  }

  // slotSeed = hash32('slot', cutSeed, slot, salts['cut/'+cutKey+':'+slot] or 0, salts['line/'+lineId+':'+slot] or 0)
  function slotSeed(cutSeedValue, cutKey, lineId, slot, salts) {
    return H.hash32('slot', cutSeedValue, slot, saltOf(salts, 'cut/' + cutKey + ':' + slot),
      lineId ? saltOf(salts, 'line/' + lineId + ':' + slot) : 0);
  }

  // The same slot seed from slotPrefix(cutSeed) (the hash state after 'slot' and the cut seed, made once per cut).
  function slotPrefix(cutSeedValue) { return fnvPart(fnvPart(0x811c9dc5, 'slot'), String(cutSeedValue)); }
  function slotSeedAt(prefix, cutKey, lineId, slot, salts) {
    const a = salts ? saltOf(salts, 'cut/' + cutKey + ':' + slot) : 0;
    const b = salts && lineId ? saltOf(salts, 'line/' + lineId + ':' + slot) : 0;
    return fmix(fnvPart(fnvPart(fnvPart(prefix, slot), String(a)), String(b)));
  }

  // A background segment's seed; slot seeds of the segment use it in place of the cut seed of its first cut.
  function segSeed(seed, firstCutKey, salts) {
    return H.hash32('seg', seed, firstCutKey, saltOf(salts, 'cut/' + firstCutKey));
  }

  // The stream of one parameter's auto: stream(slotSeed, 'param', name). A field-dice salt on the parameter itself
  // ('cut/<key>:arrive.dur') is appended only when present, so unsalted streams keep the frozen labels. The hash of
  // the common prefix (slotSeed, 'param') is shared by all parameters of a slot (paramPrefix), as in gumbelAt.
  function paramStream(seedValue, name, salt, prefix) {
    let h = fnvPart(prefix === undefined ? paramPrefix(seedValue) : prefix, name);
    if (salt) h = fnvPart(h, String(salt));
    return R.fromSeed(fmix(h));
  }

  function paramPrefix(seedValue) { return fnvPart(fnvPart(0x811c9dc5, String(seedValue)), 'param'); }

  // --- Gumbel noise for a whole pool ------------------------------------------------------------------------------

  // gumbel(seed, key) of core/rng for every key of a pool: -ln(-ln((hash32('gumbel', seed, key) + 0.5) / 2^32)).
  // hash32 is FNV-1a with a separator after each part and an fmix32 finaliser, so the state after the common prefix
  // ('gumbel', seed) is computed once per pick instead of once per candidate. Same numbers as core/rng.gumbel
  // (tests/node/planner_explain.test.js checks it).
  function fnvPart(h, s) {
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= 0x1f;
    return Math.imul(h, 0x01000193);
  }

  // The murmur3 fmix32 finaliser of hash32, as an unsigned 32-bit integer.
  function fmix(h) {
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  }

  function gumbelPrefix(seed) { return fnvPart(fnvPart(0x811c9dc5, 'gumbel'), String(seed)); }

  function gumbelAt(prefix, key) {
    return -Math.log(-Math.log((fmix(fnvPart(prefix, key)) + 0.5) / 4294967296));
  }

  // --- factors -------------------------------------------------------------------------------------------------

  function num(v, dflt) { return typeof v === 'number' && Number.isFinite(v) ? v : dflt; }

  // Geometric mean of the mood's tag bias over the part's tags, to the power MOOD_POWER (1 without tags); a zero bias
  // zeroes the part.
  function moodBias(tags, mood) {
    if (!Array.isArray(tags) || tags.length === 0) return 1;
    const bias = (mood && mood.tagBias) || {};
    let logSum = 0;
    for (const tag of tags) {
      const b = num(bias[tag], 1);
      if (!(b > 0)) return 0;
      logSum += Math.log(b);
    }
    return Math.exp(MOOD_POWER * logSum / tags.length);
  }

  // The season factor of a part (§3.8). home = the theme's season (null for a non-seasonal theme) when a part slot is
  // weighed; undefined when a theme itself is.
  function seasonFactor(partSeason, season, home) {
    if (!partSeason) return 1;
    if (season === partSeason) return SEASON_MATCH;
    if (season !== 'any') return 1;                     // other seasons never reach the pool
    return home === undefined || home === partSeason ? SEASON_ANY : SEASON_ANY_STRAY;
  }

  // One numeric trait: 1 inside [lo, hi]; outside, linear down to 0.15 at 50 % beyond the bound (0.15 further out).
  function rangeFit(range, x, scale) {
    if (!range || typeof x !== 'number') return 1;
    const lo = range[0], hi = range[1];
    let excess, span;
    if (x < lo) { excess = lo - x; span = 0.5 * Math.max(Math.abs(lo), scale); }
    else if (x > hi) { excess = x - hi; span = 0.5 * Math.max(Math.abs(hi), scale); }
    else return 1;
    return Math.max(FIT_FLOOR, 1 - (1 - FIT_FLOOR) * Math.min(1, excess / span));
  }

  // The product over the numeric traits (cells, energy).
  function traitFit(traits, feat) {
    if (!traits || !feat) return 1;
    return rangeFit(traits.cells, feat.cells, CELLS_SCALE) * rangeFit(traits.energy, feat.energy, ENERGY_SCALE);
  }

  // --- the chooser -------------------------------------------------------------------------------------------

  // createChooser(registry, look) → { pick, statics, weigh }. look = { mood: MoodDef, theme: ThemeDef, season,
  // amounts }. The look-only factors of each candidate are computed once per plan.
  function createChooser(registry, look) {
    const cache = new Map();

    // Factors that depend only on the look: base weight, mood tag bias, gate, theme preference, season and (filter
    // slots only) the mood's filter weights.
    function statics(kind, key, moodFilter) {
      const id = kind + '/' + key + (moodFilter ? '#f' : '');
      let s = cache.get(id);
      if (s) return s;
      s = makeStatics(kind, key, moodFilter);
      cache.set(id, s);
      return s;
    }

    // The statics of a whole pool, cached per pool array (pools are cached per plan, so this is one lookup per pick).
    const byPool = new WeakMap();
    function poolStatics(kind, keys, moodFilter) {
      let m = byPool.get(keys);
      if (!m) { m = new Map(); byPool.set(keys, m); }
      const id = kind + (moodFilter ? '#f' : '');
      let list = m.get(id);
      if (!list) { list = keys.map((key) => statics(kind, key, moodFilter)); m.set(id, list); }
      return list;
    }

    function makeStatics(kind, key, moodFilter) {
      const def = registry.get(kind, key);
      const prefer = look.theme && look.theme.prefer && look.theme.prefer[kind];
      const s = {
        def,
        fits: typeof def.fits === 'function' ? def.fits : null,
        family: def.family,
        traits: registry.traits(kind, key),
        weight: num(def.weight, 1),
        mood: moodBias(def.tags, look.mood),
        gate: def.gate ? num(look.amounts[def.gate], 0) : 1,
        prefer: prefer ? num(prefer[key], 1) : 1,
        season: seasonFactor(def.season, look.season, look.theme ? look.theme.season || null : null),
        moodFilter: moodFilter ? filterWeight(look.mood, key) : 1,
      };
      s.product = s.weight * s.mood * s.gate * s.prefer * s.season * s.moodFilter;
      return s;
    }

    function filterWeight(mood, key) {
      const w = mood && mood.filters ? mood.filters[key] : undefined;
      return num(w, MOOD_FILTER_DEFAULT);
    }

    // Recency factors (§4.16.4) as flags: the previous cut's value, one of the 3 cuts before it, the previous cut's
    // family. rec = { prev, near, families } (small arrays).
    const PREV = 1, NEAR = 2, FAMILY = 4;

    // w × the flagged factors, in their fixed order, quantized; q = q6(w) is the answer when no flag is set.
    function withRecency(w, q, flags) {
      if (flags === 0) return q;
      let x = w;
      if (flags & PREV) x *= RECENT_PREV;
      if (flags & NEAR) x *= RECENT_NEAR;
      if (flags & FAMILY) x *= SAME_FAMILY;
      return N.q6(x);
    }

    function recencyFlags(rec, key, family) {
      if (!rec) return 0;
      return (rec.prev.includes(key) ? PREV : 0) | (rec.near.includes(key) ? NEAR : 0) |
        (family && rec.families.includes(family) ? FAMILY : 0);
    }

    function traceRecency(f, flags) {
      Object.assign(f, { recent: flags & PREV ? RECENT_PREV : 1, near: flags & NEAR ? RECENT_NEAR : 1,
        family: flags & FAMILY ? SAME_FAMILY : 1 });
    }

    // A candidate's weight before the recency factors (not quantized); with `f` (tracing) the factors are written
    // into it.
    function preWeight(req, key, s, f) {
      let w = s.product;
      let fit = 1, fits = 1, impact = 1, echo = 1;
      if (!req.noFit) {
        fit = traitFit(s.traits, req.feat);
        if (s.fits !== null) fits = Math.max(0, num(s.fits(req.feat, req.chosen || {}), 0));
        w *= fit * fits;
      }
      if (req.feat && req.feat.impact && s.traits && s.traits.impact) { impact = IMPACT; w *= IMPACT; }
      if (req.echo && req.echo === key) { echo = ECHO; w *= ECHO; }
      if (f) {
        Object.assign(f, { weight: s.weight, mood: s.mood, gate: s.gate, prefer: s.prefer, season: s.season,
          moodFilter: s.moodFilter, fit, fits, impact, echo });
      }
      return w;
    }

    // The weight of one candidate; with `f` (tracing) the factors are written into it as well. `baseW` receives the
    // weight without the recency factors and `refW` the weight with the reference recency `req.ref` (see pick).
    let baseW = 0, refW = 0;
    function weigh(req, key, f, st) {
      const s = st || statics(req.kind, key, req.moodFilter);
      const w = preWeight(req, key, s, f);
      const q = baseW = N.q6(w);
      if (req.ref) refW = withRecency(w, q, recencyFlags(req.ref, key, s.family));
      const flags = recencyFlags(req.recent, key, s.family);
      if (f) traceRecency(f, flags);
      return withRecency(w, q, flags);
    }

    // Positions of a pool's keys, per pool array (pools are cached per plan).
    const positions = new WeakMap();
    function positionsOf(keys) {
      let m = positions.get(keys);
      if (!m) { m = new Map(keys.map((k, i) => [k, i])); positions.set(keys, m); }
      return m;
    }

    // Per-candidate PREV / NEAR flags of `rec` over a pool, in a reused array (pick is never re-entered).
    let flagsA = new Uint8Array(64), flagsB = new Uint8Array(64);
    function markFlags(out, n, rec, at) {
      out.fill(0, 0, n);
      if (!rec) return;
      for (const key of rec.prev) { const i = at.get(key); if (i !== undefined) out[i] |= PREV; }
      for (const key of rec.near) { const i = at.get(key); if (i !== undefined) out[i] |= NEAR; }
    }

    function familyFlag(rec, family) {
      return rec && family && rec.families.length && rec.families.includes(family) ? FAMILY : 0;
    }

    // pick(req) → { v, w, base, ref, avoided? } | null (null when every candidate weighs 0).
    // req = { kind, keys (the pool, sorted), feat, chosen, seed, variety, recent?, ref?, echo?, noFit?, moodFilter?,
    // avoid?, trace? }. score = ln(w) + variety · gumbel(seed, key); argmax, ties → the smaller key (keys arrive sorted).
    // Two more argmaxes share the same noise (planner/cast createHistory): base = without the recency factors (the
    // cut's natural pick) and ref = with the recency `req.ref` (the cut's reference pick).
    // avoid (arrange and arrive, §8.2 "no identical adjacent"): when the winner is the previous cut's value and another
    // candidate weighs > 0, the runner-up is taken. The ×0.03 recency factor alone leaves such repeats rare but
    // possible; a pool of one still returns its part.
    function pick(req) {
      const variety = num(req.variety, 1);
      let best = null, bestScore = -Infinity, bestW = 0;
      let next = null, nextScore = -Infinity, nextW = 0;
      let base = null, baseScore = -Infinity;
      let ref = null, refScore = -Infinity;
      const keys = req.keys, n = keys.length;
      const list = poolStatics(req.kind, keys, req.moodFilter);
      const prefix = gumbelPrefix(req.seed);
      if (flagsA.length < n) { flagsA = new Uint8Array(n); flagsB = new Uint8Array(n); }
      const at = positionsOf(keys);
      markFlags(flagsA, n, req.recent, at);
      if (req.ref) markFlags(flagsB, n, req.ref, at);
      for (let i = 0; i < n; i++) {
        const key = keys[i];
        const s = list[i];
        const f = req.trace ? {} : null;
        const w0 = preWeight(req, key, s, f);
        const wb = N.q6(w0);
        const flags = flagsA[i] | familyFlag(req.recent, s.family);
        const w = withRecency(w0, wb, flags);
        const wr = req.ref ? withRecency(w0, wb, flagsB[i] | familyFlag(req.ref, s.family)) : 0;
        if (f) traceRecency(f, flags);
        if (!(wb > 0) && !(w > 0) && !(wr > 0) && !f) continue;     // nothing to score
        const noise = variety * gumbelAt(prefix, key);
        // The three weights are usually equal (no recency factor applies), so their logs are shared.
        const lw = w > 0 ? Math.log(w) : -Infinity;
        const score = w > 0 ? lw + noise : -Infinity;
        if (f) req.trace.push({ key, w, wBase: wb, score, f });
        if (wb > 0) {
          const sb = (wb === w ? lw : Math.log(wb)) + noise;
          if (sb > baseScore) { base = key; baseScore = sb; }
        }
        if (wr > 0) {
          const sr = (wr === w ? lw : wr === wb ? Math.log(wb) : Math.log(wr)) + noise;
          if (sr > refScore) { ref = key; refScore = sr; }
        }
        if (!(w > 0)) continue;
        if (score > bestScore) {
          next = best; nextScore = bestScore; nextW = bestW;
          best = key; bestScore = score; bestW = w;
        } else if (score > nextScore) { next = key; nextScore = score; nextW = w; }
      }
      if (best === null) return null;
      if (!req.ref || ref === null) ref = best;
      if (req.avoid && best === req.avoid && next !== null) return { v: next, w: nextW, base, ref, avoided: best };
      return { v: best, w: bestW, base, ref };
    }

    return { pick, statics, weigh };
  }

  // Gumbel-max over a plain weight table (moods and themes): keys sorted, weights q6, ties → the smaller key.
  function pickWeighted(keys, weightOf, seed, trace) {
    let best = null, bestScore = -Infinity;
    for (const key of keys) {
      const w = N.q6(weightOf(key));
      const score = w > 0 ? Math.log(w) + R.gumbel(seed, key) : -Infinity;
      if (trace) trace.push({ key, w, score });
      if (w > 0 && score > bestScore) { best = key; bestScore = score; }
    }
    return best;
  }

  return {
    cutSeed, slotSeed, slotPrefix, slotSeedAt, segSeed, paramStream, saltOf, moodBias, seasonFactor, traitFit, createChooser, pickWeighted,
    gumbelPrefix, gumbelAt, paramPrefix,
    FACTORS: Object.freeze({ RECENT_PREV, RECENT_NEAR, SAME_FAMILY, ECHO, IMPACT, MOOD_FILTER_DEFAULT, FIT_FLOOR,
      MOOD_POWER, SEASON_ANY, SEASON_ANY_STRAY, SEASON_MATCH }),
  };
});
