# P2 — 文字PVの定石 (M1, M2, T5): design (revision 2)

Package P2 of PV22. Items:

- **M1** パートごとに演出をそろえ、くり返す歌詞は同じ見せ方で戻ってくる
- **M2** 動きの配分や方向の交互など、文字PVの定石を組み込み
- **T5** 効果を重ねすぎない

Base: `main` at 9a9e950. Every statement about current code below was checked against that tree. Measurements come from
read-only probes in `scratchpad/pv22/probe/` (a patched copy of `src/` loaded by `probe/loadp.js`, or the repository
loaded read-only by `tests/helpers/load.js`; nothing in the repository was edited). Appendix A lists them. Revision 2
answers a critique; the log at the end says how each point was handled.

---

## 0. Package-wide decisions

### 0.1 One switch group, 「文字PVの定石」, with sub-switches

All three items hang off one master switch with four sub-switches plus one number. The existing
「くり返しの行をそろえる」 switch becomes a member of the group for its default (it keeps its own row and its line
choice).

| slot (work pin) | UI name (作品全体 › 見た目) | type | default when unpinned | item | phase |
|---|---|---|---|---|---|
| `pv.rules` | 文字PVの定石 | bool | `look.gen ≥ 1` (new documents: on; older: off) | all | A |
| `repeat.same` (existing) | くり返しの行をそろえる | bool | value of `pv.rules` | M1 | A |
| `pv.kit` | パートごとに演出をそろえる | bool | value of `pv.rules` | M1 | A |
| `pv.alternate` | 動きの向きを交互にする | bool | value of `pv.rules` | M2 | A (parts, seams); C (camera) |
| `pv.arc` | 曲の山に合わせて強弱をつける | bool | value of `pv.rules` | M2 | A |
| `pv.fxCap` | 効果を重ねすぎない | bool | value of `pv.rules` | T5 | B |
| `pv.fxMax` | 1カットに重ねる効果の目安 | int 4–8 | automatic: `3 + round(3 · amount.pace)` | T5 | B |

**Why a group and not separate switches.** The owner asked for "the 文字PV conventions" as one idea. A beginner
wants one row that says whether the app follows them. The behaviours still need their own off switches: the arc can
fight a mood the user chose on purpose, the kit can feel repetitive on a short song, and a user who wants a busy
glitch video must be able to drop the effect budget without losing the rest. So there is one visible toggle
(basic row) and the sub-switches sit under 詳しい設定 (`basic: false`). The cascade keeps the new-document default in
one place: a sub-switch without its own pin follows the master; the master without a pin follows the document
marker (0.2). Turning the master off with a pin turns every unpinned member off, including 「くり返しの行をそろえる」.

The `pv.` prefix is a new NAME_SLOT family (`core/paths` NAME_SLOT `^[a-z][A-Za-z0-9]{0,31}(\.[a-z][A-Za-z0-9]{0,31})*$`
accepts it; it cannot collide with part kinds, `cam.*`, `text.*` or the look names). All `pv.*` slots are **work scope
only** (no line or cut pins): `core/commands` refuses other scopes. `repeat.same` keeps its work and line scopes.

### 0.2 Gating: a document marker `look.gen`, written only by the new-work path

**Decision.** A new optional document field `doc.look.gen` (integer). Absent or 0 = a document made before PV22: every
new behaviour is off unless the user pins it on. `D.GEN = 1` = the PV22 defaults: the master 「文字PVの定石」 is on
unless pinned off. The field is written **only** by a new function `D.newDoc()` and never by `D.defaultDoc()` or
`D.normalize()`.

Why not `defaultDoc()`: `D.normalize()` builds its base from `defaultDoc()` and `fillMissing` copies missing keys of
`doc.look` and `doc.pins`; `migrate.parseFile()` normalizes every opened file and autosave. Anything added to
`defaultDoc()` would be injected into every existing project on open. `tests/node/frame.test.js` plans raw fixtures
without normalize, so the frozen frame test would not even catch it. Twenty-one node test files and the browser tests
also build documents from `defaultDoc()` and expect the v2.1 planner.

Why a marker rather than default pins (`{ v: true, by: 'user' }` written by the new-work path):

1. 作品全体 › 固定を外す (`boot def('pin.clearSelection')` → `pin.clearUnder('work')`) drops every non-lock work pin.
   Default pins would silently switch the conventions off, so "back to automatic" would change the look. With the
   marker, clearing pins returns to the document default, which is what 自動 means everywhere else.
2. A pin by `'user'` claims the user set it: the inspector would show 固定 marks and counts on a fresh work.
3. The field states (`planner/fields sharedPin`) would show the rows of every cut as inherited from a work pin
   (作品全体で固定), not as 自動, and a later 見た目をコピー / AI review would see user pins nobody made.

**One new-document mechanism for all packages (for the lead).** P1 designed `core/doc.newWorkDoc()` that writes three
work pins `text.kana / text.jump / text.latin = 0.5` by `'user'` at the same three call sites; P4 and P6 follow this
marker. Two functions would collide and P1's pins bring back points 1–3. The merged API P2 implements and proposes:

- `D.newDoc()` = `defaultDoc()` with `look.gen = D.GEN` and **no pins** (`D.newDoc().pins` is `{}`; asserted by
  `pv_rules.test.js`). There is no `newWorkDoc()`.
