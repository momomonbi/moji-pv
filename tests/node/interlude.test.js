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
const KEYS = ['kineticShapes', 'lightMotes', 'neonWave', 'soundHorizon'];
const TEXT = createTextService({ measurer: fakeMeasurer(), faces: null });
const T0 = 10;
const FULL = '1,1,1,1,1';                      // 表現の強さ at full: the event mechanics without the strength's thinning

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
  const needs = { lightMotes: ['beats', 'level'], soundHorizon: ['beats', 'level'], kineticShapes: ['beats', 'level'], neonWave: ['beats', 'level'] };
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

test('with every effect denied the fallback draws nothing on a blank interlude; a 間の印 pin still shows ♪', () => {
  const base = corpus.project('lrc').doc;
  const doc = Object.assign({}, base, { filters: Object.assign({}, base.filters, { arrange: { only: null, deny: KEYS.slice() } }) });
  const { plan, cuts } = interludeScenes(doc);
  assert.ok(cuts.length > 0);
  for (const { cut, scene } of cuts) {
    assert.equal(cut.slots.arrange.v, 'centerAnchor', cut.key);
    assertTextless(plan, cut, scene, 'fallback ' + cut.key);
  }
  const pinned = Object.assign({}, base, { pins: Object.assign({}, base.pins, { 'cut/gap/ra:arrange': { v: 'breathMark', by: 'user' } }) });
  const ra = interludeScenes(pinned).cuts.find((c) => c.cut.key === 'gap/ra');
  assert.equal(ra.cut.slots.arrange.v, 'breathMark');
  const t = ra.scene.target, chars = [];
  for (let j = 0; j < t.to - t.from; j++) chars.push(t.ch[j]);
  assert.ok(chars.join('').includes('♪') || chars.length > 0, 'the pinned breath mark draws its label');
});

// The 構図 page's 最小限 preset as documents saved it before the interlude effects (breathMark was pooled then).
const SAVED_MINIMAL = ['breathMark', 'centerAnchor', 'cornerNote', 'creditFold', 'diptychSplit', 'pillarColumns', 'sidebarIndex'];

test('saved filters: an only list naming 間の印 admits the effects, one naming no interlude part leaves interludes free', () => {
  const base = corpus.project('lrc').doc;
  const withArrange = (f, pins) => Object.assign({}, base, { filters: Object.assign({}, base.filters, { arrange: f }),
    pins: Object.assign({}, base.pins, pins || {}) });
  const codes = (plan) => plan.warnings.map((w) => w.code + '|' + (w.path || '')).sort();
  const lyricOnly = SAVED_MINIMAL.filter((k) => k !== 'breathMark');
  for (const only of [SAVED_MINIMAL, lyricOnly, ['centerAnchor']]) {
    const f = { only: only.slice(), deny: null };
    // the registry and the planner read the filter alike
    assert.deepEqual(REGISTRY.pool('arrange', { role: 'interlude', filters: { arrange: f } }).slice().sort(), KEYS, only.join());
    assert.deepEqual(REGISTRY.pool('arrange', { role: 'lyric', filters: { arrange: f } }).filter((k) => !only.includes(k)), [], only.join());
    const free = PLAN.plan(withArrange({ only: null, deny: null }), { registry: REGISTRY });
    const { plan, cuts } = interludeScenes(withArrange(f));
    assert.ok(cuts.length > 0);
    for (const { cut, scene } of cuts) {
      assert.ok(KEYS.includes(cut.slots.arrange.v), only.join() + ' ' + cut.key + ': ' + cut.slots.arrange.v);
      assertTextless(plan, cut, scene, cut.key);
    }
    for (const cut of plan.cuts.filter((c) => c.role === 'lyric' || c.role === 'focus')) {
      assert.ok(only.includes(cut.slots.arrange.v), cut.key + ' keeps to the list: ' + cut.slots.arrange.v);
    }
    const added = codes(plan).filter((c) => !codes(free).includes(c));
    assert.deepEqual(added.filter((c) => /arrange/.test(c) && /gap\//.test(c)), [], only.join() + ': no warning on an interlude');
    // a pinned effect on an interlude is not reported as filtered either
    const pinned = PLAN.plan(withArrange(f, { 'cut/gap/ra:arrange': { v: 'lightMotes', by: 'user' } }), { registry: REGISTRY });
    assert.ok(!pinned.warnings.some((w) => w.code === 'pin-filtered'), only.join() + ': pin-filtered');
  }
  // a deny list is read as it is: denying all but one leaves that one
  const two = interludeScenes(withArrange({ only: SAVED_MINIMAL.slice(), deny: ['lightMotes', 'soundHorizon', 'neonWave'] }));
  for (const { cut } of two.cuts) assert.equal(cut.slots.arrange.v, 'kineticShapes', cut.key);
  // an only list that names effects keeps to them
  const one = interludeScenes(withArrange({ only: ['centerAnchor', 'lightMotes'], deny: null }));
  for (const { cut } of one.cuts) assert.equal(cut.slots.arrange.v, 'lightMotes', cut.key);
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
        // the line before runs to 0.25 and the next is sung at dur: the effect waits for the one and is gone before the other
        assert.equal(draws(opsAt(plan, scene, 0.14).ops), 0, where + ': nothing over the line before');
        assert.equal(draws(opsAt(plan, scene, dur - 0.05).ops), 0, where + ': nothing when the next line is sung');
        assert.ok(Math.abs(d.h - (dur - 0.25)) < 1e-9, where + ': the climax 0.25 s before the next line');
      }
    }
  }
  // the handover ripple fills out and fades on its own short life, before the next line
  const hz = sceneOf({ key: 'soundHorizon', dur: 12, bpm: 120, env: 'steps', params: { ripples: true } });
  const rip = paintsOf(hz.scene).find((x) => x.layer === 'far').rec.data, last = rip.ev.length - 1;
  assert.ok(Math.abs(rip.ev[last] - (rip.h - 0.3)) < 1e-4 && rip.life[last] === Float32Array.of(0.45)[0], 'the handover ripple');
  assert.ok(rip.ev[last] + rip.life[last] < 12 - 0.05, 'the handover ripple is gone before the next line');
});

