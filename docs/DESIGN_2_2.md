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

## 2. 文字PVの定石 (M1, M2, T5)

M1 パートごとに演出をそろえ、くり返す歌詞は同じ見せ方で戻ってくる, M2 動きの配分や方向の交互など、文字PVの定石を組み込み,
T5 効果を重ねすぎない. What existed: 「くり返しの行をそろえる」 (DESIGN_2_1 §4.10) as an opt-in, the chooser's recency
(§4.16.4) and the camera's section weights (DESIGN_2_1 §4.7). What v2.2 adds: the conventions on by default in new works,
a set of looks per song part, the arc of the song, alternating directions and (phase B) an effect budget. The package ships
in three gated phases: **A** (this text: the switches, repeats by default, the kit, the arc, directions of parts and
seams, the UI rows), **B** (T5: the lettering rule, then the cut budget) and **C** (camera alternation: mirrored framed
shots, push-in / pull-back alternation, EXTREME mirror alternation). Each phase leaves every legacy golden identical.

### 2.1 The switches

One group switch with members; all live under 作品全体 › 見た目. A member without its own pin follows the group; the group
without a pin follows the document's generation (§0), so a new work has them on and an older one off, and
作品全体 › 固定を外す returns them to that default.

| slot (work pin) | UI | type | default when unpinned | phase |
|---|---|---|---|---|
| `pv.rules` | 文字PVの定石 | bool | `look.gen ≥ 1` | A |
| `repeat.same` | くり返しの行をそろえる (keeps its line choice) | bool | value of `pv.rules` | A |
| `pv.kit` | パートごとに演出をそろえる (詳しい設定) | bool | value of `pv.rules` | A |
| `pv.alternate` | 動きの向きを交互にする (詳しい設定) | bool | value of `pv.rules` | A (parts, seams); C (camera) |
| `pv.arc` | 曲の山に合わせて強弱をつける (詳しい設定) | bool | value of `pv.rules` | A |
| `pv.fxCap` | 効果を重ねすぎない (詳しい設定) | bool | value of `pv.rules` | B |
| `pv.fxMax` | 1カットに重ねる効果の目安 (詳しい設定) | int 4–8 | automatic: `3 + round(3 · amount.pace)` | B |

