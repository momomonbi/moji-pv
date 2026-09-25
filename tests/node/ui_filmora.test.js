/* 文字PVメーカー v2 — original work. Tests for the pure parts of 「Filmoraで使うには」 (ui/filmora_help), the README's steps it shares, and ≡ › ファイル › 字幕（.srt）を保存 (ui/menus) (DESIGN_2_1 §13.8–§13.10). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const HELP = MV.use('ui/filmora_help');
const MENUS = MV.use('ui/menus');
const KIT = MV.use('export/host/kit');
const S = MV.use('export/schedule');
const SUB = MV.use('export/subtitles');
const D = MV.use('core/doc');
const T = MV.use('i18n/t');
const STRINGS = MV.use('i18n/strings');
const PL = MV.use('planner/plan');
const REG = MV.use('parts/catalog').defaultRegistry();

// project_basic as the Filmora set, with the given contents; its plan.
function world(kit, over) {
  const doc = corpus.project('basic').doc;
  doc.output = Object.assign({}, doc.output, { format: 'kit', kit: Object.assign({}, D.KIT_DEFAULT, kit || {}) }, over || {});
  return { doc, plan: PL.plan(doc, { registry: REG }) };
}

const ALL = { overlay: true, bg: true, green: true, srt: true, lrc: true };

test('the guide before the export: the numbered steps everyone follows, the other files only when needed, then the files', () => {
  const { doc, plan } = world(ALL, { short: 1080, fps: 30 });
  const info = HELP.planned(doc, plan, { audioCodec: null, songReady: false });
  const base = S.kitBase(doc);
  assert.deepEqual(info.files.map((f) => f.name), [base + '.mp4', base + '_overlay.webm', base + '_bg.mp4', base + '_green.mp4',
    base + '.srt', base + '.lrc', 'README_Filmora.txt'], 'export/schedule.kitFiles, in its order');
  assert.deepEqual([info.w, info.h, info.fps, info.folder, info.parent, info.zip], [1920, 1080, 30, null, null, null]);
  for (const lang of ['ja', 'en']) {
    const t = T.createT(lang, STRINGS);
    const g = HELP.guide(info, t);
    assert.equal(g.intro, t('kit.help.before'), lang + ': the export has not made them yet');
    assert.deepEqual(g.files.map((f) => f.label), ['exp.kit.main', 'exp.kit.overlay', 'exp.kit.bg', 'exp.kit.green', 'exp.kit.srt',
      'exp.kit.lrc', 'exp.kit.readme'].map((k) => t(k)), lang + ': every file says what it is');
    // numbered: only the path everyone follows (the project settings, the main MP4 at 0:00; no WAV without a song)
    assert.deepEqual(g.steps, [t('kit.help.1', { w: 1920, h: 1080, fps: 30 }), t('kit.help.2', { main: base + '.mp4' })], lang);
    assert.equal(g.align, t('kit.help.align'), lang + ': every file at 0:00');
    // 「必要なときだけ」: each other file's use says when, so following 1…n never puts the lyrics on screen twice
    assert.deepEqual(g.extras, [
      { kind: 'overlay', text: t('kit.help.3', { overlay: base + '_overlay.webm' }) }, { kind: 'bg', text: t('kit.help.bg', { bg: base + '_bg.mp4' }) },
      { kind: 'green', text: t('kit.help.4', { green: base + '_green.mp4' }) }, { kind: 'srt', text: t('kit.help.5', { srt: base + '.srt' }) }], lang);
    assert.equal(g.key, '#00B140', 'the green screen\'s key colour');
    assert.ok(g.extras[2].text.includes('#00B140'), lang + ': the key colour is in the green screen\'s use');
    // every file that goes on the timeline goes at 0:00 (UX-H3-1): the main MP4, the overlay, the background, the green
    for (const text of [g.steps[1], ...g.extras.filter((x) => x.kind !== 'srt').map((x) => x.text)]) assert.ok(text.includes('0:00'), lang + ': ' + text);
  }
  const ja = HELP.guide(info, T.createT('ja', STRINGS));
  assert.equal(ja.steps[0], 'Filmoraで新しいプロジェクトを作り、1920×1080・30fps にします。');
  assert.equal(ja.extras[1].text, '背景だけを使うときは、「' + base + '_bg.mp4」を下のトラックの 0:00 に置き、その上に自分の文字や映像を重ねます。');
  assert.equal(ja.extras[2].text, 'グリーンバックで重ねるときは、「' + base + '_green.mp4」を上のトラックの 0:00 に置き、クロマキー（緑幕）をオンにして色 #00B140 を選び、許容範囲を少し上げます。',
    'the how-to line of DESIGN_2_1 §13.6');
  assert.equal(ja.extras[3].text, '歌詞を字幕として別に出したいときだけ、「' + base + '.srt」を読み込みます（完成動画には歌詞がもう入っています）。');
});

test('the guide after the export: the folder (inside the picked one) or the ZIP, the files written, and only the steps that apply', () => {
  const size = { w: 1280, h: 720, fps: 24 };
  const folder = { files: [{ name: 'a.mp4', kind: 'main', bytes: 10 }, { name: 'a.wav', kind: 'wav', bytes: 5 },
    { name: 'README_Filmora.txt', kind: 'readme', bytes: 1 }], folder: 'a_filmora (2)', ms: 1, audio: 'wav' };
  const t = T.createT('ja', STRINGS);
  const f = HELP.guide(HELP.written(folder, size), t);
  assert.equal(f.intro, 'ファイルはフォルダ「a_filmora (2)」に入っています。', 'the folder openDirectory made (a free name)');
  const picked = HELP.guide(HELP.written(Object.assign({ parent: '動画' }, folder), size), t);
  assert.equal(picked.intro, 'ファイルは、選んだフォルダ「動画」の中のフォルダ「a_filmora (2)」に入っています。', 'and the folder the user picked');
  // the WAV right after the main MP4: that MP4 has no sound (UX-H3-3)
  assert.deepEqual(f.steps, ['Filmoraで新しいプロジェクトを作り、1280×720・24fps にします。', '「a.mp4」を読み込み、タイムラインの 0:00 に置きます。',
    '完成動画には音が入っていません。「a.wav」を音声トラックの 0:00 に置きます。'], 'no overlay, green or subtitles in this set');
  assert.deepEqual(f.extras, [], 'nothing optional in this set');
  assert.equal(f.key, null, 'no key colour without the green screen');
  assert.deepEqual(f.files.map((x) => x.label), ['完成動画（MP4）', '曲（WAV）', '使い方（README）']);
  const zip = Object.assign({}, folder, { folder: 'a_filmora', name: 'a_filmora.zip', blob: {}, parent: '動画' });
  const z = HELP.guide(HELP.written(zip, size), T.createT('en', STRINGS));
  assert.equal(z.intro, 'Extract "a_filmora.zip" first (for example, right-click → Extract All), then use the files inside.');
  assert.equal(z.same, 'The same steps are in "README_Filmora.txt".');
  assert.equal(HELP.written(zip, size).parent, null, 'a ZIP is not in a picked folder');
});

test('README_Filmora.txt holds the guide word for word — the steps, the 0:00 line and 「必要なときだけ」 — and labels every file', () => {
  const { doc, plan } = world(ALL, { short: 1080, fps: 30, audio: true });
  doc.song = { name: 'song.mp3', sha1: 'x', duration: plan.duration };
  const info = HELP.planned(doc, plan, { audioCodec: 'opus', songReady: true });
  assert.ok(info.files.some((f) => f.kind === 'wav'), 'no AAC: the song is a WAV file');
  const readme = KIT.readme(info.files, info);
  const lines = readme.split('\r\n');
  for (const lang of ['ja', 'en']) {
    const t = T.createT(lang, STRINGS);
    const g = HELP.guide(info, t);
    assert.equal(g.steps.length, 3, lang + ': project, main, WAV');
    assert.equal(g.steps[2], t('kit.help.6', { wav: S.kitBase(doc) + '.wav' }), lang + ': the WAV right after the main MP4');
    const first = lines.indexOf('1. ' + g.steps[0]);
    assert.ok(first > 0, lang + ': the steps are numbered in the README');
    g.steps.forEach((s, k) => assert.equal(lines[first + k], k + 1 + '. ' + s, lang + ' step ' + (k + 1)));
    // then the 0:00 line, and 「必要なときだけ」 with each use
    assert.deepEqual(lines.slice(first + g.steps.length, first + g.steps.length + 4 + g.extras.length),
      ['', g.align, '', t('kit.help.optional'), ...g.extras.map((x) => '- ' + x.text)], lang + ': the 0:00 line and the uses');
    assert.equal(g.extras.length, 4, lang + ': overlay, background, green screen, subtitles');
    // every file line has its label (the WAV too, UX-H3-9); the README does not list itself
    const listed = lines.filter((l) => l.startsWith('- ') && info.files.some((f) => l.startsWith('- ' + f.name + ' ')));
    assert.equal(listed.length, 2 * (info.files.length - 1), 'every file but the README, in both languages');
    for (const l of listed) assert.match(l, / : \S/, 'labelled: ' + l);
  }
  assert.ok(readme.includes('- ' + S.kitBase(doc) + '.wav : 曲（WAV）\r\n') && readme.includes('- ' + S.kitBase(doc) + '.wav : Song (WAV)\r\n'));
  assert.deepEqual(KIT.steps(T.createT('en', STRINGS), [{ name: 'x.mp4', kind: 'main' }, { name: 'x_bg.mp4', kind: 'bg' }], { w: 1, h: 2, fps: 3 }),
    ['Create a new Filmora project at 1×2, 3 fps.', 'Import "x.mp4" and place it at 0:00 on the timeline.']);
  assert.deepEqual(KIT.extras(T.createT('en', STRINGS), [{ name: 'x.mp4', kind: 'main' }, { name: 'x_bg.mp4', kind: 'bg' }]),
    [{ kind: 'bg', text: 'To use the background only, place "x_bg.mp4" on a lower track at 0:00 and put your own titles or footage above it.' }]);
});

test('≡ › ファイル › 字幕（.srt）を保存: the whole video, UTF-8 with a BOM and CRLF, named like the video', async () => {
  const { doc, plan } = world({}, { name: '朝の窓 ライブ', range: { t0: 5, t1: 6 } });
  const saved = [];
  const app = { plan, doc, io: { saveText: async (text, name, type) => { saved.push({ text, name, type }); } } };
  await MENUS.saveSrt(app);
  assert.equal(saved.length, 1);
  const { text, name, type } = saved[0];
  assert.equal(name, '朝の窓 ライブ.srt', 'the video\'s name (export/schedule.kitBase) + .srt');
  assert.equal(type, 'text/plain');
  assert.ok(text.startsWith(SUB.BOM + '1\r\n'), 'the BOM, then the first cue');
  assert.equal(text, SUB.BOM + SUB.srt(plan), 'the whole video, not the export range (DESIGN_2_1 §13.8)');
  assert.ok(!/(^|[^\r])\n/.test(text), 'CRLF only');
  const cues = text.slice(1).split('\r\n\r\n').filter(Boolean);
  assert.equal(cues.length, plan.lines.length, 'one cue per sung line');
  assert.equal(cues[0].split('\r\n')[1].slice(0, 9), '00:00:' + String(Math.floor(plan.lines[0].t0)).padStart(2, '0') + ',',
    'song times from 0:00, whatever the export range');
  // nothing to save without lines (the action is disabled then)
  assert.equal(MENUS.saveSrt({ plan: Object.assign({}, plan, { lines: [] }), doc, io: app.io }), null);
  assert.equal(saved.length, 1);
});