test('timing: with lead 0.5 and tail 1 the effect waits out the line before and is gone as the next cut opens', () => {
  const smooth = (x) => { const u = Math.min(1, Math.max(0, x)); return u * u * (3 - 2 * u); };
  const am = (d, t) => smooth((t - d.s0) / d.E) * (1 - smooth((t - d.hEnd) / d.endSpan));
  for (const [lead, tail] of [[0.12, 0.25], [0.5, 0.25], [0.12, 1], [0.5, 1]]) {
    for (const key of KEYS) {
      const doc = JSON.parse(JSON.stringify(corpus.project('v21').doc));
      doc.timing = Object.assign({}, doc.timing, { lead, tail });
      doc.pins = Object.assign({}, doc.pins, { 'cut/gap/rc:arrange': { v: key, by: 'user' } });
      const plan = PLAN.plan(doc, { registry: REGISTRY });
      const i = plan.cuts.findIndex((c) => c.key === 'gap/rc');
      const cut = plan.cuts[i], prev = plan.cuts[i - 1], next = plan.cuts[i + 1];
      const text = createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces });
      const scene = BUILD.buildCut(cut, plan, { registry: REGISTRY, text, strict: true });
      const d = dataOf(scene), where = key + ' lead ' + lead + ' tail ' + tail;
      const prevEnd = prev.b - cut.t0, nextOpen = next.a - cut.t0;
      assert.ok(Math.abs(prevEnd - tail) < 1e-6 && Math.abs(nextOpen - (cut.feat.dur - lead)) < 2e-3, where + ': the neighbours');
      assert.ok(am(d, prevEnd) < 0.15 && am(d, nextOpen) < 0.15, where + ': ~0 at the ends ' + am(d, prevEnd).toFixed(3) + ' '
        + am(d, nextOpen).toFixed(3));
      assert.equal(draws(opsAt(plan, scene, prevEnd - 0.1).ops), 0, where + ': nothing while the line before is still there');
      assert.equal(draws(opsAt(plan, scene, nextOpen + 0.1).ops), 0, where + ': nothing once the next cut is in');
      assert.ok(draws(opsAt(plan, scene, 0.5 * (d.s0 + d.E + d.o)).ops) > 0, where + ': drawn in between');
      if (lead === 0.12 && tail === 0.25) assert.ok(d.s0 === 0.15 && d.h === cut.feat.dur - 0.25, where + ': the defaults as before');
    }
  }
});

