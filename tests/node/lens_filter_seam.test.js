/* 文字PVメーカー v2 — original work. Tests: the camera (lens), screen effect (filter) and transition (seam) catalog of WP5b2 — DESIGN §5.7–§5.9 and the picture of each part. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

// conformance.test.js runs every part through the §8.2 matrix (no throw, no NaN, balanced drawing, surfaces given
// back, determinism, budgets). This file checks what that matrix cannot see: the §5 tables and the traits the planner
// relies on, what each camera does to the camera node over time, and what each filter and transition draws — amount 0
// is off, events fire when they should, tick-based looks hold still between ticks. Pixel-level checks (a transition
// really goes from a to b, alpha-safe filters keep empty areas empty) are in tests/browser/fx_parts.py.

const MV = load();
const H = MV.use('core/hash');
const REG = MV.use('core/registry');
const FAC = MV.use('engine/facade');
const BUILD = MV.use('engine/scene/build');
const F = MV.use('engine/scene/frame');
const R = MV.use('engine/render/record');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');

const KINDS = ['lens', 'filter', 'seam'];
const OWN = MV.ids('parts/').filter((id) => KINDS.some((k) => id.startsWith('parts/' + k + '/'))).flatMap((id) => MV.use(id));
const HOSTS = corpus.minimalFallbacks().filter((d) => !KINDS.includes(d.kind));
const REGISTRY = REG.createRegistry(OWN.concat(HOSTS));
const def = (kind, key) => REGISTRY.get(kind, key);

// --- the §5 tables -----------------------------------------------------------------------------------------------

const DESIGN = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'DESIGN.md'), 'utf8');

function section(heading) {
  const from = DESIGN.indexOf(heading);
  assert.ok(from >= 0, 'DESIGN.md has ' + heading);
  return DESIGN.slice(from, DESIGN.indexOf('\n### ', from + 1));
}

function tableOf(chunk) {
  const cells = (line) => line.split('|').slice(1, -1).map((s) => s.trim());
  const lines = chunk.split('\n').filter((l) => l.startsWith('|'));
  const head = cells(lines[0]);
  return lines.filter((l) => l.startsWith('| `')).map((l) => {
    const row = { key: /`(\w+)`/.exec(l)[1], fallback: l.includes('(fb)') };
    cells(l).forEach((c, i) => { row[head[i]] = c; });
    return row;
  });
}

const TABLES = {
  lens: tableOf(section('### 5.7 Cameras')),
  filter: tableOf(section('### 5.8 Screen effects')),
  seam: tableOf(section('### 5.9 Transitions')),
};
const TEXTURES = (/marked `texture: true`: (.+?)\.\s/.exec(section('### 5.8 Screen effects').replace(/\s*\n\s*/g, ' '))[1]
  .match(/`(\w+)`/g) || []).map((s) => s.slice(1, -1));
const JAPANESE = /[぀-ヿ㐀-鿿]/;

test('every §5.7–§5.9 part is defined once, with the table’s labels, tags, stage/scope, replace rule and fallback', () => {
  const counts = { lens: 10, filter: 16, seam: 11 };
  for (const kind of KINDS) {
    const rows = TABLES[kind];
    assert.equal(rows.length, counts[kind], kind + ' rows in DESIGN');
    assert.deepEqual(REGISTRY.keys(kind), rows.map((r) => r.key).sort(), kind + ': exactly the table’s keys');
    for (const r of rows) {
      const d = def(kind, r.key);
      assert.deepEqual(d.label, { ja: r.ja, en: r.en }, r.key + ' label');
      assert.deepEqual(d.tags.slice().sort(), r.Tags.split(/\s+/).sort(), r.key + ' tags');
      assert.equal(d.fallback, r.fallback, r.key + ' fallback');
      if (kind === 'filter') assert.equal(d.stage, r.Stage, r.key + ' stage');
      if (kind === 'seam') {
        assert.equal(d.scope, r.Scope, r.key + ' scope');
        assert.deepEqual(Object.keys(d.replaces || {}).filter((k) => d.replaces[k]), r.Replaces === '—' ? [] : [r.Replaces], r.key + ' replaces');
      }
    }
  }
  assert.doesNotThrow(() => REG.createRegistry(OWN.concat(HOSTS), { strict: true }));
});

test('the table notes: gates, impact traits, beats, textAt, textures', () => {
  for (const r of TABLES.filter) {
    const d = def('filter', r.key), pic = r.Picture;
    const gate = /gate `(\w+)`/.exec(pic);
    if (gate) assert.equal(d.gate, gate[1], r.key + ' gate');
    if (/trait impact/.test(pic)) assert.equal(d.traits.impact, true, r.key + ' trait impact');
    if (/needs `textAt`/.test(pic)) assert.ok(d.needs.includes('textAt'), r.key + ' needs textAt');
    assert.equal(d.texture === true, TEXTURES.includes(r.key), r.key + ' texture');
    assert.ok(Number.isInteger(d.cost) && d.cost >= 1 && d.cost <= 5 && d.passes >= 1 && d.passes <= 8, r.key + ' cost/passes');
  }
  assert.ok(def('lens', 'beatZoom').needs.includes('beats'));
  assert.equal(def('lens', 'beatZoom').fits({ beat: 0 }), 0, 'no beat grid: beatZoom is never an auto pick');
  assert.equal(def('lens', 'impactKick').traits.impact, true);
  assert.deepEqual(TEXTURES.slice().sort(), ['dotScreen', 'dustSpecks', 'grainFilm', 'paperTooth', 'rasterLines']);
  assert.equal(REGISTRY.fallback('lens'), 'fixedFrame');
  assert.equal(REGISTRY.fallback('filter'), 'grainFilm');
  assert.equal(REGISTRY.fallback('seam'), 'hardCut');
});

test('labels and blurbs: ja and en, one sentence each, no Japanese in English', () => {
  for (const d of OWN) {
    const where = d.kind + '/' + d.key;
    for (const lang of ['ja', 'en']) assert.ok(d.label[lang] && d.blurb[lang], where + ' ' + lang);
    assert.ok(!/[。！？]/.test(d.blurb.ja.slice(0, -1)), where + ' ja blurb is one sentence');
    assert.ok(!/[.!?]\s/.test(d.blurb.en), where + ' en blurb is one sentence');
    for (const field of ['label', 'blurb']) assert.ok(!JAPANESE.test(d[field].en), where + ' ' + field + '.en');
    for (const [name, spec] of Object.entries(d.params)) {
      assert.ok(spec.label && spec.label.ja && spec.label.en && !JAPANESE.test(spec.label.en), where + '.' + name + ' label');
    }
  }
});

test('roles: the calm cameras and effects also serve title, interlude and outro cuts', () => {
  for (const role of ['title', 'interlude', 'outro']) {
    assert.ok(REGISTRY.pool('lens', { role }).length >= 3, role + ': cameras');
    assert.ok(REGISTRY.pool('filter', { role, texture: false }).length >= 8, role + ': effects');
  }
  for (const key of ['chromaSlip', 'sliceGlitch', 'flashPop', 'invertBlink', 'afterImage']) {
    assert.deepEqual(REGISTRY.traits('filter', key).roles, ['lyric', 'focus'], key + ' stays on lyric cuts');
  }
  assert.deepEqual([REGISTRY.pool('seam', { scope: 'world' }).length, REGISTRY.pool('seam', { scope: 'text' }).sort()],
    [8, ['blendDissolve', 'hardCut', 'sumiSeep']], 'every transition is an auto pick at its scope');
});

// --- cameras -------------------------------------------------------------------------------------------------------

