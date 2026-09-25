/* 文字PVメーカー v2 — original work. Tests for the engine facade and the Canvas2D renderer on the recording backend (DESIGN §4.19–§4.20). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');
const examples = require('../fixtures/example_parts.js');
const { throwsCode } = require('../helpers/assert_plus.js');

const MV = load();
const REG = MV.use('core/registry');
const FAC = MV.use('engine/facade');
const R = MV.use('engine/render/record');
const SP = MV.use('engine/render/sprites');
const SF = MV.use('engine/render/surface');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const K = MV.use('parts/kit');

const stubReg = corpus.stubRegistry(MV);
const exReg = examples.exampleRegistry(MV);
const W = 640, H = 360;

// --- helpers ------------------------------------------------------------------------------------------------------

// A recorder whose factory remembers every canvas it made (id → { width, height }).
function recorder() {
  const rec = R.createRecorder();
  const sizes = new Map();
  const factory = { create(w, h, o) { const made = rec.factory.create(w, h, o); sizes.set(made.canvas.id, [w, h]); return made; } };
  return Object.assign({}, rec, { factory, sizes, raw: rec });
}

function engineOf(reg, extra) {
  const rec = recorder();
  const engine = FAC.createEngine(Object.assign({ registry: reg || stubReg, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null,
    assets: null, strict: true }, extra || {}));
  return { rec, engine };
}

function surfaceOf(rec, w, h, alpha) {
  const made = rec.factory.create(w || W, h || H, { alpha: alpha !== false });
  return { canvas: made.canvas, ctx: made.ctx, w: w || W, h: h || H };
}

function render(engine, surface, t, opts) {
  return engine.renderFrame(surface, t, Object.assign({ quality: 'export', pick: true, scale: surface.w / engine.plan.design.w }, opts));
}

const ID = /^(c|g|p)\d+$|^tile:/;

// The ops of one frame on frame-sized canvases (the target and the pooled frame surfaces), with every canvas id
// replaced by its size class: two engines with different cache histories must issue exactly these calls.
function frameOps(rec, from, w, h) {
  const frameSize = (id) => { const s = rec.sizes.get(id); return !!s && s[0] === w && s[1] === h; };
  return rec.ops().slice(from).filter((op) => frameSize(op[0]))
    .map((op) => op.slice(1).map((a) => (typeof a === 'string' && ID.test(a) ? (frameSize(a) ? 'F' : 'X') : a)));
}

function names(ops) { return ops.map((op) => op[0]); }

function clone(v) { return JSON.parse(JSON.stringify(v)); }

function balancedClean(rec, where) {
  const s = rec.stats();
  assert.ok(s.balanced, where + ': save/restore balanced (' + s.saves + '/' + s.restores + ')');
  assert.equal(s.nan, 0, where + ': NaN or Infinity passed to the context');
  assert.equal(s.alphaBad, 0, where + ': globalAlpha outside [0, 1]');
}

const FALLBACKS = corpus.minimalFallbacks();

// --- construction and planning ------------------------------------------------------------------------------------

test('createEngine checks its services', () => {
  const rec = recorder();
  throwsCode(() => FAC.createEngine({}), 'bad-args');
  throwsCode(() => FAC.createEngine({ registry: stubReg, measurer: fakeMeasurer() }), 'bad-args');
  throwsCode(() => FAC.createEngine({ registry: stubReg, canvas: rec.factory }), 'bad-args');
  const e = FAC.createEngine({ registry: stubReg, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null });
  assert.equal(e.plan, null);
  const s = surfaceOf(rec);
  assert.deepEqual(e.renderFrame(s, 1, {}), { ms: 0, drawn: { glyphs: 0, shapes: 0, paints: 0, particles: 0 }, passes: 0, provisional: false,
    media: { drawn: 0, waiting: 0, fallback: 0 } });
});

test('setDoc plans once per document and lists the cuts and segments whose fingerprint changed', () => {
  const { engine } = engineOf();
  const doc = corpus.project('basic').doc;
  const first = engine.setDoc(doc);
  assert.equal(first.plan, engine.plan);
  assert.deepEqual(first.changedCuts, first.plan.cuts.map((c) => c.key));
  assert.deepEqual(first.changedGrounds, first.plan.grounds.map((g) => g.key));
  assert.equal(engine.setDoc(doc), first, 'the same document gives the same result');
  const cut = first.plan.cuts.find((c) => c.role === 'lyric');
  const doc2 = clone(doc);
  doc2.pins['cut/' + cut.key + ':text.scale'] = { v: 1.6, by: 'user', sig: cut.text };
  const second = engine.setDoc(doc2);
  assert.ok(second.changedCuts.includes(cut.key));
  assert.ok(second.changedCuts.length < first.plan.cuts.length / 2, 'only the touched cut (and few neighbours) change');
  assert.deepEqual(second.changedGrounds, []);
});

// --- frames --------------------------------------------------------------------------------------------------------------

test('frames are balanced, finite and identical across engines', () => {
  for (const { name, doc } of corpus.projects().slice(0, 3)) {
    const hashes = [];
    for (let k = 0; k < 2; k++) {
      const { rec, engine } = engineOf();
      const { plan } = engine.setDoc(clone(doc));
      const s = surfaceOf(rec);
      const list = [];
      for (let i = 0; i < 24; i++) {
        const m = rec.mark();
        const st = render(engine, s, (plan.duration * (i + 0.5)) / 24);
        assert.equal(typeof st.provisional, 'boolean');
        list.push(rec.hash(m));
      }
      balancedClean(rec, name);
      hashes.push(list);
    }
    assert.deepEqual(hashes[0], hashes[1], name);
    assert.ok(new Set(hashes[0]).size > 10, name + ': frames change over time');
  }
});

test('a frame does not depend on the frames drawn before it', () => {
  const doc = corpus.project('basic').doc;
  const warm = engineOf();
  const plan = warm.engine.setDoc(clone(doc)).plan;
  const times = Array.from({ length: 30 }, (_, i) => (plan.duration * (i + 0.5)) / 30).concat(plan.seams.map((s) => s.at));
  const s = surfaceOf(warm.rec);
  const warmOps = times.map((t) => { const m = warm.rec.mark(); render(warm.engine, s, t); return frameOps(warm.rec, m, W, H); });
  for (const k of [4, 17, 29, times.length - 1]) {
    const fresh = engineOf();
    fresh.engine.setDoc(clone(doc));
    const fs = surfaceOf(fresh.rec);
    const m = fresh.rec.mark();
    render(fresh.engine, fs, times[k]);
    assert.deepEqual(frameOps(fresh.rec, m, W, H), warmOps[k], 'frame at t=' + times[k]);
  }
});

// Two same-grapheme glyphs of different em (du) that land in one size bucket: 'あいあい' emphasizes its first two
// graphemes (1.15 em), so at 640 px the emphasized 'あ' has the device size of the plain 'あ' at 736 px. Blurred, their
// rasters differ (the blur in raster px depends on the em), so a frame must not depend on which one was drawn first.
test('blurred sprites of one grapheme at different em never share a raster (order-independent frames)', () => {
  const plan = FAC.samplePlan(stubReg, {}, { text: 'あいあい' });
  assert.ok(plan.cuts[0].emph.length > 0, 'the sample emphasizes part of the text');
  const t = plan.cuts[0].repT;
  const frame = (sizes) => {
    const { rec, engine } = engineOf();
    engine.setPlan(plan);
    let ops = null;
    for (const [w, h] of sizes) {
      const s = surfaceOf(rec, w, h);
      for (const blur of [1, 3, 6, 12]) {
        const m = rec.mark();
        engine.renderFrame(s, t, { quality: 'preview', scale: w / plan.design.w, probe: { blur } });
        if (w === W) (ops || (ops = [])).push(frameOps(rec, m, W, H));
      }
    }
    return ops;
  };
  const alone = frame([[W, H]]);
  for (const other of [[736, 414], [700, 394], [560, 315]]) {
    assert.deepEqual(frame([other, [W, H]]), alone, 'after a frame at ' + other.join('×'));
  }
  const cache = SP.createSpriteCache(recorder().factory, {});
  const font = { key: 'x:400', css: (px) => '400 ' + px + 'px x' };
  const a = cache.glyph(font, 'あ', '#000000', 'plain', null, 27, 3, 100);
  const b = cache.glyph(font, 'あ', '#000000', 'plain', null, 27, 3, 115);
  assert.notEqual(a, b, 'a blurred raster is keyed by its blur in raster px');
  const fresh = SP.createSpriteCache(recorder().factory, {}).glyph(font, 'あ', '#000000', 'plain', null, 27, 3, 115);
  assert.equal(b.w, fresh.w, 'and drawn exactly as a fresh cache would');
  assert.equal(cache.glyph(font, 'あ', '#000000', 'plain', null, 27, 0, 100), cache.glyph(font, 'あ', '#000000', 'plain', null, 27, 0, 115),
    'level-0 rasters do not depend on the em');
});

// A filter that leaves transparent pixels (chromaSlip's shifted channels leave two corners empty): the target must be
// prepared first, so the frame never shows what the caller's surface held before.
test('the post output lands on a target that is filled with the backdrop (or cleared) first', () => {
  const shifted = K.filter({ key: 'holeShift', label: { ja: 'ずれ', en: 'Shift' }, blurb: { ja: 'ずれ', en: 'Shift' }, stage: 'film',
    cost: 1, passes: 1, alphaSafe: true, apply(fx, src) { const out = fx.take(); out.ctx.drawImage(src.canvas, 40, 30); return out; } });
  const reg = REG.createRegistry([shifted].concat(exReg.all()));
  const cases = [['scene', 'chromaSlip'], ['scene', 'holeShift'], ['black', 'holeShift'], ['chroma', 'holeShift'], ['clear', 'holeShift']];
  for (const [backdrop, key] of cases) {
    const plan = FAC.samplePlan(reg, { kind: 'filter', key, params: { angle: 30, spread: 40, amount: 1 } }, { backdrop });
    const { rec, engine } = engineOf(reg);
    engine.setPlan(plan);
    const s = surfaceOf(rec);
    const m = rec.mark();
    const st = render(engine, s, plan.cuts[0].repT, { backdrop });
    assert.ok(st.passes > 0, backdrop + ' ' + key + ': the filter ran');
    const onTarget = rec.ops().slice(m).filter((op) => op[0] === s.canvas.id).map((op) => op.slice(1));
    const put = onTarget.findIndex((op) => op[0] === 'drawImage');
    assert.ok(put >= 0, backdrop + ': the post output is drawn onto the target');
    const before = onTarget.slice(0, put);
    if (backdrop === 'clear') assert.ok(before.some((op) => op[0] === 'clearRect' && op[3] === W && op[4] === H), 'clear: cleared first');
    else {
      const fill = before.map((op) => op[0]).lastIndexOf('fillRect');
      assert.ok(fill >= 0 && before[fill][3] === W && before[fill][4] === H, backdrop + ': the whole target is filled first');
      const style = before.filter((op) => op[0] === 'set:fillStyle').pop();
      const colour = { scene: plan.look.palette.ground, black: '#000000', chroma: '#00B140' }[backdrop];
      assert.equal(style[1], colour, backdrop + ': with the backdrop colour');
    }
  }
});

test('backdrop modes: clear leaves alpha and skips the ground, chroma and black fill, black turns ink white', () => {
  const { rec, engine } = engineOf();
  const plan = engine.setDoc(corpus.project('basic').doc).plan;
  const cut = plan.cuts.find((c) => c.role === 'lyric');
  const s = surfaceOf(rec);
  const opsOf = (backdrop) => { const m = rec.mark(); const st = render(engine, s, cut.repT, { backdrop }); return { st, ops: rec.ops().slice(m) }; };
  const scene = opsOf('scene'), clear = opsOf('clear'), chroma = opsOf('chroma'), black = opsOf('black');
  assert.ok(clear.ops.some((op) => op[0] === s.canvas.id && op[1] === 'clearRect'), 'clear clears the target');
  assert.ok(clear.st.drawn.paints < scene.st.drawn.paints, 'no ground paint under clear');
  assert.equal(clear.st.passes, 0, 'grainFilm is not alpha-safe, so it is skipped under clear');
  assert.ok(chroma.ops.some((op) => op[1] === 'set:fillStyle' && op[2] === '#00B140'));
  assert.ok(black.ops.some((op) => op[1] === 'set:fillStyle' && op[2] === '#000000'));
  assert.ok(black.ops.some((op) => op[1] === 'set:fillStyle' && op[2] === '#FFFFFF'), 'white ink on black');
  assert.ok(!scene.ops.some((op) => op[1] === 'set:fillStyle' && op[2] === '#00B140'));
});

// --- glyphs ------------------------------------------------------------------------------------------------------------

function countFrameOps(rec, from, name) {
  return rec.ops().slice(from).filter((op) => op[1] === name && rec.sizes.get(op[0]) && rec.sizes.get(op[0])[0] === W).length;
}

test('the glyph path follows the pose only: direct without effects, sprites with blur, the same at every scale', () => {
  const plan = FAC.samplePlan(stubReg, {}, {});
  for (const scale of [360, 1080]) {
    const { rec, engine } = engineOf();
    engine.setPlan(plan);
    const w = Math.round((plan.design.w * scale) / plan.design.h);
    const s = surfaceOf(rec, w, scale);
    const t = plan.cuts[0].repT;
    const sized = (m, name) => rec.ops().slice(m).filter((op) => op[1] === name && op[0] === s.canvas.id).length;
    let m = rec.mark();
    const direct = engine.renderFrame(s, t, { quality: 'preview', probe: { blur: 0.04 } });
    assert.equal(sized(m, 'fillText'), direct.drawn.glyphs, scale + 'p: every glyph is a fillText on the frame');
    const images = sized(m, 'drawImage');                       // the cached ground raster
    m = rec.mark();
    const blurred = engine.renderFrame(s, t, { quality: 'preview', probe: { blur: 0.06 } });
    assert.equal(sized(m, 'fillText'), 0, scale + 'p: blur ≥ 0.05 du takes the sprite path');
    assert.ok(sized(m, 'drawImage') >= images + blurred.drawn.glyphs);
    m = rec.mark();
    engine.renderFrame(s, t, { quality: 'export', probe: { blur: 3 } });
    assert.equal(sized(m, 'fillText'), direct.drawn.glyphs, 'export ignores the lab probe');
  }
});

test('blur crossfades two sprite levels; glow, shard, pixel and echo use sprites too', () => {
  const pair = SP.levelPair(3, {});
  assert.deepEqual(pair, { lo: 1, hi: 2, f: 0.5 });
  assert.deepEqual(SP.levelPair(0.5, {}), { lo: 0, hi: 1, f: 0.25 });
  assert.deepEqual(SP.levelPair(40, {}), { lo: 5, hi: 5, f: 0 });
  assert.equal(SP.bucketPx(SP.bucketOf(150)) / 150 < 1.1, true);
  const plan = FAC.samplePlan(stubReg, {}, {});
  const { rec, engine } = engineOf();
  engine.setPlan(plan);
  const s = surfaceOf(rec);
  for (const probe of [{ blur: 3 }, { glow: 0.5 }, { shard: 0.4 }, { pixel: 6 }]) {
    const m = rec.mark();
    const st = engine.renderFrame(s, plan.cuts[0].repT, { quality: 'preview', probe });
    assert.equal(rec.ops().slice(m).filter((op) => op[0] === s.canvas.id && op[1] === 'fillText').length, 0, JSON.stringify(probe));
    assert.ok(st.drawn.glyphs > 0);
  }
  const m = rec.mark();
  engine.renderFrame(s, plan.cuts[0].repT, { quality: 'preview', probe: { blur: 3 } });
  const alphas = rec.ops().slice(m).filter((op) => op[0] === s.canvas.id && op[1] === 'set:globalAlpha').map((op) => op[2]);
  assert.ok(alphas.includes(0.5), 'blur 3 du = half of level 2 du and half of level 4 du');
  balancedClean(rec, 'effects');
});

test('the glyph cache is bounded in bytes and keyed without per-frame strings', () => {
  const rec = recorder();
  const cache = SP.createSpriteCache(rec.factory, { budget: 4 * 1024 * 1024 });
  const font = { key: 'x:400', css: (px) => '400 ' + px + 'px x' };
  const first = cache.glyph(font, '夜', '#000000', 'plain', null, 28, 0, 100);
  assert.equal(cache.glyph(font, '夜', '#000000', 'plain', null, 28, 0, 100), first, 'a hit returns the same raster');
  for (let k = 0; k < 400; k++) cache.glyph(font, String.fromCharCode(0x4e00 + k), '#000000', 'plain', null, 30, 2, 100);
  assert.ok(cache.bytes <= 4 * 1024 * 1024, 'within the budget');
  assert.ok(first.w <= SP.MAX_SIDE && first.h <= SP.MAX_SIDE);
  const big = cache.glyph(font, '夜', '#000000', 'plain', null, 40, 5, 100);
  assert.ok(big.w <= SP.MAX_SIDE, 'large blurred glyphs are rasterized smaller than 512 px');
});

test('sprite keys hold the inks themselves: thousands of colours never alias', () => {
  const cache = SP.createSpriteCache(recorder().factory, {});
  const font = { key: 'x:400', css: (px) => '400 ' + px + 'px x' };
  const hex = (n) => '#' + n.toString(16).padStart(6, '0').toUpperCase();
  for (let n = 1; n <= 4200; n++) cache.glyph(font, 'い', hex(n), 'plain', null, 8, 0, 100);
  const a = cache.glyph(font, 'あ', hex(2), 'outline', hex(3), 8, 0, 100);
  const b = cache.glyph(font, 'あ', hex(1), 'outline', hex(4099), 8, 0, 100);
  assert.notEqual(a, b, 'different ink pairs, different rasters');
  assert.equal(cache.glyph(font, 'あ', hex(2), 'outline', hex(3), 8, 0, 100), a, 'the same pair hits');
  const small = SP.createSpriteCache(recorder().factory, { budget: 64 * 1024 });
  for (let n = 1; n <= 500; n++) small.glyph(font, 'う', hex(n), 'plain', null, 16, 0, 100);
  assert.ok(small.bytes <= 64 * 1024 && small.count < 500, 'the byte budget holds with many keys');
});

// --- picking -----------------------------------------------------------------------------------------------------------

test('picking: hits are top-first per owner; boxes are the owners\' union quads of the last pick frame', () => {
  const plan = FAC.samplePlan(exReg, { kind: 'ornament', key: 'cornerTicks' }, {});
  const { rec, engine } = engineOf(exReg);
  engine.setPlan(plan);
  const s = surfaceOf(rec);
  render(engine, s, plan.cuts[0].repT);
  const boxes = engine.boxes();
  const text = boxes.find((b) => b.owner === 'text');
  assert.ok(text && text.cut === 'r1~0' && text.line === 'r1');
  assert.ok(text.quad instanceof Float32Array && text.quad.length === 8);
  const cx = (text.quad[0] + text.quad[4]) / 2, cy = (text.quad[1] + text.quad[5]) / 2;
  const hits = engine.hitTest(cx, cy);
  assert.equal(hits[0].owner, 'text');
  assert.equal(hits[0].cut, 'r1~0');
  assert.equal(hits[0].line, 'r1');
  assert.equal(new Set(hits.map((h) => h.cut + h.owner)).size, hits.length, 'one hit per (cut, owner)');
  const tick = boxes.find((b) => b.owner === 'ornament#0');
  assert.ok(tick, 'the corner ticks are pickable shapes');
  assert.deepEqual(engine.hitTest(tick.quad[0] + 1, tick.quad[1] + 1).map((h) => h.owner), ['ornament#0']);
  assert.deepEqual(engine.hitTest(-50, -50), []);
  engine.renderFrame(s, plan.cuts[0].a + 0.001, { quality: 'export', pick: false });
  assert.deepEqual(engine.boxes().map((b) => b.owner), boxes.map((b) => b.owner), 'a frame without picking keeps the last picks');
});

// --- thumbnails and sample plans -------------------------------------------------------------------------------------------

test('thumb renders every part deterministically without touching the preview', () => {
  for (const reg of [stubReg, exReg]) {
    const { rec, engine } = engineOf(reg);
    engine.setDoc(corpus.project('basic').doc);
    const s = surfaceOf(rec);
    render(engine, s, 10);
    const boxes = JSON.stringify(engine.boxes());
    const thumb = surfaceOf(rec, 288, 162);
    for (const def of reg.all()) {
      const run = () => { const m = rec.mark(); engine.thumb({ kind: def.kind, key: def.key }, thumb, {}); return frameOps(rec, m, 288, 162); };
      const a = run();
      assert.ok(a.length > 0, def.kind + '/' + def.key);
      assert.deepEqual(run(), a, def.kind + '/' + def.key + ': a thumbnail is deterministic');
    }
    balancedClean(rec, 'thumbs');
    assert.equal(JSON.stringify(engine.boxes()), boxes, 'thumbnails leave the preview picks alone');
  }
});

test('a transition thumbnail shows the second line it is given (ux-14: no Japanese line on the English page)', () => {
  const seamKey = stubReg.keys('seam')[0] || exReg.keys('seam')[0];
  const reg = stubReg.keys('seam').length ? stubReg : exReg;
  const sp = FAC.samplePlan(reg, { kind: 'seam', key: seamKey }, { text: 'First light', textB: 'Into the light' });
  assert.deepEqual(sp.cuts.map((c) => c.text), ['First light', 'Into the light']);
  assert.deepEqual(FAC.samplePlan(reg, { kind: 'seam', key: seamKey }, {}).cuts.map((c) => c.text), ['はじまりの朝', '光のなかへ'],
    'without textB the canned Japanese pair');
  const { rec, engine } = engineOf(reg);
  const thumb = surfaceOf(rec, 288, 162);
  const texts = () => {
    const m = rec.mark();
    engine.thumb({ kind: 'seam', key: seamKey }, thumb, { text: 'First light', textB: 'Into the light', t: 1.4 });
    return rec.ops().slice(m).filter((op) => op[1] === 'fillText').map((op) => op[2]).join('');
  };
  const drawn = texts();
  assert.ok(!/[光のなかへ]/.test(drawn) && /I/.test(drawn), 'the thumbnail draws only the given lines: ' + drawn);
});

test('samplePlan puts the part in its slot and fallbacks elsewhere, deterministically', () => {
  for (const def of exReg.all()) {
    const a = FAC.samplePlan(exReg, { kind: def.kind, key: def.key }, { aspect: '9:16' });
    assert.equal(JSON.stringify(a), JSON.stringify(FAC.samplePlan(exReg, { kind: def.kind, key: def.key }, { aspect: '9:16' })));
    assert.deepEqual(a.design, { aspect: '9:16', w: 1080, h: 1920, short: 1080 });
    const cut = a.cuts[0];
    if (['arrange', 'arrive', 'dwell', 'depart', 'lens'].includes(def.kind)) assert.equal(cut.slots[def.kind].v, def.key);
    if (def.kind === 'filter') assert.equal(cut.slots['filter#0'].v, def.key);
    if (def.kind === 'ornament') assert.equal(def.scope === 'run' ? a.grounds[0].atmos.v : cut.slots['ornament#0'].v, def.key);
    if (def.kind === 'ground') assert.equal(a.grounds[0].ground.v, def.key);
    if (def.kind === 'seam') { assert.equal(a.seams[0].slot.v, def.key); assert.equal(a.cuts.length, 2); }
    if (def.kind === 'theme') assert.equal(a.look.theme.v, def.key);
    if (def.kind === 'mood') assert.equal(a.look.mood.v, def.key);
    assert.ok(a.env instanceof Float32Array && !Object.keys(a).includes('env'));
  }
  const vertical = FAC.samplePlan(exReg, { kind: 'arrange', key: 'pillarColumns' }, {});
  assert.equal(vertical.cuts[0].slots.orient.v, 'v', 'a vertical-only composition gets a vertical sample');
  assert.equal(FAC.samplePlan(exReg, {}, { text: 'Paper planes', orient: 'v' }).cuts[0].slots.orient.v, 'h', 'Latin text stays horizontal');
});

// --- seams and post ------------------------------------------------------------------------------------------------------

test('a text seam mixes the two text layers; a world seam mixes two whole worlds', () => {
  const { rec, engine } = engineOf();
  engine.setPlan(corpus.planBasic());
  const s = surfaceOf(rec);
  const seam = engine.plan.seams[0];
  let m = rec.mark();
  render(engine, s, seam.at);
  const ops = frameOps(rec, m, W, H);
  const mixed = ops.findIndex((op) => op[0] === 'set:globalAlpha' && op[1] === 0.5);
  assert.ok(mixed >= 0 && ops.slice(mixed).some((op) => op[0] === 'drawImage' && op[1] === 'F'), 'stubCross draws A and B at u = 0.5');

  const world = engineOf(exReg);
  const plan = FAC.samplePlan(exReg, { kind: 'seam', key: 'irisGate' }, {});
  world.engine.setPlan(plan);
  const ws = surfaceOf(world.rec);
  m = world.rec.mark();
  const wst = render(world.engine, ws, plan.seams[0].at);
  assert.equal(wst.drawn.paints, 2, 'one shared ground segment is drawn in both worlds');
  const wops = names(frameOps(world.rec, m, W, H));
  assert.ok(wops.includes('arc') && wops.includes('clip'), 'irisGate clips B to a circle');
  assert.ok(wops.filter((n) => n === 'fillRect').length >= 2, 'both worlds fill their backdrop');
});

// planner/tracks clamps a seam's window below its slot's `dur`; the part must count time over the real window.
test('a transition part gets the length of its window as p.dur', () => {
  const SE = MV.use('engine/render/seam');
  const reg = MV.use('parts/catalog').defaultRegistry();
  const plan = FAC.samplePlan(reg, { kind: 'seam', key: 'glitchSwap', params: { dur: 0.5 } }, {});
  const seams = plan.seams.map((s) => Object.assign({}, s, { dur: 0.21 }));
  const clamped = Object.assign({}, plan, { seams });
  assert.equal(SE.seamPart(clamped, reg, 0).p.dur, 0.21);
  assert.equal(SE.seamPart(plan, reg, 0).p.dur, plan.seams[0].dur);
  assert.ok(Object.isFrozen(SE.seamPart(clamped, reg, 0).p), 'shared, read-only params');
});

test('post: filters run by stage, `when` gates accents, a failing filter is skipped with a warning', () => {
  const plan = FAC.samplePlan(exReg, { kind: 'filter', key: 'chromaSlip' }, {});
  plan.look.texture = { v: 'grainFilm', p: { amount: 0.5, when: 'always' }, from: 'auto' };
  const { rec, engine } = engineOf(exReg);
  engine.setPlan(plan);
  const s = surfaceOf(rec);
  let m = rec.mark();
  const st = render(engine, s, plan.cuts[0].repT);
  const comps = rec.ops().slice(m).filter((op) => op[1] === 'set:globalCompositeOperation').map((op) => op[2]);
  assert.ok(comps.indexOf('multiply') >= 0 && comps.indexOf('overlay') > comps.indexOf('multiply'), 'optic runs before film');
  assert.equal(st.passes, 7 + 2);

  const dim = FAC.samplePlan(stubReg, { kind: 'filter', key: 'stubDim', params: { when: 'arrive', amount: 0.8 } }, {});
  const e2 = engineOf();
  e2.engine.setPlan(dim);
  const s2 = surfaceOf(e2.rec);
  const atop = (t) => { const k = e2.rec.mark(); render(e2.engine, s2, t); return e2.rec.ops().slice(k).some((op) => op[2] === 'source-atop'); };
  assert.equal(atop(dim.cuts[0].t0 + 0.01), true, 'during the entrance');
  assert.equal(atop(dim.cuts[0].b - 0.05), false, 'not while the text holds');

  const broken = K.filter({ key: 'brokenLens', label: { ja: '壊れ', en: 'Broken' }, blurb: { ja: '壊れ', en: 'Broken' }, stage: 'tone',
    cost: 1, passes: 1, alphaSafe: true, apply() { throw new Error('boom'); } });
  const reg = REG.createRegistry([broken].concat(FALLBACKS));
  const e3 = engineOf(reg, { strict: false });
  const bp = FAC.samplePlan(reg, { kind: 'filter', key: 'brokenLens' }, {});
  e3.engine.setPlan(bp);
  const s3 = surfaceOf(e3.rec);
  m = e3.rec.mark();
  const st3 = render(e3.engine, s3, bp.cuts[0].repT);
  assert.ok(st3.drawn.glyphs > 0, 'the frame still draws');
  assert.ok(e3.engine.warnings().some((w) => w.code === 'part-error' && /brokenLens/.test(w.detail)));
  assert.throws(() => { const e4 = engineOf(reg); e4.engine.setPlan(bp); render(e4.engine, surfaceOf(e4.rec), bp.cuts[0].repT); }, /boom/,
    'a strict engine (tests) rethrows');

  // a filter that throws after drawing on the stack's surface (fx.own): the frame is drawn again with every filter
  // copying, so the output holds nothing of it (as a skipped filter never did before fx.own)
  const torn = K.filter({ key: 'tornLens', label: { ja: '破れ', en: 'Torn' }, blurb: { ja: '破れ', en: 'Torn' }, stage: 'tone',
    cost: 1, passes: 1, alphaSafe: true, apply(fx, src) {
      const out = fx.own(src);
      out.ctx.fillStyle = '#FF00FF';
      out.ctx.fillRect(0, 0, 9, 9);
      throw new Error('torn');
    } });
  const tr = REG.createRegistry([torn].concat(FALLBACKS));
  const e5 = engineOf(tr, { strict: false });
  const tp = FAC.samplePlan(tr, { kind: 'filter', key: 'tornLens' }, {});
  e5.engine.setPlan(tp);
  const s5 = surfaceOf(e5.rec);
  m = e5.rec.mark();
  const st5 = render(e5.engine, s5, tp.cuts[0].repT);
  assert.ok(st5.drawn.glyphs > 0);
  const ops5 = e5.rec.ops().slice(m);
  const magenta = ops5.filter((op) => op[1] === 'set:fillStyle' && op[2] === '#FF00FF').map((op) => op[0]);
  assert.equal(magenta.length, 2, 'the filter ran in both passes');
  const puts = ops5.filter((op) => op[0] === s5.canvas.id && op[1] === 'drawImage');
  assert.equal(puts.length, 1, 'one output onto the target');
  assert.equal(magenta[0], puts[0][2], 'the first pass drew on the frame surface itself (pooled: the second pass reuses it)');
  assert.notEqual(magenta[1], puts[0][2], 'the second pass drew on a copy, not on the output');
  // the second pass redrew the frame surface from the start (its first ops after the second pass began)
  const second = ops5.findIndex((op, k) => k > ops5.findIndex((x) => x[1] === 'set:fillStyle' && x[2] === '#FF00FF') &&
    op[0] === puts[0][2]);
  assert.ok(second > 0 && ['clearRect', 'save', 'setTransform', 'fillRect', 'set:globalAlpha', 'set:fillStyle'].includes(ops5[second][1]),
    'the frame surface is drawn anew: ' + JSON.stringify(ops5[second]));
  assert.equal(e5.engine.warnings().filter((w) => w.code === 'part-error' && /tornLens/.test(w.detail)).length, 1);
});

// --- warnings, fonts, prepare ------------------------------------------------------------------------------------------------

function fakeFontBook(state) {
  const calls = { request: 0, ready: 0 };
  let release = null;
  return {
    calls, state,
    request() { calls.request++; },
    ready() { calls.ready++; return new Promise((resolve) => { release = () => resolve({ loaded: [], failed: [] }); }); },
    release: () => release && release(),
    get epoch() { return state.epoch || 0; },
    status: (ref) => (state.failed && state.failed.includes(ref.family) ? 'failed' : state.status || 'ready'),
    on: () => () => {},
  };
}

test('warnings: plan warnings, overfull text, font fallbacks', () => {
  const tiny = K.arrange({ key: 'tinyBox', label: { ja: '小箱', en: 'Tiny box' }, blurb: { ja: '小さい', en: 'Tiny' },
    build(env) {
      const block = env.sb.group({ layer: 'text', owner: 'text' });
      const run = env.sb.text({ parent: block, size: 80, box: { x: 100, y: 100, w: 40, h: 20 }, fit: 'shrink', maxLines: 1, breakAt: 'none' });
      return { runs: [run], focus: env.sb.bounds(block), free: [] };
    } });
  const reg = REG.createRegistry([tiny].concat(FALLBACKS));
  const book = fakeFontBook({ failed: ['Yuji Syuku'] });
  const { rec, engine } = engineOf(reg, { fonts: book });
  const plan = FAC.samplePlan(reg, { kind: 'arrange', key: 'tinyBox' }, { text: '夜明けの街を走るまだ遠い空の色を探して' });
  engine.setPlan(plan);
  render(engine, surfaceOf(rec), plan.cuts[0].repT);
  const w = engine.warnings();
  assert.ok(w.some((x) => x.code === 'overfull' && x.cut === 'r1~0'), 'overfull');
  assert.ok(w.some((x) => x.code === 'font-fallback' && x.detail.family === 'Yuji Syuku'), 'font-fallback');
  assert.ok(book.calls.request > 0, 'the plan\'s faces are requested at once');
});

test('prepare: export waits for the fonts and builds the range; the preview only requests them', async () => {
  const book = fakeFontBook({});
  const { engine } = engineOf(stubReg, { fonts: book });
  const plan = engine.setDoc(corpus.project('basic').doc).plan;
  let done = false;
  const p = engine.prepare(0, plan.duration, { export: true }).then(() => { done = true; });
  await new Promise((r) => setImmediate(r));
  assert.equal(done, false, 'waiting for FontBook.ready');
  assert.equal(book.calls.ready, 1);
  book.release();
  await p;
  assert.equal(done, true);
  assert.ok(engine.stats().scenes > 0);
  const before = book.calls.ready;
  await engine.prepare(0, 5);
  assert.equal(book.calls.ready, before, 'preview prepare never waits');
});

test('scenes built while faces load are provisional and rebuilt once the measurer key moves', () => {
  const state = { status: 'loading', epoch: 0 };
  const book = fakeFontBook(state);
  const base = fakeMeasurer();
  const measurer = { get key() { return 'test:' + state.epoch; }, width: base.width, metrics: base.metrics };
  const { rec, engine } = engineOf(stubReg, { fonts: book, measurer });
  const plan = engine.setDoc(corpus.project('basic').doc).plan;
  const s = surfaceOf(rec);
  const cut = plan.cuts.find((c) => c.role === 'lyric');
  assert.equal(render(engine, s, cut.repT).provisional, true);
  state.status = 'ready'; state.epoch = 1;
  assert.equal(render(engine, s, cut.repT).provisional, false);
});

// --- fork, stats, pool, dispose ------------------------------------------------------------------------------------------------

test('fork is a frozen snapshot with its own caches', () => {
  const { rec, engine } = engineOf();
  const doc = corpus.project('basic').doc;
  const plan = engine.setDoc(doc).plan;
  const f = engine.fork();
  assert.equal(f.plan, plan);
  assert.equal(f.setDoc(doc).plan, plan, 'the fork keeps the document: setDoc(same doc) re-plans nothing');
  engine.setDoc(corpus.project('lrc').doc);
  assert.equal(f.plan, plan, 'later edits do not reach the fork');
  const s = surfaceOf(rec);
  render(f, s, 10);
  assert.deepEqual(engine.boxes(), [], 'the fork\'s picks are its own');
});

// --- DESIGN_2_1: the effective registry, shots and the view -------------------------------------------------------

test('registry getter: the base without materials; a document with materials extends it; a fork keeps that registry', () => {
  const base = MV.use('parts/catalog').defaultRegistry();
  const { rec, engine } = engineOf(base);
  assert.equal(engine.registry, base, 'before a document');
  engine.setDoc(corpus.project('basic').doc);
  assert.equal(engine.registry, base, 'no materials: the base itself (goldens unchanged)');
  const doc = corpus.project('v21').doc;
  const plan = engine.setDoc(doc).plan;
  const eff = engine.registry;
  assert.notEqual(eff, base, 'materials extend the registry');
  assert.ok(eff.get('arrive', 'myMat1') && eff.get('dwell', 'myMat2') && eff.get('ornament', 'myMat3'), 'the materials are parts');
  assert.ok(plan.cuts.some((c) => c.slots.arrive.v === 'myMat1'), 'the pinned material is planned');
  const f = engine.fork();
  assert.equal(f.registry, eff, 'the fork draws with the materials');
  assert.equal(f.setDoc(doc).plan, plan);
  const s = surfaceOf(rec);
  const cut = plan.cuts.find((c) => c.slots.arrive.v === 'myMat1');
  const stats = render(f, s, cut.t0 + 0.2);
  assert.ok(stats.drawn.glyphs > 0 && !f.warnings().some((w) => w.code === 'part-error'), 'the material draws in the fork');
  engine.setDoc(corpus.project('basic').doc);
  assert.equal(engine.registry, base, 'back to the base');
  assert.equal(f.registry, eff, 'the fork is a snapshot');
  // an engine made with an effective registry (as fork does) keeps it until a document says otherwise
  const ext = REG.extend(base, []);
  const { engine: e2 } = engineOf(base, { effective: ext });
  assert.equal(e2.registry, ext);
});

test('shotTrack(cutKey): the resolved keys in absolute time; null without a shot or for an unknown cut', () => {
  const reg = MV.use('parts/catalog').defaultRegistry();
  const { engine } = engineOf(reg);
  const plan = FAC.samplePlan(reg, { kind: 'shot', key: 'pushWord' }, {});
  engine.setPlan(plan);
  const cut = plan.cuts[0];
  const tr = engine.shotTrack(cut.key);
  assert.ok(tr && tr.keys.length === 3, 'pushWord has three keys');
  assert.ok(tr.a <= cut.t0 && tr.b >= cut.t1, 'the window holds the sung span');
  const scene = engine.scene('cut', 0);
  tr.keys.forEach((k, i) => {
    assert.equal(k.t, cut.t0 + scene.shot.keys[i].t, 'absolute time');
    assert.ok(k.zoom >= 0.9 && k.zoom <= 3 && Number.isFinite(k.x) && Number.isFinite(k.y) && Number.isFinite(k.roll));
    assert.ok(k.aim && k.aim.w > 0 && k.aim.h > 0, 'a text aim has its box');
  });
  assert.ok(tr.keys[1].zoom > tr.keys[0].zoom, 'it pushes in');
  assert.equal(engine.shotTrack('nope'), null);
  engine.setPlan(FAC.samplePlan(reg, { kind: 'shot', key: 'none' }, {}));
  assert.equal(engine.shotTrack(cut.key), null, "'none'");
  engine.setPlan(FAC.samplePlan(reg, {}, {}));
  assert.equal(engine.shotTrack(cut.key), null, 'a v1 plan');
});

test('viewAt(t): the text camera as drawn (cut camera with rig and impulses, shake included); the rig alone between cuts', () => {
  const reg = MV.use('parts/catalog').defaultRegistry();
  const { rec, engine } = engineOf(reg);
  assert.deepEqual(engine.viewAt(1), { x: 0, y: 0, zoom: 1, roll: 0 }, 'no plan');
  const F = MV.use('engine/scene/frame');
  const plan = FAC.samplePlan(reg, { kind: 'rig', key: 'climbRise' }, {});
  plan.impulses = [{ t: 1, kind: 'shake', amp: 1, decay: 0.4 }];
  engine.setPlan(plan);
  const cut = plan.cuts[0];
  for (const t of [cut.a + 0.05, 1.02, 1.5, cut.t1]) {
    const scene = engine.scene('cut', 0);
    F.evaluate(scene, t - cut.t0);
    const cam = F.cameraAt(scene, plan, t);
    assert.deepEqual(engine.viewAt(t), { x: cam.x + cam.shakeX, y: cam.y + cam.shakeY, zoom: cam.zoom, roll: cam.roll }, 't=' + t);
  }
  const shaken = engine.viewAt(1.02), still = F.rigCamera(plan, 1.02);
  assert.ok(Math.hypot(shaken.x - still.x, shaken.y - still.y) > 0.1, 'the shake is in the view');
  // after the cut: the rig alone (the ground keeps moving through the interlude)
  const after = cut.b + 0.1;
  const rig = F.rigCamera(plan, after);
  assert.deepEqual(engine.viewAt(after), { x: rig.x + rig.shakeX, y: rig.y + rig.shakeY, zoom: rig.zoom, roll: rig.roll });
  assert.ok(Math.abs(engine.viewAt(after).y) > 1, 'climbRise moves the rig');
  // viewAt does not disturb rendering (the frame's calls on the frame-sized canvases, as in the fork tests)
  const s = surfaceOf(rec);
  render(engine, s, 1.5);
  const m = rec.mark();
  render(engine, s, 1.5);
  const ops = frameOps(rec, m, W, H);
  engine.viewAt(0.3);
  const m2 = rec.mark();
  render(engine, s, 1.5);
  assert.deepEqual(frameOps(rec, m2, W, H), ops);
});

test('thumb() of camera presets: shot and rig tiles are deterministic and differ from the plain sample', () => {
  const reg = MV.use('parts/catalog').defaultRegistry();
  const { rec, engine } = engineOf(reg);
  const s = surfaceOf(rec, 240, 135);
  const tile = (ref) => {
    const m = rec.mark();
    const st = engine.thumb(ref, s, { aspect: '16:9' });
    assert.ok(st.drawn.glyphs > 0, JSON.stringify(ref));
    return JSON.stringify(frameOps(rec, m, 240, 135));
  };
  const plain = tile({ kind: 'arrange', key: reg.fallback('arrange') });
  for (const ref of [{ kind: 'shot', key: 'pushWord' }, { kind: 'shot', key: 'sweepAcross' }, { kind: 'rig', key: 'leanTilt' }]) {
    const a = tile(ref);
    assert.equal(tile(ref), a, 'deterministic: ' + ref.key);
    assert.notEqual(a, plain, ref.key + ' shows its camera');
  }
});

test('stats and the adaptive preview: slow frames step down one level at a time, export never degrades', () => {
  let step = 10, clock = 0;
  const now = () => (clock += step);
  const { rec, engine } = engineOf(stubReg, { now });
  const plan = engine.setDoc(corpus.project('basic').doc).plan;
  const s = surfaceOf(rec);
  const t = plan.cuts[3].repT;
  for (let i = 0; i < 40; i++) render(engine, s, t, { quality: 'preview' });
  assert.equal(engine.stats().level, 1, 'after 30 slow frames');
  for (let i = 0; i < 200; i++) render(engine, s, t, { quality: 'preview' });
  assert.equal(engine.stats().level, 4);
  assert.equal(render(engine, s, t, { quality: 'export' }).level, 0, 'export renders at full quality');
  step = 1;
  for (let i = 0; i < 80; i++) render(engine, s, t, { quality: 'preview' });
  assert.equal(engine.stats().level, 3, 'after 60 frames under 9 ms one level back up');
  const st = engine.stats();
  for (const k of ['frameMs', 'stageMs', 'spriteBytes', 'surfaces', 'scenes']) assert.ok(k in st, k);
  assert.ok(st.frameMs > 0 && st.stageMs.draw > 0);
});

test('the surface pool stays within the §7.2 bound over a whole song', () => {
  const { rec, engine } = engineOf(exReg);
  const plan = FAC.samplePlan(exReg, { kind: 'seam', key: 'irisGate' }, {});
  plan.look.texture = { v: 'grainFilm', p: { amount: 0.5, when: 'always' }, from: 'auto' };
  plan.cuts[1].slots['filter.count'] = { v: 1, from: 'auto' };
  plan.cuts[1].slots['filter#0'] = { v: 'chromaSlip', p: { amount: 0.8, when: 'always', spread: 20, angle: 0, kick: 1 }, from: 'auto' };
  engine.setPlan(plan);
  const s = surfaceOf(rec);
  for (let i = 0; i < 90; i++) render(engine, s, (plan.duration * i) / 90);
  assert.ok(engine.stats().surfaces <= SF.LIMIT_SMALL, 'surfaces: ' + engine.stats().surfaces);
  balancedClean(rec, 'pool');
});

test('the surface pool stays bounded while the output size keeps changing (a resized preview)', () => {
  const { rec, engine } = engineOf(exReg);
  const plan = FAC.samplePlan(exReg, { kind: 'filter', key: 'chromaSlip', params: { angle: 30, spread: 20 } }, {});
  plan.look.texture = { v: 'grainFilm', p: { amount: 0.5, when: 'always' }, from: 'auto' };
  engine.setPlan(plan);
  let most = 0;
  for (let k = 0; k < 60; k++) {
    const w = 320 + 8 * k, h = Math.round((w * 9) / 16);
    render(engine, surfaceOf(rec, w, h), plan.cuts[0].repT);
    const st = engine.stats();
    most = Math.max(most, st.surfaces);
    assert.ok(st.surfaceBytes <= SF.LIMIT_SMALL * w * h * 4, w + '×' + h + ': ' + st.surfaceBytes + ' bytes in the pool');
  }
  assert.ok(most <= SF.LIMIT_SMALL, 'at most ' + SF.LIMIT_SMALL + ' surfaces at any size, saw ' + most);
  const pool = SF.createPool(recorder().factory);
  pool.frame(100, 50);
  const a = pool.take(), b = pool.take(50, 25);
  pool.frame(120, 60);                               // a surface still out when the size changes is not kept either
  pool.give(a); pool.give(b);
  assert.deepEqual([pool.stats().live, pool.stats().bytes], [0, 0]);
  pool.frame(120, 60);
  pool.give(pool.take());
  assert.equal(pool.stats().live, 1, 'the current size is pooled');
  pool.frame(200, 100);
  const held = Array.from({ length: SF.LIMIT_SMALL }, () => pool.take());
  pool.frame(210, 100);
  held.forEach((x) => pool.give(x));
  const again = Array.from({ length: SF.LIMIT_SMALL + 2 }, () => pool.take());
  again.forEach((x) => pool.give(x));
  assert.equal(pool.stats().live, SF.LIMIT_SMALL + 2, 'surfaces of the old size no longer count against the limit');
});

test('dispose releases the engine; later calls throw', () => {
  const { rec, engine } = engineOf();
  engine.setDoc(corpus.project('basic').doc);
  engine.dispose();
  engine.dispose();
  throwsCode(() => engine.renderFrame(surfaceOf(rec), 1, {}), 'disposed');
  throwsCode(() => engine.setDoc(corpus.project('basic').doc), 'disposed');
});

// --- the other draw paths, with small parts made for these tests ----------------------------------------------------

const L = (ja, en) => ({ ja, en });

function centred(env) {
  const { D, sb } = env;
  const block = sb.group({ layer: 'text', owner: 'text' });
  const run = sb.text({ parent: block, size: 120, box: { x: D.w * 0.15, y: D.h * 0.35, w: D.w * 0.7, h: D.h * 0.3 } });
  return { block, run };
}

const TEST_PARTS = [
  K.arrange({ key: 'layeredText', label: L('重ね', 'Layered'), blurb: L('層の合成', 'Layer compositing'),
    build(env) {
      const { D, sb } = env;
      const { block, run } = centred(env);
      sb.shape({ layer: 'far', owner: 'text', path: K.shape.rect(0, 0, D.w, D.h), fill: 'shiftA' });
      sb.shape({ layer: 'mid', owner: 'text', path: K.shape.ellipse(D.cx, D.cy, 200, 120), fill: 'accent' });
      sb.layer('far', { mask: { layer: 'text' } });
      sb.layer('text', { blend: 'multiply', opacity: 0.8 });
      sb.layer('mid', { cache: 'static' });
      const focus = sb.bounds(block);
      return { runs: [run], focus, free: sb.freeAround(focus) };
    } }),
  K.arrive({ key: 'wipeReveal', label: L('ワイプ', 'Wipe'), blurb: L('左から現れる', 'Wipes in'),
    ...K.moves({ unit: 'glyph', tracks: { reveal: [0, 1] } }) }),
  K.ornament({ key: 'dotSnow', label: L('粒', 'Dots'), blurb: L('粒が降る', 'Falling dots'), scope: 'cut', follow: 'own',
    build(env) {
      const { sb, D } = env;
      const field = { area: { x: 0, y: 0, w: D.w, h: D.h }, vy: 40, sway: 10, size: [6, 12], life: [2, 4] };
      sb.particles({ layer: 'near', owner: env.owner, n: 40, sprite: K.shape.ellipse(0, 0, 0.5, 0.5), ink: 'accent', field });
      sb.particles({ layer: 'near', owner: env.owner, n: 10, sprite: 'glyph:✦', ink: 'ink', field });
    } }),
  K.ground({ key: 'photoFill', label: L('写真', 'Photo'), blurb: L('画像の背景', 'An image ground'), animated: false,
    build(env) { env.sb.image({ layer: 'ground', owner: env.owner, asset: 'p1', fit: 'cover', x: 0, y: 0, w: env.D.w, h: env.D.h }); } }),
];

function testRegistry(extra) { return REG.createRegistry(TEST_PARTS.concat(extra || [], FALLBACKS)); }

test('isolated layers: blend and opacity, a text mask, a static raster that is drawn once', () => {
  const reg = testRegistry();
  const { rec, engine } = engineOf(reg);
  const plan = FAC.samplePlan(reg, { kind: 'arrange', key: 'layeredText' }, {});
  engine.setPlan(plan);
  const s = surfaceOf(rec);
  let m = rec.mark();
  render(engine, s, plan.cuts[0].repT);
  const comps = rec.ops().slice(m).filter((op) => op[1] === 'set:globalCompositeOperation').map((op) => op[2]);
  assert.ok(comps.includes('multiply'), 'the text layer is composited with its blend');
  assert.ok(comps.includes('destination-in'), 'the far layer is masked by the text');
  const alphas = rec.ops().slice(m).filter((op) => op[1] === 'set:globalAlpha').map((op) => op[2]);
  assert.ok(alphas.includes(0.8), 'layer opacity');
  const rasters = (from) => rec.ops().slice(from).filter((op) => op[1] === 'ellipse').length;
  assert.equal(rasters(m), 1, 'the static mid layer is rasterized once');
  m = rec.mark();
  render(engine, s, plan.cuts[0].repT + 0.3);
  assert.equal(rasters(m), 0, '… and then only placed');
  balancedClean(rec, 'layers');
});

test('reveal clips per glyph; overfull runs clip to their box; particles and images draw', () => {
  const reg = testRegistry();
  const assets = { get: (id) => (id === 'p1' ? { width: 400, height: 300, id: 'photo' } : null) };
  const { rec, engine } = engineOf(reg, { assets });
  const s = surfaceOf(rec);
  const wipe = FAC.samplePlan(reg, { kind: 'arrive', key: 'wipeReveal', params: { dur: 1, each: 0 } }, {});
  engine.setPlan(wipe);
  let m = rec.mark();
  const st = render(engine, s, wipe.cuts[0].t0);
  const onFrame = (name) => rec.ops().slice(m).filter((op) => op[0] === s.canvas.id && op[1] === name).length;
  assert.equal(onFrame('clip'), st.drawn.glyphs, 'one reveal clip per glyph while it wipes in');
  m = rec.mark();
  render(engine, s, wipe.cuts[0].t1);
  assert.equal(onFrame('clip'), 0, 'no clip once revealed');

  const snow = FAC.samplePlan(reg, { kind: 'ornament', key: 'dotSnow' }, {});
  engine.setPlan(snow);
  const ps = render(engine, s, snow.cuts[0].repT);
  assert.ok(ps.drawn.particles > 30 && ps.drawn.particles <= 50, 'particles: ' + ps.drawn.particles);

  const photo = FAC.samplePlan(reg, { kind: 'ground', key: 'photoFill' }, {});
  engine.setPlan(photo);
  m = rec.mark();
  render(engine, s, photo.cuts[0].repT);
  assert.ok(rec.ops().slice(m).some((op) => op[1] === 'drawImage' && op[2] === 'photo'), 'the asset is drawn');
  balancedClean(rec, 'paths');
});

test('the FxContext: blurred copies, textAt within its budget, flash impulses softened by reduceFlash', () => {
  const seen = [];
  const bloom = K.filter({ key: 'softBloom', label: L('にじみ', 'Bloom'), blurb: L('にじむ', 'Blooms'), stage: 'light', cost: 3, passes: 3,
    alphaSafe: true, apply(fx, src, p, t) {
      seen.push(fx.impulse('flash', t));
      const b = fx.blurred(src, 6), out = fx.take();
      out.ctx.drawImage(src.canvas, 0, 0);
      out.ctx.globalCompositeOperation = 'lighter';
      out.ctx.globalAlpha = 0.3 * p.amount;
      out.ctx.drawImage(b.canvas, 0, 0);
      fx.give(b);
      return out;
    } });
  const trail = K.filter({ key: 'ghostTrail', label: L('残像', 'Trail'), blurb: L('残像', 'Trail'), stage: 'optic', cost: 2, passes: 4,
    alphaSafe: true, needs: ['textAt'], apply(fx, src, p) {
      const out = fx.take();
      out.ctx.drawImage(src.canvas, 0, 0);
      for (let k = 1; k <= p.copies; k++) { const g = fx.textAt(0.05 * k); out.ctx.drawImage(g.canvas, 0, 0); fx.give(g); }
      return out;
    }, params: { copies: { type: 'int', min: 1, max: 4, label: L('数', 'Copies'), auto: { value: 3 } } } });
  const reg = testRegistry([bloom, trail]);
  const { rec, engine } = engineOf(reg, { strict: false });
  const s = surfaceOf(rec);
  const plan = FAC.samplePlan(reg, { kind: 'filter', key: 'softBloom' }, {});
  plan.impulses = [{ t: plan.cuts[0].t0, kind: 'flash', amp: 1, decay: 0.3 }];
  engine.setPlan(plan);
  const t = plan.cuts[0].t0 + 0.1;
  let m = rec.mark();
  render(engine, s, t, { quality: 'preview' });
  assert.ok(rec.ops().slice(m).some((op) => op[1] === 'set:filter' && /^blur\(/.test(op[2])), 'fx.blurred uses a small blurred copy');
  render(engine, s, t, { quality: 'preview', reduceFlash: true });
  render(engine, s, t, { quality: 'export', reduceFlash: true });
  assert.ok(seen[1] < seen[0] && seen[2] === seen[0], 'reduceFlash softens flashes in the preview only: ' + seen);

  for (const [copies, ok] of [[3, true], [4, false]]) {
    const tp = FAC.samplePlan(reg, { kind: 'filter', key: 'ghostTrail', params: { copies } }, {});
    const e = engineOf(reg, { strict: false });
    e.engine.setPlan(tp);
    const es = surfaceOf(e.rec);
    const st = render(e.engine, es, tp.cuts[0].repT);
    const failed = e.engine.warnings().some((w) => w.code === 'part-error' && /text-at|at most 3/.test(w.detail));
    assert.equal(!failed, ok, copies + ' textAt calls');
    assert.ok(st.drawn.glyphs > 0);
    balancedClean(e.rec, 'textAt');
  }
});

// Additive FxContext members (NOTES ## INT-LEAD): the frame palette after the backdrop rule, and the reduce-flash factor
// that parts apply to the flashes they make themselves (flashPop, invertBlink, whiteFlash).
test('the FxContext carries the frame palette (black backdrop included) and the reduce-flash factor', () => {
  const seen = [];
  const probe = K.filter({ key: 'palProbe', label: L('色', 'Palette'), blurb: L('色を読む', 'Reads the palette'), stage: 'film', cost: 1,
    passes: 1, alphaSafe: true, apply(fx, src) { seen.push({ pal: fx.pal, flash: fx.flashScale }); return src; } });
  const reg = testRegistry([probe]);
  const { rec, engine } = engineOf(reg);
  const s = surfaceOf(rec);
  const plan = FAC.samplePlan(reg, { kind: 'filter', key: 'palProbe' }, {});
  engine.setPlan(plan);
  const t = plan.cuts[0].repT;
  render(engine, s, t, { quality: 'preview' });
  render(engine, s, t, { quality: 'preview', reduceFlash: true });
  render(engine, s, t, { quality: 'export', reduceFlash: true });
  render(engine, s, t, { quality: 'export', backdrop: 'black' });
  assert.equal(seen.length, 4);
  assert.deepEqual(seen.map((x) => x.flash), [1, 0.3, 1, 1], 'reduceFlash dims the preview only');
  assert.equal(seen[0].pal.accent, plan.look.palette.accent, 'the plan palette in scene mode');
  assert.equal(seen[3].pal.ground.toUpperCase(), '#000000', 'black mode: the palette the paints draw with');
  assert.equal(seen[3].pal.ink.toUpperCase(), '#FFFFFF');
});

test('preview prepare makes the sprites of the frames after the playhead, so those frames rasterize nothing', async () => {
  const { rec, engine } = engineOf(exReg);
  const plan = FAC.samplePlan(exReg, { kind: 'arrive', key: 'inkRise' }, {});
  engine.setPlan(plan);
  await engine.prepare(0, plan.duration);
  assert.equal(engine.stats().spritesMade, 0, 'no frame yet: the output scale is unknown');
  const s = surfaceOf(rec);
  render(engine, s, plan.cuts[0].t1, { quality: 'preview' });
  assert.equal(engine.stats().spritesMade, 0, 'at rest every glyph is on the direct path');
  render(engine, s, 0, { quality: 'preview' });              // the playhead goes back to the blurred entrance
  const drawn = engine.stats().spritesMade;
  await engine.prepare(0, plan.duration);
  const warmed = engine.stats().spritesMade;
  assert.ok(warmed > drawn, 'inkRise needs blur: the sprites of the frames ahead are made in prepare');
  for (let t = 1 / 30; t <= 1.5; t += 1 / 30) render(engine, s, t, { quality: 'preview' });
  assert.equal(engine.stats().spritesMade, warmed, 'the entrance then plays without making a sprite');
  // the same frames on an engine that did not prepare make them while they play
  const cold = engineOf(exReg);
  cold.engine.setPlan(plan);
  const cs = surfaceOf(cold.rec);
  for (let t = 0; t <= 1.5; t += 1 / 30) render(cold.engine, cs, t, { quality: 'preview' });
  assert.equal(cold.engine.stats().spritesMade, warmed, 'the warm-up made exactly the sprites the frames draw');
});

// perf-1: the warm-up covers every key the draw path asks for — size buckets that move with scaling motions and zooming
// cameras, blur levels 4–5, the pixel and echo paths, tint and halo inks — so playback does not rasterize in frames.
test('playback after prepare rasterizes (almost) no glyph sprite inside a frame (catalog, project_vertical, 720p)', async () => {
  const reg = MV.use('parts/catalog').defaultRegistry();
  const doc = corpus.project('vertical').doc;
  // prepare as the stage does: around the playhead, again once it has moved half a window (ui/boot installPrepare)
  async function play(spriteBudget, t0, seconds) {
    const { rec, engine } = engineOf(reg, { strict: false, spriteBudget });
    const plan = engine.setDoc(clone(doc)).plan;
    const s = surfaceOf(rec, 720, 1280);
    const opts = { quality: 'preview', pick: true, scale: 720 / plan.design.w };
    engine.renderFrame(s, t0, opts);
    let center = t0;
    await engine.prepare(t0 - 5, t0 + 5);
    const perFrame = [];
    for (let i = 1; i <= seconds * 30; i++) {
      const t = t0 + i / 30;
      if (t - center >= 2.5) { center = t; await engine.prepare(t - 5, t + 5); }
      const before = engine.stats().spritesMade;
      engine.renderFrame(s, t, opts);
      perFrame.push(engine.stats().spritesMade - before);
    }
    return { plan, perFrame, made: engine.stats().spritesMade };
  }
  // with room for every sprite, what the frames draw is exactly what the warm-up made: no frame makes one
  for (const t0 of [5, 11, 13.5]) {
    const r = await play(1024 * 1024 * 1024, t0, 3);
    assert.ok(r.made > 50, 'the stretch draws blurred and zooming glyphs (' + r.made + ' sprites)');
    assert.deepEqual(r.perFrame.filter((n) => n > 0), [], 'from ' + t0 + ' s: no sprite is made inside a frame');
  }
  // at the §7.3 budget the whole song plays with at most 2 new sprites in any frame (it was up to 32)
  const whole = await play(undefined, 0, 22);
  assert.ok(whole.perFrame.length > 600);
  assert.ok(Math.max(...whole.perFrame) <= 2, 'most sprites made in one frame: ' + Math.max(...whole.perFrame));
});

// A textAt filter at adaptive level 1 runs at half size: its text copies must be half-size surfaces drawn at half scale.
test('fx.textAt matches the FxContext size when a filter runs at half resolution', () => {
  const seen = [];
  const echoText = K.filter({ key: 'echoText', label: L('残像', 'Echo'), blurb: L('残像', 'Echo'), stage: 'optic', cost: 3, passes: 2,
    alphaSafe: true, needs: ['textAt'], apply(fx, src) {
      const g = fx.textAt(0.1);
      seen.push({ copy: [g.w, g.h], fx: [fx.w, fx.h], unit: fx.unit, id: g.canvas.id });
      const out = fx.take();
      out.ctx.drawImage(src.canvas, 0, 0);
      out.ctx.drawImage(g.canvas, 0, 0);
      fx.give(g);
      return out;
    } });
  const reg = testRegistry([echoText]);
  const plan = FAC.samplePlan(reg, { kind: 'filter', key: 'echoText' }, {});
  const identity = (op) => op[2] === 1 && op[3] === 0 && op[4] === 0 && op[5] === 1 && op[6] === 0 && op[7] === 0;
  const scaleOn = (rec, id, from) => Math.max(...rec.ops().slice(from)
    .filter((op) => op[0] === id && op[1] === 'setTransform' && !identity(op)).map((op) => Math.hypot(op[2], op[3])));
  const run = (level) => {
    const { rec, engine } = engineOf(reg);
    engine.setPlan(plan);
    engine.setLevel(level);
    const m = rec.mark();
    render(engine, surfaceOf(rec), plan.cuts[0].repT, { quality: 'preview' });
    const last = seen[seen.length - 1];
    return { last, scale: scaleOn(rec, last.id, m) };
  };
  const full = run(0), half = run(1);
  assert.deepEqual(full.last.copy, [W, H]);
  assert.deepEqual(half.last.copy, half.last.fx, 'the copy has the size of the half-resolution surfaces');
  assert.deepEqual(half.last.fx, [W / 2, H / 2]);
  assert.ok(Math.abs(half.scale - full.scale / 2) < 1e-3, 'drawn at half scale: ' + half.scale + ' vs ' + full.scale);
});

test('text style glow: a steady halo sprite under a glyph whose body stays on the direct path at rest', () => {
  const plan = FAC.samplePlan(stubReg, {}, {});
  plan.cuts[0].slots['text.style'] = { v: 'glow', from: 'auto' };
  const { rec, engine } = engineOf();
  engine.setPlan(plan);
  const s = surfaceOf(rec);
  const m = rec.mark();
  const st = engine.renderFrame(s, plan.cuts[0].repT, { quality: 'preview' });
  const ops = rec.ops().slice(m).filter((op) => op[0] === s.canvas.id);
  assert.equal(ops.filter((op) => op[1] === 'fillText').length, st.drawn.glyphs, 'every body is a fillText (direct path)');
  assert.ok(ops.some((op) => op[1] === 'set:globalCompositeOperation' && op[2] === 'lighter'), 'the halo is added with lighter');
  assert.ok(ops.filter((op) => op[1] === 'drawImage').length >= st.drawn.glyphs, 'one halo sprite per glyph');
  const m2 = rec.mark();
  engine.renderFrame(s, plan.cuts[0].repT, { quality: 'preview', probe: { blur: 1 } });
  assert.equal(rec.ops().slice(m2).filter((op) => op[0] === s.canvas.id && op[1] === 'fillText').length, 0, 'blurred: sprites');
});

// §4.14: export waits for every face and character used — including text the parts lay out in other faces (a credit
// in the body face, a mark in the serif face) and glyph particles, none of which is the cut's own text.
test('font usage comes from what the scenes lay out; export prepare waits for all of it', async () => {
  const credit = K.arrange({ key: 'creditCard', label: L('クレジット', 'Credit'), blurb: L('名前つき', 'With a credit'),
    build(env) {
      const { D, sb } = env;
      const { block, run } = centred(env);
      sb.text({ parent: block, size: 40, box: { x: D.w * 0.2, y: D.h * 0.7, w: D.w * 0.6, h: 60 }, text: '楽団名', face: 'body' });
      sb.text({ parent: block, size: 40, box: { x: D.w * 0.2, y: D.h * 0.1, w: 80, h: 60 }, text: '序', face: 'serif' });
      const focus = sb.bounds(block);
      return { runs: [run], focus, free: sb.freeAround(focus) };
    } });
  const sparks = K.ornament({ key: 'kanaSparks', label: L('字の粒', 'Glyph sparks'), blurb: L('字が舞う', 'Glyphs float'), scope: 'cut',
    follow: 'own', build(env) {
      const field = { area: { x: 0, y: 0, w: env.D.w, h: env.D.h }, vy: 20, sway: 10, size: [20, 30], life: [2, 4] };
      env.sb.particles({ layer: 'near', owner: env.owner, n: 6, sprite: 'glyph:煌', ink: 'accent', field });
    } });
  const reg = testRegistry([credit, sparks]);
  const plan = FAC.samplePlan(reg, { kind: 'ornament', key: 'kanaSparks' }, {});
  plan.cuts[0].slots.arrange = { v: 'creditCard', p: { offsetX: 0, offsetY: 0 }, from: 'auto' };
  plan.cuts[0].note = '座長';
  const fam = (role) => MV.use('engine/text/faces').fontFor(plan.look.faces, role, 'ja').family;
  const calls = { ready: [], request: [] };
  const book = {
    request(refs, text) { calls.request.push(text); },
    ready(refs, text) { calls.ready.push({ families: refs.map((r) => r.family), text }); return Promise.resolve({ loaded: refs, failed: [] }); },
    get epoch() { return 0; }, status: () => 'ready', on: () => () => {},
  };
  const { rec, engine } = engineOf(reg, { fonts: book });
  engine.setPlan(plan);
  const before = engine.fontUsage(0, plan.duration).textByFamily;
  assert.ok(before[fam('body')].includes('座') && before[fam('body')].includes('長'), 'notes count before any scene is built');
  assert.ok(!(before[fam('serif')] || '').includes('序'), 'the serif mark is not known yet');
  await engine.prepare(0, plan.duration, { export: true });
  assert.equal(calls.ready.length, 1);
  const got = calls.ready[0].text;
  for (const ch of '楽団名') assert.ok(got[fam('body')].includes(ch), 'body face: ' + ch);
  assert.ok(got[fam('serif')].includes('序'), 'serif face: 序');
  assert.ok(got[fam('display')].includes('煌'), 'glyph particles: 煌 in the display face');
  assert.ok(got[fam('display')].includes('は'), 'the lyric itself');
  const after = engine.fontUsage(0, plan.duration).textByFamily;
  assert.ok(after[fam('serif')].includes('序'), 'fontUsage knows the built scenes');

  const preview = engineOf(reg, { fonts: book });
  calls.request.length = 0;
  preview.engine.setPlan(plan);
  render(preview.engine, surfaceOf(preview.rec), plan.cuts[0].repT);
  assert.ok(calls.request.some((t) => (t[fam('serif')] || '').includes('序')), 'the preview asks for a face a scene revealed');
  const fork = preview.engine.fork();
  calls.ready.length = 0;
  await fork.prepare(0, plan.duration, { export: true });
  assert.ok(calls.ready[0].text[fam('serif')].includes('序'), 'a fork starts from the usage its source learned');
  balancedClean(rec, 'usage');
});

test('preview prepare works in slices through the idle hook and gives way to a newer prepare', async () => {
  let clock = 0;
  const now = () => (clock += 3);
  const log = [];
  const idle = () => { log.push('yield'); return new Promise((r) => setImmediate(r)); };
  const sliced = engineOf(stubReg, { now, idle });
  const doc = corpus.project('long').doc;
  const plan = sliced.engine.setDoc(clone(doc)).plan;
  await sliced.engine.prepare(0, 40);
  const yields = log.length;
  assert.ok(yields >= 3, 'the work was split: ' + yields + ' yields');
  const whole = engineOf(stubReg, { now: null });
  whole.engine.setDoc(clone(doc));
  await whole.engine.prepare(0, 40);
  assert.equal(sliced.engine.stats().scenes, whole.engine.stats().scenes, 'the same scenes, sliced or not');
  assert.deepEqual(sliced.engine.warnings(), whole.engine.warnings(), 'the same warnings');

  const fresh = engineOf(stubReg, { now, idle });
  fresh.engine.setDoc(clone(doc));
  log.length = 0;
  const first = fresh.engine.prepare(0, 40).then(() => log.push('first done'));
  const second = fresh.engine.prepare(plan.duration - 40, plan.duration).then(() => log.push('second done'));
  await Promise.all([first, second]);
  assert.ok(log.indexOf('first done') < log.indexOf('second done'), 'the older prepare stops at its next slice');
  assert.ok(log.indexOf('first done') <= 2, 'right away: ' + log.join(' '));
});

test('export prepare: faces that fail while it waits leave final (not provisional) scenes', async () => {
  const state = { status: 'loading' };
  const book = {
    request() {}, get epoch() { return 0; }, status: () => state.status, on: () => () => {},
    ready(refs) { state.status = 'failed'; return Promise.resolve({ loaded: [], failed: refs }); },
  };
  const { rec, engine } = engineOf(stubReg, { fonts: book });
  const plan = FAC.samplePlan(stubReg, {}, {});                 // few scenes: the ones built before the wait stay cached
  engine.setPlan(plan);
  await engine.prepare(0, plan.duration, { export: true });
  assert.equal(render(engine, surfaceOf(rec), plan.cuts[0].repT).provisional, false, 'the fallback layout is final');
  assert.ok(engine.warnings().some((w) => w.code === 'font-fallback'), 'and the fallback is reported');
});

// ---- final fixes (engine) --------------------------------------------------------------------------------------------

test("post 'when' weights: 'arrive' holds to the sung start on an instant entrance, 'depart' peaks by the sung end", () => {
  const PO = MV.use('engine/render/post');
  const info = { tl: 0, dur: 2, impact: false, energy: 0.5 };
  const w = (when, tl, times) => PO.whenWeight(when, tl, 0, times, info, () => null);
  // an instant entrance rests at a − t0 = −lead: the effect is still full at the sung start and fades over 0.2 s after
  const instant = { a: -0.12, rest: -0.12, out: 1.6, b: 2.25 };
  assert.equal(w('arrive', -0.05, instant), 1);
  assert.equal(w('arrive', 0, instant), 1, 'full at the sung start (was 0.4)');
  assert.ok(Math.abs(w('arrive', 0.1, instant) - 0.5) < 1e-9);
  assert.equal(w('arrive', 0.25, instant), 0);
  // a long entrance keeps its own rest time
  const slow = { a: -0.12, rest: 0.6, out: 1.6, b: 2.25 };
  assert.equal(w('arrive', 0.6, slow), 1);
  assert.ok(Math.abs(w('arrive', 0.7, slow) - 0.5) < 1e-9);
  // an exit a seam replaced ends at b = t1 + tail: the effect rises toward the sung end, where the cut hands over
  const replaced = { a: -0.12, rest: 0.4, out: 2.25, b: 2.25 };
  assert.equal(w('depart', 1.7, replaced), 0);
  assert.ok(Math.abs(w('depart', 1.9, replaced) - 0.5) < 1e-9, 'rising before the sung end (was 0 until 2.05)');
  assert.equal(w('depart', 2, replaced), 1);
  // an ordinary exit that starts before the sung end is unchanged
  assert.ok(Math.abs(w('depart', 1.5, instant) - 0.5) < 1e-9);
  assert.equal(w('depart', 1.6, instant), 1);
});

test('in a text transition the background eases from the old cut\'s camera to the new one\'s (no jump mid-window)', () => {
  const reg = MV.use('parts/catalog').defaultRegistry();
  const plan = FAC.samplePlan(reg, { kind: 'seam', key: 'blendDissolve' }, {});
  // A pans right, B pans left: switching cameras at u = 0.5 moved the ground by their difference in one frame
  plan.cuts[0].slots.lens = { v: 'panSweep', p: { amount: 1, dir: 'right', dist: 0.25 }, from: 'pin' };
  plan.cuts[1].slots.lens = { v: 'panSweep', p: { amount: 1, dir: 'left', dist: 0.25 }, from: 'pin' };
  plan.cuts.forEach((c, i) => { c.fp += ':pan' + i; });
  plan.grounds[0].ground = { v: 'gridPaper', p: { amount: 0.6 }, from: 'pin' };
  plan.grounds[0].fp += ':grid';
  const { rec, engine } = engineOf(reg, { strict: false });
  engine.setPlan(plan);
  const s = surfaceOf(rec, 640, 360);
  const seam = plan.seams[0];
  assert.equal(seam.scope, 'text');
  const groundX = (t) => {                           // the static ground raster is placed with the ground's camera
    const m = rec.mark();
    engine.renderFrame(s, t, { quality: 'export', pick: false, scale: 640 / plan.design.w });
    const ops = rec.ops().slice(m);
    const j = ops.findIndex((o, k) => o[1] === 'drawImage' && k >= 2 && ops[k - 2][1] === 'setTransform');
    return ops[j - 2][6];
  };
  const inside = [], outside = [];
  let prev = null;
  for (let k = -8; k <= 30; k++) {
    const t = seam.at - seam.dur / 2 + k / 30, x = groundX(t);
    if (prev !== null) (k > 0 && t <= seam.at + seam.dur / 2 ? inside : outside).push(Math.abs(x - prev));
    prev = x;
  }
  const calm = Math.max(...outside), worst = Math.max(...inside);
  assert.ok(calm > 0.5, 'the cameras move (' + calm.toFixed(2) + ' px per frame)');
  assert.ok(worst <= 1.5 * calm, 'largest step in the window ' + worst.toFixed(2) + ' px, outside ' + calm.toFixed(2));
});

test('sample plans draw with the backdrop palette a real plan gets, and the FxContext names the backdrop', () => {
  const seen = [];
  const probe = K.filter({ key: 'seeBackdrop', label: { ja: '見る', en: 'See' }, blurb: { ja: '見る', en: 'See' }, stage: 'film',
    cost: 1, passes: 1, alphaSafe: true, apply(fx, src) { seen.push([fx.backdrop, fx.pal && fx.pal.ground]); return src; } });
  const reg = REG.createRegistry([probe].concat(exReg.all()));
  const theme = reg.keys('theme')[0];
  const LOOK = MV.use('planner/look');
  for (const backdrop of ['scene', 'chroma', 'black', 'clear']) {
    const plan = FAC.samplePlan(reg, { kind: 'filter', key: 'seeBackdrop' }, { theme, backdrop });
    const want = LOOK.palette(reg.get('theme', theme), MV.use('core/pins').index({}), backdrop, null);
    assert.deepEqual(plan.look.palette, want, backdrop + ': the palette of a real plan');
    if (backdrop === 'chroma') assert.equal(plan.look.palette.ground, '#00B140');
    if (backdrop === 'black') assert.deepEqual([plan.look.palette.ground, plan.look.palette.ink], ['#000000', '#FFFFFF']);
    const { rec, engine } = engineOf(reg);
    engine.setPlan(plan);
    seen.length = 0;
    render(engine, surfaceOf(rec), plan.cuts[0].repT, { backdrop });
    assert.equal(seen.length, 1, backdrop + ': the probe ran');
    assert.equal(seen[0][0], backdrop, 'fx.backdrop');
  }
});

test('decorations see each text line and the emphasized word (hints.lines, emphLines, emph)', () => {
  const seen = [];
  const probe = K.ornament({ key: 'seeHints', scope: 'cut', follow: 'own', label: { ja: '見る', en: 'See' }, blurb: { ja: '見る', en: 'See' },
    tags: ['minimal'], params: {}, build(env) { seen.push(env.hints); } });
  const cat = MV.use('parts/catalog').defaultRegistry();
  const reg = REG.createRegistry([probe].concat(cat.all()));
  const glyphBoxes = (scene, keep) => {
    const t = scene.target, out = [];
    for (let j = 0; j < t.to - t.from; j++) if (t.cls[j] !== 'space' && keep(j)) out.push([t.box[j * 4], t.box[j * 4 + 1], t.box[j * 4 + 2], t.box[j * 4 + 3]]);
    return out;
  };
  const near = (box, list) => Math.abs(box.x - Math.min(...list.map((b) => b[0]))) < 1e-3 && Math.abs(box.y - Math.min(...list.map((b) => b[1]))) < 1e-3
    && Math.abs(box.x + box.w - Math.max(...list.map((b) => b[2]))) < 1e-3 && Math.abs(box.y + box.h - Math.max(...list.map((b) => b[3]))) < 1e-3;
  const lineCounts = [];
  for (const [text, aspect, arrange] of [['はじまりの朝', '16:9', 'centerAnchor'], ['I will wait for you until the morning light comes', '9:16', 'centerAnchor']]) {
    const plan = FAC.samplePlan(reg, { kind: 'ornament', key: 'seeHints' }, { text, aspect });
    plan.cuts[0].slots.arrange = { v: arrange, p: {}, from: 'pin' };
    plan.cuts[0].emph = [[2, 4]];
    plan.cuts[0].fp += ':' + arrange;
    const { engine } = engineOf(reg, { strict: false });
    engine.setPlan(plan);
    seen.length = 0;
    const scene = engine.scene('cut', 0);
    const h = seen[0], t = scene.target;
    assert.ok(h && Array.isArray(h.lines) && h.lines.length === t.units.line, text + ': one box per line');
    h.lines.forEach((box, k) => assert.ok(near(box, glyphBoxes(scene, (j) => t.unitOf.line[j] === k)), text + ': line ' + k));
    const emph = glyphBoxes(scene, (j) => t.emph[j]);
    assert.ok(emph.length > 0 && h.emphLines.length >= 1, text + ': the emphasized word has a box');
    if (t.units.line === 1) assert.ok(near(h.emph, emph), text + ': emph is that box on a single line');
    else assert.equal(h.emph, null, text + ': several lines → no single-line box');
    lineCounts.push(t.units.line);
  }
  assert.deepEqual(lineCounts.map((n) => n > 1), [false, true], 'a one-line and a several-line case: ' + lineCounts);
});

test('pooled surfaces and the target start every frame with default line state (a frame never inherits caps or joins)', () => {
  const rec = recorder();
  const pool = SF.createPool(rec.factory);
  pool.frame(64, 64);
  pool.begin();
  const s = pool.take();
  Object.assign(s.ctx, { lineWidth: 7, lineCap: 'round', lineJoin: 'round', strokeStyle: '#FF0000', fillStyle: '#00FF00' });
  s.ctx.setLineDash([4, 2]);
  pool.give(s);
  const again = pool.take();
  assert.equal(again, s, 'the same surface comes back');
  assert.deepEqual([again.ctx.lineWidth, again.ctx.lineCap, again.ctx.lineJoin, again.ctx.strokeStyle, again.ctx.fillStyle],
    [1, 'butt', 'miter', '#000000', '#000000']);
  pool.end();
  // the caller's target is reset before the backdrop is filled
  const { rec: r2, engine } = engineOf();
  engine.setDoc(corpus.project('basic').doc);
  const target = surfaceOf(r2);
  Object.assign(target.ctx, { lineCap: 'round', lineJoin: 'round', lineWidth: 9 });
  const m = r2.mark();
  render(engine, target, 10);
  const mine = r2.ops().slice(m).filter((op) => op[0] === target.canvas.id).map((op) => op.slice(1).join(' '));
  const firstFill = mine.findIndex((x) => x.startsWith('fillRect') || x.startsWith('clearRect'));
  for (const want of ['set:lineCap butt', 'set:lineJoin miter', 'set:lineWidth 1']) {
    const at = mine.indexOf(want);
    assert.ok(at >= 0 && at < firstFill, want + ' before the backdrop fill');
  }
});

test('pool.warm makes the missing frame surfaces once (cleared, touched) and leaves free ones alone; the preview warm-up of a seam', async () => {
  const rec = recorder();
  const pool = SF.createPool(rec.factory);
  assert.equal(pool.warm(6), 0, 'no frame size yet');
  pool.frame(64, 36);
  const touched = [];
  assert.equal(pool.warm(6, (sf) => touched.push(sf.canvas.id)), 6);
  assert.equal(touched.length, 6);
  assert.equal(pool.stats().created, 6);
  assert.ok(touched.every((id) => rec.ops().some((op) => op[0] === id && op[1] === 'clearRect')), 'made cleared');
  assert.equal(pool.warm(6, () => assert.fail('a warm pool touches nothing')), 0);
  const m = rec.mark();
  assert.equal(pool.warm(6), 0);
  assert.equal(rec.ops().length, m, 'and draws nothing');
  pool.begin();
  const got = [0, 1, 2, 3, 4, 5].map(() => pool.take());
  assert.equal(pool.stats().created, 6, 'six takes, none made');
  assert.deepEqual(got.map((sf) => sf.canvas.id).sort(), touched.slice().sort());
  pool.end();
  assert.equal(pool.warm(100), pool.limit - 6, 'at most the limit');
  pool.frame(32, 18);
  assert.equal(pool.warm(2), 2, 'a new frame size starts empty');
  pool.frame(48, 27);
  let asks = 0;
  assert.equal(pool.warm(3, null, () => ++asks === 1), 1, 'stop() after the first surface ends the call');
  assert.equal(pool.warm(3, null, () => { asks++; return false; }), 2, 'the next call makes the rest');
  assert.equal(asks, 3, 'asked after each surface made');
  // the engine: the preview warm-up makes a seam's surfaces on a host canvas (settle), never on the recorder alone
  const reg = MV.use('parts/catalog').defaultRegistry();
  const doc = corpus.project('long').doc;
  const run = async (host) => {
    const r = recorder();
    const factory = host ? Object.assign({}, r.factory, { settle() {} }) : r.factory;
    const frameSized = () => [...r.sizes.values()].filter(([w, h]) => w === 320 && h === 180).length;
    const perSlice = [];
    let last = 0;
    // no clock: a slice is due after 2 units of work (a build, a glyph that made a sprite, a surface warmed)
    const engine = FAC.createEngine({ registry: reg, canvas: factory, measurer: fakeMeasurer(), fonts: null, assets: null, strict: true,
      idle: () => { perSlice.push(frameSized() - last); last = frameSized(); return Promise.resolve(); } });
    const plan = engine.setDoc(doc).plan;
    const seam = plan.seams.find((x) => x.at > 5);
    const s = surfaceOf(r, 320, 180);
    const opts = { quality: 'preview', pick: false, scale: 320 / plan.design.w };
    engine.renderFrame(s, seam.at - 1.5, opts);
    last = frameSized();
    await engine.prepare(seam.at - 1.5, seam.at + 1);
    const before = frameSized();
    engine.renderFrame(s, seam.at, opts);
    return { made: frameSized() - before, warmed: before, perSlice };
  };
  const host = await run(true), plain = await run(false);
  assert.equal(host.made, 0, 'the seam frame makes no surface: the warm-up made them');
  assert.ok(plain.made > 0, 'without settle the seam frame makes its own (the recorder\'s ids stay as they were)');
  assert.ok(host.warmed > plain.warmed);
  assert.ok(host.perSlice.filter((n) => n > 0).length >= 2 && Math.max(...host.perSlice) <= 2,
    'the surfaces are made over several slices, at most 2 in one: ' + host.perSlice.join(','));
});

test('adaptive level 3 draws at 0.75 only above 720p (the stage has already stepped a 720p preview down)', () => {
  const sizesAt = (w, h) => {
    const { rec, engine } = engineOf(stubReg);
    const plan = engine.setDoc(corpus.project('basic').doc).plan;
    engine.setLevel(3);
    const s = surfaceOf(rec, w, h);
    const before = new Set(rec.sizes.keys());
    engine.renderFrame(s, plan.cuts[3].repT, { quality: 'preview', pick: false, scale: w / plan.design.w });
    return [...rec.sizes.entries()].filter(([id]) => !before.has(id)).map(([, z]) => z.join('x'));
  };
  assert.ok(sizesAt(1920, 1080).includes('1440x810'), 'a 1080p preview is drawn at 0.75');
  assert.ok(!sizesAt(1280, 720).includes('960x540'), 'a 720p preview is not stepped down again');
});
