/* 文字PVメーカー v2 — original work. Source-derived cinematic effects from the user's my-universe.html and singularity-bigbang.html.
 * The source's curved cosmic web, four-arm orbital fields, camera journey, 110-second evolution and analytic
 * eruption are evaluated at the requested song time. Canvas representatives replace the millions of GPU particles;
 * there is no feedback buffer, accumulated simulation, opaque sky or second animation clock. */
MV.def('parts/ornament/cosmic', ['parts/kit'], (K) => {
  'use strict';
  const C = K.cinematic, TAU = Math.PI * 2, TAN = Math.tan(0.78 / 2);
  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const mix = (a, b, u) => a + (b - a) * u;
  const smooth = (a, b, x) => { const u = clamp((x - a) / (b - a)); return u * u * (3 - 2 * u); };
  const L = (ja, en) => ({ ja, en });

  // Same integer permutation as both source particle shaders (uint overflow is intentional).
  function hash(n) {
    n = ((n >>> 0) ^ 61) ^ (n >>> 16); n = Math.imul(n, 9); n ^= n >>> 4;
    n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15;
    return (n >>> 0) / 4294967295;
  }
  function direction(k) {
    const z = hash(k + 13) * 2 - 1, a = hash(k + 17) * TAU, r = Math.sqrt(Math.max(0, 1 - z * z));
    return [r * Math.cos(a), z, r * Math.sin(a)];
  }
  function norm(v) { const r = Math.hypot(...v) || 1; return v.map((x) => x / r); }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function camera(target, distance, yaw, pitch, d) {
    const eye = [target[0] + Math.sin(yaw) * Math.cos(pitch) * distance,
      target[1] + Math.sin(pitch) * distance, target[2] + Math.cos(yaw) * Math.cos(pitch) * distance];
    const forward = norm(target.map((v, i) => v - eye[i])), right = norm(cross(forward, [0, 1, 0]));
    return { eye, forward, right, up: cross(right, forward), scale: d.h / (2 * TAN) * d.size };
  }
  function project(p, cam, d) {
    const v = p.map((x, i) => x - cam.eye[i]), z = dot(v, cam.forward);
    if (!(z > 0.08)) return null;
    const x = d.w / 2 + dot(v, cam.right) * cam.scale / z, y = d.h / 2 - dot(v, cam.up) * cam.scale / z;
    if (x < -d.w * 0.2 || x > d.w * 1.2 || y < -d.h * 0.2 || y > d.h * 1.2) return null;
    return { x, y, z, scale: cam.scale / z };
  }
  function calm(x, y, d) {
    const r = Math.hypot((x - d.w / 2) / (d.w * 0.42), (y - d.h / 2) / (d.h * 0.3));
    return 0.42 + 0.58 * smooth(0.2, 1.2, r);
  }
  function pixels(q, value) { return value / (Number.isFinite(q.scale) && q.scale > 0 ? q.scale : 1); }
  function point(g, p, cam, d, q, color, alpha, size) {
    if (!(alpha > 0.001)) return;
    const s = project(p, cam, d);
    if (!s) return;
    // A representative core must survive a small preview. The source's millions of subpixel points accumulated
    // their energy; bounded Canvas representatives need a real pixel footprint rather than vanishing at 320 px.
    const radius = clamp(size * Math.sqrt(s.scale * 0.05), Math.max(d.short * 0.0015, pixels(q, 0.7)),
      Math.max(d.short * 0.0045, pixels(q, 1.6)));
    const bucket = Math.ceil(clamp(alpha) * calm(s.x, s.y, d) * 12);
    if (bucket > 0) d.points.push({ x: s.x, y: s.y, radius, color, bucket });
  }
  // A path per colour/opacity group keeps the bounded source representatives inexpensive at export resolution.
  function flushPoints(g, d, q) {
    const groups = new Map();
    for (const p of d.points) {
      const key = p.color + ':' + p.bucket;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    for (const group of groups.values()) {
      g.globalAlpha = d.paintAlpha * group[0].bucket / 12;
      g.fillStyle = q.rgba(group[0].color, 1); g.beginPath();
      for (const p of group) { g.moveTo(p.x + p.radius, p.y); g.arc(p.x, p.y, p.radius, 0, TAU); }
      g.fill();
    }
  }
  function glow(g, x, y, radius, color, alpha, q) {
    if (!(radius > 0 && alpha > 0)) return;
    const grad = g.createRadialGradient(x, y, 0, x, y, radius);
    grad.addColorStop(0, q.rgba(color, alpha)); grad.addColorStop(0.28, q.rgba(color, alpha * 0.25));
    grad.addColorStop(1, q.rgba(color, 0));
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, radius, 0, TAU); g.fill();
  }

  // Source CPU graph: 84 nodes on intertwined sheets and each node's three closest neighbours. Curved filaments
  // leave the original wide voids; they do not become a uniformly filled starfield.
  function web(seed) {
    let state = seed | 0;
    const rand = () => { state = (Math.imul(state, 1664525) + 1013904223) | 0; return (state >>> 0) / 4294967296; };
    const nodes = [[0, 0, 0, 15]], edges = [], known = new Set();
    for (let i = 1; i < 84; i++) {
      const a = rand() * TAU, r = 320 + Math.sqrt(rand()) * 900;
      nodes.push([Math.cos(a) * r, (rand() - 0.5) * 680 + Math.sin(a * 2.3) * 240, Math.sin(a) * r, 7 + rand() * 16]);
    }
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    for (let i = 0; i < nodes.length; i++) {
      const near = nodes.map((n, j) => ({ j, r: i === j ? Infinity : dist(nodes[i], n) })).sort((a, b) => a.r - b.r);
      for (let k = 0; k < 3; k++) {
        const j = near[k].j, key = Math.min(i, j) + ':' + Math.max(i, j);
        if (known.has(key)) continue;
        known.add(key);
        const a = nodes[i], b = nodes[j], length = dist(a, b), curve = [(rand() - 0.5) * length * 0.32,
          (rand() - 0.5) * length * 0.35, (rand() - 0.5) * length * 0.32];
        edges.push({ a: a.slice(0, 3), b: a.slice(0, 3).map((v, n) => mix(v, b[n], 0.34) + curve[n]),
          c: a.slice(0, 3).map((v, n) => mix(v, b[n], 0.68) + curve[n]), d: b.slice(0, 3), phase: rand() * 8 });
      }
    }
    return { nodes, edges };
  }
  function bezier(e, u) {
    const v = 1 - u;
    return e.a.map((x, n) => v * v * v * x + 3 * v * v * u * e.b[n] + 3 * v * u * u * e.c[n] + u * u * u * e.d[n]);
  }
  function journeyScale(u) {
    // Same 90-second camera itinerary as my-universe's tourScale, fitted to the selected effect window.
    const t = clamp(u) * 90;
    if (t < 8) return 0.08;
    if (t < 28) return mix(0.08, 0.55, smooth(8, 28, t));
    if (t < 41) return 0.55;
    if (t < 60) return mix(0.55, 1, smooth(41, 60, t));
    return t < 72 ? 1 : mix(1, 0.08, smooth(72, 90, t));
  }
  function webDraw(g, cam, d, q, scale, time, stride) {
    const alpha = 1 - smooth(0.36, 0.58, scale);
    if (!(alpha > 0)) return;
    const step = q.draft ? 3 : 1;
    for (let k = 0; k < d.graph.edges.length; k += step) {
      const e = d.graph.edges[k], pts = [e.a, e.b, e.c, e.d].map((p) => project(p, cam, d));
      if (pts.some((p) => !p)) continue;
      g.globalAlpha = d.paintAlpha * alpha * 0.52 * calm((pts[0].x + pts[3].x) / 2, (pts[0].y + pts[3].y) / 2, d);
      g.strokeStyle = q.rgba(d.colors[k % 3], 1); g.lineWidth = Math.max(pixels(q, 0.9), d.short * 0.0011);
      g.beginPath(); g.moveTo(pts[0].x, pts[0].y);
      g.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y); g.stroke();
    }
    for (let i = 0; i < Math.floor(d.count * 0.45); i += stride) {
      const id = i + d.seed, u = (hash(id + 29) + time * 0.012 * (0.4 + hash(id + 8))) % 1;
      const e = d.graph.edges[Math.floor(hash(id + 48) * (d.graph.edges.length - 1))];
      const p = bezier(e, u), bead = Math.pow(0.5 + 0.5 * Math.sin(u * 37 + e.phase), 8);
      point(g, p, cam, d, q, d.colors[i % 3], alpha * (0.45 + bead * 0.5), 1.3 + bead);
    }
    g.globalAlpha = d.paintAlpha;
    for (let k = 0; k < d.graph.nodes.length; k++) {
      const n = d.graph.nodes[k];
      const s = project(n, cam, d);
      if (s && k % 11 === 0) glow(g, s.x, s.y, clamp(n[3] * s.scale * 2, 2, d.short * 0.035), d.colors[3], alpha * 0.5, q);
      point(g, n, cam, d, q, d.colors[3], alpha * 0.7, 2);
    }
  }
  function galaxyDraw(g, cam, d, q, scale, time, stride) {
    const alpha = 1 - smooth(0.70, 0.91, scale);
    if (!(alpha > 0)) return;
    const incoming = smooth(0.10, 0.38, scale);
    for (let i = 0; i < Math.floor(d.count * 0.55); i += stride) {
      const id = i + 51737 + d.seed, h = hash(id * 19 + 3), h2 = hash(id * 19 + 8);
      const r = 0.10 + Math.pow(hash(id + 41), 0.65) * 13.4;
      const a = Math.floor(hash(id + 42) * 4) * Math.PI / 2 + r * 0.55
        + (hash(id + 43) - 0.5) * (0.24 + r * 0.08) + time * 0.25 / Math.sqrt(r + 0.4);
      let p = [Math.cos(a) * r, (hash(id + 44) + hash(id + 45) - 1) * (0.05 + r * 0.045), Math.sin(a) * r];
      if (h > 0.91) p = direction(id + 33).map((v) => v * Math.pow(hash(id + 46), 0.9) * 4);
      const hot = 1 - smooth(0.1, 4, r);
      point(g, p, cam, d, q, d.colors[hot > 0.6 ? 4 : i % 3], alpha * incoming * (0.45 + h * 0.4), 0.8 + h2);
    }
    const core = project([0, 0, 0], cam, d);
    if (core) {
      g.globalAlpha = d.paintAlpha * calm(core.x, core.y, d);
      glow(g, core.x, core.y, clamp(3 * core.scale, d.short * 0.015, d.short * 0.25), d.colors[4], alpha * incoming * 0.6, q);
    }
  }
  function starDraw(g, cam, d, q, scale, time) {
    const presence = smooth(0.66, 0.90, scale), p = project([5, 0.25, 2.5], cam, d);
    if (!(presence > 0 && p)) return;
    const r = clamp(1.8 * p.scale, 1, d.short * 0.5), a = d.paintAlpha * presence * 0.65;
    g.globalAlpha = a;
    glow(g, p.x, p.y, r * 1.65, d.colors[4], 0.46, q);
    const grad = g.createRadialGradient(p.x - r * 0.2, p.y - r * 0.24, r * 0.05, p.x, p.y, r);
    grad.addColorStop(0, q.rgba(d.colors[5], 0.95)); grad.addColorStop(0.72, q.rgba(d.colors[4], 0.85));
    grad.addColorStop(1, q.rgba(d.colors[6], 0.72));
    g.fillStyle = grad; g.beginPath(); g.arc(p.x, p.y, r, 0, TAU); g.fill();
    // Source photospheric convection channels and the three magnetic arches, reconstructed analytically.
    for (let k = 0; k < (q.draft ? 28 : 72); k++) {
      const a0 = hash(k + d.seed) * TAU + time * 0.018, rr = Math.sqrt(hash(k + d.seed + 7)) * r * 0.94;
      g.globalAlpha = a * 0.2;
      g.fillStyle = q.rgba(k % 3 ? d.colors[6] : d.colors[5], 1);
      g.beginPath(); g.ellipse(p.x + Math.cos(a0) * rr, p.y + Math.sin(a0) * rr, r * 0.06, r * 0.025, a0, 0, TAU); g.fill();
    }
    for (let k = 0; k < 3; k++) {
      const a0 = k * 2.3 + time * 0.018, x = p.x + Math.cos(a0) * r * 0.84, y = p.y + Math.sin(a0) * r * 0.84;
      g.globalAlpha = a * (0.48 + 0.16 * Math.sin(time * 0.46 + k * 2.3));
      g.strokeStyle = q.rgba(d.colors[4], 1); g.lineWidth = Math.max(1, r * 0.022);
      g.beginPath(); g.ellipse(x, y, r * (0.43 + k * 0.07), r * 0.23, a0, -Math.PI, 0); g.stroke();
    }
  }
  function universeDraw(g, t, d, q) {
    const frame = C.frame(t, d, q);
    if (!frame.active) return;
    const scale = journeyScale(frame.u) * d.travel, time = frame.u * 90;
    const local = smooth(0.56, 0.93, scale), target = [5 * local, 0.25 * local, 2.5 * local];
    const distance = scale < 0.55 ? Math.exp(mix(Math.log(2400), Math.log(35), smooth(0, 0.55, scale)))
      : Math.exp(mix(Math.log(35), Math.log(7.8), smooth(0.55, 1, scale)));
    const cam = camera(target, distance, 0.25 + time * 0.008 * (1 - smooth(0.6, 1, scale)),
      mix(0.35, 0.18, smooth(0.7, 1, scale)), d);
    g.save();
    // paintAlpha is local to this callback: copying avoids mutations to the cached scene's geometry.
    const drawData = Object.assign({}, d, { paintAlpha: g.globalAlpha * frame.alpha, points: [] });
    const stride = q.draft ? 3 : 1;
    webDraw(g, cam, drawData, q, scale, time, stride);
    galaxyDraw(g, cam, drawData, q, scale, time, stride);
    flushPoints(g, drawData, q);
    starDraw(g, cam, drawData, q, scale, time);
    g.restore();
  }

  // Exact source evolution thresholds (cosmic seconds): seed 0–12, feast 12–46, compression 46–78,
  // critical 78–84, eruption 84–92, new universe 92–110. No recurring flash is introduced.
  function evolution(age) {
    const growth = smooth(10, 46, age), collapse = smooth(46, 84, age), bang = age >= 84 ? age - 84 : -1;
    const radius = age >= 84 ? 0 : age < 12 ? 0.07 + 0.11 * smooth(0, 12, age)
      : age < 46 ? 0.18 + 2.62 * smooth(12, 46, age) : 2.782 * Math.pow(1 - smooth(46, 84, age), 2.4) + 0.018;
    return { growth, collapse, bang, radius };
  }
  function singularityDraw(g, t, d, q) {
    const frame = C.frame(t, d, q);
    if (!frame.active) return;
    const age = frame.u * 110, s = evolution(age), pull = s.bang >= 0 ? 1 + smooth(0, 20, s.bang) * 2.8 : 1;
    const cam = camera([0, 0, 0], 32 * pull, 0.08 + age * 0.0014, 0.38, d);
    const dd = Object.assign({}, d, { paintAlpha: g.globalAlpha * frame.alpha, points: [] });
    g.save();
    const stride = q.draft ? 3 : 1;
    for (let i = 0; i < d.count; i += stride) {
      const k = i + Math.floor(d.seed * 19733), rnd = hash(k * 11 + 1);
      let p, brightness = 0.6;
      if (s.bang >= 0) {
        const direction0 = direction(k * 19), a = Math.atan2(direction0[2], direction0[0]);
        const band = Math.sin(a * 7 + direction0[1] * 13);
        const speed = (3.5 + Math.pow(hash(k + 71), 0.55) * 13) * (0.75 + 0.25 * band * band);
        const filaments = 0.4 + 0.6 * Math.pow(Math.abs(Math.sin(a * 5 + direction0[1] * 8)), 0.4);
        direction0[1] *= 0.65 + hash(k + 8) * 0.7;
        const dir = norm(direction0), expansion = (1 - Math.exp(-s.bang * 0.04)) / 0.04;
        const curl = cross(dir, [0.3, 1, 0.2]), wiggle = Math.sin(s.bang * 0.8 + rnd * 6) * Math.min(s.bang, 2) * 0.28;
        p = dir.map((v, n) => v * (0.025 + speed * expansion * filaments) + curl[n] * wiggle);
        brightness = 0.95 - 0.45 * smooth(3, 26, s.bang);
      } else {
        const infall = smooth(12, 83, age);
        const rawR = 0.35 + Math.pow(hash(k * 11 + 2), 0.57) * 14, r = rawR * mix(1, 0.15, infall);
        const a = Math.floor(hash(k * 11 + 3) * 4) * Math.PI / 2 + rawR * 0.43
          + (hash(k * 11 + 4) - 0.5) * (0.15 + rawR * 0.09) + age * 0.025 * (1 + 4 / (r + 0.8));
        const y = (hash(k * 11 + 5) + hash(k * 11 + 6) - 1) * (0.06 + rawR * 0.045) * (1 - infall * 0.7);
        p = [Math.cos(a) * r, y, Math.sin(a) * r];
        if (rnd < smooth(18, 83.5, age)) {
          p = direction(k).map((v) => v * s.radius * (0.15 + hash(k + 32) * 0.5));
          brightness *= 0.18;
        }
      }
      point(g, p, cam, dd, q, d.colors[s.bang >= 0 ? i % 4 : i % 3], brightness, 1 + rnd * 0.6);
    }
    flushPoints(g, dd, q);
    const center = project([0, 0, 0], cam, d);
    if (center && s.bang < 0) {
      const r = s.radius * center.scale * 1.6;
      g.globalAlpha = dd.paintAlpha;
      // The annular glow leaves the source image visible through the black-hole centre.
      const halo = Math.max(d.short * 0.025, r * 2.4);
      g.save(); g.translate(center.x, center.y); g.rotate(-0.12); g.scale(2.1, 0.58);
      const grad = g.createRadialGradient(0, 0, 0, 0, 0, halo);
      grad.addColorStop(0, q.rgba(d.colors[3], 0)); grad.addColorStop(0.23, q.rgba(d.colors[3], 0));
      grad.addColorStop(0.4, q.rgba(d.colors[4], 0.52)); grad.addColorStop(0.65, q.rgba(d.colors[3], 0.18));
      grad.addColorStop(1, q.rgba(d.colors[3], 0));
      g.fillStyle = grad; g.beginPath(); g.arc(0, 0, halo, 0, TAU); g.fill(); g.restore();
      // Source's rotating accretion filaments surround an open central shadow. No opaque disc obscures a photo.
      for (let band = 0; band < (q.draft ? 3 : 7); band++) {
        const rr = Math.max(d.short * 0.004, r * (1.25 + band * 0.19));
        g.globalAlpha = dd.paintAlpha * (0.62 + s.collapse * 0.12) / (1 + band * 0.13);
        g.strokeStyle = q.rgba(d.colors[3 + (band % 2)], 1); g.lineWidth = Math.max(pixels(q, 1.05), d.short * 0.0018);
        g.beginPath(); g.ellipse(center.x, center.y, rr * 2.1, rr * 0.58, -0.12, age * 0.035 + band, age * 0.035 + band + Math.PI * 1.7); g.stroke();
      }
    } else if (center) {
      const shock = smooth(0, 2.8, s.bang), ring = d.short * 0.7 * shock;
      g.globalAlpha = dd.paintAlpha * (1 - smooth(1, 9, s.bang)) * 0.68;
      g.strokeStyle = q.rgba(d.colors[4], 1); g.lineWidth = Math.max(pixels(q, 1.2), d.short * 0.004 * (1 - shock * 0.5));
      g.beginPath(); g.ellipse(center.x, center.y, ring, ring * 0.63, -0.12, 0, TAU); g.stroke();
      glow(g, center.x, center.y, d.short * (0.025 + shock * 0.26), d.colors[4], (1 - shock) * 0.45, q);
    }
    g.restore();
  }

  const density = { type: 'int', min: 64, max: 1200, label: L('光の密度', 'Light density'), auto: { value: 600 } };
  const size = { type: 'num', min: 0.35, max: 1.5, step: 0.05, label: L('広がり', 'Spread'), auto: { value: 1 } };
  function colors(env, p, values) {
    const tint = C.color(env.pal, p.color);
    return values.map((v) => C.color(env.pal, K.color.mix(v, tint, 0.12)));
  }
  const universeJourney = K.ornament({
    key: 'universeJourney', scope: 'run', follow: 'own', pool: false, family: 'cinematic',
    label: L('宇宙の網から星へ', 'Cosmic web to a star'),
    blurb: L('光の網目から銀河の渦へ進み、一つの星へ近づいて戻る', 'Travel through a curved cosmic web into a spiral galaxy and approach one star, then return'),
    tags: ['airy', 'digital'],
    params: Object.assign({}, C.params, { density, size,
      color: { type: 'ink', label: L('光の色味', 'Light tint'), auto: { value: '#9FD9DB' } },
      travel: { type: 'num', min: 0, max: 1, step: 0.05, label: L('近づく距離', 'Journey depth'), auto: { value: 1 } } }),
    build(env, p) {
      const data = Object.assign(C.setup(env, p), { count: p.density, size: p.size, travel: p.travel,
        graph: web(p.seed), colors: colors(env, p, ['#61CFFF', '#B084FF', '#87FFE2', '#DBD4FF', '#FFA842', '#FFE5A2', '#E12B09']) });
      env.sb.paint({ layer: data.layer, bleed: 0, animated: true, owner: env.owner, draw: universeDraw, data });
    },
  });
  const singularityBurst = K.ornament({
    key: 'singularityBurst', scope: 'run', follow: 'own', pool: false, family: 'cinematic',
    label: L('収縮とビッグバン', 'Collapse and Big Bang'),
    blurb: L('星が渦を描いて集まり、臨界で収縮して新しい宇宙へ広がる', 'Stars spiral inward, compress at the critical point and erupt into a new universe'),
    tags: ['bold', 'digital'],
    params: Object.assign({}, C.params, { density, size,
      color: { type: 'ink', label: L('星の色味', 'Star tint'), auto: { value: '#A4C8FF' } } }),
    build(env, p) {
      const data = Object.assign(C.setup(env, p), { count: p.density, size: p.size,
        colors: colors(env, p, ['#7AA6FF', '#D6DAFF', '#B985F3', '#FF9B48', '#FFF0B8']) });
      env.sb.paint({ layer: data.layer, bleed: 0, animated: true, owner: env.owner, draw: singularityDraw, data });
    },
  });
  return [universeJourney, singularityBurst];
});
