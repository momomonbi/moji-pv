/* 文字PVメーカー v2 — original work. Tests for ai/song: audio parts, uploads, transcription, alignment, analysis (DESIGN §4.22.4, §4.22.6, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { deepEqual } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const SONG = MV.use('ai/song');
const PR = MV.use('ai/providers');
const CH = MV.use('ai/changes');
const LK = MV.use('ai/looks');
const L = MV.use('core/lyrics');
const D = MV.use('core/doc');
const TM = MV.use('core/timing');
const PINS = MV.use('core/pins');
const CMD = MV.use('core/commands');
const ST = MV.use('core/store');

function fakeFetch(status, body, seen, headers) {
  return async (url, init) => {
    if (seen) seen.push({ url, init });
    return { ok: status < 400, status, json: async () => body, headers: { get: (k) => (headers || {})[k.toLowerCase()] || null } };
  };
}

function docOf(text, song) {
  let doc = CMD.reduce(D.defaultDoc(), { t: 'lyrics.set', text });
  if (song !== false) doc = CMD.reduce(doc, { t: 'song.set', song: { name: 'song.wav', sha1: 'abc123', seconds: 60 } });
  return doc;
}

// The lines of the §3.12 Plan that the song tools read (ids, text, start times and where they come from).
function planOf(doc) {
  const lines = L.linesOf(L.parseSheet(doc.sheet.rows), {});
  const res = TM.solveTimes(lines, { pins: PINS.index(doc.pins), timing: doc.timing, songSeconds: doc.song ? doc.song.seconds : null,
    bpm: null, readRate: null, lengthPin: null, titleCard: 0 });
  return {
    duration: res.duration,
    lines: lines.map((l, i) => ({ id: l.id, row: l.row, index: i, text: l.text, t0: res.times[i].t0, t1: res.times[i].t1,
      by: res.times[i].by, cuts: [l.id + '~0'], locked: false, lang: l.lang })),
  };
}

// ---- audio ---------------------------------------------------------------------------------------------------------

test('WAV header and size: 16 kHz mono 16-bit from 44.1 kHz stereo', () => {
  const sr = 44100, sec = 2;
  const Lc = new Float32Array(sr * sec), Rc = new Float32Array(sr * sec);
  for (let i = 0; i < Lc.length; i++) { Lc[i] = Math.sin(i / 20) * 0.3; Rc[i] = -Lc[i] * 0.5; }
  const audio = SONG.audioFromBuffer({ numberOfChannels: 2, sampleRate: sr, duration: sec, getChannelData: (c) => (c ? Rc : Lc) });
  const w = audio.bytes;
  const dv = new DataView(w.buffer);
  assert.equal(String.fromCharCode(...w.slice(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...w.slice(8, 12)), 'WAVE');
  assert.equal(dv.getUint16(22, true), 1, 'mono');
  assert.equal(dv.getUint32(24, true), 16000, 'rate');
  assert.equal(dv.getUint16(34, true), 16, 'bits');
  assert.equal(w.length, 44 + Math.floor(sr * sec / (sr / 16000)) * 2);
  assert.equal(dv.getUint32(40, true), w.length - 44);
  deepEqual([audio.mimeType, audio.seconds, audio.rate], ['audio/wav', 2, 16000]);
  assert.deepEqual(SONG.encodeWav([Lc, Rc], sr, 16000), w, 'the Media package encoder');
  deepEqual(SONG.audioSize({ bytes: new Uint8Array(7 * 1024 * 1024 + 60000), seconds: 222 }), { mb: 7.1, seconds: 222 });
});

test('long songs get a lower rate so they still fit inline', () => {
  assert.equal(SONG.pickRate(240), 16000);
  assert.equal(SONG.pickRate(9 * 60), 12000);
  assert.equal(SONG.pickRate(13 * 60), 8000);
  assert.equal(SONG.pickRate(20 * 60), 16000, 'too long for inline: Files API at full rate');
  assert.equal(SONG.audioFromChannels([new Float32Array(48000)], 48000).seconds, 1);
});

test('base64 matches Node for odd lengths and across chunks', () => {
  for (const len of [0, 1, 2, 3, 49151, 49152, 49153, 100001]) {
    const u = new Uint8Array(len).map((_, i) => (i * 37) & 255);
    assert.equal(SONG.toBase64(u), Buffer.from(u).toString('base64'), String(len));
  }
});

test('audioPart: inline when small, Files API (resumable upload) when large; the key never goes into a URL', async () => {
  const small = await SONG.audioPart({ audio: { bytes: new Uint8Array(10), mimeType: 'audio/wav' }, apiKey: 'k' });
  deepEqual(small, { inlineData: { mimeType: 'audio/wav', data: 'AAAAAAAAAAAAAA==' } });
  const seen = [], stages = [];
  let step = 0;
  const f = async (url, init) => {
    seen.push({ url, init });
    step++;
    if (step === 1) return { ok: true, status: 200, json: async () => ({}), headers: { get: (k) => (k.toLowerCase() === 'x-goog-upload-url' ? 'https://upload.example/u1' : null) } };
    if (step === 2) return { ok: true, status: 200, json: async () => ({ file: { name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', state: 'PROCESSING' } }) };
    if (step === 3) return { ok: true, status: 200, json: async () => ({ name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', state: 'ACTIVE' }) };
    throw new Error('unexpected request ' + step);
  };
  const slept = [];
  const big = await SONG.audioPart({ audio: { bytes: new Uint8Array(10), mimeType: 'audio/wav' }, apiKey: 'KEY', fetchImpl: f,
    inlineMax: 5, onStage: (s) => stages.push(s), sleep: async (ms) => { slept.push(ms); } });
  deepEqual(big, { fileData: { mimeType: 'audio/wav', fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc' } });
  assert.equal(seen[0].url, SONG.FILES_UPLOAD);
  const h = seen[0].init.headers;
  assert.equal(h['x-goog-upload-protocol'], 'resumable');
  assert.equal(h['x-goog-upload-command'], 'start');
  assert.equal(h['x-goog-upload-header-content-length'], '10');
  assert.equal(h['x-goog-upload-header-content-type'], 'audio/wav');
  assert.equal(h['x-goog-api-key'], 'KEY');
  assert.equal(seen[1].url, 'https://upload.example/u1');
  assert.equal(seen[1].init.headers['x-goog-upload-command'], 'upload, finalize');
  assert.equal(seen[1].init.headers['x-goog-upload-offset'], '0');
  assert.equal(seen[2].url, SONG.FILES_BASE + 'files/abc');
  assert.equal(seen[2].init.headers['x-goog-api-key'], 'KEY');
  deepEqual(slept, [1000]);
  deepEqual(stages, ['upload', 'process']);
  assert.ok(!seen.some((x) => x.url.includes('KEY')), 'key never in a URL');
});

test('upload errors: no upload URL, a failed start, a failed file, a file that never becomes ACTIVE', async () => {
  const audio = { bytes: new Uint8Array(10), mimeType: 'audio/wav' };
  const code = async (fetchImpl, extra) => {
    try { await SONG.audioPart(Object.assign({ audio, apiKey: 'k', fetchImpl, inlineMax: 5, sleep: async () => {} }, extra)); return 'none'; }
    catch (e) { return e.code; }
  };
  assert.equal(await code(fakeFetch(200, {})), 'upload', 'no upload URL readable');
  assert.equal(await code(fakeFetch(403, { error: { message: 'denied' } })), 'auth');
  assert.equal(await code(fakeFetch(429, {})), 'rate');
  assert.equal(await code(fakeFetch(400, {})), 'upload');
  assert.equal(await code(async () => { throw new TypeError('offline'); }), 'network');
  const stuck = (state) => {
    let n = 0;
    return async () => {
      n++;
      if (n === 1) return { ok: true, status: 200, json: async () => ({}), headers: { get: () => 'https://upload.example/u' } };
      if (n === 2) return { ok: true, status: 200, json: async () => ({ file: { name: 'files/x', uri: 'u', state } }) };
      return { ok: true, status: 200, json: async () => ({ name: 'files/x', uri: 'u', state }) };
    };
  };
  assert.equal(await code(stuck('PROCESSING')), 'upload', 'still processing after the polls');
  assert.equal(await code(stuck('FAILED')), 'upload');
  const aborted = new AbortController();
  aborted.abort();
  const abortFetch = async (url, init) => { if (init.signal && init.signal.aborted) { const e = new Error('a'); e.name = 'AbortError'; throw e; } return null; };
  assert.equal(await code(abortFetch, { signal: aborted.signal }), 'aborted');
});

// A resumable upload whose file is PROCESSING, then answers each poll with polls[k] ({ status, body }).
function uploadThenPolls(polls, seen) {
  let n = 0;
  return async (url, init) => {
    if (seen) seen.push({ url, init });
    n++;
    if (n === 1) return { ok: true, status: 200, json: async () => ({}), headers: { get: () => 'https://upload.example/u' } };
    if (n === 2) return { ok: true, status: 200, json: async () => ({ file: { name: 'files/x', uri: 'https://f/x', state: 'PROCESSING' } }) };
    const p = polls[Math.min(n - 3, polls.length - 1)];
    return { ok: p.status < 400, status: p.status, json: async () => p.body };
  };
}

test('a failed poll is an error, not a file: its status maps to a code and no part without a uri is returned', async () => {
  const audio = { bytes: new Uint8Array(10), mimeType: 'audio/wav' };
  const run = async (polls) => {
    try {
      return await SONG.audioPart({ audio, apiKey: 'k', fetchImpl: uploadThenPolls(polls), inlineMax: 5, sleep: async () => {} });
    } catch (e) { return e.code; }
  };
  assert.equal(await run([{ status: 503, body: { error: { code: 503, message: 'unavailable' } } }]), 'server');
  assert.equal(await run([{ status: 404, body: { error: { message: 'gone' } } }]), 'upload');
  assert.equal(await run([{ status: 200, body: null }]), 'upload', 'an unreadable poll leaves the file PROCESSING');
  assert.equal(await run([{ status: 200, body: { name: 'files/x', state: 'ACTIVE', uri: '' } }]), 'upload', 'no uri');
  deepEqual(await run([{ status: 200, body: { name: 'files/x', state: 'PROCESSING' } }, { status: 200, body: { state: 'ACTIVE' } }]),
    { fileData: { mimeType: 'audio/wav', fileUri: 'https://f/x' } }, 'a poll record without uri keeps the upload\'s uri');
});

test('the key never appears in an upload error message', async () => {
  const key = 'AIzaVERYSECRETKEY1234567890123456789';
  const audio = { bytes: new Uint8Array(10), mimeType: 'audio/wav' };
  const errorOf = async (fetchImpl) => {
    try { await SONG.audioPart({ audio, apiKey: key, fetchImpl, inlineMax: 5, sleep: async () => {} }); } catch (e) { return e; }
    return null;
  };
  const cases = [
    async () => { throw new TypeError('Headers.append: "' + key + '\nX" is an invalid header value.'); },
    fakeFetch(400, { error: { message: 'API key not valid: ' + key } }),
    fakeFetch(403, { error: { message: 'denied for ' + key } }),
    uploadThenPolls([{ status: 500, body: { error: { message: 'internal for ' + key } } }]),
  ];
  for (const f of cases) {
    const e = await errorOf(f);
    assert.ok(e && e.code, 'an error');
    assert.ok(!String(e.message).includes(key), e.code + ': ' + e.message);
  }
});

test('the Gemini request carries the audio part before the prompt; the other service refuses audio', async () => {
  const seen = [];
  await PR.call({ provider: 'gemini', apiKey: 'k', system: 's', prompt: 'p', schema: SONG.ANALYZE_SCHEMA,
    media: [{ inlineData: { mimeType: 'audio/wav', data: 'AA==' } }],
    fetchImpl: fakeFetch(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }] }, seen) });
  const body = JSON.parse(seen[0].init.body);
  deepEqual(body.contents[0].parts, [{ inlineData: { mimeType: 'audio/wav', data: 'AA==' } }, { text: 'p' }]);
  await assert.rejects(PR.call({ provider: 'claude', apiKey: 'k', system: '', prompt: '', schema: {}, media: [{}] }), (e) => e.code === 'no_audio');
});

test('a transcription stopped as recitation gets its own code (paste the lyrics and align instead)', async () => {
  const q = SONG.transcribeRequest('ja');
  await assert.rejects(PR.call({ apiKey: 'k', system: q.system, prompt: q.prompt, schema: q.schema,
    media: [{ inlineData: { mimeType: 'audio/wav', data: 'AA==' } }],
    fetchImpl: fakeFetch(200, { candidates: [{ finishReason: 'RECITATION' }] }) }), (e) => e.code === 'recitation');
});

// ---- answers -------------------------------------------------------------------------------------------------------

test('seconds() reads numbers and mm:ss(.s) strings; lrcTag writes them', () => {
  deepEqual([SONG.seconds('83.5'), SONG.seconds(83.5), SONG.seconds('1:23.5'), SONG.seconds('01:23'), SONG.seconds('0:01:23.5')],
    [83.5, 83.5, 83.5, 83, 83.5]);
  assert.ok(Number.isNaN(SONG.seconds('abc')));
  assert.ok(Number.isNaN(SONG.seconds('1:99:x')));
  assert.ok(Number.isNaN(SONG.seconds(null)));
  assert.equal(SONG.lrcTag(83.456), '[01:23.46]');
});

test('transcript: sorted, bad times dropped, syntax characters neutralised, LRC rows parse back', () => {
  const r = SONG.transcriptLines({ language: 'ja', note: 'n', lines: [
    { start: '00:20.0', text: '二行目' }, { start: '00:05.5', text: '一行目 / *強* | 注' }, { start: 'x', text: '時刻なし' },
    { start: '10:00', text: '曲より後' }, { start: '00:30', text: 'Yeah!' }, { start: '00:31', text: '' },
    { start: '00:40', text: '改行\nあり' },
  ] }, 120);
  deepEqual(r.lines.map((l) => [l.start, l.text]), [[5.5, '一行目 強 注'], [20, '二行目'], [30, 'Yeah！'], [40, '改行 あり']]);
  deepEqual(r.warnings, [['ai.warn.badTime', { time: 'x' }], ['ai.warn.badTime', { time: '10:00' }]]);
  deepEqual([r.language, r.note], ['ja', 'n']);
  const rows = r.text.split('\n').map((src) => L.parseRow(src));
  deepEqual(rows.map((p) => [p.kind, p.stamps, p.text, p.impact, p.pieces, p.emph, p.note]), [
    ['lyric', [5.5], '一行目 強 注', false, null, [], null], ['lyric', [20], '二行目', false, null, [], null],
    ['lyric', [30], 'Yeah！', false, null, [], null], ['lyric', [40], '改行 あり', false, null, [], null]]);
  deepEqual(r.plain.split('\n').map((src) => L.parseRow(src).stamps), [[], [], [], []]);
});

test('transcript lines that start with # or [ stay lyric rows', () => {
  const r = SONG.transcriptLines({ lines: [{ start: '0:01', text: '#タグ' }, { start: '0:02', text: '[ti:x]' }, { start: '0:03', text: '[00:09]歌' }] }, 10);
  for (const text of [r.text, r.plain]) {
    const rows = text.split('\n').map((src) => L.parseRow(src));
    deepEqual(rows.map((p) => [p.kind, p.text]), [['lyric', '＃タグ'], ['lyric', '[ti:x]'], ['lyric', '[00:09]歌']]);
  }
});

test('transcript changes: replace or append the lyrics with lyrics.set; row ids follow through reconcile', () => {
  const doc = docOf('一行目\n二行目');
  const res = SONG.transcriptLines({ lines: [{ start: '0:05', text: '一行目' }, { start: '0:12', text: '三行目' }] }, 60);
  const rep = SONG.transcriptChange(doc, res, 'replace', { rev: 3 });
  deepEqual([rep.kind, rep.mode, rep.scope, rep.base.rev, rep.label], ['rows', 'replace', 'rows', 3, ['ai.ch.rows.replace', { n: 2 }]]);
  const cmds = CH.toCommands(doc, null, [rep]);
  deepEqual(cmds, [{ t: 'lyrics.set', text: '[00:05.00]一行目\n[00:12.00]三行目' }]);
  const after = CH.apply(doc, null, [rep]);
  assert.equal(after.sheet.rows[0].id, doc.sheet.rows[0].id, 'the kept line keeps its id');
  const app = SONG.transcriptChange(doc, res, 'append', { withTimes: false });
  deepEqual(CH.toCommands(doc, null, [app]), [{ t: 'lyrics.set', text: '一行目\n二行目\n\n一行目\n三行目' }]);
  const stale = CH.markStale(CMD.reduce(doc, { t: 'lyrics.set', text: '一行目\n二行目\n四行目' }), null, [rep]);
  deepEqual([stale[0].stale, stale[0].checked], [true, false]);
});

test('alignRequest numbers the plan lines; only lyric text is sent', () => {
  const doc = docOf('A\nB\n[00:30.00][01:00.00]C');
  const q = SONG.alignRequest(doc, planOf(doc), 'en');
  deepEqual(q.lines.map((l) => [l.i, l.text]), [[0, 'A'], [1, 'B'], [2, 'C'], [3, 'C']]);
  assert.ok(q.prompt.endsWith('3: C'));
  assert.match(q.system, /English/);
  assert.equal(q.effort, 'medium');
});

test('alignment: increasing times only, unchanged lines skipped, pins by ai that the timing solver honours', () => {
  const doc = docOf('A行\nB行\nC行\nD行');
  const plan = planOf(doc);
  const r = SONG.alignChanges(doc, plan, { note: 'n', lines: [
    { i: 0, start: '00:0' + plan.lines[0].t0.toFixed(2) }, { i: 1, start: '0:10' }, { i: 2, start: '0:08' }, { i: 3, start: '0:20' },
    { i: 7, start: '0:30' }, { i: 1, start: '0:11' },
  ] }, 60, { rev: 1 });
  deepEqual(r.changes.map((c) => [c.lineId, c.to, c.path, c.overLrc]),
    [[plan.lines[1].id, 10, 'line/' + plan.lines[1].id + ':start', false], [plan.lines[3].id, 20, 'line/' + plan.lines[3].id + ':start', false]]);
  deepEqual(r.warnings, [['ai.warn.lineTime', { n: 3, time: '0:08' }]], 'line 2 goes back in time');
  assert.equal(r.note, 'n');
  const cmds = CH.toCommands(doc, plan, r.changes);
  deepEqual(cmds.map((c) => [c.t, c.by, c.v]), [['pin.set', 'ai', 10], ['pin.set', 'ai', 20]]);
  const store = ST.createStore({ doc, reduce: CMD.reduce });
  store.batch({ label: ['undo.ai', { tool: 'align', n: 2 }] }, cmds);
  const plan2 = planOf(store.doc);
  assert.equal(plan2.lines[1].t0, 10);
  assert.equal(plan2.lines[3].t0, 20);
  assert.equal(plan2.lines[1].by.start, 'pin');
  assert.equal(store.doc.sheet, doc.sheet, 'the text is never rewritten by timing');
  store.undo();
  assert.equal(store.doc, doc);
  deepEqual(SONG.alignChanges(doc, plan, { lines: [{ i: 1, start: '1:30' }] }, 60).changes, [], 'after the end of the song');
});

test('alignment answers map through the request\'s line ids (a line typed while it ran moves nothing)', () => {
  const docA = docOf('A行\nB行\nC行');
  const planA = planOf(docA);
  const q = SONG.alignRequest(docA, planA, 'ja');
  const docB = CMD.reduce(docA, { t: 'lyrics.set', text: '新しい行\nA行\nB行です\nC行' });
  const planB = planOf(docB);
  const json = { lines: [{ i: 0, start: '0:05' }, { i: 1, start: '0:09' }, { i: 2, start: '0:14' }] };
  const sent = SONG.alignChanges(docA, planA, json, 60, { rev: 2, lines: q.lines });
  deepEqual(sent.changes.map((c) => c.lineId), planA.lines.map((l) => l.id));
  const marked = CH.markStale(docB, planB, sent.changes);
  deepEqual(marked.map((c) => c.stale), [false, true, false], 'the reworded row is stale');
  const late = SONG.alignChanges(docB, planB, json, 60, { lines: q.lines });
  deepEqual(late.changes.map((c) => c.lineId), [planA.lines[0].id, planA.lines[2].id]);
  deepEqual(late.warnings, [['ai.warn.changedSince', { n: 2 }]]);
  assert.ok(!late.changes.some((c) => c.lineId === planB.lines[0].id), 'the new line gets no time');
});

test('alignment is allowed over LRC stamps: the pin wins and the review row says so', () => {
  const doc = docOf('[00:05.00]A行\nB行\n[00:20.00]C行');
  const plan = planOf(doc);
  assert.equal(plan.lines[0].by.start, 'lrc');
  const r = SONG.alignChanges(doc, plan, { lines: [{ i: 0, start: '0:06' }, { i: 1, start: '0:12' }] }, 60);
  deepEqual(r.changes.map((c) => [c.overLrc, c.label[0], c.fromSource]), [[true, 'ai.ch.time.lrc', 'lrc'], [false, 'ai.ch.time', 'auto']]);
  const after = CH.apply(doc, plan, r.changes);
  assert.equal(planOf(after).lines[0].t0, 6, 'the pin beats the stamp');
  assert.equal(after.sheet.rows[0].src, '[00:05.00]A行', 'the stamp stays in the text');
  const retimed = CMD.reduce(doc, { t: 'lyrics.row', rowId: doc.sheet.rows[0].id, src: '[00:07.00]A行' });
  assert.equal(CH.markStale(retimed, null, r.changes)[0].stale, true, 'a changed stamp makes the row stale');
});

test('song analysis: cleaned and capped; stored with song.info; context lists the lines of each section', () => {
  const info = SONG.songInfo({ summary: 's', mood: 'bright', bpm: 128.04, sections: [
    { kind: 'chorus', start: '0:08', end: '0:30' }, { kind: 'intro', start: '0:00', end: '0:08' }, { kind: 'weird', start: '0:30', end: '0:25' },
    { kind: 'rap', start: '0:30', end: '0:40' }, { kind: 'outro', start: 'x', end: '0:50' },
  ], highlights: [{ time: '0:08', what: 'first chorus' }, { time: 'x', what: 'bad' }, { time: '9:00', what: 'late' }] }, 40);
  deepEqual(info.sections.map((s) => [s.kind, s.start, s.end]), [['intro', 0, 8], ['chorus', 8, 30], ['other', 30, 40]]);
  deepEqual(info.highlights, [{ time: 8, what: 'first chorus' }]);
  deepEqual([info.bpm, info.duration, info.summary, info.mood], [128, 40, 's', 'bright']);
  assert.equal(SONG.songInfo({ bpm: 300 }, 0).bpm, 0);
  assert.equal(SONG.songInfo({ bpm: 30 }, 0).bpm, 0);
  const many = SONG.songInfo({ sections: Array.from({ length: 60 }, (_, i) => ({ kind: 'verse', start: i, end: i + 1 })),
    highlights: Array.from({ length: 20 }, (_, i) => ({ time: i, what: 'x'.repeat(100) })) }, 0);
  deepEqual([many.sections.length, many.highlights.length, many.highlights[0].what.length], [40, 8, 60]);

  let doc = docOf('A行\nB行\nC行\nD行');
  doc = CMD.reduce(doc, { t: 'batch', cmds: [[1, 1], [2, 9], [3, 15], [4, 31]].map(([k, v]) =>
    ({ t: 'pin.set', path: 'line/' + doc.sheet.rows[k - 1].id + ':start', v, by: 'tap' })) });
  const res = SONG.analyzeChanges(doc, { summary: 's', mood: 'bright', bpm: 128, sections: [{ kind: 'intro', start: '0:00', end: '0:08' },
    { kind: 'chorus', start: '0:08', end: '0:30' }, { kind: 'outro', start: '0:30', end: '0:40' }], highlights: [] }, 40);
  deepEqual(CH.toCommands(doc, null, res.changes), [{ t: 'song.info', info: res.info }]);
  const withInfo = CH.apply(doc, null, res.changes);
  deepEqual(withInfo.song.info, res.info);
  const plan = planOf(withInfo);
  const ctx = SONG.songContext(withInfo, plan);
  assert.ok(ctx.startsWith('Song analysis (from the audio): s Mood: bright. BPM: 128.'), ctx);
  assert.ok(ctx.includes('chorus 8.0-30.0s lines 1-2'), ctx);
  assert.ok(ctx.includes('intro 0.0-8.0s lines 0-0'), ctx);
  assert.equal(SONG.songContext(doc, plan), '', 'no analysis → no context');
  deepEqual(SONG.analyzeChanges(docOf('A', false), {}, 10).warnings, [['ai.warn.noSong', {}]]);
  const other = CMD.reduce(withInfo, { t: 'song.set', song: { name: 'b.wav', sha1: 'zzz', seconds: 50 } });
  deepEqual(CH.toCommands(other, null, res.changes), [], 'another song was loaded since');
});

test('the look prompts carry the song analysis when there is one', () => {
  if (!MV.has('planner/plan')) return;
  const reg = corpus.stubRegistry(MV);
  const { doc } = corpus.project('basic');
  const info = SONG.songInfo({ summary: 'bright pop', mood: 'bright', bpm: 120, sections: [{ kind: 'chorus', start: '0:00', end: '1:00' }], highlights: [] }, 60);
  const withInfo = CMD.reduce(doc, { t: 'song.info', info });
  const plan = MV.use('planner/plan').plan(withInfo, { registry: reg });
  assert.ok(LK.proposalsRequest(withInfo, plan, reg, 'ja').prompt.includes('Song analysis (from the audio): bright pop'));
  assert.ok(LK.editRequest(withInfo, plan, reg, '派手に', 'ja').prompt.includes('chorus 0.0-60.0s lines 0-' + (plan.lines.length - 1)));
  const plain = MV.use('planner/plan').plan(doc, { registry: reg });
  assert.ok(!LK.proposalsRequest(doc, plain, reg, 'ja').prompt.includes('Song analysis'));
});

test('the song context skips sections and highlights whose times are not numbers (final fixes, security-1)', () => {
  let doc = docOf('A行\nB行');
  const info = { summary: 's', mood: 'm', bpm: 0, duration: 60, highlights: [{ time: '3', what: 'x' }, null, { time: 4, what: 'hit' }],
    sections: [{ kind: 'chorus', start: '1', end: 2 }, null, { kind: 'verse', start: 0, end: NaN }, { kind: 'intro', start: 0, end: 30 }] };
  // written past the validator, as an older or edited file could hold it
  doc = Object.assign({}, doc, { song: Object.assign({}, doc.song, { info }) });
  const plan = planOf(doc);
  const ctx = SONG.songContext(doc, plan);
  assert.ok(ctx.includes('Sections: intro 0.0-30.0s lines 0-1.'), ctx);
  assert.ok(ctx.includes('Highlights: 4.0s hit.'), ctx);
  const none = Object.assign({}, doc, { song: Object.assign({}, doc.song, { info: { sections: [{ kind: 'chorus', start: '1', end: '2' }] } }) });
  assert.equal(SONG.songContext(none, plan), '', 'no usable section → no context');
  if (!MV.has('planner/plan')) return;
  const reg = corpus.stubRegistry(MV);
  const real = MV.use('planner/plan').plan(doc, { registry: reg });
  assert.ok(LK.proposalsRequest(doc, real, reg, 'ja').prompt.includes('intro 0.0-30.0s'));
  assert.ok(LK.editRequest(doc, real, reg, '派手に', 'ja').prompt.includes('intro 0.0-30.0s'));
});
