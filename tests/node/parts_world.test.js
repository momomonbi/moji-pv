/* 文字PVメーカー v2 — original work. Tests: the background and decoration catalog (parts/ground, parts/ornament) against DESIGN §5.5, §5.6, §4.17–§4.19, §7.1. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { load } = require('../helpers/load.js');
const corpus = require('../helpers/corpus.js');

// Every part also runs the §8.2 conformance matrix (conformance.test.js), and the browser test ground_contrast.py checks
// that every background keeps the text readable in every theme. This file checks what is particular to these two kinds:
// the §5.5/§5.6 tables, random access in time (§1.3.4) including segments as long as a song, that a background reads
// nothing of its segment's cuts (its fingerprint does not cover them), the §7.4 budgets at the heaviest pinnable
// params, the §4.19.4 backdrop colours, and the behaviour each picture promises (beats, loudness, start times, seals …).

const MV = load();
const REG = MV.use('core/registry');
const H = MV.use('core/hash');
const C = MV.use('core/color');
const PINS = MV.use('core/pins');
const LOOK = MV.use('planner/look');
const BUILD = MV.use('engine/scene/build');
const F = MV.use('engine/scene/frame');
const R = MV.use('engine/render/record');
const FAC = MV.use('engine/facade');
const T = MV.use('engine/scene/table');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');

const WORLD_MODULE = /^parts\/(ground|ornament)\//;
const MODULES = MV.ids('parts/').filter((id) => WORLD_MODULE.test(id));
const DEFS = MODULES.flatMap((id) => MV.use(id));
const HOSTS = corpus.minimalFallbacks().filter((d) => d.kind !== 'ground' && d.kind !== 'ornament');
const REGISTRY = REG.createRegistry(DEFS.concat(HOSTS));
const MEASURER = fakeMeasurer();
const ASPECTS = ['16:9', '9:16', '21:9'];

// --- DESIGN §5.5 / §5.6 as data -------------------------------------------------------------------------------------

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
    const row = { key: /`(\w+)`/.exec(l)[1], note: (/`\w+`\s*\(([^)]*)\)/.exec(cells(l)[0]) || [])[1] || '' };
    cells(l).forEach((c, i) => { row[head[i]] = c; });
    return row;
  });
}

const GROUNDS = tableOf('ground');
const ORNAMENTS = tableOf('ornament');

// DESIGN_2_1 §11.5.7 (it wins over DESIGN.md): photoPan's new label, and the media ornaments of parts/ornament/media.js
// (every one pool: false, tags ['soft']).
const DESIGN_2_1 = fs.readFileSync(path.join(__dirname, '..', '..', 'docs', 'DESIGN_2_1.md'), 'utf8');
const MEDIA_PARTS = DESIGN_2_1.slice(DESIGN_2_1.indexOf('#### 11.5.7 '), DESIGN_2_1.indexOf('#### 11.5.8 '));
const PHOTO_LABEL = (() => { const m = /Its label becomes (\S+) \/ ([^.]+)\./.exec(MEDIA_PARTS); return { ja: m[1], en: m[2] }; })();
const MEDIA_ORNAMENTS = MEDIA_PARTS.split('\n').filter((l) => l.startsWith('| `')).map((l) => {
  const c = cells(l);
  const [ja, en] = c[1].split(' / ');
  const [scope, follow] = c[2].split(', ');
  return { key: /`(\w+)`/.exec(c[0])[1], ja, en, scope: scope.split(' ')[0], follow };
});

function def(kind, key) { return REGISTRY.get(kind, key); }

// --- scenes and frames ------------------------------------------------------------------------------------------------

function svcOf(plan) { return { registry: REGISTRY, text: createTextService({ measurer: MEASURER, faces: plan.look.faces }), strict: true }; }

function sample(kind, key, opts) { return FAC.samplePlan(REGISTRY, { kind, key, params: opts && opts.params }, opts || {}); }

// The scene a part lives in: the segment's ground scene for grounds and atmospheres, the cut's scene otherwise.
function sceneOf(plan, d) {
  const svc = svcOf(plan);
  return d.kind === 'ground' || d.scope === 'run' ? BUILD.buildGround(plan.grounds[0], plan, svc) : BUILD.buildCut(plan.cuts[0], plan, svc);
}

// The recorder names gradients and patterns by a running counter ('g12'); number them per frame instead, so a frame's
// hash does not depend on how many were made before it.
function frameHash(ops) {
  const names = new Map();
  const local = (v) => {
    if (typeof v !== 'string') return v;
    return v.replace(/^([gp]\d+)(?=$|\.)/, (id) => {
      if (!names.has(id)) names.set(id, id[0] + '#' + names.size);
      return names.get(id);
    });
  };
  return H.hashJSON(ops.map((op) => op.map(local)));
}

// Op hash of each frame at the local times, drawn in the given order into one recorder (as a preview would, scrubbing).
function frameHashes(plan, scene, times) {
  const rec = R.createRecorder();
  const surf = R.surfaceOf(rec.factory, 320, 180, false);
  const out = new Map();
  for (const tl of times) {
    F.evaluate(scene, tl);
    const mark = rec.mark();
    R.drawScene(surf.ctx, scene, { scale: 320 / plan.design.w, W: plan.design.w, H: plan.design.h, pal: plan.look.palette, tl });
    out.set(tl, frameHash(rec.ops().slice(mark)));
    assert.ok(rec.stats().balanced, 'save/restore balanced');
  }
  return out;
}

function localTimes(scene, n) {
  const { a, b } = scene.times;
  return Array.from({ length: n }, (_, k) => a + ((b - a) * (k + 0.5)) / n);
}

// --- the tables -------------------------------------------------------------------------------------------------------

test('§5.5 backgrounds: every key, label, tag and season of the table, and nothing else', () => {
  const keys = REGISTRY.keys('ground');
  assert.equal(GROUNDS.length, 18);
  assert.deepEqual(keys, GROUNDS.map((r) => r.key).sort());
  for (const row of GROUNDS) {
    const d = def('ground', row.key);
    assert.deepEqual(d.label, row.key === 'photoPan' ? PHOTO_LABEL : { ja: row.ja, en: row.en }, row.key + ' label');
    assert.deepEqual(d.tags.slice().sort(), row.Tags.split(/\s+/).sort(), row.key + ' tags');
    assert.equal(d.season, row.Season || null, row.key + ' season');
    assert.equal(d.fallback, row.note === 'fb', row.key + ' fallback');
    assert.equal(d.pool, !/pool false/.test(row.note), row.key + ' pool');
    if (/needs level/.test(row.Picture)) assert.ok(d.needs.includes('level'), row.key + ' needs level');
  }
});

test('§5.6 decorations: every key, label, scope, tag and season of the table, and nothing else', () => {
  assert.equal(ORNAMENTS.length, 22);
  assert.equal(MEDIA_ORNAMENTS.length, 3);
  assert.deepEqual(REGISTRY.keys('ornament'), ORNAMENTS.concat(MEDIA_ORNAMENTS).map((r) => r.key).sort());
  for (const row of MEDIA_ORNAMENTS) {
    const d = def('ornament', row.key);
    assert.deepEqual([d.label, d.scope, d.follow, d.tags, d.season, d.fallback, d.pool, d.needs],
      [{ ja: row.ja, en: row.en }, row.scope, row.follow, ['soft'], null, false, false, ['media']], row.key + ' (DESIGN_2_1 §11.5.7)');
  }
  for (const row of ORNAMENTS) {
    const d = def('ornament', row.key);
    assert.deepEqual(d.label, { ja: row.ja, en: row.en }, row.key + ' label');
    assert.equal(d.scope, row.Scope, row.key + ' scope');
    assert.deepEqual(d.tags.slice().sort(), row.Tags.split(/\s+/).sort(), row.key + ' tags');
    assert.equal(d.season, row.Season || null, row.key + ' season');
    assert.equal(d.fallback, row.note === 'fb', row.key + ' fallback');
    if (d.scope === 'run') assert.equal(d.follow, 'own', row.key + ': an atmosphere has no text to follow');
    else {
      const roles = REGISTRY.traits('ornament', row.key).roles;
      assert.ok(roles.includes('lyric') && roles.includes('focus'), row.key + ' serves lyric and focus cuts');
    }
  }
});

test('the definitions validate strictly; blurbs are one sentence; every param has ja/en labels', () => {
  assert.equal(REGISTRY.problems.length, 0);
  for (const d of DEFS) {
    for (const lang of ['ja', 'en']) {
      const b = d.blurb[lang];
      assert.ok(b && b.length > 4, d.key + ' blurb ' + lang);
      assert.ok(!/[。．!?！？]\s*\S/.test(b) && !/\.\s+\S/.test(b), d.key + ' blurb ' + lang + ' is one sentence: ' + b);
    }
    for (const [name, spec] of Object.entries(d.params)) assert.ok(spec.label.ja && spec.label.en, d.key + '.' + name + ' label');
  }
  assert.equal(REGISTRY.fallback('ground'), 'flatFill');
  assert.equal(REGISTRY.fallback('ornament'), 'hairFrame');
  assert.deepEqual(REGISTRY.pool('ground', {}).includes('photoPan'), false, 'photoPan is pin only');
});

// --- closed form, and what a scene may read ---------------------------------------------------------------------------

test('random access in time: every frame is the same drawn in order, in reverse or alone (all parts, three aspects)', () => {
  for (const d of DEFS) {
    for (const aspect of ASPECTS) {
      const plan = sample(d.kind, d.key, { aspect });
      const times = localTimes(sceneOf(plan, d), 9);
      const forward = frameHashes(plan, sceneOf(plan, d), times);
      const backward = frameHashes(plan, sceneOf(plan, d), times.slice().reverse());
      for (const t of times) assert.equal(backward.get(t), forward.get(t), d.key + ' ' + aspect + ' at ' + t.toFixed(3));
      const lone = frameHashes(plan, sceneOf(plan, d), [times[5]]);
      assert.equal(lone.get(times[5]), forward.get(times[5]), d.key + ' ' + aspect + ' alone');
    }
  }
});

test('backgrounds and atmospheres read nothing of the segment\'s first cut (the segment fingerprint does not cover it)', () => {
  const runs = DEFS.filter((d) => d.kind === 'ground' || d.scope === 'run');
  for (const d of runs) {
    const plan = sample(d.kind, d.key, { aspect: '16:9' });
    const other = JSON.parse(JSON.stringify(plan));
    Object.defineProperty(other, 'env', { enumerable: false, value: plan.env });
    const cut = other.cuts[0];
    Object.assign(cut, { text: 'まったく別の行', emph: [], impact: true, role: 'focus' });
    Object.assign(cut.feat, { energy: 0.97, cells: 7, dur: 4.4, pos: 0.8, section: 'chorus' });
    const times = localTimes(sceneOf(plan, d), 5);
    const a = frameHashes(plan, sceneOf(plan, d), times), b = frameHashes(other, sceneOf(other, d), times);
    for (const t of times) assert.equal(b.get(t), a.get(t), d.key + ' at ' + t.toFixed(2));
  }
});

// A background or atmosphere sample whose segment lasts `seconds`: one ground pin at work scope makes a single segment
// of the whole song (§4.16.6), so closed-form drifts must hold for any t, not only for a few seconds.
function longPlan(kind, key, aspect, seconds, params) {
  const plan = sample(kind, key, { aspect, params });
  plan.grounds[0].t1 = seconds;
  plan.duration = seconds;
  return plan;
}

// The drawn items of one frame's ops, in design units: the centroid of every subpath (a petal, a leaf, a ring, a spark,
// a particle) and the centre of every filled rectangle, found by following the transforms the ops set up.
function itemsOf(ops, scale) {
  let m = [1, 0, 0, 1, 0, 0], sx = 0, sy = 0, sn = 0;
  const stack = [], out = [];
  const mul = (a, b, c, d, e, f) => {
    m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4],
      m[1] * e + m[3] * f + m[5]];
  };
  const at = (x, y) => [(m[0] * x + m[2] * y + m[4]) / scale, (m[1] * x + m[3] * y + m[5]) / scale];
  const add = (x, y) => { const p = at(x, y); sx += p[0]; sy += p[1]; sn++; };
  const flush = () => { if (sn) out.push([sx / sn, sy / sn]); sx = 0; sy = 0; sn = 0; };
  for (const op of ops) {
    const name = op[1], a = op.slice(2);
    if (name === 'save') stack.push(m);
    else if (name === 'restore') m = stack.pop() || m;
    else if (name === 'setTransform') m = a.slice(0, 6);
    else if (name === 'transform') mul(...a);
    else if (name === 'translate') mul(1, 0, 0, 1, a[0], a[1]);
    else if (name === 'scale') mul(a[0], 0, 0, a[1], 0, 0);
    else if (name === 'rotate') mul(Math.cos(a[0]), Math.sin(a[0]), -Math.sin(a[0]), Math.cos(a[0]), 0, 0);
    else if (name === 'moveTo') { flush(); add(a[0], a[1]); }
    else if (name === 'lineTo' || name === 'arc' || name === 'ellipse') add(a[0], a[1]);
    else if (name === 'quadraticCurveTo') add(a[2], a[3]);
    else if (name === 'bezierCurveTo') add(a[4], a[5]);
    else if (name === 'rect') { flush(); add(a[0] + a[2] / 2, a[1] + a[3] / 2); flush(); }
    else if (name === 'beginPath' || name === 'fill' || name === 'stroke') flush();
    else if (name === 'fillRect' || name === 'strokeRect') out.push(at(a[0] + a[2] / 2, a[1] + a[3] / 2));
  }
  flush();
  return out;
}

const HALVES = ['left', 'right', 'top', 'bottom'];

// Items inside the frame per half (left, right, top, bottom), averaged over thirty frames a second apart from t0 (long
// enough that parts placing things at random moments, such as fireworkBloom's bursts, average out).
function coverage(plan, scene, t0) {
  const { w, h } = plan.design, scale = 320 / w, acc = [0, 0, 0, 0], n = 30;
  const rec = R.createRecorder();
  const surf = R.surfaceOf(rec.factory, 320, Math.round(h * scale), false);
  for (let k = 0; k < n; k++) {
    const tl = t0 + k;
    F.evaluate(scene, tl);
    const mark = rec.mark();
    R.drawScene(surf.ctx, scene, { scale, W: w, H: h, pal: plan.look.palette, tl });
    for (const [x, y] of itemsOf(rec.ops().slice(mark), scale)) {
      if (x < 0 || x > w || y < 0 || y > h) continue;
      acc[x < w / 2 ? 0 : 1]++;
      acc[y < h / 2 ? 2 : 3]++;
    }
  }
  return acc.map((v) => v / n);
}

test('long segments: what drifts stays spread over the frame at 60 s and 300 s (§1.3.4, §7.1.4)', () => {
  // Every count param at its maximum, so a half of the frame holds enough items for the counts to mean something.
  for (const d of DEFS.filter((x) => x.kind === 'ground' || x.scope === 'run')) {
    const params = {};
    for (const { name, spec } of REGISTRY.params(d.kind, d.key)) if (spec.type === 'int' && !spec.shared) params[name] = spec.max;
    for (const aspect of ['16:9', '9:16']) {
      const plan = longPlan(d.kind, d.key, aspect, 330, params);
      const scene = sceneOf(plan, d);
      const first = coverage(plan, scene, 0.5);
      for (const t0 of [60, 300]) {
        const later = coverage(plan, scene, t0);
        HALVES.forEach((half, i) => assert.ok(later[i] >= 0.6 * first[i] - 2, d.key + ' ' + aspect + ': the ' + half + ' half holds ' +
          later[i] + ' items from ' + t0 + ' s, against ' + first[i] + ' at the start'));
      }
    }
  }
});

// --- what the pictures promise ----------------------------------------------------------------------------------------

function paintData(scene) { return scene.stores.paint.map((p) => p.data).filter(Boolean); }

test('sparkSpray bursts on every n-th beat while the text is up, at the sung start of an impact line, and without a grid', () => {
  const plan = sample('ornament', 'sparkSpray', { params: { every: 1 } });
  const scene = sceneOf(plan, def('ornament', 'sparkSpray'));
  const times = Array.from(paintData(scene)[0].times);
  const grid = F.gridAt(plan, plan.cuts[0].t0);
  assert.ok(times.length >= 3, 'several bursts');
  for (const t of times) {
    assert.ok(Math.abs(grid.snap(t) - t) < 1e-4, 'burst ' + t + ' is on a beat');
    assert.ok(t >= scene.times.a && t <= scene.times.out, 'burst ' + t + ' while the text is up');
  }
  const every2 = Array.from(paintData(sceneOf(sample('ornament', 'sparkSpray', { params: { every: 2 } }), def('ornament', 'sparkSpray')))[0].times);
  assert.ok(every2.length < times.length && every2.every((t) => times.some((u) => Math.abs(u - t) < 1e-4)), 'every 2nd beat is a subset');
  const impact = sample('ornament', 'sparkSpray', { params: { every: 4 } });
  impact.cuts[0].impact = true;
  assert.ok(Array.from(paintData(sceneOf(impact, def('ornament', 'sparkSpray')))[0].times).includes(0), 'an impact bursts at the sung start');
  const free = sample('ornament', 'sparkSpray', { params: { every: 1 } });
  free.beats = null;
  const pulses = Array.from(paintData(sceneOf(free, def('ornament', 'sparkSpray')))[0].times);
  assert.ok(pulses.length >= 3 && pulses.every((t, k) => k === 0 || Math.abs(t - pulses[k - 1] - 0.5) < 1e-4), 'half-second pulses without a grid');
});

// A copy of a plan with some times of its first cut moved by dt, or with a flat loudness envelope.
function withCutTimes(plan, keys, dt) {
  const out = JSON.parse(JSON.stringify(plan));
  Object.defineProperty(out, 'env', { enumerable: false, value: plan.env });
  for (const k of keys) out.cuts[0][k] += dt;
  return out;
}

function withLevel(plan, level) {
  const out = JSON.parse(JSON.stringify(plan));
  Object.defineProperty(out, 'env', { enumerable: false, value: new Float32Array(plan.env.length).fill(level) });
  return out;
}

// The shape records a slot's part built in a cut scene, in build order.
function ownShapes(scene, el) {
  const owner = scene.owners.findIndex((o) => o.el === el);
  const out = [];
  for (let i = 0; i < scene.table.n; i++) {
    if (scene.table.type[i] === T.TYPE.shape && scene.table.owner[i] === owner) out.push(scene.stores.shape[scene.table.payload[i]]);
  }
  return out;
}

test('barCode prints the cut\'s start time; its bars follow the loudness; neonHaze breathes with the loudness', () => {
  const bar = def('ornament', 'barCode');
  const pts = (list) => list.map((s) => Array.from(s.path.pts));
  const parts = (plan) => {
    const shapes = ownShapes(sceneOf(plan, bar), 'ornament#0');
    return { bars: pts(shapes.filter((s) => s.stroke === null)), digits: pts(shapes.filter((s) => s.stroke !== null)) };
  };
  // react 0: the bars stand still, so only the printed time can tell two builds apart
  const still = sample('ornament', 'barCode', { params: { react: 0 } });
  const base = parts(still), later = parts(withCutTimes(still, ['t0', 't1', 'a', 'b'], 61.5));
  assert.equal(base.digits.length, 1, 'one stroked shape: the digits');
  assert.deepEqual(later.bars, base.bars, 'the same bars');
  assert.notDeepEqual(later.digits, base.digits, 'a cut starting 61.5 s later prints another time');
  assert.deepEqual(parts(withCutTimes(still, ['a'], -0.3)).digits, base.digits, 'the time is the sung start, not the window');
  const t = [0.5];
  const hash = (plan) => frameHashes(plan, sceneOf(plan, bar), t).get(0.5);
  assert.equal(hash(withLevel(still, 0.05)), hash(still), 'react 0: loudness changes nothing');
  const reacting = sample('ornament', 'barCode', { params: { react: 1 } });
  assert.notEqual(hash(withLevel(reacting, 0.05)), hash(withLevel(reacting, 0.95)), 'the bars shrink when the song is quiet');
  const haze = def('ground', 'neonHaze');
  const loud = sample('ground', 'neonHaze'), quiet = withLevel(loud, 0.05);
  assert.notEqual(frameHashes(quiet, sceneOf(quiet, haze), t).get(0.5), frameHashes(loud, sceneOf(loud, haze), t).get(0.5));
});

test('fireworkBloom: every shell rises from below the frame, whenever its burst falls (closed form over a minute)', () => {
  const plan = longPlan('ornament', 'fireworkBloom', '16:9', 62, { rate: 3.5 });
  const scene = sceneOf(plan, def('ornament', 'fireworkBloom'));
  const { w, h } = plan.design, fps = 30;
  const rec = R.createRecorder();
  const surf = R.surfaceOf(rec.factory, 320, 180, false);
  const firstSeen = new Map();                                  // shell x → [time, top of the trail] when first drawn
  for (let f = 0; f <= 60 * fps; f++) {
    const tl = f / fps;
    F.evaluate(scene, tl);
    const mark = rec.mark();
    R.drawScene(surf.ctx, scene, { scale: 320 / w, W: w, H: h, pal: plan.look.palette, tl });
    const ops = rec.ops().slice(mark);
    // a shell is a path of one vertical 40-du stroke: beginPath, moveTo(x, y), lineTo(x, y + 40), stroke
    for (let k = 0; k + 3 < ops.length; k++) {
      const [b, m, l, s] = ops.slice(k, k + 4);
      if (b[1] !== 'beginPath' || m[1] !== 'moveTo' || l[1] !== 'lineTo' || s[1] !== 'stroke') continue;
      if (m[2] !== l[2] || Math.abs(l[3] - m[3] - 40) > 1e-2) continue;
      if (!firstSeen.has(m[2])) firstSeen.set(m[2], [tl, m[3]]);
    }
  }
  const late = [...firstSeen.values()].filter(([tl]) => tl > 0);
  assert.ok(late.length >= 12, late.length + ' shells in a minute at 3.5 bursts per 10 s');
  for (const [tl, y] of late) assert.ok(y >= 0.97 * h, 'the shell first drawn at ' + tl.toFixed(2) + ' s starts at y = ' + y + ', not at the bottom');
});

function sealGlyph(text, emph) {
  const plan = sample('ornament', 'hankoSeal', { text });
  plan.cuts[0].emph = emph;
  const scene = sceneOf(plan, def('ornament', 'hankoSeal'));
  const owner = scene.owners.findIndex((o) => o.el === 'ornament#0');
  const glyphs = [];
  for (let i = 0; i < scene.table.n; i++) {
    if (scene.table.type[i] === T.TYPE.glyph && scene.table.owner[i] === owner) glyphs.push(scene.stores.glyph[scene.table.payload[i]].ch);
  }
  return glyphs.join('');
}

test('hankoSeal carves a kanji of the emphasis, else the last kanji, else the first letter', () => {
  assert.equal(sealGlyph('夜明けの街を走る', [[4, 5]]), '街');
  assert.equal(sealGlyph('夜明けの街を走る', []), '走');
  assert.equal(sealGlyph('ありがとう', []), 'あ');
  assert.equal(sealGlyph('paper planes', []), 'P');
});

function serialChars(params, pos) {
  const plan = sample('ornament', 'serialMark', { params });
  if (pos !== undefined) plan.cuts[0].feat.pos = pos;
  const scene = sceneOf(plan, def('ornament', 'serialMark'));
  return scene.behaviours.find((b) => b.run.name === 'runTypeOn').nodes.length;
}

test('serialMark: the auto number is the line\'s place in the song (two digits); a pinned number is drawn as given', () => {
  const spec = REGISTRY.params('ornament', 'serialMark').find((x) => x.name === 'number').spec;
  assert.equal(spec.auto.fn({ pos: 0.07 }), '07');
  assert.equal(spec.auto.fn({ pos: 0.999 }), '99');
  assert.equal(serialChars(undefined), 2);
  assert.equal(serialChars({ number: '100' }), 3);
  assert.equal(serialChars({ number: '07-2' }), 4);
  assert.equal(serialChars({ number: 'No.7' }), 2, 'what the stroke font cannot draw is left out');
});

// DESIGN_2_1 §11.5.7: the image is an asset of the plan's media (a v2 text value such as 'asset:test' is no id), and the
// picture is K.media's node. With the edge rule 'zoom' it covers the bleed as v2's photoPan did; the default 'mirror'
// fits the frame and fills the bleed with flipped copies (media_engine.test.js).
test('photoPan: pin only; with an image it pans and zooms closed-form and always covers the frame', () => {
  const d = def('ground', 'photoPan');
  const bare = sceneOf(sample('ground', 'photoPan'), d);
  assert.equal(bare.stores.image.length, 0, 'no image: a plain ground');
  const old = sample('ground', 'photoPan', { params: { image: 'asset:test' } });
  assert.equal(sceneOf(old, d).stores.image.length, 0, 'a v2 text value is no asset id: a plain ground');
  const id = 'a' + '7'.repeat(24);
  const plan = sample('ground', 'photoPan', { params: { image: id, zoom: 0.2, pan: 30, veil: 0.4, edge: 'zoom', move: 'auto', depth: 'anim' } });
  plan.media = { [id]: { kind: 'image', w: 3000, h: 2000, dur: null, fps: null, frames: null, rot: 0, alpha: false, anim: false } };
  const scene = sceneOf(plan, d);
  assert.equal(scene.stores.image.length, 1);
  assert.equal(scene.stores.image[0].media, true);
  const img = scene.table.type.findIndex((ty) => ty === T.TYPE.image);
  const { w, h } = plan.design;
  let prevScale = 0;
  for (const tl of [0, scene.times.b / 2, scene.times.b]) {
    F.evaluate(scene, tl);
    const m = Array.from(scene.table.m.slice(img * 6, img * 6 + 6));
    const box = scene.stores.image[0].box;
    const at = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const [x0, y0] = at(box.x, box.y), [x1, y1] = at(box.x + box.w, box.y + box.h);
    assert.ok(x0 <= -0.15 * w + 1e-3 && y0 <= -0.15 * h + 1e-3 && x1 >= 1.15 * w - 1e-3 && y1 >= 1.15 * h - 1e-3, 'covers the bleed at ' + tl);
    assert.ok(m[0] > prevScale, 'zooms in over the segment');
    prevScale = m[0];
  }
});

test('hairFrame draws itself during the entrance and is whole while the text rests', () => {
  const plan = sample('ornament', 'hairFrame');
  const scene = sceneOf(plan, def('ornament', 'hairFrame'));
  const grow = scene.behaviours.find((b) => b.run.name === 'runGrow');
  const sx = (t) => { F.evaluate(scene, t); return Array.from(grow.nodes, (i) => scene.table.live.sx[i]); };
  assert.ok(sx(scene.times.a).every((v) => v < 0.01), 'nothing drawn at the start of the cut');
  const whole = grow.s[3] + grow.d[3] + 0.01;
  assert.ok(sx(whole).every((v) => Math.abs(v - 1) < 1e-6), 'the four sides are whole');
  assert.ok(sx(scene.times.b - 1e-4).every((v) => v < 0.05), 'retracted by the end of the cut');
});

test('texture-free fallback: flatFill is static (drawn once and cached) and paints the whole frame and its bleed', () => {
  const plan = sample('ground', 'flatFill');
  const scene = sceneOf(plan, def('ground', 'flatFill'));
  assert.ok(scene.stores.paint.every((p) => p.animated === false), 'not animated');
  const rec = R.createRecorder();
  const surf = R.surfaceOf(rec.factory, 100, 100, false);
  F.evaluate(scene, 0);
  R.drawScene(surf.ctx, scene, { scale: 1, W: plan.design.w, H: plan.design.h, pal: plan.look.palette, tl: 0 });
  const fill = rec.ops().find((op) => op[1] === 'fillRect');
  assert.deepEqual(fill.slice(2), [-0.15 * 1920, -0.15 * 1080, 1.3 * 1920, 1.3 * 1080].map((v) => Math.round(v * 1000) / 1000));
});

test('per-frame work stays small: path points and paints per frame at 16:9 (DESIGN §7.4 budgets)', () => {
  for (const d of DEFS) {
    const plan = sample(d.kind, d.key, { aspect: '16:9' });
    const scene = sceneOf(plan, d);
    const rec = R.createRecorder();
    const surf = R.surfaceOf(rec.factory, 320, 180, false);
    let worst = 0, gradients = 0;
    for (const tl of localTimes(scene, 6)) {
      F.evaluate(scene, tl);
      const mark = rec.mark();
      R.drawScene(surf.ctx, scene, { scale: 1 / 6, W: plan.design.w, H: plan.design.h, pal: plan.look.palette, tl });
      const ops = rec.ops().slice(mark);
      worst = Math.max(worst, ops.length);
      gradients = Math.max(gradients, ops.filter((op) => /Gradient$/.test(op[1])).length);
    }
    assert.ok(worst <= 9000, d.key + ': ' + worst + ' drawing calls in one frame');
    assert.ok(gradients <= 16, d.key + ': ' + gradients + ' gradients in one frame (§7.2)');
  }
});

// Drawing calls at the local times: `frame` is the most one frame redraws; `still` the calls of the static rasters
// (paints with animated: false), which the renderer draws once per segment and output size and then only moves
// (§4.19.6); `gradients` the most gradients one frame creates.
function workOf(plan, scene, times) {
  const rec = R.createRecorder();
  const surf = R.surfaceOf(rec.factory, 320, 180, false);
  const pal = plan.look.palette, scale = 1 / 6;
  const q = { draft: false, scale, pal, rgba: (ink, a) => C.rgba(R.inkOf(pal, ink), a), tile: () => null };
  let frame = 0, still = 0, gradients = 0;
  for (const tl of times) {
    F.evaluate(scene, tl);
    let mark = rec.mark();
    R.drawScene(surf.ctx, scene, { scale, W: plan.design.w, H: plan.design.h, pal, tl });
    const ops = rec.ops().slice(mark);
    mark = rec.mark();
    for (const p of scene.stores.paint) if (!p.animated) p.draw(surf.ctx, tl, p.data, q);
    const rasters = rec.ops().length - mark;
    frame = Math.max(frame, ops.length - rasters);
    still = Math.max(still, rasters);
    gradients = Math.max(gradients, ops.filter((op) => /Gradient$/.test(op[1])).length);
  }
  return { frame, still, gradients };
}

// The heaviest params a user can pin (§3.5: a pin is only coerced into its schema), found greedily: each number,
// switch and choice param in turn takes the value (either end of its range, or an option) that makes cost(params)
// largest, keeping the values chosen before it.
function heaviestParams(d, cost) {
  const params = {};
  let worst = cost(params);
  for (const { name, spec } of REGISTRY.params(d.kind, d.key)) {
    const options = spec.type === 'int' || spec.type === 'num' ? [spec.min, spec.max] : spec.type === 'bool' ? [false, true]
      : spec.type === 'enum' ? spec.of : [];
    for (const v of options) {
      const c = cost(Object.assign({}, params, { [name]: v }));
      if (c > worst) { worst = c; params[name] = v; }
    }
  }
  return params;
}

test('per-frame work stays small at the heaviest pinnable params too (21:9, the widest frame; export never degrades)', () => {
  const STILL_MAX = 16000;           // one static raster per segment and output size
  const work = (d, params) => {
    const plan = sample(d.kind, d.key, { aspect: '21:9', params });
    const scene = sceneOf(plan, d);
    return workOf(plan, scene, localTimes(scene, 4));
  };
  for (const d of DEFS) {
    const busy = heaviestParams(d, (params) => work(d, params).frame), w = work(d, busy);
    assert.ok(w.frame <= 9000, d.key + ': ' + w.frame + ' drawing calls in one frame with ' + JSON.stringify(busy));
    assert.ok(w.gradients <= 16, d.key + ': ' + w.gradients + ' gradients in one frame with ' + JSON.stringify(busy) + ' (§7.2)');
    const big = heaviestParams(d, (params) => work(d, params).still), s = work(d, big);
    assert.ok(s.still <= STILL_MAX, d.key + ': ' + s.still + ' drawing calls in its static raster with ' + JSON.stringify(big));
  }
});

// --- backdrop modes (§4.19.4) ------------------------------------------------------------------------------------------

// [r, g, b, a] of a colour the ops set ('#RRGGBB' or 'rgba(…)'), or null for a gradient or pattern id.
function rgbaOf(v) {
  if (typeof v !== 'string') return null;
  if (/^#[0-9a-f]{6}$/i.test(v)) { const n = parseInt(v.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]; }
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(v);
  return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
}

// Every visible colour one frame draws with (fills, strokes, gradient stops), and its composite operations.
function inksOf(ops) {
  const colors = [], composites = new Set();
  for (const op of ops) {
    const v = op[1] === 'set:fillStyle' || op[1] === 'set:strokeStyle' ? op[2] : /\.addColorStop$/.test(op[1]) ? op[3] : null;
    const c = rgbaOf(v);
    if (c && c[3] > 0) colors.push(c);
    if (op[1] === 'set:globalCompositeOperation') composites.add(op[2]);
  }
  return { colors, composites };
}

const KEY_GREEN = '#00B140';

// Within the keyer's reach: a saturated colour whose hue is close to the key green's.
function keyedOut([r, g, b]) {
  return Math.max(r, g, b) - Math.min(r, g, b) > 48 && C.hueDistance(C.toHex({ r, g, b }), KEY_GREEN) < 40;
}

test('backdrops: black mode draws only white and greys; a green screen gets no key green, no green tint, no added light', () => {
  const themes = MV.ids('parts/theme/').flatMap((id) => MV.use(id));
  for (const themeKey of ['sumiWashi', 'nightTram']) {                   // a light and a dark theme, no greenish tokens
    const theme = themes.find((t) => t.key === themeKey);
    for (const backdrop of ['black', 'chroma']) {
      const pal = LOOK.palette(theme, PINS.index({}), backdrop, () => {});   // the planner's palette (§4.16.3)
      for (const d of DEFS.filter((x) => x.kind === 'ornament')) {
        const plan = sample('ornament', d.key, { palette: pal, backdrop });
        const scene = sceneOf(plan, d);
        const rec = R.createRecorder();
        const surf = R.surfaceOf(rec.factory, 320, 180, false);
        for (const tl of localTimes(scene, 5)) {
          F.evaluate(scene, tl);
          const mark = rec.mark();
          R.drawScene(surf.ctx, scene, { scale: 1 / 6, W: plan.design.w, H: plan.design.h, pal, backdrop, tl });
          const { colors, composites } = inksOf(rec.ops().slice(mark));
          const where = d.key + ' (' + themeKey + ', ' + backdrop + ', t ' + tl.toFixed(2) + ')';
          if (backdrop === 'black') {
            const tinted = colors.find(([r, g, b]) => Math.abs(r - g) > 1 || Math.abs(g - b) > 1);
            assert.equal(tinted, undefined, where + ' draws a colour in black mode');
          } else {
            assert.equal(colors.find(keyedOut), undefined, where + ' draws a colour the keyer would take');
            assert.ok(!composites.has('lighter'), where + ' adds light onto the key green');
          }
        }
      }
    }
  }
});

test('the catalog keys of these kinds are the ones themes prefer (§5.10 prefer maps name only registered parts)', () => {
  const known = new Set(REGISTRY.all().map((d) => d.kind + '/' + d.key));
  for (const id of MV.ids('parts/theme/')) {
    for (const theme of MV.use(id)) {
      for (const kind of ['ground', 'ornament']) {
        for (const key of Object.keys((theme.prefer && theme.prefer[kind]) || {})) assert.ok(known.has(kind + '/' + key), theme.key + ' prefers ' + key);
      }
    }
  }
  assert.ok(H.hash32(REGISTRY.version) > 0);
});

// --- QA-WORLD: decorations stay off the glyphs, backgrounds and atmospheres out of the lyric zone -----------------------
// Found by eye in contact sheets (16:9, 9:16, 1:1; light and dark themes; ja, en and mixed lines; vertical text). Each
// test below fails on the files as they were before the tuning (NOTES.md ## QA-WORLD).

const CATALOG = MV.use('parts/catalog').defaultRegistry();
const QA_ASPECTS = ['16:9', '9:16', '1:1'];
const OP_ARGS = [2, 2, 4, 6, 5, 4, 4, 0];                  // ShapeSpec op arguments: M L Q C A E R Z

function sampleIn(registry, key, opts) {
  const plan = FAC.samplePlan(registry, { kind: 'ornament', key, params: opts.params }, opts);
  const svc = { registry, text: createTextService({ measurer: MEASURER, faces: plan.look.faces }), strict: true };
  return { plan, scene: BUILD.buildCut(plan.cuts[0], plan, svc) };
}

// The glyphs' boxes at rest, frame du: [x0, y0, x1, y1] (spaces left out: they have no ink).
function glyphBoxes(scene) {
  const t = scene.target, out = [];
  for (let j = 0; j < t.ch.length; j++) {
    if (t.cls[j] !== 'space') out.push([t.wx[j] - t.w[j] / 2, t.wy[j] - t.h[j] / 2, t.wx[j] + t.w[j] / 2, t.wy[j] + t.h[j] / 2]);
  }
  return out;
}

// The shape nodes a slot's part built, in build order.
function shapeNodes(scene, el) {
  const owner = scene.owners.findIndex((o) => o.el === el), out = [];
  for (let i = 0; i < scene.table.n; i++) if (scene.table.type[i] === T.TYPE.shape && scene.table.owner[i] === owner) out.push(i);
  return out;
}

// Points along a ShapeSpec (local du): every control point, arcs and ellipses every 15°, rectangle corners.
function specPoints(spec) {
  const out = [], ops = spec.ops, p = spec.pts;
  for (let i = 0, k = 0; i < ops.length; k += OP_ARGS[ops[i]], i++) {
    const op = ops[i];
    if (op <= 3) for (let j = 0; j < OP_ARGS[op]; j += 2) out.push([p[k + j], p[k + j + 1]]);
    else if (op === 4 || op === 5) {
      const rx = p[k + 2], ry = op === 5 ? p[k + 3] : p[k + 2];
      for (let a = 0; a < 24; a++) out.push([p[k] + rx * Math.cos((a * Math.PI) / 12), p[k + 1] + ry * Math.sin((a * Math.PI) / 12)]);
    } else if (op === 6) out.push([p[k], p[k + 1]], [p[k] + p[k + 2], p[k + 1]], [p[k] + p[k + 2], p[k + 1] + p[k + 3]], [p[k], p[k + 1] + p[k + 3]]);
  }
  return out;
}

// Local points of shape node i in frame du at rest, scaled by k about the node's own origin first (a snap or burst that
// overshoots: the part's group scales about the origin the shape is drawn around).
function toWorld(scene, i, pts, k) {
  const m = T.restWorld(scene.table).m, o = i * 6, s = k || 1;
  return pts.map(([x, y]) => [m[o] * x * s + m[o + 2] * y * s + m[o + 4], m[o + 1] * x * s + m[o + 3] * y * s + m[o + 5]]);
}

function inBox([x, y], b, pad) { return x > b[0] - pad && x < b[2] + pad && y > b[1] - pad && y < b[3] + pad; }

// Whether two convex polygons overlap (separating axes).
function convexOverlap(A, B) {
  for (const P of [A, B]) {
    for (let i = 0; i < P.length; i++) {
      const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % P.length], nx = y0 - y1, ny = x1 - x0;
      const span = (Q) => Q.reduce(([lo, hi], [x, y]) => { const v = nx * x + ny * y; return [Math.min(lo, v), Math.max(hi, v)]; }, [Infinity, -Infinity]);
      const [a0, a1] = span(A), [b0, b1] = span(B);
      if (a1 <= b0 || b1 <= a0) return false;
    }
  }
  return true;
}

function boxCorners(b) { return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]]; }

// Whether a point lies inside a simple polygon (even–odd).
function inPolygon([x, y], P) {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) inside = !inside;
  }
  return inside;
}

const QA_LINES = [
  { text: 'はじまりの朝' }, { text: 'Hold on tonight' }, { text: '今夜 Stay 夜明けまで' }, { text: 'Hold on to the light tonight' },
  { text: '今夜 Stay with me 夜明けまで' }, { text: '夜明けの街を、走る光', orient: 'v' }, { text: '夜明けの街を走る光と、君の声', orient: 'v' },
];

test('orbitRing: the ring passes outside every glyph, with room for its dots, however far it is tilted', () => {
  for (const { text, orient } of QA_LINES.filter((l) => Array.from(l.text).length <= 20)) {
    for (const aspect of QA_ASPECTS) {
      for (const tilt of [-20, -7, 0, 7, 20]) {
        const { scene } = sampleIn(CATALOG, 'orbitRing', { aspect, text, orient, params: { tilt, gap: 0 } });
        const i = shapeNodes(scene, 'ornament#0')[0], b = scene.stores.shape[scene.table.payload[i]].bounds;
        const rx = b[2] - 10, ry = b[3] - 10;                     // the ring less its largest dot
        const m = T.restWorld(scene.table).m, o = i * 6, det = m[o] * m[o + 3] - m[o + 1] * m[o + 2];
        const where = text + ' ' + aspect + ' tilt ' + tilt;
        for (const box of glyphBoxes(scene)) {
          for (const [x, y] of boxCorners(box)) {
            const dx = x - m[o + 4], dy = y - m[o + 5];
            const lx = (m[o + 3] * dx - m[o + 2] * dy) / det, ly = (-m[o + 1] * dx + m[o] * dy) / det;
            assert.ok((lx / rx) ** 2 + (ly / ry) ** 2 < 1, where + ': a glyph corner reaches the ring');
          }
        }
      }
    }
  }
});

test('tapeStrip: no piece of tape covers a glyph, even skewed as far as it goes and while it snaps in', () => {
  for (const { text, orient } of QA_LINES) {
    for (const aspect of QA_ASPECTS) {
      for (const params of [{ pieces: 4 }, { pieces: 4, skew: 25, length: 400 }, { pieces: 4, skew: 25, length: 60 }]) {
        const { scene } = sampleIn(CATALOG, 'tapeStrip', { aspect, text, orient, params });
        const glyphs = glyphBoxes(scene).map(boxCorners);
        const tapes = shapeNodes(scene, 'ornament#0').filter((i, k) => k % 2 === 0);    // each piece: the tape, then its sheen
        assert.equal(tapes.length, 4);
        for (const i of tapes) {
          const b = scene.stores.shape[scene.table.payload[i]].bounds;
          const hull = toWorld(scene, i, [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], 1.2);
          for (const g of glyphs) assert.ok(!convexOverlap(hull, g), text + ' ' + aspect + ' ' + JSON.stringify(params) + ': tape over a glyph');
        }
      }
    }
  }
});

test('inkSplat: splashes, their fingers and droplets land beside the text, never behind a glyph', () => {
  for (const { text, orient } of QA_LINES) {
    for (const aspect of QA_ASPECTS) {
      for (const params of [{}, { splashes: 5 }, { splashes: 5, size: 0.3 }, { splashes: 3, size: 0.04 }]) {
        const { scene } = sampleIn(CATALOG, 'inkSplat', { aspect, text, orient, params });
        const boxes = glyphBoxes(scene), where = text + ' ' + aspect + ' ' + JSON.stringify(params);
        for (const i of shapeNodes(scene, 'ornament#0')) {
          const path = scene.stores.shape[scene.table.payload[i]].path;
          const pts = toWorld(scene, i, specPoints(path), 1.08);     // the burst overshoots its size by up to 7.5 %
          for (const b of boxes) assert.ok(!pts.some((p) => inBox(p, b, 2)), where + ': ink inside a glyph box');
          // the blob (the first subpath: its control points) holds no glyph either
          const blob = toWorld(scene, i, specPoints({ ops: path.ops.slice(0, 28), pts: path.pts }), 1.08);
          for (const b of boxes) assert.ok(!boxCorners(b).some((c) => inPolygon(c, blob)), where + ': a glyph inside a splash');
        }
      }
    }
  }
});

test('underSweep: under the emphasized word on one line, under the whole block when the text runs to several', () => {
  let one = 0, several = 0;
  const lines = QA_LINES.concat([{ text: 'Hold on' }, { text: '今夜 Stay' }, { text: 'はじまりの朝', orient: 'v' }, { text: '夜明けまで走れ', orient: 'v' }]);
  for (const { text, orient } of lines) {
    for (const aspect of QA_ASPECTS) {
      const { plan, scene } = sampleIn(CATALOG, 'underSweep', { aspect, text, orient });
      const i = shapeNodes(scene, 'ornament#0')[0], b = scene.stores.shape[scene.table.payload[i]].bounds;
      const [[x0, y0], [x1, y1]] = toWorld(scene, i, [[b[0], b[1]], [b[2], b[3]]]);
      const t = scene.target, vertical = plan.cuts[0].slots.orient.v === 'v', boxes = glyphBoxes(scene), where = text + ' ' + aspect;
      const lines = t.units.line, along = (bx) => (vertical ? [bx[1], bx[3]] : [bx[0], bx[2]]);
      const bar = vertical ? [y0, y1] : [x0, x1];
      const cover = (span) => Math.max(0, Math.min(bar[1], span[1]) - Math.max(bar[0], span[0])) / (span[1] - span[0]);
      // beside the text: under every glyph (horizontal) or right of every glyph (vertical, 傍線)
      if (vertical) assert.ok(boxes.every((g) => x0 >= g[2] - 1), where + ': the side line is right of the text');
      else assert.ok(boxes.every((g) => y0 >= g[3] - 1), where + ': the bar is under the text');
      if (lines === 1) {
        one++;
        const emph = boxes.filter((g, j) => t.emph[j]).map(along);
        const span = [Math.min(...emph.map((s) => s[0])), Math.max(...emph.map((s) => s[1]))];
        assert.ok(cover(span) >= 0.6, where + ': the bar lies under the emphasized word (covers ' + cover(span).toFixed(2) + ')');
        assert.ok(bar[1] - bar[0] <= 1.6 * (span[1] - span[0]), where + ': and not much beyond it');
      } else {
        several++;
        // the line nearest the bar (the last line; in vertical text the rightmost column) is covered along its length
        const last = boxes.filter((g, j) => t.unitOf.line[j] === (vertical ? 0 : lines - 1)).map(along);
        const span = [Math.min(...last.map((s) => s[0])), Math.max(...last.map((s) => s[1]))];
        assert.ok(cover(span) >= 0.9, where + ': the bar runs along the line next to it (covers ' + cover(span).toFixed(2) + ')');
      }
    }
  }
  assert.ok(one >= 8 && several >= 8, 'both cases were seen (' + one + ' single, ' + several + ' several)');
});

// The ops a paint node draws at local time t, recorded on its own.
function paintOps(plan, scene, i, t) {
  const rec = R.createRecorder(), surf = R.surfaceOf(rec.factory, 64, 64, false), pal = plan.look.palette;
  const q = { draft: false, scale: 1, pal, rgba: (ink, a) => C.rgba(pal[ink] || ink, a), tile: () => null };
  const p = scene.stores.paint[scene.table.payload[i]];
  p.draw(surf.ctx, t, p.data, q);
  return rec.ops();
}

function paintNodes(scene, layer) {
  const out = [];
  for (let i = 0; i < scene.table.n; i++) if (scene.table.type[i] === T.TYPE.paint && scene.table.layer[i] === T.LAYER_INDEX[layer]) out.push(i);
  return out;
}

// Normalized distance from the middle of a w × h frame in radii (ax·w, ay·h): below 1 is inside that ellipse.
function zoneOf(x, y, w, h, ax, ay) { return Math.hypot((x - w / 2) / (ax * w), (y - h / 2) / (ay * h)); }

test('atmospheres: whatever passes in front of the text is faint where lyrics stand (near layer)', () => {
  let seen = 0;
  for (const key of ['petalFall', 'leafFall', 'bokehDots', 'fireflyGlow']) {
    for (const aspect of QA_ASPECTS) {
      const params = { petals: 120, leaves: 60, dots: 80, flies: 60, amount: 1 };
      const plan = FAC.samplePlan(REGISTRY, { kind: 'ornament', key, params }, { aspect });
      const scene = sceneOf(plan, def('ornament', key)), { w, h } = plan.design;
      for (const i of paintNodes(scene, 'near')) {
        for (let t = 0; t < 40; t += 0.5) {
          // follow the transforms and the alpha: an item is drawn around the origin its translate sets
          let m = [0, 0], alpha = 1;
          const stack = [];
          for (const op of paintOps(plan, scene, i, t)) {
            const name = op[1];
            if (name === 'save') stack.push([m, alpha]);
            else if (name === 'restore') [m, alpha] = stack.pop();
            else if (name === 'translate') m = [op[2], op[3]];
            else if (name === 'set:globalAlpha') alpha = op[2];
            else if ((name === 'fill' || name === 'fillRect') && zoneOf(m[0], m[1], w, h, 0.38, 0.3) <= 0.4) {
              seen++;
              assert.ok(alpha <= 0.16, key + ' ' + aspect + ' t ' + t + ': alpha ' + alpha + ' in front of the lyrics');
            }
          }
        }
      }
    }
  }
  assert.ok(seen > 100, 'items crossed the lyric zone (' + seen + ')');
});

test('fireworkBloom: sparks burst around the lyric zone, not across it (a minute at the largest size and rate)', () => {
  for (const aspect of QA_ASPECTS) {
    const plan = longPlan('ornament', 'fireworkBloom', aspect, 70, { rate: 10, size: 0.45, sparks: 96 });
    const scene = sceneOf(plan, def('ornament', 'fireworkBloom')), { w, h } = plan.design;
    const [i] = paintNodes(scene, 'far');
    let strokes = 0;
    for (let t = 0; t < 60; t += 0.1) {
      let alpha = 1, pts = [], moves = 0;
      for (const op of paintOps(plan, scene, i, t)) {
        const name = op[1];
        if (name === 'set:globalAlpha') alpha = op[2];
        else if (name === 'beginPath') { pts = []; moves = 0; }
        else if (name === 'moveTo') { moves++; pts.push([op[2], op[3]]); }
        else if (name === 'lineTo') pts.push([op[2], op[3]]);
        else if (name === 'stroke' && moves >= 5 && alpha > 0.2) {         // a ring of sparks still bright enough to see
          strokes++;
          for (const [x, y] of pts) assert.ok(zoneOf(x, y, w, h, 0.36, 0.3) >= 1, aspect + ' t ' + t.toFixed(1) + ': a spark in the lyric zone');
        }
      }
    }
    assert.ok(strokes > 100, aspect + ': bursts were drawn (' + strokes + ')');
  }
});

test('halftoneSun: no dot stands in the lyric zone, wherever in a corner the disc is placed and however fine its dots', () => {
  // (a disc pinned to the centre stands behind the words on purpose; its dots thin out there, as they did before)
  for (const aspect of QA_ASPECTS) {
    for (const place of ['topRight', 'topLeft', 'bottomRight', 'bottomLeft']) {
      for (const size of [0.7, 1.4]) {
        const plan = FAC.samplePlan(REGISTRY, { kind: 'ground', key: 'halftoneSun', params: { place, size, spacing: 8 } }, { aspect });
        const scene = sceneOf(plan, def('ground', 'halftoneSun')), { w, h } = plan.design;
        let dots = 0;
        for (const i of paintNodes(scene, 'ground')) {
          for (const op of paintOps(plan, scene, i, 3)) {
            if (op[1] !== 'arc' || op[4] > 0.6 * 48) continue;          // the dots (the rings round the disc are larger)
            dots++;
            assert.ok(zoneOf(op[2], op[3], w, h, 0.42, 0.34) > 0.6, aspect + ' ' + place + ': a dot behind the lyrics');
          }
        }
        assert.ok(dots > 50, aspect + ' ' + place + ': the disc has dots');
      }
    }
  }
});

test('auroraVeil: the curtains hang across the top and end well above the middle of the frame, in every aspect', () => {
  for (const aspect of ['16:9', '9:16', '1:1', '4:5', '21:9']) {
    for (const params of [{}, { height: 0.6, curtains: 4 }, { height: 0.2, curtains: 1 }]) {
      const plan = FAC.samplePlan(REGISTRY, { kind: 'ground', key: 'auroraVeil', params }, { aspect });
      const scene = sceneOf(plan, def('ground', 'auroraVeil')), { w, h } = plan.design;
      const limit = h / 2 - 0.22 * Math.min(w, h) + 1;
      for (const t of [0, 7.3, 21.1]) {
        let low = -Infinity;
        for (const op of paintOps(plan, scene, paintNodes(scene, 'ground')[0], t)) {
          if (op[1] === 'moveTo' || op[1] === 'lineTo') low = Math.max(low, op[3]);
          else if (op[1] === 'rect') low = Math.max(low, op[3] + op[5]);
        }
        assert.ok(low <= limit, aspect + ' ' + JSON.stringify(params) + ': the aurora reaches ' + Math.round(low) + ' du (limit ' + Math.round(limit) + ')');
      }
    }
  }
});

// OKLab distance of two colours (how strongly a pattern of the two reads).
function labDistance(a, b) {
  const lab = (hex) => {
    const n = parseInt(hex.slice(1, 7), 16), lin = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const r = lin((n >> 16) & 255), g = lin((n >> 8) & 255), bl = lin(n & 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const p = lab(a), q = lab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

test('stripeShift: the stripes stay soft behind the text in every theme, whatever colour they lean toward', () => {
  for (const theme of CATALOG.keys('theme')) {
    for (const toward of ['ground2', 'shiftA', 'shiftB', 'accent']) {
      const plan = FAC.samplePlan(REGISTRY, { kind: 'ground', key: 'stripeShift', params: { toward, amount: 1 } },
        { theme, palette: CATALOG.get('theme', theme).swatch });
      const d = sceneOf(plan, def('ground', 'stripeShift')).stores.paint[0].data;
      const dE = labDistance(d.stripe, plan.look.palette.ground);
      assert.ok(dE <= 0.053, theme + ' toward ' + toward + ': stripes ' + dE.toFixed(3) + ' from the ground (OKLab)');
    }
  }
});
