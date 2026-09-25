/* 文字PVメーカー v2 — original work. The part kit: definition helpers, motion builders and helpers for part authors (DESIGN §4.18.3). */
MV.def('parts/kit', ['core/num', 'core/noise', 'core/ease', 'core/color', 'core/schema', 'core/registry', 'engine/scene/behave',
  'engine/scene/stagger', 'engine/scene/builder'],
(N, NZ, E, C, SCH, REG, BH, STG, B) => {
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
    lens: plainKind('lens'),
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
      if (m.curve[col]) curve[col] = E.reverse(m.curve[col]);
    }
    return BH.compileMoves({ unit: m.unit, tracks, curve, expose: m.expose });
  }

  // The entrance's shared overrides for the exit: dur and each carry over; the ease auto is reversed (In ↔ Out).
  function mirroredShared(shared) {
    const src = shared || {};
    const out = {};
    if (src.dur) out.dur = src.dur;
    if (src.each) out.each = src.each;
    const easeAuto = (src.ease && src.ease.auto) || REG.SHARED.arrive.ease.auto;
    out.ease = Object.assign({}, src.ease || {}, { auto: reversedAuto(easeAuto) });
    return out;
  }

  function reversedAuto(auto) {
    if ('value' in auto) return { value: E.reverse(auto.value) };
    if (Array.isArray(auto.pick)) {
      const pick = auto.pick.map((n) => E.reverse(n));
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

  return {
    arrange: KINDS.arrange, arrive: KINDS.arrive, dwell: KINDS.dwell, depart: KINDS.depart, ground: KINDS.ground,
    ornament: KINDS.ornament, lens: KINDS.lens, filter: KINDS.filter, seam: KINDS.seam, theme: KINDS.theme, mood: KINDS.mood,
    variant, mirror, moves, perGlyph, perGlyphHold,
    PH: BH.PH, ORDERS: SCH.ORDERS, EASES: E.EASES, ease, staggerOf: STG.staggerOf, pivots: STG.pivots,
    shape, math, color, pickOf, rangeOf, KitError,
  };
});
