# 文字PVメーカー v2.1 — DESIGN addendum: camerawork, speed curves, area instructions, materials

Status: **contract for v2.1**, to be read together with `docs/DESIGN.md` (the v2 build contract). Builders read only
DESIGN.md and this file. Where this file changes a rule of DESIGN.md it says so, and this file wins. Everything else in
DESIGN.md stays binding: clean-room rules, layers, lint, determinism, budgets and the testing plan.

Items marked **FROZEN** change only through the D§9.4 process. This file is itself the D§9.4 change record for v2.1: §9
lists every FROZEN contract it touches.

Notation:
- "D§4.16.4" is a section of DESIGN.md. "§4.3" is a section of this file.
- Paths are relative to `src/` unless they start with a top-level directory (`tests/`, `docs/`, `vendor/`) or name a root file (`build.py`).

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
| 写真・動画 / Photos and videos | **media**; one file = an **asset** (`AssetId`, `doc.media`) | `image` is taken: node type 4 (`sb.image`) and D§4.20's `AssetStore` |
| 作品ファイル / Project file (package) | **package** (`.mojipv`) | |
| Filmora用セット / Set for Filmora | **kit** (`output.format: 'kit'`) | |

**Inputs.** This file merges two proposals:
- the "camera + curves" proposal (text-aimed camerawork, a unified curve model, automatic camerawork);
- the "AI sections + materials" proposal (area-scoped AI instructions, recipe-based materials).

§1.4 lists every point where they disagreed and what was decided.

