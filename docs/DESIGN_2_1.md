# 文字PVメーカー v2.1 — DESIGN addendum: camerawork, speed curves, area instructions, materials

Status: **contract for v2.1**, to be read together with `docs/DESIGN.md` (the v2 build contract). Builders read only
DESIGN.md and this file. Where this file changes a rule of DESIGN.md it says so, and this file wins. Everything else in
DESIGN.md stays binding: layers, lint, determinism, budgets and the testing plan.

Items marked **FROZEN** change only through the D§9.4 process. This file is itself the D§9.4 change record for v2.1: §9
lists every FROZEN contract it touches.

Notation:
- "D§4.16.4" is a section of DESIGN.md. "§4.3" is a section of this file.
- Paths are relative to `src/` unless they start with a top-level directory.

---

## 0. Reading guide

**Vocabulary.** The code uses these names:

| User word (ja / en) | Code name | Why this name |
|---|---|---|
| 区画 / Section | **area** | `section` is already taken: inspector sections (`ui/fields` `sectionsFor`) and song-analysis sections (`feat.section`, `song.info.sections`) |
| 素材 / Material, マイ素材 / My materials | **material** | |
| 緩急 / Speed curve | **curve** | |
| カメラワーク / Camerawork (one cut) | **shot** (slot `cam.shot`) | |
| 区画のカメラ / Section camera | **rig** (slot `rig`) | |
| 動きの速さ / Motion speed | slot `motion.speed` | |

**Inputs.** This file merges two proposals:
- the "camera + curves" proposal (text-aimed camerawork, a unified curve model, automatic camerawork);
- the "AI sections + materials" proposal (area-scoped AI instructions, recipe-based materials).

§1.4 lists every point where they disagreed and what was decided.

**Code facts this file relies on** (read from the tree, v2 HEAD):
- `core/registry` `version` hashes only (kind, key, *part* param names). Shared params are not in it.
- `planner/cast.isChoice` ignores slots containing `.`, so `cam.shot` needs an explicit rule.
- `engine/scene/build.slotSeed` stringifies `v`, so object values need hashing.
- `renderer.gather` already blends the ground camera across text seams with `textSeamCam`.
- `ui/fields` already uses `sec.*` string keys for inspector sections. Song section names are `songSec.*`.
- `planner/cast` keys its cast cache by registry identity.
- `ai/catalog` lists only `registry.pool(...)`, which leaves out `pool: false` parts.
- `build.py` gives no layer to an unknown `parts/*` module.

---

## 1. Overview

### 1.1 What v2.1 adds (in user terms)

1. **Camerawork that frames the words.** The camera pushes in on a word, follows the singing word by word, reframes
   between phrases, and drifts slowly over a whole area (区画のカメラ).
   - It is automatic by default. Its strength is 作品全体 › 強さ › カメラワーク.
   - Presets and a closeness slider sit one level deeper. Keyframes sit deepest.
   - The camera moves *while* the text animates, because shot keys are anchored to the entrance, the sung start, the
     emphasis and the beats.
2. **Speed curves (緩急) everywhere something moves over time.** This covers text entrances and exits, their stagger, holds,
   camera moves and transitions. The choices are:
   - presets such as 「一瞬ゆっくり→すごく速く→一瞬ゆっくり」;
   - a simple two-slider form (how long the slow part lasts, how much faster the middle is);
   - custom Bézier or speed-step curves in a small editor.

   動きの速さ (×0.25–×4) gives slow or fast motion per line or cut.
3. **Instructions per area (区画ごとの指示).** Pick an area and tell the AI what to do there, for example
   「季節感を加えて」「ここは動きをスローに」.
   - An area can be: サビ1, a 「# サビ」 block, a blank-line block, the selected lines, one cut, or the whole video.
   - The answer becomes a checked list of changes, limited to that area and applied as one undo step.
   - A board sends instructions for up to 8 areas at once.
   - 「カメラワークをAIに任せる」 is the same tool, restricted to camera fields.
4. **My materials (マイ素材).** The AI, or the user, builds new materials out of existing parts and a fixed set of
   primitives: shapes, particles, patterns, motion tracks and oscillators. A cherry-petal atmosphere is one example.
   - Materials are stored in the project, validated, and registered as parts.
   - They show up under マイ素材 in the part browser.
   - The AI can fit a new material into the area it was asked about.

### 1.2 Principles kept from v2 (all binding)

- **One slot mechanism.** Every new automatic choice is a slot with a path and a pin (D§1.3.1). This covers camerawork,
  curves, motion speed, rig, line season and avoid lists. The inspector, undo, reroll, locks, おまかせ, explain and the AI
  all reach them the same way.
- **The document is the only mutable state.** Materials live in `doc.materials` and change only through commands.
- **Deterministic from (document, base registry).** The *effective* registry is `registryFor(baseRegistry,
  doc.materials)`, a pure function of both. The rest follows D§7.1:
  - Plan hashes are identical in Node and Chrome.
  - Frames are closed-form in `t`.
  - `Math.random` and clocks never appear below L6.
- **Plan decides, Scene executes, Frame evaluates.** Shots are resolved at scene build into a closed-form track. Rigs are
  a pure plan lookup.
- **Parts are data plus pure functions.** `run`/`draw` functions are defined once at module level. Material interpreters
  follow the same rule.
- **AI output is data.** The page runs no code from the AI: no `eval`, no `new Function`, no expression language, no path
  data. Answers pass closed JSON schemas, then `coerce`/`normalize`, then registry key checks. The CSP is unchanged.
- **Every AI result is reviewed.** It is shown as a checked change list, applied with one `store.batch`, and logged for
  selective revert.
- **Simple on top, deep underneath (SPEC §2).**
  - The header, play bar and step bodies keep their control budgets (D§6.4.1–6.4.3). v2.1 adds **no** top-level control.
  - The preview is never covered.
- **DOM-free below `ui/`.** Everything new except `ui/*` runs in Node 22.
- **Export is frame-exact** (D§4.21) and within the budgets of D§7.4 (see §7.2).

### 1.3 Decisions at a glance

1. **One curve value** (`core/curve`, L0) takes five forms:
   - an ease name;
   - one of 7 presets;
   - `{bz}` (cubic Bézier);
   - `{sp}` (piecewise-linear speed, integrated in closed form);
   - `{ramp}` (the two-slider form, compiled to `{sp}`).

   It is plain JSON, pinnable and canonical (q3 numbers, sorted keys, frozen). The new ParamSpec type is `curve`.
2. **Shared params (D§3.4 table):**
   - `arrive/depart.ease` becomes type `curve`. Old ease pins stay valid.
   - New: `arrive/depart.flow` (stagger curve), `dwell.curve`, `lens.curve` and `seam.curve`.
   - Their default autos reproduce v2 motion exactly.
3. **The camera is four composed layers:** rig (per area run) ∘ shot (per cut, aimed at the text) ∘ lens (the existing
   parts, the texture of the motion) ∘ impulses.
   - Lens amplitudes stay screen-constant under shot zoom.
   - Shots are data: 9 presets or a custom Shot of 2–6 keys.
4. **New cut slots:** `motion.speed`, `cam.shot`, `cam.zoom`, `cam.curve`, `cam.follow`, `rig` and `rig.curve`.
   **New line slots:** `season` and `avoid`.
   All of them fit the existing NAME grammar, so **the path grammar does not change**.
5. **Automatic camerawork lives in the planner** (`planner/camera`, L2). It uses deterministic rules and Gumbel weights.
   It is pinnable at every scope, frozen by locks, and switched off by `amount.camera = 0`.
6. **Areas** (`planner/areas`, L2) are derived and never saved. An area resolves to line ids and cut keys. AI changes are
   ordinary `line/`, `cut/` or `work:` pins, checked with `inArea`.
7. **One AI tool, `direct` (指示), takes 1–8 briefs.**
   - The AI panel's instruction box (target 全体 / 選択中 / 区画▾) sends one brief. It replaces ひとこと修正 in the panel.
   - The 区画ごと board sends up to 8 briefs.
   - The answer schema is closed and portable.
   - Mode `camera` is 「カメラワークをAIに任せる」.
8. **Materials are recipes** (declarative JSON) in `doc.materials`.
   - The document schema goes **1 → 2**, with a migration.
   - A material is validated by `core/recipe` and interpreted by fixed code in `parts/mix`.
   - It is registered as the part `myMat<id>` through `REG.extend`.
   - AI-made materials are `pool: false`: they appear only where they are pinned.
9. **Fingerprints:**
   - Scenes key on `registry.baseVersion` plus per-cut `matTerms`, so a material edit rebuilds only the cuts that use it.
   - The Plan becomes `v: 2`, adding `rigs[]`, `cut.rig` and `grounds[].zoomed`.
10. **UI:**
    - The top level is unchanged.
    - Controls are added at 要素 › カメラ (three sections), 行 › 演出, カット, the multi-line/area page, the AI panel
      instruction box (+ board sub-page), the part browser (マイ素材 tab) and 作品全体 › マイ素材.
    - New widgets: `curve`, `shot`, `rig` and `partRefs`.
    - New sub-pages: keyframe editor and material page.

### 1.4 Conflicts between the proposals, resolved

| # | Topic | Camera proposal | Sections proposal | Decision (and why) |
|---|---|---|---|---|
| 1 | Curve value | name, preset, `{bz}`, `{sp}` | `{ preset, edge, peak }` (8 own presets) | **Both.** The camera union plus a `{ramp:{ends, edge, peak}}` form, compiled to `{sp}`. The AI speaks presets, eases and `ramp`, which is robust and matches how users talk. Raw knots and Béziers are UI-only. The 7 camera presets are kept. The sections presets map as follows: slowFastSlow → `ramp both`; fastSlowFast → `ramp both` with peak < 1; easeIn/Out/InOut → eases; hold → `holdThenDash`; snap → `dashStop`. |
| 2 | Schema version | stays 1 | 2 for materials | **2.** Materials need `doc.materials`. Camera and curve data live in pins. §2.2 gives the migration. |
| 3 | Camera representation | `cam.shot` text-aimed layer | `cam.keys` slot + lens part `keyedShot` | **`cam.shot` layer.** Text-aimed, it composes with the lens and needs no extra part. `cam.keys` and `keyedShot` are dropped. The AI's move vocabulary (pushIn, pan, punch…) is kept and compiled to a Shot by `core/shot.fromMove`. |
| 4 | Lens materials | — | keyframe recipes | **Oscillator recipes.** They cover shake, sway and beat. Framing belongs to shots, so a lens material holds no keys. |
| 5 | Tempo / slow-motion | `motion.speed` slot | writes `dur/each/speed` param pins from medians | **`motion.speed` slot.** One pin per line, it stays auto-aware, and the fit caps still apply. |
| 6 | Area model | `planner/camera.sections`, ids `'s'+index` | `ai/sections`, SectionRef with stable keys | **`planner/areas` (L2)** uses the SectionRef model and stable keys. The planner layer is shared by UI, AI and tests, and the name avoids `section`. |
| 7 | AI tool | 区画ごと target in ひとこと修正, briefs ≤ 8 | `direct` tool, single area; board later | **One `direct` tool with `briefs[1..8]`.** One schema serves the single area and the board. |
| 8 | Answer shape | parts/camera/motion/lines objects | all/lines/cuts/work/materials | **all/lines/cuts/work** per answer, plus top-level `materials`. Camera, curve and speed fields come from the camera proposal and are reshaped for AI robustness (§5.4). |
| 9 | Change model | kind `slots` (one change, many paths) | per-line changes + `agg` | **Per-path changes grouped by `agg`.** Single rows can be unchecked, stale detection and revert stay per path, and the review shows one aggregate row. New kinds: `value` and `material`. |
| 10 | Season inside an area | season gate only | line slot `season` | **Line slot `season`** (plus `avoid`). A seasonal chorus needs this when the work season differs. |
| 11 | Interpreter parts | `mix*` parts in the base registry | — | **Not in the registry.** They would clutter the part browser and need a catalog dependency change. `parts/mix.sampleDefs()` serves tests and the lab. |
| 12 | "`registry.version` changes" | claimed for new shared params | — | **Wrong:** the version hashes part params only. Plan hashes still change because decisions gain `p.flow` / `p.curve`. The rule in §7.5 is plans regenerated, frames equal. |
| 13 | String keys | `sec.chorus` | `sec.*` | **`sec.*` is taken** by inspector sections. Kinds reuse the existing `songSec.*`; areas use `area.*`. |
| 14 | Ground jump at seams | proposed fix | — | **Already fixed in HEAD** by `textSeamCam`. v2.1 keeps it, blends zoom in log space, and composes the rig after the blend. |
| 15 | Material flashes | — | preflight counts material flashes | **Impossible by construction.** Filter stacks and seam variants refuse `gate: 'flash'` parts, and big alpha modulation is capped. `export/schedule` is unchanged. |
| 16 | AI amounts | add `camera` to `AI_AMOUNTS` everywhere | all 10 amounts | Only the `direct` tool's `work.amounts` gains `camera`. 演出3案 and the legacy edit schema are unchanged, to limit churn. |
| 17 | Shot max zoom | 4 | 1–3 | **3.** Grounds (parallax 0.25) then magnify ≤ 1.5×, and ×1.25 oversampling keeps them sharp. The minimum is 0.9. |

---

## 2. Data model

### 2.1 The saved file (schema 2, FROZEN shape)

The layout is the same as D§3.1, plus `doc.materials`. The keys are shown in serialize order.

```json
{
  "format": "mojipv.project",
  "schema": 2,
  "doc": {
    "meta": { "app": "2.1.0", "lang": "auto" },
    "sheet": { "next": 9, "rows": [ { "id": "r6", "src": "# サビ" }, { "id": "r7", "src": "[00:41.20]君の名前を/呼ぶ声が" } ] },
    "timing": { "…": "…" }, "song": null, "look": { "…": "…" },
    "pins": {
      "line/r7:cam.shot":     { "v": "pushWord", "by": "ai" },
      "line/r7:cam.curve":    { "v": { "ramp": { "edge": 0.1, "ends": "both", "peak": 6 } }, "by": "ai" },
      "cut/r7~5:cam.shot":    { "v": { "follow": 0.2, "keys": [
          { "aim": "block", "at": "a", "fill": 0.6 },
          { "aim": "word:1", "at": "word:1", "curve": "holdThenDash", "fill": 0.9, "ox": 0.1 },
          { "aim": "word:1", "at": "b", "curve": "linear", "fill": 0.95, "ox": 0.1 } ] }, "by": "user", "sig": "呼ぶ声が" },
      "line/r3:arrive.ease":  { "v": { "bz": [0.7, 0, 0.2, 1] }, "by": "user" },
      "line/r3:motion.speed": { "v": 0.6, "by": "ai" },
      "line/r7:season":       { "v": "spring", "by": "ai" },
      "line/r7:atmos":        { "v": "myMat3", "by": "ai" },
      "line/r7:avoid":        { "v": ["filter.sliceGlitch"], "by": "ai" },
      "line/r7:rig":          { "v": "climbRise", "by": "ai" },
      "work:seam.curve":      { "v": "dashStop", "by": "user" }
    },
    "salts": {}, "locks": {}, "filters": {},
    "materials": {
      "next": 4,
      "list": [
        { "id": "m3", "kind": "ornament", "by": "ai",
          "name": { "ja": "桜吹雪", "en": "Cherry flurry" },
          "blurb": { "ja": "花びらが斜めに舞い、拍でふわっと増える", "en": "Petals drift across and swell on the beat" },
          "tags": ["organic", "soft"], "season": "spring", "pool": false, "rv": 1,
          "recipe": { "follow": "own", "knobs": [ { "what": "count" } ], "layers": [ { "…": "§5.7" } ], "parts": [],
                      "scope": "run", "seed": 7 } }
      ]
    },
    "output": { "…": "…" }
  },
  "side": { "looks": { "list": [], "cap": 50 }, "aiLog": [], "asks": {} }
}
```

**`doc.materials`** = `{ next, list }`:
- `next` is an integer ≥ 1. It only grows.
- `list` holds at most 64 `MaterialEntry` objects (§5.7) sorted by id order of creation.
- The canonical JSON of `doc.materials` is ≤ 160 KB and each recipe is ≤ 6 KB.
- Ids are `'m' + n.toString(36)` with `n < next` and are **never reused** (like row ids).

**`side.asks`** = `{ [areaKey]: { text, at } }`:
- These are board drafts (§6.3). They are not undoable.
- Caps: 40 entries, `text` ≤ 120 characters.
- `at` is the store revision.

### 2.2 Migration and validation

- `core/doc.CURRENT_SCHEMA = 2`.
- `core/migrate.MIGRATIONS[1] = (file) => ({ ...file, schema: 2, doc: { ...file.doc, materials: { next: 1, list: [] } } })`.
  - It is pure and touches nothing else.
  - Schema-1 files and autosaves open unchanged, and so does every existing pin.
  - Files with schema > 2 are refused as today (「新しいバージョンで作られた作品です」). v2.0 refuses schema-2 files the
    same way, which is intended.
- `core/doc` additions:
  - `ORDER.doc` puts `materials` between `filters` and `output`.
  - `ORDER.materials = ['next', 'list']`.
  - `ORDER.material = ['id','kind','by','name','blurb','tags','season','pool','rv','recipe']`.
  - `ORDER.side` adds `'asks'`.
  - Recipes are serialized with sorted keys (they are stored normalized, §5.7).
  - `defaultDoc().materials = { next: 1, list: [] }` and `meta.app = '2.1.0'`.
  - `normalize` fills a missing `materials`. `sanitizeSide` keeps a valid `asks` and drops anything else.
- `validate(doc)` adds **structural** checks only:
  - `materials` is an object, `next` is an integer ≥ 1, and ids match `^m[0-9a-z]+$`, are unique and are < `next`;
  - `kind ∈ MAT_KINDS`, `by ∈ ai|user`, `name.ja` is non-empty, `recipe` is an object;
  - the size caps hold.

  Recipe semantics are **not** checked here. A recipe that `core/recipe` rejects (for example one from a newer `rv`) keeps
  the file openable. The registry skips it, and the planner warns `material-bad` (§5.9).
- `touched(a, b)` gains `materials: a.materials !== b.materials`.

### 2.3 New and changed slots

**Shared params** (D§3.4 table; names FROZEN):

| Kind | Param | Type | Range and meaning | Default auto |
|---|---|---|---|---|
| arrive, depart | `ease` | **curve** (was `ease`) | per-glyph progress `k = C(u)` | unchanged picks of ease names |
| arrive, depart | `flow` (new) | curve, `ui: 'advanced'` | how the stagger is spread: `delay_j = W(rank_j / maxRank) · maxRank · each` (not for order `sung`) | `{ value: 'linear' }` |
| dwell | `curve` (new) | curve, advanced | time-warp of the hold over `[rest, out]` | `{ value: 'linear' }` |
| lens | `curve` (new) | curve | the move curve of framing lenses; a time-warp of periodic lenses over `[a, b]` | `{ value: 'linear' }`; glide parts override it with their v2 hard-coded ease (§3.11) |
| seam | `curve` (new) | curve, advanced | transition progress `u' = W(u)` before `mix` | `{ value: 'linear' }` |

`W` = `CV.warp(curve)` (clamped to 0..1). `linear` is the identity, so none of these defaults changes a frame.

**Cut slots** (D§3.4.3 additions). All are pinnable at cut, line and work scope and cascade cut > line > work.

| Slot | Value (type) | Auto (§4.7) | Notes |
|---|---|---|---|
| `motion.speed` | num 0.25–4, step 0.05 (×) | `1` | Unpinned `arrive.dur`, `arrive.each`, `depart.dur` and `depart.each` are divided by the speed; unpinned `dwell.speed` is multiplied by it. Those params get `pfrom: 'rule'`, and D§4.7 fitting still caps them. |
| `cam.shot` | ShotRef: shot preset key, `'none'` or a Shot object (§2.4) | planner rules + Gumbel | the text-aimed keyframes of the cut |
| `cam.zoom` | num 0.5–2, step 0.01 (×) | formula | scales every key's closeness (「もっと寄って」) |
| `cam.curve` | Curve | weighted pick | the curve of every shot key without its own `curve` |
| `cam.follow` | num 0–1, step 0.01 | the shot's own `follow`, else a formula | lean toward moving glyphs |
| `rig` | RigRef: rig preset key, `'none'` or a Rig object | area rules | Resolved per **rig run** (§4.6). A cut pin splits the run around that cut, like `ground`. |
| `rig.curve` | Curve | the preset's curve | read from the run's first cut |

**Line slots** (D§3.4.2 additions):

| Slot | Value | Auto | Notes |
|---|---|---|---|
| `season` | `any`, `none`, `spring`, `summer`, `autumn` or `winter` | none (the line follows the work season) | Scopes: **line and work**. `work:season` is the existing work slot and is unchanged. `pin.promote` line → work is allowed. |
| `avoid` | PartRefs: sorted unique `"kind.key"` list, ≤ 24 | none | Line only. It excludes parts from the line's auto pools (§4.9). Pins still win. |

**Scope table** (`ui/fields.slotScopes`, `core/commands` rules):

| Slot(s) | Scopes |
|---|---|
| `motion.speed`, `cam.shot`, `cam.zoom`, `cam.curve`, `cam.follow`, `rig`, `rig.curve` | cut, line, work |
| `season` | line, work |
| `avoid` | line |
| new shared params (`arrive.flow`, `dwell.curve`, …) | cut, line, work (the existing part-param rule) |

### 2.4 Value grammars (FROZEN; canonical forms produced by `coerce`)

