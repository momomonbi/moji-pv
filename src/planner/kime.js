/* 文字PVメーカー v2 — original work. キメ (PV22 P3): the constants of a キメ line, the one accessor isKime, the calm levels of the cuts before a キメ cut and their chooser factor (DESIGN_2_2 §3). */
MV.def('planner/kime', ['core/num'], (N) => {
  'use strict';

  // A line is キメ when its `line/<id>:kime` pin is true (planner/plan withKimePins sets line.kime). Absent is off, so a
  // document without the pin plans exactly as before: every キメ path below is behind cut.kime, feat.kime or feat.calm.

  function deepFreeze(v) {
    if (v && typeof v === 'object' && !Object.isFrozen(v)) {
      Object.freeze(v);
      for (const k of Object.keys(v)) deepFreeze(v[k]);
    }
    return v;
  }

  // What a キメ cut may pick and the values it gets by rule (DESIGN_2_2 §3.4). Every set is filtered by the cut's own
  // pool (registry, role, orientation, script, aspect, the user's part filters, gates, season, the line's avoid list)
  // before the chooser sees it; an empty set leaves the slot to the chooser (kime.limited). No part key is forced
  // literally: forced parts are registry.fallback(kind).
  const KIME = deepFreeze({
    cellsCap: 30,                           // one cut up to maxCells(aspect) = min(cellsCap, 2 · BASE[aspect])
    tail: 1.5, keep: 3,                     // s: hold into a following interlude / outro, which keeps ≥ keep s
    arrange: ['edgeBleed', 'giantWhisper'], bleedCells: [2, 12], bigOnly: ['giantWhisper'],
    arrive: ['stampPress', 'zoomSettle'],
    arriveMax: { stampPress: { dur: 0.4, each: 0.1 }, zoomSettle: { dur: 0.4, each: 0.03 } },
    landBy: 0.8,                            // s: dur + (units − 1) · each ≤ landBy
    dwell: ['stillHold'], dwellBeats: ['stillHold', 'thumpSwell'],
    lensKick: ['impactKick'],
    shots: { plain: ['snapZoom', 'pushWord', 'settle', 'none'], emph: ['pushWord', 'settle', 'none'] },
    xshots: ['crashZoom', 'punchHit'],
    face: 'display', scalePinned: 1.3, scaleFloor: 1,
    ornMax: 1, filterMax: 1,
    bleed: { overflow: 1.08, anchor: 'center' },
    giant: { ratioMin: 3, tuck: 'under' },
    params: ['dur', 'each', 'shake', 'overflow', 'anchor', 'ratio', 'tuck'],   // explain: rule kime.param
    manyMin: 3, manyShare: 0.15,            // UI guideline: max(3, ceil(0.15 · lyric lines))
  });

  // The cuts right before a キメ cut (level 2: the one right before, level 1: the one before that), within `span` s of
  // its start: fewer decorations and effects, softer motion, a quiet shot, slightly smaller text.
  const CALM = deepFreeze({
    cuts: 2, span: 4,
    ornMax: [Infinity, 1, 0], filterMax: [Infinity, 1, 0],   // by level
    strong: [1, 0.5, 0.15], soft: [1, 1.5, 2.5],              // chooser factors by level
    scale: [1, 0.97, 0.94],
    lensDeny: ['shake', 'beat'],                              // level 2
    shots: ['none', 'settle', 'driftOff', 'wideHold'],        // level 2
    xstrong: 0.2,                                             // level 2: EXTREME presets tagged hard or fast
    kinds: ['arrive', 'dwell', 'depart', 'lens'],             // the part kinds the chooser factor applies to
  });
  const STRONG_TAGS = Object.freeze(['fast', 'hard', 'bold', 'busy']);
  const SOFT_TAGS = Object.freeze(['soft', 'slow', 'minimal', 'airy']);
  const CALM_KINDS = new Set(CALM.kinds);

  // isKime(cut) → whether a cut is the キメ cut of a キメ line: the skeleton flag during stages 3–6 (planner/segment),
  // feat.kime on a Plan cut. The one way other packages ask (a long line's pin does not make every piece キメ).
  function isKime(cut) { return !!cut && (cut.kime === true || !!(cut.feat && cut.feat.kime)); }

  // calmLevels(cuts) → [0 | 1 | 2] per cut, or null when no cut is キメ. A level lands only on lyric cuts (not across a
  // special cut) that start within CALM.span s before the キメ cut's start; a キメ cut is never calmed, so two キメ
  // lines in a row both stay bold. (The caller skips it when 「キメの前を静かにする」 is off.)
  function calmLevels(cuts) {
    if (!cuts.some(isKime)) return null;
    const out = new Array(cuts.length).fill(0);
    for (let j = 0; j < cuts.length; j++) {
      const k = cuts[j];
      if (!isKime(k)) continue;
      for (let i = j - 1; i >= 0 && j - i <= CALM.cuts; i--) {
        const c = cuts[i];
        if (isKime(c) || !c.line || k.t0 - c.t0 > CALM.span) break;
        out[i] = Math.max(out[i], j - i === 1 ? 2 : 1);
      }
    }
    return out;
  }

  // calmFactor(def, traits, level) → the chooser factor of a candidate on a calm cut: strong parts (made for impacts,
  // or a tag in STRONG_TAGS) down, soft ones (a tag in SOFT_TAGS) up; both or neither: 1.
  function calmFactor(def, traits, level) {
    if (!level) return 1;
    const tags = (def && def.tags) || [];
    const strong = !!(traits && traits.impact) || tags.some((t) => STRONG_TAGS.includes(t));
    const soft = tags.some((t) => SOFT_TAGS.includes(t));
    return strong && !soft ? CALM.strong[level] : soft && !strong ? CALM.soft[level] : 1;
  }

  // Whether the chooser factor applies to a part kind.
  function calmKind(kind) { return CALM_KINDS.has(kind); }

  // shotFor(emph, allowed) → the shot of a キメ cut: the first of KIME.shots (emph or plain) the cut's pool allows
  // (allowed(key) → bool), else 'none'.
  function shotFor(emph, allowed) {
    for (const key of emph ? KIME.shots.emph : KIME.shots.plain) if (allowed(key)) return key;
    return 'none';
  }

  // xshotFor(pool) → the EXTREME preset of a キメ cut: the first of KIME.xshots in the cut's EXTREME pool, or null.
  function xshotFor(pool) {
    if (!pool) return null;
    for (const key of KIME.xshots) if (pool.includes(key)) return key;
    return null;
  }

  // guideline(lyricLines) → how many キメ lines a work should have at most (the UI hint; no Plan warning).
  function guideline(lyricLines) { return Math.max(KIME.manyMin, Math.ceil(KIME.manyShare * Math.max(0, lyricLines || 0))); }

  // hold(room) → how long a キメ cut stays into a following interlude or outro of `room` s: up to KIME.tail, and the
  // special cut keeps ≥ KIME.keep s.
  function hold(room) { return N.clamp(Math.min(KIME.tail, room - KIME.keep), 0, KIME.tail); }

  // landEach(each, dur, units, max) → the stagger of a キメ entrance: at most `max` and small enough that the whole line
  // lands within KIME.landBy (dur + (units − 1) · each), floored to the 0.005 s step.
  function landEach(each, dur, units, max) {
    let x = Math.min(each, max);
    if (units > 1) x = Math.min(x, Math.max(0, KIME.landBy - dur) / (units - 1));
    return Math.floor(x * 200 + 1e-9) / 200;
  }

  return { KIME, CALM, STRONG_TAGS, SOFT_TAGS, isKime, calmLevels, calmFactor, calmKind, shotFor, xshotFor, guideline,
    hold, landEach };
});
