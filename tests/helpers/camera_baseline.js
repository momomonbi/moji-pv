/* 文字PVメーカー v2 — original work. Fixed layout pool for statistical camera/planner calibrations. */
'use strict';

// Statistical floors were measured over these original 33 arrangements. Adding layouts changes the distribution
// of gentle/still/readable cuts even while the camera and chooser formulas stay identical. Structural tests must
// use the current catalog; this fixture is only for assertions tied to the calibrated sample distribution.
const ARRANGE_KEYS = Object.freeze(['breathMark', 'burstBloom', 'centerAnchor', 'confettiWords', 'cornerNote',
  'creditFold', 'diptychSplit', 'echoStack', 'edgeBleed', 'giantWhisper', 'gridMosaic', 'haloRing', 'hangingTags',
  'harmonicString', 'kineticShapes', 'lightMotes', 'magazineHead', 'neonWave', 'peakBars', 'pillarColumns', 'polarWave',
  'ridgeLines', 'ringPulse', 'sidebarIndex', 'slantBand', 'soundHorizon', 'spineColumn', 'stairStep', 'tickerMarquee',
  'tileRipple', 'tiltedCard', 'titlePlate', 'warpField']);
const keys = new Set(ARRANGE_KEYS);

// Accept either the loaded MV or core/registry, following corpus.stubRegistry's helper convention. Every other
// kind and the original definitions keep their supplied metadata, so only the expanded layout pool is excluded.
function originalLayouts(MVorRegistry, registry) {
  const REG = typeof MVorRegistry.use === 'function' ? MVorRegistry.use('core/registry') : MVorRegistry;
  for (const key of ARRANGE_KEYS) {
    if (!registry.get('arrange', key)) throw new Error('camera baseline: missing original layout ' + key);
  }
  return REG.createRegistry(registry.all().filter((d) => d.kind !== 'arrange' || keys.has(d.key)));
}

module.exports = { ARRANGE_KEYS, originalLayouts };
