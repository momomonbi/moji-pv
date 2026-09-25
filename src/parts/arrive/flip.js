/* 文字PVメーカー v2 — original work. Turning entrances (hinge flip, tilt up, spin in) and their mirrored exits. */
MV.def('parts/arrive/flip', ['parts/kit'], (K) => {
  'use strict';

  const DEG = K.math.DEG;

  // Edge-on → facing, turning about a vertical (y) or horizontal (x) axis while coming forward from depth.
  function hinge(P, g, k, u, p) {
    const ang = (1 - k) * 90;
    if (p.axis === 'x') P.rx += ang; else P.ry += ang;
    P.z += (1 - k) * p.depth;
    P.alpha *= u < 0.08 ? u / 0.08 : 1;
  }

  // Lying flat on the baseline → upright: a flip about the x axis hinged on the cell's bottom edge.
  function standUp(P, g, k, u) {
    const ang = (1 - k) * 90;
    P.rx += ang;
    P.y += (1 - Math.cos(ang * DEG)) * g.h * 0.5;
    P.alpha *= u < 0.15 ? u / 0.15 : 1;
  }

  // Grows from nothing while turning; 'alt' turns neighbours in opposite directions.
  function spin(P, g, k, u, p) {
    const dir = p.dir === 'ccw' ? -1 : p.dir === 'alt' && g.index % 2 === 1 ? -1 : 1;
    const s = k > 0 ? k : 0;
    P.rot += (1 - k) * p.turn * dir;
    P.sx *= s;
    P.sy *= s;
    P.alpha *= u < 0.2 ? u / 0.2 : 1;
  }

  const hingeFlip = K.arrive({
    key: 'hingeFlip',
    label: { ja: 'ちょうつがい', en: 'Hinge flip' },
    blurb: { ja: '文字が真横から回って正面を向く', en: 'Glyphs swing in from edge-on' },
    tags: ['bold', 'playful', 'digital'], family: 'flip', needs: ['depth'],
    traits: { energy: [0.3, 1], cells: [1, 24] },
    params: {
      axis: { type: 'enum', of: ['x', 'y'], label: { ja: '軸', en: 'Axis' }, auto: { pick: ['y', 'x'], weights: [2, 1] } },
      depth: { type: 'num', min: 0, max: 600, step: 10, unit: 'du', label: { ja: '奥行き', en: 'Depth' },
        auto: { range: [120, 360], follow: 'energy' } },
    },
    make: K.perGlyph(hinge),
  });

  const riseFromFlat = K.arrive({
    key: 'riseFromFlat',
    label: { ja: '起き上がり', en: 'Tilt up' },
    blurb: { ja: '寝ていた文字が足元を軸に起き上がる', en: 'Glyphs stand up from lying flat on the baseline' },
    tags: ['playful', 'retro'], family: 'flip', needs: ['depth'],
    traits: { energy: [0.2, 0.9] },
    shared: { dur: { auto: { range: [0.5, 0.85], follow: '-energy' } }, each: { auto: { range: [0.04, 0.08], follow: '-density' } },
      ease: { auto: { pick: ['backOut', 'cubicOut'], weights: [2, 1] } } },
    make: K.perGlyph(standUp),
  });

  const twirlArrive = K.arrive({
    key: 'twirlArrive',
    label: { ja: '回転', en: 'Spin in' },
    blurb: { ja: '何もないところから半回転しながら大きくなる', en: 'Glyphs spin half a turn while growing from nothing' },
    tags: ['playful', 'fast'], family: 'spin',
    traits: { energy: [0.35, 1], cells: [1, 28] },
    shared: { dur: { auto: { range: [0.4, 0.7], follow: '-energy' } }, each: { auto: { range: [0.03, 0.06], follow: '-density' } },
      ease: { auto: { pick: ['backOut', 'expoOut'], weights: [2, 1] } } },
    params: {
      turn: { type: 'num', min: 45, max: 720, step: 15, unit: 'deg', label: { ja: '回転量', en: 'Turn' }, auto: { value: 180 } },
      dir: { type: 'enum', of: ['cw', 'ccw', 'alt'], label: { ja: '向き', en: 'Direction' },
        auto: { pick: ['cw', 'ccw', 'alt'], weights: [2, 1, 1] } },
    },
    make: K.perGlyph(spin),
  });

  const hingeClose = K.mirror(hingeFlip, {
    key: 'hingeClose',
    label: { ja: '閉じ戸', en: 'Hinge close' },
    blurb: { ja: '文字が回って真横を向き、消える', en: 'Glyphs turn edge-on and vanish' },
    tags: ['bold', 'playful'],
  });

  const twirlDepart = K.mirror(twirlArrive, {
    key: 'twirlDepart',
    label: { ja: '回転抜け', en: 'Spin out' },
    blurb: { ja: '回りながら小さくなって消える', en: 'Glyphs spin away while shrinking to nothing' },
    tags: ['playful', 'fast'],
  });

  return [hingeFlip, riseFromFlat, twirlArrive, hingeClose, twirlDepart];
});
