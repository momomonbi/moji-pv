/* 文字PVメーカー v2 — original work. Cool, clear themes of water, soda and glass (DESIGN §5.10). */
MV.def('parts/theme/glass', ['parts/kit'], (K) => [
  K.theme({
    key: 'sodaFloat',
    label: { ja: 'ソーダフロート', en: 'Soda float' },
    blurb: { ja: 'ミントの水色にチェリーの赤とレモンの黄。', en: 'Mint soda blue with cherry red and lemon yellow.' },
    tags: ['bright', 'playful', 'airy'], season: null, dark: false,
    swatch: { ground: '#DFF6F2', ground2: '#BFEDE6', ink: '#123047', accent: '#E83E62',
      shiftA: '#20B8C8', shiftB: '#FFC845', muted: '#6A8E99' },
    faces: {
      display: { ja: 'Mochiy Pop One', latin: 'Righteous', weight: 400, flavor: 'round' },
      serif: { ja: 'Kaisei Decol', latin: 'DM Serif Display', weight: 700, flavor: 'mincho' },
      body: { ja: 'M PLUS Rounded 1c', latin: 'Rubik', weight: 500, flavor: 'round' },
    },
    style: 'plain',
    texture: 'none',
    prefer: {
      ground: { skyGrade: 1.8, stripeShift: 1.5 },
      ornament: { bokehDots: 1.5, tapeStrip: 1.4 },
      filter: { glowSpill: 1.3 },
    },
  }),

  K.theme({
    key: 'frostGlass',
    label: { ja: '霜ガラス', en: 'Frost glass' },
    blurb: { ja: '曇りガラスの淡い青灰に、澄んだ青と藤色。', en: 'Frosted pale blue-grey with clear blue and wisteria.' },
    tags: ['airy', 'soft', 'minimal'], season: null, dark: false,
    swatch: { ground: '#E8EEF3', ground2: '#D5DFE8', ink: '#1B2A38', accent: '#3D7BD9',
      shiftA: '#7FC4E0', shiftB: '#C07BD9', muted: '#7D8C9A' },
    faces: {
      display: { ja: 'Murecho', latin: 'Unbounded', weight: 600, flavor: 'gothic' },
      serif: { ja: 'Hina Mincho', latin: 'Instrument Serif', weight: 400, flavor: 'mincho' },
      body: { ja: 'BIZ UDPGothic', latin: 'Inter', weight: 400, flavor: 'gothic' },
    },
    style: 'plain',
    texture: 'none',
    prefer: {
      ground: { skyGrade: 1.6, auroraVeil: 1.3 },
      ornament: { hairFrame: 1.3, orbitRing: 1.3 },
      filter: { softVeil: 1.6 },
    },
  }),

  K.theme({
    key: 'tidePool',
    label: { ja: '潮だまり', en: 'Tide pool' },
    blurb: { ja: '夜の海の深い青緑に、光る水色と珊瑚色。', en: 'Deep sea teal with glowing aqua and coral.' },
    tags: ['wet', 'airy', 'bright'], season: null, dark: true,
    swatch: { ground: '#062B30', ground2: '#0B3C42', ink: '#E6FBF7', accent: '#5EF2D6',
      shiftA: '#3AA0FF', shiftB: '#FF7B6B', muted: '#5E8C8A' },
    faces: {
      display: { ja: 'Zen Maru Gothic', latin: 'Syne', weight: 700, flavor: 'round' },
      serif: { ja: 'Shippori Mincho', latin: 'Fraunces', weight: 600, flavor: 'mincho' },
      body: { ja: 'M PLUS 1p', latin: 'Manrope', weight: 500, flavor: 'gothic' },
    },
    style: 'plain',
    texture: 'none',
    prefer: {
      ground: { tideBands: 2.2, nightBokeh: 1.3 },
      ornament: { bokehDots: 1.6, ripplePath: 1.4 },
      filter: { glowSpill: 1.4 },
    },
  }),
]);
