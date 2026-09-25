/* 文字PVメーカー v2 — original work. Air and water backgrounds: sky grade, tide bands, fog noise, aurora veil (DESIGN §5.5). */
MV.def('parts/ground/sky', ['parts/kit'], (K) => {
  'use strict';

  const BLEED = 0.15;              // share of the frame painted beyond each edge, so camera moves never show an edge
  const FIELD = 5.5;               // least ink contrast of any colour that may sit behind the text
  const ACCENT_KEEP = 0.72;        // … and the share of the accent's contrast with the ground it keeps
  const EDGE = 3.2;                // least ink contrast of a colour that calm() dims in the middle of the frame
  const AURORA = 3.8;              // least ink contrast under the aurora, which keeps to the top of the frame
  const AURORA_TOP = 0.22;         // the curtains' lowest edge stays this × the short side above the frame's middle
  const AURORA_PASTEL = 0.35;      // on a light ground the curtains' colours are lightened this much (light, not shadow)
  const TAU = K.math.TAU;

  // --- readable tints (the kit has no contrast helper, and parts may use only the kit) --------------------------------

  function luminance(hex) {
    const n = parseInt(hex.slice(1, 7), 16);
    const lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  }

  function contrast(a, b) {
    const x = luminance(a), y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }

  // pal.ground (or `base`) tinted toward `toward` (OKLab) by at most `want`, backed off until the text still reads on it:
  // the ink keeps contrast ≥ min (FIELD by default) on the ground's side, and the accent (emphasis) keeps most of its
  // own contrast. Colours made with EDGE must be dimmed by calm() in the middle of the frame.
  function readable(pal, toward, want, min, base) {
    const from = base || pal.ground, least = min || FIELD;
    const inkL = luminance(pal.ink), light = luminance(from) > inkL;
    const accentMin = ACCENT_KEEP * (least / FIELD) * contrast(pal.accent, from);
    const ok = (m) => {
      const c = K.color.mix(from, toward, m);
      return contrast(pal.ink, c) >= least && luminance(c) > inkL === light && contrast(pal.accent, c) >= accentMin;
    };
    if (ok(want)) return K.color.mix(from, toward, want);
    let lo = 0, hi = want;
    for (let k = 0; k < 10; k++) { const m = (lo + hi) / 2; if (ok(m)) lo = m; else hi = m; }
    return K.color.mix(from, toward, lo);
  }

  function hexOf(pal, ink) { return pal[ink] || ink; }

  function areaOf(D) {
    return { w: D.w, h: D.h, x0: -BLEED * D.w, y0: -BLEED * D.h, W: D.w * (1 + 2 * BLEED), H: D.h * (1 + 2 * BLEED) };
  }

  function paint(env, data, draw, animated) {
    env.sb.paint({ layer: 'ground', bleed: BLEED, animated, owner: env.owner, data, draw });
  }

  // --- skyGrade ---------------------------------------------------------------------------------------------------------

  // A vertical grade whose horizon drifts, the reversed pair of colours breathing in and out over it, and a soft band of
  // light along the horizon that wanders sideways.
  function skyDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    const ph = TAU * d.speed * t + d.phase;
    const m = 0.5 + 0.14 * Math.sin(ph);
    let grad = g.createLinearGradient(0, d.y0, 0, d.y0 + d.H);
    grad.addColorStop(0, d.top); grad.addColorStop(m, d.mid); grad.addColorStop(1, d.bottom);
    g.fillStyle = grad;
    g.fillRect(d.x0, d.y0, d.W, d.H);
    grad = g.createLinearGradient(0, d.y0, 0, d.y0 + d.H);
    grad.addColorStop(0, q.rgba(d.top2, 1)); grad.addColorStop(m, q.rgba(d.mid, 0)); grad.addColorStop(1, q.rgba(d.bottom2, 1));
    g.globalAlpha = a0 * (0.3 + 0.3 * Math.sin(ph * 0.63 + 1.1));
    g.fillStyle = grad;
    g.fillRect(d.x0, d.y0, d.W, d.H);
    const glow = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    glow.addColorStop(0, q.rgba(d.glow, 1)); glow.addColorStop(1, q.rgba(d.glow, 0));
    g.fillStyle = glow;
    g.globalAlpha = a0 * d.glowAlpha;
    g.save();
    g.translate(d.w * (0.5 + 0.25 * Math.sin(ph * 0.4)), d.y0 + d.H * (m + 0.2));
    g.scale(d.w * 0.7, d.h * 0.16);
    g.fillRect(-1, -1, 2, 2);
    g.restore();
    g.globalAlpha = a0;
  }

  const skyGrade = K.ground({
    key: 'skyGrade',
    label: { ja: '空の階調', en: 'Sky grade' },
    blurb: { ja: '上下二色のグラデーションがゆっくり移ろう', en: 'A two-color vertical gradient that slowly shifts' },
    tags: ['airy', 'soft'],
    params: {
      top: { type: 'ink', label: { ja: '上の色', en: 'Top color' }, auto: { pick: ['shiftA', 'ground2', 'accent'], weights: [3, 2, 1] } },
      bottom: { type: 'ink', label: { ja: '下の色', en: 'Bottom color' }, auto: { pick: ['shiftB', 'accent', 'ground2'], weights: [3, 1, 1] } },
      speed: { type: 'num', min: 0, max: 0.2, step: 0.005, unit: 'Hz', label: { ja: '移ろう速さ', en: 'Drift speed' },
        auto: { range: [0.02, 0.06], follow: 'energy' } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const top = hexOf(pal, p.top), bottom = hexOf(pal, p.bottom), k = 0.3 + 0.5 * p.amount;
      paint(env, Object.assign(areaOf(D), {
        top: readable(pal, top, k), bottom: readable(pal, bottom, k), mid: pal.ground,
        top2: readable(pal, bottom, 0.6 * k), bottom2: readable(pal, top, 0.6 * k),
        glow: readable(pal, K.color.mix(bottom, luminance(pal.ground) > luminance(pal.ink) ? '#FFFFFF' : pal.ink, 0.5), 0.9),
        glowAlpha: 0.35 + 0.35 * p.amount, speed: p.speed, phase: rng.range(0, TAU),
      }), skyDraw, p.speed > 0);
    },
  });

  // --- tideBands --------------------------------------------------------------------------------------------------------

  // Horizontal bands (tilted) whose top edges swell like a tide; each crest carries a faint foam line.
  function tideDraw(g, t, d, q) {
    const S = Math.hypot(d.W, d.H), x0 = d.w / 2 - S / 2, y0 = d.h / 2 - S / 2;
    const step = q.draft ? 96 : 48;
    g.save();
    g.translate(d.w / 2, d.h / 2); g.rotate(d.tilt); g.translate(-d.w / 2, -d.h / 2);
    g.fillStyle = d.fills[0];
    g.fillRect(x0, y0, S, S);
    const bh = d.H / d.n;
    for (let i = 1; i < d.n; i++) {
      const base = d.y0 + i * bh, ph = TAU * (d.phase[i] + d.speed * t);
      g.beginPath();
      g.moveTo(x0, y0 + S);
      for (let x = x0; x <= x0 + S + step; x += step) {
        g.lineTo(x, base + Math.sin(x * 0.004 + ph) * d.swell + Math.sin(x * 0.0017 - ph * 0.6) * d.swell * 0.5);
      }
      g.lineTo(x0 + S + step, y0 + S);
      g.closePath();
      g.fillStyle = d.fills[i];
      g.fill();
      g.strokeStyle = q.rgba(d.foam, d.foamAlpha);
      g.lineWidth = 1.5;
      g.stroke();
    }
    g.restore();
  }

  const tideBands = K.ground({
    key: 'tideBands',
    label: { ja: '潮の帯', en: 'Tide bands' },
    blurb: { ja: '色の帯が波のようにゆっくりうねる', en: 'Bands of color swell slowly like a tide' },
    tags: ['wet', 'slow', 'soft'],
    params: {
      bands: { type: 'int', min: 3, max: 14, label: { ja: '帯の数', en: 'Bands' }, auto: { range: [5, 9] } },
      swell: { type: 'num', min: 0, max: 140, step: 1, unit: 'du', label: { ja: 'うねり', en: 'Swell' }, auto: { range: [18, 90], follow: 'amount.motion' } },
      speed: { type: 'num', min: 0, max: 0.5, step: 0.01, unit: 'Hz', label: { ja: '速さ', en: 'Speed' }, auto: { range: [0.03, 0.11], follow: 'energy' } },
      tilt: { type: 'num', min: -20, max: 20, step: 0.5, unit: 'deg', label: { ja: '傾き', en: 'Tilt' }, auto: { range: [-6, 6] } },
      toward: { type: 'ink', label: { ja: '混ぜる色', en: 'Blend toward' }, auto: { pick: ['shiftA', 'accent', 'muted'], weights: [3, 1, 1] } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const toward = hexOf(pal, p.toward);
      const fills = [];
      for (let i = 0; i < p.bands; i++) fills.push(readable(pal, toward, 0.06 + 0.55 * p.amount * i / (p.bands - 1)));
      paint(env, Object.assign(areaOf(D), {
        n: p.bands, swell: p.swell, speed: p.speed, tilt: p.tilt * K.math.DEG, phase: rng.floats(p.bands), fills,
        foam: readable(pal, pal.ink, 0.5), foamAlpha: 0.12 + 0.12 * p.amount,
      }), tideDraw, p.speed > 0 && p.swell > 0);
    },
  });

  // --- fogNoise ---------------------------------------------------------------------------------------------------------

  // Soft elliptical puffs on a jittered lattice; each drifts sideways (wrapping) and thickens or thins with value noise.
  function fogDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    g.fillStyle = d.fill;
    g.fillRect(d.x0, d.y0, d.W, d.H);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, q.rgba(d.fog, 1)); grad.addColorStop(0.55, q.rgba(d.fog, 0.5)); grad.addColorStop(1, q.rgba(d.fog, 0));
    g.fillStyle = grad;
    const span = d.W + 2 * d.cell;
    for (let k = 0; k < d.n; k++) {
      const x = d.x0 - d.cell + K.math.wrap(d.px[k] + d.drift * d.pace[k] * t, 0, span);
      const y = d.py[k];
      const v = K.math.noise2(d.seed, d.nx[k] + t * d.churn, d.ny[k] + t * d.churn * 0.4);
      const thick = K.math.smooth((v - 0.3) / 0.55) * (0.55 + 0.45 * (y - d.y0) / d.H);
      if (thick < 0.02) continue;
      g.save();
      g.translate(x, y);
      g.scale(d.r[k] * 1.5, d.r[k] * 0.8);
      g.globalAlpha = a0 * d.density * thick;
      g.fillRect(-1, -1, 2, 2);
      g.restore();
    }
    g.globalAlpha = a0;
  }

  const fogNoise = K.ground({
    key: 'fogNoise',
    label: { ja: '霧', en: 'Fog noise' },
    blurb: { ja: '地の二色目の霧がゆっくり流れ、濃くなり薄くなる', en: 'Slow value-noise fog of the second ground color over the ground' },
    tags: ['wet', 'dark', 'slow'],
    params: {
      density: { type: 'num', min: 0, max: 1, step: 0.01, label: { ja: '濃さ', en: 'Density' }, auto: { range: [0.5, 0.85] } },
      drift: { type: 'num', min: 0, max: 60, step: 0.5, unit: 'du', label: { ja: '流れ（毎秒）', en: 'Drift (per second)' },
        auto: { range: [4, 16], follow: 'energy' } },
      scale: { type: 'num', min: 0.1, max: 0.6, step: 0.01, unit: 'frac', label: { ja: '霧の大きさ', en: 'Puff size' }, auto: { range: [0.2, 0.32] } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const area = areaOf(D), cell = p.scale * D.short;
      const cols = Math.ceil((area.W + 2 * cell) / (cell * 1.2)), rows = Math.ceil(area.H / cell) + 1;
      const n = cols * rows;
      const px = new Float32Array(n), py = new Float32Array(n), r = new Float32Array(n), pace = new Float32Array(n);
      const nx = new Float32Array(n), ny = new Float32Array(n);
      for (let j = 0, k = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++, k++) {
          px[k] = (i + rng.range(-0.35, 0.35)) * cell * 1.2;
          py[k] = area.y0 + (j + rng.range(-0.3, 0.3)) * cell;
          r[k] = cell * rng.range(0.8, 1.1);
          pace[k] = rng.range(0.6, 1.4);
          nx[k] = i * 0.53; ny[k] = j * 0.61;
        }
      }
      paint(env, Object.assign(area, {
        fill: pal.ground, fog: readable(pal, K.color.mix(pal.ground2, pal.muted, 0.2), 0.95),
        density: p.density * (0.55 + 0.45 * p.amount), drift: p.drift, churn: 0.05 + 0.004 * p.drift, cell, n,
        px, py, r, pace, nx, ny, seed: rng.int(1, 2147483646),
      }), fogDraw, true);
    },
  });

  // --- auroraVeil -------------------------------------------------------------------------------------------------------

  // The lower (bright) edge and the upper (fading) edge of curtain k at x, for the wave phase ph.
  function curtainBase(d, k, x, ph) {
    return d.base[k] + d.wave * (0.7 * Math.sin(x * d.f1[k] + ph) + 0.4 * Math.sin(x * d.f2[k] - 0.7 * ph));
  }

  function curtainTop(d, k, x, ph) {
    return curtainBase(d, k, x, ph) - d.len[k] * (0.75 + 0.25 * Math.sin(x * d.f2[k] * 1.7 + ph * 0.5));
  }

  // One curtain: a band hanging from the top whose lower edge waves. Its colour is strongest just above that edge and
  // fades upward (and softly below it); vertical rays of varying length give it the folded look of an aurora.
  function curtain(g, d, q, k, t) {
    const a0 = g.globalAlpha;
    const step = q.draft ? 48 : 24, ph = TAU * d.speed * t * d.pace[k] + d.phase[k];
    const x1 = d.x0 + d.W, len = d.len[k], soft = 0.18 * len;
    const grad = g.createLinearGradient(0, d.base[k] - len - d.wave, 0, d.base[k] + d.wave + soft);
    grad.addColorStop(0, q.rgba(d.colors[k], 0)); grad.addColorStop(0.55, q.rgba(d.colors[k], 0.35));
    grad.addColorStop(0.84, q.rgba(d.colors[k], 1)); grad.addColorStop(1, q.rgba(d.colors[k], 0));
    g.beginPath();
    g.moveTo(d.x0, curtainTop(d, k, d.x0, ph));
    for (let x = d.x0 + step; x <= x1 + step; x += step) g.lineTo(x, curtainTop(d, k, x, ph));
    for (let x = x1 + step; x >= d.x0 - step; x -= step) g.lineTo(x, curtainBase(d, k, x, ph) + soft);
    g.closePath();
    g.fillStyle = grad;
    g.globalAlpha = a0 * d.alpha * 0.55;
    g.fill();
    g.beginPath();                  // rays: thin upright bars of uneven width and spacing (cheaper than strokes)
    const foot = soft * 0.5, R = d.rays, shift = k * 37;
    for (let r = 0; r < R.length; r += 2) {
      if (q.draft && r % 4) continue;
      const x = d.x0 + K.math.wrap(R[r] + shift, 0, d.W), half = R[r + 1] / 2;
      const b = curtainBase(d, k, x, ph) + foot;
      const ray = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(x * 0.047 + ph * 1.7)) * (0.5 + 0.5 * Math.sin(x * 0.0131 - ph));
      g.rect(x - half, b - foot - len * ray, 2 * half, foot + len * ray);
    }
    g.globalAlpha = a0 * d.alpha * 0.45;
    g.fill();
    g.globalAlpha = a0;
  }

  function auroraDraw(g, t, d, q) {
    const grad = g.createLinearGradient(0, d.y0, 0, d.h * 0.7);
    grad.addColorStop(0, d.sky); grad.addColorStop(1, d.fill);
    g.fillStyle = grad;
    g.fillRect(d.x0, d.y0, d.W, d.H);
    for (let k = 0; k < d.n; k++) curtain(g, d, q, k, t);
  }

  const auroraVeil = K.ground({
    key: 'auroraVeil',
    label: { ja: 'オーロラ', en: 'Aurora veil' },
    blurb: { ja: '画面の上に色のカーテンが揺れる', en: 'Curtains of color waving across the top' },
    tags: ['airy', 'bright'],
    params: {
      curtains: { type: 'int', min: 1, max: 4, label: { ja: 'カーテンの数', en: 'Curtains' }, auto: { pick: [2, 3] } },
      height: { type: 'num', min: 0.2, max: 0.6, step: 0.01, unit: 'frac', label: { ja: '高さ', en: 'Height' }, auto: { range: [0.28, 0.38] } },
      speed: { type: 'num', min: 0, max: 0.3, step: 0.005, unit: 'Hz', label: { ja: '揺れの速さ', en: 'Wave speed' },
        auto: { range: [0.03, 0.08], follow: 'energy' } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const green = K.color.mix(pal.shiftA, '#4FE0A2', 0.55), light = luminance(pal.ground) > luminance(pal.ink);
      const tones = [green, pal.shiftA, pal.shiftB, green].map((c) => (light ? K.color.mix(c, '#FFFFFF', AURORA_PASTEL) : c));
      const n = p.curtains, colors = [], base = [], len = [], f1 = [], f2 = [], phase = [], pace = [];
      let wave = D.h * p.height * 0.18, low = 0;
      for (let k = 0; k < n; k++) {
        colors.push(readable(pal, tones[k], 0.6 + 0.4 * p.amount, AURORA));
        base.push(D.h * (0.06 + p.height * (0.45 + 0.3 * k / Math.max(1, n - 1))));
        len.push(D.h * p.height * rng.range(0.55, 0.8));
        f1.push(rng.range(0.0022, 0.0038)); f2.push(rng.range(0.005, 0.009));
        phase.push(rng.range(0, TAU)); pace.push(rng.range(0.7, 1.3));
        low = Math.max(low, base[k] + 1.1 * wave + 0.18 * len[k]);     // the curtain's lowest reach (its soft lower edge)
      }
      // curtains across the top: the whole veil shrinks toward the top edge until its lowest reach clears the middle of
      // the frame by AURORA_TOP × the short side, where lyrics usually stand (a square or wide frame has less room above)
      const fit = Math.min(1, (D.h / 2 - AURORA_TOP * D.short) / low);
      for (let k = 0; k < n; k++) { base[k] *= fit; len[k] *= fit; }
      wave *= fit;
      const area = areaOf(D), rays = [];
      for (let x = 0; x < area.W; x += rng.range(9, 30)) rays.push(x, rng.range(2, 8));
      paint(env, Object.assign(area, {
        fill: pal.ground, sky: readable(pal, pal.ground2, 1), n, colors, base, len, f1, f2, phase, pace, rays: Float32Array.from(rays),
        wave, speed: p.speed, alpha: 0.65 + 0.35 * p.amount,
      }), auroraDraw, p.speed > 0);
    },
  });

  return [skyGrade, tideBands, fogNoise, auroraVeil];
});