**Later additions** (the owner's requests after §1–§10 were written):
- §11: images and videos (写真・動画).
- §12: the single-file project package (`.mojipv`).
- §13: Filmora support.

Their work is in packages **G** and **H** (§8.7, §8.8), plus marked items in packages A–E. §9 lists the FROZEN contracts
they touch.

**Code facts this file relies on** (read from the tree, v2 HEAD):
- `core/registry` `version` hashes only (kind, key, *part* param names). Shared params are not in it.
- `planner/cast.isChoice` ignores slots containing `.`, so `cam.shot` needs an explicit rule.
- `engine/scene/build.slotSeed` stringifies `v`, so object values need hashing.
- `renderer.gather` already blends the ground camera across text seams with `textSeamCam`.
- `ui/fields` already uses `sec.*` string keys for inspector sections. Song section names are `songSec.*`.
- `planner/cast` keys its cast cache by registry identity.
- `ai/catalog` lists only `registry.pool(...)`, which leaves out `pool: false` parts.
- `build.py` gives no layer to an unknown `parts/*` module.

**Code facts that §11–§13 rely on** (v2 HEAD):
- **Images.** `photoPan` (`parts/ground/photo.js`) already draws `sb.image({ asset: p.image, fit: 'cover' })` with a
  closed-form pan and zoom. `engine/render/shapes.drawImage` calls `assets.get(id)`. `ui/boot` passes `assets: null`,
  so no image has ever rendered.
- **Segments.** `planner/tracks.splitSegments` starts a new segment only when the pinned ground or atmos **key**
  changes. Pinned params are read from the segment's first cut.
- **Audio and export.** `audio/host/decode` decodes every song at 48 kHz (`DECODE_RATE`). `export/host/mp4.audioConfig`
  returns `null` when AAC does not encode, and the MP4 is then silent. `export/muxer.MUX_CODECS` already maps `opus`,
  and the vendored mp4-muxer supports `["aac","opus"]`.
- **ZIP and sinks.** `export/zip` writes store-only ZIP64, but takes whole `Uint8Array`s only. The sinks accept
  positional writes.
- **Storage and routing.** `ui/project_io` opens IndexedDB `mojipv-v2` version 1 with the stores `works` and `songs`.
  Its `AUDIO_EXT` includes `.webm`, so a WebM video is routed to the song today.
- **Step budgets.** Step ③ has 5 `[data-ctl]` controls (mood, theme, shape, 詳しく, AI) and step ④ has 5 (format,
  size, fps, backdrop, 詳しく). Neither can take a new control.
- **CSP.** `script-src` hashes only (no `'wasm-unsafe-eval'`); `img-src data: blob:`; `media-src blob:`; `worker-src
  'none'`; `connect-src` only for the two AI hosts.

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
5. **Your own photos and videos (写真・動画; §11).** Drop images (PNG, JPEG, WebP, AVIF, GIF) or videos (MP4, MOV,
   WebM) anywhere.
   - Use them as the background of the whole video, an area, a line or a cut; as a photo frame or cut-out near the
     words; inside the letters; or as overlay footage.
   - Controls: fit, crop, Ken Burns motion, blur, veil and tint. For video also: trim, speed, loop and the clock.
   - Video is frame-exact in export. The AI can place them, and おまかせ can use them when allowed.
6. **One file holds everything (§12).** The project file `.mojipv` contains the photos, the videos and the song, and it
   is the default save. The light `.json` save stays.
7. **Filmora-ready output (§13).** 「Filmora用」 in step ④ writes a set of files into one folder: an MP4, a transparent
   WebM overlay, a background MP4, a green-screen MP4, SRT subtitles and a how-to. It also adds a standalone transparent
   video format (WebM with VP9 alpha).

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

The layout is the same as D§3.1, plus `doc.materials`, `doc.media` (§11.2.2) and the `output` additions of §13.3. The
keys are shown in serialize order.

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
      "work:seam.curve":      { "v": "dashStop", "by": "user" },
      "work:ground":          { "v": "photoPan", "by": "user" },
      "work:ground@photoPan.image": { "v": "a3f9c2d17b0e4a5c6d7e8f901", "by": "user" }
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
    "media": {
      "list": [
        { "id": "a3f9c2d17b0e4a5c6d7e8f901", "kind": "video", "name": "海辺.mp4", "mime": "video/mp4", "bytes": 48213344,
          "w": 1920, "h": 1080, "dur": 12.512, "fps": 29.97, "frames": 375, "rot": 0, "alpha": false, "anim": false,
          "audio": true, "codec": "avc1.640028", "color": "bt709", "hdr": false, "pv": 1, "pool": false, "ai": null }
      ]
    },
    "output": { "…": "…", "format": "kit", "kit": { "overlay": true, "bg": false, "green": false, "srt": true, "lrc": false } }
  },
  "side": { "looks": { "list": [], "cap": 50 }, "aiLog": [], "asks": {} }
}
```

**`doc.materials`** = `{ next, list }`:
- `next` is an integer ≥ 1. It only grows.
- `list` holds at most 64 `MaterialEntry` objects (§5.7) sorted by id order of creation.
- The canonical JSON of `doc.materials` is ≤ 160 KB and each recipe is ≤ 6 KB.
- Ids are `'m' + n.toString(36)` with `n < next` and are **never reused** (like row ids).

**`doc.media`** = `{ list }`: the asset library (§11.2.1–§11.2.2). It holds metadata only; the bytes are in IndexedDB
and in the `.mojipv` package (§12). There are at most 200 entries, and the ids are content hashes.

**`output`** gains the formats `kit` and `webmAlpha` and the object `output.kit` (§13.3).

**`side.asks`** = `{ [areaKey]: { text, at } }`:
- These are board drafts (§6.3). They are not undoable.
- Caps: 40 entries, `text` ≤ 120 characters.
- `at` is the store revision.

### 2.2 Migration and validation

- `core/doc.CURRENT_SCHEMA = 2`.
- `core/migrate.MIGRATIONS[1] = (file) => ({ ...file, schema: 2, doc: { ...file.doc, materials: { next: 1, list: [] },
  media: { list: [] } } })`. `doc.media` is part of schema 2, so there is no schema 3 (§11.2.2).
  - It is pure and touches nothing else.
  - Schema-1 files and autosaves open unchanged, and so does every existing pin.
  - Files with schema > 2 are refused as today (「新しいバージョンで作られた作品です」). v2.0 refuses schema-2 files the
    same way, which is intended.
- `core/doc` additions:
  - `ORDER.doc` puts `materials` and then `media` between `filters` and `output`. `ORDER.media`, `ORDER.asset` and
    `ORDER.assetAi` are given in §11.2.2. `ORDER.output` adds `'kit'` and `ORDER.kit` is new (§13.3).
  - `ORDER.materials = ['next', 'list']`.
  - `ORDER.material = ['id','kind','by','name','blurb','tags','season','pool','rv','recipe']`.
  - `ORDER.side` adds `'asks'`.
  - Recipes are serialized with sorted keys (they are stored normalized, §5.7).
  - `defaultDoc().materials = { next: 1, list: [] }` and `meta.app = '2.1.0'`.
  - `normalize` fills a missing `materials`, `media` and `output.kit`. `sanitizeSide` keeps a valid `asks` and drops
    anything else.
- `validate(doc)` adds **structural** checks only:
  - `materials` is an object, `next` is an integer ≥ 1, and ids match `^m[0-9a-z]+$`, are unique and are < `next`;
  - `kind ∈ MAT_KINDS`, `by ∈ ai|user`, `name.ja` is non-empty, `recipe` is an object;
  - the size caps hold;
  - every `doc.media` entry passes `core/media.entryProblems`, the ids are unique, and the caps hold (§11.2.2);
  - `output.format` is one of the §13.3 values, and `output.kit` holds 5 booleans.

  Recipe semantics are **not** checked here. A recipe that `core/recipe` rejects (for example one from a newer `rv`) keeps
  the file openable. The registry skips it, and the planner warns `material-bad` (§5.9).
- `touched(a, b)` gains `materials: a.materials !== b.materials` and `media: a.media !== b.media`.

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

**Media commands** (`media.put`, `media.meta`, `media.move`, `media.remove`, `media.relink`) are in §11.2.5.
`output.set` accepts the key `kit` (§13.3).

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
- `media` = `{ [AssetId]: MediaMeta }` for every asset the decisions use (§11.2.6). It is covered by the plan hash, and
  scenes read it at build.

**Fingerprints and hash** (D§3.12 amended):
- The cut `fp` covers `slots` (all new slots and `p.carry` included) and, new, `matTerms` = sorted
  `[[slot, key, rhash]]` of the chosen parts whose def has `mine` (§5.9), plus `mediaTerms` (§11.2.6).
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

**Media codes:** the warnings `media-missing` and `media-kind`, and the why codes `media.pool` and `media.pin`
(§11.2.6).

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
- The media, package and Filmora modules (`core/media`, `core/sha256`, `media/*` L1, `media/host/*` L6,
  `export/webm|unzip|package|subtitles`, `export/host/webm|kit`, `ui/media_*`, `ui/filmora_help`) and the new
  `build.py.layer_of` rules are in §11.3.1.

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
  cost(kind, recipe, ctx?) → { ms, particles, nodes, paints, parts, cost, passes, cover },   // every knob at its maximum;
                                                    // ctx = { registry?, media? }. Glyph sprites have no per-recipe cost:
                                                    // what they cost depends on the text, so each cut scene budgets them
                                                    // (§5.9.5)
  knobSpecs(kind, recipe) → { [name]: ParamSpec }, // generated knob params (§5.7.6); validate with validateSpec
  withKnobs(recipe, p) → recipe,                   // the recipe with knob multipliers applied (pure; used at build)
  upgrade(recipe, rv) → { recipe, rv } | null,     // future rv migrations; null = unknown rv
}));
```

The vocabularies and limits are in §5.7–§5.8. The AI catalog text is generated from these constants, so the prompt and the
validator cannot drift apart (§5.10).

### 3.5 `core/schema` (D§4.2 additions; FROZEN)

- `TYPES` gains `'curve'`, `'shot'`, `'rig'` and `'partRefs'`, and `'media'` (package A.3; §11.2.3).
- `coerce` delegates to `CV.coerce`, `SHOT.coerceShot` and `SHOT.coerceRig`. For `partRefs` it checks the format,
  sorts, dedupes and caps the list at 24.
- `baseValue`: curve `'linear'`, shot `'none'`, rig `'none'`, partRefs `[]`.
- `checkCandidate` accepts any value that coerces, so `auto: { pick: ['expoOut', 'holdThenDash'] }` is valid.
- `describeAuto` shows object values as `CV.keyOf` / `'custom'`. The inspector's display text comes from `label()`, not
  from here.
- `optKey` (new optional field; enum only, an identifier `^[a-z][a-zA-Z0-9]*$`): the options are labelled
  `opt.<optKey>.<value>` instead of the shared `opt.<value>`. It is for an enum whose values need their own words, such
  as `depth`, whose `back` is 後ろに下げる and not `opt.back` 逆方向 (§11.9.1). `validateSpec` refuses it on any other type
  and in any other form. Lead decision (NOTES "Lead: integrating G.3").
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
  - `createRegistry` refuses keys starting with `myMat` or `myMed`.
  - `extend` accepts only keys matching `^myMat[0-9a-z]+$` (materials) or `^myMed[0-9a-f]{10}$` (the user's media
    offered to おまかせ, §11.5.9). Both also satisfy KEY and PARTKEY.
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
  extra,                      // frozen { [key]: def.mine }; media-derived defs have mine.media = true (§11.5.9)
  mine(kind) → string[],      // material and media keys of a kind, sorted
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

**Host canvas factory and the sprite and post paths** (additive; the perf.py camerawork + materials row, NOTES "Perf:
camerawork + materials row"):
- `engine/host/canvas` `CanvasFactory` gains two optional members next to `now` and `idle`:
  `settle(canvas)` uses a new canvas's picture once on a private 1 × 1 canvas (cleared at once), so a canvas that
  records its calls rasterizes when it is made, not inside the first frame that draws it; `inkBox(css, text) →
  { left, right, ascent, descent } | null` measures the ink of text drawn centred on a middle baseline (measureText's
  actual bounding box). The recording factory has neither, so Node op streams and the frame goldens do not depend on
  them; the engine never measures and never makes a canvas for them.
- `engine/render/sprites`: a new sprite is settled when the factory can. Every glyph raster is made and kept whole, as
  before; on a factory with `inkBox` its entry also keeps `ink`, the rect outside which the raster is transparent
  (`inkRect`: the ink box, half the outline, the shadow or duo offset, 3 blur standard deviations + 2 px; for blurred
  levels only where ctx.filter blurs).
- `engine/render/draw`: `spriteAt` draws a raster with an ink rect that is scaled up on both axes (`minScaleOf`) whole,
  with the same call as always, inside a clip round the rect widened by `INK_CLIP` (2) texels (`inkClip`): all four
  sides when the transform turns or skews the raster (the canvas maps every pixel on its own; a pixel the clip cuts
  samples only transparent texels), and for a scale-and-translate draw the top, the bottom and the side where device
  rows end (a software canvas steps along each row in fixed point from the row's first pixel, so the side where rows
  start stays open, a texel beyond the quad). Every pixel is what the unclipped draw gives (`glyph_parity.py`); only
  the time is spent inside the clip. A draw that scales down, shards and the pixel mosaic are drawn as before.
- `engine/render/post`: the FxContext gains `own(src)` (D§4.18.11 additive): in the post stack the filter draws on its
  input, which the stack owns, instead of a copy; seams and other callers get a copy. `control.use(seed, cut,
  allowTextAt, own)` and `control.drew()`; at half resolution a drawn input is scaled up, an untouched one leaves the
  full-resolution input. `run(…, copy?)` → `{ out, passes, torn }`: `torn` when a filter threw after it had drawn on
  its input; the renderer then renders that frame again with every filter copying (`copy`), so a skipped filter
  leaves no trace, as before. Pixels are identical (`determinism.py` compares with the lab switch `postCopy`).
- `engine/render/surface` pool: `warm(n, touch, stop)` makes sure n frame surfaces can be taken without making one
  (`stop()`, asked after each surface made, ends the call early); the preview warm-up (`renderer.warmAt`) calls it on
  a host canvas when a seam is on screen (6 surfaces: a text seam's two sides and its mix), with its slice clock, so a
  seam's first frame does not make them and no prepare slice makes more than one once it is due.
- `engine/facade`: the preview warm-up walks one frame in parts when its sprites are more than a slice of work
  (`renderer.warmAt(plan, source, t, stop)`), so prepare still yields on time with settled sprites. Lab and test
  options: `createEngine({ postCopy })`, render options `flush(frame)` (timed with the draw stage) and `meter` (the
  frame share the glyph sprite draws cover).
- `engine/scene/build` + `engine/scene/budget` (new, L3): the glyph budget of material phases (§5.9.5). A cut scene
  gains `spriteBudget` (the record) and keeps its phases as made (`budgetPhases`, not enumerable; tests and the lab).
  `engine/scene/behave` gains `masked(beh, groups, from, to)` (`MASK_GROUPS`: tint, echo, glow, blur with shard and
  pixel, grow = sx sy z) and `engine/render/draw` the cost model `glyphCover` / `poseCover`.

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
- Media additions (B.3): `mediaAt`, `mediaReady`, `fork({ assets })`, `FrameStats.media`, the `layers: 'ground'`
  render option and `EngineError('media-not-ready')`. They are in §11.3.7.

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
  registryFor(base, materials, media?) → Registry,         // §5.9.2; base itself when both lists are absent or empty;
                                                           // media = doc.media: derived myMed grounds (§11.5.9)
  materialHash(entry) → 'xxxxxxxx',                        // hashJSON of the whole normalized entry (stale checks)
  sampleDefs() → def[],                                    // one composite material per COMPOSITE_KIND, plus one run ornament
                                                           // (conformance, lab); keys 'myMatS…', never in a registry
}));
```

**A's stub** exports the same names:
- `registryFor(base) → base` (any arguments);
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
| media, package and Filmora UI | packages G and H: `ui/media_io`, `ui/media_page`, `ui/media_widgets`, `ui/filmora_help`, and the handover edits of §8.7–§8.8 (§11.7, §12.7, §13.10) |

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
`m = 0.06·short` per side, so a one-glyph aim cannot zoom without bound. When an arrange lays out text of its own beside
the lyric (a run with `text`, such as sidebarIndex's index number or a side note), or lays the lyric out more than once
(runs with the same `span`, such as echoStack's fading copies), word, line and glyph aims, the `word:k` anchors and the
reading path take only the lyric's runs (runs with `span`), and of runs with the same `span` only the first (the main
copy).

| Aim | Box |
|---|---|
| `block` | `target.focus`, grown to hold the lyric's glyphs (above) that lie inside the frame, for an arrange whose focus is one piece of the lyric (spineColumn's title split around its note) |
| `emph` | union of the first emphasized run (`hints.emph` / `emphLines`); no emphasis → `block` (a plain line is framed whole, so no word leaves the frame while it is sung) |
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
   - At Z = 1 this allows ±0.083 W; at Z = 1.5 it allows ±0.24 W (the k = 1.2 term is the smaller one).

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
none        3·(1−A)² + (lens def.frames ? 24 : 0)
settle      1.2
pushWord    (f.emph ? 3 : f.words ≥ 2 ? 0.3 : 0.2) · (0.6 + f.energy)
readAlong   (f.words ≥ 3 && f.dur ≥ 2.2 ? 1.6 : 0) · (orient 'v' ? 0.7 : 1)
snapZoom    f.impact ? 30 : (f.energy ≥ 0.75 && f.onBeat ? 0.5 : 0)
pullReveal  f.sectionStart ? 2 : 0.4
sweepAcross (f.words ≥ 2 && f.cells ≥ 8 && orient 'h') ? 0.3 : 0
tiltHold    0.6 · (f.energy ≥ 0.4 ? 1 : 0.3)
driftOff    f.cells ≤ 10 ? 0.7 : 0.2
wideHold    (f.dur ≥ 3 && f.energy < 0.45) ? 1 : 0.1
× moodBias(preset.tags)          (CH.moodBias; 1 for none)
× section:  chorus: pushWord, snapZoom, sweepAcross ×1.5, none ×0.6 · verse or null: settle, driftOff, none ×1.3 ·
            bridge: tiltHold, wideHold ×1.5 · intro, outro: pullReveal, wideHold ×1.5
× recency:  ×0.2 if = the previous cut's final cam.shot (hist.previous); ×0.5 if among the 3 before (hist near set)
× echo:     ×40 if = the natural cam.shot of feat.repeatOf's cut (hist.echo)
value = CH.pickWeighted(pool keys sorted, w → q6(w), slotSeed('cam.shot'))     // Gumbel keyed by shot key; ties → smaller key
```

**Parameters** (each has its own slot seed):
- `cam.zoom = coerce(q2(lerp(0.8, 0.9, clamp(0.5·A + 0.5·f.energy)) · (f.impact ? 1.05 : 1)))`. For arrange `gentle`:
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

- `amp = q2(0.3 + 0.4·A)`.
- The **last chorus run** gets amp ×1.25 (clamped to 1.3) and curve `slowBloom` (why `rig.lastChorus`).
- Other runs use the preset's curve unless `rig.curve` is pinned.

**Stability** (tested, D§4.16.4 targets):
- Inserting a line changes ≤ 4 other cuts' shots. A line sung again follows the natural shot of its first sung copy (the
  echo), so an insertion next to a first copy that changes its shot also moves that line's repeats; these echo
  followers are counted apart (with them, more than 4 other cuts change about 1.8 times as often as with the echo ×3 of
  v2.1-D; NOTES "Step (b): automatic camerawork").
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
| Sprite rasters | settled when made; a raster drawn scaled up is clipped round its ink, on a host with `inkBox` only (§3.10). Node op streams unchanged; browser frames identical. |
| Post stack | filters draw on the stack's own surface (`fx.own`, §3.10): no copy per filter. Identical pixels; op hashes lose the copies. A filter that throws after drawing makes the frame render again with copies. |
| Material text phases | masked by the scene's glyph budget where they would add more than their share of glyph cover (§5.9.5); v2 documents have no materials and are unchanged. |
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
| glyph sprites (`arrive`, `depart`, `dwell`) | no per-recipe limit beyond the track and oscillator limits: blur, glow, tint, echo (through parts) and size may all be used at once. What they cost depends on the glyphs they dress (their number, size and the blur's reach), which only a scene knows, so each cut scene keeps every material phase within its share (§5.9.5). |
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

#### 5.9.5 Glyph budget in cut scenes (`engine/scene/budget`)

A glyph that a pose puts on the sprite path (blur, glow, shards, the mosaic; D§4.19.5) is drawn as one or more rasters:
a halo under a glow, two echo pairs, the body (a crossfaded pair of blur levels) and a tinted pair. On a canvas without
a GPU each costs about its drawn area, so the cost of a text material is its sprites × the glyphs' size and number × the
blur's reach: six glyphs of 700 du with blur and tint cover about six frames. It cannot be bounded per recipe, so the
scene bounds it where the text is known. For each cut phase (entrance [a, rest], hold [rest, out], exit [out, b]) whose
part is a material (`def.mine`):
- **Cover** (`draw.glyphCover`, the same path and sprites as `drawGlyph`): the frame du² the draws of a glyph cover under
  its screen matrix (the world matrix under the cut's own camera, lens ∘ shot, zoomed by `SLACK` = 1.2 for a rig and a
  punch), each draw counted by the bounding box of its rect within the frame: a direct-path body, echo or tint by its
  ink (`draw.inkEm`: 0.66 em either side of the centre, where descenders and emoji reach under `textBaseline`
  'middle', plus half the outline, or the shadow's or duo's larger offset; or half the cell, if larger); a sprite by the
  rect `spriteAt` draws at 720p or larger (level ≤ 2, shards and the mosaic whole; level ≥ 3 from its box's left edge
  to the ink plus the clip's pad). It is at least what is drawn: `glyph_parity.py` compares it with the lab's sprite
  meter on every frame, and holds every measured ink rect (the fonts, styles and sizes of its check 3) to `inkEm`.
- **Samples:** every 1/30 s over the phase's window (at most 40; a hold 16).
- **Share:** at every sample the phase may add at most `SHARE` = 2 frames of cover over the same cut with the material's
  masks all on (its text as it is without the material's sprite columns and size changes). A phase within it counting
  the text itself is left as made.
- **Ladder** (`BH.masked` on the material's behaviours, nodes of the text only): take back the tint; then the echo; then
  the glow; then everything that puts a glyph on the sprite path (blur, shards, the mosaic); then its size (sx, sy, z).
  The first step that fits is kept; each step takes back more, so the cover never grows along it, and the last adds
  nothing. A mask puts back the values the masked columns had before the behaviour ran, so other parts' poses stay.
- **Record:** `scene.spriteBudget = { share, arrive?, dwell?, depart? }`, each `{ key, added, fitted, step, masks }`.

A cut's window overlaps only its neighbours' (by lead + tail), so where the slots hold materials their glyphs cover at
most 2 · `SHARE` = 4 frames more than the same text without them; perf.py's camerawork + materials row, with the
heaviest glyph work §5.8 admits in every entrance, hold and exit, keeps within twice the frame budget (numbers in
NOTES). It is a pure function of the scene as built (du, no clock, the scene's live pose, matrices and alphas put back),
covered by the cut's fingerprint, the same for every output size, so preview equals export. Parts of the catalog are
never masked: documents without materials are unchanged. The fit costs about two evaluations of the scene per sample
of an over-share phase (≈ 2 ms a cut with the heaviest materials).

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
- `ui/stage` draws markers ①②③ on its overlay canvas where each key places its aim (from `engine.shotTrack`). Markers
  that fall on one another (keys aimed at the same point, such as pushWord's keys on a line without emphasis) are fanned
  out to the right so each can be grabbed. Dragging a marker sets `ox`/`oy` (free), and the wheel sets `fill`. The
  markers disappear when the page closes.
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
7. **Media** (§11.5.11):
   - media time is closed-form in `t`;
   - the source frame is chosen by pure arithmetic;
   - export draws exact frames only;
   - still tiers are fixed per scene and output scale.

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
| Draw | ≤ 400 particles guaranteed by `mixShare`; filter stacks ≤ 6 passes; material text phases add ≤ `SHARE` = 2 frames of glyph cover each, ≤ 4 in a frame (§5.9.5); the adaptive preview is unchanged; export never degrades |
| Glyph sprites and post (§3.10) | sprites rasterize when made (prepare); a raster drawn scaled up is clipped round its ink (identical pixels); filters draw on the stack's own surface; a seam's surfaces are made in prepare. perf.py's camerawork + materials row (the heaviest text materials): p95 ≤ 2 × 16.7 ms (numbers in NOTES) |
| Static ground raster | ×1.25 only for `zoomed` segments; still ≤ the 24 MB cap at 1080p; 4K draws live (existing rule) |
| `direct` request build and validation | O(area lines), < 2 ms for 100 lines; prompt ≈ 1.5–5 k tokens (primitives text only with materials allowed) |
| Media (drawing, decoding, import, export overhead) | §11.5.12 |

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
| `budget.test.js`, `sprites.test.js` (new) | B | masked behaviours put back exactly the masked columns of the masked nodes; `glyphCover` takes `drawGlyph`'s path and sprites; the fit: no budget without materials, every material phase within `SHARE` (or fully masked) with the step before over it and the ladder monotone, evaluated directly; the same records and frames from two engines and every output size. Sprites: ink rects of every level, rasters equal to those without `inkBox`, clipped draws that are the unclipped calls inside a clip (`inkClip`: none, all sides, open where rows start), shards and mosaics as before, settle, the sliced warm-up |
| `camera_planner.test.js` (new) | D | determinism over the corpus; `amount.camera = 0` → all `none` and rigs `none`; impact cuts favour snapZoom (≥ 60 %); echo: repeated lines share shots (≥ 80 %; the §4.7 constants reach about 55 % over the corpus, NOTES "Step (b)"); the moving shots of a video vary (no preset takes most of them, no long runs of one); framing lens → `none` ≥ 70 %; `cam: 'none'` arranges never get auto shots; carry only within lines; rig runs follow sections; last chorus `slowBloom`; stability (insert a line → ≤ 4 other cuts' shots change; reroll a cut → ≤ 3); **documents without new pins keep every v2 part choice** |
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
| `perf.py` (+) | B | project_long with auto camerawork plus the heaviest allowed material in every slot (the text slots: the heaviest glyph work §5.8 admits; the others: the sample materials): behave + solve ≤ 0.8 ms p50 at 720p; frame ≤ 2× budget; no material phase over its glyph share (§5.9.5) |
| `parts_gallery.py` (+) | B | shot and rig thumbnails in every aspect; 0 CSP violations |
| `materials_gallery.py` (new) | C | `sampleDefs` and 12 generated materials × aspects: no console errors, not blank, 0 CSP violations |
| `ui_flows.py` (+) | F | curve widget drag = one undo step; preset → custom via a handle; keyframe edit → custom pin → プリセットに戻す; area band click → multi-line page with the area header; **flow "area direct"**: faked analysis → click サビ1 → target chip → faked answer (run-ornament material, speed 0.5, ramp curve, pushIn custom shot) → review with 4 groups → try-on → apply → preview renders the material → マイ素材 tile exists → undo restores materials and pins → redo → selective revert → delete material (pins cleared); board with 2 areas; keyboard-only variant |
| `ui_layout.py` (+) | F | curve widget, keyframe editor, board and material page fit 288–352 px; control budgets unchanged; nothing covers the preview |
| `csp.py`, `i18n_pages.py` (+) | F | the new flows cause no CSP violations; the en page has no Japanese UI text (material names excepted) |

Tests of the later additions: media §11.8, package §12.8, Filmora §13.12.

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

**Step (c): media parts** (after G.3 lands `photoFrame`, `textFill` and `mediaLayer`).
- The base registry's version changes, so every plan hash changes. Regenerate `plan_hashes.json`.
- The frame op hashes of fixtures without media must stay equal, which is asserted first. `photoPan` is pool-only, so no
  automatic choice changes.
- New goldens: `project_media.json` (the A.3 fixture), which holds a still background, a `photoFrame`, a `textFill` and a
  video background. It renders with `fake_media.js`, and its op hashes include media times (§11.3.7).

---

## 8. Work packages

**Order:**
```
A (contracts) ──► B (engine) ──┐
            ├──► C (materials runtime; needs B's env.mixShare only as an optional field) ─┐
            ├──► D (planner) ──┼──► integration: goldens (a), (b), visual QA
            ├──► E (AI) ───────┤
            └──► F (UI; starts on A, consumes B–E interfaces as they land) ──┘

Media, package, Filmora (§11–§13):
A.3 (media contracts) ──► G.1 (pure media + host decode/store + IndexedDB + package) ──┐
                     ├──► B.3 (engine media hooks, `layers` option) + B.4 (AAC → Opus) ──┼──► G.3 (parts) ──► G.4 (UI, after F)
                     ├──► C, D, E media items (§8.3–§8.5) ─────────────────────────────┘
                     └──► H.1 (WebM writer, subtitles: pure; any time after A.3)
G.1 + B.3 + B.4 ──► H.2 (WebM alpha, kit, sinks) ──► H.3 (step ④ UI, after G.4) ──► integration: goldens (c), Filmora check
```

**Shared-file rules:**
- `docs/NOTES.md` is append-only. Each package appends one `## v2.1-<letter>` section.
- `tests/golden/*` is regenerated by the lead only.
- `i18n/strings.js` is written by **A**: every key of §6.11, and the keys of §11.7.11, §12.7 and §13.10 (all in A.1).
  After A.1 lands, it passes to **F**. Other packages request additions under "strings wanted" in NOTES.
- Files that A touches for compatibility and that belong to other packages later (`ui/fields.js`, `ui/widgets.js`,
  `parts/mix.js`) are handed over only after A has merged. Ownership never overlaps in time.
- **Handovers for §11–§13** (each happens only after the previous owner has merged):
  - F's UI files (`ui/fields.js`, `widgets.js`, `inspector.js`, `part_browser.js`, `stage.js`, `boot.js`, `palette.js`)
    go to G for G.4.
  - `ui/menus.js` goes to G (G.4), then to H (H.3, the SRT item only).
  - `export/host/mp4.js`, `export/host/png.js` and `export/schedule.js` go from B (B.3, B.4) to H (H.2).
  - `export/zip.js` goes from G (G.1, `addBlob`) to H (read-only use).
  - `ai/direct.js` and `ai/recipe.js` stay with E, which implements their media fields from §11.6.
- Every PR ends with the clean-room line of D§1.4.

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

**Media additions (§11–§13; ≈ +700 LOC incl. tests):**
- **In A.1,** so that schema 2 ships once:
  - `doc.media` (default, `ORDER`, `normalize`, structural `validate`, `touched`) and the `MIGRATIONS[1]` line (§11.2.2);
  - `output.format` `kit` and `webmAlpha`, and `output.kit` (§13.3);
  - every string of §11.7.11, §12.7 and §13.10, written together with the §6.11 keys, because `strings.js` passes to F
    after A.1.
- **A.3** (after A.2; G and the media items of B–E start on it):
  - new `src/core/media.js` (§11.3.2);
  - `core/schema` type `media` (§11.2.3);
  - `core/commands` `media.put`, `media.meta`, `media.move`, `media.remove`, `media.relink`, and `output.set kit`
    (§11.2.5, §13.3);
  - `core/registry` key rule `myMed` (§3.6);
  - `core/recipe` layer `prim: 'media'` with its limits and cost (§11.5.8);
  - `core/types` typedefs for AssetEntry, MediaMeta, TimeSpec, FitRect, AssetStore and MediaFrame;
  - tests `media_core.test.js`, `media_doc.test.js` and additions to `schema`, `registry`, `commands`, `doc`,
    `recipe` and `i18n`;
  - fixture `tests/fixtures/project_media.json` (schema 2: four assets (a PNG with alpha, a JPEG, an MP4, a WebM with
    alpha), `photoPan` and `photoFrame` pins, one pooled asset, `output.kit`).
- **Acceptance:**
  - schema-1 fixtures migrate with `media: { list: [] }`, and their pins are byte-identical;
  - every media reducer is undo-exact over 500 random sequences;
  - `i18n.test.js` covers every new key.

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

**B.3 — media engine hooks (§11.3.7; after A.3; ≈ +900 LOC incl. tests):**
- **Files:**
  - `engine/scene/builder.js` (`sb.media`) and `build.js` (`svc.media`, `env.media`, `scene.media`);
  - `engine/render/shapes.js` (`drawMedia`), `draw.js`, `renderer.js` (`dc.t`, `dc.backdrop`, `layers: 'ground'`,
    `mediaAt`, `FrameStats.media`) and `record.js` (media ops);
  - `engine/facade.js` (`mediaAt`, `mediaReady`, `fork({ assets })`, the export exactness throw, poster-only thumbs);
  - `parts/kit.js` (`K.media`, `K.mediaParams`, `K.MEDIA`, `runKenBurns`);
  - `export/host/mp4.js` and `export/host/png.js`: the frame loops await `e.mediaReady(t)`. B owns these files through
    B.4, then hands them to H;
  - `ui/lab.js` (`#media:` mode);
  - new `tests/helpers/fake_media.js`: an AssetStore with synthetic stills (coloured checkerboards), synthetic sample
    tables (any fps, VFR) and a sample index in `MediaFrame.index`, so op hashes show the chosen source frame;
  - new `tests/node/media_engine.test.js`; `parts_gallery.py` media mode.
- **Interfaces used:** A.3 `core/media`.
- **Interfaces provided:** §11.3.6 (the AssetStore contract), §11.3.7, §11.5.1–§11.5.6.
- **Acceptance:**
  - `media_engine.test.js` passes;
  - frame op hashes of the fixtures without media are unchanged;
  - `mediaAt` costs ≤ 0.05 ms on project_long;
  - the export exactness throw is covered.

**B.4 — the MP4 must not be silent without AAC (§13.4; ≈ 80 LOC plus tests):**
- **Files:** `export/host/mp4.js` and `export/schedule.js`, owned by B for this item only and handed to H afterwards;
  `tests/node/export_math.test.js` (+); `tests/browser/export_check.py` (+).
- **Change:** `audioConfig` tries AAC-LC (`mp4a.40.2`, 192 kbps), then Opus (`{ codec: 'opus', sampleRate, numberOfChannels: 2,
  bitrate: 160000 }`, where `sampleRate` is the song buffer's rate). Songs are always decoded at 48 kHz
  (`audio/host/decode.DECODE_RATE`), so that rate is 48000 and no resampling is needed; a buffer at another rate is never
  fed at the wrong speed.
  - `muxCodec('opus') → 'opus'`, which mp4-muxer supports (its `Opus` sample entry with `dOps`).
  - `probe()` returns `audioCodec: 'mp4a.40.2' | 'opus' | null`. `Result.audioCodec` is added.
  - `preflight` adds `opus-audio` (info) when the MP4 has sound and the codec is Opus. `no-audio-codec` is reported only
    when neither codec encodes.
  - Step ④ shows the note through the existing preflight list, with the string `exp.pre.opus-audio` (A.3). No step ④
    code changes.
  - `codecs.audioList` (tests only) overrides the order.
- **Test** (`export_check.py` and `export_math.test.js`; the §13.12 row):
  - with AAC unavailable (forced, and by default on local Chromium), the export has an Opus track;
  - `decodeAudioData` of the MP4 lasts N / fps ± 25 ms and is not silent;
  - the preflight shows `opus-audio`.

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

**Media additions (§11.5.8–§11.5.9; after A.3; ≈ +250 LOC):**
- `registryFor(base, materials, media)`: the derived `myMed` grounds for pooled assets, in the same `REG.extend` call,
  with the memo keyed by both lists.
- The interpreter of `prim: 'media'` layers through `K.media` when the kit exports it; otherwise the layer is skipped.
- `mine.media` lists the asset ids of a material.
- **Tests:** `mix.test.js` (+).
- **Acceptance:** `registryFor` with 64 materials and 200 assets (20 pooled) takes ≤ 4 ms.

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

**Media additions (§11.2.6, §11.5.9; after A.3; ≈ +300 LOC):**
- `plan.media`; `mediaTerms` in the cut `fp` and in `groundFp`.
- `splitSegments` breaks on a changed media source.
- Media param resolution with the `media-missing` and `media-kind` warnings.
- The derived-media rules: never for segments < 3 s or for `title`; why `media.pool`.
- `explain` and `fields` for media params (`why.media.pin`).
- **Tests:** `planner_media.test.js`.
- **Acceptance:** documents without media keep every plan value except the registry-version terms (goldens step (c)).

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

**Media additions (§11.6; after A.3; ≈ +450 LOC):**
- `ai/direct`: the `media` schema variant, the `[media]` list, the system paragraph and the mapping rows.
- `ai/recipe`: `AI_LAYER.media`.
- New `src/ai/vision.js`: `visionRequest`, `visionChanges` and `VISION_SCHEMA`.
- `ai/changes`: the Change kind `media` (→ `media.meta`), with revert.
- **Tests:** `ai_direct.test.js` (+), new `ai_vision.test.js`, and the portability list (+).
- **Acceptance:** every media mapping row is covered, and no request carries pixels except `visionRequest`'s image
  parts.

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

**Media note:** F builds no media UI. After F merges, the files listed in the handover rule pass to G (G.4) for the
edits of §11.7. F keeps the ownership of `i18n/strings.js` from A, and adds the string requests of G and H under
"strings wanted".

### 8.7 Package G — images and videos, the project package (≈ 7,000 LOC incl. tests; 2 engineers: G-runtime, G-UI)

**Files owned:**

| Drop | Kind | Files |
|---|---|---|
| **G.1** (after A.3) | New | `src/core/sha256.js`; `src/media/{sniff,isobmff,matroska,samples,palette}.js`; `src/media/host/{probe,session,store}.js`; `src/export/unzip.js`, `src/export/package.js`; `tests/helpers/{media_gen,exif_write}.js`; `tests/fixtures/media/*` (with `MAKE.txt`); `tests/node/{sha256,media_demux,media_samples,media_palette,unzip,package}.test.js`; `tests/browser/{media_import,package_io}.py` (a test page assembled like `export_check.py`; the preview-frame check of `package_io.py` is enabled in G.3) |
| G.1 | Changed | `src/export/zip.js` (`addBlob`, `Blob` parts); `src/export/host/sink.js` (`write` accepts `Blob`; shared with H after G.1); `src/ui/project_io.js` (IndexedDB v2 stores, `putMedia`/`getMedia`/…, prune, persist, `clearDevice`, `savePackage`, `saveLight`, `openPackage`, sniff-based routing); `build.py` (`media/` → L1, `media/host/` → L6, `l1_group`); `tests/node/zip.test.js` (+); `tests/build_test.py` (+ layer rules) |
| **G.3** (after B.3) | Changed / New | `src/parts/ground/photo.js` (`photoPan` upgraded); new `src/parts/ornament/media.js`; `tests/browser/{media_exact,media_alpha}.py`; `determinism.py`, `perf.py`, `transparent_check.py` (+ media); inputs for goldens step (c) (the lead regenerates) |
| **G.4** (after F merges) | New | `src/ui/media_io.js`, `src/ui/media_page.js`, `src/ui/media_widgets.js`; `tests/node/ui_media.test.js` |
| G.4 | Changed (handover) | `src/ui/fields.js` (`media` and `trim` widgets, `sec.media`, the element page rows, `when` for the video rows), `widgets.js`, `inspector.js` (asset page, picker sub-pages), `part_browser.js` (`media` tab; derived keys hidden), `stage.js` (drop target, crop overlay, want/ready, placeholder), `boot.js` (media store → engine; `app.media`), `palette.js` (`>写真` actions), `menus.js` (≡ › ファイル, §12.7), `step_look.js` (hint text only), `style.css`; browser `ui_flows.py`, `ui_layout.py`, `csp.py`, `i18n_pages.py` (+) |

**Interfaces used:**
- A.3: `core/media`, the type `media`, `media.*` commands, and the strings.
- B.3: `sb.media`, `K.media`, `K.mediaParams`, the facade media members, `fake_media.js`.
- C: `registryFor(…, media)`, needed for おまかせ; before C, pooled assets are simply not offered.
- D: `plan.media`; before D, G's tests build plans by hand.
- E: `visionRequest` and the direct media field; the UI hides them until E lands.
- H.1: `export/webm`, used by the WebM fixtures and the round-trip tests. H.1 is small and pure, and lands before
  G.1's WebM tests.

**Interfaces provided:** §11.3.3–§11.3.6 (the real AssetStore), §11.4, §11.7, §12.

**Acceptance:**
- Every §11.8 and §12.8 test is green.
- **`media_exact.py`:** every output frame shows the expected source frame at 24, 30 and 60 fps, for VP9 MP4, WebM,
  H.264 (Chrome CI) and VFR.
- `determinism.py` with media passes.
- The perf rows of §11.5.12 are met on the reference laptop, and the measured figures are in NOTES.
- A package round trip with a PNG, a WebM, an MP4 and a WAV is byte-exact.
- A corrupted package opens with the damaged asset missing.
- v2.0 `.json` files open.
- 0 CSP violations.
- The top-level control budgets are unchanged.

### 8.8 Package H — editor-ready output: transparent WebM, the Filmora kit, subtitles (≈ 2,800 LOC incl. tests)

**Files owned:**

| Drop | Kind | Files |
|---|---|---|
| **H.1** (after A.3) | New | `src/export/webm.js`, `src/export/subtitles.js`; `tests/node/{webm,subtitles}.test.js` |
| **H.2** (after G.1, B.3, B.4) | New | `src/export/host/webm.js`, `src/export/host/kit.js`; `tests/browser/{webm_check,kit_check}.py` |
| H.2 | Changed | `src/export/host/mp4.js` (after B.4: the `layers` and backdrop options through `openJob`, reuse by the kit), `src/export/schedule.js` (after B.4: `pickVp9`, `kitFiles`, the §13.10 preflight codes, `FORMATS`, `backdropFor`), `src/export/host/sink.js` (`openDirectory`, `createDirSink`), `src/audio/wav.js` (`encodePcm16`), `src/ui/project_io.js` → `lrcText` delegates to `export/subtitles.lrc` (after G.1); `tests/node/export_math.test.js` (+) |
| **H.3** (after G.4) | New | `src/ui/filmora_help.js`; `docs/FILMORA.md` |
| H.3 | Changed | `src/ui/output.js` (`FORMATS`, the coupling rules of §13.3), `src/ui/step_export.js` (the 形式 control, the kit contents, summary, done state, guide link), `src/ui/menus.js` (`file.saveSrt`); browser `ui_flows.py`, `ui_layout.py`, `csp.py` (+) |

**Interfaces used:**
- A: `output` additions, strings.
- B.3: `layers: 'ground'`, `mediaReady`, `fork({ assets })`.
- B.4: `audioConfig` and `probe` with Opus.
- G.1: `addBlob`, `Blob` sinks, `media/matroska` (the round trip test).

**Interfaces provided:** §13.3–§13.11 (`createWebm` FROZEN for the tests' fixture generator, §11.8.1).

**Acceptance:**
- Every §13.12 test is green.
- The WebM decodes with alpha in Chrome, and our demuxer reads it back exactly.
- A kit of project_basic writes every file, with the MP4 checked at CFR, key frames and AAC (Chrome CI) or the WAV
  fallback.
- Step ④ keeps ≤ 5 controls.
- The manual Filmora checklist (§13.12) is done, and its results are in NOTES; ✗ rows are fixed or documented in
  `FILMORA.md`.

### 8.9 Integration (lead, not a package)

1. Wire the full stack and run every Node and browser test.
2. Goldens step (a).
3. Visual QA of auto camerawork and rigs (§7.5), then tune the §4.7 constants and regenerate goldens step (b).
4. Walk the three user stories by hand:
   - 「サビだけ桜で、カメラはゆっくり寄る」 via 区画▾ → apply → undo;
   - 「Aメロは動きをスローに」 via the board;
   - 「最初と最後は一瞬遅く、途中はすごく速い」 on a line's entrance and camera via the curve widget's かんたん form.
5. Goldens step (c) (media parts). Then walk the media stories by hand:
   - drop a phone video (HEVC or H.264, rotated) on the preview → background → trim → export 1080p60 → check in a
     player that it moves with the song;
   - サビだけ写真の背景 via the asset page's 選択中 button with an area selected;
   - a transparent PNG as a 写真の枠 cut-out;
   - 文字の中に with a video;
   - save a package, clear the device, open the package;
   - the Filmora kit into Filmora (the §13.12 checklist).
6. Add a one-line pointer at the top of DESIGN.md: 「v2.1 additions: see DESIGN_2_1.md」.

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
| §2.1, §2.3, §2.6 | new directories `src/media/` (L1) and `src/media/host/` (L6); layers of `core/media`, `core/sha256`, `export/webm`, `export/unzip`, `export/package`, `export/subtitles`, `export/host/webm`, `export/host/kit`; `build.py.layer_of` and `l1_group` rules (§11.3.1). The CSP is **unchanged** (§11.4.11). | lead, WP0 |
| §3.1–§3.2 | `doc.media` in schema 2 (no schema 3); `output.format` `kit` and `webmAlpha`; `output.kit` (§11.2.2, §13.3) | WP0, WP1, WP6, WP8 |
| §3.9 | commands `media.put`, `media.meta`, `media.move`, `media.remove`, `media.relink`; `output.set kit` (§11.2.5) | WP1, WP7, WP8 |
| §3.12 | `plan.media`; `mediaTerms` in the cut `fp` and `groundFp`; segment break on a changed media source (§11.2.6) | WP3, WP4 |
| §3.13 | warnings `media-missing`, `media-kind`; why `media.pool`, `media.pin` | WP3, WP8 |
| §4.2 | ParamSpec type `media` (§11.2.3); the enum field `optKey` (§3.5, §11.9.1) | WP0, WP3, WP5, WP8; `optKey`: lead |
| §4.6 | the `myMed<10 hex>` key rule; `extra[key].media` (§11.5.9) | WP0, WP3, WP5 |
| §4.17.3, §4.17.5 | `sb.media` and its record; `env.media`; `scene.media` (§11.5.1) | WP4, WP5 |
| §4.18.1–§4.18.3 | kit exports `media`, `mediaParams`, `MEDIA`; needs value `'media'`; `photoPan` params and label (§11.5.6–§11.5.7) | WP4, WP5 |
| §4.19.2, §4.19.4 | `renderFrame` options `layers: 'ground'`; `dc.t`; `sceneOnly` media per backdrop (§11.4.10) | WP4, WP6 |
| §4.20 | `AssetStore` contract (`frame`, `want`, `ready`, `has`, `info`, `on`, `fork`, …); facade `mediaAt`, `mediaReady`, `fork({ assets })`, `FrameStats.media`, `EngineError('media-not-ready')` (§11.3.6–§11.3.7) | WP4, WP6, WP8 |
| §4.21 | export frame loops await `mediaReady`; AAC → Opus fallback in MP4 (`probe().audioCodec`, `opus-audio`); formats `webmAlpha` and `kit`; `pickVp9`; sinks take `Blob` parts and directories; `zip.addBlob` (§13) | WP6, WP8 |
| §4.22 | `direct` media schema variant and mapping; tool `vision`; Change kind `media` (§11.6) | WP7, WP8 |
| §4.22.6 | the vision consent (images only, Gemini only, per asset and project) | WP7, WP8 |
| §6.4.3, §6.4.12, §6.14 | step ③ hint text; step ④ 形式 control (a segmented pair plus a select) and the kit contents; ≡ › ファイル items; IndexedDB v2 stores (§11.7, §12.7, §13.10) | WP8 |
| SPEC §7 | the project file is a package (`.mojipv`) by default; the light `.json` save is kept (§12) | owner (decided) |

Everything is additive or widened: no existing path, pin or command changes meaning. Documents without the new pins or
materials produce the same part choices as v2. Their plan hashes differ only by the new default params and slots, and
their frames differ only by automatic camerawork (goldens step (b)). Documents without media pins also keep every
frame; their plan hashes change only through the registry version (goldens step (c)).

---

## 10. Out of scope for v2.1 (later)

- A cross-project material library (localStorage) and 「ライブラリから追加」.
- Theme recipes (swatch overrides).
- Named shot or curve materials (a `mat:` reference form for `cam.shot` / curves).
- AI-written raw keyframes: the AI uses presets or `fromMove`, and raw keys are a UI feature.
- A preview-only 「カメラの動きを抑える」 setting (≡ › 表示, like 点滅を抑える): scaling shot and rig deltas by 0.3 in
  preview only, never in export. It is a comfort option to consider after visual QA.
- **Media, later:**
  - seek-friendly proxies: re-encoding long-GOP or 4K clips to intra-heavy 1080p at import, with `VideoEncoder`;
  - reverse and ping-pong playback of video;
  - frame interpolation for slow motion;
  - mixing the video's own audio with the song;
  - HEIC decoding;
  - vision with the second AI service;
  - SVG kept as vector;
  - per-cut media keyframes (a crop that moves by keys);
  - a cross-project media library.
- **Output, later:**
  - ProRes 4444 MOV, which needs an encoder that browsers do not have;
  - JPEG sequences for Filmora's image-sequence import;
  - an FCPXML or EDL timeline for the kit;
  - HDR export.

---

## 11. Images and videos (写真・動画)

The owner's request (verbatim): 「次のバージョンで画像・動画読込で扱える版を作成してください」. This section is the design for
that request. §12 adds the single-file project package, and §13 adds editor-ready output (Filmora). The new work is in
**package G** (§8.7) and **package H** (§8.8), plus media items in packages A–E (§8.1–§8.5).

### 11.0 Decisions at a glance

1. **Assets are addressed by their content.** An `AssetId` is `'a'` followed by the first 24 hex digits of the SHA-256 of
   the file's bytes. The document stores metadata only (`doc.media`, part of schema 2). The bytes live in IndexedDB, as
   songs do, and in the `.mojipv` package (§12).
2. **Using an asset means choosing a part and setting a part param of the new ParamSpec type `media`.** There is no new
   slot kind and the path grammar does not change.
   - Backgrounds use the ground slot through `photoPan`, which is upgraded.
   - Frames, text fills and overlay footage are three new ornament parts.
   - All of these can be pinned at work, area (line) and cut scope. They can be undone, copied, set by the AI and
     explained, like any other part.
3. **Frame-exact video comes from WebCodecs `VideoDecoder`, fed by demuxers we write ourselves.** The demuxers cover
   MP4, MOV and fragmented MP4, plus WebM and Matroska. They are pure L1 modules. Rendering never uses a `<video>`
   element.
   - Media time is closed-form in `t`.
   - The source frame is picked by pure arithmetic on the sample table.
   - Export waits for the exact decoded frame before it draws.
4. **Preview and export take the same path.** While the exact frame is still decoding, the preview may show the nearest
   decoded frame. That frame is marked provisional and drawn again once the exact one arrives. Export never does this:
   the facade throws if it is asked to draw a frame that is not exact.
5. **Stills become `ImageBitmap`s** in fixed size tiers. EXIF orientation is applied and colour is converted to sRGB.
   Animated GIF, WebP and APNG files go through `ImageDecoder` and play like small silent videos.
6. **The CSP does not change.** No Worker ships, and no third-party code is added (§11.4.12).
7. **おまかせ uses the user's photos and videos as backgrounds only when the user allows it,** by ticking
   おまかせでも使う on that asset. Such an asset is registered as a derived ground part through `REG.extend`, the same
   way materials are (§5.9).
8. **AI** (all optional):
   - The `direct` tool can place an asset from the list it is given.
   - An optional Gemini vision request describes images and picks colours. It needs consent per asset and sends only a
     downscaled JPEG.
   - A local palette extractor matches colours without any AI.
9. **UI:** no new top-level control.
   - Files can be dropped anywhere. Dropping on the preview uses the file as the background at the selected scope.
   - New places for media: the 作品全体 › 写真・動画 library, an asset page, a media widget, a crop overlay on the stage
     and a trim widget.

### 11.1 What users can do

#### 11.1.1 Accepted files

| Kind | Formats | Decoded by | Notes |
|---|---|---|---|
| Still image | PNG, JPEG, WebP, AVIF | `createImageBitmap` | EXIF orientation applied. ICC or other colour converted to sRGB. Alpha kept. |
| Animated image | GIF, animated WebP, APNG | `ImageDecoder` | ≤ 600 frames, long side ≤ 2048 px. Plays like a silent video; looping is the default. Without `ImageDecoder`, only the first frame is used and a note says so. |
| SVG | rasterized once at import | `<img src=blob:>` drawn to a canvas at 4096 px on the long side | The rasterized PNG becomes the asset; the SVG is not kept. An image-mode SVG runs no script and loads nothing. If the canvas becomes tainted, the file is refused. |
| Video | MP4, M4V, MOV (ISO BMFF) with H.264, HEVC, VP9 or AV1; WebM or MKV with VP8, VP9 or AV1 | our demuxer + `VideoDecoder` | HEVC is accepted only where this browser decodes it; the asset gets a portability badge (「一部のパソコンでは読めない形式です」). WebM VP8 and VP9 with alpha are supported (§11.4.10). |

**Refused files.** The message always says what to do instead.
- HEIC and HEIF photos: 「HEIC は読めません。JPEG に変換してから読み込んでください（iPhone: 設定 › カメラ › フォーマット ›
  互換性優先）」.
- Any video codec that `VideoDecoder.isConfigSupported` rejects, such as ProRes, DNxHD or MPEG-2. The message names the
  codec.
- Files over the limits (§11.2.8).
- Files whose type the sniffer does not recognise.

**The video's own audio** is ignored, so the song stays the only audio. One explicit action, 「この動画の音を曲にする」, loads
the video file through the existing song path (D§4.13 `loadSong`; `decodeAudioData` reads the audio of MP4 and WebM
files). It is offered only when the file has an audio track (`entry.audio`).

#### 11.1.2 Uses

| Use (ja / en) | Part (kind) | How it is pinned (any scope: `work`, every line of an area, `line/<id>`, `cut/<key>`) | Notes |
|---|---|---|---|
| 背景 / Background | `photoPan` (ground, upgraded) | `…:ground = photoPan` and `…:ground@photoPan.image = <id>` | Continuous across its segment. A segment breaks where the source changes (§11.2.6). |
| 写真の枠 / Photo frame | `photoFrame` (ornament, scope `cut`) | `…:ornament#i = photoFrame` and `…:ornament#i@photoFrame.src = <id>` | Rectangle, rounded, circle or arch mask, or the image's own alpha (a cut-out). Border, stepped shadow and tilt. |
| 文字の中に / Inside the text | `textFill` (ornament, scope `cut`) | `…:ornament#i = textFill` and `…@textFill.src` | The media shows through the glyphs: the text works as a window. |
| 重ねる映像 / Overlay footage | `mediaLayer` (ornament, scope `run` = atmos) | `…:atmos = mediaLayer` and `…:atmos@mediaLayer.src` | Blend modes screen, multiply, overlay and normal. Above or behind the text. Drawn only with the normal backdrop. |
| 素材の中 / In a material | recipe layer `prim: 'media'` | inside `doc.materials` (§11.5.8) | A reusable frame style that works with any photo. |
| おまかせの背景 / Auto background | derived ground `myMed<10 hex>` | the planner picks it (§11.5.9) | Only assets with おまかせでも使う ticked. |
| 色を写真に合わせる / Match colours | — | palette pins (`work:color.accent`, `shiftA`, `shiftB`) | Local extraction, no AI (§11.6.3). |
| 曲にする / Use as the song | — | `song.set` | Only videos with an audio track. |

An **area** (§3.8) is placed by pinning every line of the area, which is the same rule the AI uses (§5.5 "Target of
`all`"). The asset page and the AI can do that in one batch.

#### 11.1.3 Controls

Every control is a part param (the table is in §11.5.6), so it gets a widget, a pin, undo and "why" for free.
- **Framing:**
  - fit: 覆う (cover) / 全体を映す (contain) / 全体＋ぼかし余白 (contain with a blurred cover copy behind);
  - crop: a zoom plus a focus point, adjusted on the stage;
  - edges: how the bleed area around the frame is filled.
- **Motion (Ken Burns):** push in, pull out or drift, with an amount and a direction.
- **Look:** blur; veil (薄幕), whose colour can be the ground colour, black (this is "dim"), white or any colour; tint
  (色味) with its own colour.
- **Video and animation only:**
  - the range used (in and out, set with the trim widget);
  - speed ×0.25–4;
  - what happens at the end: loop, or hold the last frame;
  - the clock: 表示したときから (restarts each time the element appears) or 曲に合わせる (continuous with the song).

### 11.2 Data model

#### 11.2.1 Asset entry (FROZEN)

```json
{ "id": "a3f9c2d17b0e4a5c6d7e8f901", "kind": "video", "name": "海辺.mp4", "mime": "video/mp4", "bytes": 48213344,
  "w": 1920, "h": 1080, "dur": 12.512, "fps": 29.97, "frames": 375, "rot": 0, "alpha": false, "anim": false,
  "audio": true, "codec": "avc1.640028", "color": "bt709", "hdr": false, "pv": 1, "pool": false, "ai": null }
```

| Field | Meaning and rule |
|---|---|
| `id` | `^a[0-9a-f]{24}$`: the first 12 bytes of the SHA-256 of the stored bytes, as hex. For an SVG, the stored bytes are the rasterized PNG. |
| `kind` | `image` or `video`. An animated image has `kind: 'image'` and `anim: true`. |
| `name` | Display name, initially the file name. 1–80 characters with no control characters. User data, so the en page may show Japanese. |
| `mime` | The sniffed type (§11.3.4), not the browser's guess. |
| `bytes` | Size of the stored bytes. |
| `w`, `h` | Displayed size in px **after** orientation: EXIF for images, the track matrix for videos. |
| `dur`, `fps`, `frames` | Video and animation only (`null` for stills). `dur` is the presentation duration in seconds (q3). `fps` is the nominal rate, 1 / median frame duration (q3). `frames` is the sample count. |
| `rot` | 0, 90, 180 or 270. Video only: the track-matrix rotation that drawing applies. Images are decoded already upright, so their `rot` is 0. |
| `alpha` | `true` when some pixel can be transparent (§11.4.10). |
| `anim` | `true` for animated images. |
| `audio` | `true` when a video file also has an audio track. |
| `codec` | WebCodecs codec string for videos; `null` otherwise. |
| `color` | One of `srgb`, `bt709`, `bt601`, `bt2020`, `p3`, `other`. |
| `hdr` | `true` for PQ or HLG transfer. |
| `pv` | Probe version, `core/media.PROBE_V` (1). A newer probe may re-read metadata; §11.2.9 says when. |
| `pool` | おまかせでも使う: the planner may pick it as a background (§11.5.9). Default `false`. |
| `ai` | `null`, or the result of the vision tool (§11.6.2): `{ caption: { ja, en }, tags: [tag], colors: ['#RRGGBB' ≤ 5], subject: Box01 \| null, text: Box01 \| null }`. `Box01 = { x, y, w, h }` as fractions of the displayed image. |

Metadata is derived from the content, and the id names the content. So two documents that share an id share the same
metadata for the same `pv`.

**No poster in the JSON.** Posters and filmstrips live in the `thumbs` store (§11.2.7) and in the package (§12.2). This
keeps the document, and therefore every autosave, small.

#### 11.2.2 `doc.media` (schema 2; coordinated with §2.1–§2.2)

- `doc.media = { list: AssetEntry[] }`, in library order (the order of import; the user can move entries).
  - At most 200 entries.
  - The canonical JSON is at most 96 KB.
  - Ids are unique.
- **No new schema number.** `doc.media` is part of schema 2, so v2.1 ships one bump.
  - `MIGRATIONS[1]` also adds `media: { list: [] }`, next to `materials`.
  - If A.1 has already merged schema 2 without `media` when this lands, `normalize` fills a missing `media`. A schema-2
    file without `media` then opens, and there is no schema 3.
- **`core/doc` additions:**
  - `ORDER.doc` becomes `…, 'filters', 'materials', 'media', 'output'`.
  - `ORDER.media = ['list']`.
  - `ORDER.asset` is the field order of §11.2.1.
  - `ORDER.assetAi = ['caption', 'tags', 'colors', 'subject', 'text']`.
  - `defaultDoc().media = { list: [] }`.
- **`validate` adds structural checks only:**
  - `media` is an object and `list` an array;
  - every entry passes `core/media.entryProblems` (types, ranges, the id pattern, unique ids);
  - the caps hold.

  Unknown `pv` values are kept.
- `touched(a, b)` gains `media: a.media !== b.media`.
- The `output` additions of §13 (`format` values `webmAlpha` and `kit`, and `output.kit`) are also schema 2. They are
  listed in §13.3.

#### 11.2.3 ParamSpec type `media` (D§4.2 addition; FROZEN)

```js
ParamSpec += { type: 'media', accept: 'image' | 'video' | 'any' /* default 'any' */, auto: { value: '' } }
```

- `coerce(spec, v)` returns `''` for `''`, returns `v` for a string matching `^a[0-9a-f]{24}$`, and returns `undefined`
  for anything else.
- `baseValue` is `''`.
- `validateSpec` requires `auto` to be a constant `{ value }` whose value coerces: `''` in catalog parts; an AssetId in
  the derived `myMed` parts, which set it through `K.variant` (§11.5.9). A media param is never picked or ranged.
  `accept` must be one of the three values.
- `describeAuto` gives `なし` / `none`.
- Media params are `ai: false` in the catalog. The AI reaches them through the `direct` tool's `media` field (§11.6.1).
- `TYPES` gains `'media'`.
- `ui/fields.widgetFor` maps `media` to the `media` widget (§11.7.5).

#### 11.2.4 References

An asset is referenced in exactly three ways:
1. **A pin whose value is the id,** on a param of type `media`. Examples: `work:ground@photoPan.image`,
   `line/r7:ornament#1@photoFrame.src`.
