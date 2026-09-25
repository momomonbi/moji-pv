/* 文字PVメーカー v2 — original work. Deterministic stand-in measurer for Node tests and golden frames (DESIGN §4.15.1). */
MV.def('engine/text/fake_measure', ['core/script', 'engine/text/faces'], (S, FACES) => {
  'use strict';

  // Advance widths at 100 px, per grapheme (§4.15.1): wide CJK/hangul/fullwidth 100, halfwidth kana 50,
  // Latin letter 56 (M/W 80, i/l/j 28), digit 56, space 30, anything else 60. Font-level ascent 88, descent 12.
  const BASE = 100;
  const WIDE = new Set(['han', 'hira', 'kata', 'smallKana', 'hangul', 'fullLatin', 'punctJa', 'emoji']);
  const WIDE_LETTERS = new Set(['M', 'W']);
  const NARROW_LETTERS = new Set(['i', 'l', 'j']);

  function graphemeWidth(g) {
    const cls = S.charClass(g);
    if (cls === 'latin') return WIDE_LETTERS.has(g) ? 80 : NARROW_LETTERS.has(g) ? 28 : 56;
    if (cls === 'digit') return 56;
    if (cls === 'space') return g === '\u3000' ? 100 : 30;
    const cells = S.cells(g);
    if (cells === 0.5) return 50;                           // halfwidth kana and other halfwidth forms
    if (WIDE.has(cls) || cells === 1) return 100;
    return 60;
  }

  function fakeMeasurer() {
    const cache = new Map();                              // grapheme → width at 100 px
    function unitWidth(g) {
      let w = cache.get(g);
      if (w === undefined) { w = graphemeWidth(g); cache.set(g, w); }
      return w;
    }
    function width(css, str) {
      const gs = S.graphemes(String(str));
      let sum = 0;
      for (let i = 0; i < gs.length; i++) sum += unitWidth(gs[i]);
      return (sum * FACES.cssSize(css)) / BASE;
    }
    function metrics(css) {
      const k = FACES.cssSize(css) / BASE;
      return { ascent: 88 * k, descent: 12 * k };
    }
    return { key: 'fake', width, metrics };
  }

  return { fakeMeasurer, graphemeWidth };
});
