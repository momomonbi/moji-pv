/* 文字PVメーカー v2 — original work. Tests: 「効果を重ねすぎない」 (T5 of 文字PVの定石): the lettering rule and the cut budget (DESIGN_2_2 §2.6). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const D = MV.use('core/doc');
const PL = MV.use('planner/plan');
const CH = MV.use('planner/choose');
const EX = MV.use('planner/explain');
const RU = MV.use('planner/rules');
const FX = MV.use('planner/fxcap');
const PINS = MV.use('core/pins');
const CMD = MV.use('core/commands');
const R = MV.use('core/rng');
const FAC = MV.use('engine/facade');
const BUILD = MV.use('engine/scene/build');
const FR = MV.use('engine/scene/frame');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const CAT = MV.use('parts/catalog').defaultRegistry();

const clone = (x) => JSON.parse(JSON.stringify(x));
const J = (x) => JSON.stringify(x);
const ON = (v) => ({ v, by: 'user' });
const P2 = ['pv.rules', 'repeat.same', 'pv.kit', 'pv.alternate', 'pv.arc', 'pv.fxCap', 'pv.fxMax'];
const OTHER_OFF = Object.freeze(Object.fromEntries(RU.ROWS.filter((r) => !P2.includes(r.slot) && r.off !== null)
  .map((r) => ['work:' + r.slot, ON(r.off)])));
const MOODS = CAT.keys('mood');
const STYLES = MV.use('core/registry').TEXT_STYLES;
const PER_CUT = new Set(['lyric', 'focus']);

// A new work (generation 1) made of a fixture document, the other packages' switches off.
function gen1(doc, pins) {
  const out = clone(doc);
  out.look.gen = D.GEN;
  out.pins = Object.assign({}, out.pins, OTHER_OFF, pins || {});
  return out;
}
function fxOff(doc) { const out = clone(doc); out.pins['work:pv.fxCap'] = ON(false); return out; }
function fresh(doc) { return PL.run(doc, CAT, { fresh: true }); }
function ctxOf(doc, plan) {
  return { registry: CAT, ix: PINS.index(doc.pins), look: { amounts: plan.look.amounts }, rules: RU.resolve({ doc, ix: PINS.index(doc.pins) }) };
}
function count(c, slot) { return c.slots[slot] ? c.slots[slot].v : 0; }
function film(plan) {
  const mood = CAT.get('mood', plan.look.mood.v);
  return MV.use('planner/cast').filterDrive({ amounts: plan.look.amounts, mood });
}
// cut key → background index, from the Plan's segments (a boundary between two segments changes the background)
function groundsOf(plan) {
  const out = new Map();
  plan.grounds.forEach((g, i) => { for (const k of g.cuts) out.set(k, i); });
  return out;
}

// --- the lettering rule ---------------------------------------------------------------------------------------------

// The glyph channels a motion part's scene shows: the pose columns of its letters that leave rest at some moment of the
// cut (a sample cut with only that part; the others are the fallbacks, which show none). The weight channel wt is
// watched as soon as the scene table has it (P4).
const MEASURER = fakeMeasurer();
function channelsOf(kind, key) {
  const plan = FAC.samplePlan(CAT, { kind, key }, {});
  const cut = plan.cuts[0];
  const scene = BUILD.buildCut(cut, plan, { registry: CAT, text: createTextService({ measurer: MEASURER, faces: plan.look.faces }), strict: true });
  const cols = ['glow', 'echo', 'tint', 'blur', 'shard', 'pixel', 'wt'].filter((c) => scene.table.base[c]);
  const got = new Set();
  for (let k = 0; k <= 80; k++) {
    FR.evaluate(scene, cut.a + (cut.b - cut.a) * k / 80);
    for (const c of cols) {
      if (got.has(c)) continue;
      const L = scene.table.live[c], B = scene.table.base[c];
      for (let i = 0; i < L.length; i++) if (Math.abs(L[i] - B[i]) > 1e-9) { got.add(c); break; }
    }
  }
  return [...got].sort();
}

test('GLYPH: every catalog motion part has exactly the glyph channels its scene shows', () => {
  const differ = [];
  for (const kind of FX.MOTION_KINDS) {
    for (const def of CAT.all(kind)) {
      const want = channelsOf(kind, def.key);
      const have = FX.glyphOf(kind, def.key).slice().sort();
      if (J(want) !== J(have)) differ.push([kind + '/' + def.key, want, have]);
    }
  }
  assert.deepEqual(differ, [], 'kind/key, the engine\'s channels, the table\'s');
  // entries for parts the catalog does not have are P4's weight parts only (inert until they land)
  const extra = Object.keys(FX.GLYPH).filter((name) => { const [k, key] = name.split('/'); return !CAT.has(k, key); });
  for (const name of extra) assert.ok(['arrive/weightGrow', 'dwell/weightPulse', 'depart/weightThin'].includes(name), name);
  for (const name of extra) assert.deepEqual(FX.GLYPH[name], ['wt']);
});

test('clash: glow on glow, an after-image on an edge, weight on a two-layer fill, never three channels; tint is free', () => {
  const S = FX.STYLE_CH;
  assert.equal(FX.clash(S.glow, ['glow', 'tint'], 'glow'), true);
  assert.equal(FX.clash(S.outline, ['echo'], 'outline'), true);
  assert.equal(FX.clash(S.duo, ['echo', 'tint'], 'duo'), true);
  assert.equal(FX.clash(S.plain, ['echo', 'tint'], 'plain'), false);
  assert.equal(FX.clash(S.outline, ['glow', 'tint'], 'outline'), false, 'two channels are fine');
  assert.equal(FX.clash(S.glow, ['blur', 'tint'], 'glow'), false, 'a colour shift does not stack');
  assert.equal(FX.clash(['glow', 'wt'], ['blur'], 'glow'), true, 'three channels at once');
  assert.equal(FX.clash(S.shadow, ['wt'], 'shadow'), true, 'P4: no weight animation on a shadowed fill');
  assert.equal(FX.clash(S.plain, ['wt'], 'plain'), false);
  // a text screen effect adds to one phase at a time, never twice the same channel
  const block = (style, chosen, prior) => FX.letterBlock('filter', style, chosen, prior);
  const calm = { arrive: 'instantShow', dwell: 'stillHold', depart: 'instantHide' };
  assert.equal(block('plain', calm, null), null);
  assert.ok(block('glow', calm, null).has('glowSpill'));
  assert.ok(block('outline', calm, null).has('afterImage'));
  assert.ok(block('plain', Object.assign({}, calm, { arrive: 'ghostConverge' }), null).has('afterImage'), 'echo on echo');
  assert.ok(block('glow', Object.assign({}, calm, { depart: 'fogOut' }), null).has('chromaSlip'), 'glow + blur + split');
  assert.ok(!block('glow', Object.assign({}, calm, { depart: 'fogOut' }), null).has('grainFilm'), 'only text effects');
  assert.ok(block('plain', Object.assign({}, calm, { arrive: 'inkRise' }), ['glow']).has('chromaSlip'), 'an earlier text effect counts');
  assert.equal(FX.letterBlock('arrange', 'glow', calm, null), null);
  assert.ok(FX.letterBlock('arrive', 'glow', null, null).has('bloomOpen'));
  assert.ok(FX.letterBlock('depart', 'glow', null, null).has('burnOut'));
  assert.ok(FX.letterBlock('arrive', 'outline', null, null).has('staticJoin'));
  assert.equal(FX.letterBlock('dwell', 'plain', null, null), null);
});

// The motions and text screen effects of a plan that clash with their cut's lettering: automatic picks only.
function clashes(plan) {
  const out = [];
  for (const c of plan.cuts) {
    const style = c.slots['text.style'] ? c.slots['text.style'].v : 'plain';
    const S = FX.STYLE_CH[style] || [];
    for (const kind of FX.MOTION_KINDS) {
      const d = c.slots[kind];
      if (d && d.from === 'auto' && FX.clash(S, FX.glyphOf(kind, d.v), style)) out.push(c.key + ' ' + kind + ' ' + d.v);
    }
    const phases = { arrive: c.slots.arrive.v, dwell: c.slots.dwell.v, depart: c.slots.depart.v };
    for (let i = 0; i < count(c, 'filter.count'); i++) {
      const d = c.slots['filter#' + i];
      const b = d && d.from === 'auto' ? FX.letterBlock('filter', style, phases, FX.priorFilters(c.slots, i)) : null;
      if (b && b.has(d.v)) out.push(c.key + ' filter#' + i + ' ' + d.v);
    }
  }
  return out;
}

test('the lettering never carries two effects of the same kind (every mood and text style); without the rule it does', (t) => {
  const docs = corpus.corpus(1, ['16:9', '9:16'], ['basic', 'vertical', 'lrc']);
  let n = 0, on = 0, off = 0, cuts = 0;
  for (const mood of MOODS) {
    STYLES.forEach((style, s) => {
      for (const k of [0, 3]) {
        const { doc } = docs[(n + s + k) % docs.length];
        const d = gen1(doc, { 'work:mood': ON(mood), 'work:text.style': ON(style) });
        const p = fresh(d);
        const bad = clashes(p);
        on += bad.length;
        assert.deepEqual(bad, [], mood + ' ' + style);
        off += clashes(fresh(fxOff(d))).length;
        cuts += p.cuts.length;
      }
      n++;
    });
  }
  t.diagnostic('clashing picks over ' + cuts + ' cuts: ' + on + ' with the rule, ' + off + ' without');
  assert.ok(off > 50, 'without the rule the corpus has clashes (' + off + ')');
});

test('the chooser: a blocked candidate is passed over for every pick; a pool that is all blocked still gives its part', () => {
  const mood = CAT.get('mood', 'quietHush');
  const ch = CH.createChooser(CAT, { mood, theme: CAT.get('theme', CAT.keys('theme')[0]), season: 'any', amounts: mood.amounts });
  const blockBloom = { f: () => 1, member: () => false, block: (k) => k === 'bloomOpen' };
  const feat = { energy: 0.5, words: 2, cells: 8 };
  let sawBloom = 0;
  for (let s = 0; s < 60; s++) {
    const req = { kind: 'arrive', keys: ['bloomOpen', 'fogIn'], feat, chosen: {}, seed: 1000 + s, variety: 1,
      recent: { prev: ['fogIn'], near: [], families: [] }, ref: { prev: [], near: [], families: [] } };
    const free = ch.pick(Object.assign({}, req));
    if (free.v === 'bloomOpen' || free.base === 'bloomOpen') sawBloom++;
    const got = ch.pick(Object.assign({}, req, { pv: blockBloom }));
    assert.deepEqual([got.v, got.base, got.ref], ['fogIn', 'fogIn', 'fogIn'], 'seed ' + s);
    assert.equal(got.letterFallback, undefined);
  }
  assert.ok(sawBloom > 10, 'without the block bloomOpen is picked (' + sawBloom + ')');
  // everything blocked: the pick falls back to the unblocked argmax (a pool is never emptied)
  const trace = [];
  const all = ch.pick({ kind: 'arrive', keys: ['bloomOpen'], feat, chosen: {}, seed: 7, variety: 1, trace,
    pv: { f: () => 1, member: () => false, block: () => true } });
  assert.ok(all && all.v === 'bloomOpen' && all.letterFallback === true);
  assert.equal(trace.length, 1, 'the trace starts over for the fallback');
  // explain's alternatives: a blocked candidate weighs 0 and says why
  const tr = [];
  ch.pick({ kind: 'arrive', keys: ['bloomOpen', 'fogIn'], feat, chosen: {}, seed: 7, variety: 1, trace: tr, pv: blockBloom });
  const bloom = tr.find((c) => c.key === 'bloomOpen');
  assert.equal(bloom.w, 0);
  assert.equal(bloom.f.pvLetter, 0);
  const f = {};
  assert.equal(ch.weigh({ kind: 'arrive', feat, chosen: {}, pv: blockBloom }, 'bloomOpen', f), 0);
  assert.equal(f.pvLetter, 0);
});

// --- the cut budget -------------------------------------------------------------------------------------------------

// Checks the cut budget on one plan: every automatic lyric cut (no pinned or aligned count, not キメ) is at its cap or
// under it after its trim, or has nothing left to trim; a transition comes in only where the cut has room, the
// background changes, the seam is pinned or copied, or the cut is a キメ line. → the number of cuts checked.
function checkBudget(doc, plan, label) {
  const ctx = ctxOf(doc, plan);
  const ix = ctx.ix;
  const fd = film(plan);
  let checked = 0;
  for (const c of plan.cuts) {
    const L = plan.pv.loads.get(c.key);
    if (!PER_CUT.has(c.role)) { assert.equal(L, undefined); continue; }
    assert.ok(L, label + ' ' + c.key + ' has its load');
    const x = FX.xOn(ctx, c);
    assert.equal(L.cap, FX.capOf(ctx, c, x), label + ' ' + c.key + ' cap');
    const o = c.slots['ornament.count'], f = c.slots['filter.count'];
    const pinned = (d) => typeof d.from === 'string' && d.from.startsWith('pin');
    if (L.kime || L.aligned || pinned(o) || pinned(f)) continue;
    checked++;
    if (L.load <= L.cap) continue;
    let needF = 0;
    for (let i = 0; i < 4; i++) if (c.slots['filter#' + i] && pinned(c.slots['filter#' + i])) needF = i + 1;
    const atFloor = o.v === FX.needOf(c.slots, o.v) && f.v <= Math.max(needF, FX.keepOf(ctx, c, fd, f.v));
    assert.ok(atFloor, label + ' ' + c.key + ': load ' + L.load + ' over cap ' + L.cap + ' with ' + o.v + ' decorations and ' +
      f.v + ' screen effects');
  }
  const g = groundsOf(plan);
  const byKey = new Map(plan.cuts.map((c, i) => [c.key, i]));
  for (const s of plan.seams) {
    const L = plan.pv.loads.get(s.into);
    if (!L || L.load <= L.cap || L.kime || L.aligned) continue;
    const B = plan.cuts[byKey.get(s.into)], A = plan.cuts[byKey.get(s.into) - 1];
    if (g.get(A.key) !== g.get(B.key)) continue;
    assert.ok(s.slot.from.startsWith('pin'), label + ': a transition into ' + s.into + ', over its cap (' + L.load + ' > ' + L.cap + ')');
  }
  void ix;
  return checked;
}

test('the cut budget holds as specified for automatic lyric cuts; transitions only where there is room or a new background', () => {
  let checked = 0, trimmed = 0, over = 0;
  for (const mood of MOODS) {
    for (const { name, doc } of corpus.corpus(1, ['16:9', '9:16'])) {
      const d = gen1(doc, { 'work:mood': ON(mood) });
      const p = fresh(d);
      checked += checkBudget(d, p, mood + ' ' + name);
      for (const c of p.cuts) if (c.slots['ornament.count'] && c.slots['ornament.count'].from === 'rule') trimmed++;
      for (const [, L] of fresh(fxOff(d)).pv.loads) if (L.load > L.cap) over++;
    }
  }
  assert.ok(checked > 1000, 'cuts checked: ' + checked);
  assert.ok(trimmed > 20 && over > 20, 'the budget acts: ' + trimmed + ' trimmed, ' + over + ' over the cap without it');
});

const BUSY = Object.freeze({ 'work:ornament.count': ON(3), 'work:filter.count': ON(2), 'work:mood': ON('quietHush') });

test('the seam gate: a cut still over its cap gets no automatic transition unless the background changes', () => {
  // pinned counts (three decorations, two screen effects) cannot be trimmed: under a calm mood's cap every cut stays over
  let gated = 0, withoutGate = 0;
  for (const { name, doc } of corpus.corpus(2, ['16:9'], ['basic', 'long'])) {
    const d = gen1(doc, BUSY);
    const p = fresh(d);
    checkBudget(d, p, name);
    const g = groundsOf(p);
    const text = (plan) => plan.seams.filter((s) => g.get(s.a) === g.get(s.b)).length;
    gated += text(p);
    withoutGate += text(fresh(fxOff(d)));
  }
  assert.ok(withoutGate > 5, 'text transitions without the budget: ' + withoutGate);
  assert.ok(gated < withoutGate / 3, 'text transitions with it: ' + gated + ' (without: ' + withoutGate + ')');
});

test('1カットに重ねる効果の目安 pinned 4–8: the budget holds with each cap; 3 is refused by the spec', () => {
  const base = corpus.project('basic').doc;
  let prev = null;
  for (const v of [4, 5, 6, 7, 8]) {
    const d = gen1(base, { 'work:pv.fxMax': ON(v), 'work:mood': ON('printColumn') });
    const p = fresh(d);
    checkBudget(d, p, 'cap ' + v);
    for (const c of p.cuts) {
      const L = p.pv.loads.get(c.key);
      if (L) assert.equal(L.cap, v + (c.impact ? 1 : 0), c.key);
    }
    const decorations = p.cuts.reduce((s, c) => s + count(c, 'ornament.count'), 0);
    if (prev !== null) assert.ok(decorations >= prev, 'a higher cap keeps more decorations');
    prev = decorations;
  }
  const bad = fresh(gen1(base, { 'work:pv.fxMax': ON(3) }));
  assert.ok(bad.warnings.some((w) => w.code === 'pin-bad-value' && w.path === 'work:pv.fxMax'));
  assert.ok([...bad.pv.loads.values()].every((L) => L.cap >= 4));
});

// The reduction table (the NOTES table): per mood, what the budget removes, counting decorations and screen effects on
// the cuts at most one over the cap too. Transitions and impact impulses are never removed by the trim.
test('how strong: per mood each element drops ≤ 15 % on cuts at most one over the cap; impulses never', (t) => {
  const rows = [];
  for (const mood of MOODS) {
    const a = { cuts: 0, trim: 0, oOff: 0, oOn: 0, oOff1: 0, oOn1: 0, fOff: 0, fOn: 0, fOff1: 0, fOn1: 0, sOff: 0, sOn: 0, overOff: 0, overOn: 0 };
    for (const { doc } of corpus.corpus(1, ['16:9', '9:16'])) {
      const d = gen1(doc, { 'work:mood': ON(mood) });
      const on = fresh(d), off = fresh(fxOff(d));
      assert.deepEqual(on.impulses, off.impulses, mood + ': impulses');
      const byKey = new Map(on.cuts.map((c) => [c.key, c]));
      for (const c of off.cuts) {
        const L = off.pv.loads.get(c.key);
        if (!L) continue;
        const o = byKey.get(c.key);
        a.cuts++;
        a.oOff += count(c, 'ornament.count'); a.oOn += count(o, 'ornament.count');
        a.fOff += count(c, 'filter.count'); a.fOn += count(o, 'filter.count');
        if (L.load <= L.cap + 1) {
          a.oOff1 += count(c, 'ornament.count'); a.oOn1 += count(o, 'ornament.count');
          a.fOff1 += count(c, 'filter.count'); a.fOn1 += count(o, 'filter.count');
        }
        if (o.slots['ornament.count'].from === 'rule' || o.slots['filter.count'].from === 'rule') a.trim++;
        if (L.load > L.cap) a.overOff++;
        if (on.pv.loads.get(c.key).load > on.pv.loads.get(c.key).cap) a.overOn++;
      }
      a.sOff += off.seams.length; a.sOn += on.seams.length;
    }
    const drop = (x, y) => (y ? (y - x) / y : 0);
    const pc = (x) => (100 * x).toFixed(0) + ' %';
    rows.push('| ' + mood + ' | ' + RU.baseCap(CAT.get('mood', mood).amounts) + ' | ' + pc(a.trim / a.cuts) + ' | −' + pc(drop(a.oOn, a.oOff)) + ' / −' +
      pc(drop(a.oOn1, a.oOff1)) + ' | −' + pc(drop(a.fOn, a.fOff)) + ' / −' + pc(drop(a.fOn1, a.fOff1)) + ' | ' + pc(drop(a.sOn, a.sOff)) +
      ' | 0 % | ' + pc(a.overOff / a.cuts) + ' → ' + pc(a.overOn / a.cuts) + ' |');
    assert.ok(drop(a.oOn1, a.oOff1) <= 0.15, mood + ': decorations −' + pc(drop(a.oOn1, a.oOff1)));
    assert.ok(drop(a.fOn1, a.fOff1) <= 0.15, mood + ': screen effects −' + pc(drop(a.fOn1, a.fOff1)));
    assert.ok(Math.abs(drop(a.sOn, a.sOff)) <= 0.15, mood + ': transitions ' + pc(drop(a.sOn, a.sOff)));
    assert.ok(a.overOn <= a.overOff, mood + ': cuts over the cap');
  }
  t.diagnostic('\n| mood | cap | cuts trimmed | decorations (all / ≤ cap+1) | screen effects (all / ≤ cap+1) | transitions | impulses | cuts above cap |\n' + rows.join('\n'));
});

test('moods keep their identity in new works: film moods show their screen effects; moods still differ', () => {
  const lyrics = CMD.reduce(D.newDoc(), { t: 'lyrics.set', text: corpus.sampleLyrics() });
  const sample = (mood) => {
    const out = { cuts: 0, picks: [], filters: [] };
    for (let s = 1; s <= 2; s++) {
      for (const aspect of ['16:9', '9:16', '1:1']) {
        const doc = Object.assign({}, lyrics, { look: Object.assign({}, lyrics.look, { aspect, seed: s * 101 + aspect.length,
          moodSeed: s * 7919 + aspect.length }), pins: Object.assign({ 'work:mood': ON(mood) }, OTHER_OFF) });
        for (const c of PL.plan(doc, { registry: CAT }).cuts) {
          if (!PER_CUT.has(c.role)) continue;
          out.cuts++;
          for (const slot of Object.keys(c.slots)) {
            const kind = slot.split(/[#.]/)[0];
            if (slot.includes('.') || slot === 'orient' || !CAT.has(kind, c.slots[slot].v)) continue;
            out.picks.push(kind + ':' + c.slots[slot].v);
            if (kind === 'filter') out.filters.push(c.slots[slot].v);
          }
        }
      }
    }
    return out;
  };
  const S = {};
  for (const mood of ['silverReel', 'printColumn', 'quietHush', 'glitchFracture', 'popFizz']) S[mood] = sample(mood);
  const per = (m) => S[m].filters.length / S[m].cuts;
  assert.ok(per('silverReel') >= 0.4, 'silverReel ' + per('silverReel').toFixed(2));
  assert.ok(per('printColumn') >= 0.15, 'printColumn ' + per('printColumn').toFixed(2));
  assert.ok(per('quietHush') >= 0.2, 'quietHush ' + per('quietHush').toFixed(2));
  assert.ok(S.silverReel.filters.filter((k) => k === 'cinemaBars').length / S.silverReel.cuts >= 0.08, 'letterbox bars');
  const tv = (a, b) => {
    const ca = new Map(), cb = new Map();
    for (const k of a.picks) ca.set(k, (ca.get(k) || 0) + 1);
    for (const k of b.picks) cb.set(k, (cb.get(k) || 0) + 1);
    let x = 0;
    for (const k of new Set([...ca.keys(), ...cb.keys()])) x += Math.abs((ca.get(k) || 0) / a.picks.length - (cb.get(k) || 0) / b.picks.length);
    return x / 2;
  };
  assert.ok(tv(S.quietHush, S.glitchFracture) > 0.15, 'calm vs glitch ' + tv(S.quietHush, S.glitchFracture).toFixed(3));
  assert.ok(tv(S.quietHush, S.popFizz) > 0.1, 'calm vs pop ' + tv(S.quietHush, S.popFizz).toFixed(3));
});

test('pins win: pinned decorations, a pinned screen-effect count, a pinned seam and a pinned lens stay, without warnings', () => {
  const base = gen1(corpus.project('basic').doc, { 'work:mood': ON('printColumn'), 'work:amount.ornament': ON(1) });
  const p0 = fresh(base);
  const cuts = p0.cuts.filter((c) => c.role === 'lyric');
  const [a, b, c, d] = [cuts[1], cuts[2], cuts[3], cuts[5]];
  const doc = clone(base);
  const pin = (cut, slot, v) => { doc.pins['cut/' + (cut.pinKey || cut.key) + ':' + slot] = { v, by: 'user', sig: cut.text }; };
  pin(a, 'ornament#2', CAT.keys('ornament').find((k) => CAT.get('ornament', k).scope === 'cut' && CAT.get('ornament', k).pool !== false));
  pin(b, 'filter.count', 3);
  pin(c, 'seam', 'swishCut');
  pin(d, 'lens', 'handHeld');
  pin(d, 'ornament.count', 3);
  const p = fresh(doc);
  const at = (cut) => p.cuts.find((x) => x.key === cut.key);
  assert.ok(count(at(a), 'ornament.count') >= 3, 'a pinned ornament#2 keeps three decorations');
  assert.ok(at(a).slots['ornament#2'].from.startsWith('pin'));
  assert.equal(count(at(b), 'filter.count'), 3);
  assert.ok(p.seams.some((s) => s.into === c.key && s.slot.v === 'swishCut'));
  assert.equal(at(d).slots.lens.v, 'handHeld');
  assert.equal(count(at(d), 'ornament.count'), 3);
  const codes = (plan) => plan.warnings.map((w) => w.code + ' ' + w.path).sort();
  assert.deepEqual(codes(p), codes(fresh(fxOff(doc))), 'no warning of its own');
});

test('the camera is untouched: where a cut\'s parts are the same, so is its camera; EXTREME moves do not drop', () => {
  let same = 0;
  for (const mood of ['quietHush', 'printColumn', 'glitchFracture']) {
    for (const { doc } of corpus.corpus(1, ['16:9', '9:16'], ['basic', 'lrc'])) {
      const d = gen1(doc, { 'work:mood': ON(mood), 'work:text.style': ON('glow') });
      const on = fresh(d), off = fresh(fxOff(d));
      const byKey = new Map(off.cuts.map((c) => [c.key, c]));
      for (const c of on.cuts) {
        const o = byKey.get(c.key);
        if (!['arrange', 'arrive', 'dwell', 'depart', 'lens'].every((k) => J(c.slots[k]) === J(o.slots[k]))) continue;
        for (const k of ['cam.shot', 'cam.zoom', 'cam.curve', 'cam.follow']) assert.equal(J(c.slots[k]), J(o.slots[k]), c.key + ' ' + k);
        same++;
      }
    }
  }
  assert.ok(same > 200, 'cuts compared: ' + same);
  const extreme = gen1(corpus.project('basic').doc, { 'work:cam.extreme': ON(1) });
  const moves = (plan) => plan.cuts.filter((c) => c.slots['cam.shot'] && MV.use('core/shot').isExtreme(c.slots['cam.shot'].v)).length;
  const xOn = fresh(extreme), xOff = fresh(fxOff(extreme));
  assert.ok(moves(xOff) > 0);
  assert.ok(moves(xOn) >= moves(xOff), 'EXTREME moves: ' + moves(xOn) + ' vs ' + moves(xOff));
  for (const [, L] of xOn.pv.loads) assert.ok(L.cap === RU.baseCap(xOn.look.amounts) + 1 || L.cap === RU.baseCap(xOn.look.amounts) + 2, 'EXTREME gives one more');
});

test('キメ lines and cuts without lyrics are never trimmed or gated', () => {
  const doc = gen1(corpus.project('basic').doc, { 'work:mood': ON('quietHush') });
  const p = fresh(doc);
  const ctx = ctxOf(doc, p);
  const lyric = p.cuts.find((c) => c.role === 'lyric');
  const over = { cut: lyric, slots: Object.assign({}, lyric.slots, { 'ornament.count': { v: 3, from: 'auto' },
    'filter.count': { v: 2, from: 'auto' } }), fromAlign: null };
  assert.ok(FX.trim(ctx, over, 0, 0, false), 'a busy lyric cut is trimmed');
  assert.equal(FX.trim(ctx, over, 0, 0, true), null, 'not on a キメ line');
  assert.equal(FX.trim(ctx, Object.assign({}, over, { cut: Object.assign({}, lyric, { role: 'title' }) }), 0, 0, false), null);
  assert.equal(FX.trim(ctx, Object.assign({}, over, { fromAlign: new Set(['ornament.count', 'filter.count']) }), 0, 0, false), null,
    'not an aligned copy\'s counts');
  const B = Object.assign({}, lyric, { slots: over.slots });
  assert.equal(FX.gate(ctx, B, B.slots, false, false), true);
  assert.equal(FX.gate(ctx, B, B.slots, true, false), false, 'a new background may come in with a transition');
  assert.equal(FX.gate(ctx, B, B.slots, false, true), false, 'a キメ line keeps its transition');
});

test('explain: a reduced count says pv.fx, a gated seam says pv.fx, a blocked pick names pv.letter', () => {
  const doc = gen1(corpus.project('long').doc, { 'work:mood': ON('printColumn') });
  const p = fresh(doc);
  const cut = p.cuts.find((c) => c.slots['ornament.count'] && c.slots['ornament.count'].from === 'rule');
  assert.ok(cut, 'a trimmed cut');
  const e = EX.explain(doc, p, 'cut/' + cut.key + ':ornament.count', { registry: CAT });
  assert.equal(e.value, cut.slots['ornament.count'].v);
  assert.deepEqual(e.why, [{ code: 'rule', params: { rule: 'pv.fx' } }]);
  // a gated seam
  const gd = gen1(corpus.project('basic').doc, BUSY);
  const gp = fresh(gd), gOff = fresh(fxOff(gd));
  const lost = gOff.seams.find((s) => !gp.seams.some((x) => x.into === s.into) && gp.pv.loads.get(s.into) &&
    gp.pv.loads.get(s.into).load > gp.pv.loads.get(s.into).cap);
  assert.ok(lost, 'a transition the gate took away');
  const es = EX.explain(gd, gp, 'cut/' + lost.into + ':seam', { registry: CAT });
  assert.ok(es.why.some((w) => w.code === 'pv.fx'), J(es.why));
  // a blocked pick: glowing text never takes a glowing entrance, and says so
  const glow = gen1(corpus.project('basic').doc, { 'work:text.style': ON('glow'), 'work:mood': ON('dreamHaze') });
  const pg = fresh(glow);
  let named = 0;
  for (const c of pg.cuts.filter((x) => x.role === 'lyric' && x.slots.arrive.from === 'auto').slice(0, 8)) {
    const tr = PL.trace(glow, { registry: CAT }, { cutKey: c.key, slot: 'arrive' });
    assert.equal(tr.plan.hash, pg.hash);
    const bloom = (tr.out.candidates || []).find((x) => x.key === 'bloomOpen');
    if (!bloom) continue;
    assert.equal(bloom.w, 0);
    const ex = EX.explain(glow, pg, 'cut/' + c.key + ':arrive', { registry: CAT });
    if (ex.why.some((w) => w.code === 'pv.letter')) named++;
    assert.equal(ex.alts.find((x) => x.key === 'bloomOpen').w, 0);
  }
  assert.ok(named >= 3, 'named ' + named);
});

test('re-planning with the budget toggled and its number pinned gives exactly the plan made from scratch', () => {
  const edit = (rng, doc, p) => {
    const d = Object.assign({}, doc);
    const cut = rng.pick(p.cuts);
    const r = rng.next();
    if (r < 0.2) d.pins = Object.assign({}, d.pins, { 'work:pv.fxCap': ON(rng.chance(0.5)) });
    else if (r < 0.35) d.pins = Object.assign({}, d.pins, { 'work:pv.fxMax': ON(rng.int(4, 8)) });
    else if (r < 0.45) { d.pins = Object.assign({}, d.pins); delete d.pins['work:pv.fxMax']; }
    else if (r < 0.55) d.pins = Object.assign({}, d.pins, { 'work:mood': ON(rng.pick(MOODS)) });
    else if (r < 0.65) d.pins = Object.assign({}, d.pins, { 'work:text.style': ON(rng.pick(STYLES)) });
    else if (r < 0.9) {
      const k = rng.pick(['cut/' + cut.key, 'cut/' + cut.key + ':ornament.count', 'cut/' + cut.key + ':filter#0', 'line/' + (cut.line || 'x')]);
      d.salts = Object.assign({}, d.salts, { [k]: ((d.salts || {})[k] || 0) + 1 });
    } else {
      const rows = d.sheet.rows.slice();
      const i = rng.int(0, rows.length - 1);
      rows[i] = Object.assign({}, rows[i], { src: rows[i].src + 'あ' });
      d.sheet = Object.assign({}, d.sheet, { rows });
    }
    return d;
  };
  let steps = 0;
  for (const name of ['basic', 'repeat']) {
    const rng = R.stream('fxreplan', name);
    let doc = gen1(corpus.project(name).doc, { 'work:pv.kit': ON(false), 'work:pv.arc': ON(false), 'work:pv.alternate': ON(false) });
    for (let i = 0; i < 20; i++) {
      const p = PL.plan(doc, { registry: CAT });
      assert.equal(p.hash, fresh(doc).hash, name + ' step ' + i);
      steps++;
      doc = edit(rng, doc, p);
    }
  }
  assert.ok(steps >= 40);
});

test('stability with only the budget on: an inserted line keeps the other choices', () => {
  let same = 0, total = 0;
  for (const { doc } of corpus.corpus(2, ['16:9', '9:16'], ['basic', 'long'])) {
    const d0 = gen1(doc, { 'work:pv.rules': ON(false), 'work:pv.fxCap': ON(true) });
    const p0 = fresh(d0);
    const at = Math.floor(d0.sheet.rows.length / 2);
    const d1 = clone(d0);
    d1.sheet.rows.splice(at, 0, { id: 'r' + (d1.sheet.next++).toString(36), src: '途中に足した一行' });
    const p1 = fresh(d1);
    const before = new Map(p0.cuts.map((c) => [c.key, c]));
    for (const c of p1.cuts) {
      const b = before.get(c.key);
      if (!b || !c.line) continue;
      for (const k of ['arrange', 'arrive', 'dwell', 'depart', 'lens', 'ornament.count', 'filter.count']) {
        total++;
        if (J(c.slots[k] && c.slots[k].v) === J(b.slots[k] && b.slots[k].v)) same++;
      }
    }
  }
  assert.ok(same / total >= 0.97, 'kept ' + (100 * same / total).toFixed(1) + ' %');
});
