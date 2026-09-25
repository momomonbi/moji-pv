/* 文字PVメーカー v2 — original work. Tests: planner/explain — same value as the Plan, sorted alternatives, no effect on the hash (DESIGN §4.16.8, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const REG = MV.use('core/registry');
const S = MV.use('core/schema');
const R = MV.use('core/rng');
const PL = MV.use('planner/plan');
const EX = MV.use('planner/explain');
const CH = MV.use('planner/choose');

// --- a synthetic registry: the stub parts plus many generated parts per kind (varied tags, traits, seasons, scopes),
// so the chooser has real choices before the catalog exists. Test data only. -------------------------------------
function synthRegistry(n = 12) {
  const L = (ja, en) => ({ ja, en });
  const FN = { arrange: { build: () => ({}) }, arrive: { make: () => [] }, dwell: { make: () => [] }, depart: { make: () => [] },
    ground: { build: () => undefined }, lens: { make: () => [] }, ornament: { build: () => undefined, follow: 'text' },
    filter: { apply: (fx, src) => src, stage: 'film', cost: 1, passes: 1, alphaSafe: true }, seam: { mix: (fx, a) => a } };
  const defs = [];
  for (const kind of Object.keys(FN)) {
    for (let i = 0; i < (kind === 'ornament' ? n + 6 : n); i++) {
      const a = S.TAGS[(i * 7 + kind.length * 3) % 17], b = S.TAGS[(i * 11 + kind.length * 5 + 4) % 17];
      const d = Object.assign({ kind, key: 'syn' + kind[0].toUpperCase() + kind.slice(1) + String(i).padStart(2, '0'),
        label: L('試験' + i, 'Test ' + i), blurb: L('試験用の部品', 'A synthetic test part'), tags: a === b ? [a] : [a, b],
        family: 'fam' + (i % 5) }, FN[kind]);
      const traits = {};
      if (kind === 'arrange' && i % 4 === 1) traits.orient = ['h'];
      if (kind === 'arrange' && i % 6 === 2) traits.orient = ['v'];
      if (i % 5 === 3) traits.cells = [1, 9];
      if (i % 7 === 2) traits.energy = [0.45, 1];
      if (i % 9 === 5) traits.impact = true;
      if (['arrange', 'arrive', 'dwell', 'depart', 'lens'].includes(kind) && i % 6 === 0) {
        traits.roles = ['lyric', 'focus', 'title', 'interlude', 'outro'];
      }
      if (Object.keys(traits).length) d.traits = traits;
      if (kind === 'ornament') d.scope = i >= n ? 'run' : 'cut';
      if ((kind === 'ground' || d.scope === 'run') && i % 4 === 1) d.season = ['spring', 'summer', 'autumn', 'winter'][(i >> 2) % 4];
      if (kind === 'filter' && i % 6 === 4) d.gate = 'glitch';
      if (kind === 'filter' && i % 5 === 0) d.texture = true;
      if (kind === 'seam') {
        d.scope = i % 2 ? 'world' : 'text';
        if (i % 4 === 1) d.replaces = { depart: true };
        if (i % 4 === 3) d.replaces = { arrive: true };
      }
      if (kind === 'arrive' && i % 3 === 0) d.unit = 'word';
      if (i % 4 === 0 && kind !== 'seam') {
        d.params = { level: { type: 'num', min: 0, max: 1, step: 0.01, label: L('量', 'Level'), auto: { range: [0.2, 0.8], follow: 'energy' } } };
      }
      defs.push(d);
    }
  }
  const theme = corpus.minimalFallbacks().find((d) => d.kind === 'theme');
  for (const [key, season, prefer] of [['synThemeDusk', null, { ground: { synGround03: 2 } }], ['synThemeBloom', 'spring', {}],
    ['synThemeSnow', 'winter', {}]]) defs.push(Object.assign({}, theme, { key, season, prefer, fallback: false, texture: 'synFilter00' }));
  const MOODS = [
    ['synMoodCalm', { soft: 1.8, slow: 1.6, minimal: 1.5, fast: 0.3, digital: 0.25 }, [.3, 0, .05, .35, .3, .5, .2, 0, .05, .3, .3], 0.8],
    ['synMoodPop', { playful: 1.8, bright: 1.7, fast: 1.4, dark: 0.5, slow: 0.5 }, [.75, .1, .2, .7, .6, .2, .6, .6, .3, .6, .7], 1.1],
    ['synMoodGlitch', { digital: 2, hard: 1.6, fast: 1.5, soft: 0.4, organic: 0.4 }, [.8, .85, .8, .5, .6, .5, .7, .7, .6, .6, .8], 1.2],
    ['synMoodReel', { slow: 1.5, dark: 1.5, serious: 1.4, busy: 0.5, playful: 0.5 }, [.45, .05, .15, .3, .35, .7, .3, .2, .15, .8, .35], 0.8]];
  for (const [key, tagBias, a, variety] of MOODS) {
    defs.push({ kind: 'mood', key, label: L('雰囲気', 'Mood'), tagBias, amounts: Object.fromEntries(S.AMOUNT_KEYS.map((k, i) => [k, a[i]])),
      themes: { synThemeDusk: 1.2, synThemeBloom: 0.8, synThemeSnow: 0.8, sumiWashi: 1 }, pace: { seam: a[10], focus: 0.4 },
      filters: { synFilter01: 0.7 }, variety });
  }
  return REG.createRegistry(corpus.allStubParts().concat(defs));
}

const SYN = synthRegistry();
const WHY = new Set(['mood.tag', 'fit', 'recent', 'family', 'echo', 'impact', 'season', 'theme.prefer', 'gate', 'rule', 'pin', 'lock']);
const MASKS = new Set([null, 'filter', 'season', 'trait', 'gate', 'role']);
const clone = (x) => JSON.parse(JSON.stringify(x));

// A document with pins of every kind (cut/line/work, a lock, a pinned seam), for explanations of pinned values too.
function pinnedDoc() {
  const doc = clone(corpus.project('basic').doc);
  const p = PL.run(doc, SYN, null);
  const cuts = p.cuts.filter((c) => c.role === 'lyric');
  doc.pins = {
    'work:dwell': { v: 'stubBob', by: 'user' },
    ['line/' + cuts[2].line + ':arrive']: { v: 'synArrive02', by: 'ai' },
    ['cut/' + cuts[5].key + ':seam']: { v: 'synSeam01', by: 'user', sig: cuts[5].text },
    ['cut/' + cuts[6].key + ':arrive.dur']: { v: 0.77, by: 'user', sig: cuts[6].text },
    'work:amount.ornament': { v: 0.9, by: 'user' },
  };
  return doc;
}

// The Plan's own value at a cut for a slot path's slot (independent of planner/fields).
function planValue(plan, cut, slot) {
  const m = /^([a-z]+)(?:#(\d))?(?:@([A-Za-z0-9]+))?(?:\.([A-Za-z0-9]+))?$/.exec(slot);
  if (slot === 't0') return cut.t0;
  if (slot.startsWith('el.')) {
    const [, owner, field] = slot.split('.');
    const e = cut.els[owner];
    return e && e[field] !== undefined ? e[field] : field === 'nudge' ? { dx: 0, dy: 0, rot: 0, s: 1 } : field === 'hide' ? false : null;
  }
  if (slot.startsWith('text.') || slot === 'orient') return cut.slots[slot].v;
  const [, kind, idx, key, param] = m;
  let d;
  if (kind === 'ground' || kind === 'atmos') d = plan.grounds[cut.ground][kind];
  else if (kind === 'seam') d = cut.seamIn >= 0 ? plan.seams[cut.seamIn].slot : { v: 'hardCut', from: 'auto' };
  else if (param === 'count' && idx === undefined) d = cut.slots[kind + '.count'];
  else d = cut.slots[idx === undefined ? kind : kind + '#' + idx];
  if (param === 'count' && idx === undefined) return d.v;
  if (!param) return d ? d.v : 'none';
  if (!d || (key && key !== d.v)) return undefined;
  return d.p[param];
}

function randomSlot(rng, plan, cut) {
  const pick = rng.next();
  if (pick < 0.35) return rng.pick(['arrange', 'arrive', 'dwell', 'depart', 'lens', 'seam', 'ground', 'atmos']);
  if (pick < 0.5) return rng.pick(['orient', 'text.face', 'text.scale', 'text.ink', 'text.style', 'ornament.count', 'filter.count']);
  if (pick < 0.62) {
    const n = cut.slots['ornament.count'].v, f = cut.slots['filter.count'].v;
    if (n && rng.chance(0.6)) return 'ornament#' + rng.int(0, n - 1);
    if (f) return 'filter#' + rng.int(0, f - 1);
    return 'lens';
  }
  if (pick < 0.85) {
    const kind = rng.pick(['arrange', 'arrive', 'dwell', 'depart', 'lens']);
    const d = cut.slots[kind];
    const names = Object.keys(d.p || {});
    if (!names.length) return kind;
    const name = rng.pick(names);
    const shared = !!REG.SHARED[kind][name];
    return shared ? kind + '.' + name : kind + '@' + d.v + '.' + name;
  }
  if (pick < 0.93) return rng.pick(['el.text.nudge', 'el.text.hide', 't0']);
  return 'arrive';
}

test('explain() gives the same value and source as the Plan for 500 random slots', () => {
  const docs = [pinnedDoc()].concat(corpus.corpus(1, ['16:9', '9:16']).map((c) => c.doc)).filter((d, i) => i < 5);
  let n = 0;
  for (let i = 0; n < 500; i++) {
    const rng = R.stream('explain', i);
    const doc = docs[i % docs.length];
    const plan = PL.plan(doc, { registry: SYN });
    const cut = rng.pick(plan.cuts);
    const slot = randomSlot(rng, plan, cut);
    const e = EX.explain(doc, plan, 'cut/' + cut.key + ':' + slot, { registry: SYN });
    assert.deepEqual(e.value, planValue(plan, cut, slot), 'cut/' + cut.key + ':' + slot);
    if (/^(arrange|arrive|dwell|depart|lens|orient|text\.)/.test(slot) && slot.indexOf('.') < 0 || /^text\./.test(slot)) {
      assert.equal(e.from, cut.slots[slot].from, slot + ' from');
    }
    for (const w of e.why) assert.ok(WHY.has(w.code), 'why code ' + w.code);
    n++;
  }
});

test('explain() at line and work scope explains the first cut it covers', () => {
  const doc = pinnedDoc();
  const plan = PL.plan(doc, { registry: SYN });
  const pinnedLine = Object.keys(doc.pins).find((k) => k.startsWith('line/')).slice(5).split(':')[0];
  const line = plan.lines.find((l) => l.id === pinnedLine);
  const first = plan.cuts.find((c) => c.key === line.cuts[0]);
  const e = EX.explain(doc, plan, 'line/' + line.id + ':arrive', { registry: SYN });
  assert.equal(e.value, first.slots.arrive.v);
  assert.deepEqual(e.why, [{ code: 'pin', params: { scope: 'line', by: 'ai' } }]);
  const w = EX.explain(doc, plan, 'work:dwell', { registry: SYN });
  assert.equal(w.value, 'stubBob');
  assert.equal(w.from, 'pin:work');
});

test('alternatives cover the kind, are sorted by weight then key, and masked ones weigh 0', () => {
  const doc = clone(corpus.project('long').doc);
  doc.filters = { arrive: { only: null, deny: ['synArrive01', 'synArrive02'] } };
  doc.pins = { 'work:season': { v: 'summer', by: 'user' } };
  const plan = PL.run(doc, SYN, null);
  for (const cut of plan.cuts.filter((c, i) => i % 17 === 3)) {
    for (const slot of ['arrange', 'arrive', 'ornament#0', 'ground', 'seam']) {
      if (slot === 'ornament#0' && !cut.slots['ornament.count'].v) continue;
      const e = EX.explain(doc, plan, 'cut/' + cut.key + ':' + slot, { registry: SYN });
      const kind = slot.replace(/#.*/, '');
      assert.equal(e.alts.length, SYN.all(kind).filter((d) => d.pool !== false).length, slot);
      for (let i = 1; i < e.alts.length; i++) {
        const a = e.alts[i - 1], b = e.alts[i];
        assert.ok(a.w > b.w || (a.w === b.w && a.key < b.key), slot + ' sorted at ' + i);
      }
      for (const a of e.alts) {
        assert.ok(MASKS.has(a.masked), a.masked);
        if (a.masked) assert.equal(a.w, 0);
      }
      if (slot === 'arrive') {
        for (const key of ['synArrive01', 'synArrive02']) assert.equal(e.alts.find((a) => a.key === key).masked, 'filter');
        if (e.from === 'auto') assert.ok(e.alts.find((a) => a.key === e.value).w > 0, 'the chosen part weighs > 0');
      }
      if (slot === 'ground') {
        for (const a of e.alts) {
          const s = SYN.get('ground', a.key).season;
          if (s && s !== 'summer') assert.equal(a.masked, 'season', a.key);
        }
      }
    }
  }
});