- **Scopes.** Every `pv.*` slot is work scope only: `core/commands checkSlotScope` refuses it at a line or a cut ("can be
  pinned only for the whole video"), and `lock.set` goes through the same check. `repeat.same` keeps its work and line
  scopes. A switch pin takes only `true` / `false` and `pv.fxMax` only an integer 4–8; anything else warns
  `pin-bad-value` and the default applies (`planner/rules` accept functions).
- **Resolution** (`planner/rules resolve(ctx)`, planner stage 2 → `ctx.rules`): frozen `{ gen, rules, repeatDefault, kit,
  alt, arc, fx, fxMax, any, id }`; `any` = one of kit, alt, arc, fx is on; `id` (e.g. `g1|r1|k1a1c1f1|m-`) joins the cast
  cache's look key. `repeatDefault(doc, ix)` = the value of `pv.rules` (false without a document).
- **UI.** Toggles with `autoDefault`: choosing the document's default clears the pin (自動), the other value pins it (one
  command, one undo step). `planner/fields` gives every row of the table at work scope the category `'rule'`: value = the
  work pin or the default (never a cut's), state `pinned` / `auto`, `autoText` 「新しい作品の標準」 or
  「この機能より前に作った作品なので、はじめはオフ」 where new and older works differ, which the inspector shows under the row
  (`p.fr-auto`). A number row shows its `autoText` as the box's placeholder (自動（4）).

### 2.2 Hooks: `ctx.rules`, `ctx.pv`

New planner modules (L2): `planner/rules` (the table, §0), `planner/arc` (parts, keys, runs, drive, strength),
`planner/kit` (sets of looks), `planner/flow` (directions), `planner/conventions` (builds `ctx.pv`; phase B adds
`planner/fxcap`). `planner/camera`, `planner/tracks`, `planner/extreme` and `planner/choose` import none of them: they
read `ctx.rules` / `ctx.pv` only, which are all-off / `null` for an older document, so its plan is byte-identical.

`ctx.pv` (planner stage 4, when `ctx.rules.any`): `on`, `partOf(cut)`, `featOf(cut)` (the arc's blended features),
`seamEnergy(B)`, `idOf(cut)` (what P2 adds to a cut's cast inputs: its part, run start, drive and kit id; `castInputs.pv`),
`partFactor(st, kind)` (`{ f, member, block }` for the chooser), `groundFactor(first)`, `faceBoost(st)`, `avoidAlso(kind)`,
`flipParams(…)`, `dirOf(st)`, `flipSeam(…)`, `seamDir(d)`, `shotFactors(st)`, `arcWhy`, `kimeAt(cut)` (P3's mark, `cut.kime`
or `feat.kime`), `summary()` → the non-enumerable `plan.pv = { on, pseudo, neutral, kits, parts }` (the inspector's 区画
page and tests; not hashed).

### 2.3 Song parts and the drive (`planner/arc`)

- **Real sections**: `cut.feat.section` (the song analysis at t0, else the heading above). With two or more kinds among
  the lyric cuts, a part's key is its kind (サビ1, サビ2 and 大サビ share `chorus`; no section → `none`). With one kind (a
  song headed 1番, 2番…) each run is keyed by the heading row it sits under, `'h' + rowId`, or by its analysis section,
  `kind + ordinal`.
- **Pseudo sections** (no section anywhere): blocks of lines between blank rows; a block joins the group of the earliest
  block with the same first line or sharing half of its lines; groups of two or more blocks are choruses, the others
  verses; key `'b' + rowId` of the group's earliest block. No group comes back → every kind is null: a **neutral** song
  (the arc does nothing; the kit still works per group).
- Keys are content-based (row ids are stable), never ordinals: inserting, deleting or splitting a block elsewhere renames
  no part and moves no salt. A row id that is not `[a-z0-9]{1,24}` is replaced by `'x' + hex8(hash32(id))`.
- **Runs**: consecutive lyric/focus cuts with one key (a special cut ends a run). **Drive** per lyric cut:
  `DRIVE[kind]` (intro .30, verse .35, prechorus .55, chorus .75, bridge .45, interlude .30, solo .60, outro .30, other
  .50; null kind .50); +.15 in the last chorus run (peak), +.10 on the first cut of a chorus run (サビ頭), at most .25 on the
  cut right before a chorus run (ため), at least .80 on an impact line and .85 on a キメ line; q2; .50 everywhere in a
  neutral song.
- **Strength** of a part or shot preset: +1 when strong (`fast`, `hard`, `bold` or made for impacts) and not calm, −1 when
  calm (`soft`, `slow`, `minimal`, `airy`) and not strong, else 0 ('none' shot: calm).

### 2.4 M1: repeats by default and the set of looks

- **Repeats.** `planner/cast alignments` aligns wherever a pin says so or, without one, where `repeatDefault` is on;
  `ai/direct.followSources` passes the document, so an AI answer on a new work drops its changes to later copies as on a
  work that pins the switch. `decideRepeat` is unchanged (it records only pins).
- **Kit selection** (`planner/kit select`, once per part key and plan): for each of arrange, arrive, dwell, depart, lens,
  filter, ornament and ground, the groups (a family, or the part key for decorations and backgrounds) of the part pool
  (`CA.poolOf` as a lyric cut sees it) weigh Σ statics × traitFit(energy = DRIVE of the part's kind) × the part's own fits
  on a typical cut (energy, the song's beat, not an impact, two words, eight cells, no composition chosen); ranked by
  `ln W + gumbel(hash32('kit', look.seed, key, kind, salt))` (ties to the smaller name), salt = `work:kit.<key>`. The kit
  keeps the best 3 layouts, 3 entrances, 3 exits, 2 holds, 2 camera textures, 2 screen effects, 4 decorations and 2
  backgrounds; the best group of each kind is its **primary**. The face class is drawn 3:2:1 display/serif/body.
- **Weighting** (a new chooser term, only under the rules): a primary member ×16, another member ×8; a member keeps only
  the ×0.03 against the previous cut's value (the near and family factors are dropped for it, final and reference pick
  alike); holds and camera textures also pass over the previous cut's value (the §8.2 runner-up rule, `KIT_AVOID`); the
  automatic face weighs ×8 for the kit's class; a segment's background weighs by its first cut's part. A kit never
  filters a pool.
- Precedence: pins and locks > rules > the aligned source of 「くり返しの行をそろえる」 > the kit-weighted chooser.
- UI: the 区画 page (「n行を選択中」 of a song area) has the section 演出セット: 「この区画の演出セット」 with the layouts,
  entrances and exits (each group by its first part) and the face class, and a die 「演出セットを振り直す」 that bumps
  `work:kit.<key>` for every part of the area (one undo step). The inspector's why names 「サビの演出セットに合わせた」 (or
  「このまとまりの演出セットに合わせた」).

### 2.5 M2: the arc and alternating directions

- **Arc.** Where the song is not neutral, a lyric cut's choices weigh by blended features (energy = q3(½ feat.energy +
  ½ drive); memoized by features id and drive for the last two cached plans); `feat` itself (in the Plan) never changes. A
  strong part weighs ×(0.4 + 1.2·drive), a calm one ×(1.6 − 1.2·drive), for layouts, entrances, holds, exits, camera
  textures and the cut's own shot weights; a transition's chance reads B's blended energy (a special cut blends with 0.30).
  EXTREME, rigs, impulses and the motion speed are not touched.
