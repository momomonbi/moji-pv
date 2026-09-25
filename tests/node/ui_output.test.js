/* 文字PVメーカー v2 — original work. Tests for ui/output: format ↔ backdrop, filters per backdrop, the UI pre-flight items, step ④'s summary line and the Filmora set's contents (DESIGN §3.2, §4.19.4, §4.21, §6.4.3; DESIGN_2_1 §13.3, §13.10). */
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

test('format and backdrop stay a consistent pair: 透過動画 / 透過PNG ⇔ 透明, whatever the user picks and from wherever', { skip: !reduce }, () => {
  assert.deepEqual(OUT.FORMATS, MV.use('core/doc').OUTPUT_CHOICES.format, 'every format of the document, in its order');
  assert.deepEqual([...OUT.MAIN_FORMATS, ...OUT.OTHER_FORMATS].sort(), [...OUT.FORMATS].sort(), 'the pair and その他 hold each format once');
  for (const format of OUT.FORMATS) {
    for (const backdrop of OUT.BACKDROPS) {
      const doc = docWith(format, backdrop);
      for (const f of OUT.FORMATS) {
        const out = apply(doc, OUT.formatCmds(doc, f));
        assert.equal(out.output.format, f, format + '/' + backdrop + ' → format ' + f);
        assert.ok(OUT.consistent(out), format + '/' + backdrop + ' → format ' + f + ' is consistent');
        if (!OUT.isAlpha(f) && backdrop !== 'clear') assert.equal(out.look.backdrop, backdrop, 'an opaque backdrop is kept');
      }
      for (const b of OUT.BACKDROPS) {
        const out = apply(doc, OUT.backdropCmds(doc, b));
        assert.equal(out.look.backdrop, b, format + '/' + backdrop + ' → backdrop ' + b);
        assert.ok(OUT.consistent(out), format + '/' + backdrop + ' → backdrop ' + b + ' is consistent');
        if (b !== 'clear' && !OUT.isAlpha(format)) assert.equal(out.output.format, format, format + ' stays for an opaque backdrop');
      }
    }
  }
  assert.deepEqual(OUT.FORMATS.filter(OUT.isAlpha), ['webmAlpha', 'pngAlpha']);
  // DESIGN_2_1 §13.3's table, row by row
  assert.deepEqual(OUT.formatCmds(docWith('mp4', 'scene'), 'webmAlpha'),
    [{ t: 'output.set', key: 'format', v: 'webmAlpha' }, { t: 'look.set', key: 'backdrop', v: 'clear' }], '透過動画 → 透明');
  assert.deepEqual(OUT.formatCmds(docWith('mp4', 'chroma'), 'pngAlpha'),
    [{ t: 'output.set', key: 'format', v: 'pngAlpha' }, { t: 'look.set', key: 'backdrop', v: 'clear' }], '透過PNG → 透明');
  for (const f of ['mp4', 'kit', 'png']) {
    assert.deepEqual(OUT.formatCmds(docWith('webmAlpha', 'clear'), f),
      [{ t: 'output.set', key: 'format', v: f }, { t: 'look.set', key: 'backdrop', v: 'scene' }], f + ' while 透明 → 通常');
  }
  assert.deepEqual(OUT.formatCmds(docWith('mp4', 'black'), 'kit'), [{ t: 'output.set', key: 'format', v: 'kit' }],
    'the set keeps the document\'s backdrop');
  assert.deepEqual(OUT.backdropCmds(docWith('mp4', 'scene'), 'clear'),
    [{ t: 'look.set', key: 'backdrop', v: 'clear' }, { t: 'output.set', key: 'format', v: 'webmAlpha' }], 'MP4 + 透明 → 透過動画');
  assert.deepEqual(OUT.backdropCmds(docWith('kit', 'scene'), 'clear'),
    [{ t: 'look.set', key: 'backdrop', v: 'clear' }, { t: 'output.set', key: 'format', v: 'webmAlpha' }], 'Filmora用 + 透明 → 透過動画');
  assert.deepEqual(OUT.backdropCmds(docWith('png', 'scene'), 'clear'),
    [{ t: 'look.set', key: 'backdrop', v: 'clear' }, { t: 'output.set', key: 'format', v: 'pngAlpha' }], 'PNG連番 + 透明 → 透過PNG (frames stay frames)');
  assert.deepEqual(OUT.backdropCmds(docWith('webmAlpha', 'clear'), 'chroma'),
    [{ t: 'look.set', key: 'backdrop', v: 'chroma' }, { t: 'output.set', key: 'format', v: 'mp4' }], '透過動画 + another backdrop → MP4');
  assert.deepEqual(OUT.backdropCmds(docWith('pngAlpha', 'clear'), 'chroma'),
    [{ t: 'look.set', key: 'backdrop', v: 'chroma' }, { t: 'output.set', key: 'format', v: 'png' }], 'the frames keep the green');
  assert.deepEqual(OUT.backdropCmds(docWith('mp4', 'black'), 'black'), [], 'nothing to do, no command');
  // the way there and back again ends where it started
  for (const format of ['mp4', 'png']) {
    const doc = docWith(format, 'scene');
    const there = apply(doc, OUT.backdropCmds(doc, 'clear'));
    const back = apply(there, OUT.backdropCmds(there, 'scene'));
    assert.deepEqual([back.output.format, back.look.backdrop], [format, 'scene'], format + ' → 透明 → 通常');
  }
  assert.deepEqual(OUT.FORMATS.map(OUT.transparentOf), ['webmAlpha', 'webmAlpha', 'webmAlpha', 'pngAlpha', 'pngAlpha']);
  assert.deepEqual(OUT.FORMATS.map(OUT.opaqueOf), ['mp4', 'kit', 'mp4', 'png', 'png']);
  // step ④ names 透明 by what choosing it makes
  assert.deepEqual(OUT.FORMATS.map(OUT.clearLabel),
    ['exp.bg.clearWebm', 'exp.bg.clearWebm', 'exp.bg.clearWebm', 'exp.bg.clearPng', 'exp.bg.clearPng']);
  for (const f of OUT.FORMATS) assert.ok(OUT.clearLabel(f) in STRINGS, f);
});

