# P1 文字組み (typesetting): design for T1, T2 and T3 (revision 2)

Repository: `/home/user/moji-pv` at `9a9e950`. Package P1 of the PV22 round. Items:

- **T1** かなの字間を詰めて塊で読ませる
- **T2** 助詞を小さく、頭の字を大きく
- **T3** 英字は少し大きく、日本語との間を少し空ける

All three are properties of how a text run is set. They share one data model, one gate, one engine entry point and
one new module. Section **S** covers the shared parts. Sections **T1**, **T2** and **T3** follow the requested
11-point structure and refer back to S where the answer is shared. Sections **F** (files), **Q** (strings and field
definitions), **X** (tests, goldens, performance and visual QA), **R** (risks), **P** (packages) and **Z** (critique
log) close the document.

Revision 2 answers the critic's review; section Z says how each issue was handled. The main changes:

- Gating now uses P2's document marker `look.gen`, so new works get **no** default pins.
- The tagger is now v6, with measurements on sets written after each freeze.
- Heads now include hiragana initials and skip opening brackets.
- Latin segments drop edge spaces, T3 is gated on the cut text, and emphasized Latin uses `max`.
- The trim table is now ink-safe, with a wide tier and chunk boundaries.
- UI rows are reworked, and withKumi is a contract (memoised) in one chain with P4.

**Prototype code and data.** These are read-only probes; nothing in the repository was edited. Paths are relative to
`$SCRATCH/pv22/probe/`.

- Revision 2, in `p1r2/`:
  - `tagger6.js`: the final particle tagger.
  - `kumi_proto2.js`: trims, boundaries, heads, Latin and memos.
  - `layout_kumi2.js`: a patched copy of `engine/text/layout.js`.
  - `heldout3.js`, `heldout4.js`: sets written after a freeze.
  - `eval5.js`, `eval_h3.js`, `eval_h4.js`, `critic30.js`: evaluation scripts.
  - `ex2.js`, `ex3.js`, `ex4.js`: the worked numbers quoted below.
  - `sweep.js`, `sweep_plain.js`: fit consistency.
  - `perf2.js`: timing.
  - `heads2.js`: the head lists.
- Round 1: `gold.js`, `heldout.js`, `heldout2.js`, `tagger4.js`.

Every evaluation line is original text written for this design, or the app's own sample sheet (`core/lyrics.SAMPLE_JA`).

---

## S. Shared foundation

### S.0 Decisions at a glance

| Decision | Choice |
|---|---|
| Where the settings live | Four **slots**, pinned at **work** or **line** scope (never at a cut): `text.kana`, `text.jump`, `text.head`, `text.latin`. P1 adds no document field of its own. |
| Values | `text.kana`, `text.jump` and `text.latin` are numbers 0–1 in steps of 0.05, where **0 = off**. `text.head` is `'line' \| 'phrase' \| 'none'`. |
| Gate | P2's document marker `doc.look.gen` (P2 §0.2). `D.newDoc()` writes `look.gen = D.GEN = 1` at the three new-work call sites. An unpinned switch takes the **document default**: in a gen ≥ 1 document `text.kana` 0.7, `text.jump` 0.5, `text.latin` 0.5; otherwise 0. `text.head` defaults to `'line'` in every document. **Nothing is written into `doc.pins`.** |
| Existing documents, fixtures, goldens | They have no `look.gen` and no kumi pin, so the default is 0. The planner makes no decision, no RunSpec carries `kumi`, and layouts and frames are byte-identical. |
| 固定を外す | The command is unchanged. Clearing kumi pins returns to the document default: on in new works, off in old ones. |
| Switch table | P1 adds four rows to P2's `planner/rules` table (`value`, `defaultValue`, `isRule`, `scopesOf`). At work scope the rows use P2's `'rule'` field category. |
| Planner | `decideKumi(st)` runs right after `decideText(st)`. Order: line pin, then work pin, then the default from `ctx.kumi`. A decision is made **only when the value is on** (> 0). Its `from` is `'pin:line'` or `'pin:work'`, or `'auto'` for the new-work default (trace rule `kumi.gen`). `planner/fields.lockPayload` skips the four slots. |
| Engine entry | `build.buildCutWith` derives the cut's text service once: `svc.text`, then P4's `.withFaces(…)` if `text.weight` is set, then `.withKumi(kumi)`. The same service goes to `createBuilder`, `baseEnv` (`env.text`) and `sceneOf`. `withKumi` is part of the TextService contract and is memoised per kumi value. |
| RunSpec | New optional field `kumi` (FROZEN RunSpec, additive). The service fills it in from the cut unless the spec sets `kumi` itself or sets `tracking` (a part that controls its own spacing). |
| New module | `engine/text/kumi` (L1, metric-free). It is used by `engine/text/layout` and `engine/text/service` only. It is **not** added to `build.py PLANNER_TEXT`. |
| AI | Not needed. The AI tools never read or write these slots. |
| UI | 作品全体 › **文字組み** (a new section right after 書体) has three switches. Under 詳しい設定 are the strength sliders, each shown while its switch is on, and 大きくする字, shown while 「助詞を小さく・頭の字を大きく」 is on. 行 › 色と書体 and 複数行 › 色と書体 get one row per switch under 詳しい設定: [自動 \| 使う \| 使わない]. |

### S.1 What the user gets (common)

- **作品全体 › 文字組み** is a new inspector section `kumi`, placed directly after `type` 書体 and closed by default like
  書体. Its three switches:
  - 「かなを詰める」: 「ひらがな・カタカナの字間を詰めて、言葉をひとかたまりで読ませます。新しい作品でははじめからオンです。」
  - 「助詞を小さく・頭の字を大きく」
  - 「英字を少し大きく・和文との間をあける」

  Under 詳しい設定:
  - 「詰める強さ」, 「ジャンプ率」 and 「英字の大きさとあき」 sliders (10–100 %). Each is shown only while its switch is on.
  - 「大きくする字」 [行の頭 | 言葉の頭 | 大きくしない]. It is shown only while 「助詞を小さく・頭の字を大きく」 is on.
    行の頭 is the automatic value.
- **行 › 色と書体** and **複数行 › 色と書体**, under 詳しい設定: 「この行のかな詰め」, 「この行の大小（助詞・頭の字）」 and
  「この行の英字」, each [自動 | 使う | 使わない]. 自動 follows 作品全体.
  - 使わない is the escape hatch for a line whose particles were mis-read, an all-English line, or a line that should
    stay plain.
  - 使う turns the feature on for one line in a work where it is off, for example an older work.
- A **new work** starts with the three switches on: かなを詰める at 70 %, the other two at 50 %. The switches show
  自動, because they follow the document default and nothing is pinned. A new work is made by the first run, ≡ ›
  新しい作品 and この端末に保存した作品と曲を消す.
- Works that already exist, and every file opened, start with the switches off until the user turns them on.
- 「固定を外す」 and ⋯ › 「すべて外す」 return every kumi setting to the document default, as 自動 does everywhere else.
- Undo: every switch, slider and choice is one `pin.set` or `pin.clear` through the inspector. That is one undo entry,
  labelled `undo.pin` with the field label, as for every inspector row.

### S.2 Gating and defaults

1. **Marker.** P1 uses P2 §0.2 exactly:
   - `doc.look.gen` is an optional integer. `D.GEN = 1`. `D.newDoc()` is `defaultDoc()` with `look.gen = GEN`.
   - `ORDER.look` gains `'gen'` at the end. `checkLook` accepts an absent `gen` or an integer 0–255.
   - `defaultDoc()`, `normalize()` and `migrate.parseFile()` never write it, so an opened file keeps what it has. No
     command writes it, so it needs no undo.
   - Whichever of P1, P2 and P4 lands first lands this `core/doc` change and the three call-site changes verbatim from
     P2 §0.2. The others skip them.
2. **Call sites.** These are the only places a new work is made; verified by grep of `defaultDoc(` in `src/ui`:
   - `src/ui/boot.js:107` `ST.createStore({ doc: D.newDoc(), … })`: the first-run document and every `?fresh=1` page.
     When an autosave exists, `app.store.load(file.doc, …)` replaces it, and a restored work keeps its own marker.
   - `src/ui/project_io.js:610` `newWork()` → `loadFile({ doc: D.newDoc(), … })`.
   - `src/ui/project_io.js:1176`, the device reset → `app.loadProject(D.newDoc(), …)`.

   Not changed:
   - `app.loadSample`: it types the sample rows into the current document, which keeps its marker.
   - Lyric import (`project_io.js:1045`).
   - File open, package import and autosave restore (`M.parseFile` → `normalize`, which adds nothing).
   - The lab page (`ui/lab.js`). Its contact sheets pass `look.gen` through its additive `o.look` (X.5).
   - Every `D.defaultDoc()` caller in `tests/node/*.js`, `tests/helpers/corpus.js`, `tests/update_golden.js` and
     `tests/www/*.js`. They keep planning documents without typesetting.
3. **Document defaults.** These are the P1 rows of `planner/rules`, contract in S.3:

   | Slot | `look.gen ≥ 1` | `look.gen` absent or 0 |
   |---|---|---|
   | `text.kana` | 0.7 | 0 (off) |
   | `text.jump` | 0.5 | 0 (off) |
   | `text.latin` | 0.5 | 0 (off) |
   | `text.head` | `'line'` | `'line'` |

4. **Resolution at a cut.** The value is the line pin (coerced by the slot spec), else the work pin, else the default.
   - Cut pins are never read. They are refused by `core/commands` (`NOT_CUT`). A stray one in a hand-edited file does
     not apply, as for `cam.extreme` (the pin lookup is made with `{ cutKey: null, pinCutKey: null, lineId }`).
   - Special cuts (no line) take the work pin or the default.
   - A bad value gives the existing `pin-bad-value` warning and resolves to nothing, so the default applies.
5. **Absent means off.** Without `look.gen` and without a pin, `ctx.kumi` holds only zeros. `decideKumi` then sets
   nothing, `cut.slots` has no typesetting entry, `kumiOf(slots)` is `null`, and the engine uses `svc.text` as it is.
6. **Older builds** open a new work normally. Unknown slot pins are never resolved, and `validate` allows the unknown
   look key `gen`. No `schema` bump and no `MigrateError('newer')`.
7. **固定を外す.** `pin.clearUnder` is unchanged: it removes the user's kumi pins, and the switches return to the
   document default. P1 needs no `SETTING_SLOTS` rule; round 1 had one and it is withdrawn.
8. **見た目の貼り付け** (`pin.copy`) leaves the typesetting alone. The slots are in `NOT_CUT`, and they are not in
   `TEXT_SLOTS` or `COPY_SLOTS`, the same as `cam.extreme`.
9. **What a fresh work shows.** `doc.pins` is empty, so:
   - step ③ 見た目 stays 'todo' until a look is chosen (`ui/steps.LOOK_PIN` is unchanged);
   - the 作品全体 header shows no 固定 count;
   - `ui_flows.py flow_library` ('importing places nothing', l.3607) holds.

   A user who turns a switch off in a new work writes `work:text.kana = 0`. That is a look choice, so step ③ reads
   'done', which is correct.

### S.3 Data model

| Slot | Spec (`planner/cast SLOT_SPECS`) | Scopes | Meaning |
|---|---|---|---|
| `text.kana` | `KUMI_SPEC = { type: 'num', min: 0, max: 1, step: 0.05 }` | work, line | T1 strength; 0 = off |
| `text.jump` | `KUMI_SPEC` | work, line | T2 strength (ジャンプ率); 0 = off |
| `text.latin` | `KUMI_SPEC` | work, line | T3 strength; 0 = off |
| `text.head` | `HEAD_SPEC = { type: 'enum', of: ['line', 'phrase', 'none'] }` | work, line | T2: which graphemes grow; read only while `text.jump` is on |

- **`planner/rules` rows.** P1 adds rows to P2's switch table and two row fields to P2's contract. Every row may
  carry `on` and `off` (defaults `true` and `false`) and `spec` (default `{ type: 'bool' }`). The functions:
  - `defaultValue(doc, ix, slot)`: for a row with a parent, as in P2; otherwise `gen ≥ 1 ? row.on : row.off`.
  - `value(doc, ix, slot)`: the work pin coerced by `row.spec` if there is one, else `defaultValue`.
  - `scopesOf(slot)`: `row.scopes`. P2's own rows are `['work']`; P4's `morph.auto` needs `['work', 'line']` too.
  - P2's `'rule'` fieldState shows `autoText` (`rule.auto.new` or `rule.auto.old`) only for rows with
    `on !== off`, so 大きくする字 says nothing about new and old works.

  ```js
  { slot: 'text.kana',  parent: null, scopes: ['work', 'line'], spec: KUMI_SPEC, on: 0.7,    off: 0 },
  { slot: 'text.jump',  parent: null, scopes: ['work', 'line'], spec: KUMI_SPEC, on: 0.5,    off: 0 },
  { slot: 'text.latin', parent: null, scopes: ['work', 'line'], spec: KUMI_SPEC, on: 0.5,    off: 0 },
  { slot: 'text.head',  parent: null, scopes: ['work', 'line'], spec: HEAD_SPEC, on: 'line', off: 'line' },
  ```
  If P1 lands before P2, P1 creates `planner/rules` with these four rows. It exports `ROWS`, `isRule`, `scopesOf`,
  `value`, `defaultValue` and `SPECS` with the semantics above, and P2 extends it with its rows and `resolve(ctx)`.
  P4 says the same for its two rows.
