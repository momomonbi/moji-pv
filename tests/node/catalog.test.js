/* 文字PVメーカー v2 — original work. Tests: the catalog file, themes and moods against DESIGN §4.6, §4.18, §5.10, §5.11 (§8.2 registry and conformance rows). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const REG = MV.use('core/registry');
const C = MV.use('core/color');
const D = MV.use('core/doc');
const SCH = MV.use('core/schema');
const FACES = MV.use('engine/text/faces');

// The catalog file may be held back until every part kind has parts (a strict defaultRegistry() throws before that,
// DESIGN §4.6), so the look data below is gathered and tested without it.
const CAT = MV.has('parts/catalog') ? MV.use('parts/catalog') : null;
const NO_CATALOG = CAT ? false : 'parts/catalog.js is not in this tree yet';

const LOOK_KINDS = Object.freeze(['theme', 'mood']);
const PART_MODULE = /^parts\/([a-z]+)\//;

// The part modules of the kind directories (not parts/kit, not parts/catalog), in module id order.
function partModules() {
  return MV.ids('parts/').filter((id) => PART_MODULE.test(id) && REG.KINDS.includes(PART_MODULE.exec(id)[1]));
}
function allDefs() { return partModules().flatMap((id) => MV.use(id)); }

// --- DESIGN §5 as data: the tables are the single source the catalog is checked against ----------------------------

const DESIGN = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'DESIGN.md'), 'utf8');

// { kind: section text } for §5.1–§5.11, keyed by the parts/<kind>/ directory named in each heading.
function catalogSections() {
  const text = DESIGN.slice(DESIGN.indexOf('\n## 5. '), DESIGN.indexOf('\n## 6. '));
  const out = {};
  for (const chunk of text.split('\n### ').slice(1)) {
    const m = /\(`parts\/(\w+)\//.exec(chunk.split('\n')[0]);
    if (m) out[m[1]] = chunk;
  }
  return out;
}

function cells(line) { return line.split('|').slice(1, -1).map((s) => s.trim()); }

// Table rows as { <header>: cell, key }.
function tableOf(chunk) {
  const lines = chunk.split('\n').filter((l) => l.startsWith('|'));
  const head = cells(lines[0]);
  return lines.filter((l) => l.startsWith('| `')).map((l) => {
    const row = { key: /`(\w+)`/.exec(l)[1] };
    cells(l).forEach((c, i) => { row[head[i]] = c; });
    return row;
  });
}

function prose(chunk) { return chunk.replace(/\s*\n\s*/g, ' '); }
function num(s) { return Number(s.trim()); }
function labelOf(cell) { const [ja, en] = cell.split(' / '); return { ja, en }; }
function pairs(cell, sep) {
  return Object.fromEntries(cell.split(sep).map((s) => s.trim()).filter(Boolean).map((s) => {
    const [k, v] = s.split(/\s+/);
    return [k, num(v)];
  }));
}

const SECTIONS = catalogSections();
const DESIGN_KEYS = Object.fromEntries(Object.keys(SECTIONS).map((kind) => [kind, tableOf(SECTIONS[kind]).map((r) => r.key)]));
const SEASON_OF = {};
for (const kind of ['ground', 'ornament']) {
  SEASON_OF[kind] = Object.fromEntries(tableOf(SECTIONS[kind]).map((r) => [r.key, r.Season || null]));
}
const TEXTURE_FILTERS = (/marked `texture: true`: (.+?)\.(\s|$)/.exec(prose(SECTIONS.filter))[1].match(/`(\w+)`/g) || [])
  .map((s) => s.slice(1, -1));

function designThemes() {
  const chunk = SECTIONS.theme;
  const faceOf = (cell) => {
    const m = /^(.+?) · (.+?) \((\d+), (\w+)\)$/.exec(cell);
    return { ja: m[1], latin: m[2], weight: Number(m[3]), flavor: m[4] };
  };
  const styles = /`style` defaults: `(\w+)` for all except (.+?)\. `dark`/.exec(prose(chunk));
  const exceptions = Object.fromEntries([...styles[2].matchAll(/`(\w+)` \(`(\w+)`\)/g)].map((m) => [m[1], m[2]]));
  return tableOf(chunk).map((r) => {
    const colors = r.Colors.split(/\s+/);
    return {
      key: r.key, label: labelOf(r['ja / en']),
      swatch: Object.fromEntries(C.TOKENS.map((t, i) => [t, colors[i]])),
      faces: { display: faceOf(r.display), serif: faceOf(r.serif), body: faceOf(r.body) },
      texture: r.Texture, season: r.Season || null, style: exceptions[r.key] || styles[1],
    };
  });
}

function designMoods() {
  const chunk = SECTIONS.mood;
  const order = /Amount order: ([^.]+)\./.exec(chunk)[1].split(' / ').map((s) => s.trim());
  const kw = /Keywords \(for `song\.info` matching\) — (.+?)\n\n/s.exec(chunk)[1].replace(/\s*\n\s*/g, ' ').replace(/\.$/, '');
  const keywords = Object.fromEntries(kw.split(';').map((s) => {
    const [key, words] = s.trim().split(/:\s*/);
    return [key, words.split(/\s+/)];
  }));
  return {
    order,
    moods: tableOf(chunk).map((r) => {
      const amounts = r.Amounts.split('/').map(num);
      const [favour, damp] = r['Strong tag bias (×)'].split('·').map((s) => pairs(s.trim().replace(/(\d)\s+(?=[a-z])/g, '$1,'), ','));
      const [seam, focus] = r['pace seam / focus'].split('/').map(num);
      return {
        key: r.key, label: labelOf(r['ja / en']),
        amounts: Object.fromEntries(order.map((k, i) => [k, amounts[i]])),
        favour, damp, themes: pairs(r['Themes (weight)'], ','), pace: { seam, focus },
        filters: pairs(r['Filter weights'], ','), variety: num(r.variety), keywords: keywords[r.key],
      };
    }),
  };
}

