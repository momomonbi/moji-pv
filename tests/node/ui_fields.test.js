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
    // v2.1 (DESIGN_2_1 §2.3): the line season is a line value that may also be pinned for the whole video.
    mood: ['work'], theme: ['work'], season: ['work', 'line'], 'color.accent': ['work'], 'color.nope': [], 'face.display.ja': ['work'],
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

// --- v2.1 (package F): the scope table, widgets and pages of DESIGN_2_1 §2.3, §3.14, §6.5 ------------------------------

test('v2.1 slots: the scope table of DESIGN_2_1 §2.3 (camerawork, speed, section camera, line season, avoid, curve params)', () => {
  const ALL = ['work', 'line', 'cut'];
  const cases = {
    'motion.speed': ALL, 'cam.shot': ALL, 'cam.zoom': ALL, 'cam.curve': ALL, 'cam.follow': ALL, rig: ALL, 'rig.curve': ALL,
    season: ['work', 'line'], avoid: ['line'], 'arrive.flow': ALL, 'depart.flow': ALL, 'dwell.curve': ALL, 'lens.curve': ALL,
    'seam.curve': ALL, 'arrive.ease': ALL, 'cam.bogus': [], 'rig.bogus': [], 'motion.bogus': [],
  };
  for (const [slot, want] of Object.entries(cases)) assert.deepEqual(F.slotScopes(slot), want, slot);
  // The scope rules of core/commands agree (a refused path would make a row that cannot be written).
  const CMD = MV.use('core/commands');
  const D0 = MV.use('core/doc').defaultDoc();
  const ok = (path, v) => {
    const cmd = { t: 'pin.set', path, v, by: 'user' };
    if (path.startsWith('cut/')) cmd.sig = 's';
    try { CMD.reduce(D0, cmd); return true; } catch (e) { return false; }
  };
  assert.equal(ok('line/r1:season', 'spring'), true);
  assert.equal(ok('cut/r1~0:season', 'spring'), false, 'no season at cut scope');
  assert.equal(ok('work:avoid', ['arrive.inkRise']), false, 'avoid is a line value');
  assert.equal(ok('cut/r1~0:cam.shot', 'pushWord'), true);
});

test('v2.1 widgets: curve, shot, rig and partRefs specs map to their widgets; every new field has one', () => {
  assert.equal(F.widgetFor({ type: 'curve' }), 'curve');
  assert.equal(F.widgetFor({ type: 'shot' }), 'shot');
  assert.equal(F.widgetFor({ type: 'rig' }), 'rig');
  assert.equal(F.widgetFor({ type: 'partRefs' }), 'partRefs');
  for (const w of ['curve', 'shot', 'rig', 'partRefs']) assert.ok(F.WIDGETS.includes(w), w);
  const W = MV.use('ui/widgets');
  for (const w of F.WIDGETS) assert.ok(W.names().includes(w), 'ui/widgets makes ' + w);
  // Every shared curve param of the registry is edited by the curve widget (the line page's 緩急, 出方の緩急, …).
  const R = MV.use('core/registry');
  for (const kind of Object.keys(R.SHARED)) {
    for (const [name, spec] of Object.entries(R.SHARED[kind])) {
      if (spec.type === 'curve') assert.equal(F.widgetFor(spec), 'curve', kind + '.' + name);
    }
  }
});

test('v2.1 pages: 行 › 演出, カット › 動き, 要素 › カメラ and the area page carry the DESIGN_2_1 §6.5 rows', () => {
  const line = PLAN.lines.find((l) => l.cuts.length > 1) || PLAN.lines[0];
  const rowsOf = (sel, doc) => F.sectionsFor(sel, PLAN, REG, doc);
  const byPath = (secs) => new Map(secs.flatMap((s) => s.fields.map((f) => [f.path, Object.assign({ section: s.id }, f)])));
  const lp = byPath(rowsOf({ level: 'line', ids: [line.id] }));
  assert.equal(lp.get('arrive.ease').widget, 'curve');
  assert.equal(lp.get('arrive.ease').label, 'fld.speedCurve', '緩急 (was なめらかさ)');
  assert.equal(lp.get('depart.ease').widget, 'curve');
  assert.equal(lp.get('motion.speed').widget, 'number');
  assert.equal(lp.get('motion.speed').scale, 100, '×100 %');
  assert.equal(lp.get('cam.shot').widget, 'shot');
  assert.equal(lp.get('arrive.flow').basic, false, '出方の緩急 is advanced');
  assert.equal(lp.get('season').basic, false);
  assert.equal(lp.get('season').label, 'fld.lineSeason');
  assert.deepEqual(lp.get('season').options.map((o) => o.v), ['any', 'none', 'spring', 'summer', 'autumn', 'winter']);
  assert.equal(lp.get('avoid').widget, 'partRefs');
  const cut = PLAN.cuts.find((c) => c.line && PLAN.lines.find((l) => l.id === c.line).cuts.length > 1);
  if (cut) {
    const cp = byPath(rowsOf({ level: 'cut', key: cut.key }));
    assert.equal(cp.get('motion.speed').section, 'motion', 'カット › 動き + 動きの速さ');
  }
  const cam = rowsOf({ level: 'el', scope: 'line/' + line.id, el: 'lens' });
  assert.deepEqual(cam.map((s) => s.id), ['camwork', 'camtexture', 'rig']);
  assert.equal(cam[0].custom, 'camKeys', '[キーフレームを編集…]');
  assert.equal(cam[2].open, false, '区画のカメラ is folded');
  const cp2 = byPath(cam);
  assert.equal(cp2.get('cam.shot').widget, 'shot');
  assert.equal(cp2.get('cam.zoom').scale, 100);
  assert.equal(cp2.get('cam.curve').widget, 'curve');
  assert.equal(cp2.get('cam.follow').basic, false);
  assert.equal(cp2.get('lens.curve').basic, false, '動きの緩急 (advanced)');
  assert.equal(cp2.get('rig').widget, 'rig');
  assert.equal(cp2.get('rig.curve').widget, 'curve');
  // Every field path of the new rows is valid at its scopes (the catalogue test covers FIELDS; the work camera page too).
  const work = rowsOf({ level: 'el', scope: 'work', el: 'lens' });
  assert.ok(byPath(work).has('cam.shot'), '作品全体 › 要素の既定 › カメラ is the same page at work scope');
  // The area page: an area selection shows the several-lines page with its section camera.
  const ids = PLAN.lines.slice(0, 2).map((l) => l.id);
  assert.equal(F.pageOf({ level: 'line', ids: [ids[0]], area: { kind: 'lines', ids: [ids[0]] } }, PLAN), 'lines');
  const plain = rowsOf({ level: 'line', ids }).map((s) => s.id);
  const area = rowsOf({ level: 'line', ids, area: { kind: 'lines', ids } }).map((s) => s.id);
  assert.ok(!plain.includes('rig') && area.includes('rig'), 'the 区画のカメラ section only with an area: ' + area);
  // 作品全体 › マイ素材 only when the project has materials.
  const work0 = rowsOf({ level: 'work' }, { materials: { next: 1, list: [] } }).map((s) => s.id);
  const work1 = rowsOf({ level: 'work' }, { materials: { next: 2, list: [{ id: 'm1' }] } }).map((s) => s.id);
  assert.ok(!work0.includes('materials') && work1.includes('materials'));
});

