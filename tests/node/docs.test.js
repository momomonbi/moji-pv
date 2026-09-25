/* 文字PVメーカー v2 — original work. Tests that the documents say what the code does: DESIGN_2_1 §11.4.3 (WebM frame times, VP9 levels), the ParamSpec field optKey (D§4.2, DESIGN_2_1 §3.5, §9, §11.9.1), SPEC.md for v2.1 and the AI guide (docs/AI_GUIDE.md, README). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');

const MV = load();
const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// The text of the Markdown section whose heading line matches `heading`, up to the next heading of its level or higher.
function section(text, heading) {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => heading.test(l));
  assert.ok(at >= 0, 'section ' + heading);
  const level = lines[at].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i++) {
    const h = /^(#+) /.exec(lines[i]);
    if (h && h[1].length <= level) { end = i; break; }
  }
  return lines.slice(at, end).join('\n');
}

// ---- DESIGN_2_1 §11.4.3 (review DTC-2) ----------------------------------------------------------------------------------

test('DESIGN_2_1 §11.4.3 lists every VP9 level media/samples gives within the §11.2.8 limits', () => {
  const SM = MV.use('media/samples');
  const s = section(read('docs/DESIGN_2_1.md'), /^#### 11\.4\.3 /);
  const m = /table of size and rate:\s*`([0-9, ]+)`/.exec(s);
  assert.ok(m, 'the level list');
  const listed = m[1].split(',').map((x) => Number(x.trim()));
  // picture sizes up to 4096 × 2176 and 1–120 fps, the largest video §11.2.8 accepts
  const sizes = [[64, 36], [320, 180], [426, 240], [640, 360], [854, 480], [1280, 720], [1920, 1080], [2560, 1440],
    [3840, 2160], [4096, 2176]];
  const reached = new Set();
  for (const [w, h] of sizes) for (let fps = 1; fps <= 120; fps++) reached.add(SM.vp9Level(w, h, fps));
  assert.deepEqual([...reached].sort((a, b) => a - b), listed);
  // "Level 52 is for 3840×2160 at 71 fps or more"; "a stream beyond the table gets 62"
  assert.match(s, /Level 52 is for 3840×2160 at 71 fps or more/);
  assert.equal(SM.vp9Level(3840, 2160, 70), 51);
  assert.equal(SM.vp9Level(3840, 2160, 71), 52);
  assert.match(s, /a stream beyond the table gets 62/);
  assert.equal(SM.vp9Level(7680, 4320, 30), 62);
});

test('DESIGN_2_1 §11.4.3 states the WebM snap to the DefaultDuration grid (the lead decision media/matroska follows)', async () => {
  const s = section(read('docs/DESIGN_2_1.md'), /^#### 11\.4\.3 /);
  const frames = s.slice(s.indexOf('- **Frames.**'), s.indexOf('- **Laced video blocks**'));
  assert.ok(frames.length > 0, 'the Frames item');
  assert.match(frames, /Frame time = `\(ClusterTimestamp \+ relative\) · TimestampScale \/ 1e9` seconds/);
  assert.match(frames, /has a `DefaultDuration` and every block time, counted\s+from the first frame, is within 0\.5 ms of `i · DefaultDuration`/);
  assert.match(frames, /the frame time is\s+`i · DefaultDuration`\. Otherwise the stored times are kept/);
  // the tolerance the text names is the code's: 30-fps frames stored in whole milliseconds snap (0.33 ms off); one
  // frame 0.67 ms off does not. On a 33.55 ms grid whole milliseconds come 0.45 or 0.55 ms off: 0.5 ms within 0.05 ms.
  const H = require('../helpers/make_media_fixtures.js').helpers;
  const MKV = MV.use('media/matroska');
  const ptsOf = async (times, defaultDuration = 33333333) => {
    const mk = H.matroska({ doc: 'webm', durationMs: 150, frames: times.map((time, i) => ({ time, key: i === 0, data: H.payload('d', i, 9) })),
      tracks: [H.videoTrack({ codec: 'V_VP8', defaultDuration })] });
    const read = async (at, n) => mk.bytes.subarray(at, at + n);
    return Array.from((await MKV.parse(read, mk.bytes.length)).tracks[0].table.pts);
  };
  const snapped = await ptsOf([0, 33, 67, 100]);
  assert.ok(Math.abs(snapped[2] - 2 * 0.033333333) < 1e-9, 'within 0.5 ms: i · DefaultDuration (' + snapped[2] + ')');
  assert.deepEqual(await ptsOf([0, 34, 67, 100]), [0, 0.034, 0.067, 0.1], '0.67 ms off the grid: the stored times stay');
  const near = await ptsOf([0, 34, 67, 101], 33550000);
  assert.ok(Math.abs(near[1] - 0.03355) < 1e-9, '0.45 ms off the grid: snapped (' + near[1] + ')');
  assert.deepEqual(await ptsOf([0, 33, 67, 101], 33550000), [0, 0.033, 0.067, 0.101], '0.55 ms off the grid: the stored times stay');
});

// ---- the ParamSpec field optKey (review DTC-3) ---------------------------------------------------------------------------

test('optKey is recorded in D§4.2, DESIGN_2_1 §3.5, §9 and §11.9.1, with the rule core/schema.validateSpec applies', () => {
  const S = MV.use('core/schema');
  const K = MV.use('parts/kit');
  const d21 = read('docs/DESIGN_2_1.md');
  const m = /`optKey` \([^)]*enum only, an identifier `([^`]+)`\)/.exec(section(d21, /^### 3\.5 /));
  assert.ok(m, '§3.5 names optKey, for enums only, with its pattern');
  const pattern = new RegExp(m[1]);
  const label = { ja: 'x', en: 'x' };
  for (const key of ['depth', 'aB9', 'Depth', '9a', 'a-b', 'a_b', 'a.b', '']) {
    const errors = S.validateSpec('p', { type: 'enum', of: ['a', 'b'], optKey: key, label, auto: { value: 'a' } });
    assert.equal(errors.length === 0, pattern.test(key), 'optKey ' + JSON.stringify(key));
  }
  assert.equal(S.validateSpec('p', { type: 'num', min: 0, max: 1, optKey: 'depth', label, auto: { value: 0 } }).length, 1,
    'enum only');
  assert.equal(K.mediaParams({ use: 'ground' }).depth.optKey, 'depth');
  assert.match(section(d21, /^#### 11\.9\.1 /), /The spec sets `optKey: 'depth'`/);
  assert.ok(d21.split('\n').some((l) => l.startsWith('| §4.2 |') && l.includes('`optKey`')), '§9 has a D§4.2 row for optKey');
  assert.match(section(read('docs/DESIGN.md'), /^### 4\.2 /), /^ {2}optKey, +\/\/ enum only \(v2\.1, DESIGN_2_1 §3\.5\)/m);
});

// ---- SPEC.md for v2.1 (review DTC-4) --------------------------------------------------------------------------------------

const STRINGS = MV.use('i18n/strings');
const ja = (key) => STRINGS[key][0];
const en = (key) => STRINGS[key][1];

test('SPEC §7 names every output format as step ④ labels it, the Filmora set\'s files, and the package as the default save', () => {
  const Dc = MV.use('core/doc');
  const s7 = section(read('docs/SPEC.md'), /^## 7\. /);
  for (const f of Dc.OUTPUT_CHOICES.format) assert.ok(s7.includes(ja('exp.fmt.' + f)), 'format ' + f);
  // the Filmora set: the main MP4 always; each of output.kit optional, "on by default" as KIT_DEFAULT has it
  const kit = s7.slice(s7.indexOf('- **Filmora用'), s7.indexOf('- PNG sequence'));
  assert.match(kit, /the finished MP4 always, and optionally/);
  const optional = kit.slice(kit.indexOf('optionally'));
  for (const key of Dc.KIT_KEYS) {
    const name = ja('exp.kit.' + key).replace(/（[^）]*）$/, '');
    const m = new RegExp(name + ' \\(([^)]*)\\)').exec(optional);
    assert.ok(m, 'kit file ' + key + ' (' + name + ') among the optional ones');
    assert.equal(/on by default/.test(m[1]), Dc.KIT_DEFAULT[key], key + ': ' + m[1]);
  }
  // 保存 keeps the kind of the open file (DESIGN_2_1 §12.3, as ui/project_io.save does)
  assert.match(s7, /名前を付けて保存 \(and 保存 of a work that has no file yet\) writes the project package `\.mojipv`\s+by default/);
  assert.match(s7, /保存 keeps the kind of the open file: a work opened\s+from, or last saved to, a `\.json` gets a light save again/);
  assert.match(section(read('docs/DESIGN_2_1.md'), /^### 12\.3 /),
    /\*\*Ctrl\+S \(保存\)\*\* writes the same kind as the current file handle: a `\.mojipv` handle gets a package, a `\.json`\s+handle a light save/);
  assert.doesNotMatch(s7, /保存 \/ 名前を付けて保存 write/, 'the v2.1 draft sentence is gone');
  assert.match(s7, /軽い保存 writes the project alone as `\.json`/);
  assert.match(s7, /never deletes a file or folder that it did not create itself/);
});

test('SPEC §8 names the v2.1 AI tools as the app labels them, and what is and is not sent', () => {
  const s8 = section(read('docs/SPEC.md'), /^## 8\. /);
  for (const key of ['ai.tool.prep', 'ai.tool.direct', 'ai.board.title', 'ai.camera.run', 'ai.direct.allowMaterials',
    'ai.direct.allowMedia', 'ai.tool.material', 'ai.tool.vision']) assert.ok(s8.includes(ja(key)), key + ': ' + ja(key));
  assert.match(s8, /each photo or video only as\s+`asset:<n>` with its kind, size, length and shape/);
  assert.match(s8, /The box is on by default, under 詳しく\. With it off, no number, kind, size, length, shape or description\s+of a/);
  assert.match(s8, /photo or video is sent \(only the part names, such as `photoPan`, tell that a background shows one\)/);
  assert.doesNotMatch(s8, /nothing about photos and videos is sent/);
  assert.match(s8, /pictures only for 写真の説明, to Google Gemini, after a consent that is asked every time/);
  assert.match(s8, /Never sent: file names \(of photos, videos or the song\), and the key to anyone but the chosen service/);
  assert.doesNotMatch(s8, /Only lyric text, the instruction and setting values are sent/, 'the v2.0 sentence is gone');
});

// ---- the AI guide and the READMEs (review DTC-5) --------------------------------------------------------------------------

function guideParts() {
  const text = read('docs/AI_GUIDE.md');
  const at = text.indexOf('## AI assist guide (English)');
  assert.ok(at > 0, 'the English part');
  return { ja: text.slice(0, at), en: text.slice(at) };
}

// The first column of the Markdown table under the header row `header`.
function firstColumn(text, header) {
  const lines = text.split('\n');
  const at = lines.indexOf(header);
  assert.ok(at >= 0, 'table ' + header);
  const out = [];
  for (let i = at + 2; i < lines.length && lines[i].startsWith('|'); i++) out.push(lines[i].split('|')[1].trim());
  return out;
}

test('the AI guide names the v2.1 tools and controls as the app labels them, in Japanese and in English', () => {
  const g = guideParts();
  const keys = ['ai.tool.direct', 'ai.direct.work', 'ai.direct.sel', 'ai.direct.area', 'ai.direct.pickArea', 'ai.camera.run',
    'ai.direct.allowMaterials', 'ai.direct.allowMedia', 'ai.board.open', 'ai.board.title', 'ai.board.addSel', 'ai.board.send',
    'ai.board.max', 'ai.grp.outside', 'insp.askAi', 'insp.askArea', 'insp.askCut', 'ai.tool.material', 'pb.makeAi', 'mat.remake',
    'mat.pool', 'ai.materialsFailed', 'media.askAi', 'ai.tool.vision', 'ai.visionSend', 'ai.visionOnlyGemini', 'ai.visionMissing',
    'param.depth', 'opt.depth.anim', 'opt.depth.front', 'opt.depth.back', 'opt.depth.still', 'cmd.pref.ai', 'cmd.file.clearDevice',
    'pb.tab.mine'];
  const shown = (text) => text.replace(/ \{n\}$/, '');       // a tab label without its count
  for (const key of keys) {
    assert.ok(g.ja.includes(shown(ja(key))), key + ' (ja): ' + ja(key));
    assert.ok(g.en.includes(shown(en(key))), key + ' (en): ' + en(key));
  }
  // the part browser's tab is マイ素材 / Mine; My materials is the section of 作品全体
  assert.ok(g.en.includes('the **' + shown(en('pb.tab.mine')) + '** tab of the part browser'), 'the Mine tab');
  assert.ok(!g.en.includes(en('sec.materials') + ' in the part browser') && !g.en.includes(en('sec.materials') + ' in the part\n'),
    'no "' + en('sec.materials') + '" tab in the part browser');
  // ひとこと修正 was replaced by 指示 (DESIGN_2_1 §6.2): the guide no longer sends anyone to it
  assert.ok(!g.ja.includes(ja('ai.name.edit')) && !g.en.includes(en('ai.name.edit')), 'no ' + ja('ai.name.edit'));
});

test('the AI guide says what is sent and what never is: file names, pictures only after the confirmation of every time', () => {
  const g = guideParts();
  const sent = section(g.ja, /^## 10\. /);
  assert.match(sent, /写真・動画・曲の \*\*ファイル名\*\*（どの道具でも送りません）/);
  assert.match(sent, /番号（asset:0 など）・種類・大きさ・長さ・形/);
  assert.match(sent, /指示の「詳しく」の中にあり、はじめはオンです/);
  const off = 'オフのときは、写真・動画の番号・種類・大きさ・長さ・形・説明を送りません（背景などが写真・動画かどうかは、部品の名前として伝わります）';
  assert.ok(sent.includes(off), '§10: what the box off still lets through');
  assert.ok(section(g.ja, /^## 4\. /).includes('はじめはオンです。') && section(g.ja, /^## 4\. /).includes(off), '§4');
  assert.match(section(g.ja, /^### 7\.1 /), /オフにすると、写真・動画の番号・種類・大きさ・長さ・形・説明を送りません/);
  assert.ok(!g.ja.includes('写真・動画のことは何も送りません'), 'the part names do tell');
  assert.match(sent, /毎回出る確認で \*\*送って説明してもらう\*\* を押したときだけ、小さくした JPEG を Google Gemini に送ります/);
  assert.match(section(g.ja, /^### 7\.2 /), /\*\*押すたびに、送る前に確認が出ます。\*\*/);
  assert.match(section(g.ja, /^## 5\. /), /\*\*写真・動画をAIが使ってよい\*\* と同じ設定に従います/);
  assert.match(g.en, /Never sent: the \*\*file names\*\* of photos, videos or the song \(by any tool\)/);
  assert.match(g.en, /\*\*Every time\*\*, a\s+confirmation first says what will be sent/);
  assert.match(g.en, /It follows the same \*\*AI may use photos and videos\*\* setting as Instruction/);
  assert.match(g.en, /With the box off,\s+no number, kind, size, length, shape or description of your photos and videos is sent/);
  assert.match(g.en, /\(only the part names tell\s+that a background or a frame shows a photo or video\)/);
  assert.match(g.en, /with it off \(it is on by default\), none of that, and\s+only the part names tell that a background shows a photo or video/);
  assert.match(g.en, /\(shown when you have photos or videos on this\s+device; on by default\)/);
  assert.doesNotMatch(g.en, /nothing about (them|your photos)/);
});

