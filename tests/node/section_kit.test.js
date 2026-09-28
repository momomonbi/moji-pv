/* 文字PVメーカー v2 — original work. Tests: song parts and their sets of looks — 「パートごとに演出をそろえる」, and 「くり返しの行をそろえる」 on by default in new works (DESIGN_2_2 §2.3–§2.4). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const D = MV.use('core/doc');
const PL = MV.use('planner/plan');
const CA = MV.use('planner/cast');
const EX = MV.use('planner/explain');
const RU = MV.use('planner/rules');
const KIT = MV.use('planner/kit');
const PINS = MV.use('core/pins');
const R = MV.use('core/rng');
const CAT = MV.use('parts/catalog').defaultRegistry();

const clone = (x) => JSON.parse(JSON.stringify(x));
const ON = (v) => ({ v, by: 'user' });
const P2 = ['pv.rules', 'repeat.same', 'pv.kit', 'pv.alternate', 'pv.arc', 'pv.fxCap', 'pv.fxMax'];
const KINDS = ['arrange', 'arrive', 'dwell', 'depart', 'lens'];

// The other packages' switches off (DESIGN_2_2 §2.8 OTHER_OFF): a new work that differs from an older one by P2 alone.
const OTHER_OFF = Object.freeze(Object.fromEntries(RU.ROWS.filter((r) => !P2.includes(r.slot) && r.off !== null)
  .map((r) => ['work:' + r.slot, ON(r.off)])));

// A new work (generation 1) made of a fixture document, without its 「くり返しの行をそろえる」 pin unless kept.
function gen1(doc, pins, keepRepeat) {
  const out = clone(doc);
  out.look.gen = D.GEN;
  if (!keepRepeat) delete out.pins['work:repeat.same'];
  out.pins = Object.assign({}, out.pins, OTHER_OFF, pins || {});
  return out;
}

function fresh(doc) { return PL.run(doc, CAT, { fresh: true }); }
function kitsOf(p) { return p.pv.kits.filter((k) => k.primary).map((k) => JSON.stringify(k)).sort(); }
function keyOf(p, cut) { const x = p.pv.parts.get(cut.key); return x ? x.key : null; }
function famOf(kind, v) { const d = CAT.get(kind, v); return d ? d.family || d.key : v; }

// A document without '#' headings: pseudo sections from its blank-line blocks.
function noHeadings(doc) {
  const out = clone(doc);
  out.sheet.rows = out.sheet.rows.filter((r) => !/^\s*#/.test(r.src));
  return out;
}

function insertRows(doc, at, srcs) {
  const out = clone(doc);
  const rows = out.sheet.rows.slice();
  const add = srcs.map((src) => ({ id: 'r' + (out.sheet.next++).toString(36), src }));
  rows.splice(at, 0, ...add);
  out.sheet.rows = rows;
  return out;
}

// --- parts and their keys -----------------------------------------------------------------------------------------

test('parts: section kinds, heading rows, blank-line blocks, and a neutral song', () => {
  // the repeat fixture: several kinds of heading; every サビ run shares the key 'chorus'
  const rep = fresh(gen1(corpus.project('repeat').doc));
  const keys = new Set([...rep.pv.parts.values()].map((x) => x.key));
  assert.ok(keys.has('chorus') && keys.has('verse'), [...keys].join());
  const chorusRuns = new Set([...rep.pv.parts.entries()].filter(([, x]) => x.key === 'chorus').map(([k]) => k));
  assert.ok(chorusRuns.size > 4);
  assert.equal(rep.pv.kits.filter((k) => k.key === 'chorus').length, 1, 'one set for every サビ');
  // the long fixture: one kind (番 headings) → one key per heading row, 'h' + its row id
  const longDoc = gen1(corpus.project('long').doc);
  const lp = fresh(longDoc);
  const heads = longDoc.sheet.rows.filter((r) => /^\s*#/.test(r.src)).map((r) => 'h' + r.id);
  const lk = [...new Set([...lp.pv.parts.values()].map((x) => x.key))];
  assert.ok(lk.length >= 3 && lk.every((k) => heads.includes(k)), lk.join() + ' vs ' + heads.join());
  // the basic fixture without its headings: pseudo sections 'b' + row id, the block that comes back is the chorus
  const bdoc = gen1(noHeadings(corpus.project('basic').doc));
  const bp = fresh(bdoc);
  assert.equal(bp.pv.pseudo, true);
  const bk = [...new Set([...bp.pv.parts.values()].map((x) => x.key))];
  assert.ok(bk.every((k) => /^b[a-z0-9]+$/.test(k) && bdoc.sheet.rows.some((r) => 'b' + r.id === k)), bk.join());
  // no headings and no blank rows: one group, neutral (the arc does nothing, the kit still works)
  const flat = gen1(noHeadings(corpus.project('basic').doc));
  flat.sheet.rows = flat.sheet.rows.filter((r) => r.src.trim() !== '');
  const fp = fresh(flat);
  assert.equal(fp.pv.neutral, true);
  assert.equal(new Set([...fp.pv.parts.values()].map((x) => x.key)).size, 1);
  assert.ok([...fp.pv.parts.values()].every((x) => x.drive === 0.5 && x.kind === null));
  // every key is a valid salt key
  for (const k of [...keys, ...lk, ...bk]) assert.doesNotThrow(() => MV.use('core/paths').scopeKey('work:kit.' + k));
});

test('drive: verses calmer, choruses stronger, the last chorus strongest, a hold before a chorus', () => {
  const p = fresh(gen1(corpus.project('repeat').doc));
  const parts = [...p.pv.parts.values()];
  const verse = parts.filter((x) => x.kind === 'verse' && !x.tame);
  const chorus = parts.filter((x) => x.kind === 'chorus' && !x.peak);
  const peak = parts.filter((x) => x.peak);
  assert.ok(verse.length && chorus.length && peak.length && parts.some((x) => x.tame));
  const max = (l) => Math.max(...l.map((x) => x.drive)), min = (l) => Math.min(...l.map((x) => x.drive));
  assert.ok(max(verse) < min(chorus), 'verse below chorus');
  assert.ok(min(peak) >= 0.9, 'the last chorus');
  assert.ok(parts.filter((x) => x.tame).every((x) => x.drive <= 0.25));
  assert.ok(parts.filter((x) => x.head).every((x) => x.kind === 'chorus' && x.drive >= 0.85));
});

test('part keys and kits stay where nothing about their part changed', () => {
  const R0 = corpus.project('repeat').doc;
  const base = gen1(R0);
  const p0 = fresh(base);
  // (a) a line inserted anywhere leaves every kit identical
  for (const at of [3, 12, 25, base.sheet.rows.length - 1]) {
    const p1 = fresh(insertRows(base, at, ['ひとこと増やした行']));
    assert.deepEqual(kitsOf(p1), kitsOf(p0), 'insert at ' + at);
  }
  // (b) a new block at the top of a document without headings: every other group keeps its key and kit
  const nb = gen1(noHeadings(corpus.project('basic').doc));
  const q0 = fresh(nb);
  const q1 = fresh(insertRows(nb, 0, ['まったく新しい行', 'もう一つの新しい行', '']));
  // (the label's n is a display ordinal of the block, 「まとまり{n}」, never a key)
  const noLabel = (k) => JSON.stringify(Object.assign({}, k, { label: null }));
  const before = new Map(q0.pv.kits.map((k) => [k.key, noLabel(k)]));
  const after = new Map(q1.pv.kits.map((k) => [k.key, noLabel(k)]));
  for (const [k, v] of before) assert.equal(after.get(k), v, 'group ' + k);
  assert.equal(after.size, before.size + 1, 'the new block is a group of its own');
  for (const c of q0.cuts) {
    const d = q1.cuts.find((x) => x.key === c.key);
    if (d && keyOf(q0, c)) assert.equal(keyOf(q1, d), keyOf(q0, c), c.key + ' keeps its part');
  }
  // (c) splitting a block keeps the original group's key for its first half
  const firstBlank = nb.sheet.rows.findIndex((r, i) => i > 2 && r.src.trim() === '');
  const split = fresh(insertRows(nb, Math.max(1, Math.floor(firstBlank / 2)), ['']));
  const firstLine = q0.cuts.find((c) => c.role === 'lyric');
  assert.equal(keyOf(split, split.cuts.find((c) => c.key === firstLine.key)), keyOf(q0, firstLine));
  // (d) a 番 heading inserted into the long fixture leaves the other runs' keys
  const L0 = gen1(corpus.project('long').doc);
  const l0 = fresh(L0);
  const at = L0.sheet.rows.findIndex((r, i) => i > 20 && /^\s*#/.test(r.src));
  const l1 = fresh(insertRows(L0, at + 3, ['# 3番']));
  const moved = l0.cuts.filter((c) => keyOf(l0, c) && l1.cuts.some((d) => d.key === c.key && keyOf(l1, d) !== keyOf(l0, c)));
  const inserted = new Set(l1.cuts.filter((c) => keyOf(l1, c) && !l0.pv.kits.some((k) => k.key === keyOf(l1, c))).map((c) => c.key));
  assert.ok(moved.every((c) => inserted.has(c.key)), 'only the cuts under the new heading change their key');
  // (e) a reroll of one part's set changes that set only
  const salted = clone(base);
  salted.salts = Object.assign({}, salted.salts, { 'work:kit.chorus': 1 });
  const s1 = fresh(salted);
  const k0 = new Map(p0.pv.kits.map((k) => [k.key, JSON.stringify(k)]));
  for (const k of s1.pv.kits) {
    if (k.key === 'chorus') assert.notEqual(JSON.stringify(k), k0.get('chorus'), 'the rerolled set');
    else assert.equal(JSON.stringify(k), k0.get(k.key), k.key);
  }
});

// --- the signature of a part (DESIGN_2_2 §2.4) ---------------------------------------------------------------------

// basic, long and repeat × 2 aspects × 3 seeds × 4 moods, new works without the repeat pin.
const MOODS = ['quietHush', 'popFizz', 'glitchFracture', 'heartAche'];
function kitDocs() {
  const out = [];
  for (const name of ['basic', 'long', 'repeat']) {
    for (const aspect of ['16:9', '9:16']) {
      for (let s = 0; s < 3; s++) {
        for (const mood of MOODS) {
          const doc = gen1(corpus.project(name).doc, { 'work:mood': ON(mood) });
          doc.look = Object.assign({}, doc.look, { seed: corpus.seedOf('kit', name, aspect, s), aspect });
          out.push({ name: name + '@' + aspect + '#' + s + '/' + mood, doc });
        }
      }
    }
  }
  return out;
}

// The top-2 family coverage per part (the share of a part's automatic picks whose family is one of the part's two
// most used ones), and the share of identical neighbours, per kind, over the plans of mod(doc).
function signature(mod) {
  const cov = {}, tot = {}, adj = {}, adjN = {};
  for (const k of KINDS) { cov[k] = 0; tot[k] = 0; adj[k] = 0; adjN[k] = 0; }
  for (const { doc } of kitDocs()) {
    const keys = fresh(doc).pv.parts;
    const p = fresh(mod(clone(doc)));
    const byPart = new Map();
    let prev = null;
    for (const c of p.cuts) {
      const part = keys.get(c.key);
      if (!part) { prev = null; continue; }
      for (const k of KINDS) {
        const d = c.slots[k];
        if (!d || d.v === 'none' || d.from !== 'auto') continue;
        const id = part.key + '|' + k;
        if (!byPart.has(id)) byPart.set(id, []);
        byPart.get(id).push(famOf(k, d.v));
        const pd = prev ? prev.slots[k] : null;
        if (pd && pd.v !== 'none') { adjN[k]++; if (pd.v === d.v) adj[k]++; }
      }
      prev = c;
    }
    for (const [id, list] of byPart) {
      const k = id.split('|')[1];
      const n = new Map();
      for (const f of list) n.set(f, (n.get(f) || 0) + 1);
      cov[k] += [...n.values()].sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0);
      tot[k] += list.length;
    }
  }
  const out = {};
  for (const k of KINDS) out[k] = { cov: 100 * cov[k] / tot[k], adj: 100 * adj[k] / Math.max(1, adjN[k]) };
  return out;
}

let sigCache = null;
function signatures() {
  if (!sigCache) {
    sigCache = {
      on: signature((d) => d),
      off: signature((d) => Object.assign(d, { pins: Object.assign({}, d.pins, { 'work:pv.kit': ON(false) }) })),
      legacy: signature((d) => Object.assign(d, { pins: Object.assign({}, d.pins, { 'work:pv.rules': ON(false) }) })),
    };
  }
  return sigCache;
}

// Measured (NOTES "PV22 P2"): top-2 coverage on / off: arrange 68 / 39, arrive 61 / 34, dwell 68 / 51, depart 66 / 42,
// lens 72 / 49 %. Floors: the measurement − 5 points; dwell's margin is 15 points, not 20 (its pool is small and gated
// by the layout, and the ×0.03 against the previous value keeps its primary from repeating; NOTES).
const FLOOR = { arrange: 63, arrive: 55, dwell: 62, depart: 61, lens: 67 };
const MARGIN = { arrange: 20, arrive: 20, dwell: 15, depart: 8, lens: 20 };
test('the set of looks gives each part a visible signature (top-2 family coverage, on vs off)', (t) => {
  const { on, off } = signatures();
  t.diagnostic('coverage on/off: ' + KINDS.map((k) => k + ' ' + on[k].cov.toFixed(1) + '/' + off[k].cov.toFixed(1)).join(', '));
  for (const k of KINDS) {
    assert.ok(on[k].cov >= FLOOR[k], k + ' coverage ' + on[k].cov.toFixed(1) + ' < ' + FLOOR[k]);
    assert.ok(on[k].cov - off[k].cov >= MARGIN[k], k + ' margin ' + (on[k].cov - off[k].cov).toFixed(1));
  }
});

test('neighbours still differ: no identical layouts or entrances, holds and camera textures as before', (t) => {
  const { on, legacy } = signatures();
  t.diagnostic('identical neighbours on/legacy: ' + KINDS.map((k) => k + ' ' + on[k].adj.toFixed(2) + '/' + legacy[k].adj.toFixed(2)).join(', '));
  assert.equal(on.arrange.adj, 0);
  assert.equal(on.arrive.adj, 0);
  assert.ok(on.dwell.adj <= legacy.dwell.adj + 0.5, 'dwell');
  assert.ok(on.lens.adj <= legacy.lens.adj + 0.5, 'lens');
  assert.ok(on.depart.adj <= legacy.depart.adj + 1, 'depart');
});

test('every kind still uses most of its parts over the corpus', () => {
  const used = {}, eligible = {};
  for (const k of KINDS) { used[k] = new Set(); eligible[k] = new Set(); }
  for (const { doc } of corpus.corpus(6)) {
    const p = fresh(gen1(doc));
    for (const c of p.cuts) for (const k of KINDS) if (c.slots[k] && c.slots[k].v !== 'none') used[k].add(c.slots[k].v);
  }
  for (const { doc } of corpus.corpus(6)) {
    const p = fresh(gen1(doc, { 'work:pv.rules': ON(false) }));
    for (const c of p.cuts) for (const k of KINDS) if (c.slots[k] && c.slots[k].v !== 'none') eligible[k].add(c.slots[k].v);
  }
  for (const k of KINDS) {
    const share = [...eligible[k]].filter((x) => used[k].has(x)).length / eligible[k].size;
    assert.ok(share >= 0.6, k + ' ' + share.toFixed(2));
  }
});

// サビ1 and サビ2 draw from the same set even where 「くり返しの行をそろえる」 is off: the family of a repeat matches its first
// copy's more often than without the set.
test('サビ2 looks like サビ1: one set, and repeats match their first copy more often', (t) => {
  const match = (mod) => {
    const n = { arrange: [0, 0], arrive: [0, 0] };
    for (const aspect of ['16:9', '9:16']) {
      for (let s = 0; s < 6; s++) {
        for (const mood of MOODS) {
          const doc = gen1(corpus.project('repeat').doc, { 'work:repeat.same': ON(false), 'work:mood': ON(mood) });
          doc.look = Object.assign({}, doc.look, { seed: corpus.seedOf('sabi', aspect, s), aspect });
          const p = fresh(mod(doc));
          const byKey = new Map(p.cuts.map((c) => [c.key, c]));
          for (const c of p.cuts) {
            const src = c.feat.repeatOf ? byKey.get(c.feat.repeatOf) : null;
            if (!src) continue;
            for (const k of Object.keys(n)) {
              if (!c.slots[k] || !src.slots[k] || c.slots[k].from !== 'auto') continue;
              n[k][1]++;
              if (famOf(k, c.slots[k].v) === famOf(k, src.slots[k].v)) n[k][0]++;
            }
          }
        }
      }
    }
    return Object.fromEntries(Object.entries(n).map(([k, [a, b]]) => [k, 100 * a / b]));
  };
  const on = match((d) => d);
  const off = match((d) => Object.assign(d, { pins: Object.assign({}, d.pins, { 'work:pv.kit': ON(false) }) }));
  t.diagnostic('repeat family match on/off: arrange ' + on.arrange.toFixed(1) + '/' + off.arrange.toFixed(1) + ', arrive ' +
    on.arrive.toFixed(1) + '/' + off.arrive.toFixed(1));
  assert.ok(on.arrange - off.arrange >= 8, 'arrange');
  assert.ok(on.arrive - off.arrive >= 8, 'arrive');
});

// --- 「くり返しの行をそろえる」 by default -----------------------------------------------------------------------------

test('a new work repeats its lines the same way without a pin; a pin or the group switch turns it off', () => {
  const legacy = corpus.project('repeat').doc;                     // pins work:repeat.same on
  const lp = fresh(legacy);
  const want = CA.alignments({ ix: PINS.index(legacy.pins) }, lp.cuts);
  const doc = gen1(legacy);
  assert.equal(doc.pins['work:repeat.same'], undefined);
  const p = fresh(doc);
  const got = CA.alignments({ ix: PINS.index(doc.pins), doc }, p.cuts);
  assert.deepEqual([...got.keys()].sort(), [...want.keys()].sort(), 'the same cuts align as with the pin');
  assert.ok(got.size > 5);
  // the stub context of ai/direct before PV22 (no document): the v2.1 opt-in, off without a pin
  assert.equal(CA.alignments({ ix: PINS.index(doc.pins) }, p.cuts), null);
  // a line pin false keeps that line its own
  const line = p.cuts.find((c) => got.has(c.key)).line;
  const own = gen1(legacy, { ['line/' + line + ':repeat.same']: ON(false) });
  const g2 = CA.alignments({ ix: PINS.index(own.pins), doc: own }, fresh(own).cuts);
  assert.ok(![...g2.keys()].some((k) => k.startsWith(line + '~')) && g2.size > 0);
  // the group switch off: nothing aligns (and ctx.rules says so)
  const off = gen1(legacy, { 'work:pv.rules': ON(false) });
  assert.equal(CA.alignments({ ix: PINS.index(off.pins), doc: off }, fresh(off).cuts), null);
  // why: the repeat's parts say they were taken from the first copy
  const cut = p.cuts.find((c) => got.has(c.key) && c.slots.arrange.v === got.get(c.key).slots.arrange.v);
  const why = EX.explain(doc, p, 'cut/' + cut.key + ':arrange', { registry: CAT }).why;
  assert.ok(why.some((w) => w.code === 'repeat.same'), JSON.stringify(why));
});

// --- stability, explain and the cache ------------------------------------------------------------------------------

test('stability in new works: an inserted line keeps the other choices; a reroll moves few part keys', (t) => {
  let same = 0, total = 0;
  for (const { doc } of corpus.corpus(2, ['16:9', '9:16'], ['basic', 'long'])) {
    const d0 = gen1(doc);
    const p0 = fresh(d0);
    const at = Math.floor(d0.sheet.rows.length / 2);
    const p1 = fresh(insertRows(d0, at, ['途中に足した一行']));
    const before = new Map(p0.cuts.map((c) => [c.key, c]));
    for (const c of p1.cuts) {
      const b = before.get(c.key);
      if (!b || !c.line) continue;
      for (const k of KINDS) { total++; if (c.slots[k] && b.slots[k] && c.slots[k].v === b.slots[k].v) same++; }
    }
  }
  t.diagnostic('kept after an insert: ' + (100 * same / total).toFixed(1) + ' %');
  assert.ok(same / total >= 0.97, 'kept ' + (100 * same / total).toFixed(1) + ' %');
  // part keys never follow a reroll (they are content, not choices)
  const d0 = gen1(corpus.project('repeat').doc);
  const p0 = fresh(d0);
  for (const c of p0.cuts.filter((x) => x.line).slice(0, 12)) {
    const d1 = clone(d0);
    d1.salts = Object.assign({}, d1.salts, { ['cut/' + c.key]: 1 });
    const p1 = fresh(d1);
    for (const x of p1.cuts) assert.equal(keyOf(p1, x), keyOf(p0, x));
  }
});

test('explain agrees with the plan for kit-weighted picks and names the set', () => {
  const doc = gen1(corpus.project('repeat').doc, { 'work:pv.arc': ON(false) });
  const p = fresh(doc);
  let named = 0, checked = 0;
  for (const c of p.cuts.filter((x) => x.role === 'lyric').slice(0, 30)) {
    for (const kind of ['arrange', 'arrive']) {
      const d = c.slots[kind];
      if (d.from !== 'auto') continue;
      const tr = PL.trace(doc, { registry: CAT }, { cutKey: c.key, slot: kind });
      assert.equal(tr.plan.hash, p.hash);
      if (!tr.out.candidates) continue;
      checked++;
      const kit = p.pv.kits.find((k) => k.key === p.pv.parts.get(c.key).key);
      for (const cand of tr.out.candidates) {
        const g = KIT.groupOf(kind, CAT.get(kind, cand.key));
        const want = kit.primary[kind] === g ? KIT.KIT_PRIMARY : kit[kind].includes(g) ? KIT.KIT : 1;
        assert.equal(cand.f.pvKit, want, c.key + ' ' + kind + ' ' + cand.key);
      }
      const why = EX.explain(doc, p, 'cut/' + c.key + ':' + kind, { registry: CAT }).why;
      if (why.some((w) => w.code === 'pv.kit')) named++;
    }
  }
  assert.ok(checked > 10 && named > checked / 3, named + ' of ' + checked);
});

// The sets' weights are kept between cached plans (planner/conventions), keyed by the look they read: every mood, with
// and without decorations, on each backdrop and with part filters, re-plans to the plan made from scratch (and the
// sets do change).
test('the sets follow the look in a re-plan: mood, amounts, backdrop and part filters', () => {
  let n = 0, changed = 0;
  for (const name of ['basic', 'repeat']) {
    const base = gen1(corpus.project(name).doc);
    let prev = null;
    CAT.keys('mood').forEach((mood, i) => {
      for (const amt of [0, 1]) {
        const d = clone(base);
        d.pins = Object.assign({}, d.pins, { 'work:mood': ON(mood), 'work:amount.ornament': ON(amt) });
        d.look.backdrop = ['scene', 'chroma', 'black', 'clear'][(i + amt) % 4];
        const p = PL.plan(d, { registry: CAT });
        const f = fresh(d);
        assert.equal(p.hash, f.hash, name + ' ' + mood + ' ' + amt + ' ' + d.look.backdrop);
        const k = JSON.stringify(f.pv.kits);
        if (prev !== null && k !== prev) changed++;
        prev = k;
        n++;
      }
    });
    // the part filters (doc.filters) change the pools and nothing else of the look: deny each set's primary families
    let d = clone(base);
    for (let i = 0; i < 4; i++) {
      const before = fresh(d);
      d = clone(d);
      d.filters = clone(d.filters || {});
      for (const kind of ['arrange', 'arrive', 'depart']) {
        const g = before.pv.kits[0].primary[kind];
        const deny = CAT.keys(kind).filter((key) => KIT.groupOf(kind, CAT.get(kind, key)) === g);
        const f = d.filters[kind] || { only: null, deny: [] };
        d.filters[kind] = { only: null, deny: [...new Set((f.deny || []).concat(deny))].sort() };
      }
      const p = PL.plan(d, { registry: CAT });
      const f = fresh(d);
      assert.equal(p.hash, f.hash, name + ' filters ' + i);
      assert.notDeepEqual(f.pv.kits[0].primary, before.pv.kits[0].primary, 'a denied family leaves the set');
      n++;
    }
  }
  assert.ok(n >= 40 && changed >= n / 4, n + ' plans, the sets changed ' + changed + ' times');
});

// Re-planning a new work from the cast cache gives the plan made from scratch, through the edits P2 adds to the menu:
// a set's die, the switches pinned and cleared, a blank row, a heading, a reroll next to a directional cut; and through
// the look's own edits (mood, theme, season, an amount, the backdrop), which the sets' weights kept between plans read.
test('re-planning a new work after any edit gives exactly the plan made from scratch', () => {
  const SW = ['pv.rules', 'pv.kit', 'pv.alternate', 'pv.arc', 'repeat.same'];
  const LOOK = [['mood', CAT.keys('mood')], ['theme', CAT.keys('theme')], ['season', ['spring', 'summer', 'autumn', 'winter']],
    ['amount.camera', [0, 0.5, 1]], ['amount.ornament', [0, 1]], ['amount.glitch', [0, 1]]];
  const BACKDROPS = ['scene', 'chroma', 'black', 'clear'];
  const edit = (rng, doc, p) => {
    const d = Object.assign({}, doc);
    const cut = rng.pick(p.cuts);
    const r = rng.next();
    if (r < 0.12) {
      const [slot, values] = rng.pick(LOOK);
      d.pins = Object.assign({}, d.pins, { ['work:' + slot]: ON(rng.pick(values)) });
      return d;
    }
    if (r < 0.16) {
      d.look = Object.assign({}, d.look, { backdrop: rng.pick(BACKDROPS) });
      return d;
    }
    if (r < 0.2) {
      const key = rng.pick(p.pv ? p.pv.kits.map((k) => k.key) : ['chorus']);
      d.salts = Object.assign({}, d.salts, { ['work:kit.' + key]: ((d.salts || {})['work:kit.' + key] || 0) + 1 });
    } else if (r < 0.4) {
      d.pins = Object.assign({}, d.pins, { ['work:' + rng.pick(SW)]: ON(rng.chance(0.5)) });
    } else if (r < 0.5) {
      const keys = Object.keys(d.pins).filter((k) => /^work:(pv\.|repeat)/.test(k));
      if (keys.length) { d.pins = Object.assign({}, d.pins); delete d.pins[rng.pick(keys)]; }
    } else if (r < 0.6) {
      const i = rng.int(1, d.sheet.rows.length - 1);
      return insertRows(d, i, [rng.chance(0.5) ? '' : '# サビ']);
    } else if (r < 0.85) {
      const k = rng.pick(['cut/' + cut.key, 'cut/' + cut.key + ':arrive', 'cut/' + cut.key + ':depart', 'line/' + (cut.line || 'x')]);
      d.salts = Object.assign({}, d.salts, { [k]: ((d.salts || {})[k] || 0) + 1 });
    } else {
      const rows = d.sheet.rows.slice();
      const i = rng.int(0, rows.length - 1);
      rows[i] = Object.assign({}, rows[i], { src: rows[i].src + rng.pick(['あ', '!']) });
      d.sheet = Object.assign({}, d.sheet, { rows });
    }
    return d;
  };
  let steps = 0;
  for (const name of ['basic', 'repeat', 'lrc']) {
    const rng = R.stream('pvreplan', name);
    let doc = gen1(corpus.project(name).doc);
    for (let i = 0; i < 24; i++) {
      const p = PL.plan(doc, { registry: CAT });
      assert.equal(p.hash, fresh(doc).hash, name + ' step ' + i);
      steps++;
      doc = edit(rng, doc, p);
    }
  }
  assert.ok(steps >= 72);
});

// The golden of 文字PVの定石 (DESIGN_2_2 §2.10): the repeat fixture as a new work without its pin, the other packages'
// switches off (tests/update_golden.js pvDoc), plans and renders tests/golden/project_pv.json.
test('the 文字PVの定石 golden: a new work of the repeat fixture plans and renders tests/golden/project_pv.json', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const { pvDoc } = require('../update_golden.js');
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'golden', 'project_pv.json'), 'utf8'));
  const doc = pvDoc();
  assert.equal(doc.look.gen, D.GEN);
  assert.equal(doc.pins['work:repeat.same'], undefined);
  for (const r of RU.ROWS) {
    if (!P2.includes(r.slot) && r.off !== null) assert.deepEqual(doc.pins['work:' + r.slot], ON(r.off), r.slot + ' pinned off');
  }
  const { createEngine } = MV.use('engine/facade');
  const { createRecorder } = MV.use('engine/render/record');
  const { fakeMeasurer } = MV.use('engine/text/fake_measure');
  const H = MV.use('core/hash');
  assert.equal(golden.registry.version, CAT.version, 'made with the current catalog');
  const rec = createRecorder();
  const engine = createEngine({ registry: CAT, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null });
  const { plan } = engine.setDoc(doc);
  assert.equal(plan.hash, golden.plan);
  assert.ok(plan.pv && plan.pv.kits.some((k) => k.primary), 'the conventions are on');
  await engine.prepare(0, plan.duration, { export: true });
  const [w, h] = D.DESIGN_SIZE[doc.look.aspect];
  const k = 360 / Math.min(w, h);
  const made = rec.factory.create(Math.round(w * k), Math.round(h * k), { alpha: false });
  const surface = { canvas: made.canvas, ctx: made.ctx, w: Math.round(w * k), h: Math.round(h * k) };
  const frames = [];
  for (let i = 0; i < 40; i++) {
    const before = rec.ops().length;
    engine.renderFrame(surface, (plan.duration * (i + 0.5)) / 40, { quality: 'export', pick: false, scale: surface.w / plan.design.w });
    frames.push(H.hashJSON(rec.ops().slice(before)));
  }
  engine.dispose();
  assert.deepEqual(frames, golden.frames);
});