2. **The derived key `myMed<id[1..10]>`,** for assets with `pool: true`:
   - as a pin value (`line/r7:ground = "myMed3f9c2d17b0"`);
   - as the `@key` of a part-qualified pin (`work:ground@myMed3f9c2d17b0.blur`);
   - in an avoid list (`"ground.myMed3f9c2d17b0"`).
3. **A `src` inside a material recipe layer** with `prim: 'media'` (§11.5.8).

`core/media.refsOf(doc, id)` returns `{ pins: path[], materials: materialId[] }`. It compares strings only and needs no
registry. The reducers, the library's 使用 n count and the delete dialog all use it.

#### 11.2.5 Commands (FROZEN payloads; D§3.9 additions)

| Command | Payload | Effect |
|---|---|---|
| `media.put` | `entry` | Adds the entry at the end of the list. If the id exists, it replaces the metadata (`kind` must match). Refused (`CommandError('payload')`) when `entryProblems` reports a problem or a cap would be exceeded. An unchanged entry returns the same doc. |
| `media.meta` | `id, name?, pool?, ai?` | Updates only these fields, with the same validation. `ai: null` clears the vision result. |
| `media.move` | `id, before` (`null` = end) | Changes the library order. |
| `media.remove` | `id` | Removes the entry. It also removes every pin whose value is the id, every pin whose value is its derived key, every pin that is part-qualified `@myMed<…>` with that key, and the matching avoid items (an avoid list that becomes empty removes its pin). Material recipes are left unchanged: their media layers then draw nothing, and the planner warns `media-missing`. |
| `media.relink` | `from, entry` (`entry.id` = `to`) | Replaces one asset with another in one undo step. Adds `entry` if it is absent. Rewrites every pin value `from` → `to`. Rewrites every derived key and `@key` path of `from` to the key of `to`. Rewrites material recipe `src` values (each changed material is re-normalized, so its `rhash` changes). Then removes `from`. Refused when the kinds differ. |

- The reducers are pure. They call only `core/media` (L0), and `core/recipe` for recipes.
- The UI's 削除 action dispatches one `store.batch`: `media.remove` followed by `pin.clear` for every part pin whose
  media param has become empty (for example `work:ground = photoPan` with no image left). The UI knows the registry and
  the reducer does not. The confirmation says 「使っている{n}か所は元の見た目に戻ります」.
- Undo labels: `undo.media.put` / `.meta` / `.move` / `.remove` / `.relink`.

#### 11.2.6 Plan additions (D§3.12; additive to §2.7)

- **`plan.media = { [id]: MediaMeta }`**, where `MediaMeta = { kind, w, h, dur, fps, frames, rot, alpha, anim }`.
  - It holds every id referenced by a decision param of type `media` (cut slots, `grounds[].ground` and `.atmos`) or by
    a chosen material (`registry.extra[key].media`).
  - It is covered by the plan hash.
  - Scenes read it at build (`svc.media`), so a scene is a pure function of its plan and needs no host.
- **Fingerprints:**
  - The cut `fp` and `groundFp` add `mediaTerms` = sorted `[[id, H.hashJSON(meta)]]` for the ids their decisions use.
  - Ids are content hashes, so terms change only when `pv` re-probing changes the metadata.
- **Segments** (`planner/tracks.splitSegments`, D§4.16.6 amended):
  - Today a new segment starts where the pinned ground or atmos **key** changes. It now also starts where the resolved
    value of any `media`-typed param of the pinned ground or atmos part changes, compared by string.
  - Without this, two lines pinned to `photoPan` with different photos would share one segment and show the first
    photo.
  - Documents without media pins are unchanged.
- **Resolution:** a media param value goes through `coerce`, and then:
  - an id missing from `doc.media` gives warning `media-missing` (`detail: { id }`), and the value becomes `''`;
  - an entry whose kind does not fit `accept` gives warning `media-kind`, and the value becomes `''`.

  An empty `photoPan` is the plain ground. An empty `photoFrame`, `textFill` or `mediaLayer` builds nothing.
- **New warning codes** (D§3.13): `media-missing`, `media-kind`.
- **New why codes:**
  - `media.pool {name}`: おまかせで使うマイ写真;
  - `media.pin {name}`: the source of the inspector's media row.
- **Missing bytes are not a plan matter.** An entry whose blob is not on this device is a host state (§11.3.6
  `info(id)`), reported by the stage placeholder and the export preflight (§11.7.9).

#### 11.2.7 Storage on the device (IndexedDB; `ui/project_io`, D§6.14)

`DB_VERSION` goes 1 → 2. `onupgradeneeded` adds three stores and keeps `works` and `songs` as they are.

| Store | Key | Value | Notes |
|---|---|---|---|
| `media` | AssetId | `{ blob, mime, bytes, crc, name }` | `crc` is the ZIP CRC-32, computed at import in the same pass as the hash, so a package save needs no extra read (§12.3). |
| `mediaIndex` | AssetId | `{ v: INDEX_V, table: SampleTableData, track: TrackInfo }` | Video and animation only. It is a cache of the demuxer's work and can be rebuilt from `media`. |
| `thumbs` | AssetId | `{ v, poster: Blob (WebP, 320 px long side), strip: Blob (WebP sprite, 12 frames × 160 px) }` | Library tiles, preview placeholders and the trim filmstrip. Rebuilt when missing. |

- **Pruning** (extends `prune`):
  - An asset's blob, index and thumbs stay while any of these still references the id: the newest `RECENT` works, the
    current document, or this tab's `usedMedia` set (ids stored or read since the last load, because undo can bring
    them back).
  - Everything else is deleted, like songs.
  - Across tabs: a tab that stores a photo, video or song that no work record it wrote names yet (an import, a package
    open, a relink) holds the Web Lock `mojipv-assets` shared until its autosave names it. An asset that will not join
    the work is let go at once (unless the current document names it): a package open cancelled or refused after
    storing assets, つなぎ直す with a file that fits no missing asset or a declined question, 置き換える with a file of
    another kind, an import into a full library. While a toast offers 置き換える for the file, it stays held until the
    toast is closed. The next load lets go of every asset the loaded work does not name. `prune` deletes media and
    songs only when it gets that lock exclusively (`ifAvailable`), reading the works again under it; without Web Locks
    it deletes none.
- **Persistence:** the first media import calls `navigator.storage.persist()` once, so Chrome does not evict large
  assets. Its answer is not required.
- **Quota:**
  - `navigator.storage.estimate()` runs after each import. Above 80 % of the quota, a warning names the usage.
  - `QuotaExceededError` gives `media.err.quota`. The asset then stays **in memory for this session only** (the
    `media` store keeps a `Map` fallback, and so does the song), and the user is told to save a package (§12). A
    package opened on a full device gives the same notice.
- **Without IndexedDB,** the in-memory fallback is used and the same notice is shown. After a package open it names
  what disappears with the tab: the photos and videos (`media.warn.memoryOnly`), the song (`song.warn.memoryOnly`), or
  both (`media.warn.memoryOnlyAll`).
- **`clearDevice`** (≡ › 設定) also clears `media`, `mediaIndex` and `thumbs`. Its label becomes
  「この端末に保存した作品・曲・写真・動画を消す」.

#### 11.2.8 Limits and warnings

| What | Limit | When exceeded |
|---|---|---|
| Still image file | ≤ 60 MB and ≤ 40 MP (from header dimensions, checked before decoding) | refused: `media.err.tooBig` |
| Animated image | ≤ 600 frames and ≤ 2048 px long side | refused: `media.err.animTooBig` |
| Video file | ≤ 4 GB | refused |
| Video frame | long side ≤ 4096 and ≤ 8.9 MP (4096×2176) | refused: `media.err.tooLarge` |
| Video length | ≤ 60 min | refused |
| Video frame rate | ≤ 120 fps | refused |
| Alpha video | ≤ 1920×1080 | alpha ignored: the asset plays opaque, with a note (§11.4.10) |
| Library | ≤ 200 entries | `media.full` |
| Library total on this device | warning above 2 GB (`media.warn.big`) | — |
| One import | warning above 1 GB (`media.warn.bigFile`: slow to hash, large packages) | — |
| Long GOP (mean keyframe gap > 5 s) | badge 「位置合わせに時間がかかる動画です」 | scrubbing is slow; export is unaffected |
| HEVC | badge 「一部のパソコンでは読めない形式です」 | — |
| HDR | badge 「HDR の色は近い色で表示されます」 | — |

#### 11.2.9 Save, open and relink

- **The default save is the package** `.mojipv` (§12). It holds the project, every asset and the song.
- **The light save** (`.json`, 軽い保存) holds ids only. On open, each id is looked up in the `media` store.
- **Missing assets.** An entry whose blob is not on this device is **missing**:
  - its library row shows [つなぎ直す];
  - the preview draws a placeholder (§11.7.8);
  - export is blocked by the preflight item `media-missing`, with a jump to the library.
- **Relinking** (つなぎ直す). The user picks one or more files, and each is hashed.
  - A file whose id equals a missing id is stored under that id, and nothing in the document changes.
  - Otherwise, a file of the same kind with the same displayed size (images) or the same duration ±0.05 s (videos) is
    offered for one missing entry: 「別のファイルですが、この写真の代わりに使いますか？」. Accepting dispatches
    `media.relink`.
  - A content-addressed id never names other bytes. This is unlike songs, whose relink stores the new file under the old
    sha1 (D§6.11). The package's integrity check (§12.4) depends on this rule.
- **Re-probing.** When an entry's `pv` is lower than `PROBE_V` and its bytes are on this device, the probe runs again
  when the project opens. The corrected entries are applied to the document before `store.load`, so no undo entry
  appears. The next save stores them.

### 11.3 Modules and interfaces

#### 11.3.1 Layers and `build.py` (D§2.1, D§2.3 amended; FROZEN)

| Module | Layer | May depend on | Owner |
|---|---|---|---|
| `core/media`, `core/sha256` | L0 | L0 | A (`core/media`), G (`core/sha256`) |
| `media/sniff`, `media/isobmff`, `media/matroska`, `media/samples`, `media/palette`, `media/yuv` | **L1** (new directory `src/media/`) | L0, and L1 inside `media/` | G |
| `media/host/probe`, `media/host/session`, `media/host/store`, `media/host/bake` | **L6** (new directory `src/media/host/`) | L0–L5 | G |
| `export/webm`, `export/unzip`, `export/package`, `export/subtitles` | L5 (pure) | L0–L4 | H (`webm`, `subtitles`), G (`unzip`, `package`) |
| `export/host/webm`, `export/host/kit` | L6 | L0–L5 | H |
| `ui/media_io`, `ui/media_page`, `ui/media_widgets` | L7 | everything | G |
| `ui/filmora_help` | L7 | everything | H |

- `build.py.layer_of` gains two rules: `mid.startswith('media/host/')` → 6 and `mid.startswith('media/')` → 1.
- `l1_group` gains `'media/'`, so `media/*` may use `core/*` and `media/*` only. The engine never depends on `media/*`:
  the time map and the fit math it needs are in `core/media` (L0).
- The D§2.4 lint applies unchanged, with two notes:
  - `media/host/*` may use `getImageData`, `putImageData` and `ctx.filter`. They are banned only in `engine/render/*`
    and the parts, and the host needs them for the alpha merge, alpha detection and still blur.
  - `media/*` (L1) is pure. It gets no DOM and no timers, and receives file bytes through an injected
    `read(offset, length) → Promise<Uint8Array>`.
- The D§2.1 tree gains `src/media/` and `src/media/host/`. The D§9.4 record is §9.

#### 11.3.2 `core/media` (new, L0; FROZEN; package A)

```js
MV.def('core/media', ['core/num', 'core/hash'], (N, H) => ({
  PROBE_V: 1, INDEX_V: 1,
  KINDS: ['image', 'video'],
  FITS: ['cover', 'contain', 'soft'], EDGES: ['mirror', 'zoom', 'plain'], MOVES: ['auto', 'none', 'push', 'pull', 'drift'],
  LOOPS: ['loop', 'hold'], CLOCKS: ['show', 'song'],
  LIMITS,                                   // §11.2.8 numbers and the param ranges of §11.5.6
  ID: /^a[0-9a-f]{24}$/,
  isId(v) → boolean,
  keyOf(id) → 'myMed' + id.slice(1, 11),    // the derived part key (§11.5.9)
  idOfKey(key, doc) → id | null,            // reverse lookup through doc.media
  entryProblems(entry) → string[],          // §11.2.1 rules; [] when valid
  normalizeEntry(entry) → entry,            // q3 numbers, field order, frozen
  refsOf(doc, id) → { pins: string[], materials: string[] },
  metaOf(entry) → MediaMeta,                // the plan subset (§11.2.6)
  timeSpec(meta, p, origin) → TimeSpec | null,     // null for stills; p = resolved media params (§11.5.6)
  mapTime(T, tau) → m,                      // §11.4.2 (pure, closed form)
  fitRect(meta, box, fit, zoom, fx, fy, out?) → FitRect,  // §11.5.2 (pure)
  tier(needPx, meta) → px,                  // §11.4.6 still size tier
}));
TimeSpec = { clock: 'show' | 'song', origin, clipIn, end, speed, loop, frame }   // seconds; frame = 1 / fps
FitRect  = { sx, sy, sw, sh,  dx, dy, dw, dh,  bx, by, bw, bh }   // source rect (displayed px), dest rect (du), box (du)
```

#### 11.3.3 `core/sha256` (new, L0; package G)

```js
createSha256() → { update(bytes: Uint8Array) → this, digest() → Uint8Array(32) }   // FIPS 180-4, streaming
hex(bytes) → string
```

- Fixed test vectors (NIST short and long messages), and chunk-boundary independence.
- The host uses `crypto.subtle.digest` for files up to 256 MB (one buffer). Above that it uses this streaming
  implementation, so a 4 GB video never sits in memory. Both give the same digest (tested).

#### 11.3.4 Pure media modules (L1; package G)

```js
// media/sniff — magic bytes and header dimensions (the first 64 KB of a file)
sniff(head: Uint8Array) → { kind: 'image' | 'video' | 'svg' | 'heic' | 'unknown', container, mime, w?, h?, anim?, alphaHint? }
   // PNG (IHDR, acTL → APNG), JPEG (SOFn), GIF (NETSCAPE loop / >1 image → anim), WebP (VP8 / VP8L / VP8X flags: alpha,
   // animation), AVIF (ftyp avif/avis, ispe), HEIC (ftyp heic/heix/mif1 without avif → 'heic'), ISO BMFF video (ftyp
   // isom/iso2/mp41/mp42/avc1/qt  /M4V ), EBML (1A45DFA3; DocType webm/matroska), SVG (<svg within the first 1 KB of text)

// media/isobmff — MP4 / MOV / fragmented MP4 demuxer
parse(read, size) → Promise<Movie>
Movie = { brand, duration, tracks: Track[] }
Track = { id, kind: 'video' | 'audio' | 'other', codec, description: Uint8Array | null, codedW, codedH, w, h, rot,
          timescale, color: ColorInfo | null, table: SampleTable, alpha: false }

// media/matroska — WebM / MKV demuxer
parse(read, size, { onProgress }) → Promise<Movie>          // same shape; Track.alpha = AlphaMode 1; table.aoff/asize

// media/samples — the sample table and its pure operations
SampleTable = {
  n, duration, fps, vfr, key: Uint8Array,                    // key[d]: sample d (decode order) is a key frame
  pts: Float64Array, dur: Float64Array, dec: Int32Array,     // PRESENTATION order: time (s, first shown = 0), duration, decode index
  off: Float64Array, size: Uint32Array, ts: Float64Array,    // DECODE order: byte offset, size, chunk timestamp (µs)
  aoff: Float64Array | null, asize: Uint32Array | null,      // DECODE order: WebM alpha (BlockAdditional id 1) ranges
}
sampleAt(table, m) → i                     // presentation index: the largest i with pts[i] ≤ m + EPS_MEDIA (1e-4 s), else 0
keyAtOrBefore(table, d) → d0               // decode index of the key frame that starts d's GOP
runFor(table, i) → { from: d0, to: d }     // the decode-order samples that must be fed to show presentation sample i
toData(table) / fromData(data)             // IndexedDB form (ArrayBuffers)
codecString(track) → string                // avc1 / hvc1 / vp09 / av01 / vp8 strings (§11.4.3)
stats(table) → { gopMean, gopMax, vfr }

// media/yuv — the reduced RGBA copy of an 8-bit 4:2:0 video frame that the store blurs (§11.4.6; deterministic)
supports(format, colorSpace) → boolean        // 'I420' | 'NV12', matrix bt709 | bt470bg | smpte170m, not PQ / HLG / BT.2020
factorFor(long, px, blur) → b ∈ {1, 2, 4, 8}  // the largest power of two ≤ 8 with long / b ≥ px / 4 (px / 8 when blur ≥ 8)
sigmaFor(blur, long, b, px) → σ               // blur (device px) × copy px per device px, in 1/32 copy px, > 0
padFor(σ, cw, ch) → ceil(3σ)                  // at most the copy's shorter side
toRgba({ format, data, layout, w, h }, { b, matrix, full, pad, out? }) → { data: Uint8ClampedArray, w, h, cw, ch, pad }
   // the planes of the visible rect (VideoFrame.copyTo); each copy pixel averages its b × b block of Y and its
   // (b/2) × (b/2) block of U and V, converted in fixed point with the matrix and range of VideoFrame.colorSpace; a
   // mirrored border of `pad` px (pixel −1 − k shows pixel k)

// media/palette — dominant colours (deterministic)
dominant(rgba: Uint8ClampedArray, w, h, { k = 5 }) → ['#RRGGBB', …]   // 64×64 input; OKLab k-means++ seeded by hash32 of
                                                                         // the bytes; 8 iterations; sorted by weight
```

The demuxers never allocate per sample beyond the typed arrays, and never read sample payloads, only box and element
headers. The rules for each format are in §11.4.3.

#### 11.3.5 Host modules (L6; package G)

```js
// media/host/probe
importFile(file: File | Blob, { name, signal, onProgress, store }) →
  Promise<{ entry: AssetEntry, fresh: boolean /* false: the id was already stored */ }>
   // §11.4.13 steps; errors: MediaError(code) with the codes of §11.7.9
rasterizeSvg(blob, { signal }) → Promise<Blob /* PNG */>
posterOf(id) / stripOf(id) → Promise<ImageBitmap | null>        // from the thumbs store, rebuilt when missing

// media/host/session
createVideoSession({ track, read, prefer: 'software' | 'hardware', alpha }) → VideoSession      // §11.4.4
createAnimSession({ blob, mime, table }) → AnimSession                                           // ImageDecoder frames

// media/host/store
createMediaStore({ blobs: { get(id) → Promise<Blob | null>, index…, thumbs… }, canvas: CanvasFactory, now, idle })
  → AssetStore (§11.3.6)

// media/host/bake (one per store fork; used by the store only)
createBaker({ canvas, now }) → { variant(long, px, blur) → { b, sigma, blur, key } | null,
                                 bake(held, variant, { alpha }) → Promise<{ bitmap, w, h, index, blur, bytes, route }>,
                                 stats() → { prepMs, baked, yuv, canvas }, dispose() }       // §11.4.6
```

#### 11.3.6 AssetStore (D§4.20 `AssetStore` amended; FROZEN)

```js
AssetStore = {
  get(id) → CanvasImageSource | null,          // v2.0 member, kept: a still at its largest cached tier (lab, old callers)
  frame(id, m, want) → MediaFrame | null,      // m: media seconds (ignored for stills);
                                               // want: { px /* needed device px, long side */, blur /* device px, 0;
                                               //         every medium: stills, videos and animations */,
                                               //         exact: boolean /* export */, thumb: boolean /* posters only */ }
  want(list: [{ id, m, px?, blur? }]) → void,  // look-ahead: start decoding soon (no promise); with a blur, bake the
                                               // listed frames as they are held (§11.4.6)
  ready(list: [{ id, m, px?, blur? }], { signal }) → Promise<void>,   // resolves when every exact frame of the list is
                                               // held, and (timed media with blur > 0) its baked copy too (§11.4.6)
  has(id) → boolean,                           // bytes on this device (or in the session fallback)
  info(id) → { state: 'ok' | 'missing' | 'loading' | 'error', code?: string },
  on(event: 'ready' | 'state', fn) → off,      // 'ready': new frames are held (the stage redraws a provisional frame)
  fork() → AssetStore,                         // own video and animation sessions; shared still cache and blobs
  stats() → { stillBytes, sessions, sessionPixels, held, decodeMs, prepMs /* additive: time in bakes */, … },
  dispose(),
}
MediaFrame = { image: CanvasImageSource, w, h /* displayed px */, rot, exact: boolean, index: int,
               blur /* additive: device px of blur already applied to image; 0 = none */ }
            // pooled per store: valid until the next frame() call for the same id
```

`engine/facade` takes it as before, through `createEngine({ assets })`. `ui/boot` passes the real store. Node tests and
the lab pass `tests/helpers/fake_media.js` (package B).

- The store keys a prepared frame (a still tier, a baked video frame) only by the values of the request itself (`px`,
  `blur` of the `ready()` / `want()` item or of `want`), never by sizes learned from earlier `frame()` calls, so frame N
  rendered directly equals frame N after 0..N−1 (determinism check 7).
- `MediaFrame.blur > 0` tells the engine that the blur is already in the image: it draws a blurred video frame then on
  the plain path. With `blur` 0 for a node that has a blur, the engine blurs the frame itself (§11.5.4) and counts it in
  `FrameStats.media.fallback`.
- **Contract changes of the media-row work (perf: media row; not additive; signed off by the lead, NOTES "## Lead: integrating the media-row work").** They change
  the behaviour of this FROZEN interface and of §11.4.5:
  1. In the preview, `frame()` returns `exact: false` for a held frame of a blurred video or animation (`want.blur > 0`)
     until its baked copy exists. Before, a held frame was always exact. It keeps the stage redrawing a paused frame
     until it shows the baked look, which is the export's.
  2. The provisional frame of a blurred timed medium (§11.4.5 step 2) is the baked copy of the frame that order
     picks, when there is one. When the exact frame is held but not yet baked, a baked copy of one of the
     `NEAR_BAKED = 2` frames before it may stand in (playback: the frame shown a moment ago). Otherwise the exact
     frame is returned unbaked.
  3. `ready()` also bakes: for timed media with `blur > 0` it resolves once the baked copy is held, or once its bake
     has failed.
  4. `want.blur` is now sent for videos and animations too (it was sent for stills only). A store that applies
     `want.blur` to every frame but does not report it in `MediaFrame.blur` would have that frame blurred twice. The
     stores in this tree (`media/host/store`, `tests/helpers/fake_media.js`) report it.
  5. `want()` bakes every listed frame of a blurred timed medium as the session gets it. The engine's `mediaReady`
     lists every output frame of its look-ahead, not only the last one (§11.3.7).

#### 11.3.7 Engine and kit (D§4.17–§4.20 additive; package B)

| Module | Change |
|---|---|
| `engine/scene/builder` | New `sb.media(o) → node`: an `image` node (type 4) whose record has `media: true` and the fields of §11.5.1. It checks every field. It refuses a `static` layer cache on a layer that holds a timed media node. `sb.image` is unchanged. |
| `engine/scene/build` | `svc.media` (= `plan.media`) becomes `env.media`, a frozen read-only lookup. The scene gains `media: [{ node, id, time: TimeSpec \| null }]`, collected at commit. |
| `engine/render/shapes` | New `drawMedia(g, rec, M, alpha, dc, tl) → boolean` (§11.5.5). |
| `engine/render/draw` | `drawLayer` sends records with `media: true` to `drawMedia`, and counts `dc.counts.media` and `dc.mediaWaiting`. It skips `sceneOnly` records when `dc.backdrop !== 'scene'`. |
| `engine/render/renderer` | Sets `dc.t` (the absolute frame time, for `clock: 'song'`) and `dc.backdrop`. New option `opts.layers: 'all' \| 'ground'` (`'ground'`: only the ground layer of every item plus the backdrop fill, used by §13.7). New `mediaAt(plan, source, t, out) → out` (the media nodes of the active scenes and their media times; no behaviours run). FrameStats gains `media: { drawn, waiting, fallback }` (`fallback`, additive: blurred timed nodes drawn with the per-frame blur because their frame came unbaked; export fixtures assert 0), and `provisional` becomes true when `waiting > 0`. |
| `engine/render/record` | Media records are logged as `drawImage('media:<id>@<q6(m)>#<index>', sx, sy, sw, sh, dx, dy, dw, dh)`, with the index from the injected store. Op hashes therefore cover media timing. |
| `engine/facade` | New `mediaAt(t, { scale }?) → [{ id, m, px?, blur? }]`, sorted and deduplicated; with an output scale (given, or the last frame's) every medium carries the `px` and `blur` its draw asks the store for, the products of `shapes.frameFor` in its order (stills: their tier; videos and animations: their baked blur, §11.4.6). New `mediaReady(t, { signal, ahead = 3 / fps }) → Promise` (= `assets.ready(mediaAt(t))` plus `assets.want` of `mediaAt` at every output frame after `t` up to `t + ahead`, at most 8. A look-ahead that named only `t + ahead` let the session close the frames before it as they passed, and each one was then decoded again from its key frame when it was asked for. Measured: a 600-frame 1080p export with a pause between frames, as an encoder's awaits make, fed 4425 chunks and made 127 seeks, where 601 chunks and 11 seeks suffice. Signed off by the lead: §11.3.6 item 5). `fork({ assets? } = {})` (additive option) uses `assets` when given, else `assets.fork ? assets.fork() : assets`, and disposes a store it forked. `renderFrame(…, { quality: 'export' })` throws `EngineError('media-not-ready')` when `assets.frame(…).exact` is false, which is a programming error: exporters await `mediaReady` first. `thumb()` asks for posters only (`want.thumb`). |
| `parts/kit` | New exports `media(env, o)`, `mediaParams(o)` and `MEDIA` (§11.5.6). |
| `export/host/mp4`, `export/host/png` | The frame loop awaits `e.mediaReady(t)` before each `renderFrame` (D§4.21 steps amended, §9). |

#### 11.3.8 Other packages

- **Parts** (package G): `parts/ground/photo.js` (`photoPan` upgraded) and `parts/ornament/media.js` (`photoFrame`,
  `textFill`, `mediaLayer`). §11.5.7.
- **`parts/mix`** (package C): the third argument of `registryFor(base, materials, media)` (§11.5.9) and the recipe
  layer `prim: 'media'` (§11.5.8).
- **Planner** (package D): §11.2.6 and §11.5.9.
- **AI** (package E): `media` in the `direct` schema, `ai/vision` and the recipe AI field. §11.6.
- **UI** (package G): §11.7.

### 11.4 Decoding and frame-exact rendering

#### 11.4.1 Why WebCodecs with our own demuxers, not `HTMLVideoElement`

| Need | `<video>` + seek + `drawImage(video)` | Own demuxer + `VideoDecoder` (chosen) |
|---|---|---|
| Which source frame appears at time `t` | Chosen by the browser. It depends on seek rounding, B-frame reordering, edit lists and how VFR is handled. We cannot compute it, and it differs between browsers. | Chosen by us: `sampleAt(table, m)` is pure arithmetic over the sample table (§11.4.2). It is identical in Node tests and in every browser. |
| Knowing the frame is ready | `seeked` and `requestVideoFrameCallback` do not guarantee that `drawImage` returns the new frame (Safari does not). | The `VideoDecoder` output callback hands over the exact frame, with the timestamp we gave its chunk. |
| Export speed | One asynchronous seek per output frame (20–150 ms each), which cannot be pipelined. | Sequential decode in decode order, pipelined up to 8 chunks, so each source frame is decoded once. |
| Scrubbing | Fast (native seeking) but approximate. | Decode from the previous key frame. Its cost is bounded by the GOP length (§11.4.4), and a poster or the nearest frame is shown meanwhile. |
| Alpha (WebM) | Chrome only. | Our own merge of the alpha stream, the same in every browser that has WebCodecs (§11.4.10). |
| OffscreenCanvas, and no DOM below `ui/` | Needs DOM elements. | Works in the engine's OffscreenCanvas; the pure parts run in Node. |
| CSP | `media-src blob:`, which is allowed. | Nothing: blobs are read with `Blob.slice().arrayBuffer()`, which is not a fetch, so `connect-src` is untouched. |