// --- registries under test ------------------------------------------------------------------------------------------

const LOOK_DEFS = allDefs().filter((d) => LOOK_KINDS.includes(d.kind));

// Themes and moods of the catalog plus the stub parts of every other kind: validates on its own, whatever the other
// part packages have delivered so far.
function lookRegistry() {
  const others = corpus.allStubParts().filter((d) => !LOOK_KINDS.includes(d.kind));
  return REG.createRegistry(others.concat(LOOK_DEFS));
}
const LOOK_REG = lookRegistry();

function defsOf(kind) { return LOOK_DEFS.filter((d) => d.kind === kind); }
function missingKinds() { return REG.KINDS.filter((k) => !allDefs().some((d) => d.kind === k)); }

// --- the catalog file ------------------------------------------------------------------------------------------------

// §4.18.7: parts depend only on the kit, so a K.mirror exit lives in its entrance's file (parts/arrive/soft.js returns
// inkSink next to inkRise). Which exits may do so is parts_motion.test.js's precise rule; here an arrive module may
// also return departs, and every other directory holds its own kind only.
const ALSO_IN = Object.freeze({ arrive: ['depart'] });

test('part modules under parts/<kind>/ each return an array of frozen definitions of that kind (arrive: plus mirrored exits)', () => {
  for (const id of partModules()) {
    const kind = PART_MODULE.exec(id)[1];
    const list = MV.use(id);
    assert.ok(Array.isArray(list) && list.length > 0, id + ' returns a non-empty array of definitions');
    assert.ok(list.some((def) => def.kind === kind), id + ' holds at least one ' + kind);
    for (const def of list) {
      const allowed = [kind].concat(ALSO_IN[kind] || []);
      assert.ok(allowed.includes(def.kind), id + ': ' + def.key + ' is a ' + def.kind + ' in the ' + kind + ' directory');
      assert.ok(Object.isFrozen(def), id + ': ' + def.key + ' is frozen by the kit');
    }
  }
  assert.ok(MV.ids('parts/theme/').length >= 1 && MV.ids('parts/mood/').length >= 1);
});

test('catalog.defs() is every definition of those modules, in module id order', { skip: NO_CATALOG }, () => {
  const want = allDefs();
  const got = CAT.defs();
  assert.equal(got.length, want.length);
  got.forEach((def, i) => assert.equal(def, want[i], 'definition ' + i + ' (' + def.kind + '/' + def.key + ')'));
  assert.ok(!got.some((d) => !REG.KINDS.includes(d.kind)), 'parts/kit and parts/catalog are not part modules');
});

// The catalog file may wait for the other WP5 packages, but it must land with them: this fails once every part kind
// has parts while parts/catalog.js is still missing.
test('parts/catalog is in the tree once every part kind has parts', (t) => {
  const missing = missingKinds();
  if (!CAT && missing.length) {
    t.skip('no parts yet for ' + missing.join(', ') + '; parts/catalog.js lands with them');
    return;
  }
  assert.ok(CAT, 'every part kind has parts: add parts/catalog.js (the frozen code of DESIGN §4.6)');
});

// While another package has not delivered a kind (or its fallback) yet, only the fallback count may be reported.
const FALLBACK_COUNT = /^[a-z]+\/\*: exactly one definition needs fallback: true \(found 0\)$/;

test('the whole catalog validates in strict mode and holds every §5 key (once every kind has parts)', { skip: NO_CATALOG }, (t) => {
  const missing = missingKinds();
  if (missing.length) {
    const partial = CAT.defaultRegistry({ strict: false });
    assert.deepEqual(partial.problems.filter((p) => !FALLBACK_COUNT.test(p)), [], 'the delivered definitions are valid');
    assert.throws(() => CAT.defaultRegistry(), (e) => e.name === 'RegistryError', 'defaultRegistry() is strict');
    t.skip('no parts yet for ' + missing.join(', ') + ' (other WP5 packages); strict defaultRegistry() waits for them');
    return;
  }
  const reg = CAT.defaultRegistry();
  for (const kind of REG.KINDS) {
    const absent = DESIGN_KEYS[kind].filter((key) => !reg.has(kind, key));
    assert.deepEqual(absent, [], kind + ': §5 keys missing from the catalog');
  }
});

test('counts meet SPEC §6 and DESIGN §5: 16 themes and 8 moods', () => {
  assert.equal(defsOf('theme').length, 16);
  assert.equal(defsOf('mood').length, 8);
  assert.ok(defsOf('theme').length >= 12 && defsOf('mood').length >= 6, 'SPEC §6 minimums');
  assert.deepEqual(LOOK_REG.keys('theme'), DESIGN_KEYS.theme.slice().sort());
  assert.deepEqual(LOOK_REG.keys('mood'), DESIGN_KEYS.mood.slice().sort());
});

