/* Unit tests for the AI core (src/11s_ai.js). No network and no API key: Gemini's fetch and Claude's SDK are faked.
   usage: node dev/ai_test.js */
'use strict';
const assert = require('assert');
const J = require('./engine_node')();
const AI = J.AI;
// the engine runs in its own vm realm: compare plain JSON copies, not prototypes
const eq = (a, b, m) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), m);
let n = 0, failed = 0;
const test = async (name, fn) => { n++; try { await fn(); console.log('  ok  ', name); } catch (e) { failed++; console.log('  FAIL', name, '\n       ', e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n        ') : e); } };

const SYNTAX = `# comment
[ti:テスト]
夜明けの色を/覚えてる|よあけ
*透明*なままじゃ終われない!

ほどけた声が遠くで鳴った
Hello/world
[00:12.50][00:30.00]ねえ、まだ間に合うかな`;
const project = over => Object.assign(J.defaultProject(), over || {});

(async () => {
  console.log('lyrics in and out');
  await test('renderLine round-trips every lyric line', () => {
    for (const text of [J.SAMPLE_LYRICS, SYNTAX, 'a/b/c!|n', '*光*の中で!', '[01:02.03]タグ付き/の行|よみ']) {
      for (const r of AI.rawLines(text).filter(r => r.lyric)) {
        const back = J.parseLyrics(AI.renderLine(r)).lines[0], orig = J.parseLyrics(r.src).lines[0];
        eq(back, orig, r.src);
      }
    }
  });
  await test('parsedOrder follows parseLyrics (including LRC sort and repeated timestamps)', () => {
    for (const text of [J.SAMPLE_LYRICS, SYNTAX, '[00:20.00]b\n[00:10.00]a\n[00:15.00][00:05.00]c']) {
      const rows = AI.rawLines(text), order = AI.parsedOrder(rows);
      eq(order.map(o => rows[o.raw].text), J.parseLyrics(text).lines.map(l => l.text));
    }
  });
  await test('editLyrics: removing a line keeps per-line settings on the same lyric', () => {
    const P = project({ lyrics: 'ラベル\n一行目\n二行目\n三行目', overrides: { 1: { layout: 'vcols' }, 3: { lock: true, lockedSeed: 9 } }, timing: Object.assign(J.defaultProject().timing, { lineTimes: { 0: 0.5, 2: 4 } }) });
    const r = AI.editLyrics(P, { 0: { remove: true } });
    assert.strictEqual(r.lyrics, '一行目\n二行目\n三行目');
    eq(r.overrides, { 0: { layout: 'vcols' }, 2: { lock: true, lockedSeed: 9 } });
    eq(r.timing.lineTimes, { 1: 4 });
  });
  await test('editLyrics: blank lines left by removals are squeezed', () => {
    const r = AI.editLyrics(project({ lyrics: '作詞：だれか\n\nA\n\n[Chorus]\n\nB' }), { 0: { remove: true }, 4: { remove: true } });
    assert.strictEqual(r.lyrics, 'A\n\nB');
  });

  console.log('1) 歌詞の下ごしらえ');
  const prepP = project({ lyrics: '作詞：だれか\n夜明けの色を覚えてる\n本気で好きだった\n短い', overrides: { 2: { layout: 'huge' } } });
  await test('prepRequest sends only lyric lines, numbered by raw line', () => {
    const q = AI.prepRequest(prepP, 'ja');
    eq(q.lines.map(l => l.i), [0, 1, 2, 3]);
    assert.ok(q.prompt.includes('1: 夜明けの色を覚えてる'));
    assert.ok(!/audio|mp3|wav/i.test(q.prompt));
  });
  await test('prepChanges validates cuts, emphasis and readings', () => {
    const { changes, warnings } = AI.prepChanges(prepP, { summary: '', lines: [
      { i: 0, remove: true, reason: 'credit', segments: [], emphasis: [], reading: '' },
      { i: 1, remove: false, reason: '', segments: ['夜明けの色を', '覚えてる'], emphasis: ['夜明け'], reading: '' },
      { i: 2, remove: false, reason: '', segments: ['本気で', 'スキだった'], emphasis: ['愛'], reading: 'まじですきだった' },
      { i: 3, remove: false, reason: '', segments: [], emphasis: [], reading: '' },
      { i: 99, remove: true, reason: '', segments: [], emphasis: [], reading: '' },
    ] });
    eq(changes.map(c => c.raw), [0, 1, 2]);
    assert.strictEqual(changes[1].after, '*夜明け*の色を/覚えてる');
    assert.strictEqual(changes[2].after, '本気で好きだった|まじですきだった');     // bad cut and unknown word dropped, reading kept
    assert.strictEqual(warnings.length, 3);
  });
  await test('applyPrep rewrites the lyrics and moves the override with its line', () => {
    const { changes } = AI.prepChanges(prepP, { lines: [{ i: 0, remove: true, reason: '', segments: [], emphasis: [], reading: '' }] });
    const r = AI.applyPrep(prepP, changes);
    assert.strictEqual(r.lyrics, '夜明けの色を覚えてる\n本気で好きだった\n短い');
    eq(r.overrides, { 1: { layout: 'huge' } });
  });

  console.log('providers (faked)');
  const schema = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } };
  const fakeFetch = (status, body, seen) => async (url, init) => { seen && seen.push({ url, init }); return { ok: status < 400, status, json: async () => body }; };
  await test('Gemini: request shape; key only in the header; thought parts ignored', async () => {
    const seen = [];
    const r = await AI.call({ provider: 'gemini', apiKey: 'SECRET', system: 'sys', prompt: 'hi', schema, effort: 'medium', fetchImpl: fakeFetch(200, {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'thinking…' }, { text: '{"a":"x"}' }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 } }, seen) });
    eq(r.json, { a: 'x' });
    eq(r.usage, { input: 100, output: 50 });
    assert.strictEqual(seen[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    assert.ok(!seen[0].url.includes('SECRET'));
    assert.strictEqual(seen[0].init.headers['x-goog-api-key'], 'SECRET');
    const body = JSON.parse(seen[0].init.body);
    assert.strictEqual(body.generationConfig.responseMimeType, 'application/json');
    eq(body.generationConfig.responseJsonSchema, schema);
    assert.strictEqual(body.generationConfig.thinkingConfig.thinkingLevel, 'MEDIUM');
    assert.strictEqual(body.systemInstruction.parts[0].text, 'sys');
  });
  await test('Gemini: errors map to codes', async () => {
    const code = async f => { try { await AI.call({ provider: 'gemini', apiKey: 'k', system: '', prompt: '', schema, fetchImpl: f }); return 'none'; } catch (e) { assert.ok(!String(e.message).includes('k"'), 'key leaked'); return e.code; } };
    assert.strictEqual(await code(fakeFetch(400, { error: { code: 400, message: 'API key not valid', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } })), 'auth');
    assert.strictEqual(await code(fakeFetch(429, { error: { message: 'quota' } })), 'rate');
    assert.strictEqual(await code(fakeFetch(404, { error: { message: 'no model' } })), 'model');
    assert.strictEqual(await code(fakeFetch(503, {})), 'server');
    assert.strictEqual(await code(async () => { throw new TypeError('Failed to fetch'); }), 'network');
    assert.strictEqual(await code(async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; }), 'aborted');
    assert.strictEqual(await code(fakeFetch(200, { promptFeedback: { blockReason: 'SAFETY' } })), 'blocked');
    assert.strictEqual(await code(fakeFetch(200, { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"a"' }] } }] })), 'truncated');
    assert.strictEqual(await code(fakeFetch(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'not json' }] } }] })), 'bad_json');
    assert.strictEqual(await code(null), 'network');
  });
  await test('no key -> no_key, nothing sent', async () => {
    let sent = false;
    await assert.rejects(AI.call({ provider: 'gemini', apiKey: '', fetchImpl: async () => { sent = true; } }), e => e.code === 'no_key');
    assert.strictEqual(sent, false);
  });
  class FakeAnthropic {
    constructor(o) { this.o = o; const self = this; FakeAnthropic.last = this; this.calls = [];
      const create = (kind) => async (req, opt) => { self.calls.push({ kind, req, opt }); if (FakeAnthropic.fail) throw FakeAnthropic.fail; return FakeAnthropic.reply; };
      this.messages = { create: create('messages') }; this.beta = { messages: { create: create('beta') } };
      this.models = { retrieve: async (id) => { self.calls.push({ kind: 'models', id }); if (FakeAnthropic.fail) throw FakeAnthropic.fail; return { id, display_name: 'Model ' + id }; } }; }
  }
  for (const n of ['APIUserAbortError', 'AuthenticationError', 'PermissionDeniedError', 'RateLimitError', 'NotFoundError', 'BadRequestError', 'InternalServerError', 'APIConnectionError']) FakeAnthropic[n] = class extends Error {};
  const okReply = { stop_reason: 'end_turn', model: 'claude-opus-5', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":"y"}' }], usage: { input_tokens: 10, output_tokens: 5 } };
  await test('Claude opus-5: SDK in browser mode, structured output, adaptive thinking, server-side fallbacks', async () => {
    FakeAnthropic.reply = okReply; FakeAnthropic.fail = null;
    const r = await AI.call({ provider: 'claude', model: 'claude-opus-5', apiKey: 'K', system: 's', prompt: 'p', schema, effort: 'medium', SDK: FakeAnthropic });
    eq(r.json, { a: 'y' });
    const c = FakeAnthropic.last;
    assert.strictEqual(c.o.dangerouslyAllowBrowser, true);
    assert.strictEqual(c.calls[0].kind, 'beta');
    const q = c.calls[0].req;
    eq(q.output_config, { format: { type: 'json_schema', schema }, effort: 'medium' });
    eq(q.thinking, { type: 'adaptive' });
    eq(q.betas, ['server-side-fallback-2026-07-01']);
    assert.strictEqual(q.fallbacks, 'default');
    assert.strictEqual(q.max_tokens, 16000);
  });
  await test('Claude haiku-4-5: no thinking / effort; sonnet-5 via messages.create', async () => {
    await AI.call({ provider: 'claude', model: 'claude-haiku-4-5', apiKey: 'K', system: 's', prompt: 'p', schema, SDK: FakeAnthropic });
    let q = FakeAnthropic.last.calls[0];
    assert.strictEqual(q.kind, 'messages'); assert.strictEqual(q.req.thinking, undefined); assert.strictEqual(q.req.output_config.effort, undefined);
    await AI.call({ provider: 'claude', model: 'claude-sonnet-5', apiKey: 'K', system: 's', prompt: 'p', schema, effort: 'low', SDK: FakeAnthropic });
    q = FakeAnthropic.last.calls[0];
    assert.strictEqual(q.kind, 'messages'); assert.strictEqual(q.req.output_config.effort, 'low');
  });
  await test('Claude: refusal / max_tokens / SDK errors map to codes', async () => {
    const code = async () => { try { await AI.call({ provider: 'claude', apiKey: 'K', system: '', prompt: '', schema, SDK: FakeAnthropic }); return 'none'; } catch (e) { return e.code; } };
    FakeAnthropic.fail = null;
    FakeAnthropic.reply = Object.assign({}, okReply, { stop_reason: 'refusal', stop_details: { category: 'cyber' } }); assert.strictEqual(await code(), 'blocked');
    FakeAnthropic.reply = Object.assign({}, okReply, { stop_reason: 'max_tokens' }); assert.strictEqual(await code(), 'truncated');
    FakeAnthropic.fail = new FakeAnthropic.AuthenticationError('bad key'); assert.strictEqual(await code(), 'auth');
    FakeAnthropic.fail = new FakeAnthropic.RateLimitError('slow down'); assert.strictEqual(await code(), 'rate');
    FakeAnthropic.fail = new FakeAnthropic.APIConnectionError('offline'); assert.strictEqual(await code(), 'network');
    FakeAnthropic.fail = new FakeAnthropic.APIUserAbortError('stop'); assert.strictEqual(await code(), 'aborted');
    FakeAnthropic.fail = null;
  });
  await test('every schema is portable (objects closed, all properties required, no numeric/string limits)', () => {
    const walk = (s, where) => {
      if (s.type === 'object') {
        assert.strictEqual(s.additionalProperties, false, where);
        eq([...s.required].sort(), Object.keys(s.properties).sort(), where);
        for (const [k, v] of Object.entries(s.properties)) walk(v, where + '.' + k);
      }
      if (s.type === 'array') walk(s.items, where + '[]');
      for (const bad of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) assert.ok(!(bad in s), where + ' has ' + bad);
    };
    walk(AI.PREP_SCHEMA, 'prep'); walk(AI.PROPOSALS_SCHEMA, 'proposals'); walk(AI.EDIT_SCHEMA, 'edit');
  });

  console.log('2) AI 演出3案');
  const summer = project({ lyrics: '花火の夜に約束した\n君の浴衣が揺れていた\n*夏休み*が終わらないように!\n花火の夜に約束した', seed: 5, extra: true });
  const plan = J.plan(summer, null);
  await test('proposalsRequest carries lyrics, catalog with seasons, no audio', () => {
    const q = AI.proposalsRequest(summer, plan, 'ja');
    assert.ok(q.prompt.includes('0: 花火の夜に約束した'));
    assert.ok(q.prompt.includes('snow=') && q.prompt.includes('{winter}'));
    assert.ok(q.prompt.includes('sakura=') && q.prompt.includes('{spring}'));
    console.log('       prompt size:', q.system.length + q.prompt.length, 'chars');
  });
  const answer = { theme: '夏祭り', season: 'summer', proposals: [
    { title: '夜空', concept: '花火', style: 'sakura', mood: 'emotional', fx: { motion: 0.6, glitch: 0.1, chroma: 0.4, decor: 0.7, density: 0.5, texture: 0.5, bgSwitch: 0.3 }, flash: true,
      palette: { accent: '#FFB000', ghostA: '#00C2B8', ghostB: '#FF3D6E' }, avoid: ['decor.snow', 'fx.slice', 'layout.nope'], lines: [{ i: 2, layout: 'huge', enter: 'zoom', exit: 'explode' }, { i: 1, layout: 'center', enter: 'heatHaze', exit: 'hazeOut' }, { i: 9, layout: 'huge', enter: 'zoom', exit: 'cut' }] },
    { title: 'B', concept: '', style: 'ocean', mood: 'calm', fx: { motion: 2, glitch: -1, chroma: 0.3, decor: 0.5, density: 0.4, texture: 0.6, bgSwitch: 0.2 }, flash: false, palette: { accent: '', ghostA: '', ghostB: '' }, avoid: [], lines: [{ i: 0, layout: 'vcols', enter: 'snowFall?', exit: 'blur' }] },
    { title: 'C', concept: '', style: 'noir', mood: 'pop', fx: { motion: 0.8, glitch: 0.3, chroma: 0.5, decor: 0.8, density: 0.7, texture: 0.4, bgSwitch: 0.5 }, flash: true, palette: { accent: '#000000', ghostA: '#FF2A2A', ghostB: '#2AA8FF' }, avoid: [], lines: [] },
  ] };
  const pc = AI.proposalChanges(summer, plan, answer);
  await test('proposalChanges: three proposals, season set, off-season and unknown picks dropped', () => {
    assert.strictEqual(pc.proposals.length, 3);
    const a = pc.proposals[0].changes;
    assert.ok(a.some(c => c.kind === 'season' && c.to === 'summer'));
    assert.ok(!a.some(c => c.kind === 'style'), 'sakura (spring) must be dropped for a summer song');
    assert.ok(a.find(c => c.kind === 'avoid').parts.includes('decor.snow'));
    assert.ok(!a.find(c => c.kind === 'avoid').parts.includes('layout.nope'));
    assert.ok(a.some(c => c.kind === 'line' && c.i === 2 && c.field === 'layout' && c.to === 'huge'));
    assert.ok(a.some(c => c.kind === 'line' && c.i === 1 && c.field === 'enter' && c.to === 'heatHaze'), 'summer motif allowed in a summer song');
    assert.ok(!a.some(c => c.kind === 'line' && c.i === 9), 'line out of range dropped');
    assert.ok(pc.proposals[1].changes.find(c => c.kind === 'fx' && c.key === 'motion').to === 1, 'fx clamped to 0..1');
    assert.ok(!pc.proposals[1].changes.some(c => c.kind === 'fx' && c.key === 'glitch'), '-1 keeps the value');
    assert.ok(!pc.proposals[1].changes.some(c => c.kind === 'palette'), 'empty palette keeps colors');
  });
  await test('palette accent is made readable on the style background', () => {
    const pal = pc.proposals[2].changes.find(c => c.kind === 'palette').to;
    assert.ok(J.contrast(pal.accent, J.STYLES.noir.schemes[0].bg) >= 3);
  });
  await test('applying a proposal: no off-season motif in 20 seeds, lyrics untouched', () => {
    const P2 = AI.applyChanges(summer, pc.proposals[0].changes);
    assert.strictEqual(P2.season, 'summer');
    assert.strictEqual(P2.lyrics, summer.lyrics);
    assert.strictEqual(P2.enabled.decor.snow, false);
    assert.strictEqual(P2.overrides[2].layout, 'huge');
    for (let s = 0; s < 20; s++) eq(J.offSeasonMotifs(J.plan(Object.assign({}, P2, { seed: s }), null), 'summer'), []);
    assert.strictEqual(summer.season, undefined, 'the input project is not modified');
  });

  console.log('3) ひとこと修正');
  const edit = { understood: true, summary: 'サビを派手に', question: '', changes: {
    style: '', mood: '', season: '', fx: { motion: 0.95, glitch: -1, chroma: -1, decor: -1, density: -1, texture: -1, bgSwitch: -1 }, flash: 'on',
    palette: { accent: '', ghostA: '', ghostB: '' }, avoid: [], allow: [],
    lines: [{ i: 0, layout: 'huge', enter: 'zoom', exit: '', hold: '', impact: 'on', emphasis: ['花火'] }, { i: 2, layout: '', enter: '', exit: '', hold: '', impact: 'on', emphasis: ['夏休み'] }] } };
  const ec = AI.editChanges(summer, plan, edit);
  await test('editChanges: only real changes (already-impact and already-emphasized lines skipped)', () => {
    const kinds = ec.changes.map(c => c.kind + (c.i != null ? c.i : '') + (c.key || c.field || ''));
    eq(kinds.sort(), ['emphasis0', 'fxmotion', 'impact0', 'line0enter', 'line0layout'].sort());
  });
  await test('applying the edit changes words nowhere, only the lyric syntax', () => {
    const P2 = AI.applyChanges(summer, ec.changes);
    assert.strictEqual(P2.lyrics.split('\n')[0], '*花火*の夜に約束した!');
    eq(J.parseLyrics(P2.lyrics).lines.map(l => l.text), J.parseLyrics(summer.lyrics).lines.map(l => l.text));
    assert.strictEqual(P2.fx.motion, 0.95); assert.strictEqual(P2.mood, null);
  });
  await test('understood=false -> no changes', () => {
    const r = AI.editChanges(summer, plan, Object.assign({}, edit, { understood: false, question: 'どの行？' }));
    assert.strictEqual(r.changes.length, 0); assert.strictEqual(r.question, 'どの行？');
  });
  await test('mood change applies the mood technique focus deterministically', () => {
    const ch = [{ kind: 'mood', from: null, to: 'calm' }];
    const a = AI.applyChanges(summer, ch), b = AI.applyChanges(summer, ch);
    eq(a.enabled, b.enabled);
    assert.strictEqual(a.mood, 'calm');
    assert.ok(Object.values(a.enabled.layout).some(v => v === false));
  });

  console.log('API key check');
  await test('Gemini key check reads the model info (no tokens), key in the header only', async () => {
    const seen = [];
    const r = await AI.checkKey({ provider: 'gemini', apiKey: 'AIzaSECRET', fetchImpl: fakeFetch(200, { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] }, seen) });
    eq(r, { model: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' });
    assert.strictEqual(seen[0].init.method, 'GET');
    assert.strictEqual(seen[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash');
    assert.strictEqual(seen[0].init.headers['x-goog-api-key'], 'AIzaSECRET');
  });
  await test('Gemini key check: bad key -> auth, unknown model -> model', async () => {
    const code = async f => { try { await AI.checkKey({ provider: 'gemini', apiKey: 'k', fetchImpl: f }); return 'none'; } catch (e) { return e.code; } };
    assert.strictEqual(await code(fakeFetch(400, { error: { details: [{ reason: 'API_KEY_INVALID' }] } })), 'auth');
    assert.strictEqual(await code(fakeFetch(404, { error: { message: 'not found' } })), 'model');
    assert.strictEqual(await code(fakeFetch(200, { supportedGenerationMethods: ['embedContent'] })), 'model');
    await assert.rejects(AI.checkKey({ provider: 'gemini', apiKey: '' }), e => e.code === 'no_key');
  });
  await test('second service key check uses models.retrieve through the SDK', async () => {
    FakeAnthropic.fail = null;
    const r = await AI.checkKey({ provider: 'claude', model: 'claude-sonnet-5', apiKey: 'K', SDK: FakeAnthropic });
    assert.strictEqual(r.model, 'claude-sonnet-5');
    eq(FakeAnthropic.last.calls.map(c => c.kind), ['models']);
    FakeAnthropic.fail = new FakeAnthropic.AuthenticationError('bad');
    await assert.rejects(AI.checkKey({ provider: 'claude', apiKey: 'K', SDK: FakeAnthropic }), e => e.code === 'auth');
    FakeAnthropic.fail = null;
  });
  await test('key shape hint', () => {
    assert.ok(AI.keyLooksRight('gemini', 'AIza' + 'x'.repeat(35)));
    assert.ok(!AI.keyLooksRight('gemini', 'sk-ant-abc'));
    assert.ok(AI.keyLooksRight('claude', 'sk-ant-api03-' + 'x'.repeat(30)));
  });

  console.log('review fixes');
  await test('checked rendering refuses changes the lyric syntax cannot hold', () => {
    const r = AI.rawLines('Yeah!!')[0];
    eq([r.text, r.impact], ['Yeah!', true]);
    assert.strictEqual(AI.renderChecked(r, { impact: false }).ok, false, 'taking "!" off "Yeah!!" would change the words');
    const t = AI.rawLines('[00:10.00] [00:20.00]text')[0];
    assert.strictEqual(AI.renderChecked(t, { emph: ['text'] }).ok, false, 'a spaced second tag would become a timestamp');
    const c = AI.rawLines('君と 歌う夜')[0];
    assert.strictEqual(AI.renderChecked(c, { manual: ['君と', '歌う夜'] }).ok, false, 'a cut that drops a space');
    const ok = AI.rawLines('夜明けの色を覚えてる')[0];
    assert.strictEqual(AI.renderChecked(ok, { manual: ['夜明けの色を', '覚えてる'], emph: ['夜明け'] }).ok, true);
  });
  await test('prep drops cuts and readings that would alter the words or break lines', () => {
    const P = project({ lyrics: '愛してるbaby tonight\n君と 歌う夜\n本気で好き' });
    const { changes, warnings } = AI.prepChanges(P, { lines: [
      { i: 0, remove: false, reason: '', segments: ['愛してる', 'baby tonight'], emphasis: [], reading: '' },
      { i: 1, remove: false, reason: '', segments: ['君と', '歌う夜'], emphasis: [], reading: '' },
      { i: 2, remove: false, reason: '', segments: ['本気', 'で\n好き'], emphasis: ['本*気'], reading: 'まじ\nで' },
    ] });
    eq(changes, []);
    assert.strictEqual(warnings.length, 4);
  });
  await test('applyPrep skips a line that changed after the answer', () => {
    const P = project({ lyrics: 'A\nB\nC' });
    const { changes } = AI.prepChanges(P, { lines: [{ i: 1, remove: true, reason: '', segments: [], emphasis: [], reading: '' }] });
    const moved = project({ lyrics: 'X\nA\nB\nC' });
    const r = AI.applyPrep(moved, changes);
    assert.strictEqual(r.lyrics, 'X\nA\nB\nC'); eq(r.skipped, [1]);
  });
  await test('avoid / allow with an unknown group is dropped, not thrown', () => {
    const P = project({ lyrics: 'A\nB' });
    const plan = J.plan(P, null);
    const r = AI.editChanges(P, plan, { understood: true, summary: '', question: '', changes: { style: '', mood: '', season: '', fx: { motion: -1, glitch: -1, chroma: -1, decor: -1, density: -1, texture: -1, bgSwitch: -1 },
      flash: 'keep', palette: { accent: '', ghostA: '', ghostB: '' }, avoid: ['style.neon', 'mood.glitch', 'effect.x', 'decor.snow'], allow: ['constructor.x'], lines: [] } });
    eq(r.changes.map(c => c.kind), ['avoid']); eq(r.changes[0].parts, ['decor.snow']);
  });
  await test('emphasis inside an existing emphasis is skipped; repeats are counted', () => {
    const P = project({ lyrics: '[00:01.00][00:09.00]*君の*声\n夜' });
    const plan = J.plan(P, null);
    const r = AI.editChanges(P, plan, { understood: true, summary: '', question: '', changes: { style: '', mood: '', season: '', fx: { motion: -1, glitch: -1, chroma: -1, decor: -1, density: -1, texture: -1, bgSwitch: -1 },
      flash: 'keep', palette: { accent: '', ghostA: '', ghostB: '' }, avoid: [], allow: [], lines: [{ i: 0, layout: '', enter: '', exit: '', hold: '', impact: 'on', emphasis: ['君'] }] } });
    eq(r.changes.map(c => [c.kind, c.repeats]), [['impact', 2]]);
  });

  console.log(`\n${n - failed}/${n} passed`);
  process.exit(failed ? 1 : 0);
})();
