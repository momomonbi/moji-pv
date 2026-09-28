# P6 — 歌ハメ (S3): design (revision 2)

Package P6 covers one owner item: **S3 歌に合わせて1字ずつ出す「歌ハメ」**. The survey found it *partial*. The order
「歌に合わせて」 (`'sung'`) exists, but it spreads a cut's characters evenly by estimated morae over the whole cut
(`t0 … t1`). There is no real per-character timing source, no one-step switch, no karaoke fill, and no way to see or edit
per-character times. This design adds all of that without changing any golden.

Revision 2 answers the critique of revision 1 (Critique log at the end). The largest changes:

- The work ships in **four phases** (A required, B/C/D follow-ups), each golden-safe on its own.
- 歌ハメ 自動 in new works now also covers the **hook lines** (歌い出し and サビ). Lines are no longer 歌ハメ only after the
  user has timed their characters.
- Repeats are decided **per lyric text**, so every occurrence of a lyric looks the same.
- The 歌ハメ parameter rule runs **last** in `decidePart`, after the aligned-repeat copy.
- Cut boundaries derived from sung times keep time order and never create a merge.
- The voice analysis **reuses P5's `audio/phrases`**, runs only on demand, and stays switched off in planning until a
  measured accuracy gate passes.

All example lyrics are invented for this document. Line numbers refer to `main` at `9a9e950`.

---

## 0. Decisions at a glance

