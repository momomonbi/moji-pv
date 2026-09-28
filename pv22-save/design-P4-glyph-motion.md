# P4 — 文字の形が動く (M4 モーフ, M5 太さのアニメーション): design (revision 2)

Package P4 of PV22. Items:

- **M4** 文字が溶けて変わる、同じ字が移動するモーフ
- **M5** 細字から太字へ育つ、太さのアニメーション

Base: `main` at 9a9e950, plus the PV22 worktree commit 87fde34 (`core/doc` `GEN`/`newDoc()`, `look.gen` kept by
`normalize`/`serialize`, and the three call sites `ui/boot.js:107`, `ui/project_io.js:610`, `ui/project_io.js:1176`).
Every statement about current code was checked against that tree. Numbers come from read-only probes in
`scratchpad/pv22/probe/p4/` (`overlap.js`, `overlap2.js`, `lib.js`, `ladder.js`, `rungs.js`), `probe/p4r/`
(`grow_rate.js`, `room2.js`, `overlap3.js`) and the critic's `probe/critic4/` (`window.js`, `room.js`); they print
statistics only. Examples of lyric lines in this document are invented short phrases.

Structure: **0** package-wide decisions, **M4** and **M5** each in the eleven requested sections, **X** summary (tests,
goldens, perf, size, order), **Critique log** (how each point of the review was handled).

---

## 0. Package-wide decisions

### 0.1 At a glance

| Decision | Choice |
|---|---|
| M4 mechanism | A new text seam `glyphMorph` 「モーフ」 with an **additive, optional** seam field `glyphs: true`. The planner writes the glyph correspondence into the seam entry (`plan.seams[i].glyphs`, offsets into the two cut texts). The renderer holds the matched glyphs out of the two side surfaces, lets the part's ordinary `mix(fx, a, b, u, p)` melt the rest, and draws the matched glyphs itself, travelling in screen space. `mix` and the `text`/`world` scopes are untouched. A glyph seam **hands A's letters over**: A's window ends with the morph window (an exception to §3.12's `t1` floor, for glyph seams only). |
| M4 automatic use | Rule `morph` in `planner/tracks decideSeam`, behind the switch 「同じ字をつなぐ」 (slot `morph.auto`, work + line), only where two lines in one background share a meaningful run of letters, do not overlap in time, and pass the other guards (M4.4.3), including P2's effect budget. |
| M5 mechanism | One **appended** pose column `wt` (weight offset in CSS weight units, ADD, identity 0). The draw path turns `rec.font.weight + wt` into the two **served** weights around it and draws them dip-free (heavier at `a·f`, lighter over it at `a(1−f)/(1−a·f)`) for the text styles `plain` and `glow`; for `outline`, `shadow` and `duo` it draws the nearest served weight (steps, no crossfade). No variable fonts, no stroke emboldening. |
| M5 parts | 入り「太る」 `weightGrow`, 見せ「脈打つ太さ」 `weightPulse`, 抜け「細る」 `weightThin`, built on an **additive kit option** `K.perGlyph(fn, { prep, wt })` / `K.perGlyphHold(fn, { prep, wt })`. Automatic use behind 「太さを動かす」 (slot `weight.auto`, work) through an opt-in pool. When a line enters with 太る and its 太さ is not set, the planner sets `text.weight` by rule to the typeface's heaviest served weight up to 800, so the line really goes **thin → bold**. |
| M5 fonts | The extra weights are **draw-only faces**: requested through the FontBook without moving its epoch, so no scene is rebuilt or marked provisional; a weight is drawn only once it is loaded (else the nearest loaded weight or the base face). Export waits for them. |
| Registry version | New definitions are marked `late: true` (must be `pool: false`) and are **left out of the registry signature**, so `registry.version` stays `83c7523d` and every `fp`, plan hash and golden stays byte-identical (0.2). |
| New vs old documents | Both switches resolve to **on** for documents made by `newDoc()` (`look.gen ≥ 1`) and **off** for everything else (absent = off), unless a pin says otherwise. Resolution through P2's `planner/rules` (0.3). |
| Determinism | Pairs, rules, weights and travel are pure functions of the plan; no clock, no randomness beyond the existing seeded streams. Font readiness changes only which already-served weight the preview draws for a moment; export waits for every weight. |
| AI | Not needed. |

### 0.2 Registry: late parts keep `registry.version` (shared mechanism)

**Problem.** `core/registry.buildRegistry` hashes `[kind, key, sorted param names]` of every definition into
`registry.version`. `planner/plan.sharedText` puts `registry.baseVersion || registry.version` into every cut and segment
fingerprint, so any new part changes every `fp`, every plan hash (`plan_hashes.json`) and the `registry` field that
`frame.test.js` checks in `frame_hashes.json` and the three `project_*.json` goldens. Lead decision 1 forbids that.

**Why leaving the new parts out of the signature is safe.** `registry.version` is only ever an in-memory key (checked:
the `planner/cast` cast cache is keyed by the root registry object and then `registry.version`; the `plan.js` memo and
`castKeys`; `sharedText`). Nothing persists it (no `fp` or plan hash is stored in a project, autosave, package or AI
cache: grep of `src/ui`, `src/export`, `src/core/store.js`, `src/ai`). A late part can reach a plan in three ways only:
a pin that names it; the morph rule (M4), which runs only when the document's `morph.auto` resolves on; the opt-in
weight pool (M5), which is offered only when the document's `weight.auto` resolves on. The switches are document
content (a pin, or the `look.gen` marker that `newDoc()` writes); their values enter the cast look key through
`ctx.glyph.id` (0.3), and every decision they cause is in `cut.slots` / `plan.seams`, which the fingerprints and plan
hashes include. A legacy document (no marker, no pin) reaches none of the three, so its plans are today's. What a
late part's **code** does is not in `version` — the same holds today for the code of every existing part.

**Change** (`src/core/registry.js`):

```js
const OPT_INS = Object.freeze(['weight']);            // opt-in pools (M5); see pool()

// in checkCommon(def, bad):
if (def.late !== undefined && def.late !== true) bad('late must be true when present');
if (def.late === true && def.pool !== false) bad('a late definition must be pool: false');
if (def.late === true && def.fallback === true) bad('a late definition cannot be the fallback');
if (def.optIn !== undefined && !OPT_INS.includes(def.optIn)) bad('optIn must be one of ' + OPT_INS.join(' '));
if (def.optIn !== undefined && def.pool !== false) bad('optIn is only for pool: false definitions');

// in KIND_CHECKS.seam (after the replaces check):
if (def.glyphs !== undefined && def.glyphs !== true) bad('glyphs must be true when present');
if (def.glyphs === true && def.scope !== 'text') bad('glyphs needs scope text');
if (def.share !== undefined && !(isNumber(def.share) && def.share > 0 && def.share <= 0.5)) bad('share must be in (0, 0.5]');
if (def.ends !== undefined && typeof def.ends !== 'boolean') bad('ends must be a boolean');

// in buildRegistry:
const signature = [], lateSig = [];
...
  (def.late === true ? lateSig : signature).push([kind, key, Object.keys(def.params || {}).sort(compare)]);
...
const version = H.hashJSON(signature);                              // unchanged for the v2.1 catalog: 83c7523d
// makeRegistry(...) gains: lateSig (frozen, non-enumerable) and
//   lateVersion = lateSig.length ? H.hashJSON([version, lateSig]) : version
// extend(base, …): lateSig = base.lateSig; lateVersion from the extended registry's own version and that lateSig

// in pool(kind, opts): the opt-in pools (M5)
if (def.pool === false && !(o.optIn && def.optIn !== undefined && o.optIn.includes(def.optIn))) continue;
```

- `lateVersion` has **one use**: the `registry` block of the new golden `tests/golden/project_glyph.json` (M4.8), so a
  change of a late part's parameter list shows there like any other part's does in the other goldens. It is not part of
  any cache key; `castKeys` keeps `registry.version` as its first term.
- `extend()` (materials) keeps `baseVersion = base.baseVersion || base.version` → unchanged.
- **Late parts are not material bases**: `ai/recipe.basePart` returns `null` for `def.late === true`, and the variant
  path of `core/recipe` / `parts/mix` reports `no-base` for them (a material is poolable; a late part is not).
- `ui/palette.partItems` (command palette 「部品を固定」) today skips `pool === false`; change the test to
  `(def.pool === false && def.late !== true)`, so the new parts can be pinned from the palette like any other.
  `ui/part_browser` filter pages (`counts`, `normalize`, `setFilter`) use `pooled(def) = def.pool !== false ||
  def.optIn !== undefined`, so 「これだけ使う／使わない」 can switch off 太る alone.
- **Shared with P3/P6.** Any PV22 package that adds a part must mark it `late: true` (and so pin-only, rule-picked or
  opt-in). P4 lands the mechanism; the integrator merges it first.
- DESIGN §4.18.1: add `late`, `optIn` to the field list; §4.18.2 seam row: `glyphs`, `share`, `ends` (M4.5).

### 0.3 Gating: PV22 documents on, all others off

P4 follows **P2's document marker** (`doc.look.gen`, written by `D.newDoc()`; already in the PV22 worktree at 87fde34)
and P2's resolution module `planner/rules`, because 「固定を外す」 must not switch the features off and a fresh work must
not show 固定 marks.

| slot | UI (Japanese) | scopes | value |
|---|---|---|---|
| `morph.auto` | 作品全体 › 見た目 (詳しい設定) 「同じ字をつなぐ」; 行 › 演出 (詳しい設定) 「前の行から字をつなぐ」 | work, line | at a line's first cut: line pin ?? work value; inside a line: work value. Work value = work pin ?? `gen ≥ 1` |
| `weight.auto` | 作品全体 › 見た目 (詳しい設定) 「太さを動かす」 | work only | work pin ?? `gen ≥ 1` |
| `text.weight` | 行 › 色と書体, 複数行 › 色と書体 and カット › 文字 (詳しい設定) 「太さ」 | cut, line, work | pin; else the grow rule (M5.4.4) when `weight.auto` is on; else the typeface's weight |

- **P2's API, exactly.** Both switch rows are added to P2's `planner/rules` switch table as **independent** rows (no
  parent; not members of 「文字PVの定石」): `{ slot: 'morph.auto', parent: null }`, `{ slot: 'weight.auto', parent:
  null }`. The planner and `ui/fields` use P2's signatures `RU.value(doc, ix, slot)`, `RU.defaultValue(doc, ix, slot)`,
  `RU.isRule(slot)`, `RU.SPECS[slot]` (`{ type: 'bool' }` for both). P4 reads only work values from `RU.value`; the
  line value of `morph.auto` is read by `tracks.morphOn` (M4.4.3).
- **If P4 lands before P2**, P4 creates `planner/rules` with just these two rows and that API
  (`defaultValue = (doc, ix, slot) => !!(doc.look && doc.look.gen >= 1)`, `value = work pin (coerced) ?? defaultValue`),
  and it also brings the two pieces of P2's UI plumbing it relies on, exactly as P2 §3.5 specifies them: the
  `planner/fields` category `'rule'` (state `pinned` when a work pin exists, else `auto`; `autoText = ['rule.auto.' +
  (gen ≥ 1 ? 'new' : 'old'), {}]` with the strings `rule.auto.new` / `rule.auto.old` from P2's table) and the
  `ui/inspector valueFor` branch `if (field.autoDefault && v === RU.defaultValue(doc(), ix, field.path)) return W.AUTO;`
  plus their `ui_fields` / `ui_flows` tests. P2 then extends the table. The integrator is advised to merge P2 first.
- **If the lead picks pins (P1) instead:** add `'work:morph.auto': { v: true, by: 'user' }` and `'work:weight.auto':
  { v: true, by: 'user' }` to `NEW_WORK_PINS`, both slots to `SETTING_SLOTS` (so 「すべての固定を外す」 keeps them), and
  the defaults become plain `false`. Nothing else in this design changes.
- **Where new documents are made:** `src/ui/boot.js:107` (first run, `?fresh=1`), `src/ui/project_io.js:610`
  (新しい作品), `src/ui/project_io.js:1176` (端末のデータを消す) — all three call `D.newDoc()` in the worktree already.
  Not changed: `defaultDoc()`, `normalize()`, `migrate.parseFile()`, fixtures, `tests/helpers/corpus.js`,
  `tests/update_golden.js` and every test that calls `defaultDoc()` — they all plan legacy documents with both switches
  off. A file saved from a PV22 work keeps `look.gen` (normalize and serialize keep it), so it opens with the switches on.
- **UI scopes (`ui/fields`).** `WORK_NAMES` gains `weight.auto`; `LINE_WORK_NAMES` gains `morph.auto` (→ `['work',
  'line']`); `CUT_NAMES` gains `text.weight` (next to `text.style` → all scopes). These entries make `slotScopes` right
  whether or not P2's `RU.isRule` branch exists (P2 checks `repeat.same` before `isRule`; `morph.auto` must be checked
  with it, before `isRule`, so it keeps its line scope).
- **UI toggles.** Both switches are `F({ path, scopes: WORK, widget: 'toggle', label, spec: { type: 'bool' }, note,
  autoDefault: true, noDice: true, basic: false })` in `PAGES.work sec('look')` — **not** `offClears` (with a default of
  on, clearing would turn it back on). `autoDefault` clears the pin when the new value equals the document default and
  writes `pin.set` otherwise: one command, one undo entry, label `undo.pin`.
- `core/commands`: `NOT_CUT` gains `morph.auto` and `weight.auto` (cut pins refused with the existing message);
  `weight.auto` is also refused at line scope (the work-only set P2 adds for `pv.*`; P4 adds its slot to that set, or
  creates the set `WORK_ONLY = new Set(['weight.auto'])` with the check `need(!(parsed.scope.kind === 'line' &&
  WORK_ONLY.has(parsed.slot)), …)` when P4 lands first). `TEXT_SLOTS` gains `text.weight` (見た目の貼り付け copies it
  like `text.face`).
