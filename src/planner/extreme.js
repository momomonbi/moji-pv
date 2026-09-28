/* 文字PVメーカー v2 — original work. EXTREME camerawork in the plan: the overlay that turns the cam.extreme switch into EXTREME shots, their mirror, the EXTREME rig amplitude and the grounds it marks (DESIGN_EXTREME §2.3). */
MV.def('planner/extreme', ['core/hash', 'core/num', 'core/pins', 'core/paths', 'core/shot', 'core/schema', 'planner/choose',
  'planner/params', 'planner/kime'], (H, N, PINS, P, SHOT, S, CH, PA, KI) => {
  'use strict';

  // The switch is a pin, not a document field (DESIGN_EXTREME §2.1): the slot cam.extreme (0–1, 0 = off) pinned at
  // work or line scope (an area switch; a line pin 0 exempts a line). The overlay runs in stage 6 after casting and
  // returns at once when no scope pins it, so every document without the pin keeps its plan exactly. It picks EXTREME
  // presets (core/shot XSHOTS) for the automatic shots of the cuts where the switch resolves on; planner/camera and
  // planner/cast are not changed, and the cast history (its recency, the echo of repeated lines) never sees an EXTREME
  // pick: the overlay keeps a window of its own.

  const SLOT = 'cam.extreme';
  const SPEC = Object.freeze({ type: 'num', min: 0, max: 1, step: 0.05 });
  const SLOT_SPECS = Object.freeze({ [SLOT]: SPEC });
  // The strengths the switch writes (DESIGN_EXTREME §2.6: 強め / かなり / 最大; turning it on writes the last).
  const STEPS = Object.freeze([0.5, 0.75, 1]);
  const ON = 1;
  const XPOOL = Object.freeze(SHOT.XSHOT_KEYS.slice().sort());
  const NONE = 'none';

  // --- §2.3.2 rules and §2.3.3 weights (formulas FROZEN; constants tuned by the visual QA of §5.4) -------------------
  const SHORT_CUT = 0.8;                          // seconds (planner/camera SHORT_CUT)
  const GENTLE_POOL = Object.freeze(['beatCrash', 'dutchSwing', 'shakeHits']);
  const SHORT_POOL = Object.freeze(['punchHit', 'shakeHits']);
  const ROLE_POOLS = Object.freeze({
    title: Object.freeze(['crashZoom', 'spinIn', 'vertigo']),
    interlude: Object.freeze(['dutchSwing', 'orbit', 'vertigo']),
    outro: Object.freeze(['orbit', 'spinOut', 'vertigo']),
  });
  const SECTION = Object.freeze({
    chorus: Object.freeze({ crashZoom: 1.5, whipRead: 1.5, whipPan: 1.5, beatCrash: 1.5 }),
    prechorus: Object.freeze({ beatCrash: 1.5, shakeHits: 1.5 }),
    verse: Object.freeze({ dutchSwing: 1.3, orbit: 1.3, vertigo: 1.3 }),
    bridge: Object.freeze({ vertigo: 1.5, orbit: 1.5, spinIn: 1.5 }),
    intro: Object.freeze({ vertigo: 1.5, spinIn: 1.5, spinOut: 1.5 }),
    outro: Object.freeze({ vertigo: 1.5, spinIn: 1.5, spinOut: 1.5 }),
  });
  const RECENT = 0.2, NEAR = 0.5, ECHO = 40, PAIR = 6;
  // The rig of a run whose first cut has EXTREME on (§2.3.5): amp = q2(min(AMP_MAX, (0.6 + 0.8·A)·(last chorus ? 1.25 : 1))).
  const AMP_BASE = 0.6, AMP_SLOPE = 0.8, AMP_MAX = 1.6, LAST_CHORUS_AMP = 1.25;
  const SPECIAL = new Set(['title', 'interlude', 'outro']);

  function q2(x) { return Math.round(x * 100) / 100; }
  function atOf(cut) { return { cutKey: cut.key, pinCutKey: cut.pinKey, lineId: cut.line }; }

  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  function tracing(ctx, cutKey, slot) {
    const t = ctx.trace;
    if (!t || t.cutKey !== cutKey || t.slot !== slot) return null;
    t.hit = true;
    return t.out;
  }

  // --- the switch ------------------------------------------------------------------------------------------------------

  // A line or work pin coerced through the spec; a cut pin does not apply (the switch is an area's, §2.2).
  const coerceX = PA.acceptSpec(SPEC);
  function acceptX(v, rank) { return rank === 'pin:cut' ? { na: true } : coerceX(v); }

  // resolve(ix, at, warn?) → { v, from, by, at } | null: the switch at a cut or line (at = { cutKey, pinCutKey, lineId };
  // a line: { lineId }), line > work, the value coerced (0 = off). null when nothing pins it there.
  function resolve(ix, at, warn) {
    if (!ix || !PA.pinned(ix, SLOT)) return null;
    const where = Object.assign({ cutKey: null, pinCutKey: null, lineId: null }, at || {});
    return PA.resolvePin(ix, where, SLOT, acceptX, warn || null);
  }

  // valueAt(ix, at) → the switch's value (0 when off or not pinned) — what the AI panel and the inspector widget read.
  function valueAt(ix, at) {
    const pin = resolve(ix, at, null);
    return pin && pin.v > 0 ? pin.v : 0;
  }

  // Interned decisions: the same value is the same frozen object in every plan, so planner/plan's re-planning cache
  // (encodingKey reads cam.shot by identity) stays warm while the overlay's pick is the same.
  const interned = new Map();
  function intern(from, by, v) {
    const id = from + '|' + (by || '') + '|' + v;
    let d = interned.get(id);
    if (!d) {
      d = by === undefined || by === null ? { from, v } : { by, from, v };
      interned.set(id, deepFreeze(d));
    }
    return d;
  }
  // An EXTREME cut where the switch is on leans on nothing (§2.3.1 step 4: an automatic cam.follow 0) and frames at its
  // preset's own closeness: an automatic cam.zoom XZOOM. (The automatic cam.zoom, 0.8–0.9 × 1.05 on impact lines, calms
  // the normal presets, NOTES "Step (b)"; on the EXTREME presets it put 57–80 % of the block keys at the 0.9 zoom floor
  // with the catalog's layouts, measured on corpus(2): the camera pulled back from the words in most EXTREME cuts.)
  const XZOOM = 1;
  const FOLLOW0 = deepFreeze({ from: 'auto', v: 0 });
  const ZOOM1 = deepFreeze({ from: 'auto', v: XZOOM });
  function neutral(ctx, cut, x) {
    for (const [slot, d] of [['cam.zoom', ZOOM1], ['cam.follow', FOLLOW0]]) {
      const old = cut.slots[slot];
      if (!old || old.from !== 'auto') continue;
      cut.slots[slot] = d;
      const t = tracing(ctx, cut.key, slot);
      if (t) Object.assign(t, { why: [{ code: 'cam.extreme', params: { x } }], decision: d });
    }
  }

  // --- rules and weights -----------------------------------------------------------------------------------------

  function arrangeOf(ctx, cut) {
    const d = cut.slots.arrange;
    return d && typeof d.v === 'string' ? ctx.registry.get('arrange', d.v) : null;
  }

  function framesOf(ctx, cut) {
    const d = cut.slots.lens;
    const def = d && typeof d.v === 'string' && d.v !== NONE ? ctx.registry.get('lens', d.v) : null;
    return def && def.frames === true ? def : null;
  }

  // The pool of a cut (§2.3.2, first match): { pool: keys | null, mask, why }. pool null = no EXTREME shot (a layout
  // without camerawork, a cut without text).
  function rulesOf(ctx, cut) {
    const arrange = arrangeOf(ctx, cut);
    const cam = arrange && arrange.cam ? arrange.cam : 'any';
    if (cam === 'none') return { pool: null, mask: 'trait', why: [{ code: 'cam.arrange', params: { key: arrange.key } }] };
    if (typeof cut.text !== 'string' || cut.text.trim() === '') return { pool: null, mask: 'role', why: [] };
    const lens = framesOf(ctx, cut);
    if (cam === 'gentle') return { pool: GENTLE_POOL, mask: 'trait', why: [{ code: 'cam.arrange', params: { key: arrange.key } }] };
    if (lens) return { pool: GENTLE_POOL, mask: 'trait', why: [{ code: 'cam.lens', params: { key: lens.key } }] };
    if (cut.feat.dur < SHORT_CUT) return { pool: SHORT_POOL, mask: 'trait', why: [{ code: 'cam.short', params: {} }] };
    if (ROLE_POOLS[cut.role]) return { pool: ROLE_POOLS[cut.role], mask: 'role', why: [{ code: 'rule', params: { rule: 'role' } }] };
    return { pool: XPOOL, mask: null, why: [] };
  }

  // Whether a cut can be read word by word (whipRead, jumpRead): ≥ READ_WORDS words over ≥ READ_DUR s. (Phase F: 3 words
  // over 1.6 s let no cut of the sample lyrics take them — a Japanese lyric line is usually cut in two, of 1–2 words
  // and about a second each; 2 words over 1.2 s gives each word ≥ 0.4 s, the jump spacing.)
  const READ_WORDS = 2, READ_DUR = 1.2;
  function reads(f) { return f.words >= READ_WORDS && f.dur >= READ_DUR; }

  // The §2.3.3 base weight of one EXTREME preset. f = the cut's features, orient its orientation, nextStart whether the
  // next cut starts a section, beats whether the plan has a tempo.
  function baseWeight(key, f, orient, nextStart, beats) {
    switch (key) {
      case 'crashZoom': return (f.impact ? 30 : f.emph ? 4 : f.onBeat ? 1.5 : 0.6) * (0.6 + f.energy);
      case 'punchHit': return f.impact ? 6 : 0.5;
      case 'whipRead': return (reads(f) ? 2.5 : 0) * (orient === 'v' ? 0.8 : 1);
      case 'jumpRead': return reads(f) ? 1.5 : 0;
      case 'whipPan': return 1.2;
      case 'spinIn': return f.sectionStart ? 3 : 0.4;
      case 'spinOut': return nextStart ? 2 : 0.4;
      case 'dutchSwing': return 1.2 * (f.energy >= 0.4 ? 1 : 0.6);
      case 'shakeHits': return f.energy >= 0.6 ? 1.5 : 0.5;
      case 'beatCrash': return beats ? (f.energy >= 0.5 ? 2 : 0.8) : 0.3;
      case 'vertigo': return f.dur >= 2.5 && f.energy < 0.5 ? 2 : 0.3;
      case 'orbit': return f.dur >= 2 ? 1 : 0.3;
      default: return 0;
    }
  }

  // The reasons behind one key's base weight (explain), in the camera's why codes.
  function baseWhy(key, f) {
    switch (key) {
      case 'crashZoom': return f.impact ? [{ code: 'cam.impact', params: {} }] : f.emph ? [{ code: 'cam.emph', params: {} }] : [];
      case 'punchHit': return f.impact ? [{ code: 'cam.impact', params: {} }] : [];
      case 'whipRead': case 'jumpRead': return reads(f) ? [{ code: 'cam.words', params: { n: f.words } }] : [];
      default: return [];
    }
  }

  // √moodBias of every preset (the square root keeps EXTREME intense in calm moods), made once per plan and mood.
  const moodCache = new WeakMap();
  function moodFactors(mood) {
    const key = mood || moodCache;
    let m = moodCache.get(key);
    if (!m) {
      m = new Float64Array(XPOOL.length);
      XPOOL.forEach((k, i) => { m[i] = Math.sqrt(CH.moodBias(SHOT.XSHOTS[k].tags, mood)); });
      moodCache.set(key, m);
    }
    return m;
  }

  function moodWhy(tags, mood) {
    let best = null, bestAbs = 0;
    for (const tag of tags || []) {
      const b = mood && mood.tagBias && typeof mood.tagBias[tag] === 'number' ? mood.tagBias[tag] : 1;
      const a = Math.abs(Math.log(Math.max(b, 1e-6)));
      if (a > bestAbs) { best = { code: 'mood.tag', params: { mood: mood.key, tag, x: q2(b) } }; bestAbs = a; }
    }
    return best;
  }

  // weigh(ctx, cut, rules, rec, withWhy) → [{ key, w, wOwn, why }] over XPOOL (w = 0 outside the pool). w = q6 of every
  // factor; wOwn leaves out the recency, the pair and the echo (the cut's natural pick, which the near set of the cuts
  // 2–4 after it reads). rec = { prev, near, echo, pair, nextStart } (see recencyOf) and ahead (alignedKey).
  // キメ (PV22 P3, DESIGN_2_2 §3): on the cut right before a キメ cut (calm level 2) the presets tagged hard or fast weigh
  // ×KI.CALM.xstrong.
  function weigh(ctx, cut, rules, rec, withWhy) {
    const f = cut.feat;
    const mood = ctx.look.mood;
    const moods = moodFactors(mood);
    const orient = cut.slots.orient ? cut.slots.orient.v : null;
    const beats = !!ctx.bpm;
    const bySection = SECTION[f.section === null || f.section === undefined ? 'verse' : f.section] || null;
    const out = new Array(XPOOL.length);
    for (let i = 0; i < XPOOL.length; i++) {
      const key = XPOOL[i];
      if (!rules.pool || !rules.pool.includes(key)) { out[i] = { key, w: 0, wOwn: 0, why: withWhy ? [] : null }; continue; }
      const sec = bySection && bySection[key] ? bySection[key] : 1;
      let own = baseWeight(key, f, orient, rec.nextStart, beats) * moods[i] * sec;
      if (f.calm === 2 && calmStrong(key)) own *= KI.CALM.xstrong;
      let w = own;
      if (rec.pair && key === 'whipPan') w *= PAIR;
      if (rec.echo === key) w *= ECHO;
      if (rec.prev === key) w *= RECENT;
      if (rec.ahead === key) w *= RECENT;
      if (rec.near.includes(key)) w *= NEAR;
      let why = null;
      if (withWhy) {
        why = baseWhy(key, f);
        if (moods[i] !== 1) { const t = moodWhy(SHOT.XSHOTS[key].tags, mood); if (t) why.push(t); }
        if (sec !== 1 && f.section) why.push({ code: 'cam.section', params: { section: f.section } });
        if (rec.echo === key) why.push({ code: rec.echoCode || 'echo', params: { cut: f.repeatOf } });
        if (rec.prev && rec.prev !== key) why.push({ code: 'recent', params: { key: rec.prev } });
      }
      out[i] = { key, w: N.q6(w), wOwn: N.q6(own), why };
    }
    return out;
  }

  function calmStrong(key) {
    const tags = SHOT.XSHOTS[key].tags || [];
    return tags.includes('hard') || tags.includes('fast');
  }

  // The overlay's own window (its recency and echo read nothing of the cast history): one row per cut in time order,
  // { key: the EXTREME preset the cut shows (a pin or the overlay's pick; null for none), m: mirrored, nat: its natural
  // pick (null when the overlay did not pick), copyOf: the line cut it sings (feat.repeatOf or its key), section,
  // cut, i: its index }. byCut maps cut keys to rows (the echo).
  function createWindow() {
    const rows = [];
    const byCut = new Map();
    return {
      rows, byCut,
      push(cut, key, m, nat) {
        const row = { key, m, nat, copyOf: cut.feat.repeatOf || cut.key, section: cut.feat.section, cut, i: rows.length };
        rows.push(row);
        byCut.set(cut.key, row);
        return row;
      },
    };
  }

  // The recency, echo and pair a cut's pick reads (§2.3.3, §2.3.4): the previous cut's final pick (×RECENT), the natural
  // picks of the 3 cuts before it (×NEAR), the preset the cut it echoes shows (×ECHO), and the pair rule (the previous
  // cut is a whipPan of the same section with a hard cut into this one: ×PAIR, and the same direction). With free (the
  // salt-free window) the natural picks and the echo are read without salts. The echo never weighs toward the preset
  // the previous cut shows: a line sung twice in a row does not play the same move back to back (the camera's rule 4 of
  // "Repeated lines"), and neither does a repeat whose neighbour in the first copy took another move (its copy of that
  // neighbour may not, on another layout). ×ECHO beat ×RECENT there: measured on corpus(6) with the switch on,
  // neighbours shared their EXTREME move in 11.3 % of the pairs, 5.9 % with this rule (repeats still share 68 %).
  function recencyOf(win, cut, next, free) {
    const rows = win.rows, n = rows.length;
    const last = n ? rows[n - 1] : null;
    const prev = last ? last.key : null;
    // the natural picks without salts (a reroll changes the near sets of no cut after it, as the camera's; free has one
    // row per cut too)
    const nats = free ? free.rows : rows;
    const near = [];
    for (let i = n - 4; i < n - 1; i++) if (i >= 0 && nats[i].nat && !near.includes(nats[i].nat)) near.push(nats[i].nat);
    const rep = cut.feat.repeatOf;
    const echoRow = rep ? (free || win).byCut.get(rep) || null : null;
    let echo = echoRow && echoRow.key ? echoRow.key : null;
    if (echo !== null && echo === prev) echo = null;
    // 'echo.kept': the first copy shows another preset than the one it passes on (a reroll or a lock there)
    const shown = free && rep ? win.byCut.get(rep) || null : null;
    const echoCode = shown && echo !== null && shown.key !== echo ? 'echo.kept' : 'echo';
    const pair = !!last && last.key === 'whipPan' && last.section === cut.feat.section && !(cut.seamIn >= 0);
    return { prev, near, echo, echoCode, echoRow: echo ? echoRow : null, pair, last,
      nextStart: !!(next && next.feat.sectionStart) };
  }

  // Gumbel-max over w (the pick) and over wOwn (the natural pick), keyed by the preset key; ties → the smaller key.
  function argmax(list, prefix) {
    let best = null, bestScore = -Infinity, nat = null, natScore = -Infinity;
    for (const c of list) {
      if (!(c.w > 0) && !(c.wOwn > 0)) continue;
      const noise = CH.gumbelAt(prefix, c.key);
      if (c.w > 0) { const s = Math.log(c.w) + noise; if (s > bestScore) { best = c.key; bestScore = s; } }
      if (c.wOwn > 0) { const s = Math.log(c.wOwn) + noise; if (s > natScore) { nat = c.key; natScore = s; } }
    }
    return { key: best, nat };
  }

  // The mirror of a pick (§2.3.4): only the ⇆ presets; the pair rule keeps the previous whipPan's direction, a repeat
  // that plays its first copy's preset plays it in the same direction, else hash32('xmirror', prefix) & 1.
  function mirrorOf(key, rec, prefix) {
    if (!SHOT.MIRRORS.includes(key)) return false;
    if (key === 'whipPan' && rec.pair) return rec.last.m;
    if (rec.echoRow && rec.echoRow.key === key) return rec.echoRow.m;
    return (H.hash32('xmirror', prefix) & 1) === 1;
  }

  // The cut's cam.shot stream (planner/choose §4.1.3), so a reroll of the cut, its line or their カメラワーク field
  // rerolls its EXTREME pick too.
  function shotPrefix(ctx, cut, salts) {
    const cs = CH.cutSeed(ctx.doc.look.seed, cut.key, cut.line, salts);
    return CH.gumbelPrefix(CH.slotSeedAt(CH.slotPrefix(cs), cut.key, cut.line, 'cam.shot', salts));
  }

  // The EXTREME preset a decision value shows ({ key, m }), or null (normal shots, 'none', EXTREME objects).
  function shownOf(d) {
    const x = d && typeof d.v === 'string' ? SHOT.xKeyOf(d.v) : null;
    return x ? { key: x.key, m: x.m } : null;
  }

  // weights(ctx, cut, rec?) → [{ key, w, why }] over XPOOL for one cut (tests and tools; the overlay picks from the same
  // numbers). rec as recencyOf (default: no recency, echo or pair; nextStart false).
  function weights(ctx, cut, rec) {
    const r = Object.assign({ prev: null, near: [], echo: null, pair: false, nextStart: false }, rec || {});
    const rules = rulesOf(ctx, cut);
    return weigh(ctx, cut, rules, r, true).map((c) => ({ key: c.key, w: c.w, why: rules.why.concat(c.why) }));
  }

  // --- stage 6a: shots -------------------------------------------------------------------------------------------------

  // shots(ctx, cuts): per cut in time order (stage 6, after the seams and before planner/camera carry). Where the switch
  // resolves > 0 the cut gets cut.slots['cam.extreme'] = { by, from, v } (the pin); an automatic cam.shot becomes an
  // EXTREME preset ({ from: 'auto', v: key or key~m }) by the rules and weights. A pinned cam.shot (a user, AI or lock
  // pin) is kept. Every EXTREME shot there takes an automatic cam.follow 0 and cam.zoom XZOOM (neutral); cam.curve keeps
  // its value.
  // The amount of camerawork does not stop it (the switch is an explicit request). Explain: a trace of the cut's
  // cam.shot gets override { rule: 'extreme', decision, why } and the EXTREME candidates; a trace of cam.extreme its pin.
  // With salts (rerolls), a silent pass without them comes first: the echo a repeat weighs is the pick its first copy
  // would show without any salt, so a reroll of a first copy leaves its repeats (DESIGN_2_1 §3.7, as the camera's heir).
  function shots(ctx, cuts) {
    if (!PA.pinned(ctx.ix, SLOT)) { traceOff(ctx); return; }
    const pins = cuts.map((cut) => {
      const pin = PA.resolvePin(ctx.ix, atOf(cut), SLOT, acceptX, ctx.warn);
      const x = pin && pin.v > 0 ? pin.v : 0;
      const tx = tracing(ctx, cut.key, SLOT);
      const xd = x > 0 ? intern(pin.from, pin.by, x) : null;
      if (tx) {
        Object.assign(tx, { kind: SLOT, stage: pin ? 'pin' : 'auto', pin, why: x > 0 ? [{ code: 'cam.extreme', params: { x } }] : [],
          decision: xd || (pin ? { v: pin.v, from: pin.from, by: pin.by } : { v: 0, from: 'auto' }) });
      }
      return { x, xd };
    });
    const free = ctx.salts ? pass(ctx, cuts, pins, null, null, false) : null;
    pass(ctx, cuts, pins, ctx.salts, free, true);
  }

  // One pass over the cuts → its window. salts: the reroll salts the seeds read (null: the salt-free pass); free: the
  // salt-free window the echo reads (null: this pass's own); write: set the decisions and traces (the real pass).
  function pass(ctx, cuts, pins, salts, free, write) {
    const win = createWindow();
    for (let j = 0; j < cuts.length; j++) {
      const cut = cuts[j];
      const { x, xd } = pins[j];
      const shot = cut.slots['cam.shot'];
      const pinned = !shot || (typeof shot.from === 'string' && shot.from.startsWith('pin'));
      if (!(x > 0) || pinned) {
        if (write && x > 0) {
          cut.slots[SLOT] = xd;
          if (shot && shot.v !== null && shot.v !== undefined && SHOT.isExtreme(shot.v)) neutral(ctx, cut, x);   // a hand or AI pick
        }
        const s = shownOf(shot);
        win.push(cut, s ? s.key : null, s ? s.m : false, s ? s.key : null);
        continue;
      }
      if (write) cut.slots[SLOT] = xd;
      const t = write ? tracing(ctx, cut.key, 'cam.shot') : null;
      const rules = rulesOf(ctx, cut);
      if (!rules.pool) {
        // the cut keeps its normal shot: explain says why EXTREME leaves it (a layout made for a still camera, a cut
        // without words) instead of the normal camera's own reason (phase F)
        if (t) {
          t.why = [{ code: 'cam.extreme', params: { x } }].concat(rules.why.length
            ? [{ code: 'cam.xStill', params: rules.why[0].params }] : [{ code: 'cam.xNoText', params: {} }]);
        }
        win.push(cut, null, false, null);
        continue;
      }
      const next = j + 1 < cuts.length ? cuts[j + 1] : null;
      const rec = recencyOf(win, cut, next, free);
      rec.ahead = alignedKey(ctx, win, next, salts);
      const list = weigh(ctx, cut, rules, rec, !!t);
      const prefix = shotPrefix(ctx, cut, salts);
      // 「くり返しの行をそろえる」: the preset its source shows, where it fits the cut (weighs > 0 there)
      const src = alignedSource(ctx, cut, salts);
      // キメ (DESIGN_2_2 §3): a キメ cut takes the strongest move its pool has (crashZoom, on a short cut punchHit), as
      // a fact of the cut (its window row as an aligned pick's); else the usual pick.
      const xk = KI.isKime(cut) ? KI.xshotFor(rules.pool) : null;
      const same = xk ? null : sameAs(win, src, rec.prev, list);
      const got = xk ? { key: xk, nat: xk } : same ? { key: same.key, nat: same.key } : argmax(list, prefix);
      if (got.key === null) { win.push(cut, null, false, null); continue; }
      const m = same ? same.m : mirrorOf(got.key, rec, prefix);
      win.push(cut, got.key, m, got.nat);
      if (!write) continue;
      const d = intern('auto', null, got.key + (m ? '~m' : ''));
      cut.slots['cam.shot'] = d;
      neutral(ctx, cut, x);
      if (t) {
        const own = list[XPOOL.indexOf(got.key)];
        const why = xk ? [{ code: 'rule', params: { rule: 'kime.x' } }]
          : same ? [{ code: 'repeat.same', params: { cut: src.key } }] : rules.why.concat(own.why);
        t.override = { rule: 'extreme', decision: d, why: [{ code: 'cam.extreme', params: { x } }].concat(why) };
        t.candidates = list.map((c) => ({ key: c.key, w: c.w,
          masked: c.w > 0 || rules.pool.includes(c.key) ? null : rules.mask }));
        t.recent = { prev: rec.prev, near: rec.near, echo: rec.echo, pair: rec.pair };
      }
    }
    return win;
  }

  // 「くり返しの行をそろえる」 (DESIGN_2_1 §4.10, planner/cast alignments): alignedSource(ctx, cut, salts) → the cut's
  // source, or null (the opt-in is off there, or the cut, its line or their カメラワーク field is rerolled: salts of this
  // pass). A repeat plays the EXTREME preset its source shows (a pick or a pin), mirrored alike, where the preset fits it
  // (the pools and rules above give it a weight > 0); else it picks its own. The source comes first in time order, so
  // its row is in the window. alignedKey(ctx, win, next, salts) → the preset the next cut takes that way, or null: the
  // cut right before a repeat weighs it ×RECENT, as its previous cut (the same move does not play twice in a row).
  function alignedSource(ctx, cut, salts) {
    const src = cut && ctx.align ? ctx.align.get(cut.key) || null : null;
    if (!src || !salts) return src;
    const line = cut.line ? 'line/' + cut.line : null;
    const salted = salts['cut/' + cut.key] || salts['cut/' + cut.key + ':cam.shot']
      || (line && (salts[line] || salts[line + ':cam.shot']));
    return salted ? null : src;
  }

  // sameAs(win, src, prev, list) → the source's row where the cut plays its preset, or null. Not where the previous cut
  // already shows that preset and the cut before the source did not (§8.2 no identical neighbours, as planner/cast's
  // nearClash for a layout): the same move twice in a row is left to the pick.
  function sameAs(win, src, prev, list) {
    const row = src ? win.byCut.get(src.key) : null;
    if (!row || !row.key || !(list[XPOOL.indexOf(row.key)].w > 0)) return null;
    const before = row.i > 0 ? win.rows[row.i - 1] : null;
    return prev === row.key && !(before && before.key === row.key) ? null : row;
  }

  function alignedKey(ctx, win, next, salts) {
    const src = alignedSource(ctx, next, salts);
    const row = src ? win.byCut.get(src.key) : null;
    return row && row.key ? row.key : null;
  }

  // A trace of cam.extreme in a document that pins it nowhere: off, automatically.
  function traceOff(ctx) {
    const t = ctx.trace;
    if (!t || t.slot !== SLOT) return;
    t.hit = true;
    Object.assign(t.out, { kind: SLOT, stage: 'auto', pin: null, why: [], decision: { v: 0, from: 'auto' } });
  }

  // --- stage 6b: grounds and rigs ----------------------------------------------------------------------------------------

  // tracks(ctx, cuts, grounds, rigs) (stage 6, after planner/plan markZoomed): grounds[i].x = true for every segment
  // whose ground an EXTREME cut's camera can drive — the cut's own segment and every other one on screen while the cut
  // is (its a … b: a segment starting at the next cut's a is drawn with this cut's camera until the next cut's t0;
  // phase F, the QA found the ground edge of such a segment behind a dutch swing) — for an EXTREME shot of the overlay,
  // a user or the AI (the field is absent otherwise, so other plans keep their hash); and where the switch is pinned,
  // every rig run whose first cut has it on and whose rig is automatic (not 'none') gets
  // amp = q2(min(AMP_MAX, (AMP_BASE + AMP_SLOPE·A)·(last chorus ? 1.25 : 1))).
  function tracks(ctx, cuts, grounds, rigs) {
    for (const c of cuts) {
      const d = c.slots['cam.shot'];
      if (!d || d.v === null || d.v === undefined || !SHOT.isExtreme(d.v)) continue;
      if (c.ground >= 0 && c.ground < grounds.length) grounds[c.ground].x = true;
      grounds.forEach((g, i) => { if (g && g.t0 < c.b && g.t1 > c.a) grounds[i].x = true; });
    }
    if (!PA.pinned(ctx.ix, SLOT) || !Array.isArray(rigs)) return;
    const byKey = new Map(cuts.map((c) => [c.key, c]));
    const firstOf = (run) => (run.cuts && run.cuts.length ? byKey.get(run.cuts[0]) || null : null);
    let lastChorus = -1;
    rigs.forEach((run, r) => {
      const first = firstOf(run);
      if (first && first.feat.section === 'chorus' && !SPECIAL.has(first.role)) lastChorus = r;
    });
    const A = ctx.look.amounts.camera;
    rigs.forEach((run, r) => {
      const first = firstOf(run);
      const xd = first ? first.slots[SLOT] : null;
      const d = run.rig;
      if (!xd || !(xd.v > 0) || !d || d.from !== 'auto' || d.v === NONE || !d.p) return;
      const amp = q2(Math.min(AMP_MAX, (AMP_BASE + AMP_SLOPE * A) * (r === lastChorus ? LAST_CHORUS_AMP : 1)));
      const rig = {};
      if (d.by !== undefined) rig.by = d.by;
      rig.from = d.from;
      rig.p = { amp };
      rig.v = d.v;
      run.rig = rig;
      const t = tracing(ctx, first.key, 'rig');
      if (t) {
        t.why = (t.why || []).concat([{ code: 'cam.extreme', params: { x: xd.v } }]);
        t.decision = rig;
      }
    });
  }

  // --- for the inspector and the AI (phases D, E) --------------------------------------------------------------------

  // handPicked(doc, scope) → the paths of EXTREME cam.shot pins by 'user' or 'ai' under a scope ('work', 'line/<id>',
  // 'cut/<key>'), sorted — what turning the switch off asks about (lock pins stay; DESIGN_EXTREME §2.6).
  function handPicked(doc, scope) {
    const pins = (doc && doc.pins) || {};
    return PINS.pinsUnder(pins, scope).filter((path) => {
      const pin = pins[path];
      if (!pin || (pin.by !== 'user' && pin.by !== 'ai')) return false;
      let parsed;
      try { parsed = P.parse(path); } catch (e) { return false; }
      return parsed.slot === 'cam.shot' && SHOT.isExtreme(pin.v);
    });
  }

  // lineSwitches(doc, scope) → the paths of the lines' own switches that are on (line pins > 0 by 'user' or 'ai', e.g.
  // the rows an EXTREME request of the AI panel turned on for an area), sorted — under 'work' only: what turning the
  // whole video's switch off asks about besides the moves picked by hand (phase F). A line has none under it.
  const LINE_SWITCH = /^line\/[^:]+:cam\.extreme$/;
  function lineSwitches(doc, scope) {
    if (scope !== 'work') return [];
    const pins = (doc && doc.pins) || {};
    return Object.keys(pins).filter((path) => {
      const pin = pins[path];
      return LINE_SWITCH.test(path) && !!pin && (pin.by === 'user' || pin.by === 'ai') && typeof pin.v === 'number' && pin.v > 0;
    }).sort();
  }

  // switchCommands(doc, scope, v, { remove, by }) → the commands of one switch change at a scope ('work' or
  // 'line/<id>'), for one batch (one undo step): v > 0 pins the strength (1 = on, STEPS); v 0 or null turns it off —
  // at work the pin is cleared; at a line it is cleared, or pinned 0 when the work still has the switch on (the line is
  // exempted). remove: also clear the EXTREME shots picked by hand or by the AI under the scope (handPicked) and, at
  // work, the lines' own switches that are on (lineSwitches), so EXTREME is off everywhere. by: the pin author (default
  // 'user').
  function switchCommands(doc, scope, v, opts) {
    const o = opts || {};
    const by = o.by || 'user';
    const path = scope + ':' + SLOT;
    const out = [];
    if (typeof v === 'number' && v > 0) out.push({ t: 'pin.set', path, v: S.coerce(SPEC, v), by });
    else if (scope === 'work') out.push({ t: 'pin.clear', path });
    else {
      const work = resolve(PINS.index((doc && doc.pins) || {}), { lineId: null }, null);
      if (work && work.v > 0) out.push({ t: 'pin.set', path, v: 0, by });
      else out.push({ t: 'pin.clear', path });
    }
    if (o.remove && !(typeof v === 'number' && v > 0)) {
      for (const p of lineSwitches(doc, scope)) out.push({ t: 'pin.clear', path: p });
      for (const p of handPicked(doc, scope)) out.push({ t: 'pin.clear', path: p });
    }
    return out;
  }

  return {
    SLOT, SLOT_SPECS, STEPS, ON, XPOOL, shots, tracks, weights, resolve, valueAt, handPicked, lineSwitches, switchCommands,
    FACTORS: Object.freeze({ SHORT_CUT, RECENT, NEAR, ECHO, PAIR, XZOOM, AMP_BASE, AMP_SLOPE, AMP_MAX, LAST_CHORUS_AMP, READ_WORDS, READ_DUR }),
    POOLS: Object.freeze({ gentle: GENTLE_POOL, short: SHORT_POOL, roles: ROLE_POOLS }),
  };
});
