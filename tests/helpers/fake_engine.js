/* 文字PVメーカー v2 — original work. Fake engine (DESIGN §4.20 facade) and a recording Ctx2D, for WP6/WP8 until WP4 lands. */
// Works in Node (module.exports) and in a browser page (window.MVFake). It never measures text: one coloured box and the
// cut text per active cut, over plan_basic.json or a trivial plan built from a document (one cut per lyric line).
(function (G) {
  'use strict';

  const DESIGN_SIZE = {
    '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350], '4:3': [1440, 1080],
    '3:4': [1080, 1440], '21:9': [2520, 1080],
  };
  const PALETTE = { ground: '#EFE9DC', ground2: '#E2D9C6', ink: '#1C1A17', accent: '#B8322A', shiftA: '#3E6E8C',
    shiftB: '#C9A15B', muted: '#8C8577' };
  const FACES = {
    display: { ja: { family: 'Yuji Syuku', weight: 400 }, latin: { family: 'Fraunces', weight: 400 } },
    serif: { ja: { family: 'Shippori Mincho B1', weight: 600 }, latin: { family: 'Cormorant Garamond', weight: 600 } },
    body: { ja: { family: 'Zen Kaku Gothic New', weight: 500 }, latin: { family: 'Inter', weight: 500 } },
  };
  const AMOUNTS = { motion: 0.3, glitch: 0, chroma: 0.05, ornament: 0.35, density: 0.3, texture: 0.5, groundSwitch: 0.2,
    flash: 0, shake: 0.05, camera: 0.3, pace: 0.3 };
  const BACKDROP_FILL = { chroma: '#00B140', black: '#000000' };
  const FADE = 0.2;

  // --- hashing (same algorithm as core/hash, DESIGN §4.1.1) ---------------------------------------------------

  function hash32(...parts) {
    let h = 0x811c9dc5;
    for (let p = 0; p < parts.length; p++) {
      const s = String(parts[p]);
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      h ^= 0x1f; h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
  }

  function canonical(v) {
    if (v === null || typeof v !== 'object') return typeof v === 'number' && !Number.isFinite(v) ? 'null' : JSON.stringify(v);
    if (Array.isArray(v) || ArrayBuffer.isView(v)) return '[' + Array.from(v, (x) => (x === undefined ? 'null' : canonical(x))).join(',') + ']';
    return '{' + Object.keys(v).sort().filter((k) => v[k] !== undefined && typeof v[k] !== 'function')
      .map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }

  function hashJSON(v) { return hash32(canonical(v)).toString(16).padStart(8, '0'); }

  // --- recording context (the §4.19.8 Ctx2D subset) -----------------------------------------------------------

  const METHODS = ['setTransform', 'transform', 'translate', 'rotate', 'scale', 'setLineDash', 'beginPath', 'moveTo',
    'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'arc', 'ellipse', 'rect', 'closePath', 'fill', 'stroke', 'clip',
    'fillRect', 'clearRect', 'strokeRect', 'fillText', 'strokeText'];
  const PROPS = { globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000000', strokeStyle: '#000000',
    lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', font: '10px sans-serif', textAlign: 'start',
    textBaseline: 'alphabetic', imageSmoothingEnabled: true, filter: 'none' };

  // createRecorder() → { factory: CanvasFactory, ops(), hash(), stats(), reset() }
  function createRecorder() {
    const ops = [];
    const st = { saves: 0, restores: 0, depth: 0, maxDepth: 0, alphaMin: 1, alphaMax: 1, nan: 0 };
    let ids = 0;

    function arg(v) {
      if (typeof v === 'number') {
        if (!Number.isFinite(v)) { st.nan++; return String(v); }
        return Math.round(v * 1000) / 1000;
      }
      if (v && typeof v === 'object') return v.id ? v.id : typeof v;
      return v;
    }
    function log(id, name, args) { ops.push([id, name].concat(Array.from(args, arg))); }

    function makeCtx(canvas) {
      const id = canvas.id;
      const state = Object.assign({}, PROPS);
      const stack = [];
      const ctx = { canvas };
      for (const name of METHODS) ctx[name] = function () { log(id, name, arguments); };
      ctx.save = () => {
        stack.push(Object.assign({}, state));
        st.saves++; st.depth++; st.maxDepth = Math.max(st.maxDepth, st.depth);
        log(id, 'save', []);
      };
      ctx.restore = () => {
        if (stack.length) Object.assign(state, stack.pop());
        st.restores++; st.depth--;
        log(id, 'restore', []);
      };
      ctx.drawImage = function () { log(id, 'drawImage', arguments); };
      ctx.createLinearGradient = function () { return gradient(id, 'createLinearGradient', arguments); };
      ctx.createRadialGradient = function () { return gradient(id, 'createRadialGradient', arguments); };
      ctx.createPattern = function () { const p = { id: 'p' + ids++ }; log(id, 'createPattern', [p].concat(Array.from(arguments))); return p; };
      for (const prop of Object.keys(PROPS)) {
        Object.defineProperty(ctx, prop, {
          enumerable: true,
          get: () => state[prop],
          set: (v) => {
            state[prop] = v;
            if (prop === 'globalAlpha' && typeof v === 'number') {
              st.alphaMin = Math.min(st.alphaMin, v); st.alphaMax = Math.max(st.alphaMax, v);
            }
            log(id, 'set:' + prop, [v]);
          },
        });
      }
      return ctx;
    }

    function gradient(canvasId, name, args) {
      const g = { id: 'g' + ids++ };
      g.addColorStop = function () { log(canvasId, g.id + '.addColorStop', arguments); };
      log(canvasId, name, [g].concat(Array.from(args)));
      return g;
    }

    const factory = {
      create(w, h, opts) {
        const canvas = { id: 'c' + ids++, width: w, height: h, alpha: !(opts && opts.alpha === false) };
        const ctx = makeCtx(canvas);
        canvas.getContext = () => ctx;
        return { canvas, ctx };
      },
    };

    return {
      factory,
      ops: () => ops.slice(),
      hash: () => hashJSON(ops),
      stats: () => ({ saves: st.saves, restores: st.restores, maxDepth: st.maxDepth, alphaRange: [st.alphaMin, st.alphaMax],
        nan: st.nan, balanced: st.depth === 0 && st.saves === st.restores }),
      reset() { ops.length = 0; Object.assign(st, { saves: 0, restores: 0, depth: 0, maxDepth: 0, alphaMin: 1, alphaMax: 1, nan: 0 }); },
    };
  }

  // A Surface = { canvas, ctx, w, h } from any CanvasFactory.
  function surfaceOf(factory, w, h, alpha) {
    const s = factory.create(w, h, { alpha: alpha !== false });
    return { canvas: s.canvas, ctx: s.ctx, w, h };
  }

  // --- trivial plan: one cut per lyric row, no measuring --------------------------------------------------------

  const META = /^\[(ti|ar|al|by|offset|re|ve):(.*)\]$/i;
  const STAMP = /^\[(\d+):(\d{1,2})(?:[.:](\d{1,3}))?\]/;
  const WORD_TAG = /<\d+:\d{1,2}(?:[.:]\d{1,3})?>/g;

  function readRow(src) {
    const s = String(src).trim();
    if (!s) return { kind: 'blank' };
    if (s[0] === '#') return { kind: 'comment' };
    const meta = META.exec(s);
    if (meta) return { kind: 'meta', tag: meta[1].toLowerCase(), value: meta[2].trim() };
    let rest = s;
    let stamp = null;
    for (let m = STAMP.exec(rest); m; m = STAMP.exec(rest)) {
      const sec = Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number('0.' + m[3]) : 0);
      if (stamp === null) stamp = sec;
      rest = rest.slice(m[0].length);
    }
    rest = rest.replace(WORD_TAG, '');
    const bar = rest.search(/(^|[^\\])\|/);
    if (bar >= 0) rest = rest.slice(0, rest[bar] === '|' ? bar : bar + 1);
    rest = rest.trim();
    const impact = /[^\\]!$|^!$/.test(rest);
    if (impact) rest = rest.slice(0, -1);
    const text = rest.replace(/\\(.)|[*/]/g, (all, esc) => esc || '');
    return { kind: 'lyric', text, stamp, impact };
  }

  function cellsOf(text) {
    let c = 0;
    for (const ch of text) c += /[\x21-\x7e]/.test(ch) ? 0.55 : ch === ' ' ? 0.3 : 1;
    return c;
  }

  function q(x) { return Math.round(x * 1000) / 1000; }
  function decision(v, p, from) { return p ? { v, p, from: from || 'fallback' } : { v, from: from || 'fallback' }; }

  function fallbackSlots() {
    return {
      orient: decision('h', null, 'auto'),
      arrange: decision('centerAnchor', { offsetX: 0, offsetY: 0 }),
      'text.face': decision('display', null, 'auto'), 'text.scale': decision(1, null, 'auto'),
      'text.ink': decision('ink', null, 'auto'), 'text.style': decision('plain', null, 'auto'),
      arrive: decision('instantShow', { dur: 0.4, each: 0.03, order: 'lead', ease: 'cubicOut' }),
      dwell: decision('stillHold', { amount: 0.3, speed: 1 }),
      depart: decision('instantHide', { dur: 0.3, each: 0.02, order: 'lead', ease: 'quadIn' }),
      'ornament.count': decision(0, null, 'auto'),
      lens: decision('fixedFrame', { amount: 0.3 }),
      'filter.count': decision(0, null, 'auto'),
    };
  }

  // trivialPlan(doc) → a Plan of the §3.12 shape: one cut per lyric row, times from LRC stamps or a steady pace.
  function trivialPlan(doc) {
    const aspect = DESIGN_SIZE[doc.look.aspect] ? doc.look.aspect : '16:9';
    const [w, h] = DESIGN_SIZE[aspect];
    const timing = doc.timing;
    const song = doc.song;
    const lines = [];
    let clock = timing.leadIn;
    let pause = 0;
    for (const row of doc.sheet.rows) {
      const r = readRow(row.src);
      if (r.kind === 'blank') { pause++; continue; }
      if (r.kind !== 'lyric' || !r.text) continue;
      const len = Math.max(1.2, cellsOf(r.text) * 0.28);
      const t0 = r.stamp !== null && r.stamp >= clock ? r.stamp : clock + pause * 0.8;
      lines.push({ id: row.id, text: r.text, t0: q(t0), t1: q(t0 + len), impact: r.impact });
      clock = t0 + len + 0.25;
      pause = 0;
    }
    const last = lines.length ? lines[lines.length - 1].t1 : timing.leadIn;
    const duration = q(song && song.seconds > 0 ? song.seconds : last + timing.outro);
    const palette = Object.assign({}, PALETTE);
    const design = { aspect, w, h, short: Math.min(w, h) };
    const cuts = lines.map((l, i) => {
      const next = lines[i + 1];
      const dur = q(l.t1 - l.t0);
      const graphemes = Array.from(l.text).length;
      const cut = {
        key: l.id + '~0', line: l.id, role: 'lyric', text: l.text, emph: [], impact: l.impact, note: null,
        t0: l.t0, t1: l.t1, a: q(l.t0 - timing.lead), b: q((next ? next.t0 : l.t1) + timing.tail), repT: q(l.t0 + 0.4),
        lang: /[^\x00-\x7f]/.test(l.text) ? 'ja' : 'en',
        feat: { cells: q(cellsOf(l.text)), graphemes, script: /[^\x00-\x7f]/.test(l.text) ? 'ja' : 'en', latin: 0,
          orients: ['h'], words: 1, units: { glyph: graphemes, word: 1, line: 1 }, emph: false, impact: l.impact, dur,
          cps: q(cellsOf(l.text) / dur), energy: 0.5, beat: 0, onBeat: false, section: null, repeatOf: null,
          pos: q(l.t0 / duration), role: 'lyric' },
        fp: '', slots: fallbackSlots(), els: {}, ground: 0, seamIn: -1,
      };
      cut.fp = hashJSON({ slots: cut.slots, text: cut.text, dur: q(cut.b - cut.a), role: cut.role, palette, design });
      return cut;
    });
    const ground = { key: cuts.length ? 'g' + cuts[0].key : 'gintro', t0: 0, t1: duration, cuts: cuts.map((c) => c.key),
      ground: decision('flatFill', { amount: 0.5 }), atmos: decision('none', null, 'auto'), fp: '' };
    ground.fp = hashJSON({ ground: ground.ground, span: duration, palette, design });
    const plan = {
      v: 1, hash: '', duration, design,
      look: { mood: decision('quietHush'), theme: decision('sumiWashi'), season: decision('any', null, 'auto'),
        amounts: Object.assign({}, AMOUNTS), amountsFrom: {}, palette, faces: FACES, texture: null,
        backdrop: doc.look.backdrop },
      beats: song && song.bpm ? { bpm: song.bpm, offset: song.offset, meter: song.meter } : null,
      lines: lines.map((l, index) => ({ id: l.id, row: l.id, index, text: l.text, t0: l.t0, t1: l.t1,
        by: { start: 'auto', end: 'auto' }, cuts: [l.id + '~0'], locked: false, lang: cuts[index].lang })),
      cuts, grounds: [ground], seams: [], impulses: [], warnings: [],
    };
    const { hash, ...rest } = plan;
    plan.hash = hash === '' ? hashJSON(rest) : hash;
    return plan;
  }

  // --- the fake facade ------------------------------------------------------------------------------------------

  function boxOf(cut, index, design) {
    const em = 0.09 * design.short;
    const bw = Math.min(0.84 * design.w, Math.max(2, cellsOf(cut.text)) * em * 1.1);
    const bh = em * 1.8;
    const cy = cut.role === 'title' ? 0.36 * design.h : (index % 2 ? 0.58 : 0.5) * design.h;
    return { x: (design.w - bw) / 2, y: cy - bh / 2, w: bw, h: bh };
  }

  function quadOf(b) {
    return new Float32Array([b.x, b.y, b.x + b.w, b.y, b.x + b.w, b.y + b.h, b.x, b.y + b.h]);
  }

  function fadeAt(t, cut) {
    const k = Math.min((t - cut.a) / FADE, (cut.b - t) / FADE, 1);
    return k < 0 ? 0 : k;
  }

  function changedKeys(before, after) {
    const old = new Map((before || []).map((x) => [x.key, x.fp]));
    return after.filter((x) => old.get(x.key) !== x.fp).map((x) => x.key);
  }

  // createFakeEngine({ registry, canvas, measurer, fonts, assets, plan }) → Engine (§4.20). `plan` seeds the engine
  // (e.g. plan_basic.json); setDoc(doc) replaces it with trivialPlan(doc).
  function createFakeEngine(opts) {
    const o = opts || {};
    let plan = o.plan || null;
    let lastDoc = null;
    let lastResult = null;
    let drawnBoxes = [];
    let pickBoxes = [];
    let frames = 0;

    function draw(surface, t, ropts) {
      const ro = ropts || {};
      const g = surface.ctx;
      const design = plan.design;
      const scale = ro.scale || (surface.w || surface.canvas.width) / design.w;
      const backdrop = ro.backdrop || plan.look.backdrop || 'scene';
      const pal = plan.look.palette;
      const inkOf = (token) => (backdrop === 'black' ? '#FFFFFF' : pal[token]);
      const boxes = [];
      let glyphs = 0;
      g.save();
      g.setTransform(scale, 0, 0, scale, 0, 0);
      if (backdrop === 'clear') g.clearRect(0, 0, design.w, design.h);
      else {
        g.fillStyle = backdrop === 'scene' ? pal.ground : BACKDROP_FILL[backdrop];
        g.fillRect(0, 0, design.w, design.h);
      }
      plan.cuts.forEach((cut, i) => {
        if (!(cut.a <= t && t < cut.b)) return;
        const box = boxOf(cut, i, design);
        const alpha = fadeAt(t, cut);
        g.globalAlpha = 0.18 * alpha;
        g.fillStyle = inkOf('accent');
        g.fillRect(box.x, box.y, box.w, box.h);
        g.globalAlpha = alpha;
        g.fillStyle = inkOf('ink');
        g.font = Math.round(0.09 * design.short) + 'px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(cut.text, box.x + box.w / 2, box.y + box.h / 2);
        glyphs += Array.from(cut.text).length;
        boxes.push({ cut: cut.key, line: cut.line, owner: 'text', box, node: i });
      });
      g.globalAlpha = 1;
      g.restore();
      drawnBoxes = boxes;
      if (ro.pick) pickBoxes = boxes;
      return { ms: 0, drawn: { glyphs, shapes: boxes.length, paints: 1, particles: 0 }, passes: 0, provisional: false };
    }

    const engine = {
      get plan() { return plan; },
      setDoc(doc) {
        if (doc === lastDoc && lastResult) return lastResult;
        const next = trivialPlan(doc);
        lastResult = { plan: next, changedCuts: changedKeys(plan && plan.cuts, next.cuts),
          changedGrounds: changedKeys(plan && plan.grounds, next.grounds) };
        plan = next;
        lastDoc = doc;
        return lastResult;
      },
      prepare() { return Promise.resolve(); },
      renderFrame(surface, t, ropts) {
        frames++;
        if (!plan) return { ms: 0, drawn: { glyphs: 0, shapes: 0, paints: 0, particles: 0 }, passes: 0, provisional: false };
        return draw(surface, t, ropts);
      },
      hitTest(x, y) {
        const hits = [];
        for (let i = pickBoxes.length - 1; i >= 0; i--) {
          const b = pickBoxes[i];
          if (x >= b.box.x && x <= b.box.x + b.box.w && y >= b.box.y && y <= b.box.y + b.box.h) {
            hits.push({ cut: b.cut, line: b.line, owner: b.owner, slot: null, node: b.node });
          }
        }
        return hits;
      },
      boxes() { return drawnBoxes.map((b) => ({ cut: b.cut, line: b.line, owner: b.owner, quad: quadOf(b.box) })); },
      thumb(ref, surface, topts) {
        const g = surface.ctx;
        const w = surface.w || surface.canvas.width, h = surface.h || surface.canvas.height;
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.fillStyle = PALETTE.ground;
        g.fillRect(0, 0, w, h);
        g.fillStyle = PALETTE.ink;
        g.font = Math.round(h * 0.16) + 'px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(ref.key), w / 2, h / 2);
        if (topts && topts.text) g.fillText(String(topts.text), w / 2, h * 0.75);
        g.restore();
      },
      warnings() { return plan ? plan.warnings.slice() : []; },
      fork() { return createFakeEngine(Object.assign({}, o, { plan })); },
      stats() {
        return { frameMs: 0, stageMs: { behave: 0, draw: 0, post: 0 }, spriteBytes: 0, surfaces: 0,
          scenes: plan ? plan.cuts.length : 0, frames };
      },
      dispose() { plan = null; lastDoc = null; lastResult = null; drawnBoxes = []; pickBoxes = []; },
    };
    return engine;
  }

  // createEngine is the §4.20 name, so code written against engine/facade can take this module unchanged.
  const api = { createEngine: createFakeEngine, createFakeEngine, createRecorder, surfaceOf, trivialPlan, hash32, hashJSON,
    canonical };

  if (typeof module === 'object' && module.exports) {
    // Node only: read plan_basic.json from the fixtures directory.
    api.loadPlanBasic = function loadPlanBasic() {
      const fs = require('node:fs');
      const path = require('node:path');
      return JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'fixtures', 'plan_basic.json'), 'utf8'));
    };
    module.exports = api;
  } else {
    G.MVFake = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