- **`core/commands`.** The four names join `NOT_CUT`, so a cut pin is refused with the existing message through
  `checkSlotScope` (`lock.set`, `pin.set`, `pin.promote`). `pin.promote` from line to work is allowed, as for
  `season` and `cam.extreme`. Nothing else changes; there is no `SETTING_SLOTS`.
- **`ui/fields.slotScopes`.** `RU.isRule(slot)` returns `RU.scopesOf(slot)`, which gives `['work', 'line']` for the
  four slots. This replaces P2's fixed `['work']`, which stays true for P2's rows.
- **Plan.** `cut.slots['text.kana'] = { v, from: 'pin:line' | 'pin:work' | 'auto', by? }`, and the same for
  `text.jump` and `text.latin`. It is written **only when v > 0**. `cut.slots['text.head']` is written only when a head
  pin resolves **and** `text.jump` was written. There is no `plan.v` change: the addition is additive, like
  `cam.extreme`.
  - `encode.js` fingerprints `cut.slots` as a whole, so `cut.fp`, the scene cache and the plan hash follow the
    settings automatically.
  - A setting that resolves to off leaves no trace in the plan. So a gen-1 document whose three switches are pinned
    to 0 plans exactly like the same document without the marker. X.1 tests this as gate completeness.
- **Migration:** none.

### S.4 Planner

**`planner/plan.js`**

- The `plan.run` ctx literal gains `kumi: null`. This keeps one shape, as the comment there asks.
- Stage 2, after `LK.resolveLook`:
  ```js
  ctx.kumi = Object.freeze({
    'text.kana': RU.defaultValue(doc, ctx.ix, 'text.kana'),
    'text.jump': RU.defaultValue(doc, ctx.ix, 'text.jump'),
    'text.latin': RU.defaultValue(doc, ctx.ix, 'text.latin'),
  });
  ```
  This is three numbers: 0.7, 0.5, 0.5 or 0, 0, 0. `planner/cast` reads them from ctx and does **not** import
  `planner/rules`, as P2 §0.3 asks.
- Stage 5: the cast-cache look key `EN.canon([...])` gains `ctx.kumi` as a last element. The cache must miss when a
  document of the other generation has the same text and seed. The key is internal cache text only; no golden reads
  it. P2 also appends its `ctx.rules.id`; both may stay.

**`planner/cast.js`**

```js
// 文字組み (P1): typesetting settings, pinned at work or line scope (core/commands NOT_CUT), defaulting to the
// document's generation (ctx.kumi, planner/rules). A cut gets a decision only where a setting is on; a setting that
// is off leaves no trace, so documents without the marker and without pins plan exactly as before. No randomness.
const KUMI_SLOTS = Object.freeze(['text.kana', 'text.jump', 'text.latin', 'text.head']);   // head last: it reads jump
const autoKumi = new Map();                        // interned { v, from: 'auto' } per value (planner/plan cache identity)
function kumiAuto(v) {
  let d = autoKumi.get(v);
  if (!d) { d = Object.freeze({ v, from: 'auto' }); autoKumi.set(v, d); }
  return d;
}

function decideKumi(st) {
  const { ctx, cut } = st;
  const at = { cutKey: null, pinCutKey: null, lineId: cut.line || null };      // a stray cut pin never applies
  for (const slot of KUMI_SLOTS) {
    const trace = tracing(st, slot);
    const head = slot === 'text.head';
    if (head && !st.slots['text.jump']) {
      if (trace) Object.assign(trace, { stage: 'auto', pin: null, decision: null, rule: slot, why: [] });
      continue;
    }
    const pin = PA.pinned(ctx.ix, slot) ? PA.resolvePin(ctx.ix, at, slot, PA.acceptSpec(SLOT_SPECS[slot]), ctx.warn) : null;
    let d = null;
    if (pin) d = head || pin.v > 0 ? pinDecision(pin) : null;
    else if (!head && ctx.kumi[slot] > 0) d = kumiAuto(ctx.kumi[slot]);
    if (d) setDecision(st, slot, d);
    if (trace) {
      const rule = pin ? slot : head ? slot : ctx.kumi[slot] > 0 ? 'kumi.gen' : 'kumi.off';
      Object.assign(trace, { stage: pin ? 'pin' : 'auto', pin, decision: d, rule,
        why: pin ? null : head ? [] : [{ code: 'rule', params: { rule } }] });
    }
  }
}
```

- `SLOT_SPECS` gains the four entries of S.3. `KUMI_SLOTS` is exported.
- `decideKumi` is called in `castSlots` right after `decideText(st)`.
  - Slot seeds are per slot name (`CH.slotSeedAt`) and `decideKumi` draws no seed, so no other slot's stream moves.
  - `historyRow`'s `isChoice` ignores dotted value slots, so history rows (and with them recency, echo and twins) are
    unchanged.
  - `castInputs` already includes the work and line pin strings, so the cast cache misses exactly when a kumi pin
    changes. The look key covers the defaults.
  - `recastCamera` copies these slots with the other non-camera slots (verified at `cast.js:946–957`).
- The slots are not aligned by 「くり返しの行をそろえる」 and are not in `ALIGN_VALUES`. They are settings, and a repeat
  line reads its own line pins.

**`planner/fields.js`**

- `lockPayload`: the first statement inside `for (const slot of Object.keys(cut.slots))` is
  `if (CA.KUMI_SLOTS.includes(slot)) continue;`. Without it, the `from: 'auto'` default of a new work (`isAuto`) would
  become `cut/…:text.kana` lock pins, which `lock.set` refuses in `checkSlotScope`. 🔒 would then throw on every line
  of a new work. Pinned kumi values are line or work pins, which a lock never copies anyway.
- `categoryOf`: at work scope the four slots are P2's `'rule'` category (`RU.isRule`). Its `fieldState` gives:
  - `value = RU.value(doc, ix, slot)`: the work pin or the default. It is never the first cut's value, so a line set
    to 使わない does not flip the work switch.
  - state `pinned` when a work pin exists, else `auto`;
  - `canPinAt ['work']`; schema `RU.SPECS[slot]`.

  At line scope they stay `'value'`.
- `decisionAt`: before the generic slot read,
  `if (!part && CA.KUMI_SLOTS.includes(parsed.slot)) return kumiAt(cut, parsed.slot, ix);`. `kumiAt` returns:
  1. the cut's decision;
  2. else, when `ix` is given, the pin that applies at the cut's line (lookup with
     `{ cutKey: null, pinCutKey: null, lineId: cut.line }`), coerced, as `{ v, from: hit.from, by: hit.by }`. This is
     the case of a pin 0, which leaves no decision;
  3. else the frozen `{ v: 'line', from: 'auto' }` for `text.head` and `{ v: 0, from: 'auto' }` for the others.
- `sourceAt`: the no-cut pin pattern used for `XT.SLOT` also applies to the four slots:
  `slot === XT.SLOT || CA.KUMI_SLOTS.includes(slot)`.
- `fields.js` re-exports `KUMI_SLOTS`; it already depends on `planner/cast`.

**`planner/explain.js`**

- `explainTraced`:
  `const ix = parsed.slot === 'cam.extreme' || F.KUMI_SLOTS.includes(parsed.slot) ? PINS.index(doc.pins) : undefined;`.
- The unpinned reasons are rule codes: `whyRule.kumi.gen` 「新しい作品なので、はじめからオン」 and `whyRule.kumi.off`.
  Pinned values use the existing pin reasons. Work-scope rows go through P2's `rulesWhy`.
- If P1 lands before P2, P1 adds the minimal work-scope explanation: pinned gives `pinWhy`, otherwise
  `[{ code: 'rule', params: { rule: default > 0 ? 'kumi.gen' : 'kumi.off' } }]`, and nothing for `text.head`.

### S.5 Engine plumbing

**`engine/scene/build.js`**

```js
// 文字組み (P1): the cut's typesetting from its slots, or null (no setting on: svc.text as it is).
function kumiOf(slots) {
  const kana = valueOf(slots, 'text.kana', 0), jump = valueOf(slots, 'text.jump', 0), latin = valueOf(slots, 'text.latin', 0);
  if (!(kana > 0 || jump > 0 || latin > 0)) return null;
  return { kana, jump, latin, head: valueOf(slots, 'text.head', 'line') };
}
// buildCutWith, first lines: ONE chain for the cut's text service (P4 M5.4.7 text.weight, then P1)
let text = svc.text;
const tw = valueOf(slots, 'text.weight', null);                                        // P4
if (tw !== null) text = text.withFaces(FACES.reweigh(svc.faces || plan.look.faces, valueOf(slots, 'text.face', 'display'), tw));
const kumi = kumiOf(slots);                                                            // P1
if (kumi) text = text.withKumi(kumi);
const csvc = text === svc.text ? svc : Object.assign({}, svc, { text }, tw !== null ? { faces: text.faces } : {});
// B.createBuilder({ D, text, cutText: cut.text, … }); baseEnv(plan, csvc, …); sceneOf(…, { svc: csvc, … })
```

- Only `csvc` is passed on. Two separate derivations from `svc.text` are not allowed, because one would drop the
  other.
- `buildGround` is unchanged; it has no text.
- `sceneOf` reads `svc.text.key` (the measurer key), which is identical for derived services.
- `fallbackSlots` keeps the kumi decisions; it replaces only part slots.
- `withKumi` is called **without a guard**: it is part of the TextService contract. A test double without it fails
  loudly in the kumi tests instead of silently rendering plain text.

**`engine/text/service.js`** (TextService, additive):

- `LAYOUT_FIELDS` gains `'kumi'` at the end. `specKey` skips undefined fields, so every existing key is unchanged.
- `createTextService({ measurer, faces, cache, kumi })` sets up:
  - `const cutKumi = KU.normalize(kumi);`
  - `const specOf = (spec) => KU.withCut(spec, cutKumi);`

  `layout(spec, text)` and `layoutAll(items)` lay out and key **`specOf(spec)`**, the merged spec.
- `withFaces(next)` passes `kumi: cutKumi` on.
- `withKumi(k)`, memoised per service:
  ```js
  const derived = new Map();                 // this service's derived services by kumi key (≤ 16, cleared when full)
  function withKumi(k) {
    const nk = KU.normalize(k), key = KU.key(nk);
    if (key === KU.key(cutKumi)) return api;
    let s = derived.get(key);
    if (!s) {
      if (derived.size >= 16) derived.clear();
      s = createTextService({ measurer, faces, cache: lru, kumi: nk });
      derived.set(key, s);
    }
    return s;
  }
  ```
  - `KU.key(null) === ''` and `KU.key(k) = 'k' + kana + '|j' + jump + '|h' + head + '|l' + latin`.
  - Derived services share the layout LRU; the keys hold the merged spec.
  - The getter `kumi` returns `cutKumi`, or null when off.
  - P4 may memoise `withFaces` in the same `derived` map under `'f|' + facesKey`, which is recommended.
- **Merge rule** `KU.withCut(spec, cut)`:
  - `cut` null → `spec` unchanged.
  - `spec.kumi === null` → unchanged: the part asked for plain text.
  - `spec.kumi === undefined`:
    - if `spec.tracking !== undefined` → unchanged. These are parts that set their own spacing: haloRing and
      gridMosaic lines, the sidebarIndex number, the titlePlate name, the breathMark label, the creditFold artist, and
      ornament and mark glyphs.
    - else `{ ...spec, kumi: cut }`.
  - `spec.kumi` an object → `{ ...spec, kumi: { ...cut, ...spec.kumi } }`, a part's partial override such as
    `{ jump: 0 }`.

**RunSpec** (DESIGN §4.15.4, FROZEN, additive): optional `kumi: { kana, jump, head, latin } | null`. When it is
absent, null, or all three strengths are 0, the layout is exactly today's.

**RunLayout** (additive, docs/NOTES WP2 list): `kumi: Uint8Array | null`, one role per grapheme: 0 plain, 1 particle,
2 head, 3 scaled Latin. It is null when the run has no kumi.

**Part opt-outs.** These keep the three features from fighting a composition that sets its own sizes or pitch. A
part writes the field **only when `env.text.kumi` is non-null**, so RunSpecs of documents without typesetting stay
identical objects. New kit helper: `K.kumiFor(env, over)` → `env.text && env.text.kumi ? { kumi: over } : {}`.

| Part (file) | Runs | Override | Why |
|---|---|---|---|
| giantWhisper (`arrange/core.js` l.197, 246, 251, 322) | giant, whisper, both pre-measures | `{ jump: 0 }` | already a size-contrast composition (T5); the pre-measure must equal the commit |
| confettiWords (`arrange/scatter.js` l.206) | per-word runs | `{ jump: 0 }` | random per-word sizes already |
| magazineHead (`arrange/editorial.js` l.224, 243) | head, sub | `{ jump: 0 }` | head/sub size split already |
| gridMosaic cell runs (`arrange/scatter.js` l.681) | one cell per unit | `null` | grid pitch; `gridLines` (l.702) sets tracking, so it is out already |
| haloRing (l.555) | ring slots | none needed | sets `tracking` on every run, so it is out |

Every other arrange takes the cut's typesetting as it is: centerAnchor, echoStack, edgeBleed, cornerNote,
pillarColumns, spineColumn, stairStep, sidebarIndex main, diptychSplit, slantBand, tiltedCard, tickerMarquee,
hangingTags, and the titlePlate and creditFold main text.