test('themes and moods pass strict registry validation; the fallbacks are sumiWashi and quietHush', () => {
  assert.equal(LOOK_REG.fallback('theme'), 'sumiWashi');
  assert.equal(LOOK_REG.fallback('mood'), 'quietHush');
  assert.deepEqual(LOOK_DEFS.filter((d) => d.fallback).map((d) => d.kind + '/' + d.key).sort(), ['mood/quietHush', 'theme/sumiWashi']);
  assert.deepEqual(LOOK_REG.problems, []);
});

test('labels and blurbs exist in ja and en; en text has no Japanese', () => {
  const JAPANESE = /[぀-ヿ㐀-鿿]/;
  for (const def of LOOK_DEFS) {
    const where = def.kind + '/' + def.key;
    for (const field of ['label', 'blurb']) {
      assert.ok(def[field] && def[field].ja.trim() && def[field].en.trim(), where + ' ' + field);
      assert.ok(!JAPANESE.test(def[field].en), where + ' ' + field + '.en');
    }
  }
});

test('each blurb is one sentence in each language (§4.18.1)', () => {
  for (const def of LOOK_DEFS) {
    const where = def.kind + '/' + def.key + ' blurb';
    const ja = def.blurb.ja.trim(), en = def.blurb.en.trim();
    assert.ok(!/[。！？]/.test(ja.slice(0, -1)), where + '.ja is one sentence: ' + ja);
    assert.ok(!/[.!?]\s/.test(en), where + '.en is one sentence: ' + en);
  }
});

// --- themes (§5.10) --------------------------------------------------------------------------------------------------

test('themes follow the §5.10 table: labels, colors, faces, texture, season and style', () => {
  for (const want of designThemes()) {
    const def = LOOK_REG.get('theme', want.key);
    assert.ok(def, want.key + ' is registered');
    assert.deepEqual(def.label, want.label, want.key + ' label');
    assert.deepEqual(def.swatch, want.swatch, want.key + ' swatch');
    assert.deepEqual(def.faces, want.faces, want.key + ' faces');
    assert.equal(def.texture, want.texture, want.key + ' texture');
    assert.equal(def.season, want.season, want.key + ' season');
    assert.equal(def.style, want.style, want.key + ' style');
  }
});

test('theme.dark is true exactly when the ground luminance is below 0.2 (§5.10)', () => {
  for (const def of defsOf('theme')) {
    assert.equal(def.dark, C.luminance(def.swatch.ground) < 0.2, def.key + ' dark');
  }
});

test('theme faces are Google Fonts families of the font table, for their script, with served weights', () => {
  for (const def of defsOf('theme')) {
    for (const role of ['display', 'serif', 'body']) {
      const f = def.faces[role];
      const where = def.key + ' ' + role;
      assert.equal((FACES.FAMILIES[f.ja] || {}).script, 'ja', where + ': ' + f.ja + ' is a Japanese family of the font table');
      assert.equal((FACES.FAMILIES[f.latin] || {}).script, 'latin', where + ': ' + f.latin + ' is a Latin family');
      assert.ok(FACES.FLAVOR_NAMES.includes(f.flavor), where + ': flavor ' + f.flavor);
      assert.ok(Number.isInteger(f.weight) && f.weight % 100 === 0 && f.weight >= 100 && f.weight <= 900, where + ' weight');
    }
    const faces = FACES.resolveFaces(def, null);
    for (const role of ['display', 'serif', 'body']) {
      assert.equal(faces[role].ja.family, def.faces[role].ja);
      assert.equal(faces[role].latin.family, def.faces[role].latin);
      for (const script of ['ko', 'zhHant', 'zhHans']) {
        assert.equal(faces[role][script].family, FACES.FLAVORS[def.faces[role].flavor][script].family, def.key + ' ' + role + ' ' + script);
      }
      for (const ref of Object.values(faces[role])) {
        assert.ok(FACES.FAMILIES[ref.family].weights.includes(ref.weight), def.key + ' ' + role + ': ' + ref.family + ' serves ' + ref.weight);
      }
    }
  }
});

test('theme textures are §5.8 texture filters or none; registered ones carry texture: true', () => {
  assert.deepEqual(TEXTURE_FILTERS.slice().sort(), ['dotScreen', 'dustSpecks', 'grainFilm', 'paperTooth', 'rasterLines']);
  const full = allDefs();
  for (const def of defsOf('theme')) {
    assert.ok(def.texture === 'none' || TEXTURE_FILTERS.includes(def.texture), def.key + ': texture ' + def.texture);
    const filter = full.find((d) => d.kind === 'filter' && d.key === def.texture);
    if (filter) assert.equal(filter.texture, true, def.key + ': ' + def.texture + ' is a texture filter');
  }
});

// The work texture pass already draws the theme's texture over the whole video (§3.4.1, §4.16.3); favouring the same
// filter for filter#i would draw it a second time on those cuts.
test('a theme never favours its own texture as a screen effect', () => {
  for (const def of defsOf('theme')) {
    const filters = (def.prefer && def.prefer.filter) || {};
    assert.ok(!Object.hasOwn(filters, def.texture), def.key + ': prefer.filter.' + def.texture + ' repeats its texture');
  }
});

