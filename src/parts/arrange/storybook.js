/* 文字PVメーカー v2 — original work. Lyric compositions: windows, quotation, arches, panels and graphic page layouts. */
MV.def('parts/arrange/storybook', ['parts/kit'], (K) => {
  'use strict';

  const { smooth, TAU } = K.math;
  const L = (ja, en) => ({ ja, en });

  function frame(env, p) {
    const { D, sb, cut } = env;
    const str = (cut.text || '').trim() ? cut.text : (cut.note || '♪');
    const own = !!(cut.text || '').trim(), note = own ? cut.note : null;
    const safe = { x: D.safe.l, y: D.safe.t, w: D.w - D.safe.l - D.safe.r,
      h: D.h - D.safe.t - D.safe.b - (note ? 0.085 * D.short : 0) };
    return { str, own, note, safe, v: env.orient === 'v',
      root: sb.group({ x: (p.offsetX || 0) * D.w, y: (p.offsetY || 0) * D.h }), runs: [], marks: [] };
  }

  function part(f, r) { return f.own ? { span: r } : { text: f.str.slice(r[0], r[1]) }; }
  function inset(b, x, y) { return { x: b.x + b.w * x, y: b.y + b.h * y, w: b.w * (1 - 2 * x), h: b.h * (1 - 2 * y) }; }

  // All sizes fit their actual text box. Phrase balancing never splits a Latin word, emoji or surrogate pair.
  function run(env, f, box, range, options) {
    const r = range || [0, f.str.length], str = f.str.slice(r[0], r[1]);
    const v = f.v, pitch = v ? 1.5 : 1.3, along = v ? box.h : box.w, cross = v ? box.w : box.h;
    let best = { em: 0, n: 1 };
    for (let n = 1; n <= 3; n++) {
      const pieces = n === 1 ? [[0, str.length]] : env.text.columns(str, n, env.cut.lang);
      if (pieces.length < n) break;
      const cells = pieces.map(([a, b]) => Math.max(1, env.text.cells(str.slice(a, b))));
      const em = Math.min(env.D.short * 0.19, along / Math.max(...cells), cross / ((n - 1) * pitch + 1.25));
      if (em > best.em * 1.12) best = { em, n };
    }
    const r0 = env.sb.text(Object.assign({ parent: f.root, orient: v ? 'v' : 'h', box,
      size: Math.max(0.1, best.em * env.textStyle.scale), leading: pitch, maxLines: best.n,
      breakAt: 'phrase', fit: 'shrink', align: 'center', valign: 'center' }, part(f, r), options || {}));
    f.runs.push(r0);
    return r0;
  }

  function line(env, f, x0, y0, x1, y1, ink, width) {
    f.marks.push(env.sb.shape({ parent: f.root, layer: 'mid', stroke: ink || 'accent',
      width: width || Math.max(1.5, env.D.short * 0.003), path: K.shape.line(x0, y0, x1, y1) }));
  }

  function shape(env, f, path, stroke, fill, width) {
    f.marks.push(env.sb.shape({ parent: f.root, layer: 'mid', path, stroke: stroke || null, fill: fill || null,
      width: width || env.D.short * 0.003 }));
  }

  // Graphic panels are paints so a text fill override changes the letters without recolouring their paper.
  function panelDraw(g, t, d, q) {
    g.fillStyle = q.rgba(d.ink, d.alpha);
    g.fillRect(d.x, d.y, d.w, d.h);
  }

  function panel(env, f, box, ink, alpha) {
    f.marks.push(env.sb.paint({ parent: f.root, layer: 'mid', animated: true, bleed: 0, draw: panelDraw,
      data: Object.assign({ ink: ink || 'ground2', alpha: alpha === undefined ? 1 : alpha }, box) }));
  }

  function fadeMarks(P, t, b) {
    const T = b.times;
    const a = T.rest > T.a ? smooth((t - T.a) / (T.rest - T.a)) : +(t >= T.a);
    const z = T.b > T.out ? smooth((T.b - t) / (T.b - T.out)) : +(t < T.b);
    for (const n of b.nodes) P.alpha[n] *= Math.min(a, z);
  }

  function finish(env, f) {
    const { D, sb } = env;
    if (f.note) {
      f.runs.push(sb.text({ parent: f.root, text: f.note, orient: 'h', face: 'body', style: 'plain', size: D.short * 0.035,
        box: { x: D.safe.l, y: D.h - D.safe.b - D.short * 0.055, w: D.w - D.safe.l - D.safe.r, h: D.short * 0.05 },
        align: 'center', valign: 'center', maxLines: 1, breakAt: 'none', fit: 'shrink' }));
    }
    if (f.marks.length) sb.behave({ phase: K.PH.ORNAMENT, live: 'always', from: Math.min(...f.marks),
      to: Math.max(...f.marks) + 1, t0: env.times.a, t1: env.times.b, run: fadeMarks,
      times: env.times, nodes: Int32Array.from(f.marks) });
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of f.runs) {
      const b = sb.bounds(r.node);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    const focus = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    return { runs: f.runs, focus, free: sb.freeAround(focus) };
  }

  function pieces(env, f, n) {
    const spans = env.text.columns(f.str, n, env.cut.lang);
    return spans.length ? spans : [[0, f.str.length]];
  }

  function windowBuild(env, p) {
    const f = frame(env, p), b = inset(f.safe, 0.1, 0.17), leg = env.D.short * p.opening;
    for (const [x, y, sx, sy] of [[b.x, b.y, 1, 1], [b.x + b.w, b.y, -1, 1],
      [b.x, b.y + b.h, 1, -1], [b.x + b.w, b.y + b.h, -1, -1]]) {
      line(env, f, x, y, x + sx * Math.min(leg, b.w * 0.25), y);
      line(env, f, x, y, x, y + sy * Math.min(leg, b.h * 0.25));
    }
    run(env, f, inset(b, 0.09, 0.16));
    return finish(env, f);
  }

  function quoteBuild(env, p) {
    const f = frame(env, p), b = inset(f.safe, 0.17, 0.25), s = env.D.short * p.mark;
    run(env, f, b);
    // Two paired open quotation bars: ornamental marks, never part of the lyric or camera target.
    for (let i = 0; i < 2; i++) {
      const x = b.x - s * (0.6 + i * 0.45), y = b.y - s * 0.25;
      line(env, f, x, y + s, x, y, 'accent', s * 0.17);
      const u = b.x + b.w + s * (0.6 + i * 0.45), v = b.y + b.h + s * 0.25;
      line(env, f, u, v - s, u, v, 'accent', s * 0.17);
    }
    return finish(env, f);
  }

  function archBuild(env, p) {
    const f = frame(env, p), b = inset(f.safe, 0.05, 0.2), rs = pieces(env, f, 3), n = rs.length;
    // Phrase blocks follow a shallow arch, reading left-to-right or top-to-bottom; they never rotate the glyphs.
    for (let i = 0; i < n; i++) {
      const u = n > 1 ? i / (n - 1) : 0.5, bend = p.bend * Math.sin(Math.PI * u);
      const box = f.v ? { x: b.x + b.w * (0.1 + bend), y: b.y + b.h * i / n,
        w: b.w * 0.55, h: b.h / n * 0.88 }
        : { x: b.x + b.w * i / n, y: b.y + b.h * (0.24 - bend), w: b.w / n * 0.9, h: b.h * 0.58 };
      run(env, f, box, rs[i]);
    }
    return finish(env, f);
  }

  function orbitBuild(env, p) {
    const f = frame(env, p), b = f.safe, r = Math.min(b.w, b.h) * p.orbit;
    const cx = b.x + b.w * 0.73, cy = b.y + b.h * 0.25;
    shape(env, f, K.shape.ellipse(cx, cy, r, r), 'accent');
    shape(env, f, K.shape.ellipse(cx + r * 0.72, cy - r * 0.7, r * 0.11, r * 0.11), null, 'accent');
    run(env, f, { x: b.x + b.w * 0.05, y: b.y + b.h * 0.46, w: b.w * 0.8, h: b.h * 0.36 }, null,
      { align: f.v ? 'center' : 'start' });
    return finish(env, f);
  }

  function glassBuild(env, p) {
    const f = frame(env, p), b = inset(f.safe, 0.15, 0.22), d = env.D.short * p.depth;
    panel(env, f, { x: b.x + d, y: b.y - d, w: b.w, h: b.h }, 'accent', 0.18);
    panel(env, f, { x: b.x - d, y: b.y + d, w: b.w, h: b.h }, 'muted', 0.12);
    panel(env, f, b);
    run(env, f, inset(b, 0.09, 0.15), null, { align: f.v ? 'center' : 'start' });
    return finish(env, f);
  }

  function horizonBuild(env, p) {
    const f = frame(env, p), b = f.safe, rs = pieces(env, f, 2), n = rs.length;
    const gap = p.gap;
    for (let i = 0; i < n; i++) {
      const start = i ? 0.5 + gap / 2 : 0.1, reach = n === 1 ? 0.8 : 0.4 - gap / 2;
      const box = f.v ? { x: b.x + b.w * (n === 1 ? 0.1 : i ? 0.1 : 0.5 + gap / 2), y: b.y + b.h * 0.08,
        w: b.w * reach, h: b.h * 0.84 }
        : { x: b.x + b.w * 0.08, y: b.y + b.h * start, w: b.w * 0.84, h: b.h * reach };
      run(env, f, box, rs[i], { align: i ? 'end' : 'start', valign: i ? 'end' : 'start' });
    }
    if (f.v) line(env, f, b.x + b.w * 0.5, b.y + b.h * 0.18, b.x + b.w * 0.5, b.y + b.h * 0.82, 'muted');
    else line(env, f, b.x + b.w * 0.18, b.y + b.h * 0.5, b.x + b.w * 0.82, b.y + b.h * 0.5, 'muted');
    return finish(env, f);
  }

  function stripsBuild(env, p) {
    const f = frame(env, p), b = inset(f.safe, 0.08, 0.14), rs = pieces(env, f, p.strips), n = rs.length;
    for (let i = 0; i < n; i++) {
      const edge = i % 2 ? 0.13 : 0;
      const box = f.v ? { x: b.x + b.w * (n - 1 - i) / n, y: b.y + edge * b.h, w: b.w / n * 0.88, h: b.h * 0.86 }
        : { x: b.x + edge * b.w, y: b.y + b.h * i / n, w: b.w * 0.86, h: b.h / n * 0.88 };
      panel(env, f, box, i % 2 ? 'ground2' : 'accent', i % 2 ? 1 : 0.17);
      run(env, f, inset(box, 0.05, 0.08), rs[i], { align: i % 2 ? 'end' : 'start' });
    }
    return finish(env, f);
  }

  function pennantBuild(env, p) {
    const f = frame(env, p), b = inset(f.safe, 0.1, 0.24), tip = Math.min(b.w, b.h) * p.tip;
    // A pointed banner ends inside the safe area and leaves an inset rectangular area for the full text.
    const path = f.v ? [b.x, b.y, b.x + b.w, b.y, b.x + b.w, b.y + b.h - tip,
      b.x + b.w / 2, b.y + b.h, b.x, b.y + b.h - tip]
      : [b.x, b.y, b.x + b.w - tip, b.y, b.x + b.w, b.y + b.h / 2,
        b.x + b.w - tip, b.y + b.h, b.x, b.y + b.h];
    shape(env, f, K.shape.poly(path, true), 'accent', 'ground2');
    run(env, f, f.v ? { x: b.x + b.w * 0.1, y: b.y + b.h * 0.06, w: b.w * 0.8, h: b.h - tip - b.h * 0.12 }
      : { x: b.x + b.w * 0.06, y: b.y + b.h * 0.1, w: b.w - tip - b.w * 0.12, h: b.h * 0.8 });
    return finish(env, f);
  }

  function railBuild(env, p) {
    const f = frame(env, p), b = inset(f.safe, 0.06, 0.14), rail = Math.min(b.w, b.h) * p.rail;
    if (f.v) {
      line(env, f, b.x, b.y, b.x + b.w, b.y, 'accent', rail * 0.18);
      line(env, f, b.x, b.y + rail * 0.35, b.x + b.w * 0.55, b.y + rail * 0.35, 'muted');
      run(env, f, { x: b.x, y: b.y + rail, w: b.w, h: b.h - rail }, null, { align: 'start', valign: 'start' });
    } else {
      line(env, f, b.x, b.y, b.x, b.y + b.h, 'accent', rail * 0.18);
      line(env, f, b.x + rail * 0.35, b.y, b.x + rail * 0.35, b.y + b.h * 0.55, 'muted');
      run(env, f, { x: b.x + rail, y: b.y, w: b.w - rail, h: b.h }, null, { align: 'start', valign: 'center' });
    }
    return finish(env, f);
  }

  function badgeBuild(env, p) {
    const f = frame(env, p), b = f.safe, r = Math.min(b.w, b.h) * 0.37, cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    shape(env, f, K.shape.ellipse(cx, cy, r, r), 'accent', 'ground2');
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const a = TAU * i / steps, r0 = r + env.D.short * 0.008, r1 = r0 + env.D.short * p.ticks;
      line(env, f, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1,
        i % 3 ? 'muted' : 'accent', env.D.short * 0.002);
    }
    run(env, f, { x: cx - r * 0.67, y: cy - r * 0.67, w: r * 1.34, h: r * 1.34 });
    return finish(env, f);
  }

  const num = (ja, en, min, max, lo, hi) => ({ type: 'num', min, max, step: 0.005,
    unit: 'frac', label: L(ja, en), auto: { range: [lo, hi] } });

  return [
    K.arrange({ key: 'windowVerse', label: L('窓の余白', 'Open window'),
      blurb: L('四隅の開いた枠で歌詞を囲み、窓越しのように余白を残す', 'The lyric inside four open corners, framed with generous breathing room'),
      tags: ['minimal', 'serious'], family: 'window', cam: 'gentle',
      params: { opening: num('枠の長さ', 'Corner length', 0.04, 0.16, 0.07, 0.11) }, build: windowBuild }),
    K.arrange({ key: 'quoteVerse', label: L('引用の余白', 'Quotation space'),
      blurb: L('大きな引用符の間に歌詞を置き、ひとつの言葉として見せる', 'The lyric between oversized quotation marks, as one remembered statement'),
      tags: ['literary', 'soft'], family: 'quotation', cam: 'gentle',
      params: { mark: num('引用符の大きさ', 'Quotation size', 0.035, 0.1, 0.05, 0.075) }, build: quoteBuild }),
    K.arrange({ key: 'archPhrase', label: L('言葉のアーチ', 'Phrase arch'),
      blurb: L('読み順を保った短い句を、なだらかな弧に沿って並べる', 'Balanced phrases follow a shallow arch while keeping their reading order'),
      tags: ['airy', 'playful'], family: 'arch', traits: { cells: [5, 32] },
      params: { bend: num('弧の深さ', 'Arch depth', 0.08, 0.22, 0.12, 0.18) }, build: archBuild }),
    K.arrange({ key: 'orbitCaption', label: L('月とキャプション', 'Moon caption'),
      blurb: L('右上の月のような円と、左下に寄せた歌詞で画面に余韻を作る', 'A moonlike circle above a lower caption creates an asymmetrical pause'),
      tags: ['airy', 'minimal'], family: 'orbitCaption', cam: 'gentle',
      params: { orbit: num('月の大きさ', 'Moon radius', 0.06, 0.17, 0.1, 0.14) }, build: orbitBuild }),
    K.arrange({ key: 'glassLayers', label: L('重なるガラス', 'Layered glass'),
      blurb: L('ずらした半透明の面を重ね、手前の面に歌詞を整える', 'Offset translucent panes sit behind a clean lyric panel'),
      tags: ['digital', 'soft'], family: 'glass', cam: 'gentle',
      params: { depth: num('面のずれ', 'Pane offset', 0.01, 0.055, 0.025, 0.04) }, build: glassBuild }),
    K.arrange({ key: 'splitHorizon', label: L('向かい合う余白', 'Distant halves'),
      blurb: L('二つの句を離れた端に置き、細い線と広い余白でつなぐ', 'Two phrases face across a broad pause divided by a fine horizon'),
      tags: ['serious', 'slow'], family: 'horizon', cam: 'gentle', traits: { cells: [5, 36] },
      params: { gap: num('句の間の余白', 'Phrase separation', 0.12, 0.36, 0.2, 0.28) }, build: horizonBuild }),
    K.arrange({ key: 'wovenStrips', label: L('織り重なる帯', 'Woven strips'),
      blurb: L('短い句を左右にずらした帯へ載せ、織物のように積み重ねる', 'Short phrases stack on offset strips like a woven page'),
      tags: ['retro', 'playful'], family: 'woven', cam: 'gentle', traits: { cells: [6, 36] },
      params: { strips: { type: 'int', min: 2, max: 4, label: L('帯の数', 'Strip count'), auto: { range: [2, 3] } } }, build: stripsBuild }),
    K.arrange({ key: 'pennantLine', label: L('言葉の旗', 'Lyric pennant'),
      blurb: L('先端のとがった旗の中に歌詞を収め、輪郭で印象を作る', 'The complete lyric inside a pointed pennant with a crisp outline'),
      tags: ['bold', 'retro'], family: 'pennant', cam: 'gentle',
      params: { tip: num('旗の先端', 'Pennant point', 0.08, 0.3, 0.13, 0.23) }, build: pennantBuild }),
    K.arrange({ key: 'marginRail', label: L('余白のレール', 'Margin rail'),
      blurb: L('二本の長さの違う罫線の横に、歌詞をゆったり揃える', 'The lyric aligned beside two unequal rules with generous page margins'),
      tags: ['minimal', 'literary'], family: 'rail',
      params: { rail: num('罫線との間', 'Rail spacing', 0.05, 0.18, 0.08, 0.12) }, build: railBuild }),
    K.arrange({ key: 'focusBadge', label: L('円いエンブレム', 'Lyric emblem'),
      blurb: L('目盛りに囲まれた円の中心へ歌詞を収め、ひとつの紋章にする', 'The lyric inside a circular emblem surrounded by fine radial ticks'),
      tags: ['serious', 'retro'], family: 'badge', cam: 'gentle', traits: { cells: [1, 26] },
      params: { ticks: num('目盛りの長さ', 'Tick length', 0.005, 0.035, 0.012, 0.022) }, build: badgeBuild }),
  ];
});