test('the preview renders what the export renders (export/schedule.backdropFor)', () => {
  for (const format of OUT.FORMATS) {
    for (const backdrop of OUT.BACKDROPS) {
      assert.equal(OUT.effectiveBackdrop(docWith(format, backdrop)), S.backdropFor(format, backdrop), format + '/' + backdrop);
    }
  }
  assert.equal(OUT.effectiveBackdrop(docWith('pngAlpha', 'scene')), 'clear');
  assert.equal(OUT.effectiveBackdrop(docWith('mp4', 'clear')), 'scene');
  assert.equal(OUT.effectiveBackdrop(docWith('webmAlpha', 'scene')), 'clear', '透過動画 is always transparent');
  assert.equal(OUT.effectiveBackdrop(docWith('kit', 'chroma')), 'chroma', 'the set renders the document\'s backdrop');
  assert.equal(OUT.effectiveBackdrop(docWith('kit', 'clear')), 'scene', 'never 透明 (an older file)');
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
  assert.deepEqual(codes(docWith('webmAlpha', 'chroma')), ['alpha-backdrop', 'fx-skipped'], '透過動画 too');
  assert.deepEqual(OUT.checks(docWith('webmAlpha', 'black'), plan, reg)[0].params, { bg: 'black', format: 'webmAlpha' });
  assert.deepEqual(codes(docWith('kit', 'scene')), [], 'the set on the normal background');
  assert.deepEqual(codes(docWith('png', 'clear')), ['clear-png'], 'an opaque PNG of a clear backdrop renders the scene');
  assert.deepEqual(codes(docWith('mp4', 'black')), ['fx-skipped']);
  for (const [format, backdrop] of [['pngAlpha', 'chroma'], ['webmAlpha', 'black'], ['png', 'clear']]) {
    const doc = docWith(format, backdrop);
    const fixed = apply(doc, OUT.checks(doc, plan, reg).find((c) => c.fix).fix);
    assert.ok(OUT.consistent(fixed), format + '/' + backdrop + ': the fix makes the pair consistent');
    assert.ok(!codes(fixed).some((c) => c === 'alpha-backdrop' || c === 'clear-png'), 'and the item goes');
  }
  const clearMp4 = docWith('mp4', 'clear');
  const items = OUT.withFixes(S.preflight(clearMp4, { design: { aspect: '16:9' }, impulses: [], cuts: [], grounds: [], seams: [],
    duration: 10, warnings: [] }, { webcodecs: true, codec: 'avc1.640028', audioCodec: 'mp4a.40.2', fsAccess: true, fontsReady: true }), clearMp4);
  const item = items.find((c) => c.code === 'clear-mp4');
  assert.ok(item && Array.isArray(item.fix), 'clear-mp4 offers 透過動画にする');
  assert.deepEqual([apply(clearMp4, item.fix).output.format, apply(clearMp4, item.fix).look.backdrop], ['webmAlpha', 'clear'],
    'the transparent video is the transparent path now (DESIGN_2_1 §13.3)');
  assert.equal(OUT.fixLabel(item), 'exp.pre.makeWebm');
  for (const code of ['no-webcodecs', 'no-h264']) {
    const [blocked] = OUT.withFixes([{ code, level: 'block', params: {} }], clearMp4);
    assert.ok(Array.isArray(blocked.fix), code + ' offers PNG連番にする');
    const fixed = apply(clearMp4, blocked.fix);
    assert.deepEqual([fixed.output.format, fixed.look.backdrop], ['png', 'scene'], code + ': an opaque PNG sequence (透明 goes with 透過PNG only)');
    assert.equal(OUT.fixLabel(blocked), 'exp.pre.makePng');
    // 透過動画 stays transparent: its frames become 透過PNG (H3S-2)
    const webm = docWith('webmAlpha', 'clear');
    const [alpha] = OUT.withFixes([{ code, level: 'block', params: {} }], webm);
    const clear = apply(webm, alpha.fix);
    assert.deepEqual([clear.output.format, clear.look.backdrop, OUT.fixLabel(alpha)], ['pngAlpha', 'clear', 'exp.pre.makeAlpha'], code + ' for 透過動画');
    // the Filmora set: no PNG sequence (no way into Filmora, R3); the text alone sends the user to Chrome or Edge (UX-H3-11)
    const [set] = OUT.withFixes([{ code, level: 'block', params: {} }], docWith('kit', 'scene'));
    assert.equal(set.fix, undefined, code + ' for the set offers no other format');
    assert.equal(set.params.format, 'kit');
  }
  assert.equal(OUT.checkKey({ code: 'no-h264', params: { format: 'kit' } }), 'exp.pre.kit-no-h264', 'the set says its own MP4s cannot be made');
  assert.equal(OUT.checkKey({ code: 'no-h264', params: { format: 'mp4' } }), 'exp.pre.no-h264');
  assert.equal(OUT.checkKey({ code: 'kit-wav', params: {} }), 'exp.pre.kit-wav');
  assert.ok('exp.pre.kit-no-h264' in STRINGS);
  const flash = OUT.withFixes([{ code: 'flash-rate', level: 'warn', params: {}, fix: { t: 'pin.set', path: 'work:amount.flash', v: 0.3, by: 'user' } }], clearMp4);
  assert.ok(Array.isArray(flash[0].fix) && flash[0].fix.length === 1, 'a single fix command becomes a list');
  // no-vp9 (DESIGN_2_1 §13.10): 透過動画 offers 透過PNG; the Filmora set, leaving its transparent video out
  const webm = docWith('webmAlpha', 'clear');
  const [noVp9] = OUT.withFixes([{ code: 'no-vp9', level: 'block', params: {} }], webm);
  assert.deepEqual([apply(webm, noVp9.fix).output.format, apply(webm, noVp9.fix).look.backdrop, OUT.fixLabel(noVp9)],
    ['pngAlpha', 'clear', 'exp.pre.makeAlpha']);
  const kit = docWith('kit', 'scene');
  const [kitVp9] = OUT.withFixes([{ code: 'no-vp9', level: 'block', params: {} }], kit);
  const fixed = apply(kit, kitVp9.fix);
  assert.deepEqual([fixed.output.format, fixed.output.kit, OUT.fixLabel(kitVp9)],
    ['kit', { overlay: false, bg: false, green: false, srt: true, lrc: false }, 'exp.pre.noOverlay']);
  assert.ok(!S.preflight(fixed, { design: { aspect: '16:9' }, impulses: [], cuts: [], grounds: [], seams: [], lines: [], duration: 10,
    warnings: [] }, { webcodecs: true, codec: 'avc1.640028', audioCodec: 'mp4a.40.2', vp9Codec: null, fsAccess: true, dirAccess: true,
    fontsReady: true }).some((c) => c.code === 'no-vp9'), 'and the block goes');
  for (const code of Object.keys(FIX_CODES)) {
    assert.equal(OUT.fixLabel({ code, params: {} }), FIX_CODES[code], code);
    assert.ok(FIX_CODES[code] in STRINGS, FIX_CODES[code]);
  }
  assert.equal(OUT.fixLabel({ code: 'something-else' }), 'exp.pre.fix');
});