// A seasonal part may be favoured only by the theme of its season; only a theme of another season may damp one
// (factor < 1: a seasonal theme keeps the other seasons' motifs out, QA-LOOK).
test('theme.prefer names §5 parts with factors in (0, 3]; seasonal parts favoured only by their season, damped only by another', () => {
  const full = allDefs();
  for (const def of defsOf('theme')) {
    assert.ok(def.prefer && Object.keys(def.prefer).length > 0, def.key + ' has preferences');
    for (const kind of Object.keys(def.prefer)) {
      assert.ok(REG.PART_KINDS.includes(kind), def.key + ': prefer.' + kind);
      const delivered = full.some((d) => d.kind === kind);
      for (const [key, w] of Object.entries(def.prefer[kind])) {
        const where = def.key + ': prefer.' + kind + '.' + key;
        assert.ok(DESIGN_KEYS[kind].includes(key), where + ' is a §5 key');
        if (delivered) assert.ok(full.some((d) => d.kind === kind && d.key === key), where + ' is in the catalog');
        assert.ok(w > 0 && w <= 3, where + ' factor ' + w);
        const season = SEASON_OF[kind] ? SEASON_OF[kind][key] : null;
        if (season && w >= 1) assert.equal(def.season, season, where + ' favours a ' + season + ' part');
        if (season && w < 1) assert.ok(def.season && def.season !== season, where + ' damps a ' + season + ' part');
      }
    }
  }
});

// Season 'any' (no season words in the lyrics) lets every season's motifs in at ×0.5, so a seasonal theme showed the
// other seasons' motifs about as often as its own (sakuraFog on the sample lyrics: maple leaves, fireworks and snow in
// 3.9 % of its ground/ornament picks, spring motifs in 2.3 %). A seasonal theme damps them (QA-LOOK).
test('a seasonal theme damps every season motif of the other seasons (§5.5, §5.6 tables) and none of its own', () => {
  const motifs = ['ground', 'ornament'].flatMap((kind) => Object.entries(SEASON_OF[kind])
    .filter(([, season]) => season).map(([key, season]) => ({ kind, key, season })));
  assert.ok(motifs.length >= 9, 'the §5 tables name the season motifs');
  for (const def of defsOf('theme').filter((d) => d.season)) {
    for (const m of motifs) {
      const w = ((def.prefer || {})[m.kind] || {})[m.key];
      const where = def.key + ' (' + def.season + '): ' + m.kind + '/' + m.key + ' (' + m.season + ')';
      if (m.season === def.season) assert.ok(w === undefined || w >= 1, where + ' is not damped');
      else assert.ok(typeof w === 'number' && w <= 0.01, where + ' is damped to ≤ 0.01 (is ' + w + ')');
    }
  }
});

// --- moods (§5.11) ---------------------------------------------------------------------------------------------------

test('moods follow the §5.11 table: amounts, strong tag biases, themes, pace, filters, variety, keywords', () => {
  const { order, moods } = designMoods();
  assert.deepEqual(order, SCH.AMOUNT_KEYS.slice(), 'the table lists the amount keys in schema order');
  for (const want of moods) {
    const def = LOOK_REG.get('mood', want.key);
    assert.ok(def, want.key + ' is registered');
    assert.deepEqual(def.label, want.label, want.key + ' label');
    assert.deepEqual(def.amounts, want.amounts, want.key + ' amounts');
    for (const [tag, v] of Object.entries(Object.assign({}, want.favour, want.damp))) {
      assert.equal(def.tagBias[tag], v, want.key + ' tagBias.' + tag);
    }
    assert.deepEqual(def.themes, want.themes, want.key + ' themes');
    assert.deepEqual(def.pace, want.pace, want.key + ' pace');
    assert.deepEqual(def.filters, want.filters, want.key + ' filters');
    assert.equal(def.variety, want.variety, want.key + ' variety');
    assert.deepEqual(def.keywords, want.keywords, want.key + ' keywords');
  }
});