WebCodecs is already required for MP4 export (D§4.21). A browser without `VideoDecoder` can still use images; its video
imports are refused with `media.err.noWebCodecs`.

#### 11.4.2 The time model (FROZEN math; `core/media.mapTime`, `media/samples.sampleAt`)

For a media node at frame time `t` (absolute seconds; export frame `i` is at `t0 + i/fps`, D§4.21):

1. **Element time** `τ`:
   - clock `show`: `τ = tl − T.origin`, where `tl` is the scene-local time. `origin` is 0 for ground scenes (segment
     time) and `times.a` for cut scenes, so the clip starts when the cut appears.
   - clock `song`: `τ = t`. The clip runs continuously with the song, and at song time 0 it shows `clipIn`.
2. **Media time** `m = mapTime(T, τ)`, with `end = clipOut > clipIn ? min(clipOut, dur) : dur`,
   `span = max(T.frame, end − clipIn)` and `x = max(0, τ) · speed`:
   ```
   loop:  m = clipIn + (x − span · Math.floor(x / span))
   hold:  m = clipIn + Math.min(x, span − 0.001)          // clamped 1 ms before the end: the last frame stays on screen
   ```
3. **Source frame** `i = sampleAt(table, m)`: the largest presentation index with `pts[i] ≤ m + 1e-4`, found by binary
   search, or 0 when there is none.
   - Why `EPS_MEDIA = 1e-4`: at a 30-fps source, `m = 7/30` may evaluate to `0.23333…32`, just below the exact frame
     start, and without the tolerance the previous frame would show.
   - 0.1 ms is far below any frame duration the app accepts (8.3 ms at 120 fps), so the rule is "sample and hold, with
     frame starts rounded toward the later frame", and it is the same everywhere.
4. **Timestamps:**
   - `pts` values are float64 seconds, computed once by the demuxer from integer ticks as `(cts − shift) / timescale`.
   - The chunk timestamp given to the decoder is `ts[d] = Math.round(pts · 1e6)` µs, which is unique for every sample
     and is the key used to match decoder output to samples.

Everything above is closed-form in `t`. So frame N rendered directly equals frame N rendered after frames 0..N−1
(§7.1.3, D§7.1.4). Preview frames at any rate and export frames at 24, 30 or 60 fps pick their source frames by the same
function. Export at any output size picks the same source frames: size affects only the still tier (§11.4.6).

#### 11.4.3 Demuxing (package G; pure, Node-tested)

**ISO BMFF (MP4, M4V, MOV, fragmented MP4)** — `media/isobmff`:
- **Box walk.** It reads 8/16-byte box headers from the top level and seeks over `mdat` and unknown boxes. `moov` is
  read whole (it is normally < 10 MB; the parser refuses one over 64 MB). For fragmented files, every `moof` (`mfhd`,
  `traf`/`tfhd`/`tfdt`/`trun`) is read the same way, skipping each `mdat`. `mvex`/`trex` supply the defaults.
- **Video track.** It is the first `trak` whose `hdlr` is `vide` and whose sample entry is `avc1`/`avc3`, `hvc1`/`hev1`,
  `vp09`, `av01` or `vp08`. The configuration boxes `avcC`, `hvcC`, `vpcC` and `av1C` become `description`. Other sample
  entries (`apch`, `ap4h`, `mp4v`, …) become `codec: '<fourcc>'` and are refused later by `isConfigSupported`.
- **Codec strings:**
  - `avc1.` followed by the hex of the profile, constraint and level bytes of `avcC`;
  - `hvc1.`/`hev1.` following ISO/IEC 14496-15 Annex E (profile space and idc, reversed compatibility flags, tier and
    level, constraint bytes with trailing zero bytes dropped);
  - `vp09.PP.LL.DD` from `vpcC`;
  - `av01.P.LLT.DD` from `av1C`.
- **Sample table.**
  - Decode order comes from `stts` (durations), `ctts` (composition offsets, version 0 or 1), `stsz`/`stz2`, `stsc` and
    `stco`/`co64` (offsets), and `stss` (key frames; all samples are key frames when it is absent).
  - Presentation times are `cts = dts + ctts`. Edit lists: the first non-empty edit's `media_time` shifts presentation
    time, and samples whose presentation falls before it are pre-roll (fed to the decoder, never shown). Initial empty
    edits are ignored: the clip starts with its first shown frame.
  - After the shift, `pts` is sorted ascending and made to start at 0.
- **Rotation.** The `tkhd` matrix is recognised as 0, 90, 180 or 270 degrees. Any other matrix gives `rot: 0` and a
  probe warning. Displayed `w`/`h` are the coded size, swapped for 90 and 270.
- **Colour.** `colr` of type `nclx` gives primaries, transfer, matrix and full range, and becomes the
  `VideoDecoderConfig.colorSpace` and `entry.color`/`hdr`. `nclc` (MOV) is read the same way.

**Matroska / WebM** — `media/matroska`:
- **EBML parse.** It reads variable-length element ids and sizes. The unknown size is accepted only for `Segment` and
  `Cluster`.
- **Header elements:** `Info/TimestampScale` (default 1,000,000 ns) and `Duration`. From `Tracks/TrackEntry`: `CodecID`
  (`V_VP8`, `V_VP9`, `V_AV1`), `CodecPrivate` (AV1: `av1C`), `Video/PixelWidth` and `PixelHeight`, `Video/AlphaMode`,
  `Video/Colour` (range, primaries, transfer, matrix), `DefaultDuration`.
- **Frames.**
  - The parser scans every `Cluster` sequentially in 4 MB windows. Only element headers are parsed; the data inside a
    window is skipped, but the window is still read.
  - From each `SimpleBlock`, and each `BlockGroup` with its `Block`, `ReferenceBlock` and
    `BlockAdditions/BlockMore(BlockAddID 1)/BlockAdditional`, it records the frame's byte range, the key flag and the
    alpha payload range.
  - Frame time = `(ClusterTimestamp + relative) · TimestampScale / 1e9` seconds.
  - **Snap to the frame grid** (lead decision, NOTES "Lead decisions (v2.1 integration)"). WebM stores whole
    milliseconds, so at 24, 30 or 60 fps a third of the frames start up to 0.5 ms after `k / fps`, and §11.4.2's
    `sampleAt(k / fps)` would pick frame k − 1. So when the track has a `DefaultDuration` and every block time, counted
    from the first frame, is within 0.5 ms of `i · DefaultDuration` (i = the presentation index), the frame time is
    `i · DefaultDuration`. Otherwise the stored times are kept (a variable frame rate). The snapped times are integer
    nanosecond ticks (timescale 1e9), so §11.4.2 (4) still holds.
- **Laced video blocks** are refused (`media.err.container`).
- **Codec strings:**
  - VP9: `vp09.PP.LL.DD`. The profile and bit depth come from the first key frame's uncompressed header (frame marker,
    profile bits, and for profile ≥ 2 the bit-depth flag). The level comes from the D§4.21-style table of size and rate:
    `10, 11, 20, 21, 30, 31, 40, 41, 50, 51, 52`. Level 52 is for 3840×2160 at 71 fps or more (up to the 120 fps that
    §11.2.8 allows); a stream beyond the table gets 62.
  - VP8: `vp8`.
  - AV1: the string built from `CodecPrivate`'s `av1C`.
- **Cues** are not needed: the sample table is complete, so no seek index is required.

Parsing a 1 GB WebM reads the whole file once, at disk speed (≈ 1–3 s), during import only. The result is cached in
`mediaIndex`, so opening a project never scans again.

#### 11.4.4 Decode sessions (package G; `media/host/session`)

A session owns one `VideoDecoder`, plus a second one for WebM alpha, for one asset in one store fork.