// The camera of one sample cut (engine/facade.samplePlan: the lens in its slot, fallbacks elsewhere, 120 BPM) at
// cut-local times → [{ tl, x, y, zoom, roll, shakeX, shakeY }].
function cameraTrack(key, times, params, planPatch) {
  const plan = FAC.samplePlan(REGISTRY, { kind: 'lens', key, params }, {});
  if (planPatch) planPatch(plan);
  const cut = plan.cuts[0];
  const svc = { registry: REGISTRY, text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
  const scene = BUILD.buildCut(cut, plan, svc);
  return { scene, cut, plan, track: times.map((tl) => {
    F.evaluate(scene, tl);
    return Object.assign({ tl }, F.cameraAt(scene, plan, cut.t0 + tl));
  }) };
}

function steps(lo, hi, n) { return Array.from({ length: n + 1 }, (_, k) => lo + ((hi - lo) * k) / n); }

test('fixedFrame never moves the camera; every camera stays within a sane frame over its window', () => {
  const fixed = cameraTrack('fixedFrame', steps(-0.1, 3, 20));
  assert.equal(fixed.scene.behaviours.filter((b) => b.phase === MV.use('parts/kit').PH.LENS).length, 0, 'no lens behaviour');
  for (const c of fixed.track) assert.deepEqual([c.x, c.y, c.zoom, c.roll], [0, 0, 1, 0]);
  for (const key of REGISTRY.keys('lens')) {
    const { track, plan } = cameraTrack(key, steps(-0.12, 3, 120), { amount: 1 });
    for (const c of track) {
      assert.ok(c.zoom > 0.9 && c.zoom < 1.45, key + ' zoom ' + c.zoom + ' at ' + c.tl);
      assert.ok(Math.abs(c.x) < plan.design.w * 0.2 && Math.abs(c.y) < plan.design.h * 0.2, key + ' travel at ' + c.tl);
      assert.ok(Math.abs(c.roll) < 0.12, key + ' roll ' + c.roll);
    }
  }
});

test('slowPush zooms in steadily about the words; dollyOut starts close and ends at zoom 1', () => {
  const push = cameraTrack('slowPush', steps(-0.12, 3.02, 40), { push: 0.08, amount: 0.5, aim: 1 }).track;
  for (let k = 1; k < push.length; k++) assert.ok(push[k].zoom >= push[k - 1].zoom - 1e-9, 'monotone push');
  assert.ok(Math.abs(push[0].zoom - 1) < 1e-6 && Math.abs(push[push.length - 1].zoom - 1.08) < 2e-3, 'from 1 to 1 + push');
  const dolly = cameraTrack('dollyOut', steps(-0.12, 3.02, 40), { pull: 0.1, amount: 0.5 }).track;
  assert.ok(Math.abs(dolly[0].zoom - 1.1) < 1e-3 && Math.abs(dolly[dolly.length - 1].zoom - 1) < 2e-3, 'from 1 + pull to 1');
  // With the aim at the words, the text block's centre stays where it is on screen (camX = aim · (1 − 1/zoom)).
  const { scene, track, plan } = cameraTrack('slowPush', [2.5], { push: 0.2, amount: 1, aim: 1 }, (p) => {
    p.cuts[0].slots.arrange.p = Object.assign({}, p.cuts[0].slots.arrange.p, { offsetX: 0.25, offsetY: -0.2 });
  });
  const f = scene.focus, fx = f.x + f.w / 2, fy = f.y + f.h / 2, c = track[0], W = plan.design.w, Hh = plan.design.h;
  const sx = W / 2 + c.zoom * (fx - W / 2 - c.x), sy = Hh / 2 + c.zoom * (fy - Hh / 2 - c.y);
  assert.ok(Math.abs(sx - fx) < 0.5 && Math.abs(sy - fy) < 0.5, 'the words hold their place: ' + [sx, fx, sy, fy].join(' '));
});

test('panSweep and parallaxOrbit pass the rest position mid-window; rollSway starts level', () => {
  const pan = cameraTrack('panSweep', steps(-0.12, 3.02, 2), { dir: 'right', dist: 0.08, amount: 0.5 }).track;
  assert.ok(pan[0].x < -50 && Math.abs(pan[1].x) < 1 && pan[2].x > 50, 'right pan from −d to +d: ' + pan.map((c) => c.x.toFixed(1)));
  const orbit = cameraTrack('parallaxOrbit', steps(-0.12, 3.02, 2), { radius: 0.05, sweep: 90, dir: 'cw', amount: 0.5 }).track;
  assert.ok(Math.abs(orbit[1].x) < 1 && Math.sign(orbit[0].x) === -Math.sign(orbit[2].x) && Math.abs(orbit[0].x) > 20);
  assert.ok(Math.sign(orbit[0].roll) === -Math.sign(orbit[0].x), 'the camera turns against its swing');
  const roll = cameraTrack('rollSway', [-0.12, 0.8], { angle: 2, period: 4, amount: 0.5 }).track;
  assert.ok(Math.abs(roll[0].roll) < 1e-6 && Math.abs(roll[1].roll) > 0.01);
});

test('handHeld wanders smoothly and stays small', () => {
  const dt = 1 / 60, track = cameraTrack('handHeld', steps(0, 3, 180), { sway: 12, rate: 0.7, amount: 0.5 }).track;
  let moved = 0;
  for (let k = 1; k < track.length; k++) {
    const dx = Math.abs(track[k].x - track[k - 1].x), dy = Math.abs(track[k].y - track[k - 1].y);
    assert.ok(dx < 2 && dy < 2, 'no jumps between 60 fps frames at ' + track[k].tl.toFixed(3) + ' (' + dx.toFixed(2) + ')');
    moved = Math.max(moved, Math.abs(track[k].x), Math.abs(track[k].y));
  }
  assert.ok(moved > 2 && moved < 20, 'visible but small sway (max ' + moved.toFixed(1) + ' du, dt ' + dt.toFixed(3) + ')');
});

test('beatZoom punches in on each beat and settles before the next; without a grid it pulses every half second', () => {
  const beat = (tl0) => cameraTrack('beatZoom', [tl0 + 0.036, tl0 + 0.4, tl0 + 0.49], { punch: 0.05, decay: 0.1, accent: 1, amount: 0.5 })
    .track.map((c) => c.zoom);
  // sample: 120 BPM with beat 0 at absolute 0; the cut starts at 0.12, so beats sit at cut-local 0.38, 0.88, …
  const z = beat(0.38);
  assert.ok(z[0] > 1.04 && z[1] < 1.002 && z[2] < 1.001, 'peak then settled: ' + z.map((v) => v.toFixed(4)));
  const noGrid = cameraTrack('beatZoom', [0.036, 0.3, 0.536], { punch: 0.05, decay: 0.1, accent: 1, amount: 0.5 }, (p) => { p.beats = null; })
    .track.map((c) => c.zoom);
  assert.ok(noGrid[0] > 1.04 && noGrid[1] < 1.01 && noGrid[2] > 1.04, 'half-second pulses: ' + noGrid.map((v) => v.toFixed(4)));
});

test('impactKick hits at the sung start: a small pull back before, a sharp punch-in and a shake that dies out', () => {
  const t = cameraTrack('impactKick', [-0.2, -0.02, 0.035, 0.4, 2], { kick: 0.1, shake: 20, decay: 0.3, amount: 0.5 }).track;
  assert.equal(t[0].zoom, 1, 'nothing long before');
  assert.ok(t[1].zoom < 1, 'anticipation');
  assert.ok(t[2].zoom > 1.09, 'the punch peaks at once');
  assert.ok(t[3].zoom < t[2].zoom && t[4].zoom < 1.001, 'and settles');
  assert.ok(Math.hypot(t[2].shakeX, t[2].shakeY) > Math.hypot(t[4].shakeX, t[4].shakeY) && Math.hypot(t[4].shakeX, t[4].shakeY) < 0.1);
});

test('impactKick shakes only as much as amount.shake allows: no shake and no jolt at 0', () => {
  const SCH = MV.use('core/schema'), RNG = MV.use('core/rng');
  const spec = REGISTRY.params('lens', 'impactKick').find((x) => x.name === 'shake').spec;
  const auto = (shake) => SCH.autoValue(spec, { f: { impact: true, energy: 0.7 }, look: { amounts: { shake }, mood: null, bpm: null },
    rng: RNG.stream(7, 'param', 'shake') });
  assert.equal(auto(0), 0, 'amount.shake 0 → shake 0');
  assert.ok(auto(0.5) > 10 && auto(1) > auto(0.5), 'more with more amount.shake');
  const noImpulses = (plan) => { plan.impulses = []; };
  const still = cameraTrack('impactKick', [0.01, 0.05, 0.1, 0.3], { kick: 0.1, shake: auto(0), decay: 0.3, amount: 0.8 }, noImpulses).track;
  for (const c of still) assert.deepEqual([c.shakeX, c.shakeY, c.roll], [0, 0, 0], 'still at ' + c.tl);
  assert.ok(still[1].zoom > 1.05, 'the punch-in stays');
  const shaken = cameraTrack('impactKick', [0.01, 0.05, 0.1], { kick: 0.1, shake: auto(0.6), decay: 0.3, amount: 0.8 }, noImpulses).track;
  assert.ok(shaken.some((c) => Math.hypot(c.shakeX, c.shakeY) > 1), 'and shakes when allowed');
});

// --- filters -------------------------------------------------------------------------------------------------------

const FX_W = 320, FX_H = 180;

// A plan for fx lookups: a flash, a slip and a shake impulse at 1.0 s, 120 BPM (beat 0 at 0 s).
function fxPlan(impulses) {
  return { cuts: [], seams: [], beats: { bpm: 120, offset: 0, meter: 4 },
    impulses: impulses === undefined ? [{ t: 1, kind: 'flash', amp: 0.6, decay: 0.18 }, { t: 1, kind: 'slip', amp: 0.8, decay: 0.25 }] : impulses };
}

// Runs one filter through the recording FxContext → { out, src, ops (of this call), rec, fx }.
function runFilter(key, p, t, o) {
  const opt = o || {};
  const rec = R.createRecorder();
  const src = R.surfaceOf(rec.factory, FX_W, FX_H, true);
  const d = def('filter', key);
  const fx = R.createRecordingFx(rec, { w: FX_W, h: FX_H, unit: FX_W / 1920, plan: opt.plan || fxPlan(), cut: opt.cut === undefined ? cutAt(t, false) : opt.cut,
    seed: H.hash32('fx', key), alpha: !!opt.alpha, allowTextAt: d.needs.includes('textAt') });
  if (opt.pal) fx.pal = opt.pal;
  fx.begin();
  const mark = rec.mark();
  const out = d.apply(fx, src, Object.assign(autoParams('filter', key), p), t);
  return { out, src, ops: rec.ops().slice(mark), fx };
}

// Cut info as the renderer passes it: a cut that starts (t0) at 1.0 s and lasts 2 s.
function cutAt(t, impact) { return { tl: t - 1, dur: 2, impact: !!impact, energy: 0.6 }; }

function autoParams(kind, key) {
  const plan = FAC.samplePlan(REGISTRY, { kind, key }, {});
  const slot = kind === 'filter' ? plan.cuts[0].slots['filter#0'] : kind === 'seam' ? plan.seams[0].slot : plan.cuts[0].slots.lens;
  return Object.assign({}, slot.p);
}

test('amount 0 switches every filter off: src comes back and nothing is drawn', () => {
  for (const key of REGISTRY.keys('filter')) {
    for (const t of [0.5, 1, 1.01, 1.2, 2.5]) {
      for (const impact of [false, true]) {
        const r = runFilter(key, { amount: 0 }, t, { cut: cutAt(t, impact) });
        assert.equal(r.out, r.src, key + ' at ' + t + (impact ? ' (impact)' : ''));
        assert.equal(r.fx.outstanding(), 0, key + ' took no surface');
      }
    }
  }
});

test('every filter shows at a typical amount (flash filters on an impact cut)', () => {
  for (const key of REGISTRY.keys('filter')) {
    const shows = [0.2, 0.7, 1.01, 1.05, 1.3, 1.9, 2.4].some((t) => {
      const r = runFilter(key, { amount: 0.7, when: key === 'flashPop' || key === 'invertBlink' ? 'impact' : 'always' }, t,
        { cut: cutAt(t, true) });
      return r.out !== r.src;
    });
    assert.ok(shows, key + ' draws something');
  }
});

test('tick-based looks hold still between ticks and change on them (grain, dust, slice glitch)', () => {
  const opsOf = (key, p, t) => JSON.stringify(runFilter(key, p, t).ops.map((op) => op.slice(1)));
  const same = (key, p, t0, t1) => opsOf(key, p, t0) === opsOf(key, p, t1);
  assert.ok(same('grainFilm', { amount: 0.6, rate: 12 }, 2 / 12 + 0.001, 2 / 12 + 0.07));
  assert.ok(!same('grainFilm', { amount: 0.6, rate: 12 }, 2 / 12 + 0.001, 3 / 12 + 0.001), 'a new grain pattern on the next tick');
  assert.ok(same('dustSpecks', { amount: 0.7, rate: 12, scratch: 1 }, 5 / 12 + 0.001, 5 / 12 + 0.08));
  for (let k = 0; k < 24; k++) assert.ok(same('sliceGlitch', { amount: 0.8, rate: 10 }, k / 10 + 0.001, k / 10 + 0.09), 'slice tick ' + k);
});

test('flashPop: follows the plan’s flash impulses on impact cuts; other cuts flash on their `when` event', () => {
  const white = (r) => r.ops.filter((op) => op[1] === 'set:globalAlpha').map((op) => op[2]).reduce((m, a) => Math.max(m, a), 0);
  const at = (t, impact, when, plan) => runFilter('flashPop', { amount: 0.7, decay: 0.18, when }, t, { cut: cutAt(t, impact), plan });
  assert.ok(white(at(1.01, true, 'impact')) > 0.6, 'the impulse flashes');
  const late = at(2.5, true, 'impact');
  assert.equal(late.out, late.src, 'gone after the impulse');
  const plain = at(1.01, false, 'always', fxPlan([]));
  assert.equal(plain.out, plain.src, 'no impact, no impulse: nothing with when = always');
  const own = at(1.01, true, 'impact', fxPlan([]));
  assert.ok(white(own) > 0.6, 'an impact cut without an impulse flashes on its own start');
  const arrive = at(1.01, false, 'arrive', fxPlan([]));
  assert.ok(white(arrive) > 0.6, 'when = arrive: flash at the sung start');
  const before = at(0.95, false, 'arrive', fxPlan([]));
  assert.equal(before.out, before.src, 'nothing before it');
  assert.equal(def('filter', 'flashPop').shared.when.auto.fn({ impact: true }), 'impact');
  assert.equal(def('filter', 'flashPop').shared.when.auto.fn({ impact: false }), 'arrive');
});

test('invertBlink: on for one tick, off for one, `blinks` times after the event', () => {
  const on = (age) => {
    const r = runFilter('invertBlink', { amount: 0.8, when: 'arrive', blinks: 2, rate: 12 }, 1 + age, { cut: cutAt(1 + age, false) });
    return r.out !== r.src;
  };
  assert.deepEqual([0.01, 0.1, 0.18, 0.26, 0.35, -0.05].map(on), [true, false, true, false, false, false]);
});

// --- flash safety (DESIGN §4.21: more than 3 flashes in any 1 s window is a pre-flight warning) --------------------

const PO = MV.use('engine/render/post');
const FLASH_PARTS = ['flashPop', 'invertBlink'];
const WHENS = ['always', 'arrive', 'beat', 'impact', 'depart'];

// A minimal FxContext that records only what makes a flash: the white wash of flashPop (a light source-over fill) and
// the inversion of invertBlink (a 'difference' fill). strength() → the strongest such fill of one call, 0 when src
// comes back. Much faster than the recorder, for sampling many seconds at 240 Hz.
function flashProbe(plan, flashScale) {
  let peak = 0;
  const ctx = {
    globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '#000000',
    drawImage() {},
    fillRect() {
      const op = this.globalCompositeOperation;
      if (op === 'difference' || (op === 'source-over' && this.fillStyle !== '#000000')) peak = Math.max(peak, this.globalAlpha);
    },
  };
  const surface = { canvas: {}, ctx, w: FX_W, h: FX_H };
  const fx = {
    w: FX_W, h: FX_H, unit: FX_W / 1920, quality: 'export', alpha: false, cut: null,
    take: () => { ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; return surface; },
    give() {},
    impulse: (kind, t) => F.impulseAt(plan, kind, t) * (kind === 'flash' && flashScale !== undefined ? flashScale : 1),
    beat: (t) => F.beatAt(plan, t), tick: F.tick, noise: () => 0.5, level: () => 0.5,
  };
  if (flashScale !== undefined) fx.flashScale = flashScale;
  const src = { canvas: {}, ctx: null, w: FX_W, h: FX_H };
  return {
    fx,
    strength(key, p, t) {
      peak = 0;
      const out = def('filter', key).apply(fx, src, p, t);
      return out === src ? 0 : peak;
    },
  };
}

// A plan with a beat grid (or none) and, for an impact cut, the flash impulse the planner puts at its start.
function flashPlan(bpm, impactAt) {
  return { cuts: [], seams: [], beats: bpm ? { bpm, offset: 0.07, meter: 4 } : null,
    impulses: impactAt === null ? [] : [{ t: impactAt, kind: 'flash', amp: 1, decay: 0.18 }] };
}

// The flash strength of one filter over a cut that starts at t0 = 1 and holds the screen effects for `dur` seconds,
// sampled at `hz`, with `amount` weighted by `when` the way the post stack does it (§4.19.2 step 5).
function flashSeries(key, p, o) {
  const t0 = 1, dur = o.dur || 4, hz = o.hz || 240;
  const plan = flashPlan(o.bpm, o.impact ? t0 : null);
  const probe = flashProbe(plan, o.flashScale);
  const times = { rest: 0.45, out: dur + (o.outShift === undefined ? -0.25 : o.outShift) };
  const info = { tl: 0, dur, impact: !!o.impact, energy: 0.6 };
  const q = Object.assign({}, autoParams('filter', key), p), weighted = Object.assign({}, q);
  const series = [];
  for (let k = 0; k < dur * hz; k++) {
    const t = t0 + k / hz;
    info.tl = t - t0;
    probe.fx.cut = info;
    const w = PO.whenWeight(q.when, info.tl, t, times, info, probe.fx.beat);
    weighted.amount = q.amount * w;
    series.push({ t, s: w > 0 ? probe.strength(key, weighted, t) : 0 });
  }
  return series;
}

// Flash onsets: the strength rises by ≥ 0.1 within 50 ms (a sharp change, not a slow swell); a rise counts again only
// after the strength has fallen by ≥ 0.1 from its peak (and it is measured from what came after that fall).
function flashOnsets(series, hz) {
  const out = [], look = Math.round(0.05 * (hz || 240));
  let armedAt = 0, peak = 0;
  for (let k = 0; k < series.length; k++) {
    const s = series[k].s;
    if (armedAt >= 0) {
      let lo = s;
      for (let j = Math.max(armedAt, k - look); j < k; j++) lo = Math.min(lo, series[j].s);
      if (s - lo >= 0.1) { out.push(series[k].t); armedAt = -1; peak = s; }
    } else {
      peak = Math.max(peak, s);
      if (peak - s >= 0.1) armedAt = k;
    }
  }
  return out;
}

function mostInOneSecond(onsets) {
  let most = 0;
  for (let i = 0, j = 0; i < onsets.length; i++) {
    while (j < onsets.length && onsets[j] - onsets[i] < 1 - 1e-9) j++;
    most = Math.max(most, j - i);
  }
  return most;
}

const gapsOf = (list) => list.slice(1).map((t, i) => t - list[i]);

test('flash parts never flash more than 3 times in any 1 s window (240 Hz, every `when`, tempo and param extreme)', () => {
  const variants = {
    flashPop: [{ decay: 0.05 }, { decay: 0.26 }, { decay: 0.8 }],
    invertBlink: [1, 2, 3].flatMap((blinks) => [6, 11, 24].map((rate) => ({ blinks, rate }))),
  };
  // Only 'beat' reads the grid, only 'always'/'impact' care whether the cut is an impact, only 'depart' where the exit
  // starts (the post stack's weight).
  const cases = [];
  for (const when of WHENS) {
    for (const bpm of when === 'beat' ? [null, 60, 90, 120, 150, 180, 200, 240] : [128]) {
      for (const impact of when === 'always' || when === 'impact' ? [false, true] : [false]) {
        for (const outShift of when === 'depart' ? [-0.8, -0.25, 0.25] : [-0.25]) cases.push({ when, bpm, impact, outShift });
      }
    }
  }
  let flashes = 0;
  for (const key of FLASH_PARTS) {
    for (const v of variants[key]) {
      for (const c of cases) {
        const onsets = flashOnsets(flashSeries(key, Object.assign({ amount: 1, when: c.when }, v), c));
        flashes += onsets.length;
        const most = mostInOneSecond(onsets);
        assert.ok(most <= 3, key + ' ' + JSON.stringify(v) + ' ' + JSON.stringify(c) + ': ' + most + ' flashes in 1 s at '
          + onsets.map((t) => t.toFixed(3)).join(' '));
      }
    }
  }
  assert.ok(flashes > 300, 'the sweep does see flashes (' + flashes + ')');
});

test('flash parts: beat events keep their distance, and there are none without a beat grid', () => {
  const pop = (bpm) => flashOnsets(flashSeries('flashPop', { amount: 1, when: 'beat', decay: 0.8 }, { bpm, dur: 4 }));
  assert.equal(pop(120).length, 8, 'every beat at 120 BPM (0.5 s apart): 8 in 4 s');
  assert.equal(pop(180).length, 12, 'every beat at 180 BPM (1/3 s apart)');
  const fast = pop(240);
  assert.equal(fast.length, 8, 'every other beat at 240 BPM: ' + fast.map((t) => t.toFixed(3)));
  for (const bpm of [150, 200, 240]) assert.ok(gapsOf(pop(bpm)).every((g) => g > 1 / 3 - 1e-3), bpm + ' BPM: at least 1/3 s apart');
  assert.deepEqual(pop(null), [], 'no grid, no beat flashes (the pre-flight counts none either)');
  const blink = (bpm) => flashOnsets(flashSeries('invertBlink', { amount: 1, when: 'beat', blinks: 3, rate: 12 }, { bpm, dur: 4 }));
  const at120 = blink(120);
  assert.ok(at120.length >= 4, 'blinks at 120 BPM: ' + at120.map((t) => t.toFixed(3)));
  assert.ok(gapsOf(at120).every((g) => g >= 1 / 6 - 1e-3), 'blinks are two ticks apart at least');
  assert.deepEqual(blink(null), []);
});

test('flash parts: a depart event is over by the sung end, where the next cut takes the screen effects over', () => {
  for (const decay of [0.05, 0.2, 0.5]) {
    const s = flashSeries('flashPop', { amount: 1, when: 'depart', decay }, { dur: 3, outShift: -1.2 });
    const onsets = flashOnsets(s);
    assert.equal(onsets.length, 1, 'one depart flash (decay ' + decay + ')');
    assert.ok(Math.abs(onsets[0] - (1 + 3 - 2 * decay)) < 0.01, 'it fires 2 × decay before the end: ' + onsets[0]);
    assert.ok(s[s.length - 1].s < 0.15 * Math.max(...s.map((x) => x.s)), 'and has faded by the end');
  }
  for (const [blinks, rate] of [[1, 6], [3, 6], [3, 24], [2, 11]]) {
    const s = flashSeries('invertBlink', { amount: 1, when: 'depart', blinks, rate }, { dur: 3, outShift: -0.9 });
    const on = s.filter((x) => x.s > 0).map((x) => x.t);
    assert.equal(flashOnsets(s).length, blinks, blinks + ' blinks at ' + rate + ' Hz');
    assert.ok(on[on.length - 1] < 1 + 3 - 1 / rate + 1e-6, 'the last blink ends before the sung end');
  }
});

test('flash parts follow amount.flash from 0, so the pre-flight fix (amount.flash 0.3) tones them down', () => {
  const SCH = MV.use('core/schema'), RNG = MV.use('core/rng');
  for (const key of FLASH_PARTS) {
    const spec = REGISTRY.params('filter', key).find((x) => x.name === 'amount').spec;
    for (const flash of [0, 0.15, 0.3, 0.7, 1]) {
      const look = { amounts: { flash }, mood: null, bpm: null };
      for (let r = 0; r < 20; r++) {
        const v = SCH.autoValue(spec, { f: { impact: true, energy: 0.5 }, look, rng: RNG.stream(r, 'param', 'amount') });
        assert.ok(Math.abs(v - flash) < 1e-9, key + ' amount auto at amount.flash ' + flash + ': ' + v);
      }
    }
  }
  // At the safe amount invertBlink does not blink at all, and flashPop's wash stays faint.
  for (const when of WHENS) {
    const blink = flashSeries('invertBlink', { amount: 0.3, when, blinks: 3, rate: 12 }, { bpm: 120, impact: true });
    assert.ok(blink.every((x) => x.s === 0), 'invertBlink at 0.3, when ' + when);
    const pop = flashSeries('flashPop', { amount: 0.3, when, decay: 0.2 }, { bpm: 120, impact: true });
    assert.ok(Math.max(...pop.map((x) => x.s)) < 0.15, 'flashPop at 0.3, when ' + when);
  }
});

// The pre-flight counts what renders (export/schedule FLASH_FILTERS, NOTES ## INT-LEAD): a beat flashPop fires on every
// other beat at 200 BPM (≤ 3 per second), while invertBlink on every line start of project_basic adds up across
// neighbouring cuts, which only the pre-flight can see; its fix takes the pinned part out of the count.
test('the pre-flight fix (work:amount.flash 0.3) takes a pinned flash effect out of the flash count (§4.21)', () => {
  const P = MV.use('planner/plan'), S = MV.use('export/schedule');
  const reg = MV.use('parts/catalog').defaultRegistry();
  const rateWith = (key, when, flash) => {
    const { doc } = corpus.project('basic');
    doc.song.bpm = 200;
    doc.pins['work:filter#0'] = { v: key, by: 'user' };
    doc.pins['work:filter#0.when'] = { v: when, by: 'user' };
    doc.pins['work:amount.flash'] = { v: flash, by: 'user' };
    doc.filters = Object.assign({}, doc.filters, { seam: { only: ['hardCut'], deny: null } });
    return S.flashRate(P.plan(doc, { registry: reg })).count;
  };
  const beatPop = rateWith('flashPop', 'beat', 0.8);
  assert.ok(beatPop > 0 && beatPop <= 3, 'a beat flashPop keeps within 3 per second by itself: ' + beatPop);
  assert.ok(rateWith('invertBlink', 'arrive', 0.8) > 3, 'blinks of neighbouring line starts are counted together');
  assert.equal(rateWith('invertBlink', 'arrive', 0.3), 0, 'after the fix nothing is counted');
  assert.equal(rateWith('flashPop', 'beat', 0.3), 0);
});

test('flash parts dim with the preview’s reduce-flash scale when the FxContext carries one', () => {
  const peak = (key, p, flashScale) => Math.max(...flashSeries(key, Object.assign({ amount: 0.7, when: 'arrive' }, p), { dur: 1, flashScale })
    .map((x) => x.s));
  assert.ok(peak('invertBlink', { blinks: 2, rate: 12 }) > 0.9, 'a full inversion');
  assert.equal(peak('invertBlink', { blinks: 2, rate: 12 }, 0.3), 0, 'none when dimmed');
  assert.ok(peak('flashPop', { decay: 0.2 }, 0.3) < 0.2 * peak('flashPop', { decay: 0.2 }), 'a much fainter flash');
});

// The destination rectangles of every drawImage from `from` into each canvas: Map canvasId → [{ x, y, w, h, scaled }].
function drawsFrom(ops, from) {
  const out = new Map();
  for (const op of ops) {
    if (op[1] !== 'drawImage' || op[2] !== from) continue;
    const a = op.slice(3);
    const d = a.length === 2 ? { x: a[0], y: a[1], w: FX_W, h: FX_H, scaled: false }
      : a.length === 4 ? { x: a[0], y: a[1], w: a[2], h: a[3], scaled: a[2] !== FX_W || a[3] !== FX_H }
        : { x: a[4], y: a[5], w: a[6], h: a[7], scaled: a[2] !== a[6] || a[3] !== a[7] };
    if (!out.has(op[0])) out.set(op[0], []);
    out.get(op[0]).push(d);
  }
  return out;
}

test('chromaSlip: each channel copy keeps the frame’s scale (no zoom) and its uncovered edges are filled', () => {
  for (const angle of [0, 30, 90, 180, -135]) {
    const r = runFilter('chromaSlip', { amount: 0.8, spread: 30, angle, kick: 0 }, 0.5);
    const copies = drawsFrom(r.ops, r.src.canvas.id);
    assert.equal(copies.size, 2, 'two channel copies (angle ' + angle + ')');
    const offsets = [];
    for (const rects of copies.values()) {
      const main = rects[0];
      assert.ok(!main.scaled && Number.isInteger(main.x) && Number.isInteger(main.y), 'a 1:1 copy at a whole-pixel offset');
      offsets.push([main.x, main.y]);
      assert.ok(rects.slice(1).every((d) => d.w * d.h < 0.2 * FX_W * FX_H), 'the other draws are edge strips only');
      for (let y = 0.5; y < FX_H; y += 3) {
        for (let x = 0.5; x < FX_W; x += 3) {
          assert.ok(rects.some((d) => x >= d.x && x < d.x + d.w && y >= d.y && y < d.y + d.h), 'covered at ' + x + ',' + y);
        }
      }
    }
    assert.deepEqual(offsets[0].map((v) => -v || 0), offsets[1].map((v) => v || 0), 'the channels move apart symmetrically');
  }
});

// A uniform-frame model of what an effect does to one colour (QA-FX): every surface holds one RGB value (or nothing),
// and each recorded drawImage / fillRect / clearRect is taken as full-frame and applied with the W3C compositing
// formulas, rounded to 8 bits after each step as a canvas stores it. Enough for effects that treat all pixels alike.
const BLENDS = {
  'source-over': (b, s) => s,
  'source-atop': (b, s) => s,
  multiply: (b, s) => b * s,
  screen: (b, s) => b + s - b * s,
  difference: (b, s) => Math.abs(b - s),
  lighter: (b, s) => Math.min(1, b + s),
  'color-burn': (b, s) => (b >= 1 ? 1 : s <= 0 ? 0 : 1 - Math.min(1, (1 - b) / s)),
  'color-dodge': (b, s) => (b <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, b / (1 - s))),
};
const rgbOfHex = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function uniformRun(ops, inputs) {
  const px = new Map(Object.entries(inputs).map(([id, c]) => [id, c.map((v) => v / 255)]));
  const states = new Map();
  const state = (id) => {
    if (!states.has(id)) states.set(id, { op: 'source-over', alpha: 1, fill: '#000000' });
    return states.get(id);
  };
  const lum = (c) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  function paint(id, src) {
    const s = state(id), dst = px.get(id);
    if (!src) return;
    if (!dst) {
      assert.ok(s.alpha === 1 && s.op === 'source-over', 'the model covers opaque draws onto an empty surface only');
      px.set(id, src.slice());
      return;
    }
    let blended;
    if (s.op === 'color') {
      assert.ok(src[0] === src[1] && src[1] === src[2], "the model covers 'color' with a grey source only");
      blended = [0, 1, 2].map(() => lum(dst));
    } else {
      assert.ok(BLENDS[s.op], 'blend ' + s.op);
      blended = dst.map((b, i) => BLENDS[s.op](b, src[i]));
    }
    px.set(id, dst.map((b, i) => Math.round(255 * ((1 - s.alpha) * b + s.alpha * blended[i])) / 255));
  }
  for (const op of ops) {
    const id = op[0], s = state(id);
    if (op[1] === 'set:globalCompositeOperation') s.op = op[2];
    else if (op[1] === 'set:globalAlpha') s.alpha = op[2];
    else if (op[1] === 'set:fillStyle') s.fill = op[2];
    else if (op[1] === 'clearRect') px.delete(id);
    else if (op[1] === 'fillRect') paint(id, rgbOfHex(s.fill).map((v) => v / 255));
    else if (op[1] === 'drawImage') paint(id, px.get(op[2]));
  }
  return (id) => (px.get(id) || [0, 0, 0]).map((v) => Math.round(v * 255));
}

