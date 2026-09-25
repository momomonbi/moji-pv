/* 文字PVメーカー v2 — original work. Material recipes: vocabularies, normalization, limits, cost, the flash rule and knobs (DESIGN_2_1 §5.7, §5.8, §11.5.8). */
MV.def('core/recipe', ['core/num', 'core/hash', 'core/color', 'core/curve', 'core/schema', 'core/registry', 'core/media'],
  (N, H, C, CV, S, REG, MEDIA) => {
    'use strict';

    // A material (マイ素材) is data: a recipe of fixed primitives and existing parts, never code. `normalize` turns any
    // JSON into the canonical recipe of a kind (numbers clamped and q6-rounded, sorted keys, every field present, invalid
    // items dropped) and never throws on data. `problems` then reports what still makes a normalized recipe unusable:
    // limits over the budget, the flash rule, an empty recipe. parts/mix interprets canonical recipes only.

    const RECIPE_V = 1;
    const MAT_KINDS = Object.freeze(['arrange', 'arrive', 'depart', 'dwell', 'filter', 'ground', 'lens', 'ornament', 'seam']);
    const COMPOSITE_KINDS = Object.freeze(['arrive', 'depart', 'dwell', 'filter', 'ground', 'lens', 'ornament']);
    const PRIMS = Object.freeze(['shape', 'particles', 'lines', 'frame', 'fill', 'pattern', 'glyphs', 'media']);
    const SHAPES = Object.freeze(['rect', 'roundRect', 'ellipse', 'ring', 'star', 'petal', 'leaf', 'flake', 'drop', 'heart',
      'diamond', 'triangle', 'cross', 'dot', 'bar', 'arc', 'wave', 'spark']);
    const GLYPHS = Object.freeze(['♪', '♫', '★', '☆', '♡', '❄', '✿', '❀', '☀', '☂', '☁', '✦', '✧', '〇', '△', '□', '◇']);
    const ANCHORS = Object.freeze(['frame', 'focus', 'around', 'under', 'behind', 'corners', 'edges', 'free']);
    const LAYERS = Object.freeze({ ornament: Object.freeze(['far', 'mid', 'near']), ground: Object.freeze(['ground', 'far']) });
    const WAVES = Object.freeze(['sine', 'tri', 'saw', 'noise', 'beat', 'ramp']);
    const OSC_WAVES = Object.freeze(['sine', 'tri', 'saw', 'noise', 'beat']);
    const MOVE_WHAT = Object.freeze(['x', 'y', 'rot', 'scale', 'alpha']);
    const APPEAR_AT = Object.freeze(['start', 'arrive', 'rest', 'beat', 'impact']);
    const DRAWS = Object.freeze(['fade', 'grow', 'wipe', 'none']);
    const FRAME_STYLES = Object.freeze(['box', 'brackets', 'ticks', 'underline', 'ring']);
    const PATTERNS = Object.freeze(['dots', 'stripes', 'grid', 'checks', 'waves']);
    const BURSTS = Object.freeze(['none', 'beat', 'impact', 'arrive']);
    const MOTION_COLS = Object.freeze(['alpha', 'blur', 'glow', 'kx', 'ky', 'reveal', 'rot', 'rx', 'ry', 'sx', 'sy', 'tint', 'x', 'y', 'z']);
    const OSC_COLS_DWELL = Object.freeze(['x', 'y', 'rot', 'sx', 'alpha', 'glow', 'tint']);
    const OSC_COLS_LENS = Object.freeze(['x', 'y', 'roll', 'zoom']);
    const PHASES = Object.freeze(['same', 'index', 'rnd']);
    const KNOB_WHATS = Object.freeze(['count', 'size', 'speed', 'alpha', 'amp']);
    const UNITS = Object.freeze(['glyph', 'word', 'line']);
    const FILL_TYPES = Object.freeze(['linear', 'radial']);
    const MEDIA_SHAPES = Object.freeze(['rect', 'round', 'circle', 'arch', 'free']);
    const MEDIA_COMPS = Object.freeze(['over', 'screen', 'multiply', 'overlay']);
    const TAGS = S.TAGS;
    const SEASONS = REG.SEASONS;

    const LIMITS = deepFreeze({
      layers: { ornament: 6, ground: 4 }, shapesPerLayer: 24, nodes: 48, particles: 240, tracks: 8, osc: 4, movers: 4,
      parts: { arrive: 2, depart: 2, dwell: 2, filter: 2, ground: 1, lens: 2, ornament: 2 }, knobs: { ai: 4, user: 6 },
      params: 32, tags: 8, name: 24, blurb: 80, recipeBytes: 6 * 1024, materials: 64, materialsBytes: 160 * 1024,
      seed: [0, 4294967295],
      size: [0.002, 1.2], count: { shape: [1, 24], particles: [1, 240], lines: [1, 240], glyphs: [1, 240] },
      stroke: [0, 0.02], rot: [-360, 360], alpha: [0, 1], x: [-0.5, 0.5], y: [-0.5, 0.5], spread: [0, 2], gap: [0.02, 0.5],
      dir: [0, 360], speed: [0, 1.5], sway: [0, 200], swayHz: [0, 2], spin: [-720, 720], life: [0, 30], appearDur: [0, 3],
      angle: [-360, 360], hz: [0, 4], step: [0, 1], mix: [0, 1],
      moverAmp: { alpha: 1, rot: 180, scale: 1, x: 0.5, y: 0.5 },
      track: { alpha: [0, 1], blur: [0, 0.6], glow: [0, 1], kx: [-720, 720], ky: [-720, 720], reveal: [0, 1], rot: [-720, 720],
        rx: [-720, 720], ry: [-720, 720], sx: [0, 8], sy: [0, 8], tint: [0, 1], x: [-10, 10], y: [-10, 10], z: [-10, 10] },
      oscAmp: { dwell: { alpha: 1, glow: 1, rot: 30, sx: 0.3, tint: 1, x: 0.6, y: 0.6 }, lens: { roll: 4, x: 40, y: 40, zoom: 0.08 } },
      motionDur: [0.05, 4], motionEach: [0, 0.5],
      ms: { ornamentCut: 1.2, ornamentRun: 1.5, ground: 2 },
      cost: { shape: 0.01, particles: 0.004, lines: 0.005, frame: 0.02, fill: 0.25, pattern: 0.3, glyphs: 0.006, part: 0.35,
        media: 0.4, mediaHeavy: 1.5 },
      frameNodes: { box: 1, brackets: 4, ticks: 8, underline: 1, ring: 1 },
      filterCost: 6, filterPasses: 6,
      flash: { cover: 0.25, hz: 3, amp: 0.35, appear: 0.15 },
      kmax: { count: 1.5, size: 2, speed: 2, alpha: 2, amp: 2 },
      media: { layers: 2, videos: 1, border: [0, 40], blur: [0, 60] },
    });
    // What each knob multiplies, by kind (§5.7.6); a kind's shared param names are never knob names (dwell: no speed).
    const KNOB_KINDS = Object.freeze({
      ornament: KNOB_WHATS, ground: KNOB_WHATS, arrive: Object.freeze(['amp']), depart: Object.freeze(['amp']),
      dwell: Object.freeze(['amp']), lens: Object.freeze(['amp']), filter: Object.freeze([]),
    });
    // The ja/en texts of the strings mat.knob.* (core cannot read the string table; i18n.test.js keeps them equal).
    const KNOB_LABELS = deepFreeze({ count: { ja: '量', en: 'Amount' }, size: { ja: '大きさ', en: 'Size' },
      speed: { ja: '速さ', en: 'Speed' }, alpha: { ja: '濃さ', en: 'Opacity' }, amp: { ja: '振れ幅', en: 'Amplitude' } });
    const SRC_LABEL = deepFreeze({ ja: '写真・動画', en: 'Photo or video' });
    const IDENTITY = Object.freeze({ alpha: 1, reveal: 1, sx: 1, sy: 1 });
    const PARTKEY = /^[a-z][A-Za-z0-9]{2,31}$/;
    const PARAM = /^[a-z][A-Za-z0-9]{0,31}$/;
    const MAT_ID = /^m[0-9a-z]+$/;
    const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

    function deepFreeze(v) {
      if (v && typeof v === 'object' && !Object.isFrozen(v)) {
        Object.freeze(v);
        for (const k of Object.keys(v)) deepFreeze(v[k]);
      }
      return v;
    }

    function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
    function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
    function has(obj, key) { return isObject(obj) && Object.prototype.hasOwnProperty.call(obj, key); }
    function q6(x) { const r = N.q6(x); return r === 0 ? 0 : r; }
    function sorted(o) {
      const out = {};
      for (const k of Object.keys(o).sort()) out[k] = o[k];
      return out;
    }
    function list(v) { return Array.isArray(v) ? v : []; }
    function cleanText(v, max) {
      if (typeof v !== 'string') return null;
      const s = v.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').trim();
      return Array.from(s).slice(0, max).join('');
    }

    // --- normalize -------------------------------------------------------------------------------------------------

    // A context that records what normalization changed (problems of the input, for the material page's 確かめる).
    function reporter() {
      const problems = [];
      return {
        problems,
        add(path, code, params) { problems.push({ path, code, params: params || {} }); },
        // v clamped into [lo, hi] and q6-rounded; a missing or non-numeric value takes `def` (reported when present).
        num(v, range, def, path) {
          if (!isNumber(v)) {
            if (v !== undefined && v !== null) this.add(path, 'fixed', { was: typeof v });
            return def;
          }
          const x = q6(N.clamp(v, range[0], range[1]));
          if (x !== q6(v)) this.add(path, 'clamped', { min: range[0], max: range[1] });
          return x;
        },
        int(v, range, def, path) {
          if (!isNumber(v)) {
            if (v !== undefined && v !== null) this.add(path, 'fixed', { was: typeof v });
            return def;
          }
          const x = Math.round(N.clamp(v, range[0], range[1]));
          if (x !== v) this.add(path, 'clamped', { min: range[0], max: range[1] });
          return x;
        },
        pick(v, allowed, def, path) {
          if (allowed.includes(v)) return v;
          if (v !== undefined && v !== null && v !== '') this.add(path, 'fixed', { was: typeof v === 'string' ? v.slice(0, 40) : typeof v });
          return def;
        },
        range2(v, range, def, path) {
          if (!Array.isArray(v) || v.length !== 2 || !isNumber(v[0]) || !isNumber(v[1])) {
            if (v !== undefined && v !== null) this.add(path, 'fixed', {});
            return def.slice();
          }
          const a = this.num(v[0], range, def[0], path + '[0]'), b = this.num(v[1], range, def[1], path + '[1]');
          return a <= b ? [a, b] : [b, a];
        },
        capped(v, max, path) {
          const items = list(v);
          if (v !== undefined && v !== null && !Array.isArray(v)) this.add(path, 'dropped', { why: 'not a list' });
          if (items.length > max) this.add(path, 'too-many', { max });
          return items.slice(0, max);
        },
      };
    }

    function inkOk(v, kind) {
      return C.TOKENS.includes(v) || C.isHex(v) || (v === 'slot' && kind === 'ornament');
    }
    function inkOf(v) { return C.isHex(v) ? v.toUpperCase() : v; }

    function inksOf(v, kind, def, rep, path) {
      const out = [];
      for (const [i, ink] of list(v).entries()) {
        if (inkOk(ink, kind)) { if (out.length < 4) out.push(inkOf(ink)); else rep.add(path, 'too-many', { max: 4 }); }
        else rep.add(path + '[' + i + ']', 'dropped', { why: 'ink' });
      }
      return out.length ? out : def.slice();
    }

    function curveOr(v, def, rep, path) {
      if (v === undefined || v === null) return def;
      const c = CV.coerce(v);
      if (c === undefined) { rep.add(path, 'fixed', {}); return def; }
      return c;
    }

    function placeOf(v, rep, path) {
      const p = isObject(v) ? v : {};
      return sorted({
        anchor: rep.pick(p.anchor, ANCHORS, 'frame', path + '.anchor'),
        spread: rep.num(p.spread, LIMITS.spread, 1, path + '.spread'),
        x: rep.num(p.x, LIMITS.x, 0, path + '.x'),
        y: rep.num(p.y, LIMITS.y, 0, path + '.y'),
      });
    }

    function appearOf(v, rep, path) {
      const a = isObject(v) ? v : {};
      const draw = rep.pick(a.draw, DRAWS, 'fade', path + '.draw');
      return {
        at: rep.pick(a.at, APPEAR_AT, 'start', path + '.at'),
        draw,
        dur: draw === 'none' ? 0 : rep.num(a.dur, LIMITS.appearDur, 0.4, path + '.dur'),
      };
    }

    function moverOf(v, rep, path) {
      if (!isObject(v) || !MOVE_WHAT.includes(v.what) || !WAVES.includes(v.wave)) {
        rep.add(path, 'dropped', { why: 'mover' });
        return null;
      }
      const max = LIMITS.moverAmp[v.what];
      const ramp = v.wave === 'ramp';
      return {
        amp: rep.num(v.amp, [-max, max], 0, path + '.amp'),
        curve: ramp ? curveOr(v.curve, null, rep, path + '.curve') : null,
        hz: ramp ? 0 : rep.num(v.hz, LIMITS.hz, 0.5, path + '.hz'),
        phase: rep.pick(v.phase, PHASES, 'same', path + '.phase'),
        wave: v.wave,
        what: v.what,
      };
    }

    function moversOf(v, rep, path) {
      const out = [];
      rep.capped(v, LIMITS.movers, path).forEach((m, i) => {
        const x = moverOf(m, rep, path + '[' + i + ']');
        if (x) out.push(x);
      });
      return out;
    }

    const FIELD_DEFAULT = Object.freeze({ burst: 'none', dir: 90, life: Object.freeze([0, 0]), speed: 0, spin: 0, sway: 0, swayHz: 0 });

    function fieldOf(v, rep, path) {
      const f = isObject(v) ? v : {};
      // q6 before and after the wrap, and 360 → 0, so a second normalize gives the same value (359.9999999 → 0, not 360)
      const wrapped = isNumber(f.dir) ? q6(N.wrap(q6(f.dir), 0, 360)) : 90;
      const dir = wrapped >= 360 ? 0 : wrapped;
      return {
        burst: rep.pick(f.burst, BURSTS, 'none', path + '.burst'),
        dir,
        life: rep.range2(f.life, LIMITS.life, [0, 0], path + '.life'),
        speed: rep.num(f.speed, LIMITS.speed, 0, path + '.speed'),
        spin: rep.num(f.spin, LIMITS.spin, 0, path + '.spin'),
        sway: rep.num(f.sway, LIMITS.sway, 0, path + '.sway'),
        swayHz: rep.num(f.swayHz, LIMITS.swayHz, 0, path + '.swayHz'),
      };
    }

    function fillOf(v, kind, rep, path) {
      const f = isObject(v) ? v : {};
      const type = rep.pick(f.type, FILL_TYPES, 'linear', path + '.type');
      const stops = [];
      for (const [i, s] of list(f.stops).entries()) {
        if (Array.isArray(s) && s.length === 2 && inkOk(s[0], kind) && isNumber(s[1]) && stops.length < 4) {
          stops.push([inkOf(s[0]), q6(N.clamp(s[1], 0, 1))]);
        } else rep.add(path + '.stops[' + i + ']', 'dropped', { why: 'stop' });
      }
      stops.sort((a, b) => a[1] - b[1]);
      return {
        angle: type === 'radial' ? 0 : rep.num(f.angle, LIMITS.angle, 90, path + '.angle'),
        stops: stops.length ? stops : [['ground', 0], ['ground2', 1]],
        type,
      };
    }

    const COUNT_DEFAULT = Object.freeze({ shape: 1, particles: 24, lines: 24, glyphs: 24 });

    // One non-media layer: every field present; fields that do not apply to the primitive hold their defaults, so a
    // layer has one canonical form.
    function layerOf(v, kind, rep, path) {
      const prim = v.prim;
      const sprite = prim === 'shape' || prim === 'particles';
      const flow = prim === 'particles' || prim === 'lines' || prim === 'glyphs';
      const layers = LAYERS[kind];
      let layer = rep.pick(v.layer, layers, kind === 'ground' ? 'ground' : 'mid', path + '.layer');
      if (prim === 'fill' && kind === 'ornament' && layer !== 'far') { rep.add(path + '.layer', 'fixed', { was: layer }); layer = 'far'; }
      let glyph = '';
      if (prim === 'glyphs') glyph = rep.pick(v.glyph, GLYPHS, GLYPHS[0], path + '.glyph');
      const out = {
        alpha: rep.num(v.alpha, LIMITS.alpha, 1, path + '.alpha'),
        appear: appearOf(v.appear, rep, path + '.appear'),
        count: COUNT_DEFAULT[prim] ? rep.int(v.count, LIMITS.count[prim], COUNT_DEFAULT[prim], path + '.count') : 1,
        field: flow ? fieldOf(v.field, rep, path + '.field') : Object.assign({}, FIELD_DEFAULT, { life: [0, 0] }),
        fill: prim === 'fill' ? fillOf(v.fill, kind, rep, path + '.fill') : null,
        gap: prim === 'pattern' ? rep.num(v.gap, LIMITS.gap, 0.06, path + '.gap') : 0,
        glyph,
        inks: prim === 'fill' ? [] : inksOf(v.inks, kind, kind === 'ornament' ? ['slot'] : ['ground2'], rep, path + '.inks'),
        layer,
        move: moversOf(v.move, rep, path + '.move'),
        pattern: prim === 'pattern' ? rep.pick(v.pattern, PATTERNS, 'dots', path + '.pattern') : '',
        place: placeOf(v.place, rep, path + '.place'),
        prim,
        rot: prim === 'shape' || prim === 'particles' || prim === 'glyphs' || prim === 'pattern'
          ? rep.range2(v.rot, LIMITS.rot, [0, 0], path + '.rot') : [0, 0],
        shape: sprite ? rep.pick(v.shape, SHAPES, 'dot', path + '.shape') : prim === 'lines' ? 'bar' : '',
        size: prim === 'fill' ? [1, 1] : rep.range2(v.size, LIMITS.size, [0.02, 0.02], path + '.size'),
        stroke: prim === 'shape' || prim === 'frame' ? rep.num(v.stroke, LIMITS.stroke, prim === 'frame' ? 0.004 : 0, path + '.stroke') : 0,
        style: prim === 'frame' ? rep.pick(v.style, FRAME_STYLES, 'box', path + '.style') : '',
      };
      return out;
    }

    // A media layer (§11.5.8): '' is the part param `src` (any picture); an AssetId fixes the asset.
    function mediaLayerOf(v, kind, rep, path) {
      const t = isObject(v.time) ? v.time : {};
      const R = MEDIA.LIMITS.params;
      let src = '';
      if (MEDIA.isId(v.src)) src = v.src;
      else if (v.src !== undefined && v.src !== '') rep.add(path + '.src', 'fixed', {});
      return {
        alpha: rep.num(v.alpha, LIMITS.alpha, 1, path + '.alpha'),
        appear: appearOf(v.appear, rep, path + '.appear'),
        blur: rep.num(v.blur, LIMITS.media.blur, 0, path + '.blur'),
        border: rep.num(v.border, LIMITS.media.border, 0, path + '.border'),
        comp: rep.pick(v.comp, MEDIA_COMPS, 'over', path + '.comp'),
        fit: rep.pick(v.fit, MEDIA.FITS, 'cover', path + '.fit'),
        inks: inksOf(v.inks, kind, ['ground'], rep, path + '.inks').slice(0, 1),
        layer: rep.pick(v.layer, LAYERS[kind], kind === 'ground' ? 'ground' : 'mid', path + '.layer'),
        move: moversOf(v.move, rep, path + '.move'),
        place: placeOf(v.place, rep, path + '.place'),
        prim: 'media',
        shape: rep.pick(v.shape, MEDIA_SHAPES, 'rect', path + '.shape'),
        size: rep.range2(v.size, LIMITS.size, [0.4, 0.4], path + '.size'),
        src,
        time: {
          clipIn: rep.num(t.clipIn, R.clipIn, 0, path + '.time.clipIn'),
          clipOut: rep.num(t.clipOut, R.clipOut, 0, path + '.time.clipOut'),
          loop: rep.pick(t.loop, MEDIA.LOOPS, 'loop', path + '.time.loop'),
          speed: rep.num(t.speed, R.speed, 1, path + '.time.speed'),
        },
      };
    }

    function layersOf(v, kind, rep) {
      const out = [];
      rep.capped(v, LIMITS.layers[kind], 'layers').forEach((l, i) => {
        const path = 'layers[' + i + ']';
        if (!isObject(l) || !PRIMS.includes(l.prim)) { rep.add(path, 'dropped', { why: 'prim' }); return; }
        out.push(l.prim === 'media' ? mediaLayerOf(l, kind, rep, path) : layerOf(l, kind, rep, path));
      });
      return out;
    }

    // Scalar part-param values (numbers, strings, booleans) or curves; the part's own specs check them at derive.
    function paramsOf(v, rep, path) {
      const out = {};
      if (!isObject(v)) {
        if (v !== undefined && v !== null) rep.add(path, 'dropped', { why: 'not an object' });
        return out;
      }
      let n = 0;
      for (const name of Object.keys(v).sort()) {
        const x = v[name];
        const where = path + '.' + name;
        if (!PARAM.test(name) || n >= LIMITS.params) { rep.add(where, 'dropped', { why: 'name' }); continue; }
        if (isNumber(x)) out[name] = q6(x);
        else if (typeof x === 'boolean') out[name] = x;
        else if (typeof x === 'string' && !CONTROL.test(x)) out[name] = Array.from(x).slice(0, 120).join('');
        else if (CV.coerce(x) !== undefined && typeof x === 'object') out[name] = CV.coerce(x);
        else { rep.add(where, 'dropped', { why: 'value' }); continue; }
        n++;
      }
      return out;
    }

    function partKeyOk(key) {
      return typeof key === 'string' && PARTKEY.test(key) && !key.startsWith('myMat') && !key.startsWith('myMed');
    }

    function partsOf(v, kind, rep) {
      const out = [];
      rep.capped(v, LIMITS.parts[kind], 'parts').forEach((p, i) => {
        const path = 'parts[' + i + ']';
        if (!isObject(p) || !partKeyOk(p.key)) { rep.add(path, 'dropped', { why: 'key' }); return; }
        out.push({ key: p.key, params: paramsOf(p.params, rep, path + '.params') });
      });
      return out;
    }

    function knobsOf(v, kind, rep) {
      const allowed = KNOB_KINDS[kind] || [];
      const shared = Object.keys(REG.SHARED[kind] || {});
      const out = [];
      const seen = new Set();
      rep.capped(v, LIMITS.knobs.user, 'knobs').forEach((k, i) => {
        const path = 'knobs[' + i + ']';
        const what = isObject(k) ? k.what : k;
        if (!allowed.includes(what) || shared.includes(what) || seen.has(what)) { rep.add(path, 'dropped', { why: 'knob' }); return; }
        seen.add(what);
        const knob = { what };
        const label = isObject(k) && isObject(k.label) ? k.label : null;
        const ja = label ? cleanText(label.ja, LIMITS.name) : null;
        if (ja) {
          const en = cleanText(label.en, LIMITS.name);
          knob.label = { en: en || ja, ja };
        }
        out.push(sorted(knob));
      });
      return out;
    }

    function oscOf(v, kind, rep, path) {
      const cols = kind === 'lens' ? OSC_COLS_LENS : OSC_COLS_DWELL;
      if (!isObject(v) || !cols.includes(v.col) || !isNumber(v.amp)) { rep.add(path, 'dropped', { why: 'osc' }); return null; }
      const max = LIMITS.oscAmp[kind][v.col];
      const phases = kind === 'lens' ? ['same'] : PHASES.concat(['word']);
      return {
        amp: rep.num(v.amp, [-max, max], 0, path + '.amp'),
        col: v.col,
        hz: rep.num(v.hz, LIMITS.hz, 0.5, path + '.hz'),
        phase: rep.pick(v.phase, phases, 'same', path + '.phase'),
        step: kind === 'lens' ? 0 : rep.num(v.step, LIMITS.step, 0, path + '.step'),
        wave: rep.pick(v.wave, OSC_WAVES, 'sine', path + '.wave'),
      };
    }

    function oscListOf(v, kind, rep) {
      const out = [];
      rep.capped(v, LIMITS.osc, 'osc').forEach((o, i) => {
        const x = oscOf(o, kind, rep, 'osc[' + i + ']');
        if (x) out.push(x);
      });
      return out;
    }

    function trackOf(v, kind, rep, path) {
      if (!isObject(v) || !MOTION_COLS.includes(v.col)) { rep.add(path, 'dropped', { why: 'track' }); return null; }
      const range = LIMITS.track[v.col];
      const id = IDENTITY[v.col] === undefined ? 0 : IDENTITY[v.col];
      let from = rep.num(v.from, range, id, path + '.from');
      let to = rep.num(v.to, range, id, path + '.to');
      // Entrances end at the identity pose and exits start there (§5.7.3 motion rules).
      if (kind === 'arrive' && to !== id) { rep.add(path + '.to', 'fixed', { identity: id }); to = id; }
      if (kind === 'depart' && from !== id) { rep.add(path + '.from', 'fixed', { identity: id }); from = id; }
      return { col: v.col, from, to };
    }

    function motionOf(v, kind, rep) {
      if (v === null || v === undefined) return null;
      if (!isObject(v)) { rep.add('motion', 'dropped', { why: 'not an object' }); return null; }
      const tracks = [];
      const seen = new Set();
      rep.capped(v.tracks, LIMITS.tracks, 'motion.tracks').forEach((t, i) => {
        const x = trackOf(t, kind, rep, 'motion.tracks[' + i + ']');
        if (!x) return;
        if (seen.has(x.col)) { rep.add('motion.tracks[' + i + ']', 'dropped', { why: 'duplicate' }); return; }
        seen.add(x.col);
        tracks.push(x);
      });
      if (!tracks.length) { rep.add('motion', 'dropped', { why: 'no tracks' }); return null; }
      const shared = REG.SHARED[kind];
      const colCurve = {};
      if (isObject(v.colCurve)) {
        for (const col of Object.keys(v.colCurve).sort()) {
          const c = CV.coerce(v.colCurve[col]);
          if (seen.has(col) && c !== undefined) colCurve[col] = c;
          else rep.add('motion.colCurve.' + col, 'dropped', { why: 'curve' });
        }
      }
      const orders = [];
      for (const o of list(v.order)) if (S.ORDERS.includes(o) && !orders.includes(o)) orders.push(o);
      return {
        colCurve,
        curve: curveOr(v.curve, kind === 'depart' ? 'quadIn' : 'expoOut', rep, 'motion.curve'),
        dur: rep.range2(v.dur, LIMITS.motionDur, shared.dur.auto.range, 'motion.dur'),
        each: rep.range2(v.each, LIMITS.motionEach, shared.each.auto.range, 'motion.each'),
        order: orders.length ? orders : ['lead'],
        tracks,
        unit: rep.pick(v.unit, UNITS, 'glyph', 'motion.unit'),
      };
    }

    function variantOf(r, kind, rep) {
      const base = partKeyOk(r.base) ? r.base : '';
      if (!base && r.base !== undefined && r.base !== '') rep.add('base', 'fixed', {});
      const shared = {};
      const specs = REG.SHARED[kind] || {};
      if (isObject(r.shared)) {
        for (const name of Object.keys(r.shared).sort()) {
          const auto = r.shared[name];
          const v = specs[name] && isObject(auto) && has(auto, 'value') ? S.coerce(specs[name], auto.value) : undefined;
          if (v === undefined) { rep.add('shared.' + name, 'dropped', { why: 'shared' }); continue; }
          shared[name] = { value: v };
        }
      }
      return { base, params: paramsOf(r.params, rep, 'params'), shared };
    }

    function compositeOf(r, kind, rep) {
      switch (kind) {
        case 'ornament': return {
          follow: rep.pick(r.follow, ['text', 'own'], 'text', 'follow'),
          knobs: knobsOf(r.knobs, kind, rep), layers: layersOf(r.layers, kind, rep), parts: partsOf(r.parts, kind, rep),
          scope: rep.pick(r.scope, ['cut', 'run'], 'cut', 'scope'), seed: rep.int(r.seed, LIMITS.seed, 1, 'seed'),
        };
        case 'ground': return {
          knobs: knobsOf(r.knobs, kind, rep), layers: layersOf(r.layers, kind, rep), parts: partsOf(r.parts, kind, rep),
          seed: rep.int(r.seed, LIMITS.seed, 1, 'seed'),
        };
        case 'arrive':
        case 'depart': {
          const out = { knobs: knobsOf(r.knobs, kind, rep), motion: motionOf(r.motion, kind, rep), parts: partsOf(r.parts, kind, rep) };
          if (kind === 'depart') {
            out.mirrorOf = typeof r.mirrorOf === 'string' && MAT_ID.test(r.mirrorOf) ? r.mirrorOf : '';
            if (r.mirrorOf !== undefined && r.mirrorOf !== '' && !out.mirrorOf) rep.add('mirrorOf', 'fixed', {});
            if (out.mirrorOf && (out.motion || out.parts.length)) {
              rep.add('mirrorOf', 'dropped', { why: 'a mirror has no motion or parts of its own' });
              out.motion = null;
              out.parts = [];
            }
          }
          return out;
        }
        case 'dwell':
        case 'lens': return { knobs: knobsOf(r.knobs, kind, rep), osc: oscListOf(r.osc, kind, rep), parts: partsOf(r.parts, kind, rep) };
        default: {                                   // filter
          const parts = partsOf(r.parts, kind, rep);
          const mix = parts.map((p, i) => rep.num(list(r.mix)[i], LIMITS.mix, 1, 'mix[' + i + ']'));
          return { mix, parts };
        }
      }
    }

    // normalize(kind, recipe) → { recipe, problems }: the canonical recipe (deep-frozen, sorted keys, q6 numbers) and
    // what had to change. A `base` makes a variant; arrange and seam recipes are always variants. Never throws on data.
    function normalize(kind, recipe) {
      const rep = reporter();
      const r = isObject(recipe) ? recipe : {};
      if (!isObject(recipe)) rep.add('', 'fixed', { why: 'not an object' });
      if (!MAT_KINDS.includes(kind)) {
        rep.add('', 'dropped', { why: 'kind' });
        return { recipe: deepFreeze({}), problems: rep.problems };
      }
      // A valid `base` makes a variant; an unusable one on a composite kind is dropped (the recipe stays a composite).
      const variant = !COMPOSITE_KINDS.includes(kind) || partKeyOk(r.base);
      if (!variant && r.base !== undefined && r.base !== '') rep.add('base', 'dropped', { why: 'base' });
      const out = variant ? variantOf(r, kind, rep) : compositeOf(r, kind, rep);
      return { recipe: deepFreeze(canon(out)), problems: rep.problems };
    }

    // Sorted keys at every depth, q6 numbers (canonical JSON; also what `hash` reads).
    function canon(v) {
      if (isNumber(v)) return q6(v);
      if (Array.isArray(v)) return v.map(canon);
      if (isObject(v)) {
        const out = {};
        for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = canon(v[k]);
        return out;
      }
      return v;
    }

    function hash(recipe) { return H.hashJSON(canon(recipe)); }

    // --- cost and limits -------------------------------------------------------------------------------------------

    function knobMax(recipe) {
      const k = {};
      for (const what of KNOB_WHATS) k[what] = 1;
      for (const knob of list(recipe && recipe.knobs)) if (isObject(knob) && k[knob.what] !== undefined) k[knob.what] = LIMITS.kmax[knob.what];
      return k;
    }

    function coverOf(layer, k) {
      if (layer.prim === 'fill' || layer.prim === 'pattern') return 1;
      if (layer.prim === 'frame') return 0.05;
      const lo = layer.size[0] * k.size, hi = layer.size[1] * k.size;
      if (layer.prim === 'media') return hi * hi;
      const meanArea = (lo * lo + lo * hi + hi * hi) / 3;       // E[s²] for s uniform in [lo, hi]; frame area 1 (square)
      return Math.ceil(layer.count * k.count) * meanArea;
    }

    function isVideoSrc(src, media) {
      if (!src || !media || !Array.isArray(media.list)) return false;
      const e = media.list.find((x) => x && x.id === src);
      return !!e && (e.kind === 'video' || e.anim === true);
    }
    function assetAlpha(src, media) {
      if (!src || !media || !Array.isArray(media.list)) return false;
      const e = media.list.find((x) => x && x.id === src);
      return !!e && e.alpha === true;
    }

    // cost(kind, recipe, ctx?) → { ms, particles, nodes, paints, parts, cost, passes, cover } with every knob at its
    // maximum (§5.8), for the normalized form of the recipe. ctx = { registry?, media? }: filter stacks read their inner
    // parts' cost and passes from the registry (null without one); media layers read the asset's alpha from doc.media.
    function cost(kind, recipe, ctx) {
      const r = normalize(kind, recipe).recipe;       // canonical input is unchanged (normalize is idempotent)
      const k = knobMax(r);
      const c = LIMITS.cost;
      const out = { ms: 0, particles: 0, nodes: 0, paints: 0, parts: list(r.parts).length, cost: 0, passes: 0, cover: 0 };
      for (const layer of list(r.layers)) {
        if (!isObject(layer)) continue;
        const n = Math.ceil((isNumber(layer.count) ? layer.count : 1) * k.count);
        switch (layer.prim) {
          case 'shape': out.ms += c.shape * n; out.nodes += n; break;
          case 'particles': out.ms += c.particles * n; out.particles += n; break;
          case 'lines': out.ms += c.lines * n; out.particles += n; break;
          case 'glyphs': out.ms += c.glyphs * n; out.particles += n; break;
          case 'frame': out.ms += c.frame; out.nodes += LIMITS.frameNodes[layer.style] || 1; break;
          case 'fill': out.ms += c.fill; out.paints += 1; break;
          case 'pattern': out.ms += c.pattern; out.paints += 1; break;
          case 'media': {
            // the isolated draw path (§11.5.4): a blurred layer or a picture with transparency (read from doc.media)
            const heavy = layer.blur > 0 || assetAlpha(layer.src, ctx && ctx.media);
            out.ms += c.media + (heavy ? c.mediaHeavy : 0);
            out.nodes += 1;
            break;
          }
          default: break;
        }
        if (layer.size) out.cover = Math.max(out.cover, coverOf(layer, k));
      }
      out.ms += c.part * out.parts;
      if (kind === 'filter') {
        const reg = ctx && ctx.registry;
        if (!reg) { out.cost = null; out.passes = null; }
        else {
          for (const p of list(r.parts)) {
            const def = isObject(p) ? reg.get('filter', p.key) : null;
            out.cost += def && isNumber(def.cost) ? def.cost : 0;
            out.passes += def && isNumber(def.passes) ? def.passes : 0;
          }
        }
      }
      out.ms = q6(out.ms);
      out.cover = q6(out.cover);
      return out;
    }

    function msLimit(kind, recipe) {
      if (kind === 'ground') return LIMITS.ms.ground;
      if (kind === 'ornament') return recipe.scope === 'run' ? LIMITS.ms.ornamentRun : LIMITS.ms.ornamentCut;
      return null;
    }

    // The flash rule (§5.8, §11.5.8) for one layer at knob max: a layer covering more than a quarter of the frame
    // may not have its alpha modulated faster than 3 Hz or deeper than 0.35, never on the beat wave, and may not appear
    // on the beat or on impact in under 0.15 s.
    function flashOf(layer, k) {
      const F = LIMITS.flash;
      if (coverOf(layer, k) <= F.cover) return null;
      const a = layer.appear;
      if (isObject(a) && (a.at === 'beat' || a.at === 'impact') && a.dur < F.appear) return 'appear';
      for (const m of list(layer.move)) {
        if (!isObject(m) || m.what !== 'alpha') continue;
        if (m.wave === 'beat') return 'beat';
        if (m.hz * k.speed > F.hz) return 'hz';
        if (Math.abs(m.amp) * k.amp > F.amp) return 'amp';
      }
      return null;
    }

    function utf8Length(s) {
      let n = 0;
      for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
        else n += 3;
      }
      return n;
    }

    // problems(kind, recipe, ctx?) → Problem[] ({ path, code, params }); [] when the recipe is usable. Normalization
    // problems come first (none for a normalized recipe), then the limits of §5.8 and §11.5.8. ctx as in cost().
    function problems(kind, recipe, ctx) {
      const norm = normalize(kind, recipe);
      const out = norm.problems.slice();
      const r = norm.recipe;
      const add = (path, code, params) => { out.push({ path, code, params: params || {} }); };
      if (!MAT_KINDS.includes(kind)) return out;
      if (has(r, 'base')) {
        if (!r.base) add('base', 'no-base', {});
      } else {
        const layers = list(r.layers);
        const empty = kind === 'filter' ? !r.parts.length
          : kind === 'arrive' ? !r.motion && !r.parts.length
            : kind === 'depart' ? !r.motion && !r.parts.length && !r.mirrorOf
              : kind === 'dwell' || kind === 'lens' ? !r.osc.length && !r.parts.length
                : !layers.length && !r.parts.length;
        if (empty) add('', 'empty', {});
        if (kind === 'ground' && !empty && !r.parts.length && !(layers[0] && layers[0].prim === 'fill')) add('layers[0]', 'ground-first', {});
        const k = knobMax(r);
        layers.forEach((layer, i) => {
          if (layer.prim === 'shape' && Math.ceil(layer.count * k.count) > LIMITS.shapesPerLayer) {
            add('layers[' + i + '].count', 'shapes', { n: Math.ceil(layer.count * k.count), max: LIMITS.shapesPerLayer });
          }
          const why = flashOf(layer, k);
          if (why) add('layers[' + i + ']', 'flash', { why });
        });
        const media = layers.filter((l) => l.prim === 'media');
        if (media.length > LIMITS.media.layers) add('layers', 'media-count', { n: media.length, max: LIMITS.media.layers });
        const videos = media.filter((l) => isVideoSrc(l.src, ctx && ctx.media)).length;
        if (videos > LIMITS.media.videos) add('layers', 'media-video', { n: videos, max: LIMITS.media.videos });
        const c = cost(kind, r, ctx);
        const max = msLimit(kind, r);
        if (max !== null && c.ms > max) add('', 'cost', { ms: c.ms, max });
        if (c.particles > LIMITS.particles) add('layers', 'particles', { n: c.particles, max: LIMITS.particles });
        if (c.nodes > LIMITS.nodes) add('layers', 'nodes', { n: c.nodes, max: LIMITS.nodes });
        if (kind === 'filter' && c.cost !== null) {
          if (c.cost > LIMITS.filterCost) add('parts', 'filter-cost', { n: c.cost, max: LIMITS.filterCost });
          if (c.passes > LIMITS.filterPasses) add('parts', 'filter-passes', { n: c.passes, max: LIMITS.filterPasses });
        }
      }
      const bytes = utf8Length(H.canonical(r));
      if (bytes > LIMITS.recipeBytes) add('', 'too-big', { bytes, max: LIMITS.recipeBytes });
      return out;
    }

    // --- entries ---------------------------------------------------------------------------------------------------

    function textOk(v, max, required) {
      if (typeof v !== 'string') return !required && (v === undefined || v === null);
      if (required && v.trim() === '') return false;
      return Array.from(v).length <= max && !CONTROL.test(v);
    }

    // entryProblems(entry) → Problem[] for the metadata of a MaterialEntry (§5.7.1): id, kind, by, name (≤ 24),
    // blurb (≤ 80), tags ⊂ the tag vocabulary, season, pool, rv, and ≤ 4 knobs for AI materials. `pool` and `rv` may be
    // absent (commands fill them).
    function entryProblems(entry) {
      const out = [];
      const add = (path, code, params) => { out.push({ path, code, params: params || {} }); };
      if (!isObject(entry)) { add('', 'bad-entry', {}); return out; }
      const e = entry;
      if (typeof e.id !== 'string' || !MAT_ID.test(e.id)) add('id', 'bad-id', {});
      if (!MAT_KINDS.includes(e.kind)) add('kind', 'bad-kind', {});
      if (e.by !== 'ai' && e.by !== 'user') add('by', 'bad-by', {});
      if (!isObject(e.name) || !textOk(e.name.ja, LIMITS.name, true) || !textOk(e.name.en, LIMITS.name, false)) {
        add('name', 'bad-name', { max: LIMITS.name });
      }
      if (e.blurb !== undefined && e.blurb !== null &&
          (!isObject(e.blurb) || !textOk(e.blurb.ja, LIMITS.blurb, false) || !textOk(e.blurb.en, LIMITS.blurb, false))) {
        add('blurb', 'bad-blurb', { max: LIMITS.blurb });
      }
      if (e.tags !== undefined && !(Array.isArray(e.tags) && e.tags.length <= LIMITS.tags && e.tags.every((t) => TAGS.includes(t))
        && new Set(e.tags).size === e.tags.length)) add('tags', 'bad-tags', {});
      if (e.season !== undefined && e.season !== null && !SEASONS.includes(e.season)) add('season', 'bad-season', {});
      if (e.pool !== undefined && typeof e.pool !== 'boolean') add('pool', 'bad-pool', {});
      if (e.rv !== undefined) {
        if (!Number.isInteger(e.rv) || e.rv < 1) add('rv', 'bad-rv', {});
        else if (e.rv > RECIPE_V) add('rv', 'rv-newer', { rv: e.rv, max: RECIPE_V });
      }
      if (!isObject(e.recipe)) add('recipe', 'bad-recipe', {});
      else if (e.by === 'ai' && list(e.recipe.knobs).length > LIMITS.knobs.ai) add('recipe.knobs', 'knobs-ai', { max: LIMITS.knobs.ai });
      return out;
    }

    // --- knobs -----------------------------------------------------------------------------------------------------

    // knobSpecs(kind, recipe) → { [name]: ParamSpec }: one number param per knob (0–1.5 for count, 0–2 otherwise, auto 1),
    // plus the param `src` (type media) when a media layer takes its picture from the part (§11.5.8).
    function knobSpecs(kind, recipe) {
      const r = isObject(recipe) ? recipe : {};
      const out = {};
      const allowed = KNOB_KINDS[kind] || [];
      for (const knob of list(r.knobs)) {
        if (!isObject(knob) || !allowed.includes(knob.what) || out[knob.what]) continue;
        const label = isObject(knob.label) && knob.label.ja ? { ja: knob.label.ja, en: knob.label.en || knob.label.ja }
          : KNOB_LABELS[knob.what];
        out[knob.what] = { type: 'num', min: 0, max: LIMITS.kmax[knob.what], step: 0.05, unit: 'x', auto: { value: 1 },
          label: { ja: label.ja, en: label.en } };
      }
      if (list(r.layers).some((l) => isObject(l) && l.prim === 'media' && l.src === '')) {
        out.src = { type: 'media', accept: 'any', auto: { value: '' }, label: { ja: SRC_LABEL.ja, en: SRC_LABEL.en }, ai: false };
      }
      return out;
    }

    // withKnobs(recipe, p) → the recipe with the knob values of p applied (a new object; used at scene build):
    // count × count, size × size, field speed and mover hz × speed, alpha × alpha (≤ 1), mover / osc / track
    // amplitudes × amp; media layers with src '' take p.src.
    function withKnobs(recipe, p) {
      const r = isObject(recipe) ? recipe : {};
      const q = isObject(p) ? p : {};
      const k = (what) => (isNumber(q[what]) ? Math.max(0, q[what]) : 1);
      const kc = k('count'), ks = k('size'), kv = k('speed'), ka = k('alpha'), kp = k('amp');
      const movers = (ms) => list(ms).map((m) => Object.assign({}, m, { amp: m.amp * kp, hz: m.hz * kv }));
      const out = Object.assign({}, r);
      if (Array.isArray(r.layers)) {
        out.layers = r.layers.map((l) => {
          const x = Object.assign({}, l, { alpha: Math.min(1, l.alpha * ka), move: movers(l.move) });
          if (Array.isArray(l.size) && l.prim !== 'fill') x.size = [l.size[0] * ks, l.size[1] * ks];
          if (isNumber(l.count) && l.prim !== 'media') x.count = Math.max(0, Math.round(l.count * kc));
          if (isObject(l.field)) x.field = Object.assign({}, l.field, { speed: l.field.speed * kv });
          if (l.prim === 'media' && l.src === '' && typeof q.src === 'string' && (q.src === '' || MEDIA.isId(q.src))) x.src = q.src;
          return x;
        });
      }
      if (Array.isArray(r.osc)) out.osc = r.osc.map((o) => Object.assign({}, o, { amp: o.amp * kp }));
      if (isObject(r.motion) && Array.isArray(r.motion.tracks)) {
        out.motion = Object.assign({}, r.motion, {
          tracks: r.motion.tracks.map((t) => {
            const id = IDENTITY[t.col] === undefined ? 0 : IDENTITY[t.col];
            return { col: t.col, from: id + (t.from - id) * kp, to: id + (t.to - id) * kp };
          }),
        });
      }
      return out;
    }

    // Future recipe versions migrate here; rv 1 is the first. null = a version this app does not know.
    function upgrade(recipe, rv) {
      if (rv === RECIPE_V) return { recipe, rv };
      return null;
    }

    return {
      RECIPE_V, MAT_KINDS, COMPOSITE_KINDS, PRIMS, SHAPES, GLYPHS, ANCHORS, LAYERS, WAVES, MOVE_WHAT, APPEAR_AT, DRAWS,
      FRAME_STYLES, PATTERNS, BURSTS, MOTION_COLS, OSC_COLS_DWELL, OSC_COLS_LENS, PHASES, KNOB_WHATS, LIMITS,
      OSC_WAVES, UNITS, FILL_TYPES, MEDIA_SHAPES, MEDIA_COMPS, KNOB_KINDS, KNOB_LABELS,
      normalize, problems, entryProblems, hash, cost, knobSpecs, withKnobs, upgrade,
    };
  });