```
Curve    := EaseName                                   // core/ease EASES
          | PresetName                                 // softEnds hushRushHush holdThenDash dashStop slowBloom fadeBrake snapSettle
          | { "bz": [x1, y1, x2, y2] }                 // x ∈ [0,1], y ∈ [−0.5, 1.5]
          | { "sp": [[u0,s0], …, [un,sn]] }            // 2–8 knots; u0 = 0, un = 1, u non-decreasing, at most 2 equal u in a row
                                                       // (= a speed jump); s ∈ [0, 8]; total area > 0
          | { "ramp": { "edge": e, "ends": E, "peak": k } }   // E ∈ both|start|end, e ∈ [0, 0.4], k ∈ [0.125, 8]

ShotRef  := ShotPresetKey | "none" | Shot              // presets: settle pushWord readAlong snapZoom pullReveal sweepAcross
                                                       //          tiltHold driftOff wideHold
Shot     := { "keys": Key[2..6], "follow"?: 0..1 }
Key      := { "at": 0..1 | Anchor, "dt"?: −2..2 (s), "aim": Aim,
              "fill"?: 0.1..1.2    (text aims; default 0.6: the aimed box's larger side fills this share of the frame),
              "zoom"?: 0.9..1.25   (aims frame, point; default 1),
              "px"?, "py"?: 0..1   (aim point; default 0.5),
              "ox"?, "oy"?: −0.4..0.4 (screen position of the aim centre from the frame centre, frame fractions;
                                    ABSENT = keep the aim where the composition put it, §4.5),
              "roll"?: −15..15 (deg; default 0),
              "curve"?: Curve      (the move INTO this key; absent → the cut's cam.curve) }
Anchor   := a | rest | sung | mid | end | out | b | emph | word:<k> | beat:<n>      // k ∈ −20..40 (negative = from the end), n ∈ 0..16
Aim      := block | emph | first | last | reading | frame | point | word:<k> | line:<0..8> | glyph:<0..80>

RigRef   := RigPresetKey | "none" | Rig                // presets: slowSwell climbRise pullAway leanTilt driftSide
Rig      := { "keys": [ { "u": 0..1, "zoom"?: 0.95..1.15, "x"?: −0.05..0.05, "y"?: −0.05..0.05, "roll"?: −4..4 (deg),
                          "curve"?: Curve } ] (2–4, u non-decreasing) }

PartRefs := [ "kind.key", … ]                          // kind ∈ arrange arrive dwell depart ground ornament lens filter seam;
                                                       // key matches PARTKEY; sorted, unique, ≤ 24; unknown keys are ignored by the planner
```

**Canonical form:**
- Numbers are rounded with `q3(x) = Math.round(x·1000)/1000` (curves, shots, rigs).
- Object keys are sorted.
- Defaults are omitted: `dt 0`, `fill 0.6`, `zoom 1`, `px/py 0.5`, `roll 0`, `follow 0`, rig `zoom 1`, `x/y 0`, `roll 0`.
- Arrays keep their order. Shot keys are *not* reordered in data; they are time-sorted at build.
- The result is deep-frozen, so `planner/encode.asIs` prints it natively.
- Presets are stored by **name**, never expanded: pins stay readable, and tuning a preset reaches every use of it.

**Invalid input:**
- `coerce` returns `undefined` for anything it cannot read.
- The planner then warns `pin-bad-value` and falls back to the next rank (D§3.5).

### 2.5 Path grammar

The grammar of D§3.4 is **unchanged**:
- `cam.*`, `motion.speed`, `rig`, `rig.curve`, `season` and `avoid` take the NAME branch (their first token is not a
  KIND).
- `arrive.flow`, `dwell.curve`, `lens.curve` and `seam.curve` are shared params of the part branch.
- Material keys (`myMat3`, `myMat1a`) match `PARTKEY` and the registry key rule, so `line/r7:ornament#0@myMat3.count` is
  valid.

Modules that must learn the new names are listed in §3. In short:
- `ui/fields.slotScopes` and `planner/fields.categoryOf`: `season` at line scope is a *line* value, not a look value;
  `avoid` is a line value.
- `planner/cast.SLOT_SPECS` (via `planner/camera.SLOT_SPECS`) and `planner/segment.LINE_SPECS`.
- `core/commands`, for its copy, promote and scope rules.

### 2.6 Commands (FROZEN payloads; D§3.9 additions and changes)

| Command | Payload | Effect |
|---|---|---|
| `material.put` | `id, kind, name, blurb?, tags?, season?, pool?, by, recipe` | `id === 'm' + next.toString(36)` creates an entry and increments `next`. An existing id replaces the entry (its `kind` must match). The stored recipe is `recipe.normalize(kind, recipe).recipe` and the stored `rv` is `RECIPE_V`. It throws `CommandError('payload')` when `entryProblems`/`problems` report errors or a cap (§2.1) would be exceeded. An unchanged entry returns the same doc. |
| `material.meta` | `id, name?, blurb?, tags?, season?, pool?` | metadata only; same validation |
| `material.remove` | `id` | Removes the entry and cleans every reference to key `k = 'myMat' + id.slice(1)`: pins whose value is `k`; pins whose slot is part-qualified with `@k`; `"<kind>.k"` items of `avoid` pins (an emptied list removes the pin). `next` is kept. |
| `pin.set` | unchanged | Also refused (`payload`): `cut/…:season`, `cut/…:avoid`, `work:avoid`. |
| `pin.promote` | unchanged | `season` may move line → work. `avoid` never moves. |
| `pin.copy` | unchanged | `copyable` adds `motion.speed` and `cam.*`. New shared params are part params and are already copied. `rig*`, `season` and `avoid` are not copied (area-level). |

The reducers stay pure. `material.*` reducers call only `core/recipe`, which is L0.

### 2.7 Plan additions (`plan.v` 1 → 2; FROZEN shape, additive)

```json
{
  "v": 2,
  "cuts": [{ "key": "r7~0", "rig": 2, "feat": { "…": "…", "sectionStart": true },
    "slots": {
      "motion.speed": { "from": "auto", "v": 1 },
      "arrive": { "from": "auto", "p": { "dur": 0.62, "each": 0.05, "ease": "expoOut", "flow": "linear", "order": "lead",
                                         "yFrom": 0.55 }, "v": "inkRise" },
      "lens":   { "from": "auto", "p": { "amount": 0.4, "curve": "linear", "rate": 0.6, "roll": 0.4, "sway": 11 },
                  "v": "handHeld" },
      "cam.shot":   { "from": "auto", "p": { "carry": { "fill": 0.66, "roll": 0 } }, "pfrom": { "carry": "rule" },
                      "v": "pushWord" },
      "cam.zoom":   { "from": "auto", "v": 1.08 },
      "cam.curve":  { "from": "auto", "v": "hushRushHush" },
      "cam.follow": { "from": "auto", "v": 0.22 } } }],
  "rigs": [{ "blend": null, "cuts": ["r7~0", "r7~5", "r8~0"], "curve": { "from": "auto", "v": "slowBloom" },
             "key": "kr7~0", "rig": { "from": "auto", "p": { "amp": 0.78 }, "v": "slowSwell" }, "t0": 40.78, "t1": 52.3 }],
  "grounds": [{ "…": "…", "zoomed": true }]
}
```

**Plan fields:**
- `cut.rig` is the index into `rigs`. Every cut belongs to exactly one run, including runs whose value is `none`.
- `rigs[i]`:
  - Runs are contiguous in time. `t0` is the first cut's `a` (0 for the first run); `t1` is the next run's `t0` (plan
    `duration` for the last).
  - `blend` is `null`, or `{ t0, t1 }` when a non-hard seam covers the boundary into this run. It is the seam window;
    the frame blends the previous run's pose into this one over it.
- `grounds[i].zoomed` is `true` when some cut of the segment has `cam.shot ≠ 'none'`. It tells the renderer to oversample
  static ground rasters (§4.8).
- `feat.sectionStart` (additive to D§4.16.7) is `true` for the first cut and for every cut whose `feat.section` differs
  from the previous cut's in time order.

**Fingerprints and hash** (D§3.12 amended):
- The cut `fp` covers `slots` (all new slots and `p.carry` included) and, new, `matTerms` = sorted
  `[[slot, key, rhash]]` of the chosen parts whose def has `mine` (§5.9).
- The shared look term uses `registry.baseVersion` instead of `registry.version`.
- `cut.rig` and `rigs` are **not** in any `fp`, because scenes never read the rig. They are in the plan hash
  (`encode.cutPieces` prints `rig` next to `ground`; `planHash` covers `rigs`).
- `groundFp` adds the `matTerms` of `ground`/`atmos`.

### 2.8 Warnings and why codes (D§3.13 additions)

**Warning codes:**

| Code | When |
|---|---|
| `material-bad` | a material could not be derived; `detail: { id, code }` |
| `avoid-empty` | a line's avoid list emptied a pool and was relaxed; carries `line`, `path` |

**Why codes** (explain):

| Code | Meaning |
|---|---|
| `cam.emph` | the cut has an emphasis |
| `cam.impact` | impact cut |
| `cam.words {n}` | number of words |
| `cam.long` | long cut |
| `cam.short` | short cut |
| `cam.section {section}` | the song section |
| `cam.sectionStart` | first cut of a section |
| `cam.lens {key}` | a framing lens is already chosen |
| `cam.arrange {key}` | the layout limits the camera |
| `cam.amount {x}` | the camerawork amount |
| `rig.section {section}` | the song section of the run |
| `rig.lastChorus` | last chorus run |
| `season.line {season}` | the line's own season |
| `avoid {n}` | the line's avoid list |

**Rule names:** `carry`, `speed`, `gentle`, `none-camera` (amount < 0.1), `role`.

---

## 3. Modules and interfaces

The code blocks below are the exact public exports. **FROZEN** marks interfaces other packages build on.

### 3.1 Layers and `build.py` (D§2.3 amended; FROZEN)

| Module | Layer | May depend on |
|---|---|---|
| `core/curve`, `core/shot`, `core/recipe` | L0 | L0 |
| `planner/areas`, `planner/camera` | L2 | L0–L2 |
| `engine/scene/shot` | L3 | L0, L1, L3 |
| `parts/mix` | **L3** (new rule in `build.py.layer_of`: `mid == 'parts/mix'` → 3) | L0, L1, L3 (uses `parts/kit`) |
| `ai/direct`, `ai/recipe` | L5 | L0–L5 |
| `ui/curve_widget`, `ui/shot_editor`, `ui/material_page`, `ui/ai_board` | L7 | everything |

- `parts/catalog` is unchanged: it still depends only on `core/registry`.
- The facade (L5) composes the effective registry with `parts/mix` (L3).
- Lint rules of D§2.4 apply unchanged. `parts/mix` is not a part file, so it follows the L0–L5 rules. It must not keep
  module-level mutable state except the documented memo caches (`WeakMap`s).

### 3.2 `core/curve` (new, L0; FROZEN)

```js
MV.def('core/curve', ['core/ease', 'core/num'], (E, N) => ({
  PRESETS,            // frozen { softEnds: { bz }, hushRushHush: { sp }, … } (§4.1 table)
  PRESET_KEYS,        // sorted
  RAMP_ENDS,          // ['both', 'start', 'end']
  MAX_KNOTS: 8, RAMP_W: 0.06,
  isCurve(v) → boolean,
  coerce(v) → Curve | undefined,          // canonical, deep-frozen (§2.4)
  keyOf(c) → string,                      // 'n:expoOut' | 'bz:0.6,0,0.4,1' | 'sp:0,0.15;0.12,0.3;…' | 'rp:both,0.1,6'
  expand(c) → c | { bz } | { sp },        // presets → their data, ramp → { sp }, names and data unchanged
  compile(c) → { fn, warp, linear, key },  // memoized by keyOf (LRU 256); fn pinned f(0) = 0, f(1) = 1
  fn(c) → (u) => number,                  // position curve; may overshoot (back*, elastic, spring, snapSettle, bz with y ∉ [0,1]);
                                          // an unreadable c gives linear (never throws on data)
  warp(c) → (u) => [0,1],                 // clamp01(fn(u)): time warps, seam progress, stagger
  isLinear(c) → boolean,                  // 'linear' | sp with equal speeds | bz on the diagonal | ramp with peak 1
  reverse(c) → Curve,                     // g(u) = 1 − f(1 − u): names via E.reverse; softEnds, hushRushHush → themselves;
                                          // slowBloom ↔ fadeBrake; other presets → reversed data; bz → [1−x2, 1−y2, 1−x1, 1−y1];
                                          // sp → knots (1 − U[n−i], S[n−i]); ramp → ends start ↔ end
  speedAt(c, u) → number,                 // derivative: exact for sp/ramp, central difference h = 1e-4 otherwise (UI only)
  sample(c, n) → Float32Array(n + 1),
  label(c) → [stringKey, params],         // ['curve.hushRushHush', {}] | ['opt.ease', …] (the ui/fields ease labels) |
                                          // ['curve.bz', {}] | ['curve.sp', { n }] | ['curve.ramp.both', { peak }]
}));
```

Béziers use the frozen `core/ease.bezier` solver. The math is in §4.1.

### 3.3 `core/shot` (new, L0; FROZEN)

```js
MV.def('core/shot', ['core/num', 'core/curve'], (N, CV) => ({
  SHOTS, SHOT_KEYS, RIGS, RIG_KEYS,        // frozen presets (§4.5, §4.6 tables), keys sorted
  MOVES: ['drift','follow','panDown','panLeft','panRight','panUp','pullOut','punch','pushIn','tilt'],
  FOCI: ['center','emphasis','first','last','text'], TIMINGS: ['arrive','depart','hold','whole'],
  LIMITS,                                  // the numeric ranges of §2.4
  coerceShot(v) → ShotRef | undefined,     // canonical (§2.4); a Shot with < 2 valid keys → undefined; > 6 keys → first 6
  coerceRig(v) → RigRef | undefined,
  isCustom(ref) → boolean,
  expandShot(ref, { zoom = 1, curve = 'softEnds', carry = null, follow = null } = {}) → Shot | null,
      // 'none' → null. Keys get `curve` where absent; text-aim fill → clamp(fill·zoom, 0.1, 1.2);
      // frame/point zoom → clamp(1 + (zoom_key − 1)·zoom, 0.9, 1.25); carry { fill, ox?, oy?, roll } replaces key 0's
      // framing when key 0 is at 'a'; follow (when not null) replaces shot.follow
  lastFraming(ref, { zoom = 1 }) → { fill, ox?, oy?, roll } | null,   // symbolic framing of the last key (carry, §4.5)
  maxFill(ref) → number,                   // largest text-aim fill of a preset (planner 'gentle' rule)
  expandRig(ref, { amp = 1, curve = null } = {}) → Rig | null,       // 'none' → null; amp scales deviations (§4.6)
  fromMove({ move, focus, timing, fill }) → ShotRef | undefined,     // the AI's move vocabulary (§4.5.8)
  usesBeats(ref) → boolean,                // any key anchored 'beat:<n>'
  label(ref) → [stringKey, params],        // ['shot.pushWord', {}] | ['shot.none', {}] | ['shot.custom', { n }]
  rigLabel(ref) → [stringKey, params],
}));
```

### 3.4 `core/recipe` (new, L0; FROZEN)

```js
MV.def('core/recipe', ['core/num', 'core/hash', 'core/color', 'core/curve', 'core/schema'], (N, H, C, CV, S) => ({
  RECIPE_V: 1,
  MAT_KINDS,      // ['arrange','arrive','depart','dwell','filter','ground','lens','ornament','seam']
  COMPOSITE_KINDS,// ['arrive','depart','dwell','filter','ground','lens','ornament']   (arrange, seam: variants only)
  PRIMS, SHAPES, GLYPHS, ANCHORS, LAYERS, WAVES, MOVE_WHAT, APPEAR_AT, DRAWS, FRAME_STYLES, PATTERNS, BURSTS,
  MOTION_COLS, OSC_COLS_DWELL, OSC_COLS_LENS, PHASES, KNOB_WHATS, LIMITS,
  normalize(kind, recipe) → { recipe, problems },   // clamps, drops invalid layers/tracks/osc/parts, fills defaults, q6
                                                    // numbers, sorted keys; never throws on data
  problems(kind, recipe) → Problem[],               // Problem = { path, code, params }; [] when valid (on normalized recipes)
  entryProblems(entry) → Problem[],                 // id, kind, by, name (≤ 24), blurb (≤ 80), tags ⊂ TAGS, season, pool, rv
  hash(recipe) → 'xxxxxxxx',                        // hashJSON of the canonical recipe
  cost(kind, recipe) → { ms, particles, nodes, paints, parts, cost, passes, cover },   // with every knob at its maximum
  knobSpecs(kind, recipe) → { [name]: ParamSpec }, // generated knob params (§5.7.6); validate with validateSpec
  withKnobs(recipe, p) → recipe,                   // the recipe with knob multipliers applied (pure; used at build)
  upgrade(recipe, rv) → { recipe, rv } | null,     // future rv migrations; null = unknown rv
}));
```

The vocabularies and limits are in §5.7–§5.8. The AI catalog text is generated from these constants, so the prompt and the
validator cannot drift apart (§5.10).

### 3.5 `core/schema` (D§4.2 additions; FROZEN)

- `TYPES` gains `'curve'`, `'shot'`, `'rig'` and `'partRefs'`.
- `coerce` delegates to `CV.coerce`, `SHOT.coerceShot` and `SHOT.coerceRig`. For `partRefs` it checks the format,
  sorts, dedupes and caps the list at 24.
- `baseValue`: curve `'linear'`, shot `'none'`, rig `'none'`, partRefs `[]`.
- `checkCandidate` accepts any value that coerces, so `auto: { pick: ['expoOut', 'holdThenDash'] }` is valid.
- `describeAuto` shows object values as `CV.keyOf` / `'custom'`. The inspector's display text comes from `label()`, not
  from here.
- Dependencies become `['core/num', 'core/ease', 'core/color', 'core/curve', 'core/shot']`, all L0 with no cycle:
  `core/shot` depends on `core/curve` and `core/num` only.

### 3.6 `core/registry` (D§4.6 additions; FROZEN)

- **SHARED** as in the table of §2.3. `motionShared` gives `ease` type `'curve'` with the same pick lists, and adds
  `flow`. It also adds `dwell.curve`, `lens.curve` and `seam.curve`. Labels:

  | Param | ja / en |
  |---|---|
  | `ease` | 緩急 / Speed curve |
  | `flow` | 出方の緩急 / Stagger curve |
  | `dwell.curve` | 見せの緩急 / Hold curve |
  | `lens.curve` | 動きの緩急 / Motion curve |
  | `seam.curve` | 切り替えの緩急 / Transition curve |

- **New optional def fields,** validated:
  - lens `frames: boolean` (a framing move) and `warp: boolean` (default `true`, §3.11);
  - arrange `cam: 'any' | 'gentle' | 'none'` (default `'any'`);
  - `mine: object`, allowed only on defs added through `extend`.
- **Key rule:**
  - `createRegistry` refuses keys starting with `myMat`.
  - `extend` accepts only keys matching `^myMat[0-9a-z]+$`, which also satisfy KEY and PARTKEY.
- **`extend(base, defs, { strict = false } = {}) → Registry`:**
  - It validates only `defs`, with `checkDef` plus the key rule and a required `mine`.
  - It reuses the base maps and never mutates `base`. An invalid def is skipped and listed in `problems`.
  - The result has every Registry member plus:

  ```js
  base,                       // the base registry (identity)
  baseVersion,                // base.baseVersion || base.version
  version,                    // hashJSON([baseVersion, [kind, key, sorted part param names, metaHash] per added def])
                              // metaHash = hashJSON of what the planner reads: tags, season, weight, traits, pool, family,
                              // gate, scope, follow, frames, cam, param specs (without functions)
  extra,                      // frozen { [key]: def.mine }
  mine(kind) → string[],      // material keys of a kind, sorted
  ```

  A base registry gets `base = null`, `baseVersion = version`, `extra = {}` and `mine = () => []`, which is additive.

### 3.7 `core/doc`, `core/migrate`, `core/commands`, `core/types`, `i18n/t`

- `core/doc`, `core/migrate`: §2.1–§2.2.
- `core/commands`: §2.6. `LINE_ONLY` gains `avoid`. A new set `NOT_CUT = {season, avoid}` is refused at cut scope, and
  `avoid` is also refused at work scope. `copyable` adds `CAM_SLOTS`.
- `core/types`: JSDoc typedefs for Curve, Shot, Rig, MaterialEntry, AreaRef, Area and the Plan additions, verbatim from
  this file.
- `i18n/t`: `createT(lang, strings, registry)` also accepts a **function** returning the current registry, which is
  additive. `t.part(kind, key)` then reads material labels through the effective registry. A material name is user data,
  so the en page may show Japanese there (D§4.24 allowlist).

### 3.8 `planner/areas` (new, L2; FROZEN)

```js
MV.def('planner/areas', ['core/paths', 'core/lyrics', 'planner/features'], (P, LY, FE) => ({
  AREA_KINDS: ['work', 'song', 'songKind', 'head', 'para', 'lines', 'cut'],
  keyOf(ref) → string,           // 'work' | 'song:3@41.2-62.8' | 'kind:chorus' | 'head:r12' | 'para:r20' | 'lines:r3,r4' | 'cut:r7~5'
  areasOf(doc, plan) → { song: Area[], kinds: Area[], heads: Area[], paras: Area[] },   // the picker lists (§6.8)
  resolve(doc, plan, ref) → Area | null,     // null when the area no longer exists (stale detection)
  inArea(area, path) → boolean,              // paths.isUnder(path, s) for some s in area.scopes
  ofLines(doc, plan, lineIds) → AreaRef,     // the named area with exactly these lines (song > head > para), else { kind: 'lines', ids }
  bands(doc, plan) → [{ key, ref, kind, t0, t1, n }],  // timeline bands: song sections if any, else heads, else paras (≥ 2)
  sameRef(a, b) → boolean,
}));
AreaRef = { kind: 'work' } | { kind: 'song', n, t0, t1 } | { kind: 'songKind', of } | { kind: 'head', rowId }
        | { kind: 'para', rowId } | { kind: 'lines', ids: [lineId] } | { kind: 'cut', key }
Area    = { ref, key, kind, label: [stringKey, params], lineIds /* time order */, cutKeys, scopes /* 'work' | 'line/<id>' |
            'cut/<key>' */, t0, t1, n /* lines */, locked /* locked lines */, songKind: null | SECTION_KIND }
```

Membership rules are deterministic and match the planner's own section rule. The rules per kind:

| Kind | Membership |
|---|---|
| `song` n | `doc.song.info.sections[n]` (after `songInfo` cleaning, D§4.22.4). A line belongs when `t0 ∈ [start, end)`, the same rule as `features.songSection`. Special cuts (`gap/…`, `outro`, `intro`, `title`) with `t0` inside get cut scopes. `t0`/`t1` are recorded in the ref, so a re-analysis makes the ref stale. Ordinals count per kind in time order (サビ1, サビ2). |
| `songKind` | the union of the `song` areas of that kind; offered only when there are ≥ 2 |
| `head` | lines whose row lies after the `#` comment row with a heading and before the next heading row; every occurrence of a multi-stamp row |
| `para` | a block of lines. A new block starts at a line with `pauseBefore > 0`. The ref is the block's first row id. Listed only when the lyrics have ≥ 2 blocks. |
| `lines` | exactly the ids |
| `cut` | exactly that cut |
| `work` | everything |

