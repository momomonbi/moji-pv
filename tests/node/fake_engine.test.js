/* 文字PVメーカー v2 — original work. Tests for the fake engine, the recording context and plan_basic.json (WP0 acceptance). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');
const F = require('../helpers/fake_engine.js');

const MV = load();
const H = MV.use('core/hash');

const PLAN_KEYS = ['v', 'hash', 'duration', 'design', 'look', 'beats', 'lines', 'cuts', 'grounds', 'seams', 'impulses', 'warnings'];
const CUT_KEYS = ['key', 'line', 'role', 'text', 'emph', 'impact', 'note', 't0', 't1', 'a', 'b', 'repT', 'lang', 'feat', 'fp',
  'slots', 'els', 'ground', 'seamIn'];
const FEAT_KEYS = ['cells', 'graphemes', 'script', 'latin', 'orients', 'words', 'units', 'emph', 'impact', 'dur', 'cps', 'energy',
  'beat', 'onBeat', 'section', 'repeatOf', 'pos', 'role'];

function withoutHash(plan) {
  const { hash, ...rest } = plan;
  return [hash, rest];
}

function checkPlanShape(plan, where) {
  assert.deepEqual(Object.keys(plan).sort(), PLAN_KEYS.slice().sort(), where);
  assert.equal(plan.v, 1);
  const [hash, rest] = withoutHash(plan);
  assert.equal(hash, H.hashJSON(rest), where + ': hash = hashJSON(plan without hash)');
  let prevA = -Infinity;
  for (const cut of plan.cuts) {
    for (const k of CUT_KEYS) assert.ok(k in cut, where + ' ' + cut.key + ' has ' + k);
    for (const k of FEAT_KEYS) assert.ok(k in cut.feat, where + ' ' + cut.key + ' feat has ' + k);
    assert.ok(cut.a <= cut.t0 && cut.t0 < cut.t1 && cut.a < cut.b, where + ' ' + cut.key + ' times');
    assert.ok(cut.a >= prevA, where + ' cuts are in time order');
    prevA = cut.a;
    for (const d of Object.values(cut.slots)) assert.ok('v' in d && typeof d.from === 'string', where + ' ' + cut.key + ' decision');
  }
  for (const line of plan.lines) for (const key of line.cuts) assert.ok(plan.cuts.some((c) => c.key === key), where + ' ' + key);
}

test('plan_basic.json has the §3.12 shape, a correct hash and the project_basic lines', () => {
  const plan = corpus.planBasic();
  checkPlanShape(plan, 'plan_basic');
  const doc = corpus.project('basic').doc;
  const rowIds = new Set(doc.sheet.rows.map((r) => r.id));
  for (const line of plan.lines) assert.ok(rowIds.has(line.row), line.id);
  assert.equal(plan.duration, doc.song.seconds);
  assert.deepEqual(plan.beats, { bpm: doc.song.bpm, offset: doc.song.offset, meter: doc.song.meter });
  assert.deepEqual(plan.design, { aspect: '16:9', w: 1920, h: 1080, short: 1080 });
  const roles = new Set(plan.cuts.map((c) => c.role));
  for (const r of ['title', 'lyric', 'focus', 'outro']) assert.ok(roles.has(r), r);
  for (const cut of plan.cuts) assert.ok(cut.repT >= cut.a && cut.repT < cut.b, cut.key + ' repT in [a, b)');
});

test('every part plan_basic names exists in the stub registry', () => {
  const reg = corpus.stubRegistry(MV);
  const plan = corpus.planBasic();
  const kindOf = (slot) => slot.split('#')[0];
  for (const cut of plan.cuts) {
    for (const [slot, d] of Object.entries(cut.slots)) {
      const kind = kindOf(slot);
      if (reg.keys(kind).length) assert.ok(reg.has(kind, d.v), cut.key + ' ' + slot + ' = ' + d.v);
    }
  }
  for (const g of plan.grounds) assert.ok(reg.has('ground', g.ground.v), g.key);
  for (const s of plan.seams) assert.ok(reg.has('seam', s.slot.v), s.into);
  assert.ok(reg.has('theme', plan.look.theme.v) && reg.has('mood', plan.look.mood.v));
  assert.ok(reg.has('filter', plan.look.texture.v));
});

test('the fake engine renders plan_basic onto the recorder at 40 times without throwing', () => {
  const plan = corpus.planBasic();
  const hashes = [];
  for (let run = 0; run < 2; run++) {
    const rec = F.createRecorder();
    const engine = F.createFakeEngine({ plan });
    const surface = F.surfaceOf(rec.factory, 1280, 720);
    let glyphs = 0;
    for (let i = 0; i < 40; i++) {
      const stats = engine.renderFrame(surface, (i / 40) * plan.duration, { quality: 'export', scale: 1280 / 1920, pick: true });
      glyphs += stats.drawn.glyphs;
      assert.equal(stats.provisional, false);
    }
    const s = rec.stats();
    assert.ok(glyphs > 0, 'text was drawn');
    assert.equal(s.nan, 0);
    assert.equal(s.balanced, true);
    assert.ok(s.alphaRange[0] >= 0 && s.alphaRange[1] <= 1);
    hashes.push(rec.hash());
  }
  assert.equal(hashes[0], hashes[1], 'deterministic op log');
});

test('hitTest and boxes come from the last frame; thumb, warnings, fork, stats, dispose', async () => {
  const plan = corpus.planBasic();
  const rec = F.createRecorder();
  const engine = F.createFakeEngine({ plan });
  const surface = F.surfaceOf(rec.factory, 1920, 1080);
  const cut = plan.cuts.find((c) => c.key === 'r4~0');
  engine.renderFrame(surface, cut.repT, { pick: true });
  const boxes = engine.boxes();
  assert.ok(boxes.some((b) => b.cut === 'r4~0' && b.line === 'r4' && b.quad instanceof Float32Array && b.quad.length === 8));
  const q = boxes.find((b) => b.cut === 'r4~0').quad;
  const hits = engine.hitTest((q[0] + q[2]) / 2, (q[1] + q[5]) / 2);
  assert.equal(hits[0].cut, 'r4~0');
  assert.deepEqual(engine.hitTest(-10, -10), []);
  engine.thumb({ kind: 'arrive', key: 'stubFade' }, surface, { t: 0.5 });
  assert.ok(rec.ops().some((op) => op[1] === 'fillText' && op[2] === 'stubFade'));
  assert.deepEqual(engine.warnings(), []);
  await engine.prepare(0, 10, { export: true });
  const fork = engine.fork();
  assert.equal(fork.plan, engine.plan);
  assert.equal(engine.stats().scenes, plan.cuts.length);
  for (const backdrop of ['chroma', 'black', 'clear']) engine.renderFrame(surface, 10, { backdrop });
  assert.equal(rec.stats().balanced, true);
  engine.dispose();
  assert.equal(engine.plan, null);
  assert.equal(engine.renderFrame(surface, 1, {}).drawn.glyphs, 0);
});

test('setDoc builds a trivial plan per fixture, memoized by document identity', () => {
  const engine = F.createFakeEngine({});
  for (const { name, doc } of corpus.projects()) {
    const first = engine.setDoc(doc);
    checkPlanShape(first.plan, name);
    assert.equal(engine.setDoc(doc), first, name + ' memoized');
    assert.ok(first.plan.cuts.length > 0, name);
  }
  const lrc = engine.setDoc(corpus.project('lrc').doc).plan;
  assert.equal(lrc.cuts.find((c) => c.line === 'r3').t0, 4, 'LRC stamps give the start');
  assert.equal(lrc.cuts.find((c) => c.line === 'r4').text, 'Good morning, little swallow', 'word tags removed');
  const doc = corpus.project('lrc').doc;
  const edited = Object.assign({}, doc, { sheet: { next: doc.sheet.next, rows: doc.sheet.rows.map((r) =>
    (r.id === 'r6' ? { id: 'r6', src: '[00:17.20]悪くないねと/笑ってみる' } : r)) } });
  engine.setDoc(doc);
  const res = engine.setDoc(edited);
  assert.deepEqual(res.changedCuts, ['r6~0'], 'only the edited cut changes its fingerprint');
});

test('the recorder logs the Ctx2D subset with rounded arguments', () => {
  const rec = F.createRecorder();
  const { ctx, canvas } = rec.factory.create(10, 10, { alpha: true });
  ctx.save();
  ctx.globalAlpha = 0.33333333;
  ctx.setTransform(1.23456, 0, 0, 1, 0, 0);
  const g = ctx.createLinearGradient(0, 0, 10, 0);
  g.addColorStop(0, '#FFFFFF');
  ctx.fillStyle = g;
  ctx.drawImage(canvas, 0, 0);
  ctx.fillRect(0, 0, NaN, 1);
  ctx.restore();
  const ops = rec.ops();
  assert.deepEqual(ops[2], [canvas.id, 'setTransform', 1.235, 0, 0, 1, 0, 0]);
  assert.ok(ops.some((op) => op[1] === 'drawImage' && op[2] === canvas.id));
  const s = rec.stats();
  assert.equal(s.nan, 1);
  assert.deepEqual(s.alphaRange, [0.33333333, 1]);
  assert.equal(s.balanced, true);
  assert.equal(ctx.fillStyle, '#000000', 'restore brings the state back');
  rec.reset();
  assert.equal(rec.ops().length, 0);
});
