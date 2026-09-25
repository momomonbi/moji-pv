/* 文字PVメーカー v2 — original work. Tests for ai/direct and the v2.1 parts of ai/changes: area instructions, the answer mapping, review, apply, stale rows and revert (DESIGN_2_1 §5.2–§5.6, §5.11, §11.6.1, §11.9.4). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { deepEqual } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const DI = MV.use('ai/direct');
const CH = MV.use('ai/changes');
const RECIPE = MV.use('ai/recipe');
const CAT = MV.use('ai/catalog');
const AREAS = MV.use('planner/areas');
const PL = MV.use('planner/plan');
const CMD = MV.use('core/commands');
const ST = MV.use('core/store');
const REG = MV.use('core/registry');
const SHOT = MV.use('core/shot');
const CV = MV.use('core/curve');
const M = MV.use('core/migrate');
const T = MV.use('i18n/t');
const STRINGS = MV.use('i18n/strings');

// ---- the registry: the catalog, with the four media parts as §11.5.6–§11.5.7 and §11.9.1 give them (test definitions,
// so the tests do not depend on when packages B and G land theirs; textFill takes stills only and mediaLayer videos only
// here, to test the accept rule; textFill has no depth) -----------------------------------------------------------------

const LB = (ja, en) => ({ ja, en });
const MEDIA_KEYS = ['photoPan', 'photoFrame', 'textFill', 'mediaLayer'];

function mediaParams(src, accept, depth) {
  return Object.assign(depth === false ? {} : {
    depth: { type: 'enum', of: ['auto', 'anim', 'front', 'back', 'still'], auto: { value: 'auto' }, label: LB('動きと重なり', 'Motion and layering') },
  }, {
    [src]: { type: 'media', accept, auto: { value: '' }, ai: false, label: LB('写真・動画', 'Photo or video') },
    fit: { type: 'enum', of: ['cover', 'contain', 'soft'], auto: { value: 'cover' }, ai: false, label: LB('収め方', 'Fit') },
    blur: { type: 'num', min: 0, max: 60, step: 0.5, unit: 'du', auto: { value: 0 }, ai: false, label: LB('ぼかし', 'Blur') },
    veil: { type: 'num', min: 0, max: 0.9, step: 0.01, auto: { value: 0 }, ai: false, label: LB('薄幕', 'Veil') },
    clipIn: { type: 'num', min: 0, max: 3600, step: 0.01, unit: 's', auto: { value: 0 }, ai: false, label: LB('始め', 'Start at') },
    speed: { type: 'num', min: 0.25, max: 4, step: 0.05, unit: 'x', auto: { value: 1 }, ai: false, label: LB('速さ', 'Speed') },
  });
}

function registry() {
  const all = MV.use('parts/catalog').defs();
  const base = (kind, key) => all.find((d) => d.kind === kind && d.key === key);
  const clone = (kind, key, patch) => Object.assign({}, base(kind, key), { fallback: false, pool: false }, patch);
  return REG.createRegistry(all.filter((d) => !MEDIA_KEYS.includes(d.key)).concat([
    clone('ground', 'photoPan', { key: 'photoPan', label: LB('写真・動画', 'Photo or video'), params: mediaParams('image', 'any') }),
    clone('ornament', 'cornerTicks', { key: 'photoFrame', label: LB('写真の枠', 'Photo frame'), params: mediaParams('src', 'any') }),
    clone('ornament', 'cornerTicks', { key: 'textFill', label: LB('文字の中に', 'Inside the text'), params: mediaParams('src', 'image', false) }),
    clone('ornament', 'petalFall', { key: 'mediaLayer', season: null, label: LB('重ねる映像', 'Overlay footage'), params: mediaParams('src', 'video') }),
  ]));
}
const reg = registry();

function planOf(doc) { return PL.plan(doc, { registry: reg }); }

// The v2.1 fixture (song sections, materials m1–m3, camera pins) with the four assets of the media fixture.
function baseDoc() {
  let doc = M.parseFile(corpus.projectText('v21')).doc;
  for (const entry of M.parseFile(corpus.projectText('media')).doc.media.list) doc = CMD.reduce(doc, { t: 'media.put', entry });
  return doc;
}
const DOC = baseDoc();
const PLAN = planOf(DOC);
const WINTER = CMD.reduce(DOC, { t: 'pin.set', path: 'work:season', v: 'winter', by: 'user' });
const WINTER_PLAN = planOf(WINTER);
const ASSET = Object.fromEntries(DOC.media.list.map((e) => [e.name, e]));   // ロゴ.png 空.jpg 海辺.mp4 きらめき.webm

const CHORUS = { kind: 'song', n: 2, t0: 24, t1: 40 };           // lines rb, rc
const VERSE = { kind: 'song', n: 1, t0: 4, t1: 24 };             // lines r4, r5, r7, r8
const WORKREF = { kind: 'work' };

// ---- answer builders (every property present, as the closed schema asks) --------------------------------------------

const CURVE = (name, x) => Object.assign({ name, ends: 'both', edge: -1, peak: -1 }, x);
const CAM = (x) => Object.assign({ shot: '', move: 'pushIn', focus: 'text', timing: 'whole', fill: -1, closer: -1, follow: -1, curve: CURVE('') }, x);
const MED = (x) => Object.assign({ use: '', as: 'ground', fit: '', blur: -1, veil: -1, from: -1, speed: -1, depth: 'keep' }, x);
function edit(x) {
  return Object.assign({ arrange: '', arrive: '', dwell: '', depart: '', lens: '', ground: '', atmos: '', ornaments: [], filters: [],
    avoid: [], season: '', speed: -1, arriveCurve: CURVE(''), departCurve: CURVE(''), flow: CURVE(''), lensCurve: CURVE(''),
    camera: CAM(), impact: 'keep', emphasis: [], media: MED() }, x);
}
const ALL = (x) => Object.assign({ rig: '', rigCurve: CURVE('') }, edit(x));
const LINE = (i, x) => Object.assign({ i }, edit(x));
const CUT = (i, j, x) => Object.assign({ i, j, arrange: '', arrive: '', depart: '', lens: '', ornaments: [], speed: -1, camera: CAM() }, x);
const KEEP_AMOUNTS = { motion: -1, glitch: -1, chroma: -1, ornament: -1, density: -1, texture: -1, groundSwitch: -1, camera: -1 };
const WORK = (x) => Object.assign({ theme: '', mood: '', season: '', amounts: KEEP_AMOUNTS, flash: 'keep', palette: { accent: '', shiftA: '', shiftB: '' } }, x);
const ANSWER = (s, x) => Object.assign({ s, understood: true, summary: '要約', question: '', all: ALL({}), lines: [], cuts: [], work: WORK() }, x);

function layer(x) {
  return Object.assign({ prim: 'particles', shape: 'petal', glyph: '', inks: ['#F4B4C6', 'accent'], alpha: 0.85, layer: 'near', anchor: 'frame',
    x: 0, y: 0, spread: 1.15, sizeMin: 0.012, sizeMax: 0.022, count: 90, stroke: 0, dir: 115, speed: 0.09, sway: 26, swayHz: 0.35,
    spin: 60, burst: 'none', move: 'none', moveWhat: 'scale', moveAmp: 0, moveHz: 0, appear: 'always', draw: 'fade', style: '',
    pattern: '', stops: [], angle: 0 }, x);
}
function material(x) {
  return Object.assign({ name: '桜吹雪', nameEn: 'Cherry flurry', kind: 'ornament', scope: 'run', season: 'spring', tags: ['organic', 'soft'],
    blurb: '花びらが斜めに舞う', base: '', params: [], parts: [], layers: [layer({})], unit: 'glyph', order: 'lead', dur: -1, each: -1,
    tracks: [], curve: CURVE(''), osc: [], knobs: ['count'], use: { slot: 'none', s: 0, lines: [], cuts: [] } }, x);
}

// One request for `refs` and the changes of `answers` (validated against the same doc and plan).
function direct(doc, refs, answers, opts) {
  const o = Object.assign({ uiLang: 'ja', mode: 'all' }, opts);
  const plan = doc === DOC ? PLAN : doc === WINTER ? WINTER_PLAN : planOf(doc);
  const reqs = DI.directRequests(doc, plan, reg, Object.assign({ briefs: refs.map((ref) => ({ ref, instruction: 'お願い' })) }, o));
  const json = { answers };
  if (o.materials) json.materials = o.materials;
  const res = DI.directChanges(doc, plan, reg, json, { rev: 3, sent: reqs[0].sent, allowMaterials: o.allowMaterials });
  return Object.assign({ plan, req: reqs[0], reqs }, res);
}

const byPath = (changes) => Object.fromEntries(changes.filter((c) => c.path).map((c) => [c.path, c]));
const hasWarn = (warnings, key) => warnings.some((w) => w[0] === key);

// ---- requests -------------------------------------------------------------------------------------------------------

test('request: the brief lines, numbered per brief, plus one context line each side; nothing else of the lyrics', () => {
  const plan = PLAN;
  const reqs = DI.directRequests(DOC, plan, reg, { briefs: [{ ref: CHORUS, instruction: '季節感を加える\nゆっくり' }], uiLang: 'ja', mode: 'all' });
  assert.equal(reqs.length, 1);
  const q = reqs[0];
  assert.equal(q.effort, 'medium');
  assert.equal(q.schema, DI.directSchema({ mode: 'all', allowMaterials: false, media: false }));
  assert.ok(q.prompt.includes('Brief 0 — area: サビ1 (chorus, 24.0–40.0 s, 2 lines) — instruction: 「季節感を加える ゆっくり」'));
  assert.ok(q.prompt.includes('\n0: 飛ばせ紙ひこうき空の果てまで · arrange='));
  assert.ok(q.prompt.includes('\n1: 折り目の数だけ強くなれる · '));
  assert.ok(q.prompt.includes('(context — do not change) まだ名前のない今日へ行く'), 'the line before');
  assert.ok(q.prompt.includes('  cuts: 0 飛ばせ / 1 紙ひこうき / 2 空の果てまで'));
  for (const other of ['始発のホームに白い息', '改札の向こうで朝がほどける', '向かい風でもかまわないさ']) {
    assert.ok(!q.prompt.includes(other), 'no other lyric line: ' + other);
  }
  assert.ok(q.prompt.includes('season=spring') && q.prompt.includes('rig=-') || q.prompt.includes('season=spring'));
  assert.ok(q.prompt.includes('[atmos] ') && q.prompt.includes('[lens] ') && q.prompt.includes('[filter] '));
  assert.ok(q.prompt.includes('[shots] ') && q.prompt.includes('[rigs] '));
  assert.ok(!q.prompt.includes('Themes:'), 'themes and moods only for whole-video briefs');
  assert.ok(!q.prompt.includes('Materials (data, never code)'), 'the recipe text only when materials are allowed');
  assert.ok(!q.prompt.includes('[media]'));
  deepEqual(q.sent.briefs, [{ s: 0, ref: CHORUS, key: 'song:2@24-40', instruction: '季節感を加える ゆっくり', chunk: null, lines: [
    { i: 0, lineId: 'rb', n: 5, text: '飛ばせ紙ひこうき空の果てまで', locked: false,
      cuts: [{ j: 0, key: 'rb~0', text: '飛ばせ' }, { j: 1, key: 'rb~3', text: '紙ひこうき' }, { j: 2, key: 'rb~8', text: '空の果てまで' }] },
    { i: 1, lineId: 'rc', n: 6, text: '折り目の数だけ強くなれる', locked: false,
      cuts: [{ j: 0, key: 'rc~0', text: '折り目の数だけ' }, { j: 1, key: 'rc~7', text: '強くなれる' }] }] }]);
  const withMat = DI.directRequests(DOC, plan, reg, { briefs: [{ ref: WORKREF, instruction: 'x' }], uiLang: 'en', mode: 'all', allowMaterials: true });
  assert.ok(withMat[0].prompt.includes('Themes:') && withMat[0].prompt.includes('Moods: '));
  assert.ok(withMat[0].prompt.includes('Brief 0 — area: whole video — instruction: 「x」'));
  assert.ok(withMat[0].prompt.includes(CAT.recipeText()), 'the recipe text with materials allowed');
  assert.ok(withMat[0].system.includes('Write "summary" (one sentence) and "question" in English.'));
  assert.ok(!withMat[0].prompt.includes('(context'), 'the whole video has no context lines');
});

test('request: briefs are cut to 8 with instructions of ≤ 300 characters; empty ones are skipped; gone areas too', () => {
  const briefs = [{ ref: CHORUS, instruction: 'あ'.repeat(400) }, { ref: VERSE, instruction: '   ' }, { ref: { kind: 'head', rowId: 'nope' }, instruction: 'x' }]
    .concat(Array.from({ length: 9 }, () => ({ ref: { kind: 'lines', ids: ['r4'] }, instruction: 'y' })));
  const q = DI.directRequests(DOC, PLAN, reg, { briefs, uiLang: 'ja', mode: 'all' });
  const sent = q.flatMap((r) => r.sent.briefs);
  assert.equal(sent[0].instruction.length, DI.MAX_INSTRUCTION);
  assert.equal(sent.length, 6, 'of the first 8 briefs: 1 chorus + 6 − (1 empty, 1 gone) line briefs');
  assert.ok(sent.every((b) => b.key !== 'song:1@4-24'), 'an empty instruction is not sent in mode all');
  assert.equal(DI.MAX_BRIEFS, 8);
});

test('windows: ≤ 200 area lines per request; whole areas, a huge area in line ranges; ids start with w<k>:', () => {
  const text = ['# A'].concat(Array.from({ length: 150 }, (_, i) => 'あさひ' + i), [''], ['# B'], Array.from({ length: 120 }, (_, i) => 'ゆうひ' + i)).join('\n');
  const doc = CMD.reduce(M.parseFile(corpus.projectText('basic')).doc, { t: 'lyrics.set', text });
  const plan = planOf(doc);
  const heads = AREAS.areasOf(doc, plan).heads;
  assert.deepEqual(heads.map((a) => a.n), [150, 120]);
  const two = DI.directRequests(doc, plan, reg, { briefs: heads.map((a) => ({ ref: a.ref, instruction: 'x' })), uiLang: 'ja' });
  assert.deepEqual(two.map((r) => r.sent.briefs.map((b) => b.lines.length)), [[150], [120]], 'two whole areas do not fit one window');
  assert.deepEqual(two.map((r) => [r.sent.window, r.sent.windows]), [[0, 2], [1, 2]]);
  const whole = DI.directRequests(doc, plan, reg, { briefs: [{ ref: WORKREF, instruction: 'x' }], uiLang: 'ja' });
  assert.deepEqual(whole.map((r) => r.sent.briefs[0].lines.length), [200, 70]);
  deepEqual(whole.map((r) => r.sent.briefs[0].chunk), [[0, 200, 270], [200, 270, 270]]);
  assert.ok(whole[1].prompt.includes('(lines 201–270 of 270; whole-video settings belong to the first part)'));
  assert.deepEqual(whole[1].sent.briefs[0].lines.map((l) => l.i).slice(0, 3), [0, 1, 2], 'numbered per window');
  // the second window's answer: ids carry w1:, `all` of a later part is not applied to the whole video again
  const res = DI.directChanges(doc, plan, reg, { answers: [ANSWER(0, { all: ALL({ arrive: 'inkRise' }), lines: [LINE(3, { arrive: 'fogIn' })] })] },
    { rev: 1, sent: whole[1].sent });
  deepEqual(res.changes.map((c) => [c.id, c.path, c.to]), [['w1:s0:line/' + plan.lines[203].id + ':arrive', 'line/' + plan.lines[203].id + ':arrive', 'fogIn']]);
  const first = DI.directChanges(doc, plan, reg, { answers: [ANSWER(0, { all: ALL({ arrive: 'inkRise' }) })] }, { rev: 1, sent: whole[0].sent });
  deepEqual(first.changes.map((c) => [c.id, c.path, c.group]), [['w0:s0:work:arrive', 'work:arrive', 'area']]);
});

// ---- schemas and the value readers -------------------------------------------------------------------------------------

test('directSchema: five frozen variants; media adds media to all and lines; the camera schema has camera fields only', () => {
  const s = (o) => DI.directSchema(o);
  const answer = (x) => x.properties.answers.items.properties;
  const plain = s({ mode: 'all' });
  assert.ok(Object.isFrozen(plain) && Object.isFrozen(answer(plain).all.properties.camera.properties.curve));
  assert.equal(s({ mode: 'all', allowMaterials: false, media: false }), plain, 'built once');
  deepEqual(Object.keys(plain.properties), ['answers']);
  deepEqual(Object.keys(s({ mode: 'all', allowMaterials: true }).properties), ['answers', 'materials']);
  assert.equal(s({ mode: 'all', allowMaterials: true }).properties.materials.items, RECIPE.AI_MATERIAL);
  assert.equal(s({ mode: 'all', allowMaterials: true, media: true }).properties.materials.items, RECIPE.AI_MATERIAL_MEDIA);
  deepEqual(Object.keys(answer(plain)), ['s', 'understood', 'summary', 'question', 'all', 'lines', 'cuts', 'work']);
  const all = answer(plain).all.properties;
  deepEqual(Object.keys(all).slice(0, 2), ['rig', 'rigCurve']);
  assert.ok(!('media' in all) && !('rig' in answer(plain).lines.items.properties));
  deepEqual(Object.keys(answer(plain).cuts.items.properties), ['i', 'j', 'arrange', 'arrive', 'depart', 'lens', 'ornaments', 'speed', 'camera']);
  deepEqual(Object.keys(answer(plain).work.properties.amounts.properties),
    ['motion', 'glitch', 'chroma', 'ornament', 'density', 'texture', 'groundSwitch', 'camera']);
  deepEqual(answer(plain).all.properties.camera.properties.move.enum, SHOT.MOVES);
  const media = answer(s({ mode: 'all', media: true }));
  assert.ok('media' in media.all.properties && 'media' in media.lines.items.properties && !('media' in media.cuts.items.properties));
  deepEqual(media.all.properties.media.properties.as.enum, ['ground', 'frame', 'fill', 'overlay']);
  deepEqual(media.all.properties.media.properties.depth.enum, ['keep', 'anim', 'front', 'back', 'still']);
  const cam = s({ mode: 'camera', allowMaterials: true, media: true });
  deepEqual(Object.keys(cam.properties), ['answers']);
  deepEqual(Object.keys(answer(cam).all.properties), ['rig', 'rigCurve', 'camera']);
  deepEqual(Object.keys(answer(cam).lines.items.properties), ['i', 'camera']);
  deepEqual(Object.keys(answer(cam).cuts.items.properties), ['i', 'j', 'camera']);
  // depth ≤ 5: answers → all → camera → curve, materials → layers
  const depth = (x) => (x.type === 'object' ? 1 + Math.max(0, ...Object.values(x.properties).map(depth)) : x.type === 'array' ? depth(x.items) : 0);
  assert.ok(depth(s({ mode: 'all', allowMaterials: true, media: true })) <= 5);
});

test('curveFromAi and cameraFromAi: presets, eases, ramps, custom shots; keep and unreadable', () => {
  const c = DI.curveFromAi;
  assert.equal(c(CURVE('')), undefined, "'' keeps");
  assert.equal(c(CURVE('holdThenDash')), 'holdThenDash');
  assert.equal(c(CURVE('expoOut')), 'expoOut');
  deepEqual(c(CURVE('ramp', { ends: 'both', edge: 0.1, peak: 6 })), { ramp: { edge: 0.1, ends: 'both', peak: 6 } });
  deepEqual(c(CURVE('ramp', { ends: 'start', edge: 0.9, peak: 40 })), { ramp: { edge: 0.4, ends: 'start', peak: 8 } }, 'clamped');
  deepEqual(c(CURVE('ramp', { ends: 'start', edge: -1, peak: -1 })), { ramp: { edge: 0.1, ends: 'start', peak: 4 } }, 'defaults');
  deepEqual(c(CURVE('slowFastSlow', { peak: 0.5 })), { ramp: { edge: 0.1, ends: 'both', peak: 2 } }, 'an alias of §1.4');
  deepEqual(c(CURVE('fastSlowFast', { peak: 4 })), { ramp: { edge: 0.1, ends: 'both', peak: 0.25 } });
  assert.equal(c(CURVE('easeOut')), 'cubicOut');
  assert.equal(c(CURVE('wobble')), null, 'unreadable');
  assert.equal(c(null), null);
  const k = DI.cameraFromAi;
  deepEqual(k(CAM()), { badShot: false, badCurve: false }, 'all keep');
  deepEqual(k(CAM({ shot: 'pushWord', closer: 1.234, follow: 0.4, curve: CURVE('softEnds') })),
    { badShot: false, badCurve: false, shot: 'pushWord', zoom: 1.23, follow: 0.4, curve: 'softEnds' });
  deepEqual(k(CAM({ shot: 'none', closer: 9, follow: 3 })), { badShot: false, badCurve: false, shot: 'none', zoom: 2, follow: 1 });
  deepEqual(k(CAM({ shot: 'custom', move: 'punch', focus: 'emphasis', timing: 'arrive', fill: 0.9 })).shot,
    SHOT.fromMove({ move: 'punch', focus: 'emphasis', timing: 'arrive', fill: 0.9 }));
  deepEqual(k(CAM({ shot: 'pullOut' })).shot, SHOT.fromMove({ move: 'pullOut', focus: 'text', timing: 'whole', fill: -1 }), 'a move word as the shot');
  assert.equal(k(CAM({ shot: 'custom', move: 'spin' })).badShot, true);
  assert.equal(k(CAM({ shot: 'zoomy' })).badShot, true);
  assert.equal(k(CAM({ curve: CURVE('nope') })).badCurve, true);
});

// ---- the mapping table (§5.5) -------------------------------------------------------------------------------------

test('parts: arrange arrive dwell depart lens → line pins per area line (agg), lines[i] wins over all', () => {
  const lyricOnly = reg.keys('arrange').find((k) => !CAT.servesLyrics(reg, 'arrange', k));
  const r = direct(DOC, [CHORUS], [ANSWER(0, {
    all: ALL({ arrange: 'stairStep', arrive: 'inkRise', dwell: 'swaySwing', depart: 'fogOut', lens: 'slowPush' }),
    lines: [LINE(1, { arrive: 'fogIn', depart: 'nope', arrange: lyricOnly || 'nope' })],
  })]);
  const p = byPath(r.changes);
  for (const [kind, key] of [['arrange', 'stairStep'], ['arrive', 'inkRise'], ['dwell', 'swaySwing'], ['depart', 'fogOut'], ['lens', 'slowPush']]) {
    const c = p['line/rb:' + kind];
    assert.ok(c, kind);
    assert.deepEqual([c.kind, c.to, c.by, c.group, c.areaKey, c.agg, c.partKind, c.lineId, c.n],
      ['part', key, undefined, 'area', 'song:2@24-40', 'song:2@24-40|' + kind, kind, 'rb', 5]);
  }
  assert.equal(p['line/rc:arrive'].to, 'fogIn', 'lines[i] wins');
  assert.ok(Object.keys(p).every((path) => /^line\/r[bc]:/.test(path)) && !hasWarn(r.warnings, 'ai.warn.outside'), 'only the area lines');
  assert.equal(p['line/rc:arrive'].agg, undefined, 'a line exception is not part of the aggregate');
  assert.ok(!p['line/rc:depart'], 'lines[i] wins even when it cannot be used: no area pick for that line');
  assert.ok(r.warnings.some((w) => w[0] === 'ai.warn.lineUnknown' && w[1].key === 'nope' && w[1].n === 6));
  if (lyricOnly) assert.ok(r.warnings.some((w) => w[0] === 'ai.warn.lineUnknown' && w[1].key === lyricOnly), 'a title-only layout');
  // turned-off parts are not picked
  const off = CMD.reduce(DOC, { t: 'filter.set', kind: 'arrive', only: null, deny: ['inkRise'] });
  const r2 = direct(off, [CHORUS], [ANSWER(0, { all: ALL({ arrive: 'inkRise' }) })]);
  assert.equal(r2.changes.length, 0);
  assert.ok(hasWarn(r2.warnings, 'ai.warn.filtered'));
  const cmds = CH.toCommands(DOC, PLAN, r.changes);
  deepEqual(cmds.find((c) => c.path === 'line/rb:arrive'), { t: 'pin.set', path: 'line/rb:arrive', v: 'inkRise', by: 'ai' });
});

test('ground and atmos: part pins; atmos is a run ornament or none; the season gate', () => {
  const r = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ ground: 'petalWash', atmos: 'petalFall' }), lines: [LINE(1, { atmos: 'none' })] })]);
  const p = byPath(r.changes);
  assert.deepEqual([p['line/rb:ground'].to, p['line/rc:ground'].to, p['line/rc:atmos'].to], ['petalWash', 'petalWash', 'none']);
  assert.equal(p['line/rb:atmos'].to, 'petalFall');
  assert.equal(p['line/rb:atmos'].partKind, 'ornament');
  const bad = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ atmos: 'cornerTicks', ground: 'nope' }) })]);
  assert.equal(bad.changes.length, 0);
  assert.ok(bad.warnings.some((w) => w[0] === 'ai.warn.lineUnknown' && w[1].kind === 'atmos'), 'a cut ornament is no atmosphere');
  // season gate: the answer sets winter for the area, so spring parts are dropped
  const winter = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ season: 'winter', ground: 'petalWash', atmos: 'snowDust' }) })]);
  const w = byPath(winter.changes);
  assert.ok(!w['line/rb:ground'] && !w['line/rc:ground']);
  assert.equal(w['line/rc:atmos'].to, 'snowDust');
  assert.ok(winter.warnings.some((x) => x[0] === 'ai.warn.lineOffSeason' && x[1].key === 'petalWash'));
  // without a season in the answer, a line's own season pin (rb: spring) gates its picks, the work season the others
  const own = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ atmos: 'snowDust' }) })]);
  assert.deepEqual(Object.keys(byPath(own.changes)), ['line/rc:atmos'], 'rb follows its spring pin; the work season is any');
});

test('ornaments and filters: the lowest index not pinned by the user or a lock; none → count 0; backdrop', () => {
  const doc = CMD.reduce(DOC, { t: 'batch', cmds: [
    { t: 'pin.set', path: 'line/rc:ornament#0', v: 'hairFrame', by: 'user' },
    { t: 'pin.set', path: 'cut/rc~7:ornament#1', v: 'barCode', by: 'user', sig: '強くなれる' },
    { t: 'pin.set', path: 'line/rb:ornament#0', v: 'barCode', by: 'ai' },
  ] });
  const r = direct(doc, [CHORUS], [ANSWER(0, { all: ALL({ ornaments: ['sparkSpray', 'underSweep'] }) })]);
  const p = byPath(r.changes);
  assert.deepEqual([p['line/rb:ornament#0'].to, p['line/rb:ornament#1'].to], ['sparkSpray', 'underSweep'], 'an AI pin leaves its index free');
  assert.equal(p['line/rc:ornament#2'].to, 'sparkSpray');
  assert.ok(!Object.keys(p).some((k) => k.startsWith('line/rc:ornament#') && k !== 'line/rc:ornament#2'));
  assert.ok(r.warnings.some((w) => w[0] === 'ai.warn.noSlot' && w[1].n === 6));
  assert.equal(p['line/rb:ornament#0'].agg, 'song:2@24-40|ornament:sparkSpray', 'aggregated per ornament, whatever the index');
  const none = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ ornaments: ['none'], filters: ['none'] }) })]);
  const first = (id) => PLAN.cuts.find((c) => c.line === id).slots;
  const want = [];
  for (const id of ['rb', 'rc']) {
    for (const kind of ['filter', 'ornament']) {
      if (first(id)[kind + '.count'].v !== 0) want.push(['line/' + id + ':' + kind + '.count', 'value', 0]);   // 0 already: no change
    }
  }
  assert.ok(want.some((x) => x[0] === 'line/rb:ornament.count'));
  deepEqual(none.changes.map((c) => [c.path, c.kind, c.to]).sort(), want.sort());
  const f = direct(DOC, [CHORUS], [ANSWER(0, { lines: [LINE(0, { filters: ['grainFilm', 'nope'] })] })]);
  deepEqual(f.changes.map((c) => [c.path, c.to]), [['line/rb:filter#0', 'grainFilm']]);
  // a filter the backdrop mode skips (D§4.19.4) is not placed
  const notSafe = reg.keys('filter').find((k) => reg.get('filter', k).alphaSafe !== true && !reg.get('filter', k).gate);
  const clear = CMD.reduce(DOC, { t: 'look.set', key: 'backdrop', v: 'clear' });
  const b = direct(clear, [CHORUS], [ANSWER(0, { lines: [LINE(0, { filters: [notSafe] })] })]);
  assert.equal(b.changes.length, 0);
  assert.ok(b.warnings.some((w) => w[0] === 'ai.warn.backdrop' && w[1].n === 5));
});

test('avoid: the line list grows by valid refs; a whole-video brief turns the parts off (filters)', () => {
  const r = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ avoid: ['arrive.strobeIn', 'ornament.nope', 'bogus'] }) })]);
  const p = byPath(r.changes);
  deepEqual(p['line/rb:avoid'].to, ['arrive.strobeIn', 'filter.sliceGlitch'], 'union with the existing pin, sorted');
  deepEqual(p['line/rb:avoid'].from, ['filter.sliceGlitch']);
  deepEqual(p['line/rc:avoid'].to, ['arrive.strobeIn']);
  assert.equal(p['line/rc:avoid'].kind, 'value');
  const same = direct(DOC, [CHORUS], [ANSWER(0, { lines: [LINE(0, { avoid: ['filter.sliceGlitch'] })] })]);
  assert.equal(same.changes.length, 0, 'nothing new');
  const work = direct(DOC, [WORKREF], [ANSWER(0, { all: ALL({ avoid: ['arrive.strobeIn'] }) })]);
  deepEqual(work.changes.map((c) => [c.kind, c.filterKind, c.partKey]), [['avoid', 'arrive', 'strobeIn']]);
  deepEqual(CH.toCommands(DOC, PLAN, work.changes), [{ t: 'filter.set', kind: 'arrive', only: null, deny: ['strobeIn'] }]);
});

test('season: a line pin in an area; the work season for the whole video', () => {
  const r = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ season: 'summer' }) })]);
  deepEqual(r.changes.map((c) => [c.path, c.kind, c.from, c.to, c.agg]), [
    ['line/rb:season', 'value', 'spring', 'summer', 'song:2@24-40|season'], ['line/rc:season', 'value', null, 'summer', 'song:2@24-40|season']]);
  const w = direct(DOC, [WORKREF], [ANSWER(0, { all: ALL({ season: 'winter' }) })]);
  deepEqual(w.changes.map((c) => [c.path, c.kind, c.to, c.group, c.checked]), [['work:season', 'season', 'winter', 'work', true]]);
});

test('speed: motion.speed clamped to 0.25–4 in steps of 0.05; |to − from| < 0.02 is no change', () => {
  const r = direct(DOC, [VERSE], [ANSWER(0, { all: ALL({ speed: 0.37 }), lines: [LINE(1, { speed: 9 }), LINE(2, { speed: 1.01 })] })]);
  const p = byPath(r.changes);
  assert.equal(p['line/r4:motion.speed'].to, 0.35);
  assert.equal(p['line/r4:motion.speed'].from, 0.6, 'the existing pin');
  assert.equal(p['line/r5:motion.speed'].to, 4);
  assert.ok(!p['line/r7:motion.speed'], '1.01 is 1');
  assert.equal(p['line/r8:motion.speed'].to, 0.35);
  assert.equal(p['line/r8:motion.speed'].field, 'fld.motionSpeed');
  const keep = direct(DOC, [VERSE], [ANSWER(0, { all: ALL({ speed: -1 }) })]);
  assert.equal(keep.changes.length, 0);
});

test('curves: arrive.ease, depart.ease, arrive.flow and lens.curve; unreadable → ai.warn.badCurve', () => {
  const r = direct(DOC, [CHORUS], [ANSWER(0, { lines: [LINE(1, { arriveCurve: CURVE('ramp', { ends: 'both', edge: 0.1, peak: 6 }),
    departCurve: CURVE('fadeBrake'), flow: CURVE('softEnds'), lensCurve: CURVE('expoOut') }), LINE(0, { arriveCurve: CURVE('wobble') })] })]);
  const p = byPath(r.changes);
  deepEqual(p['line/rc:arrive.ease'].to, { ramp: { edge: 0.1, ends: 'both', peak: 6 } });
  assert.equal(p['line/rc:depart.ease'].to, 'fadeBrake');
  assert.equal(p['line/rc:arrive.flow'].to, 'softEnds');
  assert.equal(p['line/rc:lens.curve'].to, 'expoOut');
  assert.deepEqual([p['line/rc:arrive.ease'].field, p['line/rc:arrive.ease'].fieldKind], ['fld.speedCurve', 'arrive']);
  assert.equal(Object.keys(p).length, 4);
  assert.ok(hasWarn(r.warnings, 'ai.warn.badCurve'));
});

test('camera: cam.shot, cam.zoom (closer), cam.follow and cam.curve; unreadable → ai.warn.badShot', () => {
  const r = direct(DOC, [CHORUS], [ANSWER(0, {
    all: ALL({ camera: CAM({ shot: 'settle', closer: 1.5, follow: 0.3, curve: CURVE('softEnds') }) }),
    lines: [LINE(0, { camera: CAM({ shot: 'custom', move: 'punch', focus: 'emphasis', timing: 'arrive', fill: 0.9 }) }),
      LINE(1, { camera: CAM({ shot: 'zoomy' }) })],
  })]);
  const p = byPath(r.changes);
  deepEqual(p['line/rb:cam.shot'].to, SHOT.fromMove({ move: 'punch', focus: 'emphasis', timing: 'arrive', fill: 0.9 }));
  assert.equal(p['line/rb:cam.shot'].from, 'pushWord');
  assert.ok(!p['line/rc:cam.shot'], 'an unreadable line shot still wins over the area: no shot for that line');
  assert.equal(p['line/rc:cam.curve'].to, 'softEnds', 'the other camera fields of the area stay');
  assert.deepEqual([p['line/rb:cam.zoom'].to, p['line/rc:cam.zoom'].to, p['line/rc:cam.zoom'].from], [1.5, 1.5, 1.2]);
  assert.deepEqual([p['line/rb:cam.follow'].to, p['line/rc:cam.curve'].to], [0.3, 'softEnds']);
  assert.ok(hasWarn(r.warnings, 'ai.warn.badShot'));
  assert.equal(p['line/rb:cam.shot'].kind, 'value');
});

test('rig and rigCurve (all only): rig and rig.curve on every area line; the whole video → work pins', () => {
  const r = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ rig: 'slowSwell', rigCurve: CURVE('fadeBrake') }) })]);
  deepEqual(r.changes.map((c) => [c.path, c.to, c.agg]), [['line/rb:rig', 'slowSwell', 'song:2@24-40|rig'],
    ['line/rb:rig.curve', 'fadeBrake', 'song:2@24-40|rig.curve'], ['line/rc:rig', 'slowSwell', 'song:2@24-40|rig'],
    ['line/rc:rig.curve', 'fadeBrake', 'song:2@24-40|rig.curve']]);
  const w = direct(DOC, [WORKREF], [ANSWER(0, { all: ALL({ rig: 'none' }) })]);
  deepEqual(w.changes.map((c) => [c.path, c.to]), [['work:rig', 'none']]);
  const bad = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ rig: 'spinAround' }) })]);
  assert.equal(bad.changes.length, 0);
  assert.ok(hasWarn(bad.warnings, 'ai.warn.badShot'));
});

test('impact and emphasis: lyric changes of the rows (the words never change); a word of all goes where it is', () => {
  const r = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ emphasis: ['強く'] }), lines: [LINE(0, { impact: 'on', emphasis: ['空の果て'] })] })]);
  deepEqual(r.changes.map((c) => [c.kind, c.rowId, c.to, c.group || CH.groupOf(c)]).sort(), [
    ['emphasis', 'rb', [8, 12], 'lyrics'], ['emphasis', 'rc', [7, 9], 'lyrics'], ['impact', 'rb', true, 'lyrics']]);
  const cmds = CH.toCommands(DOC, PLAN, r.changes);
  deepEqual(cmds, [{ t: 'lyrics.row', rowId: 'rb', src: '[00:24.00][00:46.00]飛ばせ/*紙ひこうき*/*空の果て*まで!' },
    { t: 'lyrics.row', rowId: 'rc', src: '[00:30.00]折り目の数だけ/*強く*なれる' }]);
});

