export const meta = {
  name: 'design-pv22',
  description: 'Design the 14 requested 文字PV features in 6 packages: designer, adversarial critic, reviser',
  phases: [
    { title: 'Design', detail: 'one designer per package writes a grounded design document' },
    { title: 'Critique', detail: 'a critic per package tries to break the design against the code' },
    { title: 'Revise', detail: 'the designer revises the document with every critique addressed' },
  ],
}

const REPO = '/home/user/moji-pv'
const SP = '$SCRATCH/pv22'

const COMMON = `
Repository: ${REPO} (main at 9a9e950). App: 文字PVメーカー — a browser app that makes Japanese lyric videos (文字PV).
MV.def modules in src/ concatenated by build.py into index.html / en/index.html (layer rules checked by
python3 build.py --check). Deterministic planner src/planner/* (Document -> Plan), Canvas2D engine src/engine/*, text
layout src/engine/text/*, parts src/parts/*, UI src/ui/*, strings src/i18n/strings.js (pairs [ja, en]), timing
src/core/timing.js, src/core/tap.js, audio src/audio/*, optional AI src/ai/*. Docs: docs/DESIGN.md (v2),
docs/DESIGN_2_1.md (v2.1, incl. §4.10 くり返しの行をそろえる and §14 カメラ EXTREME), docs/SPEC.md, docs/NOTES.md.

The owner asked for 14 文字PV features ("skip what is already implemented"). A verified survey found none fully
implemented; per-item findings (status, evidence, gaps, a first design sketch and a skeptic's corrections) are in
${SP}/survey_by_item.json — READ the entries for your items first, then the code they cite.

Six packages are being designed in parallel (know the others to avoid overlap and to design the interactions):
- P1 typography: T1 かなの字間を詰めて塊で読ませる, T2 助詞を小さく、頭の字を大きく, T3 英字は少し大きく、日本語との間を少し空ける
- P2 conventions: M1 パートごとに演出をそろえ、くり返す歌詞は同じ見せ方で戻ってくる, M2 動きの配分や方向の交互など、文字PVの定石を組み込み, T5 効果を重ねすぎない
- P3 kime: M3 キメたい一行を大胆に見せる「キメ」
- P4 glyph motion: M4 文字が溶けて変わる、同じ字が移動するモーフ, M5 細字から太字へ育つ、太さのアニメーション
- P5 timing: T4 声より0.2秒先に文字を出す, S1 曲から行の頭を自動で下書き, S2 1行だけタップで打ち直し, S4 読み切れない速さの行を知らせる
- P6 utahame: S3 歌に合わせて1字ずつ出す「歌ハメ」

Lead decisions (binding):
1. Gating. Every golden stays byte-identical: tests/golden/frame_hashes_v2.json (FROZEN), plan_hashes.json,
   frame_hashes.json, project_media.json, project_repeat.json, project_extreme.json. New behaviour is ON for NEW documents
   (written into the document by the new-project path as explicit settings or pins — find exactly where new documents
   are created: core/doc defaultDoc, ui/project_io, the sample document, tests that call defaultDoc) and OFF for existing
   documents and fixtures (an absent field means off), with a UI switch to turn it on/off. If defaultDoc is used by tests
   or fixtures in a way that would change a golden, design around it (e.g. a separate newDocument() used only by the UI
   new-project and first-run paths) and say so. A bug fix that changes existing behaviour (e.g. S2's stale end pin) is
   allowed only if no golden changes, and must be called out.
2. Everything works without AI; AI may add an optional path.
3. Determinism: plans and frames are pure functions of the document (no Math.random, no clock).
4. Performance budgets: tests/browser/perf.py rows and the re-planning speed test must not regress beyond noise.
5. Every user-facing string is a pair [ja, en] in src/i18n/strings.js; UI names in Japanese in the design.
6. Undo: every user change is one undoable command (core/commands.js).
7. Documents: never write the words assistant or vendor; never (name withheld), (name withheld), (name withheld).
8. Prefer extending existing contracts over new ones; where a FROZEN contract (e.g. engine/scene/table.js POSE columns,
   seam mix contract, SCH enums locked by tests/node/contract.test.js) must change, say exactly how and why.

READ-ONLY for the repository: do not edit files under ${REPO}. You may run read-only node probes (tests/helpers/load.js)
with scratch files under ${SP}/probe/ only. Write your design document to the path given below (Markdown, English, with
Japanese UI names), structured per item: 1 what the user gets (Japanese UI wording, where it lives, defaults),
2 gating and defaults (new vs existing documents), 3 data model (document fields / pins / slots, migration),
4 algorithm (exact rules, constants, formulas, pseudo-code), 5 engine / planner / UI changes by module and function,
6 strings (keys with [ja, en]), 7 tests (new test files and cases, mutation targets), 8 goldens (why each stays
identical; any new golden), 9 performance, 10 risks and open questions, 11 interactions with the other packages.
Be concrete enough that an implementer can build it without re-deciding anything.
`

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    package: { type: 'string' },
    designPath: { type: 'string' },
    items: { type: 'array', items: { type: 'object', properties: {
      id: { type: 'string' },
      userFacing: { type: 'string', description: 'Japanese: what the user sees and where' },
      approach: { type: 'string' },
      gating: { type: 'string' },
      modules: { type: 'array', items: { type: 'string' } },
      contractChanges: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
      openQuestions: { type: 'array', items: { type: 'string' } },
    }, required: ['id', 'userFacing', 'approach', 'gating', 'modules', 'contractChanges', 'risks', 'openQuestions'] } },
    sizeEstimate: { type: 'string', description: 'rough lines of code and number of files' },
  },
  required: ['package', 'designPath', 'items', 'sizeEstimate'],
}

