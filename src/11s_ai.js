/* ============================================================
   文字PVメーカー — AI (optional)
   Calls the AI service the user picked, straight from the browser with the user's own API key.
   Only lyric text, the user's one-line instruction and numbers / setting keys are sent (the song's audio only through
   the separate, opt-in features in 11t_ai_audio.js).
   Default: Google Gemini (gemini-3.8-flash, REST). The second service goes through its official SDK (vendor/ai-sdk.min.js).
   This file has no DOM code: providers, prompts, JSON schemas, validation of answers, and turning answers into
   project changes. The panel is 13_ai_ui.js. Nothing else depends on it — the app works without AI.
   ============================================================ */
(() => {
'use strict';
const AI = J.AI = {};

/* ---------------- providers ---------------- */
// price: USD per 1M tokens [input, output] (Gemini 3.8 Flash: introductory rate until 2026-12-31, then 1.50 / 7.50)
AI.PROVIDERS = {
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-3.8-flash', models: ['gemini-3.8-flash'],
    keyUrl: 'https://aistudio.google.com/apikey', price: { 'gemini-3.8-flash': [0.75, 3.75] } },
  claude: { label: 'Anthropic Claude', defaultModel: 'claude-opus-5', models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    keyUrl: 'https://console.anthropic.com/settings/keys', price: { 'claude-opus-5': [5, 25], 'claude-sonnet-5': [2, 10], 'claude-haiku-4-5': [1, 5] } },
};
AI.DEFAULT_PROVIDER = 'gemini';
AI.GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
AI.costUSD = (provider, model, usage) => {
  const p = (AI.PROVIDERS[provider] || {}).price || {};
  const r = p[model]; if (!r || !usage) return null;
  return (usage.input * r[0] + usage.output * r[1]) / 1e6;
};

/* errors carry a code the panel turns into a message; the API key never goes into a message */
class AIError extends Error { constructor(code, message, extra) { super(message || code); this.code = code; Object.assign(this, extra || {}); } }
AI.AIError = AIError;

/* one structured request. effort: 'low' | 'medium' | 'high'. Returns { json, usage: {input, output}, model }. */
AI.call = async (o) => {
  if (!o.apiKey) throw new AIError('no_key');
  const provider = o.provider || AI.DEFAULT_PROVIDER;
  if (provider === 'gemini') return callGemini(o);
  if (provider === 'claude') { if (o.media && o.media.length) throw new AIError('no_audio'); return callClaude(o); }
  throw new AIError('bad_provider');
};

async function callGemini({ model, apiKey, system, prompt, schema, effort = 'low', signal, fetchImpl, media }) {
  const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
  model = model || AI.PROVIDERS.gemini.defaultModel;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: (media || []).concat([{ text: prompt }]) }],   // media: the song's audio (11t_ai_audio.js)
    generationConfig: {
      responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 16384,
      thinkingConfig: { thinkingLevel: ({ low: 'LOW', medium: 'MEDIUM', high: 'HIGH' })[effort] || 'LOW' },
    },
  };
  let r;
  try {
    // the key goes in a header, not the URL, so it never shows up in logs or history
    r = await doFetch(AI.GEMINI_BASE + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey }, body: JSON.stringify(body), signal,
    });
  } catch (e) {
    if (e && e.name === 'AbortError') throw new AIError('aborted');
    throw new AIError('network', e && e.message);
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw geminiError(r, j);
  if (j && j.promptFeedback && j.promptFeedback.blockReason) throw new AIError('blocked', j.promptFeedback.blockReason);
  const cand = j && j.candidates && j.candidates[0];
  if (!cand) throw new AIError('empty');
  if (cand.finishReason && /SAFETY|PROHIBITED|BLOCKLIST|RECITATION|SPII/.test(cand.finishReason)) throw new AIError('blocked', cand.finishReason);
  if (cand.finishReason === 'MAX_TOKENS') throw new AIError('truncated');
  const text = ((cand.content && cand.content.parts) || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  const u = j.usageMetadata || {};
  return { json: parseJSON(text), usage: { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) }, model };
}