Arrange sizing (`bestFit`, `cellsOf`, `S.cells`) is **not** made kumi-aware. T1 makes text a little narrower than
planned (that is the point: the words read as one block), T2 and T3 may make it a little wider, and `fit: 'shrink'`
absorbs the difference.

### S.6 New module `engine/text/kumi` (L1, metric-free)

`MV.def('engine/text/kumi', ['core/script', 'engine/text/breaker'], (S, B) => { … })`, about 380 lines. Exports:

```
normalize(k) → { kana, jump, head, latin } | null        // clamp; null when all three strengths are 0; bad head → 'line'
key(k) → string                                         // '' for null (S.5)
withCut(spec, cut) → spec                               // S.5 merge rule
particleMarks(u) → Uint8Array                           // T2.4 tagger v6, on a breaker analyze() view
partsOf(text, lang) → { u, part }                       // memo (Map, 512 entries, cleared when full); part all 0 unless 'ja'
particles(text, lang) → [[a, b]]                        // UTF-16 ranges from partsOf; [] unless lang 'ja'
marks(text, lang, head) → { u, part, heads }            // memo (512, cleared when full); heads by T2.4
hasCjk(text) → boolean                                  // memo (512, cleared when full); T3.2 gate
tier(u, i) → 'wide' | 'kana' | 'narrow' | 'small' | 'bar' | null                       // T1.4
apply(kumi, o) → { cap, gap, role }                     // mutates o.k (prepare-local); T1–T3.4
TRIM, WIDE_KANA, NARROW_KANA, FLAVOR_DAMP, BOUNDARY, JUMP, OPENERS, MIN_HEAD_CONTENT, LATIN_GROW, LATIN_GAP, ROLE,
P1, P2, STACK, VETO_NEXT, VETO_NEXT2, VETO_PAIR, VETO_TRIPLE, KANA_WORDS, LEAD_WORDS, OKURI_*, CLOSERS  (frozen tables)
```

`engine/text/layout.js` and `engine/text/service.js` depend on it; both are in the same L1 group. `build.py
PLANNER_TEXT` is **unchanged**, because no package calls the tagger from the planner: P6 §interactions says it does
not need it, and P3 writes none. A later planner user must change these together:
- `PLANNER_TEXT`;
- the message in `dependency_allowed` (`build.py:310`);
- `tests/build_test.py:269–271`;
- DESIGN §2.3.

The memos are pure caches keyed by their full inputs, so results never depend on what was cached before
(determinism).

**Changes in `layout.js`**, exactly what `probe/p1r2/layout_kumi2.js` does:

1. `normalizeSpec`: `kumi: KU.normalize(spec.kumi)`.
2. `prepare`, after `k = emphScales(…)`, `vert`, `glue` and `nat`:
   ```js
   const ku = spec.kumi ? KU.apply(spec.kumi, { u, lang, font, vert, mark, k, text, str, base,
     own: spec.text !== undefined && spec.text !== null, emphScale: spec.emphScale, face: refs[0], latin: refs[1] }) : null;
   for (let i = 0; i < n; i++) {
     cellStart[i] = glue[i] ? 0 : 1;
     let a = alongAdvance(u, vert, nat, i);
     if (ku && ku.cap[i] < a) a = ku.cap[i];                              // T1
     along[i] = a * (glue[i] ? 0 : groupScale(vert, k, i));              // k carries the T2 and T3 factors
   }
   prep.gap = ku ? ku.gap : null; prep.kumi = ku ? ku.role : null;
   width: trackedWidth(u, along, cellStart, spec.tracking, prep.gap)
   ```
3. `trackedWidth(u, along, cellStart, tracking, gap)`:
   - `pre[i+1] = pre[i] + (gap ? gap[i] : 0) + along[i] + (cellStart[i] ? tracking : 0)`;
   - width = `pre[t1] − pre[t0] − tracking − (gap ? gap[t0] : 0)`, because a line never starts with a gap.
4. `place`: inside the glyph loop, `if (inside && i > t[0] && prep.gap) pen += prep.gap[i] * s;` before `adv`.
5. `build`: RunLayout gains `kumi: prep.kumi` (additive).

`greedy`, `balance` and `fitsAt` read `prep.width`, and `place` walks the same arrays, so breaking, fitting and placing
agree by construction. `baselineShifts`, `lineReach`, `groupScale`, `placeVertical` and `placeTcy` already handle
per-glyph factors below and above 1; they were built for emphasis.

### S.7 Contracts touched

