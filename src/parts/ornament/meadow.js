/* 文字PVメーカー v2 — original work. Timeline-driven meadow elements adapted from the supplied wind-meadow.html. */
MV.def('parts/ornament/meadow', ['parts/kit'], (K) => {
  'use strict';

  const C = K.cinematic, TAU = K.math.TAU;
  const PALETTES = Object.freeze({
    day: { grass: ['#6C8B37', '#8FA247', '#B4A656', '#536D2C'], bark: '#56423A',
      leaves: ['#D1A637', '#D9802A', '#8E9A39', '#B65428'], plume: '#F1E6CB', sheen: '#FFF3CC', mote: '#E4D7AA' },
    night: { grass: ['#2F4144', '#3B4C48', '#4D5651', '#243337'], bark: '#1C2132',
      leaves: ['#4C503F', '#5B4B3B', '#3C4B41', '#533D35'], plume: '#DDD7C1', sheen: '#D9E2FF', mote: '#E2F29B' },
    snow: { grass: ['#80745D', '#93866B', '#6F6858', '#625A49'], bark: '#20232D',
      leaves: ['#20232D', '#20232D', '#20232D', '#20232D'], plume: '#D1CCC0', sheen: '#E6ECF8', mote: '#EEF2FA' },
  });

  // The source's wsProf height law and 0.28 turbulence share. Its stateful L1/L2 fluid grids become a frozen,
  // spatially advected wave field here, so a seek does not need to replay thousands of earlier physics steps.
  function windAt(x, height, phase, time, d) {
    const y = Math.max(0.02, height);
    const profile = y >= 0.6 ? Math.pow(y * 0.5, 0.14285714) : 0.841982444 * Math.exp(y / 0.6 - 1);
    const travel = time * (0.45 + Math.abs(d.wind) * 0.16);
    const gust = Math.sin(x * 7.1 - travel + phase) * 0.66 + Math.sin(x * 13.3 - travel * 0.618034 + phase * 0.7) * 0.34;
    const turbulence = Math.sin(x * 23.7 - travel * 1.37 + phase) * 0.70710678
      + Math.cos(x * 14.6 - travel * 0.83 + phase * 0.60181502) * 0.29289322;
    return d.wind * profile * (1 + d.gust * gust) * (1 + 0.28 * turbulence);
  }

  // Original grass geometry: the third-points of a six-node centreline determine its two cubic controls; widths
  // at the root and controls use the original 0.72 / 1.1 / 0.75 profile and converge to a pointed blade tip.
  function blade(g, b, time, d, X, Y) {
    const air = windAt(b.x / d.w, b.length / d.short * 3, b.phase, time, d);
    const load = d.mode === 'snow' ? b.rest * 0.5 + 0.35 : b.rest;
    const bend = K.math.clamp(load + Math.atan(air * 0.12) * d.sway, -1.4, 1.4);
    X[0] = b.x; Y[0] = b.y;
    for (let k = 1; k < 6; k++) {
      const u = (k - 0.5) / 5, angle = bend * (0.22 + 0.78 * u);
      X[k] = X[k - 1] + Math.sin(angle) * b.length / 5;
      Y[k] = Y[k - 1] - Math.cos(angle) * b.length / 5;
    }
    const ax = X[1] + (X[2] - X[1]) * 0.667, ay = Y[1] + (Y[2] - Y[1]) * 0.667;
    const bx = X[3] + (X[4] - X[3]) * 0.333, by = Y[3] + (Y[4] - Y[3]) * 0.333;
    const x0 = X[0], y0 = Y[0], x3 = X[5], y3 = Y[5];
    const c1x = (-5 * x0 + 18 * ax - 9 * bx + 2 * x3) / 6, c1y = (-5 * y0 + 18 * ay - 9 * by + 2 * y3) / 6;
    const c2x = (2 * x0 - 9 * ax + 18 * bx - 5 * x3) / 6, c2y = (2 * y0 - 9 * ay + 18 * by - 5 * y3) / 6;
    const nx = b.width * 0.5 * Math.cos(bend * 0.65), ny = b.width * 0.5 * Math.sin(bend * 0.65);
    g.beginPath(); g.moveTo(x0 + nx * 0.72, y0 + ny * 0.72);
    g.bezierCurveTo(c1x + nx * 1.1, c1y + ny * 1.1, c2x + nx * 0.75, c2y + ny * 0.75, x3, y3);
    g.bezierCurveTo(c2x - nx * 0.75, c2y - ny * 0.75, c1x - nx * 1.1, c1y - ny * 1.1, x0 - nx * 0.72, y0 - ny * 0.72);
    g.closePath(); g.fillStyle = d.colors.grass[b.color]; g.fill();
    if (b.reed) {
      g.strokeStyle = d.colors.plume; g.lineWidth = Math.max(0.8, b.width * 0.45);
      g.beginPath(); g.moveTo(x3, y3); g.lineTo(x3 + Math.sin(bend) * b.length * 0.14, y3 - Math.cos(bend) * b.length * 0.14); g.stroke();
      for (let j = 0; j < 7; j++) {
        const u = j / 7, x = x3 + Math.sin(bend) * b.length * 0.14 * u;
        const y = y3 - Math.cos(bend) * b.length * 0.14 * u, spread = Math.sin(Math.PI * u) * b.length * 0.036;
        g.beginPath(); g.moveTo(x - Math.cos(bend) * spread, y - Math.sin(bend) * spread);
        g.lineTo(x, y - b.length * 0.012); g.lineTo(x + Math.cos(bend) * spread, y + Math.sin(bend) * spread); g.stroke();
      }
    } else if (b.highlight) {
      g.strokeStyle = d.colors.sheen; g.lineWidth = Math.max(0.55, b.width * 0.11);
      g.beginPath(); g.moveTo(ax, ay); g.bezierCurveTo(c1x, c1y, c2x, c2y, x3, y3); g.stroke();
    }
  }

  // The source's leafShape quadratic outline, placed on pre-generated margin branches instead of a stateful tree.
  function leaf(g, x, y, angle, length) {
    const dx = Math.cos(angle), dy = Math.sin(angle), px = -dy, py = dx, wide = length * 0.36;
    const bx = x - dx * length * 0.1, by = y - dy * length * 0.1;
    const mx = x + dx * length * 0.42, my = y + dy * length * 0.42;
    g.beginPath(); g.moveTo(bx, by);
    g.quadraticCurveTo(mx + px * wide, my + py * wide, x + dx * length, y + dy * length);
    g.quadraticCurveTo(mx - px * wide, my - py * wide, bx, by); g.fill();
  }

  function trees(g, time, d, alpha) {
    for (const b of d.branches) {
      const sway = windAt(b.x / d.w, 1.4, b.phase, time, d) * d.sway * d.short * 0.0017;
      const tx = b.x + b.dx + sway, ty = b.y - b.length;
      g.globalAlpha = alpha * 0.76; g.strokeStyle = d.colors.bark; g.lineWidth = b.width;
      g.beginPath(); g.moveTo(b.x, b.y); g.quadraticCurveTo(b.x + b.dx * 0.3 + sway * 0.2, b.y - b.length * 0.62, tx, ty); g.stroke();
      if (d.mode === 'snow') {
        g.strokeStyle = d.colors.sheen; g.lineWidth = Math.max(0.8, b.width * 0.35); g.stroke();
      } else {
        g.fillStyle = d.colors.leaves[b.color];
        leaf(g, tx, ty, b.angle + sway / d.short * 5, b.leaf);
        leaf(g, b.x + b.dx * 0.68 + sway * 0.55, b.y - b.length * 0.75, -b.angle, b.leaf * 0.85);
      }
    }
  }

  function air(g, time, d, alpha, draft) {
    const n = draft ? Math.ceil(d.motes.length / 2) : d.motes.length;
    for (let k = 0; k < n; k++) {
      const b = d.motes[k], snow = d.mode === 'snow', night = d.mode === 'night';
      const speed = snow ? 0.028 + b.pace * 0.025 : -0.006 - b.pace * 0.008;
      const y = K.math.wrap(b.y + time * speed, -0.04, 1.04) * d.h;
      const x = K.math.wrap(b.x + time * d.wind * 0.0014 + Math.sin(time * 0.37 + b.phase) * 0.025, -0.05, 1.05) * d.w;
      const e = Math.hypot((x - d.w * 0.5) / (d.w * 0.36), (y - d.h * 0.48) / (d.h * 0.3));
      const clear = 0.14 + 0.86 * K.math.smooth(e - 0.25);
      const light = night ? 0.2 + 0.8 * Math.pow(0.5 + 0.5 * Math.sin(time * 1.7 + b.phase), 3) : 0.6;
      g.globalAlpha = alpha * clear * light;
      g.fillStyle = d.colors.mote;
      g.beginPath(); g.ellipse(x, y, b.size * (snow ? 1 : 1.8), b.size * (snow ? 1 : 0.45), b.phase + time * 0.17, 0, TAU); g.fill();
      if (night) {
        g.globalAlpha = alpha * clear * light * 0.12;
        g.beginPath(); g.arc(x, y, b.size * 4, 0, TAU); g.fill();
      }
    }
  }

  function draw(g, t, d, q) {
    const f = C.frame(t, d, q);
    if (!f.active) return;
    const a = g.globalAlpha * f.alpha * (d.layer === 'near' ? 0.54 : 0.9);
    const time = f.time * d.speed, X = new Float64Array(6), Y = new Float64Array(6);
    g.save();
    trees(g, time, d, a);
    const step = q.draft ? 3 : 1;
    for (let k = 0; k < d.blades.length; k += step) {
      const b = d.blades[k];
      g.globalAlpha = a * (0.42 + b.depth * 0.4);
      blade(g, b, time, d, X, Y);
    }
    air(g, time, d, a, q.draft);
    g.restore();
  }

  const windMeadow = K.ornament({
    key: 'windMeadow', scope: 'run', follow: 'own', pool: false, family: 'cinematic',
    label: { ja: '風・揺・草木', en: 'Wind and meadow' },
    blurb: { ja: '草木が風になびき、昼の種・夜の光・雪が歌詞の周囲を漂う', en: 'Wind bends the meadow while seeds, night lights or snow drift around the lyrics' },
    tags: ['organic', 'soft'],
    params: Object.assign({}, C.params, {
      mode: { type: 'enum', of: ['day', 'night', 'snow'], optKey: 'cinematicMeadowMode',
        label: { ja: '景色', en: 'Scene' }, auto: { value: 'day' } },
      wind: { type: 'num', min: -14, max: 14, step: 0.1, label: { ja: '風の強さ・向き', en: 'Wind strength and direction' }, auto: { value: 4.5 } },
      gust: { type: 'num', min: 0, max: 1, step: 0.01, label: { ja: '突風', en: 'Gusts' }, auto: { value: 0.5 } },
      sway: { type: 'num', min: 0, max: 2, step: 0.05, label: { ja: '草木の揺れ', en: 'Plant sway' }, auto: { value: 1 } },
      density: { type: 'int', min: 60, max: 600, label: { ja: '草の密度', en: 'Grass density' }, auto: { value: 360 } },
      height: { type: 'num', min: 0.08, max: 0.38, step: 0.01, label: { ja: '草丈', en: 'Grass height' }, auto: { value: 0.2 } },
      speed: { type: 'num', min: 0, max: 3, step: 0.05, label: { ja: '動きの速さ', en: 'Motion speed' }, auto: { value: 1 } },
      color: { type: 'ink', label: { ja: '色味', en: 'Tint color' }, auto: { value: 'accent' } },
      tint: { type: 'num', min: 0, max: 1, step: 0.01, label: { ja: '色味の強さ', en: 'Tint amount' }, auto: { value: 0 } },
    }),
    build(env, p) {
      const d = Object.assign(C.setup(env, p), { mode: p.mode, wind: p.wind, gust: p.gust, sway: p.sway, speed: p.speed });
      const random = C.random(d.seed), source = PALETTES[p.mode] || PALETTES.day;
      const tint = C.color(env.pal, p.color);
      const color = (ink) => C.color(env.pal, p.tint > 0 ? K.color.mix(ink, tint, p.tint) : ink);
      d.colors = {};
      for (const name of Object.keys(source)) d.colors[name] = Array.isArray(source[name]) ? source[name].map(color) : color(source[name]);
      d.blades = [];
      for (let k = 0; k < p.density; k++) {
        const depth = Math.sqrt(random()), length = d.short * p.height * (0.18 + depth * 0.82) * (0.75 + random() * 0.5);
        d.blades.push({ x: (random() * 1.1 - 0.05) * d.w, y: d.h * (0.83 + depth * 0.22), length,
          width: d.short * (0.001 + depth * 0.0023) * (0.7 + random() * 0.6), phase: random() * TAU,
          rest: (random() - 0.5) * 0.32, color: k % 4, depth, reed: k % 23 === 0,
          highlight: k % 9 === 0 });
      }
      d.blades.sort((a, b) => a.depth - b.depth);
      d.branches = [];
      for (let side = 0; side < 2; side++) for (let k = 0; k < 13; k++) {
        const u = k / 13, sideDir = side ? -1 : 1, height = d.short * (0.19 + random() * 0.25);
        d.branches.push({ x: d.w * (side ? 0.985 : 0.015), y: d.h * (1.01 - u * 0.19),
          dx: sideDir * height * (0.08 + random() * 0.22), length: height * (0.3 + u * 0.65),
          width: d.short * (0.0007 + (1 - u) * 0.0013), angle: sideDir * (-0.65 + random() * 0.8),
          phase: random() * TAU, leaf: d.short * (0.012 + random() * 0.018), color: k % 4 });
      }
      d.motes = [];
      const count = p.mode === 'snow' ? 90 : p.mode === 'night' ? 36 : 24;
      for (let k = 0; k < count; k++) d.motes.push({ x: random(), y: random(), phase: random() * TAU,
        pace: random(), size: d.short * (0.001 + random() * 0.0017) });
      env.sb.paint({ layer: d.layer, owner: env.owner, bleed: 0, animated: true, data: d, draw });
    },
  });

  return [windMeadow];
});