function geminiError(r, j) {
  const reasons = ((j && j.error && j.error.details) || []).map(d => d.reason).filter(Boolean);
  const msg = j && j.error && j.error.message;
  if (reasons.includes('API_KEY_INVALID') || r.status === 401 || r.status === 403) return new AIError('auth', msg, { status: r.status });
  if (r.status === 429) return new AIError('rate', msg, { status: r.status });
  if (r.status === 404) return new AIError('model', msg, { status: r.status });
  if (r.status >= 500) return new AIError('server', msg, { status: r.status });
  return new AIError('bad_request', msg, { status: r.status });
}
async function callClaude({ model, apiKey, system, prompt, schema, effort = 'medium', signal, SDK }) {
  const Anthropic = SDK || (typeof window !== 'undefined' && window.AnthropicSDK);
  if (!Anthropic) throw new AIError('no_sdk');
  model = model || AI.PROVIDERS.claude.defaultModel;
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
  const req = { model, max_tokens: 16000, system, messages: [{ role: 'user', content: prompt }], output_config: { format: { type: 'json_schema', schema } } };
  if (!/haiku/.test(model)) { req.thinking = { type: 'adaptive' }; req.output_config.effort = effort; }   // Haiku 4.5 takes neither
  let res;
  try {
    if (model === 'claude-opus-5') {
      // if a safety classifier declines, the API re-runs the request on a fallback model inside the same call
      res = await client.beta.messages.create(Object.assign(req, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }), { signal });
    } else {
      res = await client.messages.create(req, { signal });
    }
  } catch (e) {
    throw sdkError(Anthropic, e);
  }
  if (res.stop_reason === 'refusal') throw new AIError('blocked', res.stop_details && res.stop_details.category);
  if (res.stop_reason === 'max_tokens') throw new AIError('truncated');
  const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const u = res.usage || {};
  return { json: parseJSON(text), usage: { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), output: u.output_tokens || 0 }, model: res.model || model };
}
function sdkError(A, e) {
  if (A.APIUserAbortError && e instanceof A.APIUserAbortError) return new AIError('aborted');
  if ((A.AuthenticationError && e instanceof A.AuthenticationError) || (A.PermissionDeniedError && e instanceof A.PermissionDeniedError)) return new AIError('auth', apiMessage(e), { status: e.status });
  if (A.RateLimitError && e instanceof A.RateLimitError) return new AIError('rate', apiMessage(e), { status: e.status });
  if (A.NotFoundError && e instanceof A.NotFoundError) return new AIError('model', apiMessage(e), { status: e.status });
  if (A.BadRequestError && e instanceof A.BadRequestError) return new AIError('bad_request', apiMessage(e), { status: e.status });
  if (A.InternalServerError && e instanceof A.InternalServerError) return new AIError('server', apiMessage(e), { status: e.status });
  if (A.APIConnectionError && e instanceof A.APIConnectionError) return new AIError('network', e.message);
  if (e && e.name === 'AbortError') return new AIError('aborted');
  return new AIError('server', apiMessage(e), { status: e && e.status });
}

/* ---------------- API key check ---------------- */
/* does the key work for this model? Reads the model's info, which costs nothing (no tokens are used).
   -> { model, name } or throws an AIError ('auth' = bad key, 'model' = the key works but this model is not available) */
AI.checkKey = async ({ provider, model, apiKey, signal, fetchImpl, SDK }) => {
  if (!apiKey) throw new AIError('no_key');
  provider = provider || AI.DEFAULT_PROVIDER;
  model = model || AI.PROVIDERS[provider].defaultModel;
  if (provider === 'gemini') {
    const doFetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    let r;
    try { r = await doFetch(AI.GEMINI_BASE + encodeURIComponent(model), { method: 'GET', headers: { 'x-goog-api-key': apiKey }, signal }); }
    catch (e) { throw new AIError(e && e.name === 'AbortError' ? 'aborted' : 'network', e && e.message); }
    const j = await r.json().catch(() => null);
    if (!r.ok) throw geminiError(r, j);
    const methods = (j && j.supportedGenerationMethods) || null;
    if (methods && !methods.includes('generateContent')) throw new AIError('model', 'generateContent is not supported');
    return { model, name: (j && j.displayName) || model };
  }
  if (provider === 'claude') {
    const Anthropic = SDK || (typeof window !== 'undefined' && window.AnthropicSDK);
    if (!Anthropic) throw new AIError('no_sdk');
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0 });
    try { const m = await client.models.retrieve(model, {}, { signal }); return { model, name: (m && m.display_name) || model }; }
    catch (e) { throw sdkError(Anthropic, e); }
  }
  throw new AIError('bad_provider');
};
/* a quick look at the key's shape, before sending it anywhere (only a hint: formats can change) */
AI.KEY_SHAPE = { gemini: /^AIza[0-9A-Za-z_-]{30,}$/, claude: /^sk-ant-[0-9A-Za-z_-]{20,}$/ };
AI.keyLooksRight = (provider, key) => { const re = AI.KEY_SHAPE[provider]; return !re || re.test(String(key || '')); };
const apiMessage = e => (e && e.error && e.error.error && e.error.error.message) || (e && e.message) || '';
function parseJSON(text) {
  try { return JSON.parse(text); }
  catch (e) {
    const m = String(text || '').match(/\{[\s\S]*\}/);            // tolerate stray text around the object
    if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
    throw new AIError('bad_json');
  }
}

