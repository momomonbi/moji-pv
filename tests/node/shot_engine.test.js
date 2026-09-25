/* 文字PVメーカー v2 — original work. Tests: shots at scene build and per frame — framing, anchors, aims, the reading path, interpolation, the lean, composition with the lens (DESIGN_2_1 §3.10, §4.4, §4.5, §7.3). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');

const MV = load();
const N = MV.use('core/num');
const CV = MV.use('core/curve');
const SHOT = MV.use('core/shot');
const MAT = MV.use('core/mat');
const FAC = MV.use('engine/facade');
const BUILD = MV.use('engine/scene/build');
const F = MV.use('engine/scene/frame');
const SS = MV.use('engine/scene/shot');
const STG = MV.use('engine/scene/stagger');
const K = MV.use('parts/kit');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');

const REG = MV.use('parts/catalog').defaultRegistry();
const TEXTS = Object.freeze({ short: 'はじまりの朝', three: '夜明けの街を 走る光と 君の声', en: 'Paper planes in the morning light' });

// A part's params at their auto values: the fixed value, else the middle of the range, else the first pick.
function autoParams(slot, key) {
  const p = {};
  for (const { name, spec } of REG.params(slot, key)) {
    p[name] = spec.auto && 'value' in spec.auto ? spec.auto.value : spec.auto && spec.auto.range
      ? (spec.auto.range[0] + spec.auto.range[1]) / 2 : spec.auto && spec.auto.pick ? spec.auto.pick[0] : spec.min;
  }
  return p;
}

// A canned cut (engine/facade.samplePlan kind 'shot') with the shot `shot` (a preset key or a Shot) and cam.* params,
// built strictly. o = { shot, text, aspect, orient, zoom, curve, follow, lens, lensParams, arrive, arriveParams, beats }
function shotScene(o) {
  const plan = FAC.samplePlan(REG, { kind: 'shot', key: o.shot, params: { zoom: o.zoom, curve: o.curve, follow: o.follow } },
    { text: o.text || TEXTS.short, aspect: o.aspect || '16:9', orient: o.orient });
  const cut = plan.cuts[0];
  const put = (slot, key, params) => {
    cut.slots = Object.assign({}, cut.slots, { [slot]: { v: key, p: Object.assign(autoParams(slot, key), params), from: 'pin' } });
  };
  if (o.lens) put('lens', o.lens, o.lensParams);
  if (o.arrive) put('arrive', o.arrive, o.arriveParams);
  if (o.beats === null) plan.beats = null;
  cut.fp += ':' + JSON.stringify([o.lens, o.lensParams, o.arrive, o.arriveParams, o.beats]);
  const svc = { registry: REG, text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
  const scene = BUILD.buildCut(cut, plan, svc);
  return { plan, cut, scene, W: plan.design.w, H: plan.design.h, short: plan.design.short };
}

function poseAt(scene, tl) { return SS.poseAt(scene.shot, tl, {}); }

// Where a rest-world point (from the frame centre) appears on screen under a shot pose (roll 0), from the frame centre.
function screenOf(pose, cx, cy) { return [pose.zoom * (cx - pose.x), pose.zoom * (cy - pose.y)]; }

function steps(lo, hi, n) { return Array.from({ length: n + 1 }, (_, k) => lo + ((hi - lo) * k) / n); }

function boxCentre(b, W, H) { return [b.x + b.w / 2 - W / 2, b.y + b.h / 2 - H / 2]; }

test('engine/scene/shot exports the §3.10 interface; kit exports the §3.11 helpers', () => {
  for (const name of ['makeShot', 'aimBox', 'anchorTime', 'frame', 'poseAt', 'runShot', 'leanInto']) {
    assert.equal(typeof SS[name], 'function', 'shot.' + name);
  }
  for (const name of ['curve', 'warp', 'warped', 'aimBox', 'frameBox', 'media', 'mediaParams', 'runKenBurns']) {
    assert.equal(typeof K[name], 'function', 'K.' + name);
  }
  assert.deepEqual(K.CURVES, CV.PRESET_KEYS);
  assert.equal(K.curve('softEnds'), CV.fn('softEnds'), 'K.curve is CV.fn (memoized)');
  assert.equal(K.warp('dashStop'), CV.warp('dashStop'));
});

test('a text aim fills `fill` of the frame (±1 %) at its key time, keeping the aim where the composition put it', () => {
  const shot = { keys: [{ at: 'a', aim: 'block', fill: 0.5 }, { at: 'b', aim: 'first', fill: 0.7 }] };
  for (const aspect of ['16:9', '9:16', '1:1']) {
    const { scene, W, H, short } = shotScene({ shot, aspect });
    const m = SS.FLOOR * short;
    const tr = scene.shot;
    assert.equal(tr.keys.length, 2);
    for (const [k, fill] of [[0, 0.5], [1, 0.7]]) {
      const key = tr.keys[k], b = key.box;
      const pose = poseAt(scene, key.t);
      const filled = pose.zoom * Math.max(Math.max(b.w, m) / W, Math.max(b.h, m) / H);
      if (pose.zoom > 0.9 + 1e-9 && pose.zoom < 3 - 1e-9) approx(filled, fill, 0.01 * fill, aspect + ' key ' + k + ' fills ' + filled);
      // keep: the aim centre stays at its rest position on screen, unless a clamp moved it
      const [cx, cy] = boxCentre(b, W, H);
      const [sx, sy] = screenOf(pose, cx, cy);
      const lim = SS.bleedLimit(W, pose.zoom);
      if (Math.abs(pose.x) < lim - 1e-6) approx(sx, cx, 1e-6, aspect + ' keep x');
      if (Math.abs(pose.y) < SS.bleedLimit(H, pose.zoom) - 1e-6) approx(sy, cy, 1e-6, aspect + ' keep y');
    }
  }
});

test('ox / oy place the aim centre on screen; the zoomed box stays in the safe area; the camera stays within the bleed', () => {
  const W = 1920, H = 1080, D = { w: W, h: H, short: H };
  const box = { x: 900, y: 500, w: 120, h: 80 };
  // ox/oy: the aim centre lands at (ox·W, oy·H) from the frame centre when neither clamp applies
  const f = SS.frame(D, box, { fill: 0.3, ox: 0.05, oy: -0.04 });
  const [sx, sy] = screenOf({ x: f.X, y: f.Y, zoom: f.Z }, box.x + 60 - W / 2, box.y + 40 - H / 2);
  approx(sx, 0.05 * W, 1e-6); approx(sy, -0.04 * H, 1e-6);
  // safe area: a box asked to sit past the edge is clamped so its zoomed half-size fits inside W/2 − 0.05·short
  const g = SS.frame(D, box, { fill: 0.5, ox: 0.4 });
  const hw = (Math.max(box.w, 0.06 * H) * g.Z) / 2, s = 0.05 * H;
  approx(g.sx, W / 2 - s - hw, 1e-6, 'right edge of the zoomed box on the safe line');
  // bleed: a box at the frame corner with keep asks for a large camera offset; it is clamped to LX(Z)
  for (const Z of [0.9, 1, 1.5, 3]) {
    const corner = SS.frame(D, { x: 20, y: 20, w: 10, h: 10 }, { fill: Z * 0.06 * H / W * (W / H) });
    assert.ok(Math.abs(corner.X) <= SS.bleedLimit(W, corner.Z) + 1e-9 && Math.abs(corner.Y) <= SS.bleedLimit(H, corner.Z) + 1e-9);
  }
  // the bleed formula: ±0.083 W at Z = 1; parallax 1.2 decides at 1.5 (W · (0.6 − 0.5/1.6) / 1.2)
  approx(SS.bleedLimit(W, 1), W * (0.1 / 1.2), 1e-9);
  approx(SS.bleedLimit(W, 1.5), W * (0.6 - 0.5 / 1.6) / 1.2, 1e-9);
  // frame and point aims use key.zoom in [0.9, 1.25]; a point aim centres on (px·W, py·H)
  approx(SS.frame(D, { x: 0, y: 0, w: W, h: H }, { zoom: 2 }).Z, 1.25, 0);
  const env = { D };
  const p = SS.aimBox(env, null, 'point', { px: 0.25, py: 0.75 });
  assert.deepEqual([p.x, p.y, p.w, p.h], [0.25 * W, 0.75 * H, 0, 0]);
  assert.deepEqual(SS.aimBox(env, null, 'frame'), { x: 0, y: 0, w: W, h: H });
});

test('aims: block, emph, first, last, word:k, line:k, glyph:k; every text box is floored at 0.06 × short per side', () => {
  const { scene, W, short } = shotScene({ shot: 'settle', text: TEXTS.three });
  const env = { D: { w: W, h: scene.table ? 1080 : 1080, short } };
  const t = scene.target;
  const m = 0.06 * short;
  const block = SS.aimBox(env, t, 'block');
  assert.ok(block.w >= t.focus.w - 1e-9 && block.w >= m && block.h >= m);
  const first = SS.aimBox(env, t, 'first'), w0 = SS.aimBox(env, t, 'word:0'), last = SS.aimBox(env, t, 'last');
  assert.deepEqual(first, w0, 'first = word:0');
  assert.deepEqual(last, SS.aimBox(env, t, 'word:-1'), 'last = word:-1');
  assert.deepEqual(SS.aimBox(env, t, 'word:40'), last, 'word:k clamps to the last word');
  assert.deepEqual(SS.aimBox(env, t, 'word:-20'), first, 'negative k clamps to the first word');
  const g = SS.aimBox(env, t, 'glyph:0');
  assert.ok(g.w >= m - 1e-9 && g.h >= m - 1e-9, 'a one-glyph aim is floored');
  // emph: the first emphasized run ('夜明' is emphasized by the sample: [[0, 2]])
  const e = SS.aimBox(env, t, 'emph'), g0 = SS.aimBox(env, t, 'glyph:0'), g1 = SS.aimBox(env, t, 'glyph:1');
  assert.ok(e.x <= g0.x + 1e-6 && e.x + e.w >= g1.x + g1.w - 1e-6, 'emph covers its glyphs');
  const lines = t.units.line;
  assert.ok(lines >= 2, 'the sample has two lines');
  assert.notDeepEqual(SS.aimBox(env, t, 'line:0'), SS.aimBox(env, t, 'line:1'));
  assert.deepEqual(SS.aimBox(env, t, 'line:8'), SS.aimBox(env, t, 'line:' + (lines - 1)), 'line:k clamps');
  // no emphasis → emph aims at the whole block (not the last word: the words before it would leave the frame)
  const plain = plainScene({ shot: 'settle', text: TEXTS.three }).scene.target;
  assert.deepEqual(SS.aimBox(env, plain, 'emph'), SS.aimBox(env, plain, 'block'));
  assert.notDeepEqual(SS.aimBox(env, plain, 'emph'), SS.aimBox(env, plain, 'last'));
});

// shotScene without the sample's emphasis (the canned cut emphasizes its first two glyphs), on an arrange of choice.
function plainScene(o) {
  const plan = FAC.samplePlan(REG, { kind: 'shot', key: o.shot, params: { zoom: o.zoom } },
    { text: o.text, aspect: o.aspect || '16:9', orient: o.orient });
  const cut = plan.cuts[0];
  const slots = Object.assign({}, cut.slots);
  if (o.arrange) slots.arrange = { v: o.arrange, p: Object.assign(autoParams('arrange', o.arrange), o.arrangeParams), from: 'pin' };
  Object.assign(cut, { emph: [], impact: !!o.impact, note: o.note || null, role: o.role || cut.role, slots });
  cut.fp += ':plain:' + JSON.stringify([o.arrange, o.arrangeParams, o.note, o.role]);
  const svc = { registry: REG, text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
  return { plan, cut, scene: BUILD.buildCut(cut, plan, svc), W: plan.design.w, H: plan.design.h };
}

// The glyphs of the lyric's main copy: of runs laid out from a span, the first of those that share one (echoStack's
// fading copies share the main line's span); spaces left out.
function mainGlyphs(t) {
  const seen = new Set();
  const keep = t.runs.map((r) => {
    const span = r.spec.span ? r.spec.span.join(',') : null;
    if (span === null || seen.has(span)) return false;
    seen.add(span);
    return true;
  });
  return [...Array(t.to - t.from).keys()].filter((j) => t.cls[j] !== 'space' && keep[t.unitOf.run[j]]);
}

// How far glyph box j (x0 y0 x1 y1 at rest) reaches beyond the frame edge under a shot pose (roll 0), in du on screen.
function beyondFrame(pose, t, j, W, H) {
  const x0 = pose.zoom * (t.box[j * 4] - W / 2 - pose.x) + W / 2, x1 = pose.zoom * (t.box[j * 4 + 2] - W / 2 - pose.x) + W / 2;
  const y0 = pose.zoom * (t.box[j * 4 + 1] - H / 2 - pose.y) + H / 2, y1 = pose.zoom * (t.box[j * 4 + 3] - H / 2 - pose.y) + H / 2;
  return Math.max(-x0, -y0, x1 - W, y1 - H, 0);
}

// Step (b) of the goldens, round 2 (NOTES "Step (b): automatic camerawork"): snapZoom, now the usual shot of an impact
// cut, zoomed onto the last word of a line nobody emphasized, and 'Go' of 「Go/まっすぐに!」 was off-frame while it was
// sung; pushWord did the same on plain lines. Every word of a plain line stays on-frame while it is sung, at the closest
// cam.zoom (1; an impact cut gets at most 0.95), on the arranges that lay such a line out in one block or around a giant.
test('snapZoom and pushWord on a line without emphasis keep every word on-frame while it is sung', () => {
  for (const shot of ['snapZoom', 'pushWord']) {
    for (const [text, arrange] of [['Go まっすぐに!', null], ['Go まっすぐに!', 'giantWhisper'], [TEXTS.three, null],
      [TEXTS.three, 'giantWhisper'], [TEXTS.en, 'echoStack']]) {
      for (const aspect of ['16:9', '9:16', '1:1']) {
        const { scene, cut, W, H } = plainScene({ shot, text, arrange, aspect, zoom: 1, impact: true });
        const t = scene.target, span = cut.t1 - cut.t0, name = [shot, text, arrange, aspect].join(' ');
        const frac = STG.sungFractions({ cut, times: scene.times }, t, 'word');
        const byWord = new Map();
        for (const j of mainGlyphs(t)) byWord.set(t.unitOf.word[j], (byWord.get(t.unitOf.word[j]) || []).concat(j));
        assert.ok(byWord.size >= 2, name + ' has several words');
        const starts = [...byWord.values()].map((js) => frac[js[0]] * span).sort((a, b) => a - b);
        for (const js of byWord.values()) {
          // the word's sung window: from its start to the next word's (the last word: to the line's end), at least 0.2 s
          const s0 = frac[js[0]] * span, next = starts.find((s) => s > s0 + 1e-9);
          const s1 = Math.min(scene.times.b, Math.max(next === undefined ? span : next, s0 + 0.2));
          for (const tl of steps(s0, s1, 12)) {
            const pose = poseAt(scene, tl);
            for (const j of js) {
              assert.ok(beyondFrame(pose, t, j, W, H) < 0.5, name + ': ' + t.ch[j] + ' leaves the frame at ' + tl.toFixed(2));
            }
          }
        }
      }
    }
  }
});

// An arrange may lay out text of its own beside the lyric (sidebarIndex's index number, a side note). Word, line and
// glyph aims pick the lyric only: in step (b) of the goldens pushWord and snapZoom aimed at the number '03' as the
// last word, and the lyric left the frame (NOTES "Step (b): automatic camerawork").
test("aims never pick an arrange's own text (sidebarIndex's number): word, line and glyph aims stay on the lyric", () => {
  const plan = FAC.samplePlan(REG, { kind: 'arrange', key: 'sidebarIndex', params: { number: '03', side: 'right', size: 0.3 } },
    { text: TEXTS.three, aspect: '16:9' });
  const cut = plan.cuts[0];
  const svc = { registry: REG, text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
  const t = BUILD.buildCut(cut, plan, svc).target;
  const env = { D: plan.design };
  const lyric = (j) => !!t.runs[t.unitOf.run[j]].spec.span;
  const n = t.to - t.from;
  const number = [], words = [];
  for (let j = 0; j < n; j++) {
    if (t.cls[j] === 'space') continue;
    if (lyric(j)) words.push(j); else number.push(j);
  }
  assert.deepEqual(number.map((j) => t.ch[j]), ['0', '3'], 'the index number is a run of its own');
  const inside = (b, j) => { const cx = (t.box[j * 4] + t.box[j * 4 + 2]) / 2, cy = (t.box[j * 4 + 1] + t.box[j * 4 + 3]) / 2;
    return cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h; };
  for (const aim of ['first', 'last', 'emph', 'word:-1', 'word:40', 'line:-1', 'line:8', 'glyph:-1', 'glyph:80']) {
    const b = SS.aimBox(env, t, aim);
    assert.ok(words.some((j) => inside(b, j)), aim + ' holds lyric glyphs');
    assert.ok(!number.some((j) => inside(b, j)), aim + ' leaves the number out');
  }
  const lastWord = t.unitOf.word[words[words.length - 1]];
  const want = words.filter((j) => t.unitOf.word[j] === lastWord);
  const box = SS.aimBox(env, t, 'last');
  assert.ok(want.every((j) => inside(box, j)), 'last = the lyric\'s last word');
  // The block aim keeps the arrange's focus (the whole composition, number included).
  assert.deepEqual(SS.aimBox(env, t, 'block'), { x: t.focus.x, y: t.focus.y, w: t.focus.w, h: t.focus.h });
});

// echoStack lays the line out again in fading copies (runs with the main line's span); its focus is the main line.
// Word, line and glyph aims pick the main copy: pushWord and snapZoom aimed at the last copy's last word, and the main
// line left the frame (step (b) of the goldens, round 2).
test('aims on echoStack pick the main line, never a fading copy', () => {
  for (const aspect of ['16:9', '9:16']) {
    for (const dir of ['down', 'up', 'split']) {
      const { scene, plan } = plainScene({ shot: 'settle', text: TEXTS.three, arrange: 'echoStack', arrangeParams: { copies: 4, dir },
        aspect });
      const t = scene.target, env = { D: plan.design };
      const f = t.focus, main = mainGlyphs(t), m = SS.FLOOR * env.D.short;
      assert.ok(t.runs.filter((r) => r.spec.span).length >= 4, 'the copies are runs with the span');
      const within = (b) => b.x + b.w / 2 >= f.x - m && b.x + b.w / 2 <= f.x + f.w + m && b.y + b.h / 2 >= f.y - m &&
        b.y + b.h / 2 <= f.y + f.h + m;
      for (const aim of ['first', 'last', 'emph', 'word:1', 'word:-1', 'line:-1', 'glyph:-1', 'glyph:0']) {
        assert.ok(within(SS.aimBox(env, t, aim)), aspect + ' ' + dir + ': ' + aim + ' lies in the main line');
      }
      const last = SS.aimBox(env, t, 'last'), lastMain = main[main.length - 1];
      assert.ok(last.x <= t.box[lastMain * 4] + 1e-6 && last.x + last.w >= t.box[lastMain * 4 + 2] - 1e-6,
        'last = the main line\'s last word');
    }
  }
});

// spineColumn splits a title with a note (the artist) into two column pieces around it and gives the upper piece as
// its focus (ornaments frame it). The block aim grows to the whole title, so pullReveal and settle keep its tail
// (「バス停」) in the frame (step (b) of the goldens, round 2).
test("the block aim holds every lyric glyph inside the frame, also where the arrange's focus is one piece of it", () => {
  for (const aspect of ['16:9', '9:16', '1:1']) {
    const { scene, plan, W, H } = plainScene({ shot: 'settle', text: '夜明けのバス停', arrange: 'spineColumn', orient: 'v',
      role: 'title', note: 'テスト合唱団', aspect });
    const t = scene.target, env = { D: plan.design };
    assert.equal(t.runs.filter((r) => r.spec.span).length, 2, aspect + ': the title is split around its note');
    const f = t.focus, block = SS.aimBox(env, t, 'block');
    const inFocus = (j) => t.box[j * 4 + 3] <= f.y + f.h + 1e-6;
    assert.ok(mainGlyphs(t).some((j) => !inFocus(j)), aspect + ': the focus is the upper piece only');
    const inBlock = (j) => t.box[j * 4] >= block.x - 1e-6 && t.box[j * 4 + 2] <= block.x + block.w + 1e-6 &&
      t.box[j * 4 + 1] >= block.y - 1e-6 && t.box[j * 4 + 3] <= block.y + block.h + 1e-6;
    for (const j of mainGlyphs(t)) assert.ok(inBlock(j), aspect + ': ' + t.ch[j] + ' in the block');
    // settle's closest key (block .66) keeps every title glyph on-frame
    const pose = poseAt(scene, scene.times.rest);
    for (const j of mainGlyphs(t)) assert.ok(beyondFrame(pose, t, j, W, H) < 0.5, aspect + ': ' + t.ch[j] + ' on-frame');
  }
});

test('anchors: times.*, sung, mid, end, emph, word:k (sung starts), beat:n (with and without a grid), numbers; dt; clamped', () => {
  const { scene, cut, plan } = shotScene({ shot: 'settle', text: TEXTS.three, arrive: 'inkRise' });
  const env = { D: { w: plan.design.w, h: plan.design.h, short: plan.design.short }, times: scene.times, cut, grid: F.gridAt(plan, cut.t0) };
  const t = scene.target, tm = scene.times, span = cut.t1 - cut.t0;
  const at = (a, dt) => SS.anchorTime(env, t, a, dt);
  for (const k of ['a', 'rest', 'out', 'b']) assert.equal(at(k), tm[k]);
  assert.equal(at('sung'), 0);
  approx(at('mid'), span / 2, 1e-12);
  approx(at('end'), span, 1e-12);
  approx(at(0.5), tm.a + 0.5 * (tm.b - tm.a), 1e-12);
  const frac = STG.sungFractions(env, t, 'word');
  const firstOf = (word) => Array.from(t.unitOf.word).indexOf(word);
  approx(at('word:1'), frac[firstOf(1)] * span, 1e-9);
  approx(at('word:-1'), frac[firstOf(t.units.word - 1)] * span, 1e-9);
  approx(at('emph'), frac[0] * span, 1e-9, 'emph: the sung start of the first emphasized glyph');
  // beat: 120 BPM with beat 0 at absolute 0 and the cut at t0 = 0.12 → the first beat at or after the sung start is 0.38
  approx(at('beat:0'), 0.38, 1e-9);
  approx(at('beat:2'), 1.38, 1e-9);
  const noGrid = Object.assign({}, env, { grid: null });
  approx(SS.anchorTime(noGrid, t, 'beat:3'), 1.5, 1e-12, 'without a grid, 0.5 s steps');
  approx(at('sung', 0.25), 0.25, 1e-12, 'dt is added');
  assert.equal(at('b', 2), tm.b, 'then clamped to b');
  assert.equal(at('a', -2), tm.a, 'and to a');
});

test('keys are sorted by time; keys closer than 1/120 s jump at the later key', () => {
  const shot = { keys: [{ at: 'b', aim: 'block', fill: 0.8 }, { at: 'a', aim: 'block', fill: 0.4 },
    { at: 'sung', aim: 'block', fill: 0.5 }, { at: 'sung', dt: 1 / 240, aim: 'block', fill: 0.9, curve: 'linear' }] };
  const { scene } = shotScene({ shot });
  const tr = scene.shot;
  const times = tr.keys.map((k) => k.t);
  assert.deepEqual(times, times.slice().sort((a, b) => a - b), 'time order');
  const z = tr.keys.map((k) => k.Z);
  const tj = tr.keys[2].t;
  approx(poseAt(scene, tj - 1e-6).zoom, z[1], 1e-6, 'just before the jump: the earlier key');
  approx(poseAt(scene, tj).zoom, z[2], 1e-9, 'at the later key: its framing');
  // held before the first key and after the last
  approx(poseAt(scene, tr.keys[0].t - 5).zoom, z[0], 1e-12);
  approx(poseAt(scene, tr.keys[3].t + 5).zoom, z[3], 1e-12);
});

test('between keys: log-lerped zoom, the curve of the key moved into, the aimed word travelling straight on screen', () => {
  const shot = { keys: [{ at: 'a', aim: 'block', fill: 0.4 }, { at: 'b', aim: 'block', fill: 0.9, curve: 'dashStop' }] };
  const { scene, W, H } = shotScene({ shot });
  const tr = scene.shot, [k0, k1] = tr.keys;
  const f = CV.fn('dashStop');
  const [cx, cy] = boxCentre(k0.box, W, H);
  for (const u of [0.1, 0.3, 0.5, 0.8, 0.95]) {
    const pose = poseAt(scene, k0.t + u * (k1.t - k0.t));
    approx(Math.log(pose.zoom), Math.log(k0.Z) + (Math.log(k1.Z) - Math.log(k0.Z)) * f(u), 1e-9, 'zoom at u = ' + u);
    // keep on both keys, same aim: the block centre does not move on screen
    const [sx, sy] = screenOf(pose, cx, cy);
    approx(sx, k0.sx, 1e-6); approx(sy, k0.sy, 1e-6);
  }
});

test('the reading path hits each unit centre at its sung time and holds it between hops (≤ 0.35 s each)', () => {
  const shot = { keys: [{ at: 'a', aim: 'first', fill: 0.7 }, { at: 'sung', aim: 'reading', fill: 0.7 }] };
  for (const text of [TEXTS.three, TEXTS.en, 'あいうえおかきく']) {
    const { scene, W, H } = shotScene({ shot, text });
    const tr = scene.shot, u = tr.reading;
    assert.ok(u && u.n >= 2, text + ': reading units');
    if (text === 'あいうえおかきく') assert.equal(u.n, 4, 'one word of 8 glyphs reads in 4 chunks');
    const path = tr.paths[1];
    for (let k = 0; k < u.n; k++) {
      const pose = poseAt(scene, u.tau[k] + 1e-9);
      approx(pose.zoom, path.Z, 1e-9, 'constant reading zoom');
      const [sx, sy] = screenOf(pose, u.cx[k], u.cy[k]);
      approx(sx, path.sx[k], 1e-6, text + ' unit ' + k + ' x');
      approx(sy, path.sy[k], 1e-6, text + ' unit ' + k + ' y');
      if (k > 0) {
        assert.ok(u.tau[k] - u.start[k] <= 0.35 + 1e-9, 'hop length');
        const mid = poseAt(scene, (u.tau[k - 1] + u.start[k]) / 2);      // holding unit k − 1 before the hop
        const [hx] = screenOf(mid, u.cx[k - 1], u.cy[k - 1]);
        approx(hx, path.sx[k - 1], 1e-6, 'held on unit ' + (k - 1));
      }
    }
    void W; void H;
  }
});

// A segment shorter than this is a cut in all but name: two keys whose anchors meet (pushWord's emph key 0.1 s before
// the sung start, when the emphasis opens the line, lands 0.02 s after `a`). Such near-jumps may happen only while the
// text is still entering (within NEAR_JUMP_START of a), which the test also checks.
const NEAR_JUMP = 0.1, NEAR_JUMP_START = 0.15;

test('every preset: the pose is continuous at 240 Hz except deliberate jumps; the aim moves ≤ 1.5 frame widths/s outside snaps', () => {
  for (const key of SHOT.SHOT_KEYS) {
    for (const text of [TEXTS.short, TEXTS.three]) {
      const { scene, W, H } = shotScene({ shot: key, text, arrive: 'inkRise', zoom: 1.2 });
      const tr = scene.shot;
      const curves = SHOT.expandShot(key, { zoom: 1.2 }).keys.map((k) => k.curve);
      for (let i = 0; i + 1 < tr.n; i++) {
        const len = tr.t[i + 1] - tr.t[i];
        if (len > 0 && len < NEAR_JUMP) {
          assert.ok(tr.t[i] <= scene.times.a + NEAR_JUMP_START, key + ': a near-jump only while the text enters (' + tr.t[i] + ')');
        }
      }
      const snap = (tl) => {
        // inside a segment moving into a key with a snap curve (dashStop), a jump or a near-jump
        for (let i = 0; i + 1 < tr.n; i++) {
          if (tl >= tr.t[i] - 1e-9 && tl <= tr.t[i + 1] + 1e-9) {
            if (tr.t[i + 1] - tr.t[i] < NEAR_JUMP) return true;
            if (curves.includes('dashStop') && tr.keys[i + 1].Z > tr.keys[i].Z * 1.2) return true;
          }
        }
        return false;
      };
      // a reading hop that fast singing shortened below 0.35 s (§4.5.5: 0.6 × the gap between sung starts) may pass
      // 1.5 W/s on a line break; it is held to continuity only (see NOTES ## v2.1-B, visual QA)
      const u = tr.reading;
      const shortHop = (tl) => {
        if (!u) return false;
        for (let k = 1; k < u.n; k++) if (tl >= u.start[k] - 1e-9 && tl <= u.tau[k] + 1e-9 && u.tau[k] - u.start[k] < 0.35 - 1e-9) return true;
        return false;
      };
      let prev = null;
      for (const tl of steps(scene.times.a, scene.times.b, Math.round((scene.times.b - scene.times.a) * 240))) {
        const pose = poseAt(scene, tl);
        for (const c of ['x', 'y', 'zoom', 'roll', 'ax', 'ay']) assert.ok(Number.isFinite(pose[c]), key + ' ' + c);
        assert.ok(pose.zoom >= 0.9 - 1e-9 && pose.zoom <= 3 + 1e-9, key + ' zoom ' + pose.zoom);
        const fast = snap(tl);
        if (prev && !fast && !prev.fast) {
          // the aim centre's screen motion (§7.3: ≤ 1.5 frame widths per second outside snap keys)
          const speed = Math.hypot(pose.ax - prev.ax, pose.ay - prev.ay) * 240;
          const limit = shortHop(tl) || prev.hop ? 6 : 1.5;
          assert.ok(speed <= limit * W, key + ' "' + text + '": the aim moves ' + (speed / W).toFixed(2) + ' W/s at ' + tl.toFixed(3));
          const jump = Math.abs(Math.log(pose.zoom / prev.zoom)) * 240;
          assert.ok(jump < 12, key + ': zoom speed ' + jump.toFixed(2) + ' /s at ' + tl.toFixed(3));
        }
        prev = { ax: pose.ax, ay: pose.ay, zoom: pose.zoom, fast, hop: shortHop(tl) };
      }
      void H;
    }
  }
});

test('the follow lean: 0 at rest, bounded by 0.1 × short, continuous, pulled toward moving glyphs', () => {
  const { scene, short } = shotScene({ shot: { follow: 1, keys: [{ at: 'a', aim: 'block', fill: 0.6 }, { at: 'b', aim: 'block', fill: 0.6 }] },
    text: TEXTS.three, arrive: 'inkRise', arriveParams: { dur: 0.8, each: 0.05 } });
  assert.ok(scene.lean && scene.lean.follow === 1);
  const cam = scene.cam;
  const leanAt = (tl) => {
    F.evaluate(scene, tl);
    const withLean = scene.table.live.x[cam], y1 = scene.table.live.y[cam];
    const pose = poseAt(scene, tl);
    return [withLean - pose.x, y1 - pose.y];
  };
  let prev = null, most = 0;
  const { a, rest } = scene.times;
  for (const tl of steps(a, a + 1.5, 360)) {
    const l = leanAt(tl);
    const z = poseAt(scene, tl).zoom;
    most = Math.max(most, Math.hypot(l[0], l[1]) * z);
    assert.ok(Math.hypot(l[0], l[1]) * z <= 0.1 * short + 1e-6, 'bounded at ' + tl.toFixed(3));
    if (prev) assert.ok(Math.hypot(l[0] - prev[0], l[1] - prev[1]) < 3, 'continuous at ' + tl.toFixed(3));
    prev = l;
  }
  assert.ok(most > 1, 'the entrance pulls the camera (' + most.toFixed(2) + ' du)');
  const still = leanAt(Math.max(rest, a) + 1.6);
  approx(Math.hypot(still[0], still[1]), 0, 1e-6, '0 at rest');
});

test("'none' (and an unreadable shot) leaves the camera to the lens: no track, no behaviour, no lean", () => {
  const withNone = shotScene({ shot: 'none', lens: 'handHeld' });
  const bogus = shotScene({ shot: { keys: [{ at: 'nowhere', aim: 'block' }] }, lens: 'handHeld' });
  for (const { scene, plan, cut } of [withNone, bogus]) {
    assert.equal(scene.shot, null);
    assert.equal(scene.lean, null);
    assert.ok(!scene.behaviours.some((b) => b.run === SS.runShot));
    F.evaluate(scene, 1);
    const cam = F.cameraAt(scene, plan, cut.t0 + 1);
    assert.equal(cam.fz, 1);
  }
  // a cut without any glyph (spaces only) gets no shot either
  const env = { D: { w: 1920, h: 1080, short: 1080 }, times: { a: 0, rest: 0, out: 1, b: 1 }, cut: { t0: 0, t1: 1 } };
  assert.equal(SS.makeShot(env, 0, null, { shot: { v: 'pushWord' } }), null);
});

test('the lens under a shot: its amplitudes stay screen-constant (handHeld travel within ±5 % at zoom 1 and 2.5)', () => {
  // two constant shots: the frame at zoom 1, and the first glyph at zoom 2.5 (fill chosen for it)
  const probe = shotScene({ shot: { keys: [{ at: 'a', aim: 'glyph:0', fill: 0.6 }, { at: 'b', aim: 'glyph:0', fill: 0.6 }] } });
  const b = probe.scene.shot.keys[0].box;
  const base = Math.min(probe.W / Math.max(b.w, 64.8), probe.H / Math.max(b.h, 64.8));
  const travel = (shot) => {
    const { scene, plan, cut, W, H } = shotScene({ shot, lens: 'handHeld', lensParams: { sway: 20, rate: 0.9, roll: 0.6, amount: 0.5 } });
    const V = new Float32Array(6), V0 = new Float32Array(6), inv = new Float32Array(6), pt = new Float32Array(2);
    let most = 0;
    for (const tl of steps(0, 2.5, 60)) {
      F.evaluate(scene, tl);
      const full = F.cameraAt(scene, plan, cut.t0 + tl);
      const pose = poseAt(scene, tl);
      F.viewMatrix(V, full, 1, W, H);
      F.viewMatrix(V0, { x: pose.x, y: pose.y, zoom: pose.zoom, roll: pose.roll, shakeX: 0, shakeY: 0 }, 1, W, H);
      MAT.invert(inv, V0);
      for (const [cx, cy] of [[0, 0], [W, H]]) {
        MAT.apply(inv, cx, cy, pt);                 // the world point at this screen corner without the lens
        MAT.apply(V, pt[0], pt[1], pt);
        most = Math.max(most, Math.hypot(pt[0] - cx, pt[1] - cy));
      }
    }
    return { most, zoom: poseAt(scene, 1).zoom };
  };
  const one = travel({ keys: [{ at: 'a', aim: 'frame', zoom: 1 }, { at: 'b', aim: 'frame', zoom: 1 }] });
  const close = travel({ keys: [{ at: 'a', aim: 'glyph:0', fill: 2.5 / base }, { at: 'b', aim: 'glyph:0', fill: 2.5 / base }] });
  approx(one.zoom, 1, 1e-9);
  approx(close.zoom, 2.5, 0.01, 'the close shot is at zoom 2.5 (' + close.zoom + ', fill ' + 2.5 / base + ')');
  assert.ok(one.most > 5, 'the lens moves the corners (' + one.most.toFixed(2) + ')');
  assert.ok(Math.abs(close.most - one.most) <= 0.05 * one.most, 'corner travel ' + close.most.toFixed(3) + ' vs ' + one.most.toFixed(3));
});

test('carry: a carried framing replaces the first key at a; cam.zoom scales the closeness; cam.follow replaces the follow', () => {
  const carried = shotScene({ shot: 'settle' });
  const plan = carried.plan;
  const cut = Object.assign({}, plan.cuts[0]);
  cut.slots = Object.assign({}, cut.slots, { 'cam.shot': { v: 'settle', p: { carry: { fill: 0.9, ox: 0.1, roll: 3 } }, from: 'auto',
    pfrom: { carry: 'rule' } }, 'cam.follow': { v: 0.4, from: 'auto' } });
  cut.fp += ':carry';
  const svc = { registry: REG, text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
  const scene = BUILD.buildCut(cut, plan, svc);
  const k0 = scene.shot.keys[0], D = { w: plan.design.w, h: plan.design.h, short: plan.design.short };
  const want = SS.frame(D, k0.box, { fill: 0.9, ox: 0.1, roll: 3 });
  approx(k0.Z, want.Z, 1e-9); approx(k0.X, want.X, 1e-9); approx(k0.R, 3 * N.DEG, 1e-12);
  assert.equal(scene.lean.follow, 0.4, 'cam.follow replaces the shot follow');
  const near = shotScene({ shot: 'settle', zoom: 1.3 }).scene.shot.keys[0].Z;
  const far = shotScene({ shot: 'settle', zoom: 0.8 }).scene.shot.keys[0].Z;
  assert.ok(near > far, 'cam.zoom scales the closeness');
});

test('the lens env sees the text and the shot track; the shot behaviour runs after the lens behaviours', () => {
  let seen = null;
  const spy = K.lens({ key: 'spyLens', label: { ja: '観察', en: 'Spy lens' }, blurb: { ja: '見るだけ', en: 'Only looks' },
    make(env) { seen = { target: env.target, shot: env.shot }; return []; } });
  const reg = MV.use('core/registry').createRegistry(MV.use('parts/catalog').defs().concat([spy]));
  const plan = FAC.samplePlan(reg, { kind: 'shot', key: 'pushWord' }, {});
  const cut = Object.assign({}, plan.cuts[0]);
  cut.slots = Object.assign({}, cut.slots, { lens: { v: 'spyLens', p: { amount: 0.5, curve: 'linear' }, from: 'pin' } });
  const svc = { registry: reg, text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
  const scene = BUILD.buildCut(cut, plan, svc);
  assert.equal(seen.target, scene.target);
  assert.equal(seen.shot, scene.shot);
  const hand = shotScene({ shot: 'pushWord', lens: 'handHeld' }).scene;
  const lensB = hand.behaviours.filter((b) => b.phase === K.PH.LENS);
  assert.equal(lensB[lensB.length - 1].run, SS.runShot, 'runShot is the last camera behaviour');
  // K.aimBox / K.frameBox read the lens env
  const env = { D: { w: plan.design.w, h: plan.design.h, short: plan.design.short }, target: scene.target };
  assert.deepEqual(K.aimBox(env, 'block'), SS.aimBox(env, scene.target, 'block'));
  const fb = K.frameBox(env, K.aimBox(env, 'block'), 0.7);
  const want = SS.frame(env.D, K.aimBox(env, 'block'), { fill: 0.7 });
  assert.deepEqual(fb, { zoom: want.Z, x: want.X, y: want.Y });
});

test('slot seeds hash object values (a custom shot seeds the same everywhere, two different objects differ)', () => {
  const a = { v: { keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'emph' }] } };
  const b = { v: { keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'first' }] } };
  const a2 = { v: JSON.parse(JSON.stringify(a.v)) };
  assert.equal(BUILD.slotSeed('cam.shot', a, 'x'), BUILD.slotSeed('cam.shot', a2, 'x'));
  assert.notEqual(BUILD.slotSeed('cam.shot', a, 'x'), BUILD.slotSeed('cam.shot', b, 'x'));
  assert.equal(BUILD.slotSeed('arrive', { v: 'inkRise' }, 'x'), MV.use('core/hash').hash32('slot', 'arrive', 'inkRise', 'x'),
    'string values seed as in v2');
  assert.equal(BUILD.fallbackSlots({}, REG)['cam.shot'].v, 'none', 'fallback slots drop the shot');
});