test('why: pins, locks, rules and chooser factors', () => {
  const doc = pinnedDoc();
  const plan = PL.plan(doc, { registry: SYN });
  const seamCut = plan.cuts.find((c) => c.seamIn >= 0 && plan.seams[c.seamIn].slot.from === 'pin:cut');
  const e = EX.explain(doc, plan, 'cut/' + seamCut.key + ':seam', { registry: SYN });
  assert.deepEqual(e.why, [{ code: 'pin', params: { scope: 'cut', by: 'user' } }]);
  const prev = plan.cuts[plan.cuts.indexOf(seamCut) - 1];
  if (prev.slots.depart.from === 'rule') {
    const d = EX.explain(doc, plan, 'cut/' + prev.key + ':depart', { registry: SYN });
    assert.equal(d.value, SYN.fallback('depart'));
    assert.deepEqual(d.why, [{ code: 'rule', params: { rule: 'seam' } }]);
  }
  const vdoc = corpus.project('vertical').doc;
  const vplan = PL.plan(vdoc, { registry: STUB_OR(vdoc) });
  const locked = EX.explain(vdoc, vplan, 'cut/r6~0:arrange', { registry: STUB_OR(vdoc) });
  assert.deepEqual(locked.why, [{ code: 'lock', params: {} }]);
  // an automatic pick on a repeated line echoes the first sung copy
  const long = corpus.project('long').doc;
  const lplan = PL.plan(long, { registry: SYN });
  let echoes = 0;
  for (const cut of lplan.cuts.filter((c) => c.feat.repeatOf).slice(0, 40)) {
    const x = EX.explain(long, lplan, 'cut/' + cut.key + ':arrive', { registry: SYN });
    if (x.why.some((w) => w.code === 'echo')) { echoes++; assert.equal(x.why.find((w) => w.code === 'echo').params.cut, cut.feat.repeatOf); }
  }
  assert.ok(echoes > 0, 'some repeated lines follow their first copy');
});