test('timing: a long tail in a short interlude leaves the lead-out its share (never a snap)', () => {
  for (const key of KEYS) {
    for (const [dur, tail] of [[2.9, 2], [3.5, 3], [1.6, 1.2]]) {
      const plan = ilPlan({ key, dur, env: 'steps', bpm: 120 });
      const cut = plan.cuts[0];
      cut.b = cut.t0 + dur + tail;
      plan.duration = cut.b + 1;
      const d = dataOf(BUILD.buildCut(cut, plan, { registry: REGISTRY, text: TEXT, strict: true }));
      const where = key + ' dur ' + dur + ' tail ' + tail;
      assert.ok(d.Xo >= Math.min(0.3, 0.45 * (d.h - d.s0)) - 1e-9, where + ': lead-out ' + d.Xo.toFixed(3));
      assert.ok(d.s0 + d.E <= d.o + 1e-9 && d.o < d.h, where + ': the entrance, then the lead-out, before the climax');
    }
  }
});

test('light motes: a grey-tinting accent gives way to a shift on a light ground; the key keeps only cores and glints; glints stay put', () => {
  const themes = MV.ids('parts/theme/').flatMap((id) => MV.use(id));
  const inkOn = (themeKey, backdrop) => {
    const pal = LOOKS.palette(themes.find((t) => t.key === themeKey), PINS.index({}), backdrop || 'scene', () => {});
    const { scene } = sceneOf({ key: 'lightMotes', dur: 12, env: 'steps', bpm: 120, palette: pal, backdrop });
    const far = paintsOf(scene).find((x) => x.layer === 'far');
    return { far: far && far.rec.data, mid: dataOf(scene) };
  };
  assert.equal(inkOn('sodaFloat').far.P, 'shiftA', 'sodaFloat: the accent tints the ground grey');
  assert.equal(inkOn('sodaFloat').mid.P, 'accent', 'the motes stay in the accent');
  for (const key of ['sakuraFog', 'sumiWashi', 'nightTram']) assert.equal(inkOn(key).far.P, 'accent', key);
  assert.equal(inkOn('sodaFloat').far.rim, 0.55, 'a light ground: a low rim');
  const chroma = inkOn('cicadaNoon', 'chroma');
  assert.equal(chroma.far, undefined, 'chroma: no bokeh');
  assert.equal(chroma.mid.haloA, 0);
  assert.equal(chroma.mid.glowA, 0);
  // every glint's mote keeps its place (one life cycle) for as long as the star is drawn
  let glints = 0;
  for (const aspect of ['16:9', '9:16']) {
    for (const bpm of [120, null]) {
      for (let k = 0; k < 6; k++) {
        const d = dataOf(sceneOf({ key: 'lightMotes', aspect, dur: 12, env: 'steps', bpm, pos: k / 6 }).scene);
        const cyc = (m, t) => Math.floor((t - d.a) / d.life[m] + d.psi[m]);
        for (let i = 0; i < d.ev.length; i++) {
          for (let j = 0; j < 3; j++) {
            const m = d.gm[i * 3 + j];
            if (m < 0) continue;
            glints++;
            assert.equal(cyc(m, d.ev[i]), cyc(m, Math.min(d.ev[i] + d.gLife, d.o)), 'glint ' + i + ' renews mid-star');
            // no beacon: a mote never glints in two events in a row (nor one apart)
            for (let q = Math.max(0, (i - 2) * 3); q < i * 3; q++) assert.notEqual(d.gm[q], m, 'glint ' + i + ' repeats a mote');
          }
        }
      }
    }
  }
  assert.ok(glints > 100, 'glints ' + glints);
});

