/* 文字PVメーカー v2 — original work. New compositions: complete readable lyrics, deterministic seeking and textless musical scenes. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');

const MV = load();
const DOC = MV.use('core/doc'), S = MV.use('core/script'), SCH = MV.use('core/schema'), RNG = MV.use('core/rng');
const BUILD = MV.use('engine/scene/build'), FRAME = MV.use('engine/scene/frame'), TABLE = MV.use('engine/scene/table');
const RECORD = MV.use('engine/render/record'), FACES = MV.use('engine/text/faces');
const REG = MV.use('parts/catalog').defaultRegistry();
const { createTextService } = MV.use('engine/text/service'), { fakeMeasurer } = MV.use('engine/text/fake_measure');
const LYRICS = MV.use('parts/arrange/storybook').map((d) => d.key);
const INTERLUDES = ['prismFan', 'orbitMoons', 'ribbonWeave', 'shutterBloom', 'constellationMesh', 'paperDrift'];
const TEXTS = ['君の名前を呼ぶ声が届くまで、ずっと歩いていく', 'Paper planes in the morning light',
  '❤️。ありがとう🇯🇵！家族👨‍👩‍👧、いつも1️⃣', '君とLove songをもう一度', '愛'];

function sceneOf(key, o = {}) {
  const aspect = o.aspect || '16:9', [w, h] = DOC.DESIGN_SIZE[aspect], interlude = INTERLUDES.includes(key);
  const text = interlude ? '' : o.text || TEXTS[0], lang = S.lineScript(text || 'あ', 'ja');
  const dur = o.dur || 8, role = interlude ? 'interlude' : 'lyric';
  const feat = { cells: S.cells(text), graphemes: S.graphemes(text).length, script: lang, latin: 0, orients: ['h', 'v'],
    words: 4, units: { glyph: S.graphemes(text).length, word: 4, line: 1 }, emph: true, impact: false,
    dur, cps: S.cells(text) / dur, energy: 0.5, beat: o.beats === false ? 0 : 0.5, onBeat: false,
    section: null, repeatOf: null, pos: 0.42, role };
  const theme = REG.get('theme', REG.fallback('theme')), mood = REG.get('mood', REG.fallback('mood'));
  const faces = FACES.resolveFaces(theme, null, ['ja', 'en']);
  const look = { mood: { v: mood.key, from: 'auto' }, theme: { v: theme.key, from: 'auto' }, season: { v: 'any', from: 'auto' },
    amounts: Object.assign({}, mood.amounts), amountsFrom: {}, palette: Object.assign({}, theme.swatch), faces,
    texture: null, backdrop: 'scene' };
  const choose = (kind, k) => ({ v: k, from: 'auto', p: Object.fromEntries(REG.params(kind, k).map(({ name, spec }) =>
    [name, kind === 'arrange' && o.params && o.params[name] !== undefined ? SCH.coerce(spec, o.params[name])
      : SCH.autoValue(spec, { f: feat, look: { amounts: look.amounts, mood, bpm: 120 }, rng: RNG.stream(917, kind, name) })])) });
  const slots = { orient: { v: o.orient || 'h', from: 'auto' }, arrange: choose('arrange', key),
    'text.face': { v: 'display', from: 'auto' }, 'text.scale': { v: o.scale || 1, from: 'auto' },
    'text.ink': { v: 'ink', from: 'auto' }, 'text.style': { v: 'plain', from: 'auto' },
    arrive: choose('arrive', REG.fallback('arrive')), dwell: choose('dwell', 'stillHold'),
    depart: choose('depart', REG.fallback('depart')), lens: choose('lens', REG.fallback('lens')),
    'ornament.count': { v: 0, from: 'auto' }, 'filter.count': { v: 0, from: 'auto' } };
  const cut = { key: 'r1~0', line: interlude ? null : 'r1', role, text, emph: text.length > 3 ? [[0, 2]] : [],
    impact: false, note: o.note || null, t0: 1, t1: 1 + dur, a: 0.88, b: 1.25 + dur, repT: 1.5,
    lang, feat, fp: 'new-arrange-' + key, slots, els: {}, ground: 0, seamIn: -1 };
  const plan = { v: 1, hash: '', duration: cut.b + 1, design: { aspect, w, h, short: 1080 }, look,
    beats: o.beats === false ? null : { bpm: 120, offset: 0.1, meter: 4 },
    lines: [], cuts: [cut], grounds: [], seams: [], impulses: [], warnings: [] };
  if (o.music !== false) {
    const env = new Float32Array(Math.ceil(plan.duration * 20) + 2);
    for (let i = 0; i < env.length; i++) env[i] = i / 20 < 1 + dur / 2 ? 0.2 : 0.9;
    Object.defineProperty(plan, 'env', { value: env });
  }
  const textService = createTextService({ measurer: fakeMeasurer(), faces });
  return { plan, scene: BUILD.buildCut(cut, plan, { registry: REG, text: textService, strict: true }) };
}

function frameOf(x, t) {
  const rec = RECORD.createRecorder(), { w, h } = x.plan.design;
  const surf = RECORD.surfaceOf(rec.factory, w, h, false);
  FRAME.evaluate(x.scene, t);
  RECORD.drawScene(surf.ctx, x.scene, { scale: 1, W: w, H: h, pal: x.plan.look.palette, tl: t });
  return { ops: rec.ops(), stats: rec.stats() };
}

function inkBounds(scene) {
  const m = TABLE.restWorld(scene.table).m;
  return scene.runs.map((r) => {
    const b = r.layout.box, n = r.node * 6, corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]];
    const xs = corners.map(([x, y]) => m[n] * x + m[n + 2] * y + m[n + 4]);
    const ys = corners.map(([x, y]) => m[n + 1] * x + m[n + 3] * y + m[n + 5]);
    return { x: Math.min(...xs), y: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  });
}

test('new presets enter the appropriate automatic pools with bilingual labels and no textless lyrics', () => {
  assert.equal(LYRICS.length, 10);
  for (const key of LYRICS) {
    for (const orient of ['h', 'v']) assert.ok(REG.pool('arrange', { role: 'lyric', orient }).includes(key), key + ' ' + orient);
    assert.ok(REG.get('arrange', key).label.ja && REG.get('arrange', key).label.en);
  }
  for (const key of INTERLUDES) {
    assert.ok(REG.pool('arrange', { role: 'interlude' }).includes(key), key);
    assert.ok(!REG.pool('arrange', { role: 'lyric' }).includes(key), key + ': no lyric slot');
  }
});

test('all new lyric layouts preserve whole graphemes in reading order, emphasis offsets and notes', () => {
  for (const key of LYRICS) for (const text of TEXTS.concat([TEXTS[0].repeat(4)])) for (const orient of ['h', 'v']) {
    const { scene } = sceneOf(key, { text, orient, note: 'ひかりの方へ' });
    const own = scene.runs.filter((r) => r.spec.span), drawn = own.flatMap((r) => r.layout.ch).filter((g) => !/^\s+$/.test(g));
    const want = S.graphemes(text).filter((g) => !/^\s+$/.test(g));
    assert.deepEqual(drawn, want, key + ' ' + orient + ': every grapheme exactly once');
    assert.ok(scene.runs.some((r) => r.spec.text === 'ひかりの方へ'), key + ': note');
    for (const r of own) {
      for (let i = 0; i < r.layout.n; i++) assert.equal(r.layout.emph[i] > 0, r.layout.off[i] < 2 && text.length > 3,
        key + ': emphasis stays on the source range');
    }
  }
});

test('new lyric text remains inside every aspect at both parameter extremes and larger text scales', () => {
  for (const key of LYRICS) for (const aspect of DOC.ASPECTS) for (const orient of ['h', 'v']) {
    const params = REG.params('arrange', key).filter(({ name }) => !['offsetX', 'offsetY'].includes(name));
    for (const side of ['min', 'max']) {
      const pinned = Object.fromEntries(params.map(({ name, spec }) => [name, spec[side]]));
      const x = sceneOf(key, { aspect, orient, params: pinned, text: TEXTS[0], note: 'ひかりの方へ', scale: 1.8 });
      for (const b of inkBounds(x.scene)) assert.ok(b.x >= 53.5 && b.y >= 53.5 && b.x1 <= x.plan.design.w - 53.5 && b.y1 <= x.plan.design.h - 53.5,
        key + ' ' + aspect + ' ' + orient + ' ' + side + ': ' + JSON.stringify(b));
      assert.ok(!x.scene.warnings.some((w) => w.code === 'overfull'), key + ': fitted');
    }
  }
});

test('new presets draw deterministically after reverse seeks with finite, balanced and modest frame work', () => {
  for (const key of LYRICS.concat(INTERLUDES)) {
    const x = sceneOf(key), expected = frameOf(x, 3);
    frameOf(x, 7.5); frameOf(x, 0.16);
    assert.deepEqual(frameOf(x, 3).ops, expected.ops, key + ': seeking');
    assert.ok(expected.stats.balanced, key + ': balanced');
    assert.equal(expected.stats.nan, 0, key + ': finite');
    assert.equal(expected.stats.alphaBad, 0, key + ': alpha');
    assert.ok(expected.ops.length < 2200, key + ': bounded draw calls ' + expected.ops.length);
  }
});

test('new interludes are textless mid-layer scenes that fade out before the next lyric', () => {
  for (const key of INTERLUDES) {
    const x = sceneOf(key, { note: 'chorus' }), d = x.scene.stores.paint[0].data;
    assert.equal(x.scene.runs.length, 0, key + ': no labels or notes');
    assert.equal(x.scene.target.to - x.scene.target.from, 0, key + ': no glyphs');
    for (let i = 0; i < x.scene.table.n; i++) assert.notEqual(TABLE.LAYERS[x.scene.table.layer[i]].name, 'near', key);
    const drawn = (t) => frameOf(x, t).ops.filter((op) => ['fill', 'stroke', 'fillText'].includes(op[1])).length;
    assert.equal(drawn(d.s0 - 0.01), 0, key + ': waits for previous lyric');
    assert.ok(drawn(3) > 0, key + ': visible hold');
    assert.equal(drawn(d.hEnd + d.endSpan + 0.01), 0, key + ': hands over');
  }
});

test('new interludes animate without a song, react to real music and retain their seed when sliders change', () => {
  for (const key of INTERLUDES) {
    const quiet = sceneOf(key, { music: false, beats: false });
    assert.notDeepEqual(frameOf(quiet, 2).ops, frameOf(quiet, 4).ops, key + ': floats without audio');
    const music = sceneOf(key, { params: { shape: '1,1,1,1,1' } });
    const noMusic = sceneOf(key, { music: false, params: { shape: '1,1,1,1,1' } });
    assert.notDeepEqual(frameOf(music, 6).ops, frameOf(noMusic, 6).ops, key + ': musical response');
    const a = sceneOf(key, { params: { react: 0 } }).scene.stores.paint[0].data;
    const b = sceneOf(key, { params: { react: 1 } }).scene.stores.paint[0].data;
    assert.equal(a.phase, b.phase, key + ': phase'); assert.equal(a.spin, b.spin, key + ': direction');
    assert.deepEqual(a.px, b.px, key + ': positions'); assert.deepEqual(a.py, b.py, key + ': positions');
  }
});
