/* 文字PVメーカー v2 — original work. Cinematic effects retain exact scope, timeline anchoring and undo. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load');
const corpus = require('../helpers/corpus');
const MV = load(), CIN = MV.use('ui/cinematic'), F = MV.use('ui/fields'), NAV = MV.use('ui/inspector_nav');
const C = MV.use('core/commands'), D = MV.use('core/doc'), PL = MV.use('planner/plan');
const PF = MV.use('planner/fields'), A = MV.use('planner/areas');
const reg = MV.use('parts/catalog').defaultRegistry();
const fixture = () => {
  const doc = MV.use('core/migrate').parseFile(corpus.projectText('v21')).doc;
  const plan = PL.plan(doc, { registry: reg });
  return { doc, plan };
};
const apply = (doc, plan, sel, key = 'singularityBurst') => CIN.applyCommands(doc, plan, reg, sel, key, PF.pinSig);

test('cinematic presets apply to the work in a single reversible edit with an absolute song clock', () => {
  const { doc, plan } = fixture(), cmds = apply(doc, plan, { level: 'work' });
  const store = MV.use('core/store').createStore({ doc, reduce: C.reduce });
  store.batch({ label: ['cinematic.undoApply', { name: 'Singularity' }] }, cmds);
  assert.deepEqual(D.validate(store.doc), []);
  assert.equal(store.doc.pins['work:atmos'].v, 'singularityBurst');
  assert.equal(store.doc.pins['work:atmos@singularityBurst.clock'].v, 'song');
  assert.equal(store.doc.pins['work:atmos@singularityBurst.start'].v, 0);
  assert.equal(store.doc.pins['work:atmos@singularityBurst.duration'].v, plan.duration);
  assert.ok(Object.keys(store.doc.pins).filter((p) => !Object.hasOwn(doc.pins, p)).every((p) => p.startsWith('work:atmos')));
  store.undo(); assert.deepEqual(store.doc, doc);
  store.redo(); assert.equal(store.doc.pins['work:atmos'].v, 'singularityBurst');
});

test('line and exact cut selections keep their own times and scopes, including a sole cut', () => {
  const doc = C.reduce(D.defaultDoc(), { t: 'lyrics.set', text: '[00:05.00]one line\n[00:10.00]another line' });
  const plan = PL.plan(doc, { registry: reg }), line = plan.lines.find((l) => l.cuts.length === 1);
  assert.ok(line);
  for (const sel of [{ level: 'line', ids: [line.id] }, { level: 'cut', key: line.cuts[0] }]) {
    const info = CIN.selectionInfo(doc, plan, reg, sel), cmds = apply(doc, plan, sel, 'windMeadow');
    const scope = sel.level === 'cut' ? 'cut/' + sel.key : 'line/' + line.id;
    assert.deepEqual(info.scopes, [scope]);
    assert.ok(cmds.every((cmd) => cmd.path.startsWith(scope + ':')));
    const changed = C.reduce(doc, { t: 'batch', cmds });
    assert.equal(changed.pins[scope + ':atmos@windMeadow.start'].v, info.t0);
    assert.equal(changed.pins[scope + ':atmos@windMeadow.duration'].v, Number((info.t1 - info.t0).toFixed(6)));
    if (sel.level === 'cut') {
      assert.equal(changed.pins[scope + ':atmos'].sig, PF.pinSig(plan, sel.key));
      const next = PL.plan(changed, { registry: reg }), ctx = F.contextOf(sel, next, reg, changed);
      const section = F.sectionsFor(sel, next, reg, changed).find((s) => s.id === 'cinematic');
      const row = section.fields.find((f) => f.path === 'atmos@windMeadow.start');
      assert.deepEqual(F.pathsFor(row, ctx), [scope + ':atmos@windMeadow.start']);
    }
  }
});

test('song-area application and parameter edits include its interlude and preserve the full area interval', () => {
  const { doc, plan } = fixture();
  const area = A.areasOf(doc, plan).song.find((a) => a.lineIds.length && a.scopes.some((s) => s.startsWith('cut/')));
  assert.ok(area, 'fixture owns both lyrics and an interlude');
  const sel = { level: 'line', ids: area.lineIds.slice(), area: area.ref };
  const info = CIN.selectionInfo(doc, plan, reg, sel);
  assert.deepEqual(info.scopes, area.scopes);
  assert.deepEqual([info.t0, info.t1], [area.t0, area.t1]);
  const changed = C.reduce(doc, { t: 'batch', cmds: apply(doc, plan, sel) });
  assert.deepEqual(D.validate(changed), []);
  for (const scope of area.scopes) {
    assert.equal(changed.pins[scope + ':atmos'].v, 'singularityBurst');
    assert.equal(changed.pins[scope + ':atmos@singularityBurst.start'].v, area.t0);
    assert.equal(changed.pins[scope + ':atmos@singularityBurst.duration'].v, area.t1 - area.t0);
  }
  const next = PL.plan(changed, { registry: reg });
  const section = F.sectionsFor(sel, next, reg, changed).find((s) => s.id === 'cinematic');
  const row = section.fields.find((f) => f.path === 'atmos@singularityBurst.duration');
  assert.ok(row, 'chosen effect exposes its actual parameters');
  assert.deepEqual(F.pathsFor(row, F.contextOf(sel, next, reg, changed)), area.scopes.map((s) => s + ':' + row.path));
});

test('multi-line application does not write unselected line or work scopes', () => {
  const { doc, plan } = fixture(), ids = [plan.lines[0].id, plan.lines[2].id];
  const selection = { level: 'line', ids }, info = CIN.selectionInfo(doc, plan, reg, selection);
  const cmds = apply(doc, plan, selection, 'fluidClouds');
  assert.deepEqual(info.scopes, ids.map((id) => 'line/' + id));
  assert.ok(cmds.every((cmd) => info.scopes.some((scope) => cmd.path.startsWith(scope + ':'))));
  assert.equal(new Set(cmds.filter((cmd) => cmd.path.endsWith('.start')).map((cmd) => cmd.v)).size, 1,
    'one common song anchor avoids restarting at every selected lyric');
});

test('heading and paragraph cinematic ranges render through contained interludes without changing general area membership', () => {
  const { doc, plan } = fixture(), all = A.areasOf(doc, plan), key = 'windMeadow';
  for (const kind of ['heads', 'paras']) {
    const area = all[kind].find((a) => plan.cuts.some((c) => c.role === 'interlude' && c.t0 >= a.t0 && c.t1 <= a.t1));
    assert.ok(area, kind + ' fixture contains an inner interlude');
    const gap = plan.cuts.find((c) => c.role === 'interlude' && c.t0 >= area.t0 && c.t1 <= area.t1);
    const scope = 'cut/' + gap.key, sel = { level: 'line', ids: area.lineIds, area: area.ref };
    assert.ok(!area.scopes.includes(scope), 'the original Areas API retains lyric membership');
    const info = CIN.selectionInfo(doc, plan, reg, sel);
    assert.ok(info.scopes.includes(scope));
    assert.equal(new Set(info.scopes).size, info.scopes.length);
    const changed = C.reduce(doc, { t: 'batch', cmds: apply(doc, plan, sel, key) });
    const next = PL.plan(changed, { registry: reg }), actualGap = next.cuts.find((c) => c.key === gap.key);
    const segment = next.grounds[actualGap.ground];
    assert.equal(segment.atmos.v, key, 'the planned/rendered interlude receives the effect');
    const clock = MV.use('engine/scene/cinematic');
    const data = clock.setup({ D: next.design, times: { a: 0, b: segment.t1 - segment.t0 } }, segment.atmos.p);
    assert.equal(clock.frame(0, data, { time: (gap.t0 + gap.t1) / 2 }).active, true, 'the gap playhead lies inside the cinematic interval');
    const ctx = F.contextOf(sel, next, reg, changed);
    assert.ok(!ctx.cutKeys.includes(gap.key), 'legacy non-cinematic fields keep the original line cuts');
    const section = F.sectionsFor(sel, next, reg, changed).find((s) => s.id === 'cinematic');
    const duration = section.fields.find((f) => f.path === 'atmos@' + key + '.duration');
    assert.ok(F.pathsFor(duration, ctx).includes(scope + ':' + duration.path));
    assert.equal(CIN.fillDurationCommands(changed, next, reg, sel, key, PF.pinSig).length, info.scopes.length);
    const without = C.reduce(changed, { t: 'batch', cmds: CIN.removeCommands(changed, next, reg, sel, PF.pinSig) });
    const removedPlan = PL.plan(without, { registry: reg }), removedGap = removedPlan.cuts.find((c) => c.key === gap.key);
    assert.equal(removedPlan.grounds[removedGap.ground].atmos.v, 'none', 'removal covers the same inner gap');
    const overridden = C.reduce(changed, F.pinCmd(scope + ':atmos', 'snowDust', next, PF.pinSig));
    const overridePlan = PL.plan(overridden, { registry: reg }), overrideCtx = F.contextOf(sel, overridePlan, reg, overridden);
    assert.equal(F.agreedKey(overrideCtx, 'atmos'), key, 'ordinary lyric membership is unchanged');
    assert.equal(F.agreedKey(F.cinematicContext(overrideCtx), 'atmos'), null, 'cinematic selection reports a gap override as mixed');
  }
});

test('sparse line selections without an area never acquire intervening interludes', () => {
  const { doc, plan } = fixture(), area = A.areasOf(doc, plan).heads[1], key = 'fluidClouds';
  const sel = { level: 'line', ids: [area.lineIds[0], area.lineIds[area.lineIds.length - 1]] };
  const info = CIN.selectionInfo(doc, plan, reg, sel);
  assert.deepEqual(info.scopes, sel.ids.map((id) => 'line/' + id));
  const changed = C.reduce(doc, { t: 'batch', cmds: apply(doc, plan, sel, key) });
  const next = PL.plan(changed, { registry: reg });
  for (const gap of next.cuts.filter((c) => c.role === 'interlude')) {
    assert.notEqual(next.grounds[gap.ground].atmos.v, key, 'the cinematic overlay stays off unselected gaps');
  }
});

test('sparse explicit line areas keep their original scopes instead of filling intervening gaps', () => {
  const { doc, plan } = fixture(), ids = ['r4', 're'], key = 'fluidClouds';
  const sel = { level: 'line', ids, area: { kind: 'lines', ids } };
  const info = CIN.selectionInfo(doc, plan, reg, sel);
  assert.deepEqual(info.scopes, ids.map((id) => 'line/' + id));
  const changed = C.reduce(doc, { t: 'batch', cmds: apply(doc, plan, sel, key) });
  const next = PL.plan(changed, { registry: reg }), gap = next.cuts.find((c) => c.key === 'gap/rc');
  assert.notEqual(next.grounds[gap.ground].atmos.v, key, 'the unselected middle interlude retains its own atmosphere');
});

test('disjoint song-kind areas keep only their owned interludes, excluding a middle verse gap', () => {
  const source = fixture().doc, doc = JSON.parse(JSON.stringify(source)), key = 'wavePuddle';
  doc.song.info.sections = [{ kind: 'intro', start: 0, end: 4 }, { kind: 'chorus', start: 4, end: 14 },
    { kind: 'verse', start: 14, end: 46 }, { kind: 'chorus', start: 46, end: 60 }];
  const plan = PL.plan(doc, { registry: reg }), area = A.areasOf(doc, plan).kinds.find((a) => a.songKind === 'chorus');
  assert.ok(area && area.scopes.includes('cut/gap/re') && !area.scopes.includes('cut/gap/rc'));
  const sel = { level: 'line', ids: area.lineIds, area: area.ref }, info = CIN.selectionInfo(doc, plan, reg, sel);
  assert.deepEqual(info.scopes, area.scopes);
  const changed = C.reduce(doc, { t: 'batch', cmds: apply(doc, plan, sel, key) }), next = PL.plan(changed, { registry: reg });
  const middle = next.cuts.find((c) => c.key === 'gap/rc'), owned = next.cuts.find((c) => c.key === 'gap/re');
  assert.notEqual(next.grounds[middle.ground].atmos.v, key, 'middle verse gap is outside both choruses');
  assert.equal(next.grounds[owned.ground].atmos.v, key, 'the second chorus keeps its owned outro gap');
});

test('none overrides an inherited cinematic effect only at the selected scope and undoes cleanly', () => {
  const { doc, plan } = fixture();
  const whole = C.reduce(doc, { t: 'batch', cmds: apply(doc, plan, { level: 'work' }, 'universeJourney') });
  const p = PL.plan(whole, { registry: reg }), line = p.lines[0], sel = { level: 'line', ids: [line.id] };
  const cmds = CIN.removeCommands(whole, p, reg, sel, PF.pinSig);
  assert.deepEqual(cmds, [{ t: 'pin.set', path: 'line/' + line.id + ':atmos', v: 'none', by: 'user' }]);
  const store = MV.use('core/store').createStore({ doc: whole, reduce: C.reduce });
  store.batch({ label: ['cinematic.undoRemove', {}] }, cmds);
  assert.equal(store.doc.pins['work:atmos'].v, 'universeJourney');
  assert.equal(store.doc.pins['line/' + line.id + ':atmos'].v, 'none');
  store.undo(); assert.deepEqual(store.doc, whole);
});

test('moved cut pin keys retain the existing signature and do not orphan the old key', () => {
  const { doc, plan } = fixture(), cut = plan.cuts.find((c) => c.line);
  const legacy = cut.key.replace(/~\d+$/, '~999');
  const altered = Object.assign({}, plan, { cuts: plan.cuts.map((c) => c === cut ? Object.assign({}, c, { pinKey: legacy }) : c) });
  const cmds = apply(doc, altered, { level: 'cut', key: cut.key }, 'wavePuddle');
  assert.ok(cmds.length);
  assert.ok(cmds.every((cmd) => cmd.path.startsWith('cut/' + legacy + ':')));
  assert.ok(cmds.every((cmd) => cmd.sig === PF.pinSig(altered, cut.key)));
});

test('stale selections and non-cinematic keys cannot apply a broader mutation', () => {
  const { doc, plan } = fixture(), stale = { level: 'cut', key: 'gap/missing' };
  assert.deepEqual(apply(doc, plan, stale), []);
  assert.deepEqual(CIN.removeCommands(doc, plan, reg, stale, PF.pinSig), []);
  assert.deepEqual(apply(doc, plan, { level: 'work' }, 'snowDust'), []);
});

test('scope effect controls remain editable when a narrower lyric keeps an overlay override', () => {
  const { doc, plan } = fixture();
  let changed = C.reduce(doc, { t: 'batch', cmds: apply(doc, plan, { level: 'work' }, 'universeJourney') });
  changed = C.reduce(changed, { t: 'pin.set', path: 'line/' + plan.lines[0].id + ':atmos', v: 'snowDust', by: 'user' });
  const next = PL.plan(changed, { registry: reg }), sel = { level: 'work' }, ctx = F.contextOf(sel, next, reg, changed);
  assert.equal(F.agreedKey(ctx, 'atmos'), null, 'effective scene selection is mixed');
  assert.equal(F.cinematicKey(ctx, changed), 'universeJourney', 'explicit work choice remains the editor target');
  const section = F.sectionsFor(sel, next, reg, changed).find((s) => s.id === 'cinematic');
  assert.ok(section.fields.some((f) => f.path === 'atmos@universeJourney.duration'));
  assert.equal(changed.pins['line/' + plan.lines[0].id + ':atmos'].v, 'snowDust');
});

test('work timing, strength, and preview read owned values before same-effect first-cut overrides', () => {
  const { doc, plan } = fixture(), sel = { level: 'work' }, key = 'universeJourney';
  const changed = C.reduce(doc, { t: 'batch', cmds: apply(doc, plan, sel, key).concat([
    F.pinCmd('work:atmos@' + key + '.start', 10.004, plan, PF.pinSig),
    F.pinCmd('work:atmos@' + key + '.duration', 0, plan, PF.pinSig),
    F.pinCmd('cut/title:atmos@' + key + '.start', 1, plan, PF.pinSig),
    F.pinCmd('cut/title:atmos@' + key + '.duration', 9, plan, PF.pinSig),
    F.pinCmd('cut/title:atmos@' + key + '.clock', 'section', plan, PF.pinSig),
    F.pinCmd('cut/title:atmos.amount', 0, plan, PF.pinSig),
  ]) });
  const next = PL.plan(changed, { registry: reg }), path = 'work:atmos@' + key + '.start';
  const effective = PF.fieldState(changed, next, null, path, { registry: reg });
  assert.equal(effective.value, 1, 'the first-cut effective state contains its narrower override');
  assert.equal(CIN.paramValue(changed, next, reg, 'work', key, 'start'), 10, 'raw owned value is coerced through its own spec');
  assert.equal(CIN.paramValue(changed, next, reg, 'work', key, 'clock'), 'song');
  const shown = CIN.ownedParamState(changed, next, reg, path, key, 'start', effective);
  assert.equal(shown.value, 10); assert.equal(shown.pinnedAt, 'work'); assert.equal(shown.pinAt, path);
  const amountPath = 'work:atmos.amount', amountState = PF.fieldState(changed, next, null, amountPath, { registry: reg });
  assert.equal(amountState.value, 0);
  assert.equal(CIN.ownedParamState(changed, next, reg, amountPath, key, 'amount', amountState).value, 0.65);
  const fill = CIN.fillDurationCommands(changed, next, reg, sel, key, PF.pinSig);
  assert.deepEqual(fill, [F.pinCmd('work:atmos@' + key + '.duration', next.duration - 10, next, PF.pinSig)]);
  const clock = CIN.songClockCommands(changed, next, reg, sel, key, PF.pinSig);
  assert.equal(clock.find((cmd) => cmd.path.endsWith('.duration')).v, next.duration - 10,
    'the work automatic duration is filled even when the first cut has a positive duration');
  const preview = CIN.previewParams(changed, next, reg, sel, key);
  assert.equal(preview.amount, 0.65, 'a darkened first cut cannot make the whole-work trial blank');
  assert.equal(preview.start, 10); assert.equal(preview.clock, 'song'); assert.equal(preview.duration, 0);
  assert.equal(changed.pins['cut/title:atmos@' + key + '.start'].v, 1);
  const invalid = Object.assign({}, changed, { pins: Object.assign({}, changed.pins, { [path]: { v: 'invalid', by: 'user' } }) });
  assert.equal(CIN.ownedParamState(invalid, next, reg, path, key, 'start', effective), effective, 'an invalid owned value does not bypass coercion');
});

test('zero duration fills the selected song range continuously across split backgrounds', () => {
  const { doc, plan } = fixture(), area = A.areasOf(doc, plan).song[2];
  const sel = { level: 'line', ids: area.lineIds, area: area.ref }, key = 'singularityBurst';
  let changed = C.reduce(doc, { t: 'batch', cmds: apply(doc, plan, sel, key).concat(
    [{ t: 'pin.set', path: 'line/' + area.lineIds[0] + ':ground', v: 'flatFill', by: 'user' },
      { t: 'pin.set', path: 'line/' + area.lineIds[1] + ':ground', v: 'skyGrade', by: 'user' }],
    area.scopes.flatMap((scope) => [
      F.pinCmd(scope + ':atmos@' + key + '.start', 26, plan, PF.pinSig),
      F.pinCmd(scope + ':atmos@' + key + '.duration', 2, plan, PF.pinSig),
    ])) });
  const before = PL.plan(changed, { registry: reg });
  const cmds = CIN.fillDurationCommands(changed, before, reg, sel, key, PF.pinSig);
  assert.equal(cmds.length, area.scopes.length);
  assert.ok(cmds.every((cmd) => cmd.v === 14), 'fill ends at selected area end, measured from the agreed song start');
  changed = C.reduce(changed, { t: 'batch', cmds });
  const after = PL.plan(changed, { registry: reg });
  const segments = after.grounds.filter((g) => g.atmos.v === key);
  assert.ok(new Set(segments.map((g) => g.ground.v)).size >= 2, 'the effect really crosses different backgrounds');
  const clock = MV.use('engine/scene/cinematic');
  for (const segment of segments) {
    const data = clock.setup({ D: after.design, times: { a: 0, b: segment.t1 - segment.t0 } }, segment.atmos.p);
    assert.equal(data.duration, 14, 'segment length cannot shorten a filled song-clock effect');
    assert.equal(clock.frame(0.5, data, { time: 30 }).u, 4 / 14, 'every reused/split scene has the same cinematic phase');
  }
});

test('zero duration with no range remaining is rejected without saving the segment fallback sentinel', () => {
  const { doc, plan } = fixture(), sel = { level: 'line', ids: [plan.lines[0].id] }, key = 'fluidClouds';
  const info = CIN.selectionInfo(doc, plan, reg, sel), scope = info.scopes[0];
  const changed = C.reduce(doc, { t: 'batch', cmds: apply(doc, plan, sel, key).concat([
    { t: 'pin.set', path: scope + ':atmos@' + key + '.start', v: Math.ceil(info.t1 * 100) / 100, by: 'user' },
    { t: 'pin.set', path: scope + ':atmos@' + key + '.duration', v: 2, by: 'user' },
  ]) });
  const next = PL.plan(changed, { registry: reg });
  assert.deepEqual(CIN.fillDurationCommands(changed, next, reg, sel, key, PF.pinSig), []);
  assert.equal(changed.pins[scope + ':atmos@' + key + '.duration'].v, 2, 'previous explicit interval is retained');
});

test('switching a legacy atmosphere to the song clock fills its automatic duration in the same undo', () => {
  const { doc, plan } = fixture(), area = A.areasOf(doc, plan).song[2];
  const sel = { level: 'line', ids: area.lineIds, area: area.ref }, key = 'universeJourney';
  const legacy = C.reduce(doc, { t: 'batch', cmds: area.scopes.map((scope) => F.pinCmd(scope + ':atmos', key, plan, PF.pinSig)).concat([
    { t: 'pin.set', path: 'line/' + area.lineIds[0] + ':ground', v: 'flatFill', by: 'user' },
    { t: 'pin.set', path: 'line/' + area.lineIds[1] + ':ground', v: 'skyGrade', by: 'user' },
  ]) });
  const before = PL.plan(legacy, { registry: reg });
  assert.ok(before.grounds.filter((g) => g.atmos.v === key).every((g) => g.atmos.p.duration === 0 && g.atmos.p.clock === 'section'));
  const cmds = CIN.songClockCommands(legacy, before, reg, sel, key, PF.pinSig);
  assert.equal(cmds.length, area.scopes.length * 2, 'clock and its resolved duration are one transaction');
  const store = MV.use('core/store').createStore({ doc: legacy, reduce: C.reduce });
  store.batch({ label: ['cinematic.undoApply', { name: 'Universe' }] }, cmds);
  const after = PL.plan(store.doc, { registry: reg }), segments = after.grounds.filter((g) => g.atmos.v === key);
  assert.ok(new Set(segments.map((g) => g.ground.v)).size >= 2);
  for (const segment of segments) {
    assert.equal(segment.atmos.p.clock, 'song');
    assert.equal(segment.atmos.p.duration, area.t1, 'the zero song start reaches the selected area end across every background');
  }
  store.undo(); assert.deepEqual(store.doc, legacy, 'one undo restores both automatic duration and section clock');
});

test('switching to the song clock preserves an explicit duration and rejects an empty automatic interval', () => {
  const { doc, plan } = fixture(), sel = { level: 'line', ids: [plan.lines[0].id] }, key = 'wavePuddle';
  const info = CIN.selectionInfo(doc, plan, reg, sel), scope = info.scopes[0];
  let chosen = C.reduce(doc, { t: 'batch', cmds: [
    { t: 'pin.set', path: scope + ':atmos', v: key, by: 'user' },
    { t: 'pin.set', path: scope + ':atmos@' + key + '.duration', v: 6, by: 'user' },
  ] });
  let current = PL.plan(chosen, { registry: reg });
  assert.deepEqual(CIN.songClockCommands(chosen, current, reg, sel, key, PF.pinSig),
    [{ t: 'pin.set', path: scope + ':atmos@' + key + '.clock', v: 'song', by: 'user' }]);
  chosen = C.reduce(chosen, { t: 'batch', cmds: [
    { t: 'pin.set', path: scope + ':atmos@' + key + '.duration', v: 0, by: 'user' },
    { t: 'pin.set', path: scope + ':atmos@' + key + '.start', v: Math.ceil(info.t1 * 100) / 100, by: 'user' },
  ] });
  current = PL.plan(chosen, { registry: reg });
  assert.deepEqual(CIN.songClockCommands(chosen, current, reg, sel, key, PF.pinSig), []);
});

test('cinematic previews reset only their own sample clock and retain effect settings without mutating them', () => {
  const params = Object.freeze({ clock: 'song', start: 45, duration: 12, seed: 11, amount: 0.4, density: 280 });
  const ref = CIN.previewRef('universeJourney', params);
  assert.deepEqual(ref, { kind: 'ornament', key: 'universeJourney', params: {
    clock: 'section', start: 0, duration: 8, seed: 11, amount: 0.4, density: 280,
  } });
  assert.equal(params.clock, 'song'); assert.equal(params.start, 45);
});

test('cinematic bookmarks keep area metadata and exact cut scopes and open a real section', () => {
  const { doc, plan } = fixture(), area = A.areasOf(doc, plan).song[2];
  const selections = [{ level: 'work' }, { level: 'line', ids: [plan.lines[0].id] },
    { level: 'cut', key: plan.lines[0].cuts[0] }, { level: 'line', ids: area.lineIds, area: area.ref }];
  for (const sel of selections) {
    const target = NAV.target('cinematic', sel, plan, doc);
    assert.deepEqual(target.sel, sel);
    assert.equal(target.section, 'cinematic');
    assert.ok(F.sectionsFor(target.sel, plan, reg, doc).some((s) => s.id === 'cinematic' && s.custom === 'cinematic'));
  }
});
