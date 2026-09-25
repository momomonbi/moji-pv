/* 文字PVメーカー v2 — original work. Look history: derived pointer, append / coalesce rules, cap and stars (DESIGN §3.7, §6.7). */
MV.def('ui/looks', [], () => {
  'use strict';

  const DEFAULT_CAP = 50;
  const DICE_LABEL = 'look.dice';           // label key of field-dice entries (the ones that coalesce)

  function saltsEqual(a, b) {
    const ka = Object.keys(a || {}), kb = Object.keys(b || {});
    if (ka.length !== kb.length) return false;
    for (const k of ka) if ((a || {})[k] !== (b || {})[k]) return false;
    return true;
  }

  // An entry is the current look when (seed, moodSeed, salts) equal the document's.
  function sameLook(entry, doc) {
    return !!entry && !!doc && entry.seed === doc.look.seed && entry.moodSeed === doc.look.moodSeed
      && saltsEqual(entry.salts, doc.salts);
  }

  function isEntry(e) { return !!e && typeof e === 'object' && !Array.isArray(e); }
  function looksOf(side) { return side && isEntry(side.looks) ? side.looks : null; }

  // The history's entries; a damaged history (not an array, or holding non-objects) reads as its usable entries only.
  function listOf(side) {
    const looks = looksOf(side);
    const list = looks && Array.isArray(looks.list) ? looks.list : [];
    return list.every(isEntry) ? list : list.filter(isEntry);
  }

  // pointer(side, doc) → { index: 1-based position | null, modified, total }. The pointer is the newest entry equal to
  // the current look; with none the look is "modified" (UI shows ●/m).
  function pointer(side, doc) {
    const list = listOf(side);
    for (let i = list.length - 1; i >= 0; i--) {
      if (sameLook(list[i], doc)) return { index: i + 1, modified: false, total: list.length };
    }
    return { index: null, modified: list.length > 0, total: list.length };
  }

  // Field dice: a salt key with a slot ('cut/r3~0:depart'); scope rerolls have a bare scope ('line/r4', 'cut/r3~0').
  function isFieldDice(key) { return typeof key === 'string' && key.indexOf(':') >= 0; }

  // appendKind(cmd) → 'append' | 'coalesce' | 'none': what a command does to the look history.
  // おまかせ, root reroll (look.seed) and line/cut rerolls append; field dice coalesce; ◀ ▶ (look.restore) never append.
  function appendKind(cmd) {
    if (!cmd || typeof cmd.t !== 'string') return 'none';
    if (cmd.t === 'look.omakase' || cmd.t === 'look.seed') return 'append';
    if (cmd.t === 'salt.bump') return isFieldDice(cmd.key) ? 'coalesce' : 'append';
    if (cmd.t === 'batch' && Array.isArray(cmd.cmds)) {
      const kinds = cmd.cmds.map(appendKind);
      if (kinds.includes('append')) return 'append';
      if (kinds.includes('coalesce')) return 'coalesce';
    }
    return 'none';
  }

  // The scope a look-changing command acts on ('work', 'line/<id>', 'cut/<key>').
  function scopeOfCmd(cmd) {
    if (!cmd) return 'work';
    if (cmd.t === 'salt.bump' && typeof cmd.key === 'string') return cmd.key.split(':')[0];
    if (cmd.t === 'batch' && Array.isArray(cmd.cmds)) {
      const bump = cmd.cmds.find((c) => c && c.t === 'salt.bump');
      if (bump) return scopeOfCmd(bump);
    }
    return 'work';
  }

  function labelFor(kind, cmd) {
    if (kind === 'coalesce') return [DICE_LABEL, {}];
    if (cmd && cmd.t === 'look.omakase') return ['look.omakase', {}];
    if (cmd && cmd.t === 'look.seed') return ['look.reroll', {}];
    return ['look.rerollScope', {}];
  }

  // Drops the oldest non-starred entries until at most `cap` non-starred remain.
  function capped(list, cap) {
    let free = list.filter((e) => !e.star).length;
    if (free <= cap) return list;
    const out = [];
    for (const e of list) {
      if (!e.star && free > cap) { free--; continue; }
      out.push(e);
    }
    return out;
  }

  function nextN(list) { return list.reduce((m, e) => Math.max(m, e.n || 0), 0) + 1; }

  function entryOf(doc, n, scope, label) {
    return { n, seed: doc.look.seed, moodSeed: doc.look.moodSeed, salts: Object.assign({}, doc.salts), scope, label, star: false };
  }

  // record(side, doc, { kind, scope?, label? }) → side': the look history after a command (doc = the new document).
  // kind 'append' adds an entry (unless the newest one already is this look); 'coalesce' replaces the newest entry
  // when it was field dice at the same scope, otherwise appends. Returns `side` unchanged for 'none'.
  function record(side, doc, opts) {
    const o = opts || {};
    const kind = o.kind || 'append';
    if (kind === 'none' || !doc || !doc.look) return side;
    const looks = looksOf(side) || { list: [], cap: DEFAULT_CAP };
    const list = listOf(side);
    const scope = o.scope || 'work';
    const newest = list[list.length - 1];
    if (newest && sameLook(newest, doc)) return side;
    const label = o.label || labelFor(kind, null);
    let next;
    if (kind === 'coalesce' && newest && !newest.star && Array.isArray(newest.label) && newest.label[0] === DICE_LABEL
      && newest.scope === scope) {
      next = list.slice(0, -1).concat([entryOf(doc, newest.n, scope, label)]);
    } else {
      next = list.concat([entryOf(doc, nextN(list), scope, label)]);
    }
    const cap = Number.isInteger(looks.cap) && looks.cap > 0 ? looks.cap : DEFAULT_CAP;
    return Object.assign({}, side, { looks: Object.assign({}, looks, { list: capped(next, cap) }) });
  }

  // recordCmd(side, doc, cmd) → side': record() with the kind, scope and label a command implies.
  function recordCmd(side, doc, cmd) {
    const kind = appendKind(cmd);
    if (kind === 'none') return side;
    return record(side, doc, { kind, scope: scopeOfCmd(cmd), label: labelFor(kind, cmd) });
  }

  // ◀ / ▶ targets: the entry to restore, or null when the button is disabled. When the look is modified, ◀ goes to
  // the newest entry and ▶ is disabled.
  function prev(side, doc) {
    const list = listOf(side);
    const p = pointer(side, doc);
    if (p.index === null) return list.length ? list[list.length - 1] : null;
    return p.index > 1 ? list[p.index - 2] : null;
  }

  function next(side, doc) {
    const list = listOf(side);
    const p = pointer(side, doc);
    if (p.index === null) return null;
    return p.index < list.length ? list[p.index] : null;
  }

  // The look.restore command for an entry.
  function restoreCmd(entry) {
    return { t: 'look.restore', seed: entry.seed, moodSeed: entry.moodSeed, salts: Object.assign({}, entry.salts) };
  }

  // ★ toggles; starred entries survive the cap.
  function toggleStar(side, n) {
    const list = listOf(side);
    if (!list.some((e) => e.n === n)) return side;
    const looks = Object.assign({}, side.looks, { list: list.map((e) => (e.n === n ? Object.assign({}, e, { star: !e.star }) : e)) });
    return Object.assign({}, side, { looks });
  }

  // --- the one-line diff readout after おまかせ, a reroll or an undo (§6.7) ------------------------------------------

  // Kinds the readout names, in the order it lists them (part choices only; parameter changes are not listed).
  const DIFF_KINDS = ['theme', 'mood', 'arrange', 'arrive', 'dwell', 'depart', 'ground', 'ornament', 'lens', 'filter', 'seam'];
  const PART_SLOT = /:([a-z]+)(?:#\d+)?$/;

  // diffSummary(entries, plan) → { lines: [1-based line numbers], items: [{ kind, from, to, count }] } from
  // planner.diff's [{ cut, path, from, to }] (plan = the new plan). Items keep the order of DIFF_KINDS.
  function diffSummary(entries, plan) {
    const lineOfCut = new Map();
    const index = new Map();
    for (const l of (plan && plan.lines) || []) index.set(l.id, l.index);
    for (const c of (plan && plan.cuts) || []) if (c.line) lineOfCut.set(c.key, c.line);
    const lines = new Set();
    const byKind = new Map();
    for (const d of Array.isArray(entries) ? entries : []) {
      const line = lineOfCut.get(d.cut);
      if (line && index.has(line)) lines.add(index.get(line) + 1);
      const m = PART_SLOT.exec(String(d.path || ''));
      if (!m || !DIFF_KINDS.includes(m[1]) || d.from === d.to) continue;
      const item = byKind.get(m[1]);
      if (item) item.count += 1;
      else byKind.set(m[1], { kind: m[1], from: d.from, to: d.to, count: 1 });
    }
    const items = DIFF_KINDS.filter((k) => byKind.has(k)).map((k) => byKind.get(k));
    return { lines: [...lines].sort((a, b) => a - b), items };
  }

  // diffText(summary, t, { scope }) → 「12行を振り直し: 構図 縦の柱→大と小, 入り …」, or '' when nothing named changed.
  // A line or cut reroll (scope other than 'work') names its line; otherwise the head counts the changed lines. The
  // first kind shows its values, the next two only their names; '…' marks more.
  function diffText(summary, t, opts) {
    const items = summary && summary.items ? summary.items : [];
    if (!items.length) return '';
    const scope = opts && opts.scope ? opts.scope : 'work';
    const n = summary.lines.length;
    const head = n === 1 && scope !== 'work' ? t('diff.line', { n: summary.lines[0] })
      : n > 0 ? t('diff.lines', { n }) : t('diff.work');
    const first = items[0];
    const label = (kind, key) => (typeof t.part === 'function' ? t.part(kind, key) : String(key));
    const parts = [t('kind.' + first.kind) + ' ' + label(first.kind, first.from) + '→' + label(first.kind, first.to)];
    for (const it of items.slice(1, 3)) parts.push(t('kind.' + it.kind));
    const more = items.length > 3 || first.count > 1;
    return head + t('diff.sep') + parts.join(t('diff.join')) + (more ? ' …' : '');
  }

  return {
    DEFAULT_CAP, DICE_LABEL, pointer, appendKind, record, recordCmd, prev, next, restoreCmd, toggleStar, sameLook,
    scopeOfCmd, isFieldDice, DIFF_KINDS, diffSummary, diffText,
  };
});