test('the quietHush tag biases are the §4.18.14 example', () => {
  const block = /MV\.def\('parts\/mood\/calm'[\s\S]+?tagBias: (\{[\s\S]+?\}),\n\s+amounts/.exec(DESIGN)[1];
  const example = Object.fromEntries([...block.matchAll(/(\w+): ([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
  assert.deepEqual(LOOK_REG.get('mood', 'quietHush').tagBias, example);
});

test('the other tag biases never outweigh the strong ones of §5.11, and stay in the vocabulary', () => {
  for (const want of designMoods().moods) {
    const bias = LOOK_REG.get('mood', want.key).tagBias;
    const hi = Math.min(...Object.values(want.favour));
    const lo = Math.max(...Object.values(want.damp));
    for (const [tag, v] of Object.entries(bias)) {
      assert.ok(SCH.TAGS.includes(tag), want.key + ': tag ' + tag);
      if (tag in want.favour || tag in want.damp) continue;
      assert.ok(v >= lo && v <= hi, want.key + ': tagBias.' + tag + ' = ' + v + ' lies within ' + lo + '..' + hi);
    }
  }
});

// Parts that looked out of place in a mood's whole-app renders (QA-LOOK: おまかせ on the sample lyrics, all moods and
// aspects): the mood's tag bias (the chooser's geometric mean, §4.16.4) must lean away from them. Before the milder
// biases were tuned, popFizz gave cornerNote 0.94 (tiny corner captions in a fizzy video), heartAche gave sunBurst 1.0
// (rays behind a sad line), printColumn gave skyGrade 0.95, dreamHaze gave gridMosaic and tapeStrip 1.0. quietHush gave
// sunBurst 1.0 (rays behind the words in all three quietHush looks; final fixes: bold 0.6, bright 0.8).
const OFF_PICTURE = Object.freeze({
  quietHush: [['ornament', 'sunBurst']],
  popFizz: [['arrange', 'cornerNote'], ['arrange', 'sidebarIndex'], ['arrange', 'diptychSplit']],
  heartAche: [['ornament', 'sunBurst'], ['arrange', 'edgeBleed']],
  glitchFracture: [['arrange', 'hangingTags'], ['arrange', 'haloRing']],
  printColumn: [['ornament', 'bokehDots'], ['ground', 'skyGrade']],
  dreamHaze: [['arrange', 'gridMosaic'], ['ornament', 'tapeStrip']],
});

test('each mood leans away from the parts that looked out of place in its renders (tag bias ≤ 0.9)', { skip: NO_CATALOG }, () => {
  const reg = CAT.defaultRegistry();
  for (const [moodKey, parts] of Object.entries(OFF_PICTURE)) {
    const bias = LOOK_REG.get('mood', moodKey).tagBias;
    for (const [kind, key] of parts) {
      const tags = reg.get(kind, key).tags;
      const b = Math.exp(tags.reduce((s, t) => s + Math.log(bias[t] === undefined ? 1 : bias[t]), 0) / tags.length);
      assert.ok(b <= 0.9, moodKey + ' × ' + kind + '/' + key + ' (' + tags.join(', ') + '): bias ' + b.toFixed(2));
    }
  }
});

test('mood filter weights name §5.8 screen effects (and catalog filters once delivered); moods differ in amounts', () => {
  const full = allDefs();
  const delivered = full.some((d) => d.kind === 'filter');
  const seen = new Set();
  for (const def of defsOf('mood')) {
    for (const [key, w] of Object.entries(def.filters)) {
      assert.ok(DESIGN_KEYS.filter.includes(key), def.key + ': filter ' + key + ' is a §5.8 key');
      if (delivered) assert.ok(full.some((d) => d.kind === 'filter' && d.key === key), def.key + ': filter ' + key + ' is in the catalog');
      assert.ok(w > 0 && w <= 1, def.key + ': filter weight ' + w);
    }
    const sig = JSON.stringify(def.amounts);
    assert.ok(!seen.has(sig), def.key + ' has amounts of its own');
    seen.add(sig);
  }
});

// --- the look data drives the planner (§4.16.3, §3.8) ----------------------------------------------------------------

const PL = MV.use('planner/plan');
const LK = MV.use('planner/look');
const CMD = MV.use('core/commands');

function tinyDoc(pins) {
  const doc = D.defaultDoc();
  doc.sheet = { next: 3, rows: [{ id: 'r1', src: '夜明けの街を走る' }, { id: 'r2', src: '君の名前を呼ぶ声が' }] };
  doc.pins = pins || {};
  return doc;
}

function autoThemes(pins, seeds) {
  const count = {};
  const base = tinyDoc(pins);
  for (let s = 1; s <= seeds; s++) {
    const doc = Object.assign({}, base, { look: Object.assign({}, base.look, { moodSeed: s * 7919 }) });
    const key = PL.plan(doc, { registry: LOOK_REG }).look.theme.v;
    count[key] = (count[key] || 0) + 1;
  }
  return count;
}

test('every mood is an auto pick for some mood seed', () => {
  const doc = tinyDoc();
  const seen = new Set();
  for (let s = 1; s <= 400; s++) seen.add(LK.previewMood(doc, s, { registry: LOOK_REG }));
  assert.deepEqual([...seen].sort(), LOOK_REG.keys('mood'));
});

test('each mood favours its listed themes, and every theme is an auto pick under some mood', () => {
  const seen = new Set();
  const total = LOOK_REG.keys('theme').length;
  for (const def of defsOf('mood')) {
    const count = autoThemes({ 'work:mood': { v: def.key, by: 'user' } }, 150);
    Object.keys(count).forEach((k) => seen.add(k));
    const listed = Object.keys(def.themes).reduce((n, k) => n + (count[k] || 0), 0);
    const baseline = Object.keys(def.themes).length / total;
    assert.ok(listed / 150 > 1.3 * baseline, def.key + ': listed themes picked ' + listed + '/150 (uniform share ' + baseline.toFixed(2) + ')');
  }
  assert.deepEqual([...seen].sort(), LOOK_REG.keys('theme'));
});

test('the season gate keeps other seasons’ themes out (§3.8)', () => {
  const seasonal = defsOf('theme').filter((d) => d.season);
  assert.deepEqual(seasonal.map((d) => d.season).sort(), ['autumn', 'spring', 'summer', 'winter']);
  for (const season of ['winter', 'spring', 'none']) {
    const count = autoThemes({ 'work:season': { v: season, by: 'user' } }, 200);
    for (const key of Object.keys(count)) {
      const def = LOOK_REG.get('theme', key);
      assert.ok(!def.season || def.season === season, season + ': ' + key + ' (' + def.season + ') was picked');
    }
    if (season !== 'none') {
      const own = seasonal.find((d) => d.season === season).key;
      assert.ok(count[own] > 0, season + ': ' + own + ' is picked');
    }
  }
});

// The sample lyrics name no season (白い息 is one hit, §4.16.3), so the season is 'any': every video of a seasonal theme
// should still show its own season and (almost) never another one (QA-LOOK; before: 3.7–4.5 % of the ground and
// ornament picks of these videos were other seasons' motifs, and 22–24 of the 24 videos of each theme showed one).
test('under season any a seasonal theme shows its own season’s motifs and almost never another season’s (sample lyrics)', { skip: NO_CATALOG }, () => {
  const reg = CAT.defaultRegistry();
  const lyrics = CMD.reduce(D.defaultDoc(), { t: 'lyrics.set', text: corpus.sampleLyrics() });
  const aspects = ['16:9', '9:16', '1:1'];
  for (const theme of defsOf('theme').filter((d) => d.season)) {
    let picks = 0, other = 0, withOwn = 0, videos = 0;
    for (const mood of reg.keys('mood')) {
      for (let i = 0; i < 3; i++) {
        const doc = Object.assign({}, lyrics, {
          look: Object.assign({}, lyrics.look, { aspect: aspects[i], seed: (i * 7919 + 13) >>> 0, moodSeed: (i * 104729 + 7) >>> 0 }),
          pins: { 'work:theme': { v: theme.key, by: 'user' }, 'work:mood': { v: mood, by: 'user' } } });
        const plan = PL.plan(doc, { registry: reg });
        assert.equal(plan.look.season.v, 'any', 'the sample lyrics name no season');
        const seen = plan.grounds.flatMap((g) => [['ground', g.ground.v], ['ornament', g.atmos.v]])
          .concat(plan.cuts.flatMap((c) => Object.keys(c.slots).filter((s) => s.startsWith('ornament#'))
            .map((s) => ['ornament', c.slots[s].v])));
        let own = false;
        for (const [kind, key] of seen) {
          if (key === 'none') continue;
          picks++;
          const season = reg.get(kind, key).season;
          if (season === theme.season) own = true;
          else if (season) other++;
        }
        videos++;
        if (own) withOwn++;
      }
    }
    assert.ok(other <= 0.002 * picks, theme.key + ': ' + other + ' other-season motifs in ' + picks + ' ground/ornament picks');
    assert.ok(withOwn >= 0.7 * videos, theme.key + ': its own season shows in ' + withOwn + ' of ' + videos + ' videos');
  }
});

// --- final fixes (look): each mood looks like its name ----------------------------------------------------------------

// A mood's theme list is its picture. With unlisted themes at 0.4 (§4.16.3) the 11–12 unlisted themes together weighed
// as much as the listed ones: a mood showed one of its own themes in only 44–67 % of looks (quietHush on cicadaNoon,
// popFizz on snowLantern); at 0.15 it is 72–100 %. chalkBoard was listed by no mood, so it got a home first.
test('a mood shows one of its own listed themes in most looks, and every theme is listed by some mood', () => {
  for (const def of defsOf('mood')) {
    const count = autoThemes({ 'work:mood': { v: def.key, by: 'user' } }, 150);
    const listed = Object.keys(def.themes).reduce((n, k) => n + (count[k] || 0), 0);
    assert.ok(listed / 150 >= 0.65, def.key + ': a listed theme in ' + listed + ' of 150 looks');
  }
  for (const theme of defsOf('theme')) {
    assert.ok(defsOf('mood').some((m) => m.themes[theme.key] > 0), theme.key + ' is listed by some mood');
  }
});

// Plans of the sample lyrics (season any) under one mood: 3 aspects × `seeds`, catalog registry. Per lyric cut:
// the parts chosen (kind, key), the screen effects and the work texture.
function moodSample(reg, mood, seeds, extra) {
  const lyrics = CMD.reduce(D.defaultDoc(), { t: 'lyrics.set', text: corpus.sampleLyrics() });
  const out = { cuts: 0, picks: [], filters: [], texture: [], plans: [] };
  for (let s = 1; s <= seeds; s++) {
    for (const aspect of ['16:9', '9:16', '1:1']) {
      const doc = Object.assign({}, lyrics, {
        look: Object.assign({}, lyrics.look, { aspect, seed: s * 101 + aspect.length, moodSeed: s * 7919 + aspect.length }, extra || {}),
        pins: { 'work:mood': { v: mood, by: 'user' } } });
      const plan = PL.plan(doc, { registry: reg });
      out.plans.push(plan);
      const tex = plan.look.texture ? plan.look.texture.v : null;
      for (const c of plan.cuts) {
        if (c.role !== 'lyric' && c.role !== 'focus') continue;
        out.cuts++;
        for (const slot of Object.keys(c.slots)) {
          const kind = slot.split(/[#.]/)[0];
          if (slot.includes('.') || slot === 'orient' || !reg.has(kind, c.slots[slot].v)) continue;
          out.picks.push([kind, c.slots[slot].v]);
          if (kind === 'filter') { out.filters.push(c.slots[slot].v); out.texture.push([c.slots[slot].v, tex]); }
        }
      }
    }
  }
  return out;
}

// §4.16.4 moodBias^1.5: averaged over a part's tags and under the noise and recency, the plain mean left moods picking
// alike (quietHush took fast-tagged parts in 6 % of picks, dashSprint in 13 %; now about 4 % and 15 %).
test('mood biases bite: a hushed mood takes fast parts far less often than a sprinting one (sample lyrics)', { skip: NO_CATALOG }, () => {
  const reg = CAT.defaultRegistry();
  const fastShare = (mood) => {
    const { picks } = moodSample(reg, mood, 4);
    return picks.filter(([kind, key]) => reg.get(kind, key).tags.includes('fast')).length / picks.length;
  };
  const hush = fastShare('quietHush'), sprint = fastShare('dashSprint');
  assert.ok(hush < 0.36 * sprint, 'fast parts: quietHush ' + (100 * hush).toFixed(1) + ' %, dashSprint ' + (100 * sprint).toFixed(1) + ' %');
});

// filter.count follows the mood's film side too (§4.16.4: amounts.texture × its favourite effect): glitch and chroma
// alone gave silverReel 0.15 screen effects per cut (letterbox bars on 3 % of cuts, although its blurb promises them),
// printColumn 0.07 and quietHush 0.05. The work texture is never picked again as a cut's effect (risoPink's dotScreen
// texture plus a dotScreen effect doubled the dots).
test('film moods show their screen effects, and a cut never repeats the work texture as one (sample lyrics)', { skip: NO_CATALOG }, () => {
  const reg = CAT.defaultRegistry();
  const want = { silverReel: 0.4, printColumn: 0.15, quietHush: 0.2 };
  for (const mood of reg.keys('mood')) {
    const s = moodSample(reg, mood, 3);
    const perCut = s.filters.length / s.cuts;
    if (want[mood]) assert.ok(perCut >= want[mood], mood + ': ' + perCut.toFixed(2) + ' screen effects per cut');
    if (mood === 'silverReel') {
      const bars = s.filters.filter((k) => k === 'cinemaBars').length / s.cuts;
      assert.ok(bars >= 0.08, 'silverReel: letterbox bars on ' + (100 * bars).toFixed(1) + ' % of cuts');
    }
    const again = s.texture.filter(([key, tex]) => key === tex);
    assert.deepEqual(again, [], mood + ': the work texture picked again as a screen effect');
  }
});

// §3.8: under the season 'any' a seasonal part of another season than the theme's (or under a non-seasonal theme) is
// ×0.25, the theme's own season ×0.5 (nightTram with maple paper and falling leaves, emberGlow with a petal wash).
// Themes themselves stay ×0.5.
test('season any: stray seasonal parts weigh ×0.25, the theme’s own season ×0.5, seasonal themes ×0.5', { skip: NO_CATALOG }, () => {
  const CH = MV.use('planner/choose');
  const reg = CAT.defaultRegistry();
  const mood = reg.get('mood', 'quietHush');
  const factor = (theme, kind, key) => CH.createChooser(reg, { mood, theme: reg.get('theme', theme), season: 'any',
    amounts: mood.amounts }).statics(kind, key, false).season;
  assert.equal(factor('nightTram', 'ground', 'maplePaper'), 0.25);
  assert.equal(factor('emberGlow', 'ground', 'petalWash'), 0.25);
  assert.equal(factor('nightTram', 'ornament', 'leafFall'), 0.25);
  assert.equal(factor('mapleInk', 'ground', 'maplePaper'), 0.5, 'the theme’s own season');
  assert.equal(factor('mapleInk', 'ornament', 'snowDust'), 0.25);
  assert.equal(factor('nightTram', 'ground', 'flatFill'), 1);
  assert.equal(CH.seasonFactor('spring', 'any'), 0.5, 'a seasonal theme under any');
  assert.equal(CH.seasonFactor('spring', 'spring', null), 1.5);
});

// The accent marks emphasized words, so it must stand apart from the ink, not only from the ground. cyanPrint's pale
// blue accent #9FD3FF lay 0.131 from its near-white ink #EAF2FA in OKLab, a difference of lightness only, so emphasized
// words barely stood out (QA-LOOK); it now takes the blueprint yellow #F2C14E (0.197) and the blue moves to shiftB.
// mossStone (0.135), snowLantern (0.138) and tidePool (0.147) are as close but differ in hue and chroma (chartreuse,
// gold and aqua on dark grounds) and read well.
test('an accent stands apart from its ink: cyanPrint ≥ 0.18 in OKLab, every theme ≥ 0.13, readable on the ground', () => {
  const lin = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const oklab = (hex) => {
    const { r, g, b } = C.parse(hex);
    const [R, G, B] = [lin(r), lin(g), lin(b)];
    const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
    const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
    const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
    return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
  };
  const dist = (a, b) => { const p = oklab(a), q = oklab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
  for (const def of defsOf('theme')) {
    const d = dist(def.swatch.accent, def.swatch.ink);
    const min = def.key === 'cyanPrint' ? 0.18 : 0.13;
    assert.ok(d >= min, def.key + ': accent ' + def.swatch.accent + ' vs ink ' + def.swatch.ink + ' = ' + d.toFixed(3));
    assert.ok(C.contrast(def.swatch.accent, def.swatch.ground) >= 3, def.key + ': accent readable on the ground');
  }
});

// A white flash over the green-screen key turns the key colour pale green on its way to white, which keys as a
// half-transparent green veil: under the chroma backdrop whiteFlash leaves the automatic pool (a pin still works).
test('whiteFlash is never an automatic transition under the green-screen backdrop; a pin still works', { skip: NO_CATALOG }, () => {
  const reg = CAT.defaultRegistry();
  const flashes = (backdrop, pins) => {
    let n = 0;
    for (const mood of ['dashSprint', 'popFizz', 'glitchFracture']) {
      for (const plan of moodSample(reg, mood, 3, { backdrop }).plans) {
        n += plan.seams.filter((s) => s.slot.v === 'whiteFlash').length;
      }
    }
    return n;
  };
  assert.ok(flashes('scene') > 0, 'whiteFlash is picked on a normal frame');
  assert.equal(flashes('chroma'), 0, 'never under chroma');
  const lyrics = CMD.reduce(D.defaultDoc(), { t: 'lyrics.set', text: corpus.sampleLyrics() });
  const pinned = Object.assign({}, lyrics, { look: Object.assign({}, lyrics.look, { backdrop: 'chroma' }),
    pins: { 'work:seam': { v: 'whiteFlash', by: 'user' } } });
  assert.ok(PL.plan(pinned, { registry: reg }).seams.some((s) => s.slot.v === 'whiteFlash'), 'a pin still works');
});

// --- every theme and mood renders through planner, scene and recorder (the §8.2 conformance checks of a look part) --

const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const BUILD = MV.use('engine/scene/build');
const F = MV.use('engine/scene/frame');
const R = MV.use('engine/render/record');

function renderLook(pins) {
  const doc = corpus.project('basic').doc;
  doc.pins = Object.assign({}, doc.pins, pins);
  const plan = PL.plan(doc, { registry: LOOK_REG });
  const svc = { registry: LOOK_REG, text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
  const cuts = plan.cuts.map((c) => BUILD.buildCut(c, plan, svc));
  const grounds = plan.grounds.map((g) => BUILD.buildGround(g, plan, svc));
  const rec = R.createRecorder();
  const scale = 360 / plan.design.short;
  const W = plan.design.w, H = plan.design.h;
  const surf = R.surfaceOf(rec.factory, Math.round(W * scale), Math.round(H * scale), false);
  for (let i = 0; i < 12; i++) {
    const t = (plan.duration * (i + 0.5)) / 12;
    const fg = F.frameAt(plan, t);
    for (const e of fg.grounds) {
      F.evaluate(grounds[e.i], e.tl);
      R.drawScene(surf.ctx, grounds[e.i], { scale, W, H, pal: plan.look.palette, tl: e.tl });
    }
    for (const c of fg.cuts) {
      F.evaluate(cuts[c.i], c.tl);
      R.drawScene(surf.ctx, cuts[c.i], { scale, cam: F.cameraAt(cuts[c.i], plan, t), W, H, pal: plan.look.palette, tl: c.tl });
    }
  }
  return { plan, stats: rec.stats(), warnings: cuts.flatMap((s) => s.warnings || []) };
}

test('every theme and mood plans and renders cleanly (palette, faces, text style; no NaN, balanced save/restore)', () => {
  const cases = defsOf('theme').map((d) => ({ 'work:theme': { v: d.key, by: 'user' } }))
    .concat(defsOf('mood').map((d) => ({ 'work:mood': { v: d.key, by: 'user' } })));
  for (const pins of cases) {
    const [path0, pin] = Object.entries(pins)[0];
    const where = path0 + '=' + pin.v;
    const { plan, stats, warnings } = renderLook(pins);
    const kind = path0.slice(5);
    assert.equal(plan.look[kind].v, pin.v, where + ' is the plan look');
    if (kind === 'theme') {
      const def = LOOK_REG.get('theme', pin.v);
      assert.equal(plan.look.palette.ink, def.swatch.ink, where + ': ink comes from the swatch');
      assert.equal(plan.look.faces.display.ja.family, def.faces.display.ja, where + ': display face');
      assert.ok(plan.cuts.filter((c) => c.role === 'lyric').every((c) => c.slots['text.style'].v === def.style), where + ': text.style');
    } else {
      assert.deepEqual(plan.look.amounts, LOOK_REG.get('mood', pin.v).amounts, where + ': amounts come from the mood');
    }
    assert.ok(stats.balanced, where + ': save/restore balanced');
    assert.equal(stats.nan, 0, where + ': no NaN or Infinity drawn');
    assert.equal(stats.alphaBad, 0, where + ': globalAlpha within [0, 1]');
    assert.deepEqual(warnings.filter((w) => w.code === 'part-error'), [], where + ': no part errors');
  }
});

// --- picking up modules (last: it defines extra modules in this process) ---------------------------------------------

test('defs() picks up a part module defined later, and ignores modules outside the kind directories', { skip: NO_CATALOG }, () => {
  const before = CAT.defs().length;
  const K = MV.use('parts/kit');
  const hush = LOOK_REG.get('mood', 'quietHush');
  MV.def('parts/mood/zz_probe', ['parts/kit'], () => [K.variant(hush, {
    key: 'probeMood', label: { ja: '試験', en: 'Probe' }, blurb: { ja: '試験用', en: 'Test only' } })]);
  MV.def('parts/zz_other/thing', [], () => [{ kind: 'mood', key: 'strayMood' }]);
  const after = CAT.defs();
  assert.equal(after.length, before + 1);
  assert.ok(after.some((d) => d.key === 'probeMood'));
  assert.ok(!after.some((d) => d.key === 'strayMood'));
  const reg = CAT.defaultRegistry({ strict: false });
  assert.ok(reg.has('mood', 'probeMood') && !reg.get('mood', 'probeMood').fallback);
});
