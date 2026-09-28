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
const SHOT = MV.use('core/shot');
const MAT = MV.use('core/mat');
const XD = require('../helpers/extreme_docs.js');

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

// A reroll of a first copy reaches its repeats' directions only through the alternation chain right after it, never
// through the repeat relation; with 「くり返しの行をそろえる」 on, an aligned repeat shows its source's directions as the Plan
// shows them, after the reroll too.
test('repeats vs rerolls: a first copy\'s reroll turns no far repeat; aligned repeats keep following their source', () => {
  for (const keep of [false, true]) {
    // (a pinned part keeps its own parameters, aligned or not: the far-repeat check pins the spins, the aligned one does not)
    const d0 = gen1(corpus.project('repeat').doc, keep ? {}
      : { 'work:arrive': ON('twirlArrive'), 'work:depart': ON('twirlDepart'), 'work:repeat.same': ON(false) });
    const p0 = fresh(d0);
    const idx = new Map(p0.cuts.map((c, i) => [c.key, i]));
    const firsts = [...new Set(p0.cuts.filter((c) => c.feat.repeatOf).map((c) => c.feat.repeatOf))].slice(0, 6);
    for (const first of firsts) {
      const d = Object.assign({}, d0, { salts: Object.assign({}, d0.salts, { ['cut/' + first]: 1 }) });
      const p1 = fresh(d);
      const al = keep ? CA.alignments({ ix: PINS.index(d.pins), doc: d }, p1.cuts) : null;
      const by1 = new Map(p1.cuts.map((c) => [c.key, c]));
      for (const c of p0.cuts.filter((x) => x.feat.repeatOf === first)) {
        const c1 = by1.get(c.key);
        if (keep && al.has(c.key)) {
          const src = by1.get(al.get(c.key).key);
          for (const k of KINDS) {
            const d = c1.slots[k], sd = src.slots[k];
            const e = d && d.p && d.from === 'auto' && sd && sd.v === d.v ? FL.entryOf(k, d.v) : null;
            if (!e) continue;
            for (const n of e.names) assert.deepEqual(d.p[n], sd.p[n], c.key + ' ' + k + '.' + n + ' follows its source');
          }
        } else if (!keep && idx.get(c.key) - idx.get(first) > 4) {
          assert.deepEqual(directions(c1).own, directions(c).own, c.key + ' far from the rerolled ' + first);
        }
      }
    }
  }
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

// --- phase C: the camera ---------------------------------------------------------------------------------------------

// The text's centre on screen (from the frame's centre, du) and the lean of its baseline (degrees, + = clockwise on the
// y-down screen) at u of a one-cut scene with these slots: the glyphs' world positions through the cut camera's view.
function onScreen(slots, u) {
  const plan = FAC.samplePlan(CAT, { kind: 'arrive', key: 'instantShow' }, { text: 'ことばのかぜ' });
  const cut = plan.cuts[0];
  Object.assign(cut.slots, slots);
  const scene = BUILD.buildCut(cut, plan, { registry: CAT, text: createTextService({ measurer: MEASURER, faces: plan.look.faces }), strict: true });
  FR.evaluate(scene, (cut.b - cut.a) * u);
  const k = FR.cutCamera(scene);
  const V = FR.viewMatrix(new Float32Array(6), { x: k.x, y: k.y, zoom: k.zoom, roll: k.roll, shakeX: k.jx, shakeY: k.jy }, 1,
    plan.design.w, plan.design.h);
  const pts = [];
  for (let j = scene.target.from; j < scene.target.to; j++) pts.push(MAT.apply(V, scene.table.m[j * 6 + 4], scene.table.m[j * 6 + 5], [0, 0]));
  const a = pts[0], b = pts[pts.length - 1];
  return { x: pts.reduce((s, q) => s + q[0], 0) / pts.length - plan.design.w / 2, lean: Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI };
}

// planner/flow SHOT_DIR against the engine: driftOff sets the text off to the right (side +1), tiltHold leans it
// clockwise (rot +1, the way tiltedCard's positive tilt leans it, the table's +1 on that axis); "~m" the other way.
test('the framed shots\' sides are the engine\'s: driftOff sets the text right, tiltHold leans it clockwise; "~m" the other way', () => {
  const shot = (v) => ({ 'cam.shot': { v, from: 'auto' }, 'cam.zoom': { v: 1, from: 'auto' } });
  for (const u of [0.3, 0.5, 0.7]) {
    const none = onScreen(shot('none'), u);
    for (const v of ['driftOff', 'driftOff~m']) {
      const sd = FL.shotDir(v);
      assert.equal(sd.axis, 'side');
      assert.equal(Math.sign(onScreen(shot(v), u).x - none.x), sd.s, v + ' at ' + u);
    }
    for (const v of ['tiltHold', 'tiltHold~m']) {
      const sd = FL.shotDir(v);
      assert.equal(sd.axis, 'rot');
      assert.equal(Math.sign(onScreen(shot(v), u).lean - none.lean), sd.s, v + ' at ' + u);
    }
    const card = (tilt) => ({ arrange: FAC.samplePlan(CAT, { kind: 'arrange', key: 'tiltedCard', params: { tilt } }, {}).cuts[0].slots.arrange });
    for (const tilt of [4, -4]) {
      const e = FL.entryOf('arrange', 'tiltedCard');
      assert.equal(Math.sign(onScreen(card(tilt), u).lean - none.lean), e.sign({ tilt }), 'tiltedCard ' + tilt + ': the same axis');
    }
  }
  assert.equal(FL.shotDir('sweepAcross'), null);
  assert.equal(FL.shotDir('spinIn~m'), null, 'EXTREME mirrors are their own');
});

// The Plan's view of the rule: the cut's direction on each axis from its parts (directions), then its framed shot.
function shotRule(p, doc, al) {
  const out = { alt: [0, 0], same: [0, 0], copy: [0, 0], pinned: [0, 0], restart: 0, mirrored: 0, shots: 0 };
  const finals = [];
  const shown = new Map();
  for (const c of p.cuts) {
    const own = Object.assign({}, directions(c).own);
    const d = c.slots['cam.shot'];
    const sd = d ? FL.shotDir(d.v) : null;
    if (sd) {
      out.shots++;
      if (d.v.endsWith('~m')) out.mirrored++;
      const part = p.pv.parts.get(c.key) || null;
      const src = al.get(c.key);
      const ss = src ? FL.shotDir(shown.get(src.key)) : null;
      if (d.from !== 'auto') { /* a pinned shot only gives the direction */ }
      else if (ss && ss.key === sd.key) { out.copy[1]++; if (ss.s === sd.s) out.copy[0]++; }
      else if (own[sd.axis] !== 0) { out.same[1]++; if (own[sd.axis] === sd.s) out.same[0]++; }
      else if (FL.restartAt(doc.look.seed, part, c.key)) out.restart++;
      else {
        let prev = 0, byPin = false;
        for (let k = 1; k <= FL.LOOKBACK && !prev; k++) {
          const f = finals.length >= k ? finals[finals.length - k] : null;
          prev = f ? f[sd.axis] : 0;
          byPin = !!prev && !!f['pin' + sd.axis];
        }
        if (prev) { out.alt[1]++; if (sd.s === -prev) out.alt[0]++; }
        if (byPin) { out.pinned[1]++; if (sd.s === -prev) out.pinned[0]++; }
      }
      if (!own[sd.axis]) { own[sd.axis] = sd.s; if (d.from !== 'auto') own['pin' + sd.axis] = true; }
    }
    finals.push(own);
    shown.set(c.key, d ? d.v : null);
  }
  return out;
}

test('the framed shots alternate their side against the cuts before them, follow the rest of their cut, and an aligned copy its source', (t) => {
  const sum = { alt: [0, 0], same: [0, 0], copy: [0, 0], pinned: [0, 0], restart: 0, mirrored: 0, shots: 0 };
  let offMirrored = 0;
  for (const { doc } of corpus.corpus(6, ['16:9', '9:16', '1:1'])) {
    // (and with framed shots pinned on every third line: a pinned shot gives its cut the side the next ones turn from)
    const lines = fresh(gen1(doc)).lines;
    const pins = {};
    lines.forEach((l, i) => { if (i % 3 === 0) pins['line/' + l.id + ':cam.shot'] = ON(i % 2 ? 'tiltHold' : 'driftOff~m'); });
    for (const d of [gen1(doc), gen1(doc, {}, true), gen1(doc, pins)]) {
      const p = fresh(d);
      const al = CA.alignments({ ix: PINS.index(d.pins), doc: d }, p.cuts) || new Map();
      const r = shotRule(p, d, al);
      for (const k of ['alt', 'same', 'copy', 'pinned']) { sum[k][0] += r[k][0]; sum[k][1] += r[k][1]; }
      sum.restart += r.restart; sum.mirrored += r.mirrored; sum.shots += r.shots;
    }
    const off = fresh(gen1(doc, { 'work:pv.alternate': ON(false) }));
    offMirrored += off.cuts.filter((c) => c.slots['cam.shot'] && typeof c.slots['cam.shot'].v === 'string' && FL.shotDir(c.slots['cam.shot'].v)
      && c.slots['cam.shot'].v.endsWith('~m')).length;
  }
  const rate = (x) => x[0] / x[1];
  t.diagnostic('framed shots ' + sum.shots + ', mirrored ' + sum.mirrored + '; against the cuts before ' + sum.alt.join('/') + ', with the cut '
    + sum.same.join('/') + ', aligned copies ' + sum.copy.join('/') + ', after a pinned shot ' + sum.pinned.join('/') + ', restarts ' + sum.restart);
  assert.ok(sum.alt[1] >= 50 && rate(sum.alt) >= 0.9, 'alternation ' + sum.alt.join('/'));
  assert.ok(sum.same[1] >= 20 && rate(sum.same) >= 0.9, 'within the cut ' + sum.same.join('/'));
  assert.ok(sum.copy[1] >= 5 && rate(sum.copy) === 1, 'aligned copies ' + sum.copy.join('/'));
  assert.ok(sum.pinned[1] >= 10 && rate(sum.pinned) >= 0.9, 'after a pinned framed shot ' + sum.pinned.join('/'));
  assert.ok(sum.mirrored > 50);
  assert.equal(offMirrored, 0, 'without the switch no framed shot is mirrored');
});

test('no older work shows a mirrored framed shot; the grammar accepts one only by a pin there', () => {
  for (const { name, doc } of corpus.corpus(4, ['16:9', '9:16', '1:1'], corpus.ALL_PROJECTS)) {
    const p = PL.plan(doc, { registry: CAT });
    for (const c of p.cuts) {
      const v = c.slots['cam.shot'] && c.slots['cam.shot'].v;
      assert.ok(!(typeof v === 'string' && FL.shotDir(v) && v.endsWith('~m')), name + ' ' + c.key);
    }
  }
  const doc = corpus.project('basic').doc;
  const p = fresh(Object.assign({}, doc, { pins: Object.assign({}, doc.pins, { 'line/r5:cam.shot': ON('driftOff~m') }) }));
  assert.ok(p.cuts.filter((c) => c.line === 'r5').every((c) => c.slots['cam.shot'].v === 'driftOff~m' && c.slots['cam.shot'].from === 'pin:line'));
  assert.deepEqual(p.warnings.filter((w) => w.path === 'line/r5:cam.shot'), []);
});

// A lock pins the mirrored shot as the Plan shows it, and a pinned framed shot still gives its cut its side: locking a
// line changes no other cut's shot.
test('a lock keeps a mirrored framed shot; nothing else moves', () => {
  let checked = 0;
  for (const { doc } of corpus.corpus(4, ['16:9', '9:16'], ['basic', 'long'])) {
    const d0 = gen1(doc);
    const p0 = PL.plan(d0, { registry: CAT });
    const cut = p0.cuts.find((c) => c.line && c.slots['cam.shot'].from === 'auto' && typeof c.slots['cam.shot'].v === 'string'
      && c.slots['cam.shot'].v.endsWith('~m') && !SHOT.isExtreme(c.slots['cam.shot'].v));
    if (!cut) continue;
    const payload = FI.lockPayload(d0, p0, cut.line, { registry: CAT });
    const p1 = fresh(CMD.reduce(d0, payload));
    const shots = (p) => p.cuts.map((c) => c.key + '=' + JSON.stringify(c.slots['cam.shot'] && c.slots['cam.shot'].v));
    assert.deepEqual(shots(p1), shots(p0), 'the shots as they were');
    assert.ok(p1.cuts.find((c) => c.key === cut.key).slots['cam.shot'].from.startsWith('pin'));
    checked++;
  }
  assert.ok(checked >= 3, 'locked ' + checked);
});

// A reroll of a first copy reaches a repeat's mirror only through the chain right after it (≤ 4 cuts), never through
// the repeat relation; and a reroll turns the framed shots of a few cuts after it at most.
test('rerolls: a first copy\'s reroll leaves the mirrors of its far repeats; a reroll turns few framed shots after it', (t) => {
  const sideOf = (c) => { const d = c.slots['cam.shot']; const sd = d ? FL.shotDir(d.v) : null; return sd ? sd.key + sd.s : null; };
  let far = 0;
  for (const { doc } of corpus.corpus(3, ['16:9', '9:16'], ['repeat', 'long'])) {
    const d0 = gen1(doc, { 'work:repeat.same': ON(false) });
    const p0 = fresh(d0);
    const idx = new Map(p0.cuts.map((c, i) => [c.key, i]));
    const firsts = [...new Set(p0.cuts.filter((c) => c.feat.repeatOf).map((c) => c.feat.repeatOf))]
      .filter((first) => p0.cuts.some((x) => x.feat.repeatOf === first && idx.get(x.key) - idx.get(first) > 4 && sideOf(x)));
    for (const first of firsts.slice(0, 8)) {
      const p1 = fresh(Object.assign({}, d0, { salts: Object.assign({}, d0.salts, { ['cut/' + first]: 1 }) }));
      const by1 = new Map(p1.cuts.map((c) => [c.key, c]));
      for (const c of p0.cuts.filter((x) => x.feat.repeatOf === first && idx.get(x.key) - idx.get(first) > 4)) {
        const a = sideOf(c), b = sideOf(by1.get(c.key));
        if (!a || !b || a.slice(0, -2) !== b.slice(0, -2)) continue;          // the same preset in both plans
        far++;
        assert.equal(b, a, c.key + ' far from the rerolled ' + first);
      }
    }
  }
  assert.ok(far >= 10, 'far repeats with a framed shot: ' + far);
  const moved = [];
  for (const { doc } of corpus.corpus(2, ['16:9'], ['basic', 'long'])) {
    const d = gen1(doc);
    const q0 = fresh(d);
    const before = new Map(q0.cuts.map((c) => [c.key, sideOf(c)]));
    for (const c of q0.cuts.filter((x) => x.line).slice(0, 20)) {
      const q1 = fresh(Object.assign({}, d, { salts: Object.assign({}, d.salts, { ['cut/' + c.key]: 1 }) }));
      const at = q0.cuts.indexOf(c);
      // a later framed shot of the same preset whose side turned
      moved.push(q1.cuts.filter((x, i) => i > at && before.get(x.key) && sideOf(x) && before.get(x.key) !== sideOf(x)
        && before.get(x.key).slice(0, -2) === sideOf(x).slice(0, -2)).length);
    }
  }
  const ok = moved.filter((m) => m <= 2).length / moved.length;
  t.diagnostic('far repeats checked ' + far + '; rerolls turning ≤ 2 later framed shots ' + (100 * ok).toFixed(1) + ' % of ' + moved.length
    + ', worst ' + Math.max(...moved));
  assert.ok(ok >= 0.95, ok);
});

// Push-ins and pull-backs: after a push-in a pull-back is picked clearly more often than without the switch (and a
// push-in after a pull-back); cuts with a marked word keep their push-in weight.
test('push-ins and pull-backs alternate (≥ 10 points more often); marked words keep their push-in', (t) => {
  const measure = (extra) => {
    const z = { inOut: 0, in: 0, outIn: 0, out: 0, emph: 0, push: 0, emphIn: 0, pushIn: 0 };
    for (const { doc } of corpus.corpus(6, ['16:9', '9:16', '1:1'])) {
      const p = fresh(gen1(doc, extra));
      let prev = null;
      for (const c of p.cuts) {
        const d = c.slots['cam.shot'];
        const cls = d ? FL.zoomClass(d.v) : null;
        if (c.line && c.feat.emph) {
          z.emph++;
          if (d && d.v === 'pushWord') z.push++;
          if (prev === 'in' && d && d.from === 'auto') { z.emphIn++; if (d.v === 'pushWord') z.pushIn++; }
        }
        else if (c.line && d && d.from === 'auto') {
          if (prev === 'in') { z.in++; if (cls === 'out') z.inOut++; }
          else if (prev === 'out') { z.out++; if (cls === 'in') z.outIn++; }
        }
        prev = cls;
      }
    }
    return z;
  };
  const on = measure({}), off = measure({ 'work:pv.alternate': ON(false) });
  const pct = (a, b) => 100 * a / b;
  t.diagnostic('pull-back after a push-in ' + pct(on.inOut, on.in).toFixed(1) + ' / ' + pct(off.inOut, off.in).toFixed(1) + ' %, push-in after a pull-back '
    + pct(on.outIn, on.out).toFixed(1) + ' / ' + pct(off.outIn, off.out).toFixed(1) + ' %, pushWord on marked words ' + pct(on.push, on.emph).toFixed(1)
    + ' / ' + pct(off.push, off.emph).toFixed(1) + ' % (right after a push-in ' + pct(on.pushIn, on.emphIn).toFixed(1) + ' / '
    + pct(off.pushIn, off.emphIn).toFixed(1) + ' %)');
  assert.ok(on.in >= 300 && pct(on.inOut, on.in) - pct(off.inOut, off.in) >= 10, 'pull-backs after push-ins');
  assert.ok(on.out >= 100 && pct(on.outIn, on.out) - pct(off.outIn, off.out) >= 10, 'push-ins after pull-backs');
  assert.ok(on.emph >= 100 && Math.abs(pct(on.push, on.emph) - pct(off.push, off.emph)) <= 3, 'marked words');
  assert.ok(on.emphIn >= 50 && pct(on.pushIn, on.emphIn) >= pct(off.pushIn, off.emphIn) - 4, 'a marked word right after a push-in');
  assert.equal(FL.zoomFactor(null, 'pullReveal'), 1);
  assert.equal(FL.zoomFactor('in', 'none'), 1);
  assert.ok(FL.zoomFactor('in', 'pullReveal') > 1 && FL.zoomFactor('in', 'settle') < 1 && FL.zoomFactor('out', 'pushWord') > 1);
});

// EXTREME (「カメラ EXTREME」 with 文字PVの定石): consecutive ⇆ moves turn the other way round, except a whipPan pair and
// a repeat playing its first copy's move; without the rule they keep the old coin; older works are untouched.
test('EXTREME: consecutive mirrored moves alternate under the rule; the old coin without it; older works as before', () => {
  const X = { 'work:cam.extreme': ON(1) };
  const count = (extra) => {
    let pairs = 0, alt = 0;
    for (const { doc } of corpus.corpus(4)) {
      const p = fresh(gen1(doc, Object.assign({}, X, extra)));
      for (let j = 1; j < p.cuts.length; j++) {
        const A = p.cuts[j - 1], B = p.cuts[j];
        const a = A.slots['cam.shot'] && SHOT.xKeyOf(A.slots['cam.shot'].v), b = B.slots['cam.shot'] && SHOT.xKeyOf(B.slots['cam.shot'].v);
        if (!a || !b || !SHOT.MIRRORS.includes(a.key) || !SHOT.MIRRORS.includes(b.key) || B.slots['cam.shot'].from !== 'auto') continue;
        if (b.key === 'whipPan' && a.key === 'whipPan' && A.feat.section === B.feat.section && !(B.seamIn >= 0)) continue;
        if (B.feat.repeatOf) continue;
        pairs++;
        if (a.m !== b.m) alt++;
      }
    }
    return [alt, pairs];
  };
  const on = count({}), off = count({ 'work:pv.alternate': ON(false) });
  assert.ok(on[1] >= 50 && on[0] === on[1], 'alternating ' + on.join('/'));
  assert.ok(off[0] / off[1] > 0.3 && off[0] / off[1] < 0.75, 'the coin ' + off.join('/'));
  // the golden EXTREME documents as a new work with 文字PVの定石 off plan exactly as they are
  for (const { name, doc } of XD.goldenDocs()) {
    const g = Object.assign({}, doc, { look: Object.assign({}, doc.look, { gen: D.GEN }),
      pins: Object.assign({}, doc.pins, OTHER_OFF, { 'work:pv.rules': ON(false) }) });
    assert.equal(fresh(g).hash, fresh(doc).hash, name);
  }
});

test('explain: a mirrored framed shot names its rule, before a carry too; a raised push-in or pull-back says why', () => {
  const rules = new Set(), zoom = new Set();
  let carried = 0;
  for (const { doc } of corpus.corpus(2, ['16:9', '9:16'], ['basic', 'long'])) {
    const d = gen1(doc);
    const p = PL.plan(d, { registry: CAT });
    for (const c of p.cuts) {
      const s = c.slots['cam.shot'];
      if (!s || typeof s.v !== 'string') continue;
      if (FL.shotDir(s.v) && s.v.endsWith('~m') && s.from === 'auto') {
        const why = EX.explain(d, p, 'cut/' + c.key + ':cam.shot', { registry: CAT }).why;
        const r = why.find((w) => w.code === 'rule' && String(w.params.rule).startsWith('pv.mirror'));
        assert.ok(r, c.key + ' ' + JSON.stringify(why));
        rules.add(r.params.rule);
        if (s.p && s.p.carry) { carried++; assert.equal(why[why.length - 1].params.rule, 'carry'); }
        const fs = FI.fieldState(d, p, { level: 'cut', key: c.key }, 'cut/' + c.key + ':cam.shot', { registry: CAT });
        assert.equal(fs.state, 'auto', 'a mirrored shot is still automatic');
      } else if (FL.zoomClass(s.v) && zoom.size < 2) {
        for (const w of EX.explain(d, p, 'cut/' + c.key + ':cam.shot', { registry: CAT }).why) {
          if (w.code === 'pv.zoomOut' || w.code === 'pv.zoomIn') zoom.add(w.code);
        }
      }
    }
  }
  assert.ok(rules.has('pv.mirror') && rules.has('pv.mirrorSame'), [...rules].join());
  assert.ok(carried >= 1, 'a mirrored shot carried');
  assert.ok(zoom.size >= 1, [...zoom].join());
});

test('re-planning with mirrored shots and alternating moves gives exactly the plan made from scratch', () => {
  const R = MV.use('core/rng');
  for (const { doc } of corpus.corpus(2, ['16:9'], ['basic', 'long'])) {
    let d = gen1(doc, { 'work:cam.extreme': ON(0.5) });
    const rng = R.stream('pvcam', d.look.seed);
    for (let i = 0; i < 14; i++) {
      const p = PL.plan(d, { registry: CAT });
      assert.equal(p.hash, fresh(d).hash, 'step ' + i);
      const c = rng.pick(p.cuts);
      const key = rng.pick(['cut/' + c.key, 'cut/' + c.key + ':cam.shot', 'cut/' + c.key + ':arrange', 'line/' + (c.line || 'x')]);
      d = Object.assign({}, d, { salts: Object.assign({}, d.salts, { [key]: ((d.salts || {})[key] || 0) + 1 }) });
      if (i === 7) d = Object.assign({}, d, { pins: Object.assign({}, d.pins, { 'work:cam.extreme': ON(0) }) });
    }
  }
});
