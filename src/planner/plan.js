/* 文字PVメーカー v2 — original work. plan(doc, { registry }) → Plan: the planner's stages in their FROZEN order (DESIGN §4.16.1–§4.16.2, §3.12; DESIGN_2_1 §2.7, §5.9.3, §11.2.6). */
MV.def('planner/plan', ['core/hash', 'core/num', 'core/pins', 'core/lyrics', 'core/timing', 'core/beats', 'core/motion',
  'core/doc', 'core/schema', 'core/script', 'core/media', 'core/shot', 'planner/choose', 'planner/params', 'planner/look',
  'planner/segment', 'planner/features', 'planner/cast', 'planner/tracks', 'planner/camera', 'planner/encode'],
(H, N, PINS, LY, TM, B, MO, D, S, SC, MEDIA, SHOT, CH, PA, LK, SG, FE, CA, TR, CAM, EN) => {
  'use strict';

  // v2: rigs, cut.rig, grounds[].zoomed, feat.sectionStart, media, the camera slots (DESIGN_2_1 §2.7, §11.2.6).
  const PLAN_VERSION = 2;
  const MEMO_SIZE = 2;
  const LANG_SPEC = SG.LINE_SPECS.lang;

  // --- warnings (deduplicated: a work pin applies to many cuts but is reported once) ---------------------------

  // In sorted order: plan objects are built with sorted keys where it is cheap, so planner/encode prints them natively.
  const WARNING_FIELDS = Object.freeze(['cut', 'detail', 'line', 'path']);

  function createWarner() {
    const list = [];
    const seen = new Set();
    function warn(w) {
      const id = [w.code, w.path || '', w.line || '', w.cut || '', w.detail ? H.canonical(w.detail) : ''].join('|');
      if (seen.has(id)) return;
      seen.add(id);
      const out = { code: w.code };
      for (const k of WARNING_FIELDS) if (w[k] !== undefined && w[k] !== null) out[k] = w[k];
      list.push(out);
    }
    return { warn, list };
  }

  // --- stage 1: lines and times ---------------------------------------------------------------------------------

  // A work-scope timing slot (§3.4.1) coerced through its spec; `extra(v)` admits values the spec cannot hold
  // (a null BPM pin means "no tempo").
  function workPin(ctx, slot, spec, extra) {
    return PA.resolvePin(ctx.ix, LK.WORK_AT, slot, (v) => {
      if (extra && extra(v)) return { v };
      const c = S.coerce(spec, v);
      return c === undefined ? { bad: true } : { v: c };
    }, ctx.warn);
  }

  function withLangPins(ctx, lines) {
    return lines.map((line) => {
      const pin = PA.resolvePin(ctx.ix, { pinCutKey: null, lineId: line.id, cutKey: null }, 'lang',
        (v, rank) => (rank !== 'pin:line' ? { na: true } : LANG_SPEC.of.includes(v) ? { v } : { bad: true }), ctx.warn);
      return pin ? Object.assign({}, line, { lang: pin.v }) : line;
    });
  }

  // Lines with times (core/timing.solveTimes, §4.11) and the tempo facts. The solver's context: the tempo (`bpm`
  // slot: pin, null = none, else the song's analysis), the beat grid for snapping (`beatOffset` slot and the song's
  // meter), `readRate`, `length`, and the title card's time (titleCardTime).
  function timeLines(ctx, lines, meta) {
    const { doc } = ctx;
    const song = doc.song || null;
    const bpmPin = workPin(ctx, 'bpm', LK.LOOK_SPECS.bpm, (v) => v === null);
    const bpm = bpmPin ? bpmPin.v : song && typeof song.bpm === 'number' && song.bpm > 0 ? song.bpm : null;
    const offPin = workPin(ctx, 'beatOffset', LK.LOOK_SPECS.beatOffset);
    const offset = offPin ? offPin.v : song && typeof song.offset === 'number' ? song.offset : 0;
    const meter = song && Number.isInteger(song.meter) && song.meter > 0 ? song.meter : 4;
    const ratePin = workPin(ctx, 'readRate', LK.LOOK_SPECS.readRate);
    const lengthPin = workPin(ctx, 'length', LK.LOOK_SPECS.length);
    const grid = bpm ? B.grid({ bpm, offset, meter }) : null;
    const solve = (titleCard) => TM.solveTimes(lines, {
      pins: ctx.ix, timing: ctx.timing, songSeconds: song && song.seconds > 0 ? song.seconds : null, bpm,
      readRate: ratePin ? ratePin.v : null, lengthPin: lengthPin ? lengthPin.v : null,
      titleCard, beatOffset: offset, meter, grid,
    });
    const solved = titleCardTime(ctx, meta, solve);
    for (const w of solved.warnings) ctx.warn(w);
    const timed = lines.map((line, i) => {
      const t = solved.times[i];
      return Object.assign({}, line, { t0: t.t0, t1: t.t1, by: t.by });
    });
    return { timed, duration: solved.duration, bpm, grid, beats: bpm ? { bpm, offset, meter } : null };
  }

  // The time kept free for the title card before the first automatic line (§4.11 ctx.titleCard; SPEC §6: a title
  // card when a title is set). There is a card only with a title ([ti:]); the `titleCard` slot pinned true keeps
  // TITLE_TIME, pinned false none. Not pinned (a pin that is not a boolean counts as none), the card keeps TITLE_TIME
  // too when every line is timed automatically, so the paste → おまかせ → export path shows it; when a line has a
  // start anchor (a pin or an LRC stamp), no line is moved or squeezed for an automatic card: the cutter fits it into
  // [0, first line) when that leaves ≥ 1.5 s (planner/segment titleCut). solve(titleCard) → core/timing solveTimes.
  const TITLE_TIME = 2;
  function titleCardTime(ctx, meta, solve) {
    if (!meta.title) return solve(0);
    const pin = PINS.lookup(ctx.ix, LK.WORK_AT, 'titleCard');
    const pinned = pin && typeof pin.v === 'boolean' ? pin.v : null;
    if (pinned !== null) return solve(pinned ? TITLE_TIME : 0);
    const solved = solve(TITLE_TIME);
    return solved.times.every((t) => t.by.start === 'auto') ? solved : solve(0);
  }

  // The parsed sheet and its lines, made once per rows array and lyric language (an edit that does not touch the
  // lyrics keeps doc.sheet.rows). Nothing downstream changes them.
  const parsedCache = new WeakMap();
  function parsedSheet(doc) {
    const rows = doc.sheet.rows;
    const lang = (doc.meta && doc.meta.lang) || 'auto';
    const hit = parsedCache.get(rows);
    if (hit && hit.lang === lang && sameRows(hit.rows, rows)) return hit;
    const sheet = LY.parseSheet(rows);
    const out = { lang, sheet, lines: LY.linesOf(sheet, { lang }), rows: rows.map((r) => [r.id, r.src]) };
    parsedCache.set(rows, out);
    return out;
  }

  // Rows compared by content, in case an array was edited in place (documents are immutable in the app, not in tests).
  function sameRows(seen, rows) {
    if (seen.length !== rows.length) return false;
    for (let i = 0; i < rows.length; i++) if (seen[i][0] !== rows[i].id || seen[i][1] !== rows[i].src) return false;
    return true;
  }

  // --- stage 4: features context --------------------------------------------------------------------------------

  // Repeats and echoes: a later line with the same text echoes the earliest one, cut by cut (same piece offset,
  // else that line's first cut). Sections: song.info, else the last section heading above (carried forward).
  function featureContexts(timed, cuts) {
    const count = new Map();
    for (const line of timed) count.set(line.text, (count.get(line.text) || 0) + 1);
    const lineById = new Map(timed.map((l) => [l.id, l]));
    const firstOf = new Map();
    const cutsOf = new Map();
    for (const c of cuts) {
      if (!c.line) continue;
      if (cutsOf.has(c.line)) cutsOf.get(c.line).push(c); else cutsOf.set(c.line, [c]);
    }
    const sectionOf = new Map();
    let section = null;
    for (const line of timed) {
      const s = FE.sectionOfHeading(line.heading);
      if (s) section = s;
      sectionOf.set(line.id, section);
      if (!firstOf.has(line.text)) firstOf.set(line.text, line.id);
    }
    return (cut) => {
      if (!cut.line) return { repeats: false, repeatOf: null, section: null };
      const line = lineById.get(cut.line);
      const origin = firstOf.get(line.text);
      let repeatOf = null;
      if (origin && origin !== cut.line) {
        const theirs = cutsOf.get(origin) || [];
        const same = theirs.find((c) => c.off[0] === cut.off[0]);
        repeatOf = (same || theirs[0] || {}).key || null;
      }
      return { repeats: count.get(line.text) > 1, repeatOf, section: sectionOf.get(cut.line) };
    };
  }

  // --- stage 7: derived values ----------------------------------------------------------------------------------

  function instantOf(ctx, kind, d) {
    return !d || d.v === fallbackOf(ctx, kind) ? null : { dur: d.p ? d.p.dur : 0, each: d.p ? d.p.each : 0 };
  }

  // registry.fallback, once per plan and kind (it walks the kind's keys).
  function fallbackOf(ctx, kind) {
    const m = ctx.fallbacks || (ctx.fallbacks = new Map());
    let key = m.get(kind);
    if (key === undefined) { key = ctx.registry.fallback(kind); m.set(kind, key); }
    return key;
  }

  function unitCount(ctx, cut) {
    const d = cut.slots.arrive;
    const def = d ? ctx.registry.get('arrive', d.v) : null;
    const unit = def && def.unit ? def.unit : 'glyph';
    const u = cut.feat.units;
    return unit === 'word' ? u.word : unit === 'line' || unit === 'run' ? u.line : u.glyph;
  }

  function needsOf(ctx, decisions) {
    const needs = new Set();
    for (const [kind, d] of decisions) {
      if (!d || typeof d.v !== 'string' || d.v === 'none') continue;
      const def = ctx.registry.get(kind, d.v);
      if (def && def.needs) for (const n of def.needs) needs.add(n);
    }
    return needs;
  }

  // 'ornament#1' → 'ornament', 'arrive' → 'arrive' (slot names are few, so the answers are kept).
  const kindOfSlot = new Map();
  function slotKind(slot) {
    let k = kindOfSlot.get(slot);
    if (k === undefined) { k = slot.split(/[#.]/)[0]; kindOfSlot.set(slot, k); }
    return k;
  }

  // The part of the look every scene depends on (§3.12 fp: palette, faces, design size), plus the amounts parts read.
  // The registry term is the base registry's version (DESIGN_2_1 §2.7): adding or editing a material changes only the
  // fingerprints of the scenes that use it (matTerms), not every scene.
  function sharedText(ctx, look, design) {
    return EN.canon([ctx.registry.baseVersion || ctx.registry.version, look.palette, look.faces, look.amounts, design]);
  }

  // --- materials and media in fingerprints (DESIGN_2_1 §5.9.3, §11.2.6) --------------------------------------------

  // What the fingerprints need to know of a registry: the keys (any kind) of definitions that are materials or derived
  // media parts (registry.extra) or have a media param, and each one's media param names. Made once per registry;
  // `none` when there is nothing, so plans without materials or media skip the scan.
  const mineCache = new WeakMap();
  function mineInfo(registry) {
    let info = mineCache.get(registry);
    if (info) return info;
    const extra = registry.extra || {};
    const keys = new Map();
    for (const def of registry.all()) {
      if (!def || !def.key || def.kind === 'theme' || def.kind === 'mood') continue;
      const list = registry.params(def.kind, def.key) || [];
      const media = list.filter((x) => x.spec && x.spec.type === 'media').map((x) => x.name);
      const mine = extra[def.key] && def.mine ? def.mine : null;
      if (media.length || mine) keys.set(def.kind + '/' + def.key, { media, mine });
    }
    info = keys.size ? { keys } : NO_MINE;
    mineCache.set(registry, info);
    return info;
  }
  const NO_MINE = Object.freeze({ keys: null });

  // The materials and assets a list of [kind, decision] uses: { mat: [[slot, key, rhash]], ids: [AssetId] } (ids
  // sorted and unique; only ids the document's library holds). slots: the slot name of each decision.
  function mineOf(ctx, decisions, slots) {
    const info = mineInfo(ctx.registry);
    if (!info.keys) return null;
    let mat = null, ids = null;
    for (let i = 0; i < decisions.length; i++) {
      const [kind, d] = decisions[i];
      if (!d || typeof d.v !== 'string' || d.v === 'none') continue;
      const e = info.keys.get(kind + '/' + d.v);
      if (!e) continue;
      if (e.mine) {
        (mat || (mat = [])).push([slots[i], d.v, String(e.mine.rhash)]);
        // mine.media: the asset ids of a material; true for a derived ground of a pooled asset, whose id is mine.id.
        if (Array.isArray(e.mine.media)) for (const id of e.mine.media) ids = addId(ctx, ids, id);
        else if (e.mine.media === true) ids = addId(ctx, ids, e.mine.id);
      }
      for (const name of e.media) if (d.p && typeof d.p[name] === 'string' && d.p[name] !== '') ids = addId(ctx, ids, d.p[name]);
    }
    if (!mat && !ids) return null;
    return { mat: mat || [], ids: ids ? [...ids].sort() : [] };
  }

  // An asset id the library holds; a material's own asset that is gone warns media-missing (a media param was already
  // checked, planner/params).
  function addId(ctx, ids, id) {
    if (ctx.media && ctx.media.entries.has(id)) return (ids || new Set()).add(id);
    if (typeof id === 'string' && id !== '') ctx.warn({ code: 'media-missing', detail: { id } });
    return ids;
  }

  // The fingerprint term of a scene's materials and assets: '' without any, else the canonical text of
  // [matTerms, mediaTerms], mediaTerms = [[id, hashJSON(MediaMeta)]].
  function mineText(ctx, used) {
    if (!used) return '';
    return EN.canon([used.mat, used.ids.map((id) => [id, ctx.media.metaHash(id)])]);
  }

  // What a scene reads of the song besides its decisions (§3.12 fp; engine/scene/build baseEnv gives the parts
  // env.grid = the beat grid seen from the scene's origin, and env.level = the loudness from the origin on):
  // - a chosen part needs 'beats', or the cut's shot has a key anchored on a beat ('beat:<n>', engine/scene/shot), and
  //   there is a tempo → [bpm, meter, origin − beat offset]. The whole grid, not only the beat phase: parts count beat
  //   indices (every n-th beat) and behaviours read the bar;
  // - a chosen part needs 'level' and the plan has an envelope → [origin, digest id] (without one the level is flat).
  // Either is null otherwise, so a scene that reads neither keeps its fingerprint when it moves in time.
  function songTerms(ctx, needs, beats, origin) {
    const beat = needs.has('beats') && beats ? [beats.bpm, beats.meter, N.q6(origin - beats.offset)] : null;
    const level = needs.has('level') && ctx.env ? [N.q6(origin), ctx.digestId] : null;
    return { beat, level };
  }

  // A plan cut, its fingerprint and its canonical text as parts (planner/encode encodeCut). The fingerprint hashes the
  // scene inputs (text, emph, impact, note, role, lang, feat, slots, els, the window relative to t0 and the shared
  // look; the beat grid or loudness seen from t0, the scene's origin, only when a chosen part needs them, songTerms);
  // the plan hash streams the parts. A cut made of the same objects and numbers as in an earlier plan reuses that
  // plan's fingerprint and parts; one that only moved in time (the same scene at other absolute times, as every
  // automatic line after an edited one) reuses the fingerprint and the printed decisions (planner/encode retimeCut).
  function planCut(ctx, c, shared, beats) {
    const repT = N.q6(MO.heroTime({ a: c.a, b: c.b }, instantOf(ctx, 'arrive', c.slots.arrive),
      instantOf(ctx, 'depart', c.slots.depart), unitCount(ctx, c)));
    const out = {
      key: c.key, line: c.line, role: c.role, text: c.text, emph: c.emph, impact: c.impact, note: c.note,
      t0: c.t0, t1: c.t1, a: c.a, b: c.b, repT, lang: c.lang, feat: c.feat, fp: '', slots: c.slots,
      els: c.els, ground: c.ground, rig: c.rig, seamIn: c.seamIn,
    };
    if (c.pinKey && c.pinKey !== c.key) out.pinKey = c.pinKey;
    const slotKeys = Object.keys(c.slots).sort();
    const partSlots = slotKeys.filter((s) => s.indexOf('.') < 0 && s !== 'orient');
    const decisions = partSlots.map((s) => [slotKind(s), c.slots[s]]);
    const needs = needsOf(ctx, decisions);
    // a custom shot with a beat anchor reads the grid too (no preset has one, so only a custom shot is looked at)
    const shot = c.slots['cam.shot'];
    if (shot && shot.v !== null && typeof shot.v === 'object' && SHOT.usesBeats(shot.v)) needs.add('beats');
    const { beat, level } = songTerms(ctx, needs, beats, c.t0);
    // Materials (matTerms) and assets (mediaTerms) the cut's parts use (DESIGN_2_1 §2.7, §11.2.6); '' without any.
    const used = mineOf(ctx, decisions, partSlots);
    if (used) for (const id of used.ids) ctx.mediaUsed.add(id);
    const mine = mineText(ctx, used);
    // A cut whose cast was not reused is made of new objects: nothing to look up (its encoding is kept next time).
    const key = ctx.encodings && c.castHit ? encodingKey(out, c.cast, shared, beat, level, mine) : null;
    const hit = key !== null ? ctx.encodings.get(key) : undefined;
    if (hit) {
      out.fp = hit.fp;
      if (sameTimes(hit.at, out)) return { cut: out, parts: hit.parts };
      const parts = EN.retimeCut(out, slotKeys, hit);
      if (parts) {
        ctx.encodings.set(key, { fp: hit.fp, parts, pieces: hit.pieces, at: timesOf(out) });
        return { cut: out, parts };
      }
    }
    const extra = [EN.objectCanon(c.els), N.q6(c.t0 - c.a), N.q6(c.b - c.a), shared.text, beat, level];
    if (mine) extra.push(mine);
    const enc = EN.encodeCut(out, slotKeys, extra);
    out.fp = enc.fp;
    if (key !== null) {
      ctx.encodings.set(key, { fp: enc.fp, parts: enc.parts, pieces: enc.pieces || null, at: timesOf(out) });
    }
    return { cut: out, parts: enc.parts };
  }

  // The absolute times a cut's parts print besides its scene.
  function timesOf(out) { return [out.a, out.b, out.t0, out.t1, out.repT]; }
  function sameTimes(at, out) {
    return at[0] === out.a && at[1] === out.b && at[2] === out.t0 && at[3] === out.t1 && at[4] === out.repT;
  }

  // Everything planCut encodes besides the absolute times: a reused cast entry stands for the key, line, pin key,
  // role, impact, features (by value, so lang too), element map and decisions it was made with (planner/cast
  // castInputs); the text, marks, window relative to t0, ground, rig run, incoming seam, shared look, song terms and
  // material and media terms are in the key; the seam rules may replace the entrance or exit and the carry rule the
  // shot (by identity: planner/tracks and planner/camera keep their decisions on the cast entry). Equal features do
  // not mean equal text (「あ」→「い」).
  const objectIds = new WeakMap();
  let nextObjectId = 1;
  function idOf(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    let id = objectIds.get(v);
    if (id === undefined) { id = '@' + (nextObjectId++).toString(36); objectIds.set(v, id); }
    return id;
  }

  function encodingKey(out, cast, shared, beat, level, mine) {
    return cast.id + idOf(out.slots.arrive) + idOf(out.slots.depart) + idOf(out.slots['cam.shot']) +
      JSON.stringify([out.text, out.emph, out.note, N.q6(out.t0 - out.a), N.q6(out.b - out.a), out.ground, out.rig, out.seamIn,
        shared.id, beat, level, mine]);
  }

  // A segment's fingerprint: everything a ground scene reads (engine/scene/build buildGround): its ground and atmos
  // as { p, v }, its length, the shared look (palette, faces, amounts, design size, base registry version), the beat
  // grid or loudness seen from its start when a part needs them (songTerms), and the materials and assets its parts
  // use (matTerms, mediaTerms; DESIGN_2_1 §2.7, §11.2.6). A ground scene gets nothing of the segment's cuts (the
  // planner resolves the segment's parameters from its first cut, §4.16.6), so editing a cut never rebuilds its
  // background (§3.12 fp, §7.1.5).
  function groundFp(ctx, g, shared, beats) {
    const decisions = [['ground', g.ground], ['ornament', g.atmos]];
    const needs = needsOf(ctx, decisions);
    const { beat, level } = songTerms(ctx, needs, beats, g.t0);
    const scene = '[' + EN.decisionTexts(g.ground).scene + ',' + EN.decisionTexts(g.atmos).scene + ']';
    const used = mineOf(ctx, decisions, GROUND_SLOTS);
    if (used) for (const id of used.ids) ctx.mediaUsed.add(id);
    const mine = mineText(ctx, used);
    return mine ? EN.hex8(H.hash32(scene, N.q6(g.t1 - g.t0), shared, beat, level, mine))
      : EN.hex8(H.hash32(scene, N.q6(g.t1 - g.t0), shared, beat, level));
  }
  const GROUND_SLOTS = Object.freeze(['ground', 'atmos']);

  // --- features, reused across plans ----------------------------------------------------------------------------

  // A cut's features are a pure function of its text, role, marks, times and the song facts; equal inputs give the
  // same frozen object, kept for the last two plans. The id the cast cache compares is the features' value, not
  // their inputs: casting reads a cut's times only through its features (planner/cast, params and choose never read
  // t0/t1), so a cut that moved in time with equal features keeps its cast. Typing in the lyric editor moves every
  // later automatic line a little; keyed by the inputs, no cut after the edited line was reused.
  let featPrev = new Map(), featCur = new Map();
  function beginFeatures() {
    if (featCur.size) { featPrev = featCur; featCur = new Map(); }
  }

  // featuresOf(cut, fx, songKey, cached) → { feat, id }: FE.cutFeatures, reused (cached) or made fresh.
  function featuresOf(cut, fx, songKey, cached) {
    if (!cached) return { feat: FE.cutFeatures(cut, fx), id: null };
    const key = JSON.stringify([cut.text, cut.role, cut.lang, cut.emph.length > 0, !!cut.impact, cut.t0, cut.t1,
      fx.section, fx.repeatOf, fx.repeats, fx.sectionStart]) + songKey;
    let e = featCur.get(key);
    if (e === undefined) {
      e = featPrev.get(key);
      if (e === undefined) {
        const feat = deepFreeze(FE.cutFeatures(cut, fx));
        e = { feat, id: CA.intern(EN.canon(feat)) };
      }
      featCur.set(key, e);
    }
    return e;
  }

  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  // The encodings of plan cuts (planCut), kept for the last two plans like the features.
  let encPrev = new Map(), encCur = new Map();
  function beginEncodings() {
    if (encCur.size) { encPrev = encCur; encCur = new Map(); }
    return {
      get(key) {
        let e = encCur.get(key);
        if (e === undefined) { e = encPrev.get(key); if (e !== undefined) encCur.set(key, e); }
        return e;
      },
      set(key, e) { encCur.set(key, e); },
    };
  }

  // --- materials, media and camera facts of the Plan (DESIGN_2_1) --------------------------------------------------

  // The document's library as the planner reads it: { entries: Map<id, AssetEntry>, key (for the cast cache: what
  // decisions read of an entry — that it exists, its kind, whether it is animated and how long, and the AI's depth
  // suggestion, §11.2.6, §11.9.2), metaOf(id), metaHash(id) } or null without assets. Made once per plan (≤ 200
  // entries), so an entry changed in place is seen.
  function mediaIndex(doc) {
    const list = doc.media && Array.isArray(doc.media.list) ? doc.media.list : null;
    if (!list || !list.length) return null;
    const entries = new Map();
    for (const e of list) if (e && MEDIA.isId(e.id) && MEDIA.KINDS.includes(e.kind) && !entries.has(e.id)) entries.set(e.id, e);
    const metas = new Map(), hashes = new Map();
    const metaOf = (id) => {
      let m = metas.get(id);
      if (m === undefined) { m = sortedMeta(MEDIA.metaOf(entries.get(id))); metas.set(id, m); }
      return m;
    };
    const keyOf = (e) => [e.id, e.kind, e.anim === true, e.dur, e.ai && typeof e.ai === 'object' ? e.ai.depth || '' : ''].join(':');
    return {
      entries, key: [...entries.values()].map(keyOf).join(','), metaOf,
      metaHash(id) {
        let h = hashes.get(id);
        if (h === undefined) { h = H.hashJSON(metaOf(id)); hashes.set(id, h); }
        return h;
      },
    };
  }

  function sortedMeta(meta) {
    const out = {};
    for (const k of Object.keys(meta).sort()) out[k] = meta[k];
    return Object.freeze(out);
  }

  // plan.media (§11.2.6): { [AssetId]: MediaMeta } for every asset a decision param or a chosen material uses (collected
  // by planCut and groundFp), keys sorted.
  function planMedia(ctx) {
    const out = {};
    for (const id of [...ctx.mediaUsed].sort()) out[id] = ctx.media.metaOf(id);
    return out;
  }

  // material-bad (§2.8, §5.9.2): every problem of an extended registry that names a material, detail { id, code }.
  // registry.problems holds text '<kind>/<key>: …': parts/mix registryFor's '<kind>/myMat<x>: <code>' for an entry it
  // could not derive ('<kind>/?: <code>' when the entry has no usable id; the id is then ''), and REG.extend's own
  // '<kind>/<key>: <message>' for a derived definition that did not validate (code 'def'). Problems of derived media
  // grounds ('ground/myMed…: media-key') are not about materials.
  function materialWarnings(ctx) {
    const reg = ctx.registry;
    if (!reg.base || !Array.isArray(reg.problems)) return;
    for (const text of reg.problems) {
      const detail = materialProblem(text);
      if (detail) ctx.warn({ code: 'material-bad', detail });
    }
  }

  function materialProblem(text) {
    const m = /^[a-z?]+\/(myMat([0-9a-z]+)|\?): (.*)$/s.exec(String(text));
    if (!m) return null;
    return { code: /^[a-z][A-Za-z0-9-]*$/.test(m[3]) ? m[3] : 'def', id: m[2] ? 'm' + m[2] : '' };
  }

  // grounds[i].zoomed (§2.7): some cut of the segment has a shot (cam.shot ≠ 'none'), so the renderer oversamples its
  // static raster (§4.8).
  function markZoomed(cuts, grounds) {
    const zoomed = grounds.map(() => false);
    for (const c of cuts) {
      const d = c.slots['cam.shot'];
      if (d && d.v !== 'none' && c.ground >= 0 && c.ground < zoomed.length) zoomed[c.ground] = true;
    }
    grounds.forEach((g, i) => { g.zoomed = zoomed[i]; });
  }

  // --- the pipeline ---------------------------------------------------------------------------------------------

  // run(doc, registry, { trace, fresh }) → Plan. trace = { cutKey, slot, out } records one slot's decision
  // (planner/explain). fresh: plan without the re-planning caches (the same Plan, computed from scratch; tests).
  function run(doc, registry, opts) {
    const warner = createWarner();
    const aspect = D.DESIGN_SIZE[doc.look.aspect] ? doc.look.aspect : '16:9';
    const [w, h] = D.DESIGN_SIZE[aspect];
    const design = { aspect, w, h, short: Math.min(w, h) };
    const trace = (opts && opts.trace) || null;
    const cached = !trace && !(opts && opts.fresh);
    // The fields filled later or on first use (from castKeys on) are declared here, so ctx keeps one shape while the
    // cuts are cast: a field added in the middle of casting sends the optimized code that reads ctx back to the
    // interpreter (the first plans of a session were up to twice as slow).
    const ctx = {
      doc, registry, ix: PINS.index(doc.pins), warn: warner.warn, aspect,
      salts: doc.salts && Object.keys(doc.salts).length ? doc.salts : null,
      timing: Object.assign({}, TM.TIMING_DEFAULTS, doc.timing || {}), pools: new Map(), trace, casts: null,
      lockFree: CA.lockFreeIndex(doc.pins), media: mediaIndex(doc), mediaUsed: new Set(),
      castKeys: null, seams: null, encodings: null, fallbacks: null, lookAxis: null, lineConds: null, workCond: null,
      shotMood: null,
    };
    // Traced runs (explain) and fresh runs neither read nor refresh the caches of re-planning.
    if (cached) beginFeatures();
    materialWarnings(ctx);

    // 1. parse and time
    const { sheet, lines: parsed } = parsedSheet(doc);
    const lines = withLangPins(ctx, parsed);
    const timing = timeLines(ctx, lines, sheet.meta);
    const { timed, duration, grid } = timing;
    ctx.bpm = timing.bpm;
    ctx.grid = grid;
    const digest = doc.song && doc.song.digest;
    ctx.env = LK.envOf(digest);
    ctx.digestId = digest && typeof digest.loud === 'string' ? H.hashJSON(digest) : null;

    // 2. look
    ctx.hint = timed.some((l) => l.lang === 'ja') ? 'ja' : null;
    const scripts = new Set(timed.map((l) => l.lang));
    if (sheet.meta.title) scripts.add(SC.lineScript(sheet.meta.title, ctx.hint));
    const look = LK.resolveLook(ctx, sheet, scripts);
    ctx.look = look;
    ctx.amounts = look.amounts;
    ctx.pace = look.mood.pace;
    ctx.chooser = CH.createChooser(registry, { mood: look.mood, theme: look.theme, season: look.season, amounts: look.amounts });

    // 3. cutter
    const cuts = SG.cutAll(ctx, timed, sheet.meta, duration);

    // 4. features
    const fxOf = featureContexts(timed, cuts);
    const info = doc.song && doc.song.info ? doc.song.info : null;
    const loud = digest && typeof digest.loud === 'string' ? digest.hz + ':' + digest.loud : null;
    const songKey = '|' + CA.intern(EN.canon([duration, loud, timing.beats, info]));
    // sectionStart (DESIGN_2_1 §2.7): the first cut, and every cut whose section differs from the previous cut's.
    let prevSection;
    cuts.forEach((cut, i) => {
      const fx = fxOf(cut);
      const section = FE.sectionOf(cut, { info, section: fx.section });
      const got = featuresOf(cut, { duration, env: ctx.env, grid, info, section: fx.section, repeatOf: fx.repeatOf,
        repeats: fx.repeats, sectionStart: i === 0 || section !== prevSection }, songKey, cached);
      prevSection = section;
      cut.feat = got.feat;
      cut.featId = got.id;
    });

    // 5. cast, in time order (a cut whose inputs did not change reuses its cast, planner/cast castCut)
    if (cached) {
      ctx.casts = CA.beginCasts(registry);
      ctx.castKeys = CA.castKeys(ctx, EN.canon([registry.version, look.mood.key, look.theme.key, look.season, look.amounts,
        look.variety, aspect, doc.look.seed, doc.filters || null, ctx.bpm, ctx.media ? ctx.media.key : null]));
    }
    const hist = CA.createHistory(registry);
    for (const cut of cuts) Object.assign(cut, CA.castCut(ctx, cut, hist));

    // 6. tracks: grounds → seams (and their rule overrides) → carry → rigs → impulses (DESIGN_2_1 §3.9)
    const grounds = TR.grounds(ctx, cuts, duration);
    const seams = TR.seams(ctx, cuts);
    ctx.seams = seams;
    CAM.carry(ctx, cuts, seams);
    const rigs = CAM.rigs(ctx, cuts, seams, duration);
    const impulses = TR.impulses(ctx, cuts, duration);
    markZoomed(cuts, grounds);

    // 7. derived
    const sharedT = sharedText(ctx, look.plan, design);
    const shared = { text: sharedT, id: CA.intern(sharedT) };
    ctx.encodings = cached ? beginEncodings() : null;
    const encoded = cuts.map((c) => planCut(ctx, c, shared, timing.beats));
    for (const g of grounds) g.fp = groundFp(ctx, g, sharedT, timing.beats);
    const byLine = new Map();
    for (const c of cuts) {
      if (!c.line) continue;
      if (byLine.has(c.line)) byLine.get(c.line).push(c.key); else byLine.set(c.line, [c.key]);
    }
    const planLines = timed.map((line, index) => ({
      by: { end: line.by.end, start: line.by.start }, cuts: byLine.get(line.id) || [], id: line.id, index, lang: line.lang,
      locked: !!(doc.locks && doc.locks[line.id]), row: line.row, t0: line.t0, t1: line.t1, text: line.text,
    }));
    const plan = {
      v: PLAN_VERSION, hash: '', duration, design, look: look.plan, beats: timing.beats, lines: planLines,
      cuts: encoded.map((e) => e.cut), grounds, rigs, seams, impulses, media: planMedia(ctx), warnings: warner.list,
    };
    plan.hash = EN.planHash(plan, encoded.map((e) => e.parts));
    Object.defineProperty(plan, 'env', { value: ctx.env, enumerable: false });
    // How much of the previous plans this one reused (tests and the lab; not part of the Plan).
    const castHits = cuts.reduce((n, c) => n + (c.castHit ? 1 : 0), 0);
    const reuse = Object.freeze({ cuts: cuts.length, casts: castHits });
    Object.defineProperty(plan, 'reuse', { value: reuse, enumerable: false });
    return plan;
  }

  // --- entry points ---------------------------------------------------------------------------------------------

  const memo = [];

  // plan(doc, { registry }) → Plan (§4.16.1). Pure; memoized by (doc identity, registry and its version), last 2.
  function plan(doc, opts) {
    const registry = opts && opts.registry;
    if (!registry || typeof registry.pool !== 'function') throw new Error('planner/plan: { registry } is required');
    LK.rememberRegistry(registry);
    const hit = memo.find((m) => m.doc === doc && m.version === registry.version && m.registry === registry);
    if (hit) return hit.plan;
    const out = run(doc, registry, null);
    memo.unshift({ doc, version: registry.version, registry, plan: out });
    memo.length = Math.min(memo.length, MEMO_SIZE);
    return out;
  }

  // trace(doc, { registry }, { cutKey, slot }) → { plan, out, hit }: re-runs the pipeline with one slot traced.
  function trace(doc, opts, target) {
    const t = { cutKey: target.cutKey, slot: target.slot, out: {}, hit: false };
    const p = run(doc, opts.registry, { trace: t });
    return { plan: p, out: t.out, hit: t.hit };
  }

  // pinSig(plan, cutKey) → the cut's plain text, stored as `sig` on cut pins (§3.2).
  function pinSig(p, cutKey) {
    const cut = p && Array.isArray(p.cuts) ? p.cuts.find((c) => c.key === cutKey) : null;
    return cut ? cut.text : '';
  }

  return { plan, trace, pinSig, run, canon: EN.canon, PLAN_VERSION };
});
