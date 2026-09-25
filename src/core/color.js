/* 文字PVメーカー v2 — original work. Hex colors: parsing, OKLab mixing, WCAG contrast and cached rgba() strings (DESIGN §4.1.4). */
MV.def('core/color', ['core/num'], (N) => {
  'use strict';

  const TOKENS = Object.freeze(['ground', 'ground2', 'ink', 'accent', 'shiftA', 'shiftB', 'muted']);
  const HEX = /^#[0-9A-Fa-f]{6}$/;
  const RGBA_CACHE_MAX = 1024;               // distinct hex colors kept; the cache is cleared when it overflows
  const rgbaCache = new Map();

  class ColorError extends Error {
    constructor(code, message) { super(message); this.name = 'ColorError'; this.code = code; }
  }

  function isHex(v) { return typeof v === 'string' && HEX.test(v); }

  function parse(hex) {
    if (!isHex(hex)) throw new ColorError('bad-color', 'expected #RRGGBB, got ' + hex);
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16),
    };
  }

  function byteHex(v) {
    const n = Math.round(N.clamp(v, 0, 255));
    return (n < 16 ? '0' : '') + n.toString(16).toUpperCase();
  }

  function toHex({ r, g, b }) { return '#' + byteHex(r) + byteHex(g) + byteHex(b); }

  function upper(hex) { parse(hex); return hex.toUpperCase(); }

  // 'rgba(r,g,b,a)' with a quantized to 1/64. Strings are cached per (hex, step), so a hit allocates nothing.
  function rgba(hex, a) {
    const step = a >= 1 ? 64 : a > 0 ? Math.round(a * 64) : 0;
    let row = rgbaCache.get(hex);
    if (row === undefined) {
      const c = parse(hex);
      if (rgbaCache.size >= RGBA_CACHE_MAX) rgbaCache.clear();
      row = { prefix: 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',', out: new Array(65).fill(null) };
      rgbaCache.set(hex, row);
    }
    return row.out[step] || (row.out[step] = row.prefix + step / 64 + ')');
  }

  // --- sRGB ↔ linear ↔ OKLab -------------------------------------------------------------------------------

  function toLinear(c8) {
    const c = c8 / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function fromLinear(c) {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return v * 255;
  }

  function toLab(hex) {
    const c = parse(hex);
    const r = toLinear(c.r), g = toLinear(c.g), b = toLinear(c.b);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    const grey = Math.abs(A) < 1e-6 && Math.abs(B) < 1e-6;    // keep greys exactly neutral when L moves
    return { L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, a: grey ? 0 : A, b: grey ? 0 : B };
  }

  function fromLab(L, A, B) {
    const l = cube(L + 0.3963377774 * A + 0.2158037573 * B);
    const m = cube(L - 0.1055613458 * A - 0.0638541728 * B);
    const s = cube(L - 0.0894841775 * A - 1.2914855480 * B);
    return toHex({
      r: fromLinear(N.clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
      g: fromLinear(N.clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
      b: fromLinear(N.clamp(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)),
    });
  }

  function cube(x) { return x * x * x; }

  // Perceptual mix in OKLab; t is clamped to [0, 1] and the ends return the inputs exactly (uppercased).
  function mix(a, b, t) {
    if (!(t > 0)) return upper(a);
    if (t >= 1) return upper(b);
    const p = toLab(a), q = toLab(b);
    return fromLab(N.lerp(p.L, q.L, t), N.lerp(p.a, q.a, t), N.lerp(p.b, q.b, t));
  }

  // Toward black by k ∈ [0, 1] (an OKLab mix with #000000).
  function shade(hex, k) { return mix(hex, '#000000', k); }

  // --- contrast ----------------------------------------------------------------------------------------------

  // WCAG 2 relative luminance.
  function luminance(hex) {
    const c = parse(hex);
    return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
  }

  function contrast(a, b) {
    const la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  // Moves fg's OKLab lightness (hue and chroma kept) by the smallest amount that reaches contrast ≥ min against bg.
  // Tries darker and lighter; if neither end reaches min, returns the end with the higher contrast.
  function fitContrast(fg, bg, min) {
    const start = upper(fg);
    if (contrast(start, bg) >= min) return start;
    const lab = toLab(start);
    const dark = searchL(lab, 0, bg, min), light = searchL(lab, 1, bg, min);
    if (dark.ok && light.ok) return dark.dL <= light.dL ? dark.hex : light.hex;
    if (dark.ok) return dark.hex;
    if (light.ok) return light.hex;
    return dark.c >= light.c ? dark.hex : light.hex;
  }

  function searchL(lab, target, bg, min) {
    const end = fromLab(target, lab.a, lab.b);
    const endC = contrast(end, bg);
    if (endC < min) return { ok: false, hex: end, c: endC, dL: Math.abs(target - lab.L) };
    let fail = lab.L, pass = target;
    for (let i = 0; i < 32; i++) {
      const mid = (fail + pass) / 2;
      if (contrast(fromLab(mid, lab.a, lab.b), bg) >= min) pass = mid; else fail = mid;
    }
    return { ok: true, hex: fromLab(pass, lab.a, lab.b), c: min, dL: Math.abs(pass - lab.L) };
  }

  // Euclidean distance of two colours in OKLab: how strongly a pattern of the two reads (≈ 0.02 barely seen, 0.1 bold).
  // A contrast ratio misses a saturated colour on a ground of its own lightness; this does not.
  function distance(x, y) {
    const p = toLab(x), q = toLab(y);
    return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
  }

  // --- hue -----------------------------------------------------------------------------------------------------

  // HSL hue in degrees, [0, 360); 0 for greys.
  function hueDeg(hex) {
    const { r, g, b } = parse(hex);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return N.wrap(h * 60, 0, 360);
  }

  // Shortest angle between two hues, in [0, 180].
  function hueDistance(a, b) {
    const d = Math.abs(hueDeg(a) - hueDeg(b)) % 360;
    return d > 180 ? 360 - d : d;
  }

  return { TOKENS, isHex, parse, toHex, rgba, mix, luminance, contrast, fitContrast, distance, shade, hueDeg, hueDistance };
});
