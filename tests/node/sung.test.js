/* 文字PVメーカー v2 — original work. Tests: 歌ハメ — sung units, character times, the 歌ハメ switch, pieces, cast and engine (DESIGN_2_2 §6). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');
const LOC = require('../helpers/locality.js');

const MV = load();
const PL = MV.use('planner/plan');
const SU = MV.use('planner/sung');
const S = MV.use('core/script');
const D = MV.use('core/doc');
const C = MV.use('core/commands');
const PINS = MV.use('core/pins');
const RU = MV.use('planner/rules');
const STG = MV.use('engine/scene/stagger');
const BH = MV.use('engine/scene/behave');
const BUILD = MV.use('engine/scene/build');
const SS = MV.use('engine/scene/shot');
const K = MV.use('parts/kit');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const REG = MV.use('parts/catalog').defaultRegistry();

const plan = (doc) => PL.plan(doc, { registry: REG });
const fresh = (doc) => PL.run(doc, REG, { fresh: true });
const pin = (v, by = 'user') => ({ v, by });
const withPins = (doc, pins) => Object.assign({}, doc, { pins: Object.assign({}, doc.pins, pins) });
const withGen = (doc, gen = 1) => Object.assign({}, doc, { look: Object.assign({}, doc.look, { gen }) });
// The other packages' switches of a new work, pinned off (their golden documents do the same), so these tests see
// 歌ハメ alone whatever lands next to it.
const OTHER_OFF = Object.freeze({ 'work:pv.rules': pin(false), 'work:text.kana': pin(0), 'work:text.jump': pin(0),
  'work:text.latin': pin(0), 'work:morph.auto': pin(false), 'work:weight.auto': pin(false) });
const newWork = (name, pins) => withPins(withGen(corpus.project(name).doc), Object.assign({}, OTHER_OFF, pins || {}));
const old = (name, pins) => withPins(corpus.project(name).doc, pins || {});
const docOf = (srcs, pins, look) => {
  const doc = D.defaultDoc();
  doc.sheet = { next: srcs.length + 1, rows: srcs.map((src, i) => ({ id: 'r' + (i + 1).toString(36), src })) };
  doc.pins = pins || {};
  if (look) Object.assign(doc.look, look);
  return doc;
};
const svcOf = (p) => ({ registry: REG, text: createTextService({ measurer: fakeMeasurer(), faces: p.look.faces }), strict: true });
const hameCut = (c) => SU.isSungCut(c);
const q3 = (x) => Math.round(x * 1000) / 1000;

// --- (a) units ------------------------------------------------------------------------------------------------------

test('units: one beat each (kana, っ, ー, han), small kana and closers join back, openers forward, Latin words whole', () => {
  const u = (text, lang = 'ja') => SU.unitsOf(text, lang);
  const at = (text, lang) => Array.from(u(text, lang).at);
  const w = (text, lang) => Array.from(u(text, lang).w);
  assert.deepEqual(at('きみの声がきこえた'), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(w('きみの声がきこえた'), [1, 1, 1, 1.7, 1, 1, 1, 1, 1]);
  assert.deepEqual(at('しゅっぱつ しんこう！'), [0, 2, 3, 4, 6, 7, 8, 9], 'しゅ, っ, ぱ, つ␣, し, ん, こ, う！');
  assert.deepEqual(at('「25時」まで'), [0, 3, 5, 6], '「25, 時」, ま, で');
  assert.deepEqual(at('Hello new world', 'en'), [0, 6, 10]);
  assert.deepEqual(w('Hello new world', 'en'), [2, 1, 1]);
  assert.deepEqual(at('ラーメン'), [0, 1, 2, 3], 'ー is a beat');
  assert.deepEqual(at('きゃっ'), [0, 2], 'ゃ joins back, っ is a beat');
  assert.deepEqual(w('漢字'), [1.7, 1.7]);
  assert.deepEqual(at('あ😀い'), [0, 3], 'an emoji joins the unit before it');
  assert.deepEqual(at('😀あ'), [0], 'before the first unit: it joins the first');
  assert.deepEqual(at("don't stop-it now", 'en'), [0, 6, 14], "' and - inside a word continue it");
  assert.deepEqual(at('2'), [0]);
  assert.deepEqual(at('25'), [0], 'two digits: one tate-chu-yoko cell, one unit');
  assert.deepEqual(at('2025'), [0, 1, 2, 3], 'a longer run: one unit per digit');
  assert.deepEqual(at('「あ」「い」'), [0, 3], 'a closer joins back, the next opener forward');
  assert.deepEqual(at('"Hi" "yo"', 'en'), [0, 5], 'a quote before a space closed something');
  assert.deepEqual(at('♪♪'), [0], 'a text without any beat is one unit');
  // unitAt: containment, and a time set on a space or a closer belongs to the unit after it
  const hn = u('Hello new', 'en');
  assert.deepEqual([0, 3, 5, 6, 8].map((o) => SU.unitAt(hn, o)), [0, 0, 1, 1, 1]);
  const ky = u('きゃっ');
  assert.equal(SU.unitAt(ky, 1), 0, 'ゃ is inside きゃ');
  const q = u('「25時」まで');
  assert.equal(SU.unitAt(q, 4), 2, 'on 」: the next unit');
  // Σ w = morae for ordinary lines
  for (const { doc } of corpus.projects(['basic', 'lrc', 'long'])) {
    for (const row of doc.sheet.rows) {
      const text = MV.use('core/lyrics').parseRow(row.src).text;
      if (!text) continue;
      const units = u(text);
      const floors = Array.from(units.at).some((a, k) => S.morae(text.slice(a, k + 1 < units.n ? units.at[k + 1] : text.length), 'ja') < 0.5);
      if (floors) continue;
      approx(Array.from(units.w).reduce((x, y) => x + y, 0), S.morae(text, 'ja'), 1e-9, text);
    }
  }
});

test('vertical digits: the glyphs of one tate-chu-yoko cell share one sung time', () => {
  const doc = docOf(['[00:01.00]「25時」まで', '[00:05.00]つぎ'], { 'work:sung.hame': pin(true), 'work:orient': pin('v') });
  const p = plan(doc);
  const cut = p.cuts.find((c) => c.line === 'r1');
  assert.equal(cut.slots.orient.v, 'v');
  assert.ok(cut.sung, 'the cut has sung units');
  const scene = BUILD.buildCut(cut, p, svcOf(p));
  const target = scene.target;
  const st = STG.sungTimes({ cut, times: scene.times }, target, 'glyph');
  const j2 = target.ch.indexOf('2'), j5 = target.ch.indexOf('5'), jt = target.ch.indexOf('時');
  assert.ok(j2 >= 0 && j5 >= 0);
  assert.equal(st[j2], st[j5]);
  assert.equal(st[target.ch.indexOf('「')], st[j2], 'the opener comes with it');
  assert.ok(st[jt] > st[j2]);
});

test('acceptSungTimes: sorted pairs on grapheme starts and a last end pair; nothing else', () => {
  const acc = SU.acceptSungTimes('あ😀いう');     // offsets 0, 1, 3, 4; length 5
  const ok = (v) => 'v' in acc(v, 'pin:line');
  assert.ok(ok([[0, 0], [1, 0.2], [3, 0.5], [5, 1.2]]));
  assert.ok(ok([[3, 0.5]]), 'one pair');
  assert.ok(ok([[5, 1]]), 'only the end');
  assert.ok(!ok([[1, 0.2], [0, 0.4]]), 'unsorted');
  assert.ok(!ok([[1, 0.2], [1, 0.4]]), 'equal offsets');
  assert.ok(!ok([[0, 0.5], [1, 0.4]]), 'time going back');
  assert.ok(!ok([[0, 0.5], [1, 0.505]]), 'less than 0.01 s apart');
  assert.ok(!ok([[2, 0.5]]), 'inside a surrogate pair');
  assert.ok(!ok([[5, 1], [4, 1.2]]), 'the end pair is last');
  assert.ok(!ok([[6, 1]]), 'past the end');
  assert.ok(!ok([[0, -0.1]]), 'negative');
  assert.ok(!ok([[0, 601]]), 'over 600 s');
  assert.ok(!ok([]), 'empty');
  assert.ok(!ok('x'));
  const many = SU.acceptSungTimes('あ'.repeat(500));
  assert.ok('v' in many(Array.from({ length: 400 }, (_, i) => [i, i * 0.02]), 'pin:line'), '400 pairs');
  assert.ok(!('v' in many(Array.from({ length: 401 }, (_, i) => [i, i * 0.02]), 'pin:line')), 'over 400 pairs');
  assert.ok('na' in acc([[0, 0]], 'pin:work') && 'na' in acc([[0, 0]], 'pin:cut'), 'a line pin only');
});

// --- (c) filling a line ---------------------------------------------------------------------------------------------

test('fillLine: anchors kept, weights between them, the sung end from the end pair, the line rate or the estimate', () => {
  const units = SU.unitsOf('きみの声がきこえた', 'ja');
  const fill = (anchors, endRel, o) => SU.fillLine(Object.assign({ units, anchors, endRel, span: 4, rate: 7, sourcesOK: true }, o));
  const r2 = (ls) => Array.from(ls.t, (x) => Math.round(x * 100) / 100);
  const est = fill([], undefined);
  assert.deepEqual(r2(est), [0, 0.16, 0.31, 0.47, 0.74, 0.9, 1.05, 1.21, 1.37], 'estimate at 7 morae/s');
  approx(est.end, 1.52, 0.005);
  assert.equal(est.by, 'est');
  const A = (u, dt) => ({ u, dt, src: 3 });
  const tags = fill([A(0, 0), A(3, 0.62), A(5, 1.3)], 2.2);
  assert.deepEqual(r2(tags), [0, 0.21, 0.41, 0.62, 1.05, 1.3, 1.53, 1.75, 1.98]);
  assert.equal(tags.end, 2.2);
  assert.equal(tags.by, 'lrc');
  assert.deepEqual(Array.from(tags.src), [3, 0, 0, 3, 0, 3, 0, 0, 0]);
  const noEnd = fill([A(0, 0), A(3, 0.62), A(5, 1.3)], undefined);
  assert.deepEqual(r2(noEnd), [0, 0.21, 0.41, 0.62, 1.05, 1.3, 1.55, 1.8, 2.05], 'the line rate of its anchors (5.7 / 1.3)');
  approx(noEnd.end, 2.3, 0.005);
  // unit 0 starts with the line without an anchor
  assert.equal(fill([A(3, 0.62)], undefined).t[0], 0);
  // a line timed only for the colour (fewer than 2 anchors, sources off) keeps the v2 window
  assert.equal(fill([], undefined, { sourcesOK: false }).end, 4);
  // E ≤ span always, and never before the last anchor
  const rng = MV.use('core/rng').stream('sung-fill');
  for (let n = 0; n < 400; n++) {
    const span = rng.int(1, 60) / 10;
    const list = [];
    let t = 0;
    for (let u = 0; u < units.n; u++) if (rng.chance(0.3)) { t += rng.int(1, 80) / 100; if (t <= span) list.push(A(u, q3(t))); }
    const endRel = rng.chance(0.3) ? q3(t + rng.int(1, 100) / 100) : undefined;
    const ls = SU.fillLine({ units, anchors: list, endRel, span, rate: rng.int(3, 14), sourcesOK: rng.chance(0.5) });
    assert.ok(ls.end <= span + 1e-9, 'end ≤ span');
    for (let u = 1; u < ls.n; u++) assert.ok(ls.t[u] >= ls.t[u - 1], 'in order');
    assert.ok(ls.end >= ls.t[ls.n - 1]);
    for (const a of list) assert.equal(ls.t[a.u], a.dt, 'anchors kept');
  }
});

// --- (b) word tags, copies ------------------------------------------------------------------------------------------

test('word tags: used with 「字の時間を歌に合わせる」, relative to the line; bad ones dropped with a warning', () => {
  const lrc = corpus.project('lrc').doc;
  assert.equal(plan(lrc).sung, null, 'without the switch nothing changes');
  const p = plan(withPins(lrc, { 'work:sung.real': pin(true) }));
  const r4 = p.sung.get('r4');
  assert.equal(r4.by, 'lrc');
  assert.equal(r4.src[1], SU.SRC.lrc, 'the tagged word');
  approx(r4.t[1] - 8.5, 0.6, 1e-6, 'morning at 9.10');
  assert.equal(r4.hame, false, 'an older work: 自動 is off');
  assert.ok(!p.warnings.some((w) => w.code === 'sung-words'));
  // a tag after the line's time: dropped (counted), the others used
  const rows = lrc.sheet.rows.map((r) => (r.id === 'r4' ? Object.assign({}, r, { src: '[00:08.50]Good <00:09.10>morning, <00:30.00>little swallow' }) : r));
  const late = plan(withPins(Object.assign({}, lrc, { sheet: Object.assign({}, lrc.sheet, { rows }) }), { 'work:sung.real': pin(true) }));
  assert.ok(late.warnings.some((w) => w.code === 'sung-words' && w.line === 'r4' && w.detail.n === 1));
  approx(late.sung.get('r4').t[1] - 8.5, 0.6, 1e-6);
  // a row sung twice: both occurrences take the same times after their own start
  const twice = rows.map((r) => (r.id === 'r8' ? Object.assign({}, r, { src: '[00:22.00][00:48.00]飛ばせ/*紙<00:23.00>ひこうき*/空の果てまで' }) : r));
  const t2 = plan(withPins(Object.assign({}, lrc, { sheet: Object.assign({}, lrc.sheet, { rows: twice }) }), { 'work:sung.real': pin(true) }));
  const a = t2.sung.get('r8'), b = t2.sung.get('r8.1');
  assert.equal(a.by, 'lrc');
  assert.deepEqual(Array.from(a.t, (x) => q3(x - 22)), Array.from(b.t, (x) => q3(x - 48)));
});

