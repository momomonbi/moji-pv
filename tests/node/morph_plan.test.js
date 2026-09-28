/* 文字PVメーカー v2 — original work. Tests for the glyph morph in the planner (DESIGN_2_2 §4, M4): shared letters, the rule and its guards, the window and the hand-over, pins, locks, the memo. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');
const G = require('../helpers/glyph_docs.js');

const MV = load();
const MO = MV.use('planner/morph');
const PL = MV.use('planner/plan');
const TR = MV.use('planner/tracks');
const FI = MV.use('planner/fields');
const EX = MV.use('planner/explain');
const PINS = MV.use('core/pins');
const REG = MV.use('core/registry');
const F = MV.use('engine/scene/frame');
const CAT = MV.use('parts/catalog').defaultRegistry();
const GROUND = CAT.fallback('ground');
const MORPH = 'glyphMorph';

const pin = (v, extra) => Object.assign({ v, by: 'user' }, extra || {});
const floor6 = (x) => Math.floor(x * 1e6) / 1e6;
const planOf = (doc, reg) => PL.plan(doc, { registry: reg || CAT });
const cutOf = (plan, key) => plan.cuts.find((c) => c.key === key);
const seamInto = (plan, key) => { const c = cutOf(plan, key); return c && c.seamIn >= 0 ? plan.seams[c.seamIn] : null; };
const morphs = (plan) => plan.seams.filter((s) => s.slot.v === MORPH);

// --- 1. planner/morph: letters, runs, swaps ---------------------------------------------------------------------------

test('planner/morph: the design examples give their pairs [aOff, bOff, same], sorted by bOff', () => {
  // 青い travels (a run of 2 with a kanji), へ alone is no anchor but pairs inside the gap, 空 melts into 海
  assert.deepEqual(MO.pairsOf('青い空へ', '青い海へ'), [[0, 0, 1], [1, 1, 1], [2, 2, 0], [3, 3, 1]]);
  // の町 is a kept run; the gap before it pairs 夜 → 朝
  assert.deepEqual(MO.pairsOf('夜の町', '朝の町'), [[0, 0, 0], [1, 1, 1], [2, 2, 1]]);
  // only の matches, a lone particle: no anchor, the whole line is one gap (君 → 夢, の travels, 手 → 中)
  assert.deepEqual(MO.pairsOf('君の手', '夢の中'), [[0, 0, 0], [1, 1, 1], [2, 2, 0]]);
  // ties: 夜 and 月 score alike and sit as far from the diagonal; the tie order (match, skip A, skip B) anchors 夜
  assert.deepEqual(MO.pairsOf('夜の月', '月の夜'), [[0, 2, 1]]);
  // offsets are UTF-16 offsets of graphemes; spaces and punctuation never match
  assert.deepEqual(MO.pairsOf('😀 青い', '青い 😀'), [[3, 0, 1], [4, 1, 1]]);
  assert.deepEqual(MO.pairsOf('青い、空', '青い空'), [[0, 0, 1], [1, 1, 1], [3, 2, 1]], 'a comma between does not break the run');
});

test('planner/morph: analyze — meaningful needs m ≥ 2 and a run of 2, or m ≥ 0.4 of the shorter line', () => {
  const a = (x, y) => MO.analyze(x, y);
  assert.deepEqual(a('青い空へ', '青い海へ'), { m: 2, longest: 2, nA: 4, nB: 4, meaningful: true });
  assert.equal(a('夜の月', '月の夜').meaningful, false, 'one shared kanji never triggers the rule');
  assert.equal(a('君の手', '夢の中').meaningful, false, 'one particle neither');
  assert.equal(a('から', 'から').meaningful, false, 'all-hiragana two: not a run that means something');
  assert.equal(a('こころから', 'こころから').meaningful, true, 'three kana are');
  assert.deepEqual(a('空の海', '空が海'), { m: 2, longest: 1, nA: 3, nB: 3, meaningful: true }, '0.4 · min branch');
  const long = a('空あいうえおかきくけこ海', '空さしすせそたちつてと海');
  assert.deepEqual([long.m, long.longest, long.meaningful], [2, 1, false], 'two single kanji far apart in long lines');
  assert.equal(Object.isFrozen(a('青い空', '青い海')), true);
});

test('planner/morph: melt fade makes no swaps; the gap ratio rule; the 64-unit cap; the cache', () => {
  assert.deepEqual(MO.pairsOf('青い空へ', '青い海へ', 'fade'), [[0, 0, 1], [1, 1, 1]]);
  assert.deepEqual(MO.pairsOf('夜の町', '朝の町', 'fade'), [[1, 1, 1], [2, 2, 1]]);
  // p = 1, q = 4: 4 > 2·1 + 1, no swap
  assert.deepEqual(MO.pairsOf('青い空', '青い大きな海'), [[0, 0, 1], [1, 1, 1]]);
  // p = 2, q = 5 ≤ 2·2 + 1: the first two pair up
  assert.deepEqual(MO.pairsOf('青い空へ', '青い大きな海へ'), [[0, 0, 1], [1, 1, 1], [2, 2, 0], [3, 3, 0]]);
  const many = '字'.repeat(100);
  assert.equal(MO.unitsOf(many).n, MO.MAX_UNITS);
  const pairs = MO.pairsOf(many, many);
  assert.equal(pairs.length, 64);
  assert.ok(pairs.every(([x, y, s]) => x === y && s === 1 && x < 64));
  // the same frozen object for the same texts and melt, a deep-equal one after the cache let it go
  const p1 = MO.pairsOf('夜の町を歩く', '朝の町を歩く');
  assert.equal(MO.pairsOf('夜の町を歩く', '朝の町を歩く'), p1);
  assert.ok(Object.isFrozen(p1) && Object.isFrozen(p1[0]));
  for (let i = 0; i < 300; i++) MO.analyze('x' + i, 'y' + i);
  const p2 = MO.pairsOf('夜の町を歩く', '朝の町を歩く');
  assert.notEqual(p2, p1);
  assert.deepEqual(p2, p1);
});

// --- 2. the rule ---------------------------------------------------------------------------------------------------------

test('rule: in a new work, lines that share letters in one background are joined by the glyph morph', () => {
  const plan = planOf(G.morphDoc(GROUND));
  const got = morphs(plan).map((s) => s.into);
  assert.deepEqual(got, ['r4~0', 'r6~0', 'r8~3', 'rc~0'], '青い海へ, 朝の町を歩く, the inner boundary of 青い空/青い海, 光る窓の向こう');
  for (const s of morphs(plan)) {
    const A = cutOf(plan, s.a), B = cutOf(plan, s.into);
    assert.deepEqual([s.slot.v, s.slot.from, s.scope], [MORPH, 'rule', 'text']);
    assert.deepEqual([A.slots.depart.v, A.slots.depart.from, B.slots.arrive.v, B.slots.arrive.from],
      ['instantHide', 'rule', 'instantShow', 'rule'], s.into + ': the transition is both the exit and the entrance');
    assert.equal(s.at, Math.min(B.t0, B.a + s.dur) - s.dur / 2, s.into + ': the window ends as B\'s voice starts');
    assert.ok(s.at - s.dur / 2 >= A.t1 - TR.ENDS_EARLY - 1e-9, s.into + ': and starts at most ENDS_EARLY before A\'s sung end');
    assert.ok(s.at - s.dur / 2 >= A.a - 1e-9, s.into + ': A is on screen as it starts');
    assert.deepEqual(s.glyphs, MO.pairsOf(A.text, B.text, s.slot.p.melt), s.into + ' pairs');
    assert.ok(s.dur >= TR.ENDS_MIN && s.dur <= 0.7, s.into + ' dur');
    const old = planOf(G.morphDoc(GROUND, { gen: undefined }));
    const i = plan.cuts.indexOf(A);
    const cutterB = (c, next) => (next && !['title', 'interlude', 'outro'].includes(next.role) ? Math.max(c.t1, next.t0) : c.t1) + 0.25;
    const limit = 0.5 * Math.min(cutterB(old.cuts[i], old.cuts[i + 1]) - A.a, cutterB(old.cuts[i + 1], old.cuts[i + 2]) - B.a);
    assert.ok(s.dur <= limit + 1e-6, s.into + ': at most half the shorter cut');
  }
  assert.equal(seamInto(plan, 'ra~0'), null, '君の手 → 夢の中 shares one particle: not joined');
  // the reason
  const why = EX.explain(G.morphDoc(GROUND), plan, 'cut/r4~0:seam', { registry: CAT }).why;
  assert.deepEqual(why, [{ code: 'rule', params: { rule: 'morph' } }]);
  // a work pin turns it on in an older work, as the marker does
  const pinned = planOf(G.morphDoc(GROUND, { gen: undefined, pins: { 'work:morph.auto': pin(true) } }));
  assert.deepEqual(morphs(pinned).map((s) => s.into), got);
});

test('rule: an older work never evaluates it — its plan is the plan of a registry without the late parts', () => {
  const lateFree = REG.createRegistry(MV.use('parts/catalog').defs().filter((d) => d.late !== true));
  assert.equal(lateFree.version, CAT.version);
  for (const doc of [G.morphDoc(GROUND, { gen: undefined }), corpus.project('basic').doc, corpus.project('vertical').doc]) {
    const a = PL.run(doc, CAT, null), b = PL.run(doc, lateFree, null);
    assert.equal(a.hash, b.hash);
    assert.equal(morphs(a).length, 0);
    assert.ok(a.seams.every((s) => s.glyphs === undefined && s.at === cutOf(a, s.into).a));
  }
});

// --- 3. the hand-over ------------------------------------------------------------------------------------------------------

// Every glyph seam hands A over: A ends with the window (even before its sung end), and nothing of A is drawn from the
// window's end on.
function checkHandover(name, plan) {
  let n = 0;
  for (const s of morphs(plan)) {
    const A = cutOf(plan, s.a), B = cutOf(plan, s.into);
    const end = s.at + s.dur / 2;
    assert.ok(A.b <= end + 1e-9, name + ' ' + s.a + ' ends with the window');
    assert.equal(A.b, floor6(end), name + ' ' + s.a + ': exactly the window end (the sung end does not hold it)');
    for (const t of [floor6(end), (end + B.t1) / 2, B.t1 - 1e-3]) {
      assert.ok(!F.frameAt(plan, t).cuts.some((e) => plan.cuts[e.i].key === s.a), name + ' ' + s.a + ' gone at ' + t);
    }
    const ai = plan.cuts.indexOf(A);
    for (let k = 0; k < ai; k++) assert.ok(plan.cuts[k].b <= Math.max(plan.cuts[k].t1, end) + 1e-9, name + ' cut before A');
    n++;
  }
  return n;
}

test('hand-over: A ends with the morph window, before its sung end; no frame after the window shows it', () => {
  const plan = planOf(G.morphDoc(GROUND));
  assert.equal(checkHandover('rule', plan), 4);
  // lines that touch: the window ends as B's voice starts (B.t0 = A.t1), so A ends with its voice
  const s = seamInto(plan, 'r4~0');
  assert.equal(cutOf(plan, 'r3~0').b, floor6(cutOf(plan, 'r3~0').t1));
  assert.ok(Math.abs(s.at + s.dur / 2 - cutOf(plan, 'r4~0').t0) < 1e-9);
  // pinned morphs hand over too, even between overlapping lines
  const base = planOf(G.morphDoc(GROUND, { gen: undefined }));
  const r9 = cutOf(base, 'r9~0');
  const over = planOf(G.morphDoc(GROUND, { gen: undefined, pins: { 'cut/ra~0:seam': pin(MORPH, { sig: '夢の中' }),
    'line/r9:end': pin(r9.t1 + 0.4) } }));
  const A = cutOf(over, 'r9~0'), B = cutOf(over, 'ra~0');
  assert.ok(A.t1 > B.t0, 'the lines overlap');
  assert.equal(checkHandover('pinned', over), 1);
});

// Lines tapped STEP s apart: a transition pinned into r4 (青い空へ, short) and a morph out of it into r5 (青い海へ).
function shortDoc(step, morphPin) {
  const rows = ['[ti:テスト]', '# サビ', '光る窓の外', '青い空へ', '青い海へ', '夜の町を歩く'];
  const pins = { 'cut/r4~0:seam': pin('blendDissolve', { sig: '青い空へ' }) };
  if (morphPin) pins['cut/r5~0:seam'] = pin(MORPH, { sig: '青い海へ' });
  const T = [18, 20, 20 + step, 20 + 2 * step + 1];
  ['r3', 'r4', 'r5', 'r6'].forEach((id, i) => { pins['line/' + id + ':start'] = { v: T[i], by: 'tap' }; });
  return G.morphDoc(GROUND, { rows, pins });
}

test('window: a morph starts inside A and after the transition into A; short lines get none by the rule', () => {
  for (const step of [0.7, 0.5, 0.35, 0.2]) {
    for (const pinned of [false, true]) {
      const plan = planOf(shortDoc(step, pinned));
      const d = seamInto(plan, 'r4~0'), m = seamInto(plan, 'r5~0'), A = cutOf(plan, 'r4~0');
      const tag = 'step ' + step + (pinned ? ' pinned' : ' rule');
      if (!pinned && !(m && m.slot.v === MORPH)) continue;          // the rule stands aside (below)
      assert.equal(m.slot.v, MORPH, tag);
      assert.ok(pinned || m.dur >= TR.ENDS_MIN, tag + ': the rule takes a window of ENDS_MIN at least');
      const lo = m.at - m.dur / 2;
      assert.ok(lo >= A.a - 1e-9, tag + ': starts with A on screen');
      assert.ok(lo >= d.at + d.dur / 2 - 1e-9, tag + ': starts after the transition into A');
      // the transition into A plays to its end: every frame of its window shows it
      for (let t = d.at - d.dur / 2 + 1e-3; t < d.at + d.dur / 2; t += 0.02) {
        const fg = F.frameAt(plan, t);
        assert.ok(fg.seam && plan.seams[fg.seam.i] === d, tag + ' ' + t.toFixed(3) + ': the transition into A is shown');
      }
    }
  }
  // the rule joins lines 0.7 s long, not lines 0.2 s long (less than ENDS_MIN of room after the transition into A)
  assert.equal(seamInto(planOf(shortDoc(0.7, false)), 'r5~0').slot.v, MORPH);
  const short = seamInto(planOf(shortDoc(0.2, false)), 'r5~0');
  assert.ok(!short || short.slot.v !== MORPH, 'lines 0.2 s long: no automatic morph');
});

// --- 4. where the rule stays off ----------------------------------------------------------------------------------------

test('rule off: the switch off, a line pin, a seam pin, pinned motions, another background, overlapping lines', () => {
  const plan = planOf(G.morphDoc(GROUND));
  const on = (p, key) => { const s = seamInto(p, key); return !!s && s.slot.v === MORPH; };
  const off = planOf(G.morphDoc(GROUND, { pins: { 'work:morph.auto': pin(false) } }));
  assert.equal(morphs(off).length, 0, 'work pin false');
  // a line pin false turns off only the boundary into that line; inside a line the work value holds
  let p = planOf(G.morphDoc(GROUND, { pins: { 'line/r4:morph.auto': pin(false), 'line/r8:morph.auto': pin(false) } }));
  assert.deepEqual([on(p, 'r4~0'), on(p, 'r6~0'), on(p, 'r8~3'), on(p, 'rc~0')], [false, true, true, true]);
  assert.deepEqual(seamInto(p, 'r4~0') && seamInto(p, 'r4~0').slot, seamInto(off, 'r4~0') && seamInto(off, 'r4~0').slot,
    'the boundary gets what it gets without the switch');
  // a line pin true in an older work turns on the boundary into that line only
  p = planOf(G.morphDoc(GROUND, { gen: undefined, pins: { 'line/r8:morph.auto': pin(true), 'line/r6:morph.auto': pin(true) } }));
  assert.deepEqual(morphs(p).map((s) => s.into), ['r6~0'], 'r8 (青い空/青い海): its inner boundary follows the work (off)');
  // a seam pin at B wins (any key, the hard cut too)
  p = planOf(G.morphDoc(GROUND, { pins: { 'cut/r4~0:seam': pin('hardCut', { sig: '青い海へ' }), 'cut/r6~0:seam': pin('blendDissolve', { sig: '朝の町を歩く' }) } }));
  assert.equal(seamInto(p, 'r4~0'), null);
  assert.deepEqual([seamInto(p, 'r6~0').slot.v, seamInto(p, 'r6~0').slot.from], ['blendDissolve', 'pin:cut']);
  // a motion the user chose
  p = planOf(G.morphDoc(GROUND, { pins: { 'line/r4:arrive': pin('fogIn'), 'line/r5:depart': pin('fogOut') } }));
  assert.deepEqual([on(p, 'r4~0'), on(p, 'r6~0'), on(p, 'r8~3')], [false, false, true]);
  // another background at B
  const other = CAT.keys('ground').find((k) => k !== GROUND && CAT.get('ground', k).pool !== false);
  p = planOf(G.morphDoc(GROUND, { pins: { 'line/r4:ground': pin(other) } }));
  assert.ok(cutOf(p, 'r3~0').ground !== cutOf(p, 'r4~0').ground);
  assert.equal(on(p, 'r4~0'), false);
  // overlapping lines (A's sung end after B's start)
  const r3 = cutOf(plan, 'r3~0');
  p = planOf(G.morphDoc(GROUND, { pins: { 'line/r3:end': pin(r3.t1 + 0.3) } }));
  assert.ok(cutOf(p, 'r3~0').t1 > cutOf(p, 'r4~0').t0);
  assert.equal(on(p, 'r4~0'), false);
  // a knockout layout (edgeBleed 抜き文字) on either side
  for (const line of ['r3', 'r4']) {
    p = planOf(G.morphDoc(GROUND, { pins: { ['line/' + line + ':arrange']: pin('edgeBleed'), ['line/' + line + ':arrange@edgeBleed.knockout']: pin(true) } }));
    assert.equal(on(p, 'r4~0'), false, 'knockout at ' + line);
  }
  // the title → first line boundary: special cuts never
  p = planOf(G.morphDoc(GROUND, { rows: ['[ti:青い空へ]', '青い空へ行こう', '青い海へ'] }));
  assert.ok(!on(p, cutOf(p, 'r2~0') ? 'r2~0' : p.cuts[1].key), 'not out of the title');
});

test('rule off: layouts that move the text themselves; the hooks of the other packages (effect budget, キメ, 歌ハメ)', () => {
  const own = CAT.all('arrange').find((d) => d.motion === 'own' && CAT.traits('arrange', d.key).roles.includes('lyric'));
  const p = planOf(G.morphDoc(GROUND, { pins: { 'line/r4:arrange': pin(own.key) } }));
  assert.ok(!seamInto(p, 'r4~0') || seamInto(p, 'r4~0').slot.v !== MORPH, own.key);
  // the guards on a hand-made context over a real plan
  const doc = G.morphDoc(GROUND);
  const plan = planOf(doc);
  const ctx = (extra) => Object.assign({ doc, registry: CAT, ix: PINS.index(doc.pins),
    glyph: { morph: true, weight: true, maybeMorph: true, id: 'g11' } }, extra || {});
  const A = cutOf(plan, 'r5~0'), B = cutOf(plan, 'r6~0');
  const fresh = (c) => Object.assign({}, c, { slots: Object.assign({}, c.slots, c === A ? { depart: { v: 'fogOut', from: 'auto' } }
    : { arrive: { v: 'fogIn', from: 'auto' } }) });
  const a = fresh(A), b = fresh(B);
  assert.equal(TR.morphRule(ctx(), a, b), true);
  assert.equal(TR.morphRule(ctx({ pv: { seamGate: () => true } }), a, b), false, 'no room for a transition (P2)');
  assert.equal(TR.morphRule(ctx({ pv: { seamGate: () => false } }), a, b), true);
  assert.equal(TR.morphRule(ctx(), Object.assign({}, a, { kime: true }), b), false, 'out of a キメ cut (P3)');
  assert.equal(TR.morphRule(ctx(), a, Object.assign({}, b, { kime: true })), false, 'into a キメ cut (P3)');
  assert.equal(TR.morphRule(ctx({ uta: { at: (c) => c.key === b.key } }), a, b), false, 'letters that appear as sung (P6)');
  assert.equal(TR.morphRule(ctx({ glyph: { morph: false, weight: false, maybeMorph: false, id: 'g00' } }), a, b), false);
  assert.equal(TR.morphRule(ctx(), a, Object.assign({}, b, { role: 'title' })), false);
  // a lock pin of the fallback motion is no choice (it froze what a morph gave); any other lock pin is
  const locked = (c, kind, v) => Object.assign({}, c, { slots: Object.assign({}, c.slots, { [kind]: { v, from: 'pin:cut', by: 'lock' } }) });
  assert.equal(TR.morphRule(ctx(), locked(a, 'depart', 'instantHide'), locked(b, 'arrive', 'instantShow')), true);
  assert.equal(TR.morphRule(ctx(), locked(a, 'depart', 'fogOut'), b), false);
  assert.equal(TR.morphRule(ctx(), Object.assign({}, a, { slots: Object.assign({}, a.slots, { depart: { v: 'instantHide', from: 'pin:line', by: 'user' } }) }), b), false);
});

test('reroll: a die pressed on the transition into B makes the rule stand aside, so the chance roll picks one', () => {
  const doc = G.morphDoc(GROUND);
  const plan = planOf(doc);
  assert.equal(seamInto(plan, 'r4~0').slot.v, MORPH);
  for (const key of ['cut/r4~0:seam', 'line/r4:seam']) {
    const salted = Object.assign({}, doc, { salts: Object.assign({}, doc.salts, { [key]: 1 }) });
    const p = planOf(salted);
    const s = seamInto(p, 'r4~0');
    assert.ok(!s || (s.slot.v !== MORPH && s.slot.from === 'auto'), key + ': ' + (s && s.slot.v));
    assert.notEqual(cutOf(p, 'r4~0').slots.arrive.from, 'rule', key + ': B plays its own entrance again');
    assert.notEqual(cutOf(p, 'r3~0').slots.depart.from, 'rule', key + ': A plays its own exit again');
    assert.equal(seamInto(p, 'r6~0').slot.v, MORPH, key + ': the other boundaries keep theirs');
    assert.equal(p.hash, PL.run(salted, CAT, { fresh: true }).hash, key + ': re-plan');
  }
  // a pinned morph is the user's choice: the die on it re-rolls its parameters only
  const pinned = Object.assign({}, doc, { pins: Object.assign({}, doc.pins, { 'cut/r4~0:seam': pin(MORPH, { sig: '青い海へ' }) }),
    salts: { 'cut/r4~0:seam': 1 } });
  assert.equal(seamInto(planOf(pinned), 'r4~0').slot.v, MORPH);
});

// --- 5. pins ---------------------------------------------------------------------------------------------------------------

test('pins: a pinned morph where nothing is shared melts only (gap pairs or none); a pinned entrance survives', () => {
  const doc = G.morphDoc(GROUND, { gen: undefined, pins: { 'cut/ra~0:seam': pin(MORPH, { sig: '夢の中' }),
    'cut/r9~0:seam': pin(MORPH, { sig: '君の手' }) } });
  const plan = planOf(doc);
  const s = seamInto(plan, 'ra~0');
  assert.deepEqual([s.slot.v, s.slot.from], [MORPH, 'pin:cut']);
  assert.deepEqual(s.glyphs, [[0, 0, 0], [1, 1, 1], [2, 2, 0]], '君の手 → 夢の中: the gap pairs');
  const t = seamInto(plan, 'r9~0');
  assert.deepEqual(t.glyphs, MO.pairsOf('青い海', '君の手'));
  // melt: fade → no gap pairs at all
  const fade = planOf(Object.assign({}, doc, { pins: Object.assign({}, doc.pins, { 'cut/ra~0:seam@glyphMorph.melt': pin('fade', { sig: '夢の中' }) }) }));
  assert.deepEqual(seamInto(fade, 'ra~0').glyphs, []);
  // the entrance pinned: the replace rule skips it (the first plan of a seam that replaces an entrance)
  const kept = planOf(Object.assign({}, doc, { pins: Object.assign({}, doc.pins, { 'line/ra:arrive': pin('fogIn') }) }));
  assert.deepEqual([cutOf(kept, 'ra~0').slots.arrive.v, cutOf(kept, 'ra~0').slots.arrive.from], ['fogIn', 'pin:line']);
  assert.deepEqual([cutOf(kept, 'r9~0').slots.depart.v, cutOf(kept, 'r9~0').slots.depart.from], ['instantHide', 'rule']);
  assert.deepEqual([cutOf(plan, 'ra~0').slots.arrive.v, cutOf(plan, 'ra~0').slots.arrive.from], ['instantShow', 'rule']);
});

test('pins: a morph that replaces an entrance with 太る takes the grow rule\'s bold weight away', () => {
  // find a seed where 光る窓の向こう enters with 太る by itself (the switch of the morph off), then turn the morph on
  let found = null;
  for (let seed = 1; seed < 400 && !found; seed++) {
    const p = planOf(G.morphDoc(GROUND, { seed, pins: { 'work:morph.auto': pin(false) } }));
    const c = cutOf(p, 'rc~0');
    if (c.slots.arrive.v === 'weightGrow' && c.slots['text.weight'] && c.slots['text.weight'].from === 'rule') found = seed;
  }
  assert.ok(found, 'a seed with 太る on 光る窓の向こう');
  const p = planOf(G.morphDoc(GROUND, { seed: found }));
  const c = cutOf(p, 'rc~0');
  assert.equal(seamInto(p, 'rc~0').slot.v, MORPH);
  assert.equal(c.slots.arrive.v, 'instantShow');
  assert.equal(c.slots['text.weight'], undefined, 'the bold end belongs to 太る');
  // a pinned 太る is never replaced and keeps it (the pinned entrance also keeps the rule away: a pinned seam here)
  const kept = planOf(G.morphDoc(GROUND, { seed: found, pins: { 'line/rc:arrive': pin('weightGrow'), 'cut/rc~0:seam': pin(MORPH, { sig: '光る窓の向こう' }) } }));
  assert.equal(cutOf(kept, 'rc~0').slots.arrive.v, 'weightGrow');
  assert.equal(cutOf(kept, 'rc~0').slots['text.weight'].from, 'rule');
});

// --- 6. locks ------------------------------------------------------------------------------------------------------------

test('locks: locking a line on either side of a morph changes nothing; the lock freezes the morph as a seam pin', () => {
  const doc = G.morphDoc(GROUND);
  const plan = planOf(doc);
  const values = (p) => p.cuts.map((c) => [c.key, c.a, c.b, Object.keys(c.slots).sort().map((k) => k + '=' + JSON.stringify(c.slots[k].v)).join(' ')]);
  const seams = (p) => p.seams.map((s) => [s.into, s.at, s.dur, s.slot.v, JSON.stringify(s.slot.p), JSON.stringify(s.glyphs)]);
  for (const line of ['r3', 'r4', 'r5', 'r6', 'r8', 'rb', 'rc']) {
    const lock = FI.lockPayload(doc, plan, line, { registry: CAT });
    const locked = Object.assign({}, doc, { pins: Object.assign({}, doc.pins, lock.pins), locks: Object.assign({}, doc.locks, { [line]: { n: 1 } }) });
    const q = planOf(locked);
    assert.deepEqual(values(q), values(plan), 'lock ' + line + ': cuts');
    assert.deepEqual(seams(q), seams(plan), 'lock ' + line + ': seams');
    assert.equal(q.hash, PL.run(locked, CAT, { fresh: true }).hash, 'lock ' + line + ': re-plan');
    if (line === 'r4') {
      assert.deepEqual(lock.pins['cut/r4~0:seam'], { v: MORPH, by: 'lock', sig: '青い海へ' });
      assert.equal(seamInto(q, 'r4~0').slot.from, 'pin:cut');
    }
  }
});

// --- 7. the memo: re-planning equals planning from scratch -----------------------------------------------------------------

test('memo: re-planning after edits around a morph gives exactly the plan made from scratch', () => {
  let doc = G.morphDoc(GROUND);
  const setRow = (d, id, src) => {
    const out = Object.assign({}, d, { sheet: Object.assign({}, d.sheet, { rows: d.sheet.rows.map((r) => (r.id === id ? { id, src } : r)) }) });
    return out;
  };
  const withPins = (d, pins) => Object.assign({}, d, { pins: Object.assign({}, d.pins, pins) });
  const plan0 = planOf(doc);
  const steps = [
    (d) => setRow(d, 'r3', '赤い空へ'),                   // A's text: shares nothing meaningful any more (the memo's prev)
    (d) => setRow(d, 'r3', '青い空へ'),
    (d) => setRow(d, 'r4', '赤い海へ'),                   // B's text, the same features: B's cast is reused, its seam must not be
    (d) => setRow(d, 'r4', '青い海へ'),
    (d) => withPins(d, { 'line/r3:depart': pin('fogOut') }),
    (d) => withPins(d, { 'line/r3:depart': undefined }),
    (d) => withPins(d, { 'work:morph.auto': pin(false) }),
    (d) => withPins(d, { 'work:morph.auto': undefined, 'line/r4:morph.auto': pin(false) }),
    (d) => withPins(d, { 'line/r4:morph.auto': pin(true), 'line/r3:end': pin(cutOf(plan0, 'r3~0').t1 + 0.3) }),
    (d) => withPins(d, { 'line/r3:end': undefined }),
    (d) => withPins(d, { 'cut/r6~0:seam': pin(MORPH, { sig: '朝の町を歩く' }) }),
    (d) => setRow(d, 'r5', '夜の町を走る'),
    (d) => Object.assign({}, d, { salts: { 'cut/r4~0:seam': 1 } }),   // a die on a rule-picked morph: the rule stands aside
    (d) => Object.assign({}, d, { salts: {} }),
    (d) => Object.assign({}, d, { look: Object.assign({}, d.look, { gen: undefined }) }),   // the marker gone: both switches off
    (d) => Object.assign({}, d, { look: Object.assign({}, d.look, { gen: 1 }) }),
  ];
  let edits = 0;
  for (const step of steps) {
    doc = step(doc);
    for (const k of Object.keys(doc.pins)) if (doc.pins[k] === undefined) delete doc.pins[k];
    const p = planOf(doc);
    const fresh = PL.run(doc, CAT, { fresh: true });
    assert.equal(p.hash, fresh.hash, 'edit ' + edits);
    assert.deepEqual(p.warnings, fresh.warnings);
    edits++;
  }
  // the B text case really reused B's cast
  const d1 = G.morphDoc(GROUND);
  planOf(d1);
  const d2 = setRow(d1, 'r4', '赤い海へ');
  const p2 = planOf(d2);
  assert.ok(cutOf(p2, 'r4~0').seamIn < 0 || seamInto(p2, 'r4~0').slot.v !== MORPH, '赤い海へ shares only い and へ with 青い空へ');
});
