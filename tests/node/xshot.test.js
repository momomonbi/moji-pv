/* 文字PVメーカー v2 — original work. Tests: EXTREME shots at scene build and per frame — the x-track's safe framing, roll fence, speed caps, jump spacing, layouts, anchors, reading hops and beat modulators (DESIGN_EXTREME §1.4, §3.1, §3.3). */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../helpers/load.js');
const { approx } = require('../helpers/assert_plus.js');

const MV = load();
const N = MV.use('core/num');
const SHOT = MV.use('core/shot');
const BEATS = MV.use('core/beats');
const FAC = MV.use('engine/facade');
const BUILD = MV.use('engine/scene/build');
const F = MV.use('engine/scene/frame');
const SS = MV.use('engine/scene/shot');
const XS = MV.use('engine/scene/xshot');
const STG = MV.use('engine/scene/stagger');
const { createTextService } = MV.use('engine/text/service');
const { fakeMeasurer } = MV.use('engine/text/fake_measure');

const REG = MV.use('parts/catalog').defaultRegistry();
const TEXTS = Object.freeze({ short: 'はじまりの朝', three: '夜明けの街を 走る光と 君の声', en: 'Paper planes in the morning light' });
const ASPECTS = ['16:9', '9:16', '1:1'];
const DEG = N.DEG;
const ARR = Object.freeze({
  any: null,
  gentle: REG.keys('arrange').find((k) => REG.get('arrange', k).cam === 'gentle'),
  none: REG.keys('arrange').find((k) => REG.get('arrange', k).cam === 'none'),
});

function autoParams(slot, key) {
  const p = {};
  for (const { name, spec } of REG.params(slot, key)) {
    p[name] = spec.auto && 'value' in spec.auto ? spec.auto.value : spec.auto && spec.auto.range
      ? (spec.auto.range[0] + spec.auto.range[1]) / 2 : spec.auto && spec.auto.pick ? spec.auto.pick[0] : spec.min;
  }
  return p;
}

// The canned cut (engine/facade.samplePlan kind 'xshot') with an EXTREME shot, built strictly.
// o = { shot, text, aspect, extreme, zoom, arrange, emph, bpm (null: no grid), follow }
function xScene(o) {
  const plan = FAC.samplePlan(REG, { kind: 'xshot', key: o.shot, params: { extreme: o.extreme, zoom: o.zoom, follow: o.follow } },
    { text: o.text || TEXTS.three, aspect: o.aspect || '16:9' });
  const cut = plan.cuts[0];
  const slots = Object.assign({}, cut.slots);
  if (o.arrange) slots.arrange = { v: o.arrange, p: autoParams('arrange', o.arrange), from: 'pin' };
  Object.assign(cut, { slots });
  if (o.emph !== undefined) cut.emph = o.emph;
  if (o.bpm === null) plan.beats = null;
  else if (o.bpm) plan.beats = { bpm: o.bpm, offset: 0, meter: 4 };
  cut.fp += ':' + JSON.stringify([o.arrange, o.emph, o.bpm]);
  const svc = { registry: REG, text: createTextService({ measurer: fakeMeasurer(), faces: plan.look.faces }), strict: true };
  const scene = BUILD.buildCut(cut, plan, svc);
  const env = { D: { w: plan.design.w, h: plan.design.h, short: plan.design.short }, times: scene.times, cut, grid: F.gridAt(plan, cut.t0) };
  return { plan, cut, scene, env, tr: scene.shot, W: plan.design.w, H: plan.design.h, short: plan.design.short, span: cut.t1 - cut.t0 };
}

const inSung = (t, span) => t >= -1e-9 && t < span - 1e-6;
function steps(lo, hi, n) { return Array.from({ length: n + 1 }, (_, k) => lo + ((hi - lo) * k) / n); }