test('copies: a line with the same lyric takes the best-timed occurrence\'s times, earlier ones too', () => {
  // 飛ばせ/*紙ひこうき*/空の果てまで is sung four times in the repeat fixture (ra, rm, ru, rv); only rm is tapped
  const tap = { 'line/rm:sung.times': pin([[0, 0], [3, 0.52], [8, 1.3], [14, 2.1]], 'tap') };
  const p = plan(old('repeat', Object.assign({ 'work:sung.real': pin(true) }, tap)));
  const rm = p.sung.get('rm');
  assert.equal(rm.by, 'pin');
  assert.equal(rm.pinBy, 'tap');
  const lineOf = (id) => p.lines.find((l) => l.id === id);
  const rel = (id) => Array.from(p.sung.get(id).t, (x) => q3(x - lineOf(id).t0));
  for (const id of ['ra', 'ru', 'rv']) {
    const s = p.sung.get(id);
    assert.equal(s.by, 'copy', id);
    assert.ok(s.explicit, id);
    const k = Math.min(1, (Math.min(lineOf(id).t1, (p.lines[lineOf(id).index + 1] || { t0: Infinity }).t0) - lineOf(id).t0) / (rm.end - lineOf('rm').t0));
    assert.deepEqual([0, 3, 8].map((off) => rel(id)[SU.unitAt(SU.unitsOf(lineOf(id).text, 'ja'), off)]),
      [0, q3(0.52 * k), q3(1.3 * k)], id + ' (scaled by ' + k.toFixed(3) + ')');
  }
  assert.equal(p.sung.get('rb').by, 'est', 'another lyric is not copied');
  // in a new work every occurrence is 歌ハメ, because it has character times
  const g = plan(newWork('repeat', tap));
  for (const id of ['ra', 'rm', 'ru', 'rv']) assert.deepEqual([g.sung.get(id).hame, g.sung.get(id).hameWhy], [true, 'times'], id);
  // with the switch off only the tapped line has times (its own pin); copies need the sources
  const off = plan(newWork('repeat', Object.assign({ 'work:sung.real': pin(false) }, tap)));
  assert.equal(off.sung.get('ra'), undefined);
  assert.equal(off.sung.get('rm').hame, true);
});