// The fix buttons of step ④, by code (ui/output.fixLabel).
const FIX_CODES = { 'flash-rate': 'exp.pre.flash-fix', 'clear-mp4': 'exp.pre.makeWebm', 'clear-png': 'exp.pre.makeAlpha',
  'alpha-backdrop': 'exp.pre.makeClear', 'no-webcodecs': 'exp.pre.makePng', 'no-h264': 'exp.pre.makePng' };

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
  // 透過動画 needs VP9 (or VP8): a failure says so (DESIGN_2_1 §13.10)
  assert.equal(OUT.errorKey('no-vp9'), 'exp.pre.no-vp9');
  // 透過PNG and 透過動画 name themselves in the alpha-backdrop item
  assert.equal(t('exp.pre.alpha-backdrop', { format: t('exp.fmt.webmAlpha'), bg: t('exp.bg.black') }),
    '透過動画（WebM）は背景を描かずに書き出します（背景の種類は「黒（白文字）」）。');
});

// ---- DESIGN_2_1 §13.10: the Filmora set in step ④ -------------------------------------------------------------------

function kitDoc(kit, over) {
  const doc = docWith('kit', 'scene');
  doc.output = Object.assign({}, doc.output, { kit: Object.assign({}, MV.use('core/doc').KIT_DEFAULT, kit || {}) }, over || {});
  return doc;
}