// The envelope of the modulators a key's framing makes room for (as the builder computes it).
function envelope(tr, short) {
  let hmax = 0;
  for (const k of tr.keys) hmax = Math.max(hmax, k.hit);
  if (tr.hits) for (let i = 0; i < tr.hits.n; i++) hmax = Math.max(hmax, tr.hits.amp[i]);
  const roll = tr.swing ? tr.swing.amp / DEG : 0;
  const e = Math.min(Math.PI / 2, (roll + XS.HIT_ROLL * hmax) * DEG);
  return { s: XS.XSAFE * short, hd: XS.HIT_DU * short * hmax, pz: tr.pulse ? tr.pulse.amp * XS.DOWNBEAT : 0, e };
}

// The corners of a rest-world box on screen (from the frame centre) under a pose, turned further by d about the centre.
function cornersOnScreen(pose, box, W, H, d) {
  const out = [];
  const c = Math.cos(-pose.roll - d), s = Math.sin(-pose.roll - d);
  for (const [x, y] of [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]]) {
    const dx = x - W / 2 - pose.x, dy = y - H / 2 - pose.y;
    out.push([pose.zoom * (c * dx - s * dy), pose.zoom * (s * dx + c * dy)]);
  }
  return out;
}

test('engine/scene/xshot exports the §1.4 interface; the scene build sends only EXTREME shots to it', () => {
  for (const name of ['isX', 'makeShot', 'anchorTime', 'poseAt', 'modAt', 'camAt', 'runShot', 'rotExtent', 'schedule', 'segmentRule']) {
    assert.equal(typeof XS[name], 'function', 'xshot.' + name);
  }
  for (const name of ['readingUnits', 'unitsOf', 'emphRun', 'sungOf', 'leanOf']) assert.equal(typeof SS[name], 'function', 'shot.' + name);
  assert.equal(XS.isX({ shot: { v: 'settle' } }), false);
  assert.equal(XS.isX({ shot: { v: 'none' } }), false);
  assert.equal(XS.isX({ shot: null }), false);
  assert.equal(XS.isX({ shot: { v: 'whipPan~m' } }), true);
  assert.equal(XS.isX({ shot: { v: { x: 1, keys: [{ at: 'a', aim: 'block' }, { at: 'b', aim: 'block' }] } } }), true);
  const x = xScene({ shot: 'crashZoom' });
  assert.equal(x.tr.x, true);
  const normal = FAC.samplePlan(REG, { kind: 'shot', key: 'snapZoom' }, { text: TEXTS.three });
  const svc = { registry: REG, text: createTextService({ measurer: fakeMeasurer(), faces: normal.look.faces }), strict: true };
  const sc = BUILD.buildCut(normal.cuts[0], normal, svc);
  assert.ok(sc.shot && sc.shot.x === undefined && sc.shot.live.gz === undefined, 'a normal shot keeps the normal track');
  // an object that is not x: 1 is a normal custom shot, its roll clamped to ±15° as before
  const objPlan = FAC.samplePlan(REG, { kind: 'shot', key: { x: 0, keys: [{ at: 'a', aim: 'block', roll: 40 }, { at: 'b', aim: 'block' }] } },
    { text: TEXTS.three });
  const osc = BUILD.buildCut(objPlan.cuts[0], objPlan, svc);
  assert.ok(osc.shot && osc.shot.x === undefined);
  approx(osc.shot.keys[0].R, 15 * DEG, 1e-12);
});

