/* 文字PVメーカー v2 — original work. Timed weather overlays adapted from the supplied realistic-clouds.html and realistic-puddle.html. */
MV.def('parts/ornament/weather', ['parts/kit'], (K) => {
  'use strict';
  const C = K.cinematic, TAU = K.math.TAU;
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const smooth = (v) => { const x = clamp(v); return x * x * (3 - 2 * x); };
  const L = (ja, en) => ({ ja, en });

  // The original files' seeded coherent-noise permutation and quintic interpolation. Evaluating advection directly
  // replaces the original fluid solver's accumulated state: seeking to a frame never needs its preceding frames.
  class CoherentNoise {
    constructor(seed) {
      const a = Uint8Array.from({ length: 256 }, (_, i) => i);
      let state = seed | 0;
      const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
      this.p = new Uint8Array(512);
      for (let i = 255; i > 0; i--) { const j = Math.floor(random() * (i + 1)), tmp = a[i]; a[i] = a[j]; a[j] = tmp; }
      for (let i = 0; i < 512; i++) this.p[i] = a[i & 255];
    }
    noise(x, y, z = 0) {
      const p = this.p, ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
      const X = ix & 255, Y = iy & 255, Z = iz & 255; x -= ix; y -= iy; z -= iz;
      const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10), mix = (a, b, t) => a + (b - a) * t;
      const grad = (h, xx, yy, zz) => {
        h &= 15; const u = h < 8 ? xx : yy, v = h < 4 ? yy : h === 12 || h === 14 ? xx : zz;
        return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
      };
      const u = fade(x), v = fade(y), w = fade(z), A = p[X] + Y, B = p[X + 1] + Y;
      const AA = p[A] + Z, AB = p[A + 1] + Z, BA = p[B] + Z, BB = p[B + 1] + Z;
      return mix(mix(mix(grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z), u),
        mix(grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z), u), v),
      mix(mix(grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1), u),
        mix(grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1), u), v), w);
    }
    fbm(x, y, z = 0, octaves = 4) {
      let sum = 0, a = 0.5, norm = 0;
      for (let i = 0; i < octaves; i++) {
        sum += this.noise(x, y, z) * a; norm += a; x = x * 2.03 + 11.7; y = y * 2.01 + 7.3; z = z * 2.02 + 3.1; a *= 0.5;
      }
      return sum / norm;
    }
  }

  function quietCenter(d, x, y) {
    const distance = Math.hypot((x - d.w * 0.5) / (d.w * 0.36), (y - d.h * 0.48) / (d.h * 0.25));
    return (d.layer === 'near' ? 0.18 : 0.42) + (d.layer === 'near' ? 0.82 : 0.58) * smooth(distance - 0.25);
  }

  function rgbHex(r, g, b) {
    return '#' + [r, g, b].map((n) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')).join('');
  }

  // CloudAtmosphere's original fourth-power height envelope, fBm macro density and warm/cool silver scattering.
  // Soft overlapping volume cells keep the host's Canvas 2D and alpha exports; no opaque sky is painted.
  function cloudDraw(g, t, d, q) {
    const f = C.frame(t, d, q);
    if (!f.active || d.density <= 0) return;
    const nx = q.draft ? 22 : 36, ny = q.draft ? 13 : 22, cw = d.w / nx, ch = d.h / ny;
    const drift = f.time * d.wind * 0.007, night = d.mode === 'night', warm = d.mode === 'sunset';
    const sunY = warm ? 0.56 : night ? 0.27 : 0.38, aspect = d.w / d.h;
    const alpha0 = g.globalAlpha;
    // Four scattering shades are shared by every volume cell, so dense clouds keep the paint gradient budget.
    const gradients = d.colors.map((color) => {
      const gradient = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      gradient.addColorStop(0, q.rgba(color, 0.36)); gradient.addColorStop(0.38, q.rgba(color, 0.27));
      gradient.addColorStop(1, q.rgba(color, 0)); return gradient;
    });
    for (let j = -1; j <= ny; j++) for (let i = -1; i <= nx; i++) {
      const xn = (i + 0.5) / nx, yn = (j + 0.5) / ny;
      const px = xn * 3.1 - drift, py = yn * 3.2 + Math.sin(drift * 0.7) * 0.08;
      const envelope = Math.exp(-Math.pow((yn - d.altitude) / d.thickness, 4));
      const macro = clamp((d.noise.fbm(px, py, 9 + f.time * 0.012) + 0.16) * 3, 0, 1.5) * envelope;
      const density = Math.max(0, macro * d.density * 1.7 - (night ? 0.08 : 0));
      if (density < 0.025) continue;
      const detail = d.noise.fbm(px * 5 + 4, py * 5 + 7, f.time * 0.04, 3);
      const rho = Math.max(0, density - 0.14 + detail * 0.5), extinction = Math.exp(-rho * 0.84 * 2.4);
      const direct = Math.exp(-Math.max(0, density + d.noise.noise(px + 0.3, py - 0.25, 9)) * 0.42 * 3);
      const lx = (0.7 - xn) * aspect, ly = sunY - yn, cosine = 0.45 / Math.sqrt(lx * lx + ly * ly + 0.2025), scatter = 0.62;
      const phase = (1 - scatter * scatter) / Math.pow(1 + scatter * scatter - 2 * scatter * cosine, 1.5);
      const multi = 0.09 + 0.16 * (1 - Math.exp(-rho * 2));
      const silver = direct * (0.48 + phase * 0.17) * (1 + Math.pow(Math.max(0, 1 - density), 2) * 1.4);
      const r = night ? multi * 0.12 + silver * 0.47 : multi * 0.55 + silver * (warm ? 1.9 : 1.5);
      const gg = night ? multi * 0.18 + silver * 0.58 : multi * 0.63 + silver * (warm ? 1.1 : 1.45);
      const b = night ? multi * 0.3 + silver * 0.8 : multi * 0.92 + silver * (warm ? 0.63 : 1.5);
      const x = xn * d.w + detail * cw * 0.28, y = yn * d.h;
      const gradient = gradients[clamp(Math.floor((r + gg + b) * 1.5), 0, 3)];
      g.save(); g.translate(x, y); g.scale(cw * (1.25 + density * 0.55), ch * (1.05 + density * 0.4));
      g.globalAlpha = alpha0 * f.alpha * (1 - extinction) * quietCenter(d, x, y); g.fillStyle = gradient;
      g.fillRect(-1, -1, 2, 2); g.restore();
    }
    g.globalAlpha = alpha0;
  }

  const fluidClouds = K.ornament({
    key: 'fluidClouds', scope: 'run', follow: 'own', pool: false, family: 'cinematic',
    label: L('雲の余韻', 'Fluid clouds'),
    blurb: L('夕焼け・昼・夜の雲が風に流れ、光が雲の縁ににじむ', 'Wind carries sunset, daylight or night clouds with softly lit silver edges'),
    tags: ['soft', 'airy'],
    params: Object.assign({}, C.params, {
      mode: { type: 'enum', of: ['sunset', 'day', 'night'], optKey: 'cinematicCloudMode', label: L('空の光', 'Sky light'), auto: { value: 'sunset' } },
      density: { type: 'num', min: 0, max: 1.5, step: 0.01, label: L('雲の厚み', 'Cloud density'), auto: { value: 0.72 } },
      wind: { type: 'num', min: 0, max: 14, step: 0.1, label: L('風の速さ', 'Wind speed'), auto: { value: 4.5 } },
      altitude: { type: 'num', min: 0.05, max: 0.9, step: 0.01, unit: 'frac', label: L('雲の高さ', 'Cloud height'), auto: { value: 0.34 } },
      thickness: { type: 'num', min: 0.1, max: 0.5, step: 0.01, unit: 'frac', label: L('雲の広がり', 'Cloud spread'), auto: { value: 0.25 }, ui: 'advanced' },
      color: { type: 'ink', label: L('光の色', 'Light color'), auto: { value: 'accent' } },
    }),
    build(env, p) {
      const data = Object.assign(C.setup(env, p), { noise: new CoherentNoise(p.seed), mode: p.mode, density: p.density,
        wind: p.wind, altitude: p.altitude, thickness: p.thickness, tint: C.color(env.pal, p.color) });
      const night = p.mode === 'night', warm = p.mode === 'sunset';
      const tone = (v) => Math.pow(1 - Math.exp(-Math.max(0, v) * (night ? 0.9 : 1.35)), 1 / 2.2) * 255;
      data.colors = Array.from({ length: 4 }, (_, i) => {
        const silver = 0.08 + i * 0.28, multi = 0.18;
        const r = night ? multi * 0.12 + silver * 0.47 : multi * 0.55 + silver * (warm ? 1.9 : 1.5);
        const g = night ? multi * 0.18 + silver * 0.58 : multi * 0.63 + silver * (warm ? 1.1 : 1.45);
        const b = night ? multi * 0.3 + silver * 0.8 : multi * 0.92 + silver * (warm ? 0.63 : 1.5);
        return C.color(env.pal, K.color.mix(rgbHex(tone(r), tone(g), tone(b)), data.tint, 0.12));
      });
      env.sb.paint({ layer: data.layer, bleed: 0, animated: true, owner: env.owner, data, draw: cloudDraw });
    },
  });

  // PuddleSurface's rough elliptical shore, the same 0.02037 Fresnel base and mirrored world-light projection.
  // Closed-form damped concentric waves replace its finite-difference height history and random rain injection.
  // This overlay reflects its own small city-light field, preserving any user illustration beneath it.
  function shoreline(g, d) {
    g.beginPath();
    for (let i = 0; i < d.shore.length; i += 2) {
      const x = d.cx + d.shore[i] * d.rx, y = d.cy + d.shore[i + 1] * d.ry;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.closePath();
  }

  function reflectionDraw(g, time, d, q, alpha) {
    const focal = d.h * 0.92, horizon = d.h * 0.49;
    const density = q.draft ? 8 : 15;
    const minimumStroke = 0.85 / Math.max(0.05, q.scale || 1), glows = new Map();
    for (const light of d.lights) if (!glows.has(light.color)) {
      const glow = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      glow.addColorStop(0, q.rgba(light.color, 0.65)); glow.addColorStop(0.35, q.rgba(light.color, 0.18));
      glow.addColorStop(1, q.rgba(light.color, 0)); glows.set(light.color, glow);
    }
    for (const light of d.lights) {
      const scale = focal / light.z, sourceX = d.w * 0.53 + light.x * scale, sourceY = horizon + (0.26 + light.y) * scale;
      // Preserve the source camera's mirror projection, fitting its original .565–.995H water box to this overlay.
      const x = d.cx + (sourceX / d.w - 0.5) / 0.475 * d.rx;
      const y = d.cy - d.ry + (sourceY / d.h - 0.565) / 0.43 * d.ry * 2;
      const view = (sourceY - horizon) / focal, facing = view / Math.sqrt(1 + view * view);
      const fresnel = 0.02037 + 0.97963 * Math.pow(1 - clamp(facing), 5);
      const span = (30 + light.y * 17) * d.h / 1080, width = Math.max(d.w / 650, scale * light.width * 1.35);
      g.save(); g.translate(x, y); g.scale(width * 5, span * 1.25);
      g.globalAlpha = alpha * d.reflection * fresnel * 0.3; g.fillStyle = glows.get(light.color); g.fillRect(-1, -1, 2, 2); g.restore();
      for (let j = 0; j < density; j++) {
        const v = (j + 0.5) / density, yy = y + (v - 0.5) * span;
        const wave = Math.sin(time * 1.7 + yy * 0.063 + light.phase) + Math.sin(time * -1.1 + yy * 0.019 + x * 0.004) * 0.6;
        const dx = wave * (1 + d.wind * 0.2) * d.w / 350;
        const brightness = Math.pow(1 - Math.abs(v * 2 - 1), 0.6) * fresnel;
        g.globalAlpha = alpha * d.reflection * brightness;
        g.strokeStyle = q.rgba(light.color, 1); g.lineWidth = Math.max(minimumStroke, 1.5, span / density * 0.7);
        g.beginPath(); g.moveTo(x + dx - width * (0.7 + wave * 0.15), yy);
        g.lineTo(x + dx + width * (0.7 + wave * 0.15), yy); g.stroke();
      }
    }
  }

  function puddleDraw(g, t, d, q) {
    const f = C.frame(t, d, q);
    if (!f.active) return;
    const alpha0 = g.globalAlpha;
    g.globalCompositeOperation = 'source-over'; g.lineCap = 'round'; g.lineJoin = 'round';
    g.save(); shoreline(g, d); g.clip();
    const water = g.createLinearGradient(0, d.cy - d.ry, 0, d.cy + d.ry);
    water.addColorStop(0, q.rgba(d.water, 0.18)); water.addColorStop(0.6, q.rgba(d.water, 0.48)); water.addColorStop(1, q.rgba(d.water, 0.22));
    g.globalAlpha = alpha0 * f.alpha; g.fillStyle = water; g.fillRect(d.cx - d.rx, d.cy - d.ry, d.rx * 2, d.ry * 2);
    reflectionDraw(g, f.time, d, q, alpha0 * f.alpha);
    g.strokeStyle = q.rgba(d.ripple, 1);
    const count = q.draft ? Math.ceil(d.drops.length / 2) : d.drops.length;
    for (let i = 0; i < count; i++) {
      const drop = d.drops[i], progress = K.math.wrap(f.time + drop.phase, 0, drop.life) / drop.life;
      const x = d.cx + drop.x * d.rx, y = d.cy + drop.y * d.ry;
      const r = Math.max(0.1, progress * drop.radius), opacity = Math.pow(1 - progress, 1.35) * d.rain;
      if (opacity < 0.003) continue;
      for (let ring = 0; ring < 3; ring++) {
        g.globalAlpha = alpha0 * f.alpha * opacity * (0.9 / (ring + 1));
        g.lineWidth = Math.max(1.5, d.short / 720, 0.85 / Math.max(0.05, q.scale || 1));
        g.beginPath(); g.ellipse(x, y, r * (1 - ring * 0.16), r * (0.22 - ring * 0.025), 0, 0, TAU); g.stroke();
      }
    }
    g.restore();
    // The source's two-depth slanted rain streaks, kept quiet around the words.
    const drops = Math.round(d.rain * (q.draft ? 26 : 56));
    g.strokeStyle = q.rgba(d.ripple, 1); g.lineWidth = Math.max(1.15, d.short / 1000, 0.6 / Math.max(0.05, q.scale || 1));
    for (let k = 0; k < drops; k++) {
      const x = K.math.wrap(k * 97.13 / 1080 * d.short + f.time * (11 + d.wind * 3), 0, d.w);
      const y = K.math.wrap(k * 137.71 / 1080 * d.short + f.time * (260 + (k % 2) * 300), 0, d.h);
      g.globalAlpha = alpha0 * f.alpha * 0.2 * quietCenter(d, x, y);
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (1 + d.wind * 0.2) * d.short / 650, y + d.short * (k % 2 ? 0.012 : 0.005)); g.stroke();
    }
    g.globalAlpha = alpha0;
  }

  const wavePuddle = K.ornament({
    key: 'wavePuddle', scope: 'run', follow: 'own', pool: false, family: 'cinematic',
    label: L('雨の記憶', 'Rain and reflections'),
    blurb: L('水たまりに雨の輪が重なり、街の光がゆっくり揺れる', 'Rain rings overlap in a puddle as reflected city lights gently shimmer'),
    tags: ['wet', 'soft', 'dark'],
    params: Object.assign({}, C.params, {
      rain: { type: 'num', min: 0, max: 1, step: 0.01, label: L('雨量', 'Rain amount'), auto: { value: 0.55 } },
      wind: { type: 'num', min: 0, max: 14, step: 0.1, label: L('風の速さ', 'Wind speed'), auto: { value: 2 } },
      reflection: { type: 'num', min: 0, max: 1, step: 0.01, label: L('光の映り込み', 'Light reflection'), auto: { value: 0.75 } },
      spread: { type: 'num', min: 0.3, max: 1, step: 0.01, unit: 'frac', label: L('水面の広がり', 'Water spread'), auto: { value: 0.94 } },
      height: { type: 'num', min: 0.1, max: 0.45, step: 0.01, unit: 'frac', label: L('水面の高さ', 'Water height'), auto: { value: 0.34 }, ui: 'advanced' },
      color: { type: 'ink', label: L('水と雨の色', 'Water and rain color'), auto: { value: 'shiftA' } },
    }),
    build(env, p) {
      const data = Object.assign(C.setup(env, p), { rain: p.rain, wind: p.wind, reflection: p.reflection });
      const random = C.random(p.seed + 163), noise = new CoherentNoise(p.seed + 163);
      data.rx = data.w * 0.5 * p.spread; data.ry = data.h * p.height * 0.5;
      data.cx = data.w * 0.5; data.cy = data.h * (1 - p.height * 0.5 - 0.015);
      data.water = C.color(env.pal, K.color.mix('#152536', C.color(env.pal, p.color), 0.2));
      data.ripple = C.color(env.pal, K.color.mix('#BBD0E2', C.color(env.pal, p.color), 0.18));
      data.shore = new Float32Array(192);
      for (let i = 0; i < 96; i++) {
        const a = i / 96 * TAU, x = Math.cos(a), y = Math.sin(a);
        const rough = 0.085 * noise.fbm(x * 3, y * 3, 2, 4) + 0.055 * Math.sin(a * 5 + 1) + 0.035 * Math.sin(a * 9);
        data.shore[i * 2] = x * (1 + rough); data.shore[i * 2 + 1] = y * (1 + rough);
      }
      data.lights = [];
      for (let n = 0; n < 12; n++) for (const side of [-1, 1]) {
        data.lights.push({ x: side * 3.55, y: 3.5 + (n % 3) * 0.35, z: 8 + n * n * 1.1 + n * 2.9 + (side > 0 ? 3.2 : 0),
          width: 0.045, color: C.color(env.pal, side < 0 ? '#FFC16A' : '#E2DFAC'), phase: random() * TAU });
      }
      const stops = [4.8, 8.5, 13, 19, 27, 38, 53, 74, 103, 145];
      for (let n = 0; n < stops.length - 1; n++) for (const side of [-1, 1]) {
        if (side > 0 && n % 3 !== 0) continue;
        data.lights.push({ x: side * 4.2, y: 1.55, z: (stops[n] + stops[n + 1]) * 0.5,
          width: 0.22, color: C.color(env.pal, side < 0 ? '#FFCD69' : '#74DAE7'), phase: random() * TAU });
      }
      data.drops = [];
      for (let i = 0; i < 52; i++) {
        const a = random() * TAU, r = Math.sqrt(random()) * 0.84;
        data.drops.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, phase: random() * 4,
          life: 1.3 + random() * 2.8, radius: data.short * (0.025 + random() * 0.038) });
      }
      env.sb.paint({ layer: data.layer, bleed: 0, animated: true, owner: env.owner, data, draw: puddleDraw });
    },
  });

  return [fluidClouds, wavePuddle];
});