const PLAN = { design: { aspect: '16:9' }, duration: 30, cuts: [], seams: [], impulses: [], grounds: [], warnings: [],
  lines: [{ id: 'r1', t0: 1, t1: 4, text: '窓をあけて' }, { id: 'r2', t0: 5, t1: 8, text: '光を入れる' }] };

test('the set\'s contents: one checkbox writes the whole output.kit, with only that file changed', { skip: !reduce }, () => {
  assert.deepEqual(OUT.KIT_KEYS, MV.use('core/doc').KIT_KEYS, 'the contents list follows core/doc');
  const doc = kitDoc();
  for (const key of OUT.KIT_KEYS) {
    for (const on of [true, false]) {
      const cmd = OUT.kitCmd(doc, key, on);
      assert.equal(cmd.t, 'output.set');
      assert.equal(cmd.key, 'kit');
      const out = reduce(doc, cmd).output.kit;
      for (const other of OUT.KIT_KEYS) assert.equal(out[other], other === key ? on : doc.output.kit[other], key + '=' + on + ': ' + other);
    }
  }
  // a document without output.kit (the defaults) gets the whole object too
  const bare = kitDoc();
  delete bare.output.kit;
  assert.deepEqual(OUT.kitCmd(bare, 'green', true).v, { overlay: true, bg: false, green: true, srt: true, lrc: false });
});

