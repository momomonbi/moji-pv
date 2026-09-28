import sys
sp=sys.argv[1]
s=open(sp+'/impl-wf.js',encoding='utf-8').read()
old="""planner/morph, engine/render/morph), P5 timing (core/timing lead, audio line-start draft, tap one line, too-fast
warnings) and P6 歌ハメ (per-character timing) — the last two are still being designed."""
new="""planner/morph, engine/render/morph), P5 timing (core/timing lead and 出そろい, segment/tracks seam hand-over, audio/voice
+ core/draft line-start draft, one-line re-tap, planner/readable too-fast warnings) and P6 歌ハメ (planner/sung
per-character timing, sung.times pins, 1字ずつタップ, timeline ticks, karaoke fill). P5 owns audio/voice (the joint
record doc.song.voice); P6 builds its voice phase last on top of P5's module."""
assert s.count(old)==1
s=s.replace(old,new)
old2="""]

const COMMON = (p) => `"""
new2="""  { key: 'P5', name: 'P5-timing', wt: WT + '/wt-p5', items: 'T4 声より0.2秒先に文字を出す, S1 曲から行の頭を自動で下書き, S2 1行だけタップで打ち直し, S4 読み切れない速さの行を知らせる',
    phases: [
      'Build order steps 1–3 (design X.2): the T4 planner fixes (segment.windows clamp, tracks.seams tiers with endWithSeam(…, handover) — P4 also changes endWithSeam for its glyph hand-over: keep the signature additive so both can merge — the extreme pair gate), seams_lead/golden_lead tests; T4 出そろい (core/motion fitMotion cap, times.ready, the planner stage, encoding, timing_ready.test.js, the 入りの基準 UI row); newDoc() writes timing.lead 0.2 (update the doc.test.js newDoc assertion accordingly).',
      'Build order steps 4–5: S4 (planner/readable, doc.timing.readCheck gated by look.gen, ui/readcheck, the lyric-editor gutter, 行 list, timeline, 行 page note and quick fixes, the ④ checklist item, text for the existing warn.time-compressed / warn.piece-merged marks); S2 (core/tap one-line mode and stillPins, the stale-end rule in time.tap, the ui/tap one-line session with loop and auto-finish, the four entry points, toasts, undo labels, tests).',
      'Build order steps 6–7: S1 (audio/voice — the joint record doc.song.voice with P6 exactly as design §2.4.1 specifies —, audio/host/decode, core/timing gapWeights, core/draft, ui/draft review panel with audition and try-on, the ② button, palette entry, 曲の声を読む for older works, one undo entry on apply, tests with tests/helpers/song_gen.js synthetic songs; state the measured accuracy honestly); then strings, the DESIGN_2_2 chapter, NOTES, SPEC, README and AI_GUIDE lines, ui_flows.py flows, visual QA of the 出そろい timing (frame strips around a line start) and of the new UI.',
    ] },
  { key: 'P6', name: 'P6-utahame', wt: WT + '/wt-p6', items: 'S3 歌に合わせて1字ずつ出す「歌ハメ」',
    phases: [
      'Phase A, part 1 (design Phases table): planner/sung (units, anchors, sung window, copy, hook tiers, prepare/decide), core/lyrics enhanced-LRC word tags kept (ParsedRow.words), the sung.times line pin with its scope rules and reconcile, the planner/rules rows (sung.real etc.), cast rule, segment pieces, cut.sung with encode and fingerprint, the engine branches (stagger, behave arrive, shot, kit, underSweep), sung.test.js; every golden unchanged.',
      'Phase A, part 2: core/tap unit reducer and the ui/tap 1字ずつタップ mode (loop, 区切り, 速さ, E, Esc/T, やめる, 決定/もう一度), fields/explain/inspector rows (行 › 演出 「歌ハメ」, 作品全体 › 見た目 「歌ハメ」, 作品全体 › タイミング 「字の時間を歌に合わせる」, 行 › 時間 display and buttons), strings, the new golden tests/golden/project_sung.json entries A1–A4 (after --check matches all six existing goldens).',
      'Phase B (timeline ticks, hit test, drag with the start pin, keyboard; browser tests) and Phase D (the sung.fill slot and the karaoke fill behaviour; the optional ai/song words request and ai/changes extension, review-only; golden entry D1).',
      'Phase C last: first check whether branch p5 already has src/audio/voice.js (git -C $WORKTREES/wt-p6 log p5 --oneline -- src/audio/voice.js); if it does, merge it in with  git -c user.name=momomonbi -c user.email=130516776+momomonbi@users.noreply.github.com merge --no-edit -m "更新" p5  (resolve conflicts, rebuild the pages, keep every golden matching); if not, implement audio/voice exactly as P5 design §2.4.1 specifies (the joint contract). Then doc.song.voice use, command song.voice, 「曲の声を読む」, voiceEnd + snap in planner/sung behind the design constants (off by default), golden entry C1; then the DESIGN_2_2 chapter, NOTES, SPEC, README lines, ui_flows.py flows and visual QA (frame strips of 歌ハメ lines).',
    ] },
]

const COMMON = (p) => `"""
assert s.count(old2)==1
s=s.replace(old2,new2)
open(sp+'/impl-wf2.js','w',encoding='utf-8').write(s)