test('DESIGN_2_1 §11.9.6: the depth strings (動きと重なり) exist with the design texts', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { SRC } = require('../helpers/load.js');
  const lines = fs.readFileSync(path.join(SRC, '..', 'docs', 'DESIGN_2_1.md'), 'utf8').split('\n');
  const at = lines.findIndex((l) => /^#### 11\.9\.6 /.test(l));
  assert.ok(at >= 0, 'the §11.9.6 table is in the design');
  const pairs = [];
  for (let i = at + 1; i < lines.length && !/^#/.test(lines[i]); i++) {
    const cells = lines[i].trim().split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 3 || !cells[0].startsWith('`')) continue;
    const toks = [...cells[0].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const ja = cells[1].split(' / '), en = cells[2].split(' / ');
    let prefix = '';
    toks.forEach((tok, k) => {
      const key = tok.startsWith('.') ? prefix + tok : tok;
      if (!tok.startsWith('.')) prefix = tok.slice(0, tok.lastIndexOf('.'));
      pairs.push([key, toks.length > 1 ? ja[k] : cells[1], toks.length > 1 ? en[k] : cells[2]]);
    });
  }
  assert.ok(pairs.length >= 13, 'every key of the table is read (' + pairs.length + ')');
  for (const [key, ja, en] of pairs) assert.deepEqual(STRINGS[key], [ja, en], key);
});