**Scopes:**
- `cut` area → `['cut/<key>']`.
- `work` → `['work']`.
- Any other kind → `lineIds.map(id => 'line/' + id)` plus the special-cut scopes.

**Labels** (the UI translates params named `kind` through `songSec.<kind>` first):

| Kind | Label |
|---|---|
| song | `['area.song', { kind, n }]` → 「サビ1」 |
| songKind | `['area.songAll', { kind }]` |
| head | `['area.head', { text }]` |
| para | `['area.para', { n }]` |
| lines | `['area.lines', { a, b }]` or `['area.linesOne', { a }]` (1-based line numbers) |
| cut | `['area.cut', { n, k }]` |
| work | `['area.work', {}]` |

### 3.9 Planner (L2; owned by package D)

**`planner/camera` (new):**

```js
SLOT_SPECS,          // { 'motion.speed': num 0.25–4 step 0.05, 'cam.shot': shot, 'cam.zoom': num 0.5–2 step 0.01,
                     //   'cam.curve': curve, 'cam.follow': num 0–1 step 0.01, rig: rig, 'rig.curve': curve }
CAM_SLOTS,           // ['cam.shot', 'cam.zoom', 'cam.curve', 'cam.follow']
decideSpeed(st), applySpeed(st, kind, d),               // cast helpers (§4.3)
decideCamera(st),                                       // cam.shot → cam.zoom → cam.curve → cam.follow (§4.7)
shotWeights(st, trace?) → [{ key, w, why }],            // also used by explain
carry(ctx, cuts),                                       // stage 6 rule (§4.5.7)
rigs(ctx, cuts, seams, duration) → Plan.rigs            // stage 6; sets cut.rig (§4.6)
```

**Changes to existing modules:**

| Module | Change |
|---|---|
| `cast` | **Slot order** (D§4.16.2 stage 5, amended): `orient → arrange → text.* → motion.speed → arrive → dwell → depart → ornament.count → ornament#i → lens → cam.shot → cam.zoom → cam.curve → cam.follow → filter.count → filter#i`, then `els`. Every slot keeps its own named stream (`slotSeedAt`), so **no existing auto choice changes**. `SLOT_SPECS` merges `camera.SLOT_SPECS`. `isChoice(slot, v)` also returns true for `slot === 'cam.shot'` with a string value, so shots enter recency and echo rows and the cast cache stays exact. `freezeSlots` deep-freezes `v`, `p` and `pfrom`. Pools and statics are keyed by the effective season and the avoid id (§4.9). The cast cache is keyed by `registry.base ?? registry` (a WeakMap), then by `registry.version` (a Map, last 4), so material edits that keep `version` keep the cache warm. |
| `choose` | `statics(kind, key, moodFilter, season)` is keyed by season. `seasonFactor` gains the explicit line-season match `SECTION_SEASON = 2.5`. `FACTORS` exports it. |
| `features` | `cutFeatures` adds `sectionStart` (from `fx.sectionStart`, computed in `plan.featureContexts`; it is part of the features cache key). |
| `tracks` | `splitSegments` also breaks where the effective season of the cut differs from the previous cut's (only line pins can make them differ). Seasonal atmos boost (§4.9). Stage 6 order: grounds → seams → rule overrides → **carry → rigs** → impulses. |
| `plan` | `PLAN_VERSION = 2`. `sharedText` uses `registry.baseVersion ?? registry.version`. `planCut` adds `matTerms` to `extra` and to `encodingKey`. `groundFp` adds `matTerms`. `grounds[i].zoomed`. `registry.problems` of an extended registry → `material-bad` warnings. |
| `encode` | `cutPieces`/`encodeCutParts` print `rig`; `planHash` covers `rigs`. Frozen canonical curve and shot objects stay on the fast path. |
| `segment` | `LINE_SPECS.season` is enum `any none spring summer autumn winter`; `LINE_SPECS.avoid` is `{ type: 'partRefs' }`. |
| `fields` | `categoryOf`: `season` with line scope → `'line'`; `avoid` → `'line'`; `rig`/`rig.curve` → `'value'` and `decisionAt` reads `plan.rigs[cut.rig]`. `displayOf` uses `CV.label`, `SHOT.label` and `SHOT.rigLabel`. `lockPayload` needs no code change: it already freezes every auto cut slot, now including `motion.speed` and `cam.*`. `putParams` skips `pfrom: 'rule'` params, so speed-scaled durations are not frozen, and it skips `cam.shot`'s derived `p.carry`. Rigs are not frozen, like grounds. |
| `explain` | cam.* slots through `shotWeights` traces; rig through a tracks trace; why codes of §2.8. The explained value equals the plan value (tested). |

### 3.10 Engine (L3/L5; owned by package B)

**`engine/scene/behave`:**
- `easeOf(v) → CV.fn(v)`.
- `tracksFor` compiles per-column curves with `CV.fn`.
- `compileMoves` validates curves with `CV.coerce`.
- `motionTiming` applies `flow` (§2.3) when it is not linear.
- `holdMaker` wraps with `warped(…, p.curve, rest, out)` when the curve is not linear.
- New module-level exports:

```js
runWarped(P, t, b)                // b.inner(P, (s ≤ 0 || s ≥ 1) ? t : b.w0 + b.span·b.warp(s), b), s = (t − b.w0)/b.span
warped(beh, curve, w0, w1) → Behaviour   // Object.assign({}, beh, { run: runWarped, inner: beh.run, warp: CV.warp(curve), w0, span: w1 − w0 })
```

**`engine/scene/shot` (new, L3; FROZEN for the kit and the facade):**

```js
makeShot(env, cam, target, d) → { behaviours: Behaviour[], lean: Lean | null, track: Track } | null
     // env = cut env (D, times, cut, grid); d = { shot: Decision, zoom, curve, follow } from the cut's slots;
     // null when the shot is 'none' or the cut has no text
aimBox(env, target, aim) → Box | null           // rest-world boxes (§4.5.3)
anchorTime(env, target, at, dt) → number         // cut-local seconds, clamped to [times.a, times.b] (§4.5.2)
frame(D, box, key) → { X, Y, Z, R, cx, cy, sx, sy }   // §4.5.4
poseAt(track, t, out) → out                      // { x, y, zoom, roll }: shared by runShot, the facade and tests
runShot(P, t, b)                                 // module level, allocation-free (pooled pose scratch)
leanInto(scene)                                  // post-solve follow lean (§4.5.6); pure
Track = { a, b, keys: [{ t, X, Y, Z, R, cx, cy, sx, sy, box }], reading: null | { … }, Zread }   // typed arrays inside
```

**`engine/scene/build`:**
- After `lens.make`, call `SHOT.makeShot(…)` with `cam.*` decisions. Its behaviours are added after the lens behaviours
  (phase LENS, build order), so they run after them.
- The scene gains `lean` and `shot` (additive).
- The lens env gains read-only `target` and `shot` (the resolved track).
- `fallbackSlots` sets `cam.shot: 'none'`.
- `slotSeed(slot, d, subject)` hashes object values with `H.hashJSON`.
- `env.mixShare` (§5.9.4) for material parts.

**`engine/scene/frame`:**
- `evaluate(scene, tl)`: `resetLive → runBehaviours → solve → (scene.lean && SHOT.leanInto(scene))`.
- New: `rigAt(plan, t, out) → { x, y, zoom, roll }`, with the index cached by plan identity (§4.6).
- New: `rigCamera(plan, t, out) → CamPose` (rig plus impulses, for grounds without a cut).
- `cameraAt` composes the rig (§4.4).

**`engine/render/renderer`:**
- Grounds in gaps use `F.rigCamera`.
- The text-seam blend (`textSeamCam`) uses a log-lerp of zoom.
- `staticRaster` oversamples ×1.25 when `plan.grounds[i].zoomed`.
- `setRegistry(registry)` (additive) swaps the registry for filter and seam lookups.

**`engine/render/seam`:** `seamPart` adds `warp: CV.warp(p.curve)` to its cached entry, and `mix` receives `part.warp(k)`.

**`engine/facade`** (D§4.20, additive members):

```js
engine.registry                   // getter: the effective registry of the current doc
engine.setDoc(doc)                // now: current = MIX.registryFor(base, doc.materials); plan with it; renderer.setRegistry(current)
engine.shotTrack(cutKey) → { a, b, keys: [{ t, x, y, zoom, roll, aim: Box }] } | null   // from the built scene (UI overlay)
engine.viewAt(t) → { x, y, zoom, roll }       // the current cut's camera ∘ rig (drag inversion on the stage)
engine.thumb({ kind: 'shot' | 'rig', key }, surface, opts)   // canned sample cut with that shot / rig (picker tiles)
```

- `fork()` keeps `current`, so export renders with the same parts.
- The thumbnail renderer uses `current`.
- `samplePlan` accepts the shot and rig kinds and material keys.

### 3.11 Kit and parts (L3/L4; owned by package B)

**`parts/kit`** (D§4.18.3 FROZEN export list, additive):

```js
curve(value) → (u) => number      // = CV.fn; memoized; call at build or definition time, never per frame
warp(value) → (u) => [0,1]        // = CV.warp
CURVES                             // CV.PRESET_KEYS
warped(behaviour, curve, t0, t1) → Behaviour   // = BH.warped
aimBox(env, aim) → Box | null      // from env.target (lens env)
frameBox(env, box, fill, ox, oy) → { zoom, x, y }
```

- `K.moves` column curves accept Curves.
- `K.mirror` reverses with `CV.reverse` (`reversedAuto` maps picks and values through it; `flow` autos too).
- `K.lens` wraps `make` once per definition when `def.warp !== false`:
  `make' = (env, cam, p) => { const list = make(env, cam, p); return CV.isLinear(p.curve) ? list : list.map((b) =>
  BH.warped(b, p.curve, env.times.a, env.times.b)); }`. The wrapper closure is created at definition time, never per
  build (the `K.mirror` precedent).

**Lens parts:**
- `parts/lens/glide.js` moves read `curve: K.curve(p.curve)` instead of their hard-coded ease. They declare the old ease as
  the shared auto:
  - slowPush `{ curve: { auto: { value: 'sineInOut' } } }`;
  - dollyOut `quadOut`;
  - driftFloat `linear`;
  - panSweep `sineInOut`;
  - parallaxOrbit `sineInOut`.
- These five set `warp: false`. slowPush, dollyOut, panSweep and parallaxOrbit set `frames: true`.
- rollSway and handHeld keep `warp: true` (periodic, time-warped).
- `parts/lens/kick.js`: beatZoom and impactKick set `warp: false`, and their `curve` is `{ ui: 'advanced', ai: false }`
  (beat- or impact-locked).
- `fixedFrame` is unchanged.

**Arrange parts** (`cam` field): these are metadata edits only. Keys, params and autos are unchanged.

| Value | Parts |
|---|---|
| `'none'` | edgeBleed, diptychSplit, tickerMarquee (`motion: 'own'`), gridMosaic |
| `'gentle'` | confettiWords, haloRing, hangingTags, slantBand, titlePlate, breathMark, creditFold |
| `'any'` (default) | all others |

### 3.12 `parts/mix` (new, L3; owned by package C, stub by A)

```js
MV.def('parts/mix', ['core/num', 'core/hash', 'core/rng', 'core/noise', 'core/curve', 'core/recipe', 'core/registry',
  'parts/kit', 'engine/scene/behave'], (…) => ({
  SHAPE_LIB,                           // frozen unit ShapeSpecs per SHAPES name (made once at module level)
  derive(entry, base) → { def | null, problems },          // §5.9.1
  registryFor(base, materials) → Registry,                 // §5.9.2; base itself when materials is absent or its list empty
  materialHash(entry) → 'xxxxxxxx',                        // hashJSON of the whole normalized entry (stale checks)
  sampleDefs() → def[],                                    // one composite material per COMPOSITE_KIND, plus one run ornament
                                                           // (conformance, lab); keys 'myMatS…', never in a registry
}));
```

**A's stub** exports the same names:
- `registryFor(base) → base`;
- `derive → { def: null, problems: [] }`;
- `materialHash → '00000000'`;
- `sampleDefs → []`.

### 3.13 AI (L5; owned by package E)

| Module | Exports |
|---|---|
| `ai/direct` (new) | `MAX_BRIEFS = 8`, `MAX_INSTRUCTION = 300`, `MAX_LINES = 200`, `directSchema({ mode, allowMaterials })`, `directRequests(doc, plan, registry, opts) → Request[]`, `directChanges(doc, plan, registry, answers, opts) → Result`, `curveFromAi(x)`, `cameraFromAi(x)` (§5.2–§5.5) |
| `ai/recipe` (new) | `AI_MATERIAL`, `MATERIAL_SCHEMA`, `fromAi(ai, registry, kindHint?) → { entry, warnings }`, `toAi(entry) → AI_MATERIAL value`, `materialRequest(doc, plan, registry, opts)`, `materialChanges(doc, plan, registry, json, opts)` (§5.10) |
| `ai/catalog` | `catalog(...)` accepts the kinds `lens`, `filter` and `atmos` (run ornaments). New: `materialsText(registry, lang)`, `cameraText(lang)`, `recipeText()`. |
| `ai/changes` | kinds `value`, `material`; groups; Change fields; material-aware `toCommands`, `apply`, `logEntry`, `revertCommands`; area-aware `markStale` (§5.6) |
| `ai/looks` | additive export `helpers = { partChange, lineChanges, lyricChanges, filterChanges, seasonChanges, amountChanges, paletteChange, namedChange, sharedContext, contextOf, lookContext }`. Its schemas are unchanged. |

### 3.14 UI (L7; owned by package F)

| Module | Change |
|---|---|
| `ui/fields` | New slot scopes (§2.3). `WIDGETS` gains `curve`, `shot`, `rig` and `partRefs`. `widgetFor`: curve → `curve`, shot → `shot`, rig → `rig`, partRefs → `partRefs`. Pages as in §6.5. `areaLabel(t, area)` (pure). |
| `ui/widgets` | registers the four widgets; `curve` is implemented in `ui/curve_widget` |
| `ui/curve_widget` (new) | §6.6 |
| `ui/shot_editor` (new) | keyframe sub-page (§6.7) |
| `ui/material_page` (new) | material sub-page (§6.9) |
| `ui/ai_board` (new) | 区画ごと board sub-page (§6.3) |
| `ui/inspector` | camera sections, area header, sub-pages, マイ素材 section |
| `ui/part_browser` | `mine` tab, inline AI form, tile context menu |
| `ui/ai_panel` | instruction block (§6.2) |
| `ui/ai_review` | groups, aggregate rows, dependencies (§6.4) |
| `ui/ai_controller` | tools `direct`, `material`; target state; windows; board |
| `ui/selection` | line Sel gains optional `area: AreaRef` |
| `ui/timeline` | clickable area bands, context menu, key diamonds |
| `ui/stage` | shot key overlay, drag inversion via `engine.viewAt` |
| `ui/palette` | `%` prefix selects an area |
| `ui/lyric_editor` | the heading gutter click also sets `sel.area` |
| `ui/boot` | `app.reg` becomes a getter over `engine.registry`; `createT` receives `() => app.reg` |
| `ui/style.css` | styles for the new controls |

---

## 4. Speed curves, camerawork and the renderer

### 4.1 The curve model

**Speed ramp (`sp`), closed form.**
- Inputs: knots `(U_i, S_i)`, `i = 0..n`.
- Segment areas: `A_i = (U_{i+1} − U_i)(S_i + S_{i+1})/2`. Cumulative areas: `C_0 = 0`, `C_{i+1} = C_i + A_i`.
  Total: `A = C_n`.
- For `U_i ≤ u < U_{i+1}`, with `L = U_{i+1} − U_i` and `τ = u − U_i`:
  `f(u) = (C_i + S_i·τ + (S_{i+1} − S_i)·τ²/(2L)) / A`.
- Ends are exact: `f(0) = 0`, `f(1) = 1`.
- `f` is monotone because `s ≥ 0`.
- A zero-length segment (`L = 0`) is a jump in speed, not in position, and is skipped.
- Compile builds `Float64Array`s `U`, `S` and `C`. Evaluation is a linear scan (≤ 8 knots) with no allocation.

**Ramp → sp** (`W = RAMP_W = 0.06`; `e` = edge, `k` = peak). Knots that duplicate the previous knot exactly are dropped.

| `ends` | Knots |
|---|---|
| both | `[[0,1],[e,1],[e+W,k],[1−e−W,k],[1−e,1],[1,1]]` |
| start | `[[0,1],[e,1],[e+W,k],[1,k]]` |
| end | `[[0,k],[1−e−W,k],[1−e,1],[1,1]]` |

Checks:
- `edge 0.1, peak 6, both`: the first 10 % of the time covers 2.1 % of the way, and the middle covers 87 %. This is
  「最初と最後は一瞬遅く、途中はすごく速い」.
- `peak < 1` gives slow in the middle and fast ends.

**Bézier:** `E.bezier(x1, y1, x2, y2)`.

**Presets** (stored by name; FROZEN data and labels):

| Key | ja (UI) | en | Data | Profile |
|---|---|---|---|---|
| `softEnds` | ゆっくり→速く→ゆっくり | Slow–fast–slow | `bz [0.6,0,0.4,1]` | smooth S, symmetric |
| `hushRushHush` | 一瞬ゆっくり→すごく速く→一瞬ゆっくり | Brief ease, rush, brief ease | `sp [[0,.15],[.12,.3],[.22,1.9],[.78,1.9],[.88,.3],[1,.15]]` | 10 % of the way by 22 % of the time; the middle 56 % covers 80 % |
| `holdThenDash` | 一瞬ためて一気に | Hold, then dash | `sp [[0,0],[.28,.08],[.34,2.4],[.8,1.1],[1,0]]` | 1 % of the way by 28 %, a dash, soft landing |
| `dashStop` | 速く→ぴたっと止まる | Fast, sudden stop | `sp [[0,1.5],[.86,1.3],[.94,.08],[1,0]]` | 95 % of the way by 86 % |
| `slowBloom` | だんだん速く | Speeding up | `sp [[0,.08],[1,2]]` | mirror of fadeBrake |
| `fadeBrake` | だんだん遅く | Slowing down | `sp [[0,2],[1,.08]]` | |
| `snapSettle` | 行きすぎて戻る | Overshoot and settle | `bz [0.2,0.9,0.25,1.15]` | overshoots; for position curves only |

`W(u)` clamps, so `snapSettle` as a time-warp, stagger or seam curve reads as `dashStop`-like without overshoot. The curve
widget marks it 「位置の動きだけ」 on those fields.

### 4.2 Where curves apply

| Target | Mechanism |
|---|---|
| Glyph entrance/exit progress | `k = CV.fn(p.ease)(u)` (`runGlyphMotion`) |
| Per-column track curves (`K.moves` `curve`) | `CV.fn` per column (fixed by the part) |
| Stagger | `flow`: `delay_j = W(rank_j/maxRank)·maxRank·fit.each`. `total` is unchanged because `W(1) = 1`, so `fitMotion`, `heroTime` and `repT` are unchanged. |
| Hold | `dwell.curve` warps the hold clock over `[rest, out]` (`BH.warped`) |
| Lens | framing lenses: the move curve. Periodic lenses: warped over `[a, b]` by the kit wrapper. |
| Shot keys | per key: `curve` of the key, else `cam.curve` |
| Rig | per rig key: its curve, else `rig.curve`, else the preset's |
| Seam | `seam.curve` warps `u` for `mix` only. The ground-camera blend and the current-cut switch keep raw `u`. |
| Material motion | recipe `curve` / `colCurve` (§5.7.3) |

### 4.3 Motion speed (`motion.speed`)

- `decideSpeed`: a pin coerced through the spec, else `{ v: 1, from: 'auto' }`.
- `applySpeed(st, kind, d)` runs right after `resolveParams` of arrive, depart and dwell.
- For each of `dur`, `each` (arrive/depart) and `speed` (dwell) whose `pfrom` is absent (not pinned):
  - `dur`/`each`: `v' = coerce(spec, v / speed)`;
  - dwell `speed`: `v' = coerce(spec, v · speed)`;
  - then set `pfrom[name] = 'rule'`. `v` is skipped when speed = 1.
- The fit caps are unchanged. `fitMotion` still limits an entrance to 45 % of the window. The review row states the cap
  when a slow-motion request hits it (§6.4).
- Shot keys anchored at `rest`/`out` follow the new timing automatically.

### 4.4 Camera layers and composition (D§4.19.3 amended; FROZEN)

The camera pose of a cut item at absolute time `t` is built in four steps:

1. **Lens** behaviours (phase LENS, built first) write deltas on the camera node as in v2.
2. The **shot** behaviour (phase LENS, built after) reads those deltas and composes them with the shot pose
   `(X, Y, Z, R)` from `poseAt`, so lens amplitudes stay screen-constant:
   ```
   x = X + x_lens/Z;  y = Y + y_lens/Z;  sx = sy = Z · sx_lens;  rot = R + rot_lens;  jx /= Z;  jy /= Z
   ```
3. **Follow lean** runs post-solve in `frame.evaluate`: `leanInto` adds the lean to the camera's live x/y (§4.5.6). The
   camera node has no children, so nothing is re-solved.
4. **`cameraAt(scene, plan, t, out)`** composes the rig `(Xr, Yr, Zr, Rr) = rigAt(plan, t)` and the impulses:
   ```
   Zc = P.sx[c], Xc = P.x[c], Yc = P.y[c], Rc = P.rot[c]
   zoom = Zc · Zr · (1 + PUNCH · punch)
   x = Xc + Xr / Zc;   y = Yc + Yr / Zc;   roll = Rc + Rr
   shakeX = P.jx[c] + shakeImpulseX / (Zc · Zr);   shakeY likewise
   ```
   With roll 0 this is exactly the product of the two view transforms (outer rig ∘ inner cut camera). Roll is additive.

- **Grounds:** they use the current cut's camera, during a world seam their side's cut camera, during a text seam the
  `textSeamCam` blend, and in gaps (no cut on screen) `rigCamera(plan, t)`. So the area move continues through interludes
  and the ground never jumps.
- **The hud layer** keeps no camera.
- **Blend** (`textSeamCam`): lerp `x`, `y`, `roll` and the shakes; zoom is `exp(lerp(ln Za, ln Zb, smooth(u)))`.