// The v21 work with the media library: 空.jpg is in おまかせ (pool), so the effective registry has a ground derived from
// it, labelled with its file name (parts/mix.mediaDef).
function mediaWork() {
  const M = MV.use('core/migrate');
  const CMD = MV.use('core/commands');
  const corpus = require('../helpers/corpus.js');
  let doc = M.parseFile(corpus.projectText('v21')).doc;
  for (const entry of M.parseFile(corpus.projectText('media')).doc.media.list) doc = CMD.reduce(doc, { t: 'media.put', entry });
  const base = MV.use('parts/catalog').defaultRegistry();
  return { doc, base, registry: MV.use('parts/mix').registryFor(base, doc.materials, doc.media) };
}

test('the guide\'s "file names are never sent" holds for every prompt that lists parts, with a photo in おまかせ', () => {
  const LOOKS = MV.use('ai/looks');
  const DIRECT = MV.use('ai/direct');
  const RECIPE = MV.use('ai/recipe');
  const { doc, registry } = mediaWork();
  const derived = registry.pool('ground', { filters: doc.filters, season: 'any' })
    .filter((k) => registry.extra[k] && registry.extra[k].media === true);
  assert.equal(derived.length, 1, 'the pooled photo is a ground auto picks may use');
  const plan = MV.use('planner/plan').plan(doc, { registry });
  const brief = { briefs: [{ ref: { kind: 'work' }, instruction: 'サビを派手に' }], mode: 'all' };
  const requests = {
    'AIに3案': LOOKS.proposalsRequest(doc, plan, registry, 'ja'),
    'AI proposals (en)': LOOKS.proposalsRequest(doc, plan, registry, 'en'),
    'edit': LOOKS.editRequest(doc, plan, registry, 'サビを派手に', 'ja'),
    '指示 (photos off)': DIRECT.directRequests(doc, plan, registry, Object.assign({ uiLang: 'ja' }, brief))[0],
    '素材づくり': RECIPE.materialRequest(doc, plan, registry, { description: '空の背景', kind: 'ground', uiLang: 'ja' }),
  };
  for (const [tool, req] of Object.entries(requests)) {
    const text = req.system + '\n' + req.prompt;
    for (const e of doc.media.list) assert.ok(!text.includes(e.name), tool + ' sends the file name ' + e.name);
  }
});