// --- (e) pieces ------------------------------------------------------------------------------------------------------

test('pieces: each starts when its first character is sung, in time order, never shorter than 0.35 s', () => {
  const p = plan(withPins(corpus.project('lrc').doc, { 'work:sung.real': pin(true) }));
  const r3 = p.sung.get('r3');
  const cuts = p.cuts.filter((c) => c.line === 'r3');
  assert.equal(cuts.length, 2);
  const u = SU.unitAt(SU.unitsOf('始発のホームに白い息', 'ja'), 7);
  approx(cuts[1].t0, r3.t[u], 1e-6, 'the second piece starts when 白 is sung');
  for (const c of cuts) assert.equal(c.sung.t[0], 0);
  assert.deepEqual(cuts[0].sung.at, [0, 1, 2, 3, 4, 5, 6]);
  // a pinned boundary earlier than an unpinned one's sung time: the unpinned one stays before it
  const three = docOf(['[00:01.00]あいうえお/かきくけこ/さしすせそ', '[00:10.00]つぎ'], {
    'work:sung.real': pin(true), 'cut/r1~10:t0': { v: 1.75, by: 'user', sig: 'さしすせそ' } });
  const tp = plan(three);
  const tc = tp.cuts.filter((c) => c.line === 'r1');
  assert.deepEqual(tc.map((c) => c.key), ['r1~0', 'r1~5', 'r1~10']);
  assert.equal(tc[2].t0, 1.75);
  for (let i = 0; i < tc.length; i++) {
    if (i) assert.ok(tc[i].t0 > tc[i - 1].t0, 'in time order');
    if (i < tc.length - 1) assert.ok(tc[i].t1 - tc[i].t0 >= 0.35, 'long enough');
  }
  approx(tc[1].t0, 1.4, 1e-6, 'at the latest 0.35 s before the pinned one');
  // a run too short for that: the v2 shares, exactly
  const short = (pins) => plan(docOf(['[00:01.00]あい/うえ', '[00:01.60]つぎ'], pins)).cuts.filter((c) => c.line === 'r1').map((c) => [c.t0, c.t1]);
  assert.deepEqual(short({ 'work:sung.real': pin(true) }), short({}));
});

test('pieces: no more merged pieces than without sung timing, over the corpus', () => {
  const merged = (p) => p.warnings.filter((w) => w.code === 'piece-merged').length;
  const lrc = corpus.project('lrc').doc;
  assert.ok(merged(plan(withPins(lrc, { 'work:sung.real': pin(true) }))) <= merged(plan(lrc)));
  for (const { name, doc } of corpus.corpus(2, ['16:9', '9:16'], ['basic', 'vertical', 'lrc', 'long', 'v21', 'repeat'])) {
    const on = fresh(withGen(withPins(doc, OTHER_OFF)));
    assert.ok(merged(on) <= merged(fresh(doc)), name);
    for (let i = 1; i < on.cuts.length; i++) assert.ok(on.cuts[i].t0 >= on.cuts[i - 1].t0, name + ': cuts in time order');
  }
});

// --- gates and 自動 ---------------------------------------------------------------------------------------------------

test('gates: the fixtures plan as before; one tapped line, or 歌ハメ for the whole work, in an older work', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'golden', 'plan_hashes.json'), 'utf8')).plans;
  for (const { name, doc } of corpus.corpus(2)) {
    const p = plan(doc);
    assert.equal(p.sung, null, name);
    assert.ok(p.cuts.every((c) => c.sung === undefined), name);
    assert.equal(p.hash, golden[name], name);
  }
  for (const name of ['v21', 'media', 'repeat']) assert.equal(plan(corpus.project(name).doc).sung, null, name);
  const one = plan(old('basic', { 'line/r5:sung.times': pin([[0, 0], [3, 0.6], [7, 1.3]], 'tap') }));
  assert.deepEqual([...one.sung.keys()], ['r5']);
  assert.ok(one.cuts.every((c) => (c.line === 'r5') === !!c.sung));
  assert.equal(one.sung.get('r5').hame, false, 'an older work: times alone do not switch 歌ハメ on');
  const all = plan(old('basic', { 'work:sung.hame': pin(true) }));
  assert.equal(RU.value(old('basic', { 'work:sung.hame': pin(true) }), null, 'sung.real'), false);
  for (const l of all.lines) assert.deepEqual([all.sung.get(l.id).hame, all.sung.get(l.id).hameWhy], [true, 'pin:work'], l.id);
  for (const c of all.cuts.filter((x) => x.role === 'lyric' || x.role === 'focus')) assert.ok(c.sung, c.key);
});

test('自動 in a new work: the opening line and the chorus lines 0, 3, 6 of each run, per lyric text', () => {
  const basic = plan(newWork('basic'));
  const on = (p) => p.lines.filter((l) => p.sung.get(l.id).hame).map((l) => l.id);
  assert.deepEqual(on(basic), ['r4', 'ra', 'rd']);
  for (const id of on(basic)) assert.equal(basic.sung.get(id).hameWhy, 'hook');
  assert.equal(basic.sung.get('r5').hameWhy, 'off');
  const rep = plan(newWork('repeat'));
  const texts = new Set(['r4', 'ra', 'rd'].map((id) => rep.lines.find((l) => l.id === id).text));
  for (const l of rep.lines) assert.equal(rep.sung.get(l.id).hame, texts.has(l.text), l.id + ' ' + l.text);
  assert.ok(on(rep).includes('rm') && on(rep).includes('ru') && on(rep).includes('rv'), 'every occurrence of a hook lyric');
  // the switch off: no hook lines (and nothing else to time)
  assert.equal(plan(newWork('basic', { 'work:sung.real': pin(false) })).sung, null);
  // an older work: 自動 means off
  const g0 = plan(old('basic', { 'work:sung.real': pin(true) }));
  assert.ok(g0.lines.every((l) => g0.sung.get(l.id).hame === false));
});

