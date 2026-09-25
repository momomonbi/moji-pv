/* 文字PVメーカー v2 — original work. Tests for the release check's fixes: the playing re-prepare cadence, the file named in err.file.newer, forgetting every AI key, LRC ID tags in the UI, the thumbnails' second line, one list of song sections. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const T = MV.use('i18n/t');
const STRINGS = MV.use('i18n/strings');
const D = MV.use('core/doc');

function clone(v) { return JSON.parse(JSON.stringify(v)); }

// A Storage-like map (session / local storage).
function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    keys: () => [...m.keys()],
  };
}

// perf-1 follow-up: ui/boot prepares again while playing once the playhead has moved REPREPARE_S. Played here with the
// catalog on project_vertical at 720p and the §7.3 sprite budget, as the stage does (prepare ±5 s around the playhead,
// then again whenever prepareDue says so): from 11 s and 13.5 s the window over the budget used to be refilled only
// 2.5 s after a prepare, and one frame about 2 s in rasterized 18 sprites.
test('playback re-prepares often enough that a budget-limited window is warm before it shows (ui/boot prepareDue)', async () => {
  const B = MV.use('ui/boot');
  assert.equal(typeof B.prepareDue, 'function');
  assert.ok(B.REPREPARE_S <= 1.5, 'prepare again about every 1.5 s of playback: ' + B.REPREPARE_S);
  assert.equal(B.prepareDue(null, 3), true, 'the first time tick prepares');
  assert.equal(B.prepareDue(3, 3 + B.REPREPARE_S / 2), false, 'not on every frame');
  assert.equal(B.prepareDue(3, 3 + B.REPREPARE_S), true);
  assert.equal(B.prepareDue(3, 3 - B.REPREPARE_S), true, 'a jump back while playing prepares too');

  const FAC = MV.use('engine/facade');
  const R = MV.use('engine/render/record');
  const { fakeMeasurer } = MV.use('engine/text/fake_measure');
  const reg = MV.use('parts/catalog').defaultRegistry();
  const doc = corpus.project('vertical').doc;
  async function play(t0, seconds) {
    const rec = R.createRecorder();
    const engine = FAC.createEngine({ registry: reg, canvas: rec.factory, measurer: fakeMeasurer(), fonts: null, assets: null, strict: false });
    const plan = engine.setDoc(clone(doc)).plan;
    const made = rec.factory.create(720, 1280, { alpha: true });
    const s = { canvas: made.canvas, ctx: made.ctx, w: 720, h: 1280 };
    const opts = { quality: 'preview', pick: true, scale: 720 / plan.design.w };
    engine.renderFrame(s, t0, opts);                 // the preview shows a frame first (the warm-up needs its scale)
    let center = null;
    const perFrame = [];
    for (let i = 1; i <= seconds * 30; i++) {
      const t = t0 + i / 30;
      if (B.prepareDue(center, t)) { center = t; await engine.prepare(Math.max(0, t - B.PREPARE_S), t + B.PREPARE_S); }
      const before = engine.stats().spritesMade;
      engine.renderFrame(s, t, opts);
      perFrame.push(engine.stats().spritesMade - before);
    }
    return perFrame;
  }
  for (const t0 of [11, 13.5]) {
    const perFrame = await play(t0, 5);
    assert.ok(Math.max(...perFrame) <= 2, 'from ' + t0 + ' s: most sprites made in one frame ' + Math.max(...perFrame));
  }
});

test('err.file.newer names the file that was not opened (ui/project_io passes name: file.name)', () => {
  for (const lang of ['ja', 'en']) {
    const t = T.createT(lang, STRINGS);
    const text = t('err.file.newer', { n: 1, name: 'うた.json' });
    assert.ok(text.includes('うた.json'), lang + ': ' + text);
  }
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'src', 'ui', 'project_io.js'), 'utf8');
  assert.match(src, /t\('err\.file\.' \+ code, \{[^}]*name: file\.name/, 'openProject passes the file name to every err.file.* text');
});

test('forgetKeys removes every service\'s key from both storages and the panel reads 未設定 (この端末に保存した作品と曲を消す)', () => {
  const AC = MV.use('ui/ai_controller');
  const PR = MV.use('ai/providers');
  const session = memoryStorage();
  const local = memoryStorage();
  const providers = Object.keys(PR.PROVIDERS);
  assert.ok(providers.length >= 2);
  local.setItem('mojipv.ai.key.' + providers[0], 'AIza' + 'x'.repeat(35));
  local.setItem('mojipv.ai.ok.' + providers[0], 'some-model');
  session.setItem('mojipv.ai.key.' + providers[1], 'sk-ant-' + 'y'.repeat(40));
  local.setItem(AC.SETTINGS_KEY, JSON.stringify({ provider: providers[0], remember: true }));
  const host = { t: T.createT('ja', STRINGS), lang: 'ja', toast() {} };
  const ctl = AC.createController(host, { session, local });
  assert.equal(ctl.state.keyStatus !== 'unset', true, 'a remembered key is loaded');
  const seen = [];
  ctl.on((s) => seen.push(s.keyStatus));
  ctl.forgetKeys();
  assert.deepEqual([...session.keys(), ...local.keys()].filter((k) => k.startsWith('mojipv.ai.key.') || k.startsWith('mojipv.ai.ok.')), []);
  assert.equal(ctl.state.key, '');
  assert.equal(ctl.state.keyStatus, 'unset');
  assert.deepEqual(seen, ['unset'], 'the panel is told once');
  ctl.setProvider(providers[1]);
  assert.equal(ctl.state.key, '', 'the other service\'s key is gone too');
});

test('LRC ID tags [au:] [length:] [tool:] [#:] are meta rows in the editor and in the .lrc file too (core/lyrics isMetaRow)', () => {
  const L = MV.use('core/lyrics');
  const LE = MV.use('ui/lyric_editor');
  const rows = ['[au:誰か]', '[length:03:12]', '[tool:なにか]', '[#:1]', '[ti:朝]', ' [AR:someone] '];
  for (const src of rows) {
    assert.ok(L.isMetaRow(src), src);
    assert.deepEqual(LE.segments(src), [[src, 'tok-meta']], 'the editor tints ' + src + ' as a tag');
  }
  assert.notDeepEqual(LE.segments('[00:12.00]朝の窓'), [['[00:12.00]朝の窓', 'tok-meta']]);

  const IO = MV.use('ui/project_io');
  const sheet = ['[ti:朝]', '[au:誰か]', '[length:03:12]', '窓をあけて'].map((src, i) => ({ id: 'r' + (i + 1), src }));
  const app = { t: T.createT('ja', STRINGS), bus: { emit() {} }, doc: { sheet: { rows: sheet } },
    plan: { lines: [{ id: 'r4', row: 'r4', t0: 1.5, text: '窓をあけて' }] } };
  const lrc = IO.create(app).lrcText();
  assert.equal(lrc, '[ti:朝]\n[au:誰か]\n[length:03:12]\n[00:01.50]窓をあけて\n', 'the ID tags are kept in the saved .lrc');
});

test('part browser thumbnails pass the transition\'s second line (pb.sampleTextB) to engine.thumb', () => {
  const PB = MV.use('ui/part_browser');
  const calls = [];
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const canvas = () => ({ width: 0, height: 0, isConnected: true, dataset: {}, getContext: () => ctx });
  const saved = { document: globalThis.document, ric: globalThis.requestIdleCallback };
  globalThis.document = { createElement: canvas };
  globalThis.requestIdleCallback = (fn) => fn();
  try {
    for (const lang of ['ja', 'en']) {
      const t = T.createT(lang, STRINGS);
      const app = { t, reg: null, plan: null, doc: { look: { aspect: '16:9' } },
        engine: { thumb: (ref, surface, o) => calls.push({ ref, o }) } };
      const thumbs = PB.createThumbs(app);
      thumbs.draw(canvas(), { kind: 'seam', key: 'crossFade' });
      const last = calls[calls.length - 1];
      assert.equal(last.o.text, t('pb.sampleText'));
      assert.equal(last.o.textB, t('pb.sampleTextB'), lang + ': the second line is UI text in the page language');
    }
  } finally {
    globalThis.document = saved.document;
    globalThis.requestIdleCallback = saved.ric;
  }
});

// A refactor (the two lists were equal): the timeline reads core/doc's list, so a kind added there is drawn by name.
test('the timeline keeps every section kind core/doc validates (one list, D.SECTION_KINDS)', () => {
  const TL = MV.use('ui/timeline');
  const sections = D.SECTION_KINDS.map((kind, i) => ({ kind, start: i, end: i + 1 }));
  assert.deepEqual(TL.songMarks({ sections }).sections.map((s) => s.kind), D.SECTION_KINDS.slice());
  assert.equal(TL.songMarks({ sections: [{ kind: 'drop', start: 0, end: 1 }] }).sections[0].kind, 'other');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'src', 'ui', 'timeline.js'), 'utf8');
  assert.ok(!/SECTION_KINDS\s*=\s*\[/.test(src), 'no second copy of the list');
});
