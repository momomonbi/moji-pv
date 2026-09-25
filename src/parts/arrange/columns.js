/* 文字PVメーカー v2 — original work. Line and column compositions: pillar columns, spine column, stair step, sidebar index. */
MV.def('parts/arrange/columns', ['parts/kit'], (K) => {
  'use strict';

  const { clamp, smooth } = K.math;
  const L = (ja, en) => ({ ja, en });
  const NOTE_FACE = 'body';
  const CJK = /^(ja|zhHans|zhHant)$/;

  // --- helpers (defined once per module, never per build) --------------------------------------------------------

  function safeBox(D) {
    return { x: D.safe.l, y: D.safe.t, w: D.w - D.safe.l - D.safe.r, h: D.h - D.safe.t - D.safe.b };
  }

  // What a composition shows: the cut's own text, or for a blank special cut its note (a section heading) or ♪.
  function subjectOf(cut) {
    const text = cut.text || '';
    if (text.trim()) return { str: text, own: true, note: cut.note || null };
    return { str: cut.note || '♪', own: false, note: null };
  }

  // A run spec for a range of the subject: a span of the cut text (with its emphasis), or the extra text itself.
  function part(s, range) {
    return s.own ? { span: range } : { text: s.str.slice(range[0], range[1]) };
  }

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

  // text.scale over a size the frame limits: smaller scales shrink it; larger ones may pass the part's own cap but
  // never the frame's limit, because boxes and positions follow the size.
  function sized(limit, cap, scale) { return Math.min(limit, cap * Math.max(1, scale)) * Math.min(1, scale); }

  function cellsOf(env, str, range) { return Math.max(1, env.text.cells(str.slice(range[0], range[1]))); }

  // Up to n balanced phrase pieces; a single CJK phrase without spaces may break between characters instead.
  function piecesOf(env, s, n) {
    const { text, cut } = env;
    const str = s.str;
    const whole = [[0, str.length]];
    if (n <= 1) return whole;
    const cols = text.columns(str, n, cut.lang);
    if (cols.length >= 2) return cols;
    const cells = text.cells(str);
    if (!CJK.test(cut.lang) || /\s/.test(str.trim()) || cells < 4) return cols.length ? cols : whole;
    return text.breakLines(str, Math.ceil(cells / Math.min(n, Math.floor(cells / 2))), cut.lang, 'char');
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

  function hairline(env, root, x0, y0, x1, y1, em) {
    return env.sb.shape({ parent: root.node, layer: 'text', path: K.shape.line(x0, y0, x1, y1), stroke: 'muted',
      width: clamp(em * 0.025, 1.5, 4) });
  }

  // --- pillarColumns ---------------------------------------------------------------------------------------------

  function pillarBuild(env, p) {
    const { D, cut, sb, textStyle } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const spans = piecesOf(env, s, p.cols);
    const n = spans.length;
    const cells = spans.map((r) => cellsOf(env, s.str, r));
    const reach = Math.max(...cells.map((c, i) => c + i * p.step));
    const colH = safe.h * 0.92;
    const pitchK = 1.6;
    const noteK = s.note ? 0.8 : 0;               // the note's column left of the block (noteColumn: 2.2 × 0.36 em)
    const em = sized(Math.min(colH / reach, safe.w * 0.9 / ((n - 1) * pitchK + 1.3 + noteK * 1.25)), D.short * 0.2,
      textStyle.scale);
    const pitch = em * pitchK, blockW = pitch * (n - 1) + em;
    // Anchored blocks (with their note) hug the safe edge in narrow frames; in wide frames they stop partway, so the
    // page stays balanced. Centred, the block and its note are centred together.
    const centred = D.cx + (blockW + noteK * em) / 2 - em / 2;
    const edge = p.anchor === 'right' ? safe.x + safe.w - em * 0.75 : safe.x + blockW - em * 0.25 + noteK * em;
    const pull = D.w > D.h ? 0.55 : 1;
    const first = p.anchor === 'center' ? centred : centred + (edge - centred) * pull;
    const top = Math.max(safe.y, D.cy - (reach * em) / 2);
    const runs = spans.map((r, i) => sb.text(Object.assign({ parent: root.node, orient: 'v', size: em, sizeGroup: 'pillar',
      box: { x: first - i * pitch - em * 0.65, y: top + i * p.step * em, w: em * 1.3, h: safe.y + safe.h - top - i * p.step * em },
      align: 'start', valign: 'center', maxLines: 1, breakAt: 'none', fit: 'shrink' }, part(s, r))));
    const lines = [];
    if (p.rule) {
      for (let i = 1; i < n; i++) {
        const x = first - (i - 0.5) * pitch;
        const y0 = top + (i - 0.5) * p.step * em + em * 0.2;
        const y1 = top + Math.max(cells[i - 1] + (i - 1) * p.step, cells[i] + i * p.step) * em - em * 0.2;
        lines.push(hairline(env, root, x, y0, x, Math.max(y0 + em, y1), em));
      }
    }
    fadeWithText(env, lines);
    const block = localBounds(sb, root.node, root);
    if (s.note) runs.push(noteColumn(env, root, s.note, block, em));
    return finish(env, root, runs, block.w ? sb.bounds(root.node) : null);
  }

  // A thin vertical note after (left of) a vertical block, ending with the block.
  function noteColumn(env, root, note, block, em) {
    const { D, sb } = env;
    const ne = clamp(em * 0.36, D.short * 0.03, D.short * 0.055);
    const x = clamp(block.x - ne * 2.2, D.safe.l, D.w - D.safe.r - ne * 1.5);
    return sb.text({ parent: root.node, text: note, orient: 'v', face: NOTE_FACE, size: ne, style: 'plain',
      box: { x, y: block.y, w: ne * 1.5, h: Math.min(Math.max(block.h, ne * 6), D.h - D.safe.b - block.y) }, align: 'end',
      valign: 'start', maxLines: 1,
      breakAt: 'none', fit: 'shrink' });
  }

  const pillarColumns = K.arrange({
    key: 'pillarColumns',
    label: L('縦の柱', 'Pillar columns'),
    blurb: L('縦書きの列を右から左へ並べ、列の間に細い罫を引ける', 'Vertical columns set right to left, with optional hairline rules between them'),
    tags: ['literary', 'slow', 'minimal'], family: 'vertical',
    traits: { orient: ['v'], cells: [2, 40], roles: ['lyric', 'focus', 'title'] },
    params: {
      cols: { type: 'int', min: 1, max: 5, label: L('列数', 'Columns'), auto: { range: [1, 3], follow: 'cells' } },
      anchor: { type: 'enum', of: ['right', 'center', 'left'], label: L('寄せ', 'Anchor'),
        auto: { pick: ['right', 'center'], weights: [2, 1] } },
      step: { type: 'num', min: 0, max: 1.5, step: 0.05, unit: 'em', label: L('段差', 'Step down'),
        auto: { range: [0, 0.9], follow: 'amount.density', jitter: 0.4 } },
      rule: { type: 'bool', label: L('区切り線', 'Rules'), auto: { pick: [false, true], weights: [3, 2] } },
    },
    build: pillarBuild,
  });

  // --- spineColumn -----------------------------------------------------------------------------------------------

  // Where the column breaks for the crossing note: the phrase boundary nearest 55% of the text (null: no boundary).
  function spineBreak(env, s) {
    if (!s.own) return null;
    const { text, cut } = env;
    const total = text.cells(s.str);
    let best = null, bestD = Infinity;
    for (const [a] of text.phrases(s.str, cut.lang)) {
      if (a <= 0) continue;
      const d = Math.abs(text.cells(s.str.slice(0, a)) / total - 0.55);
      if (d < bestD) { best = a; bestD = d; }
    }
    return best !== null && bestD < 0.3 ? best : null;
  }

  function spineBuild(env, p) {
    const { D, cut, sb, text, textStyle } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const cells = Math.max(1, text.cells(s.str));
    const split = s.note ? spineBreak(env, s) : null;
    const ne = clamp(D.short * 0.042, D.short * 0.032, D.short * 0.06) * textStyle.scale;
    const gap = split !== null ? ne * 3 : 0;
    const tail = s.note && split === null ? ne * 2.4 : 0;           // the note under the column, kept in the safe area
    const em = sized(Math.min((safe.h * 0.86 - gap - tail) / cells, safe.w * 0.32), D.short * 0.2, textStyle.scale);
    const colH = cells * em + gap;
    const top = D.cy - (colH + tail) / 2;
    const x = D.cx - em * 0.65;
    const col = (range, y, h, align) => sb.text(Object.assign({ parent: root.node, orient: 'v', size: em, sizeGroup: 'spine',
      box: { x, y, w: em * 1.3, h }, align, valign: 'center', maxLines: 1, breakAt: 'none', fit: 'shrink' }, part(s, range)));
    const runs = [];
    let crossY;
    if (split !== null) {
      const upper = text.cells(s.str.slice(0, split)) * em;
      runs.push(col([0, split], top, upper + em * 0.2, 'end'));
      runs.push(col([split, s.str.length], top + upper + gap - em * 0.2, colH - upper - gap + em * 0.2, 'start'));
      crossY = top + upper + gap / 2;
    } else {
      runs.push(col([0, s.str.length], top, colH, 'center'));
      crossY = s.note ? top + colH + ne * 1.6 : top + colH * p.cross;
    }
    const spine = localBounds(sb, root.node, root);
    const reach = Math.max(D.w * p.reach / 2, spine.w / 2 + em * 1.6);
    const lines = [];
    if (s.note) {
      const note = sb.text({ parent: root.node, text: s.note, orient: 'h', face: NOTE_FACE, size: ne, style: 'plain',
        box: { x: D.cx - reach, y: crossY - ne * 0.75, w: reach * 2, h: ne * 1.5 }, align: 'center', valign: 'center',
        maxLines: 1, breakAt: 'none', fit: 'shrink' });
      runs.push(note);
      const nb = localBounds(sb, note.node, root);
      if (nb.w < reach * 1.6) {
        lines.push(hairline(env, root, D.cx - reach, crossY, nb.x - ne * 0.8, crossY, em));
        lines.push(hairline(env, root, nb.x + nb.w + ne * 0.8, crossY, D.cx + reach, crossY, em));
      }
    } else {
      const clear = Math.max(spine.w / 2, em * 0.6) + em * 0.35;
      lines.push(hairline(env, root, D.cx - reach, crossY, D.cx - clear, crossY, em));
      lines.push(hairline(env, root, D.cx + clear, crossY, D.cx + reach, crossY, em));
    }
    fadeWithText(env, lines);
    return finish(env, root, runs, sb.bounds(runs[0].node));
  }

  const spineColumn = K.arrange({
    key: 'spineColumn',
    label: L('背骨', 'Spine column'),
    blurb: L('中央に一本の高い縦列、注釈が横書きでそれを横切る', 'One tall vertical column in the centre, with the note running across it horizontally'),
    tags: ['literary', 'slow'], family: 'vertical',
    traits: { orient: ['v'], cells: [2, 16], roles: ['lyric', 'focus', 'title'] },
    params: {
      reach: { type: 'num', min: 0.2, max: 0.9, step: 0.01, unit: 'frac', label: L('横線の長さ', 'Cross length'),
        auto: { range: [0.36, 0.62] } },
      cross: { type: 'num', min: 0.2, max: 0.8, step: 0.01, unit: 'frac', label: L('横線の高さ', 'Cross height'),
        auto: { range: [0.55, 0.68] } },
    },
    build: spineBuild,
  });

  // --- stairStep -------------------------------------------------------------------------------------------------

  function stairBuild(env, p) {
    const { D, cut, sb, textStyle } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const v = env.orient === 'v';
    const spans = piecesOf(env, s, p.steps);
    const n = spans.length;
    const widest = Math.max(...spans.map((r) => cellsOf(env, s.str, r)));
    const reach = widest + (n - 1) * p.indent;            // em along the lines, first line to last line's end
    const lead = v ? 1.55 : 1.28;                          // em between lines (columns)
    const depth = (n - 1) * lead + 1;
    const em = sized(Math.min((v ? safe.h : safe.w) * 0.94 / reach, (v ? safe.w : safe.h) * 0.88 / depth), D.short * 0.22,
      textStyle.scale);
    const back = p.dir === 'back';
    const runs = spans.map((r, i) => {
      const step = i * p.indent * em;
      let box, align;
      if (v) {
        const x = D.cx + ((depth - 1) / 2 - i * lead) * em - em * 0.65;
        const top = D.cy - (reach * em) / 2;
        box = back ? { x, y: safe.y, w: em * 1.3, h: top + reach * em - step - safe.y }
          : { x, y: top + step, w: em * 1.3, h: safe.y + safe.h - top - step };
        align = back ? 'end' : 'start';
      } else {
        const y = D.cy + (i - (n - 1) / 2) * lead * em - em * 0.62;
        const left = D.cx - (reach * em) / 2;
        box = back ? { x: safe.x, y, w: left + reach * em - step - safe.x, h: em * 1.24 }
          : { x: left + step, y, w: safe.x + safe.w - left - step, h: em * 1.24 };
        align = back ? 'end' : 'start';
      }
      return sb.text(Object.assign({ parent: root.node, orient: v ? 'v' : 'h', size: em, sizeGroup: 'stair', box, align,
        valign: 'center', maxLines: 1, breakAt: 'none', fit: 'shrink' }, part(s, r)));
    });
    if (s.note) runs.push(stairNote(env, root, s.note, localBounds(sb, runs[n - 1].node, root), em, v, back));
    return finish(env, root, runs);
  }

  // The note continues the staircase: one more, smaller step after the last line (column).
  function stairNote(env, root, note, last, em, v, back) {
    const { D, sb } = env;
    const safe = safeBox(D);
    const ne = clamp(em * 0.34, D.short * 0.03, D.short * 0.052);
    if (v) {
      const x = Math.max(safe.x, last.x - ne * 2.1);
      const y = back ? safe.y : last.y + last.h * 0.35;
      const h = back ? last.y + last.h * 0.65 - safe.y : safe.y + safe.h - y;
      return sb.text({ parent: root.node, text: note, orient: 'v', face: NOTE_FACE, size: ne, style: 'plain',
        box: { x, y, w: ne * 1.5, h },
        align: back ? 'end' : 'start', valign: 'start', maxLines: 1, breakAt: 'none', fit: 'shrink' });
    }
    const y = Math.min(last.y + last.h + ne * 0.7, safe.y + safe.h - ne * 1.5);
    return sb.text({ parent: root.node, text: note, orient: 'h', face: NOTE_FACE, size: ne, style: 'plain',
      box: back ? { x: safe.x, y, w: last.x + last.w * 0.6 - safe.x, h: ne * 1.5 }
        : { x: last.x + last.w * 0.4, y, w: safe.x + safe.w - last.x - last.w * 0.4, h: ne * 1.5 },
      align: back ? 'end' : 'start', valign: 'start', maxLines: 1, breakAt: 'none', fit: 'shrink' });
  }

  const stairStep = K.arrange({
    key: 'stairStep',
    label: L('階段', 'Stair step'),
    blurb: L('句ごとに一段ずつ下げて、斜めに階段状に並べる', 'Phrases step down diagonally, each line indented one step from the one above'),
    tags: ['playful', 'literary'], family: 'flow',
    traits: { cells: [4, 36] },
    fits: (f) => (f.words >= 2 ? 1 : 0.4),
    params: {
      steps: { type: 'int', min: 2, max: 4, label: L('段数', 'Steps'), auto: { range: [2, 4], follow: 'cells' } },
      indent: { type: 'num', min: 0.3, max: 3, step: 0.05, unit: 'em', label: L('段の幅', 'Indent'),
        auto: { range: [0.8, 2], follow: 'energy', jitter: 0.4 } },
      dir: { type: 'enum', of: ['forward', 'back'], label: L('向き', 'Direction'),
        auto: { pick: ['forward', 'back'], weights: [3, 1] } },
    },
    build: stairBuild,
  });

  // --- sidebarIndex ----------------------------------------------------------------------------------------------

  function sidebarBuild(env, p) {
    const { D, cut, sb, text, textStyle } = env;
    const root = rootOf(env, p);
    const s = subjectOf(cut);
    const safe = safeBox(D);
    const v = env.orient === 'v';
    const left = p.side === 'left';
    const em = D.short * 0.07 * textStyle.scale;
    const number = String(p.number || '').trim();
    // The number is big, but never wider than a third of the frame.
    const numEm = Math.min(D.short * p.size * textStyle.scale, (safe.w * 0.34) / (0.62 * Math.max(2, number.length)));
    const runs = [];
    const lines = [];
    if (v) {
      const colW = Math.min(safe.w * 0.4, em * 1.6 * 3);
      const colX = left ? safe.x : safe.x + safe.w - colW;
      const top = safe.y + (number ? numEm * 1.25 : 0);
      const main = sb.text(Object.assign({ parent: root.node, orient: 'v', size: em * 1.3,
        box: { x: colX, y: top, w: colW, h: safe.y + safe.h - top }, leading: 1.6, align: 'start', valign: left ? 'end' : 'start',
        maxLines: 3, breakAt: 'phrase', fit: 'shrink' }, part(s, [0, s.str.length])));
      runs.push(main);
      const mb = localBounds(sb, main.node, root);
      if (number) {
        const nw = Math.max(mb.w, numEm * 2.4);
        const nb = { x: left ? safe.x : safe.x + safe.w - nw, y: safe.y, w: nw, h: numEm * 1.1 };
        runs.push(numberRun(env, root, number, numEm, nb, left ? 'start' : 'end'));
        const y = safe.y + numEm * 1.12;
        lines.push(hairline(env, root, left ? safe.x : mb.x + mb.w - Math.max(mb.w, em * 2), y,
          left ? safe.x + Math.max(mb.w, em * 2) : mb.x + mb.w, y, em));
      }
      // the note follows the block: left of it on the right edge, right of it on the left edge
      const after = left ? { x: mb.x + mb.w + em * 2.4, y: mb.y, w: 0, h: mb.h } : mb;
      if (s.note) runs.push(noteColumn(env, root, s.note, after, em * 1.3));
    } else {
      // The column takes at most a third of a wide frame, half of a square one, and more of a tall one.
      const share = D.h > D.w ? 0.6 : D.h >= D.w * 0.99 ? 0.5 : 0.34;
      const numW = Math.max(number.length, 1) * numEm * 0.62;
      const gap = em * 0.7;
      const room = safe.w - numW - gap * 2;
      const colW = Math.min(clamp(text.cells(s.str) * em * 0.6, em * 7, em * 9.5), safe.w * share, room);
      const hairX = left ? safe.x + numW + gap : safe.x + safe.w - colW - gap;
      const colX = hairX + gap;
      const ne = clamp(em * 0.7, D.short * 0.03, em);
      const H = Math.min(safe.h * 0.7, safe.h - (s.note ? ne * 4.6 : 0));    // the note's line stays in the safe area
      const main = sb.text(Object.assign({ parent: root.node, orient: 'h', size: em,
        box: { x: colX, y: D.cy - H / 2, w: colW, h: H }, leading: 1.45, align: 'start', valign: 'center', maxLines: 6,
        breakAt: 'phrase', fit: 'shrink' }, part(s, [0, s.str.length])));
      runs.push(main);
      const mb = localBounds(sb, main.node, root);
      if (number) {
        const nx = left ? safe.x : Math.max(safe.x, hairX - gap - numW * 1.3);
        const ny = clamp(mb.y - numEm * 0.12, safe.y, safe.y + safe.h - numEm * 1.1);
        runs.push(numberRun(env, root, number, numEm, { x: nx, y: ny, w: hairX - gap - nx, h: numEm * 1.1 }, 'end'));
      }
      lines.push(hairline(env, root, hairX, mb.y, hairX, mb.y + Math.max(mb.h, numEm * 0.85), em));
      if (s.note) {
        runs.push(sb.text({ parent: root.node, text: s.note, orient: 'h', face: NOTE_FACE, size: ne, style: 'plain',
          box: { x: colX, y: mb.y + mb.h + ne * 0.8, w: colW, h: ne * 1.5 }, align: 'start', valign: 'start', maxLines: 1,
          breakAt: 'none', fit: 'shrink' }));
      }
    }
    fadeWithText(env, lines);
    // Decorations avoid the whole block: the column, the big number, the rule and the note (with the column alone as
    // the focus, a bar code ran across the number and a tape strip over the rule).
    return finish(env, root, runs, sb.bounds(root.node));
  }

  function numberRun(env, root, number, numEm, box, align) {
    return env.sb.text({ parent: root.node, text: number, orient: 'h', face: 'display', size: numEm, ink: 'accent', style: 'plain',
      box, align, valign: 'start', maxLines: 1, breakAt: 'none', fit: 'shrink', tracking: -0.02 });
  }

  const sidebarIndex = K.arrange({
    key: 'sidebarIndex',
    label: L('袖書き', 'Sidebar index'),
    blurb: L('画面の端に細い段組、その横に大きな番号', 'A narrow column at one edge with a big index number beside the text'),
    tags: ['serious', 'minimal'], family: 'edge',
    traits: { cells: [2, 40] },
    params: {
      side: { type: 'enum', of: ['left', 'right'], label: L('寄せる側', 'Side'), auto: { pick: ['left', 'right'], weights: [3, 2] } },
      number: { type: 'text', max: 4, label: L('番号', 'Number'),
        auto: {
          fn: (f) => {
            const n = Math.round(Math.min(0.99, Math.max(0, f.pos || 0)) * 100);
            return n < 10 ? '0' + n : String(n);
          },
          why: L('曲の中の位置（%）を二桁の番号にする', 'The position in the song, as a two-digit percentage') } },
      size: { type: 'num', min: 0.08, max: 0.4, step: 0.005, unit: 'frac', label: L('番号の大きさ', 'Number size'),
        auto: { range: [0.2, 0.32], follow: 'energy' } },
    },
    build: sidebarBuild,
  });

  return [pillarColumns, spineColumn, stairStep, sidebarIndex];
});
