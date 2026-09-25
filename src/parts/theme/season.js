/* 文字PVメーカー v2 — original work. Seasonal themes, one per season; project.season keeps the others out (DESIGN §5.10, §3.8). */
MV.def('parts/theme/season', ['parts/kit'], (K) => {
  'use strict';

  // The season motifs of §5.5 / §5.6 (the parts whose picture belongs to a season). A seasonal theme is a season's
  // picture of its own, so it keeps the other seasons' motifs nearly out of its auto picks: with the project season
  // 'any' (no season words in the lyrics) the season gate lets every season in, and a spring haze with maple leaves,
  // fireworks or snow reads as a mistake. Pins still win; `project.season` still gates as before (§3.8).
  const MOTIFS = {
    spring: { ground: ['petalWash'], ornament: ['petalFall'] },
    summer: { ground: ['heatShimmer'], ornament: ['fireflyGlow', 'fireworkBloom'] },
    autumn: { ground: ['maplePaper'], ornament: ['leafFall'] },
    winter: { ground: ['snowLight'], ornament: ['snowDust'] },
  };
  const OFF_SEASON = 0.005;

  // prefer plus OFF_SEASON for every motif of the other seasons (own entries of the theme are kept).
  function seasonal(season, prefer) {
    const out = {};
    for (const kind of Object.keys(prefer)) out[kind] = Object.assign({}, prefer[kind]);
    for (const other of Object.keys(MOTIFS)) {
      if (other === season) continue;
      for (const kind of Object.keys(MOTIFS[other])) {
        out[kind] = out[kind] || {};
        for (const key of MOTIFS[other][kind]) if (out[kind][key] === undefined) out[kind][key] = OFF_SEASON;
      }
    }
    return out;
  }

  return [
    K.theme({
      key: 'sakuraFog',
      label: { ja: '花霞', en: 'Sakura fog' },
      blurb: { ja: '桜色の霞に深い紅、若葉の緑を少し。', en: 'Cherry-blossom haze with deep rose and a touch of new green.' },
      tags: ['soft', 'airy', 'organic'], season: 'spring', dark: false,
      swatch: { ground: '#FBEFF2', ground2: '#F4DCE3', ink: '#3A2330', accent: '#CC4668',
        shiftA: '#8FC7A8', shiftB: '#F2B8C6', muted: '#A48896' },
      faces: {
        display: { ja: 'Kaisei HarunoUmi', latin: 'Cormorant Garamond', weight: 700, flavor: 'mincho' },
        serif: { ja: 'Shippori Mincho', latin: 'Lora', weight: 500, flavor: 'mincho' },
        body: { ja: 'Zen Maru Gothic', latin: 'Nunito', weight: 500, flavor: 'round' },
      },
      style: 'plain',
      texture: 'none',
      prefer: seasonal('spring', {
        ground: { petalWash: 2 },
        ornament: { petalFall: 2 },
        filter: { softVeil: 1.5 },
      }),
    }),

    K.theme({
      key: 'cicadaNoon',
      label: { ja: '蝉の正午', en: 'Cicada noon' },
      blurb: { ja: '真夏の日差しの黄に、朱と空色と草の緑。', en: 'Midsummer yellow with vermilion, sky blue and grass green.' },
      tags: ['bright', 'bold', 'playful'], season: 'summer', dark: false,
      swatch: { ground: '#FFF6D6', ground2: '#FFE9A3', ink: '#102A3A', accent: '#E4531A',
        shiftA: '#1BB3C9', shiftB: '#2EA84F', muted: '#A09062' },
      faces: {
        display: { ja: 'Potta One', latin: 'Shrikhand', weight: 400, flavor: 'heavy' },
        serif: { ja: 'Kaisei Decol', latin: 'DM Serif Display', weight: 700, flavor: 'mincho' },
        body: { ja: 'M PLUS Rounded 1c', latin: 'Rubik', weight: 500, flavor: 'round' },
      },
      style: 'plain',
      texture: 'grainFilm',
      prefer: seasonal('summer', {
        ground: { heatShimmer: 2, halftoneSun: 1.5 },
        ornament: { sunBurst: 1.6, fireworkBloom: 1.4 },
        filter: { amberSpill: 1.3 },
      }),
    }),

    K.theme({
      key: 'mapleInk',
      label: { ja: '紅葉墨', en: 'Maple ink' },
      blurb: { ja: '焦げ茶の夜に紅葉の朱と銀杏の金。', en: 'Dark umber with maple red and ginkgo gold.' },
      tags: ['organic', 'literary', 'slow'], season: 'autumn', dark: true,
      swatch: { ground: '#2A1A14', ground2: '#3A241B', ink: '#F6E8D6', accent: '#E0582A',
        shiftA: '#E9B44C', shiftB: '#8E3B46', muted: '#8F7563' },
      faces: {
        display: { ja: 'Yuji Mai', latin: 'Playfair Display', weight: 400, flavor: 'brush' },
        serif: { ja: 'Zen Old Mincho', latin: 'EB Garamond', weight: 600, flavor: 'mincho' },
        body: { ja: 'Zen Kaku Gothic New', latin: 'Inter', weight: 500, flavor: 'gothic' },
      },
      style: 'plain',
      texture: 'paperTooth',
      prefer: seasonal('autumn', {
        ground: { maplePaper: 2, inkWash: 1.4 },
        ornament: { leafFall: 2, hankoSeal: 1.3 },
        filter: { amberSpill: 1.2 },
      }),
    }),

    K.theme({
      key: 'snowLantern',
      label: { ja: '雪灯り', en: 'Snow lantern' },
      blurb: { ja: '雪の夜の紺に、灯りの淡い金と雪の白。', en: 'Snowy night navy with soft lantern gold and snow white.' },
      tags: ['soft', 'slow', 'dark'], season: 'winter', dark: true,
      swatch: { ground: '#10182A', ground2: '#1B2640', ink: '#F4F7FB', accent: '#FFD58A',
        shiftA: '#9CC8FF', shiftB: '#D98FB5', muted: '#7383A3' },
      faces: {
        display: { ja: 'Kaisei Opti', latin: 'Cormorant Garamond', weight: 700, flavor: 'mincho' },
        serif: { ja: 'Shippori Mincho B1', latin: 'Libre Baskerville', weight: 600, flavor: 'mincho' },
        body: { ja: 'Zen Kaku Gothic New', latin: 'Inter', weight: 500, flavor: 'gothic' },
      },
      style: 'plain',
      texture: 'dustSpecks',
      prefer: seasonal('winter', {
        ground: { snowLight: 2, nightBokeh: 1.3 },
        ornament: { snowDust: 2 },
        filter: { glowSpill: 1.3 },
      }),
    }),
  ];
});
