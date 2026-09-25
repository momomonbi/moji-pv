/* 文字PVメーカー v2 — original work. World transitions by geometry: push, whip pan, iris, blinds and a shutter. */
MV.def('parts/seam/wipe', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, TAU } = K.math;
  const L = (ja, en) => ({ ja, en });
  const CUBIC = K.ease('cubicInOut');
  const EXPO = K.ease('expoInOut');
  const IN = K.ease('cubicIn');
  const OUT = K.ease('cubicOut');
  const SINE = K.ease('sineInOut');

  // World seams (§4.19.2 step 4) receive two complete frames: a = the old cut over its ground, b = the new one. u runs
  // 0 → 1 across the window centred on the new cut's start. Every part here is a complete transition: at u = 0 the
  // frame is a, at u = 1 it is b.

  // Push directions: where the old frame goes (the new one comes in from the opposite side).
  const DIRS = Object.freeze({ left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] });
  const DIR_PARAM = { type: 'enum', of: ['left', 'right', 'up', 'down'], label: L('向き', 'Direction'),
    auto: { pick: ['left', 'right', 'up', 'down'], weights: [3, 2, 1, 1] } };

  // Whole-pixel positions: a fractional offset resamples the whole frame (several copies' worth of work on a canvas
  // without a GPU), and a slide that fast shows no difference.
  function place(g, s, x, y) { g.drawImage(s.canvas, Math.round(x), Math.round(y)); }

  // Pooled surfaces come back with their transform, alpha and blend reset, but not the line state an earlier user set
  // (caps, joins, dashes): a part that strokes sets all of it, or a frame would depend on what was drawn before it.
  const NO_DASH = Object.freeze([]);
  function lineState(g, width) {
    g.lineWidth = width;
    g.lineCap = 'butt';
    g.lineJoin = 'round';
    g.setLineDash(NO_DASH);
  }

  // Backdrops (DESIGN §4.19.4), told apart by the frame palette after the backdrop rule (fx.pal): on the green-screen
  // key a shadow or rim drawn over the empty green would darken the key colour, so those extras are left out there;
  // on a transparent frame shading is drawn 'source-atop' (only over what is there), which on an opaque frame is the
  // same as drawing over it; black keeps the white-text-only look (blades pure black).
  const KEY_GREEN = '#00B140';
  function groundOf(fx) { return fx.pal && typeof fx.pal.ground === 'string' ? fx.pal.ground.toUpperCase() : ''; }
  function onKey(fx) { return !fx.alpha && groundOf(fx) === KEY_GREEN; }
  function onBlack(fx) { return !fx.alpha && groundOf(fx) === '#000000' && String(fx.pal.ink).toUpperCase() === '#FFFFFF'; }

  // --- shoveAcross -----------------------------------------------------------------------------------------------------

  // The new frame pushes the old one out; a soft shadow falls from the new frame's leading edge onto the old one. (The
  // shadow used to be placed at the new frame's trailing edge, outside the frame, so it never showed.)
  function push(fx, a, b, u, p) {
    const [ux, uy] = DIRS[p.dir] || DIRS.left;
    const w = fx.w, h = fx.h, e = CUBIC(u);
    const ax = ux * e * w, ay = uy * e * h, bx = ax - ux * w, by = ay - uy * h;
    const out = fx.take(), g = out.ctx;
    if (e < 1) place(g, a, ax, ay);
    if (e > 0) place(g, b, bx, by);
    const s = Math.sin(Math.PI * u) * 0.35;
    if (s > 1 / 64 && !onKey(fx)) {
      // the leading edge of b, and the shadow running from it across a (in the direction a moves)
      const ex = ux < 0 ? bx : ux > 0 ? bx + w : 0, ey = uy < 0 ? by : uy > 0 ? by + h : 0;
      const depth = 0.06 * (ux ? w : h);
      const x1 = ex + ux * depth, y1 = ey + uy * depth;
      const grad = g.createLinearGradient(ex, ey, x1, y1);
      grad.addColorStop(0, K.color.rgba('#000000', s));
      grad.addColorStop(1, K.color.rgba('#000000', 0));
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = grad;
      if (ux) g.fillRect(Math.min(ex, x1), 0, depth, h); else g.fillRect(0, Math.min(ey, y1), w, depth);
      g.globalCompositeOperation = 'source-over';
    }
    return out;
  }

  const shoveAcross = K.seam({
    key: 'shoveAcross',
    label: L('押し出し', 'Push slide'),
    blurb: L('次の場面が前の場面を横へ押し出す', 'The next world pushes the previous one out sideways'),
    tags: ['fast', 'bold'], family: 'slide', scope: 'world', replaces: { depart: true },
    traits: { energy: [0.4, 1] },
    shared: { dur: { auto: { range: [0.3, 0.6], follow: '-energy' } } },
    params: { dir: DIR_PARAM },
    mix: push,
  });

  // --- swishCut -------------------------------------------------------------------------------------------------------

  // Blur along one axis by `px` device px: the frame is squeezed along that axis in halving steps (each step averages
  // pairs of pixels, so nothing is skipped) and stretched back with smoothing. Returns a new surface. The steps
  // alternate between two scratch surfaces, each into a region not written before (the 1st, 3rd … squeezes side by
  // side on s1, the 2nd, 4th … on s2): clearing or overwriting a surface whose picture the other one has yet to draw
  // would first copy it whole.
  function smear(fx, src, px, vertical) {
    const w = fx.w, h = fx.h, full = vertical ? h : w;
    const target = Math.max(1, Math.round(full / Math.max(1, px)));
    const s1 = fx.take(), s2 = fx.take();
    let from = src, fromAt = 0, len = full, odd = true, free1 = 0, free2 = 0;
    while (len > target) {
      const next = Math.max(target, Math.ceil(len / 2)), to = odd ? s1 : s2, at = odd ? free1 : free2;
      if (vertical) to.ctx.drawImage(from.canvas, 0, fromAt, w, len, 0, at, w, next);
      else to.ctx.drawImage(from.canvas, fromAt, 0, len, h, at, 0, next, h);
      if (odd) free1 += next + 2; else free2 += next + 2;
      from = to; fromAt = at; len = next; odd = !odd;
    }
    const out = fx.take();
    if (vertical) out.ctx.drawImage(from.canvas, 0, fromAt, w, len, 0, 0, w, h);
    else out.ctx.drawImage(from.canvas, fromAt, 0, len, h, 0, 0, w, h);
    fx.give(s1); fx.give(s2);
    return out;
  }

  // Like a push, but the camera whips: an expo curve (almost all of the travel in the middle) and a motion blur along
  // the travel that peaks with the speed.
  function whip(fx, a, b, u, p) {
    const [ux, uy] = DIRS[p.dir] || DIRS.left;
    const w = fx.w, h = fx.h, e = EXPO(u);
    const ax = ux * e * w, ay = uy * e * h;
    const pair = fx.take(), gp = pair.ctx;
    if (e < 1) place(gp, a, ax, ay);
    if (e > 0) place(gp, b, ax - ux * w, ay - uy * h);
    const s = Math.sin(Math.PI * u), px = p.blur * s * s * (ux ? w : h);
    if (px < 2) return pair;
    const blurred = smear(fx, pair, px, !ux);
    const g = blurred.ctx;
    g.globalAlpha = clamp(1 - s * 1.4);
    g.drawImage(pair.canvas, 0, 0);
    g.globalAlpha = 1;
    fx.give(pair);
    return blurred;
  }

  const swishCut = K.seam({
    key: 'swishCut',
    label: L('振り', 'Whip pan'),
    blurb: L('ぶれながら素早くパンして次のカットへ', 'A fast motion-blurred pan into the next cut'),
    tags: ['fast'], family: 'slide', scope: 'world', replaces: { depart: true },
    traits: { energy: [0.5, 1] },
    shared: { dur: { auto: { range: [0.25, 0.45], follow: '-energy' } } },
    params: {
      dir: DIR_PARAM,
      blur: { type: 'num', min: 0.02, max: 0.5, step: 0.01, unit: 'frac', label: L('ぶれ', 'Blur'), auto: { range: [0.1, 0.2] } },
    },
    mix: whip,
  });

  // --- irisGate (the §4.18.12 example, opening wide enough to clear every corner) ------------------------------------

  // An optional rim follows the opening: a dark band outside a thin light line, so it reads on light and dark frames
  // (left out on the green-screen key). Inside the opening the old frame is cleared first when the frame is
  // transparent: there b does not cover a, and the old words showed through the opening next to the new ones.

  function iris(fx, a, b, u, p) {
    const w = fx.w, h = fx.h, cx = p.cx * w, cy = p.cy * h;
    const ring = onKey(fx) ? 0 : p.ring * fx.unit;
    const r = CUBIC(u) * (Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + ring + 1);
    const out = fx.take(), g = out.ctx;
    if (u < 1) g.drawImage(a.canvas, 0, 0);
    if (r < 0.5) return out;
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, TAU);
    g.clip();
    if (fx.alpha && u < 1) g.clearRect(0, 0, w, h);
    g.drawImage(b.canvas, 0, 0);
    g.restore();
    if (ring >= 0.5) {
      const fade = 1 - u;
      lineState(g, ring);
      g.strokeStyle = K.color.rgba('#000000', 0.45 * fade);
      g.beginPath();
      g.arc(cx, cy, r + ring / 2, 0, TAU);
      g.stroke();
      lineState(g, Math.max(0.5, ring * 0.35));
      g.strokeStyle = K.color.rgba('#FFFFFF', 0.35 * fade);
      g.beginPath();
      g.arc(cx, cy, r, 0, TAU);
      g.stroke();
    }
    return out;
  }

  const irisGate = K.seam({
    key: 'irisGate',
    label: L('絞り', 'Iris gate'),
    blurb: L('円が開いて次のカットが現れる', 'A circle opens onto the next cut'),
    tags: ['bold', 'retro'], family: 'shape', scope: 'world', replaces: { depart: true },
    traits: { energy: [0.2, 0.9] },
    shared: { dur: { auto: { range: [0.35, 0.7], follow: '-energy' } } },
    params: {
      cx: { type: 'num', min: 0, max: 1, step: 0.01, unit: 'frac', label: L('中心X', 'Center X'), auto: { range: [0.35, 0.65] } },
      cy: { type: 'num', min: 0, max: 1, step: 0.01, unit: 'frac', label: L('中心Y', 'Center Y'), auto: { range: [0.35, 0.65] } },
      ring: { type: 'num', min: 0, max: 16, step: 0.5, unit: 'du', label: L('縁の線', 'Rim'), auto: { pick: [0, 3, 5], weights: [1, 2, 1] } },
    },
    mix: iris,
  });

  // --- blindSlats ----------------------------------------------------------------------------------------------------

  // The new frame is behind; the old one is cut into slats that turn edge-on one after another (each slat's image is
  // squeezed toward its middle line and shaded as it turns away). An opaque old slat hides the new frame behind it; a
  // transparent frame hides nothing, so there the new frame is drawn only in the gaps the turning slats open (else
  // the new words showed through the old ones from the first frame). The shading darkens only what a slat shows
  // ('source-atop') and is left out on the green-screen key.
  function blinds(fx, a, b, u, p) {
    const w = fx.w, h = fx.h, vertical = p.axis === 'v', span = vertical ? w : h, n = Math.max(2, p.count | 0);
    const pitch = span / n, lag = p.stagger, shade = !onKey(fx);
    const out = fx.take(), g = out.ctx;
    if (!fx.alpha) g.drawImage(b.canvas, 0, 0);
    for (let k = 0; k < n; k++) {
      const e = SINE(clamp(u * (1 + lag) - (lag * k) / (n - 1)));
      const s0 = k * pitch, size = pitch * (1 - e), s1 = s0 + (pitch - size) / 2;
      if (fx.alpha && e > 0) {
        const top = Math.round(s0), bottom = Math.round(s0 + pitch), in0 = Math.round(s1), in1 = Math.round(s1 + size);
        slab(g, b, vertical, w, h, top, in0 - top);
        slab(g, b, vertical, w, h, in1, bottom - in1);
      }
      if (e >= 1) continue;
      if (vertical) g.drawImage(a.canvas, s0, 0, pitch, h, s1, 0, size, h);
      else g.drawImage(a.canvas, 0, s0, w, pitch, 0, s1, w, size);
      if (e > 0 && shade) {
        g.globalCompositeOperation = 'source-atop';
        g.fillStyle = K.color.rgba('#000000', 0.3 * e);
        if (vertical) g.fillRect(s1, 0, size, h); else g.fillRect(0, s1, w, size);
        g.globalCompositeOperation = 'source-over';
      }
    }
    return out;
  }

  // s's band [at, at + len) along the slat axis, drawn 1:1 in place (nothing when empty).
  function slab(g, s, vertical, w, h, at, len) {
    if (len < 1) return;
    if (vertical) g.drawImage(s.canvas, at, 0, len, h, at, 0, len, h);
    else g.drawImage(s.canvas, 0, at, w, len, 0, at, w, len);
  }

  const blindSlats = K.seam({
    key: 'blindSlats',
    label: L('ブラインド', 'Blind slats'),
    blurb: L('ブラインドの羽根が順に回って次のカットが見える', 'Slats turn open one after another to show the next cut'),
    tags: ['serious', 'retro'], family: 'shape', scope: 'world', replaces: { depart: true },
    traits: { energy: [0.1, 0.85] },
    shared: { dur: { auto: { range: [0.45, 0.8], follow: '-energy' } } },
    params: {
      count: { type: 'int', min: 3, max: 24, label: L('羽根の数', 'Slats'), auto: { range: [7, 12] } },
      axis: { type: 'enum', of: ['h', 'v'], label: L('羽根の向き', 'Slat direction'), auto: { pick: ['h', 'v'], weights: [3, 1] } },
      stagger: { type: 'num', min: 0, max: 1.5, step: 0.05, unit: 'frac', label: L('順番のずれ', 'Stagger'), auto: { range: [0.3, 0.7] } },
    },
    mix: blinds,
  });

  // --- shutterSnap ---------------------------------------------------------------------------------------------------

  // Two dark blades close from opposite edges (accelerating), stay shut for a moment, and snap open on the new frame.
  // A faint light line runs along each blade's edge. On the black backdrop the blades are the backdrop's own black.
  const BLADE = '#0B0B0D';
  function shutter(fx, a, b, u, p) {
    const w = fx.w, h = fx.h, vertical = p.axis !== 'h', span = vertical ? h : w;
    const half = (1 - p.hold) / 2;
    const c = u < half ? IN(u / half) : u > 1 - half ? 1 - OUT((u - (1 - half)) / half) : 1;
    const out = fx.take(), g = out.ctx;
    g.drawImage((u < 0.5 ? a : b).canvas, 0, 0);
    const blade = Math.ceil(c * (span / 2 + 1));
    if (blade < 1) return out;
    g.fillStyle = onBlack(fx) ? '#000000' : BLADE;
    bands(g, vertical, w, h, 0, blade, span - blade, blade);
    if (c < 1) {
      const line = Math.max(1, Math.round(1.5 * fx.unit));
      g.fillStyle = K.color.rgba('#FFFFFF', 0.3);
      bands(g, vertical, w, h, blade - line, line, span - blade, line);
    }
    return out;
  }

  // Two full-width (vertical = true) or full-height bands: [s0, s0 + n0) and [s1, s1 + n1) along the closing axis.
  function bands(g, vertical, w, h, s0, n0, s1, n1) {
    if (vertical) { g.fillRect(0, s0, w, n0); g.fillRect(0, s1, w, n1); } else { g.fillRect(s0, 0, n0, h); g.fillRect(s1, 0, n1, h); }
  }

  const shutterSnap = K.seam({
    key: 'shutterSnap',
    label: L('シャッター', 'Shutter snap'),
    blurb: L('二枚の羽根が閉じてから開き、次のカットになる', 'Two bars close and open like a shutter'),
    tags: ['hard', 'fast'], family: 'shape', scope: 'world', replaces: { depart: true },
    traits: { energy: [0.45, 1] },
    shared: { dur: { auto: { range: [0.3, 0.5], follow: '-energy' } } },
    params: {
      axis: { type: 'enum', of: ['v', 'h'], label: L('閉じる向き', 'Close from'), auto: { pick: ['v', 'h'], weights: [3, 1] } },
      hold: { type: 'num', min: 0, max: 0.4, step: 0.01, unit: 'frac', label: L('閉じている長さ', 'Hold shut'), auto: { range: [0.06, 0.16] } },
    },
    mix: shutter,
  });

  return [shoveAcross, swishCut, irisGate, blindSlats, shutterSnap];
});
