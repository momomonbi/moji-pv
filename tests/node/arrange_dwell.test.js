/* 文字PVメーカー v2 — original work. Tests: the composition (arrange) and hold (dwell) catalog of WP5a1 — DESIGN §5.1, §5.3 and the picture of each part. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

// conformance.test.js runs every part through the §8.2 matrix (no throw, no NaN, balanced drawing, identity rule,
// dwell envelope, determinism, budgets). This file checks what that matrix cannot see: the §5 tables, the traits the
// planner relies on, and the pictures themselves — text inside the safe area over seeded autos and pinned values, no
// text ever dropped, special cuts, notes, offsets, focus, backdrop-safe autos, and holds that move the block as one
// piece without leaving the decorations they would slide off.

const MV = load();
const H = MV.use('core/hash');
const RNG = MV.use('core/rng');
const SCH = MV.use('core/schema');
const S = MV.use('core/script');
const DOC = MV.use('core/doc');
const REG = MV.use('core/registry');
const FACES = MV.use('engine/text/faces');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');
const BUILD = MV.use('engine/scene/build');
const F = MV.use('engine/scene/frame');
const T = MV.use('engine/scene/table');
const PLAN = MV.use('planner/plan');

const MODULES = { arrange: ['core', 'columns', 'editorial', 'scatter', 'special'], dwell: ['calm', 'lively'] };
const OWN = Object.entries(MODULES).flatMap(([kind, files]) => files.flatMap((f) => MV.use('parts/' + kind + '/' + f)));
const HOSTS = corpus.minimalFallbacks().filter((d) => d.kind !== 'arrange' && d.kind !== 'dwell');
const REGISTRY = REG.createRegistry(OWN.concat(HOSTS));
const TEXT = createTextService({ measurer: fakeMeasurer(), faces: null });
const TEXTS = ['はじまりの朝', '君の名前を呼ぶ声が届くまで', 'Paper planes in the morning light', 'ちょっと待ってよー、20回目の「さよなら」'];

// --- the §5 tables -----------------------------------------------------------------------------------------------

const DESIGN = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'DESIGN.md'), 'utf8');

function tableRows(heading) {
  const from = DESIGN.indexOf(heading);
  const chunk = DESIGN.slice(from, DESIGN.indexOf('\n### ', from + 1));
  const cells = (line) => line.split('|').slice(1, -1).map((s) => s.trim());
  return chunk.split('\n').filter((l) => l.startsWith('| `')).map((l) => {
    const c = cells(l);
    return { key: /`(\w+)`/.exec(c[0])[1], ja: c[1], en: c[2], tags: c[3].split(/\s+/).filter(Boolean), fallback: c[0].includes('(fb)') };
  });
}

test('every §5.1 composition and §5.3 hold is defined once, with the table’s labels, tags and fallback', () => {
  for (const [kind, heading] of [['arrange', '### 5.1 Compositions'], ['dwell', '### 5.3 Holds']]) {
    const rows = tableRows(heading);
    assert.equal(rows.length, kind === 'arrange' ? 21 : 10, heading);
    assert.deepEqual(REGISTRY.keys(kind), rows.map((r) => r.key).sort(), kind + ': exactly the table’s keys');
    for (const r of rows) {
      const def = REGISTRY.get(kind, r.key);
      assert.deepEqual(def.label, { ja: r.ja, en: r.en }, r.key + ' label');
      assert.deepEqual(def.tags.slice().sort(), r.tags.slice().sort(), r.key + ' tags');
      assert.equal(def.fallback, r.fallback, r.key + ' fallback');
      assert.ok(/[。.]$/.test(def.blurb.ja) === false && def.blurb.en.split(/[.!?] /).length === 1, r.key + ': one-sentence blurb');
    }
  }
  assert.doesNotThrow(() => REG.createRegistry(OWN.concat(HOSTS), { strict: true }));
});

test('traits the planner relies on: special roles, vertical-only and horizontal-only parts, the ticker owns its motion', () => {
  const roles = (key) => REGISTRY.traits('arrange', key).roles;
  assert.deepEqual(roles('titlePlate'), ['title']);
  assert.deepEqual(roles('breathMark'), ['interlude']);
  assert.deepEqual(roles('creditFold'), ['outro']);
  for (const role of ['title', 'interlude', 'outro']) assert.ok(REGISTRY.pool('arrange', { role }).length > 0, role + ' has a composition');
  for (const key of ['pillarColumns', 'spineColumn']) assert.deepEqual(REGISTRY.traits('arrange', key).orient, ['v'], key);
  for (const key of ['magazineHead', 'haloRing']) assert.deepEqual(REGISTRY.traits('arrange', key).orient, ['h'], key);
  const vertical = REGISTRY.pool('arrange', { role: 'lyric', orient: 'v', script: 'ja' });
  assert.ok(vertical.length >= 14, 'vertical lines have a wide choice of compositions (' + vertical.length + ')');
  assert.equal(REGISTRY.get('arrange', 'tickerMarquee').motion, 'own');
  assert.deepEqual(REGISTRY.traits('dwell', 'stillHold').roles, ['lyric', 'focus', 'title', 'interlude', 'outro']);
  assert.ok(REGISTRY.get('dwell', 'thumpSwell').needs.includes('beats'));
  assert.equal(REGISTRY.get('dwell', 'thumpSwell').fits({ beat: 0 }) < 0.1, true, 'no beat grid: thumpSwell is (nearly) never picked');
});

// --- one-cut plans -----------------------------------------------------------------------------------------------

function lookOf() {
  const theme = REGISTRY.get('theme', REGISTRY.fallback('theme'));
  const mood = REGISTRY.get('mood', REGISTRY.fallback('mood'));
  return { mood: { v: mood.key, from: 'auto' }, theme: { v: theme.key, from: 'auto' }, season: { v: 'any', from: 'auto' },
    amounts: Object.assign({}, mood.amounts), amountsFrom: {}, palette: Object.assign({}, theme.swatch),
    faces: JSON.parse(JSON.stringify(FACES.resolveFaces(theme, null, ['ja', 'en']))), texture: null, backdrop: 'scene', moodDef: mood };
}
const LOOK = lookOf();

function decision(kind, key, feat, params, seed) {
  const p = {};
  for (const { name, spec } of REGISTRY.params(kind, key)) {
    p[name] = params && params[name] !== undefined ? SCH.coerce(spec, params[name])
      : SCH.autoValue(spec, { f: feat, look: { amounts: LOOK.amounts, mood: LOOK.moodDef, bpm: 120 }, rng: RNG.stream(seed, 'param', name) });
  }
  return { v: key, p, from: 'auto' };
}

// A one-cut plan with `arrange` (and `dwell`) in their slots and fallbacks elsewhere. o = { arrange, dwell, params,
// dwellParams, text, note, role, aspect, orient, scale, emph, seed, energy, dur, palette } (seed and energy drive the
// autos; palette replaces the theme swatch, e.g. with the planner's palette for a backdrop).
function planOf(o) {
  const aspect = o.aspect || '16:9';
  const [w, h] = DOC.DESIGN_SIZE[aspect];
  const text = o.text === undefined ? TEXTS[0] : o.text;
  const lang = S.lineScript(text || 'あ', 'ja');
  const dur = o.dur || 3;
  const feat = { cells: S.cells(text), graphemes: S.graphemes(text).length, script: lang, latin: 0, orients: ['h', 'v'], words: 2,
    units: { glyph: 6, word: 2, line: 1 }, emph: false, impact: false, dur, cps: 2, energy: o.energy === undefined ? 0.55 : o.energy,
    beat: 0.5, onBeat: true, section: null, repeatOf: null, pos: 0.42, role: o.role || 'lyric' };
  const seed = o.seed === undefined ? H.hash32('arrange_dwell', aspect, text, o.arrange) : o.seed;
  const slots = {
    orient: { v: o.orient || 'h', from: 'auto' },
    arrange: decision('arrange', o.arrange || 'centerAnchor', feat, o.params, seed),
    'text.face': { v: 'display', from: 'auto' }, 'text.scale': { v: o.scale || 1, from: 'auto' },
    'text.ink': { v: 'ink', from: 'auto' }, 'text.style': { v: 'plain', from: 'auto' },
    arrive: decision('arrive', REGISTRY.fallback('arrive'), feat, null, seed),
    dwell: decision('dwell', o.dwell || 'stillHold', feat, o.dwellParams, seed),
    depart: decision('depart', REGISTRY.fallback('depart'), feat, null, seed),
    'ornament.count': { v: 0, from: 'auto' }, lens: decision('lens', REGISTRY.fallback('lens'), feat, null, seed),
    'filter.count': { v: 0, from: 'auto' },
  };
  const cut = { key: 'r1~0', line: 'r1', role: o.role || 'lyric', text, emph: o.emph || [], impact: false, note: o.note || null,
    t0: 1, t1: 1 + dur, a: 0.88, b: 1 + dur + 0.25, repT: 1.5, lang, feat, fp: '', slots, els: {}, ground: 0, seamIn: -1 };
  cut.fp = H.hashJSON({ slots, text, note: cut.note, role: cut.role, aspect });
  const { moodDef, ...base } = LOOK;
  const look = o.palette ? Object.assign({}, base, { palette: o.palette }) : base;
  const plan = { v: 1, hash: '', duration: cut.b + 1, design: { aspect, w, h, short: 1080 }, look, beats: { bpm: 120, offset: 0.1, meter: 4 },
    lines: [], cuts: [cut], grounds: [], seams: [], impulses: [], warnings: [] };
  Object.defineProperty(plan, 'env', { enumerable: false, value: new Float32Array(200).fill(0.5) });
  return plan;
}

function sceneOf(o) {
  const plan = planOf(o);
  return { plan, scene: BUILD.buildCut(plan.cuts[0], plan, { registry: REGISTRY, text: TEXT, strict: true }) };
}

// Frame-space boxes of the drawable glyphs (spaces skipped) at their rest pose.
function glyphBoxes(scene) {
  const t = scene.target, out = [];
  for (let j = 0; j < t.to - t.from; j++) {
    if (t.cls[j] === 'space') continue;
    out.push({ x: t.wx[j] - t.w[j] / 2, y: t.wy[j] - t.h[j] / 2, w: t.w[j], h: t.h[j], ch: t.ch[j] });
  }
  return out;
}

// Frame-space bounds of every run's ink box (its cells; vertical punctuation drawn off-centre in its cell is measured
// by that cell) through the run node's rest world matrix, so turned runs count with their turned corners.
function inkBoxes(scene) {
  const m = T.restWorld(scene.table).m, out = [];
  for (const r of scene.runs) {
    const b = r.layout.box, o = r.node * 6;
    if (!(b.w > 0 && b.h > 0)) continue;
    const xs = [], ys = [];
    for (const [x, y] of [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]]) {
      xs.push(m[o] * x + m[o + 2] * y + m[o + 4]);
      ys.push(m[o + 1] * x + m[o + 3] * y + m[o + 5]);
    }
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    out.push({ x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0, text: r.spec.text || r.spec.span });
  }
  return out;
}

// How far (du) a box leaves the frame inset by `m` on every edge (≤ 0: inside).
function excess(b, plan, m) {
  const { w, h } = plan.design;
  return Math.max(m - b.x, m - b.y, b.x + b.w - (w - m), b.y + b.h - (h - m));
}

const SAFE = 1080 * 0.05;                 // §4.17.5 D.safe: 5% of the short side
const CROPPING = new Set(['edgeBleed', 'tickerMarquee']);   // pictures that cross the frame edge on purpose

function roleOf(key) {
  const t = REGISTRY.traits('arrange', key);
  return t.roles.includes('lyric') ? 'lyric' : t.roles[0];
}

// Every run's text inside the safe area; `where` names the case in a failure.
function assertInside(plan, scene, where) {
  for (const b of inkBoxes(scene)) {
    assert.ok(excess(b, plan, SAFE) <= 2, where + ': run ' + JSON.stringify(b.text) + ' leaves the safe area by ' +
      excess(b, plan, SAFE).toFixed(1) + ' du');
  }
}

// --- pictures ----------------------------------------------------------------------------------------------------

// Every composition but the two whose picture crosses the frame edge keeps its text inside the safe area, over
// seeded autos (seeds and energies), every aspect and orientation, with and without a note.
test('compositions keep their text inside the safe area over seeded autos, in every aspect and orientation', () => {
  const texts = TEXTS.concat(['夜', 'ありがとう']);
  for (const key of REGISTRY.keys('arrange')) {
    if (CROPPING.has(key)) continue;
    const t = REGISTRY.traits('arrange', key);
    for (const aspect of DOC.ASPECTS) {
      for (const orient of t.orient) {
        for (const text of texts) {
          if (orient === 'v' && /^[A-Za-z]/.test(text)) continue;          // Latin lines are never set vertically
          for (let k = 0; k < 3; k++) {
            const note = k === 1 ? null : 'ひかりの方へ';
            const o = { arrange: key, aspect, orient, text, role: roleOf(key), note, seed: 7001 + k * 7919, energy: [0.1, 0.5, 0.9][k] };
            const { plan, scene } = sceneOf(o);
            const where = key + ' ' + aspect + ' ' + orient + ' "' + text + '" ' + JSON.stringify(plan.cuts[0].slots.arrange.p);
            assertInside(plan, scene, where);
            assert.ok(!scene.warnings.some((x) => x.code === 'overfull'), where + ': overfull');
          }
        }
      }
    }
  }
});

// Pinned values too: every combination of every enum and bool value and both ends of every number.
test('pinned parameter values keep the text inside the safe area', () => {
  for (const key of REGISTRY.keys('arrange')) {
    if (CROPPING.has(key)) continue;
    const t = REGISTRY.traits('arrange', key);
    let variants = [{}];
    for (const { name, spec } of REGISTRY.params('arrange', key)) {
      if (name === 'offsetX' || name === 'offsetY') continue;                // offsets move the picture on purpose
      const values = spec.type === 'enum' ? spec.of : spec.type === 'bool' ? [true, false]
        : spec.type === 'num' || spec.type === 'int' ? [spec.min, spec.max] : [];
      if (values.length) variants = variants.flatMap((v) => values.map((x) => Object.assign({}, v, { [name]: x })));
    }
    for (const params of variants) {
      for (const aspect of ['16:9', '9:16', '21:9', '3:4']) {
        for (const orient of t.orient) {
          for (const text of [TEXTS[1], TEXTS[3], 'ありがとう']) {
            const { plan, scene } = sceneOf({ arrange: key, aspect, orient, text, role: roleOf(key), note: 'ひかりの方へ', params });
            assertInside(plan, scene, key + ' ' + JSON.stringify(params) + ' ' + aspect + ' ' + orient + ' "' + text + '"');
          }
        }
      }
    }
  }
});

test('text.scale from 0.5 to 2 never pushes a composition out of the safe area', () => {
  for (const key of REGISTRY.keys('arrange')) {
    if (CROPPING.has(key)) continue;
    const t = REGISTRY.traits('arrange', key);
    for (const scale of [0.5, 2]) {
      for (const aspect of DOC.ASPECTS) {
        for (const orient of t.orient) {
          for (const note of [null, 'ひかりの方へ']) {
            const { plan, scene } = sceneOf({ arrange: key, aspect, orient, text: TEXTS[1], role: roleOf(key), scale, note });
            assertInside(plan, scene, key + ' scale ' + scale + ' ' + aspect + ' ' + orient + (note ? ' with note' : ''));
          }
        }
      }
    }
  }
});

// The echo stack is fitted as a whole: across the line the block plus every step, along it the drift spread. The
// schema's extremes and seeded autos (all energies) keep every copy, and the main line, inside the safe area.
test('echoStack fits the whole stack, main line and copies, inside the safe area', () => {
  for (const aspect of DOC.ASPECTS) {
    for (const orient of ['h', 'v']) {
      for (const text of ['届くまで', TEXTS[1], TEXTS[2]]) {
        if (orient === 'v' && /^[A-Za-z]/.test(text)) continue;
        const cases = [];
        for (let k = 0; k < 6; k++) cases.push({ seed: 31 + k * 104729, energy: k / 5 });
        for (const gap of [0.08, 1.3]) {
          for (const drift of [-0.8, 0.8]) for (const dir of ['down', 'up', 'split']) cases.push({ params: { copies: 4, gap, drift, dir } });
        }
        for (const c of cases) {
          for (const note of [null, 'ひかりの方へ']) {
            const { plan, scene } = sceneOf(Object.assign({ arrange: 'echoStack', aspect, orient, text, note }, c));
            const p = plan.cuts[0].slots.arrange.p;
            const where = 'echoStack ' + aspect + ' ' + orient + ' "' + text + '" ' + JSON.stringify(p);
            const copies = Math.max(1, Math.min(p.copies, Math.floor(160 / text.length) - 1));   // ≤ 160 glyphs in all
            assert.equal(scene.runs.filter((r) => r.spec.span).length, copies + 1, where + ': every copy is drawn');
            assertInside(plan, scene, where);
          }
        }
      }
    }
  }
});

// Nothing is ever dropped (SPEC §6, DESIGN §4.15.6): a line of any length is set in full. The compositions that place
// glyphs or words one by one group them into lines, arcs or word groups past their unit budget, and split line-break
// pairs by grapheme, never by code point.
const LONG_EN = 'I will keep on walking down this empty road until the morning comes far away from here tonight';
const LONG_JA = '君の名前を呼ぶ声が届くまで、ずっと走り続けるよ。'.repeat(4);
const EMOJI = '❤️。ありがとう🇯🇵！家族👨‍👩‍👧、いつも1️⃣';

test('no composition drops text: 80+ grapheme lines are set in full, one grapheme per unit', () => {
  const nonSpace = (str) => S.graphemes(str).filter((g) => !/^\s+$/.test(g));
  const covers = (drawn, want) => {                  // every wanted grapheme among the drawn ones (numbers, notes extra)
    const left = new Map();
    for (const g of drawn) left.set(g, (left.get(g) || 0) + 1);
    return want.every((g) => { const n = left.get(g) || 0; left.set(g, n - 1); return n > 0; });
  };
  for (const text of [LONG_EN, LONG_JA, EMOJI, LONG_EN.repeat(7)]) {
    const want = nonSpace(text);
    for (const key of REGISTRY.keys('arrange')) {
      const t = REGISTRY.traits('arrange', key);
      if (key === 'breathMark') continue;                                   // shows its label, not the cut text
      for (const orient of t.orient) {
        if (orient === 'v' && /^[A-Za-z]/.test(text)) continue;
        const { scene } = sceneOf({ arrange: key, text, orient, role: roleOf(key) });
        const drawn = glyphBoxes(scene).map((b) => b.ch);
        const where = key + ' ' + orient + ' ' + want.length + ' graphemes';
        if (key === 'gridMosaic' || key === 'haloRing' || key === 'confettiWords') {
          assert.deepEqual(drawn, want, where + ': every grapheme, in reading order, each one whole');
          assert.ok(!scene.warnings.some((x) => x.code === 'overfull'), where + ': fitted, not clipped');
          assert.ok(scene.runs.length <= 70, where + ': ' + scene.runs.length + ' runs (grouped past the unit budget)');
        } else if (key === 'echoStack' || key === 'tickerMarquee') {
          assert.ok(drawn.join('').includes(want.join('')), where + ': the whole line');
        } else {
          assert.ok(covers(drawn, want) || scene.warnings.some((x) => x.code === 'overfull'),
            where + ': every grapheme (or an overfull warning)');
        }
      }
    }
  }
});

// Through the real planner: a filter that leaves only one composition relaxes the traits, so any text length can
// reach it (§3.8).
test('a long line on a filtered-in grid, ring or confetti is set in full through the real planner', () => {
  const catalog = MV.use('parts/catalog').defaultRegistry();
  for (const key of ['gridMosaic', 'haloRing', 'confettiWords']) {
    const doc = JSON.parse(JSON.stringify(DOC.defaultDoc()));
    doc.sheet = { next: 2, rows: [{ id: 'r1', src: LONG_EN }] };
    doc.filters = Object.assign({}, doc.filters, { arrange: { only: [key], deny: null } });
    doc.pins = { 'line/r1:split': { v: 'none', by: 'user' } };
    const plan = PLAN.plan(doc, { registry: catalog });
    const cut = plan.cuts.find((c) => c.role === 'lyric' || c.role === 'focus');
    assert.equal(cut.slots.arrange.v, key);
    const text = createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces });
    const scene = BUILD.buildCut(cut, plan, { registry: catalog, text });
    assert.equal(glyphBoxes(scene).map((b) => b.ch).join(''), LONG_EN.replace(/\s/g, ''), key + ': the whole line');
    assert.deepEqual(scene.warnings, [], key + ': no warning needed');
  }
});

// Past the budget the grid sets one run per text line, tracked so full-width glyphs still keep one cell each.
test('gridMosaic past its unit budget keeps one full-width glyph per cell', () => {
  for (const orient of ['h', 'v']) {
    const { scene } = sceneOf({ arrange: 'gridMosaic', text: LONG_JA, orient, params: { pad: 1 } });
    const t = scene.target, f = scene.focus;
    let pitch = Infinity;
    for (let j = 1; j < t.to - t.from; j++) {
      const dx = Math.abs(t.wx[j] - t.wx[j - 1]), dy = Math.abs(t.wy[j] - t.wy[j - 1]);
      if (orient === 'h' && dy < 1 && dx > 1) pitch = Math.min(pitch, dx);
      if (orient === 'v' && dx < 1 && dy > 1) pitch = Math.min(pitch, dy);
    }
    assert.ok(Math.abs(f.w / pitch - Math.round(f.w / pitch)) < 0.01, orient + ': the glyph pitch is the cell');
    const seen = new Set();
    for (let j = 0; j < t.to - t.from; j++) {
      const col = Math.floor((t.wx[j] - f.x) / pitch), row = Math.floor((t.wy[j] - f.y) / pitch);
      const u = (t.wx[j] - f.x) / pitch - col, v = (t.wy[j] - f.y) / pitch - row;
      assert.ok(u > 0.05 && u < 0.95 && v > 0.05 && v < 0.95, orient + ': ' + t.ch[j] + ' sits inside its cell');
      assert.ok(!seen.has(col + ',' + row), orient + ': ' + t.ch[j] + ' has a cell of its own');
      seen.add(col + ',' + row);
    }
  }
});

test('the text is readable: typical lines are set at 3.5% of the short side or more (captions and credits excepted)', () => {
  const small = new Set(['cornerNote', 'creditFold', 'breathMark', 'sidebarIndex', 'tickerMarquee', 'haloRing', 'hangingTags']);
  for (const key of REGISTRY.keys('arrange')) {
    if (small.has(key)) continue;
    const t = REGISTRY.traits('arrange', key);
    const role = t.roles.includes('lyric') ? 'lyric' : t.roles[0];
    for (const aspect of ['16:9', '9:16', '1:1']) {
      const { scene } = sceneOf({ arrange: key, aspect, orient: t.orient.includes('h') ? 'h' : 'v', text: TEXTS[1], role });
      const ems = Array.from(scene.target.em).sort((a, b) => a - b);
      assert.ok(ems[Math.floor(ems.length / 2)] >= 1080 * 0.035, key + ' ' + aspect + ': median glyph ' + ems[Math.floor(ems.length / 2)].toFixed(1) + ' du');
    }
  }
});

test('confetti words never overlap, whatever the seed', () => {
  // The build stream is seeded by the slot, the part and the cut text; trailing spaces give each case its own seed.
  for (const aspect of ['16:9', '9:16', '1:1']) {
    for (let s = 0; s < 12; s++) {
      const text = (s % 2 ? TEXTS[1] : TEXTS[2]) + ' '.repeat(s);
      const { scene } = sceneOf({ arrange: 'confettiWords', aspect, text, params: { spread: 1, tilt: 22, mix: 0.5 } });
      const boxes = scene.runs.filter((r) => r.spec.span && r.from < r.to).map((r) => {
        const b = r.layout.box, c = Math.abs(Math.cos(r.spec.rot || 0)), sn = Math.abs(Math.sin(r.spec.rot || 0));
        const W = b.w * c + b.h * sn, Hh = b.w * sn + b.h * c;
        return { x: b.x + b.w / 2 - W / 2, y: b.y + b.h / 2 - Hh / 2, w: W, h: Hh };
      });
      assert.ok(boxes.length >= 2, aspect + ' seed ' + s + ': several words');
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const hit = a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
          assert.ok(!hit, aspect + ' seed ' + s + ': words ' + i + ' and ' + j + ' overlap');
        }
      }
    }
  }
});

test('special cuts: the title plate shows the title and the artist, the breath mark its label, the credit both', () => {
  const chars = (scene) => glyphBoxes(scene).map((b) => b.ch).join('');
  let r = sceneOf({ arrange: 'titlePlate', role: 'title', text: '夜明けのうた', note: 'サンプル' });
  assert.equal(chars(r.scene), '夜明けのうたサンプル');
  r = sceneOf({ arrange: 'creditFold', role: 'outro', text: '夜明けのうた', note: 'サンプル' });
  assert.equal(chars(r.scene), '夜明けのうたサンプル');
  const breath = (label, note) => chars(sceneOf({ arrange: 'breathMark', role: 'interlude', text: '', note, params: { label } }).scene);
  assert.equal(breath('heading', 'サビ'), 'サビ', 'heading → the section heading');
  assert.equal(breath('heading', null), '♪', 'no heading → ♪');
  assert.equal(breath('none', 'サビ'), '', 'none → nothing');
  assert.equal(breath('♪', 'サビ'), '♪');
  assert.equal(breath('間奏です', null), '間奏です', 'free text as written');
  const blank = sceneOf({ arrange: 'centerAnchor', role: 'interlude', text: '', note: 'Cメロ' });
  assert.equal(chars(blank.scene), 'Cメロ', 'the fallback composition shows a blank special cut’s heading');
});

test('notes are shown small, once, by every composition that can show them', () => {
  for (const key of REGISTRY.keys('arrange')) {
    if (key === 'breathMark') continue;
    const t = REGISTRY.traits('arrange', key);
    const role = t.roles.includes('lyric') ? 'lyric' : t.roles[0];
    const { scene } = sceneOf({ arrange: key, role, orient: t.orient.includes('h') ? 'h' : 'v', text: TEXTS[1], note: 'ひかりの方へ' });
    const notes = scene.runs.filter((run) => run.spec.text === 'ひかりの方へ');
    assert.equal(notes.length, 1, key + ': one note run');
    const mainEm = Math.max(...scene.runs.filter((run) => run.spec.span).map((run) => run.layout.size));
    assert.ok(notes[0].layout.size < mainEm, key + ': the note is smaller than the line');
  }
});

// SPEC §3: `|note` shows small annotation text. The ticker drew only the scrolling line (spec-6); its note now stands
// still beside the strip (above it, or left of a vertical one; the other side when that leaves the safe area), inside
// the safe area, and fades in and out with the strip.
test('tickerMarquee shows the note once, still, beside the strip and inside the safe area', () => {
  const NOTE = 'ささやき';
  for (const aspect of ['16:9', '9:16', '1:1']) {
    for (const orient of ['h', 'v']) {
      for (const pos of [0.15, 0.5, 0.85]) {
        const where = aspect + ' ' + orient + ' pos ' + pos;
        const { plan, scene } = sceneOf({ arrange: 'tickerMarquee', aspect, orient, text: 'いつもの駅で待ってる', note: NOTE,
          params: { pos, strip: 'tint' } });
        const notes = scene.runs.filter((run) => run.spec.text === NOTE);
        assert.equal(notes.length, 1, where + ': one note run');
        assert.ok(!notes[0].spec.move, where + ': the note stands still');
        const nb = inkBoxes(scene).find((b) => b.text === NOTE);
        assert.ok(excess(nb, plan, SAFE) <= 1, where + ': inside the safe area (' + excess(nb, plan, SAFE).toFixed(1) + ')');
        const i = Array.from(scene.table.type.subarray(0, scene.table.n)).indexOf(T.TYPE.paint);
        const d = scene.stores.paint[scene.table.payload[i]].data;
        const strip = { x: d.cx - d.w / 2, y: d.cy - d.h / 2, w: d.w, h: d.h };
        const apart = orient === 'h' ? nb.y + nb.h <= strip.y + 0.5 || nb.y >= strip.y + strip.h - 0.5
          : nb.x + nb.w <= strip.x + 0.5 || nb.x >= strip.x + strip.w - 0.5;
        assert.ok(apart, where + ': beside the strip, not on it');
        if (pos === 0.5) {
          assert.ok(orient === 'h' ? nb.y + nb.h <= strip.y + 0.5 : nb.x + nb.w <= strip.x + 0.5, where + ': above / left of it');
        }
        const node = notes[0].node;
        F.evaluate(scene, scene.times.a + 0.01);
        const early = scene.table.wa[node];
        F.evaluate(scene, (scene.times.a + scene.times.b) / 2);
        assert.ok(early < 0.1 && scene.table.wa[node] > 0.99, where + ': fades in with the strip');
      }
    }
  }
});

test('the shared offsets move the whole composition', () => {
  for (const key of ['centerAnchor', 'stairStep', 'confettiWords', 'magazineHead', 'gridMosaic']) {
    const a = sceneOf({ arrange: key, text: TEXTS[1] }).scene.focus;
    const b = sceneOf({ arrange: key, text: TEXTS[1], params: { offsetX: 0.1, offsetY: -0.05 } }).scene.focus;
    assert.ok(Math.abs(b.x - a.x - 192) < 1e-3 && Math.abs(b.y - a.y + 54) < 1e-3, key + ': focus moved by the offsets');
  }
});

// The diptych's split follows the offsets: the tinted panel's edge, the divider and the pieces move together, and
// each piece stays inside its own panel.
test('diptychSplit: the offsets move the split, the panel edge and the divider together; pieces stay in their panels', () => {
  const edgeOf = (scene, tint) => {
    const i = Array.from(scene.table.type.subarray(0, scene.table.n)).indexOf(T.TYPE.paint);
    const d = scene.stores.paint[scene.table.payload[i]].data;
    return tint === 'first' ? d.cx + d.w / 2 : d.cx - d.w / 2;
  };
  const dividerOf = (scene) => {
    const m = T.restWorld(scene.table).m;
    for (let i = 0; i < scene.table.n; i++) {
      if (scene.table.type[i] !== T.TYPE.shape) continue;
      const b = scene.stores.shape[scene.table.payload[i]].bounds;
      return m[i * 6] * b[0] + m[i * 6 + 2] * b[1] + m[i * 6 + 4];
    }
    return null;
  };
  const edges = {};
  for (const tint of ['first', 'second']) {
    for (const offsetX of [-0.2, 0, 0.2]) {
      const { plan, scene } = sceneOf({ arrange: 'diptychSplit', text: TEXTS[1],
        params: { ratio: 0.5, tint, divider: true, offsetX, offsetY: 0.05 } });
      const edge = edgeOf(scene, tint), where = tint + ' offsetX ' + offsetX;
      assert.ok(Math.abs(dividerOf(scene) - edge) < 0.5, where + ': the divider sits on the panel edge');
      edges[tint + offsetX] = edge;
      const [a, b] = inkBoxes(scene);
      assert.ok(a.x >= 0 && a.x + a.w <= edge + 1, where + ': the first piece is in the first panel');
      assert.ok(b.x >= edge - 1 && b.x + b.w <= plan.design.w, where + ': the second piece is in the second panel');
    }
    assert.ok(Math.abs(edges[tint + 0.2] - edges[tint + 0] - 384) < 1e-3, tint + ': offsetX 0.2 moves the split 384 du');
  }
});

// Focus (§4.17.5: the text block; ornaments frame it, lenses aim at it, g.cx/g.cy hold about it) never includes
// decorations that run off the frame.
test('hangingTags and diptychSplit focus on the words, not on threads or dividers running off the frame', () => {
  for (const [key, params] of [['hangingTags', { card: true }], ['hangingTags', { card: false }], ['diptychSplit', { divider: true }]]) {
    for (const aspect of ['16:9', '9:16']) {
      const { plan, scene } = sceneOf({ arrange: key, aspect, text: TEXTS[1], params, note: key === 'diptychSplit' ? 'ひかりの方へ' : null });
      const f = scene.focus, where = key + ' ' + aspect + ' ' + JSON.stringify(params);
      assert.ok(f.x >= 0 && f.y >= 0 && f.x + f.w <= plan.design.w && f.y + f.h <= plan.design.h, where + ': focus in the frame');
      let top = Infinity, bottom = -Infinity;
      for (const b of inkBoxes(scene)) { top = Math.min(top, b.y); bottom = Math.max(bottom, b.y + b.h); }
      assert.ok(Math.abs(f.y - top) < 1 && Math.abs(f.y + f.h - bottom) < 1, where + ': the focus spans the words');
    }
  }
});

// §4.19.4 backdrops: a slab or strip in 'ink' turns white under the black backdrop (and the knockout keys out under
// chroma). The planner never picks them; by pin they work under the scene backdrop and fall back to plain words or the
// tinted strip where the plan's palette is the black or chroma one (clear cannot be seen by a part: NOTES).
test('backdrop-unsafe looks are never auto: no knockout, no ink ticker strip', () => {
  const autoOf = (kind, key, name, k) => {
    const spec = REGISTRY.params(kind, key).find((x) => x.name === name).spec;
    const f = { cells: 6, energy: k / 199, dur: 3 };
    return SCH.autoValue(spec, { f, look: { amounts: LOOK.amounts, mood: LOOK.moodDef, bpm: 120 }, rng: RNG.stream(k, 'param', name) });
  };
  for (let k = 0; k < 200; k++) {
    assert.equal(autoOf('arrange', 'edgeBleed', 'knockout', k), false);
    assert.notEqual(autoOf('arrange', 'tickerMarquee', 'strip', k), 'ink');
  }
  const layer = (scene, name) => scene.layers.find((l) => l.name === name);
  const stripFill = (scene) => {
    const i = Array.from(scene.table.type.subarray(0, scene.table.n)).indexOf(T.TYPE.paint);
    return scene.stores.paint[scene.table.payload[i]].data.fill;
  };
  let scene = sceneOf({ arrange: 'edgeBleed', text: '夜明け', params: { knockout: true } }).scene;
  assert.equal(layer(scene, 'text').opacity, 0, 'the knockout still works by pin');
  assert.deepEqual(layer(scene, 'far').mask, { layer: 'text', invert: true });
  scene = sceneOf({ arrange: 'tickerMarquee', text: '夜明けの街', params: { strip: 'ink' } }).scene;
  assert.equal(stripFill(scene), 'ink', 'so does the ink strip');
  // Under the black and chroma backdrops the plan's palette says so (§4.16.3): the pinned looks fall back.
  const LK = MV.use('planner/look'), PINS = MV.use('core/pins');
  const theme = REGISTRY.get('theme', REGISTRY.fallback('theme'));
  for (const backdrop of ['black', 'chroma']) {
    const palette = LK.palette(theme, PINS.index({}), backdrop);
    scene = sceneOf({ arrange: 'edgeBleed', text: '夜明け', params: { knockout: true }, palette }).scene;
    assert.equal(layer(scene, 'text').opacity, 1, backdrop + ': plain words, no knockout');
    assert.equal(layer(scene, 'far').mask, null, backdrop + ': no masked slab');
    scene = sceneOf({ arrange: 'tickerMarquee', text: '夜明けの街', params: { strip: 'ink' }, palette }).scene;
    assert.equal(stripFill(scene), 'ground2', backdrop + ': the ink strip is drawn as the tint');
    assert.ok(scene.runs.every((r) => r.spec.ink !== 'ground'), backdrop + ': words in their own ink');
  }
});

test('text.scale enlarges the type and fitting keeps it in the box', () => {
  const size = (scale) => sceneOf({ arrange: 'centerAnchor', text: TEXTS[0], scale }).scene.runs[0].layout.size;
  assert.ok(size(0.6) < size(1) && size(1) <= size(1.5));
  const big = sceneOf({ arrange: 'centerAnchor', text: TEXTS[1], scale: 2, aspect: '9:16' }).scene;
  assert.ok(!big.warnings.some((x) => x.code === 'overfull'));
});

// --- holds -------------------------------------------------------------------------------------------------------

function centroid(scene, t) {
  F.evaluate(scene, t);
  const tb = scene.table, tg = scene.target;
  let x = 0, y = 0, n = 0;
  for (let i = tg.from; i < tg.to; i++) { x += tb.m[i * 6 + 4]; y += tb.m[i * 6 + 5]; n++; }
  return { x: x / n, y: y / n };
}

test('block holds move the text as one piece about its centre; still hold makes no behaviours', () => {
  const still = sceneOf({ dwell: 'stillHold', text: TEXTS[1] }).scene;
  assert.equal(still.behaviours.filter((b) => b.phase === MV.use('parts/kit').PH.REST).length, 0);
  for (const key of ['breathePulse', 'swaySwing', 'thumpSwell']) {
    const { scene } = sceneOf({ dwell: key, text: TEXTS[1], dwellParams: { amount: 1 } });
    const rest = centroid(scene, scene.times.rest - 0.01);
    for (const t of [0.6, 1.0, 1.4, 1.9, 2.3]) {
      const c = centroid(scene, t);
      assert.ok(Math.hypot(c.x - rest.x, c.y - rest.y) < 3, key + ' at ' + t + ': the block centre stays put');
    }
  }
  const drift = sceneOf({ dwell: 'slowDrift', text: TEXTS[1], dwellParams: { amount: 1, angle: -90, dist: 40 } }).scene;
  const mid = (drift.times.rest + drift.times.out) / 2;
  const d0 = centroid(drift, drift.times.rest - 0.01), d1 = centroid(drift, mid);
  assert.ok(d1.y < d0.y - 20 && Math.abs(d1.x - d0.x) < 1, 'slowDrift floats up the whole block');
});

// Block holds move only the glyphs: over a composition that sets its words on a fixed decoration (grid cells, tag
// cards, a card, a band, a rule under the line) the words would slide off it, so the planner never pairs them.
test('block holds are not paired with compositions whose words sit on a fixed decoration', () => {
  const bound = ['gridMosaic', 'hangingTags', 'tiltedCard', 'slantBand', 'titlePlate', 'magazineHead'];
  const block = ['breathePulse', 'slowDrift', 'swaySwing', 'creepTrack', 'thumpSwell'];
  const f = { beat: 0.5, energy: 0.5 };
  for (const key of block) {
    const def = REGISTRY.get('dwell', key);
    for (const arrange of bound) assert.equal(def.fits(f, { arrange }), 0, key + ' over ' + arrange);
    assert.ok(def.fits(f, { arrange: 'centerAnchor' }) > 0 && def.fits(f, {}) > 0, key + ' elsewhere');
  }
  const catalog = MV.use('parts/catalog').defaultRegistry();
  let bounded = 0;
  for (const { doc } of corpus.corpus(2, ['16:9', '9:16'])) {
    for (const cut of PLAN.plan(doc, { registry: catalog }).cuts) {
      if (!bound.includes(cut.slots.arrange.v) || cut.slots.dwell.from !== 'auto') continue;
      bounded++;
      assert.ok(!block.includes(cut.slots.dwell.v), cut.key + ': ' + cut.slots.arrange.v + ' with ' + cut.slots.dwell.v);
    }
  }
  assert.ok(bounded > 50, 'the corpus covers these compositions (' + bounded + ' cuts)');
});

// creepTrack opens slowly and closes again inside the hold, so the envelope's short ramp before the exit never snaps
// the spacing shut (§4.17.4: no pops).
test('creepTrack returns within the hold, no faster than a few times its opening', () => {
  for (const dur of [2, 4, 8]) {
    const { scene } = sceneOf({ dwell: 'creepTrack', text: TEXTS[1], dur, dwellParams: { amount: 0.6, spread: 0.08 } });
    const last = scene.target.to - 1, { rest, out } = scene.times, dt = 1 / 60;
    const xs = [];
    for (let t = rest - 0.05; t <= out + 0.05; t += dt) { F.evaluate(scene, t); xs.push(scene.table.m[last * 6 + 4]); }
    let open = 0, back = 0, peak = 0;
    for (let i = 1; i < xs.length; i++) {
      const v = (xs[i] - xs[i - 1]) / dt;
      open = Math.max(open, v); back = Math.max(back, -v); peak = Math.max(peak, xs[i] - xs[0]);
    }
    assert.ok(peak > 20, dur + ' s: the spacing opens (' + peak.toFixed(1) + ' du)');
    assert.ok(back <= 2.5 * open, dur + ' s: closes at ' + back.toFixed(1) + ' du/s, opened at ' + open.toFixed(1) + ' du/s');
    assert.ok(Math.abs(xs[xs.length - 1] - xs[0]) < 0.01, dur + ' s: back at rest when the exit starts');
  }
});

test('creep and wave follow the reading axis', () => {
  const spread = (orient, key, params) => {
    const { scene } = sceneOf({ dwell: key, orient, text: TEXTS[1], dwellParams: Object.assign({ amount: 1 }, params) });
    const t = scene.times.out - 0.3;
    F.evaluate(scene, scene.times.rest - 0.01);
    const tb = scene.table, tg = scene.target;
    const before = [];
    for (let i = tg.from; i < tg.to; i++) before.push([tb.m[i * 6 + 4], tb.m[i * 6 + 5]]);
    F.evaluate(scene, t);
    let dx = 0, dy = 0;
    for (let i = tg.from; i < tg.to; i++) {
      dx = Math.max(dx, Math.abs(tb.m[i * 6 + 4] - before[i - tg.from][0]));
      dy = Math.max(dy, Math.abs(tb.m[i * 6 + 5] - before[i - tg.from][1]));
    }
    return { dx, dy };
  };
  const h = spread('h', 'creepTrack', { spread: 0.1 }), v = spread('v', 'creepTrack', { spread: 0.1 });
  assert.ok(h.dx > 5 && h.dy < 1e-3, 'horizontal creep opens along x');
  assert.ok(v.dy > 5 && v.dx < 1e-3, 'vertical creep opens along y');
  const wh = spread('h', 'waveRun', { height: 0.2 }), wv = spread('v', 'waveRun', { height: 0.2 });
  assert.ok(wh.dy > 1 && wh.dx < 1e-3 && wv.dx > 1 && wv.dy < 1e-3, 'the wave runs across the reading axis');
});

// --- visual QA: tuned pictures -----------------------------------------------------------------------------------

const LONG25 = '「ねえ、ちょっと待って」ってもう一度言えなかったー';        // 25 cells: small type if set on two lines only
const MIX = '今夜はDANCE FLOORで踊ろう!! 2024年の夏';

function unionOf(boxes) {
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  return { x: x0, y: y0, w: Math.max(...boxes.map((b) => b.x + b.w)) - x0, h: Math.max(...boxes.map((b) => b.y + b.h)) - y0 };
}

function medianEm(scene) {
  const ems = Array.from(scene.target.em).sort((a, b) => a - b);
  return ems[Math.floor(ems.length / 2)];
}

test('long lines in square and tall frames are not set small where the picture can take more lines or width', () => {
  // tiltedCard (a wider card, four lines), slantBand and titlePlate (a third line), diptychSplit (a square frame splits
  // across the lines), echoStack (three lines), hangingTags (two-line tags), sidebarIndex and creditFold (a wider column).
  // sidebarIndex 0.05 (was 0.06): with the final §4.15.3 particle rule the longest phrase of LONG25 that may not be
  // broken is 「一度言えなかったー」 (9 cells; 言えな|かった no longer splits), and it sets the size in the column beside
  // the number, which already takes all the width the picture gives it (1:1 54 du, 9:16 59.5; 69–76 while the
  // breaker still cut もう|一度 and 言えな|かった).
  const want = { tiltedCard: 0.065, slantBand: 0.065, titlePlate: 0.065, diptychSplit: 0.065, echoStack: 0.065,
    hangingTags: 0.055, sidebarIndex: 0.05, creditFold: 0.04 };
  for (const [key, share] of Object.entries(want)) {
    for (const aspect of ['9:16', '1:1', '4:5']) {
      const { scene } = sceneOf({ arrange: key, aspect, text: LONG25, role: roleOf(key) });
      const em = medianEm(scene);
      assert.ok(em >= 1080 * share, key + ' ' + aspect + ': median glyph ' + em.toFixed(1) + ' du');
      assert.ok(!scene.warnings.some((x) => x.code === 'overfull'), key + ' ' + aspect + ': fitted');
    }
  }
});

test('giantWhisper: a Latin word is never cut; whispers wider than the giant, and the beside group, are centred', () => {
  const giantOf = (scene) => scene.runs.reduce((a, r) => (r.layout.size > a.layout.size ? r : a));
  const { scene } = sceneOf({ arrange: 'giantWhisper', text: 'Loveって何？', emph: [[0, 2]], params: { tuck: 'under', ratio: 3 } });
  assert.deepEqual(giantOf(scene).spec.span, [0, 4], 'the emphasis on "Lo" takes the whole word');
  const cases = [['16:9', 'I will wait for you until the morning light', [[0, 1]], 'under'],
    ['1:1', 'I will wait for you until the morning light', [[0, 1]], 'under'],
    ['9:16', MIX, [[3, 5]], 'under'], ['16:9', 'Paper planes in the morning light', [[0, 5]], 'beside'],
    ['21:9', 'Paper planes in the morning light', [[0, 5]], 'beside'], ['16:9', 'はじまりの朝', [[0, 2]], 'beside']];
  for (const [aspect, text, emph, tuck] of cases) {
    const { plan, scene: sc } = sceneOf({ arrange: 'giantWhisper', aspect, text, emph, params: { tuck, ratio: 3 } });
    const u = unionOf(inkBoxes(sc)), w = plan.design.w;
    assert.ok(Math.abs(u.x + u.w / 2 - w / 2) < w * 0.04, aspect + ' ' + tuck + ' "' + text + '": the group is centred (' +
      (u.x + u.w / 2 - w / 2).toFixed(0) + ' du off)');
  }
  // Beside only where the whispers keep their size: in a tall frame they go under the giant.
  const tall = sceneOf({ arrange: 'giantWhisper', aspect: '9:16', text: MIX, emph: [[0, 2]], params: { tuck: 'beside', ratio: 3 } }).scene;
  const g = inkBoxes(tall)[0];
  for (const b of inkBoxes(tall).slice(1)) assert.ok(b.y >= g.y + g.h - 1 || b.y + b.h <= g.y + 1, '9:16: whispers above or under the giant');
});

// The giant and its whispers read in the order of the line: the words before the giant come before it (to its left, or
// above it), the words after it after it (to its right, or under it). Beside stacked both to its right, so
// 「昨日のため息を」 with ため息 big read ため息｜昨日の／を (final fixes, QA-LOOK).
test('giantWhisper keeps the reading order: words before the giant left of (or above) it, words after right of (or under) it', () => {
  const cases = [['昨日のため息を', [[3, 6]]], ['改札の向こうで待ってる', [[3, 7]]], ['Paper planes in the morning light', [[6, 12]]],
    [MIX, [[3, 14]]], ['はじまりの朝', [[5, 6]]]];
  let sideBySide = 0;
  for (const aspect of ['16:9', '21:9', '1:1', '4:5', '9:16']) {
    for (const [text, emph] of cases) {
      for (const tuck of ['beside', 'under']) {
        const where = aspect + ' ' + tuck + ' "' + text + '"';
        const { scene } = sceneOf({ arrange: 'giantWhisper', aspect, text, emph, params: { tuck, ratio: 3 } });
        const giant = scene.runs.reduce((a, r) => (r.layout.size > a.layout.size ? r : a));
        const boxes = inkBoxes(scene);
        const g = boxes[scene.runs.indexOf(giant)];
        scene.runs.forEach((run, i) => {
          if (run === giant || !run.spec.span) return;
          const b = boxes[i];
          if (run.spec.span[1] <= giant.spec.span[0]) {
            assert.ok(b.x + b.w <= g.x + 1 || b.y + b.h <= g.y + 1, where + ': the words before the giant come first');
            if (b.x + b.w <= g.x + 1 && b.y < g.y + g.h && b.y + b.h > g.y) sideBySide++;
          } else {
            assert.ok(b.x >= g.x + g.w - 1 || b.y >= g.y + g.h - 1, where + ': the words after the giant come after it');
          }
        });
      }
    }
  }
  assert.ok(sideBySide > 5, 'beside sets the words before the giant to its left (' + sideBySide + ' cases)');
});

test('echoStack: three lines in square and tall frames; each line keeps its trail clear of the next', () => {
  for (const aspect of ['9:16', '1:1', '16:9']) {
    for (const [gap, copies] of [[0.5, 3], [1.1, 2]]) {
      const { scene } = sceneOf({ arrange: 'echoStack', aspect, text: LONG25, params: { copies, gap, dir: 'down', drift: 0 } });
      const main = scene.runs[0], [m, c1] = inkBoxes(scene);
      const where = aspect + ' gap ' + gap;
      assert.equal(main.layout.lines.length, aspect === '16:9' ? 2 : 3, where + ': lines');
      const step = (c1.y - m.y) / main.spec.size;             // copies step down by `step` em
      assert.ok(step > 0.05, where + ': the copies step down');
      if (gap < 0.9) assert.ok(step * copies <= 0.9 + 1e-6, where + ': overlapping copies keep a short trail (' + step.toFixed(2) + ')');
      else if (aspect !== '16:9') assert.ok(Math.abs(step - gap) < 1e-6, where + ': copies a line apart keep their step');
      assert.ok(main.spec.leading >= 1 + copies * step - 1e-6, where + ': the trail stays between the lines');
    }
  }
});

test('hangingTags: tags never overlap and no thread runs behind another tag', () => {
  const texts = [TEXTS[1], TEXTS[2], TEXTS[3], LONG25, MIX, 'I will wait for you until the morning light'];
  let tiered = 0;
  for (const aspect of ['16:9', '9:16', '1:1', '4:5', '21:9']) {
    for (const orient of ['h', 'v']) {
      for (const text of texts) {
        if (orient === 'v' && /^[A-Za-z]/.test(text)) continue;
        for (let k = 0; k < 3; k++) {
          const card = k !== 1;
          const { scene } = sceneOf({ arrange: 'hangingTags', aspect, orient, text: text + ' '.repeat(k), params: { card, drop: 1 } });
          const where = aspect + ' ' + orient + ' "' + text + '" ' + k;
          const tb = scene.table;
          const paint = scene.stores.paint.find((p) => p.data && Array.isArray(p.data.thread));
          const tags = paint ? paint.data.x.map((x, i) => ({ x, y: paint.data.y[i], w: paint.data.w[i], h: paint.data.h[i] }))
            : inkBoxes(scene);
          const threads = [];
          for (let i = 0; i < tb.n; i++) {
            if (tb.type[i] !== T.TYPE.shape) continue;
            const b = scene.stores.shape[tb.payload[i]].bounds;
            if (Math.abs(b[2] - b[0]) < 1e-6) threads.push({ x: b[0], y1: b[3] });
          }
          assert.equal(threads.length, tags.length, where + ': a thread per tag');
          if (new Set(tags.map((z) => Math.round(z.y))).size > 1) tiered++;
          tags.forEach((a, i) => {
            for (let j = i + 1; j < tags.length; j++) {
              const b = tags[j];
              const hit = a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
              assert.ok(!hit, where + ': tags ' + i + ' and ' + j + ' overlap');
            }
          });
          threads.forEach((t, i) => tags.forEach((z, j) => {
            if (i === j) return;
            const behind = t.x > z.x + 0.5 && t.x < z.x + z.w - 0.5 && z.y < t.y1 - 0.5;
            assert.ok(!behind, where + ': thread ' + i + ' runs behind tag ' + j);
          }));
        }
      }
    }
  }
  assert.ok(tiered > 20, 'staggered tags were checked (' + tiered + ')');
});

test('haloRing: turned rings keep Latin letters together; upright glyphs never touch, on the sides of the ring too', () => {
  const pitch = (scene) => {
    const t = scene.target, d = [];
    for (let j = 1; j < t.to - t.from; j++) {
      if (t.cls[j] === 'space' || t.cls[j - 1] === 'space') continue;
      d.push(Math.hypot(t.wx[j] - t.wx[j - 1], t.wy[j] - t.wy[j - 1]) / t.em[j]);
    }
    return d.sort((a, b) => a - b)[Math.floor(d.length / 2)];
  };
  const en = sceneOf({ arrange: 'haloRing', aspect: '1:1', text: 'Paper planes in the morning light', params: { tangent: true, sweep: 300 } });
  const ja = sceneOf({ arrange: 'haloRing', aspect: '1:1', text: TEXTS[1], params: { tangent: true, sweep: 300 } });
  assert.ok(pitch(en.scene) < 0.8, 'Latin letters sit closer than full-width slots (' + pitch(en.scene).toFixed(2) + ' em)');
  assert.ok(pitch(ja.scene) > 0.95, 'full-width glyphs keep a full slot (' + pitch(ja.scene).toFixed(2) + ' em)');
  for (const aspect of ['16:9', '9:16', '1:1']) {
    for (const text of ['Paper planes in the morning light', MIX, TEXTS[1], TEXTS[3]]) {
      for (const sweep of [150, 240, 360]) {
        const { scene } = sceneOf({ arrange: 'haloRing', aspect, text, params: { tangent: false, sweep } });
        // ink boxes: 80% of each glyph's cell (side bearings and the space above and below the letters)
        const b = glyphBoxes(scene).map((g) => ({ x: g.x + g.w * 0.1, y: g.y + g.h * 0.1, w: g.w * 0.8, h: g.h * 0.8 }));
        for (let i = 0; i < b.length; i++) {
          for (let j = i + 1; j < b.length; j++) {
            const hit = b[i].x < b[j].x + b[j].w && b[j].x < b[i].x + b[i].w && b[i].y < b[j].y + b[j].h && b[j].y < b[i].y + b[i].h;
            assert.ok(!hit, aspect + ' "' + text + '" sweep ' + sweep + ': glyphs ' + i + ' and ' + j + ' touch');
          }
        }
      }
    }
  }
});

// Glyphs turned along the ring lean outward: past the sides of a wide sweep they turned 90–150° (「昨日の…」 starting at
// 7–8 o'clock, sideways or upside down, in four QA looks). The turned arc is capped at 200° centred on the top, so no
// glyph turns more than 100°; upright glyphs keep the full ring.
test('haloRing: glyphs turned along the arc never lean past 100° (the turned arc is capped at 200°, centred on the top)', () => {
  const turn = (run) => { const r = Math.atan2(Math.sin(run.spec.rot || 0), Math.cos(run.spec.rot || 0)); return Math.abs(r) / (Math.PI / 180); };
  for (const aspect of ['16:9', '9:16', '1:1']) {
    for (const text of ['昨日のため息を', TEXTS[1], 'Paper planes in the morning light', MIX]) {
      for (const sweep of [150, 240, 300, 360]) {
        const where = aspect + ' "' + text + '" sweep ' + sweep;
        const tangent = sceneOf({ arrange: 'haloRing', aspect, text, params: { tangent: true, sweep } }).scene;
        const worst = Math.max(...tangent.runs.filter((r) => r.spec.span).map(turn));
        assert.ok(worst <= 100.5, where + ': a glyph turned ' + worst.toFixed(0) + '°');
        if (sweep >= 240) assert.ok(worst >= 80, where + ': the arc still reaches the sides');
        const upright = sceneOf({ arrange: 'haloRing', aspect, text, params: { tangent: false, sweep } }).scene;
        if (sweep === 360) {
          const ys = glyphBoxes(upright).map((g) => g.y + g.h / 2), cy = upright.focus.y + upright.focus.h / 2;
          assert.ok(ys.some((y) => y > cy + 10), where + ': upright glyphs keep the full ring');
        }
      }
    }
  }
});

// A line of one word has no phrase to split at: the diptych's other panel stayed empty (「昨日のため息を」 as one piece in
// QA-LOOK's tree). The planner (nearly) never picks the diptych for such a line; a line of two words or more fills both.
test('diptychSplit is (nearly) never picked for a one-word line; two words fill both panels', () => {
  const def = REGISTRY.get('arrange', 'diptychSplit');
  for (const text of ['紙ひこうき', 'Hello', 'はじまりの朝', '昨日のため息を', TEXTS[1], TEXTS[2], MIX]) {
    const lang = S.lineScript(text, 'ja');
    const words = TEXT.words(text, lang).length, pieces = TEXT.columns(text, 2, lang).length;
    assert.equal(def.fits({ words }) < 0.1, pieces < 2, text + ': fits ' + def.fits({ words }) + ' with ' + pieces + ' piece(s)');
    if (pieces < 2) continue;
    const { scene } = sceneOf({ arrange: 'diptychSplit', aspect: '16:9', text, params: { ratio: 0.5 } });
    const halves = new Set(inkBoxes(scene).map((b) => (b.x + b.w / 2 < 960 ? 'left' : 'right')));
    assert.equal(halves.size, 2, text + ': words in both panels');
  }
});

// Two tiers of tags read row by row, so the first tags hang in the upper row and the rest below (even tags up and odd
// tags down read 「昨日の」「を」 / 「ため息」). With drop 0 the rows are exact; every layout reads in the line's order.
test('hangingTags read in order: one row left to right, or two rows with the first tags above', () => {
  let tiered = 0;
  for (const aspect of ['1:1', '4:5', '9:16', '16:9']) {
    for (const text of ['昨日のため息を', TEXTS[1], TEXTS[2], TEXTS[3], LONG25, MIX, 'I will wait for you until the morning light']) {
      for (const card of [true, false]) {
        const { scene } = sceneOf({ arrange: 'hangingTags', aspect, text, params: { card, drop: 0 } });
        const tags = scene.runs.filter((r) => r.spec.span).map((r, i) => Object.assign({ i }, inkBoxes(scene)[scene.runs.indexOf(r)]));
        const rowTop = Math.min(...tags.map((t) => t.y));
        const rowOf = (t) => (t.y > rowTop + tags[0].h * 0.5 ? 1 : 0);
        if (tags.some((t) => rowOf(t) === 1)) tiered++;
        const read = tags.slice().sort((a, b) => rowOf(a) - rowOf(b) || a.x - b.x).map((t) => t.i);
        assert.deepEqual(read, tags.map((t) => t.i), aspect + ' "' + text + '" card ' + card + ': tags read in order');
      }
    }
  }
  assert.ok(tiered >= 4, 'two-row layouts are covered (' + tiered + ')');
});

// Decorations avoid the composition's focus. sidebarIndex gave only its text column, so a bar code ran across the big
// number (sakuraFog 1:1) and a tape strip over the rule (sodaFloat 16:9): the focus now holds the whole block.
test('sidebarIndex: the focus decorations avoid holds the column, the big number and the rule', () => {
  for (const aspect of ['16:9', '1:1', '9:16']) {
    for (const orient of ['h', 'v']) {
      for (const side of ['left', 'right']) {
        const { scene } = sceneOf({ arrange: 'sidebarIndex', aspect, orient, text: TEXTS[1], params: { side, number: '22' } });
        const f = scene.focus, where = aspect + ' ' + orient + ' ' + side;
        for (const b of inkBoxes(scene)) {
          assert.ok(b.x >= f.x - 1 && b.y >= f.y - 1 && b.x + b.w <= f.x + f.w + 1 && b.y + b.h <= f.y + f.h + 1,
            where + ': "' + b.text + '" inside the focus');
        }
      }
    }
  }
});

test('gridMosaic follows manuscript paper: marks never open a line, numbers pair up, lines hold more than one glyph', () => {
  const HANGING = /^[、。，．,.」』）)］】〕〉》｝]+$/;
  let hung = 0;
  for (const aspect of ['16:9', '9:16', '1:1', '21:9', '3:4']) {
    for (const orient of ['h', 'v']) {
      for (const text of [TEXTS[3], LONG25, 'そう、それは。「夢」と、「嘘」。', 'ありがとう、さよなら、またね。']) {
        for (const pad of [0, 1, 2]) {
          const { scene } = sceneOf({ arrange: 'gridMosaic', aspect, orient, text, params: { pad, lines: 'grid' } });
          const f = scene.focus, runs = scene.runs.filter((r) => r.spec.span);
          const cell = Math.max(...runs.map((r) => r.spec.box.w));      // a cell two glyphs share is inset
          const cells = runs.map((r) => {
            const col = Math.round((r.spec.box.x - f.x) / cell), row = Math.round((r.spec.box.y - f.y) / cell);
            const str = text.slice(r.spec.span[0], r.spec.span[1]);
            return { str, along: (orient === 'v' ? row : col) - pad, line: orient === 'v' ? -col : row };
          });
          const most = Math.max(...cells.filter((c) => !HANGING.test(c.str)).map((c) => c.along));
          const where = aspect + ' ' + orient + ' pad ' + pad + ' "' + text + '"';
          cells.forEach((c, i) => {
            if (i > 0 && HANGING.test(c.str)) assert.ok(c.along !== 0, where + ': "' + c.str + '" opens a line');
            if (c.along > most) hung++;
          });
          assert.ok(new Set(cells.map((c) => c.line)).size < cells.length, where + ': a line holds several glyphs');
        }
      }
    }
  }
  assert.ok(hung > 10, 'marks were hung past the line end (' + hung + ')');
  // Two digits share a cell, set tate-chu-yoko in a vertical grid; short lines break into few lines when the cell is capped.
  const v = sceneOf({ arrange: 'gridMosaic', orient: 'v', text: '2024年の夏', params: { pad: 1 } }).scene;
  assert.deepEqual(v.runs.filter((r) => r.spec.span).map((r) => '2024年の夏'.slice(r.spec.span[0], r.spec.span[1])),
    ['20', '24', '年', 'の', '夏']);
  for (const [orient, aspect] of [['h', '16:9'], ['v', '9:16']]) {
    const s = sceneOf({ arrange: 'gridMosaic', aspect, orient, text: 'はじまりの朝', params: { pad: 1 } }).scene;
    const at = s.runs.filter((r) => r.spec.span).map((r) => Math.round(orient === 'v' ? r.spec.box.x : r.spec.box.y));
    assert.equal(new Set(at).size, 2, orient + ': はじま／りの朝 on two lines');
  }
});

test('edgeBleed: without the knockout, a note over the huge words sits on a plate of the ground colour', () => {
  const plates = (scene) => scene.stores.paint.filter((p) => p.data && p.data.r !== undefined);
  let { scene } = sceneOf({ arrange: 'edgeBleed', text: TEXTS[1], note: 'ひかりの方へ', params: { knockout: false } });
  const [plate] = plates(scene);
  assert.ok(plate, 'a plate under the note');
  const note = inkBoxes(scene).find((b) => b.text === 'ひかりの方へ');
  const d = plate.data;
  assert.ok(d.x <= note.x && d.y <= note.y && d.x + d.w >= note.x + note.w && d.y + d.h >= note.y + note.h, 'the plate covers the note');
  scene = sceneOf({ arrange: 'edgeBleed', text: TEXTS[1], note: 'ひかりの方へ', params: { knockout: true } }).scene;
  assert.equal(plates(scene).length, 0, 'the knockout slab needs no plate');
  scene = sceneOf({ arrange: 'edgeBleed', text: TEXTS[1], params: { knockout: false } }).scene;
  assert.equal(plates(scene).length, 0, 'no note, no plate');
});

test('vertical captions: cornerNote columns start at the block top with the mark in line; long credits take two columns', () => {
  for (const corner of ['bottomLeft', 'bottomRight', 'topRight', 'topLeft']) {
    for (const aspect of ['16:9', '9:16', '1:1']) {
      const { scene } = sceneOf({ arrange: 'cornerNote', aspect, orient: 'v', text: LONG25, note: 'ひかりの方へ',
        params: { corner, mark: 'rule', size: 0.06 } });
      const [main, note] = inkBoxes(scene);
      const where = corner + ' ' + aspect;
      assert.ok(note.x + note.w <= main.x + 1, where + ': the note column follows the caption (left of it)');
      if (corner.startsWith('top')) assert.ok(Math.abs(note.y - main.y) < 2, where + ': note and caption start together');
      const tb = scene.table;
      const i = Array.from(tb.type.subarray(0, tb.n)).indexOf(T.TYPE.shape);
      const b = scene.stores.shape[tb.payload[i]].bounds;
      const first = scene.runs[0].layout.lines[0];
      assert.ok(b[0] >= main.x + main.w - first.w - 1 && b[2] <= main.x + main.w + 1, where + ': the rule is in line with the first column');
    }
  }
  const credit = sceneOf({ arrange: 'creditFold', role: 'outro', orient: 'v', aspect: '16:9', text: LONG25, note: 'サンプル' }).scene;
  assert.equal(credit.runs[0].layout.lines.length, 2, 'a long title takes two columns');
  assert.ok(credit.runs[0].layout.size >= 1080 * 0.035, 'and keeps a readable size');
});