test('the summary line: the set\'s files and size, and where they go; the other formats\' size and length', () => {
  // Filmora用: 「Filmora用セット: {n}ファイル・約 {size}（{where}）」, the files and estimates of export/schedule.kitFiles
  const doc = kitDoc({ bg: true, lrc: true });
  const files = S.kitFiles(doc, PLAN, {});
  const s = OUT.summary(doc, PLAN, { dirAccess: true });
  assert.deepEqual(s, { key: 'exp.kit.summary', params: { n: files.length, bytes: files.reduce((a, f) => a + f.est, 0), where: 'folder' } });
  assert.equal(files.length, 6, 'main, overlay, bg, srt, lrc, README');
  assert.equal(OUT.summary(doc, PLAN, { dirAccess: false, fsAccess: true }).params.where, 'zip', 'no folder picker: one ZIP');
  // without AAC the song is a WAV file: one more file
  const song = kitDoc({}, { audio: true });
  song.song = { name: 'a.mp3', sha1: 'x', duration: 30 };
  assert.equal(OUT.summary(song, PLAN, { dirAccess: true, audioCodec: 'opus', songReady: true }).params.n,
    OUT.summary(song, PLAN, { dirAccess: true, audioCodec: 'mp4a.40.2', songReady: true }).params.n + 1);
  const t = T.createT('ja', STRINGS);
  assert.equal(t('exp.kit.summary', { n: 4, size: '820 MB', where: t('exp.kit.toFolder') }),
    'Filmora用セット: 4ファイル・約 820 MB（フォルダに保存）');
  // MP4, 透過動画, PNG: 「{w}×{h}・{fps}fps・{dur}・約 {size}・{where}」
  const mp4 = docWith('mp4', 'scene');
  mp4.output = Object.assign({}, mp4.output, { short: 720, fps: 30, quality: 'high', range: { t0: 2, t1: 12 }, audio: false });
  const m = OUT.summary(mp4, PLAN, { fsAccess: true });
  assert.deepEqual(m, { key: 'exp.summary', params: { w: 1280, h: 720, fps: 30, seconds: 10, bytes: S.estimateBytes(10, S.bitrate(1280, 720, 30, 'high'), false),
    where: 'disk' } });
  const webm = Object.assign({}, mp4, { output: Object.assign({}, mp4.output, { format: 'webmAlpha' }) });
  assert.equal(OUT.summary(webm, PLAN, {}).params.bytes, S.estimateWebmBytes(10, S.bitrate(1280, 720, 30, 'high'), false));
  assert.equal(OUT.summary(webm, PLAN, {}).params.where, 'memory');
  assert.ok(OUT.summary(webm, PLAN, {}).params.bytes > m.params.bytes, 'the WebM carries its alpha stream too');
  const png = Object.assign({}, mp4, { output: Object.assign({}, mp4.output, { format: 'pngAlpha' }) });
  assert.equal(OUT.summary(png, PLAN, {}).params.bytes, S.estimatePngBytes(300, 1280, 720, true));
});

