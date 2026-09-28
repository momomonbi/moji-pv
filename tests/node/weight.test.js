/* 文字PVメーカー v2 — original work. Tests for the weight animation (DESIGN_2_2 §4, M5): weight ladders, weight pairs in the draw path, the kit options, draw-only faces. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { fakeDocument } = require('../helpers/fake_fonts.js');

const MV = load();
const FACES = MV.use('engine/text/faces');
const T = MV.use('engine/scene/table');
const DR = MV.use('engine/render/draw');
const REC = MV.use('engine/render/record');
const SP = MV.use('engine/render/sprites');
const BH = MV.use('engine/scene/behave');
const K = MV.use('parts/kit');
const { createFontBook } = MV.use('engine/host/fonts');

const NOTO = FACES.faceRef('Noto Sans JP', 500, 'ja', 'gothic', 'display');
const close = (a, b, eps = 1e-3) => Math.abs(a - b) <= eps;
const WP = () => ({ lo: null, hi: null, f: 0, plain: true });

// --- 1. faces: ladders, rungs, pairs, room, grow top, reweigh --------------------------------------------------------

test('weight ladders: ladderOf, atWeight, weightPair, roomOf, growTop, rungsBetween, reweigh', () => {
  assert.deepEqual([...FACES.ladderOf(NOTO)], [100, 200, 300, 400, 500, 600, 700, 800, 900]);
  const custom = FACES.faceRef('Some Custom Face', 400, 'ja');
  assert.deepEqual([...FACES.ladderOf(custom)], [400], 'an unknown family has only its own weight');
  // atWeight: the same ref for its own weight, one stable object per other weight
  assert.equal(FACES.atWeight(NOTO, 500), NOTO);
  const w300 = FACES.atWeight(NOTO, 300);
  assert.equal(FACES.atWeight(NOTO, 300), w300, 'stable object');
  assert.deepEqual([w300.family, w300.weight, w300.script, w300.flavor, w300.role], ['Noto Sans JP', 300, 'ja', 'gothic', 'display']);
  assert.match(w300.css(10), /^300 10px "Noto Sans JP"/);
  // weightPair: exact rungs, mid-rung, clamps, W_EPS snapping, plain
  let p = FACES.weightPair(NOTO, 0, WP());
  assert.deepEqual([p.lo.weight, p.hi, p.f, p.plain], [500, null, 0, true]);
  p = FACES.weightPair(NOTO, -200, WP());
  assert.deepEqual([p.lo.weight, p.hi, p.f, p.plain], [300, null, 0, false], 'a rung boundary: f = 0 exactly');
  p = FACES.weightPair(NOTO, -150, WP());
  assert.deepEqual([p.lo.weight, p.hi.weight, p.f, p.plain], [300, 400, 0.5, false], 'mid-rung');
  p = FACES.weightPair(NOTO, -1000, WP());
  assert.deepEqual([p.lo.weight, p.hi, p.f], [100, null, 0], 'below the lightest: clamped');
  p = FACES.weightPair(NOTO, 1000, WP());
  assert.deepEqual([p.lo.weight, p.hi, p.f], [900, null, 0], 'above the heaviest: clamped');
  p = FACES.weightPair(NOTO, 0.5, WP());
  assert.deepEqual([p.lo.weight, p.hi, p.f, p.plain], [500, null, 0, true], 'within W_EPS of a rung: snapped down');
  p = FACES.weightPair(NOTO, 99.5, WP());
  assert.deepEqual([p.lo.weight, p.hi, p.f, p.plain], [600, null, 0, false], 'within W_EPS below the next rung: snapped up');
  p = FACES.weightPair(custom, 300, WP());
  assert.equal(p.plain, true, 'a one-weight family never animates');
  const zen = FACES.faceRef('Zen Old Mincho', 700, 'ja');                 // 400 500 600 700 900
  p = FACES.weightPair(zen, 100, WP());
  assert.deepEqual([p.lo.weight, p.hi.weight, p.f], [700, 900, 0.5], 'a gap in the ladder crossfades across it');
  // roomOf, growTop
  assert.deepEqual(FACES.roomOf(NOTO), { below: 400, above: 400 });
  assert.deepEqual(FACES.roomOf(zen), { below: 300, above: 200 });
  assert.equal(FACES.growTop(NOTO), 800);
  assert.equal(FACES.growTop(FACES.faceRef('BIZ UDPGothic', 400, 'ja')), 700, 'a 400/700 family grows to 700');
  assert.equal(FACES.growTop(FACES.faceRef('Dela Gothic One', 400, 'ja')), 400, 'a one-weight family: its weight');
  assert.equal(FACES.growTop(zen), 700, '900 is above the grow top');
  // rungsBetween: the three parts' reaches
  assert.deepEqual(FACES.rungsBetween(NOTO, -400, 0), [100, 200, 300, 400, 500], '太る/細る from the lightest');
  assert.deepEqual(FACES.rungsBetween(NOTO, 0, 250), [500, 600, 700, 800], '脈打つ太さ up 250: to the rung above 750');
  assert.deepEqual(FACES.rungsBetween(NOTO, -150, 0), [300, 400, 500]);
  assert.deepEqual(FACES.rungsBetween(zen, -600, 0), [400, 500, 600, 700], 'clamped to the ladder');
  // reweigh: only the role changes; cached; FontRefs and plain entries
  const faces = FACES.resolveFaces({ faces: { display: { ja: 'Noto Sans JP', latin: 'Inter', weight: 500 },
    serif: { ja: 'Zen Old Mincho', latin: 'Lora', weight: 400 }, body: { ja: 'M PLUS 1p', latin: 'Inter', weight: 400 } } },
  null, ['ja']);
  const heavy = FACES.reweigh(faces, 'display', 800);
  assert.equal(FACES.reweigh(faces, 'display', 800), heavy, 'cached per (faces, role, weight)');
  assert.equal(heavy.serif, faces.serif);
  assert.equal(heavy.body, faces.body);
  assert.deepEqual([heavy.display.ja.weight, heavy.display.latin.weight], [800, 800]);
  assert.equal(heavy.display.ja.flavor, faces.display.ja.flavor);
  const serif = FACES.reweigh(faces, 'serif', 800);
  assert.equal(serif.serif.ja.weight, 900, 'snapped per family (Zen Old Mincho has no 800: the browser picks 900)');
  assert.equal(serif.serif.latin.weight, 700, 'Lora tops out at 700');
  const json = JSON.parse(JSON.stringify(faces));
  const fromJson = FACES.reweigh(json, 'display', 300);
  assert.deepEqual(FACES.fontFor(fromJson, 'display', 'ja').toJSON(), { family: 'Noto Sans JP', weight: 300 });
  assert.deepEqual(FACES.fontFor(fromJson, 'display', 'en').toJSON(), { family: 'Inter', weight: 300 });
});

// --- 2. the draw path: weight pairs --------------------------------------------------------------------------------

const PAL = Object.freeze({ ink: '#101010', ground: '#f0f0f0', accent: '#ff0000', muted: '#808080', shiftA: '#00ff00',
  shiftB: '#0000ff' });

// A one-glyph scene: the glyph at the origin, em 100, the given face, style and pose.
function glyphScene(font, style, pose) {
  const t = T.createTable(1);
  const i = T.addNode(t, { type: T.TYPE.glyph, payload: 0, flags: T.FLAG.pickable });
  T.resetLive(t);
  for (const c of Object.keys(pose || {})) t.live[c][i] = pose[c];
  T.solve(t);
  const rec = { run: 0, i: 0, ch: '夢', cls: 'han', vcls: 0, rot: 0, sx: 1, em: 100, font, ink: 'ink', emph: false,
    style: style || 'plain', reveal: 'wipeX', w: 100, h: 100, off: 0, line: 0, word: 0 };
  return { table: t, stores: { glyph: [rec] }, node: i, rec };
}

// Draws one glyph node on a recorder; → the ops of the target canvas (sprite rasters excluded) and the sprite lookups.
function drawOps(scene, o) {
  const rec = REC.createRecorder();
  const target = REC.surfaceOf(rec.factory, 400, 400);
  const real = SP.createSpriteCache(rec.factory, {});
  const asked = [];
  const sprites = { glyph: (...a) => { asked.push({ font: a[0], style: a[3], level: a[6] }); return real.glyph(...a); },
    particle: real.particle, made: 0 };
  const dc = DR.createDrawContext({ sprites, paints: null, scratch: REC.surfaceOf(rec.factory, 64, 64), faceReady: o && o.faceReady });
  dc.g = target.ctx;
  dc.pal = PAL;
  target.ctx.textAlign = 'center';
  target.ctx.textBaseline = 'middle';
  const from = rec.mark();
  DR.drawGlyph(dc, scene, scene.node, new Float32Array([1, 0, 0, 1, 200, 200]));
  const ops = rec.ops().slice(from).filter((op) => op[0] === target.canvas.id).map((op) => op.slice(1));
  return { ops, asked };
}

const fonts = (ops) => ops.filter((op) => op[0] === 'set:font').map((op) => op[1]);
const alphas = (ops) => ops.filter((op) => op[0] === 'set:globalAlpha').map((op) => op[1]);
const count = (ops, name) => ops.filter((op) => op[0] === name).length;

test('draw: wt = 0 draws exactly what it drew before; a weight pair draws the heavier at a·f, the lighter over it', () => {
  const at0 = drawOps(glyphScene(NOTO, 'plain', {}));
  const zero = drawOps(glyphScene(NOTO, 'plain', { wt: 0 }));
  assert.deepEqual(zero.ops, at0.ops);
  assert.deepEqual(fonts(at0.ops), [NOTO.css(100)]);
  // mid-rung on the direct path: 500 − 150 → 300/400 at f = 0.5, alpha 0.8
  const a = 0.8, f = 0.5;
  const { ops } = drawOps(glyphScene(NOTO, 'plain', { wt: -150, alpha: a }));
  assert.deepEqual(fonts(ops), [FACES.atWeight(NOTO, 400).css(100), FACES.atWeight(NOTO, 300).css(100)], 'heavier first');
  assert.equal(count(ops, 'fillText'), 2);
  const al = alphas(ops);
  assert.ok(close(al[0], a * f), 'heavier at a·f: ' + al[0]);
  assert.ok(close(al[1], (a * (1 - f)) / (1 - a * f)), 'lighter at a(1−f)/(1−a·f): ' + al[1]);
  // the composite of the core: a·f + y − a·f·y = a
  assert.ok(close(al[0] + al[1] - al[0] * al[1], a));
  // exactly on a rung: one body in that weight
  const rung = drawOps(glyphScene(NOTO, 'plain', { wt: -200 })).ops;
  assert.deepEqual(fonts(rung), [FACES.atWeight(NOTO, 300).css(100)]);
  assert.equal(count(rung, 'fillText'), 1);
  // a one-weight family: today's ops
  const dela = FACES.faceRef('Dela Gothic One', 400, 'ja');
  assert.deepEqual(drawOps(glyphScene(dela, 'plain', { wt: -300 })).ops, drawOps(glyphScene(dela, 'plain', {})).ops);
});

test('draw: outline, shadow and duo take the nearest served weight (steps); glow crossfades', () => {
  // outline: one fillText + one strokeText, both with the nearest rung's font, no second body
  for (const [wt, nearest] of [[-150, 400], [-160, 300]]) {
    const { ops } = drawOps(glyphScene(NOTO, 'outline', { wt }));
    assert.deepEqual(fonts(ops), [FACES.atWeight(NOTO, nearest).css(100)], 'outline wt ' + wt);
    assert.equal(count(ops, 'fillText'), 1);
    assert.equal(count(ops, 'strokeText'), 1);
  }
  const shadow = drawOps(glyphScene(NOTO, 'shadow', { wt: -150 })).ops;
  assert.deepEqual(fonts(shadow), [FACES.atWeight(NOTO, 400).css(100)]);
  assert.equal(count(shadow, 'fillText'), 2, 'the offset copy and the fill, once');
  const duo = drawOps(glyphScene(NOTO, 'duo', { wt: -150 })).ops;
  assert.equal(fonts(duo).length, 1);
  assert.equal(count(duo, 'fillText'), 2);
  // glow: the halo (a sprite) once, the body twice
  const glow = drawOps(glyphScene(NOTO, 'glow', { wt: -150 }));
  assert.equal(count(glow.ops, 'fillText'), 2);
  assert.equal(glow.asked.length, 1, 'one halo sprite');
  assert.equal(glow.asked[0].font, FACES.atWeight(NOTO, 400), 'the halo in the nearer weight');
});

test('draw: the sprite path draws two bodies with the two faces; echo and tint once with the nearer face', () => {
  // blur 1 du: level pair crossfade of each body (levels are looked up per body)
  const { asked } = drawOps(glyphScene(NOTO, 'plain', { wt: -150, blur: 1 }));
  const bodyFonts = [...new Set(asked.map((x) => x.font))];
  assert.deepEqual(bodyFonts, [FACES.atWeight(NOTO, 400), FACES.atWeight(NOTO, 300)], 'heavier then lighter');
  const duo = drawOps(glyphScene(NOTO, 'duo', { wt: -150, blur: 1 })).asked;
  assert.equal(new Set(duo.map((x) => x.font)).size, 1, 'duo: one body');
  // echo and tint with the dominant face (f = 0.4 → the lighter)
  const et = drawOps(glyphScene(NOTO, 'plain', { wt: -160, blur: 1, echo: 0.5, tint: 0.5 })).asked;
  const lighter = FACES.atWeight(NOTO, 300), heavier = FACES.atWeight(NOTO, 400);
  const plainAsks = et.filter((x) => x.style === 'plain');
  assert.ok(plainAsks.length > 0);
  const noEcho = drawOps(glyphScene(NOTO, 'plain', { wt: -160, blur: 1 })).asked;
  const extra = et.slice(0);
  for (const x of noEcho) extra.splice(extra.findIndex((y) => y.font === x.font && y.level === x.level), 1);
  assert.ok(extra.length > 0 && extra.every((x) => x.font === lighter), 'echo and tint copies use the nearer face');
  assert.ok(noEcho.some((x) => x.font === heavier) && noEcho.some((x) => x.font === lighter));
});

test('draw: faceReady — a heavier rung not loaded is dropped; neither loaded → the base face', () => {
  const heavier = FACES.atWeight(NOTO, 400), lighter = FACES.atWeight(NOTO, 300);
  const onlyLight = drawOps(glyphScene(NOTO, 'plain', { wt: -150 }), { faceReady: (r) => r !== heavier }).ops;
  assert.deepEqual(fonts(onlyLight), [lighter.css(100)]);
  assert.equal(count(onlyLight, 'fillText'), 1);
  assert.equal(alphas(onlyLight)[0], 1, 'one body at full alpha');
  const none = drawOps(glyphScene(NOTO, 'plain', { wt: -150 }), { faceReady: (r) => r === NOTO }).ops;
  assert.deepEqual(none, drawOps(glyphScene(NOTO, 'plain', {})).ops, 'nothing loaded: the base face as at rest');
  // the lighter not loaded, a lighter-still rung is: the walk goes toward the face's own weight
  const w200 = FACES.atWeight(NOTO, 200);
  const walk = drawOps(glyphScene(NOTO, 'plain', { wt: -350 }), { faceReady: (r) => r !== FACES.atWeight(NOTO, 100) && r !== w200 && r !== heavier }).ops;
  assert.deepEqual(fonts(walk), [lighter.css(100)], '100/200 missing: the nearest loaded weight toward 500 (300)');
});

test('glyphCover counts the body twice only for a crossfading weight pair', () => {
  const M = new Float32Array([1, 0, 0, 1, 300, 300]);
  const at = (style, pose) => {
    const s = glyphScene(NOTO, style, pose);
    const c = { sprites: 0, inks: 0 };
    DR.glyphCover(s.rec, s.table.live, s.node, 1, M, 1000, 1000, c);
    return c;
  };
  assert.deepEqual(at('plain', {}), { sprites: 0, inks: 1 });
  assert.deepEqual(at('plain', { wt: -150 }), { sprites: 0, inks: 2 });
  assert.deepEqual(at('plain', { wt: -200 }), { sprites: 0, inks: 1 }, 'on a rung: one body');
  assert.deepEqual(at('outline', { wt: -150 }), { sprites: 0, inks: 1 }, 'outline steps: one body');
  assert.deepEqual(at('glow', { wt: -150 }), { sprites: 1, inks: 2 });
  assert.deepEqual(at('plain', { wt: -150, blur: 3 }), { sprites: 4, inks: 0 }, 'sprite path: two level pairs');
});

// --- 3. kit options ----------------------------------------------------------------------------------------------------

function envAndTarget(n) {
  const times = { a: 0, rest: 1, out: 3, b: 4 };
  const target = { from: 0, to: n, runs: [], units: { glyph: n, word: 1, line: 1, run: 1 },
    unitOf: { word: new Int16Array(n), line: new Int16Array(n), run: new Int16Array(n) }, emph: new Uint8Array(n),
    focus: { x: 0, y: 0, w: 100, h: 100 }, ch: new Array(n).fill('夢'), cls: new Array(n).fill('han'),
    em: new Float32Array(n).fill(100), x: new Float32Array(n), y: new Float32Array(n), wx: new Float32Array(n),
    wy: new Float32Array(n), w: new Float32Array(n).fill(100), h: new Float32Array(n).fill(100),
    cx: new Float32Array(n), cy: new Float32Array(n), box: new Float32Array(n * 4), lang: 'ja', arrived: null };
  return { env: { times, seed: 1, key: 'k', cut: { t0: 0, t1: 4 } }, target };
}

test('kit: K.perGlyph(fn, { prep, wt }) — prep once per build, behaviour.wt declared; options survive the re-wrap and mirror', () => {
  const calls = [];
  const prep = (env, target, p) => { calls.push([env, target, p]); return Object.assign({}, p, { reach: 300 }); };
  const fn = (P, g, k, u, p) => { P.wt -= p.reach * (1 - k); };
  const make = K.perGlyph(fn, { prep, wt: (p) => [-p.reach, 0] });
  assert.equal(make.glyphFn, fn);
  assert.deepEqual(Object.keys(make.glyphOpts).sort(), ['prep', 'wt']);
  const def = K.arrive({ key: 'testGrow', label: { ja: 'て', en: 'T' }, blurb: { ja: 'て', en: 'T' }, make });
  const { env, target } = envAndTarget(3);
  const p = { dur: 0.5, each: 0, order: 'lead', ease: 'linear' };
  const [b] = def.make(env, target, p);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2], p, 'prep sees the params');
  assert.equal(p.reach, undefined, 'the given params are not changed');
  assert.equal(b.p.reach, 300);
  assert.deepEqual([...b.wt], [-300, 0]);
  assert.equal(b.exit, false);
  // the entrance runs wt from −reach to 0
  const P = { wt: new Float32Array(3) };
  for (const c of BH.DELTA) if (!P[c]) P[c] = new Float32Array(3).fill(BH.identityOf(c));
  BH.runGlyphMotion(P, 0, b);
  assert.deepEqual([...P.wt], [-300, -300, -300]);
  // K.depart re-wraps it as a real exit that keeps the options
  const exit = K.depart({ key: 'testThin', label: { ja: 'て', en: 'T' }, blurb: { ja: 'て', en: 'T' },
    make: K.perGlyph((P2, g, k, u, pp) => { P2.wt -= pp.reach * k; }, { prep, wt: (pp) => [-pp.reach, 0] }) });
  const [x] = exit.make(env, target, p);
  assert.deepEqual([x.exit, x.t0, x.live], [true, env.times.out, 'after']);
  assert.deepEqual([...x.wt], [-300, 0]);
  // K.mirror keeps the options
  const mirrored = K.mirror(def, { key: 'testMirror', label: { ja: 'て', en: 'T' }, blurb: { ja: 'て', en: 'T' } });
  assert.equal(mirrored.make.glyphOpts.prep, prep);
  const [m] = mirrored.make(env, target, p);
  assert.deepEqual([m.exit, m.t0], [true, env.times.out]);
  assert.deepEqual([...m.wt], [-300, 0]);
  // K.variant keeps them too
  const v = K.variant(def, { key: 'testVariant', label: { ja: 'て', en: 'T' }, blurb: { ja: 'て', en: 'T' } });
  assert.deepEqual([...v.make(env, target, p)[0].wt], [-300, 0]);
  // bad options
  assert.throws(() => K.perGlyph(fn, { prep: 3 }), (e) => e.code === 'bad-fn');
  assert.throws(() => K.perGlyph(fn, 'x'), (e) => e.code === 'bad-fn');
  assert.throws(() => K.perGlyphHold(fn, { wt: [0, 1] }), (e) => e.code === 'bad-fn');
});

test('kit: one-argument K.perGlyph / K.perGlyphHold build exactly the behaviours of before (no wt, same params)', () => {
  const CAT = MV.use('parts/catalog');
  const reg = CAT.defaultRegistry();
  const { env, target } = envAndTarget(4);
  let n = 0;
  for (const kind of ['arrive', 'depart', 'dwell']) {
    for (const def of reg.all(kind)) {
      if (!(def.make.glyphFn || def.make.holdFn) || def.late === true) continue;
      const p = { dur: 0.5, each: 0.02, order: 'lead', ease: 'linear', amount: 0.5, speed: 1, curve: 'linear' };
      for (const name of Object.keys(def.params || {})) {
        const auto = def.params[name].auto;
        p[name] = auto && auto.value !== undefined ? auto.value : auto && auto.range ? auto.range[0] : auto && auto.pick ? auto.pick[0] : 0;
      }
      const list = def.make(env, target, p);
      const plain = def.make.glyphFn ? def.make.glyphOpts === null : def.make.holdOpts === null;
      for (const b of list) {
        assert.equal(b.wt, undefined, kind + '/' + def.key);
        // a kit-made behaviour without options runs on the params object itself (no prep copy)
        if (plain && b.p !== undefined) assert.equal(b.p, p, kind + '/' + def.key + ': the params object itself');
      }
      n++;
    }
  }
  assert.ok(n > 20, 'catalog parts checked: ' + n);
});

test('kit: K.perGlyphHold(fn, { prep, wt }) and K.weightRoom', () => {
  const prep = (env, target, p) => Object.assign({}, p, { amp: 200 });
  const make = K.perGlyphHold((P, g, time, w, p) => { P.wt += p.amp * w; }, { prep, wt: (p) => [0, p.amp] });
  const { env, target } = envAndTarget(2);
  const [h] = make(env, target, { curve: { ramp: [0.2, 0.8] } });
  assert.deepEqual([...h.wt], [0, 200], 'a warped hold keeps wt');
  assert.equal(h.p.amp, 200);
  // weightRoom: the face most glyphs use
  assert.deepEqual(K.weightRoom({ runs: [] }), { below: 0, above: 0 });
  const zen = FACES.faceRef('Zen Old Mincho', 700, 'ja'), inter = FACES.faceRef('Inter', 400, 'latin');
  const layout = { n: 5, cls: Uint8Array.from([0, 0, 8, 5, 0]), font: Uint8Array.from([0, 0, 1, 1, 0]), fonts: [zen, inter] };
  assert.deepEqual(K.weightRoom({ runs: [{ layout }] }), { below: 300, above: 200 });
  const latin = { n: 3, cls: Uint8Array.from([5, 5, 5]), font: Uint8Array.from([1, 1, 1]), fonts: [zen, inter] };
  assert.deepEqual(K.weightRoom({ runs: [{ layout }, { layout: latin }] }), { below: 300, above: 500 }, '4 Latin vs 3 kanji');
});

// --- 4. draw-only faces: the FontBook -------------------------------------------------------------------------------------

test('FontBook: draw-only faces never move the epoch, have their own sheets and states, and never redeclare a main weight', async () => {
  const { doc, links } = fakeDocument();
  const book = createFontBook({ document: doc, timeoutMs: 2000 });
  let draws = 0;
  book.on('draw', () => { draws++; });
  const res = await book.ready([NOTO], '夢');
  assert.deepEqual(res.failed, []);
  assert.equal(book.epoch, 1);
  const w300 = FACES.atWeight(NOTO, 300), w400 = FACES.atWeight(NOTO, 400);
  assert.equal(book.drawStatus(w300), 'idle');
  book.request([w300, w400, NOTO], { 'Noto Sans JP': '夢' }, { drawOnly: true });
  assert.equal(book.drawStatus(w300), 'loading');
  assert.equal(book.drawStatus(NOTO), 'ready', 'a main face reports its main state');
  const sheet = links[links.length - 1].href;
  assert.match(sheet, /wght@300;400&/, 'the draw-only sheet declares only the weights the main path does not own');
  const r2 = await book.ready([w300, w400], { 'Noto Sans JP': '夢' }, { drawOnly: true });
  assert.deepEqual(r2.failed, []);
  assert.deepEqual(r2.loaded, [w300, w400]);
  assert.equal(book.drawStatus(w300), 'ready');
  assert.equal(book.epoch, 1, 'draw-only loads do not move the epoch');
  assert.equal(draws, 2, "one 'draw' event per face that became ready");
  assert.deepEqual(book.failures(), []);
  assert.equal(book.status(w300), 'idle', 'status() is the main path only');
  // more characters: a newer sheet for the same weights → loading until it is in
  book.request([w300], { 'Noto Sans JP': '海' }, { drawOnly: true });
  assert.equal(book.drawStatus(w300), 'loading', 'the newest declaration is the one drawn: loading again');
  await book.ready([w300], { 'Noto Sans JP': '' }, { drawOnly: true });
  assert.equal(book.drawStatus(w300), 'ready');
  assert.match(links[links.length - 1].href, /text=/);
  assert.equal(decodeURIComponent(/text=([^&]+)/.exec(links[links.length - 1].href)[1]), FACES.uniqueChars('夢海'));
  assert.equal(book.epoch, 1);
  // a main-owned ref in a draw-only ready counts by its main state
  const r3 = await book.ready([NOTO], {}, { drawOnly: true });
  assert.deepEqual(r3.loaded, [NOTO]);
  // an unsubscribed listener hears nothing
  const off = book.on('draw', () => { throw new Error('unsubscribed'); });
  off();
  await book.ready([FACES.atWeight(NOTO, 200)], { 'Noto Sans JP': '夢' }, { drawOnly: true });
});

test('FontBook: a draw-only load that fails is failed only for its newest sheet and is retried', async () => {
  let offline = true;
  const { doc } = fakeDocument({ failLoads: () => offline });
  const book = createFontBook({ document: doc, timeoutMs: 2000 });
  const w300 = FACES.atWeight(NOTO, 300);
  const res = await book.ready([w300], { 'Noto Sans JP': '夢' }, { drawOnly: true });
  assert.deepEqual(res.failed, [w300]);
  assert.equal(book.drawStatus(w300), 'failed');
  assert.deepEqual(book.failures(), [], 'draw-only failures are not listed');
  offline = false;
  const again = await book.ready([w300], { 'Noto Sans JP': '夢' }, { drawOnly: true });
  assert.deepEqual(again.loaded, [w300]);
  assert.equal(book.drawStatus(w300), 'ready');
  assert.equal(book.epoch, 0);
});

// The newest stylesheet (in the order they were added) whose wght list declares `weight` for Noto Sans JP.
function newestSheetOf(links, weight) {
  const hits = links.map((l) => decodeURIComponent(l.href)).filter((u) => /family=Noto\+Sans\+JP:wght@/.test(u)
    && /wght@([0-9;]+)/.exec(u)[1].split(';').map(Number).includes(weight));
  return hits[hits.length - 1] || null;
}
const sheetText = (url) => /text=([^&]+)/.exec(url)[1];

test('FontBook: when a family\'s draw-only characters grow, every draw-only weight it has is declared with all of them', async () => {
  const { doc, links } = fakeDocument();
  const book = createFontBook({ document: doc, timeoutMs: 2000 });
  await book.ready([NOTO], { 'Noto Sans JP': '青い空夜の町' });              // the main path owns 500
  const r = (w) => FACES.atWeight(NOTO, w);
  const A = [100, 200, 300, 400], B = [600, 700, 800];
  // 太る on 青い空 asks for 100–400; then 脈打つ太さ on 夜の町 asks for 600–800 with new characters
  await book.ready(A.map(r), { 'Noto Sans JP': '青い空' }, { drawOnly: true });
  book.request(B.map(r), { 'Noto Sans JP': '夜の町' }, { drawOnly: true });
  for (const w of A) {
    const url = newestSheetOf(links, w);
    assert.ok(url && [...'夜の町'].every((c) => sheetText(url).includes(c)), w + ': the newest sheet declaring it has the new characters');
    assert.equal(book.drawStatus(r(w)), 'loading', w + ': loading again until that sheet is in');
  }
  await book.ready(B.map(r), { 'Noto Sans JP': '' }, { drawOnly: true });
  for (const w of [...A, ...B]) assert.equal(book.drawStatus(r(w)), 'ready', String(w));
  // the main weight is never declared by a draw-only sheet
  for (const l of links.slice(1)) assert.ok(!/wght@([0-9;]*;)?500(;|&)/.test(decodeURIComponent(l.href)), 'a draw-only sheet declares 500: ' + l.href);
  // the same weights and characters again: no new sheet
  const n = links.length;
  book.request([...A, ...B].map(r), { 'Noto Sans JP': '空町' }, { drawOnly: true });
  assert.equal(links.length, n, 'nothing new to declare');
  // a new weight without new characters: a sheet for it alone
  book.request([r(900)], { 'Noto Sans JP': '夜' }, { drawOnly: true });
  assert.equal(links.length, n + 1);
  assert.match(decodeURIComponent(links[n].href), /wght@900&/);
  assert.equal(book.drawStatus(r(100)), 'ready', 'the others keep their sheet');
  assert.equal(book.epoch, 1);
});

// --- 3. the parts 太る and 細る -----------------------------------------------------------------------------------------

const CATALOG = MV.use('parts/catalog').defaultRegistry();
const FAC = MV.use('engine/facade');
const F = MV.use('engine/scene/frame');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');

// Faces with Noto Sans JP 500 for display (every role), so a sample cut is laid out in a nine-weight family. A weight
// part's sample cut (engine/facade.samplePlan) takes the body face at 800: the parts reach down from 800.
const NOTO_THEME = { faces: { display: { ja: 'Noto Sans JP', latin: 'Inter', weight: 500, flavor: 'gothic' },
  serif: { ja: 'Noto Sans JP', latin: 'Inter', weight: 500, flavor: 'gothic' },
  body: { ja: 'Noto Sans JP', latin: 'Inter', weight: 500, flavor: 'gothic' } } };
const NOTO_FACES = JSON.parse(JSON.stringify(FACES.resolveFaces(NOTO_THEME, null, ['ja'])));

function sampleOf(kind, key, params) {
  return FAC.samplePlan(CATALOG, { kind, key, params: params || null }, { faces: NOTO_FACES });
}

test('太る and 細る: late, opt-in weight, pool false; 細る is a real exit; reach = thin × room below', () => {
  for (const [kind, key] of [['arrive', 'weightGrow'], ['depart', 'weightThin']]) {
    const def = CATALOG.get(kind, key);
    assert.deepEqual([def.pool, def.late, def.optIn, def.family], [false, true, 'weight', 'weight'], key);
    assert.ok(!CATALOG.pool(kind, {}).includes(key), key + ' is in no automatic pool');
    assert.ok(CATALOG.pool(kind, { optIn: ['weight'], role: 'lyric' }).includes(key), key + ' joins the opted-in pool');
  }
  assert.equal(CATALOG.get('arrive', 'weightGrow').weight, 2.5, 'calibrated to about 10 % of the eligible lines');
  const { engine } = engineWith(null);
  for (const [kind, key, reach] of [['arrive', 'weightGrow', 700], ['depart', 'weightThin', 700]]) {
    const plan = sampleOf(kind, key);
    assert.deepEqual([plan.cuts[0].slots['text.face'].v, plan.cuts[0].slots['text.weight'].v], ['body', 800], 'the tile: body face at 800');
    engine.setPlan(plan);
    const scene = engine.scene('cut', 0);
    const own = scene.behaviours.filter((b) => b.wt);
    assert.equal(own.length, 1, key + ': one weight behaviour');
    const b = own[0];
    assert.deepEqual([...b.wt], [-reach, 0], key + ': the reach is the room below 800');
    assert.equal(b.p.reach, reach);
    assert.deepEqual([...scene.wtReach], [-reach, 0]);
    if (kind === 'depart') assert.deepEqual([b.exit, b.t0, b.live], [true, scene.times.out, 'after'], '細る runs as an exit');
    else assert.deepEqual([b.exit, b.t0, b.live], [false, scene.times.a, 'until']);
  }
  // thin 0.5: half the room
  engine.setPlan(sampleOf('arrive', 'weightGrow', { thin: 0.5 }));
  assert.deepEqual([...engine.scene('cut', 0).wtReach], [-350, 0]);
  // a one-weight face: no room, no reach
  const heavy = { ja: 'Dela Gothic One', latin: 'Archivo Black', weight: 400, flavor: 'heavy' };
  const dela = JSON.parse(JSON.stringify(FACES.resolveFaces({ faces: { display: heavy, serif: NOTO_THEME.faces.serif, body: heavy } },
    null, ['ja'])));
  engine.setPlan(FAC.samplePlan(CATALOG, { kind: 'arrive', key: 'weightGrow' }, { faces: dela }));
  assert.deepEqual([...engine.scene('cut', 0).wtReach], [0, 0]);
});

test('太る: every glyph starts at the lightest weight, ends at the face weight (identity), fading in; 細る the reverse', () => {
  const { engine } = engineWith(null);
  engine.setPlan(sampleOf('arrive', 'weightGrow'));
  const scene = engine.scene('cut', 0);
  const glyphs = [];
  for (let i = scene.text.from; i < scene.text.to; i++) if (scene.stores.glyph[scene.table.payload[i]].cls !== 'space') glyphs.push(i);
  const b = scene.behaviours.find((x) => x.wt);
  F.evaluate(scene, b.t0 + 1e-6);
  assert.ok(glyphs.every((i) => close(scene.table.live.wt[i], -700, 0.01)), 'thin at the start');
  F.evaluate(scene, b.t1 + 1e-3);
  assert.ok(glyphs.every((i) => scene.table.live.wt[i] === 0), 'exactly the face weight after the entrance');
  engine.setPlan(sampleOf('depart', 'weightThin'));
  const s2 = engine.scene('cut', 0);
  const x = s2.behaviours.find((y) => y.wt);
  F.evaluate(s2, x.t0 - 1e-3);
  assert.ok([...s2.table.live.wt.subarray(s2.text.from, s2.text.to)].every((v) => v === 0), 'at rest before the exit');
  F.evaluate(s2, x.t1 - 1e-6);
  const g = s2.text.from + [...Array(s2.text.to - s2.text.from).keys()].find((j) => s2.stores.glyph[s2.table.payload[s2.text.from + j]].cls !== 'space');
  assert.ok(s2.table.live.wt[g] < -690, 'thin at the end: ' + s2.table.live.wt[g]);
});

// --- 3b. 脈打つ太さ (weightPulse) -------------------------------------------------------------------------------------------

// A hold of 脈打つ太さ over n glyphs laid out in `ref`, with (or without) a beat grid; → { b, env, sample(t) → wt of glyph 0 }.
function pulseOf(ref, p, grid, n = 3) {
  const def = CATALOG.get('dwell', 'weightPulse');
  const { env, target } = envAndTarget(n);
  env.times = { a: 0, rest: 1, out: 3, b: 3.4 };
  if (grid) env.grid = grid;
  target.runs = [{ layout: { n, fonts: [ref], font: null, cls: null } }];
  const params = Object.assign({ amount: 1, speed: 1, curve: 'linear', swing: 300, decay: 0.2, period: 1.6 }, p || {});
  const [b] = def.make(env, target, params);
  const P = {};
  for (const c of T.POSE) P[c] = new Float32Array(n).fill(BH.identityOf(c));
  const sample = (t) => { P.wt.fill(0); b.run(P, t, b); return P.wt[0]; };
  return { b, env, sample };
}

test('脈打つ太さ: late, opt-in weight; bolder where the face has room for the swing, else lighter, else toward the larger room', () => {
  const def = CATALOG.get('dwell', 'weightPulse');
  assert.deepEqual([def.pool, def.late, def.optIn, def.family, def.needs.includes('beats')], [false, true, 'weight', 'weight', true]);
  assert.ok(!CATALOG.pool('dwell', {}).includes('weightPulse'));
  assert.ok(CATALOG.pool('dwell', { optIn: ['weight'], role: 'lyric' }).includes('weightPulse'));
  const at = (w, family = 'Noto Sans JP') => FACES.faceRef(family, w, 'ja', 'gothic', 'display');
  const cases = [
    [at(100), { swing: 300 }, 1, 300, 'room above only'],
    [at(900), { swing: 300 }, -1, 300, 'room below only'],
    [at(500), { swing: 300 }, 1, 300, 'room both ways: bolder'],
    [at(800), { swing: 200 }, -1, 200, 'above 100 < swing: lighter'],
    [at(700, 'Zen Old Mincho'), { swing: 350 }, -1, 300, 'neither holds the swing: the larger room (below 300), capped by it'],
    [at(500), { swing: 400, amount: 0 }, 1, 200, '強さ 0: half the swing'],
    [at(400, 'Dela Gothic One'), { swing: 300 }, 1, 0, 'one weight: no pulse'],
    [at(100), { swing: 520 }, 1, 400, 'never past 400 (the jump limit), whatever reaches make'],
  ];
  for (const [ref, p, dir, amp, why] of cases) {
    const { b } = pulseOf(ref, p, null);
    assert.deepEqual([b.p.dirW, b.p.amp], [dir, amp], why);
    assert.deepEqual([...b.wt], dir > 0 ? [0, amp] : [-amp, 0], why + ': the declared reach');
  }
});

test('脈打つ太さ: with a 120 BPM grid it swells after each beat and is back at rest before the next, with no jumps', () => {
  const grid = { offset: 0, period: 0.5, meter: 4 };
  const ref = FACES.faceRef('Noto Sans JP', 500, 'ja', 'gothic', 'display');
  // the steepest settings: the largest swing, the shortest decay, the fastest speed — every 1/480 s step ≤ 60
  const steep = pulseOf(ref, { swing: 400, amount: 1, decay: 0.1, speed: 4 }, grid);
  assert.equal(steep.b.p.amp, 400);
  let last = steep.sample(1), maxStep = 0;
  for (let k = 1; k <= 960; k++) { const v = steep.sample(1 + k / 480); maxStep = Math.max(maxStep, Math.abs(v - last)); last = v; }
  assert.ok(maxStep <= 60, 'largest step ' + maxStep.toFixed(2));
  assert.ok(maxStep > 5, 'it does move: ' + maxStep.toFixed(2));
  // a typical pulse: the peak after every beat inside the hold reaches 0.8·amp·w; it has settled before the next beat
  const { b, sample } = pulseOf(ref, { swing: 300, amount: 1, decay: 0.2, speed: 1 }, grid);
  for (let beat = 1.5; beat < 2.8; beat += 0.5) {
    const w = BH.envelopeWeight(beat + 0.03, b.p.rest, 3);
    let peak = 0;
    for (let k = 0; k <= 48; k++) peak = Math.max(peak, sample(beat + k / 480));
    assert.ok(peak >= 0.8 * b.p.amp * w, 'beat ' + beat + ': peak ' + peak.toFixed(1) + ' vs ' + (0.8 * b.p.amp * w).toFixed(1));
    assert.ok(sample(beat + 0.49) < 0.05 * b.p.amp, 'beat ' + beat + ': at rest before the next');
    assert.equal(sample(beat), 0, 'nothing at the beat itself (the swell rises from it)');
  }
  // outside the hold (before rest, after out) nothing is written
  assert.equal(sample(0.9), 0);
  assert.equal(sample(3.05), 0);
});

test('脈打つ太さ: without a beat grid the weight breathes on a cosine of the period', () => {
  const ref = FACES.faceRef('Noto Sans JP', 500, 'ja', 'gothic', 'display');
  const { b, sample } = pulseOf(ref, { swing: 300, amount: 1, period: 1.6, speed: 1 }, null);
  const mid = 1 + 0.8;                                       // half a period after the hold starts: the full swell
  assert.ok(close(sample(mid), b.p.amp * BH.envelopeWeight(mid, 1, 3), 1e-2), 'full swell half a period in');
  assert.ok(Math.abs(sample(1 + 1.6)) < 1, 'back at rest a whole period in');
  let last = sample(1), maxStep = 0;
  for (let k = 1; k <= 960; k++) { const v = sample(1 + k / 480); maxStep = Math.max(maxStep, Math.abs(v - last)); last = v; }
  assert.ok(maxStep <= 60, 'largest step ' + maxStep.toFixed(2));
});

test('脈打つ太さ: a scene declares its reach; with 太る the reach is the union', () => {
  const { engine } = engineWith(null);
  const plan = sampleOf('dwell', 'weightPulse');
  assert.deepEqual([plan.cuts[0].slots['text.face'].v, plan.cuts[0].slots['text.weight'].v], ['body', 800]);
  engine.setPlan(plan);
  const scene = engine.scene('cut', 0);
  const pb = scene.behaviours.find((x) => x.wt);
  assert.equal(pb.p.dirW, -1, 'at 800 of Noto Sans JP only 100 above: it pulses lighter');
  assert.deepEqual([...scene.wtReach], [-pb.p.amp, 0]);
  // the same cut entering with 太る: the reach runs from the grow's lightest weight
  const both = JSON.parse(JSON.stringify(plan));
  Object.defineProperty(both, 'env', { enumerable: false, value: plan.env });
  both.cuts[0].slots.arrive = sampleOf('arrive', 'weightGrow').cuts[0].slots.arrive;
  both.cuts[0].fp = 'union';
  engine.setPlan(both);
  assert.deepEqual([...engine.scene('cut', 0).wtReach], [-700, 0], 'the union of [−700, 0] and [−amp, 0]');
});

// --- 4. draw-only faces: the facade --------------------------------------------------------------------------------------

// A FontBook double: every main face is loaded; draw-only faces are 'idle' until ready() or complete() loads them.
function fakeBook() {
  const calls = [], readies = [];
  const draw = new Map();
  const listeners = new Set();
  return {
    calls, readies,
    request(refs, text, opts) { calls.push({ refs: refs.slice(), text, drawOnly: !!(opts && opts.drawOnly) }); },
    async ready(refs, text, opts) {
      readies.push({ refs: refs.slice(), text, drawOnly: !!(opts && opts.drawOnly) });
      if (opts && opts.drawOnly) for (const r of refs) draw.set(r.key, 'ready');
      return { loaded: refs.slice(), failed: [] };
    },
    complete() { for (const c of calls) if (c.drawOnly) for (const r of c.refs) draw.set(r.key, 'ready'); for (const fn of listeners) fn({}); },
    status: () => 'ready',
    drawStatus(ref) { return draw.get(ref.key) || 'ready-main-or-idle'; },
    on(event, fn) { if (event === 'draw') listeners.add(fn); return () => listeners.delete(fn); },
    epoch: 0,
  };
}

function engineWith(fonts) {
  const rec = REC.createRecorder();
  const measurer = fakeMeasurer();
  const engine = FAC.createEngine({ registry: CATALOG, canvas: rec.factory, measurer, fonts, assets: null, strict: true });
  return { rec, engine, measurer };
}

test('facade: a scene with 太る asks for its lighter weights as draw-only faces; they never rebuild or hold up the scene', async () => {
  const book = fakeBook();
  // drawStatus: the main faces are ready; a draw-only face is idle until loaded
  const mainKeys = new Set();
  const status = book.drawStatus;
  book.drawStatus = (ref) => (mainKeys.has(ref.key) ? 'ready' : status(ref) === 'ready' ? 'ready' : 'idle');
  const { engine, rec, measurer } = engineWith(book);
  const plan = sampleOf('arrive', 'weightGrow');
  engine.setPlan(plan);
  for (const c of book.calls) for (const r of c.refs) if (!c.drawOnly) mainKeys.add(r.key);
  const scene = engine.scene('cut', 0);
  assert.equal(scene.provisional, false);
  const main = book.calls.filter((c) => !c.drawOnly).flatMap((c) => c.refs).filter((r) => r.family === 'Noto Sans JP');
  // the main usage: the weight the cut is laid out at (800) and the plan's display face (500, the estimate); no rung
  assert.deepEqual([...new Set(main.map((r) => r.weight))].sort(), [500, 800], 'the main usage holds only the laid-out faces');
  const draws = book.calls.filter((c) => c.drawOnly);
  assert.equal(draws.length, 1, 'one draw-only request');
  assert.deepEqual(draws[0].refs.map((r) => r.family + ' ' + r.weight), [100, 200, 300, 400, 500, 600, 700].map((w) => 'Noto Sans JP ' + w));
  assert.equal(draws[0].text['Noto Sans JP'], FACES.uniqueChars(scene.stores.glyph.filter((g) => g.cls !== 'space').map((g) => g.ch).join('')));
  const [url] = FACES.cssUrls(draws[0].refs, draws[0].text);
  assert.match(url, /family=Noto\+Sans\+JP:wght@100;200;300;400;500;600;700&text=/);
  // building again asks for nothing new
  engine.scene('cut', 0);
  assert.equal(book.calls.filter((c) => c.drawOnly).length, 1);
  // mid-motion before the rungs arrive: only the face weight is drawn
  const b = scene.behaviours.find((x) => x.wt);
  const t = plan.cuts[0].t0 + b.t0 + 0.3 * (b.t1 - b.t0);
  const surf = REC.surfaceOf(rec.factory, 640, 360);
  const fontsAt = () => {
    const m = rec.mark();
    engine.renderFrame(surf, t, { quality: 'export', pick: false, scale: 640 / plan.design.w });
    return [...new Set(rec.ops().slice(m).filter((op) => op[1] === 'set:font' && /Noto Sans JP/.test(op[2])).map((op) => Number(op[2].split(' ')[0])))].sort();
  };
  // nothing loaded yet: only faces the main path holds (the laid-out 800, and 500 as the plan's display face)
  assert.deepEqual(fontsAt(), [500, 800], 'nothing loaded yet: main faces only');
  // the rungs arrive: the same scene object, same measurer key, not provisional; the frame draws the rungs
  const key = measurer.key;
  book.complete();
  assert.equal(engine.scene('cut', 0), scene, 'not rebuilt');
  assert.equal(measurer.key, key);
  assert.equal(book.epoch, 0);
  assert.equal(scene.provisional, false);
  const drawn = fontsAt();
  assert.ok(drawn.some((w) => w !== 500 && w < 800), 'lighter rungs drawn once loaded: ' + drawn);
});

test('facade: export waits for the draw-only faces of the range', async () => {
  const book = fakeBook();
  const { engine } = engineWith(book);
  const plan = sampleOf('depart', 'weightThin');
  engine.setPlan(plan);
  await engine.prepare(0, plan.duration, { export: true });
  const drawReady = book.readies.filter((r) => r.drawOnly);
  assert.equal(drawReady.length, 1);
  assert.deepEqual(drawReady[0].refs.map((r) => r.weight), [100, 200, 300, 400, 500, 600, 700]);
  const mainReady = book.readies.filter((r) => !r.drawOnly);
  assert.ok(mainReady.length >= 1 && book.readies.indexOf(mainReady[0]) < book.readies.indexOf(drawReady[0]), 'main faces first');
  // a plan without weight parts waits for no draw-only face
  const other = fakeBook();
  const e2 = engineWith(other).engine;
  const p2 = sampleOf('arrive', 'fogIn');
  e2.setPlan(p2);
  await e2.prepare(0, p2.duration, { export: true });
  assert.equal(other.readies.filter((r) => r.drawOnly).length, 0);
  assert.equal(other.calls.filter((c) => c.drawOnly).length, 0);
});

test('facade + FontBook: a rung asked for by an earlier scene is ready only with a later scene\'s characters', async () => {
  const { doc, links } = fakeDocument();
  const book = createFontBook({ document: doc, timeoutMs: 2000 });
  const { engine } = engineWith(book);
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const build = (text, thin) => {
    engine.setPlan(FAC.samplePlan(CATALOG, { kind: 'arrive', key: 'weightGrow', params: { thin } }, { faces: NOTO_FACES, text }));
    return engine.scene('cut', 0);
  };
  // 1. 太る on 青い空 (rungs 100–700); 2. a shorter 太る on 夜の町 (500–700, new characters); 3. 太る on 夜の町 again
  // (100–700: every rung and character was asked for before, so the facade asks for nothing new)
  build('青い空', 1);
  for (let i = 0; i < 4; i++) await tick();
  build('夜の町', 0.35);
  for (let i = 0; i < 4; i++) await tick();
  const n = links.length;
  const scene = build('夜の町', 1);
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(links.length, n, 'the third scene needs no new sheet');
  const rungs = [];
  for (const g of scene.stores.glyph) {
    if (g.cls === 'space' || g.font.family !== 'Noto Sans JP') continue;
    for (const w of FACES.rungsBetween(g.font, ...scene.wtReach)) if (w !== g.font.weight && !rungs.includes(w)) rungs.push(w);
  }
  assert.ok(rungs.includes(100) && rungs.includes(400), 'rungs ' + rungs);
  for (const w of rungs) {
    const ref = FACES.atWeight(scene.stores.glyph.find((g) => g.font.family === 'Noto Sans JP').font, w);
    if (book.drawStatus(ref) !== 'ready') continue;
    const url = newestSheetOf(links, w);
    assert.ok(url && [...'夜の町'].every((c) => sheetText(url).includes(c)), w + ' is ready while its newest sheet lacks 夜の町: ' + url);
  }
  assert.equal(book.drawStatus(FACES.atWeight(NOTO, 100)), 'ready');
});

// --- 5. the planner: opt-in pools, text.weight, the grow rule, warnings, the rate ----------------------------------------

const corpus = require('../helpers/corpus.js');
const PL = MV.use('planner/plan');
const CA = MV.use('planner/cast');
const CMD = MV.use('core/commands');
const WEIGHT_KEYS = { arrive: 'weightGrow', dwell: 'weightPulse', depart: 'weightThin' };

function basicDoc(patch) {
  const doc = corpus.project('basic').doc;
  if (patch && patch.gen !== undefined) doc.look = Object.assign({}, doc.look, { gen: patch.gen });
  if (patch && patch.pins) doc.pins = Object.assign({}, doc.pins, patch.pins);
  return doc;
}
const pin = (v) => ({ v, by: 'user' });
const lyricCuts = (plan) => plan.cuts.filter((c) => c.role === 'lyric' || c.role === 'focus');
const traceKeys = (doc, cutKey, slot) => PL.trace(doc, { registry: CATALOG }, { cutKey, slot }).out.keys || [];

test('planner: an older document never sees a weight part or a text.weight; the switch off in a new work neither', () => {
  for (const doc of [basicDoc(), basicDoc({ gen: 1, pins: { 'work:weight.auto': pin(false) } })]) {
    const plan = PL.plan(doc, { registry: CATALOG });
    for (const c of plan.cuts) {
      assert.equal(c.slots['text.weight'], undefined, c.key);
      for (const kind of ['arrive', 'dwell', 'depart']) assert.ok(!CATALOG.get(kind, c.slots[kind].v).optIn, c.key + ' ' + kind);
    }
    const c = lyricCuts(plan)[0];
    for (const kind of ['arrive', 'dwell', 'depart']) assert.ok(!traceKeys(doc, c.key, kind).includes(WEIGHT_KEYS[kind]), kind);
  }
});

test('planner: in a new work the weight parts join the pools of cuts whose face has room and whose lettering crossfades', () => {
  // nightTram: display Dela Gothic One (one weight), serif Zen Old Mincho 700 (400–900), lettering glow
  const withFace = (theme, face, gen) => {
    const doc = basicDoc({ gen, pins: { 'work:theme': pin(theme) } });
    const plan = PL.plan(doc, { registry: CATALOG });
    const c = lyricCuts(plan)[1];
    const d = basicDoc({ gen, pins: { 'work:theme': pin(theme), ['line/' + c.line + ':text.face']: pin(face) } });
    return { doc: d, key: c.key };
  };
  let x = withFace('nightTram', 'serif', 1);
  assert.ok(traceKeys(x.doc, x.key, 'arrive').includes('weightGrow'), 'serif 700 Zen Old Mincho: 太る offered');
  assert.ok(traceKeys(x.doc, x.key, 'depart').includes('weightThin'), 'serif 700: 細る offered (300 below)');
  x = withFace('nightTram', 'display', 1);
  assert.ok(!traceKeys(x.doc, x.key, 'arrive').includes('weightGrow'), 'Dela Gothic One: no room');
  x = withFace('risoPink', 'body', 1);
  assert.ok(!traceKeys(x.doc, x.key, 'arrive').includes('weightGrow'), 'duo lettering: never automatic');
  x = withFace('nightTram', 'serif', 0);
  assert.ok(!traceKeys(x.doc, x.key, 'arrive').includes('weightGrow'), 'an older document: never');
  // weightOptIn itself: the style and the room
  const plan = PL.plan(basicDoc({ gen: 1, pins: { 'work:theme': pin('monoPress') } }), { registry: CATALOG });
  const cut = lyricCuts(plan)[0];
  const st = (slots, weight) => ({ ctx: { glyph: { weight }, look: { plan: plan.look } }, cut, slots });
  const face = (v, style) => ({ 'text.face': { v, from: 'auto' }, 'text.style': { v: style || 'plain', from: 'auto' } });
  assert.deepEqual(CA.weightOptIn(st(face('body'), true), 'arrive'), ['weight'], 'Noto Sans JP 500: 100 → 800');
  assert.equal(CA.weightOptIn(st(face('body'), false), 'arrive'), null, 'switch off');
  assert.equal(CA.weightOptIn(st(face('body', 'outline'), true), 'arrive'), null, 'outline');
  assert.deepEqual(CA.weightOptIn(st(face('body', 'glow'), true), 'dwell'), ['weight']);
  assert.equal(CA.weightOptIn(st(face('display'), true), 'depart'), ['weight'].length ? CA.weightOptIn(st(face('display'), true), 'depart') : null);
  assert.equal(CA.weightOptIn(Object.assign(st(face('body'), true), { cut: Object.assign({}, cut, { role: 'title' }) }), 'arrive'), null,
    'lyric and focus cuts only');
});

test('planner: the grow rule gives 太る the bold end of the face; a 太さ pin wins; motion-own has none', () => {
  const base = PL.plan(basicDoc({ gen: 1, pins: { 'work:theme': pin('monoPress') } }), { registry: CATALOG });
  const c = lyricCuts(base)[2];
  const pins = { 'work:theme': pin('monoPress'), ['line/' + c.line + ':text.face']: pin('body'), ['line/' + c.line + ':arrive']: pin('weightGrow') };
  let plan = PL.plan(basicDoc({ gen: 1, pins }), { registry: CATALOG });
  let cut = plan.cuts.find((x) => x.key === c.key);
  assert.equal(cut.slots.arrive.v, 'weightGrow');
  assert.deepEqual(cut.slots['text.weight'], { v: 800, from: 'rule' }, 'Noto Sans JP 500 grows to 800');
  const traced = PL.trace(basicDoc({ gen: 1, pins }), { registry: CATALOG }, { cutKey: c.key, slot: 'text.weight' });
  assert.equal(traced.out.rule, 'weight.grow');
  // a 太さ pin wins
  plan = PL.plan(basicDoc({ gen: 1, pins: Object.assign({}, pins, { ['line/' + c.line + ':text.weight']: pin(600) }) }), { registry: CATALOG });
  cut = plan.cuts.find((x) => x.key === c.key);
  assert.deepEqual([cut.slots['text.weight'].v, cut.slots['text.weight'].from], [600, 'pin:line']);
  // the switch off (an older document): the pinned 太る grows to the face's own weight
  plan = PL.plan(basicDoc({ pins }), { registry: CATALOG });
  assert.equal(plan.cuts.find((x) => x.key === c.key).slots['text.weight'], undefined);
  // a layout that moves the text itself forces the motions: no rule
  const own = CATALOG.all('arrange').find((d) => d.motion === 'own' && CATALOG.traits('arrange', d.key).roles.includes('lyric'));
  plan = PL.plan(basicDoc({ gen: 1, pins: Object.assign({}, pins, { ['line/' + c.line + ':arrange']: pin(own.key) }) }), { registry: CATALOG });
  cut = plan.cuts.find((x) => x.key === c.key);
  assert.notEqual(cut.slots.arrive.v, 'weightGrow');
  assert.equal(cut.slots['text.weight'], undefined);
});

test('planner: a pinned weight part where it cannot show warns weight-flat / weight-style, also from the cast cache', () => {
  const base = PL.plan(basicDoc({ gen: 1, pins: { 'work:theme': pin('nightTram') } }), { registry: CATALOG });
  const c = lyricCuts(base)[1];
  const flat = { 'work:theme': pin('nightTram'), ['line/' + c.line + ':text.face']: pin('display'), ['line/' + c.line + ':arrive']: pin('weightGrow') };
  const styled = { 'work:theme': pin('monoPress'), ['line/' + c.line + ':text.face']: pin('body'), ['line/' + c.line + ':text.style']: pin('outline'),
    ['line/' + c.line + ':depart']: pin('weightThin') };
  for (const [pins, code, family] of [[flat, 'weight-flat', 'Dela Gothic One'], [styled, 'weight-style', 'Noto Sans JP']]) {
    for (let k = 0; k < 2; k++) {                                  // the second plan takes the casts from the cache
      const plan = PL.plan(basicDoc({ gen: 1, pins }), { registry: CATALOG });
      const w = plan.warnings.filter((x) => x.code === code);
      const own = plan.cuts.filter((x) => x.line === c.line).map((x) => x.key);
      assert.equal(w.length, own.length, code + ' plan ' + k + ': once per cut of the line');
      assert.ok(w.every((x) => own.includes(x.cut) && x.line === c.line && x.detail === family), JSON.stringify(w));
      if (k === 1) assert.ok(plan.reuse.casts > 0, 'the cast cache was used');
    }
  }
  // the automatic path never warns
  const auto = PL.plan(basicDoc({ gen: 1 }), { registry: CATALOG });
  assert.ok(!auto.warnings.some((x) => x.code === 'weight-flat' || x.code === 'weight-style'));
});

test('planner: a text.weight pin decides its cuts alone and changes their fingerprints; commands scope the switches', () => {
  const doc = basicDoc();
  const plan = PL.plan(doc, { registry: CATALOG });
  const c = lyricCuts(plan)[1];
  const pinned = PL.plan(basicDoc({ pins: { ['line/' + c.line + ':text.weight']: pin(700) } }), { registry: CATALOG });
  for (const cut of pinned.cuts) {
    const before = plan.cuts.find((x) => x.key === cut.key);
    if (cut.line === c.line) {
      assert.deepEqual([cut.slots['text.weight'].v, cut.slots['text.weight'].from], [700, 'pin:line']);
      assert.notEqual(cut.fp, before.fp, 'the scene changes');
    } else assert.equal(cut.fp, before.fp, cut.key + ' unchanged');
  }
  // commands: 太さ is copied by paste-look; the switches are refused where they do not belong
  const lines = plan.lines.map((l) => l.id);
  let d = CMD.reduce(doc, { t: 'pin.set', path: 'line/' + lines[1] + ':text.weight', v: 700, by: 'user' });
  d = CMD.reduce(d, { t: 'pin.copy', from: 'line/' + lines[1], to: ['line/' + lines[2]] });
  assert.equal(d.pins['line/' + lines[2] + ':text.weight'].v, 700);
  assert.throws(() => CMD.reduce(doc, { t: 'pin.set', path: 'cut/' + c.key + ':weight.auto', v: true, by: 'user', sig: c.text }));
  assert.throws(() => CMD.reduce(doc, { t: 'pin.set', path: 'line/' + c.line + ':weight.auto', v: true, by: 'user' }));
  assert.throws(() => CMD.reduce(doc, { t: 'pin.set', path: 'cut/' + c.key + ':morph.auto', v: true, by: 'user', sig: c.text }));
  assert.ok(CMD.reduce(doc, { t: 'pin.set', path: 'line/' + c.line + ':morph.auto', v: true, by: 'user' }).pins['line/' + c.line + ':morph.auto']);
  assert.ok(CMD.reduce(doc, { t: 'pin.set', path: 'work:weight.auto', v: false, by: 'user' }).pins['work:weight.auto']);
});

test('planner: 太る is chosen on about 10 % of the eligible lyric lines of new works, 脈打つ太さ on about 4 % (rate)', () => {
  let eligible = 0, grow = 0, pulseEligible = 0, pulse = 0;
  for (const { doc } of corpus.corpus(2, ['16:9'])) {
    doc.look.gen = 1;
    const plan = PL.plan(doc, { registry: CATALOG });
    for (const c of lyricCuts(plan)) {
      const st = { ctx: { glyph: { weight: true }, look: { plan: plan.look } }, cut: c, slots: c.slots };
      if (CA.weightOptIn(st, 'dwell')) { pulseEligible++; if (c.slots.dwell.v === 'weightPulse') pulse++; }
      if (!CA.weightOptIn(st, 'arrive')) continue;
      eligible++;
      if (c.slots.arrive.v === 'weightGrow') grow++;
    }
  }
  const share = grow / eligible;
  assert.ok(eligible > 300, 'eligible cuts: ' + eligible);
  assert.ok(share >= 0.06 && share <= 0.14, '太る on ' + (100 * share).toFixed(1) + ' % of the eligible lines');
  // 脈打つ太さ: weight 0.5 (the dwell pools are about half the size of the entrance pools; weight 1 gave 6.7 %)
  const pulseShare = pulse / pulseEligible;
  assert.ok(pulseEligible > 300, 'eligible for 脈打つ太さ: ' + pulseEligible);
  assert.ok(pulseShare >= 0.02 && pulseShare <= 0.07, '脈打つ太さ on ' + (100 * pulseShare).toFixed(1) + ' % of the eligible lines');
});

// --- 6. the build: text.weight faces -----------------------------------------------------------------------------------

test('build: text.weight lays out the lyrics of the cut in that weight; notes keep theirs', () => {
  const { engine } = engineWith(null);
  const plan = sampleOf('arrive', 'fogIn');
  const cut = Object.assign({}, plan.cuts[0], { fp: plan.cuts[0].fp + 'w', note: 'ノート', slots: Object.assign({}, plan.cuts[0].slots,
    { 'text.face': { v: 'display', from: 'pin:cut' }, 'text.weight': { v: 800, from: 'pin:cut' } }) });
  const heavy = Object.assign({}, plan, { cuts: [cut].concat(plan.cuts.slice(1)) });
  // the notes are laid out in the body role: give it another family to tell them apart
  heavy.look = Object.assign({}, plan.look, { faces: Object.assign({}, plan.look.faces, { body: { ja: { family: 'Zen Kaku Gothic New', weight: 500 },
    latin: { family: 'Inter', weight: 500 } } }) });
  engine.setPlan(heavy);
  const scene = engine.scene('cut', 0);
  const lyric = scene.stores.glyph.filter((g) => g.cls !== 'space' && g.font.family === 'Noto Sans JP');
  assert.ok(lyric.length > 0);
  assert.ok(lyric.every((g) => g.font.weight === 800), 'the lyrics at 800');
  const notes = scene.stores.glyph.filter((g) => g.font.family === 'Zen Kaku Gothic New');
  assert.ok(notes.length > 0 && notes.every((g) => g.font.weight === 500), 'a note keeps its weight');
  engine.setPlan(plan);
  assert.ok(engine.scene('cut', 0).stores.glyph.filter((g) => g.cls !== 'space').every((g) => g.font.weight === 500));
});

test('planner: re-planning a new work after weight edits gives exactly the plan made from scratch', () => {
  const R = MV.use('core/rng');
  const rng = R.stream(7, 'weight-replan');
  let doc = basicDoc({ gen: 1, pins: { 'work:theme': pin('monoPress') } });
  let plan = PL.plan(doc, { registry: CATALOG });
  const EDITS = [
    (d, c, l) => ({ ['line/' + l + ':text.weight']: pin(rng.pick([300, 600, 900])) }),
    (d, c, l) => ({ ['line/' + l + ':arrive']: pin('weightGrow') }),
    (d, c, l) => ({ ['line/' + l + ':depart']: pin('weightThin') }),
    (d, c, l) => ({ ['line/' + l + ':text.face']: pin(rng.pick(['display', 'serif', 'body'])) }),
    (d, c, l) => ({ ['line/' + l + ':text.style']: pin(rng.pick(['plain', 'outline', 'glow'])) }),
    () => ({ 'work:weight.auto': pin(rng.pick([true, false])) }),
    (d, c) => ({ ['cut/' + c.key + ':text.weight']: Object.assign(pin(800), { sig: c.text }) }),
  ];
  for (let i = 0; i < 24; i++) {
    const cut = rng.pick(lyricCuts(plan));
    const next = Object.assign({}, doc, { pins: Object.assign({}, doc.pins, rng.pick(EDITS)(doc, cut, cut.line)) });
    if (rng.chance(0.25) && Object.keys(next.pins).length > 1) {
      const k = rng.pick(Object.keys(next.pins).filter((x) => x !== 'work:theme'));
      if (k) delete next.pins[k];
    }
    doc = next;
    plan = PL.plan(doc, { registry: CATALOG });
    const fresh = PL.run(doc, CATALOG, { fresh: true });
    assert.equal(plan.hash, fresh.hash, 'edit ' + i);
    assert.deepEqual(plan.warnings, fresh.warnings, 'edit ' + i + ' warnings');
  }
});