// R1, X5, X6, X7 by construction, over every preset × 3 texts × 3 layouts × 3 aspects.
test('every preset × text × layout × aspect: R1 in the sung span, the roll fence, speed caps, jump spacing, layout caps', () => {
  let checked = 0, keysInSpan = 0;
  for (const shot of SHOT.XSHOT_KEYS) {
    for (const text of Object.values(TEXTS)) {
      for (const [trait, arrange] of Object.entries(ARR)) {
        for (const aspect of ASPECTS) {
          const { tr, W, H, short, span } = xScene({ shot, text, aspect, arrange });
          const name = [shot, text.slice(0, 6), trait, aspect].join(' ');
          assert.equal(tr.x, true, name);
          const env = envelope(tr, short);
          const jumpAt = (i) => tr.t[i] - tr.t[i - 1] < SS.JUMP;
          // X2: the deliberate jumps kept are ≥ 0.4 s apart and ≥ 0.4 s after a
          let prev = tr.a;
          for (const tj of tr.jumps) { assert.ok(tj - prev >= XS.XJUMP_GAP - 1e-9, name + ': jump at ' + tj); prev = tj; }
          for (let i = 0; i < tr.n; i++) {
            const k = tr.keys[i];
            if (inSung(k.t, span)) assert.ok(Math.abs(k.R) <= XS.XROLL_SUNG * DEG + 1e-9, name + ': |roll| ≤ 30° in the span');
            if (i === 0 || jumpAt(i)) continue;
            const dt = tr.t[i] - tr.t[i - 1], rule = XS.segmentRule(tr.t[i - 1], tr.t[i], span);
            const dR = Math.abs(tr.R[i] - tr.R[i - 1]) / DEG;
            assert.ok(dR <= Math.min(rule.fence, XS.XROT_SPEED * dt) + 1e-6, name + ': rotation of segment ' + i + ' ' + dR);
            assert.ok(Math.abs(tr.lz[i] - tr.lz[i - 1]) <= XS.XZOOM_SPEED * dt + 1e-6, name + ': zoom rate of segment ' + i);
            if (!tr.paths[i] && !tr.paths[i - 1]) {
              const dp = Math.hypot(k.sx - tr.keys[i - 1].sx, k.sy - tr.keys[i - 1].sy);
              assert.ok(dp <= XS.XTRAVEL_SPEED * W * dt + 1e-6, name + ': travel of segment ' + i);
            }
          }
          if (trait !== 'any') {
            // X7: small tilts, offsets and ground zoom, no whip; 'none' holds key 0's framing
            for (const k of tr.keys) {
              assert.ok(Math.abs(k.R) <= XS.GENTLE.roll * DEG + 1e-9 && k.gz <= XS.GENTLE.gz + 1e-9, name + ' gentle caps');
            }
            if (tr.swing) assert.ok(tr.swing.amp <= XS.GENTLE.beatRoll * DEG + 1e-12, name + ' gentle swing');
            for (const p of tr.paths) if (p) assert.equal(p.whip, 0, name + ' no whip');
            for (let i = 0; i < tr.n; i++) {
              const lx = SS.bleedLimit(W, tr.keys[i].Z), ly = SS.bleedLimit(H, tr.keys[i].Z);
              assert.ok(Math.abs(tr.keys[i].X) <= lx + 1e-6 && Math.abs(tr.keys[i].Y) <= ly + 1e-6, name + ' bleed clamp');
            }
            if (trait === 'none') {
              assert.equal(tr.n, 2, name + ': two holds');
              const [a, b] = tr.keys;
              approx([a.Z, a.R, a.sx, a.sy], [b.Z, b.R, b.sx, b.sy], 1e-9, name + ': one framing');
            }
            continue;
          }
          // R1: every text key in the sung span frames its aim inside the XSAFE area, with the pulse, swing and hit envelope
          for (let i = 0; i < tr.n; i++) {
            const k = tr.keys[i];
            if (!inSung(k.t, span) || !k.box || k.aim === 'frame' || k.aim === 'point') continue;
            keysInSpan++;
            const pose = XS.poseAt(tr, k.t, {});
            for (const d of [-env.e, -env.e / 2, 0, env.e / 2, env.e]) {
              for (const [x, y] of cornersOnScreen(pose, k.box, W, H, d)) {
                const lim = (L) => L / 2 - env.s - env.hd + 0.5;
                assert.ok(Math.abs(x) * (1 + env.pz) <= lim(W) && Math.abs(y) * (1 + env.pz) <= lim(H),
                  name + ': key ' + i + ' (' + k.aim + ') leaves the safe area at d = ' + (d / DEG).toFixed(1) + '°: ' + x.toFixed(1) + ',' + y.toFixed(1));
              }
            }
          }
          checked++;
        }
      }
    }
  }
  assert.equal(checked, SHOT.XSHOT_KEYS.length * 3 * ASPECTS.length);
  assert.ok(keysInSpan > 80, 'R1 was checked on ' + keysInSpan + ' keys');
});

