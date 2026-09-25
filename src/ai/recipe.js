/* 文字PVメーカー v2 — original work. AI materials: the flat answer schema, answer → material entry (and back), the standalone material tool (DESIGN_2_1 §5.10, §5.11, §11.5.8). */
MV.def('ai/recipe', ['core/num', 'core/hash', 'core/color', 'core/curve', 'core/schema', 'core/registry', 'core/recipe',
  'core/media', 'core/paths', 'planner/plan', 'ai/catalog', 'ai/changes', 'i18n/strings'],
  (N, H, C, CV, S, REG, RC, MEDIA, P, PL, CAT, CH, STRINGS) => {
    'use strict';

    // The AI never writes a recipe directly: it answers a flat, closed form (AI_MATERIAL) that fromAi turns into a
    // MaterialEntry through core/recipe.normalize, then fixes to fit the budgets (fewer items, calmer blinking). The
    // result is data only: shapes from the fixed library, allow-listed glyphs, wave names and numbers (§5.12).

    // ---- schema pieces (objects closed, every property required, no numeric or string limits) -----------------------

    const STR = Object.freeze({ type: 'string' }), NUM = Object.freeze({ type: 'number' });
    const INT = Object.freeze({ type: 'integer' }), BOOL = Object.freeze({ type: 'boolean' });
    const STRS = { type: 'array', items: STR }, INTS = { type: 'array', items: INT };
    const closed = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
    const arr = (items) => ({ type: 'array', items });
    const en = (list) => ({ type: 'string', enum: list.slice() });

    const SEASON_VALUES = Object.freeze(['', 'any', 'none', 'spring', 'summer', 'autumn', 'winter']);
    const USE_SLOTS = Object.freeze(['none', 'atmos', 'ornament', 'ground', 'arrange', 'arrive', 'depart', 'dwell', 'lens',
      'filter', 'seam']);
    const OSC_COLS = Object.freeze([...new Set(RC.OSC_COLS_DWELL.concat(RC.OSC_COLS_LENS))]);
    const AI_WAVES = Object.freeze(['sine', 'tri', 'noise', 'beat']);

    const CURVE_AI = deepFreeze(closed({ name: STR, ends: en(CV.RAMP_ENDS), edge: NUM, peak: NUM }));
    const SEASON_AI = deepFreeze(en(SEASON_VALUES));
    const AI_PARAM = closed({ name: STR, value: STR });
    const AI_PART = closed({ key: STR, params: arr(AI_PARAM) });

    function layerSchema(media) {
      return closed(Object.assign({
        prim: en(media ? RC.PRIMS : RC.PRIMS.filter((p) => p !== 'media')), shape: en([''].concat(RC.SHAPES)), glyph: STR,
        inks: STRS, alpha: NUM, layer: en(['far', 'mid', 'near', 'ground']), anchor: en(RC.ANCHORS), x: NUM, y: NUM,
        spread: NUM, sizeMin: NUM, sizeMax: NUM, count: INT, stroke: NUM, dir: NUM, speed: NUM, sway: NUM, swayHz: NUM,
        spin: NUM, burst: en(RC.BURSTS), move: en(['none'].concat(RC.WAVES)), moveWhat: en(RC.MOVE_WHAT), moveAmp: NUM,
        moveHz: NUM, appear: en(['always'].concat(RC.APPEAR_AT)), draw: en(RC.DRAWS), style: en([''].concat(RC.FRAME_STYLES)),
        pattern: en([''].concat(RC.PATTERNS)), stops: STRS, angle: NUM,
      }, media ? { media: STR } : {}));
    }

    function materialSchemaOf(media) {
      return closed({
        name: STR, nameEn: STR, kind: en(RC.MAT_KINDS), scope: en(['cut', 'run']), season: SEASON_AI, tags: STRS, blurb: STR,
        base: STR, params: arr(AI_PARAM), parts: arr(AI_PART), layers: arr(layerSchema(media)), unit: en(RC.UNITS),
        order: en(S.ORDERS), dur: NUM, each: NUM, tracks: arr(closed({ col: en(RC.MOTION_COLS), from: NUM, to: NUM })),
        curve: CURVE_AI, osc: arr(closed({ col: en(OSC_COLS), amp: NUM, hz: NUM, wave: en(AI_WAVES), phase: en(RC.PHASES.concat(['word'])) })),
        knobs: STRS,
        use: closed({ slot: en(USE_SLOTS), s: INT /* brief; −1 = every brief */, lines: INTS /* [] = all area lines */,
          cuts: arr(closed({ i: INT, j: INT })) }),
      });
    }

    // AI_MATERIAL is the §5.10 form; with the user's media offered (§11.5.8) the layers also take `media` and the prim
    // 'media'. Both are built once and deep-frozen.
    const AI_MATERIAL = deepFreeze(materialSchemaOf(false));
    const AI_MATERIAL_MEDIA = deepFreeze(materialSchemaOf(true));
    const MATERIAL_SCHEMA = deepFreeze(closed({ understood: BOOL, question: STR, material: AI_MATERIAL }));
    const MATERIAL_SCHEMA_MEDIA = deepFreeze(closed({ understood: BOOL, question: STR, material: AI_MATERIAL_MEDIA }));

    function deepFreeze(v) {
      if (v && typeof v === 'object' && !Object.isFrozen(v)) {
        Object.freeze(v);
        for (const k of Object.keys(v)) deepFreeze(v[k]);
      }
      return v;
    }

    function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
    function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
    function list(v) { return Array.isArray(v) ? v : []; }
    function str(v) { return typeof v === 'string' ? v.trim() : ''; }
    function num(v, def) { return isNumber(v) ? v : def; }
    function q6(x) { const r = N.q6(x); return r === 0 ? 0 : r; }

    // ---- curves (shared with ai/direct, §5.4) -------------------------------------------------------------------------

    // Names of the "sections" proposal (§1.4 #1) read as the curves they became.
    const CURVE_ALIASES = Object.freeze({ easeIn: 'cubicIn', easeOut: 'cubicOut', easeInOut: 'cubicInOut', hold: 'holdThenDash',
      snap: 'dashStop' });
    const RAMP_DEFAULT = Object.freeze({ edge: 0.1, peak: 4 });

    // curveFromAi(CURVE_AI value) → a canonical Curve, undefined (name '' = keep) or null (unreadable). 'ramp' reads
    // ends / edge / peak (clamped; a missing number takes the default); slowFastSlow and fastSlowFast are ramps with both
    // slow ends (a peak above or below 1).
    function curveFromAi(x) {
      if (typeof x === 'string') return curveFromAi({ name: x });
      if (!isObject(x)) return null;
      const name = str(x.name);
      if (name === '') return undefined;
      if (name === 'ramp' || name === 'slowFastSlow' || name === 'fastSlowFast') {
        const ends = name === 'ramp' && CV.RAMP_ENDS.includes(x.ends) ? x.ends : 'both';
        const edge = isNumber(x.edge) && x.edge >= 0 ? x.edge : RAMP_DEFAULT.edge;
        let peak = isNumber(x.peak) && x.peak > 0 ? x.peak : RAMP_DEFAULT.peak;
        if (name === 'slowFastSlow' && peak < 1) peak = 1 / peak;
        if (name === 'fastSlowFast' && peak > 1) peak = 1 / peak;
        return CV.coerce({ ramp: { edge, ends, peak } }) || null;
      }
      const c = CV.coerce(CURVE_ALIASES[name] || name);
      return c === undefined ? null : c;
    }

    // A Curve back in the flat form (toAi): names and ramps; Béziers and speed steps (UI-only forms) read as ''.
    function curveToAi(c) {
      const v = CV.coerce(c);
      if (typeof v === 'string') return { name: v, ends: 'both', edge: -1, peak: -1 };
      if (v && v.ramp) return { name: 'ramp', ends: v.ramp.ends, edge: v.ramp.edge, peak: v.ramp.peak };
      return { name: '', ends: 'both', edge: -1, peak: -1 };
    }

    // ---- answer → entry ---------------------------------------------------------------------------------------------

    const APPEAR_DUR = 0.5;
    const SPIN_PRIMS = Object.freeze(['particles', 'glyphs']);
    const MEDIA_SHAPE = Object.freeze({ rect: 'rect', roundRect: 'round', ellipse: 'circle', ring: 'circle', dot: 'circle', arc: 'arch' });
    const MEDIA_SHAPE_BACK = Object.freeze({ rect: 'rect', round: 'roundRect', circle: 'ellipse', arch: 'arc', free: '' });
    const BORDER_PER_STROKE = 1000;                    // a media layer's border (du) from the flat form's stroke
    const OSC_STEP = 0.3;                              // phase offset per unit for 'index' and 'word' oscillators
    const SCALE_STEP = 0.9, SCALE_TRIES = 40;
    const BUDGET_CODES = Object.freeze(['cost', 'particles', 'nodes', 'shapes', 'filter-cost', 'filter-passes', 'too-big',
      'media-count', 'media-video']);
    const UNTITLED = STRINGS['mat.untitled'];

    function cleanText(v, max) {
      if (typeof v !== 'string') return '';
      const s = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
      return Array.from(s).slice(0, max).join('');
    }

    // The request's [media] list as a map n → asset (the AI names assets only as 'asset:<n>').
    function assetOf(mediaList, ref) {
      const m = /^asset:([0-9]+)$/.exec(str(ref));
      if (!m) return null;
      const n = Number(m[1]);
      return list(mediaList).find((x) => x && x.n === n) || null;
    }

    // A param value written as text → a typed value through the part's spec (numbers, booleans, enums, curves as a
    // name or JSON, inks); undefined when it does not fit. Media params are never set this way (§11.2.3).
    function paramValue(spec, text) {
      if (!spec || spec.type === 'media') return undefined;
      const s = typeof text === 'string' ? text.trim() : String(text);
      let v = s;
      if (spec.type === 'num' || spec.type === 'int') v = s === '' ? NaN : Number(s);
      else if (spec.type === 'bool') { if (s !== 'true' && s !== 'false') return undefined; v = s === 'true'; }
      else if (spec.type === 'curve' || spec.type === 'shot' || spec.type === 'rig') {
        if (s.startsWith('{')) { try { v = JSON.parse(s); } catch (e) { return undefined; } }
      }
      try { return S.coerce(spec, v); } catch (e) { return undefined; }
    }

    function paramsOf(items, specs) {
      const out = {};
      for (const p of list(items)) {
        if (!isObject(p)) continue;
        const name = str(p.name);
        const spec = specs && Object.prototype.hasOwnProperty.call(specs, name) ? specs[name] : null;
        const v = spec && spec.ai !== false ? paramValue(spec, p.value) : undefined;
        if (v !== undefined) out[name] = v;
      }
      return out;
    }

    // Existing parts of the base registry: never a material, never a flash-gated effect.
    function basePart(base, kind, key) {
      const def = typeof key === 'string' && key ? base.get(kind, key) : null;
      if (!def || def.gate === 'flash' || key.startsWith('myMat') || key.startsWith('myMed')) return null;
      return def;
    }

    function partsOf(ai, kind, base, scope) {
      const out = [];
      for (const p of list(ai.parts)) {
        const def = isObject(p) ? basePart(base, kind, str(p.key)) : null;
        if (!def || (kind === 'ornament' && (def.scope || 'cut') !== scope)) continue;
        out.push({ key: def.key, params: paramsOf(p.params, def.params) });
      }
      return out.slice(0, RC.LIMITS.parts[kind] || 0);
    }

    function knobsOf(words, kind) {
      const allowed = RC.KNOB_KINDS[kind] || [];
      const out = [];
      for (const w of list(words)) {
        const what = str(w);
        if (allowed.includes(what) && !out.some((k) => k.what === what)) out.push({ what });
      }
      return out.slice(0, RC.LIMITS.knobs.ai);
    }

    // "ink@pos" → [ink, pos]; unreadable stops are left out (normalize then keeps its default gradient).
    function stopsOf(items) {
      const out = [];
      for (const s of list(items)) {
        const text = str(s);
        const at = text.lastIndexOf('@');
        if (at <= 0) continue;
        const ink = text.slice(0, at).trim(), pos = Number(text.slice(at + 1));
        if (Number.isFinite(pos)) out.push([C.isHex(ink) ? ink.toUpperCase() : ink, pos]);
      }
      return out;
    }

    function moverOf(l) {
      if (!RC.WAVES.includes(l.move)) return [];
      return [{ amp: num(l.moveAmp, 0), curve: null, hz: num(l.moveHz, 0.5), phase: 'rnd', wave: l.move, what: l.moveWhat }];
    }

    function appearOf(l) {
      if (!RC.APPEAR_AT.includes(l.appear)) return { at: 'start', draw: 'none', dur: 0 };
      return { at: l.appear, draw: RC.DRAWS.includes(l.draw) ? l.draw : 'fade', dur: APPEAR_DUR };
    }

    function placeOf(l) { return { anchor: l.anchor, spread: num(l.spread, 1), x: num(l.x, 0), y: num(l.y, 0) }; }

    function sizeOf(l) {
      const a = num(l.sizeMin, 0.02), b = num(l.sizeMax, a);
      return a <= b ? [a, b] : [b, a];
    }

    // One flat layer → a recipe layer (normalize clamps and fills the rest), or null when it cannot be read. Media
    // layers need the request's [media] list; without one they are left out.
    function layerOf(l, kind, ctx) {
      if (!isObject(l) || !RC.PRIMS.includes(l.prim)) return null;
      if (l.prim === 'media') {
        if (!ctx.media || (kind !== 'ornament' && kind !== 'ground')) return null;
        let src = '';
        if (str(l.media) !== '') {
          const asset = assetOf(ctx.media, l.media);
          if (!asset) { ctx.warn(['ai.warn.mediaUnknown', { name: str(l.media) }]); return null; }
          src = asset.id;
        }
        return {
          alpha: num(l.alpha, 1), appear: appearOf(l), blur: 0, border: q6(Math.max(0, num(l.stroke, 0)) * BORDER_PER_STROKE),
          comp: 'over', fit: 'cover', inks: list(l.inks).slice(0, 1), layer: l.layer, move: moverOf(l), place: placeOf(l),
          prim: 'media', shape: MEDIA_SHAPE[l.shape] || 'round', size: sizeOf(l), src,
          time: { clipIn: 0, clipOut: 0, loop: 'loop', speed: 1 },
        };
      }
      const out = {
        alpha: num(l.alpha, 1), appear: appearOf(l), count: isNumber(l.count) ? Math.round(l.count) : undefined,
        field: { burst: l.burst, dir: num(l.dir, 90), life: [0, 0], speed: num(l.speed, 0), spin: num(l.spin, 0),
          sway: num(l.sway, 0), swayHz: num(l.swayHz, 0) },
        glyph: str(l.glyph), inks: list(l.inks).map(str), layer: l.layer, move: moverOf(l), pattern: l.pattern || '',
        place: placeOf(l), prim: l.prim, rot: SPIN_PRIMS.includes(l.prim) ? [0, 360] : [0, 0], shape: l.shape || '',
        size: sizeOf(l), stroke: num(l.stroke, 0), style: l.style || '',
      };
      if (l.prim === 'fill') out.fill = { angle: num(l.angle, 90), stops: stopsOf(l.stops), type: 'linear' };
      return out;
    }

    function layersOf(ai, kind, ctx) {
      const out = [];
      for (const l of list(ai.layers)) {
        const x = layerOf(l, kind, ctx);
        if (x) out.push(x);
      }
      // a ground built from layers starts with a fill (§5.7.3): move the first fill to the front, or add one
      if (kind === 'ground' && out.length && out[0].prim !== 'fill') {
        const at = out.findIndex((x) => x.prim === 'fill');
        if (at > 0) out.unshift(out.splice(at, 1)[0]);
        else out.unshift({ fill: { angle: 90, stops: [['ground', 0], ['ground2', 1]], type: 'linear' }, layer: 'ground', prim: 'fill' });
      }
      return out;
    }

    function oscOf(ai, kind) {
      const cols = kind === 'lens' ? RC.OSC_COLS_LENS : RC.OSC_COLS_DWELL;
      const out = [];
      for (const o of list(ai.osc)) {
        if (!isObject(o) || !cols.includes(o.col)) continue;
        const phase = kind === 'lens' ? 'same' : RC.PHASES.concat(['word']).includes(o.phase) ? o.phase : 'same';
        out.push({ amp: num(o.amp, 0), col: o.col, hz: num(o.hz, 0.5), phase, step: phase === 'index' || phase === 'word' ? OSC_STEP : 0,
          wave: AI_WAVES.includes(o.wave) ? o.wave : 'sine' });
      }
      return out;
    }

    function motionOf(ai, kind) {
      const tracks = list(ai.tracks).filter((t) => isObject(t) && RC.MOTION_COLS.includes(t.col))
        .map((t) => ({ col: t.col, from: num(t.from, 0), to: num(t.to, 0) }));
      if (!tracks.length) return null;
      const shared = REG.SHARED[kind];
      const curve = curveFromAi(ai.curve);
      return {
        curve: curve || (kind === 'depart' ? 'quadIn' : 'expoOut'),
        dur: isNumber(ai.dur) && ai.dur > 0 ? [ai.dur, ai.dur] : shared.dur.auto.range.slice(),
        each: isNumber(ai.each) && ai.each >= 0 ? [ai.each, ai.each] : shared.each.auto.range.slice(),
        order: [S.ORDERS.includes(ai.order) ? ai.order : 'lead'], tracks, unit: RC.UNITS.includes(ai.unit) ? ai.unit : 'glyph',
      };
    }

    // The shared autos of an arrive/depart variant: dur and each (seconds; −1 keeps the base's), curve (its ease) and order.
    function sharedOf(ai, kind) {
      if (kind !== 'arrive' && kind !== 'depart') return {};
      const out = {};
      if (isNumber(ai.dur) && ai.dur > 0) out.dur = { value: ai.dur };
      if (isNumber(ai.each) && ai.each >= 0) out.each = { value: ai.each };
      const curve = curveFromAi(ai.curve);
      if (curve) out.ease = { value: curve };
      if (S.ORDERS.includes(ai.order)) out.order = { value: ai.order };
      return out;
    }

    function variantOf(ai, kind, base, def) {
      const params = paramsOf(ai.params, def.params);
      const shared = sharedOf(ai, kind);
      // a param named like a shared param of the kind (amount, ink, …) is a shared auto
      const specs = REG.SHARED[kind] || {};
      for (const p of list(ai.params)) {
        const name = isObject(p) ? str(p.name) : '';
        if (params[name] !== undefined || shared[name] || !specs[name]) continue;
        const v = paramValue(specs[name], p.value);
        if (v !== undefined) shared[name] = { value: v };
      }
      return { base: def.key, params, shared };
    }

    function compositeOf(ai, kind, base, ctx, seed) {
      switch (kind) {
        case 'ornament': {
          const scope = ai.scope === 'run' ? 'run' : 'cut';
          return { follow: scope === 'run' ? 'own' : 'text', knobs: knobsOf(ai.knobs, kind), layers: layersOf(ai, kind, ctx),
            parts: partsOf(ai, kind, base, scope), scope, seed };
        }
        case 'ground': return { knobs: knobsOf(ai.knobs, kind), layers: layersOf(ai, kind, ctx), parts: partsOf(ai, kind, base), seed };
        case 'arrive':
        case 'depart': {
          const out = { knobs: knobsOf(ai.knobs, kind), motion: motionOf(ai, kind), parts: partsOf(ai, kind, base) };
          if (kind === 'depart') out.mirrorOf = '';
          return out;
        }
        case 'dwell':
        case 'lens': return { knobs: knobsOf(ai.knobs, kind), osc: oscOf(ai, kind), parts: partsOf(ai, kind, base) };
        default: {                                   // filter: one or two existing effects, full strength
          const parts = partsOf(ai, kind, base);
          return { mix: parts.map(() => 1), parts };
        }
      }
    }

    // ---- fitting the budgets ----------------------------------------------------------------------------------------

    function knobMax(recipe) {
      const k = { count: 1, size: 1, speed: 1, alpha: 1, amp: 1 };
      for (const knob of list(recipe.knobs)) if (k[knob.what] !== undefined) k[knob.what] = RC.LIMITS.kmax[knob.what];
      return k;
    }

    // The flash rule's limits applied to the layers it names (§5.8): appear no faster than 0.15 s, alpha movers off the
    // beat wave, at most 3 Hz and 0.35 deep (at knob maximum).
    function calmed(recipe, probs) {
      const F = RC.LIMITS.flash;
      const k = knobMax(recipe);
      const bad = new Set(probs.filter((p) => p.code === 'flash').map((p) => p.path));
      const layers = recipe.layers.map((l, i) => {
        if (!bad.has('layers[' + i + ']')) return l;
        const move = l.move.map((m) => {
          if (m.what !== 'alpha') return m;
          const hz = Math.min(m.wave === 'beat' || m.wave === 'ramp' ? 1 : m.hz, Math.floor((F.hz / k.speed) * 1e6) / 1e6);
          const amp = Math.sign(m.amp) * Math.min(Math.abs(m.amp), Math.floor((F.amp / k.amp) * 1e6) / 1e6);
          return Object.assign({}, m, { amp, hz, wave: m.wave === 'beat' || m.wave === 'ramp' ? 'sine' : m.wave, curve: null });
        });
        const appear = (l.appear.at === 'beat' || l.appear.at === 'impact') && l.appear.dur < F.appear
          ? Object.assign({}, l.appear, { dur: F.appear }) : l.appear;
        return Object.assign({}, l, { appear, move });
      });
      return Object.assign({}, recipe, { layers });
    }

    // Counts × 0.9 (at least 1 each); once every count is 1, the last layer goes, then the last part.
    function lighter(recipe) {
      const layers = list(recipe.layers);
      if (layers.some((l) => l.count > 1)) {
        return Object.assign({}, recipe, { layers: layers.map((l) => (l.count > 1 ? Object.assign({}, l, { count: Math.max(1, Math.floor(l.count * SCALE_STEP)) }) : l)) });
      }
      if (layers.length > 1) return Object.assign({}, recipe, { layers: layers.slice(0, -1) });
      if (list(recipe.parts).length > 1) {
        const parts = recipe.parts.slice(0, -1);
        return Object.assign({}, recipe, { parts }, recipe.mix ? { mix: recipe.mix.slice(0, parts.length) } : {});
      }
      return null;
    }

    function fitted(kind, recipe, pctx, warn, name) {
      let r = RC.normalize(kind, recipe).recipe;
      let probs = RC.problems(kind, r, pctx);
      if (probs.some((p) => p.code === 'flash')) {
        r = RC.normalize(kind, calmed(r, probs)).recipe;
        probs = RC.problems(kind, r, pctx);
        warn(['ai.warn.matFlash', { name }]);
      }
      let scaled = false;
      for (let i = 0; i < SCALE_TRIES && probs.some((p) => BUDGET_CODES.includes(p.code)); i++) {
        const next = lighter(r);
        if (!next) break;
        r = RC.normalize(kind, next).recipe;
        probs = RC.problems(kind, r, pctx);
        scaled = true;
      }
      if (scaled) warn(['ai.warn.matScaled', { name }]);
      return probs.length ? null : r;
    }

    // fromAi(ai, registry, kindHint?, opts?) → { entry: MaterialEntry without id | null, warnings }.
    // opts = { media: the request's [media] list ([{ n, id, kind, anim, alpha, dur }]), lang: 'ja' | 'en' (the language
    // the blurb is written in) }. kindHint (the standalone tool's kind, or the material being remade) wins over the
    // answer's kind. The base registry checks variant bases and inner parts, so materials never nest.
    function fromAi(ai, registry, kindHint, opts) {
      const o = opts || {};
      const warnings = [];
      const warn = (w) => { warnings.push(w); };
      const a = isObject(ai) ? ai : {};
      const name = cleanText(a.name, RC.LIMITS.name) || UNTITLED[0];
      const kind = RC.MAT_KINDS.includes(kindHint) ? kindHint : RC.MAT_KINDS.includes(a.kind) ? a.kind : null;
      const base = registry.base || registry;
      if (!kind) { warn(['ai.warn.matEmpty', { name }]); return { entry: null, warnings }; }
      const baseKey = str(a.base);
      const def = baseKey ? basePart(base, kind, baseKey) : null;
      if (baseKey && !def) warn(['ai.warn.unknown', { kind, key: baseKey }]);
      const ctx = { media: Array.isArray(o.media) ? o.media : null, warn };
      let recipe = null;
      if (def) recipe = variantOf(a, kind, base, def);
      else if (RC.COMPOSITE_KINDS.includes(kind)) recipe = compositeOf(a, kind, base, ctx, H.hash32('material', name));
      const mediaCtx = { list: list(ctx.media).map((x) => ({ id: x.id, kind: x.kind, anim: !!x.anim, alpha: !!x.alpha })) };
      const fit = recipe ? fitted(kind, recipe, { registry: base, media: mediaCtx }, warn, name) : null;
      if (!fit) { warn(['ai.warn.matEmpty', { name }]); return { entry: null, warnings }; }
      const blurb = cleanText(a.blurb, RC.LIMITS.blurb);
      const tags = [...new Set(list(a.tags).map(str).filter((x) => S.TAGS.includes(x)))].slice(0, RC.LIMITS.tags);
      const season = REG.SEASONS.includes(a.season) ? a.season : null;
      const entry = {
        kind, by: 'ai', name: { ja: name, en: cleanText(a.nameEn, RC.LIMITS.name) },
        blurb: blurb ? { ja: blurb, en: o.lang === 'en' ? blurb : '' } : null, tags, season, pool: false, recipe: fit,
      };
      return { entry, warnings };
    }

    // ---- entry → answer (「AIで作り直す」) ------------------------------------------------------------------------------

    function paramText(v) {
      if (typeof v === 'string') return v;
      if (typeof v === 'object' && v !== null) return JSON.stringify(v);
      return String(v);
    }

    function paramsToAi(params) {
      return Object.keys(params || {}).sort().map((name) => ({ name, value: paramText(params[name]) }));
    }

    function layerToAi(l, mediaList) {
      const mover = l.move && l.move[0];
      const appear = l.appear && !(l.appear.at === 'start' && l.appear.draw === 'none') ? l.appear.at : 'always';
      const out = {
        prim: l.prim, shape: l.prim === 'media' ? (MEDIA_SHAPE_BACK[l.shape] || '') : l.shape || '', glyph: l.glyph || '',
        inks: list(l.inks).slice(), alpha: l.alpha, layer: l.layer, anchor: l.place.anchor, x: l.place.x, y: l.place.y,
        spread: l.place.spread, sizeMin: l.size[0], sizeMax: l.size[1], count: isNumber(l.count) ? l.count : 1,
        stroke: l.prim === 'media' ? q6(l.border / BORDER_PER_STROKE) : l.stroke || 0,
        dir: l.field ? l.field.dir : 90, speed: l.field ? l.field.speed : 0, sway: l.field ? l.field.sway : 0,
        swayHz: l.field ? l.field.swayHz : 0, spin: l.field ? l.field.spin : 0, burst: l.field ? l.field.burst : 'none',
        move: mover ? mover.wave : 'none', moveWhat: mover ? mover.what : 'alpha', moveAmp: mover ? mover.amp : 0,
        moveHz: mover ? mover.hz : 0, appear, draw: l.appear ? l.appear.draw : 'none', style: l.style || '', pattern: l.pattern || '',
        stops: l.fill ? l.fill.stops.map((s) => s[0] + '@' + s[1]) : [], angle: l.fill ? l.fill.angle : 0,
      };
      if (mediaList) {
        const hit = l.prim === 'media' && l.src ? list(mediaList).find((x) => x.id === l.src) : null;
        out.media = hit ? 'asset:' + hit.n : '';
      }
      return out;
    }

    // toAi(entry, opts?) → the flat AI_MATERIAL value of an entry (opts.media: the [media] list, so a fixed asset reads
    // 'asset:<n>'; with it the layers carry `media`). Lossless for entries fromAi made; hand-made recipes may use more
    // than the flat form can say (extra movers, radial fills), which it leaves out.
    function toAi(entry, opts) {
      const e = isObject(entry) ? entry : {};
      const r = isObject(e.recipe) ? e.recipe : {};
      const mediaList = opts && Array.isArray(opts.media) ? opts.media : null;
      const shared = r.shared || {};
      const motion = r.motion || null;
      const rangeValue = (range) => (Array.isArray(range) && range[0] === range[1] ? range[0] : -1);
      const curve = motion ? motion.curve : shared.ease ? shared.ease.value : null;
      return {
        name: e.name ? e.name.ja : '', nameEn: e.name ? e.name.en || '' : '', kind: e.kind, scope: r.scope === 'run' ? 'run' : 'cut',
        season: e.season || '', tags: list(e.tags).slice(), blurb: e.blurb ? e.blurb.ja || '' : '', base: r.base || '',
        params: paramsToAi(r.params), parts: list(r.parts).map((p) => ({ key: p.key, params: paramsToAi(p.params) })),
        layers: list(r.layers).map((l) => layerToAi(l, mediaList)),
        unit: motion ? motion.unit : 'glyph',
        order: motion ? motion.order[0] : shared.order ? shared.order.value : 'lead',
        dur: motion ? rangeValue(motion.dur) : shared.dur ? shared.dur.value : -1,
        each: motion ? rangeValue(motion.each) : shared.each ? shared.each.value : -1,
        tracks: motion ? motion.tracks.map((t) => ({ col: t.col, from: t.from, to: t.to })) : [],
        curve: curve === null ? curveToAi(null) : curveToAi(curve),
        osc: list(r.osc).map((x) => ({ col: x.col, amp: x.amp, hz: x.hz, wave: AI_WAVES.includes(x.wave) ? x.wave : 'sine', phase: x.phase })),
        knobs: list(r.knobs).map((k) => k.what),
        use: { slot: 'none', s: -1, lines: [], cuts: [] },
      };
    }

    // ---- the standalone tool 「素材づくり」 (part browser › マイ素材 › ＋ AIで作る; material page › AIで作り直す) ----------

    const KIND_WORDS = Object.freeze({
      arrange: 'a layout of the words', arrive: 'an entrance of the words', depart: 'an exit of the words',
      dwell: 'a hold (how the words move while they stay)', filter: 'a screen effect', ground: 'a background',
      lens: 'a camera texture (shake, sway)', ornament: 'a decoration near the words, or with scope run an atmosphere',
      seam: 'a transition between cuts',
    });

    function outLang(lang) { return lang === 'en' ? 'English' : 'Japanese'; }

    // materialRequest(doc, plan, registry, { description, kind, uiLang, current?, media? }) → { system, prompt, schema,
    // effort: 'medium', sent }. current: the entry to remake. media: the [media] list (ai/direct.mediaSent) when the
    // user allowed photos and videos; only names, sizes and vision text are sent (§11.6.4).
    function materialRequest(doc, plan, registry, opts) {
      const o = opts || {};
      const kind = RC.MAT_KINDS.includes(o.kind) ? o.kind : o.current && RC.MAT_KINDS.includes(o.current.kind) ? o.current.kind : 'ornament';
      const media = Array.isArray(o.media) && o.media.length ? o.media : null;
      const lang = o.uiLang === 'en' ? 'en' : 'ja';
      const base = registry.base || registry;
      const system = [
        'You design one material (素材) for a lyric-motion video (文字PV): ' + KIND_WORDS[kind] + '. A material is data built '
          + 'from existing parts and the primitives below, never code.',
        'Prefer a variant (base = an existing part of the same kind with other values) when one comes close; otherwise build '
          + 'it from layers, tracks or oscillators. Keep it light: few layers, calm blinking.',
        'kind must be "' + kind + '". "use" is ignored here (slot "none").',
        'name: a short Japanese name; nameEn: the English name; blurb (one short sentence) and "question" in ' + outLang(lang) + '.',
        'If the description is unclear or impossible, set understood=false and ask in "question".',
      ].join('\n');
      const parts = [
        'Kind: ' + kind,
        'Description: ' + String(o.description || '').replace(/[\r\n]+/g, ' ').slice(0, 300),
        o.current ? 'Current material (remake it): ' + JSON.stringify(toAi(o.current, { media })) : '',
        '',
        'Existing parts of this kind (base or parts):',
        CAT.catalogText(CAT.catalog(base, doc, kind === 'ornament' ? ['ornament', 'atmos'] : [kind], lang, { mine: false, cutOrnaments: true })),
        media ? '\n' + mediaText(media) : '',
        '',
        CAT.recipeText({ media: !!media }),
      ];
      return {
        system, prompt: parts.filter((p) => p !== '').join('\n'), schema: media ? MATERIAL_SCHEMA_MEDIA : MATERIAL_SCHEMA,
        effort: 'medium', sent: { kind, current: o.current ? o.current.id : null, media: media || [], lang },
      };
    }

    // ---- the [media] list (§11.6.1; also used by ai/direct) -----------------------------------------------------------

    const MAX_MEDIA = 40;

    function clock(sec) {
      const s = Math.max(0, Math.round(sec));
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    }

    // Where a box of fractions sits, in words: 'upper third', 'lower left', 'middle band', …
    function boxWords(b) {
      const cy = b.y + b.h / 2, cx = b.x + b.w / 2;
      const v = cy < 1 / 3 ? 'upper' : cy > 2 / 3 ? 'lower' : 'middle';
      if (b.w >= 0.6) return v === 'middle' ? 'middle band' : v + ' third';
      return v + ' ' + (cx < 1 / 3 ? 'left' : cx > 2 / 3 ? 'right' : 'center');
    }

    // mediaSent(doc, { only?, lang? }) → [{ n, id, kind, anim, alpha, dur, w, h, name, line }]: the library in its
    // order (at most 40), numbered for the AI. `only` (asset ids) keeps the assets whose bytes are on this device. The
    // line holds names, sizes and the vision text only, never pixels (§11.6.4).
    function mediaSent(doc, opts) {
      const o = opts || {};
      const all = doc && doc.media && Array.isArray(doc.media.list) ? doc.media.list : [];
      const only = Array.isArray(o.only) ? new Set(o.only) : null;
      const lang = o.lang === 'en' ? 'en' : 'ja';
      const out = [];
      for (const e of all) {
        if (out.length >= MAX_MEDIA) break;
        if (!isObject(e) || !MEDIA.isId(e.id) || (only && !only.has(e.id))) continue;
        const n = out.length;
        const kind = e.kind === 'video' ? 'video' : e.anim ? 'animation' : 'image';
        const shape = e.w > e.h ? 'landscape' : e.w < e.h ? 'portrait' : 'square';
        const ai = isObject(e.ai) ? e.ai : null;
        const caption = ai && ai.caption ? (ai.caption[lang] || ai.caption[lang === 'en' ? 'ja' : 'en'] || '') : '';
        const bits = [caption || '(no description)'];
        if (ai && Array.isArray(ai.colors) && ai.colors.length) bits.push('colours ' + ai.colors.join(' '));
        if (ai && isObject(ai.text)) bits.push('text area: ' + boxWords(ai.text));
        if (ai && isObject(ai.subject)) bits.push('subject: ' + boxWords(ai.subject));
        // Never the file name: the AI gets only the kind, size, shape and what the user let the vision step describe.
        const line = 'asset:' + n + ' ' + kind + (isNumber(e.dur) && kind !== 'image' ? ' ' + clock(e.dur) : '') + ' ' + e.w + '×'
          + e.h + ' ' + shape + ' — ' + bits.join(' · ');
        out.push({ n, id: e.id, kind: e.kind, anim: !!e.anim, alpha: !!e.alpha, dur: isNumber(e.dur) ? e.dur : null, w: e.w, h: e.h,
          name: String(e.name), line });
      }
      return out;
    }

    // The [media] list of a request (the same text ai/direct sends).
    function mediaText(media) {
      return '[media] the user\'s own photos and videos (use only these, as "asset:<n>")\n' + media.map((m) => m.line).join('\n');
    }

    function nextIds(doc) {
      const mats = doc.materials && Number.isInteger(doc.materials.next) ? doc.materials : { next: 1, list: [] };
      return mats;
    }

    // The material change of an entry: a new material (id assigned at apply, §5.6) or a remake of `current`.
    // fields: { id, prefix, rev, current?, k (the n-th new material of the review, for the planned id) }.
    function materialChange(doc, entry, f, opts) {
      const current = f.current || null;
      const mats = nextIds(doc);
      const plannedId = current ? current.id : 'm' + (mats.next + (f.k || 0)).toString(36);
      // a remake keeps the material's kind, name and おまかせ setting; the recipe is now the AI's
      const e = current ? Object.assign({}, entry, { kind: current.kind, name: current.name, pool: current.pool }) : entry;
      const name = e.name.ja;
      return CH.make(doc, {
        id: f.id, kind: 'material', scope: 'work', group: 'materials', entry: e, matName: f.matName || name,
        materialId: current ? current.id : null, plannedId, from: null, to: name,
        label: current ? ['ai.ch.materialUpdate', { name }] : ['ai.ch.material', { name, kind: e.kind, season: e.season }],
      }, opts);
    }

    // The slot a material takes at a scope (§5.11): 'atmos' for a run ornament, 'ornament' / 'filter' (a free index is
    // picked), the kind itself otherwise.
    function slotFor(entry) {
      if (entry.kind === 'ornament') return entry.recipe.scope === 'run' ? 'atmos' : 'ornament';
      return entry.kind;
    }

    // The lowest free index of a list slot (ornament#i, filter#i) at a scope: not pinned by the user or a lock there
    // (for a line, on the line or any of its cuts; for a cut, on the cut or its line). null when all three are taken.
    function freeIndex(doc, plan, scope, kind) {
      const taken = (path) => !!doc.pins[path] && doc.pins[path].by !== 'ai';
      const cuts = scope.startsWith('line/') ? cutKeysOf(plan, scope.slice(5)) : [];
      const lineOfCut = scope.startsWith('cut/') ? lineIdOf(scope.slice(4)) : null;
      for (let i = 0; i < 3; i++) {
        const slot = kind + '#' + i;
        if (taken(scope + ':' + slot)) continue;
        if (cuts.some((k) => taken('cut/' + k + ':' + slot))) continue;
        if (lineOfCut && taken('line/' + lineOfCut + ':' + slot)) continue;
        return slot;
      }
      return null;
    }

    function lineIdOf(cutKey) { try { return P.lineOfCut(cutKey); } catch (e) { return null; } }

    function cutKeysOf(plan, lineId) {
      const line = plan && Array.isArray(plan.lines) ? plan.lines.find((l) => l.id === lineId) : null;
      return line && Array.isArray(line.cuts) ? line.cuts : [];
    }

    // materialChanges(doc, plan, registry, json, { rev, sent, useAt?: { scope, slot } }) → { understood, question,
    // changes, warnings }: one material change, plus with useAt one dependent pin at that scope ('work' | 'line/<id>' |
    // 'cut/<key>'; slot 'ornament' / 'filter' take the first free index) that requires the material.
    function materialChanges(doc, plan, registry, json, opts) {
      const o = opts || {};
      const sent = o.sent || {};
      const question = String((json && json.question) || '').slice(0, 300);
      if (!json || !isObject(json.material)) return { understood: false, question, changes: [], warnings: [['ai.warn.empty', {}]] };
      if (json.understood === false) return { understood: false, question, changes: [], warnings: [] };
      const current = sent.current && doc.materials ? doc.materials.list.find((m) => m.id === sent.current) || null : null;
      const res = fromAi(json.material, registry, current ? current.kind : sent.kind, { media: sent.media, lang: sent.lang });
      if (!res.entry) return { understood: true, question, changes: [], warnings: res.warnings };
      const make = { rev: o.rev, prefix: '', srcs: CH.rowSrcs(doc) };
      const mat = materialChange(doc, res.entry, { id: 'mat:0', current }, make);
      const changes = [mat];
      const use = o.useAt && typeof o.useAt.scope === 'string' ? o.useAt : null;
      if (use) {
        const dep = useChange(doc, plan, mat, use, make);
        if (dep) changes.push(dep);
        else res.warnings.push(['ai.warn.noSlot', { n: 0 }]);
      }
      return { understood: true, question, changes, warnings: res.warnings };
    }

    function useChange(doc, plan, mat, use, make) {
      const scope = use.scope;
      let slot = typeof use.slot === 'string' && use.slot ? use.slot : slotFor(mat.entry);
      if (slot === 'ornament' || slot === 'filter') slot = freeIndex(doc, plan, scope, slot);
      if (!slot) return null;
      const path = scope + ':' + slot;
      let parsed;
      try { parsed = P.parse(path); } catch (e) { return null; }
      const key = mat.materialId ? 'myMat' + mat.materialId.slice(1) : 'mat:' + mat.matName;
      const kind = parsed.scope.kind;
      const pin = doc.pins[path];
      const fields = {
        id: 'use:' + path, kind: 'part', scope: kind, path, slot, partKind: mat.entry.kind,
        from: pin ? pin.v : null, fromSource: pin ? 'pin:' + kind : 'auto', to: key, requires: [mat.id], matName: mat.matName,
        group: kind === 'cut' ? 'cuts' : kind === 'line' ? 'lines' : 'work',
        label: ['ai.ch.value', { where: whereOf(plan, parsed.scope), field: fieldOf(mat.entry.kind, slot), from: pin ? pin.v : null, to: key }],
      };
      if (parsed.scope.lineId) fields.lineId = parsed.scope.lineId;
      if (kind === 'cut') Object.assign(fields, { cutKey: parsed.scope.id, cutSig: PL.pinSig(plan, parsed.scope.id) });
      return CH.make(doc, fields, make);
    }

    function fieldOf(kind, slot) { return slot === 'atmos' ? 'fld.atmos' : 'kind.' + kind; }

    // [stringKey, params] naming the place of a change: a line, a cut or the whole video.
    function whereOf(plan, scope) {
      const lines = plan && Array.isArray(plan.lines) ? plan.lines : [];
      if (scope.kind === 'work') return ['area.work', {}];
      const line = lines.find((l) => l.id === scope.lineId);
      const n = line ? line.index + 1 : 0;
      if (scope.kind === 'line') return ['area.linesOne', { a: n }];
      const keys = line && Array.isArray(line.cuts) ? line.cuts : [];
      return ['area.cut', { n, k: keys.indexOf(scope.id) + 1 }];
    }

    return {
      CURVE_AI, SEASON_AI, AI_MATERIAL, AI_MATERIAL_MEDIA, MATERIAL_SCHEMA, MATERIAL_SCHEMA_MEDIA, USE_SLOTS,
      curveFromAi, curveToAi, fromAi, toAi, materialRequest, materialChanges, materialChange, slotFor, freeIndex, whereOf,
      MAX_MEDIA, assetOf, mediaSent, mediaText,
    };
  });