const CRITIQUE_SCHEMA = {
  type: 'object',
  properties: {
    issues: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
      item: { type: 'string' },
      problem: { type: 'string' },
      evidence: { type: 'string' },
      fix: { type: 'string' },
    }, required: ['severity', 'item', 'problem', 'evidence', 'fix'] } },
    verdict: { type: 'string' },
  },
  required: ['issues', 'verdict'],
}

const PACKAGES = [
  { key: 'P1-typography', items: ['T1', 'T2', 'T3'], notes: `Hard parts: per-glyph scale and extra advance in horizontal AND vertical layout (engine/text/layout.js, fit.js, vert.js, breaker.js), arranges that assume uniform em, emphasis interplay (emphScales), sprites keyed by size, glyph picking (render/pick.js), tate-chu-yoko digits, particle detection in kana-only runs (the skeptic showed phrase-final detection fails: design a particle tagger that works inside kana runs — e.g. a small dictionary with left/right context rules — and state its precision on the sample lyrics), strength settings (ジャンプ率). Decide the UI: e.g. 作品全体 › 書体 › 文字組み with switches and strengths, plus per-line override if useful.` },
  { key: 'P2-conventions', items: ['M1', 'M2', 'T5'], notes: `M1: per-section kit of families for parts + making repeats match by default for new documents (repeat.same pin in new documents). M2: direction alternation (entrance/exit/seam/lens directions, push-in/pull-out alternation, composition sides) and a song-level motion arc (verse calmer, chorus stronger, calm before strong, last chorus peak) — note the skeptic: normal camera presets cannot be mirrored today. T5: a cross-kind effect budget per cut (decorations, screen effects, moving lens, camera shot, rig, seam, impulses) and on the lettering itself; must let a キメ line (P3) and EXTREME keep their intent. All three must be gated (new documents on), each with a switch, or one group switch 「文字PVの定石」 with sub-switches — decide and justify. Keep the variety tests passing on default documents.` },
  { key: 'P3-kime', items: ['M3'], notes: `A キメ line: a user mark (lyric syntax and a line toggle 「キメ」) that GUARANTEES a bold treatment: the whole line in one cut, a big layout family, a size boost, a strong but readable entrance, camera that pairs with the layout, a longer hold, the cuts just before it quieter (calm before the hit), no dependence on flash/shake (impact '!' stays as is and can combine). Decide how it relates to the existing 見せ場 '!' mark (keep both; キメ is stronger and explicit) and to EXTREME and to P2's effect budget (キメ is the exception that gets the budget). Explain text (why) strings.` },
  { key: 'P4-glyph-motion', items: ['M4', 'M5'], notes: `M4 morph: a glyph-level transition between consecutive cuts where characters shared by both texts travel from their old position/size/rotation to the new one (magic move) and the others melt/dissolve into place, replacing B's entrance for its duration; decide how the planner computes glyph correspondence (longest common subsequence of characters, ignoring lone particles), when it is chosen automatically (only when overlap is meaningful), how it is pinned (切り替え 「モーフ」), and how the engine gets glyph positions of both cuts (the seam contract today sees only two surfaces — propose the least invasive extension). M5 weight animation: thin → bold. Canvas2D cannot interpolate font weight; compare approaches (stroke emboldening with lineWidth, crossfade between two loaded weights of the face, variable fonts), sprite caching cost, the FROZEN POSE columns, and pick one. Provide entrance/hold parts (e.g. 入り「太る」, 待機「脈打つ太さ」) and state the limits.` },
  { key: 'P5-timing', items: ['T4', 'S1', 'S2', 'S4'], notes: `T4: lead 0.2 s for new documents and an option so the text is READABLE by the voice (entrance finishes at or before the sung start) — decide a mode setting. S1: a NON-AI line-start draft from the audio: the 100 Hz envelope/onset analysis in src/audio/analyze.js exists but is thrown away after loading — design keeping or recomputing it, detecting phrase starts (vocal-ish onsets after pauses), and aligning N lyric lines to candidate starts (dynamic programming with reading-time priors and beat snap), with a review step like the AI align (proposed pins, apply as one undo), and state the expected accuracy honestly; keep the AI align as the optional better path. S2: a real 「この行だけタップで打ち直す」 mode (stops after one tap), fix the stale end pin (re-tap later than the end pin), keep neighbours from moving (or tell the user), an entry on 行 › 時間 and on the timeline. S4: a readability rule (morae or cells per legible second, minimum legible time using the visible window a..b), warnings in the lyric editor gutter, timeline, 行 page and step ④ checklist with quick fixes; also render the existing warn.time-compressed / warn.piece-merged as text.` },
  { key: 'P6-utahame', items: ['S3'], notes: `歌ハメ: characters appear one by one in sync with the singing. Design: (a) timing sources in priority: pins per character/mora (new), enhanced-LRC word tags (keep them instead of stripping), tapping per character/phrase (a tap mode 「1字ずつタップ」), a NON-AI estimate improved by the song's onsets inside the line's sung window, optional AI word timing; (b) a one-step switch 「歌ハメ」 on 行 / 区画 / 作品全体 that sets a per-glyph entrance, order 'sung', and optionally a karaoke-style fill; (c) the sung window (not the whole cut to t1); (d) how to see and edit per-character times (ticks on the timeline under the line, drag). Keep the existing 'sung' order and its contract; decide the data model for sub-line timing (e.g. line/<id>:marks = [t...] per unit) and migration of LRC word tags. Coordinate with P1 (per-glyph scale) and P5 (tap modes, onset analysis kept by S1).` },
]

