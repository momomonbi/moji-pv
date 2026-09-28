export const meta = {
  name: 'implement-pv22',
  description: 'Implement PV22 packages in their worktrees: phased build, two-lens review, fix, final verification',
  phases: [
    { title: 'Build', detail: 'phase agents implement the design step by step, committing as they go' },
    { title: 'Review', detail: 'two reviewers per package: correctness/safety and owner/UX' },
    { title: 'Fix', detail: 'every blocker and major finding fixed, checks rerun' },
    { title: 'Verify', detail: 'full checks: build, Node suite, goldens, relevant browser tests' },
  ],
}

const SP = '$SCRATCH/pv22'
const WT = '$WORKTREES'

const PKGS = [
  { key: 'P1', name: 'P1-typography', wt: WT + '/wt-p1', items: 'T1 かなの字間を詰めて塊で読ませる, T2 助詞を小さく、頭の字を大きく, T3 英字は少し大きく、日本語との間を少し空ける',
    phases: [
      'Engine: the new L1 module engine/text/kumi (T1 kana trim table, T3 Latin scale and 和欧間 gap), the additive RunSpec.kumi / RunLayout.kumi, layout.js (prepare, trackedWidth gap, place), service.js (withKumi, LAYOUT_FIELDS), scene/build.js (cut-scoped TextService), horizontal and vertical; unit tests (kumi.test.js, layout_kumi.test.js); every golden unchanged.',
      'T2: the particle tagger (engine/text/kumi.particleMarks with its context rules and word lists), heads, jump factors, the part opt-outs (giantWhisper, confettiWords, magazineHead, gridMosaic) via K.kumiFor, the labelled fixture tests/fixtures/kumi_particles.json with the precision/recall test (precision must stay 100 % on the labelled set; report recall), scene tests.',
      'Planner and UI: the four slots in planner/cast SLOT_SPECS, ctx.kumi from planner/rules, decideKumi, the cast-cache look key, explain (why/whyRule), planner/fields rule category, core/commands NOT_CUT, ui/fields (作品全体 › 文字組み section after 書体, the line rows under 行 › 色と書体 詳しい設定), widgets, strings, the new golden tests/golden/project_kumi.json via tests/update_golden.js (after --check matches all six existing goldens), a ui_flows.py flow, contact sheets of 3 moods × 2 aspects × h/v for visual QA (look at them and tune only within the design), the DESIGN_2_2 chapter, NOTES, SPEC and README lines.',
    ] },
  { key: 'P2', name: 'P2-conventions', wt: WT + '/wt-p2', items: 'M1 パートごとに演出をそろえ、くり返す歌詞は同じ見せ方で戻ってくる, M2 動きの配分や方向の交互など、文字PVの定石を組み込み, T5 効果を重ねすぎない',
    phases: [
      'Phase A (design §0.5): planner/rules additions (resolve(ctx), repeatDefault, the rule field category), ctx.rules/ctx.pv, planner/arc, planner/kit, planner/flow (part and seam direction flips), planner/conventions, 「くり返しの行をそろえる」 by default in new works (with the ai/direct followSources stub fix), the kit, the arc, the UI rows (「文字PVの定石」 group switch + sub-switches, the 区画 kit row and its die), strings, explain, tests pv_rules/section_kit/pv_flow parts, project_pv.json not yet.',
      'Phase B (design §3): T5 — the lettering rule, the cut budget (pv.fxCap, pv.fxMax), the seam gate, impulse trimming, UI rows, strings, tests (fxcap), the invariant load ≤ cap for automatic cuts.',
      'Phase C (design §2 camera alternation): mirrored normal shots (driftOff~m, tiltHold~m via the existing ~m grammar), the stage-6 mirror overlay, push-in/pull-back zoom classes, EXTREME mirror alternation; tests; then the new golden tests/golden/project_pv.json (after --check matches all six existing goldens), a ui_flows.py flow, contact sheets / plan dumps for visual QA, the DESIGN_2_2 chapter, NOTES, SPEC and README lines.',
    ] },
  { key: 'P3', name: 'P3-kime', wt: WT + '/wt-p3', items: 'M3 キメたい一行を大胆に見せる「キメ」',
    phases: [
      'Planner: the キメ line pin and its plan flags, segment (one cut up to the per-aspect cell limit), planner/kime (sets filtered by what the registry has — never force an absent part; the stub-registry and planner_pins fuzz must pass), cast restrictions and rules, calm before the hit, the hold (core/timing), stage-6 rules (hard cut, EXTREME pairing), no flash on a non-impact キメ, explain, kime.test.js, the new golden tests/golden/project_kime.json (after --check matches all six existing goldens).',
      'UI and the rest: 行 › 文字の記号 「キメ」 toggle (and the multi-line tri-state), the work count note and the too-many hint, 「同じ歌詞の行もキメにする」 button, the lyric editor mark, 作品全体 › 見た目 詳しい設定 「キメの前を静かにする」, hidden-pin handling for split lines, AI touches the design lists, strings, a ui_flows.py flow, contact sheets of キメ cuts (moods × aspects × h/v) for visual QA, the DESIGN_2_2 chapter, NOTES, SPEC, README and AI_GUIDE lines.',
    ] },
  { key: 'P4', name: 'P4-glyph-motion', wt: WT + '/wt-p4', items: 'M4 文字が溶けて変わる、同じ字が移動するモーフ, M5 細字から太字へ育つ、太さのアニメーション',
    phases: [
      'Design order steps 1–4: registry late/optIn (+ registry tests, version assertion first); POSE column wt, DELTA, kit options, faces ladders, draw weight pairs (style snap, faceReady), FontBook draw-only faces, facade draw usage, weight tests 1–4; the parts 太る and 細る with conformance; planner opt-in pools, text.weight pin and grow rule, warnings, explain, UI rows, rate calibration.',
      'Design order steps 5–6: planner/morph (glyph correspondence), the tracks rule, guards, window, hand-over, memo, seamCopy re-check, plan tests; engine/render/morph, the renderer hook, the glyphMorph seam part, render tests.',
      'Design order steps 7–9: facade thumbnails, palette and part browser, strings, 脈打つ太さ (deferrable — build it if time allows, else record it as deferred), the new golden tests/golden/project_glyph.json (after --check matches all six existing goldens), browser checks (glyph_parity, parts_gallery, contact_sheet, ui_flows flow), perf rows, contact sheets / frame strips of morphs and weight moves for visual QA, the DESIGN_2_2 chapter, NOTES, SPEC and README lines.',
    ] },
]

