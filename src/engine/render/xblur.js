/* 文字PVメーカー v2 — original work. Camera motion blur of EXTREME cuts: the frame reprojected along the camera's own motion over a shutter in seconds (DESIGN_EXTREME §1.6). */
MV.def('engine/render/xblur', ['core/mat', 'engine/scene/frame', 'engine/scene/xshot'], (MAT, F, XS) => {
  'use strict';

  // When: the current cut has an x-track with blur > 0, no seam is active, the preview is not toned down (calm), and
  // the frame moves ≥ MIN_DU design units over the shutter. The shutter SH = track.shutter = blur·g/48 s is fixed in
  // seconds, so 30 and 60 fps sample the same function of t.
  // Taps: the camera at t_j = t − SH·j/(n − 1) is cam(t) + Δ_j, Δ_j the difference of the closed-form camera (the x-track
  // pose with its modulators, the rig, the impulses) between t_j and t; the lens deltas are held (no scene is evaluated
  // again). The displacement d is the largest |V(t_j)·V(t)⁻¹·p − p| over the frame centre and four inset corners (design
  // units, at the last tap); n = clamp(ceil(d / MIN_DU), 2, taps). Tap j draws the frame (copied once) onto itself with
  // D·V(t_j)·V(t)⁻¹·D⁻¹ and globalAlpha 1/(j + 1): a running average over the base (uncovered borders keep the base).
  // A clear backdrop (alpha outputs) is cleared, then every copy is added with 'lighter' and alpha 1/n (a true
  // premultiplied average). No pixel reads, no ctx.filter. Allocation-free after the first call.

  const TAPS_EXPORT = 6, TAPS_PREVIEW = 4, TAPS_ADAPT = 3, OFF_LEVEL = 3;
  const MIN_DU = 12;
  const INSET = 0.1;

  // The most copies (base included) a frame may take: export 6; preview 4 at adaptive level 0, 3 at levels 1–2, none
  // from level 3 on.
  function maxTaps(quality, level) {
    if (quality === 'export') return TAPS_EXPORT;
    if (level >= OFF_LEVEL) return 0;
    return level >= 1 ? TAPS_ADAPT : TAPS_PREVIEW;
  }

  const KC = { x: 0, y: 0, zoom: 1, roll: 0, jx: 0, jy: 0, fz: 1, gz: 1 };
  const RIG = { x: 0, y: 0, zoom: 1, roll: 0 };
  const C0 = { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0, fz: 1 };
  const CJ = { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0, fz: 1 };
  const CAM = { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0, fz: 1 };
  const VT = new Float32Array(6), VI = new Float32Array(6), VJ = new Float32Array(6), MJ = new Float32Array(6);

  // The closed-form camera of the cut at absolute time t: the x-track with its modulators, the rig, the impulses.
  function closedAt(track, plan, t, t0, out) {
    return F.composeCamera(XS.camAt(track, t - t0, KC), F.rigAt(plan, t, RIG), plan, t, out);
  }

  // cam ⊕ (C ⊖ C0): the drawn camera moved by the closed-form difference.
  function moved(cam, c, c0, out) {
    out.x = cam.x + (c.x - c0.x); out.y = cam.y + (c.y - c0.y);
    out.zoom = (cam.zoom * c.zoom) / c0.zoom; out.roll = cam.roll + (c.roll - c0.roll);
    out.shakeX = cam.shakeX + (c.shakeX - c0.shakeX); out.shakeY = cam.shakeY + (c.shakeY - c0.shakeY);
    return out;
  }

  // The largest displacement of the centre and the four inset corners under M (design units).
  function displacement(M, W, H) {
    let d = 0;
    const at = (x, y) => {
      const dx = M[0] * x + M[2] * y + M[4] - x, dy = M[1] * x + M[3] * y + M[5] - y;
      d = Math.max(d, Math.sqrt(dx * dx + dy * dy));
    };
    at(W / 2, H / 2);
    at(INSET * W, INSET * H); at((1 - INSET) * W, INSET * H); at((1 - INSET) * W, (1 - INSET) * H); at(INSET * W, (1 - INSET) * H);
    return d;
  }

  // The reprojection of tap time tt into MJ: V(t_j)·V(t)⁻¹ (design units); returns MJ.
  function tapMatrix(track, plan, tt, t0, cam, W, H) {
    closedAt(track, plan, tt, t0, CJ);
    F.viewMatrix(VJ, moved(cam, CJ, C0, CAM), 1, W, H);
    return MAT.mul(MJ, VJ, VI);
  }

  // taps(scene, plan, t, cam, W, H, most, out) → out { n, d, M: Float64Array(6·(most − 1)) } for a blurred frame, else
  // null. scene = the current cut's evaluated scene, cam = its drawn CamPose (text layer, parallax 1), most = maxTaps.
  function taps(scene, plan, t, cam, W, H, most, out) {
    const track = scene && scene.shot;
    if (!track || track.x !== true || !(track.blur > 0) || !(track.shutter > 0) || !(most >= 2)) return null;
    const o = out || { n: 0, d: 0, M: new Float64Array(6 * (TAPS_EXPORT - 1)) };
    const t0 = scene.t0, sh = track.shutter;
    closedAt(track, plan, t, t0, C0);
    F.viewMatrix(VT, cam, 1, W, H);
    if (!MAT.invert(VI, VT)) return null;
    const d = displacement(tapMatrix(track, plan, t - sh, t0, cam, W, H), W, H);
    if (!(d >= MIN_DU)) return null;
    const n = Math.max(2, Math.min(most, Math.ceil(d / MIN_DU)));
    for (let j = 1; j < n; j++) {
      const M = tapMatrix(track, plan, t - (sh * j) / (n - 1), t0, cam, W, H);
      for (let q = 0; q < 6; q++) o.M[(j - 1) * 6 + q] = M[q];
    }
    o.n = n; o.d = d;
    return o;
  }

  const DI = new Float32Array(6), DM = new Float32Array(6), MQ = new Float32Array(6);

  // draw(g, frame, pool, tp, D, clear): the taps onto the frame surface (g = frame.ctx) through a pooled copy of it.
  // D = the design → device transform of the frame.
  function draw(g, frame, pool, tp, D, clear) {
    const copy = pool.take(frame.w, frame.h);
    copy.ctx.drawImage(frame.canvas, 0, 0);
    MAT.invert(DI, D);
    const n = tp.n;
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (clear) {
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, frame.w, frame.h);
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 1 / n;
      g.drawImage(copy.canvas, 0, 0);
    } else g.globalCompositeOperation = 'source-over';
    for (let j = 1; j < n; j++) {
      for (let q = 0; q < 6; q++) MQ[q] = tp.M[(j - 1) * 6 + q];
      MAT.mul(DM, D, MQ);
      MAT.mul(DM, DM, DI);
      g.setTransform(DM[0], DM[1], DM[2], DM[3], DM[4], DM[5]);
      g.globalAlpha = clear ? 1 / n : 1 / (j + 1);
      g.drawImage(copy.canvas, 0, 0);
    }
    g.restore();
    pool.give(copy);
  }

  return { TAPS_EXPORT, TAPS_PREVIEW, TAPS_ADAPT, OFF_LEVEL, MIN_DU, maxTaps, taps, draw, displacement };
});
