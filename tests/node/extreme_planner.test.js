/* 文字PVメーカー v2 — original work. Tests: EXTREME camerawork in the plan — the cam.extreme switch, the overlay's rules, weights, mirror and window, grounds, rigs, fingerprints, explain and fields (DESIGN_EXTREME §2.2–§2.3, §5.1). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');
const XD = require('../helpers/extreme_docs.js');

const MV = load();
const SHOT = MV.use('core/shot');
const CMD = MV.use('core/commands');
const PL = MV.use('planner/plan');
const XT = MV.use('planner/extreme');
const EX = MV.use('planner/explain');
const F = MV.use('planner/fields');
const CAT = MV.use('parts/catalog').defaultRegistry();

const clone = (x) => JSON.parse(JSON.stringify(x));
const ON = { 'work:cam.extreme': { v: 1, by: 'user' } };
const withPins = (doc, pins) => Object.assign({}, doc, { pins: Object.assign({}, doc.pins, pins) });
const run = (doc, reg = CAT) => PL.run(doc, reg, { fresh: true });
const xOf = (c) => SHOT.xKeyOf(c.slots['cam.shot'].v);
const SPECIAL = new Set(['title', 'interlude', 'outro']);

// Which §2.3.2 rule a cut falls under (as the overlay reads its arrange, lens, text, length and role).
function ruleOf(c) {
  const arr = CAT.get('arrange', c.slots.arrange.v);
  const lens = c.slots.lens && c.slots.lens.v !== 'none' ? CAT.get('lens', c.slots.lens.v) : null;
  if (arr.cam === 'none') return 'none';
  if (!c.text.trim()) return 'text';
  if (arr.cam === 'gentle' || (lens && lens.frames === true)) return 'gentle';
  if (c.feat.dur < XT.FACTORS.SHORT_CUT) return 'short';
  return XT.POOLS.roles[c.role] ? c.role : 'all';
}
function poolOf(rule) {
  return rule === 'gentle' ? XT.POOLS.gentle : rule === 'short' ? XT.POOLS.short : XT.POOLS.roles[rule] || XT.XPOOL;
}

// --- the switch off: nothing changes ------------------------------------------------------------------------------------

test('without the switch the overlay does nothing: the golden corpus plans keep their hashes, no EXTREME field appears', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'golden', 'plan_hashes.json'), 'utf8'));
  assert.equal(golden.registry.version, CAT.version, 'the golden plan hashes are of this registry');
  let n = 0;
  for (const { name, doc } of corpus.corpus(2)) {
    const p = run(doc);
    assert.equal(p.hash, golden.plans[name], name);
    for (const c of p.cuts) {
      assert.equal(c.slots['cam.extreme'], undefined, name + ' ' + c.key);
      assert.ok(!xOf(c), name + ' ' + c.key + ': no EXTREME shot');
    }
    for (const g of p.grounds) assert.equal('x' in g, false, name + ': grounds[i].x absent');
    n++;
  }
  assert.ok(n >= 24);
});

test('the switch at 0 everywhere (work, lines) plans exactly as without it', () => {
  for (const { name, doc } of corpus.corpus(1)) {
    const base = run(doc);
    const lines = base.lines.map((l) => l.id);
    const pins = { 'work:cam.extreme': { v: 0, by: 'user' } };
    for (const id of lines.slice(0, 3)) pins['line/' + id + ':cam.extreme'] = { v: 0, by: 'ai' };
    const off = run(withPins(doc, pins));
    assert.equal(off.hash, base.hash, name);
    assert.deepEqual(off.warnings, base.warnings, name);
  }
});

// --- the switch on ------------------------------------------------------------------------------------------------------

test('work switch on: every automatic shot of a cut the rules leave open is an EXTREME preset from its pool', () => {
  const tally = {};
  for (const { name, doc } of corpus.corpus(3)) {
    const p = run(withPins(doc, ON));
    for (const c of p.cuts) {
      const d = c.slots['cam.shot'], x = xOf(c);
      assert.deepEqual(c.slots['cam.extreme'], { by: 'user', from: 'pin:work', v: 1 }, name + ' ' + c.key);
      const rule = ruleOf(c);
      tally[rule] = (tally[rule] || 0) + 1;
      if (typeof d.from === 'string' && d.from.startsWith('pin')) continue;
      if (rule === 'none' || rule === 'text') {
        assert.ok(!x, name + ' ' + c.key + ': no EXTREME shot under ' + rule);
        continue;
      }
      assert.ok(x, name + ' ' + c.key + ' (' + rule + '): an EXTREME preset, not ' + JSON.stringify(d.v));
      assert.equal(d.from, 'auto');
      assert.ok(poolOf(rule).includes(x.key), name + ' ' + c.key + ': ' + x.key + ' is in the ' + rule + ' pool');
      assert.ok(!x.m || SHOT.MIRRORS.includes(x.key), name + ': only the ⇆ presets are mirrored');
      // EXTREME shots lean on nothing and frame at the presets' own closeness (automatic follow and zoom)
      assert.deepEqual([c.slots['cam.follow'], c.slots['cam.zoom']], [{ from: 'auto', v: 0 }, { from: 'auto', v: XT.FACTORS.XZOOM }]);
    }
  }
  for (const rule of ['all', 'gentle', 'short', 'none']) assert.ok(tally[rule] > 20, 'the corpus exercises ' + rule + ': ' + JSON.stringify(tally));
});

test('pins win: a pinned shot, zoom or follow is kept; a hand-picked EXTREME shot shows with the switch off too', () => {
  const doc = corpus.project('basic').doc;
  const base = run(withPins(doc, ON));
  const cut = base.cuts.find((c) => c.key === 'r5~0');
  const pinned = withPins(doc, Object.assign({}, ON, {
    'cut/r5~0:cam.shot': { v: 'settle', by: 'user', sig: cut.text }, 'line/r6:cam.zoom': { v: 1.4, by: 'user' },
    'line/r6:cam.follow': { v: 0.5, by: 'ai' }, 'work:cam.shot': { v: 'none', by: 'user' },
  }));
  const p = run(pinned);
  const at = (key) => p.cuts.find((c) => c.key === key);
  assert.deepEqual(at('r5~0').slots['cam.shot'], { v: 'settle', from: 'pin:cut', by: 'user' });
  // work:cam.shot 'none' (the camerawork switched off by a pin) wins over the switch everywhere else
  for (const c of p.cuts) if (c.key !== 'r5~0') assert.equal(c.slots['cam.shot'].v, 'none', c.key);
  // a pinned zoom and follow stay (and their shots are pinned here, so nothing else changes them)
  const r6 = run(withPins(doc, Object.assign({}, ON, { 'line/r6:cam.zoom': { v: 1.4, by: 'user' }, 'line/r6:cam.follow': { v: 0.5, by: 'ai' } })));
  for (const c of r6.cuts.filter((x) => x.line === 'r6')) {
    assert.ok(xOf(c), c.key);
    assert.deepEqual([c.slots['cam.zoom'].v, c.slots['cam.follow'].v], [1.4, 0.5], c.key);
  }
  // a hand-picked EXTREME shot with the switch off: shown as picked, its segment marked, nothing else touched
  const hand = run(withPins(doc, { 'cut/r5~0:cam.shot': { v: 'whipPan~m', by: 'user', sig: cut.text } }));
  const h = hand.cuts.find((c) => c.key === 'r5~0');
  assert.equal(h.slots['cam.shot'].v, 'whipPan~m');
  assert.equal(h.slots['cam.extreme'], undefined);
  assert.equal(hand.grounds[h.ground].x, true);
  assert.equal(hand.grounds.filter((g) => g.x).length, 1);
  // with the switch on, a hand-picked EXTREME shot also frames at the neutral zoom (automatic zoom and follow)
  const handOn = run(withPins(doc, Object.assign({}, ON, { 'cut/r5~0:cam.shot': { v: 'whipPan~m', by: 'user', sig: cut.text } })));
  const ho = handOn.cuts.find((c) => c.key === 'r5~0');
  assert.deepEqual([ho.slots['cam.shot'].v, ho.slots['cam.zoom'].v, ho.slots['cam.follow'].v], ['whipPan~m', 1, 0]);
});

test('line switches confine it; a line switch 0 exempts a line; the amount of camerawork does not stop it', () => {
  const doc = corpus.project('basic').doc;
  const chorus = run(XD.chorusOnly());
  for (const c of chorus.cuts) {
    const inChorus = XD.CHORUS.includes(c.line);
    assert.equal(!!c.slots['cam.extreme'], inChorus, c.key);
    if (!inChorus) assert.ok(!xOf(c), c.key + ': no EXTREME shot outside the chorus');
    else assert.deepEqual(c.slots['cam.extreme'], { by: 'user', from: 'pin:line', v: 0.5 });
  }
  assert.ok(chorus.cuts.filter(xOf).length >= 5);
  const exempt = run(withPins(doc, Object.assign({}, ON, { 'line/rb:cam.extreme': { v: 0, by: 'user' } })));
  for (const c of exempt.cuts) {
    assert.equal(!!c.slots['cam.extreme'], c.line !== 'rb', c.key);
    if (c.line === 'rb') assert.ok(!xOf(c), c.key + ' is exempted');
  }
  const quiet = clone(doc);
  quiet.pins = Object.assign({}, quiet.pins, ON, { 'work:amount.camera': { v: 0, by: 'user' } });
  const q = run(quiet);
  assert.ok(q.cuts.filter(xOf).length >= 8, 'the switch is an explicit request: camera amount 0 still gets EXTREME shots');
});

test('the pin grammar: a cut pin does not apply (warned), a bad value is warned, values snap to the 0.05 step', () => {
  const doc = corpus.project('basic').doc;
  const p = run(withPins(doc, { 'cut/r4~0:cam.extreme': { v: 1, by: 'user', sig: '始発のホームに' } }));
  assert.ok(p.warnings.some((w) => w.code === 'pin-not-applicable' && w.path === 'cut/r4~0:cam.extreme'), JSON.stringify(p.warnings));
  assert.ok(p.cuts.every((c) => !c.slots['cam.extreme'] && !xOf(c)));
  const bad = run(withPins(doc, { 'work:cam.extreme': { v: 'max', by: 'user' } }));
  assert.ok(bad.warnings.some((w) => w.code === 'pin-bad-value' && w.path === 'work:cam.extreme'));
  assert.ok(bad.cuts.every((c) => !xOf(c)));
  const odd = run(withPins(doc, { 'work:cam.extreme': { v: 0.72, by: 'user' } }));
  assert.equal(odd.cuts[1].slots['cam.extreme'].v, 0.7);
});

// --- the weights -------------------------------------------------------------------------------------------------------

test('weights: impact lines crash, the pair rule, recency and echo factors; the variety of a video', () => {
  let impact = 0, crash = 0, pairs = 0, same = 0, rep = 0, repSame = 0;
  const shares = [];
  for (const { name, doc } of corpus.corpus(6)) {
    const p = run(withPins(doc, ON));
    const byKey = new Map(p.cuts.map((c) => [c.key, c]));
    const count = {};
    let prev = null, m = 0;
    for (const c of p.cuts) {
      const x = xOf(c);
      if (x) {
        count[x.key] = (count[x.key] || 0) + 1; m++;
        if (prev) { pairs++; if (prev === x.key) same++; }
        if (c.impact && ['all', 'title'].includes(ruleOf(c))) { impact++; if (x.key === 'crashZoom') crash++; }
        const first = c.feat.repeatOf ? byKey.get(c.feat.repeatOf) : null;
        const fx = first ? xOf(first) : null;
        if (fx) { rep++; if (fx.key === x.key) repSame++; }
      }
      prev = x ? x.key : null;
    }
    if (m) shares.push(Math.max(...Object.values(count)) / m);
    assert.ok(Object.keys(count).length >= 3 || m < 6, name + ': ' + JSON.stringify(count));
  }
  shares.sort((a, b) => a - b);
  const median = shares[shares.length >> 1];
  assert.ok(impact >= 30 && crash / impact >= 0.6, 'impact lines crash: ' + crash + '/' + impact);
  assert.ok(median <= 0.36, 'the most common EXTREME preset of a video: median share ' + median.toFixed(3));
  assert.ok(same / pairs <= 0.07, 'neighbours share their EXTREME preset in ' + same + '/' + pairs);
  assert.ok(rep > 300 && repSame / rep >= 0.5, 'repeated lines repeat their move: ' + repSame + '/' + rep);
});

test('XT.weights: the §2.3.3 factors (pair ×6, echo ×40, recency ×0.2 and ×0.5) and the pools', () => {
  const p = run(withPins(corpus.project('long').doc, ON));
  const ctx = { look: { mood: CAT.get('mood', p.look.mood.v), amounts: p.look.amounts }, registry: CAT, bpm: null };
  const cut = p.cuts.find((c) => ruleOf(c) === 'all');
  const w = (rec) => Object.fromEntries(XT.weights(ctx, cut, rec).map((c) => [c.key, c.w]));
  const base = w();
  assert.deepEqual(Object.keys(base), XT.XPOOL.slice());
  assert.ok(Math.abs(w({ pair: true }).whipPan / base.whipPan - 6) < 1e-3);
  assert.ok(Math.abs(w({ echo: 'orbit' }).orbit / base.orbit - 40) < 1e-3);
  assert.ok(Math.abs(w({ prev: 'dutchSwing' }).dutchSwing / base.dutchSwing - 0.2) < 1e-3);
  assert.ok(Math.abs(w({ near: ['vertigo'] }).vertigo / base.vertigo - 0.5) < 1e-3);
  assert.equal(base.beatCrash > 0, true);
  const withBeats = Object.fromEntries(XT.weights(Object.assign({}, ctx, { bpm: 120 }), cut).map((c) => [c.key, c.w]));
  assert.ok(withBeats.beatCrash > base.beatCrash, 'beatCrash weighs more with a tempo');
  const gentle = p.cuts.find((c) => ruleOf(c) === 'gentle');
  for (const c of XT.weights(ctx, gentle)) assert.equal(c.w > 0, XT.POOLS.gentle.includes(c.key) && c.w > 0, c.key);
  const none = p.cuts.find((c) => ruleOf(c) === 'none');
  assert.ok(XT.weights(ctx, none).every((c) => c.w === 0));
});

test('mirror: ⇆ presets only; a whipPan right after a whipPan of the same section with a hard cut keeps its direction', () => {
  let paired = 0, checked = 0;
  for (const { name, doc } of corpus.corpus(8)) {
    const p = run(withPins(doc, ON));
    for (let j = 1; j < p.cuts.length; j++) {
      const A = p.cuts[j - 1], B = p.cuts[j], a = xOf(A), b = xOf(B);
      if (b) { checked++; assert.ok(!b.m || SHOT.MIRRORS.includes(b.key)); }
      if (a && b && a.key === 'whipPan' && b.key === 'whipPan' && A.feat.section === B.feat.section && !(B.seamIn >= 0)) {
        paired++;
        assert.equal(b.m, a.m, name + ' ' + B.key + ': the pair whips the same way');
      }
    }
  }
  assert.ok(checked > 500);
  assert.ok(paired >= 3, 'whipPan pairs seen: ' + paired);
});

test('rerolls: a cut\'s shot die rerolls its EXTREME pick; it reaches few other cuts, and never the repeats of a first copy', () => {
  let tried = 0, changed = 0, runs = 0, local = 0, far = 0;
  for (const { name, doc } of corpus.corpus(2)) {
    const d0 = withPins(doc, ON);
    const base = run(d0);
    const idx = new Map(base.cuts.map((c, i) => [c.key, i]));
    const xs = base.cuts.filter(xOf);
    for (let k = 0; k < xs.length; k += Math.max(1, Math.floor(xs.length / 5))) {
      const cut = xs[k];
      tried++;
      let moved = false;
      for (let bump = 1; bump <= 3; bump++) {
        const p = run(Object.assign({}, d0, { salts: { ['cut/' + cut.key + ':cam.shot']: bump } }));
        let others = 0;
        for (const c of p.cuts) {
          const b = base.cuts[idx.get(c.key)];
          if (!b) continue;
          const same = JSON.stringify(c.slots['cam.shot'].v) === JSON.stringify(b.slots['cam.shot'].v);
          if (c.key === cut.key) { if (!same) moved = true; continue; }
          if (same) continue;
          others++;
          assert.notEqual(c.feat.repeatOf, cut.key, name + ': a reroll of ' + cut.key + ' moved its repeat ' + c.key);
        }
        runs++;
        if (others <= 3) local++;
        if (others > 3) far++;
      }
      if (moved) changed++;
    }
  }
  assert.ok(changed / tried >= 0.85, 'rerolled picks: ' + changed + '/' + tried);
  assert.ok(local / runs >= 0.97, 'a reroll changes ≤ 3 other cuts in ' + local + '/' + runs + ' bumps (' + far + ' more)');
});

// --- grounds, rigs, fingerprints, determinism --------------------------------------------------------------------------

test('grounds[i].x marks exactly the segments with an EXTREME cut; EXTREME runs raise their automatic rig', () => {
  for (const { name, doc } of corpus.corpus(2)) {
    const off = run(doc), p = run(withPins(doc, ON));
    const want = new Set(p.cuts.filter(xOf).map((c) => c.ground));
    p.grounds.forEach((g, i) => assert.equal(g.x === true, want.has(i), name + ' ground ' + i));
    p.grounds.forEach((g, i) => { if (!want.has(i)) assert.equal('x' in g, false); });
    const A = p.look.amounts.camera;
    let last = -1;
    p.rigs.forEach((run, r) => {
      const first = p.cuts.find((c) => c.key === run.cuts[0]);
      if (first && first.feat.section === 'chorus' && !SPECIAL.has(first.role)) last = r;
    });
    p.rigs.forEach((run, r) => {
      const o = off.rigs[r];
      assert.equal(run.rig.v, o.rig.v, name + ': the rig is the same preset');
      if (run.rig.v === 'none') return assert.deepEqual(run.rig, o.rig);
      const amp = Math.round(Math.min(1.6, (0.6 + 0.8 * A) * (r === last ? 1.25 : 1)) * 100) / 100;
      assert.deepEqual(run.rig, { from: 'auto', p: { amp }, v: run.rig.v }, name + ' rig ' + r);
      assert.ok(amp >= o.rig.p.amp, 'EXTREME raises the amplitude');
    });
  }
  // a pinned rig and a run whose first cut has the switch off keep theirs
  const doc = corpus.project('basic').doc;
  const chorus = run(XD.chorusOnly()), base = run(doc);
  chorus.rigs.forEach((r, i) => {
    const first = chorus.cuts.find((c) => c.key === r.cuts[0]);
    if (!first || !first.slots['cam.extreme']) assert.deepEqual(r.rig, base.rigs[i].rig);
  });
  const rigPin = { 'work:rig': { v: 'slowSwell', by: 'user' } };
  const pinnedOn = run(withPins(doc, Object.assign({}, ON, rigPin))), pinnedOff = run(withPins(doc, rigPin));
  assert.deepEqual(pinnedOn.rigs.map((r) => r.rig), pinnedOff.rigs.map((r) => r.rig), 'a pinned rig keeps its amplitude');
});

test('an EXTREME cut\'s fingerprint follows the beat grid; a normal one does not (plan.js reads beats for every shot that uses them)', () => {
  // the song's meter moves no line (the lines snap to beats) but changes the grid the scenes read (bars)
  const doc = withPins(corpus.project('basic').doc, ON);
  const a = run(doc);
  const moved = clone(doc);
  moved.song.meter = 3;
  const b = run(moved);
  let x = 0, kept = 0;
  a.cuts.forEach((c, i) => {
    const o = b.cuts[i];
    assert.deepEqual([o.key, o.t0], [c.key, c.t0]);
    if (JSON.stringify(c.slots) !== JSON.stringify(o.slots)) return;
    if (xOf(c)) { x++; assert.notEqual(c.fp, o.fp, c.key + ': the grid is in an EXTREME cut\'s fingerprint'); } else if (c.fp === o.fp) kept++;
  });
  assert.ok(x >= 5 && kept >= 1, x + ' EXTREME cuts, ' + kept + ' others kept their fingerprint');
  assert.equal(SHOT.usesBeats('settle'), false);
  assert.equal(SHOT.usesBeats('whipPan~m'), true);
  // without a song there is no grid (plan.beats null) and no beat term: the EXTREME scenes run on 0.5 s steps from
  // each cut's sung start (engine/scene/xshot schedule), so moving a cut in time keeps its fingerprint
  const quiet = clone(doc);
  delete quiet.song;
  const q = run(quiet);
  assert.equal(q.beats, null);
  assert.ok(q.cuts.some(xOf));
});

test('determinism: fresh, cached, copied and re-planned documents give the same EXTREME plan', () => {
  for (const { name, doc } of corpus.corpus(1)) {
    const d = withPins(doc, Object.assign({}, ON, { 'line/r5:cam.extreme': { v: 0.5, by: 'ai' } }));
    const a = run(d);
    const b = PL.plan(clone(d), { registry: CAT });
    const c = PL.run(clone(d), CAT, null);
    assert.equal(b.hash, a.hash, name);
    assert.equal(c.hash, a.hash, name);
    assert.deepEqual(JSON.parse(JSON.stringify(b)), JSON.parse(JSON.stringify(a)), name);
    // re-planning after edits (the cast and encoding caches warm) equals planning from scratch
    const salted = Object.assign({}, d, { salts: { ['cut/' + a.cuts[3].key]: 2 } });
    PL.plan(salted, { registry: CAT });
    const back = PL.plan(clone(d), { registry: CAT });
    assert.equal(back.hash, a.hash, name + ': back after a reroll');
    const rows = clone(d.sheet.rows);
    const i = rows.findIndex((r) => r.src && !r.src.startsWith('[') && !r.src.startsWith('#'));
    rows[i] = { id: rows[i].id, src: rows[i].src + 'よ' };
    const edited = Object.assign({}, d, { sheet: Object.assign({}, d.sheet, { rows }) });
    assert.equal(PL.plan(edited, { registry: CAT }).hash, run(edited).hash, name + ': an edited line');
  }
});

test('locks keep the EXTREME picks as cut pins; handPicked and switchCommands (the widget values) for phases D and E', () => {
  const doc = withPins(corpus.project('basic').doc, ON);
  const p = run(doc);
  const payload = F.lockPayload(doc, p, 'r6', { registry: CAT });
  for (const key of p.lines.find((l) => l.id === 'r6').cuts) {
    const c = p.cuts.find((x) => x.key === key);
    if (xOf(c)) assert.deepEqual(payload.pins['cut/' + key + ':cam.shot'], { v: c.slots['cam.shot'].v, by: 'lock', sig: c.text });
    assert.equal(payload.pins['cut/' + key + ':cam.extreme'], undefined, 'the switch is never locked into a cut');
  }
  const locked = CMD.reduce(doc, payload);
  const off = CMD.reduce(locked, { t: 'batch', cmds: XT.switchCommands(locked, 'work', 0, { remove: true }) });
  const q = run(off);
  for (const c of q.cuts) if (c.line === 'r6') assert.deepEqual(c.slots['cam.shot'].v, p.cuts.find((x) => x.key === c.key).slots['cam.shot'].v);
  assert.ok(q.cuts.filter((c) => c.line !== 'r6').every((c) => !xOf(c)), 'switched off elsewhere');
  // handPicked: EXTREME shot pins by the user or the AI (not locks, not normal shots)
  const hand = Object.assign({}, locked, { pins: Object.assign({}, locked.pins, {
    'cut/r4~0:cam.shot': { v: 'crashZoom', by: 'user', sig: '始発のホームに' }, 'line/r5:cam.shot': { v: 'orbit~m', by: 'ai' },
    'line/r7:cam.shot': { v: 'settle', by: 'user' }, 'line/ra:cam.shot': { v: SHOT.fromXMove({ move: 'spin' }), by: 'user' } }) });
  assert.deepEqual(XT.handPicked(hand, 'work'), ['cut/r4~0:cam.shot', 'line/r5:cam.shot', 'line/ra:cam.shot']);
  assert.deepEqual(XT.handPicked(hand, 'line/r5'), ['line/r5:cam.shot']);
  // the widget: on (1), the strength steps, off at work (clear), off at a line under the work switch (0) or alone (clear)
  assert.deepEqual(XT.STEPS, [0.5, 0.75, 1]);
  const bare = corpus.project('basic').doc;
  assert.deepEqual(XT.switchCommands(bare, 'work', XT.ON), [{ t: 'pin.set', path: 'work:cam.extreme', v: 1, by: 'user' }]);
  assert.deepEqual(XT.switchCommands(bare, 'line/ra', 0.75, { by: 'ai' }), [{ t: 'pin.set', path: 'line/ra:cam.extreme', v: 0.75, by: 'ai' }]);
  assert.deepEqual(XT.switchCommands(bare, 'line/ra', 0.5), [{ t: 'pin.set', path: 'line/ra:cam.extreme', v: 0.5, by: 'user' }]);
  assert.deepEqual(XT.switchCommands(doc, 'work', 0), [{ t: 'pin.clear', path: 'work:cam.extreme' }]);
  assert.deepEqual(XT.switchCommands(doc, 'line/rb', null), [{ t: 'pin.set', path: 'line/rb:cam.extreme', v: 0, by: 'user' }]);
  assert.deepEqual(XT.switchCommands(bare, 'line/rb', 0), [{ t: 'pin.clear', path: 'line/rb:cam.extreme' }]);
  assert.deepEqual(XT.switchCommands(hand, 'line/r5', 0, { remove: true }),
    [{ t: 'pin.set', path: 'line/r5:cam.extreme', v: 0, by: 'user' }, { t: 'pin.clear', path: 'line/r5:cam.shot' }]);
  for (const cmds of [XT.switchCommands(hand, 'work', 0, { remove: true }), XT.switchCommands(hand, 'line/r5', 1)]) {
    assert.doesNotThrow(() => CMD.reduce(hand, { t: 'batch', cmds }));
  }
  // resolve / valueAt: line > work, 0 when off
  const ix = MV.use('core/pins').index(Object.assign({}, doc.pins, { 'line/rb:cam.extreme': { v: 0, by: 'user' } }));
  assert.equal(XT.valueAt(ix, { lineId: 'ra' }), 1);
  assert.equal(XT.valueAt(ix, { lineId: 'rb' }), 0);
  assert.equal(XT.resolve(ix, { lineId: 'rb' }).from, 'pin:line');
  assert.equal(XT.valueAt(MV.use('core/pins').index({}), { lineId: 'ra' }), 0);
});

// --- explain and fields ---------------------------------------------------------------------------------------------------

test('explain: an EXTREME pick names the rule, the switch and its reasons, with the EXTREME alternatives; the switch explains its pin', () => {
  const doc = withPins(corpus.project('basic').doc, Object.assign({}, ON, { 'line/r5:cam.extreme': { v: 0, by: 'user' },
    'line/rb:cam.extreme': { v: 0.5, by: 'ai' } }));
  const p = PL.plan(doc, { registry: CAT });
  const cut = p.cuts.find((c) => xOf(c) && c.slots['cam.shot'].from === 'auto' && c.line === 'r6');
  const e = EX.explain(doc, p, 'cut/' + cut.key + ':cam.shot', { registry: CAT });
  assert.equal(e.value, cut.slots['cam.shot'].v);
  assert.equal(e.from, 'auto');
  assert.deepEqual(e.why.slice(0, 2), [{ code: 'rule', params: { rule: 'extreme' } }, { code: 'cam.extreme', params: { x: 1 } }]);
  assert.deepEqual(e.alts.map((a) => a.key).sort(), XT.XPOOL.slice());
  assert.ok(e.alts.some((a) => a.key === xOf(cut).key && a.w > 0));
  const z = EX.explain(doc, p, 'cut/' + cut.key + ':cam.zoom', { registry: CAT });
  assert.deepEqual([z.value, z.why], [1, [{ code: 'cam.extreme', params: { x: 1 } }]]);
  const w = EX.explain(doc, p, 'line/r4:cam.extreme', { registry: CAT });
  assert.deepEqual([w.value, w.from, w.why], [1, 'pin:work', [{ code: 'pin', params: { scope: 'work', by: 'user' } },
    { code: 'cam.extreme', params: { x: 1 } }]]);
  const zero = EX.explain(doc, p, 'line/r5:cam.extreme', { registry: CAT });
  assert.deepEqual([zero.value, zero.from, zero.why], [0, 'pin:line', [{ code: 'pin', params: { scope: 'line', by: 'user' } }]]);
  const half = EX.explain(doc, p, 'line/rb:cam.extreme', { registry: CAT });
  assert.deepEqual([half.value, half.by], [0.5, 'ai']);
  const bare = corpus.project('basic').doc;
  const none = EX.explain(bare, PL.plan(bare, { registry: CAT }), 'work:cam.extreme', { registry: CAT });
  assert.deepEqual([none.value, none.from, none.why], [0, 'auto', []]);
});

test('fields: the switch shows its pin and scope (line or work, never a cut), inherited on lines, a line 0 pinned', () => {
  const doc = withPins(corpus.project('basic').doc, Object.assign({}, ON, { 'line/r5:cam.extreme': { v: 0, by: 'user' },
    'line/rb:cam.extreme': { v: 0.5, by: 'ai' } }));
  const p = PL.plan(doc, { registry: CAT });
  const fs = (path) => F.fieldState(doc, p, null, path, { registry: CAT });
  const pick = (s) => [s.value, s.state, s.pinnedAt, s.by];
  assert.deepEqual(pick(fs('work:cam.extreme')), [1, 'pinned', 'work', 'user']);
  assert.deepEqual(pick(fs('line/r4:cam.extreme')), [1, 'inherited', 'work', 'user']);
  assert.deepEqual(pick(fs('line/r5:cam.extreme')), [0, 'pinned', 'line', 'user']);
  assert.deepEqual(pick(fs('line/rb:cam.extreme')), [0.5, 'ai', 'line', 'ai']);
  assert.deepEqual(pick(fs('cut/r4~0:cam.extreme')), [1, 'inherited', 'work', 'user']);
  assert.deepEqual(fs('work:cam.extreme').schema, XT.SLOT_SPECS['cam.extreme']);
  assert.deepEqual(fs('cut/r4~0:cam.extreme').canPinAt, ['line', 'work']);
  assert.deepEqual(fs('line/r4:cam.extreme').canPinAt, ['line', 'work']);
  assert.deepEqual(fs('cut/title:cam.extreme').canPinAt, ['work']);
  const bare = corpus.project('basic').doc;
  const q = F.fieldState(bare, PL.plan(bare, { registry: CAT }), null, 'line/r4:cam.extreme', { registry: CAT });
  assert.deepEqual([q.value, q.state], [0, 'auto']);
});

test('the golden EXTREME documents plan as the fixture says (every preset once, two mirrored; the chorus only at 0.5)', () => {
  const [all, chorus] = XD.goldenDocs().map(({ doc }) => run(doc));
  const shown = new Set();
  for (const [key, , v] of XD.PRESET_CUTS) {
    const c = all.cuts.find((x) => x.key === key);
    assert.deepEqual(c.slots['cam.shot'], { v, from: 'pin:cut', by: 'user' }, key);
    shown.add(SHOT.xKeyOf(v).key);
  }
  assert.equal(shown.size, 12);
  assert.deepEqual(all.warnings, []);
  assert.ok(chorus.cuts.filter(xOf).every((c) => XD.CHORUS.includes(c.line) && c.slots['cam.extreme'].v === 0.5));
  assert.equal(chorus.design.aspect, '9:16');
});