test('light motes: in a short interlude the field is well up halfway through the entrance, as the other effects are', () => {
  for (const dur of [3.47, 4]) {
    for (const pos of [0.2, 0.5, 0.8]) {
      const { plan, scene } = sceneOf({ key: 'lightMotes', dur, env: 'steps', bpm: 120, pos });
      const d = dataOf(scene), mean = (t) => { opsAt(plan, scene, t); return d.A.reduce((x, y) => x + y, 0) / d.n; };
      assert.ok(Math.max(...d.st) <= 0.3 + 1e-6, 'the rack spread');
      const ratio = mean(d.s0 + 0.5 * d.E) / mean(d.s0 + d.E);
      assert.ok(ratio >= 0.55, 'dur ' + dur + ' pos ' + pos + ': ' + ratio.toFixed(2) + ' of the field halfway in');
    }
  }
});

// The sub-paths (moveTo … closePath) of the path each fill draws, as point lists.
function filledPaths(ops) {
  const out = [];
  let path = [];
  for (const op of ops) {
    if (op[1] === 'beginPath') path = [];
    else if (op[1] === 'moveTo') path.push([[op[2], op[3]]]);
    else if (op[1] === 'lineTo' && path.length) path[path.length - 1].push([op[2], op[3]]);
    else if (op[1] === 'arc' || op[1] === 'ellipse') path.push(null);
    else if (op[1] === 'fill') out.push(path);
  }
  return out;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

test('light motes: a glint star is two diamonds wound the same way (no hole where they cross)', () => {
  const { plan, scene } = sceneOf({ key: 'lightMotes', dur: 12, env: 'steps', bpm: 120 });
  const d = dataOf(scene);
  let stars = 0;
  for (let i = 0; i < d.ev.length && stars < 8; i++) {
    if (d.gm[i * 3] < 0) continue;
    for (const path of filledPaths(opsAt(plan, scene, d.ev[i] + 0.5 * d.gLife).ops)) {
      if (path.length !== 2 || !path.every((sp) => sp && sp.length === 4)) continue;
      const a1 = signedArea(path[0]), a2 = signedArea(path[1]);
      assert.ok(Math.abs(a1) > 0 && Math.abs(a2) > 0 && Math.sign(a1) === Math.sign(a2), 'star windings ' + a1 + ' ' + a2);
      stars++;
    }
  }
  assert.ok(stars >= 4, 'stars ' + stars);
});

test('kinetic shapes: the beat ticks a small dot by up to 16 %, a large disc by far less, never in one frame', () => {
  const { plan, scene } = sceneOf({ key: 'kineticShapes', dur: 12, env: 'steps', bpm: 120 });
  const d = dataOf(scene);
  const beat = Array.from(d.ev).find((t) => t > d.s0 + d.E + 0.5 && t < d.o - 0.5);
  const radius = (t) => {
    const { ops } = opsAt(plan, scene, t);
    const arcs = ops.filter((op) => op[1] === 'arc' && op[6] - op[5] >= 6.28 && op[5] === 0);
    return arcs.length ? arcs[arcs.length - 1][4] : 0;
  };
  const before = radius(beat - 0.001), at = radius(beat + 1 / 60), peak = Math.max(radius(beat + 0.05), radius(beat + 0.07));
  assert.ok(before > 0 && peak > before, 'the dot ticks');
  assert.ok(at - before < 0.5 * (peak - before), 'the rise takes more than a frame');
  assert.ok(peak / before < 1.17, 'at most 16 %');
});

test('kinetic shapes: the sunrise half ring stays seated on its horizon line through every visit', () => {
  const NF = 21, RS = 3, AA = 14;
  let visits = 0, samples = 0;
  for (const dur of [6, 12]) {
    for (const bpm of [120, null]) {
      for (let k = 0; k < 24; k++) {
        const { plan, scene } = sceneOf({ key: 'kineticShapes', dur, env: 'steps', bpm, pos: k / 24 });
        const d = dataOf(scene), tc = Array.from(d.tc);
        for (let v = 0; v < d.seq.length; v++) {
          if (d.figs[v * NF + RS] !== 0.5) continue;
          visits++;
          const from = v === 0 ? d.s0 + d.E : tc[v - 1] + 0.05;
          const prev = v > 0 ? tc[v - 1] : d.s0 + d.E;
          const to = v < tc.length ? tc[v] - Math.min(0.7, 0.45 * (tc[v] - prev)) : d.o;
          const line = d.figs[v * NF + AA];
          for (let j = 0; j <= 4; j++) {
            const t = from + ((to - from) * j) / 4;
            const arcs = opsAt(plan, scene, t).ops.filter((op) => op[1] === 'arc' && Math.abs(op[6] - op[5] - Math.PI) < 0.01);
            assert.equal(arcs.length, 1, 'one half ring at ' + t);
            for (const end of [arcs[0][5], arcs[0][6]]) {
              const off = Math.abs(((end - line) % Math.PI + 1.5 * Math.PI) % Math.PI - 0.5 * Math.PI);
              assert.ok(off * 180 / Math.PI < 0.5, 'an arc end ' + (off * 180 / Math.PI).toFixed(2) + '° off the line at ' + t);
            }
            samples++;
          }
        }
      }
    }
  }
  assert.ok(visits >= 6 && samples >= 30, 'sunrise visits ' + visits);
});

test('kinetic shapes: the orbit’s dot runs round its ring, and nothing jumps at a change', () => {
  const dotAt = (plan, scene, t) => {
    const arcs = opsAt(plan, scene, t).ops.filter((op) => op[1] === 'arc' && op[5] === 0 && op[6] >= 6.28);
    const a = arcs[arcs.length - 1];
    return a ? [a[2], a[3], a[4]] : null;
  };
  let orbits = 0, changes = 0;
  for (const bpm of [120, null]) {
    for (let k = 0; k < 12; k++) {
      const { plan, scene } = sceneOf({ key: 'kineticShapes', dur: 12, env: 'steps', bpm, pos: k / 12, params: { shape: FULL } });
      const d = dataOf(scene), tc = Array.from(d.tc);
      for (let v = 0; v < d.seq.length; v++) {
        const from = v === 0 ? d.s0 + d.E : tc[v - 1] + 0.45, to = v < tc.length ? tc[v] - 0.75 : d.o;
        if (d.seq[v] !== 0 || to - from < 0.5) continue;
        const p0 = dotAt(plan, scene, from), p1 = dotAt(plan, scene, from + 0.5);
        const r = d.s * 0.26, moved = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        assert.ok(moved > 0.08 * r, 'the orbit dot moves ' + moved.toFixed(1) + ' in 0.5 s');
        orbits++;
      }
      for (const c of tc) {
        const a = dotAt(plan, scene, c - 0.0005), b = dotAt(plan, scene, c + 0.0005);
        assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.5 && Math.abs(b[2] - a[2]) < 0.5, 'the dot jumps at the change ' + c);
        changes++;
      }
    }
  }
  assert.ok(orbits >= 2 && changes >= 20, 'orbits ' + orbits + ', changes ' + changes);
});