test('duoTone prints the ground in its own colour and the words in the full other ink (QA-FX)', () => {
  const night = { ground: '#101820', ground2: '#18202A', ink: '#F0F0F0', accent: '#F0C040', shiftA: '#40A0C0',
    shiftB: '#C04080', muted: '#708090' };
  const paper = { ground: '#EFE9DC', ground2: '#E2D9C6', ink: '#1C1A17', accent: '#B8322A', shiftA: '#3E6E8C',
    shiftB: '#C9A15B', muted: '#8C8577' };
  const cases = [
    // [palette, shadow ink, input colour, expected colour]
    [night, 'accent', night.ground, night.ground], [night, 'accent', night.ink, night.accent],
    [night, 'accent', night.accent, night.accent],
    [paper, 'accent', paper.ground, paper.ground], [paper, 'accent', paper.ink, paper.accent],
    [paper, 'accent', paper.accent, paper.accent],
    [paper, 'ink', paper.ground, paper.ground], [paper, 'ink', paper.ink, paper.ink],
  ];
  for (const [pal, shadow, input, want] of cases) {
    const r = runFilter('duoTone', { amount: 1, shadow, light: 'ground' }, 0.5, { pal });
    const got = uniformRun(r.ops, { [r.src.canvas.id]: rgbOfHex(input) })(r.out.canvas.id);
    const off = Math.max(...got.map((v, i) => Math.abs(v - rgbOfHex(want)[i])));
    assert.ok(off <= 4, shadow + ' on ' + pal.ground + ': ' + input + ' → ' + got.join(',') + ', want ' + want);
  }
  // Mixed by amount: at a typical amount the ground still keeps its colour.
  const r = runFilter('duoTone', { amount: 0.55, shadow: 'accent', light: 'ground' }, 0.5, { pal: night });
  const got = uniformRun(r.ops, { [r.src.canvas.id]: rgbOfHex(night.ground) })(r.out.canvas.id);
  assert.ok(Math.max(...got.map((v, i) => Math.abs(v - rgbOfHex(night.ground)[i]))) <= 3, 'ground at amount 0.55: ' + got);
});

