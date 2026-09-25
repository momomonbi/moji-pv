/* 文字PVメーカー v2 — original work. Tests for the AI panel's pure logic and controller: keys, consent, runs, review, apply, try-on, revert, string keys (DESIGN §4.22, §6.4.10, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, listSources, SRC } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const AC = MV.use('ui/ai_controller');
const CH = MV.use('ai/changes');
const LOOKS = MV.use('ai/looks');
const REG = MV.use('core/registry');
const AR = MV.use('ui/ai_review');
const PR = MV.use('ai/providers');
const SONG = MV.use('ai/song');
const CMD = MV.use('core/commands');
const D = MV.use('core/doc');
const ST = MV.use('core/store');
const T = MV.use('i18n/t');
const STRINGS = MV.use('i18n/strings');

const reg = corpus.stubRegistry(MV);
const LYRICS = '夜明けの街を走る\n作詞: 誰か\n君の名前を呼ぶ';
const KEY = 'AIza' + 'x'.repeat(35);
const KEEP = { motion: -1, glitch: -1, chroma: -1, ornament: -1, density: -1, texture: -1, groundSwitch: -1 };

// A Storage-like map; `broken` makes every access throw (private mode, blocked storage).
function memoryStorage(broken) {
  const m = new Map();
  const guard = () => { if (broken) throw new Error('blocked'); };
  return {
    getItem: (k) => { guard(); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { guard(); m.set(k, String(v)); },
    removeItem: (k) => { guard(); m.delete(k); },
    keys: () => [...m.keys()],
  };
}

function planOf(doc) { return MV.use('planner/plan').plan(doc, { registry: reg }); }

function answer(json, usage) {
  return { candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(json) }] } }],
    usageMetadata: usage || { promptTokenCount: 3210, candidatesTokenCount: 850 } };
}

// A Gemini stand-in: GET = the model-info check, POST = the next queued answer (an object, or a function (url, init)).
function fakeGemini(answers, seen) {
  return async (url, init) => {
    seen.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null });
    if (init.method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash',
        supportedGenerationMethods: ['generateContent'] }) };
    }
    const next = answers.shift();
    if (typeof next === 'function') return next(url, init);
    return { ok: true, status: 200, json: async () => answer(next) };
  };
}

// The app as the controller sees it: a real store with core/commands, the real planner on the stub registry.
function makeHost(text, extra) {
  const store = ST.createStore({ doc: CMD.reduce(D.defaultDoc(), { t: 'lyrics.set', text: text || LYRICS }),
    side: D.defaultSide(), reduce: CMD.reduce });
  let planned = { doc: null, plan: null };
  const log = { toasts: [], review: false, alt: null, tryOns: [] };
  const host = {
    t: T.createT('ja', STRINGS, reg, { strict: true }), lang: 'ja', registry: reg, store, log, song: () => null,
    get doc() { return store.doc; },
    get plan() {
      if (planned.doc !== store.doc) planned = { doc: store.doc, plan: planOf(store.doc) };
      return planned.plan;
    },
    get rev() { return store.rev; },
    get side() { return store.side; },
    batch: (meta, cmds) => store.batch(meta, cmds),
    setSide: (fn) => store.setSide(fn),
    undo: () => store.undo(),
    toast: (text, opts) => { log.toasts.push({ text, opts: opts || {} }); },
    setReviewOpen: (on) => { log.review = !!on; },
    tryOn: (doc, badge) => { log.alt = doc ? { doc, badge } : null; log.tryOns.push(doc ? badge : null); },
    altShown: () => !!log.alt,
    now: () => 1700000000000,
    nextFrame: () => Promise.resolve(),
  };
  return Object.assign(host, extra || {});
}

function setup(answers, opts) {
  const o = opts || {};
  const seen = [];
  const host = makeHost(o.text, o.host);
  const local = o.local || memoryStorage();
  const session = o.session || memoryStorage();
  if (o.key !== false) session.setItem('mojipv.ai.key.gemini', o.key || KEY);
  const ctl = AC.createController(host, { session, local, fetchImpl: fakeGemini(answers || [], seen) });
  return { host, ctl, seen, local, session };
}

// Every row and warning of a review reads as text with the strict ja and en tables (a missing key throws).
const STRICT = ['ja', 'en'].map((lang) => T.createT(lang, STRINGS, reg, { strict: true }));
function assertTexts(review) {
  const lists = review.kind === 'looks' ? review.proposals.map((p) => p.changes) : [review.changes || []];
  const warnings = (review.warnings || []).concat(...(review.proposals || []).map((p) => p.warnings || []));
  for (const t of STRICT) {
    for (const c of lists.flat()) assert.ok(CH.describe(c, t), c.kind);
    for (const w of warnings) assert.ok(CH.warningText(w, t), w[0]);
    if (review.usage) assert.ok(AC.costText(t, review.provider, review.model, review.usage));
  }
}

const PREP_ANSWER = {
  summary: '1行はクレジットでした',
  lines: [
    { i: 0, remove: false, reason: '文節で区切る', segments: ['夜明けの', '街を走る'], emphasis: ['街'], reading: '' },
    { i: 1, remove: true, reason: 'クレジット', segments: [], emphasis: [], reading: '' },
  ],
};

function proposal(k, theme, mood, arrange) {
  return { title: '案' + k, concept: 'c' + k, theme, mood, amounts: KEEP, flash: false,
    palette: { accent: '#C2413A', shiftA: '#3E6E8C', shiftB: '#C9A15B' }, avoid: [],
    lines: [{ i: 0, arrange, arrive: 'stubFade', depart: '', dwell: '' }] };
}
const LOOKS_ANSWER = { topic: '朝', season: 'any', proposals: [
  proposal('A', 'sumiWashi', 'quietHush', 'stubBlock'), proposal('B', 'stubInk', 'stubBright', 'centerAnchor'),
  proposal('C', 'sumiWashi', 'stubBright', 'stubBlock')] };

// ---- pure helpers ------------------------------------------------------------------------------------------------------

test('settings: Gemini and gemini-3.8-flash by default; broken or unknown values fall back', () => {
  const s = AC.readSettings(null);
  assert.equal(s.provider, 'gemini');
  assert.equal(s.models.gemini, 'gemini-3.8-flash');
  assert.equal(s.remember, false);
  const local = memoryStorage();
  local.setItem(AC.SETTINGS_KEY, '{not json');
  assert.equal(AC.readSettings(local).provider, 'gemini');
  local.setItem(AC.SETTINGS_KEY, JSON.stringify({ provider: 'nope', models: { gemini: 'gpt', claude: 'claude-haiku-4-5' }, remember: true }));
  const r = AC.readSettings(local);
  assert.deepEqual([r.provider, r.models.gemini, r.models.claude, r.remember], ['gemini', 'gemini-3.8-flash', 'claude-haiku-4-5', true]);
  assert.equal(AC.readSettings(memoryStorage(true)).provider, 'gemini', 'a blocked storage gives the defaults');
});

test('keys: sessionStorage by default, localStorage when remembered, never both; forget clears both', () => {
  const session = memoryStorage();
  const local = memoryStorage();
  const keys = AC.createKeyStore(session, local);
  keys.save('gemini', KEY, false, null);
  assert.equal(session.getItem('mojipv.ai.key.gemini'), KEY);
  assert.equal(local.getItem('mojipv.ai.key.gemini'), null);
  assert.deepEqual(keys.load('gemini'), { key: KEY, remembered: false, ok: null });
  keys.save('gemini', KEY, true, 'gemini-3.8-flash');
  assert.equal(session.getItem('mojipv.ai.key.gemini'), null, 'moved out of the session store');
  assert.deepEqual(keys.load('gemini'), { key: KEY, remembered: true, ok: 'gemini-3.8-flash' });
  keys.clear('gemini');
  assert.deepEqual([...session.keys(), ...local.keys()], []);
  const blocked = AC.createKeyStore(memoryStorage(true), memoryStorage(true));
  blocked.save('gemini', KEY, true, null);
  assert.deepEqual(blocked.load('gemini'), { key: '', remembered: false, ok: null }, 'no storage: nothing kept, nothing thrown');
});

test('key states and error codes map to the card states of §6.4.10.1', () => {
  assert.equal(AC.keyStatus('gemini', '', null, 'gemini-3.8-flash'), 'unset');
  assert.equal(AC.keyStatus('gemini', 'hello', null, 'gemini-3.8-flash'), 'shape');
  assert.equal(AC.keyStatus('gemini', KEY, null, 'gemini-3.8-flash'), 'set');
  assert.equal(AC.keyStatus('gemini', KEY, 'gemini-3.8-flash', 'gemini-3.8-flash'), 'ok');
  assert.equal(AC.keyStatus('claude', 'sk-ant-' + 'a'.repeat(30), 'claude-opus-5', 'claude-haiku-4-5'), 'set', 'confirmed for another model');
  assert.deepEqual(['auth', 'model', 'network', 'server', 'rate', 'aborted'].map(AC.statusOfError), ['bad', 'model', 'offline', 'offline', null, null]);
  const t = T.createT('ja', STRINGS, reg, { strict: true });
  for (const s of ['unset', 'shape', 'set', 'checking', 'ok', 'bad', 'model', 'offline']) assert.ok(t('ai.key.' + s));
  for (const code of PR.ERROR_CODES) assert.ok(STRINGS['err.ai.' + code], 'err.ai.' + code + ' has a message');
});

// The i18n static scan sees literal t('…') calls only. The AI modules also hand keys around as data (change labels,
// warnings, disabled reasons) and the panel builds keys from lists; every one of them must be in the table.
const KEY_LITERAL = /'((?:ai|err\.ai|songSec|fld|kind)\.[A-Za-z0-9_.]*)'/g;
const NOT_KEYS = ['ai.tool'];                // the app bus event that opens the AI tab at a tool
function aiSources() {
  return listSources().filter((rel) => rel.startsWith('ai/') || /^ui\/ai_[a-z_]+\.js$/.test(rel))
    .map((rel) => ({ rel, text: fs.readFileSync(path.join(SRC, rel), 'utf8') }));
}

test('every key the AI modules and the AI panel use exists: ai.ch.*, ai.warn.* and the computed families', () => {
  const families = {
    'ai.ch.': CH.KINDS.filter((k) => !['flash', 'impact', 'rows'].includes(k)),
    'ai.ch.flash.': ['on', 'off'], 'ai.ch.impact.': ['on', 'off'], 'ai.ch.rows.': ['replace', 'append'],
    'ai.key.': ['unset', 'shape', 'set', 'checking', 'ok', 'bad', 'model', 'offline'],
    'ai.guide.': AC.GUIDE_TOPICS, 'ai.tool.': AC.TOOLS, 'ai.name.': AC.TOOLS, 'ai.stage.': AC.STAGES,
    'ai.group.': AC.GROUP_ORDER, 'songSec.': SONG.SECTION_KINDS, 'fld.season.': LOOKS.SEASON_ENUM,
    'fld.amount.': LOOKS.AI_AMOUNTS, 'kind.': REG.PART_KINDS,
  };
  const sources = aiSources();
  assert.ok(sources.length >= 10, 'ai/* and ui/ai_* are scanned');
  const missing = [];
  const prefixes = new Set();
  for (const { rel, text } of sources) {
    for (const m of text.matchAll(KEY_LITERAL)) {
      const key = m[1];
      if (key.endsWith('.')) prefixes.add(key);
      else if (!NOT_KEYS.includes(key) && !(key in STRINGS)) missing.push(rel + ': ' + key);
    }
  }
  assert.ok(prefixes.has('ai.ch.') && prefixes.has('ai.stage.'), 'the scan sees the computed keys');
  for (const prefix of prefixes) {
    assert.ok(families[prefix], 'a computed key family this test does not know yet: ' + prefix + '… (add its members here)');
  }
  for (const [prefix, members] of Object.entries(families)) {
    for (const k of members) if (!((prefix + k) in STRINGS)) missing.push('family: ' + prefix + k);
  }
  assert.deepEqual(missing, []);
  // Each change kind has its row label, and the lists the families come from cover what the modules produce.
  for (const kind of CH.KINDS) {
    assert.ok(('ai.ch.' + kind) in STRINGS || Object.keys(STRINGS).some((k) => k.startsWith('ai.ch.' + kind + '.')), kind);
  }
  assert.deepEqual(Object.keys(CH.GROUPS).filter((g) => !AC.GROUP_ORDER.includes(g)), [], 'every change group has a heading');
  const stages = new Set();
  for (const { text } of sources) for (const m of text.matchAll(/(?:onStage|setStage)\((?:id, )?'([a-z]+)'\)/g)) stages.add(m[1]);
  assert.ok(stages.has('upload') && stages.has('think'));
  assert.deepEqual([...stages].filter((st) => !AC.STAGES.includes(st)), [], 'every running stage has a label');
});

test('cost line: token counts with separators and USD in both languages (§10.3)', () => {
  const ja = T.createT('ja', STRINGS, reg, { strict: true });
  const en = T.createT('en', STRINGS, reg, { strict: true });
  const usage = { input: 3210, output: 850 };
  const usd = PR.costUSD('gemini', 'gemini-3.8-flash', usage);
  assert.equal(AC.costText(ja, 'gemini', 'gemini-3.8-flash', usage), '入力 3,210 / 出力 850 トークン · 約 ' + T.fmtMoney(usd, 'ja'));
  assert.equal(AC.costText(en, 'gemini', 'gemini-3.8-flash', usage), '3,210 input / 850 output tokens · about ' + T.fmtMoney(usd, 'en'));
  assert.equal(AC.costText(en, 'gemini', 'unknown-model', usage), '3,210 input / 850 output tokens');
  assert.equal(AC.costText(en, 'gemini', 'gemini-3.8-flash', null), '');
});

test('the consent card states the size ai/song will really send', () => {
  for (const [seconds, rate] of [[3.2, 44100], [222.4, 48000], [600, 48000], [1500, 22050]]) {
    const length = Math.round(seconds * rate);
    const buf = { numberOfChannels: 1, sampleRate: rate, length, duration: length / rate,
      getChannelData: () => new Float32Array(length) };
    const facts = AC.consentFacts(buf);
    assert.equal(facts.mb, SONG.audioSize(SONG.audioFromBuffer(buf)).mb, seconds + ' s');
    assert.equal(facts.rate, SONG.pickRate(buf.duration));
  }
  assert.equal(AC.consentFacts({ length: 222.4 * 48000, sampleRate: 48000, duration: 222.4 }).dur, '3:42');
  // a long song goes at a lower rate, and the card says so (§4.22.6)
  const ja = T.createT('ja', STRINGS, reg, { strict: true });
  const en = T.createT('en', STRINGS, reg, { strict: true });
  for (const [minutes, khz] of [[3, 16], [8, 12], [12, 8]]) {
    const secs = minutes * 60;
    const facts = AC.consentFacts({ length: secs * 44100, sampleRate: 44100, duration: secs });
    assert.equal(facts.rate, SONG.pickRate(secs));
    assert.equal(facts.khz, khz, minutes + ' min');
    const p = { khz: facts.khz, mb: facts.mb, dur: facts.dur };
    assert.ok(ja('ai.consent', p).startsWith('曲の音声を ' + khz + 'kHz モノラル'), ja('ai.consent', p));
    assert.ok(en('ai.consent', p).includes(' ' + khz + ' kHz mono'), en('ai.consent', p));
  }
});

test('selected lines, checks, groups and the log cap', () => {
  const host = makeHost();
  const plan = host.plan;
  const [a, b] = plan.lines.map((l) => l.id);
  assert.deepEqual(AC.selectedLines({ level: 'work' }, plan), []);
  assert.deepEqual(AC.selectedLines({ level: 'line', ids: [a, b] }, plan), [a, b]);
  assert.deepEqual(AC.selectedLines({ level: 'cut', key: plan.lines[1].cuts[0] }, plan), [b]);
  assert.deepEqual(AC.selectedLines({ level: 'el', scope: 'line/' + a, el: 'text' }, plan), [a]);
  const list = [{ id: 'x', kind: 'theme', checked: true }, { id: 'y', kind: 'part', checked: false, stale: true },
    { id: 'z', kind: 'time', checked: true }, { id: 'w', kind: 'cut', checked: true }];
  assert.deepEqual(AC.withAll(list, false).map((c) => c.checked), [false, false, false, false]);
  assert.deepEqual(AC.withAll(AC.withAll(list, false), true).map((c) => c.checked), [true, false, true, true], 'stale rows stay unchecked');
  assert.equal(AC.withChecked(list, 'y', true)[1].checked, true);
  assert.equal(AC.withChecked(list, 'x', true)[0], list[0], 'an unchanged row keeps its object');
  assert.deepEqual(AC.grouped(list).map((g) => [g.group, g.changes.map((c) => c.id)]), [['lyrics', ['w']], ['work', ['x']], ['lines', ['y']], ['time', ['z']]]);
  assert.deepEqual(AC.counts(list), { total: 4, checked: 3, stale: 1 });
  let side = D.defaultSide();
  for (let i = 0; i < AC.LOG_CAP + 5; i++) side = AC.withLog(side, { runId: 'r' + i, applied: [] });
  assert.equal(side.aiLog.length, AC.LOG_CAP);
  assert.equal(side.aiLog[0].runId, 'r5', 'the oldest entries go first');
});

test('textDiff: marks only what changed, never splits a surrogate pair, and rebuilds both texts', () => {
  const d = AR.textDiff('夜明けの街を走る', '夜明けの/*街*を走る');
  assert.deepEqual(d, [{ kind: 'same', text: '夜明けの' }, { kind: 'ins', text: '/*' }, { kind: 'same', text: '街' },
    { kind: 'ins', text: '*' }, { kind: 'same', text: 'を走る' }]);
  assert.deepEqual(AR.textDiff('a😀b', 'a😃b'), [{ kind: 'same', text: 'a' }, { kind: 'del', text: '😀' }, { kind: 'ins', text: '😃' },
    { kind: 'same', text: 'b' }]);
  assert.deepEqual(AR.textDiff('abc', ''), [{ kind: 'del', text: 'abc' }]);
  let x = 7;
  const rnd = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const chars = 'あいう/*|!ab ';
  for (let k = 0; k < 300; k++) {
    const s = () => Array.from({ length: Math.floor(rnd() * 30) }, () => chars[Math.floor(rnd() * chars.length)]).join('');
    const a = s(), b = s();
    const parts = AR.textDiff(a, b);
    assert.equal(parts.filter((p) => p.kind !== 'ins').map((p) => p.text).join(''), a);
    assert.equal(parts.filter((p) => p.kind !== 'del').map((p) => p.text).join(''), b);
  }
});

// ---- the controller ----------------------------------------------------------------------------------------------------

test('key check: free model-info request, key only in the header; the result is remembered with the model', async () => {
  const { ctl, seen, session } = setup([], {});
  assert.equal(ctl.state.keyStatus, 'set');
  assert.equal(await ctl.checkKey(), true);
  assert.equal(ctl.state.keyStatus, 'ok');
  assert.equal(ctl.state.keyName, 'Gemini 3.8 Flash');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.method, 'GET');
  assert.ok(!seen[0].url.includes(KEY), 'the key is never in the URL');
  assert.equal(seen[0].init.headers['x-goog-api-key'], KEY);
  assert.equal(session.getItem('mojipv.ai.ok.gemini'), 'gemini-3.8-flash');
  ctl.setKey('AIza-wrong');
  assert.equal(ctl.state.keyStatus, 'shape');
  assert.equal(session.getItem('mojipv.ai.ok.gemini'), null, 'a new key is not confirmed');
  ctl.forgetKey();
  assert.equal(ctl.state.keyStatus, 'unset');
  assert.equal(session.getItem('mojipv.ai.key.gemini'), null);
});

test('key check: a refused key reads キーが違います; remembering moves the key to localStorage', async () => {
  const seen = [];
  const host = makeHost();
  const session = memoryStorage();
  const local = memoryStorage();
  session.setItem('mojipv.ai.key.gemini', KEY);
  const ctl = AC.createController(host, { session, local, fetchImpl: async (url, init) => {
    seen.push(url);
    return { ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid ' + KEY, details: [{ reason: 'API_KEY_INVALID' }] } }) };
  } });
  assert.equal(await ctl.checkKey(), false);
  assert.equal(ctl.state.keyStatus, 'bad');
  assert.equal(ctl.state.keyError, 'auth');
  ctl.setRemember(true);
  assert.equal(local.getItem('mojipv.ai.key.gemini'), KEY);
  assert.equal(session.getItem('mojipv.ai.key.gemini'), null);
  assert.equal(JSON.parse(local.getItem(AC.SETTINGS_KEY)).remember, true);
  const again = AC.createController(makeHost(), { session: memoryStorage(), local });
  assert.equal(again.state.key, KEY, 'a remembered key is there after a reload');
  assert.equal(again.state.remember, true);
});

test('without a key nothing is sent and the tools say why', async () => {
  const { ctl, seen } = setup([PREP_ANSWER], { key: false });
  assert.equal(ctl.blocked('prep'), 'ai.needKey');
  assert.equal(await ctl.run('prep'), false);
  assert.equal(ctl.state.error.code, 'no_key');
  assert.equal(seen.length, 0);
});

test('prep: a checked review, nothing applied before [反映]; apply = one undo step + a log entry; selective revert', async () => {
  const { host, ctl, seen } = setup([PREP_ANSWER]);
  const doc0 = host.doc;
  const entries0 = host.store.list().length;
  assert.equal(await ctl.run('prep'), true);
  const body = seen[0].body;
  assert.equal(seen[0].init.headers['x-goog-api-key'], KEY);
  assert.equal(body.contents[0].parts.length, 1, 'text tools send no audio part');
  assert.ok(body.contents[0].parts[0].text.includes('夜明けの街を走る'), 'the lyric text is sent');
  const r = ctl.state.review;
  assert.equal(r.kind, 'list');
  assertTexts(r);
  assert.equal(host.log.review, true, 'the review is open (詳細 disabled)');
  assert.equal(host.doc, doc0, 'nothing is applied before the review');
  assert.deepEqual(r.changes.map((c) => c.kind).sort(), ['cut', 'emphasis', 'remove']);
  assert.equal(ctl.state.keyStatus, 'ok', 'a successful call confirms the key');
  assert.equal(ctl.blocked('looks'), 'ai.needReview');
  // uncheck the emphasis, apply the rest
  const emph = r.changes.find((c) => c.kind === 'emphasis');
  ctl.toggle(emph.id, false);
  assert.equal(ctl.apply(), 2);
  assert.equal(host.log.review, false);
  assert.equal(ctl.state.review, null);
  assert.equal(host.store.list().length, entries0 + 1, 'one undo entry');
  assert.deepEqual(host.store.peek().undo, ['undo.ai', { tool: '下ごしらえ', n: 2 }]);
  assert.equal(host.doc.sheet.rows.map((x) => x.src).join('\n'), '夜明けの/街を走る\n君の名前を呼ぶ');
  assert.equal(host.side.aiLog.length, 1);
  assert.equal(host.side.aiLog[0].tool, 'prep');
  assert.equal(host.side.aiLog[0].at, 1700000000000);
  // one whole-sheet item (a row was removed), shared by both changes
  assert.deepEqual(host.side.aiLog[0].groups, [[0], [0]]);
  // selective revert, counted in the log's unit (the 2 changes applied): a later edit of the text keeps both
  host.store.dispatch({ t: 'lyrics.row', rowId: host.doc.sheet.rows[1].id, src: '君の名前を呼ぶ声' });
  const res = ctl.revert(host.side.aiLog[0].runId);
  assert.deepEqual(res, { n: 0, kept: 2 }, 'the lyric box changed since, so it cannot be reverted');
  host.store.undo();                      // the later edit
  const res2 = ctl.revert(host.side.aiLog[0].runId);
  assert.deepEqual(res2, { n: 2, kept: 0 });
  assert.equal(host.doc.sheet.rows.map((x) => x.src).join('\n'), LYRICS);
  assert.equal(AC.revertable(host.doc, host.side.aiLog[0]), false);
  host.store.undo();
  host.store.undo();
  assert.deepEqual(host.doc, doc0, 'undo returns to the start');
});

test('looks: three proposals, try-on renders without committing and follows the checks, この案にする applies one', async () => {
  const { host, ctl } = setup([LOOKS_ANSWER]);
  const doc0 = host.doc;
  assert.equal(await ctl.run('looks'), true);
  const r = ctl.state.review;
  assert.equal(r.kind, 'looks');
  assertTexts(r);
  assert.equal(r.proposals.length, 3);
  assert.equal(r.topic, '朝');
  ctl.tryOn(1);
  assert.equal(host.log.alt.badge, '試写: 案B');
  assert.equal(host.log.alt.doc.pins['work:theme'].v, 'stubInk');
  assert.equal(host.doc, doc0, 'try-on commits nothing');
  assert.deepEqual(ctl.strip().actions.map((a) => a.label), ['この案にする', 'やめる']);
  assert.equal(ctl.strip().text, '案Bを試写中');
  const theme = r.proposals[1].changes.find((c) => c.kind === 'theme');
  ctl.toggle(theme.id, false, 1);
  assert.equal(host.log.alt.doc.pins['work:theme'], undefined, 'the try-on follows the checks');
  assert.equal(ctl.state.review.proposals[0].changes.every((c) => c.checked), true, 'other proposals keep their checks');
  ctl.tryOnReplaced({ other: true });
  assert.equal(ctl.state.tryOn, null, 'another try-on ends ours');
  ctl.tryOn(0);
  const n = ctl.apply(0);
  assert.ok(n > 0);
  assert.equal(host.log.alt, null, 'applying ends the try-on');
  assert.equal(host.doc.pins['work:theme'].v, 'sumiWashi');
  assert.equal(host.doc.pins['work:theme'].by, 'ai');
  assert.deepEqual(host.store.peek().undo, ['undo.ai', { tool: '演出3案', n }]);
  assert.equal(AC.aiPinCount(host.doc) > 0, true);
  assert.equal(ctl.clearAiPins(), true);
  assert.equal(AC.aiPinCount(host.doc), 0, 'すべて自動に戻す');
  host.store.undo();
  host.store.undo();
  assert.deepEqual(host.doc, doc0);
});

test('[元に戻す] counts the changes the user accepted, like the log entry (a palette is one change, not three pins)', async () => {
  const { host, ctl } = setup([LOOKS_ANSWER]);
  await ctl.run('looks');
  const n = ctl.apply(0);
  const entry = host.side.aiLog[0];
  assert.equal(entry.n, n);
  assert.ok(entry.applied.length > n, 'the palette gives three log items');
  assert.equal(entry.groups.length, n, 'one group per applied change');
  assert.ok(entry.groups.some((g) => g.length === 3), 'the palette change owns its three items');
  assert.deepEqual(entry.groups.flat().sort((a, b) => a - b), entry.applied.map((x, i) => i), 'every item belongs to one change');
  host.store.dispatch({ t: 'pin.set', path: 'work:color.accent', v: '#123456', by: 'user' });
  const res = ctl.revert(entry.runId);
  assert.deepEqual(res, { n: n - 1, kept: 1 }, 'reverted + kept = the changes in the log');
  const toast = host.log.toasts[host.log.toasts.length - 1].text;
  assert.equal(toast, 'AIの変更を戻しました（' + (n - 1) + '件）\n1件は後で変更されたので戻せません');
  assert.equal(host.doc.pins['work:color.accent'].v, '#123456', 'the later pin stays');
  assert.equal(host.doc.pins['work:color.shiftA'], undefined, 'the rest of the palette goes back');
  assert.equal(host.doc.pins['work:theme'], undefined);
  // an entry saved before groups existed still reverts, counting its items
  const legacy = { runId: 'old', tool: 'looks', n: 1, applied: [{ path: 'work:mood', to: 'stubBright', prev: null }] };
  host.store.dispatch({ t: 'pin.set', path: 'work:mood', v: 'stubBright', by: 'ai' });
  assert.deepEqual(AC.revertTally(host.doc, legacy, 0), { n: 1, kept: 0 });
  assert.deepEqual(AC.revertTally(host.doc, Object.assign({}, legacy, { groups: [[7]] }), 0), { n: 1, kept: 0 }, 'bad groups are ignored');
});

test('the try-on strip offers [この案にする] only with something checked; nothing to apply keeps the review', async () => {
  const { host, ctl } = setup([LOOKS_ANSWER]);
  await ctl.run('looks');
  const entries0 = host.store.list().length;
  ctl.tryOn(0);
  ctl.toggleAll(false, 0);
  assert.deepEqual(ctl.strip().actions.map((a) => a.label), ['やめる'], 'only [やめる] with nothing checked');
  assert.equal(ctl.apply(0), 0);
  assert.ok(ctl.state.review, 'the three looks are still there');
  assert.equal(host.log.review, true);
  assert.equal(host.log.toasts[host.log.toasts.length - 1].text, '反映できる変更はありませんでした');
  assert.equal(host.store.list().length, entries0, 'nothing dispatched');
  ctl.toggleAll(true, 0);
  assert.deepEqual(ctl.strip().actions.map((a) => a.label), ['この案にする', 'やめる']);
  ctl.endTryOn();
  const list = setup([PREP_ANSWER]);
  await list.ctl.run('prep');
  list.ctl.tryOn(-1);
  assert.deepEqual(list.ctl.strip().actions.map((a) => a.label), ['反映する', 'やめる']);
  list.ctl.toggleAll(false);
  assert.deepEqual(list.ctl.strip().actions.map((a) => a.label), ['やめる']);
});

test('a batch the store refuses brings the review back', async () => {
  const { host, ctl } = setup([PREP_ANSWER], { host: { batch: () => {} } });
  await ctl.run('prep');
  const review = ctl.state.review;
  assert.equal(ctl.apply(), 0);
  assert.equal(ctl.state.review.id, review.id, 'the same review is open again');
  assert.equal(host.log.review, true);
  assert.equal(host.side.aiLog.length, 0, 'nothing is logged');
});

test('rows whose target changed since the request become stale and unchecked; a re-check still applies', async () => {
  const { host, ctl } = setup([LOOKS_ANSWER]);
  await ctl.run('looks');
  host.store.dispatch({ t: 'pin.set', path: 'work:theme', v: 'stubInk', by: 'user' });
  ctl.docChanged();
  assertTexts(ctl.state.review);
  const theme = ctl.state.review.proposals[0].changes.find((c) => c.kind === 'theme');
  assert.equal(theme.stale, true);
  assert.equal(theme.checked, false);
  const mood = ctl.state.review.proposals[0].changes.find((c) => c.kind === 'mood');
  assert.equal(mood.stale, false, 'other rows are untouched');
  ctl.toggle(theme.id, true, 0);
  ctl.apply(0);
  assert.equal(host.doc.pins['work:theme'].v, 'sumiWashi');
});

test('ひとこと修正: understood = false shows the question inline and opens no review; the selected lines are sent', async () => {
  const { host, ctl, seen } = setup([{ understood: false, summary: '', question: 'どの行ですか？', changes: {
    theme: '', mood: '', season: '', amounts: KEEP, flash: 'keep', palette: { accent: '', shiftA: '', shiftB: '' }, avoid: [], allow: [], lines: [] } }]);
  const id = host.plan.lines[2].id;
  assert.equal(await ctl.run('edit', { instruction: 'もっと派手に', lineIds: [id] }), true);
  assert.equal(ctl.state.review, null);
  assert.equal(host.log.review, false);
  assert.deepEqual([ctl.state.notice.kind, ctl.state.notice.text], ['question', 'どの行ですか？']);
  const prompt = seen[0].body.contents[0].parts[0].text;
  assert.ok(prompt.includes('Instruction: もっと派手に'));
  assert.ok(prompt.includes('The user selected lines 2'), 'the selected line is named');
  assert.equal(await ctl.run('edit', { instruction: '   ' }), false, 'an empty instruction is not sent');
  assert.equal(seen.length, 1);
});

test('abort: [中止] cancels the request and reports it; the next run works', async () => {
  const hang = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => { const e = new Error('stopped'); e.name = 'AbortError'; reject(e); });
  });
  const { ctl } = setup([hang, PREP_ANSWER]);
  const pending = ctl.run('prep');
  await Promise.resolve();
  assert.equal(ctl.state.run.tool, 'prep');
  assert.equal(ctl.state.run.stage, 'think');
  ctl.abort();
  assert.equal(ctl.state.run, null);
  assert.equal(ctl.state.error.code, 'aborted');
  assert.equal(await pending, false);
  assert.equal(ctl.state.review, null);
  assert.equal(await ctl.run('prep'), true);
});

test('errors map to codes; an auth error marks the key; the key never shows in a message', async () => {
  const fail = async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'denied for ' + KEY } }) });
  const { ctl } = setup([fail]);
  assert.equal(await ctl.run('prep'), false);
  assert.equal(ctl.state.error.code, 'auth');
  assert.equal(ctl.state.keyStatus, 'bad');
  assert.ok(!JSON.stringify(ctl.state).includes('denied for ' + KEY));
});

function songBuffer(seconds, rate) {
  const length = Math.round(seconds * rate);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = Math.sin(i / 7) * 0.3;
  return { numberOfChannels: 1, sampleRate: rate, length, duration: length / rate, getChannelData: () => data };
}

function withSong(host, linked) {
  host.store.dispatch({ t: 'song.set', song: { name: 'a.wav', sha1: 'abc123', seconds: 12 } });
  const buffer = songBuffer(12, 8000);
  host.song = () => (host.doc.song ? { sha1: host.doc.song.sha1, seconds: 12, buffer: linked === false ? null : buffer } : null);
  return host;
}

test('曲を使う: Gemini + a song + consent for this project; audio only then; stages; align gives time pins by ai', async () => {
  const stages = [];
  const { host, ctl, seen } = setup([{ note: '', lines: [{ i: 0, start: '0:02.00' }, { i: 2, start: '0:07.50' }] }]);
  assert.equal(ctl.blocked('align'), 'ai.song.noSong');
  withSong(host, false);
  assert.equal(ctl.blocked('align'), 'ai.song.notLinked');
  withSong(host, true);
  assert.equal(ctl.blocked('align'), 'ai.song.needConsent');
  assert.equal(await ctl.run('align'), false);
  assert.equal(seen.length, 0, 'no audio before consent');
  ctl.consent(true);
  assert.equal(ctl.hasConsent(), true);
  assert.equal(ctl.blocked('align'), null);
  ctl.on((st) => { if (st.run) stages.push(st.run.stage); });
  assert.equal(await ctl.run('align'), true);
  assert.deepEqual([...new Set(stages)], ['prepare', 'think']);
  const parts = seen[0].body.contents[0].parts;
  assert.equal(parts[0].inlineData.mimeType, 'audio/wav', 'the audio part comes before the prompt');
  const r = ctl.state.review;
  assertTexts(r);
  assert.deepEqual(r.changes.map((c) => [c.kind, c.to]), [['time', 2], ['time', 7.5]]);
  ctl.apply();
  const pin = host.doc.pins['line/' + host.plan.lines[0].id + ':start'];
  assert.deepEqual([pin.v, pin.by], [2, 'ai']);
  ctl.projectChanged();
  assert.equal(ctl.hasConsent(), false, 'consent is for this project only');
});

test('曲を使う is Gemini only', () => {
  const { host, ctl } = setup([]);
  withSong(host, true);
  ctl.setProvider('claude');
  assert.equal(ctl.state.provider, 'claude');
  assert.equal(ctl.state.model, 'claude-opus-5');
  assert.equal(ctl.songBlocked(), 'ai.song.onlyGemini');
  ctl.setProvider('gemini');
  assert.equal(ctl.state.key, KEY, 'each service keeps its own key');
});

test('transcript: [置き換える] and [後ろに足す] are one undo step each; analysis: [保存する] keeps song.info', async () => {
  const { host, ctl } = setup([
    { language: 'ja', note: '', lines: [{ start: '0:01.00', text: 'あたらしい歌' }, { start: '0:04.00', text: 'つづきの歌' }] },
    { summary: '明るい', mood: '軽快', bpm: 120, sections: [{ kind: 'chorus', start: '0:00', end: '0:10' }],
      highlights: [{ time: '0:05', what: 'サビ' }] },
  ]);
  withSong(host, true);
  ctl.consent(true);
  assert.equal(await ctl.run('transcribe'), true);
  assert.equal(ctl.state.review.kind, 'transcript');
  ctl.setTranscriptTimes(false);
  ctl.applyTranscript('append');
  assert.equal(host.doc.sheet.rows.map((r) => r.src).join('\n'), LYRICS + '\n\nあたらしい歌\nつづきの歌');
  assert.deepEqual(host.store.peek().undo, ['undo.ai', { tool: '書き起こし', n: 2 }]);
  assert.equal(await ctl.run('analyze'), true);
  assert.equal(ctl.state.review.kind, 'analysis');
  assertTexts(ctl.state.review);
  assert.equal(ctl.state.review.info.bpm, 120);
  ctl.apply();
  assert.equal(host.doc.song.info.sections[0].kind, 'chorus');
  assert.equal(host.log.toasts[host.log.toasts.length - 1].text, '曲の分析を保存しました');
});

test('a new project drops the review, the try-on and the consent', async () => {
  const { host, ctl } = setup([LOOKS_ANSWER]);
  withSong(host, true);
  ctl.consent(true);
  await ctl.run('looks');
  ctl.tryOn(2);
  ctl.projectChanged();
  assert.equal(ctl.state.review, null);
  assert.equal(ctl.state.tryOn, null);
  assert.equal(host.log.alt, null);
  assert.equal(host.log.review, false);
  assert.equal(ctl.hasConsent(), false);
});

test('an edit that ends the try-on on the stage is noticed on the next document change', async () => {
  const { host, ctl } = setup([LOOKS_ANSWER]);
  await ctl.run('looks');
  ctl.tryOn(0);
  host.log.alt = null;                       // what boot's replan does to the stage
  host.store.dispatch({ t: 'look.set', key: 'aspect', v: '9:16' });
  ctl.docChanged();
  assert.equal(ctl.state.tryOn, null);
  assert.equal(ctl.strip(), null);
});
