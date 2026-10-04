/* 文字PVメーカー v2 — original work. Interlude effects: light motes, sound horizon, kinetic shapes (textless compositions for interlude cuts). */
MV.def('parts/arrange/interlude', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, lerp, smooth, fract, wrap, TAU, DEG, noise1 } = K.math;
  const L = (ja, en) => ({ ja, en });
  const CUBIC_IN = K.ease('cubicIn');
  const CUBIC_OUT = K.ease('cubicOut');
  const CUBIC_IN_OUT = K.ease('cubicInOut');
  const EXPO_OUT = K.ease('expoOut');
  const EXPO_IN_OUT = K.ease('expoInOut');
  const BACK_OUT = K.ease('backOut');
  const KEY_GREEN = '#00B140';       // the green-screen key, the ground of a chroma palette (§4.19.4)
  const HZ = 20;                     // loudness samples per second (the digest's rate)
  const NO_DASH = Object.freeze([]);
  const SEED_MAX = 2147483646;
  const MOTE_BUCKETS = 12;           // alpha steps of the mote cores (one path each)
  const BAR_BUCKETS = 8;             // … and of the horizon bars
  const MAX_GLINTS = 6;
  const MAX_RIPPLES = 6;
  const MAX_EVENTS = 64;             // glint events of the motes (three stars each at most)
  const MAX_RINGS = 46;              // ripple events of the horizon between its opening and its handover ring

  // Every interlude effect draws on far and mid only (never near, which a text seam mixes), fades itself in and out,
  // makes no text run, owns no motion (lyric neighbours keep their entrances and exits) and asks for a gentle shot,
  // which a glyph-free cut leaves inert. Params never reach the seed, so a slider keeps the layout.

  // --- the shared scaffold: window, handover, palette, seed ---------------------------------------------------------

  // The cut window (copied: env.times is refitted after the build), the entrance from s0 over E, the climax h (the
  // gather, the fold and the glow land there; everything is gone 0.3 s after h − 0.1), the lead-out from o over Xo, and
  // the centre C (paints skip the root shift, so it is added here). Both ends follow 全体›タイミング, read from what the
  // cut fingerprint holds: the line before stays for the tail after t0 (b − dur, 0.25 by default; to 0.01 s, as dur is
  // rounded to ms), so s0 is 0.1 s before its end and never before 0.15; the next line's cut opens the lead before it is
  // sung (−a, 0.12 by default; to the plan's µs), so h is 0.25 s before the line, or 0.13 s before that cut opens when
  // it leads in earlier (the effect is gone 0.07 s after it opens). A seam that ends b early hides the tail: s0 then
  // stays at 0.15. The entrance and the lead-out share what is left between s0 and h (at most 0.45 and 0.5 of it), so
  // a long tail in a short interlude never squeezes the lead-out to a snap. The defaults give exactly 0.15 and
  // dur − 0.25, and the spans of before.
  function frameOf(env, p) {
    const { D, feat, cut } = env, T = env.times;
    const a = T.a, b = T.b, W = b - a, s = D.short;
    const dur = Number.isFinite(feat && feat.dur) ? feat.dur : b - 0.25;
    const lead = Math.round(-1e6 * a) / 1e6, tail = Math.round(100 * (b - dur)) / 100;
    const s0 = Math.max(a, 0.15, tail - 0.1);
    const h = clamp(dur - Math.max(0.25, lead + 0.13), a + 0.5 * W, b - 0.35);
    const span = Math.max(0.1, h - s0);   // a long tail in a short interlude still leaves the lead-out its share
    const E = Math.min(clamp(0.16 * W, 0.45, 0.8), 0.3 * W, 0.45 * span);
    const X = Math.min(clamp(0.22 * W, 0.6, 1), 0.35 * W, 0.5 * span);
    const o = Math.max(s0 + E, h - X);
    const motion = env.amounts && Number.isFinite(env.amounts.motion) ? env.amounts.motion : 0.5;
    return { a, b, W, s, s0, h, E, X, o, Xo: Math.max(0.05, h - o), hEnd: h - 0.1, endSpan: 0.3,
      lift: /サビ|chorus|hook/i.test((cut && cut.note) || '') ? 1.25 : 1, spd: 0.75 + 0.5 * motion,
      cx: D.cx + (p.offsetX || 0) * D.w, cy: D.cy + (p.offsetY || 0) * D.h };
  }

  // In over E from s0, out over 0.3 s from h − 0.1: nothing is drawn before s0 or from 0.05 s before the next line on
  // (far and mid are not seam-mixed).
  function envelopeOf(d, t) {
    return smooth((t - d.s0) / d.E) * (1 - smooth((t - d.hEnd) / d.endSpan));
  }

  // The lead-out (0 → 1 over [o, h]) and the handover glow (up just before h, gone 0.3 s after it).
  function outOf(d, t) { return smooth((t - d.o) / d.Xo); }
  function glowOf(d, t) { return smooth((t - (d.h - 0.45 * d.Xo)) / (0.4 * d.Xo)) * (1 - smooth((t - (d.h - 0.05)) / 0.3)); }

  function rgbOf(hex) {
    const n = parseInt(String(hex).slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function lum(hex) {
    const c = rgbOf(hex);
    return 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
  }

  // Tokens only (the draw-time palette remaps them for the black backdrop); light adds up ('lighter') only on a dark
  // ground that is not the key green, whose shifts are never trusted either.
  function inksOf(pal) {
    const chroma = String(pal.ground).toUpperCase() === KEY_GREEN;
    const light = chroma ? lum(pal.ink) < 128 : lum(pal.ground) > lum(pal.ink);
    return { chroma, light, add: !light && !chroma, two: chroma ? 'ink' : 'shiftA' };
  }

  // env.rng holds the slot, the key and the (blank) text; pos, dur and the heading are in the cut fingerprint, so two
  // interludes of one song never share a layout.
  function seedOf(env) {
    const f = env.feat || {};
    return env.rng.fork('interlude', Math.round(100 * (f.pos || 0)), Math.round(100 * (f.dur || 0)), String((env.cut && env.cut.note) || ''));
  }

  function data(fr, extra) { return Object.assign({}, fr, extra); }

  function finish(env, fr, w, h) {
    const focus = { x: fr.cx - w / 2, y: fr.cy - h / 2, w, h };
    return { runs: [], focus, free: env.sb.freeAround(focus) };
  }

  // --- music: beats, loudness, aperiodic events ---------------------------------------------------------------------

  // Beats in [lo, hi) at least minGap apart (every step-th beat of the bar count), with their downbeat flags and the
  // time between them (gap); empty without a grid. At most `cap` (128): a long interlude is thinned, never cut short,
  // to a larger step that still keeps every downbeat (a divisor or a multiple of the meter).
  function beatList(env, lo, hi, minGap, cap) {
    const g = env.grid, t = [], down = [], max = cap || 128;
    let step = 1;
    if (g && hi > lo) {
      step = Math.max(1, Math.ceil(minGap / g.period - 1e-9));
      const xs = g.beatsIn(lo, hi), idx = xs.map((x) => g.beatAt(x + 1e-6).index);
      const count = (k) => idx.reduce((n, i) => n + (((i % k) + k) % k === 0 ? 1 : 0), 0);
      while (count(step) > max) {
        const m = g.meter;
        let next = step + 1;
        while (m % next !== 0 && next % m !== 0) next++;
        step = next;
      }
      for (let i = 0; i < xs.length; i++) {
        if (((idx[i] % step) + step) % step !== 0) continue;
        t.push(xs[i]);
        down.push(((idx[i] % g.meter) + g.meter) % g.meter === 0 ? 1 : 0);
      }
    }
    return { t: Float32Array.from(t), down: Uint8Array.from(down), gap: g ? step * g.period : 0 };
  }

  function percentile(sorted, q) {
    if (!sorted.length) return 0;
    const x = clamp(q, 0, 1) * (sorted.length - 1), i = Math.floor(x), j = Math.min(i + 1, sorted.length - 1);
    return sorted[i] + (sorted[j] - sorted[i]) * (x - i);
  }

  // The loudness from L0 to b at 20 Hz. A song is there when it moves at least 0.03 inside the window (no song reads a
  // flat 0.5, past its end a flat 0): then a fast-attack, slow-release follower, normalised to the window (p10…p97),
  // and its ±0.8 s mean (the swell). Without one the parts use a slow, aperiodic synthetic line (never a tempo).
  function levelTrack(env, r, L0) {
    const T = env.times, n = Math.ceil((T.b - L0) * HZ) + 2;
    const n1 = r.int(1, SEED_MAX), n2 = r.int(1, SEED_MAX);
    const raw = new Float32Array(n);
    for (let i = 0; i < n; i++) raw[i] = env.level(L0 + i / HZ);
    const ia = Math.max(0, Math.ceil((T.a - L0) * HZ)), ib = Math.min(n - 1, Math.floor((T.b - L0) * HZ));
    let mn = Infinity, mx = -Infinity;
    for (let i = ia; i <= ib; i++) { if (raw[i] < mn) mn = raw[i]; if (raw[i] > mx) mx = raw[i]; }
    if (!(mx - mn >= 0.03)) return { song: false, L0, lv: null, sw: null, n1, n2 };
    const f = new Float32Array(n);
    f[0] = raw[0];
    for (let i = 1; i < n; i++) f[i] = f[i - 1] + (raw[i] - f[i - 1]) * (raw[i] > f[i - 1] ? 0.75 : 0.18);
    const win = Array.from(f.subarray(ia, ib + 1)).sort((x, y) => x - y);
    const lo = percentile(win, 0.1), hi = percentile(win, 0.97);
    const lv = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = Math.pow(clamp((f[i] - lo) / Math.max(hi - lo, 0.08)), 1.25);
      lv[i] = hi - lo < 0.03 ? 0.55 + 0.25 * v : v;
    }
    const sum = new Float64Array(n + 1), sw = new Float32Array(n);
    for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + lv[i];
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 16), i1 = Math.min(n, i + 17);
      sw[i] = (sum[i1] - sum[i0]) / (i1 - i0);
    }
    return { song: true, L0, lv, sw, n1, n2 };
  }

  // A sampled track at local time t (linear, clamped at both ends).
  function sampleAt(arr, L0, t) {
    const x = clamp((t - L0) * HZ, 0, arr.length - 1), i = Math.floor(x), j = i + 1 < arr.length ? i + 1 : i;
    return arr[i] + (arr[j] - arr[i]) * (x - i);
  }

  function levelAt(d, t) {
    return d.song ? sampleAt(d.lv, d.L0, t) : 0.3 + 0.35 * noise1(d.n1, 0.5 * t) * (0.6 + 0.4 * noise1(d.n2, 0.13 * t));
  }

  function swellAt(d, t) { return d.song ? sampleAt(d.sw, d.L0, t) : 0.5; }

  // --- 表現の強さ: how much the effect does, over the interlude ------------------------------------------------------

  // The `shape` param: 'auto', or five strengths 0…1 at the start, ¼, ½, ¾ and the end of the interlude (from the
  // entrance to the climax), as the 表現の強さ graph writes them ('0.2,0.5,0.9,0.6,0.3'). Anything else reads as auto.
  const SHAPE_POINTS = 5;
  const SHAPE_PARAM = Object.freeze({ type: 'text', max: 60, label: L('表現の強さ', 'Strength over time'), auto: { value: 'auto' } });

  function shapeOf(v) {
    if (typeof v !== 'string') return null;
    const xs = v.split(',');
    if (xs.length !== SHAPE_POINTS) return null;
    const out = new Float32Array(SHAPE_POINTS);
    for (let i = 0; i < SHAPE_POINTS; i++) {
      const x = Number(xs[i]);
      if (!xs[i].trim() || !Number.isFinite(x)) return null;
      out[i] = clamp(x);
    }
    return out;
  }

  function graphAt(G, u) {
    const x = clamp(u) * (SHAPE_POINTS - 1), i = Math.min(SHAPE_POINTS - 2, Math.floor(x));
    return G[i] + (G[i + 1] - G[i]) * (x - i);
  }

  // The strength I at 20 Hz over the window and the motion clock W = ∫ (0.4 + 1.2·I) dt (drifts and turns run faster
  // where the strength is high). Auto: with a song its swell, a little more for a quick tempo and a gentle build to the
  // climax; without one a slow arc. A drawn graph sets the level, and a song adds ±0.12 of its swell as texture.
  function strengthTrack(env, fr, tr, shape) {
    const G = shapeOf(shape), n = Math.ceil((fr.b - fr.a) * HZ) + 2, span = Math.max(0.1, fr.h - fr.s0);
    const tempo = env.grid ? clamp((env.grid.bpm - 60) / 120) : 0.5;
    const I = new Float32Array(n), W = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = fr.a + i / HZ, u = clamp((t - fr.s0) / span), sw = tr.song ? sampleAt(tr.sw, tr.L0, t) : 0.5;
      let v;
      if (G) v = graphAt(G, u) + (tr.song ? 0.24 * (sw - 0.5) : 0);
      else if (tr.song) v = 0.05 + 0.9 * sw + 0.1 * smooth(u) + 0.15 * (tempo - 0.5);
      else v = 0.2 + 0.6 * Math.pow(Math.sin(Math.PI * u), 1.2) + 0.15 * (noise1(tr.n2, 0.2 * t + 17.3) - 0.5);
      I[i] = clamp(v);
      W[i] = i ? W[i - 1] + (0.4 + 0.6 * (I[i] + I[i - 1])) / HZ : fr.a;
    }
    return { I, W, IA: fr.a, drawn: !!G };
  }

  function strengthAt(d, t) { return sampleAt(d.I, d.IA, t); }
  function clockAt(d, t) { return sampleAt(d.W, d.IA, t); }

  // Whether an event at t is kept at the strength there: a downbeat (or the only kind there is) from 0.1, the other
  // beats from 0.42, so a calm stretch keeps the bar's pulse and a strong one every beat.
  function keeps(st, t, major) { return sampleAt(st.I, st.IA, t) >= (major ? 0.1 : 0.42); }

  // Rising edges of the normalised level in [lo, hi], at least g apart.
  function onsets(tr, lo, hi, g) {
    const out = [];
    let last = -Infinity;
    for (let i = 2; i < tr.lv.length; i++) {
      const t = tr.L0 + i / HZ;
      if (t < lo || t > hi) continue;
      if (tr.lv[i] - tr.lv[i - 2] > 0.22 && tr.lv[i] > 0.45 && t - last >= g) { out.push(t); last = t; }
    }
    return out;
  }

  // Fillers where the song gives no onset for `span` seconds (kept `g` clear of the next onset): [time, isFiller].
  function withFillers(list, lo, hi, span, g) {
    const out = [];
    let at = lo;
    for (const t of list) {
      while (t - at > span + g) { at += span; out.push([at, 1]); }
      out.push([t, 0]); at = t;
    }
    while (hi - at > span) { at += span; out.push([at, 1]); }
    return out;
  }

  // The song's onsets in [lo, hi] with fillers, at most `cap`: a long interlude widens the gap and the filler span
  // (×1.25 a round) rather than stopping early.
  function onsetEvents(tr, lo, hi, g, span, cap) {
    for (let k = 1; ; k *= 1.25) {
      const out = withFillers(onsets(tr, lo, hi, g * k), lo, hi, span * k, g * k);
      if (out.length <= cap) return out;
    }
  }

  // Events at seeded, uneven gaps in [g0, g1]: structure, never a tempo. At most `cap`: when the window would hold more,
  // the gaps widen (×1.25 a round) rather than the events stopping early.
  function aperiodic(r, s, e, g0, g1, cap) {
    for (let k = 1; ; k *= 1.25) {
      const out = [];
      let t = s + r.range(0, 0.4);
      for (; t < e && out.length < cap; t += k * r.range(g0, g1)) out.push(t);
      if (!(t < e)) return out;
    }
  }

  function median(xs) {
    if (!xs.length) return 0;
    const s = xs.slice().sort((x, y) => x - y);
    return s[Math.floor((s.length - 1) / 2)];
  }

  // --- lightMotes -----------------------------------------------------------------------------------------------------

  // Mote k free in the drift area at t: a slow sway, a drift along the flow, a little noise, and a new place each time
  // its life cycle renews (the jump happens while it is invisible, so the motes never loop).
  function cycleOf(d, k, t) { return Math.floor((t - d.a) / d.life[k] + d.psi[k]); }

  function moteX(d, k, t) {
    const c = cycleOf(d, k, t);
    const x = d.px[k] + d.sway * (1 - Math.cos(TAU * t / 37 + d.phw)) + d.wob * (2 * noise1(d.nx, 0.12 * t + 9.1 * k) - 1)
      + noise1(d.sk, c + 0.5 * k) * d.AW;
    return d.x0 + wrap(x, 0, d.AW);
  }

  function moteY(d, k, t) {
    return d.y0 + wrap(d.py[k] + d.vy[k] * clockAt(d, t) + d.wobY * (2 * noise1(d.ny, 0.1 * t + 5.3 * k) - 1), 0, d.AH);
  }

  function moteLife(d, k, t) {
    const v = fract((t - d.a) / d.life[k] + d.psi[k]);
    return smooth(v / 0.2) * smooth((1 - v) / 0.25);
  }

  // Position (X, Y), core alpha (A), halo alpha (HA), halo scale (HS) and alpha step (Bk) of every mote at t, into the
  // paint's scratch columns: only the columns are written, nothing survives the frame.
  function placeMotes(d, t) {
    const sus = d.song ? 0.85 + 0.3 * swellAt(d, t) : 1;
    const late = t > d.o;
    const shown = d.n * (0.2 + 0.8 * strengthAt(d, Math.min(t, d.o)));    // how many motes the strength shows
    for (let k = 0; k < d.n; k++) {
      const e = smooth((t - d.s0 - d.st[k] * d.E) / (0.55 * d.E));
      let x, y, life;
      if (!late) {
        x = moteX(d, k, t); y = moteY(d, k, t); life = moteLife(d, k, t);
      } else {
        const dt = t - d.o, gk = CUBIC_IN_OUT(clamp((dt - 0.15 * d.Xo * d.sg[k]) / (0.85 * d.Xo)));
        const rx = d.ox[k] + d.vx * dt - d.cx, ry = d.oy[k] + d.vy[k] * dt - d.cy;
        const ang = 0.9 * d.spin * gk, c = Math.cos(ang), s = Math.sin(ang), m = 1 - 0.92 * gk;
        x = d.cx + (c * rx - s * ry) * m; y = d.cy + (s * rx + c * ry) * m;
        life = lerp(d.lo[k], 1, gk) * (1 + 0.4 * gk);
      }
      const tw = 0.55 + 0.45 * Math.sin(TAU * d.fr[k] * t + d.ph[k]);
      const vis = smooth((shown - k) / 2);
      const a = clamp(tw * life * sus * e * vis);
      d.X[k] = x; d.Y[k] = y; d.A[k] = a;
      d.HA[k] = clamp(tw * life * sus * vis * (0.35 + 0.65 * e));
      d.HS[k] = 1 + 1.2 * (1 - e);
      d.Bk[k] = Math.round(a * MOTE_BUCKETS);
    }
  }

  // Unit radial gradients: the bokeh disc with a brighter rim (on a light ground a rim only darkens, so it stays low),
  // and the soft halo.
  function bokehGradient(g, q, ink, rim) {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    gr.addColorStop(0, q.rgba(ink, 0.5)); gr.addColorStop(0.7, q.rgba(ink, 0.55)); gr.addColorStop(0.88, q.rgba(ink, rim));
    gr.addColorStop(1, q.rgba(ink, 0));
    return gr;
  }

  function haloGradient(g, q, ink) {
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
    gr.addColorStop(0, q.rgba(ink, 0.8)); gr.addColorStop(0.3, q.rgba(ink, 0.3)); gr.addColorStop(1, q.rgba(ink, 0));
    return gr;
  }

  function disc(g, fill, x, y, r) {
    g.save();
    g.translate(x, y);
    g.scale(r, r);
    g.fillStyle = fill;
    g.fillRect(-1, -1, 2, 2);
    g.restore();
  }

  // The far plane: large soft bokeh in two inks, drifting slower than the motes, swelling away in the lead-out.
  function bokehDraw(g, t, d, q) {
    const Am = envelopeOf(d, t);
    if (Am < 1 / 255) return;
    const a0 = g.globalAlpha, outK = outOf(d, t), fade = Am * (1 - outK);
    if (fade < 1 / 255) return;
    const g0 = bokehGradient(g, q, d.P, d.rim), g1 = d.S === d.P ? g0 : bokehGradient(g, q, d.S, d.rim);
    if (d.add) g.globalCompositeOperation = 'lighter';
    const drift = d.sway * (1 - Math.cos(TAU * t / 37 + d.phw));
    for (let k = 0; k < d.nb; k += q.draft ? 2 : 1) {
      const r = d.br[k] * (1 + 0.06 * Math.sin(TAU * d.bf[k] * t + d.bp[k])) * (1 + 0.25 * outK);
      if (r * q.scale < 0.5) continue;
      const span = d.AW + 2 * d.br[k], spanY = d.AH + 2 * d.br[k];
      const x = d.x0 - d.br[k] + wrap(d.bx[k] + 0.35 * drift, 0, span);
      const y = d.y0 - d.br[k] + wrap(d.by[k] + 0.35 * d.bvy[k] * t, 0, spanY);
      g.globalAlpha = a0 * clamp(d.alpha * fade);
      disc(g, d.bi[k] ? g1 : g0, x, y, r);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = a0;
  }

  // A four-point star: two crossed thin diamonds, the second 0.6 as long, both wound the same way (under the nonzero
  // rule opposite windings would cancel where they cross and leave a hole at the centre).
  function star(g, x, y, len, tilt) {
    const c = Math.cos(tilt), s = Math.sin(tilt), w = 0.08 * len, l2 = 0.6 * len;
    g.moveTo(x + c * len, y + s * len); g.lineTo(x - s * w, y + c * w); g.lineTo(x - c * len, y - s * len);
    g.lineTo(x + s * w, y - c * w); g.closePath();
    g.moveTo(x - s * l2, y + c * l2); g.lineTo(x - c * w, y - s * w); g.lineTo(x + s * l2, y - c * l2);
    g.lineTo(x + c * w, y + s * w); g.closePath();
  }

  // The cores in alpha steps, one path each.
  function bucketCores(g, d, q, alpha) {
    for (let bk = 1; bk <= MOTE_BUCKETS; bk++) {
      let any = false;
      for (let k = 0; k < d.n; k++) {
        if (d.Bk[k] !== bk || d.rc[k] * q.scale < 0.5) continue;
        if (!any) { g.beginPath(); any = true; }
        g.moveTo(d.X[k] + d.rc[k], d.Y[k]);
        g.arc(d.X[k], d.Y[k], d.rc[k], 0, TAU);
      }
      if (!any) continue;
      g.globalAlpha = clamp(alpha * bk / MOTE_BUCKETS);
      g.fill();
    }
  }

  // Over the key a faint core blends into a dirty partial alpha: there the brighter motes draw as one solid path, and
  // a mote fades by its size instead (from nothing at α 0.4 to its full core at 0.75).
  function solidCores(g, d, q, alpha) {
    let any = false;
    for (let k = 0; k < d.n; k++) {
      const r = d.rc[k] * smooth((d.A[k] - 0.4) / 0.35);
      if (r * q.scale < 0.5) continue;
      if (!any) { g.beginPath(); any = true; }
      g.moveTo(d.X[k] + r, d.Y[k]);
      g.arc(d.X[k], d.Y[k], r, 0, TAU);
    }
    if (!any) return;
    g.globalAlpha = alpha;
    g.fill();
  }

  // The mid plane: the handover glow, the motes' halos and cores, and the glints on the music's events.
  function motesDraw(g, t, d, q) {
    const Am = envelopeOf(d, t);
    if (Am < 1 / 255) return;
    const a0 = g.globalAlpha;
    placeMotes(d, t);
    const halo = haloGradient(g, q, d.P);
    if (d.add) g.globalCompositeOperation = 'lighter';
    const glowK = glowOf(d, t);
    if (glowK > 0.004 && d.glowA > 0) {
      g.globalAlpha = a0 * clamp(d.glowA * glowK * Am);
      disc(g, halo, d.cx, d.cy, d.s * (0.05 + 0.06 * glowK) * d.lift);
    }
    for (let k = 0; k < d.n; k += q.draft ? 2 : 1) {
      const r = 6 * d.rc[k] * d.HS[k];
      const a = d.haloA * d.HA[k] * Am / (d.HS[k] * d.HS[k]);
      if (a < 1 / 255 || r * q.scale < 0.5) continue;
      g.globalAlpha = a0 * clamp(a);
      disc(g, halo, d.X[k], d.Y[k], r);
    }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = q.rgba(d.core, 1);
    if (d.solid) solidCores(g, d, q, a0 * clamp(d.coreA * Am));
    else bucketCores(g, d, q, a0 * d.coreA * Am);
    let shown = 0;
    for (let i = d.ev.length - 1; i >= 0 && shown < MAX_GLINTS; i--) {
      const tau = t - d.ev[i];
      if (tau < 0 || tau >= d.gLife) continue;
      const env = Math.pow(Math.sin(Math.PI * tau / d.gLife), 2);
      for (let j = 0; j < 3 && shown < MAX_GLINTS; j++) {
        const k = d.gm[i * 3 + j];
        if (k < 0) continue;
        g.globalAlpha = a0 * clamp(d.glintA * env * Am);
        g.beginPath();
        star(g, d.X[k], d.Y[k], d.gL[i * 3 + j] * (0.6 + 0.4 * env), d.gT[i * 3 + j]);
        g.fill();
        shown++;
      }
    }
    g.globalAlpha = a0;
  }

  // The far ink on a light ground: the accent, unless its 15 % tint over the ground is nearly grey (a complementary
  // accent, which reads as a stain, not as light); then the more colourful tint of the accent and the two shifts.
  function farInkOf(pal) {
    const gr = rgbOf(pal.ground);
    const tint = (tok) => {
      if (!/^#[0-9A-Fa-f]{6}$/.test(String(pal[tok]))) return -1;
      const c = rgbOf(pal[tok]).map((v, i) => 0.85 * gr[i] + 0.15 * v);
      return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
    };
    let best = 'accent', bestC = tint('accent');
    if (bestC >= 12) return best;
    for (const tok of ['shiftA', 'shiftB']) { const c = tint(tok); if (c > bestC) { best = tok; bestC = c; } }
    return best;
  }

  // Whether mote c glints in one of the two events before event i.
  function recent(gm, i, c) {
    for (let q = Math.max(0, (i - 2) * 3); q < i * 3; q++) if (gm[q] === c) return true;
    return false;
  }

  function flowSign(flow, r) {
    if (flow === 'rise') return -1;
    if (flow === 'fall') return 1;
    return r.chance(0.5) ? 0.15 : -0.15;
  }

  function motesBuild(env, p) {
    const { D, sb } = env;
    const fr = frameOf(env, p), ink = inksOf(env.pal), r = seedOf(env), s = fr.s;
    const k0 = Math.max(0.6, (D.w * D.h) / 2073600);
    const mx = 0.08 * D.w, my = 0.08 * D.h;
    const far = ink.light && !ink.chroma ? farInkOf(env.pal) : 'accent';
    const P = far, S = ink.light || ink.chroma ? far : ink.two;
    const speed = p.speed * fr.spd;
    const tr = levelTrack(env, r, fr.a - 0.4);
    const st = strengthTrack(env, fr, tr, p.shape);
    const base = data(fr, { x0: -mx, y0: -my, AW: D.w + 2 * mx, AH: D.h + 2 * my, add: ink.add, P, S,
      sway: 0.02 * s * (37 / TAU), wob: 0.035 * s, wobY: 0.025 * s, phw: r.range(0, TAU),
      song: tr.song, L0: tr.L0, lv: tr.lv, sw: tr.sw, n1: tr.n1, n2: tr.n2, I: st.I, W: st.W, IA: st.IA });

    // the far plane (a column per attribute, each from its own stream, so the amount only adds items at the end)
    const nb = Math.round(11 * k0 * (0.7 + 0.3 * p.amount));
    const rf = r.fork('far');
    const fu = rf.fork('u'), fxy = rf.fork('xy'), fm = rf.fork('misc');
    const bx = new Float32Array(nb), by = new Float32Array(nb), br = new Float32Array(nb), bf = new Float32Array(nb);
    const bp = new Float32Array(nb), bvy = new Float32Array(nb), bi = new Uint8Array(nb);
    // across: a golden-ratio walk with a little play (every prefix is spread out, so the discs never pile up on one
    // side); a place too near an earlier disc, or (for most) over the centre, is tried again
    const x0 = fxy.next();
    for (let k = 0; k < nb; k++) {
      const u = fu.next();
      br[k] = s * (0.045 + 0.055 * u * u);
      const avoid = fxy.next() < 0.6;
      for (let tries = 0; tries < 8; tries++) {
        bx[k] = fract(x0 + 0.6180339887 * k + fxy.range(-0.05, 0.05)) * (base.AW + 2 * br[k]); by[k] = fxy.range(0, base.AH + 2 * br[k]);
        const X = base.x0 - br[k] + bx[k], Y = base.y0 - br[k] + by[k];
        const ex = (X - fr.cx) / (0.22 * D.w), ey = (Y - fr.cy) / (0.2 * D.h);
        let near = false;
        for (let j = 0; j < k && !near; j++) near = Math.hypot(X - (base.x0 - br[j] + bx[j]), Y - (base.y0 - br[j] + by[j])) < 1.2 * (br[k] + br[j]);
        if (!near && (!avoid || ex * ex + ey * ey >= 1)) break;
      }
      bf[k] = fm.range(0.05, 0.11); bp[k] = fm.range(0, TAU); bi[k] = k % 2;
      bvy[k] = flowSign(p.flow, fm) * s * (0.018 + 0.03 * fm.next()) * speed;
    }
    // soft low-alpha discs key badly over the green: the key keeps only the motes' cores, glints and gather
    if (!ink.chroma) {
      sb.paint({ layer: 'far', bleed: 0, animated: true, owner: env.owner, draw: bokehDraw,
        data: Object.assign({}, base, { nb, bx, by, br, bf, bp, bvy, bi, alpha: ink.light ? 0.15 : 0.22, rim: ink.light ? 0.55 : 0.75 }) });
    }

    // the mid plane: motes (their halos, cores and glow stay in the accent, whatever the far ink)
    const n = Math.min(90, Math.round(56 * k0 * p.amount));
    const rm = r.fork('mid');
    const col = (label, fn) => { const st = rm.fork(label), out = new Float32Array(n); for (let k = 0; k < n; k++) out[k] = fn(st); return out; };
    const u = col('u', (x) => x.next());
    const rc = Float32Array.from(u, (v) => s * (0.003 + 0.005 * Math.pow(v, 1.5)) * (ink.chroma ? 1.6 : 1));
    const vy = new Float32Array(n);
    const dirs = rm.fork('dir');
    for (let k = 0; k < n; k++) vy[k] = flowSign(p.flow, dirs) * s * (0.018 + 0.03 * u[k]) * speed;
    const d = Object.assign(base, {
      P: 'accent', n, rc, vy, px: col('px', (x) => x.range(0, base.AW)), py: col('py', (x) => x.range(0, base.AH)),
      ph: col('ph', (x) => x.range(0, TAU)), fr: col('fr', (x) => x.range(0.25, 0.7)), st: col('st', (x) => x.range(0, 0.3)),
      psi: col('psi', (x) => x.range(0.2, 0.6)), life: col('life', (x) => x.range(5, 9)), sg: col('sg', (x) => x.next()),
      nx: rm.int(1, SEED_MAX), ny: rm.int(1, SEED_MAX), sk: rm.int(1, SEED_MAX), spin: rm.chance(0.5) ? 1 : -1,
      // over the key: fewer, larger, solid cores (solidCores)
      core: ink.add ? 'ink' : 'accent', haloA: ink.chroma ? 0 : ink.light ? 0.3 : 0.5, coreA: ink.light ? 0.8 : 0.95,
      solid: ink.chroma,
      glintA: ink.light ? 0.75 : 0.9, glowA: ink.chroma ? 0 : ink.add ? 0.45 : 0.25,
      X: new Float32Array(n), Y: new Float32Array(n), A: new Float32Array(n), HA: new Float32Array(n), HS: new Float32Array(n),
      Bk: new Uint8Array(n),
    });
    // the gather starts from where each mote is at o, moving on as it was
    d.ox = new Float32Array(n); d.oy = new Float32Array(n); d.lo = new Float32Array(n);
    for (let k = 0; k < n; k++) { d.ox[k] = moteX(d, k, fr.o); d.oy[k] = moteY(d, k, fr.o); d.lo[k] = moteLife(d, k, fr.o); }
    d.vx = 0.02 * s * Math.sin(TAU * fr.o / 37 + d.phw);

    // glints on the music's events: beats with a song and a grid, the song's onsets without a grid, a bpm pin's beats
    // without a song, and seeded uneven gaps without either
    const re = r.fork('ev'), lo = fr.s0 + fr.E, hi = fr.o, grid = env.grid;
    let ev = [], per = [], major = [];
    if (tr.song && grid) {
      const bl = beatList(env, lo, hi, 0.3, MAX_EVENTS);
      ev = Array.from(bl.t); major = Array.from(bl.down);
      per = ev.map((te, i) => Math.min(3, 1 + bl.down[i] + (sampleAt(tr.lv, tr.L0, te) > 0.65 ? 1 : 0)));
    } else if (tr.song) {
      ev = onsetEvents(tr, lo, hi, 0.35, 1.6, MAX_EVENTS).map((x) => x[0]);
      per = ev.map(() => 1); major = ev.map(() => 1);
    } else if (grid) {
      const bl = beatList(env, lo, hi, 0.6, MAX_EVENTS);
      ev = Array.from(bl.t); major = Array.from(bl.down);
      per = ev.map((te, i) => 1 + bl.down[i]);
    } else {
      ev = aperiodic(re, lo, hi, 0.55, 1.25, MAX_EVENTS);
      per = ev.map(() => 1); major = ev.map(() => 1);
    }
    // the strength thins them where it is low, and a strong moment adds a star (at most 3)
    const kept = ev.map((te, i) => keeps(st, te, major[i]));
    per = per.filter((_, i) => kept[i]);
    ev = ev.filter((_, i) => kept[i]);
    per = per.map((c, i) => Math.min(3, c + (strengthAt(st, ev[i]) > 0.85 ? 1 : 0)));
    const m = ev.length;
    d.ev = Float32Array.from(ev);
    d.gm = new Int16Array(m * 3).fill(-1); d.gL = new Float32Array(m * 3); d.gT = new Float32Array(m * 3);
    d.gLife = grid && grid.period < 0.4 ? 0.5 : 0.7;
    const pick = re.fork('pick');
    for (let i = 0; i < m && n > 0; i++) {
      for (let j = 0; j < per[i]; j++) {
        // a mote in view, alive through the whole glint (a renewal mid-glint would move the star across the frame), and
        // not one of the two events before (it would blink like a beacon); if none is found the star is left out
        let k = -1;
        const te = ev[i], tz = Math.min(te + d.gLife, fr.o);
        for (let tries = 0; tries < 12 && k < 0; tries++) {
          const c = pick.int(0, n - 1), x = moteX(d, c, te), y = moteY(d, c, te);
          if (recent(d.gm, i, c)) continue;
          if (moteLife(d, c, te) >= 0.3 && moteLife(d, c, te + d.gLife) >= 0.3 && cycleOf(d, c, te) === cycleOf(d, c, tz)
            && x > 0.04 * D.w && x < 0.96 * D.w && y > 0.04 * D.h && y < 0.96 * D.h) k = c;
        }
        d.gm[i * 3 + j] = k;
        d.gL[i * 3 + j] = s * (0.022 + 0.018 * pick.next()) * (j > 0 || (grid && per[i] > 1) ? 1.3 : 1);
        d.gT[i * 3 + j] = (pick.chance(0.5) ? 1 : -1) * pick.range(8, 20) * DEG;
      }
    }
    sb.paint({ layer: 'mid', bleed: 0, animated: true, owner: env.owner, draw: motesDraw, data: d });
    return finish(env, fr, 0.36 * s, 0.24 * s);
  }

  const lightMotes = K.arrange({
    key: 'lightMotes',
    label: L('光の粒', 'Light motes'),
    blurb: L('光の粒とやわらかなぼけが奥行きの中を漂い、次の歌い出しへ集まる',
      'Motes of light and soft bokeh drift in depth, then gather where the next line begins'),
    tags: ['soft', 'airy', 'bright'], family: 'motes', cam: 'gentle', needs: ['beats', 'level'],
    traits: { cells: [0, 80], roles: ['interlude'], energy: [0, 0.7] },
    params: {
      amount: { type: 'num', min: 0.4, max: 1.6, step: 0.05, unit: 'x', label: L('粒の量', 'Amount'),
        auto: { range: [0.85, 1.15], follow: 'energy' } },
      flow: { type: 'enum', of: ['rise', 'float', 'fall'], optKey: 'moteFlow', label: L('流れ', 'Flow'),
        auto: { pick: ['rise', 'float', 'fall'], weights: [3, 2, 1] } },
      speed: { type: 'num', min: 0.5, max: 2, step: 0.05, unit: 'x', label: L('漂う速さ', 'Drift speed'), ui: 'advanced',
        auto: { range: [0.85, 1.15], follow: 'tempo' } },
      shape: SHAPE_PARAM,
    },
    build: motesBuild,
  });

  // --- soundHorizon ---------------------------------------------------------------------------------------------------

  // Bar k's alpha step and half height at t (the loudness travels outward: the edge bar shows it 1.8 s late; a real
  // beat lifts the whole row at once, a downbeat more: added to the level, and past the bars' own jitter, so a quiet
  // passage still shows the beat).
  // Without a song the row is a calm breathing wave, not a meter: smoother from bar to bar (and half as tall, hA).
  function placeBars(d, t, reach, outK) {
    const vis = reach * d.nb, full = Math.floor(vis), part = vis - full;
    let kick = 0;
    if (d.bt.length) {
      const j = lastBeat(d.bt, t);
      if (j >= 0) kick = (d.bd[j] ? 0.22 : 0.15) * Math.exp(-(t - d.bt[j]) / 0.12);
    }
    const jag = d.song ? 0.25 : 0.1;
    const gain = 0.3 + 0.9 * strengthAt(d, t);                // the strength scales the whole row (at most 1.2)
    for (let k = 0; k <= d.nb; k++) {
      const edge = k <= full ? 1 : k === full + 1 ? part : 0;
      if (edge <= 0) { d.Bk[k] = 0; continue; }
      const m = 0.75 + jag * (2 * noise1(d.nm, 0.35 * k + 0.5 * t) - 1);
      const lv = d.song ? 0.2 + 0.8 * levelAt(d, t - k * d.pc / d.v) : levelAt(d, t - k * d.pc / d.v);   // a quiet passage still breathes
      d.H[k] = d.hMin + d.hA * gain * d.taper[k] * (d.w[k] * m * lv + kick) * (1 - outK);
      // over the key every bar is solid (the taper stays in the height): only the growing edge bar fades in
      d.Bk[k] = Math.max(1, Math.round((d.solid ? 1 : 0.35 + 0.65 * d.taper[k]) * edge * BAR_BUCKETS));
    }
  }

  function reachOf(d, t) {
    const inR = CUBIC_OUT(clamp((t - d.s0) / (0.9 * d.E)));
    const outR = 1 - CUBIC_IN(clamp((t - d.o - 0.35 * d.Xo) / (0.65 * d.Xo)));
    return Math.min(inR, outR);
  }

  // The mid plane: a faint hairline under a row of bars, dots at rest, capsules as the song swells.
  function barsDraw(g, t, d, q) {
    const Am = envelopeOf(d, t);
    if (Am < 1 / 255) return;
    const a0 = g.globalAlpha, outK = outOf(d, t), reach = reachOf(d, t);
    if (!(reach > 0)) return;
    const hl = d.hl * reach, line = Am * (1 - outK);
    if (line > 1 / 255 && hl * q.scale > 1) {
      const gr = g.createLinearGradient(d.cx - hl, 0, d.cx + hl, 0);
      gr.addColorStop(0, q.rgba('ink', 0)); gr.addColorStop(0.2, q.rgba('ink', d.lineA));
      gr.addColorStop(0.8, q.rgba('ink', d.lineA)); gr.addColorStop(1, q.rgba('ink', 0));
      g.globalAlpha = a0 * clamp(line);
      g.fillStyle = gr;
      g.fillRect(d.cx - hl, d.cy - 0.6, 2 * hl, 1.2);
    }
    placeBars(d, t, reach, outK);
    const gr = g.createLinearGradient(d.cx - d.Lh, 0, d.cx + d.Lh, 0);
    gr.addColorStop(0, q.rgba(d.S, 1)); gr.addColorStop(0.5, q.rgba(d.P, 1)); gr.addColorStop(1, q.rgba(d.S, 1));
    g.strokeStyle = gr;
    g.lineWidth = d.bw;
    g.lineCap = 'round';
    for (let bk = 1; bk <= BAR_BUCKETS; bk++) {
      let any = false;
      for (let k = 0; k <= d.nb; k++) {
        if (d.Bk[k] !== bk) continue;
        if (!any) { g.beginPath(); any = true; }
        const x = k * d.pc, H = d.H[k];
        g.moveTo(d.cx + x, d.cy - H); g.lineTo(d.cx + x, d.cy + H);
        if (k > 0) { g.moveTo(d.cx - x, d.cy - H); g.lineTo(d.cx - x, d.cy + H); }
      }
      if (!any) continue;
      g.globalAlpha = a0 * clamp(d.barA * Am * bk / BAR_BUCKETS);
      g.stroke();
    }
    g.globalAlpha = a0;
  }

  // The far plane: a glow at the centre that follows the level, and flat ripples spreading on the events.
  function rippleDraw(g, t, d, q) {
    const Am = envelopeOf(d, t);
    if (Am < 1 / 255) return;
    const a0 = g.globalAlpha, lv = levelAt(d, t), glowK = glowOf(d, t);
    if (d.glowA > 0) {
      const R = d.s * (0.06 + 0.07 * lv);
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
      gr.addColorStop(0, q.rgba(d.P, 0.9)); gr.addColorStop(0.35, q.rgba(d.P, 0.35)); gr.addColorStop(1, q.rgba(d.P, 0));
      if (d.add) g.globalCompositeOperation = 'lighter';
      g.globalAlpha = a0 * clamp(d.glowA * (0.4 + 0.6 * lv) * (1 + 0.4 * glowK * d.lift) * Am);
      g.save();
      g.translate(d.cx, d.cy);
      g.scale(R * 1.6, R);
      g.fillStyle = gr;
      g.fillRect(-1, -1, 2, 2);
      g.restore();
      g.globalCompositeOperation = 'source-over';
    }
    if (d.ripples) {
      let shown = 0;
      for (let i = d.ev.length - 1; i >= 0 && shown < MAX_RIPPLES; i--) {
        const tau = t - d.ev[i];
        if (tau < 0) continue;
        if (tau >= d.life[i]) continue;
        const u = tau / d.life[i], rx = 0.02 * d.s + (d.R[i] - 0.02 * d.s) * CUBIC_OUT(u);
        const a = d.str[i] * Math.pow(1 - u, 1.5) * Am;
        shown++;
        if (a < 1 / 255) continue;
        g.globalAlpha = a0 * clamp(a);
        g.strokeStyle = q.rgba(d.major[i] ? d.P : 'ink', 1);
        g.lineWidth = 1.5 + 2.2 * (1 - u);
        g.beginPath();
        g.ellipse(d.cx, d.cy, rx, rx * d.flat, 0, 0, TAU);
        g.stroke();
      }
    }
    g.globalAlpha = a0;
  }

  function horizonBuild(env, p) {
    const { D, sb } = env;
    const fr = frameOf(env, p), ink = inksOf(env.pal), r = seedOf(env), s = fr.s;
    const wide = D.w >= D.h;
    const Lh = Math.min(0.44 * D.w, D.w / 2 - D.safe.l - 0.01 * s);
    const pc = s * 0.0155 * (wide ? 1 : 0.85), nb = Math.floor(Lh / pc);
    const hMin = 0.0022 * s;
    const rm = r.fork('mid');
    const w = new Float32Array(nb + 1), taper = new Float32Array(nb + 1);
    for (let k = 0; k <= nb; k++) { w[k] = 0.55 + 0.45 * rm.next(); taper[k] = Math.pow(1 - (k / nb) * (k / nb), 0.9); }
    const tr = levelTrack(env, r, fr.a - 1.8);
    const st = strengthTrack(env, fr, tr, p.shape);
    const hA = s * (wide ? 0.1 : 0.12) * (0.35 + 0.65 * p.react) * (tr.song ? 1 : 0.5);
    if (!tr.song) for (let k = 0; k <= nb; k++) w[k] = 0.775 + 0.5 * (w[k] - 0.775);   // a calm wave: bars closer in height
    const hl = Math.min(1.04 * Lh, D.w / 2 - D.safe.l);

    // ripple events: the opening and the handover always; beats with a song and a grid, onsets (with soft fillers)
    // without a grid, a bpm pin's downbeats without a song, uneven seeded gaps without either
    const re = r.fork('ev'), grid = env.grid, lo = fr.s0 + 0.5 * fr.E, hi = fr.o + 0.2 * fr.Xo;
    const lvAt = (t) => levelAt(tr, t);
    let body = [], bl = { t: new Float32Array(0), down: new Uint8Array(0) };   // [time, str, major]; the beats the bars kick on
    if (tr.song && grid) {
      bl = beatList(env, lo, hi, 0.45);
      const rb = beatList(env, lo, hi, 0.45, MAX_RINGS);
      body = Array.from(rb.t, (t, i) => [t, rb.down[i] ? 0.45 : 0.22, rb.down[i]]);
    } else if (tr.song) {
      body = onsetEvents(tr, lo, hi, 0.6, 2.5, MAX_RINGS).map(([t, fill]) => [t, fill ? 0.2 : 0.22, 0]);
    } else if (grid) {
      const bar = grid.meter * grid.period;
      const pin = beatList(env, lo, hi, bar < 1.2 ? 2 * bar : bar, MAX_RINGS);
      body = Array.from(pin.t, (t) => [t, 0.45, 1]);
    } else {
      body = aperiodic(re, fr.s0 + fr.E, fr.o, 2, 3, MAX_RINGS).map((t) => [t, 0.22, 0]);
    }
    // the strength thins the ripples where it is low and makes them stronger where it is high
    body = body.filter((x) => keeps(st, x[0], x[2])).map((x) => [x[0], x[1] * (0.7 + 0.6 * strengthAt(st, x[0])), x[2]]);
    const gaps = [];
    for (let i = 1; i < body.length; i++) gaps.push(body[i][0] - body[i - 1][0]);
    const Lr = body.length >= 2 ? clamp(2.4 * median(gaps), 1.2, 2.2) : 1.6;
    // the handover ripple has a short life of its own: it fills out and fades before the next line is sung
    // (a thin ring barely reads on a light ground: the body's rings are 0.1 stronger there)
    const up = ink.light ? 0.1 : 0;
    const all = [[fr.s0 + 0.1, 0.35, 1, 0]].concat(body.map((x) => [x[0], x[1] + up, x[2], 0]), [[fr.h - 0.3, 0.55 * fr.lift, 1, 1]])
      .sort((x, y) => x[0] - y[0]);
    const Rof = (str) => (0.26 + 0.14 * str) * D.w * (wide ? 1 : 1.3);
    const ev = Float32Array.from(all, (x) => x[0]);
    const str = Float32Array.from(all, (x) => x[1] * (0.6 + 0.4 * lvAt(x[0])));
    const R = Float32Array.from(all, (x, i) => (x[3] ? 0.5 * D.w : Rof(str[i])));
    const life = Float32Array.from(all, (x) => (x[3] ? 0.45 : Lr));
    const major = Uint8Array.from(all, (x) => x[2]);

    const P = 'accent', S = ink.light ? 'ink' : ink.two;
    const base = data(fr, { add: ink.add, P, S, song: tr.song, L0: tr.L0, lv: tr.lv, sw: tr.sw, n1: tr.n1, n2: tr.n2, ev,
      I: st.I, W: st.W, IA: st.IA });
    sb.paint({ layer: 'far', bleed: 0, animated: true, owner: env.owner, draw: rippleDraw,
      data: Object.assign({}, base, { ripples: !!p.ripples, str, R, major, life, flat: wide ? 0.28 : 0.45,
        glowA: ink.chroma ? 0 : ink.add ? 0.3 : 0.14 }) });
    const hTop = hMin + 1.2 * hA * (bl.t.length ? 1.3 : 1);
    const reach = { x: fr.cx - hl, y: fr.cy - hTop, w: 2 * hl, h: 2 * hTop };
    sb.paint({ layer: 'mid', bleed: 0, animated: true, owner: env.owner, draw: barsDraw,
      data: Object.assign(base, { Lh, pc, nb, hMin, hA, w, taper, hl, v: Lh / 1.8, bw: 0.42 * pc,
        barA: ink.chroma ? 1 : ink.light ? 0.8 : 0.85, solid: ink.chroma, lineA: ink.chroma ? 0.6 : 0.28,
        nm: rm.int(1, SEED_MAX), reach, bt: bl.t, bd: bl.down, H: new Float32Array(nb + 1), Bk: new Uint8Array(nb + 1) }) });
    return finish(env, fr, Lh, 2 * hA);
  }

  const soundHorizon = K.arrange({
    key: 'soundHorizon',
    label: L('音の水平線', 'Sound horizon'),
    blurb: L('点線の水平線が曲の音量で伸び縮みし、拍ごとに波紋が広がる',
      'A dotted horizon swells with the song\'s loudness while ripples spread on the beat'),
    tags: ['fast', 'bold', 'digital'], family: 'meter', cam: 'gentle', needs: ['beats', 'level'],
    traits: { cells: [0, 80], roles: ['interlude'], energy: [0.4, 1] },
    fits: (f) => (f.beat ? 1.3 : 0.6),
    params: {
      react: { type: 'num', min: 0, max: 1, step: 0.01, label: L('音への反応', 'Reaction'), auto: { range: [0.55, 0.85], follow: 'energy' } },
      ripples: { type: 'bool', label: L('波紋', 'Ripples'), auto: { pick: [true, false], weights: [4, 1] } },
      shape: SHAPE_PARAM,
    },
    build: horizonBuild,
  });

  // --- kineticShapes --------------------------------------------------------------------------------------------------

  // A figure's fields: ring x y r share start, square x y side rot, dot x y r, line A x y angle length, line B …, dashed
  // ring r. Positions and radii in short sides around the centre, angles in degrees, line lengths as fractions of the
  // safe chord through the centre at that angle (0: the line is absent).
  const RX = 0, RY = 1, RR = 2, RS = 3, RA = 4, QX = 5, QY = 6, QS = 7, QR = 8, DX = 9, DY = 10, DR = 11;
  const AX = 12, AY = 13, AA = 14, AL = 15, BX = 16, BY = 17, BA = 18, BL = 19, DS = 20, NF = 21;
  const ORBIT = 0.26 * Math.cos(-35 * DEG), ORBIT_Y = 0.26 * Math.sin(-35 * DEG);
  const FIGS = Object.freeze([
    //  ring                          square                  dot                  line A               line B               dashed
    [0, 0, 0.26, 1, 0, /**/ 0, 0, 0.2, 45, /**/ ORBIT, ORBIT_Y, 0.028, /**/ 0, 0, 0, 0.9, /**/ 0, 0, 0, 0, /**/ 0.36],       // 軌道
    [0, 0, 0.12, 1, 0, /**/ 0, 0, 0.42, 0, /**/ 0, 0, 0.022, /**/ 0, 0.3, 0, 0.3, /**/ -0.3, 0, 90, 0.3, /**/ 0.2],          // 窓
    [-0.2, 0, 0.15, 1, 0, /**/ 0.2, 0, 0.26, 0, /**/ -0.2, 0, 0.024, /**/ 0, 0, 90, 0.88, /**/ 0, 0, 0, 0, /**/ 0.3],        // 対
    [0, 0.08, 0.3, 0.5, 180, /**/ 0, 0.2, 0.06, 45, /**/ 0, -0.1, 0.05, /**/ 0, 0.08, 0, 0.9, /**/ 0, 0, 0, 0, /**/ 0.42],   // 日の出
    [0, 0, 0.18, 0.75, 0, /**/ 0, 0, 0.3, 0, /**/ 0.15, 0.15, 0.02, /**/ 0, 0, 0, 0.5, /**/ 0, 0, 90, 0.5, /**/ 0.3],        // 十字
    [0.06, 0.03, 0.22, 1, 0, /**/ -0.04, -0.02, 0.34, 30, /**/ 0.06, 0.03, 0.03, /**/ 0, 0, -30, 0.7, /**/ 0, 0, 60, 0.25, /**/ 0.3], // 傾き
    [0, 0, 0.2, 1, 0, /**/ -0.28, 0.2, 0.1, 45, /**/ 0.07, -0.04, 0.12, /**/ 0, 0.3, 0, 0.25, /**/ 0, 0, 0, 0, /**/ 0.28],   // 蝕
    [0, 0, 0.06, 1, 0, /**/ 0, 0, 0.06, 45, /**/ 0, 0, 0.012, /**/ 0, 0, 0, 0.9, /**/ 0, 0, 0, 0, /**/ 0.12],               // 間
  ].map((f) => Object.freeze(f)));
  const POS_FIELDS = Object.freeze([RX, RY, QX, QY, DX, DY, AX, AY, BX, BY]);
  const OPENERS = Object.freeze([0, 1, 3, 5]);
  const TURNABLE = Object.freeze([2, 4]);

  // One visit of a figure into out[o…o+NF): short sides → du, degrees → radians, mirrored (x → −x) and, for the pair
  // and the cross, maybe turned a quarter.
  function placeFigure(out, o, fig, s, mirror, turn) {
    const pos = (ix, iy) => {
      let x = fig[ix] * s, y = fig[iy] * s;
      if (turn) { const t = x; x = -y; y = t; }
      if (mirror) x = -x;
      out[o + ix] = x; out[o + iy] = y;
    };
    const ang = (i, deg) => {
      let v = deg + (turn ? 90 : 0);
      if (mirror) v = 180 - v;
      out[o + i] = v * DEG;
    };
    pos(RX, RY); pos(QX, QY); pos(DX, DY); pos(AX, AY); pos(BX, BY);
    out[o + RR] = fig[RR] * s; out[o + RS] = fig[RS]; out[o + QS] = fig[QS] * s; out[o + DR] = fig[DR] * s;
    out[o + AL] = fig[AL]; out[o + BL] = fig[BL]; out[o + DS] = fig[DS] * s;
    // a mirrored arc runs the other way round: its start is where the original ends
    let st = fig[RA] + (turn ? 90 : 0);
    if (mirror) st = 180 - st - fig[RS] * 360;
    out[o + RA] = st * DEG;
    let q = fig[QR] + (turn ? 90 : 0);
    if (mirror) q = -q;
    out[o + QR] = q * DEG;
    ang(AA, fig[AA]); ang(BA, fig[BA]);
  }

  // The shortest turn from a to b for a shape that looks the same every `period` radians.
  function turnTo(a, b, period) { return a + wrap(b - a + period / 2, 0, period) - period / 2; }

  // The orbit (figure 0): its dot runs round the ring. Both ends of a blend turn by the same angle, so a change into
  // or out of the orbit stays continuous.
  function orbitX(d, i, o, th) { return d.seq[i] === 0 ? d.figs[o + RX] + Math.cos(th) * (d.figs[o + DX] - d.figs[o + RX]) - Math.sin(th) * (d.figs[o + DY] - d.figs[o + RY]) : d.figs[o + DX]; }
  function orbitY(d, i, o, th) { return d.seq[i] === 0 ? d.figs[o + RY] + Math.sin(th) * (d.figs[o + DX] - d.figs[o + RX]) + Math.cos(th) * (d.figs[o + DY] - d.figs[o + RY]) : d.figs[o + DY]; }

  // The pose at t into d.Q: the visit before the change time, blended into the next one over the Tt before it (every
  // move lands on the change), with the entrance and the lead-out applied.
  function poseAt(d, t) {
    const Q = d.Q, F = d.figs, nc = d.tc.length;
    let i = 0;
    while (i < nc && d.tc[i] <= t) i++;
    const c = clockAt(d, t) - d.c0;                             // the motion clock: faster where the strength is high
    const A = i * NF, th = d.ringDir * 0.25 * d.spd * c;
    for (let f = 0; f < NF; f++) Q[f] = F[A + f];
    Q[DX] = orbitX(d, i, A, th); Q[DY] = orbitY(d, i, A, th);
    // the hold's breath: 0 on a change, back over 0.4 s after it, gone again through the next blend
    let hold = i > 0 ? CUBIC_IN_OUT(clamp((t - d.tc[i - 1]) / 0.4)) : 1;
    if (i < nc) {
      const prev = i > 0 ? d.tc[i - 1] : d.s0 + d.E, Tt = Math.min(0.7, 0.45 * (d.tc[i] - prev));
      const u = (t - (d.tc[i] - Tt)) / Tt;
      if (u > 0) {
        const e = EXPO_IN_OUT(clamp(u)), B = A + NF;
        hold *= 1 - e;
        for (let f = 0; f < NF; f++) {
          let from = F[A + f], to = F[B + f];
          if (f === DX) { from = Q[DX]; to = orbitX(d, i + 1, B, th); } else if (f === DY) { from = Q[DY]; to = orbitY(d, i + 1, B, th); }
          if (f === RA) to = turnTo(from, to, TAU);
          else if (f === QR) to = turnTo(from, to, TAU / 4) + (d.flo[i] ? TAU / 4 : 0);
          else if (f === AA || f === BA) to = turnTo(from, to, Math.PI);
          else if ((f === AX || f === AY) && F[A + AL] === 0) from = to;       // an absent line grows where it will be
          else if ((f === AX || f === AY) && F[B + AL] === 0) to = from;
          else if ((f === BX || f === BY) && F[A + BL] === 0) from = to;
          else if ((f === BX || f === BY) && F[B + BL] === 0) to = from;
          if ((f === AA && F[A + AL] === 0) || (f === BA && F[A + BL] === 0)) from = to;
          if ((f === AA && F[B + AL] === 0) || (f === BA && F[B + BL] === 0)) to = from;
          Q[f] = from + (to - from) * e;
        }
      }
    }
    // always alive: the ring drifts by the share it shows (a half ring, the sunrise, stays seated on its horizon line),
    // the square turns, and the sizes breathe while a figure holds
    Q[RA] += d.ringDir * 0.12 * d.spd * c * clamp((Q[RS] - 0.5) / 0.5);
    Q[QR] += d.sqDir * 0.12 * (c + d.s0);
    const br = 1 + 0.03 * hold * Math.sin(TAU * t / 5);
    Q[RR] *= br; Q[QS] *= br; Q[DS] *= br;
    Q[DX] = Q[RX] + (Q[DX] - Q[RX]) * br; Q[DY] = Q[RY] + (Q[DY] - Q[RY]) * br;   // a dot on the ring stays on it
    // the entrance
    const s0 = d.s0, E = d.E;
    Q[DR] *= BACK_OUT(clamp((t - s0) / (0.35 * E)));
    Q[AL] *= EXPO_OUT(clamp((t - s0 - 0.15 * E) / (0.5 * E)));
    Q[RS] *= CUBIC_OUT(clamp((t - s0 - 0.2 * E) / (0.7 * E)));
    const sq = CUBIC_OUT(clamp((t - s0 - 0.3 * E) / (0.7 * E)));
    Q[QS] *= lerp(0.4, 1, sq); Q[QR] -= (1 - sq) * 45 * DEG;
    d.sqA = smooth(sq / 0.3);
    const late = CUBIC_OUT(clamp((t - s0 - 0.4 * E) / (0.6 * E)));
    Q[BL] *= late; d.dashA = late; Q[DS] *= 0.85 + 0.15 * late;
    // the lead-out: everything closes to the centre while line A turns to the fold and reaches across, then retracts
    if (t > d.o) {
      const c1 = CUBIC_IN_OUT(clamp((t - d.o) / (0.55 * d.Xo))), keep = 1 - c1;
      Q[RR] *= keep; Q[RS] *= keep; Q[QS] *= keep; Q[QR] += c1 * TAU / 4; Q[BL] *= keep; Q[DS] *= keep; d.dashA *= keep;
      for (let j = 0; j < POS_FIELDS.length; j++) Q[POS_FIELDS[j]] *= keep;
      Q[AA] = lerp(Q[AA], turnTo(Q[AA], d.fold, Math.PI), c1);
      Q[AL] = lerp(Q[AL], 0.8, c1) * (1 - CUBIC_IN(clamp((t - d.o - 0.55 * d.Xo) / (0.45 * d.Xo))));
      Q[DR] = lerp(Q[DR], 0.012 * d.s * d.lift, c1);
    }
  }

  // The safe chord through the centre at angle θ.
  function chordOf(d, th) {
    const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
    return 2 * Math.min(c > 1e-6 ? d.hx / c : Infinity, s > 1e-6 ? d.hy / s : Infinity);
  }

  // The part of u ∈ [lo, hi] where p·u ≤ q, as [lo, hi] into d.U (Liang–Barsky, one edge of the rectangle).
  function clipEdge(d, p, q) {
    if (Math.abs(p) < 1e-9) { if (q < 0) d.U[1] = -Infinity; return; }
    const r = q / p;
    if (p < 0) { if (r > d.U[0]) d.U[0] = r; } else if (r < d.U[1]) d.U[1] = r;
  }

  // A centred segment, clipped to the safe rectangle, added to the current path.
  function segment(g, d, x, y, th, frac) {
    const half = 0.5 * frac * chordOf(d, th);
    if (!(half > 0.5)) return false;
    const dx = Math.cos(th) * half, dy = Math.sin(th) * half;
    // x + dx·u ∈ [sx0, sx1], y + dy·u ∈ [sy0, sy1] for u ∈ [−1, 1]
    d.U[0] = -1; d.U[1] = 1;
    clipEdge(d, -dx, x - d.sx0); clipEdge(d, dx, d.sx1 - x); clipEdge(d, -dy, y - d.sy0); clipEdge(d, dy, d.sy1 - y);
    if (!(d.U[1] > d.U[0])) return false;
    g.moveTo(x + dx * d.U[0], y + dy * d.U[0]);
    g.lineTo(x + dx * d.U[1], y + dy * d.U[1]);
    return true;
  }

  // The index of the last beat at or before t (−1 before the first).
  function lastBeat(ev, t) {
    let lo = 0, hi = ev.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ev[m] <= t) lo = m + 1; else hi = m; }
    return lo - 1;
  }

  // The dial behind: a faint circle of 60 ticks, turning slowly, gone before the lead-out.
  function dialDraw(g, t, d, q) {
    const Am = envelopeOf(d, t) * (1 - outOf(d, t));
    if (Am < 1 / 255) return;
    const a0 = g.globalAlpha, R = 0.41 * d.s, turn = -1.2 * DEG * t;
    g.globalAlpha = a0 * clamp(d.dialA * Am);
    g.strokeStyle = q.rgba('ink', 1);
    g.lineWidth = 0.4 * d.w0;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(d.cx + R, d.cy);
    g.arc(d.cx, d.cy, R, 0, TAU);
    for (let k = 0; k < 60; k++) {
      const a = turn + k * TAU / 60, r0 = (k % 5 === 0 ? 0.37 : 0.39) * d.s, c = Math.cos(a), s = Math.sin(a);
      g.moveTo(d.cx + c * r0, d.cy + s * r0);
      g.lineTo(d.cx + c * R, d.cy + s * R);
    }
    g.stroke();
    g.globalAlpha = a0;
  }

  function shapesDraw(g, t, d, q) {
    const Am = envelopeOf(d, t);
    if (Am < 1 / 255) return;
    const a0 = g.globalAlpha;
    poseAt(d, t);
    const Q = d.Q, cx = d.cx, cy = d.cy, w0 = d.w0;
    g.lineCap = 'round';
    // the dashed ring (its dashes read as dots), turning, or ticking on the beats
    if (d.dashA > 0.004 && Q[DS] > 1) {
      let th = -0.2 * t;
      if (d.ev.length) {
        // after the last beat's tick the ring turns on freely (it never freezes into the lead-out)
        const j = lastBeat(d.ev, t);
        th = j < 0 ? 0 : (TAU / 48) * (j + CUBIC_OUT(Math.min(1, (t - d.ev[j]) / 0.18)));
        if (j === d.ev.length - 1 && t > d.ev[j] + 0.18) th += 0.2 * (t - d.ev[j] - 0.18);
      }
      g.globalAlpha = a0 * clamp(0.7 * d.dashA * Am);
      g.strokeStyle = q.rgba(d.dashInk, 1);
      g.lineWidth = 0.6 * w0;
      g.setLineDash(d.dash);
      g.save();
      g.translate(cx, cy);
      g.rotate(th);
      g.beginPath();
      g.arc(0, 0, Q[DS], 0, TAU);
      g.stroke();
      g.restore();
      g.setLineDash(NO_DASH);
    }
    // the two lines
    g.strokeStyle = q.rgba('ink', 1);
    g.lineWidth = 0.5 * w0;
    g.globalAlpha = a0 * clamp(d.lineA * Am);
    g.beginPath();
    const la = segment(g, d, cx + Q[AX], cy + Q[AY], Q[AA], Q[AL]);
    const lb = segment(g, d, cx + Q[BX], cy + Q[BY], Q[BA], Q[BL]);
    if (la || lb) g.stroke();
    // the ring (an arc of its share)
    if (Q[RR] > 0.5 && Q[RS] > 0.002) {
      g.lineWidth = w0;
      g.globalAlpha = a0 * clamp(0.75 * Am);
      g.beginPath();
      const x = cx + Q[RX], y = cy + Q[RY];
      g.moveTo(x + Math.cos(Q[RA]) * Q[RR], y + Math.sin(Q[RA]) * Q[RR]);
      g.arc(x, y, Q[RR], Q[RA], Q[RA] + TAU * Math.min(1, Q[RS]));
      g.stroke();
    }
    // the square
    if (Q[QS] > 0.5 && d.sqA > 0.004) {
      const x = cx + Q[QX], y = cy + Q[QY], r = Q[QS] * Math.SQRT1_2;
      g.lineWidth = w0;
      g.lineJoin = 'miter';
      g.globalAlpha = a0 * clamp(0.85 * d.sqA * Am);
      g.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = Q[QR] + TAU / 8 + k * TAU / 4;
        if (k === 0) g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.closePath();
      g.stroke();
    }
    // the hero dot: it breathes, and ticks on the beats (a small dot by 6–26 % with the strength, a large disc by less,
    // over a 0.05 s rise)
    let rd = Q[DR] * (1 + 0.06 * Math.sin(TAU * 0.3 * t));
    if (d.ev.length && t < d.o + 0.2 && Q[DR] > 0) {
      const j = lastBeat(d.ev, t);
      if (j >= 0) {
        const since = t - d.ev[j];
        rd *= 1 + (0.04 + 0.3 * strengthAt(d, t)) * Math.min(1, 0.03 * d.s / Q[DR]) * Math.min(1, since / 0.05) * Math.exp(-since / 0.16);
      }
    }
    if (rd > 0.3) {
      const x = cx + Q[DX], y = cy + Q[DY], R = rd + Math.min(2 * rd, 0.06 * d.s);
      if (!d.chroma) {
        const gr = g.createRadialGradient(x, y, rd * 0.6, x, y, R);
        gr.addColorStop(0, q.rgba('accent', 1)); gr.addColorStop(1, q.rgba('accent', 0));
        if (d.add) g.globalCompositeOperation = 'lighter';
        g.globalAlpha = a0 * clamp(0.25 * Am);
        g.fillStyle = gr;
        g.fillRect(x - R, y - R, 2 * R, 2 * R);
        g.globalCompositeOperation = 'source-over';
      }
      g.globalAlpha = a0 * clamp(Am);
      g.fillStyle = q.rgba('accent', 1);
      g.beginPath();
      g.arc(x, y, rd, 0, TAU);
      g.fill();
    }
    g.globalAlpha = a0;
  }

  // Change times: downbeats every `every` bars (a bar count between 1.4 s and 4.2 s), or, without a grid, one about
  // every 2.4 s, evenly spread with a little seeded play (structure, not a tempo). At most 24: a long interlude
  // doubles the bar count (or widens the spread) rather than stopping early.
  function changeTimes(env, fr, every, r) {
    const lo = fr.s0 + fr.E + 0.3, hi = fr.o - 0.2, g = env.grid, out = [];
    if (!(hi > lo)) return out;
    if (g) {
      let m = every * g.meter;
      while (m * g.period < 1.4) m *= 2;
      while (m * g.period > 4.2 && m > 1) m = Math.ceil(m / 2);
      const xs = g.beatsIn(lo, hi), idx = xs.map((x) => g.beatAt(x + 1e-6).index);
      const count = (k) => idx.reduce((n, i) => n + (((i % k) + k) % k === 0 ? 1 : 0), 0);
      while (count(m) > 24) m *= 2;
      for (let i = 0; i < xs.length; i++) if (((idx[i] % m) + m) % m === 0) out.push(xs[i]);
      return out;
    }
    const span = hi - lo, n = Math.min(24, Math.max(0, Math.round(span / 2.4)));
    for (let j = 0; j < n; j++) out.push(lo + (j + 0.5 + r.range(-0.12, 0.12)) * span / n);
    return out;
  }

  // A walk over the figures from an opener: never the same figure twice in a row, never back to the one before.
  function sequenceOf(r, n) {
    const seq = new Uint8Array(n);
    seq[0] = r.pick(OPENERS);
    for (let i = 1; i < n; i++) {
      const ok = [];
      for (let f = 0; f < FIGS.length; f++) if (f !== seq[i - 1] && (i < 2 || f !== seq[i - 2])) ok.push(f);
      seq[i] = r.pick(ok);
    }
    return seq;
  }

  function shapesBuild(env, p) {
    const { D, sb } = env;
    const fr = frameOf(env, p), ink = inksOf(env.pal), r = seedOf(env), s = fr.s;
    const rs = r.fork('seq');
    const st = strengthTrack(env, fr, levelTrack(env, r, fr.a - 0.4), p.shape);
    // a calm stretch holds every other figure longer (the strength below 0.25 drops the change between)
    const tc = changeTimes(env, fr, p.every, rs.fork('times')).filter((x, i) => i % 2 === 0 || strengthAt(st, x) >= 0.25);
    const seq = sequenceOf(rs.fork('walk'), tc.length + 1);
    const figs = new Float32Array(seq.length * NF), flo = new Uint8Array(tc.length);
    const vr = rs.fork('visit');
    for (let i = 0; i < seq.length; i++) {
      const turn = TURNABLE.includes(seq[i]) && vr.chance(0.5);
      placeFigure(figs, i * NF, FIGS[seq[i]], s, vr.chance(0.5), turn);
    }
    for (let i = 0; i < tc.length; i++) flo[i] = vr.chance(0.4) ? 1 : 0;
    const w0 = s * 0.0028 * p.thickness;
    const beats = beatList(env, fr.s0 + fr.E, fr.o, 1 / 3), ev = beats.t;
    const hx = D.w / 2 - D.safe.l, hy = D.h / 2 - D.safe.t;
    // the farthest any stroke reaches from the centre (lines are clipped to the safe area as they are drawn; the sizes
    // breathe by 3 %, and the orbit's dot stays on its ring)
    let far = 0;
    for (let i = 0; i < seq.length; i++) {
      const o = i * NF;
      far = Math.max(far, Math.hypot(figs[o + RX], figs[o + RY]) + 1.03 * figs[o + RR], Math.hypot(figs[o + QX], figs[o + QY]) + 1.03 * figs[o + QS] * Math.SQRT1_2,
        Math.hypot(figs[o + DX], figs[o + DY]) + 0.03 * Math.hypot(figs[o + DX] - figs[o + RX], figs[o + DY] - figs[o + RY]) + figs[o + DR] * 1.2,
        1.03 * figs[o + DS]);
    }
    if (p.dial) far = Math.max(far, 0.41 * s);
    far += w0;
    const fold = env.orient === 'v' ? Math.PI / 2 : 0;
    const d = data(fr, { w0, tc: Float32Array.from(tc), seq, figs, flo, ev, evGap: beats.gap, fold, hx, hy, add: ink.add,
      I: st.I, W: st.W, IA: st.IA, c0: sampleAt(st.W, st.IA, fr.s0),
      sx0: D.safe.l, sx1: D.w - D.safe.r, sy0: D.safe.t, sy1: D.h - D.safe.b,
      ringDir: rs.chance(0.5) ? 1 : -1, sqDir: rs.chance(0.5) ? 1 : -1, dashInk: ink.light ? 'accent' : ink.two,
      // over the key the faint strokes key badly: solid lines, no glow behind the dot and no dial
      chroma: ink.chroma, lineA: ink.chroma ? 0.8 : 0.45,
      dash: Object.freeze([0.8 * w0, 3.2 * w0]), Q: new Float32Array(NF), U: new Float64Array(2), sqA: 0, dashA: 0 });
    const foldHalf = 0.4 * chordOf(d, fold);
    d.reach = { x: fr.cx - Math.max(far, fold === 0 ? foldHalf : 0), y: fr.cy - Math.max(far, fold ? foldHalf : 0) };
    d.reach.w = 2 * (fr.cx - d.reach.x); d.reach.h = 2 * (fr.cy - d.reach.y);
    if (p.dial && !ink.chroma) {
      sb.paint({ layer: 'far', bleed: 0, animated: true, owner: env.owner, draw: dialDraw,
        data: Object.assign({}, d, { dialA: ink.light ? 0.16 : 0.1 }) });
    }
    sb.paint({ layer: 'mid', bleed: 0, animated: true, owner: env.owner, draw: shapesDraw, data: d });
    return finish(env, fr, 0.6 * s, 0.6 * s);
  }

  const kineticShapes = K.arrange({
    key: 'kineticShapes',
    label: L('図形の舞', 'Kinetic shapes'),
    blurb: L('細い円と線と四角が回り、伸び、小節ごとに組み替わる', 'Thin circles, lines and a square turn, extend and recombine bar by bar'),
    tags: ['minimal', 'serious'], family: 'figure', cam: 'gentle', needs: ['beats', 'level'],
    traits: { cells: [0, 80], roles: ['interlude'], energy: [0.15, 0.9] },
    fits: (f) => (f.beat ? 1.1 : 0.9),
    params: {
      every: { type: 'enum', of: [1, 2], label: L('組み替え（小節）', 'Recombine every (bars)'), auto: { pick: [1, 2], weights: [2, 1] } },
      thickness: { type: 'num', min: 0.5, max: 2, step: 0.05, unit: 'x', label: L('線の太さ', 'Line weight'), ui: 'advanced',
        auto: { range: [0.9, 1.15] } },
      dial: { type: 'bool', label: L('奥の目盛り', 'Dial behind'), auto: { pick: [true, false], weights: [2, 1] } },
      shape: SHAPE_PARAM,
    },
    build: shapesBuild,
  });

  return [lightMotes, soundHorizon, kineticShapes];
});
