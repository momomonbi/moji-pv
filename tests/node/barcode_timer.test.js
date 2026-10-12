/* 文字PVメーカー v2 — original work. The barcode caption must be a live playback timer, not a cut-start stamp. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../helpers/load').load();
const TC = api.use('parts/timecode'), FAC = api.use('engine/facade'), BUILD = api.use('engine/scene/build');
const T = api.use('engine/scene/table'), F = api.use('engine/scene/frame');
const TEXT = api.use('engine/text/service'), FM = api.use('engine/text/fake_measure');
const REG = api.use('parts/catalog').defaultRegistry();

function fixture(params, { aspect = '16:9', orient = 'h', start = 58, els = {} } = {}) {
  const plan = FAC.samplePlan(REG, { kind: 'ornament', key: 'barCode', params }, { aspect, orient, text: 'ワームホール 夜へ届く' });
  const cut = plan.cuts[0];
  Object.assign(cut, { t0: start, t1: start + 8, a: start, b: start + 8, repT: start + 4, els });
  cut.slots.arrive = { v: 'fogIn', p: { dur: 2, each: 0 }, from: 'pin' };
  const scene = BUILD.buildCut(cut, plan, { registry: REG,
    text: TEXT.createTextService({ measurer: FM.fakeMeasurer(), faces: plan.look.faces }), strict: true });
  const paintIndex = scene.stores.paint.findIndex((p) => p.data && p.data.kind === 'timer');
  const timer = scene.stores.paint[paintIndex];
  const node = scene.table.type.findIndex((type, i) => type === T.TYPE.paint && scene.table.payload[i] === paintIndex);
  const owner = scene.owners.findIndex((o) => o.el === 'ornament#0'), bars = [];
  for (let i = 0; i < scene.table.n; i++) if (scene.table.type[i] === T.TYPE.shape && scene.table.owner[i] === owner) {
    bars.push({ node: i, shape: scene.stores.shape[scene.table.payload[i]] });
  }
  return { plan, cut, scene, timer, node, bars };
}

function vector(timer, time, local = 2, alpha = 1) {
  const paths = [], strokes = [], clips = [], stack = [];
  let path = [];
  const g = { globalAlpha: alpha, save() { stack.push(this.globalAlpha); }, restore() { this.globalAlpha = stack.pop(); },
    beginPath() { path = []; }, rect(x, y, w, h) { clips.push([x, y, w, h]); }, clip() {},
    moveTo(x, y) { paths.push(['M', x, y]); path.push(['M', x, y]); },
    lineTo(x, y) { paths.push(['L', x, y]); path.push(['L', x, y]); },
    stroke() { strokes.push({ path, alpha: this.globalAlpha }); } };
  timer.draw(g, local, timer.data, { time, rgba: (ink) => ink });
  assert.equal(stack.length, 0);
  return { paths, strokes, clips, alpha: g.globalAlpha, ink: g.strokeStyle, width: g.lineWidth };
}

function worldBox(scene, node, box) {
  if (Array.isArray(box)) box = { x: box[0], y: box[1], w: box[2] - box[0], h: box[3] - box[1] };
  const m = T.restWorld(scene.table).m.subarray(node * 6, node * 6 + 6), points = [];
  for (const x of [box.x, box.x + box.w]) for (const y of [box.y, box.y + box.h]) {
    points.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  }
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

test('barcode uses one live mm:ss.hh painter that updates through minute rollover on the same cached cut', () => {
  const f = fixture({ react: 0 });
  assert.ok(f.timer && f.timer.animated && f.timer.box);
  assert.equal(f.timer.draw, TC.draw);
  assert.equal(TC.format(59.8), '00:59.80'); assert.equal(TC.format(60.2), '01:00.20');
  const early = vector(f.timer, 59.8), next = vector(f.timer, 60.2);
  assert.notDeepEqual(early.paths, next.paths, 'the same scene changes its displayed playback value');
  assert.deepEqual(early, vector(f.timer, 59.8, -30), 'absolute playback time is independent of cut/camera pose time');
  vector(f.timer, 0.035); vector(f.timer, 6000.005);
  assert.deepEqual(next, vector(f.timer, 60.2), 'paused or backward sought frames reproduce the entire digit animation');
  assert.ok(vector(f.timer, 60.035).strokes.length > 1, 'the barcode gets the same strong numeral flip and ghost animation');
  assert.deepEqual(f.timer.data, fixture({ react: 0 }, { start: 123 }).timer.data, 'no timestamp is baked into the scene');
});

test('old barcode bar-count, height and reaction pins retain their bars while showTime and motion control only the caption', () => {
  const params = { bars: 17, height: 85, react: .75 }, f = fixture(params), hidden = fixture({ ...params, showTime: false });
  assert.equal(f.bars.length, 17); assert.equal(hidden.bars.length, 17);
  assert.ok(f.bars.every((bar) => bar.shape.bounds[3] - bar.shape.bounds[1] === 85));
  assert.deepEqual(hidden.bars.map((bar) => Array.from(bar.shape.path.pts)), f.bars.map((bar) => Array.from(bar.shape.path.pts)), 'random bar geometry stays the same');
  assert.deepEqual(hidden.bars.map((bar) => worldBox(hidden.scene, bar.node, bar.shape.bounds)), f.bars.map((bar) => worldBox(f.scene, bar.node, bar.shape.bounds)), 'hiding the clock does not move the existing bars');
  assert.equal(hidden.timer, undefined, 'hiding the caption leaves the barcode intact');
  assert.equal(f.timer.data.motion, 1, 'old projects automatically receive the requested strong animation');
  assert.equal(fixture({ ...params, motion: 0 }).timer.data.motion, 0);
  const still = fixture({ ...params, motion: 0 }).timer;
  assert.deepEqual(vector(still, 59.123), vector(still, 59.129), 'motion zero freezes only transitions, not the clock');
  assert.notDeepEqual(vector(still, 59.129).paths, vector(still, 59.131).paths, 'the static-style caption still advances');
  const specs = REG.params('ornament', 'barCode');
  assert.equal(specs.find((p) => p.name === 'showTime').spec.auto.value, true);
  assert.equal(specs.find((p) => p.name === 'motion').spec.auto.value, 1);
});

test('barcode timer shares its owner fade once, has no invisible pick target, and retains its caption opacity', () => {
  const f = fixture({ amount: 1 });
  assert.ok(f.scene.table.flags[f.node] & T.FLAG.pickable);
  F.evaluate(f.scene, 0);
  assert.equal(f.scene.table.wa[f.node], 0); assert.ok(T.isHidden(f.scene.table, f.node));
  F.evaluate(f.scene, 1);
  assert.ok(Math.abs(f.scene.table.wa[f.node] - .5) < 1e-6);
  const draw = vector(f.timer, 59.035, 1, f.scene.table.wa[f.node]);
  assert.ok(Math.abs(draw.strokes.at(-1).alpha - .45) < 1e-6, 'scene fade .5 times caption opacity .9, without a second fade');
  F.evaluate(f.scene, 2);
  assert.equal(f.scene.table.wa[f.node], 1);
});

test('barcode clock respects existing ornament hide, color and manual position pins', () => {
  assert.equal(fixture({}, { els: { 'ornament#0': { hide: true } } }).timer, undefined);
  const base = fixture(), moved = fixture({}, { els: { 'ornament#0': { fill: '#aabbcc', nudge: { dx: 25, dy: -10, rot: 0, s: 1 } } } });
  assert.equal(moved.timer.data.ink, '#aabbcc');
  const a = worldBox(base.scene, base.node, base.timer.box), b = worldBox(moved.scene, moved.node, moved.timer.box);
  assert.ok(Math.abs(b.x - a.x - 25) < 1e-4); assert.ok(Math.abs(b.y - a.y + 10) < 1e-4);
});

test('barcode clock stays in its fixed caption box across aspects, orientations, extreme bar settings and long minute counts', () => {
  const aspects = ['16:9', '9:16', '1:1', '4:5', '4:3', '3:4', '21:9'];
  for (const aspect of aspects) for (const orient of ['h', 'v']) for (const bars of [8, 64]) for (const height of [20, 200]) {
    const f = fixture({ bars, height }, { aspect, orient }), label = [aspect, orient, bars, height].join('/');
    assert.ok(f.timer, label + ': live clock is retained'); assert.equal(f.bars.length, bars);
    const boxes = [worldBox(f.scene, f.node, f.timer.box), ...f.bars.map((bar) => worldBox(f.scene, bar.node, bar.shape.bounds))];
    assert.ok(boxes.every((box) => Object.values(box).every(Number.isFinite) && box.w > 0 && box.h > 0), label + ': existing barcode geometry stays finite and is not omitted');
    assert.ok(f.bars.every((bar) => Math.abs(worldBox(f.scene, bar.node, bar.shape.bounds).h - height) < 1e-3), label + ': bars retain their original unscaled height');
    const timerBox = JSON.stringify(f.timer.box);
    for (const time of [59.99, 60, 3599.99, 3600, 60000.29]) {
      const drawn = vector(f.timer, time), box = f.timer.box;
      assert.deepEqual(drawn.clips, [[box.x, box.y, box.w, box.h]], label + ': digit motion is clipped to the existing caption region');
      const staticTimer = { ...f.timer, data: { ...f.timer.data, motion: 0 } }, still = vector(staticTimer, time), pad = still.width / 2;
      for (const [, x, y] of still.paths) assert.ok(x - pad >= box.x - 1e-8 && x + pad <= box.x + box.w + 1e-8
        && y - pad >= box.y - 1e-8 && y + pad <= box.y + box.h + 1e-8, label + ': long minute counts shrink inside the same box');
    }
    assert.equal(JSON.stringify(f.timer.box), timerBox, label + ': timer digit changes never rebuild layout');
  }
});