| Contract | Change | Why |
|---|---|---|
| RunSpec (DESIGN §4.15.4, FROZEN) | optional `kumi` field; absent = today | the only way a run can carry typesetting; additive like WP2's fields |
| RunLayout | optional `kumi` role array | tests and readers (P3, P4); additive |
| TextService | `withKumi(k)` (memoised), getter `kumi`; `LAYOUT_FIELDS` + `'kumi'` | cut-scoped typesetting shared by the builder and `env.text` |
| `core/doc` | `look.gen`, `GEN`, `newDoc()` (**P2's** contract, §0.2) | the shared new-work gate |
| `planner/rules` (P2) | rows may carry `on`, `off`, `spec`; `scopesOf(slot)`; autoText only for `on !== off` | numeric and enum switches with a document default |
| `core/commands` | `NOT_CUT` gains the 4 slots | settings of a line or the whole video |
| FieldSpec (`ui/fields`) | `offValue` (toggle); `inheritAuto` (choice); P2's `autoDefault` | S.1 rows, Q.2 |
| `ctx` (planner) | `kumi` | defaults without importing `planner/rules` in cast |
| Measurer (§4.15.1) | **unchanged** | trims are tables, not ink measurements |
| `engine/scene/table.js` POSE, seam mix, SCH enums, vert TABLE, breaker NO_START/NO_END/phraseUnits, `build.py PLANNER_TEXT` | **unchanged** | none |

---

## T1: かなの字間を詰めて塊で読ませる

### T1.1 What the user gets

- 作品全体 › 文字組み › 「かなを詰める」, on in new works. Under 詳しい設定, 「詰める強さ」 (10–100 %, default 70 %),
  shown while the switch is on.
- 行 › 色と書体 › 詳しい設定 › 「この行のかな詰め」 [自動 | 使う | 使わない].
- Effect: every full-width hiragana, katakana, small kana and ー advances less than 1 em, horizontally and vertically.
  Kanji, Latin and punctuation keep their advance.
  - At the default: ordinary kana advance 0.902 em, wide kana (あ ね わ の …, and every voiced kana) 0.93, narrow kana
    (く し り ト リ …) 0.79, small kana 0.762, ー 0.944.
  - Between two words (after a particle, or at a phrase start), the two kana at the seam keep half the trim, so the
    seam is a little wider than inside a word. 「きみのこえが」 reads as きみの · こえが.
  - The glyphs stay the same size; only the gaps close.

### T1.2 Gating and defaults

See S.2. New works: default 0.7 with nothing pinned. Existing works and fixtures: 0, off.

| Control | New work (gen ≥ 1) | Existing work |
|---|---|---|
| Switch on | commits 0.7 = the default → unpins | writes `work:text.kana = 0.7` |
| Switch off | writes `work:text.kana = 0` | commits 0 = the default → unpins |
| Slider | writes 0.10–1.00; 70 % unpins | writes 0.10–1.00 |

Line rows: 使う writes `line/<id>:text.kana = 0.7`, 使わない writes `line/<id>:text.kana = 0`, and 自動 clears the pin.

### T1.3 Data model

Slot `text.kana` (S.3). RunSpec `kumi.kana`. No other field.

### T1.4 Algorithm

Per grapheme `i` of a run with `kumi.kana = s > 0`:

```
tier(i):  gs[i] === 'ー'                                                → 'bar'
          cls smallKana and u.cells[i] === 1                            → 'small'     (u.cells from breaker.analyze)
          cls hira|kata, u.cells[i] === 1, g ∈ NARROW_KANA              → 'narrow'
          cls hira|kata, u.cells[i] === 1, g ∈ WIDE_KANA or voiced(g)   → 'wide'      (voiced(g) = g.normalize('NFD').length > 1)
          cls hira|kata, u.cells[i] === 1                               → 'kana'
          otherwise (han, Latin, digits, punctuation, halfwidth kana, ・ 々 …) → none
TRIM        = { wide: 0.10, kana: 0.14, narrow: 0.30, small: 0.34, bar: 0.08 }   (em at strength 1 = the ink-safe maximum)
WIDE_KANA   = 'あおすせなぬねのはひふへほまみむめやゆわゐゑを'
NARROW_KANA = 'くぐしじりノトドリ'                                                 (narrow wins over voiced: ぐ じ ド)
FLAVOR_DAMP = { heavy: 0.6, brush: 0.8 }  (refs[0].flavor; others 1)  × (refs[0].weight ≥ 800 ? 0.8 : 1)
BOUNDARY    = 0.5
s_eff       = s × FLAVOR_DAMP × weight damp
trim(i)     = s_eff × TRIM[tier(i)]                                   (0 for no tier)
chunk seams (lang 'ja' only):
  bound[b] = 1 when b starts a B.phraseUnits(u, 'ja') unit of the run, or when the source grapheme before b is a
             particle and the one at b is not (KU.partsOf(source).part; source = spec.text when the run has its own
             text, else the cut text; run grapheme i ↔ source grapheme at offset base + u.offs[i])
  for every b ≥ 1 with bound[b], p = b − 1 not a space, trim(p) > 0 and trim(b) > 0:
      trim(p) ×= BOUNDARY; trim(b) ×= BOUNDARY
cap(i)      = trim(i) > 0 ? 1 − trim(i) : Infinity
along(i)    = min(alongAdvance(i), cap(i)) × groupScale(k, i)
```

- **Why these numbers.** At strength 1 the cells are: ordinary kana 0.86, wide 0.90, narrow 0.70, small 0.66,
  ー 0.92. These are chosen so that neighbouring ink does not overlap in gothic and mincho faces: common kana ink is at
  most ≈ 0.86 em, the widest kana (あ わ を む ね ゆ) and voiced kana at most ≈ 0.92 em, small kana ≈ 0.6 em, and
  く し り ≈ 0.45–0.6 em. The slider's 100 % therefore means "as tight as the ink allows". The default 70 % gives
  0.902 / 0.93 / 0.79 / 0.762 / 0.944. The browser ink check (X.2) guards the table.
- `alongAdvance` is the measured natural advance horizontally, 1 em for upright vertical cells, and the natural advance
  for rotated ones (ー is rotated in vertical text). `min(…)` makes the rule idempotent with proportional-kana faces
  (BIZ UDPGothic already advances its kana less than 1 em): they are never tightened twice.
- The glyph is still drawn centred in its cell (`textAlign 'center'`, `textBaseline 'middle'`), so the trim is
  symmetric, like palt for a centred kana.
- Kana that carry emphasis or a T2 factor keep the product: `min(nat, cap) × k`.
- Opt-out: runs that set `tracking` (S.5) or `kumi: null`.
- Worked numbers (fake measurer, size 100, `fit: 'none'`, from `probe/p1r2/ex4.js`):
  - 「夜明けのまち」 `{ kana: 0.7 }`, horizontal: x = 50, 150, 245.1, 338.45, 434.95, 528.3 and w = 100, 100, 90.2,
    96.5, 96.5, 90.2. Run width 573.4 (600 without). の is a particle, so の|ま is a seam and both keep half the trim.
  - The same run vertical: y and h as above.
  - 「ショートケーキ」 `{ kana: 1 }`: w = 86 (シ), 66 (ョ), 92 (ー), 70 (ト), 86 (ケ), 92 (ー), 86 (キ). Width 578 (700
    without).
  - 「きみのこえがきこえた」 `{ kana: 0.7 }`: w = 90.2, 93, 96.5, 95.1, 90.2, 96.5, 95.1, 90.2, 90.2, 90.2. Width 927.2
    (1000 without). The seams の|こ and が|き are 95–96.5 wide, the insides of the words 90–93.

### T1.5 Engine / planner / UI changes

- `engine/text/kumi.js`: `TRIM`, `WIDE_KANA`, `NARROW_KANA`, `FLAVOR_DAMP`, `BOUNDARY`, `tier`, `partsOf`, and the cap
  part of `apply`.
- `engine/text/layout.js`: S.6 items 1, 2 and 5 (the cap).
- `engine/text/service.js`, `engine/scene/build.js`: S.5.
- `planner/cast.js`, `planner/plan.js`, `planner/fields.js`, `planner/explain.js`, `planner/rules.js`: S.3 and S.4.
- `core/commands.js`: `NOT_CUT`. `core/doc.js`: P2 §0.2 if P1 lands first.
- `ui/fields.js`: the `kumi` section and the line rows (Q.2). `ui/widgets.js`: toggle `onValue`/`offValue`.
  `ui/inspector.js`: `inheritAuto`, and the `autoDefault` comparison after coercion (Q.2).

### T1.6 Strings

`sec.kumi`, `fld.kumiKana`, `fld.kumiKana.note`, `fld.kumiKanaPower`, `fld.kumiKanaLine`, `opt.kumi.on`,
`opt.kumi.off`, `whyRule.kumi.gen`, `whyRule.kumi.off`. The texts are in section Q.

### T1.7 Tests

- `tests/node/kumi.test.js`:
  - tiers: every hiragana, katakana and small kana of U+3041–U+30FF gets the right tier. が ぱ ヴ are 'wide'; ぐ じ ド
    are 'narrow'. 々, ・, ｱ (halfwidth) and 〜 get none.
  - `trim` at s = 0.7 and 1 equals the table; FLAVOR_DAMP for a `heavy` face and for weight 900.
  - seams: 「きみのこえが」 has seams at こ (after の) and at the phrase start, and half trims there; a seam next to a
    space is ignored.
- `tests/node/layout_kumi.test.js` (new):
  - An absent, `null` or all-zero `kumi` gives a RunLayout `deepEqual` to the one without the field. Cases: horizontal,
    vertical, tcy, a Latin run, emphasis, a `sizeGroup` pair. This includes `kumi: null` in the output.
  - The worked numbers of T1.4 (h and v), exactly.
  - A proportional measurer (a stub whose kana width is 85 at 100 px): at s = 0.7 an ordinary kana stays at 85 (cap
    90.2); at s = 1, cap 86 makes it 85.
  - Emphasis on a kana: w = cap × 1.15.
  - Fit consistency: for 60 × the sample cuts plus 5 mixed cuts, × box widths 300–1200 du × h and v, with T1 + T2 + T3
    at 100 % and `maxLines: 3`, the widest placed glyph reach is ≤ box + **1e-4** whenever `overfull` is false. The
    tolerance is 1e-4 because RunLayout positions are Float32: the unmodified engine already exceeds by up to 3.05e-5
    (`probe/p1r2/sweep_plain.js`). The prototype passes: 6 720 layouts, worst excess 3.05e-5.
- `tests/node/layout.test.js`: unchanged. It must stay green: it is the "absent = identical" guard for the old path.
- Mutation targets:
  - `TRIM.kana` 0.14 → 0.20: the worked-number test fails.
  - drop `min(nat, cap)`: the proportional test fails.
  - `BOUNDARY` 0.5 → 1: the seam test fails.
  - drop `'kumi'` from `LAYOUT_FIELDS`: the service cache test in X.1 fails.
  - drop `voiced(g)`: the tier test fails for が.

### T1.8 Goldens

Unchanged. No fixture has `look.gen` or a `text.kana` pin, so there is no cut decision, no cut-scoped service and no
`kumi` on any RunSpec. The only code on the old path is `KU.normalize(undefined) → null` and `if (ku && …)`. New
golden: X.3.

### T1.9 Performance

Per laid-out glyph, one table lookup: `tier` reads `u.cls` and `u.cells`, which `breaker.analyze` already computed.

Per run with `kana > 0`, the seams cost:
- one `B.phraseUnits` call on the run;
- one memoised `partsOf` of the source text, shared with T2.

Layout results stay LRU-cached. See X.4 for the measured totals.

### T1.10 Risks and open questions

- Canvas cannot switch on palt/vpal, so the trim is a class table, not the font's own proportional widths. The table
  is set to the ink-safe maximum at 100 %, and the ink check (X.2) guards it on the CI system faces. The real web faces
  (heavy and brush included) are checked by `contact_sheet.py --kumi --fonts` before release (X.5).
- `WIDE_KANA` is a first list. The ink check prints the worst pairs, and extending the list is a data change that only
  rewrites `project_kumi.json`.
- Chunk seams depend on the particle tagger's recall (T2.4). A missed particle just gives an ordinary trim at that
  seam, which is harmless.
- 約物詰め (、。「」) is out of scope; DESIGN §4.15.5 keeps it for later.
- Pick boxes and reveal wipes use the narrower cell width. The ink of a tightened kana overhangs its cell by at most
  0.07 em per side at 100 %. Picking is per owner (text element), so this does not change what a click selects.

### T1.11 Interactions

- P4 (M5 太さのアニメーション): a glyph drawn heavier during an entrance keeps its tightened cell. The weight damp
  (T1.4) is taken from the run's **layout** face weight, never the animated weight, so frames stay a pure function of
  the plan.
- P3 (キメ): a キメ line that should stay plain is set to 使わない per line by the user. P3 writes no kumi pins
  (P3 §interactions).

---

## T2: 助詞を小さく、頭の字を大きく

### T2.1 What the user gets

- 作品全体 › 文字組み › 「助詞を小さく・頭の字を大きく」, on in new works. Under 詳しい設定, shown while it is on:
  「ジャンプ率」 (10–100 %, default 50 %) and 「大きくする字」 [行の頭 | 言葉の頭 | 大きくしない]. 行の頭 is automatic.
- 行 › 色と書体 › 詳しい設定 › 「この行の大小（助詞・頭の字）」 [自動 | 使う | 使わない], with the note
  「助詞の見分けがずれた行は「使わない」にできます。」
- At the default:
  - Particles are set at **0.82×** on the shared baseline. They are の が を に で と へ も は から まで より, and
    stacked pairs such as には でも への.
  - The first character of each cut (**行の頭**) is set at **1.20×** when it is a kanji, katakana or hiragana. It is
    found after any opening bracket, so 「始まり」 grows 始.
  - With 言葉の頭, the first kanji or katakana of each phrase also grows.
  - At 100 % the factors are 0.64× and 1.40×.
- Particles keep the text colour, not the accent colour of 強調. Only Japanese lines are affected (`lang 'ja'`).

### T2.2 Gating and defaults

See S.2. New works: default `text.jump` 0.5 and `text.head` `'line'`, nothing pinned. Existing works: off.

T2 only affects runs that show a span of the cut's lyric text. Runs laid out from their **own text** (`spec.text`)
never get T2: notes, section headings of blank special cuts, labels and the title card.

### T2.3 Data model

Slots `text.jump` and `text.head` (S.3). RunSpec `kumi.jump` and `kumi.head`. RunLayout `kumi` roles 1 (particle)
and 2 (head). There is no lyric-markup change (`core/lyrics` grammar untouched) and no row field.

### T2.4 Algorithm

**Where the marks come from.** A run qualifies when `kumi.jump = j > 0`, `lang === 'ja'` and it has no own text.
`KU.marks(cutText, 'ja', kumi.head)` then tags the **whole cut text**: the `text` argument of `layoutRun`, which is
the builder's `cutText`. A particle at a run boundary therefore still sees its neighbours. Run grapheme `i` maps to the
cut grapheme whose offset is `base + u.offs[i]` (binary search in `marks.u.offs`; spans always sit on grapheme
boundaries).

**Particle tagger** (`KU.particleMarks(u)`, v6 = `probe/p1r2/tagger6.js`; tables frozen in the module):

```
P1 = は が を に で と へ も の          P2 = から まで より
STACK      = には では とは へは からは までは よりは にも でも とも へも からも までも よりも への との での からの までの よりの
VETO_NEXT  = が:るれらりろっ  で:るれろっすし  に:っ  と:っうれ  の:っ  は:っ  も:うっのえどらしるれりろ  へ:っ  を:—  から:だっ
             まで:—  より:そ
VETO_NEXT2 = で: ある あり あれ あろ        (copula である)      に: くい くく くか くさ くけ   (suffix にくい)
VETO_PAIR  = 死に 落と 逃が 騒が 急が 稼が 塞が 防が 泳が 脱が 嗅が 仰が 注が 研が 漕が 担が 剥が 紡が 繋が 焦が 転が 揺が
             最も 尤も 遠の 奏で 撫で 茹で 詣で 秀で 更に 既に 共に 特に 遂に 殊に 常に 正に 誠に 故に 実に
VETO_TRIPLE= 背のび 手のひ 目の当 木の実
KANA_WORDS = あなた あたし わたし きみ ぼく ぼくら おれ ふたり ひとり みんな だれ なに どこ ここ そこ あそこ いま きょう あした あす
             きのう こと もの とき ゆめ そら こえ ひかり ことば こころ なみだ えがお さくら はな ほし つき ゆき あめ かぜ うみ よる
             せかい みらい きもち いのち からだ まま さよなら なか あと そば うそ
LEAD_WORDS = まだ もう ずっと そっと もっと きっと やっと ただ この その あの どの こんな そんな あんな
OKURI_KANA = いりしちきみびぎえけせてねめれくるたらうつ
OKURI_FREE = の を まで から より          OKURI_EDGE = は も へ に が と
CLOSERS    = 」』）】〕〉》
contentLeft(g) = cls han | kata | katakana small kana | latin | digit | fullLatin, or g ∈ CLOSERS

for i in graphemes (left to right; a matched P2 consumes two):
  p = P2 at i if gs[i]+gs[i+1] ∈ P2, else P1 at i if gs[i] ∈ P1, else continue
  L = i − 1; skip if L < 0 or space[L]           (no particle at the start or after a space)
  R = i + len(p); rHira = R < n, not a space, hiragana
  ok =
    p = を                          → true                               (を is only ever the object particle)
    contentLeft(L)                  → gs[L]+gs[i] ∉ VETO_PAIR and gs[L]+p+gs[R] ∉ VETO_TRIPLE
    mark[L] (stacked)               → prev+p ∈ STACK (prev = the P2 or P1 marked before), and for p = は:
                                      not rHira unless gs[R..R+1] = 'ない'  (ではない, にはない)
    hiragana L                      → (a) the hiragana run ending at L ends with w ∈ KANA_WORDS (2–4 graphemes) that
                                          starts a word: at the text start, after a space, after a non-hiragana
                                          grapheme, after a marked particle, or after w' ∈ LEAD_WORDS that itself
                                          starts a word (one level)
                                      (b) else okurigana: gs[L] ∈ OKURI_KANA and (gs[L−1] is han, or gs[L−2] is han and
                                          gs[L−1] hiragana and not marked), and (p ∈ OKURI_FREE, or p ∈ OKURI_EDGE and
                                          not rHira)
  if ok and R < n and not space[R] and gs[R] ∈ VETO_NEXT[p] → not ok
  if ok and R + 1 < n and gs[R]+gs[R+1] ∈ VETO_NEXT2[p]     → not ok
  if ok → mark i … R−1 as particle
```

In words, a particle follows one of these: content (kanji, katakana, Latin, digits, a closing bracket), a known kana
word, a kanji word with short okurigana, or another particle it stacks with. It is not:
- the first kana of a verb or adverb ending (上がる, 奏でる, 共に, 最も, 積もる, 待とう, 見とれる);
- part of a copula or suffix (春です, 僕である, 見にくい);
- the inside of a compound (背のび, 手のひら);
- the start of a word that begins with the same kana (君に**は**なしたい, 空に**も**える, 君に**も**う一度).

Sentence-final particles (よ ね な さ か わ) and だけ, って and ながら are left alone on purpose.

**Measured precision** (graphemes marked vs hand labels; the labels count only the particles the tagger targets).
*In-sample* means the tagger's tables were written or changed while looking at that set. *Out-of-sample* means the
set was written after the version was frozen and nothing was changed because of it.

| Set | Lines | Written | Status for v6 | TP | FP | FN | Precision | Recall |
|---|---|---|---|---|---|---|---|---|
| App sample sheet (`core/lyrics.SAMPLE_JA`, 27 Japanese rows) | 27 | before v1 | in-sample | 50 | 0 | 5 | 100 % | 90.9 % |
| OWN (tuning set) | 73 | v1 | in-sample | 80 | 0 | 28 | 100 % | 74.1 % |
| HELDOUT 1 | 63 | after v2; v3/v4 tuned on it | in-sample | 68 | 0 | 17 | 100 % | 80.0 % |
| HELDOUT 2 | 50 | after v3; v4 reviewed on it | in-sample | 41 | 0 | 9 | 100 % | 82.0 % |
| Critic's 30 phrases + 7 copula/verb probes | 37 | by the critic, after v4 | in-sample (v5 fixed its 7 FP: 積もる 籠もる 春です 君でした 夢でしょう 光もれる 涙もろい) | — | 0 | — | — | — |
| HELDOUT 3 | 128 | **after v5 was frozen** | out-of-sample **for v5**: 164 TP / **4 FP** / 15 FN = **97.6 %** / 91.6 %. v6 then fixed the 4 FP (待とう 見とれて 僕である 見にくい), so it is in-sample for v6 | 164 | 0 | 15 | 100 % | 91.6 % |
| **HELDOUT 4** | 115 | **after v6 was frozen** | **out-of-sample for v6** (measured once, never tuned on) | 115 | **0** | 11 | **100 %** | 91.3 % |

Reading of the table:
- The honest out-of-sample figures are **97.6 % (v5 on HELDOUT 3)** and **100 % (v6 on HELDOUT 4)**, with recall of
  about 91 % on everyday phrases.
- The author of the tagger wrote both of these sets, so they are not independent. The release target is **≥ 97 %
  precision on an independent set**: at least 100 lines written by someone other than the tagger's author, never used
  for tuning (X.1).
- The remaining known risk classes:
  - verbs whose okurigana starts with a candidate kana and are not in the veto tables;
  - compounds written half in kana after one kanji (only four are in VETO_TRIPLE);
  - a hiragana name that equals a KANA_WORD;
  - copula past であった, which is also "met at" (街であった).
- A wrong line is fixed with the per-line 使わない. A miss keeps the particle at 1×, which is harmless.

Sample-sheet output, cut by cut, generated by `probe/p1r2/heads2.js` with the real v6 tables; excerpt, `(x)` =
particle: 始発(の)ホーム(に) / 改札(の)向こうで / 朝(が)ほどける / ポケット(の)切符(を) / まだ名前(の)ない /
今日(へ)行く / 電線(の)上(で) / 窓(に)映った / 寝ぐせ(の)僕(も) / 空(の)果て(まで). The misses on the sample are all
after hiragana context that the tagger declines by design: 向こう**で**, 影ぼうし**が**, 遠回りして**も**, ないね**と**,
まっすぐ**に**. The test computes the full list from `core/lyrics.SAMPLE_JA` at run time.

**Heads** (`KU.marks`, on the cut text):

```
MIN_HEAD_CONTENT = 3                         (a cut with fewer content graphemes gets no head)
OPENERS = 「『（【〔〈《"'(［｛“‘
first  = the first content grapheme of the cut, skipping graphemes in OPENERS
'line'   : first is a head when cls ∈ {han, kata, hira}, S.cells(g) === 1, g ≠ 'ー', not small kana and not a marked
           particle. A cut that starts with Latin, a digit, a tcy cell or other punctuation has no head: 「Hello」,
           「12月の」, 「…だね」.
'phrase' : 'line', plus the first grapheme of every B.phraseUnits(u, 'ja') unit after `first` when cls ∈ {han, kata},
           S.cells(g) === 1, g ≠ 'ー' and not a marked particle
'none'   : no heads
```

- **Why hiragana counts for 行の頭 but not for 言葉の頭.** A cut's first character is where the eye enters the line,
  whatever its script, and lyrics very often start in hiragana. That is what the owner's 「頭の字を大きく」 asks for.
  A phrase unit that starts in hiragana *inside* a line is usually a verb tail or a function word (ない, して), and
  enlarging it reads as a mistake.
- Sample, 行の頭, excerpt from `heads2.js`: 【始】発 / 【白】い息 / 【ま】だ名前(の)ない / 【そ】っと握って / 【ポ】ケット /
  【ツ】バメ / 【ど】こ(までも). Latin-initial cuts (Good morning, Hello, Fly high) get none.
- 言葉の頭 adds, for example, 始発(の)【ホ】ーム, 改札(の)【向】こう, 電線(の)【上】(で).

**Size factors** (`JUMP = { small: 0.36, big: 0.40 }`):

```
small = 1 − 0.36 × j          big = 1 + 0.40 × j            (j = 0.5 → 0.82 / 1.20; j = 1 → 0.64 / 1.40)
k[i] = particle ? (mark[i] ? emphScale : 1) × small            (a particle inside 強調 shrinks relative to it)
     : head     ? max(mark[i] ? emphScale : 1, big)           (never emphasis × head: 効果を重ねすぎない)
     : k[i]                                                    (emphScale or 1, as today)
role[i] = 1 particle, 2 head
```

`RunLayout.emph` (the accent ink and emphasis-first ordering) stays the 強調 marks only.

**Placement** uses unchanged code with per-glyph `k`.
- Horizontally, a glyph grows or shrinks about the font's baseline (`baselineShifts`: the centre moves by
  `shift × (1 − k) × s`). Particles sit on the line and heads rise above it. `lineReach` grows the block's
  `up`/`down`, and `crossExtent` and the fit account for it.
