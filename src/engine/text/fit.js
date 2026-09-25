/* 文字PVメーカー v2 — original work. Deterministic text fitting and the overfull fallback (DESIGN §4.15.6). */
MV.def('engine/text/fit', [], () => {
  'use strict';

  const MIN_ABS = 18;          // du: minSize = max(18, 0.35 · size)
  const MIN_SHARE = 0.35;
  const BELOW_MIN = 0.6;       // step 3 may go down to 0.6 · minSize
  const STEPS = 30;            // bisection steps: the result is within size · 2⁻³⁰ of the largest fitting size

  // The step-1 floor. A run asked for below 18 du keeps its own size as the floor (it never grows).
  function minSizeOf(size) { return Math.min(size, Math.max(MIN_ABS, MIN_SHARE * size)); }

  // Largest s in [lo, hi] with fits(s), or null when even lo does not fit. `fits` must be monotone (fits at s ⇒ fits
  // at every smaller s); the layout's greedy breaking makes it so. The search interval depends only on lo and hi, so a
  // larger box (fits more often) never gives a smaller answer.
  function largestFitting(lo, hi, fits) {
    if (!(hi > 0)) return null;
    if (fits(hi)) return hi;
    if (!(lo < hi) || !fits(lo)) return null;
    let a = lo, b = hi;
    for (let i = 0; i < STEPS; i++) {
      const mid = (a + b) / 2;
      if (fits(mid)) a = mid; else b = mid;
    }
    return a;
  }

  // fitSize(spec, fits) → { size, breakAt, maxLines, step, overfull }
  //   spec: { size, fit: 'shrink'|'none', breakAt, maxLines }; fits(size, { breakAt, maxLines }) → boolean.
  //   step 0: fits as asked · 1: shrunk, not below minSize, with the spec's breaking · 2: does not fit at minSize, but
  //   does at minSize once re-broken by character with one more line · 3: that re-broken text shrunk below minSize,
  //   down to 0.6 · minSize · 4: still too big: overfull at 0.6 · minSize (the scene clips the run to its box and
  //   warns `overfull`). Step 1 is the exact limit of §4.15.6's analytic shrink-and-re-break loop: the largest size at
  //   which the re-broken text fits. Sizes fall step by step (step 1 ≥ minSize = step 2 > step 3 ≥ step 4), and a
  //   larger box never needs a later step, so the result is monotone in the box.
  function fitSize(spec, fits) {
    const size = spec.size;
    const base = { breakAt: spec.breakAt, maxLines: spec.maxLines };
    if (spec.fit === 'none' || fits(size, base)) return { size, ...base, step: 0, overfull: false };
    const minSize = minSizeOf(size);
    const s = largestFitting(minSize, size, (x) => fits(x, base));
    if (s !== null) return { size: s, ...base, step: 1, overfull: false };
    const loose = { breakAt: 'char', maxLines: base.maxLines + 1 };
    if (fits(minSize, loose)) return { size: minSize, ...loose, step: 2, overfull: false };
    const floor = BELOW_MIN * minSize;
    const t = largestFitting(floor, minSize, (x) => fits(x, loose));
    if (t !== null) return { size: t, ...loose, step: 3, overfull: false };
    return { size: floor, ...loose, step: 4, overfull: true };
  }

  return { fitSize, largestFitting, minSizeOf, MIN_ABS, MIN_SHARE, BELOW_MIN };
});
