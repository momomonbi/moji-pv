/* 文字PVメーカー v2 — original work. Compositions that place words or glyphs one by one: confetti words, hanging tags, halo ring, grid mosaic. */
MV.def('parts/arrange/scatter', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, smooth, DEG, TAU } = K.math;
  const L = (ja, en) => ({ ja, en });
  const NOTE_FACE = 'body';
  const CJK = /^(ja|zhHans|zhHant|ko)$/;
  const MAX_UNITS = 64;           // runs one composition places unit by unit; longer texts are grouped, never cut
  // Code points that belong to the grapheme before them: marks and variation selectors (incl. U+20E3), ZWJ, emoji
  // skin tones, tag characters; also a code point after a ZWJ, the second regional indicator of a flag, and Hangul
  // vowel/final jamo after Hangul.
  const EXTEND = /^[\p{M}\u200D\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]$/u;
  const REGIONAL = /^[\u{1F1E6}-\u{1F1FF}]$/u;
  const JAMO_VT = /^[\u1160-\u11FF\uD7B0-\uD7FF]$/;
  const HANGUL = /^[\u1100-\u11FF\uAC00-\uD7A3]$/;

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

  function rootOf(env, p) {
    const shift = { x: (p.offsetX || 0) * env.D.w, y: (p.offsetY || 0) * env.D.h };
    return { shift, node: env.sb.group({ x: shift.x, y: shift.y }) };
  }

  function finish(env, root, runs, focus) {
    const f = focus || env.sb.bounds(root.node);
    return { runs: runs.filter(Boolean), focus: f, free: env.sb.freeAround(f) };
  }

  // The text block for the focus: the union of the runs' bounds, within the frame (decorations such as threads that run
  // off the frame are not part of it).
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

  // Word units: words (phrases for ja/zh); a single CJK phrase without spaces splits into up to `split` chunks.
  function wordsOf(env, s, split) {
    const { text, cut } = env;
    const units = text.words(s.str, cut.lang);
    if (units.length >= 2 || !CJK.test(cut.lang) || /\s/.test(s.str.trim())) return units.length ? units : [[0, s.str.length]];
    const cells = text.cells(s.str);
    if (cells < 4) return [[0, s.str.length]];
    return text.breakLines(s.str, Math.ceil(cells / Math.min(split, Math.floor(cells / 2))), cut.lang, 'char');
  }

  // Glyph units: one grapheme each (a line-break pair such as 「ずっ」 or 「❤️。」 is split again, by graphemes), spaces
  // kept as empty slots (null). Every grapheme of the text is a unit: nothing is dropped.
  function glyphsOf(env, s) {
    const { text, cut } = env;
    const out = [];
    let at = 0;
    for (const [a, b] of text.breakLines(s.str, 0.5, cut.lang, 'char')) {
      if (a > at && /\s/.test(s.str.slice(at, a))) out.push(null);
      if (text.cells(s.str.slice(a, b)) > 1.2) for (const g of graphemes(s.str, a, b)) out.push(g);
      else out.push([a, b]);
      at = b;
    }
    return pairDigits(s.str, out);
  }

  // Grapheme ranges of str[a, b) (the engine has no segmenter; see EXTEND for what joins).
  function graphemes(str, a, b) {
    const out = [];
    let prev = '', flags = 0;
    for (let i = a; i < b;) {
      const ch = String.fromCodePoint(str.codePointAt(i));
      const regional = REGIONAL.test(ch);
      const joins = out.length > 0 && (EXTEND.test(ch) || prev === '\u200D' || (regional && flags % 2 === 1) ||
        (JAMO_VT.test(ch) && HANGUL.test(prev)));
      if (joins) out[out.length - 1][1] = i + ch.length; else out.push([i, i + ch.length]);
      flags = regional ? flags + 1 : 0;
      prev = ch;
      i += ch.length;
    }
    return out;
  }

  // The non-empty units among units[k0, k1): { first, last, span } — their first and last slot and the text range from
  // one to the other (span null when there are only spaces).
  function extentOf(units, k0, k1) {
    let first = -1, last = -1;
    for (let k = k0; k < k1; k++) if (units[k]) { if (first < 0) first = k; last = k; }
    return { first, last, span: first < 0 ? null : [units[first][0], units[last][1]] };
  }

  // Consecutive slots grouped so that at most `most` groups remain (one slot per group when there are few enough).
  function groupSlots(units, most) {
    const size = Math.max(1, Math.ceil(units.length / most));
    const out = [];
    for (let k0 = 0; k0 < units.length; k0 += size) out.push(extentOf(units, k0, Math.min(units.length, k0 + size)));
    return out;
  }

  // One or two ASCII digits standing alone share a unit (a cell), as tate-chu-yoko numbers do.
  function pairDigits(str, units) {
    const digit = (r) => !!r && r[1] - r[0] === 1 && /[0-9]/.test(str[r[0]]);
    const out = [];
    for (let i = 0; i < units.length; i++) {
      const r = units[i];
      if (digit(r) && digit(units[i + 1]) && units[i + 1][0] === r[1] && !digit(units[i - 1]) && !digit(units[i + 2])) {
        out.push([r[0], units[i + 1][1]]);
        i++;
      } else out.push(r);
    }
    return out;
  }

  function isEmph(cut, r) { return (cut.emph || []).some(([a, b]) => r[0] < b && r[1] > a); }

  // Axis-aligned bounds of a w × h box turned by `rot` about its centre.
  function turnedBox(cx, cy, w, h, rot) {
    const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
    const W = w * c + h * s, H = w * s + h * c;
    return { x: cx - W / 2, y: cy - H / 2, w: W, h: H };
  }

  // --- confettiWords ---------------------------------------------------------------------------------------------

  // Words flowed into loose lines (reading order kept), then each turned and nudged by the part's own stream inside
  // its own cell of the flow: the word's slot plus half the gap to each neighbour. Cells never overlap, so neither do
  // the words, and long words turn less because their cell leaves less room.
  const WORD_GAP = 0.7, LINE_GAP = 0.9;       // em between words, and between lines

  function confettiBuild(env, p) {
    const { D, cut, sb, text, textStyle, rng } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const v = env.orient === 'v';
    // A very long line flows as groups of neighbouring words (at most MAX_UNITS pieces), never cut short.
    const units = groupSlots(wordsOf(env, s, 4), MAX_UNITS).map((g) => g.span);
    const items = units.map((r) => ({ r, cells: Math.max(1, text.cells(s.str.slice(r[0], r[1]))),
      f: (1 + p.mix * (rng.next() * 2 - 1)) * (isEmph(cut, r) ? 1.3 : 1), jx: rng.next() * 2 - 1, jy: rng.next() * 2 - 1,
      turn: (rng.next() < 0.5 ? -1 : 1) * (0.35 + 0.65 * rng.next()), slide: rng.next() }));
    const along = (v ? safe.h : safe.w) * 0.94, cross = (v ? safe.w : safe.h) * 0.9;
    // The largest size whose flow fits. Greedy flows are not monotone in size (a word moving to the next line can make
    // a larger size fit again), so sizes are scanned from the largest down in 2% steps instead of bisected.
    let size = D.short * 0.22 * Math.max(1, textStyle.scale);
    for (let k = 0; k < 400; k++) {
      const f = flowLines(items, size, along);
      if (f.depth <= cross && f.widest <= along) break;
      size *= 0.98;
    }
    const em = size * Math.min(1, textStyle.scale);
    const laid = flowLines(items, em, along);
    const across0 = (v ? safe.w : safe.h) * 0.05 + (cross - laid.depth) / 2;
    // Each line with its outer half gaps (the first and last words' cells) slides inside the room along the reading axis.
    const along0 = (v ? safe.y : safe.x) + ((v ? safe.h : safe.w) - along) / 2;
    const runs = [];
    for (const line of laid.lines) {
      let pen = along0 + (along - line.length - WORD_GAP * em) * line.slide + WORD_GAP * em / 2;
      for (const it of line.items) {
        const size = em * it.f, len = it.cells * size * 1.08, thick = size * 1.28;
        // the cell, in (along, across) coordinates, and the word's turned box inside it
        const cellLen = len + WORD_GAP * em, cellThick = line.thick + LINE_GAP * em;
        const w = v ? thick : len, h = v ? len : thick;
        const cw = v ? cellThick : cellLen, ch = v ? cellLen : cellThick;
        let rot = it.turn * p.tilt * DEG;
        for (let k = 0; k < 8 && !fits(w, h, rot, cw, ch); k++) rot *= 0.6;
        if (!fits(w, h, rot, cw, ch)) rot = 0;
        const tb = turnedBox(0, 0, w, h, rot);
        const a = pen + len / 2, c = across0 + line.offset + line.thick / 2;
        const cx = (v ? safe.x + safe.w - c : a) + it.jx * p.spread * Math.max(0, cw - tb.w) / 2;
        const cy = (v ? a : safe.y + c) + it.jy * p.spread * Math.max(0, ch - tb.h) / 2;
        runs.push(sb.text(Object.assign({ parent: root.node, orient: v ? 'v' : 'h', size, rot,
          box: { x: cx - w / 2, y: cy - h / 2, w, h }, align: 'center', valign: 'center', maxLines: 1,
          breakAt: 'none', fit: 'shrink' }, part(s, it.r))));
        pen += len + WORD_GAP * em;
      }
    }
    if (s.note) runs.push(noteUnder(env, root, s.note, em, v));
    return finish(env, root, runs);
  }

  function fits(w, h, rot, cw, ch) {
    const b = turnedBox(0, 0, w, h, rot);
    return b.w <= cw && b.h <= ch;
  }

  // Greedy flow of items into lines of at most `along` du at size em:
  // { lines: [{ items, length, thick, offset, slide }], depth, widest } (depth counts half a line gap at each end).
  function flowLines(items, em, along) {
    const lines = [];
    let cur = null;
    for (const it of items) {
      const len = it.cells * em * it.f * 1.08, thick = em * it.f * 1.28;
      const gap = em * WORD_GAP;
      if (!cur || (cur.items.length && cur.length + gap + len > along)) {
        cur = { items: [], length: 0, thick: 0, offset: 0, slide: it.slide };
        lines.push(cur);
      }
      cur.length += (cur.items.length ? gap : 0) + len;
      cur.thick = Math.max(cur.thick, thick);
      cur.items.push(it);
    }
    let depth = em * LINE_GAP / 2, widest = 0;
    for (const line of lines) {
      line.offset = depth;
      depth += line.thick + em * LINE_GAP;
      widest = Math.max(widest, line.length + em * WORD_GAP);
    }
    return { lines, depth: depth - em * LINE_GAP / 2, widest };
  }

  function noteUnder(env, root, note, em, v) {
    const { D, sb } = env;
    const safe = safeBox(D);
    const ne = clamp(em * 0.4, D.short * 0.03, D.short * 0.05);
    const box = v ? { x: safe.x, y: safe.y, w: ne * 1.5, h: safe.h * 0.5 }
      : { x: safe.x, y: safe.y + safe.h - ne * 1.5, w: safe.w, h: ne * 1.5 };
    return sb.text({ parent: root.node, text: note, orient: v ? 'v' : 'h', face: NOTE_FACE, size: ne, style: 'plain', box,
      align: v ? 'start' : 'end', valign: v ? 'end' : 'start', maxLines: 1, breakAt: 'none', fit: 'shrink' });
  }

  const confettiWords = K.arrange({
    key: 'confettiWords',
    label: L('散らし', 'Confetti words'),
    blurb: L('語を少しずつ回して散らし、重ならないように置く', 'Words scattered at seeded positions and small turns, never overlapping'),
    tags: ['playful', 'busy'], family: 'scatter', cam: 'gentle',
    traits: { cells: [3, 30], energy: [0.3, 1] },
    fits: (f) => (f.words >= 3 ? 1.2 : f.words === 2 ? 0.8 : 0.3),
    params: {
      spread: { type: 'num', min: 0, max: 1, step: 0.01, label: L('ばらつき', 'Spread'),
        auto: { range: [0.45, 0.95], follow: 'energy' } },
      tilt: { type: 'num', min: 0, max: 30, step: 0.5, unit: 'deg', label: L('回転の幅', 'Max turn'),
        auto: { range: [6, 16], follow: 'energy' } },
      mix: { type: 'num', min: 0, max: 0.6, step: 0.01, label: L('大きさの差', 'Size mix'), auto: { range: [0.15, 0.4] } },
    },
    build: confettiBuild,
  });

  // --- hangingTags -----------------------------------------------------------------------------------------------

  // Every tag: a card (optional) with a punched hole; one paint draws them all.
  function drawTags(g, t, d, q) {
    for (let i = 0; i < d.n; i++) {
      const x = d.x[i], y = d.y[i], w = d.w[i], h = d.h[i], r = d.r;
      g.beginPath();
      g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
      g.lineTo(x + w, y + h - r); g.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
      g.lineTo(x + r, y + h); g.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
      g.lineTo(x, y + r); g.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
      g.closePath();
      g.fillStyle = q.rgba('ground2', 1); g.fill();
      g.fillStyle = q.rgba('ink', 0.04); g.fill();
      g.strokeStyle = q.rgba('muted', 0.7); g.lineWidth = d.line; g.stroke();
      g.beginPath(); g.arc(d.thread[i], y + d.hole * 1.8, d.hole, 0, TAU);
      g.fillStyle = q.rgba('ground', 1); g.fill();
      g.strokeStyle = q.rgba('muted', 0.8); g.stroke();
    }
  }

  // Where each tag hangs ({ x, y, w, h, thread } per tag, in reading order). Tags hang in one row; horizontal tags
  // that would come out small hang in two tiers instead, read row by row: the first half of the tags high, the rest
  // lower in the gaps between them, so every thread passes between the upper tags and never through a word. (Even
  // tags high and odd tags low read 「昨日の」「を」 / 「ため息」 at a glance.) Vertical tags (tanzaku) read right to left.
  // A tag is { cells, lines, wide }: its text set on `lines` lines, the widest `wide` cells long.
  const TAG_LEAD = 1.25;          // em between the two lines of a two-line tag

  function hangLayout(env, tags, padK, p, v) {
    const fit = hangEm(env, tags, padK, v);
    const em = fit.em * Math.min(1, env.textStyle.scale);
    const boxes = tags.map((t) => ({ w: fit.across(t) * em, h: fit.down(t) * em }));
    return { em, boxes: tagBoxes(env, safeBox(env.D), boxes, em, fit.tiers, p, v) };
  }

  // The tags' em (before text.scale): one row, or two tiers when that makes the type clearly larger
  // → { em, tiers, across(tag), down(tag) } (a tag's size in em across and down the frame).
  function hangEm(env, tags, padK, v) {
    const { D, textStyle } = env;
    const safe = safeBox(D), scale = textStyle.scale;
    const across = (t) => (v ? 1.3 + 2 * padK : t.wide * 1.06 + 2 * padK);
    const down = (t) => (v ? t.cells + 2 * padK : 1.3 + (t.lines - 1) * TAG_LEAD + 2 * padK);
    const n = tags.length;
    const cap = D.short * (v ? 0.12 : 0.13) * Math.max(1, scale);
    const rowEm = Math.min(safe.w * 0.92 / (tags.reduce((a, t) => a + across(t), 0) + (n + 1) * 0.6),
      safe.h * 0.62 / Math.max(...tags.map(down)), cap);
    if (v || n < 3) return { em: rowEm, tiers: false, across, down };
    const upper = tags.slice(0, upperCount(n)), lower = tags.slice(upperCount(n));
    let tierEm = Math.min(safe.w * 0.92 / (upper.reduce((a, t) => a + across(t), 0) + (upper.length + 1) * 1.4),
      safe.w * 0.9 / Math.max(...lower.map(across)),
      safe.h * 0.8 / (Math.max(...upper.map(down)) + Math.max(...lower.map(down)) + 1.2), cap);
    const rows = (em) => tierRows(safe, upper.map((t) => across(t) * em), lower.map((t) => across(t) * em), em);
    for (let k = 0; k < 60 && !rows(tierEm); k++) tierEm *= 0.97;
    const tiers = tierEm > rowEm * 1.2;
    return { em: tiers ? tierEm : rowEm, tiers, across, down };
  }

  // How many of n tags hang in the upper tier (the first ones; a lower tag hangs in the gap after its upper one).
  function upperCount(n) { return Math.ceil(n / 2); }

  // Two tiers across the safe width at size em: the upper row evenly spaced, and the lower tags each hung on a thread
  // that passes through its gap in the upper row (clear of the upper tags) and inside its own tag (0.4 em from its
  // ends), the lower tags 0.3 em apart. Lower tags start centred under their gaps and are pushed right, then pulled
  // back left, only as far as those rules need. → { up: [x], low: [{ x, thread }] }, or null when they cannot fit.
  function tierRows(safe, upW, lowW, em) {
    const R = safe.x + safe.w, m = em * 0.15, inset = em * 0.4, apart = em * 0.3;
    const gap = (safe.w - upW.reduce((a, w) => a + w, 0)) / (upW.length + 1);
    let x = safe.x + gap;
    const up = upW.map((w) => { const at = x; x += w + gap; return at; });
    const low = [];
    let right = -Infinity;
    for (let j = 0; j < lowW.length; j++) {
      const gl = up[j] + upW[j], gr = j + 1 < up.length ? up[j + 1] : R, w = lowW[j];
      const lo = Math.max(safe.x, gl + m + inset - w), hi = Math.min(R - w, gr - m - inset);
      low.push({ x: Math.max(lo, right + apart, (gl + gr - w) / 2), lo, hi, gl, gr, thread: 0 });
      right = low[j].x + w;
    }
    let left = Infinity;
    for (let j = lowW.length - 1; j >= 0; j--) {
      const o = low[j];
      o.x = Math.min(o.x, o.hi, left - apart - lowW[j]);
      if (o.x < o.lo - 1e-6 || o.gr - o.gl < 2 * m) return null;
      o.thread = clamp((o.gl + o.gr) / 2, Math.max(o.gl + m, o.x + inset), Math.min(o.gr - m, o.x + lowW[j] - inset));
      left = o.x;
    }
    return { up, low };
  }

  // Places boxes ({ w, h } in du) in a row or in two tiers; fills in x, y and the thread's x.
  function tagBoxes(env, safe, boxes, em, tiers, p, v) {
    const { rng } = env;
    const n = boxes.length;
    const drop = (lo, hi) => lo + Math.max(0, hi - lo) * p.drop * rng.next();
    const up = boxes.slice(0, upperCount(n)), low = boxes.slice(upperCount(n));
    const rows = tiers ? tierRows(safe, up.map((z) => z.w), low.map((z) => z.w), em) : null;
    if (!rows) {
      const gap = (safe.w - boxes.reduce((a, z) => a + z.w, 0)) / (n + 1);
      let x = safe.x + gap;
      for (let k = 0; k < n; k++) {
        const z = boxes[v ? n - 1 - k : k];
        z.x = x; z.thread = x + z.w / 2; x += z.w + gap;
        const room = safe.h - z.h;
        z.y = safe.y + room * (0.06 + (k % 2 ? 0.3 * p.drop : 0)) + drop(0, room * 0.55);
      }
      return boxes;
    }
    up.forEach((z, j) => {
      z.x = rows.up[j]; z.thread = z.x + z.w / 2;
      z.y = safe.y + safe.h * 0.04 + drop(0, safe.h * 0.16);
    });
    // A lower tag hangs below the upper tags either side of its thread and below every one it passes under.
    low.forEach((z, j) => {
      z.x = rows.low[j].x; z.thread = rows.low[j].thread;
      let floor = -Infinity;
      up.forEach((u, k) => {
        if (k === j || k === j + 1 || (u.x < z.x + z.w && z.x < u.x + u.w)) floor = Math.max(floor, u.y + u.h + em * 0.6);
      });
      z.y = Math.min(floor + drop(0, Math.min(safe.y + safe.h - z.h - floor, safe.h * 0.3)), safe.y + safe.h - z.h);
    });
    return boxes;
  }

  // The tags for the units: one line each; in a narrow frame, horizontal phrases without spaces that split evenly
  // go on two lines when that makes the type clearly larger (a tag of 「ねえ、／ちょっと」 rather than a tiny long one).
  // They split at a phrase boundary, or (CJK phrases of six cells or more, as Japanese is set) between two characters
  // the line rules allow.
  function tagsOf(env, s, units, padK, v) {
    const { text, cut } = env;
    const one = units.map((r) => {
      const c = Math.max(1, text.cells(s.str.slice(r[0], r[1])));
      return { cells: c, lines: 1, wide: c, breakAt: 'none' };
    });
    if (v || env.D.w >= env.D.h * 1.2) return one;
    let split = false;
    const two = units.map((r, i) => {
      const str = s.str.slice(r[0], r[1]);
      if (one[i].cells < 4 || /\s/.test(str.trim())) return one[i];
      let breakAt = 'phrase', pieces = text.columns(str, 2, cut.lang);
      if (pieces.length < 2 && CJK.test(cut.lang) && one[i].cells >= 6) {
        breakAt = 'char';
        pieces = text.breakLines(str, Math.ceil(one[i].cells / 2), cut.lang, 'char');
      }
      if (pieces.length !== 2) return one[i];
      const cells = pieces.map(([a, b]) => Math.max(1, text.cells(str.slice(a, b))));
      if (Math.min(...cells) < 0.45 * Math.max(...cells)) return one[i];
      split = true;
      return { cells: one[i].cells, lines: 2, wide: Math.max(...cells), breakAt };
    });
    return split && hangEm(env, two, padK, v).em > hangEm(env, one, padK, v).em * 1.2 ? two : one;
  }

  function hangBuild(env, p) {
    const { D, cut, sb, text } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const v = env.orient === 'v';
    const most = v ? (D.w > D.h ? 7 : 5) : (D.w > D.h ? 6 : 4);
    let units = wordsOf(env, s, 3);
    if (units.length > most) units = text.columns(s.str, most, cut.lang);
    const padK = p.card ? 0.42 : 0.12;
    const tags = tagsOf(env, s, units, padK, v);
    const { em, boxes } = hangLayout(env, tags, padK, p, v);
    const pad = em * padK;
    const hole = p.card ? pad * 0.28 : 0, line = clamp(em * 0.02, 1.2, 3);
    const threads = boxes.map((z) => sb.shape({ parent: root.node, layer: 'mid', stroke: 'muted', width: line,
      path: K.shape.line(z.thread, -D.h * 0.2, z.thread, z.y + (p.card ? hole * 1.8 : 0)) }));
    const runs = units.map((r, i) => {
      const z = boxes[i], lines = tags[i].lines;
      const box = { x: z.x + pad * 0.6, y: z.y + pad, w: z.w - pad * 1.2, h: z.h - pad * 2 };
      if (p.card) { box.y += hole * (v ? 1.5 : 1); box.h -= hole * (v ? 1.5 : 1); }
      return sb.text(Object.assign({ parent: root.node, orient: v ? 'v' : 'h', size: em, box, align: 'center',
        valign: 'center', leading: TAG_LEAD, maxLines: lines, breakAt: tags[i].breakAt, fit: 'shrink' },
      part(s, r)));
    });
    const deco = threads.slice();
    if (p.card) {
      const sh = root.shift;
      deco.push(sb.paint({ layer: 'mid', bleed: 0.05, animated: true, draw: drawTags, data: { n: boxes.length,
        x: boxes.map((z) => z.x + sh.x), y: boxes.map((z) => z.y + sh.y), w: boxes.map((z) => z.w), h: boxes.map((z) => z.h),
        r: pad * 0.6, hole, line, thread: boxes.map((z) => z.thread + sh.x) } }));
    }
    fadeWithText(env, deco);
    const focus = textBounds(env, runs);         // the words, not the threads above the frame nor the corner note
    if (s.note) {
      const ne = clamp(em * 0.4, D.short * 0.03, D.short * 0.05);
      runs.push(sb.text({ parent: root.node, text: s.note, orient: 'h', face: NOTE_FACE, size: ne, style: 'plain',
        box: { x: safe.x, y: safe.y + safe.h - ne * 1.5, w: safe.w, h: ne * 1.5 }, align: 'end', valign: 'start', maxLines: 1,
        breakAt: 'none', fit: 'shrink' }));
    }
    return finish(env, root, runs, focus);
  }

  const hangingTags = K.arrange({
    key: 'hangingTags',
    label: L('吊り札', 'Hanging tags'),
    blurb: L('語が細い糸で上から吊られ、高さを少しずつ違えて並ぶ', 'Words hang from the top edge on thin threads at staggered heights'),
    tags: ['playful', 'organic'], family: 'scatter', cam: 'gentle',
    traits: { cells: [2, 24] },
    fits: (f) => (f.words >= 2 ? 1 : 0.5),
    params: {
      card: { type: 'bool', label: L('札', 'Tag cards'), auto: { pick: [true, false], weights: [3, 2] } },
      drop: { type: 'num', min: 0, max: 1, step: 0.01, label: L('高さの差', 'Height spread'), auto: { range: [0.3, 0.8] } },
    },
    build: hangBuild,
  });

  // --- haloRing --------------------------------------------------------------------------------------------------

  // The largest radius ≤ r0 whose glyphs (em = min(perR·r, cap)) stay within `half` of the centre: a glyph cell turned
  // on the ring reaches up to half its diagonal (0.71 em) past the circle.
  const REACH = 0.72;
  function ringRadius(r0, perR, cap, half) {
    if (r0 + REACH * Math.min(perR * r0, cap) <= half) return r0;
    const r = half / (1 + REACH * perR);
    return perR * r <= cap ? r : Math.max(half * 0.5, half - REACH * cap);
  }

  // Where each slot sits along the ring, in cells, and the ring's angle at a place along it. Glyphs turned along the
  // ring take their own width (a full-width glyph 1, a Latin letter about half, a space less), so Latin words keep
  // their letters together instead of spreading them one per full slot. An upright glyph needs its width where the ring
  // runs across and its full height where the ring runs up or down its sides: its slot follows the angle (settled over
  // a few rounds, as the angles follow the slots). → { mid: centre of each slot (cells), span: cells from the first
  // slot's centre to the last one's, total, perCell: radians per cell, angleOf(cells) }.
  function ringSlots(env, s, units, sweep, full, tangent) {
    const n = units.length;
    const own = new Float64Array(n), need = new Float64Array(n), mid = new Float64Array(n);
    units.forEach((r, k) => { own[k] = r ? Math.max(0.45, env.text.cells(s.str.slice(r[0], r[1]))) : env.text.cells(' '); });
    need.set(own);
    const ring = { mid, span: 0, total: 1, perCell: 0, angleOf: null };
    ring.angleOf = (c) => -Math.PI / 2 + (c - mid[0] - (full ? 0 : ring.span / 2)) * ring.perCell;
    for (let round = 0; round < (tangent ? 1 : 4); round++) {
      let pen = 0;
      for (let k = 0; k < n; k++) { mid[k] = pen + need[k] / 2; pen += need[k]; }
      ring.span = n > 1 ? mid[n - 1] - mid[0] : 0;
      ring.total = Math.max(pen, 1e-6);
      ring.perCell = full ? sweep / ring.total : sweep / Math.max(1, ring.span);
      if (tangent) break;
      for (let k = 0; k < n; k++) {
        const up = Math.abs(Math.cos(ring.angleOf(mid[k])));           // 1 on the sides, where the ring runs vertically
        need[k] = Math.max(own[k], (units[k] ? 1 : 0.5) * up);
      }
    }
    return ring;
  }

  // Glyphs turned along the ring read outward from the centre, so past the sides of the circle they lean over and at
  // the bottom they stand upside down (a wide sweep put the first glyphs at 7–8 o'clock turned 90–150°). Their arc is
  // capped at TANGENT_SWEEP, centred on the top: the end glyphs turn at most 100°. Upright glyphs keep the full ring.
  const TANGENT_SWEEP = 200;

  // Glyphs one by one along a circle or an arc, each at the angle of its own slot. Past MAX_UNITS, neighbouring glyphs
  // share one run: a short tangent chord of the ring (their slots stay the same), so the whole line is always set.
  function haloBuild(env, p) {
    const { D, cut, sb, text, textStyle } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const units = glyphsOf(env, s);
    const n = Math.max(1, units.length);
    const want = p.tangent ? Math.min(p.sweep, TANGENT_SWEEP) : p.sweep;
    const full = want >= 355;
    const sweep = (full ? 360 : want) * DEG;
    // radians per cell: a full ring shares the circle out; an arc runs from the first slot's centre to the last one's
    const cells = ringSlots(env, s, units, sweep, full, p.tangent);
    const perCell = cells.perCell, angleOf = cells.angleOf;
    const scale = textStyle.scale;
    const cap = D.short * 0.16 * Math.max(1, scale);
    const perR = Math.min(perCell * 0.82, 0.42);               // em per du of radius: neighbours never touch
    const R = ringRadius(Math.min(D.w, D.h) * p.radius, perR, cap, Math.min(safe.w, safe.h) / 2);
    const em = Math.min(R * perR, cap) * Math.min(1, scale);
    const start = n > 1 ? angleOf(cells.mid[0]) : -Math.PI / 2, step = perCell;
    const runs = [];
    for (const g of groupSlots(units, MAX_UNITS)) {
      if (!g.span) continue;
      const slots = g.last - g.first + 1;
      const a = angleOf((cells.mid[g.first] + cells.mid[g.last]) / 2);
      const cx = D.cx + R * Math.cos(a), cy = D.cy + R * Math.sin(a);
      const h = em * 1.3;
      const chord = R * (cells.mid[g.last] - cells.mid[g.first] + 1) * perCell;
      const gc = Math.max(1, text.cells(s.str.slice(g.span[0], g.span[1])));
      const w = slots > 1 ? chord : h * gc;
      runs.push(sb.text(Object.assign({ parent: root.node, orient: 'h', size: em, rot: p.tangent || slots > 1 ? a + Math.PI / 2 : 0,
        box: { x: cx - w / 2, y: cy - h / 2, w, h }, align: 'center', valign: 'center', maxLines: 1, breakAt: 'none',
        fit: 'shrink', emphScale: 1.25, tracking: slots > 1 ? Math.max(0, (R * perCell) / em - 1) : 0 }, part(s, g.span))));
    }
    const deco = [];
    if (p.ring) {
      const rr = R - em * 0.95;
      const path = full ? K.shape.ellipse(D.cx, D.cy, rr, rr)
        : K.shape.arc(D.cx, D.cy, rr, start - step * 0.3, start + sweep + step * 0.3);
      deco.push(sb.shape({ parent: root.node, layer: 'text', path, stroke: 'muted', width: clamp(em * 0.03, 1.5, 4) }));
    }
    fadeWithText(env, deco);
    if (s.note) {
      const ne = clamp(em * 0.45, D.short * 0.032, D.short * 0.06);
      const w = R * 1.2;
      runs.push(sb.text({ parent: root.node, text: s.note, orient: 'h', face: NOTE_FACE, size: ne, style: 'plain',
        box: { x: D.cx - w / 2, y: D.cy - ne * 0.75 + (full ? 0 : R * 0.2), w, h: ne * 1.5 }, align: 'center', valign: 'center',
        maxLines: 1, breakAt: 'none', fit: 'shrink' }));
    }
    return finish(env, root, runs);
  }

  const haloRing = K.arrange({
    key: 'haloRing',
    label: L('円環', 'Halo ring'),
    blurb: L('文字を円や弧に沿って並べる。正立でも接線向きでも', 'Glyphs placed along a circle or an arc around the centre, upright or tangent'),
    tags: ['airy', 'playful'], family: 'pattern', cam: 'gentle',
    traits: { orient: ['h'], cells: [3, 28] },
    params: {
      sweep: { type: 'num', min: 90, max: 360, step: 5, unit: 'deg', label: L('弧の広さ', 'Sweep'),
        auto: { range: [150, 360], follow: 'cells' } },
      radius: { type: 'num', min: 0.18, max: 0.46, step: 0.01, unit: 'frac', label: L('半径', 'Radius'),
        auto: { range: [0.28, 0.38] } },
      tangent: { type: 'bool', label: L('弧に沿って傾ける', 'Follow the arc'), auto: { pick: [true, false], weights: [3, 2] } },
      ring: { type: 'bool', label: L('内側の輪', 'Inner ring'), auto: { pick: [true, false], weights: [2, 3] } },
    },
    build: haloBuild,
  });

  // --- gridMosaic ------------------------------------------------------------------------------------------------

  function drawPaper(g, t, d, q) {
    g.fillStyle = q.rgba('ground2', 1);
    g.fillRect(d.x, d.y, d.w, d.h);
    g.fillStyle = q.rgba('ink', 0.03);
    g.fillRect(d.x, d.y, d.w, d.h);
  }

  // Cells shared as on manuscript paper: !! !? ?! ?? take one cell (as tate-chu-yoko does), and two digits in a row
  // share one (「2024」 → 20 24, set tate-chu-yoko in a vertical grid); in a horizontal grid two half-width letters in
  // a row share one too (「DANCE」 → DA NC E), while a vertical grid keeps them upright, one per cell. Lone 1–2 digit
  // numbers already share one (glyphsOf). Past MAX_UNITS the grid is set line by line (gridLines), one glyph per cell,
  // so nothing is paired there.
  const MARK = /^[!?！？]$/;
  const HALF = /^[A-Za-z0-9À-ɏ]$/;
  const DIGIT = /^[0-9]$/;
  // Marks that never open a line of manuscript paper: they hang after the last cell of the line before (ぶら下げ). Two in
  // a row (。」 」、) share one cell, as they are written.
  const HANG = /^[、。，．,.」』）)］】〕〉》｝]+$/;
  function gridUnits(env, s, v) {
    const units = glyphsOf(env, s);
    const str = s.str;
    const one = (r, re) => !!r && re.test(str.slice(r[0], r[1]));
    const out = [];
    for (let i = 0; i < units.length; i++) {
      const r = units[i], q = units[i + 1];
      const joined = !!r && !!q && q[0] === r[1];
      if (joined && ((one(r, MARK) && one(q, MARK)) || (one(r, DIGIT) && one(q, DIGIT)) || (one(r, HANG) && one(q, HANG)) ||
        (!v && one(r, HALF) && one(q, HALF)))) {
        out.push([r[0], q[1]]);
        i++;
      } else out.push(r);
    }
    return out.length <= MAX_UNITS ? out : units;
  }

  // Where each unit sits with `line` cells per text line: one unit per cell in reading order, except that a mark that
  // may not open a line (HANG) hangs after the last cell of the line before, as on manuscript paper (one per line).
  // → { lineOf, atOf (the place along the line; `line` for a hanging mark), lines (text lines used), hang }.
  function gridPlaces(hangs, line) {
    const n = hangs.length;
    const lineOf = new Int32Array(n), atOf = new Int32Array(n);
    let l = 0, a = 0, hang = false, hung = -1;
    for (let k = 0; k < n; k++) {
      if (a === line) { l++; a = 0; }
      if (a === 0 && l > 0 && hangs[k] && hung !== l - 1) {
        lineOf[k] = l - 1; atOf[k] = line; hang = true; hung = l - 1;
        continue;
      }
      lineOf[k] = l; atOf[k] = a; a++;
    }
    return { lineOf, atOf, lines: a > 0 ? l + 1 : Math.max(1, l), hang };
  }

  // The grid with the largest square cell: `line` cells per text line (a row, or a column when vertical), `count` text
  // lines, plus `pad` empty cells around the text (C columns × R rows in all). A line of several glyphs never gets one
  // cell per line (a column of rows, or a row of one-glyph columns, reads the wrong way). When the cell size is capped,
  // several shapes reach the cap: the one with the fewest text lines wins (はじま／りの朝, not はじ／まり／の朝), as long
  // as it still reaches the cap. A hanging mark sits in the margin cells, or one cell past the grid without them.
  function gridShape(hangs, room, pad, v, cap) {
    const n = Math.max(1, hangs.length);
    const marks = hangs.some(Boolean);                  // without marks to hang, n units fill ⌈n / line⌉ lines
    let best = null;
    for (let line = n > 1 ? 2 : 1; line <= n; line++) {
      const places = marks ? gridPlaces(hangs, line) : null;
      const count = places ? places.lines : Math.ceil(n / line), extra = places && places.hang && pad === 0 ? 1 : 0;
      const C = (v ? count : line) + 2 * pad, R = (v ? line : count) + 2 * pad;
      const s = Math.min(room.w / (C + (v ? 0 : extra)), room.h / (R + (v ? extra : 0)));
      const capped = best && best.s >= cap && s >= cap;
      if (!best || s > best.s * 1.02 || capped) best = { line, count, C, R, s, places, extra };
    }
    if (!best.places) best.places = gridPlaces(hangs, best.line);
    return best;
  }

  // One run per unit, centred in its cell (vertical cells use the vertical rules per glyph). Two glyphs sharing a cell
  // keep clear of its rules.
  function gridCells(env, root, s, units, shape, g) {
    const v = env.orient === 'v';
    const runs = [];
    units.forEach((r, k) => {
      if (!r) return;
      const line = shape.places.lineOf[k], at = shape.places.atOf[k];      // text line, and place along it
      const col = v ? shape.C - 1 - g.pad - line : g.pad + at;
      const row = v ? g.pad + at : g.pad + line;
      const inset = graphemes(s.str, r[0], r[1]).length > 1 ? g.cell * 0.1 : 0;
      runs.push(env.sb.text(Object.assign({ parent: root.node, orient: v ? 'v' : 'h', size: g.em,
        box: { x: g.x0 + col * g.cell + inset, y: g.y0 + row * g.cell + inset, w: g.cell - 2 * inset, h: g.cell - 2 * inset },
        align: 'center', valign: 'center', emphScale: 1, maxLines: 1, breakAt: 'none', fit: 'shrink' }, part(s, r))));
    });
    return runs;
  }

  // Past MAX_UNITS: one run per text line of the grid, tracked so that full-width glyphs keep one cell each (narrower
  // glyphs such as Latin letters sit closer, never outside their line).
  function gridLines(env, root, s, units, shape, g) {
    const v = env.orient === 'v';
    const runs = [];
    for (let line = 0; line * shape.line < units.length; line++) {
      const k0 = line * shape.line;
      const ext = extentOf(units, k0, Math.min(units.length, k0 + shape.line));
      if (!ext.span) continue;
      const inset = (g.cell - g.em) / 2;
      const lead = (g.pad + ext.first - k0) * g.cell + inset, length = (ext.last - ext.first) * g.cell + g.em + inset;
      const across = (v ? shape.C - 1 - g.pad - line : g.pad + line) * g.cell;
      const box = v ? { x: g.x0 + across, y: g.y0 + lead, w: g.cell, h: length }
        : { x: g.x0 + lead, y: g.y0 + across, w: length, h: g.cell };
      runs.push(env.sb.text(Object.assign({ parent: root.node, orient: v ? 'v' : 'h', size: g.em, box, align: 'start',
        valign: 'center', emphScale: 1, tracking: g.cell / g.em - 1, maxLines: 1, breakAt: 'none', fit: 'shrink' },
      part(s, ext.span))));
    }
    return runs;
  }

  function gridBuild(env, p) {
    const { D, cut, sb, textStyle } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const v = env.orient === 'v';
    const units = gridUnits(env, s, v);
    const hangs = units.map((r) => units.length <= MAX_UNITS && !!r && HANG.test(s.str.slice(r[0], r[1])));
    // A note goes under the grid: its line is kept free inside the safe area, and grid and note are centred together.
    const noteMost = s.note ? D.short * 0.05 * 2.1 : 0;
    const cap = D.short * 0.2 * Math.max(1, textStyle.scale);
    const shape = gridShape(hangs, { w: safe.w * 0.92, h: Math.min(safe.h * 0.86, safe.h * 0.97 - noteMost) }, p.pad, v, cap);
    const cell = Math.min(shape.s, cap) * Math.min(1, textStyle.scale);
    const W = shape.C * cell, H = shape.R * cell;
    // A mark hanging past a grid without margin cells (after the right end, or under the foot of the columns)
    const exW = v ? 0 : shape.extra * cell, exH = v ? shape.extra * cell : 0;
    const ne = clamp(cell * 0.3, D.short * 0.03, D.short * 0.05);
    const x0 = D.cx - (W + exW) / 2, y0 = D.cy - (H + exH + (s.note ? ne * 2.1 : 0)) / 2;
    const deco = [];
    if (p.paper) {
      const m = cell * 0.35;
      deco.push(sb.paint({ layer: 'mid', bleed: 0.05, animated: true, draw: drawPaper,
        data: { x: x0 - m + root.shift.x, y: y0 - m + root.shift.y, w: W + 2 * m, h: H + 2 * m } }));
    }
    // Rules between the text lines (rows, or columns when vertical); 'grid' also divides every line into cells.
    const cmds = [];
    const between = v ? shape.C : shape.R, within = v ? shape.R : shape.C;
    for (let i = 1; i < between; i++) {
      if (v) cmds.push(['M', x0 + i * cell, y0], ['L', x0 + i * cell, y0 + H]);
      else cmds.push(['M', x0, y0 + i * cell], ['L', x0 + W, y0 + i * cell]);
    }
    for (let i = 1; p.lines === 'grid' && i < within; i++) {
      if (v) cmds.push(['M', x0, y0 + i * cell], ['L', x0 + W, y0 + i * cell]);
      else cmds.push(['M', x0 + i * cell, y0], ['L', x0 + i * cell, y0 + H]);
    }
    const lw = clamp(cell * 0.016, 1, 3);
    if (cmds.length) {
      deco.push(sb.shape({ parent: root.node, layer: 'text', path: K.shape.path(cmds), stroke: 'muted', width: lw }));
    }
    deco.push(sb.shape({ parent: root.node, layer: 'text', path: K.shape.rect(x0, y0, W, H), stroke: 'muted', width: lw * 2 }));
    fadeWithText(env, deco);
    const em = cell * 0.7;
    const runs = units.length <= MAX_UNITS ? gridCells(env, root, s, units, shape, { x0, y0, cell, em, pad: p.pad })
      : gridLines(env, root, s, units, shape, { x0, y0, cell, em, pad: p.pad });
    if (s.note) {
      runs.push(sb.text({ parent: root.node, text: s.note, orient: 'h', face: NOTE_FACE, size: ne, style: 'plain',
        box: { x: x0, y: y0 + H + exH + ne * 0.6, w: W, h: ne * 1.5 }, align: 'end', valign: 'start', maxLines: 1, breakAt: 'none',
        fit: 'shrink' }));
    }
    return finish(env, root, runs, { x: x0 + root.shift.x, y: y0 + root.shift.y, w: W, h: H });
  }

  const gridMosaic = K.arrange({
    key: 'gridMosaic',
    label: L('升目', 'Grid mosaic'),
    blurb: L('原稿用紙のような正方形の升目に一字ずつ収める', 'Glyphs in a strict grid of square cells, like manuscript paper'),
    tags: ['literary', 'retro'], family: 'pattern', cam: 'none',
    traits: { cells: [2, 32], scripts: ['ja', 'zhHant', 'zhHans', 'ko'] },
    params: {
      pad: { type: 'int', min: 0, max: 2, label: L('余白の升', 'Margin cells'), auto: { pick: [1, 0, 2], weights: [3, 2, 1] } },
      lines: { type: 'enum', of: ['grid', 'rows'], label: L('罫', 'Rules'), auto: { pick: ['grid', 'rows'], weights: [3, 1] } },
      paper: { type: 'bool', label: L('紙色', 'Paper tint'), auto: { pick: [true, false], weights: [2, 1] } },
    },
    build: gridBuild,
  });

  return [confettiWords, hangingTags, haloRing, gridMosaic];
});