- Vertically, every glyph is centred in the column (`placeVertical`), and the column is as wide as its largest glyph.
- A tcy cell is never a head or a particle (digits).

Worked numbers (fake measurer, size 100, `probe/p1r2/ex2.js`):
- 「始発のホームに」 `{ jump: 0.5 }`: 始 em 120, x 60; の em 82, x 261; に em 82, x 643; the others em 100. Width 684
  (700 without), block height 120. Vertical: 始 at y 60 (h 120), の at 261 (h 82), column width 120.
- 「まだ名前のない」: ま em 120 (hiragana head), の em 82.
- 「「始まり」の朝」: 「 em 100, 始 em 120 at x 160, の em 82.
- With all three on at the defaults, 「始発のホームに」 `{ kana: 0.7, jump: 0.5, latin: 0.5 }`: の w 79.13
  (0.965 × 0.82 × 100: a seam cell times the particle factor), に w 73.96. Width 652.79.

### T2.5 Engine / planner / UI changes

- `engine/text/kumi.js`: the tagger tables, `particleMarks`, `partsOf`, `particles`, `marks` (memo), the heads,
  `JUMP`, `OPENERS`, and the `k`/role part of `apply`.
- `engine/text/layout.js`: S.6. The `k` array is prepare-local and is mutated by `apply` before `along` is computed.
- Parts: the S.5 opt-outs, all through `K.kumiFor(env, …)` (new, `parts/kit.js`): `{ jump: 0 }` for giantWhisper (4
  sites), confettiWords and magazineHead (2 sites), and `null` for the gridMosaic cells.
- Planner, doc, commands, service, build: S.2–S.5.
- UI: `ui/fields.js` rows 「助詞を小さく・頭の字を大きく」, 「ジャンプ率」, 「大きくする字」 and the line row (Q.2).

### T2.6 Strings

`fld.kumiJump`, `fld.kumiJump.note`, `fld.kumiJumpPower`, `fld.kumiHead`, `opt.kumiHead.line`, `opt.kumiHead.phrase`,
`opt.kumiHead.none`, `fld.kumiJumpLine`, `fld.kumiJumpLine.note` (section Q).

### T2.7 Tests

`tests/node/kumi.test.js`:
- **Tagger data** in `tests/fixtures/kumi_particles.json` (new): the labelled original lines `own`, `heldout1`,
  `heldout2`, `heldout3`, `heldout4` and `probes` (the critic's 30 and the 7 copula/verb probes). The sample rows are
  computed at test time from `core/lyrics.SAMPLE_JA`, with the gold of `probe/gold.js SAMPLE`.
- **Regression floors on the in-sample sets** (sample, own, heldout1–3, probes). Each test is named
  `regression: <set>`. FP must not exceed today's 0, and recall must be ≥ today's − 0.02: sample 0.88, own 0.72,
  heldout1 0.78, heldout2 0.80, heldout3 0.89. These are regression guards, not evidence of precision.
- **Held-out gate** on `heldout4`: precision ≥ **0.97** and recall ≥ 0.85. This is the release target, not 100 %, so a
  later tagger change is not pushed into overfitting the held-out set. Once a tagger change is made while looking at
  `heldout4`, the set moves to the regression group and a new held-out set must be added.
- **Release gate** (a pending test that fails until the file exists): `tests/fixtures/kumi_independent.json`, at least
  100 lines written and labelled by someone other than the tagger's author, never used for tuning. Required:
  precision ≥ 0.97. The measured numbers are recorded in docs/NOTES.
- **Named negatives:**
  - 上がって, 広がる, 曲がれば, 急いで, 奏でる, 共に, 最も, 背のび, 手のひら;
  - 君にはなしたい, 空にもえる, 君にもう一度 (も);
  - 揺らがない, 泳がせて, 白いはなが (は), 高いところ (と), 黒いとびら (と), 明けがた (が);
  - 積もる, 籠もる, 光もれる, 涙もろい, 春です, 君でした, 夢でしょう, 待とう, 見とれる, 僕である, 見にくい.
- **Named positives:**
  - 君にはない (には), 夢でもいい (でも), どこまでも (まで+も), このままで (で), ありがとうを (を), 会いに行く (に);
  - 寒いと思った (と), 夜が明けるまで (まで), 12月の (の), Tokyoの (の), 「またね」と (と);
  - 雪が積もる (が only), 声が枯れても (が, も), 今日も明日も (も, も).
- `particles(text, 'en')` and `'zhHans'` give `[]`.
- **Heads:**
  - 'line', 'phrase' and 'none' on the sample cuts; the expected lists are generated by running `KU.marks` and
    written into the test by the implementer after review (never by hand);
  - `MIN_HEAD_CONTENT`;
  - a hiragana-initial cut (「まだ名前のない」 → ま);
  - a bracket-initial cut (「「始まり」の朝」 → 始);
  - a Latin-initial cut and a digit-initial cut → none;
  - 言葉の頭 does not grow a hiragana phrase start (「まだ名前のない」: な of ない is not a head).
- `marks` and `partsOf` memos return equal results after the caches are cleared (determinism).

`tests/node/layout_kumi.test.js`:
- the worked numbers of T2.4 (h and v, the hiragana head, the bracket head, the combined case);
- an emphasized head is `max`, an emphasized particle is the product;
- a two-run split of 「始発のホームに」 (runs [0,3) and [3,7)) marks の in run 1 and に in run 2 exactly as the single
  run does;
- an own-text run (`spec.text`) gets no T2 roles;
- `RunLayout.emph` is unchanged.

`tests/node/scene_kumi.test.js` (new):
- `buildCut` of a planned sample doc with `look.gen = 1`: the particle glyph `em` in the target is 0.82 × size, and at
  least one glyph has `RunLayout.kumi` role ≠ 0. This proves the chain is live, not silently plain.
- giantWhisper: the `giantWidth` pre-measure equals the committed run's width with typesetting on.
- gridMosaic and haloRing glyph positions are identical with and without the marker.
- A cut with both a `text.weight` pin (P4) and kumi on: the glyphs carry the reweighed face **and** kumi roles, which
  tests the one chain of S.5.

Mutation targets:
- remove the `'を'` special case: the positives fail.
- drop the stacked-は rule: 君にはなしたい fails.
- drop `VETO_NEXT が`: 上がって fails.
- drop `VETO_NEXT2`: 僕である and 見にくい fail.
- drop the OPENERS skip: the bracket head fails.
- multiply instead of `max` for heads: the emphasis test fails.
- tag the run text instead of the cut text: the split-run test fails.

### T2.8 Goldens

Unchanged, for the same reasons as T1.8. The part opt-outs add a `kumi` field only when `env.text.kumi` is non-null
(`K.kumiFor`), so RunSpecs of existing documents are identical objects. New golden: X.3.

### T2.9 Performance

Tagging a new cut text costs 9–14 µs (prototype, sample cuts, Node). It is memoised per cut text and shared by T1's
seams and T2, so a cut with several runs tags once.

More distinct `em` values per run means more sprite rasters: at most one extra size bucket (a quarter octave) for
particles (0.82) and one for heads (1.20) at the default. The sprite LRU and the `perf.py` row of X.4 bound it.

### T2.10 Risks and open questions

- Recall is about 74–91 % (lower in kana-only lines). Raising it needs a morphological dictionary, which the app cannot
  ship at its size.
  - A later optional AI path could suggest particle ranges as line pins.
  - A later UI could offer per-word 「小さく」 / 「大きく」 chips (a new line pin with offsets).
  - Both are **out of P1**.
- Heads make the widest line and the block a little larger, so `fit: 'shrink'` may lower the run by up to ≈ 7 % at
  100 % in boxes sized for exactly 1.3 em (`h = em × 1.3`). At the default the head (reach 1.20) still fits.
- 行の頭 is per **cut**: a line split with 「/」 gets one head per piece. The option name says 行 because a cut is what the
  viewer sees as a line.
- Horizontal alignment is on the font's alphabetic baseline, not the ideographic em-box bottom. The difference is
  ≈ 0.06 × (1 − k) em for Noto Sans JP, under 0.5 % of the em at the default. This is kept for consistency with 強調.

### T2.11 Interactions

- P2 (T5 効果を重ねすぎない): T2 already opts out where a part contrasts sizes (giantWhisper, confettiWords,
  magazineHead). P2's effect budget does not count typesetting (P2 §3: lettering factors read `text.style` only) and
  writes no kumi pins.
- P3 (M3 キメ):
  - A キメ rule that picks giantWhisper (大と小) gets no T2 automatically, through the opt-out.
  - A キメ that picks edgeBleed (はみ出し) keeps T2; bold heads suit it.
  - P3 may read `RunLayout.kumi` (the heads). P3 writes no kumi pins.
- P4 (M4 モーフ): matched glyphs may have different `em` in the two cuts (a particle in one, not in the other). The
  morph interpolates each glyph's own `em` like any other size (P4 §interactions).
- P6 (歌ハメ): glyph order and `off` are unchanged, and P6 does not use the tagger (P6 §interactions).

---

## T3: 英字は少し大きく、日本語との間を少し空ける

### T3.1 What the user gets

- 作品全体 › 文字組み › 「英字を少し大きく・和文との間をあける」, on in new works. Under 詳しい設定, shown while it is on:
  「英字の大きさとあき」 (10–100 %, default 50 %).
- Line row: 「この行の英字」 [自動 | 使う | 使わない].
- Effect in Japanese (and Chinese or Korean) lines:
  - A Latin word or phrase is set **1.10×** (1.20× at 100 %), including the spaces and punctuation *inside* it.
  - **0.15 em** (0.30 em at 100 %) of space is added between it and the Japanese next to it, horizontally and
    vertically. There is no added space at a line start or end, next to a space, or next to 「」、。.
- Digits alone (12月, 2人, 100年) keep their size and spacing.
- Pure English lines are unchanged.
- A Latin word gets the same size whichever layout the line has, whether it is set as one whole-line run or as one run
  per word.

### T3.2 Gating and defaults

See S.2. New works: default 0.5. Existing works: off.

T3 applies to a run when both hold:
- `lang !== 'en'`. The builder gives every committed run the cut's `lang` (`builder.js:344`).
- `KU.hasCjk(source)`, where source is the run's own text (`spec.text`) when it has one, else **the cut text** (the
  `text` argument of `layoutRun`). CJK means breaker classes han, hira, kata, smallKana and hangul.

Because the gate reads the cut text, a Latin-only run cut from a Japanese line scales exactly as the same word does
inside a whole-line run. confettiWords, stairStep and the other per-word or per-phrase arranges get the same 1.10×.
A cut such as 「Hello」 or 「Fly high」 (no CJK in the cut) is untouched.

