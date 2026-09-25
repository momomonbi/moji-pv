/* 文字PVメーカー v2 — original work. AI providers: Gemini over REST and the second service through its SDK (DESIGN §4.22.1). */
MV.def('ai/providers', [], () => {
  'use strict';

  // price: USD per 1M tokens [input, output] (Gemini 3.8 Flash: introductory rate until 2026-12-31, then 1.50 / 7.50)
  const PROVIDERS = deepFreeze({
    gemini: {
      label: 'Google Gemini', defaultModel: 'gemini-3.8-flash', models: ['gemini-3.8-flash'], audio: true,
      keyUrl: 'https://aistudio.google.com/apikey', price: { 'gemini-3.8-flash': [0.75, 3.75] },
    },
    claude: {
      label: 'Anthropic Claude', defaultModel: 'claude-opus-5', models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
      audio: false, keyUrl: 'https://console.anthropic.com/settings/keys',
      price: { 'claude-opus-5': [5, 25], 'claude-sonnet-5': [2, 10], 'claude-haiku-4-5': [1, 5] },
    },
  });
  const DEFAULT_PROVIDER = 'gemini';
  const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const GEMINI_MAX_OUTPUT = 16384;
  const CLAUDE_MAX_TOKENS = 16000;
  // gemini-3.8-flash rejects MINIMAL, so unknown efforts fall back to LOW
  const THINKING_LEVELS = Object.freeze({ low: 'LOW', medium: 'MEDIUM', high: 'HIGH' });
  const EFFORTS = Object.freeze(['low', 'medium', 'high']);
  // if a safety classifier declines, the API re-runs the request on a fallback model inside the same call
  const OPUS_FALLBACK = Object.freeze({ model: 'claude-opus-5', betas: Object.freeze(['server-side-fallback-2026-07-01']),
    fallbacks: 'default' });
  const BLOCKED_FINISH = /SAFETY|PROHIBITED|BLOCKLIST|SPII/;
  const ERROR_CODES = Object.freeze(['no_key', 'auth', 'rate', 'model', 'server', 'bad_request', 'network', 'aborted',
    'blocked', 'recitation', 'truncated', 'empty', 'bad_json', 'no_sdk', 'no_audio', 'upload', 'bad_provider', 'bad_edit']);
  // a quick look at the key's shape before sending it anywhere (only a hint: formats can change)
  const KEY_SHAPE = Object.freeze({ gemini: /^AIza[0-9A-Za-z_-]{30,}$/, claude: /^sk-ant-[0-9A-Za-z_-]{20,}$/ });

  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  // Errors carry a code the panel turns into a message (err.ai.<code>); the API key never goes into a message.
  class AIError extends Error {
    constructor(code, message, extra) {
      super(message || code);
      this.name = 'AIError';
      this.code = code;
      if (extra) Object.assign(this, extra);
    }
  }

  // Injected services: ui/boot calls setSDK(window.AnthropicSDK); fetch can be injected the same way. A call's own
  // fetchImpl / SDK always wins.
  let injectedSDK = null;
  let injectedFetch = null;
  function setSDK(sdk) { injectedSDK = sdk || null; }
  function setFetch(fn) { injectedFetch = typeof fn === 'function' ? fn : null; }

  function fetchOf(o) {
    if (typeof o.fetchImpl === 'function') return o.fetchImpl;
    if (injectedFetch) return injectedFetch;
    const g = typeof globalThis !== 'undefined' ? globalThis : null;
    if (g && typeof g.fetch === 'function') return (url, init) => g.fetch(url, init);
    return null;
  }

  function sdkOf(o) {
    const sdk = o.SDK || injectedSDK;
    if (!sdk) throw new AIError('no_sdk', 'the AI SDK is not loaded');
    return sdk;
  }

  function costUSD(provider, model, usage) {
    const p = PROVIDERS[provider];
    const r = p && p.price[model];
    if (!r || !usage) return null;
    return ((usage.input || 0) * r[0] + (usage.output || 0) * r[1]) / 1e6;
  }

  function keyLooksRight(provider, key) {
    const re = KEY_SHAPE[provider];
    return !re || re.test(String(key || ''));
  }

  // Removes the key from any text that could end up in a message.
  function scrub(text, apiKey) {
    const s = String(text || '');
    return apiKey && s.includes(apiKey) ? s.split(apiKey).join('***') : s;
  }

  function isAbort(e) { return !!e && e.name === 'AbortError'; }

  // ---- JSON answers ------------------------------------------------------------------------------------------------

  // Tolerates stray text around the object (some answers wrap the JSON).
  function parseJSON(text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      const m = String(text || '').match(/\{[\s\S]*\}/);
      if (m) {
        try { return JSON.parse(m[0]); } catch (e2) { /* falls through */ }
      }
      throw new AIError('bad_json', 'the answer is not JSON');
    }
  }

  // ---- Gemini (REST) -----------------------------------------------------------------------------------------------

  async function sendFetch(doFetch, url, init, apiKey) {
    if (!doFetch) throw new AIError('network', 'fetch is not available');
    let r;
    try {
      r = await doFetch(url, init);
    } catch (e) {
      throw new AIError(isAbort(e) ? 'aborted' : 'network', scrub(e && e.message, apiKey));
    }
    if (!r || typeof r.json !== 'function') throw new AIError('network', 'no response');
    return r;
  }

  async function readJSON(r) {
    try { return await r.json(); } catch (e) { return null; }
  }

  // HTTP status → code: invalid key reason or 401/403 → auth, 429 → rate, 404 → model,
  // ≥ 500 → server, anything else → bad_request.
  function geminiError(r, j, apiKey) {
    const details = (j && j.error && Array.isArray(j.error.details)) ? j.error.details : [];
    const reasons = details.map((d) => d && d.reason).filter(Boolean);
    const msg = scrub(j && j.error && j.error.message, apiKey);
    const extra = { status: r.status };
    if (reasons.includes('API_KEY_INVALID') || r.status === 401 || r.status === 403) return new AIError('auth', msg, extra);
    if (r.status === 429) return new AIError('rate', msg, extra);
    if (r.status === 404) return new AIError('model', msg, extra);
    if (r.status >= 500) return new AIError('server', msg, extra);
    return new AIError('bad_request', msg, extra);
  }

  function geminiBody({ system, prompt, schema, effort, media }) {
    return {
      systemInstruction: { parts: [{ text: String(system || '') }] },
      contents: [{ role: 'user', parts: (media || []).concat([{ text: String(prompt || '') }]) }],
      generationConfig: {
        responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: GEMINI_MAX_OUTPUT,
        thinkingConfig: { thinkingLevel: THINKING_LEVELS[effort] || THINKING_LEVELS.low },
      },
    };
  }

  // The first candidate's text, or an AIError for every way the answer can fail.
  function geminiText(j) {
    if (j && j.promptFeedback && j.promptFeedback.blockReason) throw new AIError('blocked', j.promptFeedback.blockReason);
    const cand = j && Array.isArray(j.candidates) ? j.candidates[0] : null;
    if (!cand) throw new AIError('empty', 'no candidate');
    const reason = cand.finishReason || '';
    // the song's lyrics look like a published text: transcription is refused, alignment of pasted lyrics works
    if (reason === 'RECITATION') throw new AIError('recitation', 'the answer was stopped as a recitation; paste the lyrics and use alignment');
    if (BLOCKED_FINISH.test(reason)) throw new AIError('blocked', reason);
    if (reason === 'MAX_TOKENS') throw new AIError('truncated', 'the answer hit the output limit');
    const parts = (cand.content && Array.isArray(cand.content.parts)) ? cand.content.parts : [];
    const texts = parts.filter((p) => p && !p.thought && typeof p.text === 'string').map((p) => p.text);
    if (!texts.length) throw new AIError('empty', 'no text in the answer');
    return texts.join('');
  }

  async function callGemini(o) {
    const model = o.model || PROVIDERS.gemini.defaultModel;
    // the key goes in a header, not the URL, so it never shows up in logs or history
    const r = await sendFetch(fetchOf(o), GEMINI_BASE + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': o.apiKey },
      body: JSON.stringify(geminiBody(o)), signal: o.signal,
    }, o.apiKey);
    const j = await readJSON(r);
    if (!r.ok) throw geminiError(r, j, o.apiKey);
    const text = geminiText(j);
    const u = (j && j.usageMetadata) || {};
    return {
      json: parseJSON(text), model,
      usage: { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) },
    };
  }

  // ---- the second service (SDK) --------------------------------------------------------------------------------------

  function apiMessage(e) {
    return (e && e.error && e.error.error && e.error.error.message) || (e && e.message) || '';
  }

  function isA(A, name, e) { return typeof A[name] === 'function' && e instanceof A[name]; }

  // SDK error classes → codes, then the HTTP status for errors of other classes.
  function sdkError(A, e, apiKey) {
    const status = e && typeof e.status === 'number' ? e.status : undefined;
    const msg = scrub(apiMessage(e), apiKey);
    const extra = { status };
    if (isA(A, 'APIUserAbortError', e) || isAbort(e)) return new AIError('aborted');
    if (isA(A, 'AuthenticationError', e) || isA(A, 'PermissionDeniedError', e)) return new AIError('auth', msg, extra);
    if (isA(A, 'RateLimitError', e)) return new AIError('rate', msg, extra);
    if (isA(A, 'NotFoundError', e)) return new AIError('model', msg, extra);
    if (isA(A, 'BadRequestError', e)) return new AIError('bad_request', msg, extra);
    if (isA(A, 'InternalServerError', e)) return new AIError('server', msg, extra);
    if (isA(A, 'APIConnectionError', e)) return new AIError('network', msg);
    if (status === 401 || status === 403) return new AIError('auth', msg, extra);
    if (status === 429) return new AIError('rate', msg, extra);
    if (status === 404) return new AIError('model', msg, extra);
    if (status === 400) return new AIError('bad_request', msg, extra);
    return new AIError('server', msg, extra);
  }

  function claudeRequest({ model, system, prompt, schema, effort }) {
    const req = {
      model, max_tokens: CLAUDE_MAX_TOKENS, system: String(system || ''),
      messages: [{ role: 'user', content: String(prompt || '') }],
      output_config: { format: { type: 'json_schema', schema } },
    };
    if (!/haiku/.test(model)) {                       // Haiku 4.5 takes neither adaptive thinking nor effort
      req.thinking = { type: 'adaptive' };
      req.output_config.effort = EFFORTS.includes(effort) ? effort : 'medium';
    }
    return req;
  }

  async function callClaude(o) {
    const A = sdkOf(o);
    const model = o.model || PROVIDERS.claude.defaultModel;
    const client = new A({ apiKey: o.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    const req = claudeRequest(Object.assign({}, o, { model, effort: o.effort || 'medium' }));
    let res;
    try {
      if (model === OPUS_FALLBACK.model) {
        const beta = Object.assign(req, { betas: OPUS_FALLBACK.betas.slice(), fallbacks: OPUS_FALLBACK.fallbacks });
        res = await client.beta.messages.create(beta, { signal: o.signal });
      } else {
        res = await client.messages.create(req, { signal: o.signal });
      }
    } catch (e) {
      throw sdkError(A, e, o.apiKey);
    }
    if (!res) throw new AIError('empty', 'no response');
    if (res.stop_reason === 'refusal') {
      const category = res.stop_details ? res.stop_details.category || null : null;
      throw new AIError('blocked', 'refusal', { category });
    }
    if (res.stop_reason === 'max_tokens') throw new AIError('truncated', 'the answer hit the output limit');
    const text = (Array.isArray(res.content) ? res.content : []).filter((b) => b && b.type === 'text').map((b) => b.text).join('');
    if (!text) throw new AIError('empty', 'no text in the answer');
    const u = res.usage || {};
    return {
      json: parseJSON(text), model: res.model || model,
      usage: {
        input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        output: u.output_tokens || 0,
      },
    };
  }

  // ---- public calls ------------------------------------------------------------------------------------------------

  // One structured request. effort: 'low' | 'medium' | 'high'. media: request parts (the song's audio; Gemini only).
  // → { json, usage: { input, output }, model }
  async function call(o) {
    const opts = o || {};
    if (!opts.apiKey) throw new AIError('no_key', 'no API key');
    const provider = opts.provider || DEFAULT_PROVIDER;
    if (provider === 'gemini') return callGemini(opts);
    if (provider === 'claude') {
      if (opts.media && opts.media.length) throw new AIError('no_audio', 'this service does not take audio');
      return callClaude(opts);
    }
    throw new AIError('bad_provider', 'unknown provider');
  }

  // Does the key work for this model? Reads the model's info, which costs nothing (no tokens are used).
  // → { model, name }, or an AIError ('auth' = bad key, 'model' = the key works but this model is not available).
  async function checkKey(o) {
    const opts = o || {};
    if (!opts.apiKey) throw new AIError('no_key', 'no API key');
    const provider = opts.provider || DEFAULT_PROVIDER;
    if (!PROVIDERS[provider]) throw new AIError('bad_provider', 'unknown provider');
    const model = opts.model || PROVIDERS[provider].defaultModel;
    if (provider === 'gemini') return checkGemini(opts, model);
    return checkClaude(opts, model);
  }

  async function checkGemini(o, model) {
    const r = await sendFetch(fetchOf(o), GEMINI_BASE + encodeURIComponent(model), {
      method: 'GET', headers: { 'x-goog-api-key': o.apiKey }, signal: o.signal,
    }, o.apiKey);
    const j = await readJSON(r);
    if (!r.ok) throw geminiError(r, j, o.apiKey);
    const methods = j && Array.isArray(j.supportedGenerationMethods) ? j.supportedGenerationMethods : null;
    if (methods && !methods.includes('generateContent')) throw new AIError('model', 'generateContent is not supported');
    return { model, name: (j && j.displayName) || model };
  }

  async function checkClaude(o, model) {
    const A = sdkOf(o);
    const client = new A({ apiKey: o.apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
    try {
      const m = await client.models.retrieve(model, {}, { signal: o.signal });
      return { model, name: (m && m.display_name) || model };
    } catch (e) {
      throw sdkError(A, e, o.apiKey);
    }
  }

  return {
    PROVIDERS, DEFAULT_PROVIDER, GEMINI_BASE, THINKING_LEVELS, ERROR_CODES, KEY_SHAPE, AIError,
    costUSD, call, checkKey, keyLooksRight, setSDK, setFetch, parseJSON, geminiError, scrub,
  };
});
