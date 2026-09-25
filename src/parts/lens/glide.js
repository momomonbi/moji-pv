/* 文字PVメーカー v2 — original work. Smooth camera moves: push, pull back, drift, pan, orbit, rocking roll. */
MV.def('parts/lens/glide', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, DEG, TAU } = K.math;
  const L = (ja, en) => ({ ja, en });
  const ALL_ROLES = ['lyric', 'focus', 'title', 'interlude', 'outro'];

  // A lens drives the camera node (§4.19.3): x/y = where the camera looks (du from the frame centre), sx/sy = zoom,
  // rot = roll (radians). Every move runs over the cut's whole visible window [a, b] and is closed-form in t. The
  // shared `amount` scales the move: 0.5 is the move as authored, 0 half of it, 1 one and a half times (like the
  // §4.18.10 example's `0.5 + amount`).
  function strength(p) { return 0.5 + p.amount; }

  function cameraBehaviour(env, cam, run, fields) {
    const t0 = env.times.a, t1 = env.times.b;
    return Object.assign({ phase: K.PH.LENS, live: 'always', from: cam, to: cam + 1, t0, t1, run,
      span: Math.max(1e-3, t1 - t0) }, fields);
  }

  // The text block's centre relative to the frame centre (du), times `share`: zooming about that point keeps the words
  // where they are while the frame around them grows or shrinks.
  function aimAt(env, share) {
    const f = env.hints && env.hints.focus;
    if (!f || !(f.w > 0 || f.h > 0)) return { ax: 0, ay: 0 };
    return { ax: (f.x + f.w / 2 - env.D.cx) * share, ay: (f.y + f.h / 2 - env.D.cy) * share };
  }

  function progress(t, b) { return clamp((t - b.t0) / b.span); }

  // --- run functions (module level, pure in t, no allocation) -----------------------------------------------------

  // Zoom from 1 + z0 to 1 + z1 about the aim point: camX = aim · (1 − 1/zoom) keeps that point fixed on screen.
  function zoomTrack(P, t, b) {
    const z = 1 + b.z0 + (b.z1 - b.z0) * b.curve(progress(t, b));
    const k = 1 - 1 / z, n = b.from;
    P.sx[n] *= z; P.sy[n] *= z;
    P.x[n] += b.ax * k; P.y[n] += b.ay * k;
  }

  // Travel (dx, dy) across the window, centred on the rest position, with an optional roll from −roll to +roll.
  function slide(P, t, b) {
    const u = b.curve(progress(t, b)) - 0.5, n = b.from;
    P.x[n] += b.dx * u; P.y[n] += b.dy * u;
    if (b.roll !== 0) P.rot[n] += b.roll * Math.sin(Math.PI * u);
  }

  // Part of a circle around the text: the camera swings sideways and turns a little the other way, so layers with
  // different parallax slide against each other.
  function orbit(P, t, b) {
    const th = b.th0 + b.sweep * b.curve(progress(t, b));
    const s = Math.sin(th), c = Math.cos(th), n = b.from;
    const z = 1 + b.zoom * c;
    P.x[n] += b.r * s; P.y[n] += b.lift * (1 - c);
    P.rot[n] -= b.roll * s;
    P.sx[n] *= z; P.sy[n] *= z;
  }

  function rock(P, t, b) {
    P.rot[b.from] += b.angle * Math.sin((TAU * (t - b.t0)) / b.period);
  }

  // --- slowPush / dollyOut -------------------------------------------------------------------------------------------

  const aimParam = { type: 'num', min: 0, max: 1, step: 0.05, unit: 'frac', label: L('文字を中心に', 'Aim at the text'),
    auto: { range: [0.7, 1] }, ui: 'advanced' };

  const slowPush = K.lens({
    key: 'slowPush',
    label: L('寄り', 'Slow push'),
    blurb: L('カットのあいだに文字へゆっくり寄っていく', 'A slow push in toward the words over the cut'),
    tags: ['slow', 'serious'], family: 'push',
    traits: { energy: [0, 0.8], roles: ALL_ROLES },
    params: {
      push: { type: 'num', min: 0.01, max: 0.3, step: 0.005, unit: 'x', label: L('寄り幅', 'Push'),
        auto: { range: [0.05, 0.1], follow: 'dur' } },
      aim: aimParam,
    },
    make(env, cam, p) {
      return [cameraBehaviour(env, cam, zoomTrack, Object.assign({ z0: 0, z1: p.push * strength(p),
        curve: K.ease('sineInOut') }, aimAt(env, p.aim)))];
    },
  });

  const dollyOut = K.lens({
    key: 'dollyOut',
    label: L('引き', 'Dolly out'),
    blurb: L('近くから始まり、ゆっくり引いて全体を見せる', 'Starts close and slowly pulls back to the full frame'),
    tags: ['slow', 'airy'], family: 'push',
    traits: { energy: [0, 0.8], roles: ALL_ROLES },
    params: {
      pull: { type: 'num', min: 0.01, max: 0.3, step: 0.005, unit: 'x', label: L('引き幅', 'Pull'),
        auto: { range: [0.06, 0.12], follow: 'dur' } },
      aim: aimParam,
    },
    make(env, cam, p) {
      return [cameraBehaviour(env, cam, zoomTrack, Object.assign({ z0: p.pull * strength(p), z1: 0,
        curve: K.ease('quadOut') }, aimAt(env, p.aim)))];
    },
  });

  // --- driftFloat / panSweep -----------------------------------------------------------------------------------------

  const driftFloat = K.lens({
    key: 'driftFloat',
    label: L('漂い', 'Drift float'),
    blurb: L('カメラが横へゆっくり流れ、わずかに傾く', 'The camera drifts slowly sideways with a slight roll'),
    tags: ['airy', 'soft'], family: 'drift',
    traits: { energy: [0, 0.75], roles: ALL_ROLES },
    params: {
      dist: { type: 'num', min: 10, max: 300, step: 1, unit: 'du', label: L('流れる距離', 'Distance'),
        auto: { range: [40, 90], follow: 'dur' } },
      angle: { type: 'num', min: -180, max: 180, step: 1, unit: 'deg', label: L('向き', 'Direction'),
        auto: { pick: [0, 180, 15, 165, -15, -165], weights: [3, 3, 1, 1, 1, 1] } },
      roll: { type: 'num', min: 0, max: 4, step: 0.1, unit: 'deg', label: L('傾き', 'Roll'), auto: { range: [0.3, 1] } },
    },
    make(env, cam, p) {
      const s = strength(p), a = p.angle * DEG;
      return [cameraBehaviour(env, cam, slide, { dx: p.dist * s * Math.cos(a), dy: p.dist * s * Math.sin(a),
        roll: p.roll * DEG * s * Math.sign(Math.cos(a) || 1), curve: K.ease('linear') })];
    },
  });

  const PAN = Object.freeze({ right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] });

  const panSweep = K.lens({
    key: 'panSweep',
    label: L('パン', 'Pan sweep'),
    blurb: L('カットのあいだにカメラが画面を横切ってパンする', 'The camera pans across the frame during the cut'),
    tags: ['fast'], family: 'drift',
    traits: { energy: [0.35, 1] },
    params: {
      dir: { type: 'enum', of: ['right', 'left', 'down', 'up'], label: L('向き', 'Direction'),
        auto: { pick: ['right', 'left', 'down', 'up'], weights: [3, 3, 1, 1] } },
      dist: { type: 'num', min: 0.01, max: 0.25, step: 0.005, unit: 'frac', label: L('振り幅', 'Distance'),
        auto: { range: [0.04, 0.09], follow: 'energy' } },
    },
    make(env, cam, p) {
      const [ux, uy] = PAN[p.dir] || PAN.right;
      const d = p.dist * strength(p);
      return [cameraBehaviour(env, cam, slide, { dx: ux * d * env.D.w, dy: uy * d * env.D.h, roll: 0,
        curve: K.ease('sineInOut') })];
    },
  });

  // --- parallaxOrbit -------------------------------------------------------------------------------------------------

  const parallaxOrbit = K.lens({
    key: 'parallaxOrbit',
    label: L('回り込み', 'Parallax orbit'),
    blurb: L('カメラが回り込むように動き、奥と手前の層がずれていく', 'The layers slide against each other as if the camera circles the words'),
    tags: ['airy'], family: 'orbit',
    traits: { energy: [0.1, 0.85], roles: ['lyric', 'focus', 'title', 'outro'] },
    params: {
      radius: { type: 'num', min: 0.01, max: 0.15, step: 0.005, unit: 'frac', label: L('半径', 'Radius'),
        auto: { range: [0.03, 0.06], follow: 'dur' } },
      sweep: { type: 'num', min: 10, max: 180, step: 1, unit: 'deg', label: L('回る角度', 'Sweep'),
        auto: { range: [60, 120] } },
      dir: { type: 'enum', of: ['cw', 'ccw'], label: L('回る向き', 'Direction'), auto: { pick: ['cw', 'ccw'] } },
    },
    make(env, cam, p) {
      const s = strength(p), sign = p.dir === 'ccw' ? -1 : 1, sweep = p.sweep * DEG * sign;
      return [cameraBehaviour(env, cam, orbit, { r: p.radius * env.D.w * s, lift: p.radius * env.D.h * 0.25 * s,
        th0: -sweep / 2, sweep, roll: 0.9 * DEG * s, zoom: 0.03 * s, curve: K.ease('sineInOut') })];
    },
  });

  // --- rollSway ------------------------------------------------------------------------------------------------------

  const rollSway = K.lens({
    key: 'rollSway',
    label: L('傾き揺れ', 'Roll sway'),
    blurb: L('カメラがゆりかごのようにゆっくり左右へ傾く', 'The camera rocks gently from side to side like a cradle'),
    tags: ['soft', 'playful'], family: 'roll',
    traits: { energy: [0, 0.8] },
    params: {
      angle: { type: 'num', min: 0.2, max: 6, step: 0.1, unit: 'deg', label: L('傾き', 'Angle'),
        auto: { range: [0.8, 2], follow: 'energy' } },
      period: { type: 'num', min: 1.5, max: 10, step: 0.1, unit: 's', label: L('一往復の長さ', 'Rock length'),
        auto: { range: [3.5, 6], follow: '-tempo' } },
    },
    make(env, cam, p) {
      return [cameraBehaviour(env, cam, rock, { angle: p.angle * DEG * strength(p), period: Math.max(0.1, p.period) })];
    },
  });

  return [slowPush, dollyOut, driftFloat, panSweep, parallaxOrbit, rollSway];
});