// R2 (§3.1): every word fully on-screen and tilted ≤ 45° for ≥ 50 % of its sung window (the camera with its modulators,
// sampled 24 times over the window); measured over every preset × 3 texts × 3 aspects × 2 intensities.
test('R2: every word is readable for at least half of its sung window', () => {
  let words = 0;
  const low = [];
  for (const shot of SHOT.XSHOT_KEYS) {
    for (const text of Object.values(TEXTS)) {
      for (const aspect of ASPECTS) {
        for (const extreme of [1, 0.5]) {
          const { tr, scene, env, W, H, span } = xScene({ shot, text, aspect, extreme });
          const t = scene.target;
          const frac = STG.sungFractions(env, t, 'word');
          const byWord = new Map();
          for (let j = 0; j < t.to - t.from; j++) {
            if (t.cls[j] === 'space' || !SS.aimable(t, j)) continue;
            byWord.set(t.unitOf.word[j], (byWord.get(t.unitOf.word[j]) || []).concat(j));
          }
          const starts = [...byWord.values()].map((js) => frac[js[0]] * span).sort((a, b) => a - b);
          const c = { x: 0, y: 0, zoom: 1, roll: 0, jx: 0, jy: 0, fz: 1, gz: 1 };
          for (const js of byWord.values()) {
            const s0 = frac[js[0]] * span, next = starts.find((v) => v > s0 + 1e-9);
            const s1 = Math.min(tr.b, Math.max(next === undefined ? span : next, s0 + 0.2));
            let good = 0;
            const samples = steps(s0, s1 - 1e-6, 23);
            for (const tl of samples) {
              XS.camAt(tr, tl, c);
              const tilt = Math.abs(Math.atan2(Math.sin(c.roll), Math.cos(c.roll)));
              const pose = { x: c.x + c.jx, y: c.y + c.jy, zoom: c.zoom, roll: c.roll };
              const on = js.every((j) => cornersOnScreen(pose, { x: t.box[j * 4], y: t.box[j * 4 + 1], w: t.box[j * 4 + 2] - t.box[j * 4],
                h: t.box[j * 4 + 3] - t.box[j * 4 + 1] }, W, H, 0).every(([x, y]) => Math.abs(x) <= W / 2 + 0.5 && Math.abs(y) <= H / 2 + 0.5));
              if (on && tilt <= Math.PI / 4) good++;
            }
            words++;
            if (good / samples.length < 0.5) low.push([shot, text.slice(0, 6), aspect, extreme, js.map((j) => t.ch[j]).join(''), good]);
          }
        }
      }
    }
  }
  assert.ok(words > 500, words + ' words measured');
  assert.deepEqual(low, [], 'words below R2');
});