| Question | Decision |
|---|---|
| Phases | **A** (required): sung units and window, the `sung.times` pin, LRC word tags, 1字ずつタップ, the 歌ハメ switch with 自動 (explicit times + hook lines), the engine branch for every consumer, tests, golden. **B**: timeline ticks and drag. **C**: song voice (`doc.song.voice` from P5's `audio/phrases`), voice end and snapping, shipped with both constants off until the lab gate passes. **D**: optional AI word timing and 歌った字に色をのせる (karaoke fill). Each phase is golden-safe alone (S3.8). |
| Where per-character times live | Sources in priority: (1) a **line pin** `line/<id>:sung.times` = `[[offset, dt], …]` (text offset in the line, seconds after the line's start; written by 1字ずつタップ, tick drags or the optional AI); (2) **enhanced-LRC word tags** `<mm:ss.xx>`, kept in the row's `src` and parsed into `ParsedRow.words`; (3) a **copy** from the occurrence of the same lyric that has the best explicit times (earlier or later); (4) an **estimate** inside the line's **sung window** (Phase C: snapped to vocal onsets on anchored lines once enabled). |
| Sung window | Characters spread over `[t0, sungEnd]`, not `[t0, t1]`. `sungEnd` = the end pair of the pin, else an end word tag, else (Phase C, when enabled) the vocal end, else the estimate. The estimate is `T[last] + morae after the last anchor / rate × 1.1`, where `rate` is **the line's own measured rate** when it has ≥ 2 anchored units, else `readRate`. It is capped at the line's span. Being ≤ span, it never lags more than the v2 spread; its failure mode is finishing early (the T4 direction). |
| Plan data | Optional cut field **`cut.sung = { at, end, t }`**, printed and fingerprinted **only where present**. Non-enumerable **`plan.sung`** (Map lineId → line summary) feeds the UI. |
| Engine | `STG.sungTimes(env, target, unit)` maps glyphs to their unit's sung time (new target field `off`). Consumers (`motionTiming` for **arrive only**, `shot.sungOf` / `readingUnits` / new `sungEndOf`, underSweep via `K.sungAt`) take the new branch **only when `env.cut.sung` exists**. `shot.spanOf` and xshot are unchanged. `ORDERS` is untouched. |
| The switch 「歌ハメ」 | Slot `sung.hame` (bool) at 作品全体 / 行 / 複数行・区画. Resolution: `line pin ?? (line is キメ ? false : work pin ?? auto)`. **On**: the arrive pool is restricted to per-glyph entrances (`HAME_ARRIVE`); layouts that move the text are left out. As the **last** parameter step, `order = 'sung'` and `dur = clamp(timing.lead, 0.06, 0.25)` by rule (`pfrom 'rule:sung'`). Each character starts `dur` before it is sung and lands on it. |
| 自動 (new works) | On for a line (not キメ) when it has explicit character times (own or copied: tier **E**), or when `sung.real` is on and its lyric text is a **hook** (tier **H**). A hook is the song's first lyric line, or a chorus line at run position 0, 3, 6, …. The decision is per lyric text, so repeats match. Old works: 自動 = off. |
| Karaoke fill (D) | Slot `sung.fill` (bool, pin-only, off by default): 「歌った字に色をのせる」. An engine-internal STYLE behaviour dims unsung glyphs and ramps each to the accent tint over its syllable. Glyphs inked in accent dim only. No new part, no POSE column, no draw change. |
| Defaults | New works (`doc.look.gen ≥ 1`, P2's marker written only by the new-work function): 「字の時間を歌に合わせる」 (`sung.real`) **on**; 「歌ハメ」 **自動** (tiers E + H); fill off. Existing works: everything off; a `sung.times` pin (a user action) is always honoured. |
| T4 (P5) | P5 writes `timing.lead: 0.2` in new works and exempts sung-order cuts from 出そろい. The rule is: each character's entrance **starts `dur` before its sung time and lands on it** (`SUNG_AHEAD = 0`), with `dur = clamp(lead)`. In new works that is 0.2 s ahead of the voice. |
| Tap | 「1字ずつタップ」 on 行 › 時間 loops the line (optionally at 0.75× / 0.5×). Each tap marks the next unit, and **E** marks the end of singing. Esc / T finish (≥ 2 marks); 「やめる」 cancels. At the loop end it pauses and offers [決定] [もう一度]. The result is one undo step. |
| Seeing and editing (B) | Ticks under each line on the timeline. Drag a tick (also pins an automatic start at its current time); double-click / Delete gives it back to the estimate; Alt+←/→ focuses ticks. |
| Voice (C) | Reuses P5's `audio/phrases` (mid/side centred power, tonality, band flux). It is persisted compactly as `doc.song.voice` only through 「曲の声を読む」 in ② 曲 (on demand, never at load). Planning uses it only on lines whose start is anchored, and only once `VOICE_END` / `SNAP_GAIN` are enabled by the lab gate. |
| AI (D) | Not needed. Optional 「AIで字の時間」 returns word starts as review changes of kind `time` with `lineId`; applying also pins an automatic start. |
| Goldens | All byte-identical: no fixture has `look.gen`, a `sung.*` pin or `song.voice`; `SU.prepare` returns `null` for them. New golden `tests/golden/project_sung.json` (per-phase entries; documents with explicit pins, or gen 1 with the other packages pinned off). |
| FROZEN contracts | `ORDERS`, POSE columns, seam mix, SCH enums, slot order, draw's tint contract: **untouched**. Additive items are listed in Appendix B. |
| Behaviour change in existing works (called out) | Word tags are now kept when a tagged row is edited through the inspector (強調, 見せ場, ふりがな …) or by ≡ › 時刻を歌詞に書き込む. Today they are silently dropped. This is an intentional fix; no golden renders a tagged row (S3.8). |

---

## Phases

| Phase | Content | Golden-safe because |
|---|---|---|
| **A** (required) | `planner/sung` (units, anchors, window, copy, hook tiers, prepare/decide), `core/lyrics` word tags, `sung.times` pin + scope rules + reconcile, `core/tap` unit reducer + `ui/tap` unit mode, cast rule (pool, params last, copyParams), segment pieces, `cut.sung` + encode + fingerprint, engine branches (stagger, behave arrive, shot, kit, underSweep), fields/explain/inspector rows, strings, tests, `project_sung.json` entries A1–A4 | fast path returns null for every fixture |
| **B** | `ui/timeline` ticks, hit test, drag (+ start pin), keyboard; browser tests | UI only; writes pins through commands |
| **C** | `audio/voice` (encode/decode of P5's `PhraseAnalysis`), `doc.song.voice`, command `song.voice`, 「曲の声を読む」 in ② 曲, `voiceEnd` + `snap` in `planner/sung` behind `SU.C.VOICE_END = false` and `SNAP_GAIN = 0`, lab ground-truth harness (not CI); golden entry C1 | no fixture has `song.voice`; constants off |
| **D** | `sung.fill` slot + engine fill behaviour; `ai/song` words request + `ai/changes` extension; golden entry D1 | pin-only slot; AI is review-only |

Phase A alone delivers the owner's item: characters appear one at a time with the singing, on by default for the hook
lines of a new work, with a real per-character timing path (taps and LRC word tags).

---

## S3.1 What the user gets

### The look

- **歌ハメ on a line**: the line's characters come in one at a time. Each starts `入りの早さ` before it is sung (0.12 s
  in old works, 0.2 s in new works through P5's T4) and lands as it is sung. The entrance comes from a short list that
  reads well one character at a time: 打鍵 `typeOn`, 切り出し `sliceReveal`, 墨のぼり `inkRise`, 花開き `bloomOpen`,
  寄せ `zoomSettle`, 落下 `dropSnap`, 起き上がり `riseFromFlat` and 粗から `pixelStep`. English lines may also take ぽん
  `wordPop` and 押印 `stampPress` (a word at a time). The planner still picks among them with its usual variety.
  「くり返しの行をそろえる」 and P2's kit still apply inside the list. The layout 流れ帯 `tickerMarquee` moves the text
  itself, so it is not picked for a 歌ハメ line.
- In a **new work**, 歌ハメ comes on by itself for:
  - the song's first line (歌い出し);
  - the first line of every chorus run, and every third chorus line after it;
  - every line with character times (tapped, word-tagged, or the same lyric tapped elsewhere).

  The same lyric always comes back the same way. キメ lines are left to キメ.
- The characters follow **real timing when there is any**: taps, word tags of an imported enhanced LRC, or the same
  lyric timed elsewhere in the song (earlier or later). Without any, they spread over the estimated singing, not over
  the whole time the line stays up, so the last character no longer lags.
- **歌った字に色をのせる (karaoke, Phase D)**: the whole line comes in by its normal entrance, dimmed. Each character
  turns to the theme's accent colour as it is sung. Characters already inked in the accent colour brighten instead.
  It combines with 歌ハメ or stands alone.
- In works where 「字の時間を歌に合わせる」 is on, everything else that follows the singing uses the same times:
  - the camera's 「読みに合わせる」 and 「歌に合わせて」 aims;
  - the key anchors 強調 / n語目 / 真ん中 / 終わり;
  - the 下線 (underSweep) decoration;
  - the cut boundaries of a line split into pieces (each piece starts when its first character is sung, never shorter
    than 0.35 s).

### Where (Japanese UI)

- **③ 見た目 › 行 › 演出（すべてのカット）** (`sec.direction`), right after 「文字の出方」:
  - 「歌ハメ」 [自動 | オン | オフ]. The 自動 option reads 「自動（オン: 字の時間がある行）」, 「自動（オン: 歌い出し・サビ
    の行）」, 「自動（オフ）」 or 「自動（オフ: キメの行）」 for the line. A work pin shows the usual inherited state
    (作品全体で固定), as every work-pinned row does. Note `fld.hame.note`.
  - 「歌った字に色をのせる」 toggle (Phase D; off = unpin; `basic: false`).
- **③ 見た目 › 複数行** and **区画**: the same two rows; they write a line pin on every selected line (mixed selections show
  混在).
- **③ 見た目 › 作品全体 › 見た目** (`sec.look`, after 「くり返しの行をそろえる」): 「歌ハメ」 [自動 | すべての行 |
  使わない]; 「歌った字に色をのせる」 (Phase D, `basic: false`).
- **③ 見た目 › 作品全体 › タイミング** (`sec.timing`, after 入りの早さ and P5's 入りの基準): 「字の時間を歌に合わせる」
  toggle (shows the document default as 自動; `autoDefault`; `basic: false`), note `fld.sungReal.note`.
- **③ 見た目 › 行 › 時間** (`sec.time`), under 長さ:
  - a read-only row 「字の時間」 = 「9か所 · 歌詞の単語タグ」 (unit count and source);
  - **[1字ずつタップ]** (needs a loaded song);
  - **[字の時間を消す]** (only when the line has a `sung.times` pin).

  Phase C: when the song is loaded, its voice not yet read, and this line has sung timing that could use it
  (`real || hame` for the line), a note 「曲の声を読むと、字の時間がもっと合います（② 曲）」 points to ② 曲.
- **② 曲** (`step_song.renderSongBox`, Phase C, shown once `SU.C.VOICE_UI` is true): next to the song status,
  **[曲の声を読む]** with progress and 中止, and the state 「曲の声: 読み済み」.
- **Timeline** (Phase B): ticks under every line when there is room. The selected line also shows its characters over
  the ticks. Drag = move that character; double-click or Delete = back to the estimate.
- **Command palette**: 「1字ずつタップ」 (`tap.units`); Phase C 「曲の声を読む」 (`song.readVoice`).
- **なぜ** (inspector why line):
  - 入り: 「歌ハメなので、1字ずつ出る入りから選んだ」
  - 文字の出方: 「歌ハメなので、歌に合わせて出す」
  - 長さ: 「歌ハメなので、字が歌と同時に出そろう長さ」
  - 構図: 「歌ハメなので、文字を自分で動かす構図は使わない」
- **① 歌詞**: word tags stay in the row as typed or imported; the lyric editor shows them muted (like stamps).

### Defaults

| | New work (`look.gen ≥ 1`) | Existing work, opened file, fixtures |
|---|---|---|
| 字の時間を歌に合わせる | on | off |
| 歌ハメ (作品全体) | 自動 = lines with character times + hook lines | off (自動 means off) |
| 歌った字に色をのせる (D) | off | off |
| a `sung.times` pin (tap, drag, AI) | used | used (explicit user data) |

---

## S3.2 Gating and defaults

1. **Marker.** P6 follows P2 §0.2: `doc.look.gen` is written only by the single new-work function (`D.newDoc()` in P2's
   naming; P1 and P5 call it `newWorkDoc()`; the integrator keeps one name). It is called at `ui/boot.js:107`,
   `ui/project_io.js:610` and `:1176`. `defaultDoc()`, `normalize()`, `migrate.parseFile()`, fixtures,
   `tests/helpers/corpus.js`, `tests/update_golden.js` and the ~50 `D.defaultDoc()` calls in tests stay legacy. P6 adds
   nothing to the new-work function. `SU.gen(doc) = Number.isInteger(doc.look && doc.look.gen) ? doc.look.gen : 0`.
2. **`sung.real`** (work only) resolves as `work pin (bool) ?? gen ≥ 1`. It is a row of P2's `planner/rules` table,
   `{ slot: 'sung.real', parent: null, scopes: ['work'], def: (gen) => gen >= 1 }`, so `RU.value` / `RU.defaultValue`
   serve the planner and the `autoDefault` toggle. If P2 has not landed, P6 creates `planner/rules` with this row and
   the same API (P2 §0.3).
3. **`sung.hame`** resolves per line:
   `hame = linePin ?? (line.kime ? false : (workPin ?? auto(line)))`, with
   `auto(line) = gen ≥ 1 && !line.kime && (tierE(line) || tierH(line))`:
   - `tierE(line)` = the line's sung timing uses explicit anchors (own pin, own word tags, or a copy; S3.4 b);
   - `tierH(line)` = `sung.real` resolves true and the line's text is in `hookTexts` (S3.4 d2).

   A work-wide 「すべての行」 therefore never makes a キメ line 歌ハメ; only a line pin does (specific beats general,
   P3 M3.4 l). In old works `auto` is false, so nothing changes until the user switches 歌ハメ on.
4. **`sung.fill`** (Phase D) resolves as `line pin ?? work pin ?? false` (pin-only).
5. **Which lines get sung timing** (`ls ≠ null`): a line with a `sung.times` pin (any work); or any line when `sung.real`
   is true; or a line whose 歌ハメ pin resolves true; or a line whose `sung.fill` resolves true.
   **The fast path**: `SU.prepare` returns `null` when
   `!real && !PA.pinned(ix, 'sung.times') && !PA.pinned(ix, 'sung.hame') && !PA.pinned(ix, 'sung.fill')`. Documents
   without the marker or a `sung.*` pin run exactly the v2 code: no cut gets `sung`, `pieceTimes` is untouched, and
   the cast does not change.
6. **Which sources a line may use** (`sourcesOK = real || hamePinOn(line) === true`): the pin always. Word tags and
   copies only when `sourcesOK`. The voice (Phase C) only when `sourcesOK`, the line's start is anchored and a constant
   is enabled. A fill-only line in an old work uses its pin, else the v2 window over the span, and keeps v2 piece
   boundaries (S3.4 c, e).
7. **Older builds** opening a new work: `sung.*` pins are unknown slots, never resolved, and ignored silently.
   `song.voice` is an unknown key of `song`: `checkSong` checks only the keys it knows, `normalize`/`fillMissing` keep
   extra keys, and `ordered()` writes keys not in `ORDER` after the listed ones, so it survives a save. No `schema`
   bump.
8. **「固定を外す」** (`pin.clearUnder`): `sung.*` pins are cleared like any other slot under the scope (no special case).
   A line scope clears `start`, `end` and `sung.times` together, which keeps them consistent. A work scope clears
   `work:sung.hame`, `work:sung.fill` and `work:sung.real` (back to the document default, which is what 自動 means).
   Not added to P1's `SETTING_SLOTS`.
9. **If the lead picks default pins instead of the marker**: `NEW_WORK_PINS` gains
   `'work:sung.real': { v: true, by: 'user' }`, and `auto` reads `RU.value(doc, ix, 'sung.real')` instead of
   `gen ≥ 1`. Nothing else changes.
10. **Called-out behaviour change (all documents, not gated).** With `words` in `FIELD_KEYS` and `renderRow`, editing a
    word-tagged row through `lyrics.row` (inspector 強調 / 見せ場 / ふりがな / 区切り, `ui/inspector.js:467-469`) or
    ≡ › 時刻を歌詞に書き込む (`ui/menus.js:159-160`) now keeps its word tags. `bakeTimes` shifts them with the new stamp.
    Today both silently drop them. This is intentional: tags are user data. Goldens are unaffected because no golden
    path renders a tagged row. Tests: S3.7 lyrics / menus.

---

## S3.3 Data model

### Lyric rows (`core/lyrics`, §3.11 / §4.9, additive)

- `ParsedRow.words` is present **only** on a lyric row with at least one word tag: `[[at, t], …]` in tag order.
  - `at` = UTF-16 offset in `row.text` snapped to a grapheme start; `at === text.length` means a tag after the last
    character, i.e. where the singing ends.
  - `t` = the tag's absolute seconds.

  `row.text`, `pieces`, `emph`, `impact` and `note` are exactly what v2 parses (verified: 228/228 fixture rows and
  20,000 random rows with tags, A.2).
- `Line.words` and `Line.wordsRef` (only when the row has words): the same array for every occurrence of the row.
  `wordsRef` = `row.stamps[0]` when the row is stamped, else `words[0][1]`. The planner uses `dt = t − wordsRef`,
  relative to each occurrence's own start. For an unstamped row, the tags are therefore relative to the line's
  (automatic) start; this is documented in SPEC.
- `FIELD_KEYS` gains `'words'` as its last entry. P3 revision 2 makes キメ a line pin and leaves `core/lyrics`
  untouched, so there is no conflict. `renderRow` writes the tags back at their offsets. A `lyrics.row` that changes `text` drops `words`
  unless the command gives new ones. `sameFields` compares `words` (`null` = none).
- New `L.shiftWords(parsed, newFirstStamp)` → `words` moved by `newFirstStamp − ref`, where `ref` = the old first
  stamp, else the first tag. Used by `roundTrip` when the merged first stamp differs from the parsed one, and by
  `ui/menus.bakeTimes`.
- No migration: word tags have always been kept in `row.src`; they now also mean something.

### Pins

| Slot | Scopes | Value | Written by |
|---|---|---|---|
| `sung.times` | line only | `[[off, dt], …]`: 1–400 pairs; `off` integer, a grapheme start of the line text or `text.length` (the end, last pair only); strictly increasing `off`; `dt` finite, `0 ≤ dt ≤ 600`, each ≥ previous + 0.01 | 1字ずつタップ (`tap`), tick drags (`user`), AI (`ai`) |
| `sung.hame` | work, line | bool | inspector |
| `sung.fill` (D) | work, line | bool | inspector |
| `sung.real` | work | bool | inspector |

- **`core/commands` scope refusals** (`checkSlotScope`, commands.js:240, which `pin.set` calls):

  ```js
  need(!(parsed.slot === 'sung.times' && parsed.scope.kind !== 'line'), 'sung.times can be pinned only at line scope');
  need(!(WORK_ONLY.has(parsed.slot) && parsed.scope.kind !== 'work'), parsed.slot + ' can be pinned only at work scope');
  need(!(parsed.scope.kind === 'cut' && (parsed.slot === 'sung.hame' || parsed.slot === 'sung.fill')),
    parsed.slot + ' cannot be pinned at cut scope');
  ```

  `WORK_ONLY` is P2's set (for `pv.*`); P6 adds `'sung.real'`. If P2 has not landed, P6 creates
  `const WORK_ONLY = new Set(['sung.real'])`. `LINE_ONLY += 'sung.times'` (read by `pin.promote`, so it is never
  promoted to work). `pin.promote` line → work is allowed for `sung.hame` / `sung.fill` (like `season`). `pin.copy`
  (見た目の貼り付け) copies none of them (not in `COPY_SLOTS`, not part or text slots).
- `core/reconcile.remapMap`: `:sung.times` pins of an edited row go through a new
  `remapSungTimes(pin, table, newLength)`:
  - each pair's offset goes through the offset table;
  - a pair whose character was deleted (mapped onto a kept one that already has a pair) is dropped;
  - the end pair maps `old length → new length`;
  - the pin is dropped when no pair remains.
- The planner validates with `acceptSungTimes(text)` (`rank === 'pin:line'` only). A bad value warns the existing
  `pin-bad-value`, and the line falls back to the other sources.

### Song voice (`doc.song.voice`, optional, Phase C)

```js
song.voice = { v: 1, hz: 25, act: '<base64 of u8[]>', peaks: '<base64 of bytes>' }
```

- `act[k]` = vocal activity 0…255 of the 40 ms frame `k`: P5's normalized activity `a` (100 Hz) reduced by the max of
  each 4 frames, × 255, rounded.
- `peaks` = P5's candidates (`phrase` and `weak`) as a byte stream of `(delta, strength)` records. `delta` =
  centiseconds since the previous peak (the first since 0), as unsigned LEB128; `strength` = `round(255 · s)`.
- `core/doc`:
  - `ORDER.song` gains `'voice'` after `'digest'`; `ORDER.voice = ['v', 'hz', 'act', 'peaks']`.
  - `checkSong` accepts an absent or `null` voice, else `{ v: 1, hz > 0, act: string, peaks: string }`; a bad value
    reports `song.voice: must be { v: 1, hz, act, peaks } or null`.
  - `voice` is **not** added to `SONG_DEFAULTS`, so `normalize` never writes it.
- New command `song.voice { sha1, voice }`: sets `doc.song.voice` when `doc.song.sha1 === sha1`, and is refused
  otherwise (`CommandError('stale')`). It is validated by `checkSong`. A new `song.set` (another song) drops `voice`.

### Plan (§3.12, additive)

- **`cut.sung`** on a lyric cut whose line has sung timing and at least one unit inside the cut:
  `{ at: number[], end: number, t: number[] }`.
  - `at[k]` = offset in `cut.text` of the k-th sung unit that starts inside the cut.
  - `t[k]` = seconds after `cut.t0` (≥ 0, rounded to 0.001).
  - `end` = where this cut's singing ends, in seconds after `cut.t0`.

  Keys are sorted, so `encode.asIs` prints it natively. Absent on every other cut.
- `encode.cutPieces` prints it in the last object: `JSON.stringify({ sung: cut.sung, t0, t1, text })`. JSON drops the
  undefined key, so every existing cut keeps its bytes, and `'slots' < 'sung' < 't0'` keeps the key order.
  `encodeCutParts` does `if (cut.sung !== undefined) put('sung', canon(cut.sung))` between `slots` and `t0`.
- Fingerprint: `planCut` pushes `EN.canon(c.sung)` onto `extra` only when present (like `mine`), and `encodingKey`
  appends it. It is cut-local, so a cut that only moved in time keeps its key and is re-timed (`retimeCut`).
- **Decisions**: there is no decision slot for `sung.hame`, so `lockPayload` never writes a refused
  `cut/…:sung.hame`. Phase D: `cut.slots['sung.fill'] = { v: true, from: 'pin:line' | 'pin:work', by }` only when a
  pin resolves true. The arrive decision of a 歌ハメ cut carries `pfrom.order = 'rule:sung'` and
  `pfrom.dur = 'rule:sung'` where no pin set them.
- **`plan.sung`** (non-enumerable, like `plan.env`, `plan.reuse` and P2's `plan.pv`): `Map<lineId, LineSung>` with
  - `at`: `Int32Array` (line offsets); `t`: `Float64Array` (absolute seconds); `end` (absolute seconds);
  - `src`: `Uint8Array` per unit — 0 est, 1 voice, 2 copy, 3 lrc, 4 pin;
  - `by`: `'pin' | 'lrc' | 'copy' | 'voice' | 'est'` (the best source used); `pinBy`: `'tap' | 'user' | 'ai' | null`;
  - `explicit`: bool;
  - `hame`: bool; `hameWhy`: `'pin:line' | 'pin:work' | 'times' | 'hook' | 'kime' | 'off'`;
  - `fill`: bool; `dropped`: n (word tags not used).

  Not hashed.

### Engine (additive)

- Scene target (`build.makeTarget`, §4.17.5): `off: Int32Array(n)` = the glyph's offset in `cut.text`
  (`stores.glyph[…].off`); `-1` for a run that shows its own text (`spec.text`: notes, ♪).
- Kit (§4.18.3): `K.sungAt(env, off)` → cut-local seconds when the cut has `sung`, else `null`.
- `engine/scene/shot`: new export `sungEndOf(env)` = `env.cut.sung ? env.cut.sung.end : spanOf(env)`.
- `engine/text/vert`: export the existing `MAX_TCY_DIGITS` (additive; not in `contract.test.js`).

---

## S3.4 Algorithm

All constants live in `planner/sung` (`SU.C`, frozen) unless noted.

```js
const C = Object.freeze({
  EST_SLACK: 1.1,        // estimated singing = morae / rate × 1.1 (tuned by the lab gate, S3.10 R1)
  RATE_MIN: 2, RATE_MAX: 16,   // a line's own measured rate (morae / s) is clamped to this range
  UNIT_MIN: 0.05,        // the sung end is at least 0.05 s per unit after the last anchored unit
  ANCHOR_GAP: 0.02,      // a word anchor closer than this to the one before is dropped (pins are refused instead)
  MIN_PIECE: 0.35, PIECE_EPS: 1e-6,   // = segment's MIN_PIECE; sung-derived boundaries keep every piece ≥ it
  HOOK_EVERY: 3,         // a chorus run's lines at positions 0, 3, 6, … are hook lines
  HAME_DUR_MIN: 0.06, HAME_DUR_MAX: 0.25,
  LETTER_STEP: 0.06, LETTER_SHARE: 0.8,
  // Phase C (off until the lab gate passes, S3.10 R1):
  VOICE_END: false, SNAP_GAIN: 0, VOICE_UI: false,
  SNAP_MAX: 0.15, SNAP_SHARE: 0.45, PEAK_MIN: 0.25, SNAP_GAP: 0.04,
  ACT_ON: 0.35, ACT_OFF: 0.2, QUIET_RUN: 0.25, END_PAD: 0.08,
});
const HAME_ARRIVE = Object.freeze(['typeOn', 'sliceReveal', 'inkRise', 'bloomOpen', 'zoomSettle', 'dropSnap',
  'riseFromFlat', 'pixelStep']);
const HAME_ARRIVE_LATIN = Object.freeze(HAME_ARRIVE.concat(['wordPop', 'stampPress']));
const OPENERS = new Set(['「', '『', '（', '(', '“', '‘', '〈', '《', '【', '〔', '［', '[', '｛', '{', '"', "'"]);
```

### (a) Sung units — `SU.unitsOf(text, lang)` (memoized, 2,000 entries, like `segment.memo`)

A unit is what is sung as one beat and appears as one step:

```
gs = graphemes of text with offsets; class c = S.charClass(g)
for each grapheme g at offset o:
  latin / fullLatin letter: starts a unit at the first letter of a word (' ’ - inside a word continue it)
  digit: a run of ≤ V.MAX_TCY_DIGITS (2) digits is ONE unit (it is one tate-chu-yoko cell in vertical text and one
         sung number); in a run of ≥ 3 digits every digit starts its own unit (vertical draws them one per cell)
  g ∈ OPENERS (opening brackets / quotes): joins the FOLLOWING unit (it appears with the character it opens)
  any grapheme with S.morae(g) > 0, or han: starts a unit (hira, kata, っ, ー, hangul, han)
  otherwise (small kana ゃゅょ…, closing punctuation, space, symbol, emoji): joins the unit before it
                                                         (before the first unit: joins the first)
weights w[u] = max(0.5, S.morae(text.slice(at[u], at[u+1])))       → Σ w = S.morae(text) for ordinary lines
unitAt(off) = the unit u with at[u] ≤ off < at[u+1]; if the grapheme at off is whitespace or closing punctuation
              (a backward joiner) and u + 1 exists → u + 1
```

The digit rule is independent of orientation, so the plan does not depend on the cast's `orient`. `planner/sung`
imports `engine/text/vert`, which `build.py PLANNER_TEXT` allows.

Examples (A.3):

- 「きみの声がきこえた」 → 9 units, weights `[1,1,1,1.7,1,1,1,1,1]`.
- 「しゅっぱつ しんこう！」 → 8 units (しゅ, っ, ぱ, つ␣, し, ん, こ, う！).
- 「「25時」まで」 → 5 units (「25, 時」, ま, で — the opener joins 25, the closer joins 時).
- "Hello new world" → 3 units, weights `[2,1,1]`.

### (b) Anchors of a line and the copy rule

Pass 1 (per line, in time order), **own anchors**:

1. A `sung.times` pin (validated) → anchors `(unitAt(off), dt, src 4)`; an end pair gives `endRel`.
2. Else, if `sourcesOK`: `line.words` → `(unitAt(at), t − line.wordsRef, src 3)`. Drop a word whose `dt < 0` or whose
   absolute time `line.t0 + dt > line.t1`. Drop a word not ≥ `ANCHOR_GAP` after the previous kept one. A word at
   `at === text.length` gives `endRel`. `dropped` counts them; `dropped > 0` → plan warning
   `{ code: 'sung-words', line, detail: { n: dropped } }` (reachable only under the gate).
3. The first anchor on a unit wins.

**Group sources**: for each lyric text, `best(text)` = the occurrence whose own anchors have the highest source (pin 4
> lrc 3). Ties go to the earliest occurrence in time order. Only lines with own explicit anchors qualify.

Pass 2, **copies**: a line with no own explicit anchors, `sourcesOK`, and `best(text)` existing (another line) borrows
its anchors (and `endRel`) with `src 2`. Times are scaled by `k = min(1, span / srcEnd)` when this line's span is
shorter than the source's sung end. Earlier occurrences borrow from later ones too, so a pin on the second chorus times
the first. `ls.explicit = anchors.some(a => a.src >= 2)`.

### (c) Filling a line — `SU.fillLine(ls)`, pure

Inputs:

- units `(at, w)`, the anchors and `endRel`;
- `span = spanEnd − t0`, with `spanEnd = min(t1, next line t0)` as the cutter uses;
- `rate = TM.readRateOf(…)` (already exported, `core/timing.js:206`);
- `voice` (decoded, or null — Phase C) and the flags `sourcesOK` and `anchoredStart` (`line.by.start !== 'auto'`).

```
T[0] = anchor of unit 0, else 0                                   (the singing starts at the line's start)
last = last anchored unit (0 when none)
A = anchored units (excluding the end); ls.anchored = |A|
if |A| ≥ 2 (first f < last l): rateLine = clamp((Σ_{u=f}^{l−1} w[u]) / (T[l] − T[f]), RATE_MIN, RATE_MAX)
else rateLine = rate
E = endRel
  ?? (C.VOICE_END && voice && sourcesOK && anchoredStart ? voiceEnd(voice, t0 + T[last], t0 + span) − t0 : undefined)
  ?? (|A| ≥ 2 || sourcesOK ? T[last] + (Σ_{u ≥ last} w[u]) / rateLine × EST_SLACK : span)
E = clamp(E, T[last] + UNIT_MIN × (n − last), span)

interpolate every unanchored unit between two anchored ones (E counts as an anchor at unit n):
  T[u] = T[i] + (T[j] − T[i]) × (Σ_{k=i}^{u−1} w[k]) / (Σ_{k=i}^{j−1} w[k])

if C.SNAP_GAIN > 0 && voice && sourcesOK && anchoredStart: snap(T, anchored, voice)       (Phase C)
round every T[u] and E to 0.001
```

Because `E ≤ span`, the estimate never places a character later than the v2 spread over the span would. It errs
early (finishing before a held note ends), which is the direction T4 already chooses for whole lines. A measured line
rate replaces `readRate` as soon as the user or the tags have timed two units.

A line that has sung timing only for the karaoke fill (old work, no `sung.real`, no 歌ハメ pin, fewer than 2 anchors)
keeps the v2 window (`E = span`) and v2 piece boundaries (e), so turning on the colour alone changes only colour.

`voiceEnd(voice, a, b)` (Phase C): over the activity frames in `[a + 0.1, b]`, take the last frame with `act ≥ ACT_ON`
that is followed by `≥ QUIET_RUN` of `act < ACT_OFF` (or that reaches `b`). Return that frame's end + `END_PAD`, or
`undefined` when no frame is active.

`snap(T, fixed, voice)` (Phase C) is a Viterbi pass over each run of unanchored units between two fixed ones:

```
for unit u: R_u = min(SNAP_MAX, SNAP_SHARE × min(T[u] − T[u−1], T[u+1] − T[u]))        (prior spacing)
  candidates = { T[u] (cost 0) } ∪ { p ∈ peaks : |p − T[u]| ≤ R_u, s_p ≥ PEAK_MIN }
  cost(p) = |p − T[u]| / R_u − SNAP_GAIN × s_p
constraint: x_u ≥ x_{u−1} + SNAP_GAP, and x_last ≤ next fixed − SNAP_GAP
pick the path of least total cost (ties: the earlier candidate); units moved to a peak get src 1
```

Numbers for an invented line 「きみの声がきこえた」, `t0 = 12.00`, `t1 = 16.00`, no next line (A.3):

| source | unit times after `t0` (s) | sung end |
|---|---|---|
| v2 `'sung'` (whole cut) | 0, .41, .83, 1.24, 1.94, 2.35, 2.76, 3.18, 3.59 | — (4.0) |
| estimate, rate 7 | 0, .16, .31, .47, .74, .90, 1.05, 1.21, 1.37 | 1.52 |
| word tags at 0 / .62 / 1.30, end 2.20 | 0, .21, .41, .62, 1.05, 1.30, 1.53, 1.75, 1.98 | 2.20 |
| word tags at 0 / .62 / 1.30, no end tag (line rate 5.7 / 1.30 = 4.38) | 0, .21, .41, .62, 1.05, 1.30, 1.55, 1.80, 2.05 | 2.30 |

`LineSung.by` = the highest source among the units (4 pin > 3 lrc > 2 copy > 1 voice > 0 est).

### (d) `SU.prepare(ctx, timed)` — plan stage 1b, after `timeLines`, before the cutter

```
real = RU.value(doc, ix, 'sung.real')           // pin ?? gen ≥ 1
if (!real && !PA.pinned(ix,'sung.times') && !PA.pinned(ix,'sung.hame') && !PA.pinned(ix,'sung.fill')) return null
voice = Phase C && doc.song && doc.song.voice ? VO.decode(doc.song.voice) : null     // memoized by identity
pass 1, each timed line:
  linePin = resolve 'sung.hame' at rank pin:line (bool); workPin = at pin:work (bool)
  hamePinOn = linePin ? linePin.v : line.kime ? false : workPin ? workPin.v : null      // null = auto (decided in d2)
  fillOn = resolve 'sung.fill' (bool) ?? false                                            // Phase D; false before
  pin = resolve 'sung.times' (rank pin:line, acceptSungTimes(line.text))
  sourcesOK = real || hamePinOn === true
  need = !!pin || real || hamePinOn === true || fillOn
  own anchors (b 1–3)
group best(text) (b)
pass 2, each line with need: anchors = own explicit ?? copy (b) ?? []; ls = fillLine(…)      // memoized, frozen
  lines.set(id, ls)
  meta.set(id, { hamePinOn, kime: !!line.kime, fill: fillOn, fillFrom,
                 hameFrom: linePin ? 'pin:line' : line.kime ? 'kime' : workPin ? 'pin:work' : 'auto' })
lines without need → lines.set(id, null)
return { lines, meta, real, gen, hame: new Map(), hameAt(cut), idOf(cut) }    // hame filled in d2
```

`ls` (the timing: `at`, `t`, `end`, `src`, `explicit`, `anchored`, `sourcesOK`) is memoized and frozen. The per-plan
switch state lives in `meta`, and `plan.sung` merges both into `LineSung` at the end of the plan.

With 「字の時間を歌に合わせる」 pinned off in a new work, word tags, copies and hooks are not used. 自動 then turns 歌ハメ
on only for tapped lines (a `sung.times` pin). That is the switch's meaning: "do not follow the song or the tags".

Line results are memoized across plans by `[text, lang, t0, t1, spanEnd, pin JSON, words JSON, wordsRef, sourcesOK,
rate, anchoredStart, copy source JSON, voice identity]`; an unchanged line returns the same frozen object.

### (d2) `SU.decideHame(ctx, cuts, timed)` — plan stage 4b, after features (and P2's `ctx.pv`), before cast

```
if (!ctx.sung) return
parts = ctx.pv ? ctx.pv.partOf                                  // P2 on: its song parts (real or pseudo sections)
      : ARC ? ARC.parts(ctx, cuts, timed).partOf                // P2 landed but its rules are off: same shared definition
      : realSectionPart                                         // P2 absent: runs of equal cut.feat.section (real only)
hookTexts = ∅
if (ctx.sung.real && gen ≥ 1):
  lyricLines = timed lines that have ≥ 1 lyric/focus cut, in time order
  add text of lyricLines[0]                                       // 歌い出し
  for each run of cuts whose part kind is 'chorus': its distinct lines in order, index i → add text when i % HOOK_EVERY === 0
for each line with ls (m = meta.get(line.id)):
  tierE = ls.explicit; tierH = ctx.sung.real && hookTexts.has(line.text)
  auto = gen ≥ 1 && !m.kime && (tierE || tierH)
  hame = m.hamePinOn !== null ? m.hamePinOn : auto            // a キメ line without a line pin has hamePinOn false
  why = m.hameFrom !== 'auto' ? m.hameFrom                    // 'pin:line' | 'kime' | 'pin:work'
      : tierE && auto ? 'times' : tierH && auto ? 'hook' : 'off'
  ctx.sung.hame.set(line.id, { hame, why })
```

Both tiers are keyed by lyric text, so every occurrence of a lyric gets the same 自動 answer (M1). A line pin can still
differ on purpose. Field display: `'pin:line'` shows the pinned state and `'pin:work'` the inherited work-pin state
(both through the existing `fieldState` pin logic); `'times'`, `'hook'`, `'kime'` and `'off'` show 自動 with
`autoText ['sung.auto.' + why]`. On the fixtures (probe `p6r/hooks.js`, A.5), 歌い出し plus the chorus heads give:

- real sections: basic 2, long 1, repeat 3, v21 2, vertical 1 (plus chorus positions 3, 6, …);
- lrc (no headings): 3, where the probe approximates P2's pseudo sections by blocks of repeated lines.

`ctx.sung` API used by others:

- `hameAt(cut)` → `null`, or `{ latin: cut.lang === 'en' }` for a lyric or focus cut of a line whose `hame` is true.
- `idOf(cut)` → `''` without 歌ハメ, else `'h' + (latin ? 'l' : '') + ':' + ctx.timing.lead` (the dur rule reads
  `lead`).
- `SU.isSungCut(cut)` (pure, post-cast) → `!!(cut.slots && cut.slots.arrive && cut.slots.arrive.p &&
  cut.slots.arrive.p.order === 'sung')`.

### (e) Pieces and `cut.sung` (`planner/segment`)

`pieceTimes(ctx, line, starts, pinKeys, spanEnd)`: the pinned `cut/<key>:t0` boundaries are resolved as today. Then,
when `ls = ctx.sung && ctx.sung.lines.get(line.id)` and `ls.sourcesOK || ls.anchored ≥ 2` (not a fill-only line), each
**run** between two consecutive pinned boundaries `a < b` (boundary 0 and `n` count as pinned, `T[n] = spanEnd`) is
filled from sung times:

```
g = MIN_PIECE + PIECE_EPS
if T[b] − T[a] < g × (b − a): today's weight interpolation for this run (unchanged v2 code); continue
for k in a+1 … b−1:
  want = line.t0 + ls.timeOf(starts[k])                    // the sung time of the unit containing the piece start
  T[k] = q6(clamp(want, T[k−1] + g, T[b] − g × (b − k)))
  sungB[k] = true
```

- **Time order**: `T[k] < T[b]` for every k in the run, and runs never cross a pinned boundary, so cuts stay in time
  order (§3.12) even when a later pinned boundary lies before an earlier unit's sung time.
- **No new merges**: every piece in a filled run is ≥ `MIN_PIECE`, so `mergeShort` cannot fire there. Infeasible runs
  keep v2 behaviour, merge included. User-typed `/` pieces and split pins are therefore kept exactly as often as today
  or more.
- `snapInner` skips `sungB[k]` boundaries (a sung time is more precise than the beat grid). `mergeShort` is unchanged.
  Without `ls` the whole function is the v2 code.

`cutsOfLine`: after the cuts are made, `cut.sung = SU.sliceCut(ls, a, b, cut.t0, cut.t1, line.t0)`:

```
units k with a ≤ ls.at[k] < b (b = the piece end in the line text)
at = ls.at[k] − a ; t = max(0, q3(line.t0 + ls.t[k] − cut.t0))
end = q3(min(line.t0 + ls.end, cut.t1) − cut.t0), at least t[last] + 0.02
no unit in the piece → no cut.sung
```

### (f) Casting a 歌ハメ cut (`planner/cast`)

`stateOf` gets `st.hame = ctx.sung ? ctx.sung.hameAt(cut) : null`, declared in the ctx and st literals for shape
stability. With `null`, every decision is the v2 one.

1. **Arrange**: `decidePart(st, 'arrange', null, st.hame ? { except: OWN_MOTION, rule: 'sung.arrange' } : null)`.
   - `OWN_MOTION` = the arrange keys with `def.motion === 'own'` (today `tickerMarquee`), computed once per registry.
   - `chooseAuto` gains `req.except` (a Set): the pool entry is the cached entry with those keys removed (cache sub-key
     `sub + '|x:' + id`). The chooser's seed and history are unchanged.
   - A pinned or aligned own-motion arrange still wins. 歌ハメ then has no effect on that cut, and explain says so
     (`whyRule.sung.own`).
2. **Arrive**: when `st.hame` and the arrange does not force the motions,
   `decidePart(st, 'arrive', null, { only: st.hame.latin ? HAME_ARRIVE_LATIN : HAME_ARRIVE, rule: 'sung.hame' })`.
   - `req.only` filters the pool (keys ∩ only).
   - **Empty result** (filters, avoid lists, season, role or traits removed all members): `o.force = 'typeOn'` when
     `acceptPart(ctx, 'arrive', cut.role)` accepts it and `doc.filters` does not exclude it, else
     `o.force = registry.fallback('arrive')`. Warn `{ code: 'hame-empty', cut: cut.key, line: cut.line }`.
   - An aligned part (「くり返しの行をそろえる」) outside the list is not taken (`alignedPart` returns null for it).
   - P3's キメ set, when a line pin makes a キメ line 歌ハメ, is intersected first (P3 M3.4 l).
3. **Parameter order inside `decidePart`** (the fix for aligned repeats). Final order:
   `PA.resolveParams` → `CAM.applySpeed` → `copyParams` → P2 `flipParams` → P3 `KI.params` → **P6 `hameParams`
   (last)**.

   `hameParams(st, kind, d)` applies when `kind === 'arrive' && st.hame && d.p && d.v !== registry.fallback('arrive')`
   (`instantShow` ignores order):
   - `order`: unless `pfrom.order` starts with `'pin'` → `p.order = 'sung'`, `pfrom.order = 'rule:sung'`.
   - `dur`: unless pinned → `p.dur = S.coerce(spec, clamp(ctx.timing.lead, HAME_DUR_MIN, HAME_DUR_MAX))`,
     `pfrom.dur = 'rule:sung'`.
   - `d.p` and `d.pfrom` are copied before writing (decisions may be interned or shared with an aligned source), and
     `pfrom` is re-sorted (`sortedCopy`).
4. **`copyParams`** skips any name whose own **or source's** `pfrom` is a rule tag. Such a value is never copied and
   never dropped:

   ```js
   const isRuleTag = (x) => typeof x === 'string' && x.startsWith('rule:');
   …
   if (isRuleTag(from) || (ad.pfrom && isRuleTag(ad.pfrom[name]))) continue;
   if (from !== undefined && from !== 'rule') continue;
   ```

   So an aligned 歌ハメ repeat of a non-歌ハメ source keeps `order 'sung'` / `pfrom 'rule:sung'` (the rule runs after
   the copy). A non-歌ハメ repeat of a 歌ハメ source does not inherit `order 'sung'`. No existing document has a
   `'rule:*'` tag, so the change is inert there.
5. **Cast cache**: `castInputs` gains `hame: ctx.sung ? ctx.sung.idOf(cut) : ''`; `INPUT_FIELDS += 'hame'`.
6. Trace for explain: `trace.rule = 'sung.hame'` on the arrive decision, `'sung.arrange'` on a filtered arrange.

`sung.fill` (Phase D): `castSlots` sets `st.slots['sung.fill'] = { v: true, from, by }` when `ls.fill` came from a pin
that resolves true (no chooser stream, like `decideRepeat`). `SLOT_SPECS += 'sung.fill': { type: 'bool' }`.

### (g) Engine

**`engine/scene/stagger`** (new exports; the v2 functions are unchanged):

```js
// SUNG_AHEAD = 0: a 歌ハメ glyph lands on its sung time (P5 T4 exempts sung-order cuts from 出そろい; S3.11).
// sungTimeAt(sung, off) → the time of the unit that starts at or before `off` (binary search on sung.at); t[0] before it.
// sungTimes(env, target, unit) → Float64Array per glyph, cut-local seconds from t0, or null when env.cut.sung is absent.
//   glyph j: off = target.off[j]; off < 0 → 0; else t = sungTimeAt(sung, off)
//   Latin units spread their letters: letter i of k in a unit starting at t_u, next unit at t_v:
//     t = t_u + (i / k) × min(LETTER_SHARE × (t_v − t_u), LETTER_STEP × k)     (t_v = sung.end for the last unit)
//   unit !== 'glyph': every glyph of a word/line/run takes the minimum over the unit's glyphs
```

**`engine/scene/behave.motionTiming`**, the `'sung'` branch (behave.js:300), with a kind guard:

```js
if (order === 'sung') {
  const dur = …as today…, room = …as today…;
  const st = kind === 'arrive' && env.cut && env.cut.sung ? STG.sungTimes(env, target, unit) : null;
  if (st) {                       // PV22 歌ハメ: glyph j starts dur before its sung time and lands on it
    const delay = new Float64Array(st.length); let last = 0;
    for (let j = 0; j < st.length; j++) {
      delay[j] = Math.min(Math.max(0, st[j] - STG.SUNG_AHEAD - dur - times.a), room);
      if (delay[j] > last) last = delay[j];
    }
    return { rank: R.rank, delay, dur, total: last + dur };
  }
  …the v2 lines, unchanged…
}
```

`times.a` is cut-local (`a − t0`, i.e. `−lead`). With the rule's `dur = lead`, `delay_j = t_j`, so glyph j starts at
`t0 + t_j − lead` and lands at `t0 + t_j`. With a pinned longer `dur`, later glyphs still land on their syllable; only
glyphs with no room before `a` land late. A **depart** with order `'sung'` keeps the v2 spread (nobody sings an exit).
`fitTimes` uses the same function, so `times.rest` = the last character's landing, and the dwell starts after it.

**Karaoke fill** (Phase D): `behave.sungFill(target, st, sung, inks)`, built by `build.buildCutWith` right after the
dwell when `valueOf(slots, 'sung.fill') === true && cut.sung`:

```
per glyph j (made once at build): s_j = st[j] − FILL_EARLY (0.03); d_j = clamp(next unit time − st[j], 0.08, 0.3)
  glyphs with off < 0: always "sung"
  same_j = the glyph's ink token is 'accent' (builder.js:587: emph ? run.emphInk : run.ink; emphInk defaults to 'accent')
behaviour { phase: PH.STYLE, live: 'always', from, to, t0: times.a, t1: times.b, run: runSungFill, s, d, same }
runSungFill(P, t, b): for each glyph i: k = smooth((t − s_i) / d_i) clamped 0..1
  dim = same_i ? FILL_DIM_SAME (0.35) : FILL_DIM (0.55)
  P.alpha[i] *= dim + (1 − dim) × k
  if (!same_i) P.tint[i] = max(P.tint[i], FILL_TINT × k)          (FILL_TINT 0.9; tint draws pal.accent)
```

- No allocation per frame.
- Draw's tint colour stays `pal.accent` (draw.js:156, :306). A per-glyph tint colour would change the render contract
  for one optional feature, so accent-inked glyphs (typically emphasized words) use a deeper dim instead.
- The sprite budget's first rung masks `tint` (`budget.js:18`). On a heavy cut the fill therefore degrades to the
  dimming ramp, which still reads as karaoke. This is documented in SPEC.

**Other consumers**, each taking the new branch only when `env.cut.sung`:

- `shot.sungOf(env, target, j)`: `STG.sungTimes(env, target, 'word')[j]` (cached per target in the existing WeakMap,
  under a separate key).
- `shot.anchorTime`: `'mid'` → `sungEndOf(env) / 2`; `'end'` → `sungEndOf(env)`; `'emph'` without a run →
  `sungEndOf(env) / 2`.
- `shot.readingUnits` (shot.js:266): `times = groups.map((g) => st[g[0]])` for both branches (chunks of a long word
  take their first glyph's time).
- **`shot.spanOf` is unchanged**, so xshot's sung-span fence (xshot.js:328 `inSung`, `away`, `segmentRule`) still
  covers `t0 … t1` and EXTREME shots keep words framed until `t1`. `xshot.anchorTime` reaches sung times only through
  `SS.sungOf`; its `'accentEnd'` default stays `spanOf`.
- `parts/ornament/mark.js` underSweep (mark.js:310-312):

  ```js
  const em = env.cut && env.cut.emph;
  const at = K.sungAt(env, em && em.length ? em[0][0] : 0);
  const sung = at !== null ? at : sungShare(env) * Math.max(0, (env.cut ? env.cut.t1 - env.cut.t0 : 0));
  ```

  (`e` in that function is `hints.emph`, the emphasis **box**; the ranges are `env.cut.emph`.)
- `parts/kit`: `sungAt(env, off) { const s = env && env.cut && env.cut.sung; return s ? STG.sungTimeAt(s, off) : null; }`.
- `K.staggerOf` is unchanged.

**`repT`** (`plan.planCut`): when `c.sung` and `SU.isSungCut(c)`, `repT = SU.heroSung(c, arrive, depart, count)` =
`a + A + 0.1 × max(0, (b − L) − (a + A))`, where `A = min(b − a, max(p.dur, c.t0 + last(c.sung.t) − SUNG_AHEAD − a))`
and `L` comes from `MO.fitMotion` as `heroTime` computes it. It is clamped half-open like `heroTime`. Other cuts are
unchanged.

### (h) 1字ずつタップ (`core/tap`, pure; `ui/tap`, DOM)

```js
// unitStart(units: [{ at, text }], { end: boolean }) → UnitTapState
//   { units, cursor, times: (number|null)[], end: number|null, paused, done, atLoopEnd: false }
// unitReduce(s, ev) — ev.type ∈ UNIT_EVENTS = ['mark', 'end', 'back', 'pause', 'resume', 'restart', 'loopEnd']
//   mark:    not paused, cursor < n, t ≥ last mark + UNIT_GAP (0.04) → times[cursor] = t, cursor + 1
//   end:     ≥ 1 mark, t > last mark → end = t (done when cursor === n)
//   back:    forget the last mark (and the end), cursor − 1
//   restart: every mark forgotten, cursor 0, atLoopEnd false
//   loopEnd: paused = true, atLoopEnd = true (the take is kept)
//   pause / resume as tapReduce (resume clears atLoopEnd)
// unitResult(s) → null (fewer than 2 marks) | { start, times: [[off, dt]…] (dt = t − start), end: dt | null }
```

`ui/tap` gains a second mode, `startUnits(lineId, { step: 'mora' | 'phrase', rate })`:

- Units: `SU.unitsOf(text, lang)` (区切り 1字) or the starts of `BR.phrases(text, lang)` (言葉).
- The panel shows the line as chips with the next unit highlighted. Controls: 区切り [1字 | 言葉] and 速さ [ふつう |
  少しゆっくり | ゆっくり] (`app.player.rate` 1 / 0.75 / 0.5, restored on finish or cancel).
- Loop `[t0 − 1.5, t0 + sungEnd + 0.8]` (from `plan.sung`, else `t1`). **At the loop end the player pauses**
  (`loopEnd`) and the strip offers **[決定]** (finish, when ≥ 2 marks) and **[もう一度]** (`restart` + play from the
  loop start). A take is never thrown away automatically.
- Keys (mode `tap`, same bindings as line tapping): Space / Enter / the pad = mark; **E** = end of singing;
  Backspace = back; **Esc / T = finish** (records when ≥ 2 marks; with fewer, it ends without writing and says
  `tapu.tooFew`); P = pause. ←/→ (`tap.seek`) do nothing in unit mode (`seekBy` returns early when `mode === 'units'`),
  so the loop cannot be broken. **「やめる」** (a button in the strip) cancels without writing.
- Event time: `raw − tapLatency × player.rate` (latency is wall-clock; song time runs at `rate`).
- Finish → one `app.batch({ label: ['undo.tapUnits', { n }] }, …)` with `{ t: 'time.tap', marks: [{ lineId, start }] }`
  and `{ t: 'pin.set', path: 'line/<id>:sung.times', v: pairs (+ [text.length, end] when E was pressed), by: 'tap' }`.
  `time.tap` keeps P5's stale-end fix. Toast 「9か所の時間を記録しました」. In a work where the line's 歌ハメ does not
  resolve on, the toast action 「この行を歌ハメにする」 pins `line/<id>:sung.hame = true`.
- Entry points: 行 › 時間 [1字ずつタップ] (disabled without `app.songReady()`, title `sung.needSong`); palette
  `tap.units`; the timeline line context menu (P5 S2 adds the menu; P6 adds the item).

### (i) Reading the voice (Phase C; `audio/voice`, L1, deps `audio/phrases`)

- P5's `audio/phrases.phrases(channels, sampleRate, { step })` (P5 §2.4.1) produces the analysis. If P5 has not
  landed, Phase C creates that module exactly as P5 §2.4.1 specifies. P6 adds no FFT pass of its own.
- `voice.encode(an: PhraseAnalysis)` → `{ v: 1, hz: 25, act, peaks }` (S3.3). `voice.decode(v)` →
  `{ hz, act: Float32Array, pt: Float64Array, ps: Float32Array }`, memoized by object identity.
  `voice.peaksIn(dec, a, b)` and `voice.activityEnd(dec, a, b, C)` are also exported.
- `app.readVoice()` (ui/boot): uses P5's in-memory analysis for the song's `sha1` when `ui/draft` holds one, else
  runs `phrases` on `app.buffer` (sliced, progress, 中止). Then it dispatches `song.voice { sha1, voice }` (one undo
  step 「曲の声を読む」). Toasts: `sung.voiceDone`, `sung.voiceCancelled`, `sung.voiceFailed`, and `sung.voiceRefused`
  (the song changed meanwhile: `CommandError('stale')`).
- **Never at song load**, so loading speed is unchanged.
- The result is deterministic given the PCM. Browsers' decoders differ slightly; that is acceptable because the result
  is stored in the document (P5 S1 states the same rule).

### (j) Timeline ticks (Phase B, `ui/timeline`)

- Source: `app.plan.sung.get(line.id)`.
- **Drawing** (`drawLines`): for each visible line with a `LineSung`, when `(xOf(end) − xOf(t0)) / n ≥ 5` px or the
  line is selected, draw a 7 px tick at `xOf(t0 + t[u])` for `u ≥ 1`, at the bottom of the bar. Colours by `src`:
  pin `#f2efe8`, lrc and copy `COLORS.mark`, voice `rgba(124,196,255,0.8)`, est `rgba(242,239,232,0.35)`. A small end
  bracket marks the sung end. On the selected line with ≥ 12 px per unit, the unit's first character (9 px) is drawn
  above its tick.
- **Hit test** (`hitAt`, line row, selected line only): a tick within 4 px → `{ row: 'line', line, tick: u }`. Ticks
  take precedence over the body, not over the start/end edges.
- **Drag** (`dragTo`):
  - `x = snap(t)` among the vocal peaks within 7 px (when `song.voice` exists) and the playhead (Alt: no snap),
    clamped to `(t[u−1] + 0.02, t[u+1] − 0.02)` (the end for the last unit).
  - It writes `line/<id>:sung.times` = every unit's current `[at, dt]` with `u` replaced, plus the end pair when the
    current end came from a pin or a tag, by `'user'`.
  - **When `plan.lines[i].by.start === 'auto'`**, the same batch also pins `line/<id>:start` at the current `t0`
    (by `'user'`). The dragged time is absolute intent, and a floating start would otherwise carry the characters off
    the voice when lines above are edited.
  - One gesture = one undo step (`mergeKey 'tl:tick:<line>:<u>'`, label 「字の時間」).
- **Double-click** on a tick, or **Delete** on a focused tick, removes that unit's pair from the pin (it is
  interpolated again). An empty pin is cleared.
- **Keyboard** (the proxy listbox; handled **before** its `if (ev.ctrlKey || ev.metaKey || ev.altKey) return;`):
  - **Alt+← / Alt+→** focus the previous / next tick of the focused line (`focus.edge = 'tick'`, `focus.tick = u`),
    with `preventDefault` + `stopPropagation` (this also stops the browser's Alt+← history navigation while the
    timeline has focus).
  - `timeline.nudge` (Ctrl+←/→, Shift ×10) moves the focused tick by one frame (same start pin rule).
  - Delete as above.
  - ←/→ keep their meaning (the start / end edges).
  - `,` and `.` stay the global `sel.cut`.
  - The proxy label reads 「{ch}の時間 {time}」.

### (k) Optional AI 「AIで字の時間」 (Phase D, `ai/song`, `ai/changes`)

- `wordsRequest(doc, plan, lineIds, uiLang)`: up to 12 selected lines. Schema:
  `{ lines: [{ i, words: [{ text, start }] }], note }`. System text: find when each word of each line begins,
  mm:ss.ss, increasing.
- `wordsChanges(doc, plan, json, duration, opts)`, per line:
  - Match each word sequentially in the line text (NFKC, spaces ignored) from a cursor; skip a word not found.
  - `dt = start − line.t0`, dropped unless `0 ≤ dt ≤ t1 − t0 + 0.5` and increasing by ≥ 0.02.
  - With ≥ 2 pairs, emit the change:

    ```js
    { kind: 'time', lineId, field: 'sung.times', path: 'line/<id>:sung.times', from: current pin value or null,
      to: pairs, start: line.by.start === 'auto' ? q3(line.t0) : undefined,
      label: ['ai.ch.sungTimes', { n, count }] }
    ```
- `ai/changes.toCommands`, the `time` branch (changes.js:415-417), becomes:

  ```js
  for (const c of of('time')) {
    if (!lineKnown(plan, c.lineId)) continue;
    if (c.start !== undefined) cmds.push({ t: 'pin.set', path: 'line/' + c.lineId + ':start', v: c.start, by: 'ai' });
    cmds.push({ t: 'pin.set', path: c.path, v: c.to, by: 'ai' });
  }
  ```

  Existing `time` changes have no `start`, so they are unchanged. `shown` prints 「{count}か所の時間」 for this field.
  Gemini only (like タイミング合わせ); disabled without AI.

---

## S3.5 Changes by module and function

| Module | Layer | Phase | Change |
|---|---|---|---|
| `core/lyrics` | L0 | A | `parseRow`: `stripTags(rest)` (the v2 stripped string plus tag positions); `tokenize` records `tokAt[p]`; `build` records `outAt[token]` (also for tokens consumed by `pieceBreak`); `trimAndSnap(body, rawWords)`; `makeRow` adds `words` only when present; `makeLine` adds `words`/`wordsRef`; `FIELD_KEYS += 'words'`; `markedText` writes `<mm:ss.xx>` (`tagText`, centiseconds, ms when needed as `stampTag`) at offsets, after the marks and before the character, end tags before `!`/`|`; `roundTrip` drops `words` when `text` changes; `sameFields` compares `words`; `shiftWords`. |
| `core/commands` | L0 | A (C) | `checkSlotScope` refusals (S3.3); `LINE_ONLY += 'sung.times'`; `WORK_ONLY += 'sung.real'`; C: `songVoice` reducer (`song.voice`), `COMMANDS`, `types.js` typedef. |
| `core/reconcile` | L0 | A | `remapMap`: `:sung.times` → `remapSungTimes`. |
| `core/tap` | L0 | A | `UNIT_EVENTS`, `UNIT_GAP`, `unitStart`, `unitReduce`, `unitResult`. `EVENTS`, `tapReduce` unchanged. |
| `core/doc` | L0 | C | `ORDER.song += 'voice'`, `ORDER.voice`, `checkSong` voice; nothing in `SONG_DEFAULTS`. |
| `engine/text/vert` | L3 | A | export `MAX_TCY_DIGITS`. |
| `planner/sung` | L2 new | A (C) | `C`, `HAME_ARRIVE*`, `OPENERS`, `unitsOf`, `unitAt`, `acceptSungTimes`, `anchorsOf`, `fillLine`, `prepare`, `decideHame`, `sliceCut`, `heroSung`, `isSungCut`, `isRuleTag`, `gen`; C: `voiceEnd`, `snap`. Deps: `core/script`, `core/num`, `core/pins`, `core/timing`, `engine/text/vert`, `planner/params`, `planner/rules`, `planner/arc` (optional, P2), C: `audio/voice`. |
| `planner/plan` | L2 | A | stage 1b `ctx.sung = SU.prepare(ctx, timed)` (`sung: null` in the ctx literal); stage 4b `SU.decideHame(ctx, cuts, timed)` after features / P2's `ctx.pv`; `planCut` copies `c.sung`, `extra`, `encodingKey`, `repT`; `plan.sung` non-enumerable; `sung-words` and `hame-empty` warnings through `ctx.warn`. |
| `planner/segment` | L2 | A | `pieceTimes` (sung runs with bounds, `sungB`), `snapInner(…, skip)`, `cutsOfLine` (`sliceCut`). |
| `planner/cast` | L2 | A (D) | `stateOf` `st.hame`; `castSlots` passes the arrange/arrive options; `decidePart` accepts `{ only, except, rule }`, the empty-pool force, and runs `hameParams` **last**; `chooseAuto` `req.only` / `req.except`; `copyParams` rule-tag skip; `castInputs`/`INPUT_FIELDS += 'hame'`; D: `sung.fill` slot. |
| `planner/explain` | L2 | A | a param whose `from` is a rule tag → `{ code: 'rule', params: { rule: from.slice(5) } }`, checked **before** the existing `from === 'rule'` → speed case (explain.js:215); part traces with `rule` `sung.hame` / `sung.arrange` → `whyRule.*`. |
| `planner/fields` | L2 | A | `derived` when every source's `from` is `'rule'` **or a rule tag** (fields.js:466, via `SU.isRuleFrom`); `sung.hame` state from `plan.sung` (value, `pinned` / `auto`, `autoText ['sung.auto.' + hameWhy]`); `sung.times` category `'sungTimes'`; `lockPayload` untouched. |
| `planner/encode` | L2 | A | `cutPieces`, `encodeCutParts` print `sung` when present. |
| `engine/scene/stagger` | L3 | A | `SUNG_AHEAD`, `sungTimeAt`, `sungTimes`. |
| `engine/scene/behave` | L3 | A (D) | `motionTiming` arrive-only branch; D: `sungFill`, `runSungFill`, `FILL_*`. |
| `engine/scene/build` | L3 | A (D) | `makeTarget` `off`; D: the fill behaviour. |
| `engine/scene/shot` | L3 | A | `sungEndOf`; `sungOf`, `anchorTime` (`mid`/`end`/`emph` fallback), `readingUnits` branches; `spanOf` unchanged. |
| `parts/kit`, `parts/ornament/mark` | L3/L4 | A | `K.sungAt`; underSweep uses `env.cut.emph`. |
| `audio/voice` | L1 new | C | encode / decode / peaksIn / activityEnd (on P5's `audio/phrases`). |
| `ai/song`, `ai/changes` | L5 | D | words request; `time` changes with optional `start`; `shown` for `field: 'sung.times'`. |
| `ui/fields` | L7 | A (D) | `LINE_NAMES += 'sung.times'`; `sung.hame` → `['work', 'line']`; `sung.real` work; rows in `directionFields()` (after `fld.order`), `PAGES.work sec('look')`, `sec('timing')`; line page `sec('time')` custom `'sungTimes'`; **`noDice: true` on the 歌ハメ, 歌った字に色をのせる and 字の時間を歌に合わせる rows**; `basic: false` on the latter two. |
| `ui/inspector` | L7 | A | custom `'sungTimes'` (summary, buttons; C: the voice note only when `real || hame` for the line); choice with the 自動 label args for `sung.hame`. |
| `ui/tap` | L7 | A | unit mode (S3.4 h): loop-end pause, 決定/もう一度, やめる, seek disabled. |
| `ui/keys` | L7 | A | no new binding (unit mode reuses the `tap` context); `tap.seek` handler checks the mode. |
| `ui/timeline` | L7 | B | ticks, hit, drag (+ start pin), Alt+←/→ (S3.4 j). |
| `ui/step_song` | L7 | C | 「曲の声を読む」 in `renderSongBox` (when `SU.C.VOICE_UI`). |
| `ui/boot`, `ui/palette` | L7 | A (C) | action `tap.units`; C: `song.readVoice`, `app.readVoice()`. |
| `ui/lyric_editor` | L7 | A | word tags drawn muted like stamps; `WARN_CODES += 'sung-words', 'hame-empty'`. |
| `ui/menus` | L7 | A | `bakeTimes`: `L.shiftWords(parsed, stamps[0])` before `renderRow`. |
| `i18n/strings` | — | A–D | S3.6. |
| `build.py` | — | — | nothing (L2 → `engine/text/vert` is in `PLANNER_TEXT`; L2 → L1 `audio/` is allowed). |

Docs: a new `docs/DESIGN_2_2.md` §S3, written by the integrator from this file. Also:

- `DESIGN.md`: §3.11 (words), §4.9.1 (word tags are kept as data), §3.12 (cut `sung`), §4.17.4 (`'sung'` with
  sub-line timing, arrive only), §4.17.5 (target `off`), §4.18.3 (`K.sungAt`), §4.11 (unit tap), §4.13 (`song.voice`).
- `SPEC.md`: 歌ハメ, and the behaviour change of S3.2 10.
- `NOTES.md`: a P6 section.

---

## S3.6 Strings (`src/i18n/strings.js`, [ja, en])

| key | ja | en |
|---|---|---|
| `fld.hame` | 歌ハメ | Sung reveal |
| `fld.hame.note` | 歌に合わせて1字ずつ出します。字の時間は、タップ・歌詞の単語タグ・同じ歌詞の行の順に使い、なければ歌の長さから見積もります。 | Shows the words one character at a time with the singing. Character times come from your taps, word tags in the lyrics or the same lyric elsewhere, else they are estimated from the singing. |
| `fld.hame.on` | オン | On |
| `fld.hame.off` | オフ | Off |
| `fld.hame.all` | すべての行 | Every line |
| `fld.hame.none` | 使わない | Off |
| `sung.auto.times` | 自動（オン: 字の時間がある行） | Auto (on: this line has character times) |
| `sung.auto.hook` | 自動（オン: 歌い出し・サビの行） | Auto (on: an opening or chorus line) |
| `sung.auto.off` | 自動（オフ） | Auto (off) |
| `sung.auto.kime` | 自動（オフ: キメの行） | Auto (off: kime line) |
| `fld.hame.autoNote` | 自動: 字の時間がある行と、歌い出し・サビの行（3行に1行）で使います | Auto: used on lines with character times, and on the opening line and chorus lines (one in three) |
| `fld.hameFill` | 歌った字に色をのせる | Color the sung characters |
| `fld.hameFill.note` | 文字は先に出て、歌われた字からアクセント色に変わります（カラオケ風）。アクセント色の字は明るくなります | The words show first and each character takes the accent color as it is sung (karaoke style). Characters already in the accent color brighten instead |
| `fld.sungReal` | 字の時間を歌に合わせる | Time characters to the singing |
| `fld.sungReal.note` | 歌詞の単語タグと同じ歌詞の行から、1字ずつの時間と歌い終わりを決めます。オフにすると、タップした行だけが歌ハメになります。 | Uses word tags in the lyrics and the same lyric elsewhere for each character and for where the singing ends. Off: only tapped lines use sung reveal. |
| `fld.sungTimes` | 字の時間 | Character times |
| `sung.summary` | {n}か所 · {src} | {n} step · {src}\|{n} steps · {src} |
| `sung.src.pin` | タップ・手で合わせた時間 | Tapped or set by hand |
| `sung.src.ai` | AIの提案 | Suggested by AI |
| `sung.src.lrc` | 歌詞の単語タグ | Word tags in the lyrics |
| `sung.src.copy` | 同じ歌詞の行から | From the same lyric line |
| `sung.src.voice` | 曲の声から推定 | Estimated from the voice |
| `sung.src.est` | 歌の長さから推定 | Estimated from the singing |
| `sung.tapUnits` | 1字ずつタップ | Tap each character |
| `sung.clear` | 字の時間を消す | Clear character times |
| `sung.needSong` | 曲を読み込むと使えます | Load the song to use this |
| `sung.readVoice` (C) | 曲の声を読む | Read the voice |
| `sung.voiceHint` (C) | 曲の声を読むと、字の時間がもっと合います（② 曲） | Reading the song's voice makes the character times fit better (② Song) |
| `sung.voiceState` (C) | 曲の声: 読み済み | Voice: read |
| `sung.voiceReading` (C) | 曲の声を読んでいます… | Reading the voice… |
| `sung.voiceDone` (C) | 曲の声を読みました | The voice has been read |
| `sung.voiceCancelled` (C) | 曲の声を読むのをやめました | Stopped reading the voice |
| `sung.voiceFailed` (C) | 曲の声を読めませんでした | Could not read the voice |
| `sung.voiceRefused` (C) | 曲が変わったため、読んだ結果は使いませんでした | The song changed, so the result was not used |
| `tapu.title` | 1字ずつタップ | Tap each character |
| `tapu.hint` | 字が歌われる瞬間に、スペース・Enter・下のボタンを押す。歌い終わりで E、終えるときは Esc | Press Space, Enter or the button below as each character is sung; press E where the singing ends and Esc to finish |
| `tapu.step` | 区切り | Step |
| `tapu.step.mora` | 1字 | Character |
| `tapu.step.phrase` | 言葉 | Word |
| `tapu.rate` | 速さ | Speed |
| `tapu.rate.1` | ふつう | Normal |
| `tapu.rate.075` | 少しゆっくり | A little slower |
| `tapu.rate.05` | ゆっくり | Slow |
| `tapu.progress` | {i} / {n} | {i} / {n} |
| `tapu.loopEnd` | 最後まで来ました。決定するか、もう一度 | Reached the end. Finish, or try again |
| `tapu.retry` | もう一度 | Try again |
| `tapu.tooSoon` | 前の字に近すぎるため、記録しませんでした | Too close to the previous character, so it was not recorded |
| `tapu.tooFew` | 2か所以上タップすると記録できます | Tap at least two steps to record |
| `tapu.ok` | 決定 | Done |
| `tapu.cancel` | やめる | Cancel |
| `tapu.keyMark` | 次の字 | Next character |
| `tapu.keyEnd` | 歌い終わり | End of the singing |
| `tapu.keyBack` | 1字戻る | Back one character |
| `tapu.keyFinish` | 決定（Esc・T） | Finish (Esc, T) |
| `tapu.done` | {n}か所の時間を記録しました | Timed {n} step\|Timed {n} steps |
| `tapu.makeHame` | この行を歌ハメにする | Use sung reveal on this line |
| `undo.tapUnits` | 1字ずつタップ（{n}か所） | Tap each character ({n}) |
| `undo.tick` (B) | 字の時間 | Character time |
| `undo.sungClear` | 字の時間を消す | Clear character times |
| `undo.songVoice` (C) | 曲の声を読む | Read the voice |
| `whyRule.sung.hame` | 歌ハメなので、1字ずつ出る入りから選んだ | Sung reveal: chosen from the entrances that show one character at a time |
| `whyRule.sung` | 歌ハメなので、歌に合わせて出す | Sung reveal: each character comes in with the singing |
| `whyRule.sung.arrange` | 歌ハメなので、文字を自分で動かす構図は使わない | Sung reveal: layouts that move the text themselves are left out |
| `whyRule.sung.own` | この構図は文字を自分で動かすので、歌ハメは使えません | This layout moves the text itself, so sung reveal cannot be used |
| `warn.sung-words` | 歌詞の単語タグの一部が行の時間に合わないため、使いませんでした | Some word tags in the lyrics do not fit the line's time and were not used |
| `warn.hame-empty` | 1字ずつ出る入りがどれも使えないため、歌ハメにできませんでした | None of the entrances that show one character at a time can be used here, so sung reveal was not applied |
| `tl.tick` (B) | {ch}の時間 {time} | {ch} at {time} |
| `cmd.tap.units` | 1字ずつタップ | Tap each character |
| `cmd.song.readVoice` (C) | 曲の声を読む | Read the voice |
| `ai.song.words` (D) | AIで字の時間 | Character times by AI |
| `ai.ch.sungTimes` (D) | {n}行目: {count}か所の時間 | Line {n}: {count} character times |

`whyRule.sung` serves both `order` and `dur`: explain names the field, and the rule text names the reason. The English
texts contain no Japanese. The `i18n.test.js` `WHY_CODES` / runtime-key lists gain the new keys. Revision 1's
`tapu.again` and `tapu.doneHame` are dropped (the loop no longer restarts; the toast action carries the hint). The
`{n}か所` wording counts units, which are words for Latin text and may be several per kanji compound.

---

## S3.7 Tests

### New `tests/node/sung.test.js` (Phase A unless marked)

1. **Units**: the A.3 examples; ー, っ, ゃ, 漢字, emoji, Latin words with `'` and `-`; `2` and `25` one unit, `2025` four
   units; `「` joins the following unit, `」` and `！` the preceding one; `unitAt` on a space before a word → the next
   unit. Σ w = `S.morae` for ordinary lines. Mutations: let small kana start a unit; let `「` join backward; split
   `25` → each fails.
2. **Vertical digits**: a vertical cut of 「「25時」まで」 with 歌ハメ → the `2` and `5` glyphs (one tcy cell) share one
   sung time (`sungTimes` equal).
3. **`acceptSungTimes`**: accepts sorted pairs on grapheme starts and a final `[len, dt]`; refuses unsorted pairs, equal
   offsets, `dt` going back, an offset inside a surrogate pair, an end pair that is not last, and > 400 pairs.
4. **Fill**: anchors kept exactly; interpolation by weights (the A.3 table rows 2–4); `E` from the end pair, then the
   estimate; the line's own rate with ≥ 2 anchors (row 4); `E ≤ span` always; unit 0 at 0 without an anchor.
   Mutations: interpolate by units instead of weights; use `readRate` with 2 anchors → each fails.
5. **Word tags**: the lrc fixture with `work:sung.real = true` → its one tagged row gets `by: 'lrc'` on the tagged
   unit; the same document without the pin → `plan.sung === null`. A tag outside the line → `sung-words` with `n: 1`,
   and the other tags are used. A row sung twice (two stamps) → both occurrences get the same `dt`s.
6. **Copy, both directions**: the `repeat` fixture with `work:sung.real = true` and a `sung.times` pin **on the second
   occurrence only** of a repeated line → the first and third occurrences show `by: 'copy'` with the same `dt`s
   (scaled when shorter), and with `gen: 1` all occurrences have `hame === true`, `hameWhy 'times'`. Mutation:
   first-occurrence-only sourcing → fails.
7. **Pieces**:
   - a two-piece line (`/`) → each piece's `t0` = its first unit's sung time, when feasible; `cut.sung.t[0] = 0`;
   - a pinned `cut/<key>:t0` boundary **earlier than the sung time of an earlier unpinned boundary** → cuts strictly in
     time order and each ≥ `MIN_PIECE`;
   - an infeasible run → the v2 weights;
   - **the lrc fixture with `work:sung.real = true` has no more `piece-merged` warnings than without it**, and the same
     on corpus(3) × every fixture.

   Mutations: drop the upper bound `T[b] − g(b − k)` → an order failure; drop the lower bound → merges appear.
8. **Gates**:
   - `corpus()` plus `v21`/`media`/`repeat` (as stored) → `plan.sung === null`, no cut has `sung`, hashes equal the
     stored goldens (asserts the fast path; the golden tests also cover it).
   - Old work + `line/<id>:sung.times` → only that line gets `sung`.
   - Old work + `work:sung.hame = true` → every lyric line gets `sung` and 歌ハメ, and `sung.real` stays false.
   - **Old work + `work:sung.fill = true` only (D)** → cuts get `sung` and the `sung.fill` slot; cut boundaries and
     every part decision are equal to the unpinned plan's (v2 window and pieces for fill-only lines).
9. **New-work 自動** (`gen: 1` on basic and repeat, other packages pinned off):
   - 歌ハメ is on exactly for the first lyric line, chorus-run positions 0/3/6 and same-text lines (`hameWhy 'hook'`),
     and off elsewhere;
   - `work:sung.real = false` → no hook lines;
   - a キメ line (P3 pin) → off; with `work:sung.hame = true` still off; with `line/<id>:sung.hame = true` on (P3 test
     16).

   Mutation: decide hooks per line instead of per text → a repeated chorus head differs → fails.
10. **Cast**:
    - 歌ハメ cuts pick arrive ∈ `HAME_ARRIVE` (Latin: `HAME_ARRIVE_LATIN`), never an own-motion arrange;
      `p.order === 'sung'` and `p.dur === clamp(lead, …)` with `pfrom 'rule:sung'`;
    - a pinned `arrive.order = 'lead'` stays; a pinned `tickerMarquee` stays, and the why says `whyRule.sung.own`;
    - all eight members excluded by `doc.filters` → `typeOn` if allowed, else `instantShow`, plus a `hame-empty`
      warning;
    - non-歌ハメ cuts of the same plan are equal to the same document without the 歌ハメ pins except where
      `planner_stability`'s locality predicate allows (**the same predicate**: the line's own cuts,
      `i ≥ end && i − end < 6`, and the own-motion relay; imported from a shared helper
      `tests/helpers/locality.js` that `planner_stability.test.js` also switches to).

    Mutation: remove the `only` filter → fails.
11. **Aligned repeats** (`work:repeat.same = true` or `gen: 1`):
    - an aligned repeat that is 歌ハメ, whose source is not 歌ハメ, keeps `p.order === 'sung'` and
      `pfrom.order === 'rule:sung'`;
    - an aligned repeat that is not 歌ハメ, whose source is, keeps its own order (not `'sung'`).

    Mutations: run `hameParams` before `copyParams`; drop the source-rule-tag skip → each fails.
12. **Explain and fields**: `explain()` on a 歌ハメ cut → arrive why `whyRule.sung.hame`, order/dur why
    `whyRule.sung`; `pfrom 'rule'` (speed) still explains as speed. `fieldState` of 文字の出方 / 長さ on a 歌ハメ cut
    → `'derived'`. The 歌ハメ / 色 / 字の時間 rows have `noDice`.
13. **Engine**:
    - a 歌ハメ cut's arrive behaviour: `delay[j] = clamp(t_j − dur − times.a, 0, room)`, `t0 = times.a`,
      `times.rest = a + last + dur`;
    - with `dur = lead`, glyph j starts at `t0 + t_j − lead` and is fully in (alpha 1, no offset) at `t0 + t_j`;
    - with a pinned `dur = 0.5` and `lead = 0.2`, glyphs with `t_j ≥ 0.3` land at `t0 + t_j`;
    - a note run (`off −1`) arrives at `a`;
    - **a depart with pinned order `'sung'` and `cut.sung` present → the v2 delays**;
    - without `cut.sung` the delays equal the v2 formula bit for bit (compare with a copy of the v2 code).

    Mutations: measure from `t0` instead of `times.a`; drop the kind guard → each fails.
14. **Shot / underSweep**:
    - with `cut.sung`, `anchorTime('emph')` = the emphasized word's unit time; `'end'` = `sung.end`; `'mid'` =
      `sung.end / 2`;
    - xshot: an EXTREME cut with `cut.sung` keeps its words framed until `t1` (`inSung` window = `spanOf`);
    - underSweep with `cut.sung` **with and without emphasis** builds without throwing (strict), and its sweep starts at
      `max(rest, K.sungAt(emph start)) + delay`;
    - without `cut.sung` all values equal v2.

    Mutation: read `hints.emph` as ranges → throws.
15. **repT**: 歌ハメ cut → `repT ≥` the last glyph's landing (clamped); others unchanged.
16. **Fill (D)**:
    - with `sung.fill`, an unsung glyph's alpha = 0.55 × its entrance alpha and tint 0; after its time + d, alpha × 1
      and tint 0.9;
    - an accent-inked (emphasized) glyph: alpha 0.35 × … → 1, tint unchanged;
    - frames differ from the fill-off scene **from `times.a` on** (the dimming);
    - the colour converges (`tint = 0.9` for every non-accent glyph) after the last unit's time + d;
    - budget: with the tint masked, only alpha ramps.
17. **Determinism and cache**: two fresh plans are equal; cached and fresh plans are equal after toggling 歌ハメ,
    changing a `sung.times` pin, and editing the row text (reconcile); `plan.reuse.casts ≥ cuts − 6` after one
    `sung.times` change.
18. **Speed**:
    - re-plan of `project_long` with `gen: 1` (other packages off) after the three edit kinds of
      `planner_determinism`: best batch ≤ 1.25 × the same run with `work:sung.real = false` + 1 ms, and ≤ 10 ms;
    - **lyric typing in that work**: re-plan time within the same bound and visible-scene rebuilds ≤ the cuts of the
      edited line + 6;
    - (C) the same with a synthetic `song.voice` once `SNAP_GAIN > 0`.
19. **Voice (C)**: a synthetic `song.voice` (encode of a hand-made activity curve and peaks), with the constants
    switched on in the test only:
    - on an anchored line, units move onto peaks within `R_u`, never out of order and never past a fixed anchor; weak
      peaks (< 0.25) are ignored; the vocal end is found inside `[t0, spanEnd]`;
    - on an automatic line nothing moves;
    - with the shipped constants, `song.voice` changes no plan hash.

    Mutation: drop the `SNAP_GAP` constraint → an order failure.

### Additions to existing tests

- `lyrics.test.js`:
  - tags are parsed into `words` with exact offsets (A.2 cases); the text is unchanged (the existing 'enhanced word
    tags removed' test still passes);
  - the `renderRow ∘ parseRow` identity fuzz is extended with tags;
  - `roundTrip` keeps words on an emphasis edit and drops them on a text edit; the existing 'word tags are removed'
    roundTrip case stays `ok: false`;
  - rows without tags have no `words` key (the exact-key assertions stay);
  - **inspector path**: `renderRow(Object.assign({}, parseRow(tagged), { emph }))` keeps the tags.
- `ui_menus` (or `menus.test.js`): `bakeTimes` on a tagged, stamped row keeps the tags shifted with the new stamp.
- `tap.test.js`: `unitStart/unitReduce/unitResult` (gap, back, restart, end, pause, `loopEnd` keeps the take,
  immutability, partial result, fewer than 2 marks → null).
- `commands.test.js`: `cut/…:sung.hame`, `cut/…:sung.fill`, `work:sung.times`, `line/…:sung.real` and
  `cut/…:sung.real` are refused at `pin.set`; `line/…:sung.times`, `work:sung.hame` and `work:sung.real` are accepted;
  `pin.promote line/…:sung.times` → refused; (C) `song.voice` sha1 check and validation.
- `reconcile.test.js`: `remapSungTimes` on insert, delete (pair dropped), replace-all (pin dropped).
- `doc.test.js` (C): `checkSong` voice; `normalize` does not add `voice`; `serialize` order.
- `audio.test.js` (C): `voice.encode/decode` round trip of a `PhraseAnalysis`; the downsampling (max of 4) and LEB128
  deltas.
- `ai_song.test.js` (D): `wordsChanges` matches words, drops bad times, adds `lineId` and `start` for automatic lines;
  `toCommands` applies both pins.
- `ui_fields.test.js`: the new rows, scopes, `offClears`/`autoDefault`, `noDice`, `basic`, strings exist.
- `i18n.test.js`: new why/runtime keys.
- `contract.test.js`: **unchanged** (ORDERS, KINDS, POSE untouched). `frame.test.js`: the sung stagger test is
  extended with a `cut.sung` case.

### Browser (`tests/browser/ui_flows.py`)

- (A) Line page: 歌ハメ [オン] → the preview shows characters appearing one by one (frame diff at two times), one undo
  step. On `?fresh=1` (a new work) with the sample: the first line's 歌ハメ row reads 「自動（オン: 歌い出し・サビの
  行）」.
- (A) 1字ずつタップ with the test song: Space × n and E, then Esc → one undo step, the summary reads 「タップ・手で合わ
  せた時間」. 「やめる」 records nothing. At the loop end the player pauses and shows 決定 / もう一度. 少しゆっくり sets
  the player rate and restores it. ←/→ do not seek.
- (B) Timeline: drag a tick 0.2 s → the pin changes, and on an automatic line the start is pinned too, in one undo
  step. Double-click → back to the estimate. Alt+→ focuses the next tick (the page does not navigate back).
- (C) 曲の声を読む (with `VOICE_UI` forced on in the lab build) → `doc.song.voice` exists, one undo step; cancel → the
  toast `sung.voiceCancelled`.
- `i18n_pages.py`: new strings in both pages.

---

## S3.8 Goldens

- **`frame_hashes_v2.json` (FROZEN), `frame_hashes.json`, `plan_hashes.json`, `project_media.json`,
  `project_repeat.json`, `project_extreme.json`: unchanged.**
  - Their documents have no `look.gen`, no `sung.*` pin and no `song.voice`, so `SU.prepare` returns `null` (S3.2 5).
  - No cut has `sung`: encode prints nothing new, and the fingerprints get no extra term.
  - `pieceTimes` and the cast run their v2 code; `st.hame` is `null`.
  - `copyParams` meets no rule tag; `decideHame` returns at once.
  - The engine takes the v2 branch everywhere (`env.cut.sung` is undefined); no `sung.fill` decision exists.
  - The lrc fixture's word tag is parsed into `words` (a new key on that one row object only), which nothing reads
    without the gate. `plan.lines` prints a fixed field list (plan.js:601), so it gains nothing.
  - `registry.version` is unchanged (no new part). `vert.MAX_TCY_DIGITS` is only an export.
  - The behaviour change of S3.2 10 touches only command paths (inspector, bakeTimes) that no golden runs.
- **P2's `project_pv.json`**: P6's `OTHER_OFF` entry is `work:sung.real = false`. With it, and no `sung.*` pin in the
  fixture, the fast path returns null even at `gen: 1` (tier H needs `real`; tier E needs a pin).
- **New golden `tests/golden/project_sung.json`**, written by a new entry in `tests/update_golden.js` and checked by
  `sung.test.js`. It stores plan hashes and frame op hashes (fake measurer, like `frame_hashes.json`), 16:9 and 9:16,
  seeds 1–2, as separate keyed entries so a later phase adds entries without touching earlier ones:
  - **A1**: lrc fixture + `work:sung.real = true` (no `gen`): words, estimate, pieces, `cut.sung`, shot anchors.
  - **A2**: A1 + `work:sung.hame = true` + one `sung.times` pin.
  - **A3**: basic fixture (real sections) + `look.gen = 1` + the other packages' switches pinned off (P2's `OTHER_OFF`
    list minus P6's own entry): tier H (hook lines).
  - **A4**: repeat fixture + `look.gen = 1` + `OTHER_OFF` + a `sung.times` pin on a repeated line's second occurrence:
    tier E with backward copies, aligned repeats.
  - **C1** (Phase C): A3 + a synthetic `song.voice` from a fixed table. It stays identical to A3 while the constants are
    off; it is regenerated when the lab gate enables them.
  - **D1** (Phase D): A2 + `work:sung.fill = true`.

  A3/A4 use real sections, so `planner/arc` (P2) and the fallback `realSectionPart` give the same runs. The entries do
  not change when P2 lands.

---

## S3.9 Performance

- **Existing documents**: two `PA.pinned` checks more than revision 1 (four in total) and one rules lookup per plan; one
  `null` field per cut state; the `castInputs` `hame` field `''`; one extra string test per param in `copyParams`
  (`isRuleTag`, only for aligned cuts). `perf.py` rows (fixtures, all legacy) and the `planner_determinism` speed tests
  are unaffected. The new speed tests (S3.7 18) bound the gated path.
- **Planner, gated**: per line, units (memoized), anchors, group sources (one Map pass), fill, slice; per plan, one
  hook pass over the cuts. Line results are memoized across plans. Estimated < 0.5 ms per plan for 120 lines.
  `cut.sung` is cut-local, so a line that only moves in time keeps its encoding key and is re-timed by `retimeCut`:
  - estimate-based and explicit times are relative to `t0`;
  - (C) voice snapping and the voice end run **only on lines whose start is anchored**, so they never depend on a
    floating position.
- **Engine**: `sungTimes` is O(n log u) once per build. (D) The fill behaviour is O(n) per frame without allocation,
  with one extra tinted draw per sung glyph (the existing tint path, counted by the sprite budget).
- **Song load**: unchanged. P6 adds no analysis at load (revision 1's 12,000 FFT-2048 pass is dropped).
  「曲の声を読む」 (C) runs P5's `phrases` on demand: ≈ 0.25 s per song minute (P5 §2.9), sliced with progress and
  中止, or free when P5's 下書き already analysed the song in this session.
- **Document size** (C): `song.voice` ≈ 8 KB (`act`) + 2–5 KB (`peaks`) of base64 for a 4-minute song. `sung.times`
  pins take ≈ 20 bytes per unit.

---

## S3.10 Risks and open questions

- **R1 — estimate and voice accuracy.**
  - The estimate uses `readRate` (a reading default) until a line has 2 anchored units.
  - It is bounded by the span, so it never lags more than today's spread (probe `p6r/hooks.js`: on LRC-timed fixtures
    the hook lines' spans are 2.0–2.8× their estimate, so a plain spread would put the last characters 1–2 s late).
  - Its failure mode is finishing early on held or slow vocals: the last characters appear before they are sung.
  - **Lab gate** (not CI): a ground-truth set of hand-tapped per-unit times for ≥ 6 songs (ballad, fast, rap, English,
    mono, duet), recorded in NOTES. `EST_SLACK` is tuned there, target: median |sung-end error| ≤ 0.15 s.
  - `VOICE_END` and `SNAP_GAIN` stay off, and 「曲の声を読む」 stays hidden (`VOICE_UI`), until each beats the
    estimate with median |error| ≤ 0.12 s on that set.
  - Mid-minus-side analysis fails on mono or voice-panned mixes and centred lead instruments. Snapping moves a unit at
    most `R_u ≤ 0.15 s`, and only on anchored lines.
- **R2 — tapping speed.** Fast lines are hard to tap per mora. 区切り 言葉 and the slower speeds exist for that; a
  partial take is accepted, and the loop end pauses instead of discarding it.
- **R3 — PCM differs between browsers.** Only at analysis time; stored results make plans deterministic.
- **R4 — `sung.times` after text edits.** Pairs follow the text through the offset table. Deleted characters lose their
  pair and are interpolated; a replaced line loses the pin.
- **R5 — timeline density (B).** Ticks are drawn only with ≥ 5 px per unit (or on the selected line); dragging works
  only on the selected line, so body drags keep working.
- **R6 — 歌ハメ everywhere.** 作品全体 [すべての行] makes every line a character reveal; the kit (P2) and the restricted
  pool keep some variety, but the look is uniform by choice. The default 自動 touches only hook lines and lines with
  character times.
- **R7 — hook detection.** Without headings, song analysis or repeated blocks (a neutral song), only 歌い出し is a hook.
  With P2 turned off by the user, P6 still uses `planner/arc` (a pure module) for sections, so the hooks do not depend
  on P2's switch.
- **R8 — a drag pins the start.** Dragging a tick on an automatic line also fixes its start (S3.4 j). The timeline
  shows the start edge as pinned, and undo removes both.
- **Q1 — enhanced LRC export.** `export/subtitles` could write word tags from `plan.sung` for lines whose source is a
  pin or lrc (round trip to karaoke tools). Proposed as a follow-up behind an output option; not in this package.
- **Q2 — 出そろい for 歌ハメ.** P5 exempts sung-order cuts from 出そろい, so `SUNG_AHEAD = 0`. If the lead later wants
  歌ハメ characters readable `lead` s before they are sung under 出そろい: set `SUNG_AHEAD = lead` through a new cut
  field `sung.ahead` (planner-written, only under `enter: 'ready'`), and widen `a` by `dur` in P5's stage 5b for those
  cuts (`a = max(floor, t0 − lead − dur)`). Not in this package.
- **Q3 — the `'rule:<name>'` pfrom convention** is used only by P6 (P3 revision 2 writes plain `'rule'`).
  `SU.isRuleTag` / `isRuleFrom` are the one place it is read; any later package may use it.

---

## S3.11 Interactions with the other packages

- **P1 (typography)**: per-glyph scale and kana tracking change sizes and positions, never glyph order or offsets, so
  `target.off` stays valid. If P1's typesetting ever inserts spacing glyphs, they must carry `off −1` (they then count
  as sung at the cut start). P1 gates through the same marker; `OTHER_OFF` covers it in A3/A4.
- **P2 (conventions)**:
  - P6 uses P2's marker (`look.gen`), `planner/rules` (row `sung.real`), `autoDefault` toggles, the new-work function
    and `planner/arc` parts (hooks; `ctx.pv.partOf` when on, `ARC.parts` otherwise).
  - **Pool vs force**: P6 **restricts** the arrive pool to `HAME_ARRIVE` (`req.only`) and forces only `order` and
    `dur` by rule; it does not force a part. P2's kit factor weighs inside the list, as it does inside P3's キメ sets.
    P2 §1.11 "forces the entrance by rule" should read "restricts the entrance to HAME_ARRIVE; order/dur by rule".
  - **Directions**: none of the ten `HAME_ARRIVE*` parts is in P2's `DIR` table (P2 §2.4 a lists only `twirlArrive`
    and `skewSlide` among arrives), so M2's flip is a no-op on 歌ハメ entrances. P2's claim "no direction" holds.
  - **M1**: under 「くり返しの行をそろえる」 (on by default in new works), `copyParams` never copies or drops a rule tag,
    and `hameParams` runs last (S3.4 f 3–4). The 歌ハメ answer and the character times are decided per lyric text
    (S3.4 b, d2), so 「くり返す歌詞は同じ見せ方で戻ってくる」 holds for 歌ハメ.
  - **T5**: the 歌ハメ entrance is a motion and the fill is text styling; neither counts as an effect.
  - `OTHER_OFF` entry: `work:sung.real = false`.
- **P3 (キメ)**: キメ is a line pin read as `line.kime` (stage 1, before `SU.prepare`) and `KI.isKime(cut)`.
  - 歌ハメ on a キメ line comes **only from a line pin**: `hame = linePin ?? (kime ? false : workPin ?? auto)`. A work
    「すべての行」 does not reach キメ lines. P3 M3.4 l's "line or work" should read "line".
  - With a line pin, the arrive set is `KIME.arrive ∩ HAME_ARRIVE` (P3 intersects first). P3's `KI.params` runs before
    P6's `hameParams` and skips its `dur`/`each` caps when `st.hame`; every other キメ rule stays.
  - P3 writes plain `'rule'`, which `copyParams` treats as today.
  - P3 revision 2 does not touch `core/lyrics`, so there is no `FIELD_KEYS` conflict: P6's is
    `[…existing, 'words']`.
- **P4 (glyph motion)**:
  - M4 モーフ fights a character reveal. The hook name is **`ctx.sung.hameAt(cut)`**; P4's `utaAt(ctx, c)`
    (P4 design line 318) must read `!!(ctx.sung && ctx.sung.hameAt(c))`, not `ctx.uta.at(c)`. It is available from
    stage 4b, so it works in P4's stage-6 seam rules.
  - A pinned モーフ seam wins: the matched glyphs arrive with the seam, the rest by their sung times.
  - M5 `weightGrow` is `late` (pin-only) and not in `HAME_ARRIVE`; with a pinned order `'sung'` it grows each letter as
    it is sung through the same branch.
- **P5 (timing)**:
  - **T4**: new works get `timing.lead = 0.2` (P5 §0.1), so 歌ハメ characters start 0.2 s before each syllable and land
    on it (`dur = clamp(lead)`, `SUNG_AHEAD = 0`). Under 出そろい, P5's stage 5b skips cuts with
    `d.p.order === 'sung'`. P6 sets that order by rule on every 歌ハメ cut, so P5's predicate needs no change (it equals
    `SU.isSungCut`). Test S3.7 13 pins the rule down; Q2 records the 出そろい extension.
  - **S1 (曲から下書き)**: P6 Phase C reuses P5's `audio/phrases` and its in-memory cache; P6 only persists a compact
    encoding. S1's drafted starts are `tap` pins, i.e. anchored lines, which is where Phase C's voice applies.
  - **S2 (1行だけタップ)**: P6's unit tap is a separate mode of the same `ui/tap` panel. It writes the start through
    `time.tap`, so S2's stale-end fix applies. P6 adds 「1字ずつタップ」 to S2's line context menu and next to S2's
    「タップ」 button on 行 › 時間. Retapping only the start keeps `sung.times` relative (the characters move with it).
    The tap latency must be scaled by the player rate in both modes.
  - **S4 (読み切れない速さ)**: P5 treats a `'sung'` entrance as reading time (A counts 0). `plan.sung` can also give S4
    the real singing rate (`units / (end − t[0])`) for its note.
- **P6 ↔ AI**: the AI 演出 tools do not set `sung.*` (not in their whitelists). Only the optional 「AIで字の時間」 (D)
  writes `sung.times` (and an automatic start), by `'ai'`, through review.

---

## Appendix A. Measurements (read-only probes, `scratchpad/pv22/probe/p6/`, `p6r/`)

- **A.1 Sung window** (`p6/window.js`): `(t1 − t0) / max(1.2, morae / readRate)` per line. lrc fixture LRC lines:
  median **2.19** (p90 3.33); v21 LRC lines 1.65; automatic lines 1.00–1.05 (basic, long, repeat). No corpus cut has
  order `'sung'` (0 of 375).
- **A.2 Word-tag parse prototype** (`p6/lyrics6.js`, `lyr_probe.js`): `text/pieces/emph/impact/note/kind/stamps`
  identical to v2 on all 228 fixture rows and on 20,000 random rows with tags, escapes, `/`, `*`, `|` and `!`; the
  fixture's one tagged row gets `words [[5, 9.1]]`. The token → output map must also cover tokens consumed by
  `pieceBreak` (a tag right after `/ ` otherwise maps to 0: found and fixed in the prototype).
- **A.3 Units and fill prototype** (`p6/units.js`, `sung_proto.js`): the unit examples of S3.4 a and the table of
  S3.4 c.
- **A.4 Arrive catalog** (`p6/arrive.js`): every arrive part shares `order`; `instantShow` (fallback) ignores it;
  `typeOn` dur auto 0.06–0.1, `sliceReveal` 0.25–0.45, `inkRise` 0.45–0.8 (the rule overrides dur to `lead`).
  `arrange.js`: only `tickerMarquee` has `motion: 'own'`.
- **A.5 Hook lines** (`p6r/hooks.js`; counts only): 歌い出し + chorus heads per fixture: basic 2 (ratios 1.35, 1.29),
  long 1 (1.28), repeat 3 (1.28, 1.2, 1.2), vertical 1 (1.47), v21 2 (2.3, 2.31, both LRC), lrc 3 by repeated blocks
  (2.8, 2.2, 2.0, LRC). Automatic lines sit near 1.3×, so the estimate and the span nearly agree there. On LRC lines
  the span is 2–2.8× the estimate, which rules out the plain span spread (R1).
- **A.6 Merges** (critic probe `critic_p6/merge.js`, re-run): with an unbounded sung-window estimate, inner pieces
  shorter than 0.35 s go from 0 to 3 on lrc (0 → 0 on v21, basic, long, repeat). The bounded run fill of S3.4 e makes
  every piece of a feasible run ≥ 0.35 s by construction, and test 7 asserts no extra `piece-merged` warnings.
- **A.7 Digits and punctuation** (`p6r/morae.js`): `S.morae` of a digit is 1 per digit, of `「（“」！` 0, of `っ` 1
  (class smallKana), of `ゃ` 0. `vert.js:32` `MAX_TCY_DIGITS = 2` (not yet exported).

## Appendix B. FROZEN contracts touched

| Contract | Change | Compatibility |
|---|---|---|
| Row grammar §4.9.1 | Word tags are still removed from the text; their positions are now kept as `ParsedRow.words` | Text and marks identical (A.2) |
| ParsedRow / Line §3.11 | `words`, `wordsRef` only on rows with tags | Absent elsewhere; exact-key tests unchanged |
| Plan §3.12 cut | optional `sung` | Absent on every existing plan |
| Decision `pfrom` values | `'rule:<name>'` | New value only on gated cuts; explain, fields and `copyParams` read it |
| Scene target §4.17.5 | `off` | Additive |
| Kit §4.18.3 | `sungAt` | Additive |
| `engine/scene/shot` | `sungEndOf` | Additive; `spanOf` unchanged |
| `engine/text/vert` | export `MAX_TCY_DIGITS` | Additive |
| `doc.song` §3.1 (C) | optional `voice` | Absent unless written; `normalize` never adds it |
| Commands §3.9 | (C) `song.voice`; scope refusals for `sung.*` | Additive; refusals apply only to new slots |
| `ai/changes` `time` kind (D) | optional `start` | Absent on existing changes |
| `core/tap` | unit reducer | `EVENTS`, `tapReduce`, `tapCommand` unchanged |
| `ORDERS`, POSE, seam mix, SCH enums, slot order, draw tint colour | **none** | — |

## Size estimate

| Phase | Source | Tests |
|---|---|---|
| A | `planner/sung` ~400, `core/lyrics` +90, `core/tap` +90, `ui/tap` +200, `planner/cast` +90, `planner/segment` +50, `planner/plan` +40, engine (stagger, behave, build, shot, kit, mark) +120, fields/explain/commands/reconcile +80, `ui/fields` + `ui/inspector` +130, strings +55 entries → **~1,350 lines, 20 files** | `sung.test.js` ~650, additions ~250, `ui_flows.py` ~80 → ~980 |
| B | `ui/timeline` +170 → **1 file** | `ui_flows.py` ~50 |
| C | `audio/voice` ~120, snap/voiceEnd in `planner/sung` +90, `core/doc` + `core/commands` +40, `ui/step_song` + `ui/boot` +50, strings +8 → **~300 lines, 6 files** (+ ~300 for `audio/phrases` only if P5 has not landed) | ~220 + lab harness (not CI) |
| D | fill in `behave`/`build` +75, `ai/song` +120, `ai/changes` +15, fields +10 → **~220 lines, 5 files** | ~150 |

Total ≈ 2,040 lines of source in ~28 files and ≈ 1,400 lines of tests. Phase A alone is about two thirds.

---

## Critique log (revision 2)

| # | Sev. | Issue | Verdict | Resolution |
|---|---|---|---|---|
| 1 | major | 歌ハメ invisible in a new work until characters are tapped | **Valid** | 自動 gains tier **H**: hook lines (歌い出し + chorus-run positions 0, 3, 6) when `sung.real` is on, decided per lyric text, off on キメ; tier E kept (S3.2 3, S3.4 d2). Voice confidence (the critic's option) cannot be the Phase-A rule because voice is Phase C and gated; it can extend tier H later. Test 9, golden A3, browser `?fresh=1` check. |
| 2 | major | `copyParams` overwrites the 歌ハメ order/dur on aligned repeats | **Valid** (cast.js:674-728, :615-640) | `hameParams` is the last step of `decidePart` (after copyParams, P2 flips and P3 params). `copyParams` skips names whose own or source's `pfrom` is a rule tag, so a non-歌ハメ repeat does not inherit `'sung'` either (S3.4 f 3–4). Test 11 with mutations. |
| 3 | major | underSweep pseudo-code dereferences `hints.emph` (a box) as ranges | **Valid** (mark.js:301-312; build.js:255-263 fallback) | Uses `env.cut.emph` ranges (S3.4 g). Test 14 (strict build, with and without emphasis). |
| 4 | major | Sung-based piece boundaries can break time order | **Valid** (segment.js:197-227 has no upper clamp against a later pinned boundary) | Runs between pinned boundaries, bounds `T[k−1] + g … T[b] − g(b−k)`, feasibility fallback to v2 (S3.4 e). Test 7. |
| 5 | major | Sung-window estimate merges user `/` pieces (lrc 0 → 3) | **Valid** (probe re-run: lrc 0 → 3) | Every piece of a sung run is ≥ `MIN_PIECE` by construction, for typed and automatic pieces; infeasible runs keep v2 (S3.4 e). Test 7 asserts no extra `piece-merged` on lrc and the corpus. |
| 6 | major | 歌った字に色をのせる alone never takes effect | **Valid** | `PA.pinned(ix,'sung.fill')` joins the fast-path test; `fillOn` lines are kept with pin/estimate sources (S3.2 5, S3.4 d). Test 8. |
| 7 | major | Copy rule forward-only | **Valid** (plan.js `firstOf` is first-occurrence only) | Group source = best explicit occurrence (pin > lrc, ties earliest); all other occurrences copy it, earlier ones included; tiers decided per text (S3.4 b, d2). Test 6. |
| 8 | major | T4 coupling unsettled | **Valid then; settled now that P5's design exists** | P5 §0.1: `timing.lead = 0.2` in new works; §1.4: 5b skips `order 'sung'`. Rule: start at `t_j − dur`, land at `t_j` (`SUNG_AHEAD = 0`), `delay_j = clamp(t_j − ahead − dur − times.a, 0, room)`. P5's predicate needs no change. Q2 documents a 出そろい extension. Test 13. |
| 9 | major | Over-scoped | **Valid** | Four phases A–D, each golden-safe (Phases section, S3.8). Voice reuses P5's `audio/phrases` (no own FFT pass), runs on demand, and its planning effects ship off. |
| 10 | major | Tick drags / AI times relative to a floating start; AI change dropped (no `lineId`) | **Valid** (changes.js:415-417) | On automatic lines the drag batch and the AI change also pin `start` at the current `t0`; the AI change carries `lineId` and optional `start`, applied by the extended `time` branch (S3.4 j, k). Tests in ai_song and ui_flows. |
| 11 | minor | `spanOf` change leaks into xshot | **Valid** (xshot.js:67, :328-345) | `spanOf` unchanged; new `sungEndOf` used only by `anchorTime` mid/end/emph fallback; `sungOf` / `readingUnits` use sung times (S3.4 g). EXTREME test 14. |
| 12 | minor | P3 キメ interaction | **Partly valid** | (1) Adopted: `hame = linePin ?? (kime ? false : workPin ?? auto)`. (2) Order fixed: P3 params, then P6 last; P3 revision 2 already skips its caps when `st.hame`. (3) **Rejected as moot**: P3 revision 2 made キメ a line pin and does not touch `core/lyrics` (design-P3-kime.md:14, :801, log #7), so there is no leading-`!` rule or `FIELD_KEYS` conflict. |
| 13 | minor | P4 / P2 interface mismatches | **Valid** | Hook fixed as `ctx.sung.hameAt(cut)` and P4's `utaAt` rewrite stated. P2: P6 restricts the pool (kit weighs inside); none of the `HAME_ARRIVE*` parts is in P2's `DIR` table, so flips are no-ops (S3.11). |
| 14 | minor | Scope refusals not enforced by `LINE_ONLY` | **Valid** (commands.js:232-247) | `checkSlotScope` refusals for `sung.times`, `sung.real` (WORK_ONLY), `sung.hame`/`sung.fill` at cut (S3.3). commands tests. |
| 15 | minor | fields/inspector show `'rule:*'` as 自動; no `noDice` | **Valid** (fields.js:466, explain.js:215, ui/fields.js:292) | `isRuleFrom` in fields, explain (rule tag checked before speed) and copyParams; `noDice` on the three rows (S3.5). Test 12. |
| 16 | minor | motionTiming branch lacks a kind guard | **Valid** (behave.js:295-313 serves depart; build.js:226-232) | Branch only for `kind === 'arrive'` (S3.4 g). Test 13. |
| 17 | minor | Key conflicts and tap-mode behaviour | **Valid** (keys.js:22-23, :88-96; timeline.js:618-619) | Ticks: Alt+←/→ handled before the proxy's alt early return; `,`/`.` untouched. Tap: Esc/T finish, 「やめる」 cancels, seek disabled, loop end pauses with 決定 / もう一度 (S3.4 h, j). |
| 18 | minor | Test claims that would fail or churn | **Valid** (planner_stability.test.js:150-170) | Locality uses the shared stability predicate; fill test restated (differs from `times.a`, converges after last + d); golden documents use explicit pins or gen 1 + `OTHER_OFF` (S3.7, S3.8). |
| 19 | minor | Unannounced change: word tags kept on edits | **Valid** (inspector.js:467-469, menus.js:159-160) | Called out in §0, S3.2 10 and S3.8; lyrics and menus tests added. |
| 20 | minor | Estimate and voice accuracy unvalidated | **Partly valid** | Adopted: lab ground-truth gate; voice end, snapping and the voice UI ship off until median error ≤ 0.12 s; the line's own measured rate replaces `readRate` with ≥ 2 anchors. **Rejected**: "E = span until validated". Probe A.5 shows span/estimate of 2.0–2.8 on LRC-timed hook lines, so E = span is the known lag failure the feature exists to fix. `E = min(span, estimate)` never lags more than the span spread, and its failure mode is finishing early, the T4 direction (S3.4 c, R1). |
| 21 | minor | Empty HAME_ARRIVE falls back to the unfiltered pool | **Valid** (soft.js fogIn unit 'line') | Force `typeOn` when allowed and not filtered, else the kind's fallback, plus warning `hame-empty` and string `warn.hame-empty` (S3.4 f 2). Test 10. |
| 22 | minor | Units vs vertical digits and opening punctuation | **Valid** (vert.js:32, :92) | Digit runs ≤ `MAX_TCY_DIGITS` form one unit (exported from vert); openers join the following unit; `unitAt` containment rule (S3.4 a). Tests 1–2. |
| 23 | minor | Performance statements | **Valid** (analyze.js HZ 100, WIN 1024) | Revision 1's own voice pass dropped; P5's `phrases` runs on demand only (≈ 0.25 s per song minute); snapping and voice end only on anchored lines, keeping `cut.sung` cut-local; typing speed test added (S3.9, S3.7 18). |
| 24 | minor | Strings and UI placement | **Valid** | `{n}か所` / steps; `sung.voiceCancelled` / `Failed` / `Refused`; 曲の声を読む moved to ② 曲 (`renderSongBox`); the 行 note appears only when `real \|\| hame`; the fill and timing rows are `basic: false` (S3.1, S3.6). |
| 25 | minor | Karaoke fill invisible on accent ink; first rung of the budget | **Valid** (draw.js:156, :306; budget.js:18) | Accent-inked glyphs (token from builder.js:587) use a deeper dim ramp instead of tint. The critic's `shiftA` option was not taken because it changes draw's fixed-accent tint contract. Budget degradation to dimming is documented and tested (S3.4 g, test 16). |

Also corrected: `core/timing.readRateOf` is already exported (timing.js:206), so revision 1's "export it" change is
removed.
