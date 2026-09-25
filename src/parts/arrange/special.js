/* 文字PVメーカー v2 — original work. Compositions for the special cuts: title plate (title), breath mark (interlude), credit fold (outro). */
MV.def('parts/arrange/special', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, smooth, TAU } = K.math;
  const L = (ja, en) => ({ ja, en });
  const SMALL_FACE = 'body';

  // --- helpers (defined once per module, never per build) --------------------------------------------------------

  function safeBox(D) {
    return { x: D.safe.l, y: D.safe.t, w: D.w - D.safe.l - D.safe.r, h: D.h - D.safe.t - D.safe.b };
  }

  function rootOf(env, p) {
    const shift = { x: (p.offsetX || 0) * env.D.w, y: (p.offsetY || 0) * env.D.h };
    return { shift, node: env.sb.group({ x: shift.x, y: shift.y }) };
  }

  function localBounds(sb, node, root) {
    const b = sb.bounds(node);
    return { x: b.x - root.shift.x, y: b.y - root.shift.y, w: b.w, h: b.h };
  }

  // The main text of a special cut: the cut text (the title on title and outro cards) as a span, so marks still apply.
  function mainOf(cut) {
    const text = cut.text || '';
    return text.trim() ? { spec: { span: [0, text.length] }, str: text } : null;
  }

  function bestFit(env, str, along, cross, maxLines, pitch, cap) {
    const { text, cut } = env;
    let best = { em: 0, lines: 1 };
    for (let n = 1; n <= maxLines; n++) {
      const pieces = n === 1 ? [[0, str.length]] : text.columns(str, n, cut.lang);
      if (pieces.length < n) break;
      const cells = pieces.map(([a, b]) => Math.max(1, text.cells(str.slice(a, b))));
      if (n > 1 && Math.min(...cells) < 0.45 * Math.max(...cells)) continue;
      const em = Math.min(cap, along / Math.max(...cells), cross / ((n - 1) * pitch + 1));
      if (em > best.em * 1.15) best = { em, lines: n };
    }
    return best;
  }

  function textWeight(t, tm) {
    const fin = tm.rest > tm.a ? smooth((t - tm.a) / (tm.rest - tm.a)) : (t >= tm.a ? 1 : 0);
    const fout = tm.b > tm.out ? smooth((tm.b - t) / (tm.b - tm.out)) : (t < tm.b ? 1 : 0);
    return fin < fout ? fin : fout;
  }

  function runFade(P, t, b) {
    const k = textWeight(t, b.times);
    for (let r = 0; r < b.nodes.length; r++) P.alpha[b.nodes[r]] *= k;
  }

  // Decorations fade with the text's entrance and exit.
  function fadeWithText(env, nodes) {
    const list = nodes.filter((n) => n !== null && n !== undefined);
    if (list.length === 0) return;
    env.sb.behave({ phase: K.PH.ORNAMENT, live: 'always', from: Math.min(...list), to: Math.max(...list) + 1,
      t0: env.times.a, t1: env.times.b, run: runFade, nodes: Int32Array.from(list), times: env.times });
  }

  function rule(env, root, x0, y0, x1, y1, width, ink) {
    return env.sb.shape({ parent: root.node, layer: 'text', path: K.shape.line(x0, y0, x1, y1), stroke: ink || 'muted', width });
  }

  function finish(env, root, runs, focus) {
    const f = focus || env.sb.bounds(root.node);
    return { runs: runs.filter(Boolean), focus: f, free: env.sb.freeAround(f) };
  }

  // --- titlePlate (role title) -----------------------------------------------------------------------------------

  function titleBuild(env, p) {
    const { D, cut, sb, textStyle } = env;
    const root = rootOf(env, p);
    const safe = safeBox(D);
    const v = env.orient === 'v';
    const main = mainOf(cut) || { spec: { text: cut.note || '♪' }, str: cut.note || '♪' };
    const artist = mainOf(cut) ? cut.note : null;
    const scale = textStyle.scale;
    // One or two lines; a long title may take three in a frame no longer along the lines than across them.
    const narrow = (v ? safe.h : safe.w) <= (v ? safe.w : safe.h) * 1.01;
    const fit = bestFit(env, main.str, (v ? safe.h : safe.w) * 0.8, (v ? safe.w : safe.h) * 0.36, narrow ? 3 : 2,
      v ? 1.45 : 1.2, D.short * 0.2 * Math.max(1, scale));
    const em = fit.em * Math.min(1, scale);
    const ae = clamp(em * 0.3, D.short * 0.032, D.short * 0.055);
    const gap = em * 0.38;
    const lw = clamp(em * 0.022, 1.5, 5);
    const runs = [], deco = [];
    const spacing = { tracking: p.spacing, face: SMALL_FACE, style: 'plain', maxLines: 1, breakAt: 'none', fit: 'shrink' };
    if (v) {
      const depth = (1 + (fit.lines - 1) * 1.45) * em;
      const extra = artist ? gap + ae * 2.2 : gap;
      const x = D.cx + extra / 2 - depth / 2;
      const along = (v ? safe.h : safe.w) * 0.8;
      const title = sb.text(Object.assign({ parent: root.node, orient: 'v', size: em, leading: 1.45,
        box: { x, y: D.cy - along / 2, w: depth, h: along }, align: 'center', valign: 'center', maxLines: fit.lines,
        breakAt: 'phrase', fit: 'shrink' }, main.spec));
      runs.push(title);
      const tb = localBounds(sb, title.node, root);
      const rx = tb.x - gap;
      const len = p.rule === 'long' ? tb.h : Math.min(tb.h, em * 2.2);
      deco.push(rule(env, root, rx, tb.y, rx, tb.y + len, lw));
      if (p.rule === 'double') deco.push(rule(env, root, rx - lw * 3, tb.y, rx - lw * 3, tb.y + len, lw));
      if (artist) {
        runs.push(sb.text(Object.assign({ parent: root.node, text: artist, orient: 'v', size: ae,
          box: { x: rx - gap - ae * 1.5, y: tb.y + len * 0.25, w: ae * 1.5, h: safe.y + safe.h - tb.y - len * 0.25 },
          align: 'start', valign: 'center' }, spacing)));
      }
    } else {
      const depth = (1 + (fit.lines - 1) * 1.2) * em;
      const below = gap + (artist ? ae * 2.2 : 0);
      const top = D.cy - (depth + below) / 2;
      const title = sb.text(Object.assign({ parent: root.node, orient: 'h', size: em, leading: 1.2,
        box: { x: safe.x + safe.w * 0.1, y: top, w: safe.w * 0.8, h: depth * 1.04 }, align: 'center', valign: 'center',
        maxLines: fit.lines, breakAt: 'phrase', fit: 'shrink' }, main.spec));
      runs.push(title);
      const tb = localBounds(sb, title.node, root);
      const ry = tb.y + tb.h + gap * 0.8;
      const len = p.rule === 'long' ? tb.w : Math.min(tb.w, em * 2.4);
      deco.push(rule(env, root, D.cx - len / 2, ry, D.cx + len / 2, ry, lw));
      if (p.rule === 'double') deco.push(rule(env, root, D.cx - len / 2, ry + lw * 3, D.cx + len / 2, ry + lw * 3, lw));
      if (artist) {
        runs.push(sb.text(Object.assign({ parent: root.node, text: artist, orient: 'h', size: ae,
          box: { x: safe.x, y: ry + ae * 0.8 + (p.rule === 'double' ? lw * 3 : 0), w: safe.w, h: ae * 1.5 }, align: 'center',
          valign: 'start' }, spacing)));
      }
    }
    fadeWithText(env, deco);
    return finish(env, root, runs);
  }

  const titlePlate = K.arrange({
    key: 'titlePlate',
    label: L('タイトル札', 'Title plate'),
    blurb: L('題名を大きく、罫の下にアーティスト名を小さく', 'The title large, the artist small under a rule'),
    tags: ['serious'], family: 'plate', cam: 'gentle',
    traits: { cells: [0, 80], roles: ['title'] },
    params: {
      rule: { type: 'enum', of: ['short', 'long', 'double'], label: L('罫', 'Rule'),
        auto: { pick: ['short', 'long', 'double'], weights: [3, 2, 1] } },
      spacing: { type: 'num', min: 0, max: 0.6, step: 0.01, unit: 'em', label: L('名前の字間', 'Name spacing'),
        auto: { range: [0.12, 0.3] } },
    },
    build: titleBuild,
  });

  // --- breathMark (role interlude) -------------------------------------------------------------------------------

  // What the mark shows: 'none' → nothing, 'heading' → the section heading (the interlude cut's note) or ♪, any other
  // text as written (the inspector's 表示する文字 field, WP8b).
  function labelOf(p, cut) {
    const raw = typeof p.label === 'string' ? p.label.trim() : 'heading';
    if (raw === 'none' || raw === '') return '';
    if (raw === 'heading') return cut.note && String(cut.note).trim() ? String(cut.note).trim() : '♪';
    return raw;
  }

  // The mark breathes on its own (special cuts get no dwell part): a slow scale and brightness swell, faded in and
  // out over the first and last 0.5 s of the cut window.
  function runBreath(P, t, b) {
    const s = Math.sin((TAU * (t - b.t0)) / b.pace);
    const edge = Math.min(smooth((t - b.t0) / 0.5), smooth((b.t1 - t) / 0.5));
    P.sx[b.from] *= 1 + b.depth * s;
    P.sy[b.from] *= 1 + b.depth * s;
    P.alpha[b.from] *= edge * (1 - b.dim * (0.5 - 0.5 * s));
  }

  function breathBuild(env, p) {
    const { D, cut, sb, text, textStyle } = env;
    const root = rootOf(env, p);
    const v = env.orient === 'v';
    const label = labelOf(p, cut);
    const mark = text.cells(label) <= 1.5;
    const em = D.short * (mark ? 0.1 : 0.056) * textStyle.scale;
    const long = Math.min((v ? D.h : D.w) * 0.6, Math.max(em * 3, text.cells(label) * em * 1.5));
    const g = sb.group({ parent: root.node, x: D.cx, y: D.cy });
    const runs = [];
    if (label) {
      runs.push(sb.text({ parent: g, text: label, orient: v ? 'v' : 'h', size: em, tracking: mark ? 0 : 0.2,
        box: v ? { x: -em * 0.75, y: -long / 2, w: em * 1.5, h: long } : { x: -long / 2, y: -em * 0.75, w: long, h: em * 1.5 },
        align: 'center', valign: 'center', maxLines: 1, breakAt: 'none', fit: 'shrink', style: 'plain' }));
    }
    if (p.rules) {
      const lb = runs.length ? localBounds(sb, runs[0].node, root) : { x: D.cx, y: D.cy, w: 0, h: 0 };
      const gap = em * 0.7, len = Math.max(em * 1.6, D.short * 0.08), lw = clamp(em * 0.03, 1.5, 3);
      const half = v ? lb.h / 2 : lb.w / 2;
      for (const side of [-1, 1]) {
        const a = side * (half + gap), b = side * (half + gap + len);
        sb.shape({ parent: g, layer: 'text', stroke: 'muted', width: lw, cap: 'round',
          path: v ? K.shape.line(0, a, 0, b) : K.shape.line(a, 0, b, 0) });
      }
    }
    sb.behave({ phase: K.PH.ORNAMENT, live: 'always', from: g, to: g + 1, t0: env.times.a, t1: env.times.b, run: runBreath,
      pace: p.pace, depth: 0.035, dim: 0.22 });
    const focus = runs.length ? sb.bounds(g) : { x: D.cx + root.shift.x - em, y: D.cy + root.shift.y - em, w: em * 2, h: em * 2 };
    return finish(env, root, runs, focus);
  }

  const breathMark = K.arrange({
    key: 'breathMark',
    label: L('間の印', 'Breath mark'),
    blurb: L('小さな♪か区間の見出しを中央に置き、ゆっくり呼吸させる', 'A small ♪ or the section heading, centred and slowly breathing'),
    tags: ['minimal', 'slow'], family: 'mark', cam: 'gentle',
    traits: { cells: [0, 80], roles: ['interlude'] },
    params: {
      label: { type: 'text', max: 40, label: L('表示する文字', 'Text shown'), auto: { value: 'heading' } },
      rules: { type: 'bool', label: L('両側の線', 'Side rules'), auto: { pick: [true, false], weights: [3, 1] } },
      pace: { type: 'num', min: 1.5, max: 8, step: 0.1, unit: 's', label: L('呼吸の長さ', 'Breath length'),
        auto: { range: [3, 4.6], follow: '-tempo' } },
    },
    build: breathBuild,
  });

  // --- creditFold (role outro) -----------------------------------------------------------------------------------

  // A small folded paper corner: a square with its top corner turned down.
  function foldPath(x, y, s, right) {
    const f = s * 0.38;
    return right
      ? K.shape.path([['M', x, y], ['L', x + s - f, y], ['L', x + s, y + f], ['L', x + s, y + s], ['L', x, y + s], ['Z'],
        ['M', x + s - f, y], ['L', x + s - f, y + f], ['L', x + s, y + f]])
      : K.shape.path([['M', x + f, y], ['L', x + s, y], ['L', x + s, y + s], ['L', x, y + s], ['L', x, y + f], ['Z'],
        ['M', x + f, y], ['L', x + f, y + f], ['L', x, y + f]]);
  }

  function creditBuild(env, p) {
    const { D, cut, sb, text, textStyle } = env;
    const root = rootOf(env, p);
    const safe = safeBox(D);
    const v = env.orient === 'v';
    const right = p.corner === 'bottomRight';
    const main = mainOf(cut);
    const artist = cut.note && String(cut.note).trim() ? String(cut.note).trim() : null;
    const te = D.short * 0.05 * textStyle.scale, ae = D.short * 0.036 * textStyle.scale;
    const runs = [];
    const bottom = safe.y + safe.h;
    const small = { face: SMALL_FACE, style: 'plain', maxLines: 1, breakAt: 'none', fit: 'shrink' };
    let fold;
    if (v) {
      // The title in one column, or two (and a longer reach) when one would make it small; the artist column after it.
      const two = main && main.str.length > 1 && text.cells(main.str) * te > safe.h * 0.55 * 1.25;
      const h = safe.h * (two ? 0.7 : 0.55);
      const tw = two ? te * 2.9 : te * 1.5;
      const x = right ? safe.x + safe.w - tw : safe.x + (artist ? ae * 2.2 : 0);
      let left = x;
      if (main) {
        runs.push(sb.text(Object.assign({ parent: root.node, orient: 'v', size: te, box: { x, y: bottom - h, w: tw, h },
          leading: 1.4, align: 'end', valign: right ? 'start' : 'end', maxLines: two ? 2 : 1, breakAt: two ? 'phrase' : 'none',
          fit: 'shrink' }, main.spec)));
        left = localBounds(sb, runs[0].node, root).x;
      }
      if (artist) runs.push(sb.text(Object.assign({ parent: root.node, text: artist, orient: 'v', size: ae, tracking: 0.12,
        box: { x: left - ae * 2.1, y: bottom - h, w: ae * 1.5, h }, align: 'end', valign: 'center' }, small)));
      const b = runs.length ? localBounds(sb, root.node, root) : { x, y: bottom - te, w: te * 1.5, h: te };
      const s = te * 0.8;
      fold = foldPath(right ? b.x + b.w - s : b.x, b.y - s * 1.6, s, right);
    } else {
      const w = safe.w * (D.h >= D.w ? 0.72 : 0.5);            // a square or tall frame gives the credit more width
      const x = right ? safe.x + safe.w - w : safe.x;
      const artistTop = bottom - ae * 1.45;
      const titleBottom = artist ? artistTop - ae * 0.5 : bottom;
      if (main) {
        runs.push(sb.text(Object.assign({ parent: root.node, orient: 'h', size: te, leading: 1.25,
          box: { x, y: titleBottom - te * 2.6, w, h: te * 2.6 }, align: right ? 'end' : 'start', valign: 'end', maxLines: 2,
          breakAt: 'phrase', fit: 'shrink' }, main.spec)));
      }
      if (artist) runs.push(sb.text(Object.assign({ parent: root.node, text: artist, orient: 'h', size: ae, tracking: 0.12,
        box: { x, y: artistTop, w, h: ae * 1.45 }, align: right ? 'end' : 'start', valign: 'center' }, small)));
      const b = runs.length ? localBounds(sb, root.node, root) : { x: right ? x + w : x, y: bottom - te, w: 0, h: te };
      const s = te * 0.8;
      fold = foldPath(right ? b.x - s * 1.7 : b.x + b.w + s * 0.7, b.y + (b.h - s) / 2, s, right);
    }
    if (p.fold) {
      const width = clamp(te * 0.04, 1.5, 3);
      fadeWithText(env, [sb.shape({ parent: root.node, layer: 'text', path: fold, stroke: 'accent', width })]);
    }
    return finish(env, root, runs);
  }

  const creditFold = K.arrange({
    key: 'creditFold',
    label: L('終わりの札', 'Credit fold'),
    blurb: L('題名とアーティスト名を隅に小さく添える', 'Title and artist as a quiet credit in a corner'),
    tags: ['minimal'], family: 'credit', cam: 'gentle',
    traits: { cells: [0, 80], roles: ['outro'] },
    params: {
      corner: { type: 'enum', of: ['bottomRight', 'bottomLeft'], label: L('隅', 'Corner'),
        auto: { pick: ['bottomRight', 'bottomLeft'], weights: [3, 1] } },
      fold: { type: 'bool', label: L('折り返しの印', 'Fold mark'), auto: { pick: [true, false], weights: [3, 1] } },
    },
    build: creditBuild,
  });

  return [titlePlate, breathMark, creditFold];
});
