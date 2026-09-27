/* 文字PVメーカー v2 — original work. Tests: planner stability — inserting a line, adding a part, rerolling a cut (DESIGN §4.16.4, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const REG = MV.use('core/registry');
const S = MV.use('core/schema');
const PL = MV.use('planner/plan');

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

const SLOTS = ['orient', 'arrange', 'arrive', 'dwell', 'depart', 'lens', 'ornament#0', 'ornament#1', 'ornament#2', 'filter#0',
  'filter#1', 'filter#2'];

function valueOf(cut, slot) { return cut.slots[slot] ? cut.slots[slot].v : null; }

// Choices of the cuts present in both plans (by key), outside `skipLine`: { same, total } over (cut, slot) pairs, and the
// keys of the cuts where anything changed.
function compare(a, b, skipLine) {
  const before = new Map(a.cuts.map((c) => [c.key, c]));
  let same = 0, total = 0;
  const changed = [];
  for (const c of b.cuts) {
    const o = before.get(c.key);
    if (!o || (skipLine && c.line === skipLine)) continue;
    let diff = false;
    for (const slot of SLOTS) {
      const x = valueOf(o, slot), y = valueOf(c, slot);
      if (x === null && y === null) continue;
      total++;
      if (x === y) same++; else diff = true;
    }
    if (diff) changed.push(c.key);
  }
  return { same, total, changed };
}

function lyricRowIndexes(doc) {
  return doc.sheet.rows.map((r, i) => [r, i]).filter(([r]) => r.src.trim() && !/^\s*(#|\[(ti|ar):)/.test(r.src)).map(([, i]) => i);
}

function insertLine(doc, at) {
  const out = JSON.parse(JSON.stringify(doc));
  const id = 'r' + (out.sheet.next++).toString(36);
  out.sheet.rows.splice(at, 0, { id, src: '新しい朝が/来る' });
  return { doc: out, id };
}

function report(t, label, r) {
  t.diagnostic(label + ': kept ' + (100 * r.pooled).toFixed(2) + ' % (' + Object.entries(r.byProject)
    .map(([k, v]) => k + ' ' + (100 * v).toFixed(2) + ' %').join(', ') + '); worst ' + r.worst.n + ' other cuts; ' + r.over4 +
    ' of ' + r.cases + ' insertions changed more than 4');
}

// Every test runs on a synthetic registry (12–18 generated parts per kind, test data) and on the shipped catalog.
const REGISTRIES = [['synthetic', synthRegistry()], ['catalog', MV.use('parts/catalog').defaultRegistry()]];

for (const [RN, SYN] of REGISTRIES) {
  // Every line start pinned where the plan put it (as after tap-sync), so an inserted line takes its time between
  // its neighbours instead of moving the rest of the song.
  function anchored(doc) {
    const out = JSON.parse(JSON.stringify(doc));
    for (const line of PL.run(doc, SYN, null).lines) out.pins['line/' + line.id + ':start'] = { v: line.t0, by: 'tap' };
    return out;
  }

  // Inserts one line at the start, middle and end of every corpus document: { pooled, byProject, worst, over4, cases }.
  // near(b, key, id) → whether a changed cut may change (checked when given).
  function insertions(timing, near) {
    const per = {};
    let same = 0, total = 0, cases = 0, over4 = 0, worst = { n: -1 };
    for (const { name, doc } of corpus.corpus(3)) {
      const base = timing === 'anchored' ? anchored(doc) : JSON.parse(JSON.stringify(doc));
      const a = PL.run(base, SYN, null);
      const rows = lyricRowIndexes(base);
      const project = name.split('@')[0];
      for (const k of [1, rows.length >> 1, rows.length - 1]) {
        const { doc: edited, id } = insertLine(base, rows[k]);
        const b = PL.run(edited, SYN, null);
        const r = compare(a, b, id);
        if (near) for (const key of r.changed) assert.ok(near(b, key, id, a, r.changed), name + ': ' + key + ' changed although it is not next to the new line');
        same += r.same; total += r.total; cases++;
        per[project] = per[project] || { same: 0, total: 0 };
        per[project].same += r.same; per[project].total += r.total;
        if (r.changed.length > 4) over4++;
        if (r.changed.length > worst.n) worst = { n: r.changed.length, where: name + ' before row ' + rows[k] + ': ' + r.changed.join(' ') };
      }
    }
    const byProject = Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.same / v.total]));
    return { pooled: same / total, byProject, worst, over4, cases };
  }

  // §4.16.4: "inserting one line keeps ≥ 98 % of the other cuts' part choices unchanged on average and changes at most 4
  // cuts outside the inserted line". With line starts pinned (as after tap-sync) only the chooser is at work: recency
  // reaches the 5 cuts after the new line (the previous cut's natural and reference picks, the natural picks of the 3
  // before it; see planner/cast createHistory), the seam history the boundaries after it (one more cut, through a seam's
  // replace rule), and the line before it gets a shorter span (its end moves to the new line's start). Nothing else
  // changes. At most 4 cuts change in about 96 % of the insertions, never more than 6 (NOTES.md, WP3 review fixes).
  test(RN + ': inserting a line (starts pinned): ≥ 98 % of the other choices kept; changes stay next to it', (t) => {
    // A composition with its own motion (motion: 'own', e.g. tickerMarquee) forces its cut's entrance, hold and exit
    // (rule values, facts for the recency of the cuts after it), so a change of composition to or from one reaches one
    // more recency window. Only the catalog has such compositions.
    const ownMotion = (plan, key) => {
      const c = plan.cuts.find((x) => x.key === key);
      return !!c && SYN.get('arrange', c.slots.arrange.v).motion === 'own';
    };
    const r = insertions('anchored', (b, key, id, a, changed) => {
      const pos = b.cuts.findIndex((c) => c.line === id);
      const end = pos + b.cuts.filter((c) => c.line === id).length;
      const before = pos > 0 ? b.cuts[pos - 1].line : null;
      const i = b.cuts.findIndex((c) => c.key === key);
      const relay = changed.some((k) => {
        const j = b.cuts.findIndex((c) => c.key === k);
        return j < i && i - j <= 5 && (ownMotion(a, k) || ownMotion(b, k));
      });
      return (before && b.cuts[i].line === before) || (i >= end && i - end < 6) || relay;
    });
    report(t, 'starts pinned', r);
    assert.ok(r.pooled >= 0.98, 'kept ' + r.pooled.toFixed(4));
    for (const [project, kept] of Object.entries(r.byProject)) assert.ok(kept >= 0.965, project + ': kept ' + kept.toFixed(4));
    assert.ok(r.worst.n <= 6, r.worst.where);
    assert.ok(r.over4 <= r.cases * 0.1, r.over4 + ' of ' + r.cases + ' insertions changed more than 4 other cuts');
  });

  // With automatic timing an inserted line also moves every later line (the timing solver shares the song among the
  // lines), and moved lines get new features (energy follows the loudness at their new times; without a song, their
  // position), so some later cuts change far from the new line. That is timing, not the chooser, and the bound of
  // §4.16.4 cannot hold per case there: short projects keep about 96 % (NOTES.md, WP3 review fixes).
  test(RN + ': inserting a line (automatic timing): ≥ 98 % of the other choices kept over the corpus', (t) => {
    const r = insertions('auto', null);
    report(t, 'automatic timing', r);
    assert.ok(r.pooled >= 0.98, 'kept ' + r.pooled.toFixed(4));
    for (const [project, kept] of Object.entries(r.byProject)) assert.ok(kept >= 0.95, project + ': kept ' + kept.toFixed(4));
    assert.ok(r.worst.n <= 9, r.worst.where);
    assert.ok(r.over4 <= r.cases * 0.15, r.over4 + ' of ' + r.cases + ' insertions changed more than 4 other cuts');
  });

  // Measured with realistic pools (the synthetic registry, 12–18 parts per kind). With the stub catalog every kind has
  // two parts, and a third one necessarily takes about a third of that kind's picks.
  test(RN + ': adding one part to the registry keeps ≥ 90 % of the choices', () => {
    for (const kind of ['arrange', 'arrive', 'dwell', 'depart', 'ornament', 'lens', 'filter', 'ground', 'seam']) {
      const model = SYN.all(kind).find((d) => (RN === 'catalog' ? !d.fallback && d.pool !== false && !d.season : d.key.startsWith('syn')) && d.scope !== 'run');
      const extra = Object.assign({}, model, { key: 'extra' + kind[0].toUpperCase() + kind.slice(1), tags: ['bold', 'airy'] });
      const grown = REG.createRegistry(SYN.all().concat([extra]));
      let same = 0, total = 0;
      for (const { doc } of corpus.corpus(1)) {
        const r = compare(PL.run(doc, SYN, null), PL.run(doc, grown, null), null);
        same += r.same; total += r.total;
      }
      assert.ok(same / total >= 0.9, kind + ': unchanged ' + (same / total).toFixed(4));
    }
  });

  // §4.16.4: "rerolling one cut changes at most 3 other cuts". The next cut weighs against the rerolled cut's new
  // reference pick (so the two do not repeat); the cuts after it read only its unsalted natural pick. The seam into the
  // rerolled cut is rerolled with it, and its replace rule may change the exit of the cut before. The runner-up rule of
  // arrange/arrive can, rarely, pass a change on once more (4 cuts). See NOTES.md, WP3 review fixes.
  test(RN + ': rerolling a cut changes at most 3 other cuts (a few more in rare relays)', () => {
    let cases = 0, over = 0, worst = { n: -1 };
    for (const { name, doc } of corpus.corpus(2)) {
      const a = PL.run(doc, SYN, null);
      const step = Math.max(2, Math.floor(a.cuts.length / 10));
      for (let i = 0; i < a.cuts.length; i += step) {
        const key = a.cuts[i].key;
        const rolled = JSON.parse(JSON.stringify(doc));
        rolled.salts = Object.assign({}, rolled.salts, { ['cut/' + key]: (rolled.salts['cut/' + key] || 0) + 1 });
        const others = compare(a, PL.run(rolled, SYN, null), null).changed.filter((k) => k !== key);
        cases++;
        if (others.length > 3) over++;
        if (others.length > worst.n) worst = { n: others.length, where: name + ' ' + key + ': ' + others.join(' ') };
      }
    }
    assert.ok(cases > 200, 'cases ' + cases);
    // The catalog adds two relays the synthetic parts lack: seams that replace an exit (7 of its 8 world transitions
    // and sumiSeep), so a changed seam history changes the exit of the cut before a later seam, and compositions with
    // their own motion. Measured over corpus(6) (725 rerolls): 1.0–1.1 % change more than 3 other cuts, at most 5.
    const bound = RN === 'catalog' ? { worst: 5, share: 0.015 } : { worst: 4, share: 0.01 };
    assert.ok(worst.n <= bound.worst, worst.where);
    assert.ok(over <= cases * bound.share, over + ' of ' + cases + ' rerolls changed more than 3 other cuts');
  });

  test(RN + ': a line reroll changes only that line and the cuts right after it; the look stays', () => {
    for (const { name, doc } of corpus.corpus(1)) {
      const a = PL.run(doc, SYN, null);
      for (const line of a.lines.filter((l, i) => i % 12 === 0)) {
        const rolled = JSON.parse(JSON.stringify(doc));
        rolled.salts = Object.assign({}, rolled.salts, { ['line/' + line.id]: 1 });
        const b = PL.run(rolled, SYN, null);
        const others = compare(a, b, line.id).changed;
        assert.ok(others.length <= 4, name + ' line ' + line.id + ': ' + others.join(' '));
        assert.equal(b.look.mood.v, a.look.mood.v);
        assert.equal(b.look.theme.v, a.look.theme.v);
      }
    }
  });

  // A slot salt changes that slot's stream only (§3.7). Its new value becomes the cut's reference pick, which the next
  // cut weighs against (so the two do not repeat); nothing further depends on it, except the runner-up rule of
  // arrange/arrive one cut later.
  // DESIGN_2_1 §4.7 "Stability": inserting a line changes ≤ 4 other cuts' shots, rerolling a cut ≤ 3. A shot weighs
  // against the previous cut's *final* shot (hist.previous, FROZEN), so a changed shot can, rarely, pass the change on
  // down a run of cuts; the line before an inserted line also gets a shorter span, so new features. And a line sung
  // again inherits the shot of its first sung copy (§4.7 "Repeated lines"): when an insertion changes the shot of a
  // first copy, its repeats follow it. Those followers (a changed cut whose feat.repeatOf cut changed too) are the
  // repeated line at work; they are counted apart, and the §4.7 bound holds the other changes. A rerolled shot does
  // not reach them: what repeats inherit is the shot without salts (planner/cast `unsaltedCast`); the reroll test below
  // counts every changed cut, followers included, and the test after it checks that a salt reaches later shots only
  // through their parts, their span or the shot right before them.
  const shotText = (c) => JSON.stringify(c.slots['cam.shot'].v);
  function shotChanges(a, b, skipLine) {
    const before = new Map(a.cuts.map((c) => [c.key, c]));
    return b.cuts.filter((c) => before.has(c.key) && !(skipLine && c.line === skipLine) && shotText(before.get(c.key)) !== shotText(c))
      .map((c) => c.key);
  }

  // The changed cuts that follow their first sung copy: the cut they repeat (feat.repeatOf) changed its shot too.
  function echoFollowers(b, changed) {
    const byKey = new Map(b.cuts.map((c) => [c.key, c]));
    return changed.filter((k) => changed.includes(byKey.get(k).feat.repeatOf));
  }
  // The changed cuts right after a changed follower that are not followers themselves: they may not repeat the move
  // their neighbour now plays (×0.2 against the previous cut's final shot, §4.7).
  function relaysOf(b, changed, followers) {
    const at = new Map(b.cuts.map((c, i) => [c.key, i]));
    return changed.filter((k) => !followers.includes(k) && at.get(k) > 0 && followers.includes(b.cuts[at.get(k) - 1].key));
  }
  // Of those, the ones that show their first copy's new shot: the same choice, inherited, not a change of their own.
  function inheritors(b, followers) {
    const byKey = new Map(b.cuts.map((c) => [c.key, c]));
    return followers.filter((k) => shotText(byKey.get(k)) === shotText(byKey.get(byKey.get(k).feat.repeatOf)));
  }

  // With line starts pinned only the chooser is at work; with automatic timing the moved lines also get new features
  // (duration, energy), which the §4.7 weights read, so the bound is the one of the part choices above. The bound
  // values are those of goldens step (b) (NOTES "Step (b)"); the echo's followers are counted apart. `all` bounds every
  // changed cut but the followers that show their first copy's new shot: the same choice, inherited (§7.3 at work: the
  // later copies keep matching the first). `own` bounds the changes that are neither followers nor the cut right after
  // a changed follower (a relay: it weighs ×0.2 against the shot the follower now shows, so that the two neighbours do
  // not play one move back to back, and it was held off the follower's old shot the same way). To the user who inserts
  // a line, a first copy near it that changes carries its repeats along, and the cut right next to each repeat moves
  // with it: one change in the later chorus, at the repeat, not a change of its own somewhere else. A change 2–4 cuts
  // after a follower still counts: since round 3 of the review a repeat's natural shot, which the near set of those
  // cuts reads, is its own pick, so they no longer relay (1dcb103 recorded the inherited shot there, and its `own`
  // went over the bound in 21 of the 324 windows below).
  // Measured on corpus seeds 3–29, 30–59 and 90–119 (not the tested sample; 100 + 112 + 112 three-seed windows of this
  // test's size over the two registries and timings), `own` exceeds its bound in 1 / 0 / 0 windows (worst 8 / 6 / 6
  // other cuts), 382dce0 in 1 / 0 / 2 (worst 8 / 6 / 9). Counted with the relays, the cost of the inheritance shows:
  // 7 / 3 / 0 windows (worst 9 / 7 / 6), pooled 10 of 324 against 3 of 324 for 382dce0; the diagnostic prints that
  // count too. `all` exceeds its bound in 8 / 3 / 6 windows (worst 12 / 8 / 8); 382dce0, which counted every changed
  // cut, in 22 / 27 / 26. On seeds 3–29, pinned / automatic timing: `all` over 4 in 1.0 % / 0.3 % (synthetic; worst
  // 6 / 9) and 1.5 % / 0.9 % (catalog; worst 11 / 12), where before the inheritance every changed cut gave 3.5 % / 0.4 %
  // (7 / 6) and 2.7 % / 2.0 % (15 / 12); every changed cut, the inheritors included, now goes over 4 in up to 5.6 %
  // (worst 20–29: a line sung five times with two cuts per line carries up to 8 cuts along with its first copy;
  // followers 351 / 165 and 208 / 174, against 166 / 33 and 123 / 88). `own` over 4 in 0.1 % / 0.1 % (worst 5 / 5)
  // and 0.7 % / 0.3 % (worst 6 / 8), against 0.4 % / 0.1 % (5 / 5) and 1.0 % / 0.3 % (6 / 8); with the relays 0.1 % /
  // 0.2 % (5 / 6) and 1.1 % / 0.4 % (7 / 9). The tested sample (seeds 0–2) passes either way (NOTES "Echo of repeated
  // lines", round 3).
  test(RN + ': inserting a line changes at most 4 other cuts\' shots besides the echoes of a changed first copy', (t) => {
    for (const [timing, bound] of [['anchored', { all: { worst: 7, share: 0.05 }, own: { worst: 6, share: 0.03 } }],
      ['auto', { all: { worst: 9, share: 0.15 }, own: { worst: 8, share: 0.02 } }]]) {
      let cases = 0, relayed = 0;
      const all = { over: 0, worst: { n: -1 } }, own = { over: 0, worst: { n: -1 } }, withRelays = { over: 0, worst: { n: -1 } };
      const count = (acc, keys, where) => {
        if (keys.length > 4) acc.over++;
        if (keys.length > acc.worst.n) acc.worst = { n: keys.length, where: where + ': ' + keys.join(' ') };
      };
      for (const { name, doc } of corpus.corpus(3)) {
        const base = timing === 'anchored' ? anchored(doc) : JSON.parse(JSON.stringify(doc));
        const a = PL.run(base, SYN, null);
        const rows = lyricRowIndexes(base);
        for (const k of [1, rows.length >> 1, rows.length - 1]) {
          const { doc: edited, id } = insertLine(base, rows[k]);
          const b = PL.run(edited, SYN, null);
          const changed = shotChanges(a, b, id), followers = echoFollowers(b, changed), inherited = inheritors(b, followers);
          const relays = relaysOf(b, changed, followers);
          const where = timing + ' ' + name + ' row ' + rows[k];
          cases++;
          relayed += relays.length;
          count(all, changed.filter((key) => !inherited.includes(key)), where + ' (without the inheriting followers)');
          count(own, changed.filter((key) => !followers.includes(key) && !relays.includes(key)), where + ' (without the echo followers and the cut right after each)');
          count(withRelays, changed.filter((key) => !followers.includes(key)), where);
        }
      }
      t.diagnostic('shots, ' + timing + ': ' + all.over + ' of ' + cases + ' insertions changed more than 4 other cuts besides the ' +
        'followers that took their first copy\'s shot (worst ' + all.worst.n + '); without any follower and the cut right after ' +
        'each ' + own.over + ' (worst ' + own.worst.n + '); with that cut (' + relayed + ' of them) ' + withRelays.over + ' (worst ' +
        withRelays.worst.n + ')');
      for (const [acc, lim] of [[all, bound.all], [own, bound.own]]) {
        assert.ok(acc.worst.n <= lim.worst, acc.worst.where);
        assert.ok(acc.over <= cases * lim.share, timing + ': ' + acc.over + ' of ' + cases);
      }
    }
  });

  // Every changed cut counts here, the followers included; the diagnostic gives the count without them too. Since round
  // 4 of the review what a first copy passes on is its shot in the plan without salts (the salt-free re-cast goes on
  // over the cuts whose parts the reroll reached), so a reroll moves a first copy's repeats only where it changes a
  // span. Over corpus seeds 3–29, 30–59 and 90–119 (catalog, 3,356 / 3,732 / 3,705 rerolls), 1 / 0 / 1 rerolls change
  // more than 3 other cuts (worst 4 / 3 / 4), and none of the 26 / 29 / 29 two-seed windows exceeds the bound; followers
  // 4 / 2 / 5. Round 3 (669aa12): 8 / 14 / 15 (worst 8 / 6 / 13; its worst, long@16:9#105 rerolling rg~0, changed the
  // next cut's layout, and that cut and two first copies after it passed other shots on to 10 repeats), windows over
  // 2 / 2 / 2, followers 52 / 69 / 75; 382dce0: 19 / 17 / 17 (worst 8 / 5 / 7), windows over 7 / 0 / 8. With the
  // synthetic parts 0.0 / 0.1 / 0.2 % (worst 4 / 5 / 4), as on 382dce0 and in round 3.
  test(RN + ': rerolling a cut changes at most 3 other cuts\' shots (a few more in rare relays)', (t) => {
    let cases = 0, over = 0, worst = { n: -1 }, overOwn = 0, worstOwn = -1, followed = 0;
    for (const { name, doc } of corpus.corpus(2)) {
      const a = PL.run(doc, SYN, null);
      const step = Math.max(2, Math.floor(a.cuts.length / 10));
      for (let i = 0; i < a.cuts.length; i += step) {
        const key = a.cuts[i].key;
        const rolled = JSON.parse(JSON.stringify(doc));
        rolled.salts = Object.assign({}, rolled.salts, { ['cut/' + key]: (rolled.salts['cut/' + key] || 0) + 1 });
        const b = PL.run(rolled, SYN, null);
        const changed = shotChanges(a, b, null);
        const others = changed.filter((k) => k !== key);
        const own = others.filter((k) => !echoFollowers(b, changed).includes(k));
        cases++;
        followed += others.length - own.length;
        if (others.length > 3) over++;
        if (own.length > 3) overOwn++;
        worstOwn = Math.max(worstOwn, own.length);
        if (others.length > worst.n) worst = { n: others.length, where: name + ' ' + key + ': ' + others.join(' ') };
      }
    }
    t.diagnostic('shots: ' + over + ' of ' + cases + ' rerolls changed more than 3 other cuts (worst ' + worst.n + '); followers ' +
      followed + '; without them ' + overOwn + ' (worst ' + worstOwn + ')');
    assert.ok(cases > 200);
    assert.ok(worst.n <= 5, worst.where);
    assert.ok(over <= cases * 0.02, over + ' of ' + cases);
  });

  // DESIGN_2_1 §4.7 "Stability": a cut's natural shot, which the near set (×0.5) of the cuts 2–4 after it reads, is its
  // own pick, without recency and without the echo, so it does not follow a first copy. When a first copy's shot
  // changes (here: pinned to another preset), its repeats follow it, the cut right after a changed cut may move (×0.2
  // against its new final shot), and the 4 cuts after the first copy itself may; nothing else. 1dcb103 recorded a
  // repeat's inherited shot as its natural shot, and the cuts 2–4 after each follower moved too (here 31 cuts with the
  // synthetic parts, 16 with the catalog): the relays that made insertions less local outside the tested sample (NOTES
  // "Echo of repeated lines", round 3).
  test(RN + ': a changed first copy moves its repeats and the cut right after a changed cut, and nothing else far away', (t) => {
    let firsts = 0, changed = 0, followers = 0;
    const far = [];
    for (const { name, doc } of corpus.corpus(1)) {
      const a = PL.run(doc, SYN, null);
      const at = new Map(a.cuts.map((c, i) => [c.key, i]));
      for (const key of new Set(a.cuts.filter((c) => c.feat.repeatOf).map((c) => c.feat.repeatOf))) {
        const first = a.cuts[at.get(key)];
        const pinned = JSON.parse(JSON.stringify(doc));
        pinned.pins['cut/' + key + ':cam.shot'] = { v: first.slots['cam.shot'].v === 'settle' ? 'tiltHold' : 'settle', by: 'user', sig: first.text };
        const b = PL.run(pinned, SYN, null);
        const moved = b.cuts.map((c, j) => shotText(c) !== shotText(a.cuts[j]));
        const fi = at.get(key);
        firsts++;
        b.cuts.forEach((c, j) => {
          if (!moved[j] || j === fi) return;
          changed++;
          if (c.feat.repeatOf && moved[at.get(c.feat.repeatOf)]) { followers++; return; }
          if ((j > fi && j - fi <= 4) || (j > 0 && moved[j - 1])) return;
          far.push(name + ' pin ' + key + ' → ' + c.key + ' (+' + (j - fi) + ')');
        });
      }
    }
    t.diagnostic(firsts + ' first copies pinned; ' + changed + ' cuts changed, ' + followers + ' of them followers');
    assert.ok(firsts > 100 && followers > 200, firsts + ' / ' + followers);
    assert.deepEqual(far, []);
  });

  // DESIGN_2_1 §4.7 "Stability": what the cuts after a cut read of its shot (its natural shot, which the near set of the
  // 3 cuts after the next one reads; its shadow, for the next cut's heir; its heir, which its repeats inherit) is its
  // shot without salts (planner/cast unsaltedCast), and since round 4 of the review exactly the shot of the plan without
  // salts: the salt-free re-cast goes on over every cut whose history differs from its salt-free twins (a cut after a
  // salted one reads the salted cut's twin, and a cut whose parts come out otherwise without salts keeps a twin too). So
  // a salt reaches a later cut's shot only through that cut's own parts (orientation, layout, lens), a changed span
  // anywhere (other features, so another plan without salts) or the final shot of the cut right before it (×0.2).
  // Wherever no span changed, a cut whose own orientation, layout and lens did not change, after a cut that shows the
  // same shot, shows the same shot, even where the salt changed other cuts' parts. That is what round 4 adds: round 3
  // re-cast an unsalted cut's camera alone over its Plan parts, so a first copy whose layout or lens followed the salt
  // (the v2 path) passed another shot on to its repeats far away, often a shot that neither plan shows (669aa12, round
  // 3, catalog: 31 later cuts moved here, 27 of them after line rerolls). Earlier rounds: the natural shot of a salted cut came
  // from its natural pass (4dedf02), and each cut of a rerolled line was re-cast over the salted picks of the cut before
  // it (1dcb103). Salted here: a reroll and a 寄り die of every tenth cut, and a reroll of that cut's line and of every
  // line holding a first copy. For a line salt, the line's own cuts are the salted ones: they may change anything. Lock
  // pins are left out: a locked cut shows its pins while its neighbours read it without them (§3.6), another path.
  const CAM_PARTS = ['orient', 'arrange', 'lens'];
  test(RN + ': a salt reaches later shots only through their own parts, a span or the shot right before them', (t) => {
    let salts = 0, clean = 0, beside = 0, checked = 0, checkedBeside = 0, lines = 0;
    const moved = [];
    for (const { name, doc: source } of corpus.corpus(2)) {
      const doc = JSON.parse(JSON.stringify(source));
      for (const path of Object.keys(doc.pins || {})) if (doc.pins[path].by === 'lock') delete doc.pins[path];
      const a = PL.run(doc, SYN, null);
      const byKey = new Map(a.cuts.map((c) => [c.key, c]));
      const step = Math.max(2, Math.floor(a.cuts.length / 10));
      const cases = [];
      const rolledLines = new Set(a.cuts.filter((c) => c.feat.repeatOf).map((c) => byKey.get(c.feat.repeatOf).line).filter(Boolean));
      for (let i = 0; i < a.cuts.length; i += step) {
        cases.push([i, 'cut/' + a.cuts[i].key], [i, 'cut/' + a.cuts[i].key + ':cam.zoom']);
        if (a.cuts[i].line) rolledLines.add(a.cuts[i].line);
      }
      for (const line of rolledLines) cases.push([a.cuts.findIndex((c) => c.line === line), 'line/' + line]);
      for (const [i, salt] of cases) {
        const line = salt.startsWith('line/') ? a.cuts[i].line : null;
        const own = (j) => (line ? a.cuts[j].line === line : j === i);
        const rolled = JSON.parse(JSON.stringify(doc));
        rolled.salts = Object.assign({}, rolled.salts, { [salt]: (rolled.salts[salt] || 0) + 1 });
        const b = PL.run(rolled, SYN, null);
        salts++;
        if (line) lines++;
        const spans = b.cuts.length !== a.cuts.length || b.cuts.some((c, j) => c.key !== a.cuts[j].key || c.t0 !== a.cuts[j].t0 ||
          c.t1 !== a.cuts[j].t1);
        if (spans) continue;
        const parts = (j) => CAM_PARTS.some((s) => valueOf(b.cuts[j], s) !== valueOf(a.cuts[j], s));
        const elsewhere = b.cuts.some((c, j) => !own(j) && parts(j));
        if (elsewhere) beside++; else clean++;
        for (let j = i + 1; j < b.cuts.length; j++) {
          if (own(j) || parts(j) || shotText(b.cuts[j - 1]) !== shotText(a.cuts[j - 1])) continue;
          checked++;
          if (elsewhere) checkedBeside++;
          if (shotText(b.cuts[j]) !== shotText(a.cuts[j])) moved.push(name + ' ' + salt + ' → ' + b.cuts[j].key + ' (+' + (j - i) + ')');
        }
      }
    }
    t.diagnostic('salts ' + salts + ' (' + lines + ' lines), of them without a span change ' + (clean + beside) + ' (' + beside +
      ' with a part change elsewhere); later cuts checked ' + checked + ' (' + checkedBeside + ' of them beside a part change)');
    assert.ok(clean > 400 && beside > 50 && checked > 30000 && checkedBeside > 2000, [clean, beside, checked, checkedBeside].join(' / '));
    assert.deepEqual(moved, []);
  });

  test(RN + ': field dice (a slot salt) change that slot of that cut, and at most the next cut (two for arrive)', () => {
    const { doc } = corpus.corpus(1).find((c) => c.name.startsWith('long'));
    const a = PL.run(doc, SYN, null);
    for (const cut of a.cuts.filter((c, i) => i % 23 === 5)) {
      for (const slot of ['arrive', 'dwell', 'lens']) {
        const rolled = JSON.parse(JSON.stringify(doc));
        rolled.salts = { ['cut/' + cut.key + ':' + slot]: 1 };
        const b = PL.run(rolled, SYN, null);
        const r = compare(a, b, null);
        const own = b.cuts.find((c) => c.key === cut.key);
        for (const s of SLOTS.filter((x) => x !== slot)) assert.equal(valueOf(own, s), valueOf(cut, s), cut.key + ' ' + s + ' kept');
        const i = b.cuts.findIndex((c) => c.key === cut.key);
        const reach = slot === 'arrive' ? 2 : 1;
        for (const key of r.changed.filter((k) => k !== cut.key)) {
          const j = b.cuts.findIndex((c) => c.key === key);
          assert.ok(j > i && j - i <= reach, cut.key + ' ' + slot + ': ' + r.changed.join(' '));
        }
      }
    }
  });
}