test('自動 and キメ: a キメ line is left to キメ unless its own line pin says 歌ハメ', () => {
  // P3 marks a キメ line as line.kime at stage 1; planner/sung reads only that flag
  const doc = newWork('basic');
  const ctxOf = (pins) => ({ doc: withPins(doc, pins || {}), ix: PINS.index(Object.assign({}, doc.pins, pins || {})), warn: () => {},
    timing: { lead: 0.12 }, readRate: 7 });
  const lines = [['r1', 'はじまりの朝', 0, 2, 'verse'], ['r2', 'ひかりのなか', 2, 4, 'chorus'], ['r3', 'かぜがふく', 4, 6, 'chorus']]
    .map(([id, text, t0, t1], i) => ({ id, text, lang: 'ja', t0, t1, kime: i === 1, by: { start: 'auto', end: 'auto' }, words: undefined }));
  const cuts = lines.map((l, i) => ({ key: l.id + '~0', line: l.id, role: 'lyric', lang: 'ja', feat: { section: i ? 'chorus' : 'verse' } }));
  const run = (pins) => {
    const ctx = ctxOf(pins);
    ctx.sung = SU.prepare(ctx, lines);
    SU.decideHame(ctx, cuts, lines);
    return lines.map((l) => [ctx.sung.hame.get(l.id).hame, ctx.sung.hame.get(l.id).why]);
  };
  assert.deepEqual(run(), [[true, 'hook'], [false, 'kime'], [false, 'off']], 'r2 would be the chorus head');
  assert.deepEqual(run({ 'work:sung.hame': pin(true) }), [[true, 'pin:work'], [false, 'kime'], [true, 'pin:work']]);
  assert.deepEqual(run({ 'line/r2:sung.hame': pin(true) })[1], [true, 'pin:line']);
});

// --- (f) cast -----------------------------------------------------------------------------------------------------

test('cast: a 歌ハメ cut takes an entrance of the list, with order sung and dur = 入りの早さ by rule; no own-motion layout', () => {
  const own = new Set(REG.keys('arrange').filter((k) => REG.get('arrange', k).motion === 'own'));
  let n = 0;
  for (const { name, doc } of corpus.corpus(2, ['16:9', '9:16'], ['basic', 'repeat'])) {
    const p = plan(withGen(withPins(doc, OTHER_OFF)));
    for (const c of p.cuts) {
      const line = c.line && p.sung && p.sung.get(c.line);
      if (!line || !line.hame || (c.role !== 'lyric' && c.role !== 'focus')) continue;
      n++;
      const list = c.lang === 'en' ? SU.HAME_ARRIVE_LATIN : SU.HAME_ARRIVE;
      assert.ok(list.includes(c.slots.arrive.v), name + ' ' + c.key + ': ' + c.slots.arrive.v);
      assert.ok(!own.has(c.slots.arrange.v), name + ' ' + c.key);
      assert.equal(c.slots.arrive.p.order, 'sung');
      assert.equal(c.slots.arrive.p.dur, 0.12);
      assert.deepEqual([c.slots.arrive.pfrom.order, c.slots.arrive.pfrom.dur], ['rule:sung', 'rule:sung']);
      assert.ok(hameCut(c));
    }
  }
  assert.ok(n > 20, n + ' 歌ハメ cuts');
  // English lines may take the word-at-a-time entrances too
  const en = plan(old('lrc', { 'work:sung.hame': pin(true) }));
  for (const c of en.cuts.filter((x) => x.lang === 'en' && x.sung)) assert.ok(SU.HAME_ARRIVE_LATIN.includes(c.slots.arrive.v), c.key);
  // the lead of a new work (P5: 0.2) is the dur; it is clamped to 0.06–0.25
  const lead = (v) => plan(withPins(Object.assign({}, old('basic'), { timing: Object.assign({}, old('basic').timing, { lead: v }) }),
    { 'work:sung.hame': pin(true) })).cuts.find((c) => c.sung).slots.arrive.p.dur;
  assert.deepEqual([lead(0.2), lead(0.5), lead(0.02)], [0.2, 0.25, 0.06]);
});

test('cast: pins win — an order, an own-motion layout; an empty list forces 打鍵 or the fallback with a warning', () => {
  const base = { 'work:sung.hame': pin(true) };
  const order = plan(old('basic', Object.assign({ 'line/r4:arrive.order': pin('lead') }, base)));
  for (const c of order.cuts.filter((x) => x.line === 'r4')) {
    assert.equal(c.slots.arrive.p.order, 'lead');
    assert.equal(c.slots.arrive.pfrom.order, 'pin:line');
    assert.equal(c.slots.arrive.pfrom.dur, 'rule:sung', 'the dur rule still applies');
  }
  const ticker = plan(old('basic', Object.assign({ 'line/r4:arrange': pin('tickerMarquee') }, base)));
  for (const c of ticker.cuts.filter((x) => x.line === 'r4')) {
    assert.equal(c.slots.arrange.v, 'tickerMarquee');
    assert.equal(c.slots.arrive.v, REG.fallback('arrive'), 'the layout moves the text: its forced motions stay');
    assert.ok(!hameCut(c));
  }
  // every entrance of the list filtered out: the fallback; only avoided on the line: 打鍵, which the filters allow
  const filtered = Object.assign({}, old('basic', base), { filters: { arrive: { deny: SU.HAME_ARRIVE.slice() } } });
  const fp = plan(filtered);
  for (const c of fp.cuts.filter((x) => x.sung)) assert.equal(c.slots.arrive.v, REG.fallback('arrive'), c.key);
  assert.ok(fp.warnings.some((w) => w.code === 'hame-empty'));
  const avoided = plan(old('basic', Object.assign({ 'line/r5:avoid': pin(SU.HAME_ARRIVE.map((k) => 'arrive.' + k)) }, base)));
  for (const c of avoided.cuts.filter((x) => x.line === 'r5')) {
    assert.equal(c.slots.arrive.v, 'typeOn', c.key);
    assert.equal(c.slots.arrive.p.order, 'sung');
  }
  assert.ok(avoided.warnings.some((w) => w.code === 'hame-empty' && w.line === 'r5'));
});

test('cast: the other cuts keep their choices, except the few cuts right after a 歌ハメ line', () => {
  const ownMotion = (p, key) => {
    const c = p.cuts.find((x) => x.key === key);
    return !!c && REG.get('arrange', c.slots.arrange.v).motion === 'own';
  };
  let compared = 0;
  for (const { name, doc } of corpus.corpus(2, ['16:9', '9:16'], ['basic', 'repeat', 'long'])) {
    const on = plan(withGen(withPins(doc, OTHER_OFF)));
    const offDoc = withGen(withPins(doc, Object.assign({ 'work:sung.hame': pin(false) }, OTHER_OFF)));
    const off = plan(offDoc);
    const hameLines = on.lines.filter((l) => on.sung.get(l.id).hame).map((l) => l.id);
    const spans = hameLines.map((id) => LOC.spanOfLine(on, id));
    const changed = [];
    for (const c of on.cuts) {
      const d = off.cuts.find((x) => x.key === c.key);
      if (!d || hameLines.includes(c.line)) continue;
      const parts = ['arrange', 'arrive', 'dwell', 'depart', 'lens'];
      if (parts.some((s) => c.slots[s].v !== d.slots[s].v)) changed.push(c.key);
    }
    for (const key of changed) {
      assert.ok(LOC.near(on, key, spans, changed, (k) => ownMotion(on, k) || ownMotion(off, k)), name + ': ' + key + ' changed');
    }
    compared++;
  }
  assert.ok(compared >= 12);
});