phase('Design')
const ONLY = args && Array.isArray(args.only) ? args.only : null
const results = await pipeline(
  ONLY ? PACKAGES.filter((p) => ONLY.includes(p.key)) : PACKAGES,
  (p) => args && args.skipDesign ? Promise.resolve({ package: p.key, skipped: true }) : agent(COMMON + `\nYour package: ${p.key} (items ${p.items.join(', ')}).\n${p.notes}\nWrite the design to ${SP}/design-${p.key}.md and return the summary.`,
    { label: `design:${p.key}`, phase: 'Design', schema: SUMMARY_SCHEMA }),
  (d, p) => d && agent(COMMON + `\nYou are the adversarial critic of package ${p.key}. Read the design at ${SP}/design-${p.key}.md and the code it
relies on. Find what would fail: wrong assumptions about the code (check every cited function and contract), goldens
that would in fact change, gating holes (an existing document or fixture that would pick up new behaviour; defaultDoc
used by tests), determinism, performance, vertical text, emphasis/ruby/tate-chu-yoko, undo, UI placement that does not
fit the existing pages, missing strings, untestable claims, over-scoped work, interactions with the other packages, and
anything the owner's words ask that the design does not deliver. Rank by severity; give a concrete fix for each.`,
    { label: `critique:${p.key}`, phase: 'Critique', schema: CRITIQUE_SCHEMA }).then((c) => ({ d, c })),
  (dc, p) => dc && agent(COMMON + `\nYou designed package ${p.key}; the design is at ${SP}/design-${p.key}.md. A critic returned the issues below.
Verify each against the code; fix the design document for every valid issue (blockers and majors must all be
resolved; say in a short 'Critique log' section at the end how each issue was handled, or why it was rejected with
evidence). Keep the document complete and self-contained. Return the updated summary.\n\nCritique:\n` + JSON.stringify(dc.c, null, 1),
    { label: `revise:${p.key}`, phase: 'Revise', schema: SUMMARY_SCHEMA }).then((r) => ({ package: p.key, first: dc.d, critique: dc.c, final: r })),
)
return results.filter(Boolean)
