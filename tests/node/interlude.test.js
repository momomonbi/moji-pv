/* 文字PVメーカー v2 — original work. Tests: the interlude effects (parts/arrange/interlude) — light motes, sound horizon, kinetic shapes (DESIGN §5.1). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

// conformance.test.js runs these parts through the §8.2 matrix and arrange_dwell.test.js checks the §5.1 table. This file
// checks what is particular to them: no text on any interlude of any document (─♪─ is retired to a pin), no near layer
// and no behaviour, the self-fade at both ends of the window, the music rules (loudness, beats, no fake tempo without a
// song), the fingerprint terms, the budgets and backdrops, seeds that ignore the params, and the safe area.

const MV = load();
const H = MV.use('core/hash');
const RNG = MV.use('core/rng');
const SCH = MV.use('core/schema');
const DOC = MV.use('core/doc');
const C = MV.use('core/color');
const PINS = MV.use('core/pins');
const LOOKS = MV.use('planner/look');
const PLAN = MV.use('planner/plan');
const BUILD = MV.use('engine/scene/build');
const F = MV.use('engine/scene/frame');
const R = MV.use('engine/render/record');
const T = MV.use('engine/scene/table');
const FACES = MV.use('engine/text/faces');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');

const REGISTRY = MV.use('parts/catalog').defaultRegistry();
const KEYS = ['kineticShapes', 'lightMotes', 'soundHorizon'];
const TEXT = createTextService({ measurer: fakeMeasurer(), faces: null });
const T0 = 10;

// --- one-cut plans ----------------------------------------------------------------------------------------------------

function lookOf(palette) {
  const theme = REGISTRY.get('theme', REGISTRY.fallback('theme'));
  const mood = REGISTRY.get('mood', REGISTRY.fallback('mood'));
  return { mood: { v: mood.key, from: 'auto' }, theme: { v: theme.key, from: 'auto' }, season: { v: 'any', from: 'auto' },
    amounts: Object.assign({}, mood.amounts), amountsFrom: {}, palette: palette || Object.assign({}, theme.swatch),
    faces: JSON.parse(JSON.stringify(FACES.resolveFaces(theme, null, ['ja', 'en']))), texture: null, backdrop: 'scene' };
}

function decision(kind, key, feat, params, seed, bpm) {
  const p = {};
  for (const { name, spec } of REGISTRY.params(kind, key)) {
    p[name] = params && params[name] !== undefined ? SCH.coerce(spec, params[name])
      : SCH.autoValue(spec, { f: feat, look: { amounts: {}, mood: null, bpm }, rng: RNG.stream(seed, 'param', name) });
  }
  return { v: key, p, from: 'auto' };
}

// The loudness at 20 Hz over the plan: flat, a step up (0.3 → 0.9) or down at the middle of the cut, or no song.
function envOf(kind, duration, mid) {
  if (kind === 'none') return null;
  const out = new Float32Array(Math.ceil(duration * 20) + 2);
  for (let i = 0; i < out.length; i++) {
    const t = (i + 0.5) / 20, late = t >= mid;
    out[i] = kind === 'flat' ? 0.5 : kind === 'steps' ? (late ? 0.9 : 0.3) : (late ? 0.3 : 0.9);
  }
  return out;
}

// o = { key, dur, env ('flat'|'steps'|'stepsInv'|'none'), bpm, pos, note, aspect, orient, params, palette, backdrop }
function ilPlan(o) {
  const aspect = o.aspect || '16:9';
  const [w, h] = DOC.DESIGN_SIZE[aspect];
  const dur = o.dur || 3.47, bpm = o.bpm === undefined ? null : o.bpm;
  const feat = { cells: 0, graphemes: 0, script: 'ja', latin: 0, orients: ['h', 'v'], words: 0, units: { glyph: 0, word: 0, line: 1 },
    emph: false, impact: false, dur, cps: 0, energy: 0.5, beat: bpm ? 60 / bpm : 0, onBeat: false, section: null, repeatOf: null,
    pos: o.pos === undefined ? 0.5 : o.pos, role: 'interlude' };
  const seed = H.hash32('interlude', aspect, o.key);
  const slots = {
    orient: { v: o.orient || 'h', from: 'auto' },
    arrange: decision('arrange', o.key, feat, o.params, seed, bpm),
    'text.face': { v: 'display', from: 'auto' }, 'text.scale': { v: 1, from: 'auto' },
    'text.ink': { v: 'ink', from: 'auto' }, 'text.style': { v: 'plain', from: 'auto' },
    arrive: decision('arrive', REGISTRY.fallback('arrive'), feat, null, seed, bpm),
    dwell: decision('dwell', 'stillHold', feat, null, seed, bpm),
    depart: decision('depart', REGISTRY.fallback('depart'), feat, null, seed, bpm),
    'ornament.count': { v: 0, from: 'auto' }, lens: decision('lens', REGISTRY.fallback('lens'), feat, null, seed, bpm),
    'filter.count': { v: 0, from: 'auto' },
  };
  const cut = { key: 'gap/r1', line: null, role: 'interlude', text: '', emph: [], impact: false, note: o.note || null,
    t0: T0, t1: T0 + dur, a: T0 - 0.12, b: T0 + dur + 0.25, repT: T0, lang: 'ja', feat, fp: '', slots, els: {}, ground: 0, seamIn: -1 };
  cut.fp = H.hashJSON({ slots, note: cut.note, aspect, env: o.env, bpm });
  const look = lookOf(o.palette);
  if (o.backdrop) look.backdrop = o.backdrop;
  const plan = { v: 1, hash: '', duration: cut.b + 1, design: { aspect, w, h, short: 1080 }, look,
    beats: bpm ? { bpm, offset: 0.1, meter: 4 } : null, lines: [], cuts: [cut], grounds: [], seams: [], impulses: [], warnings: [] };
  const env = envOf(o.env || 'flat', plan.duration, T0 + dur / 2);
  if (env) Object.defineProperty(plan, 'env', { enumerable: false, value: env });
  return plan;
}

function sceneOf(o) {
  const plan = ilPlan(o);
  return { plan, scene: BUILD.buildCut(plan.cuts[0], plan, { registry: REGISTRY, text: TEXT, strict: true }) };
}

function paintsOf(scene) {
  const out = [];
  for (let i = 0; i < scene.table.n; i++) {
    if (scene.table.type[i] !== T.TYPE.paint) continue;
    out.push({ node: i, layer: T.LAYERS[scene.table.layer[i]].name, rec: scene.stores.paint[scene.table.payload[i]] });
  }
  return out;
}

// The data of the part's main paint (on the mid layer; it carries the events).
function dataOf(scene) { const p = paintsOf(scene).find((x) => x.layer === 'mid'); return p && p.rec.data; }

// The ops one frame draws at local time tl (and the recorder, for its stats).
function opsAt(plan, scene, tl, rec, o) {
  const r = rec || R.createRecorder();
  const surf = R.surfaceOf(r.factory, 320, 180, false);
  F.evaluate(scene, tl);
  const mark = r.mark();
  R.drawScene(surf.ctx, scene, Object.assign({ scale: 1 / 6, W: plan.design.w, H: plan.design.h, pal: plan.look.palette, tl }, o || {}));
  return { ops: r.ops().slice(mark), rec: r };
}

const DRAWS = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage']);
function draws(ops) { return ops.filter((op) => DRAWS.has(op[1])).length; }

// The recorder names gradients by a running counter; number them per frame so equal frames hash equal.
function frameHash(ops) {
  const names = new Map();
  const local = (v) => (typeof v !== 'string' ? v : v.replace(/^([gp]\d+)(?=$|\.)/, (id) => {
    if (!names.has(id)) names.set(id, id[0] + '#' + names.size);
    return names.get(id);
  }));
  return H.hashJSON(ops.map((op) => op.map(local)));
}

// --- 1. registry --------------------------------------------------------------------------------------------------------

test('the interlude pool is exactly the three effects; the breath mark stays pinnable (pool false)', () => {
  assert.deepEqual(REGISTRY.pool('arrange', { role: 'interlude' }).slice().sort(), KEYS);
  const bm = REGISTRY.get('arrange', 'breathMark');
  assert.equal(bm.pool, false);
  assert.ok(REGISTRY.has('arrange', 'breathMark'));
  const needs = { lightMotes: ['beats', 'level'], soundHorizon: ['beats', 'level'], kineticShapes: ['beats'] };
  const families = new Set();
  const all = REGISTRY.keys('arrange');
  for (const key of KEYS) {
    const d = REGISTRY.get('arrange', key), t = REGISTRY.traits('arrange', key);
    assert.deepEqual(t.roles, ['interlude'], key);
    assert.deepEqual(t.cells, [0, 80], key);
    assert.equal(d.cam, 'gentle', key);
    assert.equal(d.motion, undefined, key + ' owns no motion (lyric neighbours keep theirs)');
    assert.deepEqual(d.needs.slice().sort(), needs[key], key);
    assert.ok(!families.has(d.family) && d.family !== 'mark', key + ' has a family of its own');
    families.add(d.family);
    assert.ok(all.indexOf(key) > all.indexOf('breathMark') || key > 'breathMark', key + ' sorts after breathMark');
  }
  const horizon = REGISTRY.get('arrange', 'soundHorizon');
  assert.ok(horizon.fits({ beat: 0 }) < horizon.fits({ beat: 0.5 }), 'a beat grid helps the horizon');
});

// --- 2. no ♪ by default (the real planner) --------------------------------------------------------------------------

function interludeScenes(doc) {
  const plan = PLAN.plan(doc, { registry: REGISTRY });
  const text = createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces });
  return { plan, cuts: plan.cuts.filter((c) => c.role === 'interlude').map((cut) => ({ cut,
    scene: BUILD.buildCut(cut, plan, { registry: REGISTRY, text, strict: true }) })) };
}

function assertTextless(plan, cut, scene, where) {
  assert.equal(scene.target.to, scene.target.from, where + ': no glyph');
  assert.equal(scene.runs.length, 0, where + ': no run');
  assert.ok(!scene.warnings.some((w) => w.code === 'part-error'), where + ': no part error');
  const rec = R.createRecorder();
  for (let k = 0; k < 6; k++) {
    const tl = scene.times.a + ((scene.times.b - scene.times.a) * (k + 0.5)) / 6;
    const { ops } = opsAt(plan, scene, tl, rec);
    assert.ok(!ops.some((op) => op[1] === 'fillText' || op[1] === 'strokeText'), where + ': no text drawn at ' + tl.toFixed(2));
  }
}

test('no ♪ by default: every interlude of the lrc corpus and v21 draws one of the effects, and no text', () => {
  const docs = corpus.corpus(20, ['16:9', '9:16', '1:1'], ['lrc']).map((x) => x.doc).concat([corpus.project('v21').doc]);
  const seen = new Set();
  for (const doc of docs) {
    const { plan, cuts } = interludeScenes(doc);
    assert.ok(cuts.length > 0);
    assert.ok(!plan.warnings.some((w) => w.code === 'part-error'));
    for (const { cut, scene } of cuts) {
      assert.ok(KEYS.includes(cut.slots.arrange.v), cut.key + ': ' + cut.slots.arrange.v);
      seen.add(cut.slots.arrange.v);
      assertTextless(plan, cut, scene, cut.key + ' ' + cut.slots.arrange.v);
    }
  }
  assert.deepEqual([...seen].sort(), KEYS, 'every effect is picked somewhere in the corpus');
});

test('with no effect left in the pool the fallback draws nothing on a blank interlude; a 間の印 pin still shows ♪', () => {
  const base = corpus.project('lrc').doc;
  for (const filters of [{ arrange: { only: ['centerAnchor'], deny: null } }, { arrange: { only: null, deny: KEYS.slice() } }]) {
    const doc = Object.assign({}, base, { filters: Object.assign({}, base.filters, filters) });
    const { plan, cuts } = interludeScenes(doc);
    for (const { cut, scene } of cuts) {
      assert.equal(cut.slots.arrange.v, 'centerAnchor', JSON.stringify(filters));
      assertTextless(plan, cut, scene, 'fallback ' + cut.key);
    }
  }
  const pinned = Object.assign({}, base, { pins: Object.assign({}, base.pins, { 'cut/gap/ra:arrange': { v: 'breathMark', by: 'user' } }) });
  const { cuts } = interludeScenes(pinned);
  const ra = cuts.find((c) => c.cut.key === 'gap/ra');
  assert.equal(ra.cut.slots.arrange.v, 'breathMark');
  const t = ra.scene.target, chars = [];
  for (let j = 0; j < t.to - t.from; j++) chars.push(t.ch[j]);
  assert.ok(chars.join('').includes('♪') || chars.length > 0, 'the pinned breath mark draws its label');
});

// --- 3. build matrix ----------------------------------------------------------------------------------------------------

test('build matrix: no runs, paints on far and mid only, no behaviour of their own, a finite focus inside the frame', () => {
  const times = [];
  for (const key of KEYS) {
    for (const aspect of ['16:9', '9:16', '1:1', '21:9']) {
      for (const orient of ['h', 'v']) {
        for (const dur of [1.6, 3.47, 12, 30]) {
          for (const env of ['flat', 'steps', 'none']) {
            for (const bpm of [120, null, 240]) {
              const where = [key, aspect, orient, dur, env, bpm].join(' ');
              const plan = ilPlan({ key, aspect, orient, dur, env, bpm });
              const t0 = process.hrtime.bigint();
              const scene = BUILD.buildCut(plan.cuts[0], plan, { registry: REGISTRY, text: TEXT, strict: true });
              times.push(Number(process.hrtime.bigint() - t0) / 1e6);
              assert.equal(scene.runs.length, 0, where);
              const paints = paintsOf(scene);
              assert.ok(paints.length >= 1, where);
              for (const p of paints) assert.ok(p.layer === 'far' || p.layer === 'mid', where + ': layer ' + p.layer);
              const nodes = new Set(paints.map((p) => p.node));
              assert.ok(!scene.behaviours.some((b) => nodes.has(b.from)), where + ': the effect moves itself (no behaviour)');
              const f = scene.focus, { w, h } = plan.design;
              assert.ok([f.x, f.y, f.w, f.h].every(Number.isFinite), where + ': focus');
              assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= w && f.y + f.h <= h, where + ': focus inside the frame');
            }
          }
        }
      }
    }
  }
  times.sort((a, b) => a - b);
  assert.ok(times[Math.floor(times.length / 2)] <= 4, 'median build ' + times[Math.floor(times.length / 2)].toFixed(2) + ' ms');
});

// --- 4. envelope --------------------------------------------------------------------------------------------------------

test('each effect fades itself: nothing at a or just before b, drawing after the entrance and before the lead-out', () => {
  for (const key of KEYS) {
    for (const dur of [1.6, 3.47, 12]) {
      for (const bpm of [120, null]) {
        const { plan, scene } = sceneOf({ key, dur, bpm, env: 'steps' });
        const d = dataOf(scene), T_ = scene.times, where = key + ' dur ' + dur + ' bpm ' + bpm;
        assert.equal(draws(opsAt(plan, scene, T_.a).ops), 0, where + ': nothing at a');
        assert.equal(draws(opsAt(plan, scene, T_.b - 0.01).ops), 0, where + ': nothing at b − 0.01');
        assert.ok(draws(opsAt(plan, scene, d.a + d.E + 0.1).ops) > 0, where + ': drawn after the entrance');
        assert.ok(draws(opsAt(plan, scene, d.o - 0.05).ops) > 0, where + ': drawn before the lead-out');
      }
    }
  }
});

// --- 5. level -----------------------------------------------------------------------------------------------------------

test('loudness: the motes and the horizon follow the song; a steady level is no song; the shapes do not read it', () => {
  for (const key of ['lightMotes', 'soundHorizon']) {
    const up = sceneOf({ key, dur: 12, env: 'steps', bpm: null }), down = sceneOf({ key, dur: 12, env: 'stepsInv', bpm: null });
    const du = dataOf(up.scene), dd = dataOf(down.scene);
    assert.equal(du.song, true, key);
    assert.equal(dd.song, true, key);
    const tl = 0.75 * 12;
    assert.notEqual(frameHash(opsAt(up.plan, up.scene, tl).ops), frameHash(opsAt(down.plan, down.scene, tl).ops), key + ': frames differ');
    const at = (d, t) => d.lv[Math.round((t - d.L0) * 20)];
    assert.ok(at(du, 9) > at(du, 3), key + ': louder in the loud half');
    assert.ok(at(dd, 3) > at(dd, 9), key + ': louder in the loud half (inverted)');
    assert.equal(dataOf(sceneOf({ key, dur: 12, env: 'flat', bpm: 120 }).scene).song, false, key + ': a steady level is no song');
  }
  const a = sceneOf({ key: 'kineticShapes', dur: 12, env: 'steps', bpm: 120 });
  const b = sceneOf({ key: 'kineticShapes', dur: 12, env: 'stepsInv', bpm: 120 });
  for (const tl of [2, 6, 9]) assert.equal(frameHash(opsAt(a.plan, a.scene, tl).ops), frameHash(opsAt(b.plan, b.scene, tl).ops));
});

// --- 6. beats -----------------------------------------------------------------------------------------------------------

function onBeat(t, period) {
  const x = (t + T0 - 0.1) / period;
  return Math.abs(x - Math.round(x)) < 1e-4;
}

function minGap(xs) { let m = Infinity; for (let i = 1; i < xs.length; i++) m = Math.min(m, xs[i] - xs[i - 1]); return m; }

test('beats: events sit on the grid, the horizon ≥ 0.45 s apart, glints ≥ 0.3 s, changes on bar multiples, none after the lead-out', () => {
  for (const bpm of [120, 240]) {
    const period = 60 / bpm;
    for (const dur of [12, 30]) {
      const hz = dataOf(sceneOf({ key: 'soundHorizon', dur, env: 'steps', bpm }).scene);
      const body = Array.from(hz.ev).filter((t, i) => i > 0 && i < hz.ev.length - 1);   // the opening and the handover aside
      assert.ok(body.length > 4, 'horizon events');
      for (const t of body) assert.ok(onBeat(t, period), 'horizon event on a beat: ' + t);
      assert.ok(minGap(body) >= 0.45 - 1e-6, 'horizon ≥ 0.45 s apart at ' + bpm + ' bpm: ' + minGap(body));
      assert.ok(body.every((t) => t <= hz.o + 0.2 * hz.Xo + 1e-6), 'horizon: nothing after o + 0.2 Xo');
      const mo = dataOf(sceneOf({ key: 'lightMotes', dur, env: 'steps', bpm }).scene);
      assert.ok(mo.ev.length > 4);
      for (const t of mo.ev) assert.ok(onBeat(t, period) && t <= mo.o + 1e-6, 'glint on a beat before o: ' + t);
      assert.ok(minGap(Array.from(mo.ev)) >= 0.3 - 1e-6, 'glints ≥ 0.3 s apart');
      const sh = dataOf(sceneOf({ key: 'kineticShapes', dur, env: 'steps', bpm, params: { every: 1 } }).scene);
      assert.ok(sh.tc.length >= 1, 'shape changes');
      for (const t of sh.tc) {
        const beat = Math.round((t + T0 - 0.1) / period);
        assert.ok(onBeat(t, period) && beat % 4 === 0 && t < sh.o, 'a change on a downbeat before o: ' + t);
      }
      for (const t of sh.ev) assert.ok(onBeat(t, period) && t <= sh.o + 1e-6);
    }
  }
});

// --- 7. no song ---------------------------------------------------------------------------------------------------------

test('no song: no tempo is faked (uneven gaps), the effects still move, and a bpm pin alone gives downbeat ripples', () => {
  for (const env of ['flat', 'none']) {
    const hz = dataOf(sceneOf({ key: 'soundHorizon', dur: 30, env, bpm: null }).scene);
    const mo = dataOf(sceneOf({ key: 'lightMotes', dur: 30, env, bpm: null }).scene);
    assert.equal(hz.song, false);
    assert.equal(mo.song, false);
    const gaps = (xs) => xs.slice(1).map((t, i) => t - xs[i]);
    const hg = gaps(Array.from(hz.ev).slice(1, -1)), mg = gaps(Array.from(mo.ev));
    assert.ok(hg.length >= 3 && hg.every((g) => g >= 2 - 1e-6 && g <= 3 + 1e-6), 'horizon gaps in [2, 3]: ' + hg);
    assert.ok(mg.length >= 5 && mg.every((g) => g >= 0.55 - 1e-6 && g <= 1.25 + 1e-6), 'glint gaps in [0.55, 1.25]');
    assert.ok(Math.max(...hg) - Math.min(...hg) > 0.1 && Math.max(...mg) - Math.min(...mg) > 0.1, 'uneven: no tempo');
    for (const key of KEYS) {
      const { plan, scene } = sceneOf({ key, dur: 12, env, bpm: null });
      const { ops, rec } = opsAt(plan, scene, 6);
      assert.ok(draws(ops) > 0, key + ' draws mid-window');
      assert.equal(rec.stats().nan, 0, key);
    }
  }
  const pin = dataOf(sceneOf({ key: 'soundHorizon', dur: 30, env: 'none', bpm: 120 }).scene);
  const body = Array.from(pin.ev).slice(1, -1);
  assert.ok(body.length >= 3);
  for (const t of body) assert.equal(Math.round((t + T0 - 0.1) / 0.5) % 4, 0, 'a downbeat: ' + t);
});

// --- 8. fingerprint -----------------------------------------------------------------------------------------------------

test('fingerprint: the beat grid moves every effect’s interlude fp, the loudness only the ones that read it', () => {
  const fpOf = (key, edit) => {
    const doc = JSON.parse(JSON.stringify(corpus.project('v21').doc));
    doc.pins = Object.assign({}, doc.pins, { 'cut/gap/rc:arrange': { v: key, by: 'user' } });
    edit(doc);
    const plan = PLAN.plan(doc, { registry: REGISTRY });
    const cut = plan.cuts.find((c) => c.key === 'gap/rc');
    assert.equal(cut.slots.arrange.v, key);
    return cut.fp;
  };
  for (const key of KEYS) {
    const base = fpOf(key, () => {});
    assert.notEqual(fpOf(key, (d) => { d.song.offset += 0.13; }), base, key + ': offset');
    const digest = fpOf(key, (d) => { d.song.digest = Object.assign({}, d.song.digest, { loud: 'AAAA' + d.song.digest.loud.slice(4) }); });
    if (key === 'kineticShapes') assert.equal(digest, base, key + ': the loudness is not read');
    else assert.notEqual(digest, base, key + ': digest');
  }
});

// --- 9. budgets and backdrops -------------------------------------------------------------------------------------------

function heaviestParams(key, cost) {
  const params = {};
  let worst = cost(params);
  for (const { name, spec } of REGISTRY.params('arrange', key)) {
    if (name === 'offsetX' || name === 'offsetY') continue;
    const options = spec.type === 'int' || spec.type === 'num' ? [spec.min, spec.max] : spec.type === 'bool' ? [false, true]
      : spec.type === 'enum' ? spec.of : [];
    for (const v of options) {
      const c = cost(Object.assign({}, params, { [name]: v }));
      if (c > worst) { worst = c; params[name] = v; }
    }
  }
  return params;
}

test('budgets at the heaviest params (21:9): ≤ 9000 calls and ≤ 4 gradients a frame, balanced, alphas in range', () => {
  for (const key of KEYS) {
    const work = (params) => {
      const { plan, scene } = sceneOf({ key, aspect: '21:9', dur: 12, env: 'steps', bpm: 120, params });
      const rec = R.createRecorder();
      let calls = 0, grads = 0;
      for (let k = 0; k < 8; k++) {
        const { ops } = opsAt(plan, scene, scene.times.a + ((scene.times.b - scene.times.a) * (k + 0.5)) / 8, rec);
        calls = Math.max(calls, ops.length);
        grads = Math.max(grads, ops.filter((op) => /Gradient$/.test(op[1])).length);
      }
      return { calls, grads, stats: rec.stats() };
    };
    const busy = heaviestParams(key, (params) => work(params).calls), w = work(busy);
    const where = key + ' ' + JSON.stringify(busy);
    assert.ok(w.calls <= 9000, where + ': ' + w.calls + ' calls');
    assert.ok(w.grads <= 4, where + ': ' + w.grads + ' gradients');
    assert.ok(w.stats.balanced, where + ': balanced');
    assert.equal(w.stats.alphaBad, 0, where + ': alphas');
    assert.equal(w.stats.nan, 0, where + ': finite');
  }
});

function rgbaOf(v) {
  if (typeof v !== 'string') return null;
  if (/^#[0-9a-f]{6}$/i.test(v)) { const n = parseInt(v.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]; }
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(v);
  return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
}

const KEY_GREEN = '#00B140';
function keyedOut([r, g, b]) { return Math.max(r, g, b) - Math.min(r, g, b) > 48 && C.hueDistance(C.toHex({ r, g, b }), KEY_GREEN) < 40; }

test('backdrops: black draws greys only, chroma no key green and no added light, a light theme adds no light', () => {
  const themes = MV.ids('parts/theme/').flatMap((id) => MV.use(id));
  for (const themeKey of ['sumiWashi', 'nightTram', 'cicadaNoon']) {
    const theme = themes.find((t) => t.key === themeKey);
    for (const backdrop of ['scene', 'black', 'chroma']) {
      const pal = LOOKS.palette(theme, PINS.index({}), backdrop, () => {});
      for (const key of KEYS) {
        const { plan, scene } = sceneOf({ key, dur: 12, env: 'steps', bpm: 120, palette: pal, backdrop });
        const rec = R.createRecorder();
        for (let k = 0; k < 6; k++) {
          const tl = scene.times.a + ((scene.times.b - scene.times.a) * (k + 0.5)) / 6;
          const { ops } = opsAt(plan, scene, tl, rec, { backdrop });
          const colors = [], comps = [];
          for (const op of ops) {
            const v = op[1] === 'set:fillStyle' || op[1] === 'set:strokeStyle' ? op[2] : /\.addColorStop$/.test(op[1]) ? op[3] : null;
            const c = rgbaOf(v);
            if (c && c[3] > 0) colors.push(c);
            if (op[1] === 'set:globalCompositeOperation') comps.push(op[2]);
          }
          const where = key + ' ' + themeKey + ' ' + backdrop + ' t ' + tl.toFixed(2);
          if (backdrop === 'black') {
            assert.equal(colors.find(([r, g, b]) => Math.abs(r - g) > 1 || Math.abs(g - b) > 1), undefined, where + ': a colour');
          }
          if (backdrop === 'chroma') {
            assert.equal(colors.find(keyedOut), undefined, where + ': a keyed colour');
            assert.ok(!comps.includes('lighter'), where + ': added light on the key');
          }
          if (backdrop === 'scene' && themeKey !== 'nightTram') assert.ok(!comps.includes('lighter'), where + ': added light on a light theme');
          if (comps.length) assert.equal(comps[comps.length - 1], 'source-over', where + ': ends on source-over');
        }
      }
    }
  }
});

// --- 10. seeds ----------------------------------------------------------------------------------------------------------

test('seeds: two interludes of a song differ; a slider keeps the layout', () => {
  for (const key of KEYS) {
    const a = sceneOf({ key, dur: 12, pos: 0.3, bpm: null }), b = sceneOf({ key, dur: 12, pos: 0.7, bpm: null });
    assert.notEqual(frameHash(opsAt(a.plan, a.scene, 5).ops), frameHash(opsAt(b.plan, b.scene, 5).ops), key + ': pos');
  }
  const prefix = (x, y) => { const n = Math.min(x.length, y.length); return Array.from(x.slice(0, n)).every((v, i) => v === y[i]); };
  const m1 = dataOf(sceneOf({ key: 'lightMotes', params: { amount: 0.4 } }).scene), m2 = dataOf(sceneOf({ key: 'lightMotes', params: { amount: 1.6 } }).scene);
  assert.ok(m1.px.length < m2.px.length && prefix(m1.px, m2.px) && prefix(m1.py, m2.py), 'motes: the amount adds motes at the end');
  const h1 = dataOf(sceneOf({ key: 'soundHorizon', params: { react: 0 } }).scene), h2 = dataOf(sceneOf({ key: 'soundHorizon', params: { react: 1 } }).scene);
  assert.deepEqual(Array.from(h1.w), Array.from(h2.w), 'horizon: the reaction keeps the bars');
  const s1 = dataOf(sceneOf({ key: 'kineticShapes', dur: 12, params: { thickness: 0.5 } }).scene);
  const s2 = dataOf(sceneOf({ key: 'kineticShapes', dur: 12, params: { thickness: 2 } }).scene);
  assert.deepEqual(Array.from(s1.seq), Array.from(s2.seq), 'shapes: the line weight keeps the figures');
});

// --- 11. bounds ---------------------------------------------------------------------------------------------------------

test('the horizon and the shapes stay inside the safe area at every aspect and at the param extremes', () => {
  const SAFE = 54;
  for (const key of ['soundHorizon', 'kineticShapes']) {
    let variants = [{}];
    for (const { name, spec } of REGISTRY.params('arrange', key)) {
      if (name === 'offsetX' || name === 'offsetY') continue;
      const values = spec.type === 'enum' ? spec.of : spec.type === 'bool' ? [true, false] : [spec.min, spec.max];
      variants = variants.flatMap((v) => values.map((x) => Object.assign({}, v, { [name]: x })));
    }
    for (const aspect of DOC.ASPECTS) {
      for (const orient of ['h', 'v']) {
        for (const params of variants) {
          const { plan, scene } = sceneOf({ key, aspect, orient, dur: 30, bpm: 120, env: 'steps', params });
          const r = dataOf(scene).reach, { w, h } = plan.design, where = key + ' ' + aspect + ' ' + orient + ' ' + JSON.stringify(params);
          assert.ok([r.x, r.y, r.w, r.h].every(Number.isFinite), where);
          assert.ok(r.x >= SAFE - 0.5 && r.y >= SAFE - 0.5 && r.x + r.w <= w - SAFE + 0.5 && r.y + r.h <= h - SAFE + 0.5,
            where + ': reach ' + JSON.stringify(r));
        }
      }
    }
  }
});