test('v2.1 areaLabel / areaTitle read song kinds through songSec and count the lines', () => {
  const T2 = MV.use('i18n/t');
  const ja = T2.createT('ja', STRINGS, REG, { strict: true });
  const en = T2.createT('en', STRINGS, REG, { strict: true });
  const song = { kind: 'song', n: 5, label: ['area.song', { kind: 'chorus', n: 1 }] };
  assert.equal(F.areaLabel(ja, song), 'サビ1');
  assert.equal(F.areaLabel(en, song), 'Chorus 1');
  assert.equal(F.areaTitle(ja, song), 'サビ1（5行）');
  assert.equal(F.areaTitle(en, song), 'Chorus 1 (5 lines)');
  assert.equal(F.areaTitle(en, Object.assign({}, song, { n: 1 })), 'Chorus 1 (1 line)');
  assert.equal(F.areaTitle(ja, { kind: 'work', n: 9, label: ['area.work', {}] }), '作品全体');
  assert.equal(F.areaTitle(ja, { kind: 'lines', n: 1, label: ['area.linesOne', { a: 4 }] }), '4行', 'one line names no count');
  assert.equal(F.areaTitle(ja, { kind: 'lines', n: 3, label: ['area.lines', { a: 4, b: 6 }] }), '4–6行（3行）');
  assert.equal(F.areaLabel(ja, { label: ['area.lines', { a: 3, b: 5 }] }), '3–5行');
  assert.equal(F.areaLabel(ja, null), '');
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
  // 写真・動画 (DESIGN_2_1 §11.7.3) follows 見た目; it opens once the library holds something.
  assert.deepEqual(sections.map((s) => s.id), ['look', 'media', 'colors', 'type', 'energy', 'parts', 'title', 'timing', 'lines', 'looks',
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
  assert.deepEqual(sectionIds({ level: 'work' }, null).slice(0, 3), ['look', 'media', 'colors'], 'works before there are lyrics');
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
  for (const name of ['fields', 'inspector', 'widgets', 'part_browser', 'palette', 'menus', 'dialogs', 'timeline',
    'curve_widget', 'shot_editor', 'material_page', 'ai_board', 'ai_panel', 'ai_review', 'stage', 'lyric_editor']) {
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
  // Latin letters in the Japanese text other than LRC and the song-section names (Aメロ, Bメロ and Cメロ are Japanese;
  // D's camera reasons name the section), or code-shaped words (camelCase, dotted, kebab, cut keys) in both.
  const CODE = /\b(?:r[0-9a-z]*~\d+|gap\/|[a-z]+[A-Z][A-Za-z]*|[a-z]+\.[a-z]+|[a-z]+-[a-z]+|[a-z]+#\d)/;
  const JA_WORDS = ['LRC'].concat(Object.keys(STRINGS).filter((k) => k.startsWith('songSec.')).map((k) => STRINGS[k][0]));
  const latinIn = (text) => /[A-Za-z]/.test(JA_WORDS.reduce((s, w) => s.split(w).join(''), text));
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
          if (CODE.test(text) || (lang === 'ja' && latinIn(text))) bad.push(lang + ' ' + path + ': ' + text);
        }
      }
    }
  }
  assert.ok(n > 200, 'the corpus explains many values (' + n + ')');
  assert.deepEqual(bad, []);
  // D's section, season and part keys in the camera and line reasons read as words (NOTES v2.1-D)
  const said = (code, params, path) => F.whyParts({ why: [{ code, params }] }, path, ts.ja, corpus.planBasic())[0];
  assert.equal(said('cam.section', { section: 'chorus' }, 'work:cam.shot'), '「サビ」の動き');
  assert.equal(said('rig.section', { section: 'verse' }, 'work:rig'), '「Aメロ」のカメラ');
  assert.equal(said('season.line', { season: 'spring' }, 'line/r4:ornament'), 'この行の季節（春）');
  assert.equal(said('cam.lens', { key: 'slowPush' }, 'work:cam.shot'), 'カメラの動き「' + ts.ja.part('lens', 'slowPush') + '」と重ならないように');
  assert.equal(said('cam.arrange', { key: 'edgeBleed' }, 'work:cam.shot'), '構図「' + ts.ja.part('arrange', 'edgeBleed') + '」に合わせて控えめに');
  assert.equal(said('cam.section', { section: 'nowhere' }, 'work:cam.shot'), undefined, 'an unknown section is left out');
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

// --- v2.1 (package F): the curve widget's pure helpers (DESIGN_2_1 §6.6) ---------------------------------------------

test('v2.1 curve widget: the choices, what each pins, and the select value of every curve form', () => {
  const CW = MV.use('ui/curve_widget');
  const CV = MV.use('core/curve');
  const E = MV.use('core/ease');
  assert.deepEqual(CW.CHOICES.slice(0, 8), ['auto', 'softEnds', 'hushRushHush', 'holdThenDash', 'dashStop', 'slowBloom',
    'fadeBrake', 'snapSettle'], '自動, then the 7 presets in the §4.1 order');
  assert.deepEqual(CW.CHOICES.slice(-2), ['simple', 'custom'], 'かんたん and カスタム last');
  assert.deepEqual([...CW.PRESET_ORDER].sort(), CV.PRESET_KEYS.slice().sort(), 'every preset is offered');
  for (const e of E.EASES) assert.ok(CW.CHOICES.includes(e), 'the ease ' + e);
  assert.equal(new Set(CW.CHOICES).size, CW.CHOICES.length);
  for (const c of CW.CHOICES) {
    const v = CW.valueForChoice(c, 'linear');
    if (c === 'auto') { assert.equal(v, null, '自動 unpins'); continue; }
    assert.ok(CV.coerce(v) !== undefined, c + ' pins a valid curve');
    assert.equal(CW.choiceOf(v, false), c, c + ' reads back as itself');
  }
  assert.deepEqual(CW.valueForChoice('simple', 'linear'), { ramp: CW.DEFAULT_RAMP }, 'かんたん starts at the default ramp');
  const ramp = { ramp: { edge: 0.2, ends: 'start', peak: 3 } };
  assert.deepEqual(CW.valueForChoice('simple', ramp), CV.coerce(ramp), 'かんたん keeps a ramp it already has');
  assert.deepEqual(CW.valueForChoice('custom', 'softEnds'), { bz: [0.6, 0, 0.4, 1] }, 'a preset turns custom as its data');
  assert.deepEqual(CW.valueForChoice('custom', 'hushRushHush'), CV.expand('hushRushHush'));
  const sp = { sp: [[0, 1], [0.5, 3], [1, 1]] };
  assert.deepEqual(CW.valueForChoice('custom', sp), CV.coerce(sp), 'カスタム keeps a custom curve');
  assert.equal(CW.choiceOf('softEnds', true), 'auto', 'unpinned reads 自動 whatever the planner chose');
  assert.deepEqual(['softEnds', 'quadOut', ramp, sp, { bz: [0.2, 0.1, 0.3, 1] }, 'nope'].map((v) => CW.formOf(v)),
    ['preset', 'ease', 'simple', 'sp', 'bz', 'ease']);
  assert.equal(CW.choiceOf('nope', false), 'linear', 'an unreadable value shows as 一定');
  assert.equal(CW.valueForChoice('bogus', 'linear'), null);
});

test('v2.1 curve widget: presets, eases and ramps turn into custom data; bz ↔ sp keep the end speeds', () => {
  const CW = MV.use('ui/curve_widget');
  const CV = MV.use('core/curve');
  for (const p of CW.PRESET_ORDER) assert.deepEqual(CW.toCustom(p), CV.expand(p), p);
  assert.deepEqual(CW.toCustom('quadOut'), { bz: CW.EASE_BZ.quadOut });
  assert.deepEqual(CW.toCustom({ ramp: CW.DEFAULT_RAMP }), CV.expand(CV.coerce({ ramp: CW.DEFAULT_RAMP })), 'a ramp as its steps');
  for (const e of Object.keys(CW.EASE_BZ)) assert.ok(CV.coerce({ bz: CW.EASE_BZ[e] }), e + ' has a valid stand-in');
  // bz → sp: seven even knots at the Bézier's speeds; sp → bz: handles whose end slopes are the end speeds.
  const sp = CW.toCustom('quadOut', 'sp');
  assert.equal(sp.sp.length, 7);
  assert.ok(Math.abs(sp.sp[0][1] - CV.speedAt({ bz: CW.EASE_BZ.quadOut }, 0)) < 0.01 && sp.sp[6][1] === 0);
  const steps = { sp: [[0, 1], [0.5, 3], [1, 0]] };
  const bz = CW.spToBz(steps.sp);
  assert.deepEqual(bz, { bz: [0.333, 0.19, 0.667, 1] }, 'the start speed 1 / 1.75 (speeds are relative to the mean)');
  assert.ok(Math.abs(CV.speedAt(bz, 0) - CV.speedAt(steps, 0)) < 0.02 && Math.abs(CV.speedAt(bz, 1)) < 0.02);
  assert.deepEqual(CW.toCustom('softEnds', 'sp').sp.length, 7, 'a preset Bézier as steps');
  assert.deepEqual(CW.toCustom('hushRushHush', 'bz').bz.length, 4, 'preset steps as a Bézier');
  assert.deepEqual(CW.bzToSp([0.5, 0, 0.5, 0]).sp.length, 7);
});

test('v2.1 curve widget: handles move within their limits; knots are added and removed; ramps clamp', () => {
  const CW = MV.use('ui/curve_widget');
  const CV = MV.use('core/curve');
  assert.deepEqual(CW.handlesOf('softEnds'), [{ i: 0, kind: 'bz', x: 0.6, y: 0 }, { i: 1, kind: 'bz', x: 0.4, y: 1 }]);
  const hs = CW.handlesOf('hushRushHush');
  assert.equal(hs.length, 6);
  assert.deepEqual(hs.map((x) => x.fixedX), [true, false, false, false, false, true], 'the first and last knot stay in time');
  // Bézier: x 0–1, y −0.5–1.5.
  assert.deepEqual(CW.moveHandle('softEnds', 0, 2, -3), { bz: [1, -0.5, 0.4, 1] });
  assert.deepEqual(CW.moveHandle('softEnds', 1, 0.25, 0.75), { bz: [0.6, 0, 0.25, 0.75] });
  // Speed steps: an interior knot stays between its neighbours; the ends keep their time; speed 0–8.
  const h1 = CW.moveHandle('hushRushHush', 1, 0.9, 20).sp[1];
  assert.deepEqual(h1, [0.22, 8]);
  assert.deepEqual(CW.moveHandle('hushRushHush', 0, 0.5, 0.5).sp[0], [0, 0.5]);
  assert.deepEqual(CW.moveHandle('hushRushHush', 5, 0.5, 1).sp[5], [1, 1]);
  assert.deepEqual(CW.moveHandle('hushRushHush', 9, 0.5, 1), CV.expand('hushRushHush'), 'no such knot');
  // A move the grammar refuses (no area left) keeps the curve.
  const flat = { sp: [[0, 0], [1, 1]] };
  assert.deepEqual(CW.moveHandle(flat, 1, 1, 0), CV.coerce(flat));
  // Arrow keys step by 0.01 (Shift 0.1 is the caller's).
  assert.deepEqual(CW.nudgeHandle('softEnds', 0, 0.01, 0.1), { bz: [0.61, 0.1, 0.4, 1] });
  // Knots: Enter adds one halfway to the next; at most 8; Delete removes interior knots only; two stay.
  const two = { sp: [[0, 1], [1, 1]] };
  let c = CW.addKnot(two, 0);
  assert.deepEqual(c, { sp: [[0, 1], [0.5, 1], [1, 1]] });
  for (let i = 0; i < 10; i++) c = CW.addKnot(c, 0);
  assert.equal(c.sp.length, CV.MAX_KNOTS);
  assert.deepEqual(CW.addKnotAt(two, 0.25, 2), { sp: [[0, 1], [0.25, 2], [1, 1]] });
  assert.deepEqual(CW.addKnotAt(two, 1, 2), CV.coerce(two), 'not at an end');
  assert.deepEqual(CW.removeKnot(c, 0).sp.length, CV.MAX_KNOTS, 'the first knot stays');
  assert.deepEqual(CW.removeKnot(c, c.sp.length - 1).sp.length, CV.MAX_KNOTS, 'the last knot stays');
  assert.deepEqual(CW.removeKnot(c, 3), { sp: c.sp.filter((k, j) => j !== 3) }, 'Delete removes that knot');
  assert.deepEqual(CW.removeKnot(two, 1), CV.coerce(two), 'two knots stay');
  assert.ok(CW.addKnot('softEnds', 0).bz, 'a Bézier has no knots to add');
  // かんたん: edge 0–0.4, peak 0.125–8; any other curve starts from the default ramp.
  assert.deepEqual(CW.rampOf('linear'), CW.DEFAULT_RAMP);
  assert.deepEqual(CW.withRamp('linear', { edge: 0.9, peak: 99 }).ramp, { edge: 0.4, ends: 'both', peak: 8 });
  assert.deepEqual(CW.withRamp({ ramp: { edge: 0.2, ends: 'end', peak: 2 } }, { peak: 0.01 }).ramp, { edge: 0.2, ends: 'end', peak: 0.125 });
});

test('v2.1 curve widget: 位置の動きだけ on time-warp fields; ranges fit overshoots; the canvas maps both ways', () => {
  const CW = MV.use('ui/curve_widget');
  assert.equal(CW.positionOnly('arrive.flow', 'backOut'), true);
  assert.equal(CW.positionOnly('arrive@inkRise.flow', 'snapSettle'), true);
  assert.equal(CW.positionOnly('dwell.curve', { bz: [0.2, 0.9, 0.3, 1.2] }), true);
  assert.equal(CW.positionOnly('seam.curve', 'elasticOut'), true);
  assert.equal(CW.positionOnly('arrive.ease', 'backOut'), false, 'a position curve shows its overshoot');
  assert.equal(CW.positionOnly('arrive.flow', 'softEnds'), false);
  assert.equal(CW.positionOnly('lens.curve', 'backOut'), false);
  const r = CW.rangesOf('backOut');
  assert.ok(r.lo < 0 && r.hi > 1.4, 'the overshoot is inside the plot: ' + JSON.stringify(r));
  assert.deepEqual(CW.rangesOf('linear'), { lo: -0.06, hi: 1.06, smax: 2 });
  assert.ok(CW.rangesOf({ sp: [[0, 0.1], [0.5, 7], [1, 0.1]] }).smax >= 7);
  // Speed steps are drawn in their knot units: the fill runs through the handles.
  const steps = { sp: [[0, 1], [0.1, 1], [0.16, 6], [0.84, 6], [0.9, 1], [1, 1]] };
  const k = CW.speedScale(steps);
  for (const hd of CW.handlesOf(steps)) assert.ok(Math.abs(MV.use('core/curve').speedAt(steps, hd.x) * k - hd.y) < 0.02, JSON.stringify(hd));
  assert.equal(CW.speedScale('softEnds'), 1, 'a Bézier as it is');
  const g = CW.geometry(300, 96, CW.rangesOf('softEnds'));
  for (const u of [0, 0.3, 1]) assert.ok(Math.abs(g.u(g.px(u)) - u) < 1e-9);
  for (const v of [-0.2, 0.7, 1.1]) assert.ok(Math.abs(g.pos(g.posY(v)) - v) < 1e-9);
  for (const s of [0, 1.5]) assert.ok(Math.abs(g.speed(g.speedY(s)) - s) < 1e-9);
  assert.ok(g.posY(1) < g.posY(0), 'up is further along');
});

test('v2.1 curve widget: the select states every choice in words, in ja and en', () => {
  const CW = MV.use('ui/curve_widget');
  const T = MV.use('i18n/t');
  for (const lang of ['ja', 'en']) {
    const t = T.createT(lang, STRINGS, REG, { strict: true });
    const texts = CW.CHOICES.map((c) => CW.choiceText(t, c, 'linear', false));
    assert.equal(new Set(texts).size, texts.length, lang + ': distinct choice texts');
    assert.ok(texts.every((x) => x && !/[a-z]+\.[a-z]+[A-Z.]/.test(x) && !/opt\.|curve\./.test(x)), lang + ': no raw keys: ' + texts.join(' | '));
    assert.equal(CW.choiceText(t, 'sineIn', 'linear', false), t('opt.ease', { family: t('opt.ease.sine'), dir: t('opt.easeDir.In') }));
    assert.equal(CW.choiceText(t, 'auto', 'softEnds', true), t('curve.autoOf', { name: t('curve.softEnds') }), '自動（両端ゆっくり）');
    assert.equal(CW.choiceText(t, 'custom', { sp: [[0, 1], [0.5, 2], [1, 1]] }, false), t('curve.sp', { n: 3 }));
  }
});

// --- v2.1 (package F): the keyframe editor's pure helpers (DESIGN_2_1 §6.7) ------------------------------------------

test('v2.1 keyframes: the rows read and write とき, ねらい, 位置 and 大きさ; keys are added and removed within limits', () => {
  const KE = MV.use('ui/shot_editor');
  const SHOT = MV.use('core/shot');
  const none = KE.shotKeys('none');
  assert.deepEqual(none.keys, SHOT.SHOTS.settle.keys, 'なし starts the editor from 落ち着く');
  const push = KE.shotKeys('pushWord');
  push.keys[0].fill = 0.99;
  assert.notEqual(SHOT.SHOTS.pushWord.keys[0].fill, 0.99, 'a copy');
  // とき.
  assert.deepEqual(KE.whenOf({ at: 'rest' }), { choice: 'rest', n: null });
  assert.deepEqual(KE.whenOf({ at: 'word:2' }), { choice: 'word', n: 3 }, '3語目');
  assert.deepEqual(KE.whenOf({ at: 'word:-1' }), { choice: 'word', n: -1 }, 'the last word');
  assert.deepEqual(KE.whenOf({ at: 0.25 }), { choice: 'frac', n: 25 });
  for (const [c, n] of [['word', 3], ['word', -1], ['beat', 2], ['frac', 25], ['mid', null], ['emph', null]]) {
    assert.deepEqual(KE.whenOf({ at: KE.atFrom(c, n) }), { choice: c, n }, c + ' ' + n);
  }
  assert.equal(KE.atFrom('frac', 250), 1, 'clamped');
  assert.equal(KE.atFrom('word', 99), 'word:40');
  assert.equal(KE.atFrom('beat', null), 'beat:0');
  // ねらい.
  for (const [c, n] of [['word', 2], ['word', -1], ['line', 1], ['glyph', 5], ['block', null], ['frame', null]]) {
    assert.deepEqual(KE.aimOf({ aim: KE.aimFrom(c, n) }), { choice: c, n }, c);
  }
  // 位置: thirds are ±0.167; そのまま has no offsets.
  for (const p of KE.POS) assert.equal(KE.posOf(KE.withPos({ aim: 'block', at: 'a', ox: 0.3, oy: 0.1 }, p)), p === 'free' ? 'free' : p, p);
  assert.deepEqual(KE.withPos({ aim: 'block', at: 'a', ox: 0.3 }, 'keep'), { aim: 'block', at: 'a' });
  assert.deepEqual(KE.withPos({ aim: 'block', at: 'a' }, 'left'), { aim: 'block', at: 'a', ox: -KE.THIRD });
  // 大きさ: fill for text aims, zoom for the frame.
  assert.deepEqual(KE.sizeOf({ aim: 'block' }), { kind: 'fill', v: 0.6, range: SHOT.LIMITS.fill });
  assert.deepEqual(KE.sizeOf({ aim: 'frame', zoom: 1.1 }), { kind: 'zoom', v: 1.1, range: SHOT.LIMITS.zoom });
  // Edits pin a whole, valid Shot; the aim swaps fill and zoom.
  const st = KE.shotKeys('pushWord');
  const framed = KE.editKey(st, 0, { aim: 'frame', zoom: 1.1 });
  assert.equal(SHOT.coerceShot(framed) !== undefined, true);
  assert.equal(framed.keys[0].fill, undefined, 'the frame has no fill');
  assert.equal(KE.editKey(st, 0, { roll: null }).keys[0].roll, undefined, 'null removes');
  let s = { keys: st.keys, follow: 0 };
  for (let i = 0; i < 8; i++) s = KE.shotKeys(KE.addKey(s));
  assert.equal(s.keys.length, SHOT.LIMITS.keys[1], 'at most 6 keys');
  for (let i = 0; i < 8; i++) s = KE.shotKeys(KE.removeKey(s, 0));
  assert.equal(s.keys.length, SHOT.LIMITS.keys[0], 'at least 2 keys');
  assert.ok(KE.addKey({ keys: st.keys, follow: 0.5 }).follow === 0.5, 'follow is kept');
});

test('v2.1 keyframes: times, the timeline diamonds and the preview markers (with the fake engine\'s shotTrack)', () => {
  const KE = MV.use('ui/shot_editor');
  const fake = require('../helpers/fake_engine.js');
  const cut = { key: 'r1~0', a: 10, b: 14, t0: 11, t1: 13 };
  assert.equal(KE.approxTime(cut, { at: 'a' }), 10);
  assert.equal(KE.approxTime(cut, { at: 'b' }), 14);
  assert.equal(KE.approxTime(cut, { at: 0.25 }), 11);
  assert.equal(KE.approxTime(cut, { at: 'sung' }), 11);
  assert.equal(KE.approxTime(cut, { at: 'end' }), 13);
  assert.equal(KE.approxTime(cut, { at: 'mid' }), 12);
  assert.equal(KE.approxTime(cut, { at: 'b', dt: 5 }), 14, 'clamped to the cut');
  assert.equal(KE.approxTime(cut, { at: 'beat:1' }, { beats: { bpm: 60, offset: 0 } }), 12, 'the second beat from the sung start');
  assert.equal(KE.atOfTime(cut, 11), 0.25);
  assert.equal(KE.atOfTime(cut, 20), 1);
  // The track's keys are sorted by time; data keys match them by their estimated order.
  const track = { a: 10, b: 14, keys: [{ t: 10.5, id: 'x' }, { t: 12, id: 'y' }] };
  const keys = [{ at: 'mid' }, { at: 'a' }];
  assert.deepEqual(KE.trackKeys(cut, keys, null, track).map((k) => k.id), ['y', 'x']);
  assert.deepEqual(KE.keyTimes(cut, keys, null, track), [{ i: 0, t: 12 }, { i: 1, t: 10.5 }]);
  assert.equal(KE.trackKeys(cut, keys.concat([{ at: 'b' }]), null, track), null, 'another number of keys');
  assert.deepEqual(KE.keyTimes(cut, keys, null, null), [{ i: 0, t: 12 }, { i: 1, t: 10 }], 'estimates without a track');
  // Markers: where each key puts its aim on screen (the §4.19 view).
  const design = { w: 1920, h: 1080 };
  const aim = { x: 1000, y: 500, w: 200, h: 100 };
  assert.deepEqual(KE.markerAt({ x: 0, y: 0, zoom: 1, roll: 0, aim }, design), { x: 1100, y: 550 });
  assert.deepEqual(KE.markerAt({ x: 140, y: 10, zoom: 2, roll: 0, aim }, design), { x: 960, y: 540 }, 'the camera centres the aim');
  const rolled = KE.markerAt({ x: 0, y: 0, zoom: 1, roll: Math.PI / 2, aim }, design);
  assert.ok(Math.abs(rolled.x - 970) < 1e-6 && Math.abs(rolled.y - 400) < 1e-6, JSON.stringify(rolled));
  assert.deepEqual(KE.offsetOfPoint({ x: 1920, y: 540 }, design), { ox: 0.4, oy: 0 }, 'clamped to ±0.4');
  // The fake engine (package B's facade until it lands) gives a push-in: the markers sit on the cut's text.
  const engine = fake.createEngine({ registry: REG });
  engine.setDoc(corpus.project('basic').doc);
  const c = engine.plan.cuts.find((x) => x.line);
  const tr = engine.shotTrack(c.key);
  assert.equal(tr.keys.length, 2);
  assert.equal(engine.shotTrack('nope'), null);
  const ks = [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'block' }];
  const marks = KE.trackKeys(c, ks, engine.plan, tr).map((k) => KE.markerAt(k, engine.plan.design));
  for (const m of marks) {
    assert.ok(m.x >= tr.keys[0].aim.x && m.x <= tr.keys[0].aim.x + tr.keys[0].aim.w, 'on the text: ' + JSON.stringify(m));
  }
  assert.equal(engine.registry, REG, 'the effective registry');
});

test('v2.1 keyframes: a stage drag is inverted through engine.viewAt, so the text stays under the pointer', () => {
  const KE = MV.use('ui/shot_editor');
  const fake = require('../helpers/fake_engine.js');
  const view = (zoom, roll) => fake.createEngine({ view: { zoom, roll } }).viewAt(0);
  assert.deepEqual(fake.createEngine({}).viewAt(3), { x: 0, y: 0, zoom: 1, roll: 0 });
  assert.deepEqual(KE.screenToWorld(30, -12, view(1, 0)), { dx: 30, dy: -12 }, 'the identity view');
  assert.deepEqual(KE.screenToWorld(30, -12, null), { dx: 30, dy: -12 }, 'no view yet');
  // Forward: a world move d shows on screen as zoom · R(−roll) · d; the inverse brings it back.
  for (const [zoom, roll] of [[2, 0], [1.25, 0.2], [0.9, -0.26], [3, Math.PI / 2]]) {
    const d = { x: 17, y: -9 };
    const r = -roll;
    const s = { x: zoom * (d.x * Math.cos(r) - d.y * Math.sin(r)), y: zoom * (d.x * Math.sin(r) + d.y * Math.cos(r)) };
    const back = KE.screenToWorld(s.x, s.y, view(zoom, roll));
    assert.ok(Math.abs(back.dx - d.x) < 1e-9 && Math.abs(back.dy - d.y) < 1e-9, zoom + ' ' + roll + ' ' + JSON.stringify(back));
  }
});

// --- v2.1 (package F): マイ素材 (DESIGN_2_1 §6.9) ----------------------------------------------------------------------

// MAI-4: the page bakes the knobs into the recipe and keeps them, and core/commands checks a recipe with every knob at its
// maximum, so an AI material fitted to the budget has no room above its fitted amount: the slider ends where the store
// still accepts the value (a larger one would be refused with a toast at every step).
test('v2.1 material knobs go only as far as the store accepts (an AI ornament fitted to the particle budget)', () => {
  const MP = MV.use('ui/material_page');
  const RC = MV.use('core/recipe');
  const RECIPE = MV.use('ai/recipe');
  const CMD = MV.use('core/commands');
  const M = MV.use('core/migrate');
  const cat = MV.use('parts/catalog').defaultRegistry();
  const lay = { prim: 'particles', shape: 'petal', glyph: '', inks: ['accent'], alpha: 0.85, layer: 'near', anchor: 'frame', x: 0, y: 0,
    spread: 1.15, sizeMin: 0.012, sizeMax: 0.022, count: 200, stroke: 0, dir: 115, speed: 0.09, sway: 26, swayHz: 0.35, spin: 60,
    burst: 'none', move: 'none', moveWhat: 'scale', moveAmp: 0, moveHz: 0, appear: 'always', draw: 'fade', style: '', pattern: '', stops: [], angle: 0 };
  const made = RECIPE.fromAi({ name: '花', nameEn: '', kind: 'ornament', scope: 'cut', season: '', tags: [], blurb: '', base: '', params: [],
    parts: [], layers: [lay], unit: 'glyph', order: 'lead', dur: -1, each: -1, tracks: [], curve: { name: '', ends: 'both', edge: -1, peak: -1 },
    osc: [], knobs: ['count'], use: { slot: 'none', s: 0, lines: [], cuts: [] } }, cat);
  assert.ok(made.warnings.some((w) => w[0] === 'ai.warn.matScaled'), 'fitted to the budget');
  let doc = M.parseFile(corpus.projectText('v21')).doc;
  doc = CMD.reduce(doc, { t: 'material.put', id: 'm4', kind: 'ornament', by: 'ai', name: made.entry.name, recipe: made.entry.recipe });
  const e = MP.entryOf(doc, 'm4');
  const spec = RC.knobSpecs('ornament', e.recipe).count;
  const limit = MP.knobLimit('ornament', e.recipe, {}, 'count', spec, doc.media);
  assert.ok(limit >= 1 && limit < spec.max, 'the slider ends before ×' + spec.max + ': ×' + limit);
  const put = (v) => MP.putCmd(e, RC.withKnobs(e.recipe, { count: v }));
  assert.doesNotThrow(() => CMD.reduce(doc, put(limit)), 'the store takes the limit');
  assert.throws(() => CMD.reduce(doc, put(Math.round((limit + spec.step) * 100) / 100)), /particles/, 'one step more is refused');
  // a material with room keeps the whole range; a knob never ends below the value it has
  const m3 = MP.entryOf(doc, 'm3');
  assert.equal(MP.knobLimit('ornament', m3.recipe, {}, 'count', RC.knobSpecs('ornament', m3.recipe).count, doc.media), 1.5);
  assert.equal(MP.knobLimit('ornament', e.recipe, { count: 0.5 }, 'count', spec, doc.media) >= 0.5, true);
});

test('v2.1 materials: ids ↔ keys, uses, places, weight, duplicate and the recipe check', () => {
  const MP = MV.use('ui/material_page');
  const M = MV.use('core/migrate');
  const CMD = MV.use('core/commands');
  const doc = M.parseFile(corpus.projectText('v21')).doc;
  assert.equal(MP.keyOfId('m1'), 'myMat1');
  assert.equal(MP.idOfKey('myMat1a'), 'm1a');
  assert.equal(MP.idOfKey('inkRise'), null);
  assert.equal(MP.entryOf(doc, 'm3').name.ja, '桜吹雪');
  assert.equal(MP.entryOf(doc, 'm9'), null);
  // Uses: the value, part-qualified slots and avoid lists that name it.
  assert.deepEqual(MP.usesOf(doc, 'myMat3'), ['line/rb:atmos', 'line/rb:atmos@myMat3.count']);
  const withAvoid = Object.assign({}, doc, { pins: Object.assign({}, doc.pins, { 'line/r4:avoid': { v: ['arrive.myMat1'], by: 'user' } }) });
  assert.deepEqual(MP.usesOf(withAvoid, 'myMat1'), ['line/r4:avoid', 'line/r7:arrive']);
  assert.deepEqual(MP.usesOf(doc, 'myMat9'), []);
  // Places: the lines of one named area together, else one by one.
  const plan = MV.use('planner/plan').plan(doc, { registry: MV.use('parts/catalog').defaultRegistry() });
  assert.deepEqual(MP.usePlaces(doc, plan, 'myMat1').map((p) => p.sel), [{ level: 'line', ids: ['r7'] }]);
  const both = Object.assign({}, doc, { pins: Object.assign({}, doc.pins, { 'line/r8:arrive': { v: 'myMat1', by: 'user' }, 'work:arrive': { v: 'myMat1', by: 'user' } }) });
  const places = MP.usePlaces(both, plan, 'myMat1');
  assert.equal(places[0].sel.level, 'line');
  assert.deepEqual(places[0].sel.ids, ['r7', 'r8'], 'r7 and r8 are one block');
  assert.ok(places[0].area && places[0].sel.area, 'named as its area');
  assert.deepEqual(places[places.length - 1], { sel: S_WORK(), work: true }, 'the whole video last');
  // Weight: bars 1–5 against the scene budget of the kind (a run ornament: 1.5 ms).
  const w = MP.weightOf(MP.entryOf(doc, 'm3'));
  assert.equal(w.max, 1.5);
  assert.ok(w.bars >= 1 && w.bars <= 5 && ['light', 'normal', 'heavy'].includes(w.word));
  assert.equal(MP.weightOf({ kind: 'ground', recipe: {} }).max, 2.0);
  // 複製: a user copy under the next id that core/commands accepts.
  const dup = MP.duplicateCmd(doc, MP.entryOf(doc, 'm3'));
  assert.equal(dup.id, 'm4');
  assert.equal(dup.by, 'user');
  const after = CMD.reduce(doc, dup);
  assert.equal(after.materials.list.length, 4);
  assert.deepEqual(after.materials.list[3].recipe, MP.entryOf(doc, 'm3').recipe);
  const put = MP.putCmd(MP.entryOf(doc, 'm2'), MP.entryOf(doc, 'm2').recipe);
  assert.equal(CMD.reduce(doc, put).materials.list.length, 3, 'the same id replaces');
  // The recipe textarea: JSON first, then core/recipe (nothing is executed).
  assert.deepEqual(MP.checkRecipe('ornament', '{'), { recipe: null, problems: [], bad: 'json' });
  const empty = MP.checkRecipe('ornament', '{}');
  assert.equal(empty.bad, null);
  assert.ok(empty.problems.length > 0, 'an empty recipe is a problem');
  const ok = MP.checkRecipe('ornament', JSON.stringify(MP.entryOf(doc, 'm3').recipe));
  assert.deepEqual(ok.problems, []);
  // With parts/mix.derive (package C): a variant of a part that does not exist names it; texts for every code.
  const T = MV.use('i18n/t');
  const cat = MV.use('parts/catalog').defaultRegistry();
  const app = { reg: cat, doc };
  const m1 = MP.entryOf(doc, 'm1');
  const bad = MP.checkRecipe('arrive', JSON.stringify(Object.assign({}, m1.recipe, { base: 'nope' })),
    (recipe) => MV.use('parts/mix').derive(Object.assign({}, m1, { recipe }), cat, { list: doc.materials.list }).problems);
  assert.ok(bad.problems.length > 0, JSON.stringify(bad.problems));
  assert.equal(MP.usable(app, m1, bad.recipe), false, 'a recipe without its base makes no part');
  assert.equal(MP.usable(app, m1, m1.recipe), true);
  for (const lang of ['ja', 'en']) {
    const t = T.createT(lang, STRINGS, cat, { strict: true });
    for (const p of bad.problems) assert.ok(!/mat\.why/.test(MP.problemText(t, p)), MP.problemText(t, p));
    const codes = ['no-base', 'flash-base', 'part-missing', 'part-flash', 'part-scope', 'part-frames', 'part-param', 'part-mirror',
      'param', 'mirror-missing', 'kit', 'def', 'media-key'];
    for (const code of codes) assert.ok(t.has('mat.why.' + code), 'NOTES v2.1-C strings wanted: mat.why.' + code);
    assert.equal(MP.problemText(t, { path: 'x', code: 'weird', params: {} }), t('mat.problem', { path: 'x', what: 'weird' }));
    assert.equal(MP.problemText(t, { path: 'parts[0]', code: 'part-missing', params: { key: 'nope' } }),
      t('mat.problem', { path: 'parts[0]', what: t('mat.why.part-missing', { key: 'nope' }) }), 'a code in words, with its params');
  }
});

function S_WORK() { return MV.use('ui/selection').WORK; }

test('v2.1 part browser マイ素材: materials of the kind, never the grounds derived from pooled photos (NOTES v2.1-C)', () => {
  const PB = MV.use('ui/part_browser');
  const defs = { myMat1: { scope: 'cut' }, myMat2: { scope: 'run' }, myMed0a1b2c3d4e: {}, inkRise: {} };
  const reg = {
    keys: () => Object.keys(defs), get: (kind, key) => defs[key], mine: () => ['myMat1', 'myMat2', 'myMed0a1b2c3d4e'],
    extra: { myMat1: { media: ['a1'] }, myMat2: { media: [] }, myMed0a1b2c3d4e: { media: true } },
  };
  assert.deepEqual(PB.mineFor(reg, 'ground', {}), ['myMat1', 'myMat2'], 'a material that uses a photo stays; a pooled photo goes');
  assert.deepEqual(PB.mineFor(reg, 'ornament', { run: true }), ['myMat2'], 'the atmosphere row: run ornaments only');
  assert.deepEqual(PB.mineFor({ keys: () => [], get: () => null }, 'ground', {}), [], 'a registry without materials');
});

test('an enum with optKey labels its options from its own key group (depth: back is 後ろに下げる, not 逆方向)', () => {
  const reg = catalogRegistry();
  const field = F.paramFields('ground', undefined, 'photoPan', reg).find((f) => f.param.name === 'depth');
  assert.deepEqual(field.options.map((o) => o.label), ['opt.depth.auto', 'opt.depth.anim', 'opt.depth.front', 'opt.depth.back', 'opt.depth.still']);
  const t = T.createT('ja', STRINGS);
  const W = MV.use('ui/widgets');
  assert.equal(W.optionText(t, field.options.find((o) => o.v === 'back')), '後ろに下げる');
});
