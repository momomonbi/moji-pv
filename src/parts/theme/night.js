/* 文字PVメーカー v2 — original work. Themes of lamps in the dark: night tram, embers, brass lamp (DESIGN §5.10). */
MV.def('parts/theme/night', ['parts/kit'], (K) => [
  K.theme({
    key: 'nightTram',
    label: { ja: '夜の路面電車', en: 'Night tram' },
    blurb: { ja: '夜の街の紺に琥珀の灯り、ネオンの青緑と桃色。', en: 'City-night navy with amber lamps and neon teal and pink.' },
    tags: ['dark', 'digital', 'retro'], season: null, dark: true,
    swatch: { ground: '#0F1420', ground2: '#1A2233', ink: '#F2EEE6', accent: '#FFB23E',
      shiftA: '#37C6D0', shiftB: '#E4507A', muted: '#6E7891' },
    faces: {
      display: { ja: 'Dela Gothic One', latin: 'Archivo Black', weight: 400, flavor: 'heavy' },
      serif: { ja: 'Zen Old Mincho', latin: 'Fraunces', weight: 700, flavor: 'mincho' },
      body: { ja: 'Zen Kaku Gothic New', latin: 'Inter', weight: 500, flavor: 'gothic' },
    },
    style: 'glow',
    texture: 'grainFilm',
    prefer: {
      ground: { neonHaze: 2, nightBokeh: 1.8 },
      ornament: { rainLines: 1.6 },
      filter: { glowSpill: 1.5, chromaSlip: 1.3 },
    },
  }),

  K.theme({
    key: 'emberGlow',
    label: { ja: '熾火', en: 'Ember glow' },
    blurb: { ja: '炭の黒に燃えるオレンジ、金色の火の粉。', en: 'Charcoal black with burning orange and golden sparks.' },
    tags: ['dark', 'bold', 'hard'], season: null, dark: true,
    swatch: { ground: '#140B08', ground2: '#2A1510', ink: '#FBEBD9', accent: '#FF6A2B',
      shiftA: '#FFC247', shiftB: '#B8325A', muted: '#8A6A5C' },
    faces: {
      display: { ja: 'Dela Gothic One', latin: 'Anton', weight: 400, flavor: 'heavy' },
      serif: { ja: 'Shippori Mincho B1', latin: 'Playfair Display', weight: 700, flavor: 'mincho' },
      body: { ja: 'Zen Kaku Gothic New', latin: 'Inter', weight: 500, flavor: 'gothic' },
    },
    style: 'shadow',
    texture: 'grainFilm',
    prefer: {
      depart: { burnOut: 1.5 },
      ground: { spotBeam: 1.8, nightBokeh: 1.3 },
      ornament: { sparkSpray: 1.8 },
      filter: { amberSpill: 1.5, glowSpill: 1.4 },
    },
  }),

  K.theme({
    key: 'brassLamp',
    label: { ja: '真鍮のランプ', en: 'Brass lamp' },
    blurb: { ja: '古い書斎の暗がりに真鍮の金、差し色は錆の赤。', en: 'A dim old study in brass gold, with a rust-red accent.' },
    tags: ['retro', 'serious', 'dark'], season: null, dark: true,
    swatch: { ground: '#1B1712', ground2: '#2A241B', ink: '#F3E7C9', accent: '#D4A94A',
      shiftA: '#7FA6A0', shiftB: '#B45A3C', muted: '#8B7D62' },
    faces: {
      display: { ja: 'Zen Antique Soft', latin: 'Abril Fatface', weight: 400, flavor: 'antique' },
      serif: { ja: 'Zen Old Mincho', latin: 'Bodoni Moda', weight: 700, flavor: 'mincho' },
      body: { ja: 'Zen Kaku Gothic Antique', latin: 'Josefin Sans', weight: 500, flavor: 'gothic' },
    },
    style: 'plain',
    texture: 'grainFilm',
    prefer: {
      ground: { spotBeam: 1.6, fogNoise: 1.3 },
      ornament: { hairFrame: 1.5, cornerTicks: 1.3 },
      filter: { amberSpill: 1.6, edgeShade: 1.3 },
    },
  }),
]);
