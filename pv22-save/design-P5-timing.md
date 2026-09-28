# PV22 package P5 — timing (T4, S1, S2, S4)

**Revision 2** (after the critique; the log is at the end). Base: `main` at 9a9e950 plus the PV22 integration branch
`pv22` (c64b24b; commit 87fde34 adds `D.newDoc()`, `look.gen`, `planner/rules`, `tests/node/doc.test.js` cases and
`tests/node/pv_rules.test.js`; P3's `planner/kime` with `isKime` is on branch `p3`). Every claim about code was read in
those trees. Every number was measured with read-only probes: revision 1 in `scratchpad/pv22/probe/p5/`, revision 2 in
`scratchpad/pv22/probe/p5r/` (a patched copy of `src` with exactly the planner changes of 1.4; listed in X.4). No text
in this design quotes lyrics; examples use placeholder kana.

| Item | Owner request | What this design delivers |
|---|---|---|
| **T4** | 声より0.2秒先に文字を出す | New works start with 入りの早さ 0.2 s (written by `D.newDoc()`; existing works keep what they store). A new setting 「入りの基準」: 動き始め (today) or 出そろい, where an entrance is fitted to end `lead` seconds before the voice. Two planner fixes make any lead above 0.12 s safe: transitions still hand the picture over (the previous line no longer pops back), and a window still overlaps only its neighbours. |
| **S1** | 曲から行の頭を自動で下書き | 「曲から下書き」 in ② 曲: phrase-start candidates stored in the document next to P6's voice data (`doc.song.voice`, one shared module `audio/voice`), a deterministic aligner of the automatic lines onto them, a review panel with audition and try-on, applied as one undo entry. No AI needed; AI timing stays the optional better path. |
| **S2** | 1行だけタップで打ち直し | 「この行だけタップで打ち直す」: a one-line tap mode that loops until the line is marked (and stops looping once the user moves the playhead), finishes by itself after the line, keeps neighbouring automatic lines still (naming them, with an undoable 「ほかの行の固定を外す」), moves a paired end pin with the start, and fixes the stale end pin of `time.tap`. |
| **S4** | 読み切れない速さの行を知らせる | A readability rule (morae per legible second over the visible window, plus a legible-time floor) shown in the lyric editor gutter, the 行 list, the timeline, the 行 page (with quick fixes) and the step ④ checklist. On for new works, off for existing works, with a switch. |

---

## 0. Shared decisions for the package

### 0.1 Base and gating (lead decision 1)

**The new-work document already exists on `pv22`.** `core/doc.newDoc()` = `defaultDoc()` with `look.gen = D.GEN` (1).
It is called only at the three new-work sites: `ui/boot.js:107` (`ST.createStore({ doc: D.newDoc(), … })`, first run
and `?fresh=1`), `ui/project_io.js:610` (`newWork()`, ≡ › 新しい作品) and `ui/project_io.js:1176` (the emptied
device). `defaultDoc()`, `normalize()`, file open, package import, autosave restore, every fixture and every test that
builds from `defaultDoc()` never carry the marker. Pin-based switches read it through `planner/rules`.

P5 adds two new-work defaults. They are settings in `doc.timing`, not pins, so they do not go into the rules table:

1. **入りの早さ 0.2 s** must be **explicit**: `checkTiming` requires `timing.lead` to be a stored number, and
   `normalize` fills a missing lead from `defaultDoc()` (0.12), so it cannot follow the marker. `newDoc()` writes it:

   ```js
   // core/doc (pv22 text of the comment replaced as below)
   // The generation of new documents (look.gen, PV22 / DESIGN_2_2 §0): a document made by newDoc() carries it, and the
   // 文字PV conventions, typesetting and timing defaults of that generation apply to it unless its own settings say
   // otherwise: pinned switches through planner/rules, the 読み切れない速さ notices through ui/readcheck. One timing
   // value is written explicitly, because it is a stored number every document has: timing.lead = NEW_WORK_LEAD.
   // defaultDoc() never carries either: normalize() builds from defaultDoc(), so anything added there would reach
   // every opened project, and the tests and fixtures plan documents made from it.
   const GEN = 1;
   const NEW_WORK_LEAD = 0.2;          // 入りの早さ of a new work (PV22 T4); defaultDoc() keeps 0.12

   function newDoc() {
     const doc = defaultDoc();
     doc.look.gen = GEN;
     doc.timing.lead = NEW_WORK_LEAD;
     return doc;
   }
   ```

   Exports gain `NEW_WORK_LEAD`. The `pv22` test `newDoc is defaultDoc with the generation marker look.gen` changes its
   last assertion to:

   ```js
   assert.equal(doc.timing.lead, D.NEW_WORK_LEAD);
   delete doc.look.gen;
   doc.timing.lead = plain.timing.lead;
   assert.deepEqual(doc, plain, 'newDoc is defaultDoc apart from look.gen and timing.lead');
   ```

   plus a new case: `D.normalize({ look: { …, gen: 1 }, timing: { snap: 'off' } }).timing.lead === 0.12` (a file
   without a lead gets 0.12 even when it carries the marker). `pv_rules.test.js` is unaffected (it reads only rows and
   pins). DESIGN_2_2 §0's first paragraph gains: "…and `timing.lead = D.NEW_WORK_LEAD` (0.2 s, §5)".
2. **読み切れない速さの行を知らせる** resolves an absent value from the marker:
   `RC.enabled(doc) = typeof doc.timing.readCheck === 'boolean' ? doc.timing.readCheck : RULES.gen(doc) >= 1`
   (`ui/readcheck`, L7, may read `planner/rules`). The toggle writes an explicit boolean through `timing.set`.
   `newDoc()` writes nothing for it.

`入りの基準` (`timing.enter`) is absent in every generation (= 動き始め). If the lead wants 出そろい for new works
(1.10-Q1), `newDoc()` writes `doc.timing.enter = 'ready'` next to the lead; nothing else changes.

| Item | New works (`newDoc`) | Existing works and every fixture | Switch |
|---|---|---|---|
| T4 lead 0.2 | `timing.lead: 0.2` written | as stored (every fixture 0.12; `normalize` fills 0.12) | 作品全体 › タイミング › 入りの早さ (exists) |
| T4 入りの基準 | absent = 動き始め | absent = 動き始め | 作品全体 › タイミング › 入りの基準 (new) |
| T4 long-lead hand-over (1.4 f), neighbour clamp (1.4 g) | apply where the geometry needs them | same rule: **bug fixes**, 0.4 | none |
| T4 EXTREME whip pair gate (1.4 h) | geometric test | today's rule, unless 出そろい is chosen | none |
| S4 notices | on (marker) | off (absent) | 作品全体 › タイミング › 読み切れない速さの行を知らせる (new) |
| S4 text for `time-compressed` / `piece-merged` | gutter marks and every line of a squeezed range | tooltip and inspector text only, on the marks that exist today | follows the S4 switch |
| S1 曲から下書き | tool | tool | none: acts only on 適用 |
| S2 この行だけ打ち直す | tool | tool | none |
| S2 stale end pin in `time.tap` | on | on — **bug fix**, 0.4 | none |

### 0.2 Document fields (additive, validated, no schema bump)

| Field | Type | Absent means | Written by |
|---|---|---|---|
| `doc.timing.enter` | `'start' \| 'ready'` | `'start'` | `timing.set` (UI) |
| `doc.timing.readCheck` | boolean | follow `look.gen` (0.1) | `timing.set` (UI toggle) |
| `doc.song.voice.phrases` | string (base64) | "voice not read for S1" | `song.set` at import, `song.voice` (P6's commands), 2.3 |

`core/doc`: `ORDER.timing` becomes `['snap', 'lead', 'tail', 'leadIn', 'outro', 'tapLatency', 'enter', 'readCheck']`
(absent keys are skipped, so files without them serialize byte-identically). `checkTiming` adds

```js
if (timing.enter !== undefined && !ENTER_MODES.includes(timing.enter)) bad('timing.enter', 'must be one of start ready');
if (timing.readCheck !== undefined && typeof timing.readCheck !== 'boolean') bad('timing.readCheck', 'must be a boolean');
```

with `const ENTER_MODES = Object.freeze(['start', 'ready'])` exported. `core/commands.TIMING_KEYS` gains `'enter'` and
`'readCheck'`; `timing.set` already validates through `problemsIn(out, 'timing.<key>')` and is one undo entry per
change, labelled by the field (`undo.setting` is `'{field}'`, so the entry reads 「入りの基準」). An older build keeps the
unknown keys and ignores them. `ORDER.voice` (P6) gains `'phrases'` after `'peaks'`.

### 0.3 Contract changes (all additive for existing data)

| Contract | Change | Why |
|---|---|---|
| `core/motion.fitMotion({ dur, each, count, window, share, cap })` | optional `cap` (s): limit `min(share·window, cap)`; when the cap binds, the single-duration fallback is `cap` itself. Absent → identical results. | 出そろい |
| `core/motion.heroTime(cut, …)` | reads optional `cut.ready`, passes `cap = ready − a` to the arrive fit | repT follows the capped entrance |
| Plan cut | optional `ready` (absolute s), only on cuts opened by 出そろい; printed between `pinKey` and `repT`; fingerprint term only when present | engine cap, caches |
| Engine scene `times` (§4.17.5) | optional `ready` (cut-local s or `null`) | `behave.motionTiming` caps the arrive |
| `planner/plan.run` | stage **6b** `readyWindows` after `TR.seams`, before `XT.shots` | 1.4 a |
| `planner/tracks.seams` / `endWithSeam` | long-lead hand-over (three tiers); `endWithSeam(cuts, j, end, reach, handover)` — the same fifth argument P4 adds for glyph seams | 1.4 f |
| `planner/segment.windows` | neighbour clamp `a_i ≥ b_{i−2}` (never past `t0`) | 1.4 g |
| `planner/extreme.recencyOf` | the whipPan pair needs the two whips to meet, outside legacy documents | 1.4 h |
| `core/tap` TapState | `only`, `from`, `stop`; `tapStart(lines, fromLineId, opts)`; pure `stillPins()` | S2 |
| `core/timing` | exports `gapWeights(lines, ctx)`, `MIN_LEN` | S1 priors, S2 |
| `core/commands.timeTap` | removes a stale `line/<id>:end` pin | S2 bug fix |
| `audio/voice` (P6's module; joint contract 2.4.1) | per-bin centred activity, its own vocal-band flux, the phrase stream `phrases`; `audio/analyze` stays unchanged (P6's `onset.vocal` is not needed) | S1 + P6 share one notion of the voice |
| New modules | `core/draft` (L0), `planner/readable` (L2), `ui/draft` (L7), `ui/readcheck` (L7) | S1, S4 |
| `ui/keys` | context `'draft'`; `ui/view` MODES += `'draft'`; `ui/icons` += `wave` | S1 |
| Warning code | `'too-fast'` (UI-computed, never in `plan.warnings`) | S4 |

No SCH enum, POSE column, seam mix contract (renderer), registry shape or EXTREME preset (FROZEN table) changes.
`tests/node/contract.test.js` checks that listed exports exist; the additions pass it.

### 0.4 Behaviour changes that reach existing works (called out)

All four change nothing in any golden (proved by test 1.7-4 and by the existing golden tests); each fixes a defect.

1. **Long-lead hand-over** (1.4 f): runs only when a centred transition is shorter than twice the gap between the new
   line's window start and the old line's sung end. Never at lead 0.12 on the 253 golden documents. Existing works whose
   lead is ≥ about 0.15 s stop showing the old line again for 1–2 frames after a transition.
2. **Neighbour clamp** (1.4 g): never binds at lead 0.12 on the golden documents; at lead 0.2 it moves `a` of 15 cuts in
   18 plans by at most 0.021 s.
3. **Stale end pin** in `time.tap` (3.4): an end pin earlier than the new start + 0.2 s is removed (a lock pin is kept).
4. **S4 text** on the 「!」 marks that exist today (tooltips and the 行 page note), no new marks (4.2).

---

## 1. T4 — 声より0.2秒先に文字を出す

### 1.1 What the user gets

- 作品全体 › タイミング (collapsed section `sec.timing`, `ui/fields.js:309`):
  - **入りの早さ** (existing `fld.lead`, 0–10 s) gets the note 「声より何秒前に文字を出すか。0.2秒前後が目安です。」.
    A new work shows **0.2**; an existing work shows what it stores (usually 0.12).
  - **入りの基準** (new, choice, right under 入りの早さ): **動き始め** (default) / **出そろい（読める）**, with a note.
    - 動き始め: the entrance starts `lead` s before the sung start (today's rule, `segment.windows`).
    - 出そろい: the entrance **ends** `lead` s before the sung start, so the line is readable by then; entrances are
      shortened to at most 0.45 s. A line keeps 動き始め when something else times its entrance: a transition
      (切り替え) into it, a new background starting with it, 歌に合わせて1字ずつ (P6's 歌ハメ), 見せ場 (!) and キメ
      (P3) lines, and lines without an entrance motion. With 入りの早さ 0, 出そろい means "fully in at the sung start".
- Each change is one undo entry named by the field: 「入りの基準」 (`undo.setting` = `'{field}'`).
- Subtitles (SRT/LRC of the Filmora set) keep the sung start (`export/subtitles` reads `t0`).

**Measured effect** (probe `p5r/share.js`, fake measurer, engine times; stored fixtures):

| fixture (line cuts) | fully in by `t0 − lead`, 動き始め 0.2 | 出そろい 0.2 | cuts opened | not opened: transition in / new background / 見せ場 / no entrance / no room |
|---|---|---|---|---|
| basic (17) | 0.00 | 0.47 | 8 | 6 / 2 / 1 / 0 / 0 |
| lrc (27) | 0.11 | 0.37 | 7 | 16 / 2 / 1 / 1 / 0 |
| long (245) | 0.03 | 0.62 | 143 (21 limited by the neighbour floor) | 76 / 9 / 5 / 7 / 5 |
| vertical (15) | 0.00 | 0.87 | 13 (4 floor-limited) | 0 / 2 / 0 / 0 / 0 |

Every opened cut is fully in by its `ready` time (143 + 8 + 7 + 13 of 171). Over 6 fixtures × 3 seeds, 617 of 1 092 line
cuts are opened at lead 0.2 (640 at lead 0). An opened window starts 0.65 s before the voice (p50 = p90) and overlaps
the previous cut's window by 0.90 s (p50), against 0.45 s with 動き始め 0.2 and 0.37 s today. The lines entered by a
transition are the largest group left out; opening them would need the transition to hand over earlier than the old
line's sung end (1.10).

### 1.2 Gating and defaults

See 0.1. New works: `lead 0.2`, `enter` absent. Existing works and every fixture: `lead` as stored, `enter` absent
(動き始め). Absent `enter` is byte-identical to `enter: 'start'` in plans and frames (test 1.7-2). The fixes 1.4 f–h
never change a document at lead 0.12 without 出そろい (test 1.7-4).

### 1.3 Data model

- `doc.timing.enter` (0.2). `timing.lead` keeps its meaning for 動き始め; for 出そろい it is "seconds before the sung
  start by which the entrance has ended".
- Plan cut `ready` (optional, absolute, `q6`): the time by which the entrance must have ended; only on cuts the 出そろい
  pass opened. Engine `times.ready = cut.ready − cut.t0`, else `null`.
- No migration.

### 1.4 Algorithm

**(a) The 出そろい pass — stage 6b of `planner/plan.run`.**

```js
// 6. tracks: grounds → seams → 出そろい → EXTREME shots → carry → rigs → impulses
const grounds = TR.grounds(ctx, cuts, duration);
const seams = TR.seams(ctx, cuts);
ctx.seams = seams;
if (ctx.timing.enter === 'ready') readyWindows(ctx, cuts);    // 6b (PV22 T4)
XT.shots(ctx, cuts);
CAM.carry(ctx, cuts, seams);
const rigs = CAM.rigs(ctx, cuts, seams, duration);
```

Why this place:
- after cast (stage 5): the arrive part and its `dur`/`each` are known;
- after `TR.grounds`: segment starts are the **unopened** `a` of each segment's first cut, and the pass never opens a
  first cut (the "new background" skip), so every opened window stays inside its own ground segment;
- after `TR.seams`: every seam is centred on an unopened `a` and every clip is done; the pass never opens a cut with a
  seam into it (`seamIn ≥ 0`), so no seam's `at`, `dur` or clip depends on the pass. P2's seam gate and P4's morph rule
  (both inside `decideSeam`) see 動き始め windows, and a morph target (P4's `glyphMorph` replaces B's arrive) is never
  opened;
- before `XT.shots`, `CAM.carry`, `CAM.rigs`: the EXTREME pair gate (h) reads the opened `a`, and a section camera run
  whose first cut is opened starts when that line begins to enter — the same relation as today (a rig run starts at
  its first cut's `a`; without a seam into it there is no blend, so starting it at the unopened `a` would jolt the
  frame while the new line is already being read). Measured: 5 rig starts in 18 plans move.

```js
const READY = Object.freeze({ ROOM: 0.45 });   // the longest entrance under 出そろい (s); exported for tests

function readyWindows(ctx, cuts) {
  const lead = ctx.timing.lead;
  for (let i = 0; i < cuts.length; i++) {
    const c = cuts[i];
    if (!c.line) continue;                                   // title, interlude, outro
    if (c.impact || KI.isKime(c)) continue;                  // 見せ場 and キメ land on the voice (P3's accessor)
    if (c.seamIn >= 0) continue;                             // a transition into the cut times its entrance
    if (i > 0 && c.ground !== cuts[i - 1].ground) continue;  // a new background starts with this cut
    const d = c.slots.arrive;
    if (d && d.p && d.p.order === 'sung') continue;          // revealed as sung (P6's 歌ハメ sets this order)
    const inst = instantOf(ctx, 'arrive', d);
    if (!inst) continue;                                     // no entrance motion: a = t0 − lead already shows it
    const count = unitCount(ctx, c);
    const total = inst.dur + inst.each * Math.max(0, count - 1);
    const A = Math.min(READY.ROOM, Math.max(MO.MIN_DUR, total));
    const ready = N.q6(c.t0 - lead);
    const floor = i >= 2 ? cuts[i - 2].b : i === 1 ? Math.max(0, cuts[0].t0) : 0;  // b after the seams' clips
    const a = N.q6(Math.min(ready, Math.max(floor, ready - A)));
    if (ready - a < MO.MIN_DUR - 1e-9 || a >= c.a - 1e-9) continue;   // no room, or nothing to open: keep 動き始め
    c.a = a;
    c.ready = ready;
  }
}
```

`planner/plan` imports `planner/kime` (already on `p3`). `c.b` is never changed. Invariants (test 1.7-2): I1 `a_i ≥
b_{i−2}` for i ≥ 2; I2 `a` non-decreasing; I3 an opened cut's `a ≥ grounds[c.ground].t0`; I4 no cut with `ready` has
`seamIn ≥ 0`; I5 the engine's `times.rest ≤ times.ready`. Measured (probes `p5r/inv.js`, `p5r/i3.js`, `p5r/share.js`;
6 fixtures × 3 seeds): 0 violations of I1–I4 for the 640 / 617 / 538 opened cuts at lead 0 / 0.2 / 0.5, and of I5 for
every opened cut of the four engine-checked fixtures; no cut's `a` lies after its `t0`. Deterministic: a pure function
of the skeletons and `ctx.timing`.

**(b) Engine cap.**
- `engine/scene/build.js timesOf(cut)` returns `{ a, rest, out, b, ready: typeof cut.ready === 'number' ? cut.ready −
  cut.t0 : null }`.
- `engine/scene/behave.js motionTiming(env, target, p, kind, unit)`, non-`sung` branch:

  ```js
  const cap = kind === 'arrive' && typeof times.ready === 'number' ? Math.max(0, times.ready - times.a) : undefined;
  const fit = MO.fitMotion({ dur: p.dur, each: p.each, count: R.count, window: span, share, cap });
  ```

  The `sung` branch ignores `ready`. `motionTotal`, the kit adapters (`glyphMotionMaker`) and `arrivals()` all go
  through `motionTiming`, so `fitTimes` gives `rest ≤ ready` and the adapters run the same delays (the only non-kit
  arrive code, `parts/arrive/digital.js`'s caret, reads the kit glyph behaviour's own times).

**(c) `core/motion.fitMotion`.**

```js
function fitMotion({ dur, each, count, window, share = 1, cap }) {
  const d = nonNegative(dur), e = nonNegative(each);
  const gaps = Number.isFinite(count) && count > 1 ? Math.floor(count) - 1 : 0;
  const shareLimit = share * nonNegative(window);
  const capped = typeof cap === 'number' && cap < shareLimit;
  const limit = capped ? nonNegative(cap) : shareLimit;
  const total = d + e * gaps;
  if (total <= limit) return { dur: d, each: e, total };
  if (d < limit && gaps > 0) return { dur: d, each: (limit - d) / gaps, total: limit };
  const fitted = capped ? limit : Math.max(MIN_DUR, limit);
  return { dur: fitted, each: 0, total: fitted };
}
```

The pass guarantees `cap ≥ MIN_DUR`.

**(d) `core/motion.heroTime(cut, arrive, depart, count)`**: `A = fitMotion({ …motionOf(arrive), count, window, share:
SHARE.arrive, cap: typeof cut.ready === 'number' ? cut.ready − a : undefined }).total`; `planCut` passes `{ a: c.a, b:
c.b, ready: c.ready }`.

**(e) Encoding and caches** (`planner/plan.js`, `planner/encode.js`):
- `planCut`: `if (c.ready !== undefined) out.ready = c.ready;` (after `pinKey`).
- Fingerprint: after `if (mine) extra.push(mine);` add `if (out.ready !== undefined) extra.push('r' + N.q6(out.t0 −
  out.ready));`. The engine's scene cache is keyed by `fp`; a floor-limited cut keeps `t0 − a` and `b − a` when the lead
  changes while its cap moves. Measured (probe `p5r/fp.js`, three LRC lines 0.5 s apart): without the term the third
  cut has the same fp at lead 0.2 and 0.3 although `ready` moves from 10.8 to 10.7.
- `encodingKey`: append `out.ready === undefined ? null : N.q6(out.t0 − out.ready)` (in-memory key).
- `timesOf(out)` → `[a, b, t0, t1, repT, ready]`; `sameTimes` compares index 5 too. `encode.retimeCut` goes through
  `cutPieces`, which prints `ready`, so a retimed cut prints its new `ready`.
- `encode.cutPieces`: `mid` gets `ready: cut.ready` between `pinKey` and `repT` (alphabetical; `JSON.stringify` drops
  `undefined`). `encodeCutParts`: `if (cut.ready !== undefined) put('ready', canon(cut.ready));` before `put('repT', …)`.
- `core/types.js` Plan cut: `@property {number} [ready]  出そろい: the entrance ends by this time (T4)`.

**(f) Long-lead hand-over — `planner/tracks.seams` (all works; bug fix 0.4-1).**

A transition hands the picture to B at the end of its window, `at + dur/2`; `endWithSeam` clips A there but never below
its sung end `A.t1` (§3.12 b). With `at = B.a = B.t0 − lead` and `A.t1 ≈ B.t0`, that is safe only while `lead ≤
dur/2`. Measured over 6 fixtures × 3 seeds (345 seams; probes `critic_p5/t4seam2.js`, `t4seam3.js`): lead 0.12 → A
outlives the window in 0 seams; lead 0.2 → 82 (p50 0.020 s, max 0.065 s), among them 56 of 128 world seams and 68 of
the 262 seams that replace A's exit (A comes back at full strength). Every new work has lead 0.2.

For a **centred** seam (`def.ends !== true`; P4's glyph seams keep their own window and hand-over), after today's `dur`:

```js
let at = B.a, handover = def.glyphs === true;           // P4 M4.4.5 sets at/handover for its glyph seams
const need = A.t1 - B.a;                                 // how long A must still be shown after B's window opens
if (def.ends !== true && dur / 2 < need - 1e-9) {
  const cap = Math.floor(Math.min(limit, def.scope === 'world' ? WORLD_MAX : Infinity) * 1e6) / 1e6;
  if (dur >= need - 1e-9) at = N.q6(A.t1 - dur / 2);                              // tier 1: slide the window later
  else if (cap >= need - 1e-9) { dur = Math.floor(need * 1e6) / 1e6; at = N.q6(B.a + dur / 2); }  // tier 2: lengthen
  else handover = true;                                  // tier 3: keep the window, A ends with it (below its t1)
}
B.seamIn = out.length;
out.push({ a: A.key, at, b: B.key, dur, into: B.key, scope: def.scope, slot: d });
if (def.replaces && def.replaces.depart) replaceMotion(ctx, A, 'depart');
if (def.replaces && def.replaces.arrive) replaceMotion(ctx, B, 'arrive');
reach = endWithSeam(cuts, j, at + dur / 2, reach, handover);
```

`endWithSeam(cuts, j, end, reach, handover)` is P4's signature: with `handover`, A's `b = min(b, stop)` without the
`t1` floor; the cuts before A keep the floor. In every tier the window still contains `B.a` (tier 1: `A.t1 − dur ≤
B.a` because `dur ≥ need`; tier 2: the window is `[B.a, A.t1]`; tier 3: today's window), so B is never drawn before
its transition starts, and a world seam's ground switch (the segment start, B's `a`) stays inside the window. The
rig blend (`CAM.rigs`, from `s.at`, `s.dur`) follows. Measured (probe `p5r/inv.js`, 345 seams per row):

| lead, mode | tier 1 | tier 2 | tier 3 | A past the window | B before its window |
|---|---|---|---|---|---|
| 0.12 動き始め | 0 | 0 | 0 | 0 | 0 |
| 0.2 動き始め, 0.2 出そろい | 82 | 0 | 0 | 0 | 0 |
| 0.5 動き始め | 220 | 84 | 3 | 0 | 0 |
| 1.0 動き始め | 63 | 103 | 168 | 0 | 0 |

Tier 1 alone would leave B drawn before its window at long leads (8 seams at 0.3, 87 at 0.5, 78 of them world seams
whose background would switch before the transition): hence tiers 2 and 3.

**(g) Neighbour clamp — `planner/segment.windows` (all works; bug fix 0.4-2).**

```js
function windows(cuts, timing) {
  for (let i = 0; i < cuts.length; i++) { /* a = q6(t0 − lead), b = … (unchanged) */ }
  // A window overlaps only its neighbours' (engine/scene/budget): a cut starts no earlier than the end of the cut two
  // before it, and never after its own sung start. Never binds at lead 0.12 on the golden documents (test 1.7-4).
  for (let i = 2; i < cuts.length; i++) {
    const c = cuts[i], floor = cuts[i - 2].b;
    if (c.a < floor) c.a = Math.min(c.t0, floor);
  }
}
```

Measured: at lead 0.2, 12 windows in 18 plans overlapped a non-neighbour by 0.021 s; with the clamp 0 (15 cuts
clamped); at 0.12 none clamped. The `t0` cap never bound in `corpus(5)` × 4 fixtures at leads 0.12, 0.2, 0.5 (probe
`p5r/clampcap.js`); where it would (a cut shorter than the tail between two others), the text still starts no later than
its voice and the invariant test skips exactly those cuts (`b_{i−2} > t0_i`).

**(h) EXTREME whipPan pair — `planner/extreme.recencyOf` (new works and 出そろい only).**

The pair rule (×6 and the same direction after a whipPan of the same section with a hard cut) relies on A's whip-out
(`b − 0.37 … b − 0.25`, FROZEN preset) meeting B's whip-in at `a`. Measured over 739 hard-cut line pairs of one section
(probe `p5r/whip.js`): they meet (|Δ| ≤ 0.03 s) in 739 at lead 0.12 and in 0 at lead 0.2 (動き始め or 出そろい).

```js
const WHIP_OUT = 0.37, WHIP_MEET = 0.03;
// pass(): prev = j > 0 ? cuts[j − 1] : null; recencyOf(win, cut, next, free, prev, legacy)
// legacy = RULES.gen(ctx.doc) < 1 && ctx.timing.enter !== 'ready'   (computed once per run in shots())
const meets = !!prev && Math.abs(prev.b - WHIP_OUT - cut.a) <= WHIP_MEET + 1e-9;
const pair = !!last && last.key === 'whipPan' && last.section === cut.feat.section && !(cut.seamIn >= 0)
  && (legacy || meets);
```

Every existing document (no marker, 動き始め) keeps today's rule; `project_extreme.json` is unchanged. In new works at
lead 0.2 the pair boost does not apply (the whips would not meet); a whipPan may still follow a whipPan by its own
weight. `planner/extreme` gains the dependency `planner/rules`.

### 1.5 Changes by module and function

| Module | Function | Change |
|---|---|---|
| `core/doc` | `newDoc`, `NEW_WORK_LEAD`, comment, `ORDER.timing`, `checkTiming`, `ENTER_MODES` | 0.1, 0.2 |
| `core/commands` | `TIMING_KEYS` | `+ 'enter', 'readCheck'` |
| `core/motion` | `fitMotion`, `heroTime` | (c), (d) |
| `planner/plan` | `run` stage 6b, `readyWindows`, `READY`, `planCut`, `encodingKey`, `timesOf`, `sameTimes`; import `planner/kime` | (a), (e) |
| `planner/encode` | `cutPieces`, `encodeCutParts` | print `ready` when present |
| `planner/tracks` | `seams` (tiers), `endWithSeam(…, handover)` (shared with P4) | (f) |
| `planner/segment` | `windows` | (g) |
| `planner/extreme` | `shots` (legacy flag), `pass` (prev), `recencyOf` (meets) | (h) |
| `engine/scene/build` | `timesOf` | `ready` |
| `engine/scene/behave` | `motionTiming` | arrive cap |
| `core/types` | Plan cut | `ready` |
| `ui/fields` | `sec('timing')` | `fld.lead` gets `note: 'fld.lead.note'`; after it `F({ cmd: { t: 'timing.set', key: 'enter' }, scopes: WORK, widget: 'choice', label: 'fld.enter', options: [{ v: 'start', label: 'fld.enter.start' }, { v: 'ready', label: 'fld.enter.ready' }], note: 'fld.enter.note' })` |
| `ui/inspector` | `cmdValue` | `timing.set` + `enter` → `doc().timing.enter \|\| 'start'` |
| docs | DESIGN §3.1 timing keys, §3.12 cut fields and fp inputs, §3.12 b (hand-over tiers, P4's exception), §4.7 `fitMotion`/`heroTime`, §4.16 stage 6b and `windows` clamp, §4.16.6 seam placement, §4.17.5 `times.ready`; DESIGN_2_1 §14 pair rule note; DESIGN_2_2 §0 and the P5 chapter; SPEC §4 | text |

### 1.6 Strings

| Key | ja | en |
|---|---|---|
| `fld.lead.note` | 声より何秒前に文字を出すか。0.2秒前後が目安です。 | How many seconds before the voice the text comes in. About 0.2 s is a good start. |
| `fld.enter` | 入りの基準 | Lead measured to |
| `fld.enter.start` | 動き始め | Start of the entrance |
| `fld.enter.ready` | 出そろい（読める） | Fully in (readable) |
| `fld.enter.note` | 動き始め: 入りの動きが始まる時刻を声より前にします。出そろい: 入りの動きを終えて読める時刻を声より前にします（入りの動きは0.45秒までに縮めます）。切り替えで入る行、背景が変わる行、歌に合わせて1字ずつ出る行、見せ場（!）とキメの行はそのままです。 | Start: the entrance starts this long before the voice. Fully in: the entrance ends, and the text can be read, this long before the voice (entrances are shortened to 0.45 s at most). Lines that come in with a transition or a new background, lines revealed as they are sung, and impact (!) and kime lines keep their timing. |

### 1.7 Tests

1. `tests/node/doc.test.js` (the `pv22` case, 0.1): `newDoc().timing.lead === D.NEW_WORK_LEAD`; newDoc equals
   defaultDoc apart from `look.gen` and `timing.lead`; `defaultDoc().timing.lead === 0.12`; normalize of a marked file
   without a lead → 0.12; `validate` refuses `enter: 'x'` and `readCheck: 1`; `serialize(defaultDoc())` has no new key.
   *Mutation:* `lead: 0.2` in `defaultDoc` → the equality and normalize cases fail.
2. `tests/node/timing_ready.test.js` (new):
   - absent vs `enter: 'start'`: the same `plan.hash` on basic/lrc/long/vertical × 2 seeds; no cut has `ready`.
   - 出そろい at lead 0.2 and 0 on basic/lrc/long/vertical/v21/repeat × 3 seeds: I1–I5 of (a) hold; every cut with
     `ready` has `a ≤ ready − MIN_DUR`, `seamIn === −1`, the ground of the cut before it, no impact, not `KI.isKime`,
     no `sung` order, an arrive motion; every other cut has the `a` of the 動き始め plan of the same document.
   - 100 % of cuts with `ready` are fully in by `ready` (`buildCut(...).times.rest ≤ ready − t0 + 1e-9`); the share of
     line cuts fully in by `t0 − lead` is reported and is higher than under 動き始め by at least 0.2 on each of the four
     fixtures (measured differences 0.47, 0.26, 0.59, 0.87).
   - `repT` equals `MO.heroTime` with the cap (hand computation for 3 cuts).
   - determinism: two fresh runs equal; cached vs fresh (`PL.run(doc, reg, { fresh: true })`) equal after the edit
     sequence start → ready → lead 0.3 → lead 0 → start (kills a missing `encodingKey` term).
   - fingerprint: three LRC lines 0.5 s apart (placeholder kana) under 出そろい; the third cut is floor-limited
     (`a` equal at lead 0.2 and 0.3) and its `fp` differs between the two leads. *Mutation:* drop the `'r'` term → equal.
   - *Mutations:* remove the cap in `behave.motionTiming` → rest > ready; remove the floor → I1 fails; drop the `sung`
     skip → the pinned `sung` cut gets `ready`; drop the `seamIn` skip → I4 and the hand-over invariant of 3 fail;
     drop the ground skip → I3 fails.
3. `tests/node/seams_lead.test.js` (new): over basic/lrc/long/vertical/v21/repeat × 3 seeds × lead {0.12, 0.2, 0.3,
   0.5, 1.0} × {動き始め, 出そろい}: for every seam with `ends` absent, into B = `cuts[j]`, A = `cuts[j − 1]`:
   `A.b ≤ floor6(at + dur/2) + 1e-6` and `at − dur/2 ≤ B.a + 1e-6`; for every i ≥ 2 with `cuts[i−2].b ≤ cuts[i].t0`:
   `cuts[i].a ≥ cuts[i−2].b − 1e-9`; every `a ≤ t0`. A hand-made case per tier (short seam pin with lead 0.2, 0.5
   and 1.0) checks the tier by its `at`/`dur`/`A.b`. *Mutations:* remove tier 2 → "B before its window" at lead 0.5;
   remove tier 3 → "A past the window" at lead 1.0; remove the clamp → the neighbour assertion at lead 0.2.
4. `tests/node/golden_lead.test.js` (new, the proof for 0.4): over the 253 golden documents (`corpus.corpus()`,
   `corpus.projects()` with and without `withoutCamerawork`, `repeat`, `FM.goldenDoc(media)`, `v21`,
   `extreme_docs.goldenDocs()`): every cut has `a === q6(t0 − lead)` (no clamp, no opening), no cut has `ready`, every
   centred seam has `at === B.a` and the `dur` of today's formula, every A of a seam without glyphs has `b ≥ t1`.
   Measured with the patched copy: 0 differences in plan hash and 0 branch hits on all 253.
5. `tests/node/motion.test.js` (extend): `fitMotion` with `cap` (stagger shrinks first, then duration; `cap ≥
   share·window` is ignored); 1 000 seeded inputs without `cap` equal a frozen copy of the old formula.
6. `tests/node/extreme.test.js` (extend): a gen-1 document with `cam.extreme` pinned at lead 0.2 → no `pair` in the
   trace after a whipPan; the same at lead 0.12 → pair where the whips meet; a document without the marker → today's
   pairs (the existing cases stay green).
7. `tests/node/commands.test.js`: `timing.set enter 'ready'` / `'start'` accepted, `'x'` → `CommandError('payload')`.
8. `tests/node/ui_fields.test.js`: 作品全体 › タイミング has `timing.set.enter` (choice, 2 options) after
   `timing.set.lead`; `fld.lead` has a note.
9. `tests/browser/ui_flows.py` flow 「入りの基準」: `?fresh=1` → 詳細 › 作品全体 › タイミング shows 入りの早さ 0.2 and
   入りの基準 動き始め; choose 出そろい → one undo entry 「入りの基準」; the stage redraws; 元に戻す restores 動き始め.
10. Visual QA (contact sheets, `tests/browser/contact_sheet.py` with a 出そろい variant and lead 0.2): overlapping
   lines under 出そろい; world seams at lead 0.2 (tier 1) — frames at `at − dur/2`, `at`, `at + dur/2` of five world
   seams; whipPan neighbours in a gen-1 EXTREME document.

### 1.8 Goldens

- `frame_hashes_v2.json` (FROZEN), `frame_hashes.json`, `plan_hashes.json`, `project_media.json`,
  `project_repeat.json`, `project_extreme.json`: their documents store `lead 0.12`, no `enter`, no `look.gen`. Stage 6b
  never runs; no cut gets `ready`; `fitMotion` gets no `cap`; the encoder prints nothing new; the hand-over tiers and the
  clamp never bind (test 4; measured 0 hits on 253 documents); the pair gate takes the legacy branch. Byte-identical.
- New golden: none required. Optional after visual QA (lead's choice): `tests/golden/project_ready.json` = plan hash +
  frame hashes of `basic` with `enter: 'ready'`, lead 0.2.

### 1.9 Performance

Stage 6b: O(cuts), only under 出そろい (≈ 0.02 ms per cut). The hand-over test is two comparisons per seam; the clamp
one per cut; the pair gate one per cut with EXTREME on. The engine adds one comparison per `motionTiming`. `perf.py`
rows and the re-planning speed test use fixtures at lead 0.12: unchanged cost class.

### 1.10 Risks and open questions

- **Q1 (lead):** new works get 動き始め 0.2 (the owner's number; smallest change of look). 出そろい is the readability
  option; it opens 37–87 % of line cuts. If visual QA prefers it for new works, `newDoc()` writes `enter: 'ready'`.
- **Lines entered by a transition stay 動き始め under 出そろい** (the biggest group left out: 6/17, 16/27, 76/245).
  Opening them would make the transition hand over up to 0.65 s before the old line's sung end. Not done.
- **Overlap under 出そろい:** two lines share the screen ≈ 0.9 s (p50) instead of 0.45 s; ROOM 0.45 is the knob.
- **Existing works with a custom lead** see the hand-over and clamp fixes (0.4); a pinned short transition may become
  longer (tier 2) or cut the old line off at the transition's end (tier 3, leads ≥ 0.5 s).
- **Whip pairs** do not form in new works at lead 0.2 (h). An engine-side alternative (moving B's whip-in anchor) was
  rejected: it changes the whip timing of every whipPan cut in every document whose lead differs from 0.12.
- **Arrive flash effects** (`engine/render/post.whenWeight`, 0.2 s after `rest`) fire before the voice under 出そろい.
  Accepted (they follow the text).
- `engine/facade.js SAMPLE` (part thumbnails) keeps lead 0.12: cosmetic.

### 1.11 Interactions

- **P2:** T4 moves windows, not parts. P2's T5 load and seam gate run before stage 6b and see 動き始め windows; the
  extra overlap under 出そろい is text over text, which T5's cap does not count as an effect.
- **P3:** `KI.isKime(c)` and `c.impact` cuts are never opened. P3's `KIME_HOLD` changes `solveTimes`, not windows.
- **P4:** a `glyphMorph` seam replaces B's arrive inside `TR.seams`, before 6b; such a B has `seamIn ≥ 0` and is never
  opened, so it has no `ready` and `a = t0 − lead` (test with P4's fixture in `timing_ready.test.js`). With lead 0.2
  (動き始め) the morph window `[B.a − dur, B.a]` ends 0.2 s before the voice. The hand-over tiers skip `ends: true`
  seams; `endWithSeam`'s fifth argument is shared (P4 passes `def.glyphs === true`, P5 adds tier 3).
- **P6:** cuts whose arrive order is `sung` are skipped (P6's 歌ハメ sets `p.order = 'sung'` by rule); the `sung` branch
  of `motionTiming` ignores `ready`. P6's rule `dur = clamp(lead, 0.06, 0.25)` reads the new-work lead 0.2.
- **S4:** reads the final windows (after 6b, the tiers and the clamp) and the capped entrance.

---

## 2. S1 — 曲から行の頭を自動で下書き

### 2.1 What the user gets

- **② 曲**: under 「タップで合わせる」, a chip button **「曲から下書き」** (icon `wave`), shown when a song is set
  (`doc.song`), enabled when the work has lines. Tooltip 「曲の声の出だしを探して、行の開始時刻を下書きします（AIなし）」.
  Palette: 「曲から行の頭を下書き」 (`time.draft`).
- Clicking opens the **下書き** panel in the step column (`view.state.mode = 'draft'`):
  1. **The voice is read** (`doc.song.voice` with `phrases`; every song imported with this build has it, P6 reads it at
     import): straight to the review. The song file does not need to be linked.
  2. **The voice is not read yet** (a song imported by an older build): 「曲の声をまだ読んでいません。読むと声の出だし
     から下書きできます。」
     - song linked this session (`app.songReady()`): **[声を読んで下書き]** runs P6's 「曲の声を読む」
       (`song.voice`, its own undo entry 「曲の声を読む」, progress 「曲の声を読んでいます… {pct}%」 and [中止]), then
       the review;
     - not linked: **[曲をつなぎ直す]** (`app.pickRelink`, then as above) and **[音量だけで下書き（精度は低め）]**
       (the loudness digest, 2.4.1 `fromDigest`).
  3. **Review**: header 「{n}行の開始を下書きしました」 and 「確か {a}・たぶん {b}・自信なし {c}」. One row per drafted
     line: checkbox, 「{n}」, the line text (ellipsis), 「{from} → {to}」, a confidence mark (◎ 確か / ○ たぶん /
     △ 自信なし) and **[▶]** (plays from `to − 1.0 s` for 3 s; disabled with the tooltip 「曲のファイルをつなぐと聞け
     ます」 when the song is not linked). Buttons **[すべて選ぶ]** **[確かなものだけ]** **[適用]** **[やめる]**;
     checkboxes **「当てて見る」** (default on: the stage previews the work with the checked starts,
     `app.tryOn(trialDoc, 'draft')`, play bar strip 「下書きを試写中 [適用] [やめる]」) and **「固定・タップした行も
     下書きし直す」** (default off, 2.4.4). The timeline shows each proposal as a blue tick on its line row (dashed when
     unchecked). When at least 3 drafted lines had a tapped start, the header adds 「タップした時刻との差が0.3秒以内:
     {k}/{n}行」. Footer hint: 「ずれている行は、行を選んで『この行だけタップで打ち直す』で直せます。」 With AI on
     (`prefs.ai`) a link 「AIでタイミング（より正確）」 runs the existing `ai.align`.
  4. **[適用]**: one undo entry 「曲から下書き（{n}行）」; toast 「{n}行の開始を下書きしました」 with 「再生して確認」.
     **[やめる]** / Esc: nothing is recorded (a voice read in step 2 stays, as its own undo entry).
- Drafted lines: those whose start is automatic (`plan.lines[i].by.start === 'auto'`), and with 「固定・タップした行も
  下書きし直す」 also those whose start pin is by `'tap'` or `'user'`. LRC stamps, AI pins and lock pins are always kept
  and used as fixed anchors. With nothing to draft: toast 「自動で並んでいる行がありません（すべての行の開始が決まって
  います）」.
- Checked by default: ◎ and ○. △ rows start unchecked (they stay as they are and are re-spread between applied ones).

Honest accuracy statement (also in DESIGN): this is a **draft**. On synthetic mixes (2.4.5) 79 % of line starts land
within ±0.15 s with a centred voice and pauses, 52–58 % with loud accompaniment or an off-centre voice, 40 % when the
singing never pauses. On real songs expect less; see the release gate (2.10).

### 2.2 Gating and defaults

A tool: changes nothing until [適用] (one `time.tap`); the optional voice read is P6's own command. No new document
field of its own besides the `phrases` stream in P6's voice record. Works without AI.

### 2.3 Data model

- **One voice record, shared with P6**: `doc.song.voice = { v: 1, hz: 25, act, peaks, phrases }`. `act` and `peaks`
  are P6's (S3 "Song voice"); `phrases` is P5's: a base64 byte stream of records `(Δ, k)` in time order — `Δ` =
  centiseconds since the previous record (the first since 0) as unsigned LEB128, `k` = one byte: bit 7 set for a
  phrase candidate, clear for a weak candidate; bits 0–6 = `round(127 · s)`. ≈ 3–4 records per second of song →
  about 2.5–3.2 KB of base64 for 4 minutes (measured 276–355 records per 90 s).
- `core/doc` `checkSong` (P6's check) additionally requires `typeof voice.phrases === 'string'` when present;
  a v-1 record without `phrases` is accepted and treated by S1 as "voice not read" (2.1 step 2). `ORDER.voice =
  ['v', 'hz', 'act', 'peaks', 'phrases']`. Not in `SONG_DEFAULTS`, so `normalize` never writes it.
- Applied starts: `line/<id>:start` pins **by `'tap'`** through `time.tap` (timed against the song; `'draft'` in
  `D.PIN_BY` would need a schema bump). `time.tap` also brings the stale-end rule (3.4).
- In memory only (`ui/draft` closure): the decoded voice (P6's `VO.decode`, memoized by object identity), the review
  state. Nothing goes into `side`.

### 2.4 Algorithm

#### 2.4.1 `audio/voice` — the joint contract with P6 (L1, deps `audio/fft`, `audio/digest`)

One pass over the decoded song computes P6's curve and peaks and P5's candidates from the same spectra. It replaces
P6's S3.4 (i) where they differ: the activity is per-bin (not band totals), the pass computes its own vocal-band flux
(so `audio/analyze` stays unchanged and P6's `onset.vocal` is not added), and the record gains `phrases`.

```js
const VC = Object.freeze({
  HZ: 100, WIN: 1024, BAND: [250, 3500],       // frames per second (hop 10 ms), FFT window, vocal band (Hz)
  SIDE: 1,                                      // centred power per bin: max(0, |M|² − SIDE·|S|²)
  MED: 4,                                       // median filter half-width (±40 ms): drops drum hits
  FLOOR_P: 0.10, TOP_P: 0.95,                   // activity 0 at the song's 10th percentile, 1 at its 95th
  LOW: 0.35, HIGH: 0.55,                        // hysteresis on the activity
  GAP_S: 0.15, AFTER_S: 0.3, FULL_GAP_S: 0.5,   // pause before a phrase start; look-ahead; the pause for a full score
  REFINE: [-6, 3],                              // frames around the rise searched for the strongest band flux
  WEAK: 0.3, WEAK_MIN: 0.5, WEAK_SEP_S: 0.25,   // weak candidates: band-flux peaks inside voiced stretches
  STORE_HZ: 25,                                 // P6's stored activity (mean of 4 frames)
  PEAK_MIN: 0.2, PEAK_REACH: 3, PEAK_SEP_S: 0.06, VFLUX_FLOOR: 10,   // P6's peaks
  STRONG: 0.4, TAIL_S: 0.5,                     // S1's voiced span
  COMPRESS: 1000, DEFAULT_STEP: 1500,
});
// analyze(channels, sampleRate, { step }) → Generator<progress 0..1, VoiceResult>
//   VoiceResult = { hz: 100, a: Float32Array (activity), phrases: [{ t, s, phrase: boolean }], peaks: [{ t, s }] }
// analyzeSync(channels, sampleRate) (tests); encode(res) → { v: 1, hz: 25, act, peaks, phrases }
// decode(v) → { hz, act: Float32Array, pt, ps, ph: { t: Float64Array, s: Float32Array, phrase: Uint8Array } | null }
//   (memoized by object identity; ph null when the record has no phrases)
// candidatesIn(dec, a, b) → [{ t, s, kind: 'phrase' | 'weak' }]; fromDigest(digest) → the same list from loudness
// peaksIn, activityEnd: P6's
```

Per 10 ms frame `k` (window centred on sample `round(k·rate/HZ)`, Hann, radix-2 real FFT, the normalization of
`analyze.createSpectrum`), mid `M = (L + R)/2`, side `S = (L − R)/2` (mono: `S = 0`); the first frame is primed with
`k = −1`:
1. per band bin `b`: `pm = (norm·|M_b|)²`, `ps = (norm·|S_b|)²`, `c_b = max(0, pm − SIDE·ps)`;
2. `raw[k] = dbToUnit(Σ c_b) · (1 − min(1, flatness))`, `flatness = exp(mean ln(c_b + 1e-10)) / mean(c_b)`;
3. band flux `vflux[k] = Σ_b max(0, ln(1 + COMPRESS·norm·|M_b|) − previous)`.

Then `a0 = median(raw, ±MED)`; `a = max(0, (a0 − p10(a0)) / max(1e-3, p95(a0) − p10(a0)))` (not clamped at 1).
- **P6's stored activity**: `act[j] = round(255 · min(1, mean(a[4j … 4j+3])))` at 25 Hz. P6's `voiceEnd` threshold
  (`ACT_ON`) is re-checked on this curve; LOW = 0.35 is the natural "voice on" level.
- **P6's peaks**: `ov = min(1, vflux / max(p99(vflux), VFLUX_FLOOR))`; local maxima of `ov[k]·min(1, a[k])` over ±3
  frames with value ≥ PEAK_MIN, at least 60 ms apart (first index on ties); stored as P6 specifies.
- **Phrase candidates** (P5):

```text
fx = vflux smoothed ±1 frame; fref = max(1e-6, p99(fx)); GAP_F = round(GAP_S·HZ); AFTER_F = round(AFTER_S·HZ)
quiet = 0
for k in 0 … n−1:
  if a[k] < LOW: quiet += 1; continue
  if quiet ≥ GAP_F and max(a[k … k+AFTER_F)) ≥ HIGH:
     best = argmax fx[j], j ∈ [k−6, k+3] ∩ [0, n)   (first index on ties)
     mb = mean a[k−quiet … k), ma = mean a[k … min(n, k+AFTER_F))
     s = clamp01(ma − mb) · min(1, (quiet/HZ) / FULL_GAP_S)
     push { t: best/HZ, s, phrase: true }
  quiet = 0
weak: for j in 2 … n−3: v = fx[j]/fref; if v ≥ WEAK_MIN, fx[j] ≥ fx[j±1], a[j] ≥ LOW and no phrase candidate within
      ±WEAK_SEP_S: push { t: j/HZ, s: WEAK·min(1, v), phrase: false }
sort by t (phrase before weak on equal t); encode quantizes t to 10 ms and s to 1/127
```

- `fromDigest(digest)`: `a` from `envFromDigest(digest).loud` (20 Hz full-mix loudness), the same normalization and
  phrase rule with `HZ = 20`, `MED = 1`, no refinement, no weak candidates, every `s` halved; never stored.
- Deterministic on the PCM (fixed order, no randomness). The PCM differs slightly between browsers' decoders; the
  result is stored in the document at import, so a draft is reproducible everywhere afterwards.
- `audio/host/decode.loadSong` runs the pass after `analyzeBuffer` (P6: progress 0.9–1.0) and puts the encoded record
  into the `song.set` record; `analyzeVoice(buffer, { signal, onProgress })` serves 「曲の声を読む」.

The stored weak candidates matter: taking P6's peaks as S1's weak candidates instead lowered the lines within ±0.15 s
to 0.74 / 0.39 / 0.71 / 0.11 (clean / loud / short gaps / legato; probe `p5r/eval_unified.js`). `SIDE` 1.2 (P6's
band-total factor, applied per bin) was slightly worse than 1.0 in every case.

#### 2.4.2 `core/timing.gapWeights` (new export)

`gapWeights(lines, { readRate, bpm }) → Float64Array` with `w[i] = read[i] + pause[i+1]` (last: `read[n−1]`) — the
`gap(k)` of `solveTimes` (`read = max(MIN_READ, morae/readRate)`, `pause = PAUSE_WEIGHT·pauseBefore`, `readRate =
readRateOf(ctx)`). Only proportions are used.

#### 2.4.3 `core/draft.draftStarts` (L0, deps `core/num`, `core/beats`)

```js
const DRAFT = Object.freeze({
  WS: 1, WD: 0.6, WF: 0.15, WB: 0.1,         // weights: candidate score, gap prior, first-line pull, beat bonus
  FILL_S: -0.15, FILL_STEP: 0.25,            // filler candidates (a line may sit where no onset was found)
  MIN_GAP: 0.12,                             // = core/tap MIN_GAP (timing's ANCHOR_GAP 0.1 plus rounding room)
  REACH: 5, REACH_PAD: 2,                    // a gap longer than REACH·prior + REACH_PAD is not considered
  SNAP_TOL: 0.06, MOVE_MIN: 0.05,            // beat snap tolerance; smaller moves are not proposed
  HIGH_S: 0.4, RATIO: [0.5, 2],              // ◎ needs a phrase candidate ≥ HIGH_S whose gap is within ×0.5…×2 of its prior
  AGREE_S: 0.3,                              // the agreement readout's tolerance
});
// draftStarts({ lines, cands, voiced, duration, grid, snap, digest }) → { proposals: [{ lineId, from, to, conf, kind }], skipped: [lineId] }
//   lines: [{ id, t0, draft: boolean, w }] in line order (w from gapWeights; draft = to be drafted, else an anchor)
//   cands: candidatesIn(dec, 0, duration) or fromDigest(...); voiced: { t0, t1 } | null; digest: caps conf at 'mid'
```

`voiced` (from the decoded record): `t0` = the first phrase candidate with `s ≥ STRONG` (else the first candidate);
`t1 = (the last 25 Hz frame with act ≥ LOW·255, + 1)/25 + TAIL_S`; `null` without candidates.

1. **Segments.** Maximal runs of `draft` lines. A run `[p+1 … q−1]` is bounded by the anchor before it (line `p`, time
   `T_p`) and after it (line `q`, `T_q`); a run at the start has no `p` and uses `L = max(0, voiced.t0 − 1)`, a run at
   the end has no `q` and uses `R = min(duration, voiced.t1)`. Without `voiced`: `L = 0`, `R = duration`.
2. **Span and prior.** `lo = (p ? T_p : L) + MIN_GAP`, `hi = (q ? T_q : R) − (q ? MIN_GAP : 0)`. If `hi − lo <
   MIN_GAP·(run length)` the run is skipped (ids to `skipped`). `scale = (hi − lo) / Σ w` over the run (plus `w_p` when
   `p` exists); the prior gap after line `j` is `g_j = scale·w_j`.
3. **Candidates.** `C` = `cands` in `[lo, hi)` plus fillers every `FILL_STEP` from `lo` (every half beat of `grid`
   when there is one) with `s = FILL_S`, `kind: 'filler'`; sorted by `t`, then higher `s`. With a grid, each gets
   `bonus = WB · max(0, 1 − dist/min(0.07, period/8))` for its distance to the nearest half beat.
4. **DP** over run lines `r = 0 … m−1` and candidates:
   - first line: `cost(0, c) = −WS·s_c − bonus_c + (p ? WD·ln²((t_c − T_p)/g_p) : WF·|t_c − L'|/max(1, g_0))`,
     `L' = voiced ? voiced.t0 : L`;
   - step: only if `Δ = t_c − t_c' ≥ MIN_GAP` and `Δ ≤ REACH·g_{r−1} + REACH_PAD`: `cost(r, c) = min_{c'} cost(r−1,
     c') + WD·ln²(Δ/g_{r−1}) − WS·s_c − bonus_c`;
   - end: `total = cost(m−1, c) + (q ? WD·ln²((T_q − t_c)/g_{m−1}) : (R > t_c ? WD·ln²((R − t_c)/g_{m−1}) : ∞))`,
     requiring `T_q − t_c ≥ MIN_GAP`;
   - ties: `c` ascending, `c'` ascending, first strict minimum. No state survives a call. `O(m · |C| · K)`, `K ≤` the
     candidates inside the reach window (≈ 100): 60 lines × 1 300 candidates ≈ 8 M steps.
5. **Output.** Back-track; `to = q2(t)`; with `snap !== 'off'` and a grid: `to = grid.snap(to, snap, SNAP_TOL)` when the
   order stays strict (≥ `MIN_GAP` from both neighbours). `conf`: `'high'` when `kind === 'phrase'`, `s ≥ HIGH_S` and
   the gap into it is within `RATIO` × its prior; `'mid'` for other phrase or weak candidates; `'low'` for fillers.
   Proposals with `|to − from| < MOVE_MIN` are dropped. Strictly increasing, never crossing an anchor.
6. **Digest source:** `conf` capped at `'mid'`.
7. `agreement(proposals, tapped)` → `{ k, n }`: over proposals whose line had a `'tap'` start pin (`from` = that pin),
   `k` = those with `|to − from| ≤ AGREE_S` (moves under MOVE_MIN count as agreeing).

#### 2.4.4 Review, try-on and apply (`ui/draft`)

```js
// mount(app) → { root, start(), cancel(), apply(), active(), marks(), strip(), tryOnReplaced(doc, badge) }
// start(): checks (lines, something to draft, song) → the voice (decoded doc.song.voice, or 2.1 step 2) → propose → review
// input(doc, plan, { redo }) (exported as DR.input, pure): linesOf(doc.sheet) joined with plan.lines by id:
//   { id, t0, draft, w }; draft = by.start === 'auto' || (redo && pin && (pin.by === 'tap' || pin.by === 'user')),
//   pin = doc.pins['line/<id>:start']; w from gapWeights (readRate = the work:readRate pin, bpm = plan.beats.bpm)
// grid = the beats grid; snap = doc.timing.snap
// review: rows, checked = conf !== 'low'; tryOn(trialDoc) with trialDoc = reduce(doc, applyCmd(checked)) (150 ms debounce)
// applyCmd(proposals, checked) (DR.applyCmd, pure) → { t: 'time.tap', marks: [{ lineId, start: to }] } in line order
// apply(): store.seal(); dispatch(applyCmd, { label: ['undo.draft', { n }] }); leave the mode; tryOn(null); toast
```

- Any document change during review (store `doc` event) re-runs `propose()` from the decoded voice (cheap), keeping
  the unchecked set by line id; rows whose line vanished or is no longer draftable disappear (toast `draft.stale`).
  Toggling 「固定・タップした行も下書きし直す」 re-runs `propose()` with `redo`.
- **Keys** (`ui/keys`): a new context `'draft'` with the table `DRAFT = [b('Space', 'draft', 'play.toggle'),
  b('ArrowLeft', 'draft', 'seek.step', { seconds: -1 }), b('ArrowRight', 'draft', 'seek.step', { seconds: 1 }),
  b('Escape', 'draft', 'draft.cancel')]`; `CONTEXTS` gains `'draft'`; `resolveKey` handles `mode === 'draft'` like
  `'tap'` (a hit answers; any other global or text binding is swallowed as `noop`, so T, Delete, R, S … do nothing).
  `ui/boot` keydown: `mode = view.state.mode === 'tap' ? 'tap' : view.state.mode === 'draft' ? 'draft' : …`, and the
  activation rule (Space/Enter on a focused button or checkbox) includes `'draft'`.
- **Modes**: `ui/view` `MODES = ['normal', 'tap', 'tryon', 'draft']`; `app.goStep` returns early in `'draft'` as in
  `'tap'`; `ui/steps`: `want = vs.mode === 'tap' ? tapPanel : vs.mode === 'draft' ? draftPanel : bodies[vs.step]`
  (footer rule of line 90 likewise); the paste handler ignores `'draft'` as `'tap'`.
- **Try-on**: `app.tryOn` calls `app.draft.tryOnReplaced(doc, badge)` next to `app.ai.tryOnReplaced(doc)`; when another
  try-on replaces the draft's (`badge !== 'draft'`), the draft unchecks 「当てて見る」 without redrawing the stage.
  `app.modeStrip` returns `app.draft.strip()` while `app.draft.active()`.
- **Timeline** (`ui/timeline.drawLines`): while `app.draft.active()`, `app.draft.marks()` are drawn as 2 px ticks in a
  new token `COLORS.draft = '#7cc4ff'` (blue; dashed when unchecked), distinct from S4's warn bar; redraw on bus
  `'draft'`.

#### 2.4.5 Prototype results (synthetic)

`probe/p5/synth.js` (a deterministic stereo mix: centred sung phrases of 4–13 syllables with consonant bursts and
vibrato, kick/snare centred, hats alternating sides, centred bass, a wide detuned pad) and the unified pass of 2.4.1
(`p5r/voice_unified.js`, values quantized as stored) with the aligner (`p5/align.js`); 4 seeds × 90 s, lines = the true
phrases with morae = syllables × (0.8–1.2):

| case | phrase recall ±0.15 s | lines within ±0.15 s | within ±0.3 s |
|---|---|---|---|
| clean | 0.82 | 0.79 | 0.86 |
| loud accompaniment | 0.60 | 0.52 | 0.64 |
| long reverb | 0.91 | 0.93 | 0.97 |
| short gaps (0.12–0.4 s) | 0.95 | 0.88 | 0.89 |
| voice panned 0.5 | 0.76 | 0.58 | 0.65 |
| legato, no pauses | 0.03 | 0.40 | 0.47 |

Cost in Node: 0.5–0.8 s per 90 s of 48 kHz stereo for the whole pass (P6's curve and peaks included), about 1.4–2.2 s
for a 4-minute song, sliced at import; the aligner 30–70 ms per 90 s song. These are synthetic numbers and an upper
bound of what to expect; the constants were tuned on the same generator.

### 2.5 Changes by module and function

| Module | Change |
|---|---|
| `audio/voice` (P6's new module, L1) | the joint pass and record of 2.4.1 (`phrases`, `candidatesIn`, `fromDigest`) |
| `audio/host/decode` | P6's `loadSong` voice step and `analyzeVoice`; nothing else for S1 |
| `core/doc` | `ORDER.voice += 'phrases'`, `checkSong` (P6's) accepts the string |
| `core/timing` | export `gapWeights`, `MIN_LEN` |
| `core/draft` (new, L0) | 2.4.3 |
| `ui/draft` (new, L7) | 2.4.4 |
| `ui/keys` | `DRAFT` table, `CONTEXTS`, `resolveKey` draft branch |
| `ui/view` | `MODES += 'draft'` |
| `ui/icons` | `wave: [P('M3 12h2.5l2-4.5 3 9 3-13 3 15 2-6.5H21')]` |
| `ui/steps` | draft panel as above |
| `ui/step_song` | chip `draftBtn` (`data-act 'time.draft'`, `data-ctl 'draft'`), hidden without `doc.song`, disabled without lines; label `song.draft` or `song.draftBeta` by the constant `DRAFT_BETA` (2.10) |
| `ui/boot` | `app.draft = draft.mount(app)`; `def('time.draft', () => app.draft.start(), { enabled: () => hasLines() && !!app.doc.song })`; `def('draft.cancel', () => app.draft.cancel())`; keydown mode; activation rule; `app.tryOn` hook; `app.modeStrip`; `goStep` guard; paste guard |
| `ui/timeline` | `COLORS.draft`; `drawLines` ticks; redraw on `'draft'` |
| `ui/palette` | the command appears from `def` with `cmd.time.draft` |
| docs | DESIGN §4.13 (`audio/voice` joint pass), §4.11 (`gapWeights`), §6.4.3 (② 曲), new §6.4.15b 下書き, §6.8 (key context `draft`); SPEC §4; AI_GUIDE (non-AI draft vs AI timing) |

### 2.6 Strings

| Key | ja | en |
|---|---|---|
| `song.draft` | 曲から下書き | Draft from the song |
| `song.draftBeta` | 曲から下書き（試験的） | Draft from the song (experimental) |
| `song.draftTip` | 曲の声の出だしを探して、行の開始時刻を下書きします（AIなし） | Finds where the voice starts phrases and drafts line start times (no AI) |
| `cmd.time.draft` | 曲から行の頭を下書き | Draft line starts from the song |
| `cmd.draft.cancel` | 下書きをやめる | Discard the draft |
| `draft.title` | 曲から下書き | Draft from the song |
| `draft.needVoice` | 曲の声をまだ読んでいません。読むと声の出だしから下書きできます。 | The song's voice has not been read yet. Read it to draft from where the voice starts. |
| `draft.readVoice` | 声を読んで下書き | Read the voice and draft |
| `draft.relink` | 曲をつなぎ直す | Link the song |
| `draft.loudOnly` | 音量だけで下書き（精度は低め） | Draft from loudness only (less accurate) |
| `draft.listening` | 曲の声を読んでいます… {pct}% | Reading the voice… {pct}% |
| `draft.cancel` | 中止 | Cancel |
| `draft.cancelled` | 下書きを中止しました | Draft cancelled |
| `draft.head` | {n}行の開始を下書きしました | Drafted the start of {n} line\|Drafted the starts of {n} lines |
| `draft.counts` | 確か {a}・たぶん {b}・自信なし {c} | Sure {a} · Likely {b} · Unsure {c} |
| `draft.conf.high` | 確か | Sure |
| `draft.conf.mid` | たぶん | Likely |
| `draft.conf.low` | 自信なし | Unsure |
| `draft.row` | {n}行 {from} → {to} | Line {n} {from} → {to} |
| `draft.play` | この時刻から聞く | Listen from here |
| `draft.needSongToPlay` | 曲のファイルをつなぐと聞けます | Link the song file to listen |
| `draft.all` | すべて選ぶ | Select all |
| `draft.sure` | 確かなものだけ | Sure ones only |
| `draft.apply` | 適用 | Apply |
| `draft.stop` | やめる | Discard |
| `draft.tryOn` | 当てて見る | Preview on the stage |
| `draft.redo` | 固定・タップした行も下書きし直す | Also redraft pinned and tapped lines |
| `draft.redoTip` | 開始をタップや手で決めた行も下書きします。LRCの時刻、AIの時刻、ロックした行はそのままです | Also drafts lines whose start was tapped or set by hand. LRC times, AI times and locked lines stay |
| `draft.agree` | タップした時刻との差が0.3秒以内: {k}/{n}行 | Within 0.3 s of the tapped time: {k} of {n} lines |
| `draft.strip` | 下書きを試写中 | Previewing the draft |
| `draft.hint` | ずれている行は、行を選んで「この行だけタップで打ち直す」で直せます。 | To fix a line that is off, select it and use "Re-tap this line only". |
| `draft.aiBetter` | AIでタイミング（より正確） | AI timing (more accurate) |
| `draft.noAuto` | 自動で並んでいる行がありません（すべての行の開始が決まっています） | No line is timed automatically (every start is already set) |
| `draft.noVoice` | 声の出だしが見つかりませんでした | No sung phrase starts were found |
| `draft.done` | {n}行の開始を下書きしました | Drafted {n} line start\|Drafted {n} line starts |
| `draft.stale` | 歌詞や時刻が変わったので下書きを合わせ直しました | The lyrics or times changed, so the draft was updated |
| `undo.draft` | 曲から下書き（{n}行） | Draft from the song ({n} line)\|Draft from the song ({n} lines) |

### 2.7 Tests

1. `tests/helpers/song_gen.js` (new): the deterministic generator of `probe/p5/synth.js` (mulberry32), dependency-free
   and loadable both ways (`module.exports` in Node, `globalThis.__songGen` in a page), returning `{ channels, rate,
   phrases }`.
2. `tests/node/voice.test.js` (joint with P6's audio tests): clean 60 s mix → phrase recall within ±0.15 s ≥ 0.75,
   median error ≤ 0.03 s; reverb ≥ 0.75; progress increasing in [0, 1]; the same record twice; mono input; silence → no
   candidates; `encode`/`decode` round trip (t within 5 ms, s within 1/127, phrase bits); `candidatesIn` window;
   `fromDigest(song_digest fixture)` increasing with `s ≤ 0.5`; `audio/analyze` output unchanged (`bpm`, `strength`
   deep-equal a frozen copy). *Mutations:* per-bin centring replaced by total mid energy → clean recall < 0.7; median
   filter removed → extra intro candidates (count bound); weak candidates dropped from the stream → the end-to-end
   aligner case of 3 falls below its bound.
3. `tests/node/draft.test.js` (new): the aligner on synthetic candidates — exact candidates chosen exactly; anchors
   never move and are never proposed; strictly increasing with gaps ≥ `MIN_GAP`; only `draft` lines appear; `MOVE_MIN`;
   fillers give `'low'`; snap on/off; tight runs `skipped`; deterministic; 80 lines × 300 candidates < 100 ms;
   `agreement`. End-to-end on the 90 s clean mix through `encode`/`decode`: ≥ 0.75 of lines within ±0.15 s.
   *Mutations:* `WD = 0` → the distractor case fails; `Δ < MIN_GAP` allowed → strictness fails.
4. `tests/node/ui_draft.test.js` (new, pure parts): `DR.applyCmd` is one `time.tap` with marks in line order and pins by
   `'tap'` after `reduce`; defaults checked = not `'low'`; `DR.input` with `redo` includes `'tap'`/`'user'` start pins
   and never `'lrc'`, `'ai'`, `'lock'`.
5. `tests/node/ui_keys.test.js` (extend): in `'draft'`, Escape → `draft.cancel`, Space → `play.toggle`, T / Delete / R
   → `noop`, F5 → null.
6. `tests/browser/ui_flows.py` flow 「曲から下書き」: `page.add_init_script` injects `tests/helpers/song_gen.js`; the page
   builds a 20 s stereo WAV (`audio/wav.encodeWav` on the generator output) and returns its bytes (base64); the test
   uploads them through ② 's song file input (`set_input_files` with a buffer). Then: type 6 lines (placeholder kana),
   曲から下書き → review rows appear with the voice already read → 適用 → one undo entry 「曲から下書き（n行）」, the starts
   are pinned by `'tap'`, 元に戻す restores them; Esc during review records nothing and T does not start tap mode; an
   AI-less old-work case (a document whose `song.voice` was removed) shows 「声を読んで下書き」, which adds one undo
   entry 「曲の声を読む」 and then the review.
7. `tests/node/i18n.test.js`: the new keys (automatic by the pair checks).

### 2.8 Goldens

Unaffected: the tool runs on a click and writes pins through `time.tap`; no golden fixture has `song.voice`;
`audio/analyze` is unchanged. No new golden.

### 2.9 Performance

At import: the joint pass adds about 1.4–2.2 s (Node) per 4-minute song, sliced in `SLICE_MS` steps with progress
0.9–1.0 and cancel (P6's step). On demand: decoding the stored record < 5 ms; the aligner < 0.1 s; the try-on re-plans
the trial document (one cached re-plan, ≈ 5–20 ms, debounced 150 ms). No effect on `perf.py` rows or the re-planning
speed test.

### 2.10 Risks, open questions, release gate

- **Release gate (lead):** before release, hand-check at least 3 real songs the owner can use. Procedure in the app:
  tap every line of the song (タップで合わせる), then 曲から下書き with 「固定・タップした行も下書きし直す」 on; the header
  shows the agreement 「タップした時刻との差が0.3秒以内: k/n行」. Record per song (genre, BPM, k/n) in NOTES. If the
  median is below 50 %, set `DRAFT_BETA = true` (the button reads 「曲から下書き（試験的）」).
- Instrumental hits in the vocal band (centred synth leads, brass) become false candidates; the gap prior and the
  review absorb some.
- The loudness-only fallback is weak (full mix, 20 Hz); labelled, capped at たぶん.
- P6's `ACT_ON` and its tests must be checked on the per-bin activity (2.4.1).
- Q: a later per-character draft (P6) can read the weak candidates of the same stream; not in scope.

### 2.11 Interactions

- **P6:** one module `audio/voice`, one record `doc.song.voice`, one import step, one 「曲の声を読む」 command. P6's
  S3.4 (i) changes: the activity is per-bin centred power (2.4.1), `analyze.js` gets no `onset.vocal`, `voice.analyze`
  takes `(channels, sampleRate, { step })`, the record gains `phrases`. Whichever package lands first creates the module
  with this contract; the other adds its part.
- **S2:** the review footer points to 「この行だけタップで打ち直す」; drafted starts are `'tap'` pins that S2 re-taps.
- **S4:** after [適用], the notices update (a draft that squeezes lines shows 読み切れない).
- **T4:** drafts set sung starts; 入りの早さ / 入りの基準 place the text relative to them.
- **P3:** drafts do not touch lyric marks or the キメ pin. **AI:** `ai.align` unchanged, recommended when AI is on.

---

## 3. S2 — 1行だけタップで打ち直し

### 3.1 What the user gets

- **Entries** (all start the one-line mode on one line):
  - 詳細 › 行 › 時間: a button **「この行だけタップで打ち直す」** under 開始/終わり/長さ (custom section `timeTools`,
    single-line selection only), hint 「2秒前から再生します。歌い出しでスペース」.
  - Timeline: right-click on a line block (or the menu key / Shift+F10 on a focused line in the timeline listbox) opens
    a **line menu**: 「この行だけタップで打ち直す」, 「この行からタップで合わせる」, 「開始の固定を外す」 (only when the
    start is pinned and not locked).
  - ② 曲: under 「タップで合わせる」, when one line is selected, a chip **「{n}行目だけ打ち直す」**. The big button's hint
    becomes 「{n}行から・スペースで記録・Escで終わる」.
  - Palette: 「この行だけタップで打ち直す」 (`tap.line`), on the selected line, else the line at the playhead.
- **The one-line mode** (the tap panel with another head):
  - Title 「この行だけ打ち直す」, the line text, hint 「歌い出しでスペース（またはタップ）。終わりも打つなら E」.
  - Checkbox **「前後の行を動かさない」** (default on, remembered on this device).
  - Playback starts 2 s before the line's current start. **One** mark is taken (Space / Enter / the pad / a press on
    the preview); a second press does nothing (「この行は記録済み。打ち直すなら Backspace」).
  - **Before the mark, playback loops**: when it passes `max(line end, next line's start) + 1.5 s` it seeks back to
    2 s before the line (at most 5 times, then it pauses: 「止めました。もう一度は ▶」). The loop stops for the rest of
    the session as soon as the user moves the playhead (→ / ←, a click on the timeline or the play bar) or pauses, so a
    line sung much later than its current start can be reached by seeking.
  - **After the mark**, playback continues and the panel counts down 「{s}秒後に自動で終わります（Escで今すぐ・Eで終わ
    りを記録）」: the session ends by itself after the line (3.4), or 0.3 s after **E**, or at once on Esc / T /
    「終わる」.
  - Backspace = 打ち直す: forget the mark, seek back 2 s before the line, loop again.
  - Result: one undo entry 「この行を打ち直す（{n}行目）」, toast 「{n}行目を打ち直しました」 with 「再生して確認」, plus
    sentences as they apply: neighbours pinned → 「{list}行目の開始を今の時刻で固定しました」 with the toast action
    **「ほかの行の固定を外す」** (one undo entry); other automatic lines moved → 「ほかに{m}行の自動の時刻が動きました」
    (warn); a paired end pin moved with the start → 「終わりの固定も同じだけ動かしました」; a stale end dropped →
    「終わりの固定を外しました（新しい開始より前だったため）」.
- The normal tap mode is unchanged (it continues through the song).

### 3.2 Gating and defaults

A tool, not gated. The stale-end fix in `time.tap` applies to every work (0.4-3). `prefs.tapKeep` (device preference,
default `true`).

### 3.3 Data model

- Pins only: `line/<id>:start` by `'tap'` for the re-tapped line (and `:end` by `'tap'` when E was pressed); a paired
  end pin shifted with the start keeps its `by`; neighbours kept still get `line/<id>:start` by `'user'` at their
  current start.
- `core/tap` TapState: `{ lineIds, cursor, current, starts, ends, paused, next, active, only, from, stop }` (`stop =
  lineIds.length` in the normal mode, `from + 1` in the one-line mode).
- `ui/view` `DEFAULT_PREFS.tapKeep = true`.

### 3.4 Algorithm

**`core/tap`:**

```js
function tapStart(lines, fromLineId, opts) {                 // opts = { only: boolean }
  … at = max(0, indexOf(fromLineId)); only = !!(opts && opts.only);
  return state(lineIds, at, -1, empty, empty.slice(), false, only, at, only ? at + 1 : lineIds.length);
}
// tapReduce: 'mark' refused when s.cursor >= s.stop (returns s); 'back' refused when s.cursor === 0 or
// (s.only && s.cursor <= s.from); other events unchanged. done(s) = s.cursor >= s.stop.
//
// stillPins(before, after, lineId, start) → [{ lineId, start }]: before/after = plan.lines (same ids, same order).
//   moved = indices k (k ≠ target) with before[k].by.start === 'auto' and |after[k].t0 − before[k].t0| ≥ STILL_EPS (0.005)
//   for each maximal run [i0 … i1] of consecutive moved indices: candidates i0 and i1 (once when equal)
//   keep a candidate k only if it keeps the order with the new start: k < target → before[k].t0 ≤ start − MIN_GAP;
//                                                                     k > target → before[k].t0 ≥ start + MIN_GAP
//   → { lineId: before[k].id, start: before[k].t0 } in line order
```

Why run boundaries suffice: between two anchors `core/timing.spread` places automatic starts linearly in cumulative
weight, and fills (`forwardFill`, `backFill`, `mapSpan`) are linear maps; pinning the ends of a moved run at their old
times reproduces the interior. A new anchor can re-compress a forward fill and beat snapping can shift a start by a grid
step, so the loop runs up to three rounds. Measured (probes `p5/s2a.js`, `p5/s2b.js`; 10 lines, 5 scenarios, snap off
and on): the loop leaves only the lines the tap itself crossed moving; those must move for the order to hold and are
counted in the toast. A run that reaches the first or last line pins that line (2–5 helper pins per re-tap in a 10-line
document); the toast names them and offers to remove them.

**`ui/tap` one-line session** (constants in `ui/tap`: `PREROLL` 2 (exists), `LOOP_PAD` 1.5, `LOOP_MAX` 5, `JUMP` 0.5,
`STOP_MIN` 1, `STOP_PAD` 0.5, `STOP_MAX` 12, `END_PAD` 0.3):

```text
start({ only: lineId }):
  as start() but at = that line; line = app.plan line; next = the plan line after it (or null)
  S = { only: true, lineId, oldPlan: app.plan, old: { t0: line.t0, t1: line.t1 }, nextOld: next ? next.t0 : null,
        loopAt: max(line.t1, next ? next.t0 : line.t1) + LOOP_PAD, looping: true, loops: 0,
        last: null, own: null, stopAt: Infinity }
  S.own = max(0, line.t0 − PREROLL); app.seek(S.own); app.play()
tick(t)  — app.bus.on('time', tick): emitted every frame by app.onTick while playing, and by app.seek / app.pause
  if S.last !== null and |t − S.last| > JUMP and not (S.own !== null and |t − S.own| < 0.05): S.looping = false   // user seek
  S.own = null; S.last = t
  if not view.state.playing: return
  if no mark:
    if S.looping and t > S.loopAt:
      if S.loops < LOOP_MAX: S.loops += 1; S.own = max(0, S.old.t0 − PREROLL); app.seek(S.own)
      else: app.pause(); say tap.looped
  else if t ≥ S.stopAt: finishOnly()
view change 'playing' → false while the session is active (a user pause): S.looping = false
mark at m: S.stopAt = min(m + STOP_MAX, max(m + STOP_MIN, m + (S.old.t1 − S.old.t0) + STOP_PAD,
                                          S.nextOld !== null && S.nextOld > m ? S.nextOld + STOP_PAD : −∞))
E at e (after the mark): S.stopAt = e + END_PAD
Backspace: forget the mark; S.stopAt = Infinity; S.looping = true; S.loops = 0; S.own = max(0, S.old.t0 − PREROLL); app.seek(S.own)
```

(`app.seek` emits `'time'` itself; `view.state.time` is not updated while playing, which is why the session listens to
the bus.)

```text
finishOnly():
  tapCmd = tapCommand(state); if null → leave, nothing recorded
  cmds = []
  if the mark has no end:
    sp = doc.pins['line/<id>:start'], ep = doc.pins['line/<id>:end']
    if sp and ep and sp.by ≠ 'lock' and ep.by ≠ 'lock' and ep.v is a number:        // a paired start and end
      v = q2(min(plan.duration, ep.v + (mark.start − S.old.t0)))
      if v ≥ mark.start + TM.MIN_LEN: cmds.push({ t: 'pin.set', path: 'line/<id>:end', v, by: ep.by })   // before time.tap
  cmds.push(tapCmd)
  helpers = []
  if prefs.tapKeep:
    for round in 1…3:
      trial = reduce(doc, { t: 'batch', cmds }); after = PL.plan(trial, { registry: app.reg }).lines
      add = TAP.stillPins(S.oldPlan.lines, after, lineId, mark.start) minus lines already pinned by cmds
      if add is empty: break
      cmds += add.map(x → { t: 'pin.set', path: 'line/' + x.lineId + ':start', v: x.start, by: 'user' }); helpers += add
  store.seal(); app.batch({ label: ['undo.tapLine', { n }] }, cmds)
  report: moved = lines ≠ target and ∉ helpers with |t0 − oldPlan t0| ≥ 0.05 in the new app.plan; end shifted; stale ends
  toast action 「ほかの行の固定を外す」 (only when helpers): app.batch({ label: ['undo.unpinHelpers', { n: helpers.length }] },
    helpers whose pin still has the same v and by 'user' → { t: 'pin.clear', path })
```

**Stale end pin (`core/commands.timeTap`, every tap session and S1 drafts):**

```js
// A mark with a start and no end: an existing line end pin earlier than start + MIN_LEN is stale (solveTimes would
// shrink the line to 0.2 s); it is removed, unless it is a lock pin.
if (m.start !== undefined && m.end === undefined) {
  const endPath = 'line/' + m.lineId + ':end', end = pins[endPath];
  if (end && end.by !== 'lock' && isFiniteNumber(end.v) && end.v < checkTime(m.start, 'start') + TM.MIN_LEN) {
    pins = without(pins, [endPath]);
  }
}
```

(`core/commands` gains the dependency `core/timing` for `MIN_LEN`, L0 → L0, no cycle.) The UI reports removed end pins
by comparing `doc.pins` before and after the dispatch.

### 3.5 Changes by module and function

| Module | Change |
|---|---|
| `core/tap` | `tapStart(…, opts)`, `state()` fields, `tapReduce` refusals, `done`, `stillPins`, `STILL_EPS` |
| `core/commands` | `timeTap` stale-end rule |
| `core/timing` | export `MIN_LEN` |
| `ui/tap` | `start(opts)`, one-line head/checkbox/hints/countdown, `tick` on bus `'time'`, pause listener, `finishOnly`, `report` (moved, helpers, end shift, stale end), toast action, key-row label for Backspace (`tap.keyRetry`) |
| `ui/boot` | `def('tap.line', (c, a) => app.tap.start({ only: (a && a.lineId) \|\| selOrPlayheadLine() }), { enabled: … })` |
| `ui/fields` | line `sec('time', true, […], { custom: 'timeTools' })` |
| `ui/inspector` | `CUSTOM.timeTools(ctx)` (S2 button; S4 notes, 4.5); `REDRAW_FOCUSED` += `'timeTools'` |
| `ui/timeline` | `lineMenu(line, at)`; `contextmenu` on a line row; ContextMenu / Shift+F10 on a focused line |
| `ui/step_song` | chip `tapLineBtn` (`data-act 'tap.line'`), hint text |
| `ui/view` | `DEFAULT_PREFS.tapKeep = true` |
| docs | DESIGN §4.11 (tap `only`, `stillPins`, stale-end rule), §6.4.15 (one-line mode) |

### 3.6 Strings

| Key | ja | en |
|---|---|---|
| `tap.lineBtn` | この行だけタップで打ち直す | Re-tap this line only |
| `tap.lineBtnHint` | 2秒前から再生します。歌い出しでスペース | Plays from 2 s before. Press Space where the line starts |
| `cmd.tap.line` | この行だけタップで打ち直す | Re-tap this line only |
| `song.tapLine` | {n}行目だけ打ち直す | Re-tap line {n} only |
| `song.tapFrom` (text changed) | {n}行から・スペースで記録・Escで終わる | From line {n} · Space marks · Esc finishes |
| `tap.onlyTitle` | この行だけ打ち直す | Re-tap one line |
| `tap.onlyHint` | 歌い出しでスペース（またはタップ）。終わりも打つなら E | Press Space (or tap) where it is sung. E marks the end |
| `tap.onlyDone` | この行は記録済み。打ち直すなら Backspace | This line is marked. Backspace to redo it |
| `tap.autoEnd` | {s}秒後に自動で終わります（Escで今すぐ・Eで終わりを記録） | Finishes by itself in {s} s (Esc: now · E: mark the end) |
| `tap.keep` | 前後の行を動かさない | Keep the other lines where they are |
| `tap.keepTip` | 前後の自動の行の開始を、今の時刻で固定します | Pins the neighbouring automatic starts at their current times |
| `tap.looped` | 止めました。もう一度は ▶ | Stopped. Press ▶ to try again |
| `tap.keyRetry` | 打ち直す | Redo |
| `tap.lineDone` | {n}行目を打ち直しました。 | Re-tapped line {n}. |
| `tap.lineKeptList` | {list}行目の開始を今の時刻で固定しました。 | Pinned the start of line {list} at its current time.\|Pinned the starts of lines {list} at their current times. |
| `tap.lineMoved` | ほかに{m}行の自動の時刻が動きました。 | {m} automatic line also moved.\|{m} automatic lines also moved. |
| `tap.endShifted` | 終わりの固定も同じだけ動かしました。 | The pinned end moved with it. |
| `tap.endCleared` | 終わりの固定を外しました（新しい開始より前だったため）。 | Removed the pinned end (it came before the new start). |
| `tap.unpinHelpers` | ほかの行の固定を外す | Unpin the other lines |
| `undo.unpinHelpers` | ほかの行の固定を外す（{n}行） | Unpin the other lines ({n} line)\|Unpin the other lines ({n} lines) |
| `undo.tapLine` | この行を打ち直す（{n}行目） | Re-tap line {n} |
| `tl.lineMenu.retap` | この行だけタップで打ち直す | Re-tap this line only |
| `tl.lineMenu.tapFrom` | この行からタップで合わせる | Tap to sync from this line |
| `tl.lineMenu.unpinStart` | 開始の固定を外す | Unpin the start |

The toast joins the applying sentences (ja: no separator; en: a space). `{list}` uses `list.sep`.

### 3.7 Tests

1. `tests/node/tap.test.js` (extend): one-line mode — after one mark further marks return the same state; `back`
   re-arms the same line and is refused at `from`; `tapCommand` has one mark; `done`. Normal mode: every existing case
   unchanged. `stillPins`: boundary pins of moved runs; order conflicts skipped; different id lists → `[]`.
   *Mutation:* `stop` ignored in `mark` → the second-mark case fails.
2. `tests/node/tap_keep.test.js` (new): the 5 scenarios of probe `s2b.js`, snap off and 120 BPM `'beat'`: the 3-round
   loop run with `core/timing.solveTimes` leaves every line within 0.005 s of its old start except the lines the tap
   crossed; at most 3 rounds. *Mutations:* one round only → "after the last anchor" fails; no order check in
   `stillPins` → `time-order` and fails.
3. `tests/node/tap_session.test.js` (new; the pure session rules exported from `ui/tap` as `TS.loopAt(line, next)`,
   `TS.stopAt(m, old, nextOld)`, `TS.userSeek(last, t, own)`, `TS.endShift(pins, id, start, oldT0, duration)`): loopAt
   uses the later of the line end and the next start; a 6 s line gets `stopAt ≥ m + 6.5`; a line whose automatic start
   is 5 s early gets `stopAt ≥ m + 1`; `STOP_MAX` caps; a jump of 3 s not issued by the session is a user seek, the
   session's own seek is not; the end shift keeps the length and is skipped for lock pins, a lone end pin, or when it
   would end before start + MIN_LEN.
4. `tests/node/commands.test.js` (extend): end pin 10.5 + tap start 11 → removed; 12 → kept; 11.1 → removed; lock →
   kept; start and end → both set. *Mutation:* `≤ start` instead of `< start + MIN_LEN` → the 11.1 case fails.
5. `tests/node/ui_fields.test.js`: the line page `time` section has `custom: 'timeTools'`.
6. `tests/browser/ui_flows.py` flow 「この行だけ打ち直す」 (30 s `window.__wav` song, 6 automatic lines of placeholder
   kana):
   - select line 3 (automatic start `T`); 行 › 時間 「この行だけタップで打ち直す」 → playback at `T − 2`; press → once
     (the loop stops), wait until the clock passes `T + 5`, Space (mark `m ≈ T + 5`); wait 6 s, E; the session ends
     0.3 s after E → exactly one undo entry 「この行を打ち直す（3行目）」; line 3 has start ≈ `m` and end ≈ `m + 6` by
     `'tap'`; the toast names the pinned neighbours; 「ほかの行の固定を外す」 → one more undo entry, those pins gone;
     元に戻す twice restores everything.
   - drag line 4's block on the timeline (pins start and end), re-tap it without E → its end moved by the same delta
     (toast 「終わりの固定も同じだけ動かしました」).
   - timeline right-click on a line → the line menu has the three items; the keyboard menu key opens it too.

### 3.8 Goldens

Unaffected: only user actions write these pins; no golden path runs `time.tap`. The stale-end rule changes `time.tap`
only when a stale end pin exists, which no golden has.

### 3.9 Performance

Up to three trial plans at the end of a session (≈ 5–20 ms each with the caches). Per frame while a session runs: a
few comparisons in `tick`.

### 3.10 Risks and open questions

- **Behaviour change (called out):** `time.tap` removes an end pin before the new start + 0.2 s (before, the line
  silently shrank to 0.2 s). Toast; undo restores.
- 「前後の行を動かさない」 turns automatic neighbours (sometimes the first or last line) into `'user'` pins, shown as 固定.
  The toast names them and removes them in one undoable step; S1's 「固定・タップした行も下書きし直す」 treats them as
  draftable.
- The end shift applies only to a paired start and end (a length the user set); a lone end pin is kept.
- S and [今] keep using the raw clock and `'user'` pins. Q (lead): apply `tapLatency` to them too? Not here.

### 3.11 Interactions

- **S1:** drafted starts are `'tap'` pins; S2 re-taps them. **S4:** a re-tap that squeezes a line shows the notice;
  the 行 page's too-fast note offers this re-tap. **P6:** its 1字ずつタップ reuses `tapStart(…, { only })`, the loop and
  the bus-driven session; it adds its item to S2's line menu and next to S2's button.

---

## 4. S4 — 読み切れない速さの行を知らせる

### 4.1 What the user gets

When 「読み切れない速さの行を知らせる」 is on (new works: on; existing works: off until switched on in 作品全体 ›
タイミング):

- **歌詞 (lyric editor) gutter:** 「!」 on a line that is too fast; tooltip 「速すぎて読み切れないかもしれません（1秒に
  約{n}音）」. The gutter shows every warning of a line in the tooltip (one per row of text) and picks the mark by
  severity (4.4). The squeezes `time-compressed` (every line of the range) and `piece-merged` get gutter marks too.
- **作品全体 › 行 list:** its 「!」 gets a tooltip with the same texts.
- **Timeline:** a bar in `COLORS.warn` (`'#ff7a7a'`, the gutter's `--error` colour) along the bottom of the line block
  with a 1 px `COLORS.bg` edge (visible on a selected block) and 「!」 at its right end when there is room; the listbox
  label ends with 「、速すぎて読み切れないかもしれません」.
- **詳細 › 行 › 時間** (custom section `timeTools`): the note 「速すぎて読み切れないかもしれません（1秒に約{n}音・読める
  時間 {s}秒）」 with quick fixes:
  - **[動きを速くする]** — line pins `arrive.dur 0.2`, `arrive.each 0.01`, `depart.dur 0.15`, `depart.each 0` (by
    `'user'`), one undo entry 「読みやすくする（動きを速く）」 (shared-parameter pins at line scope apply to every piece,
    probe `s4d.js`).
  - **[この行だけタップで打ち直す]** — S2.
  - **[終わりを延ばす]** — only when the line's last cut is followed by a gap, interlude or the outro: pins
    `line/<id>:end` at `min(nextLine.t0 − 0.3, duration − 0.5, t1 + 1.25·(need − W))`; hidden when that gains < 0.05 s.
  - The section also explains the squeezes: 「前後の固定に合わせて、行の間隔を詰めています」 (`time-compressed`) and
    「短すぎる区切りを前とまとめました」 (`piece-merged`).
- **④ 書き出し checklist:** one item (warn) 「読み切れない速さの行が{n}行あります（{list}行目）」 with [見る].
- 作品全体 › タイミング: **「読み切れない速さの行を知らせる」** (toggle) with a note.

When it is off (every existing work unless switched on): nothing new is marked. The marks that exist today — the 行
list's 「!」 on the first line of a squeezed range or on a merged line — get their tooltip, and the 行 page shows the
squeeze note on those lines. Text only.

Measured on the fixtures (probes `s4a.js`, `s4c.js`, `s4e.js`): automatic lines read at p50 7.6, p99 9.7, max 10.0
morae per legible second over 1 071 Japanese cuts (7 fixtures × 3 seeds), so the rule (limit 12) flags none; two
automatic lines squeezed between LRC stamps 1.5 s apart read at 26–27 and are flagged.

### 4.2 Gating and defaults

`RC.enabled(doc)` (0.1): an explicit `timing.readCheck`, else `look.gen ≥ 1`. When enabled: `too-fast` everywhere
above, `time-compressed` / `piece-merged` in the gutter, and the squeezed range expanded to every line. When not: the
computation is not run, `expand` is not applied, the gutter's code set is today's, and only tooltip and inspector text
is added to existing marks.

### 4.3 Data model

- `doc.timing.readCheck` (0.2).
- Warning object (UI-computed, never in `plan.warnings`, never hashed): `{ code: 'too-fast', line, cut, detail: { rate,
  units, legible, limit } }`.
- `core/types.js` warning code list gains `'too-fast'` (JSDoc).

### 4.4 Algorithm

**`planner/readable` (new, L2; deps `core/motion`, `core/script`, `core/num`; a pure reader of a finished Plan, like
`planner/explain`):**

```js
const READ = Object.freeze({
  MAX: Object.freeze({ ja: 12, ko: 12, zhHans: 10, zhHant: 10, en: 9 }),   // units per legible second
  MIN_UNITS: 4,          // the rate rule needs at least this many units
  MIN_LEGIBLE: 0.3,      // a cut with ≥ 2 units legible for less than this is flagged whatever its rate
  FLOOR_UNITS: 2,
  SUNG_AFTER: 0.4,       // a 歌ハメ cut (P6 cut.sung) stays readable this long after its last character
});
// units(cut) = S.morae(cut.text, cut.lang)
// legibleOf(plan, i, registry) → { V, A, L, W }
//   V = b − a                                         (the final window: after 出そろい, the tiers, the clamp, the clips)
//   A = the arrive's motion total: 0 for the fallback arrive; 0 for order 'sung' (the text is read as it appears);
//       else MO.fitMotion({ dur, each, count: units of the part's unit, window: V, share: SHARE.arrive,
//                          cap: cut.ready !== undefined ? cut.ready − a : undefined }).total
//   L = the same for the depart (0 for the fallback depart; share SHARE.depart)
//   W = V − A/2 − L/2, then min(W, readEnd − a − A/2) when an outgoing seam of this cut exists
//       readEnd = seam.at − seam.dur/2 when the seam's definition has glyphs: true (P4 モーフ: A's letters start moving),
//                 else seam.at
// check(plan, registry) → frozen [{ cut, line, rate, units, legible, limit }] for every line cut (c.line, text):
//   - with cut.sung and arrive order 'sung' (P6): flagged when units ≥ FLOOR_UNITS and b − (t0 + sung.end) − L/2 < SUNG_AFTER
//     (rate = units / max(0.05, sung.end − sung.t[0]), legible = that remainder)
//   - otherwise: (units ≥ MIN_UNITS and units / W > MAX[lang]) or (units ≥ FLOOR_UNITS and W < MIN_LEGIBLE)
//   memoized per plan object (WeakMap); cuts in plan order
```

The plan-level estimate matches the engine's fitted times within ±10 % on 98 % of 723 corpus cuts (probe `s4c.js`);
the limits leave more margin (auto max 10 vs 12). Why not a scene warning: scene warnings exist only for laid-out cuts,
and a warning read from neighbours or seams would go stale in the scene cache.

**`ui/readcheck` (new, L7):**

```js
// enabled(doc) → typeof doc.timing.readCheck === 'boolean' ? doc.timing.readCheck : RULES.gen(doc) >= 1
// readWarnings(doc, plan, registry) → [] unless enabled(doc); else RD.check(...).map(x → ({ code: 'too-fast', line,
//   cut, detail: { rate, units, legible, limit } }))
// expand(warnings, plan) → each time-compressed warning repeated for every line of its range (detail.lines lines from
//   the warning's line, in plan.lines order)
// gutterCodes(doc) → today's WARN_CODES of ui/lyric_editor, plus 'too-fast', 'time-compressed', 'piece-merged' when enabled
// PRIORITY = ['time-order', 'overfull', 'lock-partial', 'orphan-pin', 'shadowed-pin', 'pin-not-applicable',
//             'too-fast', 'time-compressed', 'piece-merged']                                    (by severity)
// byLine(warnings, plan, codes) → Map<lineId, [codes ∈ codes, sorted by PRIORITY, unique]>
// textOf(t, w) → t('warn.too-fast.n', { n: round(rate) }) for too-fast; t('warn.time-compressed.n', { n }) with
//   detail.lines; else t('warn.' + code)
// titleFor(t, warnings of one line) → texts joined with '\n'
```

`ui/boot`: `warnings: () => { try { const base = engine.warnings() || []; if (!RC.enabled(store.doc)) return base;
return RC.expand(base.concat(RC.readWarnings(store.doc, app.plan, app.reg)), app.plan); } catch (e) { return []; } }`,
so the lyric editor, the 行 list, the inspector, the timeline and `exportChecks` see the same list.

**Export checklist (`export/schedule.warningItems`):**

```js
} else if (w.code === 'too-fast') { tooFast.push(w); }
… after the loop:
if (tooFast.length) {
  const lines = [...new Set(tooFast.map((w) => lineNumber(plan, w.line)).filter((n) => n !== null))];
  items.push({ code: 'too-fast', level: 'warn', params: { n: lines.length, lines }, jump: { cut: tooFast[0].cut } });
}
```

`ui/step_export.checkText`: for `too-fast`, `params.list = lines.slice(0, 5).join(t('list.sep')) + (lines.length > 5 ?
t('exp.pre.too-fast.more', { m: lines.length − 5 }) : '')`.

**Quick fix arithmetic:** `need = units / limit`; [終わりを延ばす] target `t1' = min(next.t0 − 0.3, duration − 0.5, t1 +
1.25·(need − W))`; shown only when `t1' − t1 ≥ 0.05` and the last cut's `b` equals `t1 + tail`.

### 4.5 Changes by module and function

| Module | Change |
|---|---|
| `planner/readable` (new) | 4.4 |
| `ui/readcheck` (new) | 4.4 |
| `ui/boot` | `app.warnings` as above |
| `ui/lyric_editor` | `renderGutter` uses `RC.byLine(app.warnings(), plan, RC.gutterCodes(doc))`; `fillEntry(entry, line, doc, pins, codes)` shows 「!」 with `class` `is-<first code>` and `title = RC.titleFor(...)`; the aria label adds the first text |
| `ui/inspector` | `linesList`: `warnLines` from `app.warnings()` (as today), the 「!」 span gets `title`; `CUSTOM.timeTools` (notes and fixes; S2 button); `cmdValue` for `readCheck` → `RC.enabled(doc())` |
| `ui/fields` | `sec('timing')`: `F({ cmd: { t: 'timing.set', key: 'readCheck' }, scopes: WORK, widget: 'toggle', label: 'fld.readCheck', note: 'fld.readCheck.note' })` after 入りの基準 |
| `ui/timeline` | `COLORS.warn`; `drawLines` bar and 「!」 for `too-fast`; `proxyLabel` appends the text |
| `export/schedule` | `warningItems` branch |
| `ui/step_export` | `checkText` for `too-fast` |
| `core/types` | warning code |
| docs | DESIGN §4.21 preflight codes, §6.4 gutter and 行 page, §6.13 strings; SPEC §4 |

### 4.6 Strings

| Key | ja | en |
|---|---|---|
| `warn.too-fast` | 速すぎて読み切れないかもしれません | May be too fast to read |
| `warn.too-fast.n` | 速すぎて読み切れないかもしれません（1秒に約{n}音） | May be too fast to read (about {n} morae a second) |
| `warn.time-compressed.n` | ここから{n}行の間隔を詰めて収めました | The {n} line from here was squeezed to fit\|The {n} lines from here were squeezed to fit |
| `insp.tooFast` | 速すぎて読み切れないかもしれません（1秒に約{n}音・読める時間 {s}秒） | May be too fast to read (about {n} morae a second, readable for {s} s) |
| `insp.squeezed` | 前後の固定に合わせて、行の間隔を詰めています | Lines are squeezed to fit between fixed times |
| `insp.merged` | 短すぎる区切りを前とまとめました | A very short piece was merged into the one before |
| `insp.fixMotion` | 動きを速くする | Make the motion quicker |
| `insp.fixEnd` | 終わりを延ばす | Show it longer |
| `undo.readFix` | 読みやすくする（動きを速く） | Easier to read (quicker motion) |
| `undo.readEnd` | 読みやすくする（終わりを延ばす） | Easier to read (show longer) |
| `fld.readCheck` | 読み切れない速さの行を知らせる | Flag lines too fast to read |
| `fld.readCheck.note` | 1秒あたりの音数が多すぎる行や、読める時間が短すぎる行に「!」を付けます。新しい作品でははじめからオンです。 | Marks lines with too many morae per second, or too little time to read, with "!". New works start with this on. |
| `exp.pre.too-fast` | 読み切れない速さの行が{n}行あります（{list}行目） | {n} line may be too fast to read (line {list})\|{n} lines may be too fast to read (lines {list}) |
| `exp.pre.too-fast.more` | ほか{m}行 | and {m} more |

(`exp.pre.too-fast` is found by `i18n.test.js`'s `items.push({ code: '…' })` scan; `'too-fast'` joins its
`WARN_CODES`.)

### 4.7 Tests

1. `tests/node/readable.test.js` (new):
   - the corpus (basic, vertical, lrc, long, v21, media, repeat × 3 seeds × 16:9/9:16/1:1) at defaults: `check` → `[]`.
   - two automatic lines between LRC stamps 10.0 s and 11.5 s (placeholder kana, 11–15 morae): both flagged, rate > 20.
   - a tapped 0.25 s cut with 2 morae → flagged by `MIN_LEGIBLE`; 1 mora → not.
   - `sung` order (pin `line/<id>:arrive.order = 'sung'`): A counts as reading time. A cut with a hand-made `sung` field
     ending 0.2 s before `b` → flagged by `SUNG_AFTER`; 0.6 s → not.
   - an outgoing glyph seam (a registry stub with `glyphs: true`) ends reading at `at − dur/2`.
   - `en` limit 9; a 出そろい cut uses the capped A.
   - plan/engine agreement: plan W within ±20 % of the engine's for ≥ 98 % of corpus cuts.
   - memo per plan object.
   - *Mutations:* `t1 − t0` instead of `b − a` → the corpus case flags pieces; drop the `sung` rule → the sung case
     fails; limit 7 → the corpus case fails.
2. `tests/node/ui_readcheck.test.js` (new): `enabled` (explicit true/false wins; absent follows `look.gen`);
   `readWarnings` is `[]` when not enabled; `expand`; `gutterCodes` with and without; `byLine` severity order
   (`time-order` before `too-fast`); `titleFor`.
3. `tests/node/ui_output.test.js` / `export_kit.test.js` (extend): `preflight(doc, plan, { warnings: [too-fast ×3 on 2
   lines] })` → one item `too-fast`, `n = 2`, `lines`, `jump.cut` = the first.
4. `tests/node/ui_fields.test.js`: the toggle row after 入りの基準.
5. `tests/node/i18n.test.js`: `'too-fast'` in `WARN_CODES`.
6. `tests/browser/ui_flows.py` flow 「読み切れない速さ」: `?fresh=1`, two LRC stamps 1.5 s apart with two unstamped lines
   between → gutter 「!」 with the tooltip; the 行 list 「!」 has a title; the timeline proxy label contains the text;
   行 › 時間 shows the note, [動きを速くする] → one undo entry and the note updates; step ④ lists the item and [見る]
   selects the cut; switching the toggle off removes them. A second page (an opened fixture, no `readCheck`, no marker):
   no `too-fast`, the gutter shows no squeeze mark, the 行 list's existing 「!」 has the squeeze tooltip.

### 4.8 Goldens

Unaffected: nothing is drawn and nothing enters `plan.warnings` or the plan hash; `planner/readable` is not called by
`planner/plan`. Fixtures have no `readCheck` and no marker, and the rule flags none of their cuts even when forced on.

### 4.9 Performance

`check` is O(cuts) with one `fitMotion` pair per cut, memoized per plan object: < 1 ms for `long` (245 cuts); not run
when disabled. `perf.py` rows (fixtures, disabled): unchanged.

### 4.10 Risks and open questions

- The limits are judgement calls (12 morae per legible second for Japanese sits above every automatic line of the
  corpus). Fast songs sung above ≈ 9 morae/s will show many 「!」; the switch turns them off. Q (lead): expose the limit?
- English and mixed-script counts are syllable estimates (`S.morae`).
- Motion estimates are plan-level (±10 % on 98 % of cuts).

### 4.11 Interactions

- **T4:** reads the final windows and the capped entrance. **S1/S2:** notices update after 適用 / a re-tap; the 行 page
  offers S2's re-tap. **P3 キメ:** measured like any line. **P4:** a glyph seam ends A's reading at `at − dur/2` (the
  seam's definition, no helper needed). **P6:** `cut.sung` cuts use `SUNG_AFTER`; other `sung`-order cuts count their
  entrance as reading time. **P1:** none.

---

## X. Package summary

### X.1 Files

New: `src/core/draft.js`, `src/planner/readable.js`, `src/ui/draft.js`, `src/ui/readcheck.js`,
`tests/helpers/song_gen.js`, `tests/node/{timing_ready,seams_lead,golden_lead,voice,draft,ui_draft,tap_keep,
tap_session,readable,ui_readcheck}.test.js`. Joint with P6: `src/audio/voice.js`. Changed: `src/core/{doc,commands,
motion,timing,tap,types}.js`, `src/planner/{plan,encode,tracks,segment,extreme}.js`, `src/engine/scene/{build,
behave}.js`, `src/export/schedule.js`, `src/ui/{boot,tap,steps,step_song,step_export,fields,inspector,lyric_editor,
timeline,view,keys,icons}.js`, `src/i18n/strings.js` (the `// --- PV22 P5 (タイミング) ---` block), tests listed per
item (`doc.test.js`, `motion.test.js`, `extreme.test.js`, `commands.test.js`, `tap.test.js`, `ui_fields.test.js`,
`ui_keys.test.js`, `i18n.test.js`, `ui_output.test.js`), `tests/browser/ui_flows.py`, docs (DESIGN, DESIGN_2_1 §14
note, DESIGN_2_2 §0 and the P5 chapter, SPEC, NOTES, AI_GUIDE).

### X.2 Build order

1. T4 planner fixes first, alone: `segment.windows` clamp, `tracks.seams` tiers with `endWithSeam(…, handover)`
   (coordinate the signature with P4), `extreme` pair gate; `seams_lead.test.js`, `golden_lead.test.js`, every golden
   test green.
2. T4 出そろい: `fitMotion` cap, `times.ready`, stage 6b, encoding; `timing_ready.test.js`.
3. `newDoc()` lead and the `pv22` test update.
4. S4 (`planner/readable`, `ui/readcheck`, gutter / list / timeline / 行 page / ④).
5. S2 (`core/tap`, `timeTap`, `ui/tap` session, entries).
6. S1 (`audio/voice` joint pass with P6, `core/draft`, `ui/draft`, keys/modes, ② button) — largest, last; release gate.
7. Strings, docs, `ui_flows.py` flows, visual QA of 1.7-10.

`python3 build.py --check` layer rules: `core/draft` L0 → L0; `audio/voice` L1 → `audio/fft`, `audio/digest`;
`planner/readable` L2 → L0; `planner/extreme` → `planner/rules` (L2 → L2); `ui/*` L7 → anything; `audio/host/decode`
L6 → `audio/voice`.

### X.3 Goldens (all)

`frame_hashes_v2.json` (FROZEN), `frame_hashes.json`, `plan_hashes.json`, `project_media.json`, `project_repeat.json`,
`project_extreme.json`: byte-identical. Their documents store `lead 0.12` and no `enter`, `readCheck`, `look.gen` or
`song.voice`, and never run tap or draft commands; every new plan field and fingerprint term is emitted only when
present; the hand-over tiers, the clamp and the pair gate take today's branch on all 253 golden documents (measured:
0 plan-hash differences, 0 hits; asserted by `golden_lead.test.js`). No golden is regenerated.

### X.4 Probes (read-only)

- Revision 1, `scratchpad/pv22/probe/p5/`: `t4a.js`, `t4b.js` (post-hoc emulation, superseded), `s4a.js`–`s4e.js`,
  `s2a.js`–`s2c.js`, `synth.js`, `phrases.js`, `align.js`, `s1eval.js`, `s1align.js`.
- Critic, `scratchpad/pv22/probe/critic_p5/`: `t4seam.js`, `t4seam2.js`, `t4seam3.js`, `t4inv.js`, `t4ready.js`.
- Revision 2, `scratchpad/pv22/probe/p5r/` (a copy of `src` with stage 6b after the seams, the tiers, the clamp; option
  switches for the measurements): `inv.js` (hand-over, window, neighbour, ground and rig invariants per lead and mode),
  `i3.js` (opened windows inside their ground segment, no opened cut with a seam into it),
  `share.js` (fully-in shares and skip reasons with engine times), `goldhash.js` (253 golden documents, original vs
  patched plan hashes), `fp.js` (the floor-limited fingerprint case), `clampcap.js`, `whip.js`, `voice_unified.js` +
  `eval_unified.js` (the joint voice pass, stored-value quantization, variants).

---

## Critique log (revision 2)

| # | Severity | Issue | Verdict | How it was handled |
|---|---|---|---|---|
| 1 | blocker | 出そろい at stage 5b breaks the seam hand-over; numbers came from a post-hoc emulation | **Valid.** Reproduced with `critic_p5/t4seam2.js`: 271/345 seams with A past the window under 出そろい. `p5/t4b.js` indeed widened `a` on the finished plan. | The pass moved to stage 6b, after `TR.seams`, before `XT.shots`; it skips cuts with `seamIn ≥ 0` and cuts that start a new background (so grounds keep the unopened `a` and every opened window stays in its segment). The floor reads the post-clip `b`. Re-measured with the real placement (1.1): opened 37–87 % of line cuts, 100 % of opened cuts fully in by `ready`; A past the window under 出そろい = the 動き始め count, then 0 with fix 2. Tests: invariants I1–I5 and the hand-over/window/neighbour invariants over corpus × leads × modes (1.7-2, 1.7-3); world-seam frames in visual QA (1.7-10). Rigs: **kept on the opened `a`** rather than a pre-opening `a0`: a rig run starts at its first cut's `a` today (the section camera changes as that line begins to enter); without a seam there is no blend, so an `a0` start would jolt the frame while the opened line is already being read (5 rig starts move in 18 plans). |
| 2 | major | Lead 0.2 (動き始め) already lets A reappear after 26 % of exit-replacing seams | **Valid.** 82/345 seams, 68/262 exit-replacing, max 0.065 s. | `tracks.seams` long-lead hand-over (1.4 f). The suggested single rule (`at = max(B.a, A.t1 − dur/2)`) was measured to draw B before its window at longer leads (87 seams at 0.5, 78 world seams whose background would switch first), so it became tier 1 of three (lengthen within the seam's own cap; else P4-style hand-over). 0 violations at leads 0.12–1.0; 0 hits and 0 hash differences on 253 golden documents; `golden_lead.test.js` asserts today's placement on all of them. Called out as a bug fix for existing works (0.4-1); DESIGN §3.12 b and §4.16.6 get the text. |
| 3 | major | Conflict with `D.newDoc()` and its test on `pv22` | **Valid.** 87fde34 adds `newDoc`, its comment and `newDoc is defaultDoc apart from the marker`. | 0.1: `newDoc()` writes `timing.lead = NEW_WORK_LEAD` (explicit: `checkTiming` requires a number, `normalize` fills 0.12); `readCheck` resolves from `look.gen` in `ui/readcheck.enabled` with the toggle writing a boolean; the test's final assertion and a normalize case are specified; the doc.js comment is rewritten; the `newWorkDoc` wording is gone. |
| 4 | major | P4's morph replaces B's entrance after 5b opened B | **Valid** for the old placement. | Covered by 1: the pass runs after `TR.seams` and skips `seamIn ≥ 0`, so a morph target is never opened; test with P4's fixture (1.11). §1.11 now says what happens (the morph window ends `lead` before the voice at 動き始め). |
| 5 | major | S2 loop makes far-off lines unreachable; auto-finish before E; wrong `tick` hook | **Valid.** `app.time()` reads the player while playing; `view.state.time` is not updated; `onTick` emits bus `'time'`. | 3.4: loop point `max(line end, next start) + 1.5 s`; the loop stops after any user seek (jump detection on bus `'time'`, excluding the session's own seeks) or pause; `stopAt = min(m + 12, max(m + 1, m + old length + 0.5, next start + 0.5))`; E finishes 0.3 s after it; a countdown in the panel. A paired end pin moves with the start. Pure session rules tested (3.7-3); browser flow with a 5 s offset and a 6 s line (3.7-6). |
| 6 | major | S1 duplicates P6's `audio/voice` | **Valid.** | One module and one record (2.3, 2.4.1): the per-bin centred activity and the phrase rules fold into `audio/voice`; `doc.song.voice` gains `phrases` (≈ 2.5–3.2 KB); S1 drafts from the document without relinking; the "needs the file" branch becomes P6's 曲の声を読む; the loudness fallback stays. Re-measured on the unified pass with stored quantization: equal or better than revision 1 in every case. P6's peaks as S1's weak candidates were measured worse (0.74 / 0.39 / 0.71 / 0.11), so the weak candidates are stored in the phrase stream. `audio/analyze` stays unchanged (P6's `onset.vocal` is not needed). `core/draft` stays in P5. |
| 7 | minor | 「前後の行を動かさない」 pins distant lines silently; S1 treats them as anchors | **Valid.** | The toast names the pinned lines and offers 「ほかの行の固定を外す」 (one undoable batch of only those pins, if unchanged); S1 has 「固定・タップした行も下書きし直す」 (default off) treating `'tap'`/`'user'` start pins as draftable, which also lets a draft be redone after 適用. |
| 8 | minor | Non-neighbour overlap at lead 0.2 | **Valid.** 12 windows in 18 plans, 0.021 s. | `segment.windows` clamp `a_i ≥ b_{i−2}`, capped at `t0` (1.4 g); 0 overlaps after; never binds at 0.12 on the golden documents; invariant tested at all leads (1.7-3), proof in 1.7-4. |
| 9 | minor | Share threshold wrong; fp mutant cannot fail | **Valid** (both). | (a) 100 % of cuts with `ready` fully in by `ready`; the overall share is compared with 動き始め (≥ +0.2 per fixture, measured +0.26 to +0.87). (b) A plan-level test on a floor-limited cut whose fp must differ between lead 0.2 and 0.3 (measured: equal without the `r` term); cached vs fresh kept for the `encodingKey` term. |
| 10 | minor | S4 adds marks to existing works | **Valid.** `WARN_CODES` excludes both squeeze codes; `expand` would mark every squeezed line. | Gutter codes and `expand` follow `RC.enabled`; existing works get tooltip and inspector text on today's marks only (0.1, 4.1, 4.2); §0.1's wrong claim removed; browser flow checks the old-work page. |
| 11 | minor | Gutter priority puts too-fast first | **Valid.** | PRIORITY by severity: time-order, overfull, lock-partial, orphan-pin, shadowed-pin, pin-not-applicable, too-fast, time-compressed, piece-merged. |
| 12 | minor | Wrong or missing hooks | **Valid** (all eight). | (1)(2) key context `'draft'` with its own table (Esc → `draft.cancel`, other shortcuts swallowed) and the boot keydown mapping and activation rule; (3) `app.draft.tryOnReplaced` next to the AI hook; (4) `MODES += 'draft'`; (5) a `wave` icon path; (6) the undo label is the field label 「入りの基準」; (7) `KI.isKime(c)` from `planner/kime`; (8) S1 ticks in `COLORS.draft` (blue), S4's bar in `COLORS.warn` (the gutter's error red). |
| 13 | minor | S1 accuracy unvalidated; browser test cannot run the Node generator | **Valid.** | Release gate with an in-app agreement readout against tapped times (2.10), `DRAFT_BETA` label below a 50 % median; `song_gen.js` loadable in the page via `page.add_init_script`, WAV uploaded through the song file input (2.7-6). |
| 14 | minor | whipPan pair assumes lead 0.12 | **Valid.** 739/739 pairs meet at 0.12, 0/739 at 0.2. | Planner gate (1.4 h): legacy documents keep today's rule; new-generation documents and 出そろい require the whips to meet (≤ 0.03 s). Byte-identical for `project_extreme.json`. The engine-anchor alternative was rejected (it changes whip timing in existing documents with a custom lead). |