### T3.3 Data model

Slot `text.latin` (S.3). RunSpec `kumi.latin`. RunLayout `kumi` role 3. The per-grapheme gap stays internal to the
layout (`prep.gap`).

### T3.4 Algorithm

```
LATIN_GROW = { default: 0.20, 'Caveat': 0.30, 'Cormorant Garamond': 0.28 }  (keyed by refs[1].family, the run's Latin face)
LATIN_GAP  = 0.30                                                          (em at strength 1)
x = kumi.latin; grow = 1 + x × LATIN_GROW[family]
segments: maximal runs [a, b) with font[i] === 1 (layout.fontIndices: Latin letters, digits, ASCII punctuation and
          the spaces next to them, since a space takes the font of the grapheme before it); a segment is Latin when it
          holds at least one cls 'latin' grapheme
content:  c0 = u.next[a], c1 = u.prev[b] + 1        (edge spaces are not the word's; skip when c0 ≥ c1)
for x in [c0, c1): skip vertical tcy members; k[x] = max(k[x], grow); role[x] ||= 3
cjk(g) = 0 ≤ g < n, not a space, cls ∈ {han, hira, kata, smallKana, hangul}
if cjk(c0 − 1): gap[c0] = LATIN_GAP × x          (before the word)
if cjk(c1):     gap[c1] = LATIN_GAP × x          (before the grapheme after it)
```

- The gap is keyed on the content bounds and the class change, never on phrase units, because kinsoku moves phrase
  starts (Loveっ|て).
- Edge spaces are neither scaled nor gapped. A trailing space (「…morning 君」) already separates the word from the
  Japanese, and so does a leading one (「君 Good」). The same holds after trailing punctuation plus space
  (「Hello, 世界」).
- `max` rather than a product: an emphasized Latin word keeps its emphasis size (1.15) instead of 1.15 × 1.10. This is
  the same rule as T2 heads (効果を重ねすぎない).
- Scaling by `k` multiplies the measured prefix advances, so the segment's kerning ratios are kept.
- Width: `trackedWidth` adds `gap[i]` before grapheme `i` and drops `gap[t0]` at a trimmed line start. `place` adds it
  before every glyph except the line's first (S.6). A line that ends right before a Latin word carries no trailing
  gap, because the gap belongs to the next grapheme.
- Vertical: the same along the column. A rotated Latin run (≥ 3 letters) and upright letters (≤ 2) are scaled; tcy
  digits are not.

Worked numbers (fake measurer, size 100, `probe/p1r2/ex2.js`), all with `{ latin: 0.5 }` unless stated:
- 「夜明けのStationで」:
  - The Latin word: の ends at 400; S starts at 415 (x 445.8, w 61.6, em 110); n ends at 815.4; で starts at 830.4.
    Run width 930.4 (864 without `kumi`).
  - In a 700 du box with `maxLines: 2` it breaks before S. Line 1 is 400 wide (no trailing gap), and line 2's S is at
    x 30.8 (no leading gap).
  - Vertical: the same numbers along y.
- 「声でGood morning 君」: the inner space is scaled (w 33); the trailing space is not (w 30, x 909.8, ends at 924.8);
  君 starts at 924.8, so there is no gap. Width 1024.8.
- 「Hello, 世界」: `,` is scaled (w 66); the space is not (w 30, ends at 342.4); 世 starts at 342.4, so there is no gap.
- 「君 Good」: the space is unscaled, there is no gap, and Good has em 110.
- 「12月の空」: identical to the layout without `kumi`.
- The run `Good` with span [4, 8] of the cut 「小さな声Good morning」 has em 110. The same span [0, 4] of the cut
  「Good morning」 has em 100 (no CJK in the cut).
- 「君のStar」 with `emph [[2, 6]]` and `emphScale 1.15`: em 115, not 126.5.

### T3.5 Engine / planner / UI changes

- `engine/text/kumi.js`: `hasCjk` (memo), `LATIN_GROW`, `LATIN_GAP`, and the segment, gap and Latin parts of `apply`.
- `engine/text/layout.js`: S.6 items 2–4 (the gap in width and placement; `str` passed to `apply`).
- UI rows (S.1, Q.2); planner, doc, commands, service and build as in S.2–S.5.

### T3.6 Strings

`fld.kumiLatin`, `fld.kumiLatin.note`, `fld.kumiLatinPower`, `fld.kumiLatinLine` (section Q).

### T3.7 Tests

- `tests/node/kumi.test.js`: segments and content bounds for:
  - 「夜明けのStationで」;
  - 「小さな声でGood morning」: one segment, with the inner space inside the content;
  - 「声でGood morning 君」: the content ends before the trailing space;
  - 「Hello, 世界」: the content ends at `,`;
  - 「12月の空」: a digit segment, not Latin;
  - 「Hey!!君」: `!!` belongs to the segment;
  - 「「Love」」: no gap next to the brackets.

  Also `hasCjk` of 「Good morning」, 「小さな声」 and `''`.
- `tests/node/layout_kumi.test.js`:
  - the worked numbers of T3.4 (h, v, and the two-line break with no leading and no trailing gap);
  - inner spaces of 「Good morning」 are scaled (w 33 at 1.10); edge spaces are not (w 30), and there is no gap at them;
  - a run with `lang 'en'` is `deepEqual` to the plain layout;
  - a Latin-only span of a cut without CJK is `deepEqual` to the plain layout, and the same span of a cut with CJK is
    scaled;
  - tcy digits in vertical 「2人でStationへ」 keep the `sx`/`em` of the plain layout;
  - an emphasized Latin word gets `em = size × emphScale`.
- `tests/node/scene_kumi.test.js`: the same sample cut planned with arrange pinned to centerAnchor and to
  confettiWords gives the same `em` on its Latin glyphs.
- Mutation targets:
  - remove `− gap[t0]` in `trackedWidth`: the break test fails, because width disagrees with placement, and so does the
    fit test.
  - scale by class `latin` instead of the content bounds: the inner-space test fails.
  - drop the edge-space trim (use `[a, b)`): the 「声でGood morning 君」 and 「Hello, 世界」 tests fail.
  - gate on the run text instead of the cut text: the confettiWords test fails.
  - key the gap on `phraseUnits`: the Loveって test fails. 「Loveって」 must have its gap between e and っ, not between っ
    and て.
  - product instead of `max`: the emphasis test fails.

### T3.8 Goldens

Unchanged (see T1.8). New golden: X.3.

### T3.9 Performance

One pass over the font array per run, O(n), and one memoised `hasCjk` per source text. There is no extra measuring:
the Latin segment's advances are already measured.

### T3.10 Risks and open questions

- Latin faces differ in x-height. LATIN_GROW has two family corrections today, to be checked on real-font contact
  sheets (X.5) and extended there; it is a data table.
- A larger Latin word raises `lineReach` for the whole block, so the leading and centring of mixed lines move by
  ≈ 0.05 em.
- Korean lines get the same treatment (Latin inside hangul is rare). If the owner prefers, T3 can be gated to `ja` and
  `zh*` only, a one-line change in `apply`.

### T3.11 Interactions

- P5 and P6: no effect on timing. 歌ハメ reveals glyph by glyph in the same order.
- P4 (M4): Latin glyphs matched across cuts may differ in `em` (1.10 vs 1). They are interpolated as in T2.

---

## F. Files, by module and function

