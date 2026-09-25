/* 文字PVメーカー v2 — original work. Compositions around the frame: centre anchor, giant & whisper, echo stack, edge bleed, corner note. */
MV.def('parts/arrange/core', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, smooth } = K.math;
  const L = (ja, en) => ({ ja, en });
  const NOTE_FACE = 'body';
  const GLYPH_BUDGET = 160;       // glyphs one composition may draw (echo copies count)

  // --- helpers (defined once per module, never per build) --------------------------------------------------------

  function safeBox(D) {
    return { x: D.safe.l, y: D.safe.t, w: D.w - D.safe.l - D.safe.r, h: D.h - D.safe.t - D.safe.b };
  }

  // What a composition shows: the cut's own text, or for a blank special cut its note (a section heading) or ♪.
  function subjectOf(cut) {
    const text = cut.text || '';
    if (text.trim()) return { spec: { span: [0, text.length] }, str: text, note: cut.note || null };
    const shown = cut.note || '♪';
    return { spec: { text: shown }, str: shown, note: null };
  }

  // The shared offsetX / offsetY params move the whole composition; it is built in unshifted frame coordinates
  // under a root group that carries the shift.
  function rootOf(env, p) {
    const shift = { x: (p.offsetX || 0) * env.D.w, y: (p.offsetY || 0) * env.D.h };
    return { shift, node: env.sb.group({ x: shift.x, y: shift.y }) };
  }

  // Bounds of a node in the root's (unshifted) frame.
  function localBounds(sb, node, root) {
    const b = sb.bounds(node);
    return { x: b.x - root.shift.x, y: b.y - root.shift.y, w: b.w, h: b.h };
  }

  // The line count (1…maxLines) and em that give the largest type for lines of `along` du, `pitch` em apart within
  // `cross` du: { em, lines, widest } (widest = cells of the longest line). Lines are the balanced phrase pieces the
  // layout will also find, so a split that leaves one long line never looks better than it is; more lines are taken
  // only when they give clearly larger type. Callers pass the count on as the run's maxLines, so a line that measures a
  // little wider than its cells shrinks instead of breaking.
  function bestFit(env, str, along, cross, maxLines, pitch, cap) {
    const { text, cut } = env;
    let best = { em: 0, lines: 1, widest: 1 };
    for (let n = 1; n <= maxLines; n++) {
      const pieces = n === 1 ? [[0, str.length]] : text.columns(str, n, cut.lang);
      if (pieces.length < n) break;
      const cells = pieces.map(([a, b]) => Math.max(1, text.cells(str.slice(a, b))));
      if (n > 1 && Math.min(...cells) < 0.45 * Math.max(...cells)) continue;     // a lone word on its own line
      const widest = Math.max(...cells);
      const em = Math.min(cap, along / widest, cross / ((n - 1) * pitch + 1));
      if (em > best.em * 1.15) best = { em, lines: n, widest };
    }
    return best;
  }

  function trimRange(str, a, b) {
    let x = a, y = b;
    while (x < y && /\s/.test(str[x])) x++;
    while (y > x && /\s/.test(str[y - 1])) y--;
    return y > x ? [x, y] : null;
  }

  function noteEm(em, D) { return clamp(em * 0.3, D.short * 0.03, D.short * 0.05); }

  // The note (a `|note` mark, or the artist on a title card): a small line under a horizontal block, or a thin
  // column left of a vertical one.
  function noteRun(env, root, note, block, em) {
    if (!note) return null;
    const { D, sb } = env;
    const ne = noteEm(em, D), safe = safeBox(D);
    if (env.orient === 'v') {
      const x = Math.max(safe.x, block.x - ne * 2.2);
      const h = Math.min(Math.max(block.h, ne * 8), safe.y + safe.h - block.y);
      return sb.text({ parent: root.node, text: note, orient: 'v', face: NOTE_FACE, size: ne, style: 'plain',
        box: { x, y: block.y, w: ne * 1.5, h }, align: 'start', valign: 'start', maxLines: 1, breakAt: 'none', fit: 'shrink' });
    }
    const y = Math.min(block.y + block.h + ne * 0.9, safe.y + safe.h - ne * 1.4);
    return sb.text({ parent: root.node, text: note, orient: 'h', face: NOTE_FACE, size: ne, style: 'plain',
      box: { x: safe.x, y, w: safe.w, h: ne * 1.5 }, align: 'center', valign: 'start', maxLines: 1, breakAt: 'none',
      fit: 'shrink' });
  }

  function finish(env, root, runs, focus) {
    const f = focus || env.sb.bounds(root.node);
    return { runs: runs.filter(Boolean), focus: f, free: env.sb.freeAround(f) };
  }

  function intersect(a, b) {
    const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: 0, h: 0 };
  }

  // Decorations of a composition fade with the text's entrance and exit, like `follow: 'text'` ornaments.
  function textWeight(t, tm) {
    const fin = tm.rest > tm.a ? smooth((t - tm.a) / (tm.rest - tm.a)) : (t >= tm.a ? 1 : 0);
    const fout = tm.b > tm.out ? smooth((tm.b - t) / (tm.b - tm.out)) : (t < tm.b ? 1 : 0);
    return fin < fout ? fin : fout;
  }

  function runFade(P, t, b) {
    const k = textWeight(t, b.times);
    for (let r = 0; r < b.nodes.length; r++) P.alpha[b.nodes[r]] *= k;
  }

  function fadeWithText(env, nodes) {
    if (nodes.length === 0) return;
    const from = Math.min(...nodes), to = Math.max(...nodes) + 1;
    env.sb.behave({ phase: K.PH.ORNAMENT, live: 'always', from, to, t0: env.times.a, t1: env.times.b, run: runFade,
      nodes: Int32Array.from(nodes), times: env.times });
  }

  // --- centerAnchor (fallback) -----------------------------------------------------------------------------------

  function centerBuild(env, p) {
    const { D, cut, sb, textStyle } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const v = env.orient === 'v';
    const along = v ? safe.h * (0.66 + 0.3 * p.measure) : safe.w * p.measure;
    const cross = v ? safe.w * 0.8 : safe.h * 0.66;
    const fit = bestFit(env, s.str, along, cross, 2, v ? 1.5 : 1.3, D.short * 0.26);
    const em = fit.em * textStyle.scale;
    const box = v ? { x: D.cx - cross / 2, y: D.cy - along / 2, w: cross, h: along }
      : { x: D.cx - along / 2, y: D.cy - cross / 2, w: along, h: cross };
    const main = sb.text(Object.assign({ parent: root.node, orient: v ? 'v' : 'h', size: em, box, align: 'center',
      valign: 'center', leading: v ? 1.5 : 1.3, maxLines: fit.lines, breakAt: 'phrase', fit: 'shrink' }, s.spec));
    const note = noteRun(env, root, s.note, localBounds(sb, main.node, root), em);
    return finish(env, root, [main, note]);
  }

  const centerAnchor = K.arrange({
    key: 'centerAnchor',
    label: L('中央', 'Center anchor'),
    blurb: L('一行か二行に整えて画面の中央に置く', 'The line centred in one or two balanced lines, sized to its length'),
    tags: ['minimal', 'serious'], family: 'center', fallback: true,
    params: {
      measure: { type: 'num', min: 0.5, max: 1, step: 0.01, unit: 'frac', label: L('行の幅', 'Measure'),
        auto: { range: [0.74, 0.94], follow: 'cells' } },
    },
    build: centerBuild,
  });

  // --- giantWhisper ----------------------------------------------------------------------------------------------

  // The giant range: the first emphasis, else the longest word; the rest before and after it are whispered.
  function giantSplit(env) {
    const { cut, text } = env;
    const str = cut.text || '';
    if (!str.trim()) return null;
    let g = null;
    const emph = (cut.emph || []).find((r) => r[1] > r[0] && r[0] < str.length);
    if (emph) g = trimRange(str, Math.max(0, emph[0]), Math.min(str.length, emph[1]));
    if (g && /\s/.test(str.trim())) {
      // Words separated by spaces are never cut: the giant grows to the whole words the emphasis touches.
      const touched = text.words(str, cut.lang).filter((u) => u[0] < g[1] && u[1] > g[0]);
      if (touched.length) g = [Math.min(g[0], touched[0][0]), Math.max(g[1], touched[touched.length - 1][1])];
    }
    if (!g) {
      for (const u of text.words(str, cut.lang)) {
        if (!g || text.cells(str.slice(u[0], u[1])) > text.cells(str.slice(g[0], g[1]))) g = u;
      }
    }
    if (!g) return null;
    g = wholeLatin(str, g);
    return { str, giant: g, before: trimRange(str, 0, g[0]), after: trimRange(str, g[1], str.length) };
  }

  // A Latin word is never cut, in mixed lines without spaces too (「Loveって」: an emphasis on "Lo" takes "Love").
  const LATIN = /[A-Za-z0-9À-ɏ'’]/;
  function wholeLatin(str, g) {
    let a = g[0], b = g[1];
    while (a > 0 && a < str.length && LATIN.test(str[a - 1]) && LATIN.test(str[a])) a--;
    while (b < str.length && b > 0 && LATIN.test(str[b]) && LATIN.test(str[b - 1])) b++;
    return [a, b];
  }

  // Width (du) a whispered range needs at size em, in at most `most` balanced lines (0 without a range).
  function whisperWidth(env, split, r, em, most) {
    if (!r) return 0;
    const { text, cut } = env;
    const str = split.str.slice(r[0], r[1]);
    let best = Infinity;
    for (let n = 1; n <= most; n++) {
      const pieces = n === 1 ? [[0, str.length]] : text.columns(str, n, cut.lang);
      if (pieces.length < n) break;
      best = Math.min(best, Math.max(...pieces.map(([a, b]) => text.cells(str.slice(a, b)))) * em * 1.04);
    }
    return best;
  }

  // The giant's natural width at size em (measured the way the scene will lay it out).
  function giantWidth(env, split, em, room) {
    const { cut, text, textStyle } = env;
    const lay = text.layout({ span: split.giant, orient: 'h', face: textStyle.face, style: textStyle.style, lang: cut.lang,
      size: em, emphScale: 1, box: { x: 0, y: 0, w: room, h: em * 1.3 }, align: 'start', valign: 'center', maxLines: 1,
      breakAt: 'none', fit: 'shrink' }, cut.text);
    return Math.min(room, lay.box.w);
  }

  function giantBuild(env, p) {
    const { D, cut, sb, text, textStyle } = env;
    const split = giantSplit(env);
    if (!split) return centerBuild(env, Object.assign({ measure: 0.9 }, p));
    const root = rootOf(env, p);
    const safe = safeBox(D);
    const v = env.orient === 'v';
    const gCells = Math.max(1, text.cells(split.str.slice(split.giant[0], split.giant[1])));
    const scale = textStyle.scale;
    const sizes = (room) => {
      const gEm = Math.min(room / gCells, (v ? safe.w : safe.h) * 0.46, D.short * 0.42 * Math.max(1, scale)) * Math.min(1, scale);
      return { room, gEm, wEm: clamp(gEm / p.ratio, D.short * 0.04, D.short * 0.09) };
    };
    let z = sizes(v ? safe.h * 0.94 : safe.w * 0.94);
    let beside = null;
    if (!v && p.tuck === 'beside' && (split.before || split.after)) {
      // Beside only when the whispered words keep (nearly) their size next to the giant: in narrow frames, or with long
      // whispers, they go under it instead. The words before the giant stand to its left and the words after it to its
      // right, so the line reads in order (stacked to its right, 「ため息｜昨日の／を」 read out of order). The giant and
      // its whispers are centred as one group.
      const zb = sizes(safe.w * 0.6);
      const gw = giantWidth(env, split, zb.gEm, zb.room);
      const nb = whisperWidth(env, split, split.before, zb.wEm, 2);
      const na = whisperWidth(env, split, split.after, zb.wEm, 2);
      const room = safe.w - gw - ((split.before ? 1 : 0) + (split.after ? 1 : 0)) * zb.wEm * 0.55 * 1.5;
      if ((nb + na) * 0.85 <= room) {
        const k = Math.min(1, room / (nb + na));
        z = zb;
        beside = { gw, wb: nb * k, wa: na * k };
      }
    }
    let gEm = z.gEm;
    const wEm = z.wEm;
    // Vertical: the whisper columns (a gap and up to two columns each) sit beside the giant within the safe width.
    if (v) gEm = Math.min(gEm, safe.w * 0.98 - ((split.before ? 1 : 0) + (split.after ? 1 : 0)) * 2.9 * wEm);
    const g = { env, root, split, safe, gEm, wEm, gap: wEm * 0.55, room: z.room, beside };
    const runs = v ? giantColumn(g) : beside ? giantBeside(g) : giantUnder(g);
    const block = localBounds(sb, root.node, root);
    runs.push(noteRun(env, root, cut.note, block, wEm * 2.2));
    return finish(env, root, runs);
  }

  function giantRun(g, box, align) {
    return g.env.sb.text({ parent: g.root.node, span: g.split.giant, orient: g.env.orient === 'v' ? 'v' : 'h', size: g.gEm,
      emphScale: 1, box, align, valign: 'center', maxLines: 1, breakAt: 'none', fit: 'shrink' });
  }

  function whisperRun(g, span, box, align, valign) {
    return g.env.sb.text({ parent: g.root.node, span, orient: g.env.orient === 'v' ? 'v' : 'h', size: g.wEm, box, align,
      valign, maxLines: 2, breakAt: 'phrase', fit: 'shrink', leading: 1.25 });
  }

  // Vertical: the giant column in the middle; the words before it in a thin column to its right (read first), the
  // words after it to its left, ending with it. The giant moves away from the side that holds whispers, so the group
  // is centred.
  function giantColumn(g) {
    const { env, root, split, safe, gEm, wEm, gap } = g;
    const x = env.D.cx - (split.before ? wEm * 1.2 : 0) + (split.after ? wEm * 1.2 : 0) - gEm / 2;
    const runs = [giantRun(g, { x: x - gEm * 0.1, y: safe.y, w: gEm * 1.2, h: safe.h }, 'center')];
    const gb = localBounds(env.sb, runs[0].node, root);
    const w = wEm * 2.8;
    if (split.before) {
      runs.push(whisperRun(g, split.before, { x: gb.x + gb.w + gap, y: gb.y, w, h: safe.y + safe.h - gb.y }, 'start', 'end'));
    }
    if (split.after) {
      runs.push(whisperRun(g, split.after, { x: gb.x - gap - w, y: safe.y, w, h: gb.y + gb.h - safe.y }, 'end', 'start'));
    }
    return runs;
  }

  // Beside: the words before the giant to its left (set against it), the words after it to its right, each centred
  // on the giant's height, so the line reads in order; the group centred in the frame.
  function giantBeside(g) {
    const { env, root, split, safe, gEm, gap } = g;
    const { gw, wb, wa } = g.beside;
    const sep = gap * 1.5;
    const total = (split.before ? wb + sep : 0) + gw + (split.after ? sep + wa : 0);
    const x0 = Math.max(safe.x, env.D.cx - total / 2);
    const gx = x0 + (split.before ? wb + sep : 0);
    const runs = [giantRun(g, { x: gx, y: env.D.cy - gEm * 0.65, w: gw * 1.02 + 1, h: gEm * 1.3 }, 'start')];
    const gb = localBounds(env.sb, runs[0].node, root);
    if (split.before) {
      const x = Math.max(safe.x, gb.x - sep - wb);
      runs.push(whisperRun(g, split.before, { x, y: gb.y, w: gb.x - sep - x, h: gb.h }, 'end', 'center'));
    }
    if (split.after) {
      const x = gb.x + gb.w + sep;
      runs.push(whisperRun(g, split.after, { x, y: gb.y, w: safe.x + safe.w - x, h: gb.h }, 'start', 'center'));
    }
    return runs;
  }

  // Under: the giant centred; the words before it tucked above its left end, the words after it under its right end.
  // Words wider than the giant (a short emphasized word such as "I") cannot hang from its end without pulling the
  // group to one side: they are centred under (over) it instead, their line breaks unchanged.
  function giantUnder(g) {
    const { env, root, split, safe, gEm, wEm, gap } = g;
    const lift = ((split.before ? 1 : 0) - (split.after ? 1 : 0)) * (wEm * 1.3 + gap) / 2;
    const runs = [giantRun(g, { x: safe.x, y: env.D.cy - gEm * 0.62 + lift, w: safe.w, h: gEm * 1.24 }, 'center')];
    const gb = localBounds(env.sb, runs[0].node, root);
    const h = wEm * 2.6, cx = env.D.cx, right = safe.x + safe.w;
    if (split.before) {
      const x = gb.x + gb.w * 0.02, w = right - x;
      const ww = whisperWidthIn(g, split.before, w, h);
      const x0 = ww > gb.w * 0.96 ? Math.max(safe.x, Math.min(x, cx - ww / 2)) : x;
      runs.push(whisperRun(g, split.before, { x: x0, y: gb.y - gap - h, w, h }, 'start', 'end'));
    }
    if (split.after) {
      const end = gb.x + gb.w * 0.98, w = end - safe.x;
      const ww = whisperWidthIn(g, split.after, w, h);
      const x1 = ww > gb.w * 0.96 ? Math.min(right, Math.max(end, cx + ww / 2)) : end;
      runs.push(whisperRun(g, split.after, { x: x1 - w, y: gb.y + gb.h + gap, w, h }, 'end', 'start'));
    }
    return runs;
  }

  // The width (du) whisperRun will give a span in a box w × h (measured the way the scene lays it out).
  function whisperWidthIn(g, span, w, h) {
    const { cut, text, textStyle, orient } = g.env;
    const lay = text.layout({ span, orient: orient === 'v' ? 'v' : 'h', face: textStyle.face, style: textStyle.style,
      lang: cut.lang, size: g.wEm, box: { x: 0, y: 0, w, h }, align: 'start', valign: 'start', maxLines: 2,
      breakAt: 'phrase', fit: 'shrink', leading: 1.25 }, cut.text);
    return lay.box.w;
  }

  const giantWhisper = K.arrange({
    key: 'giantWhisper',
    label: L('大と小', 'Giant & whisper'),
    blurb: L('強調語（なければ最も長い語）を特大に、残りを小さく添える', 'The emphasized or longest word huge, the rest small and tucked beside or under it'),
    tags: ['bold', 'serious'], family: 'big',
    traits: { cells: [2, 30] },
    fits: (f) => (f.emph ? 1.6 : 1),
    params: {
      ratio: { type: 'num', min: 1.6, max: 5, step: 0.05, unit: 'x', label: L('大小の差', 'Size ratio'),
        auto: { range: [2.3, 3.6], follow: 'energy' } },
      tuck: { type: 'enum', of: ['under', 'beside'], label: L('小さい文字の位置', 'Whisper place'),
        auto: { pick: ['under', 'beside'], weights: [3, 2] } },
    },
    build: giantBuild,
  });

  // --- echoStack -------------------------------------------------------------------------------------------------

  function echoOffsets(n, dir) {
    const out = [];
    for (let k = 1; k <= n; k++) {
      if (dir === 'split') out.push((k % 2 ? 1 : -1) * Math.ceil(k / 2));
      else out.push(dir === 'up' ? -k : k);
    }
    return out;
  }

  // The echo stack is fitted as a whole: across the line, the block plus every step (`gap` em each, vertical columns a
  // little more); along it, the widest line plus the drift spread. It is centred with its note (under it, or left of
  // it when vertical), so no copy and no part of the main line leaves the safe area.
  // A block of several lines carries each line's trail in the space between the lines: the leading grows by the whole
  // trail, so an echo of one line never lands on the next. Overlapping copies (steps under ~a line) keep that trail
  // short, at most TRAIL em in all, so the lines stay close; copies a whole line apart (repeated lines) keep their
  // steps when the frame has the room across for them, and are shortened only where the type would shrink.
  const TRAIL = 0.9, TRAIL_CLEAR = 0.22, CLEAR_STEP = 0.9;
  function echoPlan(env, str, lines, o) {
    const { text, cut } = env;
    const pieces = lines === 1 ? [[0, str.length]] : text.columns(str, lines, cut.lang);
    if (pieces.length < lines) return null;
    const cells = pieces.map(([a, b]) => Math.max(1, text.cells(str.slice(a, b))));
    if (lines > 1 && Math.min(...cells) < 0.45 * Math.max(...cells)) return null;         // a lone word on its own line
    const widest = Math.max(...cells);
    const at = (stepK) => {
      const leading = lines > 1 ? 1 + o.span * stepK + TRAIL_CLEAR : 1.25;
      const depth = 1 + (lines - 1) * leading;                  // the block, in em across the lines
      const em = Math.min(o.cap, (o.alongRoom * 0.8) / widest, (o.alongRoom * 0.94) / (widest + o.spreadK),
        (o.crossRoom * 0.94 - o.noteRoom) / (depth + o.span * stepK));
      return { lines, em, stepK, leading, depth, widest };
    };
    if (lines === 1 || o.span * o.stepK <= TRAIL) return at(o.stepK);
    const short = at(TRAIL / o.span);
    if (o.stepK < CLEAR_STEP) return short;
    const full = at(o.stepK);
    return full.em >= short.em * 0.97 ? full : short;
  }

  function echoBuild(env, p) {
    const { D, cut, sb, textStyle } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const v = env.orient === 'v';
    const alongRoom = v ? safe.h : safe.w, crossRoom = v ? safe.w : safe.h;
    const n = Math.max(1, Math.min(p.copies, Math.floor(GLYPH_BUDGET / Math.max(1, s.str.length)) - 1));
    const steps = echoOffsets(n, p.dir);
    const lo = Math.min(0, ...steps), hi = Math.max(0, ...steps);
    const noteRoom = s.note ? D.short * 0.05 * (v ? 2.3 : 2.5) : 0;
    const o = { stepK: p.gap * (v ? 1.3 : 1), span: hi - lo, spreadK: (hi - lo) * Math.abs(p.drift), alongRoom, crossRoom,
      noteRoom, cap: D.short * 0.2 * Math.max(1, textStyle.scale) };
    // One line, or more when that gives clearly larger type (the trails between the lines included): up to two, or
    // three when the frame is at least as long across the lines as along them (horizontal lines in a square or tall
    // frame, vertical ones in a square or wide frame).
    const most = s.spec.span ? (crossRoom >= alongRoom * 0.99 ? 3 : 2) : 1;
    let fit = echoPlan(env, s.str, 1, o);
    for (let lines = 2; lines <= most; lines++) {
      const more = echoPlan(env, s.str, lines, o);
      if (more && more.em > fit.em * 1.15) fit = more;
    }
    const em = fit.em * Math.min(1, textStyle.scale);
    const pitch = em * fit.stepK, drift = p.drift * em;
    // The main block's box: as wide as its widest line when it has several, so the layout breaks it into that many
    // (the fit shrinks a line that measures wider than its cells).
    const along = Math.min(alongRoom * 0.8, alongRoom * 0.94 - o.spreadK * em, fit.lines > 1 ? fit.widest * em * 1.08 : Infinity);
    const cross = Math.min(Math.max(crossRoom * 0.3, fit.depth * em * 1.06), crossRoom * 0.94 - noteRoom - o.span * pitch);
    const midA = -((lo + hi) / 2) * drift;                     // along: centres the drift spread
    const midC = -((lo + hi) / 2) * pitch;                     // across: centres the steps
    const box = v ? { x: D.cx - cross / 2 - midC + noteRoom / 2, y: D.cy - along / 2 + midA, w: cross, h: along }
      : { x: D.cx - along / 2 + midA, y: D.cy - cross / 2 + midC - noteRoom / 2, w: along, h: cross };
    const spec = Object.assign({ orient: v ? 'v' : 'h', size: em, box, align: 'center', valign: 'center', leading: fit.leading,
      maxLines: fit.lines, breakAt: 'phrase', fit: 'shrink' }, s.spec);
    const main = sb.text(Object.assign({ parent: root.node }, spec));
    const runs = [main];
    steps.forEach((k, i) => {
      const off = v ? { x: -k * pitch, y: k * drift } : { x: k * drift, y: k * pitch };
      const g = sb.group({ parent: root.node, layer: 'mid', x: off.x, y: off.y, alpha: Math.pow(p.fade, i + 1) });
      runs.push(sb.text(Object.assign({ parent: g, layer: 'mid', ink: p.tone, emphInk: p.tone }, spec)));
    });
    const note = noteRun(env, root, s.note, localBounds(sb, root.node, root), em);
    const focus = sb.bounds(main.node);
    return finish(env, root, runs.concat(note), focus);
  }

  const echoStack = K.arrange({
    key: 'echoStack',
    label: L('反響', 'Echo stack'),
    blurb: L('同じ行を3〜5回重ね、少しずつずらして薄くしていく', 'The line repeated 3–5 times, stacked with fading opacity and small offsets'),
    tags: ['wet', 'dark'], family: 'center',
    traits: { cells: [1, 22], energy: [0, 0.85] },
    params: {
      copies: { type: 'int', min: 2, max: 4, label: L('反響の数', 'Echoes'), auto: { range: [2, 4], follow: 'energy' } },
      gap: { type: 'num', min: 0.08, max: 1.3, step: 0.01, unit: 'em', label: L('間隔', 'Spacing'),
        auto: { range: [0.34, 1.12], follow: '-energy', jitter: 0.6 } },
      dir: { type: 'enum', of: ['down', 'up', 'split'], label: L('向き', 'Direction'),
        auto: { pick: ['down', 'up', 'split'], weights: [4, 1, 1] } },
      drift: { type: 'num', min: -0.8, max: 0.8, step: 0.01, unit: 'em', label: L('横ずれ', 'Drift'),
        auto: { range: [-0.25, 0.25] } },
      fade: { type: 'num', min: 0.2, max: 0.8, step: 0.01, label: L('残り方', 'Fade'), auto: { range: [0.34, 0.52] } },
      tone: { type: 'ink', label: L('反響の色', 'Echo color'), auto: { pick: ['ink', 'shiftA', 'muted'], weights: [3, 2, 1] } },
    },
    build: echoBuild,
  });

  // --- edgeBleed -------------------------------------------------------------------------------------------------

  // The planner's palette under the black or chroma backdrop (§4.16.3): a black ground under white ink, or the key
  // green. A knockout there would turn the frame white, or key the words out, so it falls back to plain words. (The
  // clear backdrop keeps the scene palette and cannot be told apart here; see NOTES, WP5a1 review fixes.)
  function flatBackdrop(pal) {
    const ground = String((pal && pal.ground) || '').toUpperCase(), ink = String((pal && pal.ink) || '').toUpperCase();
    return ground === '#00B140' || (ground === '#000000' && ink === '#FFFFFF');
  }

  // A full-frame slab in the ink, drawn with bleed so camera moves never show its edge.
  function drawSlab(g, t, d, q) {
    g.fillStyle = q.rgba(d.ink, 1);
    g.fillRect(-d.w * 0.25, -d.h * 0.25, d.w * 1.5, d.h * 1.5);
  }

  // Pieces for n lines: balanced phrases; CJK text without spaces may also break between characters (a poster
  // break), Latin words never.
  function bleedPieces(env, str, n) {
    const { text, cut } = env;
    if (n === 1) return [[0, str.length]];
    const pieces = text.columns(str, n, cut.lang);
    const cells = pieces.map(([a, b]) => text.cells(str.slice(a, b)));
    const even = pieces.length >= n && Math.min(...cells) >= 0.5 * Math.max(...cells);
    if (even || /\s/.test(str.trim()) || !/^(ja|zhHans|zhHant)$/.test(cut.lang)) return pieces;
    const total = text.cells(str);
    return total >= n ? text.breakLines(str, Math.ceil(total / n), cut.lang, 'char') : pieces;
  }

  // The bleed runs every line `overflow` times the frame's width (height when vertical). It takes the most lines whose
  // stack still fits across the frame (allowing half the overflow there), so tall frames fill with big type.
  function bleedPlan(env, str, overflow, v) {
    const { D, text } = env;
    const width = v ? D.h : D.w, depth = (v ? D.w : D.h) * (1 + (overflow - 1) * 0.5);
    const lead = v ? 0.98 : 0.9;
    let pick = null;
    for (let n = 1; n <= 3; n++) {
      const pieces = bleedPieces(env, str, n);
      if (n > 1 && (pieces.length < 2 || (pick && pieces.length <= pick.pieces.length))) continue;
      const widest = Math.max(1, ...pieces.map(([a, b]) => text.cells(str.slice(a, b))));
      const stack = (pieces.length - 1) * lead + 1;
      const em = Math.min(width * overflow / widest, D.short * 1.3);
      if (em * stack <= depth) pick = { pieces, em };
      else if (!pick) pick = { pieces, em: Math.min(em, depth / stack) };
    }
    return pick;
  }

  function bleedBuild(env, p) {
    const { D, cut, sb, textStyle } = env;
    const s = subjectOf(cut);
    const root = rootOf(env, p);
    const v = env.orient === 'v';
    const plan = s.spec.span ? bleedPlan(env, s.str, p.overflow, v) : { pieces: [null], em: D.short * 0.9 };
    const em = plan.em * textStyle.scale;
    const pitch = em * (v ? 0.98 : 0.9);
    const n = plan.pieces.length;
    const big = (v ? D.h : D.w) * 4;
    const runs = plan.pieces.map((span, i) => {
      const across = (i - (n - 1) / 2) * pitch;
      const spec = span ? { span } : { text: s.str };
      let box;
      if (v) {
        const x = D.cx - across - em * 0.6;
        const y = p.anchor === 'start' ? D.safe.t * 0.5 : p.anchor === 'end' ? D.h - D.safe.b * 0.5 - big : D.cy - big / 2;
        box = { x, y, w: em * 1.2, h: big };
      } else {
        const y = D.cy + across - em * 0.6;
        const x = p.anchor === 'start' ? D.safe.l * 0.5 : p.anchor === 'end' ? D.w - D.safe.r * 0.5 - big : D.cx - big / 2;
        box = { x, y, w: big, h: em * 1.2 };
      }
      return sb.text(Object.assign({ parent: root.node, orient: v ? 'v' : 'h', size: em, box, align: p.anchor,
        valign: 'center', maxLines: 1, breakAt: 'none', fit: 'none' }, spec));
    });
    const knockout = p.knockout && !flatBackdrop(env.pal);
    if (knockout) {
      const slab = sb.paint({ layer: 'far', bleed: 0.25, animated: true, data: { ink: 'ink', w: D.w, h: D.h }, draw: drawSlab });
      sb.layer('far', { mask: { layer: 'text', invert: true } });
      sb.layer('text', { opacity: 0, isolate: true });
      fadeWithText(env, [slab]);
    }
    const frame = { x: 0, y: 0, w: D.w, h: D.h };
    const focus = intersect(sb.bounds(root.node), frame);
    if (s.note) {
      // The note stays out of the bleed: small in the lower safe corner, above the knockout slab when there is one.
      // Without the slab the huge words run under it, so it sits on a small plate of the ground colour to stay legible.
      const safe = safeBox(D), ne = D.short * 0.036;
      const note = sb.text({ parent: root.node, text: s.note, orient: 'h', face: NOTE_FACE, size: ne, style: 'plain', layer: 'near',
        ink: knockout ? 'ground' : textStyle.ink, box: { x: safe.x, y: safe.y + safe.h - ne * 1.5, w: safe.w, h: ne * 1.5 },
        align: p.anchor === 'end' ? 'start' : 'end', valign: 'end', maxLines: 1, breakAt: 'none', fit: 'shrink' });
      if (!knockout) {
        const nb = sb.bounds(note.node), pad = ne * 0.45;
        fadeWithText(env, [sb.paint({ layer: 'near', bleed: 0, animated: true, draw: drawPlate,
          data: { x: nb.x - pad, y: nb.y - pad * 0.7, w: nb.w + pad * 2, h: nb.h + pad * 1.4, r: pad * 0.6 } })]);
      }
      runs.push(note);
    }
    return finish(env, root, runs, focus);
  }

  // A small rounded plate in the ground colour (frame du), under a note that sits on huge type.
  function drawPlate(g, t, d, q) {
    const r = Math.min(d.r, d.w / 2, d.h / 2);
    g.fillStyle = q.rgba('ground', 0.88);
    g.beginPath();
    g.moveTo(d.x + r, d.y);
    g.lineTo(d.x + d.w - r, d.y); g.arc(d.x + d.w - r, d.y + r, r, -Math.PI / 2, 0);
    g.lineTo(d.x + d.w, d.y + d.h - r); g.arc(d.x + d.w - r, d.y + d.h - r, r, 0, Math.PI / 2);
    g.lineTo(d.x + r, d.y + d.h); g.arc(d.x + r, d.y + d.h - r, r, Math.PI / 2, Math.PI);
    g.lineTo(d.x, d.y + r); g.arc(d.x + r, d.y + r, r, Math.PI, Math.PI * 1.5);
    g.closePath();
    g.fill();
  }

  const edgeBleed = K.arrange({
    key: 'edgeBleed',
    label: L('はみ出し', 'Edge bleed'),
    blurb: L('画面の端で切れるほど大きな文字。抜き文字にもなる', 'Text so large the frame edges crop it, optionally knocked out of a solid slab'),
    tags: ['bold', 'hard'], family: 'big',
    traits: { cells: [1, 12], energy: [0.35, 1], impact: true },
    params: {
      overflow: { type: 'num', min: 1.05, max: 1.8, step: 0.01, unit: 'x', label: L('はみ出し量', 'Overflow'),
        auto: { range: [1.15, 1.45], follow: 'energy' } },
      anchor: { type: 'enum', of: ['center', 'start', 'end'], label: L('寄せ', 'Anchor'),
        auto: { pick: ['center', 'start', 'end'], weights: [3, 2, 1] } },
      // Only by pin: black and chroma backdrops fall back to plain words; clear needs a renderer rule (NOTES).
      knockout: { type: 'bool', label: L('抜き文字', 'Knockout'), auto: { value: false } },
    },
    build: bleedBuild,
  });

  // --- cornerNote ------------------------------------------------------------------------------------------------

  function cornerBuild(env, p) {
    const { D, cut, sb, text, textStyle } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const v = env.orient === 'v';
    const em = D.short * p.size * textStyle.scale;
    const right = p.corner === 'bottomRight' || p.corner === 'topRight';
    const bottom = p.corner === 'bottomLeft' || p.corner === 'bottomRight';
    // The note follows the caption in reading order (under it; left of it when vertical), so its room is kept free on
    // the corner side when the caption hugs that edge (bottom corners; left corners when vertical).
    const ne = clamp(em * 0.62, D.short * 0.026, em);
    const noteRoom = s.note ? (v ? ne * 2 : ne * 1.9) : 0;
    // One line (column) when the caption is short, up to three when it is not; never more than half the frame.
    // Vertical columns always start at the top of the block (a ragged foot, as vertical text is set), so a caption that
    // fits one column gets a box just as tall as the column, and the block still sits in its corner.
    const cells = text.cells(s.str);
    const reach = cells * em * 1.3;
    const W = v ? Math.min(safe.w * 0.45 - noteRoom, em * 5.2) : clamp(reach, em * 4, safe.w * (D.h > D.w ? 0.8 : 0.6));
    const H = v ? clamp(cells * em * 1.12, em * 1.5, safe.h * 0.6) : Math.min(safe.h * 0.42 - noteRoom, em * 4.4);
    const x = right ? safe.x + safe.w - W : safe.x + (v ? noteRoom : 0);
    const box = { x, y: bottom ? safe.y + safe.h - H - (v ? 0 : noteRoom) : safe.y, w: W, h: H };
    const main = sb.text(Object.assign({ parent: root.node, orient: v ? 'v' : 'h', size: em, box, leading: v ? 1.55 : 1.4,
      align: v ? 'start' : (right ? 'end' : 'start'),
      valign: v ? (right ? 'start' : 'end') : (bottom ? 'end' : 'start'),
      maxLines: 3, breakAt: 'phrase', fit: 'shrink' }, s.spec));
    const b = localBounds(sb, main.node, root);
    const runs = [main];
    if (s.note) {
      // A vertical note starts with the caption's first column; one longer than a short caption in a bottom corner
      // starts higher, so its column still ends inside the safe area.
      const nh = Math.max(b.h, ne * 4);
      const nb = v ? { x: b.x - ne * 2, y: bottom ? Math.min(b.y, safe.y + safe.h - nh) : b.y, w: ne * 1.5, h: nh }
        : { x: right ? b.x + b.w - (b.w + W) : b.x, y: b.y + b.h + ne * 0.4, w: b.w + W, h: ne * 1.5 };
      runs.push(sb.text({ parent: root.node, text: s.note, orient: v ? 'v' : 'h', face: NOTE_FACE, size: ne, style: 'plain',
        box: nb, align: v ? 'start' : (right ? 'end' : 'start'), valign: 'start', maxLines: 1, breakAt: 'none', fit: 'shrink' }));
    }
    const all = localBounds(sb, root.node, root);
    const mark = p.mark === 'none' ? null : markShape(env, root, p.mark, v ? b : all, em, { v, right, bottom });
    if (mark !== null) fadeWithText(env, [mark]);
    return finish(env, root, runs, sb.bounds(main.node));
  }

  // A small accent rule or dot on the open side of the caption: above it in the bottom corners, below it in the top
  // corners. Horizontal captions: at the aligned end of the block; vertical ones: in line with the first (rightmost)
  // column, so the mark leads into the column (or closes it) and stays inside the safe area.
  function markShape(env, root, kind, b, em, o) {
    const { sb } = env;
    const len = em * 1.5, gap = em * 0.55, w = Math.max(2, em * 0.07);
    let x, y, horizontal;
    if (o.v) {
      x = b.x + b.w - em * 0.5; y = o.bottom ? b.y - gap - len : b.y + b.h + gap; horizontal = false;
    } else {
      x = o.right ? b.x + b.w - len : b.x; y = o.bottom ? b.y - gap : b.y + b.h + gap; horizontal = true;
    }
    if (kind === 'dot') {
      const r = em * 0.13;
      const cx = horizontal ? (o.right ? b.x + b.w - r : b.x + r) : x;
      const cy = horizontal ? y : (o.bottom ? b.y - gap - r : b.y + b.h + gap + r);
      return sb.shape({ parent: root.node, layer: 'text', path: K.shape.ellipse(cx, cy, r, r), fill: 'accent' });
    }
    const path = horizontal ? K.shape.line(x, y, x + len, y) : K.shape.line(x, y, x, y + len);
    return sb.shape({ parent: root.node, layer: 'text', path, stroke: 'accent', width: w, cap: 'round' });
  }

  const cornerNote = K.arrange({
    key: 'cornerNote',
    label: L('隅書き', 'Corner note'),
    blurb: L('安全枠の隅に小さく書き、画面の大半を空けておく', 'A small caption in one corner of the safe area, most of the frame left empty'),
    tags: ['minimal', 'airy'], family: 'edge',
    traits: { cells: [1, 30], energy: [0, 0.75] },
    params: {
      corner: { type: 'enum', of: ['bottomLeft', 'bottomRight', 'topRight', 'topLeft'], label: L('隅', 'Corner'),
        auto: { pick: ['bottomLeft', 'bottomRight', 'topRight', 'topLeft'], weights: [4, 3, 2, 1] } },
      size: { type: 'num', min: 0.03, max: 0.12, step: 0.001, unit: 'frac', label: L('文字の大きさ', 'Type size'),
        auto: { range: [0.05, 0.074], follow: '-cells' } },
      mark: { type: 'enum', of: ['rule', 'dot', 'none'], label: L('印', 'Mark'),
        auto: { pick: ['rule', 'dot', 'none'], weights: [3, 2, 2] } },
    },
    build: cornerBuild,
  });

  return [centerAnchor, giantWhisper, echoStack, edgeBleed, cornerNote];
});