test('the set\'s pre-flight in step ④: memory notes only when they ask; layers-approx names the effects and scene changes', () => {
  const items = [{ code: 'kit-memory', level: 'warn', params: { bytes: 1 } }, { code: 'memory', level: 'warn', params: {} },
    { code: 'kit-memory', level: 'confirm', params: { bytes: 2 } }, { code: 'kit-fps', level: 'info', params: {} }];
  assert.deepEqual(OUT.shownChecks(items).map((c) => c.code + ':' + c.level), ['kit-memory:confirm', 'kit-fps:info'],
    'the summary line already says ZIPでダウンロード / メモリ上で作成');
  const reg = MV.use('parts/catalog').defaultRegistry();
  const [a, b] = reg.keys('filter');
  const ja = T.createT('ja', STRINGS, () => reg);
  const en = T.createT('en', STRINGS, () => reg);
  assert.equal(OUT.layersWhat({ keys: [a, b], seams: 2 }, ja), ja.part('filter', a) + '・' + ja.part('filter', b) + '・場面の切り替わり（2か所）', 'ja: 「・」');
  // en: a sentence list, not '; ' (I18N-1)
  assert.equal(OUT.layersWhat({ keys: [a, b], seams: 2 }, en), en.part('filter', a) + ', ' + en.part('filter', b) + ', and scene changes (2)');
  assert.equal(OUT.layersWhat({ keys: [a, b] }, en), en.part('filter', a) + ' and ' + en.part('filter', b));
  assert.equal(OUT.layersWhat({ keys: [a] }, en), en.part('filter', a));
  for (const t of [ja, en]) assert.equal(OUT.layersWhat({ keys: [], seams: 0 }, t), '');
  // what is layered on what, and against what (UX-H3-10)
  assert.equal(ja('exp.pre.layers-approx', { what: OUT.layersWhat({ keys: [], seams: 3 }, ja) }),
    '「背景だけ」に「文字と装飾だけ」を重ねると、場面の切り替わり（3か所）は完成動画と少し違って見えます');
  assert.equal(en('exp.pre.layers-approx', { what: OUT.layersWhat({ keys: [a, b] }, en) }), 'When "Words and decorations only" is laid over '
    + '"Background only", these look slightly different from the finished video: ' + en.part('filter', a) + ' and ' + en.part('filter', b));
  assert.equal(ja('exp.kit.phase', { what: ja('exp.kit.what.video') }), '動画を書き出し中', 'no space before the particle');
  // what each file is: every kind the set can write has a name
  const all = kitDoc({ bg: true, green: true, lrc: true }, { audio: true });
  all.song = { name: 'a.mp3', sha1: 'x', duration: 30 };
  const kinds = S.kitFiles(all, PLAN, { audioCodec: null, songReady: true }).map((f) => f.kind);
  assert.deepEqual(kinds, ['main', 'overlay', 'bg', 'green', 'srt', 'lrc', 'wav', 'readme']);
  for (const kind of kinds) assert.ok(OUT.kitLabel(kind) in STRINGS, kind);
  assert.equal(OUT.kitLabel('nope'), null);
  // 音声を入れる applies to the formats that carry sound
  assert.deepEqual(OUT.FORMATS.filter(OUT.hasSound), ['mp4', 'kit', 'webmAlpha']);
});

// ---- the review of H.3 (NOTES "## v2.1-H.3", Review fixes) ----------------------------------------------------------------

test('the pre-flight names the chosen format: no 「MP4」 when 透過動画 or the set cannot be made (H3S-1)', () => {
  const plan = { design: { aspect: '16:9' }, impulses: [], cuts: [], grounds: [], seams: [], lines: PLAN.lines, duration: 30, warnings: [] };
  const withSong = (format) => {
    const doc = docWith(format, OUT.isAlpha(format) ? 'clear' : 'scene');
    doc.output = Object.assign({}, doc.output, { audio: true });
    doc.song = { name: 'a.mp3', sha1: 'x', duration: 30 };
    return doc;
  };
  const text = (t, c) => t(OUT.checkKey(c), Object.assign({}, c.params, { format: t('exp.fmtIn.' + c.params.format) }));
  for (const lang of ['ja', 'en']) {
    const t = T.createT(lang, STRINGS);
    for (const format of ['webmAlpha', 'kit']) {
      const doc = withSong(format);
      const env = { webcodecs: false, fsAccess: true, dirAccess: true, fontsReady: true, songReady: true };
      const [c] = OUT.withFixes(S.preflight(doc, plan, env), doc).filter((x) => x.code === 'no-webcodecs');
      assert.equal(c.params.format, format);
      assert.ok(!text(t, c).includes('MP4') && text(t, c).includes(t('exp.fmtIn.' + format)), lang + ' ' + format + ': ' + text(t, c));
    }
    const webm = withSong('webmAlpha');
    const items = OUT.withFixes(S.preflight(webm, plan, { webcodecs: true, audioCodec: null, vp9Codec: 'vp8', songReady: true,
      fsAccess: true, fontsReady: true }), webm);
    const noAudio = items.find((x) => x.code === 'no-audio-codec');
    assert.ok(noAudio && !text(t, noAudio).includes('MP4') && text(t, noAudio).includes(t('exp.fmtIn.webmAlpha')), lang + ': ' + (noAudio && text(t, noAudio)));
    const mp4 = withSong('mp4');
    const [plain] = OUT.withFixes([{ code: 'no-audio-codec', level: 'warn', params: {} }], mp4);
    assert.ok(text(t, plain).includes('MP4'), lang + ': an MP4 still says MP4');
    for (const f of OUT.FORMATS) assert.ok(('exp.fmtIn.' + f) in STRINGS, f);
  }
  assert.equal(T.createT('ja', STRINGS)('exp.pre.no-webcodecs', { format: T.createT('ja', STRINGS)('exp.fmtIn.webmAlpha') }),
    'このブラウザでは透過動画（WebM）を書き出せません。PC の Chrome か Edge を使ってください。');
});