// --- 5. level -----------------------------------------------------------------------------------------------------------

test('loudness: the motes and the horizon follow the song; a steady level is no song; the shapes follow it through the strength', () => {
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
  assert.ok([2, 6, 9].some((tl) => frameHash(opsAt(a.plan, a.scene, tl).ops) !== frameHash(opsAt(b.plan, b.scene, tl).ops)),
    'the shapes move with the strength the song gives');
  const fa = sceneOf({ key: 'kineticShapes', dur: 12, env: 'steps', bpm: 120, params: { shape: FULL } });
  assert.notDeepEqual(Array.from(dataOf(fa.scene).I), Array.from(dataOf(a.scene).I), 'a drawn graph replaces the automatic strength');
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
      const hz = dataOf(sceneOf({ key: 'soundHorizon', dur, env: 'steps', bpm, params: { shape: FULL } }).scene);
      const body = Array.from(hz.ev).filter((t, i) => i > 0 && i < hz.ev.length - 1);   // the opening and the handover aside
      assert.ok(body.length > 4, 'horizon events');
      for (const t of body) assert.ok(onBeat(t, period), 'horizon event on a beat: ' + t);
      assert.ok(minGap(body) >= 0.45 - 1e-6, 'horizon ≥ 0.45 s apart at ' + bpm + ' bpm: ' + minGap(body));
      assert.ok(body.every((t) => t <= hz.o + 0.2 * hz.Xo + 1e-6), 'horizon: nothing after o + 0.2 Xo');
      const mo = dataOf(sceneOf({ key: 'lightMotes', dur, env: 'steps', bpm, params: { shape: FULL } }).scene);
      assert.ok(mo.ev.length > 4);
      for (const t of mo.ev) assert.ok(onBeat(t, period) && t <= mo.o + 1e-6, 'glint on a beat before o: ' + t);
      assert.ok(minGap(Array.from(mo.ev)) >= 0.3 - 1e-6, 'glints ≥ 0.3 s apart');
      const sh = dataOf(sceneOf({ key: 'kineticShapes', dur, env: 'steps', bpm, params: { every: 1, shape: FULL } }).scene);
      assert.ok(sh.tc.length >= 1, 'shape changes');
      for (const t of sh.tc) {
        const beat = Math.round((t + T0 - 0.1) / period);
        assert.ok(onBeat(t, period) && beat % 4 === 0 && t < sh.o, 'a change on a downbeat before o: ' + t);
      }
      for (const t of sh.ev) assert.ok(onBeat(t, period) && t <= sh.o + 1e-6);
    }
  }
  // the beat shows even where the song is quiet (the level is 0 in the first half of 'steps'): the centre bar rises
  // by ≥ 0.1 hA just after every beat, a downbeat more
  const { plan, scene } = sceneOf({ key: 'soundHorizon', dur: 12, env: 'steps', bpm: 120, params: { shape: FULL } });
  const d = dataOf(scene);
  const centre = (t) => { const m = opsAt(plan, scene, t).ops.find((op) => op[1] === 'moveTo' && Math.abs(op[2] - d.cx) < 0.01); return d.cy - m[3]; };
  let quiet = 0;
  for (let j = 0; j < d.bt.length; j++) {
    const b = d.bt[j];
    if (b < d.s0 + d.E + 0.3 || b > 5.5) continue;
    assert.equal(d.lv[Math.round((b - d.L0) * 20)], 0, 'a quiet beat');
    const rise = (centre(b + 0.03) - centre(b - 0.005)) / d.hA;
    assert.ok(rise >= (d.bd[j] ? 0.15 : 0.1), 'the centre bar rises by ' + rise.toFixed(3) + ' hA on the beat at ' + b);
    quiet++;
  }
  assert.ok(quiet >= 4, 'quiet beats ' + quiet);
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
  // without a song the row is a calm wave, not a meter: half as tall, and close from bar to bar
  for (const env of ['flat', 'none']) {
    const { plan, scene } = sceneOf({ key: 'soundHorizon', dur: 12, env, bpm: null });
    const d = dataOf(scene), song = dataOf(sceneOf({ key: 'soundHorizon', dur: 12, env: 'steps', bpm: null }).scene);
    assert.ok(Math.abs(d.hA / song.hA - 0.5) < 1e-9, env + ': half the amplitude');
    for (const tl of [4, 6, 8]) {
      opsAt(plan, scene, tl);
      let jump = 0;
      for (let k = 1; k <= d.nb; k++) jump = Math.max(jump, Math.abs(d.H[k] - d.H[k - 1]));
      assert.ok(jump < 0.1 * d.hA, env + ': bar-to-bar ' + (jump / d.hA).toFixed(3) + ' hA at ' + tl);
    }
  }
  const pin = dataOf(sceneOf({ key: 'soundHorizon', dur: 30, env: 'none', bpm: 120 }).scene);
  const body = Array.from(pin.ev).slice(1, -1);
  assert.ok(body.length >= 3);
  for (const t of body) assert.equal(Math.round((t + T0 - 0.1) / 0.5) % 4, 0, 'a downbeat: ' + t);
});

