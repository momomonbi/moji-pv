/* 文字PVメーカー v2 — original work. Paper backgrounds: washi fiber, ink wash (DESIGN §5.5). */
MV.def('parts/ground/paper', ['parts/kit'], (K) => {
  'use strict';

  const BLEED = 0.15;              // share of the frame painted beyond each edge, so camera moves never show an edge
  const FIELD = 5.5;               // least ink contrast of any colour that may sit behind the text
  const ACCENT_KEEP = 0.72;        // … and the share of the accent's contrast with the ground it keeps
  const FULL_HD = 1920 * 1080;     // densities are given per frame of this area and scaled to the aspect
  const EDGE = 3.2;                // least ink contrast of a colour kept out of the middle of the frame
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
  // own contrast.
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

  // --- washiFiber -------------------------------------------------------------------------------------------------------

  // Fiber i of a Float32Array list laid out as [x, y, dx, dy, bendX, bendY] per fiber: a gentle quadratic stroke.
  function fiberPath(g, f, from, to, ox) {
    for (let i = from; i < to; i++) {
      const o = i * 6, x = f[o] + ox, y = f[o + 1];
      g.moveTo(x, y);
      g.quadraticCurveTo(x + f[o + 2] / 2 + f[o + 4], y + f[o + 3] / 2 + f[o + 5], x + f[o + 2], y + f[o + 3]);
    }
  }

  const FIBER_ALPHA = Object.freeze([0.32, 0.5, 0.85]);    // fine, medium and pale fibers
  const FIBER_WIDTH = Object.freeze([0.8, 1.4, 1.6]);

  // The paper itself (drawn once and cached): uneven tone, fibers in three weights, bark flecks.
  function paperDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    g.fillStyle = d.fill;
    g.fillRect(d.x0, d.y0, d.W, d.H);
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, q.rgba(d.tone, 1)); grad.addColorStop(1, q.rgba(d.tone, 0));
    g.fillStyle = grad;
    for (let k = 0; k < d.blotches.length; k += 5) {
      const b = d.blotches;
      g.save();
      g.translate(b[k], b[k + 1]); g.scale(b[k + 2], b[k + 3]);
      g.globalAlpha = a0 * b[k + 4];
      g.fillRect(-1, -1, 2, 2);
      g.restore();
    }
    for (let c = 0; c < 3; c++) {
      g.beginPath();
      fiberPath(g, d.fibers, d.split[c], d.split[c + 1], 0);
      g.strokeStyle = q.rgba(c === 2 ? d.pale : d.fiber, FIBER_ALPHA[c] * d.strength);
      g.lineWidth = FIBER_WIDTH[c];
      g.stroke();
    }
    g.beginPath();
    for (let k = 0; k < d.flecks.length; k += 4) {
      const f = d.flecks;
      g.moveTo(f[k] + f[k + 2], f[k + 1]);
      g.ellipse(f[k], f[k + 1], f[k + 2], f[k + 3], 0, 0, TAU);
    }
    g.fillStyle = q.rgba(d.fiber, 0.35 * d.strength);
    g.fill();
    g.globalAlpha = a0;
  }

  // A few long fibers floating over the paper, drifting sideways (wrapped) and turning a little.
  function driftDraw(g, t, d, q) {
    g.beginPath();
    for (let i = 0; i < d.n; i++) {
      const o = i * 6, f = d.fibers;
      const x = d.x0 + K.math.wrap(f[o] - d.x0 + d.speed * d.pace[i] * t, 0, d.W);
      const turn = 0.12 * Math.sin(0.19 * t + d.pace[i] * 5);
      const c = Math.cos(turn), s = Math.sin(turn);
      const dx = f[o + 2] * c - f[o + 3] * s, dy = f[o + 2] * s + f[o + 3] * c;
      g.moveTo(x, f[o + 1]);
      g.quadraticCurveTo(x + dx / 2 + f[o + 4], f[o + 1] + dy / 2 + f[o + 5], x + dx, f[o + 1] + dy);
    }
    g.strokeStyle = q.rgba(d.fiber, 0.3 * d.strength);
    g.lineWidth = 1.2;
    g.stroke();
  }

  // n fibers [x, y, dx, dy, bendX, bendY] with lengths in [lo, hi] (short ones more likely).
  function makeFibers(rng, area, n, lo, hi) {
    const f = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const len = lo + (hi - lo) * Math.pow(rng.next(), 2.2), a = rng.range(0, TAU), bend = rng.range(-0.3, 0.3) * len;
      const o = i * 6;
      f[o] = area.x0 + rng.next() * area.W; f[o + 1] = area.y0 + rng.next() * area.H;
      f[o + 2] = Math.cos(a) * len; f[o + 3] = Math.sin(a) * len;
      f[o + 4] = -Math.sin(a) * bend; f[o + 5] = Math.cos(a) * bend;
    }
    return f;
  }

  // The data of a sheet of paper: tone blotches, `fibers` (0..1) worth of fibers in `tone`, flecks; scale = the area
  // relative to a 16:9 frame, so every aspect gets the same density.
  function paperData(env, fibers, tone, strength) {
    const { pal, D, rng } = env;
    const area = areaOf(D), scale = (area.W * area.H) / (FULL_HD * (1 + 2 * BLEED) * (1 + 2 * BLEED));
    const n = Math.round((260 + 640 * fibers) * scale);
    const blotches = [], flecks = [];
    for (let k = 0; k < 9; k++) {
      const r = D.short * rng.range(0.25, 0.6);
      blotches.push(area.x0 + rng.next() * area.W, area.y0 + rng.next() * area.H, r * rng.range(1, 1.8), r, rng.range(0.15, 0.4));
    }
    for (let k = 0; k < Math.round(46 * scale * (0.4 + fibers)); k++) {
      flecks.push(area.x0 + rng.next() * area.W, area.y0 + rng.next() * area.H, rng.range(1.2, 3.6), rng.range(0.6, 1.4));
    }
    const lightGround = luminance(pal.ground) > luminance(pal.ink);
    return Object.assign(area, {
      scale, strength, fill: pal.ground, tone: readable(pal, K.color.mix(pal.ground2, pal.muted, 0.25), 0.8),
      blotches: Float32Array.from(blotches), fibers: makeFibers(rng, area, n, 14, 110),
      split: [0, Math.round(n * 0.55), Math.round(n * 0.85), n], flecks: Float32Array.from(flecks),
      fiber: readable(pal, tone, 0.8), pale: readable(pal, lightGround ? '#FFFFFF' : pal.ink, 0.6),
    });
  }

  const washiFiber = K.ground({
    key: 'washiFiber',
    label: { ja: '和紙', en: 'Washi fiber' },
    blurb: { ja: 'むらのある和紙に、繊維がゆっくり漂う', en: 'Paper with slowly drifting fibers and uneven tone' },
    tags: ['organic', 'literary', 'soft'],
    params: {
      fibers: { type: 'num', min: 0, max: 1, step: 0.01, label: { ja: '繊維の量', en: 'Fibers' }, auto: { range: [0.45, 0.8] } },
      drift: { type: 'num', min: 0, max: 20, step: 0.1, unit: 'du', label: { ja: '漂う速さ（毎秒）', en: 'Drift (per second)' },
        auto: { range: [1.5, 5], follow: 'energy' } },
      tone: { type: 'ink', label: { ja: '繊維の色', en: 'Fiber color' }, auto: { pick: ['muted', 'ground2', 'shiftB'], weights: [3, 2, 1] } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const paper = paperData(env, p.fibers, hexOf(pal, p.tone), 0.55 + 0.45 * p.amount);
      paint(env, paper, paperDraw, false);
      if (p.drift > 0) {
        const m = Math.round(22 * paper.scale);
        const pace = new Float32Array(m);
        for (let i = 0; i < m; i++) pace[i] = rng.range(0.5, 1.5);
        paint(env, Object.assign(areaOf(D), { n: m, fibers: makeFibers(rng, paper, m, 70, 190), pace, speed: p.drift,
          strength: paper.strength, fiber: paper.fiber }), driftDraw, true);
      }
    },
  });

  // --- inkWash ----------------------------------------------------------------------------------------------------------

  // Marbled rings around a few centres (suminagashi): each ring wobbles with two slow waves, the outer rings turn
  // against the inner ones, and a gentle flow field bends everything, as if the water had been breathed on.
  function washDraw(g, t, d, q) {
    g.fillStyle = d.fill;
    g.fillRect(d.x0, d.y0, d.W, d.H);
    const steps = q.draft ? 36 : 64;
    const fx = 0.0036, fy = 0.0029, flow = d.flow, fp = 0.07 * t;
    for (let c = 0; c < d.centres.length; c += 3) {
      const cx = d.centres[c], cy = d.centres[c + 1], ph = d.centres[c + 2];
      const spin = d.turn * t + ph;
      for (let k = 1; k <= d.rings; k++) {
        const r = k * d.spacing, twist = spin + 0.5 * Math.sin(0.09 * t + ph + k * 0.37) * k / d.rings;
        g.beginPath();
        for (let s = 0; s <= steps; s++) {
          const a = (s / steps) * TAU;
          const rr = r * (1 + 0.12 * Math.sin(3 * a + ph + 0.21 * t) + 0.07 * Math.sin(5 * a - ph * 2 - 0.13 * t));
          let x = cx + Math.cos(a + twist) * rr, y = cy + Math.sin(a + twist) * rr * 0.88;
          x += flow * Math.sin(y * fy + fp + ph);
          y += flow * 0.6 * Math.sin(x * fx - fp * 0.8);
          if (s === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.closePath();
        const bold = k % 3 !== 1;
        g.strokeStyle = q.rgba(bold ? d.ink : d.blue, d.alpha * (0.5 + 0.5 * (1 - k / (d.rings + 1))));
        g.lineWidth = bold ? d.width : d.width * 0.45;
        g.stroke();
      }
    }
  }

  const inkWash = K.ground({
    key: 'inkWash',
    label: { ja: '墨流し', en: 'Ink wash' },
    blurb: { ja: '墨流しの輪がゆっくり渦を巻く', en: 'Marbled ink swirls that turn slowly' },
    tags: ['organic', 'literary'],
    params: {
      rings: { type: 'int', min: 4, max: 24, label: { ja: '輪の数', en: 'Rings' }, auto: { range: [12, 18] } },
      spacing: { type: 'num', min: 10, max: 60, step: 0.5, unit: 'du', label: { ja: '輪の間隔', en: 'Ring spacing' }, auto: { range: [24, 36] } },
      turn: { type: 'num', min: -6, max: 6, step: 0.1, unit: 'deg', label: { ja: '回転（毎秒）', en: 'Turn (per second)' },
        auto: { pick: [-1.2, -0.6, 0.6, 1.2] } },
      centres: { type: 'int', min: 1, max: 4, label: { ja: '中心の数', en: 'Centres' }, auto: { pick: [2, 3] } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const centres = [];
      const spots = [[0.2, 0.25], [0.8, 0.75], [0.78, 0.2], [0.22, 0.8]];
      const first = rng.int(0, 3);
      for (let k = 0; k < p.centres; k++) {
        const [fx, fy] = spots[(first + k) % spots.length];
        centres.push(D.w * (fx + rng.range(-0.06, 0.06)), D.h * (fy + rng.range(-0.06, 0.06)), rng.range(0, TAU));
      }
      paint(env, Object.assign(areaOf(D), {
        fill: pal.ground, centres: Float32Array.from(centres), rings: p.rings, spacing: p.spacing, turn: p.turn * K.math.DEG,
        ink: readable(pal, pal.ink, 0.5 + 0.4 * p.amount), blue: readable(pal, pal.shiftA, 0.55 + 0.35 * p.amount),
        alpha: 0.7 + 0.3 * p.amount, width: p.spacing * 0.16, flow: D.short * 0.05,
      }), washDraw, true);
    },
  });

  // --- maplePaper -------------------------------------------------------------------------------------------------------

  // A maple (momiji) leaf outline in unit space: seven narrow, toothed lobes fanning out from the stem at the origin
  // (the top lobe's tip at y = −1), with deep notches between them.
  function mapleOutline() {
    const lobes = [[-202, 0.46], [-166, 0.74], [-128, 0.92], [-90, 1], [-52, 0.92], [-14, 0.74], [22, 0.46]];
    const edge = [[0.2, 0.07], [0.42, 0.13], [0.55, 0.12], [0.6, 0.145], [0.74, 0.1], [0.8, 0.11], [0.9, 0.05]];   // (u, half width) × L
    const pts = [0, 0.06];
    const put = (a, u, v) => pts.push(Math.cos(a) * u - Math.sin(a) * v, Math.sin(a) * u + Math.cos(a) * v);
    lobes.forEach(([deg, L], i) => {
      const a = deg * K.math.DEG;
      for (const [u, w] of edge) put(a, u * L, -w * L);
      put(a, L, 0);
      for (let j = edge.length - 1; j >= 0; j--) put(a, edge[j][0] * L, edge[j][1] * L);
      if (i < lobes.length - 1) put((deg + 19) * K.math.DEG, 0.2, 0);
    });
    return Float32Array.from(pts);
  }

  const MAPLE = mapleOutline();
  const VEINS = Object.freeze([-52, -128, -14, -166, 22, -202].flatMap((deg, i) => {
    const L = [0.8, 0.8, 0.62, 0.62, 0.38, 0.38][i], a = deg * K.math.DEG;
    return [Math.cos(a) * L, Math.sin(a) * L];
  }));

  function leafPath(g) {
    g.beginPath();
    g.moveTo(MAPLE[0], MAPLE[1]);
    for (let k = 2; k < MAPLE.length; k += 2) g.lineTo(MAPLE[k], MAPLE[k + 1]);
    g.closePath();
  }

  // Paper, then the leaves: [x, y, size, turn, colour index, alpha] each, veins in the paper's pale tone.
  function mapleDraw(g, t, d, q) {
    paperDraw(g, t, d, q);
    const a0 = g.globalAlpha;
    for (let k = 0; k < d.leaves.length; k += 6) {
      const L = d.leaves;
      g.save();
      g.translate(L[k], L[k + 1]); g.rotate(L[k + 3]); g.scale(L[k + 2], L[k + 2]);
      leafPath(g);
      g.globalAlpha = a0 * L[k + 5];
      g.fillStyle = d.colors[L[k + 4]];
      g.fill();
      g.beginPath();
      g.moveTo(0, 0.42); g.lineTo(0, -0.85);
      for (let v = 0; v < VEINS.length; v += 2) { g.moveTo(0, 0); g.lineTo(VEINS[v], VEINS[v + 1]); }
      g.lineWidth = 0.025;
      g.strokeStyle = q.rgba(d.vein, 0.5);
      g.stroke();
      g.restore();
    }
    g.globalAlpha = a0;
  }

  const maplePaper = K.ground({
    key: 'maplePaper', season: 'autumn', animated: false,
    label: { ja: '紅葉紙', en: 'Maple paper' },
    blurb: { ja: '紅葉の葉の影を散らした紙', en: 'Paper with scattered maple-leaf silhouettes' },
    tags: ['organic', 'literary'],
    params: {
      leaves: { type: 'int', min: 4, max: 48, label: { ja: '葉の数', en: 'Leaves' }, auto: { range: [10, 18] } },
      size: { type: 'num', min: 20, max: 240, step: 1, unit: 'du', label: { ja: '葉の大きさ', en: 'Leaf size' }, auto: { range: [70, 120] } },
    },
    build(env, p) {
      const { pal, D, rng } = env;
      const paper = paperData(env, 0.35, pal.muted, 0.5 + 0.3 * p.amount);
      const tones = ['#B93A26', '#D2742A', '#A8741E'].map((c) => K.color.mix(c, pal.accent, 0.25));
      // leaves in the middle of the frame, where lyrics sit, stay paler than those toward the edges
      const colors = tones.map((c) => readable(pal, c, 0.85, EDGE)).concat(tones.map((c) => readable(pal, c, 0.85)));
      const leaves = [];
      for (let k = 0, tries = 0; k < Math.round(p.leaves * paper.scale) && tries < 400; tries++) {
        const x = paper.x0 + rng.next() * paper.W, y = paper.y0 + rng.next() * paper.H;
        const e = Math.hypot((x - D.w / 2) / (0.36 * D.w), (y - D.h / 2) / (0.3 * D.h));
        if (e < 0.8 && rng.next() < 0.8) continue;
        const s = p.size * rng.range(0.55, 1.25) * (e < 1 ? 0.8 : 1);
        leaves.push(x, y, s, rng.range(-0.9, 0.9), rng.int(0, 2) + (e < 1 ? 3 : 0), (0.6 + 0.4 * p.amount) * rng.range(0.7, 1));
        k++;
      }
      paint(env, Object.assign(paper, { leaves: Float32Array.from(leaves), colors, vein: paper.pale }), mapleDraw, false);
    },
  });

  return [washiFiber, inkWash, maplePaper];
});
