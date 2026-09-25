/* 文字PVメーカー v2 — original work. SceneBuilder: the only way parts create nodes; ShapeSpec codec; particle fields; media nodes (DESIGN §4.17.3; DESIGN_2_1 §11.5.1). */
MV.def('engine/scene/builder', ['core/num', 'core/mat', 'core/script', 'core/media', 'engine/scene/table', 'engine/scene/behave'],
(N, MAT, S, MEDIA, T, BH) => {
  'use strict';

  class BuildError extends Error {
    constructor(code, message) { super(message); this.name = 'BuildError'; this.code = code; }
  }

  const TAU = N.TAU;
  const MAX_PARTICLES = 4000;

  // --- ShapeSpec: { ops: Uint8Array, pts: Float32Array }, engine-owned path data -----------------------------------

  // Op codes and their argument counts. A: arc(cx, cy, r, a0, a1) runs anticlockwise when a1 < a0; E: a full ellipse.
  const OP = Object.freeze({ M: 0, L: 1, Q: 2, C: 3, A: 4, E: 5, R: 6, Z: 7 });
  const OP_ARGS = Object.freeze([2, 2, 4, 6, 5, 4, 4, 0]);
  const OP_NAMES = Object.freeze(['M', 'L', 'Q', 'C', 'A', 'E', 'R', 'Z']);

  function finite(v) { return typeof v === 'number' && Number.isFinite(v); }

  // path([['M', x, y], ['L', x, y], ['Q', cx, cy, x, y], ['C', …6], ['A', cx, cy, r, a0, a1], ['E', cx, cy, rx, ry],
  //       ['R', x, y, w, h], ['Z']]) → ShapeSpec
  function path(cmds) {
    if (!Array.isArray(cmds)) throw new BuildError('bad-shape', 'shape path needs an array of commands');
    const ops = [], pts = [];
    for (const cmd of cmds) {
      const code = Array.isArray(cmd) ? OP[cmd[0]] : undefined;
      if (code === undefined) throw new BuildError('bad-shape', 'unknown shape command ' + JSON.stringify(cmd && cmd[0]));
      if (cmd.length - 1 !== OP_ARGS[code]) throw new BuildError('bad-shape', cmd[0] + ' needs ' + OP_ARGS[code] + ' numbers');
      for (let k = 1; k < cmd.length; k++) {
        if (!finite(cmd[k])) throw new BuildError('bad-shape', cmd[0] + ' has a non-finite number');
        pts.push(cmd[k]);
      }
      ops.push(code);
    }
    return Object.freeze({ ops: Uint8Array.from(ops), pts: Float32Array.from(pts) });
  }

  function rect(x, y, w, h, r) {
    const rr = finite(r) ? Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2)) : 0;
    if (rr === 0) return path([['R', x, y, w, h]]);
    const q = Math.PI / 2;
    return path([['M', x + rr, y], ['L', x + w - rr, y], ['A', x + w - rr, y + rr, rr, -q, 0], ['L', x + w, y + h - rr],
      ['A', x + w - rr, y + h - rr, rr, 0, q], ['L', x + rr, y + h], ['A', x + rr, y + h - rr, rr, q, 2 * q],
      ['L', x, y + rr], ['A', x + rr, y + rr, rr, 2 * q, 3 * q], ['Z']]);
  }

  function ellipse(cx, cy, rx, ry) { return path([['E', cx, cy, Math.abs(rx), Math.abs(ry)]]); }

  function line(x0, y0, x1, y1) { return path([['M', x0, y0], ['L', x1, y1]]); }

  // poly(points, closed): points as a flat list [x0, y0, x1, y1, …] or as pairs [[x0, y0], …].
  function poly(points, closed) {
    const flat = Array.isArray(points) && Array.isArray(points[0]) ? points.flat() : points;
    if (!Array.isArray(flat) && !ArrayBuffer.isView(flat)) throw new BuildError('bad-shape', 'poly needs points');
    const cmds = [];
    for (let k = 0; k + 1 < flat.length; k += 2) cmds.push([k === 0 ? 'M' : 'L', flat[k], flat[k + 1]]);
    if (closed) cmds.push(['Z']);
    return path(cmds);
  }

  function arc(cx, cy, r, a0, a1) { return path([['A', cx, cy, Math.abs(r), a0, a1]]); }

  // Replays a ShapeSpec as Ctx2D path calls (beginPath first; the caller fills and/or strokes).
  function replayShape(g, spec) {
    const ops = spec.ops, p = spec.pts;
    let k = 0;
    g.beginPath();
    for (let i = 0; i < ops.length; i++) {
      switch (ops[i]) {
        case 0: g.moveTo(p[k], p[k + 1]); break;
        case 1: g.lineTo(p[k], p[k + 1]); break;
        case 2: g.quadraticCurveTo(p[k], p[k + 1], p[k + 2], p[k + 3]); break;
        case 3: g.bezierCurveTo(p[k], p[k + 1], p[k + 2], p[k + 3], p[k + 4], p[k + 5]); break;
        case 4: g.arc(p[k], p[k + 1], p[k + 2], p[k + 3], p[k + 4], p[k + 4] < p[k + 3]); break;
        case 5: g.ellipse(p[k], p[k + 1], p[k + 2], p[k + 3], 0, 0, TAU); break;
        case 6: g.rect(p[k], p[k + 1], p[k + 2], p[k + 3]); break;
        default: g.closePath(); break;
      }
      k += OP_ARGS[ops[i]];
    }
  }

  // Conservative bounds [x0, y0, x1, y1] of a ShapeSpec (control points and whole circles count).
  function shapeBounds(spec) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const add = (x, y) => { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; };
    const ops = spec.ops, p = spec.pts;
    let k = 0;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (op <= 3) for (let j = 0; j < OP_ARGS[op]; j += 2) add(p[k + j], p[k + j + 1]);
      else if (op === 4) { add(p[k] - p[k + 2], p[k + 1] - p[k + 2]); add(p[k] + p[k + 2], p[k + 1] + p[k + 2]); }
      else if (op === 5) { add(p[k] - p[k + 2], p[k + 1] - p[k + 3]); add(p[k] + p[k + 2], p[k + 1] + p[k + 3]); }
      else if (op === 6) { add(p[k], p[k + 1]); add(p[k] + p[k + 2], p[k + 1] + p[k + 3]); }
      k += OP_ARGS[op];
    }
    return b[0] <= b[2] ? b : [0, 0, 0, 0];
  }

  function isShape(v) { return !!v && v.ops instanceof Uint8Array && v.pts instanceof Float32Array; }

  // --- particle fields: closed form in t (DESIGN §4.17.3) ----------------------------------------------------------

  function range2(v, lo, hi) {
    return Array.isArray(v) && v.length === 2 && finite(v[0]) && finite(v[1]) ? [v[0], v[1]] : [lo, hi];
  }

  function normalizeField(f) {
    const a = f && f.area;
    if (!a || ![a.x, a.y, a.w, a.h].every(finite)) throw new BuildError('bad-particles', 'particle field needs an area box');
    const num = (v, d) => (finite(v) ? v : d);
    const bursts = f.bursts && Array.isArray(f.bursts.times) && f.bursts.times.length
      ? { times: Float32Array.from(f.bursts.times.filter(finite)), speed: num(f.bursts.speed, 200), gravity: num(f.bursts.gravity, 0) }
      : null;
    return {
      area: { x: a.x, y: a.y, w: Math.max(1e-3, a.w), h: Math.max(1e-3, a.h) },
      vx: num(f.vx, 0), vy: num(f.vy, 0), sway: num(f.sway, 0), swayHz: num(f.swayHz, 0.2), spin: num(f.spin, 0),
      size: range2(f.size, 4, 8), life: range2(f.life, 2, 4), wrap: f.wrap !== false, bursts,
    };
  }

  // Per-particle arrays, drawn once at build from the part's stream.
  function particleData(n, field, rng) {
    const f = normalizeField(field);
    const count = Math.max(0, Math.min(MAX_PARTICLES, Math.floor(n) || 0));
    const arr = () => new Float32Array(count);
    const d = { n: count, field: f, x0: arr(), y0: arr(), sp: arr(), ph: arr(), size: arr(), life: arr(), spin: arr(), off: arr() };
    for (let j = 0; j < count; j++) {
      d.x0[j] = f.area.x + rng.next() * f.area.w;
      d.y0[j] = f.area.y + rng.next() * f.area.h;
      d.sp[j] = 0.6 + 0.8 * rng.next();
      d.ph[j] = rng.next() * TAU;
      d.size[j] = N.lerp(f.size[0], f.size[1], rng.next());
      d.life[j] = Math.max(1e-3, N.lerp(f.life[0], f.life[1], rng.next()));
      d.spin[j] = (rng.next() < 0.5 ? -1 : 1) * (0.5 + rng.next());
      d.off[j] = rng.next() * d.life[j];
    }
    return d;
  }

  // particleAt(data, j, t, out) → out { x, y, size, rot, alpha }; t = local seconds. Drifting particles:
  // p0 + v·t + sway·sin(φ + ω·t), wrapped into the area, fading in and out over their life. Bursts: origin + v·τ + ½·g·τ².
  function particleAt(d, j, t, out) {
    const f = d.field;
    if (f.bursts) return burstAt(d, j, t, out);
    let x = d.x0[j] + f.vx * d.sp[j] * t + f.sway * Math.sin(d.ph[j] + TAU * f.swayHz * t);
    let y = d.y0[j] + f.vy * d.sp[j] * t;
    if (f.wrap) {
      x = f.area.x + N.wrap(x - f.area.x, 0, f.area.w);
      y = f.area.y + N.wrap(y - f.area.y, 0, f.area.h);
    }
    const age = N.fract((t + d.off[j]) / d.life[j]);
    out.x = x; out.y = y; out.size = d.size[j];
    out.rot = d.ph[j] + f.spin * d.spin[j] * t;
    out.alpha = Math.sin(Math.PI * age);
    return out;
  }

  function burstAt(d, j, t, out) {
    const f = d.field, b = f.bursts;
    const tau = t - b.times[j % b.times.length];
    out.size = d.size[j];
    if (!(tau >= 0 && tau <= d.life[j])) {
      out.x = f.area.x + f.area.w / 2; out.y = f.area.y + f.area.h / 2; out.rot = 0; out.alpha = 0;
      return out;
    }
    const v = b.speed * d.sp[j];
    out.x = f.area.x + f.area.w / 2 + Math.cos(d.ph[j]) * v * tau;
    out.y = f.area.y + f.area.h / 2 + Math.sin(d.ph[j]) * v * tau + 0.5 * b.gravity * tau * tau;
    out.rot = f.spin * d.spin[j] * tau;
    out.alpha = 1 - tau / d.life[j];
    return out;
  }

  // --- media records (DESIGN_2_1 §11.5.1, FROZEN record) -----------------------------------------------------------

  const COMPS = Object.freeze(['over', 'atop', 'screen', 'multiply', 'overlay']);
  const SOFT_ZOOM = 1.08;                 // 'soft': the blurred cover copy behind the contained picture (§11.5.2)
  const SOFT_BLUR = 24;
  const SOFT_VEIL = Object.freeze({ ink: 'ground', a: 0.25 });

  function isBoxLike(b) { return !!b && [b.x, b.y, b.w, b.h].every(finite) && b.w >= 0 && b.h >= 0; }

  function inkLayer(v, what) {
    if (v === null || v === undefined) return null;
    if (!v || typeof v.ink !== 'string' || v.ink === '' || !finite(v.a) || v.a < 0 || v.a > 1) {
      throw new BuildError('bad-media', what + ' must be null or { ink, a (0..1) }');
    }
    return Object.freeze({ ink: v.ink, a: v.a });
  }

  function timeOf(v) {
    if (v === null || v === undefined) return null;
    const ok = v && MEDIA.CLOCKS.includes(v.clock) && MEDIA.LOOPS.includes(v.loop) &&
      ['origin', 'clipIn', 'end', 'speed', 'frame'].every((k) => finite(v[k])) && v.speed > 0 && v.frame > 0;
    if (!ok) throw new BuildError('bad-media', 'time must be null or a TimeSpec from core/media.timeSpec');
    return Object.isFrozen(v) ? v : Object.freeze(Object.assign({}, v));
  }

  // The checked media record of sb.media(o); meta = the plan's MediaMeta of o.src. The fit rectangles are computed here,
  // once: nothing about framing is computed per frame.
  function mediaRecord(o, meta) {
    const bad = (m) => { throw new BuildError('bad-media', m); };
    if (!isBoxLike(o.box)) bad('box needs a finite x, y, w, h');
    const fit = o.fit === undefined ? 'cover' : o.fit;
    if (!MEDIA.FITS.includes(fit)) bad('fit must be one of ' + MEDIA.FITS.join(' '));
    const c = o.crop || { zoom: 1, x: 0.5, y: 0.5 };
    if (!(finite(c.zoom) && c.zoom >= 1 && finite(c.x) && c.x >= 0 && c.x <= 1 && finite(c.y) && c.y >= 0 && c.y <= 1)) {
      bad('crop must be { zoom ≥ 1, x, y in 0..1 }');
    }
    const edge = o.edge === undefined ? 'plain' : o.edge;
    if (!MEDIA.EDGES.includes(edge)) bad('edge must be one of ' + MEDIA.EDGES.join(' '));
    const bleed = o.bleed === undefined ? 0 : o.bleed;
    if (!(finite(bleed) && bleed >= 0 && bleed <= 0.5)) bad('bleed must be a share 0..0.5 (0 or 0.15)');
    if (o.mask !== undefined && o.mask !== null && !isShape(o.mask)) bad('mask must be null or a ShapeSpec from K.shape');
    const comp = o.comp === undefined ? 'over' : o.comp;
    if (!COMPS.includes(comp)) bad('comp must be one of ' + COMPS.join(' '));
    const blur = o.blur === undefined ? 0 : o.blur;
    if (!(finite(blur) && blur >= 0)) bad('blur must be a number ≥ 0 (du)');
    const headroom = o.headroom === undefined ? 1.15 : o.headroom;
    if (!(finite(headroom) && headroom > 0)) bad('headroom must be a positive number');
    if (o.sceneOnly !== undefined && typeof o.sceneOnly !== 'boolean') bad('sceneOnly must be a boolean');
    // depth (DESIGN_2_1 §11.9.3, additive): the camera factor the node sees, and `still` (outside the seam composite)
    const cam = o.cam === undefined ? 1 : o.cam;
    if (!(finite(cam) && cam >= 0 && cam <= 2)) bad('cam (the camera factor) must be a number 0..2');
    if (o.still !== undefined && typeof o.still !== 'boolean') bad('still must be a boolean');
    const box = Object.freeze({ x: o.box.x, y: o.box.y, w: o.box.w, h: o.box.h });
    const crop = Object.freeze({ zoom: c.zoom, x: c.x, y: c.y });
    const m = Object.freeze({ kind: meta.kind, w: meta.w, h: meta.h, rot: meta.rot || 0, alpha: !!meta.alpha, anim: !!meta.anim });
    return {
      media: true, src: o.src, box, fit, crop, edge, bleed, mask: o.mask || null, comp, blur,
      veil: inkLayer(o.veil, 'veil'), tint: inkLayer(o.tint, 'tint'), time: timeOf(o.time), headroom,
      sceneOnly: o.sceneOnly === true, cam, still: o.still === true, meta: m,
      rect: Object.freeze(MEDIA.fitRect(m, box, fit, crop.zoom, crop.x, crop.y)),
      soft: fit === 'soft' ? Object.freeze(MEDIA.fitRect(m, box, 'cover', SOFT_ZOOM, crop.x, crop.y)) : null,
      softBlur: SOFT_BLUR, softVeil: SOFT_VEIL,
    };
  }

  // --- the builder ----------------------------------------------------------------------------------------------

  const LAYER_KEYS = ['blend', 'opacity', 'isolate', 'filter', 'mask', 'cache'];
  const ELEMENT_SLOT = (el) => (el === 'text' ? 'arrange' : el);

  // createBuilder({ D, text, cutText, defaults, media? }) → { sb, … internal API for engine/scene/build }.
  // D = design env; text = TextService; cutText = the cut's text; defaults = { orient, face, ink, style, lang, emph };
  // media = { [AssetId]: MediaMeta } (the plan's media, what sb.media may show).
  function createBuilder(opts) {
    const D = opts.D;
    const service = opts.text;
    const cutText = opts.cutText || '';
    const defaults = opts.defaults || {};
    const mediaMeta = opts.media || {};
    const table = T.createTable();
    const stores = { glyph: [], shape: [], paint: [], image: [], particles: [] };
    const owners = [];
    const ownerIndex = new Map();
    const runs = [];
    const runOfNode = new Map();
    const behaviours = [];
    const layers = T.defaultLayers();
    const ctx = { owner: 'text', rng: null, forks: 0 };
    let committed = false;
    let layoutStale = true;

    function ownerOf(el) {
      const name = typeof el === 'string' && el ? el : ctx.owner;
      if (!ownerIndex.has(name)) {
        ownerIndex.set(name, owners.length);
        owners.push(Object.freeze({ el: name, slot: ELEMENT_SLOT(name) }));
      }
      return ownerIndex.get(name);
    }

    function parentOf(v) {
      if (v === undefined || v === null || v === -1) return -1;
      if (!(Number.isInteger(v) && v >= 0 && v < table.n)) throw new BuildError('bad-parent', 'parent must be an existing node');
      return v;
    }

    function layerOf(name, parent) {
      if (name === undefined || name === null) return parent >= 0 ? table.layer[parent] : T.LAYER_INDEX.text;
      const i = T.LAYER_INDEX[name];
      if (i === undefined) throw new BuildError('bad-layer', 'unknown layer ' + JSON.stringify(name));
      return i;
    }

    function poseOf(o) {
      const num = (v, d) => (finite(v) ? v : d);
      return { x: num(o.x, 0), y: num(o.y, 0), rot: num(o.rot, 0), sx: num(o.sx, 1), sy: num(o.sy, 1), alpha: num(o.alpha, 1) };
    }

    function node(type, o, payload, flags) {
      const parent = parentOf(o.parent);
      const i = T.addNode(table, { type, parent, layer: layerOf(o.layer, parent), owner: ownerOf(o.owner), payload, flags });
      return i;
    }

    // --- part-facing API ---

    function group(o) {
      const spec = o || {};
      const i = node(T.TYPE.group, spec, -1, 0);
      T.setBase(table, i, poseOf(spec));
      return i;
    }

    function text(spec) {
      if (!spec || typeof spec !== 'object') throw new BuildError('bad-run', 'sb.text needs a RunSpec');
      const s = normalizeRun(spec);
      const i = node(T.TYPE.group, spec, -1, 0);
      const b = s.box;
      T.setBase(table, i, { rot: finite(spec.rot) ? spec.rot : 0, px: b.x + b.w / 2, py: b.y + b.h / 2 });
      if (spec.move && (finite(spec.move.vx) || finite(spec.move.vy))) {
        behaviours.push({ phase: BH.PH.MOTION, live: 'always', from: i, to: i + 1, t0: 0, t1: 0, run: BH.runDrift,
          vx: finite(spec.move.vx) ? spec.move.vx : 0, vy: finite(spec.move.vy) ? spec.move.vy : 0 });
      }
      const run = { index: runs.length, node: i, spec: s, layout: null, from: -1, to: -1, ink: s.ink, emphInk: s.emphInk,
        late: committed };
      runs.push(run);
      runOfNode.set(i, run);
      layoutStale = true;
      if (committed) allocateGlyphs([run]);
      return Object.freeze({ node: i, spec: s });
    }

    function normalizeRun(spec) {
      const s = Object.assign({}, spec);
      delete s.parent;
      const box = s.box;
      if (!box || ![box.x, box.y, box.w, box.h].every(finite)) throw new BuildError('bad-run', 'RunSpec.box needs finite x, y, w, h');
      if (!finite(s.size) || s.size <= 0) throw new BuildError('bad-run', 'RunSpec.size must be a positive number');
      s.box = { x: box.x, y: box.y, w: Math.max(0, box.w), h: Math.max(0, box.h) };
      const own = s.text !== undefined && s.text !== null;
      if (!own && !Array.isArray(s.span)) s.span = [0, cutText.length];
      if (s.orient !== 'h' && s.orient !== 'v') s.orient = defaults.orient === 'v' ? 'v' : 'h';
      if (s.face === undefined) s.face = defaults.face || 'display';
      if (s.ink === undefined) s.ink = defaults.ink || 'ink';
      if (s.emphInk === undefined) s.emphInk = 'accent';
      if (s.style === undefined) s.style = defaults.style || 'plain';
      if (s.revealMode === undefined) s.revealMode = s.orient === 'v' ? 'wipeY' : 'wipeX';
      if (s.lang === undefined && defaults.lang) s.lang = defaults.lang;
      if (s.emph === undefined && !own && Array.isArray(defaults.emph)) s.emph = defaults.emph;
      return Object.freeze(s);
    }

    function shape(o) {
      if (!o || !isShape(o.path)) throw new BuildError('bad-shape', 'sb.shape needs path: a ShapeSpec from K.shape');
      const rec = {
        path: o.path, fill: o.fill === undefined ? null : o.fill, stroke: o.stroke === undefined ? null : o.stroke,
        width: finite(o.width) ? o.width : 2, dash: Array.isArray(o.dash) ? o.dash.filter(finite) : null,
        cap: o.cap === 'round' || o.cap === 'square' ? o.cap : 'butt', bounds: shapeBounds(o.path),
      };
      if (rec.fill === null && rec.stroke === null) rec.stroke = 'ink';
      const i = node(T.TYPE.shape, o, stores.shape.length, T.FLAG.pickable);
      stores.shape.push(rec);
      T.setBase(table, i, poseOf(o));
      return i;
    }

    function paint(o) {
      if (!o || typeof o.draw !== 'function') throw new BuildError('bad-paint', 'sb.paint needs a draw(g, t, data, q) function');
      const rec = { draw: o.draw, data: o.data === undefined ? null : o.data, bleed: finite(o.bleed) ? o.bleed : 0.15,
        animated: o.animated !== false };
      const i = node(T.TYPE.paint, { layer: o.layer, owner: o.owner }, stores.paint.length, 0);
      stores.paint.push(rec);
      return i;
    }

    function image(o) {
      if (!o || ![o.x, o.y, o.w, o.h].every(finite)) throw new BuildError('bad-image', 'sb.image needs a finite x, y, w, h');
      const rec = { asset: o.asset === undefined ? null : o.asset, fit: o.fit === 'contain' ? 'contain' : 'cover',
        box: { x: o.x, y: o.y, w: o.w, h: o.h } };
      const i = node(T.TYPE.image, o, stores.image.length, T.FLAG.pickable);
      stores.image.push(rec);
      return i;
    }

    // sb.media(o) → node: an image node (type 4) whose record has media: true and the fields of DESIGN_2_1 §11.5.1, plus
    // (§11.9.3) cam = the camera factor it sees (default 1) and still (drawn outside the seam composite). src must be an
    // asset of the plan's media (K.media returns −1 before calling this for '' or an unknown id). A timed node (a video
    // or an animation) is refused on a layer that is cached as a static raster.
    function media(o) {
      if (!o || typeof o !== 'object') throw new BuildError('bad-media', 'sb.media needs options');
      const meta = MEDIA.isId(o.src) && Object.prototype.hasOwnProperty.call(mediaMeta, o.src) ? mediaMeta[o.src] : null;
      if (!meta) throw new BuildError('bad-media', 'sb.media: src must be an asset of the plan (got ' + JSON.stringify(o.src) + ')');
      const rec = mediaRecord(o, meta);
      const i = node(T.TYPE.image, o, stores.image.length, T.FLAG.pickable);
      if (rec.time && layers[table.layer[i]].cache === 'static') {
        throw new BuildError('bad-media', 'a video or animation cannot be on a layer cached as a static raster');
      }
      stores.image.push(rec);
      T.setBase(table, i, poseOf(o));
      return i;
    }

    // The media nodes: [{ node, id, time }] in node order (the scene's media list, DESIGN_2_1 §11.3.7).
    function mediaList() {
      const out = [];
      for (let i = 0; i < table.n; i++) {
        if (table.type[i] !== T.TYPE.image) continue;
        const rec = stores.image[table.payload[i]];
        if (rec && rec.media) out.push(Object.freeze({ node: i, id: rec.src, time: rec.time }));
      }
      return Object.freeze(out);
    }

    function timedMediaOn(layerIndex) {
      for (let i = 0; i < table.n; i++) {
        if (table.type[i] !== T.TYPE.image || table.layer[i] !== layerIndex) continue;
        const rec = stores.image[table.payload[i]];
        if (rec && rec.media && rec.time) return true;
      }
      return false;
    }

    function particles(o) {
      if (!o) throw new BuildError('bad-particles', 'sb.particles needs options');
      const rng = ctx.rng ? ctx.rng.fork('particles', ctx.forks++) : null;
      if (!rng) throw new BuildError('bad-particles', 'sb.particles is only available while a part builds');
      const data = particleData(o.n, o.field, rng);
      const rec = { data, sprite: o.sprite === undefined ? null : o.sprite, ink: o.ink === undefined ? 'ink' : o.ink };
      const i = node(T.TYPE.particles, { layer: o.layer, owner: o.owner }, stores.particles.length, 0);
      stores.particles.push(rec);
      return i;
    }

    function behave(b) {
      BH.check(b);
      behaviours.push(b);
    }

    function layer(name, patch) {
      const i = T.LAYER_INDEX[name];
      if (i === undefined) throw new BuildError('bad-layer', 'unknown layer ' + JSON.stringify(name));
      const spec = layers[i];
      for (const k of Object.keys(patch || {})) {
        if (!LAYER_KEYS.includes(k)) throw new BuildError('bad-layer', 'unknown layer field ' + k);
        const v = patch[k];
        if (k === 'blend' && !T.BLENDS.includes(v)) throw new BuildError('bad-layer', 'unknown blend ' + v);
        if (k === 'opacity' && !(finite(v) && v >= 0 && v <= 1)) throw new BuildError('bad-layer', 'opacity must be 0..1');
        if (k === 'isolate' && typeof v !== 'boolean') throw new BuildError('bad-layer', 'isolate must be a boolean');
        if (k === 'filter' && !(v === null || (v && finite(v.blur) && v.blur >= 0))) throw new BuildError('bad-layer', 'filter must be null or { blur }');
        if (k === 'mask' && !(v === null || (v && T.LAYER_INDEX[v.layer] !== undefined))) throw new BuildError('bad-layer', 'mask must name a layer');
        if (k === 'cache' && v !== 'none' && v !== 'static') throw new BuildError('bad-layer', "cache must be 'none' or 'static'");
        if (k === 'cache' && v === 'static' && timedMediaOn(i)) {
          throw new BuildError('bad-layer', 'a layer holding a video or animation cannot be cached as a static raster');
        }
        spec[k] = k === 'filter' && v ? { blur: v.blur } : k === 'mask' && v ? { layer: v.layer, invert: !!v.invert } : v;
      }
    }

    // bounds(node) → Box (du) of the node and its subtree at rest. Pending text is laid out on demand.
    function bounds(i) {
      if (!(Number.isInteger(i) && i >= 0 && i < table.n)) throw new BuildError('bad-node', 'sb.bounds needs a node');
      layoutRuns();
      const rest = T.restWorld(table);
      const acc = [Infinity, Infinity, -Infinity, -Infinity];
      const box = [0, 0, 0, 0];
      for (let j = i; j < table.n; j++) {
        if (!T.isUnder(table, j, i) || !extentOf(j, box)) continue;
        unionTransformed(acc, rest.m, j, box);
      }
      if (!(acc[0] <= acc[2])) {
        const o = i * 6;
        return { x: rest.m[o + 4], y: rest.m[o + 5], w: 0, h: 0 };
      }
      return { x: acc[0], y: acc[1], w: acc[2] - acc[0], h: acc[3] - acc[1] };
    }

    function extentOf(j, out) {
      const type = table.type[j];
      if (type === T.TYPE.glyph) {
        const g = stores.glyph[table.payload[j]];
        out[0] = -g.w / 2; out[1] = -g.h / 2; out[2] = g.w / 2; out[3] = g.h / 2;
        return true;
      }
      if (type === T.TYPE.group) {
        const run = runOfNode.get(j);
        if (!run || !run.layout) return false;
        const b = run.layout.box;
        out[0] = b.x; out[1] = b.y; out[2] = b.x + b.w; out[3] = b.y + b.h;
        return true;
      }
      if (type === T.TYPE.shape) {
        const s = stores.shape[table.payload[j]];
        const pad = s.stroke ? s.width / 2 : 0;
        out[0] = s.bounds[0] - pad; out[1] = s.bounds[1] - pad; out[2] = s.bounds[2] + pad; out[3] = s.bounds[3] + pad;
        return true;
      }
      if (type === T.TYPE.image) {
        const b = stores.image[table.payload[j]].box;
        out[0] = b.x; out[1] = b.y; out[2] = b.x + b.w; out[3] = b.y + b.h;
        return true;
      }
      if (type === T.TYPE.particles) {
        const a = stores.particles[table.payload[j]].data.field.area;
        out[0] = a.x; out[1] = a.y; out[2] = a.x + a.w; out[3] = a.y + a.h;
        return true;
      }
      if (type === T.TYPE.paint) {
        out[0] = 0; out[1] = 0; out[2] = D.w; out[3] = D.h;
        return true;
      }
      return false;
    }

    const CORNER = new Float32Array(2);
    const WORLD = new Float32Array(6);
    function unionTransformed(acc, m, j, box) {
      for (let k = 0; k < 6; k++) WORLD[k] = m[j * 6 + k];
      for (let c = 0; c < 4; c++) {
        MAT.apply(WORLD, c & 1 ? box[2] : box[0], c & 2 ? box[3] : box[1], CORNER);
        if (CORNER[0] < acc[0]) acc[0] = CORNER[0];
        if (CORNER[1] < acc[1]) acc[1] = CORNER[1];
        if (CORNER[0] > acc[2]) acc[2] = CORNER[0];
        if (CORNER[1] > acc[3]) acc[3] = CORNER[1];
      }
    }

    // freeAround(box) → the free bands of the safe area above, below, left and right of the box (empty ones dropped).
    function freeAround(box) {
      const l = D.safe.l, t = D.safe.t, r = D.w - D.safe.r, b = D.h - D.safe.b;
      const bx0 = N.clamp(box.x, l, r), bx1 = N.clamp(box.x + box.w, l, r);
      const by0 = N.clamp(box.y, t, b), by1 = N.clamp(box.y + box.h, t, b);
      const bands = [
        { x: l, y: t, w: r - l, h: by0 - t },
        { x: l, y: by1, w: r - l, h: b - by1 },
        { x: l, y: by0, w: bx0 - l, h: by1 - by0 },
        { x: bx1, y: by0, w: r - bx1, h: by1 - by0 },
      ];
      return bands.filter((q) => q.w >= 1 && q.h >= 1);
    }

    const sb = Object.freeze({ group, text, shape, paint, image, particles, behave, bounds, freeAround, layer, media });

    // --- engine-side API (engine/scene/build) ---

    function setContext(c) {
      ctx.owner = c.owner;
      ctx.rng = c.rng || null;
      ctx.forks = 0;
    }

    function camera() {
      const i = T.addNode(table, { type: T.TYPE.camera, parent: -1, layer: T.LAYER_INDEX.hud, owner: ownerOf('lens'),
        flags: T.FLAG.hidden });
      return i;
    }

    function layoutRuns() {
      const pending = runs.filter((r) => !r.late);
      if (!layoutStale || pending.length === 0) return;
      const lays = service.layoutAll(pending.map((r) => ({ spec: r.spec, text: cutText })));
      pending.forEach((r, k) => { r.layout = lays[k]; });
      layoutStale = false;
    }

    // Lays out every run created so far and allocates their glyph nodes as one contiguous block → { from, to }.
    function commitText() {
      if (committed) throw new BuildError('twice', 'text is committed once');
      layoutStale = true;
      layoutRuns();
      committed = true;
      const from = table.n;
      allocateGlyphs(runs);
      return { from, to: table.n };
    }

    function allocateGlyphs(list) {
      for (const run of list) {
        if (!run.layout) run.layout = service.layout(run.spec, cutText);
        const lay = run.layout;
        run.from = table.n;
        for (let i = 0; i < lay.n; i++) addGlyph(run, lay, i);
        run.to = table.n;
      }
    }

    function addGlyph(run, lay, i) {
      const cls = S.CLASSES[lay.cls[i]] || 'other';
      const emph = lay.emph[i] === 1;
      const rec = {
        run: run.index, i, ch: lay.ch[i], cls, vcls: lay.vcls ? lay.vcls[i] : 0, rot: lay.rot[i], sx: lay.sx ? lay.sx[i] : 1,
        em: lay.em ? lay.em[i] : lay.size, font: lay.fonts[lay.font ? lay.font[i] : 0], ink: emph ? run.emphInk : run.ink,
        emph, style: run.spec.style, reveal: run.spec.revealMode, w: lay.w[i], h: lay.h[i], off: lay.off ? lay.off[i] : i,
        line: lay.line[i], word: lay.word[i],
      };
      const flags = T.FLAG.pickable | (cls === 'space' ? T.FLAG.hidden : 0);
      const n = T.addNode(table, { type: T.TYPE.glyph, parent: run.node, layer: table.layer[run.node],
        owner: table.owner[run.node], payload: stores.glyph.length, flags });
      stores.glyph.push(rec);
      T.setBase(table, n, { x: lay.box.x + lay.x[i], y: lay.box.y + lay.y[i] });
    }

    // Root nodes of an element: its nodes whose parent belongs to another element (or is the root).
    function rootsOf(el) {
      const idx = ownerIndex.get(el);
      const out = [];
      if (idx === undefined) return out;
      for (let i = 0; i < table.n; i++) {
        if (table.owner[i] !== idx || table.type[i] === T.TYPE.camera) continue;
        const p = table.parent[i];
        if (p < 0 || table.owner[p] !== idx) out.push(i);
      }
      return out;
    }

    function nodesOf(el) {
      const idx = ownerIndex.get(el);
      const out = [];
      if (idx !== undefined) for (let i = 0; i < table.n; i++) if (table.owner[i] === idx) out.push(i);
      return out;
    }

    // Union of the rest bounds of an element's roots (null when it has none).
    function boundsOf(el) {
      let acc = null;
      for (const r of rootsOf(el)) {
        const b = bounds(r);
        if (b.w === 0 && b.h === 0) continue;
        acc = acc ? unionBox(acc, b) : b;
      }
      return acc;
    }

    // el.<owner>.nudge {dx, dy, rot (deg), s}: moved, turned and scaled about the element's rest centre.
    function nudge(el, v) {
      const dx = finite(v.dx) ? v.dx : 0, dy = finite(v.dy) ? v.dy : 0;
      const rot = finite(v.rot) ? v.rot * N.DEG : 0, s = finite(v.s) && v.s > 0 ? v.s : 1;
      const box = boundsOf(el);
      const rest = T.restWorld(table);
      const inv = new Float32Array(6), pm = new Float32Array(6), pt = new Float32Array(2);
      for (const i of rootsOf(el)) {
        const B = table.base;
        if ((rot !== 0 || s !== 1) && box && B.rot[i] === 0 && B.sx[i] === 1 && B.sy[i] === 1) {
          let cx = box.x + box.w / 2, cy = box.y + box.h / 2;
          const p = table.parent[i];
          if (p >= 0) {
            for (let k = 0; k < 6; k++) pm[k] = rest.m[p * 6 + k];
            if (MAT.invert(inv, pm)) { MAT.apply(inv, cx, cy, pt); cx = pt[0]; cy = pt[1]; }
          }
          T.setBase(table, i, { px: cx - B.x[i], py: cy - B.y[i] });
        }
        T.setBase(table, i, { x: B.x[i] + dx, y: B.y[i] + dy, rot: B.rot[i] + rot, sx: B.sx[i] * s, sy: B.sy[i] * s });
      }
    }

    // el.<owner>.fill: replaces the element's ink (text runs and glyphs, shapes, particles).
    function fill(el, ink) {
      const idx = ownerIndex.get(el);
      if (idx === undefined) return;
      for (const run of runs) {
        if (table.owner[run.node] !== idx) continue;
        run.ink = ink; run.emphInk = ink;
      }
      for (const i of nodesOf(el)) {
        const type = table.type[i], rec = type === T.TYPE.glyph ? stores.glyph[table.payload[i]]
          : type === T.TYPE.shape ? stores.shape[table.payload[i]] : type === T.TYPE.particles ? stores.particles[table.payload[i]] : null;
        if (!rec) continue;
        if (type === T.TYPE.shape) { if (rec.fill !== null) rec.fill = ink; if (rec.stroke !== null) rec.stroke = ink; }
        else rec.ink = ink;
      }
    }

    function hide(el) {
      for (const i of nodesOf(el)) table.flags[i] |= T.FLAG.hidden;
    }

    // Validates behaviour ranges, marks static nodes and returns the behaviours sorted by (phase, build order).
    function seal() {
      for (const b of behaviours) {
        if (b.to > table.n) throw new BuildError('bad-behaviour', 'behaviour range [' + b.from + ', ' + b.to + ') is past the last node');
      }
      const covered = new Uint8Array(table.n);
      for (const b of behaviours) for (let i = b.from; i < b.to; i++) covered[i] = 1;
      for (let i = 0; i < table.n; i++) {
        const p = table.parent[i];
        const still = !covered[i] && (p < 0 || (table.flags[p] & T.FLAG.static) !== 0);
        if (still) table.flags[i] |= T.FLAG.static;
      }
      return BH.sortBehaviours(behaviours);
    }

    return {
      sb, table, stores, owners, runs, layers, setContext, ownerOf, camera, commitText, layoutRuns, rootsOf, nodesOf,
      boundsOf, nudge, fill, hide, seal, behaviours, mediaList,
    };
  }

  function unionBox(a, b) {
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x + a.w, b.x + b.w), y1 = Math.max(a.y + a.h, b.y + b.h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  return {
    OP, OP_ARGS, OP_NAMES, MAX_PARTICLES, BuildError, COMPS,
    path, rect, ellipse, line, poly, arc, replayShape, shapeBounds, isShape,
    normalizeField, particleData, particleAt, createBuilder, unionBox,
  };
});