test('long interludes: every event stream is thinned to its cap, never cut short, and runs up to the lead-out', () => {
  const tail = (xs, gap, o, where) => {
    let most = 0;
    for (let i = 1; i < xs.length; i++) most = Math.max(most, xs[i] - xs[i - 1]);
    assert.ok(xs.length > 0, where + ': events');
    assert.ok(o - xs[xs.length - 1] <= Math.max(2, most, gap) + 0.25, where + ': the last at ' + xs[xs.length - 1].toFixed(2)
      + ', o ' + o.toFixed(2));
  };
  for (const dur of [60, 120]) {
    for (const [bpm, env] of [[120, 'steps'], [180, 'steps'], [120, 'none'], [180, 'none'], [null, 'steps'], [null, 'none']]) {
      const where = 'dur ' + dur + ' bpm ' + bpm + ' ' + env;
      const period = bpm ? 60 / bpm : 0;
      const mo = dataOf(sceneOf({ key: 'lightMotes', dur, bpm, env, params: { shape: FULL } }).scene);
      assert.ok(mo.ev.length <= 64, where + ': glints ' + mo.ev.length);
      tail(Array.from(mo.ev), 0, mo.o, where + ' glints');
      const hz = sceneOf({ key: 'soundHorizon', dur, bpm, env, params: { ripples: true, shape: FULL } }).scene;
      const far = paintsOf(hz).find((p) => p.layer === 'far').rec.data, mid = dataOf(hz);
      const body = Array.from(far.ev).slice(1, -1);
      assert.ok(body.length <= 46, where + ': ripples ' + body.length);
      tail(body, 0, mid.o, where + ' ripples');
      assert.ok(mid.bt.length <= 128, where + ': kicks');
      if (mid.bt.length) tail(Array.from(mid.bt), 0, mid.o, where + ' kicks');
      const sh = dataOf(sceneOf({ key: 'kineticShapes', dur, bpm, env, params: { every: 1, shape: FULL } }).scene);
      assert.ok(sh.tc.length <= 24 && sh.ev.length <= 128, where + ': changes ' + sh.tc.length + ', beats ' + sh.ev.length);
      tail(Array.from(sh.tc), 0, sh.o, where + ' changes');
      if (bpm) {
        tail(Array.from(sh.ev), sh.evGap, sh.o, where + ' beats');
        // a thinned beat list keeps the downbeats: every kept beat is a downbeat, or every downbeat is kept
        const idx = Array.from(sh.ev, (t) => Math.round((t + T0 - 0.1) / period));
        const step = Math.round(sh.evGap / period);
        assert.ok(step % 4 === 0 || 4 % step === 0, where + ': step ' + step);
        assert.ok(idx.every((k) => k % step === 0), where + ': on the step');
      }
    }
  }
  // the dashed ring keeps turning after the last beat
  const { plan, scene } = sceneOf({ key: 'kineticShapes', dur: 12, bpm: 120, env: 'steps', params: { every: 1 } });
  const d = dataOf(scene), last = d.ev[d.ev.length - 1];
  const turn = (t) => { const op = opsAt(plan, scene, t).ops.find((x) => x[1] === 'rotate'); return op ? op[2] : null; };
  const t1 = last + 0.2, t2 = t1 + 0.1;
  assert.ok(t2 < d.o + 0.3, 'still before the ring has closed');
  assert.ok(turn(t1) !== null && turn(t2) !== null && turn(t2) > turn(t1), 'the ring turns on after the last beat');
});