test('the rotation cap turns spinIn\'s −180° into ≤ 173° before the landing and spinOut\'s tail into ≤ 540°/s', () => {
  const inx = xScene({ shot: 'spinIn' }).tr;
  approx(inx.R[0] / DEG, -XS.XROT_SPEED * (inx.t[1] - inx.t[0]), 1e-6, 'excess removed from the earlier key');
  assert.equal(inx.R[1], 0, 'the landing is kept');
  const out = xScene({ shot: 'spinOut' }).tr;
  assert.equal(out.R[1], 0, 'the key inside the span is kept');
  approx(out.R[2] / DEG, XS.XROT_SPEED * (out.t[2] - out.t[1]), 1e-6, 'an exit gives way at its later key');
  // the rules
  assert.deepEqual(XS.segmentRule(-0.3, -0.1, 2), { fence: Infinity, later: false });
  assert.deepEqual(XS.segmentRule(2.1, 2.3, 2), { fence: Infinity, later: true });
  assert.deepEqual(XS.segmentRule(-0.1, 0.2, 2), { fence: XS.XSPIN_LAND, later: false });
  assert.deepEqual(XS.segmentRule(0.2, 0.8, 2), { fence: XS.XSPIN_INSIDE, later: false });
  assert.deepEqual(XS.segmentRule(1.8, 2.1, 2), { fence: XS.XSPIN_INSIDE, later: true });
  assert.deepEqual(XS.segmentRule(-0.1, 2.1, 2), { fence: XS.XSPIN_INSIDE, later: false });
});

test('anchors: accent = the emphasized word\'s sung start (else the first beat), accentEnd = the next word\'s (else end)', () => {
  // '走る' (graphemes 7–8) of the three-word line is emphasized
  const { env, scene, span, tr } = xScene({ shot: 'crashZoom', emph: [[7, 9]] });
  const t = scene.target;
  const frac = STG.sungFractions(env, t, 'word');
  const firstOf = (word) => Array.from(t.unitOf.word).findIndex((w, j) => w === word && t.cls[j] !== 'space');
  const w = t.unitOf.word[7];
  approx(XS.anchorTime(env, t, 'accent', 0), frac[firstOf(w)] * span, 1e-9);
  approx(XS.anchorTime(env, t, 'accentEnd', 0), frac[firstOf(w + 1)] * span, 1e-9);
  approx(XS.anchorTime(env, t, 'accent', 0.05), frac[firstOf(w)] * span + 0.05, 1e-9, 'dt is added');
  // crashZoom crashes in at accent + 0.05 and releases at accentEnd + 0.12
  approx(tr.keys[2].t, frac[firstOf(w)] * span + 0.05, 1e-9);
  approx(tr.keys[4].t, frac[firstOf(w + 1)] * span + 0.12, 1e-9);
  // the crash frames the whole emphasized word (the run inside it never crops the rest of the word, R3)
  const box = tr.keys[2].box;
  for (let j = 0; j < t.to - t.from; j++) {
    if (t.unitOf.word[j] !== w || t.cls[j] === 'space') continue;
    assert.ok(t.box[j * 4] >= box.x - 1e-6 && t.box[j * 4 + 2] <= box.x + box.w + 1e-6, 'glyph ' + t.ch[j] + ' inside the crash box');
  }
  // without emphasis: the first beat at or after the sung start, and end
  const plain = xScene({ shot: 'crashZoom', emph: [] });
  approx(XS.anchorTime(plain.env, plain.scene.target, 'accent', 0), SS.anchorTime(plain.env, plain.scene.target, 'beat:0', 0), 1e-12);
  approx(XS.anchorTime(plain.env, plain.scene.target, 'accentEnd', 0), plain.span, 1e-12);
  // the last word emphasized: accentEnd is end
  const last = xScene({ shot: 'crashZoom', emph: [[12, 15]] });
  approx(XS.anchorTime(last.env, last.scene.target, 'accentEnd', 0), last.span, 1e-12);
  // other anchors are engine/scene/shot's
  for (const at of ['a', 'sung', 'mid', 'end', 'b', 'beat:2', 'word:1']) {
    assert.equal(XS.anchorTime(env, t, at, 0.01), SS.anchorTime(env, t, at, 0.01), at);
  }
});

