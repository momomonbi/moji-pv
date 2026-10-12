/* 文字PVメーカー v2 — original work. Song-step timing targets and atomic nudges. */
MV.def('ui/timing_targets', ['ui/selection', 'planner/areas', 'core/paths'], (S, A, P) => {
  'use strict';

  const GAP = 0.1, PIECE = 0.351, PART = 1.001;
  const round = (x) => Math.round(x * 1000000) / 1000000;
  const locked = (doc, path) => !!(doc.pins[path] && doc.pins[path].by === 'lock');

  function areas(doc, plan, keep) {
    if (!plan) return [];
    const all = A.areasOf(doc, plan);
    const list = all.song.concat(all.heads, all.paras).filter((a) => a.lineIds.length);
    // An audio section may temporarily have no members after its lyrics are nudged out of the analysis span.
    // Its captured target remains selectable until the section itself or its original lyrics are removed.
    if (keep && !list.some((a) => a.key === keep.key) && A.resolve(doc, plan, keep.ref)
      && keep.lineIds.some((id) => plan.lines.some((l) => l.id === id))) list.push(keep);
    return list;
  }

  function selected(doc, plan, sel) {
    const s = S.validate(sel, plan, doc);
    if (s.level === 'cut' || s.level === 'el' && s.scope.startsWith('cut/')) {
      const key = s.level === 'cut' ? s.key : s.scope.slice(4);
      const cut = plan.cuts.find((c) => c.key === key);
      return cut ? { kind: 'cut', key, lineIds: [], label: A.resolve(doc, plan, { kind: 'cut', key }).label } : null;
    }
    const ids = s.level === 'line' ? s.ids : s.level === 'el' && s.scope.startsWith('line/') ? [s.scope.slice(5)] : [];
    if (!ids.length) return null;
    const area = A.resolve(doc, plan, { kind: 'lines', ids });
    return area ? { kind: 'lines', lineIds: area.lineIds.slice(), label: area.label } : null;
  }

  function resolve(doc, plan, mode, sel, area) {
    if (!plan || !plan.lines.length) return null;
    if (mode === 'all') return { kind: 'all', lineIds: plan.lines.map((l) => l.id), label: ['area.work', {}] };
    if (mode === 'selection') return selected(doc, plan, sel);
    if (!area) return null;
    // Keep an explicitly chosen section's members while nudging it across a song-section boundary.
    const known = new Set(plan.lines.map((l) => l.id));
    const ids = area.lineIds.filter((id) => known.has(id));
    return ids.length ? { kind: 'lines', lineIds: ids, label: area.label } : null;
  }

  function pin(path, v, old, sig) {
    const c = { t: 'pin.set', path, v, by: old ? old.by : 'user' };
    if (path.startsWith('cut/')) c.sig = old && typeof old.sig === 'string' ? old.sig : sig || '';
    return c;
  }

  // Freezing only currently automatic times keeps neighbouring lyrics in place. Existing time pins retain their
  // provenance (including AI/tap/lock); this is part of the same undo entry as the selected move.
  function holdLines(doc, plan, exclude) {
    const out = [];
    for (const l of plan.lines) if (!exclude.has(l.id)) {
      for (const [slot, v] of [['start', l.t0], ['end', l.t1]]) {
        const path = 'line/' + l.id + ':' + slot;
        if (!doc.pins[path]) out.push(pin(path, v));
      }
    }
    return out;
  }

  function lineMove(doc, plan, target, d) {
    const ids = new Set(target.lineIds), whole = target.kind === 'all';
    const members = plan.lines.filter((l) => ids.has(l.id));
    if (!members.length) return { cmds: [], delta: 0, reason: 'none' };
    if (members.some((l) => locked(doc, 'line/' + l.id + ':start') || locked(doc, 'line/' + l.id + ':end'))) {
      return { cmds: [], delta: 0, reason: 'locked' };
    }
    let lo = -Math.min(...members.map((l) => l.t0)), hi = Infinity;
    if (!whole) for (let i = 0; i < plan.lines.length; i++) {
      const l = plan.lines[i];
      if (!ids.has(l.id)) continue;
      lo = Math.max(lo, i * GAP - l.t0);
      const prev = plan.lines[i - 1], next = plan.lines[i + 1];
      if (prev && !ids.has(prev.id)) lo = Math.max(lo, prev.t0 + GAP - l.t0);
      if (next && !ids.has(next.id)) hi = Math.min(hi, next.t0 - GAP - l.t0);
    }
    const movingPins = [];
    for (const [path, value] of Object.entries(doc.pins)) {
      if (!path.startsWith('cut/') || !(path.endsWith(':t0') || path.endsWith(':parts'))) continue;
      const key = path.slice(4, path.lastIndexOf(':'));
      let mine = whole;
      if (!mine) {
        const line = P.lineOfCut(key);
        if (line) mine = ids.has(line);
        else if (key.startsWith('gap/')) {
          const after = key.slice(4).replace(/~[2-9]$/, '');
          const at = plan.lines.findIndex((l) => l.id === after);
          mine = at >= 0 && ids.has(after) && at + 1 < plan.lines.length && ids.has(plan.lines[at + 1].id);
        }
      }
      if (!mine) continue;
      if (value.by === 'lock') return { cmds: [], delta: 0, reason: 'locked' };
      const values = Array.isArray(value.v) && value.v.every(Number.isFinite) ? value.v
        : Number.isFinite(value.v) ? [value.v] : [];
      if (values.length) { lo = Math.max(lo, -Math.min(...values)); movingPins.push([path, value]); }
    }
    const delta = round(Math.max(lo, Math.min(hi, d)));
    if (Math.abs(delta) < 0.0000005 || lo > hi) return { cmds: [], delta: 0, reason: 'boundary' };
    const base = Object.fromEntries(members.map((l) => [l.id, { start: l.t0, end: l.t1 }]));
    const cmds = whole ? [] : holdLines(doc, plan, ids);
    cmds.push({ t: 'time.shift', lineIds: members.map((l) => l.id), delta, base });
    for (const [path, value] of movingPins) {
      const v = Array.isArray(value.v) ? value.v.map((x) => round(x + delta)) : round(value.v + delta);
      cmds.push(pin(path, v, value));
    }
    return { cmds, delta, reason: null };
  }

  function cutMove(doc, plan, target, d) {
    const cut = plan.cuts.find((c) => c.key === target.key);
    if (!cut) return { cmds: [], delta: 0, reason: 'none' };
    const cmds = holdLines(doc, plan, new Set());
    if (cut.line) {
      const line = plan.lines.find((l) => l.id === cut.line);
      const cuts = plan.cuts.filter((c) => c.line === cut.line), at = cuts.findIndex((c) => c.key === cut.key);
      const prev = cuts[at - 1], nextLine = plan.lines[plan.lines.indexOf(line) + 1];
      const path = at ? 'cut/' + (cut.pinKey || cut.key) + ':t0' : 'line/' + cut.line + ':start';
      if (locked(doc, path)) return { cmds: [], delta: 0, reason: 'locked' };
      let lo = prev ? prev.t0 + PIECE : 0;
      if (!at) {
        const i = plan.lines.indexOf(line), before = plan.lines[i - 1];
        lo = Math.max(lo, i * GAP, before ? before.t0 + GAP : 0);
      }
      const hi = Math.min(cut.t1 - (cuts.length > 1 ? PIECE : 0.2), nextLine ? nextLine.t0 - (at ? PIECE : GAP) : Infinity);
      const next = round(Math.max(lo, Math.min(hi, cut.t0 + d))), delta = round(next - cut.t0);
      if (hi < lo || Math.abs(delta) < 0.0000005) return { cmds: [], delta: 0, reason: 'boundary' };
      // Freeze the split and the other inner boundaries so moving one cut does not redistribute every sibling.
      const splitPath = 'line/' + cut.line + ':split';
      if (!doc.pins[splitPath]) cmds.push(pin(splitPath, cuts.map((c) => P.cutOffset(c.key))));
      for (const sibling of cuts.slice(1)) if (sibling.key !== cut.key) {
        const p = 'cut/' + (sibling.pinKey || sibling.key) + ':t0';
        if (!doc.pins[p]) cmds.push(pin(p, sibling.t0, null, sibling.text));
      }
      cmds.push(pin(path, next, doc.pins[path], cut.text));
      return { cmds, delta, reason: null };
    }
    const m = /^(gap\/r[0-9a-z]+(?:\.[1-9][0-9]*)?)(?:~([2-9]))?$/.exec(cut.key);
    if (!m || !m[2]) return { cmds: [], delta: 0, reason: 'boundary' };
    const parts = plan.cuts.filter((c) => c.key === m[1] || c.key.startsWith(m[1] + '~'));
    const at = parts.findIndex((c) => c.key === cut.key), path = 'cut/' + m[1] + ':parts';
    if (locked(doc, path)) return { cmds: [], delta: 0, reason: 'locked' };
    const lo = parts[at - 1].t0 + PART, hi = cut.t1 - PART;
    const next = round(Math.max(lo, Math.min(hi, cut.t0 + d))), delta = round(next - cut.t0);
    if (hi < lo || Math.abs(delta) < 0.0000005) return { cmds: [], delta: 0, reason: 'boundary' };
    const values = parts.slice(1).map((c) => c.key === cut.key ? next : c.t0);
    cmds.push(pin(path, values, doc.pins[path], ''));
    return { cmds, delta, reason: null };
  }

  function shift(doc, plan, target, delta) {
    if (!target || !Number.isFinite(delta) || !delta) return { cmds: [], delta: 0, reason: 'none' };
    return target.kind === 'cut' ? cutMove(doc, plan, target, delta) : lineMove(doc, plan, target, delta);
  }

  return { areas, selected, resolve, shift };
});
