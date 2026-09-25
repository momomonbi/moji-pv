/* 文字PVメーカー v2 — original work. Instrument-like decorations: dot matrix, bar code, cross hair, serial mark (DESIGN §5.6). */
MV.def('parts/ornament/digital', ['parts/kit'], (K) => {
  'use strict';

  const LYRIC_ROLES = ['lyric', 'focus'];
  const EASE_OUT = K.ease('cubicOut');
  const EASE_IN = K.ease('quadIn');
  const MIN_SCALE = 1e-4;          // a node never scales to exactly 0 (its matrix stays invertible)
  const LEVEL_HZ = 20;             // loudness samples per second kept for barCode (the plan's envelope rate)
  const DEG = K.math.DEG;

  // --- geometry and timing ----------------------------------------------------------------------------------------------

  // The text block (env.hints.focus); a block too small to decorate becomes a modest box in the middle of the frame.
  function focusOf(env) {
    const f = env.hints && env.hints.focus, D = env.D;
    const ok = f && [f.x, f.y, f.w, f.h].every(Number.isFinite);
    const w = ok ? Math.max(f.w, 24) : 0.3 * D.short, h = ok ? Math.max(f.h, 24) : 0.12 * D.short;
    const cx = ok ? f.x + f.w / 2 : D.cx, cy = ok ? f.y + f.h / 2 : D.cy;
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, x1: cx + w / 2, y1: cy + h / 2 };
  }

  // Where a w × h block sits beside the text: right of it, else left, else below, else above (centred on the text
  // along the other axis), always inside the safe area.
  function besideText(env, f, w, h, gap) {
    const D = env.D, m = D.safe;
    const fits = (x, y) => x >= m.l && y >= m.t && x + w <= D.w - m.r && y + h <= D.h - m.b;
    const spots = [[f.x1 + gap, f.cy - h / 2], [f.x - gap - w, f.cy - h / 2], [f.cx - w / 2, f.y1 + gap], [f.cx - w / 2, f.y - gap - h]];
    const spot = spots.find(([x, y]) => fits(x, y)) || spots[2];
    return { x: K.math.clamp(spot[0], m.l, Math.max(m.l, D.w - m.r - w)), y: K.math.clamp(spot[1], m.t, Math.max(m.t, D.h - m.b - h)) };
  }

  function behave(env, run, nodes, fields) {
    env.sb.behave(Object.assign({}, fields, { phase: K.PH.ORNAMENT, live: 'always', from: Math.min(...nodes),
      to: Math.max(...nodes) + 1, t0: env.times.a, t1: env.times.b, run, nodes: Int32Array.from(nodes) }));
  }

  function entrance(env) { return Math.max(env.times.a, env.times.rest - 0.25); }

  // --- a small stroke font for numbers (monospace, 2 × 4 units per character, 3 units apart) ----------------------------

  const STROKES = Object.freeze({
    0: [[0, 0, 2, 0, 2, 4, 0, 4, 0, 0], [1.6, 0.6, 0.4, 3.4]],
    1: [[0.4, 0.8, 1, 0, 1, 4], [0.3, 4, 1.7, 4]],
    2: [[0, 0, 2, 0, 2, 2, 0, 2, 0, 4, 2, 4]],
    3: [[0, 0, 2, 0, 2, 4, 0, 4], [0.7, 2, 2, 2]],
    4: [[0, 0, 0, 2, 2, 2], [2, 0, 2, 4]],
    5: [[2, 0, 0, 0, 0, 2, 2, 2, 2, 4, 0, 4]],
    6: [[2, 0, 0, 0, 0, 4, 2, 4, 2, 2, 0, 2]],
    7: [[0, 0, 2, 0, 2, 4]],
    8: [[0, 0, 2, 0, 2, 4, 0, 4, 0, 0], [0, 2, 2, 2]],
    9: [[2, 2, 0, 2, 0, 0, 2, 0, 2, 4, 0, 4]],
    ':': [[1, 0.9, 1, 1.3], [1, 2.7, 1, 3.1]],
    '.': [[1, 3.6, 1, 4]],
    '-': [[0.3, 2, 1.7, 2]],
  });
  const ADVANCE = 3;

  // The strokes of `text` (unknown characters leave a gap) with its top-left at (x, y), `size` du tall.
  function numberPath(text, x, y, size) {
    const u = size / 4, cmds = [];
    for (let c = 0; c < text.length; c++) {
      for (const line of STROKES[text[c]] || []) {
        for (let k = 0; k < line.length; k += 2) cmds.push([k ? 'L' : 'M', x + (c * ADVANCE + line[k]) * u, y + line[k + 1] * u]);
      }
    }
    return K.shape.path(cmds.length ? cmds : [['M', x, y]]);
  }

  function numberWidth(text, size) { return ((text.length * ADVANCE - 1) * size) / 4; }

  // --- behaviours (module level, pure in t, allocation-free) --------------------------------------------------------------

  // Node k scales along one axis (0 = x, 1 = y) from 0 to 1 over [s[k], s[k] + d], in eight steps when `steps`,
  // and back over [o, o + od].
  function runGrow(P, t, b) {
    for (let k = 0; k < b.nodes.length; k++) {
      const i = b.nodes[k], u = K.math.clamp((t - b.s[k]) / b.d);
      const inK = b.steps ? Math.floor(u * 8) / 8 : EASE_OUT(u), outK = EASE_IN(K.math.clamp((t - b.o) / b.od));
      const v = Math.max(MIN_SCALE, inK * (1 - outK));
      if (b.axis[k] === 0) P.sx[i] *= v; else P.sy[i] *= v;
    }
  }

  // Node k turns in from `turn` radians in four snaps over [s, s + d].
  function runTurnIn(P, t, b) {
    const u = K.math.clamp((t - b.s) / b.d), k = 1 - Math.floor(u * 4) / 4;
    for (let j = 0; j < b.nodes.length; j++) P.rot[b.nodes[j]] += b.turn * k;
  }

  // Node k is hidden until s + k·step (a typewriter for characters).
  function runTypeOn(P, t, b) {
    for (let k = 0; k < b.nodes.length; k++) if (t < b.s + k * b.step) P.alpha[b.nodes[k]] *= 0;
  }

  // Bars shrink toward their base when the song is quiet: height × (1 − react · (1 − level) · weight[k]).
  function runBars(P, t, b) {
    const x = K.math.clamp((t - b.a) * LEVEL_HZ, 0, b.levels.length - 1);
    const i0 = Math.floor(x), i1 = Math.min(i0 + 1, b.levels.length - 1);
    const quiet = 1 - (b.levels[i0] + (b.levels[i1] - b.levels[i0]) * (x - i0));
    for (let k = 0; k < b.nodes.length; k++) P.sy[b.nodes[k]] *= Math.max(MIN_SCALE, 1 - b.react * quiet * b.weight[k]);
  }

  // --- pinDotBoard --------------------------------------------------------------------------------------------------------

  // The lit dots: a head sweeps across the columns (and wraps), lighting each column's dots by its bit pattern and
  // leaving a fading trail.
  function matrixDraw(g, t, d, q) {
    if (t < d.s) return;
    const span = d.cols + d.trail, head = K.math.fract((t - d.s) * d.rate / span) * span;
    for (let back = 0; back < d.trail; back++) {
      const c = Math.floor(head) - back;
      if (c < 0 || c >= d.cols) continue;
      g.beginPath();
      for (let r = 0; r < d.rows; r++) {
        if (!d.bits[r * d.cols + c]) continue;
        const x = d.x + (c + 0.5) * d.pitch, y = d.y + (r + 0.5) * d.pitch;
        g.moveTo(x + d.dot * 1.15, y);
        g.arc(x, y, d.dot * 1.15, 0, K.math.TAU);
      }
      g.fillStyle = q.rgba(d.ink, 1 - back / d.trail);
      g.fill();
    }
  }

  const pinDotBoard = K.ornament({
    key: 'pinDotBoard', scope: 'cut', follow: 'text',
    label: { ja: '点の列', en: 'Dot matrix' },
    blurb: { ja: '文字の横で小さな点の列が順に光る', en: 'Rows of small dots beside the text that light up in sequence' },
    tags: ['digital', 'retro'],
    traits: { roles: LYRIC_ROLES },
    params: {
      rows: { type: 'int', min: 2, max: 8, label: { ja: '行', en: 'Rows' }, auto: { pick: [3, 4, 5] } },
      cols: { type: 'int', min: 4, max: 40, label: { ja: '列', en: 'Columns' }, auto: { range: [12, 20] } },
      pitch: { type: 'num', min: 8, max: 48, step: 0.5, unit: 'du', label: { ja: '間隔', en: 'Pitch' }, auto: { range: [19, 25] } },
      rate: { type: 'num', min: 1, max: 40, step: 0.5, unit: 'Hz', label: { ja: '流れる速さ', en: 'Sweep rate' }, auto: { range: [7, 13], follow: 'energy' } },
    },
    build(env, p) {
      const { sb, D, rng } = env;
      const f = focusOf(env), gap = 0.03 * D.short, room = D.w - D.safe.l - D.safe.r;
      const cols = Math.max(2, Math.min(p.cols, Math.floor(room / p.pitch)));
      const w = cols * p.pitch, h = p.rows * p.pitch, at = besideText(env, f, w, h, gap);
      const dot = 0.3 * p.pitch, cmds = [];
      for (let r = 0; r < p.rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = at.x + (c + 0.5) * p.pitch, y = at.y + (r + 0.5) * p.pitch;
          cmds.push(['M', x + dot, y], ['E', x, y, dot, dot]);
        }
      }
      sb.shape({ layer: 'text', owner: env.owner, path: K.shape.path(cmds), fill: p.ink, alpha: 0.14 + 0.1 * p.amount });
      const bits = new Uint8Array(p.rows * cols);
      for (let k = 0; k < bits.length; k++) bits[k] = rng.chance(0.55) ? 1 : 0;
      sb.paint({ layer: 'text', bleed: 0, animated: true, owner: env.owner, draw: matrixDraw,
        data: { x: at.x, y: at.y, rows: p.rows, cols, pitch: p.pitch, dot, bits, rate: p.rate, trail: 4, ink: p.ink, s: entrance(env) } });
    },
  });

  // --- barCode ----------------------------------------------------------------------------------------------------------

  // m:ss.cc (or h:mm:ss.cc) of a time in seconds.
  function timecode(sec) {
    const cs = Math.max(0, Math.round(sec * 100));
    const pad = (n) => (n < 10 ? '0' : '') + n;
    const s = Math.floor(cs / 100) % 60, m = Math.floor(cs / 6000) % 60, h = Math.floor(cs / 360000);
    return (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(s) + '.' + pad(cs % 100);
  }

  const barCode = K.ornament({
    key: 'barCode', scope: 'cut', follow: 'text',
    label: { ja: 'バーコード', en: 'Bar code' },
    blurb: { ja: '小さなバーコードに、このカットの歌い出しの時刻', en: "A small barcode with the cut's start time printed under it" },
    tags: ['digital', 'serious'], needs: ['level'],
    traits: { roles: LYRIC_ROLES },
    params: {
      bars: { type: 'int', min: 8, max: 64, label: { ja: '本数', en: 'Bars' }, auto: { range: [22, 32] } },
      height: { type: 'num', min: 20, max: 200, step: 1, unit: 'du', label: { ja: '高さ', en: 'Height' }, auto: { range: [72, 100] } },
      react: { type: 'num', min: 0, max: 1, step: 0.01, label: { ja: '音への反応', en: 'Reaction' }, auto: { range: [0.15, 0.35] } },
    },
    build(env, p) {
      const { sb, D, rng } = env;
      const f = focusOf(env), u = p.height * 0.05, digits = p.height * 0.26;
      const widths = [], gaps = [];
      let w = 0;
      for (let k = 0; k < p.bars; k++) {
        widths.push(u * rng.pick([1, 1, 2, 3])); gaps.push(u * rng.pick([1, 1, 2]));
        w += widths[k] + (k < p.bars - 1 ? gaps[k] : 0);
      }
      // the cut's sung start: the plan's cut carries no line start (it equals the line's start on the line's first cut)
      const stamp = timecode(env.cut ? env.cut.t0 : 0);
      w = Math.max(w, numberWidth(stamp, digits));
      const h = p.height + digits * 1.6, at = besideText(env, f, w, h, 0.03 * D.short);
      const g = sb.group({ layer: 'text', x: at.x, y: at.y + p.height, owner: env.owner });
      const bars = [], weight = [];
      for (let k = 0, x = 0; k < p.bars; x += widths[k] + gaps[k], k++) {
        bars.push(sb.shape({ parent: g, layer: 'text', owner: env.owner, path: K.shape.rect(0, -p.height, widths[k], p.height), fill: p.ink,
          x, alpha: 0.85 }));
        weight.push(rng.range(0.3, 1));
      }
      sb.shape({ parent: g, layer: 'text', owner: env.owner, path: numberPath(stamp, 0, digits * 0.45, digits), stroke: p.ink,
        width: Math.max(1.2, digits * 0.1), cap: 'square', alpha: 0.9 });
      const T = env.times, levels = new Float32Array(Math.ceil((T.b - T.a) * LEVEL_HZ) + 2);
      for (let i = 0; i < levels.length; i++) levels[i] = env.level(T.a + i / LEVEL_HZ);
      behave(env, runBars, bars, { a: T.a, levels, react: p.react * (0.5 + 0.5 * p.amount), weight: Float32Array.from(weight) });
    },
  });

  // --- crossHair --------------------------------------------------------------------------------------------------------

  const crossHair = K.ornament({
    key: 'crossHair', scope: 'cut', follow: 'text',
    label: { ja: '照準', en: 'Cross hair' },
    blurb: { ja: '文字の中心を狙う十字の線と、見当合わせの印', en: 'A cross hair aimed at the centre of the text, with register marks' },
    tags: ['digital', 'hard'],
    traits: { roles: ['lyric', 'focus', 'title'] },
    params: {
      reach: { type: 'num', min: 0.04, max: 0.6, step: 0.01, unit: 'frac', label: { ja: '線の長さ', en: 'Reach' }, auto: { range: [0.12, 0.22] } },
      width: { type: 'num', min: 0.5, max: 6, step: 0.5, unit: 'du', label: { ja: '太さ', en: 'Width' }, auto: { pick: [2, 2.5] } },
      marks: { type: 'int', min: 0, max: 4, label: { ja: '見当の印', en: 'Register marks' }, auto: { pick: [2, 4] } },
      gap: { type: 'num', min: 0, max: 100, step: 1, unit: 'du', label: { ja: '間隔', en: 'Gap' }, auto: { range: [18, 34] } },
    },
    build(env, p) {
      const { sb, D } = env;
      const f = focusOf(env), L = p.reach * D.short, alpha = 0.55 + 0.45 * p.amount, s = entrance(env);
      // four hairlines on the axes through the centre, from the block's edges outward (they never cross the letters)
      const arms = [[f.x - p.gap, f.cy, 180], [f.x1 + p.gap, f.cy, 0], [f.cx, f.y - p.gap, 270], [f.cx, f.y1 + p.gap, 90]];
      const lines = [];
      for (const [x, y, deg] of arms) {
        const g = sb.group({ layer: 'text', x, y, rot: deg * DEG, owner: env.owner });
        sb.shape({ parent: g, layer: 'text', owner: env.owner, path: K.shape.line(0, 0, L, 0), stroke: p.ink, width: p.width, alpha });
        sb.shape({ parent: g, layer: 'text', owner: env.owner, path: K.shape.line(L * 0.35, -6, L * 0.35, 6), stroke: p.ink,
          width: p.width, alpha });
        lines.push(g);
      }
      behave(env, runGrow, lines, { axis: new Uint8Array(4), s: new Float32Array(4).fill(s), d: 0.3, steps: true, o: env.times.b, od: 1 });
      if (p.marks === 0) return;
      const r = 18, o = p.gap + r * 1.8;
      const spots = [[f.x - o, f.y - o], [f.x1 + o, f.y1 + o], [f.x1 + o, f.y - o], [f.x - o, f.y1 + o]].slice(0, p.marks);
      const marks = [];
      for (const [x, y] of spots) {
        const g = sb.group({ layer: 'text', x: K.math.clamp(x, r * 2, D.w - r * 2), y: K.math.clamp(y, r * 2, D.h - r * 2), owner: env.owner });
        sb.shape({ parent: g, layer: 'text', owner: env.owner, path: K.shape.ellipse(0, 0, r, r), stroke: p.ink, width: p.width, alpha });
        sb.shape({ parent: g, layer: 'text', owner: env.owner, stroke: p.ink, width: p.width, alpha,
          path: K.shape.path([['M', -r * 1.7, 0], ['L', r * 1.7, 0], ['M', 0, -r * 1.7], ['L', 0, r * 1.7]]) });
        marks.push(g);
      }
      behave(env, runTurnIn, marks, { s, d: 0.3, turn: Math.PI / 2 });
    },
  });

  // --- serialMark -------------------------------------------------------------------------------------------------------

  // The characters the stroke font can draw (a pinned number may hold anything); '00' when nothing is left.
  function drawable(text) { return String(text).replace(/[^0-9:.-]/g, '') || '00'; }

  const serialMark = K.ornament({
    key: 'serialMark', scope: 'cut', follow: 'text',
    label: { ja: '通し番号', en: 'Serial mark' },
    blurb: { ja: '行の番号を小さな等幅数字で添える', en: 'The line number in small monospace digits' },
    tags: ['minimal', 'digital'],
    traits: { roles: LYRIC_ROLES },
    params: {
      // A decoration may not read the cut's line id or absolute time (the fingerprint covers neither), so, as for the
      // sidebar composition's number, the auto is the line's place in the song; pin the row number to show it exactly.
      number: { type: 'text', max: 8, label: { ja: '番号', en: 'Number' },
        auto: {
          fn: (f) => {
            const n = Math.round(Math.min(0.99, Math.max(0, f.pos || 0)) * 100);
            return n < 10 ? '0' + n : String(n);
          },
          why: { ja: '曲の中の位置（%）を二桁の番号にする', en: 'The position in the song, as a two-digit percentage' } } },
      size: { type: 'num', min: 10, max: 80, step: 1, unit: 'du', label: { ja: '文字の高さ', en: 'Digit height' }, auto: { range: [30, 40] } },
      place: { type: 'enum', of: ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'], label: { ja: '位置', en: 'Place' },
        auto: { pick: ['topLeft', 'bottomRight', 'topRight', 'bottomLeft'], weights: [3, 2, 1, 1] } },
      rule: { type: 'bool', label: { ja: '線を添える', en: 'Rule' }, auto: { pick: [true, false], weights: [2, 1] } },
      gap: { type: 'num', min: 0, max: 80, step: 1, unit: 'du', label: { ja: '間隔', en: 'Gap' }, auto: { range: [14, 26] } },
    },
    build(env, p) {
      const { sb, D } = env;
      const f = focusOf(env), m = D.safe, text = drawable(p.number), size = p.size;
      const ruleLen = p.rule ? size * 1.8 : 0, lead = p.rule ? ruleLen + size * 0.5 : 0;
      const w = lead + numberWidth(text, size);
      let top = /^top/.test(p.place);
      if (top && f.y - p.gap - size < m.t) top = false;
      if (!top && f.y1 + p.gap + size > D.h - m.b) top = true;
      const x = K.math.clamp(/Left$/.test(p.place) ? f.x : f.x1 - w, m.l, Math.max(m.l, D.w - m.r - w));
      const y = K.math.clamp(top ? f.y - p.gap - size : f.y1 + p.gap, m.t, Math.max(m.t, D.h - m.b - size));
      const alpha = 0.6 + 0.4 * p.amount, width = Math.max(1.2, size * 0.1), s = entrance(env);
      const g = sb.group({ layer: 'text', x, y, owner: env.owner });
      const chars = [];
      if (p.rule) {
        const rule = sb.group({ parent: g, layer: 'text', x: 0, y: size / 2, owner: env.owner });
        sb.shape({ parent: rule, layer: 'text', owner: env.owner, path: K.shape.line(0, 0, ruleLen, 0), stroke: p.ink, width, alpha });
        behave(env, runGrow, [rule], { axis: new Uint8Array(1), s: Float32Array.of(s), d: 0.3, steps: false, o: env.times.b, od: 1 });
      }
      for (let c = 0; c < text.length; c++) {
        chars.push(sb.shape({ parent: g, layer: 'text', owner: env.owner, path: numberPath(text[c], lead + (c * ADVANCE * size) / 4, 0, size),
          stroke: p.ink, width, cap: 'square', alpha }));
      }
      behave(env, runTypeOn, chars, { s: s + 0.15, step: 0.07 });
    },
  });

  return [pinDotBoard, barCode, crossHair, serialMark];
});