/* ---------------- lyrics in and out ---------------- */
const TAGS = /^((?:\[\d+:\d+(?:[.:]\d+)?\])+)/;
/* one entry per raw line of the lyric box. lyric lines carry the parsed fields; others (blank, comment, [ti:]) do not */
AI.rawLines = (raw) => String(raw || '').replace(/\r/g, '').split('\n').map((src, raw) => {
  const p = J.parseLyrics(src).lines;
  if (!p.length) return { raw, src, lyric: false, count: 0 };
  const t = src.trim().match(TAGS);
  const l = p[0];
  return { raw, src, lyric: true, count: p.length, prefix: t ? t[1] : '', text: l.text, note: l.note, impact: l.impact, emph: l.emph.slice(), manual: l.manual ? l.manual.slice() : null, lrc: p.map(x => x.lrc) };
});
/* lyric line -> text in the lyric syntax (tags, / cuts, *emphasis*, trailing !, |note) */
AI.renderLine = (ln) => {
  const segs = ln.manual && ln.manual.length ? ln.manual : [ln.text];
  const marked = segs.map(seg => {
    let s = seg;
    for (const w of ln.emph || []) {
      if (!w) continue;
      const i = s.indexOf(w);
      if (i >= 0 && !isInsideMark(s, i)) s = s.slice(0, i) + '*' + w + '*' + s.slice(i + w.length);
    }
    return s;
  });
  return (ln.prefix || '') + marked.join('/') + (ln.impact ? '!' : '') + (ln.note ? '|' + ln.note : '');
};
function isInsideMark(s, i) { let n = 0; for (let k = 0; k < i; k++) if (s[k] === '*') n++; return n % 2 === 1; }
/* render a lyric line with new fields, then parse it back and check that the words, timestamps and marks come out as
   intended. Whatever the lyric syntax cannot express (a cut that moves a space, "!!" at the end, a line break in a
   reading, an emphasis inside another one …) fails here, and the caller drops that change instead of altering the lyrics */
