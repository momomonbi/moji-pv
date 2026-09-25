/* 文字PVメーカー v2 — original work. Tests for export/subtitles (DESIGN_2_1 §13.12 subtitles.test.js): the SRT grammar, times, trimming and range, and .lrc bytes. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { throwsCode } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const SUB = MV.use('export/subtitles');
const L = MV.use('core/lyrics');
const PL = MV.use('planner/plan');
const MIG = MV.use('core/migrate');
const T = MV.use('i18n/t');
const STRINGS = MV.use('i18n/strings');
const rng = MV.use('core/rng');
const STUB = corpus.stubRegistry(MV);

// --- a small, strict SRT parser -------------------------------------------------------------------------------------

const TIME = /^(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})$/;

function toMs(stamp) {
  const m = TIME.exec(stamp);
  assert.ok(m, 'a time stamp: ' + stamp);
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

// parseSrt(text) → [{ n, start, end, text }]. Every line ends with CRLF; each cue is its number, the time line, one
// text line and an empty line; numbers count from 1.
function parseSrt(text) {
  assert.ok(!/\r(?!\n)/.test(text) && !/(^|[^\r])\n/.test(text), 'CRLF line endings only');
  if (text === '') return [];
  assert.ok(text.endsWith('\r\n\r\n'), 'the last cue ends with an empty line');
  const lines = text.slice(0, -2).split('\r\n');
  const cues = [];
  for (let i = 0; i < lines.length; i += 4) {
    const [num, times, body, blank] = lines.slice(i, i + 4);
    assert.equal(num, String(cues.length + 1), 'cue number');
    const m = /^(\S+) --> (\S+)$/.exec(times);
    assert.ok(m, 'time line: ' + times);
    assert.ok(body && body.trim() === body, 'one non-empty text line');
    assert.equal(blank, '', 'an empty line after each cue');
    cues.push({ n: cues.length + 1, start: toMs(m[1]), end: toMs(m[2]), text: body });
  }
  return cues;
}

function line(id, t0, t1, text) { return { id, row: id.split('.')[0], t0, t1, text }; }
function plan(lines, extra) { return Object.assign({ duration: 100, lines, cuts: [] }, extra || {}); }

// --- srt ------------------------------------------------------------------------------------------------------------

test('srt: the exact text, CRLF line endings, no BOM (the caller adds it)', () => {
  const p = plan([line('r1', 1.5, 3.25, '始発のホームに白い息'), line('r2', 3.25, 6, 'Good morning, little swallow'),
    line('r3', 3725.1234, 3727.5, '夜明けのうた')], { duration: 3800 });
  assert.equal(SUB.srt(p),
    '1\r\n00:00:01,500 --> 00:00:03,250\r\n始発のホームに白い息\r\n\r\n' +
    '2\r\n00:00:03,250 --> 00:00:06,000\r\nGood morning, little swallow\r\n\r\n' +
    '3\r\n01:02:05,123 --> 01:02:07,500\r\n夜明けのうた\r\n\r\n');
  const text = SUB.srt(p);
  assert.notEqual(text[0], '\uFEFF');
  assert.equal(SUB.BOM, '\uFEFF');
  const bytes = new TextEncoder().encode(SUB.BOM + text);
  assert.deepEqual(Array.from(bytes.subarray(0, 3)), [0xef, 0xbb, 0xbf], 'UTF-8 with BOM');
  assert.equal(new TextDecoder('utf-8', { ignoreBOM: false }).decode(bytes), text, 'the BOM is dropped on reading');
  assert.equal(parseSrt(text).length, 3);
  assert.equal(SUB.srt(plan([])), '', 'no cues, no text');
});

test('srt: milliseconds rounded half up, exactly, with carries into seconds, minutes and hours', () => {
  const cases = [
    [1.0005, '00:00:01,001'], [1.00049, '00:00:01,000'], [0.0005, '00:00:00,001'], [0.1 + 0.2, '00:00:00,300'],
    [59.9995, '00:01:00,000'], [3599.9995, '01:00:00,000'], [360000, '100:00:00,000'], [2.675, '00:00:02,675'],
    [1.0045, '00:00:01,005'], [4.35, '00:00:04,350'],
    [0.5005, '00:00:00,501'], [0.5115, '00:00:00,512'],           // 0.5005 · 1e6 is 500499.99999999994 in binary
  ];
  for (const [t, want] of cases) {
    const text = SUB.srt(plan([line('r1', t, t + 1, 'x')], { duration: 400000 }));
    assert.equal(text.split('\r\n')[1].split(' --> ')[0], want, String(t));
  }
  // Times relative to t0 do not pick up binary noise: 4.2 − 1.1 is 3.1000000000000005.
  assert.equal(SUB.srt(plan([line('r1', 4.2, 5.3, 'x')]), { t0: 1.1 }).split('\r\n')[1], '00:00:03,100 --> 00:00:04,200');
});

test('srt: overlapping cues are cut back to the next start; cues under 0.1 s are dropped; numbers stay consecutive', () => {
  const p = plan([
    line('r1', 1, 3, 'a'), line('r2', 2, 4, 'b'),                 // a ends at b's start
    line('r3', 5, 5.0994, 'c'),                                   // too short: written as 5,000 --> 5,099
    line('r3b', 5.5, 5.5996, 'c2'),                               // 99.6 ms is written as 5,500 --> 5,600: kept
    line('r4', 6, 6.1, 'd'),                                      // exactly 0.1 s: kept
    line('r5', 7, 9, 'e'), line('r6', 7.05, 8, 'f'),              // e is cut to 0.05 s and dropped; f stays
    line('r7', 10, 12, 'g'), line('r8', 10, 11, 'h'),             // the same start: g is cut to nothing
  ]);
  const cues = parseSrt(SUB.srt(p));
  assert.deepEqual(cues.map((c) => [c.n, c.start, c.end, c.text]), [
    [1, 1000, 2000, 'a'], [2, 2000, 4000, 'b'], [3, 5500, 5600, 'c2'], [4, 6000, 6100, 'd'], [5, 7050, 8000, 'f'],
    [6, 10000, 11000, 'h'],
  ]);
});

test('srt: lines outside [t0, t1) are dropped, the rest clipped and shifted to t0', () => {
  const p = plan([
    line('r1', 0.5, 2, 'before'),                                 // ends exactly at t0: outside
    line('r2', 1.5, 3, 'straddles t0'),
    line('r3', 4, 6, 'inside'),
    line('r4', 9, 11, 'straddles t1'),
    line('r5', 10, 12, 'starts at t1'),                           // outside
    line('r6', 20, 21, 'after'),
  ], { duration: 30 });
  const cues = parseSrt(SUB.srt(p, { t0: 2, t1: 10 }));
  assert.deepEqual(cues.map((c) => [c.start, c.end, c.text]), [[0, 1000, 'straddles t0'], [2000, 4000, 'inside'], [7000, 8000, 'straddles t1']]);
  // The default range is the whole video: [0, plan.duration).
  const whole = parseSrt(SUB.srt(p));
  assert.deepEqual(whole.map((c) => c.text), ['before', 'straddles t0', 'inside', 'straddles t1', 'starts at t1', 'after']);
  const short = parseSrt(SUB.srt(Object.assign({}, p, { duration: 20.5 })));
  assert.deepEqual(short[short.length - 1], { n: 6, start: 20000, end: 20500, text: 'after' }, 'clipped at plan.duration');
  assert.equal(SUB.srt(p, { t0: 5, t1: 5 }), '', 'an empty range');
  assert.equal(SUB.srt(p, { t0: 8, t1: 2 }), '', 'a reversed range');
});

test('srt: per cut uses the cuts of sung lines only (not title, intro, gap or outro)', () => {
  const p = plan([line('r1', 2, 5, '夜明けの街を走る')], {
    cuts: [
      { key: 'title', line: null, role: 'title', text: '夜明けのうた', t0: 0, t1: 2 },
      { key: 'r1~0', line: 'r1', role: 'lyric', text: '夜明けの', t0: 2, t1: 3.5 },
      { key: 'r1~4', line: 'r1', role: 'focus', text: '街を走る', t0: 3.5, t1: 5 },
      { key: 'gap/5', line: null, role: 'interlude', text: '', t0: 5, t1: 8 },
    ],
  });
  assert.equal(SUB.srt(p, { per: 'cut' }),
    '1\r\n00:00:02,000 --> 00:00:03,500\r\n夜明けの\r\n\r\n2\r\n00:00:03,500 --> 00:00:05,000\r\n街を走る\r\n\r\n');
  assert.deepEqual(parseSrt(SUB.srt(p, { per: 'line' })).map((c) => c.text), ['夜明けの街を走る']);
  assert.deepEqual(parseSrt(SUB.srt(p, { per: 'cut', t0: 3 })).map((c) => [c.start, c.end]), [[0, 500], [500, 2000]]);
  throwsCode(() => SUB.srt(p, { per: 'word' }), 'args');
  throwsCode(() => SUB.srt(p, { t0: NaN }), 'args');
  throwsCode(() => SUB.srt(p, { t1: '10' }), 'args');
});

test('srt: one text line per cue; empty lines are left out and never cut back the cue before them', () => {
  const p = plan([
    line('r1', 1, 4, '  二行の\n歌詞\r\nです\u2028ね  '),
    line('r2', 2, 3, '   '),
    line('r3', 5, 6, ''),
    line('r4', 7, 8, null),
  ]);
  const cues = parseSrt(SUB.srt(p));
  assert.deepEqual(cues.map((c) => [c.start, c.end, c.text]), [[1000, 4000, '二行の 歌詞 です ね']]);
});

test('srt: cues follow time order even when the plan lists a later line first', () => {
  const p = plan([line('r2', 5, 7, 'second'), line('r1', 1, 6, 'first')]);
  assert.deepEqual(parseSrt(SUB.srt(p)).map((c) => [c.start, c.end, c.text]), [[1000, 5000, 'first'], [5000, 7000, 'second']]);
});

test('srt over random plans: the grammar holds, cues are ordered, disjoint, at least 0.1 s and inside the range', () => {
  const r = rng.fromSeed(1308);
  for (let k = 0; k < 300; k++) {
    const lines = [];
    let t = r.next() * 3;
    const n = Math.floor(r.next() * 25);
    for (let i = 0; i < n; i++) {
      const dur = r.next() < 0.1 ? r.next() * 0.15 : 0.2 + r.next() * 4;
      lines.push(line('r' + i, t, t + dur, r.next() < 0.05 ? '' : '行' + i + (r.next() < 0.3 ? ' Yeah' : '')));
      t += r.next() < 0.2 ? -r.next() * dur : dur * r.next() * 1.5;
      t = Math.max(0, t);
    }
    const duration = t + 2;
    const t0 = r.next() < 0.5 ? 0 : r.next() * duration * 0.5;
    const t1 = r.next() < 0.5 ? duration : t0 + r.next() * duration;
    const p = plan(lines, { duration });
    const text = SUB.srt(p, { t0, t1 });
    const cues = parseSrt(text);
    const span = Math.floor((Math.round(t1 * 1e6) - Math.round(t0 * 1e6) + 500) / 1000);
    cues.forEach((c, i) => {
      assert.ok(c.end - c.start >= 100, 'long enough');
      assert.ok(c.start >= 0 && c.end <= span, 'inside the range');
      if (i) assert.ok(c.start >= cues[i - 1].end, 'no overlap');
      if (i) assert.ok(c.start >= cues[i - 1].start, 'time order');
    });
    const kept = new Set(cues.map((c) => c.text));
    for (const l of lines) {
      if (l.text && l.t0 < t0 - 1e-9 && l.t1 < t0 - 1e-9) assert.ok(!kept.has(l.text), 'a line before the range is dropped');
      if (l.text && l.t0 > t1 + 1e-9) assert.ok(!kept.has(l.text), 'a line after the range is dropped');
    }
    assert.equal(SUB.srt(p, { t0, t1 }), text, 'deterministic');
  }
});

test('srt on the fixture projects: every cue equals a planned line, times rounded to ms', () => {
  for (const name of corpus.ALL_PROJECTS) {
    const doc = MIG.parseFile(corpus.projectText(name)).doc;
    const p = PL.run(doc, STUB, null);
    const cues = parseSrt(SUB.srt(p));
    const want = p.lines.filter((l) => l.text.trim() && l.t1 - l.t0 >= 0.1);
    assert.ok(cues.length > 0, name);
    assert.deepEqual(cues.map((c) => [c.start, c.end, c.text]),
      want.map((l) => [Math.round(l.t0 * 1000), Math.round(Math.min(l.t1, p.duration) * 1000), l.text]), name);
    const byCut = parseSrt(SUB.srt(p, { per: 'cut' }));
    assert.equal(byCut.length, p.cuts.filter((c) => c.line && c.text.trim()).length, name + ' per cut');
  }
});

// --- lrc ------------------------------------------------------------------------------------------------------------

// ui/project_io lrcText as it was before it moved to export/subtitles (DESIGN_2_1 §13.8: "same bytes"), kept here as
// the reference, with its own [mm:ss.xx] formatter.
function previousLrcText(app) {
  function lrcTag(s) {
    const cs = Math.max(0, Math.round(s * 100));
    const m = Math.floor(cs / 6000), sec = Math.floor(cs / 100) % 60, c = cs % 100;
    return '[' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + '.' + String(c).padStart(2, '0') + ']';
  }
  const plan = app.plan;
  const byRow = new Map();
  for (const l of plan ? plan.lines : []) {
    const row = l.row || l.id;
    if (!byRow.has(row)) byRow.set(row, []);
    byRow.get(row).push(l);
  }
  const out = [];
  for (const row of app.doc.sheet.rows) {
    if (L.isMetaRow(row.src)) { out.push(row.src.trim()); continue; }
    const lines = byRow.get(row.id);
    if (!lines) continue;
    const tags = lines.map((l) => l.t0).sort((a, b) => a - b).map(lrcTag).join('');
    out.push(tags + lines[0].text);
  }
  return out.join('\n') + '\n';
}

test('lrc: the same bytes as the previous lrcText on every fixture project (and on ui/project_io today)', () => {
  const IO = MV.use('ui/project_io');
  const t = T.createT('ja', STRINGS);
  for (const name of corpus.ALL_PROJECTS) {
    const doc = MIG.parseFile(corpus.projectText(name)).doc;
    const p = PL.run(doc, STUB, null);
    const app = { t, bus: { emit() {} }, doc, plan: p };
    const got = SUB.lrc(p, doc);
    assert.equal(got, previousLrcText(app), name);
    assert.equal(got, IO.create(app).lrcText(), name + ' (ui/project_io)');
    assert.ok(/^\[\d\d:\d\d\.\d\d\]/m.test(got), name + ' has timed rows');
  }
});

test('lrc: meta rows as written, repeated rows with every start ascending, LF endings, no plan → meta rows only', () => {
  const rows = ['[ti:朝]', ' [ar:誰か] ', '# サビ', '', '窓をあけて', '[00:30.00][00:10.00]くりかえし', 'untimed'].map((src, i) => ({ id: 'r' + (i + 1), src }));
  const doc = { sheet: { rows } };
  const p = { lines: [
    { id: 'r5', row: 'r5', t0: 1.5, text: '窓をあけて' },
    { id: 'r6.2', row: 'r6', t0: 6005.999, text: 'くりかえし' },
    { id: 'r6', row: 'r6', t0: 10, text: 'くりかえし' },
    { id: 'r6.1', row: 'r6', t0: 30.004, text: 'くりかえし' },
  ] };
  assert.equal(SUB.lrc(p, doc), '[ti:朝]\n[ar:誰か]\n[00:01.50]窓をあけて\n[00:10.00][00:30.00][100:06.00]くりかえし\n');
  assert.equal(SUB.lrc(p, doc), previousLrcText({ plan: p, doc }));
  assert.equal(SUB.lrc(null, doc), '[ti:朝]\n[ar:誰か]\n');
  assert.equal(SUB.lrc(null, doc), previousLrcText({ plan: null, doc }));
});
