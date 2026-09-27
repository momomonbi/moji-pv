/* 文字PVメーカー v2 — original work. Tests: 「くり返しの行をそろえる」 — a line sung again takes its first copy's decisions (DESIGN_2_1 §4.10). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const PL = MV.use('planner/plan');
const CA = MV.use('planner/cast');
const EX = MV.use('planner/explain');
const FI = MV.use('planner/fields');
const PINS = MV.use('core/pins');
const CMD = MV.use('core/commands');
const CAT = MV.use('parts/catalog').defaultRegistry();
const STUB = corpus.stubRegistry(MV);

const clone = (x) => JSON.parse(JSON.stringify(x));
const text = (v) => JSON.stringify(v === undefined ? null : v);
const ON = Object.freeze({ v: true, by: 'user' });
const valueOf = (c, slot) => (c.slots[slot] ? c.slots[slot].v : null);
const whyOf = (doc, p, pathText, reg) => EX.explain(doc, p, pathText, { registry: reg || CAT }).why;
const aligned = (why) => (why || []).find((w) => w.code === 'repeat.same') || null;

function withOptIn(doc, pins, salts) {
  const out = clone(doc);
  out.pins = Object.assign({}, out.pins, { 'work:repeat.same': ON }, pins || {});
  if (salts) out.salts = Object.assign({}, out.salts, salts);
  return out;
}

// The source of every aligned cut of a plan (planner/cast alignments, as plan.run makes it).
function sourcesOf(doc, p) { return CA.alignments({ ix: PINS.index(doc.pins) }, p.cuts) || new Map(); }

// The cut slots the opt-in aligns, and the part slots among them (their parameters are compared too).
const SLOTS = ['orient', 'arrange', 'text.face', 'text.scale', 'text.ink', 'text.style', 'motion.speed', 'arrive', 'dwell', 'depart',
  'ornament.count', 'ornament#0', 'ornament#1', 'ornament#2', 'lens', 'cam.shot', 'cam.zoom', 'cam.curve', 'cam.follow', 'filter.count',
  'filter#0', 'filter#1', 'filter#2'];
const PARTS = new Set(['arrange', 'arrive', 'dwell', 'depart', 'ornament#0', 'ornament#1', 'ornament#2', 'lens', 'filter#0', 'filter#1',
  'filter#2']);

// --- documents ------------------------------------------------------------------------------------------------------

const SAMPLE = (() => {
  const LY = MV.use('core/lyrics');
  const rows = LY.SAMPLE_JA.split('\n');
  const sabi = rows.slice(rows.indexOf('# サビ'), rows.indexOf('# Bメロ'));
  const dai = rows.slice(rows.indexOf('# 大サビ'));
  const before = rows.slice(0, rows.indexOf('# 大サビ'));
  // L1: a second サビ before the 大サビ; L2: the same with the サビ's first line sung twice at the start of the 大サビ;
  // L3: L1 with a short line sung twice at the end of each サビ.
  const twiceEnd = (block) => block.filter((r) => r.trim()).concat(['まっすぐに', 'まっすぐに', '']);
  const firstSabi = rows.indexOf('# サビ');
  return {
    L1: before.concat(sabi, dai),
    L2: before.concat(sabi, [dai[0], dai[1]], dai.slice(1)),
    L3: rows.slice(0, firstSabi).concat(twiceEnd(sabi), rows.slice(rows.indexOf('# Bメロ'), rows.indexOf('# 大サビ')), twiceEnd(sabi), dai),
  };
})();

// The sample lyrics (L1, L2, L3) without a song, 3 aspects × 2 seeds × 4 moods, with the opt-in for the whole video.
function sampleDocs(moods = ['quietHush', 'dashSprint', 'popFizz', 'printColumn'], seeds = 2) {
  const out = [];
  for (const [ln, rows] of Object.entries(SAMPLE)) {
    for (const aspect of ['16:9', '9:16', '1:1']) {
      for (const mood of moods) {
        for (let s = 0; s < seeds; s++) {
          const doc = corpus.project('basic').doc;
          doc.sheet = { next: rows.length + 1, rows: rows.map((src, i) => ({ id: 'r' + (i + 1).toString(36), src })) };
          doc.song = {};
          doc.look = Object.assign({}, doc.look, { seed: corpus.seedOf('rs', ln, aspect, mood, s), moodSeed: corpus.seedOf('rsm', ln, aspect, mood, s),
            aspect });
          doc.pins = { 'work:mood': { v: mood, by: 'user' } };
          out.push({ name: ln + '@' + aspect + '/' + mood + '#' + s, doc: withOptIn(doc) });
        }
      }
    }
  }
  return out;
}

// Every third lyric row sung twice in a row (camera_planner's doubled()).
function doubled(doc) {
  const out = clone(doc);
  const rows = [];
  let k = 0;
  for (const r of out.sheet.rows) {
    rows.push(r);
    if (r.src.trim() && !/^\s*(#|\[(ti|ar):)/.test(r.src) && k++ % 3 === 0) rows.push({ id: 'r' + (out.sheet.next++).toString(36), src: r.src });
  }
  out.sheet.rows = rows;
  return out;
}

function corpusDocs(seeds = 2) {
  return corpus.corpus(seeds).map(({ name, doc }) => ({ name, doc: withOptIn(doc) }))
    .concat(corpus.corpus(1, undefined, ['basic', 'long']).map(({ name, doc }) => ({ name: name + '×2', doc: withOptIn(doubled(doc)) })));
}

// --- the sources ----------------------------------------------------------------------------------------------------

test('alignments: a copy takes the line at its place in the first run of that line; the same text, role and impact', () => {
  // lines: a (2 cuts), b, a' (a again), c, c' (c twice in a row), a'', d, c'', c''', c'''' (c three times: past the first run)
  const L = (line, n, text, extra) => Array.from({ length: n }, (_, i) => Object.assign({ key: line + '~' + i * 3, line, text: text + i,
    role: 'lyric', impact: false, feat: { repeatOf: null } }, extra));
  const cuts = [].concat(L('ra', 2, 'A'), L('rb', 1, 'B'), L('rc', 2, 'A'), L('rd', 1, 'C'), L('re', 1, 'C'), L('rf', 2, 'A'),
    L('rg', 1, 'D'), L('rh', 1, 'C'), L('ri', 1, 'C'), L('rj', 1, 'C'), [{ key: 'outro', line: null, text: '', role: 'outro', feat: { repeatOf: null } }]);
  const rep = { rc: 'ra', re: 'rd', rf: 'ra', rh: 'rd', ri: 'rd', rj: 'rd' };
  for (const c of cuts) if (rep[c.line]) c.feat.repeatOf = rep[c.line] + c.key.slice(2);
  const map = (pins, list = cuts) => {
    const m = CA.alignments({ ix: PINS.index(pins) }, list);
    return m ? Object.fromEntries([...m].map(([k, v]) => [k, v.key])) : null;
  };
  assert.equal(map({}), null, 'no pin: nothing to align');
  assert.deepEqual(map({ 'work:repeat.same': ON }), {
    'rc~0': 'ra~0', 'rc~3': 'ra~3', 'rf~0': 'ra~0', 'rf~3': 'ra~3', // a copy sung alone: its first copy
    'rh~0': 'rd~0', 'ri~0': 're~0', // a later run of c: its first and second copies; re, the first run's second, is its own
  }, 'rj (past the end of the first run) keeps its own look');
  assert.deepEqual(map({ 'work:repeat.same': ON, 'line/rf:repeat.same': { v: false, by: 'user' } }), {
    'rc~0': 'ra~0', 'rc~3': 'ra~3', 'rh~0': 'rd~0', 'ri~0': 're~0' }, 'a line pin false keeps that line its own');
  assert.deepEqual(map({ 'line/rh:repeat.same': ON }), { 'rh~0': 'rd~0' }, 'a line pin alone aligns that line');
  assert.deepEqual(map({ 'work:repeat.same': { v: 'yes', by: 'user' } }), {}, 'only a boolean switches it on');
  // Another split (no cut at that offset, or other words), another role or another impact mark keep the cut's own look.
  const other = clone(cuts);
  other.find((c) => c.key === 'rc~3').text = 'X';
  other.find((c) => c.key === 'rf~0').role = 'focus';
  other.find((c) => c.key === 'rf~3').impact = true;
  other.find((c) => c.key === 'rh~0').key = 'rh~2';
  assert.deepEqual(map({ 'work:repeat.same': ON }, other), { 'rc~0': 'ra~0', 'ri~0': 're~0' });
});

test('documents without the opt-in are planned as before: no source, no slot, the same plan with a false pin but the slot', () => {
  for (const { name, doc } of corpus.corpus(1, undefined, ['long', 'vertical'])) {
    const p = PL.run(doc, CAT, null);
    assert.equal(CA.alignments({ ix: PINS.index(doc.pins) }, p.cuts), null, name);
    assert.ok(p.cuts.every((c) => !('repeat.same' in c.slots)), name + ': no slot without the pin');
    const off = clone(doc);
    off.pins['work:repeat.same'] = { v: false, by: 'user' };
    const q = PL.run(off, CAT, null);
    assert.ok(q.cuts.every((c) => text(c.slots['repeat.same']) === text({ v: false, from: 'pin:work', by: 'user' })), name);
    const strip = (x) => x.cuts.map((c) => Object.assign({}, c.slots, { 'repeat.same': undefined }));
    assert.equal(text(strip(q)), text(strip(p)), name + ': off plans the same cuts');
    assert.equal(text(q.grounds.map((g) => [g.ground, g.atmos])), text(p.grounds.map((g) => [g.ground, g.atmos])), name);
  }
});

// The measure the owner asked for: with the opt-in on, a repeat shows its first copy's layout, lens, shot and curve (and
// the other slots) in ≥ 95 % of the repeats where the pieces fit, that is, every repeat that has a source (a cut at its
// place in the first run with the same words, role and impact mark, alignments). Measured: every slot of every aligned
// cut but a few curves (a pullReveal on a cut under 1.8 s whose source is longer takes hushRushHush), shots (a source's
// shot the cut's own rules do not allow: a short cut, a move that needs more time) and layouts or entrances the cut
// right before already shows (§8.2; such a slot does not fit there, and the rest of that cut follows its own layout);
// the exceptions and why are printed.
// Of the repeats without a source: another split of the line (other words in the cut), the first run's own copies of a
// line sung twice in a row, and copies past the end of the first run.
test('with the opt-in on, repeats take their first copy\'s decisions wherever they fit (≥ 95 % of every slot)', (t) => {
  for (const [rn, reg, docs] of [['catalog', CAT, sampleDocs().concat(corpusDocs(2))], ['stub', STUB, corpusDocs(1)]]) {
    const same = Object.fromEntries(SLOTS.map((s) => [s, 0]));
    const nearby = Object.fromEntries(SLOTS.map((s) => [s, 0]));   // §8.2: the neighbour already shows it (no fit there)
    const why = new Map();
    let n = 0, repeats = 0, params = 0, paramsSame = 0, segs = 0, segsSame = 0, seams = 0, seamsSame = 0;
    const off = { text: 0, role: 0, impact: 0, run: 0, other: 0 };
    for (const { name, doc } of docs) {
      const p = PL.run(doc, reg, null);
      const src = sourcesOf(doc, p);
      const byKey = new Map(p.cuts.map((c, i) => [c.key, i]));
      // the line each line sings (its first copy's), and the line sung right before it
      const sings = (line) => { const c = p.cuts[byKey.get(line.cuts[0])]; return c.feat.repeatOf ? c.feat.repeatOf.split('~')[0] : line.id; };
      const lines = p.lines.filter((l) => l.cuts.length);
      const inRun = new Set(lines.filter((l, k) => k > 0 && sings(lines[k - 1]) === sings(l)).map((l) => l.id));
      p.cuts.forEach((c, i) => {
        if (c.feat.repeatOf) {
          repeats++;
          if (!src.has(c.key)) {
            const o = p.cuts[byKey.get(c.feat.repeatOf)];
            if (o.text !== c.text) off.text++; else if (o.role !== c.role) off.role++; else if (!!o.impact !== !!c.impact) off.impact++;
            else if (inRun.has(c.line)) off.run++;
            else off.other++;
          }
        }
        const s = src.get(c.key);
        if (!s) return;
        const o = p.cuts[byKey.get(s.key)];
        n++;
        for (const slot of SLOTS) {
          if (text(valueOf(c, slot)) === text(valueOf(o, slot))) { same[slot]++; continue; }
          const clash = (slot === 'arrange' || slot === 'arrive') && i > 0 && text(valueOf(p.cuts[i - 1], slot)) === text(valueOf(o, slot));
          const reason = clash ? 'the cut right before already shows the ' + (slot === 'arrange' ? 'layout' : 'entrance') + ' (§8.2)'
            : valueOf(c, 'arrange') !== valueOf(o, 'arrange') ? 'another layout (§8.2)'
            : slot === 'cam.curve' && valueOf(c, 'cam.shot') === 'pullReveal' && c.feat.dur < 1.8 ? 'a short pull (hushRushHush)'
            : slot === 'cam.shot' ? 'a shot the cut\'s own rules leave out (' + text(valueOf(o, slot)) + ', ' + c.feat.dur.toFixed(2) + ' s)'
              : slot.startsWith('cam.') && valueOf(c, 'cam.shot') !== valueOf(o, 'cam.shot') ? 'another shot'
                : (slot === 'arrive' || slot === 'depart') && (c.slots[slot].from === 'rule' || o.slots[slot].from === 'rule')
                  ? 'the transition at the edge of the repeated lines takes over the ' + (slot === 'arrive' ? 'entrance' : 'exit')
                  : 'other: ' + name + ' ' + c.key + ' ' + slot;
          why.set(reason, (why.get(reason) || 0) + 1);
          if (reason.endsWith('(§8.2)')) nearby[slot]++;
        }
        for (const slot of PARTS) {
          const a = c.slots[slot], b = o.slots[slot];
          if (!a || !b || a.v !== b.v || !a.p) continue;
          params++;
          if (text(a.p) === text(b.p)) paramsSame++;
        }
        // the background of a segment that begins at an aligned cut whose source begins one, and the seam into the cut
        const head = (x) => p.grounds[x.ground].cuts[0] === x.key;
        if (head(c) && head(o)) { segs++; if (text(p.grounds[c.ground].ground) === text(p.grounds[o.ground].ground)) segsSame++; }
        const seamOf = (x) => (x.seamIn >= 0 ? p.seams[x.seamIn].slot.v : 'hard');
        if (i > 0 && byKey.get(o.key) > 0) { seams++; if (seamOf(c) === seamOf(o)) seamsSame++; }
      });
    }
    const low = SLOTS.filter((s) => same[s] < 0.95 * (n - nearby[s]));
    assert.equal(off.other, 0, rn + ': repeats without a source for no stated reason');
    t.diagnostic(rn + ': ' + n + ' aligned cuts of ' + repeats + ' repeats (without a source: other words ' + off.text + ', role ' +
      off.role + ', impact ' + off.impact + ', a line sung again right after a copy of it ' + off.run + '); the same as the source: ' +
      SLOTS.map((s) => s + ' ' + (100 * same[s] / n).toFixed(1) + ' %').join(', ') + '; parameters ' + paramsSame + ' / ' + params +
      '; backgrounds ' + segsSame + ' / ' + segs + '; transitions ' + seamsSame + ' / ' + seams + '; exceptions: ' +
      [...why].map(([k, v]) => k + ' ×' + v).join('; '));
    assert.ok(n > (rn === 'catalog' ? 1500 : 400), rn + ' aligned cuts ' + n);
    assert.deepEqual(low, [], rn + ': slots under 95 %');
    // §8.2 exceptions are rare with the catalog; the stub has two layouts, so one clash shifts the rest of its line.
    if (rn === 'catalog') assert.ok(nearby.arrange + nearby.arrive < 0.01 * n, rn + ' §8.2 exceptions ' + nearby.arrange + ' + ' + nearby.arrive);
    assert.equal(paramsSame, params, rn + ' parameters');
    assert.ok(segs > 50 && segsSame === segs, rn + ' backgrounds ' + segsSame + ' / ' + segs);
    assert.ok(seamsSame >= 0.95 * seams, rn + ' transitions ' + seamsSame + ' / ' + seams);
    assert.ok([...why.keys()].every((k) => !k.startsWith('other')), rn + ': unexplained differences');
  }
});

// --- pins, rerolls, dice, locks -----------------------------------------------------------------------------------

// The second サビ of L1 (rows rr–ru) repeats the first (rf–ri); its cuts' sources are the first サビ's cuts.
function secondChorus(seed, aspect = '16:9', mood = 'popFizz') {
  return sampleDocs([mood], 1).find((d) => d.name === 'L1@' + aspect + '/' + mood + '#0').doc;
}

test('pins on a repeat win; a reroll of a repeat or of its line leaves it to the chooser, a die on a slot that slot', () => {
  let rolled = 0, rolledDiff = 0, diced = 0;
  for (const aspect of ['16:9', '9:16', '1:1']) {
    for (const mood of ['quietHush', 'dashSprint', 'popFizz', 'printColumn']) {
      const doc = secondChorus(0, aspect, mood);
      const p = PL.run(doc, CAT, null);
      const src = sourcesOf(doc, p);
      const repeats = p.cuts.filter((c) => src.has(c.key) && /^r[r-u]~/.test(c.key));
      assert.ok(repeats.length >= 6, aspect + ' ' + mood);
      const r = repeats[1], o = src.get(r.key);
      // a pin on the repeat wins; its other slots still follow the first copy
      const other = CAT.keys('arrange').find((k) => k !== valueOf(o, 'arrange') && CA.serves({ registry: CAT }, 'arrange', k, r.role) &&
        CAT.traits('arrange', k).orient.includes(valueOf(o, 'orient')));
      const pinned = withOptIn(doc, { ['cut/' + r.key + ':arrange']: { v: other, by: 'user', sig: r.text } });
      const q = PL.run(pinned, CAT, null);
      const rq = q.cuts.find((c) => c.key === r.key);
      assert.equal(valueOf(rq, 'arrange'), other, 'the pin wins');
      assert.equal(valueOf(rq, 'lens'), valueOf(o, 'lens'), 'the lens still follows');
      // a reroll of the repeat (its cut, or its line) chooses every slot again
      for (const key of ['cut/' + r.key, 'line/' + r.line]) {
        const x = PL.run(withOptIn(doc, null, { [key]: 1 }), CAT, null).cuts.find((c) => c.key === r.key);
        rolled++;
        const diff = ['orient', 'arrange', 'text.face', 'arrive', 'dwell', 'depart', 'lens'].filter((s) => valueOf(x, s) !== valueOf(o, s));
        if (diff.length >= 2) rolledDiff++;
      }
      // a die on the lens draws the lens again; the layout stays the first copy's
      const d = withOptIn(doc, null, { ['cut/' + r.key + ':lens']: 1 });
      const pd = PL.run(d, CAT, null);
      const rd = pd.cuts.find((c) => c.key === r.key);
      assert.equal(valueOf(rd, 'arrange'), valueOf(o, 'arrange'), 'a die on the lens leaves the layout aligned');
      assert.ok(!aligned(whyOf(d, pd, 'cut/' + r.key + ':lens')), 'the rerolled lens is its own');
      assert.ok(aligned(whyOf(d, pd, 'cut/' + r.key + ':arrange')), 'the layout says it follows');
      if (valueOf(rd, 'lens') !== valueOf(o, 'lens')) diced++;
    }
  }
  assert.ok(rolledDiff >= 0.8 * rolled && diced >= 4, [rolled, rolledDiff, diced].join(' '));
});

// With the opt-in on, repeats follow what their first copy shows: its pins, its locks and its rerolls. (Without it, a
// reroll of a first copy leaves its repeats, §4.7 "Repeated lines"; the opt-in is the user's request that they match.)
test('a reroll or a pin of the first copy carries to its repeats; a locked repeat keeps its look', () => {
  let followed = 0, moved = 0;
  for (const aspect of ['16:9', '9:16', '1:1']) {
    for (const mood of ['quietHush', 'dashSprint', 'popFizz', 'printColumn']) {
      const doc = secondChorus(0, aspect, mood);
      const p = PL.run(doc, CAT, null);
      const src = sourcesOf(doc, p);
      const first = p.cuts.find((c) => c.key.startsWith('rg~'));
      const reps = p.cuts.filter((c) => src.get(c.key) === first || (src.get(c.key) && src.get(c.key).key === first.key));
      assert.ok(reps.length >= 1, aspect + ' ' + mood);
      const rolled = withOptIn(doc, null, { ['cut/' + first.key]: 1 });
      const q = PL.run(rolled, CAT, null);
      const fq = q.cuts.find((c) => c.key === first.key);
      if (['arrange', 'lens', 'cam.shot'].some((s) => text(valueOf(fq, s)) !== text(valueOf(first, s)))) moved++;
      for (const r of reps) {
        const rq = q.cuts.find((c) => c.key === r.key);
        for (const s of ['orient', 'arrange', 'arrive', 'lens']) assert.equal(valueOf(rq, s), valueOf(fq, s), r.key + ' follows ' + s);
        followed++;
      }
      // a pinned first copy passes its pin on as a value
      const lens = CAT.keys('lens').find((k) => k !== valueOf(first, 'lens') && CA.serves({ registry: CAT }, 'lens', k, first.role));
      const pinned = withOptIn(doc, { ['cut/' + first.key + ':lens']: { v: lens, by: 'user', sig: first.text } });
      const pp = PL.run(pinned, CAT, null);
      for (const r of reps) {
        const d = pp.cuts.find((c) => c.key === r.key).slots.lens;
        assert.deepEqual([d.v, d.from], [lens, 'auto'], r.key + ' takes the pinned lens as its own automatic value');
      }
      // locking a repeat's line freezes what it shows (§3.6), and a reroll of its first copy no longer moves it
      const r = reps[0];
      const locked = CMD.reduce(doc, FI.lockPayload(doc, p, r.line, { registry: CAT }));
      const pl = PL.run(locked, CAT, null);
      for (const c of pl.cuts.filter((x) => x.line === r.line)) {
        const was = p.cuts.find((x) => x.key === c.key);
        for (const s of SLOTS) assert.equal(text(valueOf(c, s)), text(valueOf(was, s)), c.key + ' locked ' + s);
        for (const s of PARTS) if (c.slots[s]) assert.equal(text(c.slots[s].p), text(was.slots[s].p), c.key + ' locked ' + s + ' parameters');
      }
      const lr = PL.run(Object.assign({}, locked, { salts: { ['cut/' + first.key]: 1 } }), CAT, null);
      for (const c of lr.cuts.filter((x) => x.line === r.line)) {
        const was = p.cuts.find((x) => x.key === c.key);
        for (const s of ['arrange', 'lens', 'cam.shot']) assert.equal(text(valueOf(c, s)), text(valueOf(was, s)), c.key + ' stays locked ' + s);
      }
    }
  }
  assert.ok(followed >= 12 && moved >= 6, followed + ' ' + moved);
});

// --- why, fields, cache -------------------------------------------------------------------------------------------

test('explain says which slots were taken from the first copy, and no more', () => {
  let said = 0;
  for (const aspect of ['16:9', '9:16']) {
    const doc = secondChorus(0, aspect, 'dashSprint');
    const p = PL.run(doc, CAT, null);
    const src = sourcesOf(doc, p);
    for (const c of p.cuts.filter((x) => src.has(x.key))) {
      const o = src.get(c.key);
      for (const slot of ['arrange', 'lens', 'arrive', 'orient', 'text.face', 'cam.shot', 'cam.curve', 'cam.zoom']) {
        const why = whyOf(doc, p, 'cut/' + c.key + ':' + slot);
        const w = aligned(why);
        const pull = slot === 'cam.curve' && valueOf(c, 'cam.shot') === 'pullReveal' && c.feat.dur < 1.8 && valueOf(o, 'cam.curve') !== 'hushRushHush';
        if (pull || (slot === 'cam.shot' && text(valueOf(c, slot)) !== text(valueOf(o, slot)))) { assert.equal(w, null, c.key + ' ' + slot); continue; }
        // a value a rule gives both (a layout without camerawork: no shot; a layout that moves the text itself: the
        // standard motions; a pinned layout's only orientation) says the rule
        if (c.slots[slot].from === 'rule') { assert.equal(w, null, c.key + ' ' + slot); continue; }
        assert.deepEqual(w, { code: 'repeat.same', params: { cut: o.key } }, c.key + ' ' + slot + ' ' + text(why));
        said++;
      }
      // a first-chorus cut chooses its own
      assert.equal(aligned(whyOf(doc, p, 'cut/' + o.key + ':arrange')), null, o.key);
    }
    // the background of the second サビ's first segment and the section camera of its run
    const r0 = p.cuts.find((c) => c.key.startsWith('rr~'));
    if (p.grounds[r0.ground].cuts[0] === r0.key && p.grounds[src.get(r0.key).ground].cuts[0] === src.get(r0.key).key) {
      assert.ok(aligned(whyOf(doc, p, 'cut/' + r0.key + ':ground')), 'ground');
      said++;
    }
    assert.ok(aligned(whyOf(doc, p, 'cut/' + r0.key + ':rig')), 'section camera');
  }
  assert.ok(said > 60, 'said ' + said);
});

test('the inspector shows the switch: pinned at work, inherited on a line, a line pin of its own', () => {
  const doc = secondChorus(0);
  const off = clone(doc);
  delete off.pins['work:repeat.same'];
  const po = PL.run(off, CAT, null);
  const fs0 = FI.fieldState(off, po, { level: 'work' }, 'work:repeat.same', { registry: CAT });
  assert.deepEqual([fs0.state, fs0.value, fs0.schema], ['auto', undefined, { type: 'bool' }]);
  const p = PL.run(doc, CAT, null);
  const fs1 = FI.fieldState(doc, p, { level: 'work' }, 'work:repeat.same', { registry: CAT });
  assert.deepEqual([fs1.state, fs1.value, fs1.pinnedAt], ['pinned', true, 'work']);
  const line = p.lines.find((l) => l.id === 'rs');
  const fs2 = FI.fieldState(doc, p, { level: 'line', ids: [line.id] }, 'line/rs:repeat.same', { registry: CAT });
  assert.deepEqual([fs2.state, fs2.value, fs2.pinnedAt], ['inherited', true, 'work']);
  const own = withOptIn(doc, { 'line/rs:repeat.same': { v: false, by: 'user' } });
  const pl = PL.run(own, CAT, null);
  const fs3 = FI.fieldState(own, pl, { level: 'line', ids: ['rs'] }, 'line/rs:repeat.same', { registry: CAT });
  assert.deepEqual([fs3.state, fs3.value], ['pinned', false]);
  assert.ok(pl.cuts.filter((c) => c.line === 'rs').every((c) => !aligned(whyOf(own, pl, 'cut/' + c.key + ':arrange'))), 'rs is its own');
  // commands: the switch lives at work and line scope, never at a cut, and a line pin moves up to the video
  assert.throws(() => CMD.reduce(doc, { t: 'pin.set', path: 'cut/rs~0:repeat.same', v: true, by: 'user', sig: 'x' }), /cut scope/);
  const moved = CMD.reduce(own, { t: 'pin.promote', path: 'line/rs:repeat.same', to: 'work' });
  assert.deepEqual(moved.pins['work:repeat.same'], { v: false, by: 'user' });
});

// Re-planning from the cast cache gives the plan made from scratch through edits that change what the repeats take: the
// switch on and off, a pin and a reroll of a first copy, a reroll and a die of a repeat, a line pin, an edit that makes a
// line sung again or no more, an inserted line. The cache compares each cut's source (castInputs.aligned).
test('re-planning with the opt-in gives exactly the plan made from scratch', () => {
  for (const aspect of ['16:9', '9:16']) {
    const base = secondChorus(0, aspect, 'dreamHaze');
    const steps = [];
    let doc = clone(base);
    delete doc.pins['work:repeat.same'];
    const push = (label, next) => { doc = next; steps.push([label, doc]); };
    push('off', doc);
    push('on', withOptIn(doc));
    push('pin a first copy', withOptIn(doc, { 'cut/rg~0:arrange': { v: 'centerAnchor', by: 'user', sig: '折り目の数だけ' } }));
    push('reroll a first copy', withOptIn(doc, null, { 'cut/rh~0': 1 }));
    push('reroll a repeat', withOptIn(doc, null, { 'cut/rs~0': 1 }));
    push('a die on a repeat', withOptIn(doc, null, { 'cut/rt~0:lens': 1 }));
    push('a line pin', withOptIn(doc, { 'line/ru:repeat.same': { v: false, by: 'user' } }));
    const edit = (d, id, src) => Object.assign(clone(d), { sheet: Object.assign({}, d.sheet, { rows: d.sheet.rows.map((r) => (r.id === id ? { id, src } : r)) }) });
    push('a repeat sung no more', edit(doc, 'rt', '向かい風にも/かまわないさ'));
    push('sung again', edit(doc, 'rt', base.sheet.rows.find((r) => r.id === 'rt').src));
    const ins = clone(doc);
    ins.sheet.rows.splice(ins.sheet.rows.findIndex((r) => r.id === 'rg'), 0, { id: 'r' + (ins.sheet.next++).toString(36), src: '新しい朝が/来る' });
    push('an inserted line', ins);
    push('off again', Object.assign(clone(doc), { pins: Object.fromEntries(Object.entries(doc.pins).filter(([k]) => !k.includes('repeat.same'))) }));
    let reused = 0;
    for (const [label, d] of steps) {
      const cached = PL.plan(d, { registry: CAT });
      assert.equal(cached.hash, PL.run(d, CAT, { fresh: true }).hash, aspect + ': ' + label);
      reused += cached.reuse.casts;
    }
    assert.ok(reused > 100, 'the cache is used: ' + reused);
  }
});

// --- stability ------------------------------------------------------------------------------------------------------

// With the opt-in on, an edit that changes a first copy moves its repeats: that is the switch at work (the followers,
// counted apart like the echo's, planner_stability). The 4 cuts after a changed follower may move too (relays: they
// weigh against what the follower now shows), and so may the cut right before it (the transition into the follower,
// its source's, may take over that cut's exit). Everything else is as local as without the opt-in: measured with the
// same insertions (line starts pinned) and rerolls on the same documents with the opt-in off (its echo followers apart
// too), the cases over the bounds of planner_stability (4 other cuts for an insertion, 3 for a reroll) are no more.
test('with the opt-in on, an insertion or a reroll changes its first copies\' repeats and little else', (t) => {
  const SL = ['orient', 'arrange', 'arrive', 'dwell', 'depart', 'lens', 'cam.shot'];
  const changedOf = (a, b, skipLine) => {
    const before = new Map(a.cuts.map((c) => [c.key, c]));
    return b.cuts.filter((c) => before.has(c.key) && c.line !== skipLine && SL.some((s) => text(valueOf(c, s)) !== text(valueOf(before.get(c.key), s))))
      .map((c) => c.key);
  };
  // followers: changed repeats whose source changed (or is the rerolled cut), or that have another source than before
  // (an inserted line that parts a line from its copy sung right after it makes that copy a later run's, so it takes
  // the first one's look); relays: the cut right before a follower and the 4 after it. Without the opt-in, the followers
  // are the echo's (planner_stability): changed repeats whose first copy changed.
  const sourceMap = (doc, p, on) => (on ? sourcesOf(doc, p) : new Map(p.cuts.filter((c) => c.feat.repeatOf).map((c) => [c.key, { key: c.feat.repeatOf }])));
  const split = (doc, b, changed, rolled, on, before) => {
    const src = sourceMap(doc, b, on);
    const at = new Map(b.cuts.map((c, i) => [c.key, i]));
    const moved = (k) => !!before && (before.get(k) || {}).key !== (src.get(k) || {}).key;
    const followers = changed.filter((k) => moved(k) || (src.has(k) && (changed.includes(src.get(k).key) || src.get(k).key === rolled)));
    const near = (k, f) => at.get(k) - at.get(f) >= -1 && at.get(k) - at.get(f) <= 4;
    const relays = on ? changed.filter((k) => !followers.includes(k) && followers.some((f) => near(k, f))) : [];
    return { followers, relays, own: changed.filter((k) => !followers.includes(k) && !relays.includes(k)) };
  };
  for (const [rn, reg] of [['catalog', CAT], ['stub', STUB]]) {
    const acc = { on: { ins: 0, insOver: 0, insWorst: 0, fol: 0, rel: 0, rolls: 0, rollOver: 0, rollWorst: 0, rfol: 0 } };
    acc.off = Object.assign({}, acc.on);
    for (const { doc: optIn } of corpusDocs(1).concat(sampleDocs(['popFizz'], 1))) {
      for (const on of [true, false]) {
        const x = acc[on ? 'on' : 'off'];
        const doc = on ? optIn : Object.assign(clone(optIn), { pins: Object.fromEntries(Object.entries(optIn.pins).filter(([k]) => k !== 'work:repeat.same')) });
        const a = PL.run(doc, reg, null);
        const rows = doc.sheet.rows.map((r, i) => [r, i]).filter(([r]) => r.src.trim() && !/^\s*(#|\[)/.test(r.src)).map(([, i]) => i);
        const anchored = clone(doc);
        for (const line of a.lines) anchored.pins['line/' + line.id + ':start'] = { v: line.t0, by: 'tap' };
        const a2 = PL.run(anchored, reg, null);
        for (const k of [1, rows.length >> 1]) {
          const edited = clone(anchored);
          const id = 'r' + (edited.sheet.next++).toString(36);
          edited.sheet.rows.splice(rows[k], 0, { id, src: '新しい朝が/来る' });
          const b = PL.run(edited, reg, null);
          const r = split(edited, b, changedOf(a2, b, id), null, on, sourceMap(anchored, a2, on));
          x.ins++; x.fol += r.followers.length; x.rel += r.relays.length;
          if (r.own.length > 4) x.insOver++;
          x.insWorst = Math.max(x.insWorst, r.own.length);
        }
        const step = Math.max(3, Math.floor(a.cuts.length / 8));
        for (let i = 0; i < a.cuts.length; i += step) {
          const key = a.cuts[i].key;
          const rolled = clone(doc);
          rolled.salts = Object.assign({}, rolled.salts, { ['cut/' + key]: (rolled.salts['cut/' + key] || 0) + 1 });
          const b = PL.run(rolled, reg, null);
          const r = split(rolled, b, changedOf(a, b, null).filter((c) => c !== key), key, on);
          x.rolls++; x.rfol += r.followers.length;
          if (r.own.length > 3) x.rollOver++;
          x.rollWorst = Math.max(x.rollWorst, r.own.length);
        }
      }
    }
    const say = (x) => x.ins + ' insertions: ' + x.insOver + ' changed more than 4 other cuts besides ' + x.fol + ' followers and ' + x.rel +
      ' relays (worst ' + x.insWorst + '); ' + x.rolls + ' rerolls: ' + x.rollOver + ' more than 3 besides ' + x.rfol + ' followers (worst ' + x.rollWorst + ')';
    t.diagnostic(rn + ', the opt-in on: ' + say(acc.on) + ' | off: ' + say(acc.off));
    assert.ok(acc.on.insOver <= acc.off.insOver && acc.on.insWorst <= Math.max(6, acc.off.insWorst), rn + ' insertions');
    assert.ok(acc.on.rollOver <= acc.off.rollOver + 1 && acc.on.rollWorst <= Math.max(5, acc.off.rollWorst), rn + ' rerolls');
    assert.ok(acc.on.rfol > 10, rn + ': rerolls of first copies carry to their repeats (' + acc.on.rfol + ')');
  }
});

// --- camera --------------------------------------------------------------------------------------------------------

test('an aligned repeat plays its first copy\'s move: the same shot, curve, closeness and follow, except a short pull\'s curve', () => {
  let shots = 0, pulls = 0, carried = 0;
  for (const { doc } of sampleDocs(['quietHush', 'dashSprint'], 2)) {
    const p = PL.run(doc, CAT, null);
    const src = sourcesOf(doc, p);
    for (const c of p.cuts) {
      const o = src.get(c.key);
      if (!o || text(valueOf(c, 'cam.shot')) !== text(valueOf(o, 'cam.shot'))) continue;
      shots++;
      assert.equal(valueOf(c, 'cam.zoom'), valueOf(o, 'cam.zoom'), c.key);
      assert.equal(valueOf(c, 'cam.follow'), valueOf(o, 'cam.follow'), c.key);
      if (valueOf(c, 'cam.shot') === 'pullReveal' && c.feat.dur < 1.8) { assert.equal(valueOf(c, 'cam.curve'), 'hushRushHush', c.key); pulls++; }
      else assert.equal(text(valueOf(c, 'cam.curve')), text(valueOf(o, 'cam.curve')), c.key);
      // a repeat carries its previous cut's framing (§4.5.7) only where its first copy does
      const cc = !!(c.slots['cam.shot'].p && c.slots['cam.shot'].p.carry), oc = !!(o.slots['cam.shot'].p && o.slots['cam.shot'].p.carry);
      if (oc === false) assert.equal(cc, false, c.key + ' carries only when its first copy does');
      if (cc) carried++;
    }
  }
  assert.ok(shots > 300 && pulls >= 1, [shots, pulls, carried].join(' '));
});

// --- with カメラ EXTREME (DESIGN_EXTREME §2.3, planner/extreme alignedSource) ---------------------------------------------

const SHOT = MV.use('core/shot');
const XON = Object.freeze({ v: 1, by: 'user' });
const xKey = (c) => { const v = valueOf(c, 'cam.shot'); const x = typeof v === 'string' ? SHOT.xKeyOf(v) : null; return x ? x.key : null; };
function withExtreme(doc, optIn) {
  const out = clone(doc);
  out.pins = Object.assign({}, out.pins, { 'work:cam.extreme': XON });
  if (!optIn) delete out.pins['work:repeat.same'];
  return out;
}

// Pairs (an aligned repeat, its first copy showing an EXTREME preset) of the sample documents with the switch on.
function xPairs(optIn) {
  const out = [];
  for (const { name, doc } of sampleDocs(['quietHush', 'dashSprint', 'popFizz', 'printColumn'], 1)) {
    const d = withExtreme(doc, optIn);
    const p = PL.run(d, CAT, null);
    const src = sourcesOf(withOptIn(d), p);
    p.cuts.forEach((c, i) => {
      const o = src.get(c.key);
      if (o && xKey(o)) out.push({ name, doc: d, p, c, o, prev: i > 0 ? p.cuts[i - 1] : null, before: p.cuts[p.cuts.indexOf(o) - 1] || null });
    });
  }
  return out;
}

test('with カメラ EXTREME on, an aligned repeat plays its first copy\'s EXTREME move, mirrored alike; explain names the first copy', () => {
  const on = xPairs(true), off = xPairs(false);
  const same = (list) => list.filter((x) => valueOf(x.c, 'cam.shot') === valueOf(x.o, 'cam.shot')).length;
  assert.ok(on.length > 250 && off.length === on.length, on.length + ' ' + off.length);
  // measured: 98.0 % with the opt-in (the rest: the same move twice in a row, below, or a preset that does not fit the
  // repeat), 47.7 % from the echo alone
  assert.ok(same(on) >= 0.95 * on.length, same(on) + '/' + on.length);
  assert.ok(same(off) <= 0.7 * off.length, same(off) + '/' + off.length);
  assert.ok(on.some((x) => /~m$/.test(valueOf(x.c, 'cam.shot'))), 'a mirrored move is copied mirrored');
  const shown = on.filter((x) => valueOf(x.c, 'cam.shot') === valueOf(x.o, 'cam.shot') && x.c.slots['cam.shot'].from === 'auto').slice(0, 4);
  assert.equal(shown.length, 4);
  for (const x of shown) {
    const why = whyOf(x.doc, x.p, 'cut/' + x.c.key + ':cam.shot');
    assert.deepEqual(aligned(why), { code: 'repeat.same', params: { cut: x.o.key } }, x.name + ' ' + x.c.key);
  }
});

test('with カメラ EXTREME on, a repeat plays the same move twice in a row only where its first copy did', () => {
  const on = xPairs(true);
  const twice = on.filter((x) => x.prev && xKey(x.prev) === xKey(x.c));
  const own = twice.filter((x) => !(x.before && xKey(x.before) === xKey(x.o)) && valueOf(x.c, 'cam.shot') === valueOf(x.o, 'cam.shot'));
  // the rare rest: the repeat's own pick (×0.2 for its previous cut's preset) landed on it anyway
  assert.ok(own.length <= 0.01 * on.length, own.length + ' of ' + on.length);
  const whys = own.map((x) => aligned(whyOf(x.doc, x.p, 'cut/' + x.c.key + ':cam.shot')));
  assert.ok(whys.every((w) => w === null), 'such a repeat does not say it follows its first copy');
});

test('with カメラ EXTREME on, a pin on the repeat wins, a reroll of it or its line or its カメラワーク leaves it to the pick; a pinned first copy is followed', () => {
  const doc = withExtreme(secondChorus(0, '16:9', 'dashSprint'), true);
  const p = PL.run(doc, CAT, null);
  const src = sourcesOf(doc, p);
  const r = p.cuts.find((c) => src.has(c.key) && xKey(src.get(c.key)) && valueOf(c, 'cam.shot') === valueOf(src.get(c.key), 'cam.shot'));
  assert.ok(r, 'an aligned repeat with an EXTREME move');
  const o = src.get(r.key);
  const pinned = PL.run(withOptIn(doc, { ['cut/' + r.key + ':cam.shot']: { v: 'orbit', by: 'user', sig: r.text } }), CAT, null);
  assert.equal(valueOf(pinned.cuts.find((c) => c.key === r.key), 'cam.shot'), 'orbit', 'the pin wins');
  for (const key of ['cut/' + r.key, 'line/' + r.line, 'cut/' + r.key + ':cam.shot', 'line/' + r.line + ':cam.shot']) {
    const d = withOptIn(doc, null, { [key]: 1 });
    const q = PL.run(d, CAT, null);
    assert.ok(!aligned(whyOf(d, q, 'cut/' + r.key + ':cam.shot')), key + ': picked on its own');
  }
  // a hand-picked EXTREME move on the first copy carries to the repeat where it fits there (weighs > 0; a short cut
  // takes only the short pool, and then picks its own)
  const alts = EX.explain(doc, p, 'cut/' + r.key + ':cam.shot', { registry: CAT }).alts;
  const other = alts.find((a) => a.key !== xKey(o) && a.w > 0).key;
  const misfit = alts.find((a) => !(a.w > 0)).key;
  const m = PL.run(withOptIn(doc, { ['cut/' + o.key + ':cam.shot']: { v: misfit, by: 'user', sig: o.text } }), CAT, null);
  assert.notEqual(valueOf(m.cuts.find((c) => c.key === r.key), 'cam.shot'), misfit, 'a preset that does not fit the repeat is not copied');
  const d = withOptIn(doc, { ['cut/' + o.key + ':cam.shot']: { v: other, by: 'user', sig: o.text } });
  const q = PL.run(d, CAT, null);
  assert.equal(valueOf(q.cuts.find((c) => c.key === o.key), 'cam.shot'), other);
  assert.equal(valueOf(q.cuts.find((c) => c.key === r.key), 'cam.shot'), other, 'the repeat follows the pinned first copy');
});

// --- the golden --------------------------------------------------------------------------------------------------------

test('the opt-in golden: project_repeat plans and renders the golden frames (tests/golden/project_repeat.json)', async () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'golden', 'project_repeat.json'), 'utf8'));
  const { doc } = corpus.project('repeat');
  const { createEngine } = MV.use('engine/facade');
  const { createRecorder } = MV.use('engine/render/record');
  const { fakeMeasurer } = MV.use('engine/text/fake_measure');
  const H = MV.use('core/hash');
  const D = MV.use('core/doc');
  assert.equal(golden.registry.version, CAT.version, 'made with the current catalog');
  const rec = createRecorder();
  const engine = createEngine({ registry: CAT, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null });
  const { plan } = engine.setDoc(doc);
  assert.equal(plan.hash, golden.plan);
  // the fixture shows the switch at work: the second サビ follows the first but for its pinned and rerolled lines
  const src = sourcesOf(doc, plan);
  assert.ok(src.size >= 12, 'aligned cuts ' + src.size);
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