- `ctx` gains `glyph: null` in the `plan.run` ctx literal; stage 2 (after `LK.resolveLook`, next to P2's `ctx.rules`)
  sets `ctx.glyph = Object.freeze({ morph, weight, maybeMorph, id })` with `morph = RU.value(doc, ix, 'morph.auto')`,
  `weight = RU.value(doc, ix, 'weight.auto')`, `maybeMorph = morph || PA.pinned(ctx.ix, 'morph.auto')` (a line may turn
  it on) and `id = 'g' + (+morph) + (+weight) + (maybeMorph ? 'p' : '')`. The cast look key (`plan.js` stage 5,
  `CA.castKeys(ctx, EN.canon([...]))`) appends `ctx.glyph.id` **only when it is not `'g00'`**, so the key text of a
  legacy document is byte-identical to today's.

### 0.4 FROZEN and shared contracts that change, exactly

| Contract | Change | Why | Compatibility |
|---|---|---|---|
| `engine/scene/table` POSE (DESIGN §4.17.1, 22 columns) | Append **`wt`** as column 23: `POSE = [..., 'px', 'py', 'wt']`, `ADD` gains `'wt'`, `IDENTITY.wt = 0`, not clamped. `SCHEMA` 1 → 2. | M5 needs a per-glyph, per-frame weight that behaviours compose (ADD) and the draw path reads; a side channel would duplicate the column machinery (base/live, reset, masks, kit tracks, conformance). | Appended, so every existing index is unchanged. Identity 0 and the draw path reads it only when `≠ 0`, so no existing scene draws differently. `frame.test.js:336` asserts 22 today and is updated to 23; §4.17.1 text and the "Changing the column list" rule are followed (DESIGN PR, SCHEMA bump, conformance). |
| `engine/scene/behave` DELTA (kit §4.18.3) | Append `'wt'` (ADD, scale 1); `resetDelta` sets `D.wt = 0`. `TRACK_UNITS.wt` is `''` (weight units). Not in `MASK_GROUPS` (materials cannot write `wt`). | So `K.perGlyph` / `K.perGlyphHold` fns can write it. | `mergeDelta` adds only `D.wt !== 0`. |
| `engine/scene/behave` makers | `glyphMotionMaker(kind, source)` and `holdMaker(fn, opts)` accept optional `source.prep(env, target, p) → p'` / `source.wt(p') → [lo, hi]` (`opts` likewise for holds). | M5 parts need build-time params from the target (weight room) and must declare their reach; a wrapper around `make` breaks the kind re-wrap (Critique log, issue 2). | Absent → exactly today's makers. |
| Kit (§4.18.3) | `K.perGlyph(fn, opts)`, `K.perGlyphHold(fn, opts)` with optional `opts = { prep, wt }`; `make.glyphOpts` / `make.holdOpts` carried through `motionKind`'s re-wrap and `K.mirror`. Additive `K.weightRoom(target)`. | M5. | One-argument calls unchanged. |
| Behaviour (§4.17.4) | Optional field `wt: [lo, hi]`: the weight offsets a behaviour may write. | Font loading must know which served weights a scene draws (M5.4.6). | Absent everywhere today. |
| Part fields (§4.18.1) | `late`, `optIn` (0.2). | Registry version; opt-in pools. | Additive. |
| Seam contract (§4.18.2) | Optional `glyphs: true` (scope must be `text`), `share` (window share, default 0.4), `ends` (window ends at `B.a`). `mix(fx, a, b, u, p)` unchanged. | M4. | Additive; absent on every existing seam. |
| Plan §3.12 seam entry | Optional `glyphs: [[aOff, bOff, same], …]` only on entries whose part has `glyphs: true`. | M4. | Absent on every existing plan. |
| Plan §3.12 cut window `b` | For the seam's own A of a **glyph seam**: `b = min(b, seam.at + seam.dur/2)` (no `max(t1, …)` floor). Every other seam, and every cut before A, keeps `b = max(t1, min(b, seam.at + seam.dur/2))`. | A's letters are handed to B; drawing A again after the window would show the old line over the new one (Critique log, issue 1). | Only glyph seams take the branch; none exists in any existing plan. |
| `engine/host/fonts` FontBook (§4.14) | `request(refs, text, { drawOnly: true })`, `ready(refs, text, { drawOnly: true, timeoutMs })`, `drawStatus(ref)`, event `'draw'`. Draw-only faces never move `epoch`. | M5 rungs must not rebuild scenes (M5.4.6). | Existing calls unchanged. |
| `engine/text/faces` exports | Additive `ladderOf`, `atWeight`, `weightPair`, `roomOf`, `rungsBetween`, `growTop`, `reweigh`. | M5. | Additive. |

Not touched: the seam `mix` signature, the `text`/`world` scopes and their validation, `frameAt`/FrameGraph, the SCH
enums locked by `contract.test.js`, the FROZEN slot order (`text.weight` sits inside `text.*`), `core/recipe`
`MOTION_COLS` (materials cannot animate weight in v2.2; see M5.10), the measurer key (`'canvas:' + epoch`).

### 0.5 Modules

| Module | New/changed | Layer | Role |
|---|---|---|---|
| `planner/morph` | new | L2 (deps `core/script`) | letter units, weighted LCS, run filter, gap swaps, `analyze`, `pairsOf`, a 256-entry text-pair cache |
| `engine/render/morph` | new | L3 (deps `core/mat`, `core/num`, `engine/scene/table`, `engine/scene/frame`, `engine/render/draw`, `engine/render/seam`) | resolve pairs to nodes (with layer eligibility), skip masks, travellers, affine interpolation |
| `parts/seam/morph` | new | L4 | `glyphMorph` |
| `parts/arrive/weight`, `parts/dwell/weight`, `parts/depart/weight` | new | L4 | `weightGrow`, `weightPulse`, `weightThin` |
| `core/registry` | changed | L0 | 0.2 |
| `engine/scene/table`, `engine/scene/behave`, `parts/kit` | changed | L3 | `wt` column, DELTA, maker `prep`/`wt`, kit options, `K.weightRoom`, column words |
| `engine/text/faces` | changed | L1 | weight ladders |
| `engine/host/fonts` | changed | host | draw-only faces |
| `engine/render/draw`, `engine/render/renderer` | changed | L3 | weight pairs (style snap, ready check); skip masks; glyph seams |
| `engine/scene/build` | changed | L3 | `text.weight` faces; `scene.wtReach` |
| `engine/facade` | changed | L5 | draw usage of rungs, export wait, `faceReady`; sample plans for the new parts |
| `planner/tracks`, `planner/cast`, `planner/plan`, `planner/explain` | changed | L2 | morph rule, guards, windows, pairs, handover; opt-in pools, `text.weight` pin and grow rule, warnings; ctx.glyph; explain alts |
| `planner/rules` | P2's (or created, 0.3) | L2 | two switch rows |
| `core/commands`, `ui/fields`, `ui/inspector` (only if P4 lands first), `ui/palette`, `ui/part_browser`, `ui/boot`, `ai/recipe`, `i18n/strings` | changed | — | slots, rows, repaint on `'draw'`, strings |

`build.py --check`: `planner/morph` (L2 → L0) and `engine/render/morph` (L3 → L0/L3) are allowed; `planner/cast` may
import `engine/text/faces` (in `PLANNER_TEXT`); `engine/render/draw` and `engine/scene/build` may import it (L3 → L1).

---

## M4 — 文字が溶けて変わる、同じ字が移動するモーフ

### M4.1 What the user gets

- **切り替え「モーフ」** (`glyphMorph`). Between two consecutive lines, the letters both lines share leave their place in
  the old line and glide — position, size, rotation, even from vertical to horizontal writing — to their place in the
  new line. Letters that differ melt into each other where they stand between the shared ones (the old letter softens and
  fades while the new one comes into focus, moving with its neighbours). Everything else of the two lines (extra letters,
  plates, ornaments on the text layers) melts away and in. The new line does not play its own entrance and the old line
  does not play its exit: the transition is both. The movement is finished when the new line's window starts (0.2 s
  before the voice once P5's T4 is on); from then on only the new line is on screen.
  Example: 「青い空へ」→「青い海へ」: 青い and へ travel, 空 melts into 海.
- **Where.** ③ 見た目 → カット → 「切り替え」, 行 → 演出 → 「切り替え（行の始まり）」, the command palette (部品を固定),
  and the part browser tile (animated thumbnail 「青い空」→「青い海」). Parameters on the seam page: 長さ, 切り替えの緩急
  (詳しい設定), 弧, ずらし (詳しい設定), ちがう字 [溶けて変わる | その場で消える], ぼかし.
- **Automatic.** 作品全体 › 見た目 › 詳しい設定 「同じ字をつなぐ」 (toggle, note below). When on, the planner uses モーフ
  by itself between two lines in the same background that share a meaningful run of letters and do not overlap in time
  (M4.4.3). Measured on the fixture corpus: 5 of 663 same-background lyric boundaries (0.8 %; unchanged by the added
  guards, probe `p4r/overlap3.js`); in `project_repeat` 2 of 28 (a line sung twice in a row) — rare and special by
  design. P2's effect budget may lower that further. 行 › 演出 › 詳しい設定 「前の行から字をつなぐ」
  [自動 | つなぐ | つながない] overrides it for the transition into that line's first cut (the row is hidden on the first
  line of the song).
- **Why.** The inspector's 理由 for such a transition: 「前の行と同じ字があるので、字をつないだ」.
- **Defaults.** New works (≡ › 新しい作品, first run, 端末のデータを消す): 「同じ字をつなぐ」 on. Works made before PV22:
  off until turned on. A file saved from a new work keeps its marker and opens with the switch on. 「モーフ」 can be
  pinned in any work.

### M4.2 Gating and defaults

- `glyphMorph` is `pool: false, late: true`: never in an automatic pool (the text-scope auto pool stays
  `[blendDissolve, hardCut, sumiSeep]`, `lens_filter_seam.test.js:125`), outside `registry.version` (0.2).
- The rule runs only when `ctx.glyph.maybeMorph` and the switch resolves on at B (0.3, M4.4.3). Legacy documents: no
  `look.gen`, no pin → `ctx.glyph.maybeMorph === false` → `decideSeam` takes exactly today's branch, no guard is
  evaluated and no pair is computed.
- Pins win: a seam pin at B (any key, including 直結) disables the rule for that boundary.
- **Behaviour exception (called out):** for glyph seams only, A's window ends with the morph window even when A's sung
  end `t1` is later (0.4, M4.4.5). No existing plan has a glyph seam, so no existing behaviour changes. No bug fix.
- The `replaces.arrive` branch of `tracks.seams` exists but has never run in a plan (no seam had it; the facade's
  `samplePlan` already applies `replaces.arrive` for thumbnails); M4 exercises it and adds tests (M4.7).

### M4.3 Data model

- **Pins.** `work:morph.auto` (bool), `line/<id>:morph.auto` (bool; read only at the line's first cut). Cut scope
  refused. No migration.
- **Plan.** A seam entry of `glyphMorph` (planner or pin):
  `{ a, at, b, dur, into, scope: 'text', slot, glyphs: [[aOff, bOff, same], …] }` — `aOff`/`bOff` are UTF-16 offsets of
  graphemes into `A.text` / `B.text` (the `off` the builder stores on every glyph record), `same` = 1 when the graphemes
  are equal (travel) and 0 for a swap (melt while travelling). Sorted by `bOff`. At most 64 entries. `[]` when nothing
  matches (the part then only melts the two lines). `at = B.a − dur/2` because `ends: true` (window `[B.a − dur, B.a]`).
- **Cut windows.** The seam's own A gets `b = min(b, B.a)` (the window end), B keeps its window.
- **Cut slots.** Unchanged, except the rule and the pin override B's `arrive` → `instantShow` and A's `depart` →
  `instantHide` (`from: 'rule'`, the existing `replaceMotion`) unless pinned; a `text.weight` decision that came from
  the grow rule (M5.4.4) on B is removed when B's `arrive` is replaced.
- **Seam memo.** `B.cast.seam` gains `prev` (M4.4.4).

### M4.4 Algorithm

#### M4.4.1 Letter units (`planner/morph.unitsOf(text)`)

`S.graphemes(text)` with running UTF-16 offsets. A unit is kept when `S.charClass(g)` is one of `han hira kata smallKana
hangul latin digit fullLatin emoji`; spaces, punctuation and symbols never match (they melt with the rest). Unit weight
`w(g)`: 3 for `han kata hangul emoji`, 2 for `latin digit fullLatin`, 1 for `hira smallKana`. Only the first
`MAX_UNITS = 64` units of each text take part.

#### M4.4.2 Correspondence: weighted LCS with runs, then filters

Two-state dynamic programme over prefixes `A[0..i)`, `B[0..j)`, `n = |A|`, `m = |B|`, integer scores:

```
E[i][j]  (A[i-1] and B[j-1] matched last; defined only when A[i-1].g === B[j-1].g)
       = better( N[i-1][j-1] + w,  E[i-1][j-1] + w + RUN_BONUS )          RUN_BONUS = 1
N[i][j]  = best of, in this tie order: E[i][j], N[i-1][j] (skip A), N[i][j-1] (skip B)
score order: higher s first; equal s → lower drift d; drift of a match (i-1, j-1) adds |(i−1)·m − (j−1)·n|
```

Back-track from `N[n][m]` following the recorded choice (0 = match, 1 = skip A, 2 = skip B) to the anchor pairs, in
reading order. Typed arrays `Int32Array((n+1)(m+1))` for `sN dN sE dE` and a `Uint8Array` for the choices; ≤ 65 × 65
cells, well under 0.1 ms.

Runs = maximal sequences of anchors consecutive in both texts. A run is **kept** when:
`len ≥ 3`, or `len = 2` and one unit is not `hira`/`smallKana`, or `len = 1` and the class is `han kata hangul emoji`.
Dropped anchors (a lone particle の, a stray が, a single Latin letter, all-hiragana pairs like から) are not travellers
by themselves but may still pair inside a gap (below). The class weights keep the DP from spending a match on a
particle when a kanji could match instead (「夜の月」/「月の夜」 anchors 夜, not の).

**Gap swaps** (`melt === 'swap'`, the default): between consecutive kept anchors, with sentinels `(−1, −1)` and
`(n, m)`, let the gap hold `p` units of A and `q` of B. When `p ≥ 1`, `q ≥ 1` and `max(p, q) ≤ 2·min(p, q) + 1`,
pair them in reading order for the first `min(p, q)` units: `same = 1` if equal graphemes, else 0. Leftover units melt.
With `melt === 'fade'` no swaps are made.

`pairsOf(textA, textB, melt)` → frozen `[[aOff, bOff, same], …]` = kept anchors (`same = 1`) plus swaps, sorted by `bOff`,
cut to `MAX_PAIRS = 64`. `analyze(textA, textB)` → frozen `{ m, longest, nA, nB, meaningful }` over the kept anchors
only. Both are cached in one LRU `Map` keyed `textA + '\u0000' + textB + '\u0000' + melt` (256 entries).

Examples (invented): 「青い空へ」→「青い海へ」: anchors 青い (kept, len 2 with han); へ alone is dropped as an anchor but
the gap after 青い holds 空へ / 海へ (p = q = 2) → swap 空→海, same へ→へ. 「夜の町」→「朝の町」: run の町 kept; gap 夜/朝
→ swap. 「君の手」→「夢の中」: only の → dropped → not meaningful; pinned モーフ still melts 君→夢, の travels, 手→中.

**Meaningful**: `m ≥ 2` and (`longest ≥ 2` or `m ≥ 0.4 · min(nA, nB)`), where `m` counts the letters of kept anchor
runs. A single shared kanji never triggers the rule (it still travels when モーフ is pinned).

#### M4.4.3 When the planner chooses モーフ (rule `morph`)

In `planner/tracks.decideSeam`, the **unpinned** branch runs, in this fixed order: (1) P3's キメ hard-cut rule (seam
into a キメ cut; absent without P3), (2) P4's morph rule, (3) P2's T5 seam gate (absent without P2), (4) today's
chance roll:

```js
} else if (kimeSeam(ctx, B)) {                       // P3 (M3 §g): the hard cut into a キメ cut, trace rule 'kime.seam'
  …
} else if (morphRule(ctx, A, B)) {
  out = fixed({ from: 'rule', v: MORPH });                  // MORPH = 'glyphMorph'
  if (trace) Object.assign(trace, { kind: 'seam', stage: 'rule', rule: 'morph' });
} else if (ctx.pv && ctx.pv.seamGate(B)) {           // P2 (T5 c): no room for a transition → the hard cut, rule 'pv.fx'
  …
} else { /* today's chance roll, unchanged */ }
```

```js
const LYRIC_ROLES = new Set(['lyric', 'focus']);
function ownMotion(ctx, c) { const d = c.slots.arrange; return !!d && ctx.registry.get('arrange', d.v).motion === 'own'; }
function knockout(c) { const d = c.slots.arrange; return !!(d && d.p && d.p.knockout === true); }   // edgeBleed 抜き文字
function utaAt(ctx, c) { return !!(ctx.uta && ctx.uta.at(c)); }                                    // P6 hook; false without P6

// The switch at the boundary A → B: the line pin counts only where B is its line's first cut (0.3).
function morphOn(ctx, A, B) {
  if (A.line !== B.line && B.line && PA.pinned(ctx.ix, 'morph.auto')) {
    const pin = PA.resolvePin(ctx.ix, atOf(B), 'morph.auto', BOOL_ACCEPT, null);   // cut pins are refused: line ?? work
    if (pin) return pin.v === true;
  }
  return ctx.glyph.morph;                                                           // work pin ?? gen ≥ 1
}

// Everything the rule reads except the letters (M4.4.4 memoizes on this).
function morphGuards(ctx, A, B) {
  if (!ctx.glyph || !ctx.glyph.maybeMorph || !ctx.registry.has('seam', MORPH)) return false;
  if (A.ground !== B.ground) return false;                                   // text seams only
  if (!LYRIC_ROLES.has(A.role) || !LYRIC_ROLES.has(B.role)) return false;
  if (!morphOn(ctx, A, B)) return false;
  if (!(A.t1 <= B.t0)) return false;                                         // the lines do not overlap (A is handed over)
  if (isPinned(A.slots.depart) || isPinned(B.slots.arrive)) return false;    // the user chose these motions
  if (ownMotion(ctx, A) || ownMotion(ctx, B)) return false;                  // arrange def.motion === 'own' moves the text
  if (knockout(A) || knockout(B)) return false;                              // the text layer is a mask there (M4.4.6)
  if (A.kime === true || B.kime === true) return false;                      // P3 skeleton flag; undefined without P3
  if (utaAt(ctx, A) || utaAt(ctx, B)) return false;                          // P6: letters that appear as sung
  if (ctx.pv && typeof ctx.pv.seamGate === 'function' && ctx.pv.seamGate(B)) return false;   // P2 T5: B has no room
  return true;
}
function morphRule(ctx, A, B) { return morphGuards(ctx, A, B) && MO.analyze(A.text, B.text).meaningful; }
```

