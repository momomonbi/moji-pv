/* 文字PVメーカー v2 — original work. Tests for 文字組み at scene build: the cut-scoped text service reaches the builder and the parts, cuts without a setting build as before (DESIGN_2_2 §1). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const FAC = MV.use('engine/facade');
const BUILD = MV.use('engine/scene/build');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');

const REG = MV.use('parts/catalog').defaultRegistry();
const KUMI_SLOTS = Object.freeze({
  'text.kana': Object.freeze({ v: 0.7, from: 'auto' }),
  'text.jump': Object.freeze({ v: 0.5, from: 'auto' }),
  'text.latin': Object.freeze({ v: 0.5, from: 'auto' }),
});

// A one-cut sample plan of an arrange; `slots` are added to the cut's decisions (the planner's kumi slots).
function sample(arrange, text, slots) {
  const plan = FAC.samplePlan(REG, { kind: 'arrange', key: arrange }, { text });
  const cut = plan.cuts[0];
  if (slots) {
    cut.slots = Object.assign({}, cut.slots, slots);
    cut.fp += ':' + JSON.stringify(slots);
  }
  return { plan, cut };
}

function build(arrange, text, slots, text2) {
  const { plan, cut } = sample(arrange, text, slots);
  const svc = { registry: REG, text: text2 || createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
  return { scene: BUILD.buildCut(cut, plan, svc), svc, plan, cut };
}

// Every committed glyph of a scene: { ch, em, size (its run's fitted size), role }.
function glyphsOf(scene) {
  const out = [];
  for (const r of scene.runs) {
    const lay = r.layout;
    for (let i = 0; i < lay.n; i++) out.push({ ch: lay.ch[i], em: lay.em[i], size: lay.size, role: lay.kumi ? lay.kumi[i] : 0 });
  }
  return out;
}

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
