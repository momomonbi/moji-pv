/* 文字PVメーカー v2 — original work. Tests: キメ — a line marked キメ (line/<id>:kime) plays boldly in one cut; the cuts before it stay quiet (DESIGN_2_2 §3). Every lyric line here is invented for the test. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');
const KD = require('../helpers/kime_docs.js');
const XD = require('../helpers/extreme_docs.js');
const { throwsCode } = require('../helpers/assert_plus.js');

const MV = load();
const D = MV.use('core/doc');
const S = MV.use('core/script');
const PINS = MV.use('core/pins');
const P = MV.use('core/paths');
const CMD = MV.use('core/commands');
const TM = MV.use('core/timing');
const PL = MV.use('planner/plan');
const CA = MV.use('planner/cast');
const SG = MV.use('planner/segment');
const KI = MV.use('planner/kime');
const EX = MV.use('planner/explain');
const FI = MV.use('planner/fields');
const RU = MV.use('planner/rules');
const CAT = MV.use('parts/catalog').defaultRegistry();
const STUB = corpus.stubRegistry(MV);

const K = KI.KIME, CALM = KI.CALM;
const ON = KD.ON;
const clone = (x) => JSON.parse(JSON.stringify(x));
const plan = (doc, reg) => PL.plan(doc, { registry: reg || CAT });
const fresh = (doc, reg) => PL.run(doc, reg || CAT, { fresh: true });
const pinned = (d) => !!d && typeof d.from === 'string' && d.from.startsWith('pin');
const withPins = (doc, pins) => Object.assign({}, doc, { pins: Object.assign({}, doc.pins, pins) });
const cutsOfLine = (p, id) => { const l = p.lines.find((x) => x.id === id); return l ? l.cuts.map((k) => cutOf(p, k)) : []; };
const cutOf = (p, key) => p.cuts.find((c) => c.key === key) || null;
const kimeCuts = (p) => p.cuts.filter((c) => c.feat.kime);
const whyOf = (doc, p, pathText, reg) => EX.explain(doc, p, pathText, { registry: reg || CAT });
const codes = (ex) => ex.why.map((w) => (w.code === 'rule' ? 'rule:' + w.params.rule : w.code));

// A document of invented lines (rows r1, r2, …), automatic timing unless the rows carry stamps.
function lyricDoc(srcs, opts) {
  const o = opts || {};
  const doc = D.defaultDoc();
  doc.sheet = { next: srcs.length + 1, rows: srcs.map((src, i) => ({ id: 'r' + (i + 1).toString(36), src })) };
  doc.look = Object.assign({}, doc.look, { seed: o.seed || 24681357, moodSeed: o.moodSeed || 97531, aspect: o.aspect || '16:9' });
  doc.pins = Object.assign({}, o.pins || {});
  return doc;
}

// Every `every`-th lyric line of a document marked キメ (by the plan's line order).
function markEvery(doc, every) {
  const p = plan(doc);
  return KD.withKime(doc, p.lines.filter((l, i) => i % every === every - 1).map((l) => l.id));
}

function unitsOf(reg, c) {
  const d = c.slots.arrive;
  const def = reg.get('arrive', d.v);
  const u = c.feat.units;
  return def && def.unit === 'word' ? u.word : u.glyph;
}
function landing(reg, c) {
  const p = c.slots.arrive.p || {};
  return (p.dur || 0) + (unitsOf(reg, c) - 1) * (p.each || 0);
}
const moves = (shot) => shot !== 'none';

// The marked corpus of the guarantee tests: 3 seeds × {16:9, 9:16} × the four v2 fixtures × 8 moods, every 4th lyric line
// marked (192 plans; made once).
const MOODS = CAT.keys('mood').filter((k) => CAT.get('mood', k).pool !== false);
let marked = null;
function markedCorpus() {
  if (marked) return marked;
  marked = [];
  const base = corpus.corpus(3, ['16:9', '9:16'], corpus.PROJECTS);
  for (const { name, doc } of base) {
    const m = markEvery(doc, 4);
    MOODS.forEach((mood, i) => {
      if ((i + name.length) % 2 && MOODS.length > 4) return;       // half the moods per document keeps the run short
      const d = withPins(m, { 'work:mood': { v: mood, by: 'user' } });
      marked.push({ name: name + '/' + mood, doc: d, plan: plan(d) });
    });
  }
  return marked;
}
const lockedLine = (doc, c) => !!(c.line && doc.locks && doc.locks[c.line]);

// A plan line as planner/segment reads it: its text, script and emphasis (the cuts' ranges back at their offsets).
function lineInfo(p, line) {
  const emph = [];
  for (const k of line.cuts) {
    const off = P.cutOffset(k);
    for (const [a, b] of cutOf(p, k).emph || []) {
      const last = emph[emph.length - 1];
      if (last && last[1] === a + off) last[1] = b + off; else emph.push([a + off, b + off]);
    }
  }
  return { text: line.text, lang: line.lang, emph };
}

// The largest lyric run of a cut (fake measurer, rest pose, no camera), as a share of the short side; decorative text
// (a sidebar's index number) is not the lyric.
const BUILD = MV.use('engine/scene/build');
const TEXT = MV.use('engine/text/service').createTextService({ measurer: MV.use('engine/text/fake_measure').fakeMeasurer(), faces: null });
function lyricEm(c, p) {
  const scene = BUILD.buildCut(c, p, { registry: CAT, text: TEXT });
  let m = 0;
  for (const r of scene.runs || []) if (r.layout && r.spec && r.spec.span && r.layout.size > m) m = r.layout.size;
  return m / p.design.short;
}

// --- 1. the mark ------------------------------------------------------------------------------------------------------

test('the mark: line/<id>:kime true makes the line and its cut キメ; false, other values and other scopes do not', () => {
  const doc = corpus.project('basic').doc;
  const on = plan(withPins(doc, { 'line/r5:kime': ON }));
  const cs = cutsOfLine(on, 'r5');
  assert.equal(cs.length, 1, 'one cut');
  assert.equal(cs[0].feat.kime, true);
  assert.equal(cs[0].key, 'r5~0');
  assert.deepEqual(kimeCuts(on).map((c) => c.key), ['r5~0']);
  for (const v of [false, 'yes', 1, null]) {
    const p = plan(withPins(doc, { 'line/r5:kime': { v, by: 'user' } }));
    assert.equal(kimeCuts(p).length, 0, JSON.stringify(v));
    const bad = p.warnings.some((w) => w.code === 'pin-bad-value' && w.path === 'line/r5:kime');
    assert.equal(bad, v !== false, 'pin-bad-value for ' + JSON.stringify(v));
  }
  // other scopes: refused by the commands, ignored by the planner if present
  throwsCode(() => CMD.reduce(doc, { t: 'pin.set', path: 'work:kime', v: true, by: 'user' }), 'payload');
  throwsCode(() => CMD.reduce(doc, { t: 'pin.set', path: 'cut/r5~0:kime', v: true, by: 'user', sig: '改札の向こうで' }), 'payload');
  const stray = plan(withPins(doc, { 'work:kime': ON, 'cut/r5~0:kime': { v: true, by: 'user', sig: '改札の向こうで' } }));
  assert.equal(kimeCuts(stray).length, 0);
  // a later occurrence of a stamped row is its own line
  const lrc = corpus.project('lrc').doc;
  const occ = plan(withPins(lrc, { 'line/r8.1:kime': ON }));
  assert.deepEqual(kimeCuts(occ).map((c) => c.line), ['r8.1']);
  assert.ok(cutsOfLine(occ, 'r8').every((c) => !c.feat.kime));
  // fields read it from the plan; the setting from the table
  assert.equal(FI.valueAt(on, null, P.parse('line/r5:kime'), CAT, null), true);
  assert.equal(FI.valueAt(on, null, P.parse('line/r4:kime'), CAT, null), false);
  const calmOff = PINS.index({ 'work:kime.calm': { v: false, by: 'user' } });
  assert.equal(FI.valueAt(on, null, P.parse('work:kime.calm'), CAT, calmOff), false);
  assert.equal(FI.valueAt(on, null, P.parse('work:kime.calm'), CAT, PINS.index({})), true);
  assert.equal(RU.value(doc, null, 'kime.calm'), true);
  assert.equal(RU.value(withPins(doc, { 'work:kime.calm': { v: false, by: 'user' } }), null, 'kime.calm'), false);
});

test('commands: kime only at a line, kime.calm only at work; never promoted; kept by 固定を外す, removed with AIの固定を外す', () => {
  const doc = corpus.project('basic').doc;
  throwsCode(() => CMD.reduce(doc, { t: 'pin.set', path: 'line/r4:kime.calm', v: false, by: 'user' }), 'payload');
  throwsCode(() => CMD.reduce(doc, { t: 'pin.set', path: 'cut/r4~0:kime.calm', v: false, by: 'user', sig: '始発のホームに' }), 'payload');
  let d = CMD.reduce(doc, { t: 'pin.set', path: 'line/r4:kime', v: true, by: 'user' });
  d = CMD.reduce(d, { t: 'pin.set', path: 'line/r5:kime', v: true, by: 'ai' });
  d = CMD.reduce(d, { t: 'pin.set', path: 'work:kime.calm', v: false, by: 'user' });
  d = CMD.reduce(d, { t: 'pin.set', path: 'line/r4:lang', v: 'ja', by: 'user' });
  throwsCode(() => CMD.reduce(d, { t: 'pin.promote', path: 'line/r4:kime', to: 'work' }), 'payload');
  const all = CMD.reduce(d, { t: 'pin.clearUnder', scope: 'work' });
  assert.deepEqual(Object.keys(all.pins).sort(), ['line/r4:kime', 'line/r5:kime', 'work:kime.calm']);
  const line = CMD.reduce(d, { t: 'pin.clearUnder', scope: 'line/r4' });
  assert.ok(line.pins['line/r4:kime'] && !line.pins['line/r4:lang']);
  const ai = CMD.reduce(d, { t: 'pin.clearUnder', scope: 'work', by: 'ai' });
  assert.ok(!ai.pins['line/r5:kime'] && ai.pins['line/r4:kime'] && ai.pins['work:kime.calm']);
});

// --- 2. gating ---------------------------------------------------------------------------------------------------------

test('gating: no fixture or sample carries a mark; without one nothing changes, and kime.calm alone changes nothing', () => {
  const FIX = path.join(__dirname, '..', 'fixtures');
  for (const f of fs.readdirSync(FIX)) {
    if (!f.endsWith('.json')) continue;
    assert.ok(!/"[^"]*:kime(\.calm)?"/.test(fs.readFileSync(path.join(FIX, f), 'utf8')), f);
  }
  assert.ok(!/kime/.test(corpus.sampleLyrics()));
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'golden', 'plan_hashes.json'), 'utf8')).plans;
  for (const { name, doc } of corpus.corpus(1)) {
    const p = plan(doc);
    assert.equal(p.hash, golden[name], name);
    assert.ok(p.cuts.every((c) => !('kime' in c.feat) && !('calm' in c.feat)), name);
    assert.equal(plan(withPins(doc, { 'work:kime.calm': { v: false, by: 'user' } })).hash, p.hash, name + ' + kime.calm');
  }
  for (const name of ['v21', 'media', 'repeat']) {
    const p = plan(corpus.project(name).doc);
    assert.ok(p.cuts.every((c) => !('kime' in c.feat) && !('calm' in c.feat)), name);
  }
  // no reason of an unmarked plan names a キメ rule
  const doc = corpus.project('basic').doc;
  const p = plan(doc);
  for (const c of p.cuts.slice(0, 20)) {
    for (const slot of ['arrange', 'arrive', 'depart', 'lens', 'text.face', 'text.scale', 'ornament.count', 'cam.shot', 'seam']) {
      assert.ok(!codes(whyOf(doc, p, 'cut/' + c.key + ':' + slot)).some((x) => /kime/.test(x)), c.key + ' ' + slot);
    }
  }
});

// --- 3. registries without the キメ parts -------------------------------------------------------------------------------

test('registries without the キメ parts: nothing is forced by name; the chooser picks as usual (kime.limited)', () => {
  for (const { name, doc } of corpus.corpus(2, ['16:9', '9:16'], ['basic', 'lrc'])) {
    const m = markEvery(doc, 3);
    const p = plan(m, STUB);
    const ks = kimeCuts(p);
    assert.ok(ks.length > 0, name);
    for (const c of ks) {
      assert.ok(!K.arrange.includes(c.slots.arrange.v), name + ' ' + c.key);
      assert.equal(c.slots.depart.v, STUB.fallback('depart'));
      assert.equal(c.slots.lens.v, STUB.fallback('lens'));
      assert.equal(c.slots['text.scale'].v, K.scalePinned);
      assert.equal(c.slots['text.face'].v, 'display');
    }
    const c = ks[0];
    assert.equal(codes(whyOf(m, p, 'cut/' + c.key + ':arrange', STUB))[0], 'kime.limited');
    assert.equal(codes(whyOf(m, p, 'cut/' + c.key + ':text.scale', STUB))[0], 'rule:kime.scale');
  }
  // the user's part filters leave only a layout outside the set: it is used, and the text is set ×1.3
  const doc = withPins(corpus.project('basic').doc, { 'line/r5:kime': ON });
  doc.filters = { arrange: { only: ['centerAnchor'], deny: null } };
  const p = plan(doc);
  const c = cutOf(p, 'r5~0');
  assert.equal(c.slots.arrange.v, 'centerAnchor');
  assert.equal(c.slots.arrange.from, 'auto');
  assert.equal(c.slots['text.scale'].v, 1.3);
  assert.equal(codes(whyOf(doc, p, 'cut/r5~0:arrange'))[0], 'kime.limited');
});

// --- 4. the guarantees --------------------------------------------------------------------------------------------------

test('guarantees: set picks, rules, landing, hold, counts, hard cuts in and out and the lens/shot pairing on every キメ cut', () => {
  let n = 0, bleed = 0, giant = 0, still = 0, out = 0;
  for (const { name, doc, plan: p } of markedCorpus()) {
    const byLine = new Map();
    for (const c of p.cuts) if (c.line) (byLine.get(c.line) || byLine.set(c.line, []).get(c.line)).push(c);
    const flash = p.look.amounts.flash > 0;
    for (const c of kimeCuts(p)) {
      if (lockedLine(doc, c)) continue;
      n++;
      const s = c.slots, where = name + ' ' + c.key;
      const cells = c.feat.cells;
      const aspect = p.design.aspect, orient = s.orient.v;
      // along the frame's long side (a square frame: as usual), unless pinned
      const long = KI.longAxis(aspect);
      if (long && c.feat.orients.includes(long) && !pinned(s.orient)) {
        assert.deepEqual([orient, s.orient.from], [long, 'rule'], where + ' orient');
      }
      // はみ出し for 2–12 cells (10 across the short side), 大と小 only where its giant is big, else はみ出し
      const bleedable = cells >= K.bleedCells[0] && cells <= KI.bleedMax(aspect, orient);
      const big = KI.giantBig(KI.giantCells(c.text, c.emph, c.lang), aspect, orient);
      assert.ok((bleedable ? big ? K.arrange : K.bleedOnly : K.bigOnly).includes(s.arrange.v), where + ' arrange ' + s.arrange.v);
      if (s.arrange.v === 'edgeBleed') {
        bleed++;
        assert.equal(s.arrange.p.overflow, K.bleed.overflow, where);
        assert.equal(s.arrange.p.anchor, 'center', where);
        assert.equal(s['text.scale'].v, 1, where);
      } else {
        giant++;
        assert.ok(s.arrange.p.ratio >= K.giant.ratioMin, where);
        assert.equal(s.arrange.p.tuck, 'under', where);
        assert.ok(s['text.scale'].v >= 1, where);
      }
      assert.equal(s['text.face'].v, 'display', where);
      assert.ok(K.arrive.includes(s.arrive.v), where + ' arrive ' + s.arrive.v);
      assert.ok(s.arrive.p.dur <= 0.4 + 1e-9, where + ' dur');
      assert.ok(landing(CAT, c) <= K.landBy + 1e-9, where + ' landing ' + landing(CAT, c));
      assert.ok((p.beats ? K.dwellBeats : K.dwell).includes(s.dwell.v), where + ' dwell');
      assert.equal(s.depart.v, 'instantHide', where);
      assert.ok(s['ornament.count'].v <= 1, where);
      assert.ok(s['filter.count'].v <= 1 + (c.impact && flash ? 1 : 0), where);
      assert.equal(c.seamIn, -1, where + ' hard cut in');
      // the hard cut out, unless the next cut is 見せ場 (its own transition)
      const next = p.cuts[p.cuts.indexOf(c) + 1];
      if (next && !next.impact) {
        assert.ok(next.seamIn < 0 || pinned(p.seams[next.seamIn].slot), where + ' hard cut out');
        if (next.seamIn < 0) out++;
      }
      const shot = s['cam.shot'].v;
      assert.equal(s.lens.v === 'impactKick', !moves(shot), where + ' lens/shot ' + s.lens.v + ' ' + JSON.stringify(shot));
      if (moves(shot)) assert.ok(['dashStop', 'holdThenDash'].includes(s['cam.curve'].v), where + ' curve');
      // 大と小 without an emphasis already fills the frame: the camera holds and the lens punches in
      if (s.arrange.v === 'giantWhisper' && !c.feat.emph) {
        assert.deepEqual([shot, s['cam.shot'].from, s.lens.v], ['none', 'rule', 'impactKick'], where + ' still');
        still++;
      }
      const line = p.lines.find((l) => l.id === c.line);
      if (SG.kimeWhole(aspect, lineInfo(p, line), orient)) assert.equal(byLine.get(c.line).length, 1, where + ' one cut');
    }
  }
  assert.ok(n > 300 && bleed > 30 && giant > 30 && still > 20 && out > 200, [n, bleed, giant, still, out].join(' '));
});

// --- 5. no flash, no shake -----------------------------------------------------------------------------------------------

function flashChecks(p, doc, where) {
  let seen = 0;
  p.cuts.forEach((c, j) => {
    if (!c.feat.kime || c.impact || lockedLine(doc, c)) return;
    seen++;
    for (let i = 0; i < c.slots['filter.count'].v; i++) {
      const d = c.slots['filter#' + i];
      if (!pinned(d) && d.v !== 'none') assert.notEqual(CAT.get('filter', d.v).gate, 'flash', where + ' ' + c.key);
    }
    const next = p.cuts[j + 1];
    if (next && !next.impact && next.seamIn >= 0) {
      const d = p.seams[next.seamIn].slot;
      if (!pinned(d)) assert.notEqual(CAT.get('seam', d.v).gate, 'flash', where + ' seam out of ' + c.key);
    }
    if (c.slots.arrive.v === 'stampPress') assert.equal(c.slots.arrive.p.shake, 0, where);
    if (c.slots.lens.v === 'impactKick') assert.equal(c.slots.lens.p.shake, 0, where);
    assert.ok(!p.impulses.some((x) => x.t === c.t0 && x.kind !== 'punch'), where + ' impulse at ' + c.key);
  });
  return seen;
}

test('no flash and no shake on a キメ cut without 見せ場, nor on the way out of it', () => {
  let seen = 0;
  for (const { name, doc, plan: p } of markedCorpus()) seen += flashChecks(p, doc, name);
  assert.ok(seen > 300, String(seen));
  // the same with the flash and shake amounts at 0, and in the quietest mood
  for (const { name, doc } of corpus.corpus(2, ['16:9'], ['basic', 'long'])) {
    for (const pins of [{ 'work:amount.flash': { v: 0, by: 'user' }, 'work:amount.shake': { v: 0, by: 'user' } },
      { 'work:mood': { v: 'quietHush', by: 'user' } }]) {
      const d = withPins(markEvery(doc, 3), pins);
      const p = plan(d);
      assert.ok(flashChecks(p, d, name) > 0);
      for (const c of kimeCuts(p)) assert.ok(K.arrive.includes(c.slots.arrive.v) && c.slots.depart.v === 'instantHide');
    }
  }
});

// --- 6. camera cases ------------------------------------------------------------------------------------------------------

test('camera: a still camera keeps the 衝撃 punch-in; a moving one the fixed frame; EXTREME takes its strongest move', () => {
  const doc = lyricDoc(['あさやけの まちを', '光', 'かぜに のって']);
  const mark = { 'line/r2:kime': ON };
  const at = (d) => cutOf(plan(d), 'r2~0').slots;
  const still = at(lyricDoc(['あさやけの まちを', '光', 'かぜに のって'], { pins: Object.assign({ 'work:amount.camera': { v: 0, by: 'user' } }, mark) }));
  assert.equal(still.arrange.v, 'giantWhisper', 'a one-cell line takes 大と小');
  assert.deepEqual([still['cam.shot'].v, still.lens.v], ['none', 'impactKick']);
  const noShot = at(withPins(doc, Object.assign({ 'work:cam.shot': { v: 'none', by: 'user' } }, mark)));
  assert.deepEqual([noShot['cam.shot'].v, noShot.lens.v], ['none', 'impactKick']);
  // 大と小 without an emphasis: the giant is the whole block, which fills the frame — the camera holds (kime.still) and
  // the lens punches in, with the camera on too
  const dd = withPins(doc, mark);
  const dflt = at(dd);
  assert.deepEqual([dflt.arrange.v, dflt['cam.shot'].v, dflt['cam.shot'].from, dflt.lens.v], ['giantWhisper', 'none', 'rule', 'impactKick']);
  assert.deepEqual(codes(whyOf(dd, plan(dd), 'cut/r2~0:cam.shot')), ['rule:kime.still']);
  // with an emphasis the giant is that word: the push goes to it, and the lens stays framed
  const emDoc = lyricDoc(['あさやけの まちを', 'きみの*ひかり*', 'かぜに のって'], { pins: mark });
  const em = at(emDoc);
  assert.equal(em.arrange.v, 'giantWhisper');
  assert.ok(['pushWord', 'settle'].includes(em['cam.shot'].v), em['cam.shot'].v);
  assert.deepEqual([em['cam.shot'].from, em.lens.v], ['rule', 'fixedFrame']);
  assert.deepEqual(codes(whyOf(emDoc, plan(emDoc), 'cut/r2~0:cam.shot')), ['rule:kime.shot']);
  // a layout outside the キメ set (the part filters leave only 中央): the whole block snaps in
  const centre = Object.assign(withPins(doc, mark), { filters: { arrange: { only: ['centerAnchor'], deny: null } } });
  const cs = at(centre);
  assert.deepEqual([cs.arrange.v, cs['cam.shot'].v, cs['cam.shot'].from, cs.lens.v], ['centerAnchor', 'snapZoom', 'rule', 'fixedFrame']);
  const x = plan(withPins(doc, Object.assign({ 'work:cam.extreme': { v: 1, by: 'user' } }, mark)));
  const xc = cutOf(x, 'r2~0');
  assert.equal(xc.slots['cam.shot'].v, xc.feat.dur < 0.8 ? 'punchHit' : 'crashZoom');
  assert.equal(xc.slots.lens.v, 'fixedFrame');
  // EXTREME replaces a still camera's 'none' (the amount is below 10 %): the lens knows the camera will move
  const xs = cutOf(plan(withPins(doc, Object.assign({ 'work:cam.extreme': { v: 1, by: 'user' },
    'work:amount.camera': { v: 0, by: 'user' } }, mark))), 'r2~0');
  assert.ok(['crashZoom', 'punchHit'].includes(xs.slots['cam.shot'].v), JSON.stringify(xs.slots['cam.shot'].v));
  assert.equal(xs.slots.lens.v, 'fixedFrame');
  // every キメ cut of a document with EXTREME on takes the strongest move its pool has
  let strongest = 0;
  for (const { name, doc: d } of corpus.corpus(3, ['16:9', '9:16'], ['basic', 'lrc'])) {
    const p = plan(withPins(markEvery(d, 2), { 'work:cam.extreme': { v: 1, by: 'user' } }));
    for (const c of kimeCuts(p)) {
      if (c.slots.arrange.v === 'edgeBleed') continue;
      assert.equal(c.slots['cam.shot'].v, c.feat.dur < 0.8 ? 'punchHit' : 'crashZoom', name + ' ' + c.key);
      assert.equal(c.slots.lens.v, 'fixedFrame', name + ' ' + c.key);
      strongest++;
    }
  }
  assert.ok(strongest > 20, String(strongest));
  // はみ出し stays framed with EXTREME on: no EXTREME move, the punch-in
  const bleedDoc = XD.withPins(corpus.project('basic').doc, { 'work:cam.extreme': { v: 1, by: 'user' } });
  let found = 0;
  for (const id of ['r4', 'r5', 'r6', 'r7', 'rb', 'rc']) {
    const p = plan(withPins(bleedDoc, { ['line/' + id + ':kime']: ON }));
    const c = kimeCuts(p)[0];
    if (c.slots.arrange.v !== 'edgeBleed') continue;
    found++;
    assert.deepEqual([c.slots['cam.shot'].v, c.slots.lens.v], ['none', 'impactKick'], id);
  }
  assert.ok(found > 0, 'some line takes はみ出し');
});

// --- 7. long lines ----------------------------------------------------------------------------------------------------------

const CHUNKS = ['あおいそらの', 'したで', 'きみを', 'まっていた', 'ひかりのなかへ', 'かけだして', 'とおくまで', 'とどけたい', 'このこえを'];
function lineOf(cells) {
  let t = '';
  for (let i = 0; S.cells(t) < cells; i++) t += CHUNKS[i % CHUNKS.length];
  return Array.from(t).slice(0, cells).join('');
}

test('long lines: one cut where one cut shows it big; others keep their pieces and one キメ cut that lands in time', () => {
  assert.deepEqual(['16:9', '21:9', '4:3', '1:1', '4:5', '3:4', '9:16'].map(SG.kimeMaxCells), [28, 30, 24, 20, 20, 18, 16]);
  let wholes = 0, splits = 0;
  for (const n of [12, 13, 16, 17, 24, 28, 29, 30, 31, 35]) {
    const text = lineOf(n);
    for (const aspect of ['16:9', '9:16']) {
      for (const orient of ['h', 'v']) {
        const doc = lyricDoc(['はじまりの うた', text, 'おわりの うた'], { aspect,
          pins: { 'line/r2:kime': ON, 'work:orient': { v: orient, by: 'user' } } });
        const p = plan(doc);
        const cs = cutsOfLine(p, 'r2');
        const where = n + ' ' + aspect + ' ' + orient;
        // one cut where one cut shows it big (はみ出し for ≤ 12 cells, 10 across the short side; else a big 大と小 giant)
        const whole = SG.kimeWhole(aspect, { text, lang: 'ja', emph: [] }, orient);
        assert.equal(whole, n <= SG.kimeMaxCells(aspect) &&
          (n <= KI.bleedMax(aspect, orient) || KI.giantBig(KI.giantCells(text, [], 'ja'), aspect, orient)), where);
        if (whole) assert.equal(cs.length, 1, where);
        else assert.ok(cs.length >= 2, where + ' ' + cs.length);
        if (whole) wholes++; else splits++;
        const ks = cs.filter((c) => c.feat.kime);
        assert.equal(ks.length, 1, where);
        const focus = cs.find((c) => c.role === 'focus');
        assert.equal(ks[0].key, (focus || cs[cs.length - 1]).key, where);
        assert.ok(landing(CAT, ks[0]) <= K.landBy + 1e-9, where);
      }
    }
  }
  assert.ok(wholes >= 6 && splits >= 20, wholes + ' ' + splits);
  // a split pin that leaves a 35-cell piece: that piece is the キメ cut, 大と小
  const text = lineOf(40);
  const off = Array.from(text).slice(0, 5).join('').length;
  const doc = lyricDoc(['はじまりの うた', text], { pins: { 'line/r2:kime': ON, 'line/r2:split': { v: [0, off], by: 'user' } } });
  const p = plan(doc);
  const cs = cutsOfLine(p, 'r2');
  assert.equal(cs.length, 2);
  assert.equal(cs[1].feat.kime, true);
  assert.equal(cs[1].slots.arrange.v, 'giantWhisper');
});

// --- 8. pins on the former pieces ---------------------------------------------------------------------------------------------

test('pins on the pieces a marked line had: shadowed (not applied), back on their pieces when the mark goes', () => {
  const srcs = ['あさの ひかり', 'ゆうやけ/そらの/むこうへ', 'よるの しじま'];
  const piecePins = {
    'cut/r2~0:arrive': { v: 'typeOn', by: 'user', sig: 'ゆうやけ' },
    'cut/r2~4:arrange': { v: 'centerAnchor', by: 'user', sig: 'そらの' },
  };
  const unmarked = lyricDoc(srcs, { pins: piecePins });
  const before = plan(unmarked);
  assert.equal(cutOf(before, 'r2~4').slots.arrange.v, 'centerAnchor');
  const doc = withPins(unmarked, { 'line/r2:kime': ON });
  const p = plan(doc);
  const cs = cutsOfLine(p, 'r2');
  assert.deepEqual(cs.map((c) => c.key), ['r2~0']);
  assert.ok(K.arrange.includes(cs[0].slots.arrange.v), cs[0].slots.arrange.v);
  assert.ok(K.arrive.includes(cs[0].slots.arrive.v), cs[0].slots.arrive.v);
  const shadowed = p.warnings.filter((w) => w.code === 'shadowed-pin').map((w) => w.path).sort();
  assert.deepEqual(shadowed, ['cut/r2~0:arrive', 'cut/r2~4:arrange']);
  // a pin made for the whole line (its text as the sig) stays on the キメ cut
  const whole = withPins(doc, { 'cut/r2~0:arrive': { v: 'typeOn', by: 'user', sig: 'ゆうやけそらのむこうへ' } });
  const pw = plan(whole);
  assert.equal(cutOf(pw, 'r2~0').slots.arrive.v, 'typeOn');
  assert.equal(cutOf(pw, 'r2~0').slots.arrive.from, 'pin:cut');
  // unmarked again: the piece pins are back
  const back = plan(unmarked);
  assert.equal(back.hash, before.hash);
});

// --- 9. the hold ----------------------------------------------------------------------------------------------------------------

test('the hold: +0.6 s of automatic time; anchored lines never move; up to 1.5 s into an interlude or the ending, keeping 3 s', () => {
  const srcs = ['あさの ひかり', 'ゆうやけの そら', 'よるの しじま', 'ほしの うた'];
  const p0 = plan(lyricDoc(srcs)), p1 = plan(lyricDoc(srcs, { pins: { 'line/r2:kime': ON } }));
  assert.equal(TM.KIME_HOLD, 0.6);
  assert.deepEqual(p1.lines.slice(0, 2).map((l) => l.t0), p0.lines.slice(0, 2).map((l) => l.t0));
  for (let i = 2; i < 4; i++) assert.ok(Math.abs(p1.lines[i].t0 - p0.lines[i].t0 - 0.6) < 1e-6, 'line ' + i);
  // anchored lines (LRC stamps) do not move
  const lrc = corpus.project('lrc').doc;
  const a0 = plan(lrc), a1 = plan(withPins(lrc, { 'line/r6:kime': ON }));
  assert.deepEqual(a1.lines.map((l) => [l.t0, l.t1]), a0.lines.map((l) => [l.t0, l.t1]));
  // into an interlude
  for (const [gap, hold] of [[2.9, 0], [3, 0], [4, 1], [5, 1.5]]) {
    const d = lyricDoc(['[00:02.00]あさの ひかり', '[00:12.00]よるの しじま'],
      { pins: { 'line/r1:kime': ON, 'line/r1:end': { v: 12 - gap, by: 'user' } } });
    const p = plan(d);
    const g = cutOf(p, 'gap/r1'), c = cutOf(p, 'r1~0');
    assert.ok(g, 'an interlude after a gap of ' + gap);
    assert.ok(Math.abs(g.t0 - (c.t1 + hold)) < 1e-6, gap + ': hold ' + (g.t0 - c.t1));
    if (hold > 0) assert.ok(g.t1 - g.t0 >= K.keep - 1e-6);
    const b = g.t0 + D.defaultDoc().timing.tail;
    if (g.seamIn < 0) assert.ok(Math.abs(c.b - b) < 1e-6, gap + ': b ' + c.b);
    else assert.ok(c.b <= b + 1e-6);
  }
  // into the ending
  for (const [room, hold] of [[3, 0], [4, 1]]) {
    const d = lyricDoc(['[00:02.00]あさの ひかり', '[00:06.00]よるの しじま'],
      { pins: { 'line/r2:kime': ON, 'line/r2:end': { v: 10, by: 'user' }, 'work:length': { v: 10 + room, by: 'user' } } });
    const p = plan(d);
    const o = cutOf(p, 'outro');
    assert.ok(Math.abs(o.t0 - (10 + hold)) < 1e-6, room + ': ' + o.t0);
    assert.ok(o.t1 - o.t0 >= K.keep - 1e-6);
  }
});

// --- 10. calm before the hit ----------------------------------------------------------------------------------------------------

function strongArrive(c) {
  const def = CAT.get('arrive', c.slots.arrive.v), t = CAT.traits('arrive', c.slots.arrive.v);
  return KI.calmFactor(def, t, 2) < 1;
}

test('calm: the two cuts before a キメ cut are quieter; 「キメの前を静かにする」 off leaves them alone', () => {
  let n2 = 0, n1 = 0, strong2 = 0, strongElse = 0, nElse = 0;
  for (const { name, doc, plan: p } of markedCorpus()) {
    const flash = p.look.amounts.flash > 0;
    for (const c of p.cuts) {
      if (lockedLine(doc, c) || !c.line) continue;
      const s = c.slots, where = name + ' ' + c.key;
      const extra = c.impact && flash ? 1 : 0;
      if (c.feat.calm === 2) {
        n2++;
        if (!pinned(s['ornament.count'])) assert.equal(s['ornament.count'].v, 0, where);
        if (!pinned(s['filter.count'])) assert.equal(s['filter.count'].v, extra, where);
        if (!pinned(s['cam.shot'])) assert.ok(CALM.shots.includes(s['cam.shot'].v), where + ' ' + s['cam.shot'].v);
        if (!pinned(s.lens)) assert.ok(!CALM.lensDeny.includes(CAT.get('lens', s.lens.v).family), where + ' ' + s.lens.v);
        if (!pinned(s.arrive) && strongArrive(c)) strong2++;
      } else if (c.feat.calm === 1) {
        n1++;
        if (!pinned(s['ornament.count'])) assert.ok(s['ornament.count'].v <= 1, where);
        if (!pinned(s['filter.count'])) assert.ok(s['filter.count'].v <= 1 + extra, where);
      } else if (!c.feat.kime) {
        nElse++;
        if (!pinned(s.arrive) && strongArrive(c)) strongElse++;
      }
    }
  }
  assert.ok(n2 > 200 && n1 > 200, n2 + ' ' + n1);
  assert.ok(strong2 / n2 <= 0.5 * (strongElse / nElse), 'strong entrances ' + strong2 / n2 + ' vs ' + strongElse / nElse);
  const doc = markEvery(corpus.project('basic').doc, 3);
  const off = plan(withPins(doc, { 'work:kime.calm': { v: false, by: 'user' } }));
  assert.ok(kimeCuts(off).length > 0 && off.cuts.every((c) => !('calm' in c.feat)));
});

// --- 11. pins win --------------------------------------------------------------------------------------------------------------

test('pins win on a キメ cut: layout, exit, size, shot and transition stay; a split pin splits; a locked line keeps its lock', () => {
  const base = corpus.project('basic').doc;
  const sig = '改札の向こうで朝がほどける';
  const depart = CAT.keys('depart').find((k) => CAT.get('depart', k).pool !== false);
  const seam = CAT.keys('seam').find((k) => k !== 'hardCut' && !CAT.get('seam', k).gate);
  const doc = withPins(base, {
    'line/r5:kime': ON, 'cut/r5~0:arrange': { v: 'centerAnchor', by: 'user', sig }, 'cut/r5~0:depart': { v: depart, by: 'user', sig },
    'cut/r5~0:text.scale': { v: 0.8, by: 'user', sig }, 'cut/r5~0:cam.shot': { v: 'none', by: 'user', sig },
    'cut/r5~0:seam': { v: seam, by: 'user', sig },
  });
  const p = plan(doc);
  const c = cutOf(p, 'r5~0');
  assert.equal(c.feat.kime, true);
  assert.deepEqual([c.slots.arrange.v, c.slots.depart.v, c.slots['text.scale'].v, c.slots['cam.shot'].v],
    ['centerAnchor', depart, 0.8, 'none']);
  assert.equal(p.seams[c.seamIn].slot.v, seam);
  assert.equal(c.slots.lens.v, 'impactKick', 'a pinned still shot: the punch-in');
  // a split pin splits; the キメ cut is the last piece
  const split = plan(withPins(base, { 'line/r5:kime': ON, 'line/r5:split': { v: [0, 7], by: 'user' } }));
  const cs = cutsOfLine(split, 'r5');
  assert.equal(cs.length, 2);
  assert.deepEqual(cs.map((x) => !!x.feat.kime), [false, true]);
  // the locked line of the vertical fixture keeps its lock pins
  const vert = corpus.project('vertical').doc;
  const lockedId = Object.keys(vert.locks)[0];
  const lp = plan(withPins(vert, { ['line/' + lockedId + ':kime']: ON }));
  for (const c2 of cutsOfLine(lp, lockedId)) {
    for (const [pathText, pin] of Object.entries(vert.pins)) {
      if (pin.by !== 'lock' || !pathText.startsWith('cut/' + (c2.pinKey || c2.key) + ':')) continue;
      const slot = pathText.slice(pathText.indexOf(':') + 1);
      if (c2.slots[slot]) assert.deepEqual(c2.slots[slot].v, pin.v, pathText);
    }
  }
});

// --- 12. locality ---------------------------------------------------------------------------------------------------------------

test('locality: marking one line changes only the calm cuts, the キメ cut, the 5 cuts after it and the echoes of those', () => {
  for (const { name, doc } of corpus.corpus(3, ['16:9', '9:16'], ['lrc'])) {
    const p0 = plan(doc);
    for (const id of ['r5', 'ra']) {
      const p1 = plan(withPins(doc, { ['line/' + id + ':kime']: ON }));
      const j = p1.cuts.findIndex((c) => c.feat.kime);
      const ok = new Set();
      for (let i = Math.max(0, j - 2); i <= j + 5 && i < p1.cuts.length; i++) ok.add(p1.cuts[i].key);
      const changed = new Set();
      p1.cuts.forEach((c, i) => {
        const was = cutOf(p0, c.key);
        if (!was || JSON.stringify(was.slots) === JSON.stringify(c.slots)) return;
        changed.add(c.key);
        if (ok.has(c.key)) return;
        const echo = [0, 1, 2].some((back) => i - back >= 0 && changed.has(p1.cuts[i - back].feat.repeatOf || ''));
        assert.ok(echo, name + ' ' + id + ': ' + c.key + ' changed far from the mark');
        ok.add(c.key);
      });
    }
  }
});

// --- 13. 「くり返しの行をそろえる」 ---------------------------------------------------------------------------------------------------

test('alignment: a copy aligns with its source only when both are キメ or neither is', () => {
  const doc = corpus.project('repeat').doc;
  const p0 = plan(doc);
  const src = (d, p) => CA.alignments({ ix: PINS.index(d.pins) }, p.cuts) || new Map();
  // a one-cut line whose later copy takes its decisions in the unmarked plan
  const a0 = src(doc, p0);
  const hit = p0.cuts.find((c) => a0.has(c.key) && cutsOfLine(p0, c.line).length === 1 && cutsOfLine(p0, a0.get(c.key).line).length === 1);
  assert.ok(hit, 'an aligned one-cut copy');
  const first = a0.get(hit.key).line, copy = hit.line;
  const both = withPins(doc, { ['line/' + first + ':kime']: ON, ['line/' + copy + ':kime']: ON });
  const pb = plan(both);
  const cc = cutsOfLine(pb, copy)[0];
  assert.equal(cc.feat.kime, true);
  const got = src(both, pb).get(cc.key);
  assert.ok(got && got.line === first, 'the marked copy aligns with its marked source');
  const once = withPins(doc, { ['line/' + first + ':kime']: ON });
  const po = plan(once);
  assert.ok(!src(once, po).has(cutsOfLine(po, copy)[0].key), 'a copy marked once keeps its own look');
});

// --- 14. explain --------------------------------------------------------------------------------------------------------------------

test('explain: the キメ reasons, the masked alternatives, the rules of the cut and of the cuts before it', () => {
  let arranged = 0, bleedParam = 0, calmCount = 0, calmWeigh = 0, flashMask = 0, landParam = 0, tuckParam = 0;
  for (const { name, doc, plan: p } of markedCorpus().slice(0, 60)) {
    for (const c of kimeCuts(p)) {
      if (lockedLine(doc, c)) continue;
      const at = 'cut/' + c.key + ':';
      if (arranged < 3) {
        const ex = whyOf(doc, p, at + 'arrange');
        assert.equal(codes(ex)[0], 'kime', name);
        assert.ok(ex.alts.filter((a) => a.w > 0).every((a) => K.arrange.includes(a.key)), name);
        assert.ok(ex.alts.some((a) => a.masked === 'kime'));
        assert.deepEqual(codes(whyOf(doc, p, at + 'depart')), ['rule:kime.depart']);
        assert.deepEqual(codes(whyOf(doc, p, at + 'text.face')), ['rule:kime.face']);
        if (p.cuts.indexOf(c) > 0) assert.deepEqual(codes(whyOf(doc, p, at + 'seam')), ['rule:kime.seam']);
        if (c.slots.arrange.v === 'giantWhisper' && c.slots['cam.shot'].from === 'rule') {
          assert.deepEqual(codes(whyOf(doc, p, at + 'cam.shot')), [c.slots['cam.shot'].v === 'none' ? 'rule:kime.still' : 'rule:kime.shot']);
        }
        if (c.slots.orient.from === 'rule') assert.deepEqual(codes(whyOf(doc, p, at + 'orient')), ['rule:kime.orient']);
        const next = p.cuts[p.cuts.indexOf(c) + 1];
        if (next && !next.impact && next.line) assert.deepEqual(codes(whyOf(doc, p, 'cut/' + next.key + ':seam')), ['rule:kime.seamOut']);
        arranged++;
      }
      if (c.slots.arrange.v === 'edgeBleed' && bleedParam < 2) {
        // the size and placement parameters: kime.size; the landing: kime.param
        assert.deepEqual(codes(whyOf(doc, p, at + P.slotParamPath('arrange', null, 'edgeBleed', 'overflow', false))),
          ['rule:kime.size']);
        assert.deepEqual(codes(whyOf(doc, p, at + 'text.scale')), ['rule:kime.full']);
        const a = c.slots.arrive;
        if (a.pfrom && a.pfrom.each === 'rule') {
          assert.deepEqual(codes(whyOf(doc, p, at + P.slotParamPath('arrive', null, a.v, 'each', !!MV.use('core/registry').SHARED.arrive.each))),
            ['rule:kime.param']);
          landParam++;
        }
        bleedParam++;
      }
      if (c.slots.arrange.v === 'giantWhisper' && c.slots.arrange.pfrom && c.slots.arrange.pfrom.tuck === 'rule' && tuckParam < 1) {
        assert.deepEqual(codes(whyOf(doc, p, at + P.slotParamPath('arrange', null, 'giantWhisper', 'tuck', false))), ['rule:kime.size']);
        tuckParam++;
      }
      if (!c.impact && c.slots['filter.count'].v > 0 && p.look.amounts.flash > 0 && flashMask < 2) {
        const ex = whyOf(doc, p, at + 'filter#0');
        if (!pinned(c.slots['filter#0'])) {
          assert.ok(codes(ex).includes('kime.noFlash'), name);
          assert.ok(ex.alts.filter((a) => CAT.get('filter', a.key).gate === 'flash').every((a) => a.masked), name);
          flashMask++;
        }
      }
    }
    for (const c of p.cuts) {
      if (c.feat.calm !== 2 || lockedLine(doc, c)) continue;
      const at = 'cut/' + c.key + ':';
      if (calmCount < 2 && c.slots['ornament.count'].from === 'rule') {
        assert.deepEqual(codes(whyOf(doc, p, at + 'ornament.count')), ['rule:kime.calm']);
        calmCount++;
      }
      if (calmWeigh < 2 && c.slots.arrive.from === 'auto' && KI.calmFactor(CAT.get('arrive', c.slots.arrive.v),
        CAT.traits('arrive', c.slots.arrive.v), 2) !== 1) {
        assert.ok(codes(whyOf(doc, p, at + 'arrive')).includes('kime.calm'), name + ' ' + c.key);
        calmWeigh++;
      }
    }
  }
  assert.ok(arranged === 3 && bleedParam === 2 && calmCount === 2 && calmWeigh === 2 && flashMask > 0 && landParam > 0 && tuckParam > 0,
    [arranged, bleedParam, calmCount, calmWeigh, flashMask, landParam, tuckParam].join(' '));
  // the line kept whole
  const doc = withPins(corpus.project('basic').doc, { 'line/r5:kime': ON });
  const p = plan(doc);
  assert.deepEqual(codes(whyOf(doc, p, 'line/r5:split')), ['rule:kime.split']);
  assert.deepEqual(codes(whyOf(doc, p, 'line/r4:split')), ['rule:marks']);
  // the inspector's 区切り: automatic on the line kept whole (its '/' marks have no effect there), 記号 elsewhere
  const sel = (id) => ({ level: 'line', ids: [id] });
  assert.equal(FI.fieldState(doc, p, sel('r5'), 'line/r5:split', { registry: CAT }).state, 'auto');
  assert.equal(FI.fieldState(doc, p, sel('r4'), 'line/r4:split', { registry: CAT }).state, 'mark');
  const unmarked = corpus.project('basic').doc;
  assert.equal(FI.fieldState(unmarked, plan(unmarked), sel('r5'), 'line/r5:split', { registry: CAT }).state, 'mark');
});

// --- 15. determinism and the re-planning caches ----------------------------------------------------------------------------------

test('determinism: fresh plans agree; re-planning after a mark goes on or off gives the plan made from scratch', () => {
  for (const { name, doc } of KD.goldenDocs().slice(0, 6)) {
    assert.equal(fresh(clone(doc)).hash, fresh(clone(doc)).hash, name);
  }
  // an anchored document (the mark moves no time): after toggling a line that no later line sings again, at most 9 casts
  // are new (the calm cuts, the line's cuts — two when it comes back split — and the cuts whose history reads them); the
  // others after any toggle. A locked line marked and unmarked: the seam out of it follows the mark (the seam memo keys
  // on it, since the cut before is not among the next cut's cast inputs).
  const doc = corpus.project('lrc').doc;
  const locked = CMD.reduce(doc, FI.lockPayload(doc, plan(doc), 'r6', { registry: CAT }));
  const seq = [[doc, false], [withPins(doc, { 'line/r6:kime': ON }), true], [doc, true],
    [withPins(doc, { 'line/r6:kime': ON, 'line/r9:kime': ON }), false], [withPins(doc, { 'line/r9:kime': ON }), false],
    [withPins(doc, { 'line/r5:kime': ON }), false], [locked, false], [withPins(locked, { 'line/r6:kime': ON }), false],
    [locked, false]];
  for (const [d, local] of seq) {
    const cached = PL.run(clone(d), CAT, null);
    const scratch = fresh(clone(d));
    assert.equal(cached.hash, scratch.hash);
    if (local) assert.ok(cached.reuse.casts >= cached.reuse.cuts - 9, cached.reuse.casts + ' of ' + cached.reuse.cuts);
  }
  const lk = plan(withPins(locked, { 'line/r6:kime': ON }));
  const last = cutsOfLine(lk, 'r6').pop(), after = lk.cuts[lk.cuts.indexOf(last) + 1];
  assert.ok(last.feat.kime && !after.impact && after.seamIn < 0, 'the hard cut out of the locked キメ line');
});

// --- review fixes: the lock, the size, the calm cuts, the part filters, the rules the other tests do not reach -------------

test('lock: a locked キメ line keeps its look when the mark is removed (the キメ parameters are frozen too)', () => {
  let n = 0;
  for (const { name, doc } of corpus.corpus(2, ['16:9', '9:16'], ['basic', 'lrc'])) {
    const p0 = plan(doc);
    for (const l of p0.lines.filter((x, i) => i % 3 === 0)) {
      if (doc.locks && doc.locks[l.id]) continue;
      const marked = withPins(doc, { ['line/' + l.id + ':kime']: ON });
      const locked = CMD.reduce(marked, FI.lockPayload(marked, plan(marked), l.id, { registry: CAT }));
      const pl = plan(locked);
      const pu = plan(CMD.reduce(locked, { t: 'pin.clear', path: 'line/' + l.id + ':kime' }));
      for (const c of cutsOfLine(pl, l.id)) {
        const u = cutOf(pu, c.key);
        assert.ok(u, name + ' ' + c.key);
        for (const slot of Object.keys(c.slots)) {
          if (slot === 'cam.shot') continue;                       // its carry is a stage-6 fact of the cut before
          assert.deepEqual([u.slots[slot].v, u.slots[slot].p], [c.slots[slot].v, c.slots[slot].p], name + ' ' + c.key + ' ' + slot);
        }
        assert.equal(u.slots['cam.shot'].v, c.slots['cam.shot'].v, name + ' ' + c.key + ' cam.shot');
        if (c.feat.kime) n++;
      }
    }
  }
  assert.ok(n > 20, String(n));
});

test('size: every キメ cut is bigger than the median lyric cut of its video and than the quiet cut right before it', () => {
  let n = 0, calm = 0;
  for (const { name, doc } of corpus.corpus(2, ['16:9', '9:16', '1:1'], corpus.PROJECTS)) {
    const d = markEvery(doc, 4);
    const p = plan(d);
    const ems = p.cuts.filter((c) => c.line && !c.feat.kime).map((c) => lyricEm(c, p)).sort((a, b) => a - b);
    const median = ems[ems.length >> 1];
    p.cuts.forEach((c, i) => {
      if (!c.feat.kime || lockedLine(d, c) || pinned(c.slots.arrange)) return;
      n++;
      const e = lyricEm(c, p), where = name + ' ' + c.key + ' ' + c.slots.arrange.v + '/' + c.slots.orient.v;
      assert.ok(e > median, where + ': ' + e.toFixed(3) + ' ≤ the median ' + median.toFixed(3));
      const before = p.cuts[i - 1];
      if (before && before.feat.calm === 2 && !lockedLine(d, before)) {
        calm++;
        const eb = lyricEm(before, p);
        assert.ok(e > eb, where + ': ' + e.toFixed(3) + ' ≤ the cut before ' + before.key + ' ' + eb.toFixed(3));
      }
    });
  }
  assert.ok(n > 150 && calm > 120, n + ' ' + calm);
});

test('calm: the cut before a キメ cut takes no bold or キメ layout; level 1 weighs them down; its text is ×0.9', () => {
  let n2 = 0, n1 = 0, bold1 = 0, bold0 = 0, n0 = 0;
  const bold = (k) => K.arrange.includes(k) || (CAT.get('arrange', k).tags || []).some((t) => CALM.arrangeDeny.includes(t));
  for (const { doc, plan: p } of markedCorpus()) {
    for (const c of p.cuts) {
      if (!c.line || lockedLine(doc, c) || pinned(c.slots.arrange) || c.feat.kime) continue;
      if (c.feat.calm === 2) { n2++; assert.ok(!bold(c.slots.arrange.v), c.key + ' ' + c.slots.arrange.v); }
      else if (c.feat.calm === 1) { n1++; if (bold(c.slots.arrange.v)) bold1++; }
      else { n0++; if (bold(c.slots.arrange.v)) bold0++; }
    }
  }
  assert.ok(n2 > 200 && n1 > 200 && bold1 / n1 < bold0 / n0, [n2, n1, bold1 / n1, bold0 / n0].join(' '));
  // the text scale: ×0.97 at level 1, ×0.9 at level 2 (automatic text only)
  assert.deepEqual(CALM.scale, [1, 0.97, 0.9]);
  const srcs = ['あさの ひかり', 'ゆうやけの そら', 'よるの しじま', 'ほしの うた'];
  const p0 = plan(lyricDoc(srcs)), p1 = plan(lyricDoc(srcs, { pins: { 'line/r4:kime': ON } }));
  const scaleOf = (p, key) => cutOf(p, key).slots['text.scale'].v;
  const lv = (key) => cutOf(p1, key).feat.calm;
  for (const key of ['r2~0', 'r3~0']) {
    const want = Math.round(scaleOf(p0, key) * CALM.scale[lv(key)] * 100) / 100;
    assert.ok(Math.abs(scaleOf(p1, key) - want) <= 0.011, key + ' level ' + lv(key) + ': ' + scaleOf(p1, key) + ' vs ' + want);
  }
  assert.deepEqual([lv('r2~0'), lv('r3~0')], [1, 2]);
});

test('calm span: only cuts that start within 4 s before the キメ cut are calmed', () => {
  // stamped lines 3 s apart: the cut 3 s before is calmed, the one 6 s before is not
  const d = lyricDoc(['[00:02.00]あさの ひかり', '[00:05.00]ゆうやけの そら', '[00:08.00]よるの しじま'], { pins: { 'line/r3:kime': ON } });
  const p = plan(d);
  assert.deepEqual(['r1~0', 'r2~0'].map((k) => cutOf(p, k).feat.calm || 0), [0, 2]);
  const near = lyricDoc(['[00:03.50]あさの ひかり', '[00:05.20]ゆうやけの そら', '[00:07.00]よるの しじま'], { pins: { 'line/r3:kime': ON } });
  const q = plan(near);
  assert.deepEqual(['r1~0', 'r2~0'].map((k) => cutOf(q, k).feat.calm || 0), [1, 2]);
  assert.equal(CALM.span, 4);
});

test('the counts before a キメ cut: many decorations are cut to one on the level-1 cut (rule kime.calm)', () => {
  // (the screen-effect count is at most 1 before the 見せ場 extra — 0.8 · drive + r < 2 — so its level-1 cap of 1 never
  // binds; the level-2 cap of 0 does, test 10)
  let capped = 0;
  for (const { name, doc } of corpus.corpus(2, ['16:9'], ['basic', 'long'])) {
    const d = withPins(markEvery(doc, 3), { 'work:amount.ornament': { v: 1, by: 'user' } });
    const p = plan(d);
    for (const c of p.cuts) {
      if (c.feat.calm !== 1 || lockedLine(d, c)) continue;
      const o = c.slots['ornament.count'];
      assert.ok(o.v <= 1, name + ' ' + c.key + ' ' + o.v);
      if (o.from === 'rule') {
        capped++;
        assert.deepEqual(codes(whyOf(d, p, 'cut/' + c.key + ':ornament.count')), ['rule:kime.calm']);
      }
    }
  }
  assert.ok(capped > 3, String(capped));
});

test('the hold with a tempo: a キメ cut\'s hold is one of the still holds that follow the beat', () => {
  let n = 0;
  for (const { name, doc } of corpus.corpus(2, ['16:9', '9:16'], ['basic', 'lrc'])) {
    const d = withPins(markEvery(doc, 3), { 'work:bpm': { v: 120, by: 'user' } });
    const p = plan(d);
    assert.ok(p.beats, name + ' has beats');
    for (const c of kimeCuts(p)) {
      if (lockedLine(d, c) || pinned(c.slots.dwell)) continue;
      assert.ok(K.dwellBeats.includes(c.slots.dwell.v), name + ' ' + c.key + ' ' + c.slots.dwell.v);
      n++;
    }
  }
  assert.ok(n > 10, String(n));
});

test('EXTREME on the cut before a キメ cut: presets tagged hard or fast weigh ×0.2', () => {
  const SH = MV.use('core/shot');
  let seen = 0;
  for (const { name, doc } of corpus.corpus(2, ['16:9', '9:16'], ['basic', 'lrc'])) {
    const d0 = withPins(doc, { 'work:cam.extreme': { v: 1, by: 'user' } });
    const d1 = withPins(markEvery(d0, 3), {});
    const p1 = plan(d1), p0 = plan(d0);
    for (const c of p1.cuts) {
      if (c.feat.calm !== 2 || seen >= 6) continue;
      const w1 = EX.explain(d1, p1, 'cut/' + c.key + ':cam.shot', { registry: CAT });
      const w0 = EX.explain(d0, p0, 'cut/' + c.key + ':cam.shot', { registry: CAT });
      const a1 = new Map((w1.alts || []).map((x) => [x.key, x.w])), a0 = new Map((w0.alts || []).map((x) => [x.key, x.w]));
      let compared = 0;
      for (const [key, w] of a1) {
        if (!SH.XSHOTS[key] || !(a0.get(key) > 0) || !(w > 0)) continue;
        const tags = SH.XSHOTS[key].tags || [];
        const strong = tags.includes('hard') || tags.includes('fast');
        const ratio = w / a0.get(key);
        compared++;
        if (strong) assert.ok(ratio < 0.35, name + ' ' + c.key + ' ' + key + ' ×' + ratio.toFixed(3));
        else assert.ok(ratio > 0.5, name + ' ' + c.key + ' ' + key + ' ×' + ratio.toFixed(3));
      }
      if (compared) seen++;
    }
  }
  assert.ok(seen >= 3, String(seen));
});

test('alignment: a copy right before a キメ cut keeps its source\'s shot (「くり返しの行をそろえる」 copies are not calmed)', () => {
  let n = 0;
  for (const { name, doc } of corpus.corpus(3, ['16:9', '9:16'], ['repeat'])) {
    const p0 = plan(doc);
    const al0 = CA.alignments({ ix: PINS.index(doc.pins) }, p0.cuts) || new Map();
    for (let j = 0; j + 1 < p0.cuts.length; j++) {
      const c = p0.cuts[j], k = p0.cuts[j + 1];
      const src = al0.get(c.key);
      if (!src || !k.line || k.line === c.line || k.line === src.line) continue;
      if (c.slots['cam.shot'].v !== src.slots['cam.shot'].v || c.slots['cam.shot'].v === 'none') continue;
      const d = withPins(doc, { ['line/' + k.line + ':kime']: ON });
      const p = plan(d);
      const c1 = cutOf(p, c.key), s1 = cutOf(p, src.key);
      if (!c1 || c1.feat.calm !== 2 || s1.feat.calm) continue;
      assert.deepEqual(c1.slots['cam.shot'].v, s1.slots['cam.shot'].v, name + ' ' + c.key + ' keeps ' + src.key + '\'s shot');
      if (c.slots.arrange.v === src.slots.arrange.v) assert.equal(c1.slots.arrange.v, s1.slots.arrange.v, name + ' ' + c.key + ' layout');
      n++;
    }
  }
  assert.ok(n >= 4, String(n));
});

test('part filters that allow only flashing screen effects: a キメ cut without 見せ場 takes none (no fallback, no pool-empty)', () => {
  let n = 0;
  for (const { name, doc } of corpus.corpus(2, ['16:9', '9:16'], ['basic', 'lrc'])) {
    const d = Object.assign(withPins(markEvery(doc, 2), { 'work:amount.flash': { v: 1, by: 'user' } }),
      { filters: Object.assign({}, doc.filters, { filter: { only: ['flashPop', 'invertBlink'], deny: null } }) });
    const p = plan(d);
    for (const c of kimeCuts(p)) {
      if (c.impact || lockedLine(d, c)) continue;
      for (let i = 0; i < c.slots['filter.count'].v; i++) {
        const f = c.slots['filter#' + i];
        if (pinned(f)) continue;
        assert.deepEqual([f.v, f.from], ['none', 'rule'], name + ' ' + c.key + ' filter#' + i);
        if (n === 0) assert.deepEqual(codes(whyOf(d, p, 'cut/' + c.key + ':filter#' + i)), ['rule:kime.noFlash']);
        n++;
      }
      assert.ok(!p.warnings.some((w) => w.code === 'pool-empty' && w.cut === c.key), name + ' ' + c.key + ' pool-empty');
    }
  }
  assert.ok(n > 5, String(n));
});

test('the lens right before a キメ cut: where the part filters leave only shaking or beat lenses, one of them (not the fallback)', () => {
  let n = 0;
  for (const { name, doc } of corpus.corpus(2, ['16:9'], ['basic', 'lrc'])) {
    const d = Object.assign(markEvery(doc, 3), { filters: Object.assign({}, doc.filters, { lens: { only: ['handHeld', 'beatZoom'], deny: null } }) });
    const p = plan(d);
    for (const c of p.cuts) {
      if (c.feat.calm !== 2 || lockedLine(d, c) || pinned(c.slots.lens)) continue;
      assert.ok(['handHeld', 'beatZoom'].includes(c.slots.lens.v) && c.slots.lens.from === 'auto', name + ' ' + c.key + ' ' + c.slots.lens.v);
      n++;
    }
  }
  assert.ok(n > 5, String(n));
});

test('carry: the camera never carries a framing into a キメ cut (its hit is a fresh framing)', () => {
  const LINES = ['あさやけの/まちを/ぬけて/とおくの/うみまで/*はしっていく*', 'かぜにのって/ひかりのなかを/どこまでも/*とんでいけ*',
    'ゆめのつづきを/みにいこう/あしたの/*むこうがわへ*', 'ちいさな こえで うたう', 'しずかな/よるの/まちかどで/きみを/*まっている*'];
  let moving = 0;
  for (let seed = 1; seed <= 12; seed++) {
    for (const aspect of ['9:16', '1:1']) {
      const pins = {};
      LINES.forEach((_, i) => { if (i !== 3) pins['line/r' + (i + 1) + ':kime'] = ON; });
      const p = plan(lyricDoc(LINES, { aspect, seed: seed * 7777, moodSeed: seed * 31, pins }));
      p.cuts.forEach((c, j) => {
        if (!c.feat.kime || j === 0 || p.cuts[j - 1].line !== c.line) return;
        const s = c.slots['cam.shot'];
        assert.ok(!(s.p && s.p.carry), aspect + '#' + seed + ' ' + c.key + ' carries a framing');
        if (moves(s.v) && moves(p.cuts[j - 1].slots['cam.shot'].v)) moving++;
      });
    }
  }
  assert.ok(moving >= 5, 'second pieces that move after a moving piece: ' + moving);
});

test('stage 6: the seam of 「くり返しの行をそろえる」 is not copied into a キメ cut or out of one', () => {
  const doc = corpus.project('repeat').doc;
  const p0 = plan(doc);
  const al = CA.alignments({ ix: PINS.index(doc.pins) }, p0.cuts) || new Map();
  let into = 0, out = 0;
  for (const B of p0.cuts) {
    const S0 = al.get(B.key);
    const i = p0.cuts.indexOf(B);
    if (!S0 || !B.line || p0.cuts.indexOf(S0) <= 0 || i <= 0) continue;
    // the source's seam pinned: the copy takes it while nothing is キメ
    const pinS = { ['cut/' + S0.key + ':seam']: { v: 'blendDissolve', by: 'user', sig: S0.text } };
    const d0 = withPins(doc, pinS);
    const q0 = plan(d0);
    const b0 = cutOf(q0, B.key);
    if (!b0 || b0.seamIn < 0 || q0.seams[b0.seamIn].slot.v !== 'blendDissolve' || pinned(q0.seams[b0.seamIn].slot)) continue;
    // both copies キメ: the copy's seam is the hard cut into a キメ cut
    if (into < 2) {
      const d1 = withPins(d0, { ['line/' + B.line + ':kime']: ON, ['line/' + S0.line + ':kime']: ON });
      const q1 = plan(d1);
      const b1 = cutOf(q1, B.key);
      if (b1 && b1.feat.kime) {
        assert.equal(b1.seamIn, -1, B.key + ' copies a transition into a キメ cut');
        assert.deepEqual(codes(whyOf(d1, q1, 'cut/' + B.key + ':seam')), ['rule:kime.seam']);
        into++;
      }
    }
    // the cut before the copy marked (another line): the hard cut out of it
    const A = p0.cuts[i - 1];
    if (out < 2 && A.line && A.line !== B.line && A.line !== S0.line && !B.impact) {
      const d2 = withPins(d0, { ['line/' + A.line + ':kime']: ON });
      const q2 = plan(d2);
      const b2 = cutOf(q2, B.key), a2 = q2.cuts[q2.cuts.indexOf(b2) - 1];
      if (b2 && a2 && a2.feat.kime) {
        assert.equal(b2.seamIn, -1, B.key + ' copies a transition out of a キメ cut');
        out++;
      }
    }
  }
  assert.ok(into >= 1 && out >= 1, into + ' ' + out);
});

test('pins on the pieces: a pin without a sig on a former piece does not take over the キメ cut', () => {
  const srcs = ['あさの ひかり', 'ゆうやけ/そらの/むこうへ', 'よるの しじま'];
  const doc = lyricDoc(srcs, { pins: { 'cut/r2~4:arrange': { v: 'centerAnchor', by: 'user' }, 'line/r2:kime': ON } });
  const p = plan(doc);
  const c = cutOf(p, 'r2~0');
  assert.ok(c.feat.kime && K.arrange.includes(c.slots.arrange.v), c.slots.arrange.v);
  assert.ok(p.warnings.some((w) => w.code === 'shadowed-pin' && w.path === 'cut/r2~4:arrange'));
});

test('orientation: a pinned orientation wins; across the short side はみ出し takes at most 10 cells', () => {
  const twelve = 'あおいそらのしたできみを';          // 12 cells, kana: long pseudo-words
  assert.equal(S.cells(twelve), 12);
  for (const [aspect, orient] of [['16:9', 'v'], ['9:16', 'h']]) {
    const d = lyricDoc(['はじまりの うた', twelve, 'おわりの うた'], { aspect, pins: { 'line/r2:kime': ON, 'work:orient': { v: orient, by: 'user' } } });
    const p = plan(d);
    const k = kimeCuts(p)[0];
    assert.equal(k.slots.orient.v, orient, aspect);
    assert.ok(k.feat.cells <= K.bleedAcross || k.slots.arrange.v !== 'edgeBleed', aspect + ' ' + k.feat.cells + ' ' + k.slots.arrange.v);
  }
  assert.deepEqual([KI.bleedMax('16:9', 'h'), KI.bleedMax('16:9', 'v'), KI.bleedMax('9:16', 'v'), KI.bleedMax('9:16', 'h'), KI.bleedMax('1:1', 'v')],
    [12, 10, 12, 10, 12]);
});

// --- the golden --------------------------------------------------------------------------------------------------------------------

test('the キメ golden: plan hashes of tests/golden/project_kime.json', () => {
  const file = path.join(__dirname, '..', 'golden', 'project_kime.json');
  const golden = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const { name, doc } of KD.goldenDocs()) assert.equal(plan(doc).hash, golden.plans[name], name);
});
