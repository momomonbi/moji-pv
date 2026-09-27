/* 文字PVメーカー v2 — original work. Tests: カメラ EXTREME in the editor (DESIGN_EXTREME §2.6, §3.5, §3.6) — the switch's flow (notice, turn-off question, one undo step), the inspector rows, the keyframe editor on EXTREME shots, the preview preference and step ④'s check. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

const MV = load();
const XU = MV.use('ui/extreme');
const XT = MV.use('planner/extreme');
const F = MV.use('ui/fields');
const KE = MV.use('ui/shot_editor');
const V = MV.use('ui/view');
const SHOT = MV.use('core/shot');
const SCH = MV.use('export/schedule');
const CMD = MV.use('core/commands');
const ST = MV.use('core/store');
const D = MV.use('core/doc');
const T = MV.use('i18n/t');
const STRINGS = MV.use('i18n/strings');
const REG = MV.use('parts/catalog').defaultRegistry();
const PL = MV.use('planner/plan');

const BASIC = corpus.project('basic').doc;
const planOf = (doc) => PL.plan(doc, { registry: REG });

// The app as ui/extreme sees it: a store with core/commands, the view's preferences, and dialogs that answer from a queue
// (never built: no DOM here). asked: the titles of the dialogs opened.
function fakeApp(doc, answers, prefs) {
  const store = ST.createStore({ doc, side: D.defaultSide(), reduce: CMD.reduce });
  const view = V.createView({});
  for (const [k, v] of Object.entries(prefs || {})) view.setPref(k, v);
  const asked = [];
  const app = {
    t: T.createT('ja', STRINGS, REG, { strict: true }), store, view, asked,
    get doc() { return store.doc; },
    get plan() { return planOf(store.doc); },
    dispatch: (cmd, meta) => store.batch(meta, [cmd]),
    batch: (meta, cmds) => store.batch(meta, cmds),
    dialogs: { open: (build, o) => { asked.push(o.title); return Promise.resolve(answers.shift()); } },
  };
  return app;
}

const META = { label: ['undo.xOn', { scope: '作品全体' }] };

test('the switch turns on after the notice, at a strength, as one undo step; 次から表示しない is remembered only after OK', async () => {
  const app = fakeApp(BASIC, [false, true]);
  assert.equal(await XU.setSwitch(app, { scopes: ['work'], v: 1, meta: META }), false, 'やめる: nothing changes');
  assert.deepEqual(app.asked, [app.t('x.notice.title')]);
  assert.equal(app.doc.pins['work:cam.extreme'], undefined);
  const n0 = app.store.list().length;
  assert.equal(await XU.setSwitch(app, { scopes: ['work'], v: 1, meta: META }), true);
  assert.deepEqual(app.doc.pins['work:cam.extreme'], { v: 1, by: 'user' });
  assert.equal(app.store.list().length, n0 + 1, 'one undo entry');
  assert.deepEqual(app.store.peek().undo, META.label);
  // a strength while it is on: no notice
  assert.equal(await XU.setSwitch(app, { scopes: ['work'], v: 0.5, meta: META }), true);
  assert.equal(app.asked.length, 2);
  assert.equal(app.doc.pins['work:cam.extreme'].v, 0.5);
  assert.equal(XU.valueOf(app.doc, 'work'), 0.5);
  assert.equal(XU.valueOf(app.doc, 'line/r4'), 0.5, 'a line follows the whole video');
  // turned off with no moves picked by hand: no question, the pin is cleared
  assert.equal(await XU.setSwitch(app, { scopes: ['work'], v: 0, meta: META }), true);
  assert.equal(app.doc.pins['work:cam.extreme'], undefined);
  assert.equal(app.asked.length, 2);
  // hintExtreme off: no notice at all
  const quiet = fakeApp(BASIC, [], { hintExtreme: false });
  assert.equal(await XU.setSwitch(quiet, { scopes: ['line/r4', 'line/r5'], v: 1, meta: META }), true);
  assert.deepEqual(quiet.asked, []);
  assert.deepEqual([quiet.doc.pins['line/r4:cam.extreme'].v, quiet.doc.pins['line/r5:cam.extreme'].v], [1, 1]);
  assert.equal(quiet.store.list().length, 1, 'two lines, one undo entry');
  assert.equal(XU.scopesValue(quiet.doc, ['line/r4', 'line/r5']), 1);
  assert.equal(XU.scopesValue(quiet.doc, ['line/r4', 'line/r6']), null, 'the lines differ');
});

test('turning it off asks about the moves picked by hand or by the AI (元に戻す removes them, 残す keeps them; lock pins stay)', async () => {
  const pins = { 'work:cam.extreme': { v: 1, by: 'user' }, 'cut/r4~0:cam.shot': { v: 'crashZoom', by: 'user', sig: '始発のホームに' },
    'line/r5:cam.shot': { v: 'whipPan~m', by: 'ai' }, 'cut/r6~0:cam.shot': { v: 'spinIn', by: 'lock', sig: 'ポケットの切符を' },
    'line/r7:cam.shot': { v: 'pushWord', by: 'user' } };
  const doc = Object.assign({}, BASIC, { pins: Object.assign({}, BASIC.pins, pins) });
  const cancel = fakeApp(doc, [undefined]);
  assert.equal(await XU.setSwitch(cancel, { scopes: ['work'], v: 0, meta: META }), false, 'the question closed: nothing changes');
  assert.deepEqual(cancel.asked, [cancel.t('x.off.title')]);
  assert.equal(cancel.doc, doc);
  const keep = fakeApp(doc, ['keep']);
  assert.equal(await XU.setSwitch(keep, { scopes: ['work'], v: 0, meta: META }), true);
  assert.equal(keep.doc.pins['work:cam.extreme'], undefined);
  assert.equal(keep.doc.pins['cut/r4~0:cam.shot'].v, 'crashZoom', '残す keeps them');
  const remove = fakeApp(doc, ['remove']);
  assert.equal(await XU.setSwitch(remove, { scopes: ['work'], v: 0, meta: META }), true);
  assert.equal(remove.store.list().length, 1, 'one undo entry');
  const left = Object.keys(remove.doc.pins).filter((p) => p.endsWith(':cam.shot') || p.endsWith(':cam.extreme')).sort();
  assert.deepEqual(left, ['cut/r6~0:cam.shot', 'line/r7:cam.shot'], '元に戻す: the lock and the normal shot stay');
  remove.store.undo();
  assert.deepEqual(remove.doc, doc);
  // off at a line under the whole video's switch: the line is exempted (pin 0)
  const line = fakeApp(Object.assign({}, doc, { pins: { 'work:cam.extreme': { v: 1, by: 'user' } } }), []);
  assert.equal(await XU.setSwitch(line, { scopes: ['line/r4'], v: 0, meta: META }), true);
  assert.deepEqual(line.doc.pins['line/r4:cam.extreme'], { v: 0, by: 'user' });
  assert.equal(XU.valueOf(line.doc, 'line/r4'), 0);
});

test('an EXTREME preset picked by hand where the switch is off asks the notice first (この動きを使う); normal presets never', async () => {
  const app = fakeApp(BASIC, [false, true]);
  assert.equal(await XU.pickShot(app, ['cut/r4~0:cam.shot'], 'pushWord'), true);
  assert.equal(app.asked.length, 0);
  assert.equal(await XU.pickShot(app, ['cut/r4~0:cam.shot'], 'crashZoom'), false);
  assert.equal(await XU.pickShot(app, ['cut/r4~0:cam.shot'], 'whipPan~m'), true);
  assert.equal(app.asked.length, 2);
  const on = fakeApp(Object.assign({}, BASIC, { pins: { 'line/r4:cam.extreme': { v: 1, by: 'user' } } }), []);
  assert.equal(await XU.pickShot(on, ['cut/r4~0:cam.shot'], 'spinIn'), true, 'the cut\'s line has it on');
  assert.equal(on.asked.length, 0);
  assert.equal(XU.scopeOfPath('cut/r4~0:cam.shot', planOf(BASIC)), 'line/r4');
  assert.equal(XU.scopeOfPath('cut/title:cam.shot', planOf(BASIC)), 'work', 'a special cut stands for the whole video');
});

test('areaValue: the whole video, an area (every line on), a cut (its line)', () => {
  const plan = planOf(BASIC);
  const ids = plan.lines.slice(0, 2).map((l) => l.id);
  const doc = Object.assign({}, BASIC, { pins: { ['line/' + ids[0] + ':cam.extreme']: { v: 1, by: 'user' } } });
  assert.equal(XU.areaValue(doc, plan, { kind: 'work' }), 0);
  assert.equal(XU.areaValue(doc, plan, { kind: 'lines', ids }), 0, 'one line off');
  assert.equal(XU.areaValue(doc, plan, { kind: 'lines', ids: [ids[0]] }), 1);
  assert.equal(XU.areaValue(doc, plan, { kind: 'cut', key: plan.lines[0].cuts[0] }), 1);
  const work = Object.assign({}, BASIC, { pins: { 'work:cam.extreme': { v: 0.75, by: 'user' } } });
  assert.equal(XU.areaValue(work, plan, { kind: 'work' }), 0.75);
  assert.equal(XU.areaValue(work, plan, { kind: 'lines', ids }), 0.75);
  assert.equal(XU.areaValue(work, plan, null), 0);
});

test('the inspector rows: 作品全体 › 強さ, 要素 › カメラ (the cut page writes its line), the area page (every selected line)', () => {
  const plan = planOf(BASIC);
  const line = plan.lines[0];
  const rows = (sel) => F.sectionsFor(sel, plan, REG, BASIC).flatMap((s) => s.fields.map((f) => Object.assign({ sec: s.id }, f)))
    .filter((f) => f.widget === 'extreme');
  const work = rows({ level: 'work' });
  assert.deepEqual(work.map((f) => [f.sec, f.xpart, f.basic]), [['energy', 'switch', true], ['energy', 'power', false]]);
  assert.deepEqual(work[1].options.map((o) => [o.v, o.label]), [[0.5, 'opt.extreme.strong'], [0.75, 'opt.extreme.very'], [1, 'opt.extreme.max']]);
  const ctxOf = (sel) => F.contextOf(sel, plan, REG, BASIC);
  assert.deepEqual(F.pathsFor(work[0], ctxOf({ level: 'work' })), ['work:cam.extreme']);
  const cutSel = { level: 'el', scope: 'cut/' + line.cuts[0], el: 'lens' };
  const cut = rows(cutSel);
  assert.deepEqual(cut.map((f) => [f.sec, f.label, !!f.lineOf]), [['camwork', 'fld.camExtremeLine', true], ['camwork', 'fld.camExtremePower', true]]);
  assert.deepEqual(F.pathsFor(cut[0], ctxOf(cutSel)), ['line/' + line.id + ':cam.extreme'], 'この行');
  assert.deepEqual(F.clearPathsFor(cut[0], ctxOf(cutSel)), ['line/' + line.id + ':cam.extreme']);
  const lineSel = { level: 'el', scope: 'line/' + line.id, el: 'lens' };
  assert.deepEqual(F.pathsFor(rows(lineSel)[0], ctxOf(lineSel)), ['line/' + line.id + ':cam.extreme']);
  const special = plan.cuts.find((c) => !c.line);
  if (special) assert.deepEqual(rows({ level: 'el', scope: 'cut/' + special.key, el: 'lens' }), [], 'a cut without a line has no switch');
  const area = { level: 'line', ids: plan.lines.slice(0, 3).map((l) => l.id), area: { kind: 'lines', ids: plan.lines.slice(0, 3).map((l) => l.id) } };
  const ar = rows(area);
  assert.deepEqual(ar.map((f) => f.sec), ['rig', 'rig']);
  assert.deepEqual(F.pathsFor(ar[0], ctxOf(area)), area.ids.map((id) => 'line/' + id + ':cam.extreme'));
  assert.ok(F.WIDGETS.includes('extreme'));
  assert.ok(MV.use('ui/widgets').names().includes('extreme'));
});

test('the keyframe editor on EXTREME shots: its keys (mirrored), its limits, 衝撃 / 背景の寄り, 左右反転, the accent anchors', () => {
  const st = KE.shotKeys('spinIn~m');
  assert.equal(st.x, true);
  assert.deepEqual(st.keys, SHOT.presetOf('spinIn~m').keys, 'a mirrored preset: its keys mirrored');
  assert.equal(st.keys[0].roll, 180);
  assert.equal(KE.limitsOf(st), SHOT.XLIMITS);
  assert.equal(KE.limitsOf(KE.shotKeys('pushWord')), SHOT.LIMITS);
  assert.equal(KE.shotKeys('pushWord').x, undefined, 'a normal preset is read as before');
  const beat = KE.shotKeys('dutchSwing');
  assert.deepEqual(beat.beat, SHOT.XSHOTS.dutchSwing.beat);
  assert.equal(beat.blur, SHOT.XSHOTS.dutchSwing.blur);
  // every edit keeps an x-shot, its beat and blur, within XLIMITS (a roll of 300° stays; LIMITS would clamp it to 15°)
  const e = KE.editKey(beat, 0, { roll: 300, hit: 0.6, gz: 1.2 });
  assert.equal(e.x, 1);
  assert.deepEqual(e.beat, SHOT.XSHOTS.dutchSwing.beat);
  assert.equal(e.blur, SHOT.XSHOTS.dutchSwing.blur);
  assert.deepEqual([e.keys[0].roll, e.keys[0].hit, e.keys[0].gz], [300, 0.6, 1.2]);
  assert.equal(KE.editKey(KE.shotKeys('pushWord'), 0, { roll: 300 }).keys[0].roll, 15, 'a normal shot keeps its limits');
  assert.equal(KE.addKey(beat).x, 1);
  assert.equal(KE.removeKey(KE.shotKeys('crashZoom'), 1).x, 1);
  // 左右反転
  const m = KE.mirrorShot(KE.shotKeys('whipPan'));
  assert.deepEqual(m.keys.map((k) => k.ox || 0), SHOT.presetOf('whipPan~m').keys.map((k) => k.ox || 0));
  assert.deepEqual(KE.shotKeys(KE.mirrorShot(KE.shotKeys(m))).keys, KE.shotKeys(KE.toShot(SHOT.XSHOTS.whipPan.keys, 0, { x: true, blur: 1 })).keys,
    'twice is the preset again');
  // limits of sizes and marker drops; the EXTREME anchors
  assert.deepEqual(KE.sizeOf({ aim: 'block' }, SHOT.XLIMITS).range, [0.1, 0.95]);
  assert.deepEqual(KE.offsetOfPoint({ x: 1920, y: 540 }, { w: 1920, h: 1080 }, SHOT.XLIMITS), { ox: 0.5, oy: 0 });
  assert.deepEqual(KE.offsetOfPoint({ x: 1920, y: 540 }, { w: 1920, h: 1080 }), { ox: 0.4, oy: 0 }, 'the normal clamp');
  assert.deepEqual(KE.whenOf({ at: 'accentEnd' }), { choice: 'accentEnd', n: null });
  assert.ok(KE.X_WHEN.includes('accent') && !KE.WHEN.includes('accent'));
  for (const c of KE.X_WHEN) if (!['word', 'beat', 'frac'].includes(c)) assert.ok(('at.' + c) in STRINGS, 'at.' + c);
});

test('激しいカメラを抑える: a preview preference, on at first run where the device asks for reduced motion; the notice\'s own', () => {
  assert.equal(V.DEFAULT_PREFS.calmCamera, false);
  assert.equal(V.DEFAULT_PREFS.hintExtreme, true);
  assert.equal(V.createView({ defaults: { calmCamera: true } }).state.prefs.calmCamera, true);
  const stored = { getItem: () => JSON.stringify({ calmCamera: false }), setItem() {} };
  assert.equal(V.createView({ storage: stored, defaults: { calmCamera: true } }).state.prefs.calmCamera, false, 'a stored choice wins');
  assert.equal(V.readPrefs(null, 'k', { calmCamera: 'yes' }).calmCamera, false, 'a wrong type is ignored');
  for (const k of ['pref.calmCamera', 'cmd.pref.calmCamera']) assert.ok(k in STRINGS, k);
});

test('step ④: EXTREME cuts are an info item; the jumps of EXTREME shots count with the flashes', () => {
  const doc = Object.assign({}, BASIC, { pins: { 'work:cam.extreme': { v: 1, by: 'user' } } });
  const plan = planOf(doc);
  const x = SCH.extremeCuts(plan, 0, plan.duration);
  assert.ok(x.length > 0 && x.every((c) => SHOT.isExtreme(c.slots['cam.shot'].v)));
  const READY = { webcodecs: true, codec: 'avc1.640028', audioCodec: 'mp4a.40.2', fontsReady: true, fsAccess: true };
  const item = SCH.preflight(doc, plan, READY).find((c) => c.code === 'extreme-motion');
  assert.deepEqual([item.level, item.params.n], ['info', x.length]);
  assert.equal(item.jump.t, x[0].t0);
  assert.equal(SCH.preflight(BASIC, planOf(BASIC), READY).some((c) => c.code === 'extreme-motion'), false, 'none without EXTREME');
  // four jumps inside one second are a flash-rate warning, with the same fix
  const base = SCH.flashRate(plan).count;
  const at = 5;
  const jumps = [at, at + 0.2, at + 0.45, at + 0.7];
  assert.equal(SCH.flashRate(plan, jumps).count >= Math.max(base, 4), true);
  const warned = SCH.preflight(doc, plan, Object.assign({}, READY, { jumps })).find((c) => c.code === 'flash-rate');
  assert.ok(warned && warned.fix.path === 'work:amount.flash');
  assert.deepEqual(SCH.flashEvents(plan, [NaN, 'x']), SCH.flashEvents(plan), 'only numbers count');
  const en = T.createT('en', STRINGS, REG, { strict: true });
  assert.equal(en('exp.pre.extreme-motion', { n: 1 }).startsWith('Intense camerawork (EXTREME) in 1 cut.'), true);
  assert.equal(en('exp.pre.extreme-motion', { n: 3 }).startsWith('Intense camerawork (EXTREME) in 3 cuts.'), true);
});
