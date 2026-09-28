/* 文字PVメーカー v2 — original work. Test documents for the glyph morph and the weight animation (DESIGN_2_2 §4): invented lines that share letters. */
'use strict';
const corpus = require('./corpus.js');

// The basic fixture (its song, timing and look) with these lyric rows (ids r1, r2, … in base 36), a document marker
// (gen: 1 = a work made by core/doc newDoc(); absent = an older work) and pins.
function docWith(rows, opts) {
  const o = opts || {};
  const doc = corpus.project('basic').doc;
  doc.sheet = { next: rows.length + 1, rows: rows.map((src, i) => ({ id: rowId(i), src })) };
  doc.look = Object.assign({}, doc.look);
  if (o.gen !== undefined) doc.look.gen = o.gen; else delete doc.look.gen;
  if (o.seed !== undefined) doc.look.seed = o.seed;
  doc.pins = Object.assign({}, o.pins || {});
  return doc;
}

function rowId(i) { return 'r' + (i + 1).toString(36); }

// Lines that share letters, one background for the whole video (a work ground pin; `ground` is its key), so every
// boundary between two lyric lines is a text boundary: 青い空へ → 青い海へ (青い travels, 空 melts into 海, へ travels),
// 夜の町を歩く → 朝の町を歩く, a line cut in two that shares 青い across its own cut boundary (r7: 青い空/青い海), then
// lines that share nothing meaningful (君の手 → 夢の中: only の).
const MORPH_ROWS = Object.freeze(['[ti:ガラスの朝]', '# Aメロ', '青い空へ', '青い海へ', '夜の町を歩く', '朝の町を歩く', '# サビ', '青い空/青い海',
  '君の手', '夢の中', '光る窓', '光る窓の向こう']);

function morphDoc(ground, opts) {
  const o = Object.assign({ gen: 1 }, opts || {});
  const pins = Object.assign({ 'work:ground': { v: ground, by: 'user' } }, o.pins || {});
  return docWith(o.rows || MORPH_ROWS, Object.assign({}, o, { pins }));
}

// --- the package golden (tests/golden/project_glyph.json, DESIGN_2_2 §4) ------------------------------------------------

// morph: a new work (gen 1) in one background with four line pairs that share letters — 青い空へ → 青い海へ (the planner
// sets the second vertical and in another face), 夜の町を歩く → 朝の町を歩く, ブルーの空へ12 (vertical) → ブルーの海へ12
// (horizontal), 光る窓 → 光る窓の向こう — and one pinned モーフ between lines that share nothing meaningful (君の手 → 夢の中:
// only の), placed before the last pair so that the first four glyph seams show every case.
const GOLDEN_MORPH_ROWS = Object.freeze(['[ti:ガラスの朝]', '# Aメロ', '青い空へ', '青い海へ', '夜の町を歩く', '朝の町を歩く',
  'ブルーの空へ12', 'ブルーの海へ12', '# サビ', '君の手', '夢の中', '光る窓', '光る窓の向こう']);

function goldenMorphDoc(ground) {
  const pin = (v, sig) => (sig ? { v, by: 'user', sig } : { v, by: 'user' });
  return morphDoc(ground, { rows: GOLDEN_MORPH_ROWS, pins: { 'line/r7:orient': pin('v'), 'line/r8:orient': pin('h'),
    'cut/rb~0:seam': pin('glyphMorph', '夢の中') } });
}

// weight: the basic fixture as a new work on frostGlass, every line in its display face (Murecho 600, nine weights; plain
// lettering): 太字へ with
// 太さ 800 pinned (r4), 太字へ taking the grow rule (r5), 脈打つ太さ (r6), 細字へ (r7), 太字へ on outline lettering (ra: steps).
function goldenWeightDoc() {
  const doc = corpus.project('basic').doc;
  doc.look = Object.assign({}, doc.look, { gen: 1 });
  const pin = (v) => ({ v, by: 'user' });
  doc.pins = Object.assign({}, doc.pins, {
    'work:theme': pin('frostGlass'), 'work:text.face': pin('display'),
    'line/r4:arrive': pin('weightGrow'), 'line/r4:text.weight': pin(800),
    'line/r5:arrive': pin('weightGrow'),
    'line/r6:dwell': pin('weightPulse'),
    'line/r7:depart': pin('weightThin'),
    'line/ra:arrive': pin('weightGrow'), 'line/ra:text.style': pin('outline'),
  });
  return doc;
}

