/* 文字PVメーカー v2 — original work. Materials runtime: recipes derived into parts, the effective registry and the fixed interpreters of layers, motion, oscillators and filter stacks (DESIGN_2_1 §3.12, §5.7–§5.9, §11.5.8–§11.5.9). */
MV.def('parts/mix', ['core/num', 'core/hash', 'core/rng', 'core/noise', 'core/curve', 'core/recipe', 'core/registry',
  'core/schema', 'core/media', 'parts/kit', 'engine/scene/behave', 'engine/scene/builder'],
(N, H, RNG, NZ, CV, R, REG, SCH, MEDIA, K, BH, B) => {
  'use strict';

  // A material (マイ素材) is a recipe: data only. `derive` turns one MaterialEntry into a part definition whose
  // build / make / apply is fixed code of this module, bound to the normalized recipe in one closure per material
  // version (the K.mirror precedent). Every run and draw function installed in a scene is defined once here, at module
  // level, and reads only its behaviour's or paint's fields. The effective registry of a document is
  // registryFor(base, doc.materials, doc.media): the base registry itself without materials and pooled media.
  //
  // Module state: only the documented memo caches (WeakMaps keyed by registries, entries and params objects).

  const TAU = N.TAU;
  const DEG = N.DEG;
  const BLEED = 0.15;              // the frame's bleed ring (DESIGN §4.19.3): anchor 'frame' covers it
  const MIN_PARTICLE = 2;          // du: the smallest particle (§5.8)
  const MIN_LIFE = 1 / 3;          // s: a particle life cycle never blinks faster than 3 Hz (the flash rule's rate)
  const FLASH_RATE = 3;            // Hz: beat-driven changes of a large layer (cover > LIMITS.flash.cover) stay at or below
  const BURST_LIFE = 1;            // s: the life of burst particles when the recipe leaves life at [0, 0]
  const ATTACK = 0.06;             // s: burst particles fade in this fast (0.15 s on large layers)
  const BEAT_DECAY = 0.2;          // s: a 'beat' wave falls to 1/e this long after the beat
  const NO_GRID = 0.5;             // s: beat waves pulse every half second without a beat grid
  const EDGE_FADE = 0.12;          // share of a region's short side over which particles fade at its edges
  const WIPE_SOFT = 0.15;          // the soft edge of a wipe, as a share of the region
  const BUCKETS = 16;              // particles of one ink are filled together per alpha step of 1/16
  const GLYPH_PX = 64;
  const GLYPH_FONT = '400 64px sans-serif';
  const PATTERN_MARKS = 2500;      // a moving pattern draws at most this many marks per frame (a still one is rasterized once)
  const PATTERN_MARKS_STILL = 20000;
  const MEDIA_ROUND = 0.12;        // the corner radius of a 'round' media mask, as a share of the box's short side
  const LIMITS = R.LIMITS;

  // core/registry reserves the param name `count` on ornaments (the list slot's count, DESIGN §3.4). The count knob of
  // an ornament material (§5.7.6) is the param `count` whenever the registry accepts that name on the definitions
  // `extend` adds, and `quantity` until then (NOTES v2.1-C). Decided once, when the module is made.
  const COUNT_PARAM = (() => {
    const L = { ja: '量', en: 'Amount' };
    const spec = { type: 'num', min: 0, max: 1.5, step: 0.05, unit: 'x', auto: { value: 1 }, label: L };
    const errs = REG.checkDef({ kind: 'ornament', key: 'myMat0', label: L, blurb: L, scope: 'cut', follow: 'text', mine: {},
      params: { count: spec }, build() {} }, { mine: true });
    return errs.length ? 'quantity' : 'count';
  })();

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isNumber(v) { return typeof v === 'number' && Number.isFinite(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function num(v, d) { return isNumber(v) ? v : d; }
  function problem(path, code, params) { return { path, code, params: params || {} }; }

  // ---------------------------------------------------------------------------------------------------------------
  // SHAPE_LIB: unit ShapeSpecs, centred on 0 and about one unit across (size 1 = the item's size). All geometry of a
  // material comes from here (§5.12).
  // ---------------------------------------------------------------------------------------------------------------

  function starPoints(points, outer, inner, turn) {
    const cmds = [];
    for (let k = 0; k < points * 2; k++) {
      const r = k % 2 ? inner : outer, a = turn + (Math.PI * k) / points;
      cmds.push([k === 0 ? 'M' : 'L', Math.cos(a) * r, Math.sin(a) * r]);
    }
    cmds.push(['Z']);
    return cmds;
  }

  function crossPoints(arm) {
    const a = arm / 2, e = 0.5;
    const pts = [[-a, -e], [a, -e], [a, -a], [e, -a], [e, a], [a, a], [a, e], [-a, e], [-a, a], [-e, a], [-e, -a], [-a, -a]];
    return pts.map((p, k) => [k === 0 ? 'M' : 'L', p[0], p[1]]).concat([['Z']]);
  }

  const SHAPE_LIB = Object.freeze({
    rect: K.shape.path([['R', -0.5, -0.5, 1, 1]]),
    roundRect: K.shape.rect(-0.5, -0.5, 1, 1, 0.18),
    ellipse: K.shape.path([['E', 0, 0, 0.5, 0.32]]),
    ring: K.shape.path([['A', 0, 0, 0.5, 0, TAU], ['M', 0.3, 0], ['A', 0, 0, 0.3, TAU, 0]]),
    star: K.shape.path(starPoints(5, 0.5, 0.2, -Math.PI / 2)),
    petal: K.shape.path([['M', 0, -0.5], ['C', 0.42, -0.34, 0.4, 0.3, 0.1, 0.5], ['L', 0, 0.4], ['L', -0.1, 0.5],
      ['C', -0.4, 0.3, -0.42, -0.34, 0, -0.5], ['Z']]),
    leaf: K.shape.path([['M', 0, -0.5], ['Q', 0.46, 0, 0, 0.5], ['Q', -0.46, 0, 0, -0.5], ['Z']]),
    flake: K.shape.path(starPoints(6, 0.5, 0.09, -Math.PI / 2)),
    drop: K.shape.path([['M', 0, -0.5], ['C', 0.18, -0.2, 0.34, 0.02, 0.34, 0.18], ['C', 0.34, 0.38, 0.18, 0.5, 0, 0.5],
      ['C', -0.18, 0.5, -0.34, 0.38, -0.34, 0.18], ['C', -0.34, 0.02, -0.18, -0.2, 0, -0.5], ['Z']]),
    heart: K.shape.path([['M', 0, 0.45], ['C', -0.5, 0.1, -0.5, -0.5, 0, -0.22], ['C', 0.5, -0.5, 0.5, 0.1, 0, 0.45], ['Z']]),
    diamond: K.shape.path([['M', 0, -0.5], ['L', 0.32, 0], ['L', 0, 0.5], ['L', -0.32, 0], ['Z']]),
    triangle: K.shape.path([['M', 0, -0.5], ['L', 0.5, 0.36], ['L', -0.5, 0.36], ['Z']]),
    cross: K.shape.path(crossPoints(0.24)),
    dot: K.shape.path([['E', 0, 0, 0.5, 0.5]]),
    bar: K.shape.path([['R', -0.5, -0.06, 1, 0.12]]),
    arc: K.shape.path([['A', 0, 0, 0.5, -5 * Math.PI / 6, -Math.PI / 6], ['L', Math.cos(-Math.PI / 6) * 0.36,
      Math.sin(-Math.PI / 6) * 0.36], ['A', 0, 0, 0.36, -Math.PI / 6, -5 * Math.PI / 6], ['Z']]),
    wave: K.shape.path([['M', -0.5, -0.05], ['Q', -0.25, -0.3, 0, -0.05], ['Q', 0.25, 0.2, 0.5, -0.05], ['L', 0.5, 0.05],
      ['Q', 0.25, 0.3, 0, 0.05], ['Q', -0.25, -0.2, -0.5, 0.05], ['Z']]),
    spark: K.shape.path([['M', 0, -0.5], ['Q', 0.06, -0.06, 0.5, 0], ['Q', 0.06, 0.06, 0, 0.5], ['Q', -0.06, 0.06, -0.5, 0],
      ['Q', -0.06, -0.06, 0, -0.5], ['Z']]),
  });

  // A ShapeSpec scaled by s (arc angles stay; everything else is a length or a point).
  function scaledShape(spec, s) {
    const pts = new Float32Array(spec.pts.length);
    let k = 0;
    for (let i = 0; i < spec.ops.length; i++) {
      const op = spec.ops[i], n = B.OP_ARGS[op];
      for (let a = 0; a < n; a++) pts[k + a] = op === B.OP.A && a >= 3 ? spec.pts[k + a] : spec.pts[k + a] * s;
      k += n;
    }
    return Object.freeze({ ops: spec.ops, pts });
  }

  // Adds a ShapeSpec to the current path, scaled by s, turned by rot and moved to (x, y). A shape that starts with an
  // arc or an ellipse gets its own start point, so shapes batched into one path never join.
  function addShape(g, spec, x, y, s, rot) {
    const c = Math.cos(rot) * s, n = Math.sin(rot) * s;
    const ops = spec.ops, p = spec.pts;
    let k = 0, prev = B.OP.Z;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      switch (op) {
        case 0: g.moveTo(x + c * p[k] - n * p[k + 1], y + n * p[k] + c * p[k + 1]); break;
        case 1: g.lineTo(x + c * p[k] - n * p[k + 1], y + n * p[k] + c * p[k + 1]); break;
        case 2: g.quadraticCurveTo(x + c * p[k] - n * p[k + 1], y + n * p[k] + c * p[k + 1],
          x + c * p[k + 2] - n * p[k + 3], y + n * p[k + 2] + c * p[k + 3]); break;
        case 3: g.bezierCurveTo(x + c * p[k] - n * p[k + 1], y + n * p[k] + c * p[k + 1],
          x + c * p[k + 2] - n * p[k + 3], y + n * p[k + 2] + c * p[k + 3], x + c * p[k + 4] - n * p[k + 5], y + n * p[k + 4] + c * p[k + 5]);
          break;
        case 4: {
          const cx = x + c * p[k] - n * p[k + 1], cy = y + n * p[k] + c * p[k + 1], r = p[k + 2] * s, a0 = p[k + 3] + rot;
          if (i === 0 || prev === B.OP.Z) g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
          g.arc(cx, cy, r, a0, p[k + 4] + rot, p[k + 4] < p[k + 3]);
          break;
        }
        case 5: {
          const cx = x + c * p[k] - n * p[k + 1], cy = y + n * p[k] + c * p[k + 1], rx = p[k + 2] * s;
          if (i === 0 || prev === B.OP.Z) g.moveTo(cx + Math.cos(rot) * rx, cy + Math.sin(rot) * rx);
          g.ellipse(cx, cy, rx, p[k + 3] * s, rot, 0, TAU);
          break;
        }
        case 6: {
          const x0 = p[k], y0 = p[k + 1], x1 = x0 + p[k + 2], y1 = y0 + p[k + 3];
          g.moveTo(x + c * x0 - n * y0, y + n * x0 + c * y0);
          g.lineTo(x + c * x1 - n * y0, y + n * x1 + c * y0);
          g.lineTo(x + c * x1 - n * y1, y + n * x1 + c * y1);
          g.lineTo(x + c * x0 - n * y1, y + n * x0 + c * y1);
          g.closePath();
          break;
        }
        default: g.closePath(); break;
      }
      k += B.OP_ARGS[op];
      prev = op;
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Waves, beats, appear (closed form in t; shared by behaviours and paints)
  // ---------------------------------------------------------------------------------------------------------------

  const WAVE = Object.freeze({ sine: 0, tri: 1, saw: 2, noise: 3, beat: 4, ramp: 5 });
  const WHAT = Object.freeze({ x: 0, y: 1, rot: 2, scale: 3, alpha: 4 });
  const PHASE = Object.freeze({ same: 0, index: 1, word: 2, rnd: 3 });
  const DRAW = Object.freeze({ fade: 0, grow: 1, wipe: 2, none: 3 });

  // Periodic waves in [−1, 1] at x cycles (sine, tri and saw start at 0, rising).
  function periodic(code, x, seed) {
    switch (code) {
      case 0: return Math.sin(TAU * x);
      case 1: return 1 - 4 * Math.abs(N.fract(x + 0.25) - 0.5);
      case 2: return 2 * N.fract(x + 0.5) - 1;
      default: return 2 * NZ.noise1(seed, x) - 1;
    }
  }

  // Seconds since the last pulse of a beat train with this period and offset (closed form in t).
  function since(t, period, offset) {
    const x = (t - offset) / period;
    return (x - Math.floor(x)) * period;
  }

  function pulse(t, period, offset) { return Math.exp(-since(t, period, offset) / BEAT_DECAY); }

  // The beat train of a scene: the grid's beats (every `step`-th one) or half-second pulses; `step` keeps beat-driven
  // changes of a large layer at or below FLASH_RATE per second (the flash rule, §5.8).
  function beatTrain(env, big) {
    const g = env.grid;
    const period = g && g.period > 0 ? g.period : NO_GRID, offset = g ? g.offset : 0;
    const step = big ? Math.max(1, Math.ceil(1 / (FLASH_RATE * period) - 1e-9)) : 1;
    return { period: period * step, offset };
  }

  // Appear (§5.7.4): at a fixed time (start, arrive, rest, impact) or anew on every beat; k in [0, 1].
  function appearK(o, t) {
    const s = o.apBeat ? since(t, o.period, o.offset) : t - o.apT;
    if (s < 0) return 0;
    return o.apDur > 0 ? N.smooth(s / o.apDur) : 1;
  }

  // The fields of an appear, resolved against the scene: `start` is the window start, `arrive` the sung start (the
  // cut-local 0), `rest` the end of the text's entrance, `impact` the sung start of an impact line (a cut that is not
  // one appears on arrive instead), `beat` every beat. Scenes without a cut (grounds, atmospheres) start at 0.
  function appearOf(env, a, big) {
    const T = env.times, cut = env.cut;
    const out = { apOn: a.draw !== 'none' || a.at !== 'start', apDraw: DRAW[a.draw], apDur: a.draw === 'none' ? 0 : a.dur,
      apBeat: a.at === 'beat', apT: T.a, period: NO_GRID, offset: 0 };
    if (a.at === 'beat') Object.assign(out, beatTrain(env, big));
    else if (cut && (a.at === 'arrive' || a.at === 'impact')) out.apT = N.clamp(0, T.a, T.b);
    else if (cut && a.at === 'rest') out.apT = T.rest;
    else if (!cut) out.apT = 0;
    if (out.apDraw === DRAW.none && out.apT <= T.a && !out.apBeat) out.apOn = false;
    return out;
  }

  // A mover's value at t for an item with phase ph (a share of a cycle). Periodic waves give [−1, 1]; 'beat' (0, 1];
  // 'ramp' the seconds since the window start, or the window's length shaped by the mover's curve.
  function moverWave(m, q, t, ph) {
    const w = m.wave[q];
    if (w === WAVE.beat) return pulse(t + ph * m.period, m.period, m.offset);
    if (w === WAVE.ramp) {
      const f = m.curve[q];
      const u = t - m.r0;
      if (!f) return u;
      return m.span * f(N.clamp(u / m.span));
    }
    return periodic(w, m.hz[q] * t + ph, m.seed + q);
  }

  // The alpha factor of an alpha mover (amp > 0: full at the wave's peak, 1 − amp at its trough; amp < 0: the other
  // way round; a ramp fades in (amp > 0) or out (amp < 0) at |amp| per second).
  function alphaFactor(m, q, w) {
    const amp = m.amp[q], code = m.wave[q];
    if (code === WAVE.ramp) return N.clamp(amp >= 0 ? amp * w : 1 + amp * w);
    const w01 = code === WAVE.beat ? w : (w + 1) / 2;
    return amp >= 0 ? 1 - amp * (1 - w01) : 1 + amp * w01;
  }

  // Movers of one layer as typed columns plus a phase table (items × movers).
  function moversOf(env, layer, n, rng, win) {
    const ms = list(layer.move);
    const m = ms.length;
    const train = beatTrain(env, false);
    const out = {
      m, what: new Uint8Array(m), wave: new Uint8Array(m), amp: new Float32Array(m), hz: new Float32Array(m),
      curve: new Array(m).fill(null), ph: new Float32Array(Math.max(1, n * m)), seed: H.hash32('mix', 'mover', env.seed || 0,
        rng.int(0, 1e9)), period: train.period, offset: train.offset, r0: win[0], span: Math.max(1e-3, win[1] - win[0]),
    };
    ms.forEach((mv, q) => {
      out.what[q] = WHAT[mv.what];
      out.wave[q] = WAVE[mv.wave];
      out.amp[q] = mv.amp;
      out.hz[q] = mv.hz;
      out.curve[q] = mv.wave === 'ramp' && mv.curve ? CV.fn(mv.curve) : null;
      for (let j = 0; j < n; j++) out.ph[j * m + q] = mv.phase === 'index' ? (n > 1 ? j / n : 0) : mv.phase === 'rnd' ? rng.next() : 0;
    });
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Regions: where an anchor puts a layer (§5.7.4 ANCHORS), in frame du
  // ---------------------------------------------------------------------------------------------------------------

  function box(x, y, w, h) { return { x, y, w: Math.max(0, w), h: Math.max(0, h) }; }
  function scaled(b, s) { return box(b.x + (b.w * (1 - s)) / 2, b.y + (b.h * (1 - s)) / 2, b.w * s, b.h * s); }
  function grown(b, m) { return box(b.x - m, b.y - m, b.w + 2 * m, b.h + 2 * m); }
  function moved(b, dx, dy) { return box(b.x + dx, b.y + dy, b.w, b.h); }

  function safeBox(D) { return box(D.safe.l, D.safe.t, D.w - D.safe.l - D.safe.r, D.h - D.safe.t - D.safe.b); }

  // The text block (cuts) or the safe area (grounds and atmospheres).
  function focusOf(env) {
    const f = env.hints && env.hints.focus;
    return f && isNumber(f.x) && isNumber(f.w) && (f.w > 0 || f.h > 0) ? box(f.x, f.y, f.w, f.h) : safeBox(env.D);
  }

  // → { boxes, ring, avoid, frame }: boxes the layer is spread over (each ≥ 1 du), `ring` for items on an ellipse around
  // the text, `avoid` a box particles fade out of, `frame` when the region is the whole frame (it covers the bleed).
  function regionOf(env, place) {
    const D = env.D, s = place.spread, short = D.short, dx = place.x * D.w, dy = place.y * D.h;
    const f = focusOf(env), safe = safeBox(D);
    let boxes, ring = null, avoid = null, frame = false;
    switch (place.anchor) {
      case 'focus': boxes = [scaled(f, s)]; break;
      case 'around': {
        const m = 0.08 * short * s;
        boxes = [grown(f, m)];
        ring = { cx: f.x + f.w / 2, cy: f.y + f.h / 2, rx: f.w / 2 + m, ry: f.h / 2 + m };
        avoid = f;
        break;
      }
      case 'under': boxes = [box(f.x, f.y + f.h + 0.02 * short, f.w, 0.08 * short * Math.max(s, 0.1))]; break;
      case 'behind': boxes = [scaled(f, 1.25 * s)]; break;
      case 'corners': {
        const c = 0.14 * short * s;
        boxes = [box(safe.x, safe.y, c, c), box(safe.x + safe.w - c, safe.y, c, c), box(safe.x, safe.y + safe.h - c, c, c),
          box(safe.x + safe.w - c, safe.y + safe.h - c, c, c)];
        break;
      }
      case 'edges': {
        const e = 0.07 * short * s;
        boxes = [box(safe.x, safe.y, safe.w, e), box(safe.x, safe.y + safe.h - e, safe.w, e), box(safe.x, safe.y, e, safe.h),
          box(safe.x + safe.w - e, safe.y, e, safe.h)];
        break;
      }
      case 'free': {
        const free = env.hints && Array.isArray(env.hints.free) ? env.hints.free.filter((b) => b && b.w >= 1 && b.h >= 1) : [];
        boxes = free.length ? free.map((b) => scaled(box(b.x, b.y, b.w, b.h), s)) : [scaled(safe, s)];
        break;
      }
      default: {
        boxes = [scaled(box(-BLEED * D.w, -BLEED * D.h, D.w * (1 + 2 * BLEED), D.h * (1 + 2 * BLEED)), s)];
        frame = true;
      }
    }
    boxes = boxes.map((b) => moved(b, dx, dy)).map((b) => box(b.x, b.y, Math.max(1, b.w), Math.max(1, b.h)));
    if (ring) { ring.cx += dx; ring.cy += dy; }
    if (avoid) avoid = moved(avoid, dx, dy);
    return { boxes, ring, avoid, frame };
  }

  // The region each of n items falls in: in proportion to the regions' areas, in order (deterministic).
  function regionIndex(boxes, n) {
    const out = new Uint8Array(n);
    if (boxes.length < 2) return out;
    const area = boxes.map((b) => b.w * b.h), total = area.reduce((a, b) => a + b, 0) || 1;
    let acc = 0, r = 0;
    for (let j = 0; j < n; j++) {
      while (r < boxes.length - 1 && (j + 0.5) / n > (acc + area[r]) / total) { acc += area[r]; r++; }
      out[j] = r;
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Items as nodes: shapes, frames, fills, patterns and media move by one behaviour per layer (movers and appear)
  // ---------------------------------------------------------------------------------------------------------------

  // Items [from, to) of one layer. Scale and grow turn about (px, py); a wipe grows from (left, py).
  function runItems(P, t, b) {
    const k = b.apOn ? appearK(b, t) : 1;
    const mv = b.mv;
    for (let j = 0; j < b.n; j++) {
      const i = b.from + j;
      if (b.apOn) {
        if (b.apDraw === DRAW.fade) P.alpha[i] *= k;
        else if (b.apDraw === DRAW.grow) { P.px[i] = b.px[j]; P.py[i] = b.py[j]; P.sx[i] *= k; P.sy[i] *= k; }
        else if (b.apDraw === DRAW.wipe) { P.px[i] = b.left[j]; P.py[i] = b.py[j]; P.sx[i] *= k; }
        else if (k < 1) P.alpha[i] = 0;
      }
      for (let q = 0; q < mv.m; q++) {
        const w = moverWave(mv, q, t, mv.ph[j * mv.m + q]);
        const v = mv.amp[q] * w;
        switch (mv.what[q]) {
          case 0: P.x[i] += v * b.short; break;
          case 1: P.y[i] += v * b.short; break;
          case 2: P.rot[i] += v * DEG; break;
          case 3: {
            const s = 1 + v > 0 ? 1 + v : 0;
            if (!(b.apOn && b.apDraw === DRAW.wipe && k < 1)) { P.px[i] = b.px[j]; P.py[i] = b.py[j]; }
            P.sx[i] *= s; P.sy[i] *= s;
            break;
          }
          default: P.alpha[i] *= alphaFactor(mv, q, w);
        }
      }
    }
  }

  // One behaviour over the item nodes [from, from + n) when the layer has movers or an appear; pivots per item.
  function itemsBehaviour(env, layer, from, n, pivots, ctx) {
    const ap = appearOf(env, layer.appear, ctx.big);
    if (!ap.apOn && !list(layer.move).length) return;
    const mv = moversOf(env, layer, n, ctx.rng, ctx.win);
    env.sb.behave(Object.assign({ phase: K.PH.ORNAMENT, live: 'always', from, to: from + n, t0: ctx.win[0], t1: ctx.win[1],
      run: runItems, n, mv, short: env.D.short, px: pivots.px, py: pivots.py, left: pivots.left }, ap));
  }

  function pivotsOf(n) { return { px: new Float32Array(n), py: new Float32Array(n), left: new Float32Array(n) }; }

  function shapeLayer(env, layer, ctx) {
    const n = layer.count;
    if (!(n > 0)) return;
    const { sb, D } = env, short = D.short, rng = ctx.rng;
    const spec = SHAPE_LIB[layer.shape] || SHAPE_LIB.dot;
    const region = regionOf(env, layer.place);
    const at = regionIndex(region.boxes, n);
    const pv = pivotsOf(n);
    let first = -1;
    for (let j = 0; j < n; j++) {
      const s = Math.max(MIN_PARTICLE, N.lerp(layer.size[0], layer.size[1], rng.next()) * short);
      let x, y;
      if (region.ring) {
        const a = (TAU * (j + 0.35 * rng.next())) / n - Math.PI / 2;
        x = region.ring.cx + Math.cos(a) * region.ring.rx; y = region.ring.cy + Math.sin(a) * region.ring.ry;
      } else {
        const b = region.boxes[at[j]];
        if (n === 1 || region.boxes.length === n) { x = b.x + b.w / 2; y = b.y + b.h / 2; }
        else {
          const mx = Math.min(b.w / 2, s / 2), my = Math.min(b.h / 2, s / 2);
          x = b.x + mx + rng.next() * (b.w - 2 * mx); y = b.y + my + rng.next() * (b.h - 2 * my);
        }
      }
      const rot = N.lerp(layer.rot[0], layer.rot[1], rng.next()) * DEG;
      const ink = ctx.inks[j % ctx.inks.length];
      const stroke = layer.stroke > 0;
      const node = sb.shape({ layer: ctx.layer, owner: env.owner, path: scaledShape(spec, s), x, y, rot, alpha: ctx.alpha,
        fill: stroke ? null : ink, stroke: stroke ? ink : null, width: Math.max(0.5, layer.stroke * short), cap: 'round' });
      if (first < 0) first = node;
      pv.left[j] = -s / 2;
    }
    itemsBehaviour(env, layer, first, n, pv, ctx);
  }

  // Shapes around the text block (or the safe area): box, brackets, ticks, underline or ring. size[0] is the gap to the
  // text, size[1] the arm of brackets and ticks (short-side shares); the stroke is the line width.
  function frameLayer(env, layer, ctx) {
    const { sb, D } = env, short = D.short;
    const f0 = focusOf(env), gap = layer.size[0] * short * layer.place.spread;
    const f = moved(grown(f0, gap), layer.place.x * D.w, layer.place.y * D.h);
    const x0 = f.x, y0 = f.y, x1 = f.x + f.w, y1 = f.y + f.h, cx = x0 + f.w / 2, cy = y0 + f.h / 2;
    const arm = N.clamp(layer.size[1] * short * 2, 0.02 * short, Math.max(1, Math.min(f.w, f.h) / 2));
    const width = Math.max(1, layer.stroke * short);
    const paths = [];
    switch (layer.style) {
      case 'brackets':
        paths.push(K.shape.poly([x0, y0 + arm, x0, y0, x0 + arm, y0], false), K.shape.poly([x1 - arm, y0, x1, y0, x1, y0 + arm], false),
          K.shape.poly([x1, y1 - arm, x1, y1, x1 - arm, y1], false), K.shape.poly([x0 + arm, y1, x0, y1, x0, y1 - arm], false));
        break;
      case 'ticks': {
        const L = arm / 2;
        for (const u of [0.25, 0.75]) {
          const x = x0 + f.w * u, y = y0 + f.h * u;
          paths.push(K.shape.line(x, y0, x, y0 - L), K.shape.line(x, y1, x, y1 + L), K.shape.line(x0, y, x0 - L, y),
            K.shape.line(x1, y, x1 + L, y));
        }
        break;
      }
      case 'underline': paths.push(K.shape.line(x0, y1, x1, y1)); break;
      case 'ring': paths.push(K.shape.ellipse(cx, cy, (f.w / 2) * 1.08, (f.h / 2) * 1.16)); break;
      default: paths.push(K.shape.rect(x0, y0, f.w, f.h));
    }
    const pv = pivotsOf(paths.length);
    let first = -1;
    paths.forEach((path, j) => {
      const node = sb.shape({ layer: ctx.layer, owner: env.owner, path, stroke: ctx.inks[j % ctx.inks.length], width, cap: 'square',
        alpha: ctx.alpha });
      if (first < 0) first = node;
      pv.px[j] = cx; pv.py[j] = cy; pv.left[j] = x0;
    });
    itemsBehaviour(env, layer, first, paths.length, pv, ctx);
  }

  // --- fills and patterns (one paint each; still unless a behaviour moves them) ------------------------------------

  function drawFill(g, t, d, q) {
    const b = d.box;
    let grad;
    if (d.radial) {
      grad = g.createRadialGradient(d.cx, d.cy, 0, d.cx, d.cy, d.r);
    } else {
      grad = g.createLinearGradient(d.cx - d.dx, d.cy - d.dy, d.cx + d.dx, d.cy + d.dy);
    }
    for (let k = 0; k < d.stops.length; k++) grad.addColorStop(d.pos[k], q.rgba(d.stops[k], 1));
    g.globalAlpha *= d.alpha;
    g.fillStyle = grad;
    g.fillRect(b.x, b.y, b.w, b.h);
  }

  function fillLayer(env, layer, ctx) {
    const region = regionOf(env, layer.place);
    let b = region.boxes[0];
    if (ctx.kind === 'ground' && region.frame) {
      const cover = box(-BLEED * env.D.w, -BLEED * env.D.h, env.D.w * (1 + 2 * BLEED), env.D.h * (1 + 2 * BLEED));
      if (b.w < cover.w || b.h < cover.h) b = cover;      // a ground fill always covers the bleed
    }
    const a = layer.fill.angle * DEG, L = Math.abs((b.w / 2) * Math.cos(a)) + Math.abs((b.h / 2) * Math.sin(a));
    const stops = layer.fill.stops.map((s) => ctx.inkOf(s[0]));
    const data = { box: b, cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: Math.hypot(b.w, b.h) / 2, radial: layer.fill.type === 'radial',
      dx: Math.cos(a) * L, dy: Math.sin(a) * L, stops, pos: Float32Array.from(layer.fill.stops, (s) => s[1]), alpha: ctx.alpha };
    const node = env.sb.paint({ layer: ctx.layer, bleed: BLEED, animated: false, owner: env.owner, data, draw: drawFill });
    const pv = pivotsOf(1);
    pv.px[0] = data.cx; pv.py[0] = data.cy; pv.left[0] = b.x;
    itemsBehaviour(env, layer, node, 1, pv, ctx);
  }

  const PATTERN = Object.freeze({ dots: 0, stripes: 1, grid: 2, checks: 3, waves: 4 });

  // Repeated marks over the region, turned by the layer's rotation, one path per ink (rows take the inks in turn).
  function drawPattern(g, t, d, q) {
    const a0 = g.globalAlpha;
    const step = q.draft && !d.still ? d.gap * 2 : d.gap;
    const R = d.reach, n = Math.ceil(R / step);
    g.beginPath();
    g.rect(d.bx, d.by, d.bw, d.bh);
    g.clip();
    g.translate(d.cx, d.cy);
    if (d.rot !== 0) g.rotate(d.rot);
    g.globalAlpha = a0 * d.alpha;
    const mark = d.mark;
    for (let c = 0; c < d.inks.length; c++) {
      g.beginPath();
      for (let r = -n + c; r <= n; r += d.inks.length) {
        const y = r * step;
        switch (d.kind) {
          case 0:
            for (let k = -n; k <= n; k++) { const x = k * step + (r & 1 ? step / 2 : 0); g.moveTo(x + mark / 2, y); g.arc(x, y, mark / 2, 0, TAU); }
            break;
          case 1: g.rect(-R, y - mark / 2, 2 * R, mark); break;
          case 2: g.rect(-R, y - mark / 2, 2 * R, mark); g.rect(y - mark / 2, -R, mark, 2 * R); break;
          case 3:
            for (let k = -n + (r & 1); k <= n; k += 2) g.rect(k * step, y, step, step);
            break;
          default: {
            g.moveTo(-R, y);
            for (let x = -R; x <= R; x += step / 4) g.lineTo(x + step / 4, y + Math.sin(((x + step / 4) / step) * TAU) * step * 0.18);
          }
        }
      }
      const col = q.rgba(d.inks[c], 1);
      if (d.kind === 4) { g.strokeStyle = col; g.lineWidth = mark; g.stroke(); } else { g.fillStyle = col; g.fill(); }
    }
    g.globalAlpha = a0;
  }

  function patternLayer(env, layer, ctx) {
    const region = regionOf(env, layer.place);
    const b = region.boxes[0], short = env.D.short;
    const ap = appearOf(env, layer.appear, true);
    const still = !ap.apOn && !list(layer.move).length;
    let gap = Math.max(layer.gap * short, 2);
    const reach = Math.hypot(b.w, b.h) / 2;
    const cap = still ? PATTERN_MARKS_STILL : PATTERN_MARKS;
    const marks = (reach / gap) * (reach / gap) * 4;
    if (marks > cap) gap *= Math.sqrt(marks / cap);        // a very fine pattern is coarsened (deterministically)
    const data = { bx: b.x, by: b.y, bw: b.w, bh: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2, reach, gap, rot: layer.rot[0] * DEG,
      kind: PATTERN[layer.pattern],
      mark: N.clamp(layer.size[1] * short, 1, gap * 0.9), inks: ctx.inks, alpha: ctx.alpha, still };
    const node = env.sb.paint({ layer: ctx.layer, bleed: BLEED, animated: false, owner: env.owner, data, draw: drawPattern });
    const pv = pivotsOf(1);
    pv.px[0] = data.cx; pv.py[0] = data.cy; pv.left[0] = b.x;
    itemsBehaviour(env, layer, node, 1, pv, ctx);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Flow layers: particles, lines and glyphs — one paint, closed form in t, filled in batches (per ink and alpha step)
  // ---------------------------------------------------------------------------------------------------------------

  const FLOW = Object.freeze({ particles: 0, lines: 1, glyphs: 2 });
  const BURST = Object.freeze({ none: 0, beat: 1, impact: 2, arrive: 3 });

  // Positions, sizes, turns and alphas of every item at t into the paint's scratch columns (X, Y, S, RT, A) and the
  // alpha step of each (Bk, with a bit per ink in `used`). Only the columns are written: nothing survives the frame.
  function placeFlow(d, t, k) {
    const mv = d.mv, m = mv.m;
    for (let c = 0; c < d.used.length; c++) d.used[c] = 0;
    for (let j = 0; j < d.n; j++) {
      const r = d.ri[j];
      let x, y, a = 1, rot, s = d.sz[j];
      if (d.burst) {
        const tb = d.burstBeat ? t - since(t, d.period, d.offset) : d.burstT;
        const tau = t - tb;
        if (!(tau >= 0 && tau <= d.life)) { d.A[j] = 0; d.Bk[j] = 0; continue; }
        x = d.px[j] + d.bvx[j] * tau + 0.5 * d.gx * tau * tau;
        y = d.py[j] + d.bvy[j] * tau + 0.5 * d.gy * tau * tau;
        a = Math.min(1, tau / d.attack) * (1 - tau / d.life);
        rot = d.r0[j] + d.spin * d.spn[j] * tau;
      } else {
        const sw = d.sway * d.swa[j] * Math.sin(d.swp[j] + TAU * d.swayHz * d.swf[j] * t);
        x = d.px[j] + d.vx * d.sp[j] * t + d.nx * sw;
        y = d.py[j] + d.vy * d.sp[j] * t + d.ny * sw;
        const wx = d.rx[r] - s, ww = d.rw[r] + 2 * s, wy = d.ry[r] - s, wh = d.rh[r] + 2 * s;
        x = wx + N.wrap(x - wx, 0, ww);
        y = wy + N.wrap(y - wy, 0, wh);
        if (d.edge) {
          const e = Math.min(x - d.rx[r], d.rx[r] + d.rw[r] - x, y - d.ry[r], d.ry[r] + d.rh[r] - y);
          a *= N.smooth(e / d.fade[r]);
        }
        if (d.lf[j] > 0) a *= Math.sin(Math.PI * N.fract((t + d.off[j]) / d.lf[j]));
        rot = d.r0[j] + d.spin * d.spn[j] * t;
      }
      if (d.avoid) {
        const v = d.avoid;
        const out = Math.max(v.x - x, x - v.x - v.w, v.y - y, y - v.y - v.h);
        a *= N.smooth(out / d.avoidFade);
      }
      for (let q = 0; q < m; q++) {
        const w = moverWave(mv, q, t, mv.ph[j * m + q]);
        const v = mv.amp[q] * w;
        switch (mv.what[q]) {
          case 0: x += v * d.short; break;
          case 1: y += v * d.short; break;
          case 2: rot += v * DEG; break;
          case 3: s *= 1 + v > 0 ? 1 + v : 0; break;
          default: a *= alphaFactor(mv, q, w);
        }
      }
      if (d.apDraw === DRAW.fade) a *= k;
      else if (d.apDraw === DRAW.grow) s *= k;
      else if (d.apDraw === DRAW.wipe) a *= N.clamp((k * (1 + WIPE_SOFT) - (x - d.rx[r]) / d.rw[r]) / WIPE_SOFT);
      a = a > 1 ? 1 : a;
      d.X[j] = x; d.Y[j] = y; d.S[j] = s; d.RT[j] = rot; d.A[j] = a;
      const bk = s > 0 ? Math.round(a * BUCKETS) : 0;
      d.Bk[j] = bk;
      if (bk > 0) d.used[j % d.inkCount] |= 1 << bk;
    }
  }

  function drawFlow(g, t, d, q) {
    const k = d.apOn ? appearK(d, t) : 1;
    if (!(k > 0)) return;
    placeFlow(d, t, k);
    const a0 = g.globalAlpha;
    if (d.prim === FLOW.glyphs) {
      g.font = GLYPH_FONT;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let c = 0; c < d.inkCount; c++) {
        if (!d.used[c]) continue;
        g.fillStyle = q.rgba(d.inks[c], 1);
        for (let j = c; j < d.n; j += d.inkCount) {
          if (!(d.Bk[j] > 0)) continue;
          const sc = d.S[j] / GLYPH_PX;
          g.globalAlpha = a0 * d.alpha * d.A[j];
          g.save();
          g.translate(d.X[j], d.Y[j]);
          if (d.RT[j] !== 0) g.rotate(d.RT[j]);
          g.scale(sc, sc);
          g.fillText(d.glyph, 0, 0);
          g.restore();
        }
      }
      g.globalAlpha = a0;
      return;
    }
    const lines = d.prim === FLOW.lines;
    if (lines) { g.lineWidth = d.width; g.lineCap = 'round'; }
    for (let c = 0; c < d.inkCount; c++) {
      const used = d.used[c];
      if (!used) continue;
      const col = q.rgba(d.inks[c], 1);
      if (lines) g.strokeStyle = col; else g.fillStyle = col;
      for (let bk = 1; bk <= BUCKETS; bk++) {
        if (!(used & (1 << bk))) continue;
        g.globalAlpha = a0 * d.alpha * (bk / BUCKETS);
        g.beginPath();
        for (let j = c; j < d.n; j += d.inkCount) {
          if (d.Bk[j] !== bk) continue;
          if (lines) {
            const hx = Math.cos(d.RT[j]) * d.S[j] / 2, hy = Math.sin(d.RT[j]) * d.S[j] / 2;
            g.moveTo(d.X[j] - hx, d.Y[j] - hy);
            g.lineTo(d.X[j] + hx, d.Y[j] + hy);
          } else addShape(g, d.shape, d.X[j], d.Y[j], d.S[j], d.RT[j]);
        }
        if (lines) g.stroke(); else g.fill();
      }
    }
    g.globalAlpha = a0;
  }

  // Burst times: 'beat' on every beat (every other one and so on for a large layer, the flash rule), 'arrive' once at
  // the sung start (the start of a ground or atmosphere), 'impact' at the sung start of an impact line (else as arrive).
  function burstOf(env, field, big) {
    const code = BURST[field.burst];
    const out = { burst: code !== BURST.none, burstBeat: code === BURST.beat, burstT: env.cut ? N.clamp(0, env.times.a, env.times.b) : 0,
      period: NO_GRID, offset: 0 };
    if (out.burstBeat) Object.assign(out, beatTrain(env, big));
    return out;
  }

  function flowLayer(env, layer, ctx) {
    const share = ctx.share;
    const n = Math.round(layer.count * share);
    if (!(n > 0)) return;
    const { D } = env, short = D.short, rng = ctx.rng, f = layer.field;
    const prim = FLOW[layer.prim];
    const region = regionOf(env, layer.place);
    const boxes = region.boxes;
    const ri = regionIndex(boxes, n);
    const arr = () => new Float32Array(n);
    const dir = f.dir * DEG, speed = f.speed * short;
    const burst = burstOf(env, f, ctx.big);
    const life = burst.burst ? Math.min(f.life[1] > 0 ? Math.max(MIN_LIFE, f.life[1]) : BURST_LIFE,
      burst.burstBeat ? 0.95 * burst.period : Infinity) : 0;
    const d = Object.assign({
      n, prim, shape: SHAPE_LIB[layer.shape] || SHAPE_LIB.dot, glyph: layer.glyph || '', inks: ctx.inks, inkCount: ctx.inks.length,
      alpha: ctx.alpha, short, width: 1, ri,
      rx: Float32Array.from(boxes, (b) => b.x), ry: Float32Array.from(boxes, (b) => b.y), rw: Float32Array.from(boxes, (b) => b.w),
      rh: Float32Array.from(boxes, (b) => b.h), fade: Float32Array.from(boxes, (b) => Math.max(1, EDGE_FADE * Math.min(b.w, b.h))),
      edge: !region.frame, avoid: region.avoid, avoidFade: 0.04 * short,
      px: arr(), py: arr(), sz: arr(), r0: arr(), sp: arr(), swa: arr(), swp: arr(), swf: arr(), spn: arr(), off: arr(), lf: arr(),
      bvx: arr(), bvy: arr(),
      vx: Math.cos(dir) * speed, vy: Math.sin(dir) * speed, nx: -Math.sin(dir), ny: Math.cos(dir), sway: f.sway,
      swayHz: f.swayHz, spin: f.spin * DEG, life, attack: ctx.big ? 0.15 : ATTACK,
      gx: Math.cos(dir) * speed * 1.2, gy: Math.sin(dir) * speed * 1.2,
      X: arr(), Y: arr(), S: arr(), RT: arr(), A: arr(), Bk: new Uint8Array(n), used: new Uint32Array(ctx.inks.length),
      mv: moversOf(env, layer, n, rng.fork('movers'), ctx.win),
    }, burst, appearOf(env, layer.appear, ctx.big));
    let widest = 0;
    for (let j = 0; j < n; j++) {
      const b = boxes[ri[j]];
      const s = Math.max(MIN_PARTICLE, N.lerp(layer.size[0], layer.size[1], rng.next()) * short);
      d.sz[j] = s;
      widest = Math.max(widest, s);
      if (burst.burst) {
        const jitter = 0.1;
        d.px[j] = b.x + b.w * (0.5 + (rng.next() - 0.5) * 2 * jitter);
        d.py[j] = b.y + b.h * (0.5 + (rng.next() - 0.5) * 2 * jitter);
        const th = rng.next() * TAU, v = speed * (0.5 + rng.next());
        d.bvx[j] = Math.cos(th) * v; d.bvy[j] = Math.sin(th) * v;
        if (!(speed > 0)) { d.px[j] = b.x + rng.next() * b.w; d.py[j] = b.y + rng.next() * b.h; }
      } else {
        d.px[j] = b.x + rng.next() * b.w;
        d.py[j] = b.y + rng.next() * b.h;
      }
      d.r0[j] = prim === FLOW.lines ? dir : N.lerp(layer.rot[0], layer.rot[1], rng.next()) * DEG;
      d.sp[j] = 0.7 + 0.6 * rng.next();
      d.swa[j] = 0.6 + 0.8 * rng.next();
      d.swp[j] = rng.next() * TAU;
      d.swf[j] = 0.8 + 0.4 * rng.next();
      d.spn[j] = prim === FLOW.lines ? 0 : (rng.next() < 0.5 ? -1 : 1) * (0.5 + rng.next());
      const lf = f.life[1] > 0 ? Math.max(MIN_LIFE, N.lerp(f.life[0], f.life[1], rng.next())) : 0;
      d.lf[j] = burst.burst ? 0 : lf;
      d.off[j] = rng.next() * (lf || 1);
    }
    if (prim === FLOW.lines) d.width = N.clamp(0.06 * widest, 1, 8);
    const moving = d.burst || speed > 0 || f.sway > 0 || f.spin !== 0 || d.lf.some((v) => v > 0) || d.mv.m > 0 || d.apOn;
    env.sb.paint({ layer: ctx.layer, bleed: BLEED, animated: moving, owner: env.owner, data: d, draw: drawFlow });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Media layers (§11.5.8): drawn through K.media when the kit has it (package B); skipped otherwise
  // ---------------------------------------------------------------------------------------------------------------

  function maskOf(shape, b) {
    const r = Math.min(b.w, b.h);
    switch (shape) {
      case 'round': return K.shape.rect(b.x, b.y, b.w, b.h, MEDIA_ROUND * r);
      case 'circle': return K.shape.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2);
      case 'arch': {
        const rr = b.w / 2, top = b.y + Math.min(rr, b.h / 2);
        return K.shape.path([['M', b.x, b.y + b.h], ['L', b.x, top], ['A', b.x + rr, top, rr, Math.PI, 2 * Math.PI],
          ['L', b.x + b.w, b.y + b.h], ['Z']]);
      }
      default: return null;
    }
  }

  function mediaLayer(env, layer, ctx) {
    if (typeof K.media !== 'function') return;
    const src = layer.src;
    if (!src) return;
    const { sb, D } = env, short = D.short;
    const region = regionOf(env, layer.place);
    const rb = region.boxes[0];
    const full = region.frame || ctx.kind === 'ground';
    const side = Math.max(1, layer.size[1] * short);
    const w = full ? D.w * layer.place.spread : side, h = full ? D.h * layer.place.spread : side;
    const cx = full ? D.cx + layer.place.x * D.w : rb.x + rb.w / 2, cy = full ? D.cy + layer.place.y * D.h : rb.y + rb.h / 2;
    const local = box(-w / 2, -h / 2, w, h);
    const group = sb.group({ layer: ctx.layer, owner: env.owner, x: cx, y: cy });
    const mask = maskOf(layer.shape, local);
    // The recipe places the layer itself (its `layer`, movers and appear), which is §11.9.3's `anim`: the picture moves
    // with the camera as placed.
    const p = { src, fit: layer.fit, cropZoom: 1, cropX: 0.5, cropY: 0.5, edge: 'plain', move: 'none', zoom: 0, pan: 0,
      blur: layer.blur, veil: 0, veilInk: 'ground', tint: 0, tintInk: 'accent', clipIn: layer.time.clipIn,
      clipOut: layer.time.clipOut, speed: layer.time.speed, loop: layer.time.loop, clock: 'show', depth: 'anim', amount: ctx.amount };
    const node = K.media(env, { parent: group, layer: ctx.layer, owner: env.owner, src, box: local, p,
      use: ctx.kind === 'ground' ? 'ground' : region.frame ? 'layer' : 'frame', mask, comp: layer.comp, alpha: ctx.alpha,
      window: ctx.win });
    if (node === -1) return;                             // no such asset in this plan: nothing to frame or move
    if (layer.border > 0) {
      sb.shape({ parent: group, layer: ctx.layer, owner: env.owner, path: mask || K.shape.rect(local.x, local.y, local.w, local.h),
        stroke: ctx.inks[0], width: layer.border, alpha: ctx.alpha });
    }
    const pv = pivotsOf(1);
    pv.left[0] = -w / 2;
    itemsBehaviour(env, layer, group, 1, pv, ctx);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Composite ornaments and grounds: inner parts first, then the layers in order
  // ---------------------------------------------------------------------------------------------------------------

  const LAYER_BUILDERS = Object.freeze({ shape: shapeLayer, frame: frameLayer, fill: fillLayer, pattern: patternLayer,
    particles: flowLayer, lines: flowLayer, glyphs: flowLayer, media: mediaLayer });

  // env.mixShare (§5.9.4, set by the scene build when several materials meet): read as 1 when absent.
  function shareOf(env) {
    const s = env.mixShare ?? 1;
    return isNumber(s) ? N.clamp(s, 0, 1) : 1;
  }

  function winOf(env) { return [env.times.a, Math.max(env.times.a + 1e-3, env.times.b)]; }

  function buildLayers(env, p, R0, kind) {
    const recipe = R.withKnobs(R0, COUNT_PARAM === 'count' || kind !== 'ornament' ? p : Object.assign({}, p, { count: p[COUNT_PARAM] }));
    const amount = num(p.amount, 0.5);
    const slot = typeof p.ink === 'string' && p.ink ? p.ink : 'accent';
    const inkOf = (ink) => (ink === 'slot' ? slot : ink);
    const share = shareOf(env), win = winOf(env);
    const kmax = knobMax(R0);
    list(recipe.layers).forEach((layer, i) => {
      const build = LAYER_BUILDERS[layer.prim];
      if (!build) return;
      const factor = kind === 'ground' ? (layer.prim === 'fill' ? 1 : 0.5 + amount) : 0.4 + 0.6 * amount;
      const inks = list(layer.inks).map(inkOf);
      const ctx = {
        kind, layer: kind === 'ornament' && layer.place.anchor === 'behind' ? 'far' : layer.layer, share, win, amount,
        alpha: N.clamp(layer.alpha * factor), inks: inks.length ? inks : [slot], inkOf,
        rng: RNG.stream(num(env.seed, 0), 'mix', recipe.seed || 0, i, layer.prim),
        big: R0.layers[i] ? coverOf(R0.layers[i], kmax) > LIMITS.flash.cover : false,
      };
      build(env, layer, ctx);
    });
  }

  // The knob multipliers at their maximum for the knobs a recipe has (1 for the others), as core/recipe reads them.
  function knobMax(recipe) {
    const k = { count: 1, size: 1, speed: 1, alpha: 1, amp: 1 };
    for (const knob of list(recipe.knobs)) if (k[knob.what] !== undefined) k[knob.what] = LIMITS.kmax[knob.what];
    return k;
  }

  // The screen share of a layer at knob maximum: the flash rule's `cover`, computed as core/recipe computes it.
  function coverOf(layer, k) {
    if (layer.prim === 'fill' || layer.prim === 'pattern') return 1;
    if (layer.prim === 'frame') return 0.05;
    const hi = layer.size[1] * k.size, lo = layer.size[0] * k.size;
    if (layer.prim === 'media') return hi * hi;
    return Math.ceil(layer.count * k.count) * ((lo * lo + lo * hi + hi * hi) / 3);
  }

  function compositeBuild(recipe, parts, kind) {
    return function build(env, p) {
      parts.forEach((part, i) => part.def.build(innerEnv(env, part, i), innerParams(part, env, p, kind, i)));
      buildLayers(env, p, recipe, kind);
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Inner parts (`parts: [{ key, params }]`): existing base parts of the same kind, their params coerced at derive
  // ---------------------------------------------------------------------------------------------------------------

  function innerEnv(env, part, i) {
    const seed = H.hash32(num(env.seed, 0), 'mix', i, part.def.key);
    return Object.assign({}, env, { key: part.def.key, seed, rng: RNG.stream(seed, 'build', part.def.key) });
  }

  // The inner part's params: its fixed recipe params, the material's shared params (amount, ink, dur, …), autos for
  // the rest (seeded by the scene, like any part's).
  function innerParams(part, env, p, kind, i) {
    const out = {};
    const shared = REG.SHARED[kind] || {};
    const seed = H.hash32(num(env.seed, 0), 'mix', i, part.def.key, 'param');
    const ax = { f: env.feat || {}, look: { amounts: env.amounts || {}, mood: null, bpm: env.grid ? 60 / env.grid.period : null } };
    for (const { name, spec } of part.params) {
      if (part.fixed[name] !== undefined) out[name] = part.fixed[name];
      else if (shared[name] && p[name] !== undefined) out[name] = p[name];
      else out[name] = SCH.autoValue(spec, Object.assign({ rng: RNG.stream(seed, name) }, ax));
    }
    return out;
  }

  // → { parts: [{ def, params, fixed, mix }], problems } for the recipe's parts that exist in the base registry and
  // fit the kind's rules; the others are dropped with a problem.
  function resolveParts(kind, recipe, base, probs) {
    const out = [];
    let framing = 0;
    list(recipe.parts).forEach((pr, i) => {
      const path = 'parts[' + i + ']';
      const def = base.get(kind, pr.key);
      if (!def) { probs.push(problem(path, 'part-missing', { key: pr.key })); return; }
      if (def.gate === 'flash') { probs.push(problem(path, 'part-flash', { key: pr.key })); return; }
      if (kind === 'ornament' && def.scope !== recipe.scope) { probs.push(problem(path, 'part-scope', { key: pr.key })); return; }
      if (kind === 'lens' && def.frames === true && framing++ > 0) { probs.push(problem(path, 'part-frames', { key: pr.key })); return; }
      const params = base.params(kind, pr.key) || [];
      const fixed = {};
      for (const name of Object.keys(pr.params || {})) {
        const entry = params.find((x) => x.name === name);
        const v = entry ? SCH.coerce(entry.spec, pr.params[name]) : undefined;
        if (v === undefined) probs.push(problem(path + '.params.' + name, 'part-param', { key: pr.key, name }));
        else fixed[name] = v;
      }
      out.push({ def, params, fixed, mix: kind === 'filter' ? num(list(recipe.mix)[i], 1) : 1, index: i });
    });
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Entrances and exits: tracks per glyph (word, line) through the kit's motion adapter
  // ---------------------------------------------------------------------------------------------------------------

  const EM_COLS = Object.freeze(['x', 'y', 'z', 'blur']);
  const MUL_COLS = Object.freeze(['sx', 'sy', 'alpha', 'reveal']);
  const IDENTITY = Object.freeze({ alpha: 1, reveal: 1, sx: 1, sy: 1 });

  // The delta pose of one glyph from the material's tracks (p.mix, compiled per build): k = the eased progress of the
  // kit (the material's `ease`), a column curve replaces it for its column.
  function glyphTracks(D, g, k, u, p) {
    const m = p.mix;
    for (let q = 0; q < m.n; q++) {
      const kk = m.curve[q] ? m.curve[q](u) : k;
      let v = m.from[q] + (m.to[q] - m.from[q]) * kk;
      if (m.em[q]) v *= g.em;
      const c = m.col[q];
      if (m.mul[q]) D[c] *= v; else D[c] += v;
    }
  }

  const UNIT_MAKERS = Object.freeze(Object.fromEntries(['arrive', 'depart'].map((kind) => [kind, Object.freeze(
    Object.fromEntries(['glyph', 'word', 'line'].map((unit) => [unit, BH.glyphMotionMaker(kind, { unit, fn: glyphTracks })])))])));

  // Tracks compiled for a build; `amp` (the knob) scales every track's distance from the identity pose.
  function tracksOf(motion, amp) {
    const tr = motion.tracks, n = tr.length, k = isNumber(amp) ? Math.max(0, amp) : 1;
    const out = { n, col: tr.map((t) => t.col), from: new Float64Array(n), to: new Float64Array(n), em: new Uint8Array(n),
      mul: new Uint8Array(n), curve: tr.map((t) => (motion.colCurve[t.col] ? CV.fn(motion.colCurve[t.col]) : null)) };
    tr.forEach((t, q) => {
      const id = IDENTITY[t.col] === undefined ? 0 : IDENTITY[t.col];
      out.from[q] = id + (t.from - id) * k;
      out.to[q] = id + (t.to - id) * k;
      out.em[q] = EM_COLS.includes(t.col) ? 1 : 0;
      out.mul[q] = MUL_COLS.includes(t.col) ? 1 : 0;
    });
    return out;
  }

  // The motion of a depart that mirrors an arrive material (the K.mirror rule, by data): tracks swap ends, column
  // curves reverse.
  function mirroredMotion(motion) {
    const colCurve = {};
    for (const col of Object.keys(motion.colCurve)) colCurve[col] = CV.reverse(motion.colCurve[col]);
    return Object.assign({}, motion, { tracks: motion.tracks.map((t) => ({ col: t.col, from: t.to, to: t.from })), colCurve,
      curve: CV.reverse(motion.curve) });
  }

  function motionMake(kind, motion, parts) {
    const maker = motion ? UNIT_MAKERS[kind][motion.unit] || UNIT_MAKERS[kind].glyph : null;
    return function make(env, target, p) {
      const out = [];
      if (maker) for (const b of maker(env, target, Object.assign({}, p, { mix: tracksOf(motion, p.amp) }))) out.push(b);
      parts.forEach((part, i) => {
        for (const b of part.def.make(innerEnv(env, part, i), target, innerParams(part, env, p, kind, i)) || []) out.push(b);
      });
      return out;
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Holds and cameras: oscillators (§5.7.5)
  // ---------------------------------------------------------------------------------------------------------------

  const OSC_COL = Object.freeze({ x: 0, y: 1, rot: 2, sx: 3, alpha: 4, glow: 5, tint: 6, roll: 7, zoom: 8 });

  function oscOf(osc, amp, scale, seed) {
    const n = osc.length;
    return { n, col: Uint8Array.from(osc, (o) => OSC_COL[o.col]), amp: Float32Array.from(osc, (o) => o.amp * amp * scale),
      hz: Float32Array.from(osc, (o) => o.hz), wave: Uint8Array.from(osc, (o) => WAVE[o.wave]),
      phase: Uint8Array.from(osc, (o) => PHASE[o.phase] || 0), step: Float32Array.from(osc, (o) => o.step || 0), seed };
  }

  // Dwell: fn(D, g, time since the glyph arrived, envelope w, p, fc). Every amplitude is multiplied by w (no pops).
  function oscHold(D, g, time, w, p, fc) {
    const o = p.mix;
    for (let q = 0; q < o.n; q++) {
      const ph = o.phase[q] === PHASE.index ? g.index * o.step[q] : o.phase[q] === PHASE.word ? g.word * o.step[q]
        : o.phase[q] === PHASE.rnd ? g.rnd : 0;
      let wv, uni;
      if (o.wave[q] === WAVE.beat) {
        wv = fc.beat ? Math.exp(-fc.beat.since / BEAT_DECAY) : pulse(fc.tl, NO_GRID, 0);
        uni = wv;
      } else {
        wv = periodic(o.wave[q], o.hz[q] * time * o.speed + ph, o.seed + q);
        uni = (wv + 1) / 2;
      }
      const a = o.amp[q] * w;
      switch (o.col[q]) {
        case 0: D.x += a * wv * g.em; break;
        case 1: D.y += a * wv * g.em; break;
        case 2: D.rot += a * wv; break;
        case 3: { const s = 1 + a * wv; D.sx *= s > 0 ? s : 0; D.sy *= s > 0 ? s : 0; break; }
        case 4: D.alpha *= N.clamp(1 - Math.abs(a) * (1 - uni)); break;
        case 5: D.glow += Math.abs(a) * uni; break;
        default: D.tint += Math.abs(a) * uni;
      }
    }
  }

  const OSC_HOLD = BH.holdMaker(oscHold);

  function dwellMake(osc, parts) {
    return function make(env, target, p) {
      const out = [];
      if (osc.length) {
        const k = isNumber(p.amp) ? Math.max(0, p.amp) : 1;
        const mix = oscOf(osc, k, 2 * num(p.amount, 0.5), H.hash32('mix', 'osc', num(env.seed, 0)));
        mix.speed = num(p.speed, 1);
        for (const b of OSC_HOLD(env, target, Object.assign({}, p, { mix }))) out.push(b);
      }
      parts.forEach((part, i) => {
        for (const b of part.def.make(innerEnv(env, part, i), target, innerParams(part, env, p, 'dwell', i)) || []) out.push(b);
      });
      return out;
    };
  }

  // Lens: the camera node's pose (x, y du; roll deg; zoom ×), closed form in t.
  function runLensOsc(P, t, b) {
    const o = b.osc, n = b.from;
    for (let q = 0; q < o.n; q++) {
      const w = o.wave[q] === WAVE.beat ? pulse(t, b.period, b.offset) : periodic(o.wave[q], o.hz[q] * (t - b.t0), o.seed + q);
      const v = o.amp[q] * w;
      switch (o.col[q]) {
        case 0: P.x[n] += v; break;
        case 1: P.y[n] += v; break;
        case 7: P.rot[n] += v * DEG; break;
        default: { const z = 1 + v; P.sx[n] *= z; P.sy[n] *= z; }
      }
    }
  }

  function lensMake(osc, parts) {
    return function make(env, cam, p) {
      const out = [];
      if (osc.length) {
        const k = isNumber(p.amp) ? Math.max(0, p.amp) : 1;
        const train = beatTrain(env, false);
        out.push({ phase: K.PH.LENS, live: 'always', from: cam, to: cam + 1, t0: env.times.a, t1: env.times.b, run: runLensOsc,
          osc: oscOf(osc, k, 0.5 + num(p.amount, 0.5), H.hash32('mix', 'lens', num(env.seed, 0))), period: train.period,
          offset: train.offset });
      }
      parts.forEach((part, i) => {
        for (const b of part.def.make(innerEnv(env, part, i), cam, innerParams(part, env, p, 'lens', i)) || []) out.push(b);
      });
      return out;
    };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Filter stacks: the inner filters' apply, in order, each at the material's amount × its mix
  // ---------------------------------------------------------------------------------------------------------------

  // The stack's apply, bound once per material version. Its memo maps the params object of a decision (the renderer
  // reuses one per decision) to the inner params objects, so a frame allocates nothing.
  function filterApply(inner) {
    const stackParams = new WeakMap();
    return function apply(fx, src, p, t) {
      let own = stackParams.get(p);
      if (!own) { own = inner.map((f) => Object.assign({}, f.fixed, { when: 'always' })); stackParams.set(p, own); }
      const amount = num(p.amount, 0.5);
      let cur = src;
      for (let i = 0; i < inner.length; i++) {
        const q = own[i];
        q.amount = N.clamp(amount * inner[i].mix);
        const out = inner[i].def.apply(fx, cur, q, t);
        if (out !== cur && cur !== src) fx.give(cur);
        cur = out;
      }
      return cur;
    };
  }

  // Inner filter params resolved once per material version (autos from a stream of the recipe hash, neutral features).
  function filterParts(parts, rhash) {
    return parts.map((part, i) => {
      const fixed = {};
      for (const { name, spec } of part.params) {
        fixed[name] = part.fixed[name] !== undefined ? part.fixed[name]
          : SCH.autoValue(spec, { f: {}, look: { amounts: {}, mood: null, bpm: null }, rng: RNG.stream(rhash, 'mix', i, name) });
      }
      return { def: part.def, fixed, mix: part.mix };
    });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // derive(entry, base, ctx?) → { def | null, problems }
  // ---------------------------------------------------------------------------------------------------------------

  const NEEDS_OF_COL = Object.freeze({ blur: 'blur', rx: 'depth', ry: 'depth', z: 'depth', reveal: 'mask' });

  function labelsOf(entry) {
    const ja = entry.name.ja.trim();
    const en = typeof entry.name.en === 'string' && entry.name.en.trim() ? entry.name.en.trim() : ja;
    const b = isObject(entry.blurb) ? entry.blurb : {};
    const bja = typeof b.ja === 'string' && b.ja.trim() ? b.ja.trim() : ja;
    const ben = typeof b.en === 'string' && b.en.trim() ? b.en.trim() : en === ja ? bja : en;
    return { label: { ja, en }, blurb: { ja: bja, en: ben } };
  }

  function common(entry, key, extra) {
    const { label, blurb } = labelsOf(entry);
    return Object.assign({ key, label, blurb, tags: Array.isArray(entry.tags) ? entry.tags.slice() : [],
      season: entry.season || null, pool: typeof entry.pool === 'boolean' ? entry.pool : entry.by === 'user' }, extra);
  }

  function needsOf(recipe, parts) {
    const out = new Set();
    for (const part of parts) for (const n of part.def.needs || []) out.add(n);
    const beat = (m) => m.wave === 'beat';
    for (const l of list(recipe.layers)) {
      if (list(l.move).some(beat) || (l.appear && l.appear.at === 'beat') || (l.field && l.field.burst === 'beat')) out.add('beats');
      if (l.prim === 'media') out.add('media');
    }
    if (list(recipe.osc).some((o) => o.wave === 'beat')) out.add('beats');
    if (recipe.motion) for (const t of recipe.motion.tracks) if (NEEDS_OF_COL[t.col]) out.add(NEEDS_OF_COL[t.col]);
    return [...out].filter((n) => REG.NEEDS.includes(n)).sort();
  }

  function mediaIdsOf(recipe) {
    const ids = [];
    for (const l of list(recipe.layers)) if (l.prim === 'media' && l.src && !ids.includes(l.src)) ids.push(l.src);
    return ids.sort();
  }

  // The variant of a base part (§5.7.2): params coerced through the base's own specs, shared autos through the kind's
  // shared specs (as the base narrows them).
  function variantDef(kind, recipe, base, fields, probs) {
    const baseDef = base.get(kind, recipe.base);
    if (!baseDef) { probs.push(problem('base', 'no-base', { key: recipe.base })); return null; }
    if (baseDef.gate === 'flash') { probs.push(problem('base', 'flash-base', { key: recipe.base })); return null; }
    const params = {};
    for (const name of Object.keys(recipe.params)) {
      const spec = baseDef.params && baseDef.params[name];
      const v = spec ? SCH.coerce(spec, recipe.params[name]) : undefined;
      if (v === undefined) probs.push(problem('params.' + name, 'param', { name }));
      else params[name] = { auto: { value: v } };
    }
    const shared = {};
    for (const name of Object.keys(recipe.shared)) {
      const spec = Object.assign({}, REG.SHARED[kind][name], (baseDef.shared && baseDef.shared[name]) || {});
      const v = REG.SHARED[kind][name] ? SCH.coerce(spec, recipe.shared[name].value) : undefined;
      if (v === undefined) probs.push(problem('shared.' + name, 'param', { name }));
      else shared[name] = { auto: { value: v } };
    }
    return K.variant(baseDef, Object.assign(fields, { family: 'mine', params, shared }));
  }

  // The knob params of a composite (§5.7.6), the ornament count knob named as the registry allows (COUNT_PARAM).
  function knobParams(kind, recipe) {
    const specs = R.knobSpecs(kind, recipe);
    if (kind !== 'ornament' || COUNT_PARAM === 'count' || !specs.count) return specs;
    const out = {};
    for (const name of Object.keys(specs)) out[name === 'count' ? COUNT_PARAM : name] = specs[name];
    return out;
  }

  function compositeDef(kind, recipe, parts, fields, info) {
    const params = knobParams(kind, recipe);
    const needs = needsOf(recipe, parts);
    const base = Object.assign(fields, { family: 'mine', weight: 1, needs, params });
    switch (kind) {
      case 'ornament':
        return K.ornament(Object.assign(base, { scope: recipe.scope, follow: recipe.follow, build: compositeBuild(recipe, parts, kind) }));
      case 'ground':
        return K.ground(Object.assign(base, { animated: true, build: compositeBuild(recipe, parts, kind) }));
      case 'arrive':
      case 'depart': {
        const motion = info.motion;
        const shared = {};
        if (motion) {
          shared.dur = { auto: { range: motion.dur.slice() } };
          shared.each = { auto: { range: motion.each.slice() } };
          shared.ease = { auto: { value: motion.curve } };
          if (!info.mirror) shared.order = { auto: motion.order.length > 1 ? { pick: motion.order.slice() } : { value: motion.order[0] } };
        } else if (parts[0] && parts[0].def.shared) Object.assign(shared, parts[0].def.shared);
        const unit = motion ? motion.unit : (parts[0] && parts[0].def.unit) || 'glyph';
        return K[kind](Object.assign(base, { unit, shared, make: motionMake(kind, motion, parts) }));
      }
      case 'dwell':
        return K.dwell(Object.assign(base, { make: dwellMake(recipe.osc, parts) }));
      case 'lens':
        return K.lens(Object.assign(base, { frames: parts.some((x) => x.def.frames === true),
          warp: !parts.some((x) => x.def.warp === false), make: lensMake(recipe.osc, parts) }));
      default: {
        const inner = filterParts(parts, info.seed);
        const gate = (parts.find((x) => x.def.gate) || { def: {} }).def.gate;
        return K.filter(Object.assign(base, gate ? { gate } : {}, {
          stage: parts[0].def.stage, cost: Math.max(1, Math.min(5, parts.reduce((a, x) => a + (x.def.cost || 1), 0))),
          passes: parts.reduce((a, x) => a + (x.def.passes || 0), 0), alphaSafe: parts.every((x) => x.def.alphaSafe === true),
          apply: filterApply(inner) }));
      }
    }
  }

  // The work of derive: entry checks, normalize, the base or inner parts, the limits of core/recipe, the kit definition.
  // ctx = { list?: MaterialEntry[] (for mirrorOf), media?: doc.media, key?: an explicit key (sampleDefs), base (set by
  // deriveCached), memo?: a Map id → derived result of the entries before this one (registryFor) }.
  function deriveWith(entry, base, ctx) {
    const c = ctx || {};
    const head = R.entryProblems(entry);
    if (head.length) return { def: null, problems: head, recipe: null };
    if (!base || typeof base.get !== 'function') return { def: null, problems: [problem('', 'no-registry', {})], recipe: null };
    const kind = entry.kind;
    const up = R.upgrade(entry.recipe, entry.rv === undefined ? R.RECIPE_V : entry.rv);
    if (!up) return { def: null, problems: [problem('rv', 'rv-newer', { rv: entry.rv })], recipe: null };
    const norm = R.normalize(kind, up.recipe);
    const probs = norm.problems.slice();
    const recipe = norm.recipe;
    const key = c.key || 'myMat' + entry.id.slice(1);
    const media = c.media || null;
    let rhash = H.hashJSON(recipe);
    const fail = () => ({ def: null, problems: probs, recipe });
    let def = null, mine = null;
    try {
      if (Object.prototype.hasOwnProperty.call(recipe, 'base')) {
        if (!recipe.base) { probs.push(problem('base', 'no-base', {})); return fail(); }
        mine = { id: entry.id, rhash, cost: R.cost(kind, recipe, { registry: base, media }), by: entry.by, media: [] };
        def = variantDef(kind, recipe, base, common(entry, key, { mine }), probs);
        if (!def) return fail();
      } else {
        let effective = recipe, info = { motion: recipe.motion || null, mirror: false, seed: 0 };
        let parts;
        if (kind === 'depart' && recipe.mirrorOf) {
          const src = mirrorSource(entry, c);
          if (!src) { probs.push(problem('mirrorOf', 'mirror-missing', { id: recipe.mirrorOf })); return fail(); }
          info = { motion: src.recipe.motion ? mirroredMotion(src.recipe.motion) : null, mirror: true, seed: 0 };
          parts = mirroredParts(src, base, probs);
          rhash = H.hashJSON([rhash, src.rhash]);
          if (!info.motion && !parts.length) { probs.push(problem('mirrorOf', 'mirror-missing', { id: recipe.mirrorOf })); return fail(); }
        } else {
          parts = resolveParts(kind, recipe, base, probs);
          if (parts.length !== list(recipe.parts).length) {
            const keep = parts.map((x) => x.index);
            effective = Object.assign({}, recipe, { parts: keep.map((i) => recipe.parts[i]) },
              kind === 'filter' ? { mix: keep.map((i) => recipe.mix[i]) } : {});
          }
        }
        const limits = R.problems(kind, effective, { registry: base, media });
        if (limits.length) { for (const x of limits) probs.push(x); return fail(); }
        info.seed = H.hash32('mix', rhash);
        mine = { id: entry.id, rhash, cost: R.cost(kind, effective, { registry: base, media }), by: entry.by, media: mediaIdsOf(recipe) };
        def = compositeDef(kind, effective, parts, common(entry, key, { mine }), info);
      }
    } catch (e) {
      probs.push(problem('', 'kit', { message: String(e && e.message).slice(0, 200) }));
      return fail();
    }
    return { def, problems: probs, recipe, rhash };
  }

  // The arrive entry a depart mirrors: §5.7.3 wants it earlier in the list than the depart (null otherwise).
  function earlier(entry, entries) {
    const all = list(entries), id = entry.recipe.mirrorOf;
    const at = all.indexOf(entry);
    return all.find((x, i) => isObject(x) && x.id === id && x.kind === 'arrive' && (at < 0 || i < at)) || null;
  }

  // The arrive material a depart mirrors, derived (memo), or null.
  function mirrorSource(entry, c) {
    const src = earlier(entry, c.list);
    if (!src) return null;
    const got = c.memo && c.memo.has(src.id) ? c.memo.get(src.id) : deriveCached(src, c.base, c);
    return got && got.def ? got : null;
  }

  // The mirrored arrive's inner parts, each through K.mirror (an inner part the kit cannot mirror is dropped). Their
  // fixed params follow the mirror's names (an entrance's `yFrom` is the exit's `yTo`).
  function mirroredParts(src, base, probs) {
    const out = [];
    resolveParts('arrive', src.recipe, base, []).forEach((part, i) => {
      try {
        const def = K.mirror(part.def, { key: part.def.key + 'Mirror', label: part.def.label, blurb: part.def.blurb });
        const names = Object.keys(def.params || {});
        const fixed = {};
        for (const name of Object.keys(part.fixed)) {
          const to = name.endsWith('From') && names.includes(name.slice(0, -4) + 'To') ? name.slice(0, -4) + 'To' : name;
          if (names.includes(to) || REG.SHARED.depart[to]) fixed[to] = part.fixed[name];
        }
        out.push({ def, params: mirrorParamList(def), fixed, mix: 1, index: i });
      } catch (e) {
        probs.push(problem('parts[' + i + ']', 'part-mirror', { key: part.def.key }));
      }
    });
    return out;
  }

  // The param list of a K.mirror definition: the depart shared params (as the definition narrows them) and its own.
  function mirrorParamList(def) {
    const out = [];
    const shared = REG.SHARED.depart;
    for (const name of Object.keys(shared)) {
      out.push({ name, spec: Object.assign({}, shared[name], (def.shared && def.shared[name]) || {}) });
    }
    for (const name of Object.keys(def.params || {})) out.push({ name, spec: def.params[name] });
    return out;
  }

  // Per entry: the last derivation (entry identity, base, media and the mirrored entry all equal → the same result).
  const derived = new WeakMap();

  function deriveCached(entry, base, c) {
    if (!isObject(entry)) return deriveWith(entry, base, c);
    const dep = entry.kind === 'depart' && isObject(entry.recipe) && entry.recipe.mirrorOf ? earlier(entry, c.list) : null;
    const media = usesMedia(entry) ? c.media || null : null;
    const hit = derived.get(entry);
    if (hit && hit.base === base && hit.media === media && hit.dep === dep) return hit.result;
    const result = deriveWith(entry, base, Object.assign({}, c, { base }));
    derived.set(entry, { base, media, dep, result });
    return result;
  }

  function usesMedia(entry) {
    return isObject(entry.recipe) && list(entry.recipe.layers).some((l) => isObject(l) && l.prim === 'media');
  }

  // derive(entry, base, ctx?) → { def | null, problems } (§5.9.1). ctx = { list, media } when the entry lives in a
  // document: a depart's `mirrorOf` is looked up in `list`, media layers read `media` (doc.media).
  function derive(entry, base, ctx) {
    const got = deriveCached(entry, base, isObject(ctx) ? ctx : {});
    const problems = got.problems.slice();
    if (!got.def) return { def: null, problems };
    const errs = REG.checkDef(got.def, { mine: true });
    for (const m of errs) problems.push(problem('', 'def', { message: m }));
    return { def: errs.length ? null : got.def, problems };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The user's pooled media as grounds (§11.5.9)
  // ---------------------------------------------------------------------------------------------------------------

  const MEDIA_COST = Object.freeze({ ms: LIMITS.cost.media, particles: 0, nodes: 1, paints: 0, parts: 1, cost: 0, passes: 0, cover: 1 });
  const mediaDefs = new WeakMap();           // asset entry → { base, def }

  function mediaDef(asset, base) {
    const hit = mediaDefs.get(asset);
    if (hit && hit.base === base) return hit.def;
    let def = null;
    const photo = base.get('ground', 'photoPan');
    if (photo && MEDIA.isId(asset.id) && typeof asset.name === 'string' && asset.name.trim()) {
      const name = asset.name.trim();
      const params = { image: { auto: { value: asset.id } } };
      const moving = asset.kind === 'video' || asset.anim === true;
      if (moving && photo.params && photo.params.clock) params.clock = { auto: { value: 'song' } };
      if (moving && photo.params && photo.params.move) params.move = { auto: { value: 'none' } };
      def = K.variant(photo, { key: MEDIA.keyOf(asset.id), label: { ja: name, en: name },
        blurb: { ja: 'マイ素材の写真・動画', en: 'Your photo or video' }, tags: ['soft'], season: null, pool: true, weight: 1.5,
        params, shared: {}, mine: { id: asset.id, rhash: asset.id, cost: MEDIA_COST, by: 'user', media: true } });
    }
    mediaDefs.set(asset, { base, def });
    return def;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // registryFor(base, materials, media?) → Registry (§5.9.2, §11.5.9)
  // ---------------------------------------------------------------------------------------------------------------

  const registries = new WeakMap();          // base → [{ materials, media, registry }] (the last 4)
  const MEMO_MAX = 4;

  function pooled(media) {
    return media && Array.isArray(media.list) ? media.list.filter((a) => isObject(a) && a.pool === true) : [];
  }

  function registryFor(base, materials, media) {
    const entries = materials && Array.isArray(materials.list) ? materials.list : [];
    const assets = pooled(media);
    if (!entries.length && !assets.length) return base;
    let memo = registries.get(base);
    if (!memo) { memo = []; registries.set(base, memo); }
    const hit = memo.find((m) => m.materials === materials && m.media === media);
    if (hit) return hit.registry;
    const defs = [], problems = [];
    const byId = new Map();
    const c = { list: entries, media: media || null, memo: byId };
    for (const entry of entries) {
      const got = deriveCached(entry, base, c);
      if (isObject(entry) && typeof entry.id === 'string') byId.set(entry.id, got);
      if (got.def) { defs.push(got.def); continue; }
      const first = got.problems.find((x) => !['fixed', 'clamped', 'dropped', 'too-many'].includes(x.code)) || got.problems[0];
      const kind = isObject(entry) && typeof entry.kind === 'string' ? entry.kind : '?';
      const key = isObject(entry) && typeof entry.id === 'string' && /^m[0-9a-z]+$/.test(entry.id) ? 'myMat' + entry.id.slice(1) : '?';
      problems.push(kind + '/' + key + ': ' + (first ? first.code : 'bad-entry'));
    }
    const keys = new Set();
    for (const asset of assets) {
      const def = mediaDef(asset, base);
      if (!def) continue;
      if (keys.has(def.key)) { problems.push('ground/' + def.key + ': media-key'); continue; }
      keys.add(def.key);
      defs.push(def);
    }
    const registry = REG.extend(base, defs, { problems });
    memo.push({ materials, media, registry });
    if (memo.length > MEMO_MAX) memo.shift();
    return registry;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // materialHash(entry): the whole normalized entry (stale checks of AI changes)
  // ---------------------------------------------------------------------------------------------------------------

  function materialHash(entry) {
    if (!isObject(entry)) return H.hashJSON(null);
    const kind = R.MAT_KINDS.includes(entry.kind) ? entry.kind : null;
    const text = (v) => (typeof v === 'string' ? v : '');
    const out = {
      id: text(entry.id), kind, by: entry.by === 'ai' ? 'ai' : entry.by === 'user' ? 'user' : null,
      name: isObject(entry.name) ? { ja: text(entry.name.ja), en: text(entry.name.en) } : null,
      blurb: isObject(entry.blurb) ? { ja: text(entry.blurb.ja), en: text(entry.blurb.en) } : null,
      tags: Array.isArray(entry.tags) ? entry.tags.slice() : [], season: entry.season || null,
      pool: typeof entry.pool === 'boolean' ? entry.pool : entry.by === 'user', rv: isNumber(entry.rv) ? entry.rv : R.RECIPE_V,
      recipe: kind ? R.normalize(kind, entry.recipe).recipe : null,
    };
    return H.hashJSON(out);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // sampleDefs(base?): one composite per COMPOSITE_KIND and a run ornament (the filter needs a base registry for its
  // inner filters); keys 'myMatS…', which no registry accepts — tests and the lab re-key them
  // ---------------------------------------------------------------------------------------------------------------

  const SAMPLE_FILTERS = Object.freeze(['grainFilm', 'edgeShade']);

  function sampleEntries(base) {
    const E = (id, kind, ja, en, recipe, extra) => Object.assign({ id, kind, by: 'user', name: { ja, en }, tags: ['soft'],
      season: null, pool: true, rv: R.RECIPE_V, recipe }, extra || {});
    const out = [
      E('msorn', 'ornament', '星と音符', 'Stars and notes', { scope: 'cut', follow: 'text', seed: 3, knobs: [{ what: 'count' }, { what: 'amp' }],
        layers: [
          { prim: 'frame', style: 'brackets', inks: ['slot'], size: [0.025, 0.03], stroke: 0.004, layer: 'near',
            appear: { at: 'rest', draw: 'grow', dur: 0.4 } },
          { prim: 'shape', shape: 'star', inks: ['accent', 'shiftB'], count: 6, size: [0.02, 0.035], rot: [-20, 20], layer: 'mid',
            place: { anchor: 'around', spread: 1 }, move: [{ what: 'rot', wave: 'sine', amp: 25, hz: 0.4, phase: 'index' }],
            appear: { at: 'arrive', draw: 'fade', dur: 0.5 } },
          { prim: 'glyphs', glyph: '♪', inks: ['slot', 'muted'], count: 18, size: [0.025, 0.04], layer: 'far',
            place: { anchor: 'free', spread: 1 }, field: { dir: 270, speed: 0.05, sway: 18, swayHz: 0.3, life: [2, 3.5] },
            move: [{ what: 'alpha', wave: 'sine', amp: 0.3, hz: 0.5, phase: 'rnd' }] },
          { prim: 'lines', inks: ['muted'], count: 24, size: [0.04, 0.08], alpha: 0.5, layer: 'far',
            place: { anchor: 'behind', spread: 1.2 }, field: { dir: 20, speed: 0.4 } },
        ] }),
      E('msrun', 'ornament', '桜吹雪', 'Cherry flurry', { scope: 'run', follow: 'own', seed: 7, knobs: [{ what: 'count' }],
        layers: [{ prim: 'particles', shape: 'petal', inks: ['#F4B4C6', 'accent'], alpha: 0.85, layer: 'near',
          place: { anchor: 'frame', x: 0, y: 0, spread: 1.15 }, size: [0.012, 0.022], count: 90, rot: [0, 360],
          field: { dir: 115, speed: 0.09, sway: 26, swayHz: 0.35, spin: 60, life: [0, 0], burst: 'none' },
          move: [{ what: 'scale', wave: 'beat', amp: 0.15, hz: 0, phase: 'rnd' }], appear: { at: 'start', draw: 'fade', dur: 0.6 } }] },
      { season: 'spring' }),
      E('msground', 'ground', '夕暮れの点描', 'Dusk dots', { seed: 5, knobs: [{ what: 'size' }], layers: [
        { prim: 'fill', layer: 'ground', fill: { type: 'linear', angle: 90, stops: [['ground', 0], ['shiftA', 0.7], ['ground2', 1]] } },
        { prim: 'pattern', pattern: 'dots', gap: 0.05, size: [0.006, 0.008], inks: ['ground2'], alpha: 0.5, layer: 'ground',
          rot: [15, 15] },
        { prim: 'particles', shape: 'dot', inks: ['shiftB', 'accent'], count: 30, size: [0.01, 0.03], alpha: 0.35, layer: 'far',
          field: { dir: 280, speed: 0.02, sway: 12, swayHz: 0.2, life: [3, 6] } },
      ] }),
      E('msarrive', 'arrive', 'ふわり回転', 'Soft twirl', { knobs: [{ what: 'amp' }], motion: { unit: 'glyph', curve: 'backOut',
        colCurve: { alpha: 'quadOut' }, dur: [0.4, 0.7], each: [0.02, 0.05], order: ['lead', 'core'],
        tracks: [{ col: 'y', from: 0.6, to: 0 }, { col: 'rot', from: -30, to: 0 }, { col: 'alpha', from: 0, to: 1 },
          { col: 'blur', from: 0.1, to: 0 }] } }),
      E('msdepart', 'depart', '横に流れる', 'Slide away', { motion: { unit: 'word', curve: 'quadIn', dur: [0.3, 0.5],
        each: [0.02, 0.04], order: ['lead'], tracks: [{ col: 'x', from: 0, to: 1.2 }, { col: 'alpha', from: 1, to: 0 },
          { col: 'sx', from: 1, to: 1.3 }] } }),
      E('msdwell', 'dwell', 'ゆらぎ', 'Sway', { knobs: [{ what: 'amp' }], osc: [
        { col: 'y', amp: 0.06, hz: 0.5, wave: 'sine', phase: 'index', step: 0.6 },
        { col: 'rot', amp: 3, hz: 0.3, wave: 'tri', phase: 'word', step: 0.5 },
        { col: 'glow', amp: 0.3, hz: 0, wave: 'beat', phase: 'same' }] }),
      E('mslens', 'lens', '手ぶれと拍', 'Wobble and beat', { osc: [
        { col: 'x', amp: 8, hz: 0.4, wave: 'noise' }, { col: 'y', amp: 6, hz: 0.35, wave: 'noise' },
        { col: 'roll', amp: 0.6, hz: 0.25, wave: 'sine' }, { col: 'zoom', amp: 0.02, hz: 0, wave: 'beat' }] }),
    ];
    if (base) {
      const keys = sampleFilterKeys(base);
      if (keys.length) {
        out.push(E('msfilter', 'filter', '古いフィルム', 'Old film', { parts: keys.map((key) => ({ key, params: {} })),
          mix: keys.map((k, i) => (i ? 0.8 : 0.6)) }));
      }
    }
    return out;
  }

  // Two filters for the sample stack: grainFilm and edgeShade when the base has them, else the first that fit.
  function sampleFilterKeys(base) {
    const ok = (d) => d && d.gate !== 'flash' && !(d.needs || []).includes('textAt');
    const named = SAMPLE_FILTERS.filter((k) => ok(base.get('filter', k)));
    if (named.length === 2) return named;
    const out = [];
    let cost = 0, passes = 0;
    for (const d of base.all('filter')) {
      if (!ok(d) || out.length === 2 || cost + d.cost > LIMITS.filterCost || passes + d.passes > LIMITS.filterPasses) continue;
      out.push(d.key); cost += d.cost; passes += d.passes;
    }
    return out;
  }

  const SAMPLE_KEYS = Object.freeze({ msorn: 'myMatSornament', msrun: 'myMatSatmos', msground: 'myMatSground', msarrive: 'myMatSarrive',
    msdepart: 'myMatSdepart', msdwell: 'myMatSdwell', mslens: 'myMatSlens', msfilter: 'myMatSfilter' });

  function sampleDefs(base) {
    const reg = base && typeof base.get === 'function' ? base : null;
    const host = reg || EMPTY_HOST;
    const out = [];
    for (const entry of sampleEntries(reg)) {
      const got = deriveWith(entry, host, { key: SAMPLE_KEYS[entry.id] });
      if (got.def) out.push(got.def);
    }
    return out;
  }

  // A registry stand-in for sampleDefs() without a base: it has no parts (the samples need none but the filter).
  const EMPTY_HOST = Object.freeze({ get: () => null, has: () => false, params: () => null, all: () => [], keys: () => [] });

  return { SHAPE_LIB, derive, registryFor, materialHash, sampleDefs };
});
