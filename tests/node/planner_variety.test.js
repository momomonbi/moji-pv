/* 文字PVメーカー v2 — original work. Tests: planner variety — no adjacent repeats, coverage, shares, moods differ (DESIGN §4.16.4, §8.2). */
// Every test runs twice: on a synthetic registry (many generated parts per kind, test data) and on the shipped catalog
// (parts/catalog), whose pools are what users get (WP3 acceptance: "with the full catalog at M3").
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const REG = MV.use('core/registry');
const S = MV.use('core/schema');
const PL = MV.use('planner/plan');
const CH = MV.use('planner/choose');

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

const REGISTRIES = [
  { name: 'synthetic', reg: synthRegistry(), moods: { calm: 'synMoodCalm', glitch: 'synMoodGlitch', pop: 'synMoodPop' } },
  { name: 'catalog', reg: MV.use('parts/catalog').defaultRegistry(),
    moods: { calm: 'quietHush', glitch: 'glitchFracture', pop: 'popFizz' } },
];

// The corpus, plus copies without '/' marks so the auto cutter (and its focus pieces) take part.
function docs(seeds) {
  const out = corpus.corpus(seeds);
  for (const { name, doc } of corpus.corpus(Math.max(1, seeds >> 1), ['16:9'])) {
    if (!name.startsWith('long') && !name.startsWith('basic')) continue;
    const bare = JSON.parse(JSON.stringify(doc));
    bare.sheet.rows = bare.sheet.rows.map((r) => ({ id: r.id, src: r.src.replace(/\//g, '') }));
    out.push({ name: name + '/auto', doc: bare });
  }
  return out;
}

const DOCS = docs(8);
const CUT_KINDS = ['arrange', 'arrive', 'dwell', 'depart', 'lens'];

function isPin(d) { return d && d.from.startsWith('pin'); }

const READERS = {
  arrange: (p) => p.cuts.map((c) => c.slots.arrange.v),
  arrive: (p) => p.cuts.map((c) => c.slots.arrive.v),
  dwell: (p) => p.cuts.map((c) => c.slots.dwell.v),
  depart: (p) => p.cuts.map((c) => c.slots.depart.v),
  lens: (p) => p.cuts.map((c) => c.slots.lens.v),
  ornament: (p) => p.cuts.flatMap((c) => [0, 1, 2].map((i) => c.slots['ornament#' + i] && c.slots['ornament#' + i].v)),
  filter: (p) => p.cuts.flatMap((c) => [0, 1, 2].map((i) => c.slots['filter#' + i] && c.slots['filter#' + i].v)),
  ground: (p) => p.grounds.map((g) => g.ground.v),
  seam: (p) => p.seams.map((s) => s.slot.v),
};

for (const { name: RN, reg: SYN, moods: MOODS } of REGISTRIES) {
  const PLANS = DOCS.map(({ name, doc }) => ({ name, doc, plan: PL.run(doc, SYN, null) }));

  test(RN + ': no identical adjacent arrange/arrive unless pinned or the pool has one part', () => {
    let pairs = 0;
    for (const { name, plan } of PLANS) {
      for (let i = 1; i < plan.cuts.length; i++) {
        for (const slot of ['arrange', 'arrive']) {
          const a = plan.cuts[i - 1].slots[slot], b = plan.cuts[i].slots[slot];
          if (b.from !== 'auto' || isPin(a)) continue;
          pairs++;
          assert.notEqual(a.v, b.v, name + ' ' + plan.cuts[i].key + ' ' + slot);
        }
      }
    }
    assert.ok(pairs > 5000);
  });

  // §8.2 asks for < 3 %. Each cut weighs against both the natural and the reference pick of the cut before it
  // (planner/cast createHistory), so a repeat needs the previous cut to have moved away from both: about 0.5 %.
  test(RN + ': neighbour repetition stays under 1.5 % for every cut kind (§8.2: < 3 %)', () => {
    const kinds = CUT_KINDS.concat(['ornament#0', 'filter#0']);
    for (const slot of kinds) {
      let pairs = 0, same = 0;
      for (const { plan } of PLANS) {
        for (let i = 1; i < plan.cuts.length; i++) {
          const a = plan.cuts[i - 1].slots[slot], b = plan.cuts[i].slots[slot];
          if (!a || !b || b.from !== 'auto' || b.v === 'none') continue;
          pairs++;
          if (a.v === b.v) same++;
        }
      }
      assert.ok(pairs > 500, slot);
      assert.ok(same / pairs < 0.015, slot + ': ' + same + ' / ' + pairs);
    }
  });

  // Transitions, backgrounds and atmospheres do not repeat their neighbour's winner (planner/tracks avoidOf, SPEC §6);
  // a repeat is left only after an avoided neighbour. The hard cut and 'none' are no choice. Measured: synthetic
  // 1 / 1748 transitions, catalog 8 / 1463 (5.6 % before the rule, the catalog's two text transitions).
  test(RN + ': neighbouring transitions, backgrounds and atmospheres rarely repeat (< 1 %)', () => {
    const seams = [0, 0], grounds = [0, 0], atmos = [0, 0];
    for (const { plan } of PLANS) {
      for (let i = 2; i < plan.cuts.length; i++) {
        const a = plan.cuts[i - 1].seamIn >= 0 ? plan.seams[plan.cuts[i - 1].seamIn].slot : null;
        const b = plan.cuts[i].seamIn >= 0 ? plan.seams[plan.cuts[i].seamIn].slot : null;
        if (!a || !b || b.from !== 'auto') continue;
        seams[0]++;
        if (a.v === b.v) seams[1]++;
      }
      for (let k = 1; k < plan.grounds.length; k++) {
        const g = plan.grounds[k], f = plan.grounds[k - 1];
        if (g.ground.from === 'auto') { grounds[0]++; if (g.ground.v === f.ground.v) grounds[1]++; }
        if (g.atmos.from === 'auto' && g.atmos.v !== 'none' && f.atmos.v !== 'none') { atmos[0]++; if (g.atmos.v === f.atmos.v) atmos[1]++; }
      }
    }
    for (const [name, [pairs, same]] of Object.entries({ seams, grounds, atmos })) {
      assert.ok(pairs > (name === 'atmos' ? 50 : 500), name + ' pairs ' + pairs);
      assert.ok(same / pairs < 0.01, name + ': ' + same + ' / ' + pairs);
    }
  });

  // Parts that can be picked automatically on lyric cuts at some aspect/orientation (pool:true, no season, any role).
  const eligible = (kind, extra) => SYN.all(kind).filter((d) => d.pool !== false && !d.season && (!extra || extra(d))).map((d) => d.key);

  const usage = (read) => {
    const used = new Map();
    let total = 0;
    for (const { plan } of PLANS) {
      for (const v of read(plan)) {
        if (!v || v === 'none') continue;
        used.set(v, (used.get(v) || 0) + 1);
        total++;
      }
    }
    return { used, total };
  };

  test(RN + ': each kind uses at least 60 % of its eligible parts over the corpus', () => {
    for (const kind of Object.keys(READERS)) {
      const { used } = usage(READERS[kind]);
      const pool = eligible(kind, (d) => kind !== 'ornament' || d.scope === 'cut').filter((k) => k !== SYN.fallback('seam'));
      const hit = pool.filter((k) => used.has(k));
      assert.ok(hit.length >= 0.6 * pool.length, kind + ': ' + hit.length + ' of ' + pool.length);
    }
  });

  // Expected share of a part = the mean over the plans of its look-only weight (mood bias, theme preference, gate,
  // season, mood filter weight) divided by the kind's total; recency, echoes and fits must not concentrate choices beyond
  // 3× that.
  test(RN + ': no part takes more than 3× its expected share', () => {
    for (const kind of CUT_KINDS.concat(['ornament', 'filter'])) {
      const expected = new Map();
      for (const { plan } of PLANS) {
        const ch = CH.createChooser(SYN, { mood: SYN.get('mood', plan.look.mood.v), theme: SYN.get('theme', plan.look.theme.v),
          season: plan.look.season.v, amounts: plan.look.amounts });
        const keys = SYN.pool(kind, { role: 'lyric', season: plan.look.season.v, amounts: plan.look.amounts, scope: kind === 'ornament' ? 'cut' : undefined });
        const w = keys.map((k) => ch.statics(kind, k, kind === 'filter').product);
        const sum = w.reduce((s, x) => s + x, 0);
        keys.forEach((k, i) => expected.set(k, (expected.get(k) || 0) + w[i] / sum / PLANS.length));
      }
      const { used, total } = usage(READERS[kind]);
      for (const [key, n] of used) {
        if (!expected.has(key)) continue;                     // rule and fallback values (instantShow, 'none' …)
        assert.ok(n / total <= 3 * expected.get(key) + 0.01, kind + ' ' + key + ': ' + (n / total).toFixed(3) + ' vs ' + expected.get(key).toFixed(3));
      }
    }
  });

  const distribution = (mood) => {
    const counts = new Map();
    let total = 0;
    for (const { doc } of docs(4)) {
      const d = JSON.parse(JSON.stringify(doc));
      d.pins = Object.assign({}, d.pins, { 'work:mood': { v: mood, by: 'user' } });
      for (const c of PL.run(d, SYN, null).cuts) {
        for (const slot of CUT_KINDS) {
          const k = slot + ':' + c.slots[slot].v;
          counts.set(k, (counts.get(k) || 0) + 1);
          total++;
        }
      }
    }
    return { counts, total };
  };

  test(RN + ': moods produce different distributions', () => {
    const calm = distribution(MOODS.calm), glitch = distribution(MOODS.glitch), pop = distribution(MOODS.pop);
    const tv = (a, b) => {
      let d = 0;
      for (const k of new Set([...a.counts.keys(), ...b.counts.keys()])) {
        d += Math.abs((a.counts.get(k) || 0) / a.total - (b.counts.get(k) || 0) / b.total);
      }
      return d / 2;
    };
    assert.ok(tv(calm, glitch) > 0.15, 'calm vs glitch: ' + tv(calm, glitch).toFixed(3));
    assert.ok(tv(calm, pop) > 0.1, 'calm vs pop: ' + tv(calm, pop).toFixed(3));
    const soft = (dist) => [...dist.counts].filter(([k]) => {
      const [kind, key] = k.split(':');
      const def = SYN.get(kind, key);
      return def && (def.tags || []).includes('soft');
    }).reduce((s, [, n]) => s + n, 0) / dist.total;
    assert.ok(soft(calm) > soft(glitch), 'the calm mood favours soft parts');
  });

  test(RN + ': seasons: an off-season part is never picked automatically; seasonal parts appear in their season', () => {
    const doc = JSON.parse(JSON.stringify(corpus.project('basic').doc));
    doc.pins = { 'work:season': { v: 'summer', by: 'user' } };
    let seasonal = 0;
    for (let s = 0; s < 12; s++) {
      doc.look = Object.assign({}, doc.look, { seed: 1000 + s, moodSeed: 77 + s });
      const plan = PL.run(JSON.parse(JSON.stringify(doc)), SYN, null);
      for (const g of plan.grounds) {
        const gdef = SYN.get('ground', g.ground.v);
        assert.ok(!gdef.season || gdef.season === 'summer', g.ground.v);
        if (gdef.season === 'summer') seasonal++;
        const a = g.atmos.v === 'none' ? null : SYN.get('ornament', g.atmos.v);
        assert.ok(!a || !a.season || a.season === 'summer', g.atmos.v);
      }
      for (const c of plan.cuts) {
        for (const slot of Object.keys(c.slots)) {
          const kind = slot.split(/[#.]/)[0];
          const d = c.slots[slot];
          if (slot.includes('.') || typeof d.v !== 'string' || d.v === 'none' || !SYN.has(kind, d.v)) continue;
          const def = SYN.get(kind, d.v);
          assert.ok(!def.season || def.season === 'summer', c.key + ' ' + slot + ' ' + d.v);
        }
      }
      const theme = SYN.get('theme', plan.look.theme.v);
      assert.ok(!theme.season || theme.season === 'summer', 'theme ' + theme.key);
    }
    assert.ok(seasonal > 0, 'the summer ground is used in summer');
  });
}