### 4.5 Shots

#### 4.5.1 Presets (FROZEN; `core/shot.SHOTS`)

Tags feed `moodBias` exactly like part tags. `ox` absent means "keep" (§4.5.4).

| Key | ja / en | Tags | Keys (`at` → `aim` fill, extras, curve) |
|---|---|---|---|
| `settle` | 寄って落ち着く / Settle in | soft slow minimal | a → block .58 ; rest → block .66 |
| `pushWord` | 言葉へ寄る / Push to the word | bold serious | a → block .6 ; emph (dt −.1) → emph .82 ; b → emph .88 `linear` |
| `readAlong` | 読みに合わせる / Read along | literary soft | follow .25 ; a → first .75 ; sung → reading .75 ; end → block .6 |
| `snapZoom` | 一気に寄る / Snap zoom | hard bold fast | a → block .55 ; sung (dt −.06) → block .55 `linear` ; sung (dt +.12) → emph .95 `dashStop` ; b → emph .9 `fadeBrake` |
| `pullReveal` | 寄りから引く / Pull to reveal | airy serious | a → first .95 ; rest → block .6 |
| `sweepAcross` | 横に流す / Sweep across | fast playful | a → first .8 ox −.12 ; out → last .8 ox .12 |
| `tiltHold` | 斜めに構える / Tilted hold | playful bold | a → block .64 roll −4 ; b → block .68 roll −2 |
| `driftOff` | 外して置く / Off-center drift | literary airy slow | a → block .5 ox .18 ; b → block .52 ox .12 `linear` |
| `wideHold` | 引きで見せる / Wide hold | slow airy minimal | a → frame zoom .94 ; b → frame zoom .98 `linear` |

#### 4.5.2 Anchors

Times are cut-local, with sung start = 0. `times` are the fitted `{a, rest, out, b}` (D§4.17.5).

| Anchor | Time |
|---|---|
| `a`, `rest`, `out`, `b` | `times.*` |
| `sung` | 0 |
| `mid` | `(t1 − t0)/2` |
| `end` | `t1 − t0` |
| `emph` | sung start of the first emphasized glyph's word: `sungFractions(env, target, 'word')[j]·(t1 − t0)`; no emphasis → `mid` |
| `word:k` | the same for word k (negative k counts from the end; clamped to the word count) |
| `beat:n` | first beat at or after 0 (`env.grid.beatAt`), plus `n` periods; without a grid, 0.5 s steps |
| number x | `a + x·(b − a)` |

- `dt` is added, then the time is clamped to `[a, b]`.
- Keys are stable-sorted by time.
- Two keys closer than 1/120 s form a deliberate jump: the later key applies from its time.

#### 4.5.3 Aims

Boxes are rest-world boxes from `target.box`, after `el.text.nudge`. Spaces are ignored. Every box is floored at
`m = 0.06·short` per side, so a one-glyph aim cannot zoom without bound.

| Aim | Box |
|---|---|
| `block` | `target.focus` |
| `emph` | union of the first emphasized run (`hints.emph` / `emphLines`); no emphasis → `last` |
| `first`, `last`, `word:k` | word unit boxes (`target.unitOf.word`) |
| `line:k`, `glyph:k` | line and glyph boxes (k clamped) |
| `frame` | design frame (`c = C`) |
| `point` | `c = (px·W, py·H)` |
| `reading` | the reading path (§4.5.5) |

#### 4.5.4 Framing (FROZEN math)

Given a key with aim box `B = {x, y, w, h}`, its centre `c`, frame centre `C = (W/2, H/2)` and safe margin
`s = 0.05·short`:

1. **Zoom:**
   - text aims: `Z = clamp(fill · min(W / max(w, m), H / max(h, m)), 0.9, 3)`;
   - `frame`/`point`: `Z = clamp(zoom, 0.9, 1.25)`.
2. **Screen position** `S`:
   - with `ox`/`oy`: `S = (ox·W, oy·H)`;
   - otherwise **keep**: `S = c − C`, so the aim stays where the composition put it and the camera zooms about it (the
     slowPush aim rule).
3. **Clamp `S`** so the zoomed box stays inside the safe area: with `hw = w·Z/2` (0 for frame/point),
   `S.x ∈ ±max(0, W/2 − s − hw)`. `S.y` likewise with `H` and `hh`.
4. **Camera:** `X = (c.x − C.x) − S.x/Z`, `Y = (c.y − C.y) − S.y/Z`, `R = roll·DEG`.
5. **Bleed-safe clamp:**
   `|X| ≤ LX(Z) = W · min over k ∈ {0.5, 1.2} of (0.6 − 0.5 / (1 + (Z − 1)·k)) / k`, and the same for `Y` with `H`.
   - 0.6 = the 0.5 half frame plus 0.1 of the 0.15 ground/particle bleed. 0.05 is left for the rig and lens.
   - At Z = 1 this allows ±0.083 W; at Z = 1.5 it allows ±0.28 W.

**Interpolation between keys i → j**, for `t ∈ [t_i, t_j)`:
```
f = curve_j((t − t_i)/(t_j − t_i))
Z = exp(lerp(ln Z_i, ln Z_j, f))
c = lerp(c_i, c_j, f)
S = lerp(S_i, S_j, f)
X, Y recomputed with Z (so the aimed word travels straight on screen)
R = lerp(R_i, R_j, f)
```
The pose is held before the first key and after the last.

#### 4.5.5 `aim: 'reading'` (built at scene build)

**Units:**
- words;
- if there is 1 word with ≥ 4 glyphs: ≤ 4 equal reading-order glyph chunks;
- if there are more than 12 words: lines.

**Per unit k:**
- `τ_k` is its sung start. It uses `sungFractions` for words and lines; chunks use the same morae rule over their
  glyphs.
- `c_k` is its box centre.
- `S_k` is computed with "keep" or the key's `ox`/`oy`.
- `Z_read` is constant over the span. It comes from the key's `fill` applied to the median-area unit box, so the zoom
  never pumps.

**Path:**
- Hop duration: `h_k = min(0.35, 0.6·(τ_k − τ_{k−1}))`.
- On `[τ_k − h_k, τ_k]` the camera moves from unit k−1 to unit k with the key's curve; otherwise it holds on the current
  unit.
- The segment *into* a reading key ends on `path(t_i)`. The segment after it runs `lerp(path(t), key_{i+1}, g(u))`.
- The path is continuous. The frame-time cost is a binary search over ≤ 40 units.

#### 4.5.6 Follow lean (post-solve, pure)

For the text glyphs `j` of the cut (`target.from..to`, skipping world alpha < 1/255):
```
d_j = (m[6i+4] − wx_j, m[6i+5] − wy_j)                 // displacement from the rest position (world matrices)
w_j = clamp(|d_j| / (0.6·em_j)) · wa_j
L   = Σ w_j·d_j / max(1, Σ w_j);   L' = L · c / (c + |L|),  c = 0.1·short
P.x[cam] += follow · L'.x / P.sx[cam];   P.y[cam] += follow · L'.y / P.sx[cam]
```
- The lean is 0 at rest, bounded by `c`, and continuous wherever glyph poses are.
- It reads world matrices, so it is correct under rotated or scaled arrange groups.
- It costs one pass over ≤ 60 glyphs.

#### 4.5.7 Carry (reframing between phrases)

The rule applies to consecutive cuts A → B of the **same line** when:
- both shots are not `none`;
- B's shot is a preset, not pinned as a custom object;
- the boundary is a hard cut or a text seam.

Then B's `cam.shot` decision is replaced by a new frozen object with `p.carry = SHOT.lastFraming(A.shot, { zoom:
A.cam.zoom })` and `pfrom.carry = 'rule'`, like the seam `replaceMotion` rule. The framing is symbolic; no geometry is
used. `expandShot` then starts B at A's closeness, screen position and roll, which is a match cut. The explain rule is
`carry`.

#### 4.5.8 `fromMove` (the AI's move vocabulary → Shot; FROZEN table)

Inputs:
- `T` = `{ whole: [a, b], arrive: [a, rest], hold: [rest, out], depart: [out, b] }[timing]`.
- `F` = `{ text: block, emphasis: emph, first: first, last: last, center: frame }[focus]`.
- `f1 = clamp(fill, 0.3, 1.1)` (`fill < 0` → 0.75); `f0 = max(0.3, f1 − 0.25)`.
- For `F = frame`, `fill` maps to `zoom = 1 + 0.25·(f − 0.3)/0.8`.

| move | Keys |
|---|---|
| `pushIn` | `[{at:T0, aim:F, fill:f0}, {at:T1, aim:F, fill:f1}]` |
| `pullOut` | `[{at:T0, aim:F, fill:f1}, {at:T1, aim:F, fill:f0}]` |
| `panLeft` / `panRight` | `ox −.12 → +.12` / `+.12 → −.12` at `fill:f1` (the camera turns left, so the words travel right) |
| `panUp` / `panDown` | `oy −.1 → +.1` / `+.1 → −.1` |
| `tilt` | `roll −4 → +4` at `fill:f1` |
| `drift` | `[{at:'a', aim:F, fill:f1, ox:−.06}, {at:'b', aim:F, fill:f1, ox:.06, curve:'linear'}]` (timing ignored) |
| `follow` | `{ follow: .25, keys: [{at:'a', aim:'first', fill:f1}, {at:'sung', aim:'reading', fill:f1}, {at:'end', aim:'block', fill:f0}] }` |
| `punch` | `[{at:'a', aim:'block', fill:f0}, {at:P, dt:−.06, aim:'block', fill:f0, curve:'linear'}, {at:P, dt:.12, aim:F, fill:f1, curve:'dashStop'}, {at:'b', aim:F, fill:max(.3, f1−.05)}]`, where `P = focus === 'emphasis' ? 'emph' : 'sung'` |

An unknown move returns `undefined`. The result is coerced by `coerceShot`.

### 4.6 Rigs (area camera)

**Presets** (FROZEN; `u` is run-normalized time):

| Key | ja / en | Keys | Curve |
|---|---|---|---|
| `slowSwell` | じわじわ寄る / Slow swell | u0 zoom 1 → u1 zoom 1.08 | softEnds |
| `climbRise` | 持ち上がる / Rising | zoom 1.02, y +.025 → zoom 1.06, y −.025 | softEnds |
| `pullAway` | 遠ざかる / Pull away | zoom 1.10 → 1.0 | fadeBrake |
| `leanTilt` | 傾いていく / Lean | zoom 1.02, roll 0 → zoom 1.04, roll 2.5 | softEnds |
| `driftSide` | 横へ流れる / Side drift | zoom 1.03, x −.02 → zoom 1.03, x .02 | linear |

**Evaluation** (`frame.rigAt`; index cached by plan identity):
- Find the run by binary search on `t0`: before the first run → the first; after the last → the last.
- `u = clamp((t − t0)/(t1 − t0))`.
- Interpolate keys with their curves (key `curve`, else `run.curve.v`):
  - zoom in log space;
  - `x`, `y` in frame fractions, converted to du (`x·W`, `y·H`);
  - roll in degrees, converted to radians.
- **amp** scales deviations: `zoom' = exp(amp·ln zoom)`, `x' = amp·x`, `roll' = amp·roll`.
- Inside `run.blend = { t0, t1 }`: `pose = lerp(prevRun.pose(t, u clamped to 1), pose, smooth((t − t0)/(t1 − t0)))`,
  with zoom in log space.
- A hard cut switches runs with no blend.

**Runs** (planner, stage 6). Split where:
- `feat.section` changes (null counts as its own value);
- a cut with role `title`, `interlude` or `outro` starts or ends (each gets its own run);
- the resolved `rig` pin value changes (compared by canonical JSON).

The run's params, `rig.curve` and seed come from its first cut: `seed = hash32('rig', look.seed, firstCutKey,
salts['cut/' + first] ?? 0)`.

### 4.7 Automatic camerawork (planner; FROZEN formulas)

Notation: `A = look.amounts.camera`, `f = cut.feat`, `pool` = shot keys plus `'none'`.

**Rules first** (`from: 'rule'`, except the amount rule, which is `'auto'`):
1. `A < 0.1` → `none` (why `cam.amount`).
2. The chosen arrange has `cam: 'none'` → `none`.
3. `f.dur < 0.8` → pool `{none, settle}`.
4. Role pools:
   - `title` → `{settle, pullReveal, wideHold}`;
   - `interlude` → `{none, wideHold, driftOff}`;
   - `outro` → `{pullReveal, wideHold, none}`.
5. Arrange `cam: 'gentle'` → pool `{settle, wideHold, tiltHold, driftOff}`.

**Weights:**
```
none        3·(1−A)² + (lens def.frames ? 4 : 0)
settle      1.2
pushWord    (f.emph ? 3 : f.words ≥ 2 ? 0.8 : 0.2) · (0.6 + f.energy)
readAlong   (f.words ≥ 3 && f.dur ≥ 2.2 ? 1.6 : 0) · (orient 'v' ? 0.7 : 1)
snapZoom    f.impact ? 5 : (f.energy ≥ 0.75 && f.onBeat ? 0.5 : 0)
pullReveal  f.sectionStart ? 2 : 0.4
sweepAcross (f.words ≥ 2 && f.cells ≥ 8 && orient 'h') ? 0.9 : 0
tiltHold    0.6 · (f.energy ≥ 0.4 ? 1 : 0.3)
driftOff    f.cells ≤ 10 ? 0.7 : 0.2
wideHold    (f.dur ≥ 3 && f.energy < 0.45) ? 1 : 0.1
× moodBias(preset.tags)          (CH.moodBias; 1 for none)
× section:  chorus: pushWord, snapZoom, sweepAcross ×1.5, none ×0.6 · verse or null: settle, driftOff, none ×1.3 ·
            bridge: tiltHold, wideHold ×1.5 · intro, outro: pullReveal, wideHold ×1.5
× recency:  ×0.1 if = the previous cut's final cam.shot (hist.previous); ×0.4 if among the 3 before (hist near set)
× echo:     ×3 if = the natural cam.shot of feat.repeatOf's cut (hist.echo)
value = CH.pickWeighted(pool keys sorted, w → q6(w), slotSeed('cam.shot'))     // Gumbel keyed by shot key; ties → smaller key
```

**Parameters** (each has its own slot seed):
- `cam.zoom = coerce(q2(lerp(0.85, 1.2, clamp(0.5·A + 0.5·f.energy)) · (f.impact ? 1.1 : 1)))`. For arrange `gentle`:
  `min(that, 0.7 / SHOT.maxFill(shot))`.
- `cam.curve` = `R.fromSeed(seed).weighted(values, weights)` with:
  - impact → `dashStop` 3, `holdThenDash` 2;
  - `f.energy ≥ 0.65` or `mood.tagBias.fast > 1.2` → `hushRushHush` 3, `holdThenDash` 2, `softEnds` 1;
  - otherwise → `softEnds` 3, `fadeBrake` 2, `slowBloom` 1.
- `cam.follow`:
  - 0 for `none` and `wideHold`;
  - the shot's own `follow` when it has one;
  - else `q2(clamp(0.1 + 0.4·amounts.motion + (arrive def tags include 'fast' ? 0.1 : 0)))`.

**Rig choice:**
- `A < 0.15` → `none`.
- Otherwise `CH.pickWeighted` over the weights below, each × `moodBias(tags)`. Rig tags are `slowSwell` slow soft,
  `climbRise` bold, `pullAway` airy slow, `leanTilt` playful, `driftSide` airy.
- The previous run's winner is avoided while another candidate weighs > 0 (the D§4.16.6 runner-up rule).

  | `feat.section` of the first cut | Weights |
  |---|---|
  | chorus | slowSwell 3, climbRise 2, leanTilt .5, none 1 |
  | prechorus | climbRise 3, slowSwell 1 |
  | verse or null | driftSide 2, slowSwell 1, none 2 |
  | bridge | leanTilt 2, driftSide 1, none 1 |
  | intro, title | slowSwell 2, none 1 |
  | outro | pullAway 4, none 1 |
  | interlude | driftSide 2, none 1 |
  | solo, other | slowSwell 1, climbRise 1 |

- `amp = q2(0.4 + 0.6·A)`.
- The **last chorus run** gets amp ×1.25 (clamped to 1.3) and curve `slowBloom` (why `rig.lastChorus`).
- Other runs use the preset's curve unless `rig.curve` is pinned.

**Stability** (tested, D§4.16.4 targets):
- Inserting a line changes ≤ 4 other cuts' shots.
- Rerolling a cut changes ≤ 3 other cuts.
- Documents without new pins keep every v2 part choice (the new slots use new streams).

### 4.8 Renderer and frame changes (summary)

| Where | Change |
|---|---|
| `frame.evaluate` | the post-solve lean (§4.5.6) |
| `frame.cameraAt` | rig composition (§4.4) |
| `frame.rigAt`, `frame.rigCamera` | new (§4.6) |
| `renderer.gather` | grounds in gaps use `rigCamera`; `textSeamCam` log-lerps zoom |
| `renderer.staticRaster` | Rasterizes ×1.25 when the ground's segment is `zoomed`. At 1080p that is 1.56 × 11.6 MB ≈ 18 MB, under the existing per-raster cap of 24 MB. Above the cap it draws live as today. It depends only on the plan, so preview equals export. |
| `seam.mix` | receives the warped `u` |
| Glyph path | unchanged (D§4.19.5 rule). Zoomed blurred glyphs pick larger sprite buckets, still ≤ 512 px. |
| Optional culling | `draw.drawLayer` may skip glyphs whose view-space quad lies fully outside the frame when view zoom > 1.3. Decided from geometry only, so it is identical in preview and export. |

### 4.9 Line season and avoid (planner; D§4.16 amended)

These are the planner rules behind the line slots `season` and `avoid` (§2.3).

1. **Effective season** of a cut:
   `sc(c) = the line pin 'season' of c's line (rank pin:line only), else look.season`.
   - Special cuts use `look.season`.
   - Pools and statics use `sc(c)`: `poolBy` adds `|s:<season>|a:<avoid id>` to its cache key.
   - `pin-off-season` compares with `sc(c)`.
2. **Chooser factor.** When `sc(c)` comes from a line pin and matches a part's season, the factor is `SECTION_SEASON = 2.5`
   instead of ×1.5.
3. **Avoid.** `withAvoid(filters, refs)` adds the refs to `deny` per kind.
   - If that would empty a pool that is not otherwise empty, the avoid is relaxed for that kind and `avoid-empty` is
     reported.
   - Tracks read the first cut's line avoid for ground and atmos, and the receiving cut's line avoid for seams.
4. **Segments.** `splitSegments` also breaks where `sc` differs from the previous cut's.
   - A segment whose first cut's season comes from a line pin draws atmos with probability
     `max(0.6·amount.ornament, 0.85)`.
   - Run ornaments of that season weigh ×2.5 there.
5. **Cast cache.** `castInputs` already covers every pin of the cut's line, so no new cache field is needed.
6. **Unchanged documents.** Without `season`/`avoid` pins every value is as in v2. Golden-tested.

---

## 5. Area instructions (AI) and materials

### 5.1 Areas

Areas are defined by `planner/areas` (§3.8). They are never saved.

- A line selection may carry `area: AreaRef` (`ui/selection`, additive to the D§4.23 `Sel`).
- `validate(sel, plan)` re-resolves it. When the area's lines no longer equal `ids`, `area` is dropped and `ids` is kept.

### 5.2 The `direct` tool (指示)

**Single area.** The panel's instruction box sends one brief:
- target 全体 → `{ kind: 'work' }`;
- 選択中 → `ofLines(sel.ids)` or `{ kind: 'cut', key }`;
- 区画▾ → the picked area.

**Board.** 区画ごと sends 1–8 non-empty briefs in **one** request.

**Mode `camera`** (chip 「カメラワークをAIに任せる」):
- The schema has camera fields only (§5.4). Effort is `low`.
- The instruction may be empty. The prompt then asks for camerawork that suits the lyrics, the song sections and the
  highlights.

**Windows.** A request lists at most `MAX_LINES = 200` area lines over all briefs. A larger target is split into
consecutive windows of whole areas, or line ranges for one huge area. `directRequests` returns one request per window;
the controller runs them in sequence and merges the results into one review. Change ids are prefixed `w<k>:`.

**Signatures:**

```js
directRequests(doc, plan, registry, {
  briefs: [{ ref: AreaRef, instruction: string }],   // 1..8; instruction trimmed to 300 chars, line breaks → spaces
  uiLang, mode: 'all' | 'camera', allowMaterials: boolean,
}) → [{ system, prompt, schema, effort: 'medium' | 'low',
        sent: { briefs: [{ s, ref, key, lines: [{ i, lineId, text, locked, cuts: [{ j, key, text }] }] }] } }]

directChanges(doc, plan, registry, json, { rev, sent, allowMaterials }) →
  { results: [{ s, areaKey, understood, summary, question }], changes: Change[], warnings: [stringKey, params][] }
```

**Provider fallback.** If a provider answers `bad_request` to the full schema, the controller retries once with
`allowMaterials: false` and shows `ai.materialsFailed`.

### 5.3 What is sent and the prompt

**Privacy is unchanged.** Only lyric text, the instructions and setting values are sent.

**Prompt parts, in order:**

1. `lookContext(doc, plan)` and `SONG.songContext(doc, plan)` (existing).
2. Per brief:
   - a header `Brief <s> — area: サビ1 (chorus, 41.2–62.8 s, 5 lines) — instruction: 「…」`;
   - for a work brief: `area: whole video`.
3. The brief's lines, numbered locally `i = 0..n−1`. Each line gives its current state from its first cut:
   ```
   2: 君の名前を呼ぶ声が · arrange=stairStep arrive=inkRise(.62s, curve=expoOut) dwell=breathePulse depart=fogOut ·
      lens=slowPush shot=settle(auto) camCurve=softEnds speed=1 · orn=cornerTicks,- · atmos=- ground=washiFiber ·
      season=- rig=slowSwell · locked:no
     cuts: 0 君の名前を / 1 呼ぶ声が
   ```
   One line before and one after the area are listed as `(context — do not change)` without a number.
4. Lists:
   - parts: `ai/catalog` for arrange, arrive, dwell, depart, ornament and ground, plus `[lens]`, `[filter]` and
     `[atmos]` (run ornaments);
   - materials of the effective registry with `[mine]` (`materialsText`);
   - `cameraText(lang)`: shot presets with blurbs, moves, foci, timings, rig presets, curve presets and ease names;
   - themes and moods (work briefs only).