test('reading paths: every unit is centred while it is sung; hops land at τ_k; hop 0 jumps, spaced by X2', () => {
  for (const shot of ['whipRead', 'jumpRead']) {
    for (const aspect of ASPECTS) {
      const { tr, span } = xScene({ shot, aspect, text: TEXTS.three });
      const path = tr.paths.find((p) => p);
      const u = path.units;
      assert.ok(u.n >= 3, 'the line has several units');
      const last = tr.t[tr.n - 1 - (shot === 'jumpRead' ? 1 : 0)];
      for (let k = 0; k < u.n; k++) {
        const until = Math.min(k + 1 < u.n ? path.start[k + 1] : span, last - XS.XLEAVE);
        for (const t of steps(u.tau[k], until - 1e-6, 6)) {
          if (t < 0) continue;
          const p = XS.poseAt(tr, t, {});
          assert.ok(Math.hypot(p.ax, p.ay) < 1e-6, shot + ' ' + aspect + ': unit ' + k + ' centred at ' + t.toFixed(3));
        }
        if (k > 0) {
          const h = u.tau[k] - path.start[k];
          if (shot === 'whipRead') approx(h, Math.min(0.12, 0.6 * (u.tau[k] - u.tau[k - 1])), 1e-9, 'hop length');
          else assert.ok(h === 0 || Math.abs(h - Math.min(XS.XSNAP, u.tau[k] - u.tau[k - 1])) < 1e-9, 'a jump or an XSNAP move');
        }
      }
      if (shot === 'jumpRead') {
        assert.ok(tr.jumps.length >= 1, 'jumpRead keeps some jumps');
        for (const tj of tr.jumps) assert.ok(tj >= tr.a + XS.XJUMP_GAP - 1e-9);
      } else assert.equal(tr.jumps.length, 0, 'whipRead never jumps');
    }
  }
});

test('mirror and intensity: "~m" flips ox and roll; cam.extreme scales roll, hits, gz − 1 and the beat amplitudes (g ≥ 0.3)', () => {
  const a = xScene({ shot: 'whipPan' }).tr, b = xScene({ shot: 'whipPan~m' }).tr;
  approx(b.keys[0].sx, -a.keys[0].sx, 1e-9);
  approx(b.keys[3].sx, -a.keys[3].sx, 1e-9);
  const d = xScene({ shot: 'dutchSwing' }).tr, dm = xScene({ shot: 'dutchSwing~m' }).tr;
  approx(dm.R[0], -d.R[0], 1e-12);
  assert.equal(dm.swing.s0, -d.swing.s0, 'the swing starts on the other side');
  const half = xScene({ shot: 'dutchSwing', extreme: 0.5 }).tr;
  approx(half.swing.amp, 0.5 * d.swing.amp, 1e-12);
  approx(half.R[0], 0.5 * d.R[0], 1e-12);
  const low = xScene({ shot: 'dutchSwing', extreme: 0.1 }).tr;
  approx(low.swing.amp, 0.3 * d.swing.amp, 1e-12, 'g = max(0.3, cam.extreme)');
  const v = xScene({ shot: 'vertigo', extreme: 0.5 }).tr;
  approx(v.keys[1].gz, 1 + 0.35 * 0.5, 1e-9);
  const p = xScene({ shot: 'punchHit', extreme: 0.5 }).tr;
  approx(p.hits.amp[0], 0.8 * 0.5, 1e-12);
  // blur shutter in seconds: blur · g / 48
  approx(xScene({ shot: 'whipPan', extreme: 0.75 }).tr.shutter, 0.75 / 48, 1e-12);
  assert.equal(xScene({ shot: 'jumpRead' }).tr.shutter, 0, 'jumpRead is never blurred');
});