const cuts = m => (m && m.length >= 2 ? m : null);
const sorted = a => (a || []).slice().sort();
AI.renderChecked = (r, fields) => {
  const want = Object.assign({}, r, fields);
  const src = AI.renderLine(want);
  if (/[\r\n]/.test(src)) return { src, ok: false };
  const p = J.parseLyrics(src).lines;
  const l = p[0];
  const ok = p.length === r.count && l.text === r.text
    && JSON.stringify(p.map(x => x.lrc)) === JSON.stringify(r.lrc)
    && l.impact === !!want.impact && (l.note || null) === (want.note || null)
    && JSON.stringify(cuts(l.manual)) === JSON.stringify(cuts(want.manual))
    && JSON.stringify(sorted(l.emph)) === JSON.stringify(sorted(want.emph));
  return { src, ok };
};
const SYNTAX_CHARS = /[\r\n|/*]/;
/* parsed-line order of the lyric box: [{raw, k}] where k = which timestamp of that raw line (mirrors J.parseLyrics) */
AI.parsedOrder = (rows) => {
  const out = [];
  for (const r of rows) if (r.lyric) for (let k = 0; k < r.count; k++) out.push({ raw: r.raw, k, lrc: r.lrc[k] });
  if (out.some(o => o.lrc != null)) out.sort((a, b) => (a.lrc ?? 1e9) - (b.lrc ?? 1e9));
  return out;
};
/* remove / rewrite raw lines and carry per-line settings (overrides, manual start times) to the lines' new numbers */
AI.editLyrics = (project, edits) => {
  // edits: { [raw]: { remove: true } | { line: {...lyric fields} } }
  const rows = AI.rawLines(project.lyrics);
  const before = AI.parsedOrder(rows);
  const kept = [];
  for (const r of rows) {
    const e = edits[r.raw];
    if (e && e.remove) continue;
    const out = e && e.line && r.lyric ? AI.renderChecked(r, e.line) : null;
    if (out && out.ok) kept.push(Object.assign({}, r, { src: out.src, newText: true }));
    else kept.push(r);                                      // unchanged when the new line would not parse back as intended
  }
  // squeeze blank lines left behind by removals (never more than one in a row, none at the start)
  const lines = [];
  for (const r of kept) { const blank = !r.src.trim(); if (blank && (!lines.length || !lines[lines.length - 1].src.trim())) continue; lines.push(r); }
  while (lines.length && !lines[lines.length - 1].src.trim()) lines.pop();
  const lyrics = lines.map(r => r.src).join('\n');
  const rowsAfter = AI.rawLines(lyrics);
  if (rowsAfter.length !== lines.length) throw new AIError('bad_edit');
  const after = AI.parsedOrder(rowsAfter.map((r, i) => Object.assign(r, { raw: lines[i].raw })));
  const map = {};                                           // old parsed index -> new parsed index
  before.forEach((o, i) => { const j = after.findIndex(n => n.raw === o.raw && n.k === o.k); if (j >= 0) map[i] = j; });
  const remap = obj => { const out = {}; for (const [k, v] of Object.entries(obj || {})) if (map[k] != null) out[map[k]] = v; return out; };
  const timing = Object.assign({}, project.timing, { lineTimes: remap(project.timing && project.timing.lineTimes) });
  return { lyrics, overrides: remap(project.overrides), timing, map };
};

/* ---------------- what the AI may choose from ---------------- */
AI.CATALOG_GROUPS = ['layout', 'enter', 'exit', 'decor', 'bg'];
AI.FX_KEYS = ['motion', 'glitch', 'chroma', 'decor', 'density', 'texture', 'bgSwitch'];
/* parts random picks may use under the project's 追加分 / 和風 settings (the season is left to the AI) */
AI.catalog = (project, groups = AI.CATALOG_GROUPS) => {
  const p = Object.assign({}, project, { season: null });
  const out = {};
  for (const g of groups) {
    out[g] = J.order(g).filter(k => { const d = J.registry(g)[k]; return d && !d.special && J.randomOk(p, g, k) && !['none', 'cut'].includes(k); })
      .map(k => { const d = J.registry(g)[k]; return { key: k, name: d.name, tags: (d.tags || []).slice(0, 3), season: J.motifSeason ? J.motifSeason(g, k) : null }; });
  }
  return out;
};
AI.catalogText = (cat) => Object.entries(cat).map(([g, list]) =>
  `[${g}] ` + list.map(x => `${x.key}=${x.name}${x.season ? '{' + x.season + '}' : ''}${x.tags.length ? '(' + x.tags.join('/') + ')' : ''}`).join(' ')).join('\n');
AI.stylesText = () => J.STYLE_ORDER.map(k => `${k}=${J.STYLES[k].name}: ${J.STYLES[k].desc}${J.motifSeason && J.motifSeason('style', k) ? ' {' + J.motifSeason('style', k) + '}' : ''}`).join('\n');
AI.moodsText = () => Object.entries(J.MOODS).map(([k, m]) => `${k}=${m.name}`).join(', ');
const numbered = (lines) => lines.map(l => `${l.i}: ${l.text}`).join('\n');
const outLang = (lang) => (lang === 'en' ? 'English' : 'Japanese');
const SEASON_ENUM = ['spring', 'summer', 'autumn', 'winter', 'none', 'any'];
const HEX = /^#[0-9a-fA-F]{6}$/;

/* ---------------- 1) 歌詞の下ごしらえ ---------------- */
AI.PREP_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['summary', 'lines'],
  properties: {
    summary: { type: 'string' },
    lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['i', 'remove', 'reason', 'segments', 'emphasis', 'reading'],
      properties: { i: { type: 'integer' }, remove: { type: 'boolean' }, reason: { type: 'string' }, segments: { type: 'array', items: { type: 'string' } }, emphasis: { type: 'array', items: { type: 'string' } }, reading: { type: 'string' } } } },
  },
};
AI.prepRequest = (project, uiLang) => {
  const rows = AI.rawLines(project.lyrics).filter(r => r.lyric);
  const lines = rows.map(r => ({ i: r.raw, text: r.text }));
  const system = `You prepare song lyrics for a Japanese lyric-motion video (文字PV) tool. Each lyric line becomes on-screen text, cut into short phrases.
For each line decide only these four things. Never change, add or reorder the words themselves.
1. remove: true for lines that are not sung lyrics: section labels ([Verse], 【サビ】, 1番), credits (作詞・作曲・編曲・歌), repeat marks (×2, 繰り返し), website text (歌詞をコピー, シェア), chord names, URLs. Give a short reason.
2. segments: where the line should be cut into on-screen phrases. List the pieces in order; joined together they must equal the line exactly (spaces aside). Cut at natural phrase boundaries (文節), 2-4 pieces for long lines, none (empty list) for short lines.
3. emphasis: at most one or two key words per line that carry the meaning or the hook (copied exactly from the line). Most lines need none.
4. reading: a hiragana reading only where the lyrics give a word an unusual reading (当て字, e.g. 本気→まじ, 運命→さだめ). Otherwise an empty string.
Return only lines that need at least one change. Keep "reason" and "summary" short and write them in ${outLang(uiLang)}.`;
  const prompt = `Lyrics (line number: text):\n${numbered(lines)}`;
  return { system, prompt, schema: AI.PREP_SCHEMA, effort: 'low', lines };
};
/* validate the answer against the lyrics -> [{raw, before, after, remove, reason, fields}] (only real changes) */
AI.prepChanges = (project, json) => {
  const rows = AI.rawLines(project.lyrics);
  const byRaw = new Map(rows.filter(r => r.lyric).map(r => [r.raw, r]));
  const out = [], warn = [];
  const squash = s => String(s).replace(/\s+/g, '');
  const seen = new Set();
  for (const a of (json && json.lines) || []) {
    const r = byRaw.get(a.i);
    if (!r || seen.has(a.i)) { if (!r) warn.push(`line ${a.i}: not a lyric line`); continue; }
    seen.add(a.i);
    if (a.remove) { out.push({ raw: r.raw, remove: true, reason: String(a.reason || '').slice(0, 120), before: r.src, after: null }); continue; }
    const line = { manual: r.manual, emph: r.emph.slice(), note: r.note };
    const segs = (a.segments || []).map(s => String(s).trim()).filter(Boolean);
    if (segs.length >= 2) {
      if (segs.some(x => SYNTAX_CHARS.test(x)) || squash(segs.join('')) !== squash(r.text)) warn.push(`line ${a.i}: cut pieces do not match the line`);
      else line.manual = segs;
    }
    const pieces = line.manual && line.manual.length ? line.manual : [r.text];
    for (const w of (a.emphasis || []).map(s => String(s).trim()).filter(Boolean).slice(0, 3)) {
      if (SYNTAX_CHARS.test(w) || !pieces.some(p => p.includes(w))) { warn.push(`line ${a.i}: emphasis "${w}" not in one piece`); continue; }
      if (!line.emph.some(e => e.includes(w) || w.includes(e))) line.emph.push(w);
    }
    const reading = String(a.reading || '').trim();
    if (reading && !r.note && reading.length <= 40 && reading !== r.text && !SYNTAX_CHARS.test(reading)) line.note = reading;
    const res = AI.renderChecked(r, line);
    if (!res.ok) { warn.push(`line ${a.i}: the change cannot be written without altering the lyrics`); continue; }
    if (res.src !== AI.renderLine(r)) out.push({ raw: r.raw, remove: false, reason: String(a.reason || '').slice(0, 120), before: r.src, after: res.src, line });
  }
  out.sort((x, y) => x.raw - y.raw);
  return { changes: out, warnings: warn };
};
/* apply the accepted prep changes -> project patch {lyrics, overrides, timing} */
AI.applyPrep = (project, changes) => {
  const rows = AI.rawLines(project.lyrics);
  const edits = {}, skipped = [];
  for (const c of changes) {
    if (!rows[c.raw] || rows[c.raw].src !== c.before) { skipped.push(c.raw); continue; }   // the line changed since the answer
    edits[c.raw] = c.remove ? { remove: true } : { line: c.line };
  }
  const r = AI.editLyrics(project, edits);
  return { lyrics: r.lyrics, overrides: r.overrides, timing: r.timing, map: r.map, skipped };
};

