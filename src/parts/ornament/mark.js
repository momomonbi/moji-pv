/* 文字PVメーカー v2 — original work. Marks and strokes around the text: hanko seal, ink splat, under sweep, wave line, sun burst, spark spray (DESIGN §5.6). */
MV.def('parts/ornament/mark', ['parts/kit'], (K) => {
  'use strict';

  const LYRIC_ROLES = ['lyric', 'focus'];
  const CARD_ROLES = ['lyric', 'focus', 'title', 'outro'];
  const EASE_OUT = K.ease('cubicOut');
  const EASE_IN = K.ease('quadIn');
  const BACK_OUT = K.ease('backOut');
  const MIN_SCALE = 1e-4;          // a node never scales to exactly 0 (its matrix stays invertible)
  const GRAVITY = 900;             // du/s², for sparks
  const SPLAT_BODY = 1.3;          // an ink splash's body reaches this × its radius at most (lumps and burst overshoot)
  const SPLAT_SPREAD = 1.35;       // radians: fingers and droplets fly within this of the way the splash is thrown
  const SPLAT_CLEAR = 10;          // du between a splash's body and the text block
  const EMPH_SCALE = 1.15;         // emphasized glyphs are set this much larger (the RunSpec default, §4.15.4)
  const LINE_PITCH = 1.35;         // em from one line (or column) to the next, for telling one line from several
  const ONE_LINE = 1.45;           // an estimated line count below this is one line
  const KEY_GREEN = '#00B140';     // the green-screen key, the ground of a chroma palette (§4.16.3, §4.19.4)
  const TAU = K.math.TAU;
  const DEG = K.math.DEG;

  // The paper a stamp's carving shows: the 'ground' token, except on a green screen, where the ground is the key and a
  // carved character, ring or speck of it would be keyed out or spill green into the seal; a neutral paper of the
  // theme's lightness (light under dark ink, dark under light ink) stands in there.
  function paperOf(pal) {
    if (String(pal.ground).toUpperCase() !== KEY_GREEN) return 'ground';
    const n = parseInt(String(pal.ink).slice(1, 7), 16);
    const inkLuma = 0.3 * ((n >> 16) & 255) + 0.59 * ((n >> 8) & 255) + 0.11 * (n & 255);
    return inkLuma < 128 ? '#F4F4F4' : '#1E1E1E';
  }

  // --- geometry and timing ----------------------------------------------------------------------------------------------

  // The text block (env.hints.focus); a block too small to decorate becomes a modest box in the middle of the frame.
  function focusOf(env) {
    const f = env.hints && env.hints.focus, D = env.D;
    const ok = f && [f.x, f.y, f.w, f.h].every(Number.isFinite);
    const w = ok ? Math.max(f.w, 24) : 0.3 * D.short, h = ok ? Math.max(f.h, 24) : 0.12 * D.short;
    const cx = ok ? f.x + f.w / 2 : D.cx, cy = ok ? f.y + f.h / 2 : D.cy;
    return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, x1: cx + w / 2, y1: cy + h / 2 };
  }

  // Cut-local windows of a decoration that animates itself: in over [s, s + d] as the text starts to appear, out over
  // [o, o + od], ending with the cut (and never starting later than the text's own exit).
  function windows(env, inDur) {
    const T = env.times, span = T.b - T.a;
    const d = Math.max(0.05, Math.min(inDur, 0.45 * span));
    const od = Math.max(0.05, Math.min(0.35, 0.3 * span));
    const o = Math.min(T.out, T.b - od);
    return { s: T.a + 0.04, d, o, od: T.b - o };
  }

  // Where the first emphasis starts, as a share of the text's characters (0 without one): when it is sung.
  function sungShare(env) {
    const text = (env.cut && env.cut.text) || '', e = env.cut && env.cut.emph;
    return text && Array.isArray(e) && e.length ? K.math.clamp(e[0][0] / text.length) : 0;
  }

  // Estimated advance of a character along its line, in em: full-width scripts 1, spaces 0.3, everything else (Latin
  // letters, digits, half-width punctuation; turned in a vertical column, they keep their width) 0.56.
  const WIDE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303F\uFF01-\uFF60]/u;
  function advanceOf(ch) { return /\s/.test(ch) ? 0.3 : WIDE.test(ch) ? 1 : 0.56; }

  // The share [f0, f1] of the reading axis covered by the first emphasis, or [0, 1] (the whole block) when nothing is
  // emphasized or the text is set on more than one line (or column). The decoration has no glyph positions, so both are
  // estimated from the characters: the text is `total` em long on one line, and a block of n lines is about total / n
  // long and n line pitches deep, so n ≈ √(total · depth / (length · pitch)). One line is then exact up to the
  // estimated advances; on several lines the emphasis could be on any of them, and the sweep runs under the whole block.
  function emphShare(env, f, vertical) {
    const text = (env.cut && env.cut.text) || '', e = env.cut && env.cut.emph;
    if (!text || !Array.isArray(e) || !e.length || !(e[0][1] > e[0][0])) return [0, 1];
    let before = 0, inside = 0, total = 0;
    for (let i = 0; i < text.length;) {
      const ch = String.fromCodePoint(text.codePointAt(i));
      const inEmph = i >= e[0][0] && i < e[0][1], a = advanceOf(ch) * (inEmph ? EMPH_SCALE : 1);
      if (i < e[0][0]) before += a; else if (inEmph) inside += a;
      total += a;
      i += ch.length;
    }
    const along = vertical ? f.h : f.w, across = vertical ? f.w : f.h;
    const lines = Math.sqrt((total * across) / (Math.max(1, along) * LINE_PITCH));
    if (!(total > 0) || lines >= ONE_LINE) return [0, 1];
    return [K.math.clamp(before / total), K.math.clamp((before + inside) / total)];
  }

  function behave(env, run, nodes, fields) {
    env.sb.behave(Object.assign({}, fields, { phase: K.PH.ORNAMENT, live: 'always', from: Math.min(...nodes),
      to: Math.max(...nodes) + 1, t0: env.times.a, t1: env.times.b, run, nodes: Int32Array.from(nodes) }));
  }

  // --- behaviours (module level, pure in t, allocation-free) --------------------------------------------------------------

  // A stamp: invisible before s[k], then it drops from scale `drop` onto the page over `d` seconds and settles.
  function runStamp(P, t, b) {
    for (let k = 0; k < b.nodes.length; k++) {
      const i = b.nodes[k], u = (t - b.s[k]) / b.d;
      if (u < 0) { P.alpha[i] *= 0; continue; }
      const land = EASE_IN(K.math.clamp(u));
      const settle = u > 1 ? 1 - 0.035 * Math.sin(Math.PI * K.math.clamp((u - 1) / 0.8)) : 1;
      const v = (b.drop + (1 - b.drop) * land) * settle;
      P.sx[i] *= v; P.sy[i] *= v;
      P.alpha[i] *= K.math.clamp(u * 3);
    }
  }

  // Splashes burst open at s[k] with an overshoot.
  function runBurst(P, t, b) {
    for (let k = 0; k < b.nodes.length; k++) {
      const i = b.nodes[k], u = (t - b.s[k]) / b.d;
      if (u < 0) { P.alpha[i] *= 0; continue; }
      const v = Math.max(MIN_SCALE, 0.25 + 0.75 * BACK_OUT(K.math.clamp(u)));
      P.sx[i] *= v; P.sy[i] *= v;
      P.alpha[i] *= K.math.clamp(u * 2.5);
    }
  }

  // A bar grows from its start along one axis over [s, s + d], then slides its start to its end over [o, o + od].
  function runSweep(P, t, b) {
    const grow = EASE_OUT(K.math.clamp((t - b.s) / b.d)), gone = EASE_IN(K.math.clamp((t - b.o) / b.od));
    const len = Math.max(MIN_SCALE, grow - gone), i = b.nodes[0];
    if (b.axis === 0) { P.x[i] += gone * b.len; P.sx[i] *= len; } else { P.y[i] += gone * b.len; P.sy[i] *= len; }
  }

  // An ellipse as its own subpath (a path's ellipse would otherwise be joined to the previous point by a line).
  function dot(cmds, cx, cy, rx, ry) { cmds.push(['M', cx + rx, cy], ['E', cx, cy, rx, ry]); }

  // --- hankoSeal --------------------------------------------------------------------------------------------------------

  const HAN = /\p{Script=Han}/u;
  const LETTER = /[\p{L}\p{N}]/u;

  // The character carved in the seal: a kanji of the emphasis, else the last kanji of the line, else its first letter.
  function sealChar(env) {
    const text = (env.cut && env.cut.text) || '', e = env.cut && env.cut.emph;
    const chars = Array.from(text);
    if (Array.isArray(e) && e.length) {
      const inEmph = Array.from(text.slice(e[0][0], e[0][1]));
      const han = inEmph.find((c) => HAN.test(c));
      if (han) return han;
    }
    for (let k = chars.length - 1; k >= 0; k--) if (HAN.test(chars[k])) return chars[k];
    const first = chars.find((c) => LETTER.test(c));
    return first ? first.toUpperCase() : '印';
  }

  // A square of side s with softly rounded, slightly uneven edges (a stamp never prints a perfect square).
  function sealPath(rng, s) {
    const pts = [], half = s / 2, r = 0.1 * s, n = 9;
    const corners = [[half - r, -half + r, -90], [half - r, half - r, 0], [-half + r, half - r, 90], [-half + r, -half + r, 180]];
    for (const [cx, cy, a0] of corners) {
      for (let k = 0; k <= n; k++) {
        const a = (a0 + (90 * k) / n) * DEG, j = 1 + rng.range(-0.018, 0.018);
        pts.push(cx * j + Math.cos(a) * r, cy * j + Math.sin(a) * r);
      }
    }
    return K.shape.poly(pts, true);
  }

  const hankoSeal = K.ornament({
    key: 'hankoSeal', scope: 'cut', follow: 'text',
    label: { ja: '印', en: 'Hanko seal' },
    blurb: { ja: '文字のそばに朱の角印が押される', en: 'A red square seal stamped near the text' },
    tags: ['literary', 'serious'],
    traits: { roles: CARD_ROLES },
    shared: { ink: { auto: { value: 'accent' } } },
    params: {
      size: { type: 'num', min: 0.03, max: 0.16, step: 0.005, unit: 'frac', label: { ja: '大きさ', en: 'Size' }, auto: { range: [0.07, 0.095] } },
      turn: { type: 'num', min: -15, max: 15, step: 0.5, unit: 'deg', label: { ja: '傾き', en: 'Tilt' }, auto: { range: [-6, 6] } },
      style: { type: 'enum', of: ['solid', 'line'], label: { ja: '押し方', en: 'Style' }, auto: { pick: ['solid', 'line'], weights: [2, 1] } },
      gap: { type: 'num', min: 0, max: 100, step: 1, unit: 'du', label: { ja: '間隔', en: 'Gap' }, auto: { range: [20, 40] } },
    },
    build(env, p) {
      const { sb, D, rng } = env;
      const f = focusOf(env), s = p.size * D.short, m = D.safe;
      // after the end of the text: right of the last line (horizontal) or under the last column (vertical); inside the frame
      let cx, cy;
      if (env.orient === 'v') {
        cx = f.x + s / 2; cy = f.y1 + p.gap + s / 2;
        if (cy + s / 2 > D.h - m.b) { cx = f.x - p.gap - s / 2; cy = f.y1 - s / 2; }
      } else {
        cx = f.x1 + p.gap + s / 2; cy = f.y1 - s / 2;
        if (cx + s / 2 > D.w - m.r) { cx = f.x1 - s / 2; cy = f.y1 + p.gap + s / 2; }
      }
      cx = K.math.clamp(cx, m.l + s / 2, D.w - m.r - s / 2); cy = K.math.clamp(cy, m.t + s / 2, D.h - m.b - s / 2);
      const g = sb.group({ layer: 'text', x: cx, y: cy, rot: p.turn * DEG, owner: env.owner });
      const solid = p.style === 'solid', alpha = 0.7 + 0.3 * p.amount, paper = paperOf(env.pal);
      sb.shape(Object.assign({ parent: g, layer: 'text', owner: env.owner, path: sealPath(rng, s), alpha },
        solid ? { fill: p.ink } : { stroke: p.ink, width: 0.075 * s }));
      if (solid) {
        sb.shape({ parent: g, layer: 'text', owner: env.owner, path: K.shape.rect(-0.39 * s, -0.39 * s, 0.78 * s, 0.78 * s, 0.05 * s),
          stroke: paper, width: 0.022 * s, alpha: 0.85 });
        const specks = [];
        for (let k = 0; k < 7; k++) {
          const r = s * rng.range(0.008, 0.02);
          dot(specks, rng.range(-0.44, 0.44) * s, rng.range(-0.44, 0.44) * s, r * rng.range(1, 2.2), r);
        }
        sb.shape({ parent: g, layer: 'text', owner: env.owner, path: K.shape.path(specks), fill: paper, alpha: 0.55 });
      }
      sb.text({ parent: g, owner: env.owner, text: sealChar(env), box: { x: -0.36 * s, y: -0.36 * s, w: 0.72 * s, h: 0.72 * s },
        size: 0.6 * s, face: 'serif', orient: 'h', align: 'center', valign: 'center', fit: 'shrink', maxLines: 1, breakAt: 'none',
        tracking: 0, leading: 1, ink: solid ? paper : p.ink, style: 'plain' });
      const T = env.times, at = K.math.clamp(T.rest - 0.05, T.a + 0.05, Math.max(T.a + 0.05, T.out - 0.25));
      behave(env, runStamp, [g], { s: Float32Array.of(at), d: 0.16, drop: 1.55 });
    },
  });

  // --- inkSplat ---------------------------------------------------------------------------------------------------------

  // One splash of radius r at the origin: a lumpy blob (a smooth closed curve through jittered points), a few short
  // fingers ending in drops, and a spray of droplets thrown toward `throwAt` (radians). Nothing reaches more than
  // SPLAT_BODY·r from the origin except what is thrown within SPLAT_SPREAD of that way.
  function splatPath(rng, r, throwAt) {
    const cmds = [], n = 26, px = [], py = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU, rr = r * (0.74 + 0.26 * rng.next()) * (rng.chance(0.2) ? 1.16 : 1);
      px.push(Math.cos(a) * rr); py.push(Math.sin(a) * rr);
    }
    const mid = (k) => [(px[k % n] + px[(k + 1) % n]) / 2, (py[k % n] + py[(k + 1) % n]) / 2];
    cmds.push(['M', ...mid(n - 1)]);
    for (let k = 0; k < n; k++) cmds.push(['Q', px[k], py[k], ...mid(k)]);
    cmds.push(['Z']);
    for (let k = rng.int(3, 6); k > 0; k--) {
      const a = throwAt + rng.range(-SPLAT_SPREAD, SPLAT_SPREAD), len = r * rng.range(1.02, 1.35), w = rng.range(0.1, 0.18);
      const nx = Math.cos(a + Math.PI / 2), ny = Math.sin(a + Math.PI / 2), neck = r * w * 0.22;
      const ux = Math.cos(a), uy = Math.sin(a);
      cmds.push(['M', Math.cos(a - w) * r * 0.7, Math.sin(a - w) * r * 0.7],
        ['Q', ux * len * 0.78 - nx * neck, uy * len * 0.78 - ny * neck, ux * len - nx * neck, uy * len - ny * neck],
        ['L', ux * len + nx * neck, uy * len + ny * neck],
        ['Q', ux * len * 0.78 + nx * neck, uy * len * 0.78 + ny * neck, Math.cos(a + w) * r * 0.7, Math.sin(a + w) * r * 0.7], ['Z']);
      const d = r * w * rng.range(0.45, 0.7);
      dot(cmds, ux * (len + d * 0.4), uy * (len + d * 0.4), d, d * 0.85);
    }
    for (let k = rng.int(8, 16); k > 0; k--) {
      const a = throwAt + rng.range(-1, 1) * rng.range(0.3, SPLAT_SPREAD), dist = r * rng.range(1.3, 2.6), d = r * rng.range(0.02, 0.08);
      dot(cmds, Math.cos(a) * dist, Math.sin(a) * dist, d, d * rng.range(0.7, 1.1));
    }
    return K.shape.path(cmds);
  }

  const inkSplat = K.ornament({
    key: 'inkSplat', scope: 'cut', follow: 'text',
    label: { ja: '墨はね', en: 'Ink splat' },
    blurb: { ja: '文字のまわりに墨がはねる', en: 'A few ink splashes near the text' },
    tags: ['organic', 'hard'],
    traits: { roles: LYRIC_ROLES },
    shared: { ink: { auto: { pick: ['accent', 'muted', 'ink'], weights: [4, 1, 1] } } },
    params: {
      splashes: { type: 'int', min: 1, max: 5, label: { ja: '数', en: 'Splashes' }, auto: { range: [2, 3] } },
      size: { type: 'num', min: 0.04, max: 0.3, step: 0.005, unit: 'frac', label: { ja: '大きさ', en: 'Size' }, auto: { range: [0.11, 0.17] } },
    },
    build(env, p) {
      const { sb, D, rng } = env;
      const f = focusOf(env), H = Math.SQRT1_2;
      // anchors on the block's outline (its corners and the middles of its sides) with their outward directions, taken
      // in a seeded order
      const spots = rng.shuffle([[f.x, f.y, -H, -H], [f.x1, f.y1, H, H], [f.x1, f.y, H, -H], [f.x, f.y1, -H, H],
        [f.x, f.cy, -1, 0], [f.x1, f.cy, 1, 0], [f.cx, f.y, 0, -1], [f.cx, f.y1, 0, 1]]);
      const nodes = [], s = [], placed = [];
      for (let k = 0; k < p.splashes && spots.length; k++) {
        const r = 0.5 * p.size * D.short * rng.range(0.65, 1.1), out = SPLAT_BODY * r + SPLAT_CLEAR;
        // the splash sits out from its anchor far enough that its body never reaches the block, and throws its fingers
        // and droplets away from the block: the text stays clear of ink (the splash is drawn behind it, often in the
        // accent that its emphasized words wear). Anchors whose splash lands well inside the frame, apart from the
        // splashes already made, come first.
        const at = (q) => [q[0] + q[2] * out, q[1] + q[3] * out];
        const inFrame = (q) => { const [x, y] = at(q); return x >= 0.8 * r && x <= D.w - 0.8 * r && y >= 0.8 * r && y <= D.h - 0.8 * r; };
        const apart = (q) => { const [x, y] = at(q); return placed.every(([px, py, pr]) => Math.hypot(x - px, y - py) > 2 * (r + pr)); };
        let pick = spots.findIndex((q) => inFrame(q) && apart(q));
        if (pick < 0) pick = Math.max(0, spots.findIndex(inFrame));
        const spot = spots.splice(pick, 1)[0], [ox, oy] = at(spot), rot = rng.range(0, TAU);
        placed.push([ox, oy, r]);
        const g = sb.group({ layer: 'mid', x: ox, y: oy, rot, owner: env.owner });
        sb.shape({ parent: g, layer: 'mid', owner: env.owner, path: splatPath(rng, r, Math.atan2(spot[3], spot[2]) - rot), fill: p.ink,
          alpha: 0.55 + 0.4 * p.amount });
        nodes.push(g); s.push(Math.max(env.times.a, -0.02) + 0.06 * k);
      }
      behave(env, runBurst, nodes, { s: Float32Array.from(s), d: 0.2 });
    },
  });

  // --- underSweep -------------------------------------------------------------------------------------------------------

  const underSweep = K.ornament({
    key: 'underSweep', scope: 'cut', follow: 'own',
    label: { ja: '下線', en: 'Under sweep' },
    blurb: { ja: '強調した言葉の下を、アクセント色の線が走る', en: 'An accent underline sweeps under the emphasized word' },
    tags: ['bold', 'minimal'],
    traits: { roles: LYRIC_ROLES },
    shared: { ink: { auto: { value: 'accent' } } },
    params: {
      thick: { type: 'num', min: 2, max: 40, step: 0.5, unit: 'du', label: { ja: '太さ', en: 'Thickness' }, auto: { range: [8, 14] } },
      gap: { type: 'num', min: 0, max: 60, step: 1, unit: 'du', label: { ja: '間隔', en: 'Gap' }, auto: { range: [8, 18] } },
      delay: { type: 'num', min: 0, max: 1.5, step: 0.01, unit: 's', label: { ja: '遅れ', en: 'Delay' }, auto: { range: [0.05, 0.2] } },
    },
    build(env, p) {
      const { sb, D } = env;
      const f = focusOf(env), vertical = env.orient === 'v', [f0, f1] = emphShare(env, f, vertical), T = env.times;
      // horizontal text: under the words; vertical text: a side line to the right of the column (傍線). The emphasized
      // span is the engine's box when it gives one (hints.emph), else its estimated share of a single line, else the
      // whole block (text on several lines or columns).
      const e = env.hints && env.hints.emph;
      const span = e && [e.x, e.y, e.w, e.h].every(Number.isFinite) ? e
        : { x: vertical ? f.x : f.x + f0 * f.w, y: vertical ? f.y + f0 * f.h : f.y, w: vertical ? f.w : (f1 - f0) * f.w,
          h: vertical ? (f1 - f0) * f.h : f.h };
      const x = vertical ? Math.min(Math.max(f.x1, span.x + span.w) + p.gap, D.w - p.thick) : span.x;
      const y = vertical ? span.y : Math.min(span.y + span.h + p.gap, D.h - p.thick);
      const len = Math.max(p.thick, vertical ? span.h : span.w);
      const g = sb.group({ layer: 'text', x, y, owner: env.owner });
      sb.shape({ parent: g, layer: 'text', owner: env.owner, fill: p.ink, alpha: 0.75 + 0.25 * p.amount,
        path: vertical ? K.shape.rect(0, 0, p.thick, len) : K.shape.rect(0, 0, len, p.thick) });
      // the sweep lands as the emphasized word is sung (its share of the characters of the line's time), once the text is in
      const sung = sungShare(env) * Math.max(0, (env.cut ? env.cut.t1 - env.cut.t0 : 0));
      const s = K.math.clamp(Math.max(T.rest, sung) + p.delay, T.a, Math.max(T.a, T.b - 0.6));
      const w = windows(env, 0.35);
      behave(env, runSweep, [g], { axis: vertical ? 1 : 0, len, s, d: 0.32, o: Math.max(w.o, s + 0.32), od: w.od });
    },
  });

  // --- ripplePath ---------------------------------------------------------------------------------------------------------

  // A sine line along the text's reading axis that ripples; it draws itself from its start and wipes away at the end.
  function waveDraw(g, t, d, q) {
    const grow = EASE_OUT(K.math.clamp((t - d.s) / d.d)), gone = EASE_IN(K.math.clamp((t - d.o) / d.od));
    if (grow - gone <= 0.002) return;
    const step = q.draft ? 10 : 5, from = gone * d.len, to = grow * d.len, ph = TAU * d.speed * t;
    g.beginPath();
    for (let u = from; u <= to + step * 0.5; u += step) {
      const v = Math.min(u, to);
      const taper = Math.sin(Math.PI * K.math.clamp(v / d.len));
      const off = d.amp * Math.sqrt(taper) * Math.sin(TAU * v / d.wave - ph);
      const x = d.vertical ? d.x + off : d.x + v, y = d.vertical ? d.y + v : d.y + off;
      if (u === from) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = q.rgba(d.ink, d.alpha);
    g.lineWidth = d.width;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.stroke();
  }

  const ripplePath = K.ornament({
    key: 'ripplePath', scope: 'cut', follow: 'own',
    label: { ja: '波線', en: 'Wave line' },
    blurb: { ja: '文字の下で波打つ線がさざめく', en: 'A wavy underline that ripples' },
    tags: ['playful', 'organic'],
    traits: { roles: LYRIC_ROLES },
    params: {
      amp: { type: 'num', min: 1, max: 40, step: 0.5, unit: 'du', label: { ja: '振れ幅', en: 'Amplitude' }, auto: { range: [8, 14] } },
      wave: { type: 'num', min: 16, max: 240, step: 1, unit: 'du', label: { ja: '波長', en: 'Wavelength' }, auto: { range: [52, 88] } },
      speed: { type: 'num', min: 0, max: 4, step: 0.05, unit: 'Hz', label: { ja: '揺れの速さ', en: 'Ripple speed' },
        auto: { range: [0.6, 1.4], follow: 'energy' } },
      width: { type: 'num', min: 1, max: 12, step: 0.5, unit: 'du', label: { ja: '太さ', en: 'Width' }, auto: { pick: [4, 5, 6] } },
    },
    build(env, p) {
      const { sb, D } = env;
      const f = focusOf(env), vertical = env.orient === 'v', w = windows(env, 0.6), gap = p.amp + 12;
      const data = vertical
        ? { x: Math.min(f.x1 + gap, D.w - p.amp - 4), y: f.y, len: f.h }
        : { x: f.x, y: Math.min(f.y1 + gap, D.h - p.amp - 4), len: f.w };
      sb.paint({ layer: 'text', bleed: 0, animated: true, owner: env.owner, draw: waveDraw,
        data: Object.assign(data, { vertical, amp: p.amp, wave: p.wave, speed: p.speed, width: p.width, ink: p.ink,
          alpha: 0.75 + 0.25 * p.amount, s: w.s, d: w.d, o: w.o, od: w.od }) });
    },
  });

  // --- sunBurst ---------------------------------------------------------------------------------------------------------

  // Wedges radiating from the centre of the text, turning slowly, lit by a radial fade that is clear right behind the
  // letters, strongest further out and gone at the reach.
  function burstDraw(g, t, d, q) {
    const R = d.R * (0.35 + 0.65 * EASE_OUT(K.math.clamp((t - d.s) / d.d)));
    const grad = g.createRadialGradient(d.cx, d.cy, 0, d.cx, d.cy, R);
    grad.addColorStop(0, q.rgba(d.ink, 0)); grad.addColorStop(0.2, q.rgba(d.ink, d.alpha * 0.45));
    grad.addColorStop(0.5, q.rgba(d.ink, d.alpha)); grad.addColorStop(0.9, q.rgba(d.ink, 0));
    const step = TAU / d.rays, spin = d.turn * t + d.phase;
    g.beginPath();
    for (let k = 0; k < d.rays; k++) {
      const a = spin + k * step, b = a + step * d.share;
      g.moveTo(d.cx, d.cy);
      g.lineTo(d.cx + Math.cos(a) * R, d.cy + Math.sin(a) * R);
      g.lineTo(d.cx + Math.cos(b) * R, d.cy + Math.sin(b) * R);
      g.closePath();
    }
    g.fillStyle = grad;
    g.fill();
  }

  const sunBurst = K.ornament({
    key: 'sunBurst', scope: 'cut', follow: 'text',
    label: { ja: '放射線', en: 'Sun burst' },
    blurb: { ja: '文字の後ろから細い光線が放射状に広がる', en: 'Thin rays radiating from behind the text' },
    tags: ['bright', 'bold'],
    traits: { roles: CARD_ROLES },
    shared: { ink: { auto: { pick: ['accent', 'shiftB', 'muted'], weights: [3, 2, 1] } } },
    params: {
      rays: { type: 'int', min: 6, max: 72, label: { ja: '光線の数', en: 'Rays' }, auto: { range: [28, 44] } },
      share: { type: 'num', min: 0.05, max: 0.9, step: 0.01, unit: 'frac', label: { ja: '光線の太さ', en: 'Ray width' }, auto: { range: [0.12, 0.22] } },
      turn: { type: 'num', min: -20, max: 20, step: 0.5, unit: 'deg', label: { ja: '回転（毎秒）', en: 'Turn (per second)' },
        auto: { pick: [-3, -1.5, 1.5, 3] } },
      reach: { type: 'num', min: 0.3, max: 1.6, step: 0.01, unit: 'frac', label: { ja: '届く距離', en: 'Reach' }, auto: { range: [0.85, 1.25] } },
    },
    build(env, p) {
      const { sb, D, rng } = env;
      const f = focusOf(env), w = windows(env, 0.6);
      sb.paint({ layer: 'mid', bleed: 0, animated: true, owner: env.owner, draw: burstDraw,
        data: { cx: f.cx, cy: f.cy, R: p.reach * D.short, rays: p.rays, share: p.share, turn: p.turn * DEG, phase: rng.range(0, TAU),
          ink: p.ink, alpha: 0.07 + 0.11 * p.amount, s: w.s, d: w.d } });
    },
  });

  // --- sparkSpray -------------------------------------------------------------------------------------------------------

  // Burst i starts at times[i] from (ox[i], oy[i]) toward dir[i]; spark j of it has [angle, speed, life] in `sparks`.
  // Each spark is a short streak along its velocity (closed form: p = o + v·τ + ½·g·τ²), fading over its life.
  function sparkDraw(g, t, d, q) {
    const a0 = g.globalAlpha;
    g.lineCap = 'round';
    for (let i = 0; i < d.times.length; i++) {
      const tau = t - d.times[i];
      if (tau < 0 || tau > d.maxLife) continue;
      if (tau < 0.12) {
        const glow = g.createRadialGradient(d.ox[i], d.oy[i], 0, d.ox[i], d.oy[i], d.flash);
        glow.addColorStop(0, q.rgba(d.hot, 0.8)); glow.addColorStop(1, q.rgba(d.hot, 0));
        g.fillStyle = glow;
        g.globalAlpha = a0 * (1 - tau / 0.12);
        g.fillRect(d.ox[i] - d.flash, d.oy[i] - d.flash, 2 * d.flash, 2 * d.flash);
      }
      for (let j = 0; j < d.per; j++) {
        const o = (i * d.per + j) * 3, life = d.sparks[o + 2];
        if (tau > life) continue;
        const a = d.dir[i] + d.sparks[o], v = d.speed * d.sparks[o + 1], back = Math.max(0, tau - 0.07);
        const x = d.ox[i] + Math.cos(a) * v * tau, y = d.oy[i] + Math.sin(a) * v * tau + 0.5 * GRAVITY * tau * tau;
        const x0 = d.ox[i] + Math.cos(a) * v * back, y0 = d.oy[i] + Math.sin(a) * v * back + 0.5 * GRAVITY * back * back;
        const fade = 1 - tau / life;
        g.globalAlpha = a0 * fade * Math.sqrt(fade);
        g.strokeStyle = q.rgba(j % 3 === 0 ? d.hot : d.ink, 1);
        g.lineWidth = 1.5 + 2.5 * fade;
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x, y); g.stroke();
      }
    }
    g.globalAlpha = a0;
  }

  // Cut-local burst times: every `every`-th beat while the text is up (a pulse every half second without a beat grid),
  // plus the sung start of an impact line; at most 32.
  function burstTimes(env, every) {
    const T = env.times, lo = Math.max(T.a + 0.05, -0.05), hi = T.out;
    const out = [];
    if (env.cut && env.cut.impact) out.push(0);
    if (env.grid) {
      const beats = env.grid.beatsIn(lo, hi);
      for (let k = 0; k < beats.length; k++) {
        const idx = env.grid.beatAt(beats[k] + 1e-6).index;
        if (((idx % every) + every) % every === 0 && !out.some((x) => Math.abs(x - beats[k]) < 0.1)) out.push(beats[k]);
      }
    } else {
      for (let x = Math.max(0, lo); x < hi; x += 0.5 * every) if (!out.some((y) => Math.abs(y - x) < 0.1)) out.push(x);
    }
    return out.sort((x, y) => x - y).slice(0, 32);
  }

  const sparkSpray = K.ornament({
    key: 'sparkSpray', scope: 'cut', follow: 'own',
    label: { ja: '火花', en: 'Spark spray' },
    blurb: { ja: '拍や見せ場で小さな火花が飛び散る', en: 'Small sparks spray on beats and impacts' },
    tags: ['bright', 'fast'], needs: ['beats'],
    traits: { roles: LYRIC_ROLES },
    shared: { ink: { auto: { pick: ['accent', 'shiftB'], weights: [3, 1] } } },
    params: {
      sparks: { type: 'int', min: 4, max: 40, label: { ja: '一度の火花', en: 'Sparks per burst' }, auto: { range: [14, 22] } },
      speed: { type: 'num', min: 100, max: 1400, step: 10, unit: 'du', label: { ja: '飛ぶ速さ（毎秒）', en: 'Speed (per second)' },
        auto: { range: [560, 880], follow: 'energy' } },
      every: { type: 'enum', of: [1, 2, 4], label: { ja: '何拍ごと', en: 'Every n beats' }, auto: { pick: [2, 1, 4], weights: [3, 2, 1] } },
    },
    build(env, p) {
      const { sb, D, rng } = env;
      const f = focusOf(env), vertical = env.orient === 'v', times = burstTimes(env, p.every), n = times.length;
      const ox = new Float32Array(n), oy = new Float32Array(n), dir = new Float32Array(n), sparks = new Float32Array(n * p.sparks * 3);
      let maxLife = 0;
      for (let i = 0; i < n; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        ox[i] = K.math.clamp(vertical ? f.cx + side * f.w * 0.3 : side < 0 ? f.x - 8 : f.x1 + 8, 0, D.w);
        oy[i] = K.math.clamp(vertical ? (side < 0 ? f.y - 8 : f.y1 + 8) : f.cy, 0, D.h);
        dir[i] = vertical ? (side < 0 ? -Math.PI / 2 : Math.PI / 2 - 0.4) : side < 0 ? Math.PI + 0.35 : -0.35;
        for (let j = 0; j < p.sparks; j++) {
          const o = (i * p.sparks + j) * 3;
          sparks[o] = rng.range(-1.1, 1.1); sparks[o + 1] = rng.range(0.45, 1.15); sparks[o + 2] = rng.range(0.4, 0.8);
          maxLife = Math.max(maxLife, sparks[o + 2]);
        }
      }
      sb.paint({ layer: 'near', bleed: 0, animated: true, owner: env.owner, draw: sparkDraw,
        data: { times: Float32Array.from(times), ox, oy, dir, sparks, per: p.sparks, maxLife, speed: p.speed,
          flash: 0.035 * D.short * (0.6 + 0.6 * p.amount), ink: p.ink, hot: 'shiftB' } });
    },
  });

  return [hankoSeal, inkSplat, underSweep, ripplePath, sunBurst, sparkSpray];
});