test('cuts[k]: cut pins with the cut text as sig; the cut must still be there with the same words', () => {
  const r = direct(DOC, [CHORUS], [ANSWER(0, { cuts: [CUT(0, 1, { arrive: 'wordPop', speed: 0.5, camera: CAM({ shot: 'snapZoom' }), ornaments: ['sparkSpray'] }),
    CUT(1, 9, { arrive: 'fogIn' }), CUT(7, 0, { arrive: 'fogIn' })] })]);
  const p = byPath(r.changes);
  assert.deepEqual(Object.keys(p).sort(), ['cut/rb~3:arrive', 'cut/rb~3:cam.shot', 'cut/rb~3:motion.speed', 'cut/rb~3:ornament#0']);
  const c = p['cut/rb~3:arrive'];
  assert.deepEqual([c.scope, c.cutKey, c.cutSig, c.group, c.lineId], ['cut', 'rb~3', '紙ひこうき', 'cuts', 'rb']);
  assert.equal(CH.groupOf(c), 'cuts');
  assert.ok(hasWarn(r.warnings, 'ai.warn.changedSince') && hasWarn(r.warnings, 'ai.warn.notInArea'));
  const cmds = CH.toCommands(DOC, PLAN, r.changes);
  deepEqual(cmds.find((x) => x.path === 'cut/rb~3:arrive'), { t: 'pin.set', path: 'cut/rb~3:arrive', v: 'wordPop', by: 'ai', sig: '紙ひこうき' });
  // a cut area: all, lines[0] and cuts[0,0] all land on that cut
  const cutArea = direct(DOC, [{ kind: 'cut', key: 'rc~7' }], [ANSWER(0, { all: ALL({ lens: 'slowPush', season: 'winter' }), lines: [LINE(0, { arrive: 'fogIn' })],
    cuts: [CUT(0, 0, { arrive: 'wordPop' })] })]);
  deepEqual(cutArea.changes.map((x) => [x.path, x.to]).sort(), [['cut/rc~7:arrive', 'wordPop'], ['cut/rc~7:lens', 'slowPush']],
    'the cut edit wins; a season is never a cut pin');
  // a special cut (the title card) is sent as line 0 without a line id and changed at its cut
  const title = direct(DOC, [{ kind: 'cut', key: 'title' }], [ANSWER(0, { all: ALL({ lens: 'slowPush' }) })]);
  assert.ok(title.req.prompt.includes('\n0: 春を待つうた · '));
  deepEqual(title.req.sent.briefs[0].lines[0].lineId, null);
  deepEqual(title.changes.map((x) => [x.path, x.cutSig, x.label[1].where]), [['cut/title:lens', '春を待つうた', ['crumb.title', {}]]]);
});

