/* 文字PVメーカー v2 — original work. What the AI may choose from: part, theme, mood, material, camera and recipe lists as prompt text (DESIGN §4.22.3; DESIGN_2_1 §3.13, §5.3, §5.10). */
MV.def('ai/catalog', ['core/doc', 'core/ease', 'core/curve', 'core/shot', 'core/recipe', 'i18n/t', 'i18n/strings'],
  (D, E, CV, SHOT, RC, T, STRINGS) => {
  'use strict';

  const CATALOG_KINDS = Object.freeze(['arrange', 'arrive', 'depart', 'dwell', 'ornament', 'ground']);
  const LINE_KINDS = Object.freeze(['arrange', 'arrive', 'depart', 'dwell']);
  const LYRIC_ROLES = Object.freeze(['lyric', 'focus']);
  const SEASONS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);
  const TAGS_SHOWN = 3;
  // `atmos` is not a registry kind: it lists the run-scope ornaments (the particles over the background of a segment).
  const PSEUDO = Object.freeze({ atmos: { kind: 'ornament', scope: 'run' } });

  function nameOf(registry, kind, key, lang) { return registry.label(kind, key, lang === 'en' ? 'en' : 'ja'); }

  // Parts that can stand on a lyric line. Title, interlude and outro compositions are left out: a line pin of one of
  // them would be skipped on every lyric cut.
  function servesLyrics(registry, kind, key) {
    if (!LINE_KINDS.includes(kind)) return true;
    const t = registry.traits(kind, key);
    return !!t && t.roles.some((r) => LYRIC_ROLES.includes(r));
  }

  // Keys of added definitions (materials, the user's pooled media): listed by materialsText and the [media] list.
  function isMine(registry, key) {
    return !!registry.extra && Object.prototype.hasOwnProperty.call(registry.extra, key);
  }

  // A pooled photo or video's derived ground (§11.5.9): its name is the file name on this device, which no prompt may
  // carry (§11.6.4), so no list names it; the [media] list offers the asset as 'asset:<n>' when the user allows it.
  // (mine.media is true for such a ground; a material's is the list of asset ids it uses, [] when none.)
  function isMedia(registry, key) {
    return isMine(registry, key) && !!registry.extra[key] && registry.extra[key].media === true;
  }

  // { kind: [{ key, name, tags (first 3), season }] }: the parts auto picks may use under the project's filters.
  // The season is left to the AI (every season is listed, marked). Kinds may include 'atmos' (run-scope ornaments).
  // Derived media grounds are never listed (isMedia). opts (the direct tool): { mine: false } leaves out materials too;
  // { cutOrnaments: true } lists only cut-scope ornaments under 'ornament' (the run-scope ones are the 'atmos' list).
  function catalog(registry, doc, kinds = CATALOG_KINDS, lang = 'ja', opts) {
    const o = opts || {};
    const out = {};
    for (const name of kinds) {
      const pseudo = PSEUDO[name] || null;
      const kind = pseudo ? pseudo.kind : name;
      const pool = { filters: doc.filters, season: 'any' };
      if (pseudo) pool.scope = pseudo.scope;
      else if (kind === 'ornament' && o.cutOrnaments) pool.scope = 'cut';
      out[name] = registry.pool(kind, pool)
        .filter((key) => servesLyrics(registry, kind, key) && !isMedia(registry, key) && (o.mine !== false || !isMine(registry, key)))
        .map((key) => {
          const def = registry.get(kind, key);
          return { key, name: nameOf(registry, kind, key, lang), tags: (def.tags || []).slice(0, TAGS_SHOWN), season: def.season || null };
        });
    }
    return out;
  }

  function entryText(x) {
    return x.key + '=' + x.name + (x.season ? '{' + x.season + '}' : '') + (x.tags.length ? '(' + x.tags.join('/') + ')' : '');
  }

  // One line per kind: `[kind] key=name{season}(tag/tag/tag) …`.
  function catalogText(cat) {
    return Object.keys(cat).map((kind) => '[' + kind + '] ' + cat[kind].map(entryText).join(' ')).join('\n');
  }

  // One line per theme: `key=name{season}(tags) light|dark`. With `doc`, themes its filters turn off are left out
  // (like the parts, the list is what auto picks may use; turned-off themes are listed among the parts turned off).
  function themesText(registry, lang = 'ja', doc = null) {
    const f = doc && doc.filters ? doc.filters.theme : null;
    const on = (key) => !f || !((Array.isArray(f.deny) && f.deny.includes(key)) || (Array.isArray(f.only) && !f.only.includes(key)));
    return registry.keys('theme').filter(on).map((key) => {
      const def = registry.get('theme', key);
      const x = { key, name: nameOf(registry, 'theme', key, lang), tags: (def.tags || []).slice(0, TAGS_SHOWN), season: def.season || null };
      return entryText(x) + ' ' + (def.dark ? 'dark' : 'light');
    }).join('\n');
  }

  // `key=name, key=name, …`.
  function moodsText(registry, lang = 'ja') {
    return registry.keys('mood').map((key) => key + '=' + nameOf(registry, 'mood', key, lang)).join(', ');
  }

  // Parts the user turned off (filters), as "kind.key" (so the AI can offer to allow them again).
  function offText(registry, doc) {
    const out = [];
    for (const kind of D.FILTER_KINDS) {
      const f = doc.filters[kind];
      if (!f) continue;
      for (const key of registry.keys(kind)) {
        if ((f.deny && f.deny.includes(key)) || (f.only && !f.only.includes(key))) out.push(kind + '.' + key);
      }
    }
    return out.join(' ');
  }

  // Season gate for AI picks: 'any' allows every part, 'none' only non-seasonal ones, a season its own parts too.
  function inSeason(def, season) {
    if (!def || !def.season) return true;
    if (!season || season === 'any') return true;
    return def.season === season;
  }

  // ---- v2.1: materials, camera, recipes (DESIGN_2_1 §5.3, §5.10) ---------------------------------------------------

  // The project's materials in the effective registry (media-derived grounds are left out: the [media] list shows
  // the assets themselves), one per line: `[mine] myMat3=桜吹雪 ornament/run{spring}(organic/soft)`. '' without any.
  function materialsText(registry, lang = 'ja') {
    if (typeof registry.mine !== 'function') return '';
    const out = [];
    for (const kind of RC.MAT_KINDS) {
      for (const key of registry.mine(kind)) {
        const def = registry.get(kind, key);
        if (!def || isMedia(registry, key)) continue;
        const where = kind === 'ornament' && def.scope === 'run' ? kind + '/run' : kind;
        const x = { key, name: nameOf(registry, kind, key, lang), tags: (def.tags || []).slice(0, TAGS_SHOWN), season: def.season || null };
        out.push('[mine] ' + x.key + '=' + x.name + ' ' + where + (x.season ? '{' + x.season + '}' : '')
          + (x.tags.length ? '(' + x.tags.join('/') + ')' : ''));
      }
    }
    return out.join('\n');
  }

  function textsOf(lang) { return T.createT(lang === 'en' ? 'en' : 'ja', STRINGS, null, { strict: false }); }

  // The camera vocabulary of the direct tool: shot presets with their blurbs, the move words of a custom shot, rig
  // presets, curve presets and ease names. Names and blurbs are in the UI language; keys are what the AI answers.
  function cameraText(lang = 'ja') {
    const t = textsOf(lang);
    const shots = SHOT.SHOT_KEYS.map((k) => k + '=' + t('shot.' + k) + ': ' + t('shot.blurb.' + k)).join('; ');
    const rigs = SHOT.RIG_KEYS.map((k) => k + '=' + t('rig.' + k)).join(', ');
    const curves = CV.PRESET_KEYS.map((k) => k + '=' + t('curve.' + k)).join(', ');
    return [
      '[shots] ' + shots + '; none=' + t('shot.none'),
      '[custom shot] move: ' + SHOT.MOVES.join(' ') + ' · focus: ' + SHOT.FOCI.join(' ') + ' · timing: ' + SHOT.TIMINGS.join(' '),
      '[rigs] ' + rigs + ', none=' + t('rig.none'),
      '[curves] ' + curves,
      '[eases] ' + E.EASES.join(' '),
    ].join('\n');
  }

  // What a material recipe may hold, generated from core/recipe (so the prompt and the validator cannot drift apart).
  // At most 2,000 characters with or without the media paragraph (ai_recipe.test.js asserts both).
  function recipeText(opts) {
    const media = !!(opts && opts.media);
    const L = RC.LIMITS;
    const j = (list) => list.join(' ');
    const prims = RC.PRIMS.filter((p) => p !== 'media');
    const lines = [
      'Materials (data, never code). kind: ' + j(RC.MAT_KINDS) + '. Variant: base = an existing part of the kind (not a '
        + 'material) + params [{name,value}] (arrive/depart: + dur each curve order); arrange and seam: variants only. '
        + 'Else base "" and build it:',
      '- parts: up to 2 existing parts of the kind with params;',
      '- ornament: layers ≤' + L.layers.ornament + ', scope cut|run (run = atmosphere); ground: layers ≤' + L.layers.ground
        + ', the first a fill, or a part;',
      '- arrive/depart: unit ' + j(RC.UNITS) + ', order, dur, each (s), curve, tracks [{col,from,to}] (arrive ends at '
        + 'rest, depart starts there); col ' + j(RC.MOTION_COLS) + ';',
      '- dwell/lens: osc [{col,amp,hz,wave,phase}] ≤' + L.osc + '; dwell col ' + j(RC.OSC_COLS_DWELL) + '; lens col '
        + j(RC.OSC_COLS_LENS) + '; wave sine tri noise beat; phase ' + j(RC.PHASES) + ' word;',
      '- filter: 1-2 filter parts.',
      'Layer: prim ' + j(prims) + (media ? ' media' : '') + '; shape ' + j(RC.SHAPES) + '; glyph ' + j(RC.GLYPHS)
        + '; inks ≤4 palette names or #RRGGBB; layer ' + j(RC.LAYERS.ornament) + ' (ground: ' + j(RC.LAYERS.ground)
        + '); anchor ' + j(RC.ANCHORS) + '; x y -0.5..0.5; spread 0-2; sizeMin sizeMax (of the short side); count; dir '
        + '(deg) speed (short sides/s) sway swayHz spin; burst ' + j(RC.BURSTS) + '; move none ' + j(RC.WAVES)
        + ' on moveWhat ' + j(RC.MOVE_WHAT) + ' with moveAmp moveHz; appear always ' + j(RC.APPEAR_AT) + ' with draw '
        + j(RC.DRAWS) + '; style (frame) ' + j(RC.FRAME_STYLES) + '; pattern ' + j(RC.PATTERNS)
        + '; stops (fill) "ink@0" "#F7E3EA@1", angle.',
      'Limits: ≤' + L.particles + ' particles, ≤' + L.shapesPerLayer + ' shapes a layer, hz ≤' + L.hz[1] + ', speed ≤'
        + L.speed[1] + '; a big layer never blinks (no alpha on the beat).',
      'knobs: ' + j(RC.KNOB_WHATS) + ' (≤' + L.knobs.ai + '). use: slot, s (brief, -1 = all), lines ([] = all), cuts; or '
        + 'write "mat:<name>" in a field.',
    ];
    if (media) {
      lines.push('media layer: media "" = a picture the user picks, or "asset:<n>" of [media]; ≤' + L.media.layers
        + ', ornament and ground only.');
    }
    return lines.join('\n');
  }

  return {
    CATALOG_KINDS, LINE_KINDS, SEASONS, catalog, catalogText, themesText, moodsText, offText, inSeason, servesLyrics,
    materialsText, cameraText, recipeText,
  };
});
