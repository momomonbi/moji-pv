/* 文字PVメーカー v2 — original work. Tests for the glyph sprite cache's host capabilities: settle, ink rects and exact ink clips, and the sliced warm-up (DESIGN §4.19.5; NOTES "Perf: camerawork + materials row"). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const examples = require('../fixtures/example_parts.js');

const MV = load();
const FAC = MV.use('engine/facade');
const R = MV.use('engine/render/record');
const SP = MV.use('engine/render/sprites');
const HC = MV.use('engine/host/canvas');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');

const exReg = examples.exampleRegistry(MV);
const W = 640, H = 360;
const FONT = Object.freeze({ key: 'x:400', css: (px) => '400 ' + px + 'px x' });

// The ink box a host would measure for a font string: a glyph-like box proportional to the px size in the css.
function boxOf(css) {
  const px = Number(/([\d.]+)px/.exec(css)[1]);
  return { left: 0.42 * px, right: 0.47 * px, ascent: 0.52 * px, descent: 0.31 * px };
}

// A recording factory with the host's optional members: inkBox (boxOf) and settle (counted), each switchable. It
// remembers the size of every canvas it made (id → [w, h]).
function hostLike(o) {
  const opt = o || {};
  const rec = R.createRecorder();
  const sizes = new Map();
  const settled = [];
  const factory = { create(w, h, c) { const made = rec.factory.create(w, h, c); sizes.set(made.canvas.id, [w, h]); return made; } };
  if (opt.inkBox !== false) factory.inkBox = opt.inkBox || ((css) => boxOf(css));
  if (opt.settle !== false) factory.settle = (canvas) => { settled.push(canvas.id); };
  return { rec, factory, sizes, settled };
}

function engineOf(factory, extra) {
  return FAC.createEngine(Object.assign({ registry: exReg, canvas: factory, measurer: fakeMeasurer(), fonts: null, assets: null,
    strict: true }, extra || {}));
}

function surfaceOf(h) {
  const made = h.factory.create(W, H, { alpha: false });
  return { canvas: made.canvas, ctx: made.ctx, w: W, h: H };
}

const near = (a, b, eps) => Math.abs(a - b) <= (eps === undefined ? 2e-3 : eps);

// --- inkRect -----------------------------------------------------------------------------------------------------------

test('inkRect: the ink box from the draw point, widened for the style, padded by 3σ + 2 px, whole px, clamped', () => {
  const box = { left: 10, right: 20, ascent: 30, descent: 5 };
  // c = 100: ink x 90..120, y 70..105; pad 3·2 + 2 = 8
  assert.deepEqual(SP.inkRect(box, 100, 'plain', 2, 200), { x: 82, y: 62, w: 46, h: 51 });
  assert.deepEqual(SP.inkRect(box, 100, 'glow', 2, 200), { x: 82, y: 62, w: 46, h: 51 }, 'glow is painted plain');
  // outline: half the stroke (0.045 em) on every side → 87.75..122.25 → floor/ceil after the pad
  assert.deepEqual(SP.inkRect(box, 100, 'outline', 0, 200), { x: 85, y: 65, w: 40, h: 45 });
  // shadow: the offset copy reaches 0.06 em right and 0.07 em down; duo 0.045 em both ways
  assert.deepEqual(SP.inkRect(box, 100, 'shadow', 0, 200), { x: 88, y: 68, w: 40, h: 46 });
  assert.deepEqual(SP.inkRect(box, 100, 'duo', 0, 200), { x: 88, y: 68, w: 39, h: 44 });
  // fractional sides round outwards; a box that starts right of the draw point (negative left) is fine
  assert.deepEqual(SP.inkRect({ left: -3.5, right: 9.2, ascent: 1.1, descent: 0.2 }, 10, 'plain', 0.5, 50),
    { x: 25, y: 20, w: 13, h: 9 });
  // clamped to the raster; the whole raster is no crop at all
  assert.deepEqual(SP.inkRect({ left: 500, right: 1, ascent: 1, descent: 1 }, 100, 'plain', 1, 200), { x: 0, y: 94, w: 106, h: 12 });
  assert.equal(SP.inkRect({ left: 500, right: 500, ascent: 500, descent: 500 }, 100, 'plain', 1, 200), null);
  for (const bad of [null, {}, { left: NaN, right: 1, ascent: 1, descent: 1 }, { left: 1, right: Infinity, ascent: 1, descent: 1 }]) {
    assert.equal(SP.inkRect(bad, 100, 'plain', 1, 200), null, JSON.stringify(bad));
  }
});

// --- the cache on a host-like factory ----------------------------------------------------------------------------------

test('every level keeps its ink rect on a host with inkBox (blurred ones where ctx.filter blurs); the raster is made as without', () => {
  const host = hostLike();
  const plain = hostLike({ inkBox: false });
  const cache = SP.createSpriteCache(host.factory, {});
  const plainCache = SP.createSpriteCache(plain.factory, {});
  const k = SP.bucketOf(120);
  const strip = (h, id) => h.rec.ops().filter((op) => op[0] === id).map((op) => op.slice(1));
  for (const [style, level] of [['outline', 2], ['plain', 0], ['shadow', 4], ['duo', 5], ['glow', 3]]) {
    const sp = cache.glyph(FONT, 'あ', '#112233', style, '#445566', k, level, 120);
    const ref = plainCache.glyph(FONT, 'あ', '#112233', style, '#445566', k, level, 120);
    assert.deepEqual([sp.w, sp.h, sp.cx, sp.cy, sp.F, sp.bytes], [ref.w, ref.h, ref.cx, ref.cy, ref.F, ref.bytes], style + ' ' + level);
    assert.equal(sp.w, sp.h, 'the whole box is kept');
    assert.deepEqual(strip(host, sp.canvas.id), strip(plain, ref.canvas.id), 'drawn exactly as without inkBox: ' + style + ' ' + level);
    assert.equal(ref.ink, null, 'no ink rect without inkBox');
    // the rect is inkRect of the host's box at the raster's px size and blur
    const blurPx = level === 0 ? 0 : (SP.blurStepsOf(level, k, 120) / SP.BLUR_STEPS) * (sp.F / SP.bucketPx(k));
    assert.deepEqual(sp.ink, SP.inkRect(boxOf(FONT.css(sp.F)), sp.F, style, blurPx, sp.w), style + ' ' + level);
    assert.ok(sp.ink.w < sp.w && sp.ink.h < sp.h);
  }
  // a context whose filter does not blur: the fallback blur spreads differently, so a blurred raster has no ink rect
  const noFilter = hostLike();
  const create = noFilter.factory.create;
  noFilter.factory.create = (w, h, c) => {
    const made = create(w, h, c);
    const ctx = Object.create(made.ctx);                       // the recorder's calls, with a filter that stays 'none'
    Object.defineProperty(ctx, 'filter', { get: () => 'none', set: () => {} });
    return { canvas: made.canvas, ctx };
  };
  const softCache = SP.createSpriteCache(noFilter.factory, {});
  assert.equal(softCache.glyph(FONT, 'あ', '#112233', 'plain', null, k, 2, 120).ink, null, 'no ink rect for the stand-in blur');
  assert.ok(softCache.glyph(FONT, 'あ', '#112233', 'plain', null, k, 0, 120).ink, 'level 0 keeps its rect');
  // the ink rect of a raster depends on its key alone: a fresh cache gives the same
  const again = SP.createSpriteCache(hostLike().factory, {}).glyph(FONT, 'あ', '#112233', 'duo', '#445566', k, 5, 120);
  assert.deepEqual(again.ink, cache.glyph(FONT, 'あ', '#112233', 'duo', '#445566', k, 5, 120).ink);
});

test('settle(canvas) runs once for every new glyph and particle raster, never for a hit or on the recorder alone', () => {
  const host = hostLike({ inkBox: false });
  const cache = SP.createSpriteCache(host.factory, {});
  const k = SP.bucketOf(80);
  const a = cache.glyph(FONT, 'さ', '#000000', 'plain', null, k, 0, 80);
  const b = cache.glyph(FONT, 'さ', '#000000', 'plain', null, k, 3, 80);
  cache.glyph(FONT, 'さ', '#000000', 'plain', null, k, 0, 80);
  const rec = { sprite: 'glyph:★' };
  const p = cache.particle(rec, '#FFFFFF', 20, null);
  cache.particle(rec, '#FFFFFF', 20, null);
  assert.deepEqual(host.settled, [a.canvas.id, b.canvas.id, p.canvas.id]);
  // the recording factory has neither settle nor inkBox: its op stream is what it always was
  assert.equal(typeof R.createRecorder().factory.settle, 'undefined');
  assert.equal(typeof R.createRecorder().factory.inkBox, 'undefined');
});

// --- drawing rasters clipped to their ink ----------------------------------------------------------------------------

// The frame ops of one sample-cut frame of width w with a lab probe, on a host-like factory with and without inkBox.
function frames(probe, w, planOpts) {
  const plan = FAC.samplePlan(exReg, {}, planOpts || {});
  const width = w || W, height = Math.round((width * plan.design.h) / plan.design.w);
  const t = plan.cuts[0].repT;
  const out = {};
  for (const [name, o] of [['ink', {}], ['whole', { inkBox: false }]]) {
    const host = hostLike(o);
    const engine = engineOf(host.factory);
    engine.setPlan(plan);
    const made = host.factory.create(width, height, { alpha: false });
    engine.renderFrame({ canvas: made.canvas, ctx: made.ctx, w: width, h: height }, t, { quality: 'preview', scale: width / plan.design.w,
      probe });
    const ops = host.rec.ops().filter((op) => op[0] === made.canvas.id);
    out[name] = { ops, host };
  }
  return out;
}

// The frame's ops without the clips spriteAt adds: [save, beginPath, rect, clip] before a drawImage and the restore
// after it. → { ops, clips: [{ rect: [x, y, w, h], draw }] }
function unclipped(ops) {
  const out = [], clips = [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op[1] === 'save' && ops[i + 1] && ops[i + 1][1] === 'beginPath' && ops[i + 2] && ops[i + 2][1] === 'rect' &&
      ops[i + 3] && ops[i + 3][1] === 'clip' && ops[i + 4] && ops[i + 4][1] === 'drawImage' && ops[i + 5] && ops[i + 5][1] === 'restore') {
      clips.push({ rect: ops[i + 2].slice(2), draw: ops[i + 4] });
      out.push(ops[i + 4]);
      i += 5;
      continue;
    }
    out.push(op);
  }
  return { ops: out, clips };
}

test('a raster with an ink rect is drawn whole, exactly as without it, inside a clip round the ink (INK_CLIP texels wider)', () => {
  // at 7680 px the glyphs are several hundred px: their blurred and capped level-0 rasters are drawn scaled up
  for (const probe of [{ blur: 3 }, { glow: 0.5 }, { blur: 12, glow: 0.3 }]) {
    const { ink, whole } = frames(probe, 7680);
    const u = unclipped(ink.ops);
    assert.deepEqual(u.ops.map((op) => op.slice(1)), whole.ops.map((op) => op.slice(1)), 'the same draws: ' + JSON.stringify(probe));
    assert.ok(u.clips.length > 0, 'clipped draws: ' + JSON.stringify(probe));
    for (const c of u.clips) {
      const [dx, dy, dw, dh] = c.draw.slice(3);
      const [x, y, w, h] = c.rect;
      // unturned sample text: the open side is the raster's left, a texel beyond its quad
      const e = dw / ink.host.sizes.get(c.draw[2])[0];
      assert.ok(near(x, dx - e, 1e-3), 'open on the left, one texel out');
      assert.ok(y > dy && y + h < dy + dh && x + w < dx + dw, 'the top, bottom and right cut the quad');
    }
  }
  // at 640 px the sample's level-0 rasters (2× supersampled) are drawn scaled down: never clipped
  const small = frames({ glow: 0.5 }, W);
  const su = unclipped(small.ink.ops);
  assert.deepEqual(su.ops.map((op) => op.slice(1)), small.whole.ops.map((op) => op.slice(1)));
  for (const c of su.clips) assert.notEqual(small.ink.host.sizes.get(c.draw[2])[0], SP.MAX_SIDE, 'no scaled-down level 0 clipped');
});

test('inkClip: none without an ink rect or when scaled down; all sides when turned; else open where device rows start', () => {
  const DR = MV.use('engine/render/draw');
  const sp = { ink: { x: 10, y: 10, w: 20, h: 20 }, F: 100 };
  const rec = { em: 100, rot: 0, sx: 1 };
  const M = (a, b, c, d) => new Float32Array([a, b, c, d, 50, 60]);
  const [NONE, ALL, LEFT, RIGHT] = [0, 1, 2, 3];
  assert.equal(DR.inkClip(sp, rec, M(2, 0, 0, 2)), LEFT);
  assert.equal(DR.inkClip(sp, rec, M(-2, 0, 0, 2)), RIGHT, 'mirrored: rows start at the raster\'s right');
  assert.equal(DR.inkClip(sp, rec, M(2, 0, 0, -2)), LEFT, 'a vertical flip keeps the rows');
  assert.equal(DR.inkClip(sp, rec, M(2, 0.001, 0, 2)), ALL, 'any turn or skew');
  assert.equal(DR.inkClip(sp, Object.assign({}, rec, { rot: 1 }), M(2, 0, 0, 2)), ALL, 'a turned glyph (tate)');
  assert.equal(DR.inkClip(sp, rec, M(0.9, 0, 0, 0.9)), NONE, 'scaled down');
  assert.equal(DR.inkClip(sp, Object.assign({}, rec, { sx: 0.4 }), M(2, 0, 0, 2)), NONE, 'squeezed below 1 on x');
  assert.equal(DR.inkClip({ ink: null, F: 100 }, rec, M(2, 0, 0, 2)), NONE);
  assert.equal(DR.INK_CLIP, 2);
});

test('shards and the pixel mosaic draw whole rasters, exactly as without inkBox', () => {
  for (const probe of [{ blur: 3, shard: 0.4 }, { blur: 3, pixel: 6 }, { shard: 0.5 }]) {
    const { ink, whole } = frames(probe, 7680);
    const u = unclipped(ink.ops);
    const strips = (ops) => ops.filter((op) => op[1] === 'drawImage' && op.length === 11).map((op) => op.slice(3));
    assert.ok(strips(u.ops).length > 0);
    assert.deepEqual(strips(u.ops), strips(whole.ops), JSON.stringify(probe));
  }
});

// --- the sliced warm-up ------------------------------------------------------------------------------------------------

test('preview prepare yields between sprites of one frame and still makes exactly the sprites the frames draw', async () => {
  const plan = FAC.samplePlan(exReg, { kind: 'arrive', key: 'inkRise' }, {});
  // `slice` = the most sprites made between two yields
  async function warm(clockStep) {
    const host = hostLike();
    let clock = 0, engine = null, last = 0, slice = 0;
    const idle = () => {
      const made = engine.stats().spritesMade;
      slice = Math.max(slice, made - last);
      last = made;
      return new Promise((r) => setImmediate(r));
    };
    engine = engineOf(host.factory, { now: () => (clock += clockStep), idle });
    engine.setPlan(plan);
    engine.renderFrame(surfaceOf(host), 0, { quality: 'preview', scale: W / plan.design.w });
    const before = last = engine.stats().spritesMade;
    await engine.prepare(0, plan.duration);
    slice = Math.max(slice, engine.stats().spritesMade - last);
    return { made: engine.stats().spritesMade - before, slice, engine, host };
  }
  const calm = await warm(0.001);                              // a slice is never due: one walk per frame time
  const busy = await warm(50);                                  // every check is due: a yield after every new sprite
  assert.ok(calm.made > 10, 'inkRise needs blurred sprites (' + calm.made + ')');
  assert.equal(busy.made, calm.made, 'the same sprites, however often it yields');
  // one glyph makes at most its blur pair and a tint (inkRise: blur + tint), so a slice that is due after every new
  // sprite holds at most one glyph's sprites; a whole frame of the entrance holds many more
  assert.ok(calm.slice > 4, 'a frame of the entrance makes ' + calm.slice + ' sprites');
  assert.ok(busy.slice <= 4, 'at most one glyph\'s sprites between two yields: ' + busy.slice);
  // and the frames then draw without making any
  const s = surfaceOf(busy.host);
  const made = busy.engine.stats().spritesMade;
  for (let t = 1 / 30; t <= 1.5; t += 1 / 30) busy.engine.renderFrame(s, t, { quality: 'preview', scale: W / plan.design.w });
  assert.equal(busy.engine.stats().spritesMade, made);
});

// --- the host factory --------------------------------------------------------------------------------------------------

// A document whose canvases log their 2d calls; measureText reports a fixed box.
function fakeDocument(box) {
  const log = [];
  let ids = 0;
  const document = {
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = { id: ids++, width: 0, height: 0 };
      const ctx = {
        drawImage: (...a) => log.push([canvas.id, 'drawImage', a[0].id, ...a.slice(1)]),
        clearRect: (...a) => log.push([canvas.id, 'clearRect', ...a]),
        measureText: (text) => { log.push([canvas.id, 'measureText', ctx.font, ctx.textAlign, ctx.textBaseline, text]); return box; },
      };
      canvas.getContext = () => ctx;
      return canvas;
    },
  };
  return { document, log };
}

test('host factory: settle draws a canvas once into a private 1 × 1 canvas and clears it; inkBox measures there', () => {
  const box = { actualBoundingBoxLeft: 3, actualBoundingBoxRight: 4, actualBoundingBoxAscent: 5, actualBoundingBoxDescent: 6 };
  const { document, log } = fakeDocument(box);
  const f = HC.createCanvasFactory({ document, offscreen: false });
  assert.equal(typeof f.settle, 'function');
  assert.equal(typeof f.inkBox, 'function');
  const a = f.create(300, 200), b = f.create(20, 10);
  assert.equal(log.length, 0, 'nothing drawn or made before the first use');
  f.settle(a.canvas);
  f.settle(b.canvas);
  const tiny = log[0][0];
  assert.notEqual(tiny, a.canvas.id);
  assert.deepEqual(log, [[tiny, 'drawImage', a.canvas.id, 0, 0, 1, 1], [tiny, 'clearRect', 0, 0, 1, 1],
    [tiny, 'drawImage', b.canvas.id, 0, 0, 1, 1], [tiny, 'clearRect', 0, 0, 1, 1]], 'one private canvas, cleared after each use');
  assert.deepEqual(f.inkBox('400 50px x', 'あ'), { left: 3, right: 4, ascent: 5, descent: 6 });
  assert.deepEqual(log[4], [tiny, 'measureText', '400 50px x', 'center', 'middle', 'あ']);
  f.settle(null);
  f.settle({ width: 0, height: 5 });
  assert.equal(log.length, 5, 'nothing to settle');
  const odd = HC.createCanvasFactory({ document: fakeDocument({ actualBoundingBoxLeft: NaN }).document, offscreen: false });
  assert.equal(odd.inkBox('10px x', 'a'), null, 'no box without finite metrics');
});

test('minScaleOf: the smaller singular value of the draw transform, times the tate-chu-yoko squeeze', () => {
  const DR = MV.use('engine/render/draw');
  const one = { sx: 1 };
  const M = (a, b, c, d) => new Float32Array([a, b, c, d, 7, 9]);
  assert.ok(near(DR.minScaleOf(M(1, 0, 0, 1), one), 1, 1e-6));
  assert.ok(near(DR.minScaleOf(M(2, 0, 0, 3), one), 2, 1e-6));
  const r = 0.7;
  assert.ok(near(DR.minScaleOf(M(3 * Math.cos(r), 3 * Math.sin(r), -3 * Math.sin(r), 3 * Math.cos(r)), one), 3, 1e-5), 'a turn');
  assert.ok(near(DR.minScaleOf(M(2, 0, 1, 2), one), Math.sqrt((9 - Math.sqrt(17)) / 2), 1e-5), 'a skew');
  assert.ok(near(DR.minScaleOf(M(2, 0, 0, 2), { sx: 0.5 }), 1, 1e-6), 'squeezed');
});
