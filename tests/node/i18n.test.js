/* 文字PVメーカー v2 — original work. Tests for the string table and i18n/t (DESIGN §4.24, §6.13, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load, listSources, SRC } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const T = MV.use('i18n/t');
const STRINGS = MV.use('i18n/strings');

// Japanese scripts and CJK punctuation / full-width forms. The en page may show only the product name and user data.
const JAPANESE = /[　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿＀-￯]/;
const EN_ALLOW = ['文字PVメーカー'];

// Codes other packages report through the table (DESIGN §3.13, §4.16.8, §4.22.1, §4.4).
const WHY_CODES = ['mood.tag', 'fit', 'recent', 'family', 'echo', 'impact', 'season', 'theme.prefer', 'gate', 'rule', 'pin', 'lock'];
// §3.13 codes, plus `part-error` (reported by the scene and the renderer, WP4a).
const WARN_CODES = ['pin-bad-value', 'pin-not-applicable', 'pin-filtered', 'pin-off-season', 'orphan-pin', 'shadowed-pin',
  'lock-partial', 'pool-empty', 'time-order', 'time-compressed', 'title-skipped', 'overfull', 'font-fallback', 'piece-merged',
  'part-error'];
// §4.22.1 codes; ai/providers.ERROR_CODES adds its own (e.g. `recitation`, WP7), read at test time so new ones are caught.
const AI_ERRORS = [...new Set(['no_key', 'auth', 'rate', 'model', 'server', 'bad_request', 'network', 'aborted', 'blocked',
  'truncated', 'empty', 'bad_json', 'no_sdk', 'no_audio', 'upload', 'bad_provider', 'bad_edit'].concat(MV.use('ai/providers').ERROR_CODES))];
const FILE_ERRORS = ['bad-json', 'not-a-project', 'newer', 'invalid'];
// The sample keys of §6.13.
const SPEC_KEYS = ['app.name', 'hdr.untitled', 'hdr.saved', 'hdr.undo', 'step.lyrics', 'step.song', 'step.look', 'step.export',
  'step.next', 'lyr.placeholder', 'lyr.sample', 'lyr.syntax', 'lyr.aiTidy', 'song.none', 'look.hint', 'play.omakase',
  'play.histPos', 'crumb.work', 'crumb.line', 'crumb.cut', 'el.text', 'el.ornament', 'el.ground', 'el.lens', 'el.filter',
  'el.seam', 'state.auto', 'state.pinned', 'state.pinnedLine', 'state.pinnedWork', 'state.ai', 'state.locked', 'state.mark',
  'state.derived', 'state.inactive', 'state.mixed', 'act.unpin', 'act.reroll', 'act.lock', 'act.unlock', 'act.promote',
  'why.mood.tag', 'why.recent', 'why.impact', 'why.season', 'undo.ai', 'tap.done', 'exp.snapshot', 'ai.sends', 'ai.consent',
  'ai.stale', 'err.ai.auth', 'err.ai.rate', 'err.ai.truncated', 'toast.kept', 'empty.preview', 'a11y.preview'];

function withoutAllowed(text) {
  let out = text;
  for (const a of EN_ALLOW) out = out.split(a).join('');
  return out;
}

test('every entry is a [ja, en] pair of non-empty strings', () => {
  for (const [key, pair] of Object.entries(STRINGS)) {
    assert.ok(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_-]+)+$/.test(key), 'key shape: ' + key);
    assert.ok(Array.isArray(pair) && pair.length === 2, key);
    assert.ok(typeof pair[0] === 'string' && pair[0].trim() !== '', key + ' ja');
    assert.ok(typeof pair[1] === 'string' && pair[1].trim() !== '', key + ' en');
  }
});

test('ja and en use the same placeholders', () => {
  for (const [key, [ja, en]] of Object.entries(STRINGS)) {
    assert.deepEqual([...T.placeholders(en)].sort(), [...T.placeholders(ja)].sort(), key);
  }
});

test('English texts contain no Japanese (except the product name)', () => {
  for (const [key, [, en]] of Object.entries(STRINGS)) {
    assert.ok(!JAPANESE.test(withoutAllowed(en)), key + ': ' + en);
  }
});

test('the §6.13 keys and every reported code have strings', () => {
  const missing = [];
  const need = SPEC_KEYS.concat(WHY_CODES.map((c) => 'why.' + c), WARN_CODES.map((c) => 'warn.' + c),
    AI_ERRORS.map((c) => 'err.ai.' + c), FILE_ERRORS.map((c) => 'err.file.' + c), MV.use('core/registry').KINDS.map((k) => 'kind.' + k),
    ['boot.soon', 'undo.edit', 'look.first', 'look.omakase', 'count.lines']);
  for (const key of need) if (!(key in STRINGS)) missing.push(key);
  assert.deepEqual(missing, []);
  assert.deepEqual(STRINGS['app.name'], ['文字PVメーカー', 'Moji PV Maker']);
  assert.deepEqual(STRINGS['boot.soon'], ['準備中', 'Coming soon']);
});

// The catalog's parts, strictly once it validates; while other packages are still adding kinds, the parts that are
// valid so far (a lenient registry), so labels are checked from the first part on.
function catalogRegistry() {
  const catalog = MV.use('parts/catalog');
  try { return catalog.defaultRegistry(); } catch (e) {
    if (!e || e.name !== 'RegistryError') throw e;
    return catalog.defaultRegistry({ strict: false });
  }
}

test('every registry label and blurb exists in both languages; t.part reads them', () => {
  const registries = [['stub', corpus.stubRegistry(MV)]];
  if (MV.has('parts/catalog')) registries.push(['catalog', catalogRegistry()]);
  for (const [name, reg] of registries) {
    const ja = T.createT('ja', STRINGS, reg);
    const en = T.createT('en', STRINGS, reg);
    for (const def of reg.all()) {
      const where = name + ' ' + def.kind + '/' + def.key;
      assert.ok(def.label.ja && def.label.en, where);
      assert.ok(!JAPANESE.test(def.label.en), where + ' en label: ' + def.label.en);
      if (def.blurb) assert.ok(!JAPANESE.test(def.blurb.en), where + ' en blurb');
      assert.equal(ja.part(def.kind, def.key), def.label.ja);
      assert.equal(en.part(def.kind, def.key), def.label.en);
      for (const p of reg.params(def.kind, def.key)) {
        if (p.spec.label) assert.ok(!JAPANESE.test(p.spec.label.en), where + ' param ' + p.name);
      }
    }
  }
  assert.equal(T.createT('en', STRINGS).part('arrive', 'stubFade'), 'stubFade', 'without a registry: the key');
});

test('static scan: every t(\'…\') key used in src exists', () => {
  const used = new Map();
  // Only complete literal keys: t('a.b') or t('a.b', …); computed keys such as t('why.' + code) are not scanned.
  const call = /(?<![.\w$])t\(\s*(['"])([^'"\n]+)\1\s*[,)]/g;
  const helper = /(?<![\w$])t\.(why|err)\(\s*(['"])([^'"\n]+)\2\s*[,)]/g;
  for (const rel of listSources()) {
    const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
    for (const m of text.matchAll(call)) used.set(m[2], rel);
    for (const m of text.matchAll(helper)) used.set((m[1] === 'why' ? 'why.' : 'err.ai.') + m[3], rel);
  }
  assert.ok(used.size > 0, 'the scan finds t() calls');
  const missing = [...used].filter(([key]) => !(key in STRINGS)).map(([key, rel]) => rel + ': ' + key);
  assert.deepEqual(missing, []);
});

test('t: lookup, placeholders, plurals and fallbacks', () => {
  const table = {
    'a.hello': ['こんにちは {name}', 'Hello {name}'],
    'a.count': ['{n}件', '{n} item|{n} items'],
    'a.bar': ['|で区切る', 'split at | marks'],
    'a.escaped': ['{n}', '{n} a\\|b|{n} c'],
    'a.noEn': ['日本語だけ', ''],
    'why.fit': ['合う', 'fits'],
    'err.ai.rate': ['上限', 'limit'],
  };
  const ja = T.createT('ja', table, null, { strict: true });
  const en = T.createT('en', table, null, { strict: true });
  assert.equal(ja.lang, 'ja');
  assert.equal(en.lang, 'en');
  assert.equal(T.createT('ko', table).lang, 'ja', 'unknown UI languages use ja');
  assert.equal(ja('a.hello', { name: '世界' }), 'こんにちは 世界');
  assert.equal(en('a.hello', { name: 'you' }), 'Hello you');
  assert.equal(en('a.hello'), 'Hello {name}', 'missing params stay visible');
  assert.equal(en('a.count', { n: 1 }), '1 item');
  assert.equal(en('a.count', { n: 0 }), '0 items');
  assert.equal(en('a.count', { n: 5 }), '5 items');
  assert.equal(ja('a.count', { n: 5 }), '5件');
  assert.equal(en('a.bar'), 'split at | marks', 'without n a bar is literal');
  assert.equal(en('a.escaped', { n: 1 }), '1 a|b');
  assert.equal(en('a.escaped', { n: 2 }), '2 c');
  assert.equal(en('a.noEn'), '日本語だけ', 'an empty English text falls back to Japanese');
  assert.equal(en.why('fit'), 'fits');
  assert.equal(en.err('rate'), 'limit');
  assert.equal(en.label(['a.count', { n: 2 }]), '2 items');
  assert.equal(en.label('plain'), 'plain');
  assert.equal(en.has('a.bar'), true);
  assert.throws(() => en('a.missing'), (e) => e.code === 'missing-key');
  assert.equal(T.createT('en', table, null, { strict: false })('a.missing'), 'a.missing', 'production shows the key');
  assert.throws(() => T.createT('en', table)('a.missing'), (e) => e.code === 'missing-key', 'dev builds (MV.DEV) are strict');
});

test('t: only English texts have plural alternatives; ja texts with the | lyric mark stay whole', () => {
  const table = {
    'lyr.notes': ['{n}行に「|」のメモがあります', '{n} line has a \\| note|{n} lines have \\| notes'],
    'a.jaOnly': ['{n}個の「|」', ''],
  };
  const ja = T.createT('ja', table, null, { strict: true });
  const en = T.createT('en', table, null, { strict: true });
  assert.equal(ja('lyr.notes', { n: 3 }), '3行に「|」のメモがあります');
  assert.equal(ja('lyr.notes', { n: 1 }), '1行に「|」のメモがあります');
  assert.equal(ja('lyr.notes'), '{n}行に「|」のメモがあります');
  assert.equal(en('lyr.notes', { n: 1 }), '1 line has a | note');
  assert.equal(en('lyr.notes', { n: 4 }), '4 lines have | notes');
  assert.equal(en('a.jaOnly', { n: 2 }), '2個の「|」', 'the ja fallback of an empty en text is used as written');
  const jaAll = T.createT('ja', STRINGS, null, { strict: true });
  for (const [key, [jaText]] of Object.entries(STRINGS)) {
    if (jaText.includes('|')) assert.ok(jaAll(key, { n: 2 }).includes('|'), key + ': the bar is kept');
  }
});

test('fmtTime, fmtBytes and fmtMoney', () => {
  assert.equal(T.fmtTime(0), '0:00.00');
  assert.equal(T.fmtTime(83.456), '1:23.46');
  assert.equal(T.fmtTime(59.999), '1:00.00');
  assert.equal(T.fmtTime(-1.5), '-0:01.50');
  assert.equal(T.fmtTime(3725.1), '62:05.10');
  assert.equal(T.fmtTime(NaN), '0:00.00');
  assert.equal(T.fmtTime(61.5, { frames: true, fps: 30 }), '1:01:15');
  assert.equal(T.fmtTime(1 / 24 * 23, { frames: true, fps: 24 }), '0:00:23');
  assert.equal(T.fmtBytes(0), '0 B');
  assert.equal(T.fmtBytes(512), '512 B');
  assert.equal(T.fmtBytes(1536), '1.5 KB');
  assert.equal(T.fmtBytes(23 * 1024 * 1024), '23 MB');
  assert.equal(T.fmtBytes(1.25 * 1024 ** 3), '1.3 GB');
  assert.equal(T.fmtMoney(0, 'en'), '$0');
  assert.equal(T.fmtMoney(0.0042, 'en'), '$0.0042');
  assert.equal(T.fmtMoney(0.25, 'ja'), '$0.250', 'USD in both languages until a yen rate is decided');
  assert.equal(T.fmtMoney(12.5, 'en'), '$12.50');
  assert.equal(T.fmtMoney(0.25, 'ja', { yenPerUsd: 150 }), '¥38');
});

// --- WP8: keys the UI builds at run time (prefix + value) and label tuples ------------------------------------------

function uiSource(name) { return fs.readFileSync(path.join(SRC, 'ui', name), 'utf8'); }

test('UI keys built at run time exist for every value they can take', () => {
  const D = MV.use('core/doc');
  const want = [];
  const each = (prefix, values) => { for (const v of values) want.push(prefix + v); };
  each('step.short.', ['lyrics', 'song', 'look', 'export']);
  each('step.', ['lyrics', 'song', 'look', 'export']);
  each('lang.', D.LANGS.filter((l) => l !== 'auto'));
  each('exp.fmt.', ['mp4', 'png', 'pngAlpha']);
  each('exp.bg.', D.BACKDROPS);
  each('exp.q.', ['standard', 'high', 'max']);
  each('exp.range.', ['all', 'sel', 'io']);
  each('hdr.save.', ['saving', 'saved', 'failed', 'quota']);
  each('crumb.', ['work', 'line', 'lines', 'cut', 'title', 'intro', 'outro', 'gap', 'ornament', 'filter']);
  each('el.', MV.use('ui/selection').ELS);
  each('look.', ['first', 'omakase', 'reroll', 'rerollScope', 'dice']);
  each('state.', ['auto', 'pinned', 'mark', 'locked']);
  each('err.song.', ['decode', 'empty', 'unsupported', 'cancelled']);
  each('err.exp.', ['cancelled', 'encode', 'sink']);
  // INT-UI: backdrop rules and the UI's own pre-flight items, their fixes and the export error keys (ui/output).
  const OUT = MV.use('ui/output');
  each('insp.fxRule.', OUT.BACKDROPS.filter((b) => b !== 'scene'));
  want.push('exp.bg.clearPng', 'exp.pre.makeAlpha', 'exp.pre.makeClear', 'exp.pre.fix', ...Object.values(OUT.ERROR_KEYS));
  const output = fs.readFileSync(path.join(SRC, 'ui', 'output.js'), 'utf8');
  for (const m of output.matchAll(/out\.push\(\{\s*code:\s*'([a-z-]+)'/g)) want.push('exp.pre.' + m[1]);
  for (const k of ['syn.line', 'syn.blank', 'syn.cut', 'syn.emph', 'syn.impact', 'syn.note', 'syn.comment', 'syn.time', 'syn.meta']) {
    want.push(k, k + '.mark');
  }
  // Pre-flight codes reported by export/schedule (read from its source so new codes are caught).
  const schedule = fs.readFileSync(path.join(SRC, 'export', 'schedule.js'), 'utf8');
  for (const m of schedule.matchAll(/items\.push\(\{\s*code:\s*'([a-z-]+)'/g)) want.push('exp.pre.' + m[1]);
  want.push('exp.pre.memory.confirm', 'exp.pre.flash-fix', 'exp.pre.overfull', 'exp.pre.font-fallback');
  const missing = [...new Set(want)].filter((k) => !(k in STRINGS));
  assert.deepEqual(missing, []);
});

// Every key other packages asked for under a "## strings wanted" heading of NOTES.md (read at test time).
test('every key of every "## strings wanted" table in NOTES.md exists', () => {
  const notes = fs.readFileSync(path.join(SRC, '..', 'docs', 'NOTES.md'), 'utf8');
  const keys = [];
  for (const section of notes.split(/^## /m).filter((x) => x.startsWith('strings wanted'))) {
    for (const m of section.matchAll(/^\| `([a-z][A-Za-z0-9._-]+)` \|/gm)) keys.push(m[1]);
  }
  assert.ok(keys.length > 40, 'the tables are found (' + keys.length + ')');
  assert.deepEqual(keys.filter((k) => !(k in STRINGS)), []);
});

test('every action defined in ui/boot and every keymap command has a cmd.* label', () => {
  const boot = uiSource('boot.js');
  const ids = new Set([...boot.matchAll(/\bdef\(\s*'([a-z][A-Za-z.]*[A-Za-z])'\s*,/g)].map((m) => m[1]));
  for (const pref of ['singleKeys', 'autoFold', 'autoplay', 'ai']) ids.add('pref.' + pref);
  for (const b of MV.use('ui/keys').KEYMAP) if (b.cmd !== 'noop') ids.add(b.cmd);
  assert.ok(ids.size > 50, 'the scan finds the actions');
  const missing = [...ids].filter((id) => !(('cmd.' + id) in STRINGS));
  assert.deepEqual(missing, []);
});

// A label tuple is a key followed by a params object ([key, {…}]); a plain list of command names (['look.set', …])
// is not a label and must not be matched.
const LABEL_TUPLE = /\[\s*'((?:undo|look|crumb|el|hdr|state|toast|diff)\.[A-Za-z.]+)'\s*,\s*\{/g;

test('the label-tuple scan matches [key, {…}] only, never a list of command names', () => {
  const found = (text) => [...text.matchAll(LABEL_TUPLE)].map((m) => m[1]);
  assert.deepEqual(found("label: ['undo.omakase', {}]"), ['undo.omakase']);
  assert.deepEqual(found("['undo.lock', { n: ids.length }]"), ['undo.lock']);
  assert.deepEqual(found("const COMMANDS_USED = ['look.set', 'look.seed', 'meta.set'];"), []);
  assert.deepEqual(found("['look.set',\n 'look.seed']"), []);
});

test('label tuples in ui/* ([key, params] for history, crumbs and looks) name existing keys', () => {
  const missing = [];
  for (const rel of listSources().filter((r) => r.startsWith('ui/'))) {
    const text = fs.readFileSync(path.join(SRC, rel), 'utf8');
    for (const m of text.matchAll(LABEL_TUPLE)) {
      if (!(m[1] in STRINGS)) missing.push(rel + ': ' + m[1]);
    }
  }
  assert.deepEqual(missing, []);
});

test('English UI strings keep the plural form only where a count is passed', () => {
  // A '|' in an English text is a plural split; it must have exactly two forms and use {n}.
  for (const [key, [, en]] of Object.entries(STRINGS)) {
    const bars = en.replace(/\\\|/g, '').split('|').length - 1;
    if (!bars || key.startsWith('syn.') || key.startsWith('lyr.ph') || key === 'why.mood.tag') continue;
    if (!/\{n\}/.test(en)) continue;
    assert.equal(bars, 1, key + ': one | between the singular and the plural');
  }
});
