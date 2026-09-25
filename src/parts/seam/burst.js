/* 文字PVメーカー v2 — original work. World transitions with a jolt: zoom through, glitch swap and a white flash. */
MV.def('parts/seam/burst', ['parts/kit'], (K) => {
  'use strict';

  const { clamp } = K.math;
  const L = (ja, en) => ({ ja, en });
  const IN = K.ease('cubicIn');
  const OUT = K.ease('cubicOut');

  // Like parts/seam/wipe: a and b are complete frames, and each transition runs from a (u = 0) to b (u = 1).

  // Frames whose empty areas and colours must stay as they are (DESIGN §4.19.4): transparent (clear), the green-screen
  // key and black (white text only). fx.pal is the frame palette after the backdrop rule, so its ground tells them apart.
  const KEY_GREEN = '#00B140';
  function plainFrame(fx) {
    if (fx.alpha) return true;
    const pal = fx.pal;
    if (!pal) return false;
    const ground = String(pal.ground).toUpperCase(), ink = String(pal.ink).toUpperCase();
    return ground === KEY_GREEN || (ground === '#000000' && ink === '#FFFFFF');
  }

  // Draws s scaled by k about the frame centre.
  function scaled(g, fx, s, k) {
    const W = fx.w * k, H = fx.h * k;
    g.drawImage(s.canvas, (fx.w - W) / 2, (fx.h - H) / 2, W, H);
  }

  // --- plungeZoom ---------------------------------------------------------------------------------------------------

  // The camera dives into the old frame (accelerating) and comes out of the new one (decelerating from the same depth).
  // A fainter copy a little further along the zoom gives a radial motion blur that follows the speed (one copy: each
  // scaled full-frame draw costs several plain copies on a canvas without a GPU); the new frame fades in over the old
  // one around the middle (the old one stays opaque underneath, so nothing shows through). In a transparent frame the
  // new one covers nothing, so there the old one fades out as the new one fades in (else both lines stood at full
  // strength over each other).
  function frameAt(g, fx, s, k, speed, alpha) {
    if (alpha < 1 / 64) return;
    g.globalAlpha = clamp(alpha);
    scaled(g, fx, s, k);
    if (speed > 0.02) {
      g.globalAlpha = clamp(alpha * 0.3);
      scaled(g, fx, s, k * (1 + 1.5 * speed));
    }
    g.globalAlpha = 1;
  }

  function zoom(fx, a, b, u, p) {
    const out = fx.take(), g = out.ctx;
    const depth = p.depth - 1, mixB = K.math.smooth((u - 0.4) / 0.2);
    if (u < 0.6) {
      const k = clamp(u / 0.5);
      frameAt(g, fx, a, 1 + depth * IN(k), 0.12 * depth * k * k, fx.alpha ? 1 - mixB : 1);
    }
    if (u > 0.4) {
      const k = clamp((u - 0.5) / 0.5);
      frameAt(g, fx, b, 1 + depth * (1 - OUT(k)), 0.12 * depth * (1 - k) * (1 - k), mixB);
    }
    return out;
  }

  const plungeZoom = K.seam({
    key: 'plungeZoom',
    label: L('ズーム抜け', 'Zoom through'),
    blurb: L('前のカットへ飛び込み、次のカットから抜け出る', 'Zoom into the old cut and out of the new one'),
    tags: ['fast', 'bold'], family: 'zoom', scope: 'world', replaces: { depart: true },
    traits: { energy: [0.45, 1] },
    shared: { dur: { auto: { range: [0.3, 0.6], follow: '-energy' } } },
    params: {
      depth: { type: 'num', min: 1.2, max: 4, step: 0.05, unit: 'x', label: L('飛び込む深さ', 'Depth'),
        auto: { range: [1.6, 2.6], follow: 'energy' } },
    },
    mix: zoom,
  });

  // --- glitchSwap ----------------------------------------------------------------------------------------------------

  // The frame is cut into seeded horizontal strips; each strip switches from the old frame to the new one at its own
  // moment (between 20 % and 80 % of the window). Strips near their switch jump sideways and flash a channel-inverted
  // tint on a thin seeded sliver of the strip (a whole strip in saturated colour read as a flat bar, not damage; no
  // tint in frames whose empty areas and colours must stay as they are, see plainFrame); an envelope that is 0 at both
  // ends keeps the first frame exactly a and the last exactly b. The jumps take new offsets on every tick of `rate`,
  // counted in seconds across the window so the pattern does not depend on the frame rate. The seam only sees u, not
  // how long its window really is (the planner may shorten it), so the seconds are counted over `dur` capped at
  // TICK_SPAN, the longest automatic duration: a window shortened from a longer pinned `dur` then does not tick several
  // times faster than `rate`.
  const TICK_SPAN = 0.5;
  const SLIVER = 0.3;                // a tint covers this share of its strip's height
  const TINT_PEAK = 0.45;
  function strip(g, s, w, y, sh, dx) {
    const sx = ((Math.round(-dx) % w) + w) % w;
    g.drawImage(s.canvas, sx, y, w - sx, sh, 0, y, w - sx, sh);
    if (sx > 0) g.drawImage(s.canvas, 0, y, sx, sh, w - sx, y, sx, sh);
  }

  function swap(fx, a, b, u, p) {
    const w = fx.w, h = fx.h, n = Math.max(2, p.strips | 0);
    const tick = fx.tick(p.rate, u * Math.min(p.dur, TICK_SPAN));
    const ends = K.math.smooth(u / 0.12) * K.math.smooth((1 - u) / 0.12), tints = !plainFrame(fx);
    const out = fx.take(), g = out.ctx;
    let total = 0;
    for (let j = 0; j < n; j++) total += 0.4 + fx.noise(j * 8 + 1);
    let y = 0;
    for (let j = 0; j < n; j++) {
      const y1 = j === n - 1 ? h : Math.round(y + ((0.4 + fx.noise(j * 8 + 1)) / total) * h);
      const sh = y1 - Math.round(y);
      const at = 0.2 + 0.6 * fx.noise(j * 8 + 2);
      const near = ends * Math.exp(-Math.pow((u - at) / 0.09, 2));
      const jump = (fx.noise(tick * 997 + j * 8 + 3) * 2 - 1) * p.shift * fx.unit * near;
      if (sh > 0) {
        strip(g, u >= at ? b : a, w, Math.round(y), sh, jump);
        if (tints && near > 0.35 && fx.noise(tick * 991 + j * 8 + 4) < 0.5) {
          const th = Math.max(1, Math.round(sh * SLIVER));
          const ty = Math.round(y) + Math.round((sh - th) * fx.noise(tick * 983 + j * 8 + 6));
          g.globalCompositeOperation = 'difference';
          g.globalAlpha = clamp(TINT_PEAK * near);
          g.fillStyle = fx.noise(j * 8 + 5) < 0.5 ? '#00FFFF' : '#FF00FF';
          g.fillRect(0, ty, w, th);
          g.globalCompositeOperation = 'source-over';
          g.globalAlpha = 1;
        }
      }
      y = y1;
    }
    return out;
  }

  const glitchSwap = K.seam({
    key: 'glitchSwap',
    label: L('乱れ替え', 'Glitch swap'),
    blurb: L('乱れた横帯が一本ずつ次の場面に入れ替わる', 'Glitchy horizontal bands swap one world for the other'),
    tags: ['digital', 'hard'], family: 'glitch', scope: 'world', gate: 'glitch',
    traits: { energy: [0.45, 1] },
    shared: { dur: { auto: { range: [0.25, 0.5], follow: '-energy' } } },
    params: {
      strips: { type: 'int', min: 3, max: 40, label: L('帯の数', 'Strips'), auto: { range: [10, 18] } },
      shift: { type: 'num', min: 0, max: 300, step: 1, unit: 'du', label: L('ずれ幅', 'Shift'), auto: { range: [50, 140], follow: 'energy' } },
      rate: { type: 'num', min: 4, max: 40, step: 1, unit: 'Hz', label: L('乱れる速さ', 'Rate'), auto: { range: [14, 24] } },
    },
    mix: swap,
  });

  // --- whiteFlash ----------------------------------------------------------------------------------------------------

  // The old frame blows out to white (its highlights clip first), the cut happens under the white peak, and the new
  // frame comes back out of it a little faster than it went in. The preview's reduce-flash scale (when the FxContext
  // carries one) tones the white down; the cut still happens at the middle.
  function flash(fx, a, b, u, p) {
    const into = u < 0.5, k = into ? u / 0.5 : 1 - (u - 0.5) / 0.5;
    const dim = typeof fx.flashScale === 'number' ? clamp(fx.flashScale) : 1;
    const white = p.peak * dim * (into ? k * k : Math.pow(k, 1.6));
    const out = fx.take(), g = out.ctx, base = into ? a : b;
    g.drawImage(base.canvas, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = clamp(white * 0.7);
    g.drawImage(base.canvas, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = clamp(white);
    g.fillStyle = '#FFFFFF';
    g.fillRect(0, 0, fx.w, fx.h);
    g.globalAlpha = 1;
    return out;
  }

  const whiteFlash = K.seam({
    key: 'whiteFlash',
    label: L('白飛び', 'White flash'),
    blurb: L('画面が白く飛び、白の中から次のカットが戻る', 'A flash to white and back into the new cut'),
    tags: ['bright', 'hard'], family: 'flash', scope: 'world', replaces: { depart: true }, gate: 'flash',
    traits: { energy: [0.4, 1] },
    shared: { dur: { auto: { range: [0.3, 0.6], follow: '-energy' } } },
    params: {
      peak: { type: 'num', min: 0.3, max: 1, step: 0.05, unit: 'frac', label: L('白さ', 'Peak'), auto: { range: [0.85, 1] } },
    },
    mix: flash,
  });

  return [plungeZoom, glitchSwap, whiteFlash];
});
