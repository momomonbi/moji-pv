/* 文字PVメーカー v2 — original work. Tests: the line slots season and avoid, and motion speed, in the planner (DESIGN_2_1 §4.3, §4.9, §7.3). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const REG = MV.use('core/registry');
const S = MV.use('core/schema');
const PL = MV.use('planner/plan');
const CH = MV.use('planner/choose');
const EX = MV.use('planner/explain');
const F = MV.use('planner/fields');
const C = MV.use('core/commands');

const clone = (x) => JSON.parse(JSON.stringify(x));
const user = (v) => ({ v, by: 'user' });
const ai = (v) => ({ v, by: 'ai' });

// --- a registry with seasonal backgrounds and atmospheres (test data) ------------------------------------------------
// The stub parts plus, per season, two grounds and two run ornaments, and plain ones; several entrances.
function seasonRegistry() {
  const L = (ja, en) => ({ ja, en });
  const stubs = corpus.allStubParts();
  const byKey = (kind, key) => stubs.find((d) => d.kind === kind && d.key === key);
  const defs = [];
  const add = (base, key, extra) => defs.push(Object.assign({}, base, { key, fallback: false, pool: true, label: L('試' + key, key) }, extra));
  for (const season of ['spring', 'summer', 'autumn', 'winter', null]) {
    const tag = season || 'plain';
    for (const i of [1, 2]) {
      add(byKey('ground', 'stubTint'), 'tint' + tag[0].toUpperCase() + tag.slice(1) + i, { season });
      add(byKey('ornament', 'stubRule'), 'air' + tag[0].toUpperCase() + tag.slice(1) + i, { season, scope: 'run', follow: 'own' });
    }
  }
  for (const i of [1, 2, 3, 4]) add(byKey('arrive', 'stubFade'), 'fadeIn' + i + 'x', { tags: i % 2 ? ['soft'] : ['bold'] });
  return REG.createRegistry(stubs.concat(defs));
}
const REGS = seasonRegistry();
const STUB = corpus.stubRegistry(MV);

// A fixture without pins, its work season pinned to 'any' (project_long's lyrics name winter).
function base(name = 'long') {
  const doc = clone(corpus.project(name).doc);
  doc.pins = { 'work:season': user('any') };
  doc.locks = {};
  return doc;
}

// The segments whose first cut lies on one of `lines`.
function segmentsOn(plan, lines) {
  return plan.grounds.filter((g) => lines.includes(plan.cuts.find((c) => c.key === g.cuts[0]).line));
}

test('a line season gates the pools of its segments and weighs its own season ×2.5 (SECTION_SEASON)', () => {
  assert.equal(CH.FACTORS.SECTION_SEASON, 2.5);
  assert.equal(CH.seasonFactor('winter', 'winter', null, true), 2.5);
  assert.equal(CH.seasonFactor('winter', 'winter', null, false), 1.5);
  let seasonal = 0, checked = 0;
  for (let s = 0; s < 12; s++) {
    const doc = base();
    doc.look.seed = 1000 + s;
    const p0 = PL.run(doc, REGS, null);
    const lines = p0.lines.filter((l, i) => i % 5 === 1).map((l) => l.id);
    for (const id of lines) doc.pins['line/' + id + ':season'] = ai('winter');
    const p = PL.run(doc, REGS, null);
    assert.ok(!p.warnings.some((w) => w.code === 'pin-bad-value' || w.code === 'pin-off-season'));
    for (const g of segmentsOn(p, lines)) {
      for (const [kind, d] of [['ground', g.ground], ['ornament', g.atmos]]) {
        if (d.v === 'none') continue;
        const season = REGS.get(kind, d.v).season;
        assert.ok(!season || season === 'winter', g.key + ' ' + d.v);
        if (season === 'winter') seasonal++;
        checked++;
      }
    }
    for (const g of p.grounds.filter((x) => !segmentsOn(p, lines).includes(x))) {
      const season = REGS.get('ground', g.ground.v).season;
      assert.ok(!season || p.look.season.v === 'any' || season === p.look.season.v, 'other segments keep the work season');
    }
  }
  assert.ok(checked > 40 && seasonal / checked > 0.45, 'winter parts win on winter lines: ' + seasonal + ' of ' + checked);
  // The factor is visible in a traced pick.
  const doc = base();
  const p0 = PL.run(doc, REGS, null);
  const line = p0.lines[4];
  doc.pins['line/' + line.id + ':season'] = ai('winter');
  const p = PL.run(doc, REGS, null);
  const first = p.cuts.find((c) => c.line === line.id);
  const seg = p.grounds[first.ground];
  assert.equal(seg.cuts[0], first.key, 'the line starts a segment');
  const t = PL.trace(doc, { registry: REGS }, { cutKey: first.key, slot: 'ground' });
  const cands = t.out.candidates;
  for (const c of cands) {
    const season = REGS.get('ground', c.key).season;
    assert.equal(c.f.season, season === 'winter' ? 2.5 : 1, c.key);
  }
  const e = EX.explain(doc, p, 'cut/' + first.key + ':ground', { registry: REGS });
  if (REGS.get('ground', e.value).season === 'winter') assert.ok(e.why.some((w) => w.code === 'season.line' && w.params.season === 'winter'));
  for (const a of e.alts) {
    const season = REGS.get('ground', a.key).season;
    if (season && season !== 'winter') assert.equal(a.masked, 'season', a.key);
  }
});

test('a line season starts and ends a segment; the same season as its neighbours does not', () => {
  const doc = base();
  const p0 = PL.run(doc, REGS, null);
  const line = p0.lines[10];
  doc.pins['line/' + line.id + ':season'] = ai('summer');
  const p = PL.run(doc, REGS, null);
  const idx = p.cuts.map((c, i) => [c, i]).filter(([c]) => c.line === line.id).map(([, i]) => i);
  const first = idx[0], last = idx[idx.length - 1];
  assert.notEqual(p.cuts[first].ground, p.cuts[first - 1].ground, 'a break before the line');
  if (last + 1 < p.cuts.length) assert.notEqual(p.cuts[last + 1].ground, p.cuts[last].ground, 'a break after it');
  for (const i of idx) assert.equal(p.cuts[i].ground, p.cuts[first].ground, 'the line stays in one segment');
  // Pinning the work's own season on a line changes the effective season of nothing, so it adds no break (but the
  // line's own season still weighs its season ×2.5).
  const same = base();
  same.pins['line/' + line.id + ':season'] = ai(p0.look.season.v);
  const q = PL.run(same, REGS, null);
  const q0 = PL.run(base(), REGS, null);
  assert.deepEqual(q.grounds.map((g) => g.cuts), q0.grounds.map((g) => g.cuts));
});

test('a line season raises the atmosphere chance to at least 0.85 for its segments', () => {
  let pinned = 0, pinnedAtmos = 0, plain = 0, plainAtmos = 0;
  for (let s = 0; s < 30; s++) {
    const doc = base('basic');
    doc.look.seed = 5000 + s;
    doc.pins['work:amount.ornament'] = user(0.3);          // 0.6·0.3 = 0.18 without the line season
    const p0 = PL.run(doc, REGS, null);
    const lines = p0.lines.filter((l, i) => i % 3 === 0).map((l) => l.id);
    for (const id of lines) doc.pins['line/' + id + ':season'] = ai('autumn');
    const p = PL.run(doc, REGS, null);
    for (const g of p.grounds) {
      const on = lines.includes(p.cuts.find((c) => c.key === g.cuts[0]).line);
      if (on) { pinned++; if (g.atmos.v !== 'none') pinnedAtmos++; } else { plain++; if (g.atmos.v !== 'none') plainAtmos++; }
    }
  }
  assert.ok(pinned > 60 && plain > 60, pinned + ' ' + plain);
  assert.ok(pinnedAtmos / pinned > 0.75, 'line season segments: ' + pinnedAtmos + ' of ' + pinned);
  assert.ok(plainAtmos / plain < 0.3, 'other segments: ' + plainAtmos + ' of ' + plain);
});

test('pin-off-season compares with the effective season of the cut', () => {
  const doc = base('basic');
  doc.pins['work:season'] = user('summer');
  const p0 = PL.run(doc, REGS, null);
  const [a, b] = [p0.lines[1], p0.lines[3]];
  doc.pins['line/' + a.id + ':season'] = ai('winter');
  doc.pins['line/' + a.id + ':ground'] = user('tintWinter1');
  doc.pins['line/' + b.id + ':ground'] = user('tintWinter2');
  const p = PL.run(doc, REGS, null);
  const off = p.warnings.filter((w) => w.code === 'pin-off-season').map((w) => w.path);
  assert.deepEqual(off, ['line/' + b.id + ':ground'], 'only the line without a matching season warns');
  assert.equal(p.grounds[p.cuts.find((c) => c.line === a.id).ground].ground.v, 'tintWinter1');
  assert.equal(p.grounds[p.cuts.find((c) => c.line === b.id).ground].ground.v, 'tintWinter2', 'pins still win');
  // A 'none' line season leaves only non-seasonal parts; 'any' opens every season.
  const none = base('basic');
  none.pins['work:season'] = user('summer');
  for (const l of p0.lines) none.pins['line/' + l.id + ':season'] = ai('none');
  const q = PL.run(none, REGS, null);
  for (const g of q.grounds.filter((x) => q.cuts.find((c) => c.key === x.cuts[0]).line)) {
    assert.ok(!REGS.get('ground', g.ground.v).season, g.key);
  }
});

test('avoid: excludes parts from the line\'s automatic pools, relaxes with avoid-empty, pins still win', () => {
  const doc = base();
  const p0 = PL.run(doc, REGS, null);
  const line = p0.lines[6];
  const cuts0 = p0.cuts.filter((c) => c.line === line.id);
  const used = [...new Set(cuts0.map((c) => c.slots.arrive.v))];
  doc.pins['line/' + line.id + ':avoid'] = ai(used.map((k) => 'arrive.' + k).concat(['lens.noSuchPart']));
  const p = PL.run(doc, REGS, null);
  for (const c of p.cuts.filter((x) => x.line === line.id)) assert.ok(!used.includes(c.slots.arrive.v), c.key + ' ' + c.slots.arrive.v);
  assert.ok(!p.warnings.some((w) => w.code === 'avoid-empty'));
  const e = EX.explain(doc, p, 'cut/' + cuts0[0].key + ':arrive', { registry: REGS });
  assert.ok(e.why.some((w) => w.code === 'avoid' && w.params.n === used.length), JSON.stringify(e.why));
  for (const k of used) assert.equal(e.alts.find((a) => a.key === k).masked, 'filter', k);
  // Avoiding every entrance of the pool relaxes the list for that kind, with a warning.
  const all = base();
  all.pins['line/' + line.id + ':avoid'] = ai(REGS.pool('arrive', {}).map((k) => 'arrive.' + k));
  const q = PL.run(all, REGS, null);
  const w = q.warnings.filter((x) => x.code === 'avoid-empty');
  assert.deepEqual(w, [{ code: 'avoid-empty', line: line.id, path: 'line/' + line.id + ':avoid' }]);
  assert.ok(q.cuts.filter((c) => c.line === line.id).every((c) => REGS.has('arrive', c.slots.arrive.v)));
  // A pinned part on the avoid list is used.
  const pinned = clone(doc);
  pinned.pins['line/' + line.id + ':arrive'] = user(used[0]);
  const r = PL.run(pinned, REGS, null);
  assert.ok(r.cuts.filter((c) => c.line === line.id).every((c) => c.slots.arrive.v === used[0] && c.slots.arrive.from === 'pin:line'));
  // Other lines keep their choices, except where the line's recency or an echo of it (and that echo's recency and the
  // runner-up rule of entrances) reaches.
  const others = p.cuts.filter((c) => c.line !== line.id);
  const moved = others.filter((c) => c.slots.arrive.v !== p0.cuts.find((x) => x.key === c.key).slots.arrive.v);
  assert.ok(moved.length <= others.length * 0.05, moved.length + ' of ' + others.length + ' other cuts changed');
});

test('avoid reaches backgrounds (the first cut\'s line), atmospheres and the transition into a cut', () => {
  const doc = base('basic');
  doc.pins['work:amount.ornament'] = user(1);
  const p0 = PL.run(doc, REGS, null);
  const seg = p0.grounds.find((g, k) => k > 0 && p0.cuts.find((c) => c.key === g.cuts[0]).line);
  const first = p0.cuts.find((c) => c.key === seg.cuts[0]);
  const refs = ['ground.' + seg.ground.v];
  if (seg.atmos.v !== 'none') refs.push('ornament.' + seg.atmos.v);
  const into = p0.cuts.find((c) => c.seamIn >= 0 && c.line);
  if (into) refs.push('seam.' + p0.seams[into.seamIn].slot.v);
  doc.pins['line/' + first.line + ':avoid'] = ai(refs);
  if (into && into.line !== first.line) doc.pins['line/' + into.line + ':avoid'] = ai(refs);
  const p = PL.run(doc, REGS, null);
  const g = p.grounds[p.cuts.find((c) => c.key === first.key).ground];
  assert.notEqual(g.ground.v, seg.ground.v, 'the ground is avoided');
  if (seg.atmos.v !== 'none') assert.notEqual(g.atmos.v, seg.atmos.v, 'the atmosphere is avoided');
  if (into) {
    const b = p.cuts.find((c) => c.key === into.key);
    assert.ok(b.seamIn < 0 || p.seams[b.seamIn].slot.v !== p0.seams[into.seamIn].slot.v, 'the transition is avoided');
  }
});

test('locks: a locked line keeps its values when its season or avoid list is pinned afterwards', () => {
  const doc = base('basic');
  const p0 = PL.run(doc, REGS, null);
  const line = p0.lines[2];
  const locked = C.reduce(doc, Object.assign({}, F.lockPayload(doc, p0, line.id, { registry: REGS }), { n: 1 }));
  const before = PL.run(locked, REGS, null).cuts.filter((c) => c.line === line.id);
  const d = clone(locked);
  d.pins['line/' + line.id + ':season'] = ai('winter');
  d.pins['line/' + line.id + ':avoid'] = ai(before.map((c) => 'arrive.' + c.slots.arrive.v).concat(before.map((c) => 'lens.' + c.slots.lens.v)));
  const after = PL.run(d, REGS, null).cuts.filter((c) => c.line === line.id);
  const view = (list) => list.map((c) => Object.fromEntries(Object.entries(c.slots).map(([k, x]) => [k, [x.v, x.p]])));
  assert.deepEqual(view(after), view(before));
});

test('motion.speed scales only unpinned durations, staggers and hold speeds, with pfrom rule', () => {
  const doc = base('basic');
  const p0 = PL.run(doc, STUB, null);
  const line = p0.lines.find((l) => l.cuts.length >= 2) || p0.lines[1];
  const cut0 = p0.cuts.find((c) => c.key === line.cuts[0]);
  for (const speed of [0.5, 2, 0.25]) {
    const d = clone(doc);
    d.pins['line/' + line.id + ':motion.speed'] = ai(speed);
    d.pins['cut/' + cut0.key + ':arrive.dur'] = { v: 0.9, by: 'user', sig: cut0.text };
    const p = PL.run(d, STUB, null);
    for (const key of line.cuts) {
      const a = p0.cuts.find((c) => c.key === key), b = p.cuts.find((c) => c.key === key);
      assert.deepEqual(b.slots['motion.speed'], { by: 'ai', from: 'pin:line', v: speed });
      for (const kind of ['arrive', 'depart', 'dwell']) {
        const before = a.slots[kind], after = b.slots[kind];
        assert.equal(after.v, before.v, key + ' ' + kind + ' the part is kept');
        const list = STUB.params(kind, after.v);
        for (const name of Object.keys(after.p)) {
          const spec = list.find((x) => x.name === name).spec;
          const pinnedHere = key === cut0.key && kind === 'arrive' && name === 'dur';
          const scaled = (kind === 'dwell' ? ['speed'] : ['dur', 'each']).includes(name) && !pinnedHere;
          if (pinnedHere) assert.deepEqual([after.p.dur, after.pfrom.dur], [0.9, 'pin:cut']);
          else if (scaled) {
            assert.equal(after.p[name], S.coerce(spec, kind === 'dwell' ? before.p[name] * speed : before.p[name] / speed), key + ' ' + kind + '.' + name);
            assert.equal(after.pfrom[name], 'rule', key + ' ' + kind + '.' + name + ' from rule');
          } else assert.deepEqual(after.p[name], before.p[name], key + ' ' + kind + '.' + name + ' unchanged');
        }
      }
      const e = EX.explain(d, p, 'cut/' + key + ':arrive.each', { registry: STUB });
      assert.deepEqual([e.from, e.why], ['rule', [{ code: 'rule', params: { rule: 'speed' } }]]);
    }
    for (const c of p.cuts.filter((x) => x.line !== line.id)) assert.equal(c.slots['motion.speed'].v, 1);
  }
  // Speed 1 leaves every parameter as it was, with no pfrom.
  const one = clone(doc);
  one.pins['work:motion.speed'] = user(1);
  const q = PL.run(one, STUB, null);
  for (const c of q.cuts) {
    const a = p0.cuts.find((x) => x.key === c.key);
    for (const kind of ['arrive', 'dwell', 'depart']) assert.deepEqual(c.slots[kind], a.slots[kind], c.key + ' ' + kind);
  }
  // Bad values fall back with pin-bad-value; the range is clamped.
  const bad = clone(doc);
  bad.pins['work:motion.speed'] = user('fast');
  bad.pins['line/' + line.id + ':motion.speed'] = user(9);
  const r = PL.run(bad, STUB, null);
  assert.ok(r.warnings.some((w) => w.code === 'pin-bad-value' && w.path === 'work:motion.speed'));
  assert.equal(r.cuts.find((c) => c.key === line.cuts[0]).slots['motion.speed'].v, 4);
});

test('fields and explain: season and avoid are line values; season cascades line → work', () => {
  const doc = base('basic');
  doc.pins['work:season'] = user('summer');
  const p0 = PL.run(doc, REGS, null);
  const [a, b] = [p0.lines[1], p0.lines[2]];
  doc.pins['line/' + a.id + ':season'] = ai('winter');
  doc.pins['line/' + a.id + ':avoid'] = ai(['arrive.stubFade', 'lens.stubDrift']);
  const p = PL.run(doc, REGS, null);
  const fs = (path) => F.fieldState(doc, p, null, path, { registry: REGS });
  assert.deepEqual([fs('line/' + a.id + ':season').value, fs('line/' + a.id + ':season').state], ['winter', 'ai']);
  assert.deepEqual([fs('line/' + b.id + ':season').value, fs('line/' + b.id + ':season').state], ['summer', 'inherited']);
  assert.deepEqual(fs('line/' + a.id + ':season').canPinAt, ['line', 'work']);
  assert.deepEqual(fs('line/' + a.id + ':avoid').canPinAt, ['line']);
  assert.deepEqual(fs('line/' + a.id + ':avoid').value, ['arrive.stubFade', 'lens.stubDrift']);
  assert.deepEqual(fs('line/' + a.id + ':avoid').display, ['val.refs', { n: 2 }]);
  assert.deepEqual([fs('line/' + b.id + ':avoid').value, fs('line/' + b.id + ':avoid').state], [[], 'auto']);
  assert.equal(F.categoryOf(MV.use('core/paths').parse('work:season')), 'look', 'the work season stays a look value');
  const ea = EX.explain(doc, p, 'line/' + a.id + ':season', { registry: REGS });
  assert.deepEqual(ea.why, [{ code: 'pin', params: { scope: 'line', by: 'ai' } }, { code: 'season.line', params: { season: 'winter' } }]);
  const eb = EX.explain(doc, p, 'line/' + b.id + ':season', { registry: REGS });
  assert.deepEqual([eb.value, eb.from, eb.why], ['summer', 'pin:work', [{ code: 'pin', params: { scope: 'work', by: 'user' } }]]);
  const ev = EX.explain(doc, p, 'line/' + a.id + ':avoid', { registry: REGS });
  assert.deepEqual(ev.why, [{ code: 'pin', params: { scope: 'line', by: 'ai' } }, { code: 'avoid', params: { n: 2 } }]);
});
