# PV22 status (lead)
Base: wt-pv22 branch pv22 at c64b24b (marker look.gen/newDoc 87fde34, planner/rules 40e1327, skeletons c64b24b).
Designs: scratchpad/pv22/design-P{1..6}-*.md (final, revised).
Worktrees: wt-p1..wt-p6 (branches p1..p6) from c64b24b.
Implementation workflows (script, args, run):
- w21wluyrg  P1+P2  run wf_b55fbd64-8af  script: scratchpad/pv22/impl-wf.js (copy of the original)  args {only:[P1,P2]}
- w8t84495p  P3+P4  run wf_db874675-e1a  script: scratchpad/pv22/impl-wf.js  args {only:[P3,P4]}
- w24lw6a79  P5+P6  run wf_414a72f3-629  script: scratchpad/pv22/impl-wf2.js args {only:[P5,P6]}
Resume: Workflow({scriptPath, resumeFromRunId, args}) — one resume per run at a time.
Integration plan: merge p1..p6 into pv22 (order P2, P1, P3, P4, P5, P6), rebuild pages, goldens check (6 existing match + new ones),
full Node, browser tests, assemble docs, visual QA, bare 更新 commits (momomonbi), push to $BRANCH, PR body 更新, CI green → merge.
Known conflicts: tracks.endWithSeam (P4 handover vs P5 tiers), core/doc newDoc (P5 lead 0.2), strings/fields/cast shared files.

## Stopped by the owner (2026-09-28 06:40 UTC)
All three implementation workflows stopped; check-in trigger deleted. Heads: p1 54944eb, p2 7096b25, p3 59e7c28,
p4 2cb2d70 (+8 uncommitted files of its review fix), p5 babd307, p6 b8d5993. Nothing pushed; main untouched.
Stages reached: P1/P2 in review; P3 in final verify; P4 in review-fix; P5/P6 in their last build phase.

## Resumed by the owner
Task IDs now: wils6jm3j (P1+P2, run wf_b55fbd64-8af), wrptskocd (P3+P4, run wf_db874675-e1a), wcot2vfld (P5+P6, run wf_414a72f3-629).

## Saved for a later session (owner asked to stop and keep everything)
Heads saved (all reachable from the pushed designated branch through one "ours" save merge; the branch's files stay those of pv22):
p1 54944eb, p2 7096b25, p3 59e7c28, p4 4fd7c1d, p5 babd307, p6 fa8a819, pv22 07f1198 (base + rebuilt pages).
Stages reached when stopped: P1/P2 in review (P2 reviews done, fix pending?), P3 in final verify, P4 in review fixes
(majors partly done), P5 done through build and review (verify pending), P6 phase C started: its merge of p5 was
undone; the partial resolution is kept as p6-merge-p5-partial.*.patch with the conflict list p6-merge-p5-conflicts.txt.
This folder (designs, scripts, survey, patches) is kept in the side commit "archive" (a parent of the save merge),
under pv22-save/. To resume in a new session: git fetch; for each package recreate a worktree at its head (the heads
above are parents of the save merge: git log --format=%P -1 <save merge>), restore pv22-save/ into the scratchpad,
then relaunch the implementation stages that remain (review → fix → verify per package), then integrate.