/* ---------------- shared: look changes ---------------- */
/* a "look" answer (a proposal or a one-line edit) -> validated list of changes against the current project */
function lookChanges(project, a, plan, warn) {
  const ch = [];
  const P = project;
  const nLines = plan ? plan.lines.length : J.parseLyrics(P.lyrics).lines.length;
  const cat = AI.catalog(P, ['layout', 'enter', 'exit', 'hold', 'decor', 'bg']);
  const has = (g, k) => cat[g] && cat[g].some(x => x.key === k) || (g === 'hold' && J.HOLD[k]) || (g === 'enter' && k === 'cut') || (g === 'exit' && k === 'cut');
  const season = SEASON_ENUM.includes(a.season) ? a.season : '';
  const newSeason = season || P.season || 'any';
  if (season && season !== (P.season || 'any')) ch.push({ kind: 'season', from: P.season || 'any', to: season });
  const inSeason = (g, k) => !J.seasonOk || J.seasonOk({ season: newSeason }, g, k);
  if (a.style) {
    if (!J.STYLES[a.style]) warn.push(`unknown style ${a.style}`);
    else if (!inSeason('style', a.style)) warn.push(`style ${a.style} is off-season`);
    else if (a.style !== P.style) ch.push({ kind: 'style', from: P.style, to: a.style });
  }
  if (a.mood && J.MOODS[a.mood] && a.mood !== P.mood) ch.push({ kind: 'mood', from: P.mood || null, to: a.mood });
  for (const k of AI.FX_KEYS) {
    const v = a.fx && typeof a.fx[k] === 'number' ? a.fx[k] : -1;
    if (v < 0 || !isFinite(v)) continue;
    const to = Math.round(J.clamp(v, 0, 1) * 100) / 100, from = P.fx[k] ?? 0.5;
    if (Math.abs(to - from) >= 0.01) ch.push({ kind: 'fx', key: k, from, to });
  }
  if (a.flash === 'on' || a.flash === 'off' || typeof a.flash === 'boolean') {
    const to = a.flash === true || a.flash === 'on';
    if (to !== !!P.fx.flash) ch.push({ kind: 'flash', from: !!P.fx.flash, to });
  }
  const pal = a.palette || {};
  if (['accent', 'ghostA', 'ghostB'].every(k => HEX.test(pal[k] || ''))) {
    const style = J.STYLES[(ch.find(c => c.kind === 'style') || {}).to || P.style] || J.STYLES.noir;
    const bg = P.colors && P.colors.enabled && P.colors.bg ? P.colors.bg : style.schemes[0].bg;
    const to = { accent: J.fitContrast(pal.accent, bg, 3), ghostA: pal.ghostA.toUpperCase(), ghostB: pal.ghostB.toUpperCase() };
    const c = P.colors || {};
    if (!(c.accentOn && c.accent === to.accent && c.ghostA === to.ghostA && c.ghostB === to.ghostB)) ch.push({ kind: 'palette', from: c.accentOn ? { accent: c.accent, ghostA: c.ghostA, ghostB: c.ghostB } : null, to });
  }
  const refs = (list) => (list || []).map(s => String(s).split('.')).filter(([g, k]) => g && k && J.GROUP_KEYS.includes(g) && J.registry(g)[k]);
  const avoid = refs(a.avoid).filter(([g, k]) => (P.enabled[g] || {})[k] !== false && !['center', 'cut', 'still', 'none', 'push'].includes(k));
  if (avoid.length) ch.push({ kind: 'avoid', parts: avoid.slice(0, 40).map(([g, k]) => g + '.' + k) });
  const allow = refs(a.allow).filter(([g, k]) => (P.enabled[g] || {})[k] === false);
  if (allow.length) ch.push({ kind: 'allow', parts: allow.slice(0, 40).map(([g, k]) => g + '.' + k) });
  const seenLine = new Set();
  for (const l of a.lines || []) {
    const i = l.i | 0;
    if (i < 0 || i >= nLines || seenLine.has(i)) { if (i < 0 || i >= nLines) warn.push(`line ${l.i} does not exist`); continue; }
    seenLine.add(i);
    const cur = (P.overrides || {})[i] || {};
    for (const g of ['layout', 'enter', 'exit', 'hold']) {
      const k = l[g];
      if (!k) continue;
      if (!has(g, k)) { warn.push(`line ${i}: unknown ${g} ${k}`); continue; }
      if (!inSeason(g, k)) { warn.push(`line ${i}: ${g} ${k} is off-season`); continue; }
      if (cur[g] !== k) ch.push({ kind: 'line', i, field: g, from: cur[g] || null, to: k });
    }
    if (l.impact === 'on' || l.impact === 'off') ch.push({ kind: 'impact', i, to: l.impact === 'on' });
    for (const w of (l.emphasis || []).slice(0, 2)) if (w) ch.push({ kind: 'emphasis', i, word: String(w) });
  }
  return ch;
}
/* lyric-syntax changes (impact / emphasis) are checked against the lyric lines; dropped when they change nothing */
function lyricEditsOf(project, changes, warn) {
  const rows = AI.rawLines(project.lyrics), order = AI.parsedOrder(rows);
  const byRaw = new Map(rows.map(r => [r.raw, r]));
  const edits = {};
  const keep = [];
  for (const c of changes) {
    if (c.kind !== 'impact' && c.kind !== 'emphasis') { keep.push(c); continue; }
    const o = order[c.i]; if (!o) continue;
    const r = byRaw.get(o.raw);
    const line = edits[o.raw] || (edits[o.raw] = { emph: r.emph.slice(), impact: r.impact, manual: r.manual, note: r.note });
    const next = { emph: line.emph.slice(), impact: line.impact, manual: line.manual, note: line.note };
    if (c.kind === 'impact') { if (line.impact === c.to) continue; next.impact = c.to; }
    else {
      const w = String(c.word).trim();
      const pieces = r.manual && r.manual.length ? r.manual : [r.text];
      if (!w || SYNTAX_CHARS.test(w) || !pieces.some(p => p.includes(w))) { warn.push(`line ${c.i}: "${c.word}" is not in the lyrics`); continue; }
      if (line.emph.some(e => e.includes(w) || w.includes(e))) continue;        // already (part of) an emphasis
      next.emph.push(w);
    }
    // every step must parse back as intended, or the lyric would change (e.g. taking "!" off "Yeah!!")
    if (!AI.renderChecked(r, next).ok) { warn.push(`line ${c.i}: the change cannot be written without altering the lyrics`); continue; }
    Object.assign(line, next);
    keep.push(Object.assign({}, c, { raw: o.raw, repeats: r.count }, c.kind === 'impact' ? { from: r.impact } : { word: next.emph[next.emph.length - 1] }));
  }
  return keep;
}
/* apply a list of (accepted) look changes to a copy of the project -> the new project */
AI.applyChanges = (project, changes) => {
  const P = JSON.parse(JSON.stringify(project));
  P.fx = Object.assign({}, P.fx); P.colors = Object.assign({ enabled: false }, P.colors || {}); P.overrides = Object.assign({}, P.overrides || {});
  P.enabled = Object.fromEntries(Object.entries(P.enabled || {}).map(([g, m]) => [g, Object.assign({}, m)]));
  const lyricEdits = {};
  const rows = AI.rawLines(P.lyrics);
  let customLook = false;
  // season first (it limits what a mood may pick), then style and mood, then the fine changes on top
  const first = { season: 0, style: 1, mood: 2 };
  for (const c of changes.slice().sort((a, b) => (first[a.kind] ?? 9) - (first[b.kind] ?? 9))) {
    if (c.kind === 'style') { P.style = c.to; P.colors.enabled = false; }
    else if (c.kind === 'mood') { P.mood = c.to; P.enabled = J.moodEnabled(P, c.to, J.rng(J.h(P.seed | 0, 4242))); }   // the mood's technique focus, as おまかせ does
    else if (c.kind === 'season') P.season = c.to === 'any' ? null : c.to;
    else if (c.kind === 'fx') { P.fx[c.key] = c.to; customLook = true; }
    else if (c.kind === 'flash') { P.fx.flash = c.to; customLook = true; }
    else if (c.kind === 'palette') Object.assign(P.colors, c.to, { accentOn: true });
    else if (c.kind === 'avoid') { for (const r of c.parts) { const [g, k] = r.split('.'); (P.enabled[g] || (P.enabled[g] = {}))[k] = false; } customLook = true; }
    else if (c.kind === 'allow') { for (const r of c.parts) { const [g, k] = r.split('.'); (P.enabled[g] || (P.enabled[g] = {}))[k] = true; } customLook = true; }
    else if (c.kind === 'line') { const o = Object.assign({}, P.overrides[c.i] || {}); o[c.field] = c.to; P.overrides[c.i] = cleanOv(o); }
    else if (c.kind === 'impact' || c.kind === 'emphasis') {
      const r = rows[c.raw]; if (!r || !r.lyric) continue;
      const e = lyricEdits[c.raw] || (lyricEdits[c.raw] = { line: { emph: r.emph.slice(), impact: r.impact, manual: r.manual, note: r.note } });
      if (c.kind === 'impact') e.line.impact = c.to; else if (!e.line.emph.includes(c.word)) e.line.emph.push(c.word);
    }
  }
  if (customLook && !changes.some(c => c.kind === 'mood')) P.mood = null;          // hand-tuned look = カスタム, as the sliders do
  if (Object.keys(lyricEdits).length) { const r = AI.editLyrics(P, lyricEdits); P.lyrics = r.lyrics; P.overrides = r.overrides; P.timing = r.timing; }
  return P;
};
function cleanOv(o) { for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === false || o[k] === '') delete o[k]; return o; }

