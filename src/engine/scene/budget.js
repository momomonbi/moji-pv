/* 文字PVメーカー v2 — original work. The glyph budget of a cut: what drawing its glyphs covers, sampled over each material phase, and the masks that keep a material within its share (DESIGN_2_1 §5.9.5). */
MV.def('engine/scene/budget', ['core/mat', 'engine/scene/table', 'engine/scene/behave', 'engine/scene/frame', 'engine/render/draw'],
(MAT, T, BH, F, DR) => {
  'use strict';

  // A material entrance, hold or exit (a text material: its def has `mine`) may add at most SHARE frames to what drawing
  // its cut's glyphs covers (draw.glyphCover: the rects drawGlyph draws, summed, as frame areas) at every sample of its
  // phase, over the same cut with that material's masks all on. A cut's window overlaps only its neighbours' (by lead +
  // tail), so where the slots hold materials, a frame's glyphs cover at most 2 · SHARE frames more than the same text
  // without them.
  const SHARE = 2;
  const SLACK = 1.2;              // zoom beyond the cut's own camera (lens ∘ shot): a rig (≤ 1.15) and a punch (1.04)
  const STEP = 1 / 30;            // seconds between samples (the export frame rate)
  const MAX_SAMPLES = 40;
  const HOLD_SAMPLES = 16;        // a hold's cover changes slowly (its oscillators only add a halo and a tint, or sway)
  // The masks (BH.MASK_GROUPS) tried in order until the phase fits: the tint, the echo, the glow, then everything that
  // puts a glyph on the sprite path, then its size. Each step takes back more, so the cover never grows along it.
  const LADDER = Object.freeze([[], ['tint'], ['tint', 'echo'], ['tint', 'echo', 'glow'], ['tint', 'echo', 'glow', 'blur'],
    ['tint', 'echo', 'glow', 'blur', 'grow']].map((g) => Object.freeze(g)));
  const LAST = LADDER.length - 1;
  const PHASES = Object.freeze(['arrive', 'dwell', 'depart']);

  // A recorded glyph at one sample: its screen matrix (6), blur, glow, shard, pixel, echo, tint, and whether it is drawn.
  const REC = 13;
  const B_BLUR = 6, B_GLOW = 7, B_SHARD = 8, B_PIXEL = 9, B_ECHO = 10, B_TINT = 11, B_ON = 12;

  const CAM = { x: 0, y: 0, zoom: 1, roll: 0, jx: 0, jy: 0, fz: 1 };
  const POSE = { x: 0, y: 0, zoom: 1, roll: 0, shakeX: 0, shakeY: 0, fz: 1 };
  const VIEW = new Float32Array(6), WORLD = new Float32Array(6), SCREEN = new Float32Array(6), M6 = new Float32Array(6);

  // Evaluates the scene at cut-local time tl and walks its glyph nodes under the cut's camera zoomed by slack (each layer
  // at its parallax): visit(i, screen matrix, P, world alpha) for each glyph node that is not hidden by flag.
  function walk(scene, tl, D, slack, visit) {
    const table = F.evaluate(scene, tl);
    F.cutCamera(scene, CAM);
    POSE.x = CAM.x; POSE.y = CAM.y; POSE.zoom = CAM.zoom * slack; POSE.roll = CAM.roll; POSE.shakeX = CAM.jx; POSE.shakeY = CAM.jy;
    const m = table.m;
    let layer = -1;
    for (let i = 0; i < table.n; i++) {
      if (table.type[i] !== T.TYPE.glyph || (table.flags[i] & T.FLAG.hidden) !== 0) continue;
      if (table.layer[i] !== layer) { layer = table.layer[i]; F.viewMatrix(VIEW, POSE, T.LAYERS[layer].parallax, D.w, D.h); }
      const o = i * 6;
      for (let k = 0; k < 6; k++) WORLD[k] = m[o + k];
      visit(i, MAT.mul(SCREEN, VIEW, WORLD), table.live, table.wa[i]);
    }
  }

  // coverAt(scene, tl, D, slack?) → the frame share drawing the scene's glyphs covers at cut-local time tl (evaluated
  // here), under the cut's camera zoomed by slack (SLACK by default). D = { w, h } (du).
  function coverAt(scene, tl, D, slack) {
    const store = scene.stores.glyph, table = scene.table;
    let sum = 0;
    walk(scene, tl, D, slack > 0 ? slack : SLACK, (i, M, P, wa) => {
      sum += DR.glyphCover(store[table.payload[i]], P, i, wa, M, D.w, D.h);
    });
    return sum / (D.w * D.h);
  }

  // The sample times of a window [t0, t1] (cut-local): at most STEP apart, both ends included, at most `max`
  // (MAX_SAMPLES by default).
  function samplesOf(t0, t1, max) {
    if (!(t1 > t0)) return [];
    const n = Math.min(max > 1 ? max : MAX_SAMPLES, Math.max(2, Math.ceil((t1 - t0) / STEP) + 1));
    const out = new Array(n);
    for (let k = 0; k < n; k++) out[k] = t0 + ((t1 - t0) * k) / (n - 1);
    return out;
  }

  function windowOf(times, phase) {
    if (phase === 'arrive') return [times.a, times.rest];
    if (phase === 'dwell') return [times.rest, times.out];
    return [times.out, times.b];
  }

  // The glyph nodes of a scene, in node order.
  function glyphNodes(table) {
    const out = [];
    for (let i = 0; i < table.n; i++) if (table.type[i] === T.TYPE.glyph) out.push(i);
    return out;
  }

  // Records every glyph node at each sample (REC values per node; B_ON 0 when it draws nothing).
  function record(scene, times, D, nodes) {
    const slot = new Int32Array(scene.table.n).fill(-1);
    nodes.forEach((i, k) => { slot[i] = k; });
    const out = new Float64Array(times.length * nodes.length * REC);
    times.forEach((t, s) => {
      walk(scene, t, D, SLACK, (i, M, P, wa) => {
        const o = (s * nodes.length + slot[i]) * REC;
        for (let k = 0; k < 6; k++) out[o + k] = M[k];
        out[o + B_BLUR] = P.blur[i]; out[o + B_GLOW] = P.glow[i]; out[o + B_SHARD] = P.shard[i]; out[o + B_PIXEL] = P.pixel[i];
        out[o + B_ECHO] = P.echo[i]; out[o + B_TINT] = P.tint[i];
        out[o + B_ON] = P.reveal[i] > 0.001 && wa >= T.MIN_ALPHA ? 1 : 0;
      });
    });
    return out;
  }

  // The cover (frame share) of sample s at ladder step k: a = the unmasked record, b = the record with every mask on
  // (null: step 0 only). Below LAST the size and whether a glyph is drawn come from a (the grow group is masked only at
  // LAST), the masked columns from b; LAST is b.
  function coverOf(scene, nodes, a, b, s, k, D) {
    const store = scene.stores.glyph, table = scene.table, n = nodes.length;
    const g = LADDER[k];
    const tint = !!b && g.includes('tint'), echo = !!b && g.includes('echo'), glow = !!b && g.includes('glow');
    const blur = !!b && g.includes('blur');
    const src = k === LAST ? b : a;
    let sum = 0;
    for (let j = 0; j < n; j++) {
      const o = (s * n + j) * REC;
      if (src[o + B_ON] !== 1) continue;
      for (let q = 0; q < 6; q++) M6[q] = src[o + q];
      sum += DR.poseCover(store[table.payload[nodes[j]]], (blur ? b : src)[o + B_BLUR], (glow ? b : src)[o + B_GLOW],
        (blur ? b : src)[o + B_SHARD], (blur ? b : src)[o + B_PIXEL], (echo ? b : src)[o + B_ECHO], (tint ? b : src)[o + B_TINT],
        M6, D.w, D.h);
    }
    return sum / (D.w * D.h);
  }

  // Puts the masks of LADDER[step] on a phase's behaviours in scene.behaviours (the originals: ph.list; the ones in
  // place: ph.now, kept up to date).
  function applyStep(scene, ph, step) {
    const groups = LADDER[step];
    const from = scene.text.from, to = scene.text.to;
    for (let k = 0; k < ph.list.length; k++) {
      const next = BH.masked(ph.list[k], groups, from, to);
      const at = scene.behaviours.indexOf(ph.now[k]);
      if (at >= 0) scene.behaviours[at] = next;
      ph.now[k] = next;
    }
  }

  // fit(scene, D, phases) → the budget record, or null when no phase holds a material. phases = [{ phase, def, list }]:
  // the cut's entrance, hold and exit (def = the part definition, list = the behaviours its make returned, now in
  // scene.behaviours). A material phase may add at most SHARE frames to what its cut's glyphs cover (coverAt) at every
  // sample of its window, over the same cut with every mask of that material on (the last LADDER step: its text as it
  // is without the material's sprite columns and size changes). Over it, the phase gets the first LADDER step that fits
  // (the added cover never grows along the ladder; the last step adds nothing); its behaviours in scene.behaviours are
  // replaced by masked ones. A pure function of the scene as built; the scene's live pose, world matrices and alphas are
  // left as they were. Each sample is evaluated once as built and, when the phase is over SHARE even counting the text
  // itself, once more with every mask on: a step between differs from the first only in masked sprite columns, which
  // move nothing, so its cover is read from the two.
  // Record: { share, arrive?, dwell?, depart? }, each { key, added, fitted, step, masks }.
  function fit(scene, D, phases) {
    const own = (phases || []).filter((p) => p && p.def && p.def.mine && Array.isArray(p.list) && p.list.length > 0 &&
      PHASES.includes(p.phase));
    if (own.length === 0 || !(scene.text && scene.text.to > scene.text.from)) return null;
    const table = scene.table;
    const keepM = table.m.slice(0, table.n * 6), keepWa = table.wa.slice(0, table.n);
    const nodes = glyphNodes(table);
    const out = { share: SHARE };
    try {
      for (const p of own) {
        const [t0, t1] = windowOf(scene.times, p.phase);
        const times = samplesOf(t0, t1, p.phase === 'dwell' ? HOLD_SAMPLES : MAX_SAMPLES);
        if (times.length === 0) continue;
        const ph = { list: p.list, now: p.list.slice() };
        const a = record(scene, times, D, nodes);
        let total = 0;
        for (let s = 0; s < times.length; s++) total = Math.max(total, coverOf(scene, nodes, a, null, s, 0, D));
        let step = 0, added = total, fitted = total;
        if (total > SHARE) {
          applyStep(scene, ph, LAST);
          const b = record(scene, times, D, nodes);
          const addedAt = (k) => {
            let peak = 0;
            for (let s = 0; s < times.length; s++) {
              peak = Math.max(peak, coverOf(scene, nodes, a, b, s, k, D) - coverOf(scene, nodes, a, b, s, LAST, D));
            }
            return peak;
          };
          added = addedAt(0);
          while (step < LAST && addedAt(step) > SHARE) step++;
          fitted = addedAt(step);
        }
        applyStep(scene, ph, step);
        out[p.phase] = Object.freeze({ key: p.def.key, added, fitted, step, masks: LADDER[step] });
      }
    } finally {
      T.resetLive(table);
      table.m.set(keepM);
      table.wa.set(keepWa);
    }
    return Object.freeze(out);
  }

  return { SHARE, SLACK, STEP, MAX_SAMPLES, HOLD_SAMPLES, LADDER, coverAt, samplesOf, fit };
});
