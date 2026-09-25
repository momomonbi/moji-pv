/* 文字PVメーカー v2 — original work. Tests: photos and videos in the planner — plan.media, fingerprints, segments, warnings, derived grounds, depth (DESIGN_2_1 §11.2.6, §11.5.9, §11.8.2, §11.9). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const REG = MV.use('core/registry');
const H = MV.use('core/hash');
const MEDIA = MV.use('core/media');
const PL = MV.use('planner/plan');
const PA = MV.use('planner/params');
const EX = MV.use('planner/explain');
const F = MV.use('planner/fields');

const clone = (x) => JSON.parse(JSON.stringify(x));
const L = (ja, en) => ({ ja, en });
const user = (v, sig) => (sig ? { v, by: 'user', sig } : { v, by: 'user' });
const stub = (kind, key) => corpus.allStubParts().find((d) => d.kind === kind && d.key === key);

// --- media parts (test data): package G writes the real ones (photoPan upgraded, photoFrame, textFill, mediaLayer)
// with K.mediaParams; these are plain definitions with the same params. ----------------------------------------------
const mediaParam = (accept) => ({ type: 'media', accept, label: L('写真・動画', 'Photo or video'), auto: { value: '' }, ai: false });
const DEPTH = { type: 'enum', of: ['auto', 'anim', 'front', 'back', 'still'], label: L('動きと重なり', 'Motion and layering'),
  auto: { value: 'auto' } };
const MEDIA_PARTS = [
  Object.assign({}, stub('ground', 'stubTint'), { key: 'photoGround', fallback: false, pool: false, label: L('写真', 'Photo'),
    params: { image: mediaParam('any'), depth: DEPTH } }),
  Object.assign({}, stub('ornament', 'stubRule'), { key: 'photoTile', fallback: false, pool: false, label: L('枠', 'Frame'),
    params: { src: mediaParam('image'), depth: DEPTH,
      place: { type: 'enum', of: ['behind', 'side', 'corner', 'free'], label: L('置き方', 'Place'), auto: { value: 'behind' } } } }),
  Object.assign({}, stub('ornament', 'stubRule'), { key: 'clipLayer', fallback: false, pool: false, scope: 'run', follow: 'own',
    label: L('映像', 'Footage'), params: { src: mediaParam('video'), depth: DEPTH } }),
  Object.assign({}, stub('ornament', 'stubRule'), { key: 'textWindow', fallback: false, pool: false, label: L('窓', 'Window'),
    params: { src: mediaParam('any') } }),
];
const BASE = REG.createRegistry(corpus.allStubParts().concat(MEDIA_PARTS));

// --- the library ----------------------------------------------------------------------------------------------------
const id = (c) => 'a' + c.repeat(24);
function entry(i, kind, extra) {
  const e = Object.assign({ id: id(i), kind, name: '素材' + i + (kind === 'video' ? '.mp4' : '.png'),
    mime: kind === 'video' ? 'video/mp4' : 'image/png', bytes: 1000, w: 1280, h: 720,
    dur: kind === 'video' ? 12.5 : null, fps: kind === 'video' ? 30 : null, frames: kind === 'video' ? 375 : null, rot: 0,
    alpha: false, anim: false, audio: false, codec: kind === 'video' ? 'avc1.640028' : null, color: 'srgb', hdr: false, pv: 1,
    pool: false, ai: null }, extra || {});
  return e;
}
const vision = (depth) => ({ caption: { ja: '空', en: 'Sky' }, tags: [], colors: [], subject: null, text: null, depth });
const IMG = id('1'), VID = id('2'), ANIM = id('3'), BLINK = id('4'), AIPIC = id('5'), POOLED = id('6'), SPARE = id('7');
const LIBRARY = [
  entry('1', 'image'),
  entry('2', 'video'),
  entry('3', 'image', { anim: true, dur: 3, fps: 10, frames: 30, mime: 'image/gif' }),
  entry('4', 'image', { anim: true, dur: 1, fps: 10, frames: 10, mime: 'image/gif' }),
  entry('5', 'image', { ai: vision('still') }),
  entry('6', 'image', { pool: true }),
  entry('7', 'image'),
];

// A derived おまかせ ground of a pooled asset, as parts/mix.registryFor makes it (§11.5.9).
function derived(assetId) {
  const photo = MEDIA_PARTS[0];
  return Object.assign({}, photo, { key: MEDIA.keyOf(assetId), label: L('素材', 'Asset'), blurb: L('マイ素材の写真・動画', 'Your photo or video'),
    tags: ['soft'], pool: true, weight: 1.5, params: Object.assign({}, photo.params, { image: Object.assign({}, photo.params.image,
      { auto: { value: assetId } }) }), mine: { id: assetId, rhash: assetId, cost: 0.4, by: 'user', media: true } });
}
const POOLED_REG = REG.extend(BASE, [derived(POOLED)]);

function mediaDoc(name = 'basic') {
  const doc = clone(corpus.project(name).doc);
  doc.pins = {};
  doc.locks = {};
  doc.media = { list: clone(LIBRARY) };
  return doc;
}

test('the test library is valid', () => {
  for (const e of LIBRARY) assert.deepEqual(MEDIA.entryProblems(e), [], e.id);
  // The library keeps the AI's depth (core/media normalizeEntry), which §11.9.2 rule 1 reads.
  assert.equal(MEDIA.normalizeEntry(LIBRARY[4]).ai.depth, 'still');
  assert.deepEqual(BASE.problems, []);
  assert.deepEqual(POOLED_REG.problems, []);
});

test('plan.media holds exactly the assets the decisions use, with their MediaMeta', () => {
  const doc = mediaDoc();
  const p0 = PL.run(doc, BASE, null);
  const [a, b] = [p0.lines[1], p0.lines[3]];
  doc.pins['work:ground'] = user('photoGround');
  doc.pins['line/' + a.id + ':ground@photoGround.image'] = user(VID);
  doc.pins['line/' + b.id + ':ornament#0'] = user('photoTile');
  doc.pins['line/' + b.id + ':ornament#0@photoTile.src'] = user(IMG);
  const p = PL.run(doc, BASE, null);
  assert.deepEqual(Object.keys(p.media), [IMG, VID]);
  for (const k of Object.keys(p.media)) {
    const meta = MEDIA.metaOf(LIBRARY.find((e) => e.id === k));
    assert.deepEqual(p.media[k], meta);
    assert.deepEqual(Object.keys(p.media[k]), Object.keys(meta).sort(), 'keys sorted');
  }
  assert.equal(p.hash, H.hashJSON(Object.assign({}, p, { hash: undefined })), 'the plan hash covers it');
  // Without media pins the Plan lists none, whatever the library holds.
  assert.deepEqual(PL.run(mediaDoc(), BASE, null).media, {});
});

test('mediaTerms: an asset\'s metadata is in the fingerprints of exactly the scenes that use it', () => {
  const doc = mediaDoc();
  const p0 = PL.run(doc, BASE, null);
  const line = p0.lines[2];
  doc.pins['line/' + line.id + ':ornament#0'] = user('textWindow');
  doc.pins['line/' + line.id + ':ornament#0@textWindow.src'] = user(VID);
  doc.pins['line/' + p0.lines[4].id + ':ground'] = user('photoGround');
  doc.pins['line/' + p0.lines[4].id + ':ground@photoGround.image'] = user(VID);
  const a = PL.run(doc, BASE, { fresh: true });
  const re = clone(doc);
  re.media.list.find((e) => e.id === VID).w = 1920;         // a newer probe read other metadata
  re.media.list.find((e) => e.id === SPARE).w = 640;         // an asset nothing uses
  const b = PL.run(re, BASE, { fresh: true });
  assert.deepEqual(b.media[VID], Object.assign({}, a.media[VID], { w: 1920 }));
  a.cuts.forEach((c, i) => assert.equal(b.cuts[i].fp !== c.fp, c.line === line.id, c.key));
  a.grounds.forEach((g, k) => assert.equal(b.grounds[k].fp !== g.fp, g.ground.v === 'photoGround', g.key));
  const c = PL.plan(clone(re), { registry: BASE });
  assert.equal(c.hash, b.hash, 'cached = fresh');
});

test('segments break where the photo of a pinned background changes, and nowhere else', () => {
  const doc = mediaDoc();
  doc.pins['work:ground'] = user('photoGround');
  const one = PL.run(doc, BASE, null);
  assert.equal(one.grounds.length, 1 + (one.cuts[0].role === 'title' ? 0 : 0), 'one pinned background, one segment');
  const lines = one.lines;
  doc.pins['work:ground@photoGround.image'] = user(IMG);
  doc.pins['line/' + lines[2].id + ':ground@photoGround.image'] = user(VID);
  doc.pins['line/' + lines[3].id + ':ground@photoGround.image'] = user(VID);
  const p = PL.run(doc, BASE, null);
  const segOf = (lineId) => p.cuts.filter((c) => c.line === lineId).map((c) => c.ground);
  const [g2] = segOf(lines[2].id);
  assert.deepEqual(segOf(lines[3].id), segOf(lines[3].id).map(() => g2), 'the two video lines share a segment');
  assert.notEqual(segOf(lines[1].id)[0], g2, 'a break before');
  assert.notEqual(segOf(lines[4].id)[0], g2, 'a break after');
  assert.equal(p.grounds[g2].ground.p.image, VID);
  assert.equal(p.grounds[segOf(lines[1].id)[0]].ground.p.image, IMG);
  assert.equal(p.grounds.length, 3);
  // The same photo pinned twice is one source: no break.
  const same = clone(doc);
  same.pins['line/' + lines[2].id + ':ground@photoGround.image'] = user(IMG);
  same.pins['line/' + lines[3].id + ':ground@photoGround.image'] = user(IMG);
  assert.equal(PL.run(same, BASE, null).grounds.length, 1);
});

test('media-missing and media-kind warn and fall back to no picture', () => {
  const doc = mediaDoc();
  const p0 = PL.run(doc, BASE, null);
  const [a, b, c] = [p0.lines[1], p0.lines[2], p0.lines[3]];
  const gone = id('9');
  doc.pins['line/' + a.id + ':ornament#0'] = user('photoTile');
  doc.pins['line/' + a.id + ':ornament#0@photoTile.src'] = user(gone);
  doc.pins['line/' + b.id + ':ornament#0'] = user('photoTile');
  doc.pins['line/' + b.id + ':ornament#0@photoTile.src'] = user(VID);                // accept 'image'
  doc.pins['line/' + c.id + ':atmos'] = user('clipLayer');
  doc.pins['line/' + c.id + ':atmos@clipLayer.src'] = user(IMG);                     // accept 'video'
  doc.pins['line/' + p0.lines[4].id + ':ornament#0'] = user('photoTile');
  doc.pins['line/' + p0.lines[4].id + ':ornament#0@photoTile.src'] = user('not-an-id');
  const p = PL.run(doc, BASE, null);
  const w = p.warnings.filter((x) => x.code.startsWith('media-') || x.code === 'pin-bad-value');
  assert.deepEqual(w, [                          // cast (stage 5) before tracks (stage 6)
    { code: 'media-missing', detail: { id: gone }, line: a.id, path: 'line/' + a.id + ':ornament#0@photoTile.src' },
    { code: 'media-kind', detail: { id: VID }, line: b.id, path: 'line/' + b.id + ':ornament#0@photoTile.src' },
    { code: 'pin-bad-value', line: p0.lines[4].id, path: 'line/' + p0.lines[4].id + ':ornament#0@photoTile.src' },
    { code: 'media-kind', detail: { id: IMG }, line: c.id, path: 'line/' + c.id + ':atmos@clipLayer.src' },
  ]);
  for (const line of [a, b]) for (const k of line.cuts) assert.equal(p.cuts.find((x) => x.key === k).slots['ornament#0'].p.src, '', k);
  assert.equal(p.grounds[p.cuts.find((x) => x.line === c.id).ground].atmos.p.src, '');
  assert.deepEqual(p.media, {});
  // A material's own asset that is gone warns too (its media layers draw nothing).
  const mat = Object.assign({}, stub('dwell', 'stubBob'), { key: 'myMat1', fallback: false, pool: false,
    mine: { id: 'm1', rhash: 'r1', by: 'user', media: [IMG, gone] } });
  const withMat = mediaDoc();
  withMat.pins['work:dwell'] = user('myMat1');
  const q = PL.run(withMat, REG.extend(BASE, [mat]), null);
  assert.deepEqual(Object.keys(q.media), [IMG], 'the material\'s asset is listed');
  assert.deepEqual(q.warnings.filter((x) => x.code === 'media-missing'), [{ code: 'media-missing', detail: { id: gone } }]);
});

test('derived おまかせ grounds: chosen only when pooled, never for a segment under 3 s or the title card', () => {
  let picked = 0, short = 0;
  const seen = new Set();
  for (let s = 0; s < 40; s++) {
    const doc = mediaDoc(s % 2 ? 'basic' : 'vertical');
    doc.look.seed = 700 + s;
    doc.pins['work:amount.groundSwitch'] = user(0.9);
    const p = PL.run(doc, POOLED_REG, null);
    const q = PL.run(doc, BASE, null);
    for (const g of q.grounds) assert.ok(!g.ground.v.startsWith('myMed'), 'not derived → never');
    for (const g of p.grounds) {
      seen.add(g.ground.v);
      const len = g.t1 - g.t0;
      const title = p.cuts.find((c) => c.key === g.cuts[0]).role === 'title';
      if (len < 3 || title) short++;
      if (g.ground.v !== MEDIA.keyOf(POOLED)) continue;
      picked++;
      assert.ok(len >= 3 && !title, g.key + ' ' + len);
      assert.equal(g.ground.p.image, POOLED);
      assert.deepEqual(p.media[POOLED], MEDIA.metaOf(LIBRARY.find((e) => e.id === POOLED)));
    }
  }
  assert.ok(picked > 5 && short > 5, 'picked ' + picked + ', short or title segments ' + short);
  assert.ok(seen.size > 2);
});

test('parts/mix registryFor: a pinned derived ground names its asset (mine.id) in plan.media and its fingerprint', () => {
  const MIX = MV.use('parts/mix');
  const base = MV.use('parts/catalog').defaultRegistry();
  const doc = mediaDoc();
  const reg = MIX.registryFor(base, doc.materials, doc.media);
  const key = MEDIA.keyOf(POOLED);
  assert.equal(reg.extra[key].media, true);
  assert.equal(reg.extra[key].id, POOLED);
  doc.pins['work:ground'] = user(key);
  const p = PL.run(doc, reg, null);
  assert.ok(p.grounds.every((g) => g.ground.v === key));
  assert.deepEqual(Object.keys(p.media), [POOLED]);
  // The asset's metadata is in the ground's fingerprint: another size changes it, nothing else of the plan.
  const other = clone(doc);
  other.media.list.find((e) => e.id === POOLED).w = 640;
  const q = PL.run(other, MIX.registryFor(base, other.materials, other.media), null);
  p.grounds.forEach((g, i) => assert.notEqual(q.grounds[i].fp, g.fp, g.key));
  p.cuts.forEach((c, i) => assert.equal(q.cuts[i].fp, c.fp, c.key));
});

test('filters include and deny derived grounds; explain names media.pool and media.pin', () => {
  const key = MEDIA.keyOf(POOLED);
  const doc = mediaDoc();
  doc.filters = { ground: { only: [key], deny: null } };
  const p = PL.run(doc, POOLED_REG, null);
  for (const g of p.grounds) {
    const eligible = g.t1 - g.t0 >= 3 && p.cuts.find((c) => c.key === g.cuts[0]).role !== 'title';
    assert.equal(g.ground.v === key, eligible, g.key + ' ' + g.ground.v);
  }
  const g = p.grounds.find((x) => x.ground.v === key);
  const e = EX.explain(doc, p, 'cut/' + g.cuts[0] + ':ground', { registry: POOLED_REG });
  assert.equal(e.value, key);
  assert.ok(e.why.some((w) => w.code === 'media.pool' && w.params.name === '素材6.png'), JSON.stringify(e.why));
  const ei = EX.explain(doc, p, 'cut/' + g.cuts[0] + ':ground@' + key + '.image', { registry: POOLED_REG });
  assert.deepEqual([ei.value, ei.why], [POOLED, [{ code: 'media.pool', params: { name: '素材6.png' } }]]);
  const deny = mediaDoc();
  deny.filters = { ground: { only: null, deny: [key] } };
  for (let s = 0; s < 10; s++) {
    deny.look.seed = 900 + s;
    assert.ok(PL.run(deny, POOLED_REG, null).grounds.every((x) => x.ground.v !== key));
  }
  const pinned = mediaDoc();
  pinned.pins['work:ground'] = user('photoGround');
  pinned.pins['work:ground@photoGround.image'] = user(IMG);
  const q = PL.run(pinned, BASE, null);
  const ep = EX.explain(pinned, q, 'work:ground@photoGround.image', { registry: BASE });
  assert.deepEqual(ep.why, [{ code: 'pin', params: { scope: 'work', by: 'user' } }, { code: 'media.pin', params: { name: '素材1.png' } }]);
  const fs = F.fieldState(pinned, q, null, 'work:ground@photoGround.image', { registry: BASE });
  assert.deepEqual([fs.value, fs.state, fs.display, fs.schema.type], [IMG, 'pinned', '素材1.png', 'media']);
});

// --- depth (§11.9.2) --------------------------------------------------------------------------------------------------

// A document whose every cut shows `part` with `src` (a background at work scope, or a decoration / atmosphere on every
// line), plus extra pins.
function depthDoc(where, src, extra, name) {
  const doc = mediaDoc(name || 'basic');
  if (where === 'ground') { doc.pins['work:ground'] = user('photoGround'); doc.pins['work:ground@photoGround.image'] = user(src); }
  if (where === 'frame') { doc.pins['work:ornament#0'] = user('photoTile'); doc.pins['work:ornament#0@photoTile.src'] = user(src); }
  if (where === 'layer') { doc.pins['work:atmos'] = user('clipLayer'); doc.pins['work:atmos@clipLayer.src'] = user(src); }
  Object.assign(doc.pins, extra || {});
  return doc;
}

function depthsOf(plan, where) {
  if (where === 'ground') return plan.grounds.map((g) => g.ground.p.depth);
  if (where === 'layer') return plan.grounds.map((g) => g.atmos.p.depth);
  return plan.cuts.filter((c) => c.slots['ornament#0'] && c.slots['ornament#0'].v === 'photoTile').map((c) => c.slots['ornament#0'].p.depth);
}

function whyOf(doc, plan, where) {
  const cut = plan.cuts.find((c) => c.role === 'lyric');
  const path = where === 'ground' ? 'cut/' + cut.key + ':ground@photoGround.depth'
    : where === 'layer' ? 'cut/' + cut.key + ':atmos@clipLayer.depth' : 'cut/' + cut.key + ':ornament#0@photoTile.depth';
  return { e: EX.explain(doc, plan, path, { registry: BASE }), fs: F.fieldState(doc, plan, null, path, { registry: BASE }) };
}

test('depth: every §11.9.2 rule in order, with its why code in explain and the field\'s auto text', () => {
  // Plain lyrics (long lines) for the heuristics; a segment of short, big lines is busy.
  const cases = [
    // [where, src, pins, expected, rule]
    ['layer', VID, {}, 'front', 'overlay'],
    ['frame', IMG, {}, 'anim', 'frame'],
    ['ground', VID, {}, 'back', 'video'],
    ['ground', ANIM, {}, 'back', 'video'],
    ['ground', BLINK, {}, 'anim', 'still'],
    ['ground', IMG, {}, 'anim', 'still'],
    ['ground', AIPIC, {}, 'still', 'ai'],                                    // the AI's suggestion wins
    ['frame', AIPIC, {}, 'still', 'ai'],
    ['ground', '', {}, 'anim', 'still'],
  ];
  for (const [where, src, pins, want, rule] of cases) {
    const doc = depthDoc(where, src, pins, 'long');
    const p = PL.run(doc, BASE, null);
    const got = depthsOf(p, where);
    assert.ok(got.length > 0 && got.every((d) => d === want), where + ' ' + src + ': ' + got.join(' '));
    const { e, fs } = whyOf(doc, p, where);
    assert.deepEqual([e.value, e.from, e.why], [want, 'auto', [{ code: 'media.depth.' + rule, params: {} }]], where + ' ' + src);
    assert.deepEqual([fs.state, fs.autoText], ['auto', ['why.media.depth.' + rule, {}]], where + ' ' + src + ' field');
  }
  // A video wins over the AI? No: the AI's suggestion comes first (rule 2 before rule 5).
  const aiVideo = depthDoc('ground', VID, {}, 'long');
  aiVideo.media.list.find((e) => e.id === VID).ai = vision('anim');
  assert.ok(depthsOf(PL.run(aiVideo, BASE, null), 'ground').every((d) => d === 'anim'));
  // Busy text: every line of the segment is a few big glyphs.
  const busy = depthDoc('ground', IMG, {}, 'basic');
  busy.sheet = { next: 40, rows: ['[00:02.00]夜', '[00:05.00]星', '[00:08.00]空', '[00:11.00]愛を'].map((src, i) => ({ id: 'r' + (i + 1), src })) };
  const pb = PL.run(busy, BASE, null);
  assert.ok(PA.textCoverage(pb.cuts) >= 0.35);
  assert.ok(depthsOf(pb, 'ground').every((d) => d === 'back'), depthsOf(pb, 'ground').join(' '));
  assert.deepEqual(whyOf(busy, pb, 'ground').e.why, [{ code: 'media.depth.busy', params: {} }]);
  const video = clone(busy);
  video.pins['work:ground@photoGround.image'] = user(VID);
  assert.deepEqual(whyOf(video, PL.run(video, BASE, null), 'ground').e.why, [{ code: 'media.depth.video', params: {} }],
    'the video rule comes before the busy rule');
});

test('depth: pins win (user, ai, lock); a pin of auto is no pin; the value is never auto', () => {
  for (const [who, v] of [['user', 'front'], ['ai', 'still'], ['lock', 'back']]) {
    const doc = depthDoc('ground', VID, { 'work:ground@photoGround.depth': { v, by: who } }, 'long');
    const p = PL.run(doc, BASE, null);
    for (const g of p.grounds) assert.deepEqual([g.ground.p.depth, g.ground.pfrom.depth], [v, 'pin:work'], who);
    const { e, fs } = whyOf(doc, p, 'ground');
    assert.equal(e.value, v);
    assert.equal(e.why[0].code, who === 'lock' ? 'lock' : 'pin');
    assert.equal(fs.autoText, null);
  }
  const auto = depthDoc('ground', VID, { 'work:ground@photoGround.depth': user('auto') }, 'long');
  const p = PL.run(auto, BASE, null);
  for (const g of p.grounds) {
    assert.equal(g.ground.p.depth, 'back');
    assert.ok(!g.ground.pfrom || !g.ground.pfrom.depth, 'a pin of auto is no pin');
  }
  // Nowhere in any plan is a depth left 'auto'.
  for (const where of ['ground', 'frame', 'layer']) {
    for (const src of [IMG, VID, ANIM, AIPIC, '']) {
      assert.ok(depthsOf(PL.run(depthDoc(where, src), BASE, null), where).every((d) => d !== 'auto'), where + ' ' + src);
    }
  }
  // In front of the text, an automatic 'behind' photo frame moves to the side; a pinned place is kept.
  const front = depthDoc('frame', IMG, { 'work:ornament#0@photoTile.depth': user('front') });
  for (const c of PL.run(front, BASE, null).cuts.filter((x) => x.slots['ornament#0'] && x.slots['ornament#0'].v === 'photoTile')) {
    assert.deepEqual([c.slots['ornament#0'].p.depth, c.slots['ornament#0'].p.place], ['front', 'side']);
  }
  const kept = depthDoc('frame', IMG, { 'work:ornament#0@photoTile.depth': user('front'), 'work:ornament#0@photoTile.place': user('behind') });
  for (const c of PL.run(kept, BASE, null).cuts.filter((x) => x.slots['ornament#0'] && x.slots['ornament#0'].v === 'photoTile')) {
    assert.equal(c.slots['ornament#0'].p.place, 'behind');
  }
  const anim = depthDoc('frame', IMG);
  for (const c of PL.run(anim, BASE, null).cuts.filter((x) => x.slots['ornament#0'] && x.slots['ornament#0'].v === 'photoTile')) {
    assert.equal(c.slots['ornament#0'].p.place, 'behind', 'with the animation the frame may stay behind');
  }
});

test('depth: the AI suggestion and the rule change only the fingerprints of the scenes that use the asset', () => {
  const doc = depthDoc('frame', IMG, {}, 'basic');
  const p0 = PL.run(doc, BASE, null);
  const line = p0.lines[2];
  doc.pins = { ['line/' + line.id + ':ornament#0']: user('photoTile'), ['line/' + line.id + ':ornament#0@photoTile.src']: user(IMG) };
  const a = PL.run(doc, BASE, { fresh: true });
  const suggested = clone(doc);
  suggested.media.list.find((e) => e.id === IMG).ai = vision('back');
  const b = PL.plan(suggested, { registry: BASE });
  assert.equal(b.hash, PL.run(clone(suggested), BASE, { fresh: true }).hash, 'cached = fresh (the cast cache sees ai.depth)');
  a.cuts.forEach((c, i) => {
    assert.equal(b.cuts[i].fp !== c.fp, c.line === line.id, c.key);
    if (c.line === line.id) assert.deepEqual([c.slots['ornament#0'].p.depth, b.cuts[i].slots['ornament#0'].p.depth], ['anim', 'back']);
  });
  // A background's depth follows its segment's text: the busy rule re-plans that background only.
  const g = depthDoc('ground', IMG, {}, 'basic');
  const pg = PL.run(g, BASE, null);
  const q = PL.plan(clone(g), { registry: BASE });
  assert.equal(q.hash, pg.hash);
});
