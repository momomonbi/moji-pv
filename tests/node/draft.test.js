/* 文字PVメーカー v2 — original work. Tests for core/draft (曲から下書き, DESIGN_2_2 §5.2): the monotone alignment of line starts onto phrase-start candidates, and end to end on synthetic songs. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const G = require('../helpers/song_gen.js');

const MV = load();
const DR = MV.use('core/draft');
const VO = MV.use('audio/voice');
const TM = MV.use('core/timing');
const B = MV.use('core/beats');
const { DRAFT } = DR;

// Lines to draft: ids r0…, current starts every 2 s from 1 s, weights w (default 1).
function linesOf(n, opts) {
  const o = opts || {};
  return Array.from({ length: n }, (_, i) => ({ id: 'r' + i, t0: 1 + 2 * i, draft: o.draft ? o.draft(i) : true,
    w: o.w ? o.w[i] : 1 }));
}

function placed(res) {
  return new Map(res.proposals.concat(res.kept).map((x) => [x.lineId, x]));
}

test('exact candidates are chosen exactly; confidences; deterministic', () => {
  const truth = [10, 13, 16.5, 19, 23];
  const w = [3, 3.5, 2.5, 4, 3];
  const cands = truth.map((t) => ({ t, s: 0.8, kind: 'phrase' }));
  const input = { lines: linesOf(5, { w }), cands, voiced: { t0: 10, t1: 26 }, duration: 30, grid: null, snap: 'off' };
  const res = DR.draftStarts(input);
  const got = placed(res);
  truth.forEach((t, i) => {
    assert.equal(got.get('r' + i).to, t, 'line ' + i);
    assert.equal(got.get('r' + i).conf, 'high');
    assert.equal(got.get('r' + i).kind, 'phrase');
  });
  assert.deepEqual(DR.draftStarts(input), res, 'the same input, the same draft');
  // from the loudness alone: 確か is capped at たぶん
  const dig = DR.draftStarts(Object.assign({}, input, { digest: true }));
  assert.ok(dig.proposals.every((x) => x.conf === 'mid'));
});

// The gap prior keeps lines apart as the lyrics suggest: two strong onsets 0.3 s apart must not take two lines.
test('the gap prior rejects a strong distractor', () => {
  const lines = [{ id: 'a', t0: 5, draft: false, w: 1 }].concat(
    [0, 1, 2, 3].map((i) => ({ id: 'r' + i, t0: 6 + i, draft: true, w: 1 })), [{ id: 'z', t0: 21, draft: false, w: 1 }]);
  const truth = [8.2, 11.4, 14.6, 17.8];
  const cands = truth.map((t) => ({ t, s: 0.5, kind: 'phrase' }))
    .concat([{ t: 9, s: 0.9, kind: 'phrase' }, { t: 9.3, s: 0.9, kind: 'phrase' }]).sort((x, y) => x.t - y.t);
  const got = placed(DR.draftStarts({ lines, cands, voiced: null, duration: 30, grid: null, snap: 'off' }));
  // the first line may take the stronger onset at 9.0 (only mildly off its prior gap); the second never takes 9.3
  assert.ok([8.2, 9].includes(got.get('r0').to), 'line 0 at ' + got.get('r0').to);
  truth.slice(1).forEach((t, i) => assert.equal(got.get('r' + (i + 1)).to, t, 'line ' + (i + 1)));
});

test('anchors never move and are never proposed; starts are strictly increasing; only drafted lines appear', () => {
  const R = G.rng(5);
  const draft = (i) => i % 4 !== 2;            // every fourth line is an anchor (an LRC time, a lock, an AI time …)
  const lines = linesOf(24, { draft, w: Array.from({ length: 24 }, () => 1 + 2 * R()) });
  lines.forEach((l, i) => { l.t0 = 3 + 2.5 * i; });
  const cands = [];
  for (let t = 0.5; t < 70; t += 0.2 + R() * 0.9) cands.push({ t: Math.round(t * 100) / 100, s: R(), kind: R() < 0.4 ? 'phrase' : 'weak' });
  for (const snap of ['off', 'beat', 'half']) {
    const res = DR.draftStarts({ lines, cands, voiced: { t0: 2, t1: 70 }, duration: 72, grid: B.grid({ bpm: 128, offset: 0.1 }), snap });
    const got = placed(res);
    for (const x of res.proposals) assert.ok(Math.abs(x.to - x.from) >= DRAFT.MOVE_MIN, 'a proposal moves');
    for (const x of res.kept) assert.ok(Math.abs(x.to - x.from) < DRAFT.MOVE_MIN, 'a kept line stays');
    let last = -Infinity;
    lines.forEach((l, i) => {
      if (!draft(i)) {
        assert.equal(got.has(l.id), false, 'an anchor is never drafted');
        assert.ok(l.t0 - last >= DRAFT.MIN_GAP - 1e-9, 'order at anchor ' + l.id);
        last = l.t0;
        return;
      }
      if (res.skipped.includes(l.id)) return;
      const x = got.get(l.id);
      assert.ok(x, 'drafted ' + l.id);
      assert.equal(x.from, l.t0);
      assert.ok(x.to - last >= DRAFT.MIN_GAP - 1e-9, snap + ': ' + l.id + ' at ' + x.to + ' after ' + last);
      last = x.to;
    });
    assert.ok(last <= 72);
  }
});

// Dense strong onsets between two close anchors: the lines still keep MIN_GAP from each other and from the anchors.
test('dense onsets never put two starts closer than MIN_GAP', () => {
  const lines = [{ id: 'a', t0: 10, draft: false, w: 1 }, { id: 'r1', t0: 10.1, draft: true, w: 1 },
    { id: 'r2', t0: 10.3, draft: true, w: 1 }, { id: 'z', t0: 10.5, draft: false, w: 1 }];
  const cands = [10.2, 10.22, 10.24, 10.26].map((t) => ({ t, s: 1, kind: 'phrase' }));
  const got = placed(DR.draftStarts({ lines, cands, voiced: null, duration: 20, grid: null, snap: 'off' }));
  const r1 = got.get('r1').to, r2 = got.get('r2').to;
  assert.ok(r1 - 10 >= DRAFT.MIN_GAP - 1e-9 && r2 - r1 >= DRAFT.MIN_GAP - 1e-9 && 10.5 - r2 >= DRAFT.MIN_GAP - 1e-9,
    'starts ' + r1 + ', ' + r2);
});

test('MOVE_MIN: a line already in place is kept, not proposed', () => {
  const lines = linesOf(3, { w: [1, 1, 1] });
  lines[0].t0 = 10.02; lines[1].t0 = 14; lines[2].t0 = 18;
  const cands = [{ t: 10, s: 0.9, kind: 'phrase' }, { t: 13, s: 0.9, kind: 'phrase' }, { t: 16, s: 0.9, kind: 'phrase' }];
  const res = DR.draftStarts({ lines, cands, voiced: { t0: 10, t1: 19 }, duration: 25, grid: null, snap: 'off' });
  assert.deepEqual(res.kept.map((x) => x.lineId), ['r0']);
  assert.deepEqual(res.proposals.map((x) => [x.lineId, x.to]), [['r1', 13], ['r2', 16]]);
});

test('without candidates the lines land on fillers, marked 自信なし', () => {
  const res = DR.draftStarts({ lines: linesOf(4), cands: [], voiced: null, duration: 20, grid: null, snap: 'off' });
  const all = res.proposals.concat(res.kept);
  assert.equal(all.length, 4);
  for (const x of all) { assert.equal(x.conf, 'low'); assert.equal(x.kind, 'filler'); }
});

test('beat snapping: within SNAP_TOL when on, never when off', () => {
  const lines = linesOf(2);
  const cands = [{ t: 10.04, s: 0.9, kind: 'phrase' }, { t: 12.9, s: 0.9, kind: 'phrase' }];
  const grid = B.grid({ bpm: 120, offset: 0 });
  const input = { lines, cands, voiced: { t0: 10, t1: 16 }, duration: 20, grid, snap: 'off' };
  assert.deepEqual(DR.draftStarts(input).proposals.map((x) => x.to), [10.04, 12.9]);
  // 10.04 is 0.04 from beat 10 (snapped); 12.9 is 0.1 from 13 (too far)
  assert.deepEqual(DR.draftStarts(Object.assign({}, input, { snap: 'beat' })).proposals.map((x) => x.to), [10, 12.9]);
});

test('a run between two anchors with no room is skipped', () => {
  const lines = [{ id: 'a', t0: 10, draft: false, w: 1 }, { id: 'r1', t0: 10.1, draft: true, w: 1 },
    { id: 'r2', t0: 10.2, draft: true, w: 1 }, { id: 'z', t0: 10.4, draft: false, w: 1 }, { id: 'r3', t0: 11, draft: true, w: 1 }];
  const res = DR.draftStarts({ lines, cands: [{ t: 12, s: 0.9, kind: 'phrase' }], voiced: null, duration: 20, grid: null, snap: 'off' });
  assert.deepEqual(res.skipped, ['r1', 'r2']);
  assert.deepEqual(res.proposals.map((x) => [x.lineId, x.to]), [['r3', 12]]);
});

test('agreement with tapped starts counts kept lines and moves within AGREE_S', () => {
  const res = { proposals: [{ lineId: 'a', from: 10, to: 10.2 }, { lineId: 'b', from: 12, to: 12.5 }, { lineId: 'c', from: 14, to: 14.3 }],
    kept: [{ lineId: 'd', from: 16, to: 16.02 }, { lineId: 'e', from: 18, to: 18 }] };
  assert.deepEqual(DR.agreement(res, new Set(['a', 'b', 'c', 'd'])), { k: 3, n: 4 });
  assert.deepEqual(DR.agreement(res, new Set()), { k: 0, n: 0 });
});

// Design target: under 0.1 s on an idle machine. Measured here the loop runs at about the speed of a bare loop over
// the same 9 M steps (11–21 ns a step on the loaded 4-CPU test machine, about 2–3 ns idle); the bound catches an
// algorithmic regression (a quadratic inner loop is > 10× slower), not load.
test('speed: 80 lines × 300 candidates over 4 minutes', () => {
  const R = G.rng(11);
  const lines = Array.from({ length: 80 }, (_, i) => ({ id: 'r' + i, t0: 2 + 3 * i, draft: true, w: 1 + 2 * R() }));
  const cands = Array.from({ length: 300 }, () => ({ t: Math.round(R() * 24000) / 100, s: R(), kind: R() < 0.3 ? 'phrase' : 'weak' }))
    .sort((a, b) => a.t - b.t);
  let best = Infinity;
  for (let k = 0; k < 3; k++) {
    const t0 = process.hrtime.bigint();
    const res = DR.draftStarts({ lines, cands, voiced: null, duration: 245, grid: null, snap: 'off' });
    best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
    assert.equal(res.proposals.length + res.kept.length, 80);
  }
  assert.ok(best < 250, 'aligner ' + best.toFixed(1) + ' ms');
});

// End to end (DESIGN_2_2 §5.2): three 90 s clean mixes → audio/voice → the stored record → the aligner with the app's
// own gap weights (core/timing gapWeights at 120 BPM; lines = the sung phrases, kana of their syllable count ± 20 %).
// Measured 0.83 / 0.68 / 0.86 of the lines within ±0.15 s (0.79 together); without the weak candidates in the stream
// the second song falls to 0.29 (0.65 together).
test('end to end on synthetic songs: ≥ 0.75 of line starts within ±0.15 s', () => {
  let ok = 0, n = 0, high = 0, highOk = 0;
  for (const seed of [1, 2, 4]) {
    const s = G.song({ seconds: 90, seed });
    const R = G.rng(seed * 7);
    const dec = VO.decode(VO.encode(VO.analyzeSync(s.channels, s.rate)));
    const cands = VO.candidatesIn(dec, 0, 90);
    const texts = s.phrases.map((p) => ({ text: 'あ'.repeat(Math.max(1, Math.round(p.syl * (0.8 + 0.4 * R())))), lang: 'ja', pauseBefore: 0 }));
    const w = TM.gapWeights(texts, { bpm: 120 });
    const lines = s.phrases.map((p, i) => ({ id: 'r' + i, t0: 1 + 2 * i, draft: true, w: w[i] }));
    const res = DR.draftStarts({ lines, cands, voiced: VO.voiced(cands, dec.act, dec.hz), duration: 90,
      grid: B.grid({ bpm: 120, offset: 0 }), snap: 'off' });
    const got = placed(res);
    s.phrases.forEach((p, i) => {
      const x = got.get('r' + i);
      const hit = !!x && Math.abs(x.to - p.start) <= 0.15;
      n++; if (hit) ok++;
      if (x && x.conf === 'high') { high++; if (hit) highOk++; }
    });
  }
  assert.ok(ok / n >= 0.75, 'within ±0.15 s: ' + ok + '/' + n);
  assert.ok(highOk / high >= 0.8, '確か lines within ±0.15 s: ' + highOk + '/' + high);
});

test('gapWeights: reading plus the pause above the next line, the gap of solveTimes', () => {
  const lines = [{ text: 'あいうえおかきくけこ', lang: 'ja', pauseBefore: 0 }, { text: 'さ', lang: 'ja', pauseBefore: 2 },
    { text: 'たちつてと', lang: 'ja', pauseBefore: 0 }];
  const w = TM.gapWeights(lines, { readRate: 5 });
  assert.equal(w.length, 3);
  assert.ok(Math.abs(w[0] - (10 / 5 + 0.8 * 2)) < 1e-12, 'its reading plus the two blank rows above the next line');
  assert.ok(Math.abs(w[1] - 1.2) < 1e-12, 'MIN_READ');
  assert.ok(Math.abs(w[2] - 1.2) < 1e-12, 'the last line: its reading');
  assert.ok(Math.abs(TM.gapWeights([lines[2]], { bpm: 100 })[0] - 1.2) < 1e-12);
  assert.ok(Math.abs(TM.gapWeights([{ text: 'あ'.repeat(12), lang: 'ja' }], { bpm: 100 })[0] - 12 / 5) < 1e-12, 'bpm / 20');
  // the same spacing core/timing gives automatic lines between two anchors
  const solved = TM.solveTimes([{ id: 'r1', text: lines[0].text, lang: 'ja', pauseBefore: 0, stamp: 10 },
    { id: 'r2', text: 'さ', lang: 'ja', pauseBefore: 2, stamp: null }, { id: 'r3', text: 'たちつてと', lang: 'ja', pauseBefore: 0, stamp: 20 }],
  { readRate: 5 });
  const wAll = TM.gapWeights([lines[0], lines[1], lines[2]], { readRate: 5 });
  const frac = wAll[0] / (wAll[0] + wAll[1]);
  assert.ok(Math.abs(solved.times[1].t0 - (10 + 10 * frac)) < 1e-6);
});
