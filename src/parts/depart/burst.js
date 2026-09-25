/* 文字PVメーカー v2 — original work. Forceful exits: shard burst, point implode, zoom past, burn out. */
MV.def('parts/depart/burst', ['parts/kit'], (K) => {
  'use strict';

  const { fract, smooth, TAU } = K.math;
  const FLASH = 0.08;            // shard burst: share of the motion lit in the accent ink before the glyph cracks
  const CRACK = 0.17;            // … and the share over which it then breaks into strips

  // --- the frame seen from each glyph -------------------------------------------------------------------------------
  // These exits aim at the frame: its focus point, "outward" from it, "up". A glyph's delta pose moves it in its
  // parent's (its run's) frame, which a composition may turn and scale (haloRing, slantBand, confettiWords, a nudge),
  // so each build measures per glyph the similarity from that frame to the frame, and the per-glyph functions turn
  // frame vectors back through it. (parts/depart/fall.js has the same helpers: parts share code only through the kit.)

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

  // K.depart for a per-glyph exit that aims at the frame: the frame map is measured once per build and reaches the
  // per-glyph function as p.frame.
  function framed(def) {
    const bound = K.depart(def);
    const make = bound.make;
    return K.variant(bound, { key: def.key,
      make: (env, target, p) => make(env, target, Object.assign({}, p, { frame: frameMap(target) })) });
  }

  // --- per-glyph functions ----------------------------------------------------------------------------------------------

  // A flash of the accent ink, then the glyph cracks into strips (never tinted: the renderer draws a tint as a whole
  // glyph over the strips) that fly outward from the text's centre on the frame along seeded directions, lifted a
  // little, slow to start so the break reads before the throw, spinning, and fade.
  function burst(P, g, k, u, p) {
    const F = p.frame, j = g.index;
    const c = smooth(k);
    const d = Math.hypot(g.cx, g.cy);
    const ox = d > 1 ? (g.cx / d) * 0.75 : 0, oy = (d > 1 ? (g.cy / d) * 0.75 : 0) - 0.15;
    const a = g.rnd * TAU;
    const dist = p.force * g.em * (0.6 + 0.8 * fract(g.rnd * 5.37)) * c;
    P.x += (turnX(F, j, ox, oy) + Math.cos(a) * 0.55) * dist;
    P.y += (turnY(F, j, ox, oy) + Math.sin(a) * 0.55) * dist;
    P.rot += (fract(g.rnd * 9.13) - 0.5) * 300 * c;
    if (u < FLASH) P.tint += Math.sin((Math.PI * u) / FLASH) * 0.8;
    else P.shard += Math.min(1, (u - FLASH) / CRACK);
    P.alpha *= 1 - smooth((u - 0.4) / 0.6);
  }

  // Pulled into the text's centre point on the frame, shrinking, turning and blurring, and gone at the point.
  function implode(P, g, k, u, p) {
    const F = p.frame, j = g.index;
    const c = k < 0 ? 0 : k > 1 ? 1 : k;
    P.x += backX(F, j, -g.cx, -g.cy) * c;
    P.y += backY(F, j, -g.cx, -g.cy) * c;
    const s = 1 - 0.94 * c;
    P.sx *= s;
    P.sy *= s;
    P.rot += p.twist * c;
    P.blur += 0.06 * g.em * c;
    P.tint += 0.6 * c;
    P.alpha *= 1 - smooth((u - 0.75) / 0.25);
  }

  // Rushes at the camera: grows by up to p.zoom, spreads away from the centre on the frame like a push through the
  // text, blurs, fades.
  function rush(P, g, k, u, p) {
    const F = p.frame, j = g.index;
    const c = k < 0 ? 0 : k;
    const s = 1 + (p.zoom - 1) * c;
    P.sx *= s;
    P.sy *= s;
    P.x += backX(F, j, g.cx, g.cy) * (s - 1) * 0.6;
    P.y += backY(F, j, g.cx, g.cy) * (s - 1) * 0.6;
    P.blur += 0.1 * g.em * c;
    P.alpha *= 1 - smooth(u);
  }

  // Flares into the accent ink, swells with a glow, then shrinks away rising up the frame like an ember.
  function burn(P, g, k, u, p) {
    const F = p.frame, j = g.index;
    const c = k < 0 ? 0 : k;
    P.tint += smooth(u / 0.3);
    P.glow += Math.sin(Math.PI * Math.min(1, u / 0.85)) * p.heat;
    const shrink = smooth((c - 0.3) / 0.7);
    const s = 1 - 0.85 * shrink;
    P.sx *= s;
    P.sy *= s;
    const sway = Math.sin(u * 23 + g.rnd * 6) * 0.03 * g.em * c, rise = shrink * 0.4 * g.em;
    P.x += turnX(F, j, sway, -rise);
    P.y += turnY(F, j, sway, -rise);
    P.alpha *= 1 - smooth((u - 0.5) / 0.5);
  }

  return [
    framed({
      key: 'shardBurst',
      label: { ja: '砕け', en: 'Shard burst' },
      blurb: { ja: '文字が破片に砕けて外へ飛び散る', en: 'Glyphs break into fragments that fly outward' },
      tags: ['hard', 'busy'], family: 'burst', needs: ['shard'],
      traits: { energy: [0.4, 1], impact: true },
      shared: { dur: { auto: { range: [0.45, 0.8], follow: '-energy' } }, each: { auto: { range: [0, 0.02] } },
        order: { auto: { pick: ['core', 'scatter', 'lead'], weights: [2, 2, 1] } },
        ease: { auto: { pick: ['cubicOut', 'quadOut'], weights: [2, 1] } } },
      params: {
        force: { type: 'num', min: 1, max: 16, step: 0.5, unit: 'em', label: { ja: '飛ぶ距離', en: 'Throw' },
          auto: { range: [1.5, 3], follow: 'energy' } },
      },
      make: K.perGlyph(burst),
    }),
    framed({
      key: 'pointImplode',
      label: { ja: '吸い込み', en: 'Point implode' },
      blurb: { ja: '文字が一点に吸い込まれて消える', en: 'Glyphs are pulled into one point and vanish' },
      tags: ['digital', 'fast'], family: 'implode', needs: ['blur'],
      shared: { dur: { auto: { range: [0.4, 0.7], follow: '-energy' } }, each: { auto: { range: [0.01, 0.03] } },
        order: { auto: { pick: ['rim', 'lead'], weights: [2, 1] } }, ease: { auto: { pick: ['cubicIn', 'quadIn'], weights: [2, 1] } } },
      params: {
        twist: { type: 'num', min: -360, max: 360, step: 5, unit: 'deg', label: { ja: 'ひねり', en: 'Twist' },
          auto: { pick: [90, -90, 0], weights: [2, 2, 1] } },
      },
      make: K.perGlyph(implode),
    }),
    framed({
      key: 'zoomPast',
      label: { ja: '通り抜け', en: 'Zoom past' },
      blurb: { ja: '文字がこちらへ迫り、通り過ぎるように消える', en: 'Glyphs rush toward the camera and fade' },
      tags: ['fast', 'bold'], family: 'zoom', needs: ['blur'],
      traits: { energy: [0.4, 1] },
      shared: { dur: { auto: { range: [0.3, 0.55], follow: '-energy' } }, each: { auto: { range: [0, 0.03] } },
        order: { auto: { pick: ['core', 'lead'], weights: [2, 1] } }, ease: { auto: { pick: ['expoIn', 'cubicIn'], weights: [2, 1] } } },
      params: {
        zoom: { type: 'num', min: 1.5, max: 10, step: 0.1, unit: 'x', label: { ja: '迫る大きさ', en: 'Zoom' },
          auto: { range: [3, 5], follow: 'energy' } },
      },
      make: K.perGlyph(rush),
    }),
    framed({
      key: 'burnOut',
      label: { ja: '燃え尽き', en: 'Burn out' },
      blurb: { ja: '文字がアクセント色に燃え上がり、光って縮み消える', en: 'Glyphs flare in the accent color, glow, and shrink away' },
      tags: ['bright', 'hard'], family: 'burn',
      shared: { dur: { auto: { range: [0.6, 1.0], follow: '-energy' } }, each: { auto: { range: [0.02, 0.05], follow: '-density' } },
        order: { auto: { pick: ['scatter', 'lead'], weights: [2, 1] } }, ease: { auto: { pick: ['quadIn', 'sineIn'], weights: [2, 1] } } },
      params: {
        heat: { type: 'num', min: 0, max: 1, step: 0.05, label: { ja: '光の強さ', en: 'Glow' }, auto: { range: [0.6, 0.9] } },
      },
      make: K.perGlyph(burn),
    }),
  ];
});
