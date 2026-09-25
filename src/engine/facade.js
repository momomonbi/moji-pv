/* 文字PVメーカー v2 — original work. Engine facade: plan + scenes + renderer behind the FROZEN §4.20 API, plus sample plans for thumbnails and the lab (DESIGN_2_1 §3.10, §11.3.7 additions). */
MV.def('engine/facade', ['core/hash', 'core/rng', 'core/schema', 'core/script', 'core/doc', 'core/pins', 'core/shot',
  'engine/text/service', 'engine/text/faces', 'engine/scene/build', 'engine/scene/cache', 'engine/scene/frame',
  'engine/render/renderer', 'engine/render/sprites', 'parts/mix', 'planner/plan', 'planner/look'],
(H, RNG, SCH, S, DOC, PINS, SHOT, TS, FACES, BUILD, CACHE, F, R, SP, MIX, PL, LOOK) => {
  'use strict';

  const SCENE_MAX = 16;             // §7.3
  const SCAN_PER_PREPARE = 12;      // preview prepare(): extra cuts laid out per call to find overfull text early
  const SLICE_MS = 8;               // preview prepare(): work per slice before it yields to the host (§7.4: edits repaint < 50 ms)
  const EXPORT_SLICE_MS = 40;       // export prepare(): fewer, longer slices
  const SLICE_BUILDS = 2;           // without a clock: scene builds per slice
  const WARM_AHEAD = 3;             // preview prepare(): seconds after the playhead whose glyph sprites are made ahead
  const WARM_FPS = 30;              // …sampled at the stage rate (a frame between two samples reuses their sprites)
  const WARM_SHARE = 0.9;           // …but no further than a working set of this share of the sprite budget: more would
                                    // evict (LRU) the sprites it made first, for the frames needed soonest
  const THUMB_PLANS = 8;
  const MEDIA_MEMO = 4096;          // scenes whose media lists mediaAt remembers (tiny entries; cleared when full)
  const SAMPLE_TEXT = 'はじまりの朝';
  const SAMPLE_TEXT_B = '光のなかへ';

  class EngineError extends Error {
    constructor(code, message) { super(message); this.name = 'EngineError'; this.code = code; }
  }

  // --- sample plans (thumbnails, the lab, browser tests) --------------------------------------------------------------

  // The canned timeline: a cut from 0.12 s to 2.9 s (window 0 … 3.15 s), 120 BPM, a gentle loudness envelope.
  const SAMPLE = Object.freeze({ t0: 0.12, t1: 2.9, lead: 0.12, tail: 0.25, hero: 1.2, bpm: 120 });

  function envelope(seconds) {
    const e = new Float32Array(Math.ceil(seconds * 20) + 4);
    for (let i = 0; i < e.length; i++) e[i] = 0.5 + 0.3 * Math.sin(i * 0.45) * Math.cos(i * 0.11);
    return e;
  }

  function featuresOf(text, lang, dur, role) {
    const cells = S.cells(text), graphemes = S.graphemes(text).length;
    const orients = lang === 'ja' || lang === 'zhHant' || lang === 'zhHans' ? ['h', 'v'] : ['h'];
    return { cells, graphemes, script: lang, latin: 0, orients, words: 2, units: { glyph: graphemes, word: 2, line: 1 },
      emph: false, impact: false, dur, cps: cells / dur, energy: 0.55, beat: 60 / SAMPLE.bpm, onBeat: true, section: null,
      repeatOf: null, pos: 0.3, role };
  }

  // A decision for a part with every param resolved: overrides, else the auto from the part's own param stream.
  function decisionOf(registry, kind, key, ax, seed, overrides, boost) {
    const p = {};
    for (const { name, spec } of registry.params(kind, key) || []) {
      if (overrides && overrides[name] !== undefined) { p[name] = SCH.coerce(spec, overrides[name]); continue; }
      p[name] = SCH.autoValue(spec, Object.assign({}, ax, { rng: RNG.stream(seed, 'param', name) }));
      if (boost && name === 'amount' && typeof p[name] === 'number') p[name] = Math.max(p[name], boost);
    }
    return { v: key, p, from: 'auto' };
  }

  function rolesOf(registry, kind, key) {
    const t = registry.traits ? registry.traits(kind, key) : null;
    return (t && t.roles) || ['lyric', 'focus'];
  }

  // A composition of the fallback's kind that suits the orientation and role (the fallback when it does).
  function hostArrange(registry, orient, role) {
    const ok = (key) => {
      const t = registry.traits ? registry.traits('arrange', key) : null;
      return !t || ((t.orient || ['h', 'v']).includes(orient) && (t.roles || ['lyric']).includes(role));
    };
    const fb = registry.fallback('arrange');
    return ok(fb) ? fb : registry.keys('arrange').find(ok) || fb;
  }

  // samplePlan(registry, ref, opts) → a Plan (§3.12 shape) that shows one part in a canned cut: the part fills its slot
  // and every other slot holds its kind's fallback. ref = { kind, key, params? }; opts = { text, textB, theme, mood,
  // aspect, orient, backdrop, palette, faces, textScale }. Deterministic. A seam gets two cuts with the transition between
  // them; the second shows textB (else SAMPLE_TEXT_B), so a page in another language can pass both lines.
  // DESIGN_2_1 (additive): kind 'shot' puts a shot preset (key; params { zoom, curve, follow } = cam.zoom, cam.curve,
  // cam.follow) on the cut, kind 'rig' a rig preset (params { amp, curve }) on one run over the whole plan (plan v 2);
  // material keys of an extended registry work like any part key.
  function samplePlan(registry, ref, opts) {
    const kind = ref && ref.kind;
    if (kind === 'shot' || kind === 'rig') return cameraSamplePlan(registry, ref, opts);
    const o = opts || {};
    const key = ref && ref.key;
    const def = kind && key ? registry.get(kind, key) : null;
    const aspect = DOC.DESIGN_SIZE[o.aspect] ? o.aspect : '16:9';
    const [w, h] = DOC.DESIGN_SIZE[aspect];
    const lookPart = (k) => (kind === k && def) || (o[k] && registry.get(k, o[k])) || registry.get(k, registry.fallback(k));
    const theme = lookPart('theme'), mood = lookPart('mood');
    const text = typeof o.text === 'string' && o.text.trim() ? o.text.trim() : SAMPLE_TEXT;
    const lang = S.lineScript(text, 'ja');
    const roles = def && ['arrange', 'arrive', 'dwell', 'depart', 'lens'].includes(kind) ? rolesOf(registry, kind, key) : ['lyric'];
    const role = roles.includes('lyric') ? 'lyric' : roles[0];
    const traitOrient = def && registry.traits ? (registry.traits(kind, key) || {}).orient : null;
    let orient = o.orient === 'v' || o.orient === 'h' ? o.orient : traitOrient && !traitOrient.includes('h') ? 'v' : 'h';
    if (orient === 'v' && !(lang === 'ja' || lang === 'zhHant' || lang === 'zhHans')) orient = 'h';
    // the palette a real plan of this theme and backdrop gets (§4.16.3: contrast fit, then black / green-screen rules),
    // so parts that adapt to the backdrop look adapted in the lab, the contact sheets and the thumbnails too
    const palette = o.palette ? Object.assign({}, o.palette) : LOOK.palette(theme, PINS.index({}), o.backdrop || 'scene', null);
    const faces = o.faces || JSON.parse(JSON.stringify(FACES.resolveFaces(theme, null, [lang])));
    const amounts = Object.assign({}, mood.amounts);
    const look = { mood: { v: mood.key, from: 'auto' }, theme: { v: theme.key, from: 'auto' }, season: { v: 'any', from: 'auto' },
      amounts, amountsFrom: {}, palette, faces, texture: null, backdrop: o.backdrop || 'scene' };
    const seed = H.hash32('sample', kind || '', key || '', text, aspect, orient);
    const params = (ref && ref.params) || null;
    const isSeam = kind === 'seam' && def;
    const textB = typeof o.textB === 'string' && o.textB.trim() ? o.textB.trim() : SAMPLE_TEXT_B;
    const texts = isSeam ? [text, textB] : [text];
    const span = isSeam ? 1.5 : SAMPLE.t1 - SAMPLE.t0;
    const textScale = Number.isFinite(o.textScale) && o.textScale > 0 ? o.textScale : 1;
    const cuts = texts.map((tx, n) => sampleCut(registry, { def, kind, key, params, orient, role, tx, n, seed, look, mood, theme,
      textScale, t0: SAMPLE.t0 + n * span, t1: SAMPLE.t0 + (n + 1) * span, last: n === texts.length - 1 }));
    const duration = cuts[cuts.length - 1].b + 0.25;
    const ax = { f: cuts[0].feat, look: { amounts, mood, bpm: SAMPLE.bpm } };
    const runOrnament = kind === 'ornament' && def && def.scope === 'run';
    const ground = kind === 'ground' && def ? decisionOf(registry, 'ground', key, ax, seed, params, 0.6)
      : decisionOf(registry, 'ground', registry.fallback('ground'), ax, seed, null, 0);
    const atmos = runOrnament ? decisionOf(registry, 'ornament', key, ax, seed, params, 0.7) : { v: 'none', from: 'auto' };
    const seg = { key: 'g' + cuts[0].key, t0: 0, t1: duration, cuts: cuts.map((c) => c.key), ground, atmos, fp: '' };
    seg.fp = H.hashJSON({ ground, atmos, aspect, palette, span: duration });
    const seams = [];
    if (isSeam) {
      const A = cuts[0], Bc = cuts[1];
      const slot = decisionOf(registry, 'seam', key, { f: Bc.feat, look: ax.look }, seed, params, 0);
      const dur = Math.min(slot.p.dur || 0.5, 0.4 * Math.min(A.b - A.a, Bc.b - Bc.a));
      seams.push({ into: Bc.key, at: Bc.a, dur, scope: def.scope === 'world' ? 'world' : 'text', a: A.key, b: Bc.key, slot });
      Bc.seamIn = 0;
    }
    const plan = { v: 1, hash: '', duration, design: { aspect, w, h, short: Math.min(w, h) }, look,
      beats: { bpm: SAMPLE.bpm, offset: 0, meter: 4 },
      lines: cuts.map((c, index) => ({ id: c.line, row: c.line, index, text: c.text, t0: c.t0, t1: c.t1,
        by: { start: 'auto', end: 'auto' }, cuts: [c.key], locked: false, lang })),
      cuts, grounds: [seg], seams, impulses: [], warnings: [] };
    plan.hash = H.hashJSON(plan);
    Object.defineProperty(plan, 'env', { enumerable: false, value: envelope(duration) });
    return plan;
  }

  function sampleCut(registry, c) {
    const { def, kind, key, params, orient, role, tx, n, seed, look, mood } = c;
    const lang = S.lineScript(tx, 'ja');
    const feat = featuresOf(tx, lang, c.t1 - c.t0, role);
    const ax = { f: feat, look: { amounts: look.amounts, mood, bpm: SAMPLE.bpm } };
    const own = (k) => def && kind === k;
    const slotSeed = H.hash32(seed, n);
    const part = (k, boost) => (own(k) ? decisionOf(registry, k, key, ax, slotSeed, params, boost)
      : decisionOf(registry, k, registry.fallback(k), ax, slotSeed, null, 0));
    const style = (c.theme && c.theme.style) || 'plain';
    const slots = {
      orient: { v: orient, from: 'auto' },
      arrange: own('arrange') ? decisionOf(registry, 'arrange', key, ax, slotSeed, params, 0)
        : decisionOf(registry, 'arrange', hostArrange(registry, orient, role), ax, slotSeed, null, 0),
      'text.face': { v: 'display', from: 'auto' }, 'text.scale': { v: c.textScale, from: 'auto' },
      'text.ink': { v: 'ink', from: 'auto' }, 'text.style': { v: style, from: 'auto' },
      arrive: part('arrive', 0), dwell: part('dwell', 0.6), depart: part('depart', 0),
      'ornament.count': { v: own('ornament') && def.scope !== 'run' ? 1 : 0, from: 'auto' },
      lens: part('lens', 0.7),
      'filter.count': { v: own('filter') ? 1 : 0, from: 'auto' },
    };
    if (own('ornament') && def.scope !== 'run') slots['ornament#0'] = decisionOf(registry, 'ornament', key, ax, slotSeed, params, 0.7);
    if (own('filter')) {
      const d = decisionOf(registry, 'filter', key, ax, slotSeed, params, 0.75);
      if (!params || params.when === undefined) d.p.when = 'always';
      slots['filter#0'] = d;
    }
    if (kind === 'seam' && def && def.replaces) {
      if (def.replaces.depart && n === 0) slots.depart = { v: registry.fallback('depart'), p: slots.depart.p, from: 'rule' };
      if (def.replaces.arrive && n === 1) slots.arrive = { v: registry.fallback('arrive'), p: slots.arrive.p, from: 'rule' };
    }
    const lineId = 'r' + (n + 1).toString(36);
    const cut = { key: lineId + '~0', line: lineId, role, text: tx, emph: S.graphemes(tx).length > 3 ? [[0, 2]] : [], impact: false,
      note: null, t0: c.t0, t1: c.t1, a: c.t0 - SAMPLE.lead, b: c.t1 + SAMPLE.tail, repT: c.t0 + Math.min(SAMPLE.hero, (c.t1 - c.t0) / 2),
      lang, feat, fp: '', slots, els: {}, ground: 0, seamIn: -1 };
    cut.fp = H.hashJSON({ slots, text: tx, emph: cut.emph, role, span: cut.b - cut.a, palette: look.palette, faces: look.faces,
      n, sample: true });
    return cut;
  }

  // The canned cut with a shot or a rig (picker tiles, the lab, contact sheets): the fallback parts, plus cam.* slots or
  // one rig run covering the plan. An unknown key shows as 'none'.
  function cameraSamplePlan(registry, ref, opts) {
    const base = samplePlan(registry, {}, opts);
    const p = (ref && ref.params) || {};
    const plan = Object.assign({}, base, { v: 2 });
    const cut = Object.assign({}, base.cuts[0]);
    if (ref.kind === 'shot') {
      const shot = SHOT.coerceShot(ref.key);
      const slots = Object.assign({}, cut.slots, { 'cam.shot': { v: shot === undefined ? 'none' : shot, from: 'auto' },
        'cam.zoom': { v: Number.isFinite(p.zoom) ? p.zoom : 1, from: 'auto' } });
      if (p.curve !== undefined) slots['cam.curve'] = { v: p.curve, from: 'auto' };
      if (Number.isFinite(p.follow)) slots['cam.follow'] = { v: p.follow, from: 'auto' };
      cut.slots = slots;
      cut.fp = H.hashJSON({ base: base.cuts[0].fp, shot: slots['cam.shot'].v, zoom: slots['cam.zoom'].v, curve: p.curve || null,
        follow: Number.isFinite(p.follow) ? p.follow : null });
    }
    cut.rig = 0;
    plan.cuts = [cut];
    const rig = ref.kind === 'rig' ? SHOT.coerceRig(ref.key) : 'none';
    const preset = typeof rig === 'string' && SHOT.RIGS[rig] ? SHOT.RIGS[rig] : null;
    plan.rigs = [{ blend: null, cuts: [cut.key], curve: { from: 'auto', v: p.curve !== undefined ? p.curve : preset ? preset.curve : 'linear' },
      key: 'k' + cut.key, rig: { from: 'auto', p: { amp: Number.isFinite(p.amp) ? p.amp : 1 }, v: rig === undefined ? 'none' : rig },
      t0: 0, t1: base.duration }];
    plan.grounds = base.grounds.map((g) => Object.assign({}, g, { zoomed: ref.kind === 'shot' && cut.slots['cam.shot'].v !== 'none' }));
    plan.hash = '';
    plan.hash = H.hashJSON(plan);
    Object.defineProperty(plan, 'env', { enumerable: false, value: base.env });
    return plan;
  }

  // The time a thumbnail shows when none is given: the hero frame, or the middle of the transition.
  function sampleTime(plan, kind) {
    if (kind === 'seam' && plan.seams.length) return plan.seams[0].at;
    return plan.cuts[0].repT;
  }

  // --- the engine ------------------------------------------------------------------------------------------------------

  function changedKeys(before, after) {
    const old = new Map((before || []).map((x) => [x.key, x.fp]));
    return (after || []).filter((x) => old.get(x.key) !== x.fp).map((x) => x.key);
  }

  function roleFace(cut) {
    const d = cut.slots && cut.slots['text.face'];
    return d && d.v ? d.v : 'display';
  }

  // --- font usage (§4.14: export waits for every face and character used) ------------------------------------------------

  // A usage record: { refs: Map(key|script → FontRef), chars: Map(family → Set(character)) }.
  function newUsage() { return { refs: new Map(), chars: new Map() }; }

  function addChars(u, family, text) {
    let set = u.chars.get(family);
    if (!set) { set = new Set(); u.chars.set(family, set); }
    for (const ch of String(text || '')) if (ch >= ' ' && !/\s/.test(ch)) set.add(ch);
  }

  function addRef(u, ref, text) {
    if (!ref || !ref.family) return;
    const id = ref.key + '|' + ref.script;
    if (!u.refs.has(id)) u.refs.set(id, ref);
    addChars(u, ref.family, text);
  }

  function mergeUsage(into, u) {
    for (const [id, ref] of u.refs) if (!into.refs.has(id)) into.refs.set(id, ref);
    for (const [family, set] of u.chars) addChars(into, family, [...set].join(''));
    return into;
  }

  // Whether `a` already holds every face and character of `b`.
  function covers(a, b) {
    for (const id of b.refs.keys()) if (!a.refs.has(id)) return false;
    for (const [family, set] of b.chars) {
      const have = a.chars.get(family);
      for (const ch of set) if (!have || !have.has(ch)) return false;
    }
    return true;
  }

  // The FontBook's shape: { refs: FontRef[] (sorted), textByFamily: { family: sorted unique characters } }.
  function usageOut(u) {
    const refs = [...u.refs.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((e) => e[1]);
    const textByFamily = {};
    for (const family of [...u.chars.keys()].sort()) textByFamily[family] = FACES.uniqueChars([...u.chars.get(family)].join(''));
    return { refs, textByFamily };
  }

  // What a built scene draws: every glyph's face and grapheme (lyrics, notes and artists, headings, ornament text — in
  // whatever face the part laid them out), and glyph particles ('glyph:<char>') in the display ja face the renderer uses.
  function sceneUsage(scene, particleFace) {
    const u = newUsage();
    for (const g of scene.stores.glyph) if (g.font && g.cls !== 'space') addRef(u, g.font, g.ch);
    for (const p of scene.stores.particles) {
      if (particleFace && typeof p.sprite === 'string' && p.sprite.startsWith('glyph:')) addRef(u, particleFace, p.sprite.slice(6));
    }
    return u;
  }

  // The usage a plan implies before its scenes are built: each cut's text in its text.face role and its note (the
  // artist of a title or credit card, a sung aside) in the body role. Built scenes replace this estimate with the truth.
  function estimateUsage(faces, cuts) {
    const items = [];
    for (const c of cuts) {
      items.push({ role: roleFace(c), lang: c.lang, text: c.text });
      if (c.note) items.push({ role: 'body', lang: c.lang, text: c.note });
    }
    const est = FACES.fontUsage(faces, items);
    const u = newUsage();
    for (const ref of est.refs) addRef(u, ref, '');
    for (const family of Object.keys(est.textByFamily)) addChars(u, family, est.textByFamily[family]);
    return u;
  }

  // createEngine({ registry, canvas, measurer, fonts, assets, now?, idle?, strict? }) → Engine (§4.20, FROZEN).
  // Additive options: `now` (ms clock for frame stats and the adaptive preview) and `idle` (() → Promise that settles
  // once the host has had time for other work; prepare() yields through it) — both come from the host canvas factory
  // when absent — and `strict` (tests: part errors throw instead of falling back). Additive members: setPlan(plan),
  // scene(kind, i), fontUsage(t0, t1), setLevel(n). `spriteBudget` (bytes; tests and the lab) replaces the preview's
  // §7.3 sprite budget.
  // DESIGN_2_1 additive members: registry (getter: the effective registry, parts/mix registryFor of the base registry
  // and the document's materials and media), shotTrack(cutKey), viewAt(t), mediaAt(t), mediaReady(t, opts),
  // fork({ assets }); thumb() also takes the kinds 'shot' and 'rig'. Internal options: `effective` (a fork's registry)
  // and `ownAssets` (the fork made its asset store and disposes it).
  function createEngine(opts) {
    const o = opts || {};
    const base = o.registry;
    if (!base || typeof base.get !== 'function') throw new EngineError('bad-args', 'createEngine needs { registry }');
    if (!o.canvas || typeof o.canvas.create !== 'function') throw new EngineError('bad-args', 'createEngine needs { canvas: CanvasFactory }');
    if (!o.measurer || typeof o.measurer.width !== 'function') throw new EngineError('bad-args', 'createEngine needs { measurer }');
    const factory = o.canvas, measurer = o.measurer, fonts = o.fonts || null, assets = o.assets || null;
    const now = typeof o.now === 'function' ? o.now : typeof factory.now === 'function' ? factory.now : null;
    const idle = typeof o.idle === 'function' ? o.idle : typeof factory.idle === 'function' ? factory.idle : null;
    const sceneMax = Number.isInteger(o.sceneMax) && o.sceneMax > 0 ? o.sceneMax : SCENE_MAX;
    // the effective registry: the base plus the document's materials (and pooled media); the base until a document
    let registry = o.effective && typeof o.effective.get === 'function' ? o.effective : base;
    const renderer = R.createRenderer({ canvas: factory, registry, assets, now, strict: !!o.strict, spriteBudget: o.spriteBudget });
    const cache = CACHE.createSceneCache({ max: sceneMax });
    const found = new Map();                         // cut / segment key → { fp, list } of scene warnings
    const scanned = new Set();                       // fps whose warnings are known
    const used = new Map(o.usage || []);             // fp → usage record of the built scene (a function of the fp)
    const requested = newUsage();                    // what the FontBook has been asked for so far
    let plan = null, lastDoc = null, lastResult = null;
    let texts = null;                                // TextService of the current faces
    let face = null;
    let estimate = null;                             // font usage the plan implies (cut texts and notes)
    let thumbs = null;
    let disposed = false;
    let prepSeq = 0;                                 // the newest preview prepare(); older ones stop at their next slice

    function alive() { if (disposed) throw new EngineError('disposed', 'the engine was disposed'); }

    // --- plan-bound services ---

    function textService() {
      const faces = plan ? plan.look.faces : null;
      if (!texts) texts = TS.createTextService({ measurer, faces });
      else if (texts.faces !== faces && H.hashJSON(texts.faces) !== H.hashJSON(faces)) texts = texts.withFaces(faces);
      return texts;
    }

    function waiting(ref) { const s = fonts.status(ref); return s === 'idle' || s === 'loading'; }

    // A scene is provisional when a face it draws is not in yet (§4.20 FrameStats.provisional).
    function provisionalFor(item, kind) {
      if (!fonts || typeof fonts.status !== 'function') return false;
      const known = used.get(item.fp);
      if (known) return [...known.refs.values()].some(waiting);
      return kind === 'cut' && [...estimateUsage(plan.look.faces, [item]).refs.values()].some(waiting);
    }

    // Asks the FontBook for whatever `u` adds to what was asked for already, or again for a face that failed (the
    // FontBook then retries it). The preview only asks; export waits in prepare().
    function request(u) {
      if (!fonts || typeof fonts.request !== 'function') return;
      const retry = typeof fonts.status === 'function' && [...u.refs.values()].some((r) => fonts.status(r) === 'failed');
      if (!retry && covers(requested, u)) return;
      mergeUsage(requested, u);
      const out = usageOut(u);
      fonts.request(out.refs, out.textByFamily);
    }

    // Scene warnings, font usage and the "already laid out" marks of cuts and segments the plan no longer has.
    function forgetStale() {
      if (!plan) { found.clear(); scanned.clear(); used.clear(); return; }
      const fps = new Set(), keys = new Set();
      for (const x of plan.cuts.concat(plan.grounds)) { fps.add(x.fp); keys.add(x.key); }
      for (const key of [...found.keys()]) if (!keys.has(key)) found.delete(key);
      for (const fp of [...scanned]) if (!fps.has(fp)) scanned.delete(fp);
      for (const fp of [...used.keys()]) if (!fps.has(fp)) used.delete(fp);
    }

    function build(item, kind) {
      const svc = { registry, text: textService(), assets, pal: plan.look.palette, faces: plan.look.faces, strict: !!o.strict,
        provisional: provisionalFor(item, kind), media: plan.media || null };
      const scene = kind === 'cut' ? BUILD.buildCut(item, plan, svc) : BUILD.buildGround(item, plan, svc);
      found.set(item.key, { fp: item.fp, list: scene.warnings || [] });
      scanned.add(item.fp);
      const u = sceneUsage(scene, face);
      used.set(item.fp, u);
      request(u);
      if (!scene.provisional && fonts && typeof fonts.status === 'function' && [...u.refs.values()].some(waiting)) {
        scene.provisional = true;                    // a face only the built scene revealed (a note, an ornament's text)
      }
      return scene;
    }

    // A cached provisional scene whose faces have all settled under the same measurer key failed to load (a face that
    // loads moves the key, so its scenes are rebuilt): the fallback layout it holds is final.
    function settle(scene, fp) {
      if (!scene.provisional || !fonts || typeof fonts.status !== 'function') return scene;
      const u = used.get(fp);
      if (!u) return scene;
      for (const ref of u.refs.values()) if (waiting(ref)) return scene;
      scene.provisional = false;
      return scene;
    }

    function sceneFor(kind, i) {
      const item = kind === 'cut' ? plan.cuts[i] : plan.grounds[i];
      if (!item) return null;
      const scene = cache.get(item.fp, measurer.key);
      return scene ? settle(scene, item.fp) : cache.put(build(item, kind));
    }

    // The media of each scene by fingerprint and measurer key (renderer.mediaEntries), so mediaAt reads them in O(1)
    // without keeping or rebuilding scenes: a scene is built (through the cache) only the first time. Bounded.
    const mediaMemo = new Map();
    function mediaOf(kind, i) {
      const item = kind === 'cut' ? plan.cuts[i] : plan.grounds[i];
      if (!item) return R.mediaEntries(null);
      const key = item.fp + '|' + measurer.key;
      let list = mediaMemo.get(key);
      if (!list) {
        const scene = sceneFor(kind, i);
        list = R.mediaEntries(scene);
        if (scene && scene.provisional) return list;           // rebuilt once the faces arrive: not remembered yet
        if (mediaMemo.size >= MEDIA_MEMO) mediaMemo.clear();
        mediaMemo.set(key, list);
      }
      return list;
    }

    const source = {
      cut: (i) => sceneFor('cut', i),
      ground: (i) => sceneFor('ground', i),
      media: mediaOf,
      fresh: (kind, i) => build(kind === 'cut' ? plan.cuts[i] : plan.grounds[i], kind),
      get fontKey() { return measurer.key; },
      get face() { return face; },
    };

    function adopt(next) {
      plan = next;
      renderer.clearErrors();
      forgetStale();
      face = plan ? FACES.fontFor(plan.look.faces, 'display', 'ja') : null;
      estimate = plan ? estimateUsage(plan.look.faces, plan.cuts) : null;
      if (estimate) request(estimate);
    }

    // --- FROZEN API ---

    // The effective registry of a document (DESIGN_2_1 §3.10, §5.9.2): parts/mix derives the materials and the pooled
    // media over the base registry (memoized there by identity; the base itself when there are none). The renderer
    // looks filters and seams up in it, and thumbnails draw with it.
    function adoptRegistry(doc) {
      const next = MIX.registryFor(base, doc && doc.materials, doc && doc.media) || base;
      if (next === registry) return;
      registry = next;
      renderer.setRegistry(next);
      if (thumbs) { thumbs.renderer.setRegistry(next); thumbs.plans.clear(); }
    }

    function setDoc(doc) {
      alive();
      if (doc === lastDoc && lastResult) return lastResult;
      adoptRegistry(doc);
      const next = PL.plan(doc, { registry });
      lastResult = { plan: next, changedCuts: changedKeys(plan && plan.cuts, next.cuts),
        changedGrounds: changedKeys(plan && plan.grounds, next.grounds) };
      lastDoc = doc;
      adopt(next);
      return lastResult;
    }

    // setPlan(plan) (additive): render a plan made elsewhere (sample plans, fixtures, forks).
    function setPlan(next) {
      alive();
      lastDoc = null; lastResult = null;
      adopt(next || null);
      return plan;
    }

    function itemsIn(t0, t1) {
      const cuts = [], grounds = [];
      plan.cuts.forEach((c, i) => { if (c.a <= t1 && c.b >= t0) cuts.push(i); });
      plan.grounds.forEach((g, i) => { if (g.t0 <= t1 && g.t1 >= t0) grounds.push(i); });
      return { cuts, grounds };
    }

    // The usage of some cuts and segments: the plan's estimate plus what their built scenes really draw.
    function usageOfItems(cuts, grounds) {
      const u = estimateUsage(plan.look.faces, cuts.map((i) => plan.cuts[i]));
      for (const i of cuts) { const k = used.get(plan.cuts[i].fp); if (k) mergeUsage(u, k); }
      for (const i of grounds) { const k = used.get(plan.grounds[i].fp); if (k) mergeUsage(u, k); }
      return u;
    }

    // fontUsage(t0, t1) (additive) → { refs, textByFamily } of what [t0, t1] draws: every scene built so far counts
    // with its own glyphs (any face its parts chose); cuts not built yet count with their text and note. Builds nothing
    // (prepare({ export: true }) builds the range and waits for the complete usage).
    function fontUsage(t0, t1) {
      if (!plan) return { refs: [], textByFamily: {} };
      const { cuts, grounds } = itemsIn(t0, t1);
      return usageOut(usageOfItems(cuts, grounds));
    }

    // Time slices for prepare(): due() after each unit of work says whether to yield; pause() yields to the host and
    // says whether to go on (the same plan, not disposed, and — for the preview — no newer prepare() started).
    function slicer(sliceMs, seq) {
      const current = plan;
      let start = now ? now() : 0, units = 0;
      return {
        due() {
          if (!idle) return false;
          units++;
          return now ? now() - start >= sliceMs : units >= SLICE_BUILDS;
        },
        async pause() {
          await idle();
          start = now ? now() : 0; units = 0;
          return !disposed && plan === current && (seq === 0 || seq === prepSeq);
        },
        live() { return !disposed && plan === current && (seq === 0 || seq === prepSeq); },
      };
    }

    // Export (§4.14, §7.1.5): learns what the range draws from its scenes (each fingerprint is built once for that: a
    // scene's faces and characters depend only on it), waits for those faces and characters, then builds the range
    // with the faces in (a font that arrived moved the measurer key, so the scenes built before it are rebuilt).
    async function prepareExport(lo, hi) {
      const { cuts, grounds } = itemsIn(lo, hi);
      const list = cuts.map((i) => ['cut', i]).concat(grounds.map((i) => ['ground', i]));
      const slice = slicer(EXPORT_SLICE_MS, 0);
      const buildEach = async (items) => {
        for (const [kind, i] of items) {
          sceneFor(kind, i);
          if (slice.due() && !(await slice.pause())) return false;
        }
        return slice.live();
      };
      if (fonts && typeof fonts.ready === 'function') {
        const unknown = list.filter(([kind, i]) => !used.has((kind === 'cut' ? plan.cuts[i] : plan.grounds[i]).fp));
        if (!(await buildEach(unknown))) return;
        const out = usageOut(usageOfItems(cuts, grounds));
        await fonts.ready(out.refs, out.textByFamily);
        if (!slice.live()) return;
      }
      await buildEach(list);
    }

    // Preview: requests the faces, prefetches the window's scenes, makes the glyph sprites of the frames just after the
    // playhead and lays out a few unseen cuts for their warnings, in time slices so playback and typing are not held up.
    async function preparePreview(lo, hi) {
      const seq = ++prepSeq;
      const slice = slicer(SLICE_MS, seq);
      const { cuts, grounds } = itemsIn(lo, hi);
      request(usageOfItems(cuts, grounds));
      let deferred = false;
      const budgeted = (item, kind) => {
        if (deferred) return null;
        const scene = build(item, kind);
        if (slice.due()) deferred = true;
        return scene;
      };
      for (;;) {
        deferred = false;
        cache.get(null, measurer.key);               // prefetch checks presence under the latest get()'s measurer key
        cache.prefetch(plan, lo, hi, budgeted);
        if (!deferred) break;
        if (!(await slice.pause())) return;
      }
      if (!(await warmAhead(lo, hi, slice))) return;
      let extra = 0;
      for (const c of plan.cuts) {
        if (extra >= SCAN_PER_PREPARE) break;
        if (scanned.has(c.fp)) continue;
        build(c, 'cut');
        extra++;
        if (slice.due() && !(await slice.pause())) return;
      }
    }

    // The glyph sprites of the frames from the playhead (the latest frame's time) to WARM_AHEAD seconds after it, at
    // WARM_FPS, so the frames that follow draw without rasterizing (§7.4; the keys include pose scale, camera zoom, every
    // blur level, the echo, tint and halo inks: renderer.warmAt walks the frame as it will be drawn). It stops early once
    // the sprites these frames use (found or made) reach WARM_SHARE of the sprite budget. Frames that playback has shown
    // while this waited for a slice are skipped. → false when a newer prepare took over.
    async function warmAhead(lo, hi, slice) {
      const from = renderer.lastTime();
      if (from === null || from < lo || from > hi) return true;
      renderer.beginWarm();
      let j = 0;
      for (;;) {
        const t = from + j / WARM_FPS;
        const ws = renderer.warmBytes();
        if (t > Math.min(hi, from + WARM_AHEAD) + 1e-9 || ws.used > WARM_SHARE * ws.budget) return true;
        renderer.warmAt(plan, source, t);
        j++;
        if (slice.due()) {
          if (!(await slice.pause())) return false;
          const shown = renderer.lastTime();
          if (shown !== null && shown > from) j = Math.max(j, Math.ceil((shown - from) * WARM_FPS - 1e-9));
        }
      }
    }

    // prepare(t0, t1, { export }) → Promise: see prepareExport / preparePreview. With an `idle` hook the work runs in
    // slices; without one (Node, the recorder) it runs at once.
    async function prepare(t0, t1, prepOpts) {
      alive();
      if (!plan) return;
      const lo = Number.isFinite(t0) ? t0 : 0, hi = Number.isFinite(t1) ? t1 : plan.duration;
      if (prepOpts && prepOpts.export) await prepareExport(lo, hi);
      else await preparePreview(lo, hi);
    }

    // renderFrame(surface, t, opts) → FrameStats (§4.19.2). Additive options (DESIGN_2_1 §11.3.7): layers 'all' |
    // 'ground'. FrameStats gains media { drawn, waiting }. In export quality a media frame that is not exact (or not on
    // this device) is a programming error: exporters await mediaReady(t) first, so this throws EngineError
    // ('media-not-ready' | 'media-missing') instead of letting a substitute frame be encoded.
    function renderFrame(surface, t, ropts) {
      alive();
      if (!plan) {
        return { ms: 0, drawn: { glyphs: 0, shapes: 0, paints: 0, particles: 0 }, passes: 0, provisional: false,
          media: { drawn: 0, waiting: 0 } };
      }
      const exporting = !!ropts && ropts.quality === 'export';
      if (exporting) {
        // an export at 1440p and above shares the machine with the preview: half the sprite budget (§4.19.5)
        const short = Math.min(surface.w || surface.canvas.width, surface.h || surface.canvas.height);
        renderer.setSpriteBudget(short >= 1440 ? SP.BUDGET_SHARED : SP.BUDGET);
      }
      const stats = renderer.render(surface, plan, t, ropts, source);
      if (stats.mediaError) {
        const err = stats.mediaError;
        delete stats.mediaError;
        if (exporting) {
          throw new EngineError(err.code, (err.code === 'media-missing' ? 'media not on this device: ' : 'media frame not ready: ')
            + err.id + ' at t = ' + t);
        }
      }
      return stats;
    }

    // --- media (DESIGN_2_1 §11.3.7) ---

    // mediaAt(t, { scale }?) → [{ id, m, px?, blur? }]: the media the frame at t draws, with their media times (seconds),
    // sorted by id, m, px, blur and deduplicated. No behaviour runs; without plan media it is empty at once. Stills also
    // carry the px (long side, device px) and blur their draw asks the store for at the output scale (`scale`, else the
    // last frame's), so assets.ready() decodes exactly that tier; none before a first frame without a scale.
    const mediaScratch = [];
    const byMedia = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : a.m - b.m || (a.px || 0) - (b.px || 0) || (a.blur || 0) - (b.blur || 0));
    function mediaAt(t, mopts) {
      alive();
      if (!plan || !plan.media || Object.keys(plan.media).length === 0) return [];
      const scale = mopts && mopts.scale > 0 ? mopts.scale : renderer.lastScale();
      renderer.mediaAt(plan, source, t, mediaScratch, scale);
      mediaScratch.sort(byMedia);
      const out = [];
      for (const e of mediaScratch) {
        const prev = out[out.length - 1];
        if (prev && prev.id === e.id && prev.m === e.m && prev.px === e.px && prev.blur === e.blur) continue;
        out.push(e.px === undefined ? { id: e.id, m: e.m } : { id: e.id, m: e.m, px: e.px, blur: e.blur });
      }
      return out;
    }

    // mediaReady(t, { signal, ahead = 3 / fps, fps, scale }) → Promise: resolves when the store holds every exact frame
    // the frame at t draws at that output scale (assets.ready of mediaAt), and asks it to start on the frames `ahead`
    // seconds later (assets.want). Resolved at once without a store or media.
    function mediaReady(t, ropts) {
      alive();
      const q = ropts || {};
      if (!assets || !plan) return Promise.resolve();
      const fps = Number.isFinite(q.fps) && q.fps > 0 ? q.fps : lastDoc && lastDoc.output ? lastDoc.output.fps : 30;
      const ahead = Number.isFinite(q.ahead) ? q.ahead : 3 / fps;
      const at = { scale: q.scale };
      const list = mediaAt(t, at);
      if (typeof assets.want === 'function') {
        const next = mediaAt(t + ahead, at);
        if (next.length) assets.want(next);
      }
      if (list.length === 0 || typeof assets.ready !== 'function') return Promise.resolve();
      return assets.ready(list, { signal: q.signal });
    }

    // --- shots (DESIGN_2_1 §3.10) ---

    function cutIndexOf(key) {
      if (!plan) return -1;
      for (let i = 0; i < plan.cuts.length; i++) if (plan.cuts[i].key === key) return i;
      return -1;
    }

    // shotTrack(cutKey) → { a, b, keys: [{ t, x, y, zoom, roll, aim: Box | null }] } | null: the cut's resolved shot from
    // its built scene (times absolute; x, y the camera offset in du; roll in radians; aim the aimed rest box), for the
    // stage overlay and the timeline. null without a shot.
    function shotTrack(cutKey) {
      alive();
      const i = cutIndexOf(cutKey);
      if (i < 0) return null;
      const scene = sceneFor('cut', i);
      const tr = scene && scene.shot;
      if (!tr) return null;
      const t0 = plan.cuts[i].t0;
      return { a: t0 + tr.a, b: t0 + tr.b,
        keys: tr.keys.map((k) => ({ t: t0 + k.t, x: k.X, y: k.Y, zoom: k.Z, roll: k.R, aim: k.box })) };
    }

    // viewAt(t) → { x, y, zoom, roll }: the text layer's camera at t — the current cut's camera composed with the rig
    // (and the impulses, as drawn; x/y include the shake) — or the rig alone while no cut is on screen. The stage inverts
    // drags with it.
    function viewAt(t) {
      alive();
      if (!plan) return { x: 0, y: 0, zoom: 1, roll: 0 };
      const fg = F.frameAt(plan, t);
      const i = F.currentCut(plan, t, fg);
      let cam;
      if (i >= 0) {
        const scene = sceneFor('cut', i);
        F.evaluate(scene, t - plan.cuts[i].t0);
        cam = F.cameraAt(scene, plan, t);
      } else cam = F.rigCamera(plan, t);
      return { x: cam.x + cam.shakeX, y: cam.y + cam.shakeY, zoom: cam.zoom, roll: cam.roll };
    }

    // Every face the plan uses: the estimate plus the faces its built scenes draw.
    function planRefs() {
      const u = mergeUsage(newUsage(), estimate);
      for (const x of plan.cuts.concat(plan.grounds)) { const k = used.get(x.fp); if (k) mergeUsage(u, k); }
      return [...u.refs.values()];
    }

    function warnings() {
      const out = plan ? plan.warnings.slice() : [];
      if (plan) {
        const keys = new Map();
        for (const c of plan.cuts) keys.set(c.key, c.fp);
        for (const g of plan.grounds) keys.set(g.key, g.fp);
        for (const [key, rec] of found) if (keys.get(key) === rec.fp) out.push(...rec.list);
        const failed = fonts && typeof fonts.status === 'function' ? planRefs().filter((r) => fonts.status(r) === 'failed') : [];
        const families = [...new Set(failed.map((r) => r.family))].sort();
        for (const family of families) out.push({ code: 'font-fallback', detail: { family } });
      }
      const seen = new Set();
      for (const e of renderer.errors()) if (!seen.has(e.detail)) { seen.add(e.detail); out.push(e); }
      return out;
    }

    // thumb(ref, surface, { t, text, textB, theme, aspect }) — a canned sample cut (§4.20), rendered by a renderer of its
    // own so the preview's picks and stats stay untouched. Deterministic in its inputs. textB (additive) is a transition's
    // second line (the UI passes both in the page's language).
    function thumb(ref, surface, topts) {
      alive();
      const to = topts || {};
      if (!thumbs) thumbs = { renderer: R.createRenderer({ canvas: factory, registry, assets, now: null }), plans: new Map() };
      const theme = to.theme || (plan ? plan.look.theme.v : null);
      const aspect = to.aspect || (plan ? plan.design.aspect : '16:9');
      const id = H.hashJSON({ kind: ref.kind, key: ref.key, params: ref.params || null, text: to.text || null,
        textB: ref.kind === 'seam' ? to.textB || null : null, theme, aspect });
      let entry = thumbs.plans.get(id);
      if (entry) thumbs.plans.delete(id);
      if (entry && entry.fontKey !== measurer.key) entry = null;       // faces arrived since: lay the text out again
      if (!entry) {
        const sp = samplePlan(registry, ref, { text: to.text, textB: to.textB, theme, aspect });
        const svc = { registry, text: textService().withFaces(sp.look.faces), assets, pal: sp.look.palette, faces: sp.look.faces,
          strict: !!o.strict, provisional: false, media: sp.media || null };
        const scenes = { cut: [], ground: [] };
        entry = {
          plan: sp, fontKey: measurer.key,
          source: {
            cut: (i) => scenes.cut[i] || (scenes.cut[i] = BUILD.buildCut(sp.cuts[i], sp, svc)),
            ground: (i) => scenes.ground[i] || (scenes.ground[i] = BUILD.buildGround(sp.grounds[i], sp, svc)),
            fresh: (kind, i) => (kind === 'cut' ? BUILD.buildCut(sp.cuts[i], sp, svc) : BUILD.buildGround(sp.grounds[i], sp, svc)),
            fontKey: measurer.key,
            face: FACES.fontFor(sp.look.faces, 'display', 'ja'),
          },
        };
        while (thumbs.plans.size >= THUMB_PLANS) thumbs.plans.delete(thumbs.plans.keys().next().value);
      }
      thumbs.plans.set(id, entry);
      const t = Number.isFinite(to.t) ? to.t : sampleTime(entry.plan, ref.kind);
      const sw = surface.w || surface.canvas.width, sh = surface.h || surface.canvas.height;
      const d = entry.plan.design;
      // thumbnails ask the asset store for posters only (DESIGN_2_1 §11.3.7), so a tile never waits on a decoder
      const stats = thumbs.renderer.render(surface, entry.plan, t, { quality: 'export', pick: false,
        scale: Math.min(sw / d.w, sh / d.h), thumb: true }, entry.source);
      delete stats.mediaError;
      return stats;
    }

    // fork({ assets } = {}) → a frozen snapshot for export: the same plan and effective registry (materials included),
    // caches of its own. Its asset store is `assets` when given, else the store's own fork (assets.fork()) — disposed with
    // the forked engine — else the same store.
    function fork(fopts) {
      alive();
      const given = fopts && fopts.assets ? fopts.assets : null;
      const store = given || (assets && typeof assets.fork === 'function' ? assets.fork() : assets);
      const e = createEngine({ registry: base, effective: registry, canvas: factory, measurer, fonts, assets: store, now, idle,
        strict: o.strict, sceneMax, usage: used, spriteBudget: o.spriteBudget, ownAssets: !given && store !== assets });
      if (plan) e.setPlan(plan);
      e.adoptDoc(lastDoc, lastResult);
      return e;
    }

    function stats() {
      const s = renderer.stats();
      return { frameMs: s.frameMs, stageMs: s.stageMs, spriteBytes: s.spriteBytes, surfaces: s.surfaces, scenes: cache.size,
        passes: s.passes, level: s.level, surfaceBytes: s.surfaceBytes, spritesMade: s.spritesMade };
    }

    function dispose() {
      if (disposed) return;
      renderer.dispose();
      if (thumbs) thumbs.renderer.dispose();
      if (o.ownAssets && assets && typeof assets.dispose === 'function') assets.dispose();
      cache.clear();
      found.clear();
      scanned.clear();
      used.clear();
      plan = null; lastDoc = null; lastResult = null; texts = null; thumbs = null; estimate = null;
      disposed = true;
    }

    return {
      setDoc, get plan() { return plan; }, prepare, renderFrame,
      hitTest: (x, y) => renderer.hitTest(x, y),
      boxes: () => renderer.boxes(),
      thumb, warnings, fork, stats, dispose,
      get registry() { return registry; },
      shotTrack, viewAt, mediaAt, mediaReady,
      setPlan, fontUsage,
      scene: (kind, i) => (plan ? sceneFor(kind, i) : null),
      setLevel: (v) => renderer.setLevel(v),
      // fork(): the copy keeps the source document, so setDoc(sameDoc) on it is a no-op (export calls it when it has none)
      adoptDoc(doc, result) { if (doc && result && result.plan === plan) { lastDoc = doc; lastResult = result; } },
    };
  }

  return { createEngine, samplePlan, sampleTime, EngineError, SAMPLE, SAMPLE_TEXT };
});