- **Directions** (`planner/flow`). A table of directional parameters (`DIR`): axis `h` (the travel the viewer sees),
  `side` (where the text sits) or `rot` (the turn), with guards:

  | part | params | axis | guard |
  |---|---|---|---|
  | arrange sidebarIndex / cornerNote / creditFold / edgeBleed | side / corner / corner / anchor | side | horizontal text |
  | arrange tiltedCard | tilt (\|v\| ≥ 1) | rot | — |
  | arrive twirlArrive, depart twirlDepart, lens parallaxOrbit | dir | rot | — |
  | arrive skewSlide | xFrom, kxFrom | h | horizontal, one-word cuts |
  | depart windBlow (order sweepX ↔ tail), skewExit (xTo, kxTo; order lead ↔ tail) | | h | horizontal text |
  | dwell slowDrift, lens driftFloat | angle (mirrored around the vertical) | h | — |
  | lens panSweep | dir (the camera pans right: the picture travels left) | h | — |
  | seam swishCut, shoveAcross | dir | h (seam history) | — |

  In a cut (after the parameters, the motion speed and an aligned copy's values): a value that is pinned, set by a rule,
  drawn by its own die, guarded or copied from an aligned source is kept and gives the cut its direction on that axis;
  otherwise it takes the cut's own direction when the cut already has one (probability 1), else it is turned against the
  first nonzero sign of the two previous cuts (probability `P_FLIP = 0.9`, stream `pv.flip.<part>` under the slot seed),
  except on a **restart** cut: no part, the first cut of a part run, or 1 cut in 4 by `hash32('pv.restart', look.seed,
  cut key) & 3 = 0` (never moved by a reroll or an insert). A turned value is coerced by its spec and marked
  `pfrom[name] = 'alt'`: a lock pins it as it is (`fields.putParams`), an aligned copy takes its source's value
  (`copyParams`, like `'rule'`), explain says `pv.alt` / `pv.altSame`, and the row stays 自動 (never 'derived').
- History rows carry `dir` (packed signs `(h+1) + 3(side+1) + 9(rot+1)`, 13 = none) from the lock-free view; the cast
  cache compares `dir` in the two rows before a cut (`ROW_FIELDS`). Seams: the same rule on the seam history (the latest
  nonzero `dir` of the last three boundaries), not on pinned, copied or salted seams; `entryOf` records `dir` and the seam
  memo compares it.
- A change travels along consecutive directional cuts and stops at a cut without a direction for two rows, a part run's
  first cut, a special cut or a restart (expected ≤ 4 cuts; parameters only).

### 2.6 FROZEN contracts touched

- The chooser (D§4.16.4) gains optional terms, active only under the rules: the part factor `req.pv.f` in the static
  weight and the recency relax for kit members (phase B: the lettering block with its fallback).
- Decision `pfrom` gains the value `'alt'` (documented next to `'rule'`).
- History rows and seam entries gain `dir`; `ROW_FIELDS` and `INPUT_FIELDS` gain entries (internal).
- Not touched: the FROZEN slot order, the Plan shape (`plan.pv` is non-enumerable), POSE columns, the seam contract.

### 2.7 Strings (phase A)

| Key | ja | en |
|---|---|---|
| `fld.pvRules` | 文字PVの定石 | Lyric-video conventions |
| `fld.pvKit` | パートごとに演出をそろえる | Match looks within each song part |
| `fld.pvAlternate` | 動きの向きを交互にする | Alternate directions |
| `fld.pvArc` | 曲の山に合わせて強弱をつける | Follow the song's build |
| `fld.repeatSame.note` | 同じ歌詞の2回目からを、1回目と同じ見せ方（構図・動き・カメラ・背景）にします。固定や振り直しをしたカットはそのままです。新しい作品でははじめからオンです。 | A line sung again looks as it did the first time (layout, motion, camera, background). Cuts you pin or reroll keep what you set. New works start with this on. |
| `rule.auto.new` | 新しい作品の標準 | Default for new works |
| `rule.auto.old` | この機能より前に作った作品なので、はじめはオフ | Made before this feature, so it starts off |
| `sec.kit` | 演出セット | Set of looks |
| `fld.kitSet` | この区画の演出セット | This section's set of looks |
| `fld.kitSet.many` | いくつかのセット | Several sets |
| `act.kitReroll` | 演出セットを振り直す | Reroll the set |
| `undo.kitReroll` | {section}の演出セットを振り直し | Reroll the set for {section} |
| `why.pv.kit` | {section}の演出セットに合わせた | Matches the set of looks for {section} |
| `why.pv.kitBlock` | このまとまりの演出セットに合わせた | Matches the set of looks for this block |
| `why.pv.alt` | 前のカットと逆向きにした | Opposite direction to the previous cut |
| `why.pv.altSame` | このカットの動きの向きにそろえた | Same direction as the rest of this cut |
| `why.pv.arc.up` | {section}なので強い動きを選びやすくした | {section}, so stronger moves are favoured |
| `why.pv.arc.down` | {section}なので落ち着いた動きを選びやすくした | {section}, so calmer moves are favoured |
| `why.pv.tame` | 次がサビなので、ためて抑えた | The chorus comes next, so this holds back |
| `why.pv.peak` | 最後のサビなので一番強くした | The last chorus, so it goes strongest |

The notes of the switches (`fld.pvRules.note`, `fld.pvKit.note`, `fld.pvAlternate.note`, `fld.pvArc.note`) say what each
does and that new works start with it on; `fld.repeatSame.note` above wins over DESIGN_2_1 §6.11.

### 2.8 Goldens

Every existing golden is unchanged (no fixture carries the marker or a `pv.*` pin: `ctx.pv` is null and
`alignments` returns null as before). `tests/golden/project_pv.json` (the repeat fixture as a new work without its pin,
the other packages' switches off) follows with its phase.

<!-- PV22 P3 chapter -->

<!-- PV22 P4 chapter -->

<!-- PV22 P5 chapter -->

<!-- PV22 P6 chapter -->