test('Filmora用 does not offer 透明, so exploring 背景 keeps the set; the note under 背景 follows the file (UX-H3-6, H3S-6)', { skip: !reduce }, () => {
  assert.deepEqual(OUT.backdropChoices('kit', 'scene'), ['scene', 'chroma', 'black'], 'the set has its own transparent file in 詳しく');
  assert.deepEqual(OUT.backdropChoices('kit', 'clear'), OUT.BACKDROPS, 'an older file that is already 透明 keeps it listed');
  for (const f of ['mp4', 'webmAlpha', 'png', 'pngAlpha']) assert.deepEqual(OUT.backdropChoices(f, 'scene'), OUT.BACKDROPS, f);
  // every round trip through the offered backdrops ends in the set again
  let doc = docWith('kit', 'scene');
  for (const b of [...OUT.backdropChoices('kit', 'scene'), 'scene']) {
    doc = apply(doc, OUT.backdropCmds(doc, b));
    assert.deepEqual([doc.output.format, doc.look.backdrop], ['kit', b], 'Filmora用 → 背景 ' + b);
  }
  // the note under 背景: the green screen's how-to when the file is green, else the transparency advice (not for the set)
  assert.equal(OUT.backdropNote(docWith('mp4', 'chroma')), 'exp.chromaNote');
  assert.equal(OUT.backdropNote(docWith('png', 'chroma')), 'exp.chromaNote');
  assert.equal(OUT.backdropNote(docWith('kit', 'chroma')), 'exp.chromaNote', 'the set\'s main video is green too');
  assert.equal(OUT.backdropNote(docWith('mp4', 'scene')), 'exp.alphaNote2');
  assert.equal(OUT.backdropNote(docWith('webmAlpha', 'chroma')), 'exp.alphaNote2', '透過動画 is never green');
  assert.equal(OUT.backdropNote(docWith('kit', 'scene')), null);
  const t = T.createT('ja', STRINGS);
  assert.equal(t('exp.chromaNote'), 'Filmoraでは上のトラックに置き、クロマキー（緑幕）をオンにして色 #00B140 を選び、許容範囲を少し上げます。');
});

test('the set\'s contents list the files it adds by itself, so its rows add up to the summary line (UX-H3-7)', () => {
  const doc = kitDoc({ bg: true }, { audio: true });
  doc.song = { name: 'a.mp3', sha1: 'x', duration: 30 };
  for (const [audioCodec, want] of [[null, ['wav', 'readme']], ['opus', ['wav', 'readme']], ['mp4a.40.2', ['readme']]]) {
    const env = { audioCodec, songReady: true };
    assert.deepEqual(OUT.kitAlways(doc, PLAN, env), want, String(audioCodec));
    const ticked = OUT.KIT_KEYS.filter((k) => doc.output.kit[k]).length;
    assert.equal(1 + ticked + want.length, OUT.summary(doc, PLAN, Object.assign({ dirAccess: true }, env)).params.n,
      '完成動画 + the ticked boxes + these rows = the summary\'s count (' + audioCodec + ')');
  }
  assert.deepEqual(OUT.kitAlways(kitDoc(), PLAN, { audioCodec: null, songReady: false }), ['readme'], 'no song, no WAV');
});