test('modulator schedules: pulses ≤ 3 Hz, swing flips ≥ 0.5 s apart (≤ 1 Hz cycle), hits ≥ 0.5 s apart at every BPM 60–240', () => {
  for (let bpm = 60; bpm <= 240; bpm += 7) {
    const grid = BEATS.grid({ bpm, offset: 0.137, meter: 4 });
    for (const every of [1, 2, 4]) {
      const pl = XS.schedule(grid, -0.12, 6, every, XS.PULSE_GAP);
      assert.ok(pl.step >= XS.PULSE_GAP - 1e-9 && pl.count >= 1, bpm + ' pulse');
      assert.ok(pl.first >= -0.12 - 1e-9 && pl.first + (pl.count - 1) * pl.step <= 6 + 1e-9);
      approx(((pl.first - 0.137) / grid.period) % every, 0, 1e-6, 'on every every-th beat');
      assert.ok(XS.schedule(grid, -0.12, 6, every, XS.SWING_GAP).step >= XS.SWING_GAP - 1e-9, bpm + ' swing');
      assert.ok(XS.schedule(grid, -0.12, 6, every, XS.HIT_GAP).step >= XS.HIT_GAP - 1e-9, bpm + ' hits');
    }
  }
  assert.equal(XS.schedule(null, 0, 2, 1, 0.3).step, 0.5, 'without a grid: 0.5 s steps');
  for (const bpm of [60, 97, 133, 180, 240]) {
    for (const shot of ['beatCrash', 'shakeHits', 'dutchSwing', 'punchHit', 'crashZoom']) {
      const { tr } = xScene({ shot, bpm });
      if (tr.hits) for (let i = 1; i < tr.hits.n; i++) assert.ok(tr.hits.t[i] - tr.hits.t[i - 1] >= XS.HIT_GAP - 1e-9, shot + ' hits');
      // pulses: onsets per second; hits: zero crossings of the displacement ≤ 2·5 per second
      const m = { pulse: 0, swing: 0, jolt: 0, hx: 0, hy: 0 };
      let onsets = 0, crossings = 0, prevPulse = 0, prevHx = 0, maxPulse = 0, maxSwing = 0;
      const dt = 1 / 1000, T = tr.b - tr.a;
      for (let t = tr.a; t <= tr.b; t += dt) {
        XS.modAt(tr, t, m);
        if (m.pulse > prevPulse + 1e-12 && prevPulse <= 1e-12) onsets++;
        if (Math.abs(m.hx) > 1e-9 && Math.abs(prevHx) > 1e-9 && Math.sign(m.hx) !== Math.sign(prevHx)) crossings++;
        prevPulse = m.pulse; prevHx = m.hx === 0 ? prevHx : m.hx;
        maxPulse = Math.max(maxPulse, m.pulse); maxSwing = Math.max(maxSwing, Math.abs(m.swing));
      }
      assert.ok(onsets <= 3 * T + 1, shot + ' ' + bpm + ': ' + onsets + ' pulse onsets in ' + T.toFixed(2) + ' s');
      assert.ok(crossings <= 2 * XS.HIT_HZ * T + 2, shot + ' ' + bpm + ': ' + crossings + ' zero crossings');
      assert.ok(maxPulse <= 0.1 * XS.DOWNBEAT + 1e-9, shot + ': pulse ≤ +13 %');
      assert.ok(maxSwing <= 20 * DEG + 1e-9, shot + ': swing ≤ 20°');
    }
  }
});

