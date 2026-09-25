/* 文字PVメーカー v2 — original work. Tests: automatic camerawork in the plan — shots, carry, rigs, the v2 choices kept (DESIGN_2_1 §4.5.7, §4.6, §4.7, §2.7, §7.3). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const REG = MV.use('core/registry');
const S = MV.use('core/schema');
const H = MV.use('core/hash');
const N = MV.use('core/num');
const SHOT = MV.use('core/shot');
const PL = MV.use('planner/plan');
const CAM = MV.use('planner/camera');
const EX = MV.use('planner/explain');
const STUB = corpus.stubRegistry(MV);

const clone = (x) => JSON.parse(JSON.stringify(x));
const q2 = (x) => Math.round(x * 100) / 100;
const shotOf = (c) => c.slots['cam.shot'].v;
const text = (v) => JSON.stringify(v);

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

// The camera metadata of DESIGN_2_1 §3.11 (package B writes it into the part files; set here so these tests do not
// depend on it): framing lenses and the arrange `cam` field.
const FRAMES = new Set(['dollyOut', 'panSweep', 'parallaxOrbit', 'slowPush']);
const CAM_NONE = new Set(['diptychSplit', 'edgeBleed', 'gridMosaic', 'tickerMarquee']);
const CAM_GENTLE = new Set(['breathMark', 'confettiWords', 'creditFold', 'haloRing', 'hangingTags', 'slantBand', 'titlePlate']);
function withCameraMeta(reg) {
  return REG.createRegistry(reg.all().map((d) => {
    if (d.kind === 'lens' && FRAMES.has(d.key)) return Object.assign({}, d, { frames: true });
    if (d.kind === 'arrange' && CAM_NONE.has(d.key)) return Object.assign({}, d, { cam: 'none' });
    if (d.kind === 'arrange' && CAM_GENTLE.has(d.key)) return Object.assign({}, d, { cam: 'gentle' });
    return d;
  }));
}
const CAT = withCameraMeta(MV.use('parts/catalog').defaultRegistry());
// The synthetic parts with four framing lenses, two arranges without camerawork and two gentle ones.
const SYN = REG.createRegistry(synthRegistry().all().map((d) => {
  if (d.kind === 'lens' && /0[0-3]$/.test(d.key)) return Object.assign({}, d, { frames: true });
  if (d.kind === 'arrange' && /0[45]$/.test(d.key)) return Object.assign({}, d, { cam: 'none' });
  if (d.kind === 'arrange' && /0[67]$/.test(d.key)) return Object.assign({}, d, { cam: 'gentle' });
  return d;
}));

function camOf(plan) {
  return plan.cuts.map((c) => [c.key, ...['motion.speed', 'cam.shot', 'cam.zoom', 'cam.curve', 'cam.follow'].map((s) => c.slots[s]), c.rig]);
}

// A cut whose shot the §4.7 rules leave open (no forced 'none', no role or gentle pool).
function free(reg, plan, c) {
  const arr = reg.get('arrange', c.slots.arrange.v);
  return (c.role === 'lyric' || c.role === 'focus') && c.feat.dur >= 0.8 && !(arr.cam === 'none' || arr.cam === 'gentle') &&
    plan.look.amounts.camera >= 0.1;
}

// --- determinism and the v2 choices ------------------------------------------------------------------------------

test('camerawork is deterministic: fresh, cached and copied documents give the same shots, rigs and hash', () => {
  for (const [rn, reg] of [['catalog', CAT], ['synthetic', SYN]]) {
    for (const { name, doc } of corpus.corpus(2)) {
      const a = PL.run(doc, reg, { fresh: true });
      const b = PL.plan(clone(doc), { registry: reg });
      const c = PL.run(clone(doc), reg, null);
      for (const p of [b, c]) {
        assert.equal(p.hash, a.hash, rn + ' ' + name);
        assert.deepEqual(camOf(p), camOf(a), rn + ' ' + name);
        assert.deepEqual(p.rigs, a.rigs, rn + ' ' + name + ' rigs');
      }
    }
  }
});

// The v2 part choices of the corpus, made by the planner before v2.1 (the same code without planner/camera, the line
// conditions and the media rules): every part slot's value, parameters and source, each cut's window, the segments,
// the transitions and the warnings, hashed. Documents without the new pins must keep every one of them (§4.7
// "Stability"): the camera slots draw from streams of their own and change no part choice.
const V2_CHOICES = { stub: 'dcc001fb', synthetic: '23fb8229' };
const V2_SLOTS = /^(orient|arrange|arrive|dwell|depart|lens|text\.(face|scale|ink|style)|(ornament|filter)(\.count|#\d))$/;
function v2Choices(plan) {
  return [plan.cuts.map((c) => [c.key, c.a, c.b, Object.keys(c.slots).filter((s) => V2_SLOTS.test(s)).sort()
    .map((s) => [s, c.slots[s].v, c.slots[s].p || null, c.slots[s].from])]),
  plan.grounds.map((g) => [g.key, g.t0, g.t1, g.ground, g.atmos]), plan.seams, plan.warnings];
}

test('documents without the new pins keep every v2 part choice (digest of the pre-v2.1 planner)', () => {
  for (const [rn, reg] of [['stub', STUB], ['synthetic', synthRegistry()]]) {
    const digest = H.hashJSON(corpus.corpus(4).map(({ doc }) => v2Choices(PL.run(doc, reg, null))));
    assert.equal(digest, V2_CHOICES[rn], rn);
  }
});

// --- the rules of §4.7 ------------------------------------------------------------------------------------------

test('amount.camera 0 gives no shot and no rig; below 0.15 no rig; pins still apply', () => {
  for (const { name, doc } of corpus.corpus(2)) {
    for (const x of [0, 0.05]) {
      const off = clone(doc);
      off.pins['work:amount.camera'] = { v: x, by: 'user' };
      const p = PL.run(off, CAT, null);
      for (const c of p.cuts) assert.deepEqual(c.slots['cam.shot'], { from: 'auto', v: 'none' }, name + ' ' + c.key);
      for (const r of p.rigs) assert.equal(r.rig.v, 'none', name + ' ' + r.key);
      assert.ok(p.grounds.every((g) => g.zoomed === false), name + ' nothing is zoomed');
    }
    const low = clone(doc);
    low.pins['work:amount.camera'] = { v: 0.12, by: 'user' };
    const q = PL.run(low, CAT, null);
    assert.ok(q.rigs.every((r) => r.rig.v === 'none'), name + ' no rig below 0.15');
    const pinned = clone(doc);
    pinned.pins['work:amount.camera'] = { v: 0, by: 'user' };
    pinned.pins['work:cam.shot'] = { v: 'settle', by: 'user' };
    pinned.pins['work:rig'] = { v: 'slowSwell', by: 'user' };
    const r = PL.run(pinned, CAT, null);
    assert.ok(r.cuts.every((c) => shotOf(c) === 'settle' && c.slots['cam.shot'].from === 'pin:work'), name + ' a pinned shot wins');
    // amp at A = 0 is 0.3, and 0.38 on the last chorus (×1.25)
    assert.ok(r.rigs.every((g) => g.rig.v === 'slowSwell' && [0.3, 0.38].includes(g.rig.p.amp)), name + ' a pinned rig wins');
  }
});

test('rules: layouts without camerawork, gentle layouts, short cuts and the roles keep to their pools', () => {
  let none = 0, gentle = 0, short = 0, roles = 0;
  for (const [rn, reg] of [['catalog', CAT], ['synthetic', SYN]]) {
    for (const { name, doc } of corpus.corpus(4)) {
      const p = PL.run(doc, reg, null);
      if (p.look.amounts.camera < 0.1) continue;
      for (const c of p.cuts) {
        const v = shotOf(c), where = rn + ' ' + name + ' ' + c.key;
        const arr = reg.get('arrange', c.slots.arrange.v);
        if (arr.cam === 'none') {
          none++;
          assert.deepEqual(c.slots['cam.shot'], { from: 'rule', v: 'none' }, where);
          continue;
        }
        if (c.feat.dur < 0.8) { short++; assert.ok(['none', 'settle'].includes(v), where + ' short: ' + v); }
        const pool = { title: ['pullReveal', 'settle', 'wideHold'], interlude: ['driftOff', 'none', 'wideHold'],
          outro: ['none', 'pullReveal', 'wideHold'] }[c.role];
        if (pool) { roles++; assert.ok(pool.includes(v), where + ' ' + c.role + ': ' + v); }
        if (arr.cam === 'gentle') {
          gentle++;
          assert.ok(['driftOff', 'settle', 'tiltHold', 'wideHold'].includes(v), where + ' gentle: ' + v);
          const fill = SHOT.maxFill(v);
          if (fill > 0) assert.ok(c.slots['cam.zoom'].v * fill <= 0.7 + 0.005, where + ' gentle zoom');
        }
      }
    }
  }
  assert.ok(none > 50 && gentle > 50 && short > 20 && roles > 20, [none, gentle, short, roles].join(' '));
});

test('cam.zoom, cam.curve and cam.follow follow their formulas (§4.7)', () => {
  let n = 0;
  for (const { doc } of corpus.corpus(2)) {
    const p = PL.run(doc, CAT, null);
    const A = p.look.amounts.camera, M = p.look.amounts.motion;
    const mood = CAT.get('mood', p.look.mood.v);
    for (const c of p.cuts) {
      const f = c.feat, shot = shotOf(c);
      let z = q2(N.lerp(0.8, 0.9, N.clamp(0.5 * A + 0.5 * f.energy)) * (f.impact ? 1.05 : 1));
      if (CAT.get('arrange', c.slots.arrange.v).cam === 'gentle' && SHOT.maxFill(shot) > 0) z = Math.min(z, 0.7 / SHOT.maxFill(shot));
      assert.equal(c.slots['cam.zoom'].v, S.coerce(CAM.SLOT_SPECS['cam.zoom'], z), c.key + ' zoom');
      const curves = f.impact ? ['dashStop', 'holdThenDash'] : f.energy >= 0.65 || (mood.tagBias.fast || 1) > 1.2
        ? ['hushRushHush', 'holdThenDash', 'softEnds'] : ['softEnds', 'fadeBrake', 'slowBloom'];
      assert.ok(curves.includes(c.slots['cam.curve'].v), c.key + ' curve ' + c.slots['cam.curve'].v);
      const fast = (CAT.get('arrive', c.slots.arrive.v).tags || []).includes('fast');
      const follow = shot === 'none' || shot === 'wideHold' ? 0 : shot === 'readAlong' ? 0.25
        : q2(N.clamp(0.1 + 0.4 * M + (fast ? 0.1 : 0)));
      assert.equal(c.slots['cam.follow'].v, follow, c.key + ' follow');
      assert.deepEqual(c.slots['motion.speed'], { from: 'auto', v: 1 }, c.key + ' speed');
      n++;
    }
  }
  assert.ok(n > 500);
});

test('motion.speed divides the unpinned durations and staggers of arrive and depart and speeds up the hold (§4.3)', () => {
  const NAMES = { arrive: ['dur', 'each'], depart: ['dur', 'each'], dwell: ['speed'] };
  let scaled = 0, kept = 0;
  for (const { name, doc } of corpus.corpus(2)) {
    const p1 = PL.run(doc, CAT, null);
    // Pinned parameters (the corpus has some; one more duration here) stay as they are at any speed.
    const target = p1.cuts.find((c) => c.slots.arrive.p && typeof c.slots.arrive.p.dur === 'number');
    const pinned = clone(doc);
    pinned.pins['cut/' + target.key + ':arrive.dur'] = { v: 0.55, by: 'user', sig: target.text };
    const pp = PL.run(pinned, CAT, null);
    for (const speed of [0.5, 2]) {
      const fast = clone(pinned);
      fast.pins['work:motion.speed'] = { v: speed, by: 'user' };
      const p2 = PL.run(fast, CAT, null);
      p2.cuts.forEach((c, i) => {
        const was = pp.cuts[i];
        assert.deepEqual(c.slots['motion.speed'], { by: 'user', from: 'pin:work', v: speed }, name + ' ' + c.key);
        for (const kind of Object.keys(NAMES)) {
          const a = was.slots[kind], b = c.slots[kind];
          assert.equal(b.v, a.v, name + ' ' + c.key + ' ' + kind + ' keeps its part');
          if (!a.p) continue;
          const specs = CAT.params(kind, a.v);
          for (const param of NAMES[kind]) {
            if (typeof a.p[param] !== 'number') continue;
            const where = name + ' ' + c.key + ' ' + kind + '.' + param + ' ×' + speed;
            if (a.pfrom && a.pfrom[param]) {
              assert.equal(b.p[param], a.p[param], where + ' (pinned)');
              assert.equal(b.pfrom[param], a.pfrom[param], where + ' (pinned)');
              kept++;
              continue;
            }
            const spec = specs.find((e) => e.name === param).spec;
            assert.equal(b.p[param], S.coerce(spec, kind === 'dwell' ? a.p[param] * speed : a.p[param] / speed), where);
            assert.equal(b.pfrom[param], 'rule', where);
            if (b.p[param] !== a.p[param]) scaled++;
          }
        }
      });
    }
  }
  assert.ok(scaled > 300 && kept >= 4, scaled + ' ' + kept);
});

// §7.3 asks for "impact cuts favour snapZoom (≥ 60 %)", "framing lens → none ≥ 70 %" and "repeated lines share shots
// (≥ 80 %)", where the rules leave the shot open. With the constants tuned in goldens step (b) (§7.5; NOTES "Step (b):
// automatic camerawork"), corpus(6) gives: impact → snapZoom 88 % catalog / 88 % synthetic; framing lens → none 80 % /
// 78 %; repeats sharing their shot 56 % / 53 %, against 30 % / 22 % for unrelated cuts. On independent samples (corpus
// seeds 20–39, corpus(20), the 8 catalog moods pinned) the catalog gives 68–79 % / 78–79 % / 55–56 %, the synthetic
// registry 79–83 % / 76–77 % / 54 %; impact → snapZoom varies by mood (46 % in quietHush, 52 % in dreamHaze, the calm
// moods' bias against 'hard' and 'fast' shots). The last target is out of reach of the constants: 'none' is never an
// echo (only preset shots are choices, §3.9), and the first copy of about half the repeated cuts is on 'none' (a layout
// without camerawork, a framing lens, a low camera amount). Where the echo can act (the first copy open to the rules and
// on a preset) 59–62 % / 64–65 % share it; a stronger echo, or a weaker recency, makes an edit change more cuts
// (planner_stability) and gives the framing-lens target away. The floors below leave room for those samples.
test('impact cuts favour snapZoom; framing lenses favour no shot; repeated lines echo their shot', (t) => {
  for (const [rn, reg] of [['catalog', CAT], ['synthetic', SYN]]) {
    const st = { imp: 0, impSnap: 0, other: 0, otherSnap: 0, fr: 0, frNone: 0, nfr: 0, nfrNone: 0, rep: 0, repSame: 0, ctl: 0, ctlSame: 0,
      open: 0, openSame: 0 };
    for (const { doc } of corpus.corpus(6)) {
      const p = PL.run(doc, reg, null);
      const byKey = new Map(p.cuts.map((c) => [c.key, c]));
      p.cuts.forEach((c, i) => {
        if (!free(reg, p, c)) return;
        const v = shotOf(c);
        if (c.impact) { st.imp++; if (v === 'snapZoom') st.impSnap++; } else { st.other++; if (v === 'snapZoom') st.otherSnap++; }
        if (reg.get('lens', c.slots.lens.v).frames) { st.fr++; if (v === 'none') st.frNone++; } else { st.nfr++; if (v === 'none') st.nfrNone++; }
        const o = c.feat.repeatOf ? byKey.get(c.feat.repeatOf) : null;
        if (o) {
          st.rep++; if (text(shotOf(o)) === text(v)) st.repSame++;
          if (free(reg, p, o) && shotOf(o) !== 'none') { st.open++; if (text(shotOf(o)) === text(v)) st.openSame++; }
        } else if (i >= 2) {
          st.ctl++; if (text(shotOf(p.cuts[i - 2])) === text(v)) st.ctlSame++;
        }
      });
    }
    const share = (a, b) => st[a] / st[b];
    t.diagnostic(rn + ': impact → snapZoom ' + share('impSnap', 'imp').toFixed(2) + ' (' + st.imp + ' cuts), other cuts ' +
      share('otherSnap', 'other').toFixed(3) + '; framing lens → none ' + share('frNone', 'fr').toFixed(2) + ', other lenses ' +
      share('nfrNone', 'nfr').toFixed(2) + '; repeats share ' + share('repSame', 'rep').toFixed(2) + ' (where the echo can act ' +
      share('openSame', 'open').toFixed(2) + '), unrelated ' + share('ctlSame', 'ctl').toFixed(2));
    assert.ok(st.imp > 30 && st.fr > 300 && st.rep > 300 && st.open > 300, rn + ' enough cases');
    assert.ok(share('impSnap', 'imp') >= 0.6, rn + ' impact → snapZoom ' + share('impSnap', 'imp'));
    assert.ok(share('otherSnap', 'other') < 0.02, rn + ' snapZoom is for impacts');
    assert.ok(share('frNone', 'fr') >= 0.7 && share('frNone', 'fr') >= 4 * share('nfrNone', 'nfr'), rn + ' framing lens → none');
    assert.ok(share('repSame', 'rep') >= 0.5 && share('repSame', 'rep') >= 1.6 * share('ctlSame', 'ctl'), rn + ' repeats echo their shot');
    assert.ok(share('openSame', 'open') >= 0.55, rn + ' the echo where it can act ' + share('openSame', 'open'));
  }
});

// The moving shots of a video vary (step (b), round 2): with the recency of round 1 (×0.4, ×0.7) 'settle' took up to
// 3/4 of a video's moving shots and ran over 6 cuts in a row in the calm moods. Over corpus(6), for plans with at least 8
// moving shots: the most common one's share (median ≤ 0.45, over 0.6 in ≤ 5 % of plans), neighbouring cuts on the same
// moving shot (≤ 7 %; the echo of consecutive repeated lines counts too) and the longest such run (≤ 6 cuts). Now:
// median 0.40 / 0.40, over 0.6 in 1 / 2 plans, neighbours 3.5 % / 5.9 %, longest 4 / 5 (catalog / synthetic).
test('the moving shots of a video vary: no preset takes most of them, few neighbours and no long runs share one', (t) => {
  for (const [rn, reg] of [['catalog', CAT], ['synthetic', SYN]]) {
    const dominant = [];
    let pairs = 0, same = 0, longest = 0;
    for (const { doc } of corpus.corpus(6)) {
      const shots = PL.run(doc, reg, null).cuts.map((c) => text(shotOf(c)));
      const moving = shots.filter((v) => v !== text('none'));
      const count = new Map();
      for (const v of moving) count.set(v, (count.get(v) || 0) + 1);
      if (moving.length >= 8) dominant.push(Math.max(...count.values()) / moving.length);
      let run = 1;
      for (let i = 1; i < shots.length; i++) {
        pairs++;
        if (shots[i] !== text('none') && shots[i] === shots[i - 1]) { same++; run++; longest = Math.max(longest, run); } else run = 1;
      }
    }
    dominant.sort((a, b) => a - b);
    const median = dominant[dominant.length >> 1], over = dominant.filter((x) => x > 0.6).length;
    t.diagnostic(rn + ': dominant moving shot median ' + median.toFixed(2) + ', over 0.6 in ' + over + ' of ' + dominant.length +
      ' plans; neighbours on the same moving shot ' + (100 * same / pairs).toFixed(1) + ' %; longest run ' + longest);
    assert.ok(dominant.length > 40, rn + ' enough plans');
    assert.ok(median <= 0.45, rn + ' median ' + median);
    assert.ok(over <= 0.05 * dominant.length, rn + ' over 0.6: ' + over);
    assert.ok(same <= 0.07 * pairs, rn + ' neighbours ' + same + ' of ' + pairs);
    assert.ok(longest <= 6, rn + ' longest run ' + longest);
  }
});

test('the echo weighs ×40, the previous shot ×0.2 and the three before ×0.5 (shotWeights through explain)', () => {
  const doc = corpus.project('long').doc;
  const p = PL.plan(doc, { registry: CAT });
  let echoed = 0, recent = 0;
  for (const c of p.cuts.filter((x, i) => i % 3 === 0)) {
    if (!free(CAT, p, c)) continue;
    const e = EX.explain(doc, p, 'cut/' + c.key + ':cam.shot', { registry: CAT });
    assert.equal(text(e.value), text(shotOf(c)));
    if (e.from !== 'auto') continue;
    assert.equal(e.alts.length, CAM.SHOT_POOL.length);
    assert.ok(e.alts.find((a) => a.key === shotOf(c)).w > 0, c.key + ' the chosen shot weighs > 0');
    const i = p.cuts.indexOf(c);
    const prev = i > 0 ? p.cuts[i - 1].slots['cam.shot'].v : null;
    if (prev && prev !== 'none' && typeof prev === 'string' && prev !== shotOf(c)) {
      assert.ok(e.why.some((w) => w.code === 'recent' && w.params.key === prev), c.key + ' recency named');
      recent++;
    }
    if (c.feat.repeatOf && e.why.some((w) => w.code === 'echo')) echoed++;
  }
  assert.ok(recent > 10, 'recent ' + recent);
  assert.ok(echoed > 0, 'echo named');
  // The factors themselves, on a cut's weights: the same cut with and without its neighbours' shots.
  const st = { ctx: { look: { amounts: { camera: 0.3, motion: 0.4 }, mood: { key: 'm', tagBias: {} } }, registry: CAT, salts: null },
    cut: { key: 'r1~0', line: 'r1', role: 'lyric', feat: { dur: 2, energy: 0.5, words: 3, cells: 9, emph: false, impact: false,
      onBeat: false, sectionStart: false, section: 'chorus', repeatOf: 'r0~0' } },
    chosen: { orient: 'h', arrange: 'centerAnchor', lens: 'fixedFrame' }, natural: false,
    hist: { echo: () => 'settle', previous: () => 'tiltHold', recent: () => ({ near: ['driftOff'] }) } };
  const w = Object.fromEntries(CAM.shotWeights(st).map((x) => [x.key, x.w]));
  assert.equal(w.settle, N.q6(1.2 * 40), 'settle echoed');
  assert.equal(w.tiltHold, N.q6(0.6 * 0.2), 'tiltHold was the previous shot');
  assert.equal(w.driftOff, N.q6(0.7 * 0.5), 'driftOff was among the 3 before');
  assert.equal(w.none, N.q6(3 * 0.49 * 0.6), 'none in a chorus');
  assert.equal(w.pushWord, N.q6(0.3 * 1.1 * 1.5), 'pushWord in a chorus');
  assert.equal(w.readAlong, 0, 'readAlong needs 2.2 s');
  assert.equal(w.sweepAcross, N.q6(0.3 * 1.5), 'sweepAcross in a chorus');
  st.cut.feat = Object.assign({}, st.cut.feat, { impact: true });
  assert.equal(Object.fromEntries(CAM.shotWeights(st).map((x) => [x.key, x.w])).snapZoom, N.q6(30 * 1.5), 'an impact snap');
  // A framing lens adds 24 to 'none' (a lens that moves the frame itself takes no shot on top).
  st.chosen = Object.assign({}, st.chosen, { lens: 'slowPush' });
  assert.equal(Object.fromEntries(CAM.shotWeights(st).map((x) => [x.key, x.w])).none, N.q6((3 * 0.49 + 24) * 0.6), 'a framing lens');
});

// --- carry ------------------------------------------------------------------------------------------------------

test('carry: consecutive cuts of one line across a hard cut or a text transition, into a preset shot', () => {
  let carried = 0, eligible = 0;
  for (const [rn, reg] of [['catalog', CAT], ['synthetic', SYN]]) {
    for (const { name, doc } of corpus.corpus(3)) {
      const p = PL.run(doc, reg, null);
      p.cuts.forEach((B, j) => {
        const d = B.slots['cam.shot'];
        const A = j > 0 ? p.cuts[j - 1] : null;
        const a = A ? A.slots['cam.shot'] : null;
        const seam = B.seamIn >= 0 ? p.seams[B.seamIn] : null;
        const k0 = typeof d.v === 'string' && d.v !== 'none' ? SHOT.SHOTS[d.v].keys[0] : null;
        const framing = a && a.v !== 'none' ? SHOT.lastFraming(a.v, { zoom: A.slots['cam.zoom'].v }) : null;
        const want = !!A && !!A.line && A.line === B.line && !!k0 && k0.at === 'a' && !['frame', 'point'].includes(k0.aim) &&
          (!seam || seam.scope === 'text') && !!framing;
        const where = rn + ' ' + name + ' ' + B.key;
        if (want) {
          eligible++;
          assert.deepEqual(d.p, { carry: framing }, where);
          assert.deepEqual(d.pfrom, { carry: 'rule' }, where);
          assert.ok(Object.isFrozen(d) && Object.isFrozen(d.p.carry), where + ' frozen');
          carried++;
        } else assert.equal(d.p, undefined, where + ' no carry');
      });
    }
  }
  assert.ok(carried > 50 && eligible === carried, carried + ' / ' + eligible);
  // A pinned custom shot is never carried into; a pinned preset is.
  const doc = clone(corpus.project('basic').doc);
  const p0 = PL.run(doc, CAT, null);
  const two = p0.lines.find((l) => l.cuts.length >= 2);
  const B = two.cuts[1];
  doc.pins['line/' + two.id + ':cam.shot'] = { v: 'settle', by: 'user' };
  const p1 = PL.run(doc, CAT, null);
  const b1 = p1.cuts.find((c) => c.key === B);
  assert.ok(b1.seamIn < 0 || p1.seams[b1.seamIn].scope === 'text', 'the fixture\'s second cut follows a hard cut or a text transition');
  assert.deepEqual(b1.slots['cam.shot'].p, { carry: SHOT.lastFraming('settle', { zoom: p1.cuts[p1.cuts.indexOf(b1) - 1].slots['cam.zoom'].v }) });
  assert.equal(b1.slots['cam.shot'].from, 'pin:line');
  const e = EX.explain(doc, p1, 'cut/' + B + ':cam.shot', { registry: CAT });
  assert.deepEqual(e.why, [{ code: 'pin', params: { scope: 'line', by: 'user' } }, { code: 'rule', params: { rule: 'carry' } }]);
  const custom = clone(doc);
  custom.pins['cut/' + B + ':cam.shot'] = { v: { keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'emph', fill: 0.9 }] }, by: 'user', sig: b1.text };
  const p2 = PL.run(custom, CAT, null);
  assert.equal(p2.cuts.find((c) => c.key === B).slots['cam.shot'].p, undefined, 'a custom shot keeps its own start');
});

// --- rigs -------------------------------------------------------------------------------------------------------

test('rig runs: every cut in one run; runs tile the video and follow sections, special cuts and rig pins', () => {
  for (const [rn, reg] of [['catalog', CAT], ['synthetic', SYN]]) {
    for (const { name, doc } of corpus.corpus(2).concat(corpus.projects(['v21']).map((x) => ({ name: 'v21', doc: x.doc })))) {
      const p = PL.run(doc, reg, null);
      const where = rn + ' ' + name;
      let t = 0, next = 0;
      p.rigs.forEach((r, k) => {
        assert.deepEqual(Object.keys(r), ['blend', 'cuts', 'curve', 'key', 'rig', 't0', 't1'], where);
        assert.equal(r.t0, t, where + ' runs tile the video');
        assert.ok(r.t1 >= r.t0);
        t = r.t1;
        assert.equal(r.key, 'k' + r.cuts[0]);
        const cuts = r.cuts.map((key) => p.cuts[next++]);
        assert.deepEqual(cuts.map((c) => c.key), r.cuts, where + ' contiguous');
        for (const c of cuts) assert.equal(c.rig, k, where + ' cut.rig');
        const sections = new Set(cuts.map((c) => c.feat.section));
        assert.equal(sections.size, 1, where + ' one section per run');
        if (cuts.some((c) => ['title', 'interlude', 'outro'].includes(c.role))) assert.equal(cuts.length, 1, where + ' special cuts alone');
        const s = cuts[0].seamIn >= 0 ? p.seams[cuts[0].seamIn] : null;
        assert.deepEqual(r.blend, k > 0 && s ? { t0: N.q6(s.at - s.dur / 2), t1: N.q6(s.at + s.dur / 2) } : null, where + ' blend');
        assert.ok(r.rig.v === 'none' ? r.rig.p === undefined : r.rig.p.amp > 0, where + ' amp');
        if (k > 0) {
          const prev = p.cuts[next - cuts.length - 1];
          const reason = prev.feat.section !== cuts[0].feat.section || [prev, cuts[0]].some((c) => ['title', 'interlude', 'outro'].includes(c.role)) ||
            text(p.rigs[k - 1].rig.v) !== text(r.rig.v) || p.rigs[k - 1].rig.from !== r.rig.from;
          assert.ok(reason, where + ' ' + r.key + ' starts for a reason');
        }
      });
      assert.equal(next, p.cuts.length, where + ' every cut');
      assert.equal(t, p.duration, where + ' the last run ends with the video');
    }
  }
  // A cut pin splits the run around that cut, like a background pin.
  const doc = clone(corpus.project('long').doc);
  const p0 = PL.run(doc, CAT, null);
  const mid = p0.cuts[40];
  doc.pins['cut/' + mid.key + ':rig'] = { v: 'pullAway', by: 'user', sig: mid.text };
  const p1 = PL.run(doc, CAT, null);
  const run = p1.rigs[p1.cuts.find((c) => c.key === mid.key).rig];
  assert.deepEqual(run.cuts, [mid.key]);
  assert.deepEqual(run.rig, { by: 'user', from: 'pin:cut', p: { amp: q2(0.3 + 0.4 * p1.look.amounts.camera) }, v: 'pullAway' });
  assert.equal(run.curve.v, 'fadeBrake', 'the preset curve');
});

test('rig choice: the section rows, the runner-up rule, the last chorus and rig.curve', () => {
  const ROWS = { chorus: ['climbRise', 'leanTilt', 'none', 'slowSwell'], prechorus: ['climbRise', 'slowSwell'],
    verse: ['driftSide', 'none', 'slowSwell'], bridge: ['driftSide', 'leanTilt', 'none'], intro: ['none', 'slowSwell'],
    outro: ['none', 'pullAway'], interlude: ['driftSide', 'none'], other: ['climbRise', 'slowSwell'] };
  let chorusEnds = 0;
  for (const src of [corpus.corpus(4, ['16:9'], ['basic']), corpus.projects(['v21'])]) {
    for (const x of src) {
      for (let s = 0; s < 6; s++) {
        const doc = clone(x.doc);
        doc.look.seed = (doc.look.seed + s * 7919) >>> 0;
        doc.pins['work:amount.camera'] = { v: 0.2 + 0.15 * s, by: 'user' };
        const p = PL.run(doc, CAT, null);
        const A = p.look.amounts.camera;
        let last = -1;
        p.rigs.forEach((r, k) => {
          const first = p.cuts.find((c) => c.key === r.cuts[0]);
          if (first.feat.section === 'chorus' && !['title', 'interlude', 'outro'].includes(first.role)) last = k;
        });
        p.rigs.forEach((r, k) => {
          const first = p.cuts.find((c) => c.key === r.cuts[0]);
          const sec = first.feat.section;
          const row = first.role === 'title' ? 'intro' : ['interlude', 'outro'].includes(first.role)
            ? (['intro', 'interlude', 'outro'].includes(sec) ? sec : first.role) : sec === null ? 'verse' : ROWS[sec] ? sec : 'other';
          assert.ok(ROWS[row].includes(r.rig.v), r.key + ' ' + row + ': ' + r.rig.v);
          const amp = q2(Math.min(1.3, q2(0.3 + 0.4 * A) * (k === last ? 1.25 : 1)));
          if (r.rig.v !== 'none') assert.equal(r.rig.p.amp, amp, r.key + ' amp');
          const curve = k === last && r.rig.v !== 'none' ? 'slowBloom' : r.rig.v === 'none' ? 'linear' : SHOT.RIGS[r.rig.v].curve;
          assert.deepEqual(r.curve, { from: 'auto', v: curve }, r.key + ' curve');
          if (k === last && r.rig.v !== 'none') chorusEnds++;
        });
      }
    }
  }
  assert.ok(chorusEnds > 5, 'last choruses ' + chorusEnds);
  // The runner-up rule: a run does not take the previous run's winner while another candidate weighs > 0. A rig pin on
  // the first cut of a longer run makes that cut a run of its own whose winner is the pin (the heaviest rig of the
  // row); the rest of the run reads the same row and must take another rig.
  const HEAVIEST = { chorus: 'slowSwell', prechorus: 'climbRise', verse: 'driftSide', bridge: 'leanTilt', intro: 'slowSwell',
    outro: 'pullAway', interlude: 'driftSide', other: 'slowSwell' };
  let avoided = 0;
  for (const src of [corpus.corpus(4, ['16:9'], ['basic']), corpus.projects(['v21'])]) {
    for (const x of src) {
      for (let s = 0; s < 4; s++) {
        const doc = clone(x.doc);
        doc.look.seed = (doc.look.seed + s * 104729) >>> 0;
        doc.pins['work:amount.camera'] = { v: 0.8, by: 'user' };
        const p0 = PL.run(doc, CAT, null);
        for (const r of p0.rigs) {
          if (r.cuts.length < 2) continue;
          const first = p0.cuts.find((c) => c.key === r.cuts[0]);
          const sec = first.feat.section;
          doc.pins['cut/' + first.key + ':rig'] = { v: HEAVIEST[sec === null ? 'verse' : ROWS[sec] ? sec : 'other'], by: 'user', sig: first.text };
        }
        const p = PL.run(doc, CAT, null);
        p.rigs.forEach((r, k) => {
          const prev = k ? p.rigs[k - 1].rig : null;
          if (!prev || prev.from !== 'pin:cut' || r.rig.from !== 'auto') return;
          assert.notEqual(r.rig.v, prev.v, r.key + ' repeats the pinned run before it');
          avoided++;
        });
      }
    }
  }
  assert.ok(avoided > 20, 'runs after a pinned one ' + avoided);
  // A pinned rig.curve is read at the run's first cut.
  const doc = clone(corpus.project('basic').doc);
  doc.pins['work:rig'] = { v: 'driftSide', by: 'user' };
  doc.pins['work:rig.curve'] = { v: { ramp: { edge: 0.1, ends: 'both', peak: 3 } }, by: 'ai' };
  const p = PL.run(doc, CAT, null);
  for (const r of p.rigs) {
    assert.deepEqual(r.curve, { by: 'ai', from: 'pin:work', v: { ramp: { edge: 0.1, ends: 'both', peak: 3 } } });
    assert.equal(r.rig.v, 'driftSide');
  }
});

// --- plan fields ------------------------------------------------------------------------------------------------

test('feat.sectionStart, grounds[].zoomed and the Plan v2 fields', () => {
  for (const { name, doc } of corpus.corpus(2).concat(corpus.projects(['v21']).map((x) => ({ name: 'v21', doc: x.doc })))) {
    const p = PL.run(doc, CAT, null);
    assert.equal(p.v, 2);
    p.cuts.forEach((c, i) => {
      assert.equal(c.feat.sectionStart, i === 0 || c.feat.section !== p.cuts[i - 1].feat.section, name + ' ' + c.key);
      for (const s of ['motion.speed', 'cam.shot', 'cam.zoom', 'cam.curve', 'cam.follow']) assert.ok(c.slots[s], name + ' ' + s);
    });
    for (const g of p.grounds) {
      const any = g.cuts.some((k) => p.cuts.find((c) => c.key === k).slots['cam.shot'].v !== 'none');
      assert.equal(g.zoomed, any, name + ' ' + g.key);
    }
    assert.deepEqual(p.media, {});
  }
});

test('re-planning after camera, rig, speed, season and avoid edits gives exactly the plan made from scratch', () => {
  const R = MV.use('core/rng');
  const reg = SYN;
  const shots = SHOT.SHOT_KEYS.concat(['none', { keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'last', fill: 0.8 }] }]);
  let steps = 0;
  for (const name of ['basic', 'long']) {
    const rng = R.stream('camera-replan', name);
    let doc = clone(corpus.project(name).doc);
    for (let i = 0; i < 16; i++) {
      const p = PL.plan(doc, { registry: reg });
      assert.equal(p.hash, PL.run(doc, reg, { fresh: true }).hash, name + ' step ' + i);
      steps++;
      const d = Object.assign({}, doc, { pins: Object.assign({}, doc.pins) });
      const cut = rng.pick(p.cuts), line = rng.pick(p.lines);
      const where = rng.pick(['cut/' + cut.key, 'line/' + line.id, 'work']);
      const sig = where.startsWith('cut/') ? { sig: cut.text } : {};
      const r = rng.next();
      if (r < 0.25) d.pins[where + ':cam.shot'] = Object.assign({ v: rng.pick(shots), by: 'user' }, sig);
      else if (r < 0.4) d.pins[where + ':cam.zoom'] = Object.assign({ v: rng.pick([0.7, 1.4]), by: 'user' }, sig);
      else if (r < 0.5) d.pins[where + ':motion.speed'] = Object.assign({ v: rng.pick([0.5, 2]), by: 'ai' }, sig);
      else if (r < 0.6) d.pins[where + ':rig'] = Object.assign({ v: rng.pick(SHOT.RIG_KEYS.concat(['none'])), by: 'user' }, sig);
      else if (r < 0.7) d.pins['line/' + line.id + ':season'] = { v: rng.pick(['spring', 'winter', 'none']), by: 'ai' };
      else if (r < 0.8) d.pins['line/' + line.id + ':avoid'] = { v: [rng.pick(['arrive.' + cut.slots.arrive.v, 'lens.' + cut.slots.lens.v])], by: 'ai' };
      else if (r < 0.9) d.pins['work:amount.camera'] = { v: rng.pick([0, 0.3, 0.9]), by: 'user' };
      else d.salts = Object.assign({}, d.salts, { ['cut/' + cut.key]: (d.salts['cut/' + cut.key] || 0) + 1 });
      doc = d;
    }
  }
  assert.ok(steps === 32);
});