- **Configuration:**
  - `{ codec, description, codedWidth, codedHeight, colorSpace, optimizeForLatency: false, hardwareAcceleration }`.
  - **Export** forks use `prefer-software` when `isConfigSupported` accepts it, else `no-preference`. Software decoders
    (ffmpeg's H.264, libvpx, dav1d) are bit-exact for conformant streams, so the same browser build gives identical
    export pixels on any machine, which is D§7.1.8 extended to media.
  - The **preview** uses `no-preference` (hardware when available).
- **`request(i)`** (the presentation index) returns a Promise that resolves to the held frame:
  1. If the frame whose chunk timestamp is `ts[dec[i]]` is held, resolve at once.
  2. `{ from, to } = runFor(table, i)`. `c` is the decode cursor, the next sample to feed.
     - If the target was fed (`c > to`) since the last reset but has not been output yet, wait for it.
     - Else, if `c ≤ to` and `to − c ≤ AHEAD_MAX` (240 samples), keep feeding forward from `c`. This includes `c <
       from`: the run then passes through the key frame at `from`.
     - Otherwise **seek**: `decoder.reset()`, `configure(config)`, set `c = from` and drop the held frames.
  3. Feed the decode-order samples `c, c + 1, …` as `EncodedVideoChunk({ type: key[c] ? 'key' : 'delta', timestamp:
     ts[c], duration, data })`. Keep `decodeQueueSize ≤ 8`, waiting on the `dequeue` event.
     - Stop feeding as soon as the target frame has been output. With B-frames, the decoder outputs it only after a
       few later samples (in decode order) have been fed.
     - At the end of the table, call `flush()` to drain. A flush forces the next chunk to be a key frame, so the session
       then treats the next request as a seek.
  4. **Output callback.** Each output frame is matched to its sample by its timestamp.
     - Frames at or after the smallest outstanding target are **held**. At most `HOLD = 3` frames per session are
       held, plus the last frame shown; the oldest is closed first.
     - Every other frame is `close()`d at once. Holding a decoded frame too long stalls hardware decoders.
- **Look-ahead hints** (`hint(list)`, from `want()`) never send the decoder back: a hinted frame behind the decode
  position (output since the last seek, or in a GOP before the one the decoder started from) is decoded when it is
  requested. Otherwise the look-ahead of a loop's first frame resets the decoder under the frames about to be drawn, and
  they are decoded again from their key frame (measured: ≈ 150 ms at every loop of a 1080p one-GOP clip).
- **Hints never close a frame about to be shown** (the stage hints 8 frames; `HOLD` is 3). The first two rules are
  needed. Without the first, without the second, or with the first counting frames by index alone, real-time preview
  playback (media_exact.py) fell to 34–138 of 127–150 frames shown right and baked, or made more seeks than the clip
  has loops.
  - A hint is decoded only while at most `HOLD` frames still to be shown are held. That count includes the last frame
    decoded, and it covers the frames after the shown one and the hinted ones: a loop's start comes after its end. The
    hints resume on `show()`.
  - Past a hinted target, the next chunk is fed only once the decoder has made no progress for `SETTLE_MS` (20 ms): it
    needs more input, as reordered frames do. A request (a waited-for target) still takes the next chunk as soon as the
    decoder has taken the previous ones. Every frame output past the target is held. Once more than `HOLD` are held,
    `evict()` closes the oldest, which in playback is the next frame to be shown.
  - A request preempts a hinted target at once. No fixture here exercises this: it is meant for decoders that output a
    frame only after more input (reordered H.264, frame-threaded software decoders). Such a decoder gets each hinted
    frame only after `SETTLE_MS` per extra chunk, so its look-ahead lags and requests take over. That is not measured
    here: this Chromium has no H.264 encoder to make the fixture, and the CI Chrome encodes baseline H.264, which has no
    reordered frames.
- **Frame hooks** (additive, for the store): `onHeld(i)` when frame `i` becomes held (the store bakes a hinted frame
  then), `onDrop(i)` when a held frame is closed by eviction (the store closes that frame's baked copies with it).
- **Reads.** Payloads are read with `read(off, size)` and coalesced into windows of at most 4 MB of consecutive samples,
  from `Blob.slice().arrayBuffer()`. Nothing is read twice while the cursor moves forward.
- **Errors.** A decoder `error` resets the session once and retries from the previous key frame. A second error sets
  `info(id)` to `{ state: 'error', code: 'decode' }`. The preview then shows the placeholder, and export fails with
  `ExportError('media', { name })`.
- **Animated images** (`AnimSession`) use `ImageDecoder({ data: blob.stream(), type: mime })` and
  `decode({ frameIndex: i })`. They are random access, so there is no seeking cost. Decoded frames are cached as
  `ImageBitmap`s in an LRU capped at 64 MB per asset.

#### 11.4.5 Preview and export

- **Preview** (`ui/stage` render loop):
  1. Before each frame: `assets.want(engine.mediaAt(t))`. While playing, it also asks for `engine.mediaAt(t + k / 30)`
     for k = 1…8, which is 0.27 s of look-ahead.
  2. `drawMedia` calls `frame(id, m, { exact: false })`. The store returns the exact frame when it is held. Otherwise it
     returns, in this order: the nearest held frame at or before the target, the last frame shown for that id, the
     nearest filmstrip frame, the poster. That result has `exact: false` and `dc.mediaWaiting` is counted.
     - A blurred video or animation (`want.blur > 0`) is exact only with its baked copy (§11.4.6; a contract change,
       §11.3.6). While that bakes, the provisional result depends on whether the exact frame is held. If it is held,
       the result is the baked copy of one of the `NEAR_BAKED = 2` frames before it (playback: the frame shown a moment
       ago), else the exact frame unbaked (`blur` 0: the engine blurs it itself and counts a fallback). If it is not
       held, the result is the frame the order above picks, as its baked copy when there is one, else unbaked. All of
       these have `exact: false`, and the `ready` event follows the bake.
  3. `FrameStats.provisional` is then true, and the stage already redraws paused provisional frames (`retrySoon`,
     `PROVISIONAL_RETRY_MS`). It also redraws on the store's `ready` event.
  - There is no spinner over the preview. When media frames have been pending for more than 400 ms, the play bar's time
    readout shows a small dot, with the tooltip 「映像を準備中」.
- **Export** (D§4.21 amended; `export/host/mp4`, `png`, `webm`, `kit`):
  1. `prepare(t0, t1, { export: true })` also runs `assets.ready(stills used in [t0, t1])`, which decodes every still at
     its export tier while it fits the still budget.
  2. For each frame `i`, before `renderFrame`: `await e.mediaReady(t0 + i / fps, { signal })`. For a blurred video or
     animation, `ready()` resolves only once the baked copy of that frame is held (§11.4.6), so export frames draw it;
     a bake that fails leaves the exact unbaked frame, which the engine blurs itself (counted as a fallback).
  3. Export frames are therefore always exact. If the store cannot deliver a frame (a decode error or missing bytes), the
     export stops with an `ExportError` that names the asset; it never renders a substitute.
- **Time cost.** Export decodes each needed source frame once. At speed `s` it decodes about `s × source fps` frames per
  output second, and the preflight notes a heavy clip when `s · fps > 240`. A 1080p30 H.264 background adds about
  1–3 ms per frame with software decoding on a mid-range laptop. Package G measures and records the real figure in
  NOTES.

#### 11.4.6 Stills and animated images

- **Decoding:**
  - `createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: 'default', premultiplyAlpha:
    'default', resizeWidth, resizeHeight, resizeQuality: 'high' })`.
  - EXIF orientation is applied by the decoder, so `entry.w`/`h` are the upright size and nothing else needs rotating.
- **Tiers.** A still is decoded at the smallest tier `≥ need`, capped at the source long side and at 24 MP.
  - Tiers are `512, 1024, 2048, 4096, 6144, 8192` px on the long side.
  - `need = ceil(longest side of the node's box in du × output device px per du × headroom)`. `headroom =
    cropZoom × (1 + Ken Burns zoom) × 1.15`, fixed at build (§11.5.1), where 1.15 is the camera allowance. The tier is
    therefore a function of the scene and the output scale, never of the frame. There is no switching between frames,
    so there is no flicker and determinism holds.
  - The preview and the export may use different tiers, like the DPR: resampling may differ slightly, but the source
    rect is the same.
- **Blur of a still** is made by the store: a copy downscaled by `max(1, blurPx / 4)`, filtered with `ctx.filter = 'blur(…)'`
  in the host, and cached with the key `(id, tier, blur level)`. Blur levels are quantized to `0, 2, 4, 8, 16, 32, 64` du,
  the sprite rule of D§4.19.5 with one more step. A blur between two levels crossfades the two cached copies.
- **Animated images** use the video path: their table comes from the frame durations read at import, and they loop by
  default.
- **Blur of a video or animation frame** is made by the store too, once per source frame, never per output frame:
  - **Key:** `(id, index, b, σ)`. The copy is `1/b` of the frame, with `b` the largest power of two ≤ 8 whose copy keeps
    a long side ≥ `px / 4` (`px / 8` when `blur` ≥ 8 device px), so the copy's long side lies in `[px/4, px/2)`: 480×270
    from a 1080p source in the 720p preview, 960×540 in a 1080p export. `σ` in copy px = `blur × copyLong / px` (the
    still rule, headroom included), rounded to 1/32 px. The blur is not snapped to the still levels (a 1080p export's
    3 px would become 2 px). `px` and `blur` are the request's own (`ready()`/`want()` item, `want`), so the copy is a
    function of the frame and the request only.
  - **The factor for a small blur (signed off by the lead).** The rule applies to every blur > 0, including the
    2 device px of a `back` ground in the 720p preview. That copy is 480×270, ≈ 1/3 of the drawn 1472 px. The
    principle's premise ("a large blur is visually identical at 1/2–1/4 scale") holds only loosely there: the engine's
    own per-frame blur works at 1/2 of the output below 8 px (`engine/render/post.blurred`). A copy of at least half the
    drawn size (`b = 2`, 960×540) costs 13.2–13.6 ms per source frame in software. That is the JS conversion 6.3 ms
    and `ctx.filter` at that size 7.2 ms, against 3.2 ms at `b = 4`, and the media row then fails: p50 24.1–25.3 ms.
    The look difference at `b = 4` is under **Look**.
  - **Pixels** (`media/host/bake`): a `VideoFrame` whose format is 8-bit I420 or NV12, with a known matrix
    (`media/yuv.supports`) and `b ≥ 2`, is copied out (`copyTo`, the visible rect) and reduced in JS (`media/yuv.toRgba`:
    a box average, the matrix and range of `VideoFrame.colorSpace`, fixed point). That includes a GPU-backed frame that
    reports one of these formats: `copyTo` reads it back. Nothing tells how a frame is backed, and the readback's cost
    on a GPU machine is not measured (no GPU here). Any other frame takes the canvas route: format `null` (an opaque GPU
    frame can have it), 10-bit or alpha formats, an unknown matrix, the alpha-merged or animation `ImageBitmap`, or
    `b = 1`. The browser draws it into a copy-sized canvas. The route depends on the frame's own properties only, never
    on history.
  - **Blur:** `ctx.filter = blur(σ)` from a copy padded by `ceil(3σ)`: mirrored for opaque media (the frame edges stay
    opaque, as the mirrored neighbours of §11.5.2 continue them), transparent for media with alpha. Without
    `ctx.filter`, a smaller copy scaled back up stands in. The result is an `ImageBitmap` (`transferToImageBitmap`).
  - **When:** in `ready()` (export: the frame of the list), and for the preview in idle slices, at most one per slice:
    the frame on screen first, then the frames of the latest `want()` list in list order, each as soon as the session
    holds it (the session's `onHeld` starts the queue). Never in the decoder's output callback, never frames skipped at
    speed. Measured with the stage's 8-frame look-ahead, playing in real time at 30 fps (media_exact.py; NOTES "Perf:
    media row", review round 2). After the first second, 264–285 of 269–285 frames showed their exact baked frame in
    10-s runs, with one bake per source frame. Before this rule it was 5 of 300 in the probe, and 69 of 300 in the
    reviewer's.
  - **Look (signed off by the lead):** close to the per-frame blur it replaces, and without the darker fringe the
    per-frame blur of the whole frame left at the frame edges. `media_exact.py` asserts MAE ≤ 3 of 255 inside the frame
    on a hard-edged pattern, and ≤ 3 inside flat colour, where only the colour conversion shows. Measured: MAE 2.21 at
    720p (the largest difference 65 of 255, 4.6 % of the pixels off by more than 16) and 1.30 at 1080p (the largest 20).
    σ is ≈ 0.87 × the per-frame blur's at camera zoom 1, because px includes the 1.15 camera headroom, as the still
    rule does. The JS colour conversion follows the standard BT.709 / BT.601 coefficients. This Chromium's libyuv
    differs from them by up to 13 of 255 in blue at an extreme U. Export pixels of a blurred video therefore change,
    deterministically. `tests/golden/project_media.json` was regenerated for it (frame hashes only), signed off by
    the lead (§7.5). A bake that fails in an export leaves that one frame with the per-frame look (the edge fringe)
    among baked frames. It is counted in `FrameStats.media.fallback`, which the export fixtures assert to be 0.

#### 11.4.7 Caches and memory bounds (D§7.3 additions)

| Cache | Key | Bound |
|---|---|---|
| Still bitmaps (per page, shared by forks) | (id, tier) | 320 MB LRU; ≤ 24 MP per bitmap; export waits and evicts instead of failing |
| Blurred stills | (id, tier, blur level) | inside the 320 MB |
| Held video frames | per session | `HOLD = 3` + the last frame shown |
| Baked video and animation frames (§11.4.6) | per session: (variant, frame) | one per held frame and variant, at `1/b` size, closed when the session closes its source frame (`onDrop`) or with the session; so at most HOLD + shown + pinned + the frame being decoded (measured: ≤ 5 in a 600-frame 1080p export and while playing, never more than the frames held) |
| Video sessions (per store fork) | asset | Σ coded pixels of open sessions ≤ 16.6 MP (two 4K, or eight 1080p). The least recently used session closes first and reopens with a seek. |
| Decoder queue | per session | ≤ 8 chunks in flight |
| Read windows | per session | ≤ 4 MB |
| Animation frames | (id, frame) | 64 MB per asset |
| Posters, filmstrips | id | IndexedDB `thumbs`; in memory, the UI thumbnail LRU of D§7.3 (200 entries) |
| Sample tables | id | IndexedDB `mediaIndex`; in memory, while a session or the library needs them |

At 4K, a decoder may keep up to 16 reference frames in its own memory. The pixel bound above keeps the worst case of the
preview and one export fork running together at about 1 GB of decoder memory.

#### 11.4.8 4K

- A 4K source into 2160p output is fully supported. With software decoding, export runs at roughly 20–40 fps of 4K
  H.264 on a mid-range laptop. The ETA shows it.
- A 4K source in the 720p preview is decoded by hardware when available. If decoding falls behind playback, the preview
  shows the nearest frames: playback never waits, and the frame is exact when paused.
- An 8K source is refused (§11.2.8).
- A still is never decoded above 8192 px or 24 MP. A 2160p cover background needs about 4400 px on the long side with
  the default mirror edges (3840 × the 1.15 camera allowance), or about 5700 px with edge `zoom` (× 1.3 bleed). Both
  fit the 6144 tier, within 24 MP for a 3:2 or wider photo.

#### 11.4.9 Colour

- The canvas is sRGB; the engine never asks for `display-p3`.
- **Stills:** `colorSpaceConversion: 'default'` converts ICC-tagged and wide-gamut images to sRGB. Out-of-gamut colours
  clip.
- **Video:** the decoder config carries the container's colour description (`colr` or `Colour`). The browser converts
  YUV to sRGB when a `VideoFrame` is drawn (BT.601, BT.709 or BT.2020 matrix; limited or full range). HDR (PQ, HLG) is
  tone-mapped by the browser. That is not guaranteed to be the same across machines, so HDR assets carry the `hdr` badge
  and a preflight info item.
- **Export encoding** is unchanged (D§4.21). A video background goes YUV → sRGB (canvas) → YUV (encoder), and colours
  stay within ±2/255 of the preview's.

#### 11.4.10 Alpha

- **PNG, WebP, AVIF, GIF and APNG** keep their alpha in the `ImageBitmap`, and drawing composites with it.
  - `entry.alpha` comes from a 64×64 decode at import: `getImageData` in the host, and true if any alpha < 255. This is
    reliable for every format, so no header parsing is needed.
- **WebM VP8/VP9 with alpha** (`AlphaMode = 1`, with the alpha frames in `BlockAdditional` id 1):
  1. The session runs a **second `VideoDecoder`** on the alpha payloads, which are ordinary VP8/VP9 frames whose luma is
     the alpha. Each alpha payload gets the same timestamp as its colour frame.
  2. For each timestamp pair (colour `C`, alpha `A`), the host merges in `media/host/session`:
     - `A.copyTo(buf)` in I420 layout; the Y plane gives the alpha bytes (0–255, used as is, the way Chrome's own WebM
       player does).
     - `putImageData` of an `ImageData` with `a = Y` and rgb 0 into a mask canvas.
     - `drawImage(C)` into an output canvas, then `globalCompositeOperation = 'destination-in'` and `drawImage(mask)`.
     - `transferToImageBitmap()`; the result is held like a frame. `C` and `A` are closed.
  3. Cost: ≈ 4–7 ms per 1080p frame. Alpha videos above 1920×1080 are refused as alpha (they play opaque, with a note).
- **HEVC with alpha** (Apple MOV) and ProRes 4444 are not decodable by WebCodecs: the video plays opaque, or is refused
  for ProRes.
- **Transparent and keyed backdrops** (D§4.19.4 extended):

  | Backdrop | `photoPan` (ground layer) | `photoFrame`, `textFill` (far, mid and text layers) | `mediaLayer` (`sceneOnly`) |
  |---|---|---|---|
  | `scene` | drawn | drawn | drawn |
  | `chroma` (green screen) | not drawn: the ground layer is off | drawn | skipped |
  | `black` | not drawn | drawn | skipped |
  | `clear` (透過PNG, 透過WebM) | not drawn | drawn with its own alpha | skipped |

  - When a ground or overlay medium is skipped, the export preflight adds the info item `media-skipped` (§11.7.9), and
    the inspector marks those rows 「この背景の種類では書き出されません」.
  - A transparent export with cut media keeps their alpha exactly, as PNG glyphs do (`transparent_check.py` extended,
    §11.8).

#### 11.4.11 CSP and browser APIs

The CSP of D§2.6 does not change:
- `media-src blob:` is not used by rendering. The SVG rasterizer uses `<img src=blob:>`, which falls under `img-src
  blob:`. The UI shows posters as `<canvas>` or `<img src=blob:>`, also under `img-src blob:`.
- No `fetch`: `connect-src` is unchanged, and the vision request goes to the Gemini host, which is already allowed.
- `worker-src 'none'` stays, because decoding needs no Worker.
- WebCodecs, `ImageDecoder`, `createImageBitmap`, IndexedDB and the File System Access API need no CSP source.
- Object URLs are revoked right after use.
- `csp.py` runs the import, placement, playback, export, package and vision flows (§11.8.3) and asserts 0 violations.

#### 11.4.12 Third-party code: none

Our own demuxers are ≈ 1,100 LOC with tests. The candidates considered were rejected:
- `mp4box.js` (BSD-3-Clause, ≈ 190 KB minified): MP4 only; a WebM demuxer would still be needed.
- Mediabunny (MPL-2.0, ≈ 100–150 KB minified for demuxing): it would add a second licence family and a second adapter.
- WASM demuxers such as web-demuxer (ffmpeg based): they need `'wasm-unsafe-eval'` in `script-src`, which changes the
  CSP.

If G's demuxer slips, the fallback is Mediabunny, unmodified, at `vendor/mediabunny.min.js`, behind one adapter
(`media/demux_vendor.js`), with its notice in `THIRD_PARTY_NOTICES.md` and the About page (D§1.4). Using the fallback
needs a D§9.4 decision by the lead.

#### 11.4.13 Import steps (`media/host/probe.importFile`)

1. **Sniff** the first 64 KB (§11.3.4). HEIC, unknown types and over-limit header dimensions are refused before
   anything else is read.
2. **Hash.** Read the file in 8 MB slices, computing SHA-256 and CRC-32 in one pass (§11.3.3). Progress goes to
   `onProgress`, and the `signal` cancels. The work yields through `idle` between slices.
3. **Deduplicate.** The id is `'a' + hex24`.
   - If `doc.media` already has it, the result is `fresh: false` and the UI selects that entry.
   - If the `media` store already has the blob, the bytes are not stored again.
4. **Probe:**
   - **Image:** decode at full size (≤ 40 MP, checked in step 1) to get the upright `w`/`h`. Make the poster from that
     decode; make the alpha test from a 64×64 decode. Close the bitmaps.
   - **SVG:** rasterize to PNG (§11.1.1) and restart at step 2 with the PNG.
   - **Animation:** use `ImageDecoder`. Read `tracks.selectedTrack.animated` and `frameCount`, decode every frame once
     to read its `duration`, build the table, and make the poster and the filmstrip.
   - **Video:** demux and pick the first video track. Check `isConfigSupported` with software, then hardware. Decode the
     first frame for the poster and 12 key frames spread evenly for the filmstrip. Read colour, HDR and audio presence,
     compute `stats` (GOP), and build the entry.
5. **Store** in one IndexedDB transaction per store: the blob, the `crc` and the name in `media`; the table in
   `mediaIndex`; the poster and filmstrip in `thumbs`.
6. **Return** the entry. The UI dispatches `media.put`, which is the undoable step. Undo leaves the blob stored, and
   pruning removes it later.

**Import time** on a mid-range laptop: hashing ≥ 150 MB/s, so a 1 GB video takes ≈ 7 s. An MP4 probe takes < 0.3 s; a
WebM scan runs at disk speed. Imports run one at a time in a queue, and each can be cancelled.

### 11.5 Engine, kit and parts

#### 11.5.1 The media node (`sb.media`; FROZEN record)

```js
sb.media({ parent?, layer, owner?, x = 0, y = 0, rot = 0, sx = 1, sy = 1, alpha = 1,
           src,                        // AssetId; the builder refuses '' (K.media returns -1 before calling it)
           box: { x, y, w, h },        // du: the rect the media is fitted into, in the node's frame
           fit: 'cover' | 'contain' | 'soft', crop: { zoom, x, y },   // zoom ≥ 1; x, y = focus point 0..1 of the source
           edge: 'mirror' | 'zoom' | 'plain',                          // how the bleed around `box` is filled (grounds)
           bleed: 0 | 0.15,            // the bleed share around box covered by the edge rule
           mask: ShapeSpec | null,     // clip in box coordinates (K.shape data); null = none (the image's own alpha)
           comp: 'over' | 'atop' | 'screen' | 'multiply' | 'overlay',
           blur: du, veil: { ink, a } | null, tint: { ink, a } | null,
           time: TimeSpec | null,      // from core/media.timeSpec; null for stills
           headroom,                   // §11.4.6 tier headroom (fixed at build)
           sceneOnly: boolean })       // skipped unless the backdrop is 'scene' (mediaLayer)
  → node
```

- The builder stores `FitRect = core/media.fitRect(env.media[src], box, fit, crop.zoom, crop.x, crop.y)` at build, so
  nothing about framing is computed per frame.
- Pose columns apply as they do for an `image` node: position, rotation, scale and alpha. Behaviours such as Ken Burns
  and appear animations move the node.
- The node is pickable (D§4.19.7). Picking returns the owner (`ground`, `ornament#i` or `atmos`), so clicking a photo on
  the preview selects 要素 › 背景 or 装飾.

#### 11.5.2 Fit, crop and edges (FROZEN math; `core/media.fitRect`)

The source is `S = (W, H)` in displayed px (after `rot`). The box is `B = (bx, by, bw, bh)` in du. The focus point is
`(fx, fy)` ∈ [0, 1]² and the crop zoom is `z ≥ 1`.

```
cover:    s  = z · max(bw / W, bh / H)                     // du per source px
          sw = bw / s,  sh = bh / s                        // visible source rect size
          sx = clamp(fx · W − sw/2, 0, W − sw),  sy = clamp(fy · H − sh/2, 0, H − sh)
          dest = B
contain:  s  = z · min(bw / W, bh / H)
          dw = W · s,  dh = H · s                          // the displayed image, before clipping to B
          dx = bx + (bw − dw) · fx',  dy = by + (bh − dh) · fy'    // fx' = fx when dw > bw, else 0.5 (centred); fy' alike
          dest = D ∩ B, source = the preimage of dest (clipped to S)
soft:     contain as above, drawn over a cover copy of the same source with zoom 1.08, blur 24 du and veil { ground, 0.25 }
```

- **The focus point is also the crop.** The stage crop overlay (§11.7.6) moves `(fx, fy)` and changes `z`. A
  non-uniform crop cannot be expressed; in practice, the box's aspect is the crop's aspect.
- **Edges (grounds only).** A ground must cover the frame plus the 15 % bleed (D§4.19.3) while the camera moves. Fitting
  the media to the frame exactly and then enlarging it by the bleed would crop the user's picture by 30 %. The rule
  `edge` decides:
  - `mirror` (default): fit to the **frame**. The bleed ring is filled by the same source rect, flipped horizontally
    and/or vertically: the 8 neighbours of `dest`. Only neighbours that intersect the target's visible device rect are
    drawn, usually 0–2 draws. At camera rest, the frame shows exactly the chosen crop.
  - `zoom`: fit to the bleed rect (frame × 1.3). This was v2's `photoPan` behaviour: the picture is enlarged, and edges
    never show.
  - `plain`: fit to the frame. The ground colour shows in the bleed (the `photoPan` base paint).
- **Ornaments** use their own box. `edge` does not apply to them.

#### 11.5.3 Motion (Ken Burns)

- The motion is one behaviour, `runKenBurns`: a module-level function in `parts/kit` with phase ORNAMENT and live
  `always`, like `photoPan`'s `panZoom` today.
- It is closed-form in the segment or cut-local time over the element's window `[w0, w1]`, with `u = clamp((tl − w0) /
  (w1 − w0))`:
  - `push`: scale `1 → 1 + zoom`;
  - `pull`: scale `1 + zoom → 1`;
  - `drift`: scale `1 + zoom/2`, with the translation moving along `pan` over `travel = 0.04 · short` (the v2 amount).
  - `auto` means `push` plus the drift, which is v2's `photoPan`, for stills; for videos and animations it means `none`.
- The scale pivot is the box centre (`px`, `py`).
- `u` is linear, as in v2. The shared `lens.curve` idea is not applied, so v2 frames stay equal.

#### 11.5.4 Effects, masks and blending

- **Opaque media, no blur:**
  - `veil`: `fillRect` of `q.rgba(ink, a)` over `dest` with source-over.
  - `tint`: `fillRect` of the tint ink with `globalCompositeOperation = 'color'` at alpha `a`, clipped to `dest`.
  - Both touch only the media's pixels, because the media is opaque inside `dest`.
- **Media with alpha, or `comp: 'atop'`, or a video blur the frame did not bring baked** use the **isolated path**:
  1. Draw into a pooled full-frame surface (`pool.take()`).
  2. Apply veil and tint with `source-atop`.
  3. Apply blur with `PO.blurred(pool, S, blurPx)`.
  4. Composite onto the target with `comp`.
  - This costs one extra surface, within the D§7.2 pool limits.
- **Still blur** comes pre-made from the store (§11.4.6); no per-frame blur.
- **Video and animation blur** comes pre-made from the store as well (§11.4.6: baked once per source frame,
  `MediaFrame.blur > 0`), so a blurred opaque video takes the plain path: one draw of the small copy (and its mirrored
  neighbours) plus the veil. The per-frame `PO.blurred` of the isolated path remains only as the fallback when a node with
  a blur gets a frame with `blur` 0 (a provisional preview frame, a bake that failed); it is counted in
  `FrameStats.media.fallback`.
- **Mask:** `save(); setMatrix(M); B.replayShape(g, mask); clip(); … restore()`. The shapes come from `K.shape`, so all
  geometry is ours. Clips are anti-aliased by the canvas.
- **`comp`** sets `globalCompositeOperation` for the node's draw only, then restores `source-over`.
- **`atop`** (text fill) needs the node's layer to be isolated. `textFill` sets `sb.layer('text', { isolate: true })`.
  The media node is added after the text is committed, so its index is after the glyphs', and it paints only where
  glyphs are, glow and shadow styles included.

#### 11.5.5 `drawMedia` (engine/render/shapes; per frame, allocation-free)

```
1  m = rec.time ? MEDIA.mapTime(rec.time, rec.time.clock === 'song' ? dc.t : tl) : 0
2  f = dc.assets ? dc.assets.frame(rec.src, m, want) : null        // want is a pooled object:
     want.px = max(rec.box.w, rec.box.h) · dc.scale · rec.headroom;  want.blur = rec.blur · dc.scale (every medium);
     want.exact = dc.quality === 'export'
3  f null → preview: draw the placeholder (§11.7.8), dc.mediaWaiting++; export: throw EngineError('media-missing')
   !f.exact → dc.mediaWaiting++ (export: throw 'media-not-ready')
4  choose the plain path or the isolated path (§11.5.4; a timed frame's own blur only when f.blur is 0: the fallback,
   dc.counts.mediaFallback++); set the transform M · R(rot) (rot about dest centre, 90° steps)
5  drawImage(f.image, source rect mapped to coded px, dest rect); edge neighbours (mirror) when visible;
   soft: the blurred cover copy first
6  veil, tint, comp, mask, restore; dc.counts.media++; pick the dest quad
```

The source rect of step 5 is converted from displayed px to coded px through `rot`:
- 90: `(sx, sy, sw, sh) → (sy, W − sx − sw, sh, sw)`;
- 180 and 270 alike.

The destination is drawn with the matching rotation. Tests cover all four angles against a rotated fixture.

#### 11.5.6 `K.media` and `K.mediaParams` (parts/kit; FROZEN exports, additive to D§4.18.3)

```js
K.media(env, { parent?, layer, owner?, src, box, p, use: 'ground' | 'frame' | 'fill' | 'layer',
               mask?, comp?, alpha?, window?: [w0, w1] }) → node | -1
     // -1 when src is '' or env.media has no entry; reads env.media[src]; installs runKenBurns when the move is not none;
     // sets sceneOnly for use 'layer'; time origin = 0 (ground scenes) or env.times.a (cut scenes)
K.mediaParams({ src = 'src', accept = 'any', use, only?, autos? }) → { [name]: ParamSpec }    // the table below
K.MEDIA = { FITS, EDGES, MOVES, LOOPS, CLOCKS, SHAPES: ['rect', 'round', 'circle', 'arch', 'free'],
            PLACES: ['behind', 'side', 'corner', 'free'], BLENDS: ['screen', 'multiply', 'overlay', 'normal'] }
```

**Media params** (labels are `{ ja, en }` in the kit; every param is `ai: false`; `ui` is `basic` unless noted):

| Name | Type and range | Auto | ja / en | Notes |
|---|---|---|---|---|
| `src` (`photoPan`: `image`) | `media`, accept per part | `''` | 写真・動画 / Photo or video | the source |
| `fit` | enum `cover contain soft` | `cover` (frames: `cover`) | 収め方 / Fit | |
| `cropZoom` | num 1–4, step 0.01, `x` | 1 | 拡大 / Zoom | the crop (§11.5.2) |
| `cropX`, `cropY` | num 0–1, step 0.005, `frac` | 0.5 | 中心 横 / 縦 (Focus X / Y) | advanced; set by the stage overlay |
| `edge` | enum `mirror zoom plain` | `mirror` | 端の処理 / Edges | grounds only, advanced |
| `move` | enum `auto none push pull drift` | `auto` | 動き / Motion | Ken Burns |
| `zoom` | num 0–0.4, step 0.01, `x` | range 0.06–0.14 | 動きの強さ / Motion amount | `photoPan`'s existing param |
| `pan` | num −180–180, `deg` | range −180–180 | 動く向き / Direction | `photoPan`'s existing param |
| `blur` | num 0–60, `du` | 0 | ぼかし / Blur | |
| `veil` | num 0–0.9, step 0.01 | `photoPan` range 0.3–0.45; others 0 | 薄幕 / Veil | |
| `veilInk` | ink | `ground` | 薄幕の色 / Veil colour | 黒 = dim |
| `tint` | num 0–1, step 0.01 | 0 | 色味 / Tint | advanced |
| `tintInk` | ink | `accent` | 色味の色 / Tint colour | advanced |
| `clipIn` | num 0–3600, step 0.01, `s` | 0 | 使う範囲（始め） / Start at | video and animation |
| `clipOut` | num 0–3600, step 0.01, `s` (0 = to the end) | 0 | 使う範囲（終わり） / End at | video and animation |
| `speed` | num 0.25–4, step 0.05, `x` | 1 | 速さ / Speed | video and animation |
| `loop` | enum `loop hold` | `loop` | 終わったら / At the end | video and animation |
| `clock` | enum `show song` | `show` (auto-picked videos: `song`) | 時間の基準 / Clock | video and animation, advanced |

- The inspector shows the video rows only when the chosen source is a video or animation. The field `when` reads
  `plan.media[id].kind`.
- The rows for `clipIn` and `clipOut` are drawn by the trim widget (§11.7.7).

#### 11.5.7 Parts (package G)

`parts/ground/photo.js`: **`photoPan`, upgraded in place.**
- Keys are forever (D§7.1.9), and v2.0 shipped no asset store, so no v2.0 document holds a working image id (D§10.4).
- Its label becomes 写真・動画 / Photo or video. Its blurb becomes 「写真や動画を背景にする（選んだときだけ）」 / "Your photo or
  video as the background (only when chosen)".
- It stays `pool: false`.
- Params: `image` (type `media`, accept `any`), and `zoom`, `pan` and `veil` (names and ranges kept), plus the other
  media params with `use: 'ground'`.
- **Build:**
  1. The base paint, as in v2.
  2. `K.media(env, { layer: 'ground', box: frame, use: 'ground', src: p.image, p })`.
  3. The veil moves into the node: the `veil`/`veilInk` params replace the v2 veil paint. The strength is
     `veil · (0.6 + 0.4 · amount)`, as in v2.

`parts/ornament/media.js` (new; every part `pool: false`; tags `['soft']` unless noted):

| Key | ja / en | Scope, follow | Params (plus `K.mediaParams` with `use`) | Picture |
|---|---|---|---|---|
| `photoFrame` | 写真の枠 / Photo frame | cut, text | `place` (enum behind/side/corner/free; auto `side`), `size` (0.15–1 × short side; auto 0.42), `shape` (enum rect/round/circle/arch/free; auto `round`), `border` (0–40 du; auto 10), `borderInk` (ink; auto `ground`), `shadow` (0–1; auto 0.4), `tilt` (−15–15°; auto range −4–4), `appear` (enum fade/grow/slide/none; auto `grow`) | A photo or clip near the words. `behind` is centred on `hints.focus` in the far layer. `side` goes in the largest `hints.free` box, in the mid layer. `corner` goes in the lower right of the safe area. `free` is placed by `el.ornament#i.nudge`. The border is a stroked `K.shape` node. The shadow is 4 stepped offset shapes with alpha 0.08 each, with no filter. `appear` runs over `[a, rest]`; the exit is the automatic `follow: 'text'` envelope. |
| `textFill` | 文字の中に / Inside the text | cut, text | `place` (enum frame/text: the media fitted to the frame, or to `hints.focus` enlarged 10 %; auto `frame`) | The media in the text layer with `comp: 'atop'`; the text layer is isolated. `amount` → media alpha `0.4 + 0.6 · amount` (auto `{ value: 1 }`). |
| `mediaLayer` | 重ねる映像 / Overlay footage | run (atmos), own | `blend` (enum screen/multiply/overlay/normal; auto `screen`), `over` (enum text/behind: near layer or far layer; auto `text`) | Overlay footage such as light leaks, dust or rain over the scene. `amount` → alpha `0.2 + 0.8 · amount`. `sceneOnly`. |

- Each of these parts declares `needs: ['media']`, which is additive to the D§4.18.1 needs vocabulary.
- The lab (`ui/lab.js`, package B) gains `#media:<kind>/<key>@<aspect>&asset=fixture:<name>&t=…`, using the fake store's
  fixtures.

#### 11.5.8 Materials: the recipe layer `prim: 'media'` (§5.7.4 addition; `core/recipe`, package A; interpreter, package C)

```json
{ "prim": "media", "src": "", "fit": "cover", "place": { "anchor": "focus", "x": 0, "y": 0, "spread": 1 },
  "size": [0.4, 0.4], "shape": "round", "border": 8, "inks": ["ground"], "alpha": 1, "layer": "mid",
  "comp": "over", "time": { "clipIn": 0, "clipOut": 0, "speed": 1, "loop": "loop" },
  "move": [], "appear": { "at": "arrive", "draw": "grow", "dur": 0.5 } }
```

- `src` is `''` or an AssetId.
  - With `''`, the derived part gets a part param `src` (type `media`), a knob-like param that is always present. The
    user or the AI then swaps the picture without editing the recipe. This makes a material a reusable frame style.
  - With an id, that asset is fixed. The material's `mine.media` lists the ids, and the planner adds them to
    `plan.media`.
- **Limits:** ≤ 2 media layers per recipe, and ≤ 1 of them may be a video. Media layers are allowed only in ornament
  and ground recipes.
- **Static cost:** 0.4 ms per media layer, plus 1.5 ms with blur or alpha (`core/recipe.cost`).
- **Flash rule:** a media layer's alpha may not be modulated by `beat` or `impact` with `dur < 0.15`, which is the §5.8
  flash rule with `cover = size²`.
- **C's interpreter** draws the layer with `K.media` when the kit exports it, and skips the layer otherwise (the C-alone
  rule of §8.3). G's acceptance tests the complete path.
- **AI materials:** `AI_LAYER` (§5.10) gains `media: STR`: `''` means the part param; `'asset:<n>'` means an asset from
  the request's `[media]` list. Media layers are accepted only when the request allowed media (§11.6.1).

#### 11.5.9 おまかせ with the user's media (planner and `parts/mix`)

- **`registryFor(base, materials, media)`** (§5.9.2; the third argument is new):
  - For every entry of `media.list` with `pool: true`, it derives a ground def:
    `K.variant(photoPan, { key: MEDIA.keyOf(id), label: { ja: name, en: name }, blurb: { ja: 'マイ素材の写真・動画',
    en: 'Your photo or video' }, tags: ['soft'], pool: true, weight: 1.5, params: { image: { auto: { value: id } } },
    shared: {} })`, plus `mine: { id, rhash: id, cost: 0.4, by: 'user', media: true }`.
  - For a video it also sets `clock: { auto: { value: 'song' } }` and `move: { auto: { value: 'none' } }`.
  - The derived defs go through the same `REG.extend` call as the materials.
  - Memo key: `(base, materials, media)` identity.
- **`REG.extend` key rule** (§3.6 amended): keys match `^myMat[0-9a-z]+$` or `^myMed[0-9a-f]{10}$`, and `createRegistry`
  refuses both prefixes.
  - If two assets would get the same derived key (a 40-bit collision), the later one is skipped, and
    `registry.problems` gets `media-key`.
- **Chooser:** the derived defs join the ground pool like any part. They pass every season gate (no season), and filters
  may include or deny them. The existing recency and runner-up rules keep one photo from repeating in neighbouring
  segments.
- **Planner rules** (package D):
  1. A derived media ground is never chosen for a segment shorter than 3 s, and never for the `title` role; the weight
     is 0 there.
  2. `amount.groundSwitch` works unchanged.
  3. The why code is `media.pool {name}`.
- **UI:**
  - The part browser hides derived keys (`registry.extra[key].media`) from the 背景 tiles. Its 写真・動画 tab shows the
    assets themselves (§11.7.5).
  - The filter page (D§6.4.5 部品) lists them with the asset name, so 「これだけ使う」 can mean "only my photos".

#### 11.5.10 Fingerprints and caches

- A scene's `fp` covers its decisions, which include the media ids, plus `mediaTerms` (§11.2.6). Changing the photo,
  its crop or its range rebuilds only the scenes that use it.
- Media nodes are never rasterized into static layer caches. Stills are drawn live with `drawImage`, which is cheap
  because the bitmap is already decoded.
- The UI thumbnail cache key (D§7.3) adds the asset ids of the part being shown. Thumbnails of media parts draw posters
  only.

#### 11.5.11 Determinism rules (additions to D§7.1 and §7.1)

1. **Media time is closed-form in `t`** (§11.4.2). The source frame index is a pure function of the plan, `t` and the
   sample table. Node tests assert it through the recorder op hash.
2. **The export draws exact frames only** (the facade throws otherwise). The preview may draw provisional frames, and
   they are marked.
3. **Pixels of a decoded frame** are a function of (file, sample, browser build, decoder). Export forks prefer software
   decoders, so identical exports hold across machines with the same browser build for H.264, VP8, VP9 and AV1. HEVC
   and HDR are hardware or browser dependent and are labelled so.
4. **The still tier is fixed per scene and output scale,** never chosen per frame.
5. **No clock and no randomness** enter media code below L6. Hosts get time only through the injected `now` and `idle`.
6. **Frame N rendered directly equals frame N rendered after frames 0..N−1,** with media (`determinism.py`, §11.8.3).

#### 11.5.12 Performance budgets (against D§7.4; 720p preview, mid-range laptop, Chrome)

| Work | Budget |
|---|---|
| `drawMedia`, still, full frame | ≤ 0.3 ms |
| `drawMedia`, video frame, full frame (a hardware frame upload) | ≤ 0.8 ms |
| Isolated path (alpha, atop, video blur) | ≤ +1.2 ms per node |
| Mirror edges | ≤ 2 extra draws, usually 0 |
| WebM alpha merge | ≤ 7 ms per 1080p frame (preview: ≤ one such asset on screen for the 10 ms target) |
| `mediaAt(t)` | ≤ 0.05 ms (no behaviours; scene lists only) |
| Frame total with one video ground and one still frame | the D§7.4 frame total: ≤ 10 ms target, 16.7 ms hard (`perf.py`) |
| Scrub to a new time, GOP ≤ 2 s, 1080p, hardware | ≤ 250 ms to the exact frame (a poster or the nearest frame is shown first) |
| Export overhead of one 1080p30 H.264 background at 1080p30 | ≤ +35 % of the same project's export time without it |
| Import | hashing ≥ 150 MB/s; MP4 probe ≤ 300 ms; poster ≤ 200 ms |
| Re-plan with media pins | unchanged (media resolution is O(pins)) |

- The per-call `drawMedia` rows (still 0.3 ms, video 0.8 ms) assume a GPU: a frame upload and a scaled draw on the GPU.
  With software raster (the GitHub CI runner, headless browsers without a GPU), every scaled full-frame draw of any
  medium costs ≈ 2.6–3.5 ms per call, whatever the source size (measured with 480×270, 1472×828 and 1920×1080 bitmaps:
  2.6–3.0 ms; an unscaled blit 0.3 ms). The software figures are recorded in NOTES ("Perf: media row"). The figures of
  the reference laptop (§8.7) are still to be measured there.
- An unblurred video (depth `anim` or `still`) is drawn from its `VideoFrame`. With software raster, each such draw
  converts the whole 1080p frame (≈ 9.1–9.6 ms), and so does each mirrored neighbour. No way of preparing the frame ahead
  of the draw is cheaper per frame here (NOTES). The frame total of such a project therefore stays near or above twice
  the target in software. The prepared-frame principle ("draw a frame prepared ahead, at the size it is drawn") is
  applied to blurred video and animation only. Whether and how to apply it to unblurred video is open for the lead.
- The frame total of a media row is the whole iteration an exporter or a player runs: `await mediaReady(t)` (the
  store's main-thread work for that frame: decoder output, the blur bake) plus `renderFrame` (§11.8.3).

### 11.6 AI (package E; everything optional)

#### 11.6.1 The `direct` tool places media (§5.2–§5.5 additions)

- **When media is offered.** A request offers media only when `opts.media` is true. The UI sets it when the library has
  at least one asset whose bytes are on this device and the checkbox 「写真・動画をAIが使ってよい」 (under 詳しく, on by
  default) is ticked. The checkbox is one switch (`ui/ai_controller` `state.allowMedia`): the instruction block and the
  board (区画ごとに指示, which shows the same checkbox) both read it, and while it is off no request of either offers media.
- **Schema variant:** `directSchema({ mode, allowMaterials, media })` (§5.4) adds one property to `EDIT_PROPS`:

  ```js
  const MEDIA_AI = closed({ use: STR, as: en(['ground', 'frame', 'fill', 'overlay']), fit: en(['', 'cover', 'contain', 'soft']),
                            blur: NUM, veil: NUM, from: NUM, speed: NUM });
     // use: '' keep | 'none' (remove media the AI placed in the area) | 'asset:<n>' (the request's [media] list)
     // blur 0–60 du, veil 0–0.9, from = the clip's start (s), speed 0.25–4: −1 keep
  EDIT_PROPS += { media: MEDIA_AI }            // AREA_EDIT and LINE_EDIT; not CUT_EDIT; not the camera schema
  ```

  The portability test covers the variant.
- **What is sent.** A `[media]` list is added after the part lists. It holds no pixels and no file names, ever: an asset
  is its number, kind, length, size and shape, plus the vision text while the checkbox is on:
  ```
  [media] the user's own photos and videos (use only these, as "asset:<n>")
  asset:0 image 4032×3024 landscape — 夕方の海、オレンジの空 · colours #F2A65A #3D5A80 · text area: upper third
  asset:1 video 0:12 1920×1080 landscape — (no description)
  ```
  The description, colours, text area and subject come from `entry.ai` (§11.6.2) when present. The limit is 40 assets,
  taken in library order. A file name often says who or where (「山田花子_卒業式.jpg」), so it stays on this device (the
  review rows and warnings show it there). Derived media grounds (§11.5.9), whose labels are file names, are left out of
  every part list for the same reason.
- **AIで作り直す on a material with a media layer** (§11.5.8) sends a `[media]` list too, with the media schema even when
  the list is empty, so a picture the user picks (`src ''`) and a fixed asset survive: while the checkbox is on, the
  pictures on this device and the material's own, with their vision text; while it is off, only the material's own
  pictures, without it. A remake that still loses a media layer warns `ai.warn.matMediaLost`.
- **System prompt paragraph** (English; added only with media):
  「Media: the user's photos and videos are listed as asset:<n>. Use one only when the instruction asks for a photo or
  video, or when it clearly fits the area. as = ground (background of the area), frame (a framed photo near the words),
  fill (inside the letters), overlay (footage over the scene). Prefer ground for wide scenic pictures, frame for people
  and objects, fill for textures. Never invent assets.」
- **Mapping** (§5.5 table additions; every pin is `by: 'ai'`, in area lines or at `work` scope):

  | Answer | Changes | Kind |
  |---|---|---|
  | `media.use = 'asset:n'`, `as: 'ground'` | `ground = photoPan`, `ground@photoPan.image = id`, and `fit`, `blur`, `veil`, `clipIn` (`from`), `speed` when not `''` or −1 | `part` + `value` (agg per slot) |
  | `as: 'frame'` | `ornament#<first free idx> = photoFrame` and `…@photoFrame.src = id` (plus the same params) | `part` + `value` |
  | `as: 'fill'` | `ornament#<first free idx> = textFill` and `…@textFill.src = id` | `part` + `value` |
  | `as: 'overlay'` | `atmos = mediaLayer` and `atmos@mediaLayer.src = id` | `part` + `value` |
  | `use: 'none'` | clears pins `by: 'ai'` in the area whose value is a media part (`photoPan`, `photoFrame`, `textFill`, `mediaLayer`) or an AssetId | `value` |

- **Checks:**
  - `n` must be in the sent list, else `ai.warn.mediaUnknown`.
  - The kind must fit the part's `accept`.
  - A video with `from ≥ dur` is clamped to 0.
  - Every other §5.5 rule applies unchanged: locked lines, the area guarantee, the free-index rule.
- **Review rows** read 「背景: 自動 → 写真「海辺.jpg」（5行）」 and show the poster as a 32 px thumbnail.

#### 11.6.2 Vision: 「AIに説明してもらう」 (new module `ai/vision`; Gemini only)

- **Why it exists:** a caption, tags, colours, a subject box and a calm text area make the `direct` answers better.
  Nothing else uses them.
- **Consent.**
  - Before anything is sent, a consent question appears, every time 「AIに説明してもらう」 sends pictures: nothing is
    remembered. `ui/ai_controller` holds the agreed asset ids for that one run only (and the vision tool sends nothing
    else); they are cleared when the run starts and on a new or opened project.
  - Wording (it states the real payload): 「選んだ写真・動画を小さな静止画にして Google Gemini に送ります（長い辺 768px の
    JPEG、1枚 約{kb}KB。動画・アニメは3枚）。ファイル名は送りません。送るたびにたずねます。」 / "The selected photos and videos
    will be sent to Google Gemini as small stills (JPEG, 768 px long side, about {kb} KB per image; a video or animation
    sends 3 frames). File names are not sent. You are asked every time."
- **What is sent:**
  - **Photos:** one JPEG at quality 0.8, 768 px on the long side. The host makes it from the decoded still with
    `canvas.convertToBlob`, and EXIF is not included.
  - **Videos and animations** (an animated GIF or WebP, 「アニメ」): 3 JPEGs, at 10 %, 50 % and 90 % of the used range.
  - At most 8 assets per request.
  - The only text is the prompt below: no lyrics, and no file names beyond the list index.
- **API:**

  ```js
  VISION_SCHEMA = closed({ items: arr(closed({ n: INT, caption: STR, captionEn: STR, tags: STRS, colors: STRS,
    subject: closed({ x: NUM, y: NUM, w: NUM, h: NUM }), text: closed({ x: NUM, y: NUM, w: NUM, h: NUM }),
    use: en(['ground', 'frame', 'fill', 'overlay']) })) })
  visionRequest(doc, items: [{ id, parts: [{ inline_data: { mime_type: 'image/jpeg', data: base64 } }] }], { uiLang })
    → { system, prompt, schema: VISION_SCHEMA, effort: 'low', media: parts }      // parts precede the prompt (D§4.22.1)
  visionChanges(doc, json, sent) → { changes: Change[], warnings }                // kind 'media' → media.meta { id, ai }
  ```

- **Validation:**
  - captions are trimmed to 60 characters, and syntax and control characters are removed;
  - `tags` ⊂ the D§4.18.1 vocabulary;
  - `colors` are `#RRGGBB`, at most 5;
  - boxes are clamped to [0, 1];
  - `use` is advisory: it is shown, and not applied.
- **Review.** Each change row shows the caption and swatches. Applying runs one `store.batch`. The AI log keeps the
  previous `ai` for selective revert. `Change.kind` gains `media`.
- **The second AI service.** The tool is disabled with 「写真の説明は Google Gemini のときだけ使えます」. Vision with that service is out of scope
  (§10).

#### 11.6.3 Local colour matching (no AI)

- The asset page's [この色に合わせる]:
  1. The host decodes the still (or the poster, for a video) at 64×64 and reads it with `getImageData`.
  2. `media/palette.dominant` returns up to 5 colours.
  3. The UI proposes `accent` (the most saturated colour with contrast ≥ 3:1 against the resolved ground, using
     `C.fitContrast`), plus `shiftA` and `shiftB` (the next two).
- It is dispatched as one batch of `work:color.*` pins, labelled 「色を写真に合わせる」.
- The same colours feed the `[media]` list when `entry.ai` has none.

#### 11.6.4 Privacy (D§4.22.6, restated)

- Media bytes leave the device only through the vision tool, only to Gemini, and only after a consent asked each time.
- No prompt of any tool (direct, board, camera, material, looks, prep, song, vision) holds a photo or video file name.
  An asset is `asset:<n>` with its kind, size, length and shape; the vision text (caption, colours, text area, subject)
  goes only while 「写真・動画をAIが使ってよい」 is on. `ai_privacy.test.js` checks every tool's prompts.
- The always-visible notice says exactly this: 「写真・動画について送るのは、番号・種類・大きさ・長さ・縦長か横長かだけです（ファイル名は
  送りません）。『写真・動画をAIが使ってよい』がオンのときは、『AIに説明してもらう』で付いた説明・色・位置も送ります」 and
  「写真・動画そのものは、『AIに説明してもらう』でそのつど同意したときだけ、小さな静止画にして Google Gemini に送ります（動画・
  アニメは3枚）」.

### 11.7 UI (package G; D§6 additions)

#### 11.7.1 Top level: unchanged

- The header, the play bar and the step bodies keep their control budgets (`ui_layout.py` unchanged). Step ③ keeps
  its 5 controls.
- Step ③'s help line gains one sentence, which is text, not a control:
  「写真や動画はプレビューにドロップすると背景になります（詳しく… › 写真・動画）」 / "Drop a photo or video on the preview
  to use it as the background (Options… › Photos and videos)."
- **Drop overlay** (the existing `is-dropping` state):
  - the page overlay reads 「ここにドロップ: 歌詞・曲・作品・写真・動画」;
  - while the pointer is over the stage, the stage outline reads 「背景にする（{scope}）」.
- **Nothing covers the preview.** Progress and choices appear in the toast host (D§6.4.11) and the detail column.

#### 11.7.2 Import flows (`ui/media_io`)

| Where | What happens |
|---|---|
| **Drop on the stage** | Each file is imported (§11.4.13). The **first** image or video is then placed as the background at the current scope: 作品全体 when nothing, the root or a work page is selected; the selected lines (every line of a multi-line or area selection); the selected cut. This is one `store.batch`: `media.put`, `pin.set …:ground photoPan`, `pin.set …:ground@photoPan.image id`. Toast: 「背景を写真にしました（{scope}） [元に戻す] [ほかの使い方…]」. |
| **Drop elsewhere, ≡ › ファイル › 写真・動画を読み込む…, the library's [＋ 読み込む], the picker's ＋ tile** | Import only (`media.put`). Toast 「{n}件を読み込みました [使い方を選ぶ]」, which opens the asset page (§11.7.3). From a picker (§11.7.5), the imported asset is also picked. |
| **Paste** (a `paste` event carrying image files, outside text fields) | Import only. Without files, Ctrl+V keeps pasting the look (D§6.8). |
| **Step ② drop of a video with audio** | Routed to media, as everywhere else. The toast adds [この動画の音を曲にする]. |

- **Routing** (`openFiles`, D§6.14 `project_io`):
  - the sniffer decides, not the extension;
  - an MP4, MOV or WebM with a video track goes to media;
  - audio-only MP4/M4A/WebM, and the audio extensions, go to the song;
  - `.mojipv` and `.json` go to open project (§12);
  - `.txt` and `.lrc` go to lyrics.
- **Progress.** A single toast row reads 「読み込み中: 海辺.mp4 45%」 with [中止]. Imports run one at a time. The queue
  count shows as 「（あと2件）」.
- **Duplicates.** A file whose id is already in `doc.media` gives 「もう入っています: 海辺.mp4」, selects it, and places
  it when it was dropped on the stage.

#### 11.7.3 The library and the asset page

**作品全体 › 写真・動画** (`sec.media`; open when the library is not empty; placed after 見た目):

```
▾ 写真・動画  4                                              [＋ 読み込む]
  [▦ 64×36] 海辺.mp4      動画 0:12 · 1920×1080     使用 2   ◉ おまかせ   ⋯
  [▦ 64×36] 空.jpg        写真 4032×3024            使用 1   ○            ⋯
  [▦ 64×36] ロゴ.png      写真 透明 · 800×800        使用 0   ○            ⋯
  [ ？    ] 夜景.mov      この端末にありません                      [つなぎ直す]
  1.4 GB（この端末の空き 38 GB）
```

- A click on a row opens the asset page.
- The おまかせ toggle dispatches `media.meta { pool }`.
- ⋯ offers: 開く · 名前を変える · 上へ / 下へ (`media.move`) · 置き換える… (`media.relink`) · この写真を使わない (the pins,
  in one batch) · 削除.
- Rows are a listbox (D§6.12): Del removes after confirmation, and Enter opens.

**Asset page** (`ui/media_page`; crumb 「全体 › 写真・動画 › 海辺.mp4」):

```
海辺.mp4  ✎                                  動画 · 1920×1080 · 0:12.5 · 29.97fps · 48 MB
[ poster at column width; hover or focus scrubs the filmstrip ]
使う
  [作品全体の背景] [選択中の12行の背景] [このカットの背景]
  [文字の中に] [写真の枠として] [重ねる映像]
おまかせでも背景に使う  [ ]
使っている場所 3  › 作品全体（背景） · 12–16行（枠） · サビ1（文字の中）      ← click = select that scope and element
色  ■ ■ ■ ■ ■   [この色に合わせる]
AI  [AIに説明してもらう…]   夕方の海、オレンジの空（AIの説明）
[この動画の音を曲にする]                                          ← only when entry.audio
[置き換える…]  [削除]   「使っている3か所は元の見た目に戻ります」
```

- **Placement buttons** pin at a scope in one batch.
  - 選択中 buttons use the current selection, or the area when `sel.area` is set (every line of the area). They are
    hidden when nothing fits.
  - 文字の中に and 写真の枠として use the first free ornament index (the §5.5 rule) at that scope.
  - After placing, the page jumps to the element page that holds the new rows.
- **The badges** of §11.2.8 appear under the title.

#### 11.7.4 Element pages with media

**要素 › 背景** (D§6.4.8; any scope; the rows appear when the ground part has a `media` param):

```
全体 › 要素 › 背景
▾ 背景
  種類   [▶ thumb] 写真・動画                 ›
  写真・動画 [▦] 海辺.mp4                     ›      ← media widget → picker (§11.7.5)
  収め方 [覆う | 全体 | 全体＋ぼかし]
  切り抜き [画面で調整]  拡大 ──●── 100%            ← toggles the stage overlay (§11.7.6)
  動き [自動 v]   強さ ──●── 10%   向き ──●── 30°
  ぼかし ──●── 0    薄幕 ──●── 35%  [■ 背景色 v]
  色味 ──●── 0  [■ アクセント v]                     (詳細)
▾ 動画                                               ← video and animation only
  使う範囲 [▮━━━━━━━━━━▮ filmstrip]  0:02.10 – 0:09.50  ← trim widget (§11.7.7)
  速さ ──●── 100%   終わったら [くり返す | 止める]   時間 [表示から | 曲に合わせる] (詳細)
▸ 空気（粒子）…
```

- **要素 › 文字** (D§6.4.8) gains the row 「文字の中に写真・動画」. It is a shortcut that manages the first `textFill`
  ornament slot at the page's scope: a media widget, plus the fit and crop rows.
- **要素 › 装飾:** a slot whose part is `photoFrame` or `mediaLayer` shows the media rows under the part row.

#### 11.7.5 The media widget, its picker and the part browser tab

- **The `media` widget** (for every param of type `media`) shows a 64×36 poster, the name and badges (動画 0:12, 透明,
  GIF), then ›. Clicking it opens the **media picker page**, an inspector sub-page:
  - tiles are 144×81 posters (animated on hover or focus only, respecting reduced motion);
  - the first tile is [＋ 読み込む], the second なし;
  - assets whose kind does not fit `accept` are hidden;
  - hover or focus = try-on of that asset in the main preview (250 ms delay, D§6.7);
  - Enter or click pins it.
- **Part browser:** the kinds `ground`, `ornament` and `atmos` gain a tab 「写真・動画 {n}」 (`pb.tab.media`), shown when
  the library is not empty. Its tiles are assets.
  - Clicking one pins the kind's media part and its source in one batch:
    - `ground` → `photoPan`;
    - `ornament` → `photoFrame`;
    - `atmos` → `mediaLayer`.
  - The first tile is [＋ 読み込む].

#### 11.7.6 The crop overlay on the stage (`ui/stage`)

- It is active while 切り抜き [画面で調整] is pressed, for the selected element's media node (from `engine.boxes()` and
  the node's `FitRect`).
- **It shows:** the source rect's frame on the stage overlay canvas; everything outside the chosen crop dimmed at 40 %;
  and a centre cross at the focus.
- **Mouse:** dragging moves the focus (`cropX`, `cropY`), and the wheel zooms (`cropZoom`, ×1.05 per notch). Both are
  one `store.gesture` each. A double-click resets both (`pin.clear` of the three). Alt disables snapping to centre and
  thirds.
- **Keyboard** (the stage has focus): arrow keys move the focus by 1 % (Shift 10 %), `+` and `−` zoom, `0` resets, and
  Esc leaves.
- The overlay draws on the overlay canvas only, never on the preview canvas.

#### 11.7.7 The trim widget (`ui/media_widgets`, registered as `trim`)

```
使う範囲  ▮▯▯▯▯▯▯▯▯▯▯▯▮   0:02.10 – 0:09.50   (7.40 秒)   [▶ 範囲を見る]
          ↑ in           ↑ out   filmstrip: the thumbs store, 12 frames
```

- **Dragging a handle** writes `clipIn` or `clipOut` as one gesture. While a handle is dragged, the stage shows a
  **peek**, the source frame at the handle time fitted to the preview. It is a try-on-style temporary view, with the mode
  strip 「使う範囲を調整中」, and it ends on release.
- **Keyboard:** the handles are buttons. ←/→ move one source frame (from the sample table), Shift+←/→ move 1 s, and
  Home/End jump to the ends.
- **[▶ 範囲を見る]** seeks the playhead to the element's next appearance and plays.

#### 11.7.8 Missing media and placeholders

- **Preview placeholder** for a missing asset: a checkerboard of `muted`/`ground2` at the element's `dest` rect, plus
  the text 「写真がありません: {name}」, drawn by `drawMedia` in the preview only.
- **Export:** the preflight item `media-missing` (level `block`) with [つなぎ直す] jumps to the library.
- **Open with missing media:** a toast 「{n}件の写真・動画がこの端末にありません [つなぎ直す]」.

#### 11.7.9 Error and warning states

| Situation | What the user sees |
|---|---|
| Unknown file type | toast `media.err.type` |
| HEIC | toast `media.err.heic` |
| Codec not decodable here (ProRes, HEVC on this PC, …) | toast `media.err.codec` naming the codec |
| No WebCodecs (video) | toast `media.err.noWebCodecs` |
| Too big (§11.2.8) | toast `media.err.tooBig` / `.tooLarge` / `.tooLong` / `.animTooBig` |
| Broken file (demux or decode fails) | toast `media.err.broken` |
| SVG that taints the canvas | toast `media.err.svg` |
| Storage full | toast `media.err.quota` with [ファイルに保存] (§12) |
| No IndexedDB | toast `media.warn.memoryOnly` |
| Decode error during preview | placeholder with 「この動画を再生できませんでした」; library row badge |
| Preflight: `media-missing` (block) | 「写真・動画がこの端末にありません: {name}」 [つなぎ直す] |
| Preflight: `media-skipped` (info) | 「背景の写真・動画は『{bg}』では書き出されません」 |
| Preflight: `media-hdr` (info) | 「HDR の動画は近い色で書き出されます: {name}」 |
| Preflight: `media-heavy` (info) | 「速さ×{s} の動画は書き出しに時間がかかります: {name}」 |
| Planner `media-missing` / `media-kind` warnings | inspector field warnings (D§6.6) |

#### 11.7.10 Keyboard and accessibility

- **No new global single keys.** The keymap of D§6.8 is unchanged; the crop keys work only while the overlay is active
  and the stage has focus.
- **Screen readers:**
  - library rows, picker tiles and the trim handles have `aria-label`s (`media.a11y.row`, `.tile`, `.in`, `.out`);
  - import progress is announced through the polite live region at most once every 5 s;
  - the drop target is announced when files enter the stage.
- **Reduced motion:** posters are still until focused, and the filmstrip does not autoplay.

#### 11.7.11 Strings (`i18n/strings.js`, pairs [ja, en]; package A writes them all)

| Key | ja | en |
|---|---|---|
| `sec.media` | 写真・動画 | Photos and videos |
| `media.import` / `media.importMenu` | ＋ 読み込む / 写真・動画を読み込む… | + Import / Import photos and videos… |
| `media.kind.image` / `.video` / `.anim` | 写真 / 動画 / アニメ | Photo / Video / Animation |
| `media.badge.alpha` / `.gif` / `.hevc` / `.hdr` / `.gop` | 透明 / GIF / 一部のパソコンでは読めない形式です / HDR の色は近い色で表示されます / 位置合わせに時間がかかる動画です | Transparent / GIF / Some computers cannot read this format / HDR colours are approximated / Seeking in this video is slow |
| `media.used` / `media.pool` | 使用 {n} / おまかせでも背景に使う | Used {n} / Use as a background in New look |
| `media.missing` / `media.relink` | この端末にありません / つなぎ直す | Not on this device / Relink |
| `media.relinkAsk` | 別のファイルですが、この{kind}の代わりに使いますか？（{name}） | This is a different file. Use it instead of this {kind}? ({name}) |
| `media.total` | {size}（この端末の空き {free}） | {size} ({free} free on this device) |
| `media.use.work` / `.lines` / `.cut` | 作品全体の背景 / 選択中の{n}行の背景 / このカットの背景 | Background of the whole video / Background of the {n} selected lines / Background of this cut |
| `media.use.fill` / `.frame` / `.overlay` | 文字の中に / 写真の枠として / 重ねる映像 | Inside the text / As a photo frame / As overlay footage |
| `media.usedAt` | 使っている場所 {n} | Used in {n} places |
| `media.colors` / `media.matchColors` | 色 / この色に合わせる | Colours / Match these colours |
| `media.askAi` / `media.aiCaption` | AIに説明してもらう… / {caption}（AIの説明） | Ask AI to describe… / {caption} (AI description) |
| `media.useAudio` | この動画の音を曲にする | Use this video's sound as the song |
| `media.replace` / `media.rename` / `media.notUse` / `media.delete` | 置き換える… / 名前を変える / この写真を使わない / 削除 | Replace… / Rename / Stop using this / Delete |
| `media.deleteNote` | 使っている{n}か所は元の見た目に戻ります | The {n} places that use it go back to their previous look |
| `media.progress` / `media.queue` | 読み込み中: {name} {p}% / （あと{n}件） | Importing {name} {p}% / ({n} more) |
| `media.done` / `media.chooseUse` | {n}件を読み込みました / 使い方を選ぶ | Imported {n} / Choose how to use it |
| `media.placed` / `media.otherUses` | 背景を写真にしました（{scope}） / ほかの使い方… | The background is now your photo ({scope}) / Other uses… |
| `media.dup` | もう入っています: {name} | Already in the library: {name} |
| `media.dropHere` / `media.dropStage` | ここにドロップ: 歌詞・曲・作品・写真・動画 / 背景にする（{scope}） | Drop here: lyrics, song, project, photos, videos / Use as background ({scope}) |
| `media.lookHint` | 写真や動画はプレビューにドロップすると背景になります（詳しく… › 写真・動画） | Drop a photo or video on the preview to use it as the background (Options… › Photos and videos) |
| `media.placeholder` / `media.cannotPlay` | 写真がありません: {name} / この動画を再生できませんでした | Photo missing: {name} / This video could not be played |
| `media.preparing` | 映像を準備中 | Preparing video |
| `media.missingOpen` | {n}件の写真・動画がこの端末にありません | {n} photos or videos are not on this device |
| `media.full` | 写真・動画は200件までです | Up to 200 photos and videos |
| `media.warn.big` / `.bigFile` / `.memoryOnly` | 写真・動画が {size} あります。作品ファイルが大きくなります / 大きなファイルです（{size}）。読み込みに時間がかかります / この端末に保存できないため、写真・動画はこのタブを閉じると消えます。作品ファイルに保存してください | Your photos and videos take {size}; project files get large / Large file ({size}); importing takes a while / Photos and videos cannot be stored on this device and disappear when this tab closes. Save a project file. |
| `song.warn.memoryOnly` / `media.warn.memoryOnlyAll` | この端末に保存できないため、曲はこのタブを閉じると消えます。作品ファイルに保存してください / この端末に保存できないため、写真・動画と曲はこのタブを閉じると消えます。作品ファイルに保存してください | The song cannot be stored on this device and disappears when this tab closes. Save a project file. / Photos, videos and the song cannot be stored on this device and disappear when this tab closes. Save a project file. |
| `media.err.type` / `.heic` | 読めない種類のファイルです: {name} / HEIC は読めません。JPEG に変換してから読み込んでください（iPhone: 設定 › カメラ › フォーマット › 互換性優先） | Cannot read this kind of file: {name} / HEIC cannot be read. Convert it to JPEG first (iPhone: Settings › Camera › Formats › Most Compatible) |
| `media.err.codec` | この動画の形式（{codec}）はこのブラウザでは読めません。H.264 の MP4 か WebM に変換してください | This video's format ({codec}) cannot be read in this browser. Convert it to an H.264 MP4 or a WebM |
| `media.err.noWebCodecs` | このブラウザでは動画を読めません。PC の Chrome か Edge を使ってください | This browser cannot read videos. Use Chrome or Edge on a computer |
| `media.err.tooBig` / `.tooLarge` / `.tooLong` / `.animTooBig` | 大きすぎる画像です（4000万画素・60MBまで） / 4K より大きい動画は読めません / 60分より長い動画は読めません / 長すぎるアニメです（600コマ・2048pxまで） | Image too large (up to 40 MP, 60 MB) / Videos larger than 4K cannot be read / Videos longer than 60 minutes cannot be read / Animation too long (up to 600 frames, 2048 px) |
| `media.err.broken` / `.svg` / `.quota` | 壊れているか、途中までのファイルです: {name} / この SVG は安全に取り込めません / 保存容量がいっぱいです。作品ファイルに保存してください | The file is damaged or incomplete: {name} / This SVG cannot be imported safely / Storage is full. Save a project file |
| `exp.pre.media-missing` / `.media-skipped` / `.media-hdr` / `.media-heavy` | §11.7.9 | §11.7.9, in English |
| `fld.media` / `fld.fit` / `fld.crop` / `fld.cropZoom` / `fld.cropX` / `fld.cropY` | 写真・動画 / 収め方 / 切り抜き / 拡大 / 中心 横 / 中心 縦 | Photo or video / Fit / Crop / Zoom / Focus X / Focus Y |
| `fld.cropEdit` / `fld.edge` / `fld.move` / `fld.moveAmount` / `fld.moveDir` | 画面で調整 / 端の処理 / 動き / 動きの強さ / 動く向き | Adjust on the preview / Edges / Motion / Motion amount / Direction |
| `fld.blur` / `fld.veil` / `fld.veilInk` / `fld.tint` / `fld.tintInk` | ぼかし / 薄幕 / 薄幕の色 / 色味 / 色味の色 | Blur / Veil / Veil colour / Tint / Tint colour |
| `fld.trim` / `fld.speed` / `fld.loop` / `fld.clock` / `fld.trimPlay` | 使う範囲 / 速さ / 終わったら / 時間の基準 / 範囲を見る | Range / Speed / At the end / Clock / Play the range |
| `fld.textMedia` / `sec.video` | 文字の中に写真・動画 / 動画 | Photo or video inside the text / Video |
| `opt.cover` / `.contain` / `.soft` | 覆う / 全体 / 全体＋ぼかし | Fill / Whole / Whole + blur |
| `opt.mirror` / `.zoom` / `.plain` | 映り込み / 拡大 / 背景色 | Mirror / Enlarge / Plain |
| `opt.push` / `.pull` / `.drift` | 寄る / 引く / 流す | Push in / Pull out / Drift |
| `opt.loop` / `.hold` / `.show` / `.song` | くり返す / 止める / 表示から / 曲に合わせる | Loop / Hold / From when shown / With the song |
| `opt.behind` / `.side` / `.corner` / `.free` / `.frame` / `.text` | 文字の後ろ / 空いている所 / 角 / 自由 / 画面全体 / 文字のまわり | Behind the text / In the free space / Corner / Free / Whole frame / Around the text |
| `opt.rect` / `.round` / `.circle` / `.arch` | 四角 / 角丸 / 円 / アーチ | Rectangle / Rounded / Circle / Arch |
| `opt.screen` / `.multiply` / `.overlay` / `.normal` | スクリーン / 乗算 / オーバーレイ / 通常 | Screen / Multiply / Overlay / Normal |
| `opt.fade` / `.grow` / `.slide` | ふわっと / 大きく / すべる | Fade / Grow / Slide |
| `pb.tab.media` / `pb.importTile` | 写真・動画 {n} / ＋ 読み込む | Photos and videos {n} / + Import |
| `media.peek` | 使う範囲を調整中 | Adjusting the range |
| `media.a11y.row` / `.tile` / `.in` / `.out` | {name}、{kind}、{info} / {name}（{kind}） / 始め {time} / 終わり {time} | {name}, {kind}, {info} / {name} ({kind}) / Start {time} / End {time} |
| `ai.direct.allowMedia` / `ai.warn.mediaUnknown` | 写真・動画をAIが使ってよい / 「{name}」という写真・動画はありません | AI may use photos and videos / There is no photo or video "{name}" |
| `ai.tool.vision` / `ai.visionConsent` / `ai.visionOnlyGemini` | 写真の説明 / 選んだ写真・動画を小さな静止画にして Google Gemini に送ります（長い辺 768px の JPEG、1枚 約{kb}KB。動画・アニメは3枚）。ファイル名は送りません。送るたびにたずねます。 / 写真の説明は Google Gemini のときだけ使えます | Describe photos / The selected photos and videos will be sent to Google Gemini as small stills (JPEG, 768 px long side, about {kb} KB per image; a video or animation sends 3 frames). File names are not sent. You are asked every time. / Photo descriptions work only with Google Gemini |
| `ai.sendsMedia` | 写真・動画そのものは、『AIに説明してもらう』でそのつど同意したときだけ、小さな静止画にして Google Gemini に送ります（動画・アニメは3枚） | The pictures themselves go to Google Gemini, as small stills (3 for a video or animation), only when you agree each time under "Ask AI to describe" |
| `ai.sendsMediaList` | 写真・動画について送るのは、番号・種類・大きさ・長さ・縦長か横長かだけです（ファイル名は送りません）。『写真・動画をAIが使ってよい』がオンのときは、『AIに説明してもらう』で付いた説明・色・位置も送ります | For photos and videos, only their number, kind, size, length and shape are sent (never file names). While "AI may use photos and videos" is on, the description, colors and positions from "Ask AI to describe" are sent too |
| `ai.warn.matMediaLost` | 素材「{name}」の写真・動画が作り直しでなくなりました | The remake of "{name}" lost its photo or video |
| `ai.warn.matFull` | マイ素材がいっぱいのため、新しい素材を{n}個作れませんでした（64個・160KBまで） | My materials are full, so {n} new material was not made (up to 64, 160 KB) (plural: …materials were not made…) |
| `ai.ch.media` | 写真「{name}」の説明: {caption} | Description of "{name}": {caption} |
| `undo.media.put` / `.meta` / `.move` / `.remove` / `.relink` / `.place` / `.colors` | 写真・動画を追加 / 写真・動画の設定 / 写真・動画の並べ替え / 写真・動画を削除 / 写真・動画を置き換え / 写真・動画を使う（{scope}） / 色を写真に合わせる | Add photo or video / Photo or video settings / Reorder photos and videos / Delete photo or video / Replace photo or video / Use photo or video ({scope}) / Match colours to the photo |
| `warn.media-missing` / `warn.media-kind` | 写真・動画が見つかりません（{detail}） / この場所には使えない種類です（{detail}） | A photo or video is missing ({detail}) / This kind cannot be used here ({detail}) |
| `why.media.pool` / `why.media.pin` | おまかせでマイ写真「{name}」 / 選んだ写真・動画「{name}」 | Your photo "{name}" picked by New look / Your chosen photo or video "{name}" |
| `part.ground.photoPan` (changed) | 写真・動画 | Photo or video |
| `menu.clearDevice` (changed) | この端末に保存した作品・曲・写真・動画を消す | Clear projects, songs, photos and videos stored on this device |

Part labels and blurbs of `photoFrame`, `textFill` and `mediaLayer` live in their definitions (D§4.18.1), as the
§11.5.7 table gives them.

### 11.8 Tests

#### 11.8.1 Fixtures

- **Generated at test time**, in the browser, so there are no binary files for the main flows (`tests/helpers/media_gen.js`,
  package G):
  - **The counter video.** Frame `i` shows `i` as a 12-bit code of 8×8-px black and white cells, plus a guard frame, at
    192×108. It is encoded with `VideoEncoder`: VP9 always; H.264 when the browser can encode it (Chrome CI).
  - **Containers:** MP4 through mp4-muxer; WebM through the `export/webm` writer (§13.5).
  - **Rates:** 24, 25, 30, 30000/1001 and 60 fps. A **VFR** variant has frames 0–29 at 30 fps and frames 30–44 at
    15 fps.
  - **Alpha:** a VP9 **alpha** WebM through §13.5's two-encoder path, with a half-transparent square that moves.
  - **Stills:** PNG with alpha, JPEG and WebP from `convertToBlob`. A JPEG gets **EXIF orientation 6** by inserting an
    APP1 segment made by `tests/helpers/exif_write.js`.
  - **Animation:** an APNG or animated WebP of 10 frames, where the browser encodes them; otherwise it is skipped with a
    note.
- **Committed**, tiny, for demuxer edge cases the browser cannot produce (`tests/fixtures/media/`; each file < 24 KB;
  made once with the ffmpeg command lines recorded in `tests/fixtures/media/MAKE.txt`, so anyone can regenerate them):

  | File | What it tests |
  |---|---|
  | `bframes.mp4` | H.264 with B-frames, `ctts` and an edit list: `-c:v libx264 -bf 2 -g 10` |
  | `frag.mp4` | fragmented MP4: `-movflags +frag_keyframe+empty_moov` |
  | `rot90.mp4` | a rotation matrix: `-metadata:s:v rotate=90` |
  | `clip.mov` | QuickTime brand |
  | `vp9.webm` | VP9 in WebM: `-c:v libvpx-vp9 -g 10` |
  | `alpha_vp8.webm` | VP8 with alpha: `-c:v libvpx -auto-alt-ref 0 -pix_fmt yuva420p` |
  | `av1.webm` | AV1: `-c:v libaom-av1 -cpu-used 8` |
  | `laced.mkv` | Xiph lacing on an audio track plus a video track |
  | `anim.gif` | 10 frames |
  | `prores.mov` | `-c:v prores_ks -profile:v 4444`: a refusal test |
  | `heic.heic` | a 1×1 HEIC header only: a refusal test |

  Every clip is 1 s of `testsrc2` at 64×36. The Node demuxer tests assert their tables against the values recorded in
  `MAKE.txt`, as dumped by `ffprobe -show_packets`.
- **Node tests** also build synthetic files: mp4-muxer runs in Node under `vm` with fake chunks, and `export/webm` writes
  WebM. The demuxers must return exactly the table that was written.

#### 11.8.2 Node tests (`tests/node`)

| File | Owner | Asserts |
|---|---|---|
| `media_core.test.js` (new) | A | `entryProblems` for every field rule; `normalizeEntry` idempotent; `mapTime` loop, hold, speed and clock over 10k random cases against a numeric reference; `fitRect` cover, contain and soft invariants (dest inside the box; source inside the image; the focus stays centred when it can; zoom 1 cover fills exactly); `tier` monotone; `refsOf`; `keyOf`/`idOfKey` |
| `media_doc.test.js` (new) | A | schema 1 → 2 adds `media`; a schema-2 file without `media` is normalized; `serialize` order; `media.put`/`.meta`/`.move`/`.remove`/`.relink` reducers (pins, derived keys, `@key` paths, avoid items and recipes rewritten; identity when unchanged; caps); 500 random command sequences with media undo to the start; `schema.coerce` for `media` |
| `sha256.test.js` (new) | G | NIST vectors; 1-byte to 1-MB chunking gives the same digest; equals `crypto.subtle` (Node `webcrypto`) on 200 random buffers |
| `media_demux.test.js` (new) | G | `sniff` on every fixture, including refusals; `isobmff` on synthetic mp4-muxer files (the table equals what was written: pts, dts, key, off, size) and on committed fixtures (`bframes`: presentation order, pre-roll excluded; `frag`; `rot90` → `rot 90`, `w`/`h` swapped; `clip.mov`; codec strings); `matroska` on `export/webm` output and the committed WebM files (alpha ranges, VP9 profile and bit depth, AV1 string, laced audio skipped); refusals (`prores` codec string kept and later refused; truncated files → `MediaError('broken')`); reading only headers (a counting `read` asserts that no payload byte is read for MP4, and ≤ 1 pass for WebM) |
| `media_samples.test.js` (new) | G | `sampleAt` at every frame boundary of 24, 25, 29.97, 30, 60 fps and VFR tables (the EPS rule: `m = k / fps` picks frame k, with no off-by-one over 100k boundaries); `runFor` with B-frames; `keyAtOrBefore`; `toData`/`fromData` round trip; `stats` |
| `media_palette.test.js` (new) | G | deterministic output; 5 colours of a synthetic 5-band image recovered within ΔE < 2 |
| `schema.test.js`, `registry.test.js`, `commands.test.js`, `doc.test.js`, `i18n.test.js` (+) | A | type `media`; `extend` accepts `myMed<10 hex>` and `createRegistry` refuses it; the new commands; string pairs |
| `media_engine.test.js` (new) | B | with `fake_media.js`: `sb.media` checks; `K.media` for every `use`; the recorder op hash covers media time, and the source index equals `sampleAt` at 24, 30 and 60 fps output times (60 s of frames); mirror edge neighbours only when visible; rotation 0/90/180/270; `soft` draws the blurred copy first; `sceneOnly` skipped for chroma, black and clear; the `layers: 'ground'` option; `mediaAt` equals the drawn list; export quality throws `media-not-ready` on a non-exact frame; frame N direct equals N after 0..N−1; conformance of `photoPan`, `photoFrame`, `textFill` and `mediaLayer` (no NaN, balanced save/restore, same op hash twice) × 7 aspects × 24 times |
| `planner_media.test.js` (new) | D | `plan.media` holds exactly the referenced ids; `mediaTerms` change only the fps of the cuts that use them; segment break on a changed source (and not without media pins: goldens equal); `media-missing` and `media-kind` warnings fall back to `''`; derived `myMed` grounds chosen only when `pool`; never for segments < 3 s or `title`; filters include and deny them; explain `media.pool` |
| `mix.test.js` (+) | C | `registryFor(base, materials, media)`: derived defs per pooled asset, memoized, `version` changes on the `pool` toggle only; recipe `prim: 'media'` normalize, limits, cost and flash rule; interpreter via `K.media` |
| `ai_direct.test.js` (+), `ai_vision.test.js` (new) | E | the media schema variant is portable; every mapping row; an unknown asset warns; kind mismatch; `none`; the `[media]` list holds no data beyond numbers, kinds, sizes, lengths, shapes and (while allowed) the vision text, never a file name (`ai_privacy.test.js`: no prompt of any tool holds one); vision request (image parts first, ≤ 8 assets, JPEG only); `visionChanges` clamps and filters; revert |
| `ui_media.test.js` (new) | G | routing by sniff (a WebM with video goes to media; audio-only WebM goes to the song); placement batches per scope (work, lines, area, cut) equal the specified commands; the library order; delete batches clear part pins whose media param emptied; `media_widgets` FieldSpecs map `media` → `media` and `clipIn`/`clipOut` → `trim`; the video rows' `when` |

#### 11.8.3 Browser tests (`tests/browser`)

| File | Owner | Asserts |
|---|---|---|
| `media_import.py` (new) | G | Every generated and committed fixture through `importFile`: the entry fields (EXIF-6 JPEG → `w`/`h` swapped and the upright pixel at the top-left; PNG alpha → `alpha: true`; VFR → `vfr`, `fps` median); refusals give the right `media.err.*`; dedupe; the IndexedDB round trip (blob, index, thumbs) and prune; the quota fallback (a faked `QuotaExceededError`) |
| `media_exact.py` (new; **frame exactness**) | G | For each counter video (VP9 MP4, VP9 WebM, H.264 MP4 when available, VFR) as the work background (`fit: cover`, `move: none`, `clock: song`): a PNG export at 24, 30 and 60 fps, 1280×720 and 1920×1080. **Every** output frame's code equals the expected source index, computed from the fixture's known frame times (not from `sampleAt`). Then `speed` 0.5 and 2, `clipIn` 0.5, `loop` wrap and `hold`, and `clock: show` in a cut. A 3-s MP4 export decodes back to the same codes (H.264 when available, else VP9 in MP4). |
| `determinism.py` (+) | G | a project with a video ground, an alpha WebM frame and a still: in export quality, frame N directly equals frame N after 0..N−1 (pixel hash). The paused preview after scrubbing, redrawn until exact, shows the same source frame indices as the export (`MediaFrame.index`, reported through the test hook), with pixels within MAE ≤ 2/255: the preview may decode in hardware. |
| `media_alpha.py` (new) | G | the alpha WebM fixture as a `photoFrame`: the alpha of the merged frame at 5 times is within ±4/255 of the generated truth; a transparent PNG export keeps the frame's alpha; `photoPan` absent in `clear`, `chroma` and `black`; `mediaLayer` skipped there |
| `transparent_check.py` (+) | G | the existing checks with a `photoFrame` (PNG with alpha) in the project |
| `perf.py` (+) | G | project_basic with a 1080p30 video ground plus a still `photoFrame`: frame ≤ 10 ms p50 at 720p; `drawMedia` ≤ 1 ms p50. The timed frame is the whole iteration (`await mediaReady(t)` + `renderFrame` + a 1-px read), because the store's main-thread work belongs to the frame; the ready / render split is printed. `drawMedia` is gated per medium, the video calls and the still calls each. Pooled, the photo frame's calls outnumber the video's and would set the median alone. It is timed unflushed, which measures the call's own main-thread work: recording, plus any synchronous work such as a `VideoFrame`'s colour conversion (≈ 9 ms at 1080p) or a forced raster. The raster itself is inside the frame total. A separate flushed pass (a 1-px read of the call's target before and after it) reports the per-call cost with raster, per medium, with its draws per call, and marks it OVER above twice the budget. With software raster any scaled full-frame draw costs ≈ 2.6–3 ms, so that pass is not gated. Whether it becomes the gate, and on which hardware, is the lead's decision. The ground stays at its automatic depth (`back`: blurred); the row asserts that its frames come baked and that `FrameStats.media.fallback` is 0. |
| `ui_flows.py` (+) | G | **flow "media"**: drop a PNG on the stage → the background is set at work scope in one undo step → the crop overlay drag equals one gesture → drop an MP4 while 12行 is selected → the line background → trim with the keyboard → export 2 s 720p MP4 → undo all equals the start. **Flow "library"**: import 3 files → toggle おまかせ → おまかせ picks a photo ground at least once in 20 seeds → delete with confirmation clears the pins. **Flow "missing"**: a light-saved project opened with an empty IndexedDB → placeholder → export blocked → relink by the same file → export enabled. Keyboard-only variant. |
| `ui_layout.py` (+) | G | the asset page, picker, trim widget and library fit 288–352 px; control budgets unchanged; the crop overlay never covers the preview canvas (overlay only) |
| `csp.py`, `i18n_pages.py` (+) | G | 0 CSP violations across import (incl. SVG), playback, scrub, export, vision (faked provider) and package flows; no Japanese UI text on the en page (asset names excepted) |
| `parts_gallery.py` (+) | B | the media parts × aspects with the fake store's fixtures: not blank, no console errors |

---

### 11.9 Depth: how a photo or video takes part in the animation (動きと重なり; FROZEN)

This is a later request from the owner. For every background photo or video, the user can choose whether it:
- moves with the animation;
- comes in front of the text;
- is pushed back;
- stays out of the animation altogether.

おまかせ decides it too. When the AI has looked at the picture, its suggestion is used. All of it works without AI.

#### 11.9.1 The param `depth` (`K.mediaParams`, package B; parts, package G.3)

| Name | Type | Auto | ja / en | Notes |
|---|---|---|---|---|
| `depth` | enum `auto anim front back still` | `auto` | 動きと重なり / Motion and layering | `ai: true` (the only media param the AI may set); `ui: basic`; for `use` `ground`, `frame` and `layer` (not `fill`: inside the text is its own place) |

The options, in this order:

| Value | ja | en |
|---|---|---|
| `auto` | おまかせ | Auto |
| `anim` | 演出と一緒に動かす | Move with the animation |
| `front` | 文字の前に出す | In front of the text |
| `back` | 後ろに下げる | Push back |
| `still` | 動かさない | Keep still |

The spec sets `optKey: 'depth'` (§3.5), so the option labels are the strings `opt.depth.*`; the label is `param.depth`
(package F). `mediaLayer` loses its `over` param: `depth` replaces it.
`front` is its old `over: text`, and `back` its old `over: behind`. v2.1 has not shipped, so no document holds `over`.

#### 11.9.2 Resolution of `auto` (planner, package D; deterministic)

The effective value goes into the plan: the decision's `p.depth`, never `'auto'`. The `why` code is given in brackets.
The first rule that applies wins:
1. A pin wins (`user`, `ai`, `lock`), as for every param.
2. The asset's AI suggestion, `doc.media` entry `ai.depth`, when it is set (§11.9.4) (`why.media.depth.ai`).
3. `use: 'layer'` (`mediaLayer`): `front` (`why.media.depth.overlay`).
4. `use: 'frame'` (`photoFrame`): `anim` (`why.media.depth.frame`).
5. `use: 'ground'`:
   - a video, or an animation that runs for 2 s or more: `back` (`why.media.depth.video`; its own motion is enough);
   - a still photo in a segment whose text covers ≥ 35 % of the frame (from `hints.focus` boxes): `back`
     (`why.media.depth.busy`);
   - otherwise: `anim` (`why.media.depth.still`).

`explain` and `fields` report the rule. The `depth` term joins the cut `fp` and the `groundFp`, so a change re-plans
only the scenes that use the media.

#### 11.9.3 Engine meaning (package B; `K.media` reads `p.depth`)

| Effective | Layer | Camera | Seams | Ken Burns | Look |
|---|---|---|---|---|---|
| `anim` | as placed: `ground` for grounds, the cut's layer for frames, far for layers | factor 1: the cut camera, shots, rigs and shakes, as in §4.4 | takes part | as `move` says | frames and layers also take the cut's entrance and exit: alpha follows the arrive envelope's first 0.3 s and the depart envelope's last 0.3 s |
| `front` | near: above the text | factor 1.15 (parallax: nearer things move more) | takes part | as `move` says | readability guard: a media that covers ≥ 40 % of the frame is capped at alpha 0.45, with `comp: 'screen'` unless a blend is pinned; a `photoFrame` keeps full alpha, and the planner never places it `behind` (auto `place` becomes `side`) |
| `back` | far (grounds: `ground`) | factor 0.5 | takes part | `zoom` capped at 0.06 | depth cue: `blur + 3 du` and `veil + 0.15` (both clamped to their ranges) |
| `still` | as `anim` | factor 0: no camera, rig or shake | none: the media stays in place through transitions; it is drawn outside the seam composite, like the hud, and under the text for grounds | none (`move` is treated as `none`) | a video still plays |

- **Camera factor `f`** (`K.depthCam(cam, f)`, a new FROZEN kit export): `x' = f·x`, `y' = f·y`, `roll' = f·roll`,
  `zoom' = exp(f · ln zoom)`, shakes `· f`.
  - `f = 1` is the identity on the camera. So documents without media, and media at `anim`, keep every frame hash.
  - `f = 1.15` is clamped so that the zoom stays ≤ 4.
- **Export:** the choice changes pixels only, so it has no effect on media exactness (§11.4). `mediaAt` still lists
  every drawn media.

#### 11.9.4 AI (package E; everything optional)

- **Vision** (`ai/vision`): `VISION_SCHEMA` gains `depth` per asset: enum `anim front back still` plus `reason` (≤ 60
  chars).
  - The prompt says: `front` only for see-through or overlay footage (light leaks, particles, rain); `back` for busy or
    detailed pictures and videos with strong motion; `still` for pictures that must stay readable (a logo, text in the
    picture); `anim` otherwise.
  - `visionChanges` writes it to the asset: `media.meta { id, ai: { …, depth } }`. `ORDER.assetAi` becomes
    `['caption', 'tags', 'colors', 'subject', 'text', 'depth', 'reason']`, and `core/media.normalizeEntry` keeps
    `ai.depth` only when it is one of the four values. It keeps `ai.reason` (≤ 60 characters) only with a kept depth, so
    the asset page can show why. Package E may edit `core/media` for these fields; A is merged.
  - Reverting the vision change clears it.
- **The direct tool** (`ai/direct`): the media variant of the answer schema gains `depth` (enum `keep anim front back
  still`).
  - Mapping row: an instruction such as 「背景を後ろに下げて」, 「写真を前に出して」, 「背景は動かさないで」 or 「背景も一緒に
    動かして」 becomes a pin of `@<mediaKey>.depth` (or `…:ground@photoPan.depth`) at the answer's scope (work, area,
    lines or cut), `by: 'ai'`, one Change each, reviewable and revertible.
  - `keep` makes no change.

