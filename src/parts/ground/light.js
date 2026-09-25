/* 文字PVメーカー v2 — original work. Backgrounds of light in the dark: night bokeh, neon haze, spot beam (DESIGN §5.5). */
MV.def('parts/ground/light', ['parts/kit'], (K) => {
  'use strict';

  const BLEED = 0.15;              // share of the frame painted beyond each edge, so camera moves never show an edge
  const FIELD = 5.5;               // least ink contrast of any colour that may sit behind the text
  const ACCENT_KEEP = 0.72;        // … and the share of the accent's contrast with the ground it keeps
  const EDGE = 3.2;                // least ink contrast of a colour that calm() dims in the middle of the frame
  const BEAM = 4.8;                // least ink contrast under the spot beam, which lights the middle on purpose
  const CALM_FLOOR = 0.4;         // lights dim to this share where lyrics usually sit (the middle of the frame)
  const LEVEL_HZ = 20;             // loudness samples per second kept for neonHaze (the plan's envelope rate)
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

  // 1 away from the middle of the frame, down to CALM_FLOOR where lyrics usually sit.
  function calm(d, x, y) {
    const e = Math.hypot((x - d.w / 2) / (0.38 * d.w), (y - d.h / 2) / (0.3 * d.h));
    return CALM_FLOOR + (1 - CALM_FLOOR) * K.math.smooth(e - 0.4);
  }

  // A soft ellipse of the current fill (a unit radial gradient) at (x, y) with radii rx, ry.
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

  // --- nightBokeh -------------------------------------------------------------------------------------------------------

  // Out-of-focus lights: flat-bodied discs with a soft rim, drifting (wrapped) and twinkling, three colours.
  function bokehDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    verticalGrade(g, d, d.top, d.bottom);
    for (let c = 0; c < d.colors.length; c++) {
      const col = d.colors[c];
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, q.rgba(col, 0.8)); grad.addColorStop(0.7, q.rgba(col, 0.62));
      grad.addColorStop(0.88, q.rgba(col, 0.3)); grad.addColorStop(1, q.rgba(col, 0));
      g.fillStyle = grad;
      for (let k = c; k < d.n; k += d.colors.length) {
        const r = d.r[k];
        const x = d.x0 - r + K.math.wrap(d.px[k] + d.vx[k] * t, 0, d.W + 2 * r);
        const y = d.y0 - r + K.math.wrap(d.py[k] + d.vy[k] * t + 14 * Math.sin(d.ph[k] + 0.3 * t), 0, d.H + 2 * r);
        const tw = 0.6 + 0.4 * Math.sin(d.ph[k] * 3 + d.tw[k] * t);
        g.globalAlpha = a0 * d.alpha * d.depth[k] * tw * calm(d, x, y);
        blob(g, x, y, r, r);
      }
    }
    g.globalAlpha = a0;
  }

  const nightBokeh = K.ground({
    key: 'nightBokeh',
    label: { ja: '夜のぼけ', en: 'Night bokeh' },
    blurb: { ja: 'ぼけた光の玉がゆっくり漂う夜', en: 'Soft out-of-focus light discs drifting in the night' },
    tags: ['dark', 'wet', 'soft'],
    params: {
      count: { type: 'int', min: 6, max: 60, label: { ja: '光の数', en: 'Lights' }, auto: { range: [16, 30] } },
      size: { type: 'num', min: 20, max: 240, step: 1, unit: 'du', label: { ja: '大きさ', en: 'Size' }, auto: { range: [90, 170] } },
      drift: { type: 'num', min: 0, max: 40, step: 0.5, unit: 'du', label: { ja: '漂う速さ（毎秒）', en: 'Drift (per second)' },
        auto: { range: [3, 12], follow: 'energy' } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const area = areaOf(D), n = p.count;
      const f = () => new Float32Array(n);
      const px = f(), py = f(), r = f(), vx = f(), vy = f(), ph = f(), tw = f(), depth = f();
      for (let k = 0; k < n; k++) {
        const near = rng.next();
        r[k] = p.size * (0.35 + 0.65 * near * near);
        px[k] = rng.range(0, area.W + 2 * r[k]);
        // more lights toward the top and bottom thirds than across the middle
        const band = rng.next();
        py[k] = band < 0.4 ? rng.range(0, 0.42) : band < 0.8 ? rng.range(0.58, 1) : rng.range(0.42, 0.58);
        py[k] *= area.H + 2 * r[k];
        vx[k] = p.drift * rng.range(-1, 1); vy[k] = -p.drift * rng.range(0.1, 0.6);
        ph[k] = rng.range(0, TAU); tw[k] = rng.range(0.4, 1.4); depth[k] = 0.45 + 0.55 * (1 - near);
      }
      const colors = [pal.accent, pal.shiftA, pal.shiftB].map((c) => readable(pal, c, 1, EDGE));
      paint(env, Object.assign(area, {
        top: pal.ground, bottom: readable(pal, K.color.mix(pal.ground2, pal.shiftA, 0.35), 1), colors, n, px, py, r, vx, vy, ph, tw,
        depth, alpha: 0.55 + 0.45 * p.amount,
      }), bokehDraw, true);
    },
  });

  // --- neonHaze ---------------------------------------------------------------------------------------------------------

  // Loudness at local time t from the samples taken at build (closed form: a lookup, never a running state).
  function levelOf(d, t) {
    const x = K.math.clamp(t * LEVEL_HZ, 0, d.levels.length - 1);
    const i = Math.floor(x), f = x - i, j = Math.min(i + 1, d.levels.length - 1);
    return d.levels[i] + (d.levels[j] - d.levels[i]) * f;
  }

  function neonDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    verticalGrade(g, d, d.top, d.fill);
    const lv = (levelOf(d, t - 0.1) + levelOf(d, t) + levelOf(d, t + 0.1)) / 3;
    const breathe = 1 - d.react + d.react * lv;
    for (let k = 0; k < d.glows.length; k++) {
      const gl = d.glows[k];
      const x = d.w * (gl[0] + gl[2] * Math.sin(TAU * 0.021 * t + gl[3]));
      const y = d.h * (gl[1] + gl[2] * 0.5 * Math.cos(TAU * 0.017 * t + gl[3]));
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, q.rgba(d.colors[k], 1)); grad.addColorStop(0.4, q.rgba(d.colors[k], 0.55));
      grad.addColorStop(1, q.rgba(d.colors[k], 0));
      g.fillStyle = grad;
      g.globalAlpha = a0 * K.math.clamp(d.alpha * (0.35 + 0.65 * breathe) * calm(d, x, y));
      const R = d.R * (0.85 + 0.25 * breathe);
      blob(g, x, y, R * 1.35, R);
    }
    g.globalAlpha = a0;
  }

  function scanDraw(g, t, d, q) {
    g.beginPath();
    for (let y = d.y0; y < d.y0 + d.H; y += 5) g.rect(d.x0, y, d.W, 1.6);
    g.fillStyle = q.rgba(d.line, d.lineAlpha);
    g.fill();
  }

  const neonHaze = K.ground({
    key: 'neonHaze',
    label: { ja: 'ネオンの靄', en: 'Neon haze' },
    blurb: { ja: '二色の光の靄が曲の音量に合わせて呼吸する', en: 'Glowing fields in two shift colors that breathe with the loudness' },
    tags: ['digital', 'dark'], needs: ['level'],
    params: {
      size: { type: 'num', min: 0.3, max: 1.4, step: 0.01, unit: 'frac', label: { ja: '光の大きさ', en: 'Glow size' }, auto: { range: [0.6, 0.9] } },
      react: { type: 'num', min: 0, max: 1, step: 0.01, label: { ja: '音への反応', en: 'Reaction' }, auto: { range: [0.4, 0.85], follow: 'energy' } },
      lines: { type: 'bool', label: { ja: '走査線', en: 'Scan lines' }, auto: { pick: [true, false], weights: [2, 1] } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const area = areaOf(D);
      const n = Math.ceil(env.times.b * LEVEL_HZ) + 2;
      const levels = new Float32Array(n);
      for (let i = 0; i < n; i++) levels[i] = env.level(i / LEVEL_HZ);
      const glows = [[0.12, 0.84, 0.06, rng.range(0, TAU)], [0.88, 0.16, 0.06, rng.range(0, TAU)], [0.5, 1.02, 0.3, rng.range(0, TAU)]];
      const colors = [pal.shiftA, pal.shiftB, K.color.mix(pal.shiftA, pal.shiftB, 0.5)].map((c) => readable(pal, c, 1, EDGE));
      paint(env, Object.assign(area, {
        top: readable(pal, pal.ground2, 1), fill: pal.ground, levels, glows, colors, R: p.size * D.short * 0.6,
        react: p.react, alpha: 0.55 + 0.45 * p.amount,
      }), neonDraw, true);
      if (p.lines) {
        paint(env, Object.assign(areaOf(D), { line: K.color.mix(pal.ground, '#000000', 0.6), lineAlpha: luminance(pal.ground) > 0.4 ? 0.06 + 0.05 * p.amount : 0.2 + 0.15 * p.amount }),
          scanDraw, false);
      }
    },
  });

  // --- spotBeam ---------------------------------------------------------------------------------------------------------

  const SOFT = Object.freeze([1.4, 0.3, 1, 0.45, 0.6, 0.4]);   // (spread factor, alpha) of the nested cones

  // A cone from above the frame whose axis swings slowly, a pool of light where it lands, and a few motes in the beam.
  function beamDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    g.fillStyle = d.fill;
    g.fillRect(d.x0, d.y0, d.W, d.H);
    const vig = g.createRadialGradient(d.w / 2, d.h * 0.45, d.h * 0.2, d.w / 2, d.h * 0.45, Math.hypot(d.w, d.h) * 0.7);
    vig.addColorStop(0, q.rgba(d.edge, 0)); vig.addColorStop(1, q.rgba(d.edge, 0.9));
    g.fillStyle = vig;
    g.fillRect(d.x0, d.y0, d.W, d.H);
    const th = d.sweep * Math.sin(TAU * d.speed * t + d.phase);
    const L = d.h * 1.6;
    const cone = g.createRadialGradient(d.ax, d.ay, 0, d.ax, d.ay, L);
    cone.addColorStop(0, q.rgba(d.light, 1)); cone.addColorStop(0.5, q.rgba(d.light, 0.55)); cone.addColorStop(1, q.rgba(d.light, 0));
    g.fillStyle = cone;
    for (let k = 0; k < SOFT.length; k += 2) {        // nested cones: a soft edge without blur
      const half = d.spread * SOFT[k] / 2;
      g.beginPath();
      g.moveTo(d.ax, d.ay);
      g.lineTo(d.ax + Math.sin(th - half) * L, d.ay + Math.cos(th - half) * L);
      g.lineTo(d.ax + Math.sin(th + half) * L, d.ay + Math.cos(th + half) * L);
      g.closePath();
      g.globalAlpha = a0 * d.alpha * SOFT[k + 1];
      g.fill();
    }
    const half = d.spread / 2;
    const fy = d.h * 0.9, fx = d.ax + Math.tan(th) * (fy - d.ay);
    const pool = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    pool.addColorStop(0, q.rgba(d.light, 0.8)); pool.addColorStop(1, q.rgba(d.light, 0));
    g.fillStyle = pool;
    g.globalAlpha = a0 * d.alpha * 0.7;
    const rx = Math.tan(half) * (fy - d.ay) * 1.25;
    blob(g, fx, fy, rx, rx * 0.3);
    g.fillStyle = q.rgba(d.light, 1);
    for (let k = 0; k < d.motes; k++) {
      const x = d.x0 + K.math.wrap(d.mx[k] + 6 * t * d.mv[k], 0, d.W), y = d.y0 + K.math.wrap(d.my[k] - 4 * t * d.mv[k], 0, d.H);
      const off = Math.abs(Math.atan2(x - d.ax, y - d.ay) - th);
      if (off > half) continue;
      g.globalAlpha = a0 * d.alpha * 0.6 * (1 - off / half) * (0.5 + 0.5 * Math.sin(d.mv[k] * 9 + t));
      g.fillRect(x, y, 2.4, 2.4);
    }
    g.globalAlpha = a0;
  }

  const spotBeam = K.ground({
    key: 'spotBeam',
    label: { ja: '照明', en: 'Spot beam' },
    blurb: { ja: '柔らかなスポットライトの光がゆっくり振れる', en: 'A soft spotlight cone that sweeps slowly' },
    tags: ['dark', 'serious'],
    params: {
      spread: { type: 'num', min: 8, max: 50, step: 0.5, unit: 'deg', label: { ja: '光の幅', en: 'Spread' }, auto: { range: [18, 28] } },
      sweep: { type: 'num', min: 0, max: 40, step: 0.5, unit: 'deg', label: { ja: '振れ幅', en: 'Sweep' }, auto: { range: [8, 20] } },
      speed: { type: 'num', min: 0, max: 0.2, step: 0.005, unit: 'Hz', label: { ja: '振れる速さ', en: 'Sweep speed' },
        auto: { range: [0.03, 0.07], follow: 'energy' } },
      tone: { type: 'ink', label: { ja: '光の色', en: 'Light color' }, auto: { pick: ['ink', 'accent', 'shiftB'], weights: [3, 1, 1] } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const area = areaOf(D), motes = 28;
      const mx = new Float32Array(motes), my = new Float32Array(motes), mv = new Float32Array(motes);
      for (let k = 0; k < motes; k++) { mx[k] = rng.range(0, area.W); my[k] = rng.range(0, area.H); mv[k] = rng.range(0.4, 1.4); }
      const lightGround = luminance(pal.ground) > luminance(pal.ink);
      const tone = lightGround ? K.color.mix(hexOf(pal, p.tone), '#FFFFFF', 0.85) : hexOf(pal, p.tone);
      paint(env, Object.assign(area, {
        fill: pal.ground, edge: readable(pal, '#000000', 0.5),
        light: readable(pal, tone, lightGround ? 0.9 : 0.25 + 0.45 * p.amount, BEAM),
        ax: D.w * rng.range(0.38, 0.62), ay: -0.14 * D.h, spread: p.spread * K.math.DEG, sweep: p.sweep * K.math.DEG, speed: p.speed,
        phase: rng.range(0, TAU), alpha: 0.7 + 0.3 * p.amount, motes, mx, my, mv,
      }), beamDraw, true);
    },
  });

  return [nightBokeh, neonHaze, spotBeam];
});