test('aligned repeats: the 歌ハメ rule runs after the copy, and a rule-set value is never copied', () => {
  // repeat fixture: 「くり返しの行をそろえる」 on; rm sings ra again and takes ra's decisions
  const src = plan(old('repeat', { 'line/rm:sung.hame': pin(true) }));
  for (const c of src.cuts.filter((x) => x.line === 'rm')) {
    assert.equal(c.slots.arrive.p.order, 'sung', c.key + ': the repeat is 歌ハメ, its source is not');
    assert.equal(c.slots.arrive.pfrom.order, 'rule:sung');
  }
  const rev = plan(old('repeat', { 'line/ra:sung.hame': pin(true) }));
  const raCuts = rev.cuts.filter((x) => x.line === 'ra');
  assert.ok(raCuts.every((c) => c.slots.arrive.p.order === 'sung'));
  for (const c of rev.cuts.filter((x) => x.line === 'rm')) {
    assert.notEqual(c.slots.arrive.p.order, 'sung', c.key + ': a repeat that is not 歌ハメ keeps its own order');
    assert.ok(!(c.slots.arrive.pfrom && c.slots.arrive.pfrom.order === 'rule:sung'));
  }
});

// --- explain and the inspector's field states ----------------------------------------------------------------------

test('explain and fields: 歌ハメ names its rule; rule-set values are derived; the switches read the Plan', () => {
  const EX = MV.use('planner/explain');
  const F = MV.use('planner/fields');
  const UF = MV.use('ui/fields');
  const doc = old('basic', { 'work:sung.hame': pin(true) });
  const p = plan(doc);
  const cut = p.cuts.find((c) => c.sung && c.line === 'r5');
  const ex = (path) => EX.explain(doc, p, path, { registry: REG });
  const rules = (e) => e.why.filter((w) => w.code === 'rule').map((w) => w.params.rule);
  // the entrance: picked from the restricted list; its order and dur: the rule
  assert.equal(rules(ex('cut/' + cut.key + ':arrive'))[0], 'sung.hame');
  assert.deepEqual(rules(ex('cut/' + cut.key + ':arrive.order')), ['sung']);
  assert.deepEqual(rules(ex('cut/' + cut.key + ':arrive.dur')), ['sung']);
  assert.equal(ex('cut/' + cut.key + ':arrive.order').from, 'rule:sung');
  assert.equal(rules(ex('cut/' + cut.key + ':arrange'))[0], 'sung.arrange');
  // motion speed's plain 'rule' still explains as speed
  const sped = old('basic', { 'work:motion.speed': pin(2) });
  const sp = plan(sped);
  const sc = sp.cuts.find((c) => c.slots.arrive.pfrom && c.slots.arrive.pfrom.dur === 'rule');
  assert.ok(sc, 'a cut whose dur motion speed scaled');
  assert.deepEqual(rules(EX.explain(sped, sp, 'cut/' + sc.key + ':arrive.dur', { registry: REG })), ['speed']);
  // a pinned layout that moves the text itself: 歌ハメ cannot be used there, and the why says so
  const tick = old('basic', { 'work:sung.hame': pin(true), 'line/r5:arrange': pin('tickerMarquee') });
  const tp = plan(tick);
  const tc = tp.cuts.find((c) => c.line === 'r5');
  const tw = EX.explain(tick, tp, 'cut/' + tc.key + ':arrange', { registry: REG });
  assert.equal(tw.why[0].code, 'pin');
  assert.deepEqual(rules(tw), ['sung.own']);
  // 文字の出方 / 長さ of a 歌ハメ cut: derived (read-only); of another cut: automatic
  const fs = (path, d = doc, pl = p) => F.fieldState(d, pl, { level: 'cut', key: cut.key }, path, { registry: REG });
  assert.equal(fs('cut/' + cut.key + ':arrive.order').state, 'derived');
  assert.equal(fs('cut/' + cut.key + ':arrive.dur').state, 'derived');
  const plainDoc = old('basic');
  const plainPlan = plan(plainDoc);
  assert.equal(F.fieldState(plainDoc, plainPlan, { level: 'cut', key: cut.key }, 'cut/' + cut.key + ':arrive.order', { registry: REG }).state, 'auto');
  // the switch at a line: inherited from the whole work; its own pin; 自動 with what 自動 decided
  const line = fs('line/r5:sung.hame');
  assert.deepEqual([line.value, line.state, line.pinnedAt], [true, 'inherited', 'work']);
  const work = fs('work:sung.hame');
  assert.deepEqual([work.value, work.state, work.pinnedAt], [true, 'pinned', 'work']);
  const own = old('basic', { 'line/r5:sung.hame': pin(false) });
  const ownFs = F.fieldState(own, plan(own), { level: 'line', ids: ['r5'] }, 'line/r5:sung.hame', { registry: REG });
  assert.deepEqual([ownFs.value, ownFs.state, ownFs.pinnedAt], [false, 'pinned', 'line']);
  const nw = newWork('basic');
  const np = plan(nw);
  const auto = (id) => F.fieldState(nw, np, { level: 'line', ids: [id] }, 'line/' + id + ':sung.hame', { registry: REG });
  assert.deepEqual([auto('r4').value, auto('r4').state, auto('r4').autoText], [true, 'auto', ['sung.auto.hook', {}]]);
  assert.deepEqual([auto('r5').value, auto('r5').autoText], [false, ['sung.auto.off', {}]]);
  assert.deepEqual(F.fieldState(nw, np, { level: 'work' }, 'work:sung.hame', { registry: REG }).autoText, ['fld.hame.autoNote', {}]);
  assert.deepEqual(F.fieldState(plainDoc, plainPlan, { level: 'work' }, 'work:sung.hame', { registry: REG }).autoText, ['sung.auto.off', {}]);
  assert.deepEqual(F.fieldState(plainDoc, plainPlan, { level: 'line', ids: ['r5'] }, 'line/r5:sung.hame', { registry: REG }).autoText,
    ['sung.auto.off', {}], 'an older work without sung timing: 自動 is off');
  const timed = newWork('basic', { 'line/r6:sung.times': pin([[0, 0], [2, 0.5]], 'tap') });
  const tfs = F.fieldState(timed, plan(timed), { level: 'line', ids: ['r6'] }, 'line/r6:sung.hame', { registry: REG });
  assert.deepEqual([tfs.value, tfs.autoText], [true, ['sung.auto.times', {}]]);
  // 「字の時間を歌に合わせる」: the document's default while unpinned, the pin otherwise
  const real = (d) => F.fieldState(d, plan(d), { level: 'work' }, 'work:sung.real', { registry: REG });
  assert.deepEqual([real(nw).value, real(nw).state], [true, 'auto']);
  assert.deepEqual([real(plainDoc).value, real(plainDoc).state], [false, 'auto']);
  const offReal = newWork('basic', { 'work:sung.real': pin(false) });
  assert.deepEqual([real(offReal).value, real(offReal).state], [false, 'pinned']);
  // a line's character times: its pin, set by tapping
  const st = F.fieldState(timed, plan(timed), { level: 'line', ids: ['r6'] }, 'line/r6:sung.times', { registry: REG });
  assert.deepEqual([st.value, st.state, st.by, st.canPinAt], [[[0, 0], [2, 0.5]], 'pinned', 'tap', ['line']]);
  // explain of the switches: the pin, or nothing (自動's text is the field's)
  assert.equal(EX.explain(doc, p, 'line/r5:sung.hame', { registry: REG }).why[0].params.scope, 'work');
  assert.deepEqual(EX.explain(nw, np, 'line/r4:sung.hame', { registry: REG }).why, []);
  // the inspector rows: settings, never drawn (no 振り直し)
  const rows = UF.FIELDS.filter((f) => f.path === 'sung.hame' || f.path === 'sung.real');
  assert.ok(rows.length >= 3, rows.map((f) => f.id).join(' '));
  for (const f of rows) assert.equal(f.noDice, true, f.id);
});