5. With `allowMaterials`: `recipeText()`, which is ≤ 2,000 characters (§5.10).

**System prompt** (English; `summary` and `question` are written in the UI language):

```
You direct parts ("areas") of a lyric-motion video (文字PV). Each brief is one area (its lines) plus the user's instruction
for that area only. For each brief s, return the smallest set of settings that does what it asks; leave everything else.
Numbering: in brief s, area lines are i = 0..n-1 and cuts of a line are j = 0..m-1. Lines marked (context) are outside the
area: never change them. "" / [] / -1 mean keep.
all = settings for every line of the area; lines[] = per-line exceptions (they win over all); cuts[] = one cut.
Use only keys from the lists, or "mat:<name>" for a material you create in materials[].
speed: speed of the words' motion. 1 = as now, 0.5 = half speed (slow motion), 2 = twice as fast.
Speed curves (arriveCurve, departCurve, flow, lensCurve, camera.curve, rigCurve): name = a curve preset or ease from the
list, or "ramp" with ends (both|start|end), edge (0-0.4: how long the slow part lasts, share of the move) and peak (how
many times faster the fast part is, 0.125-8). "最初と最後は一瞬遅く、途中はすごく速い" = {name:"ramp", ends:"both",
edge:0.1, peak:6}; "最初だけためて一気に" = ramp start. Prefer a preset when one fits.
camera: shot = a shot preset, "none" (no camerawork) or "custom" (then move, focus, timing and fill describe it; moving
while the words animate = timing "arrive"; fill = how much of the frame the focus fills, 0.3 wide ... 1.1 very close).
closer multiplies how close every shot is (0.5-2). follow = how much the camera leans toward moving letters (0-1).
rig (in all only) = a slow camera move over the whole area.
Season feel: set season for the area and use parts marked {season} of that season (atmos = particles over the background,
ornaments = marks near the words, ground = background), or make a material. work.season changes the whole video: set it
only when the brief is the whole video.
"ゆっくり / slow here": speed < 1, calm curves (softEnds, fadeBrake, or ramp with a low peak), a calm shot (settle,
wideHold, driftOff) and calm holds.
Materials: only when no listed part fits. They are data built from the primitives below, never code. Prefer a variant
(base = an existing part of the same kind with other values). A material is used only where "use" or "mat:<name>" puts it.
Never change the words of the lyrics. Locked lines keep their look.
If a brief is unclear or impossible, set understood=false for it and ask in "question".
Write "summary" (one sentence) and "question" in <Japanese|English>.
```

The camera-mode system prompt keeps the numbering, camera, curve, rig, locked-line and understood paragraphs, plus:
「Choose camerawork that serves the lyrics: push to emphasized words, read along long lines, snap on impact lines (!),
calm shots in quiet parts, and use the song's highlights if given.」

### 5.4 Answer schema (FROZEN; portable)

Every object is closed, every property is required, and there are no numeric or string limits (D§4.22.4). The existing
`ai_providers.test.js` portability check covers both schemas.

```js
const STR = { type: 'string' }, NUM = { type: 'number' }, INT = { type: 'integer' }, BOOL = { type: 'boolean' };
const STRS = { type: 'array', items: STR }, INTS = { type: 'array', items: INT };
const closed = (props) => ({ type: 'object', additionalProperties: false, required: Object.keys(props), properties: props });
const arr = (items) => ({ type: 'array', items });
const en = (list) => ({ type: 'string', enum: list });

const CURVE_AI  = closed({ name: STR, ends: en(['both', 'start', 'end']), edge: NUM, peak: NUM });
      // name: '' keep | 'ramp' | a curve preset | an ease name
const CAMERA_AI = closed({ shot: STR, move: en(SHOT.MOVES), focus: en(SHOT.FOCI), timing: en(SHOT.TIMINGS),
                           fill: NUM, closer: NUM, follow: NUM, curve: CURVE_AI });
      // shot: '' keep | 'none' | a shot preset | 'custom' (move/focus/timing/fill); fill/closer/follow: −1 keep
const SEASON_AI = en(['', 'any', 'none', 'spring', 'summer', 'autumn', 'winter']);
const EDIT_PROPS = {
  arrange: STR, arrive: STR, dwell: STR, depart: STR, lens: STR, ground: STR, atmos: STR,   // key | 'mat:<name>' | '' keep
  ornaments: STRS, filters: STRS,             // keys / 'mat:<name>'; ['none'] = no decorations / effects; [] keep
  avoid: STRS,                                // 'kind.key' refs to add
  season: SEASON_AI, speed: NUM,              // speed: motion.speed, −1 keep
  arriveCurve: CURVE_AI, departCurve: CURVE_AI, flow: CURVE_AI, lensCurve: CURVE_AI,
  camera: CAMERA_AI,
  impact: en(['keep', 'on', 'off']), emphasis: STRS,
};
const AREA_EDIT = closed(Object.assign({ rig: STR, rigCurve: CURVE_AI }, EDIT_PROPS));   // rig: '' keep | 'none' | preset
const LINE_EDIT = closed(Object.assign({ i: INT }, EDIT_PROPS));
const CUT_EDIT  = closed({ i: INT, j: INT, arrange: STR, arrive: STR, depart: STR, lens: STR, ornaments: STRS,
                           speed: NUM, camera: CAMERA_AI });
const WORK_EDIT = closed({ theme: STR, mood: STR, season: SEASON_AI,
  amounts: closed(Object.fromEntries(['motion', 'glitch', 'chroma', 'ornament', 'density', 'texture', 'groundSwitch',
                                      'camera'].map((k) => [k, NUM]))),            // −1 keep
  flash: en(['keep', 'on', 'off']), palette: LOOKS.PALETTE_SCHEMA });
const ANSWER = closed({ s: INT, understood: BOOL, summary: STR, question: STR,
  all: AREA_EDIT, lines: arr(LINE_EDIT), cuts: arr(CUT_EDIT), work: WORK_EDIT });

DIRECT_SCHEMA(allowMaterials) = closed(allowMaterials
  ? { answers: arr(ANSWER), materials: arr(RECIPE_AI.AI_MATERIAL) }     // §5.10
  : { answers: arr(ANSWER) });
DIRECT_CAMERA_SCHEMA = closed({ answers: arr(closed({ s: INT, understood: BOOL, summary: STR, question: STR,
  all: closed({ rig: STR, rigCurve: CURVE_AI, camera: CAMERA_AI }),
  lines: arr(closed({ i: INT, camera: CAMERA_AI })),
  cuts: arr(closed({ i: INT, j: INT, camera: CAMERA_AI })) })) });
```

- Schemas are built once per `(mode, allowMaterials)` and deep-frozen.
- Object nesting depth is ≤ 5: `answers → all → camera → curve`, and `materials → layers`.

### 5.5 Validation → changes (`directChanges`)

`directChanges` is written like `looks.lookChanges` and reuses its helpers (`LOOKS.helpers`).

**Resolving each answer `s`:**
- `sent.briefs[s]` gives the ref. `area = AREAS.resolve(doc, plan, ref)`.
- A missing area gives `ai.warn.areaGone` and no changes for that brief.
- Local `i` → `sent.briefs[s].lines[i].lineId`, through `CH.lineResolver` semantics. A text that changed since the request
  gives `ai.warn.changedSince`.
- `i` outside the brief gives `ai.warn.notInArea`.
- `understood: false` → no changes for that brief. Its question is shown in the review header of that area.

**Target of `all`:**
- **work** area → `work:<slot>` pins (one change each).
- Any other area → one change per area line: `line/<id>:<slot>`, all sharing `agg = '<areaKey>|<slot>'`.
- `lines[i]` wins over `all` for that line: the `all` change for that line and slot is not made.

**Mapping** (every pin is `by: 'ai'`):

| Answer field | Slot / command | Change kind | Notes |
|---|---|---|---|
| `arrange arrive dwell depart lens` | `<kind>` | `part` | key: registry `has` + `servesLyrics` + filters (as today). `mat:<name>` → material placeholder (§5.11). |
| `ground`, `atmos` | `ground`, `atmos` | `part` | atmos: a run-scope ornament or `none` |
| `ornaments[]` | `ornament#<idx>` | `part` | `idx` = the lowest index not pinned `by: user/lock` on that line or its cuts, else `ai.warn.noSlot`. `['none']` → `ornament.count` 0 (`value`). |
| `filters[]` | `filter#<idx>` | `part` | same index rule. A filter skipped by the backdrop mode (D§4.19.4) gives `ai.warn.backdrop`. |
| `avoid[]` | `avoid` = union(existing line pin, valid new refs) | `value` | |
| `season` | `season` | `value` | area ≠ work: a line pin; work: the existing `season` kind |
| `speed` | `motion.speed` | `value` | clamp 0.25–4, step 0.05; dropped when `|to − from| < 0.02` |
| `arriveCurve`, `departCurve`, `flow`, `lensCurve` | `arrive.ease`, `depart.ease`, `arrive.flow`, `lens.curve` | `value` | `curveFromAi`; `''` keep; invalid → `ai.warn.badCurve` |
| `camera` | `cam.shot`, `cam.zoom` (`closer`, 0.5–2), `cam.follow` (0–1), `cam.curve` | `value` ×≤4 | `cameraFromAi`; invalid → `ai.warn.badShot` |
| `rig`, `rigCurve` (all only) | `rig`, `rig.curve` on every area line | `value` | this also splits the rig run at the area edges |
| `impact`, `emphasis` | `lyrics.row` | `impact`, `emphasis` | existing `lyricChanges` (words never change) |
| `cuts[k]` | `cut/<key>:<slot>` with `sig = pinSig(plan, key)` | `part` / `value` | `key` = `sent…cuts[j].key`; the cut must still exist with the same text |
| `work.*` | existing work kinds | existing | area = work: checked; otherwise group `outside`, `checked: false` |
| `materials[k]` | `material.put` | `material` | §5.10–§5.11 |

**Common rules** (unchanged from v2):
- A locked line keeps its look (`ai.warn.locked`).
- A line whose every cut pins that slot is skipped (`ai.warn.pinned`).
- Unknown keys and roles that are not served are dropped with the existing warnings.
- **Season gate:** a seasonal pick is allowed when its season equals the season in effect for the line after the answer.
  That is the answer's `season` for the area, else an existing line pin, else the work season. Otherwise the pick is
  dropped with `ai.warn.lineOffSeason`.
- A change that equals the current value is not made.

**Area guarantee:**
- Every produced change except `material` and `outside`-group changes is checked with `AREAS.inArea(area, path)`.
  Anything else is dropped with `ai.warn.outside`. This is a defense against programming errors; local numbering already
  makes it impossible for the AI.
- `toCommands(…, { resolveArea })` repeats the check at apply time against the area resolved **now**.

### 5.6 Changes, review, stale, apply, log, revert (`ai/changes`; D§4.22.5 additions)

**Change fields (additive):**

```js
Change += { kind: 'value' | 'material' | …existing, group: 'materials'|'area'|'cuts'|'lyrics'|'outside'|'work'|'lines'|'time',
            areaKey?, agg?, requires?: [changeId], staleWhy: null | 'changed' | 'left' | 'gone' | 'material',
            field?: stringKey /* value changes: 'fld.camShot' … */, cutKey?, cutSig?, matName?, entry? /* material */ }
KINDS  += ['value', 'material']
GROUPS += { materials: ['material'], area: ['part', 'value'] /* when areaKey */, cuts: [] /* by cutKey */, outside: [] }
```

**Snapshots:**
- `value`: `{ value: pinValue(doc, path) }`.
- `material`: `{ value: materialHash(entry with that id) | null }`. A new material has base `null`, so it is stale when an
  entry with the assigned id exists by then.
- Cut changes also require that `cutKey` exists with text `cutSig`, else `staleWhy: 'gone'`.

**`markStale(doc, plan, changes, { resolveArea } = {})`** (the new optional arg keeps existing callers working):
- A changed value gives `'changed'`.
- When `resolveArea` is given and `c.lineId` is no longer in the resolved area, the change gets `'left'`. If the area no
  longer exists, every row of it is stale.

**`toCommands(doc, plan, changes, { resolveArea } = {})`**, in this order:
1. **`material.put`.** New ids are assigned here: `'m' + (doc.materials.next + k).toString(36)` in list order, so try-on
   and apply agree. `'mat:<name>'` placeholders in dependent changes become `'myMat' + id.slice(1)`. A dependent change
   whose `requires` material is unchecked is dropped.
2. Work pins, palette, filters (existing).
3. `season`, `avoid`.
4. Part pins.
5. Value pins.
6. Time, lyrics, rows, songInfo (existing).

Then `dropNoops`. The whole review is **one** `store.batch({ label: ['undo.aiArea', { area, n }] }, cmds)`, or
`['undo.ai', …]` for a work target: one undo step that covers materials and pins together.

**`logEntry`:**
- It records `{ material: id, to: hash, prev: entry | null }` per `material.put`.
- The entry carries `areas: [{ key, label }]` and `instructions: [text]`, capped at 300 characters.

**`revertCommands`:**
- A material item emits `material.put prev`, or `material.remove` when `prev` is null, but only while the current hash
  equals `to`.
- Pins revert first (reverse order).
- A material that non-AI pins now reference is **kept** and counted in `kept`.

**`CH.apply`** (try-on) reduces the same commands, `material.put` included. The stage's alternate engine composes the
registry from the tried document (§3.10).

### 5.7 Materials: entry and recipe format (FROZEN, `rv: 1`)

#### 5.7.1 Entry

```json
{ "id": "m3", "kind": "ornament", "by": "ai", "name": { "ja": "桜吹雪", "en": "Cherry flurry" },
  "blurb": { "ja": "…", "en": "…" }, "tags": ["organic", "soft"], "season": "spring", "pool": false, "rv": 1,
  "recipe": { … } }
```

- Registry key: `'myMat' + id.slice(1)`.
- `name.en` and `blurb` fall back to `name.ja` at derive time, so the registry label rules hold.
- Tags come from the D§4.18.1 vocabulary. `season` is null or a season.
- `pool` defaults to false for `by: 'ai'`, true for `by: 'user'`.

#### 5.7.2 Variant (any MAT_KIND; the only form for `arrange` and `seam`)

```json
{ "base": "inkRise", "params": { "yFrom": 1.2 }, "shared": { "dur": { "value": 1.1 }, "ease": { "value": "softEnds" } } }
```

- `base` is a **base-registry** key of the same kind. It is never a material, so materials cannot recurse.
- The base def may not have `gate: 'flash'`.
- `params` values are coerced through the base's own ParamSpecs and become autos `{ value }`.
- `shared` takes `{ value }` autos, coerced through the shared specs.
- This is `K.variant` semantics.

#### 5.7.3 Composite recipes

`parts: [{ key, params }]` entries are **existing base parts** of the same kind (`params` coerced through their specs). They
are how the AI "uses parts to build new materials".

| Kind | Fields (all required after normalize; defaults in brackets) | At least |
|---|---|---|
| `ornament` | `scope` cut/run [cut] · `follow` text/own [text] · `seed` int · `layers` [≤ 6] · `parts` [≤ 2; ornaments of the same scope] · `knobs` [] | one layer or part |
| `ground` | `seed` · `layers` [≤ 4] · `parts` [≤ 1 ground part, drawn first] · `knobs` | a part, or a first layer with prim `fill` |
| `arrive`, `depart` | `motion` { `unit` glyph/word/line [glyph] · `tracks` [≤ 8] · `curve` Curve [expoOut or quadIn] · `colCurve` { col: Curve } · `dur` [lo, hi] · `each` [lo, hi] · `order` [ORDERS…] } or null · `parts` [≤ 2] · `mirrorOf` id (depart only) | motion, parts or mirrorOf |
| `dwell` | `osc` [≤ 4; cols `x y rot sx alpha glow tint`] · `parts` [≤ 2] · `knobs` | one osc or part |
| `lens` | `osc` [≤ 4; cols `x y roll zoom`] · `parts` [≤ 2 lens parts, at most one with `frames: true`] · `knobs` | one osc or part |
| `filter` | `parts` [1–2 filters; `gate: 'flash'` refused] · `mix` [1 per part, 0..1] | one part |

**Motion rules:**
- Arrive tracks must **end** at identity. Depart tracks must **start** there.
- `dur`/`each`/`order` become the material's shared autos (`range`/`pick`); `curve` becomes its `ease` auto.
- `mirrorOf` (depart) is an id of an arrive material, mirrored through `K.mirror`. It must precede this entry in `list`.

#### 5.7.4 Layers (ornament and ground)

```json
{ "prim": "particles", "shape": "petal", "glyph": "", "inks": ["#F4B4C6", "accent"], "alpha": 0.85, "layer": "near",
  "place": { "anchor": "frame", "x": 0, "y": 0, "spread": 1.15 },
  "size": [0.012, 0.022], "count": 90, "stroke": 0, "rot": [0, 360],
  "field": { "dir": 115, "speed": 0.09, "sway": 26, "swayHz": 0.35, "spin": 60, "life": [0, 0], "burst": "none" },
  "move": [ { "what": "scale", "wave": "beat", "amp": 0.15, "hz": 0, "phase": "rnd", "curve": null } ],
  "appear": { "at": "start", "draw": "fade", "dur": 0.6 },
  "style": "", "pattern": "", "gap": 0, "fill": null }
```

**Primitives** (all geometry is ours; FROZEN lists):

| prim | Builds | Static cost (ms @720p) |
|---|---|---|
| `shape` | `sb.shape` × count (≤ 24) from `SHAPE_LIB` | 0.01 / item |
| `particles` | one `sb.particles` with a closed-form field; sprite from `SHAPE_LIB` | 0.004 / particle |
| `lines` | particles with the `bar` sprite along `dir` (rain, speed lines, rays) | 0.005 / particle |
| `frame` | shapes around `hints.focus`: `style` box / brackets / ticks / underline / ring | 0.02 |
| `fill` | `sb.paint` linear or radial gradient, `fill: { type, angle, stops: [[ink, pos] ≤ 4] }`; layer `ground` or `far` only | 0.25 |
| `pattern` | `sb.paint` of repeated shapes: `pattern` dots / stripes / grid / checks / waves, `gap ≥ 0.02` short side | 0.30 |
| `glyphs` | particles with sprite `glyph:<char>`; char from `GLYPHS` | 0.006 / particle |
| `part` | — (use `parts`, not a layer) | 0.35 each (`PART_COST`) |

**Vocabularies:**

