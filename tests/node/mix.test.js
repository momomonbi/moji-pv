/* 文字PVメーカー v2 — original work. Tests for parts/mix: derive, the effective registry, media grounds, the interpreters and a conformance-style harness over sample and generated materials (DESIGN_2_1 §3.12, §5.7–§5.9, §7.3, §11.5.8–§11.5.9). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { load, listSources, SRC } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const MIX = MV.use('parts/mix');
const R = MV.use('core/recipe');
const REG = MV.use('core/registry');
const H = MV.use('core/hash');
const RNG = MV.use('core/rng');
const SCH = MV.use('core/schema');
const S = MV.use('core/script');
const DOC = MV.use('core/doc');
const MEDIA = MV.use('core/media');
const K = MV.use('parts/kit');
const FACES = MV.use('engine/text/faces');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const T = MV.use('engine/scene/table');
const BH = MV.use('engine/scene/behave');
const BUILD = MV.use('engine/scene/build');
const F = MV.use('engine/scene/frame');
const REC = MV.use('engine/render/record');
const PLAN = MV.use('planner/plan');

const BASE = MV.use('parts/catalog').defaultRegistry();
const ASPECTS = DOC.ASPECTS;
const TIMES = 24;
const EPS_POSE = 1e-4;
const GENERATED = 40;

// --- entries and registries --------------------------------------------------------------------------------------

let nextId = 1;
function entry(kind, recipe, extra) {
  return Object.assign({ id: 'm' + (nextId++).toString(36), kind, by: 'user', name: { ja: '素材', en: 'Material' }, tags: ['soft'],
    season: null, pool: true, rv: 1, recipe }, extra || {});
}
function materials(list) { return { next: 100, list }; }

// The §2.1 cherry flurry (a run ornament) and small recipes of every kind.
const PETALS = Object.freeze({ prim: 'particles', shape: 'petal', glyph: '', inks: ['#F4B4C6', 'accent'], alpha: 0.85, layer: 'near',
  place: { anchor: 'frame', x: 0, y: 0, spread: 1.15 }, size: [0.012, 0.022], count: 90, stroke: 0, rot: [0, 360],
  field: { dir: 115, speed: 0.09, sway: 26, swayHz: 0.35, spin: 60, life: [0, 0], burst: 'none' },
  move: [{ what: 'scale', wave: 'beat', amp: 0.15, hz: 0, phase: 'rnd', curve: null }],
  appear: { at: 'start', draw: 'fade', dur: 0.6 }, style: '', pattern: '', gap: 0, fill: null });
const FLURRY = Object.freeze({ follow: 'own', knobs: [{ what: 'count' }], layers: [PETALS], parts: [], scope: 'run', seed: 7 });

const RECIPES = Object.freeze({
  ornament: { scope: 'cut', follow: 'text', layers: [{ prim: 'shape', shape: 'star', count: 5, size: [0.02, 0.03], place: { anchor: 'around' } },
    { prim: 'frame', style: 'box', stroke: 0.003 }], knobs: [{ what: 'size' }] },
  ground: { layers: [{ prim: 'fill', fill: { type: 'radial', stops: [['ground', 0], ['shiftA', 1]] } },
    { prim: 'particles', shape: 'dot', count: 20, size: [0.01, 0.02], layer: 'far', field: { dir: 270, speed: 0.03 } }] },
  arrive: { motion: { tracks: [{ col: 'y', from: 0.8, to: 0 }, { col: 'alpha', from: 0, to: 1 }], curve: 'cubicOut' }, knobs: [{ what: 'amp' }] },
  depart: { motion: { unit: 'word', tracks: [{ col: 'x', from: 0, to: 1 }, { col: 'alpha', from: 1, to: 0 }] } },
  dwell: { osc: [{ col: 'y', amp: 0.05, hz: 0.6, wave: 'sine', phase: 'index', step: 0.5 }], knobs: [{ what: 'amp' }] },
  lens: { osc: [{ col: 'x', amp: 10, hz: 0.3, wave: 'noise' }, { col: 'zoom', amp: 0.02, hz: 0.5, wave: 'sine' }] },
  filter: { parts: [{ key: 'grainFilm', params: {} }, { key: 'edgeShade', params: {} }], mix: [0.6, 0.9] },
});
// Five patterns cost 1.5 ms: over a cut ornament's 1.2 ms (§5.8).
const PATTERNS_5 = Object.freeze([0, 1, 2, 3, 4].map((i) => ({ prim: 'pattern', pattern: 'dots', gap: 0.05 + i * 0.01, layer: 'far' })));
const VARIANTS = Object.freeze({
  arrange: { base: 'stairStep', params: {}, shared: { offsetX: { value: 0.05 } } },
  arrive: { base: 'inkRise', params: { yFrom: 1.2 }, shared: { dur: { value: 1.1 }, ease: { value: 'softEnds' } } },
  depart: { base: 'inkSink', params: {}, shared: { dur: { value: 0.5 } } },
  dwell: { base: 'waveRun', params: {}, shared: { speed: { value: 1.5 } } },
  filter: { base: 'grainFilm', params: {}, shared: { amount: { value: 0.4 } } },
  ground: { base: 'tideBands', params: { bands: 6 }, shared: {} },
  lens: { base: 'handHeld', params: {}, shared: { amount: { value: 0.3 } } },
  ornament: { base: 'cornerTicks', params: {}, shared: { ink: { value: 'shiftA' } } },
  seam: { base: 'irisGate', params: {}, shared: { dur: { value: 0.5 } } },
});

// Sample definitions carry keys 'myMatS…' that no registry accepts; tests re-key them into the material key space.
function rekey(def, n) {
  return Object.freeze(Object.assign({}, def, { key: 'myMatz' + (n === undefined ? def.key.slice(6).toLowerCase() : n.toString(36)) }));
}
function registryWith(defs) {
  const reg = REG.extend(BASE, defs, { strict: true });
  assert.deepEqual([...reg.problems], []);
  return reg;
}

// --- a conformance-style harness (the §8.2 conformance runner, for material definitions) ------------------------

const TEXTS = Object.freeze(['はじまりの朝', '夜明けの街を走るまだ遠い空の色を探して', 'Paper planes in the morning light',
  '今日はSunday morningだね', '🎉ありがとう👍✨', '愛', 'きみの名前を呼ぶ声']);
const measurer = fakeMeasurer();
const services = new Map();
function textService(faces) {
  const key = H.hashJSON(faces);
  if (!services.has(key)) services.set(key, createTextService({ measurer, faces }));
  return services.get(key);
}

function featuresOf(text, lang, dur) {
  const cells = S.cells(text), graphemes = S.graphemes(text).length;
  return { cells, graphemes, script: lang, latin: 0, orients: ['h'], words: 2, units: { glyph: graphemes, word: 2, line: 1 },
    emph: false, impact: false, dur, cps: cells / dur, energy: 0.55, beat: 0.5, onBeat: true, section: null, repeatOf: null,
    pos: 0.3, role: 'lyric' };
}

function autoParams(reg, kind, key, ax, seed) {
  const p = {};
  for (const { name, spec } of reg.params(kind, key)) p[name] = SCH.autoValue(spec, Object.assign({}, ax, { rng: RNG.stream(seed, 'param', name) }));
  return p;
}

function decision(reg, kind, key, ax, seed) { return { v: key, p: autoParams(reg, kind, key, ax, H.hash32(seed, kind, key)), from: 'auto' }; }

function lookOf(reg) {
  const theme = reg.get('theme', reg.fallback('theme')), mood = reg.get('mood', reg.fallback('mood'));
  const faces = JSON.parse(JSON.stringify(FACES.resolveFaces(theme, null, ['ja', 'en', 'ko', 'zhHant', 'zhHans'])));
  return { mood: { v: mood.key, from: 'auto' }, theme: { v: theme.key, from: 'auto' }, season: { v: 'any', from: 'auto' },
    amounts: Object.assign({}, mood.amounts), amountsFrom: {}, palette: Object.assign({}, theme.swatch), faces, texture: null,
    backdrop: 'scene' };
}

// A one-cut Plan (the §3.12 shape) with the material in its slot and the fallback parts elsewhere; o.impact makes the
// cut an impact line, o.bpm sets the beat grid.
function makePlan(reg, def, aspect, text, o) {
  const opts = o || {};
  const look = lookOf(reg);
  const [w, h] = DOC.DESIGN_SIZE[aspect];
  const lang = S.lineScript(text, 'ja');
  const dur = Math.max(1.6, Math.min(5, 0.35 * S.graphemes(text).length));
  const feat = featuresOf(text, lang, dur);
  const ax = { f: feat, look: { amounts: look.amounts, mood: null, bpm: 120 } };
  const seed = H.hash32('mix', aspect, text);
  const own = (kind) => def && def.kind === kind;
  const pick = (kind) => (own(kind) ? def.key : reg.fallback(kind));
  const slots = {
    orient: { v: 'h', from: 'auto' }, arrange: decision(reg, 'arrange', reg.fallback('arrange'), ax, seed),
    'text.face': { v: 'display', from: 'auto' }, 'text.scale': { v: 1, from: 'auto' }, 'text.ink': { v: 'ink', from: 'auto' },
    'text.style': { v: 'plain', from: 'auto' },
    arrive: decision(reg, 'arrive', pick('arrive'), ax, seed), dwell: decision(reg, 'dwell', pick('dwell'), ax, seed),
    depart: decision(reg, 'depart', pick('depart'), ax, seed), lens: decision(reg, 'lens', pick('lens'), ax, seed),
    'ornament.count': { v: 0, from: 'auto' }, 'filter.count': { v: 0, from: 'auto' },
  };
  const cutOrnaments = (opts.ornaments || (own('ornament') && def.scope !== 'run' ? [def] : []));
  cutOrnaments.forEach((d, i) => { slots['ornament#' + i] = decision(reg, 'ornament', d.key, ax, H.hash32(seed, i)); });
  slots['ornament.count'].v = cutOrnaments.length;
  const t0 = 1, t1 = t0 + dur;
  const cut = { key: 'r1~0', line: 'r1', role: 'lyric', text, emph: S.graphemes(text).length > 3 ? [[0, 2]] : [], impact: !!opts.impact,
    note: null, t0, t1, a: t0 - 0.12, b: t1 + 0.25, repT: t0 + 0.5, lang, feat, fp: '', slots, els: {}, ground: 0, seamIn: -1 };
  cut.fp = H.hashJSON({ slots, text, aspect });
  const ground = decision(reg, 'ground', pick('ground'), ax, seed);
  const atmos = own('ornament') && def.scope === 'run' ? decision(reg, 'ornament', def.key, ax, seed) : { v: 'none', from: 'auto' };
  const duration = cut.b + 1;
  const seg = { key: 'gr1~0', t0: 0, t1: duration, cuts: ['r1~0'], ground, atmos, fp: H.hashJSON({ ground, atmos, aspect }) };
  const plan = { v: 1, hash: '', duration, design: { aspect, w, h, short: 1080 }, look,
    beats: opts.bpm === null ? null : { bpm: opts.bpm || 120, offset: 0.1, meter: 4 },
    lines: [{ id: 'r1', row: 'r1', index: 0, text, t0, t1, by: { start: 'auto', end: 'auto' }, cuts: ['r1~0'], locked: false, lang }],
    cuts: [cut], grounds: [seg], seams: [], impulses: [], warnings: [] };
  return plan;
}

function svcOf(reg, plan) { return { registry: reg, text: textService(plan.look.faces), strict: true }; }

function sampleTimes(lo, hi, marks) {
  const set = new Set([lo, lo + 1e-4, hi - 1e-4]);
  for (const m of marks) for (const d of [-1e-4, 0, 1e-4]) if (m + d >= lo && m + d < hi) set.add(m + d);
  const out = [...set].sort((a, b) => a - b);
  for (let k = 1; out.length < TIMES; k++) {
    const t = lo + ((hi - lo) * k) / (TIMES + 1);
    if (!out.includes(t)) out.push(t);
  }
  return out.sort((a, b) => a - b).slice(0, TIMES);
}

function assertFinite(scene, where) {
  const t = scene.table;
  for (const c of T.POSE) for (let i = 0; i < t.n; i++) if (!Number.isFinite(t.live[c][i])) assert.fail(where + ': pose ' + c + '[' + i + ']');
  for (let i = 0; i < t.n * 6; i++) if (!Number.isFinite(t.m[i])) assert.fail(where + ': world matrix of node ' + Math.floor(i / 6));
}

function assertClean(rec, where) {
  const s = rec.stats();
  assert.ok(s.balanced, where + ': save/restore unbalanced');
  assert.equal(s.alphaBad, 0, where + ': globalAlpha outside [0, 1]');
  assert.equal(s.nan, 0, where + ': NaN or Infinity passed to the context');
}

// Renders the scene at each local time into a fresh recorder → op hashes (every frame checked on the way).
function renderTimes(scene, plan, times, where) {
  const rec = REC.createRecorder();
  const W = plan.design.w, H0 = plan.design.h, scale = 360 / plan.design.short;
  const surf = REC.surfaceOf(rec.factory, Math.round(W * scale), Math.round(H0 * scale), false);
  const hashes = [];
  for (const tl of times) {
    const at = where + ' @' + tl.toFixed(4);
    F.evaluate(scene, tl);
    assertFinite(scene, at);
    const cam = F.cameraAt(scene, plan, scene.t0 + tl);
    for (const k of Object.keys(cam)) assert.ok(Number.isFinite(cam[k]), at + ': camera ' + k);
    const mark = rec.mark();
    REC.drawScene(surf.ctx, scene, { scale, cam, W, H: H0, pal: plan.look.palette, tl });
    assertClean(rec, at);
    hashes.push(rec.hash(mark));
  }
  return hashes;
}

// The flow paints of a scene (particles, lines, glyphs of materials): their particle counts.
function particlesOf(scene) {
  let n = 0;
  for (const rec of scene.stores.paint) if (rec.data && rec.data.Bk instanceof Uint8Array) n += rec.data.n;
  return n;
}

function runDirect(scene, list, t) {
  T.resetLive(scene.table);
  for (const b of list) b.run(scene.table.live, t, b);
}

function poseDiff(scene) {
  const t = scene.table;
  let worst = 0, where = '';
  for (const c of T.POSE) for (let i = 0; i < t.n; i++) {
    const d = Math.abs(t.live[c][i] - t.base[c][i]);
    if (d > worst) { worst = d; where = c + '[' + i + ']'; }
  }
  return { worst, where };
}

function checkIdentity(scene, kind, where) {
  const own = scene.behaviours.filter((b) => b.phase === BH.PH.MOTION && b.run !== BH.runDrift);
  if (!own.length) return;
  const probes = kind === 'arrive' ? [Math.max(...own.map((b) => b.t1)), Math.max(...own.map((b) => b.t1)) + 0.5]
    : [Math.min(...own.map((b) => b.t0)), Math.min(...own.map((b) => b.t0)) - 0.5];
  for (const t of probes) {
    runDirect(scene, own, t);
    const d = poseDiff(scene);
    assert.ok(d.worst <= EPS_POSE, where + ': identity rule broken at ' + d.where + ' by ' + d.worst);
  }
}

function checkDwellEdges(scene, where) {
  const own = scene.behaviours.filter((b) => b.phase === BH.PH.REST);
  if (!own.length) return;
  for (const t of [scene.times.rest - 1e-3, scene.times.rest, scene.times.out, scene.times.out + 1e-3]) {
    F.evaluate(scene, t);
    const d = poseDiff(scene);
    assert.ok(d.worst <= 1e-3, where + ': the dwell moves ' + d.where + ' at the envelope edge');
  }
}

// One filter material: 24 frames through a recording FxContext; every surface taken is given back.
function checkFilter(reg, def, aspect, where) {
  const run = () => {
    const rec = REC.createRecorder();
    const plan = makePlan(reg, null, aspect, TEXTS[0]);
    const svc = svcOf(reg, plan);
    const scene = BUILD.buildCut(plan.cuts[0], plan, svc);
    const scale = 360 / 1080, W = plan.design.w, H0 = plan.design.h;
    const surf = REC.surfaceOf(rec.factory, Math.round(W * scale), Math.round(H0 * scale), true);
    F.evaluate(scene, 0.8);
    REC.drawScene(surf.ctx, scene, { scale, pal: plan.look.palette, tl: 0.8 });
    const fx = REC.createRecordingFx(rec, { w: surf.w, h: surf.h, unit: scale, plan, cut: { tl: 0.8, dur: 2, impact: false, energy: 0.5 },
      seed: H.hash32('fx', def.key), allowTextAt: (def.needs || []).includes('textAt') });
    const ax = { f: plan.cuts[0].feat, look: { amounts: plan.look.amounts, mood: null, bpm: 120 } };
    const p = autoParams(reg, 'filter', def.key, ax, H.hash32('fx', aspect));
    const hashes = [];
    for (let k = 0; k < TIMES; k++) {
      const mark = rec.mark();
      fx.begin();
      const before = fx.outstanding();
      const out = def.apply(fx, surf, p, 1 + k * 0.1);
      assert.ok(out && out.canvas, where + ': apply must return a Surface');
      const extra = out === surf ? 0 : 1;
      assert.equal(fx.outstanding() - before, extra, where + ': surfaces taken must be given back');
      if (extra) fx.give(out);
      assertClean(rec, where + ' #' + k);
      hashes.push(rec.hash(mark));
    }
    return hashes;
  };
  assert.deepEqual(run(), run(), where + ': op hashes differ between runs');
}

// Every check of the harness for one definition (already in `reg`) in one aspect. Returns the particle count seen.
function checkDef(reg, def, aspect, n, share) {
  const where = def.kind + '/' + def.key + ' ' + aspect;
  if (def.kind === 'filter') { checkFilter(reg, def, aspect, where); return 0; }
  const text = TEXTS[n % TEXTS.length];
  const plan = makePlan(reg, def, aspect, text);
  const svc = svcOf(reg, plan);
  const ground = def.kind === 'ground' || (def.kind === 'ornament' && def.scope === 'run');
  const build = () => (ground ? BUILD.buildGround(plan.grounds[0], plan, svc) : BUILD.buildCut(plan.cuts[0], plan, svc));
  const scene = build();
  assert.ok(!scene.warnings.some((w) => w.code === 'part-error'), where + ': part-error');
  const times = ground ? sampleTimes(0, plan.duration, [0.5, plan.cuts[0].t0])
    : sampleTimes(scene.times.a, scene.times.b, [scene.times.rest, scene.times.out, 0]);
  const hashes = renderTimes(scene, plan, times, where);
  assert.deepEqual(renderTimes(build(), plan, times, where + ' (rebuilt)'), hashes, where + ': op hashes differ between two builds');
  if (def.kind === 'arrive' || def.kind === 'depart') checkIdentity(scene, def.kind, where);
  if (def.kind === 'dwell') checkDwellEdges(scene, where);
  const particles = particlesOf(scene);
  const budget = def.mine.cost.particles;
  assert.ok(particles <= Math.ceil(budget * share) + 8, where + ': ' + particles + ' particles > ' + budget + ' × ' + share);
  return particles;
}

// A definition whose scenes see env.mixShare (what build.js gives a scene where several materials meet, §5.9.4).
function withShare(def, share) {
  const wrap = (env) => Object.assign({}, env, { mixShare: share });
  if (typeof def.build === 'function') return Object.freeze(Object.assign({}, def, { build: (env, p) => def.build(wrap(env), p) }));
  return def;
}

// --- generated recipes -------------------------------------------------------------------------------------------

const TOKENS = ['ink', 'accent', 'shiftA', 'shiftB', 'muted', 'ground2'];
const FLOWS = ['particles', 'lines', 'glyphs'];

function genLayer(rng, kind, prim) {
  const inks = [];
  for (let k = 0, n = rng.int(1, 3); k < n; k++) inks.push(rng.chance(0.25) ? '#' + (rng.int(0, 0xffffff) | 0x404040).toString(16).padStart(6, '0').toUpperCase()
    : kind === 'ornament' && rng.chance(0.3) ? 'slot' : rng.pick(TOKENS));
  const move = [];
  for (let k = 0, n = rng.int(0, 2); k < n; k++) {
    const wave = rng.pick(R.WAVES), what = rng.pick(R.MOVE_WHAT);
    const max = R.LIMITS.moverAmp[what];
    move.push({ what, wave, amp: (rng.next() - 0.3) * max * (what === 'alpha' ? 0.3 : 0.4), hz: rng.range(0, 1.5),
      phase: rng.pick(R.PHASES), curve: wave === 'ramp' && rng.chance(0.5) ? rng.pick(['softEnds', 'quadOut', 'hushRushHush']) : null });
  }
  const flow = FLOWS.includes(prim);
  return {
    prim, shape: rng.pick(R.SHAPES), glyph: rng.pick(R.GLYPHS), inks, alpha: rng.range(0.3, 1),
    layer: rng.pick(R.LAYERS[kind]), place: { anchor: rng.pick(R.ANCHORS), x: rng.range(-0.1, 0.1), y: rng.range(-0.1, 0.1),
      spread: rng.range(0.6, 1.4) },
    size: [rng.range(0.006, 0.02), rng.range(0.02, 0.05)], count: flow ? rng.int(8, 70) : rng.int(1, 8),
    stroke: prim === 'shape' && rng.chance(0.3) ? 0.004 : prim === 'frame' ? 0.004 : 0, rot: [rng.range(-90, 0), rng.range(0, 90)],
    field: { dir: rng.range(0, 360), speed: rng.chance(0.2) ? 0 : rng.range(0.01, 0.3), sway: rng.range(0, 40), swayHz: rng.range(0, 1),
      spin: rng.range(-120, 120), life: rng.chance(0.4) ? [rng.range(0.5, 2), rng.range(2, 4)] : [0, 0],
      burst: rng.chance(0.25) ? rng.pick(R.BURSTS) : 'none' },
    move, appear: { at: rng.pick(R.APPEAR_AT), draw: rng.pick(R.DRAWS), dur: rng.range(0.2, 0.9) },
    style: rng.pick(R.FRAME_STYLES), pattern: rng.pick(R.PATTERNS), gap: rng.range(0.03, 0.1),
    fill: { type: rng.pick(['linear', 'radial']), angle: rng.range(-180, 180), stops: [[rng.pick(TOKENS), 0], [rng.pick(TOKENS), 1]] },
  };
}

function genKnobs(rng, kind) {
  const allowed = R.KNOB_KINDS[kind];
  return allowed.filter(() => rng.chance(0.4)).map((what) => ({ what }));
}

function genPart(rng, kind, scope) {
  const keys = BASE.all(kind).filter((d) => d.gate !== 'flash' && d.pool !== false && (kind !== 'ornament' || d.scope === scope))
    .map((d) => d.key);
  return { key: rng.pick(keys), params: {} };
}

function genRecipe(rng, kind) {
  switch (kind) {
    case 'ornament': {
      const scope = rng.chance(0.5) ? 'run' : 'cut';
      const prims = ['shape', 'frame', 'particles', 'lines', 'glyphs', 'pattern', 'fill'];
      const layers = [];
      for (let k = 0, n = rng.int(1, 4); k < n; k++) layers.push(genLayer(rng, kind, rng.pick(prims)));
      return { scope, follow: rng.pick(['text', 'own']), seed: rng.int(1, 999), layers, knobs: genKnobs(rng, kind),
        parts: rng.chance(0.2) ? [genPart(rng, kind, scope)] : [] };
    }
    case 'ground': {
      const layers = [genLayer(rng, kind, 'fill')];
      for (let k = 0, n = rng.int(0, 3); k < n; k++) layers.push(genLayer(rng, kind, rng.pick(['pattern', 'particles', 'shape', 'lines', 'glyphs'])));
      const parts = rng.chance(0.2) ? [genPart(rng, kind)] : [];
      return { seed: rng.int(1, 999), layers: parts.length ? layers.slice(1) : layers, parts, knobs: genKnobs(rng, kind) };
    }
    case 'arrive':
    case 'depart': {
      const cols = rng.shuffle(R.MOTION_COLS).slice(0, rng.int(1, 4));
      const tracks = cols.map((col) => {
        const [lo, hi] = R.LIMITS.track[col];
        const v = col === 'alpha' || col === 'reveal' ? rng.range(0, 0.5) : col === 'sx' || col === 'sy' ? rng.range(0.3, 2)
          : lo + (hi - lo) * rng.range(0.4, 0.6) + rng.range(-1, 1) * (hi - lo) * 0.05;
        const id = ['alpha', 'reveal', 'sx', 'sy'].includes(col) ? 1 : 0;
        return kind === 'arrive' ? { col, from: v, to: id } : { col, from: id, to: v };
      });
      const colCurve = rng.chance(0.4) ? { [cols[0]]: rng.pick(['quadOut', 'softEnds', 'holdThenDash']) } : {};
      return { motion: { unit: rng.pick(R.UNITS), tracks, colCurve, curve: rng.pick(['expoOut', 'backOut', 'quadIn', 'softEnds', 'dashStop']),
        dur: [0.3, 0.6], each: [0.01, 0.05], order: [rng.pick(['lead', 'tail', 'core', 'scatter', 'word'])] },
      parts: rng.chance(0.25) ? [genPart(rng, kind)] : [], knobs: genKnobs(rng, kind) };
    }
    case 'dwell':
    case 'lens': {
      const cols = kind === 'dwell' ? R.OSC_COLS_DWELL : R.OSC_COLS_LENS;
      const osc = [];
      for (let k = 0, n = rng.int(1, 3); k < n; k++) {
        const col = rng.pick(cols);
        osc.push({ col, amp: R.LIMITS.oscAmp[kind][col] * rng.range(-0.5, 0.5), hz: rng.range(0, 2), wave: rng.pick(R.OSC_WAVES),
          phase: kind === 'lens' ? 'same' : rng.pick(['same', 'index', 'word', 'rnd']), step: rng.range(0, 1) });
      }
      return { osc, parts: rng.chance(0.25) ? [genPart(rng, kind)] : [], knobs: genKnobs(rng, kind) };
    }
    default: {
      const keys = BASE.all('filter').filter((d) => d.gate !== 'flash').map((d) => d.key);
      const parts = rng.shuffle(keys).slice(0, rng.int(1, 2)).map((key) => ({ key, params: {} }));
      return { parts, mix: parts.map(() => rng.range(0.3, 1)) };
    }
  }
}

// Repairs a generated recipe until core/recipe accepts it: fewer items over a budget, calmer layers for the flash rule,
// fewer inner filters over the stack limits.
function valid(kind, raw) {
  let r = R.normalize(kind, raw).recipe;
  for (let pass = 0; pass < 12; pass++) {
    const probs = R.problems(kind, r, { registry: BASE });
    if (!probs.length) return r;
    const m = JSON.parse(JSON.stringify(r));
    for (const p of probs) {
      if (['cost', 'particles', 'nodes', 'shapes'].includes(p.code)) for (const l of m.layers) l.count = Math.max(1, Math.floor(l.count / 2));
      else if (p.code === 'flash') {
        const l = m.layers[Number(/\[(\d+)\]/.exec(p.path)[1])];
        l.move = l.move.filter((mv) => mv.what !== 'alpha');
        l.appear.dur = Math.max(0.2, l.appear.dur);
      } else if (p.code === 'filter-cost' || p.code === 'filter-passes') { m.parts = m.parts.slice(0, 1); m.mix = m.mix.slice(0, 1); }
      else if (p.code === 'ground-first') m.layers.unshift({ prim: 'fill' });
      else if (p.code === 'too-big') m.layers = m.layers.slice(0, 2);
    }
    r = R.normalize(kind, m).recipe;
  }
  return null;
}

const GEN_KINDS = ['ornament', 'ornament', 'ornament', 'ground', 'ground', 'arrive', 'depart', 'dwell', 'lens', 'filter'];

function generated(count, seed) {
  const rng = RNG.stream('mix-generated', seed);
  const out = [];
  while (out.length < count) {
    const kind = GEN_KINDS[out.length % GEN_KINDS.length];
    const recipe = valid(kind, genRecipe(rng, kind));
    if (recipe) out.push(entry(kind, recipe, { name: { ja: '生成' + out.length, en: 'Generated ' + out.length } }));
  }
  return out;
}

// --- SHAPE_LIB and derive ------------------------------------------------------------------------------------------

test('SHAPE_LIB: a frozen unit ShapeSpec for every SHAPES name, about one unit across and centred', () => {
  const B = MV.use('engine/scene/builder');
  assert.deepEqual(Object.keys(MIX.SHAPE_LIB).sort(), [...R.SHAPES].sort());
  assert.ok(Object.isFrozen(MIX.SHAPE_LIB));
  for (const name of R.SHAPES) {
    const spec = MIX.SHAPE_LIB[name];
    assert.ok(B.isShape(spec) && Object.isFrozen(spec), name);
    const [x0, y0, x1, y1] = B.shapeBounds(spec);
    assert.ok(x0 >= -0.55 && y0 >= -0.55 && x1 <= 0.55 && y1 <= 0.55, name + ' fits the unit box');
    assert.ok(x1 - x0 >= 0.3 && y1 - y0 >= 0.1, name + ' is not degenerate');
    assert.ok(Math.abs((x0 + x1) / 2) < 0.1 && Math.abs((y0 + y1) / 2) < 0.1, name + ' is centred');
  }
});

test('derive: a composite of every COMPOSITE_KIND and a variant of every MAT_KIND give definitions REG.extend accepts', () => {
  const defs = [];
  for (const kind of R.COMPOSITE_KINDS) {
    const got = MIX.derive(entry(kind, RECIPES[kind]), BASE);
    assert.deepEqual(got.problems, [], kind);
    assert.ok(got.def && got.def.kind === kind, kind);
    assert.equal(got.def.family, 'mine');
    defs.push(got.def);
  }
  for (const kind of R.MAT_KINDS) {
    const got = MIX.derive(entry(kind, VARIANTS[kind]), BASE);
    assert.deepEqual(got.problems, [], kind + ' variant');
    const base = BASE.get(kind, VARIANTS[kind].base);
    assert.equal(got.def.kind, kind);
    for (const k of ['make', 'build', 'apply', 'mix']) if (base[k]) assert.equal(typeof got.def[k], 'function', kind + '.' + k);
    defs.push(got.def);
  }
  const reg = REG.extend(BASE, defs, { strict: true });
  assert.equal(reg.all().length, BASE.all().length + defs.length);
  for (const def of defs) {
    assert.ok(/^myMat[0-9a-z]+$/.test(def.key));
    assert.deepEqual(Object.keys(def.mine).sort(), ['by', 'cost', 'id', 'media', 'rhash']);
    assert.equal(def.mine.id, 'm' + def.key.slice(5));
    assert.match(def.mine.rhash, /^[0-9a-f]{8}$/);
    assert.equal(typeof def.mine.cost.particles, 'number');
    assert.deepEqual([...def.mine.media], []);
  }
});

test('derive: labels fall back to name.ja, pool follows by, variant params become autos, shared autos coerce', () => {
  const ai = MIX.derive(entry('dwell', RECIPES.dwell, { by: 'ai', pool: undefined, name: { ja: 'ゆらぎ', en: '' }, blurb: null }), BASE).def;
  assert.deepEqual(ai.label, { ja: 'ゆらぎ', en: 'ゆらぎ' });
  assert.deepEqual(ai.blurb, { ja: 'ゆらぎ', en: 'ゆらぎ' });
  assert.equal(ai.pool, false);
  const user = MIX.derive(entry('dwell', RECIPES.dwell, { pool: undefined, name: { ja: 'ゆらぎ', en: 'Sway' } }), BASE).def;
  assert.equal(user.pool, true);
  assert.deepEqual(user.blurb, { ja: 'ゆらぎ', en: 'Sway' });
  const v = MIX.derive(entry('arrive', VARIANTS.arrive), BASE).def;
  assert.deepEqual(v.params.yFrom.auto, { value: 1.2 });
  assert.deepEqual(v.shared.dur.auto, { value: 1.1 });
  assert.deepEqual(v.shared.ease.auto, { value: 'softEnds' });
  const bad = MIX.derive(entry('arrive', { base: 'inkRise', params: { nope: 1, yFrom: 'x' }, shared: { dur: { value: 99 } } }), BASE);
  assert.ok(bad.def, 'unknown or unreadable params are dropped, not fatal');
  assert.deepEqual(bad.problems.map((p) => p.code).sort(), ['param', 'param']);
  assert.equal(bad.def.shared.dur.auto.value, 4, 'shared values clamp into the spec (§5.7.2 coerce)');
  // a composite's motion becomes the shared autos
  const m = MIX.derive(entry('arrive', { motion: { tracks: [{ col: 'y', from: 1, to: 0 }], curve: 'backOut', dur: [0.4, 0.9],
    each: [0.01, 0.03], order: ['core', 'lead'] } }), BASE).def;
  assert.deepEqual(m.shared.dur.auto, { range: [0.4, 0.9] });
  assert.deepEqual(m.shared.ease.auto, { value: 'backOut' });
  assert.deepEqual(m.shared.order.auto, { pick: ['core', 'lead'] });
});

test('derive refuses what core/recipe, the base registry or the kit refuse; recoverable items are dropped with a problem', () => {
  const codes = (got) => got.problems.map((p) => p.code);
  const refused = (kind, recipe, code, extra) => {
    const got = MIX.derive(entry(kind, recipe, extra), BASE);
    assert.equal(got.def, null, code);
    assert.ok(codes(got).includes(code), code + ' in ' + JSON.stringify(got.problems));
  };
  refused('arrive', { base: 'noSuchPart' }, 'no-base');
  refused('seam', { base: 'whiteFlash' }, 'flash-base');
  refused('filter', { base: 'invertBlink' }, 'flash-base');
  refused('filter', { parts: [{ key: 'flashPop', params: {} }], mix: [1] }, 'empty');
  refused('ornament', { layers: PATTERNS_5, scope: 'cut' }, 'cost');
  refused('ornament', { scope: 'cut', layers: [{ prim: 'fill', move: [{ what: 'alpha', wave: 'beat', amp: 0.8 }] }] }, 'flash');
  refused('ground', { layers: [{ prim: 'shape' }] }, 'ground-first');
  refused('depart', { mirrorOf: 'm1' }, 'mirror-missing');
  refused('dwell', RECIPES.dwell, 'rv-newer', { rv: 2 });
  refused('dwell', RECIPES.dwell, 'bad-name', { name: { ja: '' } });
  assert.equal(MIX.derive({}, BASE).def, null);
  assert.ok(MIX.derive({}, BASE).problems.length > 0);
  assert.equal(MIX.derive(null, BASE).def, null);
  const dropped = MIX.derive(entry('filter', { parts: [{ key: 'grainFilm', params: { grain: 'x' } }, { key: 'flashPop', params: {} },
    { key: 'noSuch', params: {} }], mix: [0.5, 1, 1] }), BASE);
  assert.ok(dropped.def, 'a flash filter and an unknown key are dropped; the stack keeps grainFilm');
  assert.deepEqual(codes(dropped).filter((c) => c.startsWith('part')).sort(), ['part-flash', 'part-param']);
  assert.ok(codes(dropped).includes('too-many') || codes(dropped).length >= 2);
  const scope = MIX.derive(entry('ornament', { scope: 'cut', parts: [{ key: 'petalFall', params: {} }, { key: 'cornerTicks', params: {} }] }), BASE);
  assert.ok(scope.def);
  assert.deepEqual(codes(scope).filter((c) => c.startsWith('part')), ['part-scope'], 'a run ornament inside a cut ornament');
  // two framing lenses (frames: true, DESIGN_2_1 §3.6): the second is dropped
  const framing = (key) => K.variant(BASE.get('lens', 'slowPush'), { key, frames: true, label: { ja: '寄り', en: 'Push' },
    blurb: { ja: '寄る', en: 'Pushes in' } });
  const lensBase = REG.createRegistry(BASE.all().concat([framing('framingOne'), framing('framingTwo')]));
  const frames = MIX.derive(entry('lens', { parts: [{ key: 'framingOne', params: {} }, { key: 'framingTwo', params: {} }] }), lensBase);
  assert.deepEqual(codes(frames), ['part-frames'], 'at most one framing lens');
  assert.equal(frames.def.frames, true);
});

test('derive: filter stacks bind their inner filters (stage, cost, passes, alphaSafe, needs) and stay flash-free', () => {
  const def = MIX.derive(entry('filter', RECIPES.filter), BASE).def;
  const a = BASE.get('filter', 'grainFilm'), b = BASE.get('filter', 'edgeShade');
  assert.equal(def.stage, a.stage);
  assert.equal(def.cost, Math.min(5, a.cost + b.cost));
  assert.equal(def.passes, a.passes + b.passes);
  assert.equal(def.alphaSafe, a.alphaSafe && b.alphaSafe);
  assert.notEqual(def.gate, 'flash');
  const after = MIX.derive(entry('filter', { parts: [{ key: 'afterImage', params: {} }], mix: [1] }), BASE).def;
  assert.ok(after.needs.includes('textAt'), 'needs are the union of the inner filters');
});

test('derive: needs, knobs (the ornament count knob), media params and mine.media', () => {
  const orn = MIX.derive(entry('ornament', FLURRY), BASE).def;
  assert.deepEqual([...orn.needs], ['beats'], 'a beat mover needs beats');
  const knob = Object.keys(orn.params);
  assert.equal(knob.length, 1);
  assert.ok(['count', 'quantity'].includes(knob[0]), 'the count knob (named as the registry allows)');
  assert.deepEqual(orn.params[knob[0]].auto, { value: 1 });
  assert.equal(orn.params[knob[0]].max, 1.5);
  const id = 'a3f9c2d17b0e4a5c6d7e8f901';
  const photo = { prim: 'media', src: id, size: [0.3, 0.3], place: { anchor: 'focus' } };
  const fixed = MIX.derive(entry('ornament', { scope: 'cut', layers: [photo, Object.assign({}, photo, { src: '' })] }), BASE).def;
  assert.deepEqual([...fixed.mine.media], [id], 'mine.media lists the fixed asset ids');
  assert.equal(fixed.params.src.type, 'media', "a layer with src '' gives the part param src");
  assert.ok(fixed.needs.includes('media'));
  const motion = MIX.derive(entry('arrive', { motion: { tracks: [{ col: 'blur', from: 0.3, to: 0 }, { col: 'ry', from: 60, to: 0 }] } }), BASE).def;
  assert.deepEqual([...motion.needs], ['blur', 'depth']);
});

// --- the effective registry ---------------------------------------------------------------------------------------

test('registryFor: the base itself without materials or pooled media; memoized per (base, materials, media)', () => {
  assert.equal(MIX.registryFor(BASE), BASE);
  assert.equal(MIX.registryFor(BASE, null, null), BASE);
  assert.equal(MIX.registryFor(BASE, { next: 1, list: [] }), BASE);
  assert.equal(MIX.registryFor(BASE, { next: 1, list: [] }, { list: [] }), BASE);
  const media = corpus.project('media').doc.media;
  const unpooled = { list: media.list.map((a) => Object.assign({}, a, { pool: false })) };
  assert.equal(MIX.registryFor(BASE, { next: 1, list: [] }, unpooled), BASE, 'only pooled assets become grounds');
  const mats = materials([entry('dwell', RECIPES.dwell), entry('ornament', FLURRY)]);
  const reg = MIX.registryFor(BASE, mats);
  assert.notEqual(reg, BASE);
  assert.equal(MIX.registryFor(BASE, mats), reg, 'same lists → the same registry');
  assert.equal(MIX.registryFor(BASE, mats, undefined), reg);
  assert.notEqual(MIX.registryFor(BASE, mats, media), reg, 'the media list is part of the key');
  assert.equal(reg.base, BASE);
  assert.equal(reg.baseVersion, BASE.version);
  assert.deepEqual([...reg.mine('ornament')], ['myMat' + mats.list[1].id.slice(1)]);
  assert.equal(reg.get('dwell', 'myMat' + mats.list[0].id.slice(1)), MIX.derive(mats.list[0], BASE).def, 'an unchanged entry keeps its def');
  // the four fixture materials of project_v21
  const doc = corpus.project('v21').doc;
  const v21 = MIX.registryFor(BASE, doc.materials, doc.media);
  assert.deepEqual([...v21.problems], []);
  assert.deepEqual(['arrive', 'dwell', 'ornament'].map((k) => v21.mine(k).length), [1, 1, 1]);
});

test('registryFor: version changes on meta edits only; rhash changes on body edits; baseVersion is constant', () => {
  const a = entry('ornament', FLURRY, { id: 'm7' });
  const other = entry('dwell', RECIPES.dwell, { id: 'm8' });
  const regA = MIX.registryFor(BASE, materials([a, other]));
  const body = Object.assign({}, a, { recipe: Object.assign({}, FLURRY, { layers: [Object.assign({}, PETALS, { alpha: 0.5, count: 60 })] }) });
  const regB = MIX.registryFor(BASE, materials([body, other]));
  assert.equal(regB.version, regA.version, 'a layer tweak keeps the version');
  assert.notEqual(regB.extra.myMat7.rhash, regA.extra.myMat7.rhash, 'and changes rhash');
  assert.equal(regB.get('dwell', 'myMat8'), regA.get('dwell', 'myMat8'), 'the unchanged entry keeps its def (per-entry memo)');
  for (const [field, value] of [['tags', ['bold']], ['season', 'winter'], ['pool', false]]) {
    const meta = Object.assign({}, a, { [field]: value });
    const regC = MIX.registryFor(BASE, materials([meta, other]));
    assert.notEqual(regC.version, regA.version, field + ' is read by the planner');
    assert.equal(regC.extra.myMat7.rhash, regA.extra.myMat7.rhash, field + ' is not a body edit');
    assert.equal(regC.baseVersion, BASE.version);
  }
  const named = Object.assign({}, a, { name: { ja: '別の名前', en: 'Renamed' } });
  assert.equal(MIX.registryFor(BASE, materials([named, other])).version, regA.version, 'a name is not read by the planner');
});

test('registryFor: an entry that fails is skipped and listed in problems as "<kind>/<key>: <code>"', () => {
  const good = entry('dwell', RECIPES.dwell, { id: 'ma' });
  const costly = entry('ornament', { scope: 'cut', layers: PATTERNS_5 }, { id: 'mb' });
  const newer = entry('lens', RECIPES.lens, { id: 'mc', rv: 5 });
  const broken = { id: 'md', kind: 'dwell' };
  const reg = MIX.registryFor(BASE, materials([good, costly, newer, broken]));
  assert.deepEqual([...reg.problems], ['ornament/myMatb: cost', 'lens/myMatc: rv-newer', 'dwell/myMatd: bad-by']);
  assert.ok(reg.get('dwell', 'myMata'));
  assert.equal(reg.get('ornament', 'myMatb'), null);
});

test('registryFor: a depart mirrors an earlier arrive material (time-reversed poses, reversed ease)', () => {
  const arrive = entry('arrive', { motion: { unit: 'glyph', tracks: [{ col: 'y', from: 0.8, to: 0 }, { col: 'rot', from: 40, to: 0 },
    { col: 'alpha', from: 0, to: 1 }], colCurve: { alpha: 'quadOut' }, curve: 'cubicOut', dur: [0.4, 0.4], each: [0.03, 0.03] } }, { id: 'm20' });
  const depart = entry('depart', { mirrorOf: 'm20' }, { id: 'm21' });
  const reg = MIX.registryFor(BASE, materials([arrive, depart]));
  assert.deepEqual([...reg.problems], []);
  const def = reg.get('depart', 'myMat21');
  assert.deepEqual(def.shared.ease.auto, { value: 'cubicIn' });
  assert.deepEqual(def.shared.dur.auto, { range: [0.4, 0.4] });
  assert.notEqual(reg.extra.myMat21.rhash, MIX.derive(depart, BASE, { list: [arrive, depart] }).def === null ? '' : 'x');
  // an arrive listed after the depart does not count (§5.7.3)
  const late = MIX.registryFor(BASE, materials([depart, arrive]));
  assert.deepEqual([...late.problems], ['depart/myMat21: mirror-missing']);
  // the exit at progress u equals the entrance at progress 1 − u (per glyph, without the stagger)
  const aDef = reg.get('arrive', 'myMat20');
  const plan = makePlan(reg, aDef, '16:9', 'ありがとう');
  const svc = svcOf(reg, plan);
  const inScene = BUILD.buildCut(plan.cuts[0], plan, svc);
  const inB = inScene.behaviours.find((b) => b.run === BH.runGlyphMotion);
  plan.cuts[0].slots.depart = decision(reg, 'depart', 'myMat21', { f: plan.cuts[0].feat, look: { amounts: {}, mood: null, bpm: 120 } }, 1);
  plan.cuts[0].slots.depart.p.dur = inB.dur; plan.cuts[0].slots.depart.p.each = 0; plan.cuts[0].slots.depart.p.ease = 'cubicIn';
  const outScene = BUILD.buildCut(plan.cuts[0], plan, svc);
  const outB = outScene.behaviours.filter((b) => b.run === BH.runGlyphMotion).find((b) => b.exit);
  for (const u of [0.1, 0.35, 0.7]) {
    runDirect(inScene, [Object.assign({}, inB, { delay: new Float64Array(inB.delay.length) })], inB.t0 + (1 - u) * inB.dur);
    const want = T.POSE.map((c) => Array.from(inScene.table.live[c].slice(inB.from, inB.to)));
    runDirect(outScene, [outB], outB.t0 + u * outB.dur);
    const got = T.POSE.map((c) => Array.from(outScene.table.live[c].slice(outB.from, outB.to)));
    for (let c = 0; c < T.POSE.length; c++) {
      if (T.POSE[c] === 'x' || T.POSE[c] === 'px' || T.POSE[c] === 'py') continue;           // rest x differs with the layout
      for (let j = 0; j < want[c].length; j++) {
        const dw = want[c][j] - inScene.table.base[T.POSE[c]][inB.from + j], dg = got[c][j] - outScene.table.base[T.POSE[c]][outB.from + j];
        assert.ok(Math.abs(dw - dg) < 1e-3, T.POSE[c] + ' at u ' + u + ': ' + dw + ' vs ' + dg);
      }
    }
  }
});

test('registryFor: pooled media become myMed grounds (photoPan variants) in the same extend call', () => {
  const doc = corpus.project('media').doc;
  const reg = MIX.registryFor(BASE, doc.materials, doc.media);
  const pooledAssets = doc.media.list.filter((a) => a.pool);
  assert.deepEqual([...reg.mine('ground')], pooledAssets.map((a) => MEDIA.keyOf(a.id)).sort());
  for (const a of pooledAssets) {
    const def = reg.get('ground', MEDIA.keyOf(a.id));
    assert.equal(def.pool, true);
    assert.equal(def.weight, 1.5);
    assert.deepEqual(def.label, { ja: a.name, en: a.name });
    assert.deepEqual(def.tags, ['soft']);
    assert.equal(def.season, null);
    assert.deepEqual(def.params.image.auto, { value: a.id });
    assert.equal(def.mine.media, true);
    assert.equal(def.mine.id, a.id);
    assert.equal(def.mine.rhash, a.id);
    assert.equal(def.mine.cost.ms, R.LIMITS.cost.media);
    assert.equal(reg.extra[def.key].media, true);
  }
  // a video gets the song clock and no Ken Burns move when photoPan has those params (package G)
  const video = Object.assign({}, doc.media.list.find((a) => a.kind === 'video'), { pool: true });
  const vreg = MIX.registryFor(BASE, null, { list: [video] });
  const vdef = vreg.get('ground', MEDIA.keyOf(video.id));
  const photo = BASE.get('ground', 'photoPan');
  assert.equal(!!vdef.params.clock, !!photo.params.clock);
  if (photo.params.clock) assert.deepEqual(vdef.params.clock.auto, { value: 'song' });
  if (photo.params.move) assert.deepEqual(vdef.params.move.auto, { value: 'none' });
  // two ids with the same derived key: the later one is skipped
  const twin = Object.assign({}, video, { id: video.id.slice(0, 11) + 'ffffffffffffff', name: 'twin.mp4' });
  const both = MIX.registryFor(BASE, null, { list: [video, twin] });
  assert.deepEqual([...both.problems], ['ground/' + MEDIA.keyOf(video.id) + ': media-key']);
  assert.equal(both.mine('ground').length, 1);
});

// Timing (§7.2: registryFor runs when doc.materials changes identity; §8.3 acceptance). A document edit gives a new
// doc.materials in which the untouched entries keep their identity (structural sharing), so the effective registry is
// re-composed from the memoized definitions plus the one entry that changed. Like the planner's speed tests on this
// shared machine, the JIT is warmed first and the best of eight batches of edits is compared with the budget; the
// first composition of a document (every entry new) is reported and bounded loosely.
test('registryFor stays within its budget: 64 materials ≤ 3 ms, with 200 assets (20 pooled) ≤ 4 ms (§7.2, §8.3)', (t) => {
  const kinds = ['ornament', 'ground', 'arrive', 'depart', 'dwell', 'lens', 'filter', 'ornament'];
  const doc64 = (round) => {
    const list = [];
    for (let i = 0; i < 64; i++) {
      const kind = kinds[i % kinds.length];
      const recipe = i % 8 === 7 ? FLURRY : i % 3 === 0 && VARIANTS[kind] ? VARIANTS[kind] : RECIPES[kind];
      list.push(entry(kind, JSON.parse(JSON.stringify(recipe)), { id: 'm' + (1000 + round * 64 + i).toString(36) }));
    }
    return list;
  };
  const media = { list: [] };
  for (let i = 0; i < 200; i++) {
    media.list.push({ id: 'a' + i.toString(16).padStart(10, '0') + 'f'.repeat(14), kind: i % 5 ? 'image' : 'video', name: 'photo' + i + '.jpg',
      pool: i % 10 === 0, w: 1920, h: 1080 });
  }
  const time = (fn) => { const t0 = process.hrtime.bigint(); fn(); return Number(process.hrtime.bigint() - t0) / 1e6; };
  for (let k = 0; k < 3; k++) MIX.registryFor(BASE, materials(doc64(k)), { list: media.list.slice() });   // warm up the JIT
  const cold = [3, 4, 5].map((k) => time(() => MIX.registryFor(BASE, materials(doc64(k)))));
  const list = doc64(6);
  MIX.registryFor(BASE, materials(list), media);
  const edits = (withMedia) => {
    const batches = [];
    let n = 0;
    for (let b = 0; b < 8; b++) {
      let ms = 0;
      for (let i = 0; i < 5; i++, n++) {
        const edited = list.slice();
        edited[n % 64] = Object.assign({}, list[n % 64], { tags: n % 2 ? ['bold'] : ['soft', 'slow'] });
        ms += time(() => MIX.registryFor(BASE, materials(edited), withMedia ? media : undefined));
      }
      batches.push(ms / 5);
    }
    return batches;
  };
  const plain = edits(false), both = edits(true);
  const reg = MIX.registryFor(BASE, materials(list), media);
  assert.equal(reg.mine('ground').filter((k) => k.startsWith('myMed')).length, 20);
  assert.equal(REG.KINDS.reduce((a, k) => a + reg.mine(k).length, 0), 84);
  const fmt = (xs) => xs.map((x) => x.toFixed(2)).join(' ');
  t.diagnostic('registryFor after an edit: 64 materials best ' + Math.min(...plain).toFixed(2) + ' ms (' + fmt(plain) + '); with 200 assets ' +
    Math.min(...both).toFixed(2) + ' ms (' + fmt(both) + '); a first composition of 64 new materials ' + fmt(cold) + ' ms');
  assert.ok(Math.min(...plain) <= 3, 'registryFor with 64 materials: ' + fmt(plain) + ' ms');
  assert.ok(Math.min(...both) <= 4, 'registryFor with 64 materials and 200 assets: ' + fmt(both) + ' ms');
  assert.ok(Math.min(...cold) <= 40, 'a first composition took ' + fmt(cold) + ' ms');
});

test('materialHash: 8 hex digits of the normalized entry; stable across key order, changed by any field', () => {
  const e = entry('ornament', FLURRY, { id: 'm5' });
  const h = MIX.materialHash(e);
  assert.match(h, /^[0-9a-f]{8}$/);
  const reversed = (v) => (Array.isArray(v) ? v.map(reversed) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().reverse().map((k) => [k, reversed(v[k])])) : v);
  assert.equal(MIX.materialHash(reversed(e)), h);
  assert.equal(MIX.materialHash(Object.assign({}, e, { recipe: R.normalize('ornament', FLURRY).recipe })), h, 'normalized recipe');
  for (const patch of [{ name: { ja: '桜', en: 'Sakura' } }, { tags: ['bold'] }, { pool: false },
    { recipe: Object.assign({}, FLURRY, { seed: 8 }) }]) {
    assert.notEqual(MIX.materialHash(Object.assign({}, e, patch)), h, JSON.stringify(patch));
  }
  assert.match(MIX.materialHash({}), /^[0-9a-f]{8}$/);
  assert.match(MIX.materialHash(null), /^[0-9a-f]{8}$/);
});

// --- documents without materials ---------------------------------------------------------------------------------

test('documents without materials plan exactly as before (the base registry itself, the same plan hash)', () => {
  for (const name of corpus.PROJECTS) {
    const doc = corpus.project(name).doc;
    const reg = MIX.registryFor(BASE, doc.materials, doc.media);
    assert.equal(reg, BASE, name);
    assert.equal(PLAN.run(doc, reg, { fresh: true }).hash, PLAN.run(doc, BASE, { fresh: true }).hash, name);
  }
});

// --- the interpreters -------------------------------------------------------------------------------------------

test('sampleDefs: one composite per COMPOSITE_KIND plus a run ornament; keys myMatS…, which no registry accepts', () => {
  const defs = MIX.sampleDefs(BASE);
  const kinds = defs.map((d) => d.kind + (d.kind === 'ornament' ? ':' + d.scope : ''));
  assert.deepEqual(kinds.slice().sort(), ['arrive', 'depart', 'dwell', 'filter', 'ground', 'lens', 'ornament:cut', 'ornament:run']);
  for (const d of defs) {
    assert.ok(d.key.startsWith('myMatS'), d.key);
    assert.equal(d.family, 'mine');
    assert.equal(REG.extend(BASE, [d]).problems.length, 1, d.key + ' is refused by extend');
  }
  assert.equal(MIX.sampleDefs().length, 7, 'without a base registry the filter stack is left out');
  const atmos = defs.find((d) => d.kind === 'ornament' && d.scope === 'run');
  assert.ok(atmos.mine.cost.ms <= R.LIMITS.ms.ornamentRun, 'the cherry flurry costs ' + atmos.mine.cost.ms + ' ms');
});

test('conformance: sampleDefs × 7 aspects × 24 times (no NaN, balanced, identity, same op hash twice, particle budget)', () => {
  const defs = MIX.sampleDefs(BASE).map((d) => rekey(d));
  const reg = registryWith(defs);
  defs.forEach((def, n) => { for (const aspect of ASPECTS) checkDef(reg, def, aspect, n, 1); });
});

test('conformance: 40 generated recipes × 7 aspects × 24 times', () => {
  const list = generated(GENERATED, 1);
  const reg = MIX.registryFor(BASE, materials(list));
  assert.deepEqual([...reg.problems], []);
  const kinds = new Set();
  list.forEach((e, n) => {
    const def = reg.get(e.kind, 'myMat' + e.id.slice(1));
    kinds.add(def.kind);
    for (const aspect of ASPECTS) checkDef(reg, def, aspect, n, 1);
  });
  assert.deepEqual([...kinds].sort(), [...R.COMPOSITE_KINDS].sort());
});

test('mixShare: interpreters multiply particle counts by env.mixShare (read as 1 when absent)', () => {
  const plain = MIX.sampleDefs(BASE).filter((d) => d.kind === 'ornament' || d.kind === 'ground');
  const shares = [1, 0.4, 0.1];
  for (const def of plain) {
    const counts = shares.map((s, i) => {
      const reg = registryWith([rekey(withShare(def, s), i + 1)]);
      const d = reg.get(def.kind, 'myMatz' + (i + 1).toString(36));
      return checkDef(reg, d, '16:9', 0, s);
    });
    assert.ok(counts[0] > 0, def.key + ' draws particles');
    assert.ok(counts[1] < counts[0] && counts[2] < counts[1], def.key + ': ' + counts.join(' > '));
  }
  // three material ornaments and an atmosphere: the §5.9.4 share keeps the scene within 400 particles
  const heavy = (n) => MIX.derive(entry('ornament', { scope: 'cut', follow: 'own',
    layers: [Object.assign({}, PETALS, { count: 240, size: [0.004, 0.006], move: [] })] }, { id: 'm' + n }), BASE).def;
  const ornaments = [heavy(40), heavy(41), heavy(42)];
  const total = ornaments.reduce((a, d) => a + d.mine.cost.particles, 0);
  const share = Math.min(1, 400 / total);
  const reg = registryWith(ornaments.map((d) => withShare(d, share)));
  const plan = makePlan(reg, null, '16:9', TEXTS[0], { ornaments: ornaments.map((d) => reg.get('ornament', d.key)) });
  const scene = BUILD.buildCut(plan.cuts[0], plan, svcOf(reg, plan));
  assert.ok(particlesOf(scene) <= 400, particlesOf(scene) + ' particles');
});

test('flash rule at build: large layers pulse at most 3 times a second; particle life never blinks faster', () => {
  const big = { prim: 'particles', shape: 'dot', count: 120, size: [0.05, 0.06], field: { speed: 0.2, burst: 'beat', life: [0, 0] },
    appear: { at: 'beat', draw: 'fade', dur: 0.2 }, layer: 'mid' };
  const recipe = R.normalize('ornament', { scope: 'cut', layers: [big] }).recipe;
  assert.deepEqual(R.problems('ornament', recipe), [], 'core/recipe accepts it (fade 0.2 s ≥ 0.15 s)');
  const def = MIX.derive(entry('ornament', recipe, { id: 'm60' }), BASE).def;
  const reg = registryWith([def]);
  const plan = makePlan(reg, def, '16:9', TEXTS[0], { bpm: 200 });
  const scene = BUILD.buildCut(plan.cuts[0], plan, svcOf(reg, plan));
  const d = scene.stores.paint.find((p) => p.data && p.data.Bk).data;
  assert.ok(d.period >= 1 / 3 - 1e-9, 'bursts every ' + d.period + ' s at 200 BPM');
  assert.ok(d.attack >= 0.15, 'large bursts fade in over ' + d.attack + ' s');
  const small = MIX.derive(entry('ornament', { scope: 'cut', layers: [Object.assign({}, big, { count: 10, size: [0.01, 0.01],
    field: { speed: 0.1, life: [0.05, 0.1] } })] }, { id: 'm61' }), BASE).def;
  const reg2 = registryWith([small]);
  const plan2 = makePlan(reg2, small, '16:9', TEXTS[0], { bpm: 200 });
  const d2 = BUILD.buildCut(plan2.cuts[0], plan2, svcOf(reg2, plan2)).stores.paint.find((p) => p.data && p.data.Bk).data;
  assert.ok(d2.period < 1 / 3, 'a small layer keeps every beat');
  assert.ok(Array.from(d2.lf).every((x) => x >= 1 / 3 - 1e-6), 'life ≥ 1/3 s');
});

test('paints and behaviours are closed-form in t: frame N directly equals frame N after frames 0..N−1', () => {
  const defs = MIX.sampleDefs(BASE).filter((d) => d.kind !== 'filter').map((d) => rekey(d));
  const reg = registryWith(defs);
  for (const def of defs) {
    const plan = makePlan(reg, def, '9:16', TEXTS[1]);
    const ground = def.kind === 'ground' || def.scope === 'run';
    const build = () => (ground ? BUILD.buildGround(plan.grounds[0], plan, svcOf(reg, plan)) : BUILD.buildCut(plan.cuts[0], plan, svcOf(reg, plan)));
    const times = [];
    for (let i = 0; i < 40; i++) times.push((ground ? 0 : -0.1) + i / 30);
    // the recorder numbers the gradients it hands out (the fallback ground makes one per frame): compare without them
    const lastOps = (scene, list) => {
      const rec = REC.createRecorder();
      const surf = REC.surfaceOf(rec.factory, 200, 356, false);
      let out = null;
      for (const t of list) {
        F.evaluate(scene, t);
        const mark = rec.mark();
        REC.drawScene(surf.ctx, scene, { scale: 200 / 1080, pal: plan.look.palette, tl: t });
        out = JSON.stringify(rec.ops().slice(mark)).replace(/"g\d+(\.addColorStop)?"/g, '"g$1"');
      }
      return out;
    };
    assert.equal(lastOps(build(), [times[times.length - 1]]), lastOps(build(), times), def.key);
  }
});

test('a material with every primitive, anchor and appear builds and draws in cut and ground scenes', () => {
  const prims = ['shape', 'frame', 'particles', 'lines', 'glyphs', 'pattern', 'fill'];
  let n = 70;
  for (const anchor of R.ANCHORS) {
    for (const at of R.APPEAR_AT) {
      const draw = R.DRAWS[n % R.DRAWS.length];
      const layers = prims.slice(0, 5).map((prim, i) => ({ prim, count: prim === 'shape' ? 4 : 20, size: [0.01, 0.03],
        place: { anchor, spread: 1 }, appear: { at, draw, dur: 0.3 }, style: R.FRAME_STYLES[i], field: { speed: 0.1, burst: R.BURSTS[i % 4] },
        move: [{ what: R.MOVE_WHAT[i], wave: R.WAVES[(n + i) % R.WAVES.length], amp: 0.1, hz: 0.5, phase: R.PHASES[i % 3] }] }));
      layers.push({ prim: 'pattern', pattern: R.PATTERNS[n % 5], gap: 0.05, size: [0.004, 0.008], alpha: 0.3, layer: 'far',
        place: { anchor, spread: 1 }, appear: { at, draw: draw === 'none' ? 'fade' : draw, dur: 0.3 } });
      const def = MIX.derive(entry('ornament', { scope: n % 2 ? 'run' : 'cut', follow: n % 3 ? 'text' : 'own', layers }, { id: 'm' + (n++).toString(36) }), BASE);
      assert.ok(def.def, anchor + ' ' + at + ': ' + JSON.stringify(def.problems));
      const reg = registryWith([def.def]);
      checkDef(reg, reg.get('ornament', def.def.key), '4:5', n, 1);
    }
  }
});

// --- the media layer through K.media (package B's kit export) ------------------------------------------------------

// A second module world (a vm context) whose parts/kit also exports K.media: a recorder of its calls that returns a
// group node (or −1 for an empty source), as the FROZEN §11.5.6 signature says. The main world's kit has no K.media
// until package B lands; there media layers are skipped.
function mediaWorld() {
  const calls = [];
  const ctx = vm.createContext({ console, __calls: calls });
  vm.runInContext(fs.readFileSync(path.join(SRC, 'core', 'define.js'), 'utf8'), ctx);
  vm.runInContext('MV.DEV = true; MV.LANG = "ja"; const def0 = MV.def; MV.def = (id, deps, factory) => def0(id, deps, id !== "parts/kit" ? factory ' +
    ': (...a) => { const K = factory(...a); if (typeof K.media === "function") return K; return Object.assign({}, K, { media(env, o) { ' +
    '__calls.push({ src: o.src, use: o.use, layer: o.layer, box: o.box, comp: o.comp, alpha: o.alpha, mask: !!o.mask, window: o.window, ' +
    'fit: o.p.fit, speed: o.p.speed, blur: o.p.blur, depth: o.p.depth }); if (!o.src) return -1; return env.sb.group({ parent: o.parent, layer: o.layer, owner: o.owner }); } }); });', ctx);
  for (const rel of listSources()) if (rel !== 'core/define.js') vm.runInContext(fs.readFileSync(path.join(SRC, rel), 'utf8'), ctx, { filename: rel });
  return { MV: ctx.MV, calls };
}

test('media layers draw through K.media when the kit exports it and are skipped without it (§11.5.8)', () => {
  const id = 'a3f9c2d17b0e4a5c6d7e8f901';
  const recipe = { scope: 'cut', follow: 'text', layers: [
    { prim: 'media', src: id, fit: 'contain', size: [0.3, 0.35], shape: 'circle', border: 6, inks: ['accent'], comp: 'screen',
      place: { anchor: 'focus' }, time: { speed: 1.5 }, appear: { at: 'arrive', draw: 'grow', dur: 0.5 } },
    { prim: 'media', src: '', place: { anchor: 'frame' }, layer: 'near' }] };
  // without K.media (this world): the layers are skipped, nothing throws, the rest of the material still draws
  const plain = MIX.derive(entry('ornament', recipe, { id: 'm80' }), BASE).def;
  const reg = registryWith([plain]);
  checkDef(reg, reg.get('ornament', plain.key), '16:9', 0, 1);
  // with K.media: one call per layer with a source; '' comes from the part param `src`
  const W = mediaWorld();
  const MIX2 = W.MV.use('parts/mix'), BASE2 = W.MV.use('parts/catalog').defaultRegistry();
  const def = MIX2.derive(entry('ornament', recipe, { id: 'm81' }), BASE2).def;
  const reg2 = W.MV.use('core/registry').extend(BASE2, [def], { strict: true });
  const plan = makePlan(reg2, def, '16:9', TEXTS[0]);
  const svc = { registry: reg2, text: W.MV.use('engine/text/service').createTextService({ measurer: W.MV.use('engine/text/fake_measure').fakeMeasurer(),
    faces: plan.look.faces }), strict: true };
  plan.cuts[0].slots['ornament#0'].p.src = 'a2d4f6a8b0c2d4e6f8a0b2c4d';
  const scene = W.MV.use('engine/scene/build').buildCut(plan.cuts[0], plan, svc);
  assert.equal(W.calls.length, 2);
  const [fixed, param] = JSON.parse(JSON.stringify(W.calls));
  assert.deepEqual([fixed.src, fixed.use, fixed.comp, fixed.fit, fixed.speed, fixed.mask], [id, 'frame', 'screen', 'contain', 1.5, true]);
  assert.equal(fixed.depth, 'anim', 'the recipe places the picture itself (§11.9.3 anim)');
  assert.equal(Math.round(fixed.box.w), Math.round(0.35 * 1080));
  assert.deepEqual([param.src, param.use, param.layer], ['a2d4f6a8b0c2d4e6f8a0b2c4d', 'layer', 'near']);
  assert.ok(scene.behaviours.some((b) => b.phase === BH.PH.ORNAMENT), 'the grow appear moves the picture');
  W.calls.length = 0;
  plan.cuts[0].slots['ornament#0'].p.src = '';
  W.MV.use('engine/scene/build').buildCut(plan.cuts[0], plan, svc);
  assert.deepEqual(W.calls.map((c) => c.src), [id], "an empty src param builds nothing (as K.media would return −1)");
});

test('the §2.1 cherry flurry: a valid run ornament of ≤ 1.5 ms static cost that draws its petals in batches', () => {
  const def = MIX.derive(entry('ornament', FLURRY, { id: 'm90' }), BASE).def;
  assert.ok(def.mine.cost.ms <= 1.5, 'static cost ' + def.mine.cost.ms);
  assert.equal(def.scope, 'run');
  const reg = registryWith([def]);
  const plan = makePlan(reg, def, '16:9', TEXTS[0]);
  const scene = BUILD.buildGround(plan.grounds[0], plan, svcOf(reg, plan));
  const rec = REC.createRecorder();
  const surf = REC.surfaceOf(rec.factory, 640, 360, false);
  const C = MV.use('core/color');
  const pal = plan.look.palette;
  const q = { draft: false, scale: 1 / 3, pal, rgba: (ink, a) => C.rgba(REC.inkOf(pal, ink), a), tile: () => null };
  const paint = scene.stores.paint.find((p) => p.data && p.data.Bk instanceof Uint8Array);
  assert.equal(paint.data.n, 90);
  const bits = (u) => { let n = 0; for (let x = u; x; x &= x - 1) n++; return n; };
  for (const t of [0.3, 2, 7.5]) {
    const mark = rec.mark();
    paint.draw(surf.ctx, t, paint.data, q);
    const fills = rec.ops().slice(mark).filter((o) => o[1] === 'fill').length;
    const steps = Array.from(paint.data.used).reduce((a, u) => a + bits(u), 0);
    assert.equal(fills, steps, 'one fill per ink and alpha step at t ' + t);
    assert.ok(steps > 0 && steps <= 2 * 16, steps + ' alpha steps for 90 petals of 2 inks');
  }
  assertClean(rec, 'cherry flurry');
});

// §5.11 from the runtime's side: materials pinned where the fitting table puts them (line arrive, dwell, atmos, an
// ornament slot, a line ground from pooled media) are chosen by the planner and render through the engine facade.
test('fitting (§5.11): the v2.1 fixtures plan with their materials in place and render through the facade', () => {
  const FAC = MV.use('engine/facade');
  for (const name of corpus.V21_PROJECTS) {
    const doc = corpus.project(name).doc;
    const reg = MIX.registryFor(BASE, doc.materials, doc.media);
    const plan = PLAN.run(doc, reg, { fresh: true });
    // (photoFrame, pinned in the media fixture, is a part package G adds: its pin waits for it)
    const mine = (w) => w.code === 'material-bad' || (w.code === 'pin-bad-value' && /^myM(at|ed)/.test(String((doc.pins[w.path] || {}).v)));
    assert.deepEqual(plan.warnings.filter(mine), [], name);
    const cutsOf = (line) => plan.cuts.filter((c) => c.line === line);
    const groundsOf = (line) => plan.grounds.filter((g) => g.cuts.some((k) => cutsOf(line).some((c) => c.key === k)));
    if (name === 'v21') {
      for (const c of cutsOf('r7')) assert.equal(c.slots.arrive.v, 'myMat1');
      for (const c of cutsOf('r8')) assert.equal(c.slots.dwell.v, 'myMat2');
      for (const g of groundsOf('rb')) {
        assert.equal(g.atmos.v, 'myMat3');
        const knob = Object.keys(reg.get('ornament', 'myMat3').params)[0];
        assert.equal(g.atmos.p[knob], knob === 'count' ? 1.2 : 1, 'the count knob (its pin applies once the registry takes the name)');
      }
    } else {
      for (const c of cutsOf('r5')) assert.equal(c.slots['ornament#1'].v, 'myMat1');
      for (const g of groundsOf('r3')) assert.equal(g.ground.v, 'myMed2d4f6a8b0c');
    }
    const rec = REC.createRecorder();
    const engine = FAC.createEngine({ registry: reg, canvas: rec.factory, measurer });
    engine.setDoc(doc);
    const surf = REC.surfaceOf(rec.factory, 320, 180, false);
    for (let t = 0; t < engine.plan.duration; t += 0.41) engine.renderFrame(surf, t, { quality: 'preview', scale: 320 / 1920 });
    assert.deepEqual(engine.warnings().filter((w) => w.code === 'part-error'), [], name);
    assertClean(rec, name);
  }
});