function goldenDocs(ground) {
  return [{ name: 'morph', doc: goldenMorphDoc(ground) }, { name: 'weight', doc: goldenWeightDoc() }];
}

const WEIGHT_KINDS = Object.freeze(['arrive', 'dwell', 'depart']);
const CROSSFADE = new Set(['plain', 'glow']);

// The 40 frame times of a golden document: the 32 times duration · (i + 0.5) / 32, then 8 inside the package's motions,
// two for each of up to 4 picks: the first 4 glyph seams (plan order), lo + {0.25, 0.75} · dur with lo = at − dur/2; then
// cuts with a weight part — the first cut of each weight kind, the first 太字へ on lettering that steps (outline, shadow,
// duo), then the next weight cuts in plan order — arrive → a + {0.3, 0.6} · p.dur, dwell → t0 + {0.25, 0.5} s, depart →
// b − {0.7, 0.4} · p.dur. Sorted.
function glyphTimes(plan, registry) {
  const out = [];
  for (let i = 0; i < 32; i++) out.push((plan.duration * (i + 0.5)) / 32);
  let extra = 0;
  for (const s of plan.seams) {
    const d = registry.get('seam', s.slot.v);
    if (extra >= 4 || !(d && d.glyphs === true)) continue;
    const lo = s.at - s.dur / 2;
    out.push(lo + 0.25 * s.dur, lo + 0.75 * s.dur);
    extra++;
  }
  const weighs = (c, k) => { const d = c.slots[k] && registry.get(k, c.slots[k].v); return !!(d && d.optIn === 'weight'); };
  const styleOf = (c) => (c.slots['text.style'] ? c.slots['text.style'].v : 'plain');
  const picks = [];
  const add = (c, kind) => { if (c && picks.length < 4 - extra && !picks.some((x) => x[0] === c)) picks.push([c, kind]); };
  for (const kind of WEIGHT_KINDS) add(plan.cuts.find((c) => weighs(c, kind)), kind);
  add(plan.cuts.find((c) => weighs(c, 'arrive') && !CROSSFADE.has(styleOf(c)) && !picks.some((x) => x[0] === c)), 'arrive');
  for (const c of plan.cuts) { const kind = WEIGHT_KINDS.find((k) => weighs(c, k)); if (kind) add(c, kind); }
  for (const [c, kind] of picks) {
    const dur = c.slots[kind].p && typeof c.slots[kind].p.dur === 'number' ? c.slots[kind].p.dur : 0.5;
    if (kind === 'arrive') out.push(c.a + 0.3 * dur, c.a + 0.6 * dur);
    else if (kind === 'dwell') out.push(c.t0 + 0.25, c.t0 + 0.5);
    else out.push(c.b - 0.7 * dur, c.b - 0.4 * dur);
  }
  return out.sort((x, y) => x - y);
}

// --- perf.py rows glyph-morph and glyph-weight (DESIGN_2_2 §4) ---------------------------------------------------------

// The comparator of a golden document for the same-run A/B: every glyph seam pinned to blendDissolve (morph), or every
// weight part pinned to a comparable catalog part (太字へ → fogIn, 脈打つ太さ → thumpSwell, 細字へ → fogOut) with the 太さ pins
// dropped (weight). Pins can change what the planner picks elsewhere, so it plans again until none is left (≤ 4 rounds).
const SWAP = Object.freeze({ arrive: 'fogIn', dwell: 'thumpSwell', depart: 'fogOut' });

