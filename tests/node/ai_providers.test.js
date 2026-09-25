/* 文字PVメーカー v2 — original work. Tests for ai/providers: Gemini REST and the SDK service, both faked (DESIGN §4.22.1, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { deepEqual } = require('../helpers/assert_plus.js');

const MV = load();
const PR = MV.use('ai/providers');

const SCHEMA = { type: 'object', additionalProperties: false, required: ['a'], properties: { a: { type: 'string' } } };

// A fetch that answers with `status` and `body`, recording every request in `seen`. Nothing touches the network.
function fakeFetch(status, body, seen) {
  return async (url, init) => {
    if (seen) seen.push({ url, init });
    return { ok: status < 400, status, json: async () => body };
  };
}

function okAnswer(text, usage) {
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }], usageMetadata: usage || {} };
}

async function codeOf(promise) {
  try { await promise; return 'none'; } catch (e) { return e.code; }
}

// A stand-in for window.AnthropicSDK: records constructor options and calls, replies with FakeSDK.reply or throws FakeSDK.fail.
function makeFakeSDK() {
  class FakeSDK {
    constructor(o) {
      this.o = o;
      this.calls = [];
      FakeSDK.last = this;
      const self = this;
      const create = (kind) => async (req, opt) => {
        self.calls.push({ kind, req, opt });
        if (FakeSDK.fail) throw FakeSDK.fail;
        return FakeSDK.reply;
      };
      this.messages = { create: create('messages') };
      this.beta = { messages: { create: create('beta') } };
      this.models = {
        retrieve: async (id, params, opt) => {
          self.calls.push({ kind: 'models', id, opt });
          if (FakeSDK.fail) throw FakeSDK.fail;
          return { id, display_name: 'Model ' + id };
        },
      };
    }
  }
  for (const n of ['APIUserAbortError', 'AuthenticationError', 'PermissionDeniedError', 'RateLimitError', 'NotFoundError',
    'BadRequestError', 'InternalServerError', 'APIConnectionError']) {
    FakeSDK[n] = class extends Error {};
  }
  FakeSDK.reply = {
    stop_reason: 'end_turn', model: 'claude-opus-5',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":"y"}' }],
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3 },
  };
  FakeSDK.fail = null;
  return FakeSDK;
}

test('Gemini: request shape, key only in the header, thought parts ignored, usage counted', async () => {
  const seen = [];
  const r = await PR.call({
    provider: 'gemini', apiKey: 'SECRET', system: 'sys', prompt: 'hi', schema: SCHEMA, effort: 'medium',
    fetchImpl: fakeFetch(200, {
      candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'thinking…' }, { text: '{"a":"x"}' }] } }],
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, thoughtsTokenCount: 30 },
    }, seen),
  });
  deepEqual(r.json, { a: 'x' });
  deepEqual(r.usage, { input: 100, output: 50 });
  assert.equal(r.model, 'gemini-3.8-flash');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
  assert.ok(!seen[0].url.includes('SECRET'));
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers['x-goog-api-key'], 'SECRET');
  assert.ok(!seen[0].init.body.includes('SECRET'), 'the key is not in the body');
  const body = JSON.parse(seen[0].init.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  deepEqual(body.generationConfig.responseJsonSchema, SCHEMA);
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'MEDIUM');
  assert.equal(body.generationConfig.maxOutputTokens, 16384);
  assert.equal(body.systemInstruction.parts[0].text, 'sys');
  deepEqual(body.contents, [{ role: 'user', parts: [{ text: 'hi' }] }]);
});

test('Gemini: effort maps to LOW / MEDIUM / HIGH, never MINIMAL', async () => {
  const levels = {};
  for (const effort of ['low', 'medium', 'high', 'minimal', undefined, 'max']) {
    const seen = [];
    await PR.call({ apiKey: 'k', system: '', prompt: '', schema: SCHEMA, effort, fetchImpl: fakeFetch(200, okAnswer('{"a":"1"}'), seen) });
    levels[String(effort)] = JSON.parse(seen[0].init.body).generationConfig.thinkingConfig.thinkingLevel;
  }
  deepEqual(levels, { low: 'LOW', medium: 'MEDIUM', high: 'HIGH', minimal: 'LOW', undefined: 'LOW', max: 'LOW' });
  assert.ok(!Object.values(PR.THINKING_LEVELS).includes('MINIMAL'));
});

test('Gemini: HTTP statuses, finish reasons and answers map to error codes', async () => {
  const code = (f) => codeOf(PR.call({ provider: 'gemini', apiKey: 'k', system: '', prompt: '', schema: SCHEMA, fetchImpl: f }));
  const answer = (finishReason, text) => ({ candidates: [{ finishReason, content: { parts: [{ text: text || '{}' }] } }] });
  assert.equal(await code(fakeFetch(400, { error: { code: 400, message: 'API key not valid', details: [{ reason: 'API_KEY_INVALID' }] } })), 'auth');
  assert.equal(await code(fakeFetch(401, {})), 'auth');
  assert.equal(await code(fakeFetch(403, { error: { message: 'denied' } })), 'auth');
  assert.equal(await code(fakeFetch(429, { error: { message: 'quota' } })), 'rate');
  assert.equal(await code(fakeFetch(404, { error: { message: 'no model' } })), 'model');
  assert.equal(await code(fakeFetch(503, {})), 'server');
  assert.equal(await code(fakeFetch(400, { error: { message: 'bad' } })), 'bad_request');
  assert.equal(await code(async () => { throw new TypeError('Failed to fetch'); }), 'network');
  assert.equal(await code(async () => { const e = new Error('x'); e.name = 'AbortError'; throw e; }), 'aborted');
  assert.equal(await code(async () => undefined), 'network');
  assert.equal(await code(fakeFetch(200, { promptFeedback: { blockReason: 'SAFETY' } })), 'blocked');
  for (const reason of ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']) assert.equal(await code(fakeFetch(200, answer(reason))), 'blocked', reason);
  assert.equal(await code(fakeFetch(200, answer('MAX_TOKENS', '{"a"'))), 'truncated');
  assert.equal(await code(fakeFetch(200, answer('STOP', 'not json'))), 'bad_json');
  assert.equal(await code(fakeFetch(200, { candidates: [] })), 'empty');
  assert.equal(await code(fakeFetch(200, { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'x' }] } }] })), 'empty');
  assert.equal(await code(fakeFetch(200, null)), 'empty');
});

test('Gemini: RECITATION has its own code, whose message points to alignment', async () => {
  let err = null;
  try {
    await PR.call({ apiKey: 'k', system: '', prompt: '', schema: SCHEMA,
      fetchImpl: fakeFetch(200, { candidates: [{ finishReason: 'RECITATION', content: { parts: [] } }] }) });
  } catch (e) { err = e; }
  assert.ok(err instanceof PR.AIError);
  assert.equal(err.code, 'recitation');
  assert.match(err.message, /align/);
  assert.ok(PR.ERROR_CODES.includes('recitation'));
});

test('stray text around the JSON answer is tolerated', async () => {
  const r = await PR.call({ apiKey: 'k', system: '', prompt: '', schema: SCHEMA, fetchImpl: fakeFetch(200, okAnswer('Here: {"a":"z"} done')) });
  deepEqual(r.json, { a: 'z' });
  assert.throws(() => PR.parseJSON('nothing'), (e) => e.code === 'bad_json');
});

test('the key never appears in an error message', async () => {
  const key = 'AIzaVERYSECRETKEY1234567890123456789';
  const echo = fakeFetch(400, { error: { message: 'bad key ' + key } });
  let err = null;
  try { await PR.call({ apiKey: key, system: '', prompt: '', schema: SCHEMA, fetchImpl: echo }); } catch (e) { err = e; }
  assert.equal(err.code, 'bad_request');
  assert.ok(!err.message.includes(key));
  const thrower = async () => { throw new TypeError('connect failed for ' + key); };
  try { await PR.call({ apiKey: key, system: '', prompt: '', schema: SCHEMA, fetchImpl: thrower }); } catch (e) { err = e; }
  assert.equal(err.code, 'network');
  assert.ok(!err.message.includes(key));
});

test('no key → no_key and nothing is sent; unknown provider → bad_provider', async () => {
  let sent = false;
  const f = async () => { sent = true; return { ok: true, status: 200, json: async () => okAnswer('{}') }; };
  assert.equal(await codeOf(PR.call({ provider: 'gemini', apiKey: '', fetchImpl: f })), 'no_key');
  assert.equal(await codeOf(PR.checkKey({ provider: 'gemini', apiKey: '', fetchImpl: f })), 'no_key');
  assert.equal(sent, false);
  assert.equal(await codeOf(PR.call({ provider: 'other', apiKey: 'k', fetchImpl: f })), 'bad_provider');
  assert.equal(await codeOf(PR.checkKey({ provider: 'other', apiKey: 'k', fetchImpl: f })), 'bad_provider');
});

test('an injected fetch is used when a call brings none', async () => {
  const seen = [];
  PR.setFetch(fakeFetch(200, okAnswer('{"a":"i"}'), seen));
  try {
    const r = await PR.call({ apiKey: 'k', system: '', prompt: '', schema: SCHEMA });
    deepEqual(r.json, { a: 'i' });
    assert.equal(seen.length, 1);
  } finally {
    PR.setFetch(null);
  }
});

test('SDK service, claude-opus-5: browser mode, structured output, adaptive thinking, server-side fallback beta', async () => {
  const SDK = makeFakeSDK();
  const r = await PR.call({ provider: 'claude', model: 'claude-opus-5', apiKey: 'K', system: 's', prompt: 'p', schema: SCHEMA, effort: 'medium', SDK });
  deepEqual(r.json, { a: 'y' });
  deepEqual(r.usage, { input: 13, output: 5 });
  const c = SDK.last;
  assert.equal(c.o.dangerouslyAllowBrowser, true);
  assert.equal(c.o.apiKey, 'K');
  assert.equal(c.o.maxRetries, 2);
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].kind, 'beta');
  const q = c.calls[0].req;
  assert.equal(q.model, 'claude-opus-5');
  deepEqual(q.output_config, { format: { type: 'json_schema', schema: SCHEMA }, effort: 'medium' });
  deepEqual(q.thinking, { type: 'adaptive' });
  deepEqual(q.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(q.fallbacks, 'default');
  assert.equal(q.max_tokens, 16000);
  assert.equal(q.system, 's');
  deepEqual(q.messages, [{ role: 'user', content: 'p' }]);
});

test('SDK service: haiku-4-5 without thinking / effort; sonnet-5 through messages.create; default model is opus-5', async () => {
  const SDK = makeFakeSDK();
  await PR.call({ provider: 'claude', model: 'claude-haiku-4-5', apiKey: 'K', system: 's', prompt: 'p', schema: SCHEMA, effort: 'high', SDK });
  let q = SDK.last.calls[0];
  assert.equal(q.kind, 'messages');
  assert.equal(q.req.thinking, undefined);
  assert.equal(q.req.output_config.effort, undefined);
  assert.equal(q.req.betas, undefined);
  await PR.call({ provider: 'claude', model: 'claude-sonnet-5', apiKey: 'K', system: 's', prompt: 'p', schema: SCHEMA, effort: 'low', SDK });
  q = SDK.last.calls[0];
  assert.equal(q.kind, 'messages');
  assert.equal(q.req.output_config.effort, 'low');
  deepEqual(q.req.thinking, { type: 'adaptive' });
  await PR.call({ provider: 'claude', apiKey: 'K', system: 's', prompt: 'p', schema: SCHEMA, SDK });
  assert.equal(SDK.last.calls[0].kind, 'beta');
  assert.equal(SDK.last.calls[0].req.model, 'claude-opus-5');
  assert.equal(SDK.last.calls[0].req.output_config.effort, 'medium');
});

test('SDK service: refusal, max_tokens and SDK errors map to codes', async () => {
  const SDK = makeFakeSDK();
  const ok = SDK.reply;
  const code = () => codeOf(PR.call({ provider: 'claude', apiKey: 'K', system: '', prompt: '', schema: SCHEMA, SDK }));
  SDK.reply = Object.assign({}, ok, { stop_reason: 'refusal', stop_details: { category: 'cyber' } });
  let err = null;
  try { await PR.call({ provider: 'claude', apiKey: 'K', system: '', prompt: '', schema: SCHEMA, SDK }); } catch (e) { err = e; }
  assert.equal(err.code, 'blocked');
  assert.equal(err.category, 'cyber');
  SDK.reply = Object.assign({}, ok, { stop_reason: 'max_tokens' });
  assert.equal(await code(), 'truncated');
  SDK.reply = Object.assign({}, ok, { content: [{ type: 'text', text: 'no json' }] });
  assert.equal(await code(), 'bad_json');
  SDK.reply = ok;
  const cases = [['AuthenticationError', 'auth'], ['PermissionDeniedError', 'auth'], ['RateLimitError', 'rate'],
    ['NotFoundError', 'model'], ['BadRequestError', 'bad_request'], ['InternalServerError', 'server'],
    ['APIConnectionError', 'network'], ['APIUserAbortError', 'aborted']];
  for (const [cls, want] of cases) {
    SDK.fail = new SDK[cls]('x');
    assert.equal(await code(), want, cls);
  }
  SDK.fail = Object.assign(new Error('slow down'), { status: 429 });
  assert.equal(await code(), 'rate', 'an unknown error class maps by status');
  SDK.fail = new Error('odd');
  assert.equal(await code(), 'server');
  SDK.fail = null;
});

test('SDK service: no SDK → no_sdk; setSDK injects it; audio is refused before anything is sent', async () => {
  assert.equal(await codeOf(PR.call({ provider: 'claude', apiKey: 'K', system: '', prompt: '', schema: SCHEMA })), 'no_sdk');
  const SDK = makeFakeSDK();
  PR.setSDK(SDK);
  try {
    const r = await PR.call({ provider: 'claude', apiKey: 'K', system: '', prompt: '', schema: SCHEMA });
    deepEqual(r.json, { a: 'y' });
    SDK.last = null;
    assert.equal(await codeOf(PR.call({ provider: 'claude', apiKey: 'K', system: '', prompt: '', schema: SCHEMA, media: [{ inlineData: {} }] })), 'no_audio');
    assert.equal(SDK.last, null, 'no client was made');
  } finally {
    PR.setSDK(null);
  }
});

test('Gemini key check reads the model info (free), key in the header only', async () => {
  const seen = [];
  const r = await PR.checkKey({ provider: 'gemini', apiKey: 'AIzaSECRET', fetchImpl: fakeFetch(200,
    { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] }, seen) });
  deepEqual(r, { model: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash' });
  assert.equal(seen[0].init.method, 'GET');
  assert.equal(seen[0].init.body, undefined);
  assert.equal(seen[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash');
  assert.equal(seen[0].init.headers['x-goog-api-key'], 'AIzaSECRET');
});

test('Gemini key check: bad key → auth, unknown model → model, no generateContent → model', async () => {
  const code = (f) => codeOf(PR.checkKey({ provider: 'gemini', apiKey: 'k', fetchImpl: f }));
  assert.equal(await code(fakeFetch(400, { error: { details: [{ reason: 'API_KEY_INVALID' }] } })), 'auth');
  assert.equal(await code(fakeFetch(404, { error: { message: 'not found' } })), 'model');
  assert.equal(await code(fakeFetch(200, { supportedGenerationMethods: ['embedContent'] })), 'model');
  assert.equal(await code(async () => { throw new TypeError('offline'); }), 'network');
});

test('SDK key check uses models.retrieve (free) and maps errors', async () => {
  const SDK = makeFakeSDK();
  const r = await PR.checkKey({ provider: 'claude', model: 'claude-sonnet-5', apiKey: 'K', SDK });
  deepEqual(r, { model: 'claude-sonnet-5', name: 'Model claude-sonnet-5' });
  deepEqual(SDK.last.calls.map((c) => c.kind), ['models']);
  assert.equal(SDK.last.o.maxRetries, 0);
  SDK.fail = new SDK.AuthenticationError('bad');
  assert.equal(await codeOf(PR.checkKey({ provider: 'claude', apiKey: 'K', SDK })), 'auth');
  SDK.fail = new SDK.NotFoundError('no');
  assert.equal(await codeOf(PR.checkKey({ provider: 'claude', apiKey: 'K', SDK })), 'model');
  SDK.fail = null;
});

test('key shape hint', () => {
  assert.ok(PR.keyLooksRight('gemini', 'AIza' + 'x'.repeat(35)));
  assert.ok(!PR.keyLooksRight('gemini', 'sk-ant-abc'));
  assert.ok(PR.keyLooksRight('claude', 'sk-ant-api03-' + 'x'.repeat(30)));
  assert.ok(!PR.keyLooksRight('claude', 'AIza' + 'x'.repeat(35)));
  assert.ok(PR.keyLooksRight('unknown', 'anything'), 'no shape known → no warning');
});

test('providers, models and prices', () => {
  assert.equal(PR.DEFAULT_PROVIDER, 'gemini');
  assert.equal(PR.PROVIDERS.gemini.defaultModel, 'gemini-3.8-flash');
  deepEqual(PR.PROVIDERS.claude.models, ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5']);
  assert.equal(PR.costUSD('gemini', 'gemini-3.8-flash', { input: 1e6, output: 1e6 }), 4.5);
  assert.equal(PR.costUSD('claude', 'claude-haiku-4-5', { input: 2e6, output: 0 }), 2);
  assert.equal(PR.costUSD('claude', 'nope', { input: 1, output: 1 }), null);
  assert.equal(PR.costUSD('gemini', 'gemini-3.8-flash', null), null);
  for (const code of ['no_key', 'auth', 'rate', 'model', 'server', 'bad_request', 'network', 'aborted', 'blocked', 'truncated',
    'empty', 'bad_json', 'no_sdk', 'no_audio', 'upload', 'bad_provider', 'bad_edit']) {
    assert.ok(PR.ERROR_CODES.includes(code), code);
  }
});

test('every AI schema is portable (objects closed, all properties required, no numeric/string limits)', () => {
  const walk = (s, where) => {
    if (s.type === 'object') {
      assert.equal(s.additionalProperties, false, where);
      deepEqual([...s.required].sort(), Object.keys(s.properties).sort(), where);
      for (const [k, v] of Object.entries(s.properties)) walk(v, where + '.' + k);
    }
    if (s.type === 'array') walk(s.items, where + '[]');
    for (const bad of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern', 'format']) {
      assert.ok(!(bad in s), where + ' has ' + bad);
    }
  };
  const LK = MV.use('ai/looks'), SONG = MV.use('ai/song');
  walk(MV.use('ai/prep').SCHEMA, 'prep');
  walk(LK.PROPOSALS_SCHEMA, 'proposals');
  walk(LK.EDIT_SCHEMA, 'edit');
  walk(SONG.TRANSCRIBE_SCHEMA, 'transcribe');
  walk(SONG.ALIGN_SCHEMA, 'align');
  walk(SONG.ANALYZE_SCHEMA, 'analyze');
});
