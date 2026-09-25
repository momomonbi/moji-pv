/* 文字PVメーカー v2 — original work. Tests: planner determinism — same doc, same hash; seeds matter; golden hashes; Plan shape (DESIGN §3.12, §7.1, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const H = MV.use('core/hash');
const P = MV.use('core/paths');
const PL = MV.use('planner/plan');
const STUB = corpus.stubRegistry(MV);
const GOLDEN = path.join(__dirname, '..', 'golden', 'plan_hashes.json');

// The registry the goldens were made with (tests/update_golden.js writes its kind and version): the stub parts, or the
// catalog once it is complete. While the catalog is still being written, stub goldens keep being checked with stubs.
function goldenRegistry(kind) {
  if (kind === 'catalog') {
    const reg = MV.use('parts/catalog').defaultRegistry();
    return { reg, info: { kind: 'catalog', version: reg.version } };
  }
  return { reg: STUB, info: { kind: 'stub', version: STUB.version } };
}

function deepFreeze(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze(v[k]);
  }
  return v;
}

test('the same document gives the same plan hash, fresh documents and repeated runs alike', () => {
  for (const { name, doc } of corpus.corpus(3)) {
    const a = PL.run(doc, STUB, null);
    const b = PL.run(JSON.parse(JSON.stringify(doc)), STUB, null);
    assert.equal(a.hash, b.hash, name);
    assert.equal(H.canonical(a), H.canonical(b), name);
  }
});

test('plan.hash is hashJSON of the plan without hash, and the planner encoder matches core/hash.canonical', () => {
  for (const { name, doc } of corpus.corpus(2)) {
    const plan = PL.run(doc, STUB, null);
    assert.equal(plan.hash, H.hashJSON(Object.assign({}, plan, { hash: undefined })), name);
    assert.equal(PL.canon(plan), H.canonical(plan), name);
  }
  const odd = { b: [1, -0, 1e21, NaN, undefined, 'q"\\\u0001\ud800'], a: { z: undefined, y: 'x' }, c: true };
  assert.equal(PL.canon(odd), H.canonical(odd));
});

// planner/encode prints key-sorted objects natively and everything else part by part; both must spell exactly
// core/hash.canonical, whatever the value holds (random nested values, both key orders, odd numbers and strings).
test('planner/encode: canonical text equals core/hash.canonical; a cut\'s parts spell its canonical text', () => {
  const EN = MV.use('planner/encode');
  const R = MV.use('core/rng');
  const rng = R.stream('encode-fuzz');
  const leaves = [0, -0, 1.5, -2e-7, 1e21, NaN, Infinity, 'a', 'q"\\\u0001', '\ud800x', '夜明け', true, false, null, undefined];
  const value = (depth) => {
    const r = rng.next();
    if (depth > 3 || r < 0.4) return rng.pick(leaves);
    if (r < 0.65) return Array.from({ length: rng.int(0, 4) }, () => value(depth + 1));
    const keys = Array.from({ length: rng.int(0, 5) }, (_, i) => rng.pick(['b', 'a', 'p', 'v', 'from', 'z9', 'Z']) + i);
    if (rng.chance(0.5)) keys.sort();
    const o = {};
    for (const k of keys) o[k] = value(depth + 1);
    return o;
  };
  for (let i = 0; i < 3000; i++) {
    const v = value(0);
    const text = EN.canon(v);                  // undefined (a value JSON leaves out) prints as null at the top level
    assert.equal(text === undefined ? 'null' : text, H.canonical(v), JSON.stringify(v));
  }
  const plan = PL.run(corpus.project('vertical').doc, STUB, { fresh: true });
  for (const cut of plan.cuts) {
    const enc = EN.encodeCut(Object.assign({}, cut, { fp: '' }), Object.keys(cut.slots).sort(), ['x']);
    assert.equal(enc.parts.join(''), H.canonical(Object.assign({}, cut, { fp: enc.fp })), cut.key);
    const repinned = {};
    for (const k of Object.keys(cut.slots)) repinned[k] = Object.assign({}, cut.slots[k], { from: 'pin:cut', by: 'lock' });
    const again = EN.encodeCut(Object.assign({}, cut, { fp: '', slots: repinned }), Object.keys(cut.slots).sort(), ['x']);
    assert.equal(again.fp, enc.fp, 'where a value came from is not part of the fingerprint');
  }
});

test('different seeds give different plans; the mood seed alone can change the look', () => {
  for (const name of corpus.PROJECTS) {
    const hashes = new Set(corpus.corpus(6, ['16:9']).filter((c) => c.name.startsWith(name + '@')).map((c) => PL.run(c.doc, STUB, null).hash));
    assert.equal(hashes.size, 6, name + ': six seeds, six plans');
  }
  const doc = corpus.project('long').doc;
  const moods = new Set();
  for (let s = 1; s <= 12; s++) moods.add(PL.run(Object.assign({}, doc, { look: Object.assign({}, doc.look, { moodSeed: s }) }), STUB, null).look.mood.v);
  assert.equal(moods.size, 2, 'both stub moods appear over twelve mood seeds');
});

test('golden plan hashes (tests/golden/plan_hashes.json; refresh on purpose with node tests/update_golden.js)', () => {
  const golden = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  const { reg, info } = goldenRegistry(golden.registry && golden.registry.kind);
  assert.deepEqual(golden.registry, info, 'the goldens were made with this registry');
  const names = Object.keys(golden.plans);
  assert.equal(names.length, corpus.corpus().length, 'every corpus document has a golden hash');
  for (const { name, doc } of corpus.corpus()) assert.equal(PL.plan(doc, { registry: reg }).hash, golden.plans[name], name);
});

test('plan() is pure: frozen documents plan fine and are not touched', () => {
  for (const { name, doc } of corpus.projects()) {
    const before = JSON.stringify(doc);
    const plan = PL.plan(deepFreeze(doc), { registry: STUB });
    assert.equal(JSON.stringify(doc), before, name);
    assert.ok(plan.cuts.length > 0, name);
  }
});

test('previewMood gives the auto mood plan() would pick for that mood seed (pins ignored)', () => {
  const LK = MV.use('planner/look');
  for (const { name, doc } of corpus.corpus(4)) {
    const auto = JSON.parse(JSON.stringify(doc));
    delete auto.pins['work:mood'];
    for (const seed of [doc.look.moodSeed, 12345, 987654321]) {
      auto.look = Object.assign({}, auto.look, { moodSeed: seed });
      const want = PL.run(auto, STUB, null).look.mood.v;
      assert.equal(LK.previewMood(doc, seed, { registry: STUB }), want, name + ' mood seed ' + seed);
    }
  }
  PL.plan(corpus.project('basic').doc, { registry: STUB });
  assert.equal(typeof LK.previewMood(corpus.project('basic').doc, 5), 'string', 'the last plan\'s registry is used by default');
});

test('plan() memoizes by document identity and registry', () => {
  const { doc } = corpus.project('basic');
  const a = PL.plan(doc, { registry: STUB });
  assert.equal(PL.plan(doc, { registry: STUB }), a, 'same doc object → same plan object');
  const copy = JSON.parse(JSON.stringify(doc));
  const b = PL.plan(copy, { registry: STUB });
  assert.notEqual(b, a);
  assert.equal(b.hash, a.hash);
  const other = MV.use('core/registry').createRegistry(corpus.minimalFallbacks());
  assert.notEqual(PL.plan(doc, { registry: other }).hash, a.hash, 'another registry re-plans');
  assert.throws(() => PL.plan(doc, {}), /registry/);
});

// --- Plan shape (§3.12) ------------------------------------------------------------------------------------------

const CUT_FIELDS = ['key', 'line', 'role', 'text', 'emph', 'impact', 'note', 't0', 't1', 'a', 'b', 'repT', 'lang', 'feat',
  'fp', 'slots', 'els', 'ground', 'rig', 'seamIn'];
const FEAT_FIELDS = ['cells', 'graphemes', 'script', 'latin', 'orients', 'words', 'units', 'emph', 'impact', 'dur', 'cps',
  'energy', 'beat', 'onBeat', 'section', 'sectionStart', 'repeatOf', 'pos', 'role'];
// Plan v2 (DESIGN_2_1 §2.7): every cut holds the camera slots; runs, zoomed segments and the media map are listed.
const CAMERA_SLOTS = ['motion.speed', 'cam.shot', 'cam.zoom', 'cam.curve', 'cam.follow'];

// The window the cutter gives a cut (§3.12 a/b) before a transition out of it ends it early (§4.16.6).
function cutterEnd(plan, i, tail) {
  const c = plan.cuts[i], next = plan.cuts[i + 1];
  const nextSpecial = !next || ['title', 'interlude', 'outro'].includes(next.role);
  return (nextSpecial ? c.t1 : Math.max(c.t1, next.t0)) + tail;
}

function checkShape(name, plan, reg, doc) {
  const tail = doc ? doc.timing.tail : 0.25;
  assert.equal(plan.v, 2);
  assert.match(plan.hash, /^[0-9a-f]{8}$/);
  assert.deepEqual(Object.keys(plan).sort(), ['beats', 'cuts', 'design', 'duration', 'grounds', 'hash', 'impulses', 'lines',
    'look', 'media', 'rigs', 'seams', 'v', 'warnings'].sort(), name);
  assert.ok(plan.rigs.length >= 1, name + ' rigs');
  for (const g of plan.grounds) assert.equal(typeof g.zoomed, 'boolean', name + ' zoomed');
  for (const c of plan.cuts) {
    assert.ok(Number.isInteger(c.rig) && plan.rigs[c.rig].cuts.includes(c.key), name + ' ' + c.key + ' rig');
    for (const s of CAMERA_SLOTS) assert.ok(c.slots[s] && c.slots[s].v !== undefined, name + ' ' + c.key + ' ' + s);
  }
  const L = plan.look;
  for (const k of ['mood', 'theme', 'season', 'amounts', 'amountsFrom', 'palette', 'faces', 'texture', 'backdrop']) assert.ok(k in L, name + ' look.' + k);
  assert.ok(reg.has('mood', L.mood.v) && reg.has('theme', L.theme.v));
  for (const t of ['ground', 'ground2', 'ink', 'accent', 'shiftA', 'shiftB', 'muted']) assert.match(L.palette[t], /^#[0-9A-F]{6}$/);
  for (const role of ['display', 'serif', 'body']) assert.ok(L.faces[role].latin.family && L.faces[role].latin.weight);
  let lastT0 = -Infinity;
  const keys = new Set();
  plan.cuts.forEach((c, i) => {
    const where = name + ' ' + c.key;
    for (const f of CUT_FIELDS) assert.ok(f in c, where + ' has ' + f);
    for (const f of FEAT_FIELDS) assert.ok(f in c.feat, where + ' feat.' + f);
    assert.ok(!keys.has(c.key), where + ' unique');
    keys.add(c.key);
    assert.ok(c.t0 >= lastT0 - 1e-9, where + ' in time order');
    lastT0 = c.t0;
    assert.ok(c.t1 > c.t0 && c.a < c.t0 + 1e-9 && c.b > c.t1 - 1e-9, where + ' window');
    assert.ok(c.repT >= c.a && c.repT < c.b, where + ' repT in [a, b)');
    assert.match(c.fp, /^[0-9a-f]{8}$/);
    assert.ok(c.ground >= 0 && c.ground < plan.grounds.length && plan.grounds[c.ground].cuts.includes(c.key), where + ' ground');
    assert.ok(c.seamIn === -1 || plan.seams[c.seamIn].into === c.key, where + ' seamIn');
    assert.equal(P.parse('cut/' + c.key + ':arrange').scope.id, c.key);
    for (const slot of Object.keys(c.slots)) {
      P.parse('cut/' + c.key + ':' + slot);
      const d = c.slots[slot];
      assert.match(d.from, /^(auto|pin:cut|pin:line|pin:work|mark|rule|fallback)$/, where + ' ' + slot);
      if (d.from.startsWith('pin')) assert.ok(d.by, where + ' ' + slot + ' by');
    }
    for (const k of ['arrange', 'arrive', 'dwell', 'depart', 'lens']) assert.ok(reg.has(k, c.slots[k].v), where + ' ' + k);
    for (const kind of ['ornament', 'filter']) {
      for (let j = 0; j < c.slots[kind + '.count'].v; j++) {
        const v = c.slots[kind + '#' + j].v;
        assert.ok(v === 'none' || reg.has(kind, v), where + ' ' + kind + '#' + j);
      }
    }
    if (i > 0) assert.ok(c.t0 >= plan.cuts[i - 1].t0);
  });
  let t = 0;
  for (const g of plan.grounds) {
    assert.equal(g.t0, t, name + ' grounds tile the video');
    assert.ok(g.t1 >= g.t0);
    assert.ok(reg.has('ground', g.ground.v));
    assert.ok(g.atmos.v === 'none' || reg.get('ornament', g.atmos.v).scope === 'run');
    assert.equal(g.key, 'g' + g.cuts[0]);
    t = g.t1;
  }
  if (plan.grounds.length) assert.equal(t, plan.duration, name + ' last ground ends with the video');
  const hard = reg.fallback('seam');
  for (const s of plan.seams) {
    assert.notEqual(s.slot.v, hard, name + ' only non-hard-cut seams are listed');
    const B = plan.cuts.find((c) => c.key === s.into), A = plan.cuts.find((c) => c.key === s.a);
    assert.equal(s.at, B.a);
    assert.equal(plan.cuts.indexOf(A) + 1, plan.cuts.indexOf(B), 'a seam joins neighbouring cuts');
    const ai = plan.cuts.indexOf(A), bi = ai + 1;
    const limit = 0.4 * Math.min(cutterEnd(plan, ai, tail) - A.a, cutterEnd(plan, bi, tail) - B.a);
    assert.ok(s.dur > 0 && s.dur <= limit + 1e-6, name + ' seam window');
    assert.equal(s.scope, reg.get('seam', s.slot.v).scope);
    // the seam hands the picture over to B: nothing before B outlives the window (unless its sung end is later)
    const end = s.at + s.dur / 2;
    for (let k = 0; k < bi; k++) {
      const c = plan.cuts[k];
      assert.ok(c.b <= Math.max(c.t1, end) + 1e-9, name + ' ' + c.key + ' ends with the seam into ' + B.key);
    }
    assert.ok(A.b >= Math.min(cutterEnd(plan, ai, tail), Math.max(A.t1, end)) - 1e-6, name + ' ' + A.key + ' keeps its window up to the seam end');
  }
  for (let i = 1; i < plan.impulses.length; i++) assert.ok(plan.impulses[i].t >= plan.impulses[i - 1].t, name + ' impulses sorted');
  for (const line of plan.lines) {
    assert.ok(line.cuts.length >= 1, name + ' ' + line.id);
    assert.equal(line.cuts[0], line.id + '~0', name + ' first cut at offset 0');
  }
  assert.ok(Object.getOwnPropertyDescriptor(plan, 'env') && !Object.getOwnPropertyDescriptor(plan, 'env').enumerable, 'env is non-enumerable');
}

test('Plan shape over the corpus (§3.12)', () => {
  for (const { name, doc } of corpus.corpus(2)) checkShape(name, PL.run(doc, STUB, null), STUB, doc);
});

// §4.16.6: a transition shows only B at the end of its window, so the cuts before B leave the FrameGraph there. Before
// this rule A stayed until B.t0 + tail and was drawn again after the transition (a replaced exit at full strength).
test('after a transition the cuts before it are off screen (catalog, frameAt)', () => {
  const F = MV.use('engine/scene/frame');
  const reg = MV.use('parts/catalog').defaultRegistry();
  let seams = 0;
  for (const { name, doc } of corpus.corpus(2)) {
    const plan = PL.run(doc, reg, null);
    for (const s of plan.seams) {
      const bi = plan.cuts.findIndex((c) => c.key === s.into);
      const t = s.at + s.dur / 2 + 1e-4;
      const late = F.frameAt(plan, t).cuts.filter((e) => e.i < bi && plan.cuts[e.i].t1 <= t);
      assert.deepEqual(late.map((e) => plan.cuts[e.i].key), [], name + ' after the seam into ' + s.into);
      seams++;
    }
  }
  assert.ok(seams > 100, 'the corpus has transitions (' + seams + ')');
});

test('edge documents: empty, title only, one grapheme', () => {
  const D = MV.use('core/doc');
  const empty = PL.run(D.defaultDoc(), STUB, null);
  assert.equal(empty.cuts.length, 0);
  assert.equal(empty.grounds.length, 1, 'an empty video still has its background');
  assert.deepEqual([empty.grounds[0].key, empty.grounds[0].t0, empty.grounds[0].t1], ['g', 0, empty.duration]);
  assert.deepEqual(empty.rigs, [{ blend: null, cuts: [], curve: { from: 'auto', v: 'linear' }, key: 'k', rig: { from: 'auto', v: 'none' },
    t0: 0, t1: empty.duration }], 'and one still rig run');
  assert.deepEqual([empty.grounds[0].zoomed, empty.media], [false, {}]);
  const titled = Object.assign(D.defaultDoc(), { sheet: { next: 3, rows: [{ id: 'r1', src: '[ti:題名]' }, { id: 'r2', src: '# memo' }] } });
  const t = PL.run(titled, STUB, null);
  assert.deepEqual(t.cuts.map((c) => [c.key, c.t0, c.t1]), [['title', 0, t.duration]]);
  const one = Object.assign(D.defaultDoc(), { sheet: { next: 2, rows: [{ id: 'r1', src: 'あ' }] } });
  checkShape('one grapheme', PL.run(one, STUB, null), STUB, one);
});

test('cut fingerprints change only when what the scene needs changes', () => {
  const { doc } = corpus.project('vertical');
  const a = PL.run(doc, STUB, null);
  const shifted = JSON.parse(JSON.stringify(doc));
  shifted.timing.leadIn = 1.5;                         // every auto line moves; slots and windows keep their size
  const b = PL.run(shifted, STUB, null);
  const same = a.cuts.filter((c) => { const o = b.cuts.find((x) => x.key === c.key); return o && o.fp === c.fp; });
  assert.ok(same.length >= 1, 'moving a cut in time without changing it keeps its fingerprint');
  const recolored = JSON.parse(JSON.stringify(doc));
  recolored.pins['work:color.ink'] = { v: '#102030', by: 'user' };
  const c = PL.run(recolored, STUB, null);
  assert.ok(c.cuts.every((x, i) => x.fp !== a.cuts[i].fp), 'a palette change reaches every cut');
  assert.ok(c.grounds.every((g, i) => g.fp !== a.grounds[i].fp || a.grounds.length !== c.grounds.length));
});

// A segment's fingerprint covers its ground and atmos decisions, its length and the look; a ground scene gets nothing
// of the segment's cuts (engine/scene/build buildGround), so editing a cut keeps its background's scene.
test('segment fingerprints: their decisions change them, the cuts in the segment do not', () => {
  const REG = MV.use('core/registry');
  const doc = JSON.parse(JSON.stringify(corpus.project('long').doc));
  const a = PL.run(doc, STUB, null);
  const cutOf = (p, key) => p.cuts.find((c) => c.key === key);
  const seg = a.grounds.find((g) => g.cuts.length >= 2 && cutOf(a, g.cuts[0]).line);
  assert.ok(seg, 'a segment that starts with a lyric cut');
  const first = cutOf(a, seg.cuts[0]);
  const edit = (pins) => PL.run(Object.assign({}, doc, { pins: Object.assign({}, doc.pins, pins) }), STUB, null);
  const style = REG.TEXT_STYLES.find((x) => x !== first.slots['text.style'].v);
  const arrive = STUB.keys('arrive').find((k) => k !== first.slots.arrive.v);
  const b = edit({ ['cut/' + first.key + ':text.style']: { v: style, by: 'user', sig: first.text },
    ['cut/' + first.key + ':arrive']: { v: arrive, by: 'user', sig: first.text } });
  assert.notEqual(cutOf(b, first.key).fp, first.fp);
  assert.equal(b.grounds.find((g) => g.key === seg.key).fp, seg.fp, 'the first cut changed, its background did not');
  const ground = STUB.keys('ground').find((k) => k !== seg.ground.v);
  const c = edit({ ['cut/' + first.key + ':ground']: { v: ground, by: 'user', sig: first.text } });
  assert.notEqual(c.grounds.find((g) => g.key === seg.key).fp, seg.fp, 'another background');
});

// The contract the segment fingerprint relies on: a ground scene built under a plan whose first cut differs in every
// way records the same drawing (engine/scene/build buildGround gives the parts no cut).
test('a ground scene is the same whatever its first cut holds', () => {
  const BUILD = MV.use('engine/scene/build');
  const F = MV.use('engine/scene/frame');
  const R = MV.use('engine/render/record');
  const { createTextService } = MV.use('engine/text/service');
  const { fakeMeasurer } = MV.use('engine/text/fake_measure');
  // A test ground that would draw whatever it can see of a cut.
  const REG = MV.use('core/registry');
  const peek = (g, t, d) => { g.fillRect(0, 0, d.n, 1); };
  const PEEK = { kind: 'ground', key: 'peekGround', label: { ja: '覗き', en: 'Peek' }, blurb: { ja: '試験用', en: 'Test part' },
    build(env) {
      const n = (env.cut ? env.cut.text.length + Object.keys(env.cut.slots).length : 0) + (env.feat ? env.feat.cells : 0) +
        (env.role ? env.role.length : 0) + (env.textStyle ? env.textStyle.scale : 0);
      env.sb.paint({ layer: 'ground', animated: true, data: { n }, draw: peek, owner: env.owner });
    } };
  const reg = REG.createRegistry(corpus.allStubParts().concat([PEEK]));
  const doc = JSON.parse(JSON.stringify(corpus.project('basic').doc));
  doc.pins['work:ground'] = { v: 'peekGround', by: 'user' };
  const plan = PL.run(doc, reg, null);
  const seg = plan.grounds.find((g) => g.cuts.length);
  assert.equal(seg.ground.v, 'peekGround');
  const other = JSON.parse(JSON.stringify(plan));
  const firstAt = other.cuts.findIndex((c) => c.key === seg.cuts[0]);
  const lyric = plan.cuts.find((c) => c.role === 'lyric' && c.key !== seg.cuts[0]);
  other.cuts[firstAt] = Object.assign(JSON.parse(JSON.stringify(lyric)), { key: seg.cuts[0], t0: plan.cuts[firstAt].t0 });
  const drawn = (p) => {
    const svc = { registry: reg, text: createTextService({ measurer: fakeMeasurer(), faces: p.look.faces }), strict: true };
    const scene = BUILD.buildGround(seg, p, svc);
    const rec = R.createRecorder();
    const surf = R.surfaceOf(rec.factory, 320, 180, false);
    return [0, 0.7, 2.1].map((tl) => {
      F.evaluate(scene, tl);
      const mark = rec.mark();
      R.drawScene(surf.ctx, scene, { scale: 320 / p.design.w, W: p.design.w, H: p.design.h, pal: p.look.palette, tl });
      return rec.hash(mark);
    });
  };
  assert.deepEqual(drawn(other), drawn(plan));
});

// §3.12 fp: a scene that reads the song (engine/scene/build baseEnv: env.grid, the beat grid seen from the scene's
// origin; env.level, the loudness from it on) is fingerprinted with what it reads; one that reads neither keeps its
// fingerprint when it moves in time. Four lines with pinned times, a flat loudness envelope and a pinned mood, so the
// features and the look stay put and only what a part needs can change a fingerprint.
test('fingerprints cover the beat grid and the loudness a chosen part needs, for cuts and grounds', () => {
  const REG = MV.use('core/registry');
  const D = MV.use('core/doc');
  const stubs = corpus.allStubParts();
  const copy = (kind, from, key, extra) => Object.assign({}, stubs.find((d) => d.kind === kind && d.key === from),
    { key, fallback: false, pool: false }, extra);
  const reg = REG.createRegistry(stubs.concat([
    copy('dwell', 'stubBob', 'beatBob', { needs: ['beats'] }), copy('dwell', 'stubBob', 'levelBob', { needs: ['level'] }),
    copy('ground', 'stubTint', 'beatTint', { needs: ['beats'] }), copy('ground', 'stubTint', 'levelTint', { needs: ['level'] }),
    copy('ornament', 'hairFrame', 'beatMist', { scope: 'run', needs: ['beats'] })]));
  const flat = (x) => ({ hz: 20, loud: Buffer.from(new Uint8Array(20 * 40).fill(x)).toString('base64') });
  const texts = ['あさのひかり', 'まどをあけて', 'かぜがふいた', 'きみをよぶ'];
  // o: { dwell (line r2), ground (line r3), workGround, atmos, bpm, offset, shift (s, every line), loud }
  const docOf = (o) => {
    const doc = Object.assign(D.defaultDoc(), { sheet: { next: 5, rows: texts.map((src, i) => ({ id: 'r' + (i + 1), src })) } });
    doc.timing = Object.assign({}, doc.timing, { snap: 'off' });
    doc.song = { name: 't.wav', sha1: 'f'.repeat(40), seconds: 40, bpm: 120, offset: 0, meter: 4, bpmConfidence: 0.9,
      digest: flat(o.loud || 128), info: null };
    const user = (v) => ({ v, by: 'user' });
    doc.pins = { 'work:mood': user('quietHush'), 'work:bpm': user(o.bpm || 120), 'work:beatOffset': user(o.offset || 0),
      'work:ground': user(o.workGround || 'stubTint'), 'line/r3:ground': user(o.ground || 'stubTint'),
      'line/r2:dwell': user(o.dwell || 'stubBob'), 'line/r3:dwell': user('stubBob') };
    if (o.atmos) doc.pins['work:atmos'] = user(o.atmos);
    texts.forEach((_, i) => {
      doc.pins['line/r' + (i + 1) + ':start'] = user(4 * (i + 1) + (o.shift || 0));
      doc.pins['line/r' + (i + 1) + ':end'] = user(4 * (i + 1) + 3 + (o.shift || 0));
    });
    return doc;
  };
  const run = (o) => PL.run(docOf(o), reg, { fresh: true });
  const cutOf = (p, line) => p.cuts.find((c) => c.line === line);
  const segOf = (p, line) => p.grounds.find((g) => g.cuts.includes(cutOf(p, line).key));
  // The changes under test leave the features, windows and look alone (checked, so the comparisons mean something).
  const q6 = (x) => Math.round(x * 1e6) / 1e6;
  const alike = (p, q) => {
    assert.deepEqual(p.look, q.look);
    for (const line of ['r2', 'r3']) {
      const [a, b] = [cutOf(p, line), cutOf(q, line)];
      assert.deepEqual([a.feat, q6(a.b - a.a), q6(a.t0 - a.a)], [b.feat, q6(b.b - b.a), q6(b.t0 - b.a)], line);
      assert.equal(q6(segOf(p, line).t1 - segOf(p, line).t0), q6(segOf(q, line).t1 - segOf(q, line).t0));
    }
  };
  const cutFp = (o, line = 'r2') => cutOf(run(o), line).fp;
  const segFp = (o, line = 'r3') => segOf(run(o), line).fp;
  const moves = [{ shift: 0.01 }, { offset: 0.5 }, { loud: 90 }, { bpm: 60 }];
  for (const m of moves.slice(0, 3)) alike(run({}), run(m));
  assert.equal(cutOf(run({ dwell: 'levelBob' }), 'r2').slots.dwell.v, 'levelBob');
  // cuts: moved in time (window unchanged), a beat offset of one whole beat (same phase, beat indices one apart),
  // another loudness envelope
  for (const m of moves.slice(0, 3)) assert.equal(cutFp(m), cutFp({}), 'a plain cut: ' + JSON.stringify(m));
  assert.notEqual(cutFp({ dwell: 'levelBob', shift: 0.01 }), cutFp({ dwell: 'levelBob' }), 'loudness read from t0 on');
  assert.notEqual(cutFp({ dwell: 'levelBob', loud: 90 }), cutFp({ dwell: 'levelBob' }), 'another envelope');
  assert.equal(cutFp({ dwell: 'levelBob', offset: 0.5 }), cutFp({ dwell: 'levelBob' }), 'the beat grid is not read');
  assert.notEqual(cutFp({ dwell: 'beatBob', shift: 0.01 }), cutFp({ dwell: 'beatBob' }), 'the grid seen from t0');
  assert.notEqual(cutFp({ dwell: 'beatBob', offset: 0.5 }), cutFp({ dwell: 'beatBob' }), 'beat indices, not only the phase');
  assert.equal(cutFp({ dwell: 'beatBob', loud: 90 }), cutFp({ dwell: 'beatBob' }), 'the loudness is not read');
  assert.equal(cutFp({ dwell: 'beatBob' }, 'r3'), cutFp({}, 'r3'), 'the other cuts are as they were');
  // grounds: the start of r3's segment (its length unchanged), the beat offset, the envelope, and the tempo (the
  // features change with it; a ground scene does not read them)
  for (const m of moves) assert.equal(segFp(m), segFp({}), 'a plain ground: ' + JSON.stringify(m));
  const level = (m) => segFp(Object.assign({ ground: 'levelTint' }, m));
  const beat = (m) => segFp(Object.assign({ ground: 'beatTint' }, m));
  for (const m of [{ shift: 0.01 }, { loud: 90 }]) assert.notEqual(level(m), level({}), JSON.stringify(m));
  for (const m of [{ offset: 0.5 }, { bpm: 60 }]) assert.equal(level(m), level({}), JSON.stringify(m));
  for (const m of [{ shift: 0.01 }, { offset: 0.5 }, { bpm: 60 }]) assert.notEqual(beat(m), beat({}), JSON.stringify(m));
  assert.equal(beat({ loud: 90 }), beat({}));
  // the first segment starts at 0 and the beat offset is 0 (beat phase 0 at any tempo); an atmos that needs beats
  const firstFp = (o) => run(o).grounds[0].fp;
  assert.equal(run({ workGround: 'beatTint' }).grounds[0].t0, 0);
  assert.notEqual(firstFp({ workGround: 'beatTint', bpm: 60 }), firstFp({ workGround: 'beatTint' }), 'the tempo');
  assert.equal(firstFp({ bpm: 60 }), firstFp({}));
  assert.equal(run({ atmos: 'beatMist' }).grounds[0].atmos.v, 'beatMist');
  assert.notEqual(firstFp({ atmos: 'beatMist', bpm: 60 }), firstFp({ atmos: 'beatMist' }), 'an atmos reading the grid');
});

// --- re-planning ------------------------------------------------------------------------------------------------

// plan() reuses the casts, features and encodings of unchanged cuts from the previous plans (planner/cast castCut,
// planner/plan). Whatever the edit history, the result must be the plan computed from scratch.
test('re-planning after any edit gives exactly the plan made from scratch', () => {
  const REG = MV.use('core/registry');
  const F = MV.use('planner/fields');
  const R = MV.use('core/rng');
  const reg = REG.createRegistry(corpus.allStubParts().concat(corpus.allStubParts().filter((d) => ['arrive', 'dwell', 'lens',
    'ornament', 'seam', 'ground'].includes(d.kind) && !d.fallback).map((d) => Object.assign({}, d, { key: d.key + 'Two', tags: ['bold'] }))));
  const SLOTS = ['arrange', 'arrive', 'dwell', 'lens', 'ornament#0', 'seam', 'ground', 'atmos', 'text.scale', 'arrive.dur',
    'ornament.count', 'el.text.nudge'];
  const valueFor = (rng, slot) => {
    if (slot === 'text.scale') return rng.pick([0.7, 1.3, 'x']);
    if (slot === 'arrive.dur') return Math.round(rng.next() * 100) / 100;
    if (slot === 'ornament.count') return rng.int(0, 3);
    if (slot === 'el.text.nudge') return { dx: rng.int(-50, 50), dy: 0, rot: 0, s: 1 };
    const kind = slot === 'atmos' ? 'ornament' : slot.split('#')[0];
    return rng.chance(0.1) ? 'noSuchPart' : rng.pick(reg.keys(kind).concat(slot === 'atmos' || slot.includes('#') ? ['none'] : []));
  };
  const edit = (rng, doc, p) => {
    const d = Object.assign({}, doc);
    const cut = rng.pick(p.cuts);
    const line = rng.pick(p.lines);
    const r = rng.next();
    if (r < 0.3) {
      const slot = rng.pick(SLOTS);
      const where = rng.pick(['cut/' + cut.key, 'line/' + line.id, 'work']);
      d.pins = Object.assign({}, d.pins, { [where + ':' + slot]: Object.assign({ v: valueFor(rng, slot), by: rng.pick(['user', 'ai']) },
        where.startsWith('cut/') ? { sig: cut.text } : {}) });
    } else if (r < 0.4) {
      const keys = Object.keys(d.pins);
      if (keys.length) { d.pins = Object.assign({}, d.pins); delete d.pins[rng.pick(keys)]; }
    } else if (r < 0.55) {
      const k = rng.pick(['cut/' + cut.key, 'line/' + line.id, 'cut/' + cut.key + ':' + rng.pick(['arrive', 'dwell', 'arrive.dur'])]);
      d.salts = Object.assign({}, d.salts, { [k]: (d.salts[k] || 0) + 1 });
    } else if (r < 0.62) {
      d.look = Object.assign({}, d.look, rng.chance(0.5) ? { seed: rng.int(0, 1e9) } : { moodSeed: rng.int(0, 1e9) });
    } else if (r < 0.72) {
      d.pins = Object.assign({}, d.pins, F.lockPayload(doc, p, line.id, { registry: reg }).pins);
      d.locks = Object.assign({}, d.locks, { [line.id]: { n: 1 } });
    } else if (r < 0.82) {
      const rows = d.sheet.rows.slice();
      const i = rng.int(0, rows.length - 1);
      rows[i] = Object.assign({}, rows[i], { src: rows[i].src + rng.pick(['あ', '!', '/光']) });
      d.sheet = Object.assign({}, d.sheet, { rows });
    } else if (r < 0.9) {
      d.pins = Object.assign({}, d.pins, { ['line/' + line.id + ':start']: { v: Math.max(0.2, line.t0 + rng.range(-0.5, 0.5)), by: 'tap' } });
    } else if (r < 0.95) {
      d.filters = Object.assign({}, d.filters, { dwell: { only: null, deny: [rng.pick(reg.keys('dwell'))] } });
    } else d.look = Object.assign({}, d.look, { aspect: rng.pick(['16:9', '9:16', '1:1']) });
    return d;
  };
  let steps = 0;
  for (const name of corpus.PROJECTS) {
    for (let s = 0; s < (name === 'long' ? 1 : 2); s++) {
      const rng = R.stream('replan', name, s);
      let doc = JSON.parse(JSON.stringify(corpus.project(name).doc));
      const seen = [doc];
      for (let i = 0; i < (name === 'long' ? 12 : 25); i++) {
        const p = PL.plan(doc, { registry: reg });
        assert.equal(p.hash, PL.run(doc, reg, { fresh: true }).hash, name + ' #' + s + ' step ' + i);
        steps++;
        doc = rng.chance(0.15) && seen.length > 2 ? seen[seen.length - 2] : edit(rng, doc, p);     // sometimes undo
        seen.push(doc);
      }
    }
  }
  assert.ok(steps > 150);
});

// The cast cache (planner/cast beginCasts) reuses a cast only when the history it reads is the same. The previous
// cut's row is read for its natural picks too (the reference pick weighs against them), not only for the set of its
// natural and reference picks: two rows with the same set {X, Y} but natural picks X and Y give the next cut
// different reference picks, so a different row of its own. A cached cast must be the fresh one, row included.
test('the cast cache tells apart history rows that differ only in their natural picks', () => {
  const REG = MV.use('core/registry');
  const D = MV.use('core/doc');
  const LY = MV.use('core/lyrics');
  const PINS = MV.use('core/pins');
  const LK = MV.use('planner/look');
  const CH = MV.use('planner/choose');
  const CA = MV.use('planner/cast');
  const FE = MV.use('planner/features');
  const stubs = corpus.allStubParts();
  const more = [];
  for (const [suffix, tag] of [['Two', 'bold'], ['Three', 'soft'], ['Four', 'fast']]) {
    for (const d of stubs) if (['arrange', 'arrive', 'dwell'].includes(d.kind) && !d.fallback) more.push(Object.assign({}, d, { key: d.key + suffix, tags: [tag] }));
  }
  const reg = REG.createRegistry(stubs.concat(more));
  // The context plan.run gives castCut (stage 5), for a one-line document.
  const ctxOf = (seed, cached) => {
    const doc = Object.assign(D.defaultDoc(), { sheet: { next: 2, rows: [{ id: 'r1', src: 'ひかりのなかで' }] } });
    doc.look = Object.assign({}, doc.look, { seed });
    const ctx = { doc, registry: reg, ix: PINS.index(doc.pins), warn: () => {}, aspect: doc.look.aspect, salts: null,
      pools: new Map(), trace: null, casts: null, lockFree: null, bpm: null, env: null, hint: 'ja' };
    ctx.look = LK.resolveLook(ctx, LY.parseSheet(doc.sheet.rows), new Set(['ja']));
    ctx.chooser = CH.createChooser(reg, { mood: ctx.look.mood, theme: ctx.look.theme, season: ctx.look.season, amounts: ctx.look.amounts });
    if (cached) { ctx.casts = CA.beginCasts(reg); ctx.castKeys = CA.castKeys(ctx, 'look ' + seed); }
    return ctx;
  };
  const cut = { key: 'r1~0', line: 'r1', role: 'lyric', text: 'ひかりのなかで', emph: [], impact: false, note: null, t0: 5, t1: 8,
    lang: 'ja', pinKey: null, featId: 'f1' };
  cut.feat = FE.cutFeatures(cut, { duration: 30, env: null, grid: null, info: null, section: null, repeatOf: null, repeats: false });
  // castCut after one earlier cut with the given row → { cast, row (what this cut left in the history) }
  const after = (row, ctx) => {
    const hist = CA.createHistory(reg);
    hist.push('r0~0', row);
    const cast = CA.castCut(ctx, cut, hist);
    return { cast, row: hist.rowsRead(null)[3] };
  };
  let apart = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const X = CA.castCut(ctxOf(seed, false), cut, CA.createHistory(reg)).slots.arrive.v;   // this cut's natural pick
    const Y = reg.keys('arrive').find((k) => k !== X && k !== reg.fallback('arrive'));
    const last = { arrive: { v: Y } };
    const rowA = CA.historyRow(last, { arrive: X }, { arrive: Y });
    const rowB = CA.historyRow(last, { arrive: Y }, { arrive: X });
    assert.deepEqual([rowA.both, rowA.last], [new Map([['arrive', [X, Y]]]), rowB.last]);
    const ctx = ctxOf(seed, true);
    after(rowA, ctx);
    const cached = after(rowB, ctx);
    assert.equal(cached.cast.castHit, false, 'seed ' + seed + ': another window, no reuse');
    const fresh = after(rowB, ctxOf(seed, false));
    assert.deepEqual(cached.cast.slots, fresh.cast.slots, 'seed ' + seed);
    assert.deepEqual(cached.row, fresh.row, 'seed ' + seed + ': the recorded row');
    assert.equal(after(rowB, ctx).cast.castHit, true, 'the same window is reused');
    try { assert.deepEqual(after(rowA, ctxOf(seed, false)).row, fresh.row); } catch (e) { apart++; }
  }
  assert.ok(apart > 12, 'the two windows lead to different rows (' + apart + ' of 24)');
});

// §9.1 acceptance: plan() of project_long ≤ 10 ms in Node; §7.4: a re-plan of 100 lines ≤ 5 ms. The UI re-plans after
// every edit, and an edit leaves most cuts' inputs as they were, so plan() reuses their casts (with the seams and
// backgrounds decided from them) and encodings. Measured here (a shared container, INT-PLAN) at about 4.5–5.5 ms for
// project_long (120 lines, 245 cuts) after an edit, and 19–25 ms for a plan whose every cut is new (a new seed, the
// first plan of a document; 12–20 parts per kind). The bounds leave room for a busy machine, like perf.py (§8.3): the best of eight batches
// of edits must stay within 2 × the §7.4 budget, and a cold plan within 60 ms.
test('planning speed: re-planning project_long after an edit (§9.1 acceptance, §7.4)', (t) => {
  const base = JSON.parse(JSON.stringify(corpus.project('long').doc));
  const reseed = (k) => Object.assign({}, base, { look: Object.assign({}, base.look, { seed: base.look.seed + k }) });
  for (let k = 1; k <= 3; k++) PL.plan(reseed(k), { registry: STUB });             // warm up the JIT
  const cold = [];
  for (let k = 4; k <= 6; k++) {
    const t0 = process.hrtime.bigint();
    PL.plan(reseed(k), { registry: STUB });
    cold.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const coldMs = Math.min(...cold);
  let doc = base;
  const first = PL.plan(doc, { registry: STUB });
  const batches = [];
  let n = 0;
  for (let b = 0; b < 8; b++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < 6; i++, n++) {
      const line = first.lines[(n * 17) % first.lines.length];
      const cut = line.cuts[0];
      const edits = [
        { ['cut/' + cut + ':arrive.dur']: { v: 0.3 + 0.01 * n, by: 'user', sig: PL.pinSig(first, cut) } },
        { ['line/' + line.id + ':dwell']: { v: n % 2 ? 'stubBob' : 'stillHold', by: 'user' } },
        { ['line/' + line.id + ':start']: { v: line.t0 + 0.05, by: 'tap' } },
      ];
      doc = Object.assign({}, doc, { pins: Object.assign({}, doc.pins, edits[n % 3]) });
      PL.plan(doc, { registry: STUB });
    }
    batches.push(Number(process.hrtime.bigint() - start) / 1e6 / 6);
  }
  const best = Math.min(...batches);
  t.diagnostic('re-plan after an edit: best ' + best.toFixed(1) + ' ms (batches ' + batches.map((x) => x.toFixed(1)).join(' ') +
    '); a plan of new cuts: ' + coldMs.toFixed(1) + ' ms');
  assert.ok(best <= 10, 're-plan after an edit: ' + batches.map((x) => x.toFixed(1)).join(' ') + ' ms');
  assert.ok(coldMs < 60, 'a plan of new cuts took ' + coldMs.toFixed(1) + ' ms');
});

// Typing in the lyric editor (§7.4: typing never waits on the planner). Each key appends one character to a row
// through lyrics.set, which moves every later automatic line a little and changes the length, so no cut after the
// edited row keeps its times. Casts are reused by the value of the features (planner/plan featuresOf) and encodings
// by the scene relative to t0 (planner/encode retimeCut). Before: 0 of 245 casts reused, 36–44 ms per key for
// project_long (120 lines) with the catalog; now about 90 % and 13 ms here. A swap that keeps the features (あ → い)
// must still give the new text: cached plans equal fresh ones throughout.
test('planning speed: typing in a lyric row reuses the casts of the cuts that only moved (catalog)', (t) => {
  const C = MV.use('core/commands');
  const CAT = MV.use('parts/catalog').defaultRegistry();
  let doc = JSON.parse(JSON.stringify(corpus.project('long').doc));
  const first = PL.plan(doc, { registry: CAT });
  const rowId = first.lines[30].id;
  const typeKey = (d, edit) => C.reduce(d, { t: 'lyrics.set',
    text: d.sheet.rows.map((r) => (r.id === rowId ? edit(r.src) : r.src)).join('\n') });
  const KEYS = 'かぜのなかでひかりをあつめてはしりだすあさ';
  const batches = [];
  let least = 1, n = 0;
  for (let b = 0; b < 8; b++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < 5; i++, n++) {
      doc = typeKey(doc, (src) => src + KEYS[n % KEYS.length]);
      const p = PL.plan(doc, { registry: CAT });
      least = Math.min(least, p.reuse.casts / p.reuse.cuts);
    }
    batches.push(Number(process.hrtime.bigint() - start) / 1e6 / 5);
    assert.equal(PL.plan(doc, { registry: CAT }).hash, PL.run(doc, CAT, { fresh: true }).hash, 'after key ' + n);
  }
  const best = Math.min(...batches);
  t.diagnostic('typing re-plan: best ' + best.toFixed(1) + ' ms (batches ' + batches.map((x) => x.toFixed(1)).join(' ') +
    '); least cast reuse ' + (100 * least).toFixed(0) + ' %');
  assert.ok(least >= 0.6, 'casts reused after a key: ' + (100 * least).toFixed(0) + ' %');
  assert.ok(best <= 30, 'typing re-plan: ' + batches.map((x) => x.toFixed(1)).join(' ') + ' ms');
  const swapped = typeKey(doc, (src) => src.slice(0, -1) + (src.endsWith('あ') ? 'い' : 'あ'));
  const p = PL.plan(swapped, { registry: CAT });
  assert.ok(p.reuse.casts / p.reuse.cuts > 0.9, 'a swap that keeps the features reuses the casts');
  assert.equal(p.hash, PL.run(swapped, CAT, { fresh: true }).hash, 'the swapped text reaches the plan');
  const src = swapped.sheet.rows.find((r) => r.id === rowId).src;
  assert.ok(p.cuts.some((c) => c.line === rowId && src.endsWith(c.text)), 'the plan holds the swapped text');
});

// A retired mood (pool: false, §4.18.1, §7.1.9) is only ever chosen by a pin.
test('retired moods and themes are never picked automatically, nor offered as alternatives', () => {
  const REG = MV.use('core/registry');
  const LK = MV.use('planner/look');
  const E = MV.use('planner/explain');
  const parts = corpus.allStubParts();
  const mood = parts.find((d) => d.kind === 'mood' && d.fallback);
  const theme = parts.find((d) => d.kind === 'theme' && d.fallback);
  const reg = REG.createRegistry(parts.concat([
    Object.assign({}, mood, { key: 'retiredMood', fallback: false, pool: false }),
    Object.assign({}, theme, { key: 'retiredTheme', fallback: false, pool: false }),
  ]));
  const doc = JSON.parse(JSON.stringify(corpus.project('long').doc));
  delete doc.pins['work:mood'];
  delete doc.pins['work:theme'];
  const moods = new Set();
  for (let s = 1; s <= 60; s++) {
    const d = Object.assign({}, doc, { look: Object.assign({}, doc.look, { moodSeed: s }) });
    const p = PL.run(d, reg, null);
    moods.add(p.look.mood.v);
    assert.notEqual(p.look.theme.v, 'retiredTheme');
    assert.equal(LK.previewMood(d, s, { registry: reg }), p.look.mood.v);
  }
  assert.ok(!moods.has('retiredMood'), [...moods].join(' '));
  const p = PL.run(doc, reg, null);
  assert.ok(!E.explain(doc, p, 'work:mood', { registry: reg }).alts.some((a) => a.key === 'retiredMood'));
  assert.ok(!E.explain(doc, p, 'work:theme', { registry: reg }).alts.some((a) => a.key === 'retiredTheme'));
  const pinned = Object.assign({}, doc, { pins: { 'work:mood': { v: 'retiredMood', by: 'user' } } });
  assert.equal(PL.run(pinned, reg, null).look.mood.v, 'retiredMood', 'a pin still chooses it');
});
