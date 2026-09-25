/* 文字PVメーカー v2 — original work. Season backgrounds: petal wash (spring), heat shimmer (summer), snow light (winter) (DESIGN §5.5). */
MV.def('parts/ground/season', ['parts/kit'], (K) => {
  'use strict';

  const BLEED = 0.15;              // share of the frame painted beyond each edge, so camera moves never show an edge
  const FIELD = 5.5;               // least ink contrast of any colour that may sit behind the text
  const ACCENT_KEEP = 0.72;        // … and the share of the accent's contrast with the ground it keeps
  const EDGE = 3.2;                // least ink contrast of a colour that calm() dims in the middle of the frame
  const CALM_FLOOR = 0.4;          // such colours dim to this share where lyrics usually sit
  const LINE = 1.8;                // least ink contrast of a hairline (a few du wide; too thin to hide a glyph)
  const SAKURA = '#F2B3C4';        // the season's own colours, blended with the theme's palette
  const SUMMER_SUN = '#FFE3A0';
  const SUMMER_HEAT = '#F29A52';
  const PETAL_MARGIN = 40;         // du beyond the painted area where a petal wraps round (never seen, even at full bleed)
  const PETAL_WIND = 6;            // du per second the petals drift to the right
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

  function lightGround(pal) { return luminance(pal.ground) > luminance(pal.ink); }

  function areaOf(D) {
    return { w: D.w, h: D.h, x0: -BLEED * D.w, y0: -BLEED * D.h, W: D.w * (1 + 2 * BLEED), H: D.h * (1 + 2 * BLEED) };
  }

  function paint(env, data, draw, animated) {
    env.sb.paint({ layer: 'ground', bleed: BLEED, animated, owner: env.owner, data, draw });
  }

  // 1 away from the middle of the frame, down to CALM_FLOOR where lyrics usually sit.
  function calm(d, x, y) {
    const e = Math.hypot((x - d.w / 2) / (0.38 * d.w), (y - d.h / 2) / (0.3 * d.h));
    return CALM_FLOOR + (1 - CALM_FLOOR) * K.math.smooth(e - 0.4);
  }

  function blob(g, x, y, rx, ry) {
    g.save();
    g.translate(x, y);
    g.scale(rx, ry);
    g.fillRect(-1, -1, 2, 2);
    g.restore();
  }

  function verticalGrade(g, d, top, bottom) {
    const grad = g.createLinearGradient(0, d.y0, 0, d.y0 + d.H);
    grad.addColorStop(0, top); grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(d.x0, d.y0, d.W, d.H);
  }

  // --- petalWash --------------------------------------------------------------------------------------------------------

  // One cherry petal in unit space: narrow at the base (y = −0.5), round, notched at the tip (y = 0.5).
  function petalPath(g) {
    g.beginPath();
    g.moveTo(0, -0.5);
    g.bezierCurveTo(0.42, -0.34, 0.4, 0.3, 0.1, 0.5);
    g.lineTo(0, 0.4);
    g.lineTo(-0.1, 0.5);
    g.bezierCurveTo(-0.4, 0.3, -0.42, -0.34, 0, -0.5);
    g.closePath();
  }

  // Pink haze in soft pools, and faint petals falling slowly: swaying, turning, flipping (the x scale follows a cosine).
  // Both axes wrap over the painted area plus PETAL_MARGIN, so a segment as long as the song keeps its petals spread
  // over the whole frame: what drifts out on the right comes back in on the left, out of sight beyond the bleed.
  function petalWashDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    verticalGrade(g, d, d.top, d.fill);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, q.rgba(d.haze, 1)); grad.addColorStop(1, q.rgba(d.haze, 0));
    g.fillStyle = grad;
    for (let k = 0; k < d.pools.length; k += 4) {
      const P = d.pools;
      g.globalAlpha = a0 * (0.75 + 0.25 * Math.sin(0.13 * t + k));
      blob(g, P[k] + 20 * Math.sin(0.05 * t + k), P[k + 1], P[k + 2], P[k + 3]);
    }
    g.fillStyle = d.petal;
    const tall = d.H + 2 * PETAL_MARGIN, wide = d.W + 2 * PETAL_MARGIN;
    for (let k = 0; k < d.n; k++) {
      const y = d.y0 - PETAL_MARGIN + K.math.wrap(d.py[k] + d.fall * d.pace[k] * t, 0, tall);
      const drift = d.px[k] - d.x0 + PETAL_MARGIN + PETAL_WIND * t + 40 * Math.sin(d.ph[k] + 0.55 * t * d.pace[k]);
      const x = d.x0 - PETAL_MARGIN + K.math.wrap(drift, 0, wide);
      const flip = Math.cos(d.ph[k] * 2 + 1.1 * t * d.pace[k]);
      g.save();
      g.translate(x, y);
      g.rotate(d.ph[k] + 0.4 * t * (d.pace[k] - 1));
      g.scale(d.size[k] * (0.25 + 0.75 * Math.abs(flip)), d.size[k]);
      petalPath(g);
      g.globalAlpha = a0 * d.alpha * calm(d, x, y);
      g.fill();
      g.restore();
    }
    g.globalAlpha = a0;
  }

  const petalWash = K.ground({
    key: 'petalWash', season: 'spring',
    label: { ja: '花霞', en: 'Petal wash' },
    blurb: { ja: '淡い桃色の霞に、かすかな花びらが舞う', en: 'Pale pink haze with faint drifting petal shapes' },
    tags: ['soft', 'airy'],
    params: {
      petals: { type: 'int', min: 0, max: 80, label: { ja: '花びらの数', en: 'Petals' }, auto: { range: [18, 34] } },
      haze: { type: 'num', min: 0, max: 1, step: 0.01, label: { ja: '霞の濃さ', en: 'Haze' }, auto: { range: [0.45, 0.8] } },
      fall: { type: 'num', min: 0, max: 60, step: 0.5, unit: 'du', label: { ja: '落ちる速さ（毎秒）', en: 'Fall (per second)' },
        auto: { range: [10, 24], follow: 'energy' } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const area = areaOf(D), n = p.petals;
      const f = () => new Float32Array(n);
      const px = f(), py = f(), size = f(), ph = f(), pace = f();
      for (let k = 0; k < n; k++) {
        px[k] = area.x0 + rng.next() * area.W; py[k] = rng.next() * (area.H + 2 * PETAL_MARGIN);
        size[k] = D.short * rng.range(0.018, 0.04); ph[k] = rng.range(0, TAU); pace[k] = rng.range(0.6, 1.4);
      }
      const pools = [];
      for (let k = 0; k < 5; k++) {
        const r = D.short * rng.range(0.35, 0.6);
        pools.push(D.w * [0.05, 0.95, 0.2, 0.8, 0.5][k], D.h * [0.1, 0.15, 0.95, 0.9, -0.05][k], r * 1.5, r);
      }
      const pink = K.color.mix(SAKURA, pal.accent, 0.15);
      paint(env, Object.assign(area, {
        fill: pal.ground, top: readable(pal, pink, 0.25 + 0.35 * p.haze), haze: readable(pal, pink, 0.4 + 0.5 * p.haze, EDGE),
        pools: Float32Array.from(pools), petal: readable(pal, pink, 0.9, EDGE), alpha: 0.35 + 0.4 * p.amount,
        n, px, py, size, ph, pace, fall: p.fall,
      }), petalWashDraw, true);
    },
  });

  // --- heatShimmer ------------------------------------------------------------------------------------------------------

  // A warm grade under a pale sun; thin heat lines rise through the lower half, wavering and fading as they go.
  function heatDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    const grad = g.createLinearGradient(0, d.y0, 0, d.y0 + d.H);
    grad.addColorStop(0, d.top); grad.addColorStop(0.55, d.fill); grad.addColorStop(1, d.bottom);
    g.fillStyle = grad;
    g.fillRect(d.x0, d.y0, d.W, d.H);
    const sun = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    sun.addColorStop(0, q.rgba(d.sunColor, 0.9)); sun.addColorStop(0.35, q.rgba(d.sunColor, 0.45)); sun.addColorStop(1, q.rgba(d.sunColor, 0));
    g.fillStyle = sun;
    blob(g, d.sunX, d.sunY, d.sunR, d.sunR);
    const step = q.draft ? 36 : 18, top = d.h * 0.42, band = d.y0 + d.H - top;
    g.strokeStyle = d.line;
    g.lineWidth = 1.6;
    for (let i = 0; i < d.n; i++) {
      const y0 = top + K.math.wrap(d.ly[i] - d.rise * t, 0, band);
      const u = (y0 - top) / band;
      const fade = K.math.smooth(u / 0.35) * K.math.smooth((1 - u) / 0.1);
      if (fade < 0.02) continue;
      const ph = d.lph[i] + 2.2 * t;
      g.beginPath();
      for (let x = d.x0; x <= d.x0 + d.W + step; x += step) {
        const y = y0 + d.waver * (0.6 * Math.sin(x * 0.011 + ph) + 0.4 * Math.sin(x * 0.029 - 1.6 * ph));
        if (x === d.x0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.globalAlpha = a0 * d.alpha * fade * calm(d, d.w / 2, y0);
      g.stroke();
    }
    g.globalAlpha = a0;
  }

  const heatShimmer = K.ground({
    key: 'heatShimmer', season: 'summer',
    label: { ja: '陽炎', en: 'Heat shimmer' },
    blurb: { ja: '暖かなグラデーションに、揺らめく陽炎の線', en: 'A warm gradient with wavering heat lines' },
    tags: ['bright'],
    params: {
      lines: { type: 'int', min: 2, max: 28, label: { ja: '陽炎の線', en: 'Heat lines' }, auto: { range: [9, 15] } },
      waver: { type: 'num', min: 0, max: 30, step: 0.5, unit: 'du', label: { ja: '揺らぎ', en: 'Waver' }, auto: { range: [4, 12], follow: 'energy' } },
      rise: { type: 'num', min: 0, max: 60, step: 0.5, unit: 'du', label: { ja: '昇る速さ（毎秒）', en: 'Rise (per second)' }, auto: { range: [8, 18] } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const area = areaOf(D), n = p.lines;
      const ly = new Float32Array(n), lph = new Float32Array(n);
      const band = area.y0 + area.H - D.h * 0.42;
      for (let i = 0; i < n; i++) { ly[i] = (i + rng.range(0, 0.8)) * band / n; lph[i] = rng.range(0, TAU); }
      const heat = K.color.mix(SUMMER_HEAT, pal.accent, 0.25), light = lightGround(pal);
      paint(env, Object.assign(area, {
        fill: pal.ground, top: readable(pal, SUMMER_SUN, 0.35 + 0.3 * p.amount), bottom: readable(pal, heat, 0.3 + 0.4 * p.amount),
        sunColor: readable(pal, light ? '#FFFFFF' : SUMMER_SUN, 0.8, EDGE), sunX: D.w * rng.range(0.6, 0.8), sunY: -0.04 * D.h,
        sunR: D.short * 0.55, line: readable(pal, light ? '#FFFFFF' : heat, 0.9, EDGE), alpha: 0.35 + 0.35 * p.amount,
        n, ly, lph, waver: p.waver, rise: p.rise,
      }), heatDraw, true);
    },
  });

  // --- snowLight --------------------------------------------------------------------------------------------------------

  // The crest of snowbank k at x (static shape).
  function crest(d, k, x) {
    return d.base[k] + d.amp[k] * (0.6 * Math.sin(x * d.f1[k] + d.p1[k]) + 0.4 * Math.sin(x * d.f2[k] + d.p2[k]));
  }

  function bankPath(g, d, k, step) {
    g.beginPath();
    g.moveTo(d.x0, d.y0 + d.H);
    for (let x = d.x0; x <= d.x0 + d.W + step; x += step) g.lineTo(x, crest(d, k, x));
    g.lineTo(d.x0 + d.W + step, d.y0 + d.H);
    g.closePath();
  }

  function crestPath(g, d, k, step) {
    g.beginPath();
    for (let x = d.x0; x <= d.x0 + d.W + step; x += step) {
      if (x === d.x0) g.moveTo(x, crest(d, k, x)); else g.lineTo(x, crest(d, k, x));
    }
  }

  // Cold sky and the banks, far to near (drawn once and cached); each bank is lit at its crest and shaded below.
  function snowDraw(g, t, d, q) {
    verticalGrade(g, d, d.top, d.fill);
    for (let k = 0; k < d.n; k++) {
      bankPath(g, d, k, 24);
      const grad = g.createLinearGradient(0, d.base[k] - d.amp[k], 0, d.base[k] + d.h * 0.2);
      grad.addColorStop(0, d.banks[k]); grad.addColorStop(1, d.lows[k]);
      g.fillStyle = grad;
      g.fill();
      crestPath(g, d, k, 24);
      g.strokeStyle = q.rgba(d.shade, 0.5);
      g.lineWidth = 3;
      g.stroke();
    }
  }

  const GLOW = Object.freeze([40, 0.1, 18, 0.2, 6, 0.45, 2.2, 0.8]);   // (width, alpha) of the crest glow strokes

  // The glow along each crest breathes slowly; a few glints twinkle on the snow.
  function snowGlowDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    g.strokeStyle = d.glow;
    for (let k = 0; k < d.n; k++) {
      const breathe = 0.65 + 0.35 * Math.sin(TAU * 0.07 * t + k * 1.7);
      crestPath(g, d, k, q.draft ? 48 : 24);
      for (let j = 0; j < GLOW.length; j += 2) {
        g.lineWidth = GLOW[j];
        g.globalAlpha = a0 * d.alpha * GLOW[j + 1] * breathe;
        g.stroke();
      }
    }
    g.fillStyle = d.glow;
    for (let i = 0; i < d.glints.length; i += 3) {
      const G = d.glints, s = Math.sin(G[i + 2] + 1.3 * t);
      const tw = s > 0 ? s * s * s * s * s * s : 0;
      if (tw < 0.05) continue;
      g.globalAlpha = a0 * tw;
      g.fillRect(G[i] - 3, G[i + 1] - 0.6, 6, 1.2);
      g.fillRect(G[i] - 0.6, G[i + 1] - 3, 1.2, 6);
    }
    g.globalAlpha = a0;
  }

  const snowLight = K.ground({
    key: 'snowLight', season: 'winter',
    label: { ja: '雪明かり', en: 'Snow light' },
    blurb: { ja: '冷たい青のグラデーションに、ほのかに光る雪の丘', en: 'A cold blue gradient with softly glowing snowbanks' },
    tags: ['soft', 'slow'],
    params: {
      banks: { type: 'int', min: 1, max: 4, label: { ja: '雪の丘', en: 'Snowbanks' }, auto: { pick: [2, 3] } },
      glow: { type: 'num', min: 0, max: 1, step: 0.01, label: { ja: '光', en: 'Glow' }, auto: { range: [0.45, 0.85] } },
      glints: { type: 'int', min: 0, max: 90, label: { ja: 'きらめき', en: 'Glints' }, auto: { range: [24, 48] } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const area = areaOf(D), n = p.banks, light = lightGround(pal);
      const cold = light ? '#BFD2EC' : '#2F4C80', snow = light ? '#FFFFFF' : '#DDE8F6';
      const base = [], amp = [], f1 = [], f2 = [], p1 = [], p2 = [], banks = [], lows = [];
      for (let k = 0; k < n; k++) {
        const depth = n === 1 ? 1 : k / (n - 1);
        base.push(D.h * (0.77 + 0.14 * depth)); amp.push(D.h * rng.range(0.04, 0.07));
        f1.push(rng.range(0.0012, 0.0022)); f2.push(rng.range(0.003, 0.0055)); p1.push(rng.range(0, TAU)); p2.push(rng.range(0, TAU));
        banks.push(readable(pal, K.color.mix(snow, cold, 0.35 * (1 - depth)), 0.35 + 0.4 * depth, EDGE));
        lows.push(readable(pal, K.color.mix(snow, cold, 0.7), 0.2 + 0.2 * depth, EDGE));
      }
      const data = Object.assign(area, {
        fill: pal.ground, top: readable(pal, cold, 0.55 + 0.3 * p.amount), n, base, amp, f1, f2, p1, p2, banks, lows,
        shade: readable(pal, cold, 0.9, EDGE),
      });
      paint(env, data, snowDraw, false);
      const glints = [];
      for (let i = 0; i < p.glints; i++) {
        const k = rng.int(0, n - 1), x = area.x0 + rng.next() * area.W;
        glints.push(x, crest(data, k, x) + rng.range(8, 60), rng.range(0, TAU));
      }
      paint(env, Object.assign({}, data, { glow: readable(pal, snow, 1, LINE), alpha: p.glow * (0.6 + 0.4 * p.amount),
        glints: Float32Array.from(glints) }), snowGlowDraw, true);
    },
  });

  return [petalWash, heatShimmer, snowLight];
});
