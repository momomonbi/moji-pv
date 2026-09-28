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

## 3. キメ (M3): the line the user wants bold

A line the user marks キメ plays boldly: as one cut, in a big layout, set big in the heading face, landing fast, holding
still and cutting out, with the camera matched to the layout and quieter cuts before it. It never flashes or shakes
unless it is also 見せ場 (`!`); the two marks combine.

### 3.1 Decisions

| Question | Decision |
|---|---|
| The mark | A line pin `line/<id>:kime = true` (slot `kime`, line scope only). No lyric syntax: the row text and the FROZEN row grammar are untouched. Set by the 行 toggle 「キメ」 (and the multi-line toggle, the same-lyric button, optionally the AI). |
| Gating | By construction: no existing, imported or fixture document has a `kime` pin; absent = off. Nothing is written by `newDoc()`; no `look.gen` dependency. |
| 「キメの前を静かにする」 | `work:kime.calm` (bool, work scope only), a row of `planner/rules` that is on in every generation (`on = off = true`); read only when the plan has a キメ cut. |
| Guarantee mechanism | A キメ cut's automatic picks are restricted to キメ sets (each set filtered by the cut's own pool; an empty set leaves the chooser as usual: `kime.limited`), some values are rules (`from: 'rule'`), forced parts are always `registry.fallback(kind)`. Pins and locks win everywhere. |
| The shared flag | `planner/kime isKime(cut)`: the skeleton's `kime` during stages 3–6, `feat.kime` on a Plan cut. Stage 1–3 code reads `line.kime`. Nobody reads the pin directly (a long line's pin does not make every piece キメ). |

### 3.2 Data model

- Pins: `line/<id>:kime` (bool; only `true` acts; `false` = absent; another value warns `pin-bad-value`),
  `work:kime.calm` (bool; absent = on). `core/commands`: `kime` is refused at cut and work scope, `kime.calm` outside
  work scope; `pin.promote` refuses both; `pin.clearUnder` without `by` (すべての固定を外す, この行の固定を外す) keeps
  them (they are settings, not look choices), with `by` the author decides as for any pin; `pin.copy` never copies them.
- Line (stage 1, planner-internal): `planner/plan withKimePins` sets `kime: true` on a marked line (like `lang`); the
  same array comes back when no `kime` pin exists. `plan.lines` does not print it.
- Cut skeleton (`planner/segment`): `kime: boolean` on every cut (`false` on special cuts), `true` only on the キメ cut;
  `splitFrom: 'kime'` for a line kept whole by the rule.
- **CutFeatures (§4.16.7, FROZEN, additive):** optional `kime: true` on the キメ cut and `calm: 1 | 2` on the cuts
  before it, present only where set and inserted in sorted key order, so every other cut keeps its bytes.
- No new decision slot: restricted picks are `from: 'auto'`, forced values `from: 'rule'`, rule parameters
  `pfrom[name] = 'rule'`. No migration, no schema bump.

### 3.3 Algorithm (constants in `planner/kime`)

**(a) One cut.** A キメ line of at most `kimeMaxCells(aspect) = min(30, 2 · BASE[aspect])` cells (16:9 28, 21:9 30,
4:3 24, 1:1 and 4:5 20, 3:4 18, 9:16 16) is one cut, whatever its `/` marks or the auto cutter would do; a split pin
(the user's or a lock's) wins. A longer line keeps its pieces and its focus piece, else its last piece, is the キメ cut.
Pins made on the pieces the line had before are not applied to the one cut: only `<line>~0` pins whose sig is the whole
line attach; the others are reported `shadowed-pin` (付け直す moves them) and attach again when the mark goes.

**(b) The hold.** `core/timing solveTimes`: a キメ line reads `KIME_HOLD` = 0.6 s longer (the next automatic start
moves; anchored starts do not). A line whose last cut is its キメ cut holds into a following interlude or the ending by
`clamp(min(1.5, room − 3), 0, 1.5)` (the special cut keeps ≥ 3 s); its window stays up until the special cut starts.

**(c) The キメ cut (`planner/cast`, FROZEN slot order).** Every rule applies only where the slot is not pinned, in every
pass (a fact of the cut).