// Sampled at 240 Hz, the camera (pose and modulators) moves the frame corners by less than 200 du per step except in a
// step holding a deliberate jump (a hard cut inside the cut).
test('the camera is continuous at 240 Hz except at deliberate jumps', () => {
  for (const shot of SHOT.XSHOT_KEYS) {
    for (const aspect of ['16:9', '9:16']) {
      const { tr, W, H, plan, cut } = xScene({ shot, aspect });
      const V0 = new Float32Array(6), V1 = new Float32Array(6);
      const cam = (t, out) => {
        const c = XS.camAt(tr, t, {});
        return F.viewMatrix(out, { x: c.x, y: c.y, zoom: c.zoom, roll: c.roll, shakeX: c.jx, shakeY: c.jy }, 1, W, H);
      };
      const dt = 1 / 240;
      let worst = 0;
      for (let t = tr.a; t + dt <= tr.b; t += dt) {
        cam(t, V0); cam(t + dt, V1);
        // a step that holds a jump, or lies in an XSNAP move (a jump X2 turned into a 0.08 s move: nearly a cut)
        const within = (lo, hi) => lo < t + dt + 1e-9 && hi > t - 1e-9;
        const jump = Array.from(tr.jumps).some((j) => j > t - 1e-9 && j <= t + dt + 1e-9)
          || Array.from(tr.t).some((kt, i) => i > 0 && kt - tr.t[i - 1] <= XS.XSNAP + 1e-9 && within(tr.t[i - 1], kt))
          || tr.paths.some((p) => p && Array.from(p.start).some((st, k) => k > 0 && p.units.tau[k] - st <= XS.XSNAP + 1e-9
            && within(st, p.units.tau[k])));
        let d = 0;
        for (const [x, y] of [[0, 0], [W, 0], [W, H], [0, H], [W / 2, H / 2]]) {
          d = Math.max(d, Math.hypot(V1[0] * x + V1[2] * y + V1[4] - (V0[0] * x + V0[2] * y + V0[4]),
            V1[1] * x + V1[3] * y + V1[5] - (V0[1] * x + V0[3] * y + V0[5])));
        }
        if (!jump) worst = Math.max(worst, d);
      }
      assert.ok(worst < 200, shot + ' ' + aspect + ': ' + worst.toFixed(1) + ' du in one 1/240 s step');
      void plan; void cut;
    }
  }
});

test('the behaviour composes with the lens like the normal shot, then adds the modulators; calm tones them down ×0.3', () => {
  const { scene, tr, plan, cut } = xScene({ shot: 'dutchSwing' });
  const tl = 0.6;
  F.evaluate(scene, tl);
  const full = F.cutCamera(scene, {});
  const p = XS.poseAt(tr, tl, {}), m = XS.modAt(tr, tl, {});
  approx(full.fz, p.zoom, 1e-9, 'fz = the framing zoom (no pulse)');
  assert.equal(full.gz, p.gz);
  assert.equal(tr.calm, 1);
  F.evaluate(scene, tl, { calm: true });
  const calm = F.cutCamera(scene, {});
  assert.equal(tr.calm, XS.CALM);
  approx(full.roll - calm.roll, (1 - XS.CALM) * (m.swing + m.jolt), 1e-6, 'the swing ×0.3');
  F.evaluate(scene, tl);
  assert.equal(tr.calm, 1, 'evaluate is pure in its options');
  approx(F.cutCamera(scene, {}).roll, full.roll, 1e-12);
  // camAt (what the motion blur differentiates) equals the evaluated camera with the lens at identity
  const c = XS.camAt(tr, tl, {});
  approx(c.roll, p.roll + m.swing + m.jolt, 1e-9);
  approx(c.zoom, p.zoom * (1 + m.pulse), 1e-9);
  void plan; void cut;
});

test('a follow lean works on x-tracks; frame and point aims keep their zoom range; tracks are deterministic', () => {
  const f = xScene({ shot: 'orbit', follow: 0.3 });
  assert.ok(f.scene.lean && f.scene.lean.follow === 0.3);
  const shot = { x: 1, keys: [{ at: 'a', aim: 'frame', zoom: 1.2, gz: 1.3 }, { at: 'b', aim: 'point', px: 0.2, zoom: 0.95 }] };
  const { tr } = xScene({ shot });
  approx([tr.keys[0].Z, tr.keys[1].Z], [1.2, 0.95], 1e-12);
  approx(tr.keys[0].gz, 1.3, 1e-9);
  for (const key of SHOT.XSHOT_KEYS) {
    const a = xScene({ shot: key }).tr, b = xScene({ shot: key }).tr;
    assert.deepEqual(a.keys, b.keys, key);
    assert.deepEqual(Array.from(a.jumps), Array.from(b.jumps), key);
    assert.deepEqual(a.hits && Array.from(a.hits.cx), b.hits && Array.from(b.hits.cx), key);
  }
});
