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

## 1. 文字組み (T1, T2, T3): how a lyric line is set

Three properties of how a text run is set: T1 かなを詰める (kana cells narrower than 1 em, so a word reads as one block),
T2 助詞を小さく・頭の字を大きく (particles smaller, the line's first letter larger) and T3 英字を少し大きく・和文との間を
あける (Latin words in a Japanese line a little larger, a little space where they meet Japanese). They share one data
model, one gate, one engine entry point and one module, `engine/text/kumi` (L1, metric-free, used only by
`engine/text/layout` and `engine/text/service`; not in `build.py PLANNER_TEXT`).

### 1.1 Decisions

| Question | Decision |
|---|---|
| Settings | Four slots, pinned at work or line scope, never at a cut: `text.kana`, `text.jump`, `text.latin` (numbers 0–1 in steps of 0.05, 0 = off) and `text.head` (`'line' \| 'phrase' \| 'none'`). No document field. |
| Gate | §0: rows of `planner/rules`. `look.gen ≥ 1`: 0.7 / 0.5 / 0.5; older works 0 / 0 / 0; `text.head` `'line'` in both. Nothing is written into `doc.pins`; 固定を外す returns to the document's default. |
| Existing documents | No marker and no pin: no decision, no `RunSpec.kumi`, identical layouts and frames. Every golden of §0 is byte-identical. |
| Resolution | Line pin, else work pin, else the default (`ctx.kumi`); a cut pin never applies (`core/commands NOT_CUT`). A decision is written only where the value is on, so a setting that is off leaves no trace in the plan. |
| Engine entry | `scene/build.buildCutWith` derives the cut's text service once (P4's `withFaces` step, then `withKumi(kumi)`); that one service goes to the builder, `env.text`, `env.faces` and the scene. |
| AI | Not involved: the AI tools neither read nor write the four slots. |

### 1.2 Data model

- `planner/rules` rows (`scopes ['work', 'line']`): `text.kana` on 0.7, `text.jump` on 0.5, `text.latin` on 0.5 (spec
  `{ num 0–1 step 0.05 }`, off 0), `text.head` (enum, on = off = `'line'`, so it has no new-work default text).
- Plan: `cut.slots['text.kana' | 'text.jump' | 'text.latin'] = { v, from: 'pin:line' | 'pin:work' | 'auto' }` when on
  (the automatic decisions are interned); `text.head` only when a head pin resolves on a cut whose `text.jump` is on.
  `encode` fingerprints `cut.slots`, so `cut.fp`, the scene cache and the plan hash follow. No `plan.v` change.
- **RunSpec (D§4.15.4, FROZEN, additive):** optional `kumi: { kana, jump, head, latin } | null`. Absent, `null` or all
  three strengths 0 = today's layout. The text service merges the cut's setting into a spec (`KU.withCut`) unless the
  spec sets `kumi` itself (`null` = plain; an object = a partial override such as `{ jump: 0 }`) or sets `tracking` (a
  part that controls its own spacing).
- **RunLayout (additive):** `kumi: Uint8Array | null`, one role per grapheme: 0 plain, 1 particle, 2 head, 3 Latin.
- **TextService (additive):** `LAYOUT_FIELDS` ends with `'kumi'` (`specKey` keys it by its normalized value and leaves
  out a setting that is off, so every earlier key is unchanged); `createTextService({ …, kumi })`; `withKumi(k)`
  memoised per value (≤ 16 per service, sharing the layout LRU; the service itself for its own value); getter `kumi`;
  `withFaces` keeps it. `withKumi` is part of the contract and is called without a guard.
- Parts that set their own sizes or pitch opt out through `K.kumiFor(env, over)` (written only when the cut is set with
  typesetting, so older RunSpecs stay identical objects): giantWhisper (4 sites), confettiWords and magazineHead take
  `{ jump: 0 }`; gridMosaic cells take `null`; haloRing and gridMosaic lines set `tracking`.

### 1.3 T1 かなを詰める

Per grapheme of a run with `kumi.kana = s > 0`, `tier(u, i, column)`:

| tier | graphemes | trim at s = 1 (em) | cell at 100 % / 70 % |
|---|---|---|---|
| `wide` | あおすせなぬねのはひふへほまみむめやゆわゐゑを かれルハヱゟ, every voiced kana (が ぱ ヴ), and in a vertical column also the narrow kana | 0.06 | 0.94 / 0.958 |
| `kana` | the other full-width hiragana and katakana | 0.12 | 0.88 / 0.916 |
| `narrow` | くぐしじりノトドリ across a horizontal line (narrow wins over voiced) | 0.26 | 0.74 / 0.818 |
| `small` | small kana | 0.20 | 0.80 / 0.86 |
| `bar` | ー | 0.08 | 0.92 / 0.944 |
| none | kanji, Latin, digits, punctuation, halfwidth kana, ・ 々, the spacing marks ゛ ゜ | 0 | 1 |

