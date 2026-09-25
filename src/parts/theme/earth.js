/* 文字PVメーカー v2 — original work. Themes of stone and slate: moss on stone, a chalk board (DESIGN §5.10). */
MV.def('parts/theme/earth', ['parts/kit'], (K) => [
  K.theme({
    key: 'mossStone',
    label: { ja: '苔と石', en: 'Moss & stone' },
    blurb: { ja: '湿った苔と石の深緑に、若葉色の差し色。', en: 'Deep moss-and-stone green with a fresh leaf accent.' },
    tags: ['organic', 'slow', 'literary'], season: null, dark: true,
    swatch: { ground: '#2E3A2F', ground2: '#3C4A3B', ink: '#E9E4D4', accent: '#C7D66D',
      shiftA: '#7FB7A4', shiftB: '#D98C5F', muted: '#8C9683' },
    faces: {
      display: { ja: 'Zen Antique', latin: 'Cormorant Garamond', weight: 400, flavor: 'antique' },
      serif: { ja: 'Zen Old Mincho', latin: 'EB Garamond', weight: 600, flavor: 'mincho' },
      body: { ja: 'Zen Kaku Gothic New', latin: 'Work Sans', weight: 500, flavor: 'gothic' },
    },
    style: 'plain',
    texture: 'grainFilm',
    prefer: {
      ground: { fogNoise: 1.6, inkWash: 1.4 },
      ornament: { ripplePath: 1.3, hairFrame: 1.3 },
      filter: { edgeShade: 1.4 },
    },
  }),

  K.theme({
    key: 'chalkBoard',
    label: { ja: '黒板', en: 'Chalk board' },
    blurb: { ja: '深緑の黒板に白と黄色のチョーク書き。', en: 'A green slate with white and yellow chalk.' },
    tags: ['organic', 'playful', 'literary'], season: null, dark: true,
    swatch: { ground: '#1F2A26', ground2: '#28352F', ink: '#F1F1E8', accent: '#F4D35E',
      shiftA: '#8FD3C1', shiftB: '#F28C8C', muted: '#7E8C85' },
    faces: {
      display: { ja: 'Yomogi', latin: 'Caveat', weight: 400, flavor: 'brush' },
      serif: { ja: 'Klee One', latin: 'Lora', weight: 600, flavor: 'brush' },
      body: { ja: 'Zen Maru Gothic', latin: 'Nunito', weight: 500, flavor: 'round' },
    },
    style: 'plain',
    texture: 'dustSpecks',
    prefer: {
      ground: { flatFill: 1.6 },
      ornament: { ripplePath: 1.6, underSweep: 1.5, bigBrackets: 1.3 },
      filter: { softVeil: 1.3 },
    },
  }),
]);
