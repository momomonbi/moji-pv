/* 文字PVメーカー v2 — original work. Tests for the pure parts of the photo and video UI: routing, placement, the library's commands, relink, colour matching and the media rows of the inspector (DESIGN_2_1 §11.7, §11.8.2, §11.9.5). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');
const GEN = require('../helpers/make_media_fixtures.js');

const MV = load();
const IO = MV.use('ui/project_io');
const MI = MV.use('ui/media_io');
const MW = MV.use('ui/media_widgets');
const F = MV.use('ui/fields');
const S = MV.use('ui/selection');
const PB = MV.use('ui/part_browser');
const CMD = MV.use('core/commands');
const CH = MV.use('ai/changes');
const MEDIA = MV.use('core/media');
const C = MV.use('core/color');
const M = MV.use('core/migrate');
const AREAS = MV.use('planner/areas');
const PL = MV.use('planner/plan');
const MIX = MV.use('parts/mix');
const BASE = MV.use('parts/catalog').defaultRegistry();

const DIR = path.resolve(__dirname, '..', 'fixtures', 'media');
const LOGO = 'a1c2e3f4a5b6c7d8e9f0a1b2c';   // ロゴ.png, 800×800 with alpha: line r2's photoFrame
const SKY = 'a2d4f6a8b0c2d4e6f8a0b2c4d';    // 空.jpg, pooled: line r3's derived ground, in line r5's avoid list
const SEA = 'a3f9c2d17b0e4a5c6d7e8f901';    // 海辺.mp4, 12.512 s: the work's photoPan
const GLOW = 'a4b5c6d7e8f9a0b1c2d3e4f50';   // きらめき.webm, 4 s with alpha: not used

// The media fixture as the app holds it: migrated, its registry with the derived grounds, and its plan.
function world(edit) {
  let { doc } = M.parseFile(corpus.projectText('media'));
  if (edit) doc = edit(doc);
  const registry = MIX.registryFor(BASE, doc.materials, doc.media);
  const plan = PL.plan(doc, { registry });
  return { doc, registry, plan };
}
const W = world();
const apply = (doc, cmds) => CMD.reduce(doc, { t: 'batch', cmds });
const set = (path, v, sig) => Object.assign({ t: 'pin.set', path, v, by: 'user' }, sig ? { sig } : {});

// --- routing (§11.7.2) -------------------------------------------------------------------------------------------------

// An audio-only WebM: one Opus track, a few blocks.
function audioWebm() {
  const { el, eu, es, E, matroska, payload } = GEN.helpers;
  const f64 = (v) => { const b = Buffer.alloc(8); b.writeDoubleBE(v); return [...b]; };
  const opusHead = [...Buffer.from('OpusHead', 'latin1'), 1, 2, 0x38, 0x01, 0x80, 0xbb, 0, 0, 0, 0, 0];
  const audio = el(E.TrackEntry, eu(E.TrackNumber, 1), eu(E.TrackUID, 1001), eu(E.TrackType, 2), eu(E.FlagLacing, 0),
    es(E.CodecID, 'A_OPUS'), el(E.CodecPrivate, opusHead), el(E.Audio, el(E.SamplingFrequency, f64(48000)), eu(E.Channels, 2)));
  const frames = Array.from({ length: 5 }, (_, i) => ({ time: i * 20, key: true, data: payload('opu', i, 30) }));
  return matroska({ doc: 'webm', tracks: [audio], frames, durationMs: 100 }).bytes;
}

test('routing by sniff: a WebM with a video track is media, an audio-only WebM is the song, whatever the name says', async () => {
  const io = IO.create({ t: (k) => k, bus: { emit() {}, on() {} } });
  const fixture = (name) => fs.readFileSync(path.join(DIR, name));
  assert.equal(await io.routeFile(new File([fixture('vp9.webm')], 'clip.webm', { type: 'video/webm' })), 'media');
  assert.equal(await io.routeFile(new File([fixture('vp9.webm')], '曲.webm', { type: 'audio/webm' })), 'media',
    'the tracks decide, not the name or the type');
  assert.equal(await io.routeFile(new File([audioWebm()], 'song.webm', { type: 'video/webm' })), 'song');
  assert.equal(await io.routeFile(new File([fixture('bframes.mp4')], 'clip.mp4', { type: 'video/mp4' })), 'media');
  assert.equal(await io.routeFile(new File([fixture('anim.gif')], 'anim.gif', { type: '' })), 'media');
});

// --- where a placement goes (§11.7.2) ----------------------------------------------------------------------------------

test('whereOf: nothing or a work page is the work; lines, an area, a cut and element pages their own scopes', () => {
  const { doc, plan } = W;
  assert.deepEqual(MI.whereOf(S.WORK, plan, doc), { kind: 'work', scopes: ['work'], lineIds: [], area: null });
  assert.deepEqual(MI.whereOf({ level: 'page', page: 'look' }, plan, doc).scopes, ['work']);
  assert.deepEqual(MI.whereOf({ level: 'line', ids: ['r5', 'r2'] }, plan, doc).scopes.slice().sort(), ['line/r2', 'line/r5']);
  const para = AREAS.resolve(doc, plan, { kind: 'para', rowId: 'r2' });
  const w = MI.whereOf(S.areaSel(para), plan, doc);
  assert.equal(w.kind, 'lines');
  assert.deepEqual(w.scopes, ['line/r2', 'line/r3']);
  assert.deepEqual(w.area, { kind: 'para', rowId: 'r2' });
  assert.deepEqual(MI.whereOf({ level: 'cut', key: 'r5~6' }, plan, doc), { kind: 'cut', scopes: ['cut/r5~6'], lineIds: [], area: null });
  assert.deepEqual(MI.whereOf({ level: 'el', scope: 'line/r3', el: 'ground' }, plan, doc).scopes, ['line/r3']);
  assert.equal(MI.whereOf({ level: 'el', scope: 'cut/r2~5', el: 'text' }, plan, doc).kind, 'cut');
});

// --- placement batches (§11.7.2, §11.7.3) ------------------------------------------------------------------------------

test('scopeWords: one line is 「n行目」 (never a count), a cut 「n行目のカットk」, an area its name, the work 作品全体', () => {
  const T = MV.use('i18n/t');
  const t = T.createT('ja', MV.use('i18n/strings'), BASE, { strict: true });
  const { doc, plan } = W;
  const line = (id) => plan.lines.find((l) => l.id === id).index + 1;
  assert.equal(MI.scopeWords(t, null, doc, plan), '作品全体');
  assert.equal(MI.scopeWords(t, MI.whereOf({ level: 'line', ids: ['r3'] }, plan, doc), doc, plan), line('r3') + '行目');
  const cut = MI.scopeWords(t, MI.whereOf({ level: 'cut', key: 'r5~6' }, plan, doc), doc, plan);
  assert.ok(cut.startsWith(line('r5') + '行目の'), cut);
  const para = AREAS.resolve(doc, plan, { kind: 'para', rowId: 'r2' });
  assert.equal(MI.scopeWords(t, MI.whereOf(S.areaSel(para), plan, doc), doc, plan), F.areaLabel(t, para));
  // the asset page's places say the same
  const MPG = MV.use('ui/media_page');
  assert.equal(MPG.placeText(t, { use: 'frame', scope: 'line/r2', area: null }, doc, plan), line('r2') + '行目（枠）');
});

test('placement at the work: the part and its media param, one pair; the plan then shows the asset there', () => {
  const { doc, plan, registry } = W;
  const { cmds, full } = MI.placeCmds(doc, plan, GLOW, 'ground', ['work'], PL.pinSig);
  assert.deepEqual(full, []);
  assert.deepEqual(cmds, [set('work:ground', 'photoPan'), set('work:ground@photoPan.image', GLOW)]);
  const next = apply(doc, cmds);
  const after = PL.plan(next, { registry });
  const g = after.grounds[after.cuts.find((c) => c.line === 'r5').ground].ground;
  assert.equal(g.v, 'photoPan');
  assert.equal(g.p.image, GLOW);
  assert.ok(after.media[GLOW], 'plan.media holds the placed asset');
});

// The part each cut of a line shows in ornament#0…#2.
const ornamentsOf = (plan, line) => plan.cuts.filter((c) => c.line === line)
  .map((c) => [0, 1, 2].map((i) => (c.slots['ornament#' + i] ? c.slots['ornament#' + i].v : null)));

test('placement on lines and on an area: each line gets its pair; ornaments take the first free index of that line', () => {
  const { doc, plan, registry } = W;
  // r2's ornament#0 is the user's photoFrame and its #1 automatic; r3 shows two automatic decorations; r5's #0 is
  // automatic and its #1 a material pin: a frame goes to #2 everywhere, and the decorations there stay
  const lines = MI.placeCmds(doc, plan, GLOW, 'frame', ['line/r2', 'line/r3', 'line/r5'], PL.pinSig);
  assert.deepEqual(lines.cmds, [
    set('line/r2:ornament#2', 'photoFrame'), set('line/r2:ornament#2@photoFrame.src', GLOW),
    set('line/r3:ornament#2', 'photoFrame'), set('line/r3:ornament#2@photoFrame.src', GLOW),
    set('line/r5:ornament#2', 'photoFrame'), set('line/r5:ornament#2@photoFrame.src', GLOW),
  ]);
  const placed = PL.plan(apply(doc, lines.cmds), { registry });
  for (const line of ['r2', 'r3', 'r5']) {
    const before = ornamentsOf(plan, line), after = ornamentsOf(placed, line);
    after.forEach((o, k) => {
      assert.equal(o[2], 'photoFrame', line + ' cut ' + k + ' shows the frame');
      assert.equal(o[0], before[k][0], line + ' cut ' + k + ' keeps its first decoration');
      if (before[k][1]) assert.equal(o[1], before[k][1], line + ' cut ' + k + ' keeps its second decoration');
    });
  }
  const para = AREAS.resolve(doc, plan, { kind: 'para', rowId: 'r2' });
  const area = MI.placeCmds(doc, plan, SKY, 'overlay', MI.whereOf(S.areaSel(para), plan, doc).scopes, PL.pinSig);
  assert.deepEqual(area.cmds, [
    set('line/r2:atmos', 'mediaLayer'), set('line/r2:atmos@mediaLayer.src', SKY),
    set('line/r3:atmos', 'mediaLayer'), set('line/r3:atmos@mediaLayer.src', SKY),
  ]);
  assert.deepEqual(MI.placeCmds(doc, plan, LOGO, 'fill', ['line/r3'], PL.pinSig).cmds,
    [set('line/r3:ornament#2', 'textFill'), set('line/r3:ornament#2@textFill.src', LOGO)]);
  // every command is a valid reducer input
  const next = apply(doc, lines.cmds.concat(area.cmds));
  assert.equal(next.pins['line/r5:ornament#2@photoFrame.src'].v, GLOW);
  assert.equal(next.pins['line/r2:ornament#0'].v, 'photoFrame', 'the user\'s frame stays');
});

test('freeIndex: never a slot a user or lock pin holds; of the others the one where the fewest cuts change', () => {
  const { doc, plan } = W;
  // no decoration shown: the first unpinned index; an AI pin does not hold an index (§5.5)
  const bare = Object.assign({}, plan, { cuts: plan.cuts.map((c) => Object.assign({}, c, { slots: {} })) });
  assert.equal(MI.freeIndex(W.doc, bare, 'line/r3', 'ornament'), 0);
  const ai = CMD.reduce(W.doc, { t: 'pin.set', path: 'line/r3:ornament#0', v: 'photoFrame', by: 'ai' });
  assert.equal(MI.freeIndex(ai, bare, 'line/r3', 'ornament'), 0);
  const user = CMD.reduce(W.doc, set('line/r3:ornament#0', 'photoFrame'));
  assert.equal(MI.freeIndex(user, bare, 'line/r3', 'ornament'), 1);
  // r3~0 shows two decorations, r3~4 one: #1 would replace r3~0's second one, #2 adds one to r3~4 (the planner raises
  // its count): one change each, and adding wins over replacing; the cut r3~4 alone has #1 free
  assert.deepEqual(ornamentsOf(plan, 'r3').map((o) => o.filter(Boolean).length), [2, 1]);
  assert.equal(MI.freeIndex(doc, plan, 'line/r3', 'ornament'), 2);
  assert.equal(MI.freeIndex(doc, plan, 'cut/r3~4', 'ornament'), 1);
  // the work: every cut counts (#0 would replace 7 decorations, #1 six, #2 raises one cut)
  assert.equal(MI.freeIndex(doc, plan, 'work', 'ornament'), 2);
  // many cuts with one decoration and a few with two (a typical work): #1 replaces the few second ones rather than
  // adding a decoration to every other cut
  const typical = Object.assign({}, plan, { cuts: Array.from({ length: 10 }, (_, i) => ({ key: 'k' + i, line: null,
    slots: Object.assign({ 'ornament.count': { v: i < 2 ? 2 : 1, from: 'auto' }, 'ornament#0': { v: 'tapeStrip', from: 'auto' } },
      i < 2 ? { 'ornament#1': { v: 'sunBurst', from: 'auto' } } : {}) })) });
  assert.equal(MI.freeIndex(W.doc, typical, 'work', 'ornament'), 1);
  // only pins fill a scope
  const three = Object.assign({}, plan, { cuts: plan.cuts.map((c, i) => (i ? c : Object.assign({}, c, { slots: Object.assign({}, c.slots,
    { 'ornament#2': { v: 'sunBurst', from: 'auto' } }) }))) });
  assert.equal(MI.freeIndex(doc, three, 'work', 'ornament'), 2, 'a slot that one cut shows is still the one that changes least');
});

test('placement on a cut: its pins are written where the cut lives, with the cut\'s text as sig', () => {
  const { doc, plan } = W;
  const sig = PL.pinSig(plan, 'r5~6');
  assert.equal(typeof sig, 'string');
  const { cmds } = MI.placeCmds(doc, plan, SEA, 'ground', ['cut/r5~6'], PL.pinSig);
  assert.deepEqual(cmds, [set('cut/r5~6:ground', 'photoPan', sig), set('cut/r5~6:ground@photoPan.image', SEA, sig)]);
  const frame = MI.placeCmds(doc, plan, LOGO, 'frame', ['cut/r2~5'], PL.pinSig);
  assert.deepEqual(frame.cmds.map((c) => c.path), ['cut/r2~5:ornament#2', 'cut/r2~5:ornament#2@photoFrame.src'],
    'the line\'s own ornament#0 and the cut\'s automatic #1 are not free');
  const bare = Object.assign({}, plan, { cuts: plan.cuts.map((c) => Object.assign({}, c, { slots: {} })) });
  assert.deepEqual(MI.placeCmds(doc, bare, LOGO, 'frame', ['cut/r2~5'], PL.pinSig).cmds.map((c) => c.path),
    ['cut/r2~5:ornament#1', 'cut/r2~5:ornament#1@photoFrame.src'], 'the line\'s pin holds #0 for its cuts');
});

test('placement: a scope whose three ornaments are held reports full and gets no pins', () => {
  const { plan } = W;
  const doc = apply(W.doc, [0, 1, 2].map((i) => set('line/r3:ornament#' + i, 'photoFrame')));
  const { cmds, full } = MI.placeCmds(doc, plan, LOGO, 'frame', ['line/r3', 'line/r5'], PL.pinSig);
  assert.deepEqual(full, ['line/r3']);
  assert.deepEqual(cmds.map((c) => c.path), ['line/r5:ornament#2', 'line/r5:ornament#2@photoFrame.src']);
  assert.throws(() => MI.placeCmds(doc, plan, LOGO, 'poster', ['work'], PL.pinSig), /unknown use/);
});

// --- the library (§11.7.3) ---------------------------------------------------------------------------------------------

test('library order: 上へ and 下へ are media.move commands that step once; the ends have none', () => {
  let doc = W.doc;
  const order = () => doc.media.list.map((e) => e.id);
  assert.deepEqual(order(), [LOGO, SKY, SEA, GLOW]);
  assert.equal(MI.moveCmd(doc, LOGO, -1), undefined);
  assert.equal(MI.moveCmd(doc, GLOW, 1), undefined);
  assert.equal(MI.moveCmd(doc, 'a' + '0'.repeat(24), 1), undefined);
  assert.deepEqual(MI.moveCmd(doc, SEA, 1), { t: 'media.move', id: SEA, before: null });
  doc = CMD.reduce(doc, MI.moveCmd(doc, SEA, 1));
  assert.deepEqual(order(), [LOGO, SKY, GLOW, SEA]);
  doc = CMD.reduce(doc, MI.moveCmd(doc, SEA, -1));
  assert.deepEqual(order(), [LOGO, SKY, SEA, GLOW]);
  doc = CMD.reduce(doc, MI.moveCmd(doc, SKY, -1));
  assert.deepEqual(order(), [SKY, LOGO, SEA, GLOW]);
  doc = CMD.reduce(doc, MI.moveCmd(doc, SKY, 1));
  assert.deepEqual(order(), [LOGO, SKY, SEA, GLOW]);
  doc = CMD.reduce(doc, MI.moveCmd(doc, LOGO, 1));
  assert.deepEqual(order(), [SKY, LOGO, SEA, GLOW]);
});

test('delete: media.remove, then pin.clear of every part pin whose media param emptied', () => {
  const { doc, registry } = W;
  assert.deepEqual(MI.deleteCmds(doc, registry, LOGO), [{ t: 'media.remove', id: LOGO }, { t: 'pin.clear', path: 'line/r2:ornament#0' }]);
  assert.deepEqual(MI.deleteCmds(doc, registry, SEA), [{ t: 'media.remove', id: SEA }, { t: 'pin.clear', path: 'work:ground' }]);
  assert.deepEqual(MI.deleteCmds(doc, registry, GLOW), [{ t: 'media.remove', id: GLOW }]);
  // the derived ground, its params and the avoid item go with media.remove itself
  assert.deepEqual(MI.deleteCmds(doc, registry, SKY), [{ t: 'media.remove', id: SKY }]);
  const next = apply(doc, MI.deleteCmds(doc, registry, SKY).concat(MI.deleteCmds(doc, registry, LOGO)));
  assert.deepEqual(Object.keys(next.pins).sort(),
    ['line/r5:avoid', 'line/r5:ornament#1', 'work:ground', 'work:ground@photoPan.image']);
  assert.deepEqual(next.pins['line/r5:avoid'].v, ['filter.sliceGlitch']);
  assert.deepEqual(next.media.list.map((e) => e.id), [SEA, GLOW]);
});

test('delete keeps a part pin that still shows another asset, and lock pins', () => {
  const { registry } = W;
  // a part with a second media param would keep its pin while one param still has an id: photoPan has only `image`,
  // so the pin goes; a lock pin of the part stays (Unlock removes it)
  const locked = apply(W.doc, [{ t: 'pin.set', path: 'work:ground', v: 'photoPan', by: 'lock' }]);
  assert.deepEqual(MI.deleteCmds(locked, registry, SEA), [{ t: 'media.remove', id: SEA }]);
  // another scope's part pin that shows a different asset stays
  const two = apply(W.doc, [set('line/r5:ground', 'photoPan'), set('line/r5:ground@photoPan.image', GLOW)]);
  assert.deepEqual(MI.deleteCmds(two, registry, SEA), [{ t: 'media.remove', id: SEA }, { t: 'pin.clear', path: 'work:ground' }]);
  assert.deepEqual(MI.mediaParamsOf(registry, 'ground', 'photoPan'), ['image']);
  assert.deepEqual(MI.mediaParamsOf(registry, 'ornament', 'photoFrame'), ['src']);
  assert.deepEqual(MI.mediaParamsOf(registry, 'ground', MEDIA.keyOf(SKY)), ['image'], 'a derived ground is a photoPan variant');
});

test('この写真を使わない: every use cleared (avoid lists only lose the item), おまかせ off; the library keeps the asset', () => {
  const { doc, registry } = W;
  assert.deepEqual(MI.notUseCmds(doc, registry, SKY), [
    { t: 'pin.clear', path: 'line/r3:ground' },
    { t: 'pin.clear', path: 'line/r3:ground@myMed2d4f6a8b0c.blur' },
    { t: 'pin.set', path: 'line/r5:avoid', v: ['filter.sliceGlitch'], by: 'user' },
    { t: 'media.meta', id: SKY, pool: false },
  ]);
  assert.deepEqual(MI.notUseCmds(doc, registry, LOGO), [
    { t: 'pin.clear', path: 'line/r2:ornament#0@photoFrame.src' },
    { t: 'pin.clear', path: 'line/r2:ornament#0' },
  ]);
  const next = apply(doc, MI.notUseCmds(doc, registry, SEA));
  assert.ok(!('work:ground' in next.pins) && !('work:ground@photoPan.image' in next.pins));
  assert.ok(MI.entryOf(next, SEA), 'still in the library');
});

test('使っている場所: one place per scope and use; lines of one use that form an area are one place', () => {
  const { doc, plan } = W;
  // 海辺.mp4 is the work's background and a layer of the material m1: materials come last
  assert.deepEqual(MI.usePlaces(doc, plan, SEA).map((p) => [p.use, p.scope, p.id]), [['ground', 'work', undefined], ['material', null, 'm1']]);
  assert.deepEqual(MI.usePlaces(doc, plan, SKY).map((p) => [p.use, p.scope]), [['ground', 'line/r3']],
    'the avoid list of r5 is not a use');
  assert.deepEqual(MI.usePlaces(doc, plan, LOGO)[0].sel, { level: 'el', scope: 'line/r2', el: 'ornament', idx: 0 });
  // r2 and r3 are paragraph 1: framed together, they read as that area
  const both = apply(doc, [set('line/r3:ornament#0', 'photoFrame'), set('line/r3:ornament#0@photoFrame.src', LOGO),
    set('cut/r5~6:ornament#0', 'photoFrame', PL.pinSig(plan, 'r5~6')),
    set('cut/r5~6:ornament#0@photoFrame.src', LOGO, PL.pinSig(plan, 'r5~6')), set('work:atmos', 'mediaLayer'),
    set('work:atmos@mediaLayer.src', LOGO)]);
  const places = MI.usePlaces(both, plan, LOGO);
  assert.deepEqual(places.map((p) => [p.use, p.scope, p.lineIds]),
    [['overlay', 'work', []], ['frame', null, ['r2', 'r3']], ['frame', 'cut/r5~6', []]]);
  assert.deepEqual(places[1].sel, S.areaSel(places[1].area));
  assert.equal(places[1].area.kind, 'para');
  assert.deepEqual(MI.usePlaces(doc, plan, GLOW), []);
});

// --- relink and colours (§11.2.9, §11.6.3) -----------------------------------------------------------------------------

test('relinkCandidate: the same kind and size (stills) or duration ±0.05 s (videos, animations)', () => {
  const list = W.doc.media.list;
  const missing = list.filter((e) => e.id !== SKY);
  const other = (base, extra) => Object.assign({}, base, { id: 'b' + '1'.repeat(24) }, extra);
  const logo = list.find((e) => e.id === LOGO), sea = list.find((e) => e.id === SEA);
  assert.equal(MI.relinkCandidate(missing, other(logo)).id, LOGO);
  assert.equal(MI.relinkCandidate(missing, other(logo, { w: 801 })), null);
  assert.equal(MI.relinkCandidate(missing, other(sea, { dur: sea.dur + 0.04, w: 640, h: 360 })).id, SEA,
    'a video matches by duration, whatever its size');
  assert.equal(MI.relinkCandidate(missing, other(sea, { dur: sea.dur + 0.06 })), null);
  assert.equal(MI.relinkCandidate(missing, other(logo, { anim: true, dur: 1 })), null, 'an animation is not a still');
  assert.equal(MI.relinkCandidate(missing, logo), null, 'the same id is a reconnection, not a stand-in');
  assert.equal(MI.relinkCandidate([], other(logo)), null);
});

test('matchColors: the most saturated colour becomes the accent at ≥ 3:1 on the ground; the next two the shifts', () => {
  const out = MI.matchColors(['#808080', '#e0e0d0', '#FFE000', '#203040'], '#FFFFFF');
  assert.ok(C.contrast(out.accent, '#FFFFFF') >= 3 - 1e-9, out.accent);
  assert.ok(C.hueDistance(out.accent, '#FFE000') < 8, 'the hue stays');
  assert.equal(out.shiftA, '#808080');
  assert.equal(out.shiftB, '#E0E0D0');
  assert.deepEqual(MI.matchColors(['#ff0000'], '#000000'), { accent: '#FF0000' });
  assert.equal(MI.matchColors([], '#000000'), null);
  assert.equal(MI.matchColors(['nope'], '#000000'), null);
  assert.ok(MI.saturation('#ff0000') > MI.saturation('#ff8080'));
});

test('library facts: kinds, badges, info and duration text', () => {
  const t = (k) => ({ 'media.kind.video': '動画', 'media.kind.image': '写真', 'media.kind.anim': 'アニメ', 'media.badge.alpha': '透明' })[k] || k;
  const [logo, sky, sea, glow] = W.doc.media.list;
  assert.equal(MI.infoText(t, sea), '動画 0:12 · 1920×1080');
  assert.equal(MI.infoText(t, logo), '写真 透明 · 800×800');
  assert.equal(MI.infoText(t, glow), '動画 0:04 透明 · 1280×720');
  assert.equal(MI.durText(72.46, true), '1:12.4');
  assert.deepEqual(MI.badgesOf(glow, { gopMean: 10 }), ['alpha', 'gop']);
  assert.deepEqual(MI.badgesOf(Object.assign({}, sea, { codec: 'hvc1.1.6.L93', hdr: true })), ['hevc', 'hdr']);
  assert.deepEqual(MI.badgesOf(Object.assign({}, sky, { mime: 'image/gif', anim: true })), ['gif']);
  assert.equal(MI.kindKey(Object.assign({}, logo, { anim: true })), 'media.kind.anim');
  assert.equal(MI.libraryBytes(W.doc), W.doc.media.list.reduce((n, e) => n + e.bytes, 0));
  // a document loaded without its library (a harness's raw document) reads as an empty one
  const bare = { pins: {} };
  assert.deepEqual(MI.libraryOf(bare), []);
  assert.equal(MI.entryOf(bare, SEA), null);
  assert.equal(MI.moveCmd(bare, SEA, 1), undefined);
  assert.equal(MI.libraryBytes(bare), 0);
  assert.ok(MI.fitsAccept('video', sea) && !MI.fitsAccept('image', sea) && MI.fitsAccept('any', sea));
  assert.ok(MI.fitsAccept('image', logo) && !MI.fitsAccept('video', logo) && !MI.fitsAccept('any', null));
});

// --- the inspector's media rows (§11.7.4, §11.9.5) ---------------------------------------------------------------------

const fieldsOf = (sel, w) => {
  const x = w || W;
  return F.sectionsFor(sel, x.plan, x.registry, x.doc);
};
const rowsOf = (sections) => sections.flatMap((s) => s.fields.map((f) => Object.assign({ section: s.id }, f)));

test('media_widgets: the media param gets the media widget, clipIn/clipOut one trim row, depth a radiogroup under the source', () => {
  assert.equal(F.widgetFor({ type: 'media', accept: 'any' }), 'media');
  for (const w of ['media', 'trim', 'crop']) assert.ok(F.WIDGETS.includes(w), w);
  const sel = { level: 'el', scope: 'line/r5', el: 'ground' };
  const rows = rowsOf(fieldsOf(sel));
  const ground = rows.filter((f) => f.path && f.path.startsWith('ground@photoPan.'));
  assert.equal(ground[0].path, 'ground@photoPan.image');
  assert.equal(ground[0].widget, 'media');
  assert.equal(ground[1].path, 'ground@photoPan.depth');
  assert.equal(ground[1].radio, true);
  assert.equal(ground[1].autoValue, 'auto');
  const trim = rows.find((f) => f.widget === 'trim');
  assert.equal(trim.path, 'ground@photoPan.clipIn');
  assert.equal(trim.trimOut, 'ground@photoPan.clipOut');
  assert.equal(trim.label, 'fld.trim');
  assert.ok(!rows.some((f) => f.path === 'ground@photoPan.clipOut'), 'clipOut is the trim row\'s out handle');
  assert.equal(rows.find((f) => f.path === 'ground@photoPan.cropZoom').widget, 'crop');
  assert.deepEqual(ground[0].media, { kind: 'ground', idx: null, key: 'photoPan', src: 'image', slot: 'ground' });
  // a pinned end is the trim row's out handle, not a row of its own (withPinnedParams)
  const pinned = world((doc) => apply(doc, [set('line/r5:ground@photoPan.clipOut', 3)]));
  const ctx = { page: 'el.ground', scope: 'line/r5', scopeKind: 'line', lineIds: ['r5'], cuts: pinned.plan.cuts.filter((c) => c.line === 'r5'),
    registry: pinned.registry, plan: pinned.plan };
  const withPins = F.withPinnedParams(fieldsOf(sel, pinned), ctx, F.pinnedSlots(ctx, pinned.doc.pins));
  assert.deepEqual(rowsOf(withPins).filter((f) => /clip(In|Out)$/.test(f.path || '')).map((f) => [f.path, f.widget]),
    [['ground@photoPan.clipIn', 'trim']]);
  // rows of other parts come back as they were
  const gen = [{ path: 'ground.amount', widget: 'number', param: null }];
  assert.equal(MW.mediaRows(gen), gen);
});

test('media rows read in plain words: shares in %, ぼかし without a unit, 薄幕の強さ after 薄幕, 重ね方 in words', () => {
  const both = world((d) => apply(d, [set('line/r5:atmos', 'mediaLayer'), set('line/r5:atmos@mediaLayer.src', GLOW)]));
  const rows = rowsOf(fieldsOf({ level: 'el', scope: 'line/r5', el: 'ground' }, both));
  const row = (p) => rows.find((f) => f.path === p);
  for (const p of ['ground@photoPan.zoom', 'ground@photoPan.veil', 'ground@photoPan.tint', 'ground@photoPan.speed', 'atmos@mediaLayer.zoom']) {
    assert.equal(row(p).scale, 100, p);
    assert.equal(row(p).spec.unit, 'pct', p);
    assert.equal(row(p).spec.min, MEDIA.LIMITS.params[p.slice(p.lastIndexOf('.') + 1)][0], p + ' keeps its range');
  }
  assert.equal(row('ground@photoPan.blur').spec.unit, '', 'ぼかし is a plain number');
  assert.equal(row('ground@photoPan.pan').spec.unit, 'deg');
  // a background's shared 強さ only strengthens its veil (photoPan): 薄幕の強さ, right after 薄幕
  const paths = rows.map((f) => f.path);
  assert.equal(paths.indexOf('ground.amount'), paths.indexOf('ground@photoPan.veil') + 1);
  assert.equal(row('ground.amount').label, 'fld.veilAmount');
  assert.equal(row('ground.amount').labelText, undefined);
  assert.equal(row('ground.amount').scale, 100);
  assert.ok(paths.indexOf('ground.amount') > paths.indexOf('ground@photoPan.fit'), 'no longer between 動きと重なり and 収め方');
  assert.equal(row('atmos.amount').label, 'fld.param', 'an overlay\'s 強さ is its own');
  assert.deepEqual(row('atmos@mediaLayer.blend').options.map((o) => o.label),
    ['opt.blend.screen', 'opt.blend.multiply', 'opt.blend.overlay', 'opt.blend.normal']);
  const STR = MV.use('i18n/strings');
  for (const o of row('atmos@mediaLayer.blend').options) assert.ok(STR[o.label], o.label);
  assert.ok(STR['fld.veilAmount'] && STR['sec.overlay']);
});

test('the crop overlay\'s focus and zoom are read against their own params (cropX 0–1), never the 切り抜き row\'s (1–4)', () => {
  const SCH = MV.use('core/schema');
  const media = { kind: 'ground', idx: null, key: 'photoPan', src: 'image', slot: 'ground' };
  const x = MW.paramSpec(W.registry, media, 'cropX');
  assert.deepEqual([x.min, x.max], [0, 1]);
  assert.equal(SCH.coerce(x, 0.51), 0.51, '→ once from the centre stays 0.51');
  assert.equal(SCH.coerce(x, 0.49), 0.49);
  assert.equal(SCH.coerce(MW.paramSpec(W.registry, media, 'cropZoom'), 0.51), 1, 'the zoom\'s own spec clamps to 1');
  assert.deepEqual([MW.paramSpec(W.registry, media, 'clipOut').min, MW.paramSpec(W.registry, media, 'clipOut').max], [0, 3600]);
  // the text page's fill, an overlay (atmos reads the ornament registry), and a part without the param: core/media's limits
  const fill = { kind: 'ornament', idx: 0, key: 'textFill', src: 'src', slot: 'ornament#0' };
  assert.deepEqual([MW.paramSpec(W.registry, fill, 'cropY').min, MW.paramSpec(W.registry, fill, 'cropY').max], [0, 1]);
  assert.equal(MW.paramSpec(W.registry, { kind: 'atmos', idx: null, key: 'mediaLayer', src: 'src', slot: 'atmos' }, 'cropX').max, 1);
  assert.deepEqual(MW.paramSpec(null, null, 'cropX'), { type: 'num', min: 0, max: 1, step: 0.005 });
  assert.equal(MW.paramSpec(null, null, 'nothing'), null);
});

test('the video rows\' when: shown for a video source (their own section), not for a still', () => {
  // r5 shows the work's photoPan with 海辺.mp4
  const video = fieldsOf({ level: 'el', scope: 'line/r5', el: 'ground' });
  const section = video.find((s) => s.id === 'video');
  assert.ok(section, 'a video section');
  assert.deepEqual(section.fields.map((f) => f.path),
    ['ground@photoPan.clipIn', 'ground@photoPan.speed', 'ground@photoPan.loop', 'ground@photoPan.clock']);
  assert.ok(section.fields.every((f) => f.video === true));
  assert.equal(video.findIndex((s) => s.id === 'video'), video.findIndex((s) => s.id === 'ground') + 1, 'right after its part');
  // r2's photoFrame shows ロゴ.png: no video rows
  const still = fieldsOf({ level: 'el', scope: 'line/r2', el: 'ornament', idx: 0 });
  assert.ok(!still.some((s) => s.id === 'video'));
  assert.ok(!rowsOf(still).some((f) => /\.(clipIn|speed|loop|clock)$/.test(f.path || '')));
  assert.ok(rowsOf(still).some((f) => f.path === 'ornament#0@photoFrame.src' && f.widget === 'media'));
  // an animated still counts as timed: the rows come back
  const anim = world((doc) => Object.assign({}, doc, { media: { list: doc.media.list.map((e) => (e.id === LOGO
    ? Object.assign({}, e, { anim: true, dur: 2, fps: 10, frames: 20, mime: 'image/gif' }) : e)) } }));
  assert.deepEqual(fieldsOf({ level: 'el', scope: 'line/r2', el: 'ornament', idx: 0 }, anim).map((s) => s.id), ['list', 'slot', 'video.slot']);
  // a video background and a video overlay: two 動画 sections, each with an id of its own (its open state is its own);
  // 空気（粒子） that shows the overlay reads 重ねる映像
  const both = world((d) => apply(d, [set('line/r5:atmos', 'mediaLayer'), set('line/r5:atmos@mediaLayer.src', GLOW)]));
  const two = fieldsOf({ level: 'el', scope: 'line/r5', el: 'ground' }, both);
  assert.deepEqual(two.map((s) => s.id), ['ground', 'video', 'atmos', 'video.atmos']);
  assert.deepEqual(two.map((s) => s.label[0]), ['sec.ground', 'sec.video', 'sec.overlay', 'sec.video']);
  assert.deepEqual(two[3].fields.map((f) => f.path), ['atmos@mediaLayer.clipIn', 'atmos@mediaLayer.speed', 'atmos@mediaLayer.loop',
    'atmos@mediaLayer.clock']);
  assert.equal(fieldsOf({ level: 'el', scope: 'line/r5', el: 'ground' }).find((s) => s.id === 'atmos').label[0], 'sec.atmos');
  // the when itself
  const media = { kind: 'ground', key: 'photoPan', src: 'image', slot: 'ground' };
  const ctxOf = (id, kind) => ({ plan: { grounds: [{ ground: { v: 'photoPan', p: { image: id } } }], media: { [id]: { kind } } },
    cuts: [{ ground: 0 }] });
  assert.equal(MW.timedIn(ctxOf(SEA, 'video'), media), true);
  assert.equal(MW.timedIn(ctxOf(LOGO, 'image'), media), false);
  assert.equal(MW.timedIn({ plan: null, cuts: [] }, media), false);
});

test('the text page offers 文字の中に写真 on the first free ornament; its fit and zoom only once it is set', () => {
  const on = (scope, w) => rowsOf(fieldsOf({ level: 'el', scope, el: 'text' }, w)).filter((f) => /@textFill\./.test(f.path || ''));
  // r5: #0 shows an automatic decoration and #1 is a material; r2: #0 is the user's frame and #1 automatic: #2 on both
  assert.deepEqual(on('line/r5').map((f) => [f.path, f.widget]), [['ornament#2@textFill.src', 'media']]);
  assert.deepEqual(on('line/r2').map((f) => f.path), ['ornament#2@textFill.src']);
  const filled = world((doc) => apply(doc, [set('line/r5:ornament#2', 'textFill'), set('line/r5:ornament#2@textFill.src', LOGO)]));
  assert.deepEqual(on('line/r5', filled).map((f) => [f.path, f.widget]),
    [['ornament#2@textFill.src', 'media'], ['ornament#2@textFill.fit', 'choice'], ['ornament#2@textFill.cropZoom', 'crop']]);
  assert.deepEqual(ornamentsOf(filled.plan, 'r5').map((o) => o.slice(0, 2)), ornamentsOf(W.plan, 'r5').map((o) => o.slice(0, 2)),
    'the decorations the line showed stay');
  // a scope whose three slots are taken has no row
  const full = world((doc) => apply(doc, [0, 1, 2].map((i) => set('line/r3:ornament#' + i, 'photoFrame'))));
  assert.deepEqual(on('line/r3', full), []);
});

test('文字の中に写真 at 要素の既定 stays on the slot pinned to textFill there when one line picks another decoration in it', () => {
  const text = { level: 'el', scope: 'work', el: 'text' };
  const on = (w) => rowsOf(fieldsOf(text, w)).filter((f) => /@textFill\./.test(f.path || '')).map((f) => f.path);
  const rows = ['ornament#2@textFill.src', 'ornament#2@textFill.fit', 'ornament#2@textFill.cropZoom'];
  const fill = [set('work:ornament#2', 'textFill'), set('work:ornament#2@textFill.src', LOGO)];
  const filled = world((doc) => apply(doc, fill));
  const ctx0 = F.contextOf(text, filled.plan, filled.registry, filled.doc);
  assert.deepEqual([ctx0.textFillIdx, ctx0.textFillOn], [2, true]);
  assert.deepEqual(on(filled), rows);
  // line 3 shows a seal in that slot: the work's picture still fills the text of the other lines, and the row keeps it
  const narrowed = world((doc) => apply(doc, fill.concat([set('line/r3:ornament#2', 'hankoSeal')])));
  assert.ok(narrowed.plan.cuts.some((c) => c.line === 'r3' && c.slots['ornament#2'] && c.slots['ornament#2'].v === 'hankoSeal'));
  assert.ok(narrowed.plan.cuts.some((c) => c.line !== 'r3' && c.slots['ornament#2'] && c.slots['ornament#2'].v === 'textFill'));
  const ctx = F.contextOf(text, narrowed.plan, narrowed.registry, narrowed.doc);
  assert.deepEqual([ctx.textFillIdx, ctx.textFillOn], [2, true], 'not the free slot #0 with なし');
  assert.deepEqual(on(narrowed), rows, 'with its fit and crop rows');
  // a line page follows its own scope: line 3 pins the seal there, so its row goes to a free slot
  assert.equal(F.contextOf({ level: 'el', scope: 'line/r3', el: 'text' }, narrowed.plan, narrowed.registry, narrowed.doc).textFillOn, false);
});

test('the work page has 写真・動画 after 見た目, open while the library has assets', () => {
  const sections = fieldsOf(S.WORK);
  const ids = sections.map((s) => s.id);
  assert.equal(ids.indexOf('media'), ids.indexOf('look') + 1);
  assert.equal(sections.find((s) => s.id === 'media').open, true);
  assert.equal(sections.find((s) => s.id === 'media').custom, 'media');
  const empty = world((doc) => apply(doc, doc.media.list.map((e) => ({ t: 'media.remove', id: e.id }))));
  assert.equal(fieldsOf(S.WORK, empty).find((s) => s.id === 'media').open, false);
});

test('the part browser hides derived grounds from its lists by the strict media flag', () => {
  const key = MEDIA.keyOf(SKY);
  assert.equal(PB.isDerivedMedia(W.registry, key), true);
  assert.equal(PB.isDerivedMedia(W.registry, 'photoPan'), false);
  assert.equal(PB.isDerivedMedia({ extra: { [key]: { media: 'yes' } } }, key), false, 'only media === true');
  assert.equal(PB.isDerivedMedia({ extra: { [key]: { media: 1 } } }, key), false);
  assert.equal(PB.isDerivedMedia(null, key), false);
});

test('trim maths: a handle steps one source frame, to a value of the param\'s 0.01 s step that still means that frame', () => {
  const pts = Array.from({ length: 45 }, (_, i) => i / 30);          // 1.5 s at 30 fps
  const D = 1.5, Q = 0.01;
  // the start: the next frame's start, rounded up (0.0333 → 0.04 still shows frame 1); three steps are three frames
  let a = 0;
  const shown = (x) => pts.filter((p) => p <= x + 1e-9).length - 1;
  for (let k = 1; k <= 3; k++) { a = MW.stepFrame(a, 1, pts, 30, D, Q, 'in'); assert.equal(shown(a), k, 'in ×' + k + ' = ' + a); }
  assert.equal(a, 0.1);
  a = MW.stepFrame(a, -1, pts, 30, D, Q, 'in');
  assert.equal(a, 0.07);
  assert.equal(shown(a), 2);
  assert.equal(MW.stepFrame(0.04, -1, pts, 30, D, Q, 'in'), 0);
  assert.equal(MW.stepFrame(1.47, 1, pts, 30, D, Q, 'in'), D, 'past the last frame is the end');
  // the end: one frame fewer, rounded down (1.4667 → 1.46 still leaves frame 44 out)
  const before = (x) => pts.filter((p) => p < x - 1e-9).length;
  let b = MW.stepFrame(D, -1, pts, 30, D, Q, 'out');
  assert.equal(b, 1.46);
  assert.equal(before(b), 44);
  b = MW.stepFrame(b, -1, pts, 30, D, Q, 'out');
  assert.equal(before(b), 43);
  assert.equal(MW.stepFrame(b, 1, pts, 30, D, Q, 'out'), 1.46);
  assert.equal(MW.stepFrame(1.46, 1, pts, 30, D, Q, 'out'), D);
  // without a table: by 1 / fps; without a step: the exact frame time
  assert.equal(MW.stepFrame(0, 1, null, 25, 2, Q, 'in'), 0.04);
  assert.ok(Math.abs(MW.stepFrame(1, 1, null, 30, 10, 0, 'in') - 31 / 30) < 1e-6);
  assert.equal(MW.stepFrame(9.99, 1, null, 30, 10, Q, 'in'), 10);
  assert.equal(MW.stepFrame(2, -1, null, 25, 2, Q, 'out'), 1.96);
  assert.deepEqual(MW.rangeOf(1, 0, 12), { a: 1, b: 12 }, 'clipOut 0 is the end');
  assert.deepEqual(MW.rangeOf(2, 5, 12), { a: 2, b: 5 });
  assert.deepEqual(MW.rangeOf(2, 1, 12), { a: 2, b: 12 });
  assert.deepEqual(MW.rangeOf(-1, 40, 12), { a: 0, b: 12 });
  assert.equal(MW.shownId(SEA), SEA);
  assert.equal(MW.shownId(''), null);
});

// --- the palette (Ctrl+K) -----------------------------------------------------------------------------------------------

test('the palette: a search for 写真 lists the import first and the command that clears the device last', () => {
  const PAL = MV.use('ui/palette');
  const items = [
    { id: 'file.clearDevice', text: 'この端末に保存した作品・曲・写真・動画を消す' }, { id: 'media.library', text: '写真・動画の一覧' },
    { id: 'media.relink', text: '写真・動画をつなぎ直す…' }, { id: 'pref.ai', text: 'AIを使う' }, { id: 'help.about', text: 'このアプリについて（写真）' },
    { id: 'media.import', text: '写真・動画を読み込む…' },
  ];
  assert.deepEqual(PAL.order(items, [], '写真').map((x) => x.id),
    ['media.import', 'media.library', 'media.relink', 'help.about', 'pref.ai', 'file.clearDevice']);
  assert.deepEqual(PAL.order(items, ['file.clearDevice'], '').slice(-1).map((x) => x.id), ['file.clearDevice'], 'even when used lately');
});

// --- step ④ (§11.7.8, §11.7.9) ----------------------------------------------------------------------------------------

test('preflight: a missing asset blocks with [つなぎ直す]; skipped backgrounds, HDR and heavy clips are notes', () => {
  const { doc, plan } = W;
  const here = () => 'ok';
  assert.deepEqual(MI.preflight(doc, plan, here), []);
  const gone = MI.preflight(doc, plan, (id) => (id === SEA ? 'missing' : 'ok'));
  assert.deepEqual(gone, [{ code: 'media-missing', level: 'block', params: { name: '海辺.mp4' }, jump: { action: 'media.library' } }],
    '[つなぎ直す] opens the library, where the missing rows are (§11.7.8)');
  assert.deepEqual(MI.preflight(doc, plan, (id) => (id === GLOW ? 'missing' : 'ok')), [], 'an asset the plan does not show never blocks');
  // an asset drawn only through a material (マイ素材 with a media layer) is in plan.media but in no decision's params:
  // missing, it still blocks
  const viaMaterial = world((d) => apply(d, [{ t: 'pin.clear', path: 'work:ground' }, { t: 'pin.clear', path: 'work:ground@photoPan.image' }]));
  assert.ok(viaMaterial.plan.media[SEA], 'the plan draws 海辺.mp4 through material m1');
  assert.ok(!MI.mediaUses(viaMaterial.plan).some((u) => u.id === SEA), 'no decision param names it');
  assert.deepEqual(MI.preflight(viaMaterial.doc, viaMaterial.plan, (id) => (id === SEA ? 'missing' : 'ok')).map((i) => [i.code, i.level, i.params.name]),
    [['media-missing', 'block', '海辺.mp4']]);
  const hdrMat = world((d) => Object.assign(apply(d, [{ t: 'pin.clear', path: 'work:ground' }, { t: 'pin.clear', path: 'work:ground@photoPan.image' }]),
    { media: { list: d.media.list.map((e) => (e.id === SEA ? Object.assign({}, e, { hdr: true }) : e)) } }));
  assert.deepEqual(MI.preflight(hdrMat.doc, hdrMat.plan, here).map((i) => i.code), ['media-hdr'], 'HDR too');
  // the backdrop the export renders (ui/output.effectiveBackdrop) decides: a transparent WebM leaves the background
  // video out whatever the look says; an MP4 draws it even when an older file says 透明
  const look = (d, backdrop, format) => Object.assign({}, d, { look: Object.assign({}, d.look, { backdrop }),
    output: Object.assign({}, d.output, { format }) });
  const webm = world((d) => look(d, 'scene', 'webmAlpha'));
  assert.deepEqual(MI.preflight(webm.doc, webm.plan, here), [{ code: 'media-skipped', level: 'info', params: { bg: 'clear' } }]);
  const mp4 = world((d) => look(d, 'clear', 'mp4'));
  assert.deepEqual(MI.preflight(mp4.doc, mp4.plan, here), [], 'an MP4 draws the background (effective backdrop scene)');
  const black = world((d) => look(d, 'black', 'mp4'));
  assert.deepEqual(MI.preflight(black.doc, black.plan, here), [{ code: 'media-skipped', level: 'info', params: { bg: 'black' } }]);
  const framesOnly = world((d) => Object.assign(apply(d, [{ t: 'pin.clear', path: 'work:ground' }, { t: 'pin.clear', path: 'work:ground@photoPan.image' },
    { t: 'pin.clear', path: 'line/r3:ground' }]), { look: Object.assign({}, d.look, { backdrop: 'black' }) }));
  assert.ok(!MI.preflight(framesOnly.doc, framesOnly.plan, here).some((i) => i.code === 'media-skipped'),
    'only background and overlay media are skipped');
  // HDR, and speed × fps above 240 (a 120 fps clip at ×2.5; ×2 is exactly 240)
  const fast = (d, speed) => apply(Object.assign({}, d, { media: { list: d.media.list.map((e) => (e.id === SEA
    ? Object.assign({}, e, { hdr: speed > 2, fps: 120, frames: Math.round(e.dur * 120) }) : e)) } }), [set('work:ground@photoPan.speed', speed)]);
  const hot = world((d) => fast(d, 2.5));
  assert.deepEqual(MI.preflight(hot.doc, hot.plan, here), [
    { code: 'media-hdr', level: 'info', params: { name: '海辺.mp4' } },
    { code: 'media-heavy', level: 'info', params: { s: 2.5, name: '海辺.mp4' } },
  ]);
  const calm = world((d) => fast(d, 2));
  assert.deepEqual(MI.preflight(calm.doc, calm.plan, here), []);
  assert.deepEqual(MI.mediaUses(plan).filter((u) => u.id === LOGO).map((u) => u.slot), ['ornament#0', 'ornament#0']);
});

// --- 写真の説明 (§11.6.2): the consent, the request, the review and apply --------------------------------------------------

test('describeMedia: a consent every time pictures are sent; the JPEGs go before the prompt; the review writes the description', async () => {
  const AC = MV.use('ui/ai_controller');
  const ST = MV.use('core/store');
  const D = MV.use('core/doc');
  const T = MV.use('i18n/t');
  const STRINGS = MV.use('i18n/strings');
  const reg = corpus.stubRegistry(MV);
  let doc = CMD.reduce(D.defaultDoc(), { t: 'lyrics.set', text: '夜明けの街を走る\n君の名前を呼ぶ' });
  for (const entry of W.doc.media.list) doc = CMD.reduce(doc, { t: 'media.put', entry: Object.assign({}, entry, { ai: null }) });
  const store = ST.createStore({ doc, side: D.defaultSide(), reduce: CMD.reduce });
  const log = { asked: [], opened: 0, toasts: [], parts: [] };
  let yes = false;
  const host = {
    t: T.createT('ja', STRINGS, reg, { strict: true }), lang: 'ja', registry: reg, song: () => null,
    get doc() { return store.doc; }, get plan() { return PL.plan(store.doc, { registry: reg }); }, get rev() { return store.rev; },
    get side() { return store.side; }, batch: (meta, cmds) => store.batch(meta, cmds), setSide: (fn) => store.setSide(fn),
    undo: () => store.undo(), toast: (text) => log.toasts.push(text), setReviewOpen: () => {}, tryOn: () => {}, altShown: () => false,
    now: () => 1700000000000, nextFrame: () => Promise.resolve(),
    confirm: async (o) => { log.asked.push(o.text); return yes; }, openAi: () => { log.opened++; },
    mediaHere: (id) => id !== GLOW, visionKb: () => 88,
    visionParts: async (ids) => { log.parts.push(ids.slice()); return ids.map((id) => ({ id, parts: [{ inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } }] })); },
  };
  const seen = [];
  const answerOf = (json) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(json) }] } }],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }) });
  const fetchImpl = async (url, init) => {
    seen.push(JSON.parse(init.body));
    return answerOf({ items: [{ n: 0, caption: '夕方の海', captionEn: 'Evening sea', tags: ['soft'], colors: ['#F2A65A'],
      subject: { x: 0, y: 0, w: 0, h: 0 }, text: { x: 0, y: 0, w: 1, h: 0.3 }, use: 'ground', depth: 'back', reason: '細部が多い' }] });
  };
  const session = new Map([['mojipv.ai.key.gemini', 'AIza' + 'x'.repeat(35)]]);
  const storage = { getItem: (k) => (session.has(k) ? session.get(k) : null), setItem: (k, v) => session.set(k, v), removeItem: (k) => session.delete(k) };
  const ctl = AC.createController(host, { session: storage, local: null, fetchImpl, vision: MV.use('ai/vision') });
  assert.equal(ctl.blocked('vision'), null, 'no lyrics or plan needed beyond the key');
  // only pictures that are not on this device: it says so; nothing is asked or sent
  assert.equal(await ctl.describeMedia([GLOW]), false);
  assert.deepEqual(log.toasts, [host.t('ai.visionMissing')]);
  assert.equal(log.asked.length, 0);
  log.toasts.length = 0;
  // no consent: nothing is sent
  assert.equal(await ctl.describeMedia([SEA]), false);
  assert.equal(log.asked.length, 1);
  assert.ok(log.asked[0].includes('約88KB') && log.asked[0].includes('Google Gemini'), log.asked[0]);
  // the consent states what is sent: 768 px JPEGs, three frames of a video or an animation (media_io.isTimed sends
  // an animated GIF or WebP as three frames too), no file names, asked every time; the notice says the same
  assert.ok(['768px', 'JPEG', '動画・アニメは3枚', 'ファイル名は送りません', '送るたびに'].every((w) => log.asked[0].includes(w)), log.asked[0]);
  const tEn = T.createT('en', STRINGS, reg, { strict: true });
  const en = tEn('ai.visionConsent', { kb: 88 });
  assert.ok(['768 px', 'about 88 KB per image', 'a video or animation sends 3 frames', 'File names are not sent', 'every time'].every((w) => en.includes(w)), en);
  assert.ok(host.t('ai.sendsMedia').includes('動画・アニメは3枚'), host.t('ai.sendsMedia'));
  assert.ok(tEn('ai.sendsMedia').includes('3 for a video or animation'), tEn('ai.sendsMedia'));
  assert.ok(MI.isTimed({ kind: 'image', anim: true }) && MI.isTimed({ kind: 'video' }) && !MI.isTimed({ kind: 'image' }),
    'the wording covers exactly what sends 3 frames');
  assert.equal(seen.length, 0);
  assert.deepEqual(log.parts, []);
  // consent: the asset on this device only (きらめき.webm is not), the images first, no lyrics in the prompt
  yes = true;
  assert.equal(await ctl.describeMedia([SEA, GLOW]), true);
  assert.deepEqual(log.parts, [[SEA]]);
  assert.equal(seen.length, 1);
  const parts = seen[0].contents[0].parts;
  assert.deepEqual(parts[0], { inline_data: { mime_type: 'image/jpeg', data: 'QUJD' } });
  assert.ok(!JSON.stringify(seen[0]).includes('夜明け'), 'the lyrics are not sent');
  assert.equal(log.opened, 1, 'the AI tab shows the run and the review');
  const r = ctl.state.review;
  assert.equal(r.tool, 'vision');
  assert.deepEqual(r.changes.map((c) => [c.kind, c.assetId, c.depth]), [['media', SEA, 'back']]);
  for (const lang of ['ja', 'en']) assert.ok(CH.describe(r.changes[0], T.createT(lang, STRINGS, reg, { strict: true })));
  assert.equal(ctl.apply(), 1);
  const ai = store.doc.media.list.find((e) => e.id === SEA).ai;
  assert.equal(ai.depth, 'back');
  assert.deepEqual(ai.caption, { ja: '夕方の海', en: 'Evening sea' });
  // asked every time: nothing is remembered, a no sends nothing, and a run without that consent sends nothing either
  const asked = log.asked.length;
  yes = false;
  assert.equal(await ctl.describeMedia([SEA]), false);
  assert.equal(log.asked.length, asked + 1, 'a second question for the same asset');
  assert.equal(seen.length, 1, 'nothing is sent without it');
  assert.equal(await ctl.run('vision', { ids: [SEA] }), false, 'the vision tool sends only what was just agreed');
  assert.equal(seen.length, 1);
  yes = true;
  assert.equal(await ctl.describeMedia([SEA]), true);
  assert.equal(log.asked.length, asked + 2);
  assert.equal(seen.length, 2);
  ctl.discard();
  assert.equal(await ctl.run('vision', { ids: [SEA] }), false, 'the consent held for that one run');
  assert.equal(seen.length, 2);
  ctl.projectChanged();
  yes = false;
  assert.equal(await ctl.describeMedia([SEA]), false);
  assert.equal(log.asked.length, asked + 3);
  // the second service cannot describe pictures
  session.set('mojipv.ai.key.claude', 'sk-ant-' + 'y'.repeat(40));
  ctl.setProvider('claude');
  assert.equal(ctl.blocked('vision'), 'ai.visionOnlyGemini');
  const without = AC.createController(host, { session: storage, local: null, fetchImpl });
  assert.equal(without.blocked('vision'), 'boot.soon');
});

test('the pictures for 写真の説明: 768 px on the long side at most, never enlarged; a video\'s frames from the range it is used in', () => {
  assert.deepEqual(MI.visionSize(4032, 3024), { w: 768, h: 576 });
  assert.deepEqual(MI.visionSize(1080, 1920), { w: 432, h: 768 });
  assert.deepEqual(MI.visionSize(300, 200), { w: 300, h: 200 });
  assert.equal(MI.visionKb([{ w: 4032, h: 3024 }, { w: 300, h: 200 }]), Math.round(768 * 576 * 0.2 / 1024));
  // 海辺.mp4 (12.512 s) is the work's background: the whole clip, then the range its pins give
  assert.deepEqual(MI.usedRange(W.plan, SEA, 12.512), { a: 0, b: 12.512 });
  const trimmed = world((d) => apply(d, [set('work:ground@photoPan.clipIn', 2.5), set('work:ground@photoPan.clipOut', 6)]));
  assert.deepEqual(MI.usedRange(trimmed.plan, SEA, 12.512), { a: 2.5, b: 6 });
  const toEnd = world((d) => apply(d, [set('work:ground@photoPan.clipIn', 2.5)]));
  assert.deepEqual(MI.usedRange(toEnd.plan, SEA, 12.512), { a: 2.5, b: 12.512 }, 'clipOut 0 is the end');
  assert.deepEqual(MI.usedRange(W.plan, GLOW, 4), { a: 0, b: 4 }, 'an asset the plan does not show: the whole clip');
  assert.deepEqual(MI.usedRange(null, SEA, 3), { a: 0, b: 3 });
});
