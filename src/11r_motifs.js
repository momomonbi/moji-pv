/* ============================================================
   文字PVメーカー — season motifs
   Parts whose picture belongs to one season (snow, cherry petals, fireworks, maple leaves …).
   project.season decides what random picks may use:
     'spring' | 'summer' | 'autumn' | 'winter'  -> other seasons' motifs are skipped
     'none'                                     -> every seasonal motif is skipped
     unset / 'any'                              -> no limit (the default)
   Applied through J.randomOk (11q_sets.js), so the planner, おまかせ and the style list all follow it.
   A per-line override can still use any part.
   ============================================================ */
(() => {
'use strict';
J.SEASONS = ['spring', 'summer', 'autumn', 'winter'];
J.MOTIF_SEASON = {
  decor: { snow: 'winter', petals: 'spring', hanabi: 'summer', fireflies: 'summer', momiji: 'autumn' },
  bg: { snowLayers: 'winter', fireworks: 'summer' },
  enter: { heatHaze: 'summer' },
  exit: { hazeOut: 'summer' },
  style: { sakura: 'spring' },
};
J.motifSeason = (g, k) => (J.MOTIF_SEASON[g] && J.MOTIF_SEASON[g][k]) || null;
J.seasonOk = (project, g, k) => {
  const s = project && project.season;
  if (!s || s === 'any') return true;
  const m = J.motifSeason(g, k);
  return !m || (s !== 'none' && m === s);
};
/* seasonal motifs a plan shows that do not belong to `season` ('none' = any seasonal motif) -> ['decor.snow', …] */
J.offSeasonMotifs = (plan, season) => {
  if (!season || season === 'any') return [];
  const bad = new Set();
  const check = (g, k) => { const m = J.motifSeason(g, k); if (m && (season === 'none' || m !== season)) bad.add(g + '.' + k); };
  check('style', plan.styleKey);
  for (const c of plan.cuts) {
    (c.decor || []).forEach(d => check('decor', d.id));
    check('bg', c.bg); check('enter', c.enter); check('exit', c.exit);
  }
  return [...bad].sort();
};
})();