- `trim = s × TRIM[tier] × FLAVOR_DAMP[flavor] × (weight ≥ 800 ? 0.8 : 1)`, `FLAVOR_DAMP = { heavy: 0.15, brush: 0.8 }`
  (read from the run's layout face, never an animated weight); `cap = 1 − trim`; `along = min(natural, cap) × k`, so a
  proportional face is never tightened twice and emphasis multiplies the capped cell.
- Word seams (Japanese only): at a phrase start of the run and right after a particle of the source text, the two kana
  at the seam keep half their trim (`BOUNDARY = 0.5`); never next to a space. The glyph stays centred in its cell.
- The table is the tightest one at which two neighbours' inks do not meet (§1.9 ink check). At 100 % the slider means
  "as tight as the ink allows".
- Worked numbers (fake measurer, size 100): 「夜明けのまち」 at 0.7: x 50, 150, 245.8, 340.55, 438.45, 533.2, w 100, 100,
  91.6, 97.9, 97.9, 91.6, width 579 (600 plain; の is a particle, so の|ま is a seam). 「ショートケーキ」 at 1: 88, 80, 92,
  74, 88, 92, 88 (ト 94 in a column), width 602 (700). 「きみのこえがきこえた」 at 0.7: width 941.2 (1000).

### 1.4 T2 助詞を小さく・頭の字を大きく

- Marks are read on the whole cut text (`KU.marks(cutText, 'ja', head)`, memoised; the run's graphemes map to it by
  offset), so a run split from the line is set like the same graphemes inside the whole-line run. Japanese runs only;
  never runs with their own text (notes, headings, labels, the title card).
- Particles: the tagger v6 (frozen tables in the module): は が を に で と へ も の, から まで より and their stacked pairs,
  after content, a known kana word, a kanji word with short okurigana or another particle it stacks with; vetoes for
  verb and adverb endings, copulas, suffixes and compounds. Precision 100 % and recall 74–92 % on every labelled set
  (docs/NOTES); a missed particle stays 1×, a wrong line is set to 使わない.
- Heads: 行の頭 = the first content grapheme after any opening bracket when it is a kanji, katakana or hiragana (not ー, a
  small kana or a particle); 言葉の頭 adds kanji and katakana phrase starts; 大きくしない none; a cut with fewer than 3
  content graphemes has none.
- Sizes at strength j: particle × (1 − 0.36 j) (0.82 at 0.5, 0.64 at 1; the product with emphasis), head max(emphasis,
  1 + 0.40 j) (1.20 / 1.40; never the product). Placement is the emphasis code: horizontally on the shared baseline,
  vertically centred in a column as wide as its largest glyph. A tcy cell is never a head or a particle.
- Worked numbers: 「始発のホームに」 at 0.5: 始 em 120 at x 60, の em 82 at x 261, に em 82 at x 643, width 684, block height
  120; with all three at the new-work defaults の is w 80.28 (a seam cell × 0.82) and the width 657.19.

### 1.5 T3 英字を少し大きく・和文との間をあける

- Gate: `lang !== 'en'` and CJK in the source (the cut text, or the run's own text). A Latin-only cut (「Fly high」) is
  untouched, and a Latin run cut from a Japanese line grows like the same word inside the whole-line run.
- A Latin word is a maximal run on the Latin face holding a letter, without its edge spaces; it grows to at least
  `1 + x × LATIN_GROW[family]` (0.20; Caveat 0.30, Cormorant Garamond 0.28), `max` with emphasis, never a tcy cell; a
  gap of `0.30 × x` em goes before it and before the grapheme after it where it meets CJK (never at a line start or
  next to a space, a bracket or punctuation). Digits alone keep their size.
- The gap enters `trackedWidth` (less the gap of a line's first grapheme) and `place` (never before a line's first
  glyph), so breaking, fitting and placing agree. Fit sweep: 6,720 layouts at 100 %, worst reach past the box 3.02e-5
  du (the engine's own Float32 rounding).
- Worked numbers at 0.5: 「夜明けのStationで」 S at x 445.8 (em 110), width 930.4 (864 plain); in a 700 box it breaks before
  S with no trailing and no leading gap. 「Loveって」 has its gap between e and っ.

### 1.6 Planner

- `planner/plan`: `ctx.kumi` = the three defaults of `planner/rules`, frozen; the cast-cache look key ends with it.
- `planner/cast decideKumi` right after `decideText`: no seed, no history change, not aligned by
  「くり返しの行をそろえる」 (a repeated line reads its own line pins).
- `planner/fields`: at work scope the four slots are the `'rule'` category (value = work pin or default, never a cut's;
  pinned at work only); `kumiAt` gives a cut without a decision the pin that turned it off, else 0 (`'line'` for the
  head); `sourceAt` and `canPinAt` never read or offer a cut; `lockPayload` skips them (🔒 never freezes a setting).
- `planner/explain`: at work scope `whyRule.kumi.gen` (「新しい作品なので、はじめからオン」), `whyRule.kumi.off`, or the
  pin reason; line and cut paths read the pin index, as for `cam.extreme`.

### 1.7 UI

- 作品全体 › **文字組み**, a section right after 書体, closed like it: 「かなを詰める」, 「助詞を小さく・頭の字を大きく」, 「英字を
  少し大きく・和文との間をあける」 as switches with their notes (on = the new-work strength, off = 0; the document's default
  is 自動 and unpins). Under 詳しい設定, while its switch is on: 「詰める強さ」, 「ジャンプ率」, 「英字の大きさとあき」 (10–100 %;
  the slider never turns a feature off; its default unpins, also in the middle of a drag, one undo entry) and 「大きくする
  字」 [行の頭 | 言葉の頭 | 大きくしない] (行の頭 is 自動).
- 行 › 色と書体 and 複数行 › 色と書体, under 詳しい設定: 「この行のかな詰め」, 「この行の大小（助詞・頭の字）」 (note:
  「助詞の見分けがずれた行は「使わない」にできます。」) and 「この行の英字」, each [自動 | 使う | 使わない]; 自動 stays
  selected while the value follows a work pin (`inheritAuto`; the tag says where it comes from).
- FieldSpec (additive): `onValue` / `offValue` (toggle), `inheritAuto` (choice), `autoDefault` (§0: compare after
  coercion with `RU.defaultValue`, equal = 自動). `ui/fields.slotScopes` answers from `RU.scopesOf` for every row of the
  table; `contextOf` gives the work page `ctx.kumi` (the three values the rows' `when` reads).
- Every change is one `pin.set` or `pin.clear` through the inspector: one undo entry.

### 1.8 Interactions

- P2 (T5 効果を重ねすぎない) counts no typesetting; giantWhisper, confettiWords and magazineHead already opt out of T2.
- P3 (キメ): a キメ that picks giantWhisper gets no T2 through the opt-out; P3 may read `RunLayout.kumi`; it writes no
  kumi pin (a line that should stay plain is set to 使わない by the user).
- P4 (モーフ, 太さ): one service chain (`withFaces`, then `withKumi`); matched glyphs may differ in `em`, interpolated like
  any size; the weight damp reads the layout weight.
- P5, P6: glyph order, `off` and timing are unchanged; P6 does not use the tagger.

### 1.9 Checks and goldens

- Node: `kumi.test.js`, `layout_kumi.test.js`, `scene_kumi.test.js`, `planner_kumi.test.js` and additions to
  `layout`, `commands`, `ui_data`, `ui_fields` and `planner_determinism`; the tagger's labelled sets in
  `tests/fixtures/kumi_particles.json` (regression floors, the held-out gate `heldout4` ≥ 0.97 / ≥ 0.85, and a release
  gate on an independent set, a todo test until `tests/fixtures/kumi_independent.json` exists).
- **Ink check** (`glyph_parity.py` check 6, CI): every trimmed kana of U+3041–U+30FF laid out alone at 100 % (its
  tightest cell) in the gothic and mincho system faces, horizontally and vertically; for every ordered pair the reach of
  the two inks past the distance of their centres, compared scanline by scanline across the line and less what the
  face's own ink does at 1 em, must stay ≤ 0.02 em. `contact_sheet.py --kumi --fonts` runs the same on the four
  flavours' web faces before a release.
- **Golden** `tests/golden/project_kumi.json` (`tests/update_golden.js`, `tests/helpers/kumi_docs.js`): `basic` as a new
  work and `vertical` with the three switches pinned at 1, 言葉の頭 and one line's size contrast off; the job refuses to
  write unless every cut of `basic` holds the automatic settings and at least 30 of its 40 frames differ from the
  document without the marker. A change of a table rewrites only this file.
- `perf.py` row `kumi`: `project_long` as a new work, at twice the §7.4 budget and p50 ≤ 1.10 × the plain document's.
- `ui_flows.py` flow `kumi`; `contact_sheet.py --kumi` (older work / new work / 100 %, with `--mood`, `--aspect`,
  `--orient`, `--face`, `--lines`, `--fonts`).

<!-- PV22 P2 chapter -->

<!-- PV22 P3 chapter -->

<!-- PV22 P4 chapter -->

<!-- PV22 P5 chapter -->

<!-- PV22 P6 chapter -->
