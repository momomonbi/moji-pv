/* 文字PVメーカー v2 — original work. Tests: the real media store, its decode sessions and the import probe in Node, over the WebCodecs stand-ins of tests/helpers/fake_webcodecs.js (DESIGN_2_1 §11.4.5–§11.4.7, §11.4.13; the review's media runtime fixes). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const WC = require('../helpers/fake_webcodecs.js');
const { load } = require('../helpers/load.js');

const wc = WC.install();
const MV = load();
const MEDIA = MV.use('core/media');
const SM = MV.use('media/samples');
const SN = MV.use('media/sniff');
const ST = MV.use('media/host/store');
const SES = MV.use('media/host/session');
const PR = MV.use('media/host/probe');
const STAGE = MV.use('ui/stage');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A video of n frames at fps (constant rate, a key frame every `gop`), w × h coded px; its bytes are placeholders (the
// fake decoder outputs a frame for any chunk).
function video(digit, w, h, n, fps, gop) {
  const cts = [], dur = [], key = [], off = [], size = [];
  for (let d = 0; d < n; d++) { cts.push(d); dur.push(1); key.push(d % gop === 0 ? 1 : 0); off.push(d * 10); size.push(10); }
  const table = SM.build({ timescale: fps, cts, dur, key, off, size });
  const id = 'a' + String(digit).repeat(24);
  const entry = { id, kind: 'video', mime: 'video/webm', w, h, anim: false, alpha: false, fps, frames: n };
  const track = { codec: 'vp8', description: null, codedW: w, codedH: h, w, h, rot: 0, color: null, alpha: false, anim: false };
  return { id, entry, table, track, blob: new Blob([new Uint8Array(n * 10)]) };
}

function photo(digit, w, h) {
  const id = 'a' + String(digit).repeat(24);
  return { id, entry: { id, kind: 'image', mime: 'image/png', w, h, anim: false, alpha: false }, blob: new Blob([new Uint8Array(64)]) };
}

// The real store over these assets (the device store's blobs and sample tables), with the recording canvas factory.
function storeOf(assets, prefer) {
  const byId = new Map(assets.map((x) => [x.id, x]));
  return ST.createMediaStore({
    blobs: {
      get: async (id) => (byId.has(id) ? byId.get(id).blob : null),
      index: async (id) => { const x = byId.get(id); return x && x.table ? { v: MEDIA.INDEX_V, table: SM.toData(x.table), track: x.track } : null; },
      thumbs: async () => null,
    },
    entries: (id) => (byId.has(id) ? byId.get(id).entry : null),
    canvas: wc.canvas,
    prefer: prefer || 'hardware',
  });
}

// --- MR-1: the stage's look-ahead -------------------------------------------------------------------------------------

test('ui/stage.lookAhead lists the media of t and of every frame up to t + 8/30, in order (§11.4.5 step 1)', () => {
  const asked = [];
  const engine = { mediaAt: (t) => { asked.push(t); return [{ id: 'x', m: t }, { id: 'y', m: t }]; } };
  const list = STAGE.lookAhead(engine, 2);
  const times = Array.from({ length: 9 }, (_, k) => 2 + k / 30);
  assert.equal(STAGE.LOOK_AHEAD, 8);
  assert.deepEqual(asked, times);
  assert.deepEqual(list.map((x) => x.m), times.flatMap((t) => [t, t]));
});

test('preview playback through the stage look-ahead: after the cold start every draw shows its exact frame, decoded once', async () => {
  const v = video(1, 1920, 1080, 300, 30, 60);
  const store = storeOf([v]);
  store.frame(v.id, 0, { exact: false });             // bytes and sample table
  await sleep(30);
  const engine = { mediaAt: (t) => [{ id: v.id, m: t, px: 1280, blur: 0 }] };
  const ticks = 120, cold = 30;                        // 2 s of 60-Hz draws; the first 0.5 s is the cold start
  let right = 0;
  let seeks0 = 0;
  for (let k = 0; k < ticks; k++) {
    const t = k / 60;
    const f = store.frame(v.id, t, { px: 1280, blur: 0, exact: false, thumb: false });
    if (k === cold) seeks0 = store.stats().seeks;
    if (k >= cold && f && f.exact && f.index === SM.sampleAt(v.table, t)) right++;
    store.want(STAGE.lookAhead(engine, t));           // as the stage's mediaAfter does after each frame while playing
    await sleep(16);
  }
  const st = store.stats();
  assert.ok(right >= 0.95 * (ticks - cold), 'right and exact after the cold start: ' + right + ' of ' + (ticks - cold));
  assert.ok(st.seeks - seeks0 === 0, 'no seek back after the cold start: ' + (st.seeks - seeks0));
  assert.ok(st.fed <= SM.sampleAt(v.table, ticks / 60) + 20, 'each frame fed about once: ' + st.fed);
  store.dispose();
});

// --- MR-3, MR-4: sessions ---------------------------------------------------------------------------------------------

test('two 4096×2160 videos in one frame: an export fork readies both, and the preview opens no decoder per draw', async () => {
  const a = video(1, 4096, 2160, 90, 30, 30), b = video(2, 4096, 2160, 90, 30, 30), c = video(3, 4096, 2160, 90, 30, 30);
  assert.ok(2 * 4096 * 2160 > ST.SESSION_PIXELS, 'the two exceed the session bound');
  const store = storeOf([a, b, c]);
  const bothExact = (exp, what) => {
    for (const x of [a, b]) {
      const f = exp.frame(x.id, 0.5, { exact: true });
      assert.ok(f && f.exact && f.index === 15, what + ': the frame of ' + x.id.slice(0, 3) + ' is held and exact');
    }
  };
  let exp = store.fork();
  await exp.ready([{ id: a.id, m: 0.5 }, { id: b.id, m: 0.5 }]);
  bothExact(exp, 'both opened by one ready()');
  exp.dispose();
  // a is already held when b comes in (no request of a waits): the frame's own media still do not close each other
  exp = store.fork();
  await exp.ready([{ id: a.id, m: 0.5 }]);
  await exp.ready([{ id: a.id, m: 0.5 }, { id: b.id, m: 0.5 }]);
  bothExact(exp, 'b joining a');
  // the bound holds again for media the frame no longer draws: a frame of c alone closes a and b
  await exp.ready([{ id: c.id, m: 0.5 }]);
  assert.equal(exp.stats().sessions, 1, 'only the session of the frame being readied stays open');
  exp.dispose();
  // the preview drawing both (each frame drawn, then drawn again once the store has it, as a paused stage does): the
  // sessions settle, no decoder is made per draw, and the frames come exact
  for (let k = 0; k < 5; k++) { for (const x of [a, b]) store.frame(x.id, k / 30, { exact: false }); await sleep(10); }
  const made = wc.counts.decoders;
  let exact = 0;
  for (let k = 5; k < 35; k++) {
    for (const x of [a, b]) store.frame(x.id, k / 30, { exact: false });
    await sleep(10);
    for (const x of [a, b]) { const f = store.frame(x.id, k / 30, { exact: false }); if (f && f.exact) exact++; }
  }
  assert.ok(wc.counts.decoders - made <= 1, 'decoders made while drawing both: ' + (wc.counts.decoders - made));
  assert.ok(exact >= 0.9 * 60, 'the redrawn frames of both are exact: ' + exact + ' of 60');
  store.dispose();
});

test('a scrub across six 4K clips, each decode slower than a draw, keeps the open sessions within the bound', async () => {
  const clips = [8, 9, 'b', 'c', 'd', 'e'].map((d) => video(d, 3840, 2160, 300, 30, 60));
  assert.ok(2 * 3840 * 2160 <= ST.SESSION_PIXELS && 3 * 3840 * 2160 > ST.SESSION_PIXELS, 'two fit in the bound, three do not');
  const store = storeOf(clips);
  for (const v of clips) store.frame(v.id, 0, { exact: false });   // bytes and sample tables
  await sleep(50);
  // a paused scrub: each 16-ms draw lands in the next clip, mid-GOP, while a 4K frame takes 25 ms to decode, so the
  // request of every clip drawn before still waits when the next one opens
  let peak = 0, last = null;
  wc.settings.delay = 25;
  try {
    for (let k = 0; k < 60; k++) {
      last = { id: clips[k % clips.length].id, m: 1 + (k % 7) * 0.13 };
      store.frame(last.id, last.m, { exact: false });
      peak = Math.max(peak, store.stats().sessionPixels);
      await sleep(16);
    }
  } finally {
    wc.settings.delay = 1;
  }
  assert.ok(peak <= ST.SESSION_PIXELS, 'Σ during the scrub: ' + (peak / 1e6).toFixed(1) + ' MP');
  await sleep(300);
  assert.ok(store.stats().sessionPixels <= ST.SESSION_PIXELS, 'Σ after it: ' + (store.stats().sessionPixels / 1e6).toFixed(1) + ' MP');
  const f = store.frame(last.id, last.m, { exact: false });
  assert.ok(f && f.exact, 'the clip the scrub stopped on gets its exact frame');
  store.dispose();
});

test("a draw's look-ahead is part of the draw: two coming 4K clips beside the one shown open no decoder per draw", async () => {
  const [a, c, d] = [1, 2, 3].map((k) => video(k, 3840, 2160, 90, 30, 30));
  const store = storeOf([a, c, d]);
  await store.check([a.id, c.id, d.id]);
  store.want([a, c, d].map((v) => ({ id: v.id, m: 0 })));   // sample tables only: no session opens before them
  await sleep(30);
  assert.equal(store.stats().sessions, 0);
  const made = wc.counts.decoders;
  for (let k = 0; k < 20; k++) {                       // playing: the frame of a, then its look-ahead reaching two cuts
    const t = k / 60;
    store.frame(a.id, t, { exact: false });
    store.want([{ id: a.id, m: t }, { id: c.id, m: 0 }, { id: d.id, m: 0 }]);
    await sleep(16);
  }
  assert.equal(wc.counts.decoders - made, 3, 'one decoder per clip');
  store.dispose();
});

test('a session closed while the browser is asked about its codec never makes a decoder', async () => {
  const v = video(4, 1280, 720, 30, 30, 10);
  const made = wc.counts.decoders;
  wc.settings.configDelay = 20;
  try {
    const s = SES.createVideoSession({ track: PR.sessionTrack(v.table, v.track), read: PR.blobReader(v.blob), prefer: 'hardware' });
    const p = s.request(5);
    s.close();
    await assert.rejects(p, (e) => e.code === 'closed');
    await sleep(60);
  } finally {
    wc.settings.configDelay = 0;
  }
  assert.equal(wc.counts.decoders - made, 0, 'no decoder is left configured');
});

// --- MR-5: still blur --------------------------------------------------------------------------------------------------

test('the blur of a still is made from its tier, by level × copy long side / px: the same on screen at any resolution', async () => {
  const big = photo(5, 4032, 3024), small = photo(6, 1600, 1200);
  const store = storeOf([big, small]);
  const copyOf = async (p, px, blur) => {
    const from = wc.canvas.draws.length;
    await store.ready([{ id: p.id, m: 0, px, blur }]);
    const f = store.frame(p.id, 0, { px, blur, exact: false, thumb: false });
    const draw = wc.canvas.draws.slice(from).find((d) => d.filter !== 'none');
    const sigma = Number(/^blur\(([\d.]+)px\)$/.exec(draw.filter)[1]);
    return { f, sigma, w: draw.canvas.width, h: draw.canvas.height, tier: MEDIA.tier(px, p.entry) };
  };
  const steps = (sigma) => Math.pow(2, Math.round(Math.log2(sigma) * 12) / 12);   // σ in 1/12-octave steps
  // level 2 at 1472 px: the 2048 tier, not downscaled, σ = 2 × 2048 / 1472
  let x = await copyOf(big, 1472, 2);
  assert.ok(x.f.exact, 'the preview finds the copy ready() made (same key)');
  assert.equal(x.tier, 2048);
  assert.deepEqual([x.w, x.h, x.f.w], [2048, 1536, 2048], 'the copy is the tier, never the 4032-px source');
  assert.equal(x.sigma, steps(2 * 2048 / 1472));
  // level 8: the tier halved, σ in copy px
  x = await copyOf(big, 1472, 8);
  assert.deepEqual([x.w, x.h], [1024, 768]);
  assert.equal(x.sigma, steps(8 * 1024 / 1472));
  // the blur on screen (σ × px / copy long side) is the level, whatever the photo's own size
  for (const p of [big, small]) {
    for (const blur of [2, 8, 16]) {
      const y = await copyOf(p, 1300, blur);
      assert.ok(Math.abs((y.sigma * 1300) / Math.max(y.w, y.h) - blur) <= 0.05 * blur, p.id.slice(0, 3) + ' blur ' + blur + ': ' + y.sigma);
      assert.ok(Math.max(y.w, y.h) <= y.tier, 'never larger than its tier');
    }
  }
  store.dispose();
});

test('a blurred photo drawn 20 % larger or smaller (a window resize) makes a few new copies, not one per px', async () => {
  const p = photo(7, 4032, 3024);
  const store = storeOf([p]);
  await store.ready([{ id: p.id, m: 0, px: 1300, blur: 8 }]);
  const blurred = () => wc.canvas.draws.filter((d) => d.filter !== 'none');
  let exact = 0, draws = 0, copies = 0;
  // up 20 %, then down to 20 % below where it began (the copies of the way up are found again on the way down)
  for (const [from, to] of [[1300, 1560], [1560, 1040]]) {
    const made = blurred().length;
    for (let k = 0; k <= 40; k++) {
      const px = Math.round(from + ((to - from) * k) / 40);
      const f = store.frame(p.id, 0, { px, blur: 8, exact: false, thumb: false });
      draws++;
      if (f && f.exact) exact++;
      await sleep(1);
      const got = store.frame(p.id, 0, { px, blur: 8, exact: false, thumb: false });
      const copy = wc.canvas.draws.find((d) => d.filter !== 'none' && d.canvas.width === got.w && d.canvas.height === got.h
        && d.image && got.image && got.image.source === d.canvas);
      const sigma = Number(/^blur\(([\d.]+)px\)$/.exec(copy.filter)[1]);
      assert.ok(Math.abs((sigma * px) / Math.max(got.w, got.h) - 8) <= 0.05 * 8, 'the blur on screen at ' + px + ' px: ' + (sigma * px / Math.max(got.w, got.h)));
    }
    const n = blurred().length - made;
    assert.ok(n <= 4, 'copies made from ' + from + ' to ' + to + ' px: ' + n);
    copies += n;
  }
  assert.ok(exact >= draws - copies, 'draws that found their copy: ' + exact + ' of ' + draws);
  store.dispose();
});

// --- MR-6: events -----------------------------------------------------------------------------------------------------

test("an export fork's decodes and bakes reach its own listeners only, not the preview's", async () => {
  const v = video(7, 1920, 1080, 60, 30, 30);
  const root = storeOf([v]);
  await root.ready([{ id: v.id, m: 0 }]);            // the shared loads (bytes, sample table) are everyone's
  await sleep(10);
  const seen = { root: 0, fork: 0 };
  root.on('ready', () => { seen.root++; });
  const fork = root.fork();
  fork.on('ready', () => { seen.fork++; });
  for (let i = 0; i < 20; i++) {
    const t = i / 30;
    fork.want([1, 2, 3].map((k) => ({ id: v.id, m: t + k / 30, px: 1472, blur: 3 })));
    await fork.ready([{ id: v.id, m: t, px: 1472, blur: 3 }]);
    fork.frame(v.id, t, { px: 1472, blur: 3, exact: true, thumb: false });
  }
  await sleep(50);
  assert.ok(seen.fork > 0, 'the fork hears its bakes: ' + seen.fork);
  assert.equal(seen.root, 0, "the preview's store hears none of them");
  // a frame the fork does not hold (no blur, so nothing is baked): its session decodes it on request
  const heard = seen.fork;
  const m = 1.8;
  assert.equal(fork.frame(v.id, m, { exact: false }).exact, false, 'not held yet');
  await sleep(50);
  assert.ok(fork.frame(v.id, m, { exact: false }).exact, 'decoded');
  assert.ok(seen.fork > heard, 'the fork hears its decode');
  assert.equal(seen.root, 0, "the preview's store does not");
  fork.dispose();
  root.dispose();
});

// --- MR-8, MR-9: import ------------------------------------------------------------------------------------------------

// A JPEG: SOI, `app` APP2 segments of 65,533 payload bytes (a large ICC profile), then SOF0 w × h, SOS and EOI.
function jpegBytes(app, w, h) {
  const parts = [[0xff, 0xd8]];
  for (let k = 0; k < app; k++) {
    const seg = new Uint8Array(4 + 65533);
    seg.set([0xff, 0xe2, 0xff, 0xff]);
    parts.push(seg);
  }
  if (w) parts.push([0xff, 0xc0, 0, 17, 8, h >> 8, h & 255, w >> 8, w & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  parts.push([0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0], [0xff, 0xd9]);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

test('a JPEG whose frame header lies past 64 KB of ICC data is measured and refused before anything is decoded', async () => {
  const huge = jpegBytes(2, 20000, 12000);
  assert.equal(SN.sniff(huge.subarray(0, SN.HEAD)).w, undefined, 'the sniffed head alone does not have the size');
  assert.deepEqual(await PR.jpegSize(new Blob([huge]), huge.subarray(0, SN.HEAD)), { w: 20000, h: 12000 });
  const fine = jpegBytes(3, 4000, 3000);
  assert.deepEqual(await PR.jpegSize(new Blob([fine]), fine.subarray(0, SN.HEAD)), { w: 4000, h: 3000 });
  const bitmaps = wc.bitmaps.length;
  await assert.rejects(PR.importFile(new File([huge], 'big.jpg'), {}), (e) => e.code === 'tooBig');
  await assert.rejects(PR.importFile(new File([jpegBytes(2, 0, 0)], 'none.jpg'), {}), (e) => e.code === 'broken');
  assert.equal(wc.bitmaps.length, bitmaps, 'nothing was decoded');
});

test('the import keeps no full-size frame for the filmstrip: each tile is drawn from the decoded frame', async () => {
  const bytes = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'media', 'vp9.webm'));
  const bitmaps = wc.bitmaps.length, draws = wc.canvas.draws.length;
  const r = await PR.importFile(new File([bytes], 'clip.webm'), { canvas: wc.canvas });
  assert.deepEqual([r.entry.kind, r.entry.w, r.entry.h, r.entry.frames], ['video', 64, 36, 25]);
  assert.deepEqual(wc.bitmaps.slice(bitmaps).filter((b) => b.source instanceof wc.VideoFrame).length, 0,
    'no ImageBitmap copy of a decoded frame');
  const sheet = wc.canvas.made.find((c) => c.width === 64 * PR.STRIP && c.height === 36);   // tiles of at most TILE px
  assert.ok(sheet, 'the 12-tile sheet');
  const tiles = wc.canvas.draws.slice(draws).filter((d) => d.canvas === sheet);
  assert.equal(tiles.length, PR.STRIP, 'one draw per tile');
  assert.ok(tiles.every((d) => d.image instanceof wc.VideoFrame), 'each tile drawn straight from a decoded frame');
});