test('edgeShade fades to nothing with amount instead of switching on at a fixed darkness', () => {
  // The vignette is a kept layer painted at full strength and laid over the frame at alpha `dark`: the darkest corner is
  // the largest stop alpha times the alpha the layer is drawn with.
  const darkest = (amount) => {
    const r = runFilter('edgeShade', { amount, size: 0.45 }, 0.5);
    if (r.out === r.src) return 0;
    const stops = r.ops.filter((op) => /\.addColorStop$/.test(op[1])).map((op) => Number(/,\s*([\d.]+)\)$/.exec(op[3])[1]));
    let alpha = 1, drawn = 0;
    for (const op of r.ops) {
      if (op[0] !== r.out.canvas.id) continue;
      if (op[1] === 'set:globalAlpha') alpha = op[2];
      else if (op[1] === 'drawImage' && String(op[2]).startsWith('layer:edgeShade:')) drawn = Math.max(drawn, alpha);
    }
    return Math.max(...stops) * drawn;
  };
  const levels = [0.001, 0.011, 0.03, 0.06, 0.1, 0.3, 0.7].map(darkest);
  assert.ok(levels[0] < 0.01 && levels[1] < 0.02, 'nearly nothing just above 0: ' + levels.join(' '));
  for (let k = 1; k < levels.length; k++) assert.ok(levels[k] >= levels[k - 1], 'darker with more amount: ' + levels.join(' '));
  assert.ok(levels[6] > 0.35, 'a real vignette at a typical amount');
});

