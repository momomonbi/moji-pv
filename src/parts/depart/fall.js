/* 文字PVメーカー v2 — original work. Falling exits: drop away, pile collapse, melt down. */
MV.def('parts/depart/fall', ['parts/kit'], (K) => {
  'use strict';

  const { fract, smooth, DEG } = K.math;
  const PILE_FALL = 0.55;        // pile collapse: share of the motion spent falling
  const PILE_FADE = 0.78;        // … after which the pile fades

  // --- the frame seen from each glyph -------------------------------------------------------------------------------
  // These exits fall down the frame and land on its floor. A glyph's delta pose moves it in its parent's (its run's)
  // frame, which a composition may turn and scale (haloRing, slantBand, confettiWords, a nudge), so each build measures
  // per glyph the similarity from that frame to the frame, and the per-glyph functions turn frame vectors back through
  // it. (parts/depart/burst.js has the same helpers: parts share code only through the kit.)

  // The similarity q ≈ scale·R(θ)·p + t that best fits the point pairs (least squares) → { cos, sin, scale, err }, or
  // null when the p do not spread. Near-exact turns and scales snap, so an upright composition gets the identity.
  function fitSimilarity(px, py, qx, qy) {
    const n = px.length;
    if (n < 2) return null;
    let mpx = 0, mpy = 0, mqx = 0, mqy = 0;
    for (let i = 0; i < n; i++) { mpx += px[i]; mpy += py[i]; mqx += qx[i]; mqy += qy[i]; }
    mpx /= n; mpy /= n; mqx /= n; mqy /= n;
    let dot = 0, cross = 0, norm = 0;
    for (let i = 0; i < n; i++) {
      const ax = px[i] - mpx, ay = py[i] - mpy, bx = qx[i] - mqx, by = qy[i] - mqy;
      dot += ax * bx + ay * by;
      cross += ax * by - ay * bx;
      norm += ax * ax + ay * ay;
    }
    if (!(norm > 1)) return null;
    const a = dot / norm, b = cross / norm, scale = Math.hypot(a, b);
    if (!(scale > 1e-6)) return null;
    let err = 0;
    for (let i = 0; i < n; i++) {
      const ax = px[i] - mpx, ay = py[i] - mpy;
      err = Math.max(err, Math.hypot(a * ax - b * ay + mqx - qx[i], b * ax + a * ay + mqy - qy[i]));
    }
    return snapped(a / scale, b / scale, scale, err);
  }

  function snapped(cos, sin, scale, err) {
    const EPS = 1e-4;
    const c = Math.abs(sin) < EPS ? Math.sign(cos) : Math.abs(cos) < EPS ? 0 : cos;
    const s = Math.abs(cos) < EPS ? Math.sign(sin) : Math.abs(sin) < EPS ? 0 : sin;
    return { cos: c, sin: s, scale: Math.abs(scale - 1) < EPS ? 1 : scale, err };
  }

  // frameMap(target) → { cos, sin, scale } per glyph (frame vector = scale·R(θ)·parent vector). A run with glyphs at two
  // or more places is fitted on its own (exact for any turn and uniform scale above it). A one-glyph run turns by its
  // spec.rot about its box centre inside its parent; that parent is fitted over every glyph seen this way (exact when
  // the runs share one parent, as haloRing's do), or taken as upright when that fit does not hold.
  function frameMap(target) {
    const n = target.to - target.from;
    const map = { cos: new Float64Array(n).fill(1), sin: new Float64Array(n), scale: new Float64Array(n).fill(1) };
    const runs = target.runs || [];
    const members = runs.map(() => []);
    for (let j = 0; j < n; j++) if (members[target.unitOf.run[j]]) members[target.unitOf.run[j]].push(j);
    const seen = { px: [], py: [], qx: [], qy: [] };
    const own = runs.map((run, r) => {
      const js = members[r];
      addSeenFromParent(target, run.spec, js, seen);
      return fitSimilarity(js.map((j) => target.x[j]), js.map((j) => target.y[j]), js.map((j) => target.wx[j]),
        js.map((j) => target.wy[j]));
    });
    const shared = fitSimilarity(seen.px, seen.py, seen.qx, seen.qy);
    const parent = shared && shared.err <= 0.5 ? shared : null;
    runs.forEach((run, r) => {
      const m = own[r] || turned(parent, run.spec.rot || 0);
      for (const j of members[r]) { map.cos[j] = m.cos; map.sin[j] = m.sin; map.scale[j] = m.scale; }
    });
    return map;
  }

  // The run's glyph centres in its parent's frame: the run node turns by spec.rot about its box centre.
  function addSeenFromParent(target, spec, js, seen) {
    const rot = spec.rot || 0, c = Math.cos(rot), s = Math.sin(rot);
    const box = spec.box, ox = box.x + box.w / 2, oy = box.y + box.h / 2;
    for (const j of js) {
      const dx = target.x[j] - ox, dy = target.y[j] - oy;
      seen.px.push(ox + c * dx - s * dy); seen.py.push(oy + s * dx + c * dy);
      seen.qx.push(target.wx[j]); seen.qy.push(target.wy[j]);
    }
  }

  // The parent's similarity followed by the run's own turn (an upright, unscaled parent when there is none).
  function turned(parent, rot) {
    const c = Math.cos(rot), s = Math.sin(rot);
    if (!parent) return snapped(c, s, 1, 0);
    return snapped(parent.cos * c - parent.sin * s, parent.sin * c + parent.cos * s, parent.scale, 0);
  }

  // A frame vector in du, seen from glyph j's parent frame (turned back and unscaled).
  function backX(F, j, vx, vy) { return (F.cos[j] * vx + F.sin[j] * vy) / F.scale[j]; }
  function backY(F, j, vx, vy) { return (F.cos[j] * vy - F.sin[j] * vx) / F.scale[j]; }
  // A frame direction turned into glyph j's parent frame (for lengths measured in the glyph's own em).
  function turnX(F, j, vx, vy) { return F.cos[j] * vx + F.sin[j] * vy; }
  function turnY(F, j, vx, vy) { return F.cos[j] * vy - F.sin[j] * vx; }

  // K.depart for a per-glyph exit that needs data from the laid-out text: prep(env, target, p, frame) runs once per
  // build and its result, with the frame map as `frame`, is merged into the params the per-glyph function receives.
  function prepared(def, prep) {
    const bound = K.depart(def);
    const make = bound.make;
    return K.variant(bound, { key: def.key, make: (env, target, p) => {
      const frame = frameMap(target);
      return make(env, target, Object.assign({}, p, prep ? prep(env, target, p, frame) : null, { frame }));
    } });
  }

  // How far the glyph reaches from its centre on the frame, whatever way it tumbles (du).
  function reachOf(target, F, j) { return F.scale[j] * Math.max(target.w[j], target.h[j]); }

  // Drop away: how far each glyph must fall down the frame to clear its bottom edge, in the glyph's parent units.
  function clearance(env, target, p, F) {
    const n = target.to - target.from;
    const away = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      const du = env.D.h - target.wy[j] + reachOf(target, F, j) + 0.05 * env.D.short;
      away[j] = Math.max(du, target.em[j] * F.scale[j]) / F.scale[j];
    }
    return { away };
  }

  // Pile collapse: where each glyph lands, on the frame (du). Glyphs are dropped in their stagger order into columns
  // about one em wide on the frame's floor, each landing on the ones already there, with a seeded sideways drift and
  // tilt, kept inside the frame's sides (the drift of a column near an edge would carry glyphs out of a narrow frame);
  // a glyph stacks by its height on the frame at the turn it lands with.
  function landing(env, target, p, F) {
    const n = target.to - target.from;
    const dx = new Float32Array(n), dy = new Float32Array(n), tilt = new Float32Array(n);
    if (n === 0) return { pile: { dx, dy, tilt } };
    const rank = K.staggerOf(env, target, p.order, 1, 'glyph');
    const seq = Array.from({ length: n }, (_, j) => j).sort((a, b) => rank[a] - rank[b] || a - b);
    const vertical = env.orient === 'v';
    let emSum = 0;
    for (let j = 0; j < n; j++) emSum += target.em[j] * F.scale[j];
    const col = Math.max(1, (emSum / n) * 0.9);
    const floor = env.D.h - env.D.safe.b * 0.4;
    const height = new Map();
    for (const j of seq) {
      const em = target.em[j] * F.scale[j];
      dx[j] = (env.rng.next() - 0.5) * em * (vertical ? 3 : 0.6);
      tilt[j] = (env.rng.next() - 0.5) * 80;
      const turn = Math.atan2(F.sin[j], F.cos[j]) + tilt[j] * DEG;
      const tall = F.scale[j] * (Math.abs(target.w[j] * Math.sin(turn)) + Math.abs(target.h[j] * Math.cos(turn)));
      const wide = F.scale[j] * (Math.abs(target.w[j] * Math.cos(turn)) + Math.abs(target.h[j] * Math.sin(turn)));
      const lo = env.D.safe.l * 0.4 + wide / 2, hi = env.D.w - env.D.safe.r * 0.4 - wide / 2;
      if (lo < hi) dx[j] = Math.min(hi, Math.max(lo, target.wx[j] + dx[j])) - target.wx[j];
      const bucket = Math.round((target.wx[j] + dx[j]) / col);
      const below = height.get(bucket) || 0;
      dy[j] = Math.max(floor - below - tall * 0.45 - target.wy[j], 0.2 * em);
      height.set(bucket, below + tall * 0.72);
    }
    return { pile: { dx, dy, tilt } };
  }

  // --- per-glyph functions ----------------------------------------------------------------------------------------------

  // A small hop, then gravity carries the glyph down the frame and out of it while it drifts and tumbles to one side.
  function tumble(P, g, k, u, p) {
    const F = p.frame, j = g.index;
    const c = k < 0 ? 0 : k > 1 ? 1 : k;
    const a = p.away[j] / 0.76, b = 0.24 * a;              // fall(c) = a·c² − b·c: peak near c = 0.12, fall(1) = away
    const side = g.rnd < 0.5 ? -1 : 1;
    const fall = a * c * c - b * c, drift = side * (0.3 + g.rnd) * g.em * c;
    P.x += turnX(F, j, drift, fall);
    P.y += turnY(F, j, drift, fall);
    P.rot += side * (80 + 220 * fract(g.rnd * 5.1)) * c;
    P.alpha *= 1 - smooth((u - 0.85) / 0.15);
  }

  // Falls to its place on the pile, lands with a small bounce, lies there tilted, then the pile fades.
  function pile(P, g, k, u, p) {
    const F = p.frame, L = p.pile, j = g.index;
    const c = k < 0 ? 0 : k > 1 ? 1 : k;
    let x, y, rot;
    if (c < PILE_FALL) {
      const f = c / PILE_FALL;
      x = L.dx[j] * f; y = L.dy[j] * f * f; rot = L.tilt[j] * f;
    } else {
      const f = (c - PILE_FALL) / (1 - PILE_FALL);
      const hop = f < 0.3 ? Math.sin((Math.PI * f) / 0.3) * 0.12 * g.em * F.scale[j] : 0;
      x = L.dx[j]; y = L.dy[j] - hop; rot = L.tilt[j];
    }
    P.x += backX(F, j, x, y);
    P.y += backY(F, j, x, y);
    P.rot += rot;
    P.alpha *= 1 - smooth((u - PILE_FADE) / (1 - PILE_FADE));
  }

  // Stretches downward (by a seeded amount) along its own axis nearest the frame's down, from its edge nearest the
  // frame's top, narrows, drips down the frame and blurs as it fades.
  function melt(P, g, k, u, p) {
    const F = p.frame, j = g.index;
    const c = k < 0 ? 0 : k;
    const d = 0.7 + 0.6 * g.rnd;
    const s = 1 + 1.4 * c * d, thin = 1 - 0.2 * c;
    const downX = turnX(F, j, 0, 1), downY = turnY(F, j, 0, 1);
    const drip = c * c * 0.6 * g.em * d;
    if (Math.abs(downY) >= Math.abs(downX)) {
      P.sy *= s;
      P.sx *= thin;
      P.y += Math.sign(downY) * (s - 1) * g.h * 0.5;
    } else {
      P.sx *= s;
      P.sy *= thin;
      P.x += Math.sign(downX) * (s - 1) * g.w * 0.5;
    }
    P.x += downX * drip;
    P.y += downY * drip;
    P.blur += 0.12 * g.em * c;
    P.alpha *= 1 - smooth((u - 0.2) / 0.8);
  }

  return [
    prepared({
      key: 'dropAway',
      label: { ja: '落ちる', en: 'Drop away' },
      blurb: { ja: '文字が重さに引かれて転がりながら画面の下へ落ちる', en: 'Glyphs fall with gravity and tumble out of the frame' },
      tags: ['playful'], family: 'drop',
      shared: { dur: { auto: { range: [0.6, 0.9], follow: '-energy' } }, each: { auto: { range: [0.02, 0.05], follow: '-density' } },
        order: { auto: { pick: ['scatter', 'lead'], weights: [2, 1] } }, ease: { auto: { value: 'linear' } } },
      make: K.perGlyph(tumble),
    }, clearance),
    prepared({
      key: 'pileCollapse',
      label: { ja: '崩れ', en: 'Pile collapse' },
      blurb: { ja: '文字が崩れ落ちて画面の底に積み重なり、消える', en: 'Glyphs drop and pile up at the bottom, then fade' },
      tags: ['playful', 'busy'], family: 'drop',
      traits: { cells: [2, 40] },
      shared: { dur: { auto: { range: [0.8, 1.2], follow: '-energy' } }, each: { auto: { range: [0.02, 0.05], follow: '-density' } },
        order: { auto: { pick: ['scatter', 'tail'], weights: [2, 1] } }, ease: { auto: { value: 'linear' } } },
      make: K.perGlyph(pile),
    }, landing),
    prepared({
      key: 'meltDown',
      label: { ja: '溶け', en: 'Melt down' },
      blurb: { ja: '文字が下へ垂れて伸び、にじみながら消える', en: 'Glyphs stretch downward and blur as they fade' },
      tags: ['wet', 'dark'], family: 'sink', needs: ['blur'],
      traits: { energy: [0, 0.7] },
      shared: { dur: { auto: { range: [0.6, 1.0], follow: '-energy' } }, each: { auto: { range: [0.02, 0.05], follow: '-density' } },
        order: { auto: { pick: ['scatter', 'lead'], weights: [2, 1] } }, ease: { auto: { pick: ['sineIn', 'quadIn'], weights: [2, 1] } } },
      make: K.perGlyph(melt),
    }, null),
  ];
});
