/* 文字PVメーカー v2 — original work. Tests: materials in the planner — pins, pools, fingerprints, the cast cache, material-bad (DESIGN_2_1 §5.9, §2.7, §2.8, §7.3). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const REG = MV.use('core/registry');
const PL = MV.use('planner/plan');
const EX = MV.use('planner/explain');

const clone = (x) => JSON.parse(JSON.stringify(x));
const L = (ja, en) => ({ ja, en });
const STUB = corpus.stubRegistry(MV);
const stub = (kind, key) => corpus.allStubParts().find((d) => d.kind === kind && d.key === key);

// Materials are derived parts (package C, parts/mix); here they are hand-made definitions added with REG.extend, as
// parts/mix.registryFor will add them: key 'myMat' + id without the 'm', and `mine` = { id, rhash, cost, by }.
function material(kind, baseKey, id, extra) {
  const def = Object.assign({}, stub(kind, baseKey), { key: 'myMat' + id.slice(1), label: L('素材' + id, 'Material ' + id),
    blurb: L('試験用の素材', 'A test material'), fallback: false, family: 'mine', pool: false,
    mine: { id, rhash: 'r' + id + '0000'.slice(id.length), cost: { ms: 0.3, particles: 0 }, by: 'user' } }, extra || {});
  if (extra && extra.rhash) { def.mine = Object.assign({}, def.mine, { rhash: extra.rhash }); delete def.rhash; }
  return def;
}
const MATS = [
  material('arrive', 'stubFade', 'm1'),
  material('dwell', 'stubBob', 'm2'),
  material('ornament', 'stubRule', 'm3', { scope: 'run', follow: 'own', season: 'spring' }),
  material('ground', 'stubTint', 'm4'),
];

function base(name = 'basic') {
  const doc = clone(corpus.project(name).doc);
  doc.pins = {};
  doc.locks = {};
  return doc;
}

test('a pinned material is chosen like any part, at any scope; a line atmosphere and a work background too', () => {
  const reg = REG.extend(STUB, MATS);
  assert.deepEqual(reg.problems, []);
  const doc = base();
  const p0 = PL.run(doc, reg, null);
  const line = p0.lines[2];
  doc.pins['line/' + line.id + ':arrive'] = { v: 'myMat1', by: 'user' };
  doc.pins['work:dwell'] = { v: 'myMat2', by: 'ai' };
  doc.pins['line/' + line.id + ':atmos'] = { v: 'myMat3', by: 'ai' };
  doc.pins['work:ground'] = { v: 'myMat4', by: 'user' };
  const p = PL.run(doc, reg, null);
  assert.deepEqual(p.warnings.filter((w) => w.code.startsWith('pin') || w.code === 'material-bad'), []);
  for (const c of p.cuts) {
    if (c.line === line.id) assert.deepEqual([c.slots.arrive.v, c.slots.arrive.from], ['myMat1', 'pin:line']);
    if (c.role === 'lyric' || c.role === 'focus') assert.equal(c.slots.dwell.v, 'myMat2');
    const g = p.grounds[c.ground];
    assert.equal(g.ground.v, 'myMat4');
    if (c.line === line.id) assert.equal(g.atmos.v, 'myMat3');
  }
  const e = EX.explain(doc, p, 'cut/' + line.cuts[0] + ':arrive', { registry: reg });
  assert.deepEqual([e.value, e.why], ['myMat1', [{ code: 'pin', params: { scope: 'line', by: 'user' } }]]);
});

test('pool: false materials are never picked automatically; one pool: true material keeps ≥ 90 % of the choices', () => {
  const hidden = REG.extend(STUB, MATS);
  for (const { name, doc } of corpus.corpus(1)) {
    const p = PL.run(doc, hidden, null);
    for (const c of p.cuts) for (const [slot, d] of Object.entries(c.slots)) assert.ok(!String(d.v).startsWith('myMat'), name + ' ' + slot);
    for (const g of p.grounds) assert.ok(!g.ground.v.startsWith('myMat') && !g.atmos.v.startsWith('myMat'), name);
  }
  const SLOTS = ['arrange', 'arrive', 'dwell', 'depart', 'lens', 'ornament#0', 'ornament#1', 'filter#0'];
  let same = 0, total = 0, picked = 0;
  const open = REG.extend(STUB, [material('arrive', 'stubFade', 'm7', { pool: true, tags: ['soft'] })]);
  for (const { doc } of corpus.corpus(1)) {
    const a = PL.run(doc, STUB, null), b = PL.run(doc, open, null);
    b.cuts.forEach((c, i) => {
      for (const s of SLOTS) {
        if (!c.slots[s] && !a.cuts[i].slots[s]) continue;
        total++;
        if ((c.slots[s] || {}).v === (a.cuts[i].slots[s] || {}).v) same++;
      }
      if (c.slots.arrive.v === 'myMat7') picked++;
    });
  }
  assert.ok(picked > 0, 'the pooled material is picked');
  // With the stub catalog an arrive kind has one pooled part besides the new one, so the new part takes about half the
  // entrances; the other slots stay exactly as they were.
  assert.ok(same / total >= 0.9, 'kept ' + (same / total).toFixed(3));
});

test('a body edit changes only the fingerprints of the cuts that use the material and keeps the cast cache warm', () => {
  const doc = base('long');
  const lines = [3, 9, 20].map((i) => PL.run(doc, STUB, null).lines[i].id);
  for (const id of lines) doc.pins['line/' + id + ':arrive'] = { v: 'myMat1', by: 'user' };
  doc.pins['line/' + lines[1] + ':ground'] = { v: 'myMat4', by: 'user' };
  const r1 = REG.extend(STUB, MATS);
  const edited = MATS.map((d) => (d.key === 'myMat1' || d.key === 'myMat4' ? material(d.kind, d.kind === 'arrive' ? 'stubFade' : 'stubTint',
    d.mine.id, { rhash: 'edited00' }) : d));
  const r2 = REG.extend(STUB, edited);
  assert.equal(r2.version, r1.version, 'what the planner reads is unchanged');
  assert.equal(r2.baseVersion, STUB.version);
  const a = PL.plan(doc, { registry: r1 });
  const b = PL.plan(clone(doc), { registry: r2 });
  assert.equal(b.reuse.casts, b.reuse.cuts, 'every cast is reused (same base registry, same version)');
  assert.equal(b.hash, PL.run(clone(doc), r2, { fresh: true }).hash, 'the reused plan is the plan made from scratch');
  a.cuts.forEach((c, i) => {
    const uses = lines.includes(c.line);
    assert.equal(b.cuts[i].fp !== c.fp, uses, c.key + (uses ? ' uses the material' : ' does not'));
  });
  a.grounds.forEach((g, k) => assert.equal(b.grounds[k].fp !== g.fp, g.ground.v === 'myMat4', g.key));
});

test('a meta edit changes the registry version; the shared look term reads the base version', () => {
  const r1 = REG.extend(STUB, MATS);
  const r2 = REG.extend(STUB, MATS.map((d) => (d.key === 'myMat2' ? Object.assign({}, d, { tags: ['bold'] }) : d)));
  assert.notEqual(r2.version, r1.version);
  assert.equal(r2.baseVersion, r1.baseVersion);
  // Documents that use no material plan exactly as with the base registry: same hash, same fingerprints.
  for (const { name, doc } of corpus.corpus(1)) {
    const a = PL.run(doc, STUB, null), b = PL.run(doc, r1, null);
    assert.equal(b.hash, a.hash, name);
  }
});

test('a deleted material gives pin-bad-value and the next rank; material-bad reports what could not be derived', () => {
  const doc = base();
  const p0 = PL.run(doc, STUB, null);
  const line = p0.lines[1];
  doc.pins['line/' + line.id + ':arrive'] = { v: 'myMat1', by: 'user' };
  doc.pins['work:arrive'] = { v: 'stubFade', by: 'user' };
  const p = PL.run(doc, STUB, null);
  assert.ok(p.warnings.some((w) => w.code === 'pin-bad-value' && w.path === 'line/' + line.id + ':arrive'));
  for (const key of line.cuts) {
    const c = p.cuts.find((x) => x.key === key);
    assert.deepEqual([c.slots.arrive.v, c.slots.arrive.from], ['stubFade', 'pin:work']);
  }
  const bad = Object.assign({}, MATS[1], { key: 'myMat9', mine: { id: 'm9', rhash: 'x', by: 'ai' }, blurb: null });
  // parts/mix registryFor's texts (NOTES ## v2.1-C): '<kind>/<key>: <first fatal code>', '<kind>/?: …' for an entry
  // without a usable id, and 'ground/<myMed key>: media-key' (not a material); REG.extend's own message for myMat9.
  const reg = REG.extend(STUB, MATS.concat([bad]), { problems: ['arrive/myMat5: rv-newer', 'ornament/myMatb: cost',
    '?/?: bad-entry', 'ground/myMed0123456789: media-key'] });
  const q = PL.run(base(), reg, null);
  const mb = q.warnings.filter((w) => w.code === 'material-bad');
  assert.deepEqual(mb, [
    { code: 'material-bad', detail: { code: 'rv-newer', id: 'm5' } },
    { code: 'material-bad', detail: { code: 'cost', id: 'mb' } },
    { code: 'material-bad', detail: { code: 'bad-entry', id: '' } },
    { code: 'material-bad', detail: { code: 'def', id: 'm9' } },
  ]);
  assert.equal(PL.run(base(), STUB, null).warnings.filter((w) => w.code === 'material-bad').length, 0, 'a base registry reports none');
});

test('matTerms: the material hash is in the fingerprint of the scenes that use it (cut and ground)', () => {
  const doc = base();
  const p0 = PL.run(doc, STUB, null);
  const line = p0.lines[2];
  doc.pins['line/' + line.id + ':dwell'] = { v: 'myMat2', by: 'user' };
  doc.pins['work:atmos'] = { v: 'myMat3', by: 'user' };
  const fps = (mats) => {
    const p = PL.run(doc, REG.extend(STUB, mats), { fresh: true });
    return { cuts: p.cuts.map((c) => c.fp), grounds: p.grounds.map((g) => g.fp), p };
  };
  const a = fps(MATS);
  const b = fps(MATS.map((d) => (d.key === 'myMat2' ? Object.assign({}, d, { mine: Object.assign({}, d.mine, { rhash: 'other000' }) }) : d)));
  const c = fps(MATS.map((d) => (d.key === 'myMat3' ? Object.assign({}, d, { mine: Object.assign({}, d.mine, { rhash: 'other000' }) }) : d)));
  a.p.cuts.forEach((cut, i) => {
    assert.equal(b.cuts[i] !== a.cuts[i], cut.line === line.id, cut.key + ' (dwell material)');
    assert.equal(c.cuts[i], a.cuts[i], cut.key + ' (the atmosphere is the ground scene\'s)');
  });
  a.p.grounds.forEach((g, k) => {
    assert.equal(b.grounds[k], a.grounds[k], g.key);
    assert.notEqual(c.grounds[k], a.grounds[k], g.key + ' atmosphere material');
  });
});
