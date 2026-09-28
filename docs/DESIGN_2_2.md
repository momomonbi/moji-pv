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

<!-- PV22 P5 S1 S2 S4 -->

<!-- PV22 P6 chapter -->