`BOOL_ACCEPT` = the accept function `resolvePin` uses for a bool slot (coerce through `RU.SPECS['morph.auto']`). The P2
gate inside the guards keeps P2's invariant "every automatic lyric cut ends with `load ≤ cap`": a morph is added only
where P2 would allow a transition, and its replaces only lower B's `MOT` (Critique log, issue 8). P2's note "P4 passes
`exempt: true`" is withdrawn.

Params: `withParams(out.decision, params(ctx, def, 'seam', at, seed, B.feat))` as for any seam (seeded by the seam slot
seed; deterministic).

#### M4.4.4 Memo (re-plan equals a plan from scratch)

`seamOf` reuses `B.cast.seam` while B's cast inputs and the history read are the same. The rule also reads A and values
that are not B's cast inputs (A's slots and times, the line pin, P2's gate). The memo therefore stores `prev`, computed
on every call (cheap boolean reads; `analyze` is not needed for it):

```js
const g = ctx.glyph && ctx.glyph.maybeMorph ? morphGuards(ctx, A, B) : null;
const prev = g === null ? null : g ? '1\u0001' + A.text : '0';
if (memo && memo.world === world && memo.prev === prev && sameEntries(memo.read, read)) { … }
// and store `prev` with the memo
```

When the guards pass, the rule's result depends only on `(A.text, B.text)`, and `B.text` is a cast input; when they
fail, the rule is off whatever the texts are. So `prev` is exact.

#### M4.4.5 Window, entry and hand-over (`planner/tracks.seams`, `endWithSeam`)

```js
const def = ctx.registry.get('seam', d.v);
const share = def.share > 0 ? def.share : SEAM_SHARE;             // glyphMorph: 0.5
const limit = share * Math.min(A.b - A.a, B.b - B.a);
let dur = Math.min(typeof d.p.dur === 'number' ? d.p.dur : 0.5, limit);
if (def.scope === 'world') dur = Math.min(dur, WORLD_MAX);
dur = Math.floor(Math.max(0, dur) * 1e6) / 1e6;
// (named seamAt: `at` is already the alignment map in seams())
const seamAt = def.ends === true ? B.a - dur / 2 : B.a;              // glyphMorph: window [B.a − dur, B.a]
const entry = { a: A.key, at: seamAt, b: B.key, dur, into: B.key, scope: def.scope, slot: d };
if (def.glyphs === true) entry.glyphs = A.text && B.text && A.b > seamAt - dur / 2 ? MO.pairsOf(A.text, B.text, d.p.melt) : [];
B.seamIn = out.length;
out.push(entry);
if (def.replaces && def.replaces.depart) replaceMotion(ctx, A, 'depart');
if (def.replaces && def.replaces.arrive) { replaceMotion(ctx, B, 'arrive'); dropGrowWeight(B); }
reach = endWithSeam(cuts, j, seamAt + dur / 2, reach, def.glyphs === true);
```

```js
// A glyph seam hands A's letters to B: its own A ends with the window, even before A's sung end (§3.12 b exception).
// The cuts before A keep the rule (they end with the window unless their sung end is later).
function endWithSeam(cuts, j, end, reach, handover) {
  const stop = Math.floor(end * 1e6) / 1e6;
  const clip = (c) => { if (c.b > stop) c.b = Math.max(c.t1, stop); };
  const A = cuts[j - 1];
  if (handover) { if (A.b > stop) A.b = stop; } else clip(A);
  if (reach <= stop) return reach;
  let next = -Infinity;
  for (let k = j - 2; k >= 0; k--) { clip(cuts[k]); next = Math.max(next, cuts[k].b); }
  return next;
}

// The grow rule's bold end weight (M5.4.4) belongs to 太る; a replaced entrance takes it away.
function dropGrowWeight(c) {
  const tw = c.slots['text.weight'];
  if (tw && tw.from === 'rule' && !(c.slots.arrive && c.slots.arrive.v === 'weightGrow')) delete c.slots['text.weight'];
}
```

- For every existing seam `share`, `ends` and `glyphs` are absent and `handover` is false, so `limit`, `at`, the entry
  and every cut window are byte-for-byte today's.