| slot | rule |
|---|---|
| `arrange` | set `edgeBleed`, `giantWhisper` (はみ出し only for 2–12 cells). Params by rule: `edgeBleed` overflow 1.08, anchor `center`; `giantWhisper` ratio ≥ 3, tuck `under` |
| `text.face` | `display`, rule `kime.face` |
| `text.scale` | `edgeBleed` 1 (rule `kime.full`); `giantWhisper` max(auto, 1) (rule `kime.full` when raised); any other layout 1.3 (rule `kime.scale`) |
| `arrive` | set `stampPress`, `zoomSettle`; `dur` ≤ 0.4, `each` ≤ 0.1 / 0.03 and small enough that the line lands within 0.8 s; `stampPress.shake` 0 unless 見せ場 |
| `dwell` | set `stillHold` (with a tempo also `thumpSwell`) |
| `depart` | `registry.fallback('depart')` (即消), rule `kime.depart` |
| `ornament.count`, `filter.count` | at most 1 (+ the 見せ場 effect), rule `kime.count` |
| `lens` | the camera moves (a shot pin, EXTREME on a layout with camerawork, or the shot the rules give): `registry.fallback('lens')` (固定), rule `kime.lens`; it does not: set `impactKick` (shake 0 unless 見せ場), else the fallback |
| `filter#i` | without 見せ場: no screen effect with `gate: 'flash'` |
| `cam.shot` | after the rules that stop the camera: forced, rule `kime.shot`, the first of `snapZoom, pushWord, settle, none` (with an emphasis `pushWord, settle, none`) the pool allows (`planner/camera kimeShot`, which the lens rule also reads) |
| `cam.curve` | the impact curves |

A set is the members that are in the cut's own pool; empty → the usual chooser (trace `kimeLimited`, why
`kime.limited`); when every member weighs 0 the first member by rule (`kime.set`). The camera invariant: the lens is
the 衝撃 punch-in exactly when the final shot is `none` (on registries that have it).

**(d) Calm before the hit (stage 4 → cast).** The cut right before a キメ cut gets `calm: 2`, the one before that
`calm: 1`, within 4 s of the キメ cut's start, never a キメ cut, never across a special cut. Level 1 / 2: ornaments ≤ 1 / 0,
screen effects ≤ 1 / 0 (+ 見せ場), the chooser factor on arrive, dwell, depart and lens (strong ×0.5 / ×0.15, soft
×1.5 / ×2.5; `planner/kime calmFactor`, traced `f.calm`), text ×0.97 / ×0.94; level 2 also: no `shake` or `beat` lens,
the quiet shots `none, settle, driftOff, wideHold` where the pool has one, EXTREME presets tagged hard or fast ×0.2.
Pins, locks and 「くり返しの行をそろえる」 copies are not calmed.

**(e) Stage 6.** Into a キメ cut the hard cut by rule (`kime.seam`) unless pinned. Out of a キメ cut without 見せ場 into a
cut without 見せ場, no transition with `gate: 'flash'` (白く飛ぶ); the seam memo keys on it. Carry never goes into a
キメ cut. EXTREME: a キメ cut where the switch is on takes the first of `crashZoom`, `punchHit` in its EXTREME pool
(`kime.x`), else the usual pick; はみ出し has no pool and keeps `none` + 衝撃. Impulses: unchanged (見せ場 only).

**(f) 「くり返しの行をそろえる」.** A copy aligns with its source only when both are キメ or neither is.

**(g) Explain.** Restricted picks: why `kime` first (or `kime.limited`), alternatives outside the set masked `kime`;
filter picks `kime.noFlash`; the seam out: rule `kime.noFlash`; calm factors `kime.calm`; rule values `kime.face`,
`kime.scale`, `kime.full`, `kime.depart`, `kime.lens`, `kime.shot`, `kime.count`, `kime.seam`, `kime.calm`, `kime.x`,
`kime.set`; parameters set by a キメ rule `kime.param`; the split of a line kept whole `kime.split`.

### 3.4 Other packages

- P2: `ctx.pv.kimeAt(cut)` is `KI.isKime(cut)`; on a キメ cut P2 applies nothing of its own (no arc blend, kit or
  lettering factor, shot factor, flip, mirror alternation; T5 never lowers its counts, gates its seam or trims its
  impulses). The M1 alignment condition is shared (text, role, impact, キメ).
- P4: an automatic morph seam never lands into or out of a キメ cut (the hard-cut rule runs first into it); where P4's
  `text.weight` slot exists P3 sets the heaviest weight ≥ 700 the face has, by rule `kime.face`.