test('work.*: the existing work kinds; checked for the whole video, unchecked in "outside" for an area', () => {
  const w = WORK({ theme: 'sumiWashi', amounts: Object.assign({}, KEEP_AMOUNTS, { camera: 0.2, motion: 0.3 }) });
  const area = direct(DOC, [CHORUS], [ANSWER(0, { work: w })]);
  deepEqual(area.changes.map((c) => [c.kind, c.path, c.group, c.checked, CH.groupOf(c)]), [
    ['theme', 'work:theme', 'outside', false, 'outside'], ['amount', 'work:amount.motion', 'outside', false, 'outside'],
    ['amount', 'work:amount.camera', 'outside', false, 'outside']]);
  const whole = direct(DOC, [WORKREF], [ANSWER(0, { work: w })]);
  assert.ok(whole.changes.every((c) => c.group === 'work' && c.checked === true));
  assert.equal(whole.changes.find((c) => c.path === 'work:amount.camera').to, 0.2);
  assert.deepEqual(CH.toCommands(DOC, PLAN, area.changes), [], 'unchecked by default');
});

// ---- materials in the answer (§5.10, §5.11) -------------------------------------------------------------------------

test('mat:<name>: a material change plus dependents that require it; unchecking the material drops them', () => {
  const r = direct(WINTER, [CHORUS], [ANSWER(0, { all: ALL({ atmos: 'mat:桜吹雪', arrive: 'mat:どこにもない' }) })],
    { allowMaterials: true, materials: [material({})] });
  const mat = r.changes.find((c) => c.kind === 'material');
  assert.ok(mat && mat.group === 'materials' && mat.materialId === null && mat.plannedId === 'm4');
  assert.equal(CH.groupOf(mat), 'materials');
  const p = byPath(r.changes);
  assert.deepEqual([p['line/rb:atmos'].to, p['line/rb:atmos'].requires, p['line/rb:atmos'].matName], ['mat:桜吹雪', [mat.id], '桜吹雪']);
  assert.equal(p['line/rc:atmos'].to, 'mat:桜吹雪');
  assert.deepEqual([p['line/rc:season'].to, p['line/rc:season'].requires], ['spring', [mat.id]], 'rc gets the spring the material needs');
  assert.ok(!p['line/rb:season'], 'rb is spring already');
  assert.ok(r.warnings.some((w) => w[0] === 'ai.warn.matUnknown' && w[1].name === 'どこにもない'));
  const cmds = CH.toCommands(WINTER, r.plan, r.changes);
  assert.equal(cmds[0].t, 'material.put');
  assert.equal(cmds[0].id, 'm4');
  deepEqual(cmds.filter((c) => c.path && c.path.endsWith(':atmos')).map((c) => c.v), ['myMat4', 'myMat4']);
  const off = r.changes.map((c) => (c.kind === 'material' ? Object.assign({}, c, { checked: false }) : c));
  deepEqual(CH.toCommands(WINTER, r.plan, off), [], 'the dependents go with their material');
  // with the whole video in any season, a spring material needs no season of its own
  const any = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ atmos: 'mat:桜吹雪' }) })], { allowMaterials: true, materials: [material({})] });
  assert.ok(!any.changes.some((c) => c.path && c.path.endsWith(':season')));
  // materials are ignored when the request did not allow them
  const no = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ atmos: 'mat:桜吹雪' }) })], { materials: [material({})] });
  assert.ok(!no.changes.length && hasWarn(no.warnings, 'ai.warn.matUnknown'));
});

