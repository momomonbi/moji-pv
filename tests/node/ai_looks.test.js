/* 文字PVメーカー v2 — original work. Tests for ai/catalog, ai/looks and ai/changes: 演出3案, ひとこと修正, commands (DESIGN §4.22, §8.2). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { deepEqual } = require('../helpers/assert_plus.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const CAT = MV.use('ai/catalog');
const LK = MV.use('ai/looks');
const CH = MV.use('ai/changes');
const L = MV.use('core/lyrics');
const D = MV.use('core/doc');
const C = MV.use('core/color');
const CMD = MV.use('core/commands');
const ST = MV.use('core/store');
const REG = MV.use('core/registry');
const T = MV.use('i18n/t');
const LOOK = MV.use('planner/look');

const LB = (ja, en) => ({ ja, en });

// The stub parts plus a few seasonal and special ones (test-only keys and labels).
function registry() {
  const all = corpus.allStubParts();
  const base = (kind, key) => all.find((d) => d.kind === kind && d.key === key);
  const clone = (kind, key, patch) => Object.assign({}, base(kind, key), { fallback: false }, patch);
  return REG.createRegistry(all.concat([
    clone('ornament', 'stubRule', { key: 'snowDust', label: LB('粉雪', 'Snow dust'), season: 'winter', scope: 'run' }),
    clone('ornament', 'stubRule', { key: 'petalFall', label: LB('花びら', 'Petal fall'), season: 'spring', scope: 'run' }),
    clone('ornament', 'stubRule', { key: 'fireflyGlow', label: LB('蛍', 'Firefly glow'), season: 'summer', scope: 'run' }),
    clone('arrive', 'stubFade', { key: 'heatRise', label: LB('陽炎', 'Heat rise'), season: 'summer' }),
    clone('arrive', 'stubFade', { key: 'snowFall', label: LB('雪', 'Snow fall'), season: 'winter' }),
    clone('arrange', 'stubBlock', { key: 'giantWhisper', label: LB('大と小', 'Giant & whisper'), tags: ['bold', 'serious'] }),
    clone('arrange', 'centerAnchor', { key: 'titlePlate', label: LB('タイトル札', 'Title plate'), traits: { roles: ['title'] } }),
    clone('theme', 'sumiWashi', { key: 'sakuraFog', label: LB('花霞', 'Sakura fog'), season: 'spring' }),
    clone('theme', 'stubInk', { key: 'cicadaNoon', label: LB('蝉の正午', 'Cicada noon'), season: 'summer' }),
    clone('mood', 'stubBright', { key: 'popFizz', label: LB('はじける', 'Fizz') }),
  ]));
}
const reg = registry();

// The real planner when it is in the tree; otherwise a minimal plan with the §3.12 fields the AI reads.
function planOf(doc) {
  if (MV.has('planner/plan')) return MV.use('planner/plan').plan(doc, { registry: reg });
  const lines = L.linesOf(L.parseSheet(doc.sheet.rows), {});
  const theme = reg.get('theme', 'sumiWashi'), mood = reg.get('mood', 'quietHush');
  const pinned = doc.pins['work:season'];
  const season = pinned ? { v: pinned.v, from: 'pin:work', by: pinned.by }
    : { v: LOOK.scanSeason(L.parseSheet(doc.sheet.rows)).v, from: 'auto' };
  return {
    duration: 4 * lines.length + 3,
    look: { mood: { v: mood.key, from: 'auto' }, theme: { v: theme.key, from: 'auto' }, season,
      amounts: Object.assign({}, mood.amounts), amountsFrom: {}, palette: Object.assign({}, theme.swatch) },
    lines: lines.map((l, i) => ({ id: l.id, row: l.row, index: i, text: l.text, t0: 1 + 4 * i, t1: 4 + 4 * i,
      by: { start: l.stamp === null ? 'auto' : 'lrc', end: 'auto' }, cuts: [l.id + '~0'], locked: !!doc.locks[l.id], lang: l.lang })),
    cuts: lines.map((l) => ({ key: l.id + '~0', line: l.id, role: 'lyric', text: l.text, slots: {
      arrange: { v: 'centerAnchor', from: 'auto' }, arrive: { v: 'stubFade', from: 'auto' },
      depart: { v: 'stubFadeOut', from: 'auto' }, dwell: { v: 'stillHold', from: 'auto' } } })),
  };
}

function docOf(text, patch) {
  const doc = CMD.reduce(D.defaultDoc(), { t: 'lyrics.set', text });
  return patch ? CMD.reduce(doc, { t: 'batch', cmds: patch(doc) }) : doc;
}

const SUMMER = '花火の夜に約束した\n君の浴衣が揺れていた\n*夏休み*が終わらないように!\n花火の夜に約束した';
const PLAIN_SONG = '朝の光を集めて\n君の名前を呼ぶ\n遠くまで届くように\nもう一度歩き出す';
const KEEP = { motion: -1, glitch: -1, chroma: -1, ornament: -1, density: -1, texture: -1, groundSwitch: -1 };
const NO_PALETTE = { accent: '', shiftA: '', shiftB: '' };

function edit(changes, extra) {
  return Object.assign({ understood: true, summary: 's', question: '', changes: Object.assign({
    theme: '', mood: '', season: '', amounts: KEEP, flash: 'keep', palette: NO_PALETTE, avoid: [], allow: [], lines: [],
  }, changes) }, extra);
}
function editLine(i, fields) {
  return Object.assign({ i, arrange: '', arrive: '', depart: '', dwell: '', impact: 'keep', emphasis: [] }, fields);
}
function kinds(changes) { return changes.map((c) => c.kind + (c.partKind ? '.' + c.partKind : c.key ? '.' + c.key : '')); }

// ---- catalog ------------------------------------------------------------------------------------------------------

test('catalog: auto-pick pool under the filters, every season listed and marked, lyric parts only', () => {
  const doc = docOf(SUMMER, () => [{ t: 'filter.set', kind: 'arrive', only: null, deny: ['stubFade'] }]);
  const cat = CAT.catalog(reg, doc);
  deepEqual(Object.keys(cat), ['arrange', 'arrive', 'depart', 'dwell', 'ornament', 'ground']);
  deepEqual(cat.arrive.map((x) => x.key), ['heatRise', 'snowFall'], 'denied and pool:false parts are left out');
  assert.ok(!cat.arrange.some((x) => x.key === 'titlePlate'), 'title-only compositions are left out');
  deepEqual(cat.ornament.find((x) => x.key === 'snowDust'), { key: 'snowDust', name: '粉雪', tags: ['minimal'], season: 'winter' });
  const text = CAT.catalogText(cat);
  assert.ok(text.includes('[ornament] ') && text.includes('snowDust=粉雪{winter}(minimal)'));
  assert.ok(CAT.catalogText(CAT.catalog(reg, doc, ['arrive'], 'en')).includes('heatRise=Heat rise{summer}(soft)'));
  assert.ok(CAT.themesText(reg).includes('sakuraFog=花霞{spring}(organic/literary/soft) light'));
  assert.ok(CAT.moodsText(reg, 'en').includes('popFizz=Fizz'));
  assert.equal(CAT.offText(reg, doc), 'arrive.stubFade');
});

// ---- 演出3案 ---------------------------------------------------------------------------------------------------------

test('proposalsRequest carries the lyrics, themes, moods and the catalog with seasons; no audio', () => {
  const doc = docOf(SUMMER);
  const q = LK.proposalsRequest(doc, planOf(doc), reg, 'ja');
  assert.ok(q.prompt.includes('0: 花火の夜に約束した'));
  assert.ok(q.prompt.includes('3: 花火の夜に約束した'));
  assert.ok(q.prompt.includes('snowDust=粉雪{winter}'));
  assert.ok(q.prompt.includes('petalFall=花びら{spring}'));
  assert.ok(q.prompt.includes('cicadaNoon=蝉の正午{summer}'));
  assert.ok(q.prompt.includes('Moods: '));
  assert.ok(q.prompt.includes('Current settings: theme='));
  assert.ok(!q.prompt.includes('Song analysis'), 'no analysis → no song context');
  assert.ok(!/audio|\.wav|mp3/i.test(q.prompt));
  assert.equal(q.effort, 'medium');
  assert.equal(q.schema, LK.PROPOSALS_SCHEMA);
});

function proposal(fields) {
  return Object.assign({ title: 't', concept: 'c', theme: '', mood: '', amounts: KEEP, flash: false, palette: NO_PALETTE, avoid: [], lines: [] }, fields);
}

test('proposalChanges: three proposals, season shared, off-season and unknown picks dropped with warnings', () => {
  const doc = docOf(PLAIN_SONG);
  const plan = planOf(doc);
  const answer = { topic: '夏祭り', season: 'summer', proposals: [
    proposal({ title: '夜空', theme: 'sakuraFog', mood: 'popFizz', flash: true,
      amounts: { motion: 0.6, glitch: 0.1, chroma: 0.4, ornament: 0.7, density: 0.5, texture: 0.5, groundSwitch: 0.3 },
      palette: { accent: '#FFB000', shiftA: '#00C2B8', shiftB: '#FF3D6E' },
      avoid: ['ornament.snowDust', 'filter.stubDim', 'arrange.nope', 'effect.x', 'dwell.stillHold'],
      lines: [{ i: 2, arrange: 'giantWhisper', arrive: 'heatRise', depart: '', dwell: '' },
        { i: 1, arrange: '', arrive: 'snowFall', depart: 'stubFadeOut', dwell: '' },
        { i: 9, arrange: 'giantWhisper', arrive: '', depart: '', dwell: '' },
        { i: 0, arrange: 'titlePlate', arrive: '', depart: '', dwell: 'nope' }] }),
    proposal({ title: 'B', theme: 'cicadaNoon', amounts: Object.assign({}, KEEP, { motion: 2, chroma: plan.look.amounts.chroma }) }),
    proposal({ title: 'C', theme: 'stubInk', palette: { accent: '#000000', shiftA: '#ff2a2a', shiftB: '#2AA8FF' } }),
    proposal({ title: 'D (a fourth one is ignored)' }),
  ] };
  const pc = LK.proposalChanges(doc, plan, reg, answer);
  assert.equal(pc.theme, '夏祭り');
  assert.equal(pc.season, 'summer');
  assert.equal(pc.proposals.length, 3);
  const a = pc.proposals[0].changes;
  const season = a.find((c) => c.kind === 'season');
  deepEqual([season.path, season.to], ['work:season', 'summer']);
  assert.ok(!a.some((c) => c.kind === 'theme'), 'a spring theme is dropped for a summer song');
  deepEqual(a.filter((c) => c.kind === 'avoid').map((c) => c.filterKind + '.' + c.partKey), ['ornament.snowDust', 'filter.stubDim']);
  const parts = a.filter((c) => c.kind === 'part').map((c) => [c.lineId, c.partKind, c.to]);
  deepEqual(parts, [[plan.lines[2].id, 'arrange', 'giantWhisper'], [plan.lines[2].id, 'arrive', 'heatRise'],
    [plan.lines[1].id, 'depart', 'stubFadeOut']]);
  assert.ok(a.every((c) => c.id.startsWith('p0:')));
  assert.equal(pc.proposals[0].title, '夜空');
  assert.equal(pc.proposals[0].mood, 'popFizz');
  assert.equal(pc.proposals[0].swatches.length, 3);
  const w = pc.proposals[0].warnings.map((x) => x[0]);
  for (const code of ['ai.warn.offSeason', 'ai.warn.lineOffSeason', 'ai.warn.notLine', 'ai.warn.lineUnknown']) assert.ok(w.includes(code), code);
  assert.equal(pc.warnings.length, pc.proposals.reduce((n, p) => n + p.warnings.length, 0));
  const b = pc.proposals[1].changes;
  deepEqual(b.filter((c) => c.kind === 'amount').map((c) => [c.key, c.to]), [['motion', 1]], 'clamped to 0..1; -1 and unchanged values keep');
  assert.ok(b.some((c) => c.kind === 'theme' && c.to === 'cicadaNoon'), 'a summer theme is fine');
  assert.ok(!b.some((c) => c.kind === 'palette'), 'an empty palette keeps the colors');
  assert.equal(pc.proposals[1].swatches, null);
});

test('proposalChanges: the season is not pinned again when the lyrics already give it', () => {
  const doc = docOf(SUMMER);
  const plan = planOf(doc);
  const pc = LK.proposalChanges(doc, plan, reg, { topic: '', season: plan.look.season.v, proposals: [proposal({ theme: 'sakuraFog' })] });
  assert.ok(!pc.proposals[0].changes.some((c) => c.kind === 'season'));
  const pinned = CMD.reduce(doc, { t: 'pin.set', path: 'work:season', v: 'winter', by: 'user' });
  const any = LK.proposalChanges(pinned, planOf(pinned), reg, { topic: '', season: 'any', proposals: [proposal({})] });
  const s = any.proposals[0].changes.find((c) => c.kind === 'season');
  deepEqual([s.to, CH.toCommands(pinned, null, [s])], ['any', [{ t: 'pin.clear', path: 'work:season' }]]);
});

test('palette: the accent is made readable (≥ 3:1) on the resolved ground', () => {
  const doc = docOf(PLAIN_SONG);
  const plan = planOf(doc);
  const pc = LK.proposalChanges(doc, plan, reg, { topic: '', season: 'any', proposals: [
    proposal({ theme: 'stubInk', palette: { accent: '#000000', shiftA: '#ff2a2a', shiftB: '#2AA8FF' } }),
    proposal({ palette: { accent: '#FFFFFF', shiftA: '#FF2A2A', shiftB: '#2AA8FF' } }),
  ] });
  const dark = pc.proposals[0].changes.find((c) => c.kind === 'palette').to;
  const darkGround = plan.look.theme.v === 'stubInk' ? plan.look.palette.ground : reg.get('theme', 'stubInk').swatch.ground;
  assert.ok(C.contrast(dark.accent, darkGround) >= 3, 'black accent lifted on a dark ground');
  assert.equal(dark.shiftA, '#FF2A2A', 'shift colors upper-cased');
  const light = pc.proposals[1].changes.find((c) => c.kind === 'palette').to;
  assert.ok(C.contrast(light.accent, plan.look.palette.ground) >= 3);
  const cmds = CH.toCommands(doc, plan, pc.proposals[0].changes.filter((c) => c.kind === 'palette'));
  deepEqual(cmds, ['accent', 'shiftA', 'shiftB'].map((k) => ({ t: 'pin.set', path: 'work:color.' + k, v: dark[k], by: 'ai' })));
});

test('applying a proposal: one batch, AI pins and filters, lyrics untouched, no off-season motif in 20 seeds', () => {
  const doc = docOf(SUMMER);
  const plan = planOf(doc);
  const pc = LK.proposalChanges(doc, plan, reg, { topic: '', season: 'summer', proposals: [proposal({
    theme: 'cicadaNoon', mood: 'popFizz', flash: true, avoid: ['ornament.snowDust'],
    lines: [{ i: 2, arrange: 'giantWhisper', arrive: 'heatRise', depart: '', dwell: '' }] })] });
  const changes = pc.proposals[0].changes;
  const store = ST.createStore({ doc, reduce: CMD.reduce });
  store.batch({ label: ['undo.ai', { tool: 'looks', n: changes.length }] }, CH.toCommands(store.doc, plan, changes));
  const P2 = store.doc;
  assert.equal(store.list().length, 1);
  assert.equal(P2.sheet, doc.sheet, 'the lyrics are untouched');
  assert.equal(P2.pins['work:theme'].v, 'cicadaNoon');
  assert.equal(P2.pins['work:theme'].by, 'ai');
  deepEqual(P2.filters.ornament, { only: null, deny: ['snowDust'] });
  assert.equal(P2.pins['line/' + plan.lines[2].id + ':arrange'].v, 'giantWhisper');
  if (MV.has('planner/plan')) {
    for (let s = 0; s < 20; s++) {
      const d = CMD.reduce(P2, { t: 'look.omakase', seed: 1000 + s, moodSeed: 77 + s });
      const p = planOf(d);
      assert.equal(p.look.season.v, 'summer');
      assert.equal(p.look.theme.v, 'cicadaNoon');
      const used = p.cuts.flatMap((c) => Object.values(c.slots).map((x) => x && x.v)).concat(p.grounds.flatMap((g) => [g.ground.v, g.atmos.v]));
      assert.ok(!used.some((k) => ['snowDust', 'petalFall', 'snowFall'].includes(k)), 'seed ' + s);
      const cut = p.cuts.find((c) => c.line === plan.lines[2].id);
      assert.equal(cut.slots.arrange.v, 'giantWhisper');
      assert.equal(cut.slots.arrange.by, 'ai');
    }
  }
  store.undo();
  assert.equal(store.doc, doc);
});

// ---- ひとこと修正 ----------------------------------------------------------------------------------------------------

test('editRequest: instruction, settings, pinned lines, parts turned off, selected lines, lyrics with what they show', () => {
  const doc = docOf(SUMMER, (d) => [
    { t: 'pin.set', path: 'line/' + d.sheet.rows[1].id + ':arrive', v: 'stubFade', by: 'user' },
    { t: 'filter.set', kind: 'ornament', only: null, deny: ['snowDust'] },
    { t: 'pin.set', path: 'work:color.accent', v: '#112233', by: 'user' },
  ]);
  const plan = planOf(doc);
  const q = LK.editRequest(doc, plan, reg, 'サビをもっと派手に\n今すぐ', 'ja', { lineIds: [plan.lines[2].id] });
  assert.ok(q.prompt.startsWith('Instruction: サビをもっと派手に 今すぐ'));
  assert.ok(q.prompt.includes('The user selected lines 2'));
  assert.ok(q.prompt.includes('Lines with a manual setting: 1:arrive=stubFade'));
  assert.ok(q.prompt.includes('Parts turned off: ornament.snowDust'));
  assert.ok(q.prompt.includes('Current palette override: none'), 'one pinned color is not a full override');
  assert.ok(/\n2: \*?夏休み|2: 夏休みが終わらないように · /.test(q.prompt));
  assert.equal(q.effort, 'low');
  const long = LK.editRequest(doc, plan, reg, 'あ'.repeat(500), 'en');
  assert.ok(long.prompt.includes('あ'.repeat(300)) && !long.prompt.includes('あ'.repeat(301)));
  assert.match(long.system, /English/);
  assert.ok(!long.prompt.includes('The user selected'));
});

test('editChanges: only real changes (an impact line and an emphasized word are skipped)', () => {
  const doc = docOf(SUMMER);
  const plan = planOf(doc);
  const ec = LK.editChanges(doc, plan, reg, edit({
    amounts: Object.assign({}, KEEP, { motion: 0.95 }), flash: plan.look.amounts.flash > 0 ? 'off' : 'on',
    lines: [editLine(0, { arrange: 'giantWhisper', arrive: 'heatRise', impact: 'on', emphasis: ['花火'] }),
      editLine(2, { impact: 'on', emphasis: ['夏休み'] })],
  }));
  assert.equal(ec.understood, true);
  deepEqual(kinds(ec.changes).sort(), ['amount.motion', 'emphasis', 'flash', 'impact', 'part.arrange', 'part.arrive'].sort());
  const imp = ec.changes.find((c) => c.kind === 'impact');
  deepEqual([imp.rowId, imp.lineId, imp.repeats], [plan.lines[0].row, plan.lines[0].id, 1]);
  assert.equal(imp.diff.after, '*花火*の夜に約束した!');
});

test('applying an edit changes lyric marks only, never the words', () => {
  const doc = docOf(SUMMER);
  const plan = planOf(doc);
  const ec = LK.editChanges(doc, plan, reg, edit({ lines: [editLine(0, { impact: 'on', emphasis: ['花火', '約束'] }), editLine(3, { impact: 'on' })] }));
  const P2 = CH.apply(doc, plan, ec.changes);
  assert.equal(P2.sheet.rows[0].src, '*花火*の夜に*約束*した!');
  assert.equal(P2.sheet.rows[3].src, '花火の夜に約束した!');
  deepEqual(L.linesOf(L.parseSheet(P2.sheet.rows)).map((l) => l.text), L.linesOf(L.parseSheet(doc.sheet.rows)).map((l) => l.text));
  deepEqual(P2.sheet.rows.map((r) => r.id), doc.sheet.rows.map((r) => r.id));
});

test('understood = false or an empty answer gives no changes', () => {
  const doc = docOf(SUMMER);
  const plan = planOf(doc);
  const r = LK.editChanges(doc, plan, reg, edit({ amounts: Object.assign({}, KEEP, { motion: 1 }) }, { understood: false, question: 'どの行？' }));
  deepEqual([r.understood, r.changes, r.question], [false, [], 'どの行？']);
  const e = LK.editChanges(doc, plan, reg, null);
  deepEqual([e.understood, e.changes, e.warnings], [false, [], [['ai.warn.empty', {}]]]);
});

test('avoid / allow: unknown kinds and keys are dropped, not thrown; allow re-enables a part that is off', () => {
  const doc = docOf('A行\nB行', () => [{ t: 'filter.set', kind: 'arrive', only: null, deny: ['heatRise'] },
    { t: 'filter.set', kind: 'ground', only: ['flatFill'], deny: null }]);
  const plan = planOf(doc);
  const r = LK.editChanges(doc, plan, reg, edit({
    avoid: ['theme.neon', 'mood.popFizz', 'effect.x', 'ornament.snowDust', 'arrive.heatRise', 'dwell.stillHold', 'a.b.c'],
    allow: ['constructor.x', 'arrive.heatRise', 'ground.stubTint', 'ornament.hairFrame'],
  }));
  deepEqual(r.changes.map((c) => [c.kind, c.filterKind + '.' + c.partKey]),
    [['avoid', 'ornament.snowDust'], ['allow', 'arrive.heatRise'], ['allow', 'ground.stubTint']]);
  const cmds = CH.toCommands(doc, plan, r.changes);
  deepEqual(cmds, [
    { t: 'filter.set', kind: 'ornament', only: null, deny: ['snowDust'] },
    { t: 'filter.set', kind: 'arrive', only: null, deny: null },
    { t: 'filter.set', kind: 'ground', only: ['flatFill', 'stubTint'], deny: null },
  ]);
  const P2 = CH.apply(doc, plan, r.changes);
  assert.equal(P2.filters.arrive, undefined);
});

test('avoid never empties an only-list', () => {
  const doc = docOf('A行', () => [{ t: 'filter.set', kind: 'ground', only: ['stubTint'], deny: null }]);
  const r = LK.editChanges(doc, planOf(doc), reg, edit({ avoid: ['ground.stubTint'] }));
  assert.equal(r.changes.length, 1);
  deepEqual(CH.toCommands(doc, null, r.changes), []);
});

test('emphasis inside an existing emphasis is skipped; repeats are counted', () => {
  const doc = docOf('[00:01.00][00:09.00]*君の*声\n夜');
  const plan = planOf(doc);
  const r = LK.editChanges(doc, plan, reg, edit({ lines: [editLine(0, { impact: 'on', emphasis: ['君'] })] }));
  deepEqual(r.changes.map((c) => [c.kind, c.repeats]), [['impact', 2]]);
  assert.equal(r.warnings.length, 0);
  const miss = LK.editChanges(doc, plan, reg, edit({ lines: [editLine(1, { emphasis: ['朝'] })] }));
  deepEqual(miss.warnings, [['ai.warn.emphasisNotFound', { n: 2, word: '朝' }]]);
});

test('selected lines only; locked lines keep their look; pins that already hold the value are skipped', () => {
  const doc0 = docOf(PLAIN_SONG);
  const [r1, r2, r3] = doc0.sheet.rows.map((r) => r.id);
  const doc = CMD.reduce(doc0, { t: 'batch', cmds: [
    { t: 'lock.set', lineId: r2, pins: { ['cut/' + r2 + '~0:arrive']: { v: 'stubFade', by: 'lock', sig: '君の名前を呼ぶ' } }, n: 1 },
    { t: 'pin.set', path: 'line/' + r3 + ':arrange', v: 'giantWhisper', by: 'user' },
  ] });
  const plan = planOf(doc);
  const answer = edit({ lines: [editLine(0, { arrive: 'heatRise' }), editLine(1, { arrive: 'heatRise', impact: 'on' }),
    editLine(2, { arrange: 'giantWhisper', arrive: 'heatRise' })] });
  const all = LK.editChanges(doc, plan, reg, answer);
  deepEqual(all.changes.map((c) => [c.kind, c.lineId || c.rowId, c.partKind || null]),
    [['part', r1, 'arrive'], ['part', r3, 'arrive'], ['impact', r2, null]]);
  assert.ok(all.warnings.some((w) => w[0] === 'ai.warn.locked'));
  const sel = LK.editChanges(doc, plan, reg, answer, { lineIds: [r3] });
  deepEqual(sel.changes.map((c) => c.lineId), [r3]);
  assert.equal(sel.warnings.filter((w) => w[0] === 'ai.warn.notSelected').length, 2);
});

// ---- changes → commands --------------------------------------------------------------------------------------------

function makeAll(doc, plan) {
  const lineId = plan.lines[0].id, rowId = plan.lines[0].row;
  const mk = (f) => CH.make(doc, f, { rev: 7 });
  return [
    mk({ id: 'theme', kind: 'theme', scope: 'work', path: 'work:theme', from: 'sumiWashi', to: 'stubInk', label: ['ai.ch.theme', {}] }),
    mk({ id: 'mood', kind: 'mood', scope: 'work', path: 'work:mood', from: 'quietHush', to: 'popFizz', label: ['ai.ch.mood', {}] }),
    mk({ id: 'season', kind: 'season', scope: 'work', path: 'work:season', from: 'any', to: 'summer', label: ['ai.ch.season', {}] }),
    mk({ id: 'amount:glitch', kind: 'amount', key: 'glitch', scope: 'work', path: 'work:amount.glitch', from: 0, to: 0.4, label: ['ai.ch.amount', {}] }),
    mk({ id: 'flash', kind: 'flash', scope: 'work', path: 'work:amount.flash', from: false, to: true, label: ['ai.ch.flash.on', {}] }),
    mk({ id: 'palette', kind: 'palette', scope: 'work', path: 'work:color.accent', from: {}, to: { accent: '#C2413A', shiftA: '#112233', shiftB: '#445566' }, label: ['ai.ch.palette', {}] }),
    mk({ id: 'avoid', kind: 'avoid', scope: 'work', filterKind: 'ornament', partKey: 'snowDust', from: null, to: 'snowDust', label: ['ai.ch.avoid', {}] }),
    mk({ id: 'part', kind: 'part', scope: 'line', lineId, rowId, partKind: 'arrive', path: 'line/' + lineId + ':arrive', from: null, to: 'heatRise', label: ['ai.ch.part', {}] }),
    mk({ id: 'time', kind: 'time', scope: 'line', lineId, rowId, path: 'line/' + lineId + ':start', from: 1, to: 2.5, label: ['ai.ch.time', {}] }),
    mk({ id: 'impact', kind: 'impact', scope: 'rows', rowId, from: false, to: true, label: ['ai.ch.impact.on', {}] }),
    mk({ id: 'emphasis', kind: 'emphasis', scope: 'rows', rowId, from: null, to: [0, 1], label: ['ai.ch.emphasis', {}] }),
    mk({ id: 'songInfo', kind: 'songInfo', scope: 'work', from: null, to: { summary: 's', mood: 'm', bpm: 120, sections: [], highlights: [], duration: 60 }, label: ['ai.ch.songInfo', {}] }),
  ];
}

test('every change kind maps to the commands of §4.22.5 and applies as one batch (one undo step)', () => {
  const doc0 = docOf('朝の光\n夜の街');
  const doc = CMD.reduce(doc0, { t: 'song.set', song: { name: 's.wav', sha1: 'abc', seconds: 60 } });
  const plan = planOf(doc);
  const changes = makeAll(doc, plan);
  assert.ok(changes.every((c) => c.base.rev === 7 && c.checked && !c.stale));
  const rowId = plan.lines[0].row, lineId = plan.lines[0].id;
  const cmds = CH.toCommands(doc, plan, changes);
  deepEqual(cmds, [
    { t: 'pin.set', path: 'work:theme', v: 'stubInk', by: 'ai' },
    { t: 'pin.set', path: 'work:mood', v: 'popFizz', by: 'ai' },
    { t: 'pin.set', path: 'work:season', v: 'summer', by: 'ai' },
    { t: 'pin.set', path: 'work:amount.glitch', v: 0.4, by: 'ai' },
    { t: 'pin.set', path: 'work:amount.flash', v: 0.7, by: 'ai' },
    { t: 'pin.set', path: 'work:color.accent', v: '#C2413A', by: 'ai' },
    { t: 'pin.set', path: 'work:color.shiftA', v: '#112233', by: 'ai' },
    { t: 'pin.set', path: 'work:color.shiftB', v: '#445566', by: 'ai' },
    { t: 'filter.set', kind: 'ornament', only: null, deny: ['snowDust'] },
    { t: 'pin.set', path: 'line/' + lineId + ':arrive', v: 'heatRise', by: 'ai' },
    { t: 'pin.set', path: 'line/' + lineId + ':start', v: 2.5, by: 'ai' },
    { t: 'lyrics.row', rowId, src: '*朝*の光!' },
    { t: 'song.info', info: changes[11].to },
  ]);
  const covered = new Set(changes.map((c) => c.kind).concat(['cut', 'note', 'remove', 'rows', 'allow']));
  deepEqual([...covered].sort(), CH.KINDS.slice().sort(), 'the other kinds are covered in ai_lyrics / ai_song');
  const store = ST.createStore({ doc, reduce: CMD.reduce });
  store.batch({ label: ['undo.ai', { tool: 'edit', n: changes.length }] }, cmds);
  assert.equal(store.list().length, 1);
  assert.equal(store.doc.song.info.bpm, 120);
  assert.equal(store.doc.sheet.rows[0].id, rowId);
  assert.deepEqual(store.doc, CH.apply(doc, plan, changes), 'apply() gives the same document (try-on)');
  store.undo();
  assert.equal(store.doc, doc);
  const none = changes.map((c) => Object.assign({}, c, { checked: false }));
  deepEqual(CH.toCommands(doc, plan, none), []);
  assert.equal(CH.apply(doc, plan, none), doc);
});

test('markStale: targets changed since the request are unchecked; the rest stay as they were', () => {
  const doc = CMD.reduce(docOf('朝の光\n夜の街'), { t: 'song.set', song: { name: 's.wav', sha1: 'abc', seconds: 60 } });
  const plan = planOf(doc);
  const changes = makeAll(doc, plan);
  deepEqual(CH.markStale(doc, plan, changes).map((c) => c.stale), changes.map(() => false));
  const lineId = plan.lines[0].id, rowId = plan.lines[0].row;
  const later = CMD.reduce(doc, { t: 'batch', cmds: [
    { t: 'pin.set', path: 'work:mood', v: 'quietHush', by: 'user' },
    { t: 'pin.set', path: 'line/' + lineId + ':arrive', v: 'stubFade', by: 'user' },
    { t: 'filter.set', kind: 'ornament', only: ['hairFrame'], deny: null },
    { t: 'lyrics.row', rowId, src: '朝の光よ' },
    { t: 'song.set', song: { name: 'other.wav', sha1: 'def', seconds: 70 } },
  ] });
  const marked = CH.markStale(later, plan, changes);
  const stale = marked.filter((c) => c.stale).map((c) => c.id).sort();
  deepEqual(stale, ['avoid', 'emphasis', 'impact', 'mood', 'part', 'songInfo', 'time'].sort());
  assert.ok(marked.filter((c) => c.stale).every((c) => c.checked === false));
  assert.ok(marked.filter((c) => !c.stale).every((c) => c.checked === true));
  const cmds = CH.toCommands(later, plan, marked);
  assert.ok(!cmds.some((c) => c.t === 'lyrics.row' || c.t === 'song.info' || (c.path && c.path.startsWith('line/'))));
  assert.equal(CH.groupOf(changes[0]), 'work');
  deepEqual(marked.map((c) => CH.groupOf(c)), ['work', 'work', 'work', 'work', 'work', 'work', 'work', 'lines', 'time', 'lyrics', 'lyrics', 'work']);
});

test('log entry and selective revert: only where the document still holds the AI value', () => {
  const doc0 = docOf('朝の光\n夜の街');
  const doc = CMD.reduce(doc0, { t: 'pin.set', path: 'work:mood', v: 'quietHush', by: 'user' });
  const plan = planOf(doc);
  const changes = makeAll(doc, plan).filter((c) => c.kind !== 'songInfo');
  const cmds = CH.toCommands(doc, plan, changes);
  const store = ST.createStore({ doc, reduce: CMD.reduce });
  store.batch({ label: ['undo.ai', { tool: 'edit', n: changes.length }] }, cmds);
  const entry = CH.logEntry(doc, cmds, { runId: 'r1', tool: 'edit', n: changes.length });
  assert.equal(entry.applied.length, cmds.length);
  deepEqual(entry.applied.find((a) => a.path === 'work:mood'), { path: 'work:mood', to: 'popFizz', prev: { v: 'quietHush', by: 'user' } });
  // the user changes two of the AI's values afterwards
  store.dispatch({ t: 'pin.set', path: 'work:theme', v: 'sumiWashi', by: 'user' });
  store.dispatch({ t: 'pin.set', path: 'work:amount.glitch', v: 0.9, by: 'user' });
  const { cmds: back, kept } = CH.revertCommands(store.doc, entry);
  assert.equal(kept, 2);
  store.batch({ label: ['undo.ai', { tool: 'edit', n: back.length }] }, back);
  const d = store.doc;
  deepEqual(d.pins['work:mood'], { v: 'quietHush', by: 'user' }, 'the pin the AI replaced comes back');
  assert.equal(d.pins['work:theme'].v, 'sumiWashi');
  assert.equal(d.pins['work:amount.glitch'].v, 0.9);
  for (const path of ['work:season', 'work:amount.flash', 'work:color.accent', 'line/' + plan.lines[0].id + ':arrive',
    'line/' + plan.lines[0].id + ':start']) assert.equal(d.pins[path], undefined, path);
  assert.equal(d.filters.ornament, undefined);
  assert.equal(d.sheet.rows[0].src, '朝の光');
  deepEqual(d.sheet.rows.map((r) => r.id), doc.sheet.rows.map((r) => r.id));
});

test('describe: review rows read with names, seasons and times', () => {
  const STRINGS = Object.assign({}, MV.use('i18n/strings'), {
    'ai.ch.part': ['{n}行 · {kind}: {from} → {to}', 'Line {n} · {kind}: {from} → {to}'],
    'ai.ch.auto': ['自動（{v}）', 'Auto ({v})'],
    'ai.ch.season': ['季節: {from} → {to}', 'Season: {from} → {to}'],
    'ai.ch.time.lrc': ['{n}行 · 開始: {from} → {to}（LRCの時刻より優先されます）', 'Line {n} · start: {from} → {to} (overrides the LRC time)'],
    'ai.ch.amount': ['{what}: {from} → {to}', '{what}: {from} → {to}'],
  });
  const t = T.createT('ja', STRINGS, reg, { strict: true });
  const part = { kind: 'part', partKind: 'arrive', fromSource: 'auto', label: ['ai.ch.part', { n: 12, kind: 'arrive', from: 'stubFade', to: 'heatRise' }] };
  assert.equal(CH.describe(part, t), '12行 · 入り: 自動（ふわっと） → 陽炎');
  const pinned = Object.assign({}, part, { fromSource: 'pin:line' });
  assert.equal(CH.describe(pinned, T.createT('en', STRINGS, reg)), 'Line 12 · Entrance: Stub fade → Heat rise');
  assert.equal(CH.describe({ kind: 'season', label: ['ai.ch.season', { from: 'any', to: 'summer' }] }, t), '季節: すべての季節 → 夏');
  assert.equal(CH.describe({ kind: 'time', label: ['ai.ch.time.lrc', { n: 3, from: 12.5, to: 14 }] }, t),
    '3行 · 開始: 0:12.50 → 0:14.00（LRCの時刻より優先されます）');
  assert.equal(CH.describe({ kind: 'amount', label: ['ai.ch.amount', { what: 'motion', from: 0.3, to: 0.95 }] }, t), '動き: 0.3 → 0.95');
  const tw = T.createT('en', Object.assign({}, STRINGS, { 'ai.warn.lineOffSeason': ['{n}行 · {kind}「{key}」', 'Line {n}: {kind} "{key}" is off-season'] }), reg);
  assert.equal(CH.warningText(['ai.warn.lineOffSeason', { n: 2, kind: 'arrive', key: 'snowFall' }], tw), 'Line 2: Entrance "Snow fall" is off-season');
});

// ---- validation against the effective season, pins, filters and the request's numbering ----------------------------

const WINTER = '冬の朝に\n雪が降る\n白い息を吐いて\n君を待つ';
const SPRING = '春の風に\n桜が舞う\n花びらの道\n君と歩く';
const warnCodes = (ws) => ws.map((w) => w[0]);
const offSeasonWarnings = (d) => (MV.has('planner/plan') ? planOf(d).warnings.filter((w) => w.code === 'pin-off-season') : []);

test('"any" keeps the automatic season: picks of other seasons are dropped against it', () => {
  const doc = docOf(WINTER);
  const plan = planOf(doc);
  deepEqual([plan.look.season.v, plan.look.season.from], ['winter', 'auto']);
  const pc = LK.proposalChanges(doc, plan, reg, { topic: '', season: 'any', proposals: [proposal({ theme: 'sakuraFog',
    lines: [{ i: 0, arrange: '', arrive: 'heatRise', depart: '', dwell: '' }, { i: 1, arrange: '', arrive: 'snowFall', depart: '', dwell: '' }] })] });
  const p = pc.proposals[0];
  assert.ok(!p.changes.some((c) => c.kind === 'season' || c.kind === 'theme'));
  deepEqual(p.changes.filter((c) => c.kind === 'part').map((c) => [c.lineId, c.to]), [[plan.lines[1].id, 'snowFall']]);
  deepEqual(p.warnings, [['ai.warn.offSeason', { kind: 'theme', key: 'sakuraFog' }],
    ['ai.warn.lineOffSeason', { n: 1, kind: 'arrive', key: 'heatRise' }]]);
  deepEqual(offSeasonWarnings(CH.apply(doc, plan, p.changes)), [], 'nothing applied is off-season');
  // an edit that keeps the season ("") is gated the same way
  const ec = LK.editChanges(doc, plan, reg, edit({ theme: 'cicadaNoon', lines: [editLine(2, { arrive: 'heatRise' })] }));
  deepEqual(ec.changes, []);
  deepEqual(warnCodes(ec.warnings), ['ai.warn.offSeason', 'ai.warn.lineOffSeason']);
});

test('"any" over a season pin clears it and gates picks with the season the lyrics give back', () => {
  const doc = CMD.reduce(docOf(SPRING), { t: 'pin.set', path: 'work:season', v: 'summer', by: 'user' });
  const plan = planOf(doc);
  assert.equal(plan.look.season.v, 'summer');
  const pc = LK.proposalChanges(doc, plan, reg, { topic: '', season: 'any', proposals: [
    proposal({ theme: 'cicadaNoon', lines: [{ i: 0, arrange: '', arrive: 'heatRise', depart: '', dwell: '' }] }),
    proposal({ theme: 'sakuraFog' }),
  ] });
  const [a, b] = pc.proposals;
  const season = a.changes.find((c) => c.kind === 'season');
  deepEqual([season.to, season.toSource, season.label], ['any', 'auto', ['ai.ch.season', { from: 'summer', to: 'spring' }]]);
  deepEqual(CH.toCommands(doc, plan, [season]), [{ t: 'pin.clear', path: 'work:season' }]);
  assert.ok(!a.changes.some((c) => c.kind === 'theme' || c.kind === 'part'), 'summer picks are off-season for spring lyrics');
  deepEqual(warnCodes(a.warnings), ['ai.warn.offSeason', 'ai.warn.lineOffSeason']);
  assert.equal(b.theme, 'sakuraFog');
  const after = CH.apply(doc, plan, b.changes);
  assert.equal(after.pins['work:season'], undefined);
  assert.equal(planOf(after).look.season.v, 'spring');
  deepEqual(offSeasonWarnings(after), []);
  const STRINGS = Object.assign({}, MV.use('i18n/strings'), {
    'ai.ch.auto': ['自動（{v}）', 'Auto ({v})'], 'ai.ch.season': ['季節: {from} → {to}', 'Season: {from} → {to}'] });
  assert.equal(CH.describe(season, T.createT('ja', STRINGS, reg)), '季節: 夏 → 自動（春）');
});

// Pins `slot` to `v` on the given cuts (sig = the cut's text in the plan).
function cutPins(doc, plan, slot, v, by, cutKeys) {
  return CMD.reduce(doc, { t: 'batch', cmds: cutKeys.map((key) => ({ t: 'pin.set', path: 'cut/' + key + ':' + slot, v, by,
    sig: plan.cuts.find((c) => c.key === key).text })) });
}

test('a cut pin hides a line pick: dropped with a warning, listed in the prompt; a line with a free cut still changes', () => {
  const doc0 = docOf('夜明けの色を/覚えてる\n本気で好きだった\n君の声');
  const plan0 = planOf(doc0);
  const [l0, l1] = plan0.lines;
  assert.equal(l0.cuts.length, 2, 'the / mark gives two cuts');
  const doc = cutPins(cutPins(doc0, plan0, 'arrive', 'stubFade', 'user', l1.cuts), plan0, 'arrive', 'snowFall', 'user', [l0.cuts[0]]);
  const plan = planOf(doc);
  const q = LK.editRequest(doc, plan, reg, 'x', 'ja');
  assert.ok(q.prompt.includes('Lines with a manual setting: 0:arrive(1 of 2 cuts)=snowFall 1:arrive(cuts)=stubFade'));
  const ec = LK.editChanges(doc, plan, reg, edit({ lines: [editLine(0, { arrive: 'heatRise' }), editLine(1, { arrive: 'heatRise' })] }));
  deepEqual(ec.warnings, [['ai.warn.pinned', { n: 2, kind: 'arrive' }]]);
  deepEqual(ec.changes.map((c) => [c.kind, c.lineId, c.to]), [['part', l0.id, 'heatRise']]);
  const free = plan.cuts.find((c) => c.key === l0.cuts[1]).slots.arrive;
  deepEqual([ec.changes[0].from, ec.changes[0].fromSource], [free.v, free.from], 'from = what the reachable cut shows');
  if (MV.has('planner/plan')) {
    const p2 = planOf(CH.apply(doc, plan, ec.changes));
    deepEqual(p2.cuts.filter((c) => c.line === l0.id).map((c) => c.slots.arrive.v), ['snowFall', 'heatRise']);
  }
  // cut pins by lock on every cut read as a locked look
  const locked = cutPins(doc0, plan0, 'arrive', 'stubFade', 'lock', l1.cuts);
  const lk = LK.editChanges(locked, planOf(locked), reg, edit({ lines: [editLine(1, { arrive: 'heatRise' })] }));
  deepEqual([lk.changes, lk.warnings], [[], [['ai.warn.locked', { n: 2 }]]]);
});

test('a theme the user turned off is neither offered nor pinned, unless the same answer allows it again', () => {
  const doc = docOf(PLAIN_SONG, () => [{ t: 'filter.set', kind: 'theme', only: null, deny: ['stubInk'] }]);
  const plan = planOf(doc);
  const q = LK.proposalsRequest(doc, plan, reg, 'ja');
  assert.ok(!/(^|\n)stubInk=/.test(q.prompt), 'not in the theme list');
  assert.ok(/(^|\n)sumiWashi=/.test(q.prompt));
  assert.ok(LK.editRequest(doc, plan, reg, 'x', 'ja').prompt.includes('Parts turned off: theme.stubInk'));
  const pc = LK.proposalChanges(doc, plan, reg, { topic: '', season: 'any', proposals: [proposal({ theme: 'stubInk' })] });
  assert.equal(pc.proposals[0].theme, null);
  deepEqual(pc.proposals[0].warnings, [['ai.warn.turnedOff', { kind: 'theme', key: 'stubInk' }]]);
  const ec = LK.editChanges(doc, plan, reg, edit({ theme: 'stubInk', allow: ['theme.stubInk'] }));
  deepEqual(ec.changes.map((c) => [c.kind, c.to]), [['theme', 'stubInk'], ['allow', 'stubInk']]);
  deepEqual(CH.toCommands(doc, plan, ec.changes), [
    { t: 'pin.set', path: 'work:theme', v: 'stubInk', by: 'ai' },
    { t: 'filter.set', kind: 'theme', only: null, deny: null },
  ]);
});

test('answers map through the request\'s line ids: edits made while it ran never move a change to another line', () => {
  const docA = docOf(PLAIN_SONG);
  const planA = planOf(docA);
  const q = LK.editRequest(docA, planA, reg, 'x', 'ja');
  deepEqual(q.lines.map((l) => [l.i, l.lineId, l.text]), planA.lines.map((l, i) => [i, l.id, l.text]));
  const pq = LK.proposalsRequest(docA, planA, reg, 'ja');
  deepEqual(pq.lines, q.lines);
  // while the request runs, the user types a new first row and rewords the second line
  const docB = CMD.reduce(docA, { t: 'lyrics.set', text: '新しい一行\n' + PLAIN_SONG.replace('君の名前を呼ぶ', '君の名前を叫ぶ') });
  const planB = planOf(docB);
  assert.equal(planB.lines[1].id, planA.lines[0].id, 'the first line moved down');
  const answer = edit({ lines: [editLine(0, { arrive: 'heatRise' }), editLine(1, { impact: 'on' })] });
  // validated as recommended: against what was sent, then marked against the current document
  const sent = LK.editChanges(docA, planA, reg, answer, { rev: 3, lines: q.lines });
  deepEqual(sent.changes.map((c) => [c.kind, c.lineId || c.rowId]), [['part', planA.lines[0].id], ['impact', planA.lines[1].row]]);
  const marked = CH.markStale(docB, planB, sent.changes);
  deepEqual(marked.map((c) => [c.kind, c.stale, c.checked]), [['part', false, true], ['impact', true, false]]);
  const applied = CH.apply(docB, planB, marked);
  assert.equal(applied.pins['line/' + planA.lines[0].id + ':arrive'].v, 'heatRise');
  assert.equal(applied.pins['line/' + planB.lines[0].id + ':arrive'], undefined, 'the new row gets nothing');
  assert.equal(applied.sheet, docB.sheet, 'the reworded line keeps its words');
  // validated against the current document by mistake: the ids still hold, the reworded line is skipped
  const late = LK.editChanges(docB, planB, reg, answer, { lines: q.lines });
  deepEqual(late.changes.map((c) => [c.kind, c.lineId]), [['part', planA.lines[0].id]]);
  deepEqual(late.warnings, [['ai.warn.changedSince', { n: 2 }]]);
  const pcLate = LK.proposalChanges(docB, planB, reg, { topic: '', season: 'any', proposals: [proposal({
    lines: [{ i: 0, arrange: '', arrive: 'heatRise', depart: '', dwell: '' }] })] }, { lines: pq.lines });
  deepEqual(pcLate.proposals[0].changes.filter((c) => c.kind === 'part').map((c) => c.lineId), [planA.lines[0].id]);
});

test('building the commands stays linear in the number of rows and changes', () => {
  const N = 300;
  const doc = docOf(Array.from({ length: N }, (_, i) => '花火の夜に約束した' + i).join('\n'));
  const plan = planOf(doc);
  const lines = plan.lines.map((l, i) => editLine(i, { impact: 'on', emphasis: ['花火', '約束'] }));
  const ec = LK.editChanges(doc, plan, reg, edit({ lines }));
  assert.equal(ec.changes.length, 3 * N);
  // count how often the changes' rowId is read: a per-row scan of every change would read it N × 3N times
  let reads = 0;
  const counted = ec.changes.map((c) => {
    const o = Object.assign({}, c);
    delete o.rowId;
    Object.defineProperty(o, 'rowId', { enumerable: true, get: () => { reads++; return c.rowId; } });
    return o;
  });
  const cmds = CH.toCommands(doc, plan, counted);
  assert.equal(cmds.length, N);
  assert.ok(reads <= 4 * counted.length, reads + ' reads for ' + counted.length + ' changes');
  // markStale and making changes look rows up by id, not by searching the sheet once per change
  let finds = 0;
  const rows = doc.sheet.rows.slice();
  rows.find = function (...args) { finds++; return Array.prototype.find.apply(this, args); };
  const spied = Object.assign({}, doc, { sheet: Object.assign({}, doc.sheet, { rows }) });
  CH.markStale(spied, plan, ec.changes);
  LK.editChanges(spied, plan, reg, edit({ lines }));
  CH.logEntry(spied, cmds, { runId: 'r', tool: 'edit' });
  CH.revertCommands(spied, CH.logEntry(doc, cmds, { runId: 'r', tool: 'edit' }));
  assert.equal(finds, 0);
});
