# P3 — キメ (M3): design (revision 2)

Package P3 of PV22. One item:

- **M3** キメたい一行を大胆に見せる「キメ」

Base: `main` at 9a9e950. Every statement about current code below was checked against that tree. The central claims
(byte-identical plans without the mark, the guarantees with it, registry safety, locality, cost) were checked with a
working prototype: a patched copy of `src/` in `scratchpad/pv22/probe/p3r/src`, loaded by `probe/p3r/loadp3r.js`
(revision 1's prototype, `probe/p3`, is kept for reference). Nothing in the repository was edited. Appendix A lists the
probes and their results. Every example lyric line in this document is invented for it.

Revision 2 answers the critique of revision 1 (see the Critique log at the end). The largest change: the キメ mark is
a **line pin** `line/<id>:kime`, not a leading `!` in the lyric text. That removes the grammar change, makes gating
exact (an absent pin is off, in every existing and imported document) and gives P2/P4/P6 one flag to read.

---

## 0. Decisions at a glance

| Question | Decision |
|---|---|
| What marks a キメ line | A line pin `line/<id>:kime = true` (bool slot `kime`, line scope only). Set by the 行 toggle 「キメ」 (and the multi-line toggle, the same-lyric button, optionally the AI). No lyric syntax: the row text and the FROZEN row grammar are untouched. |
| Relation to 見せ場 `!` | Independent; they combine. キメ = **size, layout, one cut, entrance, hold, calm before**. 見せ場 = **flash, shake, slip impulses** plus its existing odds boosts. A キメ line without 見せ場 never flashes and never shakes. |
| Gating | By construction: no document has a `kime` pin until the user sets one after PV22 (no fixture, sample, golden, import path or older build writes one; `grep -r kime src tests` is empty today). Absent pin = not キメ. Prototype: 264 of 264 plan hashes equal the repository's, incl. all 240 `plan_hashes.json` entries. New documents need nothing written: the per-line pin is the switch. 「キメの前を静かにする」 (`work:kime.calm`, absent = on) acts only next to a キメ line. |
| Guarantee mechanism | A キメ cut's automatic picks are **restricted to キメ sets** (pools filtered; the chooser still picks inside them, so rerolls still vary), plus some values **by rule** (`from: 'rule'`). Every set member is checked against the registry, the cut's role and orientation, and the user's part filters; an empty set falls back to the normal chooser (`kime.limited`). Forced parts are always `registry.fallback(kind)`. User pins and locks win everywhere. |
| One cut | A キメ line of ≤ `min(30, 2 · BASE[aspect])` cells (16:9 → 28, 1:1 → 20, 9:16 → 16) is one cut, whatever its `/` marks or the auto cutter would do. Longer lines keep their split; the focus piece (else the last piece) is the キメ cut. A user or lock split pin wins. Pins made on the former pieces are reported as `shadowed-pin` (not silently applied) and come back when the mark is removed. |
| Layout | Family `big`: `edgeBleed` はみ出し (2–12 cells) or `giantWhisper` 大と小. 大と小 is set with whispers under the giant (`tuck: 'under'`), ratio ≥ 3 and `text.scale ≥ 1.0`, so the giant is as large as the layout allows. |
| Camera pairing | Decided from what the shot will be: when the camera will not move (layout `cam: 'none'`, camera amount < 0.1, shot pinned `none`), the lens is `impactKick` (a punch-in at the sung start, shake 0 unless 見せ場); when it moves, the lens is the fixed frame and the shot is `snapZoom` (no emphasis) or `pushWord` (emphasis). |
| Calm before | The cut right before a キメ (level 2) and the one before that (level 1), within 4 s: fewer decorations and screen effects, softer motion, a quiet shot, slightly smaller text. |
| Hold | +0.6 s reading time in automatic timing, an instant cut-out exit, and up to 1.5 s into a following interlude or outro as long as that keeps ≥ 3 s. |
| No flash | On a キメ cut without 見せ場: screen effects with `gate: 'flash'` (閃光, 反転) are left out of its pools, the transition out of it never flashes (白く飛ぶ is left out unless the next cut is a 見せ場 cut), 押印 and 衝撃 shakes are 0. |
| EXTREME | Where カメラ EXTREME is on, a キメ cut that can move takes `crashZoom` (short cut: `punchHit`); `edgeBleed` stays still with `impactKick`. |
| Other packages | One accessor `planner/kime isKime(cut)`; P2 (kits, arc blend, flips, T5), P4 (automatic morph) and P6 (歌ハメ) read it and leave キメ cuts to P3 (M3.11). |
| AI | Not needed. Optional: AI 演出3案 may propose one キメ line per proposal (a `value` change on `line/<id>:kime`, `by: 'ai'`). |
| FROZEN contracts | CutFeatures gain optional `kime` and `calm` (present only where set). The chooser gains optional `req.only` / `req.calm`. Row grammar, ParsedRow/Line, POSE columns, seam mix, SCH enums, slot order, Plan shape and `encode.js` are **not** touched. |

---

## M3.1 What the user gets

**The look.** A line marked キメ is guaranteed to (pins and locks excepted):

1. play as **one cut** (the whole line at once) when it is up to 28 cells in 16:9 (21:9 → 30, 4:3 → 24, 1:1 and 4:5 → 20,
   3:4 → 18, 9:16 → 16). A longer line keeps its cuts and its most important piece (the fully emphasized piece if the
   planner made one, else the last piece) becomes the キメ cut;
2. use a **big layout**: はみ出し (text larger than the frame, only for 2–12-cell cuts) or 大と小 (the emphasized word,
   else the longest word, huge; the rest small under it);
3. be **set big**: はみ出し at its frame-filling size (text size ×1.0, overflow 1.08); 大と小 never shrunk by a quiet
   mood (text size ≥ ×1.0), whispers under the giant and at most a third of its size, so the giant takes the largest
   size the frame allows (1–2-cell giants ≥ 40 % of the short side, 4-cell giants ≥ 20 %). A layout the user pinned
   that is not a big one gets text size ×1.3. The face is the theme's 見出しの書体 (its heading face; how heavy it is
   depends on the theme);
4. **land fast**: 押印 (words slam down from 160 %) or 寄せ (glyphs settle from 2–3×); each unit's move takes ≤ 0.4 s
   and the whole line has landed within 0.8 s of its start;
5. **hold**: still while shown, an instant cut-out at the end, 0.6 s more time in automatic timing, and up to 1.5 s
   more when an interlude or the ending card follows (they keep at least 3 s);
6. get **camera that pairs with the layout**: はみ出し stays framed and takes a sharp punch-in (衝撃) at the sung start;
   大と小 snaps in on the whole block (一気に寄る) or pushes to the emphasized word (言葉へ寄る); when the camera cannot
   move (カメラの動き below 10 %, or カメラワーク set to なし) 大と小 takes the 衝撃 punch-in too;
7. arrive on a **hard cut** (no transition softens the hit);
8. keep the **words the subject**: at most one decoration and one screen effect (plus the 見せ場 effect when the line
   is also 見せ場);
9. be preceded by **quieter cuts** unless 「キメの前を静かにする」 is off;
10. **not flash or shake** unless it is also 見せ場: no 閃光/反転 screen effect on it, no white flash transition out of it
    (unless the next line is 見せ場), and the 押印 and 衝撃 shakes are 0.

**Where.**

- **③ 見た目 › 行 › 文字の記号**: a toggle **「キメ」** right under 「見せ場（!）」, with the note `fld.kime.note`.
  Under it, only when the work has at least one キメ line: 「この作品のキメ: n行」; when n exceeds the guideline, a
  second line 「キメが多すぎると、どれも目立たなくなります（目安は{max}行まで）」. When this line is キメ and other lines
  sing the same words without the mark, a link button 「同じ歌詞の行（n行）もキメにする」. When this line is キメ but too
  long for one cut: 「この行は長いので、カットは分けたまま「…」を大胆に見せます」.
- **③ 見た目 › 複数行** (several lines selected): the same toggle next to the existing 見せ場 toggle, tri-state (混在)
  when the selection is mixed.
- **③ 見た目 › 作品全体 › 見た目 › 詳しい設定**: toggle **「キメの前を静かにする」** (on unless the user turns it off),
  with a note.
- **① 歌詞**: the gutter shows a small 「キ」 badge on キメ lines (click selects the line, as every gutter entry does).
  On a キメ line that plays as one cut, its `/` marks are drawn dimmed (they have no effect there). The 記法 list gains
  a row 「キメ」 — 「一行を大胆に見せる印（見た目 › 行 で付けます）」.
- **なぜ** (inspector why line) on every value a キメ decided, e.g. 構図: 「キメの行なので、大胆な見せ方から選んだ」,
  抜け: 「キメの行は最後まで見せて、すぱっと切る」, the cut before: 「次のキメを引き立てるため控えめに」 (M3.6).
- **Pins on former pieces**: when marking a line joins its pieces into one cut, pins that were set on a piece show in
  the existing list 「別の固定に隠れている固定があります」 (作品全体 › その他) with 削除 / 付け直す; they apply again
  when the mark is removed.

**Defaults.** No line is キメ until the user marks it. 「キメの前を静かにする」 is on (it only acts next to a キメ line).
「すべての固定を外す」 and 「この行の固定を外す」 keep the キメ marks and the 「キメの前を静かにする」 setting (they are
settings, not look choices); 「AIの固定を外す」 removes marks the AI set.

---

## M3.2 Gating and defaults

- **Absent pin = off, by construction.** The planner reads `line/<id>:kime` (line rank only). A document without such a
  pin plans exactly as today: no line has `kime`, no cut has `feat.kime` or `feat.calm`, every キメ code path is behind
  `line.kime` / `cut.kime` / `feat.calm` checks (and `cuts.some(c => c.kime)` for the calm pass), and the stage-1 pass
  returns the same `lines` array when no line pin exists (`ctx.ix.line.size === 0`). Prototype: 264 documents (the
  240 of `plan_hashes.json`, plus `v21`, `media`, `repeat` × 4 seeds × 2 aspects) give identical plan hashes (A.2).
