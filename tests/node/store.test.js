/* 文字PVメーカー v2 — original work. Tests for core/store: history, undo/redo, coalescing, limits, side, selection. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const S = MV.use('core/store');
const D = MV.use('core/doc');

// A tiny reducer for these tests (the real one is core/commands, WP1). It keeps structural sharing and returns the
// same object when nothing changes, like every real reducer must.
let reduceCalls = 0;
function reduce(doc, cmd) {
  reduceCalls++;
  switch (cmd.t) {
    case 'seed':
      return doc.look.seed === cmd.v ? doc : { ...doc, look: { ...doc.look, seed: cmd.v } };
    case 'row': {
      const rows = doc.sheet.rows.slice();
      const i = rows.findIndex((r) => r.id === cmd.id);
      if (i >= 0 && rows[i].src === cmd.src) return doc;
      if (i >= 0) rows[i] = { id: cmd.id, src: cmd.src };
      else rows.push({ id: cmd.id, src: cmd.src });
      const next = Math.max(doc.sheet.next, parseInt(cmd.id.slice(1), 36) + 1);
      return { ...doc, sheet: { next, rows } };
    }
    case 'pin':
      return { ...doc, pins: { ...doc.pins, [cmd.path]: { v: cmd.v, by: 'user' } } };
    case 'restore':
      return cmd.doc;
    case 'batch':
      return cmd.cmds.reduce(reduce, doc);
    default:
      throw new Error('unknown command ' + cmd.t);
  }
}

function fresh(opts) {
  return S.createStore(Object.assign({ doc: D.defaultDoc(), reduce }, opts || {}));
}

test('dispatch, undo and redo restore deep-equal documents', () => {
  const store = fresh();
  const snapshots = [store.doc];
  const cmds = [{ t: 'seed', v: 7 }, { t: 'row', id: 'r1', src: '一行目' }, { t: 'pin', path: 'work:mood', v: 'quietHush' },
    { t: 'row', id: 'r1', src: '一行目!' }, { t: 'seed', v: 99 }];
  for (const cmd of cmds) {
    store.dispatch(cmd);
    snapshots.push(store.doc);
  }
  assert.equal(store.rev, cmds.length);
  const end = JSON.parse(JSON.stringify(store.doc));
  for (let i = cmds.length - 1; i >= 0; i--) {
    assert.ok(store.undo());
    assert.deepEqual(store.doc, snapshots[i]);
    assert.equal(store.doc, snapshots[i], 'undo swaps back the exact snapshot');
  }
  assert.equal(store.undo(), null);
  assert.deepEqual(store.doc, D.defaultDoc());
  for (let i = 0; i < cmds.length; i++) store.redo();
  assert.equal(store.redo(), null);
  assert.deepEqual(JSON.parse(JSON.stringify(store.doc)), end);
  assert.equal(store.doc.sheet.next, 2, 'row ids and next come back exactly');
});

test('reduce is never called on undo, redo or jump', () => {
  const store = fresh();
  store.dispatch({ t: 'seed', v: 2 });
  store.dispatch({ t: 'seed', v: 3 });
  const before = reduceCalls;
  store.undo();
  store.undo();
  store.redo();
  store.jump(store.list()[1].n);
  store.jump(0);
  assert.equal(reduceCalls, before);
});

test('a command that changes nothing records nothing', () => {
  const store = fresh();
  const events = [];
  store.on('doc', (e) => events.push(e));
  const rev = store.dispatch({ t: 'seed', v: 1 });
  assert.equal(rev, 0);
  assert.equal(store.rev, 0);
  assert.deepEqual(store.peek(), { undo: null, redo: null });
  assert.equal(events.length, 0);
  assert.throws(() => store.dispatch({}), (e) => e.code === 'bad-command');
});

test('a new edit after undo drops the redo branch', () => {
  const store = fresh();
  store.dispatch({ t: 'seed', v: 2 });
  store.dispatch({ t: 'seed', v: 3 });
  store.undo();
  store.dispatch({ t: 'seed', v: 4 });
  assert.equal(store.redo(), null);
  assert.equal(store.list().length, 2);
  store.undo();
  assert.equal(store.doc.look.seed, 2);
});

test('gesture: every dispatch with its mergeKey until end() is one entry', () => {
  const store = fresh();
  store.dispatch({ t: 'seed', v: 5 }, { mergeKey: 'slider:seed' });
  const g = store.gesture('slider:seed');
  for (let v = 10; v < 20; v++) store.dispatch({ t: 'seed', v }, { mergeKey: 'slider:seed', label: ['undo.edit', {}] });
  g.end();
  assert.equal(store.list().length, 2, 'the gesture does not merge into the entry made before it');
  store.dispatch({ t: 'seed', v: 30 }, { mergeKey: 'slider:seed' });
  assert.equal(store.list().length, 3, 'after end() the next dispatch starts a new entry');
  store.undo();
  assert.equal(store.doc.look.seed, 19);
  store.undo();
  assert.equal(store.doc.look.seed, 5);
  g.end();                                   // ending twice is harmless
});

test('gesture: another command in between starts a new entry', () => {
  const store = fresh();
  const g = store.gesture('drag');
  store.dispatch({ t: 'seed', v: 2 }, { mergeKey: 'drag' });
  store.dispatch({ t: 'row', id: 'r1', src: 'x' });
  store.dispatch({ t: 'seed', v: 3 }, { mergeKey: 'drag' });
  store.dispatch({ t: 'seed', v: 4 }, { mergeKey: 'drag' });
  g.end();
  assert.equal(store.list().length, 3);
});

test('mergeKey coalesces within 2 s of the newest entry (typing), and seal() closes the window', () => {
  let now = 1000;
  const store = fresh({ now: () => now });
  store.dispatch({ t: 'row', id: 'r1', src: 'あ' }, { mergeKey: 'type:r1' });
  now += 500;
  store.dispatch({ t: 'row', id: 'r1', src: 'あい' }, { mergeKey: 'type:r1' });
  now += 1900;
  store.dispatch({ t: 'row', id: 'r1', src: 'あいう' }, { mergeKey: 'type:r1' });
  assert.equal(store.list().length, 1, 'each step is within 2 s of the last one');
  now += 2500;
  store.dispatch({ t: 'row', id: 'r1', src: 'あいうえ' }, { mergeKey: 'type:r1' });
  assert.equal(store.list().length, 2, 'a pause longer than 2 s starts a new entry');
  now += 100;
  store.seal();
  store.dispatch({ t: 'row', id: 'r1', src: 'あいうえお' }, { mergeKey: 'type:r1' });
  assert.equal(store.list().length, 3, 'seal() ends the burst');
  store.dispatch({ t: 'row', id: 'r2', src: '別' }, { mergeKey: 'type:r2' });
  assert.equal(store.list().length, 4, 'a different mergeKey never merges');
  store.dispatch({ t: 'seed', v: 8 });
  store.dispatch({ t: 'seed', v: 9 });
  assert.equal(store.list().length, 6, 'no mergeKey, no merging');
});

test('meta.at overrides the clock, and a run that returns to its own start disappears', () => {
  const store = fresh();
  store.dispatch({ t: 'seed', v: 2 }, { mergeKey: 'k', at: 0 });
  const start = store.doc;
  store.dispatch({ t: 'seed', v: 3 }, { mergeKey: 'k', at: 3000 });
  assert.equal(store.list().length, 2, '3 s later: a new entry');
  store.dispatch({ t: 'seed', v: 4 }, { mergeKey: 'k', at: 3100 });
  assert.equal(store.list().length, 2, '0.1 s later: merged');
  store.dispatch({ t: 'restore', doc: start }, { mergeKey: 'k', at: 3200 });
  assert.equal(store.list().length, 1, 'back to the entry\'s own before (same object) → the entry is dropped');
  assert.equal(store.doc, start);
});

test('batch is one entry, and its event lists the commands', () => {
  const store = fresh();
  const events = [];
  store.on('doc', (e) => events.push(e));
  const cmds = [{ t: 'seed', v: 4 }, { t: 'row', id: 'r1', src: 'a' }, { t: 'pin', path: 'work:theme', v: 'sumiWashi' }];
  store.batch({ label: ['undo.ai', { tool: 'x', n: 3 }] }, cmds);
  assert.equal(store.list().length, 1);
  assert.deepEqual(store.peek().undo, ['undo.ai', { tool: 'x', n: 3 }]);
  assert.deepEqual(events[0].cmds, cmds);
  assert.equal(events[0].kind, 'do');
  assert.ok(events[0].touched.pins.has('work:theme'));
  assert.deepEqual([...events[0].touched.rows], ['r1']);
  store.undo();
  assert.deepEqual(store.doc, D.defaultDoc());
  assert.equal(store.batch({}, []), store.rev, 'an empty batch does nothing');
});

test('history never exceeds its limit', () => {
  const store = fresh({ limit: 5 });
  for (let v = 2; v < 12; v++) store.dispatch({ t: 'seed', v });
  assert.equal(store.list().length, 5);
  let undone = 0;
  while (store.undo()) undone++;
  assert.equal(undone, 5);
  assert.equal(store.doc.look.seed, 6);
  assert.throws(() => fresh({ limit: 0 }), (e) => e.code === 'bad-options');
  assert.equal(S.DEFAULT_LIMIT, 300);
});

test('side is never recorded and never changed by undo', () => {
  const store = fresh();
  const sides = [];
  store.on('side', (e) => sides.push(e.side));
  store.dispatch({ t: 'seed', v: 3 });
  store.setSide((s) => ({ ...s, looks: { ...s.looks, list: [{ n: 1 }] } }));
  const side = store.side;
  assert.equal(sides.length, 1);
  store.undo();
  store.redo();
  store.undo();
  assert.equal(store.side, side);
  assert.equal(store.list().length, 1);
  store.setSide((s) => s);
  assert.equal(sides.length, 1, 'returning the same side emits nothing');
});

test('selection: undo returns selBefore, redo returns selAfter', () => {
  const store = fresh();
  const events = [];
  store.on('doc', (e) => events.push(e));
  const A = { level: 'line', ids: ['r1'] }, B = { level: 'cut', key: 'r1~0' };
  store.dispatch({ t: 'seed', v: 3 }, { where: 'inspector', sel: { before: A, after: B } });
  assert.deepEqual(store.undo(), { where: 'inspector', sel: A });
  assert.deepEqual(store.redo(), { where: 'inspector', sel: B });
  assert.deepEqual(events.map((e) => [e.kind, e.sel]), [['do', B], ['undo', A], ['redo', B]]);
  const g = store.gesture('m');
  store.dispatch({ t: 'seed', v: 4 }, { mergeKey: 'm', sel: { before: A, after: A } });
  store.dispatch({ t: 'seed', v: 5 }, { mergeKey: 'm', sel: { before: B, after: B } });
  g.end();
  assert.deepEqual(store.undo().sel, A, 'a merged entry keeps its first selBefore');
  assert.deepEqual(store.redo().sel, B, 'and takes the last selAfter');
});

test('list, peek and jump walk the history with one event per jump', () => {
  const store = fresh();
  for (let v = 2; v <= 5; v++) store.dispatch({ t: 'seed', v }, { label: ['undo.edit', { v }] });
  const list = store.list();
  assert.deepEqual(list.map((e) => e.done), [true, true, true, true]);
  const events = [];
  store.on('doc', (e) => events.push(e));
  store.jump(list[0].n);
  assert.equal(store.doc.look.seed, 2);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'undo');
  assert.equal(events[0].cmds.length, 3);
  assert.deepEqual(store.peek(), { undo: ['undo.edit', { v: 2 }], redo: ['undo.edit', { v: 3 }] });
  store.jump(list[3].n);
  assert.equal(store.doc.look.seed, 5);
  assert.equal(events[1].kind, 'redo');
  store.jump(0);
  assert.equal(store.doc.look.seed, 1);
  assert.equal(store.jump(0), null);
  assert.throws(() => store.jump(999), (e) => e.code === 'unknown-entry');
});

test('events carry rev, kind and touched; off() stops them', () => {
  const store = fresh();
  const seen = [];
  const off = store.on('doc', (e) => seen.push(e));
  store.dispatch({ t: 'seed', v: 3 });
  assert.equal(seen[0].rev, 1);
  assert.equal(seen[0].touched.look, true);
  assert.equal(seen[0].touched.timing, false);
  assert.equal(seen[0].touched.rows.size, 0);
  off();
  store.dispatch({ t: 'seed', v: 4 });
  assert.equal(seen.length, 1);
  assert.throws(() => store.on('nope', () => {}), (e) => e.code === 'bad-event');
});

test('a throwing listener does not stop the others or corrupt the store', () => {
  const store = fresh();
  let second = 0;
  store.on('doc', () => { throw new Error('boom'); });
  store.on('doc', () => { second++; });
  assert.throws(() => store.dispatch({ t: 'seed', v: 3 }), /boom/);
  assert.equal(second, 1);
  assert.equal(store.doc.look.seed, 3);
  assert.equal(store.list().length, 1);
});

test('load clears history and reports every row as touched', () => {
  const store = fresh();
  store.dispatch({ t: 'seed', v: 3 });
  const events = [];
  store.on('doc', (e) => events.push(e));
  const doc = D.defaultDoc();
  doc.look.seed = 42;
  store.load(doc, D.defaultSide());
  assert.equal(store.undo(), null);
  assert.equal(store.list().length, 0);
  assert.equal(events[0].kind, 'load');
  assert.equal(events[0].touched.rows, 'all');
  assert.equal(store.doc.look.seed, 42);
});

test('documents are deep-frozen in dev, and only then', () => {
  const store = fresh();
  store.dispatch({ t: 'row', id: 'r1', src: 'a' });
  assert.ok(Object.isFrozen(store.doc.sheet.rows[0]));
  assert.throws(() => { 'use strict'; store.doc.look.seed = 5; }, TypeError);
  const loose = fresh({ freeze: false });
  loose.dispatch({ t: 'seed', v: 3 });
  assert.equal(Object.isFrozen(loose.doc), false);
  assert.throws(() => S.createStore({ doc: D.defaultDoc() }), (e) => e.code === 'bad-options');
});
