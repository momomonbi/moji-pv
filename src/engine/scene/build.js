/* 文字PVメーカー v2 — original work. Scene build: one Plan cut (or ground segment) → node table + behaviours (DESIGN §4.17.5). */
MV.def('engine/scene/build', ['core/hash', 'core/rng', 'core/schema', 'engine/scene/table', 'engine/scene/builder',
  'engine/scene/behave', 'engine/scene/frame'],
(H, RNG, SCH, T, B, BH, F) => {
  'use strict';

  const SAFE = 0.05;              // safe margin: 5% of the short side on every edge
  const PART_SLOTS = Object.freeze(['arrange', 'arrive', 'dwell', 'depart', 'lens']);
  const ORNAMENT_SLOTS = Object.freeze(['ornament#0', 'ornament#1', 'ornament#2']);

  // --- small helpers -------------------------------------------------------------------------------------------

  function designEnv(design) {
    const w = design.w, h = design.h, s = SAFE * design.short;
    return Object.freeze({ w, h, cx: w / 2, cy: h / 2, short: design.short, safe: Object.freeze({ l: s, t: s, r: s, b: s }) });
  }

  function decisionOf(slots, name) { return (slots && slots[name]) || null; }

  function valueOf(slots, name, dflt) {
    const d = decisionOf(slots, name);
    return d && d.v !== undefined && d.v !== null ? d.v : dflt;
  }

  // The Plan carries no seeds (§3.12), so a scene derives each slot's seed from what stays the same while the user
  // works on that slot: the slot name, the chosen part and the text it dresses. Like the §4.1.3 slot seed it never
  // depends on the params or on where the value came from (auto, pin, lock), so locking a line, pinning a value to
  // what it already is or moving a slider keeps every per-glyph random, the scatter order and particle layouts.
  // It is a function of what the fingerprint covers, so cuts (and segments) with equal fp may share one cached scene;
  // segments pass subject '' because a segment's fp covers neither its key nor its cuts' text.
  function slotSeed(slot, decision, subject) {
    const v = decision && decision.v !== undefined && decision.v !== null ? decision.v : '';
    return H.hash32('slot', slot, v, subject === undefined ? '' : subject);
  }

  function warn(list, w) { list.push(Object.freeze(w)); }

  // The part definition of a decision; an unknown key falls back to the kind's fallback part (with a warning).
  function partOf(registry, kind, decision, warnings, where) {
    const key = decision && decision.v;
    const def = key ? registry.get(kind, key) : null;
    if (def) return def;
    const fb = registry.get(kind, registry.fallback(kind));
    if (key && key !== 'none') warn(warnings, Object.assign({ code: 'part-error', detail: 'unknown ' + kind + ' ' + key }, where));
    return fb;
  }

  // Params of a decision, completed with autos for any param the decision lacks (hand-made or older plans).
  function paramsOf(registry, def, decision, seed, ax) {
    const given = (decision && decision.p) || {};
    const list = registry.params ? registry.params(def.kind, def.key) : null;
    if (!list) return Object.assign({}, given);
    const out = {};
    for (const { name, spec } of list) {
      if (given[name] !== undefined) { out[name] = given[name]; continue; }
      out[name] = SCH.autoValue(spec, { f: ax.f || {}, look: ax.look, rng: RNG.stream(seed, 'param', name) });
    }
    for (const k of Object.keys(given)) if (out[k] === undefined) out[k] = given[k];
    return out;
  }

  // --- the environment parts receive (§4.17.5 env; additive: orient, slot, key, seed) --------------------------

  function autoContext(plan, cut) {
    return { f: (cut && cut.feat) || {}, look: { amounts: plan.look.amounts || {}, mood: null, bpm: plan.beats ? plan.beats.bpm : null } };
  }

  function baseEnv(plan, svc, sb, D, cut, times, origin) {
    const slots = cut ? cut.slots : {};
    return {
      D, cut, feat: cut ? cut.feat : null, role: cut ? cut.role : null, times,
      textStyle: Object.freeze({ face: valueOf(slots, 'text.face', 'display'), scale: valueOf(slots, 'text.scale', 1),
        ink: valueOf(slots, 'text.ink', 'ink'), style: valueOf(slots, 'text.style', 'plain') }),
      orient: valueOf(slots, 'orient', 'h'),
      sb, text: svc.text, pal: svc.pal || plan.look.palette, faces: svc.faces || plan.look.faces,
      amounts: plan.look.amounts || {}, grid: F.gridAt(plan, origin),
      level: (tl) => F.levelAt(plan, origin + tl),
      envelope: (tl) => BH.envelopeWeight(tl, times.rest, times.out),
      hints: null,
    };
  }

  function partEnv(base, builder, def, slot, decision, subject, owner, hints) {
    const seed = slotSeed(slot, decision, subject);
    const rng = RNG.stream(seed, 'build', def.key);
    builder.setContext({ owner, rng: rng.fork('sb') });
    return Object.assign({}, base, { rng, owner, seed, slot, key: def.key, hints: hints || null });
  }

  // --- targets -----------------------------------------------------------------------------------------------------

  // target (§4.17.5, FROZEN fields) plus per-glyph data the kit adapters read: ch, cls, em, x/y (local rest centre),
  // wx/wy (frame rest centre), w/h (cell), cx/cy (du from the focus centre), box (the cell's frame rest box, x0 y0 x1 y1
  // per glyph, through its whole rest transform), lang, arrived (set after the entrance).
  function makeTarget(builder, range, focus, lang) {
    const { table, stores } = builder;
    const runs = builder.runs.filter((r) => !r.late);
    const n = range.to - range.from;
    const rest = T.restWorld(table);
    const t = {
      from: range.from, to: range.to, runs: runs.map((r) => Object.freeze({ node: r.node, spec: r.spec, layout: r.layout,
        from: r.from, to: r.to })),
      units: { glyph: n, word: 0, line: 0, run: runs.length },
      unitOf: { word: new Int16Array(n), line: new Int16Array(n), run: new Int16Array(n) },
      emph: new Uint8Array(n), focus,
      ch: new Array(n), cls: new Array(n), em: new Float32Array(n), x: new Float32Array(n), y: new Float32Array(n),
      wx: new Float32Array(n), wy: new Float32Array(n), w: new Float32Array(n), h: new Float32Array(n),
      cx: new Float32Array(n), cy: new Float32Array(n), box: new Float32Array(n * 4), lang, arrived: null,
    };
    const fx = focus.x + focus.w / 2, fy = focus.y + focus.h / 2;
    let wordBase = 0, lineBase = 0;
    runs.forEach((r, ri) => {
      let words = 0, lines = 0;
      for (let i = r.from; i < r.to; i++) {
        const j = i - range.from, g = stores.glyph[table.payload[i]];
        t.unitOf.word[j] = wordBase + g.word; t.unitOf.line[j] = lineBase + g.line; t.unitOf.run[j] = ri;
        words = Math.max(words, g.word + 1); lines = Math.max(lines, g.line + 1);
        t.emph[j] = g.emph ? 1 : 0; t.ch[j] = g.ch; t.cls[j] = g.cls; t.em[j] = g.em; t.w[j] = g.w; t.h[j] = g.h;
        t.x[j] = table.base.x[i]; t.y[j] = table.base.y[i];
        t.wx[j] = rest.m[i * 6 + 4]; t.wy[j] = rest.m[i * 6 + 5];
        t.cx[j] = t.wx[j] - fx; t.cy[j] = t.wy[j] - fy;
        cellBox(rest.m, i * 6, g.w / 2, g.h / 2, t.box, j * 4);
      }
      wordBase += words; lineBase += lines;
    });
    t.units.word = wordBase; t.units.line = lineBase;
    return t;
  }

  // The frame box of a cell ±hw × ±hh under the 2×3 matrix m[o..o+5], into out[k..k+3] as x0 y0 x1 y1.
  function cellBox(m, o, hw, hh, out, k) {
    const ax = Math.abs(m[o] * hw) + Math.abs(m[o + 2] * hh), ay = Math.abs(m[o + 1] * hw) + Math.abs(m[o + 3] * hh);
    out[k] = m[o + 4] - ax; out[k + 1] = m[o + 5] - ay; out[k + 2] = m[o + 4] + ax; out[k + 3] = m[o + 5] + ay;
  }

  // Where the text is, for decorations and cameras (additive to hints { focus, free }, §4.17.5), boxes { x, y, w, h } in
  // frame du at rest: `lines`, each text line (a column, in vertical text) in reading order; `emphLines`, the first
  // emphasized word's part on each line it touches; `emph`, that word's box when the text is a single line (null
  // otherwise: on several lines a mark under the word would meet the next line, so parts that read `emph` keep their
  // whole-block rule there and can use `emphLines` with `lines` to decide).
  function textHints(target) {
    const n = target.to - target.from, box = target.box;
    const union = (list) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const j of list) {
        x0 = Math.min(x0, box[j * 4]); y0 = Math.min(y0, box[j * 4 + 1]);
        x1 = Math.max(x1, box[j * 4 + 2]); y1 = Math.max(y1, box[j * 4 + 3]);
      }
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };
    const byLine = (keep) => {
      const m = new Map();
      for (let j = 0; j < n; j++) {
        if (target.cls[j] === 'space' || !keep(j)) continue;
        const line = target.unitOf.line[j];
        if (!m.has(line)) m.set(line, []);
        m.get(line).push(j);
      }
      return [...m.keys()].sort((a, b) => a - b).map((k) => union(m.get(k)));
    };
    // the first run of emphasized glyphs (spaces inside it included)
    let first = -1, last = -1;
    for (let j = 0; j < n; j++) {
      if (!target.emph[j]) { if (first >= 0 && target.cls[j] !== 'space') break; continue; }
      if (first < 0) first = j;
      last = j;
    }
    const lines = byLine(() => true);
    const emphLines = first < 0 ? [] : byLine((j) => j >= first && j <= last && target.emph[j] === 1);
    return { lines, emphLines, emph: lines.length === 1 && emphLines.length === 1 ? emphLines[0] : null };
  }

  // Cut-local times { a, rest, out, b }: the entrance ends at rest, the exit starts at out (§4.17.5).
  function timesOf(cut) {
    return { a: cut.a - cut.t0, rest: cut.a - cut.t0, out: cut.b - cut.t0, b: cut.b - cut.t0 };
  }

  function fitTimes(times, target, arrive, arriveEnv, depart, departEnv) {
    const A = BH.motionTotal(arriveEnv, target, arrive.p, 'arrive', arrive.def.unit);
    const L = BH.motionTotal(departEnv, target, depart.p, 'depart', depart.def.unit);
    times.rest = times.a + A;
    times.out = times.b - L;
    if (times.out < times.rest) times.rest = times.out;    // the exit still ends at b; there is no calm stretch
  }

  // Per-glyph arrival times (cut-local) for dwell parts: when each glyph's entrance ends. Read from the entrance's own
  // kit behaviour when it made one (the same delays and scatter order); otherwise fitted the way the adapters fit,
  // with the entrance's env (whose seed orders a scatter).
  function arrivals(arriveEnv, target, arrive, made) {
    const n = target.to - target.from;
    const out = new Float32Array(n).fill(arriveEnv.times.a);
    if (made.length === 0 || n === 0) return out;
    const own = made.find((b) => b.run === BH.runGlyphMotion && b.from === target.from && b.to === target.to);
    if (own) {
      for (let j = 0; j < n; j++) out[j] = own.t0 + own.delay[j] + own.dur;
      return out;
    }
    const tm = BH.motionTiming(arriveEnv, target, arrive.p, 'arrive', arrive.def.unit || 'glyph');
    for (let j = 0; j < n; j++) out[j] = arriveEnv.times.a + tm.delay[j] + tm.dur;
    return out;
  }

  // --- buildCut ----------------------------------------------------------------------------------------------------

  // buildCut(cutPlan, plan, svc) → Scene. svc = { registry, text: TextService, assets, pal?, faces?, strict?,
  // provisional? }. A part that throws makes the cut rebuild with fallback parts and a 'part-error' warning, unless
  // svc.strict (tests) asks for the error.
  function buildCut(cut, plan, svc) {
    try {
      return buildCutWith(cut, cut.slots, plan, svc, []);
    } catch (e) {
      if (svc.strict) throw e;
      const warnings = [Object.freeze({ code: 'part-error', cut: cut.key, line: cut.line, detail: String(e && e.message) })];
      return buildCutWith(cut, fallbackSlots(cut.slots, svc.registry), plan, svc, warnings);
    }
  }

  function fallbackSlots(slots, registry) {
    const out = Object.assign({}, slots);
    for (const s of PART_SLOTS) {
      const kind = s;
      out[s] = Object.assign({}, slots[s] || {}, { v: registry.fallback(kind), from: 'fallback' });
    }
    for (const s of ORNAMENT_SLOTS) if (out[s]) out[s] = { v: 'none', from: 'fallback' };
    return out;
  }

  function buildCutWith(cut, slots, plan, svc, warnings) {
    const reg = svc.registry;
    const D = designEnv(plan.design);
    const where = { cut: cut.key, line: cut.line };
    const els = cut.els || {};
    const builder = B.createBuilder({ D, text: svc.text, cutText: cut.text, defaults: {
      orient: valueOf(slots, 'orient', 'h'), face: valueOf(slots, 'text.face', 'display'),
      ink: valueOf(slots, 'text.ink', 'ink'), style: valueOf(slots, 'text.style', 'plain'), lang: cut.lang, emph: cut.emph } });
    const cam = builder.camera();
    const times = timesOf(cut);
    const base = baseEnv(plan, svc, builder.sb, D, Object.assign({}, cut, { slots }), times, cut.t0);
    const ax = autoContext(plan, cut);
    const part = (kind, slot) => {
      const d = decisionOf(slots, slot);
      const def = partOf(reg, kind, d, warnings, where);
      const dd = d && d.v === def.key ? d : { v: def.key, p: d && d.p, from: 'fallback' };
      return { def, d: dd, p: paramsOf(reg, def, dd, slotSeed(slot, dd, cut.text), ax) };
    };

    // text: arrange → commit → element pins → target
    const arrange = part('arrange', 'arrange');
    const res = arrange.def.build(partEnv(base, builder, arrange.def, 'arrange', arrange.d, cut.text, 'text'), arrange.p) || {};
    const range = builder.commitText();
    let focus = isBox(res.focus) ? res.focus : (builder.boundsOf('text') || { x: D.cx, y: D.cy, w: 0, h: 0 });
    const textPins = els.text || {};
    if (textPins.nudge) { builder.nudge('text', textPins.nudge); focus = nudgedBox(focus, textPins.nudge); }
    if (textPins.fill) builder.fill('text', textPins.fill);
    if (textPins.hide) builder.hide('text');
    const free = Array.isArray(res.free) && !textPins.nudge ? res.free : builder.sb.freeAround(focus);
    const target = makeTarget(builder, range, focus, cut.lang);

    // motion: times from the fitted entrance/exit, then the parts (behaviours kept in arrive, dwell, depart order)
    const arrive = part('arrive', 'arrive'), dwell = part('dwell', 'dwell'), depart = part('depart', 'depart');
    // envOf also points the builder's owner and randomness at the part, so it is called right before each make
    const envOf = (x, slot) => partEnv(base, builder, x.def, slot, x.d, cut.text, 'text');
    fitTimes(times, target, arrive, envOf(arrive, 'arrive'), depart, envOf(depart, 'depart'));
    const arriveEnv = envOf(arrive, 'arrive');
    const arriveB = checked(arrive.def.make(arriveEnv, target, arrive.p), 'arrive/' + arrive.def.key);
    const departB = checked(depart.def.make(envOf(depart, 'depart'), target, depart.p), 'depart/' + depart.def.key);
    if (arriveB.length === 0) times.rest = times.a;
    if (departB.length === 0) times.out = times.b;
    target.arrived = arrivals(arriveEnv, target, arrive, arriveB);
    const dwellB = checked(dwell.def.make(envOf(dwell, 'dwell'), target, dwell.p), 'dwell/' + dwell.def.key);
    for (const b of arriveB.concat(dwellB, departB)) builder.sb.behave(b);

    // decorations and cameras see where the text is: its block (focus), the free areas, each line's box and the
    // emphasized word's box (measured after a text nudge pin, so they move with the words)
    const at = textHints(target);
    const hints = { focus, free, lines: at.lines, emphLines: at.emphLines, emph: at.emph };
    buildOrnaments(builder, base, slots, els, reg, cut, hints, warnings, where, ax);
    const lens = part('lens', 'lens');
    const lensB = lens.def.make(partEnv(base, builder, lens.def, 'lens', lens.d, cut.text, 'lens', hints), cam, lens.p);
    for (const b of checked(lensB, 'lens/' + lens.def.key)) builder.sb.behave(b);

    return sceneOf(builder, {
      key: cut.key, fp: cut.fp, kind: 'cut', t0: cut.t0, cam, text: range, span: { a: cut.a, b: cut.b }, times, target,
      focus, warnings: warnings.concat(overfullOf(builder, cut)), svc,
    });
  }

  function buildOrnaments(builder, base, slots, els, reg, cut, hints, warnings, where, ax) {
    const count = valueOf(slots, 'ornament.count', 0);
    ORNAMENT_SLOTS.forEach((slot, k) => {
      const d = decisionOf(slots, slot);
      const pins = els[slot] || {};
      if (k >= count || !d || !d.v || d.v === 'none' || pins.hide) return;
      const def = partOf(reg, 'ornament', d, warnings, where);
      const dd = d.v === def.key ? d : { v: def.key, p: d.p, from: 'fallback' };
      let p = paramsOf(reg, def, dd, slotSeed(slot, dd, cut.text), ax);
      if (pins.fill) p = Object.assign({}, p, { ink: pins.fill });
      const n0 = builder.table.n;
      def.build(partEnv(base, builder, def, slot, dd, cut.text, slot, hints), p);
      if (def.follow === 'text') followText(builder, n0, base.times);
      if (pins.nudge) builder.nudge(slot, pins.nudge);
      if (pins.fill) builder.fill(slot, pins.fill);
    });
  }

  // `follow: 'text'` ornaments fade with the text's entrance and exit (one behaviour over the new roots).
  function followText(builder, n0, times) {
    const { table } = builder;
    const roots = [];
    for (let i = n0; i < table.n; i++) {
      if (table.parent[i] < n0) roots.push(i);
      table.flags[i] |= T.FLAG.followText;
    }
    if (roots.length === 0) return;
    builder.sb.behave({ phase: BH.PH.ORNAMENT, live: 'always', from: roots[0], to: roots[roots.length - 1] + 1, t0: times.a,
      t1: times.b, run: BH.runFollow, roots: Int32Array.from(roots), times });
  }

  function checked(list, who) {
    if (list === undefined || list === null) return [];
    if (!Array.isArray(list)) throw new BH.BehaviourError('bad-behaviour', who + ': make() must return an array of behaviours');
    for (const b of list) BH.check(b);
    return list;
  }

  function isBox(b) { return !!b && [b.x, b.y, b.w, b.h].every((v) => typeof v === 'number' && Number.isFinite(v)); }

  function nudgedBox(box, v) {
    const s = typeof v.s === 'number' && v.s > 0 ? v.s : 1;
    const cx = box.x + box.w / 2 + (v.dx || 0), cy = box.y + box.h / 2 + (v.dy || 0);
    return { x: cx - (box.w * s) / 2, y: cy - (box.h * s) / 2, w: box.w * s, h: box.h * s };
  }

  function overfullOf(builder, cut) {
    return builder.runs.some((r) => r.layout && r.layout.overfull)
      ? [Object.freeze({ code: 'overfull', cut: cut.key, line: cut.line })] : [];
  }

  // --- buildGround ---------------------------------------------------------------------------------------------------

  // buildGround(seg, plan, svc) → Scene with the segment's ground and atmos; local time = t − seg.t0. Like buildCut, a
  // ground or atmos that throws makes the segment rebuild with the fallback ground (auto params) and no atmos, plus a
  // 'part-error' warning, unless svc.strict.
  function buildGround(seg, plan, svc) {
    try {
      return buildGroundWith(seg, seg.ground, seg.atmos, plan, svc, []);
    } catch (e) {
      if (svc.strict) throw e;
      const warnings = [Object.freeze({ code: 'part-error', cut: seg.cuts && seg.cuts[0], detail: String(e && e.message) })];
      const ground = { v: svc.registry.fallback('ground'), from: 'fallback' };
      return buildGroundWith(seg, ground, { v: 'none', from: 'fallback' }, plan, svc, warnings);
    }
  }

  function buildGroundWith(seg, groundD, atmosD, plan, svc, warnings) {
    const reg = svc.registry;
    const D = designEnv(plan.design);
    const where = { cut: seg.cuts && seg.cuts[0] };
    // INT-PLAN: a ground scene gets no cut (env.cut, env.feat, env.role are null, the text style is the default, the
    // builder has no cut text). A segment's fingerprint covers its decisions, length and look, not its cuts (§3.12 fp,
    // §7.1.5), and the planner has already resolved the segment's parameters from its first cut (§4.16.6).
    const builder = B.createBuilder({ D, text: svc.text, cutText: '', defaults: {} });
    const cam = builder.camera();
    const len = Math.max(0, seg.t1 - seg.t0);
    const times = { a: 0, rest: 0, out: len, b: len };
    const base = baseEnv(plan, svc, builder.sb, D, null, times, seg.t0);
    const ax = autoContext(plan, null);
    const range = builder.commitText();
    const ground = partOf(reg, 'ground', groundD, warnings, where);
    const gd = groundD && groundD.v === ground.key ? groundD : { v: ground.key, p: groundD && groundD.p };
    ground.build(partEnv(base, builder, ground, 'ground', gd, '', 'ground'), paramsOf(reg, ground, gd, slotSeed('ground', gd, ''), ax));
    if (atmosD && atmosD.v && atmosD.v !== 'none') {
      const atmos = partOf(reg, 'ornament', atmosD, warnings, where);
      const ad = atmosD.v === atmos.key ? atmosD : { v: atmos.key, p: atmosD.p };
      const safe = { x: D.safe.l, y: D.safe.t, w: D.w - D.safe.l - D.safe.r, h: D.h - D.safe.t - D.safe.b };
      atmos.build(partEnv(base, builder, atmos, 'atmos', ad, '', 'atmos', { focus: safe, free: [] }),
        paramsOf(reg, atmos, ad, slotSeed('atmos', ad, ''), ax));
    }
    return sceneOf(builder, { key: seg.key, fp: seg.fp, kind: 'ground', t0: seg.t0, cam, text: range,
      span: { a: seg.t0, b: seg.t1 }, times, target: null, focus: null, warnings, svc });
  }

  // --- the Scene -----------------------------------------------------------------------------------------------------

  // Scene (§4.17.5) plus additive fields: kind ('cut'|'ground'), t0 (local time origin), stores (per-type payloads),
  // times, target, focus, fontKey (measurer key the text was laid out with).
  //
  // What a renderer reads (the contract engine/render/* builds on):
  //   table            engine/scene/table columns; nodes in index order are topological; evaluate() fills live/m/wa
  //   table.payload[i] index into stores[TYPE_NAMES[type]]:
  //     glyph      { run, i, ch, cls, vcls, rot (0 | 1 = +90° | 2 = +90° mirrored), sx (tcy), em (du), font (FontRef),
  //                  ink (token | #hex; the emphasis ink already applied), emph, style, reveal (revealMode), w, h, off,
  //                  line, word }  drawn centred at the node origin (textAlign center, textBaseline middle)
  //     shape      { path: ShapeSpec, fill, stroke (ink | null), width, dash, cap, bounds [x0, y0, x1, y1] }
  //     paint      { draw(g, t, data, q), data, bleed, animated }  g in frame du, t = local time
  //     image      { asset, fit, box }
  //     particles  { data, sprite, ink }  positions from builder.particleAt(data, j, t, out)
  //   runs[k]          { node, spec, layout, from, to, ink, emphInk, clip }  clip = the box of an overfull run
  //   layers           LayerSpec per LAYERS entry (sb.layer patches); owners[table.owner[i]] = { el, slot }
  //   cam              the camera node (frame.cameraAt reads its live pose)
  function sceneOf(builder, o) {
    const behaviours = builder.seal();
    const glyphKeys = new Set();
    for (const g of builder.stores.glyph) if (g.cls !== 'space' && g.font) glyphKeys.add(g.font.key + '|' + g.ch);
    return {
      key: o.key, fp: o.fp, kind: o.kind, t0: o.t0,
      table: builder.table, behaviours, layers: builder.layers, cam: o.cam, owners: builder.owners,
      text: { from: o.text.from, to: o.text.to },
      runs: builder.runs.map((r) => Object.freeze({ node: r.node, spec: r.spec, layout: r.layout, from: r.from, to: r.to,
        ink: r.ink, emphInk: r.emphInk, clip: r.layout ? r.layout.clip : null })),
      span: o.span, warnings: o.warnings, glyphKeys: [...glyphKeys].sort(), provisional: o.svc.provisional === true,
      stores: builder.stores, times: o.times, target: o.target, focus: o.focus,
      fontKey: o.svc.text ? o.svc.text.key : null,
    };
  }

  return { SAFE, designEnv, slotSeed, buildCut, buildGround, fallbackSlots };
});
