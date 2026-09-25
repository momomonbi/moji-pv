/* 文字PVメーカー v2 — original work. Compositions with graphic elements: magazine head, diptych split, slant band, tilted card, ticker marquee. */
MV.def('parts/arrange/editorial', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, smooth, DEG } = K.math;
  const L = (ja, en) => ({ ja, en });
  const NOTE_FACE = 'body';
  const GLYPH_BUDGET = 200;       // glyphs one ticker may draw (all its copies)

  // --- helpers (defined once per module, never per build) --------------------------------------------------------

  function safeBox(D) {
    return { x: D.safe.l, y: D.safe.t, w: D.w - D.safe.l - D.safe.r, h: D.h - D.safe.t - D.safe.b };
  }

  function subjectOf(cut) {
    const text = cut.text || '';
    if (text.trim()) return { str: text, own: true, note: cut.note || null };
    return { str: cut.note || '♪', own: false, note: null };
  }

  function part(s, range) {
    return s.own ? { span: range } : { text: s.str.slice(range[0], range[1]) };
  }

  function whole(s) { return part(s, [0, s.str.length]); }

  function rootOf(env, p) {
    const shift = { x: (p.offsetX || 0) * env.D.w, y: (p.offsetY || 0) * env.D.h };
    return { shift, node: env.sb.group({ x: shift.x, y: shift.y }) };
  }

  function localBounds(sb, node, root) {
    const b = sb.bounds(node);
    return { x: b.x - root.shift.x, y: b.y - root.shift.y, w: b.w, h: b.h };
  }

  function finish(env, root, runs, focus) {
    const f = focus || env.sb.bounds(root.node);
    return { runs: runs.filter(Boolean), focus: f, free: env.sb.freeAround(f) };
  }

  // The line count (1…maxLines) and em that give the largest type (see parts/arrange/core); lopsided splits are skipped.
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

  // The phrase boundary nearest `share` of the text's cells (null when there is none within ±0.3).
  function breakNear(env, str, share) {
    const { text, cut } = env;
    const total = text.cells(str);
    let best = null, bestD = 0.3;
    for (const [a] of text.phrases(str, cut.lang)) {
      if (a <= 0) continue;
      const d = Math.abs(text.cells(str.slice(0, a)) / total - share);
      if (d < bestD) { best = a; bestD = d; }
    }
    return best;
  }

  // Size and centre of a run's box in a frame rotated by `rot` about (cx, cy), recovered from its axis-aligned bounds
  // (exact for a rectangle turned by less than 45°).
  function turnedRect(sb, node, cx, cy, rot) {
    const b = sb.bounds(node);
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot)), det = c * c - s * s;
    const w = det > 1e-3 ? Math.max(0, (b.w * c - b.h * s) / det) : b.w;
    const h = det > 1e-3 ? Math.max(0, (b.h * c - b.w * s) / det) : b.h;
    const dx = b.x + b.w / 2 - cx, dy = b.y + b.h / 2 - cy;
    const cos = Math.cos(-rot), sin = Math.sin(-rot);
    return { x: dx * cos - dy * sin - w / 2, y: dx * sin + dy * cos - h / 2, w, h };
  }

  // The text block for the focus: the union of the runs' bounds, within the frame (a divider or a band that runs off
  // the frame is not part of it).
  function textBounds(env, runs) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const run of runs) {
      if (!run) continue;
      const b = env.sb.bounds(run.node);
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    const { w, h } = env.D;
    x0 = clamp(x0, 0, w); x1 = clamp(x1, 0, w); y0 = clamp(y0, 0, h); y1 = clamp(y1, 0, h);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: w / 2, y: h / 2, w: 0, h: 0 };
  }

  function unionRect(a, b) {
    if (!a) return b;
    if (!b) return a;
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
  }

  function textWeight(t, tm) {
    const fin = tm.rest > tm.a ? smooth((t - tm.a) / (tm.rest - tm.a)) : (t >= tm.a ? 1 : 0);
    const fout = tm.b > tm.out ? smooth((tm.b - t) / (tm.b - tm.out)) : (t < tm.b ? 1 : 0);
    return fin < fout ? fin : fout;
  }

  // Decorations fade with the text's entrance and exit.
  function runFade(P, t, b) {
    const k = textWeight(t, b.times);
    for (let r = 0; r < b.nodes.length; r++) P.alpha[b.nodes[r]] *= k;
  }

  function fadeWithText(env, nodes) {
    const list = nodes.filter((n) => n !== null && n !== undefined);
    if (list.length === 0) return;
    env.sb.behave({ phase: K.PH.ORNAMENT, live: 'always', from: Math.min(...list), to: Math.max(...list) + 1,
      t0: env.times.a, t1: env.times.b, run: runFade, nodes: Int32Array.from(list), times: env.times });
  }

  // Paints: fills behind the words are paints, not shapes, so an `el.text.fill` pin recolours the words and never
  // the band, panel or card under them. Pure in (t, data, q); data in frame du.
  function roundRect(g, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    g.beginPath();
    g.moveTo(x + rr, y);
    g.lineTo(x + w - rr, y); g.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0);
    g.lineTo(x + w, y + h - rr); g.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2);
    g.lineTo(x + rr, y + h); g.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
    g.lineTo(x, y + rr); g.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5);
    g.closePath();
  }

  // A turned rectangle (band, strip or panel): fill, a faint ink veil so a ground2 tint reads on every theme, and
  // optional accent edges along its long sides.
  function drawSlab(g, t, d, q) {
    g.save();
    g.translate(d.cx, d.cy);
    g.rotate(d.rot);
    g.fillStyle = q.rgba(d.fill, d.alpha);
    g.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
    if (d.veil > 0) { g.fillStyle = q.rgba('ink', d.veil); g.fillRect(-d.w / 2, -d.h / 2, d.w, d.h); }
    if (d.edge > 0) {
      g.fillStyle = q.rgba('accent', 1);
      if (d.w >= d.h) { g.fillRect(-d.w / 2, -d.h / 2, d.w, d.edge); g.fillRect(-d.w / 2, d.h / 2 - d.edge, d.w, d.edge); }
      else { g.fillRect(-d.w / 2, -d.h / 2, d.edge, d.h); g.fillRect(d.w / 2 - d.edge, -d.h / 2, d.edge, d.h); }
    }
    g.restore();
  }

  // A paper card with a soft shadow (stacked, growing translucent shapes) and an optional inner hairline.
  function drawCard(g, t, d, q) {
    g.save();
    g.translate(d.cx + d.sx, d.cy + d.sy);
    g.rotate(d.rot);
    for (let i = 1; i <= 6; i++) {
      const grow = d.soft * (i - 2);
      g.fillStyle = q.rgba('#000000', d.shadow);
      roundRect(g, d.x - grow, d.y - grow, d.w + 2 * grow, d.h + 2 * grow, d.r + grow);
      g.fill();
    }
    g.restore();
    g.save();
    g.translate(d.cx, d.cy);
    g.rotate(d.rot);
    g.fillStyle = q.rgba(d.fill, 1);
    roundRect(g, d.x, d.y, d.w, d.h, d.r);
    g.fill();
    if (d.border > 0) {
      g.strokeStyle = q.rgba('muted', 0.9);
      g.lineWidth = d.border;
      roundRect(g, d.x + d.inset, d.y + d.inset, d.w - 2 * d.inset, d.h - 2 * d.inset, Math.max(0, d.r - d.inset / 2));
      g.stroke();
    }
    g.restore();
  }

  function slab(env, layer, data) {
    return env.sb.paint({ layer, bleed: 0.2, animated: true, data: Object.assign({ rot: 0, alpha: 1, veil: 0, edge: 0 }, data),
      draw: drawSlab });
  }

  function noteLine(env, root, note, box, align, ne) {
    if (!note) return null;
    return env.sb.text({ parent: root.node, text: note, orient: 'h', face: NOTE_FACE, size: ne, style: 'plain', box, align,
      valign: 'start', maxLines: 1, breakAt: 'none', fit: 'shrink' });
  }

  // --- magazineHead ----------------------------------------------------------------------------------------------

  // Headline and sub-line: a note becomes the sub-line; otherwise a long line splits near 60% of its cells.
  function headSplit(env, s) {
    if (!s.own) return { head: [0, s.str.length], sub: null };
    if (s.note) return { head: [0, s.str.length], sub: { text: s.note } };
    const k = env.text.cells(s.str) > 9 ? breakNear(env, s.str, 0.6) : null;
    if (k === null) return { head: [0, s.str.length], sub: null };
    return { head: [0, k], sub: { span: [k, s.str.length] } };
  }

  function magazineBuild(env, p) {
    const { D, cut, sb, text, textStyle } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const split = headSplit(env, s);
    const headStr = s.str.slice(split.head[0], split.head[1]);
    const colW = safe.w * p.width;
    const left = safe.x + safe.w * 0.03;
    const scale = textStyle.scale;
    const fit = bestFit(env, headStr, colW, safe.h * 0.46, 2, 1.12, D.short * 0.19 * Math.max(1, scale));
    const em = fit.em * Math.min(1, scale);
    // A note sub-line is a quiet caption; the rest of the lyric keeps half the headline size.
    const subEm = split.sub && split.sub.span ? clamp(em * 0.5, D.short * 0.05, D.short * 0.1)
      : clamp(em * 0.3, D.short * 0.036, D.short * 0.058);
    const subStr = split.sub ? (split.sub.text || s.str.slice(split.sub.span[0], split.sub.span[1])) : '';
    const subLines = subStr ? clamp(Math.ceil((text.cells(subStr) * subEm) / (colW * 0.86)), 1, 3) : 0;
    const kick = p.kicker ? em * 0.34 : 0;
    const headH = (1 + (fit.lines - 1) * 1.12) * em * 1.08;
    const total = kick + headH + em * 0.5 + subLines * subEm * 1.5;
    const top = p.place === 'upper' ? safe.y + safe.h * 0.06 + kick
      : p.place === 'lower' ? safe.y + safe.h * 0.94 - total + kick : D.cy - total / 2 + kick;
    const head = sb.text(Object.assign({ parent: root.node, orient: 'h', size: em, box: { x: left, y: top, w: colW, h: headH },
      leading: 1.12, align: 'start', valign: 'start', maxLines: fit.lines, breakAt: 'phrase', fit: 'shrink' },
    s.own ? { span: split.head } : { text: headStr }));
    const hb = localBounds(sb, head.node, root);
    const ruleY = hb.y + hb.h + em * 0.26;
    const weight = clamp(em * 0.035, 2, 7);
    const ruleEnd = hb.x + Math.max(hb.w, colW * 0.62);
    const deco = [sb.shape({ parent: root.node, layer: 'text', path: K.shape.line(hb.x, ruleY, ruleEnd, ruleY), stroke: 'ink',
      width: weight })];
    if (p.kicker) {
      deco.push(sb.shape({ parent: root.node, layer: 'text', fill: 'accent',
        path: K.shape.rect(hb.x, hb.y - em * 0.3, em * 0.9, clamp(em * 0.09, 4, 16)) }));
    }
    fadeWithText(env, deco);
    const runs = [head];
    if (split.sub) {
      const box = { x: hb.x, y: ruleY + subEm * 0.75, w: colW * 0.86, h: subEm * 1.5 * 3 };
      const spec = split.sub.text ? { text: split.sub.text, face: NOTE_FACE, style: 'plain' }
        : { span: split.sub.span, face: 'body' };
      runs.push(sb.text(Object.assign({ parent: root.node, orient: 'h', size: subEm, box, leading: 1.5, align: 'start',
        valign: 'start', maxLines: 3, breakAt: 'phrase', fit: 'shrink' }, spec)));
    }
    return finish(env, root, runs);
  }

  const magazineHead = K.arrange({
    key: 'magazineHead',
    label: L('誌面', 'Magazine head'),
    blurb: L('大見出しと罫、その下に小さな副題を左揃えで組む', 'A headline and a smaller sub-line under a rule, left aligned like an editorial page'),
    tags: ['literary', 'bold'], family: 'editorial',
    traits: { orient: ['h'], cells: [2, 40], roles: ['lyric', 'focus', 'title'] },
    params: {
      place: { type: 'enum', of: ['upper', 'middle', 'lower'], label: L('縦の位置', 'Placement'),
        auto: { pick: ['upper', 'middle', 'lower'], weights: [2, 3, 2] } },
      width: { type: 'num', min: 0.4, max: 0.95, step: 0.01, unit: 'frac', label: L('段の幅', 'Column width'),
        auto: { range: [0.62, 0.86], follow: 'cells' } },
      kicker: { type: 'bool', label: L('見出しの印', 'Kicker bar'), auto: { pick: [true, false], weights: [3, 2] } },
    },
    build: magazineBuild,
  });

  // --- diptychSplit ----------------------------------------------------------------------------------------------

  // The split point moves with the offsets (along the split axis; the other offset moves the words inside their
  // panels): panels, divider and words are all placed from it, so every piece stays in its own panel.
  function diptychBuild(env, p) {
    const { D, cut, sb, text, textStyle } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const v = env.orient === 'v';
    // Side by side in a wide frame, one above the other in a tall one; a square frame splits across the lines, so
    // horizontal lines keep the full width (panels above each other) and vertical columns the full height.
    const wide = Math.abs(D.w - D.h) < 1 ? v : D.w > D.h;
    const sh = root.shift;
    const size = wide ? D.w : D.h;
    const at = clamp(size * p.ratio + (wide ? sh.x : sh.y), size * 0.2, size * 0.8);
    // Runs and shapes hang under the shifted root: frame boxes are given in its frame, keeping the cross offset.
    const local = (b) => (wide ? { x: b.x - sh.x, y: b.y, w: b.w, h: b.h } : { x: b.x, y: b.y - sh.y, w: b.w, h: b.h });
    const panels = wide
      ? [{ x: 0, y: 0, w: at, h: D.h }, { x: at, y: 0, w: D.w - at, h: D.h }]
      : [{ x: 0, y: 0, w: D.w, h: at }, { x: 0, y: at, w: D.w, h: D.h - at }];
    const tinted = p.tint === 'first' ? 0 : 1;
    const tp = panels[tinted];
    const bleedW = D.w * 0.25, bleedH = D.h * 0.25;
    const fill = { x: tp.x - (tp.x === 0 ? bleedW : 0), y: tp.y - (tp.y === 0 ? bleedH : 0) };
    fill.w = tp.x + tp.w + (tp.x + tp.w >= D.w ? bleedW : 0) - fill.x;
    fill.h = tp.y + tp.h + (tp.y + tp.h >= D.h ? bleedH : 0) - fill.y;
    const deco = [slab(env, 'mid', { cx: fill.x + fill.w / 2, cy: fill.y + fill.h / 2, w: fill.w, h: fill.h, fill: 'ground2',
      veil: 0.035 })];
    if (p.divider) {
      const d = wide ? { x: at - sh.x, y: -bleedH - sh.y } : { x: -bleedW - sh.x, y: at - sh.y };
      deco.push(sb.shape({ parent: root.node, layer: 'mid', stroke: 'muted', width: 2,
        path: wide ? K.shape.line(d.x, d.y, d.x, d.y + D.h + 2 * bleedH) : K.shape.line(d.x, d.y, d.x + D.w + 2 * bleedW, d.y) }));
    }
    fadeWithText(env, deco);
    // What goes where: two balanced pieces (or the line and its note); vertical text reads its right panel first.
    const pieces = s.own ? text.columns(s.str, 2, cut.lang) : [[0, s.str.length]];
    const items = pieces.map((r) => part(s, r));
    if (items.length === 1 && s.note) items.push({ text: s.note, note: true });
    const order = v && wide ? [1, 0] : [0, 1];
    const slots = items.length === 1 ? [tinted] : order;
    const innerOf = (panel) => {
      const inner = { x: Math.max(panel.x, safe.x), y: Math.max(panel.y, safe.y) };
      inner.w = Math.min(panel.x + panel.w, safe.x + safe.w) - inner.x;
      inner.h = Math.min(panel.y + panel.h, safe.y + safe.h) - inner.y;
      return inner;
    };
    const runs = items.map((item, i) => {
      const inner = innerOf(panels[slots[i]]);
      const box = local({ x: inner.x + inner.w * 0.08, y: inner.y + inner.h * 0.1, w: inner.w * 0.84, h: inner.h * 0.8 });
      const str = item.text || s.str.slice(item.span[0], item.span[1]);
      const along = v ? box.h : box.w, cross = v ? box.w : box.h;
      const fit = bestFit(env, str, along, cross, 3, v ? 1.5 : 1.3, D.short * (item.note ? 0.07 : 0.2));
      return sb.text(Object.assign({ parent: root.node, orient: v ? 'v' : 'h', size: fit.em * textStyle.scale, box,
        sizeGroup: item.note ? undefined : 'diptych', leading: v ? 1.5 : 1.3, align: 'center', valign: 'center',
        maxLines: Math.max(fit.lines, 2), breakAt: 'phrase', fit: 'shrink' },
      item.note ? { text: item.text, face: NOTE_FACE, style: 'plain' } : item));
    });
    if (s.note && items.length > 1) {
      // Both panels hold words: the note sits small at the foot of the second panel.
      const inner = innerOf(panels[slots[1]]);
      const ne = clamp(D.short * 0.04, D.short * 0.03, D.short * 0.05);
      runs.push(noteLine(env, root, s.note, local({ x: inner.x + inner.w * 0.08, y: inner.y + inner.h - ne * 1.6,
        w: inner.w * 0.84, h: ne * 1.5 }), 'center', ne));
    }
    return finish(env, root, runs, textBounds(env, runs));
  }

  const diptychSplit = K.arrange({
    key: 'diptychSplit',
    label: L('二面', 'Diptych split'),
    blurb: L('画面を二枚の面に分け、句を交互に置く', 'The frame split into two panels, the phrases set alternately in them'),
    tags: ['serious', 'minimal'], family: 'editorial',
    traits: { cells: [2, 36] },
    // One word (「紙ひこうき」, "Hello") has no phrase to split at: its one piece would fill one panel and leave the
    // other half of the frame empty, so the planner (nearly) never picks the diptych for it. A note would fill the
    // second panel, but the features do not say whether the cut has one; a pin still sets it.
    fits: (f) => (f.words >= 2 ? 1 : 0.05),
    params: {
      ratio: { type: 'num', min: 0.35, max: 0.65, step: 0.01, unit: 'frac', label: L('分け目', 'Split at'),
        auto: { range: [0.44, 0.56] } },
      tint: { type: 'enum', of: ['first', 'second'], label: L('色面', 'Tinted panel'), auto: { pick: ['first', 'second'] } },
      divider: { type: 'bool', label: L('境の線', 'Divider'), auto: { pick: [false, true], weights: [3, 2] } },
    },
    build: diptychBuild,
  });

  // --- slantBand -------------------------------------------------------------------------------------------------

  function slantBuild(env, p) {
    const { D, cut, sb, textStyle } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const v = env.orient === 'v';
    const rot = p.angle * DEG;
    const cx = D.cx, cy = D.cy;
    const c = Math.abs(Math.cos(rot)), sn = Math.max(1e-3, Math.abs(Math.sin(rot)));
    const through = v ? Math.min(D.h / c, D.w / sn) : Math.min(D.w / c, D.h / sn);
    const cross = (v ? D.w : D.h) * 0.34;
    // The line's box, turned, stays in the safe area together with the note's room (steep bands in wide frames).
    const safe = safeBox(D), deep = cross + (s.note ? D.short * 0.05 * 2.2 : 0);
    const within = v ? Math.min((safe.w - deep * c) / sn, (safe.h - deep * sn) / c)
      : Math.min((safe.w - deep * sn) / c, (safe.h - deep * c) / sn);
    const along = Math.max(through * 0.3, Math.min(through * 0.78, within));
    // Up to two lines; three in a frame no longer along the lines than across them, where a long line on two would
    // come out small (the band grows with the lines).
    const narrow = (v ? D.h : D.w) <= (v ? D.w : D.h) * 1.01;
    const fit = bestFit(env, s.str, along, cross, narrow ? 3 : 2, v ? 1.45 : 1.2, D.short * 0.2);
    const em = fit.em * textStyle.scale;
    const ne = clamp(em * 0.3, D.short * 0.03, D.short * 0.05);
    const lift = s.note ? (v ? ne * 1.1 : -ne) : 0;             // the line and its note are centred together
    const turn = sb.group({ parent: root.node, x: cx, y: cy, rot });
    const box = v ? { x: -cross / 2 + lift, y: -along / 2, w: cross, h: along }
      : { x: -along / 2, y: -cross / 2 + lift, w: along, h: cross };
    const main = sb.text(Object.assign({ parent: turn, orient: v ? 'v' : 'h', size: em, box, leading: v ? 1.45 : 1.2,
      align: 'center', valign: 'center', maxLines: fit.lines, breakAt: 'phrase', fit: 'shrink' }, whole(s)));
    const shiftCx = cx + root.shift.x, shiftCy = cy + root.shift.y;
    let r = turnedRect(sb, main.node, shiftCx, shiftCy, rot);
    const runs = [main];
    if (s.note) {
      const nb = v ? { x: r.x - ne * 2.2, y: r.y, w: ne * 1.5, h: r.h } : { x: r.x, y: r.y + r.h + ne * 0.5, w: r.w, h: ne * 1.5 };
      const note = sb.text({ parent: turn, text: s.note, orient: v ? 'v' : 'h', face: NOTE_FACE, size: ne, style: 'plain',
        box: nb, align: v ? 'start' : 'end', valign: 'start', maxLines: 1, breakAt: 'none', fit: 'shrink' });
      runs.push(note);
      r = unionRect(r, turnedRect(sb, note.node, shiftCx, shiftCy, rot));
    }
    const pad = em * 0.42;
    const thick = (v ? r.w : r.h) + pad * 2;
    const mid = v ? r.x + r.w / 2 : r.y + r.h / 2;
    const len = Math.hypot(D.w, D.h) * 1.5;
    const off = { x: v ? mid : 0, y: v ? 0 : mid };
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const band = slab(env, 'mid', { cx: shiftCx + off.x * cos - off.y * sin, cy: shiftCy + off.x * sin + off.y * cos, rot,
      w: v ? thick : len, h: v ? len : thick, fill: 'ground2', veil: 0.05, edge: p.edge ? clamp(em * 0.04, 2, 8) : 0 });
    fadeWithText(env, [band]);
    return finish(env, root, runs);
  }

  const slantBand = K.arrange({
    key: 'slantBand',
    label: L('斜め帯', 'Slant band'),
    blurb: L('画面を斜めに横切る色帯に一行を載せる', 'The line set on a tinted band tilted across the frame'),
    tags: ['bold', 'fast'], family: 'tilt',
    traits: { cells: [2, 26], energy: [0.3, 1] },
    params: {
      angle: { type: 'num', min: -20, max: -8, step: 0.5, unit: 'deg', label: L('傾き', 'Angle'),
        auto: { range: [-15, -9], follow: 'energy' } },
      edge: { type: 'bool', label: L('帯の縁', 'Band edges'), auto: { pick: [false, true], weights: [2, 1] } },
    },
    build: slantBuild,
  });

  // --- tiltedCard ------------------------------------------------------------------------------------------------

  function cardBuild(env, p) {
    const { D, cut, sb, textStyle } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const v = env.orient === 'v';
    const tilt = Math.abs(p.tilt) < 1.5 ? (p.tilt < 0 ? -1.5 : 1.5) : p.tilt;
    const rot = tilt * DEG;
    // A frame no longer along the lines than across them (horizontal lines in a square or tall frame) gives the card
    // more of its width and a fourth line, so a long line is not set small on a narrow card.
    const narrow = (v ? safe.h : safe.w) <= (v ? safe.w : safe.h) * 1.01;
    const along = (v ? safe.h : safe.w) * (narrow ? 0.76 : 0.6), cross = (v ? safe.w : safe.h) * (narrow ? 0.5 : 0.42);
    const fit = bestFit(env, s.str, along, cross, narrow ? 4 : 3, v ? 1.5 : 1.35, D.short * 0.15);
    const em = fit.em * textStyle.scale;
    const turn = sb.group({ parent: root.node, x: D.cx, y: D.cy, rot });
    const box = v ? { x: -cross / 2, y: -along / 2, w: cross, h: along } : { x: -along / 2, y: -cross / 2, w: along, h: cross };
    const main = sb.text(Object.assign({ parent: turn, orient: v ? 'v' : 'h', size: em, box, leading: v ? 1.5 : 1.35,
      align: v ? 'start' : 'center', valign: 'center', maxLines: fit.lines, breakAt: 'phrase', fit: 'shrink' }, whole(s)));
    const cx = D.cx + root.shift.x, cy = D.cy + root.shift.y;
    let r = turnedRect(sb, main.node, cx, cy, rot);
    const runs = [main];
    if (s.note) {
      const ne = clamp(em * 0.36, D.short * 0.028, D.short * 0.048);
      const nb = v ? { x: r.x - ne * 2.4, y: r.y + r.h * 0.2, w: ne * 1.5, h: r.h * 0.8 }
        : { x: r.x, y: r.y + r.h + ne * 0.7, w: r.w, h: ne * 1.5 };
      const note = sb.text({ parent: turn, text: s.note, orient: v ? 'v' : 'h', face: NOTE_FACE, size: ne, style: 'plain',
        box: nb, align: 'end', valign: 'start', maxLines: 1, breakAt: 'none', fit: 'shrink' });
      runs.push(note);
      r = unionRect(r, turnedRect(sb, note.node, cx, cy, rot));
    }
    const pad = em * p.pad;
    const w = r.w + pad * 2, h = r.h + pad * 2;
    const card = sb.paint({ layer: 'mid', bleed: 0.05, animated: true, draw: drawCard, data: {
      cx, cy, rot, x: r.x - pad, y: r.y - pad, w, h, r: Math.min(w, h) * 0.035, fill: 'ground2',
      sx: h * 0.03, sy: h * 0.05, soft: Math.max(2, h * 0.014), shadow: 0.02 + 0.035 * p.shadow,
      border: p.border ? clamp(em * 0.02, 1.2, 3) : 0, inset: pad * 0.35 } });
    fadeWithText(env, [card]);
    return finish(env, root, runs);
  }

  const tiltedCard = K.arrange({
    key: 'tiltedCard',
    label: L('傾いた札', 'Tilted card'),
    blurb: L('少し傾いた紙の札に文字を載せ、やわらかい影を落とす', 'Text on a slightly rotated paper card with a soft shadow'),
    tags: ['soft', 'retro'], family: 'tilt',
    traits: { cells: [1, 30] },
    params: {
      tilt: { type: 'num', min: -8, max: 8, step: 0.25, unit: 'deg', label: L('傾き', 'Tilt'), auto: { range: [-5, 5] } },
      pad: { type: 'num', min: 0.3, max: 1.6, step: 0.05, unit: 'em', label: L('余白', 'Padding'), auto: { range: [0.55, 0.95] } },
      shadow: { type: 'num', min: 0, max: 1, step: 0.01, label: L('影の濃さ', 'Shadow'), auto: { range: [0.4, 0.8] } },
      border: { type: 'bool', label: L('内枠', 'Inner rule'), auto: { pick: [false, true], weights: [3, 2] } },
    },
    build: cardBuild,
  });

  // --- tickerMarquee (motion: 'own') -----------------------------------------------------------------------------

  // The ticker owns its motion (the planner gives it instant entrance/exit and a still hold): copies scroll by the
  // RunSpec drift, and everything fades in and out over the first and last 0.3 s of the cut window.
  function runEdgeFade(P, t, b) {
    const k = Math.min(smooth((t - b.t0) / b.ramp), smooth((b.t1 - t) / b.ramp));
    for (let r = 0; r < b.nodes.length; r++) P.alpha[b.nodes[r]] *= k;
  }

  // The planner's palette under the black or chroma backdrop (§4.16.3): there an 'ink' strip would turn white under
  // black words, or key its words out, so it is drawn as the tinted strip instead.
  function flatBackdrop(pal) {
    const ground = String((pal && pal.ground) || '').toUpperCase(), ink = String((pal && pal.ink) || '').toUpperCase();
    return ground === '#00B140' || (ground === '#000000' && ink === '#FFFFFF');
  }

  function tickerBuild(env, p) {
    const { D, cut, sb, textStyle } = env;
    const root = rootOf(env, p);
    const solid = p.strip === 'ink' && !flatBackdrop(env.pal);        // else an 'ink' strip is drawn as the tint
    const s = subjectOf(cut);
    const v = env.orient === 'v';
    const em = D.short * p.size * textStyle.scale;
    const thick = em * 1.9;
    const at = (v ? D.w : D.h) * p.pos;
    const speed = p.speed;
    const tail = Math.max(0, env.times.b) + 0.5;
    const start = (v ? D.safe.t : D.safe.l) + (v ? D.h : D.w) * 0.06;
    const huge = em * Math.max(8, s.str.length * 2.5);
    const copyAt = (offset) => sb.text(Object.assign({ parent: root.node, orient: v ? 'v' : 'h', size: em, style: textStyle.style,
      box: v ? { x: at - em * 0.75, y: offset, w: em * 1.5, h: huge } : { x: offset, y: at - em * 0.75, w: huge, h: em * 1.5 },
      align: 'start', valign: 'center', maxLines: 1, breakAt: 'none', fit: 'none',
      move: v ? { vx: 0, vy: -speed } : { vx: -speed, vy: 0 } }, solid ? { ink: 'ground', emphInk: 'ground2' } : {},
    whole(s)));
    const first = copyAt(start);
    const fb = sb.bounds(first.node);
    const size = Math.max(em, v ? fb.h : fb.w);
    const gap = em * p.gap;
    const pitch = size + gap;
    const need = Math.ceil(((v ? D.h : D.w) - start + speed * tail) / pitch) + 1;
    const most = Math.max(1, Math.floor(GLYPH_BUDGET / Math.max(1, s.str.length)));
    const count = Math.min(need, most);
    const runs = [first];
    for (let k = 1; k < count; k++) runs.push(copyAt(start + k * pitch));
    runs.unshift(count < most ? copyAt(start - pitch) : null);
    const marks = [];
    if (p.sep !== 'none') {
      for (const run of runs) {
        if (!run) continue;
        const b = localBounds(sb, run.node, root);
        const c = v ? { x: at, y: b.y + b.h + gap / 2 } : { x: b.x + b.w + gap / 2, y: at };
        const rr = em * 0.13;
        marks.push(sb.shape({ parent: run.node, layer: 'text', fill: solid ? 'ground' : 'accent',
          path: p.sep === 'dot' ? K.shape.ellipse(c.x, c.y, rr, rr)
            : K.shape.poly([c.x, c.y - rr * 1.6, c.x + rr * 1.6, c.y, c.x, c.y + rr * 1.6, c.x - rr * 1.6, c.y], true) }));
      }
    }
    const len = (v ? D.h : D.w) * 1.6;
    const deco = [];
    if (p.strip === 'rules') {
      for (const side of [-1, 1]) {
        const q = at + (side * thick) / 2;
        deco.push(sb.shape({ parent: root.node, layer: 'mid', stroke: 'muted', width: clamp(em * 0.03, 1.5, 4),
          path: v ? K.shape.line(q, -D.h * 0.3, q, D.h * 1.3) : K.shape.line(-D.w * 0.3, q, D.w * 1.3, q) }));
      }
    } else {
      deco.push(slab(env, 'mid', { cx: v ? at + root.shift.x : D.cx, cy: v ? D.cy : at + root.shift.y, w: v ? thick : len,
        h: v ? len : thick, fill: solid ? 'ink' : 'ground2', veil: solid ? 0 : 0.05 }));
    }
    const note = s.note ? tickerNote(env, root, s.note, em, at, thick) : null;
    const all = runs.filter(Boolean).map((r) => r.node).concat(deco, note ? [note.node] : []);
    sb.behave({ phase: K.PH.ORNAMENT, live: 'always', from: Math.min(...all), to: Math.max(...all) + 1, t0: env.times.a,
      t1: env.times.b, run: runEdgeFade, ramp: 0.3, nodes: Int32Array.from(all) });
    const strip = v ? { x: at - thick / 2 + root.shift.x, y: 0, w: thick, h: D.h }
      : { x: 0, y: at - thick / 2 + root.shift.y, w: D.w, h: thick };
    const focus = note ? unionRect(strip, sb.bounds(note.node)) : strip;
    return { runs: runs.filter(Boolean).concat(note ? [note] : []), focus, free: sb.freeAround(focus) };
  }

  // The `|note` (SPEC §3): once, small and still, beside the strip where the copies start — above it for horizontal
  // text, left of it for vertical text, or on the other side when that side leaves the safe area. It fades with the
  // strip (runEdgeFade).
  function tickerNote(env, root, note, em, at, thick) {
    const { D, sb } = env;
    const v = env.orient === 'v';
    const ne = clamp(em * 0.36, D.short * 0.03, D.short * 0.05);
    const room = ne * 1.5, gap = ne * 0.6;
    const safe = safeBox(D);
    const lo = (v ? safe.x - root.shift.x : safe.y - root.shift.y);
    const hi = lo + (v ? safe.w : safe.h);
    const before = at - thick / 2 - gap - room;
    const cross = before >= lo ? before : Math.min(at + thick / 2 + gap, hi - room);
    const box = v ? { x: cross, y: safe.y - root.shift.y, w: room, h: safe.h }
      : { x: safe.x - root.shift.x, y: cross, w: safe.w, h: room };
    return sb.text({ parent: root.node, text: note, orient: v ? 'v' : 'h', face: NOTE_FACE, size: ne, style: 'plain',
      box, align: 'start', valign: 'center', maxLines: 1, breakAt: 'none', fit: 'shrink' });
  }

  const tickerMarquee = K.arrange({
    key: 'tickerMarquee',
    label: L('流れ帯', 'Ticker marquee'),
    blurb: L('帯の上を一行がくり返し流れていく', 'One line scrolling along a strip across the frame, repeated end to end'),
    tags: ['fast', 'digital'], family: 'strip', motion: 'own',
    traits: { cells: [2, 40], energy: [0.35, 1] },
    params: {
      speed: { type: 'num', min: 60, max: 900, step: 5, unit: 'du', label: L('流れる速さ', 'Speed'),
        auto: { range: [170, 380], follow: 'energy' } },
      size: { type: 'num', min: 0.04, max: 0.16, step: 0.002, unit: 'frac', label: L('文字の大きさ', 'Type size'),
        auto: { range: [0.08, 0.115], follow: '-cells' } },
      pos: { type: 'num', min: 0.15, max: 0.85, step: 0.01, unit: 'frac', label: L('帯の位置', 'Strip position'),
        auto: { range: [0.4, 0.64] } },
      // 'ink' (a solid strip, words in the ground colour) only by pin; black and chroma backdrops draw it as 'tint'.
      strip: { type: 'enum', of: ['tint', 'ink', 'rules'], label: L('帯', 'Strip'),
        auto: { pick: ['tint', 'rules'], weights: [3, 2] } },
      gap: { type: 'num', min: 0.8, max: 5, step: 0.1, unit: 'em', label: L('くり返しの間', 'Repeat gap'), auto: { range: [1.4, 2.6] } },
      sep: { type: 'enum', of: ['dot', 'diamond', 'none'], label: L('区切り', 'Separator'),
        auto: { pick: ['dot', 'diamond', 'none'], weights: [3, 2, 1] } },
    },
    build: tickerBuild,
  });

  return [magazineHead, diptychSplit, slantBand, tiltedCard, tickerMarquee];
});