function STUB_OR() { return corpus.stubRegistry(MV); }

test('explain() never changes the plan, the document or later plans', () => {
  const doc = pinnedDoc();
  const plan = PL.plan(doc, { registry: SYN });
  const text = JSON.stringify(plan), docText = JSON.stringify(doc), hash = plan.hash;
  for (const cut of plan.cuts.slice(0, 12)) {
    for (const slot of ['arrange', 'arrive', 'seam', 'ground', 'orient', 'arrive.dur']) EX.explain(doc, plan, 'cut/' + cut.key + ':' + slot, { registry: SYN });
  }
  for (const path of ['work:mood', 'work:theme', 'work:season', 'work:color.accent', 'work:amount.ornament', 'line/' + plan.lines[0].id + ':start']) {
    EX.explain(doc, plan, path, { registry: SYN });
  }
  assert.equal(JSON.stringify(plan), text);
  assert.equal(JSON.stringify(doc), docText);
  assert.equal(plan.hash, hash);
  assert.equal(PL.run(doc, SYN, null).hash, hash);
  assert.ok(!('why' in plan.cuts[0].slots.arrange), 'nothing from explain enters the Plan');
});

test('look and line slots: mood, theme and season alternatives and sources', () => {
  const doc = clone(corpus.project('basic').doc);
  const plan = PL.plan(doc, { registry: SYN });
  const mood = EX.explain(doc, plan, 'work:mood', { registry: SYN });
  assert.equal(mood.value, plan.look.mood.v);
  assert.equal(mood.alts.length, SYN.keys('mood').length);
  const theme = EX.explain(doc, plan, 'work:theme', { registry: SYN });
  assert.equal(theme.value, plan.look.theme.v);
  const season = EX.explain(doc, plan, 'work:season', { registry: SYN });
  assert.equal(season.value, 'any');
  const snowy = clone(doc);
  snowy.sheet.rows.push({ id: 'rz', src: '白い息が雪に消える' }, { id: 'rz1', src: '冬の雪' });
  snowy.sheet.next = 99;
  const sp = PL.plan(snowy, { registry: SYN });
  const ws = EX.explain(snowy, sp, 'work:season', { registry: SYN });
  assert.equal(ws.value, 'winter');
  assert.equal(ws.why[0].code, 'season');
  assert.ok(ws.why[0].params.word);
  const start = EX.explain(doc, plan, 'line/' + plan.lines[0].id + ':start', { registry: SYN });
  assert.equal(start.value, plan.lines[0].t0);
  assert.equal(start.from, 'auto');
  const split = EX.explain(doc, plan, 'line/' + plan.lines[0].id + ':split', { registry: SYN });
  assert.deepEqual(split.value, plan.lines[0].cuts.map((k) => Number(k.split('~')[1])));
  assert.equal(split.from, 'mark', "the row's '/' marks");
});

