/* 文字PVメーカー v2 — original work. Tests for audio/voice (DESIGN_2_2 §5.2): the joint voice pass of 曲から下書き and 歌ハメ on synthetic songs, the stored record, the loudness fallback. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');
const G = require('../helpers/song_gen.js');

const MV = load();
const VO = MV.use('audio/voice');
const A = MV.use('audio/analyze');
const DG = MV.use('audio/digest');

// Each synthetic song is analyzed once per run (a 60 s pass takes about half a second).
const memo = new Map();
function analyzed(opts) {
  const key = JSON.stringify(opts);
  if (!memo.has(key)) {
    const s = G.song(opts);
    memo.set(key, { s, res: VO.analyzeSync(s.channels, s.rate) });
  }
  return memo.get(key);
}

// Phrase recall within ±0.15 s of the true phrase starts, and the median error of the hits, from the stored record.
function recall(opts) {
  const { s, res } = analyzed(opts);
  const cands = VO.candidatesIn(VO.decode(VO.encode(res)), 0, Infinity).filter((c) => c.kind === 'phrase');
  const errs = [];
  for (const p of s.phrases) {
    let best = Infinity;
    for (const c of cands) best = Math.min(best, Math.abs(c.t - p.start));
    if (best <= 0.15) errs.push(best);
  }
  errs.sort((a, b) => a - b);
  return { recall: errs.length / s.phrases.length, median: errs[errs.length >> 1], cands, s };
}

test('phrase starts of a clean mix: recall ≥ 0.75 within ±0.15 s, median error ≤ 0.03 s', () => {
  const r = recall({ seconds: 60, seed: 1 });
  assert.ok(r.recall >= 0.75, 'recall ' + r.recall);
  assert.ok(r.median <= 0.03, 'median error ' + r.median);
  // nothing much before the voice comes in: drums, bass and pad are not phrases (the median filter drops the hits)
  const intro = r.cands.filter((c) => c.t < r.s.phrases[0].start - 0.3);
  assert.ok(intro.length <= 2, 'candidates before the voice: ' + intro.length);
});

test('phrase starts with a long reverb on the voice: recall ≥ 0.75', () => {
  const r = recall({ seconds: 60, seed: 1, reverb: 0.5 });
  assert.ok(r.recall >= 0.75, 'recall ' + r.recall);
});

// The voice is centred: per bin, what the side channel also carries is not voice. A hard-panned lead playing phrases of
// its own (a second synthetic voice, left only) must not make phrase starts, and must not hide the centred voice's.
// (Without the centring, measured: the centred voice's recall falls to 0.25 and every start of the lead is taken.)
test('a hard-panned lead is not the voice (per-bin centring)', () => {
  const A = G.song({ seconds: 40, seed: 7, acc: 0, pan: 0 });
  const B = G.song({ seconds: 40, seed: 8, acc: 0, pan: -1 });
  const L = new Float32Array(A.channels[0].length), R = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) { L[i] = A.channels[0][i] + B.channels[0][i]; R[i] = A.channels[1][i] + B.channels[1][i]; }
  const cands = VO.candidatesIn(VO.decode(VO.encode(VO.analyzeSync([L, R], A.rate))), 0, Infinity).filter((c) => c.kind === 'phrase');
  const near = (t, list) => list.some((p) => Math.abs(p.start - t) <= 0.15);
  const hitA = A.phrases.filter((p) => cands.some((c) => Math.abs(c.t - p.start) <= 0.15)).length;
  assert.ok(hitA / A.phrases.length >= 0.75, 'centred voice recall ' + hitA + '/' + A.phrases.length);
  // the lead's own starts (away from the voice's phrases) give no candidate
  const leadOnly = B.phrases.filter((p) => !A.phrases.some((q) => Math.abs(q.start - p.start) <= 0.5
    || (p.start > q.start && p.start < q.end + 0.3)));
  assert.ok(leadOnly.length >= 2, 'the mix has lead starts of its own');
  assert.deepEqual(cands.filter((c) => !near(c.t, A.phrases) && near(c.t, leadOnly)), []);
});

test('the pass is deterministic, its progress rises within [0, 1], and the result has its shape', () => {
  const s = G.song({ seconds: 20, seed: 3 });
  const gen = VO.analyze(s.channels, s.rate, { step: 300 });
  const seen = [];
  let r;
  for (;;) { r = gen.next(); if (r.done) break; seen.push(r.value); }
  assert.ok(seen.length >= 3);
  for (let i = 0; i < seen.length; i++) {
    assert.ok(seen[i] >= 0 && seen[i] <= 1, 'progress ' + seen[i]);
    if (i) assert.ok(seen[i] > seen[i - 1], 'rising');
  }
  const res = r.value;
  assert.equal(res.hz, 100);
  assert.equal(res.a.length, Math.ceil(20 * 100));
  assert.deepEqual(VO.encode(VO.analyzeSync(s.channels, s.rate)), VO.encode(res), 'the same record twice');
  for (let i = 1; i < res.phrases.length; i++) assert.ok(res.phrases[i].t >= res.phrases[i - 1].t, 'time order');
  for (const p of res.phrases) assert.ok(p.s >= 0 && p.s <= 1 && typeof p.phrase === 'boolean');
  for (const p of res.peaks) assert.ok(p.s >= VO.VC.PEAK_MIN && p.s <= 1);
  for (let i = 1; i < res.peaks.length; i++) assert.ok(res.peaks[i].t - res.peaks[i - 1].t >= VO.VC.PEAK_SEP_S - 1e-9);
});

test('mono input and silence', () => {
  const s = G.song({ seconds: 20, seed: 4 });
  const mono = VO.analyzeSync([s.channels[0]], s.rate);
  assert.ok(mono.phrases.some((p) => p.phrase), 'a mono mix still has phrase starts');
  assert.equal(mono.a.length, 2000);
  const quiet = VO.analyzeSync([new Float32Array(48000 * 5), new Float32Array(48000 * 5)], 48000);
  assert.deepEqual(quiet.phrases, []);
  assert.deepEqual(quiet.peaks, []);
  assert.ok(quiet.a.every((x) => x === 0));
  assert.throws(() => VO.analyzeSync([], 48000), (e) => e.code === 'input');
  assert.throws(() => VO.analyzeSync([new Float32Array(10)], 0), (e) => e.code === 'input');
});

test('encode / decode round trip: times within 5 ms, strengths within 1/127, the phrase bits; memoized', () => {
  const { res } = analyzed({ seconds: 60, seed: 1 });
  const rec = VO.encode(res);
  assert.deepEqual(Object.keys(rec), ['v', 'hz', 'act', 'peaks', 'phrases']);
  assert.equal(rec.v, 1);
  assert.equal(rec.hz, 25);
  const dec = VO.decode(rec);
  assert.equal(VO.decode(rec), dec, 'memoized by identity');
  assert.equal(dec.act.length, Math.ceil(res.a.length / 4));
  for (let j = 0; j < dec.act.length; j++) {
    let m = 0;
    for (let k = 4 * j; k < Math.min(res.a.length, 4 * j + 4); k++) m += res.a[k];
    m /= Math.min(res.a.length, 4 * j + 4) - 4 * j;
    assert.ok(Math.abs(dec.act[j] - Math.min(1, m)) <= 0.5 / 255 + 1e-6, 'act ' + j);
  }
  assert.equal(dec.ph.t.length, res.phrases.length);
  res.phrases.forEach((p, i) => {
    assert.ok(Math.abs(dec.ph.t[i] - p.t) <= 0.005 + 1e-9);
    assert.ok(Math.abs(dec.ph.s[i] - p.s) <= 1 / 127);
    assert.equal(dec.ph.phrase[i], p.phrase ? 1 : 0);
  });
  assert.equal(dec.pt.length, res.peaks.length);
  res.peaks.forEach((p, i) => {
    assert.ok(Math.abs(dec.pt[i] - p.t) <= 0.005 + 1e-9);
    assert.ok(Math.abs(dec.ps[i] - p.s) <= 1 / 255);
  });
  // LEB128 deltas: a gap longer than 1.27 s takes two bytes
  const far = VO.decode(VO.encode({ hz: 100, a: new Float32Array(8), peaks: [{ t: 3, s: 0.5 }, { t: 700.01, s: 1 }],
    phrases: [{ t: 0, s: 1, phrase: true }, { t: 2.5, s: 0.25, phrase: false }] }));
  assert.deepEqual([...far.pt], [3, 700.01]);
  assert.deepEqual([...far.ph.t], [0, 2.5]);
  assert.deepEqual([...far.ph.phrase], [1, 0]);
  // a record of an older build (no phrases) decodes without them; a damaged one throws 'format'
  const older = Object.assign({}, rec);
  delete older.phrases;
  assert.equal(VO.decode(older).ph, null);
  assert.equal(VO.hasPhrases(older), false);
  assert.equal(VO.hasPhrases(rec), true);
  assert.deepEqual(VO.candidatesIn(VO.decode(older), 0, 100), []);
  assert.throws(() => VO.decode({ v: 1, hz: 25, act: 'AA==', peaks: DG.toBase64(Uint8Array.from([0x80])) }), (e) => e.code === 'format');
  assert.throws(() => VO.decode({ v: 2, hz: 25, act: '', peaks: '' }), (e) => e.code === 'format');
});

test('candidatesIn and peaksIn return the window [a, b) in time order', () => {
  const dec = VO.decode(VO.encode(analyzed({ seconds: 60, seed: 1 }).res));
  const all = VO.candidatesIn(dec, 0, Infinity);
  const part = VO.candidatesIn(dec, 10, 20);
  assert.ok(part.length > 0 && part.length < all.length);
  assert.deepEqual(part, all.filter((c) => c.t >= 10 && c.t < 20));
  for (let i = 1; i < all.length; i++) assert.ok(all[i].t >= all[i - 1].t);
  for (const c of all) assert.ok(c.kind === 'phrase' || c.kind === 'weak');
  for (const c of all.filter((x) => x.kind === 'weak')) assert.ok(c.s <= VO.VC.WEAK + 1e-6);
  const peaks = VO.peaksIn(dec, 10, 20);
  assert.ok(peaks.length > 0);
  for (const p of peaks) assert.ok(p.t >= 10 && p.t < 20);
  // the voiced span: from the first strong phrase start to the end of the activity (+ TAIL_S)
  const v = VO.voiced(all, dec.act, dec.hz);
  const { s } = analyzed({ seconds: 60, seed: 1 });
  assert.ok(Math.abs(v.t0 - s.phrases[0].start) < 0.2, 'voiced from ' + v.t0);
  assert.ok(v.t1 >= s.phrases[s.phrases.length - 1].end && v.t1 <= 60, 'voiced to ' + v.t1);
  assert.equal(VO.voiced([], dec.act, dec.hz), null);
});

test('fromDigest: phrase starts from the loudness digest alone, increasing, strengths halved', () => {
  const digest = corpus.songDigest().digest;
  const list = VO.fromDigest(digest);
  assert.ok(list.length > 0);
  for (let i = 1; i < list.length; i++) assert.ok(list[i].t > list[i - 1].t);
  for (const c of list) {
    assert.equal(c.kind, 'phrase');
    assert.ok(c.s >= 0 && c.s <= 0.5);
    assert.ok(Math.abs(c.t * 20 - Math.round(c.t * 20)) < 1e-9, 'on the 20 Hz frames');
  }
  assert.deepEqual(VO.fromDigest(digest), list, 'deterministic');
  const act = VO.digestActivity(digest);
  assert.equal(act.hz, 20);
});

// audio/voice brings its own band flux: the tempo analysis is untouched (a frozen fingerprint of its output).
test('audio/analyze output is unchanged', () => {
  const s = G.song({ seconds: 20, seed: 5, rate: 44100 });
  const a = A.analyzeSync(s.channels, s.rate);
  const hash = (arr) => crypto.createHash('sha256').update(Buffer.from(arr.buffer)).digest('hex').slice(0, 16);
  assert.equal(a.bpm, 120.03010605809378);
  assert.equal(a.offset, 0.006148127356563293);
  assert.equal(hash(a.onset.strength), '72b79216994c1cdf');
  assert.equal(hash(a.env.loud), '79216e46d4552368');
});