/* the lines as the AI sees them for look requests: number, text and what the plan currently shows */
function planLines(plan) {
  return plan.lines.map(l => {
    const c = plan.cuts.find(x => x.line === l.index && x.layout !== 'interlude');
    return { i: l.index, text: l.text, now: c ? `${c.layout}/${c.enter}/${c.exit}` : '' };
  });
}
function lookContext(project, plan) {
  const P = project;
  const song = AI.songContext ? AI.songContext(P, plan) : '';
  return (song ? song + '\n' : '') + `Current settings: style=${P.style} mood=${P.mood || 'custom'} season=${P.season || 'any'} aspect=${P.aspect} ` +
    AI.FX_KEYS.map(k => `${k}=${(+P.fx[k] || 0).toFixed(2)}`).join(' ') + ` flash=${P.fx.flash ? 'on' : 'off'} lines=${plan.lines.length} duration=${plan.duration.toFixed(1)}s`;
}
const LOOK_RULES = `Seasons: parts and styles marked {spring|summer|autumn|winter} show that season (snow, cherry petals, fireworks, fireflies, maple leaves, heat haze).
Set "season" to the season the lyrics are about, "none" if they are clearly not about any season (then no seasonal motif is used), or "any" if unsure. Never pick a part or style of another season.
Use only keys from the lists (style keys, mood keys, part keys like "decor.snow"). fx values are 0..1 (-1 = keep as is). Colors are #RRGGBB.
If a song analysis from the audio is given, use its sections to find the chorus lines and its mood and tempo to set the energy.`;