// --- (g) engine ---------------------------------------------------------------------------------------------------

function hameScene(pins, pick) {
  const p = plan(old('basic', Object.assign({ 'work:sung.hame': pin(true) }, pins || {})));
  const cut = p.cuts.find(pick || ((c) => c.sung && c.text.length >= 4));
  return { p, cut, scene: BUILD.buildCut(cut, p, svcOf(p)) };
}

test('engine: a 歌ハメ entrance starts dur before each sung time and lands on it; exits and other orders as before', () => {
  const { cut, scene } = hameScene();
  const b = scene.behaviours.find((x) => x.phase === BH.PH.MOTION && !x.exit && x.delay);
  const tm = scene.times;
  const st = STG.sungTimes({ cut, times: tm }, scene.target, 'glyph');
  const dur = cut.slots.arrive.p.dur, lead = cut.t0 - cut.a;
  approx(dur, lead, 1e-9);
  approx(b.t0, tm.a, 1e-9);
  const room = tm.b - tm.a - dur;
  for (let j = 0; j < st.length; j++) {
    approx(b.delay[j], Math.min(Math.max(0, st[j] - dur - tm.a), room), 1e-9);
    approx(b.t0 + b.delay[j] + b.dur, st[j], 1e-9, 'glyph ' + j + ' lands when it is sung');
  }
  // rest: the last character has landed (or the exit has begun: build.fitTimes)
  approx(tm.rest, Math.min(tm.a + Math.max(...b.delay) + dur, tm.out), 1e-9, 'rest');
  // a pinned longer dur: the characters sung late enough still land on their time
  const env = { cut, times: { a: -0.2, rest: -0.2, out: 3, b: 3 }, seed: 1 };
  const long = BH.motionTiming(env, scene.target, { order: 'sung', dur: 0.5 }, 'arrive', 'glyph');
  for (let j = 0; j < st.length; j++) if (st[j] >= 0.3) approx(-0.2 + long.delay[j] + long.dur, st[j], 1e-9);
  // an exit with order sung keeps the v2 spread; without sung units, the v2 formula bit for bit
  const noSung = { cut: Object.assign({}, cut, { sung: undefined }), times: env.times, seed: 1 };
  const dep = BH.motionTiming(env, scene.target, { order: 'sung', dur: 0.3 }, 'depart', 'glyph');
  assert.deepEqual(Array.from(dep.delay), Array.from(BH.motionTiming(noSung, scene.target, { order: 'sung', dur: 0.3 }, 'depart', 'glyph').delay));
  const v2 = BH.motionTiming(noSung, scene.target, { order: 'sung', dur: 0.3 }, 'arrive', 'glyph');
  const span = env.times.b - env.times.a, cutSpan = cut.t1 - cut.t0, room2 = Math.max(0, span - 0.3);
  const frac = STG.sungFractions(noSung, scene.target, 'glyph');
  assert.deepEqual(Array.from(v2.delay), Array.from(Float64Array.from(frac), (f) => Math.min(f * cutSpan, room2)));
});

test('engine: a run with its own text (a note) is sung at the start; word units take their first glyph\'s time', () => {
  const { cut, scene } = hameScene({ 'line/r4:arrive': pin('wordPop') }, (c) => c.line === 'r4');
  const t = scene.target;
  assert.ok(Array.from(t.off).every((o) => o >= 0));
  const noted = Object.assign({}, t, { off: Int32Array.from(t.off, (o, j) => (j === 0 ? -1 : o)) });
  const st = STG.sungTimes({ cut, times: scene.times }, noted, 'glyph');
  assert.equal(st[0], 0);
  const words = STG.sungTimes({ cut, times: scene.times }, t, 'word');
  const glyphs = STG.sungTimes({ cut, times: scene.times }, t, 'glyph');
  for (let j = 0; j < words.length; j++) {
    let min = Infinity;
    for (let k = 0; k < words.length; k++) if (t.unitOf.word[k] === t.unitOf.word[j]) min = Math.min(min, glyphs[k]);
    assert.equal(words[j], min);
  }
  // Latin letters spread over the start of their word
  const lp = plan(old('lrc', { 'work:sung.hame': pin(true) }));
  const lc = lp.cuts.find((c) => c.key === 'r4~0');
  const ls = BUILD.buildCut(lc, lp, svcOf(lp));
  const lt = STG.sungTimes({ cut: lc, times: ls.times }, ls.target, 'glyph');
  const good = [0, 1, 2, 3].map((j) => lt[j]);
  assert.ok(good[0] === 0 && good[1] > good[0] && good[3] > good[2], 'G o o d one after another: ' + good.join(' '));
  assert.ok(good[3] < lc.sung.t[1], 'before the next word');
});

