/* 文字PVメーカー v2 — original work. Tests for ui/output: format ↔ backdrop, filters per backdrop, the UI pre-flight items (DESIGN §3.2, §4.19.4, §4.21, §6.4.3). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const OUT = MV.use('ui/output');
const S = MV.use('export/schedule');
const STRINGS = MV.use('i18n/strings');
const T = MV.use('i18n/t');
const REG = MV.use('core/registry');
const reduce = MV.has('core/commands') ? MV.use('core/commands').reduce : null;

function docWith(format, backdrop) {
  const doc = corpus.project('basic').doc;
  doc.output = Object.assign({}, doc.output, { format });
  doc.look = Object.assign({}, doc.look, { backdrop });
  return doc;
}

function apply(doc, cmds) { return cmds.reduce((d, c) => reduce(d, c), doc); }

// A registry of the fallback parts plus four screen effects that cover the §4.19.4 table.
function fxRegistry() {
  const grain = corpus.minimalFallbacks().find((d) => d.kind === 'filter');
  const fx = (key, stage, alphaSafe) => Object.assign({}, grain, { key, stage, alphaSafe, fallback: false, texture: false });
  return REG.createRegistry(corpus.minimalFallbacks().concat([
    fx('keepEdge', 'tone', true), fx('bendShape', 'shape', false), fx('filmDust', 'film', false), fx('warmGlow', 'light', false),
  ]));
}

function planWith(filters, texture) {
  const cut = (key, list) => ({ key, slots: Object.assign({ 'filter.count': { v: list.length, from: 'auto' } },
    Object.fromEntries(list.map((v, i) => ['filter#' + i, { v, from: 'auto' }]))) });
  return { look: { texture: texture ? { v: texture, from: 'auto' } : null }, cuts: filters.map((list, i) => cut('r' + (i + 1) + '~0', list)) };
}

test('format and backdrop stay a consistent pair: 透過PNG ⇔ 透明, whatever the user picks and from wherever', { skip: !reduce }, () => {
  for (const format of OUT.FORMATS) {
    for (const backdrop of OUT.BACKDROPS) {
      const doc = docWith(format, backdrop);
      for (const f of OUT.FORMATS) {
        const out = apply(doc, OUT.formatCmds(doc, f));
        assert.equal(out.output.format, f, format + '/' + backdrop + ' → format ' + f);
        assert.ok(OUT.consistent(out), format + '/' + backdrop + ' → format ' + f + ' is consistent');
        if (f !== 'pngAlpha' && backdrop !== 'clear') assert.equal(out.look.backdrop, backdrop, 'an opaque backdrop is kept');
      }
      for (const b of OUT.BACKDROPS) {
        const out = apply(doc, OUT.backdropCmds(doc, b));
        assert.equal(out.look.backdrop, b, format + '/' + backdrop + ' → backdrop ' + b);
        assert.ok(OUT.consistent(out), format + '/' + backdrop + ' → backdrop ' + b + ' is consistent');
        if (b !== 'clear' && format === 'mp4') assert.equal(out.output.format, 'mp4', 'MP4 stays MP4 for an opaque backdrop');
      }
    }
  }
  assert.deepEqual(OUT.formatCmds(docWith('mp4', 'scene'), 'pngAlpha'),
    [{ t: 'output.set', key: 'format', v: 'pngAlpha' }, { t: 'look.set', key: 'backdrop', v: 'clear' }]);
  assert.deepEqual(OUT.backdropCmds(docWith('pngAlpha', 'clear'), 'chroma'),
    [{ t: 'look.set', key: 'backdrop', v: 'chroma' }, { t: 'output.set', key: 'format', v: 'png' }], 'the frames keep the green');
  assert.deepEqual(OUT.backdropCmds(docWith('mp4', 'black'), 'black'), [], 'nothing to do, no command');
});

test('the preview renders what the export renders (export/schedule.backdropFor)', () => {
  for (const format of OUT.FORMATS) {
    for (const backdrop of OUT.BACKDROPS) {
      assert.equal(OUT.effectiveBackdrop(docWith(format, backdrop)), S.backdropFor(format, backdrop), format + '/' + backdrop);
    }
  }
  assert.equal(OUT.effectiveBackdrop(docWith('pngAlpha', 'scene')), 'clear');
  assert.equal(OUT.effectiveBackdrop(docWith('mp4', 'clear')), 'scene');
});

test('screen effects per backdrop follow the §4.19.4 table', () => {
  const reg = fxRegistry();
  const skip = (key, b) => OUT.skipOf(reg, key, b);
  assert.equal(skip('keepEdge', 'clear'), null, 'alphaSafe runs on transparent frames');
  assert.equal(skip('bendShape', 'clear'), 'clear');
  assert.equal(skip('bendShape', 'chroma'), null, 'shape effects run on the green screen');
  assert.equal(skip('keepEdge', 'chroma'), null);
  assert.equal(skip('filmDust', 'chroma'), 'chroma');
  assert.equal(skip('filmDust', 'black'), null, 'film effects run on black');
  assert.equal(skip('keepEdge', 'black'), 'black', 'tone effects do not');
  assert.equal(skip('warmGlow', 'scene'), null, 'everything runs on the normal background');
  assert.equal(skip('none', 'clear'), null);
  assert.equal(skip('unknownKey', 'clear'), null, 'an unknown key is not claimed to be skipped');

  const plan = planWith([['keepEdge', 'bendShape'], ['bendShape'], []], 'grainFilm');
  assert.deepEqual(OUT.usedFilters(plan), ['bendShape', 'grainFilm', 'keepEdge']);
  assert.deepEqual(OUT.usedFilters(plan, ['r2~0']), ['bendShape'], 'a scope counts its cuts only (no texture)');
  assert.deepEqual(OUT.skippedFilters(plan, reg, 'clear'), ['bendShape', 'grainFilm']);
  assert.deepEqual(OUT.skippedFilters(plan, reg, 'black'), ['keepEdge'], 'on black the shape effect runs, the tone effect does not');
  const past = planWith([['keepEdge']], null);
  past.cuts[0].slots['filter.count'].v = 0;
  assert.deepEqual(OUT.usedFilters(past), [], 'slots beyond the count are not used');
});

test('UI pre-flight items: a mismatched pair can be fixed in one step; skipped effects are listed', { skip: !reduce }, () => {
  const reg = fxRegistry();
  const plan = planWith([['keepEdge', 'bendShape']], null);
  const codes = (doc) => OUT.checks(doc, plan, reg).map((c) => c.code);
  assert.deepEqual(codes(docWith('mp4', 'scene')), []);
  assert.deepEqual(codes(docWith('pngAlpha', 'clear')), ['fx-skipped']);
  assert.deepEqual(OUT.checks(docWith('pngAlpha', 'clear'), plan, reg)[0].params, { bg: 'clear', keys: ['bendShape'] });
  assert.deepEqual(codes(docWith('pngAlpha', 'chroma')), ['alpha-backdrop', 'fx-skipped']);
  assert.deepEqual(codes(docWith('png', 'clear')), ['clear-png'], 'an opaque PNG of a clear backdrop renders the scene');
  assert.deepEqual(codes(docWith('mp4', 'black')), ['fx-skipped']);
  for (const [format, backdrop] of [['pngAlpha', 'chroma'], ['png', 'clear']]) {
    const doc = docWith(format, backdrop);
    const fixed = apply(doc, OUT.checks(doc, plan, reg).find((c) => c.fix).fix);
    assert.ok(OUT.consistent(fixed), format + '/' + backdrop + ': the fix makes the pair consistent');
    assert.ok(!codes(fixed).some((c) => c === 'alpha-backdrop' || c === 'clear-png'), 'and the item goes');
  }
  const clearMp4 = docWith('mp4', 'clear');
  const items = OUT.withFixes(S.preflight(clearMp4, { design: { aspect: '16:9' }, impulses: [], cuts: [], grounds: [], seams: [],
    duration: 10, warnings: [] }, { webcodecs: true, codec: 'avc1.640028', audioCodec: 'mp4a.40.2', fsAccess: true, fontsReady: true }), clearMp4);
  const item = items.find((c) => c.code === 'clear-mp4');
  assert.ok(item && Array.isArray(item.fix), 'clear-mp4 offers 透過PNGにする');
  assert.equal(apply(clearMp4, item.fix).output.format, 'pngAlpha');
  for (const code of ['no-webcodecs', 'no-h264']) {
    const [blocked] = OUT.withFixes([{ code, level: 'block', params: {} }], clearMp4);
    assert.ok(Array.isArray(blocked.fix), code + ' offers PNG連番にする');
    const fixed = apply(clearMp4, blocked.fix);
    assert.deepEqual([fixed.output.format, fixed.look.backdrop], ['png', 'scene'], code + ': an opaque PNG sequence (透明 goes with 透過PNG only)');
  }
  const flash = OUT.withFixes([{ code: 'flash-rate', level: 'warn', params: {}, fix: { t: 'pin.set', path: 'work:amount.flash', v: 0.3, by: 'user' } }], clearMp4);
  assert.ok(Array.isArray(flash[0].fix) && flash[0].fix.length === 1, 'a single fix command becomes a list');
});

test('mergeFonts folds every font-fallback item into one line that names each family once', () => {
  const items = [{ code: 'memory', level: 'warn', params: {} },
    { code: 'font-fallback', level: 'info', params: { family: 'Fraunces' } },
    { code: 'overfull', level: 'warn', params: { line: 2 } },
    { code: 'font-fallback', level: 'info', params: { family: 'M PLUS 1p' } },
    { code: 'font-fallback', level: 'info', params: { family: 'Fraunces' } }];
  const out = OUT.mergeFonts(items);
  assert.deepEqual(out.map((c) => c.code), ['memory', 'font-fallback', 'overfull']);
  assert.deepEqual(out[1].params.families, ['Fraunces', 'M PLUS 1p']);
  assert.deepEqual(OUT.mergeFonts([items[1]])[0].params.families, ['Fraunces']);
  assert.deepEqual(OUT.mergeFonts([items[0]]), [items[0]]);
});

test('every export error code has a message, and every key the output rules name exists', () => {
  for (const code of ['cancelled', 'sink', 'range-empty', 'no-webcodecs', 'no-codec', 'codec', 'no-plan', 'encode', 'args', 'something']) {
    assert.ok(OUT.errorKey(code) in STRINGS, code + ' → ' + OUT.errorKey(code));
  }
  assert.equal(OUT.errorKey('unknown'), 'err.exp.encode');
  // a photo or video the export could not read (package B: ExportError('media', …, { id, name, code })) is named
  assert.equal(OUT.errorKey('media'), 'err.exp.media');
  const t = T.createT('ja', STRINGS);
  const err = Object.assign(new Error('x'), { code: 'media', detail: { id: 'a1', name: '海辺.mp4', code: 'decode' } });
  assert.equal(t(OUT.errorKey(err.code), OUT.errorParams(err)),
    '写真・動画「海辺.mp4」を読めないため、書き出しを止めました。つなぎ直してからもう一度書き出してください。');
  assert.deepEqual(OUT.errorParams({ code: 'media', detail: { id: 'a1', name: null } }), { name: '—' });
  assert.deepEqual(OUT.errorParams({ code: 'sink' }), {});
  for (const b of OUT.BACKDROPS) assert.ok('exp.bg.' + b in STRINGS, b);
  for (const code of ['fx-skipped', 'alpha-backdrop', 'clear-png', 'clear-mp4']) assert.ok('exp.pre.' + code in STRINGS, code);
});