test('with 写真・動画をAIが使ってよい off, 指示 sends no number, size, length or description of a photo; the part name tells', () => {
  const DIRECT = MV.use('ai/direct');
  const { doc: work, registry } = mediaWork();
  const sky = work.media.list.find((e) => e.name === '空.jpg');
  const doc = MV.use('core/commands').reduce(work, { t: 'batch', cmds: [{ t: 'pin.set', path: 'work:ground', v: 'photoPan', by: 'user' },
    { t: 'pin.set', path: 'work:ground@photoPan.image', v: sky.id, by: 'user' }] });
  const plan = MV.use('planner/plan').plan(doc, { registry });
  const ask = (media) => DIRECT.directRequests(doc, plan, registry, { briefs: [{ ref: { kind: 'work' }, instruction: 'x' }],
    uiLang: 'ja', mode: 'all', media })[0];
  const off = ask(false);
  const text = off.system + '\n' + off.prompt;
  assert.match(off.prompt, /ground=photoPan\(photo\)/, 'the part name tells that the background is a photo');
  assert.doesNotMatch(text, /asset:\d/, 'no number');
  for (const e of doc.media.list) {
    assert.ok(!text.includes(e.w + '×' + e.h), 'no size of ' + e.name);
    if (e.ai) assert.ok(!text.includes(e.ai.caption.ja) && !e.ai.colors.some((c) => text.includes(c)), 'no description of ' + e.name);
  }
  // on (the default), the same work refers to its photos by number, size and description
  const on = ask(true).prompt;
  assert.match(on, /ground=photoPan\(asset:\d+\)/);
  assert.ok(on.includes(sky.w + '×' + sky.h) && on.includes(sky.ai.caption.ja), 'on: size and description');
});