| List | Values |
|---|---|
| `SHAPES` | rect roundRect ellipse ring star petal leaf flake drop heart diamond triangle cross dot bar arc wave spark |
| `GLYPHS` | ♪ ♫ ★ ☆ ♡ ❄ ✿ ❀ ☀ ☂ ☁ ✦ ✧ 〇 △ □ ◇ |
| `ANCHORS` | frame (whole frame + 15 % bleed), focus, around, under, behind (far layer, centred on focus), corners, edges, free (`hints.free`) |
| `LAYERS` | ornament: far mid near; ground: ground far |
| inks | palette tokens, `#RRGGBB`, or `slot` (the ornament slot's shared `ink`); ≤ 4 |
| `WAVES` | sine tri saw noise beat ramp |
| `MOVE_WHAT` | x y rot scale alpha |
| `PHASES` | same index rnd |
| `APPEAR_AT` | start arrive rest beat impact |
| `DRAWS` | fade grow wipe none |
| `BURSTS` | none beat impact arrive |

**Movers** are closed-form in `t`: `value = amp · wave(hz·t + φ)`.
- `noise` = `noise1(seed, …)`.
- `beat` = exponential decay since the last beat (`env.grid`; 0.5 s pulses without a BPM).
- `ramp` = amp per second, optionally shaped by a `curve` over the window.

**Shared params inside the interpreter:**
- ornament `amount` → layer alpha × (0.4 + 0.6·amount); `ink` → `slot` inks;
- ground `amount` → non-fill layer alpha × (0.5 + amount);
- lens `amount` → osc amp × (0.5 + amount); lens `curve` → the kit wrapper;
- dwell `amount` → osc amp × 2·amount; dwell `speed` → time scale;
- filter `amount` → each part's `amount` × `mix`, clamped to 1.

#### 5.7.5 Oscillators (dwell, lens)

`{ "col": "y", "amp": 0.06, "hz": 0.5, "wave": "sine", "phase": "index", "step": 0.6 }`

| Kind | Columns | Amp unit and limit |
|---|---|---|
| dwell | x, y | em, ≤ 0.6 |
| dwell | rot | deg, ≤ 30 |
| dwell | sx | ×, ≤ 0.3 |
| dwell | alpha, glow, tint | ≤ 1 |
| lens | x, y | du, ≤ 40 |
| lens | roll | deg, ≤ 4 |
| lens | zoom | ×, ≤ 0.08 |

- `hz ≤ 4`. `phase ∈ same / index / word / rnd` (lens: same). `step` is the per-unit phase offset.
- Dwell oscillators multiply by the dwell envelope (D§4.17.4).

#### 5.7.6 Knobs

`knobs: [{ "what": "count" | "size" | "speed" | "alpha" | "amp", "label"?: { ja, en } }]`, ≤ 4 (AI) and ≤ 6 (user).

- The kind's shared param names are excluded: dwell cannot have a `speed` knob.
- Each knob becomes a part param named `what`:
  `{ type: 'num', min: 0, max: KMAX, step: 0.05, unit: 'x', auto: { value: 1 }, label: label or mat.knob.<what> }`.
  `KMAX` is 1.5 for count and 2 otherwise.
- A knob multiplies that field in every layer, track or osc: count → `count`; size → `size`; speed → `field.speed` and
  mover `hz`; alpha → `alpha`; amp → mover, osc and track amplitudes.

### 5.8 Limits, cost and the flash rule (`core/recipe.LIMITS`, hard)

A failing layer, track, osc or part is dropped with a problem. A recipe left empty is invalid.

| What | Limit |
|---|---|
| layers | ornament ≤ 6, ground ≤ 4 |
| shapes | ≤ 24 per layer, ≤ 48 nodes per recipe |
| particles (all layers, knobs at max) | ≤ 240 |
| tracks / osc / parts / knobs | ≤ 8 / ≤ 4 / ≤ 2 / ≤ 4 (AI) or ≤ 6 (user) |
| size | 0.002–1.2 × short side; particle size ≥ 2 du |
| speed | ≤ 1.5 short sides/s; spin ≤ 720 °/s; swayHz ≤ 2; mover hz ≤ 4 |
| motion tracks | x y z ±10 em (z ≥ −1400 du); rot kx ky rx ry ±720°; blur ≤ 0.6 em; sx sy 0–8; others 0–1 |
| filter stack | Σ inner `cost` ≤ 6 (the derived `cost` = min(5, Σ)); Σ `passes` ≤ 6 |
| static cost (`cost().ms`, knobs at max) | ornament cut ≤ 1.2 ms, run ≤ 1.5 ms, ground ≤ 2.0 ms |
| strings | name ≤ 24, blurb ≤ 80, glyphs from `GLYPHS`, no control characters |
| sizes | canonical recipe ≤ 6 KB; `doc.materials` ≤ 64 entries and ≤ 160 KB |

**Flash rule** (WCAG-style, by construction):
- `cover` is a layer's estimated screen share: count × mean area / frame area, and 1 for `fill`/`pattern`.
- A layer with `cover > 0.25` whose alpha is modulated must have `hz ≤ 3` and `amp ≤ 0.35`. Modulation means a `move`
  with `what: alpha`, or `appear.at ∈ beat, impact` with `dur < 0.15`.
- `wave: 'beat'` on alpha is refused for such layers.
- Filter stacks and seam variants refuse `gate: 'flash'` parts.

Therefore no material produces a full-frame flash, and `export/schedule` needs no change.

### 5.9 Registration as parts

#### 5.9.1 `derive(entry, base)`

- **Variant:** `K.variant(base.get(kind, recipe.base), { key, label, blurb, tags, season, pool, family: 'mine', params,
  shared })`.
- **Composite:** `K.<kind>({ key, label, blurb, tags, season, pool, family: 'mine', weight: 1, scope, follow, needs,
  traits, params: knobSpecs(kind, R), build | make | apply })`, where:
  - `R` is the normalized recipe, bound in **one closure per material version**, created at derive time and never per
    build (the `K.mirror` precedent);
  - every `run`/`draw` it installs is a module-level function of `parts/mix` (`runMover`, `runOsc`, `runLensOsc`,
    `drawFill`, `drawPattern`, …) reading only behaviour fields;
  - `needs` is the union of the inner parts' needs, plus `beats` for beat movers;
  - arrive/depart motion goes through `K.moves`; `mirrorOf` goes through `K.mirror`;
  - filters bind the inner defs' `apply` at derive: `stage` = the first inner stage, `cost` = min(5, Σ), `passes` = Σ,
    `alphaSafe` = all.
- Every derived def gets `mine: { id, rhash, cost, by }`.

#### 5.9.2 `registryFor(base, materials)`

- `materials` absent or `list` empty → `base` itself. Projects without materials see nothing new: same identity, same
  plan hash.
- Otherwise it derives every entry in list order and returns `REG.extend(base, defs)`. Problems of skipped entries go into
  `registry.problems`, which the planner turns into `material-bad` warnings.
- Memo: `WeakMap<base, [{ materials, registry }] (last 4)>`. `doc.materials` keeps its identity through structural
  sharing, so a plan recompose costs one lookup.

#### 5.9.3 Fingerprints and caches (planner)

- `sharedText` uses `baseVersion`, so adding a material does not rebuild other scenes.
- `matTerms` puts each used material's `rhash` into its cuts' `fp` and `encodingKey`, and into `groundFp`.
- A body-only edit (knob default, layer tweak) keeps `version` but changes `rhash`: only the cuts using that material
  rebuild, and the cast cache stays warm (§3.9).
- A meta edit changes `version`: one cold re-cast (≈ 25–30 ms, NOTES INT-PLAN).

#### 5.9.4 Particle budget in scenes (`build.js`)

`env.mixShare` limits particles when several materials meet in one scene:
- cut scenes: `min(1, 400 / Σ mine.cost.particles of the chosen material defs in this scene)`;
- ground scenes: the same with 300.

Interpreters multiply particle counts by it. It is a function of the chosen defs, which `matTerms` covers, so it is
deterministic. The D§7.4 draw budget of ≤ 400 particles holds even with three material ornaments.

### 5.10 AI materials

**AI schema** (flat, closed, all required: portable):

```js
const AI_PARAM = closed({ name: STR, value: STR });
const AI_PART  = closed({ key: STR, params: arr(AI_PARAM) });
const AI_LAYER = closed({ prim: en(PRIMS), shape: en(['', ...SHAPES]), glyph: STR, inks: STRS, alpha: NUM,
  layer: en(['far', 'mid', 'near', 'ground']), anchor: en(ANCHORS), x: NUM, y: NUM, spread: NUM, sizeMin: NUM, sizeMax: NUM,
  count: INT, stroke: NUM, dir: NUM, speed: NUM, sway: NUM, swayHz: NUM, spin: NUM, burst: en(BURSTS),
  move: en(['none', ...WAVES]), moveWhat: en(MOVE_WHAT), moveAmp: NUM, moveHz: NUM,
  appear: en(['always', ...APPEAR_AT]), draw: en(DRAWS), style: en(['', ...FRAME_STYLES]), pattern: en(['', ...PATTERNS]),
  stops: STRS /* "ink@0" "#F7E3EA@1" */, angle: NUM });
const AI_TRACK = closed({ col: en(MOTION_COLS), from: NUM, to: NUM });
const AI_OSC   = closed({ col: en([...new Set([...OSC_COLS_DWELL, ...OSC_COLS_LENS])]), amp: NUM, hz: NUM,
                          wave: en(['sine', 'tri', 'noise', 'beat']), phase: en(PHASES.concat(['word'])) });
const AI_MATERIAL = closed({ name: STR, nameEn: STR, kind: en(MAT_KINDS), scope: en(['cut', 'run']), season: SEASON_AI,
  tags: STRS, blurb: STR, base: STR, params: arr(AI_PARAM), parts: arr(AI_PART), layers: arr(AI_LAYER),
  unit: en(['glyph', 'word', 'line']), order: en(ORDERS), dur: NUM, each: NUM, tracks: arr(AI_TRACK), curve: CURVE_AI,
  osc: arr(AI_OSC), knobs: STRS,
  use: closed({ slot: en(['none', 'atmos', 'ornament', 'ground', 'arrange', 'arrive', 'depart', 'dwell', 'lens', 'filter',
                               'seam']), s: INT /* brief; −1 = every brief */, lines: INTS /* [] = all area lines */,
                cuts: arr(closed({ i: INT, j: INT })) }) });
MATERIAL_SCHEMA = closed({ understood: BOOL, question: STR, material: AI_MATERIAL });   // the standalone tool
```

**`fromAi(ai, registry)` → `{ entry: MaterialEntry-without-id | null, warnings }`:**
1. Fill enum defaults and clamp numbers.
2. Parse `"ink@pos"` stops.
3. Convert param strings to numbers or booleans through the target specs.
4. Map `knobs` words to knob entries.
5. `base` set → variant; otherwise a composite. An empty `name` becomes `mat.untitled`.
6. Run `core/recipe.normalize`, then `cost`:
   - over the cost budget → counts scaled down deterministically (×0.9 steps; `ai.warn.matScaled`);
   - a flash-rule failure → `hz`/`amp` reduced to the limits (`ai.warn.matFlash`);
   - an empty result → `null` (`ai.warn.matEmpty`).

**`toAi(entry)`** returns the same flat form, used by 「AIで作り直す」.

**`recipeText()`** (≤ 2,000 characters; generated from `core/recipe` constants and asserted) explains:
- variant vs composite;
- `parts`;
- each prim with its fields;
- the vocabularies;
- limits in words;
- knobs;
- `use`;
- `mat:<name>`.

**The standalone tool `material`** (part browser › マイ素材 › ＋ AIで作る, and the material page › AIで作り直す):
- `materialRequest(doc, plan, registry, { description, kind, uiLang, current? })` → `{ system, prompt, schema:
  MATERIAL_SCHEMA, effort: 'medium' }`.
- `materialChanges(…, { rev, useAt?: { scope, slot } })` → a `material` change plus, with `useAt`, one dependent pin at
  that scope (the tile form's 「作ったら選択中の…に使う」).

### 5.11 Fitting a material into place

A new material produces a `material` change (group 素材) plus dependent pin changes with `requires: [materialChangeId]`:

| Material kind / scope | Pinned as (per target line L of `use.lines`, or every area line; `use.s = −1` → every brief's area) |
|---|---|
| ornament, scope `run` | `line/<L>:atmos`, so the segment splits and the area gets its own atmosphere (§4.9) |
| ornament, scope `cut` | `line/<L>:ornament#<first free idx>` |
| ground | `line/<L>:ground` |
| arrange, arrive, depart, dwell, lens | `line/<L>:<kind>` |
| filter | `line/<L>:filter#<first free idx>` |
| seam | `cut/<first cut of L>:seam` (the transition into the line) |
| `use.cuts [{i, j}]` | the same at `cut/<key>` with `sig` |
| referenced as `mat:<name>` in all/lines/cuts | the pin that field produces (`use.slot: 'none'`) |
| season ≠ the line's season in effect | plus a `season` value change for those lines, unless the answer set one, so no `pin-off-season` |

- Area `work` → `work:` pins.
- Manual fitting uses the normal inspector: a マイ素材 tile click pins at the page's scope. For a multi-line selection that
  is one batch.

### 5.12 No AI code, ever (restated)

The flow of an AI answer:
1. It is JSON, parsed by the provider adapter.
2. Closed schemas check it.
3. `ai/direct` / `ai/recipe` validators run.
4. `core/*` `coerce` / `normalize` run.
5. `REG.extend` checks the defs.

Guarantees:
- Geometry comes only from `SHAPE_LIB`.
- Text is only allow-listed glyphs, plus names shown with `textContent`.
- Movers are fixed wave names with numbers.
- The D§2.4 lint (`eval(`, `new Function`, `.innerHTML`) and the CSP are unchanged, and `csp.py` runs the new flows.

---

## 6. UI

### 6.1 Top level: unchanged

- The header (6 controls), play bar (≤ 8) and steps (each ≤ 5) are exactly D§6.4.1–6.4.3.
- Step ③ still says 「おまかせで雰囲気・配色・動きがまとめて変わります。」
- Automatic camerawork is part of おまかせ. Its master control is the existing 作品全体 › 強さ › カメラ, relabelled
  カメラワーク.
- Every new control is one level deeper or more. The budget tests (`ui_layout.py`) must pass unchanged.

### 6.2 AI panel: the instruction block (`ui/ai_panel` `toolsBlock`; replaces ひとこと修正)

```
┌ 指示 ─────────────────────────────────────────┐
│ 対象 [全体|選択中|区画▾]                        │  segmented; 区画▾ opens the area list below
│ ◆ サビ1 · 0:41–1:02 · 5行                  ×  │  target chip (hover = highlight lines and band; × = back to 全体)
│ ┌───────────────────────────────────────────┐ │
│ │ 例: ここは季節感を足して、動きはゆっくり    │ │  300 chars, Enter sends, Shift+Enter = new line
│ └───────────────────────────────────────────┘ │
│ [季節感][ゆっくり][緩急][カメラで寄る][素材を作る] │  chips insert a localized phrase (素材を作る also ticks the option)
│ ▸ 詳しく  ☑ 新しい素材を作ってもよい            │  folded by default
│ [カメラワークをAIに任せる]    12/300 [送る]     │  camera mode; send
│ 区画ごとに頼む…                                │  link → board sub-page (§6.3)
└───────────────────────────────────────────────┘
```

- The block has at most 5 visible controls when folded: target, text, chips row, send, camera button.
- **区画▾ list** (from `areasOf`; empty groups hidden):
  ```
  曲の区画（AI分析）
    イントロ      0:00–0:12   —
    Aメロ1        0:12–0:41   6行
    サビ1         0:41–1:02   5行   ← current
    サビ（すべて） 3か所       15行
  歌詞の見出し（#）
    # サビ          5行
  まとまり（空行ごと）
    1  1–4行    2  5–8行 …
  ─────────
  選択中のカット   14行 カット2
  ```
- Without a song analysis, a muted line says 「曲を分析すると区画が増えます」 and links to 曲を使う.
- The inspector's [この行をAIに頼む…], [この区画をAIに頼む…] (multi-line and area page) and [このカットをAIに頼む…] (cut
  page) set `app.aiTarget = { ref }`. `focusTool('direct')` preselects the target and focuses the text.
- A question from the AI is shown inline under the box, per area.

### 6.3 Board (`ui/ai_board`, sub-page of the AI tab)

```
 ‹ 戻る   区画ごとに指示
 ┌ サビ1 · 12–16行 ──────────────── 未送信 ┐
 │ [季節感を足して、カメラはゆっくり寄る   ] │   one-line inputs, ≤ 120 chars; drafts in side.asks
 ├ Aメロ1 · 1–6行 ─────────────── 反映済み ┤
 │ [動きをスローに                         ] │
 └──────────────────────────────────────────┘
 [+ 選択中の行を区画にする]   ☑ 新しい素材を作ってもよい   [まとめて送る]
```

- Rows come from `areasOf` (song areas, else heads, else paras) plus added `lines` areas.
- One request carries up to 8 non-empty rows. A 9th disables send with `ai.board.max`.
- A row is marked 反映済み when its area key was in the last applied review.

### 6.4 Review (`ui/ai_review`)

```
サビ1（5行）への提案 — 「桜が舞う中、ゆっくり文字へ寄る」
▾ 素材 1
  ☑ 新しい素材「桜吹雪」 装飾・空気 · 春 · 重さ ■■□□□          [▶ 見る]
▾ 区画 サビ1 · 5行
  ☑ 空気: 自動 → 桜吹雪（マイ素材）                        5行 ▸   ← requires 素材: disabled while it is unchecked
  ☑ この行の季節: 作品の季節（冬） → 春                    5行 ▸
  ☑ 動きの速さ: 100% → 50%（窓に合わせて最大 0.95 秒）      5行 ▸
  ☑ 緩急（入り）: 自動 → 最初と最後ゆっくり・中は6倍         5行 ▸
  ☑ カメラワーク: 自動（寄って落ち着く）→ 言葉へ寄る         5行 ▸
▾ カット
  ☑ 14行 カット2 · カメラワーク: カスタム（キー3個）
▾ 区画の外（作品全体）                 ← unchecked by default; help: 「区画の外も変わります」
  ☐ 季節: 冬 → 春
▸ 使えなかった提案 2件
入力 4,210 / 出力 1,020 トークン · 約 $0.004
[試写] [捨てる] [選んだ 9 件を反映]
```

- **Aggregate rows** (`agg`) are tri-state checkboxes over their per-line rows. ▸ expands them to 「12行: 自動 → 桜吹雪」.
- **Dependencies:** unchecking a material unchecks and disables its dependents, labelled `ai.needsMaterial`. Re-checking
  the material re-enables them, but they stay unchecked.
- **Stale rows** are unchecked and badged with the reason: `ai.stale`, `ai.stale.left`, `ai.stale.gone` or
  `ai.stale.material`.
- **Hover** on a row highlights its lines, band or cut. [▶ 見る] plays the material thumbnail inline.
- **Try-on and apply** follow D§6.4.10. While the review is open, 詳細 stays disabled.

### 6.5 Inspector placements (`ui/fields` PAGES)

**要素 › カメラ (`el.lens`)**, at work, line and cut scope:

```
全体 › 12行 › カット2 › カメラ
▾ カメラワーク                                             (sec.camwork, open)
  カメラワーク [自動]                              [d]
  [▶ 64×36] 言葉へ寄る                              ›     ← shot widget → shot browser page (tiles, hover = try-on)
  なぜ: 強調があるので言葉へ寄る
  寄り具合    ─────●──────  108 %                          cam.zoom (number, ×100)
  緩急        [一瞬ゆっくり→すごく速く→一瞬… v]              cam.curve (curve widget, §6.6)
  文字を追う  ──●──────── 22 %                    (詳細)  cam.follow (advanced)
  [キーフレームを編集…]                                     → keyframe sub-page (§6.7)
▾ 揺れ・質感                                               (sec.camtexture)
  動き [▶] 手持ち ›   強さ ──●── 45   動きの緩急 [一定 v] (advanced)
▸ 区画のカメラ（サビ1 · 12–16行）                           (sec.rig; the note names the rig run)
  区画のカメラ [じわじわ寄る v]   緩急 [だんだん速く v]
```

**Other pages:**

| Page | Rows added (`basic` unless noted) |
|---|---|
| 行 › 演出 (`direction`) | after 入り: 長さ, **緩急** (`arrive.ease`, curve widget; was なめらかさ); after 抜け: **緩急** (`depart.ease`); new **動きの速さ** (`motion.speed`, number ×100 %, 25–400); new **カメラワーク** (`cam.shot`); advanced: 出方の緩急 (`arrive.flow`), この行の季節 (`season`, choice 自動/すべて/なし/春/夏/秋/冬), この行で使わない部品 (`avoid`, partRefs widget) |
| 「n行を選択中」 (`lines`) | the same rows, written in one batch. When `sel.area` is set: the header reads the area label (「サビ1（5行）」), plus [この区画をAIに頼む…] and a 区画のカメラ section (`rig`, `rig.curve`). |
| カット › 動き | + 動きの速さ |
| カット › 要素 | the カメラ chip leads to `el.lens` |
| 要素 › 切り替え | + 緩急 (`seam.curve`, advanced) |
| 作品全体 › 強さ | `amount.camera` label → カメラワーク |
| 作品全体 › 要素の既定 › カメラ | the `el.lens` page at work scope |
| 作品全体 › マイ素材 (new, `sec.materials`) | collapsed by default; hidden when there are no materials (§6.9) |
| 行 › AI | the button label stays [この行をAIに頼む…]; it opens `direct` with the line |

**Widgets:**
- `shot`: thumbnail and name; opens a tile page of 自動 / 動かさない / 9 presets (part-browser tiles, try-on on hover or
  focus); a custom value shows 「カスタム（キー3個）」.
- `rig`: select 自動 / なし / 5 presets.
- `partRefs`: chips with × plus [+], which opens a kind chooser and then the part browser in pick mode.

### 6.6 Curve widget (`ui/curve_widget`, registered as `curve`)

```
緩急  [一瞬ゆっくり→すごく速く→一瞬ゆっくり          v]    select: 自動 · 7 presets · 一定 · eases · かんたん · カスタム
      ╭──────────────────────────────────────────╮
      │         position ╭────────               │   canvas: width = row − 24 px (≥ 240), height 80 CSS px
      │ ───────────────╯                          │   line = position f(u); filled area = speed (speedAt)
      │ ▁▂▇████████████▇▂▁  speed                │
      ╰──────────────────────────────────────────╯ [▶]
  かんたん:  ゆっくりにする所 [最初と最後|最初|最後]  ゆっくりの長さ ──●── 10%   速さの差 ────●─ ×6
  カスタム:  形 (●ベジェ ○速さの段)   — handles on the canvas
```

- **Forms:**
  - presets and eases: select only;
  - かんたん (`ramp`): three controls;
  - カスタム: Bézier (2 handles; y ∈ [−0.5, 1.5]) or speed steps (≤ 8 knots; drag vertically = speed, horizontally = time;
    double-click adds; Del removes, keeping ≥ 2).
- Dragging on a preset converts it to its data, which becomes custom.
- **Undo:** each pointerdown → pointerup is one `store.gesture` (one undo entry). Slider drags work the same way.
- **Keyboard:**
  - Handles are buttons with `aria-label` from `curve.point` / `curve.handle`.
  - ← → move time or x by 0.01; ↑ ↓ move speed or y by 0.01 (Shift ×10). Tab cycles. Enter adds a knot after the
    focused one. Delete removes it. Esc returns to the select.
  - Arrow keys are owned by the widget (the existing `ownsKey` rule).
- **[▶]** runs a dot along the curve once, and only when `prefers-reduced-motion` is not set.
- On time-warp fields (`flow`, `dwell.curve`, `seam.curve`), `snapSettle` and overshooting Béziers show 「位置の動きだけ」.
- It fits 288–352 px, and nothing covers the preview.

### 6.7 Keyframe editor (`ui/shot_editor`), stage overlay and timeline diamonds

```
全体 › 12行 › カット2 › カメラ › キーフレーム                   [‹ 戻る]
 ① とき [入り v]      ねらい [文字全体 v]   大きさ ──●── 60%   位置 [そのまま v]
 ② とき [歌い出し v]  ねらい [強調 v]       大きさ ───●─ 85%   位置 [右1/3 v]
    緩急 [一瞬ためて一気に v]   傾き [−2°]                        [×]
 ③ とき [終わり v]    ねらい [強調 v]       大きさ ────● 90%   位置 [右1/3 v]
 [+ キーを足す]  [プリセットに戻す]   ☑ プレビューに印を出す
```

**Choices:**

| Control | Options |
|---|---|
| とき | 入り / 入り終わり / 歌い出し / 真ん中 / 歌い終わり / 抜け始め / 終わり / 強調 / n語目 / n拍目 / 割合 |
| ねらい | 文字全体 / 強調 / 最初の語 / 最後の語 / n語目 / n行目 / n文字目 / 歌に合わせて / 画面全体 |
| 位置 | そのまま / 中央 / 左1/3 / 右1/3 / 上1/3 / 下1/3 / 自由; thirds = `ox/oy ±0.167` |
| 大きさ | `fill` 10–120 %, or `zoom` for 画面全体 |

**Editing:**
- Any edit writes the **whole Shot object** as a pin at the page's scope (it becomes custom), as one undo entry per
  gesture.
- プリセットに戻す clears the pin, so the value goes back to auto or the inherited value.
- 2–6 keys; [+] is disabled at 6.

**While the page is open:**
- `ui/stage` draws markers ①②③ on its overlay canvas where each key places its aim (from `engine.shotTrack`). Dragging a
  marker sets `ox`/`oy` (free), and the wheel sets `fill`. The markers disappear when the page closes.
- The timeline drawer's カット row shows ◆ at key times. Dragging a ◆ sets a numeric `at`.

**Stage drags** of `el.text.nudge` invert `engine.viewAt(t)`, so drags stay under the pointer at any zoom.

### 6.8 Picking an area

- **Timeline** (`ui/timeline`):
  - Bands come from `areas.bands` (song sections, else headings, else blocks) in the lane and in the drawer row 曲.
  - Click selects the area's lines (`sel = { level: 'line', ids, area }`) and opens 詳細.
  - The context menu (or ⋯ on the band) offers この区画をAIに頼む… and 区画のカメラ ▸.
  - Band proxies join the drawer's DOM listbox proxy: 「サビ1, 0:41 から 1:02, 5行」.
- **Multi-line page:** the header shows the area label when `sel.area` is set (§6.5).
- **Command palette:** the `%` prefix lists areas (`%サビ1`); Enter selects the area.
- **Lyric editor:** the existing heading-gutter click (D§6.4.14) also sets `sel.area = { kind: 'head', rowId }`.

### 6.9 My materials (マイ素材)

**Part browser** (`ui/part_browser`):
- Tabs are `rec / all / season / mine`. `mine` (マイ素材 n) shows `registry.mine(kind)` for every part kind; its first tile
  is [＋ AIで作る].
- Tiles use the same thumbnails and try-on. The UI thumbnail cache key adds `registry.extra[key].rhash`.
- Right-click a tile for: 素材を開く / 複製 / AIで作り直す… / この素材を使わない / 削除.
```
入り を選ぶ                                        [×]
[おすすめ] [すべて] [季節] [マイ素材 2]
┌────────┐ ┌────────┐ ┌────────┐
│   ＋    │ │ (thumb) │ │ (thumb) │
│ AIで作る │ │ 花びら着地│ │ 雪どけ   │
└────────┘ └────────┘ └────────┘
─ AIで素材を作る（入り） ────────────────   (inline under the grid, never a popover)
┌──────────────────────────────────┐
│ 例: 文字が花びらのように舞って着地する │
└──────────────────────────────────┘
☑ 作ったら選択中のカットに使う        [作る]
```
- 作る runs the `material` tool, and its result opens the normal review.

**作品全体 › マイ素材:**
- One row per material: kind icon · name · season · 使用 n · おまかせでも使う toggle (`material.meta pool`) · ⋯.
- Clicking a row opens the material page.

**Material page** (`ui/material_page`, crumb 「全体 › マイ素材 › 桜吹雪」):
```
桜吹雪   ✎                              装飾・空気 · 春 · AI作成
▶ [animated thumb, width of the column, current theme]
量        ━━━━━●━━━━  ×1.0         ← knob defaults: number widgets → material.put (gesture-coalesced, undoable)
重さ      ■■□□□ ふつう              ← cost().ms against the kind limit
おまかせでも使う  [ ]
使っている場所 3  › サビ1（5行） · 14行 · 作品全体      ← click = select that scope
[AIで作り直す…] [複製]
▸ レシピ（JSON）                      ← read-only; ▸ 編集 → textarea + [確かめる] (problems listed) + [反映]
[削除]  「使っている3か所の固定も外れます」
```
- The recipe textarea goes through `JSON.parse` → `normalize`. Nothing is executed.
- 複製 = `material.put` of a copy with a new id and `by: 'user'`.

### 6.10 Keyboard and accessibility

- There are no new global single keys. The keymap of D§6.8 is unchanged.
- New widgets follow D§6.12:
  - labels via `aria-label`;
  - state in text (the curve select names the curve);
  - focus rings;
  - reduced motion respected (curve preview, thumbnails animate only on hover or focus).
- The review's aggregate rows are `role="checkbox"` with `aria-checked="mixed"`.

### 6.11 Strings to add (`i18n/strings.js`, pairs [ja, en])

The en page shows no Japanese except the product name and user data, such as material names.

**Curves**

| Key | ja | en |
|---|---|---|
| `curve.softEnds` … `curve.snapSettle` | the §4.1 table | the §4.1 table |
| `curve.bz` | ベジェ（カスタム） | Custom Bézier |
| `curve.sp` | 速さの段（{n}点） | Speed steps ({n} points) |
| `curve.ramp.both` | 最初と最後ゆっくり・中は×{peak} | Slow ends, middle ×{peak} |
| `curve.ramp.start` | 最初ゆっくり→×{peak} | Slow start, then ×{peak} |
| `curve.ramp.end` | ×{peak}→最後ゆっくり | ×{peak}, then a slow end |
| `curve.auto` / `curve.simple` / `curve.custom` | 自動 / かんたん / カスタム | Auto / Simple / Custom |
| `curve.form.bz` / `curve.form.sp` | ベジェ / 速さの段 | Bézier / Speed steps |
| `curve.ends` / `.both` / `.start` / `.end` | ゆっくりにする所 / 最初と最後 / 最初 / 最後 | Slow at / Both ends / Start / End |
| `curve.edge` / `curve.peak` | ゆっくりの長さ / 速さの差 | Slow part / Speed ratio |
| `curve.point` | 点{i}: 時間 {u}%、速さ {s} | Point {i}: time {u}%, speed {s} |
| `curve.handle` | 取っ手{i}: 横 {x}、縦 {y} | Handle {i}: x {x}, y {y} |
| `curve.play` | 動きを見る | Preview the motion |
| `curve.hint` | ダブルクリックで点を足す・Delで消す | Double-click adds a point, Del removes it |
| `curve.positionOnly` | 位置の動きだけ | Position moves only |

**Shots, rigs, keys**

| Key | ja | en |
|---|---|---|
| `shot.none` | 動かさない | No camerawork |
| `shot.<9 presets>` | the §4.5.1 table | the §4.5.1 table |
| `shot.custom` | カスタム（キー{n}個） | Custom ({n} keys) |
| `shot.blurb.settle` | 入りから少し寄って止まる | Eases in a little and settles |
| `shot.blurb.pushWord` | 強調した言葉へ寄っていく | Pushes in on the emphasized word |
| `shot.blurb.readAlong` | 歌う言葉を順に追う | Follows the words as they are sung |
| `shot.blurb.snapZoom` | 歌い出しで一気に寄る | Snaps in at the sung start |
| `shot.blurb.pullReveal` | 最初の語から引いて全体を見せる | Pulls back from the first word to show all |
| `shot.blurb.sweepAcross` | 最初の語から最後の語へ横に流す | Sweeps from the first word to the last |
| `shot.blurb.tiltHold` | 少し傾けて構える | Holds at a slight tilt |
| `shot.blurb.driftOff` | 文字を中心から外して置く | Keeps the words off center |
| `shot.blurb.wideHold` | 引いたまま全体を見せる | Stays wide on the whole frame |
| `rig.none` / `rig.<5 presets>` / `rig.custom` | なし / §4.6 table / カスタム | None / §4.6 table / Custom |
| `aim.block` / `.emph` / `.first` / `.last` | 文字全体 / 強調 / 最初の語 / 最後の語 | Whole text / Emphasis / First word / Last word |
| `aim.word` / `.line` / `.glyph` | {n}語目 / {n}行目 / {n}文字目 | Word {n} / Line {n} / Character {n} |
| `aim.reading` / `.frame` / `.point` | 歌に合わせて / 画面全体 / 画面の一点 | Follow the singing / Whole frame / A point |
| `at.a` / `.rest` / `.sung` / `.mid` | 入り / 入り終わり / 歌い出し / 真ん中 | Start / Entrance done / Sung start / Middle |
| `at.end` / `.out` / `.b` / `.emph` | 歌い終わり / 抜け始め / 終わり / 強調 | Sung end / Exit starts / End / Emphasis |
| `at.word` / `.beat` / `.frac` | {n}語目 / {n}拍目 / {p}% の所 | Word {n} / Beat {n} / At {p}% |
| `pos.keep` / `.center` / `.left` / `.right` | そのまま / 中央 / 左1/3 / 右1/3 | As placed / Center / Left third / Right third |
| `pos.top` / `.bottom` / `.free` | 上1/3 / 下1/3 / 自由 | Top third / Bottom third / Custom |
| `keys.title` / `keys.item` | キーフレーム / キー{n} | Keyframes / Key {n} |
| `keys.when` / `.aim` / `.size` / `.pos` | とき / ねらい / 大きさ / 位置 | When / Aim / Size / Position |
| `keys.roll` / `.curve` | 傾き / 緩急 | Roll / Speed curve |
| `keys.add` / `.remove` / `.reset` / `.markers` | + キーを足す / このキーを消す / プリセットに戻す / プレビューに印を出す | + Add a key / Remove this key / Back to the preset / Show markers on the preview |

**Fields and inspector**

| Key | ja | en |
|---|---|---|
| `fld.camShot` / `fld.camZoom` / `fld.camCurve` | カメラワーク / 寄り具合 / 緩急 | Camerawork / Closeness / Speed curve |
| `fld.camFollow` / `fld.camKeys` | 文字を追う / キーフレームを編集… | Follow the text / Edit keyframes… |
| `fld.motionSpeed` / `fld.speedCurve` / `fld.flow` | 動きの速さ / 緩急 / 出方の緩急 | Motion speed / Speed curve / Stagger curve |
| `fld.holdCurve` / `fld.lensCurve` / `fld.seamCurve` | 見せの緩急 / 動きの緩急 / 切り替えの緩急 | Hold curve / Motion curve / Transition curve |
| `fld.rig` / `fld.rigCurve` | 区画のカメラ / 区画のカメラの緩急 | Section camera / Section camera curve |
| `fld.lineSeason` / `fld.avoid` | この行の季節 / この行で使わない部品 | Season of this line / Parts not used on this line |
| `fld.amount.camera` (changed) | カメラワーク | Camerawork |
| `sec.camwork` / `sec.camtexture` / `sec.rig` / `sec.materials` / `sec.area` | カメラワーク / 揺れ・質感 / 区画のカメラ / マイ素材 / 区画 | Camerawork / Shake and texture / Section camera / My materials / Section |
| `insp.rigRun` | {area}（{lines}）で続くカメラ | Camera across {area} ({lines}) |
| `insp.askArea` / `insp.askCut` | この区画をAIに頼む… / このカットをAIに頼む… | Ask AI about this section… / Ask AI about this cut… |

**Areas**

| Key | ja | en |
|---|---|---|
| `area.song` / `area.songAll` | {kind}{n} / {kind}（すべて） | {kind} {n} / {kind} (all) |
| `area.head` / `area.para` | # {text} / まとまり{n} | # {text} / Block {n} |
| `area.lines` / `area.linesOne` | {a}–{b}行 / {a}行 | Lines {a}–{b} / Line {a} |
| `area.cut` / `area.work` | {n}行 カット{k} / 作品全体 | Line {n} cut {k} / Whole video |
| `area.group.song` / `.head` / `.para` / `.sel` | 曲の区画（AI分析） / 歌詞の見出し（#） / まとまり（空行ごと） / 選択中 | Song sections (AI analysis) / Lyric headings (#) / Blocks (by blank lines) / Selected |
| `area.needSong` | 曲を分析すると区画が増えます | Analyze the song to get more sections |
| `area.proxy` | {area}、{t0} から {t1}、{n} | {area}, {t0} to {t1}, {n} |

**AI panel**

| Key | ja | en |
|---|---|---|
| `ai.tool.direct` / `ai.tool.material` | 指示 / 素材づくり | Instruction / Make a material |
| `ai.direct.placeholder` | 例: ここは季節感を足して、動きはゆっくり | e.g. Add a seasonal feel here and slow the motion down |
| `ai.direct.target` / `.work` / `.sel` / `.area` | 対象 / 全体 / 選択中 / 区画 | Target / Whole / Selected / Section |
| `ai.direct.send` / `.more` / `.allowMaterials` | 送る / 詳しく / 新しい素材を作ってもよい | Send / Options / May create new materials |
| `ai.camera.run` | カメラワークをAIに任せる | Let AI do the camerawork |
| `ai.chip.season` → `ai.chipText.season` | 季節感 → 季節感を足して | Seasonal → Add a seasonal feel |
| `ai.chip.slow` → `.slow` | ゆっくり → 動きをゆっくりに | Slower → Slow the motion down |
| `ai.chip.ramp` → `.ramp` | 緩急 → 最初と最後は一瞬ゆっくり、途中はすごく速く | Speed ramp → A brief slow start and end, very fast in the middle |
| `ai.chip.push` → `.push` | カメラで寄る → 文字にカメラで寄って | Push in → Push the camera in on the words |
| `ai.chip.material` → `.material` | 素材を作る → 合う素材を作って使って | Make a material → Make a fitting material and use it |
| `ai.board.open` / `.title` / `.send` | 区画ごとに頼む… / 区画ごとに指示 / まとめて送る | Ask per section… / Instructions per section / Send all |
| `ai.board.addSel` / `.max` | + 選択中の行を区画にする / 一度に送れるのは8区画までです | + Use the selected lines as a section / Up to 8 sections per request |
| `ai.board.state.new` / `.done` | 未送信 / 反映済み | Not sent / Applied |
| `ai.materialsFailed` | 素材づくりはこのモデルでは使えませんでした | This model could not make materials |
| `ai.guide.direct` | 区画を選んで指示すると、その区画だけを変える提案が来ます | Pick a section and give an instruction; the suggestions change only that section |
| `ai.guide.material` | 部品と形の組み合わせから新しい素材を作ります | Builds new materials from parts and simple shapes |

**AI review**

| Key | ja | en |
|---|---|---|
| `ai.grp.materials` / `.area` / `.cuts` / `.outside` | 素材 / 区画 {area} / カット / 区画の外（作品全体） | Materials / Section {area} / Cuts / Outside the section (whole video) |
| `ai.grp.outsideHint` | 区画の外も変わります | These change more than the section |
| `ai.ch.value` | {where} · {field}: {from} → {to} | {where} · {field}: {from} → {to} |
| `ai.ch.agg` | {field}: {from} → {to}（{n}行） | {field}: {from} → {to} ({n} lines) |
| `ai.ch.material` | 新しい素材「{name}」 {kind} · {season} | New material "{name}" {kind} · {season} |
| `ai.ch.materialUpdate` | 素材「{name}」を作り直す | Rebuild the material "{name}" |
| `ai.ch.cap` | （窓に合わせて最大 {max} 秒） | (capped at {max} s by the window) |
| `ai.needsMaterial` | 素材「{name}」が必要です | Needs the material "{name}" |
| `ai.stale.left` / `.gone` / `.material` | 区画から外れました / カットがなくなりました / 素材が変更されました | Left the section / The cut is gone / The material changed |

**AI warnings**

| Key | ja | en |
|---|---|---|
| `ai.warn.outside` | {n}件は区画の外だったので使いません | {n} changes were outside the section and were dropped |
| `ai.warn.notInArea` | {n}行目はこの区画にありません | Line {n} is not in this section |
| `ai.warn.areaGone` | 区画がなくなりました | The section no longer exists |
| `ai.warn.noSlot` | {n}行 · 装飾の空きがありません | Line {n}: no free decoration slot |
| `ai.warn.backdrop` | {n}行 · この背景の種類では効かない画面効果です | Line {n}: this screen effect does not run with this background mode |
| `ai.warn.badShot` / `.badCurve` | カメラワークを読めませんでした / 緩急を読めませんでした | The camerawork could not be read / The speed curve could not be read |
| `ai.warn.matScaled` / `.matFlash` / `.matEmpty` | 素材「{name}」は重すぎたので量を減らしました / 素材「{name}」の点滅を弱めました / 素材「{name}」は作れませんでした | "{name}" was too heavy, so amounts were reduced / "{name}" flashed too fast, so it was toned down / Could not make "{name}" |
| `ai.warn.matUnknown` | 「{name}」という素材はこの答えにありません | There is no material named "{name}" in this answer |

**Materials UI**

| Key | ja | en |
|---|---|---|
| `pb.tab.mine` / `pb.makeAi` / `pb.make` | マイ素材 {n} / ＋ AIで作る / 作る | Mine {n} / + Make with AI / Make |
| `pb.makeTitle` / `pb.makePlaceholder` | AIで素材を作る（{kind}） / 例: 文字が花びらのように舞って着地する | Make a material with AI ({kind}) / e.g. Letters flutter down like petals and land |
| `pb.makeUse` | 作ったら選択中の{scope}に使う | Use it on the selected {scope} when done |
| `mat.open` / `.duplicate` / `.remake` / `.notUse` / `.delete` | 素材を開く / 複製 / AIで作り直す… / この素材を使わない / 削除 | Open / Duplicate / Remake with AI… / Don't use this material / Delete |
| `mat.deleteNote` | 使っている{n}か所の固定も外れます | This also removes it from the {n} places that use it |
| `mat.byAi` / `mat.byUser` / `mat.run` | AI作成 / 手作り / 空気 | Made by AI / Made by you / Atmosphere |
| `mat.cost` / `.light` / `.normal` / `.heavy` | 重さ / 軽い / ふつう / 重い | Weight / Light / Normal / Heavy |
| `mat.pool` / `mat.used` | おまかせでも使う / 使っている場所 {n} | Use in automatic picks / Used in {n} places |
| `mat.recipe` / `.edit` / `.check` / `.apply` | レシピ（JSON） / 編集 / 確かめる / 反映 | Recipe (JSON) / Edit / Check / Apply |
| `mat.problem` / `mat.untitled` / `mat.full` | {path}: {what} / 名前のない素材 / 素材は64個までです | {path}: {what} / Untitled material / Up to 64 materials |
| `mat.knob.count` / `.size` / `.speed` / `.alpha` / `.amp` | 量 / 大きさ / 速さ / 濃さ / 振れ幅 | Amount / Size / Speed / Opacity / Amplitude |

**Planner warnings, why texts, undo**

| Key | ja | en |
|---|---|---|
| `warn.material-bad` | 読めない素材があります（{detail}） | A material could not be read ({detail}) |
| `warn.avoid-empty` | 使わない部品が多すぎるため、一部を使いました | Too many parts were turned off, so some are used anyway |
| `why.cam.emph` / `.impact` | 強調があるので言葉へ寄る / 見せ場（!）なので一気に寄る | Emphasis, so the camera pushes to the word / Impact line (!), so a snap zoom |
| `why.cam.words` / `.long` / `.short` | {n}語あるので歌に合わせて動く / 長いカットなので引きで見せる / 短いカットなので控えめに | {n} words, so the camera reads along / Long cut, so a wide hold / Short cut, so kept simple |
| `why.cam.section` / `.sectionStart` | 「{section}」の動き / 区画の始まりなので引きから | Camerawork of "{section}" / Start of a section, so it opens wide |
| `why.cam.lens` / `.arrange` / `.amount` | カメラの動き「{key}」と重ならないように / 構図「{key}」に合わせて控えめに / カメラワークの強さ {x} | Not stacked on the camera move "{key}" / Gentle for the layout "{key}" / Camerawork amount {x} |
| `why.rig.section` / `why.rig.lastChorus` | 「{section}」のカメラ / 最後のサビなので大きく | Section camera of "{section}" / Last chorus, so stronger |
| `why.season.line` / `why.avoid` | この行の季節（{season}） / この行で使わない部品 {n}件 | Season of this line ({season}) / {n} parts turned off on this line |
| `whyRule.carry` / `.speed` / `.gentle` | 前のカットの寄りを引き継ぐ / 動きの速さに合わせた / 構図に合わせて控えめ | Carries the framing of the previous cut / Scaled by the motion speed / Gentle for the layout |
| `whyRule.none-camera` / `.role` | カメラワークの強さが0 / この種類のカットの決まり | Camerawork amount is 0 / Rule for this kind of cut |
| `undo.aiArea` | AI: {area}（{n}件） | AI: {area} ({n}) |
| `undo.material.put` / `.meta` / `.remove` | 素材を保存 / 素材の設定 / 素材を削除 | Save material / Material settings / Delete material |

**Enum options** (the existing `opt.<v>` rule):
- `opt.both`, `opt.start`, `opt.end`: 最初と最後 / 最初 / 最後 (Both ends / Start / End).
- Existing `opt.*` keys cover the other enum values of new specs. `ui_fields.test.js` asserts the coverage.

---

## 7. Determinism, performance and tests

### 7.1 Determinism rules (additions to D§7.1)

1. **Canonical values.** Curves, shots and rigs are canonical JSON with q3 numbers. Recipes are normalized with q6 numbers
   and sorted keys. Hashes are identical in Node and Chrome.
2. **Planner streams.** New named slot streams are `motion.speed`, `cam.shot`, `cam.zoom`, `cam.curve`, `cam.follow` and
   the rig seed. The Gumbel noise is keyed by shot or rig key. Weights are q6-quantized. There are no clocks.
3. **Frames stay closed-form in `t`.**
   - Anchors are resolved at build.
   - The lean is computed from the same frame's world matrices.
   - The rig is a pure lookup.
   - Material movers are closed-form, with stochastic looks on `fx.tick`.

   So frame N rendered directly equals frame N rendered after 0..N−1.
4. **The effective registry is a pure function** of `(base registry, doc.materials)`, and the Plan is a pure function of
   `(doc, base registry)`.
5. **Scene seeds.** `slotSeed` hashes object values with `hashJSON`, so a custom shot seeds the same everywhere.
6. **Export** uses `engine.fork()`, which keeps the effective registry. Frame times are unchanged (D§4.21).

### 7.2 Performance (against D§7.4)

| Work | Cost and budget |
|---|---|
| `runShot` | ≤ 6-key search, one exp, 4 lerps; the reading path adds a binary search over ≤ 40 units |
| Lean | one pass over ≤ 60 glyph matrices (≪ 0.02 ms) |
| `rigAt` | two binary searches; the index is cached per plan |
| Curve evaluation | ≤ 8-knot scan, or Newton ≤ 8 steps for Bézier; compiled at build; nothing allocates per frame |
| behave + solve with shots, lean and materials | ≤ 0.8 ms at 720p (`perf.py`, p50) |
| Re-plan of 100 lines, warm | ≤ 5 ms: shot weights are 10 × O(1) per cut, rigs are O(runs), `planner_speed` still passes |
| Cold plan after a material meta edit | ≤ 35 ms |
| `registryFor` with 64 materials | ≤ 3 ms; runs only when `doc.materials` changes identity |
| Scene build per cut with materials | ≤ 4 ms: ≤ 48 shape nodes and ≤ 240 particles × `mixShare` |
| Draw | ≤ 400 particles guaranteed by `mixShare`; filter stacks ≤ 6 passes; the adaptive preview is unchanged; export never degrades |
| Static ground raster | ×1.25 only for `zoomed` segments; still ≤ the 24 MB cap at 1080p; 4K draws live (existing rule) |
| `direct` request build and validation | O(area lines), < 2 ms for 100 lines; prompt ≈ 1.5–5 k tokens (primitives text only with materials allowed) |

### 7.3 Node tests (`tests/node`)

| File | Owner | Asserts |
|---|---|---|
| `curve.test.js` (new) | A | canonical `coerce` round trip; rejections (9 knots, all-zero speed, u out of order, bad bz x); presets `f(0)=0`, `f(1)=1`; sp and ramp monotone; sp equals numeric integration of its speed (1e-9); ramp both e .1 k 6 → f(.1) ≈ .0213, middle share ≈ .868; jump knots; `reverse(reverse(c)) ≡ c`; `reverse` equals `1−f(1−u)` on 1k samples; bz equals `core/ease.bezier`; `isLinear`; `keyOf` stable under key order; golden hash of 10k samples per preset |
| `shot.test.js` (new) | A | `coerceShot`/`coerceRig` canonical forms and ranges; `expandShot` zoom, curve, carry and follow; `lastFraming`; `fromMove` table (every move × timing × focus gives 2–6 valid keys); `maxFill`; labels |
| `recipe.test.js` (new) | A | every prim, kind and limit (one over → the problem named); flash rule (a big alpha beat is refused, a small layer is fine); `normalize` idempotent; `hash` stable across key order and 1e-12 noise; `cost` monotone in count and evaluated at knob max; `knobSpecs` pass `validateSpec` and avoid shared names; 2,000 fuzzed JSON values never throw |
| `areas.test.js` (new) | A | `areasOf` from song info, headings and blocks, with ordinals; membership equals `features.songSection` for every line; `keyOf` stable; `resolve` after a lyric edit and after re-analysis (drift → null); `inArea` for line, cut and special cuts; `ofLines`; `bands` fallbacks |
| `materials_doc.test.js` (new) | A | migrate 1 → 2 on all fixtures (pins unchanged); `serialize` order; `material.put` creates only `m<next>`, `next` never decreases, ids never reused after a remove; `material.remove` clears pins, part-qualified pins and avoid refs; undo restores deep-equal; caps and invalid payloads refused; 500 random command sequences with materials undo to the start |
| `schema.test.js`, `registry.test.js`, `doc.test.js`, `commands.test.js`, `contract.test.js`, `i18n.test.js` (+) | A | new types; SHARED; `extend` (key rule, version and meta hash, `mine`, base untouched); `season`/`avoid` scope refusals; copy and promote rules; export lists; string pairs |
| `shot_engine.test.js` (new) | B | aimed box fills `fill` ±1 % at key times; keep vs `ox`/`oy`; safe and bleed clamps; anchors including `word:k`/`beat:n`; key sort and jumps; reading path hits each unit centre at its sung time; pose continuous at 240 Hz except deliberate jumps (aim screen speed ≤ 1.5 frame widths/s outside snap keys); lean bounded, 0 at rest, continuous; `none` leaves the camera untouched; lens amplitudes screen-constant under shot zoom (handHeld corner travel within ±5 % at Z = 1 and Z = 2.5) |
| `frame.test.js`, `lens_filter_seam.test.js`, `conformance.test.js`, `facade.test.js` (+) | B | `rigAt` purity, blend continuity, `cameraAt` equals sequential view application (1e-6, roll 0); **default `lens.curve`, `seam.curve`, `dwell.curve` and `flow` reproduce the v2 op hashes exactly**; periodic lenses warp only when not linear; conformance of every shot preset and rig × 7 aspects × h/v × the 6 texts × 24 times (no NaN, zoom within [0.855, 3·1.15·1.04], same op hash twice, build ≤ 20 ms); facade `shotTrack`, `viewAt`, `registry` getter, fork keeps materials |
| `mix.test.js` (new) | C | `derive` for every kind (variant and composite) gives defs that `REG.extend` accepts; `registryFor` returns `base` for no materials and is memoized; `version` changes on meta edits only; `baseVersion` constant; `sampleDefs()` pass the conformance harness (no NaN, balanced save/restore, identity rule for motion recipes, same op hash twice, particles ≤ budget after `mixShare`) over 40 seeded generated recipes × 7 aspects × 24 times |
| `camera_planner.test.js` (new) | D | determinism over the corpus; `amount.camera = 0` → all `none` and rigs `none`; impact cuts favour snapZoom (≥ 60 %); echo: repeated lines share shots (≥ 80 %); framing lens → `none` ≥ 70 %; `cam: 'none'` arranges never get auto shots; carry only within lines; rig runs follow sections; last chorus `slowBloom`; stability (insert a line → ≤ 4 other cuts' shots change; reroll a cut → ≤ 3); **documents without new pins keep every v2 part choice** |
| `planner_areas_season.test.js` (new) | D | line `season` gates pools, ×2.5, starts a segment, raises atmos probability; no `pin-off-season` when it matches; `avoid` excludes, relaxes with `avoid-empty`, pins still win; locks immune; `motion.speed` scales only unpinned dur/each/speed with `pfrom: 'rule'` |
| `planner_materials.test.js` (new) | D | a pinned material is chosen; `pool: false` never auto-picked; one `pool: true` material keeps ≥ 90 % of choices; a body edit changes only the fp of cuts using it and keeps the cast cache warm; a meta edit changes `version`; a deleted material gives `pin-bad-value` plus a fallback; `material-bad` warning; golden plan hashes unchanged without materials |
| `planner_pins`, `planner_explain`, `fields`, `planner_determinism` (+) | D | fuzz over the new slots and curve params at all scopes (always honoured); locks freeze `cam.*`/`motion.speed`, not `rig`; explain value equals plan value for the new slots; `fieldState` and `lockPayload` for the new slots; plan goldens regenerated on purpose |
| `ai_direct.test.js` (new) | E | request holds only brief and context lines (context never in changes); windows over 200 lines; schemas portable (added to `ai_providers.test.js`); every mapping row gives the expected command; `curveFromAi`/`cameraFromAi`; ornament free-index rule; out-of-area `i` → `ai.warn.notInArea`; the `work` part for a line area lands unchecked in `outside`; `mat:<name>` creates a material plus dependents with `requires`, and unchecking the material drops them; `toCommands` order and one batch equals one undo entry; `markStale` changed, left, gone and material; revert of a created material, kept when reused; camera mode schema |
| `ai_recipe.test.js` (new) | E | `fromAi` clamps and defaults; stop parsing; base params through specs; over-budget scaling; flash fix; `toAi ∘ fromAi` round trip; `recipeText` ≤ 2,000 chars and lists every vocabulary word (drift guard) |
| `ui_fields.test.js`, `ui_ai.test.js`, `ui_selection.test.js` (+) | F | new FieldSpec paths parse at their scopes; curve, shot, rig and partRefs specs map to widgets; `opt.*` coverage; target states; board caps; aggregate tri-state; dependency disabling; `side.asks` sanitize and cap; `sel.area` validation |

### 7.4 Browser tests (`tests/browser`)

| File | Owner | Asserts |
|---|---|---|
| `determinism.py` (+) | B | shots with follow and rigs, plus a project with materials: frame N directly equals frame N after 0..N−1; 30 vs 60 fps sample times |
| `perf.py` (+) | B | project_long with auto camerawork plus the heaviest allowed material in every slot: behave + solve ≤ 0.8 ms p50 at 720p; frame ≤ 2× budget |
| `parts_gallery.py` (+) | B | shot and rig thumbnails in every aspect; 0 CSP violations |
| `materials_gallery.py` (new) | C | `sampleDefs` and 12 generated materials × aspects: no console errors, not blank, 0 CSP violations |
| `ui_flows.py` (+) | F | curve widget drag = one undo step; preset → custom via a handle; keyframe edit → custom pin → プリセットに戻す; area band click → multi-line page with the area header; **flow "area direct"**: faked analysis → click サビ1 → target chip → faked answer (run-ornament material, speed 0.5, ramp curve, pushIn custom shot) → review with 4 groups → try-on → apply → preview renders the material → マイ素材 tile exists → undo restores materials and pins → redo → selective revert → delete material (pins cleared); board with 2 areas; keyboard-only variant |
| `ui_layout.py` (+) | F | curve widget, keyframe editor, board and material page fit 288–352 px; control budgets unchanged; nothing covers the preview |
| `csp.py`, `i18n_pages.py` (+) | F | the new flows cause no CSP violations; the en page has no Japanese UI text (material names excepted) |

### 7.5 Goldens

Goldens land in two steps. Only the lead regenerates them (`tests/update_golden.js`).

**Step (a): curves and contracts** (after A, then after B's lens autos).
- Plan hashes change: decisions gain `p.flow` / `p.curve`, and B's lens autos come in.
- The **frame op hashes must stay equal**. This is asserted before `plan_hashes.json` is regenerated.

**Step (b): auto camerawork and rigs** (after B and D are integrated).
- Visual QA with `contact_sheet.py` over 12 seeds × 8 moods × 3 aspects. Its checks:
  - no aimed text leaves the safe area;
  - no ground edge shows;
  - camera motion stays comfortable.
- Tune the §4.7 constants if needed, then regenerate `frame_hashes.json` on purpose. The NOTES entry lists the tuned
  values.

---

## 8. Work packages

**Order:**
```
A (contracts) ──► B (engine) ──┐
            ├──► C (materials runtime; needs B's env.mixShare only as an optional field) ─┐
            ├──► D (planner) ──┼──► integration: goldens (a), (b), visual QA
            ├──► E (AI) ───────┤
            └──► F (UI; starts on A, consumes B–E interfaces as they land) ──┘
```

**Shared-file rules:**
- `docs/NOTES.md` is append-only. Each package appends one `## v2.1-<letter>` section.
- `tests/golden/*` is regenerated by the lead only.
- `i18n/strings.js` is written by **A** (every key of §6.11). After A lands, it passes to **F**. Other packages request
  additions under "strings wanted" in NOTES.
- Files that A touches for compatibility and that belong to other packages later (`ui/fields.js`, `ui/widgets.js`,
  `parts/mix.js`) are handed over only after A has merged. Ownership never overlaps in time.

### 8.1 Package A — shared contracts: curves, shots, recipes, areas, data model, migration (≈ 2,400 LOC incl. tests)

**Files owned:**

| Kind | Files |
|---|---|
| New | `src/core/curve.js`, `src/core/shot.js`, `src/core/recipe.js`, `src/planner/areas.js`; `src/parts/mix.js` (**stub only**, §3.12; passes to C); `tests/node/{curve,shot,recipe,areas,materials_doc}.test.js`; `tests/fixtures/project_v21.json` (schema 2: materials, camera and curve pins, line season and avoid, song info with sections) |
| Changed | `src/core/schema.js`, `src/core/registry.js`, `src/core/doc.js`, `src/core/migrate.js`, `src/core/commands.js`, `src/core/types.js`, `src/i18n/t.js`, `src/i18n/strings.js` (all §6.11 keys, then passes to F), `build.py` (`parts/mix` → L3), `tests/helpers/corpus.js` (adds the v21 fixture), `tests/node/{schema,registry,doc,commands,contract,i18n}.test.js` |
| Compatibility, one-time | `src/ui/fields.js`: `widgetFor('curve') → 'choice'` and `optionsFor('curve')` = presets and eases, so the inspector keeps working until F's widget lands. |

**Interfaces used:** none (base package).

**Interfaces provided (FROZEN):**
- §2.1–§2.6;
- §3.2 `core/curve`, §3.3 `core/shot`, §3.4 `core/recipe`, §3.5 `core/schema`;
- §3.6 `core/registry` (SHARED and `extend`), §3.7, §3.8 `planner/areas`;
- the `parts/mix` stub signatures.

**Acceptance:**
- Its tests pass. `build.py --check` passes.
- The full Node suite is green except `plan_hashes` (regenerated in the PR with a note). The PR shows **frame op hashes
  unchanged**.
- Schema-1 fixtures migrate, validate and re-serialize with pins byte-identical.
- `i18n.test.js` passes with every §6.11 key.

**Early drop.** A.1 lands first: curve, shot, schema, registry SHARED, doc, migrate, commands, areas, stub, strings.
A.2 follows: `core/recipe` complete. B, D and F start on A.1; C and E need A.2.

### 8.2 Package B — engine: shots, rigs, curve application, renderer, facade, kit, lens and arrange metadata (≈ 1,600 LOC)

**Files owned:**

| Kind | Files |
|---|---|
| New | `src/engine/scene/shot.js`; `tests/node/shot_engine.test.js` |
| Changed | `src/engine/scene/behave.js`, `build.js`, `frame.js`; `src/engine/render/renderer.js`, `seam.js`, `draw.js` (optional cull); `src/engine/facade.js`; `src/parts/kit.js`; `src/parts/lens/glide.js`, `kick.js`; `src/parts/arrange/{columns,core,editorial,scatter,special}.js` (`cam` field only); `src/ui/lab.js` (`#shot:<key>@<aspect>&t=…`, `#rig:<key>`); tests `frame`, `lens_filter_seam`, `conformance`, `facade` (+); browser `determinism.py`, `perf.py`, `parts_gallery.py`, `contact_sheet.py` (+ shot/rig modes) |

**Interfaces used:**
- A: `core/curve`, `core/shot`, SHARED, def fields, the `parts/mix` stub (`registryFor`).
- D: Plan fields of §2.7 (`cut.slots['cam.*']`, `rigs`, `cut.rig`, `grounds[].zoomed`). Until D lands, B builds these plans
  by hand in its tests.
- C: `env.mixShare` producer (B) and consumer (C). This is agreed here; no call crosses packages.

**Interfaces provided:** §3.10, §3.11 (kit exports FROZEN), facade additions.

**Acceptance:**
- Its tests pass. Step (a) frame op hashes are equal with default autos.
- The §7.2 perf rows for shots and rigs are met.
- Export parity holds (determinism.py).
- The lab renders every shot preset in 7 aspects.

### 8.3 Package C — materials runtime (≈ 1,500 LOC)

**Files owned:** `src/parts/mix.js` (replaces A's stub); `tests/node/mix.test.js`; `tests/browser/materials_gallery.py`.

**Interfaces used:**
- A: `core/recipe`, `REG.extend`, `core/curve`.
- `parts/kit` as of v2 plus B's additive exports when present. C must work with v2 kit exports alone: it compiles curves
  with `core/curve` directly.
- `env.mixShare`, read as `env.mixShare ?? 1`.

**Interfaces provided:** §3.12 (`derive`, `registryFor`, `materialHash`, `sampleDefs`, `SHAPE_LIB`), §5.7–§5.9.

**Acceptance:**
- `mix.test.js` passes, including the conformance-style harness over `sampleDefs` and 40 generated recipes.
- `materials_gallery.py` passes.
- A cherry-petal run-ornament recipe (the §2.1 example completed) renders ≤ 1.5 ms static cost at 720p.
- `registryFor` with 64 materials takes ≤ 3 ms.

### 8.4 Package D — planner: automatic camerawork, motion speed, line season and avoid, material fingerprints (≈ 1,500 LOC)

**Files owned:**

| Kind | Files |
|---|---|
| New | `src/planner/camera.js`; `tests/node/{camera_planner,planner_areas_season,planner_materials}.test.js` |
| Changed | `src/planner/cast.js`, `choose.js`, `tracks.js`, `features.js`, `plan.js`, `encode.js`, `fields.js`, `explain.js`, `segment.js`, `params.js` (only if `applySpeed` needs a hook); tests `planner_pins`, `planner_explain`, `fields`, `planner_determinism`, `planner_stability` (+) |

**Interfaces used:**
- A: curve, shot, schema types, `REG.extend`/`baseVersion`/`mine`/`problems`.
- Materials in tests are hand-made defs through `REG.extend`, so there is no dependency on C.

**Interfaces provided:** §2.7 Plan shape (FROZEN), §2.8 codes, `planner/camera` exports, §4.3, §4.6, §4.7, §4.9.

**Acceptance:**
- Its tests pass. Documents without new pins keep every v2 part choice.
- `plan()` of project_long: ≤ 10 ms cold, re-plan ≤ 5 ms warm.
- Explain agrees with the plan for 500 random new-slot paths.

### 8.5 Package E — AI: direct tool, recipe AI, catalog, changes (≈ 1,700 LOC)

**Files owned:**

| Kind | Files |
|---|---|
| New | `src/ai/direct.js`, `src/ai/recipe.js`; `tests/node/{ai_direct,ai_recipe}.test.js` |
| Changed | `src/ai/catalog.js`, `src/ai/changes.js`, `src/ai/looks.js` (the `helpers` export only); `tests/node/ai_providers.test.js` (portability list), `ai_looks.test.js` (+ helpers unchanged) |

**Interfaces used:**
- A: `planner/areas`, `core/curve`, `core/shot.fromMove`, `core/recipe`, commands `material.*`.
- D's Plan fields for "from" values. Before D, they read as null or auto.
- C's `materialHash`, available via A's stub.

**Interfaces provided:** §3.13, §5.2–§5.6, §5.10–§5.11 (the answer schema is FROZEN).

**Acceptance:**
- Its tests pass. Every mapping row is covered.
- One review applies as one undo step. Selective revert works per path and per material.
- The existing `ai_*` tests stay green.

### 8.6 Package F — UI (≈ 2,600 LOC + CSS)

**Files owned:**

| Kind | Files |
|---|---|
| New | `src/ui/curve_widget.js`, `shot_editor.js`, `material_page.js`, `ai_board.js` |
| Changed | `src/ui/fields.js`, `widgets.js`, `inspector.js`, `part_browser.js`, `ai_panel.js`, `ai_review.js`, `ai_controller.js`, `selection.js`, `timeline.js`, `stage.js`, `palette.js`, `lyric_editor.js`, `boot.js`, `style.css`, `src/i18n/strings.js` (after A); tests `ui_fields`, `ui_ai`, `ui_selection` (+); browser `ui_flows.py`, `ui_layout.py`, `csp.py`, `i18n_pages.py` (+) |

**Interfaces used:**
- A: `planner/areas`, `core/curve` (`sample`, `speedAt`, `label`), `core/shot` (labels, presets), commands.
- B: `engine.registry`, `shotTrack`, `viewAt`, thumb kinds.
- D: `fieldState`/`explain` for the new slots.
- E: `directRequests`/`directChanges`, `materialRequest`/`materialChanges`, the new change fields.

Until B, D and E land, F uses `fake_engine.js` extensions and faked AI answers.

**Interfaces provided:** §6.

**Acceptance:**
- Its tests pass. The top-level control budgets are unchanged (`ui_layout.py`).
- Every §7.4 flow passes, mouse and keyboard-only.
- 0 CSP violations. axe-core has no serious findings on the new pages.

### 8.7 Integration (lead, not a package)

1. Wire the full stack and run every Node and browser test.
2. Goldens step (a).
3. Visual QA of auto camerawork and rigs (§7.5), then tune the §4.7 constants and regenerate goldens step (b).
4. Walk the three user stories by hand:
   - 「サビだけ桜で、カメラはゆっくり寄る」 via 区画▾ → apply → undo;
   - 「Aメロは動きをスローに」 via the board;
   - 「最初と最後は一瞬遅く、途中はすごく速い」 on a line's entrance and camera via the curve widget's かんたん form.
5. Add a one-line pointer at the top of DESIGN.md: 「v2.1 additions: see DESIGN_2_1.md」.

---

## 9. FROZEN contracts touched (the D§9.4 change list)

| D§ | Change | Approving owners |
|---|---|---|
| §2.3 | layers of `core/curve`, `core/shot`, `core/recipe`, `planner/areas`, `planner/camera`, `engine/scene/shot`, `parts/mix` (L3) | lead, WP0 |
| §3.1–§3.2 | schema 2, `doc.materials`, `side.asks`, migration | WP0, WP1, WP8 |
| §3.4 | shared params `flow`, `dwell.curve`, `lens.curve`, `seam.curve`; `ease` becomes a curve | WP3, WP4, WP5, WP8 |
| §3.4.2, §3.4.3 | line slots `season`, `avoid`; cut slots `motion.speed`, `cam.*`, `rig`, `rig.curve` | WP3, WP7, WP8 |
| §3.9 | commands `material.put`, `material.meta`, `material.remove`; scope refusals; copy and promote rules | WP1, WP7, WP8 |
| §3.12 | `plan.v 2`, `rigs`, `cut.rig`, `grounds[].zoomed`, `feat.sectionStart`, `matTerms` in fp, `baseVersion` in the shared term | WP3, WP4 |
| §3.13 | warning and why codes | WP3, WP8 |
| §4.2 | ParamSpec types `curve`, `shot`, `rig`, `partRefs` | WP0, WP3, WP8 |
| §4.6 | `Registry.extend/base/baseVersion/extra/mine`; `myMat` key rule; def fields `frames`, `warp`, `cam`, `mine` | WP0, WP3, WP4, WP5 |
| §4.16.2 | cast order; stage 6 order | WP3 |
| §4.16.4 | season-keyed statics, `SECTION_SEASON`, avoid pools | WP3 |
| §4.17.5 | lens env `target`, `shot`; Scene `lean`, `shot`; `env.mixShare`; object-safe `slotSeed` | WP4, WP5 |
| §4.18.1–§4.18.3 | kit exports `curve`, `warp`, `CURVES`, `warped`, `aimBox`, `frameBox`; `K.lens` warp wrapper; mirror via `CV.reverse` | WP4, WP5 |
| §4.19.3 | camera composition (shot, lean, rig); ground camera in gaps; log-lerp seam blend | WP4 |
| §4.20 | facade `registry`, `shotTrack`, `viewAt`, thumb kinds; `setDoc` composes the registry | WP4, WP6, WP8 |
| §4.22 | tools `direct`, `material`; answer schemas; Change fields and kinds | WP7, WP8 |
| §4.23 | `Sel.area` (optional) | WP8 |
| §4.24 | `createT` registry getter | WP0, WP8 |
| §6.4 | placements and widgets of §6 | WP8 |

Everything is additive or widened: no existing path, pin or command changes meaning. Documents without the new pins or
materials produce the same part choices as v2. Their plan hashes differ only by the new default params and slots, and
their frames differ only by automatic camerawork (goldens step (b)).

---

## 10. Out of scope for v2.1 (later)

- A cross-project material library (localStorage) and 「ライブラリから追加」.
- Theme recipes (swatch overrides).
- Named shot or curve materials (a `mat:` reference form for `cam.shot` / curves).
- AI-written raw keyframes: the AI uses presets or `fromMove`, and raw keys are a UI feature.
- A preview-only 「カメラの動きを抑える」 setting (≡ › 表示, like 点滅を抑える): scaling shot and rig deltas by 0.3 in
  preview only, never in export. It is a comfort option to consider after visual QA.