test('use: a material fitted into the area (§5.11): atmos, ornament#free, kinds, seam at the first cut, s −1, lines, cuts', () => {
  const mats = [
    material({ use: { slot: 'atmos', s: 0, lines: [], cuts: [] } }),
    material({ name: '角飾り', kind: 'ornament', scope: 'cut', season: '', layers: [layer({ prim: 'shape', shape: 'star', count: 4, layer: 'mid', anchor: 'corners' })],
      use: { slot: 'ornament', s: -1, lines: [1], cuts: [] } }),
    material({ name: 'ふわ入り', kind: 'arrive', season: '', base: 'inkRise', params: [{ name: 'yFrom', value: '1.2' }], layers: [], use: { slot: 'arrive', s: 1, lines: [], cuts: [{ i: 0, j: 1 }] } }),
    material({ name: '溶け替え', kind: 'seam', season: '', base: 'blendDissolve', layers: [], use: { slot: 'seam', s: 0, lines: [0], cuts: [] } }),
  ];
  const r = direct(DOC, [CHORUS, VERSE], [ANSWER(0), ANSWER(1)], { allowMaterials: true, materials: mats });
  const p = byPath(r.changes);
  const matId = (name) => r.changes.find((c) => c.kind === 'material' && c.matName === name).id;
  assert.deepEqual([p['line/rb:atmos'].to, p['line/rc:atmos'].to], ['mat:桜吹雪', 'mat:桜吹雪']);
  assert.ok(!Object.keys(p).some((k) => k.startsWith('line/r4:') && k.endsWith(':atmos')), 'the atmosphere only in brief 0');
  assert.deepEqual([p['line/rc:ornament#0'].to, p['line/r5:ornament#0'].to], ['mat:角飾り', 'mat:角飾り'], 's −1: line 1 of every brief');
  assert.deepEqual(p['line/r5:ornament#0'].requires, [matId('角飾り')]);
  assert.equal(p['cut/r4~7:arrive'].to, 'mat:ふわ入り', 'a use cut');
  assert.equal(p['cut/rb~0:seam'].to, 'mat:溶け替え', 'a transition goes into the first cut of the line');
  assert.equal(p['cut/rb~0:seam'].cutSig, '飛ばせ');
  const cmds = CH.toCommands(DOC, PLAN, r.changes);
  deepEqual(cmds.filter((c) => c.t === 'material.put').map((c) => [c.id, c.kind]), [['m4', 'ornament'], ['m5', 'ornament'], ['m6', 'arrive'], ['m7', 'seam']]);
  assert.equal(cmds.find((c) => c.path === 'cut/rb~0:seam').v, 'myMat7');
  const after = CMD.reduce(DOC, { t: 'batch', cmds });
  assert.equal(after.materials.next, 8);
  assert.equal(after.pins['line/r5:ornament#0'].v, 'myMat5');
});

