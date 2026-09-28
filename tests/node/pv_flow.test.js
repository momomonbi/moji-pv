/* 文字PVメーカー v2 — original work. Tests: 「動きの向きを交互にする」 and 「曲の山に合わせて強弱をつける」 — directions and the song's arc (DESIGN_2_2 §2.5). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const D = MV.use('core/doc');
const S = MV.use('core/schema');
const PL = MV.use('planner/plan');
const CA = MV.use('planner/cast');
const FL = MV.use('planner/flow');
const ARC = MV.use('planner/arc');
const RU = MV.use('planner/rules');
const FI = MV.use('planner/fields');
const EX = MV.use('planner/explain');
const PINS = MV.use('core/pins');
const CMD = MV.use('core/commands');
const FAC = MV.use('engine/facade');
const BUILD = MV.use('engine/scene/build');
const BH = MV.use('engine/scene/behave');
const FR = MV.use('engine/scene/frame');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const CAT = MV.use('parts/catalog').defaultRegistry();

const clone = (x) => JSON.parse(JSON.stringify(x));
const ON = (v) => ({ v, by: 'user' });
const P2 = ['pv.rules', 'repeat.same', 'pv.kit', 'pv.alternate', 'pv.arc', 'pv.fxCap', 'pv.fxMax'];
const OTHER_OFF = Object.freeze(Object.fromEntries(RU.ROWS.filter((r) => !P2.includes(r.slot) && r.off !== null)
  .map((r) => ['work:' + r.slot, ON(r.off)])));
const KINDS = ['arrange', 'arrive', 'dwell', 'depart', 'lens'];
const AXES = ['h', 'side', 'rot'];

function gen1(doc, pins, keepRepeat) {
  const out = clone(doc);
  out.look.gen = D.GEN;
  if (!keepRepeat) delete out.pins['work:repeat.same'];
  out.pins = Object.assign({}, out.pins, OTHER_OFF, pins || {});
  return out;
}
function fresh(doc) { return PL.run(doc, CAT, { fresh: true }); }
function turned(d) { return !!(d && d.pfrom && Object.values(d.pfrom).includes('alt')); }

// The first directional value of a cut on each axis, in the slot order (its direction), and whether that value could
// turn (not pinned or set by a rule, not guarded).
function directions(c) {
  const own = { h: 0, side: 0, rot: 0 }, free = {};
  const orient = c.slots.orient ? c.slots.orient.v : 'h';
  for (const k of KINDS) {
    const d = c.slots[k];
    if (!d || !d.p) continue;
    const e = FL.entryOf(k, d.v);
    if (!e) continue;
    const s = e.sign(d.p);
    if (!s || own[e.axis]) continue;
    own[e.axis] = s;
    free[e.axis] = !(e.orient && orient !== e.orient) && !(e.when && !e.when(c.feat)) &&
      !e.names.some((n) => d.pfrom && d.pfrom[n] && d.pfrom[n] !== 'alt');
  }
  return { own, free };
}

// --- the table -------------------------------------------------------------------------------------------------------

test('the direction table names catalog parts and parameters, and every flip mirrors its sign', () => {
  assert.ok(FL.TABLE.length >= 16);
  for (const e of FL.TABLE) {
    assert.ok(CAT.has(e.kind, e.key), e.id);
    const params = new Map(CAT.params(e.kind, e.key).map((x) => [x.name, x]));
    for (const n of e.names) assert.ok(params.has(n), e.id + ' has ' + n);
    assert.ok(AXES.includes(e.axis));
    if (e.order) assert.ok(params.has(e.order.name), e.id + ' order');
    const spec = params.get(e.names[0]).spec;
    const values = spec.type === 'enum' ? spec.of : Array.from({ length: 200 }, (_, i) => S.coerce(spec, spec.min + (spec.max - spec.min) * i / 199));
    for (const v of values) {
      const p = Object.fromEntries(e.names.map((n) => [n, v]));
      const s = e.sign(p);
      const f = FL.flipValue(e, v, spec);
      assert.notEqual(f, undefined, e.id + ' flips ' + v);
      assert.equal(S.coerce(spec, f), f, e.id + ' flips into its spec');
      if (s !== 0) assert.equal(e.sign(Object.fromEntries(e.names.map((n) => [n, f]))), -s, e.id + ' ' + v);
    }
  }
  assert.equal(FL.entryOf('arrange', 'pillarColumns'), null, 'vertical columns keep the reading side');
  assert.equal(FL.unpack(FL.pack({ h: -1, side: 1, rot: 0 })).side, 1);
  assert.equal(FL.pack({ h: 0, side: 0, rot: 0 }), FL.NO_DIR);
});

// --- the table against the engine ------------------------------------------------------------------------------------

const MEASURER = fakeMeasurer();
function sceneOf(slots, text) {
  const plan = FAC.samplePlan(CAT, { kind: 'arrive', key: 'instantShow' }, { text });
  const cut = plan.cuts[0];
  Object.assign(cut.slots, slots);
  const scene = BUILD.buildCut(cut, plan, { registry: CAT, text: createTextService({ measurer: MEASURER, faces: plan.look.faces }), strict: true });
  return scene;
}
function decisionFor(kind, key, p) { return FAC.samplePlan(CAT, { kind, key, params: p || null }, {}).cuts[0].slots[kind]; }
function motionOf(scene, exit) { return scene.behaviours.find((b) => b.run === BH.runGlyphMotion && b.exit === exit); }
function xAt(scene, b, j, u) {
  FR.evaluate(scene, b.t0 + b.delay[j] + u * b.dur);
  return scene.table.m[(b.from + j) * 6 + 4];
}

// The travel of the glyphs between 30 % and 70 % of their motion has the sign the table gives; a flipped exit takes its
// glyphs from its downwind edge first (the coupled order), so none flies over one still at rest.
test('the table\'s signs are the engine\'s: sideways entrances and exits travel the way the table says', () => {
  const cases = [
    ['arrive', 'skewSlide', { xFrom: 2.4, kxFrom: -50 }, 'ことば'], ['arrive', 'skewSlide', { xFrom: -2.4, kxFrom: 50 }, 'ことば'],
    ['depart', 'skewExit', { xTo: -2.6, kxTo: 40 }, 'ab cd ef'], ['depart', 'skewExit', { xTo: 2.6, kxTo: -40, order: 'tail' }, 'ab cd ef'],
    ['depart', 'windBlow', { dir: 'left' }, 'ことばのかぜ'], ['depart', 'windBlow', { dir: 'right', order: 'tail' }, 'ことばのかぜ'],
  ];
  for (const [kind, key, p, text] of cases) {
    const d = decisionFor(kind, key, p);
    const scene = sceneOf({ [kind]: d }, text);
    const b = motionOf(scene, kind === 'depart');
    assert.ok(b, key);
    const n = b.to - b.from;
    const want = FL.entryOf(kind, key).sign(d.p);
    for (let j = 0; j < n; j++) {
      const travel = xAt(scene, b, j, 0.7) - xAt(scene, b, j, 0.3);
      assert.equal(Math.sign(travel), want, key + ' ' + JSON.stringify(p) + ' glyph ' + j);
    }
    if (kind === 'depart' && n > 1) {
      // the glyph that leaves first is the one furthest downwind (rest positions at the start of the hold)
      const rest = Array.from({ length: n }, (_, j) => xAt(scene, b, j, 0));
      const delays = Array.from(b.delay.slice(0, n));
      const downwind = want > 0 ? rest.indexOf(Math.max(...rest)) : rest.indexOf(Math.min(...rest));
      const upwind = want > 0 ? rest.indexOf(Math.min(...rest)) : rest.indexOf(Math.max(...rest));
      assert.equal(delays[downwind], Math.min(...delays), key + ' ' + JSON.stringify(p) + ' leaves from its downwind edge');
      assert.ok(delays[upwind] > delays[downwind], key + ' ' + JSON.stringify(p) + ': the upwind edge leaves last');
    }
  }
});

// --- alternation ---------------------------------------------------------------------------------------------------

let altCache = null;
function alternation() {
  if (altCache) return altCache;
  const run = (extra) => {
    const pairs = { h: [0, 0], side: [0, 0], rot: [0, 0] };
    for (const { doc } of corpus.corpus(10, ['16:9', '9:16', '1:1'])) {
      const d = gen1(doc, extra);
      const p = fresh(d);
      const al = CA.alignments({ ix: PINS.index(d.pins), doc: d }, p.cuts) || new Map();
      let prev = null, prevKey = null;
      for (const c of p.cuts) {
        const part = p.pv.parts.get(c.key);
        if (!part) { prev = null; continue; }
        const dir = directions(c);
        if (prev && prevKey === part.key && !FL.restartAt(d.look.seed, part, c.key) && !al.has(c.key)) {
          for (const ax of AXES) {
            if (!dir.own[ax] || !prev[ax] || !dir.free[ax]) continue;
            pairs[ax][1]++;
            if (dir.own[ax] !== prev[ax]) pairs[ax][0]++;
          }
        }
        prev = dir.own;
        prevKey = part.key;
      }
    }
    return pairs;
  };
  altCache = { on: run({}), off: run({ 'work:pv.alternate': ON(false) }) };
  return altCache;
}

// Over consecutive cuts of one part run whose second is neither a restart nor an aligned repeat (which keeps its first
// copy's directions) and whose value could turn: the directions differ in ≥ 80 % on every axis; without the switch
// about half the time.
test('directions alternate from cut to cut (≥ 80 % on every axis; about half without the switch)', (t) => {
  const { on, off } = alternation();
  const rate = (x) => x[0] / x[1];
  t.diagnostic('alternation on/off: ' + AXES.map((a) => a + ' ' + (100 * rate(on[a])).toFixed(1) + '/' + (100 * rate(off[a])).toFixed(1) +
    ' (' + on[a][1] + ')').join(', '));
  for (const ax of AXES) {
    assert.ok(on[ax][1] >= 50, ax + ' pairs ' + on[ax][1]);
    assert.ok(rate(on[ax]) >= 0.8, ax + ' ' + rate(on[ax]).toFixed(3));
    assert.ok(rate(off[ax]) >= 0.25 && rate(off[ax]) <= 0.65, ax + ' off ' + rate(off[ax]).toFixed(3));
  }
});

// A work with spins in and out on every cut, and one-word lines that slide in and blow away.
function spinDoc(extra) {
  return corpus.corpus(4, ['16:9', '9:16'], ['basic', 'long']).map(({ doc }) => gen1(doc, Object.assign({
    'work:arrive': ON('twirlArrive'), 'work:depart': ON('twirlDepart') }, extra || {})));
}

test('within a cut everything turns the same way; a one-word slide in blows away the other way round', (t) => {
  const agree = (docs) => {
    let same = 0, n = 0;
    for (const d of docs) {
      for (const c of fresh(d).cuts) {
        const a = c.slots.arrive, x = c.slots.depart;
        if (!a || !x || a.v !== 'twirlArrive' || x.v !== 'twirlDepart' || a.p.dir === 'alt' || x.p.dir === 'alt') continue;
        n++;
        if (a.p.dir === x.p.dir) same++;
      }
    }
    return same / n;
  };
  const on = agree(spinDoc()), off = agree(spinDoc({ 'work:pv.alternate': ON(false) }));
  t.diagnostic('twirl in/out agree on/off: ' + (100 * on).toFixed(1) + '/' + (100 * off).toFixed(1));
  assert.ok(on >= 0.95, on);
  assert.ok(off < 0.8, off);
  // a one-word horizontal cut: the slide's travel and the wind agree
  let ok = 0, n = 0;
  for (const { doc } of corpus.corpus(4, ['16:9'], ['basic', 'long'])) {
    const d = gen1(doc, { 'work:arrive': ON('skewSlide'), 'work:depart': ON('windBlow'), 'work:orient': ON('h') });
    for (const c of fresh(d).cuts) {
      if (c.feat.words !== 1 || !c.slots.arrive || c.slots.arrive.v !== 'skewSlide' || c.slots.depart.v !== 'windBlow') continue;
      n++;
      if (FL.signOf('arrive', 'skewSlide', c.slots.arrive.p) === FL.signOf('depart', 'windBlow', c.slots.depart.p)) ok++;
    }
  }
  assert.ok(n >= 20 && ok / n >= 0.95, ok + ' of ' + n);
});

test('pins, rules, guards and aligned copies keep their values and still give the cut its direction', () => {
  // a pinned direction is never turned, and the rest of the cut follows it
  const pinned = spinDoc({ 'work:arrive@twirlArrive.dir': ON('ccw') });
  let followed = 0, n = 0;
  for (const d of pinned) {
    for (const c of fresh(d).cuts) {
      const a = c.slots.arrive, x = c.slots.depart;
      if (!a || a.v !== 'twirlArrive') continue;
      assert.equal(a.p.dir, 'ccw');
      assert.equal(a.pfrom.dir, 'pin:work');
      if (x && x.v === 'twirlDepart' && x.p.dir !== 'alt') { n++; if (x.p.dir === 'ccw') followed++; }
    }
  }
  assert.ok(n > 20 && followed / n >= 0.95, followed + ' of ' + n);
  // guards: vertical text keeps its sides; a sideways entrance of more than one word keeps the reading side
  for (const { doc } of corpus.corpus(3, ['9:16'], ['vertical', 'basic'])) {
    const p = fresh(gen1(doc, { 'work:arrive': ON('skewSlide') }));
    for (const c of p.cuts) {
      const orient = c.slots.orient ? c.slots.orient.v : 'h';
      for (const k of KINDS) {
        const d = c.slots[k];
        const e = d && d.p ? FL.entryOf(k, d.v) : null;
        if (!e || !turned(d)) continue;
        assert.ok(!(e.orient && e.orient !== orient), c.key + ' ' + k + ' turned on ' + orient + ' text');
        assert.ok(!(e.when && !e.when(c.feat)), c.key + ' ' + k + ' turned outside its guard');
      }
    }
  }
  // an aligned copy keeps its source's directional values as the Plan shows them
  const doc = gen1(corpus.project('repeat').doc);
  const p = fresh(doc);
  const al = CA.alignments({ ix: PINS.index(doc.pins), doc }, p.cuts);
  let checked = 0;
  for (const c of p.cuts) {
    const src = al.get(c.key);
    if (!src) continue;
    for (const k of KINDS) {
      const d = c.slots[k], s = p.cuts.find((x) => x.key === src.key).slots[k];
      const e = d && d.p ? FL.entryOf(k, d.v) : null;
      if (!e || !s || s.v !== d.v) continue;
      for (const nme of e.names) if (!(d.pfrom && String(d.pfrom[nme]).startsWith('pin'))) { assert.deepEqual(d.p[nme], s.p[nme], c.key + ' ' + k + '.' + nme); checked++; }
    }
  }
  assert.ok(checked > 3, 'aligned directional values checked: ' + checked);
});

// A lock pins a turned direction as it is (planner/fields putParams); rerolling a neighbour leaves it.
test('a lock keeps a turned direction; its neighbours alternate against its unlocked view', () => {
  for (const d0 of spinDoc().slice(0, 4)) {
    const p0 = PL.plan(d0, { registry: CAT });
    const cut = p0.cuts.find((c) => c.line && (turned(c.slots.arrive) || turned(c.slots.depart)));
    if (!cut) continue;
    const payload = FI.lockPayload(d0, p0, cut.line, { registry: CAT });
    const slot = turned(cut.slots.arrive) ? 'arrive' : 'depart';
    const pk = 'cut/' + (cut.pinKey || cut.key) + ':' + slot + '@' + cut.slots[slot].v + '.dir';
    assert.deepEqual(payload.pins[pk], { v: cut.slots[slot].p.dir, by: 'lock', sig: cut.text }, 'the lock pins the turned value');
    let locked = CMD.reduce(d0, payload);
    const at = p0.cuts.indexOf(cut);
    for (const nb of [p0.cuts[at - 1], p0.cuts[at + 1]].filter(Boolean)) {
      locked = Object.assign({}, locked, { salts: Object.assign({}, locked.salts, { ['cut/' + nb.key]: 1 }) });
      const p1 = fresh(locked);
      assert.equal(p1.cuts.find((c) => c.key === cut.key).slots[slot].p.dir, cut.slots[slot].p.dir, 'locked ' + cut.key);
    }
  }
});

// A die on the direction draws it again: the value changes for many salts, and a drawn value is never marked turned.
test('the die on 向き draws the direction; the alternation leaves a drawn value alone', () => {
  const d0 = spinDoc()[0];
  const p0 = fresh(d0);
  const cut = p0.cuts.find((c) => c.line && c.slots.arrive && c.slots.arrive.v === 'twirlArrive' && turned(c.slots.arrive));
  assert.ok(cut, 'a turned twirl');
  const path = 'cut/' + cut.key + ':arrive@twirlArrive.dir';
  let changed = 0;
  for (let salt = 1; salt <= 60; salt++) {
    const d = Object.assign({}, d0, { salts: Object.assign({}, d0.salts, { [path]: salt }) });
    const a = fresh(d).cuts.find((c) => c.key === cut.key).slots.arrive;
    assert.ok(!(a.pfrom && a.pfrom.dir), 'a drawn value is not turned');
    if (a.p.dir !== cut.slots.arrive.p.dir) changed++;
  }
  assert.ok(changed / 60 >= 0.4, changed + ' of 60');
});

test('seams alternate their sideways direction; copied and pinned seams keep theirs', () => {
  let alt = 0, n = 0;
  for (const { doc } of corpus.corpus(6, ['16:9', '9:16'], ['basic', 'long'])) {
    const d = gen1(doc, { 'work:seam': ON('swishCut') });
    const p = fresh(d);
    const into = new Map(p.seams.map((s) => [s.into, s]));
    let last = 0;
    for (const c of p.cuts) {
      const s = into.get(c.key);
      const dir = s ? FL.seamDir(s.slot) : 0;
      if (!dir) continue;
      if (last) { n++; if (dir !== last) alt++; }
      last = dir;
      assert.ok(!turned(s.slot) || s.slot.from === 'pin:work', 'a pinned part with an automatic direction may turn');
    }
  }
  assert.ok(n >= 50 && alt / n >= 0.8, alt + ' of ' + n);
  // a pinned direction stays
  const d = gen1(corpus.project('basic').doc, { 'work:seam': ON('swishCut'), 'work:seam@swishCut.dir': ON('left') });
  for (const s of fresh(d).seams) if (s.slot.v === 'swishCut') assert.equal(s.slot.p.dir, 'left');
});

// --- the arc ---------------------------------------------------------------------------------------------------------

const MOODS = ['quietHush', 'popFizz', 'glitchFracture', 'heartAche', 'dashSprint', 'dreamHaze'];
function arcShares(extra) {
  const acc = {};
  const add = (grp, strong) => { acc[grp] = acc[grp] || [0, 0]; acc[grp][1]++; if (strong) acc[grp][0]++; };
  for (const name of ['basic', 'repeat']) {
    for (const aspect of ['16:9', '9:16']) {
      for (let s = 0; s < 3; s++) {
        for (const mood of MOODS) {
          const doc = gen1(corpus.project(name).doc, { 'work:mood': ON(mood), 'work:repeat.same': ON(false) });
          doc.look = Object.assign({}, doc.look, { seed: corpus.seedOf('arc', name, aspect, s), aspect });
          const ref = fresh(doc).pv;
          const p = fresh(Object.assign({}, doc, { pins: Object.assign({}, doc.pins, extra) }));
          for (const c of p.cuts) {
            const part = ref.parts.get(c.key);
            if (!part || !part.kind) continue;
            const grp = part.tame ? 'tame' : part.peak ? 'peak' : part.kind === 'chorus' ? 'chorus' : part.kind === 'verse' ? 'verse' : null;
            if (!grp) continue;
            for (const kind of ['arrange', 'arrive', 'depart']) {
              const d = c.slots[kind];
              if (!d || d.from !== 'auto' || d.v === 'none') continue;
              const strong = ARC.strength(CAT.get(kind, d.v), CAT.traits(kind, d.v)) > 0;
              add(grp + '|' + kind, strong);
              add(grp, strong);
            }
          }
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(acc).map(([k, [a, b]]) => [k, 100 * a / b]));
}

test('the arc: choruses favor strong moves, verses and the hold before a chorus calm ones, the last chorus most', (t) => {
  const on = arcShares({}), off = arcShares({ 'work:pv.arc': ON(false) });
  t.diagnostic('strong share on: ' + Object.entries(on).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', '));
  assert.ok(on['chorus|arrive'] - on['verse|arrive'] >= 10, 'entrances');
  assert.ok(on['chorus|arrange'] - on['verse|arrange'] >= 10, 'layouts');
  assert.ok(on.tame <= on.verse, 'the hold before a chorus');
  assert.ok(on.peak - off.peak >= on.chorus - off.chorus, 'the last chorus gains the most');
  // a neutral song: the arc changes nothing
  const flat = gen1(corpus.project('lrc').doc);
  const fp = fresh(flat);
  assert.equal(fp.pv.neutral, true);
  assert.equal(fresh(Object.assign({}, flat, { pins: Object.assign({}, flat.pins, { 'work:pv.arc': ON(false) }) })).hash, fp.hash);
});

// --- stability, explain and the cache --------------------------------------------------------------------------------

test('a reroll turns the directions of a few cuts after it at most', (t) => {
  const within = [];
  for (const d0 of spinDoc().slice(0, 3)) {
    const p0 = fresh(d0);
    const signs0 = new Map(p0.cuts.map((c) => [c.key, JSON.stringify(directions(c).own)]));
    for (const c of p0.cuts.filter((x) => x.line).slice(0, 25)) {
      const d = Object.assign({}, d0, { salts: Object.assign({}, d0.salts, { ['cut/' + c.key]: 1 }) });
      const p1 = fresh(d);
      const at = p0.cuts.indexOf(c);
      const moved = p1.cuts.filter((x, i) => i > at && signs0.get(x.key) !== JSON.stringify(directions(x).own)).length;
      within.push(moved);
    }
  }
  const ok = within.filter((m) => m <= 4).length / within.length;
  t.diagnostic('rerolls moving ≤ 4 later directions: ' + (100 * ok).toFixed(1) + ' % of ' + within.length + ', worst ' + Math.max(...within));
  assert.ok(ok >= 0.95, ok);
});

test('explain: a turned direction says so; an arc-weighted pick names the part', () => {
  const d = spinDoc()[0];
  const p = PL.plan(d, { registry: CAT });
  const cut = p.cuts.find((c) => c.line && turned(c.slots.arrive));
  const why = EX.explain(d, p, 'cut/' + cut.key + ':arrive@twirlArrive.dir', { registry: CAT }).why;
  assert.equal(why[0].code, 'rule');
  assert.equal(why[0].params.rule, 'pv.alt');
  assert.ok(why[1].code === 'pv.alt' || why[1].code === 'pv.altSame');
  const fs = FI.fieldState(d, p, { level: 'cut', key: cut.key }, 'cut/' + cut.key + ':arrive@twirlArrive.dir', { registry: CAT });
  assert.equal(fs.state, 'auto', 'a turned direction is still automatic (the row stays editable)');
  // the arc names the chorus, the hold or the last chorus on some pick of the repeat fixture
  const doc = gen1(corpus.project('repeat').doc, { 'work:pv.kit': ON(false) });
  const rp = PL.plan(doc, { registry: CAT });
  const codes = new Set();
  for (const c of rp.cuts.filter((x) => x.role === 'lyric')) {
    for (const w of EX.explain(doc, rp, 'cut/' + c.key + ':arrive', { registry: CAT }).why) codes.add(w.code);
  }
  assert.ok(['pv.arc.up', 'pv.arc.down', 'pv.tame', 'pv.peak'].every((c) => codes.has(c)), [...codes].join());
});

test('re-planning with directions gives exactly the plan made from scratch (rerolls next to directional cuts)', () => {
  const R = MV.use('core/rng');
  for (const d0 of spinDoc().slice(0, 3)) {
    const rng = R.stream('pvflow', d0.look.seed);
    let doc = d0;
    for (let i = 0; i < 16; i++) {
      const p = PL.plan(doc, { registry: CAT });
      assert.equal(p.hash, fresh(doc).hash, 'step ' + i);
      const c = rng.pick(p.cuts);
      const key = rng.pick(['cut/' + c.key, 'cut/' + c.key + ':arrive', 'cut/' + c.key + ':arrive@twirlArrive.dir', 'line/' + (c.line || 'x')]);
      doc = Object.assign({}, doc, { salts: Object.assign({}, doc.salts, { [key]: ((doc.salts || {})[key] || 0) + 1 }) });
    }
  }
});
