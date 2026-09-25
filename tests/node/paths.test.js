/* 文字PVメーカー v2 — original work. Tests: core/paths — the slot path grammar of DESIGN §3.4. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { deepEqual, throwsCode } = require('../helpers/assert_plus.js');

const MV = load();
const P = MV.use('core/paths');
const R = MV.use('core/rng');

test('parse: scopes', () => {
  deepEqual(P.parse('work:mood').scope, { kind: 'work', id: null, lineId: null });
  deepEqual(P.parse('line/r4:start').scope, { kind: 'line', id: 'r4', lineId: 'r4' });
  deepEqual(P.parse('line/r7.1:end').scope, { kind: 'line', id: 'r7.1', lineId: 'r7.1' });
  deepEqual(P.parse('cut/r3~4:arrive').scope, { kind: 'cut', id: 'r3~4', lineId: 'r3' });
  deepEqual(P.parse('cut/r7.1~5:dwell').scope, { kind: 'cut', id: 'r7.1~5', lineId: 'r7.1' });
  for (const special of ['title', 'intro', 'outro', 'gap/r8', 'gap/r7.2']) {
    deepEqual(P.parse('cut/' + special + ':ground').scope, { kind: 'cut', id: special, lineId: null });
  }
});

test('parse: part slots (KIND #IDX @PARTKEY .PARAM)', () => {
  const part = (path) => ({ ...P.parse(path).part });
  deepEqual(part('work:texture'), { kind: 'texture', idx: null, key: null, param: null });
  deepEqual(part('cut/r3~0:arrive.dur'), { kind: 'arrive', idx: null, key: null, param: 'dur' });
  deepEqual(part('cut/r3~0:arrive@hingeFlip.depth'), { kind: 'arrive', idx: null, key: 'hingeFlip', param: 'depth' });
  deepEqual(part('cut/r3~0:ornament#1@hankoSeal.size'), { kind: 'ornament', idx: 1, key: 'hankoSeal', param: 'size' });
  deepEqual(part('cut/r3~0:ornament#1.amount'), { kind: 'ornament', idx: 1, key: null, param: 'amount' });
  deepEqual(part('line/r3:ornament.count'), { kind: 'ornament', idx: null, key: null, param: 'count' });
  deepEqual(part('cut/r3~0:filter#0'), { kind: 'filter', idx: 0, key: null, param: null });
  deepEqual(part('cut/r3~0:seam@irisGate'), { kind: 'seam', idx: null, key: 'irisGate', param: null });
  for (const kind of P.KINDS) {
    const parsed = P.parse('work:' + kind);
    assert.equal(parsed.part.kind, kind);
    assert.equal(parsed.el, null);
    assert.equal(parsed.name, null);
  }
});

test('parse: element slots and NAME slots', () => {
  const el = P.parse('cut/r3~0:el.text.nudge');
  deepEqual(el.el, { owner: 'text', field: 'nudge' });
  assert.equal(el.part, null);
  assert.equal(el.name, null);
  for (const owner of ['text', 'ornament#0', 'ornament#1', 'ornament#2']) {
    for (const field of ['nudge', 'fill', 'hide']) deepEqual(P.parse(`work:el.${owner}.${field}`).el, { owner, field });
  }
  for (const name of ['mood', 'theme', 'season', 'color.accent', 'face.display.ja', 'face.body.zhHant',
    'face.serif.weight', 'amount.groundSwitch', 'bpm', 'beatOffset', 'readRate', 'length', 'titleCard', 'orient',
    'text.face', 'text.scale', 'text.ink', 'text.style', 't0']) {
    const parsed = P.parse('work:' + name);
    assert.equal(parsed.name, name);
    assert.equal(parsed.part, null);
    assert.equal(parsed.el, null);
    assert.equal(parsed.slot, name);
  }
  for (const name of ['start', 'end', 'split', 'lang']) assert.equal(P.parse('line/r9:' + name).name, name);
});

test('parse: every pin key of the §3.1 sample project', () => {
  const keys = ['work:mood', 'work:color.accent', 'work:amount.glitch', 'line/r7:arrange', 'line/r4:start',
    'cut/r3~4:arrive.each', 'cut/r3~0:el.text.nudge', 'line/r8:split', 'cut/r8~0:arrange',
    'cut/r8~0:arrange@pillarColumns.cols'];
  for (const key of keys) assert.equal(P.format(P.parse(key)), key);
});

// Random valid paths drawn from every grammar branch.
function randomPath(s) {
  const lineId = () => 'r' + s.int(1, 5000).toString(36) + (s.chance(0.3) ? '.' + s.int(1, 12) : '');
  const scopes = [
    () => 'work',
    () => 'line/' + lineId(),
    () => 'cut/' + lineId() + '~' + s.int(0, 60),
    () => 'cut/' + s.pick(['title', 'intro', 'outro']),
    () => 'cut/gap/' + lineId(),
  ];
  const key = () => s.pick(['inkRise', 'hingeFlip', 'hankoSeal', 'irisGate', 'fogOut', 'abc', 'x2Y']);
  const param = () => s.pick(['dur', 'each', 'order', 'ease', 'amount', 'yFrom', 'size', 'count', 'a', 'z9']);
  const slots = [
    () => {
      let slot = s.pick(P.KINDS);
      if (s.chance(0.4)) slot += '#' + s.int(0, 2);
      if (s.chance(0.5)) slot += '@' + key();
      if (s.chance(0.6)) slot += '.' + param();
      return slot;
    },
    () => 'el.' + s.pick(['text', 'ornament#0', 'ornament#1', 'ornament#2']) + '.' + s.pick(['nudge', 'fill', 'hide']),
    () => s.pick(['mood', 'color.ink', 'face.display.latin', 'amount.flash', 'start', 'split', 'text.scale', 'titleCard', 'x.y.z']),
  ];
  return s.pick(scopes)() + ':' + s.pick(slots)();
}

test('parse / format round trip over 200 generated paths', () => {
  const s = R.stream('paths-roundtrip');
  const seen = new Set();
  while (seen.size < 200) seen.add(randomPath(s));
  for (const path of seen) {
    const parsed = P.parse(path);
    assert.equal(P.format(parsed), path);
    assert.equal(P.format({ scope: P.scopeKey(path), slot: parsed.slot }), path);
    deepEqual(P.parse(P.format(parsed)), parsed);
    const branches = [parsed.part, parsed.el, parsed.name].filter((x) => x !== null);
    assert.equal(branches.length, 1, 'exactly one slot branch for ' + path);
  }
});

test('parse: errors for bad scopes, line ids, cut keys and slots', () => {
  for (const bad of ['', 'works:mood', 'Work:mood', 'line:start', 'cuts/r1~0:arrive', 'global', 42, null]) {
    throwsCode(() => P.parse(bad), 'bad-scope');
  }
  for (const bad of ['line/x7:start', 'line/r7.0:start', 'line/r:start', 'line/R7:start', 'line/r7.01:start', 'line/:start']) {
    throwsCode(() => P.parse(bad), 'bad-line-id');
  }
  for (const bad of ['cut/r3:arrive', 'cut/r3~:arrive', 'cut/r3~x:arrive', 'cut/gap/x:ground', 'cut/titles:arrive',
    'cut/:arrive', 'cut/gap/:ground', 'cut/r3~-1:arrive']) {
    throwsCode(() => P.parse(bad), 'bad-cut-key');
  }
  for (const bad of ['work', 'line/r3', 'work:', 'work:arrive#3', 'work:arrive@ab.dur', 'work:arrive@InkRise',
    'work:arrive.Dur', 'work:arrive#1#2', 'work:arrive.dur.x', 'work:el.text.size', 'work:el.ornament#3.fill', 'work:el',
    'work:Mood', 'work:color..accent', 'work:a:b', 'work:mood.', 'work:1st', 'work:text#1', 'work:x@y']) {
    throwsCode(() => P.parse(bad), 'bad-slot');
  }
});

test('format is the exact inverse and refuses what would not parse', () => {
  assert.equal(P.format({ scope: { kind: 'cut', id: 'r3~4' }, slot: 'arrive.each' }), 'cut/r3~4:arrive.each');
  assert.equal(P.format({ scope: 'line/r7.1', slot: 'start' }), 'line/r7.1:start');
  assert.equal(P.format({ scope: { kind: 'work', id: null }, slot: 'mood' }), 'work:mood');
  throwsCode(() => P.format({ scope: { kind: 'work' }, slot: 'arrive#9' }), 'bad-slot');
  throwsCode(() => P.format({ scope: { kind: 'scene', id: 'x' }, slot: 'mood' }), 'bad-scope');
  throwsCode(() => P.format({ scope: null, slot: 'mood' }), 'bad-scope');
});

test('scopeKey, lineOfCut, cutOffset', () => {
  assert.equal(P.scopeKey('cut/r3~4:arrive.dur'), 'cut/r3~4');
  assert.equal(P.scopeKey('line/r4:start'), 'line/r4');
  assert.equal(P.scopeKey('work:mood'), 'work');
  assert.equal(P.scopeKey('cut/r3~0'), 'cut/r3~0', 'bare scopes (salt keys) are accepted');
  assert.equal(P.scopeKey('cut/r3~0:depart'), 'cut/r3~0');
  throwsCode(() => P.scopeKey('cut/r3'), 'bad-cut-key');
  assert.equal(P.lineOfCut('r3~4'), 'r3');
  assert.equal(P.lineOfCut('r7.1~5'), 'r7.1');
  assert.equal(P.lineOfCut('gap/r8'), null);
  assert.equal(P.lineOfCut('title'), null);
  throwsCode(() => P.lineOfCut('r3'), 'bad-cut-key');
  assert.equal(P.cutOffset('r3~4'), 4);
  assert.equal(P.cutOffset('r7.1~15'), 15);
  assert.equal(P.cutOffset('outro'), null);
  throwsCode(() => P.cutOffset('r3~'), 'bad-cut-key');
});

test('isUnder: work covers all; a line covers its cuts only; a cut covers itself', () => {
  assert.ok(P.isUnder('cut/r3~4:arrive', 'work'));
  assert.ok(P.isUnder('work:mood', 'work'));
  assert.ok(P.isUnder('line/r3:start', 'line/r3'));
  assert.ok(P.isUnder('cut/r3~4:arrive', 'line/r3'));
  assert.ok(!P.isUnder('cut/r33~4:arrive', 'line/r3'));
  assert.ok(!P.isUnder('cut/r3.1~0:arrive', 'line/r3'), 'another occurrence is another line');
  assert.ok(P.isUnder('cut/r3.1~0:arrive', 'line/r3.1'));
  assert.ok(!P.isUnder('cut/gap/r3:ground', 'line/r3'), 'special cuts belong to no line');
  assert.ok(!P.isUnder('line/r3:start', 'cut/r3~0'));
  assert.ok(P.isUnder('cut/r3~0:depart', 'cut/r3~0'));
  assert.ok(!P.isUnder('cut/r3~0:depart', 'cut/r3~4'));
  assert.ok(!P.isUnder('work:mood', 'line/r3'));
  assert.ok(P.isUnder('cut/r3~0', 'line/r3'), 'bare salt keys work too');
});

test('slotParamPath builds shared, part and list slots', () => {
  assert.equal(P.slotParamPath('arrive', null, 'inkRise', 'dur', true), 'arrive.dur');
  assert.equal(P.slotParamPath('arrive', null, 'inkRise', 'yFrom', false), 'arrive@inkRise.yFrom');
  assert.equal(P.slotParamPath('ornament', 1, 'hankoSeal', 'size', false), 'ornament#1@hankoSeal.size');
  assert.equal(P.slotParamPath('ornament', 1, 'hankoSeal', 'amount', true), 'ornament#1.amount');
  assert.equal(P.slotParamPath('ornament', 2, null, null), 'ornament#2');
  assert.equal(P.slotParamPath('seam', undefined, 'irisGate', undefined, false), 'seam@irisGate');
  for (const slot of ['arrive@inkRise.yFrom', 'ornament#1@hankoSeal.size']) assert.ok(P.parse('work:' + slot).part);
  throwsCode(() => P.slotParamPath('camera', null, null, 'amount', true), 'bad-slot');
  throwsCode(() => P.slotParamPath('filter', 3, null, 'amount', true), 'bad-slot');
  throwsCode(() => P.slotParamPath('arrive', null, 'in', 'dur', false), 'bad-slot');
  throwsCode(() => P.slotParamPath('arrive', null, 'inkRise', 'y.from', false), 'bad-slot');
});