// ---- media (§11.6.1) --------------------------------------------------------------------------------------------------

function mediaAsk(answers, doc) {
  return direct(doc || DOC, [CHORUS], answers, { media: true });
}
const n = (name) => DOC.media.list.findIndex((e) => e.name === name);

test('media: the [media] list holds names, sizes and vision text only; no request carries pixels', () => {
  const q = DI.directRequests(DOC, PLAN, reg, { briefs: [{ ref: CHORUS, instruction: '写真を背景に' }], uiLang: 'ja', mode: 'all', media: true, allowMaterials: true });
  const req = q[0];
  assert.equal(req.schema, DI.directSchema({ mode: 'all', allowMaterials: true, media: true }));
  assert.ok(req.system.includes('Media: the user\'s photos and videos are listed as asset:<n>.'));
  const list = req.prompt.slice(req.prompt.indexOf('[media]')).split('\n').slice(0, 5);
  deepEqual(list, [
    '[media] the user\'s own photos and videos (use only these, as "asset:<n>")',
    'asset:0 image 800×800 square "ロゴ.png" — (no description)',
    'asset:1 image 4032×3024 landscape "空.jpg" — 夕方の空 · colours #F2A65A #3D5A80 · text area: upper third',
    'asset:2 video 0:13 1920×1080 landscape "海辺.mp4" — (no description)',
    'asset:3 video 0:04 1280×720 landscape "きらめき.webm" — (no description)']);
  assert.ok(req.prompt.includes('media layer: media "" = a picture the user picks'), 'the recipe text knows media layers');
  assert.equal(req.media, undefined, 'no request parts');
  const json = JSON.stringify(q);
  for (const bad of ['inline_data', 'inlineData', 'base64', 'data:image', 'bytes', 'blob']) assert.ok(!json.includes(bad), bad);
  assert.ok(!json.includes('"' + DOC.media.list[0].bytes), 'no byte counts');
  const only = DI.directRequests(DOC, PLAN, reg, { briefs: [{ ref: CHORUS, instruction: 'x' }], uiLang: 'en', media: [ASSET['海辺.mp4'].id] });
  deepEqual(only[0].sent.media.map((m) => [m.n, m.name]), [[0, '海辺.mp4']], 'only the assets on this device');
  assert.ok(only[0].prompt.includes('asset:0 video 0:13'));
  const off = DI.directRequests(DOC, PLAN, reg, { briefs: [{ ref: CHORUS, instruction: 'x' }], uiLang: 'ja' });
  assert.ok(!off[0].prompt.includes('[media]') && !off[0].system.includes('Media:'));
  assert.deepEqual(off[0].sent.media, []);
});

