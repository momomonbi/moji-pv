/* 文字PVメーカー v2 — original work. Test helper: where an edit of some lines may change the choices of other cuts (DESIGN §4.16.4). */
'use strict';

// The chooser's recency reaches the 5 cuts after a changed one (the previous cut's natural and reference picks, the
// natural picks of the 3 before it; planner/cast createHistory) and the seam history one more boundary, so a cut may
// change when it lies within AFTER cuts after the edited cuts. A composition with its own motion (motion: 'own', e.g.
// tickerMarquee) forces its cut's entrance, hold and exit (rule values, facts for the recency of the cuts after it),
// so a change of composition to or from one reaches one more recency window (a relay).
const AFTER = 6;
const RELAY = 5;

// near(plan, key, spans, changed, ownMotion) → whether the cut `key` of `plan` may change: spans = [[pos, end]] (the
// edited cuts' index ranges in `plan`); changed = the keys of the cuts that did change; ownMotion(key) → whether that
// cut's composition moves the text itself in either plan.
function near(plan, key, spans, changed, ownMotion) {
  const i = plan.cuts.findIndex((c) => c.key === key);
  if (spans.some(([, end]) => i >= end && i - end < AFTER)) return true;
  return changed.some((k) => {
    const j = plan.cuts.findIndex((c) => c.key === k);
    return j < i && i - j <= RELAY && ownMotion(k);
  });
}

// The index range [pos, end) of a line's cuts in a plan.
function spanOfLine(plan, lineId) {
  const pos = plan.cuts.findIndex((c) => c.line === lineId);
  return [pos, pos + plan.cuts.filter((c) => c.line === lineId).length];
}

module.exports = { near, spanOfLine, AFTER, RELAY };
