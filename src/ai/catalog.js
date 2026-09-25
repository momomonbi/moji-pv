/* 文字PVメーカー v2 — original work. What the AI may choose from: part, theme and mood lists as prompt text (DESIGN §4.22.3). */
MV.def('ai/catalog', ['core/doc'], (D) => {
  'use strict';

  const CATALOG_KINDS = Object.freeze(['arrange', 'arrive', 'depart', 'dwell', 'ornament', 'ground']);
  const LINE_KINDS = Object.freeze(['arrange', 'arrive', 'depart', 'dwell']);
  const LYRIC_ROLES = Object.freeze(['lyric', 'focus']);
  const SEASONS = Object.freeze(['spring', 'summer', 'autumn', 'winter']);
  const TAGS_SHOWN = 3;

  function nameOf(registry, kind, key, lang) { return registry.label(kind, key, lang === 'en' ? 'en' : 'ja'); }

  // Parts that can stand on a lyric line. Title, interlude and outro compositions are left out: a line pin of one of
  // them would be skipped on every lyric cut.
  function servesLyrics(registry, kind, key) {
    if (!LINE_KINDS.includes(kind)) return true;
    const t = registry.traits(kind, key);
    return !!t && t.roles.some((r) => LYRIC_ROLES.includes(r));
  }

  // { kind: [{ key, name, tags (first 3), season }] }: the parts auto picks may use under the project's filters.
  // The season is left to the AI (every season is listed, marked).
  function catalog(registry, doc, kinds = CATALOG_KINDS, lang = 'ja') {
    const out = {};
    for (const kind of kinds) {
      out[kind] = registry.pool(kind, { filters: doc.filters, season: 'any' })
        .filter((key) => servesLyrics(registry, kind, key))
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

  return { CATALOG_KINDS, LINE_KINDS, SEASONS, catalog, catalogText, themesText, moodsText, offText, inSeason, servesLyrics };
});
