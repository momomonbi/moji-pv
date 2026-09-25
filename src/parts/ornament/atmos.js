/* 文字PVメーカー v2 — original work. Atmosphere over a whole segment: rain lines, bokeh dots (DESIGN §5.6, scope 'run'). */
MV.def('parts/ornament/atmos', ['parts/kit'], (K) => {
  'use strict';

  const MARGIN = 0.15;             // share of the frame covered beyond each edge (the far and near layers move with the camera)
  const CALM_FLOOR = 0.45;         // lights behind the text dim to this share where lyrics usually sit (the middle of the frame)
  const NEAR_FLOOR = 0.12;         // … and lights in front of it to this share, so they never veil a glyph
  const TAU = K.math.TAU;
  const DEG = K.math.DEG;

  function areaOf(D) {
    return { w: D.w, h: D.h, x0: -MARGIN * D.w, y0: -MARGIN * D.h, W: D.w * (1 + 2 * MARGIN), H: D.h * (1 + 2 * MARGIN) };
  }

  // Frames of other aspects get the same density per area as a 16:9 frame.
  function densityScale(D) { return (D.w * D.h) / (1920 * 1080); }

  // 1 away from the middle of the frame, down to the layer's floor (d.floor) where lyrics usually sit.
  function calm(d, x, y) {
    const e = Math.hypot((x - d.w / 2) / (0.38 * d.w), (y - d.h / 2) / (0.3 * d.h));
    return d.floor + (1 - d.floor) * K.math.smooth(e - 0.4);
  }

  function floorOf(layer) { return layer === 'near' ? NEAR_FLOOR : CALM_FLOOR; }

  // --- rainLines --------------------------------------------------------------------------------------------------------

  // Streaks falling along the slant (closed form: the distance fallen wraps over the area), one stroke per layer.
  function rainDraw(g, t, d, q) {
    const sx = Math.sin(d.slant), cy = Math.cos(d.slant), tan = sx / cy;
    g.beginPath();
    for (let k = 0; k < d.n; k++) {
      const fall = K.math.wrap(d.py[k] + d.speed * d.pace[k] * t, 0, d.H + d.len);
      const y = d.y0 + fall - d.len * 0.5, x = d.x0 + K.math.wrap(d.px[k] + fall * tan, 0, d.W);
      const L = d.len * d.pace[k];
      g.moveTo(x, y); g.lineTo(x - sx * L, y - cy * L);
    }
    g.strokeStyle = q.rgba(d.ink, d.alpha);
    g.lineWidth = d.width;
    g.lineCap = 'round';
    g.stroke();
  }

  function rainLayer(env, p, layer, share, lenK, speedK, width, alpha) {
    const { D, rng } = env;
    const area = areaOf(D), n = Math.max(1, Math.round(p.drops * share * densityScale(D)));
    const px = new Float32Array(n), py = new Float32Array(n), pace = new Float32Array(n);
    for (let k = 0; k < n; k++) { px[k] = rng.next() * area.W; py[k] = rng.next() * area.H; pace[k] = rng.range(0.75, 1.25); }
    env.sb.paint({ layer, bleed: 0, animated: true, owner: env.owner, draw: rainDraw,
      data: Object.assign(area, { n, px, py, pace, slant: p.slant * DEG, speed: p.speed * speedK, len: p.length * lenK, width, alpha,
        ink: p.ink }) });
  }

  const rainLines = K.ornament({
    key: 'rainLines', scope: 'run', follow: 'own',
    label: { ja: '雨線', en: 'Rain lines' },
    blurb: { ja: '斜めの雨の筋が画面を横切る', en: 'Slanted rain streaks across the frame' },
    tags: ['wet', 'dark'],
    shared: { ink: { auto: { pick: ['ink', 'muted', 'shiftA'], weights: [2, 2, 1] } } },
    params: {
      drops: { type: 'int', min: 10, max: 400, label: { ja: '雨の量', en: 'Drops' }, auto: { range: [80, 140] } },
      slant: { type: 'num', min: -40, max: 40, step: 0.5, unit: 'deg', label: { ja: '傾き', en: 'Slant' }, auto: { range: [-18, -6] } },
      speed: { type: 'num', min: 300, max: 3000, step: 10, unit: 'du', label: { ja: '落ちる速さ（毎秒）', en: 'Fall (per second)' },
        auto: { range: [1300, 1900], follow: 'energy' } },
      length: { type: 'num', min: 20, max: 260, step: 1, unit: 'du', label: { ja: '筋の長さ', en: 'Streak length' }, auto: { range: [60, 110] } },
    },
    build(env, p) {
      rainLayer(env, p, 'far', 0.85, 0.75, 0.8, 1.5, 0.26 + 0.2 * p.amount);
      rainLayer(env, p, 'near', 0.1, 1.6, 1.3, 2.4, 0.12 + 0.1 * p.amount);
    },
  });

  // --- bokehDots --------------------------------------------------------------------------------------------------------

  // Soft discs (a unit radial gradient per colour) floating up and sideways, wrapping, twinkling; dimmer in the middle.
  function bokehDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    for (let c = 0; c < d.inks.length; c++) {
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, q.rgba(d.inks[c], 0.9)); grad.addColorStop(0.6, q.rgba(d.inks[c], 0.55)); grad.addColorStop(1, q.rgba(d.inks[c], 0));
      g.fillStyle = grad;
      for (let k = c; k < d.n; k += d.inks.length) {
        const r = d.r[k];
        const x = d.x0 - r + K.math.wrap(d.px[k] + d.vx[k] * t + 18 * Math.sin(d.ph[k] + 0.4 * t), 0, d.W + 2 * r);
        const y = d.y0 - r + K.math.wrap(d.py[k] - d.vy[k] * t, 0, d.H + 2 * r);
        g.globalAlpha = a0 * d.alpha * (0.55 + 0.45 * Math.sin(d.ph[k] * 2 + d.tw[k] * t)) * calm(d, x, y);
        g.save();
        g.translate(x, y); g.scale(r, r);
        g.fillRect(-1, -1, 2, 2);
        g.restore();
      }
    }
    g.globalAlpha = a0;
  }

  function bokehLayer(env, p, layer, share, sizeK, alpha) {
    const { D, rng } = env;
    const area = areaOf(D), n = Math.max(1, Math.round(p.dots * share * densityScale(D)));
    const f = () => new Float32Array(n);
    const px = f(), py = f(), r = f(), vx = f(), vy = f(), ph = f(), tw = f();
    for (let k = 0; k < n; k++) {
      r[k] = p.size * sizeK * rng.range(0.5, 1.2); px[k] = rng.next() * (area.W + 2 * r[k]); py[k] = rng.next() * (area.H + 2 * r[k]);
      vx[k] = p.drift * rng.range(-0.6, 0.6); vy[k] = p.drift * rng.range(0.4, 1.2); ph[k] = rng.range(0, TAU); tw[k] = rng.range(0.5, 1.6);
    }
    env.sb.paint({ layer, bleed: 0, animated: true, owner: env.owner, draw: bokehDraw,
      data: Object.assign(area, { n, px, py, r, vx, vy, ph, tw, alpha, floor: floorOf(layer), inks: [p.ink, 'shiftA', 'shiftB'] }) });
  }

  const bokehDots = K.ornament({
    key: 'bokehDots', scope: 'run', follow: 'own',
    label: { ja: '玉ぼけ', en: 'Bokeh dots' },
    blurb: { ja: 'やわらかな光の玉がふわりと漂う', en: 'Floating soft light dots' },
    tags: ['soft', 'wet'],
    shared: { ink: { auto: { pick: ['accent', 'shiftA', 'shiftB'] } } },
    params: {
      dots: { type: 'int', min: 4, max: 80, label: { ja: '玉の数', en: 'Dots' }, auto: { range: [16, 28] } },
      size: { type: 'num', min: 6, max: 160, step: 1, unit: 'du', label: { ja: '大きさ', en: 'Size' }, auto: { range: [32, 60] } },
      drift: { type: 'num', min: 0, max: 60, step: 0.5, unit: 'du', label: { ja: '漂う速さ（毎秒）', en: 'Drift (per second)' },
        auto: { range: [5, 14], follow: 'energy' } },
    },
    build(env, p) {
      bokehLayer(env, p, 'far', 0.75, 1.3, 0.25 + 0.2 * p.amount);
      bokehLayer(env, p, 'near', 0.25, 0.7, 0.18 + 0.14 * p.amount);
    },
  });

  return [rainLines, bokehDots];
});