test('edgeShade paints its vignette once per size and frame size, then only lays it down (fx.layer)', () => {
  const rec = R.createRecorder();
  const src = R.surfaceOf(rec.factory, FX_W, FX_H, true);
  const fx = R.createRecordingFx(rec, { w: FX_W, h: FX_H, unit: FX_W / 1920, plan: fxPlan(), cut: cutAt(0.5, false), seed: 1 });
  const d = def('filter', 'edgeShade');
  const frame = (p) => {
    fx.begin();
    const m = rec.mark();
    const out = d.apply(fx, src, Object.assign(autoParams('filter', 'edgeShade'), { amount: 0.7 }, p), 0.5);
    fx.give(out);
    return rec.ops().slice(m);
  };
  const painted = (ops) => ops.filter((op) => op[1] === 'createRadialGradient').length;
  const layerOf = (ops) => ops.filter((op) => op[1] === 'drawImage').map((op) => String(op[2])).find((id) => id.startsWith('layer:'));
  const first = frame({ size: 0.45 }), again = frame({ size: 0.45 }), other = frame({ size: 0.5 });
  assert.equal(painted(first), 1, 'the first frame paints the vignette');
  assert.equal(painted(again), 0, 'the next frame only lays it down');
  assert.equal(layerOf(again), layerOf(first));
  assert.equal(painted(other), 1, 'another clear area is another picture');
  assert.notEqual(layerOf(other), layerOf(first));
});