// --- the v2.1 slots (DESIGN_2_1 §2.3, §2.8, §3.9) -----------------------------------------------------------------

const NEW_WHY = new Set([...WHY, 'cam.emph', 'cam.impact', 'cam.words', 'cam.long', 'cam.short', 'cam.section', 'cam.sectionStart',
  'cam.lens', 'cam.arrange', 'cam.amount', 'rig.section', 'rig.lastChorus', 'season.line', 'avoid']);
const VALUE_SLOTS = ['motion.speed', 'cam.shot', 'cam.zoom', 'cam.curve', 'cam.follow', 'rig', 'rig.curve'];
const CURVE_PARAMS = ['arrive.ease', 'arrive.flow', 'depart.ease', 'depart.flow', 'dwell.curve', 'lens.curve', 'seam.curve'];

// Documents with v2.1 pins of every kind, on the synthetic registry with two framing lenses and camera-less layouts.
const SYN21 = REG.createRegistry(SYN.all().map((d) => {
  if (d.kind === 'lens' && /0[01]$/.test(d.key)) return Object.assign({}, d, { frames: true });
  if (d.kind === 'arrange' && /0[45]$/.test(d.key)) return Object.assign({}, d, { cam: 'none' });
  if (d.kind === 'arrange' && /0[67]$/.test(d.key)) return Object.assign({}, d, { cam: 'gentle' });
  return d;
}));
function newPinsDoc(name, k) {
  const doc = clone(corpus.project(name).doc);
  const p = PL.run(doc, SYN21, null);
  const L = p.lines, cuts = p.cuts.filter((c) => c.role === 'lyric');
  const at = (i) => cuts[(i * 7 + k) % cuts.length];
  Object.assign(doc.pins, {
    ['line/' + L[(1 + k) % L.length].id + ':cam.shot']: { v: 'pushWord', by: 'ai' },
    ['cut/' + at(1).key + ':cam.shot']: { v: { keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'last', fill: 0.9 }] }, by: 'user', sig: at(1).text },
    ['line/' + L[(2 + k) % L.length].id + ':cam.zoom']: { v: 1.3, by: 'user' },
    'work:cam.curve': { v: { ramp: { edge: 0.1, ends: 'both', peak: 4 } }, by: 'ai' },
    ['line/' + L[(3 + k) % L.length].id + ':motion.speed']: { v: 0.5, by: 'ai' },
    ['line/' + L[(4 + k) % L.length].id + ':rig']: { v: 'climbRise', by: 'ai' },
    ['line/' + L[(5 + k) % L.length].id + ':season']: { v: 'winter', by: 'ai' },
    ['line/' + L[(6 + k) % L.length].id + ':avoid']: { v: ['arrive.synArrive01', 'lens.synLens02'], by: 'ai' },
    ['cut/' + at(2).key + ':arrive.ease']: { v: 'hushRushHush', by: 'user', sig: at(2).text },
    'work:seam.curve': { v: 'dashStop', by: 'user' },
  });
  return doc;
}

