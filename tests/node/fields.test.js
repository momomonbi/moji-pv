/* 文字PVメーカー v2 — original work. Tests: planner/fields — field states, lock payloads, faces parity (DESIGN §3.6, §3.13, §4.16.8). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const REG = MV.use('core/registry');
const P = MV.use('core/paths');
const PINS = MV.use('core/pins');
const PL = MV.use('planner/plan');
const F = MV.use('planner/fields');
const LK = MV.use('planner/look');
const DF = MV.use('planner/diff');

const clone = (x) => JSON.parse(JSON.stringify(x));
const user = (v, sig) => (sig === undefined ? { v, by: 'user' } : { v, by: 'user', sig });

// The stub parts plus an arrange that moves its text itself (motion: 'own') and a seam that replaces the exit.
const OWN = { kind: 'arrange', key: 'tickerOwn', motion: 'own', label: { ja: '流れ', en: 'Ticker' },
  blurb: { ja: '試験用', en: 'Test part' }, tags: ['fast'], pool: false, build: () => ({}) };
const WIPE = { kind: 'seam', key: 'wipeWorld', scope: 'world', replaces: { depart: true }, label: { ja: '拭き', en: 'Wipe' },
  blurb: { ja: '試験用', en: 'Test part' }, tags: ['bold'], mix: (fx, a) => a };
const REGISTRY = REG.createRegistry(corpus.allStubParts().concat([OWN, WIPE]));
const plan = (doc) => PL.run(doc, REGISTRY, null);
const state = (doc, p, path, sel) => F.fieldState(doc, p, sel || null, path, { registry: REGISTRY });

test('field states: auto, pinned, ai, inherited (line and work), mixed', () => {
  const doc = clone(corpus.project('basic').doc);
  const p0 = plan(doc);
  const [c0, c1] = p0.lines[0].cuts;
  const line1 = p0.lines[1];
  const cut0 = p0.cuts.find((c) => c.key === c0);
  doc.pins = {
    ['cut/' + c0 + ':arrive']: user('stubFade', cut0.text),
    ['cut/' + c1 + ':dwell']: { v: 'stubBob', by: 'ai', sig: p0.cuts.find((c) => c.key === c1).text },
    ['line/' + line1.id + ':lens']: user('stubDrift'),
    'work:text.style': user('glow'),
  };
  const p = plan(doc);
  let fs = state(doc, p, 'cut/' + c0 + ':arrange');
  assert.equal(fs.state, 'auto');
  assert.equal(fs.pinnedAt, null);
  assert.deepEqual(fs.canPinAt, ['cut', 'line', 'work']);
  assert.equal(fs.schema.type, 'part');
  assert.ok(fs.schema.of.includes('centerAnchor'));
  assert.deepEqual(fs.display, ['val.part', { kind: 'arrange', key: fs.value }]);
  fs = state(doc, p, 'cut/' + c0 + ':arrive');
  assert.deepEqual([fs.state, fs.pinnedAt, fs.by, fs.value], ['pinned', 'cut', 'user', 'stubFade']);
  assert.equal(fs.pinAt, 'cut/' + c0 + ':arrive');
  fs = state(doc, p, 'cut/' + c1 + ':dwell');
  assert.deepEqual([fs.state, fs.by], ['ai', 'ai']);
  fs = state(doc, p, 'cut/' + line1.cuts[0] + ':lens');
  assert.deepEqual([fs.state, fs.pinnedAt, fs.value], ['inherited', 'line', 'stubDrift']);
  fs = state(doc, p, 'line/' + line1.id + ':lens');
  assert.deepEqual([fs.state, fs.pinnedAt], ['pinned', 'line']);
  assert.deepEqual(fs.canPinAt, ['line', 'work']);
  fs = state(doc, p, 'cut/' + c0 + ':text.style');
  assert.deepEqual([fs.state, fs.pinnedAt, fs.value], ['inherited', 'work', 'glow']);
  fs = state(doc, p, 'line/' + p.lines[0].id + ':arrive');
  assert.equal(fs.state, 'mixed', 'one cut of the line pinned, the other automatic');
  // several lines selected: a slot that differs between them is mixed
  const sel = { level: 'line', ids: p.lines.slice(0, 4).map((l) => l.id) };
  const values = new Set(p.cuts.filter((c) => sel.ids.includes(c.line)).map((c) => c.slots.dwell.v));
  fs = state(doc, p, 'line/' + sel.ids[3] + ':dwell', sel);
  if (values.size > 1) {
    assert.equal(fs.state, 'mixed');
    assert.deepEqual(fs.display, ['state.mixed', {}]);
  }
});

// §4.16.8: inherited (↑) means the pin lives at a broader scope than the selection. Pins below the selection (every
// cut of a line pinned at cut scope) are shown as pinned there, never as inherited from above.
test('field states: pins below the selection are pinned at their scope, not inherited', () => {
  const doc = clone(corpus.project('basic').doc);
  const p0 = plan(doc);
  const line = p0.lines.find((l) => l.cuts.length >= 2);
  const cutsOf = (p) => line.cuts.map((k) => p.cuts.find((c) => c.key === k));
  doc.pins = {};
  for (const c of cutsOf(p0)) doc.pins['cut/' + c.key + ':arrive'] = user('stubFade', c.text);
  let p = plan(doc);
  let fs = state(doc, p, 'line/' + line.id + ':arrive');
  assert.deepEqual([fs.state, fs.pinnedAt, fs.by, fs.pinAt, fs.value], ['pinned', 'cut', 'user', null, 'stubFade']);
  for (const c of cutsOf(p0)) doc.pins['cut/' + c.key + ':arrive'] = { v: 'stubFade', by: 'ai', sig: c.text };
  p = plan(doc);
  fs = state(doc, p, 'line/' + line.id + ':arrive');
  assert.deepEqual([fs.state, fs.pinnedAt, fs.by], ['ai', 'cut', 'ai']);
  doc.pins['cut/' + line.cuts[0] + ':arrive'] = user('stubFade', cutsOf(p0)[0].text);
  p = plan(doc);
  assert.equal(state(doc, p, 'line/' + line.id + ':arrive').state, 'mixed', 'the same value, pinned by different hands');
  // a pin above the selection is still inherited
  const all = clone(corpus.project('basic').doc);
  all.pins = { 'work:dwell': user('stubBob') };
  fs = state(all, plan(all), 'line/' + line.id + ':dwell');
  assert.deepEqual([fs.state, fs.pinnedAt], ['inherited', 'work']);
});

// §3.6: a lock freezes the line as it is. An arrange with motion: 'own' decides the entrance, hold and exit itself
// (§4.18.2), so the lock leaves those to it (a lock pin on them could never apply) and freezes their parameters.
test('locking a line whose arrange moves the text itself freezes no motion pins that cannot apply', () => {
  const doc = clone(corpus.project('basic').doc);
  const p0 = plan(doc);
  const line = p0.lines.find((l) => l.cuts.length >= 2);
  doc.pins['line/' + line.id + ':arrange'] = user('tickerOwn');
  const p = plan(doc);
  const payload = F.lockPayload(doc, p, line.id, { registry: REGISTRY });
  for (const key of line.cuts) {
    for (const kind of ['arrive', 'dwell', 'depart']) {
      assert.equal(payload.pins['cut/' + key + ':' + kind], undefined, key + ' ' + kind);
      assert.ok(Object.keys(payload.pins).some((k) => k.startsWith('cut/' + key + ':' + kind + '.')), key + ' ' + kind + ' params');
    }
  }
  const locked = clone(doc);
  Object.assign(locked.pins, payload.pins);
  locked.locks[line.id] = { n: 1 };
  const q = plan(locked);
  assert.deepEqual(q.warnings.filter((w) => w.code === 'pin-not-applicable' || w.code === 'lock-partial'), []);
  for (const key of line.cuts) {
    const a = p.cuts.find((c) => c.key === key), b = q.cuts.find((c) => c.key === key);
    for (const slot of Object.keys(a.slots)) assert.deepEqual([b.slots[slot].v, b.slots[slot].p], [a.slots[slot].v, a.slots[slot].p], key + ' ' + slot);
    assert.equal(b.fp, a.fp, key + ': the same scene');
    const fs = F.fieldState(locked, q, null, 'cut/' + key + ':arrive', { registry: REGISTRY });
    assert.deepEqual([fs.state, fs.inactiveReason], ['derived', null]);
    assert.equal(F.fieldState(locked, q, null, 'cut/' + key + ':arrive.dur', { registry: REGISTRY }).state, 'locked');
  }
});

test('field states: locked, mark, derived, inactive (part changed, not applicable)', () => {
  const doc = clone(corpus.project('vertical').doc);          // r6 is locked in the fixture
  let p = plan(doc);
  let fs = state(doc, p, 'cut/r6~0:arrange');
  assert.deepEqual([fs.state, fs.by], ['locked', 'lock']);
  fs = state(doc, p, 'line/r6:split');
  assert.equal(fs.state, 'locked');
  fs = state(doc, p, 'line/r5:split');
  assert.equal(fs.state, 'mark', "'/' marks in the row");
  fs = state(doc, p, 'line/r5:start');
  assert.deepEqual([fs.state, fs.by, fs.value], ['pinned', 'tap', 12.5]);
  const lrc = corpus.project('lrc').doc;
  const pl = plan(lrc);
  const stamped = pl.lines.find((l) => l.by.start === 'lrc');
  assert.equal(state(lrc, pl, 'line/' + stamped.id + ':start').state, 'mark');
  assert.deepEqual(state(lrc, pl, 'line/' + stamped.id + ':start').canPinAt, ['line']);
  // derived: an arrange with its own motion forces the entrance, hold and exit
  const cut = p.cuts.find((c) => c.key === 'r4~0');
  doc.pins['cut/r4~0:arrange'] = user('tickerOwn', cut.text);
  doc.pins['cut/r4~0:arrange@stubBlock.lift'] = user(0.2, cut.text);
  const en = p.cuts.find((c) => !c.feat.orients.includes('v'));
  p = plan(doc);
  fs = state(doc, p, 'cut/r4~0:arrive');
  assert.deepEqual([fs.state, fs.value], ['derived', REGISTRY.fallback('arrive')]);
  fs = state(doc, p, 'cut/r4~0:arrange@stubBlock.lift');
  assert.deepEqual([fs.state, fs.inactiveReason, fs.value], ['inactive', 'part-changed', 0.2]);
  if (en) {
    doc.pins['cut/' + en.key + ':orient'] = user('v', en.text);
    p = plan(doc);
    fs = state(doc, p, 'cut/' + en.key + ':orient');
    assert.deepEqual([fs.state, fs.inactiveReason], ['inactive', 'not-applicable']);
    assert.deepEqual(fs.warn, { code: 'pin-not-applicable', params: { line: en.line } });
  }
});

test('a pinned hard cut (切り替え「なし」) reads as pinned, although hard cuts are not listed in Plan.seams', () => {
  const doc = clone(corpus.project('basic').doc);
  const p0 = plan(doc);
  const hard = REGISTRY.fallback('seam');
  const first = p0.cuts[0], later = p0.cuts.slice(1);
  // Pin the hard cut on every later boundary, at cut scope: each one is applied, none is 無効.
  for (const c of later) doc.pins['cut/' + c.key + ':seam'] = user(hard, c.text);
  let p = plan(doc);
  assert.equal(p.seams.length, 0, 'every boundary is a hard cut');
  for (const c of later) {
    const fs = state(doc, p, 'cut/' + c.key + ':seam');
    assert.deepEqual([fs.state, fs.pinnedAt, fs.value, fs.pinAt], ['pinned', 'cut', hard, 'cut/' + c.key + ':seam'], c.key);
  }
  // A line pin of the hard cut applies to the line's cuts: the cut's row shows it inherited from the line.
  const line = p0.lines.find((l, i) => i > 0);
  const lineDoc = clone(corpus.project('basic').doc);
  lineDoc.pins['line/' + line.id + ':seam'] = user(hard);
  p = plan(lineDoc);
  const fs = state(lineDoc, p, 'cut/' + line.cuts[0] + ':seam');
  assert.deepEqual([fs.state, fs.pinnedAt, fs.value], ['inherited', 'line', hard]);
  // The very first cut has no boundary before it, so a seam pin there never applies.
  doc.pins['cut/' + first.key + ':seam'] = user(hard, first.text);
  p = plan(doc);
  assert.deepEqual([state(doc, p, 'cut/' + first.key + ':seam').state, state(doc, p, 'cut/' + first.key + ':seam').inactiveReason],
    ['inactive', 'not-applicable']);
});

test('field states of work slots, parameters, counts and elements', () => {
  const doc = clone(corpus.project('basic').doc);
  doc.pins = { 'work:mood': user('stubBright'), 'work:color.accent': user('#112233'), 'work:amount.glitch': user(0.4) };
  const p = plan(doc);
  let fs = state(doc, p, 'work:mood');
  assert.deepEqual([fs.state, fs.value, fs.pinnedAt], ['pinned', 'stubBright', 'work']);
  assert.deepEqual(fs.canPinAt, ['work']);
  fs = state(doc, p, 'work:theme');
  assert.deepEqual([fs.state, fs.value], ['auto', p.look.theme.v]);
  assert.equal(state(doc, p, 'work:color.accent').value, '#112233');
  assert.equal(state(doc, p, 'work:color.ink').state, 'auto');
  assert.equal(state(doc, p, 'work:amount.glitch').value, 0.4);
  const cut = p.cuts.find((c) => c.role === 'lyric');
  fs = state(doc, p, 'cut/' + cut.key + ':arrive.dur');
  assert.equal(fs.value, cut.slots.arrive.p.dur);
  assert.equal(fs.schema.type, 'num');
  assert.equal(fs.display, String(cut.slots.arrive.p.dur));
  fs = state(doc, p, 'cut/' + cut.key + ':ornament.count');
  assert.equal(fs.value, cut.slots['ornament.count'].v);
  assert.deepEqual(fs.schema, { type: 'int', min: 0, max: 3 });
  fs = state(doc, p, 'cut/' + cut.key + ':el.text.nudge');
  assert.deepEqual(fs.value, { dx: 0, dy: 0, rot: 0, s: 1 });
  fs = state(doc, p, 'cut/' + cut.key + ':t0');
  assert.deepEqual(fs.canPinAt, ['cut']);
  fs = state(doc, p, 'cut/' + cut.key + ':seam');
  assert.equal(fs.value, cut.seamIn >= 0 ? p.seams[cut.seamIn].slot.v : REGISTRY.fallback('seam'));
  fs = state(doc, p, 'cut/' + cut.key + ':ground');
  assert.equal(fs.value, p.grounds[cut.ground].ground.v);
  assert.deepEqual(F.fieldStates(doc, p, null, ['work:mood', 'work:theme'], { registry: REGISTRY }).map((x) => x.value),
    ['stubBright', p.look.theme.v]);
});

test('a pin whose cut key moved after an edit is still shown as pinned, at the key it lives under', () => {
  const doc = clone(corpus.project('basic').doc);
  const p0 = plan(doc);
  const line = p0.lines[0];
  const inner = p0.cuts.find((c) => c.key === line.cuts[1]);
  const off = Number(inner.key.split('~')[1]);
  const oldKey = line.id + '~' + (off + 1);                   // e.g. a pin made before one character was deleted
  doc.pins['cut/' + oldKey + ':dwell'] = user('stubBob', inner.text);
  const p = plan(doc);
  const cut = p.cuts.find((c) => c.key === inner.key);
  assert.equal(cut.pinKey, oldKey, 'the Plan records the key the pins use');
  const fs = state(doc, p, 'cut/' + inner.key + ':dwell');
  assert.deepEqual([fs.state, fs.pinAt, fs.value], ['pinned', 'cut/' + oldKey + ':dwell', 'stubBob']);
  const payload = F.lockPayload(doc, p, line.id, { registry: REGISTRY });
  assert.ok(Object.keys(payload.pins).some((k) => k.startsWith('cut/' + oldKey + ':')), 'lock pins join the same key');
  assert.ok(!Object.keys(payload.pins).some((k) => k.startsWith('cut/' + inner.key + ':')));
});

test('lockPayload covers every automatic cut slot of the line, and locking changes nothing on screen', () => {
  for (const name of ['basic', 'long', 'lrc']) {
    const doc = clone(corpus.project(name).doc);
    doc.pins = {};
    doc.locks = {};
    const p = plan(doc);
    for (const line of p.lines.filter((l, i) => i % 4 === 1).slice(0, 6)) {
      const payload = F.lockPayload(doc, p, line.id, { registry: REGISTRY });
      assert.equal(payload.t, 'lock.set');
      assert.equal(payload.lineId, line.id);
      assert.deepEqual(payload.pins['line/' + line.id + ':split'], { v: line.cuts.map((k) => P.cutOffset(k)), by: 'lock' });
      for (const key of line.cuts) {
        const cut = p.cuts.find((c) => c.key === key);
        for (const [slot, d] of Object.entries(cut.slots)) {
          const pin = payload.pins['cut/' + key + ':' + slot];
          assert.ok(pin, name + ' ' + key + ':' + slot);
          assert.deepEqual([pin.v, pin.by, pin.sig], [d.v, 'lock', cut.text]);
        }
        const i = p.cuts.indexOf(cut);
        if (i > 0) assert.ok(payload.pins['cut/' + key + ':seam'], key + ' seam');
        for (const path of Object.keys(payload.pins)) P.parse(path);
      }
      const locked = clone(doc);
      Object.assign(locked.pins, payload.pins);
      locked.locks[line.id] = { n: 1 };
      const q = plan(locked);
      for (const key of line.cuts) {
        const a = p.cuts.find((c) => c.key === key), b = q.cuts.find((c) => c.key === key);
        for (const slot of Object.keys(a.slots)) {
          assert.equal(b.slots[slot].v, a.slots[slot].v, key + ':' + slot);
          assert.deepEqual(b.slots[slot].p, a.slots[slot].p, key + ':' + slot + ' params');
          assert.equal(b.slots[slot].from, 'pin:cut');
          assert.equal(b.slots[slot].by, 'lock');
        }
        assert.equal(F.fieldState(locked, q, null, 'cut/' + key + ':arrange', { registry: REGISTRY }).state, 'locked');
      }
      assert.ok(!q.warnings.some((w) => w.code === 'lock-partial'));
    }
  }
});

test('lockPayload does not freeze values that are already pins, nor colors, times or backgrounds', () => {
  const doc = clone(corpus.project('basic').doc);
  const p0 = plan(doc);
  const line = p0.lines[2];
  const first = p0.cuts.find((c) => c.key === line.cuts[0]);
  doc.pins = { ['cut/' + first.key + ':arrive']: user('stubFade', first.text), 'work:dwell': user('stubBob') };
  const p = plan(doc);
  const payload = F.lockPayload(doc, p, line.id, { registry: REGISTRY });
  assert.equal(payload.pins['cut/' + first.key + ':arrive'], undefined, 'a user pin stays the user\'s');
  assert.equal(payload.pins['cut/' + first.key + ':dwell'], undefined, 'a value inherited from a work pin is not frozen');
  assert.ok(payload.pins['cut/' + first.key + ':arrive.dur'], 'its automatic parameters are');
  for (const path of Object.keys(payload.pins)) assert.ok(!/:(ground|atmos|start|end|color\.|face\.|amount\.)/.test(path), path);
});

test('pinSig is the cut text; diff lists what changed', () => {
  const doc = clone(corpus.project('basic').doc);
  const a = plan(doc);
  assert.equal(F.pinSig(a, a.cuts[1].key), a.cuts[1].text);
  assert.equal(PL.pinSig(a, 'nope~0'), '');
  const b = plan(Object.assign(clone(doc), { look: Object.assign({}, doc.look, { seed: doc.look.seed + 1 }) }));
  const d = DF.diff(a, b);
  assert.ok(d.length > 0);
  for (const e of d) {
    assert.ok(e.cut === null || a.cuts.some((c) => c.key === e.cut));
    assert.notDeepEqual(e.from, e.to);
    P.parse(e.path);
  }
  assert.deepEqual(DF.diff(a, a), []);
  const scope = 'line/' + a.lines[0].id;
  assert.ok(DF.diff(a, b, scope).every((e) => e.cut && e.cut.startsWith(a.lines[0].id + '~')));
  assert.deepEqual(DF.changedLines(DF.diff(a, b, scope)), DF.diff(a, b, scope).length ? [a.lines[0].id] : []);
});

test('faces: the Plan holds engine/text/faces.resolveFaces as plain JSON, keys sorted (§4.16.3)', () => {
  const FACES = MV.use('engine/text/faces');
  const themes = corpus.allStubParts().filter((d) => d.kind === 'theme');
  themes.push(Object.assign({}, themes[0], { key: 'noFlavorTheme', faces: { display: themes[0].faces.display,
    serif: Object.assign({}, themes[0].faces.serif, { flavor: 'heavy' }), body: Object.assign({}, themes[0].faces.body, { flavor: 'round' }) } }));
  const pinSets = [{}, { 'work:face.display.ja': user('Potta One') }, { 'work:face.serif.weight': user(800) },
    { 'work:face.body.ko': user('Noto Sans KR'), 'work:face.display.weight': user(300) }];
  const scriptSets = [['ja'], ['ja', 'en'], ['ko', 'zhHant', 'zhHans', 'ja'], ['en']];
  const sorted = (o) => Object.keys(o).join() === Object.keys(o).sort().join();
  for (const theme of themes) {
    for (const pins of pinSets) {
      for (const scripts of scriptSets) {
        const mine = LK.faces(theme, PINS.index(pins), new Set(scripts));
        assert.deepEqual(mine, JSON.parse(JSON.stringify(FACES.resolveFaces(theme, pins, scripts))), theme.key + ' ' + scripts);
        assert.ok(sorted(mine) && Object.values(mine).every(sorted), 'keys sorted: ' + JSON.stringify(mine));
      }
    }
  }
});

test('faces: the weight field shows the requested weight (pin, else the theme), the Plan the served one', () => {
  const FACES = MV.use('engine/text/faces');
  const doc = clone(corpus.project('basic').doc);
  const p0 = plan(doc);
  const theme = REGISTRY.get('theme', p0.look.theme.v);
  const want = Number(theme.faces.display.weight);
  assert.equal(state(doc, p0, 'work:face.display.weight').value, want);
  doc.pins = Object.assign({}, doc.pins, { 'work:face.display.weight': user(650) });
  const p = plan(doc);
  const fs = state(doc, p, 'work:face.display.weight');
  assert.deepEqual([fs.value, fs.state, fs.pinnedAt], [650, 'pinned', 'work'], 'the pinned request');
  for (const script of Object.keys(p.look.faces.display)) {
    const f = p.look.faces.display[script];
    assert.equal(f.weight, FACES.snapWeight(f.family, 650), 'the Plan holds the weight ' + f.family + ' serves');
  }
});

test('the palette: pins kept exactly, automatic ink and accent fitted, backdrop rules', () => {
  const C = MV.use('core/color');
  const theme = REGISTRY.get('theme', 'stubInk');
  const noPins = PINS.index({});
  const pal = LK.palette(theme, noPins, 'scene', () => {});
  assert.ok(C.contrast(pal.ink, pal.ground) >= 4.5 && C.contrast(pal.accent, pal.ground) >= 3);
  const light = LK.palette(theme, PINS.index({ 'work:color.ground': user('#F0F0F0') }), 'scene', () => {});
  assert.equal(light.ground, '#F0F0F0');
  assert.ok(C.contrast(light.ink, light.ground) >= 4.5, 'the automatic ink follows a pinned ground');
  const lowInk = LK.palette(theme, PINS.index({ 'work:color.ink': user('#20252E') }), 'scene', () => {});
  assert.equal(lowInk.ink, '#20252E', 'a pinned ink is the user\'s choice, even with poor contrast');
  const black = LK.palette(theme, noPins, 'black', () => {});
  assert.deepEqual([black.ground, black.ink, black.accent], ['#000000', '#FFFFFF', '#FFFFFF']);
  for (const t of ['shiftA', 'shiftB']) assert.match(black[t], /^#([0-9A-F]{2})\1\1$/, t + ' is grey');
  const greenish = { swatch: Object.assign({}, theme.swatch, { accent: '#22CC55' }) };
  const chroma = LK.palette(greenish, noPins, 'chroma', () => {});
  assert.equal(chroma.ground, '#00B140');
  assert.ok(C.hueDistance(chroma.accent, '#00B140') >= 40, 'accent moved away from the green screen');
});