- **Existing documents, imports and older builds.** Nothing in an existing document, a text/LRC/SRT import
  (`project_io` `lyrics.set`) or a package import can create a `kime` pin, so none of them changes. The lyric text is
  never reinterpreted (revision 1's leading-`!` grammar is dropped). An older build opening a document with `kime`
  pins ignores them silently (unknown slots are never resolved, as P1 notes for its own slots).
- **New documents.** Nothing is written by `D.newDoc()` / `newWorkDoc()` (P1/P2): the feature is a per-line mark the
  user sets, which is the explicit switch the lead's rule asks for (the UI switch is the 行 toggle). P3 needs neither
  `look.gen` nor a new-document entry. The sample lyrics (`SAMPLE_JA/EN`, `tests/fixtures/sample_lyrics.txt`) stay
  unchanged.
- **`work:kime.calm`** (bool, work scope only): absent = on. It is read only when the plan has a キメ cut, so it can
  never change a document without marks. Off = `pin.set work:kime.calm false`; on = `pin.clear`.
- **Unpin-all** (`pin.clearUnder` without `by`, used by 「すべての固定を外す」, 「この行の固定を外す」 and
  `pin.clearSelection`): keeps `kime` and `kime.calm` pins, like lock pins. With `by: 'ai'` (「AIの固定を外す」) the `by`
  filter decides as today, so AI-set marks go. This is P3's own change (M3.5 core/commands); it merges with P1's
  `SETTING_SLOTS` if that lands (same set, same rule).
- **AI**: nothing required.

---

## M3.3 Data model

**Pins.**

| slot | spec (`planner/cast SLOT_SPECS`) | scopes | meaning |
|---|---|---|---|
| `kime` | `{ type: 'bool' }` | line only | this line is a キメ line; only `true` acts (`false` = absent) |
| `kime.calm` | `{ type: 'bool' }` | work only | 「キメの前を静かにする」; absent = on |

- Paths: `line/r12:kime`, `line/r12.1:kime` (a later occurrence of a multi-stamp row is its own line, like every
  line pin), `work:kime.calm`. `core/paths` accepts both names today (`NAME_SLOT`).
- `core/commands checkSlotScope`: `kime` is refused at cut and work scope ("kime can be pinned only for a line"),
  `kime.calm` outside work scope ("kime.calm can be pinned only for the whole video"). `pinPromote` refuses both
  (`kime` never moves to work). `pinCopy` (見た目の貼り付け) never copies them (`copyable` is false for them: no part,
  not in `TEXT_SLOTS`/`COPY_SLOTS`).
- `core/reconcile` already drops line pins of vanished lines and keeps them across text edits of the same row id, so
  a mark follows its row.
- Lock: `lockPayload` writes cut pins for automatic and rule decisions; it never writes `kime` (a pin, not a decision).
  A locked キメ line keeps its frozen look even if the mark is later removed (lock semantics).

**Line** (planner-internal, stage 1): `planner/plan withKimePins` returns `Object.assign({}, line, { kime: true })`
for a marked line, exactly as `withLangPins` sets `lang`. `core/lyrics` is untouched; `core/types` notes the optional
planner-set `kime?: true` on the timed line. `plan.lines` (the Plan's line rows) do not print it.

**Cut skeleton** (`planner/segment`, not part of the Plan): `kime: boolean` on every cut (special cuts `false`), `true`
only on the キメ cut of a キメ line. `splitFrom: 'kime'` for a line kept whole by the rule.

**Features** (`planner/features cutFeatures`, printed in the Plan's `cut.feat`, so they reach `cut.fp` and the plan
hash): two optional keys, present **only where set**, inserted in sorted key order (`beat, calm?, cells, …, impact,
kime?, latin, …`) so `encode.asIs` keeps printing natively and every other cut keeps its bytes:

- `kime: true` on the キメ cut;
- `calm: 1 | 2` on the cuts before a キメ cut (M3.4 d).

**Decisions.** No new decision slot. Everything a キメ decides is an ordinary decision of an existing slot:
`from: 'auto'` for restricted picks (the chooser picked inside the キメ set), `from: 'rule'` for forced values, and
`pfrom[name] = 'rule'` for parameters set by rule (the value today's consumers understand: `camera.applySpeed` skips
it, `lockPayload` does not freeze it, `copyParams` re-derives it). `lockPayload` locks the decisions like any other
(`isAuto` includes `'rule'`).

**No migration, no schema bump.**

---

## M3.4 Algorithm

All constants live in a new pure module `planner/kime` (deps: `core/num`, `core/pins`; layer L2, so `planner/choose`,
`planner/cast`, `planner/camera`, `planner/extreme`, `planner/tracks`, `planner/segment`, `planner/plan`,
`planner/explain` may import it without cycles; it must not import any of them). `core/timing` keeps its own constant
(core cannot import planner).

```js
// planner/kime
KIME = {
  cellsCap: 30,                         // one cut up to maxCells(aspect) = min(cellsCap, 2 · SG.BASE[aspect])
  tail: 1.5, keep: 3,                   // s: hold into a following interlude / outro, which keeps ≥ keep s
  arrange: ['edgeBleed', 'giantWhisper'], bleedCells: [2, 12], bigOnly: ['giantWhisper'],
  arrive: ['stampPress', 'zoomSettle'],
  arriveMax: { stampPress: { dur: 0.4, each: 0.1 }, zoomSettle: { dur: 0.4, each: 0.03 } },
  landBy: 0.8,                          // s: dur + (units − 1) · each ≤ landBy
  dwell: ['stillHold'], dwellBeats: ['stillHold', 'thumpSwell'],
  lensKick: ['impactKick'],
  shots: { plain: ['snapZoom', 'pushWord', 'settle', 'none'], emph: ['pushWord', 'settle', 'none'] },
  xshots: ['crashZoom', 'punchHit'],
  face: 'display', scalePinned: 1.3, scaleFloor: 1,
  ornMax: 1, filterMax: 1,
  bleed: { overflow: 1.08, anchor: 'center' },
  giant: { ratioMin: 3, tuck: 'under' },
  params: ['dur', 'each', 'shake', 'overflow', 'anchor', 'ratio', 'tuck'],   // explain: rule kime.param
  manyMin: 3, manyShare: 0.15,          // UI guideline: max(3, ceil(0.15 · lyric lines))
}
CALM = {
  cuts: 2, span: 4,                     // at most 2 cuts, starting within 4 s before the キメ cut's t0
  ornMax: [∞, 1, 0], filterMax: [∞, 1, 0],        // by level
  strong: [1, 0.5, 0.15], soft: [1, 1.5, 2.5],     // chooser factors by level
  scale: [1, 0.97, 0.94],
  lensDeny: ['shake', 'beat'],                     // level 2
  shots: ['none', 'settle', 'driftOff', 'wideHold'],   // level 2
  xstrong: 0.2,                                    // level 2, EXTREME presets tagged hard or fast
}
STRONG_TAGS = ['fast', 'hard', 'bold', 'busy'];  SOFT_TAGS = ['soft', 'slow', 'minimal', 'airy']
isKime(cut) = cut.kime === true || !!(cut.feat && cut.feat.kime)     // the one accessor (M3.4 k)
core/timing: KIME_HOLD = 0.6
```

### (a) The mark (`planner/plan`, stage 1)

```
withKimePins(ctx, lines):
  if ctx.ix.line.size === 0: return lines                       // no line pin at all: the same array
  return lines.map(line =>
    pin = PA.resolvePin(ctx.ix, { pinCutKey: null, lineId: line.id, cutKey: null }, 'kime',
            (v, rank) => rank !== 'pin:line' ? { na: true } : typeof v === 'boolean' ? { v } : { bad: true }, ctx.warn)
    pin && pin.v === true ? Object.assign({}, line, { kime: true }) : line)
run: const lines = withKimePins(ctx, withLangPins(ctx, parsed))  // before timeLines (the hold reads line.kime)
```

A non-boolean value gives the existing `pin-bad-value` warning and counts as absent. The cast cache already keys on
the cut's line pins (`castInputs` reads `k.pins(k.line, 'line', cut.line)`), so a toggle re-casts that line's cuts.

### (b) One cut (`planner/segment`)

```
kimeMaxCells(aspect) = min(KIME.cellsCap, 2 · (BASE[aspect] || BASE['16:9']))
   // 16:9 28 · 21:9 30 · 4:3 24 · 1:1 20 · 4:5 20 · 3:4 18 · 9:16 16
piecesOf(ctx, line, spanEnd):
  split pin (user or lock) → as today                                   // a pin wins
  if line.kime and S.cells(line.text) ≤ kimeMaxCells(ctx.aspect): return { starts: [0], from: 'kime', focus: null }
  … as today ('/' marks, else the auto cutter) …
cutsOfLine:
  att = attach(ctx, line, starts)
  if pieces.from === 'kime': kimeAttach(ctx, line, att)                 // before the orphan/shadowed reports
  kimeAt = !line.kime ? −1
         : pieces.focus !== null and starts includes pieces.focus ? index of pieces.focus
         : starts.length − 1                                            // a long or pinned split: focus piece, else last
  each cut gets kime: i === kimeAt

kimeAttach(ctx, line, att):          // the one cut keeps only pins made for the whole line
  inside(k) = cutOffset(k) < line.text.length
  move att.orphans.filter(inside) → att.shadowed                        // former piece keys left pending
  key = line.id + '~0'; owner = att.map[key]
  if owner and (owner !== key or some pin under owner has a sig ≠ pieceText(line.text, 0, len)):
    delete att.map[key]; att.shadowed.push(owner)
```

The existing reports then emit `shadowed-pin` for every former piece pin (an existing code with existing strings,
listed by the inspector with 削除 / 付け直す; 付け直す rewrites the pins onto the キメ cut with its sig). A pin set on the
キメ cut itself (sig = the whole line) attaches normally. When the mark is removed, the pieces return and their pins
reattach as before (they were never deleted). Lock pins are not affected: a locked line has a `split` lock pin, so
`pieces.from` is never `'kime'` there. Roles are unchanged (`lyric`, or `focus` when the piece is fully emphasized), so
camera `ROLE_BITS` and EXTREME `ROLE_POOLS` keep their meaning. `impact` stays on the line's last piece as today.

### (c) Hold (`core/timing`, `planner/segment`)

- `solveTimes`: `read[i] = max(MIN_READ, morae · spm) + (line.kime ? KIME_HOLD : 0)`. Only automatic starts move (the
  gap before the next line grows by 0.6 s; between anchors the キメ line takes a larger share). Anchored lines (LRC
  stamps, tap, start pins) do not move. In `src/`, `solveTimes` has no caller besides `planner/plan`;
  `tests/node/timing.test.js` and `ai_song.test.js` call it directly with lines that have no `kime` (unchanged).
- Gap and outro (`cutAll`), when the line's last cut is the キメ cut:

  ```
  interlude: hold = clamp(min(KIME.tail, (next.t0 − line.t1) − KIME.keep), 0, KIME.tail); gap cut starts at line.t1 + hold
  outro:     hold = clamp(min(KIME.tail, (duration − last.t1) − KIME.keep), 0, KIME.tail); outro starts at last.t1 + hold
  ```

  Interludes exist only for gaps > max(`GAP_MIN` 2.8, a bar) and the outro only for room ≥ `OUTRO_ROOM` 3, so a gap of
  < 3 s gets no hold, a 4 s gap 1 s, ≥ 4.5 s the full 1.5 s; the special cut keeps ≥ 3 s, which is also
  `MEDIA_MIN_SEGMENT` (a background segment of the user's media is never pushed under it by the hold).
- `windows`: a キメ cut followed by a special cut that starts after its `t1` ends at `next.t0 + tail` (it stays up
  until the special cut starts), where other cuts end at `t1 + tail`.
- Motion: the exit is instant (e) and the entrance lands within 0.8 s, so the text stands still for the rest.

### (d) Calm levels (`planner/plan` stage 4, before features)

```
calmLevels(ctx, cuts):
  if no cut has kime: return null
  if work:kime.calm resolves to false: return null
  level = zeros(cuts.length)
  for each キメ cut j:
    for i = j−1 down to 0 while j − i ≤ CALM.cuts:
      c = cuts[i]
      stop if c.kime or c.line === null (special cut) or cuts[j].t0 − c.t0 > CALM.span
      level[i] = max(level[i], j − i === 1 ? 2 : 1)
  return level
feat.calm = level[i] || absent;  featuresOf memo key += [cut.kime ? 1 : 0, fx.calm || 0]
```

A キメ cut is never calmed (two キメ lines in a row both stay bold). The pieces of a split キメ line before its キメ cut
are calmed like any other cut.

### (e) The キメ cut (`planner/cast`, in the FROZEN slot order)

Every row applies only when the slot is not pinned (pins and locks win) and is decided in every pass (the view, the
lock-free view, the natural pass, the salt-free re-cast), because it is a fact of the cut.

**Set restriction, registry-safe** (`KI.rule(st, kind)` → `{ only } | { limited: true } | { force } | null`):

```
pool(kind) = poolEntry(ctx, kind, poolIdOf(st), cut.role, st.chosen.orient, cut.feat.script, ctx.aspect, null, st.cond).keys
             // the cut's own stage-0 pool, cached: registry presence, role, orientation, script and aspect traits,
             // the user's part filters, amount gates, the season and the line's avoid list are already applied
valid(kind, keys) = keys.filter(k => pool(kind).includes(k))
restrict(kind, keys) = (only = valid(kind, keys)).length ? { only } : { limited: true }
```

In `decidePart`: `km = !pin && !o.force && cut.kime && !list ? KI.rule(st, kind) : null`. `{ force }` takes the
existing rule path (`o.force`, `from: 'rule'`). `{ only }` is passed to `chooseAuto` as `req.only`; if the chooser's
answer is not in `only` (every member weighed 0 in all three stages, so it fell to the kind's fallback), the decision
is `{ v: only[0], from: 'rule' }` — a key of the cut's own pool, so it exists, serves the cut and passes the user's
filters. `{ limited }`
runs the normal chooser and traces `kimeLimited` (why `kime.limited`). No literal part key is ever forced: with a
registry that lacks the キメ parts (the stub or synthetic registries of the tests) the cut is planned normally.

| slot | rule |
|---|---|
| `repeat.same`, `orient`, `text.ink`, `text.style`, `motion.speed`, `ornament#i`, `cam.zoom`, `cam.follow` | unchanged |
| `arrange` | `restrict(arrange, 2 ≤ feat.cells ≤ 12 ? KIME.arrange : KIME.bigOnly)`. Params by rule (pfrom `'rule'`, only where not pinned): `edgeBleed` `overflow = 1.08` (a fixed value: the auto range is 1.15–1.45), `anchor = 'center'`; `giantWhisper` `ratio = max(auto, 3)`, `tuck = 'under'` |
| `text.face` | `'display'`, from `'rule'` (rule `kime.face`) |
| `text.scale` | `edgeBleed` → 1.0 (rule `kime.full`: its overflow cap holds only at ×1); `giantWhisper` → `max(auto, 1)`, from `'rule'` (rule `kime.full`) only when that raised it, else the auto; any other layout (a pinned or `kime.limited` one) → 1.3, rule `kime.scale` |
| `arrive` | `restrict(arrive, KIME.arrive)` (歌ハメ: (l)). After `applySpeed`, where not pinned: `dur = min(dur, 0.4)`; `each = floor₀.₀₀₅(min(each, arriveMax[v].each, (landBy − dur) / (units − 1)))` with `units = feat.units[def.unit ∥ 'glyph']` (words for 押印, glyphs for 寄せ); `stampPress.shake = 0` unless the cut is impact |
| `dwell` | `restrict(dwell, ctx.bpm ? KIME.dwellBeats : KIME.dwell)` |
| `depart` | `registry.fallback('depart')` (`instantHide`, `pool: false`) from `'rule'` (rule `kime.depart`); the same force path as `motion-own` |
| `ornament.count` | `min(auto, 1)`; from `'rule'` (rule `kime.count`) when it lowered the value; a part pinned on slot i still raises it (rule `index`) |
| `lens` | `moves(st)` → `registry.fallback('lens')` (`fixedFrame`) from `'rule'` (rule `kime.lens`); else `restrict(lens, KIME.lensKick)` and, if limited, the fallback from `'rule'`. `impactKick.shake = 0` unless impact |
| `filter.count` | `min(base, 1) + (impact && flash > 0 ? 1 : 0)`; from `'rule'` (rule `kime.count`) when it lowered the value |
| `filter#i` | on a キメ cut **without impact**, `req.only = noFlash` (keys whose def has no `gate: 'flash'`; memoized per registry, id `kime.noFlash`); a pinned filter wins |
| `cam.shot` | after the existing rules (camera amount < 0.1 → `none`; layout `cam: 'none'` → `none`): forced, rule `kime.shot`: the first of `KIME.shots[feat.emph ? 'emph' : 'plain']` the cut's pool bits allow (short cut → `settle`; gentle layout → `settle`) |
| `cam.curve` | the impact curves (`dashStop` 3 : `holdThenDash` 2), as for `feat.impact` |

```
moves(st):                                  // will the camera move on this cut? (the lens is decided before the shot)
  pin = PINS.lookup(ctx.ix, st.at, 'cam.shot')
  if pin: return pin.v !== 'none'
  arrange = reg.get('arrange', st.chosen.arrange)
  if XT.valueAt(ctx.ix, st.at) > 0 and arrange.cam !== 'none': return true    // EXTREME replaces the shot (g)
  return CAM.kimeShot(st) !== 'none'        // the value shotRules will force: none-camera, arrange none, or KIME.shots
```

`CAM.kimeShot(st)` is the function `shotRules` itself uses for キメ cuts, so the lens and the shot always agree:
**the final shot is `none` exactly when the lens is the 衝撃 punch-in** (on registries that have `impactKick`).
`planner/cast` imports `planner/extreme` for `valueAt` (no cycle: `planner/extreme` imports neither cast nor camera).

Why these choices:

- `edgeBleed` is capped at 12 cells by its own trait (`traits.cells [1, 12]`) and at 1.08 overflow: at 12 cells on
  16:9 the bleed takes two lines of ≈ 358 du and crops ≈ 77 du per side (about a fifth of the edge glyph), which reads;
  the auto overflow (1.15–1.45) crops up to a whole glyph. `anchor: 'center'` keeps the crop symmetric and makes P2's
  direction flips skip it. Single-cell lines go to `giantWhisper` (a one-glyph bleed crops the glyph top and bottom).
- `giantWhisper`: the giant is the emphasized word, else the longest word. Its size is
  `min(room/cells, 0.46 · safe, 0.42 · short · max(1, scale)) · min(1, scale)` (`parts/arrange/core.js giantBuild`),
  so a scale above 1 rarely shows (only for 1-cell giants in tall frames) but a scale below 1 always shrinks it: the
  floor at 1.0 is what keeps a キメ big under quiet moods (auto scale is 0.9–1.1 with energy). `tuck: 'under'` gives
  the giant the full width: measured with the fake measurer (A.6), 4-cell giants in 9:16 horizontal are 0.211 of the
  short side under vs 0.135 beside. Its trait range `cells [2, 30]` is soft (`choose.rangeFit`, `FIT_FLOOR`): a 1-cell
  line and a > 30-cell piece (only reachable through a user split pin) still get it, through the reduced fit.
- Camera pairing. `edgeBleed` has `cam: 'none'` (a moving camera would reveal or lose the bleed), so the shot is
  `none` and the hit is the 衝撃 punch-in (6–12 % at the sung start). `giantWhisper` allows camera moves; `snapZoom`
  on a line without emphasis aims at the whole block (`engine/scene/shot aimBox`), so every word stays in frame
  (`shot_engine` "every word of a plain line stays on-frame"); with an emphasis the giant *is* the emphasized word, and
  `pushWord` goes to it when it is sung. When the shot moves, the lens is the fixed frame so the camera has one idea;
  when it cannot, the punch-in keeps the hit. The lens `amount` follows `amount.camera` in [0.2, 0.8] (shared lens
  param), so the punch-in stays visible at camera 0 (×0.7).
- `instantHide` + a fast landing give the longest still hold inside the window. A transition out of the キメ cut is
  still possible (the seam into the next cut), which replaces the exit as today (never a flash one, (g)).
- Counts: one accent decoration and one screen effect keep the video's texture without covering the words.

### (f) The calm cuts (`planner/cast`, `planner/choose`, `planner/camera`)

Only automatic values; pins, locks and 「くり返しの行をそろえる」 copies are not calmed (an aligned copy keeps its source's
decisions, which is M1's promise).

| slot | level 1 | level 2 |
|---|---|---|
| `ornament.count` | `min(auto, 1)` | 0 |
| `filter.count` | `min(base, 1)` + impact extra | 0 + impact extra |
| `arrive`, `dwell`, `depart`, `lens` (chooser factor `calm`) | strong ×0.5, soft ×1.5 | strong ×0.15, soft ×2.5 |
| `lens` pool | — | families `shake`, `beat` removed (`req.only` predicate, id `calm2`; kept when that empties the pool) |
| `cam.shot` | — | pool bits ∩ `CALM.shots` (when that leaves a key) |
| `text.scale` (auto) | × 0.97 | × 0.94 |
| EXTREME pick | — | presets tagged `hard` or `fast` × 0.2 |

`calmFactor(def, traits, level)`: *strong* = `traits.impact` or a tag in `STRONG_TAGS`; *soft* = a tag in `SOFT_TAGS`;
strong and not soft → `CALM.strong[level]`; soft and not strong → `CALM.soft[level]`; else 1. It multiplies the
candidate's weight in `choose.preWeight` (after the echo factor; traced as `f.calm`). Counts lowered by the calm carry
`from: 'rule'`, rule `kime.calm`. Impulses are never removed (見せ場 stays as is).

### (g) Stage 6

- **Seam into a キメ cut** (`planner/tracks decideSeam`): unless pinned, the hard cut, `from: 'rule'`, trace rule
  `kime.seam`, before the chance roll. An aligned copy of a キメ source is also a キメ cut and gets the same.
- **Seam out of a キメ cut** (the seam into B when A is a キメ cut): when `A.kime && !A.impact && !B.impact`, the seam
  chooser gets `req.only = noFlashSeam` (seam defs without `gate: 'flash'`, i.e. no 白く飛ぶ; memoized per registry, id
  `kime.noFlashSeam`). The seam memo (`seamOf`, `B.cast.seam`) stores `quiet = A.kime && !A.impact && !B.impact` and
  is reused only when it matches, because A is not among B's cast inputs. A pinned seam wins. When B is a 見せ場 cut,
  its own flash is allowed.
- **Carry** (`planner/camera carry`): never into a キメ cut (the hit is a fresh framing; `continue` when `B.kime`).
- **EXTREME** (`planner/extreme pass`): at a キメ cut where the switch resolves on, the pool is not null and the shot is
  not pinned: the first of `KIME.xshots` in `rules.pool` (`crashZoom`, else `punchHit` for `SHORT_POOL`), else the
  normal argmax (every EXTREME preset moves the camera, so `moves` in (e) holds). The window row gets
  `key = nat = that preset` (like an aligned pick), mirror as `mirrorOf` (neither preset is in `MIRRORS`). Trace
  override why: `[cam.extreme, rule kime.x]`. A キメ cut with `edgeBleed` has pool `null` and keeps `none` +
  `impactKick` (explain says `cam.xStill`, as today). At level-2 calm cuts, `weigh` multiplies presets tagged `hard`
  or `fast` by `CALM.xstrong`.
- **Impulses**: unchanged. A キメ line adds none; 見せ場 adds its flash/shake/slip as today.
- **Grounds and rigs**: unchanged.

### (h) Alignment (「くり返しの行をそろえる」)

`planner/cast alignments`: a copy aligns with its source only when `!!src.kime === !!cut.kime` too (next to the
existing `impact` check). A chorus whose hook line is marked in both copies comes back the same; a copy marked only once
keeps its own look (the explicit mark wins over sameness; the same-lyric button marks all copies in one step).
`planner/camera` rule 2 of repeated lines needs nothing: a キメ cut's shot is forced before inheritance is asked.

### (i) Explain

- Restricted picks: the trace gets `kime: true` and `only`; `factorWhy` puts `{ code: 'kime' }` first; alternatives
  outside the set are masked `'kime'` (`maskOf` gets `ctx.only`), so the part browser lists only the キメ choices.
  When the set was empty (registry, role, orientation or the user's filters): `{ code: 'kime.limited' }`.
- `filter#i` on a キメ cut without impact: flash-gated alternatives masked `'kime'`, why `kime.noFlash`.
- Rule values: `{ code: 'rule', params: { rule: 'kime.face' | 'kime.scale' | 'kime.full' | 'kime.depart' |
  'kime.lens' | 'kime.shot' | 'kime.count' | 'kime.seam' | 'kime.calm' | 'kime.x' | 'kime.noFlash' } }` →
  `whyRule.<rule>` strings (`kime.noFlash` on a seam out of a キメ cut).
- Parameters with pfrom `'rule'` on a キメ cut (`explainRead`): rule `kime.param` instead of `speed` when
  `isKime(cut)` and the param is in `KIME.params`.
- Calm factors: `factorWhy` adds `{ code: 'kime.calm' }` when `f.calm ≠ 1`.
- `line/<id>:split` of a キメ line without a split pin: rule `kime.split`.
- Camera: `rulesWhy` for a forced `kime` rule → `[{ code: 'rule', params: { rule: 'kime.shot' } }]`.

### (j) UI hint (not a Plan warning)

`kimeLines = plan.lines.filter(l => l.cuts.some(k => cutOf(k).feat.kime))` (plan-derived, so stale pins do not count);
`guideline = max(KIME.manyMin, ceil(KIME.manyShare · lyric lines))`. The 行 page shows `fld.kime.count` only when
`kimeLines.length > 0`, and `fld.kime.many` when `kimeLines.length > guideline`. No Plan warning is added, so no plan
hash depends on the count.

### (k) The shared flag (contract for P2, P4, P6)

`planner/kime` exports `isKime(cut) = cut.kime === true || !!(cut.feat && cut.feat.kime)`: the skeleton flag during
stages 3–6, `feat.kime` on a Plan cut. It is the only way other packages ask "is this the キメ cut". Line-level code
that runs in stage 1–3 reads `line.kime` (set by `withKimePins`). Nobody reads the pin directly (a pin on a long line
does not make every piece a キメ cut).

### (l) 歌ハメ on a キメ line (with P6)

P6's automatic 歌ハメ is off on キメ lines (`hameAuto = gen ≥ 1 && explicit && !line.kime`, P6 S3.4). When 歌ハメ is
pinned on (line or work) for a キメ line, both apply: the arrive set is `KIME.arrive ∩ HAME_ARRIVE` when non-empty
(today `zoomSettle`; for English also `stampPress`), else `KIME.arrive`; P6's `order = 'sung'` and `dur` rule apply to
the chosen part; P3's `dur`/`each`/landing caps are **not** applied on such a cut (the sung times own the entrance
timing), while `stampPress.shake = 0` and every other キメ rule (layout, one cut, hold, camera, counts, calm, no flash)
still apply. Implementation: `KI.rule(st, 'arrive')` intersects with `st.hame ? HAME_ARRIVE(latin) : null` first, and
`KI.params` skips `dur`/`each` when `st.hame`.

---

## M3.5 Changes by module and function

**core**

- `core/timing`: `KIME_HOLD`; `solveTimes` read term (M3.4 c). Export `KIME_HOLD`.
- `core/commands`: `checkSlotScope` (`kime` line only, `kime.calm` work only, messages above); `pinPromote` refuses
  both; `pinClearUnder` keeps pins whose slot is in `SETTING_SLOTS` when `cmd.by === undefined`
  (`SETTING_SLOTS = new Set(['kime', 'kime.calm'])`, merged with P1's four slots if P1 lands first; the same rule).
- `core/types`: timed Line typedef note `kime?: true` (planner-set); CutFeatures gains optional `kime`, `calm`.
- `core/lyrics`, `core/paths`, `core/reconcile`: no change.

**planner**

- `planner/kime` (new, ~170 lines): `KIME`, `CALM`, `STRONG_TAGS`, `SOFT_TAGS`, `isKime(cut)`, `calmLevels(cuts, on)`,
  `calmFactor(def, traits, level)`, `shotFor(emph, bits, bitOf)`, `xshotFor(pool)`, `guideline(lyricLines)`,
  `landEach(each, dur, units, max)`.
- `planner/plan`: `withKimePins` (stage 1); stage 4 calls `calmLevels`; `featuresOf` memo key += `cut.kime ? 1 : 0,
  fx.calm || 0`; ctx literal += `kimePools: null`.
- `planner/segment`: `kimeMaxCells(aspect)` (exported for tests), `piecesOf` (one cut), `kimeAttach`, `cutsOfLine`
  (`kime` flag), `special` (`kime: false`), `cutAll` (hold into interlude and outro), `windows` (held end).
- `planner/features`: `cutFeatures` builds the object with optional `calm` and `kime` in key order.
- `planner/choose`: `preWeight` applies `calmFactor` when `req.calm` (trace `f.calm`); nothing else.
- `planner/cast`: `SLOT_SPECS['kime']`, `SLOT_SPECS['kime.calm']`; `chooseAuto` (`req.only` via `onlyKeys` — one
  filtered array per plan, pool array and set id in `ctx.kimePools`, so the chooser's per-pool statics cache stays warm;
  `req.calm`); `decidePart` (`KI.rule`, `noFlash` for `filter`, the `only[0]` fallback, `kimeParams`); `kimeRule`,
  `kimeParams(ctx, cut, kind, d, hame)`, `moves(st)`; `decideText` (face, scale rules, calm scale); `decideList` (キメ
  and calm caps with `from: 'rule'`); `alignments` (kime equality); trace fields `kime`, `only`, `kimeLimited`, `calm`.
  Imports `planner/kime`, `planner/extreme`.
- `planner/camera`: `kimeShot(st)` (exported); `shotRules` (calm level-2 mask; forced キメ shot via `kimeShot`);
  `rulesWhy` (`kime.shot`); `decideCamera` curve (`f.impact || f.kime`); `carry` (skip キメ).
- `planner/tracks`: `decideSeam` (hard cut into a キメ; `noFlashSeam` out of one), `seamOf` memo `quiet`.
- `planner/extreme`: `pass` (キメ pick), `weigh` (calm factor).
- `planner/explain`: `factorWhy` (`kime`, `kime.calm`, `kime.limited`, `kime.noFlash`), `maskOf` (`kime`),
  `maskContext` (`only`), `explainRead` (`kime.param`, `kime.split`).
- `planner/fields`: `valueAt` for `kime` (line pin ?? `false`) and `kime.calm` (work pin ?? `true`).

**ui**

- `ui/fields`: `LINE_NAMES += 'kime'`, `WORK_NAMES += 'kime.calm'`. 行 › `marks`: `F({ path: 'kime', scopes: LINE,
  widget: 'toggle', label: 'fld.kime', spec: { type: 'bool' }, note: 'fld.kime.note', offClears: true, noDice: true })`
  right after `fld.impact`, followed by the custom row `kimeInfo`. 作品全体 › `look`: `F({ path: 'kime.calm', scopes:
  WORK, widget: 'toggle', label: 'fld.kimeCalm', spec: { type: 'bool' }, note: 'fld.kimeCalm.note', onClears: true,
  noDice: true, basic: false })`. New field flag `onClears` (a default-on toggle whose on is 自動: turning it on clears
  the pin; `valueFor`: `if (field.onClears && v) return W.AUTO`), documented next to `offClears`.
- `ui/inspector`: `shift` custom (multi-line page) adds `{ key: 'kime', widget: 'toggle', path: 'kime', spec: { type:
  'bool' }, offClears: true, noDice: true, label: 'fld.kime', id: 'lines/shift/kime' }` after the impact row (path
  fields already write one pin per selected line in one `run` batch and show the mixed state); `valueFor` handles
  `onClears`; custom `kimeInfo(ctx)`: the count (only when > 0), the many line, the long-line line (`fld.kime.split`,
  when the line is キメ and has > 1 cut; `{text}` = the キメ cut's text), and the same-lyric button: plan lines with the
  same `text` whose `line/<id>:kime` is not true → one `run(cmds)` batch of `pin.set line/<id>:kime true`, labelled
  `undo.kimeSame`.
- `ui/lyric_editor`: `fillEntry` adds `h('span', { class: 'g-kime', title: t('fld.kime'), text: t('lyr.kimeBadge') })`
  when `doc.pins['line/' + row.id + ':kime']` is true; `pinCounts` skips paths ending in `:kime` (the badge shows it);
  `segments(src, opts)` gives `/` the class `tok-cutOff` when `opts.cutOff`; `inkRows` passes `cutOff` for rows whose
  plan line has exactly one cut and that cut has `feat.kime`; `TOKENS += 'tok-cutOff'`.
- `ui/style.css`: `.g-kime` (accent badge like `.g-lock`), `.le-row::highlight(tok-cutOff)` (muted, like a comment).
- `ui/step_lyrics`: `SYNTAX += 'syn.kime'` after `syn.impact`.
- `ui/boot` / `ui/inspector` unpin-all paths need no change (the command keeps the settings).

**ai (optional path; nothing depends on it)**

- `ai/looks`: proposal line field `kime: 'on'|'off'|''` (at most one `on` per proposal; extra ones dropped with a
  warning), one prompt sentence in `proposalsRequest` (English prompt text in code: "kime: at most one line per
  proposal, the punchline; it is shown boldly in one cut and never flashes"), mapped to a `value` change
  `{ kind: 'value', path: 'line/<id>:kime', to: true | null, label: ['ai.ch.kime.on' | 'ai.ch.kime.off', { n }] }`
  (applied by `pinCmd` as `pin.set … by: 'ai'` / `pin.clear`).
- `ai/lyricio`, `ai/changes` lyric kinds: no change (the mark is not in the lyrics).

**engine, parts, export**: no change.

**Undo.** Toggle = one `pin.set` / `pin.clear` (multi-line and same-lyric = one batch); `kime.calm` = one `pin.set` /
`pin.clear`.

---

## M3.6 Strings (`src/i18n/strings.js`, [ja, en])

The en name is "Kime" (romanized, as P2's notes expect).

| key | ja | en |
|---|---|---|
| `fld.kime` | キメ | Kime |
| `fld.kime.note` | この行を1カットで大胆に見せます。大きな構図・見出しの書体・強い入り・長めの止めで、直前のカットは静かにします。見せ場（!）と違って光や揺れは加えません（両方つけることもできます）。/ で分けていても1カットで見せます（長すぎる行は分けたまま、一番大事なカットを大胆にします）。 | Shows this line boldly in one cut: a big layout, the heading face, a strong entrance and a longer hold, with the cuts before it kept quiet. Unlike Impact (!) it adds no flash or shake (a line can have both). It plays as one cut even with / marks (a very long line keeps its cuts and makes its key cut bold). |
| `fld.kime.count` | この作品のキメ: {n}行 | Kime lines in this video: {n} |
| `fld.kime.many` | キメが多すぎると、どれも目立たなくなります（目安は{max}行まで） | With too many kime lines none stands out (about {max} at most) |
| `fld.kime.same` | 同じ歌詞の行（{n}行）もキメにする | Make the same lyric a kime line too ({n} lines) |
| `fld.kime.split` | この行は長いので、カットは分けたまま「{text}」を大胆に見せます | This line is long, so it keeps its cuts and shows “{text}” boldly |
| `fld.kimeCalm` | キメの前を静かにする | Quiet cuts before a kime |
| `fld.kimeCalm.note` | キメの直前の1〜2カットの飾り・画面効果・動きを控えめにして、キメを引き立てます。 | Keeps decorations, screen effects and motion down on the one or two cuts before a kime line, so it stands out. |
| `lyr.kimeBadge` | キ | K |
| `syn.kime.mark` | キメ | Kime |
| `syn.kime` | 一行を大胆に見せる印（見た目 › 行 で付けます） | Shows one line boldly (set it in Look › Line) |
| `undo.kimeSame` | 同じ歌詞の行をキメに（{n}行） | Kime on the same lyric ({n} lines) |
| `why.kime` | キメの行なので、大胆な見せ方から選んだ | A kime line, so picked from the bold choices |
| `why.kime.calm` | 次のキメを引き立てるため、静かな見せ方を多めに | Quieter choices, so the next kime stands out |
| `why.kime.limited` | 使える部品の設定でキメ用の部品が使えないため、いつもどおりに選んだ | The part settings leave no kime choice here, so picked as usual |
| `why.kime.noFlash` | キメの行は光らせない（見せ場の行だけが光ります） | A kime line does not flash (only Impact lines do) |
| `whyRule.kime.face` | キメの行は見出しの書体 | A kime line uses the heading face |
| `whyRule.kime.scale` | キメの行は大きく | A kime line is set large |
| `whyRule.kime.full` | キメの行は構図いっぱいの大きさ | A kime line fills its layout |
| `whyRule.kime.depart` | キメの行は最後まで見せて、すぱっと切る | A kime line holds to the end and cuts out |
| `whyRule.kime.lens` | キメの構図とカメラワークに合わせたカメラ | Camera matched to the kime layout and camerawork |
| `whyRule.kime.shot` | キメの構図に合わせて寄る | The camera moves in to match the kime layout |
| `whyRule.kime.count` | キメの行は文字が主役なので、飾りを控えめに | Words first on a kime line, so fewer extras |
| `whyRule.kime.seam` | キメの行へは切り替えなしで一気に | Straight cut into a kime line |
| `whyRule.kime.split` | キメの行は1カットで見せる | A kime line plays in one cut |
| `whyRule.kime.param` | キメの行なので素早く・読みやすく | Fast and readable for a kime line |
| `whyRule.kime.calm` | 次のキメを引き立てるため控えめに | Kept down so the next kime stands out |
| `whyRule.kime.x` | キメの行なので一番強い動き | The strongest move for a kime line |
| `whyRule.kime.noFlash` | キメの行からは光らずに切り替える | No flash on the way out of a kime line |
| `ai.ch.kime.on` | {n}行 · キメにする | Line {n} · make it a kime line |
| `ai.ch.kime.off` | {n}行 · キメをやめる | Line {n} · no longer a kime line |

`why.*` codes added to the i18n test's `WHY_CODES`: `kime`, `kime.calm`, `kime.limited`, `kime.noFlash`. Placeholders
match between ja and en. No en string contains Japanese (`{text}` is the user's lyric, a placeholder).

---

## M3.7 Tests

**New `tests/node/kime.test.js`** (the Appendix A probes are its starting point; every lyric line in it is invented):

1. **Pin reading**: `line/r2:kime` true → the line and its cut are キメ; `false`, `'yes'`, `1` → not キメ (`'yes'` and
   `1` warn `pin-bad-value`); `work:kime` and `cut/r2~0:kime` are refused by `core/commands` and, if present in a
   document, ignored by the planner. `line/r5.1:kime` marks only that occurrence.
2. **Gating**: no fixture, sample or golden document has a `kime` or `kime.calm` pin; for `corpus()` and
   `v21/media/repeat`, the plans have no `feat.kime`, no `feat.calm`, no decision with a `kime*` rule (a traced run of
   each slot of 20 cuts), and hashes equal `plan_hashes.json` (the existing golden test also covers it). A
   `work:kime.calm = false` pin alone changes no plan hash.
3. **Registries without the キメ parts** (the blocker of revision 1): the same marked documents planned with
   `corpus.stubRegistry(MV)` and with `planner_pins.test.js`'s synthetic registry never throw; the キメ cut's arrange,
   arrive, dwell come from the normal chooser (`kimeLimited` traced), depart and lens are the registry fallbacks, and
   `explain` gives `kime.limited`. Also a catalog document with `filters.arrange.only = ['centerAnchor']`: arrange
   `centerAnchor` (not forced), `text.scale` 1.3 (rule `kime.scale`). Mutation: force `'giantWhisper'` literally →
   throws.
4. **Guarantees** (corpus 3 seeds × {16:9, 9:16} × basic/long/lrc/vertical × 8 moods, every 4th lyric line pinned
   キメ): for every キメ cut whose slot is not pinned or locked: arrange ∈ set (`edgeBleed` only for 2 ≤ cells ≤ 12),
   `edgeBleed.overflow === 1.08` and `anchor 'center'`, `giantWhisper.ratio ≥ 3` and `tuck 'under'`; face `display`;
   `text.scale` 1 on `edgeBleed`, ≥ 1 on `giantWhisper`; arrive ∈ set with `dur ≤ 0.4` and
   `dur + (units − 1) · each ≤ 0.8`; dwell ∈ set; depart `instantHide`; ornament ≤ 1; filter ≤ 1 + impact extra; hard
   cut in; `cam.curve` ∈ {dashStop, holdThenDash} when the shot moves; **lens/shot invariant**: `lens === 'impactKick'`
   exactly when the final `cam.shot` is `none`; a キメ line ≤ `kimeMaxCells` without a split pin is one cut.
   Mutations: remove the arrange restriction, the depart force, the count caps, the landing cap or the shot rule →
   each fails.
5. **No flash, no shake**: in the same corpus, no `filter#i` with `gate === 'flash'` on a non-impact キメ cut; the seam
   out of a non-impact キメ cut into a non-impact cut never has `gate === 'flash'`; its `stampPress.shake` and
   `impactKick.shake` are 0; no impulse at its `t0`. Mutations: drop the filter `noFlash` (prototype revision 1: 17 of
   1632 such cuts flashed) or the seam `noFlashSeam` (17 of 800 seams out) → fails. Plus: the guarantees of 4 with
   `amount.flash = 0` and `amount.shake = 0` pinned, and under `quietHush`.
6. **Camera cases**: a `giantWhisper` キメ cut (a 1-cell line, invented) with `work:amount.camera = 0` → shot `none`,
   lens `impactKick`; with `work:cam.shot = none` → the same; default camera → shot moves, lens `fixedFrame`; EXTREME on
   (`tests/helpers/extreme_docs.js` + one mark) → `crashZoom` (short cut: `punchHit`) and `fixedFrame`; `edgeBleed` with
   EXTREME on → no EXTREME move, `impactKick`.
7. **Long lines** (invented lines of 12, 13, 16, 17, 24, 28, 29, 30, 31 and 35 cells × {16:9, 9:16} × {h, v}): one cut
   iff cells ≤ `kimeMaxCells(aspect)` (28 / 16); otherwise ≥ 2 cuts and exactly one キメ cut, the focus piece else the
   last; every キメ cut lands within 0.8 s. A user split pin that leaves a 35-cell piece: that piece is the キメ cut,
   `giantWhisper`, no throw.
8. **Pins on former pieces**: line `ゆうやけ/そらの/むこうへ` with user pins on `~0` (arrive, sig of the first piece)
   and `~4` (arrange, sig of the middle piece), then marked: one cut `~0`, arrange and arrive from the キメ sets, two
   `shadowed-pin` warnings; a pin `cut/r2~0:arrange` with the whole line as sig is kept (`pin:cut`); unmarking
   restores `~4`'s pin on its piece. Mutation: drop `kimeAttach` → the middle piece's `centerAnchor` takes the キメ cut
   (prototype revision 1).
9. **Hold**: auto-timed document: the next line's start moves by exactly 0.6 s; LRC document: no line time moves;
   interlude after a キメ line with gaps 2.9 / 3.0 / 4.0 / 5.0 s → hold 0 / 0 / 1.0 / 1.5 s; outro room 3 / 4 s →
   hold 0 / 1.0 s; the special cut always keeps ≥ 3 s; the キメ cut's `b` = special `t0` + tail.
10. **Calm**: level-2 cuts: ornament 0, filter = impact extra, shot ∈ `CALM.shots` (or a rule/pin), lens family not
    shake/beat; the share of strong entrances ≤ 0.5 × the unmarked share; level-1: ornament ≤ 1, filter ≤ 1 + extra.
    `work:kime.calm = false` → no `feat.calm`. Mutation: drop the level-2 filter cap → fails.
11. **Pins win**: a pinned `arrange` (`centerAnchor`), `depart`, `text.scale`, `cam.shot` and seam on a キメ cut stay;
    a line split pin splits (the キメ cut is the focus piece or the last); the locked line of the `vertical` fixture
    keeps its lock pins.
12. **Locality**: marking one line changes decisions only on the two calm cuts, the キメ cut and the 5 cuts after it,
    and on later copies of those cuts (echo) plus the 2 cuts after each (LRC-anchored documents).
13. **Alignment**: `repeat` fixture, hook line marked in both copies → the copy aligns and is キメ; marked only in the
    first → the copy does not align with it.
14. **Explain**: `explain()` on a キメ cut: arrange why[0] `kime`, alternatives only the set; depart `kime.depart`;
    seam `kime.seam`; a calm count `kime.calm`; a calm-weighted entrance lists `kime.calm`; `edgeBleed.overflow`
    `kime.param`; `text.scale` `kime.full` / `kime.scale`; a flash filter alternative masked with `kime.noFlash`.
15. **Determinism and cache**: two fresh runs equal; cached vs fresh equal after toggling a mark on and off (also for
    the seam memo `quiet`: mark A, then B's seam is re-decided); after a toggle, `plan.reuse.casts ≥ cuts − 8`.
16. **歌ハメ on a キメ line** (once P6 lands): `line/<id>:sung.hame = true` on a marked Japanese line → arrive
    `zoomSettle`, `order 'sung'`, P6's `dur`, no P3 `each` cap; layout, one cut, hold, camera, counts still キメ.

**New layout test** in `tests/node/arrange_dwell.test.js` (fake measurer, `sceneOf`): `giantWhisper` with the キメ
parameters (`tuck 'under'`, `ratio 3`, `text.scale 1`) on invented giants of 1–4 cells, in {16:9, 9:16, 1:1} × {h, v}:
giant em ≥ 0.40 · short for 1–2 cells, ≥ 0.27 for 3, ≥ 0.20 for 4 (measured minima 0.414 / 0.282 / 0.211, A.6).
Mutations: `text.scale 0.9` (no floor) → 1-cell 0.373 and 4-cell 0.190 fail; `tuck 'beside'` → 9:16 h 3-cell 0.180
fails.

**Updated tests**: `planner_pins.test.js` fuzz ODD list += `['line/r2:kime', true], ['line/r3:kime', true],
['line/r4:kime', 'yes'], ['line/r5:kime', true], ['work:kime', true], ['work:kime.calm', false]` (it plans with the
synthetic registry; the prototype passes 23/23); `ui_fields.test.js` (rows `fld.kime`, `fld.kimeCalm`, `onClears`,
`slotScopes('kime') = ['line']`, `slotScopes('kime.calm') = ['work']`); `i18n.test.js` (`WHY_CODES`);
`commands.test.js` (`kime` refused at cut/work, `kime.calm` refused at cut/line, `pin.promote` refused;
`pin.clearUnder work` keeps `line/r1:kime` and `work:kime.calm`, `pin.clearUnder work by 'ai'` removes an AI-set
`line/r1:kime`; mutation: drop the keep rule → fails); `ai_looks.test.js` (a `kime: 'on'` line maps to the value
change, two `on` in one proposal keep one); `ui_ai.test.js` (labels); `planner_explain.test.js` (one キメ case).
`lyrics.test.js` needs **no** change (revision 1's two key-list failures are gone with the grammar change).

**P2 contract test** (in `kime.test.js`, active once P2 lands): with P2's rules on (its new-work pins), for every キメ
cut: `ctx.pv.featOf(cut) === cut.feat` (no energy blend), `partFactor` is 1 for every candidate, `shotFactors` is
null, `countMax` does not lower its counts, `seamGate(cut)` is false, `keepImpulses(cut, l) === l`, `flipParams`
leaves its params unchanged, and the guarantees of test 4 hold. (Exact equality of the picks with P2 on vs off is not
asserted: recency against the neighbours, which P2 legitimately changes, may choose the other member of a キメ set.)

**Browser (`tests/browser/ui_flows.py`)**: select a line → 行 › 「キメ」 on → the gutter shows 「キ」, the preview's
line is one cut, 「この作品のキメ: 1行」 appears; off → the badge goes (one undo step restores it); multi-line tri-state;
the same-lyric button marks the other lines in one undo step; 「すべての固定を外す」 keeps the mark;
「キメの前を静かにする」 off/on. `i18n_pages.py`: new strings present in both pages.

---

## M3.8 Goldens

- `frame_hashes_v2.json` (FROZEN), `frame_hashes.json`, `plan_hashes.json`, `project_media.json`,
  `project_repeat.json`, `project_extreme.json`: **unchanged**. Their documents have no `kime` or `kime.calm` pin (no
  file under `tests/` or `src/` contains the word), so no line has `kime`; `withKimePins` returns the same array when
  there is no line pin and the same line objects otherwise; every new branch is behind that flag; `feat` objects gain
  no key; the new chooser inputs (`req.only`, `req.calm`) are absent on every existing call; the seam memo's `quiet` is
  always false; the timing term is `+ 0`; `encode.js`, the engine and every part are untouched. Prototype: 264/264
  plan hashes identical (A.2).
- **New golden** `tests/golden/project_kime.json`: plan hashes of `corpus(4, ['16:9', '9:16'], ['basic', 'lrc'])`
  with the 4th and 8th lyric lines pinned キメ (one of them a 見せ場 line, so one cut has both), plus one
  `work:kime.calm = false` variant, written by a new entry in `tests/update_golden.js`. It locks the behaviour.

---

## M3.9 Performance

- Documents without a mark: one `ctx.ix.line.size` test in stage 1 (documents with other line pins: one pin lookup per
  line, the same cost as `withLangPins`), one `cuts.some(c => c.kime)` per plan, one flag test per cut. Prototype on 32
  documents × 3 rounds: 19.8–21.8 ms per fresh plan vs 18.2–22.4 ms for the repository, re-plan median 5.28 vs 5.77 ms
  (run-to-run noise, A.5). `perf.py` rows (fixtures without marks) are unchanged.
- Documents with marks: the restricted pools shrink the chooser's work on キメ cuts; filtered pool arrays are memoized
  per plan (`ctx.kimePools`), the no-flash predicates per registry. Marked corpus: 16.6–20.3 ms per fresh plan,
  re-plan median 4.52 ms.
- Rendering: `edgeBleed`, `giantWhisper`, `stampPress`, `zoomSettle`, `impactKick` are existing parts with known cost;
  a キメ cut has fewer decorations and effects than average. No new render path.

---

## M3.10 Risks and open questions

- **R1 — overuse.** Many キメ lines flatten the video. Guideline shown on the 行 page (max(3, 15 % of lyric lines)); no
  hard cap (an explicit mark is the user's choice).
- **R2 — readability of はみ出し.** Capped at 12 cells and overflow 1.08; single cells go to 大と小. Vertical text uses
  the same caps. Visual QA: contact sheets of キメ cuts for the 8 moods × 3 aspects × h/v, including 17–28-cell lines
  in 16:9 and 13–16-cell lines in 9:16 (大と小 with long whispers) and at 1.08 overflow ("does it still read as
  はみ出し?"). If QA finds crops too strong at 11–12 cells, lower `bleedCells[1]` to 10; if it finds 1.08 too timid,
  raise it to 1.12.
- **R3 — 大と小 with an emphasis and `pushWord`.** The push ends on the giant word; whispers after it may leave the
  frame late in the hold (after they were sung). Accepted; QA row in the same sheets.
- **R4 — 「くり返しの行をそろえる」 copies are not calmed** when their source was not (M1 sameness wins). Accepted.
- **R5 — hold shifts automatic times.** Every automatic line after a キメ starts 0.6 s later; anchored lines do not
  move. Visible in the timeline; intended.
- **R6 — the mark is not visible in the lyric text.** It lives on the line (like 固定), shown by the gutter badge, the
  行 toggle and the 記法 row. Copying lyric text elsewhere does not carry it; re-pasting the whole text keeps it for
  rows whose ids reconcile (`core/reconcile`), as for every line pin.
- **R7 — heading faces.** Several themes' 見出し faces are light brush or rounded faces at weight 400 (earth Yomogi,
  paper Yuji Syuku, season Yuji Mai, glass Mochiy Pop One), so キメ promises the heading face, not a heavy one. With P4:
  M3.11.
- **Open (owner):** should 「同じ歌詞の行もキメにする」 become automatic under P2's 「くり返しの行をそろえる」? This design
  keeps the mark explicit per line and offers the one-click button.

---

## M3.11 Interactions with other packages

- **All packages**: the one flag is `planner/kime isKime(cut)` (M3.4 k). Line-level code in stages 1–3 reads
  `line.kime`. Nobody reads the `kime` pin directly.
- **P1 typography**: P3 writes no kumi pins. 大と小 opts out of T2 by P1's own rule; はみ出し keeps T2. The arrange set
  uses layout-free cells (`feat.cells`), which P1 does not change. `SETTING_SLOTS`: one shared set (P1's four slots +
  `kime`, `kime.calm`), one keep rule (kept by `pin.clearUnder` without `by`).
- **P2 conventions** — contract P2 implements (and the P2 contract test in M3.7 checks):
  - `ctx.pv.kimeAt(cut)` is `KI.isKime(cut)` (not a pin read, not `from: 'rule'`: P3's layout, entrance, hold and
    lens are automatic picks inside restricted pools, `from: 'auto'`).
  - On a キメ cut P2 applies nothing of its own: no arc energy blend (`featOf(cut)` returns `cut.feat`), no kit or
    lettering factor, no shot factor, no direction flip, no mirror-shot alternation; T5 never lowers its counts, never
    gates its seam and never trims its impulses (the +2 cap is then moot; P3's own caps keep the cut light). P2's
    `drive = max(drive, 0.85)` may stay for its own bookkeeping.
  - M1 `alignments`: both packages edit the same condition; the merged line is
    `src.text === cut.text && src.role === cut.role && !!src.impact === !!cut.impact && !!src.kime === !!cut.kime`.
  - M2 flips: P3's parameters carry pfrom `'rule'` (`edgeBleed.anchor 'center'`), which the flip skips anyway.
  - P2's ため before chorus heads and P3's calm levels compound on the same cut (both only calm).
  - Gating: P3 needs neither `look.gen` nor `newDoc()`.
- **P3 × EXTREME**: M3.4 g.
- **P4 glyph motion**: `P3kime(ctx, A)` is `KI.isKime(A)`; an automatic morph seam never lands into or out of a キメ
  cut (the hard-cut rule runs first into it; P4's rule skips A); a pinned morph seam wins. Weight: where P4's
  `text.weight` slot exists, P3 sets `text.weight` by rule (from `'rule'`, rule `kime.face`, lockable) to the heaviest
  weight ≥ 700 that `FACES.roomOf` reports for the cut's face, and leaves it automatic when the face has none (single-
  weight brush faces); P4's 太る (`weightGrow`) may join `KIME.arrive` as a third choice at integration only if it
  completes within 0.4 s (one table entry, one test row). Until P4 lands, nothing of this applies.
- **P5 timing**: `KIME_HOLD` sits in `core/timing.solveTimes` next to P5's changes (merge the read term); with P5's
  0.2 s lead, a `stampPress` hit (half of ≤ 0.4 s after `a = t0 − lead`) lands on the voice. S2 retap and S1 drafts do
  not touch marks (pins of their own). S4 measures a キメ line like any other; the hold lowers its speed.
- **P6 歌ハメ**: M3.4 l — P6's automatic 歌ハメ skips キメ lines (P6 reads `line.kime`, set in stage 1 before its
  `SU.prepare`); a pinned 歌ハメ (line or work) applies on a キメ line with the intersected entrance set and P6's timing,
  and every other キメ rule stays. P6's `'rule:<name>'` pfrom convention (its Q3): P3 writes plain `'rule'` now; if
  the integrator lands Q3, P3's writes become `'rule:kime'` in one mechanical change (explain then reads the name).

---

## Appendix A. Measurements (read-only probes, `scratchpad/pv22/probe/p3r/`)

The prototype (`p3r/src`, loaded by `p3r/loadp3r.js`) implements M3.4 a–h except EXTREME, explain, the UI and the
exact `moves()` lens rule (it uses the simpler "layout still, camera < 0.1 or shot pinned none" test, which agrees on
every case below): the line pin, one cut with per-aspect cap, `kimeAttach`, `feat.kime`/`feat.calm`, calm levels, the
registry-safe キメ sets and forces, parameter rules incl. the landing cap and `tuck`, counts, camera pairing, calm shot
mask, hard seam in, no-flash filters and seam out (with the memo key), hold with the 3 s keep.

- **A.1 Fixtures and parts** (`../p3/base.js`): 168 fixture lines, max 14.7 cells; 124 ≤ 12 cells. `edgeBleed`,
  `giantWhisper`, `stampPress`, `zoomSettle`, `stillHold`, `thumpSwell`, `impactKick`, `fixedFrame` are in every
  lyric pool for both orientations; `instantHide` is `pool: false`. No mood zeroes them (lowest factor 0.28).
- **A.2 Gating** (`hashes_r.js`): 264 documents: 0 plan hashes differ between the repository and the prototype;
  240/240 `plan_hashes.json` entries match. Existing tests against the prototype (`tests/*_r.test.js`): contract
  17/17, lyrics 17/17, timing 17/17, commands 23/23, camera_planner 22/22, extreme_planner 18/18, planner_explain 9/9,
  planner_determinism 22/22, planner_stability 20/20, repeat_same 14/14, fields 15/15, ui_fields 46/46, planner_pins
  with the キメ fuzz rows 23/23 (i18n: 2 failures of the probe shim's missing `listSources`, not of the prototype).
- **A.3 Guarantees** (`kime_probe_r.js`, 192 plans: 8 moods × basic/long/lrc/vertical × 3 seeds × 2 aspects, every 4th
  lyric line pinned, 1680 キメ cuts): one cut 97.1 %, big layout 97.1 % (edgeBleed 528, giantWhisper 1104), face,
  entrance, hold, exit, lens pairing, shot pairing, hard cut in, ≤ 1 decoration, ≤ 1 effect: 100 %; text.scale rule
  violations 0. All misses are the locked line of the `vertical` fixture (lock pins win). Calm level 2 (1632 cuts):
  0 decorations, 0 effects (+ impact), quiet shot: 100 %; strong entrances 12.3 % vs 39.7 % elsewhere. Level 1 (1584):
  ≤ 1 decoration 100 %.
- **A.4 Registries and flash** (`stub_r.js`, `pins_p3r.test.js`, `flash_r.js`, `seam_r.js`): stub registry — no
  throw, キメ cut `stubBlock` (auto, limited), depart/lens the fallbacks, text.scale 1.3 (`kime.scale`); catalog with
  `amount.camera = 0` or `cam.shot = none` → `giantWhisper` + `impactKick` + shot `none`. Flash filters on
  non-impact キメ cuts: 0 of 1632 (revision 1: 17). Flash seams out of キメ cuts: 5 of 800, all where A or B is a
  見せ場 cut (allowed; revision 1: 17).
- **A.5 Locality and cost** (`locality_r.js`, `locality3_r.js`, `perf_r.js`): one line pinned, 6 seeds × 2 aspects:
  basic 1/108 far cuts changed, long 0/2844, lrc 33/232 — every one of them a later copy (`repeatOf`) of a calm or
  キメ cut in the second chorus, or ≤ 2 cuts after one (echo). Fresh plan 19.8–21.8 ms (repository 18.2–22.4 ms),
  re-plan median 5.28 ms (repository 5.77), marked corpus 16.6–20.3 ms / 4.52 ms.
- **A.6 Long lines, pieces, hold, giant size** (`edge_r.js`, `hold_r.js`, `giant_r.js`): 16:9 lines ≤ 28 cells and
  9:16 lines ≤ 16 cells are one cut; longer ones split (e.g. 9:16 28 cells → 3 cuts, the 12-cell last piece is the
  キメ cut); landing ends 0.50–0.79 s after the start in every case. Piece pins → 2 `shadowed-pin`, arrange/arrive
  from the キメ sets; a whole-line pin is kept; unmarking restores the piece pins. Hold: gap 3.0 s → 0, 4.0 s → 1.0 s,
  5.0 s → 1.5 s; outro room 4 s → 1.0 s. Giant em / short side (fake measurer, `tuck`, scale 0.9 / 1.0 / 1.3):
  1–2 cells ≥ 0.414 at 1.0 in every aspect/orientation under `tuck 'under'` (0.373 at 0.9); 3 cells ≥ 0.282 (0.254);
  4 cells ≥ 0.211 (0.190); `beside` in 9:16 h: 3 cells 0.180, 4 cells 0.135; scale 1.3 differs from 1.0 only for
  1-cell giants in 9:16 h / 16:9 v (0.420 → 0.546).

## Appendix B. FROZEN contracts touched

- **§4.16.7 CutFeatures**: optional `calm` (1 | 2) and `kime` (true), present only where set.
- **Chooser formula §4.16.4**: optional `calm` factor (only on cuts with `feat.calm`) and optional pool restriction
  `only` (キメ sets, the no-flash filter and seam predicates, the level-2 lens predicate).
- Not touched: row grammar §4.9.1 and `renderRow` §4.9.2, §3.11 ParsedRow/Line, POSE columns, the seam mix contract,
  SCH enums (`tests/node/contract.test.js`, which passes against the prototype), the FROZEN slot order, the Plan shape
  (`cut` and `lines` fields), `planner/encode`, shot presets, the stream-seed names.

**Documentation.** A "キメ" chapter in the PV22 design addendum (the lead's choice of file, as for P2): M3.3, M3.4 and
Appendix B. `docs/SPEC.md` §3/§6: "行 › キメ: one bold cut (line pin `kime`)". `docs/NOTES.md`: Appendix A and the
visual-QA results (R2, R3).

## Size estimate

About 620 lines of source in 21 files (`planner/kime.js` new ≈ 170; `planner/cast.js` +110; `ui/inspector.js` +45;
`planner/explain.js` +35; `planner/segment.js` +40; `planner/plan.js` +30; `planner/extreme.js` +25;
`planner/camera.js` +30; `planner/tracks.js` +20; `i18n/strings.js` +34; `ui/fields.js` +15; `ui/lyric_editor.js` +20;
`core/commands.js` +15; `ai/looks.js` +20; the rest < 12 each) and ≈ 750 lines of tests (`kime.test.js` ≈ 560, the
layout test ≈ 40, updates ≈ 100, browser flow ≈ 50), one new golden file, ≈ 150 lines of documentation.

---

## Critique log

| # | Severity | Issue | Verdict | How it was handled |
|---|---|---|---|---|
| 1 | blocker | Forced part names crash the planner with the stub/synthetic registry; the planner_pins fuzz fails | **Valid** (reproduced: `stub.js` threw "Invalid value used as weak map key") | M3.4 e: every set member must be in the cut's own stage-0 pool (which already applies registry presence, role, orientation/script/aspect traits, the user's filters, gates, season and the line's avoid list — stricter than the critic's `has`/`serves`/`filterAllows`); an empty set → normal chooser (`kime.limited`); the post-chooser fallback is `only[0]` (a valid member), never a literal; lens and depart forces are `registry.fallback(kind)`. The fuzz ODD list gets `kime` pins; test 3 plans with the stub and synthetic registries. Prototype: no throw, planner_pins 23/23. M3.7 no longer claims lyrics.test.js failures (the grammar change is gone). |
| 2 | major | text.scale 1.3 does not enlarge 大と小 | **Valid** (reproduced with the fake measurer: 1.3 = 1.0 except 1-cell giants in tall frames) | Dropped the 130 % promise for 大と小. `giantWhisper` keeps the auto scale but with a floor of 1.0 (rule `kime.full`), because below 1 the giant does shrink (0.9 → −10 %); `tuck: 'under'` by rule (the larger giant); `ratio ≥ 3` kept. 1.3 applies only to non-big layouts (pinned or `kime.limited`). `whyRule.kime.scale` / new `kime.full` match what happens. The layout test asserts drawn giant sizes (0.40 / 0.27 / 0.20 of the short side) with mutations. `giantWhisper`'s formula and parameters are unchanged. |
| 3 | major | "A キメ line without ! never flashes" is false (flashPop/invertBlink on ≈ 1 %) | **Valid** (reproduced 17/1632) | `filter#i` pools on non-impact キメ cuts exclude `gate: 'flash'` (`noFlash`, why `kime.noFlash`). Also found and fixed the same leak through the seam out of a キメ cut (白く飛ぶ, 17/800): `noFlashSeam` unless the next cut is 見せ場, with the seam memo keyed on it. Prototype: 0 flash filters; the 5 remaining flash seams are all 見せ場-adjacent. Test 5 with both mutations. |
| 4 | major | 40-cell one-cut limit untested, beyond 大と小's range, slow landing | **Valid** (reproduced: 35-cell cut, 1.42 s landing) | `kimeMaxCells(aspect) = min(30, 2 · BASE[aspect])` (16:9 28, 9:16 16); longer lines keep their split and the focus/last piece is the キメ cut. Landing cap `dur + (units − 1)·each ≤ 0.8 s` (units = words for 押印, glyphs for 寄せ). Test 7 covers 12–35 cells × aspects × orientations; QA sheets include long lines (R2). Prototype: all landings 0.50–0.79 s. |
| 5 | major | A pin on one piece silently takes over the whole キメ look | **Valid** (reproduced: `centerAnchor` from `r2~4` on the one cut) | `kimeAttach` in `cutsOfLine`: only a `<line>~0` pin whose sig is the whole line (or absent) attaches; every other former piece pin is reported `shadowed-pin` (existing code and strings; 削除 / 付け直す in the inspector) and returns when the mark is removed. Test 8 with the mutation. |
| 6 | major | The キメ flag contract with P2/P4/P6 is unresolved | **Valid** | One accessor `KI.isKime(cut)` (M3.4 k); P2's `kimeAt`, P4's `P3kime`, P6 (via `line.kime`) use it. The mark is now the `kime` line pin P2 expected, but P2 must still call `isKime` (a long line's pin does not make every piece キメ). M3.11 states what P2 must not do on キメ cuts (no blend, kit, lettering, shot factor, flips, mirror, T5 action). The critic's "identical with P2 on and off" test was replaced by a direct contract test of P2's hooks plus the guarantees, because recency against neighbours (which P2 changes legitimately) can pick the other member of a キメ set — documented in M3.7. |
| 7 | major | A leading `!` is read as キメ in existing and imported documents | **Valid** | Resolved by a third option instead of (a)/(b): the mark is a line pin `line/<id>:kime`, not lyric syntax. Absent = off in every existing, imported and fixture document by construction; the lyric text is never reinterpreted; no import path changes; `core/lyrics` is untouched (FROZEN grammar, ParsedRow/Line and lyrics.test.js unchanged). Visibility moves to a gutter badge, the 行 toggle and a 記法 row (R6). Option (a) was rejected because ~15 callers of `parseRow`/`parseSheet` would need a document flag threaded through; option (b) still reinterprets text in existing documents. |
| 8 | minor | 見出し face is not heavy in several themes | **Valid** (earth, paper, season, glass have 400-weight brush/round display faces) | Wording is 「見出しの書体」 without "heavy/太い" in M3.1, `fld.kime.note`, `whyRule.kime.face`. With P4: `text.weight` by rule to the heaviest ≥ 700 weight the face has, else left automatic (M3.11). |
| 9 | minor | Hold can shrink interludes/outro to ≈ 1.4–1.5 s | **Valid** | `hold = clamp(min(1.5, room − 3), 0, 1.5)` for both: the special cut keeps ≥ 3 s, which also keeps a media background segment at `MEDIA_MIN_SEGMENT` (stricter than the critic's 2 / 2.5 s, same intent). Test 9 checks 2.9 / 3.0 / 4.0 / 5.0 s gaps and 3 / 4 s outro rooms. |
| 10 | minor | キメ entrance silently overrides 歌ハメ on the hook line | **Valid** | Adopted P6's published rule (automatic 歌ハメ off on キメ lines; a pinned 歌ハメ applies with `KIME.arrive ∩ HAME_ARRIVE` and P6's timing) and added the critic's point: on such a cut P3's `dur`/`each`/landing caps step aside, every other キメ rule stays (M3.4 l, M3.11, test 16). |
| 11 | minor | Camera amount < 0.1 leaves 大と小 without any hit | **Valid** | The lens follows what the shot will be (`moves(st)`: shot pin, EXTREME, `CAM.kimeShot`): no movement → `impactKick`, movement → fixed frame. Invariant tested: lens is 衝撃 exactly when the final shot is `none`. The punch-in stays visible at camera 0 (lens amount ≥ 0.2). |
| 12 | minor | UI details (count at 0, `/` ignored silently, unpin-all clears `kime.calm`, overflow always 1.08) | **Valid** | (1) count only when > 0; (2) `fld.kime.note` says / is ignored, the editor dims `/` on one-cut キメ lines (`tok-cutOff`), long lines get `fld.kime.split`; (3) `SETTING_SLOTS` keep rule is P3's own change, covering `kime` and `kime.calm`, tested in commands.test.js; (4) overflow is a fixed rule value 1.08, with a QA question (R2). |
| 13 | minor | Two stated facts were wrong (solveTimes callers; 大と小 "any length") | **Valid** | M3.4 c: "no caller in `src/` besides planner/plan; timing.test and ai_song.test call it without kime". M3.4 e: 大と小's trait range is soft; 1-cell lines and > 30-cell pieces reach it through the reduced fit; tests 7 and the layout test cover 1-cell giants and a 35-cell piece. |

Also checked and noted: the critic's `results.txt` shows `contract.test.js` failing in its suite copy; against the
revision-2 prototype with the repository's `docs/` linked it passes 17/17 (the failure was the copy's missing
`docs/DESIGN.md` path).