/* ---------------- 2) AI 演出3案 ---------------- */
const LINE_PICK = { type: 'object', additionalProperties: false, required: ['i', 'layout', 'enter', 'exit'], properties: { i: { type: 'integer' }, layout: { type: 'string' }, enter: { type: 'string' }, exit: { type: 'string' } } };
const FX_SCHEMA = { type: 'object', additionalProperties: false, required: AI.FX_KEYS, properties: Object.fromEntries(AI.FX_KEYS.map(k => [k, { type: 'number' }])) };
const PALETTE_SCHEMA = { type: 'object', additionalProperties: false, required: ['accent', 'ghostA', 'ghostB'], properties: { accent: { type: 'string' }, ghostA: { type: 'string' }, ghostB: { type: 'string' } } };
AI.PROPOSALS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['theme', 'season', 'proposals'],
  properties: {
    theme: { type: 'string' },
    season: { type: 'string', enum: SEASON_ENUM },
    proposals: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['title', 'concept', 'style', 'mood', 'fx', 'flash', 'palette', 'avoid', 'lines'],
      properties: { title: { type: 'string' }, concept: { type: 'string' }, style: { type: 'string' }, mood: { type: 'string' }, fx: FX_SCHEMA, flash: { type: 'boolean' },
        palette: PALETTE_SCHEMA, avoid: { type: 'array', items: { type: 'string' } }, lines: { type: 'array', items: LINE_PICK } } } },
  },
};
AI.proposalsRequest = (project, plan, uiLang) => {
  const lines = planLines(plan);
  const system = `You are an art director for Japanese lyric-motion videos (文字PV). Read the lyrics, work out what they are about (scene, season, feeling, where the hook / chorus is), and propose three clearly different visual directions that fit that meaning.
Each proposal picks: a style (palette + type), a mood, effect strengths, an accent palette (accent + two chromatic offset colors), parts to avoid because they clash with the meaning (e.g. glitch effects for a quiet ballad), and for 2-6 key lines (the hook / chorus / climax) a layout, entrance and exit from the lists.
${LOOK_RULES}
Write "theme", "title" (a few words) and "concept" (one or two sentences that tie the look to the lyrics) in ${outLang(uiLang)}.`;
  const prompt = `${lookContext(project, plan)}

Styles:
${AI.stylesText()}

Moods: ${AI.moodsText()}

Parts (key=name{season}(mood tags)):
${AI.catalogText(AI.catalog(project))}

Lyrics (line number: text):
${numbered(lines)}`;
  return { system, prompt, schema: AI.PROPOSALS_SCHEMA, effort: 'medium' };
};
AI.proposalChanges = (project, plan, json) => {
  const warn = [];
  const season = SEASON_ENUM.includes(json && json.season) ? json.season : 'any';
  const list = ((json && json.proposals) || []).slice(0, 3).map(p => {
    const a = Object.assign({}, p, { season, flash: !!p.flash, lines: (p.lines || []).map(l => ({ i: l.i, layout: l.layout, enter: l.enter, exit: l.exit })) });
    const w = [];
    const changes = lyricEditsOf(project, lookChanges(project, a, plan, w), w);
    warn.push(...w);
    return { title: String(p.title || '').slice(0, 60), concept: String(p.concept || '').slice(0, 300), changes, warnings: w };
  });
  return { theme: String((json && json.theme) || '').slice(0, 200), season, proposals: list, warnings: warn };
};

