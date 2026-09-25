/* 文字PVメーカー v2 — original work. Seasonal atmosphere: petal fall, firefly glow, firework bloom, leaf fall, snow dust (DESIGN §5.6, scope 'run'). */
MV.def('parts/ornament/season', ['parts/kit'], (K) => {
  'use strict';

  const MARGIN = 0.15;             // share of the frame covered beyond each edge (the far and near layers move with the camera)
  const CALM_FLOOR = 0.45;         // things behind the text dim to this share where lyrics usually sit (the middle of the frame)
  const GLOW_FLOOR = 0.3;          // … lights that add up behind it ('lighter' fireflies) to this share
  const NEAR_FLOOR = 0.12;         // … and things in front of it to this share, so they never veil a glyph
  const SAKURA = '#F4B4C6';        // the seasons' own colours, tinted by the part's ink (the theme's accent by default)
  const FIREFLY = '#E2F27C';
  const MAPLES = Object.freeze(['#C8402A', '#DE7A2C', '#D9A437', '#A8321F']);
  const KEY_GREEN = '#00B140';     // the green-screen key, the ground of a chroma palette (§4.16.3, §4.19.4)
  const PAPER = '#F2F2F2';         // a neutral light stand-in for the ground when the ground is the key green
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

  function floorOf(layer, behind) { return layer === 'near' ? NEAR_FLOOR : behind; }

  function hexOf(pal, ink) { return pal[ink] || ink; }

  // --- backdrop modes (§4.19.4): the colours the season parts make themselves -------------------------------------------

  // The atmospheres mix their own colours at build from the palette, so the frame palette of a backdrop mode never
  // reaches them. The planner's palette tells the modes apart (§4.16.3): black mode is a black ground under white ink
  // and accent, chroma mode a ground of the key green; normal and clear keep the theme's colours.
  function lum(hex) {
    const n = parseInt(hex.slice(1, 7), 16);
    return 0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
  }

  function backdropOf(pal) {
    const up = (hex) => String(hex).toUpperCase();
    if (up(pal.ground) === '#000000' && up(pal.ink) === '#FFFFFF' && up(pal.accent) === '#FFFFFF') return 'black';
    return up(pal.ground) === KEY_GREEN ? 'chroma' : 'scene';
  }

  // Dark ink on a light ground. The key green says nothing about the theme, so in chroma mode the ink alone decides.
  function lightTheme(pal) {
    return backdropOf(pal) === 'chroma' ? lum(pal.ink) < 128 : lum(pal.ground) > lum(pal.ink);
  }

  // A colour as the backdrop allows it: black mode draws only white and greys (a grey of the same lightness).
  function allowed(pal, hex) {
    if (backdropOf(pal) !== 'black') return hex;
    const v = Math.round(lum(hex)).toString(16).padStart(2, '0').toUpperCase();
    return '#' + v + v + v;
  }

  // Light adds up ('lighter') on a dark ground. Not on the key green: the sum would turn every spark partly green.
  function additive(pal) { return !lightTheme(pal) && backdropOf(pal) !== 'chroma'; }

  // --- falling shapes (petals, leaves): shared motion --------------------------------------------------------------------

  // n shapes with [x, y, size, phase, pace] each: they fall (wrapping over the area), sway, turn and flip (the x scale
  // follows a cosine, as a flat thing tumbling in the air).
  function fallers(rng, area, n, size) {
    const f = new Float32Array(n * 5);
    for (let k = 0; k < n; k++) {
      const o = k * 5;
      f[o] = rng.next() * area.W; f[o + 1] = rng.next() * area.H; f[o + 2] = size * rng.range(0.7, 1.3);
      f[o + 3] = rng.range(0, TAU); f[o + 4] = rng.range(0.7, 1.3);
    }
    return f;
  }

  // Transforms g for faller k at time t and returns its alpha; the caller fills its shape in unit space.
  function placeFaller(g, d, k, t) {
    const F = d.items, o = k * 5, pace = F[o + 4], ph = F[o + 3];
    const y = d.y0 + K.math.wrap(F[o + 1] + d.fall * pace * t, 0, d.H);
    const x = d.x0 + K.math.wrap(F[o] + d.wind * t + d.sway * Math.sin(ph + d.swayHz * TAU * t * pace), 0, d.W);
    const flip = Math.cos(ph * 2 + d.flipHz * TAU * t * pace);
    g.translate(x, y);
    g.rotate(ph + d.spin * t * (pace - 0.5));
    g.scale(F[o + 2] * (0.2 + 0.8 * Math.abs(flip)), F[o + 2]);
    return calm(d, x, y);
  }

  function fallDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    for (let k = 0; k < d.n; k++) {
      g.save();
      const c = placeFaller(g, d, k, t);
      d.shape(g);
      g.fillStyle = d.colors[k % d.colors.length];
      g.globalAlpha = a0 * d.alpha * c;
      g.fill();
      g.restore();
    }
    g.globalAlpha = a0;
  }

  function fallLayer(env, layer, o) {
    const { D, rng } = env;
    const area = areaOf(D), n = Math.max(1, Math.round(o.count * densityScale(D)));
    env.sb.paint({ layer, bleed: 0, animated: true, owner: env.owner, draw: fallDraw,
      data: Object.assign(area, { n, items: fallers(rng, area, n, o.size), shape: o.shape, colors: o.colors, alpha: o.alpha,
        floor: floorOf(layer, CALM_FLOOR),
        fall: o.fall, wind: o.wind, sway: o.sway, swayHz: o.swayHz, flipHz: o.flipHz, spin: o.spin }) });
  }

  // --- petalFall --------------------------------------------------------------------------------------------------------

  // A cherry petal in unit space: narrow at the base (y = −0.5), round, notched at the tip (y = 0.5).
  function petalShape(g) {
    g.beginPath();
    g.moveTo(0, -0.5);
    g.bezierCurveTo(0.42, -0.34, 0.4, 0.3, 0.1, 0.5);
    g.lineTo(0, 0.4);
    g.lineTo(-0.1, 0.5);
    g.bezierCurveTo(-0.4, 0.3, -0.42, -0.34, 0, -0.5);
    g.closePath();
  }

  const petalFall = K.ornament({
    key: 'petalFall', scope: 'run', follow: 'own', season: 'spring',
    shared: { ink: { auto: { value: 'accent' } } },
    label: { ja: '花びら', en: 'Petal fall' },
    blurb: { ja: '桜の花びらがひらひらと舞い落ちる', en: 'Cherry petals drifting down' },
    tags: ['soft', 'organic'],
    params: {
      petals: { type: 'int', min: 4, max: 120, label: { ja: '花びらの数', en: 'Petals' }, auto: { range: [26, 44] } },
      size: { type: 'num', min: 6, max: 90, step: 0.5, unit: 'du', label: { ja: '大きさ', en: 'Size' }, auto: { range: [28, 38] } },
      fall: { type: 'num', min: 5, max: 300, step: 1, unit: 'du', label: { ja: '落ちる速さ（毎秒）', en: 'Fall (per second)' },
        auto: { range: [45, 80], follow: 'energy' } },
    },
    build(env, p) {
      const pal = env.pal, pink = K.color.mix(SAKURA, hexOf(pal, p.ink), 0.15);
      const colors = [pink, K.color.mix(pink, '#FFFFFF', 0.45), K.color.mix(pink, pal.accent, 0.25)].map((c) => allowed(pal, c));
      const common = { shape: petalShape, colors, wind: 14, sway: 42, swayHz: 0.22, flipHz: 0.45, spin: 0.9 };
      fallLayer(env, 'far', Object.assign({}, common, { count: p.petals * 0.8, size: p.size, fall: p.fall, alpha: 0.55 + 0.35 * p.amount }));
      fallLayer(env, 'near', Object.assign({}, common, { count: p.petals * 0.1, size: p.size * 1.9, fall: p.fall * 1.5,
        alpha: 0.35 + 0.25 * p.amount }));
    },
  });

  // --- leafFall ---------------------------------------------------------------------------------------------------------

  // A maple (momiji) leaf in unit space, centred: seven narrow toothed lobes fanning out from the stem.
  function mapleOutline() {
    const lobes = [[-202, 0.46], [-166, 0.74], [-128, 0.92], [-90, 1], [-52, 0.92], [-14, 0.74], [22, 0.46]];
    const edge = [[0.2, 0.07], [0.42, 0.13], [0.55, 0.12], [0.6, 0.145], [0.74, 0.1], [0.8, 0.11], [0.9, 0.05]];
    const pts = [0, 0.06];
    const put = (a, u, v) => pts.push(Math.cos(a) * u - Math.sin(a) * v, Math.sin(a) * u + Math.cos(a) * v);
    lobes.forEach(([deg, L], i) => {
      const a = deg * DEG;
      for (const [u, w] of edge) put(a, u * L, -w * L);
      put(a, L, 0);
      for (let j = edge.length - 1; j >= 0; j--) put(a, edge[j][0] * L, edge[j][1] * L);
      if (i < lobes.length - 1) put((deg + 19) * DEG, 0.2, 0);
    });
    // the outline spans about y ∈ [−1, 0.45] around the stem: halve it and centre it
    return Float32Array.from(pts, (v, k) => (k % 2 ? v * 0.5 + 0.14 : v * 0.5));
  }

  const MAPLE = mapleOutline();

  function leafShape(g) {
    g.beginPath();
    g.moveTo(MAPLE[0], MAPLE[1]);
    for (let k = 2; k < MAPLE.length; k += 2) g.lineTo(MAPLE[k], MAPLE[k + 1]);
    g.closePath();
  }

  const leafFall = K.ornament({
    key: 'leafFall', scope: 'run', follow: 'own', season: 'autumn',
    shared: { ink: { auto: { value: 'accent' } } },
    label: { ja: '落ち葉', en: 'Leaf fall' },
    blurb: { ja: '紅葉した葉がくるくると舞い落ちる', en: 'Maple leaves tumbling down' },
    tags: ['organic', 'slow'],
    params: {
      leaves: { type: 'int', min: 2, max: 60, label: { ja: '葉の数', en: 'Leaves' }, auto: { range: [12, 20] } },
      size: { type: 'num', min: 10, max: 160, step: 1, unit: 'du', label: { ja: '大きさ', en: 'Size' }, auto: { range: [58, 80] } },
      fall: { type: 'num', min: 5, max: 300, step: 1, unit: 'du', label: { ja: '落ちる速さ（毎秒）', en: 'Fall (per second)' },
        auto: { range: [50, 85], follow: 'energy' } },
    },
    build(env, p) {
      const colors = MAPLES.map((c) => allowed(env.pal, K.color.mix(c, hexOf(env.pal, p.ink), 0.2)));
      const common = { shape: leafShape, colors, wind: 20, sway: 70, swayHz: 0.16, flipHz: 0.3, spin: 1.3 };
      fallLayer(env, 'far', Object.assign({}, common, { count: p.leaves * 0.8, size: p.size, fall: p.fall, alpha: 0.6 + 0.35 * p.amount }));
      fallLayer(env, 'near', Object.assign({}, common, { count: p.leaves * 0.12, size: p.size * 1.7, fall: p.fall * 1.4,
        alpha: 0.35 + 0.25 * p.amount }));
    },
  });

  // --- fireflyGlow ------------------------------------------------------------------------------------------------------

  // Fireflies wander (value noise, closed form in t) and blink on their own slow rhythm: a soft glow and a bright core.
  function fireflyDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, q.rgba(d.glow, 0.85)); grad.addColorStop(0.3, q.rgba(d.glow, 0.35)); grad.addColorStop(1, q.rgba(d.glow, 0));
    if (d.add) g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < d.n; k++) {
      const o = k * 5, F = d.items;
      const u = K.math.fract(t / F[o + 3] + F[o + 4]);
      if (u > 0.45) continue;
      const lit = Math.sin(Math.PI * u / 0.45);
      const x = F[o] + d.wander * (K.math.noise1(d.seedX, t * 0.13 + k * 5.3) - 0.5) * 2;
      const y = F[o + 1] + d.wander * 0.6 * (K.math.noise1(d.seedY, t * 0.11 + k * 3.1) - 0.5) * 2;
      const a = a0 * d.alpha * lit * lit * calm(d, x, y), r = F[o + 2];
      g.save();
      g.translate(x, y); g.scale(r, r);
      g.fillStyle = grad; g.globalAlpha = a;
      g.fillRect(-1, -1, 2, 2);
      g.fillStyle = d.core; g.globalAlpha = Math.min(1, a * 1.3);
      g.beginPath(); g.arc(0, 0, 0.09, 0, TAU); g.fill();
      g.restore();
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = a0;
  }

  function fireflyLayer(env, layer, count, size, alpha, tint) {
    const { D, rng, pal } = env;
    const area = areaOf(D), n = Math.max(1, Math.round(count * densityScale(D)));
    const items = new Float32Array(n * 5);
    for (let k = 0; k < n; k++) {
      const o = k * 5;
      items[o] = area.x0 + rng.next() * area.W;
      items[o + 1] = D.h * (rng.chance(0.7) ? rng.range(0.5, 1.05) : rng.range(-0.05, 0.5));    // more of them low, near the grass
      items[o + 2] = size * rng.range(0.7, 1.3); items[o + 3] = rng.range(2.4, 4.6); items[o + 4] = rng.next();
    }
    const light = lightTheme(pal), glow = K.color.mix(FIREFLY, tint, 0.12);
    const halo = light ? K.color.mix(glow, pal.ink, 0.25) : glow;
    const core = light ? K.color.mix(glow, pal.ink, 0.45) : K.color.mix(glow, '#FFFFFF', 0.6);
    env.sb.paint({ layer, bleed: 0, animated: true, owner: env.owner, draw: fireflyDraw,
      data: Object.assign(area, { n, items, wander: 0.07 * D.short, seedX: rng.int(1, 2147483646), seedY: rng.int(1, 2147483646),
        glow: allowed(pal, halo), core: allowed(pal, core), add: additive(pal), alpha, floor: floorOf(layer, GLOW_FLOOR) }) });
  }

  const fireflyGlow = K.ornament({
    key: 'fireflyGlow', scope: 'run', follow: 'own', season: 'summer',
    shared: { ink: { auto: { value: 'accent' } } },
    label: { ja: '蛍', en: 'Firefly glow' },
    blurb: { ja: '蛍がゆっくり明滅しながらさまよう', en: 'Fireflies blinking and wandering' },
    tags: ['soft', 'dark'],
    params: {
      flies: { type: 'int', min: 2, max: 60, label: { ja: '蛍の数', en: 'Fireflies' }, auto: { range: [14, 26] } },
      size: { type: 'num', min: 6, max: 120, step: 0.5, unit: 'du', label: { ja: '光の大きさ', en: 'Glow size' }, auto: { range: [42, 60] } },
    },
    build(env, p) {
      const tint = hexOf(env.pal, p.ink);
      fireflyLayer(env, 'far', p.flies * 0.85, p.size, 0.7 + 0.3 * p.amount, tint);
      fireflyLayer(env, 'near', p.flies * 0.15, p.size * 1.8, 0.55 + 0.3 * p.amount, tint);
    },
  });

  // --- fireworkBloom ----------------------------------------------------------------------------------------------------

  const LAUNCH = 0.8;              // seconds a shell rises before it bursts
  const LIFE = 1.9;                // seconds a burst's sparks live
  const PULL = 3.2;                // drag of the sparks: r(τ) = R·(1 − e^(−PULL·τ)) / (1 − e^(−PULL·LIFE))
  const REACH = 1.05;              // the farthest spark flies this × the burst's radius
  const DROOP = 45;                // du/s²·½: the sparks sink by DROOP·τ² as they burn
  const BRIGHT = 1.3;              // seconds a burst's sparks stay bright (then they have faded below a fifth)
  const ZONE_X = 0.36, ZONE_Y = 0.3;   // the lyric zone: an ellipse of these shares of w and h around the middle
  const ZONE_CLEAR = 30;           // du the bright sparks keep from the lyric zone
  const MIN_BURST = 24;            // du: the smallest radius a burst crowded by the zone opens to
  const ZONE_STEPS = 24;           // points of the zone's outline a burst measures its room against
  const TOP_MARGIN = 0.03;         // bursts open at least this share of the frame's height below its top

  // Burst c (one per period, jittered): when it opens, where, in which colour, turned how far and how big, each from
  // value noise at the integer c (so any frame can find the bursts around it without state).
  function burstAt(d, c) { return (c + 0.1 + 0.6 * K.math.noise1(d.seed, c)) * d.period; }
  function burstX(d, c) {
    const side = K.math.noise1(d.seed + 1, c) < 0.5 ? -1 : 1;
    return d.w * (0.5 + side * (0.2 + 0.28 * K.math.noise1(d.seed + 2, c)));
  }
  // High in the frame, and above the lyric zone by room for a small burst to sink while it burns (MIN_BURST sparks, their
  // droop and the clearance), wherever along the top it opens.
  function burstY(d, c, x) {
    const across = (x - d.w / 2) / (ZONE_X * d.w), top = d.h / 2 - ZONE_Y * d.h * Math.sqrt(Math.max(0, 1 - across * across));
    const highest = top - DROOP * BRIGHT * BRIGHT - ZONE_CLEAR - REACH * MIN_BURST;
    return Math.max(TOP_MARGIN * d.h, Math.min(d.h * (0.07 + 0.15 * K.math.noise1(d.seed + 3, c)), highest));
  }
  function burstInk(d, c) { return d.inks[Math.floor(K.math.noise1(d.seed + 4, c) * 2.999)]; }
  function burstTurn(d, c) { return K.math.noise1(d.seed + 5, c) * TAU; }
  function burstR(d, c) { return d.R * (0.75 + 0.5 * K.math.noise1(d.seed + 6, c)); }

  // The radius a burst at (x, y) may open to: R, or less where the lyric zone is near, so its sparks never fly behind
  // the words while they are bright (the room is measured from where the burst has sunk to by then, to the zone's
  // outline at ZONE_STEPS points; 0 inside it).
  function roomyR(d, x, y, R) {
    const ax = ZONE_X * d.w, ay = ZONE_Y * d.h, cx = d.w / 2, cy = d.h / 2, sy = y + DROOP * BRIGHT * BRIGHT;
    let room = Math.hypot((x - cx) / ax, (sy - cy) / ay) <= 1 ? 0 : Infinity;
    for (let k = 0; k < ZONE_STEPS && room > 0; k++) {
      const a = (k / ZONE_STEPS) * TAU;
      room = Math.min(room, Math.hypot(x - cx - ax * Math.cos(a), sy - cy - ay * Math.sin(a)));
    }
    return Math.min(R, Math.max(MIN_BURST, (room - ZONE_CLEAR) / REACH));
  }

  function sparkRadius(R, tau) { return R * (1 - Math.exp(-PULL * tau)) / (1 - Math.exp(-PULL * LIFE)); }

  // Burst c opens at (c + 0.1 … c + 0.7)·period, so the bursts on screen at t (rising since t − LAUNCH at most, or
  // burning until t + LIFE at most) are the c with burstAt(c) in [t − LIFE, t + LAUNCH].
  function firstBurst(d, t) { return Math.max(0, Math.floor((t - LIFE) / d.period - 0.7)); }
  function lastBurst(d, t) { return Math.floor((t + LAUNCH) / d.period - 0.1); }

  function fireworkDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    if (d.add) g.globalCompositeOperation = 'lighter';
    g.lineCap = 'round';
    for (let c = firstBurst(d, t), last = lastBurst(d, t); c <= last; c++) {
      const tau = t - burstAt(d, c);
      if (tau < -LAUNCH || tau > LIFE) continue;
      const x = burstX(d, c), y = burstY(d, c, x), R = roomyR(d, x, y, burstR(d, c)), ink = burstInk(d, c), fade = calm(d, x, y);
      if (tau < 0) {                                             // the shell rising
        const u = 1 + tau / LAUNCH, sy = d.h * 1.05 + (y - d.h * 1.05) * (1 - (1 - u) * (1 - u));
        g.strokeStyle = q.rgba(ink, 0.7); g.lineWidth = 2; g.globalAlpha = a0 * d.alpha * fade * (0.4 + 0.6 * u);
        g.beginPath(); g.moveTo(x, sy); g.lineTo(x, sy + 40); g.stroke();
        continue;
      }
      if (tau < 0.45) {                                          // the flash
        const flash = g.createRadialGradient(x, y, 0, x, y, R * 0.7);
        flash.addColorStop(0, q.rgba(ink, 0.55)); flash.addColorStop(1, q.rgba(ink, 0));
        g.fillStyle = flash; g.globalAlpha = a0 * d.alpha * fade * (1 - tau / 0.45);
        g.fillRect(x - R, y - R, 2 * R, 2 * R);
      }
      const life = 1 - tau / LIFE, turn = burstTurn(d, c), droop = DROOP * tau * tau;
      const twinkle = tau > LIFE * 0.6 ? 0.65 + 0.35 * Math.sin(38 * tau + c) : 1;
      g.lineWidth = 1.8 + 2.2 * life;
      for (let ring = 0; ring < 2; ring++) {                      // an outer ring of sparks and a smaller inner one
        const n = ring ? Math.round(d.sparks * 0.45) : d.sparks, Rr = ring ? R * 0.55 : R;
        g.strokeStyle = q.rgba(ring ? d.inks[(d.inks.indexOf(ink) + 1) % d.inks.length] : ink, 1);
        g.globalAlpha = a0 * d.alpha * fade * Math.pow(life, 1.3) * twinkle;
        g.beginPath();
        for (let j = 0; j < n; j++) {
          const a = turn + ((j + 0.5 * ring) * TAU) / n, ca = Math.cos(a), sa = Math.sin(a);
          const k = Rr * (REACH - 0.33 + 0.33 * K.math.noise1(d.seed + 7 + ring, c * 131 + j));   // each spark flies its own distance
          const r1 = sparkRadius(k, tau), r0 = sparkRadius(k, Math.max(0, tau - 0.3));
          g.moveTo(x + ca * r0, y + sa * r0 + droop * 0.7); g.lineTo(x + ca * r1, y + sa * r1 + droop);
        }
        g.stroke();
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = a0;
  }

  const fireworkBloom = K.ornament({
    key: 'fireworkBloom', scope: 'run', follow: 'own', season: 'summer',
    label: { ja: '花火', en: 'Firework bloom' },
    blurb: { ja: '遠くで花火が次々に開く', en: 'Fireworks burst in the distance' },
    tags: ['bright', 'bold'],
    shared: { ink: { auto: { pick: ['accent', 'shiftA', 'shiftB'] } } },
    params: {
      rate: { type: 'num', min: 0.5, max: 10, step: 0.1, label: { ja: '10秒あたりの数', en: 'Bursts per 10 s' },
        auto: { range: [2.5, 4.5], follow: 'energy' } },
      size: { type: 'num', min: 0.06, max: 0.45, step: 0.005, unit: 'frac', label: { ja: '大きさ', en: 'Size' }, auto: { range: [0.18, 0.26] } },
      sparks: { type: 'int', min: 12, max: 96, label: { ja: '火の粉の数', en: 'Sparks' }, auto: { range: [40, 64] } },
    },
    build(env, p) {
      const { D, rng, pal } = env;
      env.sb.paint({ layer: 'far', bleed: 0, animated: true, owner: env.owner, draw: fireworkDraw,
        data: { w: D.w, h: D.h, period: 10 / p.rate, R: p.size * D.short, sparks: p.sparks, seed: rng.int(1, 2147483640),
          inks: [p.ink, 'shiftA', 'shiftB'], add: additive(pal), alpha: 0.65 + 0.35 * p.amount, floor: CALM_FLOOR } });
    },
  });

  // --- snowDust ---------------------------------------------------------------------------------------------------------

  const FLAKE = K.shape.ellipse(0, 0, 0.5, 0.5);

  const snowDust = K.ornament({
    key: 'snowDust', scope: 'run', follow: 'own', season: 'winter',
    shared: { ink: { auto: { value: 'ink' } } },
    label: { ja: '粉雪', en: 'Snow dust' },
    blurb: { ja: '細かな雪が少し揺れながら降る', en: 'Fine snow falling with a slight sway' },
    tags: ['soft', 'slow'],
    params: {
      flakes: { type: 'int', min: 10, max: 400, label: { ja: '雪の量', en: 'Flakes' }, auto: { range: [110, 180] } },
      fall: { type: 'num', min: 5, max: 200, step: 1, unit: 'du', label: { ja: '落ちる速さ（毎秒）', en: 'Fall (per second)' },
        auto: { range: [34, 56], follow: 'energy' } },
      sway: { type: 'num', min: 0, max: 60, step: 0.5, unit: 'du', label: { ja: '揺れ', en: 'Sway' }, auto: { range: [10, 20] } },
    },
    build(env, p) {
      const { sb, D, pal } = env;
      const area = areaOf(D), k = densityScale(D);
      // on a light theme white snow would vanish: a cool grey of the ground's lightness (never of the key green)
      const paper = backdropOf(pal) === 'chroma' ? PAPER : pal.ground;
      const flake = lightTheme(pal) ? K.color.mix(paper, '#6F8BB0', 0.55) : '#F4F7FC';
      const ink = allowed(pal, K.color.mix(flake, hexOf(pal, p.ink), 0.2));
      const box = { x: area.x0, y: area.y0, w: area.W, h: area.H };
      sb.particles({ layer: 'far', owner: env.owner, n: Math.round(p.flakes * 0.85 * k), sprite: FLAKE, ink,
        field: { area: box, vx: 4, vy: p.fall, sway: p.sway, swayHz: 0.16, spin: 0, size: [4, 8], life: [6, 11], wrap: true } });
      sb.particles({ layer: 'near', owner: env.owner, n: Math.max(1, Math.round(p.flakes * 0.1 * k)), sprite: FLAKE, ink,
        field: { area: box, vx: 8, vy: p.fall * 1.9, sway: p.sway * 1.6, swayHz: 0.12, spin: 0, size: [10, 16], life: [5, 9], wrap: true } });
    },
  });

  return [petalFall, leafFall, fireflyGlow, fireworkBloom, snowDust];
});