const COMMON = (p) => `
You are implementing package ${p.name} (${p.items}) of 文字PVメーカー v2.2 「文字PVの定石」.
Work ONLY in the git worktree ${p.wt} (branch ${p.key.toLowerCase()}); never touch /home/user/moji-pv itself or any other
worktree, never push, never switch branches, never rewrite history (no rebase/amend/reset of commits already made).
The contract is the design document ${SP}/design-${p.name}.md — read it completely (including its critique log) before
coding; follow it; where you must deviate, record the deviation and the reason in your NOTES section.

Already in the base commit (c64b24b) by the lead:
- core/doc: look.gen, D.GEN = 1, D.newDoc() (used at ui/boot.js first run, ui/project_io.js new work and device reset);
  defaultDoc()/normalize()/fixtures never carry the marker. tests/node/doc.test.js covers it.
- planner/rules (src/planner/rules.js): the one table of new-work defaults, rows { slot, parent, scopes, spec, on, off }
  with rows for P1 (text.kana/jump/latin/head), P2 (pv.rules, repeat.same, pv.kit, pv.alternate, pv.arc, pv.fxCap,
  pv.fxMax) and P4 (morph.auto, weight.auto); API value(doc, ix, slot), valueAt(doc, ix, slot, lineId),
  defaultValue(doc, ix, slot), hasDefault(slot), isRule, rowOf, scopesOf, gen(doc), sameValue, SPECS, ROWS; tests in
  tests/node/pv_rules.test.js. Add rows for your own slots if missing and extend the module as your design says (keep the
  existing API and tests passing).
- docs/DESIGN_2_2.md with §0 (the marker and the table) and one placeholder per package: replace ONLY the line
  "<!-- PV22 ${p.key} chapter -->" with your chapter (heading "## ${p.key.slice(1)}. …"). docs/NOTES.md: replace ONLY
  "<!-- PV22 ${p.key} notes -->" with your notes section (### headings under the PV22 lead section). src/i18n/strings.js:
  add your keys right after the comment line "// --- PV22 ${p.key} (…) ---" near the end (pairs [ja, en]). Short additions
  to docs/SPEC.md, README.md, README.en.md (and docs/AI_GUIDE.md if your package touches AI) in the right sections.

Other packages are being built at the same time in other worktrees from the same base (do not implement their work;
implement the hooks your design names for them, reading their flags only if present): P1 typography (engine/text/*,
parts arrange opt-outs), P2 conventions (planner/arc, kit, flow, fxcap, conventions; cast/camera/tracks hooks via
ctx.pv), P3 キメ (planner/kime, segment, a line pin 'kime', cut.kime flags), P4 glyph motion (registry late/optIn, POSE wt,
planner/morph, engine/render/morph), P5 timing (core/timing lead, audio line-start draft, tap one line, too-fast
warnings) and P6 歌ハメ (per-character timing) — the last two are still being designed.

Binding rules:
- Every existing golden stays byte-identical: node tests/update_golden.js --check must report "matches" for
  frame_hashes_v2.json (FROZEN), plan_hashes.json, frame_hashes.json, project_media.json, project_repeat.json,
  project_extreme.json. Never regenerate an existing golden. A new golden file for your package is written by adding a
  job to tests/update_golden.js only after --check matches the six.
- Determinism (no Math.random, no clock in planning or rendering); undo = one command per user change; everything works
  without AI; strings in pairs [ja, en] (i18n.test.js); build layers (python3 build.py --check).
- Never write the words assistant or vendor in any file; never (name withheld), (name withheld) or (name withheld). No API keys anywhere.
- Commits: exactly  git -c user.name=momomonbi -c user.email=130516776+momomonbi@users.noreply.github.com commit -m "更新"
  — the message is the single word 更新 with NO trailer lines (no Co-Authored-By, no session line, nothing else).
  Commit after each coherent step.
- Checks you run: python3 build.py --check; node --test --test-concurrency=1 "tests/node/*.test.js" (the test
  "planning speed: re-planning project_long after an edit" fails on this loaded machine on main too — note it, do not
  chase it); node tests/update_golden.js --check; python3 build.py and python3 build.py --lab to rebuild the pages when
  src changed (index.html and en/index.html are generated and committed); browser tests your package touches with
  PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/<name>.py (ui_flows, ui_layout, i18n_pages, csp,
  contact_sheet, parts_gallery, glyph_parity, determinism, perf as relevant). perf.py and media_exact.py are
  timing-sensitive on this loaded 4-CPU machine: compare with the base worktree ${WT}/wt-pv22 before chasing a timing
  failure. Other packages' agents run tests at the same time, so the machine is slow; use timeouts generously.
- Mutation checks: for each important new rule, break it temporarily, confirm a test fails, restore.
Scratch files go under ${SP}/work-${p.key}/ only.
`

