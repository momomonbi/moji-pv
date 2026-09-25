/* 文字PVメーカー v2 — original work. Tests: the entrance and exit catalog (parts/arrive, parts/depart) against DESIGN §5.2, §5.4, §4.17.4, §4.18. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

// Every part also runs the §8.2 conformance matrix (conformance.test.js). This file checks what is particular to the
// motion catalog: the §5.2/§5.4 tables, where the definitions live, mirrors that really are time-reversed, the caret of
// type on / type erase (and the text's element pins on it), fixed-tick flicker, where the exits that aim at the frame
// end on turned compositions, what the renderer can draw, and that no two entrances move alike.

const MV = load();
const REG = MV.use('core/registry');
const E = MV.use('core/ease');
const BH = MV.use('engine/scene/behave');
const BUILD = MV.use('engine/scene/build');
const F = MV.use('engine/scene/frame');
const FAC = MV.use('engine/facade');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');

const MOTION_MODULE = /^parts\/(arrive|depart)\//;
const MODULES = MV.ids('parts/').filter((id) => MOTION_MODULE.test(id));
const DEFS = MODULES.flatMap((id) => MV.use(id));
const HOSTS = corpus.minimalFallbacks().filter((d) => d.kind !== 'arrive' && d.kind !== 'depart');
const K = MV.use('parts/kit');

// A test-only vertical composition (the fallback composition of the minimal hosts is horizontal): one column, centred.
const COLUMN = K.arrange({
  key: 'testColumn', label: { ja: '試験の列', en: 'Test column' }, blurb: { ja: '試験用', en: 'Test only' },
  traits: { orient: ['v'] },
  build(env) {
    const { D, cut, sb, textStyle } = env;
    const em = D.short * 0.09, colH = D.h * 0.8;
    const block = sb.group({ layer: 'text', owner: 'text' });
    const run = sb.text({ parent: block, span: [0, cut.text.length], orient: 'v', face: textStyle.face, size: em,
      box: { x: D.cx - em / 2, y: D.cy - colH / 2, w: em, h: colH }, align: 'center', fit: 'shrink', maxLines: 1,
      breakAt: 'none', ink: textStyle.ink, emphInk: 'accent', style: textStyle.style, revealMode: 'wipeY' });
    const focus = sb.bounds(block);
    return { runs: [run], focus, free: sb.freeAround(focus) };
  },
});
// A test-only vertical composition with two columns, set right to left, the first against the safe area's right edge:
// the text splits at the space nearest its middle (at its middle when it has none).
const COLUMNS = K.arrange({
  key: 'testColumns', label: { ja: '試験の二列', en: 'Test columns' }, blurb: { ja: '試験用', en: 'Test only' },
  traits: { orient: ['v'] },
  build(env) {
    const { D, cut, sb, textStyle } = env;
    const text = cut.text, em = D.short * 0.09, colH = D.h * 0.7, mid = text.length / 2;
    let at = -1;
    for (let i = 1; i < text.length - 1; i++) if (text[i] === ' ' && (at < 0 || Math.abs(i - mid) < Math.abs(at - mid))) at = i;
    if (at < 0) at = Math.ceil(mid);
    const block = sb.group({ layer: 'text', owner: 'text' });
    const column = (span, x) => sb.text({ parent: block, span, orient: 'v', face: textStyle.face, size: em,
      box: { x, y: D.cy - colH / 2, w: em, h: colH }, align: 'start', fit: 'shrink', maxLines: 1, breakAt: 'none',
      ink: textStyle.ink, emphInk: 'accent', style: textStyle.style, revealMode: 'wipeY' });
    const runs = [column([0, at], D.w - D.safe.r - em), column([at, text.length], D.w - D.safe.r - 2.5 * em)];
    const focus = sb.bounds(block);
    return { runs, focus, free: sb.freeAround(focus) };
  },
});
// Compositions that turn their runs or their groups (WP5a1's parts, when present): the exits that aim at the frame
// (implode, burst, fall, pile, burn …) must still reach it there.
const TURNED = ['haloRing', 'slantBand', 'confettiWords', 'tiltedCard'];
const ARRANGES = MV.ids('parts/arrange/').flatMap((id) => MV.use(id)).filter((d) => TURNED.includes(d.key));
const REGISTRY = REG.createRegistry(DEFS.concat(HOSTS, [COLUMN, COLUMNS], ARRANGES));
const MEASURER = fakeMeasurer();

// --- DESIGN §5.2 / §5.4 as data -------------------------------------------------------------------------------------

const DESIGN = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'DESIGN.md'), 'utf8');

function section(dir) {
  const text = DESIGN.slice(DESIGN.indexOf('\n## 5. '), DESIGN.indexOf('\n## 6. '));
  return text.split('\n### ').find((chunk) => chunk.split('\n')[0].includes('(`parts/' + dir + '/'));
}

function cells(line) { return line.split('|').slice(1, -1).map((s) => s.trim()); }

function tableOf(dir) {
  const lines = section(dir).split('\n').filter((l) => l.startsWith('|'));
  const head = cells(lines[0]);
  return lines.filter((l) => l.startsWith('| `')).map((l) => {
    const row = { key: /`(\w+)`/.exec(l)[1] };
    cells(l).forEach((c, i) => { row[head[i]] = c; });
    return row;
  });
}

const TABLES = { arrive: tableOf('arrive'), depart: tableOf('depart') };

function defOf(kind, key) { return REGISTRY.get(kind, key); }
function moduleOf(kind, key) { return MODULES.find((id) => MV.use(id).some((d) => d.kind === kind && d.key === key)); }

// --- scenes ---------------------------------------------------------------------------------------------------------

const services = new Map();
function textService(faces) {
  const k = JSON.stringify(faces);
  if (!services.has(k)) services.set(k, createTextService({ measurer: MEASURER, faces }));
  return services.get(k);
}

// A one-cut sample plan (engine/facade.samplePlan: cut 0.12–2.9 s, window 0–3.15 s) with the given slots.
// opts: samplePlan's { aspect, text } and `els`, the cut's element pins (§3.4.3).
function sceneOf(slots, opts) {
  const o = opts || {};
  const plan = FAC.samplePlan(REGISTRY, { kind: 'arrive', key: 'instantShow' }, o);
  const cut = plan.cuts[0];
  Object.assign(cut.slots, slots);
  if (o.els) cut.els = o.els;
  const scene = BUILD.buildCut(cut, plan, { registry: REGISTRY, text: textService(plan.look.faces), strict: true });
  return { plan, cut, scene };
}

// Decision for a part with its auto params (from the facade's canned features), overridden by `p`.
function decisionFor(kind, key, p, opts) {
  const plan = FAC.samplePlan(REGISTRY, { kind, key, params: p || null }, opts || {});
  return plan.cuts[0].slots[kind];
}

function motionOf(scene, exit) {
  return scene.behaviours.find((b) => b.run === BH.runGlyphMotion && b.exit === exit);
}

// The time glyph j of a kit motion behaviour is at linear progress u.
function timeAt(b, j, u) { return b.t0 + b.delay[j] + u * b.dur; }

const POSE_COLS = ['x', 'y', 'z', 'rot', 'sx', 'sy', 'kx', 'ky', 'rx', 'ry', 'alpha', 'blur', 'reveal', 'tint', 'glow', 'shard',
  'echo', 'jx', 'jy', 'pixel', 'px', 'py'];

function poseOf(scene, node) {
  const P = scene.table.live;
  return Object.fromEntries(POSE_COLS.map((c) => [c, P[c][node]]));
}

function worldOf(scene, node) {
  const m = scene.table.m;
  return { x: m[node * 6 + 4], y: m[node * 6 + 5], a: scene.table.wa[node] };
}

// --- the tables -------------------------------------------------------------------------------------------------------

test('every §5.2 entrance and §5.4 exit exists with its table label and tags, and nothing else', () => {
  for (const kind of ['arrive', 'depart']) {
    const want = TABLES[kind];
    assert.deepEqual(REGISTRY.keys(kind), want.map((r) => r.key).sort(), kind + ' keys');
    for (const row of want) {
      const def = defOf(kind, row.key);
      assert.deepEqual(def.label, { ja: row.ja, en: row.en }, kind + '/' + row.key + ' label');
      assert.deepEqual(def.tags.slice().sort(), row.Tags.split(/\s+/).sort(), kind + '/' + row.key + ' tags');
    }
  }
});

test('counts meet SPEC §6 (entrances ≥ 20, exits ≥ 16) and DESIGN §5 (22 and 17 pool parts plus a fallback)', () => {
  const pooled = (kind) => REGISTRY.all(kind).filter((d) => d.pool !== false).length;
  assert.equal(pooled('arrive'), 22);
  assert.equal(pooled('depart'), 17);
  assert.ok(pooled('arrive') >= 20 && pooled('depart') >= 16);
});

test('fallbacks: instantShow and instantHide, pool false, no behaviours, every role', () => {
  for (const [kind, key] of [['arrive', 'instantShow'], ['depart', 'instantHide']]) {
    const def = defOf(kind, key);
    assert.equal(REGISTRY.fallback(kind), key);
    assert.equal(def.pool, false);
    assert.deepEqual(def.make({}, { from: 0, to: 3 }, {}), []);
    assert.deepEqual(def.traits.roles.slice().sort(), ['focus', 'interlude', 'lyric', 'outro', 'title']);
  }
});

test('table notes become fields: (trait impact) → traits.impact, (gate `glitch`) → gate', () => {
  for (const kind of ['arrive', 'depart']) {
    for (const row of TABLES[kind]) {
      const def = defOf(kind, row.key);
      const note = row.Picture;
      assert.equal(!!(def.traits && def.traits.impact), /\(trait impact\)/.test(note), kind + '/' + row.key + ' impact');
      const gate = /\(gate `(\w+)`\)/.exec(note);
      assert.equal(def.gate, gate ? gate[1] : undefined, kind + '/' + row.key + ' gate');
    }
  }
});

test('"Mirror of X" exits live in the module of their entrance (parts depend only on the kit)', () => {
  for (const row of TABLES.depart) {
    const m = /^Mirror of (\w+)/.exec(row.Picture);
    if (!m) continue;
    assert.ok(defOf('arrive', m[1]), m[1] + ' exists');
    assert.equal(moduleOf('depart', row.key), moduleOf('arrive', m[1]), row.key + ' sits next to ' + m[1]);
  }
});

// The K.mirror exits of the catalog: the five §5.4 "Mirror of" rows and strobeOut ("Glyphs flicker off").
const MIRRORS = { inkSink: 'inkRise', hingeClose: 'hingeFlip', sliceHide: 'sliceReveal', curtainFall: 'curtainRise',
  twirlDepart: 'twirlArrive', strobeOut: 'strobeIn' };

// §4.18.7: only a mirrored exit lives in its entrance's file; a stand-alone exit is a parts/depart/ module.
test('arrive modules hold entrances and only their K.mirror exits; every other exit lives under parts/depart/', () => {
  for (const id of MODULES) {
    const list = MV.use(id);
    for (const def of list) {
      if (id.startsWith('parts/depart/')) { assert.equal(def.kind, 'depart', id + ': ' + def.key + ' is not an exit'); continue; }
      if (def.kind !== 'depart') continue;
      assert.ok(MIRRORS[def.key] && list.some((d) => d.key === MIRRORS[def.key]),
        id + ': ' + def.key + ' is a stand-alone exit in the arrive directory');
    }
  }
  for (const row of TABLES.depart) {
    if (/^Mirror of/.test(row.Picture)) assert.ok(MIRRORS[row.key], row.key + ' is listed in MIRRORS');
  }
  assert.equal(moduleOf('depart', 'typeErase'), 'parts/depart/type');
});

function autosOf(kind, key) { return Object.fromEntries(REGISTRY.params(kind, key).map((q) => [q.name, q.spec.auto])); }

function reversedAuto(auto) {
  if ('value' in auto) return { value: E.reverse(auto.value) };
  return Object.assign({}, auto, { pick: auto.pick.map((name) => E.reverse(name)) });
}

// §4.18.3: mirror() reverses the ease. The exit's auto must be the reverse of the entrance's auto (a K.mirror patch with
// `shared` drops it, see NOTES ## WP5a2), and dur/each carry over where the entrance sets them.
test('K.mirror exits reverse the entrance ease auto and keep its dur/each autos (all six, strobeOut included)', () => {
  for (const [out, entrance] of Object.entries(MIRRORS)) {
    const inDef = defOf('arrive', entrance);
    const a = autosOf('arrive', entrance), d = autosOf('depart', out);
    assert.deepEqual(d.ease, reversedAuto(a.ease), out + ' ease auto reverses ' + entrance + "'s");
    for (const name of ['dur', 'each']) {
      const want = inDef.shared[name] ? a[name] : REG.SHARED.depart[name].auto;
      assert.deepEqual(d[name], want, out + ' ' + name + ' auto');
    }
  }
});

test('blurbs are one sentence in each language, English without Japanese', () => {
  for (const def of DEFS) {
    const where = def.kind + '/' + def.key;
    assert.ok(!/[。．！？]./.test(def.blurb.ja.trim()), where + ' ja blurb is one sentence');
    assert.ok(!/[.!?]\s+\S/.test(def.blurb.en.trim()), where + ' en blurb is one sentence');
    assert.ok(!/[぀-ヿ一-鿿]/.test(def.blurb.en + def.label.en), where + ' en text has no Japanese');
  }
});

test('title cards, interludes and the outro have quiet entrances and exits of their own', () => {
  for (const role of ['title', 'interlude', 'outro']) {
    assert.ok(REGISTRY.pool('arrive', { role }).length >= 4, 'arrive pool for ' + role);
    assert.ok(REGISTRY.pool('depart', { role }).length >= 4, 'depart pool for ' + role);
  }
});

// --- motion properties --------------------------------------------------------------------------------------------------

// The exit named "Mirror of X" at progress 1 − s shows exactly the pose X shows at progress s, glyph by glyph.
// (strobeOut is a mirror too, but its flicker is keyed on the clock's tick, not on progress; see the tick test.)
test('table mirrors are time-reversed entrances: the exit at 1 − u shows the entrance pose at u', () => {
  for (const row of TABLES.depart) {
    const m = /^Mirror of (\w+)/.exec(row.Picture);
    if (!m) continue;
    const inDef = defOf('arrive', m[1]), outDef = defOf('depart', row.key);
    const shared = { dur: 0.4, each: 0.03, order: 'lead' };
    const own = {};
    for (const q of REGISTRY.params('arrive', inDef.key)) {
      if (!q.shared) own[q.name.replace(/From$/, 'To')] = own[q.name] = decisionFor('arrive', inDef.key).p[q.name];
    }
    const arrive = { v: inDef.key, p: Object.assign({}, own, shared, { ease: 'cubicOut' }), from: 'auto' };
    const depart = { v: outDef.key, p: Object.assign({}, own, shared, { ease: 'cubicIn' }), from: 'auto' };
    const { scene } = sceneOf({ arrive, depart });
    const bIn = motionOf(scene, false), bOut = motionOf(scene, true);
    assert.ok(bIn && bOut, row.key + ': both motions are kit behaviours');
    for (let j = 0; j < bIn.to - bIn.from; j++) {
      for (const s of [0.15, 0.4, 0.7, 0.9]) {
        F.evaluate(scene, timeAt(bIn, j, s));
        const p1 = poseOf(scene, bIn.from + j);
        F.evaluate(scene, timeAt(bOut, j, 1 - s));
        const p2 = poseOf(scene, bOut.from + j);
        for (const c of POSE_COLS) {
          assert.ok(Math.abs(p1[c] - p2[c]) < 1e-3, row.key + ' glyph ' + j + ' at ' + s + ': ' + c + ' ' + p1[c] + ' vs ' + p2[c]);
        }
      }
    }
  }
});

function caretOf(scene) { return scene.behaviours.find((b) => b.phase === BH.PH.ORNAMENT && b.when); }

test('type on: glyphs appear one by one behind a lit caret, which blinks out after the line', () => {
  for (const orient of ['h', 'v']) {
    const slots = { arrive: decisionFor('arrive', 'typeOn') };
    if (orient === 'v') Object.assign(slots, { orient: { v: 'v', from: 'auto' }, arrange: { v: 'testColumn', p: { offsetX: 0, offsetY: 0 } } });
    const { scene } = sceneOf(slots);
    assert.equal(scene.target.runs[0].spec.orient, orient);
    const b = motionOf(scene, false), c = caretOf(scene);
    assert.ok(b && c, 'glyph motion and caret');
    assert.equal(c.to - c.from, scene.target.runs.length, 'one caret per run');
    const n = b.to - b.from;
    for (let j = 0; j < n; j++) {
      const t = c.when[j];
      F.evaluate(scene, t - 1e-4);
      if (j > 0) assert.ok(worldOf(scene, b.from + j).a < 1 / 255, orient + ': glyph ' + j + ' hidden before its key');
      F.evaluate(scene, t + 1e-3);
      const g = worldOf(scene, b.from + j), k = worldOf(scene, c.from);
      assert.ok(g.a > 0.99 && k.a > 0.99, orient + ': glyph ' + j + ' and caret shown');
      const w = scene.target.w[j], h = scene.target.h[j];
      if (orient === 'h') {
        assert.ok(k.x > g.x + w * 0.4 && k.x < g.x + w, orient + ': caret right of glyph ' + j);
        assert.ok(Math.abs(k.y - g.y) < h * 0.2, orient + ': caret on the line');
      } else {
        assert.ok(k.y > g.y + h * 0.4 && k.y < g.y + h, orient + ': caret under glyph ' + j);
        assert.ok(Math.abs(k.x - g.x) < w * 0.2, orient + ': caret in the column');
      }
    }
    F.evaluate(scene, c.t1 + 0.01);
    assert.ok(worldOf(scene, c.from).a < 1 / 255, orient + ': caret gone after the line');
  }
});

test('type erase: the caret shows up at the end, then deletes glyphs from the last one back', () => {
  const { scene } = sceneOf({ depart: decisionFor('depart', 'typeErase') });
  const b = motionOf(scene, true), c = caretOf(scene);
  const n = b.to - b.from;
  assert.ok(c.t0 < b.t0, 'the caret appears before the first deletion');
  F.evaluate(scene, c.t0 + 0.05);
  const last = worldOf(scene, b.from + n - 1), k0 = worldOf(scene, c.from);
  assert.ok(k0.a > 0.99 && k0.x > last.x, 'caret lit after the last glyph');
  let prev = Infinity;
  for (let j = n - 1; j >= 0; j--) {
    F.evaluate(scene, c.when[j] + 1e-3);
    const k = worldOf(scene, c.from);
    assert.ok(k.a > 0.99 && k.x < prev && k.x < worldOf(scene, b.from + j).x, 'caret moves back past glyph ' + j);
    prev = k.x;
    if (j > 0) {
      F.evaluate(scene, c.when[j - 1] - 1e-4);
      assert.ok(worldOf(scene, b.from + j - 1).a > 0.99, 'glyph ' + (j - 1) + ' untouched before its turn');
    }
    F.evaluate(scene, timeAt(b, j, 1) + 1e-3);
    assert.ok(worldOf(scene, b.from + j).a < 1 / 255, 'glyph ' + j + ' erased');
  }
});

// §3.4.3: the caret is a node of the text element, so el.text.hide leaves it out and el.text.fill recolours it.
test('the caret follows the text element pins: none on a hidden text, the pinned fill on a filled one', () => {
  const TB = MV.use('engine/scene/table');
  for (const [kind, key] of [['arrive', 'typeOn'], ['depart', 'typeErase']]) {
    const slots = { [kind]: decisionFor(kind, key) };
    const hidden = sceneOf(slots, { els: { text: { hide: true } } }).scene;
    assert.equal(caretOf(hidden), undefined, key + ': no caret on a hidden text');
    const b = motionOf(hidden, kind === 'depart');
    F.evaluate(hidden, timeAt(b, Math.floor((b.to - b.from) / 2), 0.5));
    for (let i = 0; i < hidden.table.n; i++) {
      if (hidden.owners[hidden.table.owner[i]].el !== 'text' || hidden.table.type[i] === 0) continue;
      assert.ok(TB.isHidden(hidden.table, i), key + ': text node ' + i + ' (type ' + hidden.table.type[i] + ') is not drawn');
    }
    const inkOf = (scene) => { const c = caretOf(scene); return scene.stores.shape[scene.table.payload[c.from]].fill; };
    assert.equal(inkOf(sceneOf(slots).scene), 'accent', key + ': the caret is an accent bar by default');
    const filled = sceneOf(slots, { els: { text: { fill: '#00FF00' } } }).scene;
    const c = caretOf(filled);
    for (let i = c.from; i < c.to; i++) assert.equal(filled.stores.shape[filled.table.payload[i]].fill, '#00FF00', key + ' caret fill');
    assert.ok(filled.stores.glyph.every((g) => g.ink === '#00FF00'), key + ': the glyphs take the pinned fill too');
  }
});

// Exits that aim at the frame, on the fallback composition and on compositions that turn their runs (haloRing tangent)
// or their groups (slantBand, tiltedCard, confettiWords): the moves are frame vectors seen from each glyph's parent.
const AIMED_TEXT = 'はじまりの朝に光が満ちる';
const AIMED_LAYOUTS = [['fallback', null, null], ['haloRing', { tangent: true }, null], ['slantBand', null, null],
  ['confettiWords', null, null], ['tiltedCard', null, null],
  ['fallback, turned 60° and scaled 1.3 by el.text.nudge', null, { text: { nudge: { dx: 30, dy: -20, rot: 60, s: 1.3 } } }]];

function aimedScene(layout, key, aspect) {
  const [arrange, ap, els] = layout;
  const o = { aspect, text: AIMED_TEXT };
  const slots = { depart: decisionFor('depart', key, null, o) };
  if (REGISTRY.has('arrange', arrange)) slots.arrange = decisionFor('arrange', arrange, ap, o);
  const { plan, scene } = sceneOf(slots, Object.assign({ els }, o));
  const b = motionOf(scene, true), T = scene.target, f = T.focus;
  return { scene, b, T, H: plan.design.h, fx: f.x + f.w / 2, fy: f.y + f.h / 2, n: b.to - b.from };
}

// Where glyph j of an aimed scene is on the frame at its progress u.
function aimedAt(s, j, u) {
  F.evaluate(s.scene, timeAt(s.b, j, u));
  return worldOf(s.scene, s.b.from + j);
}

test('exits that aim at the frame reach it on turned and nudged compositions too', (t) => {
  const missing = TURNED.filter((k) => !REGISTRY.has('arrange', k));
  if (missing.length) t.diagnostic('compositions not in the tree yet (skipped): ' + missing.join(' '));
  for (const aspect of ['16:9', '9:16']) {
    for (const layout of AIMED_LAYOUTS.filter((l) => l[0].startsWith('fallback') || REGISTRY.has('arrange', l[0]))) {
      const where = aspect + ' ' + layout[0] + ': ';
      const implode = aimedScene(layout, 'pointImplode', aspect);
      for (let j = 0; j < implode.n; j++) {
        const g = aimedAt(implode, j, 0.999), T = implode.T;
        const start = Math.hypot(T.wx[j] - implode.fx, T.wy[j] - implode.fy);
        const miss = Math.hypot(g.x - implode.fx, g.y - implode.fy);
        assert.ok(miss <= 0.05 * start + 1, where + 'implode: glyph ' + j + ' ends ' + miss.toFixed(1) + ' du from the point');
      }
      const drop = aimedScene(layout, 'dropAway', aspect);
      for (let j = 0; j < drop.n; j++) {
        let prev = -Infinity;
        for (const u of [0.3, 0.5, 0.7, 0.9]) {
          const g = aimedAt(drop, j, u);
          assert.ok(g.y >= drop.T.wy[j] && g.y > prev, where + 'drop away: glyph ' + j + ' falls down the frame (u ' + u + ')');
          prev = g.y;
        }
        assert.ok(aimedAt(drop, j, 0.999).y > drop.H, where + 'drop away: glyph ' + j + ' ends below the frame');
      }
      const pile = aimedScene(layout, 'pileCollapse', aspect);
      for (let j = 0; j < pile.n; j++) {
        const y = aimedAt(pile, j, 0.7).y;
        if (layout[2]) continue;               // a nudged, enlarged line may already reach past the floor
        assert.ok(y > pile.H * 0.55 && y < pile.H, where + 'pile: glyph ' + j + ' lies on the floor of the frame (' + y.toFixed(0) + ')');
      }
      for (const key of ['shardBurst', 'zoomPast']) {
        const s = aimedScene(layout, key, aspect);
        for (let j = 0; j < s.n; j++) {
          const r0 = Math.hypot(s.T.wx[j] - s.fx, s.T.wy[j] - s.fy);
          if (r0 < s.T.em[j]) continue;
          const g = aimedAt(s, j, 0.6);
          assert.ok(Math.hypot(g.x - s.fx, g.y - s.fy) > r0, where + key + ': glyph ' + j + ' moves outward');
        }
      }
      const burn = aimedScene(layout, 'burnOut', aspect), melt = aimedScene(layout, 'meltDown', aspect);
      for (let j = 0; j < burn.n; j++) {
        assert.ok(aimedAt(burn, j, 0.95).y < burn.T.wy[j] - 0.1 * burn.T.em[j], where + 'burn out: glyph ' + j + ' rises');
        assert.ok(aimedAt(melt, j, 0.9).y > melt.T.wy[j] + 0.1 * melt.T.em[j], where + 'melt down: glyph ' + j + ' drips down');
      }
    }
  }
});

// The glyph-draw rule (§4.19.5): a tint (and the echo copies) are whole glyphs drawn over the sprite, not through the
// mosaic or the strips, so a part never tints or echoes a glyph while it is pixelated or broken up.
test('no part tints or echoes a glyph while it is pixelated or shattered', () => {
  const P = (scene, c, i) => scene.table.live[c][i];
  for (const def of REGISTRY.all('arrive').concat(REGISTRY.all('depart')).filter((d) => d.pool !== false)) {
    const { scene } = sceneOf({ [def.kind]: decisionFor(def.kind, def.key) });
    const b = motionOf(scene, def.kind === 'depart');
    if (!b) continue;
    for (let q = 0; q <= 80; q++) {
      F.evaluate(scene, b.t0 + ((b.t1 - b.t0) * q) / 80);
      for (let i = b.from; i < b.to; i++) {
        const broken = P(scene, 'pixel', i) >= 1 || P(scene, 'shard', i) > 0;
        const whole = P(scene, 'tint', i) > 0 || P(scene, 'echo', i) > 0;
        assert.ok(!(broken && whole), def.kind + '/' + def.key + ': glyph ' + (i - b.from) + ' is tinted or echoed while broken up');
      }
    }
  }
});

function flickerToggles(scene, b) {
  let toggles = 0;
  for (let j = 0; j < b.to - b.from; j++) {
    let prev = null;
    for (let u = 0.02; u < 0.98; u += 0.01) {
      F.evaluate(scene, timeAt(b, j, u));
      const on = worldOf(scene, b.from + j).a > 0.5;
      if (prev !== null && on !== prev) toggles++;
      prev = on;
    }
  }
  return toggles;
}

test('strobe in flickers on and holds lit; strobe out starts lit, flickers off and ends dark', () => {
  const p = { dur: 0.8, each: 0.02, order: 'lead' };
  const inS = sceneOf({ arrive: decisionFor('arrive', 'strobeIn', p) }).scene;
  const outS = sceneOf({ depart: decisionFor('depart', 'strobeOut', p) }).scene;
  const bIn = motionOf(inS, false), bOut = motionOf(outS, true);
  assert.ok(flickerToggles(inS, bIn) >= 2 * (bIn.to - bIn.from), 'strobe in: glyphs flicker');
  assert.ok(flickerToggles(outS, bOut) >= 2 * (bOut.to - bOut.from), 'strobe out: glyphs flicker');
  for (let j = 0; j < bIn.to - bIn.from; j++) {
    F.evaluate(inS, timeAt(bIn, j, 0.9));
    assert.ok(worldOf(inS, bIn.from + j).a > 0.99, 'strobe in: glyph ' + j + ' holds lit');
    F.evaluate(outS, timeAt(bOut, j, 0.1));
    assert.ok(worldOf(outS, bOut.from + j).a > 0.99, 'strobe out: glyph ' + j + ' starts lit');
    F.evaluate(outS, timeAt(bOut, j, 1) + 1e-6);
    assert.ok(worldOf(outS, bOut.from + j).a < 1 / 255, 'strobe out: glyph ' + j + ' ends dark');
  }
});

// §7.1.4 and the §8.2 frame row: stochastic looks change on a fixed tick, so the same instants show the same pattern at
// any frame rate, and a random draw holds for a whole tick.
test('strobe in, strobe out and glitch in switch on a fixed tick: the same pattern at 30 and 60 fps sample times', () => {
  const COLS = ['alpha', 'jx', 'jy', 'tint', 'echo'];
  for (const [kind, key] of [['arrive', 'strobeIn'], ['depart', 'strobeOut'], ['arrive', 'staticJoin']]) {
    const d = decisionFor(kind, key, { dur: 0.8, each: 0.02, order: 'lead' });
    const { scene } = sceneOf({ [kind]: d });
    const b = motionOf(scene, kind === 'depart'), n = b.to - b.from;
    const sample = (t) => {
      F.evaluate(scene, t);
      const out = [];
      for (let i = b.from; i < b.to; i++) for (const c of COLS) out.push(scene.table.live[c][i]);
      return out;
    };
    const i0 = Math.ceil(b.t0 * 30), i1 = Math.floor(b.t1 * 30);
    const at60 = [];
    for (let i = 2 * i0; i <= 2 * i1; i++) at60.push(sample(i / 60));        // every 60 fps frame, in playback order
    for (let i = i1; i >= i0; i--) {                                         // 30 fps frames, in another order
      assert.deepEqual(sample(i / 30), at60[2 * (i - i0)], key + ': frame ' + i + '/30 = frame ' + 2 * i + '/60');
    }
    // within one tick: a strobing glyph changes state at most once; a glitch keeps its draw (jitter ∝ what is left)
    const rate = d.p.rate;
    for (let tick = Math.ceil(b.t0 * rate); tick < Math.floor(b.t1 * rate); tick++) {
      for (let j = 0; j < n; j++) {
        const states = [], draws = [];
        for (const f of [0.05, 0.3, 0.55, 0.8, 0.95]) {
          const t = (tick + f) / rate;
          F.evaluate(scene, t);
          states.push(worldOf(scene, b.from + j).a > 0.5);
          const u = Math.min(1, Math.max(0, (t - b.t0 - b.delay[j]) / b.dur)), left = 1 - Math.min(1, b.ease(u));
          if (left > 0.05 && u > 0) draws.push(scene.table.live.jx[b.from + j] / left);
        }
        const changes = states.slice(1).filter((s, q) => s !== states[q]).length;
        if (key !== 'staticJoin') assert.ok(changes <= 1, key + ': glyph ' + j + ' flips ' + changes + ' times in tick ' + tick);
        else for (const v of draws) assert.ok(Math.abs(v - draws[0]) < 1e-3 * scene.target.em[j], key + ': glyph ' + j + ' redraws inside tick ' + tick);
      }
    }
  }
});

// §4.17.4 identity rule, glyph by glyph while the others are still moving: an entrance at progress ≥ 1 and an exit at
// progress ≤ 0 leave the pose exactly at rest.
test('every entrance ends exactly at rest and every exit starts exactly from it, glyph by glyph', () => {
  for (const def of REGISTRY.all('arrive').concat(REGISTRY.all('depart')).filter((d) => d.pool !== false)) {
    const exit = def.kind === 'depart';
    const { scene } = sceneOf({ [def.kind]: decisionFor(def.kind, def.key, { dur: 0.5, each: 0.05, order: 'lead' }) });
    const b = motionOf(scene, exit);
    assert.ok(b, def.key + ' makes a kit motion');
    for (let j = 0; j < b.to - b.from; j++) {
      const t = exit ? timeAt(b, j, 0) - 1e-6 : timeAt(b, j, 1) + 1e-6;
      F.evaluate(scene, t);
      const i = b.from + j;
      for (const c of POSE_COLS) {
        assert.ok(Math.abs(scene.table.live[c][i] - scene.table.base[c][i]) < 1e-9,
          def.kind + '/' + def.key + ' glyph ' + j + ' ' + c + ' at ' + (exit ? 'its start' : 'its end'));
      }
    }
  }
});

// Every entrance, sampled on its middle glyph at five points of its progress: no two move alike (§5 "clearly different").
test('no two entrances move alike', () => {
  const NORM = { x: 'em', y: 'em', z: 1000, rot: 90, kx: 90, ky: 90, rx: 90, ry: 90, blur: 'em', jx: 'em', jy: 'em', pixel: 'em',
    px: 'em', py: 'em' };
  const sigs = [];
  for (const def of REGISTRY.all('arrive').filter((d) => d.pool !== false)) {
    const d = decisionFor('arrive', def.key, { dur: 0.6, each: 0.03, order: 'lead' });
    const { scene } = sceneOf({ arrive: d });
    const b = motionOf(scene, false);
    const j = Math.floor((b.to - b.from) / 2), em = scene.target.em[j];
    const sig = [];
    for (const u of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      F.evaluate(scene, timeAt(b, j, u));
      const p = poseOf(scene, b.from + j), base = scene.table.base;
      for (const c of POSE_COLS) {
        const n = NORM[c] === 'em' ? em : NORM[c] || 1;
        sig.push((p[c] - base[c][b.from + j]) / n);
      }
    }
    sigs.push({ key: def.key, sig });
  }
  for (let a = 0; a < sigs.length; a++) {
    for (let c = a + 1; c < sigs.length; c++) {
      let diff = 0;
      for (let k = 0; k < sigs[a].sig.length; k++) diff = Math.max(diff, Math.abs(sigs[a].sig[k] - sigs[c].sig[k]));
      assert.ok(diff > 0.1, sigs[a].key + ' and ' + sigs[c].key + ' move alike (max difference ' + diff.toFixed(3) + ')');
    }
  }
});

// --- visual QA of the motion catalog: glyphs that must not run into each other, and clean ends --------------------------

// The slots that set a vertical composition (testColumn or testColumns) on a sample cut.
function vertical(arrange) {
  return { orient: { v: 'v', from: 'auto' }, arrange: { v: arrange, p: { offsetX: 0, offsetY: 0 } } };
}

// The glyphs' bodies on the frame at the scene's evaluated time: centre, half width and half height through the glyph's
// scale (not its turn or shear), and how visible it is.
function bodiesOf(scene) {
  const T = scene.target, m = scene.table.m, wa = scene.table.wa;
  const out = [];
  for (let j = 0; j < T.to - T.from; j++) {
    const i = T.from + j, o = i * 6, a = m[o], b = m[o + 1], c = m[o + 2], d = m[o + 3];
    const sx = Math.hypot(a, b), sy = sx > 1e-9 ? Math.abs(a * d - b * c) / sx : 0;
    out.push({ x: m[o + 4], y: m[o + 5], hw: (sx * T.w[j]) / 2, hh: (sy * T.h[j]) / 2, a: wa[i], space: T.cls[j] === 'space' });
  }
  return out;
}

// How much of the smaller of two bodies the other one covers (0..1).
function coverOf(p, q) {
  const ox = Math.min(p.x + p.hw, q.x + q.hw) - Math.max(p.x - p.hw, q.x - q.hw);
  const oy = Math.min(p.y + p.hh, q.y + q.hh) - Math.max(p.y - p.hh, q.y - q.hh);
  if (!(ox > 0 && oy > 0)) return 0;
  return (ox * oy) / Math.max(1e-9, Math.min(4 * p.hw * p.hh, 4 * q.hw * q.hh));
}

// The glyph bodies of an evaluated scene at rest (between the entrance and the exit).
function restBodies(scene) {
  F.evaluate(scene, (scene.times.rest + scene.times.out) / 2);
  return bodiesOf(scene);
}

// Where two visible glyphs of different words that do not touch at rest cover each other in a motion's window (60
// samples): [{ t, j, k, cover }].
function wordCollisions(scene, b) {
  const T = scene.target, rest = restBodies(scene), hits = [];
  for (let q = 0; q <= 60; q++) {
    const t = b.t0 + ((b.t1 - b.t0) * q) / 60;
    F.evaluate(scene, t);
    const now = bodiesOf(scene);
    for (let j = 0; j < now.length; j++) {
      for (let k = j + 1; k < now.length; k++) {
        if (T.unitOf.word[j] === T.unitOf.word[k] || now[j].space || now[k].space) continue;
        if (now[j].a < 0.35 || now[k].a < 0.35 || coverOf(rest[j], rest[k]) > 0.05) continue;
        const cover = coverOf(now[j], now[k]);
        if (cover > 0.3) hits.push({ t, j, k, cover });
      }
    }
  }
  return hits;
}

const QA_LAYOUTS = [
  ['16:9', 'Hold on to the light', null], ['9:16', 'Running through the midnight city', null],
  ['1:1', '君とDance tonight 光の中で', null], ['9:16', 'Hold on to the light', vertical('testColumns')],
  ['9:16', '夜明けの 街を、走る光', vertical('testColumns')],
];

// skewSlide comes in from the side the text goes on to (no word there yet) and skewExit leaves to the side it came from
// (the words before it have gone): from the right and to the left in horizontal text, mirrored for vertical columns.
test('skew slide and skew exit: a sliding word never runs into another word (horizontal and vertical text)', () => {
  for (const [kind, key] of [['arrive', 'skewSlide'], ['depart', 'skewExit']]) {
    for (const [aspect, text, extra] of QA_LAYOUTS) {
      const o = { aspect, text };
      const { scene } = sceneOf(Object.assign({ [kind]: decisionFor(kind, key, null, o) }, extra), o);
      const b = motionOf(scene, kind === 'depart');
      const hits = wordCollisions(scene, b);
      assert.equal(hits.length, 0, key + ' ' + aspect + ' ' + text + (extra ? ' (vertical)' : '') + ': glyphs ' +
        hits.slice(0, 3).map((h) => h.j + '/' + h.k + ' at ' + h.t.toFixed(2) + 's').join(', ') + ' run into each other');
    }
  }
});

// Blown glyphs all follow one path, so a glyph that leaves while those downwind of it still wait flies over them and
// the glyphs blown before it bunch up with it; the autos (wind to the left, order sweepX) take them from the downwind
// edge first. Checked on glyphs that leave at different times (a gust carries those that leave together side by side).
test('wind blow, with its autos: the blown glyphs neither fly over the waiting ones nor bunch up', () => {
  for (const [aspect, text, extra] of QA_LAYOUTS) {
    const o = { aspect, text };
    const { scene } = sceneOf(Object.assign({ depart: decisionFor('depart', 'windBlow', null, o) }, extra), o);
    const b = motionOf(scene, true), rest = restBodies(scene), T = scene.target;
    let worst = 0;
    for (let q = 0; q <= 60; q++) {
      F.evaluate(scene, b.t0 + ((b.t1 - b.t0) * q) / 60);
      const now = bodiesOf(scene);
      for (let j = 0; j < now.length; j++) {
        for (let k = j + 1; k < now.length; k++) {
          if (now[j].space || now[k].space || now[j].a < 0.35 || now[k].a < 0.35 || coverOf(rest[j], rest[k]) > 0.05) continue;
          if (b.delay[j] === b.delay[k]) continue;
          worst = Math.max(worst, coverOf(now[j], now[k]));
        }
      }
    }
    assert.ok(worst <= 0.3, 'wind blow ' + aspect + ' ' + text + (extra ? ' (vertical)' : '') + ': two glyphs cover ' +
      (worst * 100).toFixed(0) + ' % of each other (' + (T.to - T.from) + ' glyphs)');
  }
});

// A falling glyph must not pass through another glyph: below one that has landed it falls only from under it (fading
// in), below one still falling that lands later it keeps below it. Checked on glyphs one above the other (their cells
// overlap across the fall): a column, two columns, two horizontal lines; lead, scatter and tail orders.
test('drop snap and rain drop: a falling glyph never passes through a glyph above it', () => {
  const layouts = [['16:9', 'Running through the midnight city', null], ['9:16', '夜明けの街を、走る光', vertical('testColumn')],
    ['9:16', 'ありがとう さようなら', vertical('testColumns')], ['1:1', 'Hold on to the light', null]];
  for (const key of ['dropSnap', 'rainDrop']) {
    for (const order of ['lead', 'scatter', 'tail']) {
      for (const [aspect, text, extra] of layouts) {
        const o = { aspect, text };
        const { scene } = sceneOf(Object.assign({ arrive: decisionFor('arrive', key, { order }, o) }, extra), o);
        const b = motionOf(scene, false), T = scene.target, rest = restBodies(scene), n = T.to - T.from;
        const pairs = [];
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (i === j || T.cls[i] === 'space' || T.cls[j] === 'space' || T.unitOf.run[i] !== T.unitOf.run[j]) continue;
            if (!(T.y[i] < T.y[j]) || Math.abs(T.x[i] - T.x[j]) >= (T.w[i] + T.w[j]) / 2 - 0.5) continue;
            pairs.push([i, j, (rest[i].y + rest[i].hh) - (rest[j].y - rest[j].hh)]);
          }
        }
        assert.ok(pairs.length > 0 || !extra, key + ' ' + text + ': the layout stacks glyphs');
        for (let q = 0; q <= 80; q++) {
          F.evaluate(scene, b.t0 + ((b.t1 - b.t0) * q) / 80);
          const now = bodiesOf(scene);
          for (const [i, j, atRest] of pairs) {
            if (now[i].a < 0.5 || now[j].a < 0.5) continue;
            const into = (now[i].y + now[i].hh) - (now[j].y - now[j].hh) - Math.max(0, atRest);
            assert.ok(into < 0.3 * T.em[j], key + ' ' + order + ' ' + text + ': glyph ' + j + ' passes ' +
              (into / T.em[j]).toFixed(2) + ' em into glyph ' + i + ' above it');
          }
        }
      }
    }
  }
});

// A strobing glyph is dark over the first stretch of its time, so the mirrored exit never lights a glyph up again in the
// frames just before its end (the cut would then drop it while lit).
test('strobe in starts dark and strobe out ends dark: no flash right before a glyph is gone', () => {
  const p = { dur: 0.8, each: 0.02, order: 'lead' };
  for (const text of ['Running through the midnight city', 'はじまりの朝']) {
    const inS = sceneOf({ arrive: decisionFor('arrive', 'strobeIn', p, { text }) }, { text }).scene;
    const outS = sceneOf({ depart: decisionFor('depart', 'strobeOut', p, { text }) }, { text }).scene;
    const bIn = motionOf(inS, false), bOut = motionOf(outS, true);
    for (let j = 0; j < bIn.to - bIn.from; j++) {
      for (let u = 0.004; u < 0.1; u += 0.004) {
        F.evaluate(inS, timeAt(bIn, j, u));
        assert.ok(worldOf(inS, bIn.from + j).a < 1 / 255, text + ': strobe in lights glyph ' + j + ' at ' + u.toFixed(3));
        F.evaluate(outS, timeAt(bOut, j, 1 - u));
        assert.ok(worldOf(outS, bOut.from + j).a < 1 / 255, text + ': strobe out lights glyph ' + j + ' at ' + (1 - u).toFixed(3));
      }
    }
  }
});

// §4.15.2: in a vertical run 、。 and small kana are drawn off-centre in their cell (right and up); the caret belongs
// next to the cell, on the column's axis, not next to the drawn glyph.
test('the caret stands next to the cell of vertical punctuation and small kana, on the column axis', () => {
  const text = '夜、きょう。明日';
  for (const [kind, key] of [['arrive', 'typeOn'], ['depart', 'typeErase']]) {
    const { scene } = sceneOf(Object.assign({ [kind]: decisionFor(kind, key, null, { text }) }, vertical('testColumn')), { text });
    const b = motionOf(scene, kind === 'depart'), c = caretOf(scene), T = scene.target, n = b.to - b.from;
    F.evaluate(scene, (scene.times.rest + scene.times.out) / 2);
    const axis = worldOf(scene, b.from).x;                     // 夜 sits on the column's axis
    let shifted = 0;
    for (let j = 1; j < n - 1; j++) {
      F.evaluate(scene, (scene.times.rest + scene.times.out) / 2);
      const g = worldOf(scene, b.from + j), prev = worldOf(scene, b.from + j - 1), next = worldOf(scene, b.from + j + 1);
      if (Math.abs(g.x - axis) < 0.02 * T.em[j]) continue;
      shifted++;
      const cellY = (prev.y + next.y) / 2;                     // cells follow one another evenly down the column
      F.evaluate(scene, c.when[j] + 1e-3);
      const k = worldOf(scene, c.from);
      const want = cellY + (kind === 'arrive' ? 1 : -1) * T.h[j] / 2;
      assert.ok(k.a > 0.99, key + ': caret lit at glyph ' + j);
      assert.ok(Math.abs(k.x - axis) < 0.05 * T.em[j], key + ': caret on the column axis at glyph ' + j + ' (' + (k.x - axis).toFixed(1) + ' du off)');
      assert.ok(Math.abs(k.y - want) < 0.15 * T.em[j], key + ': caret next to the cell of glyph ' + j + ' (' + (k.y - want).toFixed(1) + ' du off)');
    }
    assert.ok(shifted >= 3, key + ': the sample has off-centre glyphs (found ' + shifted + ')');
  }
});

// The pile lies on the frame's floor between its sides, also when a column stands against the edge of a narrow frame.
test('pile collapse: the pile stays inside the frame', () => {
  for (const [aspect, text, extra] of QA_LAYOUTS) {
    const o = { aspect, text };
    const { plan, scene } = sceneOf(Object.assign({ depart: decisionFor('depart', 'pileCollapse', null, o) }, extra), o);
    const b = motionOf(scene, true), W = plan.design.w;
    for (const u of [0.7, 0.8, 0.9]) {
      for (let j = 0; j < b.to - b.from; j++) {
        if (scene.target.cls[j] === 'space') continue;
        F.evaluate(scene, timeAt(b, j, u));
        const g = bodiesOf(scene)[j];
        assert.ok(g.x - g.hw >= 0 && g.x + g.hw <= W, 'pile ' + aspect + ' ' + text + (extra ? ' (vertical)' : '') + ': glyph ' + j +
          ' lies at ' + (g.x - g.hw).toFixed(0) + '…' + (g.x + g.hw).toFixed(0) + ', outside 0…' + W);
      }
    }
  }
});