#### 11.9.5 UI (package G.4; strings package F)

- **The element page** of a media part (背景, 写真の枠, 重ねる映像) shows 「動きと重なり」 as a segmented control of the
  five options, right under the source row.
  - While it is auto, the tag reads 「自動: 後ろに下げる」 and the ⓘ shows the `why` text.
- **The asset page** shows the AI's suggestion when there is one: 「AIのおすすめ: 後ろに下げる」, plus the reason.
- **Keyboard:** the segmented control is a radiogroup. The top-level control budgets are unchanged, because this row
  lives in 詳細.

#### 11.9.6 Strings (package F adds them; pairs [ja, en])

| Key | ja | en |
|---|---|---|
| `param.depth` | 動きと重なり | Motion and layering |
| `opt.depth.auto` / `.anim` / `.front` / `.back` / `.still` | おまかせ / 演出と一緒に動かす / 文字の前に出す / 後ろに下げる / 動かさない | Auto / Move with the animation / In front of the text / Push back / Keep still |
| `why.media.depth.ai` | 写真の内容からのAIのおすすめ | The AI's suggestion from the picture |
| `why.media.depth.overlay` | 重ねる映像は文字の前に出します | Overlay footage goes in front of the text |
| `why.media.depth.frame` | 写真の枠は演出と一緒に動かします | A photo frame moves with the animation |
| `why.media.depth.video` | 動画は自分で動くため、後ろに下げました | A video moves on its own, so it is pushed back |
| `why.media.depth.busy` | 文字が多い場面なので、後ろに下げました | The text fills much of the frame, so it is pushed back |
| `why.media.depth.still` | 写真なので、演出と一緒に動かします | A still photo moves with the animation |
| `media.ai.depth` | AIのおすすめ: {v} | AI suggests: {v} |

