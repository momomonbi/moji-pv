# 文字PVメーカー v2.2 — DESIGN addendum: 文字PVの定石

Status: **contract for v2.2**, to be read together with `docs/DESIGN.md` (v2) and `docs/DESIGN_2_1.md` (v2.1). Where
this file changes a rule of those files it says so, and this file wins. Items marked **FROZEN** change only through the
D§9.4 process; each chapter lists the FROZEN contracts it touches.

The owner asked for fourteen conventions of lyric videos (文字PV) and to skip what the app already does:

| id | request | chapter |
|---|---|---|
| M1 | パートごとに演出をそろえ、くり返す歌詞は同じ見せ方で戻ってくる | §2 |
| M2 | 動きの配分や方向の交互など、文字PVの定石を組み込み | §2 |
| M3 | キメたい一行を大胆に見せる「キメ」 | §3 |
| M4 | 文字が溶けて変わる、同じ字が移動するモーフ | §4 |
| M5 | 細字から太字へ育つ、太さのアニメーション | §4 |
| T1 | かなの字間を詰めて塊で読ませる | §1 |
| T2 | 助詞を小さく、頭の字を大きく | §1 |
| T3 | 英字は少し大きく、日本語との間を少し空ける | §1 |
| T4 | 声より0.2秒先に文字を出す | §5 |
| T5 | 効果を重ねすぎない | §2 |
| S1 | 曲から行の頭を自動で下書き | §5 |
| S2 | 1行だけタップで打ち直し | §5 |
| S3 | 歌に合わせて1字ずつ出す「歌ハメ」 | §6 |
| S4 | 読み切れない速さの行を知らせる | §5 |

A survey of the code (with an adversarial check of every claim) found none of them complete: nine partly there, five
missing. Each chapter says what already existed and what v2.2 adds.

---

## 0. New works and older works

**The document generation `look.gen`.** `core/doc.newDoc()` is `defaultDoc()` with `look.gen = D.GEN` (1). It is used
only where the app makes a new work: the first run and `?fresh=1` (`ui/boot.js`), ≡ › 新しい作品 and the emptied device
(`ui/project_io.js`). `defaultDoc()`, `normalize()`, file open, package import, autosave restore, every fixture and every
test that builds from `defaultDoc()` never carry it. `checkLook` accepts an absent `gen` or an integer 0–255; no command
writes it; the look commands keep it; the file keeps it last in `look`; there is no schema change (an older build keeps
the unknown key).

**The defaults table `planner/rules`.** One table of every switch and strength whose default depends on the generation.
Each row is `{ slot, parent, scopes, spec, on, off }`: a slot without its own pin takes its parent's value, else `on` in a
document of generation ≥ 1 and `off` in an older one. A pin always wins (a line pin only where `scopes` allows it; a
cut pin never), so 固定を外す returns a switch to the document's default and turning a feature on in an older work is one
pin. `value(doc, ix, slot)`, `valueAt(doc, ix, slot, lineId)`, `defaultValue`, `hasDefault`, `isRule`, `scopesOf`,
`SPECS`, `ROWS`.

**Why a marker and not default pins.** 作品全体 › 固定を外す drops every work pin, so default pins would switch the
conventions off when the user returns a work to automatic; pins by 'user' would show 固定 marks nobody set; and the
inspector would show every row as fixed by the whole work instead of 自動.

**Goldens.** Every existing golden stays byte-identical: `frame_hashes_v2.json` (FROZEN), `plan_hashes.json`,
`frame_hashes.json`, `project_media.json`, `project_repeat.json`, `project_extreme.json`. None of their documents carries
the marker or a new pin, and every new behaviour is behind the table or behind a pin. Packages that need to show their
behaviour in pixels add their own golden files.

<!-- PV22 P1 chapter -->

<!-- PV22 P2 chapter -->

<!-- PV22 P3 chapter -->

<!-- PV22 P4 chapter -->

<!-- PV22 P5 chapter -->

## 6. 歌ハメ (S3): the characters come in one at a time with the singing

