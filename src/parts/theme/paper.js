/* 文字PVメーカー v2 — original work. Themes of paper and print: washi, letterpress, risograph, cyanotype (DESIGN §5.10). */
MV.def('parts/theme/paper', ['parts/kit'], (K) => [
  K.theme({
    key: 'sumiWashi', fallback: true,
    label: { ja: '墨と和紙', en: 'Sumi & washi' },
    blurb: { ja: '生成りの和紙に墨の黒、差し色は朱。', en: 'Warm washi paper with sumi black and a vermilion accent.' },
    tags: ['organic', 'literary', 'soft'], season: null, dark: false,
    swatch: { ground: '#EFE9DC', ground2: '#E2D9C6', ink: '#1C1A17', accent: '#B8322A',
      shiftA: '#3E6E8C', shiftB: '#C9A15B', muted: '#8C8577' },
    faces: {
      display: { ja: 'Yuji Syuku', latin: 'Fraunces', weight: 400, flavor: 'brush' },
      serif: { ja: 'Shippori Mincho B1', latin: 'Cormorant Garamond', weight: 600, flavor: 'mincho' },
      body: { ja: 'Zen Kaku Gothic New', latin: 'Inter', weight: 500, flavor: 'gothic' },
    },
    style: 'plain',
    texture: 'paperTooth',
    prefer: {
      ground: { washiFiber: 3, flatFill: 1.5 },
      ornament: { hankoSeal: 1.6, bigBrackets: 1.3 },
      filter: { grainFilm: 2 },
    },
  }),

  K.theme({
    key: 'monoPress',
    label: { ja: '活版', en: 'Mono press' },
    blurb: { ja: '白い紙に黒一色と朱、活版印刷の端正な誌面。', en: 'Letterpress black and red on white paper, crisp and exact.' },
    tags: ['serious', 'literary', 'minimal'], season: null, dark: false,
    swatch: { ground: '#F4F1EA', ground2: '#E6E1D6', ink: '#111111', accent: '#D6281E',
      shiftA: '#555555', shiftB: '#1E5AA8', muted: '#8A8680' },
    faces: {
      display: { ja: 'Shippori Mincho B1', latin: 'Bodoni Moda', weight: 800, flavor: 'mincho' },
      serif: { ja: 'Zen Old Mincho', latin: 'Libre Baskerville', weight: 700, flavor: 'mincho' },
      body: { ja: 'Noto Sans JP', latin: 'Work Sans', weight: 500, flavor: 'gothic' },
    },
    style: 'plain',
    texture: 'paperTooth',
    prefer: {
      arrange: { magazineHead: 1.5 },
      ground: { flatFill: 2, gridPaper: 1.4 },
      ornament: { underSweep: 1.5, hankoSeal: 1.4, cornerTicks: 1.3 },
    },
  }),

  K.theme({
    key: 'risoPink',
    label: { ja: 'リソ刷り', en: 'Riso pink' },
    blurb: { ja: '生成りの紙に蛍光ピンクと青緑、少しずれた孔版の刷り色。', en: 'Risograph pink and teal on cream paper, slightly off register.' },
    tags: ['retro', 'playful', 'bold'], season: null, dark: false,
    swatch: { ground: '#F7EFE4', ground2: '#F1DCCF', ink: '#2B2A6B', accent: '#E8337F',
      shiftA: '#1F9E89', shiftB: '#FFD23F', muted: '#9B8FA8' },
    faces: {
      display: { ja: 'RocknRoll One', latin: 'Bungee', weight: 400, flavor: 'heavy' },
      serif: { ja: 'Kaisei Tokumin', latin: 'Bodoni Moda', weight: 700, flavor: 'mincho' },
      body: { ja: 'M PLUS 1p', latin: 'Space Grotesk', weight: 500, flavor: 'gothic' },
    },
    style: 'duo',
    texture: 'dotScreen',
    prefer: {
      ground: { halftoneSun: 2, stripeShift: 1.4 },
      ornament: { tapeStrip: 1.6, pinDotBoard: 1.3 },
      filter: { duoTone: 1.6 },
    },
  }),

  K.theme({
    key: 'cyanPrint',
    label: { ja: '青写真', en: 'Cyan print' },
    blurb: { ja: '青焼きの紺地に白い線、図面のような方眼と印。', en: 'Blueprint navy with white lines, like a technical drawing.' },
    tags: ['serious', 'retro', 'minimal'], season: null, dark: true,
    swatch: { ground: '#0E3A6B', ground2: '#164B85', ink: '#EAF2FA', accent: '#F2C14E',
      shiftA: '#5FA8E8', shiftB: '#9FD3FF', muted: '#7FA0C4' },
    faces: {
      display: { ja: 'Shippori Antique', latin: 'Space Grotesk', weight: 400, flavor: 'antique' },
      serif: { ja: 'Hina Mincho', latin: 'Instrument Serif', weight: 400, flavor: 'mincho' },
      body: { ja: 'BIZ UDPGothic', latin: 'IBM Plex Sans', weight: 400, flavor: 'gothic' },
    },
    style: 'plain',
    texture: 'paperTooth',
    prefer: {
      ground: { gridPaper: 2.2 },
      ornament: { crossHair: 1.6, cornerTicks: 1.5, serialMark: 1.3 },
      filter: { rasterLines: 1.2 },
    },
  }),
]);
