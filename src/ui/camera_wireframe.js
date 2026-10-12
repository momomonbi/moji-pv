/* 文字PVメーカー v2 — original work. Preview-only camera wireframe: exact text camera matrices and a bounded overview. */
MV.def('ui/camera_wireframe', ['core/mat', 'core/num', 'engine/scene/frame'], (MAT, N, F) => {
  'use strict';

  const SAMPLES = 48;
  const MAX_BOXES = 96;
  const INK = '#71e6d1';
  const CURRENT = '#ffbd76';
  const DIM = 'rgba(113,230,209,0.28)';

  // viewAt already includes the lens, shot, area rig and absolute-time shake/punch. Use the renderer's own matrix
  // helper at text-layer parallax 1, rather than approximating its motion from raw shot keys.
  function geometry(design, view) {
    const v = view || {};
    if (!design || !(design.w > 0 && design.h > 0) ||
      ![v.x, v.y, v.zoom, v.roll].every(Number.isFinite) || !(v.zoom > 0)) return null;
    const matrix = F.viewMatrix(new Float32Array(6),
      { x: v.x, y: v.y, zoom: v.zoom, roll: v.roll, shakeX: 0, shakeY: 0 }, 1, design.w, design.h);
    const inverse = MAT.invert(new Float32Array(6), matrix);
    if (!inverse) return null;
    const frame = Array.from(MAT.quad(new Float32Array(8), inverse, 0, 0, design.w, design.h));
    const world = Array.from(MAT.quad(new Float32Array(8), matrix, 0, 0, design.w, design.h));
    const centre = Array.from(MAT.apply(inverse, design.w / 2, design.h / 2, new Float32Array(2)));
    return { matrix: Array.from(matrix), frame, world, centre, view: { x: v.x, y: v.y, zoom: v.zoom, roll: v.roll } };
  }

  function windowAt(plan, t) {
    const fg = F.frameAt(plan, t), i = F.currentCut(plan, t, fg);
    if (i >= 0) {
      const cut = plan.cuts[i];
      return { a: cut.a, b: cut.b, cut: cut.key, i };
    }
    const iGround = F.segmentAt(plan, t), ground = (plan.grounds || [])[iGround];
    return { a: ground ? ground.t0 : 0, b: ground ? ground.t1 : plan.duration, cut: null, i: -1 };
  }

  function makePath(engine, plan, window, calm) {
    const a = Math.max(0, window.a), b = Math.max(a, Math.min(plan.duration, window.b));
    const span = b - a, epsilon = Math.min(1e-5, span / 1000);
    const track = window.cut && typeof engine.shotTrack === 'function' ? engine.shotTrack(window.cut) : null;
    const keys = track ? track.keys.filter((k) => k.t >= a && k.t <= b) : [];
    const jumps = typeof engine.xJumps === 'function' ? engine.xJumps(a, b) : [];
    // A normal track can also contain deliberate same-time jumps. Area rigs without a blend and hard cut boundaries
    // are separated in the overview: a dashed line across such a gap would invent camera travel that never occurs.
    for (let i = 1; i < keys.length; i++) if (keys[i].t === keys[i - 1].t) jumps.push(keys[i].t);
    for (const rig of plan.rigs || []) if (!rig.blend && rig.t0 > a && rig.t0 < b) jumps.push(rig.t0);
    for (const cut of plan.cuts || []) if (cut.a > a && cut.a < b) jumps.push(cut.a);
    for (const seam of plan.seams || []) if (seam.at > a && seam.at < b) jumps.push(seam.at);
    const times = Array.from({ length: SAMPLES + 1 }, (_, i) => a + span * i / SAMPLES);
    for (const k of keys) times.push(Math.min(b - epsilon, Math.max(a, k.t)));
    for (const t of jumps) if (t > a && t < b) times.push(t - epsilon, t);
    times[times.indexOf(b)] = Math.max(a, b - epsilon); // b itself belongs to the next cut, not this path.
    times.sort((x, y) => x - y);
    const unique = times.filter((t, i) => !i || t !== times[i - 1]);
    const opts = calm ? { calm: true } : undefined;
    const bounds = { x0: 0, y0: 0, x1: plan.design.w, y1: plan.design.h };
    const points = unique.map((t, i) => {
      const g = geometry(plan.design, engine.viewAt(t, opts));
      if (g) for (let j = 0; j < 8; j += 2) {
        bounds.x0 = Math.min(bounds.x0, g.frame[j]); bounds.x1 = Math.max(bounds.x1, g.frame[j]);
        bounds.y0 = Math.min(bounds.y0, g.frame[j + 1]); bounds.y1 = Math.max(bounds.y1, g.frame[j + 1]);
      }
      return g && { t, x: g.centre[0], y: g.centre[1],
        break: !!i && jumps.some((j) => unique[i - 1] < j && t >= j) };
    }).filter(Boolean);
    const markers = keys.map((k, i) => {
      const t = Math.min(b - epsilon, Math.max(a, k.t));
      const g = geometry(plan.design, engine.viewAt(t, opts));
      return g && { t, i, x: g.centre[0], y: g.centre[1] };
    }).filter(Boolean);
    return { points, markers, a, b, bounds };
  }

  // The cache stores one cut/gap only, by immutable plan identity and preview calm setting. A seek immediately gets
  // its real current pose; path samples are reused while playing that interval. Restore the current scene evaluation
  // after sampling so subsequent preview interactions do not observe the final future sample's live pose.
  function snapshot(engine, plan, t, calm, cache) {
    if (!engine || !plan || !plan.design || typeof engine.viewAt !== 'function') return null;
    const window = windowAt(plan, t), c = cache || {};
    if (c.plan !== plan || c.cut !== window.cut || c.a !== window.a || c.b !== window.b || c.calm !== !!calm) {
      c.path = makePath(engine, plan, window, !!calm);
      c.plan = plan; c.cut = window.cut; c.a = window.a; c.b = window.b; c.calm = !!calm;
    }
    const current = geometry(plan.design, engine.viewAt(t, calm ? { calm: true } : undefined));
    return current && { current, path: c.path, window, time: t, design: plan.design };
  }

  function quad(g, q, map) {
    g.beginPath();
    for (let i = 0; i < 8; i += 2) {
      const p = map(q[i], q[i + 1]);
      if (!i) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
    }
    g.closePath();
    g.stroke();
  }

  function overviewBounds(data) {
    const { w, h } = data.design;
    const bounds = data.path.bounds;
    let x0 = bounds ? bounds.x0 : 0, y0 = bounds ? bounds.y0 : 0,
      x1 = bounds ? bounds.x1 : w, y1 = bounds ? bounds.y1 : h;
    const point = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const p of data.path.points) point(p.x, p.y);
    for (let i = 0; i < 8; i += 2) point(data.current.frame[i], data.current.frame[i + 1]);
    return { x0, y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  function draw(g, data, opts) {
    if (!data) return;
    const o = opts || {}, k = o.scale || 1, dpr = o.dpr || 1, width = o.width, height = o.height;
    const { w: W, h: H } = data.design, v = data.current.view;
    const screen = (x, y) => [x * k, y * k];
    g.save();
    g.lineWidth = 1.2 * dpr;
    g.strokeStyle = DIM;
    const m = data.current.matrix;
    g.beginPath();
    for (let i = 0; i <= 4; i++) {
      for (const [x0, y0, x1, y1] of [[W * i / 4, 0, W * i / 4, H], [0, H * i / 4, W, H * i / 4]]) {
        g.moveTo((m[0] * x0 + m[2] * y0 + m[4]) * k, (m[1] * x0 + m[3] * y0 + m[5]) * k);
        g.lineTo((m[0] * x1 + m[2] * y1 + m[4]) * k, (m[1] * x1 + m[3] * y1 + m[5]) * k);
      }
    }
    g.stroke();
    g.strokeStyle = INK;
    quad(g, data.current.world, screen);
    g.strokeStyle = 'rgba(255,189,118,0.7)';
    for (const box of (o.boxes || []).slice(0, MAX_BOXES)) if (box.quad && box.quad.length === 8) quad(g, box.quad, screen);
    g.strokeStyle = CURRENT;
    g.strokeRect(4 * dpr, 4 * dpr, Math.max(0, width - 8 * dpr), Math.max(0, height - 8 * dpr));
    g.beginPath();
    g.moveTo(width / 2 - 9 * dpr, height / 2); g.lineTo(width / 2 + 9 * dpr, height / 2);
    g.moveTo(width / 2, height / 2 - 9 * dpr); g.lineTo(width / 2, height / 2 + 9 * dpr); g.stroke();

    // One inset for every aspect: its world scale stays uniform (rotation remains meaningful), and actual off-frame
    // camera footprints are included. The drawing is clipped, so tiny / extreme views cannot cover the editor.
    const margin = 9 * dpr, mapW = Math.min(218 * dpr, width - 2 * margin), mapH = Math.min(148 * dpr, height * 0.42);
    if (mapW >= 110 * dpr && mapH >= 72 * dpr) {
      const x = width - mapW - margin, y = height - mapH - margin, pad = 10 * dpr, head = 27 * dpr;
      g.fillStyle = 'rgba(12,18,23,0.88)'; g.fillRect(x, y, mapW, mapH);
      g.strokeStyle = 'rgba(113,230,209,0.6)'; g.strokeRect(x, y, mapW, mapH);
      g.fillStyle = '#e9eef1'; g.font = 11 * dpr + 'px system-ui, sans-serif';
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(o.label || '', x + pad, y + 13 * dpr, mapW - 2 * pad);
      g.save(); g.beginPath(); g.rect(x + pad, y + head, mapW - 2 * pad, mapH - head - pad); g.clip();
      const bounds = overviewBounds(data);
      const s = Math.min((mapW - 2 * pad) / bounds.w, (mapH - head - pad) / bounds.h);
      const ox = x + (mapW - bounds.w * s) / 2, oy = y + head + (mapH - head - pad - bounds.h * s) / 2;
      const map = (wx, wy) => [ox + (wx - bounds.x0) * s, oy + (wy - bounds.y0) * s];
      g.strokeStyle = 'rgba(233,238,241,0.45)'; quad(g, [0, 0, W, 0, W, H, 0, H], map);
      g.setLineDash([3 * dpr, 3 * dpr]); g.strokeStyle = INK; g.beginPath();
      data.path.points.forEach((p, i) => { const [px, py] = map(p.x, p.y); if (!i || p.break) g.moveTo(px, py); else g.lineTo(px, py); });
      g.stroke(); g.setLineDash([]);
      for (const p of data.path.markers) {
        const [px, py] = map(p.x, p.y); g.fillStyle = INK; g.beginPath(); g.arc(px, py, 2.5 * dpr, 0, 2 * Math.PI); g.fill();
      }
      g.strokeStyle = CURRENT; g.lineWidth = 1.6 * dpr; quad(g, data.current.frame, map);
      const centre = map(data.current.centre[0], data.current.centre[1]);
      g.fillStyle = CURRENT; g.beginPath(); g.arc(centre[0], centre[1], 3 * dpr, 0, 2 * Math.PI); g.fill();
      // The last observed direction is taken from a nearby actual sample, not from a preset's nominal pan direction.
      const before = data.path.points.filter((p) => p.t < data.time - 0.025).pop();
      if (before && !data.path.points.some((p) => p.break && p.t > before.t && p.t <= data.time)) {
        const p = map(before.x, before.y), dx = centre[0] - p[0], dy = centre[1] - p[1], len = Math.hypot(dx, dy);
        if (len > 0.2 * dpr) {
          const nx = dx / len, ny = dy / len, ex = centre[0] + nx * 12 * dpr, ey = centre[1] + ny * 12 * dpr;
          g.beginPath(); g.moveTo(centre[0], centre[1]); g.lineTo(ex, ey);
          g.moveTo(ex - nx * 4 * dpr - ny * 3 * dpr, ey - ny * 4 * dpr + nx * 3 * dpr);
          g.lineTo(ex, ey); g.lineTo(ex - nx * 4 * dpr + ny * 3 * dpr, ey - ny * 4 * dpr - nx * 3 * dpr); g.stroke();
        }
      }
      g.restore();
    }
    const status = o.status || ('×' + v.zoom.toFixed(2) + ' / ' + (v.roll / N.DEG).toFixed(1) + '°');
    const labelW = Math.min(width - 2 * margin, 330 * dpr);
    if (labelW > 20 * dpr) {
      g.fillStyle = 'rgba(12,18,23,0.88)'; g.fillRect(margin, margin, labelW, 24 * dpr);
      g.fillStyle = CURRENT; g.font = 11 * dpr + 'px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillText(status, margin + 7 * dpr, margin + 12 * dpr, labelW - 14 * dpr);
    }
    g.restore();
  }

  return { geometry, windowAt, snapshot, overviewBounds, draw, SAMPLES, MAX_BOXES };
});
