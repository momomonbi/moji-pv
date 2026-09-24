/* Unit tests for the song-audio AI features (src/11t_ai_audio.js). No network, no key.
   usage: node dev/ai_audio_test.js */
'use strict';
const assert = require('assert');
const J = require('./engine_node')();
const AI = J.AI;
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), m);
let n = 0, failed = 0;
const test = async (name, fn) => { n++; try { await fn(); console.log('  ok  ', name); } catch (e) { failed++; console.log('  FAIL', name, '\n       ', e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n        ') : e); } };
const fakeFetch = (status, body, seen, headers) => async (url, init) => { seen && seen.push({ url, init }); return { ok: status < 400, status, json: async () => body, headers: { get: k => (headers || {})[k.toLowerCase()] || null } }; };

(async () => {
  console.log('audio encoding');
  await test('WAV header and size: 16 kHz mono 16-bit from 44.1 kHz stereo', () => {
    const sr = 44100, sec = 2, L = new Float32Array(sr * sec), R = new Float32Array(sr * sec);
    for (let i = 0; i < L.length; i++) { L[i] = Math.sin(i / 20) * 0.3; R[i] = -L[i] * 0.5; }
    const w = AI.encodeWav([L, R], sr, 16000);
    const dv = new DataView(w.buffer);
    assert.strictEqual(String.fromCharCode(...w.slice(0, 4)), 'RIFF');
    assert.strictEqual(String.fromCharCode(...w.slice(8, 12)), 'WAVE');
    assert.strictEqual(dv.getUint16(22, true), 1, 'mono');
    assert.strictEqual(dv.getUint32(24, true), 16000, 'rate');
    assert.strictEqual(dv.getUint16(34, true), 16, 'bits');
    assert.strictEqual(w.length, 44 + Math.floor(sr * sec / (sr / 16000)) * 2);
    assert.strictEqual(dv.getUint32(40, true), w.length - 44);
  });
  await test('long songs get a lower rate so they still fit inline', () => {
    assert.strictEqual(AI.pickRate(240), 16000);
    assert.strictEqual(AI.pickRate(9 * 60), 12000);
    assert.strictEqual(AI.pickRate(13 * 60), 8000);
    assert.strictEqual(AI.pickRate(20 * 60), 16000, 'too long for inline: Files API at full rate');
  });
  await test('base64 matches Node for odd lengths', () => {
    for (const len of [0, 1, 2, 3, 100001]) { const u = new Uint8Array(len).map((_, i) => (i * 37) & 255); assert.strictEqual(AI.toBase64(u), Buffer.from(u).toString('base64')); }
  });
  await test('audioPart: inline when small, Files API (resumable) when large', async () => {
    const small = await AI.audioPart({ audio: { bytes: new Uint8Array(10), mimeType: 'audio/wav' }, apiKey: 'k' });
    eq(small, { inlineData: { mimeType: 'audio/wav', data: 'AAAAAAAAAAAAAA==' } });
    const seen = [];
    let step = 0;
    const f = async (url, init) => {
      seen.push({ url, init }); step++;
      if (step === 1) return { ok: true, status: 200, json: async () => ({}), headers: { get: k => (k.toLowerCase() === 'x-goog-upload-url' ? 'https://upload.example/u1' : null) } };
      if (step === 2) return { ok: true, status: 200, json: async () => ({ file: { name: 'files/abc', uri: 'https://generativelanguage.googleapis.com/v1beta/files/abc', state: 'ACTIVE' } }), headers: { get: () => null } };
      throw new Error('unexpected');
    };
    const saved = AI.INLINE_MAX_BYTES; AI.INLINE_MAX_BYTES = 5;
    try {
      const big = await AI.audioPart({ audio: { bytes: new Uint8Array(10), mimeType: 'audio/wav' }, apiKey: 'KEY', fetchImpl: f });
      eq(big, { fileData: { mimeType: 'audio/wav', fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/abc' } });
    } finally { AI.INLINE_MAX_BYTES = saved; }
    assert.strictEqual(seen[0].url, AI.FILES_UPLOAD);
    const h = seen[0].init.headers;
    assert.strictEqual(h['x-goog-upload-protocol'], 'resumable'); assert.strictEqual(h['x-goog-upload-command'], 'start');
    assert.strictEqual(h['x-goog-upload-header-content-length'], '10'); assert.strictEqual(h['x-goog-api-key'], 'KEY');
    assert.strictEqual(seen[1].url, 'https://upload.example/u1');
    assert.strictEqual(seen[1].init.headers['x-goog-upload-command'], 'upload, finalize');
    assert.ok(!seen.some(x => x.url.includes('KEY')), 'key never in a URL');
  });
  await test('upload that cannot start (no upload URL readable) -> upload error', async () => {
    const saved = AI.INLINE_MAX_BYTES; AI.INLINE_MAX_BYTES = 5;
    try { await assert.rejects(AI.audioPart({ audio: { bytes: new Uint8Array(10), mimeType: 'audio/wav' }, apiKey: 'k', fetchImpl: fakeFetch(200, {}) }), e => e.code === 'upload'); }
    finally { AI.INLINE_MAX_BYTES = saved; }
  });

  console.log('requests');
  await test('Gemini request carries the audio part before the prompt; the other service refuses audio', async () => {
    const seen = [];
    await AI.call({ provider: 'gemini', apiKey: 'k', system: 's', prompt: 'p', schema: AI.ANALYZE_SCHEMA, media: [{ inlineData: { mimeType: 'audio/wav', data: 'AA==' } }],
      fetchImpl: fakeFetch(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{}' }] } }] }, seen) });
    const body = JSON.parse(seen[0].init.body);
    eq(body.contents[0].parts, [{ inlineData: { mimeType: 'audio/wav', data: 'AA==' } }, { text: 'p' }]);
    await assert.rejects(AI.call({ provider: 'claude', apiKey: 'k', system: '', prompt: '', schema: {}, media: [{}] }), e => e.code === 'no_audio');
  });
  await test('schemas are portable (closed objects, all properties required)', () => {
    const walk = (s, w) => {
      if (s.type === 'object') { assert.strictEqual(s.additionalProperties, false, w); eq([...s.required].sort(), Object.keys(s.properties).sort(), w); for (const [k, v] of Object.entries(s.properties)) walk(v, w + '.' + k); }
      if (s.type === 'array') walk(s.items, w + '[]');
    };
    walk(AI.TRANSCRIBE_SCHEMA, 't'); walk(AI.ALIGN_SCHEMA, 'a'); walk(AI.ANALYZE_SCHEMA, 'z');
  });

  console.log('answers');
  await test('seconds() reads numbers and mm:ss(.s) strings', () => {
    eq([AI.seconds('83.5'), AI.seconds(83.5), AI.seconds('1:23.5'), AI.seconds('01:23'), AI.seconds('0:01:23.5')], [83.5, 83.5, 83.5, 83, 83.5]);
    assert.ok(isNaN(AI.seconds('abc'))); assert.ok(isNaN(AI.seconds('1:99:x')));
    assert.strictEqual(AI.lrcTag(83.456), '[01:23.46]');
  });
  await test('transcript: sorted, bad times dropped, syntax characters neutralised, LRC lyrics parse back', () => {
    const r = AI.transcriptLines({ language: 'ja', note: '', lines: [
      { start: '00:20.0', text: '二行目' }, { start: '00:05.5', text: '一行目 / *強* | 注' }, { start: 'x', text: '時刻なし' }, { start: '10:00', text: '曲より後' }, { start: '00:30', text: 'Yeah!' }, { start: '00:31', text: '' },
    ] }, 120);
    eq(r.lines.map(l => [l.start, l.text]), [[5.5, '一行目 強 注'], [20, '二行目'], [30, 'Yeah!']]);
    assert.strictEqual(r.warnings.length, 2);
    const lyr = AI.transcriptLyrics(r.lines, true);
    const parsed = J.parseLyrics(lyr).lines;
    eq(parsed.map(l => [l.lrc, l.text, l.impact]), [[5.5, '一行目 強 注', false], [20, '二行目', false], [30, 'Yeah！', false]]);
    eq(J.parseLyrics(AI.transcriptLyrics(r.lines, false)).lines.map(l => l.lrc), [null, null, null]);
  });
  await test('transcript lines that start with # stay lyrics', () => {
    const r = AI.transcriptLines({ lines: [{ start: '0:01', text: '#タグ' }] }, 10);
    eq(J.parseLyrics(AI.transcriptLyrics(r.lines, false)).lines.map(l => l.text), ['＃タグ']);
  });
  const P = Object.assign(J.defaultProject(), { lyrics: 'A\nB\nC\nD', seed: 3 });
  const plan = J.plan(P, null);
  await test('alignment: increasing times only, unchanged lines skipped, applied as manual start times', () => {
    const r = AI.alignChanges(P, plan, { note: '', lines: [{ i: 0, start: '00:0' + plan.lines[0].start.toFixed(2) }, { i: 1, start: '0:10' }, { i: 2, start: '0:08' }, { i: 3, start: '0:20' }, { i: 7, start: '0:30' }] }, 60);
    eq(r.changes.map(c => [c.i, c.to]), [[1, 10], [3, 20]]);
    assert.strictEqual(r.warnings.length, 1, 'line 2 goes back in time');
    const P2 = AI.applyTimes(P, r.changes);
    eq(P2.timing.lineTimes, { 1: 10, 3: 20 });
    const plan2 = J.plan(P2, null);
    assert.strictEqual(plan2.lines[1].start, 10); assert.strictEqual(plan2.lines[3].start, 20);
    assert.strictEqual(P.timing.lineTimes[1], undefined, 'input not modified');
  });
  await test('alignment is refused for lyrics with LRC tags', () => {
    assert.ok(AI.hasLrc({ lyrics: '[00:01.00]a\nb' })); assert.ok(!AI.hasLrc({ lyrics: 'a\nb' }));
  });
  await test('song analysis: cleaned, and turned into prompt context with the lines of each section', () => {
    const info = AI.songInfo({ summary: 's', mood: 'bright', bpm: 128, sections: [
      { kind: 'chorus', start: '0:08', end: '0:30' }, { kind: 'intro', start: '0:00', end: '0:08' }, { kind: 'weird', start: '0:30', end: '0:25' }, { kind: 'rap', start: '0:30', end: '0:40' },
    ], highlights: [{ time: '0:08', what: 'first chorus' }, { time: 'x', what: 'bad' }] }, 40);
    eq(info.sections.map(s => [s.kind, s.start, s.end]), [['intro', 0, 8], ['chorus', 8, 30], ['other', 30, 40]]);
    eq(info.highlights, [{ time: 8, what: 'first chorus' }]);
    assert.strictEqual(info.bpm, 128);
    const P3 = Object.assign({}, P, { songInfo: info, timing: Object.assign({}, P.timing, { lineTimes: { 0: 1, 1: 9, 2: 15, 3: 31 } }) });
    const ctx = AI.songContext(P3, J.plan(P3, null));
    assert.ok(ctx.includes('chorus 8.0-30.0s lines 1-2'), ctx);
    const q = AI.proposalsRequest(P3, J.plan(P3, null), 'ja');
    assert.ok(q.prompt.includes('Song analysis (from the audio)'));
    assert.ok(!AI.proposalsRequest(P, plan, 'ja').prompt.includes('Song analysis'), 'no analysis -> no context');
  });

  console.log(`\n${n - failed}/${n} passed`);
  process.exit(failed ? 1 : 0);
})();