test('fx.layer (engine/render/post): kept per key and frame size, least recently used dropped, too large → a frame surface', () => {
  const SF = MV.use('engine/render/surface');
  const rec = R.createRecorder();
  const pool = SF.createPool(rec.factory), tiles = PO.createTileBank(rec.factory), ctl = PO.createFx({ pool, tiles });
  let paints = 0;
  const paint = (g, w, h) => { paints++; g.fillStyle = '#123456'; g.fillRect(0, 0, w, h / 2); };
  const frameAt = (w, h) => { pool.frame(w, h); pool.begin(); ctl.frame({ plan: null, w, h, unit: w / 1920, quality: 'export', alpha: false }); };
  frameAt(320, 180);
  const a = ctl.fx.layer('k', paint);
  assert.equal(ctl.fx.layer('k', paint), a, 'the same key and size: the kept layer');
  assert.equal(paints, 1);
  assert.equal(a.width, 320);
  frameAt(160, 90);                                  // the adaptive preview's half size: a layer of its own
  const half = ctl.fx.layer('k', paint);
  assert.notEqual(half, a);
  assert.equal(half.width, 160);
  assert.equal(paints, 2);
  for (const k of ['x1', 'x2', 'x3', 'x4']) ctl.fx.layer(k, paint);
  const before = paints;
  frameAt(320, 180);
  ctl.fx.layer('k', paint);
  assert.equal(paints, before + 1, 'four newer layers dropped the oldest');
  tiles.clear();
  ctl.fx.layer('k', paint);
  assert.equal(paints, before + 2, 'clear() forgets the layers');
  frameAt(4200, 4200);                               // 70 MB: above the budget
  const big = ctl.fx.layer('k', paint), big2 = ctl.fx.layer('k', paint);
  assert.equal(paints, before + 4, 'painted on every call');
  assert.notEqual(big, big2);
  assert.equal(pool.stats().out, 2, 'into frame surfaces, which the frame\'s pool.end() takes back');
  pool.end();
  assert.equal(pool.stats().out, 0);
});

// A cut-local `amount` weighting like the post stack's 'beat' one: exp(−since/0.15) (120 BPM, beat 0 at 0 s).
function beatWeighted(t) { return Math.exp(-(((t % 0.5) + 0.5) % 0.5) / 0.15); }

function isSubsequence(part, whole) {
  let i = 0;
  for (const x of whole) if (i < part.length && part[i] === x) i++;
  return i === part.length;
}

test('tick-based looks keep their layout inside a tick while `when` changes amount frame by frame', () => {
  // Every tick here starts with its largest amount (beats fall on tick starts), so its first frame shows the most.
  // dustSpecks: the specks of any later frame are the first ones of that frame's list (fewer show, none move).
  const specks = (t) => runFilter('dustSpecks', { amount: 0.9 * beatWeighted(t), rate: 8, scratch: 0 }, t).ops
    .filter((op) => op[1] === 'arc' || op[1] === 'moveTo').map((op) => op.slice(2, 4).join(','));
  // sliceGlitch: the bands (their rows) of any later frame are among the first frame's, in the same order (a band
  // whose jump has shrunk below half a pixel is not drawn).
  const bands = (t) => runFilter('sliceGlitch', { amount: 0.95 * beatWeighted(t), rate: 8, bands: 8, tint: 0 }, t).ops
    .filter((op) => op[1] === 'clearRect').map((op) => op.slice(3, 6).join(','));
  for (const [name, layout, prefix] of [['dustSpecks', specks, true], ['sliceGlitch', bands, false]]) {
    let changed = 0;
    for (let k = 0; k < 16; k++) {
      const frames = [];
      for (let f = 0; f < 7; f++) frames.push(layout(k / 8 + 0.001 + f / 60));
      for (const l of frames) {
        const ok = prefix ? JSON.stringify(l) === JSON.stringify(frames[0].slice(0, l.length)) : isSubsequence(l, frames[0]);
        assert.ok(ok, name + ' tick ' + k + ': ' + JSON.stringify(frames));
      }
      if (new Set(frames.map((l) => l.length)).size > 1) changed++;
    }
    assert.ok(changed > 0, name + ': amount did change what shows inside some tick');
  }
});

// What a frame shows per speck / band, for the continuity test below: dustSpecks → the alpha of each speck (by
// position); sliceGlitch → how far each band is shifted (px, by row).
function speckLook(amount, t) {
  const out = new Map();
  let alpha = 1;
  for (const op of runFilter('dustSpecks', { amount, rate: 8, scratch: 0, specks: 40 }, t).ops) {
    if (op[1] === 'set:globalAlpha') alpha = op[2];
    if (op[1] === 'arc' || op[1] === 'moveTo') out.set(op[2] + ',' + op[3], alpha);
  }
  return out;
}

function bandLook(amount, t) {
  const out = new Map();
  let row = null;
  for (const op of runFilter('sliceGlitch', { amount, rate: 8, bands: 10, shift: 300, tint: 0 }, t).ops) {
    if (op[1] === 'clearRect') row = op[3] + ',' + op[5];
    else if (op[1] === 'drawImage' && row && !out.has(row)) out.set(row, Math.min(op[3], FX_W - op[3]));
  }
  return out;
}

for (const [name, look, limit] of [['dustSpecks', speckLook, 0.04], ['sliceGlitch', bandLook, 2.5]]) {
  test(name + ' follows amount continuously: nothing pops in or out as amount moves (the `when` weighting moves it)', () => {
    const jump = (m0, m1) => {
      let most = 0;
      for (const k of new Set([...m0.keys(), ...m1.keys()])) most = Math.max(most, Math.abs((m0.get(k) || 0) - (m1.get(k) || 0)));
      return most;
    };
    let seen = 0;
    for (const t of [0.3, 0.71, 1.02, 1.4, 2.26]) {
      let prev = look(0, t);
      for (let a = 0.001; a <= 1; a += 0.001) {
        const cur = look(a, t);
        assert.ok(jump(prev, cur) <= limit, name + ' at t ' + t + ', amount ' + a.toFixed(3) + ': a jump of ' + jump(prev, cur));
        seen = Math.max(seen, cur.size);
        prev = cur;
      }
    }
    assert.ok(seen > 2, name + ' shows something');
  });
}

test('alpha-safe filters never paint over empty areas of a transparent frame', () => {
  for (const key of REGISTRY.keys('filter').filter((k) => def('filter', k).alphaSafe)) {
    for (let t = 0; t < 3; t += 0.05) {
      const r = runFilter(key, { amount: 1, tint: 1 }, t, { alpha: true });
      const bad = r.ops.filter((op) => op[1] === 'fillRect' || op[1] === 'fill' || op[1] === 'stroke');
      assert.deepEqual(bad, [], key + ' at ' + t.toFixed(2));
    }
  }
  assert.deepEqual(REGISTRY.keys('filter').filter((k) => def('filter', k).alphaSafe), ['afterImage', 'sliceGlitch']);
});

// --- transitions ---------------------------------------------------------------------------------------------------

