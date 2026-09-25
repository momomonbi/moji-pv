/* 文字PVメーカー v2 — original work. Part conformance: every registered part × aspects × orientations × texts × times (DESIGN §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');
const examples = require('../fixtures/example_parts.js');

// The runner iterates every part of the registry it is given: the stub parts, the DESIGN §4.18 examples, and the real
// catalog as soon as parts/catalog exists. Each case builds a one-cut Plan whose other slots hold the fallback parts,
// builds the scene strictly (a throwing part fails the test), evaluates it at 24 times and draws it through the
// recording backend. Every part runs the full §8.2 matrix; MV_CONFORMANCE=quick runs a sampled matrix instead (every
// aspect, text and orientation still appears, in rotation) for fast local runs.
//
// The catalog is read part module by part module and validated non-strictly, so the parts that are valid are tested
// while other packages are still adding theirs; module errors and registry problems fail a test of their own. Kinds the
// catalog has no fallback for yet borrow the minimal fallback parts (tests/helpers/corpus.js) as hosts.

const MV = load();
const H = MV.use('core/hash');
const RNG = MV.use('core/rng');
const SCH = MV.use('core/schema');
const S = MV.use('core/script');
const DOC = MV.use('core/doc');
const REG = MV.use('core/registry');
const V = MV.use('engine/text/vert');
const FACES = MV.use('engine/text/faces');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const T = MV.use('engine/scene/table');
const BH = MV.use('engine/scene/behave');
const BUILD = MV.use('engine/scene/build');
const F = MV.use('engine/scene/frame');
const R = MV.use('engine/render/record');

const ASPECTS = DOC.ASPECTS;
const TIMES = 24;
const QUICK = process.env.MV_CONFORMANCE === 'quick';
const PART_MODULE = /^parts\/(arrange|arrive|dwell|depart|ground|ornament|lens|filter|seam|theme|mood)\//;   // DESIGN §4.6
const BUILD_MS = 20;                       // DESIGN §8.2 budget (median); the max gets a ×3 margin for shared CI CPUs
const TEXTS = Object.freeze([
  { name: 'short ja', text: 'はじまりの朝' },
  { name: 'long ja', text: '夜明けの街を走るまだ遠い空の色を探して君の名前を呼ぶ声が届くまでずっと歩いていく' },
  { name: 'en', text: 'Paper planes in the morning light' },
  { name: 'mixed', text: '今日はSunday morningだね' },
  { name: 'emoji', text: '🎉ありがとう👍✨' },
  { name: 'one grapheme', text: '愛' },
]);
const EPS_POSE = 1e-4;

const measurer = fakeMeasurer();
const shared = { text: new Map() };       // one text service (and layout cache) per faces, like the facade

// --- plans for one part --------------------------------------------------------------------------------------------

function textService(faces) {
  const key = H.hashJSON(faces);
  if (!shared.text.has(key)) shared.text.set(key, createTextService({ measurer, faces }));
  return shared.text.get(key);
}

function langOf(text) { return S.lineScript(text, 'ja'); }

function featuresOf(text, lang, dur, role) {
  const cells = S.cells(text);
  const orients = (lang === 'ja' || lang === 'zhHant' || lang === 'zhHans') && V.longestLatinRun(text) <= 12 ? ['h', 'v'] : ['h'];
  const graphemes = S.graphemes(text).length;
  return { cells, graphemes, script: lang, latin: 0, orients, words: 2, units: { glyph: graphemes, word: 2, line: 1 },
    emph: false, impact: false, dur, cps: cells / dur, energy: 0.55, beat: 0.5, onBeat: true, section: null, repeatOf: null,
    pos: 0.3, role };
}

function autoParams(reg, kind, key, ax, seed) {
  const p = {};
  for (const { name, spec } of reg.params(kind, key)) {
    p[name] = SCH.autoValue(spec, Object.assign({}, ax, { rng: RNG.stream(seed, 'param', name) }));
  }
  return p;
}

function decision(reg, kind, key, ax, seed) {
  return { v: key, p: autoParams(reg, kind, key, ax, H.hash32(seed, kind, key)), from: 'auto' };
}

function roleFor(def) {
  const roles = (def.traits && def.traits.roles) || REG.TRAIT_DEFAULTS.roles;
  return roles.includes('lyric') ? 'lyric' : roles[0];
}

function hostArrange(reg, orient, role) {
  const fb = reg.fallback('arrange');
  const ok = (key) => { const t = reg.traits('arrange', key); return t.orient.includes(orient) && t.roles.includes(role); };
  if (ok(fb)) return fb;
  return reg.keys('arrange').find(ok) || fb;
}

function lookOf(reg, overrides) {
  const theme = reg.get('theme', reg.fallback('theme'));
  const mood = reg.get('mood', reg.fallback('mood'));
  const themeDef = (overrides && overrides.theme) || theme;
  const moodDef = (overrides && overrides.mood) || mood;
  const faces = JSON.parse(JSON.stringify(FACES.resolveFaces(themeDef, null, ['ja', 'en', 'ko', 'zhHant', 'zhHans'])));
  return { mood: { v: moodDef.key, from: 'auto' }, theme: { v: themeDef.key, from: 'auto' }, season: { v: 'any', from: 'auto' },
    amounts: Object.assign({}, moodDef.amounts), amountsFrom: {}, palette: Object.assign({}, themeDef.swatch), faces,
    texture: null, backdrop: 'scene', style: themeDef.style, moodDef };
}

function envelope(n) {
  const e = new Float32Array(n);
  for (let i = 0; i < n; i++) e[i] = 0.5 + 0.45 * Math.sin(i * 0.7) * Math.cos(i * 0.13);
  return e;
}

// makePlan({ reg, def, aspect, orient, text, look }) → a one-cut Plan in the §3.12 shape where the tested part fills its
// slot and every other slot holds its kind's fallback.
function makePlan(o) {
  const { reg, def, aspect, orient, text } = o;
  const look = o.look || lookOf(reg);
  const [w, h] = DOC.DESIGN_SIZE[aspect];
  const lang = langOf(text);
  const role = def && REG.PART_KINDS.includes(def.kind) ? roleFor(def) : 'lyric';
  const dur = Math.max(1.6, Math.min(5, 0.35 * S.graphemes(text).length));
  const feat = featuresOf(text, lang, dur, role);
  const ax = { f: feat, look: { amounts: look.amounts, mood: look.moodDef, bpm: 120 } };
  const seed = H.hash32('conformance', aspect, orient, text);
  const kindOf = (kind) => (def && def.kind === kind ? def.key : reg.fallback(kind));
  const slots = {
    orient: { v: orient, from: 'auto' },
    arrange: decision(reg, 'arrange', def && def.kind === 'arrange' ? def.key : hostArrange(reg, orient, role), ax, seed),
    'text.face': { v: 'display', from: 'auto' }, 'text.scale': { v: 1, from: 'auto' },
    'text.ink': { v: 'ink', from: 'auto' }, 'text.style': { v: look.style || 'plain', from: 'auto' },
    arrive: decision(reg, 'arrive', kindOf('arrive'), ax, seed),
    dwell: decision(reg, 'dwell', kindOf('dwell'), ax, seed),
    depart: decision(reg, 'depart', kindOf('depart'), ax, seed),
    'ornament.count': { v: def && def.kind === 'ornament' && def.scope !== 'run' ? 1 : 0, from: 'auto' },
    lens: decision(reg, 'lens', kindOf('lens'), ax, seed),
    'filter.count': { v: 0, from: 'auto' },
  };
  if (def && def.kind === 'ornament' && def.scope !== 'run') slots['ornament#0'] = decision(reg, 'ornament', def.key, ax, seed);
  const t0 = 1, t1 = t0 + dur;
  const emph = S.graphemes(text).length > 3 ? [[0, 2]] : [];
  const cut = { key: 'r1~0', line: 'r1', role, text, emph, impact: false, note: null, t0, t1, a: t0 - 0.12, b: t1 + 0.25,
    repT: t0 + 0.5, lang, feat, fp: '', slots, els: {}, ground: 0, seamIn: -1 };
  cut.fp = H.hashJSON({ slots, text, emph, role, span: cut.b - cut.a, palette: look.palette, faces: look.faces, aspect });
  const ground = def && def.kind === 'ground' ? decision(reg, 'ground', def.key, ax, seed) : decision(reg, 'ground', reg.fallback('ground'), ax, seed);
  const atmos = def && def.kind === 'ornament' && def.scope === 'run' ? decision(reg, 'ornament', def.key, ax, seed) : { v: 'none', from: 'auto' };
  const duration = cut.b + 1;
  const seg = { key: 'gr1~0', t0: 0, t1: duration, cuts: ['r1~0'], ground, atmos, fp: H.hashJSON({ ground, atmos, aspect, palette: look.palette }) };
  const { style, moodDef, ...planLook } = look;
  const plan = { v: 1, hash: '', duration, design: { aspect, w, h, short: 1080 }, look: planLook,
    beats: { bpm: 120, offset: 0.1, meter: 4 },
    lines: [{ id: 'r1', row: 'r1', index: 0, text, t0, t1, by: { start: 'auto', end: 'auto' }, cuts: ['r1~0'], locked: false, lang }],
    cuts: [cut], grounds: [seg], seams: [], impulses: [{ t: t0, kind: 'shake', amp: 0.3, decay: 0.4 }], warnings: [] };
  Object.defineProperty(plan, 'env', { enumerable: false, value: envelope(Math.ceil(duration * 20) + 4) });
  return plan;
}

// --- checks -----------------------------------------------------------------------------------------------------

function svcOf(reg, plan) { return { registry: reg, text: textService(plan.look.faces), strict: true }; }

function buildTimed(fn, stats) {
  const t = process.hrtime.bigint();
  const out = fn();
  stats.push(Number(process.hrtime.bigint() - t) / 1e6);
  return out;
}

function sampleTimes(lo, hi, marks) {
  const set = new Set([lo, lo + 1e-4]);
  for (const m of marks) for (const d of [-1e-4, 0, 1e-4]) if (m + d >= lo && m + d < hi) set.add(m + d);
  set.add(hi - 1e-4);
  const out = [...set].filter((t) => t >= lo && t < hi).sort((a, b) => a - b);
  for (let k = 1; out.length < TIMES; k++) {
    const t = lo + ((hi - lo) * k) / (TIMES + 1);
    if (!out.includes(t)) out.push(t);
  }
  return out.sort((a, b) => a - b).slice(0, TIMES);
}

function assertFinitePose(scene, where) {
  const t = scene.table;
  for (const c of T.POSE) {
    const col = t.live[c];
    for (let i = 0; i < t.n; i++) if (!Number.isFinite(col[i])) assert.fail(where + ': pose ' + c + '[' + i + '] = ' + col[i]);
  }
  for (let i = 0; i < t.n * 6; i++) if (!Number.isFinite(t.m[i])) assert.fail(where + ': world matrix of node ' + Math.floor(i / 6) + ' is not finite');
  for (let i = 0; i < t.n; i++) if (!Number.isFinite(t.wa[i])) assert.fail(where + ': world alpha of node ' + i + ' is not finite');
}

function assertCleanStats(rec, where) {
  const s = rec.stats();
  assert.ok(s.balanced, where + ': save/restore unbalanced (' + s.saves + '/' + s.restores + ', underflow ' + s.underflow + ')');
  assert.equal(s.alphaBad, 0, where + ': globalAlpha set outside [0, 1]');
  assert.equal(s.nan, 0, where + ': NaN or Infinity passed to the context');
}

// Draws the scene at each local time into a fresh recorder → the op hash per time (and every per-frame check);
// onCam(cam, where) sees each frame's camera.
function renderTimes(scene, plan, times, where, onCam) {
  const rec = R.createRecorder();
  const W = plan.design.w, H0 = plan.design.h, scale = 360 / plan.design.short;
  const surf = R.surfaceOf(rec.factory, Math.round(W * scale), Math.round(H0 * scale), false);
  const hashes = [];
  for (const tl of times) {
    const at = where + ' @' + tl.toFixed(4);
    F.evaluate(scene, tl);
    assertFinitePose(scene, at);
    const cam = F.cameraAt(scene, plan, scene.t0 + tl);
    for (const k of Object.keys(cam)) assert.ok(Number.isFinite(cam[k]), at + ': camera ' + k);
    if (onCam) onCam(cam, at);
    const mark = rec.mark();
    R.drawScene(surf.ctx, scene, { scale, cam, W, H: H0, pal: plan.look.palette, tl });
    assertCleanStats(rec, at);
    hashes.push(rec.hash(mark));
  }
  return hashes;
}

function poseDiff(scene, cols) {
  const t = scene.table;
  let worst = 0, where = '';
  for (const c of cols || T.POSE) {
    for (let i = 0; i < t.n; i++) {
      const d = Math.abs(t.live[c][i] - t.base[c][i]);
      if (d > worst) { worst = d; where = c + '[' + i + ']'; }
    }
  }
  return { worst, where };
}

// Runs the listed behaviours on a fresh live pose at t, ignoring the scheduler (the identity rule is about the pose the
// part computes at progress ≥ 1 / ≤ 0, whatever its `live` says).
function runDirect(scene, list, t) {
  T.resetLive(scene.table);
  for (const b of list) b.run(scene.table.live, t, b);
}

function checkIdentity(scene, kind, where) {
  const own = scene.behaviours.filter((b) => b.phase === BH.PH.MOTION && b.run !== BH.runDrift);
  if (own.length === 0) return;
  const probes = kind === 'arrive'
    ? [Math.max(...own.map((b) => b.t1)), Math.max(...own.map((b) => b.t1)) + 0.5]
    : [Math.min(...own.map((b) => b.t0)), Math.min(...own.map((b) => b.t0)) - 0.5];
  for (const t of probes) {
    runDirect(scene, own, t);
    const d = poseDiff(scene);
    assert.ok(d.worst <= EPS_POSE, where + ': ' + kind + ' at progress ' + (kind === 'arrive' ? '≥ 1' : '≤ 0') + ' changes ' + d.where +
      ' by ' + d.worst + ' (identity rule)');
  }
}

// Dwell: no effect at the envelope edges (the pose equals the rest pose there), and no jumps while the envelope ramps
// (sampled at 480 Hz over the first 0.3 s and the last 0.25 s; `fine` only for one case per aspect, it is slower).
function checkDwell(scene, where, fine) {
  const own = scene.behaviours.filter((b) => b.phase === BH.PH.REST);
  if (own.length === 0) return;
  const { rest, out } = scene.times;
  for (const t of [rest - 1e-3, rest, out, out + 1e-3]) {
    F.evaluate(scene, t);
    const d = poseDiff(scene);
    assert.ok(d.worst <= 1e-3, where + ': the dwell moves ' + d.where + ' by ' + d.worst + ' at the envelope edge t=' + t.toFixed(3));
  }
  if (!fine) return;
  const step = 1 / 480;
  for (const [lo, hi] of [[rest, Math.min(out, rest + 0.3)], [Math.max(rest, out - 0.25), out]]) {
    let prev = null;
    for (let t = lo; t <= hi; t += step) {
      F.evaluate(scene, t);
      const snap = T.POSE.map((c) => scene.table.live[c].slice(0, scene.table.n));
      if (prev) assertSmallJumps(snap, prev, where, step);
      prev = snap;
    }
  }
}

function assertSmallJumps(snap, prev, where, step) {
  for (let k = 0; k < snap.length; k++) {
    const limit = ['x', 'y', 'z', 'jx', 'jy'].includes(T.POSE[k]) ? 4 : 0.08;
    for (let i = 0; i < snap[k].length; i++) {
      const jump = Math.abs(snap[k][i] - prev[k][i]);
      if (jump > limit) assert.fail(where + ': dwell jumps ' + T.POSE[k] + '[' + i + '] by ' + jump + ' within ' + step.toFixed(4) + ' s');
    }
  }
}

// --- one part ---------------------------------------------------------------------------------------------------

function textCases(def) {
  return TEXTS.map((tc) => {
    const lang = langOf(tc.text);
    const allowed = featuresOf(tc.text, lang, 2, 'lyric').orients;
    const traitOrients = (def.traits && def.traits.orient) || ['h', 'v'];
    return { tc, orients: allowed.filter((o) => traitOrients.includes(o)) };
  });
}

// Full: every aspect × (text, orientation) pair. Sampled: each pair once, the aspects in rotation, and every aspect at
// least once.
function matrix(def, sampled) {
  const pairs = [];
  for (const { tc, orients } of textCases(def)) for (const orient of orients) pairs.push({ orient, tc });
  if (!sampled) return ASPECTS.flatMap((aspect) => pairs.map((pr) => Object.assign({ aspect }, pr)));
  const n = Math.max(pairs.length, pairs.length ? ASPECTS.length : 0);
  const cases = [];
  for (let k = 0; k < n; k++) cases.push(Object.assign({ aspect: ASPECTS[k % ASPECTS.length] }, pairs[k % pairs.length]));
  return cases;
}

function checkCutPart(reg, def, sampled, timings) {
  const cases = matrix(def, sampled);
  assert.ok(cases.length > 0, 'no text/orientation case fits the traits of ' + def.kind + '/' + def.key);
  const seenAspect = new Set();
  for (const c of cases) {
    const where = def.kind + '/' + def.key + ' ' + c.aspect + ' ' + c.orient + ' "' + c.tc.name + '"';
    const plan = makePlan({ reg, def, aspect: c.aspect, orient: c.orient, text: c.tc.text });
    const svc = svcOf(reg, plan);
    const scene = buildTimed(() => BUILD.buildCut(plan.cuts[0], plan, svc), timings);
    assert.ok(!scene.warnings.some((w) => w.code === 'part-error'), where + ': part-error warning');
    const { a, rest, out, b } = scene.times;
    const times = sampleTimes(a, b, [rest, out, 0]);
    const hashes = renderTimes(scene, plan, times, where);
    const firstOfAspect = !seenAspect.has(c.aspect);
    if (def.kind === 'arrive' || def.kind === 'depart') checkIdentity(scene, def.kind, where);
    if (def.kind === 'dwell') checkDwell(scene, where, firstOfAspect);
    if (firstOfAspect) {
      seenAspect.add(c.aspect);
      const again = BUILD.buildCut(plan.cuts[0], plan, svcOf(reg, plan));
      assert.deepEqual(renderTimes(again, plan, times, where + ' (rebuilt)'), hashes, where + ': op hashes differ between two builds');
    }
  }
}

function checkGroundPart(reg, def, timings) {
  for (const aspect of ASPECTS) {
    const where = def.kind + '/' + def.key + ' ' + aspect;
    const plan = makePlan({ reg, def, aspect, orient: 'h', text: TEXTS[0].text });
    const seg = plan.grounds[0];
    const scene = buildTimed(() => BUILD.buildGround(seg, plan, svcOf(reg, plan)), timings);
    const times = sampleTimes(0, seg.t1 - seg.t0, []);
    const hashes = renderTimes(scene, plan, times, where);
    const again = BUILD.buildGround(seg, plan, svcOf(reg, plan));
    assert.deepEqual(renderTimes(again, plan, times, where + ' (rebuilt)'), hashes, where + ': op hashes differ between two builds');
  }
}

// A host frame (the fallback cut over its ground) rendered into a recorder surface, as the input of filters and seams.
function hostSurface(reg, rec, aspect, text, tl) {
  const plan = makePlan({ reg, def: null, aspect, orient: 'h', text });
  const svc = svcOf(reg, plan);
  const scene = BUILD.buildCut(plan.cuts[0], plan, svc);
  const ground = BUILD.buildGround(plan.grounds[0], plan, svc);
  const scale = 360 / 1080, W = plan.design.w, H0 = plan.design.h;
  const surf = R.surfaceOf(rec.factory, Math.round(W * scale), Math.round(H0 * scale), true);
  F.evaluate(ground, plan.cuts[0].t0 + tl);
  R.drawScene(surf.ctx, ground, { scale, pal: plan.look.palette, tl: plan.cuts[0].t0 + tl });
  F.evaluate(scene, tl);
  R.drawScene(surf.ctx, scene, { scale, pal: plan.look.palette, tl });
  return { surf, plan, scale };
}

function isSurface(s) { return !!s && !!s.canvas && !!s.ctx && typeof s.ctx.drawImage === 'function'; }

function runFx(reg, def, aspect, mode) {
  const rec = R.createRecorder();
  const { surf, plan, scale } = hostSurface(reg, rec, aspect, TEXTS[0].text, 0.8);
  const other = mode === 'seam' ? hostSurface(reg, rec, aspect, TEXTS[2].text, 0.8).surf : null;
  const cutInfo = mode === 'texture' ? null : { tl: 0.8, dur: 2.1, impact: false, energy: 0.55 };
  const fx = R.createRecordingFx(rec, { w: surf.w, h: surf.h, unit: scale, plan, cut: cutInfo, seed: H.hash32('fx', def.key),
    allowTextAt: (def.needs || []).includes('textAt') });
  const ax = { f: plan.cuts[0].feat, look: { amounts: plan.look.amounts, mood: null, bpm: 120 } };
  const p = autoParams(reg, def.kind, def.key, ax, H.hash32('fx', aspect));
  const hashes = [];
  for (let k = 0; k < TIMES; k++) {
    const where = def.kind + '/' + def.key + ' ' + aspect + ' ' + mode + ' #' + k;
    const u = k / (TIMES - 1);
    const mark = rec.mark();
    fx.begin();
    const before = fx.outstanding();
    const out = mode === 'seam' ? def.mix(fx, surf, other, u, p) : def.apply(fx, surf, p, plan.cuts[0].t0 + u * 3);
    assert.ok(isSurface(out), where + ': must return a Surface');
    const extra = out === surf || out === other ? 0 : 1;
    assert.equal(fx.outstanding() - before, extra, where + ': every surface taken (other than the result) must be given back');
    if (extra) fx.give(out);
    assertCleanStats(rec, where);
    hashes.push(rec.hash(mark));
  }
  return hashes;
}

function checkFxPart(reg, def, mode) {
  for (const aspect of ASPECTS) {
    const first = runFx(reg, def, aspect, mode);
    assert.deepEqual(runFx(reg, def, aspect, mode), first, def.kind + '/' + def.key + ' ' + aspect + ': op hashes differ between runs');
    if (mode === 'filter' && def.texture === true) runFx(reg, def, aspect, 'texture');
  }
}

function checkLookPart(reg, def, timings) {
  const look = lookOf(reg, def.kind === 'theme' ? { theme: def } : { mood: def });
  for (const aspect of ASPECTS) {
    const where = def.kind + '/' + def.key + ' ' + aspect;
    const plan = makePlan({ reg, def: null, aspect, orient: 'h', text: TEXTS[3].text, look });
    const scene = buildTimed(() => BUILD.buildCut(plan.cuts[0], plan, svcOf(reg, plan)), timings);
    renderTimes(scene, plan, sampleTimes(scene.times.a, scene.times.b, [scene.times.rest, scene.times.out]), where);
  }
}

// 200 random feature sets: every param's auto stays inside its schema.
function checkAutos(reg, def) {
  const params = reg.params(def.kind, def.key) || [];
  const rng = RNG.stream('conformance-autos', def.kind, def.key);
  for (let n = 0; n < 200; n++) {
    const f = { energy: rng.next(), cps: rng.range(0, 20), cells: rng.range(1, 60), dur: rng.range(0.2, 8), pos: rng.next(),
      emph: rng.chance(0.3), impact: rng.chance(0.2), beat: rng.chance(0.5) ? 0.5 : 0, orients: ['h', 'v'], role: 'lyric' };
    const amounts = Object.fromEntries(SCH.AMOUNT_KEYS.map((k) => [k, rng.next()]));
    const mood = { tagBias: Object.fromEntries(SCH.TAGS.map((t) => [t, rng.range(0, 2)])) };
    const look = { amounts, mood, bpm: rng.chance(0.3) ? null : rng.range(60, 200) };
    for (const { name, spec } of params) {
      const raw = SCH.autoValue(spec.auto, { f, look, rng: RNG.stream(rng.next() * 4294967296 >>> 0, 'param', name) });
      const where = def.kind + '/' + def.key + '.' + name + ' auto ' + JSON.stringify(raw);
      if (spec.type === 'num' || spec.type === 'int') {
        assert.ok(Number.isFinite(raw) && raw >= spec.min && raw <= spec.max, where + ' is outside ' + spec.min + '..' + spec.max);
      } else if (spec.type === 'bool') {
        assert.equal(typeof raw, 'boolean', where + ' is not a boolean');
      } else if (spec.type === 'text') {
        assert.equal(typeof raw, 'string', where + ' is not text');
      } else {
        assert.notEqual(SCH.coerce(spec, raw), undefined, where + ' is not a valid ' + spec.type);
      }
    }
  }
}

function checkPart(reg, def, sampled) {
  const timings = [];
  checkAutos(reg, def);
  if (['arrange', 'arrive', 'dwell', 'depart', 'lens'].includes(def.kind)) checkCutPart(reg, def, sampled, timings);
  else if (def.kind === 'ornament') {
    if (def.scope === 'run') checkGroundPart(reg, def, timings); else checkCutPart(reg, def, sampled, timings);
  } else if (def.kind === 'ground') checkGroundPart(reg, def, timings);
  else if (def.kind === 'filter') checkFxPart(reg, def, 'filter');
  else if (def.kind === 'seam') checkFxPart(reg, def, 'seam');
  else checkLookPart(reg, def, timings);
  if (timings.length) {
    const sorted = timings.slice().sort((p, q) => p - q);
    const median = sorted[Math.floor(sorted.length / 2)];
    assert.ok(median <= BUILD_MS, def.kind + '/' + def.key + ': median build ' + median.toFixed(2) + ' ms > ' + BUILD_MS + ' ms');
    assert.ok(sorted[sorted.length - 1] <= 3 * BUILD_MS, def.kind + '/' + def.key + ': slowest build ' +
      sorted[sorted.length - 1].toFixed(2) + ' ms > ' + 3 * BUILD_MS + ' ms');
  }
}

// --- the registries under test ----------------------------------------------------------------------------------

// The catalog's part definitions, module by module: a module that throws is reported, the others are still tested.
function catalogDefs() {
  const defs = [], problems = [];
  for (const id of MV.ids('parts/').filter((m) => PART_MODULE.test(m))) {
    try {
      defs.push(...MV.use(id));
    } catch (e) {
      problems.push(id + ': ' + (e && e.message));
    }
  }
  return { defs, problems };
}

// { reg, parts, problems }: reg hosts the tests (the catalog's valid parts plus borrowed fallbacks), parts are the
// catalog's own valid parts, problems every module error and registry problem.
function catalogUnderTest() {
  const { defs, problems } = catalogDefs();
  const own = REG.createRegistry(defs, { strict: false });
  const parts = own.all();
  const hosts = corpus.minimalFallbacks().filter((d) => own.fallback(d.kind) === null && !own.has(d.kind, d.key));
  const reg = hosts.length ? REG.createRegistry(parts.concat(hosts), { strict: false }) : own;
  return { reg, parts, problems: problems.concat(own.problems), strictCheck: problems.length === 0 };
}

function registrySources() {
  const list = [
    { name: 'stub', load: () => ({ reg: corpus.stubRegistry(MV), problems: [] }) },
    { name: 'examples', load: () => ({ reg: examples.exampleRegistry(MV), problems: [] }) },
  ];
  if (MV.has('parts/catalog')) list.push({ name: 'catalog', load: catalogUnderTest });
  return list;
}

function registerRegistry(name, got) {
  const { reg, problems } = got;
  const parts = got.parts || reg.all();
  test(name + ' registry: valid, every kind present, the runner covers every part', () => {
    assert.deepEqual(problems, [], name + ' registry problems:\n' + problems.join('\n'));
    for (const kind of REG.KINDS) assert.ok(reg.keys(kind).length > 0, name + ': no ' + kind + ' parts');
    if (got.strictCheck) assert.equal(MV.use('parts/catalog').defaultRegistry().version, reg.version, 'parts/catalog agrees');
    assert.ok(parts.length > 0);
  });
  for (const def of parts) {
    test(name + ' ' + def.kind + '/' + def.key + (QUICK ? ' (quick)' : ''), () => checkPart(reg, reg.get(def.kind, def.key), QUICK));
  }
}

for (const src of registrySources()) {
  let got = null;
  try {
    got = src.load();
  } catch (e) {
    test(src.name + ' registry loads', () => { throw e; });
  }
  if (got) registerRegistry(src.name, got);
}

// --- camera presets (DESIGN_2_1 §3.10, §8.2): every shot and rig over the fallback parts --------------------------

const SHOT = MV.use('core/shot');
// shot framing zoom [0.9, 3] × the lens (≤ 1.15) × the rig (≥ 0.95, ≤ 1.04 beyond the framing): DESIGN_2_1 §8.2
const CAMERA_ZOOM = [0.855, 3 * 1.15 * 1.04];

// makePlan's one-cut plan (fallback parts) with a shot on the cut or a rig run over the whole plan (plan v 2).
function cameraPlan(reg, kind, key, c) {
  const plan = makePlan({ reg, def: null, aspect: c.aspect, orient: c.orient, text: c.tc.text });
  const cut = plan.cuts[0];
  plan.v = 2;
  if (kind === 'shot') {
    cut.slots['cam.shot'] = { v: key, from: 'auto' };
    cut.slots['cam.zoom'] = { v: 1, from: 'auto' };
    cut.fp = H.hashJSON({ fp: cut.fp, shot: key });
  }
  cut.rig = 0;
  const rig = kind === 'rig' ? key : 'none';
  plan.rigs = [{ key: 'k' + cut.key, t0: 0, t1: plan.duration, cuts: [cut.key], blend: null, rig: { v: rig, p: { amp: 1 }, from: 'auto' },
    curve: { v: kind === 'rig' ? SHOT.RIGS[key].curve : 'linear', from: 'auto' } }];
  plan.grounds[0].zoomed = kind === 'shot';
  return plan;
}

function checkCameraPreset(reg, kind, key, sampled) {
  const timings = [];
  const seenAspect = new Set();
  const cases = matrix({ kind: 'arrange', key, traits: { orient: ['h', 'v'] } }, sampled);
  const seen = new Set();
  for (const c of cases) {
    const where = kind + '/' + key + ' ' + c.aspect + ' ' + c.orient + ' "' + c.tc.name + '"';
    const plan = cameraPlan(reg, kind, key, c);
    const scene = buildTimed(() => BUILD.buildCut(plan.cuts[0], plan, svcOf(reg, plan)), timings);
    assert.ok(!scene.warnings.some((w) => w.code === 'part-error'), where + ': part-error warning');
    if (kind === 'shot') assert.ok(scene.shot, where + ': the shot is resolved');
    const { a, rest, out, b } = scene.times;
    const times = sampleTimes(a, b, [rest, out, 0]);
    const zoomIn = (cam, at) => {
      seen.add([cam.x, cam.y, cam.zoom, cam.roll].map((v) => v.toFixed(3)).join(','));
      assert.ok(cam.zoom >= CAMERA_ZOOM[0] && cam.zoom <= CAMERA_ZOOM[1], at + ': camera zoom ' + cam.zoom);
    };
    const hashes = renderTimes(scene, plan, times, where, zoomIn);
    if (!seenAspect.has(c.aspect)) {
      seenAspect.add(c.aspect);
      const again = BUILD.buildCut(plan.cuts[0], plan, svcOf(reg, plan));
      assert.deepEqual(renderTimes(again, plan, times, where + ' (rebuilt)'), hashes, where + ': op hashes differ between two builds');
    }
  }
  assert.ok(seen.size > 1, kind + '/' + key + ': the camera never moves');
  const sorted = timings.slice().sort((p, q) => p - q);
  const median = sorted[Math.floor(sorted.length / 2)];
  assert.ok(median <= BUILD_MS, kind + '/' + key + ': median build ' + median.toFixed(2) + ' ms > ' + BUILD_MS + ' ms');
  assert.ok(sorted[sorted.length - 1] <= 3 * BUILD_MS, kind + '/' + key + ': slowest build ' +
    sorted[sorted.length - 1].toFixed(2) + ' ms > ' + 3 * BUILD_MS + ' ms');
}

{
  // the catalog hosts the presets when it is complete; else the stub registry
  let host = null;
  try { host = MV.has('parts/catalog') ? MV.use('parts/catalog').defaultRegistry() : null; } catch (e) { host = null; }
  const reg = host || corpus.stubRegistry(MV);
  for (const key of SHOT.SHOT_KEYS) test('camera shot/' + key + (QUICK ? ' (quick)' : ''), () => checkCameraPreset(reg, 'shot', key, QUICK));
  for (const key of SHOT.RIG_KEYS) test('camera rig/' + key + (QUICK ? ' (quick)' : ''), () => checkCameraPreset(reg, 'rig', key, QUICK));
}

// --- the runner catches broken parts ----------------------------------------------------------------------------

test('the runner fails a part that breaks the identity rule, draws NaN or leaves save/restore unbalanced', () => {
  const K = MV.use('parts/kit');
  const fallbacks = corpus.minimalFallbacks();
  const stuck = K.arrive({ key: 'stuckOffset', label: { ja: '残る', en: 'Stuck' }, blurb: { ja: 'ずれが残る', en: 'Offset stays' },
    make: K.perGlyph((P, g, k) => { P.x += 10 + (1 - k) * 40; }) });
  const nan = K.ornament({ key: 'nanMark', label: { ja: '壊れ', en: 'Broken' }, blurb: { ja: '壊れた印', en: 'A broken mark' },
    build(env) { env.sb.paint({ layer: 'near', draw: (g) => { g.fillRect(NaN, 0, 1, 1); } }); } });
  const leak = K.ground({ key: 'leakySave', label: { ja: '漏れ', en: 'Leaky' }, blurb: { ja: '保存漏れ', en: 'Leaks a save' },
    build(env) { env.sb.paint({ layer: 'ground', draw: (g) => { g.save(); g.fillRect(0, 0, 1, 1); } }); } });
  for (const [def, pattern] of [[stuck, /identity rule/], [nan, /NaN/], [leak, /unbalanced/]]) {
    const reg = REG.createRegistry([def].concat(fallbacks));
    assert.throws(() => checkPart(reg, reg.get(def.kind, def.key), true), pattern, def.key);
  }
});

// Unit pivots (px py) are pose columns: a word, line or run entrance at rest (and its mirror before it starts) must leave
// them at the base pose too.
test('the runner accepts correct word, line and run entrances and exits (K.moves, K.perGlyph, K.mirror)', () => {
  const K = MV.use('parts/kit');
  const text = (ja, en) => ({ label: { ja, en }, blurb: { ja, en } });
  const defs = [];
  for (const unit of ['word', 'line', 'run']) {
    const name = unit[0].toUpperCase() + unit.slice(1);
    const turn = K.arrive(Object.assign({ key: 'turn' + name + 'In' }, text('回り込み', 'Turn in'),
      K.moves({ unit, tracks: { rot: [30, 0], sx: [0.6, 1], alpha: [0, 1] } })));
    defs.push(turn, K.mirror(turn, Object.assign({ key: 'turn' + name + 'Out' }, text('回り去り', 'Turn out'))));
  }
  const tilt = K.arrive(Object.assign({ key: 'tiltWordIn', unit: 'word' }, text('傾き', 'Tilt in'),
    { make: K.perGlyph((P, g, k) => { P.rot += (1 - k) * 25; P.sy *= 0.5 + 0.5 * k; P.alpha *= k; }) }));
  defs.push(tilt, K.mirror(tilt, Object.assign({ key: 'tiltWordOut' }, text('傾き去り', 'Tilt out'))));
  const reg = REG.createRegistry(defs.concat(corpus.minimalFallbacks()));
  for (const def of defs) {
    assert.notEqual(reg.get(def.kind, def.key).unit, 'glyph', def.key);
    checkPart(reg, reg.get(def.kind, def.key), true);
  }
});
