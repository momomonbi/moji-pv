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

## 5. タイミング (T4, S1, S2, S4): when the text comes in, and the tools to time it

T4 puts the text 0.2 s ahead of the voice in new works and adds 入りの基準 出そろい (the entrance has ended, and the line
can be read, that long before the voice), with two planner fixes that make any 入りの早さ above 0.12 s safe. S1 (曲から
下書き), S2 (この行だけタップで打ち直す) and S4 (読み切れない速さの行を知らせる) follow in §5.2–§5.4.

### 5.1 T4: 声より0.2秒先に文字を出す

**Gating.** `core/doc.newDoc()` writes `timing.lead = D.NEW_WORK_LEAD` (0.2) next to `look.gen`: the lead is a stored
number every document has (`checkTiming` requires it, `normalize` fills a missing one with `defaultDoc()`'s 0.12), so it
cannot follow the marker. Existing works, opened files and every fixture keep the lead they store (0.12). 入りの基準
(`timing.enter`) is absent in every generation (= 動き始め).

| Item | New works (`newDoc`) | Existing works and every fixture | Switch |
|---|---|---|---|
| lead 0.2 | `timing.lead: 0.2` written | as stored | 作品全体 › タイミング › 入りの早さ |
| 入りの基準 | absent = 動き始め | absent = 動き始め | 作品全体 › タイミング › 入りの基準 |
| long-lead hand-over, neighbour clamp | where the geometry needs them | the same rule (bug fixes; never at lead 0.12 on the golden documents) | none |
| EXTREME whipPan pair | the whips must meet | today's rule, unless 出そろい is chosen | none |

**Document.** `timing.enter`: `'start' | 'ready'` (absent = `'start'`); `timing.readCheck`: boolean (§5.4). Both are
optional, validated by `checkTiming`, written by `timing.set` (one undo entry named by the field: 「入りの基準」) and
ordered after `tapLatency` (`ORDER.timing`), so a file without them saves byte-identically. `D.ENTER_MODES`,
`D.NEW_WORK_LEAD`. No schema change.

**(a) Neighbour clamp — `planner/segment.windows` (every work).** After `a = t0 − lead` and `b`, a cut starts no
earlier than the end of the cut two before it and never after its own sung start: `a_i = min(t0_i, b_{i−2})` where
`a_i < b_{i−2}`. A window then overlaps only its neighbours' (the bound `engine/scene/budget` relies on). It never binds at
lead 0.12 on the golden documents; at lead 0.2 it moves 15 cuts in 18 fixture plans.

**(b) Long-lead hand-over — `planner/tracks.seams` (every work; DESIGN §3.12 b).** A centred transition hands the
picture to B at the end of its window `at + dur/2`, and `endWithSeam` never ends A before its sung end `A.t1`. With
`at = B.a = B.t0 − lead` that holds only while `lead ≤ dur/2`; above it A outlived the window and showed again after the
transition (with a replaced exit, at full strength). For a seam without `def.ends` whose A ends by B's sung start
(`A.t1 ≤ B.t0`) and `dur/2 < need = A.t1 − B.a`:

1. tier 1, `dur ≥ need`: the window slides later, `at = q6(A.t1 − dur/2)` (it ends at A.t1 and still contains B.a);
2. tier 2, the seam's own limit (`0.4 · min` of the two windows, 0.8 s for a world seam) ≥ need: the window lengthens
   to `[B.a, A.t1]`;
3. tier 3: the window stays and A ends with it, below its t1 (`endWithSeam(cuts, j, end, reach, handover)`: the same
   fifth argument P4's glyph seams pass; the cuts before A keep the t1 floor).

Every tier keeps B.a inside the window, so B is never drawn before its transition starts and a world seam's background
switch (the segment start, B's a) stays inside it; the rig blend reads `at` and `dur`. A boundary whose A is pinned to
end after B's sung start (a duet) keeps today's window: A shows until its own end (§3.12). Seams that place their own
window (`def.ends`, §4) are left alone. Over the 6 fixtures × 3 seeds of `tests/node/seams_lead.test.js` (459
transitions), tiers 1 / 2 / 3: none at lead 0.12; 113 / 0 / 0 at 0.2; 316 / 3 / 0 at 0.3; 408 / 0 / 6 at 0.5; 161 / 44 /
239 at 1.0 (the same under 出そろい); A past the window and B before it: 0 at every lead.

**(c) 出そろい — stage 6b of `planner/plan.run`** (`readyWindows`, only when `timing.enter === 'ready'`), after
`TR.grounds` and `TR.seams`, before `XT.shots`, `CAM.carry` and `CAM.rigs`. For each line cut, in time order, skipped
(it keeps 動き始め) when something else times its entrance: a transition into it (`seamIn ≥ 0`), a new background
starting with it, 見せ場 (`impact`) and キメ (`isKime`), an entrance revealed as sung (`arrive.p.order === 'sung'`, §6),
no entrance motion (the fallback arrive). Otherwise:

```
A     = min(READY.ROOM 0.45, max(MIN_DUR, dur + each·(count − 1)))      (the cut's arrive, its unit count)
ready = q6(t0 − lead)
floor = b of the cut two before (after the seams' clips); the first cut's t0 for the second cut; 0 for the first
a     = q6(min(ready, max(floor, ready − A)))
open when ready − a ≥ MIN_DUR and a < the cut's a: cut.a = a, cut.ready = ready
```

The pass never opens a first cut of a ground segment or a cut with a seam into it, so no seam, clip or segment start
depends on it; an opened cut stays inside its segment and overlaps only its neighbours. `b` never moves. A section camera
run whose first cut is opened starts at the opened a (as a rig run starts at its first cut's a today).

**(d) The capped entrance.** `core/motion.fitMotion({ …, cap })`: the limit is `min(share·window, cap)`; where the cap
binds, stagger shrinks first, then the duration down to the cap itself (the pass keeps `cap ≥ MIN_DUR`); without a cap,
or with one at or above `share·window`, the results are the v2 ones. `heroTime(cut)` reads `cut.ready` (cap
`ready − a`); `engine/scene/build.timesOf` gives `times.ready = cut.ready − t0` (else `null`) and
`engine/scene/behave.motionTiming` caps an arrive by `times.ready − times.a` (the `sung` order ignores it), so every
adapter, `motionTotal` and `arrivals()` agree and `times.rest ≤ times.ready`.

**(e) Plan and caches.** Plan cut `ready` (optional, absolute, only on opened cuts), printed between `pinKey` and `repT`
(`planner/encode cutPieces`, `encodeCutParts`); the fingerprint gains `'r' + q6(t0 − ready)` only when present (a cut
opened to its floor keeps `t0 − a` and `b − a` while its cap moves with the lead); `encodingKey` and the retime check
(`timesOf`, `sameTimes`) include it.

**Measured** (the stored fixtures at lead 0.2, the engine's fitted times): line cuts fully in by `t0 − lead` under
動き始め / 出そろい: basic 0.00 / 0.47 (8 of 17 cuts opened), lrc 0.11 / 0.37 (7 of 27), long 0.03 / 0.62 (143 of 245),
vertical 0.00 / 0.87 (13 of 15); every opened cut is fully in by its `ready`. The biggest group left out are lines
entered by a transition.

**(f) EXTREME whipPan pair — `planner/extreme.recencyOf`.** The pair (×6 and the same direction after a whipPan of the
same section with a hard cut) relies on A's whip-out (`b − 0.37 … b − 0.25`, FROZEN preset) meeting B's whip-in at `a`:
true at lead 0.12, never at 0.2. Outside legacy documents (no `look.gen` and not 出そろい) the pair needs
`|prev.b − 0.37 − a| ≤ 0.03`; every existing document keeps today's rule (`project_extreme.json` unchanged).

**UI.** 作品全体 › タイミング: 入りの早さ gets the note 「声より何秒前に文字を出すか。0.2秒前後が目安です。」; right under it
入りの基準 (動き始め / 出そろい（読める）, a two-option choice with a note). Subtitles keep the sung start.

**Tests.** `seams_lead.test.js` (the hand-over and neighbour invariants over 6 fixtures × 3 seeds × 5 leads × both
modes, one hand-made case per tier, the duet), `golden_lead.test.js` (the 253 golden documents: plain windows, no
`ready`, centred seams of today's length, every A ends no earlier than its t1), `timing_ready.test.js` (absent =
'start', the invariants and skips of (c), `times.rest ≤ times.ready`, the fully-in shares, repT, determinism with the
caches, the fingerprint of a floor-limited cut, the sung skip, the document field), the cap cases in `motion.test.js`,
the pair gate in `extreme_planner.test.js`, `commands`, `doc` and `ui_fields` cases, and the ui_flows flow `enter`.

### 5.2 S1: 曲から行の頭を自動で下書き

**What the user gets.** ② 曲 shows the chip 「曲から下書き」 (icon `wave`) under 「タップで合わせる」 whenever a song is set
(enabled when the work has lines; tooltip 「曲の声の出だしを探して、行の開始時刻を下書きします（AIなし）」); the palette has
「曲から行の頭を下書き」 (`time.draft`). It opens a review in the step column (`view.state.mode = 'draft'`), the same
place as the tap panel:

1. **The voice is read** (`doc.song.voice` with its phrase stream: every song imported by this build): the review opens at
   once. The song file does not need to be linked.
2. **Not read yet** (a song imported by an older build): 「曲の声をまだ読んでいません。読むと声の出だしから下書きできます。」
   With the song linked, **[声を読んで下書き]** runs 曲の声を読む (`app.readVoice`: `song.voice`, its own undo entry
   「曲の声を読む」, progress 「曲の声を読んでいます… {pct}%」 with [中止], which ends the draft), then the review. Not linked:
   **[曲をつなぎ直す]** and **[音量だけで下書き（精度は低め）]** (the loudness digest; 確か is capped at たぶん).
3. **The review:** 「{n}行の開始を下書きしました」, 「確か {a}・たぶん {b}・自信なし {c}」 and, with at least three drafted lines
   whose start was tapped, 「タップした時刻との差が0.3秒以内: {k}/{n}行」. The checkboxes **当てて見る** (on: the stage
   plays the work with the checked starts, `app.tryOn`, the play bar says 「下書きを試写中 [適用] [やめる]」; another try-on
   turns it off) and **固定・タップした行も下書きし直す** (off; `'tap'` and `'user'` start pins are drafted too). One row
   per moved line: checkbox, 「{n}行 {from} → {to}」, ◎ 確か / ○ たぶん / △ 自信なし, the line's text and [▶] (1 s before the
   drafted start, for 3 s; disabled with 「曲のファイルをつなぐと聞けます」 while the song is not linked). [すべて選ぶ]
   [確かなものだけ] [適用] [やめる], the keys line, the hint 「ずれている行は、行を選んで『この行だけタップで打ち直す』で直せま
   す。」 and, with AI on, 「AIでタイミング（より正確）」 (`ai.align`). The timeline draws each proposal as a blue tick
   (`COLORS.draft` `#7cc4ff`) on its line row, dashed when unchecked.
4. **[適用]:** one undo entry 「曲から下書き（{n}行）」 (`time.tap`, pins by `'tap'`, so the stale-end rule of §5.3
   applies); toast 「{n}行の開始を下書きしました」 with 「再生して確認」. **[やめる] / Esc** record nothing (a voice read in
   step 2 stays, as its own entry). A document change during the review re-drafts from the new lines (toast
   「歌詞や時刻が変わったので下書きを合わせ直しました」); opening another work ends it.

Drafted lines: those whose start is automatic; with 固定・タップした行も… also `'tap'` / `'user'` start pins. LRC times, AI
pins and lock pins are always anchors. Checked by default: ◎ and ○ (△ rows stay automatic, re-spread between the applied
ones). A drafted line that the aligner leaves in place (moved less than 0.05 s) on a found onset is pinned too, so the
re-spread around the new pins cannot move it off the voice. Nothing to draft: 「自動で並んでいる行がありません（すべての行の
開始が決まっています）」.

**Keys.** The context `'draft'` owns the keyboard like tap mode: Space 再生 / 一時停止, ←/→ 1 s, Esc やめる; every other
app shortcut is swallowed (`noop`: T does not start tap mode, Ctrl+Z waits). Space/Enter on a focused button or checkbox
keep their meaning; the panel's heading takes focus when it opens, so Space plays until Tab reaches a control.

**How accurate it is (measured; a draft, not a timing).** Synthetic stereo mixes (`tests/helpers/song_gen.js`: centred
sung phrases of 4–13 syllables with consonant bursts and vibrato over kick, snare, bass, alternating hats and a wide pad),
4 seeds × 90 s, lines = the true phrases with morae = syllables × 0.8–1.2, gap weights of `core/timing` at 120 BPM:

| case | phrase starts found (±0.15 s) | lines within ±0.15 s | within ±0.3 s | ◎ rows within ±0.15 s |
|---|---|---|---|---|
| clean | 0.82 | 0.79 | 0.86 | 0.85 (89 rows) |
| loud accompaniment | 0.60 | 0.56 | 0.67 | 0.62 (74) |
| long reverb | 0.91 | 0.93 | 0.97 | 0.97 (90) |
| short pauses (0.12–0.4 s) | 0.95 | 0.86 | 0.87 | 1.00 (69) |
| voice panned 0.5 | 0.76 | 0.58 | 0.65 | 0.67 (78) |
| legato, no pauses | 0.03 | 0.38 | 0.45 | 1.00 (4) |

The constants were tuned on this generator, so these are an upper bound; real songs will do worse, above all with loud
or centred lead instruments and legato singing. The release gate (tap a real song, redraft with 固定・タップした行も…,
read the agreement line; below a 50 % median the chip reads 「曲から下書き（試験的）」 by `DRAFT_BETA`) is the lead's.

**`audio/voice` (L1; deps `audio/fft`, `audio/digest`): the joint record with 歌ハメ (P6).** One pass per song gives
歌ハメ's vocal activity and peaks and this draft's phrase stream from the same spectra; `audio/analyze` is unchanged.
Per 10 ms frame (Hann 1024, centred, the first frame primed), mid M = (L + R)/2 and side S = (L − R)/2 (mono: S = 0),
over the band 250–3500 Hz: centred power per bin `c_b = max(0, |M_b|² − |S_b|²)`, `raw = dbToUnit(Σ c_b)·(1 −
flatness(c_b))`, and the band flux of `ln(1 + 1000·|M_b|)`. The activity `a` is `raw` median-filtered over ±40 ms and
normalized to the song (0 at its 10th percentile, 1 at its 95th). Phrase starts: a rise to 0.35 after ≥ 0.15 s below it
that reaches 0.55 within 0.3 s, moved to the strongest band flux in −60…+30 ms, strength = the rise × the pause (full at
0.5 s). Weak candidates: band-flux peaks ≥ half the 99th percentile inside voiced frames, ≥ 0.25 s from any phrase start,
strength ≤ 0.3. Vocal peaks (歌ハメ): local maxima over ±30 ms of onset × activity ≥ 0.2, ≥ 60 ms apart.

```js
doc.song.voice = { v: 1, hz: 25, act, peaks, phrases }   // base64 byte streams
// act[j]   = round(255 · min(1, mean of the activity frames 4j … 4j+3))              (25 Hz)
// peaks    = records (Δ centiseconds since the previous as unsigned LEB128, round(255·s))
// phrases  = records (Δ centiseconds LEB128, one byte: bit 7 phrase candidate, bits 0–6 round(127·s))
```

About 4.9 k characters per 90 s (3 k of them the activity). `core/doc`: `ORDER.song` gains `'voice'` after `'digest'`,
`ORDER.voice = ['v', 'hz', 'act', 'peaks', 'phrases']`, `checkSong` accepts an absent or null voice, else `{ v: 1, hz > 0,
act, peaks: strings, phrases: a string when present }`; not in `SONG_DEFAULTS`. The command `song.voice { sha1, voice }`
sets it for the song it was read from (another song: `CommandError('stale')`; `voice: null` removes it); `song.set` of a
new song replaces the record. `audio/host/decode.loadSong` runs the pass after the tempo analysis (progress 0–0.5 the
analysis, 0.5–1 the voice: the two cost about the same, 0.5–0.9 s per 90 s of 48 kHz stereo in Node) and puts the record
in the `song.set` record; `analyzeVoice(buffer, { signal, onProgress })` serves 曲の声を読む. Exports: `VC`, `analyze`,
`analyzeSync`, `encode`, `decode` (memoized by identity; `ph: null` without a phrase stream; a damaged record throws
`'format'`), `hasPhrases`, `isRecord`, `candidatesIn(dec, a, b)`, `peaksIn(dec, a, b)`, `voiced(cands, act, hz)` (the first
phrase start ≥ 0.4, else the first candidate; the last active frame + 0.5 s), `digestActivity(digest)`, `fromDigest(digest)`
(the phrase rule on the 20 Hz loudness, strengths halved). 歌ハメ adds its `activityEnd` here.

Why centred per bin: on the generator (whose accompaniment is nearly all centred) the mid alone finds as many phrase starts
or more; with a hard-panned lead playing phrases of its own, the centring keeps the voice's recall at 1.00 and takes none
of the lead's starts, while the mid alone falls to 0.25 and takes all of them (`voice.test.js`).

**`core/timing.gapWeights(lines, { readRate, bpm })`** → `w[i]` = line i's reading plus the pause above line i+1 (the last
line: its reading): the `gap(k)` of `solveTimes`. **`core/draft` (L0).** `draftStarts({ lines, cands, voiced, duration,
grid, snap, digest })` aligns each run of drafted lines between its anchors (before the first anchor from `voiced.t0 − 1`,
after the last to `voiced.t1`) onto the candidates plus fillers (every 0.25 s, or every half beat with a tempo; strength
−0.15), by a monotone dynamic programme: cost = −strength − beat bonus + 0.6·ln²(gap / prior gap) per step (the prior:
the run's span shared in the gap weights), the first line of a leading run pulled towards `voiced.t0`, gaps ≥ 0.12 s and ≤ 5
× the prior + 2 s, first strict minimum on ties. Beat snapping (±0.06 s) only where the order stays strict. `conf`: ◎ for
a phrase start ≥ 0.4 whose gap is 0.5–2 × its prior, ○ for other onsets, △ for fillers. Moves under 0.05 s are `kept`,
not proposed; runs without room are `skipped`. `agreement(res, tapped)` counts drafted tapped lines within 0.3 s. 80 lines ×
300 candidates run at the speed of a bare loop over the same 9 M steps (≈ 40 ms idle; 160–260 ms on the loaded test
machine).

**`ui/draft` (L7).** Pure: `input(doc, plan, { redo })`, `applyCmd(lines, res, checked)`, `checkedByDefault`, `counts`,
`drafted`, `DRAFT_BETA`. The panel `mount(app)` → `{ root, start, cancel, apply, active, marks, strip, tryOnReplaced,
phase }`; `ui/boot` mounts it next to the tap panel and defines `time.draft`, `draft.cancel` and `app.readVoice`; `ui/keys`
(context `draft`), `ui/view` (`MODES += 'draft'`), `ui/steps` (the panel for the mode), `ui/step_song` (the chip, without a
`data-ctl`: step ② keeps its five controls), `ui/timeline` (the ticks, redrawn on bus `'draft'`), `ui/palette`
(`draft.cancel` hidden), `ui/icons` (`wave`), `ui/tap` (no tap session over the review).

**Tests.** `voice.test.js` (recall and median error on 60 s mixes, reverb, the panned lead, determinism and progress, mono
and silence, the record's round trip and LEB128, windows, the voiced span, `fromDigest`, `audio/analyze` unchanged),
`draft.test.js` (exact candidates, the distractor, anchors and order under snapping, dense onsets, `MOVE_MIN`, fillers,
snapping, skipped runs, agreement, speed, end to end on three 90 s mixes through the stored record, `gapWeights`),
`ui_draft.test.js`, `doc` and `commands` cases (`song.voice`), `ui_keys` (the `draft` context), `i18n` (`draft.conf.*`),
the ui_flows flow `draft` (a stereo synthetic song loaded into the page: the chip, the review with the voice already read,
try-on and ticks, T/R swallowed, Esc records nothing, 適用 as one entry with tap pins, undo; a song without a voice record:
声を読んで下書き as its own entry 「曲の声を読む」, then the review).

### 5.3 S2: 1行だけタップで打ち直し

**What the user gets.** 「この行だけタップで打ち直す」 starts the tap panel in a one-line mode on one line, from four
places: 詳細 › 行 › 時間 (one line selected; hint 「2秒前から再生します。歌い出しでスペース」), the timeline's line menu
(right-click on a line block, or the menu key / Shift+F10 on a focused line of the timeline's list: 「この行だけタップで
打ち直す」, 「この行からタップで合わせる」, and 「開始の固定を外す」 while the start is pinned and not by a lock), ② 曲's chip
「{n}行目だけ打ち直す」 (one line selected; the big button's hint becomes 「{n}行から・スペースで記録・Escで終わる」) and the
palette (`tap.line`: the selected line, else the line at the playhead). The normal tap mode is unchanged.

The one-line panel: title 「この行だけ打ち直す」, the line's text, the hint 「歌い出しでスペース（またはタップ）。終わりも
打つなら E」, the checkbox 「前後の行を動かさない」 (on by default; the device preference `prefs.tapKeep`) and the keys
Space/Enter 開始, E 終わり, Backspace 打ち直す, ←/→ 3 s, P, Esc/T 終わる. Playback starts 2 s before the line's current
start.

- **Before the mark playback loops:** past `max(line end, next line's start) + 1.5 s` it seeks back to 2 s before the
  line, at most 5 times; then it rewinds, stops and says 「止めました。もう一度は ▶」. The loop ends for the rest of the
  session as soon as the user moves the playhead (a jump of the clock by more than 0.5 s that the session did not make:
  ←/→, a click on the timeline or the play bar) or pauses, so a line sung much later than its current start can be
  reached by seeking.
- **One mark** is taken; a second press says 「この行は記録済み。打ち直すなら Backspace」. After the mark the panel
  counts down 「{s}秒後に自動で終わります（Escで今すぐ・Eで終わりを記録）」: the session ends by itself at
  `stopAt = min(m + 12, max(m + 1, m + old length + 0.5, next line's old start + 0.5 when still ahead))`, or 0.3 s after
  E, or at once on Esc / T / 終わる. Backspace forgets the mark and loops again.
- **The result is one undo entry** 「この行を打ち直す（{n}行目）」: when the line had a paired start and end pin (neither a
  lock pin) and no E was pressed, `pin.set` of the end moved by the same delta (never past the end of the video; not
  moved when it would end less than 0.2 s after the start; its `by` kept); the `time.tap` of the mark; and, with 「前後の行を動かさない」, start
  pins by 'user' that keep the other automatic lines where they were (below). The toast joins what applies (ja without
  a separator, en with a space): 「{n}行目を打ち直しました。」「{list}行目の開始を今の時刻で固定しました。」「ほかに{m}行の
  自動の時刻が動きました。」 (warn) 「終わりの固定も同じだけ動かしました。」「終わりの固定を外しました（新しい開始より前だった
  ため）。」, with 「再生して確認」 and, when lines were pinned, 「ほかの行の固定を外す」 (one undo entry 「ほかの行の固定を外す
  （{n}行）」 clearing those pins that are still as the re-tap left them).

**`core/tap`.** TapState gains `only`, `from` and `stop` (`from + 1` in the one-line mode, `lineIds.length` otherwise);
`tapStart(lines, fromLineId, { only })`; `mark` is refused at `cursor ≥ stop`, `back` at `cursor ≤ from` in the one-line
mode; `done(s)`. `stillPins(before, after, lineId, start)` (before / after: `plan.lines` without and with the re-tap, the
same ids in the same order): the automatic lines other than the target whose start moved by ≥ `STILL_EPS` (0.005 s)
form runs; the first and last line of each run are pinned at their old starts when that keeps the order with the new
start (at least `MIN_GAP` 0.12 s from it). Between two anchors `core/timing` places automatic starts linearly in their
weights and the fills are linear maps, so pinning a run's ends puts it back; a new anchor can re-compress a forward fill
and beat snapping can move a start by a grid step, so `ui/tap` repeats with a new trial plan up to three rounds. The
lines the new start crossed must move and are counted in the toast.

**`core/commands.timeTap` (every tap session and S1's drafts; a bug fix for existing works).** A mark with a start and no
end removes the line's end pin when it is earlier than `start + MIN_LEN` (0.2 s; `core/timing` exports `MIN_LEN`), unless
it is a lock pin: before, `core/timing` silently shrank such a line to 0.2 s. Undo restores it.

**`ui/tap`.** `start({ only: lineId })`, `start({ from: lineId })` (the timeline's この行からタップで合わせる); the
session follows bus `'time'` (every frame while playing, every seek and pause); the pure rules are exported as `TS`
(`loopAt`, `stopAt`, `userSeek`, `endShift`, `ONLY` constants). `ui/boot` defines `tap.line`; `ui/view` gains
`prefs.tapKeep`; `ui/fields` gives 行 › 時間 the custom section `timeTools` (with S4's notes, §5.4).

**Tests.** `tap.test.js` (the one-line mode; `stillPins` on runs, order conflicts and different lists),
`tap_keep.test.js` (5 scenarios × snap off / 120 BPM beat: only the lines the tap crossed move, in at most three rounds;
after the last anchor one or two rounds are not enough), `tap_session.test.js` (the pure session rules),
`commands.test.js` (the stale end pin), `ui_fields.test.js` (`timeTools`), the ui_flows flow `retap` (the 行 page button,
the loop ended by a seek, a mark 5 s late, the refused second press, E, one undo entry, the pinned neighbours and
「ほかの行の固定を外す」, undo; a paired start and end re-tapped without E; the timeline's line menu by mouse and key).

### 5.4 S4: 読み切れない速さの行を知らせる

**Gating.** `ui/readcheck.enabled(doc)`: an explicit `timing.readCheck`, else `look.gen ≥ 1` — on for new works, off for
existing works and every fixture, with the switch 作品全体 › タイミング › 「読み切れない速さの行を知らせる」 (a toggle
after 入りの基準, with a note; `timing.set` writes a boolean, one undo entry named by the field).

| Item | Notices on | Notices off (existing works) |
|---|---|---|
| too-fast | gutter 「!」, 行 list 「!」, timeline bar, 行 page note and fixes, step ④ item | not computed |
| `time-compressed` | a gutter 「!」 on every line of the squeezed range | today's 「!」 in the 行 list on the range's first line |
| `piece-merged` | a gutter 「!」 | today's 「!」 in the 行 list |
| texts | tooltips and the 行 page notes | tooltips and the 行 page notes on the marks that exist today |

**The rule — `planner/readable` (L2, a pure reader of a finished Plan, never in the Plan or its hash).** For each line
cut: `units = S.morae(text, lang)`; `V = b − a` (the final window); `A` / `L` the entrance / exit as the scene fits them
(`core/motion.fitMotion` with the part's unit count, `SHARE`, and for A the 出そろい cap `ready − a`; 0 for the fallback
parts and for an entrance revealed as sung); `W = V − A/2 − L/2`, cut to `at − a − A/2` by an outgoing transition
(`at − dur/2` for one whose definition moves the glyphs themselves, `glyphs: true`, §4). Flagged when `units ≥ 4` and
`units / W > MAX[lang]` (ja 12, ko 12, zh 10, en 11), or `units ≥ 2` and `W < 0.25 s`. A 歌ハメ cut (§6: `cut.sung` and
arrive order 'sung') is flagged when it leaves less than 0.4 s after its last character. `check(plan, registry)` is
memoized per plan object. The fixtures (7 × 3 seeds × 3 aspects) and the app's samples flag nothing: the automatic timing
reads at most about 10 units per legible second; two automatic lines squeezed between LRC stamps 1.5 s apart read at 20.

**`ui/readcheck` (L7).** `readWarnings(doc, plan, registry)` → `{ code: 'too-fast', line, cut, detail: { rate, units,
legible, limit } }` (nothing when off); `expand` repeats a `time-compressed` warning on every line of its range (the later
ones with `detail.of`); `gutterCodes(doc)`; `byLine(warnings, plan, codes)` → per line the warnings of those codes, one per
code (the fastest too-fast), most severe first (`time-order`, `overfull`, `lock-partial`, `orphan-pin`, `shadowed-pin`,
`pin-not-applicable`, `too-fast`, `time-compressed`, `piece-merged`); `textOf`, `titleFor`; the quick fixes `quickerCmds`
and `endFix`. `app.warnings()` adds the notices and the expansion when on, so the lyric editor, the 行 list, the 行 page
and step ④ read one list; the timeline reads `readWarnings` itself (it draws every frame).

**Where it shows.** The gutter 「!」 (class `is-<code>`, one tooltip row per text, the first text in the aria label);
the 行 list's 「!」 gets the same tooltip; the timeline draws a red bar (`#ff7a7a`, the gutter's error color, with a dark
edge) along the bottom of the line block and 「!」 at its end, and the listbox label ends with 「速すぎて読み切れないかも
しれません」; 行 › 時間 shows 「速すぎて読み切れないかもしれません（1秒に約{n}音・読める時間 {s}秒）」 with
[動きを速くする] (line pins `arrive.dur 0.2`, `arrive.each 0.01`, `depart.dur 0.15`, `depart.each 0` by 'user', one
undo entry 「読みやすくする（動きを速く）」) and [終わりを延ばす] (when the line's last cut is followed by a gap, an
interlude or the outro: `line/<id>:end` at `min(next start − 0.3, end of video − 0.5, t1 + 1.25·(need − W))`, `need =
max(units / limit, 0.25)`, shown when it gains ≥ 0.05 s), next to S2's 「この行だけタップで打ち直す」; the squeezes
explain themselves there (「前後の固定に合わせて、行の間隔を詰めています」, 「短すぎる区切りを前とまとめました」). Step ④:
one warn item 「読み切れない速さの行が{n}行あります（{list}）」 (the first five line numbers, then 「ほか{m}行」) with [見る]
on the first cut (`export/schedule.warningItems`).

**Tests.** `readable.test.js` (the fixtures and the samples flag nothing; the LRC squeeze; the legible floor before a
transition; the outgoing transition and a glyph transition; the sung order and `cut.sung`; the English limit and the
出そろい cap; plan vs scene within ±20 % for ≥ 98 % of cuts; the memo), `ui_readcheck.test.js`, the step ④ item in
`export_math.test.js`, `ui_fields.test.js`, `i18n.test.js` (`too-fast`), the ui_flows flow `readcheck` (a new work's
squeezed lines in the gutter, the 行 list, the timeline, the 行 page fix, step ④ and the switch; an opened older work).

### 5.5 Rules of DESIGN and DESIGN_2_1 this chapter changes

This chapter wins over the sections below (the texts there still describe v2 / v2.1; the lead folds them in).

| Section | Change | Here |
|---|---|---|
| D§3.1, §3.2 | `timing.enter`, `timing.readCheck` (optional keys after `tapLatency`); `newDoc()` writes `timing.lead` 0.2 | §5.1, §5.4 |
| D§3.12 | plan cut `ready` (optional), printed between `pinKey` and `repT`; fingerprint term `'r' + q6(t0 − ready)` | §5.1 (e) |
| D§3.12 b, §4.16.6 | the long-lead hand-over (three tiers; `endWithSeam(…, handover)`) | §5.1 (b) |
| D§3.13 | warning code `too-fast` (UI-computed, never in `plan.warnings`) | §5.4 |
| D§4.7 | `fitMotion({ …, cap })`; `heroTime` reads `cut.ready` | §5.1 (d) |
| D§4.11 | `core/tap`: the one-line mode, `done`, `stillPins`; `time.tap` drops a stale end pin; `core/timing` exports `MIN_LEN` | §5.3 |
| D§4.16 | stage 6b `readyWindows`; `segment.windows` neighbour clamp | §5.1 (a), (c) |
| D§4.17.5 | `times.ready`; the arrive capped by it | §5.1 (d) |
| D§4.21 | step ④ item `too-fast` | §5.4 |
| D§6.4.5, §6.4.6, §6.4.13, §6.4.14, §6.4.15 | 作品全体 › タイミング rows; 行 › 時間 `timeTools`; the timeline's line menu and too-fast bar; the gutter's codes and tooltips; the one-line tap mode | §5.1, §5.3, §5.4 |
| DESIGN_2_1 §14 | the EXTREME whipPan pair needs the whips to meet outside legacy documents | §5.1 (f) |
| D§3.1 (song), §3.9 | `doc.song.voice` (optional, ordered after `digest`); the command `song.voice` | §5.2 |
| D§4.11 | `core/timing.gapWeights`; `core/draft` (曲から下書き) | §5.2 |
| D§4.13 | `audio/voice` (the joint voice pass and record); `loadSong` reads the voice at import; `analyzeVoice` | §5.2 |
| D§6.4.3, §6.8, §6.4.13 | ② 曲's chip 「曲から下書き」; the key context `draft`; the timeline's draft ticks; the review panel (new) | §5.2 |

<!-- PV22 P6 chapter -->
