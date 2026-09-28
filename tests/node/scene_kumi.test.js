/* 文字PVメーカー v2 — original work. Tests for 文字組み at scene build: the cut-scoped text service reaches the builder and the parts, particles and heads are live, the parts that contrast sizes or keep a pitch opt out, cuts without a setting build as before (DESIGN_2_2 §1). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const FAC = MV.use('engine/facade');
const BUILD = MV.use('engine/scene/build');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const KU = MV.use('engine/text/kumi');

const REG = MV.use('parts/catalog').defaultRegistry();
const KUMI_SLOTS = Object.freeze({
  'text.kana': Object.freeze({ v: 0.7, from: 'auto' }),
  'text.jump': Object.freeze({ v: 0.5, from: 'auto' }),
  'text.latin': Object.freeze({ v: 0.5, from: 'auto' }),
});

// A one-cut sample plan of an arrange; `slots` are added to the cut's decisions (the planner's kumi slots). o.params:
// the arrange's params; o.emph: the cut's emphasis ranges (the sample's own otherwise).
function sample(arrange, text, slots, o = {}) {
  const plan = FAC.samplePlan(REG, { kind: 'arrange', key: arrange, params: o.params || null }, { text, orient: o.orient });
  const cut = plan.cuts[0];
  if (o.emph) cut.emph = o.emph;
  if (slots) {
    cut.slots = Object.assign({}, cut.slots, slots);
    cut.fp += ':' + JSON.stringify(slots);
  }
  return { plan, cut };
}

function build(arrange, text, slots, text2, o) {
  const { plan, cut } = sample(arrange, text, slots, o);
  const svc = { registry: REG, text: text2 || createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
  return { scene: BUILD.buildCut(cut, plan, svc), svc, plan, cut };
}

// Every committed glyph of a scene: { ch, em, size (its run's fitted size), role, run (index), x, y, w, h }.
function glyphsOf(scene) {
  const out = [];
  scene.runs.forEach((r, run) => {
    const lay = r.layout;
    for (let i = 0; i < lay.n; i++) {
      out.push({ ch: lay.ch[i], em: lay.em[i], size: lay.size, role: lay.kumi ? lay.kumi[i] : 0, run,
        x: lay.box.x + lay.x[i], y: lay.box.y + lay.y[i], w: lay.w[i], h: lay.h[i] });
    }
  });
  return out;
}
const ratio = (g) => Math.round((g.em / g.size) * 1e4) / 1e4;

test('kumiOf: null unless a strength is on; head defaults to line', () => {
  assert.equal(BUILD.kumiOf({}), null);
  assert.equal(BUILD.kumiOf({ 'text.head': { v: 'phrase', from: 'pin:work' } }), null);
  assert.equal(BUILD.kumiOf({ 'text.kana': { v: 0, from: 'pin:line' } }), null);
  assert.deepEqual(BUILD.kumiOf(KUMI_SLOTS), { kana: 0.7, jump: 0.5, latin: 0.5, head: 'line' });
  assert.deepEqual(BUILD.kumiOf({ 'text.latin': { v: 1, from: 'pin:work' }, 'text.head': { v: 'none', from: 'pin:work' } }),
    { kana: 0, jump: 0, latin: 1, head: 'none' });
});

test('a cut without kumi slots builds with the service as it is: no run carries kumi', () => {
  const { scene, svc } = build('centerAnchor', '小さな声でGood morning');
  assert.ok(scene.runs.length > 0);
  for (const r of scene.runs) {
    assert.equal(r.layout.kumi, null);
    assert.equal(r.spec.kumi, undefined);
  }
  assert.equal(scene.fontKey, svc.text.key);
  // …and a service without withKumi is never asked for it
  const bare = Object.assign({}, svc.text);
  delete bare.withKumi;
  assert.doesNotThrow(() => build('centerAnchor', '小さな声でGood morning', null, bare));
});

test('a cut with kumi slots: the chain is live (roles, narrower kana, larger Latin) and the spec is not rewritten', () => {
  const plain = glyphsOf(build('centerAnchor', '小さな声でGood morning').scene);
  const { scene } = build('centerAnchor', '小さな声でGood morning', KUMI_SLOTS);
  const gl = glyphsOf(scene);
  assert.ok(scene.runs.every((r) => r.layout.kumi instanceof Uint8Array));
  assert.ok(scene.runs.every((r) => r.spec.kumi === undefined), 'the part\'s RunSpec stays as the part wrote it');
  const latin = gl.filter((g) => /[A-Za-z]/.test(g.ch));
  assert.ok(latin.length > 0);
  for (const g of latin) {
    assert.equal(g.role, 3, g.ch);
    assert.ok(Math.abs(g.em / g.size - 1.1) < 1e-5, g.ch + ' ' + g.em / g.size);
  }
  assert.ok(plain.every((g) => g.role === 0));
  assert.equal(scene.warnings.filter((w) => w.code === 'part-error').length, 0);
});

test('the same Latin word gets the same size whether the arrange sets one run or one run per word', () => {
  const text = '小さな声でGood morning';
  const ratios = (arrange) => glyphsOf(build(arrange, text, KUMI_SLOTS).scene)
    .filter((g) => /[A-Za-z]/.test(g.ch)).map((g) => Math.round((g.em / g.size) * 1e4) / 1e4);
  const whole = ratios('centerAnchor'), words = ratios('confettiWords');
  assert.equal(whole.length, 11);
  assert.deepEqual(words, whole);
  assert.ok(whole.every((x) => x === 1.1));
});

test('withKumi is part of the contract: a service without it fails loudly when a setting is on', () => {
  const { plan } = sample('centerAnchor', '小さな声でGood morning');
  const bare = Object.assign({}, createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }));
  delete bare.withKumi;
  assert.throws(() => build('centerAnchor', '小さな声でGood morning', KUMI_SLOTS, bare), TypeError);
});

test('cuts with equal settings share one derived service (memoised), which shares the base cache', () => {
  const { plan } = sample('centerAnchor', '夜明けのまち');
  const text = createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces });
  const seen = [];
  const spy = Object.assign({}, text, { withKumi(k) { const s = text.withKumi(k); seen.push(s); return s; } });
  build('centerAnchor', '夜明けのまち', KUMI_SLOTS, spy);
  build('confettiWords', '夜明けのまち', KUMI_SLOTS, spy);
  assert.equal(seen.length, 2);
  assert.equal(seen[0], seen[1]);
  assert.deepEqual(seen[0].kumi, { kana: 0.7, jump: 0.5, head: 'line', latin: 0.5 });
  assert.ok(text.cached > 0, 'the derived service filled the base service\'s cache');
});

// ---- T2 at the scene, and the parts that opt out ---------------------------------------------------------------------

test('T2 is live at the scene: particles at 0.82 and the line head at 1.20 of the run size', () => {
  const { scene } = build('centerAnchor', '始発のホームに', KUMI_SLOTS, null, { emph: [] });
  const gl = glyphsOf(scene).filter((g) => g.ch.trim());
  assert.deepEqual(gl.map((g) => g.ch).join(''), '始発のホームに');
  assert.deepEqual(gl.map(ratio), [1.2, 1, 0.82, 1, 1, 1, 0.82]);
  assert.deepEqual(gl.map((g) => g.role), [2, 0, 1, 0, 0, 0, 1]);
  assert.ok(scene.runs.every((r) => r.spec.kumi === undefined), 'centerAnchor takes the cut\'s typesetting as it is');
  // with the sample's emphasis on 始発, the head keeps the larger of the two sizes
  const e = glyphsOf(build('centerAnchor', '始発のホームに', KUMI_SLOTS, null, { emph: [[0, 2]] }).scene).filter((g) => g.ch.trim());
  assert.deepEqual(e.map(ratio).slice(0, 3), [1.2, 1.15, 0.82]);
});

// The parts that set sizes or a pitch of their own write kumi (K.kumiFor) only when the cut is set with typesetting.
const OPT_OUTS = [
  ['giantWhisper', { tuck: 'beside' }, { jump: 0 }],
  ['giantWhisper', { tuck: 'under' }, { jump: 0 }],
  ['confettiWords', null, { jump: 0 }],
  ['magazineHead', null, { jump: 0 }],
  ['gridMosaic', null, null],
];

test('opt-outs: giantWhisper, confettiWords and magazineHead take no T2, gridMosaic cells are plain; without a setting no spec changes', () => {
  const text = '始発のホームに白い息';
  for (const [arrange, params, over] of OPT_OUTS) {
    const on = build(arrange, text, KUMI_SLOTS, null, { params });
    const off = build(arrange, text, null, null, { params });
    const lyric = on.scene.runs.filter((r) => r.spec.text === undefined);
    assert.ok(lyric.length > 0, arrange);
    for (const r of lyric) {
      assert.deepEqual(r.spec.kumi, over, arrange + ': the run asks for ' + JSON.stringify(over));
      assert.ok(!Array.from(r.layout.kumi || []).some((x) => x === 1 || x === 2), arrange + ': no particle or head sizes');
    }
    for (const r of off.scene.runs) assert.ok(!('kumi' in r.spec), arrange + ': a cut without typesetting writes no kumi');
    assert.equal(on.scene.warnings.filter((w) => w.code === 'part-error').length, 0, arrange);
  }
  // …while kana tightening still applies to them (only gridMosaic cells are plain)
  const g = glyphsOf(build('giantWhisper', text, KUMI_SLOTS, null, { params: { tuck: 'under' } }).scene);
  const g0 = glyphsOf(build('giantWhisper', text, null, null, { params: { tuck: 'under' } }).scene);
  const kana = (gl) => gl.filter((x) => x.ch === 'ホ').map((x) => Math.round((x.w / x.em) * 1e4) / 1e4);
  assert.ok(kana(g)[0] < kana(g0)[0], 'ホ is narrower with kana tightening on: ' + kana(g) + ' vs ' + kana(g0));
});

test('giantWhisper: the pre-measures lay out exactly what is committed, with typesetting on', () => {
  // a spy on the cut's derived service: every layout a part asks for directly (a pre-measure; the builder's own
  // commits pass frozen specs)
  const { plan } = sample('giantWhisper', '始発のホームに白い息', null, { params: { tuck: 'beside' } });
  const base = createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces });
  const pre = [];
  const spyOf = (svc) => Object.assign({}, svc, {
    layout(spec, text) { const lay = svc.layout(spec, text); if (!Object.isFrozen(spec)) pre.push({ spec, lay }); return lay; },
  });
  const spy = Object.assign({}, base, { withKumi: (k) => spyOf(base.withKumi(k)) });
  const { scene } = build('giantWhisper', '始発のホームに白い息', KUMI_SLOTS, spy, { params: { tuck: 'beside' } });
  const giant = scene.runs.find((r) => r.spec.text === undefined && r.spec.maxLines === 1);
  assert.ok(giant, 'the giant run');
  const measured = pre.filter((p) => p.spec.span && p.spec.span[0] === giant.spec.span[0] && p.spec.span[1] === giant.spec.span[1]
    && p.spec.size === giant.spec.size);
  assert.ok(measured.length > 0, 'the giant was pre-measured at its size');
  for (const p of measured) {
    assert.deepEqual(p.spec.kumi, { jump: 0 });
    assert.ok(Math.abs(p.lay.box.w - giant.layout.box.w) < 1e-3, 'the pre-measured width is the committed width: '
      + p.lay.box.w + ' vs ' + giant.layout.box.w);
    assert.deepEqual(Array.from(p.lay.em), Array.from(giant.layout.em));
  }
  // the whispers are pre-measured too (tuck 'under' places them by their measured width): every pre-measure of the
  // part asks for what its commits ask for
  for (const tuck of ['beside', 'under']) {
    pre.length = 0;
    const b = build('giantWhisper', '始発のホームに白い息', KUMI_SLOTS, spy, { params: { tuck } });
    // beside: the giant's width (one line); under: the whispers' width (up to two lines)
    assert.ok(pre.some((p) => p.spec.maxLines === (tuck === 'under' ? 2 : 1)), tuck + ': pre-measured');
    for (const p of pre) assert.deepEqual(p.spec.kumi, { jump: 0 }, tuck);
    for (const r of b.scene.runs) if (r.spec.text === undefined) assert.deepEqual(r.spec.kumi, { jump: 0 }, tuck);
  }
  // the giant 始発 starts the cut: without the opt-out 始 would be a line head (1.20), in the commit and the pre-measure
  assert.equal(giant.layout.ch[0], '始');
  assert.ok(Math.abs(giant.layout.em[0] / giant.layout.size - 1) < 1e-6, 'the giant\'s first glyph keeps the run size');
  assert.equal(giant.layout.kumi[0], 0);
});

test('gridMosaic and haloRing: glyph positions are identical with and without typesetting', () => {
  for (const [arrange, text] of [['gridMosaic', '始発のホームに白い息'], ['haloRing', '始発のホームに'],
    ['gridMosaic', '始発のホームに白い息、改札の向こうで朝がほどける、ポケットの切符をそっと握ってまだ名前のない今日へ行く、パンの匂いの角を曲がれば電線の上でツバメが鳴いた']]) {
    const on = glyphsOf(build(arrange, text, KUMI_SLOTS).scene);
    const off = glyphsOf(build(arrange, text, null).scene);
    assert.equal(on.length, off.length, arrange);
    assert.deepEqual(on, off, arrange + ' ' + text.length);
    assert.ok(on.every((g) => g.role === 0), arrange);
  }
});

test('one chain with a glyph-weight face step: a service derived by withFaces keeps its faces under withKumi, and the scene carries both', () => {
  const { plan } = sample('centerAnchor', '始発のホームに', null, { emph: [] });
  const gothic = JSON.parse(JSON.stringify(plan.look.faces));
  gothic.display.ja = { family: 'Zen Kaku Gothic New', weight: 500 };
  const base = createTextService({ measurer: fakeMeasurer(), faces: gothic });
  const heavy = JSON.parse(JSON.stringify(gothic));
  heavy.display.ja = { family: 'Zen Kaku Gothic New', weight: 900 };
  // what the text.weight step of DESIGN_2_2 §4 hands on (svc.text.withFaces(reweighed faces)); withKumi composes on top
  const reweighed = base.withFaces(heavy);
  const k = BUILD.kumiOf(KUMI_SLOTS);
  assert.equal(reweighed.withKumi(k).faces, heavy);
  assert.deepEqual(reweighed.withKumi(k).kumi, KU.normalize(k));
  assert.deepEqual(base.withKumi(k).withFaces(heavy).kumi, KU.normalize(k));
  const { scene } = build('centerAnchor', '始発のホームに', KUMI_SLOTS, reweighed, { emph: [] });
  const run = scene.runs[0];
  assert.equal(run.layout.fonts[0].family, 'Zen Kaku Gothic New');
  assert.equal(Number(run.layout.fonts[0].weight), 900);
  assert.deepEqual(Array.from(run.layout.kumi), [2, 0, 1, 0, 0, 0, 1]);
  // the weight damp (≥ 800) of T1 reads the layout face: ム (no seam) is trimmed by 0.14 × 0.7 × 0.8 of an em
  const kanaOnly = { 'text.kana': KUMI_SLOTS['text.kana'] };
  const plainK = build('centerAnchor', '始発のホームに', kanaOnly, base, { emph: [] }).scene.runs[0].layout;
  const heavyK = build('centerAnchor', '始発のホームに', kanaOnly, reweighed, { emph: [] }).scene.runs[0].layout;
  assert.equal(heavyK.ch[5], 'ム');
  assert.ok(Math.abs(heavyK.w[5] / heavyK.em[5] - (1 - 0.14 * 0.7 * 0.8)) < 1e-4, 'heavy ' + heavyK.w[5] / heavyK.em[5]);
  assert.ok(Math.abs(plainK.w[5] / plainK.em[5] - (1 - 0.14 * 0.7)) < 1e-4, 'plain ' + plainK.w[5] / plainK.em[5]);
});

test('a planned new work (look.gen = 1): particles at 0.82 of their run in the built scenes, heads live too', () => {
  const corpus = require('../helpers/corpus.js');
  const PL = MV.use('planner/plan');
  const doc = JSON.parse(JSON.stringify(corpus.project('basic').doc));
  doc.look.gen = 1;
  doc.pins = Object.assign({}, doc.pins, { 'work:arrange': { v: 'centerAnchor', by: 'user' } });
  const plan = PL.run(doc, REG, { fresh: true });
  const svc = { registry: REG, text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
  const roles = new Set();
  let particles = 0;
  for (const cut of plan.cuts) {
    if (!cut.text.trim()) continue;
    const scene = BUILD.buildCut(cut, plan, svc);
    for (const r of scene.runs) {
      const lay = r.layout;
      if (!lay.kumi) continue;
      for (let i = 0; i < lay.n; i++) {
        roles.add(lay.kumi[i]);
        if (lay.kumi[i] === 1 && !lay.emph[i]) {
          assert.ok(Math.abs(lay.em[i] / lay.size - 0.82) < 1e-5, cut.key + ' ' + lay.ch[i] + ' ' + lay.em[i] / lay.size);
          particles++;
        }
      }
    }
  }
  assert.ok(particles >= 10, 'particles ' + particles);
  // (its Latin cut, 「Fly high」, holds no CJK: T3 leaves it as it is)
  assert.deepEqual([...roles].sort(), [0, 1, 2], 'plain, particle and head glyphs');
  // the same document without the marker builds without any role
  const legacy = PL.run(Object.assign({}, doc, { look: Object.assign({}, doc.look, { gen: undefined }) }), REG, { fresh: true });
  for (const cut of legacy.cuts) {
    if (!cut.text.trim()) continue;
    for (const r of BUILD.buildCut(cut, legacy, svc).runs) assert.equal(r.layout.kumi, null, cut.key);
  }
});

// --- the golden ---------------------------------------------------------------------------------------------------------

test('the 文字組み golden: its documents plan and render the golden frames (tests/golden/project_kumi.json)', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const KD = require('../helpers/kumi_docs.js');
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'golden', 'project_kumi.json'), 'utf8'));
  const { createEngine } = MV.use('engine/facade');
  const { createRecorder } = MV.use('engine/render/record');
  const H = MV.use('core/hash');
  const D = MV.use('core/doc');
  assert.equal(golden.registry.version, REG.version, 'made with the current catalog');
  assert.deepEqual(Object.keys(golden.docs), ['basic', 'vertical']);
  for (const { name, doc } of KD.goldenDocs()) {
    const rec = createRecorder();
    const engine = createEngine({ registry: REG, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null });
    const { plan } = engine.setDoc(doc);
    assert.equal(plan.hash, golden.docs[name].plan, name);
    await engine.prepare(0, plan.duration, { export: true });
    const [w, h] = D.DESIGN_SIZE[doc.look.aspect];
    const k = 360 / Math.min(w, h);
    const made = rec.factory.create(Math.round(w * k), Math.round(h * k), { alpha: false });
    const surface = { canvas: made.canvas, ctx: made.ctx, w: Math.round(w * k), h: Math.round(h * k) };
    const frames = [];
    for (let i = 0; i < 40; i++) {
      const before = rec.ops().length;
      engine.renderFrame(surface, (plan.duration * (i + 0.5)) / 40, { quality: 'export', pick: false, scale: surface.w / plan.design.w });
      frames.push(H.hashJSON(rec.ops().slice(before)));
    }
    engine.dispose();
    assert.deepEqual(frames, golden.docs[name].frames, name);
  }
  // the golden exercises the setting: most frames differ from the plain documents' golden frames
  const plain = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'golden', 'frame_hashes.json'), 'utf8')).frames;
  for (const name of ['basic', 'vertical']) {
    const differ = golden.docs[name].frames.filter((x, i) => x !== plain[name][i]).length;
    assert.ok(differ >= 30, name + ': ' + differ + ' of 40 frames differ');
  }
});