test('shot and underSweep: anchors read the sung times; the framing span stays t0 … t1', () => {
  const { cut, scene } = hameScene(null, (c) => c.sung && c.emph.length > 0);
  const env = { cut, times: scene.times, D: { w: 1920, h: 1080, short: 1080 } };
  const t = scene.target;
  approx(SS.anchorTime(env, t, 'end'), Math.min(cut.sung.end, scene.times.b), 1e-9);
  approx(SS.anchorTime(env, t, 'mid'), cut.sung.end / 2, 1e-9);
  const run = SS.emphRun(t);
  approx(SS.anchorTime(env, t, 'emph'), STG.sungTimeAt(cut.sung, t.off[run[0]]), 1e-9, 'the emphasized word when it is sung');
  approx(SS.spanOf(env), cut.t1 - cut.t0, 1e-9, 'spanOf is unchanged (EXTREME fences and framing)');
  approx(SS.sungEndOf(env), cut.sung.end, 1e-9);
  const plain = { cut: Object.assign({}, cut, { sung: undefined }), times: scene.times, D: env.D };
  approx(SS.anchorTime(plain, t, 'end'), Math.min(cut.t1 - cut.t0, scene.times.b), 1e-9, 'without sung units: as before');
  approx(K.sungAt({ cut }, 2), STG.sungTimeAt(cut.sung, 2), 1e-12);
  assert.equal(K.sungAt({ cut: plain.cut }, 2), null);
  // underSweep with and without emphasis builds (strict), its sweep landing at the emphasized word's sung time; one line
  // of text (centerAnchor), so the engine also hands it the emphasized word's box (hints.emph, a box, not ranges)
  for (const pick of [(c) => c.sung && c.emph.length > 0 && c.text.length <= 5, (c) => c.sung && c.emph.length === 0]) {
    const { p, cut: c } = hameScene({ 'work:arrange': pin('centerAnchor') }, pick);
    const slots = Object.assign({}, c.slots, { 'ornament.count': { v: 1, from: 'pin:work' },
      'ornament#0': { v: 'underSweep', p: { thick: 10, gap: 12, delay: 0.1, ink: 'accent', amount: 1 }, from: 'pin:work' } });
    const sc = BUILD.buildCut(Object.assign({}, c, { slots }), p, svcOf(p));
    const sweep = sc.behaviours.find((x) => x.axis !== undefined && x.len !== undefined && typeof x.s === 'number' && x.od !== undefined);
    assert.ok(sweep, 'the sweep behaviour');
    const at = c.emph.length ? STG.sungTimeAt(c.sung, c.emph[0][0]) : STG.sungTimeAt(c.sung, 0);
    approx(sweep.s, Math.min(Math.max(Math.max(sc.times.rest, at) + 0.1, sc.times.a), Math.max(sc.times.a, sc.times.b - 0.6)), 1e-9);
  }
});

test('exits wait for the last sung character: shortened to 80 % of the time after it; repT falls in the calm', () => {
  assert.equal(STG.SUNG_EXIT, SU.C.EXIT_SHARE, 'the planner and the scene use one share');
  const MO = MV.use('core/motion');
  let n = 0, squeezed = 0;
  for (const { doc } of corpus.corpus(1, ['16:9', '9:16'], ['basic', 'lrc'])) {
    const p = plan(withPins(doc, { 'work:sung.hame': pin(true) }));
    const svc = svcOf(p);
    for (const c of p.cuts.filter(hameCut)) {
      const sc = BUILD.buildCut(c, p, svc);
      const tm = sc.times;
      n++;
      const room = tm.b - tm.rest;
      if (room * SU.C.EXIT_SHARE >= MO.MIN_DUR) assert.ok(tm.out >= tm.rest - 1e-9, c.key + ': the exit starts after the last landing');
      const dep = sc.behaviours.find((x) => x.phase === BH.PH.MOTION && x.exit);
      if (dep && c.slots.depart.p && dep.dur < Math.min(c.slots.depart.p.dur, 0.35 * (tm.b - tm.a)) - 1e-9) squeezed++;
      const rt = c.repT - c.t0;
      assert.ok(rt >= tm.rest - 0.03 && rt <= tm.out + 1e-6, c.key + ': repT ' + rt + ' in [' + tm.rest + ', ' + tm.out + ']');
      // inside the calm, not on the landing: heroSung knows the exit is shortened (10 % of the calm, as heroTime)
      if (tm.out - tm.rest > 0.05) assert.ok(rt >= tm.rest + 0.03 * (tm.out - tm.rest) - 1e-6, c.key + ': repT in the calm');
    }
  }
  assert.ok(n > 20 && squeezed > 0, n + ' cuts, ' + squeezed + ' exits shortened');
  // a cut whose entrance does not follow sung times keeps its exit
  const plainP = plan(corpus.project('basic').doc);
  const c0 = plainP.cuts.find((c) => c.role === 'lyric');
  const s0 = BUILD.buildCut(c0, plainP, svcOf(plainP));
  const d0 = s0.behaviours.find((x) => x.phase === BH.PH.MOTION && x.exit);
  if (d0) approx(d0.dur, Math.min(c0.slots.depart.p.dur, 0.35 * (s0.times.b - s0.times.a)), 0.2);
});

test('repT: a 歌ハメ cut is the hero once its last character has landed', () => {
  const p = plan(old('basic', { 'work:sung.hame': pin(true) }));
  for (const c of p.cuts.filter(hameCut)) {
    const land = c.t0 + c.sung.t[c.sung.t.length - 1];
    assert.ok(c.repT >= Math.min(land, c.b) - 1e-6 && c.repT < c.b, c.key + ': ' + c.repT + ' vs ' + land);
  }
  const plainP = plan(corpus.project('basic').doc);
  const MO = MV.use('core/motion');
  for (const c of plainP.cuts.slice(0, 4)) assert.ok(c.repT >= c.a && c.repT < c.b);
  assert.ok(MO.heroTime);
});

// --- determinism, the caches and encoding ----------------------------------------------------------------------------

test('determinism and re-planning: fresh and cached plans agree through toggles, pins and text edits', () => {
  const docA = old('repeat', { 'work:sung.real': pin(true), 'line/rm:sung.times': pin([[0, 0], [3, 0.5], [8, 1.2]], 'tap') });
  assert.equal(fresh(docA).hash, fresh(docA).hash);
  let doc = docA;
  const steps = [
    (d) => C.reduce(d, { t: 'pin.set', path: 'line/rb:sung.hame', v: true, by: 'user' }),
    (d) => C.reduce(d, { t: 'pin.set', path: 'line/rm:sung.times', v: [[0, 0], [3, 0.6], [8, 1.3]], by: 'tap' }),
    (d) => C.reduce(d, { t: 'lyrics.row', rowId: 'rm', src: '飛ばせ/*紙ひこうき*/空のはてまで' }),
    (d) => C.reduce(d, { t: 'pin.set', path: 'work:sung.hame', v: false, by: 'user' }),
  ];
  plan(doc);
  for (const step of steps) {
    doc = step(doc);
    const cached = plan(doc), cold = fresh(doc);
    assert.equal(cached.hash, cold.hash);
    assert.equal(PL.canon(cached), PL.canon(cold));
  }
  // one line's times changed: the other cuts reuse their casts
  const before = old('basic', { 'work:sung.hame': pin(true), 'line/r6:sung.times': pin([[0, 0], [4, 0.5]], 'tap') });
  plan(before);
  const after = plan(withPins(before, { 'line/r6:sung.times': pin([[0, 0], [4, 0.7]], 'tap') }));
  assert.ok(after.reuse.casts >= after.reuse.cuts - 6, after.reuse.casts + ' of ' + after.reuse.cuts);
});

test('encoding: cut.sung is printed between slots and t0 and fingerprinted; the canonical text agrees', () => {
  const H = MV.use('core/hash');
  const p = fresh(old('lrc', { 'work:sung.real': pin(true) }));
  const c = p.cuts.find((x) => x.sung);
  assert.deepEqual(Object.keys(c.sung), ['at', 'end', 't']);
  assert.equal(PL.canon(p), H.canonical(p), 'the streamed encoding prints the canonical text');
  // other sung times inside the same cut change its fingerprint (the scene reads them), and only its own
  const tapped = (t5) => fresh(old('lrc', { 'work:sung.real': pin(true), 'line/r5:sung.times': pin([[0, 0], [2, 0.4], [5, t5]], 'tap') }));
  const a = tapped(0.9), b = tapped(1.0);
  const second = (x) => x.cuts.find((c) => c.line === 'r5' && c.key !== 'r5~0');
  assert.deepEqual([second(a).key, second(a).t0, second(a).t1], [second(b).key, second(b).t0, second(b).t1], 'the same piece');
  assert.notDeepEqual(second(a).sung, second(b).sung);
  assert.notEqual(second(a).fp, second(b).fp);
  assert.equal(a.cuts.find((c) => c.key === 'r5~0').fp, b.cuts.find((c) => c.key === 'r5~0').fp);
});