- `planner/rules` is the one table of "new-work defaults". Each row: `{ slot, type, scopes, parent, def(gen) }`.
  P2's rows are 0.1. Independent rows other packages add (no parent, not members of 「文字PVの定石」):
  P1 `text.kana`, `text.jump`, `text.latin` (num, `def = gen ≥ 1 ? 0.5 : 0`; P1's own scopes); P4 `morph.auto`
  (work, line), `weight.auto` (work) (bool, `def = gen ≥ 1`); P6 `sung.real` (work, bool, `def = gen ≥ 1`).
  Resolution: `line pin (where the row allows it) ?? work pin ?? (parent ? value(parent) : def(gen))`.
- The engine never reads the marker: the planner writes the resolved values into the Plan where they already travel
  (P1: its resolved strengths, as P1 designs for its pinned values).
- Whichever package lands first creates `planner/rules` with its rows and this API; the others add rows.

**Where new documents are created (exact call sites, all switch to `D.newDoc()`):**

| site | today | change |
|---|---|---|
| `src/ui/boot.js:107` `ST.createStore({ doc: D.defaultDoc(), … })` | the first-run document, and every `?fresh=1` page; replaced by `store.load` when an autosave is restored (`boot.js:1170–1173`) | `D.newDoc()` |
| `src/ui/project_io.js:610` `newWork()` → `loadFile({ doc: D.defaultDoc(), … })` | ≡ › 新しい作品 | `D.newDoc()` |
| `src/ui/project_io.js:1176` (clear device) `app.loadProject(D.defaultDoc(), …)` | the empty work after この端末に保存した作品と曲を消す | `D.newDoc()` |

Not changed (and why):

- `core/doc.js:339–340` `normalize` (`defaultDoc()` as the base and the non-object fallback): must stay legacy.
- `core/migrate.parseFile`: opened files keep what they have.
- The sample lyrics (`boot.js:70 sample(lang)` → `core/lyrics SAMPLE_JA/EN`) are rows inserted into the current
  document by step ①; they create no document. On first run that document is the `newDoc()` of `boot.js:107`, so the
  sample plays with the conventions on. On an old project the sample inherits that project's marker.
- Tests and fixtures: every `D.defaultDoc()` caller (21 node test files, `tests/www/*.js`, `tests/browser/ui_flows.py:1525`,
  `ui_layout.py`) and every fixture keep legacy behaviour. Browser tests that open `?fresh=1` now get a `gen: 1`
  document (the real new-work path); 0.6 is the plan for them.

`core/doc` changes: `const GEN = 1`; `newDoc()` = `defaultDoc()` with `look.gen = GEN`; `ORDER.look` gains `'gen'` at the
end (serialization of documents without it is unchanged: `ordered()` skips undefined keys); `checkLook` accepts an
absent `gen` or an integer 0–255, else `look.gen: must be an integer 0–255`; exports `GEN`, `newDoc`. No command
writes `gen` (it is fixed at creation), so it needs no undo. `look.restore`, `look.omakase` and `look.set` only set their
own keys and keep it. An older build keeps an unknown look key on save (`validate` allows unknown keys).

**Resolution** (`planner/rules`): for a P2 slot S, `value(S) = work pin of S (coerced) ?? (parent(S) ? value(parent(S))
: gen ≥ 1)`; `repeat.same` additionally resolves a line pin first at each cut (as today). `pv.fxMax` has no parent:
pin, else automatic. `RU.repeatDefault(doc, ix)` = value of `pv.rules` for that document (`false` when `doc` is absent),
used by callers that have no `ctx.rules` (1.4 a).

**Old documents.** Nothing changes until the user switches 「文字PVの定石」 (or a sub-switch) on, which writes a work pin
`true`. 「くり返しの行をそろえる」 in an old document behaves exactly as today (on pins `true`, off clears), because its
default there is `false`.

**If the lead prefers pins after all:** `D.newDoc()` would write `work:pv.rules = { v: true, by: 'user' }` and no marker;
`planner/rules` defaults become plain `false`; the toggles keep `offClears`. Everything else in this document is
unchanged. The cost is points 1–3 above.

### 0.3 Modules and the `ctx.pv` hook contract

New planner modules (layer L2, `build.py` allows L0–L2 deps; none imports `planner/cast`, `planner/camera` or
`planner/tracks`, so there is no cycle):

| module | deps | role |
|---|---|---|
| `planner/rules` | core/pins, core/schema, core/num, planner/params | the switch table (0.2), `resolve(ctx)`, `value(doc, ix, slot)`, `defaultValue(doc, ix, slot)`, `repeatDefault(doc, ix)`, `baseCap(amounts)`, `isRule(slot)`, `SPECS` |
| `planner/arc` | core/num, core/hash, core/lyrics | song parts (real and pseudo sections), part keys, runs, `drive`, `strength()` |
| `planner/kit` | core/hash, core/rng, core/num, planner/choose | M1 kit selection and member tests |
| `planner/flow` | core/hash, core/rng, core/num, core/schema, core/paths, core/shot | M2 direction table, sign/flip, seam flips, shot-mirror overlay (phase C), zoom classes (phase C) |
| `planner/fxcap` | core/num, planner/extreme | T5 caps, loads, list trimming, glyph-channel table, lettering block, seam gate |
| `planner/conventions` | planner/rules, planner/arc, planner/kit, planner/flow, planner/fxcap, planner/extreme, planner/encode | builds `ctx.pv` once per plan (stage 4) |

Imports: `planner/plan` imports `planner/rules` and `planner/conventions`. `planner/cast` imports `planner/rules` (for
`alignments` without `ctx.rules`, 1.4 a; `rules` does not import cast). `planner/explain` imports `planner/flow` (phase C
mirror names) and `planner/rules`. `planner/fields` imports `planner/rules`. `ui/fields` imports `planner/rules`.
**`planner/camera`, `planner/tracks`, `planner/extreme` and `planner/choose` get no new imports**: they reach P2
behaviour only through `ctx.rules` and `ctx.pv`, which are `null` or all-off for legacy documents. Every new read is
guarded for stub contexts used by tests: `ctx.rules && ctx.rules.alt`, `st.feat || st.cut.feat`, `ctx.pv ? … : null`.

`ctx` gains two fields, declared in the `plan.run` ctx literal (shape stability, as the comment there asks):
`rules: null, pv: null`.

- **Stage 2** (after `LK.resolveLook`): `ctx.rules = RU.resolve(ctx)` → frozen
  `{ gen, rules, repeatDefault, kit, alt, arc, fx, fxMax, any, id }` (work-level effective values; `repeatDefault` =
  value of `pv.rules`; `any = kit || alt || arc || fx`; `id` = a short canonical text such as `g1|r1|k1a1c1f1|m-` used in
  the cast-cache look key). Cost: five `PA.pinned` checks.
- **Stage 4** (after features, before casting): `ctx.pv = ctx.rules.any ? CONV.prepare(ctx, cuts, timed, { pool,
  intern: CA.intern }) : null` with `pool = (kind) => kind === 'ground' ? CA.poolOf(ctx, 'ground', { aspect: ctx.aspect })
  : CA.poolOf(ctx, kind, { role: 'lyric', scope: kind === 'ornament' ? 'cut' : null })`. Passing `pool` and `intern` in
  keeps `planner/conventions` free of a `planner/cast` import (cast is where the pools and the intern table live).
- The cast-cache look key (`plan.js` stage 5 `EN.canon([...])`) appends `ctx.rules.id` (internal cache text only).

`ctx.pv` (all functions pure given ctx; each returns `null` / identity when its rule is off):

| hook | caller | returns |
|---|---|---|
| `on` | everywhere | `{ kit, alt, arc, fx, camAlt }` booleans (`camAlt` = `alt` once phase C ships, else false) |
| `partOf(cut)` | cast, tracks, fxcap | `{ key, kind, run, first, drive, tame, peak, head }` or `null` (special cuts) |
| `featOf(cut)` | cast `stateOf` | the cut's features with the arc-blended energy (a frozen copy), or `cut.feat` |
| `idOf(cut)` | cast `castInputs` | interned text of everything P2 adds to the cut's inputs (`''` when nothing) |
| `partFactor(st, kind)` | cast `decidePart` / `shadow` | `{ f(key, s, trace?) → number, member(key) → bool, block(key) → bool | null }` or `null` |
| `groundFactor(first)` | tracks `decideGround` | `{ f, member, block: null }` for the kit's grounds of the segment's first cut's part, or `null` |
| `faceBoost(st)` | cast `decideText` | the kit's face or `null` |
| `avoidAlso(kind)` | cast `decidePart` | `true` for `dwell`, `lens` under the kit |
| `trimLists(st, need)` | cast `decideList('filter')` and camOnly passes | lowers `ornament.count` / `filter.count` (T5) |
| `flipParams(st, kind, idx, slot, d)` | cast `decidePart` | mutates `d.p` / `d.pfrom` (M2) |
| `dirOf(st)` | cast `castCut` | packed direction signs of the cut (M2) |
| `seamGate(A, B, world)` | tracks `decideSeam` | `true` when T5 forbids an automatic transition into B |
| `flipSeam(decision, history, B, seed, salted)` | tracks `decideSeam` | decision with a flipped `dir` (M2) |
| `seamDir(decision)` | tracks `entryOf` | sign of a seam's horizontal direction |
| `shotFactors(st, rec)` | camera `weighShots` | phase C: `{ rec: Float64Array, why(i) }` or `null`; also the arc's `own` factors (phase A) |
| `mirrorShots(cuts)` | plan stage 6 | phase C overlay |
| `kimeAt(cut)` | arc, fxcap | `!!(cut.kime || (cut.feat && cut.feat.kime))` — P3's キメ flag (skeleton or Plan cut) |
| `summary()` | plan (after encode) | `{ kits, parts }` for the non-enumerable `plan.pv` |

`plan.run` sets `Object.defineProperty(plan, 'pv', { value: ctx.pv ? ctx.pv.summary() : null, enumerable: false })`,
like `plan.env` and `plan.reuse`: not hashed, not in the Plan shape, but readable by the inspector and by tests.

### 0.4 Shared definitions (`planner/arc`)

**Song parts.** A *part* is the unit M1 keys its kit by and M2 shapes its arc with.

- *Real sections*: `cut.feat.section` (song.info at t0, else the heading above, as today). If at least one lyric or
  focus cut has a non-null section, real sections are used; lyric cuts before the first heading get kind `null`.
- *Pseudo sections* (no heading and no song analysis anywhere): blocks of lines separated by blank rows. Block `b`
  starts at the first timed line and at every line with `pauseBefore > 0` (the rule `planner/areas rowGroups` already
  uses for まとまり; `arc` repeats it with `LY.parseSheet`/`LY.linesOf`, it does not import `planner/areas`). Blocks are
  grouped in sheet order: block B joins the group of the earliest block A with the same first-line text, or with
  `|texts(A) ∩ texts(B)| ≥ 0.5 · |texts(B)|` (sets of line texts); otherwise B starts a new group. If any group has ≥ 2
  blocks, every such group gets kind `'chorus'` and every other group `'verse'`; if none repeats, every kind is `null`.
  Pseudo kinds never enter `feat` (the camera's `SHOT_SECTION`, rigs and backgrounds keep reading real sections only).
- Special cuts (title, interlude, outro; no line) have no part (`partOf` → `null`).
- *Runs*: maximal sequences of consecutive lyric/focus cuts with the same part key. `first` = first cut of a run.
- *Part key* (the kit key and the salt key) is **content-based**, never an ordinal of position, so inserting, deleting
  or splitting a block elsewhere never renames a part:
  - real sections, ≥ 2 distinct non-null kinds among the lyric cuts: `key = kind` (サビ1, サビ2 and 大サビ share
    `chorus`); `null` kind → `none`.
  - real sections with only one kind (a song headed 1番/2番…, all `verse`): each run is keyed by the heading row it
    sits under, `key = 'h' + rowId` (row ids are `'r' + base36`, stable across edits: `core/commands.js:169`,
    `core/reconcile.js:315`); a run from song analysis (no heading row) is keyed `kind + ordinal` of its `song.info`
    section (analysis sections are time spans; editing lines does not renumber them).
  - pseudo sections: `key = 'b' + rowId` of the first row of the group's earliest block in sheet order (e.g. `br1a`).
  - A row id that does not match `/^[a-z0-9]{1,24}$/` (a hand-edited file) is replaced by `'x' + hex8(H.hash32(rowId))`.
  Every key matches NAME_SLOT, so `work:kit.<key>` parses.
  What still moves keys: making the first block of a group repeat for the first time turns every pseudo kind from `null`
  to verse/chorus (the kits' energy targets change); inserting an earlier copy of a group's first block moves the key to
  the earlier block. Both are rare edits of the song's structure; they are documented, not hidden.
- *Neutral song*: no part has a kind (no headings, no analysis, no repeated block). The arc is then a no-op and the kit
  still works per group.

**Drive** (M2's arc, also the kit's energy target): per lyric cut,

```
DRIVE = { intro: .30, verse: .35, prechorus: .55, chorus: .75, bridge: .45, interlude: .30, solo: .60, outro: .30, other: .50 }
d = kind ? DRIVE[kind] : 0.5
if not neutral:
  if kind === 'chorus' and the cut's run is the last run of kind 'chorus':   d += 0.15   (peak)
  if kind === 'chorus' and first:                                            d += 0.10   (head: サビ頭)
  if kind !== 'chorus' and the next lyric cut is the first cut of a chorus run:  d = min(d, 0.25); tame = true  (ため)
  if cut.impact:                                                             d = max(d, 0.80)
  if kimeAt(cut) (P3):                                                       d = max(d, 0.85)
special cuts: d = 0.30 (they have no part; drive is kept for the seam chance only)
drive = q2(clamp(d, 0, 1)); neutral song → 0.5 everywhere
```

**Strength** of a part definition (also of a shot preset, by its tags; `'none'` shot counts as calm):

```
STRONG_TAGS = ['fast', 'hard', 'bold'];  CALM_TAGS = ['soft', 'slow', 'minimal', 'airy']
strong = tags ∩ STRONG_TAGS ≠ ∅ or traits.impact;  calm = tags ∩ CALM_TAGS ≠ ∅
strength = strong && !calm ? +1 : calm && !strong ? −1 : 0
```

### 0.5 Phases

The package ships in three gated phases, each with its own tests; each phase leaves every legacy golden identical.

| phase | contents | switch |
|---|---|---|
| A | marker, `planner/rules`, 「くり返しの行をそろえる」 by default, kit, arc, direction flips of parts and seams, UI rows | `pv.rules`, `repeat.same`, `pv.kit`, `pv.arc`, `pv.alternate` |
| B | T5: lettering rule first, then the cut budget | `pv.fxCap`, `pv.fxMax` |
| C | camera alternation: mirrored `driftOff`/`tiltHold`, push-in / pull-back alternation, EXTREME mirror alternation | extends `pv.alternate` (`ctx.pv.on.camAlt`) |

Phase C can be deferred without losing the owner's asks (sideways moves, spins and sides alternate in phase A). It
extends the shot grammar, so it needs the most review.

### 0.6 Browser tests on `?fresh=1` (the gating side effect)

Every `ui_flows.py` flow opens `?fresh=1` (`tests/browser/ui_flows.py:220`), which becomes a `gen: 1` document. Plan:

1. **Gate G0 (before any phase is merged).** Build a probe app from a scratch copy of the tree with `boot.js:107`
   switched to `D.newDoc()` and `checkLook` accepting `gen` (nothing else), run `ui_flows.py`, `ui_layout.py`,
   `i18n_pages.py`, `kit_check.py`, `media_*.py`, `package_io.py`, `transparent_check.py`, `csp.py`, and record every
   failing check in NOTES ("PV22 G0"). Rerun G0 after each phase (A, B, C) with that phase applied.
2. **Fix rule.** A flow that tests legacy behaviour loads a legacy document first (`window.__mv.store.load(doc, …)`
   with `doc` built from `D.defaultDoc()`, as `IO_JS` at `ui_flows.py:1525` already does); a flow that tests locality
   or pins stays on the fresh page. Never add a switch to the page to make a test pass.
3. **Known failure, rewritten now:** `flow_repeat` (`ui_flows.py:2407–2450`) asserts 「off by default」 (:2422), waits for
   a `true` pin after one click (:2426) and `after.same > before.same` (:2432); on a gen-1 page all three fail and the
   click writes `false`. It becomes two flows:
   - `flow_repeat_legacy`: loads a legacy document with `REPEAT_LYRICS`, then today's assertions unchanged.
   - `flow_repeat_new` (fresh page): the switch shows on with state tag `auto` and the note line 「新しい作品の標準」;
     the second サビ already shows the first one's layouts, lenses and shots (`same == n`); one click writes
     `work:repeat.same = false` (one undo entry, tag `pinned`) and `same < n`; 作品全体 › 固定を外す removes the pin
     (one undo entry) and the switch is on again with `same == n`.

---

## 1. M1 — パートごとに演出をそろえ、くり返す歌詞は同じ見せ方で戻ってくる

### 1.1 What the user gets

- In a new work, lines sung again come back looking as they did the first time (the existing
  「くり返しの行をそろえる」 behaviour, DESIGN_2_1 §4.10), without the user switching anything on.
- Each song part (Aメロ, Bメロ, サビ … or, without headings, each group of blank-line blocks) draws its layouts,
  entrances, holds, exits, camera textures (lens), decorations, screen effects, backgrounds and typeface class from a
  small **set of looks** (演出セット), with one entrance family and one exit family as the part's signature. The same kind
  of part uses the same set wherever it comes back, so サビ2 feels like サビ1 even where the lines differ. Neighbouring
  cuts still never repeat the same layout or entrance.
- Where: 作品全体 › 見た目:
  - 「くり返しの行をそろえる」 (existing row; now **on** in new works, shown as 自動 with the note line 「新しい作品の標準」).
  - 「文字PVの定石」 (new master toggle, on in new works).
  - 詳しい設定: 「パートごとに演出をそろえる」 (on in new works).
- On a 区画 selection (click a 区画 band in the timeline's 曲 row → the 「n行を選択中」 page), a new section
  **演出セット** with the read-only row 「この区画の演出セット」 listing up to three part names per kind (構図 / 入り /
  抜け), the typeface class, and a die 「演出セットを振り直す」. The die rerolls the set of every part with that key (all
  サビ), as one undo step.
- The inspector's なぜ line on an automatic part says 「サビの演出セットに合わせた」 (or 「このまとまりの演出セットに合わせた」).
- Every row that is automatic by the document default shows a note line under it: 「新しい作品の標準」 or
  「この機能より前に作った作品なので、はじめはオフ」 (1.5 `ui/inspector`).

### 1.2 Gating and defaults

- `repeat.same` default = value of `pv.rules` (0.1): on in `gen ≥ 1` documents, off in older ones.
- `pv.kit` default = value of `pv.rules`.
- Legacy documents and every fixture: `ctx.rules.repeatDefault === false`, `ctx.pv === null` → `alignments()` returns
  `null` exactly as today when no pin exists, and no kit code runs.
- `pin.clearUnder('work')` (固定を外す) removes the pins and returns to the document default.
- AI: none required. The existing AI song analysis (`doc.song.info.sections`) gives better parts than headings or
  blocks; nothing new is sent to any AI. The AI 'direct' path keeps 「くり返しの行をそろえる」 working on gen-1 documents
  (1.4 a).

### 1.3 Data model

- Pins: `work:pv.rules`, `work:pv.kit` (bool); `repeat.same` unchanged (work, line).
- Salts: `work:kit.<key>` with the content keys of 0.4 (e.g. `work:kit.chorus`, `work:kit.hr5`, `work:kit.br1a`), a
  positive integer bumped by the existing `salt.bump` command. `core/doc checkSalts` and `commands.checkSaltKey` already
  accept it (`paths.scopeKey('work:kit.chorus')` parses: NAME_SLOT `kit.chorus`). Precedents: `work:mood`,
  `work:theme`, `work:texture`. A salt whose key no longer names a part is inert (no warning; the next reroll of that
  part writes its own key).
- No schema version change, no migration. A document without the marker never reads the new slots unless pinned.
- Non-enumerable `plan.pv.kits`: `[{ key, kind, label: { kind, n }, arrange: [families], arrive, depart, dwell, lens,
  filter, ornament: [keys], ground: [keys], primary: { kind: family }, face }]` (`label.n` = a display ordinal of the
  part for 「まとまり{n}」, never a key); `plan.pv.parts: Map<cutKey, { key, kind, drive, tame, peak }>`.

### 1.4 Algorithm

**(a) Repeats by default** (`planner/cast alignments`):

```
alignments(ctx, cuts):
  const pinnedAny = PA.pinned(ctx.ix, REPEAT)
  const def = ctx.rules ? ctx.rules.repeatDefault : RU.repeatDefault(ctx.doc || null, ctx.ix)   // false without doc
  if (!pinnedAny && !def) return null                                              // legacy: unchanged
  … (run bookkeeping unchanged) …
  const pin = pinnedAny ? PA.resolvePin(ctx.ix, atOfCut(cut), REPEAT, acceptRepeat, null) : null
  if (pin ? pin.v === true : def) out.set(cut.key, src)
```

Callers: `plan.run` (has `ctx.rules`); `ai/direct.followSources` (`src/ai/direct.js:1254`) now passes the document:
`CA.alignments({ ix: run.ix, doc: run.doc }, run.plan.cuts || [])`, so an AI answer on a gen-1 document without a pin
drops the changes on later copies exactly as a document that pins `work:repeat.same` does; the three stub calls in
`tests/node/repeat_same.test.js` (lines 35, 113, 137: `{ ix }` only) keep their meaning (`def` false). P3 merges its
condition into the same line (`!!src.kime === !!cut.kime`, P3 §interactions).

`decideRepeat` is unchanged (it records the decision only where a pin applies), so the Plan of a legacy document with a
`repeat.same` pin is byte-identical, and the Plan of a `gen: 1` document carries no extra slot.

**(b) Kit selection** (`planner/kit select(ctx, part, poolFn)`, once per part key per plan, memoized in `ctx.pv`):

```
KIT_KINDS = ['arrange', 'arrive', 'dwell', 'depart', 'lens', 'filter', 'ornament', 'ground']
KIT_SIZE  = { arrange: 3, arrive: 3, depart: 3, dwell: 2, lens: 2, filter: 2, ornament: 4, ground: 2 }
GROUP     = family kinds: def.family || def.key ; ornament, ground: def.key (they have no families)
e    = DRIVE[part.kind] ?? 0.5                      // the part's target energy (0.4); 0.5 for pseudo 'null'
salt = ctx.salts?.['work:kit.' + part.key] || 0
for kind of KIT_KINDS:
  keys = poolFn(kind)                                // mood gates, filters, season, backdrop, texture exclusion apply
  W[g] = Σ_{k ∈ keys, GROUP(k) = g} ctx.chooser.statics(kind, k, kind === 'filter').product
                                    × CH.traitFit(registry.traits(kind, k), { energy: e })
  seed = H.hash32('kit', ctx.doc.look.seed, part.key, kind, salt)
  score[g] = ln W[g] + R.gumbel(seed, g)            // only W[g] > 0; ties → the smaller g
  ranked = groups by score, best first
  kit[kind] = the KIT_SIZE[kind] best groups (sorted by name for display); kit.primary[kind] = ranked[0]
kit.face = R.fromSeed(H.hash32('kit', look.seed, part.key, 'face', salt)).weighted(['display','serif','body'], [3, 2, 1])
kit.id   = intern(EN.canon(kit))                    // intern = CA.intern, handed in by plan.js (no cast import)
```

The seed has no cut key and the part key is content-based (0.4), so inserting or deleting a line, or a whole block
elsewhere, never changes another part's kit; the salt reaches only its own key.

**(c) Weighting** (a new chooser factor, `planner/choose`):

```
KIT = 8;  KIT_PRIMARY = 16
factor(kind, key) = GROUP(key) === kit.primary[kind] ? KIT_PRIMARY
                  : kit[kind].includes(GROUP(key))   ? KIT : 1        // lyric/focus cuts with a part only
member(key)       = factor > 1
                    in preWeight: part of the natural pick
recency relax     : for a member, pick() drops the NEAR (×0.35) and FAMILY (×0.5) flags, for the final and the
                    reference weight alike; PREV (×0.03) and the avoid runner-up stay.
KIT_AVOID         : under pv.kit, dwell and lens also get the §8.2 runner-up avoid (avoidOf), like arrange/arrive.
text.face         : the automatic face draws with weights FACE_WEIGHTS × (face === kit.face ? KIT : 1)
                    (orientation factor as today).
ground            : decideGround passes the factor of the segment's first cut's part (none for a special first cut).
```

Why these numbers: the kit must give each part a visible motion signature, not a statistical tilt. Measured on a
prototype with the content part keys, the energy-fit selection and the relax (A.2; no arc, no T5, no KIT_AVOID):
the share of a part's cuts whose family is one of the part's two most used families rises, for entrances, from 28 % to
60 % (layouts 35 → 67 %, holds 47 → 82 %, exits 46 → 59 %, lenses 47 → 74 %), and with 「くり返しの行をそろえる」 off the
entrance family of a repeat matches its first copy in 30 % instead of 15 %. `KIT = 4` without a primary reached only
47 % for entrances; a near-filter (×1000) reached 76 % but repeated holds and lenses back to back (10–24 %), so the kit
stays a weight. Neighbours still differ: the exact previous value keeps ×0.03 and arrange/arrive/dwell/lens keep the
runner-up avoid (KIT_AVOID brings dwell and lens adjacency back to the legacy level; A.2 without it: 4.9 %).

**Precedence** (unchanged machinery, the kit is only a weight): pins and locks > rules (`motion-own`, seams' replace
rules, P3/P6 rules) > the aligned source under 「くり返しの行をそろえる」 (`alignedPart` runs before the chooser) >
kit-weighted chooser. A kit never filters a pool: a cut whose pool has no member picks as today (factor 1 everywhere).
Inside P3's restricted キメ sets (`req.only`) the factor only reorders what P3 allows.

### 1.5 Engine / planner / UI changes

- `core/doc`: `GEN`, `newDoc()`, `ORDER.look += 'gen'`, `checkLook` (0.2).
- `core/commands checkSlotScope`: refuse `pv.*` unless `parsed.scope.kind === 'work'`
  (`'<slot> can be pinned only for the whole video'`). `lockSet` goes through `checkSlotScope`, so lock payloads never
  carry them.
- `planner/rules` (new): 0.2 table; `resolve(ctx)`; `value(doc, ix, slot)`, `defaultValue(doc, ix, slot)` (what the slot
  is without its own pin), `repeatDefault(doc, ix)`; `baseCap(amounts) = 3 + Math.round(3 · amounts.pace)`; `SPECS`
  (`pv.*` bool, `pv.fxMax` `{ type: 'int', min: 4, max: 8 }`); a bad work pin warns `pin-bad-value` once (through
  `PA.resolvePin` with `ctx.warn`).
- `planner/arc` (new): `parts(ctx, cuts, timed)` (0.4, with the content keys), `strength(def, traits)`, `DRIVE`.
- `planner/kit` (new): `select`, `groupOf`, `KIT`, `KIT_PRIMARY`, `KIT_SIZE`, `KIT_AVOID`.
- `planner/conventions` (new): builds `ctx.pv` (0.3); `partFactor(st, kind)` combines kit × arc (2.4 g) into one
  `f(key, s, trace)` and T5's lettering `block` (3.4 d); `trace` receives `{ kit, arc }` and the block for explain.
- `planner/choose`:
  - `preWeight`: after the echo factor, `if (req.pv) { const x = req.pv.f(key, s, f); w *= x; }` (`f` = the trace
    object when tracing; it gets `pvKit`, `pvArc`).
  - `pick`: `if (req.pv && req.pv.member(key)) { flags &= PREV; flagsRef &= PREV; }` before `withRecency`;
    `if (req.pv && req.pv.block && req.pv.block(key)) { if (f) f.pvLetter = 0; continue; }` at the top of the loop for
    all three argmaxes; if `best === null` and some candidate was blocked, the loop runs once more without the block
    (the fallback of 3.4 d; the trace marks it `pvLetterFallback`).
  - `weigh` (explain alternatives): the same changes (a blocked alternative shows `w: 0`).
  - No change when `req.pv` is absent (every legacy call).
- `planner/cast`:
  - `chooseAuto`: `ask.pv = req.pv || null`.
  - `stateOf`: `st.feat = ctx.pv ? ctx.pv.featOf(cut) : cut.feat`; `st.part = ctx.pv ? ctx.pv.partOf(cut) : null`;
    `st.dirOwn = { h: 0, side: 0, rot: 0 }`; `st.fromAlign = null`.
  - `decidePart` and `shadow`: pass `feat: st.feat`, `pv: ctx.pv ? ctx.pv.partFactor(st, kind) : null`; avoid for
    `AVOID_REPEAT.has(kind) || (ctx.pv && ctx.pv.avoidAlso(kind))`; `PA.resolveParams` gets `f: st.feat`.
  - `alignedPart`: `def.fits(st.feat, st.chosen)`.
  - `decideValue`: when the aligned branch gives the value, `(st.fromAlign || (st.fromAlign = new Set())).add(slot)`.
  - `decideText`: face weights via `ctx.pv.faceBoost(st)`; `text.scale` uses `st.feat.energy`.
  - `alignments`: 1.4 (a).
  - `castInputs`: new field `pv: ctx.pv ? ctx.pv.idOf(cut) : ''`; `INPUT_FIELDS += 'pv'`.
- `planner/tracks decideGround`: `req.pv = ctx.pv ? ctx.pv.groundFactor(first) : null` (also passed to its `shadow`).
- `planner/plan`: stage 2 `ctx.rules`, stage 4 `ctx.pv`, the look key, `plan.pv` (0.3).
- `planner/explain factorWhy`: `if (f.pvKit > 1)` → `{ code: part is pseudo ? 'pv.kitBlock' : 'pv.kit', params:
  { section: part.kind } }`; `rulesWhy` for rule fields (1.6).
- `planner/fields`: a new category `'rule'` for `RU.isRule(slot)` at work scope (and `repeat.same` at work scope;
  its line scope stays `'value'`). `fieldState` for `'rule'`: `value = RU.value(doc, ix, slot)`, state `pinned` when a
  work pin exists else `auto`, `autoText = ['rule.auto.' + (gen ≥ 1 ? 'new' : 'old'), {}]`, `canPinAt = ['work']`,
  schema `RU.SPECS[slot]`; for `pv.fxMax` auto the value is `RU.baseCap(plan.look.amounts)` and `autoText =
  ['fld.pvFxMax.auto', { n: value }]`.
- `ai/direct.followSources`: passes `doc: run.doc` (1.4 a).
- `ui/fields`:
  - `slotScopes`: `RU.isRule(slot)` → `['work']` (`repeat.same` keeps `['work', 'line']`).
  - `PAGES.work sec('look')`: the `repeat.same` toggle drops `offClears` and gets `autoDefault: true`; new rows
    `pv.rules` (basic), `pv.kit`, `pv.alternate`, `pv.arc`, `pv.fxCap` (toggles, `basic: false`, `autoDefault: true`,
    `noDice: true`, each with a note), `pv.fxMax` (number, `auto: true`, `basic: false`, `noDice: true`).
  - `PAGES.lines`: `sec('kit', true, [], { custom: 'kit', when: (ctx) => hasArea(ctx) && ctx.kitKeys && ctx.kitKeys.length > 0 })`.
- `ui/inspector`:
  - `valueFor`: `if (field.autoDefault) { if (v === RU.defaultValue(doc(), ix, field.path)) return W.AUTO; }` (unpin
    when the choice equals the document default; otherwise pin the value). For legacy documents this is the old
    `offClears` behaviour.
  - The auto note line: today `fs.autoText` is set only for media depth and no UI module renders it
    (`grep autoText src/ui` finds nothing). The row builder (`inspector.js:637`, where `fr-note` is made) adds a second
    element `p.fr-auto.note.subtle`, shown when `fs.state === 'auto' && fs.autoText`, text `t(...fs.autoText)`; it is
    refreshed with the row's state. This also shows the existing media-depth auto text (a small, intended improvement).
  - custom `'kit'`: reads `app.plan.pv` (kits and each selected cut's part key). One key: the row
    「この区画の演出セット」 with `t.part(kind, key)` names (families shown by their first two member parts) and
    `songSec.<kind>` / `area.para` (「まとまり{n}」 with `label.n`); several keys: 「いくつかのセット」. The die dispatches
    `{ t: 'salt.bump', key: 'work:kit.' + key }` with label `['undo.kitReroll', { section }]`.
  - The context builder adds `ctx.kitKeys` (the distinct part keys of the selected cuts, from `app.plan.pv`).
- `ui/widgets` number widget: `box.placeholder` uses `st.autoText ? t(...st.autoText) : t('state.auto')` when the value
  is null and `st.auto` (today `widgets.js:185` shows only 「自動」); the inspector passes `autoText` in the widget state.
- `ui/boot.js:107`, `ui/project_io.js:610, 1176`: `D.newDoc()`.

### 1.6 Strings (`src/i18n/strings.js`, [ja, en])

| key | ja | en |
|---|---|---|
| `fld.pvRules` | 文字PVの定石 | Lyric-video conventions |
| `fld.pvRules.note` | 文字PVでよく使う作り方に合わせます。パートごとに見せ方をそろえ、くり返す歌詞は同じ見せ方で戻し、動きの向きを交互にし、サビに向けて強くし、文字に効果を重ねすぎないようにします。新しい作品でははじめからオンです。 | Follows common lyric-video practice: each song part keeps one set of looks, lines sung again come back the same way, directions alternate, motion builds toward the chorus, and the lettering does not pile up effects. New works start with this on. |
| `fld.pvKit` | パートごとに演出をそろえる | Match looks within each song part |
| `fld.pvKit.note` | Aメロ・Bメロ・サビなどのパートごとに、構図・入り・抜け・装飾・背景の候補をいくつかにしぼり、入りと抜けはひとつを目立たせます。同じパートは曲のどこでも同じセットを使います。 | Each song part (verse, pre-chorus, chorus…) draws its layouts, entrances, exits, decorations and backgrounds from a small set, with one entrance and one exit as its signature, and keeps that set wherever it comes back. |
| `sec.kit` | 演出セット | Set of looks |
| `fld.kitSet` | この区画の演出セット | This section's set of looks |
| `fld.kitSet.many` | いくつかのセット | Several sets |
| `fld.kitSet.value` | 構図: {arrange} / 入り: {arrive} / 抜け: {depart} | Layout: {arrange} / Entrance: {arrive} / Exit: {depart} |
| `act.kitReroll` | 演出セットを振り直す | Reroll the set |
| `undo.kitReroll` | {section}の演出セットを振り直し | Reroll the set for {section} |
| `why.pv.kit` | {section}の演出セットに合わせた | Matches the set of looks for {section} |
| `why.pv.kitBlock` | このまとまりの演出セットに合わせた | Matches the set of looks for this block |
| `rule.auto.new` | 新しい作品の標準 | Default for new works |
| `rule.auto.old` | この機能より前に作った作品なので、はじめはオフ | Made before this feature, so it starts off |

The pseudo part name reuses `area.para` (「まとまり{n}」 / 'Block {n}', `strings.js:1558`); there is no new `area.block`.
`fld.repeatSame.note` gains a sentence: 「新しい作品でははじめからオンです。」 / 'New works start with this on.'
All new `why.*` codes of this document join `WHY_CODES` in `tests/node/i18n.test.js` (so the pair check covers them):
`pv.kit`, `pv.kitBlock`, `pv.alt`, `pv.altSame`, `pv.arc.up`, `pv.arc.down`, `pv.tame`, `pv.peak`, `pv.fx`, `pv.letter`
(phase C: `pv.zoomOut`, `pv.zoomIn`). The `whyRule.pv.*` keys (`whyRule.pv.alt`, `whyRule.pv.fx`; phase C
`whyRule.pv.mirror`) are reached through `ui/fields whyRuleKey`; the rule scan of `ui_fields.test.js` (line 923, which
collects the rules of explained fields and checks their strings) gets a gen-1 document with a flipped parameter and a
reduced count, so both keys are checked.

### 1.7 Tests

New `tests/node/pv_rules.test.js` (shared gating, used by M1/M2/T5):

1. `D.newDoc().look.gen === D.GEN`; `D.newDoc().pins` deep-equals `{}`; `D.defaultDoc().look.gen === undefined`;
   `D.normalize(x)` never adds `look.gen` or a `pv.*` pin for every fixture and every corpus document;
   `migrate.parseFile(D.serialize(...))` round-trips `gen`; `validate` rejects `gen: -1`, `1.5`, `'1'`.
2. Cascade: gen 0 → all off; gen 1 → all on; `pv.rules=false` pin → all members off; `pv.rules=false` +
   `pv.kit=true` → only the kit on; `pin.clearUnder('work')` on a gen-1 doc with `pv.rules=false` → back on.
3. Commands: `pin.set line/r1:pv.kit` and `cut/…:pv.arc` refused; `work:pv.kit` accepted; `salt.bump work:kit.chorus`,
   `work:kit.br1a`, `work:kit.hr5` accepted and validated by `D.validate`; `pin.set work:pv.fxMax 3` refused by the spec
   (`pin-bad-value` on plan), `4` and `8` accepted.
4. **Completeness of the gate**: for every corpus and fixture document, the plan hash with `look.gen = 1` and the pins
   `work:pv.rules = false` (and the other packages' switches off, 1.8) equals the plan hash of the document as it is.
   (Mutation: forget any one gate → fails.)
5. **Every rule is live**: with `look.gen = 1` each of `pv.kit`, `pv.alternate`, `pv.arc`, `pv.fxCap` alone (others
   pinned false) changes the plan of `project_repeat` (without its repeat pin). (Mutation: a rule that never fires.)
6. UI source check (node, text scan): `ui/boot.js` and `ui/project_io.js` call `D.newDoc()` at the three sites and
   `D.defaultDoc()` nowhere.

New `tests/node/section_kit.test.js`:

1. Parts: `project_repeat` (headings of several kinds) → サビ runs share key `chorus`; `project_long` (1番…5番, one
   kind) → five keys `h<rowId>` equal to the heading rows' ids; `project_basic` without its headings but with its blank
   rows → pseudo keys `b<rowId>`; a document without blank rows or headings → one group, neutral.
2. **Key stability**: (a) inserting a line anywhere leaves every kit identical; (b) inserting a new blank-separated block
   (new text) at the top of `project_basic` without its headings leaves every other group's key and kit identical;
   (c) splitting a block leaves the original group's key; (d) inserting a 番 heading into `project_long` leaves the
   other runs' keys; (e) `salt.bump work:kit.<key>` changes that kit only. (Mutation: ordinal keys → (b) and (d) fail.)
3. **Signature strength** (corpus(4) × {16:9, 9:16} × {quietHush, popFizz, glitchFracture, heartAche}, catalog,
   `project_basic/long/repeat`, gen 1, repeat pin removed): per part key, the share of its cuts whose family is one of
   the part's two most used families (top-2 coverage). Acceptance: on − off ≥ 20 points for arrange, arrive, dwell and
   lens, ≥ 8 points for depart; absolute floors set at the implementation's measurement − 5 points and never below
   arrange 60 %, arrive 52 %, dwell 72 %, lens 65 %, depart 52 % (prototype A.2: 67/60/82/74/59 % on, 35/28/47/47/46 %
   off). Mutations: drop the recency relax → arrive below its floor; `KIT_PRIMARY = KIT` → arrive coverage drops.
4. サビ1 vs サビ2 (project_repeat, gen 1, `repeat.same` pinned false so only the kit acts): both chorus runs use the
   same kit object; the family match between a repeat and its first copy rises by ≥ 8 points against `pv.kit` off for
   arrange and arrive (prototype: 19 → 33 %, 15 → 30 %).
5. Variety on gen documents: no identical adjacent arrange/arrive unless pinned or the pool has one part; identical
   adjacent dwell and lens ≤ the legacy rate + 0.5 points (KIT_AVOID; mutation: remove it → fails); depart ≤ legacy + 1
   point; each kind uses ≥ 60 % of its eligible parts over corpus(6).
6. Repeats by default: gen-1 `project_repeat` without its pin aligns exactly the cuts the pinned legacy fixture aligns
   (same `ctx.align` key set); a line pin `false` exempts a line; `pv.rules=false` → `alignments()` returns null;
   `CA.alignments({ ix }, cuts)` (no rules, no doc) returns null on the gen-1 document (the stub path);
   `CA.alignments({ ix, doc }, cuts)` returns the same map as the plan's.
7. Stability on gen documents (reuse `planner_stability` helpers with `look.gen = 1`): inserting a line keeps ≥ 97 % of
   the other choices; rerolling a cut changes at most 3 other cuts' part keys in ≥ 97 % of cases (worst ≤ 6).
8. Explain equals plan for kit-weighted slots: `PL.trace` candidate weights reproduce the pick; the why list names
   `pv.kit`.
9. Cache: the random-edit re-plan test of `planner_determinism` (plan equals fresh plan) run on gen documents with
   the edit menu extended by `salt.bump work:kit.<key>`, `pin.set work:pv.*`, `pin.clear work:pv.*`, a blank-row insert.

New case in `tests/node/ai_direct.test.js`: a gen-1 document with no `repeat.same` pin and a sung-again line; an answer
that changes the arrange of both copies keeps the change on the first copy only, exactly as on the same document with
`work:repeat.same = true` pinned; on the same document with `work:pv.rules = false` both changes stay.

Updated: `tests/node/repeat_same.test.js` (default-on cases above; one case keeps the `{ ix }`-only stub and expects
null), `ui_fields.test.js` (new rows, `slotScopes('pv.kit')` = `['work']`, `autoDefault` on the repeat row, the auto
note line and the number placeholder `自動（4）`), `commands.test.js` (scope refusals), `doc.test.js` (newDoc),
`i18n.test.js` (WHY_CODES).

Browser (`tests/browser/ui_flows.py`): `flow_repeat_legacy` and `flow_repeat_new` (0.6), and a new flow "PV22
conventions": a `?fresh=1` page shows 「文字PVの定石」 on (tag `auto`, note 「新しい作品の標準」); turning it off is one
undo step and writes `work:pv.rules=false`; 固定を外す brings it back on; a legacy document loaded through
`store.load` shows it off with note 「この機能より前に作った作品なので、はじめはオフ」; the 「1カットに重ねる効果の目安」 box
shows the placeholder 「自動（4）」 for a calm mood; the 区画 page shows 「この区画の演出セット」 and its die changes the kit
(one undo step).

### 1.8 Goldens

| golden | why unchanged |
|---|---|
| `frame_hashes_v2.json` (FROZEN) | fixtures have no `look.gen` and no `pv.*` pin → `ctx.rules.repeatDefault` false, `ctx.pv` null; `alignments()` returns null as before; chooser calls carry no `pv`. |
| `plan_hashes.json`, `frame_hashes.json` | same; no part, parameter or registry change (`registry.version` hashes kind/key/param names only). |
| `project_repeat.json` | its pin `work:repeat.same` resolves exactly as before; no marker. |
| `project_media.json`, `project_extreme.json` | no marker, no pv pin. |

New golden `tests/golden/project_pv.json` (format of `project_repeat.json`: registry, measurer `fake`, plan hash, 40
frame hashes): the `project_repeat` fixture with `look.gen = 1`, its `work:repeat.same` pin removed, and **the other
packages' switches pinned to their off values** so the golden changes only with P2: an `OTHER_OFF` list in
`tests/update_golden.js`, today `{}`, extended by each package when it lands (P1 `work:text.kana/jump/latin = 0`, P4
`work:morph.auto = false`, `work:weight.auto = false`, P6 `work:sung.real = false`). Written by `tests/update_golden.js`
(new entry next to `project_repeat.json`), checked by `section_kit.test.js`. It is regenerated once per phase (A, B, C)
in that phase's PR; the integrator regenerates it once more if a package lands without extending `OTHER_OFF`.

### 1.9 Performance

- Kit selection: ≤ 10 part keys × 8 kinds × ≤ 25 candidates statics lookups ≈ 2 000 operations per plan (< 0.3 ms);
  memoized per plan in `ctx.pv`.
- Per chooser candidate: one closure call and one small map lookup (≈ 50 k calls in a cold `project_long` plan with the
  catalog, ≈ 1 ms).
- Re-planning: `castInputs.pv` is one interned string compare. Typing moves times, not parts; the content keys do not
  move when text is typed inside a block, so the kits and ids stay; the typing test's ≥ 60 % cast reuse holds.
- Budgets: the two `planner_determinism` speed tests get gen-1 variants with the same bounds (re-plan ≤ 10 ms, cold
  < 60 ms, typing ≤ 30 ms). `tests/browser/perf.py` rows render existing fixtures (no marker) → unchanged.

### 1.10 Risks and open questions

- **Monotony.** A strong signature (×16 on one family) on a short section with a small pool (vertical text, 9:16, a
  season-gated pool) may show the same two entrances in turn. Mitigation: PREV ×0.03 and the runner-up avoid stay; the
  kit is a weight, never a filter; 「演出セットを振り直す」 and 「パートごとに演出をそろえる」 off. Visual QA on the three
  aspects is part of phase A (contact sheets of a verse and a chorus per mood).
- **Pseudo sections** from blank rows are a heuristic. Wrong groups only change which set applies; they cannot empty a
  pool. The AI song analysis or `#` headings override them.
- **One-kind songs** (all 番 headings) key by heading row, so repeated 番 do not share a set. Deliberate: sharing
  would make the whole song one set.
- **Interaction with the echo** (`ECHO = 2.5`): both favour the first copy's part; they multiply. Fine: they agree.
- Open: should the kit also cover transitions (seams)? Not included: seams are sparse, world seams follow background
  changes, and 「くり返しの行をそろえる」 already copies them for repeats.

### 1.11 Interactions with other packages

- **P1 typography**: the kit sets `text.face` (display/serif/body class), not faces or sizes; P1's kana tracking,
  particle size and Latin sizing apply to whatever class is chosen. P1 gates with the same marker: its three strengths
  are independent rows of `planner/rules` (0.2), and `D.newDoc()` writes no pins.
- **P3 キメ**: キメ is a row mark (a leading `!`), read as `cut.kime` / `feat.kime`, not a pin. P3 picks a キメ cut's layout
  and entrance with the chooser inside a restricted set (`req.only`); the kit factor multiplies inside that set (it can
  reorder P3's choices, never leave the set). P3's rule values (`from: 'rule'`) bypass the chooser. `alignments` gets
  P3's `!!src.kime === !!cut.kime` condition.
- **P4 glyph motion**: new parts are `pool: false` → never in a pool → never in a kit. The kit does not touch seams,
  so P4's automatic 「同じ字をつなぐ」 seams are unaffected. P4's switches are independent rows of `planner/rules`.
- **P5 timing**: T4's 0.2 s lead moves cut times, not parts; kits unchanged. P5 gates with the same marker if it needs a
  new-work default.
- **P6 歌ハメ**: forces the entrance by rule where on; the kit then only acts on the other slots. `sung.real` is an
  independent row of `planner/rules`.

---

## 2. M2 — 動きの配分や方向の交互など、文字PVの定石を組み込み

### 2.1 What the user gets

In new works:

- **Direction alternation (方向の交互).** Sideways movement, spins and the side the text sits on alternate from cut to
  cut: if a cut's words blow away to the left or the camera texture pans across, the next directional cut goes the other
  way; a clockwise spin is followed by a counter-clockwise one; a corner note at the bottom left is followed by one on
  the right. Within one cut everything turns the same way (a clockwise entrance leaves clockwise; a line that slides in
  from the left blows away to the right). Directional transitions (押し出し, 振り) alternate too.
  - **Text entrances**: spins alternate on every cut. The sideways entrance 斜めスライド (`skewSlide`) comes from the
    other side only on one-word cuts: its words arrive one after another, and the part keeps clear of the words already
    there only in its designed direction (`parts/depart/drift.js` and `parts/arrive/gather.js` `advancing`), so on
    longer cuts the entrance keeps the reading side. The note of the switch says so.
  - **Text exits** alternate sides: 吹き流し (`windBlow`) and 斜め抜け (`skewExit`) leave to the right as well as to
    the left; their order is reversed with the direction so the words never fly over the ones still waiting.
  - Side flips of the text (layout sides, corners, anchors, sideways exits and entrances) are for horizontal text only;
    vertical text alternates spins, tilts, camera textures and transitions.
  - Phase C adds the camera: push-ins and pull-backs alternate, and the two sideways-framed shots 外して置く (driftOff)
    and 斜めに構える (tiltHold) get mirrored forms (「左右反転」) that alternate their side; EXTREME's mirrored moves
    alternate as well.
- **Motion arc (動きの配分).** Verses stay calmer, choruses stronger, the last chorus strongest; the cut right before a
  chorus holds back (ため); a chorus opens with a stronger move (サビ頭). Strength = which entrances, holds, exits,
  layouts, camera textures and shots are favoured, and how fast the automatic durations run (through the blended
  energy).
- Where: 作品全体 › 見た目 › 詳しい設定: 「動きの向きを交互にする」 and 「曲の山に合わせて強弱をつける」 (both on in new
  works through 「文字PVの定石」).
- なぜ: 「前のカットと逆向きにした」, 「このカットの動きの向きにそろえた」, 「サビなので強い動きを選びやすくした」,
  「次がサビなので、ためて抑えた」, 「最後のサビなので一番強くした」; phase C: 「前のカットが寄りなので、引きの動きを
  選びやすくした」, 「前のカットと逆向きになるよう左右反転した」.
- A flipped direction is still an automatic value: the 向き row shows 自動, its die draws a new direction, and a pin or a
  lock keeps whatever the user or the lock froze.

### 2.2 Gating and defaults

`pv.alternate` and `pv.arc` default to the value of `pv.rules` (0.1). Off → `ctx.pv.on.alt/arc` false; no flip, no
mirror, no zoom factor, no arc factor, `st.feat === cut.feat`. Legacy documents: `ctx.pv === null`.

The mirrored shot values of phase C (`'driftOff~m'`, `'tiltHold~m'`) are new values: `core/shot` accepts them
everywhere (coercion, pins, locks), but only the gated overlay produces them automatically. No legacy plan contains one.

### 2.3 Data model

- Pins: `work:pv.alternate`, `work:pv.arc` (bool).
- Decision parameters: a flipped parameter is written with its own marker, **`pfrom[name] = 'alt'`** (not `'rule'`,
  which means "derived by the motion speed" to explain and to locks). The marker's meaning everywhere:
  - `planner/fields lockPayload putParams` (`fields.js:562–569`): today every parameter with a `pfrom` is skipped; the
    condition becomes `if (d.pfrom && d.pfrom[name] && d.pfrom[name] !== 'alt') continue;` — a lock pins a flipped
    direction as it is, like any automatic value.
  - `planner/cast copyParams` (`cast.js:623–626`): `'alt'` is treated like `'rule'` (an aligned copy takes the source's
    value and the marker is dropped).
  - `planner/explain` (`explain.js:215`): `from === 'alt'` → `[{ code: 'rule', params: { rule: 'pv.alt' } }]`
    (`whyRule.pv.alt`); `'rule'` keeps `speed`.
  - `planner/fields sourceAt` / `fieldState`: `'alt'` leaves the state `auto` (not `derived`: `derived` makes the row
    read-only, `inspector.js:443`, and the user must be able to pin 向き).
  - `camera.applySpeed` and every flip skip a parameter that already has a `pfrom` (a pin, `'rule'` or `'alt'`).
  - `ai/direct` reads `pfrom` as a source label only (`direct.js:491`); `'alt'` reads as automatic there.
- History rows (`planner/cast historyRow`): new field `dir` (packed signs, 2.4). Seam history entries
  (`planner/tracks entryOf`): new field `dir`.
- Phase C, `core/shot`: new exported list `NMIRRORS = ['driftOff', 'tiltHold']` and `mirrorOf(v) → { key, m } | null` for
  any mirrorable preset (NMIRRORS or MIRRORS) with an optional `'~m'`. `coerceShot` accepts `'driftOff~m'`,
  `'tiltHold~m'`; `presetOf` returns the mirrored copy (`SHOTS_MIRRORED`, built with the existing `mirrorKeys`: `ox` and
  `roll` negated); `label()` returns the base preset's key. `SHOT_KEYS` (FROZEN list in `contract.test.js`) is
  unchanged: the mirror is a suffix, as for EXTREME. `sweepAcross` is **not** mirrorable: its travel is `first → last`
  word, the reading direction; negating `ox` would not reverse it.
- No document field besides the pins.

### 2.4 Algorithm

**(a) The direction table** (`planner/flow DIR`, keyed `kind/key`; every entry verified against the catalog and, for the
sign, against the engine by a test). The `h` axis is the on-screen travel of what the viewer sees (+1 = rightward);
`side` is where the text sits (+1 = right); `rot` is the turn (+1 = clockwise).

| entry (params flipped together) | axis | guard | values → sign | flip |
|---|---|---|---|---|
| `arrange/sidebarIndex` (`side`) | side | orient h | left −1, right +1 | swap |
| `arrange/cornerNote` (`corner`) | side | orient h | bottomLeft/topLeft −1, bottomRight/topRight +1 | bottomLeft↔bottomRight, topLeft↔topRight |
| `arrange/creditFold` (`corner`) | side | orient h | bottomLeft −1, bottomRight +1 | swap |
| `arrange/edgeBleed` (`anchor`) | side | orient h | start −1, end +1, center 0 | start↔end |
| `arrange/tiltedCard` (`tilt`) | rot | — | sign(v) when \|v\| ≥ 1, else 0 | v → −v |
| `arrive/twirlArrive` (`dir`) | rot | — | cw +1, ccw −1, alt 0 | cw↔ccw |
| `arrive/skewSlide` (`xFrom`, `kxFrom`) | h | orient h and `feat.words === 1` | −sign(xFrom) (auto 2.4 em: from the right, travels left, −1) | both negated |
| `depart/twirlDepart` (`dir`) | rot | — | cw +1, ccw −1, alt 0 | cw↔ccw |
| `depart/windBlow` (`dir`; with `order`) | h | orient h | left −1, right +1 | swap; `order` `sweepX` → `tail` when flipping to right (and back when flipping to left), only if `order` has no `pfrom` |
| `depart/skewExit` (`xTo`, `kxTo`; with `order`) | h | orient h | sign(xTo) (auto −2.6 em: −1) | both negated; `order` `lead` → `tail` when flipping to +1 (back when to −1), only if `order` has no `pfrom` |
| `dwell/slowDrift` (`angle`) | h | — | cos(v°) ≥ 0.6 → +1, ≤ −0.6 → −1, else 0 | v → wrap(180 − v) into (−180, 180] |
| `lens/panSweep` (`dir`) | h | — | right −1, left +1 (the camera pans right, the picture travels left), up/down 0 | right↔left |
| `lens/driftFloat` (`angle`) | h | — | −(slowDrift sign) (a camera drift) | as slowDrift |
| `lens/parallaxOrbit` (`dir`) | rot | — | cw +1, ccw −1 | swap |
| `seam/swishCut` (`dir`) | h (seam history) | — | left −1, right +1, up/down 0 | left↔right |
| `seam/shoveAcross` (`dir`) | h (seam history) | — | left −1, right +1, up/down 0 | left↔right |
| phase C: shot `driftOff` (stage 6) | side | — | `driftOff` −1, `driftOff~m` +1 | add/remove `~m` |
| phase C: shot `tiltHold` (stage 6) | rot | — | `tiltHold` −1, `tiltHold~m` +1 | add/remove `~m` |

Why the `order` coupling: `windBlow`'s own comment (`parts/depart/drift.js:5–8`) says the wind takes the glyphs from
its downwind edge first, and the autos agree only for `left` + `sweepX`; blowing right with `sweepX` makes the leftmost
glyph fly over the ones still waiting. `tail` (reverse index order, which is left-to-right in horizontal text) keeps
the downwind-first rule for `right`. `skewExit` likewise leaves its lead word first only toward the left. For
`skewSlide` a one-word cut has no stagger, so the mirrored entrance is clean; on longer cuts the reversed order would
bring the words in last-first, which hurts reading, so it is not flipped (A.5: 48 % of lyric cuts are one word).

Every flipped value is coerced through the parameter's own spec (`S.coerce`); an entry whose part or param is missing
from the registry (a lenient registry, materials) is skipped. `pillarColumns.anchor` is **not** in the table: vertical
columns anchor to the reading side.

**(b) Sign of a cut, the target, the flip** (`planner/flow`, called from `cast.decidePart` right after
`PA.resolveParams` and `CAM.applySpeed`, **before** `copyParams`, so an aligned copy still takes its source's values):

```
P_FLIP = 0.9;  LOOKBACK = 2;  RESTART_MASK = 3            // restart on 1 cut in 4

restartAt(st) = !st.part || st.part.first || (H.hash32('pv.restart', look.seed, st.cut.key) & RESTART_MASK) === 0
prevSign(axis) = the first nonzero sign on `axis` among hist rows n−1, n−2 (row.dir), else 0

flipParams(st, kind, idx, slot, d):
  if (!on.alt || st.natural || !d.p || d.v === 'none') return
  const f = st.feat || st.cut.feat
  for e of DIR entries of kind/d.v (in the part's declared param order):
    s = e.sign(d.p)
    if (s === 0) continue
    fixed = e.names.some((n) => d.pfrom && d.pfrom[n] !== undefined)                          // pin, 'rule', 'alt'
         || (ctx.salts && e.names.some((n) => fieldSalted(ctx, st.cut,
                 P.slotParamPath(kind, idx, d.v, n, isShared(kind, n)))))                   // a die on the parameter
         || (e.orient && st.chosen.orient !== e.orient) || (e.when && !e.when(f))
    if (!fixed):
      if (st.dirOwn[e.axis] !== 0): want = st.dirOwn[e.axis]; p = 1                           // one way within a cut
      else if (restartAt(st)): want = 0
      else: want = −prevSign(e.axis); p = P_FLIP
      if (want !== 0 && s !== want && R.stream(slotSeed(slot), 'pv.flip.' + e.id).next() < p):
        for n of e.names: d.p[n] = e.flipValue(n, d.p[n], spec(n)); pfrom[n] = 'alt'
        if (e.order && !(d.pfrom && d.pfrom.order) && d.p.order === e.order.from(want)): d.p.order = e.order.to(want); pfrom.order = 'alt'
        d.pfrom = sorted(pfrom); s = want
    if (st.dirOwn[e.axis] === 0) st.dirOwn[e.axis] = s                                       // fixed values count too
```

A fixed value (pinned, set by a rule, drawn by its own die, or guarded) is never flipped but still gives the cut its
direction, so the rest of the cut follows it. A die on the parameter draws the parameter's auto again (as today) and
the flip leaves the result alone; the next cut alternates against whatever it drew. A cut or line reroll changes the
flip coin's stream (it is under the slot seed), but with `P_FLIP = 0.9` the direction usually stays what the
alternation asks for: a reroll draws new parts, not a new direction.

**Repeats.** There is no special rule for a repeat's direction: an aligned copy (「くり返しの行をそろえる」, on by default in
new works) takes its source's parameters as the Plan shows them, flipped or not (`copyParams`, the §4.10 rule, which
includes the source's rerolls); a repeat that is not aligned alternates against its own neighbours like any cut. So a
reroll of a first copy reaches a non-aligned repeat only when the repeat lies within the alternation chain of the
rerolled cut (below), never through the repeat relation.

`dirOf(st)` packs `dirOwn` as `(h + 1) + 3·(side + 1) + 9·(rot + 1)` (13 = no direction). `castCut` sets
`row.dir = pv ? pv.dirOf(view) : 13` from the lock-free `view` (locks stay invisible to neighbours, §3.6) and returns
`dir = pv ? pv.dirOf(st) : 13` (the cut as the Plan shows it, for stage 6); the cache entry keeps `dir`, and a cache hit
returns `hit.dir`.

History (`createHistory`): `prevDir(k)` (row n−k's `dir`). Cache: `ROW_FIELDS[2] = ['base', 'dir']`,
`ROW_FIELDS[3] = ['base', 'both', 'last', 'shadow', 'dir']`, `ROW_FIELDS[4]` unchanged; `sameFields` compares `dir`
numerically. `TWIN_FIELDS` unchanged: the salt-free re-cast only feeds the camera heir, shadow and natural shot, and
`twinOf` rows hold part values, never parameters, so a direction never reaches them. Legacy rows all have `dir = 13`, so
comparisons behave as before.

How far a change travels: alternation reads the previous cut's *final* sign, so a change propagates along consecutive
directional cuts. It stops at (1) a cut with no sign on that axis for two rows, (2) the first cut of a part run,
(3) special cuts, (4) the salt-free restart coin (1 in 4 cuts, keyed by look seed and cut key, so rerolls and inserts
never move it). Expected chain ≤ 4 cuts; parameters only (part keys are untouched, so the existing part-key stability
bounds hold unchanged).

**(c) Seams** (`planner/tracks decideSeam`, after `withParams`): the same rule on the seam history: `want = −` the
latest nonzero `dir` among the last 3 entries; flip with `P_FLIP` from `R.stream(seed, 'pv.flip.dir')`; pinned
params, a die on the seam's `dir` parameter and copied (aligned) seams are left alone; a flipped `dir` gets pfrom
`'alt'`. `entryOf` records `dir = pv ? pv.seamDir(decision) : 0`; `sameEntries` also compares `dir` (the seam and segment
memos stay correct).

**(d) Phase C — shot mirrors** (stage 6, `ctx.pv.mirrorShots(cuts)`, after `XT.shots` and before `CAM.carry`):

```
for cut in time order:
  own = unpack(cut.dir)
  d = cut.slots['cam.shot']
  if (on.camAlt && d && d.from === 'auto' && typeof d.v === 'string' && NMIRRORS.includes(d.v)):
     axis = d.v === 'driftOff' ? 'side' : 'rot'
     src  = ctx.align ? ctx.align.get(cut.key) : null               // an aligned copy only; no echo rule
     if (src && SHOT.mirrorOf(src.slots['cam.shot'].v)?.key === d.v): want = sign of src's final shot   // as the Plan shows it
     else if (own[axis] !== 0): want = own[axis]                                                    // one way per cut
     else if (restartAt(cut)): want = 0
     else: want = −prevSign(axis)                                                                   // final signs, LOOKBACK 2
     if (want === +1): cut.slots['cam.shot'] = intern({ from: 'auto', v: d.v + '~m' })               // unmirrored sign is −1
     own[axis] ||= (want === +1 ? +1 : −1)
     trace: override { rule: 'pv.mirror', decision }
  push own to prev
```

Interned decisions (one frozen object per value, like `XT.intern`) keep `encodingKey`'s identity test warm. The
overlay is deterministic (no stream). A non-aligned repeat that inherits `driftOff` from its first copy (the camera's
echo, salt-free by the heir rule) chooses its side by its own neighbours, like any cut, so a reroll of the first copy
does not reach it through the repeat relation.

**(e) Phase C — push-in / pull-back alternation** (`planner/camera weighShots`, through `ctx.pv.shotFactors(st, rec)`):

```
ZOOM_CLASS = { pushWord: 'in', snapZoom: 'in', settle: 'in', pullReveal: 'out', readAlong: 'out', wideHold: 'out' }
prevClass  = ZOOM_CLASS[base key of rec.prev] (rec.prev = the previous cut's final shot; the shadow in a salt-free re-cast)
factor on w (recency-type: not in wBase, not in wOwn), not on emphasised cuts ((st.feat || st.cut.feat).emph: the
user marked a word, whose push-in pushWord weighs ×3 there, camera.js:165):
  prevClass 'in' : 'out' keys ×1.6, 'in' keys ×0.6
  prevClass 'out': 'in' keys ×1.4, 'out' keys ×0.7
natural pass (st.natural): no factor (recencyOf returns prev = null there)
```

Echo inheritance (§4.7 rules 1–6) and aligned shots are decided before the weights matter, so repeats keep their
first copy's move.

**(f) Phase C — EXTREME mirror** (`planner/extreme mirrorOf`): new argument `alt = !!(ctx.rules && ctx.rules.alt &&
ctx.pv && ctx.pv.on.camAlt)` (read once in `pass()`; stub contexts in `extreme_planner.test.js:203` give false). Order:
whipPan pair → same direction (unchanged); echo of the same preset → same mirror (unchanged); **new**: `alt` and the
previous window row shows a MIRRORS preset → `!rec.last.m`; else the existing `hash32('xmirror') & 1`. Only documents
with both the EXTREME pin and the rule on see a change.

**(g) The arc** (`pv.arc`, phase A):

1. Blended energy: when the song is not neutral, `featOf(cut)` = a frozen copy of `cut.feat` with
   `energy = q3(clamp(0.5 · feat.energy + 0.5 · drive))`. It feeds every place that weighs by energy: trait fits and
   `fits()` (chooser), parameter autos with `follow: 'energy'` / `'-energy'` (durations shorten in choruses),
   `text.scale`, the shot base weights, `cam.zoom` and the `cam.curve` choice. `feat` itself (encoded in the Plan) is
   never changed. `planner/camera decideCamera` and `weighShots` read `st.feat || st.cut.feat` (hand-made `st` objects
   in `camera_planner.test.js` have no `feat`).
2. Arc factor on strength (0.4), for arrange, arrive, dwell, depart, lens (chooser, via `partFactor`) and shots
   (`shotFactors.own`, applied to `own`, i.e. part of the natural pick):
   `strength +1: × (0.4 + 1.2·drive)`, `strength −1: × (1.6 − 1.2·drive)`, `0: × 1`. At drive 0.5 both are 1.
3. Transition chance (`tracks.decideSeam`): `pace.seam · (0.5 + 0.5 · energy)` reads the blended energy of B
   (`ctx.pv.featOf(B).energy`).
4. Not touched: EXTREME weights (EXTREME keeps its own section table), rigs, impulses, motion speed.

Measured on basic + repeat × 6 seeds × 2 aspects × 6 moods, factor alone (A.3): strong entrances in choruses 42 % → 51 %,
in verses 39 % → 33 %; strong layouts 35 % → 47 % vs 30 % → 25 %.

`featOf` memo: blended features are memoized by `cut.featId + '|' + drive` in a two-plan map, read and written only when
the plan is cached (the same condition `featuresOf` uses, `plan.js:384–397`); trace and fresh runs build them anew.

### 2.5 Engine / planner / UI changes

Phase A:

- `planner/flow` (new): `DIR` (2.4 a), `signOf`, `flipValue`, `restartAt`, `flipParams`, `dirOf`, `flipSeam`, `seamDir`.
- `planner/cast`: `decidePart` calls `ctx.pv.flipParams` (above); `castCut` sets `row.dir`, returns `dir`, keeps `dir`
  on the cache entry; `createHistory` gains `prevDir`; `ROW_FIELDS`, `sameFields` (above); `stateOf` sets `st.dirOwn`,
  `st.feat`, `st.part`; `copyParams` treats `'alt'` like `'rule'`.
- `planner/fields putParams`: pins `'alt'` parameters (2.3); `sourceAt`: `'alt'` stays `auto`.
- `planner/tracks`: `decideSeam` (chance with blended energy; flip), `entryOf`, `sameEntries`.
- `planner/camera`: `decideCamera` and `weighShots` read `st.feat || st.cut.feat`; `weighShots` multiplies `own` by
  `pvf.own[i]` (arc) when `st.ctx.pv`; its why list appends `pvf.why(i)`.
- `planner/explain`: `'alt'` → `pv.alt` (2.3); `factorWhy` adds `pv.arc.up` / `pv.arc.down` / `pv.tame` / `pv.peak` from
  `f.pvArc` and the cut's part (`plan.pv.parts`); `pv.altSame` when the flip followed `dirOwn`.
- `ui/fields`: rows `pv.alternate`, `pv.arc` (1.5).

Phase C:

- `core/shot`: `NMIRRORS`, `SHOTS_MIRRORED`, `mirrorOf`; `coerceShot`, `presetOf`, `label` accept `'driftOff~m'`,
  `'tiltHold~m'`. `lastFraming`, `maxFill`, `expandShot`, `usesBeats` go through `shotOf → presetOf` and need nothing
  else. `isExtreme('driftOff~m')` stays false (`xKeyOf` checks XSHOT_DATA only).
- `planner/camera`: `opensOnText` and the `cam.follow` auto read `SHOT.presetOf(v)` instead of `SHOT.SHOTS[v]`
  (identical for every existing value); the zoom factor (2.4 e).
- `planner/extreme`: `mirrorOf(key, rec, prefix, alt)`; `pass()` reads the guarded `alt` once.
- `planner/plan` stage 6: `if (ctx.pv && ctx.pv.on.camAlt) ctx.pv.mirrorShots(cuts);` between `XT.shots` and `CAM.carry`.
- Every label of a mirrored shot goes through `SHOT.mirrorOf(v)` (it covers both kinds):
  - `ui/widgets` shot widget label; `ui/inspector openShots`: `xNow = SHOT.mirrorOf(value)` so picking the current tile
    keeps its mirror for normal presets too.
  - `ui/ai_review.js:340–342`: `const m = SHOT.mirrorOf(v); return m && m.m ? t('shot.mirroredOf', …) : …`
    (today `SHOT.xKeyOf`, which would drop 「（左右反転）」 on `driftOff~m`).
  - `ai/direct.js:323` (the brief): a mirrored normal shot is sent as its base key (`SHOT.mirrorOf(v).key`), because the
    AI vocabulary is `SHOT_KEYS`; `cameraFromAi` (`direct.js:158`) is unchanged, so an AI never writes a mirrored normal
    shot (`SHOT_KEYS.includes('driftOff~m')` is false).
  - `ui/lab.js:148 cameraKeyOk`: for kind `'shot'`, `const m = SHOT.mirrorOf(key); return m ? cameraKeys(kind).includes(m.key) : cameraKeys(kind).includes(key)`.
- `tests/node/shot.test.js:233`: the title becomes "coerceShot: x-keys (with "~m"), the two mirrored normal presets, and
  x-objects by XLIMITS; every other value exactly as before", with `'driftOff~m'`, `'tiltHold~m'` cases added and
  `'settle~m'` still refused. DESIGN_2_1 §4.5 (the ShotRef grammar) gains the sentence "`driftOff` and `tiltHold` accept
  the mirror suffix `~m` (PV22, 文字PVの定石)"; §14.2 and the §8 sentence at `DESIGN_2_1.md:5818` ("non-x values exactly
  as before") gain the same exception, in the phase C PR.

### 2.6 Strings

| key | ja | en |
|---|---|---|
| `fld.pvAlternate` | 動きの向きを交互にする | Alternate directions |
| `fld.pvAlternate.note` | 横の動き・回転・文字を寄せる側を、前のカットと逆にします（横書きのとき。縦書きでは回転とカメラの動きだけ）。同じカットの中の動きは同じ向きにそろえます。文字の入りは読む向きを守るため、一語だけのカットでだけ左右を入れ替えます。 | Sideways moves, spins and the side the text sits on alternate from cut to cut (in horizontal text; vertical text alternates spins and camera moves only). Moves within one cut share a direction. To keep the words readable, text slides in from the other side only on one-word cuts. |
| `fld.pvAlternate.note` (phase C text) | 上の文に「寄りと引き、カメラの構えの左右も交互にします。」を足す | adds "Push-ins and pull-backs, and the side of a framed shot, alternate too." |
| `fld.pvArc` | 曲の山に合わせて強弱をつける | Follow the song's build |
| `fld.pvArc.note` | Aメロは落ち着かせ、サビで強く、最後のサビを一番強くします。サビの直前は少しためます。パートは見出し（# サビ など）か曲の分析から読み取ります。 | Verses stay calmer, choruses get stronger and the last chorus strongest, with a short hold right before a chorus. Song parts come from headings (such as "# Chorus") or the song analysis. |
| `why.pv.alt` | 前のカットと逆向きにした | Opposite direction to the previous cut |
| `why.pv.altSame` | このカットの動きの向きにそろえた | Same direction as the rest of this cut |
| `why.pv.arc.up` | {section}なので強い動きを選びやすくした | {section}, so stronger moves are favoured |
| `why.pv.arc.down` | {section}なので落ち着いた動きを選びやすくした | {section}, so calmer moves are favoured |
| `why.pv.tame` | 次がサビなので、ためて抑えた | The chorus comes next, so this holds back |
| `why.pv.peak` | 最後のサビなので一番強くした | The last chorus, so it goes strongest |
| `whyRule.pv.alt` | 前のカットと逆向きにした | Opposite direction to the previous cut |
| phase C `why.pv.zoomOut` | 前のカットが寄りなので、引きの動きを選びやすくした | The previous cut pushed in, so a pull-back is favoured |
| phase C `why.pv.zoomIn` | 前のカットが引きなので、寄りの動きを選びやすくした | The previous cut pulled back, so a push-in is favoured |
| phase C `whyRule.pv.mirror` | 前のカットと逆向きになるよう左右反転した | Mirrored to go the opposite way to the previous cut |

`shot.mirroredOf` (existing, 「{name}（左右反転）」) names mirrored normal shots too.

### 2.7 Tests

New `tests/node/pv_flow.test.js` (phase A):

1. **Table**: every `DIR` entry names a catalog part and params; every value of an enum map is in `spec.of`; `flip` maps
   `spec.of` (or 200 sampled numbers of the range) into the spec (`S.coerce` idempotent) and `sign(flip(v)) = −sign(v)`
   whenever `sign(v) ≠ 0`; coupled entries flip all their names together; `pillarColumns.anchor` is absent.
2. **Signs against the engine**: for `skewSlide`, `skewExit`, `windBlow`, `panSweep`, `slowDrift`, `driftFloat`, a one-cut
   scene (the `frame.test.js` helpers) with the part pinned at each value: the text's (or the view's) x displacement
   between 30 % and 70 % of the phase has the sign the table gives; the flipped `windBlow` / `skewExit` (with the
   coupled order) never draws a leaving glyph over a glyph still at rest (the bounding boxes of a moving unit and of the
   units with rank above it do not overlap before they start).
3. **Alternation rate** (corpus(6) × 3 aspects, catalog, gen 1): over consecutive lyric-cut pairs in one part run where
   both have a nonzero sign on an axis and the second is not a restart, the signs differ in ≥ 80 % (each of h, side,
   rot with ≥ 50 pairs); with `pv.alternate` pinned false, 35–65 %. Also on entrances alone (twirls and one-word
   `skewSlide`): ≥ 80 % over ≥ 50 pairs. Mutation: `P_FLIP = 0` → fails.
4. **Within a cut**: `twirlArrive.dir` and `twirlDepart.dir` of one cut agree in ≥ 95 % (off: ≈ 50 %); a one-word cut
   whose `skewSlide` came from the left blows away to the right when its exit is `windBlow` (≥ 95 %).
5. **Precedence**: a pinned `twirlArrive.dir` is never flipped and still sets the cut's direction; P3's `'rule'`
   parameters are never flipped; an aligned copy's directional params equal its source's; guarded entries (vertical
   text, multi-word `skewSlide`) are never flipped.
6. **Locks**: lock a line whose cut has a flipped `twirlArrive.dir` (`pfrom 'alt'`); the lock payload pins `dir`;
   reroll the cut before it (and, separately, the cut after it); the locked cut's `dir` is unchanged
   (mutation: `putParams` skipping `'alt'` → fails). `planner_pins`' lock test keeps passing: after a lock every
   parameter is `'pin:cut'` except the `DERIVED` `'rule'` ones.
7. **The die**: on a cut with a flipped `twirlArrive.dir`, `salt.bump cut/<key>:arrive@twirlArrive.dir` with 200 salts
   changes the value in ≥ 40 % of salts, and every such salt leaves `pfrom.dir` undefined (the draw, not a flip);
   mutation: flip ignoring the parameter's salt → < 15 %.
8. **Seams**: consecutive directional seams alternate in ≥ 80 %; a copied seam and a pinned seam dir are untouched.
9. **Arc** (basic + repeat × corpus(6), 6 moods): strong-entrance share chorus − verse ≥ 10 points (measured 18),
   strong-layout share ≥ 10 points; the tame cut's strong share ≤ the verse share; the last chorus's strong share ≥ the
   other choruses'; a neutral document plans identically with `pv.arc` on and off; the `catalog.test.js` checks "moods
   produce different distributions" pass on the gen-1 corpus with their thresholds.
10. **Parameter stability** (gen 1): rerolling a cut changes the directional signs of at most 4 later cuts in ≥ 95 % of
    cases; inserting a line, of at most 4 cuts after it in ≥ 95 % (the restart coin never moves).
11. **Repeats vs rerolls** (added to `planner_stability.test.js`, gen 1): with `repeat.same` pinned false, a reroll of a
    first copy (cut, line, and a die on its entrance) leaves the direction signs of each of its repeats that is not
    within the 4 cuts after it in the same part run (the chain of 2.4 b); with `repeat.same` on, every aligned repeat's
    directional params equal the source's as the Plan shows it, after the reroll too (the §4.10 rule).
12. **Cache**: the random-edit re-plan test on gen documents (1.7 item 9) includes rerolls next to directional cuts
    (mutation: drop `'dir'` from `ROW_FIELDS[3]` → a cached plan differs from the fresh one).
13. **Explain**: a flipped param explains as `pv.alt`; an arc-weighted pick names `pv.arc.up/down`, `pv.tame` or `pv.peak`.

Phase C additions (`pv_flow.test.js`, `shot.test.js`): `coerceShot('driftOff~m')`, `('tiltHold~m')` round-trip;
`coerceShot('sweepAcross~m')` and `('settle~m')` are `undefined`; `presetOf('driftOff~m').keys` = keys with `ox`, `roll`
negated; `expandShot('tiltHold~m')` rolls opposite to `'tiltHold'`; `lastFraming('driftOff~m')` carries the negated `ox`;
`label('driftOff~m')` = `['shot.driftOff', {}]`; `ai_review` labels a mirrored normal shot with 「（左右反転）」; the AI brief
names `driftOff` for `driftOff~m`; consecutive auto `driftOff`/`tiltHold` shots alternate their mirror (≥ 90 %,
deterministic rule); no `'~m'` normal shot in any legacy corpus plan (scan); zoom: P(out-class | previous in-class)
rises by ≥ 10 points against `pv.alternate` off, and on emphasised cuts the pushWord share is unchanged; EXTREME: with
the EXTREME pin and the rule on, consecutive mirrorable x-shots alternate except whipPan pairs and echoes; with the rule
off, identical to today (`project_extreme` docs); a stub `ctx` without `rules` keeps today's branch; a reroll of a first
copy leaves its non-aligned repeats' `'~m'` outside the 4-cut chain.

Updated: `camera_planner.test.js` (`opensOnText`/follow via `presetOf` give today's values for every preset; hand-made
`st` without `feat` still works), `extreme_planner.test.js` (the alt branch; stub ctx), `contract.test.js` (unchanged
FROZEN lists still pass; `SHOT_KEYS` untouched).

### 2.8 Goldens

All existing goldens unchanged for the reasons of 1.8; in addition: `project_extreme.json` documents carry the EXTREME
pin but no marker → `ctx.rules.alt === false` → `mirrorOf` takes the old branches; no legacy plan contains a mirrored
normal shot, and `coerceShot` of every existing value is unchanged (a pure extension); no legacy decision carries
`pfrom 'alt'`, and the `putParams` / `copyParams` / explain changes only act on it. `project_pv.json` (1.8) covers M2.

### 2.9 Performance

- Flips: one `Map` lookup per part decision (most parts have no entry); a stream only when a flip is possible.
- `row.dir`: one small integer per row; the cache compare adds two integer compares.
- Mirror overlay (phase C): one pass over the cuts, no allocation except interned decisions.
- Blended features: one frozen object per cut per plan (≈ 250 small objects for `project_long`), only under `pv.arc`,
  memoized across cached plans (2.4 g), so the typing test's cast reuse is kept.
- No render-time cost: frames only see different decisions.

### 2.10 Risks and open questions

- **Chains**: bounded as described (2.4 b); verified by tests 10 and 11. A user rerolling one cut may see the next few
  directional cuts turn around; this is the price of real alternation and is limited to directions.
- **Readability**: text-side flips are for horizontal text only; `skewSlide` flips only on one-word cuts; `windBlow`
  and `skewExit` flip their order with their direction. Visual QA (contact sheets of flipped exits and entrances on
  16:9 and 9:16) is part of phase A; if QA rejects the one-word `skewSlide` flip, its entry is removed and the note
  keeps saying that entrances keep the reading side.
- **Locks**: a locked line keeps its directions (pinned by the lock); its neighbours alternate against its lock-free
  view (§3.6: locking changes nothing outside the line), so right after a lock a neighbour can go the same way as the
  locked line. Accepted.
- **Arc vs mood**: a fast mood still gets fast parts in verses (the factor at drive 0.35 is ×0.82, not a ban).
- **Rigs** are not mirrored (`driftSide`, `leanTilt` span a whole section; alternation between runs is already the
  rig's avoid rule). Open: mirror rigs per run under the same rule later.
- Open: "calm after a strong cut" (damping a strong entrance right after another) is not included: the owner's list was
  verse calmer, chorus stronger, calm before strong, last chorus peak.

### 2.11 Interactions with other packages

- **P3 キメ**: `planner/arc` gives a キメ cut `drive = max(drive, 0.85)` through `kimeAt(cut)` (`cut.kime` / `feat.kime`,
  already inside `featId`, so the memo is correct). The parts P3's rule forces (big layouts, stampPress / zoomSettle,
  impactKick) have no direction parameters except `edgeBleed.anchor`, which P3 sets to `'center'` with pfrom `'rule'`:
  sign 0, never flipped, and explained as P3's rule (the `'alt'` marker keeps P2's label off it).
- **P4**: a `glyphMorph` seam has no `dir` param → never flipped; `pool: false` weight parts are pinned → never flipped.
- **P5 T4** (0.2 s lead): shifts times, not signs; the blended energy of a cut may change slightly with the loudness
  window (audio documents only).
- **P6 歌ハメ**: typeOn/'sung' entrances have no direction.
- **EXTREME** keeps its intent: its shots replace automatic shots after the cast; the arc does not touch EXTREME
  weights; the only change is the gated mirror alternation of phase C (2.4 f).

---

## 3. T5 — 効果を重ねすぎない

The owner lists this item under 【文字組み】, so its heart is the lettering: effects stacked on the letters themselves.
T5 therefore has two layers: a **hard lettering rule** (primary) and a **mild cut budget** (secondary) that only trims
decorations and screen effects.

### 3.1 What the user gets

- In new works, the lettering never carries two effects of the same kind: no glow entrance, hold or exit on glowing
  text, no after-image motion on outlined or two-tone text, no glowing, after-image or colour-split screen effect on
  lettering that already has two effects in play. This holds for every automatic choice; the only exception is a cut
  whose whole pool is blocked (then the planner picks as before).
- A cut that is still too busy chooses fewer decorations (装飾) first, then fewer screen effects (画面効果), never below
  what a film mood needs for its look or the impact line's flash. Calm moods count up to 4 layers per cut, lively ones
  5, the fastest 6; an impact line and a カメラ EXTREME cut one more each.
- T5 never removes or changes a camera move, a camera texture, a motion, a transition into a new background, an impact
  flash, shake or slip, a pin, a lock, an aligned copy, an EXTREME move or anything on a キメ line.
- Where: 作品全体 › 見た目 › 詳しい設定: 「効果を重ねすぎない」 (toggle, on in new works) and 「1カットに重ねる効果の目安」
  (number 4–8, 自動 = from カットの速さ; the box shows 自動（4） etc.). なぜ on a reduced count:
  「効果が重なりすぎないように数を減らした」; on a pick that avoided a clash: 「文字に同じ種類の効果が重ならないようにした」.

### 3.2 Gating and defaults

`pv.fxCap` defaults to the value of `pv.rules`; `pv.fxMax` has no parent (automatic = `RU.baseCap(amounts)`). Off → no
block, no trimming, no seam gate. Legacy documents: `ctx.pv === null`.

### 3.3 Data model

- Pins: `work:pv.fxCap` (bool), `work:pv.fxMax` (int 4–8).
- No new decision slots: reduced counts are ordinary `ornament.count` / `filter.count` decisions with `from: 'rule'`
  (the trace names rule `pv.fx`); dropped decorations are absent slots, as if the count had been lower.
- `planner/fxcap` tables: `LOUD_TAGS = ['hard', 'busy']`, `STYLE_CH`, `GLYPH` (3.4 d), `TEXT_FILTER_CH = { glowSpill: 'glow',
  afterImage: 'echo', chromaSlip: 'split' }`.

### 3.4 Algorithm

**(a) The cap and the load.**

```
cap(cut)  = (pin pv.fxMax ?? 3 + round(3 · amounts.pace))    // quietHush, dreamHaze, heartAche, printColumn, silverReel 4;
                                                             // popFizz, glitchFracture 5; dashSprint 6
          + (cut.impact ? 1 : 0) + (xOn(cut) ? 1 : 0)
xOn(cut)  = XT.valueAt(ctx.ix, at(cut)) > 0                  // the EXTREME switch resolves on at the cut
castLoad  = ORN + FX + LENS + CAM + MOT + IMP
  ORN  = ornament.count                         FX  = filter.count
  LENS = a moving camera texture: lens ≠ 'none', family ≠ 'still' and not a framing lens (def.frames) ? 1 : 0
  CAM  = xOn ? 2 : (cam.shot ≠ 'none' || lens def.frames) ? 1 : 0      // a framing lens is the cut's camera move
  MOT  = some of arrive/dwell/depart has a tag in LOUD_TAGS or traits.impact ? 1 : 0
  IMP  = cut.impact ? 1 : 0                                            // one hit, however many impulses
load      = castLoad + SEAM, SEAM = a transition other than the hard cut into the cut ? 1 : 0
not counted: the section rig, the atmosphere (a run background), the work texture, the ground.
```

**(b) Trimming** (`ctx.pv.trimLists(st, needF)`, cast time, after the camera; the FROZEN slot order is unchanged: each
slot keeps its own stream, so lowering a count later changes no other value). It runs in `decideList(st, 'filter')`
right after the filter count (and its `index` raise) and before the filter slots, and in camOnly passes (`castSlots(…,
camOnly)`, the salt-free re-cast) after `CAM.decideCamera` with the filter count decided but no filter slots, so the
decorations a later cut's recency reads agree in every pass. `recastCamera` copies the view's already trimmed slots
and does not trim again (it only produces the shadow and the heir, which never read decorations).

```
trimLists(st, needF):
  if (!on.fx || kimeAt(cut) || !PER_CUT_ROLES.has(cut.role)) return
  cap   = capOf(st);  fixed = LENS + CAM + MOT + IMP (from st.slots)
  o = st.slots['ornament.count'];  f = st.slots['filter.count']
  oFree = o.from is 'auto' or 'rule'(index) and !st.fromAlign?.has('ornament.count')     // pins and aligned counts stay
  fFree = likewise for 'filter.count'
  needO = 1 + the highest i with st.slots['ornament#' + i].from starting 'pin' (else 0)   // the index floor
  keepF = min(f.v, (FILM ? 1 : 0) + (cut.impact && amounts.flash > 0 ? 1 : 0))          // the film look and the hit
  FILM  = filterDrive(look) ≥ 0.5                                                        // silverReel, glitchFracture…
  over  = fixed + o.v + f.v − cap
  if (over > 0 && oFree):                                        // decorations first
    n = max(needO, o.v − over)
    if (n < o.v): set o = { v: n, from: 'rule' } (rule 'pv.fx'); delete ornament#i (slots, chosen, base, ref) for i ≥ n
    over −= (old o.v − n)
  if (over > 0 && fFree):                                        // then screen effects above the keep
    m = max(needF, keepF, f.v − over)
    if (m < f.v): set f = { v: m, from: 'rule' } (rule 'pv.fx')
```

**(c) Stage 6.**

```
seams (tracks.decideSeam, before the chance roll, only without a pin, without a copied seam, not a P4 exempt seam):
  world = A.ground !== B.ground
  castLoad(B) > cap(B) and !world → the hard cut, from 'rule', trace rule 'pv.fx'
  (a cut still over its cap after trimming gets no transition on top; a background change always may)
impulses: never changed.
```

What holds (automatic lyric/focus cuts, not キメ, counts free): `castLoad ≤ cap`, unless the decorations are at their
floor (0 or the pinned index) and the screen effects at the keep (nothing trimmable is left); a transition is added only
where `castLoad ≤ cap` or the background changes, so `load ≤ cap + 1` there. The cap is therefore a guide (目安): the
camera, the motions, world transitions and impact hits are never trimmed, so a cut with a lot of them can exceed it,
which the row's label and note say.

**How strong this is** (A.1, the rule applied to legacy plans of corpus(3) × {16:9, 9:16} × 8 moods, an upper bound
that ignores re-picks): 1–16 % of lyric cuts lose a layer; decorations drop 1–16 % per mood (1–14 % counting only cuts
at most one over the cap), screen effects 0–6 %, transitions and impulses 0 %; the share of cuts above the cap falls
from 3–23 % to 1–13 %. Acceptance on the implementation: the same table recomputed from gen-1 plans goes into NOTES,
and every element drops ≤ 15 % per mood counting cuts at most one over the cap; `catalog.test.js`'s mood-distinction
and film-mood checks pass on the gen-1 corpus.

**(d) Lettering** (the 文字組み reading; a hard block for automatic picks, through `partFactor(st, kind).block`):

```
STYLE_CH = { plain: [], shadow: [], outline: ['edge'], duo: ['edge'], glow: ['glow'] }   // REG.TEXT_STYLES
style    = st.chosen['text.style']                                   (decided before the motions)
chan(C)  = C without 'tint' (a colour shift is not a stacked effect)
clash(S, C) = (S ∋ glow and C ∋ glow) or (S ∋ edge and C ∋ echo) or |S ∪ chan(C)| > 2

motion candidate k of arrive / dwell / depart:  block if clash(STYLE_CH[style] ∪ P4, GLYPH[kind/k])
filter candidate k ∈ TEXT_FILTER_CH (channel c):
  phases = the chosen arrive, dwell, depart (they run one after another, so only one phase's channels add at a time)
  block if clash(STYLE_CH[style] ∪ P4, {c}) or some phase has c (glow on glow, echo on echo)
        or max over phases |STYLE_CH[style] ∪ P4 ∪ chan(GLYPH[phase]) ∪ {c}| > 2
P4 = ['wt'] when P4's weight animation is on for the cut (P4 exposes it before the motions), else []
```

The block is hard: `choose.pick` skips blocked candidates for the final, natural and reference picks alike; only if
every candidate is blocked does it pick again without the block (so a pool, including P3's restricted キメ sets, is never
emptied). Explain shows a blocked alternative with weight 0 and the pick's why names `pv.letter` when something was
blocked. `draw.js` already takes the max of a glow style and a motion glow; the block keeps such pairs from being
chosen at all.

**(e) The glyph-channel table** `GLYPH` (initial content from a source scan, A.4; completed and locked by a test that
derives the channels from the engine):

```
arrive:  bloomOpen [glow, tint]  fogIn [blur]  ghostConverge [echo]  inkRise [blur, tint]  pixelStep [tint, pixel]
         rainDrop [blur]  shardGather [shard]  sliceReveal [tint]  stampPress [tint]  staticJoin [echo, tint]
         strobeIn [tint]  zoomSettle [blur]
dwell:   shimmerSweep [tint]
depart:  fogOut [blur]  inkSink [blur, tint]  meltDown [blur]  pointImplode [blur]  shardBurst [shard]
         sliceHide [tint]  zoomPast [blur]
(every other motion part: [])
```

The test builds each motion part's behaviour through `engine/scene` (a scene of one cut with that part pinned), runs it
at t ∈ {0.1, 0.3, 0.5, 0.7} of its phase, and collects the glyph columns (`glow, echo, tint, blur, shard, pixel`,
behave `MASK_GROUPS`, and `wt` once P4 lands) that leave identity; it asserts `GLYPH` equals that set for every catalog
part. The implementer fills any entry the test reports.

**(f) What T5 never does.** Change a pin, a lock, an aligned count, an EXTREME shot, a lens, a camera shot, a motion
choice other than by the lettering block, a キメ line, the work texture, a rig, an atmosphere, a ground, a copied seam
or a world seam, or an impulse; add anything (it only blocks or removes).

### 3.5 Engine / planner / UI changes

- `planner/fxcap` (new): `capOf(ctx, cut)`, `loadOf(slots, cut, xOn)`, `trimLists(st, needF)`, `letterBlock(st, kind)`,
  `seamGate(ctx, A, B, world)`, `STYLE_CH`, `GLYPH`, `TEXT_FILTER_CH`, constants.
- `planner/conventions`: wires them into `trimLists`, `partFactor.block`, `seamGate`, `kimeAt`.
- `planner/cast`: `decideList(st, 'filter')` calls `ctx.pv.trimLists(st, need)` after the count and its `index` raise;
  `castSlots` with `camOnly` decides the filter count (no slots) and trims when `ctx.pv && ctx.pv.on.fx`;
  `decideValue` records `st.fromAlign` (1.5).
- `planner/choose pick`: the block (1.5).
- `planner/tracks decideSeam`: the gate before the chance.
- `planner/explain`: `whyRule.pv.fx` for counts and seams; `factorWhy` adds `pv.letter` when the trace shows a block.
- `ui/fields`: rows `pv.fxCap` and `pv.fxMax` (1.5); `planner/fields` shows `pv.fxMax` auto as `RU.baseCap` with the
  `fld.pvFxMax.auto` text.

### 3.6 Strings

| key | ja | en |
|---|---|---|
| `fld.pvFxCap` | 効果を重ねすぎない | Don't pile up effects |
| `fld.pvFxCap.note` | 文字に同じ種類の効果（光る文字に光る動き、縁取りの文字に残像など）を重ねません。1カットが混みすぎるときは、自動で選ぶ飾りと画面効果の数を減らします。カメラ・動き・切り替え・見せ場の光や揺れ、固定したもの、カメラ EXTREME、キメの行はそのままです。 | Keeps the lettering from stacking effects of the same kind (a glowing move on glowing text, an after-image on outlined text). When a cut gets too busy, fewer decorations and screen effects are chosen. The camera, motion, transitions, impact flashes and shakes, pins, Camera EXTREME and Kime lines stay as they are. |
| `fld.pvFxMax` | 1カットに重ねる効果の目安 | Effects per cut (guide) |
| `fld.pvFxMax.note` | 自動では「カットの速さ」から決まります（落ち着いた雰囲気は4、速い雰囲気は6）。見せ場の行とカメラ EXTREMEのカットは1つ多くなります。減らすのは飾りと画面効果だけなので、カメラや動きの多いカットはこれを超えることがあります。キメの行は別の決まりに従います。 | Automatic: set by Cut pace (4 for calm moods, 6 for the fastest). Impact lines and Camera EXTREME cuts get one more. Only decorations and screen effects are reduced, so a cut with a lot of camera work or motion can go over it. Kime lines follow their own rules. |
| `fld.pvFxMax.auto` | 自動（{n}） | Auto ({n}) |
| `why.pv.fx` | 効果が重なりすぎないように減らした | Reduced so effects do not pile up |
| `why.pv.letter` | 文字に同じ種類の効果が重ならないようにした | Keeps the lettering from stacking the same kind of effect |
| `whyRule.pv.fx` | 効果が重なりすぎないように数を減らした | Fewer, so effects do not pile up |

The i18n test rejects Japanese in en strings (only the product name is allowed), so en uses the existing en name
"Camera EXTREME" (`fld.camExtreme`) and P3's en name "Kime". ja keeps カメラ EXTREME and キメ. The ja and en strings of a
pair use the same placeholders (`{n}` only in `fld.pvFxMax.auto`).

### 3.7 Tests

New `tests/node/fx_cap.test.js` (phase B):

1. **Lettering, never** (corpus(3) × {16:9, 9:16} × 8 moods × every theme style, catalog, gen 1): no automatic motion
   or text screen effect clashes with its cut's lettering (3.4 d), except on cuts whose pool held only clashing
   candidates (the test computes the pool with `CA.poolOf` and the same `clash`; such cuts are listed and must be ≤ 1 %
   of cuts). With `pv.fxCap` pinned false, the same corpus has clashes (sanity). Mutation: drop the block → fails;
   drop the fallback → a pool of one clashing part returns `null` (a hand-made registry case).
2. **Cap holds as specified**: for every automatic lyric/focus cut (no pin, no lock, no alignment, no キメ, free
   counts), `castLoad ≤ cap` or (decorations at the floor and effects at the keep); a transition only where
   `castLoad ≤ cap` or the background changes. Mutations: skip the decoration trim → fails; skip the seam gate → fails.
3. **Pinned caps 4–8**: for each value, item 2 holds; `pin.set work:pv.fxMax 3` is refused by the spec.
4. **How strong** (the A.1 table on gen-1 plans): each of decorations, screen effects, transitions, impact impulses
   drops ≤ 15 % per mood counting cuts at most one over the cap; transitions and impulses drop 0 % except gated
   non-world seams on cuts still over their cap; the table is printed for NOTES.
5. **Moods keep their identity**: the `catalog.test.js` checks "film moods show their screen effects" and "moods
   produce different distributions" pass on the gen-1 corpus with the same thresholds (FILM keep).
6. **Pins win**: a pinned `ornament#2`, a pinned `filter.count = 3`, a pinned seam and a pinned lens stay; no warning; a
   pinned `ornament#1` keeps the count ≥ 2.
7. **Camera untouched**: on every cut whose arrange, arrive, dwell, depart and lens are the same with `pv.fxCap` on and
   off, `cam.shot`, the EXTREME move and the lens parameters are the same; with the EXTREME pin (`project_extreme` docs
   + gen 1) the number of EXTREME moves does not drop.
8. **キメ** (with P3): the キメ cut's slots and its impulses are identical with `pv.fxCap` on and off (the block may act
   inside P3's set only where P3's set offers a non-clashing part; a P3 test pins that set in this case).
9. **Impulses**: the impulse list of every gen-1 corpus plan is identical with `pv.fxCap` on and off.
10. **Explain**: a reduced count explains as `rule: 'pv.fx'`; a gated seam as `pv.fx`; a blocked pick names `pv.letter`.
11. **GLYPH table** (3.4 e) against the engine.
12. **Stability**: T5 reads only the cut's own decisions (and its seam), so the part-key stability bounds of 1.7 item 7
    hold with only `pv.fxCap` on; the cache re-plan test (1.7 item 9) with `pv.fxCap` toggled and `pv.fxMax` pinned.

Updated: `i18n.test.js` (codes), `ui_fields.test.js` (rows; the number placeholder).

### 3.8 Goldens

Unchanged for the reasons of 1.8 (no marker, no pin → `ctx.pv` null → no trim, no block, no gate; `choose.pick` without
`req.pv` is today's loop; `decideValue` records `st.fromAlign` only when aligned, which reads nothing). `project_pv.json`
covers T5 from phase B on.

### 3.9 Performance

A few additions and compares per cut at cast time; the lettering block is one table lookup per motion or filter
candidate; the fallback second pass runs only when every candidate is blocked (rare by test 1). The camOnly passes
decide one more count (one stream draw). The render cost can only fall (fewer layers). `perf.py` rows (legacy fixtures)
unchanged; the gen-1 speed tests of 1.9 cover it.

### 3.10 Risks and open questions

- **Cap level**: `3 + round(3·pace)` trims decorations mostly (A.1). If QA finds calm moods bare, raise the base to
  `4 + round(2·pace)` (trims ≤ 5 % of cuts; A.1 variant).
- **Lettering block and theme styles**: a glow theme loses the glowing entrances (bloomOpen) in automatic picks. That is
  the rule the owner asked for; a user who wants it pins the entrance or turns 「効果を重ねすぎない」 off.
- **Browser tests**: 0.6.
- Open: should a transition be allowed on a cut still over its cap when it is the first cut of a chorus (サビ頭)? The
  design says no (the budget wins) unless the background changes.

### 3.11 Interactions with other packages

- **P3 キメ**: T5 skips キメ cuts in trimming and the seam gate (`kimeAt(cut) = !!(cut.kime || (cut.feat && cut.feat.kime))`,
  already inside `featId`); P3's own count caps (`kime.count`, ≤ 1 decoration, ≤ 1 screen effect + the impact one) are
  its autoFn and run first. The lettering block applies inside P3's restricted sets with the fallback, so P3's set is
  never emptied. P3 has no `kime` pin.
- **EXTREME**: cap + 1, an EXTREME move counts 2, never changed.
- **P4**: a pinned `glyphMorph` seam is never gated; P4's automatic morph seams pass `exempt: true` to `seamGate` (they
  replace the exit and entrance, they add nothing). P4's weight animation adds the `wt` letter channel (3.4 d).
- **P1**: the block looks at `text.style` and motion channels only; P1's size and spacing changes are not effects.
- **P6 歌ハメ**: its entrance (typeOn/'sung') has no glyph channel; no interaction.

---

## 4. Package summary

### 4.1 Files

New: `src/planner/rules.js` (~150), `src/planner/arc.js` (~200), `src/planner/kit.js` (~170), `src/planner/flow.js`
(~280 phase A, +120 phase C), `src/planner/fxcap.js` (~200), `src/planner/conventions.js` (~200); tests
`tests/node/pv_rules.test.js` (~250), `section_kit.test.js` (~340), `pv_flow.test.js` (~420 + ~150 phase C),
`fx_cap.test.js` (~320); golden `tests/golden/project_pv.json`.

Changed: `core/doc.js` (~25), `core/commands.js` (~10), `core/shot.js` (~50, phase C), `planner/choose.js` (~35),
`planner/cast.js` (~130), `planner/camera.js` (~30 + ~30 phase C), `planner/tracks.js` (~50), `planner/extreme.js`
(~10, phase C), `planner/plan.js` (~35), `planner/explain.js` (~50), `planner/fields.js` (~65), `ui/fields.js` (~40),
`ui/inspector.js` (~95), `ui/widgets.js` (~8), `ui/ai_review.js` (2, phase C), `ui/lab.js` (2, phase C), `ai/direct.js`
(~4), `ui/boot.js` (1), `ui/project_io.js` (2), `i18n/strings.js` (~55), `tests/update_golden.js` (~25), updates to 11
existing test files (~300), `tests/browser/ui_flows.py` (~140), `docs/NOTES.md` and a DESIGN addendum (below).

### 4.2 FROZEN contracts touched

- `core/shot` grammar (phase C): **extended** (not changed): `'driftOff~m'` and `'tiltHold~m'` become valid ShotRefs, by
  the same `'~m'` suffix EXTREME uses. `SHOT_KEYS`, `MIRRORS`, `XSHOT_KEYS` unchanged. DESIGN_2_1 §4.5 needs a sentence,
  §14.2 and the §8 sentence at line 5818 an exception.
- Decision `pfrom` gains the value `'alt'` (the typedef `Object<string, string>` in `core/types.js:261` already allows
  it; document it next to `'rule'`).
- `planner/cast` history rows gain `dir`; `ROW_FIELDS`/`INPUT_FIELDS` gain entries (internal, not FROZEN).
- The chooser formula (DESIGN §4.16.4) gains three optional terms, active only under the rules: the pv factor in the
  static part, the recency relax for kit members, and the lettering block with its fallback. Document them in the
  addendum.
- The FROZEN slot order (§4.16.2), POSE columns, the seam mix contract and the SCH enums are **not** touched.

### 4.3 Documentation

A new chapter "文字PVの定石" in the PV22 design addendum (the lead's choice: DESIGN_2_1 §15 or a new
`docs/DESIGN_2_2.md`), with: the switch table (0.1), the marker and the merged new-document API (0.2), parts and drive
(0.4), M1 (1.4), M2 (2.4), T5 (3.4), the `'alt'` marker, and the chooser formula amendment. `docs/SPEC.md`: a paragraph
in 作品全体 › 見た目. `docs/NOTES.md`: the measurements of Appendix A, the G0 browser results, the T5 reduction table on
the implementation, and the visual-QA results.

### 4.4 Implementation order

0. **G0** (0.6): probe app with `newDoc()` at boot, run the browser suites, record failures.
1. Phase A: `core/doc` (marker, newDoc) + `planner/rules` + `ctx.rules` + UI rows (auto note line, number placeholder) +
   the three call sites + `pv_rules.test.js` items 1–4, 6 (everything off still byte-identical).
2. `repeat.same` default (M1 a) incl. `ai/direct` + its tests; `flow_repeat_legacy` / `flow_repeat_new`.
3. `planner/arc` parts (content keys) and drive (no behaviour yet) + `plan.pv`.
4. M1 kit (`planner/kit`, chooser factor/relax, cast/tracks hooks, 区画 UI).
5. M2 arc, then directions (cast flips with `'alt'`, rows, lock/copy/explain/fields handling), seams.
6. Phase A: `project_pv.json`, gen-1 variants of the stability, re-plan and speed tests, browser flows, visual QA
   (contact sheets of chorus vs verse, alternation strips of flipped exits and one-word entrances), NOTES, G0 rerun.
7. Phase B: T5 lettering block, then trimming and the seam gate; `fx_cap.test.js`; the NOTES reduction table;
   `project_pv.json` regenerated; G0 rerun.
8. Phase C (may be deferred): `core/shot` mirrors + labels at every call site + overlay, zoom, EXTREME mirror; shot
   grammar docs; `project_pv.json` regenerated; G0 rerun.

---

## Appendix A. Measurements (read-only probes, `scratchpad/pv22/probe/`)

### A.1 Effect load and T5 (`probe/p2r/t5v2.js`, `t5v4.js`; basic, long, lrc, vertical × 3 seeds × 16:9/9:16; catalog)

Load today (`probe/load.js`, decorations + screen effects + moving lens + camera shot + transition in + loud motion +
impulses): moving lens texture in 82–92 % of cuts, the camera shot in 45–57 %; mean load 3.1 (quietHush) – 4.5
(glitchFracture).

The revised T5 cut budget (cap `3 + round(3·pace)`, impact +1 with the hit counted as 1, decorations first then screen
effects, transitions only where the cut is still over its cap, impulses never), applied to legacy plans (upper bound):

| mood | cap | cuts trimmed | decorations (all / cuts ≤ cap+1) | screen effects (all / ≤ cap+1) | transitions | impulses | cuts above cap |
|---|---|---|---|---|---|---|---|
| dashSprint | 6 | 1 % | −1 % / −1 % | 0 % / 0 % | 0 % | 0 % | 3 % → 1 % |
| dreamHaze | 4 | 15 % | −13 % / −10 % | −4 % / 0 % | 0 % | 0 % | 23 % → 11 % |
| glitchFracture | 5 | 9 % | −8 % / −6 % | 0 % / 0 % | 0 % | 0 % | 17 % → 10 % |
| heartAche | 4 | 11 % | −11 % / −8 % | −6 % / 0 % | 0 % | 0 % | 19 % → 10 % |
| popFizz | 5 | 8 % | −5 % / −4 % | 0 % / 0 % | 0 % | 0 % | 16 % → 9 % |
| printColumn | 4 | 16 % | −14 % / −10 % | −4 % / 0 % | 0 % | 0 % | 22 % → 8 % |
| quietHush | 4 | 5 % | −6 % / −6 % | −2 % / 0 % | 0 % | 0 % | 10 % → 5 % |
| silverReel | 4 | 13 % | −16 % / −14 % | −1 % / 0 % | 0 % | 0 % | 21 % → 13 % |

Variants measured: screen effects first → effects −31 % (popFizz) to −45 % (printColumn), rejected; gating every
transition at the cap → transitions −24 … −45 %, rejected; base `4 + round(2·pace)` → at most 8 % of cuts trimmed,
decorations ≤ −5 % (the fallback of 3.10). The design of revision 1 (reserving the camera up front, trimming impulses,
gating all seams) removed 22–40 % of transitions and 35–60 % of impact impulses (critic's probe), hence this revision.

### A.2 Kit signature (`probe/p2r/kit6.js`, `kit7.js`; basic, long, repeat × 4 seeds × 16:9/9:16 × 4 moods; part keys by section kind, energy-fit selection, relax; no arc, T5 or KIT_AVOID)

| setting | top-2 family coverage per part: arrange / arrive / dwell / depart / lens | repeat family match (repeat.same off): arrange / arrive / depart | adjacent identical: dwell / depart / lens |
|---|---|---|---|
| no kit | 35 / 28 / 47 / 46 / 47 % | 19 / 15 / 20 % | 2.1 / 9.3 / 1.3 % |
| KIT 4, relax | 54 / 47 / 72 / 55 / 65 % | — | 2.5 / 8.9 / 2.1 % |
| KIT 4, primary 8 | 60 / 51 / 75 / 57 / 68 % | — | 3.5 / 8.8 / 3.0 % |
| **KIT 8, primary 16 (chosen)** | **67 / 60 / 82 / 59 / 74 %** | **33 / 30 / 26 %** | 4.9 / 8.9 / 4.8 % (KIT_AVOID brings dwell and lens back) |
| near-filter (×1000) | 80 / 76 / 96 / 66 / 97 % | — | 10.6 / 9.9 / 23.9 % |

(Arrange and arrive adjacency stays 0 % in every row: the §8.2 avoid.) The implementation re-measures with the full
design (arc, lettering block, KIT_AVOID) and sets the test floors of 1.7 item 3 from that measurement.

### A.3 Arc factor (`probe/arc.js`; basic, repeat × 6 seeds × 2 aspects × 6 moods)

| share of strong picks | verse off → on | chorus off → on |
|---|---|---|
| entrances | 39 % → 33 % | 42 % → 51 % |
| layouts | 30 % → 25 % | 35 % → 47 % |
| exits | 34 % → 30 % | 42 % → 50 % |

(Without the blended energy; the blend adds to it.)

### A.4 Glyph channels (`probe/chans.js`): source scan of the motion parts; `K.moves` parts read from `def.motion.tracks`,
`perGlyph` parts by the channel names their functions use. Basis of the initial `GLYPH` table (3.4 e).

### A.5 Sideways text motion (`probe/p2r/words.js`, `autos.js`, `skew2.js`; corpus(3) × 4 docs × 2 aspects, catalog)

1 811 lyric cuts (1 252 horizontal); 48 % have one word (`feat.words === 1`), 98 % at most two. `skewSlide` is the
entrance of 88 cuts, 40 of them one-word; sideways exits (`windBlow`, `skewExit`) 158. Autos: `skewSlide` xFrom 2.4 em,
kxFrom −50, order `lead`, unit word; `skewExit` xTo −2.6, kxTo 40, order `lead`; `windBlow` dir `left` (fixed auto),
order `sweepX`; `twirlArrive/Depart` dir cw/ccw/alt 2:1:1; `panSweep` right/left/down/up 3:3:1:1.

---

## Critique log (revision 2)

| # | severity | issue | verdict | how it was handled |
|---|---|---|---|---|
| 1 | blocker | `alignments` reads `ctx.rules.repeatDefault`; `ai/direct.followSources` (`direct.js:1254`, called at :1346) and `repeat_same.test.js` (35, 113, 137) pass `{ ix }` only | valid | 1.4 (a): `def = ctx.rules ? ctx.rules.repeatDefault : RU.repeatDefault(ctx.doc, ctx.ix)` (false without doc); `ai/direct` passes `doc: run.doc`; cast imports `planner/rules` (0.3); new ai_direct case and a kept `{ ix }` stub case (1.7). |
| 2 | major | flips written with pfrom `'rule'` are skipped by `putParams` (`fields.js:567`), so a lock does not freeze them; `'rule'` explains as `speed` (`explain.js:215`); P3's `'rule'` anchor would be labelled as P2's | valid | New marker `'alt'` (2.3): locks pin it, `copyParams` treats it like `'rule'`, explain maps it to `pv.alt`, fields keep it `auto`. Partly rejected: the critic's "map `'alt'` to `derived`" — `derived` makes the row read-only (`inspector.js:443`), which would stop the user pinning 向き; it stays `auto`. Test 2.7-6. |
| 3 | major | the flip coin ignores parameter salts, so the 向き die does nothing | valid | `flipParams` treats a salted parameter as fixed (2.4 b); test 2.7-7 (≥ 40 % of 200 salts change the value; mutation < 15 %). |
| 4 | major | the echo branch reads `echoRow.dir` and the mirror overlay the source's final shot, both salted, so a reroll of a first copy turns its repeats | valid | Removed the echo rule for directions and mirrors (2.4 b, d): aligned copies follow the source as the Plan shows it (the §4.10 rule, which includes rerolls); non-aligned repeats alternate by their own neighbours. No salt reaches a repeat through the repeat relation, and `TWIN_FIELDS` need no `dir` (twin rows hold part values only). Test 2.7-11 in `planner_stability`. |
| 5 | major | ordinal pseudo keys `g1, g2…` (and `verse1…`) move with inserts and move salts | valid | Content keys (0.4): `'b' + rowId` of the group's earliest block, `'h' + rowId` of a 番 heading, analysis ordinal only for analysis sections; row ids are stable (`commands.js:169`, `reconcile.js:315`). Tests 1.7 section_kit 2 (a–e). The critic's text-hash key was not taken: a row id also survives typo fixes in the first line. |
| 6 | major | T5 far stronger than claimed (transitions −22…−40 %, impulses −35…−60 %, silverReel decorations −42 %) | valid | T5 redesigned (3.4): no camera reservation, trimming after the camera, decorations then effects above the film keep and the impact extra, impulses never, world seams never, other seams only on cuts still over the cap. Re-measured (A.1): decorations ≤ −16 % (≤ −14 % on cuts ≤ cap+1), effects ≤ −6 %, transitions and impulses 0 %. Acceptance ≤ 15 % per element on cuts ≤ cap+1 and the catalog mood checks on gen-1 (3.7-4, 3.7-5). |
| 7 | major | a pinned cap of 2–3 cannot be kept | valid | Range 4–8 and the row is a guide: 「1カットに重ねる効果の目安」 with a note that only decorations and effects are reduced (0.1, 3.3, 3.6); the invariant states the floor case; test 3.7-3 over 4–8. |
| 8 | major | the lettering rule is soft (×0.2…) and beaten by KIT/ECHO/IMPACT; "never" was false | valid | Hard block with a fallback only when the whole pool clashes (3.4 d, `choose.pick`); `'wt'` channel for P4; test 3.7-1 asserts "never" except all-clash pools. The lettering is now T5's primary layer; the cut budget is secondary. |
| 9 | major | the still-lens factor pushes to `fixedFrame`, which lifts the camera's `none` bias and widens EXTREME's pool | valid | Removed the lens and shot factors entirely: T5 no longer steers the lens or the camera. A framing lens counts as the camera move in the load (3.4 a). Test 3.7-7 rewritten as the critic proposed (same move where the parts are the same; EXTREME count does not drop). |
| 10 | major | `flow_repeat` fails on gen-1 `?fresh=1`; the check list was wrong | valid | 0.6: G0 gate with a probe app before merging; `flow_repeat` split into legacy and new flows with exact assertions; fix rule for other flows. The wrong check-list line numbers were removed. |
| 11 | major | P3's キメ is a row mark (`cut.kime` / `feat.kime`), not a pin; P3 uses `req.only`; the note promised 「キメは2つ多く」 | valid | `kimeAt(cut) = !!(cut.kime || (cut.feat && cut.feat.kime))` (0.3); kit/arc multiply inside P3's set, the block keeps the fallback, T5 trimming skips キメ and P3's caps run first (1.11, 3.11); note reworded 「キメの行は別の決まりに従います」; the キメ allowance in the cap was dropped. |
| 12 | major | P1 `newWorkDoc()` pins vs P2/P4 marker | valid | 0.2: one `D.newDoc()` writing only `look.gen`; P1's strengths as independent `planner/rules` rows `work pin ?? (gen ≥ 1 ? 0.5 : 0)`; P4/P6 rows listed; `D.newDoc().pins` is `{}` (test 1.7 pv_rules 1). Stated for the lead. |
| 13 | major | text entrances never alternate sides | partly valid | Exits now alternate with the order coupled so words never fly over waiting ones (`windBlow` + `sweepX→tail`, `skewExit` + `lead→tail`; the part's own comment at `drift.js:5–8` shows why the coupling is needed). `skewSlide` flips its x and skew together on one-word horizontal cuts (48 % of cuts are one word, A.5), where there is no stagger. The critic's guard "cells ≤ 12 or dur ≥ 1.2 s" was not taken: the problem is the word stagger, not length (`advancing` keeps words clear only in the designed direction). Longer cuts keep the reading side, said in 2.1 and in the switch note. Tests 2.7-2 (engine signs, no fly-over), 2.7-3 (entrances alone), 2.7-4. |
| 14 | major | kit effect near noise; A.2 did not model the design; dwell threshold contradicted the baseline | valid | Stronger signature: `KIT = 8`, `KIT_PRIMARY = 16` on the top family per kind (1.4 c). Re-measured with part keys and energy fit (A.2): entrance top-2 coverage 28 → 60 %, repeat entrance family match 15 → 30 %. Tests use a perceptible metric with on − off margins and floors from the implementation's measurement; the dwell contradiction is gone (adjacency tested against the legacy rate). The critic's ≥ 70 % entrance target was not adopted: only a near-filter reaches it, and that repeats holds and lenses back to back (A.2). |
| 15 | minor | `autoText` is never rendered; the number widget shows only 「自動」 | valid | `ui/inspector` note line `p.fr-auto` for `fs.autoText`; number placeholder from `autoText` (1.5); ui_fields and ui_flows assertions (1.7). |
| 16 | minor | mirrored normal shots missed in `ai_review.js:341`, `direct.js:323`, `lab.js:148`, `shot.test.js:233`, DESIGN_2_1 | valid | Every call site listed with its change (2.5 phase C); docs sentences named. |
| 17 | minor | zoom factor damps pushWord on emphasised cuts; side flips on vertical text | valid | Zoom factor skips `emph` cuts (2.4 e); all text-side entries guarded `orient h` (2.4 a). |
| 18 | minor | stub contexts (`camera_planner` `st`, `extreme_planner.test.js:203`) and the `featOf` memo | valid | Guards `st.feat || st.cut.feat`, `ctx.rules && ctx.rules.alt`; memo only when cached (0.3, 2.4 f, 2.4 g). |
| 19 | minor | `project_pv.json` churns when P1/P4 land | valid | `OTHER_OFF` pins in `update_golden.js`, regenerated per phase and once at integration if needed (1.8). |
| 20 | minor | `area.block` duplicates `area.para`; `whyRule.pv.newDoc` unused; WHY_CODES | valid | `area.para` reused, `whyRule.pv.newDoc` dropped, all new why codes added to `WHY_CODES` (1.6). |
| 21 | minor | scope | valid | Three gated phases (0.5); phase C (shot grammar, zoom, EXTREME alternation) deferrable; T5 reduced from seven mechanisms to three (block, trim, narrow seam gate). |
