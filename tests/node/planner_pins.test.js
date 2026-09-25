/* 文字PVメーカー v2 — original work. Tests: pins, locks, filters, season, list slots, seams, timing precedence (DESIGN §3.5–§3.8, §3.4.3, §4.16.6). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const REG = MV.use('core/registry');
const S = MV.use('core/schema');
const R = MV.use('core/rng');
const PL = MV.use('planner/plan');
const F = MV.use('planner/fields');
const CA = MV.use('planner/cast');
const STUB = corpus.stubRegistry(MV);

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

const SYN = synthRegistry();

const plan = (doc, reg = SYN) => PL.run(doc, reg, null);
const clone = (x) => JSON.parse(JSON.stringify(x));
const lyricCuts = (p) => p.cuts.filter((c) => c.role === 'lyric' || c.role === 'focus');
const user = (v) => ({ v, by: 'user' });

// --- random valid pins ---------------------------------------------------------------------------------------------

const PART_SLOTS = ['arrange', 'arrive', 'dwell', 'depart', 'lens'];

// Keys that serve lyric and focus cuts in both orientations (so a pin is applicable on every lyric cut).
function servingKeys(reg, kind) {
  return reg.all(kind).filter((d) => {
    const t = reg.traits(kind, d.key);
    return t.roles.includes('lyric') && t.roles.includes('focus') && t.orient.length === 2 && d.motion !== 'own' &&
      (kind !== 'ornament' || d.scope === 'cut');
  }).map((d) => d.key);
}

// Draws pins on random scopes: { path: pin } plus the expected value per (cut, slot) by the §3.5 cascade.
function randomPins(rng, p, reg) {
  const pins = {};
  const cuts = lyricCuts(p);
  const lines = p.lines;
  const scopeOf = () => {
    const r = rng.next();
    if (r < 0.4) { const c = rng.pick(cuts); return { path: 'cut/' + c.key, sig: c.text }; }
    if (r < 0.8) return { path: 'line/' + rng.pick(lines).id };
    return { path: 'work' };
  };
  const put = (slot, v) => {
    const s = scopeOf();
    pins[s.path + ':' + slot] = s.sig !== undefined ? { v, by: rng.pick(['user', 'ai']), sig: s.sig } : { v, by: 'user' };
  };
  for (let n = rng.int(3, 12); n > 0; n--) {
    const r = rng.next();
    if (r < 0.45) {
      const kind = rng.pick(PART_SLOTS);
      put(kind, rng.pick(servingKeys(reg, kind)));
    } else if (r < 0.55) put('text.face', rng.pick(['display', 'serif', 'body']));
    else if (r < 0.62) put('text.scale', Math.round(rng.range(0.5, 2) * 1000) / 1000);
    else if (r < 0.68) put('text.style', rng.pick(REG.TEXT_STYLES));
    else if (r < 0.74) put('text.ink', rng.pick(['ink', 'accent', '#123456']));
    else if (r < 0.8) put('arrive.dur', Math.round(rng.range(0.1, 1.5) * 100) / 100);
    else if (r < 0.86) put('dwell.amount', Math.round(rng.next() * 100) / 100);
    else if (r < 0.93) put('ornament#' + rng.int(0, 2), rng.pick(servingKeys(reg, 'ornament').concat(['none'])));
    else put('lens.amount', Math.round(rng.next() * 100) / 100);
  }
  return pins;
}

function expectedAt(pins, cut, slot) {
  for (const path of ['cut/' + cut.key + ':' + slot, 'line/' + cut.line + ':' + slot, 'work:' + slot]) {
    if (pins[path]) return pins[path].v;
  }
  return undefined;
}

const SPEC = { 'text.scale': CA.SLOT_SPECS['text.scale'], 'arrive.dur': { type: 'num', min: 0.05, max: 4, step: 0.01 },
  'dwell.amount': { type: 'num', min: 0, max: 1, step: 0.01 }, 'lens.amount': { type: 'num', min: 0, max: 1, step: 0.01 } };

function valueAt(cut, slot) {
  const m = /^([a-z]+)\.(dur|amount)$/.exec(slot);
  if (m) return cut.slots[m[1]].p[m[2]];
  return cut.slots[slot] ? cut.slots[slot].v : undefined;
}

test('fuzz: random valid pins are always honoured, with the cut > line > work cascade', () => {
  let checked = 0;
  for (const name of ['basic', 'vertical', 'lrc']) {
    const doc = corpus.project(name).doc;
    doc.pins = {};
    doc.locks = {};
    const base = plan(doc);
    for (let i = 0; i < 40; i++) {
      const rng = R.stream('pins-fuzz', name, i);
      const pinned = clone(doc);
      pinned.pins = randomPins(rng, base, SYN);
      const p = plan(pinned);
      for (const cut of lyricCuts(p)) {
        for (const path of Object.keys(pinned.pins)) {
          const slot = path.slice(path.indexOf(':') + 1);
          const want = expectedAt(pinned.pins, cut, slot);
          if (want === undefined) continue;
          const where = name + '#' + i + ' ' + cut.key + ' ' + slot;
          if (slot.startsWith('ornament#')) {
            const idx = Number(slot.slice(9));
            if (want !== 'none') assert.ok(cut.slots['ornament.count'].v >= idx + 1, where + ': count raised');
            if (cut.slots['ornament.count'].v > idx) assert.equal(cut.slots[slot].v, want, where);
          } else if (SPEC[slot]) {
            assert.equal(valueAt(cut, slot), S.coerce(SPEC[slot], want), where);
          } else {
            assert.equal(valueAt(cut, slot), want, where);
          }
          checked++;
        }
      }
      assert.ok(!p.warnings.some((w) => w.code === 'pin-bad-value' || w.code === 'pin-not-applicable'), name + '#' + i);
    }
  }
  assert.ok(checked > 1000, 'checked ' + checked);
});

test('pin sources: from and by follow the scope of the winning pin', () => {
  const doc = clone(corpus.project('basic').doc);
  const p0 = plan(doc);
  const cut = lyricCuts(p0)[3];
  doc.pins = { 'work:arrive': user('stubFade'), ['line/' + cut.line + ':arrive']: { v: 'synArrive03', by: 'ai' },
    ['cut/' + cut.key + ':arrive']: { v: 'synArrive05', by: 'user', sig: cut.text } };
  const p = plan(doc);
  const c = p.cuts.find((x) => x.key === cut.key);
  assert.deepEqual([c.slots.arrive.v, c.slots.arrive.from, c.slots.arrive.by], ['synArrive05', 'pin:cut', 'user']);
  const sibling = p.cuts.find((x) => x.line === cut.line && x.key !== cut.key);
  if (sibling) assert.deepEqual([sibling.slots.arrive.v, sibling.slots.arrive.from, sibling.slots.arrive.by], ['synArrive03', 'pin:line', 'ai']);
  const other = lyricCuts(p).find((x) => x.line !== cut.line);
  assert.deepEqual([other.slots.arrive.v, other.slots.arrive.from], ['stubFade', 'pin:work']);
});

test('bad and inapplicable pins fall back to the next rank with warnings', () => {
  const doc = clone(corpus.project('lrc').doc);
  const p0 = plan(doc);
  const en = p0.cuts.find((c) => c.lang === 'en' && !c.feat.orients.includes('v'));
  const ja = p0.cuts.find((c) => c.lang === 'ja' && c.role === 'lyric');
  doc.pins = {
    ['cut/' + ja.key + ':arrange']: { v: 'noSuchPart', by: 'user', sig: ja.text },
    ['line/' + ja.line + ':arrange']: user('synArrange03'),
    ['cut/' + en.key + ':orient']: { v: 'v', by: 'user', sig: en.text },
    'work:text.scale': user('big'),
    'work:dwell': user('stubBob'),
    'work:filter.count': user(9),
  };
  const p = plan(doc);
  const codes = (code) => p.warnings.filter((w) => w.code === code).map((w) => w.path);
  assert.ok(codes('pin-bad-value').includes('cut/' + ja.key + ':arrange'));
  assert.ok(codes('pin-bad-value').includes('work:text.scale'));
  assert.ok(codes('pin-not-applicable').includes('cut/' + en.key + ':orient'));
  assert.equal(p.cuts.find((c) => c.key === ja.key).slots.arrange.v, 'synArrange03', 'the line pin takes over');
  assert.equal(p.cuts.find((c) => c.key === en.key).slots.orient.v, 'h');
  for (const c of lyricCuts(p)) {
    assert.equal(c.slots.dwell.v, 'stubBob');
    assert.equal(c.slots['filter.count'].v, 3, 'counts are clamped to 0..3');
  }
});

test('filters and seasons: auto picks respect only/deny, the season gate and none', () => {
  for (let i = 0; i < 16; i++) {
    const rng = R.stream('filters', i);
    const doc = clone(rng.pick(corpus.projects()).doc);
    doc.pins = { 'work:season': user(rng.pick(['none', 'spring', 'summer', 'autumn', 'winter', 'any'])) };
    doc.locks = {};
    doc.filters = {};
    for (const kind of ['arrange', 'arrive', 'dwell', 'depart', 'lens', 'ornament', 'filter', 'ground', 'seam']) {
      const keys = SYN.keys(kind).filter((k) => SYN.get(kind, k).pool !== false);
      if (rng.chance(0.5)) doc.filters[kind] = { only: rng.shuffle(keys).slice(0, rng.int(2, 5)), deny: null };
      else doc.filters[kind] = { only: null, deny: rng.shuffle(keys).slice(0, rng.int(1, 4)) };
    }
    const p = plan(doc);
    const season = doc.pins['work:season'].v;
    const ok = (kind, key) => {
      const f = doc.filters[kind];
      const def = SYN.get(kind, key);
      const inFilter = (!f.only || f.only.includes(key)) && (!f.deny || !f.deny.includes(key));
      const inSeason = !def.season || season === 'any' || def.season === season;
      return inFilter && inSeason;
    };
    const check = (kind, d, where) => {
      if (!d || d.v === 'none') return;
      if (d.from === 'auto') assert.ok(ok(kind, d.v), 'filter #' + i + ' ' + where + ' ' + kind + '=' + d.v);
      // a fallback is silent only on special cuts whose role no part serves; elsewhere it is reported
      if (d.from === 'fallback' && !/^(title|intro|outro|gap\/)/.test(where)) {
        assert.ok(p.warnings.some((w) => w.code === 'pool-empty' && w.cut === where), 'filter #' + i + ' ' + where + ' ' + kind);
      }
    };
    for (const c of p.cuts) {
      for (const kind of ['arrange', 'arrive', 'dwell', 'depart', 'lens']) check(kind, c.slots[kind], c.key);
      for (let j = 0; j < 3; j++) { check('ornament', c.slots['ornament#' + j], c.key); check('filter', c.slots['filter#' + j], c.key); }
    }
    for (const g of p.grounds) { check('ground', g.ground, g.key); check('ornament', g.atmos, g.key); }
    for (const s of p.seams) check('seam', s.slot, s.into);
    const theme = SYN.get('theme', p.look.theme.v);
    assert.ok(!theme.season || season === 'any' || theme.season === season, 'theme season');
  }
});

test('a one-part only filter always returns that part — never the fallback', () => {
  const ONLY = { arrange: 'stubBlock', arrive: 'stubFade', dwell: 'stubBob', depart: 'stubFadeOut', lens: 'stubDrift',
    ornament: 'stubRule', ground: 'stubTint' };
  for (const { name, doc } of corpus.corpus(2)) {
    const d = clone(doc);
    d.pins = {};
    d.locks = {};
    d.filters = Object.fromEntries(Object.entries(ONLY).map(([kind, key]) => [kind, { only: [key], deny: null }]));
    const p = plan(d, STUB);
    for (const c of lyricCuts(p)) {
      for (const kind of ['arrange', 'arrive', 'dwell', 'depart', 'lens']) {
        const s = c.slots[kind];
        if (s.from === 'rule') continue;                        // a seam that replaces the exit/entrance
        assert.equal(s.v, ONLY[kind], name + ' ' + c.key + ' ' + kind);
        assert.equal(s.from, 'auto');
      }
      for (let j = 0; j < c.slots['ornament.count'].v; j++) assert.equal(c.slots['ornament#' + j].v, 'stubRule');
    }
    for (const g of p.grounds) assert.equal(g.ground.v, 'stubTint');
    const lyricKeys = new Set(lyricCuts(p).map((c) => c.key));
    assert.ok(!p.warnings.some((w) => w.code === 'pool-empty' && lyricKeys.has(w.cut)), name);
    // special cuts whose role the only-part does not serve fall back to the kind's fallback, and say so
    for (const w of p.warnings.filter((x) => x.code === 'pool-empty')) assert.ok(!lyricKeys.has(w.cut), w.path);
  }
});

test('locks: a locked line is immune to seeds, salts, work pins and line pins', () => {
  const COMMANDS = MV.has('core/commands') ? MV.use('core/commands') : null;
  for (const name of ['basic', 'long']) {
    const doc = clone(corpus.project(name).doc);
    doc.pins = {};
    doc.locks = {};
    const p = plan(doc);
    const line = p.lines[2];
    const payload = F.lockPayload(doc, p, line.id, { registry: SYN });
    const locked = COMMANDS ? COMMANDS.reduce(doc, Object.assign({}, payload, { n: 1 }))
      : Object.assign(clone(doc), { pins: Object.assign({}, doc.pins, payload.pins), locks: { [line.id]: { n: 1 } } });
    const snapshot = (pl) => pl.cuts.filter((c) => c.line === line.id).map((c) => ({ key: c.key, slots: c.slots,
      seam: c.seamIn >= 0 ? pl.seams[c.seamIn].slot.v : 'hardCut' }));
    const before = snapshot(plan(locked));
    const strip = (list) => list.map((x) => ({ key: x.key, seam: x.seam, slots: Object.fromEntries(Object.entries(x.slots)
      .map(([k, d]) => [k, { v: d.v, p: d.p }])) }));
    assert.deepEqual(strip(before), strip(snapshot(p)), name + ': locking changes nothing');
    // Parameters a rule derives from frozen values are derived again, not frozen (DESIGN_2_1 §3.9 fields: the carry of
    // cam.shot, §4.5.7; durations scaled by motion.speed, §4.3).
    const DERIVED = { 'cam.shot': ['carry'], arrive: ['dur', 'each'], depart: ['dur', 'each'], dwell: ['speed'] };
    for (const c of plan(locked).cuts.filter((x) => x.line === line.id)) {
      for (const [slot, d] of Object.entries(c.slots)) {
        assert.equal(d.from, 'pin:cut', name + ' ' + c.key + ' ' + slot);
        assert.equal(d.by, 'lock');
        for (const k of Object.keys(d.p || {})) {
          const from = (d.pfrom || {})[k];
          if (from === 'rule') assert.ok((DERIVED[slot] || []).includes(k), c.key + ' ' + slot + '.' + k + ' derived');
          else assert.equal(from, 'pin:cut', c.key + ' ' + slot + '.' + k);
        }
      }
    }
    const variants = [
      (d) => { d.look.seed += 1; },
      (d) => { d.look.moodSeed += 7; },
      (d) => { d.salts['line/' + line.id] = 3; d.salts['cut/' + line.cuts[0] + ':arrive'] = 2; },
      (d) => { d.pins['work:arrive'] = user('synArrive04'); d.pins['work:arrange'] = user('centerAnchor'); },
      (d) => { d.pins['line/' + line.id + ':dwell'] = user('stubBob'); d.pins['work:ornament.count'] = user(0); },
      (d) => { d.pins['work:mood'] = user('synMoodGlitch'); d.pins['work:amount.ornament'] = user(1); },
    ];
    variants.forEach((change, k) => {
      const d = clone(locked);
      change(d);
      assert.deepEqual(strip(snapshot(plan(d))), strip(before), name + ' variant ' + k);
    });
  }
});

// §3.6: a lock only freezes the line's current values. Locking must not change anything else: not the other lines'
// choices (their recency reads what the locked line would choose without its lock pins), not the seams or
// backgrounds, and not the locked line itself (its roles, times and values), also where the auto cutter split it.
test('locking any line changes nothing outside it, and nothing in it', () => {
  const view = (p) => new Map(p.cuts.map((c) => [c.key, {
    role: c.role, t0: c.t0, t1: c.t1, a: c.a, b: c.b, fp: c.fp,
    slots: Object.fromEntries(Object.entries(c.slots).map(([k, d]) => [k, [d.v, d.p]])),
    seam: c.seamIn >= 0 ? [p.seams[c.seamIn].slot.v, p.seams[c.seamIn].slot.p, p.seams[c.seamIn].dur] : null,
    ground: [p.grounds[c.ground].key, p.grounds[c.ground].ground.v, p.grounds[c.ground].ground.p, p.grounds[c.ground].atmos.v],
  }]));
  let locks = 0;
  for (const reg of [STUB, SYN]) {
    for (const { name, doc } of corpus.corpus(2, ['16:9', '9:16'])) {
      for (const bare of [false, true]) {
        const d0 = clone(doc);
        d0.locks = {};
        for (const k of Object.keys(d0.pins)) if (d0.pins[k].by === 'lock') delete d0.pins[k];
        if (bare) d0.sheet.rows = d0.sheet.rows.map((r) => ({ id: r.id, src: r.src.replace(/\//g, '') }));
        const p = plan(d0, reg);
        const before = view(p);
        const step = Math.max(1, Math.floor(p.lines.length / 8));
        for (const line of p.lines.filter((l, i) => i % step === 0)) {
          const payload = F.lockPayload(d0, p, line.id, { registry: reg });
          const d1 = clone(d0);
          Object.assign(d1.pins, payload.pins);
          d1.locks[line.id] = { n: 1 };
          const q = plan(d1, reg);
          const where = name + (bare ? '/auto' : '') + ' lock ' + line.id;
          assert.deepEqual(view(q), before, where);
          assert.deepEqual(q.warnings.filter((w) => /pin-not-applicable|pin-bad-value|lock-partial/.test(w.code)), [], where);
          locks++;
        }
      }
    }
  }
  assert.ok(locks > 400, 'locks ' + locks);
});

// §3.12: cuts are in time order; §4.16.6: a seam sits between consecutive cuts. A line whose end is pinned past the
// next line's start (typed in the inspector, dragged on the timeline, a duet) shares only the time before that start
// among its pieces; its last piece keeps the rest.
test('a line end pinned past the next line keeps the cuts in time order', () => {
  const D = MV.use('core/doc');
  const ordered = (p, where) => {
    for (let i = 1; i < p.cuts.length; i++) assert.ok(p.cuts[i].t0 >= p.cuts[i - 1].t0, where + ' ' + p.cuts[i].key);
    for (const s of p.seams) {
      const A = p.cuts.find((c) => c.key === s.a), B = p.cuts.find((c) => c.key === s.b);
      assert.ok(s.at >= A.a && s.at === B.a, where + ' seam into ' + s.into);
    }
    for (let k = 1; k < p.grounds.length; k++) assert.ok(p.grounds[k].t0 >= p.grounds[k - 1].t0, where + ' ground ' + k);
  };
  const make = (rows, pins) => Object.assign(D.defaultDoc(), {
    sheet: { next: rows.length + 1, rows: rows.map((src, i) => ({ id: 'r' + (i + 1), src })) }, pins });
  for (const reg of [STUB, SYN]) {
    // '/' pieces, an auto split, and a line whose auto split would otherwise use its whole pinned span
    const cases = [
      [['夜明けの/街を走る', 'まだ遠い空', '届くまで'], 'r1', 6],
      [['夜明けの街を走る', 'まだ遠い空', '届くまで'], 'r1', 25],
      [['まだ遠い空', '夜明けの街を走る君の名前を呼ぶ声が遠くまで', '届くまで'], 'r2', 25],
      [['まだ遠い空', '夜明けの/街を/走る', '届くまで'], 'r2', 9],
    ];
    for (const [rows, id, end] of cases) {
      const p = plan(make(rows, { ['line/' + id + ':end']: user(end) }), reg);
      const where = rows.join(' ') + ' end ' + end;
      ordered(p, where);
      const line = p.lines.find((l) => l.id === id);
      const next = p.lines[p.lines.indexOf(line) + 1];
      const own = p.cuts.filter((c) => c.line === id);
      assert.equal(own[own.length - 1].t1, end, where + ': the last piece keeps the pinned end');
      for (const c of own.slice(1)) assert.ok(c.t0 < next.t0, where + ': ' + c.key + ' starts before the next line');
    }
    // the corpus with random end pins past the next start
    for (const { name, doc } of corpus.corpus(1)) {
      const p0 = plan(doc, reg);
      const rng = R.stream('end-pins', name);
      const d = clone(doc);
      for (let i = 0; i + 1 < p0.lines.length; i++) {
        if (!rng.chance(0.3)) continue;
        d.pins['line/' + p0.lines[i].id + ':end'] = { v: p0.lines[i + 1].t0 + rng.range(0.2, 8), by: 'user' };
      }
      ordered(plan(d, reg), name);
    }
  }
});

// §4.16.6: atmos is per segment "like ground": a pin on any cut or line applies to exactly the cuts it covers, splitting
// the segment around them, just as a ground pin does (§3.4.3).
test('an atmos pin on any cut or line applies to the cuts it covers; the segment splits around them', () => {
  const doc = clone(corpus.project('long').doc);
  const p0 = plan(doc);
  const run = SYN.all('ornament').filter((d) => d.scope === 'run' && !d.season).map((d) => d.key);
  const seg = p0.grounds.find((g) => g.cuts.length >= 4);
  const inner = p0.cuts.find((c) => c.key === seg.cuts[2]);
  const line = p0.lines.find((l) => l.cuts.length >= 2 && l.id !== inner.line &&
    !l.cuts.some((k) => p0.grounds.some((g) => g.cuts[0] === k)));
  const d = clone(doc);
  d.pins['cut/' + inner.key + ':atmos'] = { v: run[0], by: 'user', sig: inner.text };
  d.pins['line/' + line.id + ':atmos'] = user(run[1]);
  const p = plan(d);
  const atmosOf = (key) => { const c = p.cuts.find((x) => x.key === key); return p.grounds[c.ground].atmos; };
  assert.deepEqual([atmosOf(inner.key).v, atmosOf(inner.key).from], [run[0], 'pin:cut']);
  for (const key of line.cuts) assert.deepEqual([atmosOf(key).v, atmosOf(key).from], [run[1], 'pin:line'], key);
  for (const c of p.cuts) {
    const want = c.key === inner.key ? run[0] : c.line === line.id ? run[1] : null;
    if (want === null) assert.ok(!p.grounds[c.ground].atmos.from.startsWith('pin'), c.key + ' is not pinned');
  }
  assert.ok(p.grounds.length > p0.grounds.length, 'the segments split around the pinned cuts');
  assert.deepEqual(p.warnings.filter((w) => /pin-/.test(w.code)), []);
  const fs = F.fieldState(d, p, null, 'cut/' + inner.key + ':atmos', { registry: SYN });
  assert.deepEqual([fs.state, fs.value, fs.pinnedAt], ['pinned', run[0], 'cut']);
  // a ground pin and an atmos pin on the same cut make one segment of that cut
  const g = clone(doc);
  g.pins['cut/' + inner.key + ':atmos'] = { v: run[0], by: 'user', sig: inner.text };
  g.pins['cut/' + inner.key + ':ground'] = { v: SYN.keys('ground')[3], by: 'user', sig: inner.text };
  const pg = plan(g);
  const own = pg.grounds[pg.cuts.find((c) => c.key === inner.key).ground];
  assert.deepEqual(own.cuts, [inner.key]);
  assert.deepEqual([own.ground.v, own.atmos.v], [SYN.keys('ground')[3], run[0]]);
});

// §3.5: a bad pin is ignored with pin-bad-value. A work pin applies to every cut, but it is one pin and one warning.
test('a bad or inapplicable work pin is reported once, without a line or cut', () => {
  const doc = clone(corpus.project('long').doc);
  doc.pins = { 'work:arrive': user('retiredPartKey'), 'work:arrive.dur': user('fast'), 'work:orient': user('sideways') };
  const p = plan(doc, STUB);
  for (const path of ['work:arrive', 'work:arrive.dur', 'work:orient']) {
    const list = p.warnings.filter((w) => w.path === path);
    assert.deepEqual(list, [{ code: 'pin-bad-value', path }], path);
  }
  const cut = lyricCuts(p)[2];
  const d = clone(doc);
  d.pins = { ['line/' + cut.line + ':arrive.dur']: user('slow') };
  assert.deepEqual(plan(d, STUB).warnings.filter((w) => w.code === 'pin-bad-value'),
    [{ code: 'pin-bad-value', path: 'line/' + cut.line + ':arrive.dur', line: cut.line }], 'a line pin names its line');
});

test('lock-partial: a locked line that lost its frozen split is reported', () => {
  const doc = clone(corpus.project('vertical').doc);
  assert.ok(doc.locks.r6, 'the fixture locks r6');
  delete doc.pins['line/r6:split'];
  assert.ok(plan(doc, STUB).warnings.some((w) => w.code === 'lock-partial' && w.line === 'r6'));
  assert.ok(!plan(corpus.project('vertical').doc, STUB).warnings.some((w) => w.code === 'lock-partial'));
});

// §3.6: lock-partial reports a locked line whose cuts are no longer the frozen ones, never the user's own choices, and
// [ロックし直す] (lock.set with the line's lock pins plus lockPayload) clears it.
test('lock-partial: a split the lock cannot keep warns, a split the user pinned does not, relocking clears it', () => {
  const CMD = MV.use('core/commands');
  const partial = (d) => plan(d, STUB).warnings.some((w) => w.code === 'lock-partial' && w.line === 'r6');
  const base = clone(corpus.project('vertical').doc);
  assert.ok(!partial(base));
  const userSplit = CMD.reduce(base, { t: 'pin.set', path: 'line/r6:split', v: [0, 3], by: 'user' });
  assert.equal(userSplit.pins['line/r6:split'].by, 'user');
  assert.ok(!partial(userSplit), 'the user\'s split is not a lost lock');
  // §4.10.3: the frozen split [0, 5] cannot hold a 4-character text; the reducer trims it to [0] and the second
  // piece's lock pins (remapped to r6~4) lose their piece.
  const shorter = CMD.reduce(base, { t: 'lyrics.row', rowId: 'r6', src: '影ぼうし' });
  assert.deepEqual(shorter.pins['line/r6:split'], { v: [0], by: 'lock' });
  assert.equal(shorter.pins['cut/r6~4:lens'].by, 'lock');
  const q = plan(shorter, STUB);
  assert.ok(partial(shorter), 'a frozen piece lost its lock pins in the remap');
  assert.ok(q.warnings.some((w) => w.code === 'orphan-pin' && w.path === 'cut/r6~4:lens'), 'and they are listed as orphans');
  // The first piece deleted: the split trims to [0] and the second piece's pins fold into r6~0 (the smaller original
  // offset wins a collision), so every lock pin left still has its piece. Nothing to report.
  const folded = CMD.reduce(base, { t: 'lyrics.row', rowId: 'r6', src: '背のびをする' });
  assert.deepEqual(folded.pins['line/r6:split'], { v: [0], by: 'lock' });
  assert.ok(!partial(folded), 'a trimmed split whose lock pins all kept a piece');
  assert.deepEqual(plan(folded, STUB).warnings.filter((w) => w.line === 'r6'), []);
  // A split the user pins over the lock leaves lock pins without a piece: orphans, but the user's choice, not a loss.
  const userNone = CMD.reduce(base, { t: 'pin.set', path: 'line/r6:split', v: 'none', by: 'user' });
  assert.ok(plan(userNone, STUB).warnings.some((w) => w.code === 'orphan-pin' && w.path === 'cut/r6~5:lens'));
  assert.ok(!partial(userNone), 'the user\'s own split');
  // User pins that lost their piece on a locked line are not lock pins.
  const userOrphan = clone(base);
  userOrphan.pins['cut/r6~8:dwell'] = { v: 'stubBob', by: 'user', sig: 'をする' };
  assert.ok(plan(userOrphan, STUB).warnings.some((w) => w.code === 'orphan-pin' && w.path === 'cut/r6~8:dwell'));
  assert.ok(!partial(userOrphan), 'lost user pins are not a partial lock');
  // Two lock pin keys competing for one piece: the one further from the piece's start is shadowed, a lost frozen value.
  const shadow = clone(base);
  for (const slot of ['arrange', 'lens', 'orient']) delete shadow.pins['cut/r6~5:' + slot];
  shadow.pins['cut/r6~6:lens'] = { v: 'fixedFrame', by: 'lock', sig: 'のびをする' };
  shadow.pins['cut/r6~7:lens'] = { v: 'stubDrift', by: 'lock', sig: 'びをする' };
  const qs = plan(shadow, STUB);
  assert.ok(qs.warnings.some((w) => w.code === 'shadowed-pin' && w.path === 'cut/r6~7:lens'));
  assert.equal(qs.cuts.find((c) => c.key === 'r6~5').pinKey, 'r6~6', 'the piece keeps the closer key');
  assert.ok(partial(shadow), 'a shadowed lock pin');
  const p0 = plan(base, STUB);
  const r6 = p0.lines.find((l) => l.id === 'r6');
  const squeezed = CMD.reduce(base, { t: 'time.tap', marks: [{ lineId: 'r6', start: r6.t0, end: r6.t0 + 0.5 }] });
  const p = plan(squeezed, STUB);
  assert.ok(p.warnings.some((w) => w.code === 'piece-merged' && w.line === 'r6'));
  assert.ok(partial(squeezed), 'a frozen piece too short to keep');
  // [ロックし直す]: the lock pins that still have a piece stay, the rest of the line is frozen as it is now.
  const held = new Set(p.cuts.filter((c) => c.line === 'r6').map((c) => 'cut/' + (c.pinKey || c.key)));
  const lockPins = (d, keep) => Object.fromEntries(Object.entries(d.pins).filter(([k, v]) => v.by === 'lock' && keep(k)));
  const own = lockPins(squeezed, (k) => k.startsWith('line/r6:') || held.has(k.slice(0, k.indexOf(':'))));
  const payload = F.lockPayload(squeezed, p, 'r6', { registry: STUB });
  const relocked = CMD.reduce(squeezed, { t: 'lock.set', lineId: 'r6', pins: Object.assign({}, own, payload.pins), n: 2 });
  assert.ok(!partial(relocked), 'relocking freezes the line as it is now');
  // Relocking with the orphaned lock pins kept: they are still lost values until they are removed (迷子の固定 [削除]).
  const all = lockPins(squeezed, (k) => k.startsWith('line/r6:') || k.startsWith('cut/r6~'));
  const keptAll = CMD.reduce(squeezed, { t: 'lock.set', lineId: 'r6', pins: Object.assign({}, all, payload.pins), n: 2 });
  const orphans = plan(keptAll, STUB).warnings.filter((w) => w.code === 'orphan-pin' && w.line === 'r6').map((w) => w.path);
  assert.ok(orphans.length > 0 && partial(keptAll));
  const cleaned = orphans.reduce((d, path) => CMD.reduce(d, { t: 'pin.clear', path }), keptAll);
  assert.ok(!partial(cleaned), 'removing the lost lock pins ends the warning');
  const noSplit = clone(base);
  delete noSplit.pins['line/r6:split'];
  assert.ok(partial(noSplit), 'the frozen split is gone');
  const bad = clone(base);
  bad.pins['line/r6:split'] = { v: [0, 99], by: 'lock' };
  assert.ok(partial(bad), 'a split that does not fit the text');
});

test('list slots: a part pinned on slot i makes the slot exist; none hides it without changing the count', () => {
  const doc = clone(corpus.project('basic').doc);
  const p0 = plan(doc, STUB);
  const line = p0.lines[1];
  doc.pins = { ['line/' + line.id + ':ornament#2']: user('stubRule'), ['line/' + line.id + ':ornament#2@stubRule.gap']: user(44) };
  const p = plan(doc, STUB);
  for (const c of p.cuts.filter((x) => x.line === line.id)) {
    assert.ok(c.slots['ornament.count'].v >= 3, c.key);
    assert.equal(c.slots['ornament#2'].v, 'stubRule');
    assert.equal(c.slots['ornament#2'].p.gap, 44);
    assert.equal(c.slots['ornament#2'].pfrom.gap, 'pin:line');
  }
  const cut = lyricCuts(p0).find((c) => c.slots['ornament.count'].v >= 1);
  const d2 = clone(corpus.project('basic').doc);
  d2.pins = { ['cut/' + cut.key + ':ornament#0']: { v: 'none', by: 'user', sig: cut.text } };
  const c2 = plan(d2, STUB).cuts.find((x) => x.key === cut.key);
  assert.equal(c2.slots['ornament#0'].v, 'none');
  assert.equal(c2.slots['ornament.count'].v, cut.slots['ornament.count'].v, 'none keeps the count');
  assert.equal(c2.slots['ornament#0'].p, undefined, 'a hidden slot has no params');
});

test('seams: owned by tracks, pinned on the receiving cut at any scope, with the replace rules', () => {
  const doc = clone(corpus.project('basic').doc);
  const p0 = plan(doc);
  const B = lyricCuts(p0)[4];
  const iB = p0.cuts.indexOf(B);
  const A = p0.cuts[iB - 1];
  const world = SYN.all('seam').find((d) => d.scope === 'world' && d.replaces && d.replaces.depart).key;
  const intoArrive = SYN.all('seam').find((d) => d.replaces && d.replaces.arrive).key;
  doc.pins = { ['cut/' + B.key + ':seam']: { v: world, by: 'user', sig: B.text } };
  let p = plan(doc);
  let s = p.seams.find((x) => x.into === B.key);
  assert.ok(s, 'the pinned seam is listed');
  assert.deepEqual([s.slot.v, s.slot.from, s.a, s.b, s.scope], [world, 'pin:cut', A.key, B.key, 'world']);
  assert.equal(p.cuts[iB].seamIn, p.seams.indexOf(s));
  assert.equal(p.cuts[iB - 1].slots.depart.v, SYN.fallback('depart'), 'the exit it replaces becomes the fallback');
  assert.equal(p.cuts[iB - 1].slots.depart.from, 'rule');
  doc.pins['cut/' + A.key + ':depart'] = { v: 'stubFadeOut', by: 'user', sig: A.text };
  p = plan(doc);
  assert.equal(p.cuts[iB - 1].slots.depart.v, 'stubFadeOut', 'a pinned exit is not replaced');
  // line scope: every cut of the line receives it (the first one from the line before)
  const d2 = clone(corpus.project('basic').doc);
  d2.pins = { ['line/' + B.line + ':seam']: user(intoArrive) };
  p = plan(d2);
  for (const c of p.cuts.filter((x) => x.line === B.line)) {
    const into = p.seams.find((x) => x.into === c.key);
    assert.ok(into && into.slot.v === intoArrive && into.slot.from === 'pin:line', c.key);
    assert.equal(c.slots.arrive.v, SYN.fallback('arrive'), c.key + ': its entrance is replaced');
  }
  // a pinned hard cut: no seam entry
  const d3 = clone(corpus.project('basic').doc);
  d3.pins = { 'work:seam': user(SYN.fallback('seam')) };
  p = plan(d3);
  assert.equal(p.seams.length, 0);
  assert.ok(p.cuts.every((c) => c.seamIn === -1));
});

test('timing precedence: start pin > LRC stamp > auto; deleting the pin shows the stamp again', () => {
  const doc = clone(corpus.project('lrc').doc);
  const p0 = plan(doc, STUB);
  const stamped = p0.lines.find((l) => l.by.start === 'lrc');
  const auto = p0.lines.find((l) => l.by.start === 'auto');
  assert.ok(stamped && auto);
  const row = doc.sheet.rows.find((r) => r.id === stamped.row);
  assert.ok(row.src.startsWith('[00:'), 'the stamp is in the text');
  doc.pins['line/' + stamped.id + ':start'] = { v: stamped.t0 + 0.5, by: 'tap' };
  const p1 = plan(doc, STUB);
  const l1 = p1.lines.find((l) => l.id === stamped.id);
  assert.equal(l1.t0, stamped.t0 + 0.5);
  assert.equal(l1.by.start, 'pin');
  assert.equal(p1.cuts.find((c) => c.key === stamped.cuts[0]).t0, l1.t0, 'the line\'s first cut starts with it');
  delete doc.pins['line/' + stamped.id + ':start'];
  const p2 = plan(doc, STUB);
  assert.equal(p2.lines.find((l) => l.id === stamped.id).t0, stamped.t0);
  // an inner cut boundary pin moves only that boundary
  const two = p0.lines.find((l) => l.cuts.length >= 2);
  const c1 = p0.cuts.find((c) => c.key === two.cuts[1]);
  const moved = c1.t0 + 0.2;
  doc.pins['cut/' + c1.key + ':t0'] = { v: moved, by: 'user', sig: c1.text };
  const p3 = plan(doc, STUB);
  assert.equal(p3.cuts.find((c) => c.key === c1.key).t0, moved);
  assert.equal(p3.cuts.find((c) => c.key === two.cuts[0]).t0, p0.cuts.find((c) => c.key === two.cuts[0]).t0);
});

// The solver's context (§4.11) comes from the work slots: the tempo, the beat offset and meter of the grid it snaps
// to, the reading rate, and the 2 s a pinned title card keeps free. The inspector shows the reading rate in effect.
test('timing context: tempo, beat grid, reading rate and the title card reach the solver and the fields', () => {
  const D = MV.use('core/doc');
  const rows = ['[ti:試し]', 'はじまりの朝に', 'ひかりの粒が', 'まどをたたいて', 'きみをよぶ'].map((src, i) => ({ id: 'r' + (i + 1), src }));
  const doc = Object.assign(D.defaultDoc(), { sheet: { next: 6, rows } });
  const rate = (d) => F.fieldState(d, plan(d, STUB), null, 'work:readRate', { registry: STUB });
  let fs = rate(doc);
  assert.deepEqual([fs.value, fs.state], [7, 'auto'], 'no tempo: 7 morae per second');
  const tempo = Object.assign(clone(doc), { pins: { 'work:bpm': user(100), 'work:beatOffset': user(0.13) },
    timing: Object.assign({}, doc.timing, { snap: 'beat' }) });
  fs = rate(tempo);
  assert.deepEqual([fs.value, fs.state], [5, 'auto'], 'a tempo: bpm / 20');
  const p = plan(tempo, STUB);
  assert.deepEqual(p.beats, { bpm: 100, offset: 0.13, meter: 4 });
  // snap 'beat' moves an automatic start onto the grid when it is within min(0.12, period / 4) of a beat (§4.11 rule 6)
  const off = (t, offset) => { const k = (t - offset) / 0.6; return Math.abs(k - Math.round(k)) * 0.6; };
  for (const l of p.lines) assert.ok(off(l.t0, 0.13) < 1e-6 || off(l.t0, 0.13) > 0.12 - 1e-9, 'start ' + l.t0);
  assert.ok(p.lines.some((l) => off(l.t0, 0.13) < 1e-6 && off(l.t0, 0) > 1e-3), 'on the grid of the pinned beat offset');
  const fast = Object.assign(clone(tempo), { pins: Object.assign({}, tempo.pins, { 'work:readRate': user(12) }) });
  fs = rate(fast);
  assert.deepEqual([fs.value, fs.state, fs.pinnedAt], [12, 'pinned', 'work']);
  assert.ok(plan(fast, STUB).lines[1].t0 - plan(fast, STUB).lines[0].t0 < p.lines[1].t0 - p.lines[0].t0, 'reading faster');
  const E = MV.use('planner/explain');
  assert.deepEqual(E.explain(tempo, p, 'work:readRate', { registry: STUB }).why, [{ code: 'rule', params: { rule: 'bpm' } }]);
  // the song's meter sets the bars snap 'bar' moves to (§4.11 rule 6): 1.5 s in 3/4 at 120 BPM, 2 s in 4/4. A reading
  // rate is chosen so that one automatic start lies within 0.12 s of a 3/4 bar and not of a 4/4 bar.
  const song = (meter, snap, readRate) => Object.assign(clone(doc), { pins: { 'work:readRate': user(readRate) },
    timing: Object.assign({}, doc.timing, { snap }),
    song: { name: 's.wav', sha1: 'a'.repeat(40), seconds: 60, bpm: 120, offset: 0, meter, bpmConfidence: 0.9, digest: null, info: null } });
  const near = (t, bar) => Math.abs(t - Math.round(t / bar) * bar);
  let found = null;
  for (let r = 50; r <= 120 && !found; r++) {
    const raw = plan(song(3, 'off', r / 10), STUB);
    const k = raw.lines.findIndex((l) => l.by.start === 'auto' && near(l.t0, 1.5) > 0.01 && near(l.t0, 1.5) < 0.1 &&
      near(l.t0, 2) > 0.15);
    if (k >= 0) found = { rate: r / 10, k, t: raw.lines[k].t0 };
  }
  assert.ok(found, 'a reading rate with a start near a 3/4 bar only');
  const three = plan(song(3, 'bar', found.rate), STUB);
  assert.deepEqual(three.beats, { bpm: 120, offset: 0, meter: 3 });
  assert.equal(three.lines[found.k].t0, Math.round(found.t / 1.5) * 1.5, 'snapped to the 3/4 bar');
  const four = plan(song(4, 'bar', found.rate), STUB);
  assert.equal(four.beats.meter, 4);
  assert.equal(four.lines[found.k].t0, found.t, 'no 4/4 bar within reach');
  // a pinned title card keeps 2 s free only when there is a title to show
  const card = Object.assign(clone(doc), { pins: { 'work:titleCard': user(true) } });
  const withTitle = plan(card, STUB);
  assert.ok(withTitle.lines[0].t0 >= 2 && withTitle.cuts[0].key === 'title');
  card.sheet.rows = card.sheet.rows.filter((r) => r.id !== 'r1');
  const noTitle = plan(card, STUB);
  assert.equal(noTitle.lines[0].t0, doc.timing.leadIn, 'no title, nothing to keep room for');
  assert.ok(noTitle.warnings.some((w) => w.code === 'title-skipped' && w.path === 'work:titleCard'));
});

test('pinned parts win over filters and seasons, with warnings', () => {
  const doc = clone(corpus.project('basic').doc);
  const seasonal = SYN.all('ground').find((d) => d.season === 'spring').key;
  doc.filters = { arrive: { only: ['stubFade'], deny: null } };
  doc.pins = { 'work:arrive': user('synArrive04'), 'work:season': user('winter'), 'work:ground': user(seasonal) };
  const p = plan(doc);
  assert.ok(lyricCuts(p).every((c) => c.slots.arrive.v === 'synArrive04' || c.slots.arrive.from === 'rule'));
  assert.ok(p.grounds.every((g) => g.ground.v === seasonal));
  assert.ok(p.warnings.some((w) => w.code === 'pin-filtered' && w.path === 'work:arrive'));
  assert.ok(p.warnings.some((w) => w.code === 'pin-off-season' && w.path === 'work:ground'));
});

test('special cuts: title card, intro, interlude and outro follow the rules of §4.16.5', () => {
  const doc = clone(corpus.project('basic').doc);
  doc.pins = { 'work:titleCard': user(true) };
  let p = plan(doc, STUB);
  const first = p.lines[0];
  if (first.t0 >= 1.5) assert.equal(p.cuts[0].key, 'title');
  else if (first.t0 - 0.2 >= 0.8) assert.equal(p.cuts[0].t1, Math.round((first.t0 - 0.2) * 1e6) / 1e6);
  doc.timing = Object.assign({}, doc.timing, { leadIn: 4 });
  p = plan(doc, STUB);
  assert.equal(p.cuts[0].key, 'title');
  assert.equal(p.cuts[0].text, '紙ひこうきの朝');
  assert.equal(p.cuts[0].note, 'サンプル楽団', 'the artist rides along as the note');
  delete doc.pins['work:titleCard'];
  doc.pins['work:titleCard'] = user(false);
  p = plan(doc, STUB);
  assert.equal(p.cuts[0].key, 'intro', 'no title card and ≥ 3 s before the first line → intro');
  assert.equal(p.cuts[0].role, 'interlude');
  assert.equal(p.cuts[p.cuts.length - 1].key, 'outro', '≥ 3 s after the last line → outro');
  assert.equal(p.cuts[p.cuts.length - 1].t1, p.duration);
  const chorus = p.lines.find((l) => l.row === 'ra');
  const prev = p.lines[p.lines.indexOf(chorus) - 1];
  doc.pins['line/' + prev.id + ':start'] = { v: prev.t0, by: 'tap' };
  doc.pins['line/' + prev.id + ':end'] = { v: prev.t0 + 3, by: 'tap' };
  doc.pins['line/' + chorus.id + ':start'] = { v: prev.t0 + 12, by: 'tap' };
  p = plan(doc, STUB);
  const gap = p.cuts.find((c) => c.key === 'gap/' + prev.id);
  assert.ok(gap, 'a gap longer than max(2.8 s, 2 bars) gets an interlude cut');
  assert.equal(gap.role, 'interlude');
  assert.equal(gap.note, 'サビ', 'it carries the next section heading');
  assert.equal(gap.t1, p.lines.find((l) => l.id === chorus.id).t0);
  const tight = clone(corpus.project('basic').doc);
  tight.timing = Object.assign({}, tight.timing, { leadIn: 0.5 });
  tight.pins = { 'work:titleCard': user(true), ['line/' + p.lines[0].id + ':start']: { v: 0.6, by: 'tap' } };
  assert.ok(plan(tight, STUB).warnings.some((w) => w.code === 'title-skipped'));
});

// SPEC §6: "a title card when a title is set". Automatic lines start at timing.leadIn (1 s), below the 1.5 s the card
// needs, so without a reservation a pasted sheet with [ti:] never got one (spec-1). Automatic timing keeps 2 s for
// the card (planner/plan titleCardTime); anchored lines (LRC stamps, start pins) never move for an automatic card.
test('a title is set: automatic timing makes room for a title card; anchors keep their times', () => {
  const C = MV.use('core/commands');
  const D = MV.use('core/doc');
  const CAT = MV.use('parts/catalog').defaultRegistry();
  const sheet = (text) => C.reduce(D.defaultDoc(), { t: 'lyrics.set', text });
  const doc = sheet('[ti:朝の窓]\n[ar:テスト]\n窓をあけて/光を入れる\nまだ眠い街に');
  for (const reg of [STUB, CAT]) {
    const p = plan(doc, reg);
    assert.deepEqual([p.cuts[0].key, p.cuts[0].t0, p.cuts[0].t1, p.cuts[0].text], ['title', 0, 2, '朝の窓']);
    assert.equal(p.lines[0].t0, 2, 'the first line starts after the card');
    assert.equal(p.cuts[1].t0, 2);
    assert.ok(!p.warnings.some((w) => w.code === 'title-skipped' || w.code === 'time-compressed'));
    const withSong = Object.assign({}, doc, { song: { seconds: 60, bpm: 120, offset: 0, meter: 4 } });
    assert.equal(plan(withSong, reg).cuts[0].key, 'title', 'with a song too');
  }
  const off = C.reduce(doc, { t: 'pin.set', path: 'work:titleCard', v: false, by: 'user' });
  const pOff = plan(off, STUB);
  assert.ok(!pOff.cuts.some((c) => c.key === 'title'), 'pinned off: no card');
  assert.equal(pOff.lines[0].t0, 1, 'and no room kept');
  const on = plan(C.reduce(doc, { t: 'pin.set', path: 'work:titleCard', v: true, by: 'user' }), STUB);
  assert.deepEqual([on.cuts[0].key, on.lines[0].t0], ['title', 2]);
  // no title: nothing to keep room for
  assert.equal(plan(sheet('窓をあけて/光を入れる\nまだ眠い街に'), STUB).lines[0].t0, 1);
  // LRC: the first line at 1.0 keeps its time; too little room for the card, and no warning about it
  const lrc = plan(sheet('[ti:朝の窓]\n[00:01.00]窓をあけて\n[00:04.00]まだ眠い街に'), STUB);
  assert.equal(lrc.lines[0].t0, 1);
  assert.ok(!lrc.cuts.some((c) => c.key === 'title'));
  assert.ok(!lrc.warnings.some((w) => w.code === 'title-skipped' || w.code === 'time-compressed'));
  // a start pin later on: the automatic lines before it are back-filled as without a title, never squeezed for a card
  const pinned = sheet('[ti:朝の窓]\n窓をあけて\n光を入れる\nまだ眠い街に');
  const free = plan(pinned, STUB);
  const at = free.lines[2].t0 - 0.4;
  const anchored = C.reduce(pinned, { t: 'pin.set', path: 'line/' + free.lines[2].id + ':start', v: at, by: 'tap' });
  const pa = plan(anchored, STUB);
  const untitled = plan(C.reduce(anchored, { t: 'meta.set', title: null }), STUB);
  assert.deepEqual(pa.lines.map((l) => l.t0), untitled.lines.map((l) => l.t0));
  assert.ok(!pa.warnings.some((w) => w.code === 'time-compressed'));
});

// §4: pure functions never throw for bad user data. Random sheets (marks, stamps, empty and comment rows, scripts),
// odd pins, salts and filters: plan, explain and fieldState must all answer.
test('fuzz: random documents with odd pins never make the planner throw', () => {
  const D = MV.use('core/doc');
  const E = MV.use('planner/explain');
  const WORDS = ['夜明けの', '街を', '走る', '*君*', 'Hello', 'world', '/', ' ', '!', '|note', '雪', '桜', '「かぎ」', 'ー', 'Fly',
    'high', '12', '😀', '한국어', '中文字'];
  const ODD = [['work:arrive', 'nope'], ['work:text.scale', 'x'], ['work:ornament.count', 7], ['work:season', 'monsoon'],
    ['work:mood', 3], ['work:ground', 'synGround01'], ['work:seam', 'synSeam03'], ['work:titleCard', true], ['work:bpm', null],
    ['work:length', -3], ['work:filter#1', 'synFilter04'], ['line/r2:split', [0, 99]], ['line/r3:start', 'soon']];
  for (let i = 0; i < 120; i++) {
    const rng = R.stream('robust', i);
    const doc = D.defaultDoc();
    const rows = rng.chance(0.5) ? [{ id: 'r1', src: '[ti:題名' + i + ']' }] : [];
    const n = rng.int(0, 12);
    for (let j = 0; j < n; j++) {
      let src = rng.chance(0.2) ? '[0' + rng.int(0, 3) + ':' + String(rng.int(0, 59)).padStart(2, '0') + '.00]' : '';
      for (let k = rng.int(0, 6); k > 0; k--) src += rng.pick(WORDS);
      if (rng.chance(0.1)) src = '';
      if (rng.chance(0.05)) src = '# サビ';
      rows.push({ id: 'r' + (j + 2).toString(36), src });
    }
    doc.sheet = { next: n + 3, rows };
    doc.look = { seed: rng.int(0, 1e9), moodSeed: rng.int(0, 1e9), aspect: rng.pick(D.ASPECTS), backdrop: rng.pick(D.BACKDROPS) };
    if (rng.chance(0.3)) doc.song = Object.assign({}, corpus.project('basic').doc.song, { seconds: rng.range(5, 90) });
    for (const [path, v] of ODD) if (rng.chance(0.2)) doc.pins[path] = { v, by: 'user' };
    if (rng.chance(0.3)) doc.salts = { 'line/r2': 2, 'cut/r3~0': 1 };
    if (rng.chance(0.3)) doc.filters = { arrange: { only: ['synArrange02'], deny: null }, seam: { only: null, deny: ['hardCut'] } };
    const p = plan(doc);
    assert.ok(p.duration > 0 && p.grounds.length >= 1, 'doc #' + i);
    for (let q = 0; q < 4 && p.cuts.length; q++) {
      const c = rng.pick(p.cuts);
      const slot = rng.pick(['arrange', 'arrive', 'seam', 'ground', 'atmos', 'orient', 'text.scale', 'ornament#0', 'filter.count',
        'arrive.dur', 'el.text.nudge', 't0']);
      E.explain(doc, p, 'cut/' + c.key + ':' + slot, { registry: SYN });
      F.fieldState(doc, p, null, 'cut/' + c.key + ':' + slot, { registry: SYN });
      if (c.line) F.lockPayload(doc, p, c.line, { registry: SYN });
    }
    for (const path of ['work:mood', 'work:theme', 'work:season', 'work:texture', 'work:bpm', 'work:titleCard']) {
      E.explain(doc, p, path, { registry: SYN });
      F.fieldState(doc, p, null, path, { registry: SYN });
    }
  }
});

// planner/params keeps the coercion answers of stepped numbers per spec and step index (a parameter auto's costly
// part); they must be core/schema.coerce's answers for every value, in any call order.
test('stepped parameters: the kept coercion answers are core/schema.coerce\'s', () => {
  const PA = MV.use('planner/params');
  const rng = R.stream('stepped', 1);
  const STEPS = [0.1, 0.05, 0.01, 0.25, 1, 2.5, 1 / 3, 0.001, 5, 0.3];
  const ODD = [NaN, Infinity, -Infinity, -0, 0, '0.5', null, undefined, 1e300, -1e300, 5e-324];
  for (let i = 0; i < 60; i++) {
    const spec = { type: 'num', step: rng.pick(STEPS), auto: { range: [0, 1] } };
    if (rng.chance(0.7)) spec.min = rng.pick([0, -1, 0.1, -0.35, 2, 0.05, -0]);
    if (rng.chance(0.7)) spec.max = (spec.min === undefined ? 0 : spec.min) + rng.range(0.001, 12);
    const lo = (spec.min === undefined ? -3 : spec.min) - 1, hi = (spec.max === undefined ? 9 : spec.max) + 1;
    for (let j = 0; j < 400; j++) {
      let v = rng.range(lo, hi);
      if (rng.chance(0.2)) v = (Math.round(v / spec.step) + rng.pick([0.5, -0.5, 0.4999999999, 0.5000000001])) * spec.step;
      if (rng.chance(0.05)) v = rng.pick(ODD);
      assert.ok(Object.is(PA.coerceStepped(spec, v), S.coerce(spec, v)), JSON.stringify(spec) + ' ' + String(v));
    }
  }
});

// --- v2.1 slots (DESIGN_2_1 §2.3, §3.9) --------------------------------------------------------------------------

// Random values for the v2.1 cut slots and the curve params, some of them given raw (unsorted keys, numbers to clamp):
// the planner coerces them with core/schema, like the inspector and the AI.
const SHOT_ = MV.use('core/shot');
const CAM_SPECS = MV.use('planner/camera').SLOT_SPECS;
function newSlotValue(rng, slot) {
  const curve = () => rng.pick(['softEnds', 'hushRushHush', 'dashStop', 'expoOut', 'linear', { bz: [0.7, 0, 0.2, 1] },
    { ramp: { peak: 6, ends: 'both', edge: 0.1 } }, { sp: [[0, 1], [0.5, 3], [1, 0.5]] }]);
  switch (slot) {
    case 'motion.speed': return rng.pick([0.25, 0.5, 0.6, 1.5, 2, 4]);
    case 'cam.shot': return rng.pick(SHOT_.SHOT_KEYS.concat(['none', { follow: 0.3, keys: [{ aim: 'block', at: 'a', fill: 0.5 },
      { at: 'word:1', aim: 'word:1', curve: 'holdThenDash', fill: 0.9, ox: 0.1 }] }]));
    case 'cam.zoom': return rng.pick([0.5, 0.8, 1.2, 1.75, 2]);
    case 'cam.follow': return rng.pick([0, 0.2, 0.55, 1]);
    case 'rig': return rng.pick(SHOT_.RIG_KEYS.concat(['none', { keys: [{ u: 0, zoom: 1.02 }, { u: 1, zoom: 1.1, roll: 2 }] }]));
    default: return curve();                                  // cam.curve, rig.curve, arrive.ease/flow, dwell.curve, lens.curve
  }
}
const NEW_SLOTS = ['motion.speed', 'cam.shot', 'cam.zoom', 'cam.curve', 'cam.follow', 'rig', 'rig.curve', 'arrive.ease',
  'arrive.flow', 'depart.ease', 'dwell.curve', 'lens.curve', 'seam.curve'];
const CURVE_SPEC = { type: 'curve' };
function specOf(slot) { return CAM_SPECS[slot] || CURVE_SPEC; }

test('fuzz: random pins of the v2.1 slots and curve parameters are always honoured, with the cut > line > work cascade', () => {
  let checked = 0;
  for (const name of ['basic', 'vertical', 'lrc']) {
    const doc = corpus.project(name).doc;
    doc.pins = {};
    doc.locks = {};
    const base = plan(doc);
    for (let i = 0; i < 30; i++) {
      const rng = R.stream('pins-fuzz-v21', name, i);
      const pinned = clone(doc);
      const cuts = lyricCuts(base);
      for (let n = rng.int(3, 10); n > 0; n--) {
        const slot = rng.pick(NEW_SLOTS);
        const r = rng.next();
        const c = rng.pick(cuts);
        const where = r < 0.4 ? 'cut/' + c.key : r < 0.8 ? 'line/' + rng.pick(base.lines).id : 'work';
        pinned.pins[where + ':' + slot] = Object.assign({ v: newSlotValue(rng, slot), by: rng.pick(['user', 'ai']) },
          where.startsWith('cut/') ? { sig: c.text } : {});
      }
      const p = plan(pinned);
      assert.ok(!p.warnings.some((w) => w.code === 'pin-bad-value' || w.code === 'pin-not-applicable'), name + '#' + i);
      for (const cut of lyricCuts(p)) {
        const run = p.rigs[cut.rig];
        const first = p.cuts.find((x) => x.key === run.cuts[0]);
        for (const slot of NEW_SLOTS) {
          const at = slot === 'rig.curve' ? first : cut;           // rig.curve is read at the run's first cut
          const want = expectedAt(pinned.pins, at, slot);
          if (want === undefined) continue;
          const where = name + '#' + i + ' ' + cut.key + ' ' + slot;
          const coerced = S.coerce(specOf(slot), want);
          let got;
          if (slot === 'rig') got = run.rig.v;
          else if (slot === 'rig.curve') got = run.curve.v;
          else if (CAM_SPECS[slot]) got = cut.slots[slot].v;
          else if (slot === 'seam.curve') {
            if (cut.seamIn < 0) continue;                           // a hard cut has no parameters
            got = p.seams[cut.seamIn].slot.p.curve;
          } else {
            const [kind, param] = slot.split('.');
            got = cut.slots[kind].p[param];
          }
          assert.deepEqual(got, coerced, where);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 1000, 'checked ' + checked);
});

test('locks freeze motion.speed and the cam.* slots of a line, not its rig; derived parameters stay derived', () => {
  const doc = clone(corpus.project('basic').doc);
  doc.pins = { 'work:motion.speed': { v: 0.5, by: 'ai' } };
  doc.locks = {};
  const p = plan(doc);
  const line = p.lines[3];
  const payload = F.lockPayload(doc, p, line.id, { registry: SYN });
  for (const key of line.cuts) {
    const cut = p.cuts.find((c) => c.key === key);
    for (const s of ['cam.shot', 'cam.zoom', 'cam.curve', 'cam.follow']) {
      assert.deepEqual(payload.pins['cut/' + key + ':' + s], { v: cut.slots[s].v, by: 'lock', sig: cut.text }, key + ' ' + s);
    }
    assert.equal(payload.pins['cut/' + key + ':motion.speed'], undefined, 'a speed that is already a pin is not frozen');
    for (const path of Object.keys(payload.pins)) assert.ok(!/:(rig|rig\.curve|cam\.shot\.carry)$/.test(path), path);
    for (const s of ['arrive', 'depart']) {
      for (const n of ['dur', 'each']) assert.equal(payload.pins['cut/' + key + ':' + s + '.' + n], undefined, key + ' ' + s + '.' + n + ' scaled, not frozen');
    }
  }
  const unpinned = clone(doc);
  unpinned.pins = {};
  const pu = plan(unpinned);
  const pay = F.lockPayload(unpinned, pu, line.id, { registry: SYN });
  for (const key of line.cuts) assert.deepEqual(pay.pins['cut/' + key + ':motion.speed'], { v: 1, by: 'lock', sig: pu.cuts.find((c) => c.key === key).text });
  const locked = clone(doc);
  Object.assign(locked.pins, payload.pins);
  locked.locks = { [line.id]: { n: 1 } };
  const q = plan(locked);
  for (const key of line.cuts) {
    const a = p.cuts.find((c) => c.key === key), b = q.cuts.find((c) => c.key === key);
    for (const s of Object.keys(a.slots)) assert.deepEqual([b.slots[s].v, b.slots[s].p], [a.slots[s].v, a.slots[s].p], key + ' ' + s);
  }
  // The rig is not frozen: a work rig pin reaches the locked line's run.
  locked.pins['work:rig'] = { v: 'leanTilt', by: 'user' };
  const r = plan(locked);
  for (const key of line.cuts) assert.equal(r.rigs[r.cuts.find((c) => c.key === key).rig].rig.v, 'leanTilt');
});