const PHASE_SCHEMA = {
  type: 'object',
  properties: {
    done: { type: 'boolean' },
    summary: { type: 'string' },
    commits: { type: 'array', items: { type: 'string' } },
    checks: { type: 'string', description: 'what was run and the results' },
    deviations: { type: 'array', items: { type: 'string' } },
    leftover: { type: 'array', items: { type: 'string' }, description: 'anything of this phase not done' },
  },
  required: ['done', 'summary', 'commits', 'checks', 'deviations', 'leftover'],
}
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    findings: { type: 'array', items: { type: 'object', properties: {
      severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
      area: { type: 'string' }, problem: { type: 'string' }, evidence: { type: 'string' }, fix: { type: 'string' },
    }, required: ['severity', 'area', 'problem', 'evidence', 'fix'] } },
    verdict: { type: 'string' },
  },
  required: ['findings', 'verdict'],
}
const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    green: { type: 'boolean' },
    head: { type: 'string' },
    checks: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, result: { type: 'string' } }, required: ['name', 'result'] } },
    notes: { type: 'string' },
  },
  required: ['green', 'head', 'checks', 'notes'],
}

const ONLY = args && Array.isArray(args.only) ? args.only : null
const LENSES = [
  { key: 'safety', text: `Lens: correctness and safety. Try to break it: gating holes (an existing document, fixture, opened
file or autosave picking up new behaviour; defaultDoc users), every golden byte-identical, determinism, re-plan equals
plan from scratch (planner caches keyed right), undo, crashes (stub registry, planner_pins fuzz, odd pins, empty lyrics,
vertical text, EXTREME, 「くり返しの行をそろえる」, materials, media, transparency), performance (re-plan and render), layer
rules, contract changes vs the design, tests that pass for the wrong reason (run mutation checks yourself). Run the
checks; read the diff (git diff c64b24b..HEAD).` },
  { key: 'owner', text: `Lens: the owner and the user. Does it deliver what the owner's words ask (${'${ITEMS}'}), visibly? Render
evidence yourself (contact sheets / frame strips / screenshots of before and after with the lab page or the browser test
helpers; look at the images) and judge the look as a lyric-video maker would. Check the UI: where the switches live, their
Japanese wording (natural, short, consistent with the app's existing terms), en parity, notes and why texts, defaults in
a new work vs an older work, discoverability, undo, keyboard use; and the docs (DESIGN_2_2 chapter, NOTES, SPEC, README)
for accuracy against the code.` },
]

