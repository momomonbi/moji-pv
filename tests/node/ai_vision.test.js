/* 文字PVメーカー v2 — original work. Tests for ai/vision: describing the user's photos and videos, and the Change kind media (DESIGN_2_1 §11.6.2, §11.6.4, §11.9.4). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { deepEqual } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const VI = MV.use('ai/vision');
const CH = MV.use('ai/changes');
const PR = MV.use('ai/providers');
const CMD = MV.use('core/commands');
const ST = MV.use('core/store');
const ME = MV.use('core/media');
const S = MV.use('core/schema');
const M = MV.use('core/migrate');
const T = MV.use('i18n/t');
const STRINGS = MV.use('i18n/strings');

// The media fixture (ロゴ.png, 空.jpg with a description, 海辺.mp4, きらめき.webm) plus the v2.1 lyrics, so a leak of
// lyrics into the vision prompt would show.
function docOf() {
  let doc = M.parseFile(corpus.projectText('v21')).doc;
  for (const entry of M.parseFile(corpus.projectText('media')).doc.media.list) doc = CMD.reduce(doc, { t: 'media.put', entry });
  return doc;
}
const DOC = docOf();
const A = Object.fromEntries(DOC.media.list.map((e) => [e.name, e]));
const JPEG = (data) => ({ inline_data: { mime_type: 'image/jpeg', data } });

function item(n, x) {
  return Object.assign({ n, caption: '夕方の海', captionEn: 'Evening sea', tags: ['wet', 'soft'], colors: ['#F2A65A'],
    subject: { x: 0, y: 0, w: 0, h: 0 }, text: { x: 0, y: 0, w: 1, h: 0.3 }, use: 'ground', depth: 'back', reason: '細部が多い' }, x);
}

test('VISION_SCHEMA: closed per asset, with the depth suggestion and its reason (§11.9.4)', () => {
  const p = VI.VISION_SCHEMA.properties.items.items.properties;
  deepEqual(Object.keys(p), ['n', 'caption', 'captionEn', 'tags', 'colors', 'subject', 'text', 'use', 'depth', 'reason']);
  deepEqual(p.depth.enum, ['anim', 'front', 'back', 'still']);
  deepEqual(p.use.enum, ['ground', 'frame', 'fill', 'overlay']);
  deepEqual(Object.keys(p.subject.properties), ['x', 'y', 'w', 'h']);
  assert.ok(Object.isFrozen(VI.VISION_SCHEMA) && Object.isFrozen(p.subject));
});

test('visionRequest: image parts first, JPEG only, ≤ 8 assets, a photo 1 image and a video ≤ 3; no lyrics, no file names', () => {
  const items = [
    { id: A['空.jpg'].id, parts: [JPEG('QUJD'), JPEG('REVG')] },
    { id: A['海辺.mp4'].id, parts: [JPEG('MQ=='), { inline_data: { mime_type: 'image/png', data: 'Mg==' } }, JPEG('Mw=='), JPEG('NA=='), JPEG('NQ==')] },
    { id: A['ロゴ.png'].id, parts: [{ text: 'hello' }, { file_data: { file_uri: 'x' } }] },
    { id: 'a000000000000000000000000', parts: [JPEG('Ng==')] },
    { id: A['きらめき.webm'].id, parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'Nw==' } }, JPEG('not base64!')] },
  ];
  const q = VI.visionRequest(DOC, items, { uiLang: 'ja' });
  assert.equal(q.effort, 'low');
  assert.equal(q.schema, VI.VISION_SCHEMA);
  deepEqual(q.sent.items, [{ n: 0, id: A['空.jpg'].id, kind: 'photo', frames: 1 }, { n: 1, id: A['海辺.mp4'].id, kind: 'video', frames: 3 },
    { n: 2, id: A['きらめき.webm'].id, kind: 'video', frames: 1 }]);
  deepEqual(q.media, [JPEG('QUJD'), JPEG('MQ=='), JPEG('Mw=='), JPEG('NA=='), { inlineData: { mimeType: 'image/jpeg', data: 'Nw==' } }],
    'JPEG parts only, in the order the prompt lists them');
  assert.ok(q.prompt.includes('n=0: photo (1 image)') && q.prompt.includes('n=1: video (3 frames'));
  assert.ok(q.prompt.includes('Tags (use only these): ' + S.TAGS.join(' ')));
  for (const leak of ['空.jpg', '海辺', 'ロゴ', '飛ばせ', '始発', A['空.jpg'].id]) assert.ok(!q.prompt.includes(leak) && !q.system.includes(leak), leak);
  assert.ok(q.system.includes('front only for see-through or overlay footage') && q.system.includes('still'));
  const many = Array.from({ length: 12 }, (_, i) => ({ id: DOC.media.list[i % 4].id, parts: [JPEG('QQ==')] }));
  assert.ok(VI.visionRequest(DOC, many, {}).sent.items.length <= VI.MAX_ITEMS, 'at most 8 (each asset once)');
  const eight = Array.from({ length: 10 }, (_, i) => ({ id: 'a' + String(i).padStart(24, '0'), parts: [JPEG('QQ==')] }));
  let big = DOC;
  for (const x of eight) big = CMD.reduce(big, { t: 'media.put', entry: Object.assign({}, A['空.jpg'], { id: x.id, ai: null }) });
  assert.equal(VI.visionRequest(big, eight, {}).sent.items.length, 8);
});

// I18N-3: the reason is shown next to 「AIのおすすめ」 in the page's language (§11.9.5), so the request names that language.
test('visionRequest: the reason is asked for in the page\'s language', () => {
  const items = [{ id: A['空.jpg'].id, parts: [JPEG('QUJD')] }];
  const ja = VI.visionRequest(DOC, items, { uiLang: 'ja' });
  const en = VI.visionRequest(DOC, items, { uiLang: 'en' });
  assert.ok(ja.system.includes('reason = why, in a few words (at most 60 characters, in Japanese)'), ja.system);
  assert.ok(en.system.includes('reason = why, in a few words (at most 60 characters, in English)'), en.system);
  assert.equal(ja.prompt, en.prompt, 'only the language of the reason differs');
  assert.equal(VI.visionRequest(DOC, items, {}).system, ja.system, 'ja by default');
});

test('the provider: image parts precede the prompt for Gemini; the other service takes no media', async () => {
  const q = VI.visionRequest(DOC, [{ id: A['空.jpg'].id, parts: [JPEG('QUJD')] }], { uiLang: 'en' });
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: '{"items":[]}' }] } }] }) };
  };
  await PR.call({ provider: 'gemini', apiKey: 'k', system: q.system, prompt: q.prompt, schema: q.schema, effort: q.effort, media: q.media, fetchImpl });
  deepEqual(seen[0].contents[0].parts, [JPEG('QUJD'), { text: q.prompt }]);
  await assert.rejects(PR.call({ provider: 'claude', apiKey: 'k', system: '', prompt: '', schema: q.schema, media: q.media, SDK: class {} }),
    (e) => e.code === 'no_audio');
});

test('visionChanges: captions cleaned and cut, tags from the vocabulary, #RRGGBB colours ≤ 5, boxes clamped, depth kept', () => {
  const q = VI.visionRequest(DOC, [{ id: A['海辺.mp4'].id, parts: [JPEG('QQ==')] }, { id: A['空.jpg'].id, parts: [JPEG('QQ==')] }], {});
  const json = { items: [
    item(0, { caption: '  海/辺*の|夕#方 {x}\n' + 'あ'.repeat(80), captionEn: 'Sea\u0007 at dusk', tags: ['wet', 'sunny', 'wet', 'airy'],
      colors: ['#f2a65a', 'red', '#123', '#AABBCC', '#aabbcc', '#000000', '#111111', '#222222', '#333333'],
      subject: { x: 0.8, y: -1, w: 0.5, h: 2 }, text: { x: 0, y: 0, w: 0, h: 0.5 }, use: 'fill', depth: 'back', reason: '動きの強い動画\nです' + 'い'.repeat(80) }),
    item(1, { depth: 'sideways' }),
    item(7),
    item(0, { caption: 'second answer for n=0 is ignored' }),
  ] };
  const r = VI.visionChanges(DOC, json, q.sent, { rev: 4 });
  deepEqual(r.warnings, [['ai.warn.mediaUnknown', { name: 'n=7' }]]);
  assert.equal(r.changes.length, 2);
  const [sea, sky] = r.changes;
  assert.deepEqual([sea.kind, sea.assetId, sea.name, sea.use, sea.depth, sea.base.rev], ['media', A['海辺.mp4'].id, '海辺.mp4', 'fill', 'back', 4]);
  assert.equal(CH.groupOf(sea), 'work');
  const ai = sea.to;
  assert.equal(ai.caption.ja, ('海 辺 の 夕 方 x ' + 'あ'.repeat(80)).slice(0, 60));
  assert.equal(Array.from(ai.caption.ja).length, 60);
  assert.equal(ai.caption.en, 'Sea at dusk');
  deepEqual(ai.tags, ['wet', 'airy']);
  deepEqual(ai.colors, ['#F2A65A', '#AABBCC', '#000000', '#111111', '#222222']);
  deepEqual(ai.subject, { x: 0.8, y: 0, w: 0.2, h: 1 });
  assert.equal(ai.text, null, 'an empty box is none');
  assert.equal(ai.depth, 'back');
  assert.equal(Array.from(sea.reason).length, 60);
  assert.ok(!sea.reason.includes('\n'));
  assert.equal(ai.reason, sea.reason, 'the reason is stored with the depth (§11.9.5)');
  assert.ok(!('depth' in sky.to) && !('reason' in sky.to) && sky.depth === null && sky.reason === '', 'an unknown depth is left out, and its reason');
  deepEqual(ME.entryProblems(Object.assign({}, A['海辺.mp4'], { ai })), []);
  // the same description again is no change
  const same = CMD.reduce(DOC, { t: 'media.meta', id: A['海辺.mp4'].id, ai });
  assert.equal(VI.visionChanges(same, { items: [json.items[0]] }, q.sent).changes.length, 0);
  deepEqual(VI.visionChanges(DOC, { nope: [] }, q.sent).warnings, [['ai.warn.empty', {}]]);
});

test('apply, log and revert: media.meta in one batch; revert restores the previous description (and clears the depth)', () => {
  const q = VI.visionRequest(DOC, [{ id: A['空.jpg'].id, parts: [JPEG('QQ==')] }, { id: A['ロゴ.png'].id, parts: [JPEG('QQ==')] }], {});
  const r = VI.visionChanges(DOC, { items: [item(0, { depth: 'still' }), item(1, { caption: 'ロゴ', depth: 'still', use: 'frame' })] }, q.sent, { rev: 1 });
  const cmds = CH.toCommands(DOC, null, r.changes);
  deepEqual(cmds.map((c) => [c.t, c.id, c.ai.depth]), [['media.meta', A['空.jpg'].id, 'still'], ['media.meta', A['ロゴ.png'].id, 'still']]);
  const store = ST.createStore({ doc: DOC, reduce: CMD.reduce });
  store.batch({ label: ['undo.ai', { tool: 'vision', n: cmds.length }] }, cmds);
  assert.equal(store.list().length, 1);
  const sky = store.doc.media.list.find((e) => e.id === A['空.jpg'].id);
  assert.deepEqual(Object.keys(sky.ai), ['caption', 'tags', 'colors', 'subject', 'text', 'depth', 'reason'],
    'ORDER.assetAi: the depth and its reason last');
  assert.equal(sky.ai.caption.ja, '夕方の海');
  const entry = CH.logEntry(DOC, cmds, { runId: 'v1', tool: 'vision' });
  deepEqual(entry.applied[0], { media: A['空.jpg'].id, to: cmds[0].ai, prev: A['空.jpg'].ai });
  deepEqual(entry.applied[1].prev, null);
  const back = CH.revertCommands(store.doc, entry);
  assert.equal(back.kept, 0);
  const reverted = CMD.reduce(store.doc, { t: 'batch', cmds: back.cmds });
  deepEqual(reverted.media, DOC.media, 'both descriptions go back; the depth is gone');
  // the user renamed nothing but edited the description since: kept
  const edited = CMD.reduce(store.doc, { t: 'media.meta', id: A['ロゴ.png'].id, ai: null });
  const partial = CH.revertCommands(edited, entry);
  assert.equal(partial.kept, 1);
  deepEqual(partial.cmds, [{ t: 'media.meta', id: A['空.jpg'].id, ai: A['空.jpg'].ai }]);
  // stale: the description changed since the request, or the asset is gone
  const gone = CMD.reduce(DOC, { t: 'media.remove', id: A['ロゴ.png'].id });
  deepEqual(CH.markStale(gone, null, r.changes).map((c) => [c.stale, c.staleWhy || null]), [[false, null], [true, 'changed']]);
  const ja = T.createT('ja', STRINGS, null, { strict: true });
  assert.equal(CH.describe(r.changes[1], ja), '写真「ロゴ.png」の説明: ロゴ');
  const en = T.createT('en', STRINGS, null, { strict: true });
  assert.equal(CH.describe(r.changes[0], en), 'Description of "空.jpg": Evening sea');
});