Before v2.2 the order 「歌に合わせて」 (`'sung'`) spread a cut's characters evenly by estimated morae over the whole cut
(`t0 … t1`): there was no per-character timing, no switch, no way to see or set a character's time, and on LRC-timed
lines the last characters came 1–2 s late. v2.2 adds real character times (taps and enhanced-LRC word tags), a sung
window, the switch 「歌ハメ」 with a 自動 for new works, and one engine branch that every consumer of sung times takes.
The work is phased: **A** (shipped) — character times, the switch, 1字ずつタップ, the inspector rows and the golden;
**B** (shipped, 6.9) timeline ticks and drag; **C** the song's voice (`doc.song.voice` on P5's `audio/phrases`, both
constants off until a lab gate passes; not in this chapter yet); **D** (shipped, 6.10–6.11) 歌った字に色をのせる (karaoke
fill) and optional AI word timing. Each phase is golden-safe on its own.

### 6.1 Decisions

| Question | Decision |
|---|---|
| Sources of a character's time | In priority: (1) the line pin `line/<id>:sung.times` = `[[off, dt], …]` (text offset, seconds after the line's start; written by 1字ずつタップ, later by tick drags and the optional AI); (2) enhanced-LRC word tags `<mm:ss.xx>`, kept in the row's source and parsed into `ParsedRow.words`; (3) a copy from the occurrence of the same lyric with the best explicit times (earlier or later); (4) an estimate inside the line's sung window. |
| Sung window | Characters spread over `[t0, sungEnd]`, not `[t0, t1]`. `sungEnd` = the end pair of the pin, else an end word tag, else `T[last] + morae after the last anchor / rate × 1.1` (rate = the line's own measured rate with ≥ 2 anchors, else the reading rate), never past the span. It errs early, never later than v2. |
| The switch 「歌ハメ」 | Slot `sung.hame` (bool) at the whole video or a line. `hame = linePin ?? (line is キメ ? false : workPin ?? 自動)`. On: the entrance comes from the one-character-at-a-time list, layouts that move the text themselves are left out, and as the last parameter step `order = 'sung'` and `dur = clamp(入りの早さ, 0.06, 0.25)` by rule (`pfrom 'rule:sung'`): each character starts `dur` before it is sung and lands on it. |
| 自動 | New works (`look.gen ≥ 1`): on for a line with explicit character times (own or copied: `times`) and, while 「字の時間を歌に合わせる」 is on, for a hook line (`hook`: the song's first lyric line, and the chorus lines at run positions 0, 3, 6, …), decided per lyric text so repeats match. Older works: off. |
| 「字の時間を歌に合わせる」 | Slot `sung.real` (bool, work only), a row of `planner/rules`: on in new works, off in older ones. It lets word tags and copies time a line, and makes the hook lines 歌ハメ. |
| The fast path | `planner/sung prepare` returns `null` — the v2 plan, byte for byte — unless `sung.real` resolves on or a `sung.times` / `sung.hame` / `sung.fill` pin exists. No fixture or golden document has either. |
| 歌った字に色をのせる (D) | Slot `sung.fill` (bool, work / line, pin only; a `planner/rules` row off in every generation). The line's cuts carry the decision `{ v: true, from: 'pin:line' \| 'pin:work', by }`; the scene adds one STYLE behaviour over the text that dims each unsung character and gives it the accent tint as it is sung. |

### 6.2 Data model (additive)

- **Lyric rows** (§3.11, §4.9.1): `ParsedRow.words = [[at, t], …]` only on a row with word tags (`at` a grapheme start
  of `row.text`, `text.length` for a tag after the last character; `t` absolute seconds); `Line.words` and
  `Line.wordsRef` (the row's first stamp, else the first tag), so the planner reads `dt = t − wordsRef` relative to
  each occurrence. `FIELD_KEYS += 'words'`; `renderRow` writes the tags back; a text edit drops them; `shiftWords`
  moves them with a new first stamp (≡ › 時刻を歌詞に書き込む). The text and marks of every row parse as before.
  **Behaviour change (all documents):** editing a tagged row through the inspector or 時刻を歌詞に書き込む now keeps
  its word tags (they were silently dropped).
- **Pins:** `line/<id>:sung.times` (line only; 1–400 pairs, offsets on grapheme starts and strictly increasing, the
  end pair `[text.length, dt]` last, `0 ≤ dt ≤ 600`, each ≥ the one before + 0.01; checked by the planner's
  `acceptSungTimes`, a bad value warns `pin-bad-value` and the line uses its other sources); `sung.hame` (work, line;
  refused at cut scope); `sung.real` (work only). `core/reconcile.remapSungTimes` moves the pairs with a text edit;
  a deleted character loses its pair, a replaced line loses the pin. `pin.promote` never lifts `sung.times`;
  `pin.copy` copies none of them; 固定を外す clears them like any slot.
- **Plan** (§3.12): an optional cut field `cut.sung = { at, end, t }` (offsets in the cut text, seconds after `t0`)
  on the cuts of a line with sung timing, printed between `slots` and `t0` and fingerprinted only where present. A
  non-enumerable `plan.sung`: `Map<lineId, { at, t (absolute), end, src, by, pinBy, explicit, hame, hameWhy, fill,
  dropped }>` for the inspector and the timeline (not hashed).
- **Engine:** target `off` (a glyph's offset in the cut text, −1 for a run with its own text), `STG.sungTimeAt`,
  `STG.sungTimes`, `SUNG_AHEAD = 0`, `SUNG_EXIT = 0.8`, `K.sungAt`, `shot.sungEndOf`; `vert.MAX_TCY_DIGITS` exported.

### 6.3 Algorithm (`planner/sung`, constants in `SU.C`)

**(a) Units.** What is sung as one beat and appears as one step: a Latin word (`'` `’` `-` inside it continue it); a
run of ≤ 2 digits (one tate-chu-yoko cell), longer runs one unit per digit; an opening bracket or quote joins the unit
after it; a grapheme with morae, or a han, starts a unit; anything else (small kana, closers, spaces, symbols, emoji)
joins the unit before it. Weights = morae (≥ 0.5). A time set on a space or a closer belongs to the unit after it.

**(b) Anchors.** A line's own anchors are its pin, else (with the sources on) its word tags; a tag before the start,
after the span or closer than 0.02 s to the one kept before is dropped and counted (`sung-words`). Anchors after the
line's span are never used. Copies: per lyric text the occurrence with the best own anchors (pin > tags; ties: the
earliest) lends them to every other occurrence without its own, scaled when that line is shorter.

**(c) Fill.** Unit 0 starts with the line unless anchored; the sung end as in 6.1, clamped
`max(min(E, span), min(T[last] + 0.05 · units after it, span), T[last])`; unanchored units are interpolated by weight.

**(d) Stage 1b / 4b.** `prepare` after the lines are timed (the fast path, per-line timings memoized and frozen);
`decideHame` after the features: hooks from P2's `ctx.pv.partOf` when present, else runs of the cuts' real song
section; `ctx.sung.hameAt(cut)` is the hook P4's モーフ rule reads.

**(e) Pieces.** A line with sung timing (sources on, or ≥ 2 anchors) puts each automatic piece boundary at its first
character's sung time, bounded so every piece of a run between pinned boundaries stays ≥ 0.35 s and in time order; an
infeasible run keeps the v2 weights. `snapInner` leaves those boundaries alone.

**(f) Cast.** Arrange pool without own-motion layouts (`rule: sung.arrange`); arrive pool restricted to `typeOn,
sliceReveal, inkRise, bloomOpen, zoomSettle, dropSnap, riseFromFlat, pixelStep` (English lines also `wordPop,
stampPress`; `rule: sung.hame`); an aligned source outside the list is not taken; an empty list forces 打鍵 when the
filters allow it, else the fallback, and warns `hame-empty`. `hameParams` runs last in `decidePart`; `copyParams`
never copies or drops a value whose own or source `pfrom` is a rule tag. The cast cache keys on `hame`.

**(g) Engine.** Only where `cut.sung` exists: the arrive branch of `motionTiming` (glyph j starts at `t_j − dur` and
lands at `t_j`; departs keep the v2 spread), `shot.sungOf` / `readingUnits` / `anchorTime` (mid, end, emphasis
fallback read the sung end), underSweep from its word's sung time, `repT = SU.heroSung`. `shot.spanOf` and xshot's
framing fence are unchanged. An exit that would start before the last sung character lands is shortened to 0.8 of the
time left after it (at least `MIN_DUR`).

### 6.4 The inspector

| Where | Row |
|---|---|
| ③ 見た目 › 行 › 演出 (after 文字の出方), and the several-lines page | 「歌ハメ」 [自動 \| オン \| オフ]; under it what 自動 decided (`sung.auto.times` / `hook` / `kime` / `off`, from `plan.sung`); a work pin shows 作品で固定 ↑. On the several-lines page one line pin per selected line, いろいろ while they differ (`readEach`). No 振り直し. |
| 作品全体 › 見た目 (after くり返しの行をそろえる) | 「歌ハメ」 [自動 \| すべての行 \| 使わない]; 自動's note: new works `fld.hame.autoNote`, older works 自動（オフ）. |
| 作品全体 › タイミング (詳しい設定) | 「字の時間を歌に合わせる」: shows the document's default while unpinned (`autoDefault`: choosing the default clears the pin, the other value pins it). |
| 行 › 時間 (under 長さ) | 「字の時間」 = 「11か所 · タップ・手で合わせた時間」 (units and the best source; なし without sung timing); [1字ずつタップ] (disabled without the loaded song: 曲を読み込むと使えます); [字の時間を消す] for a pinned line (one undo step). |
| ① 歌詞 | Word tags stay in the row as typed or imported and are drawn muted like stamps; the gutter's warnings include `sung-words` and `hame-empty`. |
| なぜ | 入り `whyRule.sung.hame`, 文字の出方 / 長さ `whyRule.sung` (rule tags explain before motion speed's plain `rule`), 構図 `whyRule.sung.arrange`, a pinned own-motion layout `whyRule.sung.own`. 文字の出方 and 長さ of a 歌ハメ cut are 導出 (read-only). |

### 6.5 1字ずつタップ

`core/tap` gains a pure unit reducer next to the line reducer (`EVENTS`, `tapReduce`, `tapCommand` unchanged):
`unitStart(units, { end })`, `unitReduce` with `mark` (≥ 0.04 s after the last; a mark after the end takes the end back),
`end` (≥ 0.04 s after the last mark), `back` (the end first, then the last mark), `pause`/`resume`, `restart`, `loopEnd`
(stopped at the loop's end, the take kept), and `unitResult` → `{ start, times: [[at, dt]…], end }` (null with fewer than
two marks). `ui/tap_units` is the mode: the line as chips with the next one lit, 区切り [1字 | 言葉] (the sung units, or the
breaker's word starts with the first at 0), 速さ [ふつう | 少しゆっくり | ゆっくり] (the player's rate 1 / 0.75 / 0.5,
restored when the session ends), a loop from 1.5 s before the line to 0.8 s after its sung end (else its end). Keys are
the tap mode's: Space / Enter / the pad / a press on the preview mark, E the end of the singing, Backspace back, P pause,
Esc / T 決定; ←/→ do nothing. At the loop's end playback stops and the panel and the play-bar strip offer 決定 and もう一度
(もう一度 forgets the take and plays the loop again); playing on from there starts the loop again with the take kept.
「やめる」 ends without writing. Event times are the clock at the key minus `tapLatency × rate`. 決定 with ≥ 2 marks writes
one undo step 「1字ずつタップ（n か所）」: `time.tap` with the line's start at the first mark and `pin.set
line/<id>:sung.times` by `'tap'` (pairs relative to that start, plus the end pair when E was pressed); the toast offers
「この行を歌ハメにする」 where the line's 歌ハメ does not come on. Entry points: 行 › 時間 and the palette (`tap.units`,
needs the song and a line). `ui/tap_units.combine(line, units)` is the app's tap panel: every key and button goes to the
running mode, each mode refuses to start while the other runs, and `root` is the running mode's panel (ui/steps shows
it).

### 6.6 Tests and the golden

`tests/node/sung.test.js` (units, pins, fill, word tags, copies, pieces, gates, 自動 and キメ, cast, aligned repeats,
explain and fields, engine, shot and underSweep, exits, repT, determinism, encoding, speed, the golden),
`tests/node/tap.test.js` (the unit reducer), `tests/node/ui_tap_units.test.js` (steps, loop, the pin a take writes and
the planner accepts, the two-mode panel), additions to lyrics, commands, reconcile, i18n, ui_fields (the rows, their
places and flags) and planner_stability (the shared locality predicate `tests/helpers/locality.js`);
`tests/browser/ui_flows.py` flow `hame`, and `i18n_pages.py`'s 歌ハメ screens (the rows, 字の時間, the unit panel and its
loop end, in ja and en). **Golden
`tests/golden/project_sung.json`** (`tests/helpers/sung_docs.js`, `node tests/update_golden.js --only=project_sung.json`):
plan and 40 frame hashes per document, 16:9 and 9:16, two seeds each, keyed entries — A1 the lrc fixture with
「字の時間を歌に合わせる」; A2 that plus 歌ハメ for the whole video and one tapped line; A3 the basic fixture as a new work
(the hook lines r4, ra, rd); A4 the repeat fixture as a new work with its second 飛ばせ… tapped (copies both ways,
aligned repeats); D1 (phase D) A2 with 歌った字に色をのせる for the whole video. New-work entries pin the other packages'
switches off. Phase C adds C1 without touching these. Every existing golden is byte-identical. Phase B and D tests:
`tests/node/ui_sung_ticks.test.js` (which ticks, bounds, the pins a drag, a nudge or a double-click writes),
`sung.test.js` (the fill gate, the fill behaviour, accent glyphs and the budget), `ai_song.test.js` / `ui_ai.test.js`
(AIで字の時間), `ui_fields.test.js` (the fill rows); `ui_flows.py` flows `hame_ticks` and `ai_words` and the fill in `hame`;
`i18n_pages.py` the timeline with a focused tick.

### 6.7 FROZEN contracts touched

| Contract | Change | Compatibility |
|---|---|---|
| Row grammar §4.9.1, ParsedRow / Line §3.11 | word tag positions kept as `words` / `wordsRef` | text and marks identical; absent on rows without tags |
| Plan §3.12 cut | optional `sung` | absent on every existing plan |
| Decision `pfrom` values | `'rule:<name>'` (read through `SU.isRuleTag` / `isRuleFrom` by cast, fields and explain) | new value only on 歌ハメ cuts |
| Scene target §4.17.5, kit §4.18.3, `engine/scene/shot` | `off`, `sungAt`, `sungEndOf` | additive; `spanOf` unchanged |
| `core/tap` | the unit reducer | the line reducer unchanged |
| Cut decisions (D) | `sung.fill` `{ v: true, from: 'pin:line' \| 'pin:work', by }` | only with a `sung.fill` pin |
| `engine/scene/behave`, `build`, `stagger` (D) | `sungFill`, `runSungFill`, `FILL_*`; `fillUnderBudget`; `sungNextAt` | additive |
| `ai/changes` `time` kind (D) | optional `field: 'sung.times'` and `start` | absent on every other change |
| `ORDERS`, POSE, seam mix, SCH enums, slot order, draw's tint | none | — |

### 6.8 For the other packages

- **P2:** the `planner/rules` rows `sung.real` and `sung.hame`; hooks read `ctx.pv.partOf` when set (or `ARC.parts` if
  the integrator wires it for "P2 landed, rules off"); OTHER_OFF gains `work:sung.real = false`. P6 restricts the arrive
  pool (the kit weighs inside it) and forces only `order` / `dur`.
- **P3:** 歌ハメ on a キメ line only by a line pin; `hameParams` runs after `KI.params`, which skips its caps when
  `st.hame`.
- **P4:** the モーフ rule reads `!!(ctx.sung && ctx.sung.hameAt(c))`.
- **P5:** new works' `timing.lead = 0.2` is the 歌ハメ `dur`; 出そろい skips `order === 'sung'` (`SU.isSungCut`). The unit
  mode lives beside the line tap panel (`ui/tap_units.combine`), so S2's rewrite of `ui/tap` keeps its own file; its
  line context menu takes a 「1字ずつタップ」 item (`tap.units` with `{ lineId }`). Phase C's voice builds on P5's
  `audio/phrases`.

### 6.9 Timeline ticks (phase B, `ui/sung_ticks`, `ui/timeline`)

- **Drawing.** Every line with sung timing (`plan.sung`) draws a 7 px tick at the bottom of its bar for each unit after
  the first (and for the first when it is sung after the line's start), when the line has ≥ 5 px per unit or is
  selected; colours by source (tap / hand bright, word tag or copy `COLORS.mark`, voice blue, estimate faint) and a
  bracket at the sung end. A selected line with ≥ 12 px per unit writes each unit's first character over its tick and
  its name stops before them. `plan.sung` gains `endSrc` (the source of an explicit end, 0 for an estimate).
- **Hit test.** A tick within 4 px, in the bottom band of the bar (ticks and 4 px above), of a selected line: after the
  start / end edges, before the body (the rest of the bar still drags the line). A click on a tick leaves the selection
  (and 詳細) as it is, so its double-click lands on the same tick.
- **Drag.** Snaps to the playhead within 7 px (Alt: no snap; the voice peaks come with phase C), clamped 0.02 s from the
  units around it (the first: not before the line's start; the last: up to an explicit end, else up to the line's span,
  the end being estimated again). It writes `line/<id>:sung.times` = every unit where it is now with the moved one
  where it went (a pair closer than 0.01 s to the one kept before it is left out; the moved one never), plus the end
  pair where the end is explicit (a pin, a word tag or a copy), by `'user'`; on a line whose start is automatic, the
  same batch pins `line/<id>:start` where it is. One gesture = one undo step 「字の時間」 (`mergeKey 'tl:tick:<line>:<u>'`).
- **Double-click / Delete** on a tick of a line with a pin: that unit's pairs leave the pin (it is interpolated again);
  an empty pin is cleared. A line timed by tags or copies has no pin to take a pair from: nothing happens.
- **Keyboard** (the timeline's listbox): Alt+←/→ move among the focused line's ticks (always taken there, so the browser
  never goes back a page), Ctrl+←/→ (`timeline.nudge`, Shift ×10) move the focused tick by a frame (same start rule),
  Delete / Backspace give it back to the estimate (never the inspector's 固定を外す), ←/→ return to the edges; the
  option reads 「{ch}の時間 {time}」.

### 6.10 歌った字に色をのせる (phase D)

- **Planner.** `prepare` opens its gate for a `sung.fill` pin; a line whose pin resolves on (its own, else the whole
  work's) has sung timing. Without 「字の時間を歌に合わせる」 or a 歌ハメ pin and with fewer than two anchors, it keeps the v2
  window over its span and the v2 piece boundaries, so in an older work the colour alone changes no cut and no choice
  (only `cut.sung` and the decision). `castSlots` keeps the pin as the cut's `sung.fill` decision (lyric and focus cuts
  of such a line; no chooser stream, never a lock pin). `plan.sung.fill` says it.
- **Engine.** `BH.sungFill(env, target, same, times)`: per glyph `s = t_sung − 0.03`, `d = clamp(t_next − t_sung, 0.08,
  0.3)`; `runSungFill` multiplies alpha by `dim + (1 − dim)·smooth((t − s)/d)` (dim 0.55; 0.35 for a glyph inked in the
  accent) and raises the tint to `0.9·k` except on accent glyphs (draw's tint colour is the accent). A run that shows
  its own text (a note) is left as it is. No allocation per frame. When the glyph budget took the tint back from one of
  the cut's material phases, `build.fillUnderBudget` masks the fill's tint too (the brightening stays).
- **Inspector.** 行 › 演出 (and the several-lines page) and 作品全体 › 見た目: a toggle 「歌った字に色をのせる」 under 詳しい設定,
  on = pin, off = unpin (`offClears`), `noDice`; a line under a work pin shows 作品で固定 ↑.

### 6.11 AIで字の時間 (phase D, review only)

- `ai/song.wordsRequest(doc, plan, lineIds, uiLang)`: up to 12 of the given lines (in time order), each sent with its
  number, text and the stretch it is shown in; schema `{ lines: [{ i, words: [{ text, start }] }], note }`.
- `wordsChanges(doc, plan, json, duration, opts)`: each word is found in order in the line text (NFKC, lower case,
  spaces ignored; a word not found is skipped) at the grapheme where it begins; `dt = start − t0` is kept in
  `[0, length + 0.5]` and ≥ 0.02 s after the pair before. A line with ≥ 2 pairs gives one change `{ kind: 'time',
  field: 'sung.times', path: 'line/<id>:sung.times', from, to: pairs, start }` (`start` = the line's start rounded to
  the millisecond when it is automatic), label 「{n}行目: {count}か所の時間」; fewer → `ai.warn.fewWords`.
- `ai/changes`: such a change is stale once the times pin or the line's start pin changed; `toCommands` pins the start
  (by `'ai'`) before the times; other `time` changes are as before.
- UI: 曲を使う › **AIで字の時間** (Gemini, the song and consent), for the selected lines, else up to 12 from the playhead.