// o = { alpha: a transparent frame, pal: the frame palette (fx.pal) }
function runSeam(key, u, p, o) {
  const opt = o || {};
  const rec = R.createRecorder();
  const a = R.surfaceOf(rec.factory, FX_W, FX_H, true), b = R.surfaceOf(rec.factory, FX_W, FX_H, true);
  const fx = R.createRecordingFx(rec, { w: FX_W, h: FX_H, unit: FX_W / 1920, plan: fxPlan(), seed: H.hash32('seam', key),
    alpha: !!opt.alpha });
  if (opt.pal) fx.pal = opt.pal;
  const mark = rec.mark();
  const out = def('seam', key).mix(fx, a, b, u, Object.assign(autoParams('seam', key), p));
  return { out, a, b, ops: rec.ops().slice(mark) };
}

// Which of the two inputs the result's canvas draws from, in order.
function sources(r) { return r.ops.filter((op) => op[0] === r.out.canvas.id && op[1] === 'drawImage').map((op) => op[2]); }

test('hardCut is no transition: both cuts drawn as they are', () => {
  for (const u of [0, 0.5, 1]) {
    const r = runSeam('hardCut', u);
    assert.deepEqual(sources(r), [r.a.canvas.id, r.b.canvas.id]);
  }
});

test('the whole-frame transitions start on the old frame and end on the new one', () => {
  for (const key of REGISTRY.keys('seam').filter((k) => def('seam', k).scope === 'world')) {
    const first = runSeam(key, 0), last = runSeam(key, 1);
    const firstSrc = sources(first), lastSrc = sources(last);
    assert.ok(firstSrc.includes(first.a.canvas.id), key + ' u = 0 draws a');
    assert.ok(lastSrc.includes(last.b.canvas.id), key + ' u = 1 draws b');
    if (key !== 'blindSlats') assert.ok(!firstSrc.includes(first.b.canvas.id), key + ' u = 0 shows no b');
    assert.ok(!lastSrc.includes(last.a.canvas.id), key + ' u = 1 shows no a');
  }
});

test('glitchSwap starts exactly on a and ends exactly on b: no strip is shifted or tinted at the window edges', () => {
  // How far a strip draw is shifted sideways (px), from its source x (the strip wraps around the frame edge).
  const shiftOf = (op) => Math.min(op[3], FX_W - op[3]);
  for (const p of [{ shift: 60, strips: 10, rate: 14 }, { shift: 140, strips: 18, rate: 24 }, { shift: 300, strips: 40, rate: 40 }]) {
    for (const u of [0, 1]) {
      const r = runSeam('glitchSwap', u, p);
      const draws = r.ops.filter((op) => op[0] === r.out.canvas.id && op[1] === 'drawImage');
      const side = u === 0 ? r.a.canvas.id : r.b.canvas.id;
      assert.ok(draws.every((op) => op[2] === side && shiftOf(op) === 0), 'u = ' + u + ': every strip unshifted, from one side');
      assert.ok(!r.ops.some((op) => op[0] === r.out.canvas.id && op[1] === 'fillRect'), 'u = ' + u + ': no tint');
    }
    for (const u of [0.01, 0.03, 0.97, 0.99]) {
      const r = runSeam('glitchSwap', u, p);
      const most = Math.max(...r.ops.filter((op) => op[0] === r.out.canvas.id && op[1] === 'drawImage').map(shiftOf));
      assert.ok(most <= 2, 'u = ' + u + ': strips barely move near the edges (' + most + ' px)');
    }
  }
});

// --- QA-FX: visual tuning of cameras, screen effects and transitions (NOTES "## QA-FX") ---------------------------

// Frame palettes after the backdrop rule (fx.pal): a dark and a light theme, the green-screen key and black.
const NIGHT_PAL = { ground: '#0F1420', ground2: '#1A2233', ink: '#F2EEE6', accent: '#FFB23E', shiftA: '#37C6D0',
  shiftB: '#E4507A', muted: '#6E7891' };
const PAPER_PAL = { ground: '#EFE9DC', ground2: '#E2D9C6', ink: '#1C1A17', accent: '#B8322A', shiftA: '#3E6E8C',
  shiftB: '#C9A15B', muted: '#8C8577' };
const KEY_PAL = Object.assign({}, NIGHT_PAL, { ground: '#00B140' });
const BLACK_PAL = Object.assign({}, NIGHT_PAL, { ground: '#000000', ink: '#FFFFFF', accent: '#FFFFFF', shiftA: '#9A9A9A',
  shiftB: '#6E6E6E' });

// The fills of one canvas under a blend mode, with the alpha and fill style they were drawn with: [{ y, h, alpha, fill }].
function fillsUnder(ops, canvasId, mode) {
  const out = [];
  let op = 'source-over', alpha = 1, fill = '#000000';
  for (const o of ops) {
    if (o[0] !== canvasId) continue;
    if (o[1] === 'set:globalCompositeOperation') op = o[2];
    else if (o[1] === 'set:globalAlpha') alpha = o[2];
    else if (o[1] === 'set:fillStyle') fill = o[2];
    else if (o[1] === 'fillRect' && op === mode) out.push({ x: o[2], y: o[3], w: o[4], h: o[5], alpha, fill });
  }
  return out;
}

test('sliceGlitch tears through the middle of the frame with whole jumps; thin, light tints, none on plain frames', () => {
  const centres = [], jumps = [], tints = [];
  for (let t = 0; t < 30; t += 0.1) {
    const r = runFilter('sliceGlitch', { amount: 0.7, bands: 8, shift: 100, rate: 10, tint: 1 }, t + 0.001);
    let band = null;
    for (const op of r.ops) {
      if (op[0] !== r.out.canvas.id) continue;
      if (op[1] === 'clearRect') band = op;
      else if (op[1] === 'drawImage' && band && op[2] === r.src.canvas.id && op.length > 5) {
        centres.push((band[3] + band[5] / 2) / FX_H);
        jumps.push(Math.min(op[3], FX_W - op[3]) / (100 * FX_W / 1920));
        band = null;
      }
    }
    tints.push(...fillsUnder(r.ops, r.out.canvas.id, 'difference'));
  }
  jumps.sort((a, b) => a - b);
  const middle = centres.filter((c) => c > 0.25 && c < 0.75).length / centres.length;
  assert.ok(centres.length > 300, 'bands drawn: ' + centres.length);
  assert.ok(middle >= 0.65, 'bands favour the middle of the frame, where the words mostly are: ' + middle.toFixed(3));
  assert.ok(jumps[jumps.length >> 1] >= 0.45, 'a median jump of at least 0.45 × shift: ' + jumps[jumps.length >> 1].toFixed(3));
  assert.ok(tints.length > 20, 'tints still happen: ' + tints.length);
  for (const f of tints) {
    assert.ok(f.h <= 0.035 * FX_H + 1, 'a tint only on a thin band: ' + f.h + ' px');
    assert.ok(f.alpha <= 0.5, 'a light colour cast, not a flat block: alpha ' + f.alpha);
  }
  for (const pal of [KEY_PAL, BLACK_PAL]) {
    for (let t = 0; t < 12; t += 0.1) {
      const r = runFilter('sliceGlitch', { amount: 0.9, bands: 8, shift: 100, rate: 10, tint: 1 }, t + 0.001, { pal });
      assert.deepEqual(fillsUnder(r.ops, r.out.canvas.id, 'difference'), [], 'no tint on ' + pal.ground + ' at ' + t.toFixed(1));
    }
  }
});

test('invertBlink: a blink is a full inversion or none, also while the `when` weighting lowers amount', () => {
  for (const when of ['impact', 'arrive', 'beat', 'depart']) {
    for (const amount of [0.32, 0.35, 0.5, 0.6, 0.8, 1]) {
      const series = flashSeries('invertBlink', { amount, when, blinks: 3, rate: 12 },
        { bpm: 120, impact: when === 'impact', dur: 3 });
      const partial = series.filter((x) => x.s > 0 && x.s < 1);
      assert.deepEqual(partial.slice(0, 3), [], when + ' at ' + amount + ': no half inversion (a flat grey frame)');
      if (amount >= 0.5 && when !== 'beat') assert.ok(series.some((x) => x.s === 1), when + ' at ' + amount + ': it still blinks');
    }
  }
});

test('paperTooth: fibres fade on dark grounds and are left out on the black backdrop', () => {
  const fibreAlpha = (pal) => {
    const r = runFilter('paperTooth', { amount: 0.8, tooth: 0.5, fibre: 0.5 }, 0.5, pal ? { pal } : {});
    let alpha = 1, seen = 0;
    for (const op of r.ops) {
      if (op[1] === 'set:globalAlpha') alpha = op[2];
      if (op[1] === 'drawImage' && String(op[2]).startsWith('tile:fiber')) seen = Math.max(seen, alpha);
    }
    return seen;
  };
  const light = fibreAlpha(PAPER_PAL), dark = fibreAlpha(NIGHT_PAL), none = fibreAlpha(null);
  assert.ok(light > 0.3 && Math.abs(none - 0.4) < 1e-9, 'light paper and no palette keep their fibres: ' + light + ' ' + none);
  assert.ok(dark < light / 2.2 && dark > 0, 'dark grounds get faint fibres: ' + dark + ' vs ' + light);
  assert.equal(fibreAlpha(BLACK_PAL), 0, 'no fibres over the black backdrop');
});

