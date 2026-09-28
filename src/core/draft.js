/* 文字PVメーカー v2 — original work. 曲から下書き: places line starts on the song's phrase-start candidates with a monotone alignment and a gap prior from the lyrics (DESIGN_2_2 §5.2). */
MV.def('core/draft', [], () => {
  'use strict';

  const DRAFT = Object.freeze({
    WS: 1, WD: 0.6, WF: 0.15, WB: 0.1,         // weights: candidate score, gap prior, first-line pull, beat bonus
    FILL_S: -0.15, FILL_STEP: 0.25,            // filler candidates (a line may sit where no onset was found)
    MIN_GAP: 0.12,                             // = core/tap MIN_GAP (timing's ANCHOR_GAP 0.1 plus rounding room)
    REACH: 5, REACH_PAD: 2,                    // a gap longer than REACH·prior + REACH_PAD is not considered
    SNAP_TOL: 0.06, MOVE_MIN: 0.05,            // beat snap tolerance; smaller moves are not proposed
    HIGH_S: 0.4, RATIO: Object.freeze([0.5, 2]),   // 確か needs a phrase candidate ≥ HIGH_S whose gap is within ×0.5…×2 of its prior
    AGREE_S: 0.3,                              // the agreement readout's tolerance
    BONUS_REACH: 0.07,                         // the beat bonus fades out over min(this, period / 8) from a half beat
  });
  const CONF = Object.freeze(['low', 'mid', 'high']);
  const INF = Infinity;

  function q2(x) { return Math.round(x * 100) / 100; }
  function q3(x) { return Math.round(x * 1000) / 1000; }
  function sq(x) { return x * x; }

  // The candidates of one run: the song's in [lo, hi) plus fillers every FILL_STEP from lo (every half beat of the
  // grid when there is one), sorted by time, then by strength; each with its beat bonus.
  function candidatesOf(cands, lo, hi, grid) {
    const out = [];
    for (const c of cands) if (c.t >= lo && c.t < hi) out.push({ t: c.t, s: c.s, kind: c.kind, bonus: 0 });
    if (grid) {
      const half = grid.period / 2;
      for (let k = Math.ceil((lo - grid.offset) / half - 1e-9); ; k++) {
        const t = q3(grid.offset + k * half);
        if (t >= hi) break;
        if (t >= lo) out.push({ t, s: DRAFT.FILL_S, kind: 'filler', bonus: 0 });
      }
    } else {
      for (let k = 0; ; k++) {
        const t = q3(lo + k * DRAFT.FILL_STEP);
        if (t >= hi) break;
        out.push({ t, s: DRAFT.FILL_S, kind: 'filler', bonus: 0 });
      }
    }
    out.sort((a, b) => a.t - b.t || b.s - a.s);
    if (grid) {
      const half = grid.period / 2;
      const reach = Math.min(DRAFT.BONUS_REACH, grid.period / 8);
      for (const c of out) {
        const near = grid.offset + Math.round((c.t - grid.offset) / half) * half;
        c.bonus = DRAFT.WB * Math.max(0, 1 - Math.abs(c.t - near) / reach);
      }
    }
    return out;
  }

  // One run of lines to draft between the anchor before it (p: { t, w } or null) and after it (q: { t } or null).
  // → [{ c: candidate, gapIn: prior-relative gap into it or null }] per run line, or null when no placement fits.
  // The step cost WD·ln²(Δ/g) reads ln Δ from a table over whole milliseconds (candidate times are on a 1 ms grid),
  // which keeps 80 lines × 1 300 candidates well under 0.1 s.
  function alignRun(run, p, q, span, C, pull) {
    const m = run.length, M = C.length;
    if (!M) return null;
    let W = p ? p.w : 0;
    for (const l of run) W += l.w;
    const scale = (span.hi - span.lo) / Math.max(1e-9, W);
    const g = run.map((l) => Math.max(1e-6, scale * l.w));
    const gp = p ? Math.max(1e-6, scale * p.w) : null;
    const ts = new Float64Array(M), gain = new Float64Array(M);
    for (let i = 0; i < M; i++) { ts[i] = C[i].t; gain[i] = DRAFT.WS * C[i].s + C[i].bonus; }
    let gmax = 0;
    for (let r = 0; r + 1 < m; r++) gmax = Math.max(gmax, g[r]);
    const lnMs = new Float64Array(Math.ceil((DRAFT.REACH * gmax + DRAFT.REACH_PAD) * 1000) + 2);
    for (let k = 1; k < lnMs.length; k++) lnMs[k] = Math.log(k / 1000);
    let prev = new Float64Array(M);
    for (let i = 0; i < M; i++) {
      const prior = p ? DRAFT.WD * sq(Math.log((ts[i] - p.t) / gp)) : DRAFT.WF * Math.abs(ts[i] - pull) / Math.max(1, g[0]);
      prev[i] = prior - gain[i];
    }
    const back = [null];
    for (let r = 1; r < m; r++) {
      const cur = new Float64Array(M).fill(INF), bk = new Int32Array(M).fill(-1);
      const lg = Math.log(g[r - 1]), reach = DRAFT.REACH * g[r - 1] + DRAFT.REACH_PAD;
      let lo = 0, first = 0;
      while (first < M && prev[first] === INF) first++;
      for (let i = first + 1; i < M; i++) {
        const t = ts[i];
        while (lo < i && t - ts[lo] > reach) lo++;
        let best = INF, arg = -1;
        for (let j = Math.max(lo, first); j < i; j++) {
          const d = t - ts[j];
          if (d < DRAFT.MIN_GAP) break;             // sorted by time: every later j is closer still
          const pj = prev[j];
          if (pj === INF) continue;
          const x = lnMs[Math.round(d * 1000)] - lg;
          const v = pj + DRAFT.WD * x * x;
          if (v < best) { best = v; arg = j; }
        }
        if (arg >= 0) { cur[i] = best - gain[i]; bk[i] = arg; }
      }
      prev = cur;
      back.push(bk);
    }
    let best = INF, arg = -1;
    const gl = g[m - 1];
    for (let i = 0; i < M; i++) {
      if (prev[i] === INF) continue;
      const t = ts[i];
      let end;
      if (q) end = q.t - t >= DRAFT.MIN_GAP - 1e-9 ? DRAFT.WD * sq(Math.log((q.t - t) / gl)) : INF;
      else end = span.R > t ? DRAFT.WD * sq(Math.log((span.R - t) / gl)) : INF;
      const v = prev[i] + end;
      if (v < best) { best = v; arg = i; }
    }
    if (arg < 0) return null;
    const idx = new Array(m);
    for (let r = m - 1; r >= 0; r--) { idx[r] = arg; arg = r > 0 ? back[r][arg] : -1; }
    return idx.map((i, r) => {
      const c = C[i];
      let gapIn = null;
      if (r > 0) gapIn = (c.t - C[idx[r - 1]].t) / g[r - 1];
      else if (p) gapIn = (c.t - p.t) / gp;
      return { c, gapIn };
    });
  }

  function confOf(c, gapIn, digest) {
    let conf = c.kind === 'filler' ? 'low' : 'mid';
    if (c.kind === 'phrase' && c.s >= DRAFT.HIGH_S && (gapIn === null || (gapIn >= DRAFT.RATIO[0] && gapIn <= DRAFT.RATIO[1]))) {
      conf = 'high';
    }
    if (digest && conf === 'high') conf = 'mid';
    return conf;
  }

  // draftStarts({ lines, cands, voiced, duration, grid, snap, digest }) → { proposals, kept, skipped }
  //   lines: [{ id, t0, draft, w }] in line order (w: core/timing gapWeights; draft: to be drafted, else an anchor);
  //   cands: [{ t, s, kind: 'phrase' | 'weak' }] in time order (audio/voice candidatesIn or fromDigest);
  //   voiced: { t0, t1 } | null (where singing starts and ends); grid: a core/beats grid or null; snap: timing.snap;
  //   digest: the candidates came from the loudness alone (確か is capped at たぶん).
  //   proposals: [{ lineId, from, to, conf: 'high' | 'mid' | 'low', kind }] for drafted lines that move MOVE_MIN or more;
  //   kept: the same for drafted lines that stay (a smaller move); skipped: line ids of runs with no room.
  // Starts are strictly increasing, at least MIN_GAP apart and never cross an anchor. Deterministic: no state survives.
  function draftStarts(input) {
    const o = input || {};
    const lines = o.lines || [];
    const cands = o.cands || [];
    const duration = typeof o.duration === 'number' && o.duration > 0 ? o.duration : 0;
    const voiced = o.voiced && typeof o.voiced.t0 === 'number' ? o.voiced : null;
    const grid = o.grid || null;
    const snapUnit = o.snap && o.snap !== 'off' && grid ? o.snap : null;
    const L = voiced ? Math.max(0, voiced.t0 - 1) : 0;
    const R = voiced && typeof voiced.t1 === 'number' ? Math.min(duration, voiced.t1) : duration;
    const pull = voiced ? voiced.t0 : L;
    const proposals = [], kept = [], skipped = [];
    const placed = new Map();                   // lineId → { to, conf, kind }
    let i = 0;
    while (i < lines.length) {
      if (!lines[i].draft) { i++; continue; }
      let j = i;
      while (j < lines.length && lines[j].draft) j++;
      const run = lines.slice(i, j);
      const pl = i > 0 ? lines[i - 1] : null, ql = j < lines.length ? lines[j] : null;
      const p = pl ? { t: pl.t0, w: pl.w } : null, q = ql ? { t: ql.t0 } : null;
      const lo = (p ? p.t : L) + DRAFT.MIN_GAP;
      const hi = q ? q.t - DRAFT.MIN_GAP : R;
      const got = hi - lo >= DRAFT.MIN_GAP * run.length
        ? alignRun(run, p, q, { lo, hi, R }, candidatesOf(cands, lo, hi, grid), pull) : null;
      if (!got) { for (const l of run) skipped.push(l.id); i = j; continue; }
      run.forEach((l, r) => placed.set(l.id, { to: q2(got[r].c.t), conf: confOf(got[r].c, got[r].gapIn, !!o.digest), kind: got[r].c.kind }));
      i = j;
    }
    // beat snapping, only where the order stays strict (MIN_GAP from both neighbours' final starts)
    const at = (k) => (placed.has(lines[k].id) ? placed.get(lines[k].id).to : lines[k].t0);
    if (snapUnit) {
      for (let k = 0; k < lines.length; k++) {
        const x = placed.get(lines[k].id);
        if (!x) continue;
        const s = q3(grid.snap(x.to, snapUnit, DRAFT.SNAP_TOL));
        if (s === x.to) continue;
        const okPrev = k === 0 ? s >= 0 : s - at(k - 1) >= DRAFT.MIN_GAP - 1e-9;
        const okNext = k + 1 === lines.length || at(k + 1) - s >= DRAFT.MIN_GAP - 1e-9;
        if (okPrev && okNext) x.to = s;
      }
    }
    for (const l of lines) {
      const x = placed.get(l.id);
      if (!x) continue;
      const row = { lineId: l.id, from: l.t0, to: x.to, conf: x.conf, kind: x.kind };
      (Math.abs(x.to - l.t0) < DRAFT.MOVE_MIN ? kept : proposals).push(row);
    }
    return { proposals, kept, skipped };
  }

  // agreement(res, tapped) → { k, n }: over the drafted lines whose start was tapped (tapped: a Set of line ids; their
  // `from` is the tapped time), how many the draft puts within AGREE_S of it (a kept line agrees).
  function agreement(res, tapped) {
    let k = 0, n = 0;
    for (const x of res.kept) if (tapped.has(x.lineId)) { n++; k++; }
    for (const x of res.proposals) {
      if (!tapped.has(x.lineId)) continue;
      n++;
      if (Math.abs(x.to - x.from) <= DRAFT.AGREE_S + 1e-9) k++;
    }
    return { k, n };
  }

  return { DRAFT, CONF, draftStarts, agreement };
});