test('the AI tools read the project\'s parts as they are now: its materials are sent by name (AI guide §10)', () => {
  const AP = MV.use('ui/ai_panel');
  const { doc, base, registry } = mediaWork();
  // the AI panel is mounted before a saved work is restored (ui/boot): its host reads app.reg when a request is made
  let now = base;
  const host = AP.hostOf({ t: null, lang: 'ja', get reg() { return now; } });
  now = registry;
  assert.equal(host.registry, registry, 'the registry of the restored work');
  const plan = MV.use('planner/plan').plan(doc, { registry: host.registry });
  assert.match(MV.use('ai/looks').proposalsRequest(doc, plan, host.registry, 'ja').prompt, /myMat1=ふわり着地/,
    'AIに3案: a material in おまかせ is listed by name');
  // 指示 lists every material of the project (a material's mine.media is the list of pictures it uses, [] here)
  const direct = MV.use('ai/direct').directRequests(doc, plan, host.registry, { briefs: [{ ref: { kind: 'work' }, instruction: 'x' }],
    uiLang: 'ja', mode: 'all' })[0].prompt;
  const mine = direct.slice(direct.indexOf('Materials of this project:'));
  for (const m of doc.materials.list) assert.ok(mine.includes('=' + m.name.ja + ' ' + m.kind), '指示 lists ' + m.name.ja);
  assert.match(section(guideParts().ja, /^## 10\. /), /部品やマイ素材の名前/);
});

test('the messages the AI guide quotes are the app\'s own (troubleshooting tables and disabled reasons)', () => {
  const g = guideParts();
  const values = (i) => Object.values(STRINGS).map((pair) => pair[i]);
  const known = (i, text) => values(i).some((v) => v.startsWith(text));
  for (const [i, part, header] of [[0, g.ja, '| 表示 | すること |'], [1, g.en, '| Message | What to do |']]) {
    for (const cell of firstColumn(part, header)) {
      for (const piece of cell.split(' / ')) {
        const text = piece.replace(/\s*…$/, '');
        assert.ok(known(i, text), 'a string of the app: ' + text);
      }
    }
  }
  const jaWhy = g.ja.slice(g.ja.indexOf('ボタンが押せないときは'));
  const jaQuotes = [...jaWhy.slice(0, jaWhy.indexOf('\n\n')).matchAll(/「([^」]+)」/g)].map((m) => m[1]);
  const enWhy = g.en.slice(g.en.indexOf('A disabled button says why'));
  const enQuotes = [...enWhy.slice(0, enWhy.indexOf('\n\n')).matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(jaQuotes.length >= 5 && enQuotes.length >= 5, 'the disabled reasons are found');
  for (const q of jaQuotes) assert.ok(values(0).includes(q), 'ja: ' + q);
  for (const q of enQuotes) assert.ok(values(1).includes(q), 'en: ' + q);
});

test('the READMEs list the v2.1 AI tools, say file names are never sent, and link the AI guide', () => {
  for (const [file, i] of [['README.md', 0], ['README.en.md', 1]]) {
    const ai = section(read(file), i === 0 ? /^## AI アシスト/ : /^## AI assist/);
    const label = (key) => STRINGS[key][i];
    for (const key of ['ai.tool.direct', 'ai.board.title', 'ai.tool.material', 'ai.tool.vision', 'ai.direct.allowMedia']) {
      if (i === 1 && key === 'ai.board.title') assert.ok(ai.includes('Instructions per section'), file + ': ' + key);
      else assert.ok(ai.includes(label(key)), file + ': ' + key + ' ' + label(key));
    }
    assert.ok(!ai.includes(label('ai.name.edit')), file + ': no ' + label('ai.name.edit'));
    assert.match(ai, i === 0 ? /ファイル名はどれも送りません/ : /File names are never sent/);
    assert.ok(ai.includes('[docs/AI_GUIDE.md](docs/AI_GUIDE.md)'), file + ' links the guide');
  }
});