// The Plan's own value of a v2.1 path at a cut (independent of planner/fields).
function newPlanValue(doc, plan, cut, slot) {
  if (slot === 'rig') return plan.rigs[cut.rig].rig.v;
  if (slot === 'rig.curve') return plan.rigs[cut.rig].curve.v;
  if (VALUE_SLOTS.includes(slot)) return cut.slots[slot].v;
  if (slot === 'season') {
    const pin = doc.pins['line/' + cut.line + ':season'];
    return pin ? pin.v : plan.look.season.v;
  }
  if (slot === 'avoid') {
    const pin = doc.pins['line/' + cut.line + ':avoid'];
    return pin ? pin.v : [];
  }
  const [kind, param] = slot.split('.');
  if (kind === 'seam') return cut.seamIn >= 0 ? plan.seams[cut.seamIn].slot.p[param] : undefined;
  return cut.slots[kind].p[param];
}

test('explain() gives the Plan\'s value and source for 500 random paths of the v2.1 slots at every scope', () => {
  const docs = [newPinsDoc('basic', 0), newPinsDoc('long', 3), newPinsDoc('vertical', 1)]
    .concat(corpus.corpus(1, ['16:9', '9:16']).map((c) => c.doc).slice(0, 3));
  let n = 0;
  const seen = new Set();
  for (let i = 0; n < 500; i++) {
    const rng = R.stream('explain-v21', i);
    const doc = docs[i % docs.length];
    const plan = PL.plan(doc, { registry: SYN21 });
    const slot = rng.pick(VALUE_SLOTS.concat(VALUE_SLOTS, CURVE_PARAMS, ['season', 'avoid']));
    const scope = slot === 'avoid' || slot === 'season' ? rng.pick(['line', 'line', 'cut']) : rng.pick(['cut', 'cut', 'line', 'work']);
    const lyric = plan.cuts.filter((c) => c.role === 'lyric' || c.role === 'focus');
    let cut = rng.pick(scope === 'cut' ? plan.cuts : lyric);
    let path;
    if (scope === 'work') { cut = lyric[0]; path = 'work:' + slot; }
    else if (scope === 'line') {
      const line = plan.lines.find((l) => l.id === cut.line);
      cut = plan.cuts.find((c) => c.key === line.cuts[0]);
      path = 'line/' + line.id + ':' + slot;
    } else path = 'cut/' + cut.key + ':' + slot;
    if ((slot === 'season' || slot === 'avoid') && !cut.line) continue;
    const e = EX.explain(doc, plan, path, { registry: SYN21 });
    assert.deepEqual(e.value, newPlanValue(doc, plan, cut, slot), path);
    if (VALUE_SLOTS.includes(slot)) {
      const d = slot === 'rig' ? plan.rigs[cut.rig].rig : slot === 'rig.curve' ? plan.rigs[cut.rig].curve : cut.slots[slot];
      assert.equal(e.from, d.from, path + ' from');
    }
    for (const w of e.why) assert.ok(NEW_WHY.has(w.code), path + ': why code ' + w.code);
    if (slot === 'cam.shot' || slot === 'rig') {
      assert.equal(e.alts.length, slot === 'rig' ? 6 : 10, path + ' alternatives');
      for (let k = 1; k < e.alts.length; k++) assert.ok(e.alts[k - 1].w >= e.alts[k].w, path + ' sorted');
    }
    seen.add(slot + '@' + scope);
    n++;
  }
  assert.ok(seen.size > 25, [...seen].join(' '));
});

