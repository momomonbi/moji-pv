/* 文字PVメーカー v2 — original work. Easing curves by name, their time-reversed names and cubic Béziers (DESIGN §4.1.4). */
MV.def('core/ease', [], () => {
  'use strict';

  const EASES = Object.freeze(['linear', 'sineIn', 'sineOut', 'sineInOut', 'quadIn', 'quadOut', 'quadInOut',
    'cubicIn', 'cubicOut', 'cubicInOut', 'expoIn', 'expoOut', 'expoInOut', 'backIn', 'backOut', 'backInOut',
    'elasticOut', 'bounceOut', 'springOut', 'steps']);

  class EaseError extends Error {
    constructor(code, message) { super(message); this.name = 'EaseError'; this.code = code; }
  }

  const HALF_PI = Math.PI / 2;
  const BACK = 1.70158;
  const BACK_IO = BACK * 1.525;
  const ELASTIC = (2 * Math.PI) / 3;
  const SPRING_K = 6;                         // damping per unit time
  const SPRING_W = 3 * Math.PI;               // 1.5 oscillations over the curve
  const SPRING_NORM = 1 - Math.exp(-SPRING_K) * Math.cos(SPRING_W);

  function bounce(u) {
    const n = 7.5625, d = 2.75;
    if (u < 1 / d) return n * u * u;
    if (u < 2 / d) { const v = u - 1.5 / d; return n * v * v + 0.75; }
    if (u < 2.5 / d) { const v = u - 2.25 / d; return n * v * v + 0.9375; }
    const v = u - 2.625 / d;
    return n * v * v + 0.984375;
  }

  // Raw curves on the open interval (0, 1); pinned() below makes f(0) = 0 and f(1) = 1 exact.
  const RAW = {
    linear: (u) => u,
    sineIn: (u) => 1 - Math.cos(u * HALF_PI),
    sineOut: (u) => Math.sin(u * HALF_PI),
    sineInOut: (u) => (1 - Math.cos(Math.PI * u)) / 2,
    quadIn: (u) => u * u,
    quadOut: (u) => 1 - (1 - u) * (1 - u),
    quadInOut: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)),
    cubicIn: (u) => u * u * u,
    cubicOut: (u) => 1 - (1 - u) * (1 - u) * (1 - u),
    cubicInOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - 4 * (1 - u) * (1 - u) * (1 - u)),
    expoIn: (u) => Math.pow(2, 10 * u - 10),
    expoOut: (u) => 1 - Math.pow(2, -10 * u),
    expoInOut: (u) => (u < 0.5 ? Math.pow(2, 20 * u - 10) / 2 : (2 - Math.pow(2, -20 * u + 10)) / 2),
    backIn: (u) => (BACK + 1) * u * u * u - BACK * u * u,
    backOut: (u) => { const v = u - 1; return 1 + (BACK + 1) * v * v * v + BACK * v * v; },
    backInOut: (u) => (u < 0.5
      ? (Math.pow(2 * u, 2) * ((BACK_IO + 1) * 2 * u - BACK_IO)) / 2
      : (Math.pow(2 * u - 2, 2) * ((BACK_IO + 1) * (2 * u - 2) + BACK_IO) + 2) / 2),
    elasticOut: (u) => Math.pow(2, -10 * u) * Math.sin((10 * u - 0.75) * ELASTIC) + 1,
    bounceOut: bounce,
    springOut: (u) => (1 - Math.exp(-SPRING_K * u) * Math.cos(SPRING_W * u)) / SPRING_NORM,
    steps: (u) => Math.floor(u * 8) / 8,
  };

  function pinned(f) { return (u) => (u <= 0 ? 0 : u >= 1 ? 1 : f(u)); }

  const TABLE = new Map(EASES.map((name) => [name, pinned(RAW[name])]));

  function get(name) {
    const f = TABLE.get(name);
    if (!f) throw new EaseError('bad-ease', 'unknown ease ' + name);
    return f;
  }

  // Time reversal: reverse(n) names the curve g(u) = 1 − f(1 − u). The list has no In form of elasticOut,
  // bounceOut and springOut, so those map to the nearest listed curve with the same start (see docs/NOTES.md).
  const REVERSE = {
    elasticOut: 'backIn',
    springOut: 'backIn',
    bounceOut: 'quadIn',
  };

  function reverse(name) {
    get(name);
    if (REVERSE[name]) return REVERSE[name];
    if (name.endsWith('InOut')) return name;
    if (name.endsWith('In')) return name.slice(0, -2) + 'Out';
    if (name.endsWith('Out')) return name.slice(0, -3) + 'In';
    return name;                              // linear, steps
  }

  // CSS-style cubic Bézier from (0,0) to (1,1) with control points (x1,y1), (x2,y2); x1 and x2 are clamped to [0, 1]
  // so x(s) is monotonic. Solves x(s) = u by Newton steps with a bisection fallback to 1e-6.
  function bezier(x1, y1, x2, y2) {
    const ax1 = Math.min(1, Math.max(0, x1)), ax2 = Math.min(1, Math.max(0, x2));
    const cx = 3 * ax1, bx = 3 * (ax2 - ax1) - cx, axx = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ayy = 1 - cy - by;
    const xAt = (s) => ((axx * s + bx) * s + cx) * s;
    const yAt = (s) => ((ayy * s + by) * s + cy) * s;
    const dxAt = (s) => (3 * axx * s + 2 * bx) * s + cx;
    function solve(u) {
      let s = u;
      for (let i = 0; i < 8; i++) {
        const err = xAt(s) - u;
        if (Math.abs(err) < 1e-7) return s;
        const d = dxAt(s);
        if (Math.abs(d) < 1e-6) break;
        s -= err / d;
        if (s < 0 || s > 1) break;
      }
      let lo = 0, hi = 1;
      s = u;
      for (let i = 0; i < 60; i++) {
        const x = xAt(s);
        if (Math.abs(x - u) < 1e-7) break;
        if (x < u) lo = s; else hi = s;
        s = (lo + hi) / 2;
      }
      return s;
    }
    return (u) => (u <= 0 ? 0 : u >= 1 ? 1 : yAt(solve(u)));
  }

  return { EASES, get, reverse, bezier };
});
