/* 文字PVメーカー v2 — original work. diff(planA, planB, scope?): what changed after おまかせ, a reroll or an undo (DESIGN §4.16.1, §6.7). */
MV.def('planner/diff', ['core/paths'], (P) => {
  'use strict';

  const LOOK_SLOTS = Object.freeze(['mood', 'theme', 'season']);
  // Slots compared per cut, in the order the readout lists them; parameters are not part of the readout.
  const CUT_SLOTS = Object.freeze(['arrange', 'arrive', 'dwell', 'depart', 'ornament.count', 'ornament#0', 'ornament#1',
    'ornament#2', 'lens', 'filter.count', 'filter#0', 'filter#1', 'filter#2', 'orient', 'text.face', 'text.scale',
    'text.ink', 'text.style']);

  // 'none' and a missing slot both mean "nothing here".
  function valueOf(d) { return d && d.v !== 'none' ? d.v : null; }

  function seamInto(plan, cut) { return cut.seamIn >= 0 ? plan.seams[cut.seamIn].slot.v : null; }

  function groundOf(plan, cut, field) {
    const g = plan.grounds[cut.ground];
    return g && g[field] ? g[field].v : null;
  }

  function inScope(scope, cutKey, lineId) {
    if (!scope || scope === 'work') return true;
    if (scope.startsWith('cut/')) return scope.slice(4) === cutKey;
    if (scope.startsWith('line/')) return lineId === scope.slice(5);
    return false;
  }

  // diff(planA, planB, scope?) → [{ cut, path, from, to }]: for every cut present in both plans (by key), each slot
  // whose value changed (part choices, counts, orient, text.*, the seam into the cut, its background and atmosphere);
  // for the work scope also mood, theme, season and texture (cut: null). scope = 'work' | 'line/<id>' | 'cut/<key>'.
  function diff(a, b, scope) {
    if (!a || !b) return [];
    const out = [];
    if (!scope || scope === 'work') {
      for (const slot of LOOK_SLOTS) {
        if (a.look[slot].v !== b.look[slot].v) out.push({ cut: null, path: 'work:' + slot, from: a.look[slot].v, to: b.look[slot].v });
      }
      const ta = a.look.texture ? a.look.texture.v : 'none', tb = b.look.texture ? b.look.texture.v : 'none';
      if (ta !== tb) out.push({ cut: null, path: 'work:texture', from: ta, to: tb });
    }
    const before = new Map(a.cuts.map((c) => [c.key, c]));
    for (const cut of b.cuts) {
      const old = before.get(cut.key);
      if (!old || !inScope(scope, cut.key, cut.line)) continue;
      const push = (slot, from, to) => {
        if (JSON.stringify(from) !== JSON.stringify(to)) out.push({ cut: cut.key, path: 'cut/' + cut.key + ':' + slot, from, to });
      };
      for (const slot of CUT_SLOTS) push(slot, valueOf(old.slots[slot]), valueOf(cut.slots[slot]));
      push('seam', seamInto(a, old), seamInto(b, cut));
      push('ground', groundOf(a, old, 'ground'), groundOf(b, cut, 'ground'));
      push('atmos', groundOf(a, old, 'atmos'), groundOf(b, cut, 'atmos'));
    }
    return out;
  }

  // The keys of every line whose cuts changed (for 「n行を振り直し」).
  function changedLines(entries) {
    const lines = new Set();
    for (const e of entries) {
      if (!e.cut) continue;
      const line = P.lineOfCut(e.cut);
      if (line) lines.add(line);
    }
    return [...lines].sort();
  }

  return { diff, changedLines, CUT_SLOTS };
});