- P5: `KIME_HOLD` sits in `solveTimes` next to P5's lead.
- P6: automatic 歌ハメ is off on キメ lines (`line.kime`); where 歌ハメ applies (the cut state `hame`, with its entrance
  set `hame.arrive`), the entrance set is `KIME.arrive ∩ hame.arrive` when not empty and the `dur`/`each` caps step
  aside; every other キメ rule stays.

### 3.5 Where the user sets it (UI, lyrics, AI)

- **③ 見た目 › 行 › 文字の記号**: the toggle 「キメ」 right under 「見せ場（!）」, with its note. On pins `true`, off
  clears the pin (`offClears`); no 振り直し (`noDice`). Under it a custom block (the field flag `after: 'kimeInfo'`, drawn
  and refreshed with the section's customs) shows, from `ui/fields kimeInfo(plan, doc, lineId)`:
  - 「この作品のキメ: n行」 only when the work has a キメ line (counted from the Plan: a line with a `feat.kime` cut, so
    a pin that does not apply counts none);
  - 「キメが多すぎると、どれも目立たなくなります（目安は{max}行まで）」 when n exceeds `guideline(lyric lines)` =
    max(3, ⌈15 % of the lyric lines⌉) — a hint, not a Plan warning, so no plan hash depends on the count;
  - 「この行は長いので、カットは分けたまま「…」を大胆に見せます」 when this line is キメ and keeps several cuts;
  - 「同じ歌詞の行（n行）もキメにする」 when this line is キメ and other lines sing the same words without their own
    mark: one `pin.set` per line in one batch (one undo step, `undo.kimeSame`).
- **③ 見た目 › 複数行**: the same toggle next to 見せ場, writing one line pin per selected line in one step. The row reads
  every selected line's state (the field flag `readEach`) and shows いろいろ (the switch's indeterminate state) while
  they differ.
- **③ 見た目 › 作品全体 › 見た目 › 詳しい設定**: 「キメの前を静かにする」, on by default. Off pins `work:kime.calm =
  false`; on clears the pin (the new field flag `onClears`, the mirror of `offClears`: a default-on toggle whose on is
  自動).
- **① 歌詞**: the gutter shows 「キ」 on a line whose `line/<id>:kime` pin is true (its title and accessible name say
  キメ); the pin count beside it leaves the mark out. The `/` marks of a row whose every line plays as one キメ cut are
  drawn dimmed (the highlight `tok-cutOff`; rows are re-inked when that changes); the 記法 list gains 「キメ」 —
  「一行を大胆に見せる印（見た目 › 行 で付けます）」. On such a line the 区切り row reads 自動 (not 記号), and its なぜ
  says 「キメの行は1カットで見せる」.
- **Pins on the pieces**: pins a line's pieces had before it was marked are listed in 作品全体 › その他 (the existing
  list of stray and hidden pins, `shadowed-pin`) with 消す and このカットに付け直す, which moves them onto the キメ cut
  with its text as the sig; they apply again to their pieces when the mark goes.
- **Unpin**: すべての固定を外す and この行の固定を外す keep the marks and 「キメの前を静かにする」; AIの固定を外す removes
  the marks the AI set.
- **AI (optional; everything works without it)**: each line of an AI 演出3案 proposal has `kime: "" | "on" | "off"`.
  At most one `on` per proposal (later ones are dropped with 「{n}行はキメにしませんでした（キメは1案に1行まで）」); `on`
  on a line without the mark and `off` on a marked line become a `value` change of `line/<id>:kime` (`true` / cleared;
  applied as `pin.set … by: 'ai'` / `pin.clear`), shown as 「{n}行 · キメにする」 / 「{n}行 · キメをやめる」 in the
  review; a locked line keeps its look. ひとこと修正 and the direct tool have no キメ field (their schemas are unchanged).

### 3.6 FROZEN contracts touched

§4.16.7 CutFeatures (optional `kime`, `calm`); §4.16.4 the chooser (optional `calm` factor and `only` pool
restriction). Not touched: the row grammar, ParsedRow/Line, POSE columns, the seam mix, SCH enums, the slot order, the
Plan shape, `planner/encode`, shot presets, stream-seed names. Goldens: every existing one is byte-identical; the new
`tests/golden/project_kime.json` holds the plan hashes of marked documents. The AI 演出3案 answer schema gains the line
field `kime` (its hash in `ai_looks.test.js` moves); ひとこと修正's schema is unchanged.

<!-- PV22 P4 chapter -->

<!-- PV22 P5 chapter -->

<!-- PV22 P6 chapter -->