test('≡ › 時刻を歌詞に書き込む keeps a row\'s word tags, moved with its new first stamp', () => {
  const MENUS = MV.use('ui/menus');
  const doc = docOf(['Good <00:09.10>morning, *little* bird', '[00:20.00]つぎ']);
  const p = plan(doc);
  let sent = null;
  const app = { doc, plan: p, batch: (label, cmds) => { sent = cmds; }, toast: () => {}, t: (k) => k, lang: 'ja' };
  assert.equal(MENUS.bakeTimes(app), true);
  const text = sent.find((c) => c.t === 'lyrics.set').text.split('\n');
  const t0 = p.lines[0].t0;
  const row = MV.use('core/lyrics').parseRow(text[0]);
  assert.deepEqual(row.stamps, [q3(t0)]);
  assert.deepEqual(row.words, [[5, q3(t0)]], 'an unstamped row counted from its first tag: that tag is now its start');
  assert.deepEqual(row.emph, [[14, 20]], 'the marks stay');
});

// Re-planning a new work with sung timing costs about what the same work costs without it (the three edit kinds of
// planner_determinism's speed test, and typing in a lyric row). The runs are interleaved and the best batches compared,
// so a loaded machine slows both alike; the absolute bound of §7.4 is planner_determinism's (on the same document).
test('planning speed: sung timing adds little to re-planning a new work', (t) => {
  const STUB = corpus.stubRegistry(MV);
  const make = (real) => {
    const doc = JSON.parse(JSON.stringify(corpus.project('long').doc));
    doc.look.gen = 1;
    doc.pins = Object.assign({}, doc.pins, OTHER_OFF, { 'work:sung.real': pin(real) });
    return doc;
  };
  const runs = { on: { doc: make(true), n: 0, best: Infinity }, off: { doc: make(false), n: 0, best: Infinity } };
  for (const r of Object.values(runs)) r.first = PL.plan(r.doc, { registry: STUB });
  for (let b = 0; b < 10; b++) {
    for (const r of b % 2 ? [runs.off, runs.on] : [runs.on, runs.off]) {
      const start = process.hrtime.bigint();
      for (let i = 0; i < 6; i++, r.n++) {
        const line = r.first.lines[(r.n * 17) % r.first.lines.length];
        const cut = line.cuts[0];
        const edits = [
          { ['cut/' + cut + ':arrive.dur']: { v: 0.3 + 0.01 * r.n, by: 'user', sig: PL.pinSig(r.first, cut) } },
          { ['line/' + line.id + ':dwell']: { v: r.n % 2 ? 'stubBob' : 'stillHold', by: 'user' } },
          { ['line/' + line.id + ':start']: { v: line.t0 + 0.05, by: 'tap' } },
        ];
        r.doc = Object.assign({}, r.doc, { pins: Object.assign({}, r.doc.pins, edits[r.n % 3]) });
        PL.plan(r.doc, { registry: STUB });
      }
      r.best = Math.min(r.best, Number(process.hrtime.bigint() - start) / 1e6 / 6);
    }
  }
  t.diagnostic('re-plan after an edit: sung timing ' + runs.on.best.toFixed(2) + ' ms, without ' + runs.off.best.toFixed(2) + ' ms');
  assert.ok(runs.on.best <= 1.25 * runs.off.best + 1, runs.on.best.toFixed(2) + ' vs ' + runs.off.best.toFixed(2) + ' ms');
  // typing: the casts of the cuts that only moved are reused as without sung timing
  const C2 = MV.use('core/commands');
  let doc = make(true);
  const first = PL.plan(doc, { registry: REG });
  const rowId = first.lines[30].id;
  let least = 1;
  for (let n = 0; n < 12; n++) {
    doc = C2.reduce(doc, { t: 'lyrics.set', text: doc.sheet.rows.map((r) => (r.id === rowId ? r.src + 'かぜのなか'[n % 5] : r.src)).join('\n') });
    const p = PL.plan(doc, { registry: REG });
    least = Math.min(least, p.reuse.casts / p.reuse.cuts);
  }
  assert.ok(least >= 0.9, 'casts reused while typing: ' + least.toFixed(3));
});

// --- the golden ------------------------------------------------------------------------------------------------------

test('the 歌ハメ golden: its documents plan and render the golden frames (tests/golden/project_sung.json)', async () => {
  const SD = require('../helpers/sung_docs.js');
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'golden', 'project_sung.json'), 'utf8'));
  const { createEngine } = MV.use('engine/facade');
  const { createRecorder } = MV.use('engine/render/record');
  const { fakeMeasurer } = MV.use('engine/text/fake_measure');
  const H = MV.use('core/hash');
  assert.equal(golden.registry.version, REG.version, 'made with the current catalog');
  const docs = SD.goldenDocs();
  assert.deepEqual(docs.map((d) => d.name), Object.keys(golden.docs), 'the entries, in order');
  for (const { name, doc } of docs) {
    const want = golden.docs[name];
    const rec = createRecorder();
    const engine = createEngine({ registry: REG, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null });
    const { plan: p } = engine.setDoc(doc);
    assert.equal(p.hash, want.plan, name);
    // each document shows what it is there for
    const key = name.slice(0, 2);
    const hame = p.lines.filter((l) => p.sung.get(l.id) && p.sung.get(l.id).hame).map((l) => l.id);
    if (key === 'A1') assert.ok(p.sung.get('r4').by === 'lrc' && !hame.length, name);
    if (key === 'A2') assert.ok(p.sung.get('r3').by === 'pin' && hame.length === p.lines.filter((l) => p.sung.get(l.id)).length, name);
    if (key === 'A3') assert.deepEqual(hame, ['r4', 'ra', 'rd'], name);
    if (key === 'A4') assert.ok(['ra', 'rm', 'ru', 'rv'].every((id) => hame.includes(id)) && p.sung.get('ra').by === 'copy', name);
    await engine.prepare(0, p.duration, { export: true });
    const [w, h] = D.DESIGN_SIZE[doc.look.aspect];
    const k = 360 / Math.min(w, h);
    const made = rec.factory.create(Math.round(w * k), Math.round(h * k), { alpha: false });
    const surface = { canvas: made.canvas, ctx: made.ctx, w: Math.round(w * k), h: Math.round(h * k) };
    const frames = [];
    for (let i = 0; i < 40; i++) {
      const before = rec.ops().length;
      engine.renderFrame(surface, (p.duration * (i + 0.5)) / 40, { quality: 'export', pick: false, scale: surface.w / p.design.w });
      frames.push(H.hashJSON(rec.ops().slice(before)));
    }
    engine.dispose();
    assert.deepEqual(frames, want.frames, name);
  }
});
