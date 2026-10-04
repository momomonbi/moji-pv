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
  // EXTREME (DESIGN_EXTREME §1.1): the limits of an x-shot, next to LIMITS (which stays as it is). Every field of LIMITS
  // is here too (the keyframe editor reads either through limitsOf); `mods` holds the shot-level beat modulators.
  // (Phase F: the beat zoom up to 0.25 and the ground zoom up to 1.6, so 最大 is plainly stronger than the normal shots;
  // docs/NOTES.md "カメラ EXTREME".)
  const XLIMITS = deepFreeze(Object.assign(JSON.parse(JSON.stringify(LIMITS)), {
    fill: [0.1, 0.95], ox: [-0.6, 0.6], oy: [-0.6, 0.6], roll: [-360, 360],
    hit: [0, 1], gz: [1, 1.6], hop: [0, 0.35], whip: [0, 0.4], blur: [0, 1],
    mods: { zoom: [0, 0.25], roll: [0, 20], shake: [0, 1], every: [1, 2, 4] },
  }));
  const DEFAULTS = Object.freeze({ dt: 0, fill: 0.6, zoom: 1, px: 0.5, py: 0.5, roll: 0 });
  const ANCHORS = Object.freeze(['a', 'rest', 'sung', 'mid', 'end', 'out', 'b', 'emph']);
  const X_ANCHORS = Object.freeze(ANCHORS.concat(['accent', 'accentEnd']));
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
    // 追いかけて引く: each sung word in extreme close-up at the frame centre, followed as it is sung, then one quick pull
    // out to the whole line just before the cut ends. Chosen by hand only (PICK_ONLY).
    chaseReveal: { tags: ['bold', 'fast'], follow: 0.5, keys: [k('a', 'reading', { fill: 1.2, ox: 0, oy: 0 }),
      k('b', 'reading', { dt: -0.3, fill: 1.2, ox: 0, oy: 0 }), k('b', 'block', { dt: -0.12, fill: 0.55, curve: 'dashStop' }),
      k('b', 'block', { fill: 0.5, curve: 'linear' })] },
  };
  // Presets the planner never picks on its own (they come from a pin: the inspector, the AI or a look).
  const PICK_ONLY = Object.freeze(['chaseReveal']);
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

  // A ShotRef in canonical form, or undefined. EXTREME forms (an x-preset key with an optional "~m", an object with
  // x === 1) are read by their own grammar; every other value exactly as before.
  function coerceShot(v) {
    if (typeof v === 'string') {
      return v === 'none' || Object.prototype.hasOwnProperty.call(SHOT_DATA, v) || xKeyOf(v) !== null ? v : undefined;
    }
    if (isObject(v) && v.x === 1) return coerceXShotObject(v);
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

  // --- EXTREME shots (DESIGN_EXTREME §1.1–§1.2) ----------------------------------------------------------------------

  // XShot := { x: 1, keys: XKey[2..6], follow?, beat?: { zoom?, roll?, shake?, every? }, blur? }. An XKey is a Key with
  // the XLIMITS ranges, the anchors accent / accentEnd, and hit (every aim), gz (text and frame aims), hop and whip
  // (reading aims). Canonical like a Shot; defaults omitted: hit 0, gz 1, whip 0, beat.every 1, blur 1 (hop is kept at 0:
  // absent means the reading hop rule). Only objects with x === 1 are read this way; every other value is coerced
  // exactly as before.
  function coerceXAt(v) {
    if (typeof v === 'string' && X_ANCHORS.includes(v)) return v;
    return coerceAt(v);
  }

  function coerceXKey(v) {
    if (!isObject(v)) return undefined;
    const at = coerceXAt(v.at), aim = coerceAim(v.aim);
    if (at === undefined || aim === undefined) return undefined;
    const kind = aimKind(aim);
    const L = XLIMITS;
    const out = { at, aim };
    const num = (name, range, applies, dflt) => {
      if (!applies || !isFiniteNumber(v[name])) return;
      const x = clampTo(v[name], range);
      if (dflt === undefined || x !== dflt) out[name] = x;
    };
    num('dt', L.dt, true, DEFAULTS.dt);
    num('fill', L.fill, kind === 'text', DEFAULTS.fill);
    num('zoom', L.zoom, kind !== 'text', DEFAULTS.zoom);
    num('px', L.px, kind === 'point', DEFAULTS.px);
    num('py', L.py, kind === 'point', DEFAULTS.py);
    num('ox', L.ox, true);
    num('oy', L.oy, true);
    num('roll', L.roll, true, DEFAULTS.roll);
    num('hit', L.hit, true, 0);
    num('gz', L.gz, kind === 'text' || kind === 'frame', 1);
    num('hop', L.hop, aim === 'reading');
    num('whip', L.whip, aim === 'reading', 0);
    if (v.curve !== undefined) {
      const c = CV.coerce(v.curve);
      if (c !== undefined) out.curve = c;
    }
    return sortedObject(out);
  }

  // every ∈ {1, 2, 4}: a number reads as the nearest of them.
  function coerceEvery(v) {
    if (!isFiniteNumber(v)) return undefined;
    return v < 1.5 ? 1 : v < 3 ? 2 : 4;
  }

  function coerceBeat(v) {
    if (!isObject(v)) return undefined;
    const M = XLIMITS.mods;
    const out = {};
    for (const name of ['zoom', 'roll', 'shake']) {
      if (!isFiniteNumber(v[name])) continue;
      const x = clampTo(v[name], M[name]);
      if (x !== 0) out[name] = x;
    }
    const every = coerceEvery(v.every);
    if (every !== undefined && every !== 1) out.every = every;
    return Object.keys(out).length ? sortedObject(out) : undefined;
  }

  function coerceXShotObject(v) {
    if (!isObject(v) || v.x !== 1 || !Array.isArray(v.keys)) return undefined;
    const keys = [];
    for (const key of v.keys) {
      const c = coerceXKey(key);
      if (c !== undefined) keys.push(c);
      if (keys.length === XLIMITS.keys[1]) break;
    }
    if (keys.length < XLIMITS.keys[0]) return undefined;
    const out = { keys, x: 1 };
    if (isFiniteNumber(v.follow)) {
      const f = clampTo(v.follow, XLIMITS.follow);
      if (f !== 0) out.follow = f;
    }
    const beat = coerceBeat(v.beat);
    if (beat) out.beat = beat;
    if (isFiniteNumber(v.blur)) {
      const b = clampTo(v.blur, XLIMITS.blur);
      if (b !== 1) out.blur = b;
    }
    return deepFreeze(sortedObject(out));
  }

  // The twelve presets (§1.2 table, FROZEN once accepted; the values tuned by the phase F visual QA so each is plainly
  // stronger than the normal shots at 最大, docs/NOTES.md "カメラ EXTREME"). ⇆ = MIRRORS (a "~m" suffix flips ox and roll).
  // jumpRead's second reading key carries hop 0 too, so both reading keys cut from word to word (the table's intent).
  const XSHOT_DATA = {
    crashZoom: { tags: ['hard', 'fast', 'bold'], blur: 1, keys: [k('a', 'block', { fill: 0.46 }),
      k('accent', 'block', { dt: -0.04, fill: 0.46, curve: 'linear' }), k('accent', 'emph', { dt: 0.05, fill: 0.9, curve: 'dashStop', hit: 1 }),
      k('accentEnd', 'emph', { fill: 0.9, curve: 'linear' }), k('accentEnd', 'block', { dt: 0.12, fill: 0.66, curve: 'dashStop' }),
      k('b', 'block', { fill: 0.7, curve: 'linear' })] },
    punchHit: { tags: ['hard', 'fast'], blur: 0.8, keys: [k('a', 'block', { fill: 0.44 }),
      k('sung', 'block', { dt: -0.02, fill: 0.44, curve: 'linear' }), k('sung', 'block', { dt: 0.06, fill: 0.86, curve: 'dashStop', hit: 1 }),
      k('b', 'block', { fill: 0.72, curve: 'fadeBrake' })] },
    whipPan: { tags: ['fast', 'bold'], blur: 1, keys: [k('a', 'block', { fill: 0.64, ox: 0.5 }),
      k('a', 'block', { dt: 0.1, fill: 0.64, curve: 'dashStop' }), k('b', 'block', { dt: -0.37, fill: 0.64, curve: 'linear' }),
      k('b', 'block', { dt: -0.25, fill: 0.64, ox: -0.5, curve: 'slowBloom' })] },
    whipRead: { tags: ['fast', 'playful'], blur: 1, keys: [k('a', 'first', { fill: 0.8 }),
      k('sung', 'reading', { fill: 0.8, hop: 0.12, whip: 0.3 }), k('end', 'block', { dt: 0.02, fill: 0.62, curve: 'dashStop' })] },
    jumpRead: { tags: ['hard', 'digital'], blur: 0, keys: [k('a', 'block', { fill: 0.5 }),
      k('sung', 'block', { dt: -0.006, fill: 0.5, curve: 'linear' }), k('sung', 'reading', { fill: 0.85, hop: 0 }),
      k('end', 'reading', { dt: 0.002, fill: 0.85, hop: 0 }), k('end', 'block', { dt: 0.008, fill: 0.56 })] },
    spinIn: { tags: ['playful', 'bold'], blur: 1, keys: [k('a', 'block', { fill: 0.45, roll: -180 }),
      k('sung', 'block', { dt: 0.2, fill: 0.68, curve: 'dashStop', hit: 0.6 }), k('b', 'block', { fill: 0.7, curve: 'linear' })] },
    spinOut: { tags: ['playful'], blur: 1, keys: [k('a', 'block', { fill: 0.62 }),
      k('end', 'block', { dt: 0.02, fill: 0.66, curve: 'linear' }), k('b', 'block', { fill: 0.5, roll: 360, curve: 'slowBloom' })] },
    dutchSwing: { tags: ['bold', 'playful'], blur: 0.6, beat: { roll: 18, zoom: 0.08, every: 1 }, keys: [k('a', 'block', { fill: 0.66, roll: -14 }),
      k('b', 'block', { fill: 0.7, roll: 14, curve: 'linear' })] },
    shakeHits: { tags: ['hard', 'bold'], blur: 0.5, beat: { shake: 1, zoom: 0.06, every: 1 }, keys: [k('a', 'block', { fill: 0.66 }),
      k('b', 'block', { fill: 0.72, curve: 'linear' })] },
    beatCrash: { tags: ['fast', 'bold'], blur: 0.8, beat: { zoom: 0.2, every: 1 }, keys: [k('a', 'block', { fill: 0.58 }),
      k('b', 'block', { fill: 0.62, curve: 'linear' })] },
    vertigo: { tags: ['serious', 'slow'], blur: 0, keys: [k('a', 'block', { fill: 0.72, gz: 1 }),
      k('b', 'block', { fill: 0.56, gz: 1.6, curve: 'slowBloom' })] },
    orbit: { tags: ['airy', 'slow'], blur: 0.4, keys: [k('a', 'block', { fill: 0.58, roll: -24, ox: -0.16, oy: 0.04, gz: 1.2 }),
      k('mid', 'block', { fill: 0.66, ox: 0, oy: -0.04, gz: 1, curve: 'linear' }),
      k('b', 'block', { fill: 0.58, roll: 24, ox: 0.16, oy: 0.04, gz: 1.2, curve: 'linear' })] },
  };
  const MIRRORS = Object.freeze(['dutchSwing', 'orbit', 'spinIn', 'spinOut', 'whipPan']);
  const MIRROR_SUFFIX = '~m';

  // 'key' | 'key~m' of an x preset → { key, m } (m = true when mirrored); null for anything else.
  function xKeyOf(v) {
    if (typeof v !== 'string') return null;
    const m = v.endsWith(MIRROR_SUFFIX);
    const key = m ? v.slice(0, -MIRROR_SUFFIX.length) : v;
    return Object.prototype.hasOwnProperty.call(XSHOT_DATA, key) ? { key, m } : null;
  }

  // Keys with ox and roll negated (left ↔ right).
  function mirrorKeys(keys) {
    return keys.map((key) => {
      const out = Object.assign({}, key);
      if (out.ox !== undefined) out.ox = out.ox === 0 ? 0 : -out.ox;
      if (out.roll !== undefined) out.roll = -out.roll;
      return sortedObject(out);
    });
  }

  // --- presets in canonical form -----------------------------------------------------------------------------------

  const SHOTS = deepFreeze(Object.fromEntries(Object.keys(SHOT_DATA).sort().map((key) => {
    const d = SHOT_DATA[key];
    const shot = coerceShotObject({ keys: d.keys, follow: d.follow });
    return [key, Object.assign({ tags: d.tags.slice() }, shot)];
  })));
  const SHOT_KEYS = Object.freeze(Object.keys(SHOTS));
  const AUTO_SHOT_KEYS = Object.freeze(SHOT_KEYS.filter((key) => !PICK_ONLY.includes(key)));
  const RIGS = deepFreeze(Object.fromEntries(Object.keys(RIG_DATA).sort().map((key) => {
    const d = RIG_DATA[key];
    return [key, { tags: d.tags.slice(), curve: d.curve, keys: coerceRig({ keys: d.keys }).keys }];
  })));
  const RIG_KEYS = Object.freeze(Object.keys(RIGS));
  const XSHOTS = deepFreeze(Object.fromEntries(Object.keys(XSHOT_DATA).sort().map((key) => {
    const d = XSHOT_DATA[key];
    const shot = coerceXShotObject({ x: 1, keys: d.keys, beat: d.beat, blur: d.blur });
    return [key, Object.assign({ tags: d.tags.slice() }, shot)];
  })));
  const XSHOT_KEYS = Object.freeze(Object.keys(XSHOTS));

  // isExtreme(ref): an x-preset key (with an optional "~m") or a readable object with x: 1.
  function isExtreme(ref) {
    if (typeof ref === 'string') return xKeyOf(ref) !== null;
    return isObject(ref) && ref.x === 1 && coerceXShotObject(ref) !== undefined;
  }

  // presetOf(v) → the preset record a ShotRef names ({ tags, keys, … } as SHOTS / XSHOTS hold it; a mirrored x-preset
  // with its keys mirrored), or null for 'none', objects and unknown values.
  const XSHOTS_MIRRORED = deepFreeze(Object.fromEntries(XSHOT_KEYS.map((key) => [key,
    Object.assign({}, XSHOTS[key], { tags: XSHOTS[key].tags.slice(), keys: mirrorKeys(XSHOTS[key].keys) })])));
  function presetOf(v) {
    if (typeof v !== 'string') return null;
    if (Object.prototype.hasOwnProperty.call(SHOTS, v)) return SHOTS[v];
    const x = xKeyOf(v);
    if (!x) return null;
    return x.m ? XSHOTS_MIRRORED[x.key] : XSHOTS[x.key];
  }

  // limitsOf(shot) → XLIMITS for an EXTREME value, else LIMITS.
  function limitsOf(ref) { return isExtreme(ref) ? XLIMITS : LIMITS; }

  // The Shot (keys, follow) of a ShotRef; null for 'none' and unreadable values. (An x-shot's keys; a mirrored x-preset's
  // keys mirrored.)
  function shotOf(ref) {
    const v = coerceShot(ref);
    if (v === undefined || v === 'none') return null;
    if (typeof v === 'string') {
      const p = presetOf(v);
      return { keys: p.keys, follow: p.follow || 0 };
    }
    return { keys: v.keys, follow: v.follow || 0 };
  }

  // --- expansion (scene build, §4.5) -------------------------------------------------------------------------------

  // expandShot(ref, { zoom, curve, carry, follow }) → Shot with every field of every key explicit, or null for 'none'.
  // Keys without a curve get `curve`; text aims: fill → clamp(fill·zoom, 0.1, 1.2); frame/point: zoom →
  // clamp(1 + (zoom_key − 1)·zoom, 0.9, 1.25). `carry` ({ fill, ox?, oy?, roll }) replaces the framing of key 0 when
  // key 0 is at 'a' and aims at the text; `follow` (not null) replaces the shot's follow.
  function expandShot(ref, opts) {
    const o = opts || {};
    if (isExtreme(ref)) return expandX(ref, o);
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

  // xIntensity(extreme) → g, the EXTREME intensity (DESIGN_EXTREME §1.4): max(0.3, cam.extreme) for a number, 1 without
  // a decision (a hand-picked x-preset with the switch off).
  function xIntensity(extreme) {
    return isFiniteNumber(extreme) ? Math.max(0.3, N.clamp(extreme, 0, 1)) : 1;
  }

  // The intensity g also scales closeness and placement (phase F: 強め / かなり / 最大 then differ in every preset, not only
  // in its tilts, hits and beats): a text key's fill moves toward X_FILL_MID by g (the crash, the punch and the pull-back
  // are shallower at 強め), an offset within X_AWAY (it frames the words) is multiplied by g, and one beyond it (the
  // words leave the frame on purpose: a whip) keeps X_AWAY and scales its excess, so it still leaves the frame.
  const X_FILL_MID = 0.62;
  const X_AWAY = 0.25;
  function xOffset(v, g) {
    if (!isFiniteNumber(v)) return v;
    const a = Math.abs(v);
    return a > X_AWAY ? Math.sign(v) * (X_AWAY + (a - X_AWAY) * g) : v * g;
  }

  // The x branch of expandShot (DESIGN_EXTREME §1.4): { x: 1, keys, follow, beat: { zoom, roll, shake, every }, blur, g,
  // m } with every field of every key explicit (hop null = the reading hop rule). The mirror ("~m") is already in the
  // keys (m = −1 records it for the hits); roll, hit, gz − 1, whip and the beat amplitudes are multiplied by g; a text
  // key's fill is X_FILL_MID + (fill − X_FILL_MID)·g, times cam.zoom, clamped to XLIMITS; ox and oy scale by g as xOffset
  // says; timing is not scaled. `carry` is ignored.
  function expandX(ref, o) {
    const v = coerceShot(ref);
    const x = typeof v === 'string' ? xKeyOf(v) : null;
    const src = typeof v === 'string' ? presetOf(v) : v;
    const g = isFiniteNumber(o.g) ? N.clamp(o.g, 0, 1) : 1;
    const zoom = isFiniteNumber(o.zoom) ? o.zoom : 1;
    const curveIn = o.curve === undefined ? 'softEnds' : o.curve;
    const curve = CV.coerce(curveIn) === undefined ? 'softEnds' : CV.coerce(curveIn);
    const L = XLIMITS;
    const keys = src.keys.map((key) => {
      const kind = aimKind(key.aim);
      const out = { at: key.at, dt: key.dt || 0, aim: key.aim };
      if (kind === 'text') {
        const f = key.fill === undefined ? DEFAULTS.fill : key.fill;
        out.fill = clampTo((X_FILL_MID + (f - X_FILL_MID) * g) * zoom, L.fill);
      } else out.zoom = clampTo(1 + ((key.zoom === undefined ? 1 : key.zoom) - 1) * zoom, L.zoom);
      if (kind === 'point') {
        out.px = key.px === undefined ? DEFAULTS.px : key.px;
        out.py = key.py === undefined ? DEFAULTS.py : key.py;
      }
      if (key.ox !== undefined) out.ox = xOffset(key.ox, g);
      if (key.oy !== undefined) out.oy = xOffset(key.oy, g);
      out.roll = (key.roll || 0) * g;
      out.curve = key.curve === undefined ? curve : key.curve;
      out.hit = (key.hit || 0) * g;
      out.gz = 1 + ((key.gz === undefined ? 1 : key.gz) - 1) * g;
      out.hop = key.hop === undefined ? null : key.hop;
      out.whip = (key.whip || 0) * g;
      return out;
    });
    const b = src.beat || {};
    const follow = o.follow === null || o.follow === undefined ? src.follow || 0 : o.follow;
    return deepFreeze({ x: 1, keys, follow: clampTo(isFiniteNumber(follow) ? follow : 0, L.follow),
      beat: { zoom: (b.zoom || 0) * g, roll: (b.roll || 0) * g, shake: (b.shake || 0) * g, every: b.every || 1 },
      blur: src.blur === undefined ? 1 : src.blur, g, m: x && x.m ? -1 : 1 });
  }

  // The symbolic framing of the shot's last key in data order (carry, §4.5.7): { fill, ox?, oy?, roll }, with the
  // closeness scaled like expandShot. null for 'none' and when the last key does not aim at the text. null for EXTREME
  // values: the carry never reaches or leaves an EXTREME cut (DESIGN_EXTREME §1.4).
  function lastFraming(ref, opts) {
    if (isExtreme(ref)) return null;
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

  // --- the AI's EXTREME vocabulary (DESIGN_EXTREME §1.7, FROZEN table once accepted) ------------------------------------

  const XMOVES = Object.freeze(['crash', 'dutch', 'jump', 'orbit', 'pulse', 'shake', 'spin', 'vertigo', 'whip']);
  const DIRS = Object.freeze(['auto', 'left', 'right']);

  // fromXMove({ move, focus, timing, fill, power, dir }) → a canonical XShot (x: 1), or undefined for an unknown move.
  // fill as fromMove (f1, f0 = f1 − 0.25); power p ∈ [0.3, 1] (a negative or missing power reads 0.8); dir: 'left' = the
  // words travel left (the presets' own direction, as 'auto'), 'right' mirrors the keys. An unknown focus reads as
  // 'text', an unknown timing as 'whole'. The crash is word-anchored: emphasis → accent … accentEnd (the preset); text
  // and center → beat:0 … end; first → sung … word:1; last → word:−1 … end (a single word is never held while the
  // other words are sung, §3.1 R3).
  function fromXMove(m) {
    const o = isObject(m) ? m : {};
    if (!XMOVES.includes(o.move)) return undefined;
    const timing = TIMINGS.includes(o.timing) ? o.timing : 'whole';
    const focus = FOCI.includes(o.focus) ? o.focus : 'text';
    const F = FOCUS_AIM[focus];
    const f1 = isFiniteNumber(o.fill) && o.fill >= 0 ? N.clamp(o.fill, 0.3, 0.95) : 0.75;
    const f0 = Math.max(0.3, f1 - 0.25);
    const p = isFiniteNumber(o.power) && o.power >= 0 ? N.clamp(o.power, 0.3, 1) : 0.8;
    const mirror = o.dir === 'right';
    const at = (when, aim, f, extra) => Object.assign({ at: when, aim },
      aim === 'frame' ? { zoom: 1 + 0.25 * (f - 0.3) / 0.8 } : { fill: f }, extra || {});
    const up = (f, d) => Math.min(0.95, Math.max(0.3, f + d));
    let shot;
    switch (o.move) {
      case 'crash': {
        const [T1, T2] = focus === 'emphasis' ? ['accent', 'accentEnd'] : focus === 'first' ? ['sung', 'word:1']
          : focus === 'last' ? ['word:-1', 'end'] : ['beat:0', 'end'];
        shot = { blur: 1, keys: [at('a', 'block', 0.52), at(T1, 'block', 0.52, { dt: -0.04, curve: 'linear' }),
          at(T1, F, f1, { dt: 0.05, curve: 'dashStop', hit: 0.5 + 0.5 * p }), at(T2, F, f1, { curve: 'linear' }),
          at(T2, 'block', 0.66, { dt: 0.12, curve: 'dashStop' }), at('b', 'block', 0.7, { curve: 'linear' })] };
        break;
      }
      case 'whip': {
        if (timing === 'hold') {
          shot = { blur: 1, keys: [at('a', 'first', f1), at('sung', 'reading', f1, { hop: 0.12, whip: 0.15 + 0.25 * p }),
            at('end', 'block', up(f1, -0.18), { dt: 0.02, curve: 'dashStop' })] };
          break;
        }
        const ox = 0.3 + 0.3 * p;
        const keys = [];
        keys.push(at('a', F, f1, timing === 'depart' ? {} : { ox }));
        if (timing !== 'depart') keys.push(at('a', F, f1, { dt: 0.1, curve: 'dashStop' }));
        if (timing !== 'arrive') {
          keys.push(at('b', F, f1, { dt: -0.37, curve: 'linear' }), at('b', F, f1, { dt: -0.25, ox: -ox, curve: 'slowBloom' }));
        } else keys.push(at('b', F, f1, { curve: 'linear' }));
        shot = { blur: 1, keys };
        break;
      }
      case 'spin': {
        const rin = -(90 + 270 * p), rout = 360 * p;
        const keys = [];
        if (timing === 'depart') keys.push(at('a', F, f1));
        else keys.push(at('a', F, f0, { roll: rin }), at('sung', F, f1, { dt: 0.2, curve: 'dashStop', hit: 0.6 }));
        if (timing === 'arrive') keys.push(at('b', F, up(f1, 0.02), { curve: 'linear' }));
        else keys.push(at('end', F, f1, { dt: 0.02, curve: 'linear' }), at('b', F, f0, { roll: rout, curve: 'slowBloom' }));
        shot = { blur: 1, keys };
        break;
      }
      case 'dutch': {
        const r = 8 + 6 * p;
        shot = { blur: 0.6, beat: { roll: 10 + 8 * p, zoom: 0.03 + 0.05 * p, every: 1 }, keys: [at('a', F, f1, { roll: -r }),
          at('b', F, up(f1, 0.04), { roll: r, curve: 'linear' })] };
        break;
      }
      case 'shake':
        shot = { blur: 0.5, beat: { shake: p, zoom: 0.06, every: 1 }, keys: [at('a', F, f1), at('b', F, up(f1, 0.06), { curve: 'linear' })] };
        break;
      case 'vertigo':
        shot = { blur: 0, keys: [at('a', F, f1), at('b', F, f0, { gz: 1 + 0.6 * p, curve: 'slowBloom' })] };
        break;
      case 'orbit': {
        const r = 12 + 12 * p;
        shot = { blur: 0.4, keys: [at('a', F, up(f1, -0.06), { roll: -r, ox: -0.16, oy: 0.04, gz: 1.2 }),
          at('mid', F, f1, { ox: 0, oy: -0.04, curve: 'linear' }),
          at('b', F, up(f1, -0.06), { roll: r, ox: 0.16, oy: 0.04, gz: 1.2, curve: 'linear' })] };
        break;
      }
      case 'pulse':
        shot = { blur: 0.8, beat: { zoom: 0.08 + 0.14 * p, every: 1 }, keys: [at('a', F, f1), at('b', F, up(f1, 0.04), { curve: 'linear' })] };
        break;
      default: {                                   // jump
        const keys = [at('a', 'block', 0.55), at('sung', 'block', 0.55, { dt: -0.006, curve: 'linear' }),
          at('sung', 'reading', f1, { hop: 0 }), at('end', 'reading', f1, { dt: 0.002, hop: 0 })];
        if (timing !== 'depart') keys.push(at('end', 'block', 0.6, { dt: 0.008 }));
        shot = { blur: 0, keys };
      }
    }
    if (mirror) shot.keys = mirrorKeys(shot.keys);
    return coerceShot(Object.assign({ x: 1 }, shot));
  }

  // Whether the shot's times depend on the beat grid: beat:n anchors; every EXTREME value (accent falls back to the
  // first beat, and the beat modulators run on the grid).
  function usesBeats(ref) {
    if (isExtreme(ref)) return true;
    const shot = shotOf(ref);
    return !!shot && shot.keys.some((key) => typeof key.at === 'string' && key.at.startsWith('beat:'));
  }

  // [stringKey, params]: 'shot.<preset>' (an x-preset too, mirrored or not), 'shot.none' (also for unreadable values),
  // 'shot.custom' { n keys } (an x-shot object too).
  function label(ref) {
    const v = coerceShot(ref);
    if (v === undefined || v === 'none') return ['shot.none', {}];
    if (typeof v === 'string') { const x = xKeyOf(v); return ['shot.' + (x ? x.key : v), {}]; }
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
    // EXTREME (DESIGN_EXTREME §1)
    AUTO_SHOT_KEYS, XSHOTS, XSHOT_KEYS, XLIMITS, XMOVES, DIRS, MIRRORS, X_ANCHORS, X_AWAY, X_FILL_MID,
    isExtreme, xKeyOf, presetOf, limitsOf, fromXMove, xIntensity,
  };
});
