/* 文字PVメーカー v2 — original work. Tests for the glyph morph in the renderer (DESIGN_2_2 §4, M4): travellers, the skip mask, eligible layers, rest alpha, picks, the warm-up, lerpAffine. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const G = require('../helpers/glyph_docs.js');

const MV = load();
const R = MV.use('engine/render/record');
const MO = MV.use('engine/render/morph');
const F = MV.use('engine/scene/frame');
const REG = MV.use('core/registry');
const K = MV.use('parts/kit');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const { createEngine } = MV.use('engine/facade');
const CAT = MV.use('parts/catalog').defaultRegistry();
const GROUND = CAT.fallback('ground');
const MORPH = 'glyphMorph';
const W = 640;

// --- helpers ---------------------------------------------------------------------------------------------------------------

function mul(A, B) {
  return [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
}

// Every fillText of an op list with its canvas, the transform and font it was drawn with and its alpha; F = the glyph's
// frame in em units (the transform times the font size), which is what a glyph looks like on the canvas.
function glyphDraws(ops) {
  const st = new Map();
  const out = [];
  for (const op of ops) {
    const [id, name, ...a] = op;
    let s = st.get(id);
    if (!s) { s = { M: [1, 0, 0, 1, 0, 0], stack: [], font: '', alpha: 1 }; st.set(id, s); }
    if (name === 'save') s.stack.push({ M: s.M.slice(), font: s.font, alpha: s.alpha });
    else if (name === 'restore') { const p = s.stack.pop(); if (p) Object.assign(s, p); }
    else if (name === 'setTransform') s.M = a.slice(0, 6);
    else if (name === 'transform') s.M = mul(s.M, a.slice(0, 6));
    else if (name === 'translate') s.M = mul(s.M, [1, 0, 0, 1, a[0], a[1]]);
    else if (name === 'scale') s.M = mul(s.M, [a[0], 0, 0, a[1], 0, 0]);
    else if (name === 'rotate') { const c = Math.cos(a[0]), n = Math.sin(a[0]); s.M = mul(s.M, [c, n, -n, c, 0, 0]); }
    else if (name === 'set:font') s.font = a[0];
    else if (name === 'set:globalAlpha') s.alpha = a[0];
    else if (name === 'fillText') {
      const px = Number(/([\d.]+)px/.exec(s.font)[1]);
      out.push({ canvas: id, ch: a[0], M: s.M.slice(), F: mul(s.M, [px, 0, 0, px, 0, 0]), px, alpha: s.alpha, font: s.font });
    }
  }
  return out;
}

// The same glyph frame, to the recorder's rounding (1e-3 on every transform number, scaled by the font sizes).
function sameFrame(a, b, where) {
  const tol = 1e-3 * (a.px + b.px) + 1e-3;
  for (let k = 0; k < 4; k++) assert.ok(Math.abs(a.F[k] - b.F[k]) <= tol, where + ' F[' + k + '] ' + a.F[k] + ' vs ' + b.F[k]);
  for (let k = 4; k < 6; k++) assert.ok(Math.abs(a.F[k] - b.F[k]) <= 4e-3, where + ' F[' + k + '] ' + a.F[k] + ' vs ' + b.F[k]);
}

async function engineFor(docOrPlan, reg, isPlan) {
  const rec = R.createRecorder();
  const engine = createEngine({ registry: reg || CAT, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null, strict: true });
  const plan = isPlan ? (engine.setPlan(docOrPlan), docOrPlan) : engine.setDoc(docOrPlan).plan;
  await engine.prepare(0, plan.duration, { export: true });
  const surface = R.surfaceOf(rec.factory, W, Math.round(W * plan.design.h / plan.design.w), false);
  const render = (t, opts) => {
    const m = rec.mark();
    const stats = engine.renderFrame(surface, t, Object.assign({ quality: 'export', pick: false, scale: W / plan.design.w }, opts || {}));
    const ops = rec.ops().slice(m);
    return { stats, ops, hash: rec.hash(m), draws: glyphDraws(ops) };
  };
  return { rec, engine, plan, surface, render };
}

const seamInto = (plan, key) => plan.seams.find((s) => s.into === key);
const cutIdx = (plan, key) => plan.cuts.findIndex((c) => c.key === key);
const lo = (s) => s.at - s.dur / 2;
const canvasesOf = (draws, chars) => new Set(draws.filter((d) => chars.includes(d.ch)).map((d) => d.canvas));

// The plan with one seam's part replaced (the same windows, cuts and scenes).
function withSeamPart(plan, into, key) {
  const seams = plan.seams.map((s) => (s.into === into ? Object.assign({}, s, { slot: Object.assign({}, s.slot, { v: key }) }) : s));
  return Object.assign({}, plan, { seams });
}

// --- 1. the ends are the two glyphs ---------------------------------------------------------------------------------------

// (the second document goes from vertical to horizontal writing: ー turns, 12 is a tate-chu-yoko cell)
const VERTICAL = () => G.morphDoc(GROUND, { rows: ['[ti:ガラスの朝]', 'ブルーの空へ12', 'ブルーの海へ12'],
  pins: { 'line/r2:orient': { v: 'v', by: 'user' } } });

test('travellers: at u = 0 each is exactly A\'s glyph, at u = 1 exactly B\'s', async () => {
  for (const [doc, intos] of [[G.morphDoc(GROUND), ['r4~0', 'r6~0', 'rc~0']], [VERTICAL(), ['r3~0']]]) {
    const { plan, render } = await engineFor(doc);
    for (const into of intos) {
      const s = seamInto(plan, into);
      assert.equal(s.slot.v, MORPH);
      const A = plan.cuts[cutIdx(plan, into) - 1], B = plan.cuts[cutIdx(plan, into)];
      const shared = s.glyphs.filter((p) => p[2] === 1).map((p) => [...A.text.slice(p[0])][0]);
      // reference: the same frame with a plain dissolve draws A's and B's glyphs on the two side surfaces; at u = 0 it
      // composites A's alone, at u = 1 B's alone (the canvases drawn into the mix)
      const ref = await engineFor(withSeamPart(plan, into, 'blendDissolve'), CAT, true);
      for (const [u, side, t] of [[0, A, lo(s)], [1, B, s.at + s.dur / 2 - 1e-7]]) {
        const got = render(t).draws, r = ref.render(t);
        const shown = new Set(r.ops.filter((o) => o[1] === 'drawImage').map((o) => o[2]));
        const want = r.draws.filter((d) => shown.has(d.canvas) && d.alpha > 0.5);
        for (const ch of shared) {
          const trav = got.filter((d) => d.ch === ch && d.alpha > 0.5);
          const glyph = want.filter((d) => d.ch === ch);
          assert.ok(trav.length >= 1 && glyph.length >= 1, into + ' ' + ch + ' drawn');
          // (a letter drawn twice in one line: the pair holds one of them)
          const ok = trav.some((x) => glyph.some((y) => { try { sameFrame(x, y, ''); return true; } catch (e) { return false; } }));
          assert.ok(ok, into + ' u=' + u + ' ' + ch + ': the traveller is ' + side.key + '\'s glyph');
        }
      }
    }
  }
});

// --- 2. the skip mask ----------------------------------------------------------------------------------------------------

test('skip mask: the travelling letters are left out of both side surfaces; the others stay on their side', async () => {
  const { plan, render } = await engineFor(G.morphDoc(GROUND));
  const s = seamInto(plan, 'rc~0');                         // 光る窓 → 光る窓の向こう: 光る窓 travels, の向こう is B's alone
  for (const u of [0, 0.3, 0.6]) {
    const d = render(lo(s) + u * s.dur).draws.filter((x) => x.alpha > 0);
    const shared = canvasesOf(d, ['光', 'る', '窓']), rest = canvasesOf(d, ['の', '向', 'こ', 'う']);
    if (u > 0.3) assert.equal(rest.size, 1, 'u=' + u + ': の向こう on B\'s side surface');
    assert.equal(shared.size <= 1 || u > 0, true);
    for (const c of rest) assert.ok(!d.some((x) => x.canvas === c && ['光', 'る', '窓'].includes(x.ch)), 'u=' + u + ': no travelling letter on a side');
    if (u === 0) assert.equal(shared.size, 1, 'u=0: the travellers are drawn on the frame only');
  }
  // a plain dissolve at the same place draws every letter on its side surface
  const ref = await engineFor(withSeamPart(plan, 'rc~0', 'blendDissolve'), CAT, true);
  const d = ref.render(lo(s) + 0.6 * s.dur).draws;
  assert.equal(canvasesOf(d, ['光']).size, 2, 'both sides draw 光 without the glyph seam');
});

test('a seam that is not a glyph seam renders as before: the pairs of a plan entry are read only by a glyph seam', async () => {
  const { plan } = await engineFor(G.morphDoc(GROUND));
  const dissolve = withSeamPart(plan, 'r4~0', 'blendDissolve');
  const bare = Object.assign({}, dissolve, { seams: dissolve.seams.map((s) => { const c = Object.assign({}, s); delete c.glyphs; return c; }) });
  const a = await engineFor(dissolve, CAT, true), b = await engineFor(bare, CAT, true);
  const s = seamInto(plan, 'r4~0');
  for (const u of [0, 0.5, 0.9]) assert.equal(a.render(lo(s) + u * s.dur).hash, b.render(lo(s) + u * s.dur).hash, 'u=' + u);
});

// --- 3. after the window --------------------------------------------------------------------------------------------------

test('after the window: from B.a on, nothing of A is drawn (the hand-over), and B stands where the travellers ended', async () => {
  const { plan, render } = await engineFor(G.morphDoc(GROUND));
  const s = seamInto(plan, 'r4~0');
  const A = plan.cuts[cutIdx(plan, 'r4~0') - 1], B = plan.cuts[cutIdx(plan, 'r4~0')];
  assert.ok(A.t1 > B.a, 'A is still sung after B.a');
  for (const t of [B.a, (B.a + B.t0) / 2, B.t0 - 1e-3]) {
    const fg = F.frameAt(plan, t);
    assert.equal(fg.seam, null, t + ': the seam is over');
    assert.ok(!fg.cuts.some((e) => e.i === cutIdx(plan, A.key)), t + ': A is off screen');
    const d = render(t).draws;
    assert.ok(!d.some((x) => x.ch === '空'), t + ': 空 (A\'s alone) is not drawn');
  }
  // continuity: B at B.a is where the travellers stood at the end of the window
  const end = render(s.at + s.dur / 2 - 1e-7).draws, after = render(B.a).draws;
  for (const ch of ['青', 'い', '海', 'へ']) {
    const x = end.find((d) => d.ch === ch && d.alpha > 0.5), y = after.find((d) => d.ch === ch);
    sameFrame(x, y, ch + ' at the window end and at B.a');
  }
});

// --- 4. eligibility and the node choice -------------------------------------------------------------------------------------

// Test layouts over the cut's text: a faint copy of the text before the main run (rest alpha 0.3), and a text layer at
// opacity 0.5.
const L2 = (ja, en) => ({ ja, en });
function testArrange(key, build) {
  return K.arrange({ key, label: L2('テスト', 'Test'), blurb: L2('テスト用の構図', 'A test layout'), tags: ['minimal'], family: 'test' + key,
    pool: false, build });
}
function runsOver(env, count, patch) {
  const { D, cut, sb } = env;
  const text = cut.text || '♪';
  const root = sb.group({});
  const runs = [];
  for (let k = 0; k < count; k++) {
    const parent = k === 0 && count > 1 ? sb.group({ parent: root, alpha: 0.3, y: -D.short * 0.2 }) : root;
    runs.push(sb.text({ parent, orient: 'h', size: D.short * 0.1, box: { x: 0, y: D.cy - D.short * 0.08, w: D.w, h: D.short * 0.16 },
      align: 'center', valign: 'center', maxLines: 1, breakAt: 'none', fit: 'shrink', span: [0, text.length] }));
  }
  if (patch) patch(sb);
  const focus = sb.bounds(root);
  return { runs, focus, free: sb.freeAround(focus) };
}
const TEST_REG = REG.createRegistry(MV.use('parts/catalog').defs().concat([
  testArrange('faintFirst', (env) => runsOver(env, 2)),
  testArrange('halfText', (env) => runsOver(env, 1, (sb) => sb.layer('text', { opacity: 0.5 }))),
  testArrange('staticText', (env) => runsOver(env, 1, (sb) => sb.layer('text', { cache: 'static' }))),
]));

function pinnedMorphDoc(arrange, knockout) {
  const pins = { 'cut/r4~0:seam': { v: MORPH, by: 'user', sig: '青い海へ' } };
  for (const line of ['r3', 'r4']) {
    pins['line/' + line + ':arrange'] = { v: arrange, by: 'user' };
    if (knockout) pins['line/' + line + ':arrange@edgeBleed.knockout'] = { v: true, by: 'user' };
  }
  return G.morphDoc(GROUND, { gen: undefined, pins });
}

test('eligibility: a knockout (the text layer is a mask at opacity 0) and a half-transparent text layer never travel', async () => {
  for (const [arrange, knockout, reg] of [['edgeBleed', true, CAT], ['halfText', false, TEST_REG]]) {
    const { plan, engine, render } = await engineFor(pinnedMorphDoc(arrange, knockout), reg);
    const s = seamInto(plan, 'r4~0');
    assert.deepEqual([s.slot.v, s.glyphs.length > 0], [MORPH, true], arrange + ': a pinned morph with pairs');
    const a = engine.scene('cut', cutIdx(plan, 'r3~0')), b = engine.scene('cut', cutIdx(plan, 'r4~0'));
    const L = MV.use('engine/scene/table').LAYER_INDEX.text;
    assert.equal(MO.eligible(a, L), false, arrange + ': the text layer is not eligible');
    assert.equal(MO.offIndex(a).size, 0);
    assert.equal(MO.prepare(s, a, b), null, arrange + ': no travellers');
    // the frame renders (the part only melts) and draws the letters as the layers say
    const d = render(lo(s) + 0.5 * s.dur);
    assert.ok(d.stats.drawn.glyphs > 0);
  }
  // a plain layout is eligible: the control
  const { plan, engine } = await engineFor(pinnedMorphDoc('centerAnchor', false));
  const s = seamInto(plan, 'r4~0');
  const mv = MO.prepare(s, engine.scene('cut', cutIdx(plan, 'r3~0')), engine.scene('cut', cutIdx(plan, 'r4~0')));
  assert.equal(mv.n, 4);
});

test('rest alpha: of two runs over the same letters, the one at full strength stands for them (not a faint copy)', async () => {
  const { plan, engine } = await engineFor(pinnedMorphDoc('faintFirst', false), TEST_REG);
  const scene = engine.scene('cut', cutIdx(plan, 'r3~0'));
  assert.equal(scene.runs.length, 2);
  const [faint, main] = scene.runs;
  const map = MO.offIndex(scene);
  assert.equal(map.size, 4);
  for (const [off, node] of map) {
    assert.ok(node >= main.from && node < main.to, off + ': a node of the main run');
    assert.ok(!(node >= faint.from && node < faint.to));
    assert.equal(MO.restAlpha(scene.table, node), 1);
  }
  assert.ok(Math.abs(MO.restAlpha(scene.table, faint.from) - 0.3) < 1e-6);
  // the faint copy stays on the side surface and melts
  const s = seamInto(plan, 'r4~0');
  const mv = MO.prepare(s, scene, engine.scene('cut', cutIdx(plan, 'r4~0')));
  assert.ok(Array.from(mv.ia).every((i) => i >= main.from && i < main.to));
  assert.equal(mv.skip.get(scene)[faint.from], 0);
});

test('a static text layer is drawn live while its glyphs travel (its raster holds every glyph), and cached again after', async () => {
  const { plan, render, rec } = await engineFor(pinnedMorphDoc('staticText', false), TEST_REG);
  const s = seamInto(plan, 'r4~0');
  const B = plan.cuts[cutIdx(plan, 'r4~0')];
  const start = rec.mark();
  // before the window: A's raster; inside: both drawn live without the travellers; after: B's raster, whole
  render(lo(s) - 0.1);
  const mid = render(lo(s) + 0.5 * s.dur).draws.filter((d) => d.alpha > 0);
  const shared = canvasesOf(mid, ['青', 'い', 'へ']);
  assert.equal(shared.size, 1, 'the travellers alone draw the shared letters');
  const after = render(B.a + 0.3);
  const all = glyphDraws(rec.ops().slice(start));
  const shown = new Set(after.ops.filter((o) => o[1] === 'drawImage').map((o) => o[2]));
  for (const ch of ['青', 'い', '海', 'へ']) {
    assert.ok(all.some((d) => d.ch === ch && shown.has(d.canvas)) || after.draws.some((d) => d.ch === ch), ch + ' shows after the window');
  }
});

// --- 5. picks, determinism, the paths, the warm-up -------------------------------------------------------------------------

test('picks inside the window hit B\'s cut where the traveller is', async () => {
  const { plan, render, engine } = await engineFor(G.morphDoc(GROUND));
  const s = seamInto(plan, 'r4~0');
  const scale = W / plan.design.w;
  for (const u of [0.2, 0.5, 0.8]) {
    const d = render(lo(s) + u * s.dur, { pick: true }).draws.filter((x) => x.ch === '青' && x.alpha > 0.5);
    assert.ok(d.length >= 1);
    const x = d[0].F[4] / scale, y = d[0].F[5] / scale;
    const hits = engine.hitTest(x, y);
    assert.ok(hits.some((h) => h.cut === 'r4~0'), 'u=' + u + ': ' + JSON.stringify(hits));
  }
});

test('determinism: the same frame twice, and preview and export, draw the same travellers', async () => {
  const doc = G.morphDoc(GROUND);
  const a = await engineFor(doc), b = await engineFor(doc);
  const s = seamInto(a.plan, 'r6~0');
  for (const u of [0.1, 0.45, 0.8]) {
    const t = lo(s) + u * s.dur;
    assert.equal(a.render(t).hash, b.render(t).hash, 'u=' + u);
    const trav = (r) => r.draws.filter((x) => '朝の町を歩く夜'.includes(x.ch)).map((x) => [x.ch, x.F.map((v) => Math.round(v)), x.alpha]);
    assert.deepEqual(trav(a.render(t, { quality: 'preview' })), trav(b.render(t, { quality: 'export' })), 'preview = export at u=' + u);
  }
});

test('paths: a swap melts on the sprite path mid-window and is drawn directly at the ends', async () => {
  const { plan, render } = await engineFor(G.morphDoc(GROUND));
  const s = seamInto(plan, 'r4~0');                       // 空 → 海 is a swap (soften > 0)
  assert.ok(s.slot.p.soften > 0);
  const frameOf = (d) => d.find((x) => x.ch === '青').canvas;
  let d = render(lo(s)).draws;
  assert.ok(d.some((x) => x.ch === '空' && x.canvas === frameOf(d)), 'u=0: 空 directly on the frame');
  d = render(lo(s) + 0.5 * s.dur).draws;
  assert.ok(!d.some((x) => (x.ch === '空' || x.ch === '海') && x.canvas === frameOf(d)), 'mid-window: 空 and 海 are blurred sprites');
  d = render(s.at + s.dur / 2 - 1e-7).draws;
  assert.ok(d.some((x) => x.ch === '海' && x.canvas === frameOf(d)), 'u=1: 海 directly on the frame');
});

test('warm-up: the sprites of a morph frame are made ahead (the frame itself makes none)', async () => {
  const { plan, render, engine } = await engineFor(G.morphDoc(GROUND));
  const s = seamInto(plan, 'r4~0');
  const t0 = lo(s) - 0.2;
  render(t0, { quality: 'preview' });                     // the playhead
  await engine.prepare(t0, t0 + 1.5);                      // preview: warms the frames ahead at 30 fps
  const t = t0 + 12 / 30;                                  // a warmed frame inside the window
  assert.ok(t > lo(s) && t < s.at + s.dur / 2);
  const before = engine.stats().spritesMade;
  render(t, { quality: 'preview' });
  assert.equal(engine.stats().spritesMade, before, 'no sprite made by the frame');
  // without the warm-up the same frame does make its melt sprites
  const cold = await engineFor(G.morphDoc(GROUND));
  cold.render(t0, { quality: 'preview' });
  const b2 = cold.engine.stats().spritesMade;
  cold.render(t, { quality: 'preview' });
  assert.ok(cold.engine.stats().spritesMade > b2, 'a cold frame makes sprites');
});

// --- 6. lerpAffine -----------------------------------------------------------------------------------------------------------

test('lerpAffine: exact ends, the short way round, a mirror through zero, the bow to the left of the travel', () => {
  const out = new Float64Array(6);
  const rot = (th, s, e, f) => [Math.cos(th) * s, Math.sin(th) * s, -Math.sin(th) * s, Math.cos(th) * s, e, f];
  const A = rot(0.3, 2, 10, 20), B = rot(-0.2, 3, 110, 20);
  assert.deepEqual(Array.from(MO.lerpAffine(out, A, B, 0, 0.1)), A);
  assert.deepEqual(Array.from(MO.lerpAffine(out, A, B, 1, 0.1)), B);
  // rotation 170° → −170°: through 180°, not through 0°
  const P = rot((170 * Math.PI) / 180, 1, 0, 0), Q = rot((-170 * Math.PI) / 180, 1, 0, 0);
  MO.lerpAffine(out, P, Q, 0.5, 0);
  assert.ok(Math.abs(Math.atan2(out[1], out[0])) > 3.1, 'the short arc');
  MO.lerpAffine(out, Q, P, 0.5, 0);
  assert.ok(Math.abs(Math.atan2(out[1], out[0])) > 3.1, 'the short arc, the other way');
  // scale in log space: 2 → 8 is 4 at the middle
  MO.lerpAffine(out, rot(0, 2, 0, 0), rot(0, 8, 0, 0), 0.5, 0);
  assert.ok(Math.abs(out[0] - 4) < 1e-9 && Math.abs(out[3] - 4) < 1e-9);
  // a mirrored y (n < 0 at one end): linear through zero
  MO.lerpAffine(out, [1, 0, 0, 1, 0, 0], [1, 0, 0, -1, 0, 0], 0.5, 0);
  assert.ok(Math.abs(out[3]) < 1e-9 && Math.abs(out[0] - 1) < 1e-9);
  MO.lerpAffine(out, [1, 0, 0, 1, 0, 0], [1, 0, 0, -1, 0, 0], 0.25, 0);
  assert.ok(Math.abs(out[3] - 0.5) < 1e-9);
  // the bow: travel (100, 0) bows by arc · (−Δy, Δx) = (0, 100·arc) at the middle; straight without an arc
  MO.lerpAffine(out, [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 100, 0], 0.5, 0.12);
  assert.ok(Math.abs(out[4] - 50) < 1e-9 && Math.abs(out[5] - 12) < 1e-9);
  MO.lerpAffine(out, [1, 0, 0, 1, 0, 0], [1, 0, 0, 1, 100, 0], 0.5, 0);
  assert.ok(Math.abs(out[5]) < 1e-9);
  // shear: the ratio m / n interpolates linearly
  MO.lerpAffine(out, [1, 0, 0, 1, 0, 0], [1, 0, 1, 1, 0, 0], 0.5, 0);
  assert.ok(Math.abs(out[2] - 0.5) < 1e-9);
});

// --- 7. the part's thumbnail (engine/facade.samplePlan) ------------------------------------------------------------------

test('thumbnail: the canned morph shows two lines that share letters, its own window, the pairs and the hand-over', async () => {
  const FAC = MV.use('engine/facade');
  const PM = MV.use('planner/morph');
  const sp = FAC.samplePlan(CAT, { kind: 'seam', key: MORPH }, {});
  assert.deepEqual(sp.cuts.map((c) => c.text), [FAC.SAMPLE_MORPH_A, FAC.SAMPLE_MORPH_B], 'the canned pair 青い空 → 青い海');
  const [A, B] = sp.cuts, s = sp.seams[0];
  const def = CAT.get('seam', MORPH);
  assert.equal(s.slot.v, MORPH);
  assert.ok(s.dur > 0 && s.dur <= def.share * Math.min(A.b - A.a, B.b - B.a) + 1e-9, 'the part\'s share: ' + s.dur);
  assert.ok(Math.abs(s.at - (B.a - s.dur / 2)) < 1e-9, 'ends: the window is [B.a − dur, B.a]');
  assert.deepEqual(s.glyphs, PM.pairsOf(A.text, B.text, s.slot.p.melt), 'the letters the lines share');
  assert.ok(s.glyphs.some((p) => p[2] === 1) && s.glyphs.some((p) => p[2] === 0), 'some travel, some melt');
  assert.equal(A.b, Math.floor((s.at + s.dur / 2) * 1e6) / 1e6, 'A is handed over at the window end');
  assert.deepEqual([A.slots.depart.v, B.slots.arrive.v], [CAT.fallback('depart'), CAT.fallback('arrive')], 'both motions replaced');
  // the page's own lines when given; A's fingerprint follows its window
  const en = FAC.samplePlan(CAT, { kind: 'seam', key: MORPH }, { text: 'BLUE SKY', textB: 'BLUE SEA' });
  assert.deepEqual(en.cuts.map((c) => c.text), ['BLUE SKY', 'BLUE SEA']);
  assert.ok(en.seams[0].glyphs.length > 0, 'BLUE travels');
  const plain = FAC.samplePlan(CAT, { kind: 'seam', key: 'blendDissolve' }, {});
  assert.deepEqual(plain.cuts.map((c) => c.text), ['はじまりの朝', '光のなかへ'], 'another seam keeps the canned pair');
  assert.equal(plain.seams[0].at, plain.cuts[1].a, 'and its centred window');
  assert.equal(plain.seams[0].glyphs, undefined);
  assert.ok(plain.cuts[0].b > plain.seams[0].at + plain.seams[0].dur / 2, 'and no hand-over');
  // mid-window the thumbnail draws the travellers (a shared letter drawn outside both side surfaces, on the tile)
  const { render } = await engineFor(sp, CAT, true);
  const d = render(s.at).draws;
  const tile = new Set(render(s.at).ops.filter((o) => o[1] === 'drawImage').map((o) => o[0]));
  assert.ok(d.some((x) => x.ch === '青' && tile.has(x.canvas)), 'a traveller is drawn on the frame itself');
  // the default still of a seam tile is the middle of its window
  assert.equal(FAC.sampleTime(sp, 'seam'), s.at);
});

test('thumbnail: a weight part is shown on the body face at 800 (the display faces of most themes have one weight)', () => {
  const FAC = MV.use('engine/facade');
  for (const [kind, key] of [['arrive', 'weightGrow'], ['depart', 'weightThin']]) {
    const c = FAC.samplePlan(CAT, { kind, key }, {}).cuts[0];
    assert.deepEqual([c.slots['text.face'].v, c.slots['text.weight'].v], ['body', 800], key);
  }
  const c = FAC.samplePlan(CAT, { kind: 'arrive', key: 'fogIn' }, {}).cuts[0];
  assert.deepEqual([c.slots['text.face'].v, c.slots['text.weight']], ['display', undefined], 'other parts: as before');
});