test('blendDissolve: the old words melt away before the new ones firm up (never two sharp lines at half strength)', () => {
  const alphas = (u) => {
    const r = runSeam('blendDissolve', u, { soften: 10 });
    const out = { a: 0, b: 0, blur: 0 };
    let alpha = 1;
    const blurred = new Set();
    for (const op of r.ops) {
      if (op[1] === 'set:filter' && op[2] !== 'none') out.blur = Math.max(out.blur, Number(/blur\(([\d.]+)px\)/.exec(op[2])[1]));
      if (op[1] === 'drawImage' && op[2] === r.a.canvas.id && op[0] !== r.out.canvas.id) blurred.add(op[0]);
      if (op[0] !== r.out.canvas.id) continue;
      if (op[1] === 'set:globalAlpha') alpha = op[2];
      if (op[1] === 'drawImage' && (op[2] === r.a.canvas.id || blurred.has(op[2]))) out.a = alpha;
      if (op[1] === 'drawImage' && op[2] === r.b.canvas.id) out.b = alpha;
    }
    return out;
  };
  const start = alphas(0), early = alphas(0.15), mid = alphas(0.5), late = alphas(0.85), end = alphas(1);
  assert.deepEqual([start.a, start.b], [1, 0], 'u = 0: the old words only');
  assert.equal(early.b, 0, 'the new words wait for the old ones to soften');
  assert.ok(mid.a <= 0.25 && mid.b >= 0.4, 'mid-window: a fading smudge under the new words (' + mid.a + ', ' + mid.b + ')');
  assert.ok(mid.blur >= 10 * FX_W / 1920, 'the old words are soft by then: ' + mid.blur + ' px');
  assert.deepEqual([late.a, end.a, end.b], [0, 0, 1], 'the old words are gone before the end; u = 1 is the new words');
});

test('glitchSwap: tints are thin light slivers, and none on transparent, green-screen or black frames', () => {
  const p = { strips: 12, shift: 100, rate: 20, dur: 0.4 };
  let seen = 0;
  for (let u = 0.1; u < 0.9; u += 0.01) {
    const r = runSeam('glitchSwap', u, p);
    // the strips: drawImage(side, sx, y, sw, sh, …) → sh
    const strip = Math.max(...r.ops.filter((op) => op[0] === r.out.canvas.id && op[1] === 'drawImage').map((op) => op[6]));
    for (const f of fillsUnder(r.ops, r.out.canvas.id, 'difference')) {
      seen++;
      assert.ok(f.h <= Math.ceil(0.3 * strip) + 1,
        'a sliver, not a whole strip: ' + f.h + ' of ' + strip + ' px at u ' + u.toFixed(2));
      assert.ok(f.alpha <= 0.45, 'light: alpha ' + f.alpha);
    }
    for (const o of [{ alpha: true }, { pal: KEY_PAL }, { pal: BLACK_PAL }]) {
      const q = runSeam('glitchSwap', u, p, o);
      assert.deepEqual(fillsUnder(q.ops, q.out.canvas.id, 'difference'), [],
        'no tint on ' + JSON.stringify(o) + ' at u ' + u.toFixed(2));
    }
  }
  assert.ok(seen > 5, 'tints still happen on scene frames: ' + seen);
});

test('shoveAcross: the shadow falls from the new frame’s leading edge onto the old one, inside the frame', () => {
  const e = MV.use('parts/kit').ease('cubicInOut')(0.5);
  for (const dir of ['left', 'right', 'up', 'down']) {
    const r = runSeam('shoveAcross', 0.5, { dir });
    const shade = fillsUnder(r.ops, r.out.canvas.id, 'source-atop');
    assert.equal(shade.length, 1, dir + ': one shadow, drawn only over what is there');
    const s = shade[0], horizontal = dir === 'left' || dir === 'right';
    const W = FX_W, Hh = FX_H, span = horizontal ? W : Hh, edge = Math.round(span * (dir === 'left' || dir === 'up' ? 1 - e : e));
    const lo = horizontal ? s.x : s.y, len = horizontal ? s.w : s.h;
    assert.ok(lo >= -1 && lo + len <= span + 1, dir + ': inside the frame (' + lo + ' + ' + len + ')');
    const touches = dir === 'left' || dir === 'up' ? Math.abs(lo + len - edge) <= 1 : Math.abs(lo - edge) <= 1;
    assert.ok(touches, dir + ': against the new frame’s leading edge at ' + edge + ' (' + lo + ' + ' + len + ')');
    const keyed = runSeam('shoveAcross', 0.5, { dir }, { pal: KEY_PAL });
    assert.deepEqual(fillsUnder(keyed.ops, keyed.out.canvas.id, 'source-atop'), [], dir + ': no shadow on the green-screen key');
  }
});

test('world transitions on a transparent frame show only what they show on an opaque one', () => {
  // irisGate: inside the opening the old frame is cleared before the new one is drawn.
  const iris = (o) => {
    const r = runSeam('irisGate', 0.5, { ring: 0, cx: 0.5, cy: 0.5 }, o);
    const own = r.ops.filter((op) => op[0] === r.out.canvas.id)
      .map((op) => (op[1] === 'drawImage' ? 'draw:' + (op[2] === r.a.canvas.id ? 'a' : 'b') : op[1]));
    return own.slice(own.indexOf('clip'));
  };
  assert.deepEqual(iris({ alpha: true }).slice(0, 3), ['clip', 'clearRect', 'draw:b'], 'transparent: cleared inside the opening');
  assert.ok(!iris({}).includes('clearRect'), 'opaque: the new frame covers the old one anyway');
  const ring = runSeam('irisGate', 0.5, { ring: 5 }, { pal: KEY_PAL });
  assert.ok(!ring.ops.some((op) => op[0] === ring.out.canvas.id && op[1] === 'stroke'), 'no rim on the green-screen key');
  // blindSlats: the new frame only in the gaps the slats open, never whole behind the old one.
  for (const u of [0, 0.2, 0.5, 0.8]) {
    const r = runSeam('blindSlats', u, { count: 8, axis: 'h', stagger: 0.5 }, { alpha: true });
    const bDraws = r.ops.filter((op) => op[0] === r.out.canvas.id && op[1] === 'drawImage' && op[2] === r.b.canvas.id);
    // drawImage(b, sx, sy, sw, sh, dx, dy, dw, dh) with the source and target rectangles equal (1:1, in place)
    assert.ok(bDraws.every((op) => op.length === 11 && op[3] === op[7] && op[4] === op[8] && op[5] === op[9] && op[6] === op[10]),
      'u ' + u + ': b drawn in place, band by band');
    const rows = bDraws.reduce((n, op) => n + op[6], 0);
    if (u === 0) assert.equal(rows, 0, 'u = 0: nothing of the new frame');
    else assert.ok(rows > 0 && rows < FX_H, 'u ' + u + ': part of the new frame (' + rows + ' rows)');
    const opaque = runSeam('blindSlats', u, { count: 8, axis: 'h', stagger: 0.5 });
    const whole = (op) => op[0] === opaque.out.canvas.id && op[1] === 'drawImage' && op[2] === opaque.b.canvas.id && op.length === 5;
    assert.ok(opaque.ops.some(whole), 'opaque: the new frame whole behind the slats');
  }
  // plungeZoom: the old frame fades out as the new one fades in.
  const aAlpha = (o) => {
    const r = runSeam('plungeZoom', 0.55, { depth: 2 }, o);
    let alpha = 1, first = null;
    for (const op of r.ops) {
      if (op[0] !== r.out.canvas.id) continue;
      if (op[1] === 'set:globalAlpha') alpha = op[2];
      if (op[1] === 'drawImage' && op[2] === r.a.canvas.id && first === null) first = alpha;
    }
    return first;
  };
  assert.equal(aAlpha({}), 1, 'opaque: the old frame stays opaque underneath');
  assert.ok(aAlpha({ alpha: true }) < 0.5, 'transparent: the old frame fades as the new one comes in: ' + aAlpha({ alpha: true }));
});

test('shutterSnap closes with the black backdrop’s own black', () => {
  const blade = (pal) => {
    const r = runSeam('shutterSnap', 0.5, { axis: 'v', hold: 0.1 }, pal ? { pal } : {});
    return fillsUnder(r.ops, r.out.canvas.id, 'source-over')[0].fill;
  };
  assert.equal(blade(BLACK_PAL), '#000000');
  assert.equal(blade(NIGHT_PAL), '#0B0B0D');
});
