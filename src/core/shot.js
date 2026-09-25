/* 文字PVメーカー v2 — original work. Camerawork values: shots aimed at the text, section rigs, presets and the AI move vocabulary (DESIGN_2_1 §2.4, §3.3, §4.5, §4.6). */
MV.def('core/shot', ['core/num', 'core/curve'], (N, CV) => {
  'use strict';

  // ShotRef := preset key | 'none' | Shot;   Shot := { keys: Key[2..6], follow?: 0..1 }
  // RigRef  := preset key | 'none' | Rig;    Rig  := { keys: [{ u, zoom?, x?, y?, roll?, curve? }] (2–4) }
  // Canonical form (coerceShot / coerceRig): q3 numbers, sorted keys, defaults omitted, deep-frozen. Numbers are
  // clamped into their ranges; values that cannot be read (unknown anchors or aims, a key without `at` or `aim`, fewer
  // than 2 keys, rig keys out of order) are dropped or give undefined. Shot keys keep their order in data; the scene
  // sorts them by time at build.

  const LIMITS = deepFreeze({
    keys: [2, 6], rigKeys: [2, 4],
    at: [0, 1], dt: [-2, 2], fill: [0.1, 1.2], zoom: [0.9, 1.25], px: [0, 1], py: [0, 1], ox: [-0.4, 0.4], oy: [-0.4, 0.4],
    roll: [-15, 15], follow: [0, 1],
    word: [-20, 40], beat: [0, 16], line: [0, 8], glyph: [0, 80],
    rig: { u: [0, 1], zoom: [0.95, 1.15], x: [-0.05, 0.05], y: [-0.05, 0.05], roll: [-4, 4] },
    frameZoom: [0.9, 3],                          // the camera zoom a key may reach (§4.5.4, §1.4 #17)
  });
  const DEFAULTS = Object.freeze({ dt: 0, fill: 0.6, zoom: 1, px: 0.5, py: 0.5, roll: 0 });
  const ANCHORS = Object.freeze(['a', 'rest', 'sung', 'mid', 'end', 'out', 'b', 'emph']);
  const TEXT_AIMS = Object.freeze(['block', 'emph', 'first', 'last', 'reading']);
  const PLACE_AIMS = Object.freeze(['frame', 'point']);
  const MOVES = Object.freeze(['drift', 'follow', 'panDown', 'panLeft', 'panRight', 'panUp', 'pullOut', 'punch', 'pushIn', 'tilt']);
  const FOCI = Object.freeze(['center', 'emphasis', 'first', 'last', 'text']);
  const TIMINGS = Object.freeze(['arrive', 'depart', 'hold', 'whole']);

  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  function q3(x) {
    const r = Math.round(x * 1000) / 1000;
    return r === 0 ? 0 : r;
  }
  function isFiniteNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clampTo(x, range) { return q3(N.clamp(x, range[0], range[1])); }

  // Keys in sorted order (canonical objects print the same everywhere, planner/encode's fast path).
  function sortedObject(o) {
    const out = {};
    for (const k of Object.keys(o).sort()) out[k] = o[k];
    return out;
  }

  // --- presets (FROZEN; §4.5.1 and §4.6 tables) --------------------------------------------------------------------

  const k = (at, aim, extra) => Object.assign({ at, aim }, extra || {});
  const SHOT_DATA = {
    settle: { tags: ['soft', 'slow', 'minimal'], keys: [k('a', 'block', { fill: 0.58 }), k('rest', 'block', { fill: 0.66 })] },
    pushWord: { tags: ['bold', 'serious'], keys: [k('a', 'block', { fill: 0.6 }), k('emph', 'emph', { dt: -0.1, fill: 0.82 }),
      k('b', 'emph', { fill: 0.88, curve: 'linear' })] },
    readAlong: { tags: ['literary', 'soft'], follow: 0.25, keys: [k('a', 'first', { fill: 0.75 }),
      k('sung', 'reading', { fill: 0.75 }), k('end', 'block', { fill: 0.6 })] },
    snapZoom: { tags: ['hard', 'bold', 'fast'], keys: [k('a', 'block', { fill: 0.55 }),
      k('sung', 'block', { dt: -0.06, fill: 0.55, curve: 'linear' }), k('sung', 'emph', { dt: 0.12, fill: 0.95, curve: 'dashStop' }),
      k('b', 'emph', { fill: 0.9, curve: 'fadeBrake' })] },
    pullReveal: { tags: ['airy', 'serious'], keys: [k('a', 'first', { fill: 0.95 }), k('rest', 'block', { fill: 0.6 })] },
    sweepAcross: { tags: ['fast', 'playful'], keys: [k('a', 'first', { fill: 0.8, ox: -0.12 }), k('out', 'last', { fill: 0.8, ox: 0.12 })] },
    tiltHold: { tags: ['playful', 'bold'], keys: [k('a', 'block', { fill: 0.64, roll: -4 }), k('b', 'block', { fill: 0.68, roll: -2 })] },
    driftOff: { tags: ['literary', 'airy', 'slow'], keys: [k('a', 'block', { fill: 0.5, ox: 0.18 }),
      k('b', 'block', { fill: 0.52, ox: 0.12, curve: 'linear' })] },
    wideHold: { tags: ['slow', 'airy', 'minimal'], keys: [k('a', 'frame', { zoom: 0.94 }), k('b', 'frame', { zoom: 0.98, curve: 'linear' })] },
  };
  const RIG_DATA = {
    slowSwell: { tags: ['slow', 'soft'], curve: 'softEnds', keys: [{ u: 0, zoom: 1 }, { u: 1, zoom: 1.08 }] },
    climbRise: { tags: ['bold'], curve: 'softEnds', keys: [{ u: 0, zoom: 1.02, y: 0.025 }, { u: 1, zoom: 1.06, y: -0.025 }] },
    pullAway: { tags: ['airy', 'slow'], curve: 'fadeBrake', keys: [{ u: 0, zoom: 1.1 }, { u: 1, zoom: 1 }] },
    leanTilt: { tags: ['playful'], curve: 'softEnds', keys: [{ u: 0, zoom: 1.02, roll: 0 }, { u: 1, zoom: 1.04, roll: 2.5 }] },
    driftSide: { tags: ['airy'], curve: 'linear', keys: [{ u: 0, zoom: 1.03, x: -0.02 }, { u: 1, zoom: 1.03, x: 0.02 }] },
  };

  // --- keys --------------------------------------------------------------------------------------------------------

  function aimKind(aim) {
    if (TEXT_AIMS.includes(aim)) return 'text';
    if (PLACE_AIMS.includes(aim)) return aim;
    return /^(word|line|glyph):/.test(aim) ? 'text' : null;
  }

  // 'word:<k>' | 'line:<k>' | 'glyph:<k>' | 'beat:<n>' with an integer clamped into its range; null otherwise.
  function indexed(v, names) {
    const m = /^([a-z]+):(-?[0-9]+)$/.exec(v);
    if (!m || !names.includes(m[1])) return null;
    return m[1] + ':' + N.clamp(Number(m[2]), LIMITS[m[1]][0], LIMITS[m[1]][1]);
  }

  function coerceAt(v) {
    if (isFiniteNumber(v)) return clampTo(v, LIMITS.at);
    if (typeof v !== 'string') return undefined;
    if (ANCHORS.includes(v)) return v;
    const x = indexed(v, ['word', 'beat']);
    return x === null ? undefined : x;
  }

  function coerceAim(v) {
    if (typeof v !== 'string') return undefined;
    if (TEXT_AIMS.includes(v) || PLACE_AIMS.includes(v)) return v;
    const x = indexed(v, ['word', 'line', 'glyph']);
    return x === null ? undefined : x;
  }

  // One key in canonical form, or undefined. Fields that do not apply to the aim are dropped; an unreadable curve is
  // dropped (the key then follows the cut's cam.curve).
  function coerceKey(v) {
    if (!isObject(v)) return undefined;
    const at = coerceAt(v.at), aim = coerceAim(v.aim);
    if (at === undefined || aim === undefined) return undefined;
    const kind = aimKind(aim);
    const out = { at, aim };
    const num = (name, range, applies) => {
      if (!applies || !isFiniteNumber(v[name])) return;
      const x = clampTo(v[name], range);
      if (DEFAULTS[name] === undefined || x !== DEFAULTS[name]) out[name] = x;
    };
    num('dt', LIMITS.dt, true);
    num('fill', LIMITS.fill, kind === 'text');
    num('zoom', LIMITS.zoom, kind !== 'text');
    num('px', LIMITS.px, kind === 'point');
    num('py', LIMITS.py, kind === 'point');
    num('ox', LIMITS.ox, true);                   // present even at 0: absent means "keep" (§4.5.4)
    num('oy', LIMITS.oy, true);
    num('roll', LIMITS.roll, true);
    if (v.curve !== undefined) {
      const c = CV.coerce(v.curve);
      if (c !== undefined) out.curve = c;
    }
    return sortedObject(out);
  }

  function coerceShotObject(v) {
    if (!isObject(v) || !Array.isArray(v.keys)) return undefined;
    const keys = [];
    for (const key of v.keys) {
      const c = coerceKey(key);
      if (c !== undefined) keys.push(c);
      if (keys.length === LIMITS.keys[1]) break;
    }
    if (keys.length < LIMITS.keys[0]) return undefined;
    const out = { keys };
    if (isFiniteNumber(v.follow)) {
      const f = clampTo(v.follow, LIMITS.follow);
      if (f !== 0) out.follow = f;
    }
    return deepFreeze(sortedObject(out));
  }

  function coerceShot(v) {
    if (typeof v === 'string') return v === 'none' || Object.prototype.hasOwnProperty.call(SHOT_DATA, v) ? v : undefined;
    return coerceShotObject(v);
  }

  function coerceRigKey(v) {
    if (!isObject(v) || !isFiniteNumber(v.u)) return undefined;
    const R = LIMITS.rig;
    const out = { u: clampTo(v.u, R.u) };
    for (const name of ['zoom', 'x', 'y', 'roll']) {
      if (!isFiniteNumber(v[name])) continue;
      const x = clampTo(v[name], R[name]);
      if (x !== (name === 'zoom' ? 1 : 0)) out[name] = x;
    }
    if (v.curve !== undefined) {
      const c = CV.coerce(v.curve);
      if (c !== undefined) out.curve = c;
    }
    return sortedObject(out);
  }

  function coerceRig(v) {
    if (typeof v === 'string') return v === 'none' || Object.prototype.hasOwnProperty.call(RIG_DATA, v) ? v : undefined;
    if (!isObject(v) || !Array.isArray(v.keys)) return undefined;
    const keys = [];
    for (const key of v.keys) {
      const c = coerceRigKey(key);
      if (c !== undefined) keys.push(c);
      if (keys.length === LIMITS.rigKeys[1]) break;
    }
    if (keys.length < LIMITS.rigKeys[0]) return undefined;
    for (let i = 1; i < keys.length; i++) if (keys[i].u < keys[i - 1].u) return undefined;
    return deepFreeze({ keys });
  }

  function isCustom(ref) { return isObject(ref); }

  // --- presets in canonical form -----------------------------------------------------------------------------------

  const SHOTS = deepFreeze(Object.fromEntries(Object.keys(SHOT_DATA).sort().map((key) => {
    const d = SHOT_DATA[key];
    const shot = coerceShotObject({ keys: d.keys, follow: d.follow });
    return [key, Object.assign({ tags: d.tags.slice() }, shot)];
  })));
  const SHOT_KEYS = Object.freeze(Object.keys(SHOTS));
  const RIGS = deepFreeze(Object.fromEntries(Object.keys(RIG_DATA).sort().map((key) => {
    const d = RIG_DATA[key];
    return [key, { tags: d.tags.slice(), curve: d.curve, keys: coerceRig({ keys: d.keys }).keys }];
  })));
  const RIG_KEYS = Object.freeze(Object.keys(RIGS));

  // The Shot (keys, follow) of a ShotRef; null for 'none' and unreadable values.
  function shotOf(ref) {
    const v = coerceShot(ref);
    if (v === undefined || v === 'none') return null;
    if (typeof v === 'string') return { keys: SHOTS[v].keys, follow: SHOTS[v].follow || 0 };
    return { keys: v.keys, follow: v.follow || 0 };
  }

  // --- expansion (scene build, §4.5) -------------------------------------------------------------------------------

  // expandShot(ref, { zoom, curve, carry, follow }) → Shot with every field of every key explicit, or null for 'none'.
  // Keys without a curve get `curve`; text aims: fill → clamp(fill·zoom, 0.1, 1.2); frame/point: zoom →
  // clamp(1 + (zoom_key − 1)·zoom, 0.9, 1.25). `carry` ({ fill, ox?, oy?, roll }) replaces the framing of key 0 when
  // key 0 is at 'a' and aims at the text; `follow` (not null) replaces the shot's follow.
  function expandShot(ref, opts) {
    const o = opts || {};
    const shot = shotOf(ref);
    if (!shot) return null;
    const zoom = isFiniteNumber(o.zoom) ? o.zoom : 1;
    const curveIn = o.curve === undefined ? 'softEnds' : o.curve;
    const curve = CV.coerce(curveIn) === undefined ? 'softEnds' : CV.coerce(curveIn);
    const keys = shot.keys.map((key) => {
      const kind = aimKind(key.aim);
      const out = { at: key.at, dt: key.dt || 0, aim: key.aim };
      if (kind === 'text') out.fill = clampTo((key.fill === undefined ? DEFAULTS.fill : key.fill) * zoom, LIMITS.fill);
      else out.zoom = clampTo(1 + ((key.zoom === undefined ? 1 : key.zoom) - 1) * zoom, LIMITS.zoom);
      if (kind === 'point') {
        out.px = key.px === undefined ? DEFAULTS.px : key.px;
        out.py = key.py === undefined ? DEFAULTS.py : key.py;
      }
      if (key.ox !== undefined) out.ox = key.ox;
      if (key.oy !== undefined) out.oy = key.oy;
      out.roll = key.roll || 0;
      out.curve = key.curve === undefined ? curve : key.curve;
      return out;
    });
    const carry = o.carry;
    if (isObject(carry) && keys[0].at === 'a' && aimKind(keys[0].aim) === 'text') {
      const k0 = keys[0];
      if (isFiniteNumber(carry.fill)) k0.fill = clampTo(carry.fill, LIMITS.fill);
      delete k0.ox;
      delete k0.oy;
      if (isFiniteNumber(carry.ox)) k0.ox = clampTo(carry.ox, LIMITS.ox);
      if (isFiniteNumber(carry.oy)) k0.oy = clampTo(carry.oy, LIMITS.oy);
      k0.roll = isFiniteNumber(carry.roll) ? clampTo(carry.roll, LIMITS.roll) : 0;
    }
    const follow = o.follow === null || o.follow === undefined ? shot.follow : o.follow;
    return deepFreeze({ keys, follow: clampTo(isFiniteNumber(follow) ? follow : 0, LIMITS.follow) });
  }

  // The symbolic framing of the shot's last key in data order (carry, §4.5.7): { fill, ox?, oy?, roll }, with the
  // closeness scaled like expandShot. null for 'none' and when the last key does not aim at the text.
  function lastFraming(ref, opts) {
    const shot = shotOf(ref);
    if (!shot) return null;
    const last = shot.keys[shot.keys.length - 1];
    if (aimKind(last.aim) !== 'text') return null;
    const zoom = opts && isFiniteNumber(opts.zoom) ? opts.zoom : 1;
    const out = { fill: clampTo((last.fill === undefined ? DEFAULTS.fill : last.fill) * zoom, LIMITS.fill) };
    if (last.ox !== undefined) out.ox = last.ox;
    if (last.oy !== undefined) out.oy = last.oy;
    out.roll = last.roll || 0;
    return deepFreeze(out);
  }

  // The largest text-aim fill of the shot (the planner's 'gentle' rule); 0 when it has no text aim or is 'none'.
  function maxFill(ref) {
    const shot = shotOf(ref);
    let best = 0;
    if (!shot) return best;
    for (const key of shot.keys) {
      if (aimKind(key.aim) === 'text') best = Math.max(best, key.fill === undefined ? DEFAULTS.fill : key.fill);
    }
    return best;
  }

  // expandRig(ref, { amp, curve }) → Rig with explicit keys { u, zoom, x, y, roll, curve }, or null for 'none'. amp
  // scales the deviations: zoom' = exp(amp·ln zoom), x' = amp·x, y' = amp·y, roll' = amp·roll. A key without a curve
  // takes `curve` when given, else the preset's curve, else 'linear'.
  function expandRig(ref, opts) {
    const o = opts || {};
    const v = coerceRig(ref);
    if (v === undefined || v === 'none') return null;
    const preset = typeof v === 'string' ? RIGS[v] : null;
    const keys = preset ? preset.keys : v.keys;
    const amp = isFiniteNumber(o.amp) ? o.amp : 1;
    const given = o.curve === null || o.curve === undefined ? undefined : CV.coerce(o.curve);
    const fallback = given !== undefined ? given : preset ? preset.curve : 'linear';
    return deepFreeze({
      keys: keys.map((key) => ({
        u: key.u,
        zoom: Math.exp(amp * Math.log(key.zoom === undefined ? 1 : key.zoom)),
        x: amp * (key.x || 0), y: amp * (key.y || 0), roll: amp * (key.roll || 0),
        curve: key.curve === undefined ? fallback : key.curve,
      })),
    });
  }

  // --- the AI's move vocabulary (§4.5.8, FROZEN table) -------------------------------------------------------------

  const TIMING_SPAN = Object.freeze({ whole: ['a', 'b'], arrive: ['a', 'rest'], hold: ['rest', 'out'], depart: ['out', 'b'] });
  const FOCUS_AIM = Object.freeze({ text: 'block', emphasis: 'emph', first: 'first', last: 'last', center: 'frame' });

  // fromMove({ move, focus, timing, fill }) → ShotRef (canonical) or undefined for an unknown move. An unknown focus
  // reads as 'text' and an unknown timing as 'whole'.
  function fromMove(m) {
    const o = isObject(m) ? m : {};
    if (!MOVES.includes(o.move)) return undefined;
    const [T0, T1] = TIMING_SPAN[TIMINGS.includes(o.timing) ? o.timing : 'whole'];
    const focus = FOCI.includes(o.focus) ? o.focus : 'text';
    const F = FOCUS_AIM[focus];
    const f1 = isFiniteNumber(o.fill) && o.fill >= 0 ? N.clamp(o.fill, 0.3, 1.1) : 0.75;
    const f0 = Math.max(0.3, f1 - 0.25);
    // A key aimed at F with closeness f: a fill for text aims, the zoom 1 + 0.25·(f − 0.3)/0.8 for the frame.
    const at = (when, aim, f, extra) => Object.assign({ at: when, aim },
      aim === 'frame' ? { zoom: 1 + 0.25 * (f - 0.3) / 0.8 } : { fill: f }, extra || {});
    let shot;
    switch (o.move) {
      case 'pushIn': shot = { keys: [at(T0, F, f0), at(T1, F, f1)] }; break;
      case 'pullOut': shot = { keys: [at(T0, F, f1), at(T1, F, f0)] }; break;
      case 'panLeft': shot = { keys: [at(T0, F, f1, { ox: -0.12 }), at(T1, F, f1, { ox: 0.12 })] }; break;
      case 'panRight': shot = { keys: [at(T0, F, f1, { ox: 0.12 }), at(T1, F, f1, { ox: -0.12 })] }; break;
      case 'panUp': shot = { keys: [at(T0, F, f1, { oy: -0.1 }), at(T1, F, f1, { oy: 0.1 })] }; break;
      case 'panDown': shot = { keys: [at(T0, F, f1, { oy: 0.1 }), at(T1, F, f1, { oy: -0.1 })] }; break;
      case 'tilt': shot = { keys: [at(T0, F, f1, { roll: -4 }), at(T1, F, f1, { roll: 4 })] }; break;
      case 'drift': shot = { keys: [at('a', F, f1, { ox: -0.06 }), at('b', F, f1, { ox: 0.06, curve: 'linear' })] }; break;
      case 'follow':
        shot = { follow: 0.25, keys: [at('a', 'first', f1), at('sung', 'reading', f1), at('end', 'block', f0)] };
        break;
      default: {                                   // punch
        const P = focus === 'emphasis' ? 'emph' : 'sung';
        shot = { keys: [at('a', 'block', f0), at(P, 'block', f0, { dt: -0.06, curve: 'linear' }),
          at(P, F, f1, { dt: 0.12, curve: 'dashStop' }), at('b', F, Math.max(0.3, f1 - 0.05))] };
      }
    }
    return coerceShot(shot);
  }

  function usesBeats(ref) {
    const shot = shotOf(ref);
    return !!shot && shot.keys.some((key) => typeof key.at === 'string' && key.at.startsWith('beat:'));
  }

  // [stringKey, params]: 'shot.<preset>', 'shot.none' (also for unreadable values), 'shot.custom' { n keys }.
  function label(ref) {
    const v = coerceShot(ref);
    if (v === undefined || v === 'none') return ['shot.none', {}];
    if (typeof v === 'string') return ['shot.' + v, {}];
    return ['shot.custom', { n: v.keys.length }];
  }

  function rigLabel(ref) {
    const v = coerceRig(ref);
    if (v === undefined || v === 'none') return ['rig.none', {}];
    if (typeof v === 'string') return ['rig.' + v, {}];
    return ['rig.custom', {}];
  }

  return {
    SHOTS, SHOT_KEYS, RIGS, RIG_KEYS, MOVES, FOCI, TIMINGS, LIMITS,
    coerceShot, coerceRig, isCustom, expandShot, lastFraming, maxFill, expandRig, fromMove, usesBeats, label, rigLabel,
  };
});
