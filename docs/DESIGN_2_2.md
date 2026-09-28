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

## 4. 文字の形が動く: モーフ (M4) and 太さの動き (M5)

**What existed.** Eleven transitions (§5.9) mixed two finished pictures of the old and the new line; no transition knew
which letters the lines share. Weight was a property of the typeface (`face.*.weight`, the theme's faces); no part could
change it over time, and a cut could not choose its own weight. v2.2 adds a transition that carries the shared letters
from line to line (M4) and a weight that moves (M5), both behind the generation marker of §0.

### 4.1 Contracts touched

| Contract | Change | Compatibility |
|---|---|---|
| Registry fields (D§4.18.1) | `late: true` (added after v2.1; `pool: false`, never the fallback) and `optIn: 'weight'` (a `pool: false` part that joins `registry.pool(kind, { optIn: ['weight'] })`) | Late definitions are signed apart: `registry.version` stays `83c7523d`, so every fingerprint, plan hash and golden is unchanged; `registry.lateVersion` signs them and appears only in `tests/golden/project_glyph.json`. Late parts are never material bases. Every PV22 package that adds a part marks it late. |
| Seam contract (D§4.18.2) | Optional `glyphs: true` (scope `text`), `share` (0, 0.5], `ends: true` | Absent on every v2.1 seam; `mix(fx, a, b, u, p)` unchanged. |
| Plan §3.12 (FROZEN shape) | A glyph seam's entry holds `glyphs: [[aOff, bOff, same], …]`; its own A gets `b = min(b, at + dur/2)` with no `t1` floor (the hand-over) | Only glyph seams take either; no v2.1 plan has one. |
| NodeTable POSE (D§4.17.1, FROZEN) | Column 23 `wt` (weight offset in CSS weight units, ADD, identity 0, not clamped at solve); `table.SCHEMA` 2 | Appended; every existing index is unchanged. The draw path reads it only when ≠ 0. |
| Behaviours and kit (D§4.17.4, §4.18.3) | Optional `behaviour.wt: [lo, hi]`; `K.perGlyph(fn, { prep, wt })`, `K.perGlyphHold(fn, { prep, wt })` (kept through `K.depart`'s re-wrap, `K.mirror`, `K.variant`); `K.weightRoom(target)`; the kit's DELTA gains `wt` | One-argument calls build exactly the v2.1 behaviours (tested on the catalog). |
| Glyph drawing (D§4.19.5, FROZEN rule) | A glyph with `wt ≠ 0` draws the two served weights around face weight + `wt` (the heavier at a·f, the lighter over it at a(1 − f)/(1 − a·f)); plain and glow lettering only, outline/shadow/duo take the nearest weight | The path choice is unchanged (only blur, glow, shard and pixel choose it); `wt = 0` makes the v2.1 calls in the v2.1 order. |
| FontBook (D§4.14) | Draw-only faces: `request/ready(…, { drawOnly: true })`, `drawStatus(ref)`, `on('draw')` | They never move `epoch`, never make a scene provisional and never redeclare a weight the main path owns. |
| Frame order (D§4.19.2 step 4) | During a glyph seam the travelling letters are drawn after the composite of both sides: above both cuts' text and near layers, below the still pass, the grounds' near layer and the hud; the cuts' own base layers (far, mid) are drawn into the two sides under their text layers, so they melt with the rest (for the window above the grounds' mid and text layers) | Only glyph seams. |

### 4.2 モーフ (M4)

- **The part.** 切り替え「モーフ」 `glyphMorph` (`late`, `pool: false`, `glyphs`, `share` 0.5, `ends`, replaces both the
  old line's exit and the new line's entrance). Params 長さ, 弧, ずらし, ちがう字 (溶けて変わる / その場で消える), ぼかし.
- **Shared letters** (`planner/morph`). Letter units are the graphemes of the classes han, hira, kata, smallKana, hangul,
  latin, digit, fullLatin and emoji (spaces, punctuation and symbols melt), the first 64 of each line, weighted 3 (kanji,
  katakana, hangul, emoji), 2 (Latin, digits), 1 (kana). A weighted LCS with a run bonus, ties broken by the drift from
  the diagonal, gives the anchors; runs of 3+, of 2 with a non-kana, or one strong letter are kept; between kept anchors
  the letters pair up in reading order where the gap is about the same size (a swap: the letter melts while travelling).
  `pairsOf` → `[[aOff, bOff, same], …]` (≤ 64); `analyze(...).meaningful` = m ≥ 2 and a 2-run, or m ≥ 0.4 of the
  shorter line. One 256-entry LRU.
- **The rule.** In `planner/tracks.decideSeam`'s unpinned branch, before the chance roll (order: P3 キメ hard cut → P4
  morph → P2 effect gate → chance), `glyphMorph` is chosen (`from: 'rule'`, why `whyRule.morph`) where 「同じ字をつなぐ」
  (`morph.auto`) resolves on at the boundary (a line pin only where A and B are different lines, else the work value),
  A and B are lyric/focus cuts of one background, `A.t1 ≤ B.t0`, neither A's exit nor B's entrance is the user's choice,
  no `motion: 'own'` arrange or knockout is on either side, the hooks `cut.kime`, `ctx.uta.at(cut)` and
  `ctx.pv.seamGate(B)` allow it, there is room for a window of 0.25 s at least (below), no die was pressed on the
  transition into B (a seam salt of B's cut or line: the rule stands aside and the chance roll picks another transition),
  and the letters are meaningful. Older works read one boolean per boundary.
- **Window and hand-over.** `dur ≤ 0.5 · min(A.b − A.a, B.b − B.a)` (automatic 0.4–0.7 s); the window ends as the new
  line's voice starts — `[B.t0 − dur, B.t0]`, or `[B.a, B.a + dur]` when `dur` is shorter than B's lead — and starts
  inside A, after the previous transition's window and no earlier than 0.5 s before A's sung end (`tracks.seamWindow`;
  that last bound never cuts it below 0.25 s). So the old line's letters stand still while most of it is sung, and a
  changed letter keeps its full strength until about the middle of its own clock (the swap melts over k ∈ [0.45, 0.85]
  for the old letter, [0.55, 0.95] for the new; the rest of the old line fades over u ∈ [0.3, 0.8]). A ends with the
  window even before its sung end, so after the window only the new line is on screen. (The design had `[B.a − dur,
  B.a]` with up to 0.9 s: the owner review measured the morph taking 53–70 % of short lines' sung time and melting a
  letter while it was sung.)
  Replacing B's entrance also drops a `text.weight` the grow rule set there. `seamOf`'s memo keeps `prev` (the guards'
  result and both texts) so a re-plan equals a plan from scratch; 「くり返しの行をそろえる」 copies a rule-picked morph only
  where the rule holds at the copy.
- **The renderer** (`engine/render/morph`). Each pair resolves to the glyph node that stands for the letter (runs that
  read the cut's text, in an eligible layer — text or near, opacity 1, source-over, unfiltered, unmasked, not a mask
  source — the most opaque copy). The matched glyphs are left out of the two side surfaces (a skip mask), `mix` melts
  the rest, and each pair is drawn on the frame with its device transform interpolated from A's glyph to B's (short-arc
  rotation, log scales, a mirror through zero, the shear ratio, a bow of `arc`), staggered by `spread`: alike pairs draw
  once, other equal letters crossfade, swaps melt (the old one softens and fades as the new one sharpens). Picks go to B.
- **UI.** 作品全体 › 見た目 › 詳しい設定 「同じ字をつなぐ」 (on in new works); 行 › 演出 › 詳しい設定 「前の行から字をつなぐ」
  [自動 | つなぐ | つながない] (not on the song's first line; its note says that つなぐ needs a shared word of two or more
  letters and one background, and that choosing モーフ as the transition always links); the 切り替え row says
  「モーフの間に前の行の字は次の行へ渡され、モーフが終わると前の行は消えます。」 when it holds a glyph seam; the part browser
  tile shows 「青い空」→「あの青い海」 (BLUE SKY → A DEEP BLUE SEA), so the shared letters visibly travel.
- **Measured.** Over `corpus(2, ['16:9'])` with the marker, 3 of 510 same-background lyric boundaries get the morph
  (0.6 %): rare by design.

### 4.3 太さの動き (M5)

- **Parts** (all `late`, `pool: false`, `optIn: 'weight'`): 入り「太字へ」 `weightGrow` (letters appear thin and grow to
  the line's weight; 始まりの細さ), 見せ「脈打つ太さ」 `weightPulse` (the weight swells on every beat — a 30 ms rise, an
  exponential fall, back to rest before the next beat — or breathes on a cosine without a beat grid; 振れ幅, 戻り, 周期),
  抜け「細字へ」 `weightThin` (letters thin out and fade; 終わりの細さ). Their reach is read from the line's face at build
  (`K.weightRoom`).
- **Ladders** (`engine/text/faces`): `ladderOf`, `atWeight`, `weightPair`, `roomOf`, `growTop` (the heaviest served weight
  ≤ 800), `rungsBetween`, `reweigh`. Only the served static weights of the family are drawn (no variable fonts, no
  stroke emboldening); an unknown family has one weight and never animates.
- **Planner.** Where 「太さを動かす」 (`weight.auto`) is on, a lyric/focus cut whose lettering is plain or glow and whose
  face has room (太字へ: 300 from the lightest weight to its end weight; 細字へ: 300 below; 脈打つ太さ: 200 either way) draws
  its motions from the opt-in pools. `text.weight` (100–900) is a pin (cut > line > work), else set by the **grow rule**:
  an entrance with 太字へ and no 太さ pin ends at `growTop` (`from: 'rule'`, why `whyRule.weight.grow`), so the line really
  goes thin → bold. Warnings `weight-flat` (too few weights) and `weight-style` (outline, shadow or duo: steps) for a
  pinned or ruled weight part. Rates over the corpus with the marker: 太字へ on 10.4 % of the eligible lyric cuts (weight
  2.5), 脈打つ太さ on about 4 % (weight 0.5), 細字へ on 3.3 % (weight 1). A weight warning carries the cut's motion slot as
  its `path`, so the inspector shows it as a note under that 入り/見せ/抜け row and under 太さ, and the lyric gutter marks
  the line. 脈打つ太さ's automatic swing is 300–400 (×0.7–1 by 強さ, capped by the room): two rungs or more.
- **Fonts.** The weights a motion passes through are draw-only faces (§4.1): requested when a scene with `wtReach` is
  built, drawn once loaded (the nearest loaded weight or the face's own until then), waited for by export.
- **UI.** 作品全体 › 見た目 › 詳しい設定 「字の太さを動かす」 (on in new works); 「太さ」 rows (自動 / 100–900) under 行 ›
  色と書体, 複数行 › 色と書体 and カット › 文字 — in 自動 the knob and the box show the weight the lyrics are drawn at (e.g.
  「自動 600」); the part browser tiles show the parts on the body face at 800, and their blurbs say they need a typeface
  with many weights. The parts were first named 太る and 細る; the owner review found 太る reads as "to put on weight", so
  they are 「太字へ」 and 「細字へ」.

### 4.4 New works and older works

`morph.auto` (work and line) and `weight.auto` (work) are rows of `planner/rules`: on for a document of generation ≥ 1,
off for every other, a pin always wins; `ctx.glyph = { morph, weight, maybeMorph, id }` enters the cast key only when it
is not `g00`, so an older document plans exactly as before. The three late parts and モーフ can be pinned in any work.

### 4.5 Goldens, tests, performance

- The six existing goldens are byte-identical. The new `tests/golden/project_glyph.json` holds two new works
  (`tests/helpers/glyph_docs.js`): four line pairs that share letters (one vertical → horizontal, one into another face)
  and a pinned モーフ with no meaningful anchors; and 太字へ with 太さ pinned, 太字へ taking the grow rule, 脈打つ太さ, 細字へ and
  太字へ on outline lettering, each at 40 frames (32 even times and 8 inside the morphs and weight motions); its registry
  block carries `lateVersion`.
- Node: `morph_plan`, `morph_render`, `weight` (plus extensions of registry, frame, conformance with the `wt` jump limit
  60 per 1/480 s, planner_determinism, repeat_same, planner_explain, fields, ui_fields, lens_filter_seam, facade tests).
  Browser: glyph_parity (weight pairs at f = 0.5 and 0.75 within 2/255), parts_gallery (the four tiles animate),
  contact_sheet `--doc morph|weight` (frame strips for visual QA), perf rows `glyph-morph` and `glyph-weight` with a
  same-run A/B (p95 ≤ 1.25 × the document with every glyph seam as a dissolve / every weight part as a comparable part),
  ui_flows `weight`, `morph`, `morph_old`.

### 4.6 Limits

Trail filters (`fx.textAt`) redraw both sides at rest without travellers; an overfull run's clip does not clip its
travellers; for the window the cuts' base layers lie above the grounds' mid and text layers (they are mixed with their
lines); letters in an ineligible layer melt instead of travelling. No automatic モーフ can appear in the first-run sample
lyrics (their line boundaries share no word; a request to the lead). Locking a line whose motion a seam replaced can still
change an aligned copy's parameters (a v2.1 behaviour of `replaceMotion`, see NOTES). A weight
between two served weights is a composite, exact only for a single solid fill (hence the steps for outline, shadow and
duo); single-weight faces (most 見出し faces) cannot animate; a family that failed to load draws the fallback stack.

<!-- PV22 P5 chapter -->

<!-- PV22 P6 chapter -->