/* ---------------- 3) ひとこと修正 ---------------- */
AI.EDIT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['understood', 'summary', 'question', 'changes'],
  properties: {
    understood: { type: 'boolean' }, summary: { type: 'string' }, question: { type: 'string' },
    changes: { type: 'object', additionalProperties: false, required: ['style', 'mood', 'season', 'fx', 'flash', 'palette', 'avoid', 'allow', 'lines'],
      properties: {
        style: { type: 'string' }, mood: { type: 'string' }, season: { type: 'string', enum: SEASON_ENUM.concat(['']) },
        fx: FX_SCHEMA, flash: { type: 'string', enum: ['keep', 'on', 'off'] },
        palette: PALETTE_SCHEMA, avoid: { type: 'array', items: { type: 'string' } }, allow: { type: 'array', items: { type: 'string' } },
        lines: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['i', 'layout', 'enter', 'exit', 'hold', 'impact', 'emphasis'],
          properties: { i: { type: 'integer' }, layout: { type: 'string' }, enter: { type: 'string' }, exit: { type: 'string' }, hold: { type: 'string' },
            impact: { type: 'string', enum: ['keep', 'on', 'off'] }, emphasis: { type: 'array', items: { type: 'string' } } } } },
      } },
  },
};
AI.editRequest = (project, plan, instruction, uiLang) => {
  const lines = planLines(plan);
  const system = `You edit the look of a Japanese lyric-motion video (文字PV) from one short instruction by the user (e.g. "サビをもっと派手に", "全体を落ち着いた雰囲気に", "2行目は縦書きに").
Turn the instruction into the smallest set of setting changes that does what it asks; leave everything else as it is.
- "keep" / "" / -1 / empty lists mean no change. Colors: all three "" to keep them.
- Lines: find the lines the user means (the chorus / サビ is usually the repeated lines or the hook; line numbers start at 0). For each, you may set layout / enter / exit / hold ("" = keep), impact ("on" adds a flash and shake) and emphasis (words copied exactly from that line).
- Never change the words of the lyrics.
- If the instruction is unclear or impossible with these settings, set understood=false, explain in "question" and change nothing.
${LOOK_RULES}
Write "summary" (one sentence: what will change) and "question" in ${outLang(uiLang)}.`;
  const prompt = `Instruction: ${String(instruction).slice(0, 300)}

${lookContext(project, plan)}
Current palette override: ${project.colors && project.colors.accentOn ? [project.colors.accent, project.colors.ghostA, project.colors.ghostB].join(' ') : 'none (style colors)'}
Lines with a manual setting: ${Object.entries(project.overrides || {}).map(([i, o]) => `${i}:${['layout', 'enter', 'exit', 'hold'].filter(k => o[k]).map(k => k + '=' + o[k]).join(',') || 'reroll'}`).join(' ') || 'none'}

Styles:
${AI.stylesText()}

Moods: ${AI.moodsText()}

Parts (key=name{season}(mood tags)):
${AI.catalogText(AI.catalog(project, ['layout', 'enter', 'exit', 'hold', 'decor', 'bg']))}

Lyrics (line number: text · layout/enter/exit of its first cut now):
${lines.map(l => `${l.i}: ${l.text} · ${l.now}`).join('\n')}`;
  return { system, prompt, schema: AI.EDIT_SCHEMA, effort: 'low' };
};
AI.editChanges = (project, plan, json) => {
  const warn = [];
  if (!json || !json.changes) return { understood: false, summary: '', question: '', changes: [], warnings: ['empty answer'] };
  const c = json.changes;
  const a = {
    style: c.style || '', mood: c.mood || '', season: c.season || '', fx: c.fx, flash: c.flash === 'on' ? 'on' : c.flash === 'off' ? 'off' : 'keep',
    palette: c.palette, avoid: c.avoid, allow: c.allow,
    lines: (c.lines || []).map(l => ({ i: l.i, layout: l.layout, enter: l.enter, exit: l.exit, hold: l.hold, impact: l.impact, emphasis: l.emphasis })),
  };
  const changes = json.understood === false ? [] : lyricEditsOf(project, lookChanges(project, a, plan, warn), warn);
  return { understood: json.understood !== false, summary: String(json.summary || '').slice(0, 300), question: String(json.question || '').slice(0, 300), changes, warnings: warn };
};
})();