async function runPackage(p) {
  const phases = []
  for (let i = 0; i < p.phases.length; i++) {
    const prev = phases.length ? '\nEarlier phases reported:\n' + JSON.stringify(phases, null, 1) + '\nFinish any leftover of earlier phases first.' : ''
    const r = await agent(COMMON(p) + `\nYour phase ${i + 1} of ${p.phases.length}: ${p.phases[i]}\nRead git log and the code first to see what earlier phases built.${prev}\nCommit your work and return the phase summary.`,
      { label: `build:${p.key}:${i + 1}`, phase: 'Build', schema: PHASE_SCHEMA })
    phases.push(r || { done: false, summary: 'agent returned nothing', commits: [], checks: '', deviations: [], leftover: [p.phases[i]] })
  }
  const reviews = await parallel(LENSES.map((l) => () => agent(COMMON(p) + `\nYou are a REVIEWER (read the code, run checks and probes, but do not edit tracked files or commit; scratch under ${SP}/work-${p.key}/review-${l.key}/).
${l.text.replace('${ITEMS}', p.items)}
Build phases reported:\n${JSON.stringify(phases, null, 1)}\nReturn findings ranked by severity with concrete fixes.`,
    { label: `review:${p.key}:${l.key}`, phase: 'Review', schema: REVIEW_SCHEMA })))
  const findings = reviews.filter(Boolean).flatMap((r) => r.findings)
  const fix = await agent(COMMON(p) + `\nReviewers returned the findings below. Verify each against the code. Fix every blocker and major; fix minors
that are plainly right, otherwise record why not in your NOTES section. Re-run the checks, commit, and return the phase
summary (leftover = anything not fixed, with the reason).\n\nFindings:\n${JSON.stringify(findings, null, 1)}`,
    { label: `fix:${p.key}`, phase: 'Fix', schema: PHASE_SCHEMA })
  const verify = await agent(COMMON(p) + `\nFinal verification of the package. Run: python3 build.py --check; python3 build.py; python3 build.py --lab;
node --test --test-concurrency=1 "tests/node/*.test.js"; node tests/update_golden.js --check (all six existing goldens must
match, plus your new golden); the browser tests your package touches. Fix anything red that is this package's (commit
bare 更新), re-run, and make sure the worktree is clean (git status) with everything committed. Report the head commit
and each check's result honestly (a timing failure that also fails on ${WT}/wt-pv22 is reported as such).`,
    { label: `verify:${p.key}`, phase: 'Verify', schema: VERIFY_SCHEMA })
  return { key: p.key, phases, reviews, fix, verify }
}

const results = await pipeline(ONLY ? PKGS.filter((p) => ONLY.includes(p.key)) : PKGS, (p) => runPackage(p))
return results.filter(Boolean)
