/* 文字PVメーカー v2 — original work. Calm moods: quiet hush and dreamy haze (DESIGN §5.11). */
MV.def('parts/mood/calm', ['parts/kit'], (K) => [
  K.mood({
    key: 'quietHush', fallback: true,
    label: { ja: '静けさ', en: 'Hush' },
    blurb: { ja: '余白を広く取り、ゆっくり静かに見せる。', en: 'Wide margins and slow, quiet motion.' },
    tagBias: { soft: 1.8, slow: 1.6, minimal: 1.5, organic: 1.3, literary: 1.3, airy: 1.2,
      fast: 0.3, digital: 0.25, busy: 0.4, hard: 0.4, playful: 0.6, bold: 0.6, bright: 0.8 },
    amounts: { motion: 0.3, glitch: 0, chroma: 0.05, ornament: 0.35, density: 0.3, texture: 0.5,
      groundSwitch: 0.2, flash: 0, shake: 0.05, camera: 0.3, pace: 0.3 },
    themes: { sumiWashi: 2, frostGlass: 1.5, mossStone: 1.4, snowLantern: 1.3, monoPress: 1.2 },
    pace: { seam: 0.35, focus: 0.3 },
    filters: { grainFilm: 0.6, edgeShade: 0.7, softVeil: 0.2 },
    variety: 0.8,
    keywords: ['calm', 'quiet', 'ballad', '静か', '穏やか', 'しっとり', 'バラード'],
  }),

  K.mood({
    key: 'dreamHaze',
    label: { ja: '霞', en: 'Haze' },
    blurb: { ja: 'やわらかな光と霞の中を漂うように。', en: 'Drifting through soft light and haze.' },
    tagBias: { airy: 1.8, soft: 1.6, wet: 1.4, organic: 1.3, slow: 1.2, bright: 1.1,
      hard: 0.4, digital: 0.4, busy: 0.6, fast: 0.7, bold: 0.7, serious: 0.8, retro: 0.8 },
    amounts: { motion: 0.35, glitch: 0.05, chroma: 0.2, ornament: 0.5, density: 0.3, texture: 0.45,
      groundSwitch: 0.3, flash: 0.15, shake: 0, camera: 0.4, pace: 0.35 },
    themes: { frostGlass: 1.5, sakuraFog: 1.5, tidePool: 1.3, sodaFloat: 1.1 },
    pace: { seam: 0.5, focus: 0.3 },
    filters: { glowSpill: 0.7, softVeil: 0.6, amberSpill: 0.5 },
    variety: 0.9,
    keywords: ['dreamy', 'ambient', '浮遊', '幻想'],
  }),
]);
