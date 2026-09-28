/* 文字PVメーカー v2 — original work. Song parts and the motion arc of 文字PVの定石: parts, their stable keys, runs and drive (DESIGN_2_2 §2.0.4). */
MV.def('planner/arc', ['core/num', 'core/hash', 'planner/features'], (N, H, FE) => {
  'use strict';

  // A part is the unit the kit keys its set of looks by (M1) and the arc shapes (M2). Real sections come from the song
  // analysis or the '#' headings (cut.feat.section, as the rest of the planner reads them); without any, blocks of
  // lines separated by blank rows are grouped into pseudo sections (a block that comes back is a chorus). A part's key
  // is content-based, never an ordinal of position: inserting, deleting or splitting a block elsewhere renames no part,
  // so a kit and its salt (work:kit.<key>) stay with their part.
  const PER_CUT = new Set(['lyric', 'focus']);
  // The target energy of each kind of part (also the kit's energy target).
  const DRIVE = Object.freeze({ intro: 0.3, verse: 0.35, prechorus: 0.55, chorus: 0.75, bridge: 0.45, interlude: 0.3,
    solo: 0.6, outro: 0.3, other: 0.5 });
  const NEUTRAL = 0.5;
  const PEAK = 0.15, HEAD = 0.1, TAME = 0.25, IMPACT = 0.8, KIME = 0.85, SPECIAL = 0.3;
  const STRONG_TAGS = Object.freeze(['fast', 'hard', 'bold']);
  const CALM_TAGS = Object.freeze(['soft', 'slow', 'minimal', 'airy']);
  const ROW_ID = /^[a-z0-9]{1,24}$/;

  function q2(x) { return Math.round(x * 100) / 100; }
  function hex8(n) { return (n >>> 0).toString(16).padStart(8, '0'); }

  // A row id as a part key's tail: as it is when it fits a slot name, else a hash of it (a hand-edited file).
  function safeId(id) { return ROW_ID.test(String(id)) ? String(id) : 'x' + hex8(H.hash32(String(id))); }

  function driveOfKind(kind) { return kind ? (DRIVE[kind] !== undefined ? DRIVE[kind] : DRIVE.other) : NEUTRAL; }

  // kimeAt(cut) → P3's キメ mark on a skeleton or Plan cut (a row mark, read as cut.kime or feat.kime).
  function kimeAt(cut) { return !!(cut && (cut.kime || (cut.feat && cut.feat.kime))); }

  // strength(def, traits) → +1 (a strong part: fast, hard or bold, or made for impacts, and not calm), −1 (calm: soft,
  // slow, minimal or airy, and not strong), else 0. The same for a shot preset by its tags ('none' is calm).
  function strength(def, traits) {
    const tags = def && Array.isArray(def.tags) ? def.tags : [];
    const strong = tags.some((t) => STRONG_TAGS.includes(t)) || !!(traits && traits.impact);
    const calm = tags.some((t) => CALM_TAGS.includes(t));
    return strong && !calm ? 1 : calm && !strong ? -1 : 0;
  }

  // --- real sections ----------------------------------------------------------------------------------------------

  // The heading row each timed line sits under (the rule of planner/plan featureContexts: a line whose heading names a
  // section starts it, and it is carried forward), by line id. sheet = the parsed sheet (core/lyrics parseSheet).
  function headRows(sheet, timed) {
    const rows = sheet && Array.isArray(sheet.rows) ? sheet.rows : [];
    const at = new Map(rows.map((r, i) => [r.id, i]));
    const out = new Map();
    let head = null;
    for (const line of timed) {
      if (FE.sectionOfHeading(line.heading)) {
        const i = at.get(line.row);
        let found = null;
        for (let j = (i === undefined ? -1 : i - 1); j >= 0 && j >= i - 3; j--) {
          if (rows[j].kind === 'comment' && rows[j].heading) { found = rows[j].id; break; }
        }
        head = found;
      }
      out.set(line.id, head);
    }
    return out;
  }

  // The analysis section of a cut and its key (kind + ordinal among the sections of that kind), or null.
  function analysisKey(info, t) {
    const list = info && Array.isArray(info.sections) ? info.sections : null;
    if (!list) return null;
    const count = new Map();
    for (const s of list) {
      if (!s || typeof s.kind !== 'string') continue;
      const n = (count.get(s.kind) || 0) + 1;
      count.set(s.kind, n);
      if (typeof s.start === 'number' && typeof s.end === 'number' && t >= s.start && t < s.end) return s.kind + n;
    }
    return null;
  }

  function realKeys(ctx, lyric, sheet, timed) {
    const kinds = new Set();
    for (const c of lyric) if (c.feat.section) kinds.add(c.feat.section);
    const out = new Map();
    if (kinds.size >= 2) {
      for (const c of lyric) out.set(c.key, { key: c.feat.section || 'none', kind: c.feat.section || null });
      return out;
    }
    // One kind (a song headed 1番, 2番…): every run is keyed by the heading row it sits under, or by its analysis
    // section; analysis sections are time spans, so editing lines does not renumber them.
    const info = ctx.doc && ctx.doc.song && ctx.doc.song.info ? ctx.doc.song.info : null;
    const heads = headRows(sheet, timed);
    for (const c of lyric) {
      const kind = c.feat.section || null;
      const a = kind ? analysisKey(info, c.t0) : null;
      const h = heads.get(c.line);
      out.set(c.key, { key: a || (kind && h ? 'h' + safeId(h) : 'none'), kind });
    }
    return out;
  }

  // --- pseudo sections (blank-line blocks) ---------------------------------------------------------------------------

  // Blocks start at the first line and at every line after a blank row (pauseBefore > 0, the rule of planner/areas
  // rowGroups). In sheet order, a block joins the group of the earliest block with the same first line, or sharing at
  // least half of its lines; otherwise it starts a group. Groups of two or more blocks are choruses, the others verses;
  // with no group that comes back, no part has a kind (a neutral song). Key: 'b' + the row id of the first line of the
  // group's earliest block.
  function pseudoKeys(lyric, timed) {
    const blocks = [];
    const blockOfRow = new Map();
    for (const line of timed) {
      if (line.occ) continue;
      if (!blocks.length || line.pauseBefore > 0) blocks.push({ row: line.row, first: line.text, texts: new Set(), group: null });
      const b = blocks[blocks.length - 1];
      b.texts.add(line.text);
      blockOfRow.set(line.row, b);
    }
    const groups = [];
    for (const b of blocks) {
      for (const a of blocks) {
        if (a === b) break;
        let shared = 0;
        for (const x of b.texts) if (a.texts.has(x)) shared++;
        if (a.first === b.first || shared >= 0.5 * b.texts.size) { b.group = a.group; break; }
      }
      if (!b.group) { b.group = { key: 'b' + safeId(b.row), n: groups.length + 1, size: 0 }; groups.push(b.group); }
      b.group.size++;
    }
    const repeats = groups.some((g) => g.size >= 2);
    const lineRow = new Map(timed.map((l) => [l.id, l.row]));
    const out = new Map();
    for (const c of lyric) {
      const b = blockOfRow.get(lineRow.get(c.line));
      const g = b ? b.group : null;
      out.set(c.key, { key: g ? g.key : 'none', kind: g && repeats ? (g.size >= 2 ? 'chorus' : 'verse') : null, n: g ? g.n : 0 });
    }
    return out;
  }

  // --- parts ---------------------------------------------------------------------------------------------------------

  // parts(ctx, cuts, timed, sheet) → { pseudo, neutral, byCut: Map<cut key, Part>, keys: [{ key, kind, n }] } with
  // Part = frozen { key, kind, run, first, drive, tame, peak, head } for every lyric or focus cut (special cuts have no
  // part). run = the index of its run (consecutive lyric cuts of one key; a special cut ends a run); first = the first
  // cut of its run. drive (M2, and the kit's energy target): the kind's DRIVE; +PEAK in the last chorus run, +HEAD on the
  // first cut of a chorus run (サビ頭); at most TAME on the cut right before a chorus run (ため); at least IMPACT on an
  // impact line and KIME on a キメ line (P3); 0.5 everywhere in a neutral song.
  function parts(ctx, cuts, timed, sheet) {
    const lyric = cuts.filter((c) => PER_CUT.has(c.role) && c.line);
    const real = lyric.some((c) => !!c.feat.section);
    const keyed = real ? realKeys(ctx, lyric, sheet, timed) : pseudoKeys(lyric, timed);
    const neutral = !lyric.some((c) => !!keyed.get(c.key).kind);
    // runs
    const runOf = new Map();
    let run = -1, prev = null;
    for (const c of cuts) {
      const k = keyed.get(c.key);
      if (!k || !PER_CUT.has(c.role) || !c.line) { prev = null; continue; }
      if (!prev || prev.key !== k.key) run++;
      runOf.set(c.key, { run, first: !prev || prev.key !== k.key });
      prev = k;
    }
    let lastChorus = -1;
    for (const c of lyric) if (keyed.get(c.key).kind === 'chorus') lastChorus = Math.max(lastChorus, runOf.get(c.key).run);
    const byCut = new Map();
    const keys = [];
    const seen = new Map();
    const perKind = new Map();
    lyric.forEach((c, i) => {
      const k = keyed.get(c.key);
      const r = runOf.get(c.key);
      const next = lyric[i + 1];
      const nk = next ? keyed.get(next.key) : null;
      let d = driveOfKind(k.kind), tame = false, peak = false, head = false;
      if (!neutral) {
        if (k.kind === 'chorus' && r.run === lastChorus) { d += PEAK; peak = true; }
        if (k.kind === 'chorus' && r.first) { d += HEAD; head = true; }
        if (k.kind !== 'chorus' && nk && nk.kind === 'chorus' && runOf.get(next.key).first) { d = Math.min(d, TAME); tame = true; }
        if (c.impact) d = Math.max(d, IMPACT);
        if (kimeAt(c)) d = Math.max(d, KIME);
      } else d = NEUTRAL;
      byCut.set(c.key, Object.freeze({ key: k.key, kind: k.kind, run: r.run, first: r.first, drive: q2(N.clamp(d)), tame, peak, head }));
      if (!seen.has(k.key)) {
        const n = k.n || (perKind.get(k.kind) || 0) + 1;
        perKind.set(k.kind, (perKind.get(k.kind) || 0) + 1);
        const entry = Object.freeze({ key: k.key, kind: k.kind, n });
        seen.set(k.key, entry);
        keys.push(entry);
      }
    });
    return { pseudo: !real, neutral, byCut, keys };
  }

  return { parts, strength, kimeAt, driveOfKind, safeId, DRIVE, STRONG_TAGS, CALM_TAGS, SPECIAL_DRIVE: SPECIAL, PER_CUT };
});
