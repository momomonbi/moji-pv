/* 文字PVメーカー v2 — original work. Tests for ui/fields: the FieldSpec catalogue, slot paths, widgets and sectionsFor (DESIGN §6.4.4–§6.4.9, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const F = MV.use('ui/fields');
const P = MV.use('core/paths');
const SC = MV.use('core/schema');
const STRINGS = MV.use('i18n/strings');
const PLAN = corpus.planBasic();
const REG = corpus.stubRegistry(MV);
const SAMPLE_SCOPE = { work: 'work', line: 'line/r4', cut: 'cut/r4~7' };

// The shipped catalog, once it builds a valid registry (while WP5 is still adding parts it may not yet).
function catalogRegistry() {
  if (!MV.has('parts/catalog')) return null;
  try { return MV.use('parts/catalog').defaultRegistry(); } catch (e) { return null; }
}

function registries() {
  const out = [['stub', REG]];
  const cat = catalogRegistry();
  if (cat) out.push(['catalog', cat]);
  return out;
}

function labelKeysOf(field) {
  const keys = [];
  if (field.label) keys.push(field.label);
  for (const v of Object.values(field.labelArgs || {})) keys.push(v);
  for (const o of field.options || []) {
    if (o.label && !o.fallback) keys.push(o.label);
    for (const v of Object.values(o.labelArgs || {})) keys.push(v);
  }
  for (const o of field.presets || []) if (o.label) keys.push(o.label);
  return keys;
}

test('every FieldSpec has a known widget, a unique id and labels that exist', () => {
  const ids = new Set();
  const missing = [];
  for (const f of F.FIELDS) {
    assert.ok(F.WIDGETS.includes(f.widget), f.id + ': widget ' + f.widget);
    assert.ok(!ids.has(f.id), 'duplicate id ' + f.id);
    ids.add(f.id);
    assert.ok(Array.isArray(f.scopes) && f.scopes.length > 0, f.id + ': scopes');
    assert.equal(typeof f.basic, 'boolean', f.id + ': basic');
    for (const key of labelKeysOf(f)) if (!(key in STRINGS)) missing.push(f.id + ': ' + key);
  }
  assert.ok(F.FIELDS.length > 80, 'the catalogue covers every page');
  assert.deepEqual(missing, []);
});

test('every FieldSpec path parses and exists for its scopes; command fields name real commands', () => {
  const commands = MV.has('core/commands') ? MV.use('core/commands').COMMANDS : null;
  for (const f of F.FIELDS) {
    if (f.path) {
      const valid = F.slotScopes(f.path);
      for (const scope of f.scopes) {
        assert.ok(valid.includes(scope), f.id + ': ' + f.path + ' is not a ' + scope + ' slot (valid: ' + valid.join(',') + ')');
        const path = F.fieldPath(f, SAMPLE_SCOPE[scope]);
        assert.equal(P.format(P.parse(path)), path, f.id + ': round trip');
      }
    } else if (f.cmd) {
      assert.ok(F.COMMANDS_USED.includes(f.cmd.t), f.id + ': command ' + f.cmd.t);
      if (commands) assert.ok(commands.includes(f.cmd.t), f.id + ': core/commands has ' + f.cmd.t);
    } else {
      assert.ok(typeof f.derived === 'string' && f.derived, f.id + ': a field without path or command is derived');
    }
  }
});

test('part-qualified FieldSpec paths name parameters of the catalog (when it is loaded)', () => {
  const qualified = F.FIELDS.filter((f) => f.path && /@/.test(f.path));
  assert.ok(qualified.length >= 1);
  const reg = catalogRegistry();
  if (!reg) return;
  for (const f of qualified) {
    const part = P.parse('work:' + f.path).part;
    const params = reg.params(part.kind, part.key);
    assert.ok(params && params.some((p) => p.name === part.param), f.id + ': ' + f.path + ' exists in the catalog');
  }
});

test('slotScopes follows the §3.4 catalogue', () => {
  const cases = {
    mood: ['work'], theme: ['work'], season: ['work'], 'color.accent': ['work'], 'color.nope': [], 'face.display.ja': ['work'],
    'face.serif.weight': ['work'], 'face.body.cyrillic': [], 'amount.glitch': ['work'], 'amount.nope': [], texture: ['work'],
    'texture.amount': [], bpm: ['work'], readRate: ['work'], titleCard: ['work'],
    start: ['line'], end: ['line'], split: ['line'], lang: ['line'], t0: ['cut'],
    orient: ['work', 'line', 'cut'], 'text.scale': ['work', 'line', 'cut'], 'text.bogus': [],
    arrive: ['work', 'line', 'cut'], 'arrive.dur': ['work', 'line', 'cut'], 'arrive.bogus': [], 'arrive@inkRise': [],
    'arrive@inkRise.yFrom': ['work', 'line', 'cut'], 'ornament#1': ['work', 'line', 'cut'], 'ornament.amount': [],
    'ornament#1.amount': ['work', 'line', 'cut'], 'ornament.count': ['work', 'line', 'cut'], 'ornament#1.count': [],
    'filter#2.when': ['work', 'line', 'cut'], 'arrive#1': [], 'atmos.amount': ['work', 'line', 'cut'], 'atmos.ink': [],
    'seam.dur': ['work', 'line', 'cut'], 'el.text.nudge': ['work', 'line', 'cut'], 'el.ornament#2.hide': ['work', 'line', 'cut'],
    'el.filter#0.hide': [], 'Bad slot': [],
  };
  for (const [slot, want] of Object.entries(cases)) assert.deepEqual(F.slotScopes(slot), want, slot);
});

test('every registry param maps to a widget and a valid slot path', () => {
  for (const type of SC.TYPES) assert.ok(F.widgetFor({ type }), 'type ' + type);
  for (const [name, reg] of registries()) {
    for (const def of reg.all()) {
      if (def.kind === 'theme' || def.kind === 'mood') continue;
      const params = reg.params(def.kind, def.key);
      const idx = F.LIST_KINDS.includes(def.kind) ? 1 : null;
      const fields = F.paramFields(def.kind, idx, def.key, reg);
      assert.equal(fields.length, params.length, name + ' ' + def.kind + '/' + def.key);
      for (const f of fields) {
        assert.ok(F.WIDGETS.includes(f.widget), name + ' ' + f.path + ': widget for ' + f.spec.type);
        assert.ok(F.slotScopes(f.path).length === 3, name + ' ' + f.path + ' is a cut slot');
        if (f.widget === 'choice') assert.ok(f.options.length > 0, f.path + ': options');
        assert.equal(f.label, 'fld.param', f.path + ': a string label key (§4.23)');
        assert.ok(f.labelText && f.labelText.ja && f.labelText.en, f.path + ': label text');
      }
    }
  }
});

function sectionIds(sel, plan = PLAN) { return F.sectionsFor(sel, plan, REG).map((s) => s.id); }
function fieldPaths(sel, sectionId, plan = PLAN) {
  const s = F.sectionsFor(sel, plan, REG).find((x) => x.id === sectionId);
  return s ? s.fields.map((f) => f.path || f.key) : [];
}

test('sectionsFor: 作品全体 has its §6.4.5 sections with 見た目 and 強さ open', () => {
  const sections = F.sectionsFor({ level: 'work' }, PLAN, REG);
  assert.deepEqual(sections.map((s) => s.id), ['look', 'colors', 'type', 'energy', 'parts', 'title', 'timing', 'lines', 'looks',
    'defaults', 'other']);
  assert.deepEqual(sections.filter((s) => s.open).map((s) => s.id), ['look', 'energy']);
  assert.deepEqual(sections[0].label, ['sec.look', {}]);
  const type = fieldPaths({ level: 'work' }, 'type');
  assert.ok(type.includes('face.display.ja') && type.includes('face.body.latin'));
  assert.ok(!type.includes('face.display.ko'), 'scripts not in use are hidden');
  assert.equal(fieldPaths({ level: 'work' }, 'energy').length, SC.AMOUNT_KEYS.length);
  assert.ok(fieldPaths({ level: 'work' }, 'look').includes('look.set.aspect'), 'command fields are listed by key');
});

test('sectionsFor: 行 page lists time, marks and direction, with shared params once and part params when the cuts agree', () => {
  const sel = { level: 'line', ids: ['r4'] };
  assert.deepEqual(sectionIds(sel), ['time', 'marks', 'direction', 'colortype', 'cuts', 'elements', 'ai']);
  const dir = fieldPaths(sel, 'direction');
  for (const p of ['arrange', 'arrive', 'arrive.dur', 'arrive.ease', 'arrive.order', 'arrive.each', 'dwell', 'dwell.amount', 'depart',
    'seam']) assert.ok(dir.includes(p), p);
  assert.equal(dir.filter((p) => p === 'arrive.dur').length, 1, 'no duplicate rows');
  assert.ok(!dir.some((p) => p.startsWith('arrange@')), 'r4 cuts use different compositions: no part params');
  assert.ok(dir.includes('orient'), 'r4 can be vertical');
  const one = { lines: [{ id: 'r9', cuts: ['r9~0'] }], cuts: [{ key: 'r9~0', line: 'r9', role: 'lyric',
    slots: { arrange: { v: 'stubBlock', from: 'auto' } }, feat: { orients: ['h'] } }] };
  const oneDir = F.sectionsFor({ level: 'line', ids: ['r9'] }, one, REG).find((s) => s.id === 'direction').fields.map((f) => f.path);
  assert.ok(oneDir.includes('arrange@stubBlock.lift'), 'a single-cut line shows its part params');
  assert.ok(!oneDir.includes('orient'), 'horizontal-only text hides 向き');
  assert.ok(!F.sectionsFor({ level: 'line', ids: ['r9'] }, one, REG).some((s) => s.id === 'cuts'), 'one cut: no カット list');
});

test('sectionsFor: カット pages show 開始 only on inner cuts; special cuts get their own sections', () => {
  assert.deepEqual(fieldPaths({ level: 'cut', key: 'r4~7' }, 'time'), ['t0', 'cutEnd']);
  assert.deepEqual(fieldPaths({ level: 'cut', key: 'r4~0' }, 'time'), ['cutEnd']);
  assert.ok(sectionIds({ level: 'cut', key: 'title' }).includes('titletext'));
  assert.ok(!sectionIds({ level: 'cut', key: 'r4~0' }).includes('titletext'));
  const layout = fieldPaths({ level: 'cut', key: 'r4~0' }, 'layout');
  assert.deepEqual(layout.slice(0, 2), ['arrange', 'arrange.offsetX']);
  assert.ok(layout.includes('arrange@stubBlock.lift') && layout.includes('el.text.nudge'));
  const motion = fieldPaths({ level: 'cut', key: 'r4~0' }, 'motion');
  assert.ok(motion.includes('arrive.dur') && motion.includes('dwell.speed') && motion.includes('depart.ease'));
});

test('sectionsFor: 要素 pages follow the element and the list index', () => {
  const orn = F.sectionsFor({ level: 'el', scope: 'cut/r4~0', el: 'ornament', idx: 0 }, PLAN, REG);
  assert.deepEqual(orn.map((s) => s.id), ['list', 'slot']);
  assert.deepEqual(orn[1].label, ['crumb.ornament', { k: 1 }]);
  const slot = orn[1].fields.map((f) => f.path);
  for (const p of ['ornament#0', 'ornament#0.amount', 'ornament#0.ink', 'ornament#0@hairFrame.gap', 'el.ornament#0.hide']) {
    assert.ok(slot.includes(p), p);
  }
  const second = F.sectionsFor({ level: 'el', scope: 'cut/r4~0', el: 'ornament', idx: 1 }, PLAN, REG)[1].fields.map((f) => f.path);
  assert.ok(second.includes('ornament#1') && second.includes('ornament#1.amount') && !second.includes('ornament#0'),
    'an empty slot shows its shared params only');
  const text = F.sectionsFor({ level: 'el', scope: 'cut/r4~0', el: 'text' }, PLAN, REG);
  assert.ok(text[0].fields.some((f) => f.path === 'el.text.fill'));
  const tune = text.find((s) => s.id === 'tune').fields.map((f) => f.path);
  assert.deepEqual(tune, ['arrange@stubBlock.lift'], 'この部品の調整 lists part params only');
  const ground = fieldPaths({ level: 'el', scope: 'cut/r4~0', el: 'ground' }, 'ground');
  assert.deepEqual(ground, ['ground', 'ground.amount']);
  assert.deepEqual(sectionIds({ level: 'el', scope: 'cut/r4~0', el: 'seam' }), ['seam']);
  assert.deepEqual(sectionIds({ level: 'el', scope: 'line/r4', el: 'seam' }), [], '切り替え pages exist at cut scope only');
  const fx = sectionIds({ level: 'el', scope: 'work', el: 'filter', idx: 0 });
  assert.ok(fx.includes('workfx'), 'texture and flash at work scope');
  assert.ok(!sectionIds({ level: 'el', scope: 'cut/r4~0', el: 'filter', idx: 0 }).includes('workfx'));
});

test('sectionsFor: several lines, no plan, and ids unique within a page', () => {
  assert.deepEqual(sectionIds({ level: 'line', ids: ['r4', 'r5'] }), ['multi', 'direction', 'colortype', 'shift']);
  assert.deepEqual(sectionIds({ level: 'work' }, null).slice(0, 2), ['look', 'colors'], 'works before there are lyrics');
  const sels = [{ level: 'work' }, { level: 'line', ids: ['r4'] }, { level: 'cut', key: 'r4~0' },
    { level: 'el', scope: 'cut/r4~0', el: 'text' }, { level: 'el', scope: 'work', el: 'filter', idx: 2 }];
  for (const sel of sels) {
    const ids = F.sectionsFor(sel, PLAN, REG).flatMap((s) => s.fields.map((f) => f.path || f.key));
    assert.equal(new Set(ids).size, ids.length, JSON.stringify(sel) + ': ' + ids.join(' '));
  }
});

test('contextOf and pageOf describe the selection', () => {
  assert.equal(F.pageOf({ level: 'line', ids: ['r4', 'r5'] }, PLAN), 'lines');
  assert.equal(F.pageOf({ level: 'el', scope: 'line/r4', el: 'lens' }, PLAN), 'el.lens');
  const ctx = F.contextOf({ level: 'line', ids: ['r4'] }, PLAN, REG);
  assert.equal(ctx.scope, 'line/r4');
  assert.deepEqual(ctx.cutKeys, ['r4~0', 'r4~7']);
  assert.equal(F.agreedKey(ctx, 'arrive'), 'stubFade');
  assert.equal(F.agreedKey(ctx, 'arrange'), null, 'mixed');
  assert.equal(F.decisionsOf(ctx, 'ground')[0].v, 'flatFill');
  assert.equal(F.decisionsOf(F.contextOf({ level: 'cut', key: 'r5~0' }, PLAN, REG), 'seam')[0].v, 'stubCross');
  assert.equal(F.decisionsOf(ctx, 'seam')[0].v, 'hardCut', 'no seam entry = the fallback');
});

test('every action the WP8b views define has a cmd.* label (palette, menus, shortcut sheet)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { SRC } = require('../helpers/load.js');
  const ids = new Set();
  for (const name of ['inspector', 'palette', 'menus', 'dialogs', 'timeline']) {
    const text = fs.readFileSync(path.join(SRC, 'ui', name + '.js'), 'utf8');
    for (const m of text.matchAll(/\bdef\(\s*'([a-z][A-Za-z.]*[A-Za-z])'/g)) ids.add(m[1]);
    for (const m of text.matchAll(/defineAction\(\{\s*id:\s*'([a-z][A-Za-z.]*[A-Za-z])'/g)) ids.add(m[1]);
  }
  for (const pref of ['safeArea', 'reduceFlash', 'seekOnSelect', 'follow']) ids.add('pref.' + pref);
  assert.ok(ids.has('palette.open') && ids.has('picker.back') && ids.has('timeline.nudge') && ids.has('help.about'));
  assert.deepEqual([...ids].filter((id) => !(('cmd.' + id) in STRINGS)), []);
});

test('widgets: emphasis ranges toggle and merge', () => {
  const W = MV.use('ui/widgets');
  assert.deepEqual(W.toggleRange([], 2, 4), [[2, 4]]);
  assert.deepEqual(W.toggleRange([[2, 4]], 4, 6), [[2, 6]], 'touching ranges merge');
  assert.deepEqual(W.toggleRange([[2, 6]], 2, 4), [[4, 6]], 'a covered word is cut out');
  assert.deepEqual(W.toggleRange([[0, 9]], 3, 5), [[0, 3], [5, 9]]);
  assert.equal(W.covered([[0, 3]], 1, 2), true);
  assert.equal(W.round(0.30000000000000004, 0.01), 0.3);
  const t = MV.use('i18n/t').createT('en', STRINGS);
  assert.equal(W.optionText(t, F.optionsFor({ type: 'ease' }).find((o) => o.v === 'expoOut')), 'Expo · Out');
  assert.equal(W.optionText(t, { v: 'zzz', label: 'opt.zzz', fallback: 'zzz' }), 'zzz', 'unknown enum values show as written');
});

// --- review fixes ---------------------------------------------------------------------------------------------------

// The stub registry with a part parameter on the stub transition (the stubs declare none).
function seamParamRegistry() {
  const defs = corpus.allStubParts().map((d) => (d.kind === 'seam' && d.key === 'stubCross'
    ? Object.assign({}, d, { params: { soft: { type: 'num', min: 0, max: 1, step: 0.01, label: { ja: 'ぼかし', en: 'Softness' },
      auto: { range: [0.2, 0.6] } } } }) : d));
  return MV.use('core/registry').createRegistry(defs);
}

test('the line page 切り替え writes the line\'s first cut (§6.4.6), its params follow that cut', () => {
  const reg = seamParamRegistry();
  const sel = { level: 'line', ids: ['r5'] };
  const ctx = F.contextOf(sel, PLAN, reg);
  const dir = F.sectionsFor(sel, PLAN, reg).find((s) => s.id === 'direction').fields;
  const seam = dir.find((f) => f.path === 'seam');
  assert.equal(seam.firstCut, true);
  assert.equal(seam.label, 'fld.seamIntoLine');
  assert.deepEqual(F.pathsFor(seam, ctx), ['cut/r5~0:seam'], 'not line/r5:seam, which reaches every cut boundary');
  assert.deepEqual(F.clearPathsFor(seam, ctx), ['cut/r5~0:seam', 'line/r5:seam']);
  const own = dir.find((f) => f.path === 'seam@stubCross.soft');
  assert.ok(own && own.firstCut, 'r5~0 comes in with stubCross (r5~7 does not): its params are listed, at the first cut');
  assert.deepEqual(F.pathsFor(own, ctx), ['cut/r5~0:seam@stubCross.soft']);
  assert.ok(dir.find((f) => f.path === 'seam.dur').firstCut);
  // Other fields keep the line scope; one-cut lines keep it for 切り替え too; several lines map each line.
  assert.deepEqual(F.pathsFor(dir.find((f) => f.path === 'arrive'), ctx), ['line/r5:arrive']);
  const one = { lines: [{ id: 'r9', cuts: ['r9~0'] }], cuts: [{ key: 'r9~0', line: 'r9', role: 'lyric', slots: {}, feat: { orients: ['h'] } }] };
  assert.deepEqual(F.pathsFor(seam, F.contextOf({ level: 'line', ids: ['r9'] }, one, reg)), ['line/r9:seam']);
  const many = F.contextOf({ level: 'line', ids: ['r4', 'r5'] }, PLAN, reg);
  assert.deepEqual(F.pathsFor(seam, many), ['cut/r4~0:seam', 'cut/r5~0:seam']);
  assert.deepEqual(F.pathsFor(dir.find((f) => f.path === 'arrive'), many), ['line/r4:arrive', 'line/r5:arrive']);
  assert.deepEqual(F.pathsFor(seam, F.contextOf({ level: 'cut', key: 'r5~7' }, PLAN, reg)), ['cut/r5~7:seam'],
    'the cut page field (not firstCut) keeps its own cut');
});

test('pinned params of a part that is no longer chosen stay listed (§3.4 inactive, never hidden)', () => {
  const reg = seamParamRegistry();
  const sel = { level: 'line', ids: ['r4'] };
  const ctx = F.contextOf(sel, PLAN, reg);
  const pins = {
    'line/r4:arrange@stubBlock.lift': { v: 0.2, by: 'user' },       // r4's cuts disagree on the composition
    'line/r4:arrive@goneAway.depth': { v: 3, by: 'user' },          // a part the registry does not know
    'cut/r4~0:seam@stubCross.soft': { v: 0.4, by: 'user', sig: 'x' }, // first cut, whose transition is the hard cut
    'cut/r4~7:arrive@stubFade.nope': { v: 1, by: 'user', sig: 'y' },  // another scope: not on the line page
    'line/r5:arrange@stubBlock.lift': { v: 0.1, by: 'user' },       // another line
  };
  const pinned = F.pinnedSlots(ctx, pins);
  assert.deepEqual([...pinned.page].sort(), ['arrange@stubBlock.lift', 'arrive@goneAway.depth']);
  assert.deepEqual([...pinned.firstCut], ['seam@stubCross.soft']);
  const plain = F.sectionsFor(sel, PLAN, reg);
  const dir = F.withPinnedParams(plain, ctx, pinned).find((s) => s.id === 'direction').fields;
  const paths = dir.map((f) => f.path);
  const lift = dir.find((f) => f.path === 'arrange@stubBlock.lift');
  assert.ok(lift && lift.pinnedOnly && lift.widget === 'number' && lift.label === 'fld.param' && lift.labelText.en === 'Lift');
  assert.ok(paths.indexOf('arrange@stubBlock.lift') > paths.indexOf('arrange.offsetY') && paths.indexOf('arrange@stubBlock.lift') < paths.indexOf('arrive'),
    'listed with its part, after the part rows: ' + paths.join(' '));
  const gone = dir.find((f) => f.path === 'arrive@goneAway.depth');
  assert.ok(gone && gone.readOnly && gone.widget === 'text', 'an unknown part keeps a read-only row (it can still be unpinned)');
  const soft = dir.find((f) => f.path === 'seam@stubCross.soft');
  assert.ok(soft && soft.firstCut && soft.pinnedOnly);
  assert.deepEqual(F.pathsFor(soft, ctx), ['cut/r4~0:seam@stubCross.soft']);
  assert.ok(!paths.includes('arrive@stubFade.nope'));
  assert.equal(plain.find((s) => s.id === 'direction').fields.length + 3, dir.length, 'the input sections are not changed');
  // この部品の調整 (params of a kind, no part row) takes them too.
  const el = { level: 'el', scope: 'cut/r4~0', el: 'text' };
  const ectx = F.contextOf(el, PLAN, reg);
  const tune = F.withPinnedParams(F.sectionsFor(el, PLAN, reg), ectx, F.pinnedSlots(ectx, { 'cut/r4~0:dwell@oldHold.amp': { v: 1, by: 'user' } }))
    .find((s) => s.id === 'tune').fields;
  const hold = tune.find((f) => f.path === 'dwell@oldHold.amp');
  assert.ok(hold && hold.group === 'dwell' && hold.pinnedOnly);
});

test('the work and line pages carry the §6.4.5 / §6.11 extra controls', () => {
  const work = F.sectionsFor({ level: 'work' }, PLAN, REG);
  const custom = (id) => work.find((s) => s.id === id).custom;
  assert.equal(custom('colors'), 'colorsReset');
  assert.equal(custom('energy'), 'amountsReset');
  assert.equal(custom('type'), 'fontBanner');
  assert.equal(work.find((s) => s.id === 'type').customTop, true);
  const marks = F.sectionsFor({ level: 'line', ids: ['r4'] }, PLAN, REG).find((s) => s.id === 'marks');
  assert.equal(marks.custom, 'lockPartial');
});

test('cutpoints: an auto cut is pinned as it is, a pinned or marked cut goes, an empty gap gains a cut', () => {
  const W = MV.use('ui/widgets');
  assert.deepEqual(W.cutClick([0, 8, 21], 8, 'auto'), [0, 8, 21], 'clicking the auto ┊ at 8 pins the current split');
  assert.deepEqual(W.cutClick([0, 8, 21], 12, 'auto'), [0, 8, 12, 21]);
  assert.deepEqual(W.cutClick([0, 8, 21], 8, 'pin'), [0, 21]);
  assert.deepEqual(W.cutClick([0, 8], 8, 'mark'), [0]);
  assert.deepEqual(W.cutClick([8], 3, 'pin'), [0, 3, 8], 'the split always starts at 0');
});

test('number fields show no stand-in value; focused controls keep their own keys', () => {
  const W = MV.use('ui/widgets');
  assert.equal(W.numberText(null, 1, 0.1), '', 'no tempo: empty, not the spec minimum');
  assert.equal(W.numberText(undefined, 100, 1), '');
  assert.equal(W.numberText(0.634, 100, 1), '63');
  assert.equal(W.numberText(0, 1, 0.01), '0');
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']) {
    assert.equal(W.ownsKey({ key }), true, key);
  }
  assert.equal(W.ownsKey({ key: 'ArrowLeft', ctrlKey: true }), false, 'Ctrl+← stays the timeline nudge');
  assert.equal(W.ownsKey({ key: 'Delete' }), false, 'Del still unpins the focused field');
  assert.equal(W.ownsKey({ key: ' ' }), false);
});

test('timeline: song marks read song.info as the AI stores it; edges tell pins from LRC stamps', () => {
  const TL = MV.use('ui/timeline');
  const m = TL.songMarks({ sections: [{ kind: 'chorus', start: 10, end: 20 }, { kind: 'drop', start: 20, end: 30 }, { kind: 'verse', start: 5 }],
    highlights: [{ time: 3, what: 'break' }, { time: 'x' }, 7] });
  assert.deepEqual(m.sections, [{ t0: 10, t1: 20, kind: 'chorus' }, { t0: 20, t1: 30, kind: 'other' }]);
  assert.deepEqual(m.highlights, [3, 7]);
  assert.deepEqual(TL.songMarks(null), { sections: [], highlights: [] });
  for (const s of ['intro', 'verse', 'prechorus', 'chorus', 'bridge', 'interlude', 'solo', 'outro', 'other']) {
    assert.ok(('songSec.' + s) in STRINGS, 'songSec.' + s);
  }
  assert.equal(TL.edgeKind('pin'), 'pin');
  assert.equal(TL.edgeKind('lrc'), 'lrc', 'an LRC stamp is a mark, not a pin (§3.5)');
  assert.equal(TL.edgeKind('auto'), 'auto');
  assert.equal(TL.edgeKind(undefined), 'auto');
});

test('WP8b views keep UI text in the string table: no Japanese in string literals (§4.24)', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { SRC } = require('../helpers/load.js');
  const TOKEN = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g;
  const JAPANESE = /[぀-ヿ㐀-䶿一-鿿]/;
  const found = [];
  for (const name of ['fields', 'inspector', 'widgets', 'part_browser', 'palette', 'menus', 'dialogs', 'timeline']) {
    const text = fs.readFileSync(path.join(SRC, 'ui', name + '.js'), 'utf8');
    for (const m of text.matchAll(TOKEN)) if (!m[0].startsWith('/') && JAPANESE.test(m[0])) found.push(name + ': ' + m[0]);
  }
  assert.deepEqual(found, []);
  assert.ok('list.sep' in STRINGS && STRINGS['list.sep'][1] !== '・', 'lists are joined with the string table\'s separator');
});

// --- INT-UI: pins go where the cut's pins live (§4.10.4) -------------------------------------------------------------

test('writePath / pinCmd / clearPathsFor: a cut whose pins live under an older key keeps them there', () => {
  const plan = JSON.parse(JSON.stringify(PLAN));
  const cut = plan.cuts.find((c) => c.key === 'r4~7');
  cut.pinKey = 'r4~6';
  assert.equal(F.writePath('cut/r4~7:arrive', plan), 'cut/r4~6:arrive');
  assert.equal(F.writePath('cut/r4~7:arrive@stubFade.dur', plan), 'cut/r4~6:arrive@stubFade.dur');
  assert.equal(F.writePath('cut/r4~0:arrive', plan), 'cut/r4~0:arrive', 'a cut without pinKey keeps its key');
  assert.equal(F.writePath('line/r4:arrive', plan), 'line/r4:arrive');
  assert.equal(F.writePath('cut/r4~7:arrive', null), 'cut/r4~7:arrive', 'no plan, no mapping');
  assert.equal(F.writeScope('cut/r4~7', plan), 'cut/r4~6');
  assert.equal(F.writeScope('work', plan), 'work');
  const sig = (p, key) => 'sig:' + key;
  assert.deepEqual(F.pinCmd('cut/r4~7:dwell', 'stubBob', plan, sig),
    { t: 'pin.set', path: 'cut/r4~6:dwell', v: 'stubBob', by: 'user', sig: 'sig:r4~7' }, 'the sig is the displayed cut\'s text');
  assert.deepEqual(F.pinCmd('line/r4:dwell', 'stubBob', plan, sig, 'ai'), { t: 'pin.set', path: 'line/r4:dwell', v: 'stubBob', by: 'ai' });
  const ctx = F.contextOf({ level: 'cut', key: 'r4~7' }, plan, REG);
  const field = F.FIELDS.find((f) => f.path === 'arrive' && f.scopes.includes('cut'));
  assert.deepEqual(F.clearPathsFor(field, ctx), ['cut/r4~7:arrive', 'cut/r4~6:arrive'], '× / Del also reach the pin as stored');
});

test('pinCmd keeps a line\'s earlier cut pins attached through the planner; the exact key would orphan them', () => {
  if (!MV.has('planner/plan') || !MV.has('core/commands')) return;
  const PL = MV.use('planner/plan');
  const reduce = MV.use('core/commands').reduce;
  const base = corpus.project('basic').doc;
  // A pin made when the first piece of r4 started at offset 2 (before an edit): it reattaches by its sig (§4.10.4 step 2).
  base.pins = { 'cut/r4~2:arrive': { v: 'stubFade', by: 'user', sig: '始発のホームに' } };
  const plan0 = PL.plan(base, { registry: REG });
  const cut0 = plan0.cuts.find((c) => c.key === 'r4~0');
  assert.equal(cut0.pinKey, 'r4~2', 'the fixture reattaches the older key');
  assert.equal(cut0.slots.arrive.from, 'pin:cut');
  const orphans = (p) => p.warnings.filter((w) => w.code === 'orphan-pin' || w.code === 'shadowed-pin');

  const good = reduce(base, F.pinCmd('cut/r4~0:dwell', 'stubBob', plan0, PL.pinSig));
  const plan1 = PL.plan(good, { registry: REG });
  const cut1 = plan1.cuts.find((c) => c.key === 'r4~0');
  assert.deepEqual([cut1.slots.arrive.v, cut1.slots.arrive.from], ['stubFade', 'pin:cut'], 'the earlier pin still applies');
  assert.deepEqual([cut1.slots.dwell.v, cut1.slots.dwell.from], ['stubBob', 'pin:cut'], 'the new pin applies');
  assert.deepEqual(orphans(plan1), []);

  const naive = reduce(base, { t: 'pin.set', path: 'cut/r4~0:dwell', v: 'stubBob', by: 'user', sig: '始発のホームに' });
  const plan2 = PL.plan(naive, { registry: REG });
  assert.ok(orphans(plan2).length > 0, 'writing at the exact key leaves the earlier pins without a cut');
});

// --- final fixes (ui-fields) -------------------------------------------------------------------------------------------

// A small DOM for the widget and part-browser tests: elements, text, attributes (dataset and `hidden` reflected), class
// lists, bubbling events, focus, and the selectors these views use (tag, .class, [attr], [attr="v"], :not(…), descendant).
function installFakeDom() {
  if (globalThis.document && globalThis.document.fake) return globalThis.document;
  const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
  class Node {
    constructor() { this.parentNode = null; this.childNodes = []; }
    get firstChild() { return this.childNodes[0] || null; }
    get isConnected() { let x = this; while (x.parentNode) x = x.parentNode; return x === doc; }
    appendChild(n) { return this.insertBefore(n, null); }
    insertBefore(n, ref) {
      if (n.parentNode) n.parentNode.removeChild(n);
      const i = ref ? this.childNodes.indexOf(ref) : -1;
      if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
      n.parentNode = this;
      return n;
    }
    removeChild(n) {
      const i = this.childNodes.indexOf(n);
      if (i >= 0) this.childNodes.splice(i, 1);
      n.parentNode = null;
      // Like a browser: a removed element that held the focus loses it (moving nodes is a removal).
      if (doc.activeElement && n.contains(doc.activeElement)) doc.activeElement = doc.body;
      return n;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
    get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
    set textContent(v) { for (const c of this.childNodes.slice()) this.removeChild(c); if (v !== '') this.appendChild(new Text(String(v))); }
  }
  class Text extends Node {
    constructor(s) { super(); this.data = s; }
    get textContent() { return this.data; }
    set textContent(v) { this.data = String(v); }
  }
  class Element extends Node {
    constructor(tag) {
      super();
      this.tagName = tag.toUpperCase();
      this.attrs = new Map();
      this.listeners = {};
      this.hidden = false;
      this.disabled = false;
      this.value = '';
      this.checked = false;
      this.style = { setProperty(k, v) { this[k] = v; } };
      const self = this;
      this.dataset = new Proxy({}, {
        get: (o, k) => (typeof k === 'string' && self.attrs.has('data-' + kebab(k)) ? self.attrs.get('data-' + kebab(k)) : undefined),
        set: (o, k, v) => { self.attrs.set('data-' + kebab(k), String(v)); return true; },
      });
      this.classList = {
        list: () => self.className.split(/\s+/).filter(Boolean),
        contains: (c) => self.classList.list().includes(c),
        add: (...cs) => { self.className = [...new Set(self.classList.list().concat(cs))].join(' '); },
        remove: (...cs) => { self.className = self.classList.list().filter((x) => !cs.includes(x)).join(' '); },
        toggle: (c, on) => { const want = on === undefined ? !self.classList.contains(c) : !!on; if (want) self.classList.add(c); else self.classList.remove(c); return want; },
      };
    }
    get className() { return this.attrs.get('class') || ''; }
    set className(v) { this.attrs.set('class', String(v)); }
    get children() { return this.childNodes.filter((n) => n instanceof Element); }
    get offsetTop() { return 0; }
    setAttribute(k, v) { this.attrs.set(k, String(v)); }
    getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
    hasAttribute(k) { return this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
    dispatchEvent(ev) {
      ev.target = this;
      for (let x = this; x && !ev.stopped; x = x.parentNode) {
        ev.currentTarget = x;
        for (const fn of (x.listeners && x.listeners[ev.type]) || []) fn.call(x, ev);
        if (!ev.bubbles) break;
      }
      return !ev.defaultPrevented;
    }
    click() { this.dispatchEvent(event('click')); }
    focus() {
      if (doc.activeElement === this || this.disabled || !this.isConnected) return;
      doc.activeElement = this;
      this.dispatchEvent(event('focusin'));
    }
    blur() { if (doc.activeElement === this) doc.activeElement = doc.body; }
    scrollIntoView() {}
    getContext() { return null; }
    matches(sel) { return sel.split(',').some((s) => matchChain(this, s.trim().split(/\s+/))); }
    closest(sel) { for (let x = this; x instanceof Element; x = x.parentNode) if (x.matches(sel)) return x; return null; }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => { for (const c of n.children) { if (c.matches(sel)) out.push(c); walk(c); } };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }
  function event(type) {
    return { type, bubbles: type !== 'focus' && type !== 'blur', stopped: false, defaultPrevented: false,
      stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; } };
  }
  function matchOne(el, compound) {
    const re = /:not\(([^)]*)\)|\[([\w-]+)(?:="([^"]*)")?\]|\.([\w-]+)|#([\w-]+)|([\w-]+|\*)/g;
    for (const m of compound.matchAll(re)) {
      if (m[1] !== undefined) { if (matchOne(el, m[1])) return false; }
      else if (m[2] !== undefined) {
        const has = m[2] === 'hidden' || m[2] === 'disabled' ? !!el[m[2]] : el.hasAttribute(m[2]);
        if (!has || (m[3] !== undefined && el.getAttribute(m[2]) !== m[3])) return false;
      } else if (m[4] !== undefined) { if (!el.classList.contains(m[4])) return false; }
      else if (m[5] !== undefined) { if (el.getAttribute('id') !== m[5]) return false; }
      else if (m[6] !== undefined && m[6] !== '*' && el.tagName !== m[6].toUpperCase()) return false;
    }
    return true;
  }
  function matchChain(el, parts) {
    if (!matchOne(el, parts[parts.length - 1])) return false;
    if (parts.length === 1) return true;
    for (let x = el.parentNode; x instanceof Element; x = x.parentNode) if (matchChain(x, parts.slice(0, -1))) return true;
    return false;
  }
  const doc = new Element('#document');
  doc.fake = true;
  doc.body = new Element('body');
  doc.appendChild(doc.body);
  doc.activeElement = doc.body;
  doc.createElement = (tag) => new Element(tag);
  doc.createElementNS = (ns, tag) => new Element(tag);
  doc.createTextNode = (s) => new Text(s);
  globalThis.document = doc;
  globalThis.Element = Element;
  return doc;
}

function inputEvent(el, type) { el.dispatchEvent({ type, bubbles: true, stopped: false, stopPropagation() {}, preventDefault() {} }); }

const T = MV.use('i18n/t');

test('ux-1: el.text.fill is labelled as the fill it is; unpinned it reads 自動 with the text and accent colors, never black', () => {
  installFakeDom();
  const W = MV.use('ui/widgets');
  assert.deepEqual(STRINGS['fld.emphInk'], ['塗り（強調・線も同じ色）', 'Fill (all text, emphasis and lines)'],
    'the §3.4.3 slot replaces the whole text element\'s ink, not only the emphasis');
  const pal = PLAN.look.palette;
  assert.ok(!Object.values(pal).includes('#000000'), 'the fixture palette holds no black');
  // Pure view: every color row of every page, unpinned.
  for (const f of F.FIELDS.filter((x) => x.widget === 'color')) {
    const v = W.colorView(null, f.path, pal);
    assert.equal(v.hex, null, f.id + ': no hex without a value');
    assert.ok(v.auto && !v.chips.includes('#000000') && v.pickAt !== '#000000', f.id + ': no stand-in black');
  }
  const fillView = W.colorView(null, 'el.text.fill', pal);
  assert.deepEqual(fillView.chips, [pal.ink.toUpperCase(), pal.accent.toUpperCase()]);
  assert.equal(fillView.pickAt, pal.accent.toUpperCase(), 'the picker starts at the accent');
  assert.equal(W.colorView('accent', 'text.ink', pal).hex, pal.accent.toUpperCase());
  assert.equal(W.colorView('#22dd44', 'el.text.fill', pal).hex, '#22DD44');

  // The widget, as the inspector drives it.
  const field = F.FIELDS.find((f) => f.path === 'el.text.fill');
  for (const lang of ['ja', 'en']) {
    const t = T.createT(lang, STRINGS);
    const commits = [];
    const env = { app: {}, t, label: t(field.label), field, commit: (v) => commits.push(v), gesture: () => ({ set() {}, end() {} }),
      unpin() {}, open() {}, thumb() {}, slot() {} };
    const w = W.make(field, env);
    document.body.appendChild(w.el);
    w.update({ value: null, mixed: false, auto: true, readOnly: false, extra: { palette: pal } });
    const name = w.el.querySelector('.w-color-name').textContent;
    assert.equal(name, t('w.color.autoText'));
    assert.ok(!/#000000/i.test(w.el.textContent) && !/#000000/i.test(w.el.querySelector('.w-color').getAttribute('aria-label')), lang + ': no #000000');
    assert.equal(w.el.querySelector('.w-hex').value, '', 'no hex in the box');
    assert.equal(w.el.querySelector('.w-contrast').textContent, '', 'no contrast line without a color');
    assert.equal(w.el.querySelector('.w-picker').value, pal.accent.toLowerCase(), 'the native picker opens at the accent');
    const chip = w.el.querySelector('.w-chip').style.background;
    assert.ok(chip.includes(pal.ink.toUpperCase()) && chip.includes(pal.accent.toUpperCase()), 'a split chip of ink and accent');
    assert.ok(w.el.classList.contains('is-auto'));
    // Pinned: the hex, the chip and the contrast readout are back.
    w.update({ value: '#22DD44', mixed: false, auto: false, readOnly: false, extra: { palette: pal } });
    assert.equal(w.el.querySelector('.w-color-name').textContent, '#22DD44');
    assert.equal(w.el.querySelector('.w-hex').value, '#22DD44');
    assert.ok(w.el.querySelector('.w-contrast').textContent.includes(':1'));
    assert.ok(!w.el.classList.contains('is-auto'));
    w.el.remove();
  }
});

test('perf-3: the part browser asks explain() once per plan; search, tags and tabs reuse the same tiles', async () => {
  installFakeDom();
  const PB = MV.use('ui/part_browser');
  const reg = catalogRegistry() || REG;
  const t = T.createT('ja', STRINGS, reg);
  const kind = 'arrive';
  const keys = PB.keysFor(reg, kind);
  assert.ok(keys.length >= 4, 'enough parts to filter');
  const plan0 = { look: { mood: { v: reg.keys('mood')[0] }, theme: { v: reg.keys('theme')[0] } } };
  const app = { t, reg, doc: { filters: {}, look: { aspect: '16:9' } }, plan: plan0, label: (k, key) => t.part(k, key),
    thumbs: { draw() {}, animate: () => () => {} }, tryOn() {}, menus: null };
  // The planner's alternatives: every part, one masked, in reverse key order (so おすすめ differs from すべて).
  let calls = 0;
  const alts = () => { calls++; return keys.slice().reverse().map((key, i) => ({ key, w: 10 - i, masked: i === 1 ? 'trait' : null })); };
  const page = PB.pickerPage(app, { kind, path: 'cut/r4~0:arrive', label: 'x', value: keys[0], allowNone: false, tryDoc: () => null,
    alts, onPick() {} });
  document.body.appendChild(page.el);
  const grid = page.el.querySelector('.pb-grid');
  const visible = () => grid.querySelectorAll('.pb-tile').map((x) => x.dataset.key).filter(Boolean);
  const tileOf = (key) => grid.querySelectorAll('.pb-tile').find((x) => x.dataset.key === key);
  assert.equal(calls, 0, 'opening the page does not wait for explain()');
  assert.deepEqual(visible(), [keys[0]], 'until explain() answers, おすすめ holds the current part only');
  assert.ok(!grid.querySelector('.note'), 'and does not say that nothing matches');
  page.focus();
  assert.equal(document.activeElement, tileOf(keys[0]), 'the current part takes the focus');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 1, 'explain() runs once, after the page shows');
  const rec = keys.slice().reverse().filter((k, i) => i !== 1);
  assert.deepEqual(visible(), rec, 'おすすめ = the unmasked alternatives by weight');
  assert.equal(document.activeElement, tileOf(keys[0]), 'the focus stays on the current part when the answer lands');

  const before = new Map(rec.map((k) => [k, tileOf(k)]));
  const same = () => visible().every((k) => !before.has(k) || tileOf(k) === before.get(k));
  const search = page.el.querySelector('.pb-search');
  const q = keys[2].slice(0, 3).toLowerCase();
  for (let i = 1; i <= 3; i++) { search.value = q.slice(0, i); inputEvent(search, 'input'); }
  const hit = (k) => [k, reg.get(kind, k).label.ja, reg.get(kind, k).label.en].some((s) => s.toLowerCase().includes(q));
  assert.deepEqual(visible(), rec.filter(hit), 'the search leaves out what does not match');
  assert.ok(same(), 'typing reuses the tiles');
  const tabButton = (x) => page.el.querySelector('.pb-tabs [data-tab="' + x + '"]');
  tabButton('all').click();
  assert.deepEqual(visible(), keys.filter(hit), 'すべて keeps the key order');
  assert.equal(tabButton('all').getAttribute('aria-selected'), 'true');
  tabButton('rec').click();
  assert.deepEqual(visible(), rec.filter(hit));
  assert.equal(calls, 1, 'opening, typing three characters and switching tabs twice ask explain() once');
  search.value = '';
  inputEvent(search, 'input');
  assert.deepEqual(visible(), rec);
  assert.ok(rec.every((k) => tileOf(k) === before.get(k)), 'after all that, the same tile elements');
  const tagChip = page.el.querySelector('.pb-tag');
  if (tagChip) {
    const tag = tagChip.dataset.tag;
    tagChip.click();
    assert.deepEqual(visible(), rec.filter((k) => (reg.get(kind, k).tags || []).includes(tag)), 'a tag chip filters');
    assert.equal(tagChip.getAttribute('aria-pressed'), 'true');
    tagChip.click();
  }
  assert.equal(calls, 1);

  // Focus survives a reorder; a tile that leaves hands the focus to 自動に戻す; a new plan asks again (once).
  tabButton('all').click();
  const focusKey = keys[keys.length - 1];
  tileOf(focusKey).focus();
  tabButton('rec').click();
  assert.equal(document.activeElement, tileOf(focusKey), 'the focused tile keeps the focus when the order changes');
  tabButton('all').click();
  tileOf(keys[keys.length - 2]).focus();
  tabButton('rec').click();
  assert.equal(document.activeElement, grid.querySelector('.pb-auto'), 'a masked tile leaves おすすめ; 自動に戻す takes the focus');
  tileOf(focusKey).focus();
  app.plan = { look: plan0.look };
  page.refresh();
  assert.equal(document.activeElement.dataset.key, focusKey, 'a rebuild keeps the focused part focused');
  assert.deepEqual(visible(), rec, 'the last answer shows while the new plan is asked');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(calls, 2, 'a new plan asks explain() again, once');
  page.destroy();
  page.el.remove();
});

test('spec-4: every string value of every registered enum parameter has an opt.<value> label in ja and en', () => {
  const missing = new Set();
  let checked = 0;
  for (const [name, reg] of registries()) {
    for (const def of reg.all()) {
      if (def.kind === 'theme' || def.kind === 'mood') continue;
      for (const p of reg.params(def.kind, def.key) || []) {
        if (p.spec.type !== 'enum') continue;
        const field = F.paramFields(def.kind, F.LIST_KINDS.includes(def.kind) ? 0 : undefined, def.key, reg).find((f) => f.param.name === p.name);
        for (const o of field.options) {
          if (typeof o.v !== 'string') continue;
          checked++;
          const pair = STRINGS[o.label];
          if (!Array.isArray(pair) || !pair[0] || !pair[1]) missing.add(o.label + ' (' + name + ' ' + def.kind + '/' + def.key + '.' + p.name + ')');
        }
      }
    }
  }
  assert.ok(checked > 40, 'the catalogs have enum parameters to check');
  assert.deepEqual([...missing].sort(), []);
  // What the widget shows for them: the string, never the code value.
  const W = MV.use('ui/widgets');
  const t = T.createT('ja', STRINGS);
  assert.equal(W.optionText(t, { v: 'topLeft', label: 'opt.topLeft', fallback: 'topLeft' }), '左上');
});

test('spec-5: なぜ turns planner ids into words (rules, families, cuts), in ja and en', () => {
  const reg = catalogRegistry();
  if (!reg || !MV.has('planner/plan') || !MV.has('planner/explain')) return;
  const PL = MV.use('planner/plan');
  const EX = MV.use('planner/explain');
  const ts = { ja: T.createT('ja', STRINGS, reg), en: T.createT('en', STRINGS, reg) };
  // Latin letters in the Japanese text other than LRC, or code-shaped words (camelCase, dotted, kebab, cut keys) in both.
  const CODE = /\b(?:r[0-9a-z]*~\d+|gap\/|[a-z]+[A-Z][A-Za-z]*|[a-z]+\.[a-z]+|[a-z]+-[a-z]+|[a-z]+#\d)/;
  const bad = [];
  const rules = new Set();
  let n = 0;
  for (const name of ['basic', 'vertical', 'lrc']) {
    const doc = corpus.project(name).doc;
    const plan = PL.plan(doc, { registry: reg });
    const sels = [{ level: 'work' }];
    for (const l of plan.lines.slice(0, 4)) sels.push({ level: 'line', ids: [l.id] });
    for (const c of plan.cuts.slice(0, 6)) sels.push({ level: 'cut', key: c.key });
    for (const el of ['text', 'ornament', 'ground', 'lens', 'filter', 'seam']) {
      sels.push({ level: 'el', scope: 'work', el, idx: 0 });
      if (plan.cuts[3]) sels.push({ level: 'el', scope: 'cut/' + plan.cuts[3].key, el, idx: 0 });
    }
    const paths = new Set();
    for (const sel of sels) {
      const ctx = F.contextOf(sel, plan, reg);
      for (const s of F.sectionsFor(sel, plan, reg)) for (const f of s.fields) for (const p of F.pathsFor(f, ctx)) paths.add(p);
    }
    for (const path of paths) {
      const ex = EX.explain(doc, plan, path, { registry: reg });
      for (const w of ex.why) if (w.code === 'rule') rules.add(F.whyRuleKey(w.params.rule, P.parse(path).slot));
      for (const lang of ['ja', 'en']) {
        const parts = F.whyParts(ex, path, ts[lang], plan);
        n += parts.length;
        for (const text of parts) {
          if (CODE.test(text) || (lang === 'ja' && /[A-Za-z]/.test(text.replace(/LRC/g, '')))) bad.push(lang + ' ' + path + ': ' + text);
        }
      }
    }
  }
  assert.ok(n > 200, 'the corpus explains many values (' + n + ')');
  assert.deepEqual(bad, []);
  assert.deepEqual([...rules].filter((k) => !(k in STRINGS)).sort(), [], 'every rule the planner names has its own words');

  // The params the old view printed raw: a cut key, a family id, a rule id.
  const plan = corpus.planBasic();
  const t = ts.ja;
  const ex = { why: [{ code: 'echo', params: { cut: 'r4~7' } }, { code: 'family', params: { family: 'wipe' } },
    { code: 'rule', params: { rule: 'text.face' } }, { code: 'rule', params: { rule: 'el.ornament#1.hide' } },
    { code: 'rule', params: { rule: 'motion-own' } }, { code: 'echo', params: { cut: 'nowhere~3' } }] };
  const words = F.whyParts(ex, 'line/r4:text.face', t, plan);
  assert.equal(words.length, 5, 'a cut that is not in the plan is left out, not shown as a key');
  assert.ok(/^\d+行(の)?(カット\d+)?と同じ歌詞なのでそろえた$/.test(words[0]), words[0]);
  assert.equal(words[1], t('why.family'));
  assert.equal(words[2], t('whyRule.text.face'));
  assert.equal(words[3], t('whyRule.el.hide'));
  assert.equal(words[4], t('whyRule.motion-own'));
  assert.ok(!words.join('').includes('wipe') && !words.join('').includes('r4~7'));
});

test('ux-16: choice labels are not verbs, error texts say what happened, hints say where', () => {
  assert.equal(STRINGS['fld.snap.off'][0], 'しない', 'a 拍に合わせる choice, not the verb 切る');
  assert.equal(STRINGS['err.ai.bad_provider'][0], '対応していないサービスです。');
  assert.equal(STRINGS['look.autoMark'][0], '＊ = いま自動で選ばれているもの');
  assert.ok(STRINGS['err.file.newer'][0].includes('開けません') && /cannot be opened/.test(STRINGS['err.file.newer'][1]),
    'a newer file says it was not opened (§6.11)');
  assert.ok(STRINGS['empty.previewHint'][0].includes('「① 歌詞」に歌詞を貼り付け'), 'lyrics are pasted into step ①, not onto the lyrics');
  // English spelling is one variety (the UI says "color").
  const british = Object.entries(STRINGS).filter(([, [, en]]) => /colour|favour|centre|neighbour|licence|recognis/i.test(en));
  assert.deepEqual(british.map(([k]) => k), []);
});

test('ux-16: style.css states each shared rule once', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { SRC } = require('../helpers/load.js');
  const css = fs.readFileSync(path.join(SRC, 'ui', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, '');
  for (const run of ['min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', 'display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px',
    '11pxvar(--mono);color:var(--muted);text-align:right', 'gap:4px;font-size:11px;color:var(--muted)']) {
    assert.ok(!css.includes(run), 'style.css repeats ' + run);
  }
  assert.equal(css.split('text-overflow:ellipsis').length - 1, 2, 'one shared one-line rule (plus .next-btn span)');
});
