/* 文字PVメーカー v2 — original work. The part kit: definition helpers, motion builders and helpers for part authors (DESIGN §4.18.3; DESIGN_2_1 §3.11, §11.5.6). */
MV.def('parts/kit', ['core/num', 'core/noise', 'core/ease', 'core/curve', 'core/color', 'core/schema', 'core/registry',
  'core/media', 'engine/scene/behave', 'engine/scene/stagger', 'engine/scene/builder', 'engine/scene/shot', 'engine/scene/frame'],
(N, NZ, E, CV, C, SCH, REG, MEDIA, BH, STG, B, SHOT, F) => {
  'use strict';

  // Parts depend on this module only. The helpers stamp `kind`, fill defaults and check the essentials; they never
  // register anything (core/registry.createRegistry does, explicitly).

  class KitError extends Error {
    constructor(code, message) { super(message); this.name = 'KitError'; this.code = code; }
  }

  const REQUIRED = Object.freeze({
    arrange: 'build', arrive: 'make', dwell: 'make', depart: 'make', ground: 'build', ornament: 'build', lens: 'make',
    filter: 'apply', seam: 'mix',
  });
  const PART_KINDS = REG.PART_KINDS;

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

  // Freezes plain objects and arrays (not functions, not typed arrays).
  function deepFreeze(v) {
    if (!v || typeof v !== 'object' || ArrayBuffer.isView(v) || Object.isFrozen(v)) return v;
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
    return v;
  }

  function fail(kind, def, message) {
    const key = def && typeof def.key === 'string' ? def.key : '?';
    throw new KitError('bad-def', kind + '/' + key + ': ' + message);
  }

  // --- exposed track params (K.moves expose) --------------------------------------------------------------------

  const COLUMN_WORDS = Object.freeze({
    x: ['横の位置', 'X offset'], y: ['縦の位置', 'Y offset'], z: ['奥行き', 'Depth'], rot: ['回転', 'Rotation'],
    kx: ['横の傾き', 'Skew X'], ky: ['縦の傾き', 'Skew Y'], rx: ['縦の反転', 'Flip X'], ry: ['横の反転', 'Flip Y'],
    sx: ['横の大きさ', 'Scale X'], sy: ['縦の大きさ', 'Scale Y'], alpha: ['不透明度', 'Opacity'], reveal: ['見える割合', 'Reveal'],
    blur: ['ぼかし', 'Blur'], tint: ['色づき', 'Tint'], glow: ['光', 'Glow'], shard: ['割れ', 'Shatter'], echo: ['残像', 'Echo'],
    jx: ['横の揺れ', 'Jitter X'], jy: ['縦の揺れ', 'Jitter Y'], pixel: ['モザイク', 'Pixelate'],
  });
  const RANGE_EM = Object.freeze({ x: [-10, 10, 0.01], y: [-10, 10, 0.01], z: [-40, 40, 0.1], blur: [0, 2, 0.005],
    jx: [-4, 4, 0.01], jy: [-4, 4, 0.01], pixel: [0, 2, 0.01] });
  const RANGE_DU = Object.freeze({ x: [-3000, 3000, 1], y: [-3000, 3000, 1], z: [-1400, 4000, 1], blur: [0, 200, 0.5],
    jx: [-400, 400, 1], jy: [-400, 400, 1], pixel: [0, 200, 1] });
  const RANGE_ANGLE = Object.freeze({ rot: [-720, 720, 1], kx: [-80, 80, 1], ky: [-80, 80, 1], rx: [-360, 360, 1],
    ry: [-360, 360, 1] });
  const RANGE_UNIT = [0, 1, 0.01];
  const RANGE_SCALE = [0, 8, 0.01];
  const SPEC_UNIT = Object.freeze({ em: 'em', du: 'du', deg: 'deg', rad: '', x: 'x', '': '' });

  // Length columns are in em only when the track's unit is 'em' (x y z blur by default, BH.TRACK_UNITS); otherwise
  // they are plain du (jx jy pixel by default, or any length track with unit 'du').
  function rangeFor(col, unit) {
    if (RANGE_ANGLE[col]) return unit === 'rad' ? [-12.6, 12.6, 0.001] : RANGE_ANGLE[col];
    if (col === 'sx' || col === 'sy') return RANGE_SCALE;
    if (RANGE_EM[col]) return unit === 'em' ? RANGE_EM[col] : RANGE_DU[col];
    return RANGE_UNIT;
  }

  function specUnit(col, unit) {
    return RANGE_DU[col] && unit !== 'em' ? 'du' : SPEC_UNIT[unit] || '';
  }

  // The column's step, made finer (÷10 at a time) until the authored value lies on it, so coercion keeps the default.
  function stepFor(step, value) {
    let s = step;
    for (let k = 0; k < 6; k++) {
      const q = value / s;
      if (Math.abs(q - Math.round(q)) < 1e-6) return s;
      s /= 10;
    }
    return s;
  }

  function exposedSpec(col, value, unit, kind) {
    const [lo, hi, step] = rangeFor(col, unit);
    const words = COLUMN_WORDS[col];
    const end = kind === 'depart';
    return {
      type: 'num', min: Math.min(lo, value), max: Math.max(hi, value), step: stepFor(step, value), unit: specUnit(col, unit),
      label: { ja: (end ? '終わりの' : '始まりの') + words[0], en: (end ? 'End ' : 'Start ') + words[1].toLowerCase() },
      auto: { value }, ui: 'advanced',
    };
  }

  // The params a motion exposes for this kind: arrive 'yFrom' (the start value), depart 'yTo' (the end value).
  function exposedParams(motion, kind) {
    const out = {};
    for (const col of motion.expose) {
      const tr = motion.tracks[col];
      out[BH.exposedName(col, kind)] = exposedSpec(col, kind === 'depart' ? tr.to : tr.from, tr.unit, kind);
    }
    return out;
  }

  // The part's params with its exposed ones: each is the generated spec with the definition's own fields for that name
  // merged over it (a part or a K.variant may refine auto, label, range …), listed first. The other direction's names
  // (yTo on an entrance, yFrom on an exit) mean nothing for this kind and are dropped.
  function withExposed(params, motion, kind) {
    const own = Object.assign({}, params || {});
    const other = kind === 'depart' ? 'arrive' : 'depart';
    const out = {};
    for (const col of motion.expose) delete own[BH.exposedName(col, other)];
    const generated = exposedParams(motion, kind);
    for (const name of Object.keys(generated)) { out[name] = refineSpec(generated[name], own[name]); delete own[name]; }
    return Object.assign(out, own);
  }

  // generated + the author's fields; a number auto outside the range widens it unless the author set that bound
  // (a K.variant carries the base's generated bounds, which count as not set).
  function refineSpec(generated, own) {
    if (!isObject(own)) return generated;
    const spec = Object.assign({}, generated, own);
    const v = isObject(spec.auto) && typeof spec.auto.value === 'number' ? spec.auto.value : null;
    if (v === null) return spec;
    if (own.min === undefined || own.min === generated.min) spec.min = Math.min(spec.min, v);
    if (own.max === undefined || own.max === generated.max) spec.max = Math.max(spec.max, v);
    return spec;
  }

  // The fields of an exposed spec the author changed (compared with the generated spec), without the label.
  function refinedFields(generated, spec) {
    if (!isObject(spec)) return null;
    const out = {};
    for (const k of Object.keys(spec)) {
      if (k !== 'label' && JSON.stringify(spec[k]) !== JSON.stringify(generated[k])) out[k] = spec[k];
    }
    return Object.keys(out).length ? out : null;
  }

  // --- motion builders -------------------------------------------------------------------------------------------

  // moves({ unit, tracks, curve?, expose? }) → { unit, make, params, motion }. Spread it into K.arrive / K.depart:
  //   ...K.moves({ unit: 'glyph', tracks: { y: [0.55, 0], alpha: [0, 1] }, curve: { alpha: 'quadOut' }, expose: ['y'] })
  // Track values: x y z blur in em of the glyph (unit 'du' for design units); jx jy pixel in du (unit 'em' to follow
  // the glyph size); angles in degrees (unit 'rad' allowed); others plain. `curve` replaces the motion's ease for one
  // column (applied to the linear progress). Exposed params ('yFrom' / 'yTo') can be refined by writing the same name in
  // the part's own `params` (fields merge over the generated spec).
  function moves(spec) {
    const motion = BH.compileMoves(spec);
    const kind = motion.dir === 'depart' ? 'depart' : 'arrive';
    return { unit: motion.unit, make: BH.glyphMotionMaker(kind, { unit: motion.unit, motion }), params: exposedParams(motion, kind),
      motion };
  }

  // perGlyph(fn) → make. fn(P, g, k, u, p, fc) writes the pooled delta pose P of one glyph; k = eased progress,
  // u = linear progress (after the glyph's stagger delay). K.arrive / K.depart bind it to their timing.
  function perGlyph(fn) {
    if (typeof fn !== 'function') throw new KitError('bad-fn', 'K.perGlyph needs a function');
    const make = BH.glyphMotionMaker('arrive', { unit: 'glyph', fn });
    make.glyphFn = fn;
    return make;
  }

  // perGlyphHold(fn) → make for dwell parts. fn(P, g, time, w, p, fc): time = seconds since the glyph arrived;
  // w = the dwell envelope (multiply every amplitude by it).
  function perGlyphHold(fn) {
    if (typeof fn !== 'function') throw new KitError('bad-fn', 'K.perGlyphHold needs a function');
    const make = BH.holdMaker(fn);
    make.holdFn = fn;
    return make;
  }

  // --- kind helpers ----------------------------------------------------------------------------------------------

  function common(kind, def) {
    if (!isObject(def)) throw new KitError('bad-def', 'K.' + kind + ' needs a definition object');
    if (typeof def.key !== 'string' || def.key === '') fail(kind, def, 'key is required');
    if (!isObject(def.label)) fail(kind, def, 'label { ja, en } is required');
    const out = Object.assign({}, def, { kind });
    if (out.tags === undefined) out.tags = [];
    if (out.season === undefined) out.season = null;
    if (out.weight === undefined) out.weight = 1;
    if (out.pool === undefined) out.pool = true;
    if (out.fallback === undefined) out.fallback = false;
    if (out.needs === undefined) out.needs = [];
    if (PART_KINDS.includes(kind)) {
      if (out.shared === undefined) out.shared = {};
      if (out.params === undefined) out.params = {};
      const need = REQUIRED[kind];
      if (typeof out[need] !== 'function') fail(kind, def, need + '() is required');
    }
    return out;
  }

  function motionKind(kind) {
    return (def) => {
      const out = common(kind, def);
      if (out.motion) {
        if (!restsAt(out.motion, kind)) {
          fail(kind, def, kind === 'arrive' ? 'every moves track must END at identity' : 'every moves track must START at identity');
        }
        const unit = out.unit || out.motion.unit;
        out.params = withExposed(def.params, out.motion, kind);
        out.make = BH.glyphMotionMaker(kind, { unit, motion: out.motion });
        out.unit = unit;
      } else if (out.make.glyphFn) {
        const fn = out.make.glyphFn;
        out.make = BH.glyphMotionMaker(kind, { unit: out.unit || 'glyph', fn });
        out.make.glyphFn = fn;
      }
      if (out.unit !== undefined && !STG.UNITS.includes(out.unit)) fail(kind, def, 'unit must be one of ' + STG.UNITS.join(' '));
      return deepFreeze(out);
    };
  }

  // An entrance's tracks all END at identity; an exit's tracks all START there (the identity rule, §4.17.4).
  function restsAt(motion, kind) {
    return Object.keys(motion.tracks).every((col) => {
      const tr = motion.tracks[col];
      return (kind === 'depart' ? tr.from : tr.to) === BH.identityOf(col);
    });
  }

  function plainKind(kind, fill) {
    return (def) => {
      const out = common(kind, def);
      if (fill) fill(out);
      return deepFreeze(out);
    };
  }

  // The lens curve (DESIGN_2_1 §3.11): a lens whose `warp` is not false has its behaviours' clock warped by p.curve over
  // the cut's window [a, b] (periodic lenses slow down and speed up inside the cut; linear leaves them as authored).
  // The wrapper is made once per definition (a K.variant or a redefinition starts from the unwrapped make), never per
  // build; a lens with `warp: false` reads p.curve itself (the framing moves of parts/lens/glide).
  function warpedLens(make) {
    const wrapped = function make(env, cam, p) {
      const list = wrapped.unwarped(env, cam, p);
      if (!Array.isArray(list) || !p || CV.isLinear(p.curve)) return list;
      return list.map((b) => BH.warped(b, p.curve, env.times.a, env.times.b));
    };
    wrapped.unwarped = make;
    return wrapped;
  }

  function lensFill(d) {
    const raw = d.make.unwarped || d.make;
    d.make = d.warp === false ? raw : warpedLens(raw);
  }

  const KINDS = {
    arrange: plainKind('arrange'),
    arrive: motionKind('arrive'),
    dwell: plainKind('dwell'),
    depart: motionKind('depart'),
    ground: plainKind('ground', (d) => { if (d.animated === undefined) d.animated = true; }),
    ornament: plainKind('ornament', (d) => {
      if (d.scope === undefined) d.scope = 'cut';
      if (d.follow === undefined) d.follow = 'text';
    }),
    lens: plainKind('lens', lensFill),
    filter: plainKind('filter'),
    seam: plainKind('seam'),
    theme: plainKind('theme', (d) => { if (!isObject(d.swatch)) fail('theme', d, 'swatch is required'); }),
    mood: plainKind('mood', (d) => { if (!isObject(d.amounts)) fail('mood', d, 'amounts is required'); }),
  };

  // --- variant and mirror ------------------------------------------------------------------------------------------

  function mergePerField(base, patch) {
    const out = Object.assign({}, base || {});
    for (const name of Object.keys(patch || {})) {
      const v = patch[name];
      out[name] = isObject(v) && isObject(out[name]) ? Object.assign({}, out[name], v) : v;
    }
    return out;
  }

  // variant(base, patch) → a new definition of the same kind with the same functions: patch gives key, label, blurb,
  // tags (and anything else); patch.params / patch.shared merge per field. A variant is never the fallback unless
  // the patch says so. A patch.make replaces a K.moves base's motion (the kit rebuilds the make of any definition that
  // has one, which silently dropped the patch's make); the base's exposed params stay, for the new make to read.
  function variant(base, patch) {
    if (!isObject(base) || !KINDS[base.kind]) throw new KitError('bad-def', 'K.variant needs a kit definition');
    if (!isObject(patch) || typeof patch.key !== 'string') throw new KitError('bad-def', 'K.variant needs patch.key');
    const def = Object.assign({}, base, patch);
    delete def.kind;
    if (typeof patch.make === 'function' && patch.motion === undefined) delete def.motion;
    if (patch.fallback === undefined) def.fallback = false;
    if (base.params || patch.params) def.params = mergePerField(base.params, patch.params);
    if (base.shared || patch.shared) def.shared = mergePerField(base.shared, patch.shared);
    return KINDS[base.kind](def);
  }

  const MIRROR_SKIP = ['kind', 'key', 'label', 'blurb', 'fallback', 'make', 'motion', 'params', 'shared', 'unit'];

  // mirror(arriveDef, patch) → departDef, time-reversed: K.moves tracks swap ends (and their curves reverse);
  // K.perGlyph fns receive (1 − k, 1 − u); the ease auto is reversed. patch needs key, label and blurb.
  function mirror(arriveDef, patch) {
    if (!isObject(arriveDef) || arriveDef.kind !== 'arrive') throw new KitError('bad-def', 'K.mirror needs an arrive definition');
    if (!isObject(patch) || typeof patch.key !== 'string') throw new KitError('bad-def', 'K.mirror needs patch.key');
    const def = {};
    for (const k of Object.keys(arriveDef)) if (!MIRROR_SKIP.includes(k)) def[k] = arriveDef[k];
    def.shared = mirroredShared(arriveDef.shared);
    if (arriveDef.motion) {
      def.motion = mirroredMotion(arriveDef.motion);
      def.unit = arriveDef.unit;
      def.params = mirroredParams(arriveDef.params, arriveDef.motion);
      def.make = BH.glyphMotionMaker('depart', { unit: def.unit, motion: def.motion });
    } else if (arriveDef.make && arriveDef.make.glyphFn) {
      def.make = perGlyph(reversedFn(arriveDef.make.glyphFn));
      def.unit = arriveDef.unit;
      def.params = Object.assign({}, arriveDef.params || {});
    } else {
      throw new KitError('bad-def', 'arrive/' + arriveDef.key + ': K.mirror needs a K.moves or K.perGlyph entrance');
    }
    // the patch's params and shared merge over the mirrored ones (taken before the patch replaces them)
    const own = { params: def.params, shared: def.shared };
    const merged = Object.assign(def, patch);
    if (patch.params) merged.params = mergePerField(own.params, patch.params);
    if (patch.shared) merged.shared = mergePerField(own.shared, patch.shared);
    if (merged.unit === undefined) delete merged.unit;
    return KINDS.depart(merged);
  }

  // The entrance's params for its mirror: each exposed param moves to the exit's name (yFrom → yTo) with the fields the
  // entrance refined (auto, range …) but not its label, which names the start; the exit's label is generated.
  function mirroredParams(params, motion) {
    const own = Object.assign({}, params || {});
    const generated = exposedParams(motion, 'arrive');
    const out = {};
    for (const col of motion.expose) {
      const from = BH.exposedName(col, 'arrive'), to = BH.exposedName(col, 'depart');
      const refined = refinedFields(generated[from], own[from]);
      delete own[from]; delete own[to];
      if (refined) out[to] = refined;
    }
    return Object.assign(out, own);
  }

  // A time-reversed per-glyph function, made once per mirror() call (at part definition time, never per build).
  function reversedFn(fn) {
    return function mirrored(P, g, k, u, p, fc) { fn(P, g, 1 - k, 1 - u, p, fc); };
  }

  function mirroredMotion(m) {
    const tracks = {}, curve = {};
    for (const col of Object.keys(m.tracks)) {
      const tr = m.tracks[col];
      tracks[col] = { from: tr.to, to: tr.from, unit: tr.unit };
      if (m.curve[col]) curve[col] = CV.reverse(m.curve[col]);
    }
    return BH.compileMoves({ unit: m.unit, tracks, curve, expose: m.expose });
  }

  // The entrance's shared overrides for the exit: dur and each carry over; the ease auto is time-reversed (In ↔ Out,
  // presets and custom curves through CV.reverse), and so is a flow override.
  function mirroredShared(shared) {
    const src = shared || {};
    const out = {};
    if (src.dur) out.dur = src.dur;
    if (src.each) out.each = src.each;
    const easeAuto = (src.ease && src.ease.auto) || REG.SHARED.arrive.ease.auto;
    out.ease = Object.assign({}, src.ease || {}, { auto: reversedAuto(easeAuto) });
    if (src.flow) out.flow = Object.assign({}, src.flow, src.flow.auto ? { auto: reversedAuto(src.flow.auto) } : {});
    return out;
  }

  function reversedAuto(auto) {
    if ('value' in auto) return { value: CV.reverse(auto.value) };
    if (Array.isArray(auto.pick)) {
      const pick = auto.pick.map((n) => CV.reverse(n));
      return auto.weights ? { pick, weights: auto.weights.slice() } : { pick };
    }
    return auto;
  }

  // --- helpers -----------------------------------------------------------------------------------------------------

  const shape = Object.freeze({ rect: B.rect, ellipse: B.ellipse, line: B.line, poly: B.poly, arc: B.arc, path: B.path });
  const math = Object.freeze({ clamp: N.clamp, lerp: N.lerp, smooth: N.smooth, fract: N.fract, wrap: N.wrap, TAU: N.TAU,
    DEG: N.DEG, noise1: NZ.noise1, noise2: NZ.noise2 });
  // contrast (WCAG ratio), luminance and distance (OKLab) let parts check readability without a copy of their own
  const color = Object.freeze({ mix: C.mix, rgba: C.rgba, contrast: C.contrast, luminance: C.luminance, distance: C.distance,
    fitContrast: C.fitContrast });

  function pickOf(rng, array) { return rng.pick(array); }
  function rangeOf(rng, lo, hi) { return rng.range(lo, hi); }
  function ease(name) { return E.get(name); }

  // --- speed curves and framing (DESIGN_2_1 §3.11) -------------------------------------------------------------------

  // curve(value) → (u) => number: the position curve of any Curve (memoized; call it at build or definition time, never
  // per frame). warp(value) → (u) => [0, 1]: the same clamped, for time warps.
  function curve(value) { return CV.fn(value); }
  function warp(value) { return CV.warp(value); }

  // aimBox(env, aim) → Box | null: an aim of the text (block, emph, first, last, word:k, line:k, glyph:k, frame) as a
  // rest-world box, from the lens env's target.
  function aimBox(env, aim) { return SHOT.aimBox(env, env.target, aim); }

  // frameBox(env, box, fill, ox, oy) → { zoom, x, y }: the camera that makes `box` fill `fill` of the frame, with its
  // centre at (ox, oy) frame fractions from the frame centre (absent: kept where it is), inside the safe area and the
  // bleed (the shot framing math, §4.5.4).
  function frameBox(env, box, fill, ox, oy) {
    const f = SHOT.frame(env.D, box, { fill, ox, oy });
    return { zoom: f.Z, x: f.X, y: f.Y };
  }

  // --- photos and videos (DESIGN_2_1 §11.5.3, §11.5.6) ------------------------------------------------------------

  const MEDIA_KIT = deepFreeze({
    FITS: MEDIA.FITS.slice(), EDGES: MEDIA.EDGES.slice(), MOVES: MEDIA.MOVES.slice(), LOOPS: MEDIA.LOOPS.slice(),
    CLOCKS: MEDIA.CLOCKS.slice(), SHAPES: ['rect', 'round', 'circle', 'arch', 'free'], PLACES: ['behind', 'side', 'corner', 'free'],
    BLENDS: ['screen', 'multiply', 'overlay', 'normal'],
    DEPTHS: ['auto', 'anim', 'front', 'back', 'still'],      // §11.9.1 (additive)
  });
  const GROUND_BLEED = 0.15;           // a ground covers the frame plus this share on every side (§4.19.3)
  const KB_TRAVEL = 0.04;              // Ken Burns drift: this share of the short side over the window (v2 photoPan)
  const CAMERA_ROOM = 1.15;            // the still tier's allowance for the camera (§11.4.6)
  const KB = Object.freeze({ push: 0, pull: 1, drift: 2, auto: 3 });

  // Depth (§11.9.3, FROZEN): per effective value, the camera factor, and the numbers of the looks.
  const DEPTH_CAM = Object.freeze({ anim: 1, front: 1.15, back: 0.5, still: 0 });
  const BACK_ZOOM = 0.06;              // back: the Ken Burns zoom is capped here
  const BACK_BLUR = 3, BACK_VEIL = 0.15;     // back: the depth cue added to blur (du) and veil
  const FRONT_COVER = 0.4, FRONT_ALPHA = 0.45;   // front: a medium covering ≥ 40 % of the frame is capped at alpha 0.45
  const ANIM_FADE = 0.3;               // anim: frames and layers take the first / last 0.3 s of the cut's entrance / exit
  const ANIM_LONG = 2;                 // auto: an animation running this long counts as a video for a ground

  // The effective depth of a medium. A plan carries the planner's resolution (§11.9.2, never 'auto'); a hand-made or
  // older plan may still say 'auto', which resolves by the rules the engine can know (the text coverage rule of a
  // ground needs the planner). 'fill' has no depth: inside the text is its own place.
  function depthOf(p, use, meta) {
    if (use === 'fill') return 'anim';
    const d = MEDIA_KIT.DEPTHS.includes(p.depth) ? p.depth : 'auto';
    if (d !== 'auto') return d;
    if (use === 'layer') return 'front';
    if (use === 'ground' && (meta.kind === 'video' || (meta.anim === true && typeof meta.dur === 'number' && meta.dur >= ANIM_LONG))) {
      return 'back';
    }
    return 'anim';
  }

  // The layer of a medium at an effective depth: front above the text (near), back pushed back (far; grounds stay on
  // the ground layer), anim and still as placed (overlay footage: far).
  function depthLayer(depth, use, layer) {
    if (depth === 'front') return 'near';
    if (use === 'ground') return 'ground';
    if (depth === 'back' || use === 'layer') return 'far';
    return layer;
  }

  // anim: the medium fades with the cut's entrance and exit (the first 0.3 s of [a, rest], the last 0.3 s of [out, b]).
  function runDepthFade(P, t, b) {
    const fin = b.win > 0 ? N.smooth((t - b.a) / b.win) : 1, fout = b.wout > 0 ? N.smooth((b.b - t) / b.wout) : 1;
    P.alpha[b.from] *= fin < fout ? fin : fout;
  }

  // depthCam(cam, f) → the camera a medium at camera factor f sees (§11.9.3; = engine/scene/frame.depthCam).
  function depthCam(cam, f, out) { return F.depthCam(cam, f, out); }

  // runKenBurns(P, t, b): the media node's slow move over its window [w0, w0 + span], closed form in the scene-local t
  // with u = clamp((t − w0) / span): push scales 1 → 1 + zoom, pull 1 + zoom → 1, drift holds 1 + zoom/2 and travels
  // along the pan direction, auto is push plus the drift (v2 photoPan). The pivot is the box centre.
  function runKenBurns(P, t, b) {
    const u = b.span > 0 ? N.clamp((t - b.w0) / b.span) : 0;
    const s = b.mode === KB.pull ? 1 + b.zoom * (1 - u) : b.mode === KB.drift ? 1 + b.zoom / 2 : 1 + b.zoom * u;
    const i = b.from;
    P.px[i] = b.cx; P.py[i] = b.cy;
    P.sx[i] *= s; P.sy[i] *= s;
    P.x[i] += b.dx * u; P.y[i] += b.dy * u;
  }

  function mediaNum(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

  // media(env, { parent?, layer, owner?, src, box, p, use: 'ground' | 'frame' | 'fill' | 'layer', mask?, comp?, alpha?,
  //   window?: [w0, w1] }) → node | −1. p = the part's resolved media params (K.mediaParams). −1 when src is '' or not
  // in the plan's media (env.media). A ground (use 'ground') covers the frame (`box` defaults to it) by its edge rule:
  // mirror (fit to the frame, flipped copies in the bleed), zoom (fit to the bleed, plus the drift travel) or plain.
  // A move other than none installs runKenBurns ('auto': push and drift for stills, none for videos and animations).
  // use 'layer' draws only over the scene backdrop (sceneOnly); use 'fill' defaults to comp 'atop'. The time origin is
  // 0 in a ground scene and times.a in a cut.
  // Depth (p.depth, §11.9.3): anim as placed, camera factor 1, fading with the cut's entrance and exit (frames and
  // layers); front on the near layer at factor 1.15, and a medium covering ≥ 40 % of the frame capped at alpha 0.45 with
  // comp 'screen' (unless the part asks for another blend; a photo frame keeps its alpha); back on the far layer (grounds:
  // ground) at factor 0.5, Ken Burns zoom ≤ 0.06, blur + 3 du and veil + 0.15; still as placed, no camera, no Ken Burns,
  // outside the seam composite. The choice changes pixels only: the media times and mediaAt are the same.
  function media(env, o) {
    const q = o || {};
    const p = q.p || {};
    const src = q.src;
    const meta = typeof src === 'string' && src !== '' && env.media && Object.prototype.hasOwnProperty.call(env.media, src)
      ? env.media[src] : null;
    if (!meta) return -1;
    const D = env.D;
    const depth = depthOf(p, q.use, meta);
    const timed = meta.kind === 'video' || meta.anim === true;
    const chosen = MEDIA.MOVES.includes(p.move) ? p.move : 'auto';
    const move = depth === 'still' ? 'none' : chosen === 'auto' && timed ? 'none' : chosen;
    const kz0 = move === 'none' ? 0 : Math.max(0, mediaNum(p.zoom, 0));
    const kz = depth === 'back' ? Math.min(kz0, BACK_ZOOM) : kz0;
    const drifts = move === 'auto' || move === 'drift';
    const travel = drifts ? KB_TRAVEL * D.short : 0;
    let box = q.box || { x: 0, y: 0, w: D.w, h: D.h }, edge = 'plain', bleed = 0;
    if (q.use === 'ground') {
      edge = MEDIA.EDGES.includes(p.edge) ? p.edge : 'mirror';
      if (edge === 'zoom') {
        const bx = GROUND_BLEED * D.w + travel, by = GROUND_BLEED * D.h + travel;
        box = { x: box.x - bx, y: box.y - by, w: box.w + 2 * bx, h: box.h + 2 * by };
      }
      bleed = edge === 'mirror' ? GROUND_BLEED : 0;
    }
    const R0 = MEDIA.LIMITS.params;
    const fit = MEDIA.FITS.includes(p.fit) ? p.fit : 'cover';
    const crop = { zoom: Math.max(1, mediaNum(p.cropZoom, 1)), x: N.clamp(mediaNum(p.cropX, 0.5)), y: N.clamp(mediaNum(p.cropY, 0.5)) };
    const back = depth === 'back';
    const veilA = N.clamp(mediaNum(p.veil, 0) + (back ? BACK_VEIL : 0), 0, R0.veil[1]);
    const blur = N.clamp(mediaNum(p.blur, 0) + (back ? BACK_BLUR : 0), 0, R0.blur[1]);
    const veil = veilA > 0 ? { ink: typeof p.veilInk === 'string' && p.veilInk ? p.veilInk : 'ground', a: veilA } : null;
    const tint = mediaNum(p.tint, 0) > 0 ? { ink: typeof p.tintInk === 'string' && p.tintInk ? p.tintInk : 'accent', a: N.clamp(p.tint) } : null;
    let alpha = mediaNum(q.alpha, 1);
    let comp = q.comp || (q.use === 'fill' ? 'atop' : 'over');
    if (depth === 'front' && q.use !== 'frame') {
      const r = MEDIA.fitRect(meta, box, fit, crop.zoom, crop.x, crop.y);
      if ((r.dw * r.dh) / (D.w * D.h) >= FRONT_COVER) {        // the readability guard
        alpha = Math.min(alpha, FRONT_ALPHA);
        if (comp === 'over') comp = 'screen';
      }
    }
    const node = env.sb.media({
      parent: q.parent, layer: depthLayer(depth, q.use, q.layer), owner: q.owner, alpha, src, box,
      fit, crop, edge, bleed, mask: q.mask || null, comp, blur, veil, tint,
      time: MEDIA.timeSpec(meta, p, env.cut ? env.times.a : 0), headroom: crop.zoom * (1 + kz) * CAMERA_ROOM,
      sceneOnly: q.use === 'layer', cam: DEPTH_CAM[depth], still: depth === 'still',
    });
    if (depth === 'anim' && env.cut && (q.use === 'frame' || q.use === 'layer')) {
      const tm = env.times;
      env.sb.behave({ phase: BH.PH.ORNAMENT, live: 'always', from: node, to: node + 1, t0: tm.a, t1: tm.b, run: runDepthFade,
        a: tm.a, b: tm.b, win: Math.min(ANIM_FADE, Math.max(0, tm.rest - tm.a)), wout: Math.min(ANIM_FADE, Math.max(0, tm.b - tm.out)) });
    }
    if (move !== 'none' && (kz > 0 || travel > 0)) {
      const w = Array.isArray(q.window) ? q.window : env.cut ? [env.times.a, env.times.b] : [0, env.times.b];
      const a = mediaNum(p.pan, 0) * N.DEG;
      env.sb.behave({ phase: BH.PH.ORNAMENT, live: 'always', from: node, to: node + 1, t0: w[0], t1: w[1], run: runKenBurns,
        w0: w[0], span: w[1] - w[0], mode: KB[move], zoom: kz, cx: box.x + box.w / 2, cy: box.y + box.h / 2,
        dx: Math.cos(a) * travel, dy: Math.sin(a) * travel });
    }
    return node;
  }

  const L2 = (ja, en) => ({ ja, en });

  // mediaParams({ src = 'src', accept = 'any', use, only?, autos? }) → { [name]: ParamSpec }: the media params of the
  // §11.5.6 table in its order, with `depth` (§11.9.1) right after the source for use ground, frame and layer. Every
  // one is ai: false except depth; `edge` is for grounds only. `src` renames the source param (photoPan: 'image');
  // `only` keeps the listed names (the source is always kept); `autos` replaces the auto of a param by name.
  function mediaParams(o) {
    const q = o || {};
    const R0 = MEDIA.LIMITS.params;
    const num = (range, unit, label, auto, ui) => Object.assign({ type: 'num', min: range[0], max: range[1], step: range[2] },
      unit ? { unit } : {}, { label, auto }, ui ? { ui } : {});
    const all = {
      [q.src || 'src']: { type: 'media', accept: ['image', 'video', 'any'].includes(q.accept) ? q.accept : 'any',
        label: L2('写真・動画', 'Photo or video'), auto: { value: '' } },
      depth: { type: 'enum', of: MEDIA_KIT.DEPTHS.slice(), optKey: 'depth', label: L2('動きと重なり', 'Motion and layering'), auto: { value: 'auto' } },
      fit: { type: 'enum', of: MEDIA.FITS.slice(), label: L2('収め方', 'Fit'), auto: { value: 'cover' } },
      cropZoom: num(R0.cropZoom, 'x', L2('拡大', 'Zoom'), { value: 1 }),
      cropX: num(R0.cropX, 'frac', L2('中心 横', 'Focus X'), { value: 0.5 }, 'advanced'),
      cropY: num(R0.cropY, 'frac', L2('中心 縦', 'Focus Y'), { value: 0.5 }, 'advanced'),
      edge: { type: 'enum', of: MEDIA.EDGES.slice(), label: L2('端の処理', 'Edges'), auto: { value: 'mirror' }, ui: 'advanced' },
      move: { type: 'enum', of: MEDIA.MOVES.slice(), label: L2('動き', 'Motion'), auto: { value: 'auto' } },
      zoom: num(R0.zoom, 'x', L2('動きの強さ', 'Motion amount'), { range: [0.06, 0.14] }),
      pan: num(R0.pan, 'deg', L2('動く向き', 'Direction'), { range: [-180, 180] }),
      blur: num(R0.blur, 'du', L2('ぼかし', 'Blur'), { value: 0 }),
      veil: num(R0.veil, '', L2('薄幕', 'Veil'), { value: 0 }),
      veilInk: { type: 'ink', label: L2('薄幕の色', 'Veil color'), auto: { value: 'ground' } },
      tint: num(R0.tint, '', L2('色味', 'Tint'), { value: 0 }, 'advanced'),
      tintInk: { type: 'ink', label: L2('色味の色', 'Tint color'), auto: { value: 'accent' }, ui: 'advanced' },
      clipIn: num(R0.clipIn, 's', L2('使う範囲（始め）', 'Start at'), { value: 0 }),
      clipOut: num(R0.clipOut, 's', L2('使う範囲（終わり）', 'End at'), { value: 0 }),
      speed: num(R0.speed, 'x', L2('速さ', 'Speed'), { value: 1 }),
      loop: { type: 'enum', of: MEDIA.LOOPS.slice(), label: L2('終わったら', 'At the end'), auto: { value: 'loop' } },
      clock: { type: 'enum', of: MEDIA.CLOCKS.slice(), label: L2('時間の基準', 'Clock'), auto: { value: 'show' }, ui: 'advanced' },
    };
    const out = {};
    const keep = Array.isArray(q.only) ? q.only : null;
    for (const name of Object.keys(all)) {
      if (name === 'edge' && q.use !== 'ground') continue;
      if (name === 'depth' && !['ground', 'frame', 'layer'].includes(q.use)) continue;
      if (keep && name !== (q.src || 'src') && !keep.includes(name)) continue;
      const spec = Object.assign({}, all[name], { ai: name === 'depth' });
      if (q.autos && q.autos[name]) spec.auto = q.autos[name];
      out[name] = spec;
    }
    return out;
  }

  return {
    arrange: KINDS.arrange, arrive: KINDS.arrive, dwell: KINDS.dwell, depart: KINDS.depart, ground: KINDS.ground,
    ornament: KINDS.ornament, lens: KINDS.lens, filter: KINDS.filter, seam: KINDS.seam, theme: KINDS.theme, mood: KINDS.mood,
    variant, mirror, moves, perGlyph, perGlyphHold,
    PH: BH.PH, ORDERS: SCH.ORDERS, EASES: E.EASES, ease, staggerOf: STG.staggerOf, pivots: STG.pivots,
    shape, math, color, pickOf, rangeOf, KitError,
    curve, warp, CURVES: CV.PRESET_KEYS, warped: BH.warped, aimBox, frameBox,
    media, mediaParams, MEDIA: MEDIA_KIT, runKenBurns, depthCam,
  };
});