- **Why the hand-over is needed.** `segment.windows` gives `A.b = max(A.t1, B.t0) + tail` and, with no blank row between
  the lines, `A.t1 = B.t0` (`timing.autoEnd`). With the window ending at `B.a = B.t0 − lead`, the old `max(t1, stop)`
  would leave A visible over `[B.a, B.t0)`, drawn at rest (its exit was replaced by `instantHide`) over the new line:
  measured in 420 of 452 same-ground lyric pairs of the corpus (critic probe `window.js`), for `lead` = 0.12 s (0.2 s
  with P5's T4).
- With the hand-over: at `t < B.a` the seam is active (A is in `aCuts`; B in `bCuts` although `t < B.a`, as
  `frame.seamAt` already does for every seam); at `t = B.a` the seam is over, A is gone (`t < A.b` fails) and B is at
  rest exactly where the travellers ended (`u = 1`). Continuous.
- The rule requires `A.t1 ≤ B.t0`, so an automatic morph never cuts off a line that is still being sung after `B.a`
  beyond the lead; a **pinned** morph between overlapping lines hands over all the same (the user chose it; documented
  in the part's blurb note on the seam page, M4.6 `fld.morphHandover.note`).
- `seamCopy` (「くり返しの行をそろえる」): when the source decision is `glyphMorph` **from `'rule'`**, the copy re-checks
  the rule against its own boundary before copying: `if (srcSlot.v === MORPH && srcSlot.from === 'rule' &&
  !morphRule(ctx, A, B)) return null;` (placed after the pin check; `null` makes `seams()` fall back to `seamOf`, i.e.
  today's path incl. the chance roll). A copied morph recomputes its pairs from its own texts (the code above). A copy
  of a pinned morph is unchanged.
- A pinned モーフ into a cut when A is not on screen at the window start (`A.b ≤ at − dur/2`, possible only next to a
  special cut) gets `glyphs: []`.

#### M4.4.6 Engine: travellers

`engine/render/renderer.drawTextSeam(g, w, h, backdrop, part, u)`:

```js
const mv = part.def.glyphs === true ? MO.prepare(framePlan, fg.seam, sideItem(1), sideItem(2)) : null;
// sideItem(1) = the item of lastOf(seam.aCuts), sideItem(2) = of seam.bCuts[0]; null when either is missing
...
if (mv) dc.skip = mv.skip;                          // Map(scene → Uint8Array(table.n)): glyphs the seam draws itself
for (const Lk of SE.TEXT_LAYERS) { drawSideLayer(a.ctx, Lk, 1, false, true); drawSideLayer(b.ctx, Lk, 2, false, true); }
dc.skip = null;
const out = SE.mix(ctl, pool, part, a, b, u, onPartError);    // the part melts what is left
g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.drawImage(out.canvas, 0, 0);
...
if (mv) { dc.g = g; MO.draw(dc, mv, part.warp(u < 0 ? 0 : u > 1 ? 1 : u), part.p, pickCutOf(mv)); }
// then, as today: still pass, grounds' near layer, hud
```

- `engine/render/draw.drawLayer`: `const skip = dc.skip !== null ? dc.skip.get(scene) : undefined;` and in the node loop
  `if (skip !== undefined && skip[i] === 1) continue;`. `createDrawContext` sets `skip: null`. JavaScript only: no op is
  recorded, so frames without a glyph seam are unchanged.
- `renderer.drawIsolated`: a static text-layer raster (`cache: 'static'`) is bypassed while `dc.skip` holds the item's
  scene (the raster would contain the travellers).
- **`MO.prepare(plan, seam, itA, itB)`**: `null` unless the entry has `glyphs.length`. Cached per seam entry object
  (`WeakMap(entry) → { sa, sb, mv }`, recomputed when either scene object differs). Node lookup per scene
  (`WeakMap(scene) → Map(off → node)`), built once per scene:
  1. candidate runs: `scene.runs` whose `spec.text` is `undefined`/`null` (runs that read the cut text through a
     `span`; notes and ♪ runs pass `text` and are excluded);
  2. candidate nodes: glyph nodes `[from, to)` of those runs whose record is not `space` and whose layer is
     **eligible** (below);
  3. per `off`, the node with the highest **rest alpha** wins — the product of `table.base.alpha[k]` over the node and
     its ancestors (static, from the build); ties → the lower node index. So a faint echo copy never stands for the
     letter; the others stay in the remainder.
  A pair whose `aOff` or `bOff` has no node is dropped (it melts with the remainder; a tate-chu-yoko cell pairs through
  its first digit).
- **Layer eligibility** `eligible(scene, Lk)`: `SE.TEXT_LAYERS.includes(Lk)` (text or near; the base layers are drawn
  before the skip mask is set, so a glyph there would be drawn twice), and the layer's `LayerSpec` (`scene.layers[Lk]`,
  if any) has `opacity === 1`, `blend === 'source-over'`, no `filter`, no `mask`, and no other layer of the scene names
  `Lk` as its `mask.layer`. `isolate: true` alone (e.g. `ornament/media`) and `cache: 'static'` are allowed (a plain
  composite at opacity 1 equals a direct draw). So the knockout of `edgeBleed` (`text` at opacity 0 as the inverted mask
  of the far slab) never yields travellers — the planner also keeps the rule away from it (`knockout` guard); a pinned
  morph there melts only.
- `mv = { n, ia, ib (Int32Array), same, look (Uint8Array), rank (Float32Array), skip }`, `look[j] = 1` when the two
  records draw alike: same `font.key`, `font.script`, `ch`, `style`, `ink`, `rot`, `sx`. `rank[j] = j / (n − 1)`
  (0 when n = 1), in `bOff` order.
- **Z-order (a documented change, DESIGN §4.19 addendum):** during a glyph seam the travellers are drawn after the
  composite of both sides, i.e. above both cuts' text **and near** layers (particles, sparks, bracket frames) and below
  the still pass, the grounds' near layer and the hud. Where a near-layer node of a cut overlapped a matched letter, the
  letter is above it for the length of the window. Measured risk is small (the near layer holds only decoration in the
  catalog: `mix` petals/brackets, `season` flakes, `mark` sparks, and `edgeBleed`'s note/plate, which are not cut-text
  runs); the alternative (a second `mix` for the near layer) doubles the seam's cost.
- **`MO.draw(dc, mv, w, p, cutB)`** per pair `j` (sets `dc.font = null`, `textAlign = 'center'`, `textBaseline =
  'middle'` once; allocation-free with pooled `Float64Array(6)` scratch):

```
aA = tableA.wa[ia], aB = tableB.wa[ib];  if (aA < MIN_ALPHA && aB < MIN_ALPHA) continue
MA = D · view(camA, layer(ia)) · worldA(ia);   FA = MA · Turn(recA) · S(emA)        // em units → device px
MB = D · view(camB, layer(ib)) · worldB(ib);   FB = MB · Turn(recB) · S(emB)
s = min(p.spread, 0.95);  k = sineInOut(clamp((w − s · rank[j]) / (1 − s)))
Fk = lerpAffine(FA, FB, k, p.arc);  a = aA + (aB − aA) · k
drawAs(Y, alpha, blurAdd):  M' = Fk · S(1 / emY) · Turn(recY)⁻¹;  DR.drawGlyphAs(dc, sceneY, iY, M', alpha, blurAdd)
if (same[j] && look[j])      drawAs(B, a, 0)
else if (same[j])            drawAs(A, a·(1 − sm((k − 0.4)/0.6)), 0); drawAs(B, a·sm(k/0.6), 0)       // no dip: ≥ 0.99a mid-way
else /* swap: melt */        drawAs(A, a·(1 − sm((k − 0.1)/0.6)), p.soften · sm(k/0.7));
                             drawAs(B, a·sm((k − 0.3)/0.6),     p.soften · (1 − sm((k − 0.3)/0.7)))
pick: when dc.pick, add B's cell quad under D⁻¹ · M'_B with cut = B's plan index, owner/slot of node ib
```

`sm` = `N.smooth` of a clamped argument; `Turn(rec)` = `S(−1, 1)` if `rot === 2`, then `R(π/2)` if `rot`, then `S(sx, 1)`
(exactly `draw.localTurn`); its inverse by `MAT.invert`. `DR.drawGlyphAs` is `drawGlyph` with an explicit alpha and an
extra blur (M5.4.3); a version whose alpha is below `MIN_ALPHA` is skipped; each drawn version counts in
`dc.counts.glyphs`.

**`lerpAffine(out, A, B, k, arc)`** (device matrices `[a b c d e f]`, canvas order): `k ≤ 0` → copy A; `k ≥ 1` → copy B
(exact ends). Otherwise decompose each as `M = T(e, f) · R(θ) · [[sx, m], [0, n]]` with `sx = hypot(a, b)`,
`θ = atan2(b, a)`, `m = (a·c + b·d)/sx`, `n = (a·d − b·c)/sx`; interpolate `θ` along the shorter arc,
`sx` in log space, `n` in log space when `nA`, `nB` have the same sign (else linearly, a flip), the shear ratio `m/n`
linearly, and the translation linearly plus `arc · sin(πk) · (−Δy, Δx)` (the left normal of the travel vector
`(Δx, Δy) = (eB − eA, fB − fA)`, so every traveller of a line bows the same way). Recompose
`a = cos θ·sx, b = sin θ·sx, c = cos θ·m − sin θ·n, d = sin θ·m + cos θ·n`. All in device space, so preview and export
(which differ by the device scale only) draw the same picture.

**The part's `mix`** (remainder melt), in `parts/seam/morph.js`:

```js
const OLD_OUT = 0.6, NEW_IN = 0.35, NEW_FULL = 0.95, SOFTEN_PEAK = 1.4;
function meltRest(fx, a, b, u, p) {
  const eo = SINE(clamp(u / OLD_OUT)), en = SINE(clamp((u - NEW_IN) / (NEW_FULL - NEW_IN)));
  const out = fx.take(), g = out.ctx;
  const pa = p.soften * SOFTEN_PEAK * eo * fx.unit, pb = p.soften * SOFTEN_PEAK * (1 - en) * fx.unit;
  const oldS = pa >= 1 && eo < 1 ? fx.blurred(a, pa) : a;
  const newS = pb >= 1 && en > 0 ? fx.blurred(b, pb) : b;
  g.globalAlpha = clamp(1 - eo); if (eo < 1) g.drawImage(oldS.canvas, 0, 0);
  g.globalAlpha = clamp(en); if (en > 0) g.drawImage(newS.canvas, 0, 0);
  g.globalAlpha = 1;
  if (oldS !== a) fx.give(oldS);
  if (newS !== b) fx.give(newS);
  return out;
}
```

Surfaces at once: a, b, out and two blurred → 5 ≤ `SEAM_SURFACES` (6).

**Warm-up.** `renderer.warmAt`, when `fg.seam` is a glyph seam, runs `MO.draw` with `dc.g = null` after the glyph walk
(the draw path only looks up the sprites it would draw — the melt blurs take the sprite path).

**Not handled (documented limits):** `fx.textAt` (motion-trail filters) redraws both sides at rest without travellers;
an overfull run's clip does not clip its travellers; the z-order above (near layers under travellers); letters in an
ineligible layer melt instead of travelling.

**Facade thumbnails.** `facade.samplePlan` for a seam with `glyphs: true`: texts `thumb.morphA` / `thumb.morphB` unless
the caller passes `text`/`textB`; the seam entry gets `ends`/`share` timing and `glyphs = MO.pairsOf(textA, textB,
p.melt)`, and the sample A's `b` is the window end (hand-over). `samplePlan` already applies `replaces.depart` and
`replaces.arrive` (`facade.js:168–169`); nothing changes there.

### M4.5 Changes by module and function

| Module | Function | Change |
|---|---|---|
| `core/registry` | `checkCommon`, `KIND_CHECKS.seam`, `buildRegistry`, `makeRegistry`, `pool`, `extend` | 0.2 |
| `planner/morph` (new) | `unitsOf`, `lcs`, `runsOf`, `keepRun`, `swaps`, `analyze`, `pairsOf` | M4.4.1–2 |
| `planner/tracks` | `decideSeam` (rule order), `morphGuards`, `morphRule`, `morphOn`, `ownMotion`, `knockout`, `utaAt`, `seamOf` (`prev`), `seamCopy` (re-check), `seams` (window, entry, `dropGrowWeight`), `endWithSeam` (`handover`) | M4.4.3–5; import `planner/morph`, `planner/rules` |
| `planner/plan` | ctx literal, stage 2, stage 5 cast key | `ctx.glyph` (0.3) |
| `planner/explain` | seam why | rule `morph` → `whyRule.morph` |
| `parts/seam/morph` (new) | `glyphMorph` | M4.4.6, table below |
| `engine/render/morph` (new) | `offIndex`, `eligible`, `restAlpha`, `prepare`, `draw`, `lerpAffine`, `decompose` | M4.4.6 |
| `engine/render/draw` | `createDrawContext` (`skip: null`), `drawLayer` (skip), `drawGlyphAs` (M5.4.3) | |
| `engine/render/renderer` | `drawTextSeam`, `drawIsolated`, `warmAt`, `sideItem` | |
| `engine/facade` | `samplePlan` | thumbnails |
| `core/commands` | `NOT_CUT` | `morph.auto` |
| `ui/fields` | `PAGES.work` look section (toggle), `directionFields` (line row), `LINE_WORK_NAMES` | M4.1, 0.3 |
| `ui/palette` | `partItems` | late parts listed |
| `ai/recipe`, `core/recipe`/`parts/mix` | `basePart`, variant base check | late parts refused as bases |
| `docs/DESIGN.md` | §3.12 seam entry and cut `b` exception, §4.16.6 Seams (rule, order, window, hand-over), §4.18.1, §4.18.2 seam row, §4.19 glyph-seam z-order addendum, §4.19.2 step 4 addendum, §5.9 row | |
| `docs/SPEC.md`, `docs/NOTES.md` | feature line; PV22-P4 entry (goldens unchanged, measurements) | |

The line row: `F({ path: 'morph.auto', scopes: LINE, widget: 'choice', label: 'fld.morphLine', note:
'fld.morphLine.note', spec: { type: 'bool' }, auto: true, options: [{ v: true, text: 'opt.morphLine.on' }, { v: false,
text: 'opt.morphLine.off' }], basic: false, when: (ctx) => !ctx.firstLineOfSong })` in `directionFields()` next to the
seam row (自動 clears the line pin).

`glyphMorph` definition:

```js
K.seam({
  key: 'glyphMorph',
  label: L('モーフ', 'Glyph morph'),
  blurb: L('前の行と同じ字が次の位置へ移り、ちがう字は溶けて入れ替わる',
    'Letters the two lines share glide to their new places; the others melt into the new text'),
  tags: ['soft', 'literary'], family: 'morph', scope: 'text', replaces: { depart: true, arrive: true },
  pool: false, late: true, glyphs: true, share: 0.5, ends: true,
  shared: { dur: { auto: { range: [0.5, 0.9], follow: '-energy' } } },
  params: {
    arc: { type: 'num', min: 0, max: 0.5, step: 0.01, unit: 'frac', label: L('弧', 'Arc'), auto: { value: 0.12 } },
    spread: { type: 'num', min: 0, max: 0.6, step: 0.01, unit: 'frac', label: L('ずらし', 'Stagger'),
      auto: { range: [0.1, 0.25] }, ui: 'advanced' },
    melt: { type: 'enum', of: ['swap', 'fade'], optKey: 'melt', label: L('ちがう字', 'Other letters'), auto: { value: 'swap' } },
    soften: { type: 'num', min: 0, max: 30, step: 0.5, unit: 'du', label: L('ぼかし', 'Soften'), auto: { range: [6, 12] } },
  },
  mix: meltRest,
});
```

DESIGN §5.9 row: `| \`glyphMorph\` (pool false) | モーフ | Glyph morph | text | depart arrive | soft literary | Shared
letters glide to their new places; the others melt into the new text. |`

### M4.6 Strings (`src/i18n/strings.js`, pairs `[ja, en]`)

| key | ja | en |
|---|---|---|
| `fld.morphAuto` | 同じ字をつなぐ | Link shared letters |
| `fld.morphAuto.note` | 前の行と同じ字があるとき、その字が次の行の位置へ動き、ほかの字は溶けて入れ替わります（モーフ）。 | When a line shares letters with the one before, those letters glide to their new places and the others melt into the new text (morph). |
| `fld.morphLine` | 前の行から字をつなぐ | Link letters from the line before |
| `fld.morphLine.note` | 前の行からこの行へ変わるところだけに効きます。 | Applies only where the line before changes into this line. |
| `fld.morphHandover.note` | モーフの間に前の行の字は次の行へ渡され、モーフが終わると前の行は消えます。 | During the morph the letters of the line before pass to the next line; when it ends, the line before is gone. |
| `opt.morphLine.on` | つなぐ | Link |
| `opt.morphLine.off` | つながない | Do not link |
| `opt.melt.swap` | 溶けて変わる | Melt into the new letter |
| `opt.melt.fade` | その場で消える | Fade where they are |
| `whyRule.morph` | 前の行と同じ字があるので、字をつないだ | Shares letters with the line before, so they are linked |
| `thumb.morphA` | 青い空 | BLUE SKY |
| `thumb.morphB` | 青い海 | BLUE SEA |

`fld.morphHandover.note` is shown under the 切り替え row of the seam page when the chosen part has `glyphs: true`.
Part and parameter labels come from the definition (`L(ja, en)`), as for every part.

### M4.7 Tests

New `tests/node/morph_plan.test.js`:

1. `planner/morph`: the four examples of M4.4.2 give the listed pairs (offsets and `same`); `analyze` meaningful rules
   (`m = 2` with a 2-run → true; one kanji → false; one particle → false; `0.4·min` branch); `melt: 'fade'` makes no
   swaps; gap ratio rule (`p = 1, q = 4` → no swap); 64-unit cap; determinism (same input → identical frozen output,
   cache hit returns the same object); DP ties (「夜の月」/「月の夜」 anchors 夜).
2. Rule: a document with `look.gen = 1` (or `work:morph.auto = true`) and two consecutive lines sharing 「青い」 in one
   segment, `A.t1 = B.t0` → `plan.seams` entry `glyphMorph` `from: 'rule'`, B's `arrive` = `instantShow` and A's
   `depart` = `instantHide` (`from: 'rule'`), `at = B.a − dur/2`, `dur ≤ 0.5·min(...)`, `glyphs` as `pairsOf`.
3. **Hand-over** (the blocker): for every glyph seam of the test documents (rule and pin), `A.b ≤ at + dur/2 + 1e-9`,
   and `A.b === floor6(at + dur/2)` when A's unclipped `b` was later; `frameAt(t).cuts` does not contain A for
   `t ∈ {B.a, (B.a + B.t0)/2, B.t0 − 1e-3}`; the cuts before A keep `c.b ≤ max(c.t1, end)`.
4. Off paths: legacy document → no morph, plan hash equal to the stored hash of the same fixture on `main`; a line pin
   `false` at B's line → today's seam; **a two-cut line whose line pin is `false`, in a `gen = 1` document → the boundary
   between its two cuts still follows the work value** (and a line pin `true` in a legacy document turns on only the
   boundary into that line); a seam pin at B wins; pinned B `arrive` → no rule; different segments → no rule;
   `A.t1 > B.t0` (overlapping lines) → no rule; `edgeBleed` with `knockout: true` on A or B → no rule; special cuts →
   no rule; a stub `ctx.pv = { seamGate: () => true }` → no rule (and the P2 hard cut; with P2 present: its own test);
   `A.kime` or `B.kime` true (stubbed skeleton flag; with P3 present: a キメ line after a line sharing its words gets
   P3's hard cut, trace rule `kime.seam`).
5. Pins: pinned `glyphMorph` at a boundary with no shared letters → entry with `glyphs` from swaps or `[]`; pinned B
   `arrive` survives the replace (replaceMotion skips pins) — **the first plan test of the `replaces.arrive` branch**;
   pinned morph between overlapping lines → hand-over applies (A.b = window end).
6. Lock: `lockPayload` of B's line freezes the morph as a `cut/…:seam` lock pin; re-plan identical.
7. Re-plan exactness: extend `planner_determinism` "re-planning after any edit gives exactly the plan made from scratch"
   with a `gen = 1` document: edit A's text (the memo `prev` must notice), pin A's depart, change the switch, set the
   line pin, move A's end past B's start.
8. `seamCopy` (in `repeat_same.test.js`): under 「くり返しの行をそろえる」 a copied rule-picked `glyphMorph` recomputes
   pairs from its own texts; when the copy's boundary fails the guards (its A' shares nothing meaningful, or A' depart
   pinned), the boundary gets today's `seamOf` result instead; a copied pinned morph is copied as today.
9. Explain: the seam slot explains as `rule: 'morph'`.
10. `planner_determinism.checkShape` is extended for glyph seams: `s.at === B.a − s.dur/2`, `s.dur ≤ 0.5·min(...)`, A's
    `b` equals the window end (no `t1` floor); every other seam keeps its assertions.

New `tests/node/morph_render.test.js` (recorder, `engine/render/record.js`, catalog registry):

1. At `u = 0` every traveller's `setTransform` equals (to the recorder's 1e-3) the matrix `drawLayer` gives A's node
   times `Turn · S(em)` folded back (i.e. identical to drawing A's glyph); at `u = 1` equal to B's.
2. Matched glyphs are not drawn on the side surfaces (count `fillText` with the matched grapheme per canvas id).
3. A plan whose seam is `blendDissolve` renders the same op hash with and without the new code path (skip mask null).
4. **After the window**: for `t ∈ [B.a, B.t0)` no `fillText` of a grapheme that only A has, and no op from A's scene.
5. **Knockout**: a pinned morph between two `edgeBleed` `knockout: true` cuts → `MO.prepare` returns no pair, no
   traveller op, the text layers are drawn only through `drawIsolated`; and a scene whose text layer has `opacity 0.5`
   (test-built `sb.layer`) → no traveller.
6. Rest-alpha choice: a test arrange with a faint copy run before the main run → the main run's node travels.
7. Picks inside the window hit B's cut at the traveller's position.
8. Determinism: two renders of the same frame → equal op hashes; preview vs export quality → equal travellers.
9. `lerpAffine`: exact ends; rotation takes the short arc; mirrored `n` flips linearly; arc bows left of travel.
10. Swap pairs take the sprite path (blur ≥ 0.05 du) mid-window and the direct path at the ends.
11. Warm-up with `g = null` makes the sprites the frame then draws (`sprites.made` does not grow on the real frame).

Conformance: `glyphMorph` passes `checkFxPart` (a plain surface mix). `lens_filter_seam.test.js:125`: assertion stays;
message updated. `catalog.test.js`: §5.9 row. `registry.test.js`: `late`/`glyphs`/`share`/`ends` validation; the
catalog registry's `version` stays `83c7523d`; `lateVersion` differs from `version`; an extended (material) registry's
`lateVersion` differs from the base's.

**Mutation targets** (each must fail a test): restore `Math.max(c.t1, stop)` for the hand-over (plan 3, render 4);
drop `memo.prev` (plan 7); drop the skip mask (render 2); `ends` ignored (plan 2); tie order E↔skip (plan 1 夜/月);
rule before the pin check (plan 4); drop the `A.t1 ≤ B.t0` guard (plan 4); read the line pin inside a line (plan 4);
drop the layer eligibility (render 5); first run instead of rest alpha (render 6); `late` parts signed (registry
version); seamCopy without the re-check (repeat_same).

Browser: `parts_gallery.py` shows the モーフ tile animating; `contact_sheet.py` gains a `morph` sheet (4 boundaries:
same face, face change, vertical → horizontal, pinned with no anchors); `ui_flows.py`: on an old work turn
「同じ字をつなぐ」 on (writes `work:morph.auto = true`; one undo removes it); on a `?fresh=1` work turn it off (writes
`work:morph.auto = false`; undo restores the unpinned state, and turning it on again clears the pin); pin モーフ from
the palette; check the 理由 text.

### M4.8 Goldens

| golden | why unchanged |
|---|---|
| `frame_hashes_v2.json` (FROZEN) | Corpus documents have no `look.gen`, no `morph.auto` pin, no モーフ pin → `decideSeam` takes today's branch, no entry has `glyphs`, `endWithSeam` never takes the hand-over branch; `drawTextSeam` never enters the glyph path and the skip test records nothing. |
| `plan_hashes.json` | Same seams, windows and cut slots; `registry.version` unchanged (0.2); the cast key text unchanged for `ctx.glyph.id === 'g00'`. |
| `frame_hashes.json`, `project_media.json`, `project_repeat.json`, `project_extreme.json` | Same plans and ops; `registry` field unchanged. |

New golden (shared with M5): `tests/golden/project_glyph.json` `{ registry: { kind, version, lateVersion }, measurer:
'fake', docs: { morph: { plan, frames[40] }, weight: { plan, frames[40] } } }`, written by a new job in
`tests/update_golden.js` after `project_extreme.json` from `tests/helpers/glyph_docs.js`. `morph` = the basic fixture
with `look.gen = 1` and four invented line pairs that share letters (one of them vertical → horizontal), plus one
pinned モーフ boundary. **Frame times** (`glyphTimes(plan)`, in the helper): the 32 times `duration · (i + 0.5) / 32`,
then, for each of the first 4 glyph seams in `plan.seams` order, `lo + u · dur` with `lo = at − dur/2` for
`u ∈ {0.25, 0.75}` — 40 frames, sorted. `update_golden.js --check` verifies all six existing goldens before writing it.

### M4.9 Performance

- Planner, legacy documents: one boolean read per boundary (`ctx.glyph.maybeMorph`). PV22 documents: the guards per
  boundary (a dozen reads, P2's gate) and `analyze` on a cache miss (≤ 0.1 ms for 64 × 64 units), cached across
  re-plans; the seam memo keeps it off re-plans that do not touch the pair. The re-planning speed test (`project_long`,
  legacy) is unaffected.
- Render, outside morph windows: one `dc.skip === null` check per drawn layer. Inside a window: blendDissolve's cost
  plus one more blur pass (the new remainder) and ≤ 64 travellers (each: two matrix products, one decomposition, one or
  two glyph draws).
- `perf.py` new row `glyph-morph`: the `project_glyph` morph document, 10 s window around its first morph at 720p,
  judged like every row at **twice the §7.4 budget** (p50 ≤ 20 ms, p95 ≤ 33.4 ms), plus a **same-run A/B**: the same
  document with every glyph seam pinned to `blendDissolve` instead, played in the same run; the morph document's p95
  must be ≤ 1.25 × the comparator's (printed for NOTES; fail above).

### M4.10 Risks and open questions

- **Correspondence quality.** Long travel across the frame with a camera change can read as chaos; the arc keeps paths
  apart but they can still cross. Visual QA on the contact sheet decides `arc`/`spread` autos. Repeated kanji in a line
  (e.g. 々 or a doubled word) can pair with the "wrong" copy; drift minimisation makes it the nearer one.
- **Different looks.** Face role, size, emphasis ink, vertical rotation and tate-chu-yoko are handled (fold `Turn · S(em)`
  into the matrix, double-draw when looks differ); a very large size ratio (e.g. 4×) with a rotation looks busy.
- **Mid-window artifacts.** Two superimposed faces when looks differ (by design), the z-order of travellers over near
  layers, trail filters (`fx.textAt`) without travellers.
- **Window before `B.a`.** `ends: true` differs from every other seam (centred). The morph starts up to `dur` (≤ 0.9 s)
  before the new line's window, i.e. while the old line's last syllables may still be sung; its letters stay readable
  while they travel. With P5's T4 lead the movement ends before the voice. Open: should `ends` follow T4's lead exactly
  (`B.t0 − lead`)? Today `B.a` already is that.
- **Hand-over of a pinned morph between overlapping lines** cuts the old line off at the window end; the seam page says
  so (`fld.morphHandover.note`).
- **Registry `late`.** A new registry contract shared by P3/P6; if the lead prefers regenerating `plan_hashes.json` and
  the registry lines of the other goldens instead, drop `late` and everything else stands.
- Open: should the AI catalog list late parts (so an AI review can suggest モーフ)? Not needed; off by default.

### M4.11 Interactions

- **P1 typography**: glyphs of one line may differ in `em` (particles smaller, heads larger, Latin 1.10) and cells are
  narrower; the morph interpolates each glyph's own `em` and cell position, nothing else needed. P1's `kumi` is part of
  the layout, so the `off` → node map is unaffected.
- **P2 conventions**: T5 — the morph rule consults `ctx.pv.seamGate(B)` inside its guards and runs after P3's キメ rule
  and before P2's gate; a rule-picked or pinned morph counts `SEAM = 1`, and its replaces lower B's `MOT`, so P2's
  "`load ≤ cap` for every automatic lyric cut" holds. P2 must drop its "P4 passes `exempt: true`" note. M2 —
  `glyphMorph` has no `dir` param, never flipped. M1 — pool:false parts are never kit members; `repeat.same` copies a
  モーフ seam after the re-check (M4.4.5). `planner/rules` hosts the switch rows (0.3).
- **P3 キメ**: the guards read the skeleton flag `cut.kime === true` on A and B (never a pin); P3's hard-cut rule into a
  キメ cut runs first; no automatic モーフ out of a キメ cut either; a pinned モーフ still runs.
- **P5 timing**: T4's lead moves `B.a` earlier, so the morph ends before the voice; S2 re-tapping a line re-plans the
  window and the `A.t1 ≤ B.t0` guard; S4 (読み切れない速さ) should measure A's reading time up to the window start
  `B.a − dur`, since A's letters then start moving (P5 reads `plan.seams[k].at − dur/2` when the seam's definition has
  `glyphs: true`).
- **P6 歌ハメ**: no automatic モーフ into or out of a line whose letters appear as sung (hook `ctx.uta.at(cut)`, false
  without P6); a pinned モーフ replaces B's entrance unless B's arrive is pinned.

---

## M5 — 細字から太字へ育つ、太さのアニメーション

### M5.1 What the user gets

- **入り「太る」** (`weightGrow`): each letter appears thin (the lightest weight the typeface has, or 始まりの細さ of the
  way down) and grows to the line's weight. In works where 「太さを動かす」 is on and the line's 太さ is not set, that
  weight is the typeface's **heaviest weight up to 800** — the line really goes from 細字 to 太字 and stays bold.
  Params: 長さ, ずらし, 順番, 緩急, 始まりの細さ (20–100 %).
- **見せ「脈打つ太さ」** (`weightPulse`): while the line is on screen its letters swell in weight on every beat (a quick
  30 ms rise, a soft fall, back to rest before the next beat) or, without a beat grid, slowly breathe. Params: 強さ,
  速さ, 振れ幅 (100–400), 戻り, 周期.
- **抜け「細る」** (`weightThin`): the letters thin out and fade. Params as 太る (終わりの細さ).
- **「太さ」 per line or cut** (行 › 色と書体, 複数行 › 色と書体, カット › 文字; 詳しい設定): 自動 or 100–900 (step 100;
  the face snaps to a served weight). 自動 = the typeface's weight, or the heaviest weight when the line enters with 太る
  in a work with 「太さを動かす」 on.
- **Automatic.** 作品全体 › 見た目 › 詳しい設定 「太さを動かす」. When on, the planner may choose 太る, 脈打つ太さ and 細る
  like any other entrance, hold or exit, on lines whose typeface has room (M5.4.4) and whose lettering is plain or
  glowing. Target: 太る on about **10 %** of the eligible lyric lines (≈ 7 % of all lyric lines; measured and asserted,
  M5.7).
- **Limits shown to the user.** A pinned weight part on a typeface with too few weights (見出し faces like Dela Gothic
  One, Yuji Syuku, Mochiy Pop One) shows 「この書体は太さの種類が少ないため、太さの動きが見えません（{書体}）」; on a line
  with 縁取り, 影 or 二色 lettering the weight changes in steps and the inspector says 「文字の飾り（縁取り・影・二色）が
  あるため、太さは段階的に変わります（{書体}）」. Measured over the 16 themes: the ja 見出し face has one weight in
  **11 of 16** themes; 72 of 96 theme face slots (role × ja/latin) have ≥ 300 between their lightest weight and their
  heaviest weight up to 800 (太る with the bold end), 43 of 96 have ≥ 300 below their own weight (細る), 73 of 96 have
  ≥ 200 up or down (脈打つ太さ) (probe `p4r/room2.js`). In the fixture corpus 444 of 600 lyric cuts (74 %) are eligible
  for 太る (probe `p4r/grow_rate.js`). 13 themes letter in `plain`, one each in `glow`, `shadow`, `duo`.
- **Defaults.** New works: 「太さを動かす」 on. Works made before PV22: off (the three parts can still be picked by
  hand; a pinned 太る then grows to the typeface's weight unless 太さ is set).

### M5.2 Gating and defaults

- The three parts are `pool: false, late: true, optIn: 'weight'`: in no pool unless the planner passes
  `optIn: ['weight']` (0.2), outside `registry.version`.
- `planner/cast` passes `optIn` only when `ctx.glyph.weight` is on, the cut's lettering style is `plain` or `glow`, and
  the cut's face has room. Legacy documents → never → today's pools and chooser draws.
- `text.weight` decisions exist only where a pin resolves or where the grow rule fires (`ctx.glyph.weight` on and the
  cut's arrive is 太る). Legacy documents: neither → existing `cut.slots` unchanged.
- The draw path reads `wt` only when it is `≠ 0`; every existing behaviour leaves it at 0.

### M5.3 Data model

- **Pose.** `wt` (column 23, ADD, identity 0, weight units; 0.4). Not clamped at solve; clamped to the face's ladder at
  draw.
- **Behaviour.** Optional `wt: [lo, hi]` — the offsets it may write (declared by the kit option `wt`, M5.4.5).
- **Scene.** `scene.wtReach = null | [lo, hi]` = union of its behaviours' `wt` (set in `build.sceneOf`).
- **Slots.** `text.weight`: `SLOT_SPECS['text.weight'] = { type: 'int', min: 100, max: 900 }`. Pins at cut/line/work.
  `decideTextWeight(st)` right after `decideText(st)`: `if (!PA.pinned(ctx.ix, 'text.weight')) return; const pin =
  PA.resolvePin(ctx.ix, st.at, 'text.weight', accept, ctx.warn); if (pin) setDecision(st, 'text.weight',
  pinDecision(pin));` (trace like `decideRepeat`). Rule decision (M5.4.4): `{ v, from: 'rule' }`, trace rule
  `weight.grow`. `weight.auto`: work pin (0.3).
- **Warnings.** New plan warning codes `weight-flat` and `weight-style`, both `{ code, cut, line, detail: family }`.
- No document field, no migration.

### M5.4 Algorithm

#### M5.4.1 Approach chosen, and the others

| Approach | For | Against | Verdict |
|---|---|---|---|
| **A. Stroke emboldening** (`strokeText` in the fill ink, `lineWidth = 2δ·em`, round joins) | Any font, even system fallbacks; continuous; one extra call | Can only thicken, so "thin → bold" needs a thin base and then looks like a rounded gothic, not a designed bold; fills counters of dense kanji at δ > 0.03 em; rounds mincho serifs; interacts with the `outline` style's own stroke | Rejected |
| **B. Variable fonts** (`wght@100..900`, `ctx.font` weight per frame) | True intermediate weights | Which Google families serve a `wght` range, and whether `text=` subsets keep the axis, is unverified (a wrong range fails the whole CSS2 request with HTTP 400, NOTES WP2); Canvas2D variable-font support and cost differ per browser; system fallbacks cannot vary; many font instances per frame | Rejected (could later replace C for families marked variable, without changing parts or the column) |
| **C. Ladder crossfade** between the family's served static weights | Real designed weights; uses `FAMILY_ROWS` weights that are known to be served; same pattern as §4.19.5's blur crossfade; works on both paths (the sprite key already contains the font css) | Two draws per animating glyph; single-weight families cannot animate; the in-between is a composite, not a true weight; exact only for a single solid fill (see below) | **Chosen** |

C with a plain crossfade (alpha `1 − f` and `f`) dims the core by 25 % mid-rung, and 太る crosses up to 7 rungs: a
visible flicker. The **over-composite** keeps the core exact: the lighter glyph lies (almost) inside the heavier one,
so draw the heavier at `a·f` and the lighter over it at `y = a(1 − f)/(1 − a·f)`; then the core has alpha
`a·f + y − a·f·y = a` and the heavier-only fringe `a·f` (checked numerically for a ∈ {1, 0.75, 0.5, 0.2},
f ∈ {0 … 1}, probe `ladder.js`). At `f = 0` only the lighter is drawn, at the next rung's `f = 0` the former heavier
alone — continuous.

**Text styles.** The argument holds for one solid fill. `sprites.paintStyled` draws `outline` as a fill in the second
ink plus a stroke in the ink, and `shadow`/`duo` as an offset copy in the second ink before the fill: a lighter body over
a heavier one would put its stroke or its offset copy inside the heavier fill (an inner contour or dark patches, up to
full alpha). So the crossfade is used only for `plain` and `glow` (whose halo is drawn once, under the body); for
`outline`, `shadow` and `duo` the draw takes the nearest served weight (`f < 0.5` → lighter, else heavier) with no
crossfade — the weight changes in steps. The planner never picks the weight parts for those styles (M5.4.4); a pin
there warns `weight-style`.

#### M5.4.2 Ladders (`engine/text/faces`, pure data, planner-safe)

```js
function ladderOf(ref) { const k = FAMILIES[ref.family]; return k ? k.weights : [ref.weight]; }   // sorted, frozen
const RUNGS = new WeakMap();                                   // FontRef → Map(weight → FontRef)
function atWeight(ref, w) {                                     // the same family/script/flavor/role at served weight w
  if (w === ref.weight) return ref;
  let m = RUNGS.get(ref); if (!m) { m = new Map(); RUNGS.set(ref, m); }
  let r = m.get(w); if (!r) { r = faceRef(ref.family, w, ref.script, ref.flavor, ref.role); m.set(w, r); }
  return r;
}
const W_EPS = 1 / 64;
function weightPair(ref, dw, out) {                             // out = { lo, hi, f, plain }
  const L = ladderOf(ref), w = ref.weight + dw, top = L[L.length - 1];
  let lo = L[0], hi = L[0], f = 0;
  if (w >= top) { lo = hi = top; }
  else if (w > L[0]) { let k = 0; while (L[k + 1] <= w) k++; lo = L[k]; hi = L[k + 1]; f = (w - lo) / (hi - lo); }
  if (f < W_EPS) { hi = lo; f = 0; } else if (f > 1 - W_EPS) { lo = hi; f = 0; }
  out.lo = atWeight(ref, lo); out.hi = f > 0 ? atWeight(ref, hi) : null; out.f = f; out.plain = f === 0 && lo === ref.weight;
  return out;
}
function roomOf(ref) { const L = ladderOf(ref); return { below: ref.weight - L[0], above: L[L.length - 1] - ref.weight }; }
const GROW_TOP = 800;
function growTop(ref) { let t = null; for (const w of ladderOf(ref)) if (w <= GROW_TOP) t = w; return t === null ? ref.weight : t; }
function rungsBetween(ref, dlo, dhi) {                          // served weights a reach [dlo, dhi] can draw
  const L = ladderOf(ref), a = ref.weight + dlo, b = ref.weight + dhi;
  const lo = L.filter((w) => w <= a).pop() ?? L[0], hi = L.find((w) => w >= b) ?? L[L.length - 1];
  return L.filter((w) => w >= lo && w <= hi);
}
function reweigh(faces, role, w) { … }   // faces with faces[role][script] = faceRef(family, w, script, flavor, role); cached per (faces, role, w)
```

`ref.weight` is already a served weight (`faceRef` snaps); unknown families (a user's face pin) have a one-rung ladder and
never animate.

#### M5.4.3 Drawing (`engine/render/draw`)

`drawGlyph(dc, scene, i, M)` becomes `drawGlyphAs(dc, scene, i, M, -1, 0)`:

```js
const CROSSFADE_STYLES = new Set(['plain', 'glow']);
function drawGlyphAs(dc, scene, i, M, alphaIn, blurAdd) {
  // … as today, with: alpha = alphaIn < 0 ? table.wa[i] : alphaIn;  blur = P.blur[i] + probe + blurAdd (+0 keeps the value)
  const dw = P.wt[i];
  let wp = dw !== 0 ? FACES.weightPair(rec.font, dw, WP) : null;         // WP: module-level pooled object
  if (wp && wp.hi && !CROSSFADE_STYLES.has(rec.style)) snapPair(wp, rec.font);   // steps for outline/shadow/duo
  if (wp && dc.faceReady !== null) readyPair(dc, rec.font, wp);           // only loaded weights (M5.4.6)
  if (wp && wp.plain) wp = null;                                          // back at the face's own weight
  const fx = wp ? recAs(dc.recX, rec, wp.hi && wp.f >= 0.5 ? wp.hi : wp.lo) : rec;   // the face of halo/echo/tint
  // the path choice is unchanged: only blur, glow, shard, pixel (FROZEN §4.19.5)
  if (direct) {
    if (halo > 0) drawHalo(dc, g, fx, M, SP.bucketOf(fx.em * SH.scaleOf(M)), alpha, halo);
    if (g) wp ? drawDirectW(dc, g, rec, fx, M, alpha, ink, ink2, tint, echo, wp) : drawDirect(dc, g, rec, M, alpha, ink, ink2, tint, echo);
  } else {
    drawSprite(dc, g, rec, fx, M, alpha, ink, ink2, tint, echo, blur, halo, shard, pixel, seed, wp);   // body twice when wp.hi
  }
}
// snapPair(wp, base): wp.lo = wp.f >= 0.5 ? wp.hi : wp.lo; wp.hi = null; wp.f = 0; wp.plain = wp.lo === base
// readyPair(dc, base, wp): if (wp.hi && !dc.faceReady(wp.hi)) { wp.hi = null; wp.f = 0; }
//   if (!dc.faceReady(wp.lo)) wp.lo = nearestReady(dc, base, wp.lo);   // walk the ladder from wp.lo toward base.weight;
//   the base face itself ends the walk (it is the face the scene was built with); wp.plain = !wp.hi && wp.lo === base
// body(recB, a): what drawDirect / spritePair draw for the glyph body today, with recB's font
// drawDirectW: echo copies (fx) → if (wp.hi) body(recAs(dc.recHi, rec, wp.hi), alpha·f) → body(recAs(dc.recLo, rec, wp.lo),
//              wp.hi ? alpha·(1 − f)/(1 − alpha·f) : alpha) → tint copy (fx)
// drawSprite with wp: echo pairs and tint pair with fx; pixel/shard with fx (one body); else two spritePair bodies as above
//              (one when wp.hi is null)
```

`recAs(target, rec, font)` = `Object.assign(target, rec); target.font = font; return target` into three pooled objects
of the draw context (`recX`, `recHi`, `recLo`), so nothing is allocated per frame. `createDrawContext(o)` gains
`faceReady: o.faceReady || null` (null → every served weight counts as loaded: Node, the recorder, the lab). With
`wp === null` the code executes the exact calls of today in the same order (golden-safe). `glyphCover` counts the body
twice when `P.wt[i] !== 0`, the style crossfades and the pair has `hi` (`poseCover(…, bodies)` additive parameter,
default 1; font readiness is ignored there, so the cost model stays a pure function of the scene).

#### M5.4.4 Planner: opt-in pools, eligibility, the grow rule, warnings (`planner/cast`)

```js
const WEIGHT_OPT_IN = Object.freeze(['weight']);
const GROW_KEY = 'weightGrow';
const GROW_ROOM = 300, PULSE_ROOM = 200, FLAT_ROOM = 100;
const CROSSFADE = new Set(['plain', 'glow']);
function faceOfCut(st) {                                         // the FontRef the cut's lyrics are laid out with
  const role = st.slots['text.face'] ? st.slots['text.face'].v : 'display';
  const ref = FACES.fontFor(st.ctx.look.faces, role, st.cut.lang);
  const tw = st.slots['text.weight'];
  return tw ? FACES.atWeight(ref, FACES.snapWeight(ref.family, tw.v)) : ref;
}
function styleOf(st) { return st.slots['text.style'] ? st.slots['text.style'].v : 'plain'; }
function weightOptIn(st, kind) {                                  // kind ∈ arrive dwell depart
  if (!st.ctx.glyph || !st.ctx.glyph.weight || !PER_CUT_ROLES.has(st.cut.role)) return null;
  if (!CROSSFADE.has(styleOf(st))) return null;
  const ref = faceOfCut(st), L = FACES.ladderOf(ref);
  let ok;
  if (kind === 'arrive') ok = (st.slots['text.weight'] ? ref.weight : FACES.growTop(ref)) - L[0] >= GROW_ROOM;
  else if (kind === 'depart') ok = ref.weight - L[0] >= GROW_ROOM;
  else { const r = FACES.roomOf(ref); ok = Math.max(r.below, r.above) >= PULSE_ROOM; }
  return ok ? WEIGHT_OPT_IN : null;
}
// Right after the arrive decision (castSlots' MOTION_KINDS loop, when kind === 'arrive'):
function growWeight(st) {
  const { ctx } = st;
  const a = st.slots.arrive;
  if (!ctx.glyph || !ctx.glyph.weight || !a || a.v !== GROW_KEY) return;
  if (st.slots['text.weight']) return;                           // a pin decides
  const ref = faceOfCut(st), top = FACES.growTop(ref);
  if (!(top > ref.weight)) return;                               // nothing bolder to end on
  setDecision(st, 'text.weight', { v: top, from: 'rule' });      // trace: stage 'rule', rule 'weight.grow'
}
```

- **Eligibility** for 太る is measured from the lightest weight to the weight it will end on: the pinned 太さ, else the
  heaviest served weight up to 800 (the rule's value). 細る and 脈打つ太さ read the cut's face after that (so a line that
  grows can also thin out from bold).
- **The grow rule** runs inside the cast (after the arrive decision, before dwell and depart), so its decision is part of
  the cast result and is cached and reused with it (the same mechanism that keeps every cast decision; no separate
  freezing like `tracks.replaceMotion` is needed, since that one runs outside the cast). It fires for a pinned 太る too,
  when the switch is on. It does not fire when the arrange forces motions (`motion-own` → arrive fallback). Aligned
  copies (「くり返しの行をそろえる」) copy 太る and so get the same rule. A morph seam that replaces B's arrive removes the
  rule's decision (`tracks.dropGrowWeight`, M4.4.5). `text.weight` changes the cut's faces for the build (M5.4.7), so
  the cut's `fp` changes like any slot change.
- **Rate target.** `weightGrow` carries `weight: 2` (the chooser's base weight; §4.16.4). Probe `p4r/grow_rate.js`
  (Gumbel-max simulation over the traced arrive pools of 74 eligible cuts, median pool 21 candidates, mean candidate
  weight 0.87): a candidate of 2 × the mean wins 8.5 %, 3 × 12.5 %; `weight: 2` × the part's mood/fit factors (≈ 1)
  gives ≈ 2.3 × mean → ≈ 10 %. The implementer runs the rate test (M5.7 test 5) and adjusts `weight` in steps of 0.25
  until the measured share is within [0.08, 0.12]; the test's band is [0.06, 0.14]. `weightThin` and `weightPulse` keep
  `weight: 1` (≈ 4 % each among their eligible cuts).
- **Plumbing** (checked against `planner/cast.js`): `poolEntry(ctx, kind, sub, role, orient, script, aspect, scope, cond,
  optIn)` gains the last argument, appends `'|w'` to the entry id when it is set and passes `optIn` on to
  `ctx.registry.pool(kind, { …, optIn })`. `chooseAuto(ctx, req)` reads `req.optIn` and passes it to **both** of its
  `poolEntry` calls (the full pool and the stage-2 relaxed pool). `decidePart` sets `req.optIn = weightOptIn(st, kind)`
  for `arrive`, `dwell`, `depart`; `shadow(st, kind, …)` (the traced alternatives) passes the same `optIn`; the
  aligned-copy fit check (`cast.js:602`) passes the same value. `poolOf` and every other caller (P2's kits included)
  pass nothing, so their pools are today's.
- **Warnings** (after the three motion decisions, through the cast's warning channel, replayed on cache hits): a chosen
  definition with `optIn === 'weight'` whose room in its direction (arrive: end weight − lightest; depart: `below`;
  dwell: `max(below, above)`) is `< FLAT_ROOM` → `weight-flat`; one whose cut's style is not in `CROSSFADE` →
  `weight-style` (both only for pins or rules — the automatic path never chooses them there).
- **Explain** (`planner/explain.altsOf`): `if (def.pool === false && !(def.optIn !== undefined && weights.has(def.key)))
  continue;` — an opt-in part is listed when the traced pool offered it, so an automatically picked 太る shows among
  its alternatives with its weight. The `text.weight` rule explains as `whyRule.weight.grow`.

#### M5.4.5 Parts (kit option `{ prep, wt }`)

Kit and maker changes (additive):

```js
// parts/kit.js
function glyphOpts(opts) {
  if (opts === undefined) return null;
  if (!isObject(opts) || (opts.prep !== undefined && typeof opts.prep !== 'function') ||
      (opts.wt !== undefined && typeof opts.wt !== 'function')) throw new KitError('bad-fn', 'K.perGlyph options are { prep, wt }');
  return Object.freeze({ prep: opts.prep || null, wt: opts.wt || null });
}
function perGlyph(fn, opts) {
  if (typeof fn !== 'function') throw new KitError('bad-fn', 'K.perGlyph needs a function');
  const o = glyphOpts(opts);
  const make = BH.glyphMotionMaker('arrive', { unit: 'glyph', fn, prep: o && o.prep, wt: o && o.wt });
  make.glyphFn = fn; make.glyphOpts = o;
  return make;
}
function perGlyphHold(fn, opts) {
  if (typeof fn !== 'function') throw new KitError('bad-fn', 'K.perGlyphHold needs a function');
  const o = glyphOpts(opts);
  const make = BH.holdMaker(fn, o);
  make.holdFn = fn; make.holdOpts = o;
  return make;
}
// motionKind(kind), the glyphFn branch:
//   const fn = out.make.glyphFn, o = out.make.glyphOpts || null;
//   out.make = BH.glyphMotionMaker(kind, { unit: out.unit || 'glyph', fn, prep: o && o.prep, wt: o && o.wt });
//   out.make.glyphFn = fn; out.make.glyphOpts = o;
// mirror(arriveDef, patch), the glyphFn branch: def.make = perGlyph(reversedFn(arriveDef.make.glyphFn), arriveDef.make.glyphOpts || undefined)

// engine/scene/behave.js
function glyphMotionMaker(kind, source) {
  return function make(env, target, p) {
    if (!target || target.to <= target.from) return [];
    const params = source.prep ? source.prep(env, target, p || {}) : (p || {});
    … (as today, with `params`) …
    if (source.wt) b.wt = source.wt(params);
    return [b];
  };
}
function holdMaker(fn, opts) {
  return function make(env, target, p) {
    if (!target || target.to <= target.from) return [];
    const params = opts && opts.prep ? opts.prep(env, target, p || {}) : (p || {});
    … (as today, with `params`) …
    if (opts && opts.wt) hold.wt = opts.wt(params);
    return [warped(hold, params.curve, env.times.rest, env.times.out)];    // warped and masked copies keep `wt`
  };
}
```

So `K.depart` re-wraps a `K.perGlyph(fn, opts)` exit as a real exit (`t0 = times.out`, `live: 'after'`, `exit: true`),
and every wrapper-free part keeps working as before. The parts:

```js
// parts/arrive/weight.js and parts/depart/weight.js share THIN_OPTS (a small module-local copy in each file):
function thinPrep(env, target, p) { return Object.assign({}, p, { reach: Math.round(p.thin * K.weightRoom(target).below) }); }
const THIN_OPTS = { prep: thinPrep, wt: (p) => [-p.reach, 0] };

function grow(P, g, k, u, p) { P.wt -= p.reach * (1 - k); P.alpha *= FADE(clamp(u / 0.3)); }   // FADE = K.ease('quadOut')
K.arrive({
  key: 'weightGrow', label: L('太る', 'Weight grow'),
  blurb: L('細い字で現れ、太い字へ育っていく', 'Letters appear thin and grow bold'),
  tags: ['bold', 'slow'], family: 'weight', pool: false, late: true, optIn: 'weight', unit: 'glyph', weight: 2,
  traits: { energy: [0.1, 0.85], roles: ['lyric', 'focus', 'title'] },
  shared: { dur: { auto: { range: [0.7, 1.3], follow: '-energy' } }, each: { auto: { range: [0.02, 0.05] } },
    order: { auto: { pick: ['lead', 'core'], weights: [3, 1] } }, ease: { auto: { pick: ['cubicOut', 'sineInOut'], weights: [2, 1] } } },
  params: { thin: { type: 'num', min: 0.2, max: 1, step: 0.05, unit: 'frac', label: L('始まりの細さ', 'Start thinness'),
    auto: { value: 1 } } },
  make: K.perGlyph(grow, THIN_OPTS),
});

function thin(P, g, k, u, p) { P.wt -= p.reach * k; P.alpha *= 1 - FADE_IN(clamp((u - 0.6) / 0.4)); }   // FADE_IN = K.ease('quadIn')
K.depart({
  key: 'weightThin', label: L('細る', 'Weight thin'),
  blurb: L('字が細くなりながら消えていく', 'Letters thin out and fade'),
  tags: ['soft', 'slow'], family: 'weight', pool: false, late: true, optIn: 'weight', unit: 'glyph',
  traits: { energy: [0.05, 0.7], roles: ['lyric', 'focus', 'title'] },
  shared: { dur: { auto: { range: [0.5, 0.9], follow: '-energy' } }, each: { auto: { range: [0.01, 0.03] } },
    order: { auto: { pick: ['lead', 'tail'], weights: [2, 1] } }, ease: { auto: { pick: ['sineIn', 'quadIn'], weights: [2, 1] } } },
  params: { thin: { type: 'num', min: 0.2, max: 1, step: 0.05, unit: 'frac', label: L('終わりの細さ', 'End thinness'),
    auto: { value: 1 } } },
  make: K.perGlyph(thin, THIN_OPTS),              // K.depart re-wraps it as an exit (kit motionKind)
});

// parts/dwell/weight.js — weightPulse 「脈打つ太さ」 (the envelope of thumpSwell, parts/dwell/lively.js)
const RISE = 0.03, AMP_MAX = 400;
function pulsePrep(env, target, p) {
  const room = K.weightRoom(target);
  const dirW = room.above >= p.swing ? 1 : room.below >= p.swing ? -1 : (room.above >= room.below ? 1 : -1);
  const amp = Math.min(dirW > 0 ? room.above : room.below, Math.round(p.swing * (0.5 + 0.5 * p.amount)), AMP_MAX);
  return Object.assign({}, p, { dirW, amp, rest: env.times.rest });
}
function pulse(P, g, time, w, p, fc) {
  let s;
  if (fc.beat) {                                   // 30 ms rise, exponential fall, back to rest before the next beat
    const since = fc.beat.since, ph = fc.beat.phase;
    s = N.smooth(since / RISE) * Math.exp((-since * p.speed) / p.decay) * (1 - ph * ph);
  } else {
    s = 0.5 - 0.5 * Math.cos((TAU * (fc.tl - p.rest) * p.speed) / p.period);
  }
  P.wt += p.dirW * p.amp * w * s;
}
K.dwell({
  key: 'weightPulse', label: L('脈打つ太さ', 'Weight pulse'),
  blurb: L('拍ごとに字が太さで脈打つ', 'Letters swell in weight on every beat'),
  tags: ['bold', 'fast'], family: 'weight', pool: false, late: true, optIn: 'weight', needs: ['beats'],
  traits: { energy: [0.35, 1], roles: ['lyric', 'focus'] },
  fits: (f) => (f.beat ? 1.2 : 0.4),
  params: {
    swing: { type: 'int', min: 100, max: 400, step: 25, label: L('振れ幅', 'Swing'), auto: { range: [150, 300], follow: 'energy' } },
    decay: { type: 'num', min: 0.1, max: 0.5, step: 0.01, unit: 's', label: L('戻り', 'Decay'), auto: { range: [0.12, 0.22], follow: '-tempo' } },
    period: { type: 'num', min: 0.6, max: 4, step: 0.1, unit: 's', label: L('周期', 'Period'), auto: { range: [1.2, 2.2], follow: '-tempo' } },
  },
  make: K.perGlyphHold(pulse, { prep: pulsePrep, wt: (p) => (p.dirW > 0 ? [0, p.amp] : [-p.amp, 0]) }),
});
```

- **Identity rule** (`conformance.test.js`): 太る at progress 1 writes `wt 0`, `alpha ×1`; 細る at progress 0 writes 0
  and ×1 — with the exit re-wrap, 細る's behaviour has `exit === true` and `t0 === times.out`, so the conformance probe
  at its `t0` is the rest pose.
- **No jumps in 脈打つ太さ.** `|d wt/dt| ≤ amp · max(1.5 / RISE, speed / decay) ≤ 400 · max(50, 4 / 0.1) = 20 000`
  weight units per second → ≤ 41.7 per 1/480 s step with a beat grid; without one ≤ `400 · π · 4 / 0.6 / 480 ≈ 17.5`.
  `assertSmallJumps` gets the limit **60** for `wt` (other columns unchanged).
- **Deferrable.** 脈打つ太さ is the last M5 step (X, order). If the contact-sheet QA rejects it (e.g. the fringe
  flickers on every beat), it is dropped without touching anything else — nothing depends on it; the owner's request
  (細字から太字へ育つ) is 太る.
- `K.weightRoom(target)` (kit): over `target.runs[k].layout`, count non-space glyphs per font
  (`layout.fonts[layout.font ? layout.font[i] : 0]`), take the most used (ties by `font.key` order), return
  `FACES.roomOf(font)`; `{ below: 0, above: 0 }` for an empty target. The layout fonts already carry `text.weight`
  (M5.4.7), so 太る after the grow rule reaches from the lightest weight to the bold end.

#### M5.4.6 Fonts for the rungs: draw-only faces

**Why not ordinary usage.** Every FontBook face that finishes loading bumps `epoch` (`fonts.js` `watch` → `bump()`,
also when a family's stylesheet URL changes to add a weight); the measurer key is `'canvas:' + epoch`; the facade's
scene cache is keyed by it (`sceneFor: cache.get(item.fp, measurer.key)`). Up to 8 extra weights per family would
rebuild and re-measure every cached scene once per weight, and while any weight is waiting the scene is marked
provisional. And Canvas2D does not wait: a weight whose `@font-face` is declared but not loaded draws in the stack's
system fallback; a weight that is not declared at all is synthesized from a lighter face (fake bold). Both would flash
mid-animation.

**FontBook** (`engine/host/fonts.js`, additive):

```js
const drawStates = new Map();   // ref.key → 'loading' | 'ready' | 'failed' (draw-only faces)
const drawUrl = new Map();      // ref.key → the newest stylesheet URL that declares it
const drawChars = new Map();    // family → the characters asked for draw-only faces (separate from the main chars)
const drawListeners = new Set();

function startDraw(refs, text) {                    // → [{ ref, url }]
  const jobs = [];
  for (const [family, all] of groupRefs(refs)) {    // like groupByFamily, without recording in `known` (failures())
    const list = all.filter((r) => !states.has(r.key));        // a weight the main path owns is never redeclared
    if (!list.length) continue;
    const merged = FACES.uniqueChars((drawChars.get(family) || '') + textFor(text, family));
    drawChars.set(family, merged);
    const [url] = FACES.cssUrls(list, { [family]: merged });
    for (const ref of list) {
      if (drawUrl.get(ref.key) !== url) { drawUrl.set(ref.key, url); drawStates.set(ref.key, 'loading'); }
      jobs.push({ ref, url }); watchDraw(ref, url);
    }
  }
  return jobs;
}
// watchDraw(ref, url): addSheet(url) → fonts.load(ref.css(100), FACES.loadText(ref, drawChars.get(ref.family))) →
//   ok and drawUrl.get(ref.key) === url → drawStates 'ready', call drawListeners; failed and still the newest url → 'failed'.
//   Never bump(). Cached per (ref.key, url, text) like watch().
function request(refs, text = {}, opts) { if (opts && opts.drawOnly) startDraw(refs, text); else start(refs, text); }
async function ready(refs, text = '', opts = {}) { … opts.drawOnly → startDraw/watchDraw and drawStates instead … }
function drawStatus(ref) { return states.has(ref.key) ? states.get(ref.key) : (drawStates.get(ref.key) || 'idle'); }
// on('draw', fn) → off; on('epoch', fn) unchanged
```

A draw-only face is declared in its own stylesheet and only for weights the main path does not own, so no main face is
ever redeclared (the last declaration of a weight wins in CSS; redeclaring a loaded main weight would make it draw in
fallback until the new sheet loads). A weight declared by a newer draw-only sheet (more characters) is `loading` again
until that sheet is in, because the newest declaration is the one Canvas2D uses. Draw-only failures are not listed by
`failures()` (the base weight draws instead; nothing to warn about).

**Facade** (`engine/facade.js`):

- `sceneUsage(scene, particleFace)` → `u` as today plus, when `scene.wtReach`, `u.draw` (`Map(ref.key → ref)`) and
  `u.drawChars` (`Map(family → Set)`): for every non-space glyph and every `w of FACES.rungsBetween(g.font, lo, hi)`
  with `w !== g.font.weight`, the ref `FACES.atWeight(g.font, w)` and `g.ch`. `u.refs` (the main usage) is unchanged.
- `request(u)`: the main part as today; then, when `u.draw` has refs not yet covered by `requestedDraw` (or one is
  `failed`), `fonts.request(drawRefs, drawTextByFamily, { drawOnly: true })`. `provisionalFor`, `settle` and `waiting`
  read only `u.refs`: rungs never make a scene provisional.
- `createDrawContext({ …, faceReady })` with `faceReady = fonts && typeof fonts.drawStatus === 'function' ? (ref) =>
  fonts.drawStatus(ref) === 'ready' : null`.
- `prepareExport(lo, hi)`: after `await fonts.ready(out.refs, out.textByFamily)`, `await fonts.ready(drawOut.refs,
  drawOut.textByFamily, { drawOnly: true })` for the draw usage of the same items; exported frames therefore draw every
  rung (a rung that failed draws the nearest loaded weight, like any failed face falls back today).
- `estimateUsage` is unchanged (it cannot know the parts); built scenes add their draw usage as they are built.

**Repaint.** `ui/boot.js:1103` adds `fonts.on('draw', repaint)` next to the `epoch` listener (no `app.bus.emit('fonts')`,
no rebuild), so a paused preview picks up a rung as soon as it arrives. `ui/lab.js:607` likewise.

#### M5.4.7 `text.weight` in the build

`build.buildCutWith`: `const tw = valueOf(slots, 'text.weight', null)`; when set, `const faces = FACES.reweigh(svc.faces
|| plan.look.faces, valueOf(slots, 'text.face', 'display'), tw)` and `const text = svc.text.withFaces(faces)` is handed
to `B.createBuilder({ text, … })` and to `baseEnv` (`env.text`, `env.faces`). `withFaces` shares the layout LRU; the key
includes the faces. Only the cut's lyric face role changes; notes keep theirs. P1's cut-scoped `withKumi` composes on top.
The bold end weight is a main-path face of the scene (its glyph records carry it), so it loads through the ordinary
usage; only the rungs below it are draw-only.

### M5.5 Changes by module and function

| Module | Function | Change |
|---|---|---|
| `engine/scene/table` | `POSE`, `ADD`, `SCHEMA` | `wt` (0.4) |
| `engine/scene/behave` | `DELTA`, `resetDelta`, `glyphMotionMaker` (`prep`, `wt`), `holdMaker` (`opts`) | 0.4, M5.4.5 |
| `parts/kit` | `perGlyph`/`perGlyphHold` (`opts`), `glyphOpts`, `motionKind` re-wrap, `mirror`, `COLUMN_WORDS.wt = ['太さ', 'Weight']`, `rangeFor('wt') = [-800, 800, 25]`, `weightRoom` | M5.4.5 |
| `engine/text/faces` | `ladderOf`, `atWeight`, `weightPair`, `roomOf`, `growTop`, `rungsBetween`, `reweigh` | M5.4.2 |
| `engine/render/draw` | `drawGlyphAs`, `drawDirectW`, `drawSprite` (wp), `snapPair`, `readyPair`, `nearestReady`, `recAs`, `createDrawContext` (`recX recHi recLo faceReady`), `glyphCover`/`poseCover` | M5.4.3; import `engine/text/faces` |
| `engine/host/fonts` | `request`/`ready` (`drawOnly`), `startDraw`, `watchDraw`, `drawStatus`, `on('draw')` | M5.4.6 |
| `engine/scene/build` | `buildCutWith` (`text.weight`), `sceneOf` (`wtReach`) | M5.4.6–7 |
| `engine/facade` | `sceneUsage` (draw usage), `request`, `prepareExport`, draw context `faceReady`; `samplePlan` for `optIn: 'weight'` parts: the sample cut takes `text.face = 'body'` and `text.weight = 800` so the tile shows the effect | |
| `planner/cast` | `SLOT_SPECS['text.weight']`, `decideTextWeight`, `growWeight`, `weightOptIn`, `faceOfCut`, `styleOf`, `poolOf`/`poolEntry`/`chooseAuto` (`optIn`), `shadow` (`optIn`), `weight-flat`/`weight-style` | M5.4.4 |
| `planner/explain` | `altsOf` (opt-in parts), rule `weight.grow` | M5.4.4 |
| `planner/plan` | stage 2 `ctx.glyph.weight` | 0.3 |
| `core/commands` | `TEXT_SLOTS` (`text.weight`), `NOT_CUT` + work-only (`weight.auto`) | 0.3 |
| `ui/fields` | `WORK_NAMES` (`weight.auto`), `CUT_NAMES` (`text.weight`); work look section: 「太さを動かす」 toggle; 行/複数行 › 色と書体 and カット › 文字: 「太さ」 number (100–900, step 100, `auto: true`, `basic: false`) | 0.3 |
| `ui/part_browser` | `pooled(def)` in `counts`/`normalize`/`setFilter` | 0.2 |
| `ui/boot`, `ui/lab` | `fonts.on('draw', repaint)` | M5.4.6 |
| `parts/arrive/weight`, `parts/dwell/weight`, `parts/depart/weight` | new | M5.4.5 |
| `tests/node/conformance.test.js` | dwell jump limit | `wt` → 60 weight units per step |
| `docs/DESIGN.md` | §4.14 draw-only faces; §4.17.1 column list and SCHEMA 2; §4.17.4 `wt` declaration; §4.18.3 kit (DELTA, options, `weightRoom`); §4.19.5 addendum "weight pairs do not change the path; crossfade for plain/glow only"; §5.2/§5.3/§5.4 rows | |

DESIGN §5 rows:
`| \`weightGrow\` (pool false) | 太る | Weight grow | bold slow | Letters appear thin and grow bold. |`
`| \`weightPulse\` (pool false) | 脈打つ太さ | Weight pulse | bold fast | Letters swell in weight on every beat. |`
`| \`weightThin\` (pool false) | 細る | Weight thin | soft slow | Letters thin out and fade. |`

UI rows (Japanese names): 作品全体 › 見た目 › 詳しい設定: 「同じ字をつなぐ」, 「太さを動かす」 (toggles, `autoDefault: true,
noDice: true, basic: false`; shown value = `RU.value`; a change writes `pin.set` with the new value, or `pin.clear` when
it equals `RU.defaultValue(doc, ix, slot)` — one command, one undo entry, label `undo.pin`). 行 › 演出 › 詳しい設定:
「前の行から字をつなぐ」 [自動 | つなぐ | つながない] (`auto: true`: 自動 clears; hidden on the first line). 行 › 色と書体 /
複数行 › 色と書体 / カット › 文字 (詳しい設定): 「太さ」.

### M5.6 Strings

| key | ja | en |
|---|---|---|
| `fld.weightAuto` | 太さを動かす | Animate stroke weight |
| `fld.weightAuto.note` | 太さの種類が多い書体の行で、細い字から太い字へ育つ入りや、拍に合わせて太さが脈打つ見せを自動で使います。 | On lines whose typeface has many weights, uses entrances that grow from thin to bold and holds whose weight pulses with the beat. |
| `fld.textWeight` | 太さ | Weight |
| `fld.textWeight.note` | 書体にない太さは、いちばん近い太さで表示します。 | A weight the typeface lacks shows as its nearest weight. |
| `whyRule.text.weight` | 書体の太さのまま | The typeface's own weight |
| `whyRule.weight.grow` | 太る入りなので、書体のいちばん太い字で終わる | Enters growing, so it ends at the typeface's boldest weight |
| `warn.weight-flat` | この書体は太さの種類が少ないため、太さの動きが見えません（{detail}） | This typeface has too few weights, so the weight animation does not show ({detail}) |
| `warn.weight-style` | 文字の飾り（縁取り・影・二色）があるため、太さは段階的に変わります（{detail}） | The lettering has an outline, shadow or second colour, so the weight changes in steps ({detail}) |

Part labels, blurbs and parameter labels (太る, 脈打つ太さ, 細る, 始まりの細さ, 終わりの細さ, 振れ幅, 戻り, 周期) come from
the definitions. The column word 太さ (kit `COLUMN_WORDS`) is used only if a part exposes a `wt` track.

### M5.7 Tests

New `tests/node/weight.test.js`:

1. Faces: `ladderOf` of a known and an unknown family; `atWeight(ref, ref.weight) === ref`, stable object for other
   weights; `weightPair` at rung boundaries (f = 0 exactly, `plain`), mid-rung, below the lightest and above the heaviest
   (clamped), `W_EPS` snapping; `growTop` (Noto Sans JP → 800, a 400/700 family → 700, a one-weight family → its
   weight); `rungsBetween` for the three parts' reaches; `roomOf`; `reweigh` changes only the role.
2. Draw ops (recorder): `wt = 0` → the op list equals today's for the same glyph (golden-level identity); `wt` mid-rung
   on the direct path, style `plain` → `set:font` heavier, `fillText` at `a·f`, `set:font` lighter, `fillText` at
   `a(1−f)/(1−a·f)` (values to 1e-3); **style `outline`** mid-rung → one `fillText` + one `strokeText`, both with the
   nearest rung's font, no second body; **style `shadow`** → one offset `fillText` + one `fillText`, nearest rung;
   single-weight family → today's ops; sprite path (blur 1 du) → two sprite lookups with the two font objects (one for
   `duo`); echo/tint drawn once with the dominant face; `glyphCover` doubles the body only for plain/glow;
   `faceReady` returning false for the heavier rung → one body with the lighter; false for both → the base face.
3. Kit and parts: `K.perGlyph(fn, { prep, wt })` → `b.wt` set, `prep` called once per build with `(env, target, p)`;
   **細る's behaviour has `exit === true`, `t0 === env.times.out`, `live === 'after'`**; `K.mirror` of a part with
   options keeps them; one-argument `K.perGlyph` builds exactly today's behaviour (deep-equal on a catalog part);
   `reach` = `thin × room`; 脈打つ太さ direction choice for rooms (above only, below only, both); **with a 120 BPM beat
   grid, 2 s sampled at 480 Hz: every `wt` step ≤ 60, the peak ≥ 0.8·amp·w after each beat, and `wt` is back under
   0.05·amp before the next beat**; the no-beat cosine; a scene's `wtReach` is the union.
4. Font usage and loading: a scene with 太る on Noto Sans JP 500 → `fontUsage` main refs hold only 500 and the draw
   usage holds 100 … 400; `cssUrls` of the draw usage has `:wght@100;200;300;400` and only served weights for every
   family in `FAMILY_ROWS`. **Fake FontBook** (an object with `request`, `ready`, `status`, `drawStatus`, `on`, `epoch`):
   building and drawing that scene calls `request(…, { drawOnly: true })`; completing the draw-only loads leaves
   `fonts.epoch` and `measurer.key` unchanged, the scene is not rebuilt (`sceneFor` returns the same object) and never
   `provisional`; `prepareExport` awaits `ready(…, { drawOnly: true })`. FontBook unit test (with the fake document of
   `faces.test.js`): a draw-only load does not bump the epoch; `drawStatus` goes `loading → ready`; a later request with
   more characters sets it back to `loading` until its sheet loads; a weight the main path owns is not redeclared.
5. Planner: `weight.auto` off (legacy) → no opt-in in any pool, plan hash unchanged; on (`gen = 1`) → the parts appear
   in pools only on cuts whose face has room and whose style is plain/glow (serif 700 Zen Old Mincho yes, display Dela
   Gothic One no, a `duo` theme no); **grow rule**: an automatically or pin-chosen 太る with no 太さ pin → `text.weight`
   `{ v: growTop, from: 'rule' }` (trace rule `weight.grow`), a 太さ pin wins, `motion-own` → no rule, a morph seam
   replacing B's arrive removes it; **rate**: over `corpus.corpus(2, ['16:9'])` with `look.gen = 1` set on each document,
   among lyric/focus cuts whose `weightOptIn('arrive')` is non-null, the share whose arrive is `weightGrow` is in
   [0.06, 0.14]; a pinned 太る on a single-weight face → `weight-flat`, on an `outline` cut → `weight-style`, both replayed
   from the cast cache; `text.weight` pin → decision `from: 'pin:*'`, the cut's `fp` changes, no other cut changes;
   `pin.copy` copies it; cut pin of `weight.auto` refused, line pin of `weight.auto` refused.
6. Build: `text.weight` 800 → the scene's glyph records carry the 800 FontRef; notes keep their weight.
7. Explain (`planner_explain.test.js`): an automatically picked 太る lists itself among the alternatives with its
   weight; a cut without opt-in lists no weight part.

Updated: `frame.test.js` (`POSE.length` 23; the matrix test unchanged), `conformance.test.js` (limit for `wt`),
`catalog.test.js` (§5 rows), `faces.test.js`, `ui_fields.test.js` (new rows; `slotScopes('weight.auto')` = `['work']`,
`slotScopes('morph.auto')` = `['work', 'line']`, `slotScopes('text.weight')` = all; `autoDefault` on both toggles),
`commands.test.js` (scopes), `i18n.test.js` (pairs present). Browser: `glyph_parity.py` gains rows at intermediate
weights (direct vs sprite level 0 with two bodies ≤ 2/255 MAE, Noto Sans JP 300→500 at f = 0.5); `parts_gallery.py`
tiles for the three parts; `contact_sheet.py` `weight` sheet (mincho, gothic, Latin, vertical, single-weight face,
outline style); `ui_flows.py`: in a `?fresh=1` work, turn 「太さを動かす」 off → pin `false`, undo restores the unpinned
state.

**Mutation targets:** draw hi/lo in the other order or use `1 − f` for the lighter (test 2); crossfade for `outline`
(test 2); ignore `faceReady` (test 2); bump the epoch on draw-only loads (test 4); drop `wtReach` from usage (test 4);
pass `optIn` without the room or style check (test 5); drop the grow rule (test 5 rate and rule); the 細る plain
wrapper (test 3 exit); `exp` without the rise in 脈打つ太さ (test 3 jumps); `decideTextWeight` with an auto branch (legacy
plan hash test); `altsOf` skipping opt-in parts (test 7).

### M5.8 Goldens

| golden | why unchanged |
|---|---|
| `frame_hashes_v2.json` (FROZEN) | No behaviour writes `wt`, so `P.wt[i] === 0` everywhere and `drawGlyphAs` runs today's calls in today's order; the new column is not drawn or hashed; no `text.weight` decision; pools unchanged (no `optIn`); `faceReady` is null in the golden renders. |
| `plan_hashes.json` | Same pools, same chooser draws, no new slot decisions (the grow rule needs the switch), `registry.version` unchanged. |
| `frame_hashes.json`, `project_*.json` | Same plans and ops; same font usage (no `wtReach`, no draw usage). |

New: the `weight` document of `tests/golden/project_glyph.json` (M4.8): the basic fixture with `look.gen = 1` on a theme
with multi-weight plain faces, 太る pinned on two lines (one with 太さ 800 pinned, one taking the grow rule), 脈打つ太さ
on one, 細る on one, one 太る line with `text.style` `outline` (steps). **Frame times**: the 32 times
`duration · (i + 0.5) / 32`, then, for each of the first 4 cuts carrying a weight part (plan order), two times inside
its motion: arrive → `cut.a + {0.3, 0.6} · dur`, depart → `cut.b − {0.7, 0.4} · dur` (`dur` = the part's resolved
`p.dur`), dwell → `cut.t0 + {0.25, 0.5}` s — 40 frames, sorted.

### M5.9 Performance

- Every frame, every scene: one more `Float32Array.set` in `resetLive` (a few hundred floats); every glyph motion
  behaviour per glyph: one more compare in `mergeDelta`; every drawn glyph: one read and compare of `P.wt[i]`. Expected
  < 0.5 % of frame time; the existing `perf.py` rows run legacy fixtures and must stay within their run-to-run noise.
- While a weight motion runs: two body draws per animating glyph (direct path: two `fillText` and two font switches; no
  sprites, since 太る/細る/脈打つ太さ add no blur); one for outline/shadow/duo. The sprite path (a blurred glyph that
  also changes weight) makes one sprite per rung touched; the rung FontRefs are stable objects, so the cache keys stay
  few.
- Fonts: up to 7 extra weights of a CJK family, each a small `text=` subset, as draw-only faces: no scene rebuild, no
  re-measure; only for documents that draw weight motion.
- `perf.py` new row `glyph-weight`: the `project_glyph` weight document, 10 s window around its first weight motion at
  720p, judged at **twice the §7.4 budget**, plus a **same-run A/B**: the same document with 太る → `fogIn`, 細る →
  `fogOut`, 脈打つ太さ → `thumpSwell` (comparable per-glyph parts from the catalog) and no `text.weight` pins; p95 must be
  ≤ 1.25 × the comparator's.

### M5.10 Risks and open questions

- **Nested-shape assumption.** Families whose thin weight has different terminals from the bold show a faint fringe
  mid-rung; adjacent rungs are ≤ 200 apart in every multi-weight family of `FAMILY_ROWS` except BIZ UDPGothic
  (400/700), Nanum Myeongjo (400/700/800), Gowun Batang (400/700) and LXGW WenKai TC (300/400/700) (probe `rungs.js`),
  where one crossfade spans 300.
- **Latin advance widths** change with weight while cells are fixed: heavier Latin letters can touch; lighter ones look
  loose. Layout is at the line's weight (after `text.weight`), never the animated `wt` (no reflow).
- **Bold end for the whole line.** With the grow rule the line stays at the bold weight after it has grown — that is the
  point of 細字から太字へ, but it makes the line stand out from its neighbours; at ≈ 7 % of lyric lines it reads as an
  accent. The rate is a tuning knob (`weight`).
- **Styles.** Outline/shadow/duo lines step between weights (pins only). Two of 16 themes letter in shadow/duo; their
  lines never get weight parts automatically.
- **Single-weight faces** (most 見出し faces) cannot animate: the planner avoids them; pins get `weight-flat`.
- **Preview before a rung arrives**: the nearest loaded weight or the base face draws (the motion is flatter for that
  moment); export waits for every rung.
- **System fallback / offline**: a family that failed to load draws the fallback stack, which may lack the weights →
  no visible animation. Same as other faces today.
- **POSE change** is a FROZEN contract change (0.4). Materials (`core/recipe MOTION_COLS`) do not get `wt` in v2.2.
- Open: should P3's キメ set `text.weight` by rule (from `'rule'`, lockable)? The slot allows it.
- Open: variable-font path (B) later for families verified to serve a `wght` range; the column and parts would not change.

### M5.11 Interactions

- **P1**: the layout weight (P1's weight damp, T1.4) is the face weight after `text.weight` (pin or grow rule), never
  the animated `wt`; `withKumi` and `withFaces` compose.
- **P2**: T5 counts the weight parts as motion (`MOT`) like any entrance/hold/exit. P2's glyph-channel table `GLYPH`
  collects `wt` as a channel too (its derivation test adds `wt` to the columns it watches), with entries `weightGrow
  [wt]`, `weightPulse [wt]`, `weightThin [wt]`; P2's lettering factor gains `style ∈ {outline, shadow, duo} and 'wt' ∈ C
  → × 0` (never reached through P4's opt-in, which already refuses those styles; it keeps the rule true if the opt-in
  changes). Kits never include opt-in parts (they call `poolOf` without `optIn`); M2 flips nothing (no direction
  params); `repeat.same` copies a weight part to the repeat (same face → same room, so it is in the copy's pool) and the
  copy gets the same grow rule. `planner/rules` hosts `weight.auto` (0.3).
- **P3 キメ**: may add 太る to `KIME.arrive` at integration (P3 M3.10 open point) with `dur ≤ 0.4` by its parameter rule;
  the grow rule then ends a キメ line bold when the switch is on. P3 uses `FACES.roomOf`/`growTop` for any check.
- **P4 M4**: a morph traveller draws each version through `drawGlyphAs`, so a glyph that is still changing weight
  travels with its weight; a morph that replaces 太る removes the grow rule's weight.
- **P6 歌ハメ**: 太る with order `sung` grows each letter as it is sung (the stagger machinery already supports `sung`);
  no extra work.

---

## X. Summary: tests, goldens, performance, size, order

- **New test files:** `tests/node/morph_plan.test.js`, `tests/node/morph_render.test.js`, `tests/node/weight.test.js`;
  helper `tests/helpers/glyph_docs.js` (documents and `glyphTimes`). **Changed:** `frame.test.js`,
  `conformance.test.js`, `catalog.test.js`, `registry.test.js`, `faces.test.js`, `lens_filter_seam.test.js` (message),
  `planner_determinism.test.js` (re-plan with `gen = 1`; `checkShape` for glyph seams), `repeat_same.test.js`
  (seamCopy re-check), `planner_explain.test.js`, `facade.test.js` (draw-only usage), `ui_fields.test.js`,
  `commands.test.js`, `i18n.test.js`; browser `glyph_parity.py`, `parts_gallery.py`, `contact_sheet.py`, `perf.py`
  (rows `glyph-morph`, `glyph-weight` with same-run A/B), `ui_flows.py`.
- **Goldens:** all six existing goldens byte-identical (M4.8, M5.8); `node tests/update_golden.js --check` must pass
  before the new `tests/golden/project_glyph.json` is written.
- **Order of work:** (1) registry `late`/`optIn` + registry tests (version assertion first); (2) POSE `wt`, DELTA, maker
  `prep`/`wt`, kit options, faces ladders, draw weight pairs (style snap, `faceReady`), FontBook draw-only faces,
  facade draw usage + weight tests 1–4; (3) 太る and 細る, conformance; (4) planner opt-in pools, `text.weight` pin and
  grow rule, warnings, explain, UI rows, rate calibration; (5) `planner/morph` + tracks rule/guards/window/hand-over/memo/
  seamCopy + plan tests; (6) `engine/render/morph` + renderer + `glyphMorph` + render tests; (7) facade thumbnails,
  palette/part browser, strings, DESIGN/SPEC/NOTES; (8) 脈打つ太さ (deferrable) ; (9) goldens check, new golden, browser
  checks, perf rows, contact sheets for visual QA.
- **Size:** ≈ 1,650 lines of source (5 new files ≈ 780, 24 changed ≈ 870), ≈ 1,550 lines of tests (3 new files, 14
  changed, 1 helper), ≈ 350 lines of DESIGN/SPEC/NOTES.

---

## Critique log

Each point of the review was checked against 9a9e950 (+ the worktree's 87fde34). All were valid; none was rejected.

| # | Severity | Issue | Verified | Resolution |
|---|---|---|---|---|
| 1 | blocker | `ends: true` + `endWithSeam`'s `max(t1, stop)` shows the old line at rest over the new one after the window | Yes: `segment.windows` (`b = max(t1, next.t0) + tail`), `tracks.endWithSeam` (`Math.max(c.t1, stop)`), `frame.collectCuts` (`a ≤ t < b`), `depart/instant.js`; critic probe `window.js` re-run: 420 of 452 pairs, 0.12 s | Glyph seams hand over: A's `b = min(b, window end)` without the `t1` floor (M4.4.5 `endWithSeam(…, handover)`), documented as a §3.12 exception (0.4); rule guard `A.t1 ≤ B.t0`; tests plan 3/10, render 4; mutation target "restore `Math.max(c.t1, stop)`"; `checkShape` extended. |
| 2 | major | 細る built with a plain wrapper around `K.perGlyph` runs as an entrance | Yes: `kit.perGlyph` builds `glyphMotionMaker('arrive', …)`; `motionKind` re-wraps only `make.glyphFn`; `behave.glyphMotionMaker` `t0`/`live`/`exit` by kind | Kit option `K.perGlyph(fn, { prep, wt })` / `K.perGlyphHold(fn, opts)`; makers call `prep` and set `b.wt`; `motionKind` and `K.mirror` carry the options (M5.4.5, 0.4). No wrappers. Test 3 asserts `exit`, `t0 = times.out`, `live 'after'`. |
| 3 | major | 脈打つ太さ's `exp(−since/decay)` jumps at every beat | Yes: `conformance.assertSmallJumps` at 1/480 s; `lively.thumpSwell` uses `smooth(since/0.03)·exp(…)·(1 − phase²)` | thumpSwell's envelope; `amp ≤ 400`, `decay ≥ 0.1` → ≤ 41.7 per step; limit 60 kept; 120 BPM test; made the last, deferrable M5 step. |
| 4 | major | Over-composite crossfade breaks outline/shadow/duo | Yes: `sprites.paintStyled` (fill ink2 + stroke; offset copy + fill); themes carry `style` (13 plain, 1 each glow/shadow/duo) | Crossfade only for `plain`/`glow`; other styles snap to the nearest rung (`snapPair`); `weightOptIn` refuses those styles; pins warn `weight-style`; P2 `GLYPH` gains `wt` and a × 0 lettering rule; recorder tests for outline and shadow (M5.4.1, M5.4.3, M5.4.4, M5.11). |
| 5 | major | Travellers ignore layer isolation/knockout; z-order; wrong node choice | Yes: `arrange/core.edgeBleed` (`far` masked by `text`, `text` opacity 0 isolated), `renderer.drawTextSeam` (BASE_LAYERS before side layers), `drawIsolated` | `MO.prepare` layer eligibility (TEXT_LAYERS; opacity 1, source-over, no filter/mask, not a mask source); `knockout` guard in the rule; node by highest rest alpha; z-order stated as a documented change (DESIGN §4.19 addendum); render tests 5–6. |
| 6 | major | Automatic 太る ends at regular weight; eligibility low; no rate target; "13/16" wrong | Yes: probe `room.js` re-run (display ja room 0 in 11/16); `cast.FACE_WEIGHTS` 3:2:1 | Grow rule sets `text.weight` = heaviest served weight ≤ 800 (`from: 'rule'`, `weight.grow`), cached with the cast; eligibility by that top rung (72/96 slots, 444/600 lyric cuts); `weight: 2` for ≈ 10 % (probe `grow_rate.js`), asserted in [0.06, 0.14]; figure corrected to 11/16. |
| 7 | major | Extra weights bump the FontBook epoch (scene rebuilds, provisional) and flash fallback faces | Yes: `fonts.watch` → `bump()` (also on a URL change), `measure.key = 'canvas:' + epoch`, `facade.sceneFor` cache key, `build` provisional | Draw-only faces: separate states/URLs/characters, no epoch bump, never provisional, never redeclaring a main weight; `dc.faceReady` gates each rung (nearest ready or base face); export waits; repaint on `'draw'`; fake-FontBook and FontBook tests (M5.4.6). |
| 8 | minor | Morph bypasses P2's seam gate → P2's `load ≤ cap` can fail | Yes: P2 §3.4 (c) invariant; P2 §3.11 "exempt" note | Option (a): the guards call `ctx.pv.seamGate(B)`; rule order fixed (P3 → P4 → P2 gate → chance); P2's "exempt" note withdrawn (M4.4.3, M4.11). |
| 9 | minor | Line pin of `morph.auto` decides every boundary inside the line | Yes: `ui/fields.directionFields` firstCut comment; design read the pin at `atOf(B)` | `morphOn` reads the line pin only when `A.line !== B.line`; inside a line the work value; note string; test for a two-cut line. |
| 10 | minor | `weight.auto` / `text.weight` have no UI scope | Yes: `ui/fields.slotScopes` returns `[]` for unknown names | `WORK_NAMES` + `weight.auto`, `CUT_NAMES` + `text.weight`, `LINE_WORK_NAMES` + `morph.auto`; `ui_fields` scope tests. |
| 11 | minor | Default-on toggles with `offClears`; wrong `RU.defaultValue` signature | Yes: `repeat.same` uses `offClears`; P2 uses `(doc, ix, slot)` and `autoDefault` | Both toggles `autoDefault: true, noDice: true, basic: false`; P2 signatures exactly; if P4 lands first it brings `planner/rules`, the `'rule'` field category and the `valueFor` branch with tests; `ui_flows` off/undo steps (0.3). |
| 12 | minor | P3 hook shape and rule order | Yes: P3 M3.11 (`cut.kime === true`, hard-cut rule first) | Guards read `A.kime`/`B.kime`; order P3 → P4 → P2 → chance; `prev` covers them via `morphGuards`; test with a キメ line (M4.4.3–4, M4.7 test 4). |
| 13 | minor | `seamCopy` copies a rule-picked morph without re-checking | Yes: `tracks.seamCopy` copies `out[src.seamIn].slot` | Re-run `morphRule` for a rule-picked source; failure → `null` → `seamOf`; pinned copies unchanged; `repeat_same` test (M4.4.5). |
| 14 | minor | Explain misses automatic weight parts | Yes: `explain.altsOf` skips `pool === false`; `cast.shadow` has no `optIn` | `shadow` passes `optIn`; `altsOf` keeps opt-in parts present in the trace; test 7. |
| 15 | minor | Perf budgets referenced non-existent rows; golden times not promisable | Yes: `perf.py` `START = {basic, vertical, lrc, long}`, twice-budget rule; `frame.test.js GOLDEN_TIMES(plan)` | Absolute twice-§7.4 budget plus same-run A/B (+25 %) against `blendDissolve` / `fogIn`·`fogOut`·`thumpSwell`; `glyphTimes`: 32 even times + 8 inside motions (M4.8, M4.9, M5.8, M5.9). |
| 16 | minor | `late` safety argument, `lateVersion` in the cast key, factual errors | Yes: `cast.castCache` keyed by root registry then `version`; `segment.windows` makes `A.b ≥ B.a` vacuous; `facade.samplePlan` applies `replaces.arrive` (lines 168–169); worktree `normalize`/`serialize` keep `look.gen` | Safety argument restated (three reach paths, all document-gated); `lateVersion` only in `project_glyph.json`'s registry block, `castKeys` first term unchanged, `extend()` computes it from its own version; vacuous guard and memo term dropped; the three statements corrected (M4.1 defaults, M4.4.6 thumbnails, 0.2). `ctx.glyph.id` is appended to the cast key only when not `'g00'`, so legacy key text is unchanged. |