#### 11.9.7 Tests

| Package | Asserts |
|---|---|
| B | `media_engine.test.js` (+): `K.depthCam` identity at 1, zero at 0, the clamp at 1.15; each effective value's layer, seam rule, Ken Burns and look (op hashes); the readability guard (≥ 40 % → alpha ≤ 0.45); `still` equal across a seam; frame hashes of media-free fixtures unchanged |
| D | `planner_media.test.js` (+): every rule of §11.9.2 in order; pins win; `ai.depth` wins over the heuristics; the fp terms; explain for each why code |
| E | `ai_vision.test.js` / `ai_direct.test.js` (+): the schema is portable; `visionChanges` writes and reverts `ai.depth`; every depth phrase maps to one pin at the right scope; `keep` makes no change |
| G | the element page's radiogroup; `ui_flows.py` flow "media": set 後ろに下げる, then undo; a `mediaLayer` with 文字の前に出す draws above the text (pixel probe) |

## 12. The project package (`.mojipv`): one file holds everything

The owner's decision: the project file itself must be able to hold everything (images, videos and the song) in **one
file**, and this is the **default** save. The light JSON save stays as a secondary option. This section is owned by
**package G** (§8.7). It extends D§3.2, D§6.4.12 and D§6.14 `project_io`, and SPEC §7 "Project file".

### 12.1 Decisions at a glance

1. **A `.mojipv` is a store-only ZIP**, written by the existing `export/zip` writer (ZIP64 when needed). Its layout is
   `mimetype`, `manifest.json`, `media/<id>.<ext>`, `song/<sha1>.<ext>`, `thumbs/<id>.webp` and `project.json`.
   - `project.json` is byte-identical to the light `.json` save.
2. **Streaming both ways:**
   - **Writing:** with the File System Access API, `Blob`s are streamed straight from IndexedDB into the file, so a
     large video never sits in JS memory. Without it, one `Blob` is assembled from `Blob` parts (zero copy) and
     downloaded, with a size warning.
   - **Reading:** random access through `Blob.slice`. Assets are slices of the package file, and each is verified
     (CRC-32, and SHA-256 = id for media) and stored into IndexedDB with deduplication.
3. **Saving:**
   - 保存 / Save (Ctrl+S) and 名前を付けて保存 / Save as write a package by default.
   - 軽い保存（画像・動画・曲なし） / Light save writes the `.json`.
   - Autosave stays in IndexedDB and never rewrites a package.
4. **Opening:**
   - `.mojipv`, v2.1 `.json` and v2.0 `.json` (schema 1) all open.
   - A damaged asset does not stop the project from opening: that asset is reported missing (§11.2.9).
   - A damaged `project.json` or directory is refused with a clear message.

### 12.2 Format (FROZEN; `export/package`)

```
<name>.mojipv                          ZIP, store-only, UTF-8 names, fixed DOS date 1980-01-01 (reproducible)
  mimetype                             "application/vnd.mojipv+zip" — the FIRST entry, stored, no extra field, so its text
                                       sits at byte offset 38 and a file can be recognised by its first 64 bytes
  manifest.json                        the manifest below
  media/<id>.<ext>                     one per doc.media entry whose bytes are on this device (ext from the mime:
                                       png jpg webp avif gif mp4 mov m4v webm mkv)
  song/<sha1>.<ext>                    the song, when doc.song is set and its bytes are on this device
  thumbs/<id>.webp                     optional: the posters (so the library shows at once after open)
  project.json                         serialize({ doc, side }) — exactly the light save's text
```

```json
{ "format": "mojipv.package", "v": 1, "app": "2.1.0", "project": "project.json",
  "files": [
    { "path": "media/a3f9c2d17b0e4a5c6d7e8f901.mp4", "role": "media", "id": "a3f9c2d17b0e4a5c6d7e8f901", "bytes": 48213344, "crc": 3735928559, "mime": "video/mp4" },
    { "path": "song/3f2a9c…e1.m4a", "role": "song", "sha1": "3f2a9c…e1", "bytes": 7340032, "crc": 12345678, "mime": "audio/mp4" },
    { "path": "thumbs/a3f9c2d17b0e4a5c6d7e8f901.webp", "role": "thumb", "id": "a3f9c2d17b0e4a5c6d7e8f901", "bytes": 9120, "crc": 87654321 }
  ],
  "missing": ["a0b1c2d3e4f5a6b7c8d9e0f1a"] }
```

- **`v`** is the package version (1). A newer `v` is refused with `pkg.err.newer`. `project.json` carries its own
  `schema`, which D§4.4 `migrate` handles.
- **`files`** lists every entry except `mimetype`, `manifest.json` and `project.json`, in file order.
  - `bytes` and `crc` must equal the ZIP directory's.
  - `role` is `media`, `song` or `thumb`.
  - `missing` lists the media ids that the document references but this device did not have when saving.
- **Entry order** (FROZEN): mimetype, manifest, media in library order, song, thumbs, project.json. `project.json` goes
  last, so a reader can show "project readable" only after every asset is known.
- **Names** are only the patterns above. The reader ignores any other entry, and refuses names containing `..`, a
  leading `/`, `\`, NUL or drive letters.
- **Caps:** ≤ 1,000 entries; `manifest.json` ≤ 1 MB; `project.json` ≤ 32 MB.
- **Entries are stored uncompressed.** Media is already compressed, and store-only keeps offsets simple, so a slice
  equals the asset.

### 12.3 Writing

- **`export/zip` gains `addBlob(name, blob, { crc })`** (additive; package G).
  - It writes the local header with the given CRC and size (ZIP64 when the size is ≥ 4 GiB), then hands the `Blob` to
    `write`.
  - `write(part)` now receives `Uint8Array | Blob`. The file sink writes a `Blob` with `writable.write({ type: 'write',
    position, data: blob })`, which the browser streams from IndexedDB's backing store. The memory sink keeps the part
    by reference.
  - Offsets advance by `part.size`, and the central directory and the ZIP64 records are unchanged.
- **CRC sources:**
  - media: the `media` store record's `crc` (§11.2.7);
  - thumbs: computed on the small blob;
  - song: computed by a streaming pass at save time and cached in memory for the session (songs are ≤ 200 MB, so this
    is ≤ 1 s).
- **Steps** (`ui/project_io.savePackage(handle | null)`):
  1. Snapshot: `text = serialize({ doc, side })` and the list of referenced ids. Editing may continue during the save,
     as with export (D§4.21 `fork`).
  2. Collect the blobs from IndexedDB. Absent ids go into `manifest.missing`, with a warning toast
     `pkg.warn.missingIn`.
  3. Estimate the size (Σ bytes plus headers). Above **2 GB**, show `pkg.warn.big` (a confirmation, with the size and
     the destination's free space when `navigator.storage` can tell; FAT32 users are warned about the 4 GB limit).
  4. **With File System Access:** `showSaveFilePicker({ suggestedName: <title>.mojipv, types: [pkg, json] })`, then a
     file sink (D§4.21 sinks), then `createZip(write)`, then `add('mimetype')`, `add('manifest.json')`, `addBlob` for
     each asset, and `add('project.json')`, then `finish()` and `close()`.
     - **Without it:** a memory sink with `Blob` parts gives one `Blob`, which goes to `downloadBlob`. Above 1.5 GB this
       asks for confirmation first (`pkg.warn.memory`: 「ブラウザが一時的に{size}の領域を使います」).
  5. Progress goes to the header save state (「ファイルに保存中… 42%」). [中止] in the toast calls `sink.abort()`, which
     removes the partial file when this save made it (名前を付けて保存's new file). 保存 onto the current file only
     discards what it wrote: the browser writes into a copy until `close()`, so that file keeps its contents. An asset
     larger than 32 MB is written in 32 MB pieces, so [中止] and the progress act within it.
  6. When done: `io.savedPkg`, e.g. 「保存しました: 夜明け.mojipv（1.2 GB・写真3・動画1・曲）」.
- **Ctrl+S (保存)** writes the same kind as the current file handle: a `.mojipv` handle gets a package, a `.json`
  handle a light save. Without a handle it acts as 名前を付けて保存 with the package type preselected.
  - The package is **always rewritten in full**. The assets stream from disk at copy speed, and a partial in-place
    update would need the browser's swap-file copy anyway.
- **Light save** (`io.saveLight`) = today's `saveAs` of `.json`. Its toast adds 「写真・動画と曲は入っていません（この端末に
  あるものは開くとつながります）」 when the work has assets or a song.
- **The lock and writer token rules** of D§6.14 are unchanged. They concern the IndexedDB works store, not files.

### 12.4 Opening

`ui/project_io.openPackage(file)` works on the `File` from the picker or a drop, and reads by random access:
1. **Directory.** `export/unzip.openZip(read, size)`:
   - find the end record in the last 65,557 bytes, then the ZIP64 locator and record when present, then the central
     directory;
   - refuse: no end record (`pkg.err.truncated`: 「ファイルが途中までしか保存されていないか、壊れています」); multi-disk
     archives, encryption or compressed entries (`pkg.err.unsupported`); a first entry that is not `mimetype` with the
     right text (`pkg.err.notPackage`).
2. **Manifest.** Read and check with `package.manifestProblems`: the format, `v`, the paths and roles, and bytes and CRC
   equal to the directory's. A bad manifest is `pkg.err.invalid`.
3. **Project.** Read `project.json`, verify its CRC, then `M.parseFile` (D§4.4). Any failure refuses the whole package
   with the D§6.11 messages: newer schema, invalid.
4. **Assets.** For each `files` entry in order, with progress (bytes done / total) and a [中止] button:
   - **Dedupe:** if the `media` store already has the id (or `songs` has the sha1), skip it without reading.
   - **Otherwise:** `slice = file.slice(dataStart, dataStart + bytes)`. One streaming pass computes CRC-32, plus
     SHA-256 for media. For media the digest must equal the id; for a song the CRC is enough, because a relinked song
     may be stored under another sha1 (D§6.11).
   - **On success:** store the `slice` itself (a `Blob`) with its `crc`, and build `mediaIndex` and `thumbs` lazily on
     first use. `thumbs/` entries are stored as given once their CRC checks.
   - **On a mismatch:** skip the asset and count it for `pkg.warn.damaged` (「{n}件の写真・動画が壊れていたため読み込めません
     でした」). The project still opens, and those assets are missing (§11.2.9 relink).
5. **Load.** `loadFile({ doc, side })` (D§6.14): the history is cleared, and autosave takes the work into the `works`
   store as today. The file handle is kept, so Ctrl+S writes the package back.
6. **Cancel** at any step leaves the current work untouched. Assets already stored stay (they are content-addressed)
   and are removed by pruning later if nothing uses them.

**Other files:**
- `.json` (schema 1 or 2) opens as today. Media ids are looked up in the `media` store, and missing ones are relinked.
- Dropping a `.mojipv` anywhere opens it (after the D§6.10 unsaved-change rule: the previous work stays in autosave).

### 12.5 Autosave and the device store

- Autosave writes only the `works` store (the doc and side JSON), as today.
- Assets are written to `media` and `songs` once, at import or package open. They are never rewritten by autosave.
- 最近の作品 (D§6.4.12) opens works from IndexedDB. Their assets are on the device unless they were pruned or cleared.
- The header save state gains a file line in its tooltip: 「ファイル: 夜明け.mojipv（12:30 に保存）」 or 「ファイルに未保存の変更
  があります」. It is text only, with no new control.

### 12.6 Modules (package G)

```js
// export/unzip (L5, pure): random-access ZIP reader for store-only archives
openZip(read: (offset, length) → Promise<Uint8Array>, size) → Promise<{ entries: Map<name, Entry>, zip64 }>
Entry = { name, crc, bytes, localOffset, method }
dataStart(read, entry) → Promise<offset>        // reads the local header (name and extra lengths)
ZipReadError codes: 'not-zip' | 'truncated' | 'unsupported' | 'bad-entry'

// export/package (L5, pure)
PACKAGE_V = 1, MIME = 'application/vnd.mojipv+zip', EXT = '.mojipv'
layout(doc, side, have) → { manifest, order: [{ name, role, id?, sha1?, bytes, crc, mime? }], missing }
     // have = { media: Map<id, { bytes, crc, mime }>, song: { sha1, bytes, crc, mime } | null, thumbs: Map<id, …> }
extOf(mime) → 'png' | 'jpg' | … ;  pathOf(role, key, mime) → 'media/<id>.<ext>'
manifestProblems(json, entries) → string[]
readPlan(manifest, entries) → { project: Entry, media: [{ id, entry }], song: { sha1, entry } | null, thumbs: [...] }

