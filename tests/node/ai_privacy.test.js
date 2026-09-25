/* 文字PVメーカー v2 — original work. The owner's rule for every AI tool: the user's photo and video file names never reach a prompt (DESIGN_2_1 §11.6.4). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const DI = MV.use('ai/direct');
const RECIPE = MV.use('ai/recipe');
const LOOKS = MV.use('ai/looks');
const PREP = MV.use('ai/prep');
const SONG = MV.use('ai/song');
const VISION = MV.use('ai/vision');
const PL = MV.use('planner/plan');
const MIX = MV.use('parts/mix');
const CMD = MV.use('core/commands');
const REG = MV.use('core/registry');
const M = MV.use('core/migrate');

// The v2.1 fixture with the media fixture's four assets under names that say something personal. Every asset is in
// the おまかせ pool, so the effective registry has a derived ground for each (its label is the file name on this device).
const NAMES = ['山田花子_卒業式.png', '自宅前_2026-05-10.jpg', '娘の運動会.mp4', 'passport_scan.webm'];

function docWithMedia() {
  let doc = M.parseFile(corpus.projectText('v21')).doc;
  M.parseFile(corpus.projectText('media')).doc.media.list.forEach((entry, i) => {
    doc = CMD.reduce(doc, { t: 'media.put', entry: Object.assign({}, entry, { name: NAMES[i], pool: true }) });
  });
  return doc;
}

const DOC = docWithMedia();
const BASE = REG.createRegistry(MV.use('parts/catalog').defs());
const REGISTRY = MIX.registryFor(BASE, DOC.materials, DOC.media);
const PLAN = PL.plan(DOC, { registry: REGISTRY });
const IDS = DOC.media.list.map((e) => e.id);
const JPEG = { inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } };

// Every request of every tool, as the controller builds them, in both page languages.
function requests(lang) {
  const out = [];
  const work = { kind: 'work' };
  const firstLine = { kind: 'lines', ids: [PLAN.lines[0].id] };
  const cut = { kind: 'cut', key: PLAN.lines[1].cuts[0] };
  for (const media of [true, IDS, false]) {
    for (const allowMaterials of [true, false]) {
      out.push(...DI.directRequests(DOC, PLAN, REGISTRY, { briefs: [{ ref: work, instruction: '写真を背景に' }], uiLang: lang, mode: 'all', allowMaterials, media }));
      // the board: several areas in one request
      out.push(...DI.directRequests(DOC, PLAN, REGISTRY, { briefs: [{ ref: firstLine, instruction: '明るく' }, { ref: cut, instruction: '写真' }],
        uiLang: lang, mode: 'all', allowMaterials, media }));
    }
  }
  out.push(...DI.directRequests(DOC, PLAN, REGISTRY, { briefs: [{ ref: work, instruction: '' }], uiLang: lang, mode: 'camera', media: true }));
  const sent = RECIPE.mediaSent(DOC, { lang });
  const withMedia = DOC.materials.list.find((m) => (m.recipe.layers || []).some((l) => l.prim === 'media')) || DOC.materials.list[0];
  for (const media of [sent, null]) {
    out.push(RECIPE.materialRequest(DOC, PLAN, REGISTRY, { description: '写真の枠', kind: 'ornament', uiLang: lang, media }));
    out.push(RECIPE.materialRequest(DOC, PLAN, REGISTRY, { description: 'もう少しピンクに', uiLang: lang, current: withMedia, media }));
  }
  out.push(LOOKS.proposalsRequest(DOC, PLAN, REGISTRY, lang));
  out.push(LOOKS.editRequest(DOC, PLAN, REGISTRY, '背景を写真に', lang));
  out.push(LOOKS.editRequest(DOC, PLAN, REGISTRY, '背景を写真に', lang, { lineIds: [PLAN.lines[0].id] }));
  out.push(PREP.request(DOC, lang));
  out.push(SONG.transcribeRequest(lang), SONG.alignRequest(DOC, PLAN, lang), SONG.analyzeRequest(lang));
  out.push(VISION.visionRequest(DOC, IDS.map((id) => ({ id, parts: [JPEG, JPEG, JPEG] })), { uiLang: lang }));
  return out;
}

test('no photo or video file name appears in any prompt of any tool (direct, board, camera, material, looks, edit, prep, song, vision)', () => {
  assert.ok(REGISTRY.mine && REGISTRY.mine('ground').length === NAMES.length, 'every asset has its derived ground');
  for (const lang of ['ja', 'en']) {
    const reqs = requests(lang);
    assert.ok(reqs.length > 20);
    assert.ok(reqs.some((r) => String(r.prompt).includes('[media]')), 'the [media] list is in the requests that offer media');
    for (const r of reqs) {
      const text = [r.system, r.prompt, JSON.stringify(r.schema || null)].join('\n');
      for (const e of DOC.media.list) {
        assert.ok(!text.includes(e.name), lang + ': the file name "' + e.name + '" is in a prompt:\n' + text.slice(0, 400));
        const stem = e.name.replace(/\.[a-z0-9]+$/i, '');
        assert.ok(!text.includes(stem), lang + ': the file name "' + stem + '" is in a prompt');
      }
    }
  }
});

// Decision (1) of the review: media are named by number, kind, size, length and shape; the vision text (caption, colours,
// text area, subject) goes only while 写真・動画をAIが使ってよい is on (mediaSent's `described`).
test('the [media] list: numbers, kinds, sizes, lengths and shapes; the vision text only when it is allowed', () => {
  const described = VISION.visionChanges(DOC, { items: [{ n: 0, caption: '夕方の空', captionEn: 'Evening sky', tags: ['soft'], colors: ['#F2A65A'],
    subject: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, text: { x: 0, y: 0, w: 1, h: 0.3 }, use: 'ground', depth: 'back', reason: '細部が多い' }] },
  { items: [{ n: 0, id: IDS[1] }] }).changes[0];
  const doc = CMD.reduce(DOC, { t: 'media.meta', id: IDS[1], ai: described.to });
  const on = RECIPE.mediaSent(doc, { lang: 'ja' });
  const off = RECIPE.mediaSent(doc, { lang: 'ja', described: false });
  assert.equal(on[1].line, 'asset:1 image 4032×3024 landscape — 夕方の空 · colours #F2A65A · text area: upper third · subject: upper left');
  assert.equal(off[1].line, 'asset:1 image 4032×3024 landscape');
  assert.equal(off[2].line, 'asset:2 video 0:13 1920×1080 landscape');
  for (const x of on.concat(off)) assert.ok(!x.line.includes(x.name), 'never the file name');
});

// SEC-2: the AI guide says what the always-visible notice (ai.sendsMediaList, ai.sendsMedia) and the picture consent
// (ai.visionConsent) say, in Japanese (§10) and in English ("What is sent, what is not, what is stored"); nothing about
// pictures is remembered for an asset or a project.
test('docs/AI_GUIDE.md: 送るもの and "What is sent, what is not, what is stored" say what is sent for photos and videos', () => {
  const guide = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'AI_GUIDE.md'), 'utf8');
  const section = (head) => {
    const at = guide.indexOf(head + '\n');
    assert.ok(at >= 0, head);
    const rest = guide.slice(at + head.length);
    const end = rest.search(/^#{1,3} /m);
    return (end < 0 ? rest : rest.slice(0, end)).replace(/\*\*/g, '').replace(/\s+/g, ' ');   // as read, not as wrapped
  };
  const ja = section('## 10. 送るものと送らないもの、保存されるもの');
  for (const w of ['番号・種類・大きさ・長さ・縦長か横長か', 'ファイル名は送りません', '写真・動画をAIが使ってよい', '説明・色・位置',
    'AIに説明してもらう', '区画ごとに指示', 'Google Gemini', '768px の JPEG', '動画・アニメは3枚', '送るたびに', '同意は記憶しません']) {
    assert.ok(ja.includes(w), '§10 says 「' + w + '」');
  }
  const en = section('### What is sent, what is not, what is stored');
  for (const w of ['number, kind, size, length and shape', 'never file names', 'AI may use photos and videos', 'description, colors and positions',
    'Ask AI to describe', 'Instructions per section', 'Google Gemini', '768 px', 'a video or animation sends 3 frames', 'asked every time']) {
    assert.ok(en.includes(w), '"What is sent, what is not, what is stored" says "' + w + '"');
  }
  assert.ok(!/この作品では|per asset|this project only/.test(ja + en), 'no picture consent held for an asset or a project');
});