test('media as ground: photoPan and its image, plus fit, blur, veil, clipIn (from) and speed when given', () => {
  const sea = ASSET['海辺.mp4'];
  const r = mediaAsk([ANSWER(0, { all: ALL({ media: MED({ use: 'asset:' + n('海辺.mp4'), as: 'ground', fit: 'soft', blur: 12, veil: 0.4, from: 3, speed: 0.5 }) }) })]);
  const p = byPath(r.changes);
  assert.deepEqual([p['line/rb:ground'].kind, p['line/rb:ground'].to, p['line/rb:ground'].agg], ['part', 'photoPan', 'song:2@24-40|ground']);
  const img = p['line/rb:ground@photoPan.image'];
  assert.deepEqual([img.kind, img.to, img.toName, img.field, img.agg], ['value', sea.id, '海辺.mp4', 'fld.media', 'song:2@24-40|ground.image']);
  assert.deepEqual(['fit', 'blur', 'veil', 'clipIn', 'speed'].map((k) => p['line/rc:ground@photoPan.' + k].to), ['soft', 12, 0.4, 3, 0.5]);
  const cmds = CH.toCommands(DOC, PLAN, r.changes);
  deepEqual(cmds.slice(0, 2), [{ t: 'pin.set', path: 'line/rb:ground', v: 'photoPan', by: 'ai' },
    { t: 'pin.set', path: 'line/rc:ground', v: 'photoPan', by: 'ai' }]);
  const after = CMD.reduce(DOC, { t: 'batch', cmds });
  assert.equal(after.pins['line/rc:ground@photoPan.image'].v, sea.id);
  // a clip start past the end reads as 0; a still takes no clip or speed
  const late = mediaAsk([ANSWER(0, { lines: [LINE(0, { media: MED({ use: 'asset:' + n('海辺.mp4'), from: 99 }) }),
    LINE(1, { media: MED({ use: 'asset:' + n('空.jpg'), from: 2, speed: 2 }) })] })]);
  const q = byPath(late.changes);
  assert.equal(q['line/rb:ground@photoPan.clipIn'].to, 0);
  assert.ok(!q['line/rc:ground@photoPan.clipIn'] && !q['line/rc:ground@photoPan.speed']);
});

test('media as frame, fill and overlay: ornament#free = photoFrame / textFill, atmos = mediaLayer, each with its src', () => {
  const r = mediaAsk([ANSWER(0, { lines: [
    LINE(0, { media: MED({ use: 'asset:' + n('空.jpg'), as: 'frame', blur: 2 }) }),
    LINE(1, { media: MED({ use: 'asset:' + n('ロゴ.png'), as: 'fill' }) }),
  ], all: ALL({ media: MED({ use: 'asset:' + n('きらめき.webm'), as: 'overlay' }) }) })]);
  const p = byPath(r.changes);
  assert.deepEqual([p['line/rb:ornament#0'].to, p['line/rb:ornament#0@photoFrame.src'].to, p['line/rb:ornament#0@photoFrame.blur'].to],
    ['photoFrame', ASSET['空.jpg'].id, 2]);
  assert.deepEqual([p['line/rc:ornament#0'].to, p['line/rc:ornament#0@textFill.src'].to], ['textFill', ASSET['ロゴ.png'].id]);
  assert.ok(!p['line/rb:atmos'] && !p['line/rc:atmos'], 'lines[i].media wins over all.media');
  const o = mediaAsk([ANSWER(0, { all: ALL({ media: MED({ use: 'asset:' + n('きらめき.webm'), as: 'overlay' }) }) })]);
  const q = byPath(o.changes);
  assert.deepEqual([q['line/rb:atmos'].to, q['line/rb:atmos@mediaLayer.src'].to, q['line/rc:atmos@mediaLayer.src'].to],
    ['mediaLayer', ASSET['きらめき.webm'].id, ASSET['きらめき.webm'].id]);
});

test('media checks: an unknown asset warns; the kind must fit the part; use none clears the AI media pins of the area', () => {
  const unknown = mediaAsk([ANSWER(0, { all: ALL({ media: MED({ use: 'asset:9' }) }) })]);
  assert.equal(unknown.changes.length, 0);
  assert.ok(unknown.warnings.some((w) => w[0] === 'ai.warn.mediaUnknown' && w[1].name === 'asset:9'));
  const notOffered = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ media: MED({ use: 'asset:0' }) }) })]);
  assert.ok(!notOffered.changes.length && hasWarn(notOffered.warnings, 'ai.warn.mediaUnknown'), 'no [media] list, no asset');
  const kind = mediaAsk([ANSWER(0, { all: ALL({ media: MED({ use: 'asset:' + n('海辺.mp4'), as: 'fill' }) }) })]);
  assert.equal(kind.changes.length, 0);
  assert.ok(kind.warnings.some((w) => w[0] === 'warn.media-kind' && w[1].detail === '海辺.mp4'), 'textFill takes stills here');
  const still = mediaAsk([ANSWER(0, { all: ALL({ media: MED({ use: 'asset:' + n('空.jpg'), as: 'overlay' }) }) })]);
  assert.ok(!still.changes.length && hasWarn(still.warnings, 'warn.media-kind'), 'mediaLayer takes videos here');
  // none: the AI's media pins in the area go, the user's and those outside stay
  const sea = ASSET['海辺.mp4'].id;
  const doc = CMD.reduce(DOC, { t: 'batch', cmds: [
    { t: 'pin.set', path: 'line/rb:ground', v: 'photoPan', by: 'ai' },
    { t: 'pin.set', path: 'line/rb:ground@photoPan.image', v: sea, by: 'ai' },
    { t: 'pin.set', path: 'cut/rc~7:ornament#1', v: 'photoFrame', by: 'ai', sig: '強くなれる' },
    { t: 'pin.set', path: 'line/rc:ground', v: 'photoPan', by: 'user' },
    { t: 'pin.set', path: 'line/r4:ground', v: 'photoPan', by: 'ai' },
  ] });
  const none = mediaAsk([ANSWER(0, { all: ALL({ media: MED({ use: 'none' }) }) })], doc);
  deepEqual(none.changes.map((c) => [c.path, c.kind, c.from, c.to]).sort(), [
    ['cut/rc~7:ornament#1', 'value', 'photoFrame', null], ['line/rb:ground', 'value', 'photoPan', null],
    ['line/rb:ground@photoPan.image', 'value', sea, null]]);
  const cmds = CH.toCommands(doc, planOf(doc), none.changes);
  assert.ok(cmds.every((c) => c.t === 'pin.clear'));
  const after = CMD.reduce(doc, { t: 'batch', cmds });
  assert.ok(!after.pins['line/rb:ground'] && after.pins['line/rc:ground'] && after.pins['line/r4:ground']);
});

test('media depth (§11.9.4): each value is one pin of the media part\'s depth at the answer\'s scope; keep changes nothing', () => {
  const sea = ASSET['海辺.mp4'].id;
  // a pooled asset's derived ground (§11.5.9), as parts/mix would register it
  const key = 'myMed' + sea.slice(1, 11);
  const derived = Object.assign({}, reg.get('ground', 'photoPan'), { key, pool: true, mine: { id: sea, rhash: sea, cost: 0.4, by: 'user', media: true } });
  const ext = REG.extend(reg, [derived]);
  const doc = CMD.reduce(DOC, { t: 'batch', cmds: [
    { t: 'pin.set', path: 'work:ground', v: 'photoPan', by: 'user' },
    { t: 'pin.set', path: 'work:ground@photoPan.image', v: sea, by: 'user' },
    { t: 'pin.set', path: 'line/rc:ground', v: key, by: 'user' },
    { t: 'pin.set', path: 'line/rb:ornament#1', v: 'photoFrame', by: 'user' },
    { t: 'pin.set', path: 'cut/rc~7:atmos', v: 'mediaLayer', by: 'user', sig: '強くなれる' },
  ] });
  const plan = PL.plan(doc, { registry: ext });
  const ask = (ref, answer) => {
    const q = DI.directRequests(doc, plan, ext, { briefs: [{ ref, instruction: 'x' }], uiLang: 'ja', media: true })[0];
    return DI.directChanges(doc, plan, ext, { answers: [answer] }, { rev: 1, sent: q.sent }).changes.map((c) => [c.path, c.kind, c.to]);
  };
  // 「背景を後ろに下げて」 for the whole video: the work ground
  deepEqual(ask(WORKREF, ANSWER(0, { all: ALL({ media: MED({ as: 'ground', depth: 'back' }) }) })), [['work:ground@photoPan.depth', 'value', 'back']]);
  // 「背景は動かさないで」 in the chorus: each line's ground, whatever media part it is (photoPan through the work pin, or a pooled asset)
  deepEqual(ask(CHORUS, ANSWER(0, { all: ALL({ media: MED({ as: 'ground', depth: 'still' }) }) })),
    [['line/rb:ground@photoPan.depth', 'value', 'still'], ['line/rc:ground@' + key + '.depth', 'value', 'still']]);
  // 「写真を前に出して」 for one line: the photo frame of that line
  deepEqual(ask(CHORUS, ANSWER(0, { lines: [LINE(0, { media: MED({ as: 'frame', depth: 'front' }) }), LINE(1, { media: MED({ as: 'frame', depth: 'front' }) })] })),
    [['line/rb:ornament#1@photoFrame.depth', 'value', 'front']], 'rc shows no photo frame');
  // 「背景も一緒に動かして」 for one cut: its overlay footage
  deepEqual(ask({ kind: 'cut', key: 'rc~7' }, ANSWER(0, { all: ALL({ media: MED({ as: 'overlay', depth: 'anim' }) }) })),
    [['cut/rc~7:atmos@mediaLayer.depth', 'value', 'anim']]);
  // keep, fill (no depth) and nothing to change
  deepEqual(ask(CHORUS, ANSWER(0, { all: ALL({ media: MED({ as: 'ground', depth: 'keep' }) }) })), []);
  deepEqual(ask(CHORUS, ANSWER(0, { all: ALL({ media: MED({ as: 'fill', depth: 'back' }) }) })), []);
  deepEqual(ask(VERSE, ANSWER(0, { all: ALL({ media: MED({ as: 'overlay', depth: 'back' }) }) })), [], 'the verse shows no overlay');
  // a placed asset takes the depth too
  const placed = mediaAsk([ANSWER(0, { lines: [LINE(0, { media: MED({ use: 'asset:' + n('空.jpg'), as: 'frame', depth: 'still' }) })] })]);
  assert.equal(byPath(placed.changes)['line/rb:ornament#0@photoFrame.depth'].to, 'still');
  // one change each, reviewable and revertible
  const q = DI.directRequests(doc, plan, ext, { briefs: [{ ref: CHORUS, instruction: 'x' }], uiLang: 'ja', media: true })[0];
  const r = DI.directChanges(doc, plan, ext, { answers: [ANSWER(0, { all: ALL({ media: MED({ as: 'ground', depth: 'back' }) }) })] }, { rev: 1, sent: q.sent });
  const cmds = CH.toCommands(doc, plan, r.changes);
  deepEqual(cmds, [{ t: 'pin.set', path: 'line/rb:ground@photoPan.depth', v: 'back', by: 'ai' },
    { t: 'pin.set', path: 'line/rc:ground@' + key + '.depth', v: 'back', by: 'ai' }]);
  const after = CMD.reduce(doc, { t: 'batch', cmds });
  const entry = CH.logEntry(doc, cmds, { runId: 'd', tool: 'direct' });
  deepEqual(CMD.reduce(after, { t: 'batch', cmds: CH.revertCommands(after, { applied: [entry.applied[1]] }).cmds }).pins,
    CMD.reduce(doc, { t: 'batch', cmds: [cmds[0]] }).pins, 'one path goes back');
  const ja = T.createT('ja', STRINGS, ext, { strict: true });
  for (const c of r.changes) assert.ok(CH.describe(c, ja).length > 0);
});

