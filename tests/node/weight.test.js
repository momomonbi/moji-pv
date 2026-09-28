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