| File | Change |
|---|---|
| `src/engine/text/kumi.js` | **new** (S.6, T1–T3.4) |
| `src/engine/text/layout.js` | deps + `engine/text/kumi`; `normalizeSpec` (kumi); `prepare` (apply with `str`, cap, gap); `trackedWidth(…, gap)`; `place` (gap); `build` (RunLayout.kumi) |
| `src/engine/text/service.js` | deps + `engine/text/kumi`; `LAYOUT_FIELDS` + `'kumi'`; `createTextService({ kumi })`, `specOf`, memoised `withKumi`, `kumi` getter, `withFaces` keeps kumi |
| `src/engine/scene/build.js` | `kumiOf(slots)`; `buildCutWith` derives one `text`/`csvc` (with P4's `withFaces`) and passes it to `createBuilder`, `baseEnv`, `sceneOf` |
| `src/parts/kit.js` | `K.kumiFor(env, over)` |
| `src/parts/arrange/core.js` | giantWhisper, 4 specs: `…K.kumiFor(env, NO_JUMP)` |
| `src/parts/arrange/scatter.js` | confettiWords run `{ jump: 0 }`; gridMosaic cell run `null` |
| `src/parts/arrange/editorial.js` | magazineHead head and sub `{ jump: 0 }` |
| `src/planner/cast.js` | `SLOT_SPECS` + 4; `KUMI_SLOTS`; `kumiAuto`; `decideKumi`; call in `castSlots`; export |
| `src/planner/plan.js` | ctx `kumi`; stage 2 `ctx.kumi`; stage 5 look key + `ctx.kumi` |
| `src/planner/rules.js` | P1 rows; row fields `on`/`off`/`spec`; `scopesOf`; autoText rule (created by P1 if P2 has not landed) |
| `src/planner/fields.js` | `lockPayload` skip; `kumiAt`; `decisionAt` branch; `sourceAt` no-cut pattern; re-export `KUMI_SLOTS` |
| `src/planner/explain.js` | pin index for kumi slots; the minimal work-scope why if P2 has not landed |
| `src/core/doc.js` | P2 §0.2 (`GEN`, `newDoc`, `ORDER.look`, `checkLook`), only if P1 lands first |
| `src/core/commands.js` | `NOT_CUT` + 4 |
| `src/core/types.js` | RunSpec `kumi`, RunLayout `kumi` typedefs |
| `src/ui/boot.js`, `src/ui/project_io.js` | `D.newDoc()` at l.107, l.610, l.1176 (P2 §0.2; only if P1 lands first) |
| `src/ui/fields.js` | `slotScopes` via `RU.scopesOf`; `KUMI_SPEC`, `KUMI_POWER`, `KUMI_ON`; section `kumi` after `type` on the work page; 3 line rows in `colortype` on `line` and `lines`; `ctx.kumi` in the context builder |
| `src/ui/widgets.js` | `toggle`: commit `field.onValue` / `field.offValue` when given (defaults `true` / `false`) |
| `src/ui/inspector.js` | `stateOf`: `inheritAuto`; `valueFor`: `autoDefault` compares after coercion (with P2) |
| `src/i18n/strings.js` | section Q |
| `docs/DESIGN_2_1.md` | new section 「文字組み」 (numbered by the integrator): S–T3 in DESIGN style; §4.15.4 RunSpec/RunLayout additive fields |
| `docs/SPEC.md` | 作品全体 › 文字組み and the line rows |
| `docs/NOTES.md` | PV22-P1 entry: gating, precision (in- and out-of-sample), independent-set result, perf rows, ink check, visual QA |

`build.py` is not changed.

---

## Q. Strings and field definitions

### Q.1 Strings (`src/i18n/strings.js`, pairs [ja, en]; English has no Japanese characters)

| Key | ja | en |
|---|---|---|
| `sec.kumi` | 文字組み | Typesetting |
| `fld.kumiKana` | かなを詰める | Tighten kana |
| `fld.kumiKana.note` | ひらがな・カタカナの字間を詰めて、言葉をひとかたまりで読ませます。新しい作品でははじめからオンです。 | Sets hiragana and katakana closer so each word reads as one block. New works start with this on. |
| `fld.kumiKanaPower` | 詰める強さ | Tightness |
| `fld.kumiJump` | 助詞を小さく・頭の字を大きく | Small particles, large first letters |
| `fld.kumiJump.note` | 「の」「が」「を」などの助詞を小さく、行の頭の字を大きくして、大小のメリハリをつけます。かなだけの言葉の中の助詞は見つけられないことがあります。新しい作品でははじめからオンです。 | Makes particles such as no, ga and wo smaller and the first letter of each line larger. Particles inside words written only in kana may be missed. New works start with this on. |
| `fld.kumiJumpPower` | ジャンプ率 | Size contrast |
| `fld.kumiHead` | 大きくする字 | Letters to enlarge |
| `opt.kumiHead.line` | 行の頭 | Start of each line |
| `opt.kumiHead.phrase` | 言葉の頭 | Start of each phrase |
| `opt.kumiHead.none` | 大きくしない | None |
| `fld.kumiLatin` | 英字を少し大きく・和文との間をあける | Larger Latin, spaced from Japanese |
| `fld.kumiLatin.note` | 日本語の行の中の英字を少し大きくし、日本語とのあいだを少しあけます。数字だけのところ（12月など）はそのままです。新しい作品でははじめからオンです。 | Sets Latin words in Japanese lines a little larger with a little space around them. Numbers on their own stay as they are. New works start with this on. |
| `fld.kumiLatinPower` | 英字の大きさとあき | Latin size and spacing |
| `fld.kumiKanaLine` | この行のかな詰め | Kana tightening on this line |
| `fld.kumiJumpLine` | この行の大小（助詞・頭の字） | Size contrast on this line |
| `fld.kumiJumpLine.note` | 助詞の見分けがずれた行は「使わない」にできます。 | Turn it off for a line whose particles were read wrongly. |
| `fld.kumiLatinLine` | この行の英字 | Latin on this line |
| `opt.kumi.on` | 使う | On |
| `opt.kumi.off` | 使わない | Off |
| `whyRule.kumi.gen` | 新しい作品なので、はじめからオン | A new work, so it starts on |
| `whyRule.kumi.off` | 文字組みは使っていません（作品全体 › 文字組み で入れられます） | Not in use (turn it on in Whole video › Typesetting) |

- Reused: `state.auto` 「自動」, `unit.pct` 「%」, and P2's `rule.auto.new` 「新しい作品の標準」 and `rule.auto.old`.
- The why codes are `rule` codes (`whyRule.*`), so `tests/node/i18n.test.js WHY_CODES` needs no change. Its "every
  key a pair, English without Japanese" check covers the new keys.

### Q.2 UI field definitions (`ui/fields.js`)

```js
const KUMI_SPEC = { type: 'num', min: 0, max: 1, step: 0.05 };
const KUMI_POWER = { type: 'num', min: 0.1, max: 1, step: 0.05, unit: 'pct' };   // the slider never reaches off
const KUMI_ON = Object.freeze({ 'text.kana': 0.7, 'text.jump': 0.5, 'text.latin': 0.5 });   // = the planner/rules `on`
const KUMI_HEADS = Object.freeze(['line', 'phrase', 'none']);
const kumiOn = (slot) => (ctx) => !!ctx.kumi && ctx.kumi[slot] > 0;
function kumiWork(slot, label, power) {
  return [
    F({ path: slot, scopes: WORK, widget: 'toggle', label, spec: KUMI_SPEC, onValue: KUMI_ON[slot], offValue: 0,
      autoDefault: true, note: label + '.note', noDice: true }),
    F({ key: slot + '.power', path: slot, scopes: WORK, widget: 'number', label: power, spec: KUMI_POWER, scale: 100,
      autoDefault: true, basic: false, noDice: true, when: kumiOn(slot) }),
  ];
}
const kumiLine = (slot, label, note) => F({ path: slot, scopes: LINE, widget: 'choice', label, spec: KUMI_SPEC,
  options: [{ v: KUMI_ON[slot], label: 'opt.kumi.on' }, { v: 0, label: 'opt.kumi.off' }], auto: true, inheritAuto: true,
  basic: false, noDice: true, note });
// work page, right after sec('type', …):
sec('kumi', false, [
  ...kumiWork('text.kana', 'fld.kumiKana', 'fld.kumiKanaPower'),
  ...kumiWork('text.jump', 'fld.kumiJump', 'fld.kumiJumpPower'),
  F({ path: 'text.head', scopes: WORK, widget: 'choice', label: 'fld.kumiHead', spec: { type: 'enum', of: KUMI_HEADS },
    options: opts(KUMI_HEADS, 'opt.kumiHead.'), autoValue: 'line', basic: false, noDice: true, when: kumiOn('text.jump') }),
  ...kumiWork('text.latin', 'fld.kumiLatin', 'fld.kumiLatinPower'),
]),
// line and lines pages, section 'colortype', appended:
kumiLine('text.kana', 'fld.kumiKanaLine'), kumiLine('text.jump', 'fld.kumiJumpLine', 'fld.kumiJumpLine.note'),
kumiLine('text.latin', 'fld.kumiLatinLine'),
```

- **Context builder** (`ui/fields.js`, the function that returns `ctx`, l.480–519): add
  `kumi: scopeKind === 'work' && doc ? kumiValues(doc) : null`, with
  `kumiValues(doc) = { [slot]: RU.value(doc, pinIndexOf(doc.pins), slot) }` for the three switches. The rows then
  hide their slider and 大きくする字 while the switch is off. A slider can no longer sit at 10 % with its box reading 0,
  and dragging it cannot silently turn the feature on.
- **`ui/widgets.js toggle`**:
  `box.addEventListener('change', () => env.commit(box.checked ? (field.onValue !== undefined ? field.onValue : true) :
  (field.offValue !== undefined ? field.offValue : false)));`. `update` already shows a number > 0 as on.
- **`ui/inspector.js valueFor`** (P2 adds `autoDefault`): coerce first, then compare with
  `RU.defaultValue(doc(), ix, field.path)`. Numbers are equal when `Math.abs(a − b) < 1e-9`; other values use `===`.
  If equal, return `W.AUTO` (unpin). This matters because a slider value such as 14 × 0.05 must match 0.7. The P1
  rows carry no `offClears`.
- **`ui/inspector.js stateOf`**:
  `auto: !fs || fs.state === 'auto' || fs.state === 'mark' || (f.inheritAuto && fs.state === 'inherited')`.
  A line row that follows a user's work pin therefore shows 自動 selected instead of nothing. The state icon still
  shows the inherited ring.
- 大きくする字 uses the choice widget's existing `autoValue` (`widgets.js:74–82`). 行の頭 is shown while unpinned, and
  choosing it unpins. There is no separate 自動 option.

---

## X. Tests, goldens, performance, visual QA (all items)

### X.1 Node tests (new files and additions)

| File | Cases |
|---|---|
| `tests/node/kumi.test.js` (new) | T1.7, T2.7, T3.7 module-level cases; `normalize` (clamp, all-zero → null, bad head → 'line'); `key`; `withCut` (null cut, `kumi: null`, `tracking` set, partial override merge, key order irrelevant) |
| `tests/node/layout_kumi.test.js` (new) | T1.7, T2.7, T3.7 layout cases; the fit-consistency sweep (tolerance 1e-4) |
| `tests/fixtures/kumi_particles.json` (new) | labelled original lines: own, heldout1–4, probes (T2.7) |
| `tests/fixtures/kumi_independent.json` (release) | ≥ 100 independent labelled lines (T2.7); its test is pending until the file exists |
| `tests/node/layout.test.js` (add) | service: `layout(spec)` twice with different `kumi` gives two cache entries; `withKumi` shares the LRU and returns the **same** object for an equal kumi (memo) and `this` for the service's own kumi; the memo holds ≤ 16; `withFaces` keeps `kumi`; a spec without `kumi` has the same key as before (compare `specKey` of a stored literal) |
| `tests/node/scene_kumi.test.js` (new) | T2.7 and T3.7 scene cases; the `text.weight` + kumi chain case; a doc without the marker builds scenes `deepEqual` to today's |
| `tests/node/planner_kumi.test.js` (new) | see below |
| `tests/node/ui_fields.test.js` (edit and add) | l.293: the work-page section list becomes `['look','media','colors','type','kumi','energy','parts','title','timing','lines','looks','defaults','other']` (this edit is required). `slotScopes('text.kana')` etc. are `['work','line']`. Section `kumi` has the 7 rows in Q.2 order, each `noDice`. Sliders and 大きくする字 have a `when` that is false for `ctx.kumi` zeros and true for the defaults. The line and lines pages have the 3 rows with `inheritAuto` and options [使う, 使わない]. |
| `tests/node/ui_data.test.js` (add, next to l.76–82) | `work:text.kana` (value 0) counts as a look choice for step ③ ('done'); a fresh `D.newDoc()` has empty pins, so ③ is 'todo' |
| `tests/node/commands.test.js` (add) | `cut/…:text.kana`, `cut/…:text.head` refused by `pin.set` and `lock.set`; `line/…:text.jump` → `pin.promote` to work ok; `pin.copy` does not copy them |
| `tests/node/doc.test.js` (add, if P1 lands first) | P2 §1.7 items 1 and 6 (newDoc marker, normalize never adds it, the three UI call sites) |
| `tests/node/planner_determinism.test.js` (add) | the cold-plan timing loop also runs on the same doc with `look.gen = 1` (same 60 ms bound); the random-edit re-plan test (plan equals a fresh plan) on a gen document with the edit menu extended by `pin.set` / `pin.clear` of `work:` and `line/…:` kumi slots |
| `tests/node/i18n.test.js` | passes as is |

**`tests/node/planner_kumi.test.js`** cases:

1. Without the marker and without pins, no cut has a kumi slot, for every fixture and corpus document.
2. With `look.gen = 1`, every cut has `text.kana = { v: 0.7, from: 'auto' }` and the same for `text.jump` 0.5 and
   `text.latin` 0.5 (the objects are identical: interned). No cut has `text.head`.
3. **Gate completeness:** for every fixture and corpus document, the plan hash with `look.gen = 1` **and** work pins
   `text.kana = text.jump = text.latin = 0` equals the plan hash of the document as it is. Mutation: write a decision
   for value 0, and this fails.
4. A line pin 0 turns the setting off on that line only (no decision there). A line pin 0.7 turns it on in a document
   without the marker. A work pin `text.head = 'phrase'` appears only on cuts where `text.jump` is on.
5. Every other slot of every cut equals the plan without the kumi settings (`deepEqual` after deleting the four keys).
   The history rows are unchanged.
6. `pin.clearUnder('work')` on a gen-1 document with the three work pins at 0 gives back the automatic decisions.
7. `fields.lockPayload` of a line in a gen-1 document writes no kumi pin, and `lock.set` with its payload succeeds.
   Mutation: remove the skip, and `lock.set` throws.
8. `fields.fieldState` at work scope: value = work pin, else default. With a line pin 0 on the first line and the
   switch on at work, the work field value is still 0.7. At line scope under a user work pin 0.9, the state is
   `inherited` (the UI's `inheritAuto`).
9. `explain` gives why `whyRule.kumi.gen` on a gen-1 cut, `kumi.off` without the marker, and the pin reasons when
   pinned.
10. Cast cache: plan a legacy document, then the same text and seed with `look.gen = 1`, in one process. The second
    plan equals a fresh plan. This tests `ctx.kumi` in the look key.

### X.2 Browser tests

- `tests/browser/ui_flows.py`, new flow 「文字組み」:
  - A `?fresh=1` page opens 作品全体 › 文字組み and shows the three switches on, marked 自動, and `doc.pins` is empty.
  - Switching かなを詰める off writes `work:text.kana = 0` in one undo entry, and the plan's cuts lose `text.kana`.
    Undo restores it.
  - 詰める強さ is hidden while the switch is off.
  - 行 › 色と書体 › 詳しい設定 › この行の大小: 自動 is selected; choosing 使わない pins `line/<id>:text.jump = 0`.
  - 「すべて外す」 on 作品全体 brings the switch back on.
  - A legacy fixture opened from a file shows the switches off.
- **Existing browser checks need no edit.** A new work carries no pins, so these hold:
  - ux-11 (`ui_flows.py:1945–1949`) keeps ③ 'todo';
  - flow_library's 'importing places nothing' (l.3607) keeps zero pins;
  - the 作品全体 header shows no 固定 count.

  Every browser test that starts with `?fresh=1` now runs a new work with typesetting on: ui_flows, ui_layout, csp,
  i18n_pages, kit_check, media_*, package_io, transparent_check and webm_check. The implementer runs them all. None
  compares a fresh page's frames with a stored hash.
- **Ink check (gate)**, `tests/browser/glyph_parity.py` check 6 "kumi ink". It uses a new lab helper
  `window.__lab.kumiInk({ flavor, orient })`. For every kana of U+3041–U+30FF with `cells 1`, the helper returns:
  - its cell at strength 1, from `KU.apply` on a one-grapheme run;
  - its ink extents from the centre: `measureText` actualBoundingBoxLeft/Right horizontally, and Ascent/Descent with
    `textBaseline 'middle'` vertically, in em.

  The check computes, for every ordered pair (a, b), the overlap = inkAfter(a) + inkBefore(b) − (cell(a) + cell(b)) / 2.
  It asserts that the maximum over all pairs is ≤ **0.02 em**, horizontally and vertically, for the gothic and mincho
  flavours of the CI system Japanese faces (CI installs them; fonts are blocked as in the other checks). The worst 5
  pairs are printed. Chunk seams only relax cells, so the one-grapheme cell is the worst case.

### X.3 Goldens

**Unchanged, byte for byte:** `frame_hashes_v2.json` (FROZEN), `plan_hashes.json`, `frame_hashes.json`,
`project_media.json`, `project_repeat.json` and `project_extreme.json`. The reasons:

1. `defaultDoc()` and every fixture are unchanged and carry neither `look.gen` nor a kumi pin. `update_golden.js` and
   `corpus.js` never call `newDoc`.
2. `ctx.kumi` is all zeros, so `decideKumi` sets nothing and draws nothing. `isChoice` keeps history rows equal, so
   plans hash the same. The cast look key changed, but it is an internal cache key that is not hashed into the plan.
3. `kumiOf(slots)` is null, so `svc.text` is used as it is. Specs carry no `kumi`, `specKey` is unchanged, and
   `layout.prepare` takes the old path.
4. Part opt-outs write `kumi` only when `env.text.kumi` is non-null.
5. The registry is unchanged (no new part), so `registry.version` and every `fp` stay.

`node tests/update_golden.js --check` must pass before the new golden is written.

**New:** `tests/golden/project_kumi.json` `{ registry, measurer: 'fake', docs: { basic: { plan, frames[40] }, vertical:
{ plan, frames[40] } } }`. It is produced by a new job in `tests/update_golden.js` (after `project_extreme.json`) from
`tests/helpers/kumi_docs.js goldenDocs()`:
- `basic`: `corpus.project('basic').doc` with `look.gen = 1`. This is the new-work default path.
- `vertical`: `corpus.project('vertical').doc` without the marker, with `work:text.kana = 1`, `work:text.jump = 1`,
  `work:text.head = 'phrase'`, `work:text.latin = 1`, and `line/<its second line id>:text.jump = 0`. This is the pin
  path at full strength.

Both are rendered like the other project goldens (fake measurer, 360 short side, 40 frames). The job **refuses to
write** unless:
- every cut of `basic` holds the three automatic decisions;
- at least 30 of its 40 frame hashes differ from the same document without the marker.

These conditions keep the golden from silently exercising none of P1.

### X.4 Performance

Measured on the prototype (`probe/p1r2/perf2.js`, Node, fake measurer, sample cuts, uncached layouts, marks memoised
as in the real module; best of 7):

| | Plain | All three on (0.7 / 0.5 / 0.5) |
|---|---|---|
| Horizontal | 13.4–15.2 µs per layout | 17.5–17.8 µs |
| Vertical | 12.1–14.0 µs per layout | 16.5–17.1 µs |

That is about +25 %. Layouts are LRU-cached (2 000 entries), so steady-state frame time does not change, and scene
builds pay the difference once. The derived text services are memoised (≤ 16 per base service), so a cut build no
longer re-hashes the faces (`H.hashJSON(faces)`) or rebuilds closures for kumi.

- `tests/browser/perf.py`: new row `kumi`, `project_long` with `look.gen = 1`, 10 s at 30 fps at 720p. It is judged at
  twice the §7.4 budget like the other rows, **and** p50 must be ≤ 1.10 × the plain `project_long` p50 of the same run.
  The flag `--no-kumi` skips it. Existing rows are unchanged, because their fixtures have no marker.
- Planner: per cut, four `PA.pinned` set lookups and three reads of `ctx.kumi`; `resolvePin` only when pinned. The
  re-planning speed test (`planner_determinism` cold-plan < 60 ms, 6-edit batches within 2 × budget) stays, and X.1
  adds the gen-1 variant.
- Sprites: at the defaults, at most one extra quarter-octave bucket for particles and one for heads and scaled Latin.
  The sprite LRU bounds memory.

### X.5 Visual QA and the release ink check

`tests/browser/contact_sheet.py` gains `--kumi`. It renders the sample project with `look.gen = 1` (defaults) and
with all three at 100 %, via the lab's additive `o.look` / `o.pins`, in these faces:
- gothic (Noto Sans JP);
- mincho (Shippori Mincho B1);
- heavy (Dela Gothic One);
- brush (Yuji Syuku).

Each is rendered horizontally and vertically.

With `--fonts`, the sheet also runs the X.2 ink measurement on the four real web faces (FLAVOR_DAMP applied) and
prints FAIL rows for pairs over 0.02 em. This is a release check recorded in docs/NOTES, not CI, because it needs
Google Fonts.

The tables `TRIM`, `WIDE_KANA`, `FLAVOR_DAMP`, `JUMP`, `LATIN_GROW` and `LATIN_GAP` are tuned there. Each is a
frozen table in `engine/text/kumi`, and a change rewrites only `project_kumi.json`.

---

## R. Global risks and open questions

1. **Tagger precision.** Out-of-sample 97.6 % (v5 on HELDOUT 3) and 100 % (v6 on HELDOUT 4); recall about 91 % on
   everyday lines and lower in kana-only writing. Both sets were written by the tagger's author. The independent set
   (X.1) is the release gate. The escape hatch is per line.
2. **Dependency on P2's `planner/rules`.** P1 adds row fields (`on`, `off`, `spec`), `scopesOf` and the autoText rule.
   If P1 lands first, it creates the module with these semantics and P2 extends it. The integrator merges one table.
3. **Default strengths** (70 / 50 / 50 %) and the tables are first choices, checked with the fake measurer and the ink
   rule. The contact sheets of X.5 confirm them with real fonts before release.
4. **Arrange sizing** stays metric-free (cells). Text set with T1 is a little narrower than the arrange planned, and
   T2/T3 a little wider. Accepted.
5. **Old works stay off** even after an update. That is lead decision 1. A user turns the switches on per work (one
   undo step each).

## P. Interactions with the other packages (summary)

| Package | Interaction | Rule |
|---|---|---|
| P2 M1/M2/T5 | shares `look.gen`, `D.newDoc()` and the `planner/rules` table; P1 adds 4 rows and the `on`/`off`/`spec`/`scopesOf` fields | T5 does not count typesetting as an effect; no package writes kumi pins automatically |
| P3 M3 キメ | giantWhisper opts out of T2; P3 may read `RunLayout.kumi` | P3 writes no kumi pins; a user can set a line to 使わない |
| P4 M4/M5 | one text-service chain in `buildCutWith` (`withFaces` then `withKumi`); per-glyph `em` varies (particles, heads, Latin); kana cells are narrower | morph interpolates `em`; weight animation keeps cells; the weight damp reads the layout weight; P4 may memoise `withFaces` in the same `derived` map |
| P5 T4/S1/S2/S4 | shares `D.newDoc()` (P5 adds its `doc.timing` settings there) | readability counts morae, not metrics: no effect |
| P6 S3 歌ハメ | glyph order and `off` unchanged | P6 does not use the tagger (so no `PLANNER_TEXT` change) |

## Size estimate

About 1,050 lines of source in about 21 files:

| Area | Lines |
|---|---|
| `kumi.js` | ≈ 380 |
| layout | +60 |
| service | +45 |
| build | +15 |
| parts | +15 |
| planner (cast, plan, fields, explain, rules rows) | +90 |
| core | +10, or +40 if P1 lands the P2 marker |
| ui (fields, widgets, inspector) | +80 |
| strings | +25 |
| types | +20 |

Plus about 1,600 lines of tests, fixtures and helpers:
- 8 new or extended node test files;
- 2 fixtures;
- one golden helper;
- the glyph_parity ink check;
- the perf and contact-sheet rows.

Plus about 250 lines of DESIGN, SPEC and NOTES.

---

## Z. Critique log

Each issue from the critic's review, verified against the code at `9a9e950`, and how it was handled.

| # | Sev. | Issue | Verdict | Handling |
|---|---|---|---|---|
| 1 | blocker | P1 used default pins (`newWorkDoc`); P2 and P4 use the marker `look.gen` at the same three sites | **Valid** | Switched to P2's marker (S.0, S.2). Defaults come from P2's `planner/rules` rows (S.3). `newWorkDoc`, `NEW_WORK_PINS` and `SETTING_SLOTS` are removed. `lockPayload` skips the kumi slots (verified: `fields.js:533–535` locks every `isAuto` decision, and `lock.set` runs `checkSlotScope`, `commands.js:361`). `ctx.kumi` joins the cast-cache look key (`plan.js:566`). **One deviation from the critic's fix:** the default decision is `from: 'auto'`, not `'rule'`. In `planner/fields.fieldState`, sources that are all `'rule'` give state `derived` (l.466), which the inspector renders **read-only** (`inspector.js:443`), so the line rows could not be changed. `'auto'` gives state `auto` (自動), and explain still names the rule through `trace.why` (`whyRule.kumi.gen`). Also, a setting that resolves to 0 writes no decision, so gate completeness is testable (X.1 planner_kumi #3). |
| 2 | major | step ③ reads 'done' on a new work (`steps.js:13` `LOOK_PIN` matches `text.`) | Valid under pins | Gone with the marker: a new work has no pins (S.2.9). `LOOK_PIN` is unchanged on purpose: a user's kumi pin is a look choice. ui_data test cases added (X.1). |
| 3 | major | `flow_library` asserts zero pins after import (`ui_flows.py:3607`, pages open `?fresh=1`, l.220); round 1 wrongly said "none found" | Valid under pins | Gone with the marker (S.2.9, X.2). The false claim in round 1's X.2 is corrected. |
| 4 | major | Line rows show no selection while inherited (`fields.sharedPin` l.483–491 → `inherited`; `inspector.js:442` treats only auto/mark as auto) | **Valid** (still happens under a user work pin) | FieldSpec `inheritAuto` on the line rows, with the inspector `stateOf` change (Q.2). Options are now [自動 \| 使う \| 使わない], so a line can be turned on in an old work. Tests in planner_kumi #8, ui_fields and ui_flows. |
| 5 | major | 「固定 3」, pin menu entries and a no-op 「すべて外す」 on a new work (`inspector.js:1079–1185`) | Valid under pins | Gone with the marker: no pins, and 「すべて外す」 now really returns to the default (S.2.7). No `setting` FieldSpec flag is needed. |
| 6 | major | T3 adds a gap after a trailing space (`layout.fontIndices` l.116–126 gives spaces the previous font) | **Valid** (reproduced with `critic_p1/gap.js`) | Content bounds `c0 = u.next[a]`, `c1 = u.prev[b] + 1`: edge spaces are neither scaled nor gapped (T3.4). Verified in `p1r2/ex2.js`: 君 starts exactly where the unscaled space ends. Tests and mutation in T3.7. |
| 7 | major | Tagger 0-FP claim was in-sample; 積もる and 籠もる are false positives | **Valid** (reproduced) | v5 added VETO_NEXT も るれりろ and で すし. **Froze v5** and wrote HELDOUT 3 (128 lines): 4 FP → 97.6 % out-of-sample. v6 fixed those classes (と うれ, VETO_NEXT2 である/にくい). **Froze v6** and wrote HELDOUT 4 (115 lines): 0 FP → 100 % out-of-sample, same author. The precision table now labels in-sample vs out-of-sample (T2.4). Tests split into regression floors, a held-out gate (≥ 0.97) and an independent-set release gate (T2.7). |
| 8 | major | T3 gated per run, so Latin size depends on the arrange (`scatter.js:206` confettiWords per-word runs) | **Valid** | Gate on the source text: the cut text, or `spec.text` for own-text runs. Memoised `KU.hasCjk`, plus `lang !== 'en'` (the builder gives runs the cut's lang, `builder.js:344`) (T3.2). A scene test compares centerAnchor and confettiWords (T3.7). |
| 9 | major | Heads skip hiragana-initial and bracket-initial cuts, contradicting the prototype | **Valid** (the round-1 prototype allowed hira for 'line'; the design text did not) | 行の頭 skips OPENERS and accepts han, kata and hira. 言葉の頭 phrase heads stay han and kata, with the reason given (T2.4). Lists were regenerated by running the prototype (`heads2.js`); the test lists are to be generated from the real module. |
| 10 | minor | TRIM at 100 % overlaps wide kana ink; no ink test | **Valid** | New tier table with a `wide` tier (list + every voiced kana), ink-safe at 100 % (cells 0.86 / 0.90 / 0.70 / 0.66 / 0.92). The kana default rises to 70 % to keep a visible effect (T1.4). New CI gate: glyph_parity check 6 on the system faces at ≤ 0.02 em; a release check on the real web faces (X.2, X.5). |
| 11 | minor | The work switch reads the first cut's value (`fieldState` l.437–460) | **Valid** | At work scope the slots are P2's `'rule'` category: value = work pin or default (S.4). Test in planner_kumi #8. |
| 12 | minor | Sliders visible while off, box 0 vs slider 10 %; `unit: '%'` is not a key | **Valid** (`strings.js:1706` has `unit.pct`) | `when: kumiOn(slot)` through a new `ctx.kumi`, and `unit: 'pct'` (Q.2). |
| 13 | minor | 大きくする字: 自動 duplicates 行の頭; editable while off | **Valid** | `autoValue: 'line'` with [行の頭 \| 言葉の頭 \| 大きくしない] and `when: kumiOn('text.jump')` (Q.2). |
| 14 | minor | Catalogue cases in the wrong file; `ui_fields.test.js:293` section list will fail | **Valid** | Moved to `ui_fields.test.js`; the l.293 edit is named with the exact new list (X.1). |
| 15 | minor | The `PLANNER_TEXT` change is speculative and breaks `build_test.py:269–271` | **Valid** (P6 says it does not need the tagger; P3 calls none) | Dropped. `engine/text/kumi` is engine-only; S.6 lists what a later planner user must change together. |
| 16 | minor | `buildCutWith` chain with P4's `withFaces` would drop one service | **Valid** (P4 M5.4.7) | One chain, `withFaces` then `withKumi`, one `csvc` (S.5). Scene test with both pins (T2.7). |
| 17 | minor | A silent `typeof withKumi` guard could hide a dead feature | **Valid** | The guard is removed; `withKumi` is part of the TextService contract (S.5, S.7). scene_kumi asserts a role ≠ 0, and the golden job refuses to write unless the frames differ from the unmarked document (X.3). |
| 18 | minor | An emphasized Latin word gets 1.15 × 1.10 | **Valid** | `k = max(k, grow)`, the same rule as heads (T3.4). Test and mutation in T3.7. |
| 19 | minor | Per-cut `withKumi` rebuilds a service and re-hashes the faces (`service.js:44–46`) | **Valid** | Memoised derived services (≤ 16) sharing the LRU; P4 may use the same map for `withFaces` (S.5). Memo tests (X.1) and the perf row (X.4). |
| 20 | minor | T1 closes the gaps between phrases too, so words do not read as chunks | **Valid** (optional) | **Adopted.** Chunk seams at phrase-unit starts and after a particle keep half the trim on both kana at the seam (`BOUNDARY = 0.5`). `B.phraseUnits` alone is too coarse on kana text (e.g. 「ひかりのなかで」 is one unit), so seams after particles use the memoised tagger (T1.4). Worked numbers and a mutation test in T1.4 and T1.7. |

Other corrections made while revising:
- The fit-consistency tolerance is now 1e-4, not 1e-6. RunLayout positions are Float32, and the unmodified engine
  already exceeds by 3.05e-5 (`p1r2/sweep_plain.js`).
- The sample-sheet quotations are shortened to excerpts. The test computes the full lists.