// ---- common rules and the area guarantee ------------------------------------------------------------------------

test('common rules: a locked line keeps its look; a slot every cut pins by hand is left; a value it holds is no change', () => {
  const locked = CMD.reduce(DOC, { t: 'lock.set', lineId: 'rc', pins: {} });
  const r = direct(locked, [CHORUS], [ANSWER(0, { all: ALL({ arrive: 'inkRise', speed: 0.5 }) })]);
  deepEqual(r.changes.map((c) => c.path), ['line/rb:arrive', 'line/rb:motion.speed']);
  assert.ok(r.warnings.some((w) => w[0] === 'ai.warn.locked' && w[1].n === 6));
  const pinned = CMD.reduce(DOC, { t: 'batch', cmds: [
    { t: 'pin.set', path: 'cut/rc~0:dwell', v: 'stillHold', by: 'user', sig: '折り目の数だけ' },
    { t: 'pin.set', path: 'cut/rc~7:dwell', v: 'stillHold', by: 'user', sig: '強くなれる' },
    { t: 'pin.set', path: 'cut/rc~0:cam.follow', v: 0.1, by: 'user', sig: '折り目の数だけ' },
    { t: 'pin.set', path: 'cut/rc~7:cam.follow', v: 0.1, by: 'user', sig: '強くなれる' },
  ] });
  const q = direct(pinned, [CHORUS], [ANSWER(0, { all: ALL({ dwell: 'swaySwing', camera: CAM({ follow: 0.5 }) }) })]);
  deepEqual(q.changes.map((c) => c.path), ['line/rb:dwell', 'line/rb:cam.follow']);
  assert.ok(q.warnings.some((w) => w[0] === 'ai.warn.pinned' && w[1].kind === 'dwell'));
  assert.ok(q.warnings.some((w) => w[0] === 'ai.warn.pinned' && w[1].field === 'fld.camFollow'));
  const same = direct(DOC, [CHORUS], [ANSWER(0, { lines: [LINE(0, { camera: CAM({ shot: 'pushWord' }) }), LINE(1, { camera: CAM({ closer: 1.2 }) })] })]);
  assert.equal(same.changes.length, 0, 'rb holds pushWord and rc 1.2 already');
});

test('area guarantee: an i outside the brief is ai.warn.notInArea; a change outside its area is dropped; apply checks again', () => {
  const r = direct(DOC, [CHORUS], [ANSWER(0, { lines: [LINE(2, { arrive: 'inkRise' }), LINE(-1, { arrive: 'inkRise' })] })]);
  assert.equal(r.changes.length, 0);
  assert.ok(r.warnings.some((w) => w[0] === 'ai.warn.notInArea' && w[1].n === 3));
  // a request whose sent cut belongs to another line (a programming error): the guard drops it and says so
  const req = DI.directRequests(DOC, PLAN, reg, { briefs: [{ ref: CHORUS, instruction: 'x' }], uiLang: 'ja' })[0];
  const sent = JSON.parse(JSON.stringify(req.sent));
  sent.briefs[0].lines[0].cuts.push({ j: 3, key: 'r4~0', text: PLAN.cuts.find((c) => c.key === 'r4~0').text });
  const g = DI.directChanges(DOC, PLAN, reg, { answers: [ANSWER(0, { cuts: [CUT(0, 3, { arrive: 'inkRise' }), CUT(0, 0, { arrive: 'fogIn' })] })] }, { rev: 1, sent });
  deepEqual(g.changes.map((c) => c.path), ['cut/rb~0:arrive']);
  deepEqual(g.warnings, [['ai.warn.outside', { n: 1 }]]);
  // toCommands with resolveArea: a line that left the area (a lines area of one line) is not applied
  const two = direct(DOC, [{ kind: 'lines', ids: ['rb', 'rc'] }], [ANSWER(0, { all: ALL({ arrive: 'inkRise' }) })]);
  assert.equal(two.changes.length, 2);
  const now = { 'lines:rb,rc': AREAS.resolve(DOC, PLAN, { kind: 'lines', ids: ['rb'] }) };
  deepEqual(CH.toCommands(DOC, PLAN, two.changes, { resolveArea: (k) => now[k] }).map((c) => c.path), ['line/rb:arrive']);
  deepEqual(CH.toCommands(DOC, PLAN, two.changes, { resolveArea: () => null }), [], 'the area is gone');
});

test('results: understood false gives no changes and keeps the question; a gone area warns; unknown s is ignored', () => {
  const r = direct(DOC, [CHORUS, VERSE], [ANSWER(1, { understood: false, question: 'どの季節？', all: ALL({ arrive: 'inkRise' }) }),
    ANSWER(0, { summary: 'ゆっくりに', all: ALL({ speed: 0.5 }) }), ANSWER(7, { all: ALL({ arrive: 'inkRise' }) }), ANSWER(0, { all: ALL({ arrive: 'fogIn' }) })]);
  deepEqual(r.results, [{ s: 1, areaKey: 'song:1@4-24', understood: false, summary: '要約', question: 'どの季節？' },
    { s: 0, areaKey: 'song:2@24-40', understood: true, summary: 'ゆっくりに', question: '' }]);
  assert.ok(r.changes.every((c) => c.areaKey === 'song:2@24-40' && c.path.endsWith('motion.speed')), 'the first answer for s wins');
  const req = DI.directRequests(DOC, PLAN, reg, { briefs: [{ ref: CHORUS, instruction: 'x' }], uiLang: 'ja' })[0];
  const edited = CMD.reduce(DOC, { t: 'song.info', info: Object.assign({}, DOC.song.info, { sections: [] }) });
  const gone = DI.directChanges(edited, planOf(edited), reg, { answers: [ANSWER(0, { all: ALL({ speed: 0.5 }) })] }, { rev: 1, sent: req.sent });
  assert.equal(gone.changes.length, 0);
  deepEqual(gone.warnings, [['ai.warn.areaGone', {}]]);
  deepEqual(DI.directChanges(DOC, PLAN, reg, { nope: 1 }, { sent: req.sent }).warnings, [['ai.warn.empty', {}]]);
});

// ---- camera mode ----------------------------------------------------------------------------------------------------

test('camera mode: low effort, the instruction may be empty, camera lists only; the answer sets camera and rig slots', () => {
  const q = DI.directRequests(DOC, PLAN, reg, { briefs: [{ ref: CHORUS, instruction: '' }], uiLang: 'ja', mode: 'camera', allowMaterials: true, media: true });
  assert.equal(q.length, 1);
  assert.equal(q[0].effort, 'low');
  assert.equal(q[0].schema, DI.directSchema({ mode: 'camera' }));
  assert.ok(q[0].prompt.includes('instruction: (none: choose camerawork that suits the lyrics)'));
  assert.ok(q[0].prompt.includes('[shots] ') && !q[0].prompt.includes('[arrive] ') && !q[0].prompt.includes('[media]'));
  assert.ok(q[0].system.includes('Choose camerawork that serves the lyrics') && !q[0].system.includes('Materials:'));
  deepEqual([q[0].sent.mode, q[0].sent.allowMaterials, q[0].sent.media], ['camera', false, []]);
  const ans = { s: 0, understood: true, summary: '寄る', question: '', all: { rig: 'pullAway', rigCurve: CURVE(''), camera: CAM({ shot: 'readAlong' }) },
    lines: [{ i: 1, camera: CAM({ shot: 'none' }) }], cuts: [{ i: 0, j: 2, camera: CAM({ closer: 0.8 }) }] };
  const r = DI.directChanges(DOC, PLAN, reg, { answers: [ans], materials: [material({})] }, { rev: 1, sent: q[0].sent });
  deepEqual(r.changes.map((c) => [c.path, c.to]).sort(), [['cut/rb~8:cam.zoom', 0.8], ['line/rb:cam.shot', 'readAlong'], ['line/rb:rig', 'pullAway'],
    ['line/rc:cam.shot', 'none'], ['line/rc:rig', 'pullAway']]);
});

// ---- review, apply, stale, log and revert (§5.6) ----------------------------------------------------------------------

function scenario(doc) {
  return direct(doc || WINTER, [CHORUS, WORKREF], [
    ANSWER(0, { all: ALL({ atmos: 'mat:桜吹雪', speed: 0.5, arriveCurve: CURVE('ramp', { ends: 'both', edge: 0.1, peak: 6 }),
      camera: CAM({ shot: 'custom', move: 'pushIn' }), rig: 'slowSwell' }), lines: [LINE(0, { impact: 'on' })],
    cuts: [CUT(1, 1, { arrive: 'wordPop' })], work: WORK({ mood: 'quietHush' }) }),
    ANSWER(1, { work: WORK({ flash: 'off' }) }),
  ], { allowMaterials: true, materials: [material({})] });
}

