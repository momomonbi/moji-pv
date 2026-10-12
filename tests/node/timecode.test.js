/* 文字PVメーカー v2 — original work. Playback timers: global clock, hundredth boundaries, stable fit and visibility. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../helpers/load').load();
const TC = api.use('parts/timecode'), FAC = api.use('engine/facade'), BUILD = api.use('engine/scene/build');
const T = api.use('engine/scene/table'), F = api.use('engine/scene/frame');
const TEXT = api.use('engine/text/service'), FM = api.use('engine/text/fake_measure');
const REG = api.use('parts/catalog').defaultRegistry();

function vector(time, { tl = 0, size = 60, box = { x: 13, y: 17, w: 240, h: 66 }, align = 'start', alpha = 0.8, weight = 0.1, motion = 0 } = {}) {
  const points = [], paths = [], strokes = [], clips = [], stack = [];
  let current = [];
  const g = { globalAlpha: 1, save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); },
    beginPath() { current = []; }, rect(x, y, w, h) { clips.push([x, y, w, h]); }, clip() {},
    moveTo(x, y) { points.push([x, y]); paths.push(['M', x, y]); current.push(['M', x, y]); },
    lineTo(x, y) { points.push([x, y]); paths.push(['L', x, y]); current.push(['L', x, y]); },
    stroke() { strokes.push({ alpha: this.globalAlpha, path: current }); } };
  TC.draw(g, tl, { box, size, weight, alpha, ink: '#abcdef', align, motion }, { time, rgba: (ink) => ink });
  assert.equal(stack.length, 0, 'clipping balances save and restore');
  return { points, paths, strokes, clips, alpha: g.globalAlpha, stroke: g.lineWidth, ink: g.strokeStyle };
}

test('timer formats absolute elapsed time as padded mm:ss.hh, floors hundredths and keeps cumulative minutes', () => {
  for (const [time, expected] of [[undefined, '00:00.00'], [NaN, '00:00.00'], [Infinity, '00:00.00'], [-1, '00:00.00'],
    [0, '00:00.00'], [0.009999, '00:00.00'], [0.01, '00:00.01'], [0.29, '00:00.29'], [1.15, '00:01.15'],
    [1.239999999, '00:01.23'], [59.9999, '00:59.99'], [60, '01:00.00'], [83.45, '01:23.45'],
    [3599.999, '59:59.99'], [3600, '60:00.00'], [6000, '100:00.00'], [60000.29, '1000:00.29'],
    [Number.MAX_SAFE_INTEGER, '150119987579016:31.00']]) assert.equal(TC.format(time), expected, String(time));
});

test('vector drawing follows q.time independently of local pose time and is identical after backward seeks or pause', () => {
  const early = vector(59.8, { tl: 1.8 }), next = vector(60.2, { tl: 2.2 });
  assert.deepEqual(early, vector(59.8, { tl: 59.8 }), 'the actual 00:59.80 strokes do not use local t=1.8');
  assert.deepEqual(next, vector(60.2, { tl: 60.2 }), 'the actual 01:00.20 strokes do not use local t=2.2');
  assert.notDeepEqual(early.paths, vector(1.8).paths, 'a local-clock timer would draw different numerals');
  assert.notDeepEqual(next.paths, vector(2.2).paths);
  assert.notDeepEqual(next.paths, early.paths, 'minute rollover changes the displayed strokes');
  assert.deepEqual(vector(60.2, { tl: 99 }), next, 'repeated paused drawing does not advance time');
  vector(7200.5); vector(0.01);
  assert.deepEqual(vector(59.8, { tl: 0.1 }), early, 'out-of-order drawing restores the exact same clock');
  assert.deepEqual(vector(59.801), vector(59.809), 'frames in the same hundredth show the same value');
  assert.notDeepEqual(vector(59.809).paths, vector(59.81).paths, 'the next hundredth updates');
});

test('vector timers keep every stroke including its round cap inside a stable box for long durations and alignments', () => {
  for (const time of [-1, NaN, 0, 0.29, 59.99, 60, 3599.99, 3600, 60000.29, Number.MAX_SAFE_INTEGER]) {
    for (const align of ['start', 'center', 'end']) for (const box of [{ x: 13, y: 17, w: 240, h: 66 }, { x: -4, y: 7, w: 1, h: 1 }]) {
      const draw = vector(time, { box, align }), pad = draw.stroke / 2;
      assert.ok(draw.points.length, 'drawn: ' + time);
      for (const [x, y] of draw.points) {
        assert.ok(Number.isFinite(x) && Number.isFinite(y) && draw.stroke > 0);
        assert.ok(x - pad >= box.x - 1e-9 && x + pad <= box.x + box.w + 1e-9, 'horizontal bounds: ' + time + ' ' + align);
        assert.ok(y - pad >= box.y - 1e-9 && y + pad <= box.y + box.h + 1e-9, 'vertical bounds: ' + time + ' ' + align);
      }
      assert.equal(draw.alpha, 0.8); assert.equal(draw.ink, '#abcdef');
    }
  }
});

function fixture(key, params, { aspect = '16:9', orient = 'h', text = '君の声が 42回 夜へ届く', els } = {}) {
  const kind = key === 'sidebarIndex' ? 'arrange' : 'ornament';
  const plan = FAC.samplePlan(REG, { kind, key, params }, { aspect, orient, text });
  const cut = plan.cuts[0];
  Object.assign(cut, { t0: 58, t1: 66, a: 58, b: 66, repT: 62, els: els || {} });
  cut.slots.arrive = { v: 'fogIn', p: { dur: 2, each: 0 }, from: 'pin' };
  if (key === 'sidebarIndex') {
    cut.slots['ornament.count'] = { v: 0, from: 'pin' };
    for (const name of ['ornament#0', 'ornament#1', 'ornament#2']) cut.slots[name] = { v: 'none', from: 'pin' };
  }
  const scene = BUILD.buildCut(cut, plan, { registry: REG,
    text: TEXT.createTextService({ measurer: FM.fakeMeasurer(), faces: plan.look.faces }), strict: true });
  const index = scene.stores.paint.findIndex((p) => p.data && p.data.kind === 'timer');
  const timer = scene.stores.paint[index];
  const node = scene.table.type.findIndex((type, i) => type === T.TYPE.paint && scene.table.payload[i] === index);
  return { scene, plan, cut, timer, node };
}

function worldBox(scene, node, box) {
  const m = T.restWorld(scene.table).m.subarray(node * 6, node * 6 + 6), points = [];
  for (const x of [box.x, box.x + box.w]) for (const y of [box.y, box.y + box.h]) {
    points.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  }
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function overlaps(a, b) {
  return a.x < b.x + b.w - 1e-4 && b.x < a.x + a.w - 1e-4 && a.y < b.y + b.h - 1e-4 && b.y < a.y + a.h - 1e-4;
}

test('both saved part keys replace legacy displays with one bounded animated timer, retain literal lyric numbers and honor visibility', () => {
  for (const key of ['sidebarIndex', 'serialMark']) {
    const base = fixture(key, { number: '42', showTime: true, rule: false });
    assert.ok(base.timer && base.timer.animated); assert.ok(base.node >= 0);
    assert.ok(base.scene.table.flags[base.node] & T.FLAG.pickable);
    assert.ok(base.scene.target.ch.join('').includes('42'), 'literal lyric number remains lyric: ' + key);
    const alternate = fixture(key, { number: '99', showTime: true, rule: false });
    assert.deepEqual(alternate.timer.data, base.timer.data, 'legacy number pins do not control the clock');
    assert.equal(fixture(key, { number: '42', showTime: false }).timer, undefined);
    const hidden = fixture(key, { showTime: true }, { els: { [key === 'sidebarIndex' ? 'text' : 'ornament#0']: { hide: true } } });
    if (key === 'sidebarIndex') assert.equal(hidden.scene.table.flags[hidden.node] & T.FLAG.hidden, T.FLAG.hidden, 'element hiding applies to the painter');
    else assert.equal(hidden.timer, undefined, 'hidden ornaments are omitted from the scene');
  }
});

test('timer fills preserve element color pins; sidebar paint follows the same manual nudge as its lyric', () => {
  for (const key of ['sidebarIndex', 'serialMark']) {
    const owner = key === 'sidebarIndex' ? 'text' : 'ornament#0';
    const f = fixture(key, { rule: false }, { els: { [owner]: { fill: '#aabbcc' } } });
    assert.equal(f.timer.data.ink, '#aabbcc');
  }
  const plain = fixture('sidebarIndex'), moved = fixture('sidebarIndex', undefined, { els: { text: { nudge: { dx: 25, dy: -10, rot: 0, s: 1 } } } });
  const a = worldBox(plain.scene, plain.node, plain.timer.box), b = worldBox(moved.scene, moved.node, moved.timer.box);
  assert.ok(Math.abs(b.x - a.x - 25) < 1e-4); assert.ok(Math.abs(b.y - a.y + 10) < 1e-4);
});

test('scene-table timer fade is applied exactly once and fully transparent clocks are hidden from picking', () => {
  for (const key of ['sidebarIndex', 'serialMark']) {
    const f = fixture(key, { rule: false, amount: 1 });
    assert.equal(f.scene.times.rest, 2);
    F.evaluate(f.scene, 0);
    assert.equal(f.scene.table.wa[f.node], 0, key + ' starts fully transparent');
    assert.ok(T.isHidden(f.scene.table, f.node), key + ' cannot claim an invisible pick area');
    F.evaluate(f.scene, 1);
    assert.ok(Math.abs(f.scene.table.wa[f.node] - 0.5) < 1e-6, key + ' halfway fade belongs to the table');
    const points = [], stack = [], g = { globalAlpha: f.scene.table.wa[f.node],
      save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); }, rect() {}, clip() {},
      beginPath() {}, moveTo(x, y) { points.push([x, y]); }, lineTo() {}, stroke() {} };
    f.timer.draw(g, 1, f.timer.data, { time: 59, rgba: (v) => v });
    assert.ok(points.length);
    assert.ok(Math.abs(g.globalAlpha - 0.5) < 1e-6, key + ' painter does not apply fade twice');
    F.evaluate(f.scene, 2);
    assert.equal(f.scene.table.wa[f.node], 1);
  }
});

test('digit flips reconstruct their own hundredth, tenth, second and minute transitions from the global clock', () => {
  for (const [time, index, ch, previous] of [[0.2, 6, '2', '1'], [0.29, 7, '9', '8'],
    [1, 4, '1', '0'], [10, 3, '1', '0'], [60, 1, '1', '0'], [600, 0, '1', '0']]) {
    const state = TC.digitState(time, index);
    assert.equal(state.ch, ch, 'current numeral at ' + time + '/' + index);
    assert.equal(state.previous, previous, 'previous numeral at ' + time + '/' + index);
    assert.ok(state.progress >= 0 && state.progress <= 1);
  }
  for (const time of [0.295, 60.035, 600.02, 6000.005]) {
    const text = TC.format(time);
    assert.equal(Array.from(text, (_, i) => TC.digitState(time, i, text).ch).join(''), text, 'main always shows current time');
    for (const separator of [text.indexOf(':'), text.indexOf('.')]) {
      assert.deepEqual(TC.digitState(time, separator, text), { ch: text[separator], previous: null, progress: 1 });
    }
  }
  assert.equal(TC.digitState(59.9999, 1).ch, '0');
  assert.equal(TC.digitState(60, 1).ch, '1');
});

test('strong timer animation is clipped, preserves the main value and fade, and repeats exactly when paused or sought', () => {
  const opts = { motion: 1, alpha: 0.5 }, first = vector(60.035, opts);
  assert.deepEqual(first.clips, [[13, 17, 240, 66]], 'all old and current digit motion stays in the timer box');
  assert.ok(first.strokes.length > 1, 'a changed numeral leaves a short weak ghost');
  assert.equal(first.strokes.at(-1).alpha, 0.5, 'the current numerals retain the single scene fade');
  for (const ghost of first.strokes.slice(0, -1)) assert.ok(ghost.alpha >= 0 && ghost.alpha <= 0.5 * 0.22);
  assert.deepEqual(first.strokes.at(-1).path.map((p) => p[0]), vector(60.035).strokes.at(-1).path.map((p) => p[0]), 'main path belongs to the current formatted numerals');
  assert.notDeepEqual(first.paths, vector(60.035).paths, 'motion zero removes the flip and ghosts');
  assert.deepEqual(vector(60.035, { ...opts, tl: -20 }), first, 'pose time does not drive the animation');
  vector(1200.035, opts); vector(0.005, opts);
  assert.deepEqual(vector(60.035, opts), first, 'a backward seek reconstructs the same complete animated frame');
  assert.notDeepEqual(vector(60.0301, opts).paths, vector(60.0308, opts).paths, 'digits move within their hundredth');
  for (const time of [0, 0.005, 0.295, 59.9999, 60, 60.005, 6000.005, Number.MAX_SAFE_INTEGER]) {
    const drawn = vector(time, opts);
    assert.ok(drawn.points.every((p) => p.every(Number.isFinite)));
    assert.equal(drawn.alpha, 0.5);
  }
  for (const key of ['sidebarIndex', 'serialMark']) {
    const spec = REG.params(key === 'sidebarIndex' ? 'arrange' : 'ornament', key).find((p) => p.name === 'motion').spec;
    assert.equal(spec.auto.value, 1); assert.equal(spec.min, 0); assert.equal(spec.max, 1);
    assert.equal(fixture(key, { motion: 0 }).timer.data.motion, 0);
    assert.equal(fixture(key).timer.data.motion, 1);
  }
});

test('timer reserved boxes stay in the safe area without covering lyrics across frame sizes, orientations and corner choices', () => {
  const aspects = ['16:9', '9:16', '1:1', '4:5', '4:3', '3:4', '21:9'];
  function check(f, label) {
    assert.ok(f.timer, label + ': timer fits');
    const b = worldBox(f.scene, f.node, f.timer.box), D = BUILD.designEnv(f.plan.design), m = D.safe;
    assert.ok(b.x >= m.l - 1e-3 && b.y >= m.t - 1e-3 && b.x + b.w <= D.w - m.r + 1e-3 && b.y + b.h <= D.h - m.b + 1e-3, label + ': safe area');
    for (const run of f.scene.runs.filter((r) => r.spec.span)) {
      assert.equal(overlaps(b, worldBox(f.scene, run.node, run.layout.box)), false, label + ': lyric overlap');
    }
  }
  for (const aspect of aspects) for (const orient of ['h', 'v']) {
    for (const side of ['left', 'right']) for (const size of [0.08, 0.4]) {
      check(fixture('sidebarIndex', { side, size }, { aspect, orient }), 'sidebar ' + [aspect, orient, side, size].join('/'));
    }
    for (const place of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight']) for (const rule of [false, true]) {
      check(fixture('serialMark', { place, rule, size: 80, gap: 80 }, { aspect, orient }), 'serial ' + [aspect, orient, place, rule].join('/'));
    }
  }
});
