/* 文字PVメーカー v2 — original work. Saved scene-number hiding migrates once to timer visibility, and legacy fields stay out of every inspector path. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const D = MV.use('core/doc');
const M = MV.use('core/migrate');
const F = MV.use('ui/fields');
const REG = MV.use('parts/catalog').defaultRegistry();
const TARGETS = ['arrange@sidebarIndex', ...[0, 1, 2].map((i) => 'ornament#' + i + '@serialMark')];

function documentWith(pins) {
  const doc = D.defaultDoc();
  doc.sheet = { next: 2, rows: [{ id: 'r1', src: 'A lyric' }] };
  doc.pins = pins;
  return doc;
}

test('blank scene numbers and whitespace-only sidebar numbers become timer-off at the same scope with their provenance and cut signature', () => {
  const scopes = ['work', 'line/r1', 'cut/r1~0', 'cut/title', 'cut/gap/r1', 'cut/gap/r1~2'];
  const blanks = ['', ' ', '\t', '\r\n', '\u3000', ' \t '];
  const pins = {};
  for (const [s, scope] of scopes.entries()) for (const [i, target] of TARGETS.entries()) {
    pins[scope + ':' + target + '.number'] = { v: target.startsWith('arrange@') ? blanks[s] : '', by: D.PIN_BY[(s + i) % D.PIN_BY.length],
      ...(scope.startsWith('cut/') ? { sig: 'original lyric signature' } : {}), custom: { preserve: true } };
  }
  const old = documentWith(pins), before = JSON.stringify(old);
  const doc = D.normalize(old);
  assert.notEqual(doc, old);
  assert.notEqual(doc.pins, old.pins);
  assert.equal(doc.sheet, old.sheet);
  assert.equal(doc.look, old.look);
  for (const path of Object.keys(pins)) {
    const timer = path.replace(/\.number$/, '.showTime');
    assert.equal(Object.hasOwn(doc.pins, path), false, 'the old empty intent is consumed');
    assert.deepEqual(doc.pins[timer], { ...pins[path], v: false });
    assert.equal(doc.pins[timer].custom, pins[path].custom, 'untouched metadata keeps structural sharing');
  }
  assert.deepEqual(D.validate(doc), []);
  assert.equal(JSON.stringify(old), before, 'normalization never mutates the saved input');
  assert.equal(D.normalize(doc), doc, 'migration is idempotent');
});

test('explicit timer visibility wins over old blank text; clearing the migrated switch does not resurrect old hiding', () => {
  for (const target of TARGETS) for (const value of [true, false]) for (const oldValue of target.startsWith('arrange@') ? ['', ' ', '\t', '\u3000'] : ['']) {
    const explicit = { v: value, by: 'ai' };
    const old = documentWith({ ['line/r1:' + target + '.number']: { v: oldValue, by: 'user' },
      ['line/r1:' + target + '.showTime']: explicit });
    const doc = D.normalize(old);
    assert.equal(doc.pins['line/r1:' + target + '.showTime'], explicit);
    assert.equal(Object.hasOwn(doc.pins, 'line/r1:' + target + '.number'), false);
  }
  for (const oldValue of ['', ' ', '\t', '\u3000']) {
    const migrated = D.normalize(documentWith({ 'work:arrange@sidebarIndex.number': { v: oldValue, by: 'user' } }));
    const unpinned = { ...migrated, pins: {} };
    assert.equal(D.normalize(unpinned), unpinned);
    assert.equal(Object.hasOwn(unpinned.pins, 'work:arrange@sidebarIndex.showTime'), false);
  }
});

test('nonempty legacy text, unrelated number parameters and management identifiers retain their exact types and references', () => {
  const pins = {
    'work:arrange@sidebarIndex.number': { v: '42', by: 'user' },
    'line/r1:arrange@sidebarIndex.number': { v: '0', by: 'user' },
    'line/r1:ornament#0@serialMark.number': { v: '07', by: 'user' },
    'line/r1:ornament#1@serialMark.number': { v: ' ', by: 'user' },
    'work:arrange@otherPart.number': { v: '', by: 'user' },
    'work:ornament#2@otherPart.number': { v: '', by: 'user' },
    'work:arrange#0@sidebarIndex.number': { v: '', by: 'user' },
    'work:ornament@serialMark.number': { v: '', by: 'user' },
  };
  const doc = documentWith(pins);
  assert.equal(D.normalize(doc), doc);
  assert.equal(doc.pins, pins);
  assert.deepEqual(doc.sheet, { next: 2, rows: [{ id: 'r1', src: 'A lyric' }] });
  for (const [path, pin] of Object.entries(pins)) assert.equal(doc.pins[path], pin);
});

test('schema-one and schema-two saved projects reopen with hidden timers and can be saved and reopened again', () => {
  for (const schema of [1, 2]) {
    const doc = documentWith({
      'cut/r1~0:arrange@sidebarIndex.number': { v: ' \t\n ', by: 'user', sig: 'A lyric' },
      'line/r1:ornament#2@serialMark.number': { v: '', by: 'lock' },
      'work:arrange@otherPart.number': { v: 'custom', by: 'user' },
    });
    const file = JSON.parse(D.serialize({ doc })); file.schema = schema;
    const opened = M.parseFile(JSON.stringify(file));
    assert.deepEqual(opened.doc.pins['cut/r1~0:arrange@sidebarIndex.showTime'], { v: false, by: 'user', sig: 'A lyric' });
    assert.deepEqual(opened.doc.pins['line/r1:ornament#2@serialMark.showTime'], { v: false, by: 'lock' });
    assert.deepEqual(opened.doc.pins['work:arrange@otherPart.number'], { v: 'custom', by: 'user' });
    const restored = M.parseFile(D.serialize(opened));
    assert.deepEqual(restored.doc.pins, opened.doc.pins);
  }
});

test('timer controls are basic boolean toggles at every scope; legacy number text stays valid for saved projects but has no field', () => {
  for (const [kind, key] of [['arrange', 'sidebarIndex'], ['ornament', 'serialMark']]) {
    const definition = REG.get(kind, key);
    assert.equal(definition.params.number.type, 'text');
    assert.equal(definition.params.number.ai, false);
    assert.equal(definition.params.showTime.type, 'bool');
    assert.equal(definition.params.showTime.auto.value, true);
    for (const index of kind === 'ornament' ? [0, 1, 2] : [null]) {
      const fields = F.paramFields(kind, index, key, REG);
      const prefix = kind + (index === null ? '' : '#' + index) + '@' + key;
      assert.ok(!fields.some((field) => field.path === prefix + '.number'));
      const timer = fields.find((field) => field.path === prefix + '.showTime');
      assert.ok(timer && timer.basic && timer.widget === 'toggle');
      assert.equal(timer.spec.type, 'bool');
      for (const scope of ['work', 'line/r1', 'cut/r1~0']) assert.equal(F.fieldPath(timer, scope), scope + ':' + prefix + '.showTime');
    }
  }
});

test('normal, advanced and inactive-pinned inspector collections all exclude old numbers while preserving other inactive parameters', () => {
  const base = corpus.planBasic();
  const planWith = (active) => ({ ...base, cuts: base.cuts.map((cut) => ({ ...cut, slots: { ...cut.slots,
    arrange: { v: active ? 'sidebarIndex' : REG.keys('arrange').find((key) => key !== 'sidebarIndex') },
    ...Object.fromEntries([0, 1, 2].map((i) => ['ornament#' + i, { v: active ? 'serialMark' : 'none' }])),
    'ornament.count': { v: 3 },
  } })) });
  const selections = [{ level: 'work' }, { level: 'line', ids: ['r4'] }, { level: 'line', ids: ['r4', 'r5'] },
    { level: 'cut', key: 'r4~0' }, { level: 'el', scope: 'cut/r4~0', el: 'text' },
    ...[0, 1, 2].map((idx) => ({ level: 'el', scope: 'cut/r4~0', el: 'ornament', idx }))];
  for (const active of [true, false]) for (const sel of selections) {
    const plan = planWith(active);
    const ctx = F.contextOf(sel, plan, REG);
    const scope = ctx.scope;
    const pins = { [scope + ':arrange@goneAway.depth']: { v: 3, by: 'user' } };
    for (const target of TARGETS) {
      pins[scope + ':' + target + '.number'] = { v: '77', by: 'user' };
      pins[scope + ':' + target + '.showTime'] = { v: false, by: 'user' };
    }
    const doc = documentWith(pins);
    const sections = F.sectionsFor(sel, plan, REG, doc);
    const collected = F.pinnedSlots(ctx, pins);
    assert.ok([...collected.page, ...collected.firstCut].every((slot) => !TARGETS.some((target) => slot === target + '.number')));
    // Even a caller holding old cached pinned slots cannot reintroduce a legacy readonly parameter row.
    for (const target of TARGETS) collected.page.add(target + '.number');
    const expanded = F.withPinnedParams(sections, ctx, collected);
    for (const fields of [sections.flatMap((section) => section.fields), expanded.flatMap((section) => section.fields)]) {
      assert.ok(fields.every((field) => !TARGETS.some((target) => field.path === target + '.number')));
    }
    for (const timer of expanded.flatMap((section) => section.fields).filter((field) => /\.showTime$/.test(field.path))) {
      assert.equal(timer.widget, 'toggle');
      assert.equal(timer.spec.type, 'bool');
    }
    if (sel.level === 'line' || sel.level === 'cut') {
      const other = expanded.flatMap((section) => section.fields).find((field) => field.path === 'arrange@goneAway.depth');
      assert.ok(other && other.pinnedOnly && other.readOnly, 'unrelated inactive pins remain inspectable on ' + JSON.stringify(sel));
    }
  }
});