// --- 8. fingerprint -----------------------------------------------------------------------------------------------------

test('表現の強さ: a drawn graph sets the strength, auto follows the song, a bad value reads as auto, calm thins the events', () => {
  const at = (d, u) => d.I[Math.round((d.s0 + u * (d.h - d.s0) - d.IA) * 20)];
  for (const key of KEYS) {
    const drawn = dataOf(sceneOf({ key, dur: 12, env: 'none', bpm: 120, params: { shape: '0,0.25,1,0.25,0' } }).scene);
    assert.ok(at(drawn, 0) < 0.02 && Math.abs(at(drawn, 0.25) - 0.25) < 0.05 && at(drawn, 0.5) > 0.98, key + ': the graph');
    const bad = dataOf(sceneOf({ key, dur: 12, env: 'none', bpm: 120, params: { shape: '1,2,x' } }).scene);
    const auto = dataOf(sceneOf({ key, dur: 12, env: 'none', bpm: 120 }).scene);
    assert.deepEqual(Array.from(bad.I), Array.from(auto.I), key + ': a bad value reads as auto');
    const loud = dataOf(sceneOf({ key, dur: 12, env: 'steps', bpm: 120 }).scene);      // quiet first half, loud second
    assert.ok(at(loud, 0.85) > at(loud, 0.15) + 0.3, key + ': auto follows the song ' + at(loud, 0.15) + ' → ' + at(loud, 0.85));
  }
  const calm = dataOf(sceneOf({ key: 'lightMotes', dur: 12, env: 'none', bpm: 120, params: { shape: '0.2,0.2,0.2,0.2,0.2' } }).scene);
  const busy = dataOf(sceneOf({ key: 'lightMotes', dur: 12, env: 'none', bpm: 120, params: { shape: FULL } }).scene);
  assert.ok(calm.ev.length > 0 && calm.ev.length < busy.ev.length, 'a calm graph keeps fewer glints: ' + calm.ev.length + ' < ' + busy.ev.length);
});