// ui/project_io (additions)
savePackage(handle?) · saveLight(handle?) · openPackage(file, { signal, onProgress }) · putMedia · getMedia · putIndex ·
getIndex · putThumbs · getThumbs · usedMedia (Set) · storageInfo() → { usage, quota, persisted }
```

### 12.7 UI and wording

**≡ › ファイル** (D§6.4.12, replacing the ファイル group):

| Item | ja | en |
|---|---|---|
| New | 新しく作る | New |
| Open | 開く… (Ctrl+O) | Open… |
| Save | 保存 (Ctrl+S) | Save |
| Save as | 名前を付けて保存… (Ctrl+Shift+S) | Save as… |
| Light save | 軽い保存（画像・動画・曲なし）… | Light save (without images, videos or song)… |
| Import media | 写真・動画を読み込む… | Import photos and videos… |
| Recent | 最近の作品 ▸ | Recent ▸ |
| LRC | 時間つき歌詞（.lrc）を保存 | Save timed lyrics (.lrc) |
| SRT | 字幕（.srt）を保存 (§13.8; the action belongs to package H) | Save subtitles (.srt) |
| Bake times | 時刻を歌詞に書き込む | Write times into the lyrics |

- **Picker types:**
  - The save picker offers 「作品ファイル（写真・動画・曲も入る）(.mojipv)」 first, then 「軽い作品ファイル (.json)」.
  - The open picker accepts `.mojipv`, `.json`, `.txt`, `.lrc`, audio, images and videos. Its description is
    `io.fileTypes`: 「作品・歌詞・曲・写真・動画」.
- **Progress** (the toast host, D§6.4.11): 「開いています: 夜明け.mojipv 38%（写真・動画 3/5）」 [中止]. While saving, the
  header state reads 「ファイルに保存中… 42%」.

**Strings** (package A writes them):

| Key | ja | en |
|---|---|---|
| `io.save` / `io.saveAs` / `io.saveLight` | 保存 / 名前を付けて保存… / 軽い保存（画像・動画・曲なし）… | Save / Save as… / Light save (without images, videos or song)… |
| `io.typePkg` / `io.typeJson` | 作品ファイル（写真・動画・曲も入る） / 軽い作品ファイル | Project file (with photos, videos and song) / Light project file |
| `io.fileTypes` (changed) | 作品・歌詞・曲・写真・動画 | Projects, lyrics, songs, photos, videos |
| `io.savedPkg` | 保存しました: {name}（{size}・{what}） | Saved: {name} ({size}, {what}) |
| `io.savedWhat` | 写真{p}・動画{v}・曲 | {p} photos, {v} videos, song |
| `io.savedLight` | 写真・動画と曲は入っていません（この端末にあるものは開くとつながります） | Photos, videos and the song are not included (files on this device relink when opened) |
| `io.savingPkg` / `io.openingPkg` | ファイルに保存中… {p}% / 開いています: {name} {p}%（写真・動画 {i}/{n}） | Saving to file… {p}% / Opening {name} {p}% (photos and videos {i}/{n}) |
| `io.fileState.saved` / `.dirty` | ファイル: {name}（{time} に保存） / ファイルに未保存の変更があります | File: {name} (saved at {time}) / Unsaved changes since the file was saved |
| `pkg.warn.big` | 大きなファイルになります（{size}）。保存先の空き容量を確かめてください。FAT32 のドライブには 4 GB を超えるファイルを保存できません | This file will be large ({size}). Check the free space where you save it. FAT32 drives cannot hold files over 4 GB |
| `pkg.warn.memory` | このブラウザでは一度メモリに作ってから保存します（{size}）。続けますか？ | This browser builds the file in memory before saving ({size}). Continue? |
| `pkg.warn.missingIn` | {n}件の写真・動画はこの端末にないため、ファイルに入っていません | {n} photos or videos are not on this device, so they are not in the file |
| `pkg.warn.damaged` | {n}件の写真・動画が壊れていたため読み込めませんでした | {n} photos or videos were damaged and could not be loaded |
| `pkg.err.truncated` | ファイルが途中までしか保存されていないか、壊れています | The file is incomplete or damaged |
| `pkg.err.notPackage` / `pkg.err.unsupported` / `pkg.err.invalid` | 文字PVメーカーの作品ファイルではありません / この形式の ZIP は開けません / 作品ファイルの中身が正しくありません | This is not a Moji PV Maker project file / This kind of ZIP cannot be opened / The project file's contents are not valid |
| `pkg.err.newer` | 新しいバージョンで作られた作品です。このバージョンでは開けません。 | This project was made with a newer version and cannot be opened here. |

### 12.8 Tests

| File | Owner | Asserts |
|---|---|---|
| `zip.test.js` (+) | G | `addBlob` (Node `Blob`) gives the same bytes as `add` with the same data; ZIP64 forced; `write` receives `Blob` parts |
| `unzip.test.js` (new) | G | round trip with `createZip` (store-only, ZIP64 on and off, 0–3 entries, a UTF-8 name at the limit); only headers are read (a counting `read`); errors: truncated end record, wrong central size, compressed entry, bad names, a 1,001-entry archive |
| `package.test.js` (new) | G | `layout` order, names and exts; `missing`; `manifestProblems` for every rule; `readPlan`; the manifest's bytes and CRC equal the directory's; the project entry comes last |
| `package_io.py` (new, browser) | G | **Round trip:** a project with a PNG (alpha), a 2-s WebM (VP9), a 2-s MP4 (VP9 in MP4; H.264 when available) and a WAV song → save a package with a memory sink and with an OPFS file sink → clear IndexedDB (`clearDevice`) → open → assets restored (ids and bytes equal), `doc` deep-equal, the song relinked, a frame of the preview identical to before. **Dedupe:** open again, no asset re-read (a counting `File.slice`). **Corrupt:** one flipped byte in the MP4 entry → the project opens, `pkg.warn.damaged` n = 1, that asset missing, the others fine; a truncated file → `pkg.err.truncated`, the current work untouched; `project.json` corrupt → refused. **Old files:** a v2.0 `.json` (schema 1 fixture) and a v2.1 light `.json` with assets already in IndexedDB open and link. **Cancel** mid-open leaves the work unchanged. **Size:** a synthetic 4.1 GB package via a generated sparse `Blob` (OPFS) is written with ZIP64 and read back by the reader (header checks only; run with `--long`). |
| `ui_flows.py` (+) | G | ≡ › 保存 writes `.mojipv` (OPFS handle faked through the test hook); 軽い保存 writes `.json`; Ctrl+S keeps the kind; the header file state; the progress toast and cancel |
| `csp.py` (+) | G | 0 violations for save and open |

---

## 13. Filmora 対応: output that drops cleanly into Filmora

The owner's goal: whatever this app outputs must go into Wondershare Filmora without friction. The same outputs also
suit Premiere Pro, DaVinci Resolve and CapCut. This is **package H** (§8.8), plus B's AAC-fallback item (§8.2).

### 13.1 What we know about Filmora (research; ✔ = documented by Filmora or a standard, ? = to verify in Filmora)

| # | Finding | Status | Consequence here |
|---|---|---|---|
| R1 | MP4 with H.264 video and AAC audio imports and edits normally | ✔ | the main deliverable |
| R2 | Transparent video imports as **WebM (VP8/VP9 with alpha)** or **MOV (ProRes 4444)**; HEVC with alpha is not supported | ✔ (Filmora help), ? for the exact versions | WebM VP9 alpha is our transparent video. ProRes cannot be encoded in a browser. |
| R3 | 「Import as Image Sequence」 reportedly accepts **JPEG/JPG sequences only** | ? | the transparent PNG ZIP is **not** a smooth path into Filmora; it stays for other editors |
| R4 | Built-in **chroma key** (green screen): pick the key colour with a picker, then adjust tolerance | ✔ (menu names ?) | green-screen MP4 with an exact, documented key colour |
| R5 | Imports **SRT** subtitle files onto the timeline | ✔; ? for UTF-8 with or without BOM and for CRLF | SRT export: UTF-8 **with BOM**, CRLF, which is the most compatible form |
| R6 | **Opus audio inside MP4** may not import (the audio track is missing or silent) | ? (likely) | the kit never relies on Opus in MP4 (§13.4) |
| R7 | WAV (PCM 16-bit, 48 kHz) imports | ✔ | the audio fallback of the kit |
| R8 | The project frame rate should match the clips (24, 30, 60 CFR); MP4 files with timescale = fps read as exact CFR | ? | the MP4 video time scale is already `fps` (NOTES WP6); the README states the project settings |
| R9 | Chrome's `VideoEncoder` rejects alpha (「Alpha encoding is not currently supported」, verified in Chromium 141) | ✔ | two VP9 encoders plus our own WebM writer with BlockAdditions (§13.5) |
| R10 | Chrome decodes VP9 alpha in WebM (`AlphaMode = 1`, BlockAdditional id 1) | ✔ | the browser test decodes our WebM back and checks alpha |

Every **?** line becomes a row of the manual checklist (§13.12).

### 13.2 Goals (each testable)

| Id | Goal | Test |
|---|---|---|
| **FG1** | A **Filmora用** preset in step ④: one choice that writes a ready-to-edit set of files | `ui_flows.py` flow "kit"; `kit_check.py` |
| **FG2** | Main MP4: H.264 High, yuv420p, **CFR** at the project fps (24, 30, 60), key frame every 2 s, AAC-LC 48 kHz stereo; 1080p or 4K | `kit_check.py`: demux with `media/isobmff`; codec strings, `stss` every 2·fps, all `stts` deltas = 1 tick at timescale fps, AAC present (Chrome CI) |
| **FG3** | Without AAC (Chrome on Linux): the kit's MP4 has no audio track, plus `<base>.wav`, which is sample-exact (`audioFrames(N)`), starts at 0 and is 16-bit 48 kHz stereo. The plain MP4 falls back to Opus in MP4 with a note (B's item). | `kit_check.py` with AAC disabled; WAV header, length and RMS |
| **FG4** | **透過WebM** (VP9 alpha): a standalone format and the kit's overlay; frame-exact, CFR (`DefaultDuration`), seekable (Cues), decodable with alpha by Chrome, readable by our demuxer | `webm_check.py` |
| **FG5** | **グリーンバック MP4**: backdrop `chroma` with the key colour **#00B140**; decoded background pixels within ±4 per channel; a one-line how-to for the key | `kit_check.py` |
| **FG6** | **Layer outputs:** 文字と装飾（透過WebM） plus 背景だけ（MP4), with the same N, timestamps and size; their composite equals the full render (MAE ≤ 2/255) for projects without world seams or non-`alphaSafe` screen effects | `kit_check.py` |
| **FG7** | **SRT and LRC** from the lyric timing, relative to the export range | `subtitles.test.js`; `kit_check.py` parses them |
| **FG8** | **File names** are predictable ASCII suffixes after the title (§13.9), and a `README_Filmora.txt` (ja + en) is in the set | `kit_check.py` |
| **FG9** | **In-app guide** 「Filmoraで使うには」 (ja/en) from step ④, plus `docs/FILMORA.md` | `i18n.test.js` keys; `ui_flows.py` opens it |
| **FG10** | **Manual verification** in Filmora (Windows and macOS, the current major version): every ? row of §13.1, recorded in NOTES | the checklist of §13.12 |
| **FG11** | **Top level stays simple:** step ④ keeps ≤ 5 controls; the kit is one choice of 形式 | `ui_layout.py` budgets |

### 13.3 Output settings (schema 2; `core/doc`, package A)

- **`output.format`** ∈ `mp4`, `kit`, `webmAlpha`, `png`, `pngAlpha` (`OUTPUT_CHOICES` gains `kit` and `webmAlpha`).
- **`output.kit`** = `{ overlay: true, bg: false, green: false, srt: true, lrc: false }`: the kit's optional files. The
  main MP4 is always written. `ORDER.output` adds `'kit'` at the end, `ORDER.kit` is the key order above, and
  `normalize` fills it.
- **`output.set`** accepts the key `kit` with a whole object: five booleans, with a `payload` error otherwise.
- **Format and backdrop coupling** (`ui/output`, D§6.4.3):

  | Choice | Result |
  |---|---|
  | `webmAlpha` or `pngAlpha` | backdrop `clear` |
  | `mp4`, `kit` or `png` while the backdrop is `clear` | backdrop becomes `scene` |
  | backdrop `clear` while the format is opaque | format becomes `webmAlpha` (the primary transparent path) |
  | another backdrop while the format is `webmAlpha` / `pngAlpha` | format becomes `mp4` / `png` (the latter as today) |

  `backdropFor(format, backdrop)`: `webmAlpha` → `clear`; `kit` → the document's backdrop, with `clear` read as
  `scene`.

### 13.4 AAC and audio policy

| Output | AAC encoder available | No AAC encoder (Chrome on Linux, Chromium builds) |
|---|---|---|
| MP4 (形式 MP4) | AAC-LC 192 kbps | **Opus in MP4** (160 kbps), with the preflight note `opus-audio` (B's item, §8.2) |
| Kit: main MP4 | AAC-LC | **No audio track**, plus `<base>.wav` (PCM 16-bit, 48 kHz stereo, exactly `audioFrames(N, fps, 48000)` samples from `t0`), plus the kit note `kit-wav` |
| Kit: `_bg.mp4`, `_green.mp4` | no audio (the main MP4 or the WAV carries the song) | same |
| 透過WebM, kit `_overlay.webm` | Opus in WebM, the WebM standard (standalone: when 音声を入れる is on; overlay: never) | same |

- The WAV writer is `audio/wav.encodePcm16(channels, rate, start, frames) → Uint8Array` (additive; package H). It mixes
  down with the D§4.21 down-mix and writes a RIFF header. The down-mix (`mixMatrix`, `fillPlanar`) lives in `audio/wav`,
  because `audio/*` (L1) may not depend on `export/*` (L5); `export/schedule` re-exports the same functions.
- A WAV over 4 GB (≈ 6 h 12 min at 48 kHz) is impossible within the 60-min cap.

### 13.5 Transparent WebM (`export/host/webm`, `export/webm`; package H)

**Encoding** (per frame `i`; after `await e.mediaReady(t)`):
1. `renderFrame(surface, t, { quality: 'export', backdrop: 'clear', scale })`. The surface is an `OffscreenCanvas` with
   alpha.
2. `img = surface.ctx.getImageData(0, 0, w, h)` gives straight (not premultiplied) RGBA. `getImageData` is allowed in
   `export/host/*` (D§2.4 bans it only in `engine/render` and the parts). This is one readback per frame.
3. **Colour frame:** `new VideoFrame(img.data, { format: 'RGBA', codedWidth: w, codedHeight: h, timestamp: ts(i),
   duration: frameDur(i) })` goes to encoder **C** (`alpha: 'discard'`, the default).
4. **Alpha frame:** an I420 buffer whose **Y plane = the alpha bytes** and whose U and V planes are 128. It becomes
   `new VideoFrame(buf, { format: 'I420', …, colorSpace: { fullRange: true } })` and goes to encoder **A**.
   - Building I420 directly avoids the RGB→YUV limited-range mapping: alpha 0 stays 0 and 255 stays 255 before
     compression.
5. Both encoders use the same config:
   - codec: the first supported of `pickVp9(w, h, fps)` = `vp09.00.<level>.08` (level from the size and rate table),
     then `vp8`;
   - bitrate: C = `bitrate(w, h, fps, quality)`, A = the same (`ALPHA_SHARE` 1). At 25 % the alpha fell behind moving
     text within a key-frame interval (a ghost trail over the user's footage; measured in NOTES "## v2.1-H.2"); the
     variable-rate encoder uses only what the alpha needs;
   - `latencyMode: 'quality'`;
   - key frames forced on both at `i % (2·fps) === 0`.
6. The muxer pairs C and A chunks by timestamp and writes one `BlockGroup` per frame:
   - `Block` = the C frame;
   - `BlockAdditions/BlockMore(BlockAddID 1)/BlockAdditional` = the A frame;
   - `ReferenceBlock` when C is not a key frame.
   - Spontaneous extra key frames in one encoder are harmless: the forced ones align.
7. **Audio** (standalone, when the song is on): `AudioEncoder` Opus, 48 kHz, 2 channels, 160 kbps, in 1024-frame chunks
   covering `[t0, t1)`, trimmed or padded to `audioFrames(N)` (the D§4.21 rules), as `SimpleBlock`s on track 2.

**The writer** `export/webm.createWebm({ write, w, h, fps, video: { codec: 'V_VP9' | 'V_VP8', alpha: true },
audio: { rate, channels, codecPrivate } | null })` → `{ video(colour, alpha, key, ts), audio(chunk, ts), finish() }`:
- **Pure.** It uses `write(bytes, position?)`, the D§4.21 sink contract. Positional writes patch the placeholders.
- **Elements** (Matroska/WebM, `DocType` `webm`, `DocTypeVersion` 4, `DocTypeReadVersion` 2):

  | Element (id) | Content |
  |---|---|
  | EBML (1A45DFA3) | EBMLVersion 1, ReadVersion 1, MaxIDLength 4, MaxSizeLength 8, DocType `webm`, DocTypeVersion 4, DocTypeReadVersion 2 |
  | Segment (18538067) | size written as 8 bytes, patched at `finish` |
  | SeekHead (114D9B74) | Seek (4DBB) entries for Info, Tracks and Cues; Cues' position patched; padded with Void (EC) |
  | Info (1549A966) | TimestampScale (2AD7B1) = 1,000,000 ns; Duration (4489, float) patched; MuxingApp (4D80) and WritingApp (5741) = `mojipv 2.1` |
  | Tracks (1654AE6B) / TrackEntry (AE) 1 | TrackNumber (D7) 1, TrackUID (73C5), TrackType (83) 1, FlagLacing (9C) 0, CodecID (86) `V_VP9` or `V_VP8`, DefaultDuration (23E383) = `round(1e9 / fps)` ns, MaxBlockAdditionID (55EE) 1, BlockAdditionMapping (41E4) { BlockAddIDValue (41F0) 1, BlockAddIDType (41E7) 0 }, Video (E0) { PixelWidth (B0), PixelHeight (BA), AlphaMode (53C0) 1 } |
  | TrackEntry 2 (audio) | TrackType 2, CodecID `A_OPUS`, CodecPrivate (63A2) = OpusHead (from the encoder's `decoderConfig.description`, else built: version 1, 2 channels, pre-skip 312, 48000, gain 0, mapping 0), CodecDelay (56AA) = pre-skip in ns, SeekPreRoll (56BB) = 80 ms, Audio (E1) { SamplingFrequency (B5) 48000.0, Channels (9F) 2 } |
  | Cluster (1F43B675) | one per video key frame (every 2 s): Timestamp (E7) in ms; BlockGroup (A0) { Block (A1), BlockAdditions (75A1) { BlockMore (A6) { BlockAddID (EE) 1, BlockAdditional (A5) } }, ReferenceBlock (FB) }; audio SimpleBlock (A3) |
  | Cues (1C53BB6B) | CuePoint (BB) { CueTime (B3), CueTrackPositions (B7) { CueTrack (F7) 1, CueClusterPosition (F1) } } per cluster |

- **Timestamps:** block times are `round(ts(i) / 1000)` ms relative to the cluster (int16), and a cluster never spans
  more than 32.7 s. `DefaultDuration` marks CFR for editors.
- The same writer serves the tests' fixtures (§11.8.1). `media/matroska` reads its output back exactly, which is the
  round trip test.

**Why our own writer:** vendoring webm-muxer (MIT) would also work. Our own writer (≈ 450 LOC) keeps third-party code
at the two existing vendor files, and it doubles as the generator of the tests' WebM fixtures (§11.8.1).

**Throughput:** one readback plus two VP9 encodes per frame. 1080p30 runs at about 25–45 fps on a mid-range laptop;
package H records the real figure in NOTES.

### 13.6 Green-screen MP4

- The backdrop is `chroma`: the frame is filled `#00B140`, the palette is adjusted and only `alphaSafe`/`shape` filters
  run (D§4.19.4).
- Encoding is the ordinary MP4 path. Chroma subsampling blurs colour edges, so the kit's green MP4 always uses quality
  `max` (0.18 bpp).
- **How-to line** (step ④ and the README, ? for the menu names): 「Filmoraで上のトラックに置き、クロマキー（緑幕）をオン
  にして色 #00B140 を選び、許容範囲を少し上げます。」

### 13.7 Layer outputs (overlay + background)

- **Overlay** (`_overlay.webm`): the §13.5 transparent WebM, with backdrop `clear`. It draws every layer except the
  ground layer, with `alphaSafe` screen effects only (D§4.19.4).
- **Background** (`_bg.mp4`): `renderFrame(…, { layers: 'ground' })` (B's option, §11.3.7). It draws the backdrop fill
  and only the ground layer of every item, with the post stack limited to the work texture.
- **Composition rule:** background under overlay = the full render, **except** that:
  - world seams mix each output separately;
  - non-`alphaSafe` screen effects are absent from the overlay;
  - accent screen effects are absent from the background.
- When any of these apply, the preflight adds `layers-approx` (info), naming the effects or the number of world seams.

### 13.8 Subtitles (`export/subtitles`; package H; pure)

```js
srt(plan, { t0 = 0, t1 = plan.duration, per = 'line' | 'cut' }) → string     // UTF-8 text; the caller adds the BOM
lrc(plan, doc) → string                                                        // moved here from ui/project_io.lrcText (same bytes)
```

- **One cue per sung line** (`plan.lines`, time order), or per cut when `per` is `cut`:
  - `start = max(0, line.t0 − t0)`, `end = min(line.t1, t1) − t0`;
  - a cue ending after the next cue's start is cut back to it;
  - a cue shorter than 0.1 s is dropped;
  - lines outside `[t0, t1)` are dropped.
- **Text** is the line's plain text, with marks removed (D§3.11).
- **Format:** `n`, then `HH:MM:SS,mmm --> HH:MM:SS,mmm` (milliseconds rounded half up), then the text, then an empty
  line, with CRLF line endings. The file is written with a UTF-8 BOM.
- **≡ › ファイル › 字幕（.srt）を保存** writes the whole video. The kit writes the export range.

### 13.9 The Filmora kit (`export/host/kit`; package H)

**Files** (`base` = `S.fileName(doc, …)` without its extension):

| File | When | Content |
|---|---|---|
| `<base>.mp4` | always | the main MP4 (§13.4, FG2) |
| `<base>_overlay.webm` | `kit.overlay` | 文字と装飾 (transparent WebM) |
| `<base>_bg.mp4` | `kit.bg` | 背景だけ |
| `<base>_green.mp4` | `kit.green` | グリーンバック |
| `<base>.srt` / `<base>.lrc` | `kit.srt` / `kit.lrc` | subtitles and timed lyrics |
| `<base>.wav` | when AAC is unavailable | the song, sample-exact |
| `README_Filmora.txt` | always | how to use the files (ja, then en), with the real names, fps, size and key colour |

**Destination:**
- With File System Access: `showDirectoryPicker({ mode: 'readwrite', id: 'mojipv-kit' })`, then a new folder
  `<base>_filmora`, with one file sink per file. A name the folder already has — compared without letter case or
  Unicode form, then asked of the file system itself — gets ' (2)', ' (3)' …. Cancel or failure removes the created
  files and the folder this export made (`removeEntry(…, { recursive: true })`), never a folder or file that was there
  before.
- Without it: memory sinks, then one store-only ZIP `<base>_filmora.zip` assembled from `Blob` parts (§12.3 `addBlob`),
  then `downloadBlob`. The memory confirmation of D§4.21 applies to the total.

**One pass over the timeline:**
1. `eA = engine.fork()`: the document as it is.
2. `eG = engine.fork({ assets: eA's store })` with `setDoc(reduce(doc, look.set backdrop 'chroma'))`: its plan has the
   chroma palette, and it shares the media sessions, so each source frame is decoded once.
3. For each frame `i`, `await eA.mediaReady(t)`, then render and encode in this order: main (`eA`, doc backdrop), overlay
   (`eA`, `clear`), background (`eA`, `layers: 'ground'`), green (`eG`).
   - Each output has its own encoder, and each encoder has its queue limit (D§4.21).
   - All outputs use the same `ts(i)` and `frameDur(i)`, so they line up exactly in Filmora.
4. After the video: the audio (AAC in the main MP4, or the WAV), SRT, LRC and README.
5. Progress is per frame over all outputs, with a label per phase (「動画」「文字（透過）」…) and one ETA.

**Result:** `{ files: [{ name, bytes }], ms, audio: 'aac' | 'wav' | 'none' }`. The done state of step ④ lists the files,
plus 「Filmoraで使うには」.

### 13.10 Step ④ UI (package H; D§6.4.3 amended; still ≤ 5 controls)

```
形式  [MP4] [Filmora用] [その他 ▾]         ← one control: a segmented pair plus a select (透過動画（WebM）/ PNG連番 / 透過PNG),
                                              the pattern of step ③'s 画面の形
大きさ [1080p 1920×1080 v]   なめらかさ [24|30|60]   背景 [通常 v]   ▸ 詳しく
```

- **詳しく for Filmora用:** 範囲 · 画質 · 音声を入れる · ファイル名, then the set's contents, then the guide link:
  ```
  セットに入れるもの
   ☑ 完成動画（MP4）           (always; disabled)
   ☑ 文字と装飾だけ（透過WebM）
   ☐ 背景だけ（MP4）
   ☐ グリーンバック（MP4）
   ☑ 字幕（SRT）   ☐ 時間つき歌詞（LRC）
  Filmoraで使うには ›
  ```
- **The summary line** for the kit: 「Filmora用セット: 4ファイル・約 820 MB（フォルダに保存）」, or …（ZIPでダウンロード）
  without File System Access.
- **Preflight items** (`export/schedule.preflight`, pure; package H):

  | Code | Level | Text key |
  |---|---|---|
  | `kit-wav` | info | `exp.pre.kit-wav` |
  | `kit-fps` | info | `exp.pre.kit-fps` |
  | `kit-size` | info | `exp.pre.kit-size` (720p or 1440p chosen) |
  | `layers-approx` | info | `exp.pre.layers-approx` |
  | `no-vp9` | block | `exp.pre.no-vp9` (neither VP9 nor VP8 encodes: 透過WebM and the overlay are impossible) |
  | `kit-memory` | confirm | `exp.pre.kit-memory` |

  The media items of §11.7.9 also apply. `probe()` gains `vp9Codec` (the first supported VP9 or VP8 string).
- **「Filmoraで使うには」** opens a help sheet (`ui/filmora_help`, a `<dialog>` like the shortcut sheet, D§6.4.12) with
  the numbered steps of the README, using the real names and settings.
- **The existing alpha note** `exp.alphaNote` is replaced by `exp.alphaNote2`:
  「透明にするときは『透過動画（WebM）』がおすすめです（Filmora・Premiere・DaVinci・ブラウザで使えます）。PNG連番は
  After Effects などに。」

**Strings** (package A writes them):

| Key | ja | en |
|---|---|---|
| `exp.fmt.kit` / `exp.fmt.webmAlpha` / `exp.fmt.other` | Filmora用 / 透過動画（WebM） / その他 | For Filmora / Transparent video (WebM) / Other |
| `exp.kit.title` | セットに入れるもの | Files in the set |
| `exp.kit.main` / `.overlay` / `.bg` / `.green` / `.srt` / `.lrc` | 完成動画（MP4） / 文字と装飾だけ（透過WebM） / 背景だけ（MP4） / グリーンバック（MP4） / 字幕（SRT） / 時間つき歌詞（LRC） | Finished video (MP4) / Words and decorations only (transparent WebM) / Background only (MP4) / Green screen (MP4) / Subtitles (SRT) / Timed lyrics (LRC) |
| `exp.kit.summary` | Filmora用セット: {n}ファイル・約 {size}（{where}） | Set for Filmora: {n} files, about {size} ({where}) |
| `exp.kit.toFolder` / `exp.kit.toZip` | フォルダに保存 / ZIPでダウンロード | saved to a folder / downloaded as a ZIP |
| `exp.kit.phase` | {what}を書き出し中 | Writing {what} |
| `exp.kit.done` | {n}ファイルを書き出しました: {folder} | Wrote {n} files: {folder} |
| `exp.kit.howTo` | Filmoraで使うには | How to use in Filmora |
| `exp.pre.opus-audio` (B) | このブラウザでは AAC で書き出せないため、音声は Opus で入ります。ブラウザ・YouTube・VLC では再生できます。編集ソフト（Filmora など）で音が出ないときは「Filmora用」で書き出してください。 | This browser cannot write AAC, so the sound is Opus. Browsers, YouTube and VLC play it. If an editor (such as Filmora) has no sound, export with "For Filmora". |
| `exp.pre.kit-wav` | このブラウザでは動画に曲を入れられないため、曲は別のファイル（{name}.wav）になります。Filmoraでは 0:00 に置いてください。 | This browser cannot put the song into the video, so the song is a separate file ({name}.wav). Place it at 0:00 in Filmora. |
| `exp.pre.kit-fps` | Filmoraのプロジェクトも {fps}fps・{w}×{h} にしてください | Set the Filmora project to {fps} fps, {w}×{h} too |
| `exp.pre.kit-size` | Filmoraでは 1080p か 4K が扱いやすいです | 1080p or 4K is easiest in Filmora |
| `exp.pre.layers-approx` | 「背景だけ」に「文字と装飾だけ」を重ねると、{what}は完成動画と少し違って見えます | When "Words and decorations only" is laid over "Background only", these look slightly different from the finished video: {what} |
| `exp.pre.no-vp9` | このブラウザは透過動画（VP9）を書き出せません。PC の Chrome か Edge を使ってください | This browser cannot write transparent video (VP9). Use Chrome or Edge on a computer |
| `exp.pre.kit-memory` | このブラウザではセットをメモリで作ってから ZIP で保存します（約 {size}） | This browser builds the set in memory and saves it as a ZIP (about {size}) |
| `exp.alphaNote2` | 透明にするときは「透過動画（WebM）」がおすすめです（Filmora・Premiere・DaVinci・ブラウザで使えます）。PNG連番は After Effects などに。 | For transparency, "Transparent video (WebM)" is recommended (Filmora, Premiere, DaVinci, browsers). PNG sequences suit After Effects and similar. |
| `kit.help.title` | Filmoraで使うには | Using the files in Filmora |
| `kit.help.1` | Filmoraで新しいプロジェクトを作り、{w}×{h}・{fps}fps にします。 | Create a new Filmora project at {w}×{h}, {fps} fps. |
| `kit.help.2` | 「{main}」を読み込み、タイムラインの 0:00 に置きます。 | Import "{main}" and place it at 0:00 on the timeline. |
| `kit.help.3` | 完成動画の代わりに自分の映像の上へ文字だけを重ねるときは、「{overlay}」を上のトラックの 0:00 に置きます（透過WebM）。 | To put only the words over your own footage instead of the finished video, place "{overlay}" on an upper track at 0:00 (transparent WebM). |
| `kit.help.4` | グリーンバックで重ねるときは、「{green}」を上のトラックの 0:00 に置き、クロマキー（緑幕）をオンにして色 #00B140 を選び、許容範囲を少し上げます。 | To key out the green screen, place "{green}" on an upper track at 0:00, turn on Chroma Key (green screen), pick #00B140 and raise the tolerance a little. |
| `kit.help.5` | 歌詞を字幕として別に出したいときだけ、「{srt}」を読み込みます（完成動画には歌詞がもう入っています）。 | Only if you want the lyrics as separate subtitles, import "{srt}" (the finished video already shows them). |
| `kit.help.6` | 完成動画には音が入っていません。「{wav}」を音声トラックの 0:00 に置きます。 | The finished video has no sound: place "{wav}" on an audio track at 0:00. |
| `kit.readme.head` | 文字PVメーカーの書き出しファイル（Filmora用） | Files exported by Moji PV Maker (for Filmora) |
| `menu.saveSrt` | 字幕（.srt）を保存 | Save subtitles (.srt) |

### 13.11 Modules (package H)

| Module | Kind | Exports |
|---|---|---|
| `export/webm` (new, L5) | pure | `createWebm(o)` (§13.5), `IDS` (element ids), `ebmlSize(n)`, `ebmlId(id)` |
| `export/subtitles` (new, L5) | pure | `srt`, `lrc` (§13.8) |
| `export/schedule` (+) | pure | `pickVp9`, `kitFiles(doc, plan, env) → [{ name, kind, est }]`, the new preflight codes, `FORMATS` |
| `export/host/webm` (new, L6) | host | `exportWebm({ engine, doc, audio, sink, signal, onProgress })` → Result (§13.5) |
| `export/host/kit` (new, L6) | host | `exportKit({ engine, doc, audio, dir \| null, signal, onProgress })` → `{ files, ms, audio }` |
| `export/host/sink` (+) | host | `openDirectory({ name })`, `createDirSink(dirHandle)` → `{ file(name) → Promise<Sink>, abort(), close() }` (file handles are made asynchronously); `write` accepts `Blob` (§12.3) |
| `export/host/mp4` (+) | host | the `layers` and `backdrop` options through `openJob`; reuse by the kit. The `mediaReady` await (B.3) and the Opus fallback (B.4) are B's items. |
| `audio/wav` (+) | pure | `encodePcm16(channels, rate, start, frames)` |
| `ui/output` (+), `ui/step_export` (+), `ui/filmora_help` (new), `ui/menus` (+ `file.saveSrt`) | UI | §13.10 |
| `docs/FILMORA.md` (new) | doc | the guide (ja and en): what each file is, the steps, the key colour, what to check, and the §13.1 facts with their status |

### 13.12 Tests

| File | Owner | Asserts |
|---|---|---|
| `webm.test.js` (new) | H | EBML ids and sizes; the Segment and Duration patches through positional writes; clusters at key frames; BlockGroup with the alpha BlockAdditional; ReferenceBlock on delta frames; Cues point at clusters; audio SimpleBlocks; **round trip through `media/matroska`** (the table, alpha ranges and codec equal the input) |
| `subtitles.test.js` (new) | H | the SRT grammar (a small parser); CRLF; the BOM added by the caller; rounding; overlap trimming; range clipping; per-cut mode; `lrc` bytes equal the previous `lrcText` over the fixtures |
| `export_math.test.js` (+) | H, B | `pickVp9` levels; `kitFiles` names and estimates; preflight `kit-wav`, `kit-fps`, `layers-approx`, `no-vp9`, `opus-audio` (B) and `no-audio-codec` only when there is no codec at all |
| `doc.test.js`, `commands.test.js` (+) | A | `output.format` `kit` and `webmAlpha`; `output.kit` normalize and validate; `output.set kit` |
| `webm_check.py` (new, browser) | H | A 3-s 720p30 transparent WebM of project_basic with an alpha test pattern cut. **Decoded by Chrome** (`<video src=blob:>` + `requestVideoFrameCallback` + draw + `getImageData`) at 6 frame times: alpha within ±6/255 of the transparent PNG export of the same frames for ≥ 99 % of the pixels, mean \|Δα\| ≤ 1; fully clear areas (no PNG α > 0 within 4 px) ≤ 3 and glyph cores (PNG α = 255 within 3 px) ≥ 250 for ≥ 99.9 % of their pixels, with no spike beyond 24 or below 232 (VP9 leaves isolated one-pixel spikes even at a fixed quantizer). **Decoded by WebCodecs** through `media/matroska`: N frames, both streams, key frames aligned every 60. **Frame-exact:** the §11.8.1 counter pattern drawn by a cut, and each decoded frame's code equals `i`. Cues, Duration and DefaultDuration present. With the song: the Opus track length equals `audioFrames(N)` ± one packet. |
| `kit_check.py` (new, browser) | H | A kit of project_basic plus a still background, 2 s, 1080p30, to OPFS through `createDirSink`. It checks: file names; MP4 codec (`avc1.64…` when H.264 encodes, else the VP9 fallback of `export_check.py`) with CFR `stts`, `stss` every 60 and AAC present (Chrome CI) or `<base>.wav` present with the right length (AAC off); overlay WebM alpha present; `_bg.mp4` has N frames; **composite** `_bg` + `_overlay` (from the PNG exports of the same frames, to avoid codec loss) vs the full render MAE ≤ 2/255 on a project without world seams; `_green.mp4` decoded background ±4 of #00B140; SRT parses and its times equal `plan.lines`; README holds the real names. **ZIP path** (no File System Access, faked): one store-only ZIP with the same files. **Cancel** removes the folder. |
| `export_check.py` (+) | B | **AAC fallback:** with AAC disabled (`codecs: { audioList: ['bogus.aac', 'opus'] }`), and by default on local Chromium, `exportVideo` returns `audio: true`, `audioCodec: 'opus'`; the MP4's `stsd` has `Opus` with a `dOps` box; `decodeAudioData` of the file gives a duration = N / fps (± 25 ms) and RMS > 0.01 for the test song; the preflight lists `opus-audio`, not `no-audio-codec` |
| `ui_flows.py` (+) | H | **flow "kit":** choose Filmora用 → the contents checkboxes → 書き出す → the files listed in the done state → 「Filmoraで使うには」 opens and closes; **flow "webm":** その他 › 透過動画 sets backdrop 透明; keyboard-only variant |
| `ui_layout.py` (+) | H | step ④ ≤ 5 controls with every format; the kit contents fit 288–352 px |
| `csp.py` (+) | H | 0 violations for the WebM, kit (folder and ZIP) and SRT flows |

**Manual checklist (FG10; recorded under `## v2.1-H Filmora check` in NOTES)**, using Filmora's current major version
on Windows 11 and macOS:
- import every kit file;
- MP4: frame rate and resolution recognised, sound present (AAC);
- `_overlay.webm`: transparency visible over footage;
- `_green.mp4` with the chroma key at #00B140: clean edges at 1080p `max`;
- SRT: Japanese text shows correctly, with and without the BOM;
- the WAV lines up at 0:00;
- the plain Opus MP4: record whether its sound imports (R6);
- a 4K MP4 imports;
- a PNG sequence: record Filmora's behaviour (R3).

Each ? row of §13.1 is then set to ✔ or ✗, and the README text is fixed if needed.
