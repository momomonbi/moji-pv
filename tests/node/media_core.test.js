/* 文字PVメーカー v2 — original work. Tests: core/media — asset entries, references, the time model, fit and still tiers (DESIGN_2_1 §11.2, §11.4.2, §11.4.6, §11.5.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { deepEqual, approx } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const ME = MV.use('core/media');
const { stream } = MV.use('core/rng');

const FILE = JSON.parse(corpus.projectText('media'));
const [LOGO, SKY, SEA, SPARK] = FILE.doc.media.list;       // png (alpha), jpeg (pool, ai), mp4 video, webm alpha video
const copy = (v) => JSON.parse(JSON.stringify(v));
const withField = (entry, patch) => Object.assign(copy(entry), patch);
const fields = (probs) => probs.map((p) => p.slice(0, p.indexOf(':')));

// ---- entries (§11.2.1) ------------------------------------------------------------------------------------------------

test('entryProblems: the fixture entries are valid; every rule of §11.2.1 / §11.2.8 is reported by field', () => {
  for (const e of FILE.doc.media.list) assert.deepEqual(ME.entryProblems(e), [], e.name);
  assert.deepEqual(ME.entryProblems(null), ['entry: must be an object']);
  assert.deepEqual(ME.entryProblems([]), ['entry: must be an object']);
  const cases = [
    [LOGO, { id: 'a3F9c2d17b0e4a5c6d7e8f901' }, 'id'], [LOGO, { id: 'a3f9c2d17b0e4a5c6d7e8f9' }, 'id'],
    [LOGO, { kind: 'audio' }, 'kind'],
    [LOGO, { name: '' }, 'name'], [LOGO, { name: 'x'.repeat(81) }, 'name'], [LOGO, { name: 'a\nb' }, 'name'],
    [LOGO, { mime: 'video/mp4' }, 'mime'], [SEA, { mime: 'image/png' }, 'mime'],
    [LOGO, { bytes: 0 }, 'bytes'], [LOGO, { bytes: 60 * 1024 * 1024 + 1 }, 'bytes'], [LOGO, { bytes: 1.5 }, 'bytes'],
    [LOGO, { w: 0 }, 'w/h'], [LOGO, { w: 8000, h: 6000 }, 'w/h'],
    [SEA, { w: 4097, h: 100 }, 'w/h'], [SEA, { w: 4096, h: 2304 }, 'w/h'],
    [LOGO, { anim: true, dur: 2, fps: 10, frames: 20, w: 2049, h: 100 }, 'w/h'],
    [SEA, { dur: null }, 'dur'], [SEA, { dur: 3601 }, 'dur'], [SEA, { fps: 121 }, 'fps'], [SEA, { frames: 0 }, 'frames'],
    [LOGO, { anim: true }, 'dur'], [LOGO, { anim: true, dur: 2, fps: 10, frames: 601 }, 'frames'],
    [LOGO, { dur: 1 }, 'dur'], [LOGO, { fps: 30 }, 'fps'], [LOGO, { frames: 1 }, 'frames'],
    [LOGO, { rot: 90 }, 'rot'], [SEA, { rot: 45 }, 'rot'],
    [LOGO, { alpha: 1 }, 'alpha'], [LOGO, { pool: 'yes' }, 'pool'], [LOGO, { hdr: undefined }, 'hdr'],
    [SEA, { anim: true }, 'anim'], [LOGO, { audio: true }, 'audio'],
    [LOGO, { codec: 'avc1' }, 'codec'], [SEA, { codec: null }, 'codec'], [SEA, { codec: '' }, 'codec'],
    [LOGO, { color: 'rec709' }, 'color'], [LOGO, { pv: 0 }, 'pv'], [LOGO, { pv: 1.5 }, 'pv'],
    [SKY, { ai: 'sky' }, 'ai'],
    [SKY, { ai: withField(SKY.ai, { caption: { ja: '空' } }) }, 'ai.caption'],
    [SKY, { ai: withField(SKY.ai, { caption: { ja: 'あ'.repeat(61), en: 'sky' } }) }, 'ai.caption'],
    [SKY, { ai: withField(SKY.ai, { tags: ['sunny'] }) }, 'ai.tags'],
    [SKY, { ai: withField(SKY.ai, { colors: ['#000000', '#111111', '#222222', '#333333', '#444444', '#555555'] }) }, 'ai.colors'],
    [SKY, { ai: withField(SKY.ai, { colors: ['red'] }) }, 'ai.colors'],
    [SKY, { ai: withField(SKY.ai, { subject: { x: 0.5, y: 0, w: 0.6, h: 1 } }) }, 'ai.subject'],
    [SKY, { ai: withField(SKY.ai, { text: { x: 0, y: 0, w: 1 } }) }, 'ai.text'],
  ];
  for (const [base, patch, field] of cases) {
    const probs = ME.entryProblems(withField(base, patch));
    assert.ok(fields(probs).includes(field), JSON.stringify(patch) + ' → ' + field + ', got ' + JSON.stringify(probs));
  }
  // limits that hold exactly
  assert.deepEqual(ME.entryProblems(withField(LOGO, { name: 'x'.repeat(80) })), []);
  assert.deepEqual(ME.entryProblems(withField(SEA, { w: 4096, h: 2176, rot: 270 })), []);
  assert.deepEqual(ME.entryProblems(withField(LOGO, { anim: true, dur: 2, fps: 10, frames: 600, w: 2048, h: 2048 })), []);
  assert.deepEqual(ME.entryProblems(withField(SKY, { ai: withField(SKY.ai, { caption: { ja: '', en: '' }, tags: [], colors: [] }) })), []);
  assert.deepEqual(ME.entryProblems(withField(LOGO, { pv: 7 })), [], 'unknown probe versions are kept');
});

test('normalizeEntry: §11.2.1 field order, q3 numbers, upper-case colours, unknown fields dropped; frozen and idempotent', () => {
  const raw = withField(SKY, { extra: 1, dur: null });
  raw.ai = { text: { x: 0.12345, y: 0, w: 0.5, h: 0.25 }, colors: ['#f2a65a'], junk: 1, caption: { en: 'Sky', ja: '空', x: 2 },
    subject: null, tags: ['airy'] };
  const shuffled = {};
  for (const k of Object.keys(raw).reverse()) shuffled[k] = raw[k];
  const out = ME.normalizeEntry(shuffled);
  assert.deepEqual(Object.keys(out), ME.ORDER.slice());
  assert.deepEqual(Object.keys(out.ai), ME.AI_ORDER.slice());
  deepEqual(out.ai, { caption: { ja: '空', en: 'Sky' }, tags: ['airy'], colors: ['#F2A65A'], subject: null,
    text: { x: 0.123, y: 0, w: 0.5, h: 0.25 } });
  assert.ok(Object.isFrozen(out) && Object.isFrozen(out.ai) && Object.isFrozen(out.ai.text));
  deepEqual(ME.normalizeEntry(out), out, 'idempotent');
  assert.deepEqual(ME.entryProblems(out), []);
  const video = ME.normalizeEntry(withField(SEA, { dur: 12.51249, fps: 29.97003 }));
  assert.equal(video.dur, 12.512);
  assert.equal(video.fps, 29.97);
  for (const e of FILE.doc.media.list) deepEqual(ME.normalizeEntry(e), e, 'the fixture is stored normalized: ' + e.name);
});

test('keyOf / idOfKey: the derived key is myMed + id[1..10], resolved through doc.media', () => {
  assert.equal(ME.keyOf('a3f9c2d17b0e4a5c6d7e8f901'), 'myMed3f9c2d17b0');
  assert.equal(ME.keyOf(SKY.id), 'myMed2d4f6a8b0c');
  assert.equal(ME.idOfKey('myMed2d4f6a8b0c', FILE.doc), SKY.id);
  assert.equal(ME.idOfKey('myMed3f9c2d17b0', FILE.doc), SEA.id, 'the key resolves whatever the pool flag');
  assert.equal(ME.idOfKey('myMed0000000000', FILE.doc), null);
  assert.equal(ME.idOfKey('myMat1', FILE.doc), null);
  assert.equal(ME.idOfKey('myMed2d4f6a8b0c', {}), null);
  assert.equal(ME.idOfKey('myMed2d4f6a8b0c', null), null);
  assert.equal(ME.idOfKey(42, FILE.doc), null);
  for (const e of FILE.doc.media.list) assert.equal(ME.idOfKey(ME.keyOf(e.id), FILE.doc), e.id);
});

test('refsOf: pin values, derived keys, @key paths, avoid items and material src — strings only, sorted', () => {
  deepEqual(ME.refsOf(FILE.doc, LOGO.id), { pins: ['line/r2:ornament#0@photoFrame.src'], materials: [] });
  deepEqual(ME.refsOf(FILE.doc, SKY.id), { pins: ['line/r3:ground', 'line/r3:ground@myMed2d4f6a8b0c.blur', 'line/r5:avoid'],
    materials: [] });
  deepEqual(ME.refsOf(FILE.doc, SEA.id), { pins: ['work:ground@photoPan.image'], materials: ['m1'] });
  deepEqual(ME.refsOf(FILE.doc, SPARK.id), { pins: [], materials: [] });
  deepEqual(ME.refsOf(FILE.doc, 'a000000000000000000000000'), { pins: [], materials: [] });
  deepEqual(ME.refsOf({}, SKY.id), { pins: [], materials: [] });
  deepEqual(ME.refsOf(null, SKY.id), { pins: [], materials: [] });
  // look-alikes are not references
  const doc = { pins: { 'work:ground@myMed2d4f6a8b0cX.blur': { v: 1 }, 'work:avoid': { v: ['myMed2d4f6a8b0c', 'x.myMed2d4f6a8b0'] },
    'work:title': { v: 'a2d4f6a8b0c2d4e6f8a0b2c4d ' } } };
  deepEqual(ME.refsOf(doc, SKY.id), { pins: [], materials: [] });
});

// ---- time (§11.4.2) ---------------------------------------------------------------------------------------------------

// The reference: the text of §11.4.2, written out independently.
function reference(meta, p, origin, tl, t) {
  const dur = meta.dur, frame = 1 / meta.fps;
  const clipIn = Math.min(Math.max(p.clipIn, 0), Math.max(0, dur - frame));
  const end = p.clipOut > clipIn ? Math.min(p.clipOut, dur) : dur;
  const tau = p.clock === 'song' ? t : tl - origin;
  const span = Math.max(frame, end - clipIn);
  const x = Math.max(0, tau) * p.speed;
  return p.loop === 'hold' ? clipIn + Math.min(x, span - 0.001) : clipIn + (x - span * Math.floor(x / span));
}

test('timeSpec: null for stills; clipIn, end, speed, loop and clock resolved by §11.4.2', () => {
  assert.equal(ME.timeSpec(LOGO, {}, 0), null);
  assert.equal(ME.timeSpec(null, {}, 0), null);
  const anim = ME.timeSpec(withField(LOGO, { anim: true, dur: 2, fps: 10, frames: 20 }), {}, 0);
  deepEqual(anim, { clock: 'show', origin: 0, clipIn: 0, end: 2, speed: 1, loop: 'loop', frame: 0.1 });
  const T = ME.timeSpec(SEA, { clipIn: 99, clipOut: 5, speed: 9, loop: 'hold', clock: 'song' }, 4.5);
  approx(T.clipIn, 12.512 - 1 / 29.97, 1e-12);
  assert.equal(T.end, 12.512, 'clipOut ≤ clipIn means the whole clip');
  assert.equal(T.speed, 4);
  deepEqual([T.loop, T.clock, T.origin], ['hold', 'song', 4.5]);
  const U = ME.timeSpec(SEA, { clipIn: 2, clipOut: 99, speed: 0.1, loop: 'bounce', clock: 'wall' }, 'x');
  deepEqual([U.clipIn, U.end, U.speed, U.loop, U.clock, U.origin], [2, 12.512, 0.25, 'loop', 'show', 0]);
  assert.ok(Object.isFrozen(T));
});

test('mapTime: 10 000 random cases equal the §11.4.2 reference; the result stays inside the clip', () => {
  const rng = stream('media-time');
  for (let n = 0; n < 10000; n++) {
    const fps = rng.pick([12, 23.976, 24, 25, 29.97, 30, 60, 120]);
    const dur = Math.round(rng.range(0.05, 40) * 1000) / 1000;
    const meta = { kind: 'video', dur, fps, anim: false };
    const p = { clipIn: rng.chance(0.3) ? 0 : rng.range(-1, dur + 1), clipOut: rng.chance(0.3) ? 0 : rng.range(0, dur + 2),
      speed: rng.pick([0.25, 0.5, 1, 1.5, 2, 4]), loop: rng.pick(['loop', 'hold']), clock: rng.pick(['show', 'song']) };
    const origin = rng.chance(0.5) ? 0 : rng.range(0, 60);
    const T = ME.timeSpec(meta, p, origin);
    const t = rng.range(-2, 120), tl = rng.range(-2, 120);
    const tau = p.clock === 'song' ? t : tl;
    const m = ME.mapTime(T, tau);
    const want = reference(meta, p, origin, tl, t);
    assert.ok(Math.abs(m - want) <= 1e-9, JSON.stringify({ meta, p, origin, t, tl, m, want }));
    const span = Math.max(T.frame, T.end - T.clipIn);
    assert.ok(m >= T.clipIn - 1e-9, 'm ≥ clipIn');
    if (p.loop === 'hold') assert.ok(m <= T.clipIn + span - 0.001 + 1e-9, 'hold stops 1 ms before the end');
    else assert.ok(m < T.clipIn + span + 1e-9, 'loop wraps');
  }
});

test('mapTime: the clip starts at clipIn when its scene starts (show) or at song time 0 (song); frames are independent', () => {
  const show = ME.timeSpec(SEA, { clipIn: 3, speed: 1, clock: 'show' }, 7.25);
  assert.equal(ME.mapTime(show, 7.25), 3, 'show: τ = tl − origin');
  assert.equal(ME.mapTime(show, 0), 3, 'before the scene: held at clipIn');
  approx(ME.mapTime(show, 8.25), 4, 1e-12);
  const song = ME.timeSpec(SEA, { clipIn: 3, speed: 2, clock: 'song' }, 7.25);
  assert.equal(ME.mapTime(song, 0), 3, 'song: at song time 0 it shows clipIn');
  approx(ME.mapTime(song, 1), 5, 1e-12);
  const hold = ME.timeSpec(SEA, { clipIn: 10, loop: 'hold' }, 0);
  approx(ME.mapTime(hold, 1e6), 12.511, 1e-9);
  // closed form: any order gives the same values
  const T = ME.timeSpec(SPARK, { speed: 1.5 }, 2);
  const times = Array.from({ length: 200 }, (_, i) => i / 30);
  const forward = times.map((x) => ME.mapTime(T, x));
  const shuffled = times.map((x, i) => [x, i]).sort((a, b) => ((a[1] * 7919) % 200) - ((b[1] * 7919) % 200));
  for (const [x, i] of shuffled) assert.equal(ME.mapTime(T, x), forward[i]);
});

// ---- fit (§11.5.2) ----------------------------------------------------------------------------------------------------

test('fitRect cover: the destination is the box, the source rect stays in the image and keeps the box aspect', () => {
  const rng = stream('media-fit-cover');
  for (let n = 0; n < 3000; n++) {
    const meta = { w: rng.int(1, 5000), h: rng.int(1, 5000) };
    const box = { x: rng.range(-500, 500), y: rng.range(-500, 500), w: rng.range(1, 2000), h: rng.range(1, 2000) };
    const z = rng.chance(0.3) ? 1 : rng.range(1, 4), fx = rng.range(0, 1), fy = rng.range(0, 1);
    const r = ME.fitRect(meta, box, 'cover', z, fx, fy);
    deepEqual([r.dx, r.dy, r.dw, r.dh], [box.x, box.y, box.w, box.h]);
    deepEqual([r.bx, r.by, r.bw, r.bh], [box.x, box.y, box.w, box.h]);
    const eps = 1e-6 * Math.max(meta.w, meta.h);
    assert.ok(r.sx >= -eps && r.sy >= -eps && r.sx + r.sw <= meta.w + eps && r.sy + r.sh <= meta.h + eps, JSON.stringify({ meta, box, r }));
    approx(r.sw / r.sh, box.w / box.h, 1e-6 * (box.w / box.h), 'uniform scale');
    const s = z * Math.max(box.w / meta.w, box.h / meta.h);
    approx(r.sw, box.w / s, 1e-6 * r.sw, 'visible width = bw / s');
  }
  const meta = { w: 2000, h: 1000 }, box = { x: 0, y: 0, w: 100, h: 100 };
  deepEqual(ME.fitRect(meta, box, 'cover', 1, 0, 0.5), { bx: 0, by: 0, bw: 100, bh: 100, sx: 0, sy: 0, sw: 1000, sh: 1000, dx: 0, dy: 0, dw: 100, dh: 100 });
  assert.equal(ME.fitRect(meta, box, 'cover', 1, 1, 0.5).sx, 1000, 'focus 1 → right edge');
  assert.equal(ME.fitRect(meta, box, 'cover', 1, 0.5, 0.5).sx, 500, 'centred');
  assert.equal(ME.fitRect(meta, box, 'cover', 2, 0.5, 0.5).sw, 500, 'zoom 2 halves the visible source');
  assert.equal(ME.fitRect(meta, box, 'nonsense', 1).sx, 500, 'unknown fits are cover; the default focus is the centre');
});

test('fitRect contain / soft: the whole image when it fits (centred), clipped to the box and placed by the focus when zoomed', () => {
  const rng = stream('media-fit-contain');
  for (let n = 0; n < 3000; n++) {
    const meta = { w: rng.int(1, 5000), h: rng.int(1, 5000) };
    const box = { x: rng.range(-500, 500), y: rng.range(-500, 500), w: rng.range(1, 2000), h: rng.range(1, 2000) };
    const z = rng.chance(0.4) ? 1 : rng.range(1, 4), fx = rng.range(0, 1), fy = rng.range(0, 1);
    const fit = rng.pick(['contain', 'soft']);
    const r = ME.fitRect(meta, box, fit, z, fx, fy);
    const e = 1e-6 * Math.max(box.w, box.h, 1);
    assert.ok(r.dx >= box.x - e && r.dy >= box.y - e && r.dx + r.dw <= box.x + box.w + e && r.dy + r.dh <= box.y + box.h + e,
      'dest inside the box ' + JSON.stringify({ meta, box, r }));
    const se = 1e-6 * Math.max(meta.w, meta.h);
    assert.ok(r.sx >= -se && r.sy >= -se && r.sx + r.sw <= meta.w + se && r.sy + r.sh <= meta.h + se, 'source inside the image');
    const s = z * Math.min(box.w / meta.w, box.h / meta.h);
    approx(r.dw, r.sw * s, 1e-6 * Math.max(1, r.dw), 'dest = source × s (x)');
    approx(r.dh, r.sh * s, 1e-6 * Math.max(1, r.dh), 'dest = source × s (y)');
    if (z === 1) {
      approx(r.sw, meta.w, 1e-6 * meta.w, 'unzoomed: the whole width');
      approx(r.sh, meta.h, 1e-6 * meta.h, 'unzoomed: the whole height');
      approx(r.dx + r.dw / 2, box.x + box.w / 2, e * 10, 'centred');
      approx(r.dy + r.dh / 2, box.y + box.h / 2, e * 10, 'centred');
    }
    deepEqual(r, ME.fitRect(meta, box, fit === 'soft' ? 'contain' : 'soft', z, fx, fy), 'soft places the sharp copy like contain');
  }
  const r = ME.fitRect({ w: 2000, h: 1000 }, { x: 0, y: 0, w: 100, h: 100 }, 'contain', 1, 0, 0);
  deepEqual(r, { bx: 0, by: 0, bw: 100, bh: 100, dx: 0, dy: 25, dw: 100, dh: 50, sx: 0, sy: 0, sw: 2000, sh: 1000 });
  const zoomed = ME.fitRect({ w: 2000, h: 1000 }, { x: 0, y: 0, w: 100, h: 100 }, 'contain', 4, 1, 0.5);
  deepEqual([zoomed.dx, zoomed.dw, zoomed.sx, zoomed.sw], [0, 100, 1500, 500], 'overflow placed by the focus: the right end');
  const out = {};
  assert.equal(ME.fitRect({ w: 10, h: 10 }, { x: 0, y: 0, w: 5, h: 5 }, 'contain', 1, 0.5, 0.5, out), out, 'writes into out');
});

// ---- still tiers (§11.4.6) --------------------------------------------------------------------------------------------

test('tier: the smallest tier ≥ need, capped at the long side and at 24 MP; monotone in need', () => {
  const photo = { w: 4032, h: 3024 };
  deepEqual([100, 512, 513, 1024, 2000, 4000].map((n) => ME.tier(n, photo)), [512, 512, 1024, 1024, 2048, 4032]);
  const big = { w: 8000, h: 6000 };
  assert.equal(ME.tier(5000, big), Math.floor(Math.sqrt(24e6 * 8000 / 6000)), '24 MP cap');
  assert.equal(ME.tier(1e9, { w: 300, h: 200 }), 300, 'never larger than the source');
  assert.equal(ME.tier(NaN, photo), 512);
  const rng = stream('media-tier');
  for (let n = 0; n < 500; n++) {
    const meta = { w: rng.int(1, 12000), h: rng.int(1, 12000) };
    const long = Math.max(meta.w, meta.h), short = Math.min(meta.w, meta.h);
    let last = 0;
    for (let need = 0; need <= 10000; need += rng.int(1, 700)) {
      const px = ME.tier(need, meta);
      assert.ok(px >= last, 'monotone');
      assert.ok(px <= long && px * (px * short / long) <= 24e6 + 1, 'caps');
      if (px < need) assert.ok(px === long || px === 8192 || px * px * short / long > 24e6 - 2 * px, 'below need only when capped');
      last = px;
    }
  }
});

test('metaOf / metaHash: the plan subset — geometry and timing count, names and flags do not', () => {
  deepEqual(ME.metaOf(SEA), { kind: 'video', w: 1920, h: 1080, dur: 12.512, fps: 29.97, frames: 375, rot: 0, alpha: false, anim: false });
  assert.equal(ME.metaHash(SEA), ME.metaHash(withField(SEA, { name: 'other.mp4', pool: true, ai: SKY.ai, bytes: 1 })));
  assert.notEqual(ME.metaHash(SEA), ME.metaHash(withField(SEA, { w: 1280 })));
  assert.notEqual(ME.metaHash(SEA), ME.metaHash(withField(SEA, { alpha: true })));
});