test('fingerprint: the beat grid and the loudness move every effect’s interlude fp', () => {
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
    assert.notEqual(digest, base, key + ': digest (every effect reads the loudness, the shapes through the strength)');
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

// The effective alpha of every fill and stroke in ops, with its path kind: 'ellipse' (a ripple ring), 'star' (a glint:
// moveTo/lineTo only) or 'solid'; a gradient counts by its strongest stop.
function inkAlphas(ops) {
  const out = [], stops = new Map(), stack = [];
  let st = { a: 1, fill: 1, stroke: 1 }, kind = 'solid';
  const styleA = (v) => (stops.has(v) ? stops.get(v) : (rgbaOf(v) || [0, 0, 0, 1])[3]);
  for (const op of ops) {
    const name = op[1];
    if (/\.addColorStop$/.test(name)) {
      const id = name.slice(0, -'.addColorStop'.length), c = rgbaOf(op[3]);
      stops.set(id, Math.max(stops.get(id) || 0, c ? c[3] : 1));
    } else if (name === 'save') stack.push(Object.assign({}, st));
    else if (name === 'restore') st = stack.pop() || st;
    else if (name === 'set:globalAlpha') st.a = op[2];
    else if (name === 'set:fillStyle') st.fill = styleA(op[2]);
    else if (name === 'set:strokeStyle') st.stroke = styleA(op[2]);
    else if (name === 'beginPath') kind = 'star';
    else if (name === 'arc' || name === 'rect') kind = 'solid';
    else if (name === 'ellipse') kind = 'ellipse';
    else if (name === 'fill' || name === 'fillRect') out.push({ kind: name === 'fillRect' ? 'solid' : kind, a: st.a * st.fill });
    else if (name === 'stroke') out.push({ kind: kind === 'star' ? 'solid' : kind, a: st.a * st.stroke });
  }
  return out;
}

test('chroma: in the hold every effect draws solid (α ≥ 0.5) over the key, bar the fading ripples and glints', () => {
  const themes = MV.ids('parts/theme/').flatMap((id) => MV.use(id));
  for (const themeKey of ['sumiWashi', 'nightTram', 'cicadaNoon']) {
    const pal = LOOKS.palette(themes.find((t) => t.key === themeKey), PINS.index({}), 'chroma', () => {});
    for (const key of KEYS) {
      for (const bpm of [120, null]) {
        const { plan, scene } = sceneOf({ key, dur: 12, env: 'steps', bpm, palette: pal, backdrop: 'chroma', params: key === 'kineticShapes' ? { dial: true } : {} });
        const d = dataOf(scene);
        let n = 0;
        for (let k = 0; k < 8; k++) {
          const tl = d.s0 + d.E + 0.3 + ((d.o - 0.1 - (d.s0 + d.E + 0.3)) * k) / 7;
          for (const x of inkAlphas(opsAt(plan, scene, tl, null, { backdrop: 'chroma' }).ops)) {
            if (x.kind !== 'solid' || x.a === 0) continue;
            assert.ok(x.a >= 0.5 - 1e-6, key + ' ' + themeKey + ' bpm ' + bpm + ' t ' + tl.toFixed(2) + ': α ' + x.a);
            n++;
          }
        }
        assert.ok(n >= 6, key + ': draws ' + n);
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