test('explain: why codes of the camera slots', () => {
  const doc = clone(corpus.project('basic').doc);
  doc.pins['work:amount.camera'] = { v: 0.05, by: 'user' };
  const p = PL.plan(doc, { registry: SYN21 });
  const c = p.cuts.find((x) => x.role === 'lyric');
  const e = EX.explain(doc, p, 'cut/' + c.key + ':cam.shot', { registry: SYN21 });
  assert.deepEqual([e.value, e.from, e.why], ['none', 'auto', [{ code: 'rule', params: { rule: 'none-camera' } },
    { code: 'cam.amount', params: { x: 0.05 } }]]);
  assert.ok(e.alts.every((a) => a.w === 0));
  const r = EX.explain(doc, p, 'cut/' + c.key + ':rig', { registry: SYN21 });
  assert.deepEqual([r.value, r.why], ['none', [{ code: 'cam.amount', params: { x: 0.05 } }]]);
  // A layout without camerawork forces 'none' (from rule).
  const off = clone(corpus.project('basic').doc);
  off.pins['work:arrange'] = { v: 'synArrange04', by: 'user' };
  const q = PL.plan(off, { registry: SYN21 });
  const cut = q.cuts.find((x) => x.role === 'lyric' && x.slots.arrange.v === 'synArrange04');
  const x = EX.explain(off, q, 'cut/' + cut.key + ':cam.shot', { registry: SYN21 });
  assert.deepEqual([x.value, x.from, x.why], ['none', 'rule', [{ code: 'cam.arrange', params: { key: 'synArrange04' } }]]);
  const z = EX.explain(off, q, 'cut/' + cut.key + ':cam.zoom', { registry: SYN21 });
  assert.equal(z.why[0].code, 'cam.amount');
  for (const slot of ['cam.curve', 'cam.follow', 'motion.speed']) {
    const w = EX.explain(off, q, 'cut/' + cut.key + ':' + slot, { registry: SYN21 }).why;
    assert.ok(w.every((y) => y.code === 'rule' || y.code === 'cam.impact'), slot);
  }
  // An impact cut's zoom and curve name the impact; other cuts' zoom only the amount.
  let impacts = 0;
  for (const { doc: d } of corpus.corpus(1)) {
    const plan = PL.plan(d, { registry: SYN21 });
    const lyric = plan.cuts.filter((y) => y.role === 'lyric');
    for (const k of lyric.filter((y) => y.feat.impact).slice(0, 4).concat(lyric.filter((y) => !y.feat.impact).slice(0, 3))) {
      const zw = EX.explain(d, plan, 'cut/' + k.key + ':cam.zoom', { registry: SYN21 }).why.map((y) => y.code);
      const cw = EX.explain(d, plan, 'cut/' + k.key + ':cam.curve', { registry: SYN21 }).why.map((y) => y.code);
      assert.equal(zw.includes('cam.impact'), !!k.feat.impact, k.key + ' zoom why ' + zw);
      assert.equal(cw.includes('cam.impact'), !!k.feat.impact, k.key + ' curve why ' + cw);
      if (k.feat.impact) impacts++;
    }
  }
  assert.ok(impacts >= 3, 'impact cuts ' + impacts);
});

test('the batched Gumbel noise of the chooser equals core/rng.gumbel', () => {
  for (let i = 0; i < 300; i++) {
    const seed = R.stream('g', i).int(0, 0xffffffff);
    const key = 'part' + i + (i % 3 ? 'X' : '');
    assert.equal(CH.gumbelAt(CH.gumbelPrefix(seed), key), R.gumbel(seed, key));
  }
});
