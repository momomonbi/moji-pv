/* 文字PVメーカー v2 — original work. The work-level look: season, mood, theme, amounts, palette, faces, texture (DESIGN §4.16.3). */
MV.def('planner/look', ['core/hash', 'core/color', 'core/num', 'core/schema', 'core/pins', 'core/lyrics', 'audio/digest',
  'engine/text/faces', 'planner/choose', 'planner/params'], (H, C, N, S, PINS, LY, DG, FACES, CH, PA) => {
  'use strict';

  const SEASONS = Object.freeze(['any', 'none', 'spring', 'summer', 'autumn', 'winter']);
  // §4.16.3 keyword lists (Latin words match case-insensitively).
  const SEASON_WORDS = Object.freeze({
    spring: ['春', '桜', 'さくら', '花びら', '卒業', 'blossom', 'cherry'],
    summer: ['夏', '花火', '蝉', '海', '夕立', 'summer', 'fireworks'],
    autumn: ['秋', '紅葉', '落ち葉', '月見', 'autumn', 'maple'],
    winter: ['冬', '雪', '白い息', '聖夜', 'winter', 'snow'],
  });
  // A theme the mood does not list. 0.4 gave the 11–12 unlisted themes together as much weight as the listed ones (a
  // mood's own themes in 51–64 % of looks: quietHush on cicadaNoon, popFizz on snowLantern); 0.15 gives 74–83 %.
  const THEME_DEFAULT_WEIGHT = 0.15;
  const KEYWORD_BOOST = 3;
  const ENERGY_HIGH = 0.6, ENERGY_LOW = 0.35, ENERGY_BOOST = 1.5;
  const IMPACT_LINES = 3, IMPACT_BOOST = 1.3;
  const INK_CONTRAST = 4.5, ACCENT_CONTRAST = 3;
  const CHROMA_GREEN = '#00B140', CHROMA_NEAR = 40, CHROMA_TURN = 60;
  // ParamSpec-like specs of the work-scope slots (§3.4.1); planner/fields shows them as the field schema.
  const LOOK_SPECS = Object.freeze({
    season: { type: 'enum', of: SEASONS },
    amount: { type: 'num', min: 0, max: 1, step: 0.01 },
    color: { type: 'color' },
    family: { type: 'text', max: 60 },
    weight: { type: 'int', min: 100, max: 900, step: 100 },
    bpm: { type: 'num', min: 40, max: 240, step: 0.01 },
    beatOffset: { type: 'num', min: -30, max: 30, step: 0.001, unit: 's' },
    readRate: { type: 'num', min: 3, max: 14, step: 0.1 },
    length: { type: 'num', min: 0.5, max: 36000, step: 0.001, unit: 's' },
    titleCard: { type: 'bool' },
  });

  const WORK_AT = Object.freeze({ cutKey: null, pinCutKey: null, lineId: null });

  // --- song facts shared by the mood auto and previewMood -----------------------------------------------------

  function lyricRows(sheet) { return sheet.rows.filter((r) => r.kind === 'lyric' && r.text !== ''); }

  function songEnergy(env) {
    if (!env || env.loud.length === 0) return null;
    let sum = 0;
    for (let i = 0; i < env.loud.length; i++) sum += env.loud[i];
    return sum / env.loud.length;
  }

  function songWords(song) {
    const info = song && song.info;
    if (!info) return '';
    return (String(info.mood || '') + '\n' + String(info.summary || '')).toLowerCase();
  }

  function moodFacts(doc, sheet, env) {
    return {
      energy: songEnergy(env),
      words: songWords(doc.song),
      impacts: lyricRows(sheet).filter((r) => r.impact).length,
    };
  }

  // Mood weights (§4.16.3): 1, ×3 per keyword found in song.info.mood/summary, ×1.5 for energetic or calm moods
  // matching the song's mean loudness, ×1.3 for flashy moods when the lyrics have ≥ 3 impact marks.
  function moodWeight(def, facts) {
    let w = 1;
    for (const kw of def.keywords || []) {
      if (facts.words && facts.words.includes(String(kw).toLowerCase())) w *= KEYWORD_BOOST;
    }
    const a = def.amounts;
    if (facts.energy !== null && facts.energy > ENERGY_HIGH && a.motion >= 0.6) w *= ENERGY_BOOST;
    if (facts.energy !== null && facts.energy < ENERGY_LOW && a.motion <= 0.4) w *= ENERGY_BOOST;
    if (facts.impacts >= IMPACT_LINES && a.flash >= 0.5) w *= IMPACT_BOOST;
    return w;
  }

  // The moods an automatic pick may choose: every registered mood except retired ones (pool: false, §4.18.1, §7.1.9).
  function moodPool(registry) { return registry.pool('mood', {}); }

  function autoMood(registry, facts, moodSeed, salt, trace) {
    const seed = salt ? H.hash32('mood', moodSeed, salt) : H.hash32('mood', moodSeed);
    const keys = moodPool(registry);
    const v = CH.pickWeighted(keys, (key) => moodWeight(registry.get('mood', key), facts), seed, trace);
    return v || registry.fallback('mood');
  }

  // --- season ------------------------------------------------------------------------------------------------

  function countHits(text, word) {
    let n = 0;
    for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + word.length)) n++;
    return n;
  }

  // { v, word, hits }: a season wins with ≥ 2 hits and at least twice the hits of any other season.
  function scanSeason(sheet) {
    const text = lyricRows(sheet).map((r) => r.text).join('\n').toLowerCase();
    const hits = {};
    const top = {};
    for (const season of Object.keys(SEASON_WORDS)) {
      hits[season] = 0;
      let best = 0;
      for (const word of SEASON_WORDS[season]) {
        const n = countHits(text, word.toLowerCase());
        hits[season] += n;
        if (n > best) { best = n; top[season] = word; }
      }
    }
    const order = Object.keys(hits).sort((a, b) => hits[b] - hits[a] || (a < b ? -1 : 1));
    const first = order[0], second = order[1];
    if (hits[first] >= 2 && hits[first] >= 2 * hits[second]) return { v: first, word: top[first], hits: hits[first] };
    return { v: 'any', word: null, hits: 0 };
  }

  // --- palette -----------------------------------------------------------------------------------------------

  function toHsl(hex) {
    const { r, g, b } = C.parse(hex);
    const x = r / 255, y = g / 255, z = b / 255;
    const max = Math.max(x, y, z), min = Math.min(x, y, z);
    const l = (max + min) / 2;
    const d = max - min;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return { h: C.hueDeg(hex), s, l };
  }

  function fromHsl(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = N.wrap(h, 0, 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    const [r1, g1, b1] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c]
      : hp < 5 ? [x, 0, c] : [c, 0, x];
    const m = l - c / 2;
    const to = (v) => Math.round(N.clamp(v + m) * 255);
    return C.toHex({ r: to(r1), g: to(g1), b: to(b1) });
  }

  // Grey with the same WCAG luminance.
  function greyOf(hex) {
    const L = C.luminance(hex);
    const v = L <= 0.0031308 ? 12.92 * L : 1.055 * Math.pow(L, 1 / 2.4) - 0.055;
    const c = Math.round(N.clamp(v) * 255);
    return C.toHex({ r: c, g: c, b: c });
  }

  // Moves a color whose hue is within 40° of the green screen by 60° away from it (greys are left alone).
  function awayFromGreen(hex) {
    const hsl = toHsl(hex);
    if (hsl.s === 0 || C.hueDistance(hex, CHROMA_GREEN) >= CHROMA_NEAR) return hex;
    const green = C.hueDeg(CHROMA_GREEN);
    const dir = N.wrap(hsl.h - green, -180, 180) >= 0 ? 1 : -1;
    return fromHsl(hsl.h + dir * CHROMA_TURN, hsl.s, hsl.l);
  }

  // theme swatch → work:color.* pins → contrast fit of the automatic ink/accent → backdrop rules (§4.16.3).
  // Pinned colors are kept exactly as the user chose them; the inspector warns about their contrast.
  function palette(theme, ix, backdrop, warn) {
    const pal = {};
    const pinned = {};
    for (const token of C.TOKENS) {
      const pin = PA.resolvePin(ix, WORK_AT, 'color.' + token, PA.acceptSpec(LOOK_SPECS.color), warn);
      pal[token] = pin ? pin.v : String(theme.swatch[token]).toUpperCase();
      pinned[token] = !!pin;
    }
    if (!pinned.ink) pal.ink = C.fitContrast(pal.ink, pal.ground, INK_CONTRAST);
    if (!pinned.accent) pal.accent = C.fitContrast(pal.accent, pal.ground, ACCENT_CONTRAST);
    if (backdrop === 'black') {
      pal.ground = '#000000';
      pal.ink = '#FFFFFF';
      pal.accent = '#FFFFFF';
      pal.shiftA = greyOf(pal.shiftA);
      pal.shiftB = greyOf(pal.shiftB);
    } else if (backdrop === 'chroma') {
      pal.ground = CHROMA_GREEN;
      pal.ink = awayFromGreen(pal.ink);
      pal.accent = awayFromGreen(pal.accent);
    }
    return pal;
  }

  // The amounts that gate a kind's automatic pool (registry.pool; §4.16.4 gate). Under the green-screen backdrop a
  // transition gated on `flash` (whiteFlash) washes the whole frame white, which turns the key colour pale green on
  // its way and keys as a half-transparent green veil; it leaves the automatic pool there (a pin still works). The
  // flash-gated screen effects are not alphaSafe, so the renderer skips them under chroma anyway (§4.19.4).
  function gateAmounts(amounts, backdrop, kind) {
    const keyed = kind === 'seam' && backdrop === 'chroma' && amounts.flash > 0;
    return keyed ? Object.assign({}, amounts, { flash: 0 }) : amounts;
  }

  // --- faces ------------------------------------------------------------------------------------------------

  // §4.16.3 faces = engine/text/faces.resolveFaces(theme, face pins, scripts used), in the Plan as plain JSON
  // { role: { script: { family, weight } } } (the §3.12 shape; FontRef.toJSON), keys sorted. The weights are the ones
  // the family serves (resolveFaces snaps them); a work weight pin applies to every script of its role.
  function faces(theme, ix, scriptsUsed) {
    const refs = FACES.resolveFaces(theme, ix.work, [...scriptsUsed]);
    const out = {};
    for (const role of Object.keys(refs).sort()) {
      const entry = {};
      for (const script of Object.keys(refs[role]).sort()) {
        const ref = refs[role][script];
        entry[script] = { family: ref.family, weight: ref.weight };
      }
      out[role] = entry;
    }
    return out;
  }

  // --- texture -----------------------------------------------------------------------------------------------

  function textureOk(registry, key) {
    const def = registry.get('filter', key);
    return !!def && def.texture === true;
  }

  function allowedByFilters(filters, kind, key) {
    const f = filters && filters[kind];
    if (!f) return true;
    if (Array.isArray(f.only) && !f.only.includes(key)) return false;
    if (Array.isArray(f.deny) && f.deny.includes(key)) return false;
    return true;
  }

  // work:texture pin (a texture filter or 'none'), else the theme's texture while amount.texture > 0 (its amount
  // param = amount.texture). null = no texture.
  function texture(ctx, theme, amounts, moodForParams) {
    const { registry, ix, doc, warn } = ctx;
    const pin = PA.resolvePin(ix, WORK_AT, 'texture',
      (v) => (v === 'none' || (typeof v === 'string' && textureOk(registry, v)) ? { v } : { bad: true }), warn);
    let key = null, from = 'auto', by;
    if (pin) {
      if (pin.v === 'none') return null;
      key = pin.v; from = pin.from; by = pin.by;
    } else {
      const want = theme.texture;
      if (!(amounts.texture > 0) || typeof want !== 'string' || want === 'none' || !textureOk(registry, want)) return null;
      if (!allowedByFilters(doc.filters, 'filter', want)) return null;
      key = want;
    }
    const def = registry.get('filter', key);
    const seed = H.hash32('texture', doc.look.moodSeed, CH.saltOf(doc.salts, 'work:texture'));
    const { p, pfrom } = PA.resolveParams(def, 'texture', null, WORK_AT, ix, {
      registry, partKind: 'filter', seed, salts: doc.salts, warn, f: null,
      look: { amounts, mood: moodForParams, bpm: ctx.bpm }, fixed: { amount: amounts.texture },
    });
    const d = { v: key, p, from };
    if (by) d.by = by;
    if (pfrom) d.pfrom = pfrom;
    return d;
  }

  // --- the look ----------------------------------------------------------------------------------------------

  function decision(v, pin) {
    return pin ? { v, from: pin.from, by: pin.by } : { v, from: 'auto' };
  }

  function partPin(ctx, kind, slot) {
    const { registry, ix, warn } = ctx;
    return PA.resolvePin(ix, WORK_AT, slot,
      (v) => (typeof v === 'string' && registry.has(kind, v) ? { v } : { bad: true }), warn);
  }

  function pickTheme(ctx, mood, season) {
    const { registry, doc, warn } = ctx;
    const pool = registry.pool('theme', { season, filters: doc.filters });
    const salt = CH.saltOf(doc.salts, 'work:theme');
    const seed = salt ? H.hash32('theme', doc.look.moodSeed, salt) : H.hash32('theme', doc.look.moodSeed);
    const weights = (mood && mood.themes) || {};
    const v = CH.pickWeighted(pool, (key) => {
      const base = typeof weights[key] === 'number' ? weights[key] : THEME_DEFAULT_WEIGHT;
      return base * CH.seasonFactor(registry.get('theme', key).season, season);
    }, seed, null);
    if (v) return v;
    warn({ code: 'pool-empty', path: 'work:theme' });
    return registry.fallback('theme');
  }

  function pinWarnings(ctx, kind, key, pin, season) {
    const def = ctx.registry.get(kind, key);
    if (!allowedByFilters(ctx.doc.filters, kind, key)) ctx.warn({ code: 'pin-filtered', path: pin.at });
    if (def && def.season && season !== 'any' && def.season !== season) ctx.warn({ code: 'pin-off-season', path: pin.at });
  }

  // resolveLook(ctx, sheet, scriptsUsed) → { plan: Plan.look, mood, theme, season, seasonWord, amounts, variety }
  // ctx = { doc, registry, ix, env, bpm, warn }
  function resolveLook(ctx, sheet, scriptsUsed) {
    const { doc, registry, ix, warn } = ctx;
    const seasonPin = PA.resolvePin(ix, WORK_AT, 'season', PA.acceptSpec(LOOK_SPECS.season), warn);
    const scanned = scanSeason(sheet);
    const season = seasonPin ? seasonPin.v : scanned.v;

    const moodPin = partPin(ctx, 'mood', 'mood');
    const moodKey = moodPin ? moodPin.v
      : autoMood(registry, moodFacts(doc, sheet, ctx.env), doc.look.moodSeed, CH.saltOf(doc.salts, 'work:mood'), null);
    const mood = registry.get('mood', moodKey);

    const themePin = partPin(ctx, 'theme', 'theme');
    if (themePin) pinWarnings(ctx, 'theme', themePin.v, themePin, season);
    const themeKey = themePin ? themePin.v : pickTheme(ctx, mood, season);
    const theme = registry.get('theme', themeKey);

    const amounts = {};
    const amountsFrom = {};
    for (const k of S.AMOUNT_KEYS) {
      const pin = PA.resolvePin(ix, WORK_AT, 'amount.' + k, PA.acceptSpec(LOOK_SPECS.amount), warn);
      amounts[k] = pin ? pin.v : mood.amounts[k];
      if (pin) amountsFrom[k] = pin.from;
    }

    const look = {
      mood: decision(moodKey, moodPin),
      theme: decision(themeKey, themePin),
      season: decision(season, seasonPin),
      amounts,
      amountsFrom,
      palette: palette(theme, ix, doc.look.backdrop, warn),
      faces: faces(theme, ix, scriptsUsed),
      texture: texture(ctx, theme, amounts, mood),
      backdrop: doc.look.backdrop,
    };
    return {
      plan: look, mood, theme, season, seasonWord: seasonPin ? null : scanned.word, amounts,
      variety: typeof mood.variety === 'number' ? mood.variety : 1,
    };
  }

  // previewMood(doc, moodSeed, { registry }?) → the auto mood key for that moodSeed (pins ignored), as plan() would
  // pick it. Without a registry it uses the one of the most recent plan() call (the おまかせ command has none).
  let lastRegistry = null;
  function rememberRegistry(registry) { lastRegistry = registry; }
  function currentRegistry() { return lastRegistry; }

  function previewMood(doc, moodSeed, opts) {
    const registry = (opts && opts.registry) || lastRegistry;
    if (!registry) throw new Error('planner/look.previewMood: no registry (call plan() first or pass { registry })');
    const sheet = LY.parseSheet(doc.sheet.rows);
    const env = doc.song && doc.song.digest ? envOf(doc.song.digest) : null;
    return autoMood(registry, moodFacts(doc, sheet, env), moodSeed, CH.saltOf(doc.salts, 'work:mood'), null);
  }

  // The loudness envelope of a digest; cached by the digest's text, so re-planning never decodes twice.
  const envCache = new Map();
  function envOf(digest) {
    if (!digest || typeof digest.loud !== 'string' || !(digest.hz > 0)) return null;
    const id = digest.hz + ':' + digest.loud;
    let env = envCache.get(id);
    if (env === undefined) {
      try { env = DG.envFromDigest(digest); } catch (e) { env = null; }
      if (envCache.size >= 4) envCache.clear();
      envCache.set(id, env);
    }
    return env;
  }

  return {
    SEASONS, SEASON_WORDS, LOOK_SPECS, resolveLook, previewMood, rememberRegistry, currentRegistry, envOf, scanSeason,
    moodWeight, moodFacts, autoMood, moodPool, palette, faces, gateAmounts, WORK_AT, THEME_DEFAULT_WEIGHT,
  };
});