test('toCommands: materials, work pins, season and avoid, parts, values, lyrics; one batch is one undo step', () => {
  const r = scenario();
  const kinds = new Set(r.changes.map((c) => c.kind));
  for (const k of ['material', 'part', 'value', 'flash', 'impact', 'mood']) assert.ok(kinds.has(k), k);
  const checked = r.changes.map((c) => Object.assign({}, c, { checked: true }));   // the outside mood too
  const cmds = CH.toCommands(WINTER, WINTER_PLAN, checked);
  const order = cmds.map((c) => (c.t === 'pin.set' ? (c.path.startsWith('work:') ? 'work' : /:(season|avoid)$/.test(c.path) ? 'line'
    : ['atmos', 'arrive'].includes(c.path.split(':')[1]) ? 'part' : 'value') : c.t));
  const rank = { 'material.put': 0, work: 1, line: 2, part: 3, value: 4, 'lyrics.row': 5 };
  assert.ok(order.every((x, i) => i === 0 || rank[order[i - 1]] <= rank[x]), order.join(' '));
  assert.ok(order.includes('line') && order.includes('lyrics.row'));
  const store = ST.createStore({ doc: WINTER, reduce: CMD.reduce });
  store.batch({ label: ['undo.aiArea', { area: 'サビ1', n: cmds.length }] }, cmds);
  assert.equal(store.list().length, 1, 'one undo step');
  assert.equal(store.doc.materials.list.length, 4);
  assert.equal(store.doc.pins['line/rc:atmos'].v, 'myMat4');
  assert.equal(store.doc.pins['line/rc:season'].v, 'spring');
  assert.equal(store.doc.pins['cut/rc~7:arrive'].sig, '強くなれる');
  assert.deepEqual(store.doc, CH.apply(WINTER, WINTER_PLAN, checked), 'try-on gives the same document');
  store.undo();
  assert.equal(store.doc, WINTER, 'undo restores materials and pins');
  store.redo();
  assert.equal(store.doc.materials.next, 5);
});

test('markStale: changed, left (area), gone (cut) and material; newly stale rows are unchecked', () => {
  const r = scenario();
  const fresh = CH.markStale(WINTER, WINTER_PLAN, r.changes, { resolveArea: (k) => AREAS.resolve(WINTER, WINTER_PLAN, k === 'work' ? WORKREF : CHORUS) });
  assert.ok(fresh.every((c, i) => c === r.changes[i]), 'nothing changed: the same rows');
  // changed: the user pins a speed; material: an entry takes the planned id; gone: the cut's words change
  const later = CMD.reduce(WINTER, { t: 'batch', cmds: [
    { t: 'pin.set', path: 'line/rb:motion.speed', v: 2, by: 'user' },
    { t: 'material.put', id: 'm4', kind: 'dwell', by: 'user', name: { ja: '揺れ' }, recipe: { osc: [{ col: 'y', amp: 0.05, hz: 0.5 }] } },
    { t: 'lyrics.row', rowId: 'rc', src: '[00:30.00]折り目の数だけ/強くなるよ' },
  ] });
  const planLater = planOf(later);
  const left = { 'song:2@24-40': AREAS.resolve(later, planLater, { kind: 'lines', ids: ['rb'] }), work: AREAS.resolve(later, planLater, WORKREF) };
  const m = CH.markStale(later, planLater, r.changes, { resolveArea: (k) => left[k] });
  const why = Object.fromEntries(m.map((c) => [c.path || c.id, c.staleWhy]));
  assert.equal(why['line/rb:motion.speed'], 'changed');
  assert.equal(why[r.changes.find((c) => c.kind === 'material').id], 'material');
  assert.equal(why['cut/rc~7:arrive'], 'gone');
  assert.equal(why['line/rc:rig'], 'left');
  assert.ok(!why['line/rb:rig'] && !m.find((c) => c.path === 'line/rb:rig').stale, 'still in the area');
  assert.ok(m.filter((c) => c.stale).every((c) => c.checked === false));
  assert.ok(CH.STALE_WHY.includes('left'));
  // a remade material is stale once its entry changed
  const remake = RECIPE.materialChange(DOC, RECIPE.fromAi(material({}), reg).entry, { id: 'mat:0', current: DOC.materials.list[2] }, { rev: 1 });
  const edited = CMD.reduce(DOC, { t: 'material.meta', id: 'm3', tags: ['soft'] });
  deepEqual(CH.markStale(edited, PLAN, [remake]).map((c) => [c.stale, c.staleWhy]), [[true, 'material']]);
});

test('log and revert: pins first, a created material removed, kept while the user uses it; per path and per material', () => {
  const r = scenario();
  const cmds = CH.toCommands(WINTER, WINTER_PLAN, r.changes);
  const store = ST.createStore({ doc: WINTER, reduce: CMD.reduce });
  store.batch({ label: ['undo.aiArea', { area: 'サビ1', n: cmds.length }] }, cmds);
  const entry = CH.logEntry(WINTER, cmds, { runId: 'd1', tool: 'direct', n: r.changes.length,
    areas: [{ key: 'song:2@24-40', label: ['area.song', { kind: 'chorus', n: 1 }] }], instructions: ['あ'.repeat(400)] });
  const matItem = entry.applied.find((a) => a.material);
  deepEqual([matItem.material, matItem.prev], ['m4', null]);
  assert.equal(matItem.to, CH.entryHash(store.doc.materials.list[3]));
  assert.equal(entry.instructions[0].length, 300);
  deepEqual(entry.areas, [{ key: 'song:2@24-40', label: ['area.song', { kind: 'chorus', n: 1 }] }]);
  const back = CH.revertCommands(store.doc, entry);
  assert.equal(back.kept, 0);
  assert.equal(back.cmds[back.cmds.length - 1].t, 'material.remove', 'pins go back first');
  const reverted = CMD.reduce(store.doc, { t: 'batch', cmds: back.cmds });
  assert.deepEqual(reverted.materials.list, WINTER.materials.list);
  assert.deepEqual(reverted.pins, WINTER.pins);
  // the user uses the material somewhere else: it is kept, the AI pins still go
  const used = CMD.reduce(store.doc, { t: 'pin.set', path: 'line/r4:atmos', v: 'myMat4', by: 'user' });
  const k = CH.revertCommands(used, entry);
  assert.equal(k.kept, 1);
  assert.ok(!k.cmds.some((c) => c.t === 'material.remove'));
  // one path, one material
  const one = CH.revertCommands(store.doc, { applied: [entry.applied.find((a) => a.path === 'line/rb:motion.speed')] });
  deepEqual(one, { cmds: [{ t: 'pin.clear', path: 'line/rb:motion.speed' }], kept: 0 });
  deepEqual(CH.revertCommands(store.doc, { applied: [matItem] }).cmds, [{ t: 'material.remove', id: 'm4' }]);
  // a remade material goes back to its previous entry, only while it still holds the AI's version
  const remake = RECIPE.materialChange(DOC, RECIPE.fromAi(material({ name: '別名' }), reg).entry, { id: 'mat:0', current: DOC.materials.list[2] }, { rev: 1 });
  const put = CH.toCommands(DOC, PLAN, [remake]);
  deepEqual([put[0].t, put[0].id, put[0].name], ['material.put', 'm3', { ja: '桜吹雪', en: 'Cherry flurry' }], 'a remake keeps the name');
  const redone = CMD.reduce(DOC, { t: 'batch', cmds: put });
  const e2 = CH.logEntry(DOC, put, { runId: 'd2', tool: 'material' });
  deepEqual(e2.applied[0].prev, DOC.materials.list[2]);
  const undo = CH.revertCommands(redone, e2);
  assert.deepEqual(CMD.reduce(redone, { t: 'batch', cmds: undo.cmds }).materials, DOC.materials);
  const touched = CMD.reduce(redone, { t: 'material.meta', id: 'm3', pool: true });
  assert.equal(CH.revertCommands(touched, e2).kept, 1, 'changed since: kept');
});

test('review text: every row reads in ja and en (strict keys); aggregate rows and warnings', () => {
  const r = scenario();
  const media = direct(DOC, [CHORUS], [ANSWER(0, { all: ALL({ media: MED({ use: 'asset:' + n('空.jpg'), veil: 0.3 }) }), lines: [LINE(1, { ornaments: ['nope'] })] })], { media: true });
  for (const lang of ['ja', 'en']) {
    const t = T.createT(lang, STRINGS, reg, { strict: true });
    for (const c of r.changes.concat(media.changes)) assert.ok(CH.describe(c, t).length > 0, c.id);
    for (const w of r.warnings.concat(media.warnings, [['ai.warn.pinned', { n: 3, field: 'fld.camShot' }], ['ai.warn.lineUnknown', { n: 1, kind: 'atmos', key: 'x' }],
      ['ai.warn.pinned', { n: 2, kind: 'ornament#1' }], ['warn.media-kind', { detail: '海辺.mp4' }], ['ai.warn.mediaUnknown', { name: 'asset:9' }],
      ['ai.warn.matScaled', { name: 'x' }], ['ai.warn.outside', { n: 2 }], ['ai.warn.noSlot', { n: 4 }], ['ai.warn.backdrop', { n: 4 }]])) {
      assert.ok(CH.warningText(w, t).length > 0, w[0]);
    }
  }
  const ja = T.createT('ja', STRINGS, reg, { strict: true });
  const speed = r.changes.filter((c) => c.agg === 'song:2@24-40|motion.speed');
  assert.equal(CH.describeAgg(speed, ja), '動きの速さ: 自動 → 50%（2行）');
  const ground = media.changes.filter((c) => c.agg === 'song:2@24-40|ground.image');
  assert.equal(CH.describeAgg(ground, ja), '写真・動画: 自動 → 空.jpg（2行）');
  assert.equal(CH.describe(r.changes.find((c) => c.kind === 'material'), ja), '新しい素材「桜吹雪」 装飾 · 春');
  assert.equal(CH.describe(r.changes.find((c) => c.path === 'line/rc:atmos'), ja), '6行 · 空気（粒子）: 自動（none） → 桜吹雪'.replace('none', 'なし'));
});
