/* 文字PVメーカー v2 — original work. Cut features: text size, script, timing, energy, beat, section, repeats (DESIGN §4.16.7). */
MV.def('planner/features', ['core/script', 'core/num', 'engine/text/breaker', 'engine/text/vert'], (S, N, BR, V) => {
  'use strict';

  const VERTICAL_SCRIPTS = new Set(['ja', 'zhHant', 'zhHans']);
  const MAX_VERTICAL_LATIN = 12;       // 'v' is allowed only while the longest Latin run is ≤ 12 graphemes
  const ON_BEAT = 0.06;
  const LATIN_CLASSES = new Set(['latin', 'digit', 'fullLatin']);
  // Section names from '#' headings (§4.16.7: 'サビ'/'chorus' → 'chorus'); first match wins, so 大サビ is a chorus.
  const HEADING_SECTIONS = [
    [/pre-?chorus|bメロ|b melo/i, 'prechorus'],
    [/サビ|chorus|hook|refrain/i, 'chorus'],
    [/aメロ|verse|a melo|[0-9]番/i, 'verse'],
    [/cメロ|ブリッジ|bridge|dメロ/i, 'bridge'],
    [/間奏|interlude|instrumental/i, 'interlude'],
    [/ソロ|solo/i, 'solo'],
    [/イントロ|intro/i, 'intro'],
    [/アウトロ|outro|ending|エンディング/i, 'outro'],
  ];

  function r3(x) { return Math.round(x * 1000) / 1000; }

  function sectionOfHeading(heading) {
    if (!heading) return null;
    for (const [re, kind] of HEADING_SECTIONS) if (re.test(heading)) return kind;
    return null;
  }

  // The song.info section kind at time t, or null.
  function songSection(info, t) {
    const list = info && Array.isArray(info.sections) ? info.sections : null;
    if (!list) return null;
    for (const s of list) {
      if (s && typeof s.start === 'number' && typeof s.end === 'number' && t >= s.start && t < s.end) {
        return typeof s.kind === 'string' ? s.kind : null;
      }
    }
    return null;
  }

  // Loudness statistics for energy percentiles: the envelope and its sorted copy (made once per digest).
  const sortedCache = new WeakMap();
  function sortedLevels(env) {
    let s = sortedCache.get(env);
    if (!s) { s = Float32Array.from(env.loud).sort(); sortedCache.set(env, s); }
    return s;
  }

  // Mean digest level over [t0, t1] (samples whose centre lies inside; the middle sample for very short spans).
  function meanLevel(env, t0, t1) {
    const hz = env.hz, loud = env.loud, n = loud.length;
    if (n === 0) return 0;
    let a = Math.ceil(t0 * hz - 0.5), b = Math.floor(t1 * hz - 0.5);
    a = Math.max(0, a); b = Math.min(n - 1, b);
    if (b < a) {
      const i = Math.min(n - 1, Math.max(0, Math.round(((t0 + t1) / 2) * hz - 0.5)));
      return loud[i];
    }
    let sum = 0;
    for (let i = a; i <= b; i++) sum += loud[i];
    return sum / (b - a + 1);
  }

  // Share of song samples at or below x (upper bound by binary search).
  function percentile(sorted, x) {
    let lo = 0, hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sorted[mid] <= x) lo = mid + 1; else hi = mid;
    }
    return sorted.length ? lo / sorted.length : 0.5;
  }

  function latinShare(gs) {
    let content = 0, latin = 0;
    for (const g of gs) {
      const cls = S.charClass(g);
      if (cls === 'space') continue;
      content++;
      if (LATIN_CLASSES.has(cls)) latin++;
    }
    return content ? latin / content : 0;
  }

  function orientsOf(text, script) {
    return VERTICAL_SCRIPTS.has(script) && V.longestLatinRun(text) <= MAX_VERTICAL_LATIN ? ['h', 'v'] : ['h'];
  }

  // cutFeatures(cut, fx) → CutFeatures (§4.16.7). cut = { key, role, text, emph, impact, t0, t1, lang };
  // fx = { duration, env|null, grid|null, info (song.info)|null, section (heading-derived)|null, repeatOf, repeats }.
  function cutFeatures(cut, fx) {
    const text = cut.text;
    const gs = S.graphemes(text);
    const glyphs = gs.filter((g) => S.charClass(g) !== 'space').length;
    const script = cut.lang;
    const words = text ? BR.words(text, script).length : 0;
    const cells = S.cells(text);
    const dur = Math.max(1e-6, cut.t1 - cut.t0);
    // Place in the song to 1/100: the resolution parts read it at (Math.round(pos·100)), and coarse enough that a
    // cut moved a little by an edit elsewhere keeps its features, so its cast is reused (planner/plan featuresOf).
    const pos = fx.duration > 0 ? Math.round(N.clamp(cut.t0 / fx.duration) * 100) / 100 : 0;
    let energy;
    if (fx.env && fx.env.loud.length) energy = percentile(sortedLevels(fx.env), meanLevel(fx.env, cut.t0, cut.t1));
    else energy = 0.35 + 0.4 * (fx.repeats ? 1 : 0) + 0.15 * (cut.impact ? 1 : 0) + 0.1 * Math.sin(Math.PI * pos);
    const beat = fx.grid ? fx.grid.period : 0;
    let onBeat = false;
    if (fx.grid) {
      const b = fx.grid.beatAt(cut.t0);
      onBeat = Math.min(b.since, fx.grid.period - b.since) < ON_BEAT;
    }
    // Keys in sorted order, so the Plan encoder can print the object natively (planner/encode asIs).
    return {
      beat: beat ? r3(beat) : 0, cells, cps: r3(cells / dur), dur: r3(dur), emph: cut.emph.length > 0,
      energy: r3(N.clamp(energy)), graphemes: gs.length, impact: !!cut.impact, latin: r3(latinShare(gs)), onBeat,
      orients: orientsOf(text, script), pos, repeatOf: fx.repeatOf || null, role: cut.role, script,
      section: songSection(fx.info, cut.t0) || fx.section || null, units: { glyph: glyphs, line: 1, word: words }, words,
    };
  }

  return { cutFeatures, sectionOfHeading, songSection, meanLevel, percentile, orientsOf };
});