function comparatorOf(MV, registry, name, doc) {
  const PL = MV.use('planner/plan');
  let out = JSON.parse(JSON.stringify(doc));
  if (name === 'weight') for (const k of Object.keys(out.pins)) if (/:text\.weight$/.test(k)) delete out.pins[k];
  for (let round = 0; round < 4; round++) {
    const plan = PL.plan(out, { registry });
    const pins = Object.assign({}, out.pins);
    let left = 0;
    if (name === 'morph') {
      for (const s of plan.seams) {
        const d = registry.get('seam', s.slot.v);
        if (d && d.glyphs === true) { pins['cut/' + s.into + ':seam'] = { v: 'blendDissolve', by: 'user' }; left++; }
      }
    } else {
      for (const c of plan.cuts) {
        for (const kind of Object.keys(SWAP)) {
          const d = c.slots[kind] && registry.get(kind, c.slots[kind].v);
          if (d && d.optIn === 'weight') { pins['cut/' + c.key + ':' + kind] = { v: SWAP[kind], by: 'user' }; left++; }
        }
      }
    }
    if (!left) return out;
    out = Object.assign({}, out, { pins });            // a new document object (the planner keys its memo by it)
  }
  throw new Error('glyph_docs: the ' + name + ' comparator still has glyph motion');
}

// { morph: { doc, comparator, start }, weight: { … } }: start = 1 s before the first morph window or weight motion. The
// golden documents with the per-cut screen effects off (work filter.count 0) and the other switch of the package off
// (the morph rows without automatic weight parts, the weight rows without automatic morphs), so that each row and its
// comparator differ only in the motions it measures, not in the look's accent filters (the morph document draws
// dotScreen and duoTone in its window, which alone put it and its comparator over twice the budget on a loaded 4-CPU
// machine) or in weight parts a comparator's own entrances would pick.
function perfDocs(MV) {
  const PL = MV.use('planner/plan');
  const registry = MV.use('parts/catalog').defaultRegistry();
  const out = {};
  for (const golden of goldenDocs(registry.fallback('ground'))) {
    const name = golden.name;
    const off = { v: false, by: 'user' };
    const doc = Object.assign({}, golden.doc, { pins: Object.assign({}, golden.doc.pins, { 'work:filter.count': { v: 0, by: 'user' },
      [name === 'morph' ? 'work:weight.auto' : 'work:morph.auto']: off }) });
    const plan = PL.plan(doc, { registry });
    let first = Infinity;
    for (const s of plan.seams) { const d = registry.get('seam', s.slot.v); if (d && d.glyphs === true) first = Math.min(first, s.at - s.dur / 2); }
    for (const c of plan.cuts) {
      for (const kind of Object.keys(SWAP)) { const d = c.slots[kind] && registry.get(kind, c.slots[kind].v); if (d && d.optIn === 'weight') first = Math.min(first, c.a); }
    }
    out[name] = { doc, comparator: comparatorOf(MV, registry, name, doc), start: Math.max(0, Math.round((first - 1) * 100) / 100) };
  }
  return out;
}

module.exports = { docWith, morphDoc, rowId, MORPH_ROWS, GOLDEN_MORPH_ROWS, goldenDocs, glyphTimes, comparatorOf, perfDocs };

// node tests/helpers/glyph_docs.js --perf → the perf documents as JSON (tests/browser/perf.py)
// node tests/helpers/glyph_docs.js --golden → { morph, weight }: the golden documents (tests/browser/contact_sheet.py --doc)
if (require.main === module && process.argv.includes('--perf')) {
  const { load } = require('./load.js');
  process.stdout.write(JSON.stringify(perfDocs(load())));
} else if (require.main === module && process.argv.includes('--golden')) {
  const { load } = require('./load.js');
  const ground = load().use('parts/catalog').defaultRegistry().fallback('ground');
  process.stdout.write(JSON.stringify(Object.fromEntries(goldenDocs(ground).map((d) => [d.name, d.doc]))));
}
