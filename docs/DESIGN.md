# 文字PVメーカー v2 — DESIGN (the build contract)

Status: **frozen for M0**. This is the contract that the work packages in §9 build from in parallel. SPEC.md says *what* the
product does; this file says *how*. If they disagree, SPEC.md wins and this file is fixed by a reviewed PR (§9.4).
Anything marked **FROZEN** can change only through that process. Everything else is guidance the package owner may refine,
as long as the frozen interfaces and the tests in §8 still hold.

Contents

0. Reading guide and conventions
1. Overview and principles (incl. sources and third-party code)
2. Directory layout, module format, layers, load order, build
3. Data model (document, ids, slots, pins, locks, history, plan)
4. Module interfaces (every package)
5. Part catalog to build first
6. UI (geometry, wireframes, control hierarchy, selection, shortcuts, undo)
7. Performance and determinism rules
8. Testing plan
9. Work breakdown (WP0–WP8), milestones, contract changes
10. Open questions

---

## 0. Reading guide and conventions

- **Units.** Time is seconds (float). Design space: short side = 1080 **du** (design units), origin top-left, +x right,
  +y down. Angles are radians inside the engine, degrees in parameter schemas and the UI (`unit: 'deg'`).
- **Names in code** are English camelCase. User-facing text always comes from the string table (§4.24), never from code
  identifiers.
- **"MUST / MUST NOT"** are hard rules that tests or the build check. "Should" is advice.
- **Code blocks** are normative when marked FROZEN; otherwise they are illustrative and the prose wins.
- **Vocabulary.** The engine uses its own kind names. The UI shows the Japanese/English words. Always map with this table:

| Code kind (registry) | UI ja | UI en | What it is |
|---|---|---|---|
| `arrange` | 構図 | Layout | where and how big the words sit (composition) |
| `arrive` | 入り | Entrance | how text appears |
| `dwell` | 見せ | Hold | motion while the text is on screen |
| `depart` | 抜け | Exit | how text leaves |
| `ground` | 背景 | Background | full-frame background, continuous over a segment of cuts |
| `ornament` | 装飾 | Decoration | lines, frames, marks, particles |
| `lens` | カメラ | Camera | push / pan / shake / zoom-on-beat |
| `filter` | 画面効果 | Screen effect | full-frame post effects (RGB split, grain …) |
| `seam` | 切り替え | Transition | the change from one cut to the next |
| `theme` | テーマ | Theme | colors + typefaces + texture |
| `mood` | 雰囲気 | Mood | biases every choice and sets amounts |

Other terms: **row** = one line of the lyric box; **line** = one sung occurrence of a lyric row; **cut** = one shot on
screen (a line gives one or more cuts); **slot** = one automatic choice that can be pinned; **pin** = a fixed value for a
slot; **salt** = a reroll counter; **segment** = a run of cuts that share one background.

---

## 1. Overview and principles

### 1.1 What we build

A static, single-file web app. The user pastes lyrics (optionally loads a song), presses おまかせ, and exports an MP4 of
a lyric motion video. Underneath, every automatic choice is visible and pinnable, down to one decoration of one cut.
The engine is new and original: a **pure planner** turns the document into a **Plan** (all decisions, no pixels, no fonts),
a **scene builder** turns each cut of the Plan into a small **node table plus stateless behaviours**, and a **renderer**
evaluates any time `t` into pixels on Canvas2D. Export is the same renderer called frame by frame.

### 1.2 Pipeline (FROZEN)

```
 Document (JSON, ids, pins)                        ← only changed by Commands through the Store (undo = swap snapshots)
   │ core/lyrics.parseSheet · core/timing.solveTimes          (pure)
   ▼
 Lines with times
   │ planner/plan.plan(doc, {registry})                        (pure; never measures text; no DOM; no fonts)
   ▼
 Plan  ── cuts[] (Decisions per slot) · grounds[] · seams[] · impulses[] · warnings[]
   │ engine/scene/build.buildCut / buildGround                 (needs a Measurer + FontBook; cached by fingerprint)
   ▼
 Scene ── NodeTable (typed-array columns) · Behaviour[] · layers · camera
   │ engine/scene/frame.frameAt(plan, t)  → FrameGraph         (pure in (plan, t))
   │ engine/render/renderer.renderFrame(surface, t)            (behave → solve → draw layers → seam → post)
   ▼
 Surface (Canvas2D) → preview canvas | VideoFrame → VideoEncoder → mp4 muxer | PNG → zip
```

### 1.3 Principles

1. **One mechanism for every automatic choice.** Each choice is a *slot* with a path (§3.4). Its value is: a pin (cut >
   line > work) or the planner's auto pick. Inspector, undo, reroll, lock, おまかせ, AI and tap-sync all read and write the
   same `pins` map through Commands.
2. **The document is the only mutable state.** It changes only through serializable Commands. Undo swaps immutable
   document snapshots. Randomness enters a Command only as a value in its payload (e.g. a new seed).
3. **Deterministic from (document, registry).** Same inputs → same Plan hash in Node and Chrome, and the same frame for the
   same `t` in one browser build with the same fonts. No `Math.random`, clocks, or `Intl.Segmenter` in the engine.
4. **Random access in time.** `frame(t)` never depends on earlier frames. Particles, drifts and flickers are closed-form in `t`.
5. **Plan decides, Scene executes, Frame evaluates.** Only the planner chooses. The scene carries choices out. The renderer
   only evaluates time.
6. **Parts are data plus pure functions**, registered explicitly (no side-effect registration), seen by the engine only
   through the kit (`parts/kit.js`). Adding a part = one definition in one file; it appears in the planner, inspector,
   AI catalog, tests and the lab page with no other code.
7. **Stable identity.** Rows have ids; lines and cuts derive their ids from them (cuts by character offset). Everything
   per-line or per-cut is keyed by these ids, never by index.
8. **DOM-free below the UI.** Everything except `*/host/*` and `ui/*` runs in Node 22 with no DOM.
9. **The preview is never covered** by persistent UI (§6). Only the four-step flow and the play bar are at the top level.
10. **Diagnostics are lazy.** "Why this value" and alternatives are computed on demand (`explain`), never stored in the Plan.
11. **Original by construction** (§1.4): own architecture, own vocabulary, own catalog.

### 1.4 Sources and third-party code (binding for everyone)

v2 is an original work written from `docs/SPEC.md`, this file and general web/graphics/typography knowledge: every
structure here is justified from the spec alone, and part, theme and mood names are v2's own. Third-party code
(mp4-muxer, the AI SDK) stays in `vendor/`, unmodified, behind exactly one adapter each (`export/muxer.js`,
`ai/providers.js`), with its licence notice kept in `THIRD_PARTY_NOTICES.md` and the in-app About page; so are the notices
of the packages bundled into the SDK build (standardwebhooks, @stablelib/base64, fast-sha256).

### 1.5 Where the judges' must-fix items are resolved

| Item | Resolution (section) |
|---|---|
| Chooser reshuffles looks when the catalog grows | Gumbel-max ranking with noise keyed by part key; stability tests (§4.16.4, §8) |
| Sprite vs direct glyph path differs between preview and export | Path chosen from the glyph's pose state only, never from size or output scale; parity test (§4.19.5) |
| Opaque parameter autos | Declarative AutoSpec is the default; function autos are a lint-checked escape hatch with a required `why` (§4.2) |
| SoA behaviours too hard for many authors | `K.moves()`, `K.perGlyph()`, `K.perGlyphHold()` adapters; raw columns only in reviewed parts; lab pose view (§4.18) |
| Fragile cut identity | Cut key = line id + char offset; deterministic remap and reattach rules; orphans listed (§3.3, §4.10) |
| Text that does not fit | Scene-side deterministic fallback + derived `overfull` warning; the Plan never measures (§4.15.6) |
| Diagnostics in the Plan hash | `explain()` is lazy; the Plan stores only value, params and source (§3.12, §4.16.8) |
| Registration by side effect | Part files return plain definitions; `createRegistry(defs)` is explicit (§4.6) |
| Export frame math | `N = ceil(d·fps − 1e-9)`; frame duration = `ts(i+1) − ts(i)`; audio trimmed/padded to exactly N frames (§4.21) |
| Seam ordering/ownership | `planner/tracks.js` owns seams, decided after grounds; pin path `seam` on the receiving cut (§4.16.6) |
| Recency hard zero empties filtered pools | Recency is a soft factor (×0.03); the last remaining candidate is never zeroed (§4.16.4) |
| Pins split across many stores | One flat `pins` map, one resolver, one precedence table incl. timing (§3.5) |
| ◀ ▶ could not step rerolls | Look history entries store `{seed, moodSeed, salts}`; field dice coalesce (§3.7) |
| 4K cost traps (world seams, impulses, filter passes) | Pass budgets, indexed impulses, bounded seam windows (§4.19, §7) |
| Frame-level audio values | Only closed-form lookups into the persisted 20 Hz envelope (§4.13) |
| Lock needs the planner inside a reducer | `lock.set` carries the frozen pins in its payload, computed by the UI command from the current Plan (§3.6) |
| Two sources of line start times | Precedence pin > LRC stamp > auto; tap/AI/drag always write pins; text is never rewritten by timing (§3.5) |
| Small preview at 1280 with 詳細 open | Auto-fold of the step column to its rail (888×499) (§6.2) |
| Look history flooding / meaning | Which actions append, coalescing of field dice, ★, scope labels, derived pointer rules (§3.7, §6.7) |
| AI review vs inspector column | During a review, selection only highlights; 詳細 is disabled until Apply/Discard (§6.4.10) |
| Lyric list outside step ① | Documented and tested alternative paths (§6.5) |
| Slot meaning of decor[i]/fx[i] across scopes | Index rules and "pinned part forces the slot to exist" (§3.4.3) |
| No mouse path to 作品全体 詳細 | `[詳細]` toggle in the header (§6.4.1) |
| First-run R/Space typing into the editor | Focus moves to おまかせ after the first paste; editor-safe chords (§6.9) |
| Alt+click conflict | Alt+click without movement cycles hits; Alt during a drag disables snapping (§6.5) |
| Toast placement | Toast host rules per layout and mode (§6.4.11) |
| Geometry numbers must reconcile | One formula (§6.2), table generated from it, test ±1 px (§8) |

---

## 2. Directory layout, module format, layers, load order, build

### 2.1 Tree (FROZEN at directory level; files are listed with owners in §9)

```
<repository root>/
  README.md  README.en.md  LICENSE  THIRD_PARTY_NOTICES.md
  docs/                            # SPEC.md  DESIGN.md  NOTES.md  AI_GUIDE.md
  build.py                         # stdlib-only Python 3.10+: lint, layer check, topo sort, inline, CSP, pages, --lab, --check
  index.html  en/index.html        # BUILD OUTPUT (committed; CI checks that it matches the build)
  vendor/                          # mp4-muxer.min.js  ai-sdk.min.js  and their licence texts
  dev/browser.py                   # the shared Playwright launcher of the browser tests
  tools/vendor/                    # rebuilds vendor/ai-sdk.min.js (npm, run by hand only)
  src/
    core/                          # L0 pure: kernel, math, schema, paths, pins, doc, store, registry, script, lyrics, timing, commands
    i18n/                          # L1 pure: strings table + t()
    engine/
      text/                        # L1 pure: vertical rules, breaker, layout, fit, faces, fake measurer, text service
      scene/                       # L3 pure: node table, builder, behaviours, stagger, build, cache, frame
      render/                      # L3 pure (injected canvas): surfaces, sprites, shapes, draw, post, seams, pick, record, renderer
      facade.js                    # L5 engine facade (plan + scenes + renderer)
      host/                        # L6 browser: canvas factory, canvas measurer, font book
    planner/                       # L2 pure: features, segment, choose, params, look, cast, tracks, plan, explain, fields, diff
    parts/                         # L3 kit.js; L4 <kind>/*.js definitions; catalog.js
      kit.js  catalog.js
      arrange/ arrive/ dwell/ depart/ ground/ ornament/ lens/ filter/ seam/ theme/ mood/
    audio/                         # L1 pure: analyze, fft, digest, wav, peaks; host/: decode, player (L6)
    export/                        # L5 pure: schedule, zip, muxer adapter; host/: mp4, png, sink (L6)
    ai/                            # L5: providers (fetch injected), lyricio, catalog, prep, looks, song, changes
    ui/                            # L7 browser: shell, stage, inspector, AI panel …; some files are pure (Node-tested)
      style.css
  tests/
    helpers/ load.js  assert_plus.js  fake_engine.js  corpus.js
    fixtures/ project_basic.json  project_vertical.json  project_lrc.json  project_long.json
              plan_basic.json  song_digest.json  stub_parts.js  sample_lyrics.txt
    golden/  plan_hashes.json  frame_hashes.json        # updated only on purpose (script: tests/update_golden.js)
    node/    *.test.js                                  # node --test tests/node
    browser/ *.py                                       # Playwright via dev/browser.py
    www/     lab.html (build output, not shipped)  export_check.js (harness of export_check.py)
    build_test.py  update_golden.js
```

Vendor files: `vendor/mp4-muxer.min.js` (defines global `Mp4Muxer` with `Muxer`, `ArrayBufferTarget`,
`StreamTarget`, `FileSystemWritableFileStreamTarget`) and `vendor/ai-sdk.min.js` (defines the SDK global that `ui/boot`
hands to `ai/providers.setSDK()`).

### 2.2 Module format (FROZEN)

Every `.js` file under `src/` is exactly one module definition on the global namespace object `MV`:

```js
/* 文字PVメーカー v2 — original work. <one-line purpose> */
MV.def('planner/cast', ['core/rng', 'core/schema', 'planner/choose'], (rng, schema, choose) => {
  'use strict';
  function castCut(skel, feat, ctx) { /* … */ }
  return { castCut };
});
```

Rules:
- Module id = path under `src/` without `.js`; lowercase `[a-z0-9_]` segments separated by `/` (file names use `_`).
- The dependency list is an array of **string literals** only. Factories receive the dependencies' exports in order.
- Factories MUST NOT touch browser globals, read time, or do work with side effects when they run; they only define and
  return functions/data. (Host modules may reference browser APIs *inside* functions.)
- No `import`/`export`, no `require`, no `eval`, no `new Function`, no dynamic code.
- A module returns a plain object (frozen by the kernel in dev builds) or, for part files, an **array of part definitions**.

The kernel `src/core/define.js` is the only file not wrapped in `MV.def`. **FROZEN code:**

```js
/* 文字PVメーカー v2 — original work. Module kernel: MV.def / MV.use / MV.ids. */
(function (G) {
  'use strict';
  const MV = G.MV || (G.MV = {});
  const defs = new Map(), done = new Map(), busy = new Set();
  const ID = /^[a-z0-9_]+(\/[a-z0-9_]+)*$/;
  MV.def = (id, deps, factory) => {
    if (!ID.test(id)) throw new Error('MV: bad module id ' + id);
    if (defs.has(id)) throw new Error('MV: duplicate module ' + id);
    if (!Array.isArray(deps) || typeof factory !== 'function') throw new Error('MV: bad definition ' + id);
    defs.set(id, { deps: deps.slice(), factory });
  };
  MV.use = (id) => {
    if (done.has(id)) return done.get(id);
    const d = defs.get(id);
    if (!d) throw new Error('MV: missing module ' + id);
    if (busy.has(id)) throw new Error('MV: dependency cycle at ' + id);
    busy.add(id);
    const out = d.factory(...d.deps.map(MV.use));
    busy.delete(id);
    done.set(id, MV.DEV && out && typeof out === 'object' ? Object.freeze(out) : out);
    return done.get(id);
  };
  MV.ids = (prefix = '') => [...defs.keys()].filter((k) => k.startsWith(prefix)).sort();
  MV.has = (id) => defs.has(id);
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

`MV.DEV` is `true` in Node tests and in the lab page, `false` in the shipped pages. `MV.LANG` is `'ja'` or `'en'`, set by the
page. Nothing else may be attached to `MV` except by `ui/boot.js` (it sets `MV.app` for the test hook).

### 2.3 Layers and allowed dependencies (FROZEN; `build.py` enforces)

| Layer | Modules | May depend on |
|---|---|---|
| L0 | `core/*` | L0 |
| L1 | `i18n/*`, `engine/text/*`, `audio/*` (not `audio/host`) | L0, L1 (same directory or `core`) — `engine/text` may not use `audio`, and vice versa |
| L2 | `planner/*` | L0, L1 (`engine/text/*` only for metric-free functions: `breaker`, `vert` classes, `faces.resolveFaces`) |
| L3 | `engine/scene/*`, `engine/render/*`, `parts/kit` | L0, L1, L2 **types only** (no planner functions) |
| L4 | `parts/<kind>/*` | **only `parts/kit`** |
| L4 | `parts/catalog` | `core/registry`, and it reads part modules with `MV.ids('parts/')` |
| L5 | `engine/facade`, `export/*` (not host), `ai/*` | L0–L4 |
| L6 | `engine/host/*`, `audio/host/*`, `export/host/*` | L0–L5 |
| L7 | `ui/*` | everything |

Additional rules: no cycles; no module below L7 depends on `ui/*`; `planner/*` MUST NOT depend on `engine/scene` or
`engine/render`; host modules are only depended on by L6/L7 (the facade receives host services by injection).

### 2.4 Lint rules (FROZEN; build error on match; comments and string contents are skipped where noted)

| Where | Forbidden |
|---|---|
| everywhere | `eval(`, `new Function`, `import(`, `^import `, `^export `, `require(`, `.innerHTML`, `.outerHTML`, `insertAdjacentHTML`, `document.write`, `setAttribute('style'`, `setAttribute("style"`, ` on[a-z]+=` inside HTML strings, `with (` |
| L0–L5 except `ai/*` | `Math.random`, `Date.now`, `new Date`, `performance.now`, `Intl.Segmenter`, `setTimeout`, `setInterval`, `requestAnimationFrame`, `document`, `window`, `navigator`, `localStorage`, `sessionStorage`, `indexedDB`, `fetch(` |
| `ai/*` | `Math.random`, `document`, `window`, `localStorage`, `sessionStorage`, `indexedDB` (fetch/SDK are injected; `setTimeout` allowed for upload polling) |
| `parts/<kind>/*` | any dependency other than `parts/kit`; `ctx.filter` assignments; `getImageData`, `putImageData`; module-level mutable state (`let` at factory top level) |
| `engine/render/*` | `getImageData`, `putImageData` |
| function-form autos in parts | the function body may reference only its parameters (`f`, `rng`, `look`) and kit helpers (checked by a token scan) |

Every file MUST start with the header comment `/* 文字PVメーカー v2 — original work. … */`.

### 2.5 Load order for concatenation (FROZEN)

`build.py` emits one app `<script>` whose content is, in this order:

1. `src/core/define.js`, followed by `MV.DEV=false;MV.LANG='ja';` (or `'en'`).
2. Every other module, **topologically sorted** by its dependency list; ties broken by (layer number, module id). Because
   factories run lazily on `MV.use`, the order only has to put `define.js` first — the sort makes the output deterministic
   and puts each module after its dependencies for readability.
3. The boot line: `MV.use('ui/boot').start();`

Vendor scripts come **before** the app script, each in its own `<script>` element, unmodified, with their license banners:
first `vendor/mp4-muxer.min.js`, then `vendor/ai-sdk.min.js`.

### 2.6 `build.py` (FROZEN behaviour)

```
python3 build.py            # writes index.html and en/index.html
python3 build.py --check    # lint + layers + topo only; exit 1 on any problem; writes nothing
python3 build.py --lab      # also writes tests/www/lab.html (MV.DEV=true; boots 'ui/lab' instead of 'ui/boot')
```

1. Collect `src/**/*.js` and `src/ui/style.css`. For each `.js` except `define.js`, parse the header with
   `^MV\.def\(\s*'([^']+)'\s*,\s*\[([^\]]*)\]` after the leading comment; the id MUST equal the path; deps must be
   string literals. Exactly one `MV.def(` per file.
2. Run the lint rules (§2.4) and the layer rules (§2.3). Report every problem as `path:line: rule` and exit 1.
3. Topologically sort (Kahn's algorithm, ties by (layer, id)). A missing dependency or cycle is an error.
4. Emit each page:
   ```html
   <!doctype html><html lang="ja"><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width,initial-scale=1">
   <meta http-equiv="Content-Security-Policy" content="…">
   <title>文字PVメーカー</title><style>…style.css…</style></head>
   <body><div id="app"></div>
   <script>…vendor/mp4-muxer.min.js…</script><script>…vendor/ai-sdk.min.js…</script><script>…app…</script></body></html>
   ```
   (`en/index.html`: `lang="en"`, `<title>Moji PV Maker</title>`, `MV.LANG='en'`.)
5. CSP (one line, FROZEN): `default-src 'none'; script-src 'sha256-A' 'sha256-B' 'sha256-C'; style-src 'sha256-S'
   https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src https://generativelanguage.googleapis.com
   https://<API host of the second AI service>; img-src data: blob:; media-src blob:; worker-src 'none'; base-uri 'none'; form-action 'none'`.
   Hashes are base64 SHA-256 of each inline element's exact text. (`worker-src` changes to `blob:` only when a Worker ships.)
6. Output is byte-identical for identical inputs (no timestamps; stable ordering; `\n` line endings; UTF-8).
7. The UI MUST set styles only via CSSOM (`el.style.prop = …`, `el.classList`), which the CSP allows.

### 2.7 Node loading (FROZEN)

`tests/helpers/load.js` exports `load()`: it `require`s `src/core/define.js`, sets `MV.DEV = true`, `MV.LANG = 'ja'`, then
`require`s every `src/**/*.js` file (sorted by path; `ui/*` included — factories are lazy, and pure UI modules are tested),
and returns `globalThis.MV`. Tests then `MV.use('core/lyrics')` etc. `node --test` runs each test file in its own process,
so module state never leaks between files. Node 22+, no npm dependencies for Node tests.

---

## 3. Data model

### 3.1 The saved file (FROZEN shape, schema 1)

A project file and the autosave record are the same JSON. `doc` is undoable; `side` is persisted but not undoable.

```json
{
  "format": "mojipv.project",
  "schema": 1,
  "doc": {
    "meta": { "app": "2.0.0", "lang": "auto" },
    "sheet": {
      "next": 9,
      "rows": [
        { "id": "r1", "src": "[ti:夜明けのうた]" },
        { "id": "r2", "src": "[ar:サンプル]" },
        { "id": "r3", "src": "夜明けの/*街*を走る" },
        { "id": "r4", "src": "まだ遠い空の|そら" },
        { "id": "r5", "src": "" },
        { "id": "r6", "src": "# サビ" },
        { "id": "r7", "src": "[00:41.20][01:32.00]君の名前を/呼ぶ声が" },
        { "id": "r8", "src": "届くまで!" }
      ]
    },
    "timing": { "snap": "beat", "lead": 0.12, "tail": 0.25, "leadIn": 1.0, "outro": 2.0, "tapLatency": 0.06 },
    "song": {
      "name": "demo.m4a", "sha1": "3f2a9c…", "seconds": 214.6,
      "bpm": 128.0, "offset": 0.214, "meter": 4, "bpmConfidence": 0.82,
      "digest": { "hz": 20, "loud": "AAECBAgQ…" },
      "info": null
    },
    "look": { "seed": 918273645, "moodSeed": 44120771, "aspect": "16:9", "backdrop": "scene" },
    "pins": {
      "work:mood":                         { "v": "quietHush", "by": "user" },
      "work:color.accent":                 { "v": "#C2413A", "by": "ai" },
      "work:amount.glitch":                { "v": 0, "by": "user" },
      "line/r7:arrange":                   { "v": "giantWhisper", "by": "ai" },
      "line/r4:start":                     { "v": 12.5, "by": "tap" },
      "cut/r3~4:arrive.each":              { "v": 0.05, "by": "user", "sig": "街を走る" },
      "cut/r3~0:el.text.nudge":            { "v": { "dx": 0, "dy": -24, "rot": 0, "s": 1 }, "by": "user", "sig": "夜明けの" },
      "line/r8:split":                     { "v": [0], "by": "lock" },
      "cut/r8~0:arrange":                  { "v": "pillarColumns", "by": "lock", "sig": "届くまで" },
      "cut/r8~0:arrange@pillarColumns.cols": { "v": 1, "by": "lock", "sig": "届くまで" }
    },
    "salts": { "line/r4": 2, "cut/r3~0": 1, "cut/r3~0:depart": 1 },
    "locks": { "r8": { "n": 23 } },
    "filters": { "seam": { "only": ["hardCut", "blendDissolve", "irisGate"], "deny": null },
                 "filter": { "only": null, "deny": ["sliceGlitch"] } },
    "output": { "format": "mp4", "short": 1080, "fps": 30, "quality": "high", "audio": true, "range": null, "name": null }
  },
  "side": {
    "looks": {
      "list": [
        { "n": 1, "seed": 11, "moodSeed": 7, "salts": {}, "scope": "work", "label": ["look.first", {}], "star": false },
        { "n": 2, "seed": 918273645, "moodSeed": 44120771, "salts": {}, "scope": "work", "label": ["look.omakase", {}], "star": true }
      ],
      "cap": 50
    },
    "aiLog": []
  }
}
```

### 3.2 Field-by-field notes

- `format`, `schema`: `core/migrate.js` upgrades older schemas step by step; a newer schema than the app knows is refused
  with a clear message (UI: 「新しいバージョンで作られた作品です」). Unknown keys inside `doc` are preserved on save.
- `doc.meta.lang`: `'auto'` or a forced lyric language (`ja|en|zhHant|zhHans|ko`) for all lines.
- `doc.sheet.rows`: the lyric box, one entry per text line, in order. `id` is `'r' + base36 counter`; ids are **never
  reused** (`next` only grows). `src` is the raw text of that line exactly as typed (including marks and LRC stamps).
  The lyric box shows `rows.map(r => r.src).join('\n')`. There is no second copy of title/artist: they live in
  `[ti:]`/`[ar:]` rows.
- `doc.timing` (plain settings, never auto): `snap` `'off'|'beat'|'half'|'bar'` (snap auto line starts and cut boundaries
  to the beat grid), `lead` (entrance starts this many seconds before the sung start), `tail` (the exit may run this long
  past the next cut's start), `leadIn` (first auto line start when nothing anchors it), `outro` (seconds after the last
  line when no song), `tapLatency` (subtracted from tap times).
- `doc.song`: metadata only — audio bytes live in IndexedDB keyed by `sha1` and are never in the JSON. `bpm`, `offset`,
  `meter`, `bpmConfidence` are the **analysis results** (the auto values of the `bpm`/`beatOffset` slots). `digest` is the
  loudness envelope at 20 Hz as base64 of a `Uint8Array` (0..255): it lets the planner and frame-level audio reactions work
  identically before the audio is re-decoded. `info` is the AI song analysis (§4.22) or `null`.
- `doc.look`: `seed` drives layout/motion choices; `moodSeed` drives the auto mood and theme. `aspect` ∈ `16:9 9:16 1:1 4:5
  4:3 3:4 21:9`. `backdrop` ∈ `scene` (normal), `chroma` (green screen), `black` (white text on black), `clear` (transparent;
  PNG export only).
- `doc.pins`: map from a **slot path** (§3.4) to `{ v, by, sig? }`. `by` ∈ `user | ai | tap | lock`. `sig` is the piece text
  (marks removed) of the cut when the pin was made; present on every `cut/…` pin; used for reattachment (§4.10).
- `doc.salts`: reroll counters (positive integers) keyed by a scope (`line/r4`, `cut/r3~0`) or a scope plus slot
  (`cut/r3~0:depart`, `line/r4:arrive`).
- `doc.locks`: `{ [lineId]: { n } }` marks a locked line (`n` = store revision when locked, for display). The frozen values
  are ordinary pins with `by: 'lock'` (§3.6).
- `doc.filters`: "use only these parts". Per kind (`arrange arrive dwell depart ground ornament lens filter seam theme`):
  `only` (allow-list or `null`) and `deny` (block-list or `null`). Applies to auto picks only; pins win (with a warning).
- `doc.output`: export settings: `format` `mp4|png|pngAlpha`, `short` `720|1080|1440|2160` (short side in px), `fps`
  `24|30|60`, `quality` `standard|high|max`, `audio` bool, `range` `{t0,t1}` or `null`, `name` file name or `null`.
- `side.looks`: the look history (§3.7). `side.aiLog`: applied AI runs for selective revert (§4.22.5).

### 3.3 Ids and scopes (FROZEN)

| Thing | Id | Example | Rule |
|---|---|---|---|
| Row | `r` + base36 | `r7` | assigned by `reconcile` (§4.10); never reused |
| Line | row id, plus `.k` for the k-th extra LRC stamp (k ≥ 1) | `r7`, `r7.1` | a row with stamps `[a][b]` is sung twice |
| Cut | `<lineId>~<offset>` | `r3~0`, `r3~4`, `r7.1~5` | offset = UTF-16 index in the line's **plain text** (marks removed) where the piece starts |
| Title card | `title` | | only when a title card is shown |
| Intro | `intro` | | lead-in before the first line when there is no title card |
| Interlude | `gap/<lineId>` | `gap/r8` | the long gap after that line |
| Outro | `outro` | | after the last line |
| Segment | `g<first cut key>` | `gr3~0` | background segments (§4.16.6); not pinnable by id |

Scopes: `work`, `line/<lineId>`, `cut/<cutKey>`. A cut belongs to one line (special cuts belong to none); a line belongs to
the work. Pins cascade **cut > line > work**.

### 3.4 Slot paths (FROZEN grammar)

```
path     := scope ':' slot
scope    := 'work' | 'line/' LINEID | 'cut/' CUTKEY
LINEID   := 'r' [0-9a-z]+ ( '.' [1-9][0-9]* )?
CUTKEY   := LINEID '~' [0-9]+ | 'title' | 'intro' | 'outro' | 'gap/' LINEID
slot     := KIND ( '#' IDX )? ( '@' PARTKEY )? ( '.' PARAM )?      -- part choice and its parameters
          | 'el.' OWNER '.' FIELD                                   -- element fine pins
          | NAME ( '.' NAME )*                                      -- every other slot (see tables)
KIND     := arrange | arrive | dwell | depart | ornament | lens | filter | ground | atmos | seam | texture
IDX      := 0 | 1 | 2
OWNER    := text | ornament#0 | ornament#1 | ornament#2
FIELD    := nudge | fill | hide
PARTKEY  := [a-z][A-Za-z0-9]{2,31}
PARAM    := [a-z][A-Za-z0-9]{0,31}                                  -- never contains '.' '#' '@'
```

The parser reads the first token of `slot` up to `#`, `@` or `.`: if it is a KIND the part grammar applies, otherwise the
NAME grammar. `ornament.count` and `filter.count` are the reserved PARAM `count` of list kinds. `core/paths.js` implements
`parse`, `format` (exact inverse), `scopeKey`, `isUnder` and the helpers of §4.3.

Parameters are addressed two ways:
- **Shared parameters** (defined for every part of a kind, table below) use `kind.param`, e.g. `cut/r3~0:arrive.dur`. They
  survive a change of part.
- **Part parameters** use `kind@partKey.param`, e.g. `cut/r3~0:arrive@hingeFlip.depth`. They apply only while that part is
  chosen; otherwise the inspector shows them as *inactive* (never deleted silently).
- List slots add the index: `cut/r3~0:ornament#1@hankoSeal.size`, `cut/r3~0:ornament#1.amount`.

Shared parameters per kind (FROZEN names; each part may narrow the range or change the auto, never remove them):

| Kind | Shared params |
|---|---|
| arrange | `offsetX`, `offsetY` (−0.4–0.4 frame fractions; size comes from the `text.scale` slot) |
| arrive, depart | `dur` (s), `each` (stagger s), `order` (enum ORDERS §4.17.4), `ease` (enum EASES §4.1) |
| dwell | `amount` (0–1), `speed` (0.25–4, ×) |
| ornament (#i) | `amount` (0–1), `ink` (token) |
| lens | `amount` (0–1) |
| filter (#i) | `amount` (0–1), `when` (`always|arrive|beat|impact|depart`) |
| ground, atmos | `amount` (0–1) |
| seam | `dur` (0.15–1.2 s) |

#### 3.4.1 Slot catalogue: work scope only

| Slot | Value | Auto (when not pinned) |
|---|---|---|
| `mood` | mood key | planner/look: lyric features + song info + `moodSeed` (§4.16.3) |
| `theme` | theme key | mood's theme weights, season gate, `moodSeed` |
| `season` | `any|none|spring|summer|autumn|winter` | keywords in the lyrics (§4.16.3), else `any` |
| `color.<token>` | `#RRGGBB`; tokens `ground ground2 ink accent shiftA shiftB muted` | theme swatch, then contrast fit |
| `face.<role>.<script>` | family name; roles `display serif body`; scripts `ja latin ko zhHant zhHans` | theme faces + flavor table (§4.14) |
| `face.<role>.weight` | 100–900 | theme |
| `amount.<key>` | 0–1; keys `motion glitch chroma ornament density texture groundSwitch flash shake camera pace` | mood amounts |
| `texture` | a `filter` key with `texture: true`, or `none` | theme texture if `amount.texture > 0` |
| `bpm` | 40–240 or `null` | `song.bpm` (analysis) |
| `beatOffset` | seconds | `song.offset` |
| `readRate` | morae per second, 3–14 | `clamp(bpm / 20, 3, 14)` (≈ 3 morae per beat) when a BPM is known, else 7 (§4.11) |
| `length` | seconds | song length, else last line end + `timing.outro` |
| `titleCard` | boolean | `true` when a title is set and the first line starts ≥ 1.5 s; automatic timing keeps 2 s for the card when no line has a start anchor (§4.11, SPEC §6) |

#### 3.4.2 Slot catalogue: line scope only

| Slot | Value | Auto |
|---|---|---|
| `start`, `end` | seconds | LRC stamp in the text (start only), else the timing solver (§4.11) |
| `split` | `'none'` or sorted offsets starting with 0 | `/` marks, else the auto cutter (§4.16.5) |
| `lang` | `ja en zhHant zhHans ko` | per-line script detection |

#### 3.4.3 Slot catalogue: cut slots (pinnable at cut, line or work scope; cascade cut > line > work)

| Slot | Value | Notes |
|---|---|---|
| `orient` | `h|v` | allowed values come from the text (`feat.orients`) |
| `arrange` (+params) | arrange key | must serve the cut's role; otherwise the pin is skipped for that cut |
| `text.face` | `display|serif|body` | |
| `text.scale` | 0.5–2 | multiplies the arrange's size |
| `text.ink` | token or `#RRGGBB` | emphasis ink stays `accent` unless `el.text.fill` is pinned |
| `text.style` | `plain|outline|shadow|glow|duo` | default from the theme |
| `arrive`, `dwell`, `depart` (+params) | part key | |
| `ornament.count` | 0–3 | |
| `ornament#i` (+params) | ornament key (cut scope) or `none` | pinning `ornament#i` to a part raises the resolved count to ≥ i+1 in that scope; pinning `none` hides that slot (count unchanged) |
| `lens` (+params) | lens key | |
| `filter.count` | 0–3 | |
| `filter#i` (+params) | filter key or `none` | same index rule as ornaments |
| `ground` (+params) | ground key | resolved per segment (§4.16.6): a cut pin splits the segment around that cut |
| `atmos` (+params) | ornament key with `scope: 'run'`, or `none` | per segment, like `ground` |
| `seam` (+params) | seam key | the transition **into** this cut (decided by `planner/tracks.js`) |
| `t0` | seconds | cut scope only, not on the first cut of a line: the inner boundary time |
| `el.<owner>.nudge` | `{dx, dy, rot, s}` (du, du, deg, ×) | added to the owner's base pose at scene build |
| `el.<owner>.fill` | token or `#RRGGBB` | replaces the owner's ink |
| `el.<owner>.hide` | boolean | owner not built |

A pin at line or work scope applies to every cut it covers **where it is applicable** (the part serves the role, the
index exists after the count rule, the param exists on the chosen part). A cut-scope pin that is not applicable produces
a warning (`pin-not-applicable`); line/work pins are silently skipped where they do not apply.

### 3.5 Pin values and precedence (FROZEN)

Resolution of any slot path at a cut (implemented once, in `core/pins.js`, used by the planner, the inspector and the AI):

| Rank | Source | Stored as | Survives おまかせ / reroll / ◀ ▶ | Shown as |
|---|---|---|---|---|
| 1 | cut pin | `pins['cut/<key>:<slot>']` (`by` user/ai/lock) | yes | 固定 / AIで固定 / ロック中 |
| 2 | line pin | `pins['line/<id>:<slot>']` | yes | 行で固定 ↑ |
| 3 | work pin | `pins['work:<slot>']` | yes | 作品で固定 ↑ |
| 4 | text mark | `/` (split), `[mm:ss.xx]` (start) in the row text | yes | 記号 (LRC / 区切り) |
| 5 | auto | planner / timing solver, subject to filters and season | no | 自動 |

Timing uses the same table: `line/<id>:start` pinned (by `tap`, `ai` or `user`) beats the LRC stamp in the text, which beats
the solver. Tap-sync, AI alignment, timeline drags and number fields **always write pins**; they never rewrite the text.
Deleting such a pin (Del) reveals the LRC stamp again. LRC stamps are changed only by editing the text, and are written
from effective times only on explicit export (`≡ › 時間つき歌詞（.lrc）を保存`) or `≡ › 時刻を歌詞に書き込む`
(a `lyrics.set` that bakes all effective starts into stamps and clears the start pins, one undo step).

Emphasis `*…*`, impact `!` and notes `|…` exist only as marks in the text (they have no auto value, so they are not slots).

Pinned values are coerced through the target's schema (clamped, stepped, enum-checked). An invalid value (unknown part key,
wrong type) is ignored with the warning `pin-bad-value` and the slot falls back to the next rank.

### 3.6 Locks (FROZEN)

- **Lock a line** = `{ t: 'lock.set', lineId, pins }`. The UI command builds `pins` from the **current Plan**: for every cut
  of the line, every resolved cut-slot value that is not already a pin (source `auto`, `rule` or `fallback`: part choices,
  their parameters, counts, `orient`,
  `text.*`, `seam` into the cut) becomes `cut/<key>:<slot>` with `by: 'lock'` and `sig`, plus `line/<id>:split` with the
  current offsets. The reducer only writes what is in the payload (it never calls the planner) and adds `locks[lineId]`.
- Colors, faces, amounts and times are **not** frozen: the locked line still follows the theme and the timing.
- Because lock values are cut pins (rank 1), a locked line is immune to おまかせ, rerolls, ◀ ▶, work pins and line pins.
  Editing a locked value in the inspector replaces that one pin with `by: 'user'`. A new **line-scope** user pin on a locked
  line also removes the `by: 'lock'` pins of that slot in the line's cuts (so the user's line pin takes effect).
- **Unlock** = `{ t: 'lock.clear', lineId }` removes every `by: 'lock'` pin under the line and `locks[lineId]`. User pins stay.
- Reroll buttons are disabled for locked lines.
- Editing the text of a locked line: pins remap by offsets (§4.10); if the frozen split no longer fits the text it is
  dropped (auto split) and the planner warns `lock-partial`.

### 3.7 Seeds, salts, おまかせ, look history (FROZEN)

- Streams (§4.1.3) are derived from `look.seed` (parts and parameters), `look.moodSeed` (mood and theme), the cut key, the
  slot name, and the salts that apply. A salt bump changes only the streams under that key.
- **おまかせ** (`look.omakase {seed, moodSeed}`): the UI draws candidates with `crypto.getRandomValues` and keeps the first
  pair whose auto mood differs from the current auto mood (checked with `planner/look.previewMood(doc, moodSeed)`, at most
  16 tries). Pins, locks, filters and salts are untouched. `Shift+R` at the root = `look.seed` only (same mood/theme).
- **Reroll** = `salt.bump` on `line/<id>`, `cut/<key>` or `<scope>:<slot>` (field dice).
- **Look history** lives in `side.looks.list`, outside undo:
  - Entry = `{ n, seed, moodSeed, salts, scope, label, star }`; `salts` is the complete salts map at that moment.
  - **Appends**: おまかせ, root reroll, line reroll, cut reroll, AI "この案にする" (after apply), and the first plan of a
    new project. **Field dice** (`<scope>:<slot>` salts) *replace* the newest entry when that entry was also field dice at
    the same cut/line scope; otherwise they append.
  - Cap `side.looks.cap` (50) non-starred entries; the oldest non-starred entry is dropped first. Starred (★) entries stay.
  - **Pointer (derived)**: the newest entry whose `(seed, moodSeed, salts)` equals the current document's; if none, the
    pointer is "modified" (UI shows `●/m` with tooltip 「今の見た目は履歴にありません（固定や手動の変更のあと）」); ◀ then
    goes to the newest entry, ▶ is disabled.
  - **◀ / ▶** dispatch `look.restore {seed, moodSeed, salts}` (undoable). Pins are never part of a look, so ◀ ▶ never
    unpins anything.
- Undoing an おまかせ restores `seed/moodSeed/salts`, so the derived pointer moves back by itself.

### 3.8 Filters and season

- A candidate part is eligible for auto picks when it passes `filters[kind].only` (if set) and `deny` (if set), and the
  season gate: season `any` → all parts (seasonal parts weighted ×0.5 when they are the theme's own season, else
  ×0.25); a season → non-seasonal parts plus that season's parts (×1.5); `none` → non-seasonal parts only. Themes follow
  the same gate (seasonal themes ×0.5 under `any`).
- The UI never lets `only` become empty (the last checkbox refuses). If the pool is still empty (e.g. every part fails the
  text traits), the planner relaxes traits, then uses the kind's `fallback` part and warns `pool-empty`.

### 3.9 Commands (FROZEN payloads; reducers in `core/commands.js`)

All commands are plain JSON. Reducers are pure: `reduce(doc, cmd) → doc'` with structural sharing; they never call the
planner, never read time, never generate randomness.

| Command | Payload | Effect |
|---|---|---|
| `lyrics.set` | `text` | reconcile row ids (§4.10); remap `cut/…` pins/salts of edited lines by offset map; delete pins, salts, locks of removed lines |
| `lyrics.row` | `rowId, src` | replace one row's text (inspector marks, inline edit, AI single-line edits); same remapping for that row |
| `lyrics.move` | `rowIds, beforeRowId` (`null` = end) | move rows (Alt+↑/↓) |
| `meta.set` | `title?, artist?` (`null` removes) | rewrite / insert (at the top) / remove the `[ti:]` `[ar:]` rows |
| `pin.set` | `path, v, by, sig?` (`sig` required for `cut/…` paths; the UI gets it from `planner.pinSig`) | set a pin (line-scope user pin on a locked line also removes that slot's lock pins, §3.6) |
| `pin.clear` | `path` | remove a pin |
| `pin.clearUnder` | `scope, by?` | remove all pins under `work`, `line/<id>` or `cut/<key>` (optionally only `by`); never removes `lock` pins |
| `pin.promote` | `path, to` (`line`/`work`) | move the pin one scope up; cut pins of sibling cuts are kept |
| `pin.copy` | `from, to[], sigs` (`sigs` = `{cutKey: sig}` for cut targets) | copy slot pins (not timing, not `el.*`) from one scope to others (paste look) |
| `salt.bump` | `key` | `salts[key] = (salts[key] or 0) + 1` |
| `look.omakase` | `seed, moodSeed` | set both seeds |
| `look.seed` | `seed` | set `look.seed` |
| `look.restore` | `seed, moodSeed, salts` | set both seeds and replace `salts` |
| `look.set` | `key` (`aspect`/`backdrop`), `v` | |
| `lock.set` | `lineId, pins` | replace that line's lock pins with `pins` (all `by: 'lock'`), set `locks[lineId]` |
| `lock.clear` | `lineId` | remove lock pins and the mark |
| `filter.set` | `kind, only, deny` | |
| `time.shift` | `lineIds, delta, base` | `base` = `{lineId: {start, end}}` effective times from the plan; pins `start`/`end` = base + delta |
| `time.tap` | `marks: [{lineId, start?, end?}]` | pins by `tap` |
| `timing.set` | `key, v` | `doc.timing[key] = v` |
| `song.set` / `song.clear` | `song` / — | set or remove `doc.song` (and its `digest`) |
| `song.info` | `info` | set `doc.song.info` |
| `output.set` | `key, v` | |
| `batch` | `cmds` | apply in order (created by `store.batch`) |

### 3.10 History and undo (FROZEN semantics; store in `core/store.js`)

- The store keeps `doc` (deep-frozen in dev) and `side`. `dispatch(cmd, meta)` computes `doc' = reduce(doc, cmd)`; if
  `doc' === doc` nothing is recorded. Otherwise it records `{ before, after, label, where, mergeKey, selBefore, selAfter, n }`.
- Undo sets `doc = before`; redo sets `doc = after`. O(1) and exact, including row ids and `next`.
- Coalescing: a dispatch with the same `mergeKey` as the newest entry, within an open `gesture(mergeKey)` or within 2 s of
  it (for typing), updates that entry's `after` instead of adding one.
- One entry per: click edit; slider/drag gesture (pointerdown→pointerup); a typing burst in the lyric editor (sealed after
  600 ms idle, Enter, blur or any other command); paste; tap session; おまかせ / reroll / ◀ ▶; AI apply; lock toggle; LRC
  import; multi-selection edit; pin promote; "すべて自動に戻す".
- Not undoable: `side` (look history, AI log), view state (selection, step, panels, playhead, zoom), preferences, AI keys.
- Limit 300 entries. Loading a project clears history.
- `meta.label` is `[stringKey, params]` (e.g. `['undo.pin', {field: 'arrive', scope: 'L12'}]`) so undo tooltips are localized.

### 3.11 Parsed lyrics (not saved)

```js
Sheet = {
  meta: { title: '夜明けのうた', artist: 'サンプル' },
  rows: [ParsedRow, …],                    // same order and ids as doc.sheet.rows
}
ParsedRow = {
  id: 'r7', kind: 'lyric',                 // 'lyric' | 'blank' | 'comment' | 'meta'
  stamps: [41.2, 92.0],                    // LRC start times, in written order
  text: '君の名前を呼ぶ声が',              // plain text: marks and stamps removed, escapes resolved
  pieces: [[0, 5], [5, 9]] | null,         // from '/', offsets into text; null when there is no '/'
  emph: [[0, 1]],                          // from '*…*'
  impact: false,                           // trailing '!'
  note: null,                              // text after '|'
  heading: null,                           // for comments: the text after '#'
  script: 'ja',                            // dominant script of text
}
Line = {                                   // one per sung occurrence, in time order (§4.9.3)
  id: 'r7.1', row: 'r7', occ: 1, index: 5, // index = position in the line list (for AI prompts and UI numbering)
  text, pieces, emph, impact, note, lang,
  stamp: 92.0 | null,                      // the stamp of this occurrence
  pauseBefore: 1,                          // blank rows directly above the row (first occurrence only)
  heading: 'サビ' | null,                  // nearest '#' comment above, if within 3 rows
}
```

### 3.12 The Plan (not saved; FROZEN shape)

```json
{
  "v": 1, "hash": "a91f03c2", "duration": 214.6,
  "design": { "aspect": "16:9", "w": 1920, "h": 1080, "short": 1080 },
  "look": {
    "mood":   { "v": "quietHush", "from": "pin:work", "by": "user" },
    "theme":  { "v": "sumiWashi", "from": "auto" },
    "season": { "v": "any", "from": "auto" },
    "amounts": { "motion": 0.3, "glitch": 0, "chroma": 0.05, "ornament": 0.35, "density": 0.3, "texture": 0.5,
                 "groundSwitch": 0.2, "flash": 0, "shake": 0.05, "camera": 0.3, "pace": 0.3 },
    "amountsFrom": { "glitch": "pin:work" },
    "palette": { "ground": "#EFE9DC", "ground2": "#E2D9C6", "ink": "#1C1A17", "accent": "#C2413A",
                 "shiftA": "#3E6E8C", "shiftB": "#C9A15B", "muted": "#8C8577" },
    "faces": { "display": { "ja": { "family": "Yuji Syuku", "weight": 400 }, "latin": { "family": "Fraunces", "weight": 600 } },
               "serif": { … }, "body": { … } },
    "texture": { "v": "paperTooth", "p": { "amount": 0.45 }, "from": "auto" },
    "backdrop": "scene"
  },
  "beats": { "bpm": 128, "offset": 0.214, "meter": 4 },
  "lines": [
    { "id": "r3", "row": "r3", "index": 0, "text": "夜明けの街を走る", "t0": 4.2, "t1": 7.9,
      "by": { "start": "auto", "end": "auto" }, "cuts": ["r3~0", "r3~4"], "locked": false, "lang": "ja" }
  ],
  "cuts": [
    { "key": "r3~0", "line": "r3", "role": "lyric", "text": "夜明けの", "emph": [], "impact": false, "note": null,
      "t0": 4.2, "t1": 5.95, "a": 4.08, "b": 6.2, "repT": 4.71, "lang": "ja",
      "feat": { "cells": 4, "graphemes": 4, "script": "ja", "orients": ["h", "v"], "words": 2, "emph": false, "impact": false,
                "dur": 1.75, "cps": 2.3, "energy": 0.42, "beat": 0.469, "section": "verse", "repeatOf": null, "pos": 0.02,
                "role": "lyric", "units": { "glyph": 4, "word": 2, "line": 1 } },
      "fp": "5c1e9a07",
      "slots": {
        "orient":  { "v": "h", "from": "auto" },
        "arrange": { "v": "stairStep", "p": { "offsetX": 0, "offsetY": 0, "steps": 2, "indent": 1.2 }, "from": "auto" },
        "text.face": { "v": "display", "from": "auto" }, "text.scale": { "v": 1, "from": "auto" },
        "text.ink": { "v": "ink", "from": "auto" }, "text.style": { "v": "plain", "from": "auto" },
        "arrive":  { "v": "inkRise", "p": { "dur": 0.62, "each": 0.05, "order": "lead", "ease": "expoOut", "yFrom": 0.55 },
                     "from": "auto", "pfrom": { "each": "pin:cut" } },
        "dwell":   { "v": "breathePulse", "p": { "amount": 0.3, "speed": 1 }, "from": "auto" },
        "depart":  { "v": "fogOut", "p": { "dur": 0.4, "each": 0.02, "order": "lead", "ease": "quadIn" }, "from": "auto" },
        "ornament.count": { "v": 1, "from": "auto" },
        "ornament#0": { "v": "cornerTicks", "p": { "amount": 0.4, "ink": "accent", "size": 0.06 }, "from": "auto" },
        "lens":    { "v": "slowPush", "p": { "amount": 0.3 }, "from": "auto" },
        "filter.count": { "v": 0, "from": "auto" }
      },
      "els": { "text": { "nudge": { "dx": 0, "dy": -24, "rot": 0, "s": 1 } } },
      "ground": 0, "seamIn": -1
    }
  ],
  "grounds": [
    { "key": "gr3~0", "t0": 0, "t1": 31.0, "cuts": ["title", "r3~0", "r3~4"],
      "ground": { "v": "washiFiber", "p": { "amount": 0.6, "fiber": 0.4 }, "from": "auto" },
      "atmos": { "v": "none", "from": "auto" }, "fp": "0b77c1d4" }
  ],
  "seams": [
    { "into": "r7~0", "at": 40.9, "dur": 0.5, "scope": "world", "a": "r4~0", "b": "r7~0",
      "slot": { "v": "irisGate", "p": { "dur": 0.5, "soft": 0.2 }, "from": "auto" } }
  ],
  "impulses": [ { "t": 45.2, "kind": "flash", "amp": 0.6, "decay": 0.18 }, { "t": 45.2, "kind": "shake", "amp": 0.3, "decay": 0.4 } ],
  "warnings": [ { "code": "orphan-pin", "path": "cut/r4~6:arrive", "line": "r4" } ]
}
```

Notes:
- `cuts` are in time order and include special cuts (`title`, `intro`, `gap/…`, `outro`) with roles `title`,
  `interlude`, `outro`. Roles of lyric cuts: `lyric` or `focus` (an emphasized/impact phrase cut out on its own).
- `a`/`b` = the cut's visible window: `a = t0 − timing.lead`, `b = next cut's t0 + timing.tail` (or `t1 + tail` before a
  gap). When a transition that is not the hard cut leads into the next cut, `b` ends with its window instead:
  `b = max(t1, min(b, seam.at + seam.dur/2))` (§4.16.6; changed at integration under §9.4: the seam shows only the next
  cut at the end of its window, so the old cut must not be drawn again after it). `repT` = representative "hero" time
  (entrance finished, text fully visible) used for seeking and thumbnails.
- `fp` (fingerprint) = hash of everything the scene build needs: slots, `els`, text, emph, duration `b − a`, role, palette,
  faces, design size; plus the beat grid seen from the scene's origin (`bpm`, `meter`, origin − offset) when a chosen part
  declares `needs: ['beats']` or the cut's custom shot has a key anchored on a beat (`core/shot.usesBeats`, DESIGN_2_1
  §3.3), and the origin and the digest when one declares `needs: ['level']` (origin = the cut's `t0`,
  a segment's `t0`). A segment's `fp` covers its ground and atmos decisions (with params), its span and the shared look,
  not its cuts. `fp` hashes each decision's `{ p, v }` only, never where it came from. The scene cache rebuilds only
  cuts whose `fp` changed.
- `hash` = `hash32` of the canonical JSON of the Plan without `hash` (keys sorted, numbers printed with `JSON.stringify`).
  Diagnostics (`why`, alternatives) are **never** in the Plan.
- `beats` is `null` when there is no BPM.
- The derived 20 Hz loudness envelope (`Float32Array`) is attached as a non-enumerable property `plan.env` (not in the
  JSON, not hashed; it is a pure function of `doc.song.digest`).

### 3.13 Decision, FieldState, Warning (FROZEN)

```js
Decision   = { v, p?, from, by?, pfrom? }
             // from: 'auto' | 'pin:cut' | 'pin:line' | 'pin:work' | 'mark' | 'rule' | 'fallback'
             // by: present when from starts with 'pin' ('user' | 'ai' | 'tap' | 'lock')
             // pfrom: per-parameter source when it differs from 'auto' (same vocabulary)
FieldState = { path, value, display: [stringKey, params] | string,
               state: 'auto' | 'pinned' | 'inherited' | 'ai' | 'locked' | 'mark' | 'derived' | 'inactive' | 'mixed',
               pinnedAt: null | 'cut' | 'line' | 'work', by: null | 'user' | 'ai' | 'tap' | 'lock',
               schema: ParamSpec | SlotSpec, autoText: [stringKey, params] | null,
               canPinAt: ['cut', 'line', 'work'], inactiveReason: null | 'part-changed' | 'not-applicable',
               warn: null | { code, params } }
Warning    = { code, path?, line?, cut?, detail? }
             // codes: pin-bad-value pin-not-applicable pin-filtered pin-off-season orphan-pin shadowed-pin lock-partial
             //        pool-empty time-order time-compressed title-skipped overfull font-fallback piece-merged
```

---

## 4. Module interfaces

Every signature below is the public export of the named module. Anything not listed is private. Errors are thrown as
`Error` subclasses with a `code` string (listed per module); pure functions never throw for bad *user data* — they return
warnings instead — and throw only for programmer errors (wrong types, unknown ids).

### 4.1 Core kernel: `core/hash`, `core/rng`, `core/noise`, `core/num`, `core/ease`, `core/color`, `core/mat` (WP0)

#### 4.1.1 `core/hash` (FROZEN code)

```js
// hash32(...parts): FNV-1a over the UTF-16 code units of each part (String(part)), a separator after each part,
// then the murmur3 fmix32 finaliser. Returns an unsigned 32-bit integer.
function hash32(...parts) {
  let h = 0x811c9dc5;
  for (let p = 0; p < parts.length; p++) {
    const s = String(parts[p]);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= 0x1f; h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return h >>> 0;
}
// hashJSON(v): hash32 of canonical JSON (object keys sorted recursively; arrays in order; undefined dropped) → 8 hex chars
```

Test vectors (FROZEN; `tests/node/rng.test.js`): `hash32('') = 3192004061`, `hash32('a') = 483993982`,
`hash32('ab','c') = 2642534310` and `hash32('a','bc') = 1379158772` (different, thanks to the separator).

#### 4.1.2 `core/rng` (FROZEN code for the generator)

```js
function gen(seed) {                       // splitmix-style 32-bit generator; integer-exact in every JS engine
  let a = seed >>> 0;
  return () => {
    a = (a + 0x9e3779b9) >>> 0;
    let t = a ^ (a >>> 16); t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15; t = Math.imul(t, 0x735a2d97); t ^= t >>> 15;
    return (t >>> 0) / 4294967296;         // [0, 1)
  };
}
// Stream API (all methods advance the stream deterministically)
stream(...labels) → Stream                // seed = hash32(...labels)
fromSeed(seed) → Stream
Stream = {
  seed,                                    // the 32-bit seed
  next() → [0,1),  range(lo, hi) → [lo,hi),  int(lo, hi) → integer in [lo, hi] (inclusive),
  chance(p) → boolean,  pick(array) → element,  weighted(values, weights) → element,
  shuffle(array) → new array (Fisher–Yates),  floats(n) → Float32Array of next() values,
  fork(...labels) → Stream                 // = stream(this.seed, ...labels); does not advance this stream
}
gumbel(seed, key) → number                 // -ln(-ln((hash32('gumbel', seed, key) + 0.5) / 2^32)); independent of any stream
```
Test vector (FROZEN): the first three values of `gen(1)` are `0.3678755429573357`, `0.08161311969161034`, `0.8205357783008367`.

#### 4.1.3 Stream naming (FROZEN; these exact label lists are used everywhere)

| Use | Seed |
|---|---|
| mood / theme auto | `hash32('mood', look.moodSeed)`, `hash32('theme', look.moodSeed)` |
| cut seed | `cutSeed = hash32('cut', look.seed, cutKey, salts['line/'+lineId] or 0, salts['cut/'+cutKey] or 0)` |
| slot seed | `slotSeed = hash32('slot', cutSeed, slotName, salts['cut/'+cutKey+':'+slotName] or 0, salts['line/'+lineId+':'+slotName] or 0)` |
| Gumbel noise of a candidate | `gumbel(slotSeed, partKey)` |
| parameter auto | `stream(slotSeed, 'param', paramName)` |
| part build randomness | `stream(slotSeed, 'build', partKey)` (the `env.rng` a part receives) |
| per-glyph randomness | `stream(slotSeed, 'glyph', partKey).floats(n)` computed once at build |
| segment (ground/atmos) | `hash32('seg', look.seed, firstCutKey, salts['cut/'+firstCutKey] or 0)` then slot seeds as above with cutKey = first cut |
| seam at a boundary | slot seed of slot `seam` on the receiving cut |
| cutter coin flips | `stream(cutSeed, 'cutter')` |

Special cuts use their key (`title`, `intro`, `gap/r8`, `outro`) with `lineId` = none (no line salts).

#### 4.1.4 `core/noise`, `core/num`, `core/ease`, `core/color`, `core/mat`

```js
// noise: seeded value noise, lattice values = hash32(seed, i[, j]) / 2^32, smoothstep interpolation
noise1(seed, x) → [0,1]    noise2(seed, x, y) → [0,1]    fbm1(seed, x, octaves = 3) → [0,1]
tile(seed, size) → Uint8Array(size*size)                      // for grain/halftone textures (render builds canvases from it)
// num
clamp(x, lo = 0, hi = 1)  lerp(a, b, t)  invLerp(a, b, x)  remap(x, a0, a1, b0, b1)  smooth(t)  fract(x)
wrap(x, lo, hi)  q6(x) = Math.round(x * 1e6) / 1e6  approxEq(a, b, eps = 1e-9)  TAU  DEG (= π/180)
// ease: EASES (FROZEN list) and lookups
EASES = ['linear','sineIn','sineOut','sineInOut','quadIn','quadOut','quadInOut','cubicIn','cubicOut','cubicInOut',
         'expoIn','expoOut','expoInOut','backIn','backOut','backInOut','elasticOut','bounceOut','springOut','steps']
get(name) → (u: 0..1) => number          // f(0)=0, f(1)=1 for all; back/elastic/spring may overshoot; 'steps' = floor(u*8)/8
reverse(name) → name                     // In↔Out, InOut stays; used by kit mirror()
bezier(x1, y1, x2, y2) → fn              // own Newton/bisection solver, 1e-6 precision
// color (hex strings '#RRGGBB' uppercase in and out)
parse(hex) → {r,g,b} (0..255)   toHex({r,g,b})   rgba(hex, a) → 'rgba(r,g,b,a)' (a quantized to 1/64; cached)
mix(a, b, t) → hex (in OKLab)   luminance(hex)   contrast(a, b) → WCAG ratio   fitContrast(fg, bg, min) → hex (moves OKLab L only)
shade(hex, k) → hex (toward black by k∈[0,1])   hueDeg(hex)   hueDistance(a, b)   TOKENS = ['ground','ground2','ink','accent','shiftA','shiftB','muted']
// mat (Float32Array(6) affine [a, b, c, d, e, f] like Canvas setTransform)
ident(out)  mul(out, A, B)  invert(out, A)  apply(M, x, y, out2)  quad(out8, M, x0, y0, x1, y1)
compose(out, x, y, rot, kx, ky, sx, sy, px, py)   // T(x+px, y+py) · R(rot) · K(kx, ky) · S(sx, sy) · T(−px, −py)
```

### 4.2 `core/schema`: parameter specs and AutoSpec (WP0, FROZEN)

```js
ParamSpec = {
  type: 'num' | 'int' | 'bool' | 'enum' | 'ease' | 'order' | 'ink' | 'color' | 'face' | 'text',
  min, max, step,               // num / int (step optional for num); text: max = max length (default 40)
  of,                           // enum: allowed values (strings or numbers)
  unit: '' | 's' | 'du' | 'em' | 'deg' | 'frac' | 'x' | 'Hz',
  label: { ja, en },            // REQUIRED for part params (inspector, AI catalog)
  auto: AutoSpec,               // REQUIRED
  ui: 'basic' | 'advanced',     // default 'basic'
  ai: true,                     // expose to the AI catalog (default true)
  optKey,                       // enum only (v2.1, DESIGN_2_1 §3.5): option labels opt.<optKey>.<value>, not opt.<value>
}
AutoSpec =
    { value: v }                                         // constant
  | { pick: [v1, v2, …], weights?: [w1, w2, …] }         // weighted pick (equal weights when omitted)
  | { range: [lo, hi] }                                  // uniform in [lo, hi]
  | { range: [lo, hi], follow: SOURCE, jitter?: 0.2 }    // lerp(lo, hi, clamp(src + (r − 0.5) · jitter)) — r from the param stream
  | { fn: (f, rng, look) => v, why: { ja, en } }         // escape hatch: may use only its arguments; 'why' is shown in the inspector
SOURCE = 'energy' | 'density' | 'cells' | 'dur' | 'tempo' | 'position' | 'emph' | 'impact'
       | 'amount.<key>' | 'mood.<tag>'                   // prefix '-' inverts: 1 − x
```

Source normalization (FROZEN): `energy` = `feat.energy`; `density` = `clamp(feat.cps / 12)`; `cells` =
`clamp((feat.cells − 2) / 28)`; `dur` = `clamp((feat.dur − 0.5) / 5.5)`; `tempo` = bpm ? `clamp((bpm − 60) / 120)` : 0.5;
`position` = `feat.pos`; `emph`/`impact` = 0 or 1; `amount.k` = `look.amounts[k]`; `mood.tag` =
`clamp(((mood.tagBias[tag] ?? 1) − 0.25) / 1.75)`.

Exports:
```js
autoValue(spec, ax) → value         // ax = { f: CutFeatures, look: { amounts, mood: MoodDef, bpm }, rng: Stream }; result is coerced
coerce(spec, v) → value | undefined // num: clamp → snap to step → clamp; int: round → clamp; bool: !!v; enum/ease/order: member or undefined;
                                    // ink: TOKENS member or #RRGGBB; color: #RRGGBB (uppercased); face: display|serif|body;
                                    // text: String(v) without line breaks, cut to max
describeAuto(spec, lang) → string   // e.g. '0.45–0.9 · エネルギーに連動' / '0.45–0.9 · follows energy'; fn autos → spec.why[lang]
validateSpec(name, spec) → string[] // [] when valid; messages name the param and the rule
ORDERS                               // FROZEN list, see §4.17.4
```

### 4.3 `core/paths` and `core/pins` (WP0, FROZEN)

```js
// paths
parse(path) → { scope: { kind: 'work'|'line'|'cut', id: null|lineId|cutKey, lineId: null|lineId },
                slot: string,                                            // the text after ':'
                part: { kind, idx, key, param } | null,                   // for KIND slots
                el: { owner, field } | null, name: string | null }        // for 'el.' and NAME slots
format({ scope, slot }) → path     // exact inverse of parse
scopeKey(path) → 'work' | 'line/<id>' | 'cut/<key>'
lineOfCut(cutKey) → lineId | null  // 'r3~4' → 'r3'; 'gap/r8' → null (special cuts have no line)
cutOffset(cutKey) → integer | null
isUnder(path, scope) → boolean     // path's scope equals scope, or is a cut of that line (for scope 'line/<id>'), or any (for 'work')
slotParamPath(kind, idx, partKey, param, shared) → slot string   // builds 'arrive.dur' | 'arrive@inkRise.yFrom' | 'ornament#1@hankoSeal.size'
// PathError codes: 'bad-scope' 'bad-slot' 'bad-line-id' 'bad-cut-key'

// pins
index(pins) → PinIndex           // groups pins by scope for O(1) lookups: { work: Map<slot,pin>, line: Map<lineId,Map>, cut: Map<cutKey,Map> }
attachCuts(pinIndex, lineId, cuts: [{ key, a, b, text }]) → { map: { [actualCutKey]: pinCutKey }, orphans: string[], shadowed: string[] }
                                 // reattachment rules of §4.10.4; `a`,`b` = offsets of each piece
lookup(pinIndex, at: { cutKey|null, pinCutKey|null, lineId|null }, slot) → { v, from, by, at } | null
                                 // rank cut (via pinCutKey) > line > work, exactly as §3.5; returns the raw pin value (caller coerces)
pinsUnder(pins, scope) → string[] (paths)
```

`lookup` is the single implementation of the precedence table. `planner`, `planner/fields` (inspector) and `ai` MUST use
it; nobody reads `doc.pins` directly for resolution.

### 4.4 `core/doc` and `core/migrate` (WP0)

```js
defaultDoc() → Doc                 // empty sheet (next: 1), timing defaults (snap 'off', lead .12, tail .25, leadIn 1, outro 2, tapLatency .06),
                                   // song null, look { seed: 1, moodSeed: 1, aspect '16:9', backdrop 'scene' }, empty pins/salts/locks/filters,
                                   // output { format 'mp4', short 1080, fps 30, quality 'high', audio true, range null, name null }
defaultSide() → Side               // { looks: { list: [], cap: 50 }, aiLog: [] }
validate(doc) → string[]           // structural problems (types, ids unique, next > every id, pin paths parse)
normalize(doc) → Doc               // fills missing defaults; never changes existing values
touched(a, b) → { rows: Set<rowId> | 'all', pins: Set<path>, look, timing, song, output, filters, salts, locks: boolean }
                                   // uses reference equality on sub-objects (structural sharing makes this cheap)
serialize({ doc, side }) → string  // JSON with 1-space indent, keys in the order of §3.1
sanitizeSide(side) → Side          // side is history, never undone: bad parts are dropped, never refused. `looks` an object; an
                                   // entry kept when n is an integer ≥ 1 (first per n), seed/moodSeed uint32, salts keys pass
                                   // paths.scopeKey with integers ≥ 1, scope a string, label [string, object], star boolean;
                                   // cap an integer 1..500 (else 50); an aiLog entry needs string runId/tool, finite at,
                                   // integer n ≥ 0, applied a list of objects, groups absent or a list; other keys dropped
songInfoProblems(info) → string[]  // doc.song.info: present keys typed (summary/mood strings, bpm/duration numbers, sections
                                   // [{ kind ∈ SECTION_KINDS, start < end }], highlights [{ time, what }]); keys may be missing
SECTION_KINDS                      // intro verse prechorus chorus bridge interlude solo outro other (ai/song and ui/timeline read it)
DESIGN_SIZE = { '16:9': [1920,1080], '9:16': [1080,1920], '1:1': [1080,1080], '4:5': [1080,1350], '4:3': [1440,1080], '3:4': [1080,1440], '21:9': [2520,1080] }
// migrate
parseFile(text) → { doc, side }    // JSON.parse + migrate + normalize + validate(doc) + sanitizeSide; a malformed song.info
                                   // makes the file 'invalid'; throws MigrateError('bad-json'|'not-a-project'|'newer'|'invalid')
migrate(json) → { doc, side }      // applies MIGRATIONS[schema] … up to CURRENT_SCHEMA (1)
```

### 4.5 `core/store`: history and undo (WP0, FROZEN API)

```js
const store = createStore({ doc, side, reduce, limit = 300 });
store.doc; store.side; store.rev;                    // rev increments on every doc change (do, undo, redo, load)
store.dispatch(cmd, meta?) → rev                     // meta = { label?: [key, params], mergeKey?, where?, sel?: { before, after } }
store.batch(meta, cmds) → rev                        // one entry; reduce(doc, { t: 'batch', cmds })
store.gesture(mergeKey) → { end() }                  // every dispatch with this mergeKey until end() merges into one entry
store.seal()                                         // closes the current coalescing window (the next dispatch always adds an entry)
store.undo() → { where, sel } | null                 // sel = selBefore of the undone entry
store.redo() → { where, sel } | null                 // sel = selAfter of the redone entry
store.peek() → { undo: [key, params] | null, redo: … }
store.list() → [{ n, label }] ; store.jump(n)        // edit-history popover
store.setSide(fn)                                    // side = fn(side); emits 'side'; never recorded
store.load(doc, side)                                // clears history; emits 'doc' with kind 'load'
store.on(event, fn) → off                            // 'doc': { rev, kind: 'do'|'undo'|'redo'|'load', cmds, touched, where, sel }
                                                     // 'side': { side }
```

Invariants (tested): `reduce` is never called on undo/redo; `undo` after `dispatch` restores a deep-equal doc; history
never exceeds `limit`; `side` is never changed by undo.

### 4.6 `core/registry`: part registry (WP0, FROZEN)

```js
KINDS = ['arrange','arrive','dwell','depart','ground','ornament','lens','filter','seam','theme','mood']
createRegistry(defs: PartDef[], { strict = true } = {}) → Registry     // throws RegistryError listing every problem when strict
Registry = {
  version,                                   // hash of sorted (kind, key, param names) — part of cache keys and the AI catalog
  get(kind, key) → def | null
  has(kind, key) → boolean
  keys(kind) → string[]                      // sorted by key; registration order never matters
  all(kind?) → def[]                         // sorted by (kind, key)
  pool(kind, { role, season, filters, orient, script, scope }) → string[]   // eligible for AUTO picks (filters, season gate, pool:false,
                                             // role, traits hard limits; `scope` 'cut'|'run' for ornaments; texture: true for the texture slot)
  fallback(kind) → key                       // the one def with fallback: true
  label(kind, key, lang) → string
}
```

Validation (each is a `RegistryError` entry `kind/key: message`):
- `kind` in KINDS; `key` matches `^[a-z]+[A-Z][A-Za-z0-9]{1,30}$` (camelCase with at least two words) and is unique in its kind;
- `label.ja`, `label.en` non-empty; `blurb.ja`, `blurb.en` present for part kinds;
- every `tags` entry in the tag vocabulary (§4.18.1); `season` ∈ `null|spring|summer|autumn|winter`;
- every param has a valid ParamSpec (`validateSpec`), no param name clashes with a shared param of the kind (§3.4);
- the kind's required fields/functions exist (§4.18.2 table); exactly one `fallback: true` per kind (themes: `sumiWashi`,
  moods: `quietHush`);
- theme: all 7 color tokens are `#RRGGBB`; `ink`/`ground` contrast ≥ 4.5; faces name a family for `ja` and `latin` for all 3 roles;
- mood: `amounts` has every amount key in 0..1; `tagBias` keys in the tag vocabulary; `themes` keys exist (checked after all defs load).

`parts/catalog.js` (WP5 owns the file, contract FROZEN here):
```js
MV.def('parts/catalog', ['core/registry'], (REG) => ({
  defs: () => MV.ids('parts/').filter((id) => /^parts\/(arrange|arrive|dwell|depart|ground|ornament|lens|filter|seam|theme|mood)\//.test(id))
                                .flatMap((id) => MV.use(id)),
  defaultRegistry: () => REG.createRegistry(/* the defs above */),
}));
```
Tests build registries from any subset, e.g. `createRegistry([oneDef, ...fallbacks])`; `tests/helpers/corpus.js` provides the
minimal fallback set so a single-part registry validates.

### 4.7 `core/motion`: stagger fitting and hero time (WP0, FROZEN)

```js
SHARE = { arrive: 0.45, depart: 0.35 }         // max share of the cut window (b − a) an entrance / exit may take
MIN_DUR = 0.12
fitMotion({ dur, each, count, window, share }) → { dur, each, total }
  // limit = share · window; total = dur + each·(count − 1)
  // if total ≤ limit → unchanged
  // else if dur < limit → each = (limit − dur) / (count − 1)          (count > 1)
  // else → each = 0, dur = max(MIN_DUR, limit)
heroTime(cut, arrive: {dur, each}, depart: {dur, each}, count) → t
  // A = fitMotion(arrive…).total; L = fitMotion(depart…).total
  // repT = a + A + 0.1 · max(0, (b − L) − (a + A)), clamped to [a, b)
```
Both the planner (for `repT`) and the scene (for stagger) call `fitMotion`, so they always agree.

### 4.8 `core/script`: graphemes, scripts, widths, morae (WP1)

```js
graphemes(str) → string[]          // own clusterer (no Intl.Segmenter): surrogate pairs; combining marks U+0300–036F, U+1AB0–1AFF,
                                   // U+1DC0–1DFF, U+20D0–20FF, U+FE20–FE2F; kana voicing marks U+3099–309A; variation selectors
                                   // U+FE00–FE0F, U+E0100–E01EF; ZWJ U+200D joins the next cluster; skin tones U+1F3FB–1F3FF;
                                   // regional indicators pair up; keycap U+20E3; tags U+E0020–E007F; Hangul jamo L+V(+T); CR LF
graphemeOffsets(str) → Int32Array  // UTF-16 start offset of each grapheme, plus str.length at the end
charClass(ch) → 'han'|'hira'|'kata'|'smallKana'|'hangul'|'latin'|'digit'|'fullLatin'|'space'|'punctJa'|'punctLatin'|'emoji'|'symbol'
lineScript(text, docHint) → 'ja'|'en'|'zhHant'|'zhHans'|'ko'
  // kana present → ja; hangul present → ko; han present (no kana): docHint 'ja' (the sheet has kana anywhere) → ja,
  // else zhHant if any char is in TRAD_ONLY, zhHans if any in SIMP_ONLY, else zhHans; only Latin/digits → en
cells(str) → number                // layout-free width estimate: han/kana/hangul/fullwidth 1, halfwidth katakana 0.5,
                                   // Latin letter/digit 0.55, space 0.3, other 0.6 (used by the planner, never for layout)
morae(text, lang) → number         // ja: each kana 1 (small ゃゅょ etc. 0; っ and ー 1), han 1.7; ko: 1 per syllable;
                                   // zh: 1 per han; en: vowel groups per word (min 1 per word); digits 1 each
TRAD_ONLY, SIMP_ONLY               // small own tables (~200 chars each) of characters unique to one form
```

### 4.9 `core/lyrics`: parser and renderer (WP1)

#### 4.9.1 Row grammar (FROZEN)

Applied to one row's `src`:
1. Leading/trailing whitespace is ignored for classification. Empty → `blank`.
2. Starts with `#` → `comment`; `heading` = rest trimmed.
3. Exactly `[ti:…]`, `[ar:…]`, `[al:…]`, `[au:…]`, `[by:…]`, `[length:…]`, `[offset:…]`, `[re:…]`, `[tool:…]`, `[ve:…]`,
   `[#:…]` (case-insensitive tag) → `meta` (`ti` → title, `ar` → artist; others ignored — `offset` is not applied). (au,
   length, tool and # added in the final fixes, §9.4: files from common LRC tools carry them.)
4. Otherwise `lyric`. Leading stamps: one or more of `[mm:ss]`, `[mm:ss.xx]`, `[mm:ss:xx]`, `[m:ss.xxx]` →
   `stamps` in seconds, in written order. Enhanced-LRC word tags `<mm:ss.xx>` anywhere are removed.
5. Escapes: `\/` `\*` `\|` `\!` `\#` `\[` `\\` produce the literal character.
6. `|` (first unescaped) splits: the part after it, trimmed, is `note` (empty → null).
7. A trailing unescaped ASCII `!` (after trimming the text part) is removed once and sets `impact` (`Yeah!!` → text
   `Yeah!`, impact). Fullwidth `！` is ordinary text.
8. Scanning the rest left to right: `*` toggles emphasis (a range from the plain offset at the opening `*` to the one at
   the closing `*`; an unmatched final `*` is literal), `/` ends a piece. Empty pieces are dropped. Whitespace directly
   around a `/` collapses to one space kept at the end of the earlier piece. `pieces` is `null` when there is no `/`.
9. `text` = the resulting plain text. All offsets are UTF-16 indices into `text` and MUST fall on grapheme boundaries
   (a range that would split a grapheme is widened to the enclosing grapheme).

#### 4.9.2 API

```js
parseRow(src) → ParsedRow                           // §3.11 (without id)
parseSheet(rows: [{id, src}]) → Sheet               // meta from the first [ti:]/[ar:] rows
linesOf(sheet, { lang = 'auto' }) → Line[]          // §4.9.3; index = position in the returned array
renderRow(fields: { stamps?, text, pieces?, emph?, impact?, note? }) → src
  // stamps as [mm:ss.xx] (lrcTag); marks inserted at offsets; literal / * | ! # [ \ in text are escaped;
  // a text that ends with '!' while impact is false gets '\!' at the end
roundTrip(parsed, fields) → { src, ok }             // ok = parseRow(renderRow(merged)) equals the requested fields exactly
lrcTag(seconds) → '[mm:ss.xx]'                      // minutes zero-padded to 2, seconds to 2 decimals
PLAIN(src) → string                                 // plain text of a row (for keys and signatures)
SAMPLE_JA, SAMPLE_EN                                // our own sample lyrics (tests/fixtures/sample_lyrics.txt)
META_ROW, isMetaRow(src) → boolean                  // rule 3; the lyric editor's tint and the .lrc writer use it too
```

#### 4.9.3 Line order (FROZEN)

1. Primary list: every lyric row in text order contributes its first occurrence (id = row id, `stamp` = its first stamp or
   null).
2. Extra occurrences: every row's stamps after the first, as `(stamp, row index, k)`, sorted ascending.
3. Each extra occurrence `r.k` is inserted immediately after the last line in the current list whose `stamp` is known and
   `≤` its stamp (ties go after); if there is none, at the start.
4. `pauseBefore` = number of blank rows directly above the row (first occurrence only); `heading` = the nearest comment
   heading within the 3 rows above.

This keeps untagged lines where the author wrote them and never drops a tag.

### 4.10 `core/reconcile`: stable ids, offset maps, pin remapping (WP1, FROZEN rules)

#### 4.10.1 Row ids

```js
reconcile(oldRows, newText, next) → { rows, next, same: Map<oldId, newId>, edited: Set<rowId>, removed: string[], added: string[] }
```
1. Split `newText` on `\n` (a trailing `\r` is removed). `key(src)` = `PLAIN(src)` with whitespace removed, NFKC, Latin
   lower-cased; blank rows key `''`; comment rows key `'#' + heading`; meta rows key `'@' + tag`.
2. Anchors: LCS (Myers O(ND)) over the key sequences; equal keys pair in order. Paired rows keep their id (unchanged text
   or only marks/stamps/spacing changed).
3. In each gap between consecutive anchors, pair remaining old/new rows in order, maximizing the total character-bigram
   Dice similarity of their keys (DP over the gap; bigrams of the padded key `'^' + key + '$'`, so one edit keeps
   Dice ≥ 0.5 for keys of 3 or more characters), accepting a pair only if Dice ≥ 0.5; a gap with exactly one free old row
   and one free new row pairs them whatever their Dice (the row was edited in place). Paired rows keep their id and are
   `edited` when the plain text differs. The rule 4 pairs are found first and kept out of these gaps.
4. Moves: a still-unpaired new row whose key is unique among all new rows and equals the key of a still-unpaired old row
   that is unique among all old rows takes that id. (Rules 3–4 as refined in WP1's review, §9.4: so that "swapping two
   unique rows keeps both ids" and "editing one character keeps every id" hold for look-alike and short rows.)
5. Every other new row gets `'r' + (next++).toString(36)`.
Properties (tested): editing one character keeps every id; inserting a row adds exactly one id; swapping two unique rows
keeps both ids; duplicated chorus rows keep their ids in order; ids are never reused.

#### 4.10.2 Offset maps

```js
offsetMap(oldText, newText) → (offset) => newOffset
  // character-level LCS; a kept character maps to its new position; a deleted character maps to the new position of the
  // next kept character; old length maps to new length; 0 always maps to 0; result snapped to a grapheme boundary
```

#### 4.10.3 What `lyrics.set` / `lyrics.row` do to pins, salts and locks (FROZEN)

- Removed lines (all occurrences of removed rows; occurrences that disappear because stamps were removed): delete every pin
  under `line/<id>` and `cut/<id>~*`, the salts with those prefixes, and `locks[id]`.
- Edited lines: for each pin/salt key `cut/<lineId>~<off>…`, rewrite `<off>` with the line's offset map; if two keys collide
  the one with the smaller original offset wins and the other is dropped. `line/<id>:split` offsets are mapped the same way
  and deduplicated; if the result is no longer strictly increasing from 0 the split pin is removed (`lock-partial` if it was
  a lock pin). `sig` is kept as it was (it records the text at pin time).
- Occurrence ids follow their stamp index: `r7.1` stays `r7.1` while the row has at least 2 stamps.

#### 4.10.4 Reattaching cut pins at plan time (FROZEN; `core/pins.attachCuts`)

For a line whose cuts are `[{key, a, b, text}]` and whose cut pins use keys `P = {pinCutKey}`:
1. Exact: a cut whose key is in `P` uses it.
2. Signature: for a remaining pin key whose pins carry `sig`, if exactly one remaining cut has `text === sig` (marks
   removed), it attaches there.
3. Containment: a remaining pin key whose offset lies in `[a, b)` of a remaining cut attaches to that cut.
4. Conflicts at steps 2–3: the pin key whose offset is closest to the cut's `a` wins (ties: smaller offset); the others are
   `shadowed`.
5. Anything left is an `orphan`. Orphans and shadowed pins are kept in the doc, ignored by the planner, reported as
   warnings, and listed in the UI (迷子の固定) with [削除] and [このカットに付け直す] (which re-keys them by command).

### 4.11 `core/timing`, `core/beats`, `core/tap` (WP1)

```js
solveTimes(lines, ctx) → { times: [{ id, t0, t1, by: { start: 'pin'|'lrc'|'auto', end: 'pin'|'auto' } }], duration, warnings }
  // ctx = { pins: PinIndex, timing: doc.timing, songSeconds|null, bpm|null, readRate|null, lengthPin|null,
  //         titleCard: seconds reserved before the first auto line (2.0 when a title is set and the `titleCard` slot
  //         is pinned true, or not pinned and no line has a start anchor; else 0) }
  // SPEC §6 "a title card when a title is set": automatic lines start at leadIn (1 s), too early for the ≥ 1.5 s the
  // cutter needs, so an automatic card keeps 2 s too (planner/plan titleCardTime; a §9.4 change, spec-1). With an
  // anchored line (pin or LRC stamp) an automatic card never moves or squeezes a line: the cutter fits it into
  // [0, first line start) afterwards (§4.16.5).
```
Rules (FROZEN):
1. Anchors: `line/<id>:start` pins, else the line's LRC `stamp`. Walk in line order; an anchor `< previous anchor + 0.1` is
   demoted to auto with `time-order` (LRC anchors are demoted before pins; between two pins the later one is demoted).
2. Weights: `w = max(1.2, morae · secPerMora) + 0.8 · pauseBefore`, with `secPerMora = 1 / readRate` where
   `readRate` = the `readRate` slot (pin) → else `clamp(bpm / 20, 3, 14)` when a BPM is known (≈ three morae per beat)
   → else 7.
3. Between two anchors: starts are spread proportionally to the cumulative weights.
4. Before the first anchor: back-fill at the nominal rate; if that goes below `max(ctx.titleCard, 0)`, compress
   proportionally into `[titleCard, anchor]` (`time-compressed`).
5. After the last anchor (or with no anchor, from `max(ctx.titleCard, timing.leadIn)`): forward-fill at the nominal rate; with a
   song, if the fill ends after `songSeconds − timing.outro`, compress into the available span (`time-compressed`).
6. Snap (`timing.snap` ≠ 'off', a BPM known): **auto** starts move to the nearest grid time (beat / half beat / bar) within
   `± min(0.12, period / 4)`. Pins and LRC anchors never move.
7. End: `line/<id>:end` pin, else `min(next.t0 − (next.pauseBefore ? min(0.4 · next.pauseBefore, 1.2) : 0), t0 + max(4, 1.5·w))`;
   the last line: `min(duration − timing.outro·0.5, t0 + max(4, 1.5·w))`. `t1 ≥ t0 + 0.2` always.
8. `duration` = `length` pin → `songSeconds` → `lastLine.t1 + timing.outro`.

```js
// beats
grid({ bpm, offset, meter }) → Grid | null
Grid = { period, beatAt(t) → { index, phase: [0,1), since }, barAt(t) → { index, phase },
         snap(t, unit: 'beat'|'half'|'bar', tol) → t, beatsIn(t0, t1) → Float64Array }
// tap (pure reducer)
tapStart(lines, fromLineId) → TapState
tapReduce(state, ev) → state       // ev: { type: 'mark' | 'end' | 'back' | 'pause' | 'resume', t }
  // mark: start of the next line (and advance); end: end of the current line; back: forget the last mark and step back one line
tapCommand(state) → { t: 'time.tap', marks } | null   // null when nothing was marked
```

### 4.12 `core/commands`: reducers (WP1)

```js
reduce(doc, cmd) → doc             // §3.9; unknown cmd.t throws CommandError('unknown'); invalid payload throws CommandError('payload')
// helpers used by the UI to build payloads (pure)
effectiveTimes(plan, lineIds) → { [lineId]: { start, end } }
```
Reducers MUST return the same object when nothing changes (so the store records nothing) and MUST only replace the
sub-objects they change (structural sharing; `touched` relies on it). `lyrics.set` and `lyrics.row` call `reconcile` and
apply §4.10.3; they never touch `side`.

### 4.13 Audio: `audio/analyze`, `audio/fft`, `audio/digest`, `audio/wav`, `audio/peaks`; hosts `audio/host/decode`, `audio/host/player` (WP6)

```js
// pure (Float32Array in, plain data out)
analyze(channels: Float32Array[], sampleRate, { step } = {}) → Generator<progress 0..1, SongAnalysis>
  // yields progress periodically so the host can run it in chunks; the final `return` value is the analysis
SongAnalysis = {
  duration,
  env: { hz: 100, loud: Float32Array },       // RMS loudness in dB mapped to 0..1 (−60 dB → 0, 0 dB → 1)
  onset: { hz: 100, strength: Float32Array }, // spectral flux (own radix-2 FFT, 1024 window, hop 10 ms), normalized
  bpm, bpmConfidence,                         // autocorrelation of onset strength over 60–200 BPM with an octave check
  offset,                                     // first beat time: phase that maximizes onset strength on the grid
  meter: 4                                    // v2.0 always 4 (3/4 only by user pin)
}
digest(analysis) → { hz: 20, loud: base64 }   // 20 Hz max-pooled loudness as Uint8 (0..255) — this is what the doc stores
envFromDigest(digest) → { hz: 20, loud: Float32Array }
level(env, t) → 0..1                          // linear interpolation; 0.5 when env is null; closed-form (no smoothing across frames)
peaks(channels, sampleRate) → { levels: [{ spp, min: Float32Array, max: Float32Array }] }   // mip chain for the waveform
encodeWav(channels, sampleRate, rate = 16000) → Uint8Array                                   // 16-bit mono WAV; bytes pinned by audio.test.js
// host
decodeFile(file: Blob) → Promise<{ buffer: AudioBuffer, sha1, name }>   // decodeAudioData via OfflineAudioContext
createPlayer({ buffer|null, duration }) → Player
Player = { play(from?), pause(), seek(t), now() → t, playing, rate, muted, setMuted(b),
           outputTimeOf(eventTimeStamp) → t,        // maps a key event's timeStamp to song time via getOutputTimestamp
           on('state'|'ended', fn) }
  // with no song, a silent clock (performance.now based) with the same API
```

Frame-level audio reactions (e.g. a glow that breathes with loudness) read `level(plan.env, t)` only. Beat reactions use
`Grid.beatAt(t)`. Nothing keeps a running value across frames.

### 4.14 Fonts: `engine/text/faces` (pure) and `engine/host/fonts` (browser) (WP2)

```js
// faces (pure)
FLAVORS = { mincho, gothic, round, brush, heavy, antique }       // fallback families per script for ko / zhHant / zhHans (table below)
FontRef = { family, weight, script, css(sizePx) → '700 100px "Shippori Mincho B1", <fallback stack>', key }
resolveFaces(theme, pins /* face.* */, scriptsUsed) → { display: {ja, latin, ko, zhHant, zhHans}, serif: {…}, body: {…} }  // FontRef each
fontFor(faces, role, script) → FontRef                          // Latin runs inside CJK lines use the role's latin face
cssUrls(refs: FontRef[], textByFamily: {family: string}) → string[]
  // Google Fonts CSS2 URLs: https://fonts.googleapis.com/css2?family=<Family>:wght@<w>&text=<chars>&display=swap
  // CJK families (ja/ko/zh) get &text= with the unique characters used (sorted) so downloads stay small; Latin families are
  // requested whole. One URL per family; if a URL would exceed 1800 chars, the text= parameter is dropped for that family.
SYSTEM_FALLBACK = { mincho: '"Hiragino Mincho ProN","Yu Mincho","Noto Serif CJK JP",serif', gothic: '…sans-serif', … }

// host (browser)
createFontBook({ document }) → FontBook
FontBook = {
  request(refs, textByFamily),     // adds <link rel="stylesheet"> for new URLs (deduplicated); returns immediately
  ready(refs, text, { timeoutMs = 12000 }) → Promise<{ loaded: FontRef[], failed: FontRef[] }>   // document.fonts.load per ref
  epoch,                           // integer; +1 whenever a requested face finishes loading (scenes built earlier become stale)
  status(ref) → 'idle'|'loading'|'ready'|'failed',
  on('epoch', fn) → off
}
```

Flavor table (fallback families when a theme names only `ja`/`latin`):

| Flavor | ko | zhHant | zhHans |
|---|---|---|---|
| mincho | Nanum Myeongjo | Noto Serif TC | Noto Serif SC |
| gothic | Noto Sans KR | Noto Sans TC | Noto Sans SC |
| round | Gowun Dodum | Noto Sans TC | Noto Sans SC |
| brush | Nanum Pen Script | LXGW WenKai TC | Ma Shan Zheng |
| heavy | Black Han Sans | Noto Sans TC (900) | ZCOOL QingKe HuangYou |
| antique | Gowun Batang | Noto Serif TC | Noto Serif SC |

Failure: a face that fails or times out uses `SYSTEM_FALLBACK[flavor]`; the engine reports `font-fallback` (UI banner in
書体). Export calls `ready()` for every face and character used and never starts before it settles.

### 4.15 Text layout: `engine/text/*` (WP2)

#### 4.15.1 Measurer (FROZEN interface)

```js
Measurer = { key,                                   // changes when fonts change (includes FontBook.epoch in the browser)
             width(css, str) → number,              // advance width in px at the css size
             metrics(css) → { ascent, descent } }   // font-level, px
fakeMeasurer() → Measurer   // engine/text/fake_measure: deterministic; widths per char class at 100px:
                            // han/kana/fullwidth/hangul 100, halfwidth kana 50, Latin letter 56 (M/W 80, i/l/j 28), digit 56,
                            // space 30, other 60; ascent 88, descent 12; key 'fake'
createCanvasMeasurer(canvasFactory, fontBook) → Measurer   // engine/host/measure: measureText on a 1×1 OffscreenCanvas at 100px,
                                                           // scaled; Map cache keyed by (css@100px, str)
```
Layout is always computed at a nominal 100 px size and scaled.

#### 4.15.2 Vertical rules (FROZEN table; `engine/text/vert.js`)

Canvas2D cannot turn on the OpenType `vert` feature, so every adjustment is explicit. Offsets are in em relative to the
cell centre, x right, y down.

| Class | Characters | In a vertical cell |
|---|---|---|
| upright | kanji, kana, fullwidth letters/digits, hangul, emoji | centred |
| smallKana | ぁぃぅぇぉっゃゅょゎゕゖ ァィゥェォッャュョヮヵヶ ㇰ–ㇿ | offset (+0.10, −0.10) |
| corner | 、 。 ， ． ､ ｡ | offset (+0.55, −0.55) (upper right of the cell) |
| centred | ・ ： ； ！ ？ ‼ ⁉ | upright, centred |
| rotated | ー ― ‐ – — … ‥ 〜 ～ ＝ 「 」 『 』 （ ） ( ) ［ ］ 【 】 〔 〕 〈 〉 《 》 ｛ ｝ ＜ ＞ | rotated +90° about the cell centre; 〜 ～ also mirrored horizontally after rotation |
| tcy (縦中横) | a run of 1–2 ASCII digits, or `!?` `!!` `??` `?!` | set horizontally inside one cell, condensed to ≤ 1 em wide |
| latinRun | a run of ≥ 3 Latin letters/digits (and inner spaces/hyphens/apostrophes) | the whole run rotated +90° as one block; advance = run width |

Columns stack top to bottom and run right to left. A face may override offsets through `FACE_ADJUST[family]` (optional
per-family table in `vert.js`).

#### 4.15.3 Line breaking (`engine/text/breaker.js`, pure, FROZEN sets)

```js
NO_START = '、。，．・：；？！‼⁉ー」』）］】〕〉》｝ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ々〻…‥〜～)]},.!?:;'
NO_END   = '「『（［【〔〈《｛([{'
phrases(text, lang) → [[a, b]]        // phrase ranges (文節 approximation). ja: a break after the particles
                                       // は が を に で と へ も の や か から まで より ね よ な さ before a non-hiragana grapheme;
                                       // before hiragana only after は が を に で と へ の (or も not followed by う っ) once the
                                       // chunk is ≥ 6 graphemes (から まで より too), or after の は を へ that follow a
                                       // kanji/katakana word of a chunk ≥ 3 — and never when that hiragana is a particle stacked
                                       // on it (では, のは, でも + kanji); in a chunk ≥ 6 a kanji after hiragana (not お ご)
                                       // starts a phrase; after 、 。 ， ． ！ ？; at spaces; at script changes (kana/han ↔
                                       // Latin). en/ko: at spaces. zh: every han, grouped in 2s when > 8 graphemes.
                                       // (Final fixes, §9.4: まだ名前の|ない今日へ|行く, もう|一度, 切符を|そっと.)
words(text, lang) → [[a, b]]          // the 'word' unit for motions: = phrases for ja/zh, space-separated for en/ko
columns(text, n, lang) → [[a, b]]     // split into n balanced pieces at phrase boundaries, obeying NO_START/NO_END
breakLines(text, maxCells, lang, mode: 'phrase'|'char') → [[a, b]]
```

#### 4.15.4 RunSpec and RunLayout (FROZEN)

```js
RunSpec = {
  span: [a, b],                  // range into cut.text (or text: '…' for extra text such as the note or title)
  text?: string,
  orient: 'h' | 'v',
  face: 'display' | 'serif' | 'body',
  size: 118,                     // em in du before fitting
  tracking: 0.02, leading: 1.3,  // em
  box: { x, y, w, h },           // du, top-left origin
  align: 'start'|'center'|'end', valign: 'start'|'center'|'end',
  fit: 'shrink' | 'none',
  maxLines: 2, breakAt: 'phrase' | 'char' | 'none',
  emph: [[a, b]] (mapped by the builder from cut.emph), emphScale: 1.15,
  ink: 'ink', emphInk: 'accent', style: 'plain',        // from text.* slots unless the arrange overrides
  revealMode: 'wipeX' | 'wipeY' | 'diag' | 'iris' | 'lines',
  sizeGroup?: string, rot?: 0, move?: { vx, vy }        // du/s drift for tickers
}
RunLayout = {
  size,                                   // fitted em (reported to the inspector as a derived value)
  box: { x, y, w, h },                    // actual ink box
  n, ch: string[],                        // graphemes
  cls: Uint8Array, x: Float32Array, y: Float32Array, w: Float32Array, h: Float32Array,   // cell centres relative to the box origin
  rot: Uint8Array,                        // 0 upright, 1 = +90°, 2 = +90° mirrored
  line: Int16Array, word: Int16Array, emph: Uint8Array,
  lines: [{ from, to, x, y, w, h }], words: [{ from, to, cx, cy }],
  overfull: boolean                       // §4.15.6
}
layoutRun(spec, text, fonts, measurer) → RunLayout       // engine/text/layout.js
createTextService({ measurer, faces }) → TextService     // engine/text/service.js; caches layouts by (spec hash, measurer.key)
TextService = { layout(spec, text), columns, phrases, words, cells, fontFor(role, script) }
```

#### 4.15.5 Horizontal layout

Glyph advances come from measuring prefixes of the whole line (so kerning of the run is kept); CJK punctuation is not
compressed in v2.0. Emphasis ranges are scaled by `emphScale` about their baseline centre. Lines break with `breakLines`.

#### 4.15.6 Fitting and overfull (FROZEN, deterministic)

1. `fit: 'shrink'`: size = `min(size, size · box.w / width, size · box.h / height)` (analytic), then one re-break pass
   and a final check; repeat at most 3 times.
2. If the text still does not fit at `minSize = max(18, 0.35 · size)`: re-break with `breakAt: 'char'` and `maxLines + 1`.
3. Still not fitting: shrink below the minimum down to `0.6 · minSize`.
4. Still not fitting: keep that size, clip the run to its box, set `overfull = true`. The scene adds the warning
   `overfull` for the cut (shown as a row badge and in ④ preflight). The Plan is never changed by this.

### 4.16 Planner: `planner/*` (WP3)

#### 4.16.1 Entry points (FROZEN)

```js
plan(doc, { registry }) → Plan                     // planner/plan.js; pure; memoize by (doc identity, registry.version)
explain(doc, plan, path, { registry }) → Explanation            // planner/explain.js; lazy
fieldState(doc, plan, sel, path, { registry }) → FieldState      // planner/fields.js; for the inspector
fieldStates(doc, plan, sel, paths, { registry }) → FieldState[]
lockPayload(doc, plan, lineId) → { t: 'lock.set', lineId, pins }  // planner/fields.js; §3.6
pinSig(plan, cutKey) → string                                     // the cut's plain text for pin `sig`
diff(planA, planB, scope?) → [{ cut, path, from, to }]           // planner/diff.js; after おまかせ / reroll / undo
previewMood(doc, moodSeed) → moodKey                              // planner/look.js; used by the おまかせ command
Explanation = { path, value, from, by, why: [{ code, params }], alts: [{ key, w, masked: null | 'filter'|'season'|'trait'|'gate'|'role' }] }
```

#### 4.16.2 Stages (FROZEN order)

1. **Parse and time**: `parseSheet` → `linesOf` → `solveTimes` (with the `bpm`, `readRate`, `length`, `titleCard` slots).
2. **Look** (§4.16.3): season, mood, theme, amounts, palette, faces, texture.
3. **Cutter** (§4.16.5): lines → cut skeletons with keys (including special cuts), reattach cut pins (§4.10.4).
4. **Features** (§4.16.7) per cut.
5. **Cast** each cut in time order, slot order: `orient` → `arrange` (+params) → `text.face`, `text.scale`, `text.ink`,
   `text.style` → `arrive` → `dwell` → `depart` → `ornament.count` → `ornament#0..` → `lens` → `filter.count` →
   `filter#0..`; then `els` (element pins).
6. **Tracks** (§4.16.6): grounds (+atmos) → seams (after grounds) → rule overrides from seams → impulses.
7. **Derived**: `a`, `b`, `repT`, `fp` per cut; warnings; `hash`.

#### 4.16.3 Look (`planner/look.js`)

- **season**: pin, else keyword scan of all lyric text: spring 春 桜 さくら 花びら 卒業 blossom cherry; summer 夏 花火 蝉
  海 夕立 summer fireworks; autumn 秋 紅葉 落ち葉 月見 autumn maple; winter 冬 雪 白い息 聖夜 winter snow. A season wins
  with ≥ 2 hits and at least twice the hits of any other season; otherwise `any`.
- **mood**: pin, else weights: every mood starts at 1; `moodDef.keywords` found in `song.info.mood` or `song.info.summary`
  ×3 each; song energy (mean digest level) > 0.6 → moods with `amounts.motion ≥ 0.6` ×1.5, < 0.35 → moods with
  `amounts.motion ≤ 0.4` ×1.5; impact marks ≥ 3 → ×1.3 for moods with `amounts.flash ≥ 0.5`. Pick by Gumbel ranking with
  seed `hash32('mood', moodSeed)` (noise keyed by mood key).
- **theme**: pin, else weights `mood.themes[key] ?? 0.15`, times the season gate (§3.8), times `filters.theme`; Gumbel with
  `hash32('theme', moodSeed)`. (Was 0.4 until the final fixes: the 11–12 unlisted themes then weighed as much as the
  listed ones together, and a mood showed one of its own themes in only 51–64 % of looks.)
- **amounts**: per key, `work:amount.<k>` pin else `mood.amounts[k]`.
- **palette**: theme swatch → `work:color.*` pins → contrast fit (`ink` vs `ground` ≥ 4.5, `accent` vs `ground` ≥ 3, using
  `fitContrast`) → backdrop rules: `black` forces `ground #000000`, `ink`/`accent` `#FFFFFF`, shifts to greys; `chroma` sets
  `ground #00B140` and moves any ink/accent within 40° hue of green by 60°; `clear` keeps colors (ground is not drawn).
- **faces**: `resolveFaces(theme, face pins, scripts used)`.
- **texture**: `work:texture` pin, else the theme's texture when `amounts.texture > 0` (params `amount = amounts.texture`).

#### 4.16.4 The chooser (`planner/choose.js`, FROZEN formula)

For a part slot of kind `K` on cut `c` with slot seed `s`:

```
pool   = registry.pool(K, { role: c.role, season, filters, orient: c.orient, script: c.feat.script })
w(d)   = q6( d.weight                                       (default 1)
           × traitFit(d.traits, c.feat)                     1 inside every range; outside a numeric range falls linearly to 0.15
                                                            at 50% beyond it; orient/script/aspect/role mismatch → 0 (already out of pool)
           × (d.fits ? max(0, d.fits(c.feat, chosen)) : 1)  chosen = this cut's decisions so far (e.g. orient, arrange)
           × moodBias(d.tags)                               (geometric mean of mood.tagBias[tag] ?? 1 over d.tags)^1.5 (1 when no tags)
           × gate                                           d.gate ? look.amounts[d.gate] : 1   (0 → out of the pool; under the
                                                            chroma backdrop seams read amounts.flash as 0)
           × (theme.prefer[K]?.[d.key] ?? 1)
           × season                                         seasonal part, season 'any': ×0.5 when it is the theme's season,
                                                            else ×0.25; ×1.5 when it matches the season
           × (c.feat.impact && d.traits.impact ? 6 : 1)
           × recency                                        ×0.03 if d.key is the previous cut's natural or reference pick of this
                                                            slot; ×0.35 if it is the natural pick of one of the 3 cuts before that;
                                                            ×0.5 if d.family is the family of either of the previous cut's picks
                                                            (natural pick = argmax without recency and salts; reference pick =
                                                            argmax with recency against natural picks; pins and rules count as
                                                            both; lock pins count as the values the line would have unlocked;
                                                            factors multiply)
           × echo                                           ×2.5 if c repeats an earlier line and d.key is what that line's first cut used
           × moodFilter )                                   filter#i only: mood.filters[d.key] ?? 0.2
score  = ln(w) + variety × gumbel(s, d.key)                 variety = mood.variety (0.6–1.2); candidates with w = 0 are skipped
value  = argmax score (ties → smaller key)
```
If every candidate has `w = 0`: retry ignoring `traitFit` and `fits` (filters and season still apply); if still empty,
`registry.fallback(K)` with `from: 'fallback'` and warning `pool-empty`. A pool of one part (e.g. an `only` filter) always
returns that part: recency never zeroes.

Final fixes (look, a §9.4 change): the mood factor is raised to the power 1.5 (averaged over a part's tags and under the
noise and recency the plain mean left moods picking alike: quietHush took fast-tagged parts in 6 % of picks against
dashSprint's 13 %); a `filter#i` pool leaves out the work texture (it already runs over the whole video; a pin still
can); under the chroma backdrop a flash-gated transition (whiteFlash) leaves the automatic pool (its white wash keys as
a green veil; a pin still can).

**Non-part slots** (each uses its own slot seed; FROZEN formulas):
- `orient`: `'h'` when `feat.orients` lacks `'v'`; else `'v'` with probability
  `0.12 + 0.25·norm(mood.tagBias.literary) + (aspect ∈ {9:16, 3:4} ? 0.15 : 0)` (norm as in §4.2 `mood.<tag>`).
- `text.face`: weighted pick display 3 / serif 2 / body 1 (serif ×2 when `orient = 'v'`).
- `text.scale`: `1 + (feat.energy − 0.5)·0.2`. `text.ink`: `ink`. `text.style`: the theme's `style`.
- `ornament.count`: `min(3, floor(amounts.ornament·2.5 + r))`, `r = stream(slotSeed,'count').next()`.
- `filter.count`: `min(2, floor(0.8·max(amounts.glitch, amounts.chroma, amounts.texture·top) + r))` with `top` = the
  largest of `mood.filters` (0 when empty), plus 1 on impact cuts when `amounts.flash > 0` (the chooser then favours
  filters with `traits.impact`). (`texture·top`, the mood's film side, added in the final fixes: glitch and chroma alone
  gave silverReel 0.15 effects per cut and letterbox bars on 3 % of cuts, printColumn 0.07, quietHush 0.05.)

Stability requirements (tested over the corpus, §8): inserting one line keeps ≥ 98% of the other cuts' part choices
unchanged on average and changes at most 4 cuts outside the inserted line in any single case; adding one part to the
registry keeps ≥ 90% of choices; rerolling one cut changes at most 3 other cuts.

#### 4.16.5 Cutter (`planner/segment.js`)

- Pieces: `line/<id>:split` pin → `'none'` or the given offsets; else the row's `/` pieces; else auto:
  `maxCells = BASE[aspect] · lerp(1.3, 0.7, amounts.density)` with `BASE = {16:9: 14, 21:9: 16, 4:3: 12, 1:1: 10, 4:5: 10,
  3:4: 9, 9:16: 8}`. Split when `cells > maxCells` or (`dur > 4.5 s` and ≥ 2 phrases), into
  `k = min(3, ceil(max(cells / maxCells, dur / 4.5)))` pieces at phrase boundaries chosen to minimize the variance of cells
  per piece (DP), each piece ≥ 0.7 s (time shared by morae).
- Focus cut: an emphasized range or the whole impact phrase covering ≥ 25% of a line with ≥ 1.2 s available becomes its
  own piece (role `focus`) when `stream(cutSeed,'cutter').chance(mood.pace.focus)`.
- Piece times: shared by morae within `[t0, t1]`; a `cut/<key>:t0` pin moves an inner boundary. Pieces shorter than 0.35 s
  merge into the previous piece (`piece-merged`). With `timing.snap` on, inner boundaries snap like line starts.
- Special cuts: `title` when the `titleCard` slot is true (auto: title set and first line ≥ 1.5 s, which automatic timing
  makes room for, §4.11; pinned true with less
  room: shortened to `firstT0 − 0.2`, min 0.8 s, else skipped with `title-skipped`); `intro` when there is no title card and
  the first line starts ≥ 3 s; `gap/<id>` when the gap after a line is > `max(2.8, 2 bars)`; `outro` when ≥ 3 s remain after
  the last line.
- Window: `a = t0 − timing.lead`, `b = nextCut.t0 + timing.tail` (or `t1 + timing.tail` when a gap/special cut follows).

#### 4.16.6 Tracks (`planner/tracks.js`, owner of grounds and seams)

**Ground segments.** For each cut in time order, `gp` = the resolved `ground` pin value (cut > line > work) or `null`.
A new segment starts at the first cut, when `gp` differs from the previous cut's `gp`, or (both `null`) when
`breakScore ≥ 1`, where `breakScore = 1.0·(section changes) + 1.0·(either cut is title/interlude/outro) + 0.5·impact +
0.4·(gap > 1.5 s) + (cuts in segment ≥ L ? 1 : 0) + (stream(segSeed,'break').next() − 0.5)·0.6` and
`L = round(lerp(8, 1, amounts.groundSwitch))`. A segment's `ground` = `gp` or the chooser (kind `ground`, slot seed of
the first cut, recency over previous *segments*); `atmos` = its pin, else with probability `0.6 · amounts.ornament` the
chooser over ornaments with `scope: 'run'` (an empty pool gives `none`), else `none`. Params resolve from the first
cut's pins.

**Seams.** For every pair of consecutive cuts A → B, the slot `seam` on B:
- pinned → that part (any scope);
- else if A and B are in different segments → with probability 0.7 the chooser over seams with `scope: 'world'`, else
  `hardCut`;
- else with probability `mood.pace.seam · (0.5 + 0.5·B.feat.energy)` the chooser over `scope: 'text'` seams, else
  `hardCut`.
Window `[B.a − dur/2, B.a + dur/2]`, `dur` from the seam's shared param, clamped to `0.4 · min(A.b − A.a, B.b − B.a)`.
If the seam `replaces.depart` and A's `depart` is not pinned, A's depart becomes the fallback `instantHide` with
`from: 'rule'`; likewise `replaces.arrive` → B's arrive `instantShow`. The seam hands the picture over to B: every cut
before B whose `b` reaches past the window's end gets `b = max(t1, at + dur/2)` (§3.12), so its exit is fitted to end
with the transition and it never reappears after it. Seam lengths are computed from the windows before this.
**No neighbour repeats** (SPEC §6): a transition, a segment's ground and a segment's atmos do not take the previous
boundary's (segment's) winner — its argmax before this rule — while another candidate weighs > 0; the runner-up is
taken (for seams it may be the hard cut). The hard cut and `none` are exempt. (Added at integration: with only two
text transitions in the catalog, ×0.03 recency left 13 % of neighbouring text transitions equal.)

**Impulses.** For each impact cut: `flash` (amp `amounts.flash`, decay 0.18) if > 0, `shake` (amp `amounts.shake`, decay
0.4) if > 0, `slip` (amp `amounts.glitch`, decay 0.25) if > 0.2 — all at the cut's `t0`. For each `song.info.highlights`
time: `punch` (amp `0.5·amounts.camera`, decay 0.35). Sorted by `t`.

#### 4.16.7 Features (`planner/features.js`)

```js
CutFeatures = {
  cells, graphemes, script, latin: 0..1 share, orients: ['h','v'] | ['h'],   // 'v' allowed only for ja/zh with latinRun ≤ 12 chars
  words, units: { glyph, word, line },                                        // counts for motion units
  emph, impact, dur: t1 − t0, cps: cells / dur,
  energy,          // with a song: mean digest level over [t0, t1] as a percentile of the song's levels (0..1);
                   // without: 0.35 + 0.4·(line repeats elsewhere) + 0.15·impact + 0.1·sin(π·pos)
  beat: period | 0, onBeat: |t0 − nearest beat| < 0.06,
  section: song.info section kind at t0 | heading-derived ('サビ'/'chorus' → 'chorus') | null,
  repeatOf: key of the first cut of an earlier identical line | null,
  pos: t0 / duration rounded to 1/100 (the resolution parts read; a cut moved a little by an edit elsewhere keeps its
       features and so its cast — planner/plan keys the cast cache by the features' value), role
}
```

#### 4.16.8 Params, explain and field states

- `planner/params.js`: `resolveParams(def, kind, idx, at, pinIndex, ax) → { p, pfrom }`: for each param in declared order:
  pin at the shared path (`kind.param` / `kind#i.param`) for shared params or the part path (`kind@key.param`) otherwise;
  else `autoValue(spec.auto, ax)` with `ax.rng = stream(slotSeed, 'param', name)`; always `coerce`.
- `explain` re-runs the chooser for exactly one slot with tracing on, using the same inputs (the plan's earlier cuts supply
  `prev`), and returns the factor list as `why` codes: `mood.tag {mood, tag, x}`, `fit {x}`, `recent {key}`,
  `family {family}`, `echo {cut}`, `impact`, `season {season}`, `theme.prefer {x}`, `gate {amount}`, `rule {rule}`,
  `pin {scope, by}`, `lock`. It MUST return the same value as the Plan (tested). Nothing from explain enters the Plan.
- `fieldState` maps a Decision and the pin index to the FieldState of §3.13 (state `inherited` when the pin lives at a
  broader scope than the selection; `mixed` when a line/multi selection resolves differently across cuts; `inactive` for a
  part-qualified pin whose part is not chosen).

### 4.17 Scene: `engine/scene/*` (WP4)

#### 4.17.1 NodeTable (FROZEN column list; `engine/scene/table.js`)

Nodes are dense integers. A parent is always allocated before its children, so index order is topological. Columns grow in
chunks of 256, only at build time.

| Group | Columns | Type |
|---|---|---|
| structure | `type` (0 group, 1 glyph, 2 shape, 3 paint, 4 image, 5 particles, 6 camera), `parent` (−1 = root), `layer` (index in LAYERS), `owner` (index in `scene.owners`), `payload` (index into the per-type store), `flags` (bit0 hidden, bit1 static, bit2 pickable, bit3 followText) | Uint8 / Int32 / Uint8 / Uint16 / Int32 / Uint8 |
| pose (base + live) | `x y z rot sx sy kx ky rx ry alpha blur reveal tint glow shard echo jx jy pixel px py` (22) | Float32 |
| world | `m` (6 per node), `wa` (world alpha), `quad` (8 per node, for picking) | Float32 |

Pose meaning and identity: `x y` position (du; the base is the node's rest position, e.g. a glyph's cell centre); `z` depth
(du, perspective `s = 1600 / (1600 + max(z, −1400))`); `rot kx ky rx ry` radians (rx/ry = pseudo-3D flip); `sx sy`
scale (1); `alpha` (1); `blur` du (0); `reveal` 0..1 visible share (1); `tint` 0..1 toward the accent ink (0); `glow`
0..1 (0); `shard` 0..1 break-up (0); `echo` 0..1 ghost copies (0); `jx jy` jitter/shake offsets du (0); `pixel` mosaic
block size du (0 = off); `px py` pivot offset from the node's centre (0).

Combination rules (FROZEN): additive (`+=`): `x y z rot kx ky rx ry blur tint glow shard echo jx jy pixel`;
multiplicative (`*=`): `sx sy alpha reveal`; set (last writer in phase order): `px py`. At solve, `alpha reveal tint glow
shard echo` clamp to [0, 1], `blur pixel` to ≥ 0.

Local matrix (FROZEN): `M = T(x + jx + px, y + jy + py) · R(rot) · K(kx, ky) · S(sx·cos(ry)·s, sy·cos(rx)·s) · T(−px, −py)`;
world = parent world × M; world alpha = parent world alpha × alpha. A node whose world alpha < 1/255 is not drawn. Flip
shading: ink is darkened by `k = 0.35 · (1 − min(|cos rx|, |cos ry|))`, quantized to 1/16.

**Changing the column list** after M0 needs a DESIGN.md PR approved by the WP4 and WP5 owners, a bump of
`table.SCHEMA`, and updated conformance goldens (§9.4).

#### 4.17.2 Layers (FROZEN)

```js
LAYERS = [ { name: 'ground', parallax: 0.25 }, { name: 'far', parallax: 0.5 }, { name: 'mid', parallax: 0.8 },
           { name: 'text', parallax: 1.0 }, { name: 'near', parallax: 1.2 }, { name: 'hud', parallax: 0 } ]
LayerSpec = { name, parallax, blend: 'source-over' | 'multiply' | 'screen' | 'overlay' | 'lighter' | 'difference',
              opacity: 1, isolate: false, filter: null | { blur: du }, mask: null | { layer: name, invert: false },
              cache: 'none' | 'static' }
```
A layer gets its own surface only when it is isolated (non-default blend, filter, mask, or static cache). `mask` lets text
act as a window onto a lower layer (knockout).

#### 4.17.3 SceneBuilder (FROZEN; the only way parts create nodes)

```js
sb.group({ parent?, layer = 'text', x = 0, y = 0, rot = 0, sx = 1, sy = 1, alpha = 1, owner? }) → node
sb.text(RunSpec & { parent? }) → RunHandle { node, spec }          // glyph nodes are allocated in one block at commit, so a
                                                                    // cut's glyphs are one contiguous range [from, to)
sb.shape({ parent?, layer, path: ShapeSpec, fill?: ink, stroke?: ink, width = 2, dash?, cap = 'butt', alpha = 1,
           x = 0, y = 0, rot = 0, sx = 1, sy = 1, owner? }) → node
sb.paint({ layer, bleed = 0.15, animated = true, data, draw: (g, t, data, q) => void, owner? }) → node
sb.image({ parent?, layer, asset, fit: 'cover' | 'contain', x, y, w, h, owner? }) → node
sb.particles({ layer, n, sprite: ShapeSpec | 'glyph:<char>', ink, field: ParticleField, owner? }) → node
sb.behave(behaviour) ; sb.bounds(node) → Box (du; valid after commit) ; sb.freeAround(box) → Box[] ; sb.layer(name, patch)
ink = token name ('ink','accent','shiftA',…) | '#RRGGBB'
ParticleField = { area: Box, vx, vy, sway, swayHz, spin, size: [lo, hi], life: [lo, hi], wrap: true,
                  bursts?: { times: number[], speed, gravity } }   // closed form: pos(t) = p0 + v·t + sway·sin(φ + ω·t), wrapped;
                                                                  // bursts: pos = origin + v·τ + ½·g·τ², τ = t − burstTime ∈ [0, life]
```

`paint.draw(g, t, data, q)`: `g` is the Ctx2D subset (§4.19.8) already transformed so that 1 unit = 1 du, origin at the
frame's top-left (plus `bleed` margin). `t` = seconds since the segment start (ground, atmos) or cut-local time
(ornaments). `q = { draft, scale, pal, rgba(inkOrHex, a), tile(name, seed) }`. MUST be a pure function of `(t, data, q)`;
MUST NOT use `ctx.filter`. `draft` may only lower sampling density and is always false in export.

#### 4.17.4 Behaviours and stagger (FROZEN)

```js
PH = { REST: 0, MOTION: 1, ORNAMENT: 2, LENS: 3, STYLE: 4 }        // run order
Behaviour = {
  phase, live: 'until' | 'after' | 'during' | 'always',
  from, to,          // node range [from, to)
  t0, t1,            // local seconds
  run(P, t, b),      // P = live pose columns; t = local time; MUST be pure in t, allocate nothing, use only b's fields;
                     // MUST be a function defined once at module (factory) level, never a closure created per build
  ...fields          // precomputed at build (Float32Array delays, pivots, per-glyph randoms)
}
// scheduler, every frame, behaviours pre-sorted by (phase, build order):
//   'until' runs while t < t1 (before t0 the run function clamps progress to 0 → the start pose is shown)
//   'after' runs while t > t0;  'during' runs for t0 ≤ t ≤ t1;  'always' always
ORDERS = ['lead','tail','core','rim','scatter','word','line','sweepX','sweepY','radial','emphFirst','sung']
```

- **Identity rule** (conformance-tested): an arrive at progress ≥ 1 and a depart at progress ≤ 0 leave the pose unchanged.
  Dwell amplitudes are multiplied by `env.envelope(t)`: 0 until the entrance ends, ramps to 1 over 0.25 s, back to 0 over
  0.2 s before the exit starts (so there are no pops).
- **Stagger**: `staggerOf(env, target, order, each, unit)` ranks units (`lead` = reading order, i.e. left→right/top→bottom
  horizontally and top→bottom/right→left vertically; `tail` = reverse; `core` = centre-out; `rim` = edges-in; `scatter` =
  `stream(slotSeed,'order')` permutation; `word`/`line` = by word/line index; `sweepX/Y` = by position (ties broken along
  the other axis, top to bottom / left to right, so a vertical column sweeps glyph by glyph); `radial` = by
  distance from the focus centre; `emphFirst` = emphasized first then lead; `sung` = each unit starts at its sung time,
  i.e. `(morae before the unit / total morae) · (t1 − t0)` after the cut's `t0 − lead`). Delay = `rank · each` (except
  `sung`). Every glyph of a unit gets the unit's delay. `dur`/`each` are first fitted with `core/motion.fitMotion` to the
  window (`sung` is capped at the window instead).
- **Unit pivots**: `pivots(env, target, unit)` gives each glyph its offset from the centre of its word/line/run, so rotation
  and scale can happen about the unit centre (set into `px py` while the behaviour runs).
- **Masks/wipes**: `reveal` with the run's `revealMode`. **Break-up**: `shard > 0` draws K = 6 seeded strips offset by
  `shard × vector`. **Typewriter**: `reveal` stepped per glyph plus a caret shape node moved by a behaviour. **Echo**: two
  ghost copies in `shiftA`/`shiftB` at alpha `0.5·echo`, offset `±0.08·echo` em along x.

#### 4.17.5 Build and cache (`engine/scene/build.js`, `engine/scene/cache.js`)

```js
buildCut(cutPlan, plan, svc) → Scene      // svc = { registry, text: TextService, assets, pal, faces }
buildGround(seg, plan, svc) → Scene       // ground + atmos of one segment; its local time = t − seg.t0; it reads no cut:
                                          // env.cut, env.feat and env.role are null (the segment's fp does not cover cuts)
Scene = { key, fp, table, behaviours, layers, cam, owners: [{ el, slot }], text: { from, to }, runs, span: { a, b },
          warnings: Warning[], glyphKeys: string[] /* sprite warm-up */, provisional: boolean }
createSceneCache({ max = 16 }) → { get(fp, fontKey), put(scene), prefetch(plan, t0, t1, build), clear() }   // LRU by (fp, measurer.key)
```
Build order of a cut: layers and camera → `arrange.build` → commit text (layout via TextService; overfull handling) → apply
element pins (`nudge` to the owner's root base pose, `fill` to its ink, `hide` = owner not built) → `target` → `arrive`,
`dwell`, `depart` `make` → ornaments (`env.hints` from the arrange result; `follow: 'text'` ornaments get an automatic
alpha envelope that follows the text's entrance/exit windows) → `lens.make` on the camera node → sort behaviours → collect
`glyphKeys`. A scene built before its fonts arrived is `provisional` and rebuilt when `FontBook.epoch` changes; export
waits for fonts, so it never renders a provisional scene.

`target` (FROZEN): `{ from, to, runs, units: { glyph, word, line, run }, unitOf: { word: Int16Array, line: Int16Array,
run: Int16Array }, emph: Uint8Array, focus: Box }`.

`env` for part functions (FROZEN):
```js
env = {
  D: { w, h, cx, cy, short: 1080, safe: { l, t, r, b } },       // safe = 5% of the short side on every edge
  cut: CutPlan, feat: CutFeatures, role,
  times: { a, rest, out, b },                                    // cut-local: a = cut.a − cut.t0 (≤ 0); rest = end of entrance;
                                                                 // out = start of exit; b = cut.b − cut.t0
  textStyle: { face, scale, ink, style },                        // resolved text.* slots
  sb, text: TextService, pal, faces, amounts,
  grid: Grid | null,                                             // beat grid shifted to cut-local time
  level: (tl) => 0..1,                                           // loudness at cut-local time (closed form)
  rng: Stream,                                                   // stream(slotSeed, 'build', partKey)
  owner: string,                                                 // 'text' | 'ornament#1' | 'ground' | 'atmos' | 'lens'
  hints: { focus: Box, free: Box[], lines: Box[], emphLines: Box[], emph: Box | null } | null,  // ornaments and lens only;
                                                                 // lines = each line's (column's) rest box in reading order,
                                                                 // emphLines = the first emphasized word's part on each line it
                                                                 // touches, emph = that box when the text is one line (additive,
                                                                 // final fixes)
  envelope: (tl) => 0..1,                                        // dwell weight
}
```

### 4.18 Part registry format, the kit, and examples (FROZEN format; WP4 implements the kit, WP5 writes parts)

#### 4.18.1 Fields every part has

```js
{
  kind,                                  // stamped by the kit helper (K.arrive(...) etc.); never written by hand
  key: 'inkRise',                        // camelCase, ≥ 2 words, unique per kind, NEVER renamed after release
  label: { ja: '墨のぼり', en: 'Ink rise' },
  blurb: { ja: '…', en: '…' },           // one sentence: tooltips and the AI catalog
  tags: ['soft', 'literary'],            // vocabulary: soft hard fast slow playful serious digital organic literary bold minimal busy dark bright retro wet airy
  family: 'rise',                        // optional: similar-looking group (recency penalty)
  season: null,                          // or 'spring' | 'summer' | 'autumn' | 'winter'
  weight: 1,
  traits: { orient: ['h','v'], cells: [1, 40], energy: [0, 1], scripts: ['*'], aspects: ['*'],
            roles: ['lyric','focus'], impact: false },            // all optional; these are the defaults
  fits: undefined,                       // optional (f, chosen) => number ≥ 0 — prefer traits
  gate: undefined,                       // optional amount key: weight × amounts[gate]; 0 excludes
  pool: true,                            // false = only by pin or rule (e.g. instantShow)
  fallback: false,                       // exactly one per part kind
  needs: [],                             // 'blur' 'shard' 'mask' 'depth' 'beats' 'level' 'textAt' (fingerprint, render path, lab)
  shared: {},                            // overrides of the kind's shared params: { dur: { auto: {…}, min, max } }
  params: {},                            // part params: { name: ParamSpec }
}
```

#### 4.18.2 Kind contracts

| Kind | Required | Optional | Called by | Returns |
|---|---|---|---|---|
| `arrange` | `build(env, p)` | `motion: 'own'` (the planner then forces arrive/depart to `instantShow`/`instantHide` and dwell `stillHold`) | scene/build | `{ runs, focus, free }` |
| `arrive`, `depart` | `make(env, target, p)` (normally from `K.moves` or `K.perGlyph`) | `unit` | scene/build | `Behaviour[]` |
| `dwell` | `make(env, target, p)` (normally `K.perGlyphHold`) | | scene/build | `Behaviour[]` |
| `ground` | `build(env, p)` | `animated` | scene/buildGround | nodes via `env.sb` |
| `ornament` | `build(env, p)`, `scope: 'cut' \| 'run'`, `follow: 'text' \| 'own'` | | scene/build (cut) or buildGround (run = atmos) | nodes and behaviours via `env.sb` |
| `lens` | `make(env, cam, p)` | | scene/build | `Behaviour[]` on the camera node |
| `filter` | `apply(fx, src, p, t)`, `stage: 'shape'\|'tone'\|'light'\|'optic'\|'film'`, `cost` 1–5, `passes` (full-frame draws), `alphaSafe` | `needs: ['textAt']`, `texture: true` (eligible for the work `texture` slot) | render/post | a Surface (`src` = no-op) |
| `seam` | `mix(fx, a, b, u, p)`, `scope: 'text' \| 'world'` | `replaces: { depart, arrive }` | render/seam | a Surface |
| `theme` | `swatch` (7 tokens), `faces`, `style`, `dark`, `texture` | `season`, `prefer` | planner/look | — |
| `mood` | `tagBias`, `amounts`, `themes`, `pace: { seam, focus }`, `variety`, `filters` | `keywords` | planner | — |

#### 4.18.3 The kit (`parts/kit.js`, FROZEN exports)

```js
// definition helpers: stamp `kind`, fill defaults, merge `K.moves` output, light checks; they do NOT register anything
arrange(def) arrive(def) dwell(def) depart(def) ground(def) ornament(def) lens(def) filter(def) seam(def) theme(def) mood(def)
variant(base, patch) → def            // same kind and functions; new key/label/blurb/tags; patch.params / patch.shared merge per field
mirror(arriveDef, patch) → departDef  // time-reversed: moves tracks swap ends; perGlyph fns receive (1 − k, 1 − u); ease reversed
// motion builders
moves({ unit, tracks, curve?, expose? }) → { unit, make, params, motion }   // `motion` = the normalized spec (used by mirror)
  // tracks: { col: [from, to] | { from, to, unit } }; default units: x y z → 'em', rot kx ky rx ry → 'deg', blur → 'em', others none
  // arrive tracks must END at identity, depart tracks must START at identity (checked)
  // expose: ['y', 'blur'] → part params 'yFrom'/'blurFrom' (arrive) or 'yTo'/'blurTo' (depart), auto { value: given }
perGlyph(fn) → make          // fn(P, g, k, u, p, fc) — arrive/depart; k = eased progress, u = linear (per glyph, after stagger)
perGlyphHold(fn) → make      // fn(P, g, time, w, p, fc) — dwell; time = seconds since the glyph arrived; w = envelope weight
  // P: pooled DELTA pose, reset to identity per glyph: x y z (du), rot kx ky rx ry (DEGREES), sx sy alpha reveal (1),
  //    blur (du), tint glow shard echo (0), jx jy (du), pixel (du). The adapter merges P into the columns with §4.17.1 rules.
  // g: pooled glyph view: { index, count, em, cls, rank, word, line, emph, rnd /* 0..1 seeded */, cx, cy /* du from focus centre */, w, h }
  // fc: { tl, level, beat /* Grid.beatAt(tl) or null */, cut: { dur, impact, energy } }
// helpers
PH, ORDERS, EASES, ease(name), staggerOf(env, target, order, each, unit), pivots(env, target, unit)
shape: { rect(x, y, w, h, r?), ellipse(cx, cy, rx, ry), line(x0, y0, x1, y1), poly(points, closed), arc(cx, cy, r, a0, a1), path(cmds) }
math: { clamp, lerp, smooth, fract, wrap, TAU, DEG, noise1, noise2 }
color: { mix, rgba, contrast, luminance, distance, fitContrast }   // WCAG ratio, relative luminance, OKLab distance (additive)
pickOf(rng, array), rangeOf(rng, lo, hi)
```

Rules for part authors (reviewed; the harness catches most): use `K.moves` whenever the motion is "interpolate some columns
per glyph/word/line"; use `K.perGlyph*` for anything else per glyph; write raw `Behaviour.run` over columns only for
camera, multi-node or performance-critical parts, and get a WP4 review. Never keep state between frames.

#### 4.18.4 Example: composition (`arrange`)

```js
/* 文字PVメーカー v2 — original work. Vertical compositions. */
MV.def('parts/arrange/columns', ['parts/kit'], (K) => [
  K.arrange({
    key: 'pillarColumns',
    label: { ja: '縦の柱', en: 'Pillar columns' },
    blurb: { ja: '縦書きの列を右から左へ並べる', en: 'Vertical columns set right to left' },
    tags: ['literary', 'slow', 'minimal'],
    family: 'vertical',
    traits: { orient: ['v'], cells: [2, 40], roles: ['lyric', 'focus', 'title'] },
    params: {
      cols:   { type: 'int', min: 1, max: 5, label: { ja: '列数', en: 'Columns' }, auto: { range: [1, 3], follow: 'cells' } },
      anchor: { type: 'enum', of: ['right', 'center', 'left'], label: { ja: '寄せ', en: 'Anchor' },
                auto: { pick: ['right', 'center'], weights: [2, 1] } },
      step:   { type: 'num', min: 0, max: 1.5, step: 0.05, unit: 'em', label: { ja: '段差', en: 'Step down' },
                auto: { range: [0, 0.9], follow: 'amount.density', jitter: 0.4 } },
      rule:   { type: 'bool', label: { ja: '区切り線', en: 'Rules' }, auto: { pick: [false, true], weights: [3, 2] } },
    },
    build(env, p) {
      const { D, cut, sb, text, textStyle } = env;
      const spans = text.columns(cut.text, p.cols, cut.lang);
      const tallest = Math.max(...spans.map(([a, b]) => text.cells(cut.text.slice(a, b))));
      const colH = D.h * 0.74;
      const em = Math.min(colH / (tallest + p.step * (spans.length - 1)), D.short * 0.17) * textStyle.scale;
      const pitch = em * 1.5, blockW = pitch * (spans.length - 1) + em;
      const shift = p.offsetX * D.w;
      const right = (p.anchor === 'right' ? D.w - D.safe.r - em / 2
                   : p.anchor === 'left' ? D.safe.l + blockW - em / 2 : D.cx + blockW / 2 - em / 2) + shift;
      const top = D.cy - colH / 2 + p.offsetY * D.h;
      const block = sb.group({ layer: 'text', owner: 'text' });
      const runs = spans.map(([a, b], i) => sb.text({
        parent: block, span: [a, b], orient: 'v', face: textStyle.face, size: em,
        box: { x: right - i * pitch - em / 2, y: top + i * p.step * em, w: em, h: colH },
        align: 'start', fit: 'shrink', maxLines: 1, breakAt: 'none',
        ink: textStyle.ink, emphInk: 'accent', style: textStyle.style, revealMode: 'wipeY',
      }));
      if (p.rule) for (let i = 1; i < spans.length; i++) {
        const x = right - (i - 0.5) * pitch;
        sb.shape({ parent: block, layer: 'text', path: K.shape.line(x, top + em, x, top + colH - em), stroke: 'muted', width: 2 });
      }
      const focus = sb.bounds(block);
      return { runs, focus, free: sb.freeAround(focus) };
    },
  }),
]);
```

#### 4.18.5 Example: entrance (`arrive`) — declarative and per-glyph

```js
/* 文字PVメーカー v2 — original work. Soft and flip entrances. */
MV.def('parts/arrive/soft', ['parts/kit'], (K) => {
  const inkRise = K.arrive({
    key: 'inkRise',
    label: { ja: '墨のぼり', en: 'Ink rise' },
    blurb: { ja: 'ぼかしが晴れながら一文字ずつ浮かぶ', en: 'Each glyph floats up while its blur clears' },
    tags: ['soft', 'literary', 'slow'], family: 'rise', needs: ['blur'],
    traits: { energy: [0, 0.8] },
    shared: { dur: { auto: { range: [0.45, 0.8], follow: '-energy' } }, each: { auto: { range: [0.03, 0.06] } },
              ease: { auto: { value: 'expoOut' } } },
    ...K.moves({ unit: 'glyph', tracks: { y: [0.55, 0], alpha: [0, 1], blur: [0.12, 0], tint: [1, 0] },
                 curve: { alpha: 'quadOut' }, expose: ['y', 'blur'] }),
  });
  const hingeFlip = K.arrive({
    key: 'hingeFlip',
    label: { ja: 'ちょうつがい', en: 'Hinge flip' },
    blurb: { ja: '文字が真横から回って正面を向く', en: 'Glyphs swing in from edge-on' },
    tags: ['bold', 'playful', 'digital'], family: 'flip', needs: ['depth'],
    traits: { energy: [0.3, 1], cells: [1, 24] },
    params: {
      axis:  { type: 'enum', of: ['x', 'y'], label: { ja: '軸', en: 'Axis' }, auto: { pick: ['y', 'x'], weights: [2, 1] } },
      depth: { type: 'num', min: 0, max: 600, step: 10, unit: 'du', label: { ja: '奥行き', en: 'Depth' },
               auto: { range: [120, 360], follow: 'energy' } },
    },
    make: K.perGlyph(hinge),
  });
  function hinge(P, g, k, u, p) {            // factory-level function: no per-build closures
    const ang = (1 - k) * 90;                 // degrees: edge-on → facing
    if (p.axis === 'x') P.rx += ang; else P.ry += ang;
    P.z += (1 - k) * p.depth;
    P.alpha *= u < 0.08 ? u / 0.08 : 1;
  }
  return [inkRise, hingeFlip];
});
```

#### 4.18.6 Example: hold (`dwell`)

```js
MV.def('parts/dwell/wave', ['parts/kit'], (K) => {
  function wave(P, g, time, w, p) { P.y += Math.sin(time * 4 * p.speed - g.index * 0.7) * p.height * 2 * p.amount * w * g.em; }
  return [K.dwell({
    key: 'waveRun',
    label: { ja: '波', en: 'Wave run' },
    blurb: { ja: '文字の列を小さな波が流れる', en: 'A small wave travels along the text' },
    tags: ['playful', 'organic'], family: 'wave',
    params: { height: { type: 'num', min: 0, max: 0.4, step: 0.01, unit: 'em', label: { ja: '高さ', en: 'Height' },
                        auto: { range: [0.04, 0.14], follow: 'energy' } } },
    make: K.perGlyphHold(wave),
  })];
});
```
Helper functions live **inside** the factory (the build rejects any statement outside the single `MV.def(...)` call, and
anything at file level would become a global once the files are concatenated). They are created once per module, never
per build.

#### 4.18.7 Example: exit (`depart`) — mirrored and per-glyph

Parts may depend only on `parts/kit`, so a mirrored exit lives in the same file as its entrance:

```js
// inside parts/arrive/soft.js, added to the returned array:
K.mirror(inkRise, { key: 'inkSink', label: { ja: '墨しずみ', en: 'Ink sink' },
                    blurb: { ja: 'ぼけながら沈んで消える', en: 'Glyphs sink and blur away' } }),
```
and a stand-alone exit:

```js
MV.def('parts/depart/wind', ['parts/kit'], (K) => {
  function blow(P, g, k, u, p) {
    const s = p.dir === 'right' ? 1 : -1;
    P.x += s * k * k * 6 * g.em;
    P.y -= (k * p.lift + Math.sin(k * 3 + g.rnd * 6) * 0.2 * k) * g.em;
    P.rot += s * k * (120 + g.rnd * 180);
    P.alpha *= 1 - k;
  }
  return [K.depart({
    key: 'windBlow',
    label: { ja: '吹き流し', en: 'Wind blow' },
    blurb: { ja: '文字が一つずつ横へ吹き飛ばされる', en: 'Glyphs are blown sideways one by one' },
    tags: ['organic', 'airy', 'fast'], family: 'scatter',
    shared: { order: { auto: { pick: ['lead', 'scatter'] } }, ease: { auto: { value: 'quadIn' } } },
    params: {
      dir:  { type: 'enum', of: ['left', 'right'], label: { ja: '向き', en: 'Direction' }, auto: { pick: ['right', 'left'], weights: [2, 1] } },
      lift: { type: 'num', min: 0, max: 3, step: 0.05, unit: 'em', label: { ja: '舞い上がり', en: 'Lift' }, auto: { range: [0.5, 1.5] } },
    },
    make: K.perGlyph(blow),
  })];
});
```

#### 4.18.8 Example: background (`ground`)

```js
MV.def('parts/ground/water', ['parts/kit'], (K) => {
  function tide(g, t, d, q) {                  // pure in (t, d, q)
    const W = d.w * 1.3, H = d.h * 1.3, x0 = (d.w - W) / 2, y0 = (d.h - H) / 2, step = q.draft ? 96 : 48;
    g.save(); g.translate(d.w / 2, d.h / 2); g.rotate(d.tilt); g.translate(-d.w / 2, -d.h / 2);
    g.fillStyle = d.fills[0]; g.fillRect(x0, y0, W, H);
    const bh = H / d.n;
    for (let i = 1; i < d.n; i++) {
      const base = y0 + i * bh, ph = K.math.TAU * (d.phase[i] + d.speed * t);
      g.beginPath(); g.moveTo(x0, y0 + H);
      for (let x = x0; x <= x0 + W + step; x += step)
        g.lineTo(x, base + Math.sin(x * 0.004 + ph) * d.swell + Math.sin(x * 0.0017 - ph * 0.6) * d.swell * 0.5);
      g.lineTo(x0 + W + step, y0 + H); g.closePath(); g.fillStyle = d.fills[i]; g.fill();
    }
    g.restore();
  }
  return [K.ground({
    key: 'tideBands',
    label: { ja: '潮の帯', en: 'Tide bands' },
    blurb: { ja: '色の帯が波のようにゆっくりうねる', en: 'Bands of color swell slowly like a tide' },
    tags: ['wet', 'slow', 'soft'], animated: true,
    params: {
      bands:  { type: 'int', min: 3, max: 14, label: { ja: '帯の数', en: 'Bands' }, auto: { range: [5, 9] } },
      swell:  { type: 'num', min: 0, max: 140, unit: 'du', label: { ja: 'うねり', en: 'Swell' }, auto: { range: [18, 90], follow: 'amount.motion' } },
      speed:  { type: 'num', min: 0, max: 0.5, step: 0.01, unit: 'Hz', label: { ja: '速さ', en: 'Speed' }, auto: { range: [0.03, 0.11], follow: 'energy' } },
      tilt:   { type: 'num', min: -20, max: 20, unit: 'deg', label: { ja: '傾き', en: 'Tilt' }, auto: { range: [-6, 6] } },
      toward: { type: 'ink', label: { ja: '混ぜる色', en: 'Blend toward' }, auto: { pick: ['shiftA', 'accent', 'muted'], weights: [3, 1, 1] } },
    },
    build(env, p) {
      const { sb, pal, D, rng } = env;
      const fills = [];
      for (let i = 0; i < p.bands; i++) fills.push(K.color.mix(pal.ground, pal[p.toward] || p.toward, 0.06 + 0.42 * p.amount * i / (p.bands - 1)));
      sb.paint({ layer: 'ground', bleed: 0.15, animated: p.speed > 0 && p.swell > 0, owner: env.owner,
                 data: { n: p.bands, swell: p.swell, speed: p.speed, tilt: p.tilt * K.math.DEG, phase: rng.floats(p.bands), fills, w: D.w, h: D.h },
                 draw: tide });
    },
  })];
});
```

#### 4.18.9 Example: decoration (`ornament`)

```js
MV.def('parts/ornament/marks', ['parts/kit'], (K) => [
  K.ornament({
    key: 'cornerTicks',
    label: { ja: '角の印', en: 'Corner ticks' },
    blurb: { ja: '文字のまとまりの四隅に細いL字', en: 'Thin L-marks at the corners of the text block' },
    tags: ['minimal', 'serious'], scope: 'cut', follow: 'text',
    params: {
      size:  { type: 'num', min: 0.02, max: 0.2, step: 0.005, unit: 'frac', label: { ja: '長さ', en: 'Length' }, auto: { range: [0.04, 0.08] } },
      gap:   { type: 'num', min: 0, max: 80, step: 1, unit: 'du', label: { ja: '間隔', en: 'Gap' }, auto: { range: [18, 40] } },
      width: { type: 'num', min: 1, max: 8, step: 0.5, unit: 'du', label: { ja: '太さ', en: 'Width' }, auto: { pick: [2, 3] } },
    },
    build(env, p) {
      const { sb, hints, D } = env;
      const b = hints.focus, L = p.size * D.short, gp = p.gap;
      const x0 = b.x - gp, y0 = b.y - gp, x1 = b.x + b.w + gp, y1 = b.y + b.h + gp;
      for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]])
        sb.shape({ layer: 'near', owner: env.owner, stroke: p.ink, width: p.width, alpha: 0.4 + 0.6 * p.amount,
                   path: K.shape.poly([x + sx * L, y, x, y, x, y + sy * L], false) });
    },
  }),
]);
```

#### 4.18.10 Example: camera (`lens`)

```js
MV.def('parts/lens/beat', ['parts/kit'], (K) => {
  function zoom(P, t, b) {                                // closed form: seconds since the last beat
    const k = 1 + b.punch * Math.exp(-b.grid.beatAt(t).since / b.decay);
    P.sx[b.from] *= k; P.sy[b.from] *= k;
  }
  return [K.lens({
    key: 'beatZoom',
    label: { ja: '拍ズーム', en: 'Beat zoom' },
    blurb: { ja: '拍ごとに少し寄ってすぐ戻る', en: 'A small punch-in on every beat' },
    tags: ['fast', 'bold'], needs: ['beats'],
    fits: (f) => (f.beat ? 1.3 : 0),                     // needs a beat grid
    params: {
      punch: { type: 'num', min: 0, max: 0.2, step: 0.005, unit: 'x', label: { ja: '寄り', en: 'Punch' }, auto: { range: [0.015, 0.06], follow: 'amount.camera' } },
      decay: { type: 'num', min: 0.05, max: 0.6, step: 0.01, unit: 's', label: { ja: '戻り', en: 'Decay' }, auto: { range: [0.12, 0.3] } },
    },
    make(env, cam, p) {
      return [{ phase: K.PH.LENS, live: 'always', from: cam, to: cam + 1, t0: env.times.a, t1: env.times.b,
                run: zoom, grid: env.grid, punch: p.punch * (0.5 + p.amount), decay: p.decay }];
    },
  })];
});
```

#### 4.18.11 Example: screen effect (`filter`) and the FxContext

```js
MV.def('parts/filter/optic', ['parts/kit'], (K) => [
  K.filter({
    key: 'chromaSlip',
    label: { ja: '色ずれ', en: 'Chroma slip' },
    blurb: { ja: '色が左右にずれ、拍や見せ場で強くなる', en: 'Color channels slide apart, harder on beats and impacts' },
    tags: ['digital', 'hard', 'fast'], gate: 'chroma',
    stage: 'optic', cost: 4, passes: 7, alphaSafe: false,
    params: {
      spread: { type: 'num', min: 0, max: 48, unit: 'du', label: { ja: 'ずれ幅', en: 'Spread' }, auto: { range: [4, 24], follow: 'amount.chroma' } },
      angle:  { type: 'num', min: -180, max: 180, unit: 'deg', label: { ja: '角度', en: 'Angle' }, auto: { pick: [0, 0, 90, 30] } },
      kick:   { type: 'num', min: 0, max: 4, step: 0.1, label: { ja: '跳ね', en: 'Kick' }, auto: { range: [1, 3], follow: 'amount.glitch' } },
    },
    apply(fx, src, p, t) {
      const pulse = 1 + p.kick * fx.impulse('slip', t) + 0.3 * (fx.noise(t * 3) - 0.5);
      const d = p.amount * p.spread * pulse * fx.unit;               // device px
      if (d < 0.5) return src;                                        // invisible → no passes
      const a = p.angle * K.math.DEG, dx = Math.cos(a) * d, dy = Math.sin(a) * d;
      const r = fx.isolate(src, 'r'), c = fx.isolate(src, 'c');
      const out = fx.take(), g = out.ctx;
      g.globalCompositeOperation = 'lighter';
      g.drawImage(r.canvas, dx, dy); g.drawImage(c.canvas, -dx, -dy);
      g.globalCompositeOperation = 'source-over';
      fx.give(r); fx.give(c);
      return out;
    },
  }),
]);
```

FxContext (FROZEN; `engine/render/post.js`):
```js
fx = {
  w, h, unit /* device px per du */, quality: 'preview'|'draft'|'export', alpha /* frame has transparency */,
  take() → Surface, give(surface),                         // pooled, cleared, frame-sized
  isolate(src, 'r'|'g'|'b'|'c'|'m'|'y') → Surface,         // src × pure color, then destination-in src (keeps alpha)
  blurred(src, px) → Surface,                              // downscaled ping-pong with ctx.filter on ≤ ¼-resolution surfaces
  impulse(kind, t) → number,                               // Σ amp·exp(−(t − ti)/decay) over impulses with 0 ≤ t − ti < 6·decay (binary search; ≤ 8 terms)
  beat(t) → { index, phase, since, bar } | null,  level(t) → 0..1,
  tick(rate, t) → integer,                                 // floor(t·rate + 1e-6): stochastic looks change at a fixed rate, not per frame
  rng(...labels) → Stream,  noise(x) → 0..1,
  tile(name: 'grain'|'halftone'|'scan'|'dust'|'fiber', seed) → CanvasImageSource,
  cut: { tl, dur, impact, energy } | null,                 // null for the work-level texture
  textAt(dt) → Surface,                                    // only when def.needs has 'textAt': re-renders the current text layers at t − dt (≤ 3 calls per frame)
  // additive: pal (the frame palette after §4.19.4), flashScale (0.3 with 点滅を抑える in the preview, 1 in export),
  // backdrop: 'scene' | 'chroma' | 'black' | 'clear' (so a part adapts without testing the key colour),
  // layer(key, paint) → CanvasImageSource: a frame-sized picture that is the same on every frame (a vignette), painted
  // once by paint(ctx, w, h) per (key, frame size) and kept (LRU, 4 layers within 64 MB); the key names everything
  // paint draws besides the size, so a kept layer and a new one hold the same pixels (§7.1)
  // own(src) → Surface: the surface to draw the result on, holding src's picture with a new surface's state. In the post
  // stack that is src itself (the stack owns every filter input and reads only what a filter returns); elsewhere, and
  // for a surface the pool did not make, a copy (take() + drawImage(src)). A filter that calls it reads src only before
  // the call and returns what it got; one that reads src while drawing (adds or shifts it) keeps take() + drawImage.
  // A filter that throws after own() has drawn on the frame: the renderer draws that frame again with own() copying,
  // so a skipped filter never leaves a trace.
}
Surface = { canvas, ctx, w, h }
```

#### 4.18.12 Example: transition (`seam`)

```js
MV.def('parts/seam/shapes', ['parts/kit'], (K) => [
  K.seam({
    key: 'irisGate',
    label: { ja: '絞り', en: 'Iris gate' },
    blurb: { ja: '円が開いて次のカットが現れる', en: 'A circle opens onto the next cut' },
    tags: ['bold', 'retro'], scope: 'world', replaces: { depart: true },
    shared: { dur: { auto: { range: [0.35, 0.7], follow: '-energy' } } },
    params: {
      cx: { type: 'num', min: 0, max: 1, step: 0.01, unit: 'frac', label: { ja: '中心X', en: 'Center X' }, auto: { range: [0.35, 0.65] } },
      cy: { type: 'num', min: 0, max: 1, step: 0.01, unit: 'frac', label: { ja: '中心Y', en: 'Center Y' }, auto: { range: [0.35, 0.65] } },
    },
    mix(fx, a, b, u, p) {
      const out = fx.take(), g = out.ctx;
      g.drawImage(a.canvas, 0, 0);
      const r = K.math.smooth(u) * Math.hypot(fx.w, fx.h) * 0.6;
      g.save(); g.beginPath(); g.arc(p.cx * fx.w, p.cy * fx.h, Math.max(0.5, r), 0, K.math.TAU); g.clip();
      g.drawImage(b.canvas, 0, 0); g.restore();
      return out;
    },
  }),
]);
```

#### 4.18.13 Example: theme

```js
MV.def('parts/theme/paper', ['parts/kit'], (K) => [
  K.theme({
    key: 'sumiWashi',
    label: { ja: '墨と和紙', en: 'Sumi & washi' },
    tags: ['organic', 'literary', 'soft'], season: null, dark: false, fallback: true,
    swatch: { ground: '#EFE9DC', ground2: '#E2D9C6', ink: '#1C1A17', accent: '#B8322A',
              shiftA: '#3E6E8C', shiftB: '#C9A15B', muted: '#8C8577' },
    faces: {
      display: { ja: 'Yuji Syuku',          latin: 'Fraunces',           weight: 400, flavor: 'brush' },
      serif:   { ja: 'Shippori Mincho B1',  latin: 'Cormorant Garamond', weight: 600, flavor: 'mincho' },
      body:    { ja: 'Zen Kaku Gothic New', latin: 'Inter',              weight: 500, flavor: 'gothic' },
    },
    style: 'plain',
    texture: 'paperTooth',
    prefer: { ground: { washiFiber: 3, flatFill: 1.5 }, filter: { grainFilm: 2 } },
  }),
]);
```

#### 4.18.14 Example: mood

```js
MV.def('parts/mood/calm', ['parts/kit'], (K) => [
  K.mood({
    key: 'quietHush', fallback: true,
    label: { ja: '静けさ', en: 'Hush' },
    tagBias: { soft: 1.8, slow: 1.6, minimal: 1.5, organic: 1.3, literary: 1.3, airy: 1.2,
               fast: 0.3, digital: 0.25, busy: 0.4, hard: 0.4, playful: 0.6, bold: 0.6, bright: 0.8 },
    amounts: { motion: 0.3, glitch: 0, chroma: 0.05, ornament: 0.35, density: 0.3, texture: 0.5,
               groundSwitch: 0.2, flash: 0, shake: 0.05, camera: 0.3, pace: 0.3 },
    themes: { sumiWashi: 2, frostGlass: 1.5, mossStone: 1.4, snowLantern: 1.3, monoPress: 1.2 },
    pace: { seam: 0.35, focus: 0.3 },
    filters: { grainFilm: 0.6, edgeShade: 0.7, softVeil: 0.2 },   // weights for filter#i picks (others × 0.2)
    variety: 0.8,
    keywords: ['calm', 'quiet', 'ballad', '静か', '穏やか', 'しっとり', 'バラード'],
  }),
]);
```

### 4.19 Frame and renderer: `engine/scene/frame.js`, `engine/render/*` (WP4)

#### 4.19.1 `frameAt(plan, t)` (FROZEN contract)

```js
frameAt(plan, t, out?) → FrameGraph        // pure in (plan, t); `out` is an optional pooled object that is overwritten
FrameGraph = {
  t,
  cuts: [{ i /* index in plan.cuts */, tl /* t − cut.t0 */ }],   // every cut with a ≤ t < b, sorted by a (≤ 3 in practice)
  grounds: [{ i, tl /* t − seg.t0 */ }],                          // 1, or 2 while a world seam is active
  seam: null | { i /* index in plan.seams */, u /* 0..1 */, scope, aCuts: [indices], bCuts: [indices], aGround, bGround },
  post: { texture: plan.look.texture | null, accents: [{ cut: i, slot: 'filter#0', tl }] },   // the current cut's filters
  backdrop: plan.look.backdrop,
}
```
"Current cut" for accents = the last cut in `cuts` whose `t0 ≤ t` (else the first). During a seam window the accents of
`b` apply after `u = 0.5`.

#### 4.19.2 `renderFrame(surface, t, opts)` (per frame, in this order)

1. `fg = frameAt(plan, t)`; make sure every needed scene exists (export: build synchronously; preview: build or use a
   provisional scene; missing scenes are built in idle time around the playhead).
2. For each active scene: reset live pose from base; run behaviours (§4.17.4) at its local time; solve world transforms.
3. Per world (one, or A and B during a world seam): clear/fill according to the backdrop mode; draw the ground segment's
   layers, then each active cut's layers in LAYERS order (`far → mid → text → near`), applying the camera per layer;
   `hud` last with no camera. Default (no seam): cuts overlap naturally (A's exit and B's entrance draw into the same layers
   in `a` order).
4. Text seam: A's and B's `text`/`near` layers are drawn into two pooled surfaces and composed with `seam.mix`; the ground
   is drawn once underneath. World seam: two complete worlds into two surfaces, then `seam.mix`; the post stack then runs
   once on the result (never per world).
5. Post stack: `texture` then accent filters, sorted by stage (`shape → tone → light → optic → film`) then key; each
   `apply(fx, src, p, t)` ping-pongs pooled surfaces.
6. Selection outlines are **not** part of `renderFrame`; the UI draws them on its own overlay canvas from `engine.boxes()`.

`opts = { quality: 'preview' | 'draft' | 'export', pick: boolean, backdrop?: override, scale: device px per du }`.

#### 4.19.3 Camera and parallax (FROZEN)

The camera node's live pose gives `camX = x`, `camY = y`, `zoom = sx`, `roll = rot`, `shake = (jx, jy)`. Impulses add
`shake` (`jx, jy` = `amp · (noise2(seed, t·23, 0) − 0.5) · 40 du`) and `punch` (`zoom × (1 + 0.04·amp·e^(−τ/decay))`).
Per layer with parallax `k`:
`view(k) = T(W/2, H/2) · S(1 + (zoom − 1)·k) · R(−roll·k) · T(−W/2 − (camX + shakeX)·k, −H/2 − (camY + shakeY)·k)`.
Grounds are painted with `bleed` (default 15%) so camera moves never show an edge.

#### 4.19.4 Backdrop modes (FROZEN)

| Mode | Ground layer | Colors | Filters |
|---|---|---|---|
| `scene` | drawn | theme palette | all |
| `chroma` | not drawn; frame filled `#00B140` | palette adjusted (§4.16.3) | only `alphaSafe` filters and `stage: 'shape'` |
| `black` | not drawn; frame filled `#000000` | ink/accent white, shifts grey | only `shape` and `film` stages |
| `clear` | not drawn; frame cleared (alpha) | theme palette | only `alphaSafe` filters (the inspector marks skipped ones) |

#### 4.19.5 Glyph drawing (FROZEN rule — preview and export always take the same path)

The path is chosen **only from the glyph's pose state at that frame**, never from its size or the output scale:

- **Direct path** when `blur < 0.05 du`, `glow < 0.01`, `shard = 0`, `pixel < 1`: `setTransform(view · world · deviceScale)`,
  then `fillText` (plus `strokeText` for `outline`, an offset `fillText` in the shadow ink for `shadow`, a second offset
  fill in `shiftA` for `duo`; `tint` = a second `fillText` in the accent ink at alpha `tint`). `reveal < 1` clips to the
  reveal shape (`wipeX`/`wipeY`/`diag` rect, `iris` circle, `lines` slats) with save/clip/restore.
- **Sprite path** otherwise: a cached bitmap of the glyph, key = (font css, grapheme, device size bucket `2^(k/4)` px,
  ink hex after flip shading, style, blur level). Blur levels are `0, 2, 4, 8, 16, 32 du`; a blur between two levels
  crossfades the two sprites (alpha `1 − f` and `f`). The sprite raster is at most 512 px per side; above that it is
  rasterized smaller and scaled up (only blurred/shattered/pixelated glyphs use sprites, so the resampling is invisible).
  A blurred raster whose blur is wider than 4 raster px is also rasterized smaller (a Gaussian that wide holds nothing
  finer than that grid; the key is unchanged, so a raster stays a function of its key).
  `glow` draws the level-8 sprite in the accent ink with `lighter` at alpha `glow` under the glyph. `shard` draws 6 seeded
  strips of the sprite; `pixel` draws the sprite through a small canvas with smoothing off.
- Rotated vertical glyphs (`rot` flag) and tate-chu-yoko cells use the same two paths with the extra local rotation/scale.
- **Parity requirement** (browser test): at the same transform, the level-0 sprite and the direct path differ by a mean
  absolute error ≤ 2/255 over 20 glyphs at 1080p, so the switch at the start/end of a blur is invisible.

Sprite cache: LRU by bytes, 96 MB (48 MB when the output short side ≥ 1440 and the preview is running at the same time).

#### 4.19.6 Other draw paths

- **Shapes**: `ShapeSpec = { ops: Uint8Array, pts: Float32Array }` (engine-owned data) replayed as path calls; an optional
  `Path2D` cache per node through the canvas factory.
- **Paints**: called with the layer transform; nodes with `animated: false` (and static layers) are rasterized once per
  (segment, output size) and then only moved by the camera.
- **Particles**: per-particle arrays generated once at build from `stream(slotSeed, 'build', key)`; positions closed-form
  (§4.17.3); drawn as cached sprites.

#### 4.19.7 Picking (`engine/render/pick.js`)

When `opts.pick` is true, every drawn node whose `flags` has *pickable* writes its world quad and owner into a reused
PickList. `hitTest(x, y)` (design units) returns hits **top-first**: `[{ cut, line, owner, slot?, node }]` (the UI cycles
through them with Alt+click). `boxes()` returns the owners' union quads of the last frame. No pixels are read back.

#### 4.19.8 Ctx2D subset and the recording context (FROZEN)

Engine and part code may use only: `save restore setTransform transform translate rotate scale`, the properties
`globalAlpha globalCompositeOperation fillStyle strokeStyle lineWidth lineCap lineJoin font textAlign textBaseline
imageSmoothingEnabled`, `setLineDash beginPath moveTo lineTo quadraticCurveTo bezierCurveTo arc ellipse rect closePath
fill stroke clip fillRect clearRect strokeRect fillText strokeText drawImage createLinearGradient createRadialGradient
createPattern`, and (engine only, never parts) `filter` inside sprite rasterization and `fx.blurred`. No `getImageData`,
`putImageData`, `measureText` (except the measurer), `Path2D` (except the factory cache).

```js
CanvasFactory = { create(w, h, { alpha }) → { canvas, ctx } }       // engine/host/canvas.js (OffscreenCanvas) | engine/render/record.js
createRecorder() → { factory: CanvasFactory, ops() → Op[], hash() → hex, stats() → { saves, restores, maxDepth, alphaRange, nan } }
```
The recording context logs every call with arguments rounded to 1e-3, tracks save/restore balance, alpha range and any
NaN/Infinity. It is what the Node conformance and golden tests run on.

### 4.20 Engine facade: `engine/facade.js` (WP4, FROZEN API)

```js
createEngine({ registry, canvas: CanvasFactory, measurer: Measurer, fonts: FontBook | null, assets: AssetStore | null }) → Engine
Engine = {
  setDoc(doc) → { plan, changedCuts: string[], changedGrounds: string[] },   // re-plans (memoized by doc identity) and
                                                                            // invalidates scenes whose fp changed
  plan,                                                                     // current Plan
  prepare(t0, t1, { export = false }) → Promise<void>                       // fonts ready (export waits), scenes built, sprites warmed
  renderFrame(surface, t, opts) → FrameStats                                // §4.19.2
  hitTest(x, y) → Hit[]                                                     // design units, from the last pick-enabled frame
  boxes() → [{ cut, line, owner, quad: Float32Array(8) }]
  thumb(ref: { kind, key, params? }, surface, { t, text?, textB?, theme?, aspect? })  // canned sample cut; deterministic;
                                                                            // textB = the line a seam cuts to (additive)
  warnings() → Warning[]                                                    // plan warnings + scene warnings (overfull, font-fallback)
  fork() → Engine                                                           // frozen snapshot (same registry and services) for export
  stats() → { frameMs, stageMs: { behave, draw, post }, spriteBytes, surfaces, scenes, spritesMade }
  dispose()
}
// Additive: createEngine({ …, now?, idle?, strict?, spriteBudget? }) (host clock, idle yield, tests' strict mode, a sprite
// budget replacing §7.3's); setPlan(plan), scene(kind, i), fontUsage(t0, t1), setLevel(n) (きれい優先 holds level 0).
// prepare() in the preview warms the sprites of the next 3 s after the playhead (renderer.warmAt walks the draw path with
// no target) until they fill 0.9 of the sprite budget; ui/boot prepares again every 1.5 s of playback.
FrameStats = { ms, drawn: { glyphs, shapes, paints, particles }, passes, provisional: boolean }
AssetStore = { get(id) → CanvasImageSource | null }                         // user images (photoPan ground); v2.0 may ship empty
```

### 4.21 Export: `export/schedule`, `export/zip`, `export/muxer` (pure) and `export/host/*` (WP6)

```js
// schedule (FROZEN math)
frameCount(duration, fps) = Math.ceil(duration * fps - 1e-9)
ts(i, fps) = Math.round(i * 1e6 / fps)                     // µs timestamp of frame i
frameDur(i, fps) = ts(i + 1, fps) - ts(i, fps)             // never a constant round(1e6 / fps)
audioFrames(N, fps, rate) = Math.round(N * rate / fps)     // the audio track is trimmed or zero-padded to exactly this many samples
outputSize(aspect, short) → { w, h }                       // short side = short, long side = round to the nearest even number
bitrate(w, h, fps, quality) → bits/s                       // 0.08 / 0.12 / 0.18 bits per pixel per frame for standard / high / max
estimateBytes(duration, bitrate, audio) → number
eta(samples: [{ i, ms }], remaining) → seconds             // EMA (α = 0.1) of per-frame time
pickAvc(w, h, fps) → ['avc1.640028' (≤ 1920×1080×30), 'avc1.64002A' (1080p60), 'avc1.640032' (1440p), 'avc1.640033' (2160p30), 'avc1.640034' (2160p60),
                      then the Main (4D) and Baseline (42E0) variants of the same levels]   // tried in order with isConfigSupported
// zip (store-only, streaming)
createZip(write: (Uint8Array) => Promise<void>) → { add(name, bytes), finish() }   // own CRC32 (table-driven), local headers + central directory
crc32(bytes) → uint32
// muxer adapter (the only module that uses the vendor library; it receives it by injection, so it stays Node-testable with a fake)
createMuxer({ lib /* the Mp4Muxer namespace, injected by export/host/mp4.js */, target: 'stream' | 'memory', write?, w, h, fps,
              audio: { rate, channels } | null }) → Muxer
Muxer = { video(chunk, meta), audio(chunk, meta), finish() → Promise<ArrayBuffer | null> }
  // Mp4Muxer.Muxer with FileSystemWritableFileStreamTarget/StreamTarget (fastStart: false) or ArrayBufferTarget (fastStart: 'in-memory')

// host
exportVideo({ engine, doc, audio: AudioBuffer | null, sink: Sink, signal, onProgress }) → Promise<Result>
exportPngs({ engine, doc, alpha: boolean, sink: Sink, signal, onProgress }) → Promise<Result>
Sink = createFileSink(fileHandle) | createMemorySink()      // export/host/sink.js (File System Access when available)
Result = { bytes, frames, ms, name, blob? /* memory sink only */ }
```

`exportVideo` steps (FROZEN): `e = engine.fork()`; `await e.prepare(t0, t1, { export: true })`; `N = frameCount(t1 − t0,
fps)`; configure `VideoEncoder` with the first supported codec from `pickAvc`, key frame every `2·fps` frames; for each
`i < N`: `e.renderFrame(surface, t0 + i / fps, { quality: 'export', scale })`, `new VideoFrame(surface.canvas,
{ timestamp: ts(i), duration: frameDur(i) })`, `encode`, `close`; wait while `encodeQueueSize > 6`; check `signal`; report
`{ i, N, eta }`. Audio: `AudioEncoder` `mp4a.40.2`, source rate (44.1/48 kHz), 2 channels, 1024-frame `AudioData` chunks
covering `[t0, t1)` trimmed/padded to `audioFrames(N, fps, rate)`. Cancel: `encoder.close()`, `sink.abort()` (the partial
file is discarded). The preview pauses during export; the UI may keep editing because the export uses the fork.

Pre-flight (pure, `export/schedule.preflight(doc, plan, env)`): WebCodecs present; codec supported; fonts ready; File
System Access or a memory-size warning (> 1.5 GB estimate asks for confirmation); flash-rate check (> 3 flashes in any 1 s
window from `plan.impulses` of kind `flash` plus `whiteFlash`/`flashPop` parts) with the fix command
`pin.set work:amount.flash 0.3`; `overfull` and `font-fallback` warnings. Returns `[{ code, level, params, jump? }]`.

### 4.22 AI adapter: `ai/*` (WP7)

Providers, key handling, prompts, closed JSON schemas, validation rules and error codes are fixed below; every request
addresses lines by id, and every answer changes the project only through v2 commands.

#### 4.22.1 Providers (`ai/providers.js`)

`PROVIDERS` (gemini default `gemini-3.8-flash`; the second AI service with three models, largest first; key URLs and
prices per model), `DEFAULT_PROVIDER`, `costUSD(provider, model, usage)`, `AIError(code, message, extra)`,
`call({ provider, model, apiKey, system, prompt, schema, effort, signal, fetchImpl, SDK, media })` → `{ json, usage, model }`,
`checkKey({ provider, model, apiKey, signal, fetchImpl, SDK })` → `{ model, name }` (free model-info request),
`KEY_SHAPE`, `keyLooksRight(provider, key)`. Gemini: REST `…/v1beta/models/<model>:generateContent`, key only in the
`x-goog-api-key` header, `responseJsonSchema`, `thinkingLevel` from effort, thought parts ignored, finish reasons and HTTP
statuses mapped to the error codes below. The second AI service: through its SDK (the SDK global injected by `ui/boot`
via `providers.setSDK()`), `dangerouslyAllowBrowser`, structured output, adaptive thinking except on the smallest model,
the server-side fallback beta on the largest model, SDK error classes mapped to the same codes, media refused
(`no_audio`). Error codes: `no_key auth rate model server
bad_request network aborted blocked truncated empty bad_json no_sdk no_audio upload bad_provider bad_edit`.

#### 4.22.2 Lyrics I/O (`ai/lyricio.js`)

```js
rowsView(doc) → [{ rowId, src, lyric, count, stamps, text, pieces, emph, impact, note }]   // parsed per row (core/lyrics)
renderChecked(row, fields) → { src, ok }        // = core/lyrics.roundTrip: the change is dropped when the words/stamps would change
editRows(doc, edits: { [rowId]: { remove: true } | { fields } }) → { text, skipped: rowId[] }
  // builds the new lyric box text; squeezes blank rows left by removals (never two in a row, none at the start or end);
  // the caller dispatches lyrics.set(text): ids survive through reconcile, so per-line settings follow without remapping
```

#### 4.22.3 Catalog text (`ai/catalog.js`)

`catalog(registry, doc, kinds = ['arrange','arrive','depart','dwell','ornament','ground'])` → `{ kind: [{ key, name,
tags (first 3), season }] }` from `registry.pool(kind, { filters: doc.filters, season: 'any' })` (the season is left to the
AI); `catalogText(cat)` → lines `[kind] key=name{season}(tag/tag/tag) …`; `themesText(registry)`, `moodsText(registry)`.

#### 4.22.4 Requests and validation

| Tool | Request builder | Validator → ChangeSet | Numbering |
|---|---|---|---|
| 歌詞の下ごしらえ | `prep.request(doc, uiLang)` (effort low) | `prep.changes(doc, json)` | lyric rows in order, 0..n (`i` → rowId) |
| 演出3案 | `looks.proposalsRequest(doc, plan, registry, uiLang)` (medium) | `looks.proposalChanges(doc, plan, registry, json)` → `{ theme, season, proposals: [{ title, concept, changes, warnings }] }` | `plan.lines` index (`i` → lineId) |
| ひとこと修正 | `looks.editRequest(doc, plan, registry, instruction, uiLang)` (low) | `looks.editChanges(…)` → `{ understood, summary, question, changes, warnings }` | `plan.lines` index |
| 書き起こし | `song.transcribeRequest(uiLang)` + audio part | `song.transcriptLines(json, duration)` → `{ lines, text /* with LRC stamps */, warnings }` | — |
| タイミング合わせ | `song.alignRequest(doc, plan, uiLang)` + audio part | `song.alignChanges(doc, plan, json, duration)` | `plan.lines` index |
| 曲の分析 | `song.analyzeRequest(uiLang)` + audio part | `song.songInfo(json, duration)` | — |

Schemas use v2 names (all objects closed, every property required, no numeric/string limits — the portability rule
shared by both services): look answers carry `theme, mood, season, amounts{motion,glitch,chroma,ornament,density,texture,groundSwitch}
(−1 = keep), flash ('keep'|'on'|'off' or boolean), palette{accent,shiftA,shiftB}, avoid[], allow[] ("kind.key"),
lines[{ i, arrange, arrive, depart, dwell, impact, emphasis[] }]`. Validation rules: unknown keys and
off-season picks dropped with a warning; amounts clamped to 0..1 and ignored when the change is < 0.01; palette only when all
three are `#RRGGBB`, accent fitted to ≥ 3:1 against the resolved ground; emphasis words must occur inside one piece and not
inside an existing emphasis; every lyric-syntax change must pass `renderChecked`; prep segments must join to the line
(spaces aside), readings ≤ 40 chars, no syntax characters; transcripts: syntax characters `/ * |` → space, leading `#` →
`＃`, trailing `!` → `！`, times sorted, bad times dropped; alignment: strictly increasing, within the song, changes ≥ 0.05 s
only; song info: sections/highlights cleaned and capped (40/8), bpm kept only in (30, 300). `songContext(doc, plan)` gives
the sections-with-line-numbers text for later look prompts.

#### 4.22.5 ChangeSet and conversion to commands (`ai/changes.js`)

```js
Change = { id, kind, scope: 'work' | 'line' | 'rows', lineId?, rowId?, path?, from, to,
           base: { rev, value?, src? },            // what the project held when the request was made (stale detection)
           label: [stringKey, params], checked: true, stale: false }
kinds: theme mood season amount flash palette avoid allow part impact emphasis cut note remove time rows songInfo
toCommands(doc, plan, changes) → Cmd[]              // the mapping below; lyric-syntax kinds are grouped per row into one lyrics.row
markStale(doc, plan, changes) → changes             // stale = current value/src differs from base (unchecked and badged in the UI)
revertCommands(doc, logEntry) → { cmds, kept: n }   // selective revert: only where the doc still holds the AI's value
```

| AI change | v2 command |
|---|---|
| `theme` | `pin.set work:theme` by `ai` |
| `mood` | `pin.set work:mood` by `ai` |
| `season` | `pin.set work:season` (`any` → `pin.clear`) |
| `amounts.k` | `pin.set work:amount.k` |
| `flash` on/off | `pin.set work:amount.flash` 0.7 / 0 |
| `palette` | `pin.set work:color.accent` (fitted), `work:color.shiftA`, `work:color.shiftB` |
| `avoid` / `allow` `kind.key` | `filter.set kind` with `deny` ± key (never empties an `only` list) |
| `lines[i].arrange/arrive/depart/dwell` | `pin.set line/<lineId>:<kind>` by `ai` |
| `impact`, `emphasis`, prep `segments`/`reading`/`remove` | `lyrics.row` (or `lyrics.set` for removals) through `renderChecked` |
| align `lines[i].start` | `pin.set line/<lineId>:start` by `ai` (wins over an LRC stamp; the review row says so) |
| transcript | `lyrics.set` (replace) or append; ids follow through reconcile |
| song analysis | `song.info` |

All accepted changes of one review are dispatched with `store.batch({ label: ['undo.ai', { tool, n }] }, cmds)` — one undo
step. The AI log entry in `side.aiLog` records `{ runId, tool, n, applied: [{ path|rowId, to }] }` for selective revert.

#### 4.22.6 Privacy and consent

Only lyric text, the instruction and setting values are sent. Audio is sent only by 曲を使う tools, only with Gemini, only
after the consent card (what is sent: "16 kHz mono WAV, about N MB, m:ss") is confirmed for this project; it goes inline
when ≤ 14 MB, otherwise through the Files API (resumable upload, poll until ACTIVE ≤ 60 s) — `audio/wav.encodeWav` and
`ai/song` (`pickRate`, `toBase64`, `audioPart`, `uploadFile`, `seconds`, `lrcTag`). Keys live in `sessionStorage` by
default or `localStorage` when the user ticks 「この端末に記憶する」; the key never appears in messages or logs.

### 4.23 UI interfaces: pure modules in `ui/*` (WP8)

The UI is DOM code, but these modules are pure and Node-tested (FROZEN signatures):

```js
// ui/layout.js
computeLayout({ w, h }, { panel: null | 'details' | 'ai', rail: boolean, drawer: boolean, aspect }) →
  { layout: 'wide' | 'standard' | 'compact' | 'stacked', tier: 'tall' | 'normal' | 'short',
    rects: { header, steps, rail, stage, preview, lane, controls, panel, side }, canvas: { w, h } }   // §6.2 formula
autoFold({ layout, openedFrom: 'lyrics' | 'preview' | 'timeline' | 'header' | 'key' | 'ai', pref }) → boolean
// ui/keys.js
KEYMAP: [{ key, ctx: 'global' | 'text' | 'tap' | 'picker' | 'palette', cmd, args?, single: boolean }]
resolveKey(ev: { key, code, ctrlKey, shiftKey, altKey, metaKey, isComposing, keyCode, targetKind: 'text'|'other' },
           ctx: { mode, singleKeys: boolean }) → { cmd, args } | null
// ui/actions.js
defineAction({ id, label: stringKey, keys?, run(ctx, args), enabled?(ctx), checked?(ctx) }) ; run(id, args) ; list(filter)
// ui/fields.js
FIELDS: FieldSpec[] ; sectionsFor(sel, plan, registry) → [{ id, label, open, fields: FieldSpec[] }]
FieldSpec = { id, path /* slot */, scopes: ('work'|'line'|'cut')[], el?: 'text'|'ornament'|'ground'|'lens'|'filter'|'seam',
              section, widget: 'part'|'choice'|'number'|'time'|'color'|'font'|'toggle'|'words'|'cutpoints'|'text'|'slots',
              label, hint?, basic: boolean, when?(ctx) → boolean }
// ui/selection.js
Sel = { level: 'work' } | { level: 'line', ids: [lineId, …] } | { level: 'cut', key }
    | { level: 'el', scope: 'work' | 'line/<id>' | 'cut/<key>', el: 'text'|'ornament'|'ground'|'lens'|'filter'|'seam', idx?: 0 }
down(sel, plan) · up(sel, plan) · validate(sel, plan) → Sel · crumbs(sel, plan) → [{ sel, label }] · onPreviewClick(sel, hits, { alt, dbl }) → Sel
// ui/looks.js
pointer(side, doc) → { index: n | null, modified: boolean, total } ; appendKind(cmd) → 'append' | 'coalesce' | 'none'
```

Contracts the UI relies on from other packages: `store` (§4.5), `commands` (§3.9), `planner.plan/fieldState/explain/
lockPayload/diff/previewMood` (§4.16.1), `engine` (§4.20), `player` (§4.13), `export` (§4.21), `ai` (§4.22), `i18n` (§4.24).

### 4.24 i18n: `i18n/strings.js`, `i18n/t.js` (WP0 kernel, WP8 content)

```js
// i18n/strings.js: one table, pairs [ja, en]; parity is structural
MV.def('i18n/strings', [], () => ({
  'app.name': ['文字PVメーカー', 'Moji PV Maker'],
  'count.lines': ['{n}行', '{n} line|{n} lines'],
  // …
}));
// i18n/t.js
createT(lang, strings, registry?) → t
t(key, params?) → string          // {name} placeholders; English plural 'a|b' chosen by params.n; missing key → dev error, ja fallback
t.part(kind, key) → string        // from the registry def label; mood/theme likewise
t.why(code, params) · t.err(code) // 'why.<code>' and 'err.ai.<code>' keys
fmtTime(seconds, { frames?, fps? }) → 'm:ss.cc' · fmtBytes(n) · fmtMoney(usd, lang) (ja shows yen at a fixed display rate)
```
Rules: no sentence concatenation; no UI text in code; the `en` page shows no Japanese except the product name and user data.

---

## 5. Part catalog to build first (all names original; keys FROZEN once shipped)

Counts: 18 compositions (+3 special), 22 entrances, 10 holds, 17 exits (+ fallbacks), 18 backgrounds, 22 decorations,
10 cameras, 16 screen effects, 11 transitions, 16 themes, 8 moods. Tags use the vocabulary of §4.18.1. "(fb)" marks the
kind's fallback. Files are suggestions for grouping (one file per family); any grouping is fine as long as each file only
depends on `parts/kit`.

### 5.1 Compositions — `arrange` (`parts/arrange/*.js`)

| Key | ja | en | Tags | Picture |
|---|---|---|---|---|
| `centerAnchor` (fb) | 中央 | Center anchor | minimal serious | The line centred in one or two balanced lines, size from the text length. |
| `stairStep` | 階段 | Stair step | playful literary | Phrases step down diagonally, each line indented one step from the one above. |
| `pillarColumns` | 縦の柱 | Pillar columns | literary slow minimal | Vertical columns set right to left, optional hairline rules between them (orient v). |
| `giantWhisper` | 大と小 | Giant & whisper | bold serious | The emphasized (or longest) word huge; the rest small, tucked beside or under it. |
| `slantBand` | 斜め帯 | Slant band | bold fast | The line set on a band tilted −8° to −20° across the frame, the band tinted `ground2`. |
| `cornerNote` | 隅書き | Corner note | minimal airy | A small caption in one corner of the safe area; most of the frame left empty. |
| `confettiWords` | 散らし | Confetti words | playful busy | Words scattered at seeded positions and small rotations, never overlapping. |
| `edgeBleed` | はみ出し | Edge bleed | bold hard | Text so large the frame edges crop it; optional knockout onto the ground. |
| `diptychSplit` | 二面 | Diptych split | serious minimal | The frame split into two panels (`ground2` / `ground`); pieces alternate between them. |
| `tickerMarquee` | 流れ帯 | Ticker marquee | fast digital | One line on a strip scrolling across the frame (`motion: 'own'`). |
| `gridMosaic` | 升目 | Grid mosaic | literary retro | Glyphs in a strict grid of square cells, like manuscript paper. |
| `haloRing` | 円環 | Halo ring | airy playful | Glyphs placed along a circle or arc around the centre, upright or tangent. |
| `sidebarIndex` | 袖書き | Sidebar index | serious minimal | A narrow column at one edge with a big line number beside the text. |
| `echoStack` | 反響 | Echo stack | wet dark | The line repeated 3–5 times, stacked with fading opacity and small offsets. |
| `spineColumn` | 背骨 | Spine column | literary slow | One tall vertical column in the centre; the note runs horizontally across it (orient v). |
| `magazineHead` | 誌面 | Magazine head | literary bold | A headline and a smaller sub-line under a rule, left aligned like an editorial page. |
| `hangingTags` | 吊り札 | Hanging tags | playful organic | Words hang from the top edge on thin threads at staggered heights. |
| `tiltedCard` | 傾いた札 | Tilted card | soft retro | Text on a slightly rotated paper card with a soft shadow. |
| `titlePlate` (role title) | タイトル札 | Title plate | serious | Title large, artist small under a rule. |
| `breathMark` (role interlude) | 間の印 | Breath mark | minimal slow | A small ♪ or the section heading, centred, slowly breathing. |
| `creditFold` (role outro) | 終わりの札 | Credit fold | minimal | Title and artist as a quiet corner credit. |

### 5.2 Entrances — `arrive` (`parts/arrive/*.js`)

| Key | ja | en | Tags | Picture |
|---|---|---|---|---|
| `inkRise` | 墨のぼり | Ink rise | soft literary slow | Each glyph floats up while its blur clears. |
| `hingeFlip` | ちょうつがい | Hinge flip | bold playful digital | Glyphs swing in from edge-on around a vertical or horizontal axis. |
| `typeOn` | 打鍵 | Type on | digital minimal | Typewriter: glyphs appear one by one behind a moving caret. |
| `fogIn` | 霧晴れ | Fog in | soft airy | The whole line fades up from a heavy blur while settling from 94% scale. |
| `dropSnap` | 落下 | Drop snap | playful bold | Glyphs fall from above and land with a small bounce. |
| `sliceReveal` | 切り出し | Slice reveal | hard minimal | Each glyph is uncovered by a wipe across its cell. |
| `curtainRise` | 幕上げ | Curtain rise | serious slow | Words are revealed from the bottom up, like a curtain rising. |
| `zoomSettle` | 寄せ | Zoom settle | bold fast | Glyphs start large and transparent and settle to size. |
| `shardGather` | 集合 | Shard gather | digital busy | Glyph fragments fly in from scattered positions and assemble. |
| `twirlArrive` | 回転 | Spin in | playful fast | Glyphs spin half a turn while growing from nothing. |
| `skewSlide` | 斜め滑り | Skew slide | fast hard | Words slide in sideways with a heavy skew that straightens on arrival. |
| `pixelStep` | 粗から | Pixel step | digital retro | Glyphs appear as coarse blocks that sharpen step by step. |
| `strobeIn` | 点滅入り | Strobe in | digital hard | Glyphs flicker on and off a few times before holding (fixed tick rate). |
| `stampPress` | 押印 | Stamp press | bold hard | Each word slams down from 160% scale with a tiny shake (trait impact). |
| `ribbonWave` | リボン | Ribbon wave | playful organic | Glyphs rise in a travelling sine wave from left to right. |
| `rainDrop` | 雨だれ | Rain drop | wet organic | Glyphs drop in from random heights in random order. |
| `ghostConverge` | 残像寄せ | Ghost converge | digital wet | Two colored ghost copies slide together into each glyph. |
| `seamJoin` | 継ぎ目 | Seam join | hard bold | The top and bottom halves of the line slide in from opposite sides and join. |
| `bloomOpen` | 花開き | Bloom open | bright soft | Glyphs grow from their centres with a glow that fades. |
| `riseFromFlat` | 起き上がり | Tilt up | playful retro | Glyphs stand up from lying flat on the baseline. |
| `staticJoin` | 乱入 | Glitch in | digital hard fast | Glyphs jitter sideways with color echoes, then lock in place (gate `glitch`). |
| `wordPop` | ぽん | Word pop | playful bright | Whole words pop in with overshoot, one word at a time. |
| `instantShow` (fb, pool false) | 即時 | Instant show | minimal | Appears at once (used by rules and `motion: 'own'`). |

### 5.3 Holds — `dwell` (`parts/dwell/*.js`)

| Key | ja | en | Tags | Picture |
|---|---|---|---|---|
| `stillHold` (fb) | 静止 | Still hold | minimal | No motion. |
| `breathePulse` | 呼吸 | Breathe | soft slow | The block scales ±2% on a slow breath. |
| `slowDrift` | 漂い | Slow drift | airy slow | The block drifts a few du in one slow direction. |
| `waveRun` | 波 | Wave run | playful organic | A small wave travels along the text. |
| `jitterShake` | 震え | Jitter | hard digital | A tiny seeded tremble per glyph. |
| `flickerLight` | ちらつき | Flicker | dark retro | Occasional brief dips in opacity at a fixed tick rate. |
| `thumpSwell` | 拍動 | Beat pulse | fast bold | The block pulses in scale on every beat (needs beats). |
| `shimmerSweep` | きらめき | Shimmer | bright playful | A band of accent tint sweeps across the glyphs. |
| `creepTrack` | にじり | Creep | slow serious | Letter spacing widens very slowly. |
| `swaySwing` | 揺れ | Sway | soft organic | The line rocks slowly around its centre. |

### 5.4 Exits — `depart` (`parts/depart/*.js`, mirrors live next to their entrance)

| Key | ja | en | Tags | Picture |
|---|---|---|---|---|
| `inkSink` | 墨しずみ | Ink sink | soft literary | Mirror of inkRise: glyphs sink and blur away. |
| `hingeClose` | 閉じ戸 | Hinge close | bold playful | Mirror of hingeFlip: glyphs turn edge-on and vanish. |
| `typeErase` | 消去 | Type erase | digital minimal | The caret deletes glyphs from the end. |
| `fogOut` | 霧隠れ | Fog out | soft airy | The line blurs and fades while growing slightly. |
| `dropAway` | 落ちる | Drop away | playful | Glyphs fall with gravity and tumble out of the frame. |
| `sliceHide` | 切り隠し | Slice hide | hard minimal | Mirror of sliceReveal. |
| `curtainFall` | 幕下げ | Curtain fall | serious slow | Mirror of curtainRise. |
| `zoomPast` | 通り抜け | Zoom past | fast bold | Glyphs rush toward the camera and fade. |
| `shardBurst` | 砕け | Shard burst | hard busy | Glyphs break into fragments that fly outward (trait impact). |
| `twirlDepart` | 回転抜け | Spin out | playful fast | Mirror of twirlArrive. |
| `skewExit` | 斜め抜け | Skew exit | fast hard | Words skew and slide out the far side. |
| `strobeOut` | 点滅抜け | Strobe out | digital hard | Glyphs flicker off. |
| `windBlow` | 吹き流し | Wind blow | organic airy fast | Glyphs are blown sideways one by one. |
| `meltDown` | 溶け | Melt down | wet dark | Glyphs stretch downward and blur as they fade. |
| `burnOut` | 燃え尽き | Burn out | bright hard | Glyphs flare in the accent color, glow, and shrink away. |
| `pileCollapse` | 崩れ | Pile collapse | playful busy | Glyphs drop and pile up at the bottom, then fade. |
| `pointImplode` | 吸い込み | Point implode | digital fast | Glyphs are pulled into one point and vanish. |
| `instantHide` (fb, pool false) | 即消 | Instant hide | minimal | Disappears at once (rules, seams that replace the exit). |

### 5.5 Backgrounds — `ground` (`parts/ground/*.js`)

| Key | ja | en | Tags | Season | Picture |
|---|---|---|---|---|---|
| `flatFill` (fb) | 無地 | Flat fill | minimal | | Solid ground with a very soft `ground2` vignette. |
| `washiFiber` | 和紙 | Washi fiber | organic literary soft | | Paper with slowly drifting fibers and uneven tone. |
| `skyGrade` | 空の階調 | Sky grade | airy soft | | A two-color vertical gradient that slowly shifts. |
| `tideBands` | 潮の帯 | Tide bands | wet slow soft | | Bands of color swell slowly like a tide. |
| `fogNoise` | 霧 | Fog noise | wet dark slow | | Slow value-noise fog of `ground2` over the ground. |
| `gridPaper` | 方眼 | Grid paper | minimal serious | | Fine grid lines, every fifth one stronger. |
| `halftoneSun` | 網点の日 | Halftone sun | retro bright | | A large halftone disc in the accent, slowly rotating. |
| `stripeShift` | 流れ縞 | Stripe shift | playful busy | | Diagonal stripes that scroll slowly. |
| `nightBokeh` | 夜のぼけ | Night bokeh | dark wet soft | | Soft out-of-focus light discs drifting. |
| `inkWash` | 墨流し | Ink wash | organic literary | | Marbled ink swirls that turn slowly. |
| `neonHaze` | ネオンの靄 | Neon haze | digital dark | | Glowing fields in `shiftA`/`shiftB` that breathe with loudness (needs level). |
| `photoPan` (pool false) | 写真 | Photo pan | soft | | A user image with slow pan and zoom (pin only; needs an image asset). |
| `spotBeam` | 照明 | Spot beam | dark serious | | A soft spotlight cone that sweeps slowly. |
| `auroraVeil` | オーロラ | Aurora veil | airy bright | | Curtains of color waving across the top. |
| `petalWash` | 花霞 | Petal wash | soft airy | spring | Pale pink haze with faint drifting petal shapes. |
| `heatShimmer` | 陽炎 | Heat shimmer | bright | summer | A warm gradient with wavering heat lines. |
| `maplePaper` | 紅葉紙 | Maple paper | organic literary | autumn | Paper with scattered maple-leaf silhouettes. |
| `snowLight` | 雪明かり | Snow light | soft slow | winter | A cold blue gradient with softly glowing snowbanks. |

### 5.6 Decorations — `ornament` (`parts/ornament/*.js`; `none` is the reserved "nothing" value, not a part)

| Key | ja | en | Scope | Tags | Season | Picture |
|---|---|---|---|---|---|---|
| `hairFrame` (fb) | 細線枠 | Hair frame | cut | minimal serious | | A thin rectangle around the text block that draws itself. |
| `bigBrackets` | 大括弧 | Big brackets | cut | literary bold | | Oversized corner brackets framing the text. |
| `cornerTicks` | 角の印 | Corner ticks | cut | minimal serious | | Thin L-marks at the four corners of the text block. |
| `orbitRing` | 周回輪 | Orbit ring | cut | airy playful | | A thin ring around the text with one dot orbiting it. |
| `pinDotBoard` | 点の列 | Dot matrix | cut | digital retro | | Rows of small dots beside the text that light up in sequence. |
| `inkSplat` | 墨はね | Ink splat | cut | organic hard | | A few ink splashes near the text. |
| `tapeStrip` | テープ | Tape strip | cut | playful retro | | Translucent tape pieces at the text block's corners. |
| `sunBurst` | 放射線 | Sun burst | cut | bright bold | | Thin rays radiating from behind the text. |
| `barCode` | バーコード | Bar code | cut | digital serious | | A small barcode with the line's start time printed under it. |
| `hankoSeal` | 印 | Hanko seal | cut | literary serious | | A red square seal stamped near the text. |
| `crossHair` | 照準 | Cross hair | cut | digital hard | | Register marks and a cross hair at the text centre. |
| `ripplePath` | 波線 | Wave line | cut | playful organic | | A wavy underline that ripples. |
| `serialMark` | 通し番号 | Serial mark | cut | minimal digital | | The line number in small monospace digits. |
| `underSweep` | 下線 | Under sweep | cut | bold minimal | | An accent underline sweeps under the emphasized word. |
| `sparkSpray` | 火花 | Spark spray | cut | bright fast | | Small sparks spray on beats and impacts. |
| `rainLines` | 雨線 | Rain lines | run | wet dark | | Slanted rain streaks across the frame. |
| `bokehDots` | 玉ぼけ | Bokeh dots | run | soft wet | | Floating soft light dots. |
| `petalFall` | 花びら | Petal fall | run | soft organic | spring | Cherry petals drifting down. |
| `fireflyGlow` | 蛍 | Firefly glow | run | soft dark | summer | Fireflies blinking and wandering. |
| `fireworkBloom` | 花火 | Firework bloom | run | bright bold | summer | Fireworks burst in the distance (closed-form bursts). |
| `leafFall` | 落ち葉 | Leaf fall | run | organic slow | autumn | Maple leaves tumbling down. |
| `snowDust` | 粉雪 | Snow dust | run | soft slow | winter | Fine snow falling with a slight sway. |

### 5.7 Cameras — `lens` (`parts/lens/*.js`)

| Key | ja | en | Tags | Picture |
|---|---|---|---|---|
| `fixedFrame` (fb) | 固定 | Fixed frame | minimal | No camera motion. |
| `slowPush` | 寄り | Slow push | slow serious | A slow push in over the cut. |
| `dollyOut` | 引き | Dolly out | slow airy | A slow pull back. |
| `driftFloat` | 漂い | Drift float | airy soft | A slow sideways drift with a slight roll. |
| `handHeld` | 手持ち | Hand held | organic | Small seeded noise motion, like a hand-held camera. |
| `beatZoom` | 拍ズーム | Beat zoom | fast bold | A small punch-in on every beat (needs beats). |
| `rollSway` | 傾き揺れ | Roll sway | soft playful | A gentle rocking roll. |
| `panSweep` | パン | Pan sweep | fast | A pan across the frame during the cut. |
| `impactKick` | 衝撃 | Impact kick | hard bold | A sharp punch-in and shake at the sung start (trait impact). |
| `parallaxOrbit` | 回り込み | Parallax orbit | airy | Layers slide against each other as if the camera circles. |

### 5.8 Screen effects — `filter` (`parts/filter/*.js`; `none` reserved)

| Key | ja | en | Stage | Tags | Picture |
|---|---|---|---|---|---|
| `chromaSlip` | 色ずれ | Chroma slip | optic | digital hard fast | Color channels slide apart, harder on beats and impacts (gate `chroma`). |
| `sliceGlitch` | 裂け目 | Slice glitch | shape | digital hard | Horizontal bands jump sideways at a fixed tick rate (gate `glitch`). |
| `flashPop` | 閃光 | Flash pop | light | bright bold | A white flash on impacts (reads `flash` impulses; trait impact). |
| `invertBlink` | 反転 | Invert blink | tone | hard digital | The frame inverts for a few frames on impacts (trait impact). |
| `softVeil` | 紗 | Soft veil | optic | soft airy | A soft diffusion glow over highlights. |
| `grainFilm` (fb) | 粒子 | Film grain | film | retro organic | Animated film grain (changes at a fixed tick rate). |
| `rasterLines` | 走査線 | Raster lines | film | retro digital | Fine horizontal scanlines. |
| `edgeShade` | 周辺減光 | Edge shade | film | dark slow | Darkened corners (vignette). |
| `glowSpill` | 光のにじみ | Glow spill | light | bright wet | Bloom spilling from bright areas. |
| `dotScreen` | 網点 | Dot screen | film | retro literary | A halftone dot screen over the frame. |
| `duoTone` | 二色刷り | Duo tone | tone | retro literary | The frame remapped to two colors (ground and accent). |
| `amberSpill` | 光漏れ | Light leak | light | soft retro | Warm light leaks drifting in from one edge. |
| `dustSpecks` | ほこり | Dust specks | film | retro organic | Dust and fine scratches. |
| `cinemaBars` | 帯 | Cinema bars | shape | serious | Letterbox bars at the top and bottom. |
| `afterImage` | 残像 | After image | optic | wet digital | Fading trails of the text from a moment ago (needs `textAt`; re-renders the text at t − kδ, k ≤ 3). |
| `paperTooth` | 紙の目 | Paper tooth | film | organic literary | A paper texture overlay (theme texture). |

Textures (the work `texture` slot) are the filters marked `texture: true`: `grainFilm`, `dotScreen`, `dustSpecks`, `paperTooth`,
`rasterLines`.

### 5.9 Transitions — `seam` (`parts/seam/*.js`)

| Key | ja | en | Scope | Replaces | Tags | Picture |
|---|---|---|---|---|---|---|
| `hardCut` (fb) | 直結 | Hard cut | text | — | minimal | No transition (also the fallback at world boundaries). |
| `blendDissolve` | 溶け合い | Blend dissolve | text | — | soft slow | The old text dissolves into the new. |
| `sumiSeep` | 墨にじみ | Ink bleed | text | depart | organic literary | The new text bleeds in through a spreading ink-blot mask. |
| `shoveAcross` | 押し出し | Push slide | world | depart | fast bold | The next world pushes the previous one out sideways. |
| `irisGate` | 絞り | Iris gate | world | depart | bold retro | A circle opens onto the next cut. |
| `blindSlats` | ブラインド | Blind slats | world | depart | serious retro | Slats rotate open to show the next cut. |
| `plungeZoom` | ズーム抜け | Zoom through | world | depart | fast bold | Zoom into the old cut and out of the new one. |
| `glitchSwap` | 乱れ替え | Glitch swap | world | — | digital hard | Glitchy horizontal bands swap one world for the other. |
| `whiteFlash` | 白飛び | White flash | world | depart | bright hard | Flash to white and back into the new cut. |
| `shutterSnap` | シャッター | Shutter snap | world | depart | hard fast | Two bars close and open like a shutter. |
| `swishCut` | 振り | Whip pan | world | depart | fast | A fast motion-blurred pan into the next cut. |

### 5.10 Themes (`parts/theme/*.js`)

Colors: `ground / ground2 / ink / accent / shiftA / shiftB / muted` (accent is contrast-fitted at run time). Faces:
role = `ja family · latin family (weight, flavor)`; ko/zh come from the flavor table (§4.14). All families are Google Fonts.

| Key | ja / en | Colors | display | serif | body | Texture | Season |
|---|---|---|---|---|---|---|---|
| `sumiWashi` | 墨と和紙 / Sumi & washi | #EFE9DC #E2D9C6 #1C1A17 #B8322A #3E6E8C #C9A15B #8C8577 | Yuji Syuku · Fraunces (400, brush) | Shippori Mincho B1 · Cormorant Garamond (600, mincho) | Zen Kaku Gothic New · Inter (500, gothic) | paperTooth | |
| `nightTram` | 夜の路面電車 / Night tram | #0F1420 #1A2233 #F2EEE6 #FFB23E #37C6D0 #E4507A #6E7891 | Dela Gothic One · Archivo Black (400, heavy) | Zen Old Mincho · Fraunces (700, mincho) | Zen Kaku Gothic New · Inter (500, gothic) | grainFilm | |
| `sodaFloat` | ソーダフロート / Soda float | #DFF6F2 #BFEDE6 #123047 #E83E62 #20B8C8 #FFC845 #6A8E99 | Mochiy Pop One · Righteous (400, round) | Kaisei Decol · DM Serif Display (700, mincho) | M PLUS Rounded 1c · Rubik (500, round) | none | |
| `cyanPrint` | 青写真 / Cyan print | #0E3A6B #164B85 #EAF2FA #F2C14E #5FA8E8 #9FD3FF #7FA0C4 | Shippori Antique · Space Grotesk (400, antique) | Hina Mincho · Instrument Serif (400, mincho) | BIZ UDPGothic · IBM Plex Sans (400, gothic) | paperTooth | |
| `mossStone` | 苔と石 / Moss & stone | #2E3A2F #3C4A3B #E9E4D4 #C7D66D #7FB7A4 #D98C5F #8C9683 | Zen Antique · Cormorant Garamond (400, antique) | Zen Old Mincho · EB Garamond (600, mincho) | Zen Kaku Gothic New · Work Sans (500, gothic) | grainFilm | |
| `emberGlow` | 熾火 / Ember glow | #140B08 #2A1510 #FBEBD9 #FF6A2B #FFC247 #B8325A #8A6A5C | Dela Gothic One · Anton (400, heavy) | Shippori Mincho B1 · Playfair Display (700, mincho) | Zen Kaku Gothic New · Inter (500, gothic) | grainFilm | |
| `risoPink` | リソ刷り / Riso pink | #F7EFE4 #F1DCCF #2B2A6B #E8337F #1F9E89 #FFD23F #9B8FA8 | RocknRoll One · Bungee (400, heavy) | Kaisei Tokumin · Bodoni Moda (700, mincho) | M PLUS 1p · Space Grotesk (500, gothic) | dotScreen | |
| `chalkBoard` | 黒板 / Chalk board | #1F2A26 #28352F #F1F1E8 #F4D35E #8FD3C1 #F28C8C #7E8C85 | Yomogi · Caveat (400, brush) | Klee One · Lora (600, brush) | Zen Maru Gothic · Nunito (500, round) | dustSpecks | |
| `tidePool` | 潮だまり / Tide pool | #062B30 #0B3C42 #E6FBF7 #5EF2D6 #3AA0FF #FF7B6B #5E8C8A | Zen Maru Gothic · Syne (700, round) | Shippori Mincho · Fraunces (600, mincho) | M PLUS 1p · Manrope (500, gothic) | none | |
| `brassLamp` | 真鍮のランプ / Brass lamp | #1B1712 #2A241B #F3E7C9 #D4A94A #7FA6A0 #B45A3C #8B7D62 | Zen Antique Soft · Abril Fatface (400, antique) | Zen Old Mincho · Bodoni Moda (700, mincho) | Zen Kaku Gothic Antique · Josefin Sans (500, gothic) | grainFilm | |
| `frostGlass` | 霜ガラス / Frost glass | #E8EEF3 #D5DFE8 #1B2A38 #3D7BD9 #7FC4E0 #C07BD9 #7D8C9A | Murecho · Unbounded (600, gothic) | Hina Mincho · Instrument Serif (400, mincho) | BIZ UDPGothic · Inter (400, gothic) | none | |
| `monoPress` | 活版 / Mono press | #F4F1EA #E6E1D6 #111111 #D6281E #555555 #1E5AA8 #8A8680 | Shippori Mincho B1 · Bodoni Moda (800, mincho) | Zen Old Mincho · Libre Baskerville (700, mincho) | Noto Sans JP · Work Sans (500, gothic) | paperTooth | |
| `sakuraFog` | 花霞 / Sakura fog | #FBEFF2 #F4DCE3 #3A2330 #CC4668 #8FC7A8 #F2B8C6 #A48896 | Kaisei HarunoUmi · Cormorant Garamond (700, mincho) | Shippori Mincho · Lora (500, mincho) | Zen Maru Gothic · Nunito (500, round) | none | spring |
| `cicadaNoon` | 蝉の正午 / Cicada noon | #FFF6D6 #FFE9A3 #102A3A #E4531A #1BB3C9 #2EA84F #A09062 | Potta One · Shrikhand (400, heavy) | Kaisei Decol · DM Serif Display (700, mincho) | M PLUS Rounded 1c · Rubik (500, round) | grainFilm | summer |
| `mapleInk` | 紅葉墨 / Maple ink | #2A1A14 #3A241B #F6E8D6 #E0582A #E9B44C #8E3B46 #8F7563 | Yuji Mai · Playfair Display (400, brush) | Zen Old Mincho · EB Garamond (600, mincho) | Zen Kaku Gothic New · Inter (500, gothic) | paperTooth | autumn |
| `snowLantern` | 雪灯り / Snow lantern | #10182A #1B2640 #F4F7FB #FFD58A #9CC8FF #D98FB5 #7383A3 | Kaisei Opti · Cormorant Garamond (700, mincho) | Shippori Mincho B1 · Libre Baskerville (600, mincho) | Zen Kaku Gothic New · Inter (500, gothic) | dustSpecks | winter |

`style` defaults: `plain` for all except `nightTram` (`glow`), `risoPink` (`duo`), `chalkBoard` (`plain`), `emberGlow`
(`shadow`). `dark` = ground luminance < 0.2.

### 5.11 Moods (`parts/mood/*.js`)

Amount order: motion / glitch / chroma / ornament / density / texture / groundSwitch / flash / shake / camera / pace.

| Key | ja / en | Amounts | Strong tag bias (×) | Themes (weight) | pace seam / focus | Filter weights | variety |
|---|---|---|---|---|---|---|---|
| `quietHush` | 静けさ / Hush | .30 / 0 / .05 / .35 / .30 / .50 / .20 / 0 / .05 / .30 / .30 | soft 1.8 slow 1.6 minimal 1.5 · fast .3 digital .25 | sumiWashi 2, frostGlass 1.5, mossStone 1.4, snowLantern 1.3, monoPress 1.2 | .35 / .30 | grainFilm .6, edgeShade .7, softVeil .2 | .8 |
| `popFizz` | はじける / Fizz | .75 / .10 / .20 / .70 / .60 / .20 / .60 / .60 / .30 / .60 / .70 | playful 1.8 bright 1.7 fast 1.4 bold 1.3 · dark .5 slow .5 | sodaFloat 2, risoPink 1.8, cicadaNoon 1.4, tidePool 1.2 | .60 / .50 | dotScreen .4, glowSpill .4, flashPop .5 | 1.1 |
| `glitchFracture` | ひび割れ / Fracture | .80 / .85 / .80 / .50 / .60 / .50 / .70 / .70 / .60 / .60 / .80 | digital 2 hard 1.6 fast 1.5 dark 1.3 · soft .4 organic .4 | nightTram 2, emberGlow 1.4, tidePool 1.2, cyanPrint 1 | .80 / .50 | chromaSlip .8, sliceGlitch .8, rasterLines .6, invertBlink .4 | 1.2 |
| `silverReel` | 銀幕 / Reel | .45 / .05 / .15 / .30 / .35 / .70 / .30 / .20 / .15 / .80 / .35 | slow 1.5 dark 1.5 serious 1.4 minimal 1.2 · busy .5 playful .5 | emberGlow 1.6, nightTram 1.4, brassLamp 1.3, mossStone 1.2, mapleInk 1.2 | .50 / .30 | cinemaBars .9, grainFilm .8, edgeShade .8, amberSpill .3 | .8 |
| `printColumn` | 誌面 / Column | .40 / 0 / .05 / .55 / .45 / .45 / .35 / .10 / .05 / .25 / .45 | literary 1.7 minimal 1.6 serious 1.3 bold 1.3 · wet .5 busy .6 | monoPress 2, risoPink 1.4, sumiWashi 1.3, frostGlass 1.2, chalkBoard 1.2 | .30 / .40 | dotScreen .5, grainFilm .4, duoTone .3 | .9 |
| `heartAche` | 胸の奥 / Ache | .45 / .10 / .25 / .45 / .35 / .55 / .35 / .25 / .10 / .50 / .40 | soft 1.6 wet 1.5 slow 1.4 literary 1.3 · hard .5 digital .4 | snowLantern 1.5, sakuraFog 1.4, mapleInk 1.3, nightTram 1.2, tidePool 1.1 | .45 / .40 | glowSpill .6, softVeil .5, amberSpill .4, grainFilm .4 | .9 |
| `dashSprint` | 疾走 / Sprint | .90 / .30 / .35 / .60 / .70 / .30 / .80 / .70 / .50 / .85 / .90 | fast 2 bold 1.6 hard 1.3 bright 1.2 · slow .3 minimal .6 | cicadaNoon 1.5, sodaFloat 1.3, emberGlow 1.3, nightTram 1.2, risoPink 1.2 | .70 / .60 | flashPop .6, chromaSlip .4, sliceGlitch .3 | 1.1 |
| `dreamHaze` | 霞 / Haze | .35 / .05 / .20 / .50 / .30 / .45 / .30 / .15 / 0 / .40 / .35 | airy 1.8 soft 1.6 wet 1.4 organic 1.3 · hard .4 digital .4 | frostGlass 1.5, sakuraFog 1.5, tidePool 1.3, sodaFloat 1.1 | .50 / .30 | glowSpill .7, softVeil .6, amberSpill .5 | .9 |

Keywords (for `song.info` matching) — quietHush: calm quiet ballad 静か 穏やか しっとり バラード; popFizz: pop bright
cheerful 明るい ポップ 元気; glitchFracture: electronic glitch edm heavy 激しい 電子; silverReel: cinematic epic 壮大
映画; printColumn: acoustic folk 語り 淡々; heartAche: sad emotional 切ない 泣き 感動; dashSprint: rock fast energetic
疾走 アップテンポ; dreamHaze: dreamy ambient 浮遊 幻想.

---

## 6. UI

The UI is "one stage, four steps, a scope ladder underneath": a fixed screen with a header, a step column on the left
(① 歌詞 ② 曲 ③ 見た目 ④ 書き出し), the stage in the centre (one big preview and a play bar) and one detail column on the
right that the inspector (詳細) and the AI panel share. Depth lives in the inspector: 作品全体 → 行 → カット → 要素.

### 6.1 Layout invariants (FROZEN; tested by `tests/browser/ui_layout.py` and `tests/node/ui_layout.test.js`)

1. Four regions: header, step column (or its 48 px rail), stage (preview + play bar), detail column (詳細 or AI). They never
   overlap. At 1024×600 or larger the page never scrolls; panels scroll inside themselves.
2. **Nothing persistent covers the preview**: not the inspector, the AI panel, part pickers, help, toasts, or the look
   history. Transient menus, tooltips, native dropdowns and the Ctrl+K palette may float briefly and close on Esc/blur.
3. Only four things change the stage size: opening/closing the detail column, the timeline drawer, folding the step column
   to its rail (by hand or by auto-fold), and the window size. Selection alone never reflows anything.
4. The canvas keeps the exact aspect: `computeLayout` (§6.2) fits it into the preview area in integer CSS px, letterboxed.
5. One selection for the whole app; every view reflects it (§6.5).
6. Every action is a command id (`ui/actions.js`); every change to the work is a store Command (§3.9).
7. Control budget (tested): header ≤ 6 controls, play bar ≤ 8, 4 step tabs, ≤ 5 controls per step body (+ the footer).

### 6.2 Geometry (FROZEN formula; the table is generated from it)

Width layouts: **wide** ≥ 1360 (step 320, detail 352), **standard** 1200–1359 (step 296, detail 312), **compact**
1024–1199 (one 320 px side column that switches 手順 / 詳細 / AI), **stacked** < 1024 (stage on top ≤ 70vh, side column
below, vertical page scroll only, a one-time note recommends ≥ 1024 px). Rail = 48 px.

Height tiers by inner height: **tall** ≥ 860 and **normal** 740–859 (header 48, stage padding 16, gap 12, play bar 88 =
lane 40 + 8 + controls 40, timeline drawer +144); **short** < 740 (header 44, padding 12, gap 8, play bar 74 = lane 32 + 6
+ controls 36, drawer +112). Below 600 px of height the stage keeps a minimum of 360 px and the page scrolls vertically.

```
left   = compact ? 320 : (rail ? 48 : stepWidth)
right  = compact ? 0   : (panelOpen ? detailWidth : 0)
aw     = W − left − right − 2·pad
ah     = H − header − pad − gap − playbar − pad − (drawerOpen ? drawer : 0)
s      = min(aw / DW, ah / DH)          (DW×DH = design size of the aspect, §4.4)
canvas = floor(DW·s) × floor(DH·s)      centred in the preview area
```

**Auto-fold** (`autoFold`, preference on by default): in wide and standard layouts, opening 詳細 or AI folds the step
column to its rail **unless** the panel was opened from the lyric editor (gutter click or line selection while typing), so
editing lyrics beside the inspector stays possible. Closing the panel restores a column that was auto-folded (not one the
user folded). Clicking a step on the rail expands the column again.

Measured table (16:9 unless noted; the layout test asserts these ±1 px):

| Viewport | Layout / tier | Nothing open | 詳細 open (step column kept) | 詳細 open + rail (auto-fold) | Timeline drawer | 9:16, nothing open |
|---|---|---|---|---|---|---|
| 1920×1080 | wide / tall | 1568×882 | 1216×684 | 1488×837 | 1344×756 | 506×900 |
| **1440×900** | wide / tall | **1088×612** | 736×414 | **1008×567** | 1024×576 | 405×720 |
| 1440×789 | wide / normal | 1082×609 | 736×414 | 1008×567 | 826×465 | 342×609 |
| 1366×768 | wide / normal | 1014×570 | 662×372 | 934×525 | 789×444 | 330×588 |
| **1280×800** | standard / normal | **952×535** | 640×360 | **888×499** | 846×476 | 348×620 |
| 1280×720 | standard / short | 960×540 | 648×364 | 896×504 | 814×458 | 320×570 |
| 1280×689 | standard / short | 958×539 | 648×364 | 896×504 | 759×427 | 303×539 |
| 1200×700 | standard / short | 880×495 | 568×319 | 816×459 | 778×438 | 309×550 |
| **1024×768** | compact / normal | **672×378** | 672×378 (same column) | — | 672×378 | 330×588 |
| 1024×640 | compact / short | 680×382 | 680×382 | — | 672×378 | 275×490 |

With the drawer and 詳細 both open on the rail: 1280×800 → 846×476, 1440×900 → 1008×567.

### 6.3 Wireframes (final; generated from the formula at 12 px per column and 20 px per row)

Labels are the English UI (the ja strings are in §6.13); `[*X*]` = active toggle, `[d]` reroll dice, `[x]` unpin,
`'` after a time = pinned time, `L` in the gutter = locked line, `<` = selected row, `[TL]` timeline drawer,
`[* New look]` = おまかせ, `[<] 3/7 [>]` = look history.

```
W1  1440x900  top level: step 1 active, nothing selected, Details closed  (preview 1088x612)
+----------------------------------------------------------------------------------------------------------------------+
| [#] Moji PV Maker | Yoake no uta  (autosaved)                                     [Undo] [Redo]   [Details] [AI] [=] |
+--------------------------+-------------------------------------------------------------------------------------------+
|[1 Lyrics]  2   3   4     |                                                                                           |
|------------------------  |                                                                                           |
|Lyrics [Syntax][Open][AI] |                                                                                           |
|+----------------------+  |+-----------------------------------------------------------------------------------------+|
||0:33.0  yoake no/*machi| ||                                                                                         ||
||0:36.4 L mada tooi sora| ||                                                                                         ||
||0:39.8  hikari no tsubu| ||                                                                                         ||
||0:42.1' kimi no namae o| ||                                                                                         ||
||0:45.8  todoku made!   | ||                                                                                         ||
||0:48.2  Let it shine / | ||                                                                                         ||
||        over the town  | ||                                                                                         ||
||0:52.0' nando demo     | ||                                                                                         ||
||....                  |  ||                                                                                         ||
||                      |  ||                                                                                         ||
||                      |  ||                                                                                         ||
||                      |  ||                                                                                         ||
||                      |  ||                                                                                         ||
||                      |  ||                                    PREVIEW 1088 x 612                                   ||
||                      |  ||                                                                                         ||
||                      |  ||                                                                                         ||
||                      |  ||                         click = select; again = one level deeper                        ||
||                      |  ||                         Alt+click = next item under the pointer                         ||
||                      |  ||                                                                                         ||
||                      |  ||                                                                                         ||
||                      |  ||                                                                                         ||
||                      |  ||                                                                                         ||
||                      |  ||                                                                                         ||
|+----------------------+  ||                                                                                         ||
|24 lines . 3:40 . ja      ||                                                                                         ||
|                          ||                                                                                         ||
|                          ||                                                                                         ||
|                          ||                                                                                         ||
|                          ||                                                                                         ||
|                          |+-----------------------------------------------------------------------------------------+|
|                          |                                                                                           |
|                          |                                                                                           |
|                          |                                                                                           |
|                          |+-----------------------------------------------------------------------------------------+|
| (toasts appear here)     ||lane: ~~~|#1#|#2#|##3##|#4#|##5##|#6#|------------                                       ||
|                          ||                                                                                         ||
|     [ Next: 2 Song -> ]  ||[>] 0:12.40 / 3:42.00      [<] 3/7 [>]  [* New look]  [vol] [TL]                         ||
+--------------------------++-----------------------------------------------------------------------------------------++

W2  1440x900  line 12 selected from the lyric gutter: Details open, step column kept (opened from the lyrics = no auto-fold)  (preview 736x414)
+----------------------------------------------------------------------------------------------------------------------+
| [#] Moji PV Maker | Yoake no uta  (autosaved)                                    [Undo] [Redo]  [*Details*] [AI] [=] |
+--------------------------+---------------------------------------------------------------+---------------------------+
|[1 Lyrics]  2   3   4     |                                                               |[*Details*] [AI]     [x]   |
|------------------------  |                                                               |------------------------   |
|Lyrics [Syntax][Open][AI] |                                                               |All > Line 12              |
|+----------------------+  |                                                               |------------------------   |
||0:33.0  yoake no/*machi| |                                                               |kimi no namae o..  [<][>]  |
||0:36.4 L mada tooi sora| |                                                               |0:42.10-0:45.80  [Lock]    |
||0:39.8  hikari no tsubu| |                                                               |[Reroll] [Why] [Pins 3 v]  |
||0:42.1' kimi no namae <| |                                                               |------------------------   |
||0:45.8  todoku made!   | |+-----------------------------------------------------------+  |v Time                     |
||0:48.2  Let it shine / | ||                                                           |  | Start [0:42.10][-][+] tap |
||        over the town  | ||                                                           |  | End   [0:45.80]     auto  |
||0:52.0' nando demo     | ||                                                           |  |v Marks                    |
||....                  |  ||                                                           |  | Emphasis (kimi)(namae)    |
||                      |  ||                                                           |  | Impact [ ]  Cuts: 2 auto  |
||                      |  ||                                                           |  | Note [                ]   |
||                      |  ||                                                           |  |v Look (all cuts of line)  |
||                      |  ||                                                           |  | Layout     auto     [d]   |
||                      |  ||                     PREVIEW 736 x 414                     |  | [thumb] Pillar columns    |
||                      |  ||                                                           |  | Entrance   pinned [d][x]  |
||                      |  ||                                                           |  | [thumb] Ink rise          |
||                      |  ||              (selected line: dashed outline)              |  | Hold       auto     [d]   |
||                      |  ||                                                           |  | [thumb] Wave run          |
||                      |  ||                                                           |  | Exit  pinned for video ^  |
||                      |  ||                                                           |  | [thumb] Shard burst       |
||                      |  ||                                                           |  |> Color & type             |
||                      |  ||                                                           |  |> Cuts (3)                 |
||                      |  ||                                                           |  |> Elements                 |
|+----------------------+  ||                                                           |  |  Text Deco Bg Camera Fx   |
|24 lines . 3:40 . ja      ||                                                           |  |                           |
|                          |+-----------------------------------------------------------+  |                           |
|                          |                                                               |                           |
|                          |                                                               |                           |
|                          |                                                               |                           |
|                          |                                                               |                           |
|                          |                                                               |                           |
|                          |                                                               |                           |
|                          |                                                               |                           |
|                          |+-----------------------------------------------------------+  |                           |
| (toasts appear here)     ||lane: ~~~|#1#|#2#|##3##|#4#|##5##|#6#|------------         |  |                           |
|                          ||                                                           |  |                           |
|     [ Next: 2 Song -> ]  ||[>] 0:43.20 / 3:42  [<]3/7[>] [* New look] [v][TL]         |  |                           |
+--------------------------++-----------------------------------------------------------+--+---------------------------+

W3  1280x800  top level: step 3 active, nothing selected  (preview 952x535)
+--------------------------------------------------------------------------------------------------------+
| [#] Moji PV Maker | Yoake no uta  (autosaved)                       [Undo] [Redo]   [Details] [AI] [=] |
+------------------------+-------------------------------------------------------------------------------+
| 1   2  [3 Look]  4     |                                                                               |
|----------------------  |                                                                               |
|New look (R) changes    |+-----------------------------------------------------------------------------+|
|mood, colors and motion ||                                                                             ||
|together. What you pick ||                                                                             ||
|here stays pinned.      ||                                                                             ||
|                        ||                                                                             ||
|Mood                    ||                                                                             ||
|(Hush)(Fizz*)(Crack)    ||                                                                             ||
|(Reel)(Column)(Ache) +2 ||                                                                             ||
|     * = current auto   ||                                                                             ||
|                        ||                                                                             ||
|Theme                   ||                                                                             ||
|[##][##][##][##][##]    ||                                                                             ||
|[##][##][##][##][##]    ||                                                                             ||
|[##][##]      [More >]  ||                              PREVIEW 952 x 535                              ||
|                        ||                                                                             ||
|Shape                   ||                                                                             ||
|[16:9][9:16][1:1][..]   ||                                                                             ||
|                        ||                                                                             ||
|[More settings...]      ||                                                                             ||
|[Ask AI: 3 looks >]     ||                                                                             ||
|                        ||                                                                             ||
|                        ||                                                                             ||
|                        ||                                                                             ||
|                        ||                                                                             ||
|                        ||                                                                             ||
|                        ||                                                                             ||
|                        ||                                                                             ||
|                        |+-----------------------------------------------------------------------------+|
|                        |                                                                               |
|                        |                                                                               |
|                        |+-----------------------------------------------------------------------------+|
| (toasts appear here)   ||lane: ~~~|#1#|#2#|##3##|#4#|##5##|#6#|------------                           ||
|                        ||                                                                             ||
|  [ Next: 4 Export -> ] ||[>] 0:12.40 / 3:42.00      [<] 3/7 [>]  [* New look]  [vol] [TL]             ||
+------------------------++-----------------------------------------------------------------------------++

W4  1280x800  cut 12-2 selected on the preview: step column auto-folded to its rail, Details open, timeline drawer open  (preview 846x476)
+--------------------------------------------------------------------------------------------------------+
| [#] Moji PV Maker | Yoake no uta  (autosaved)                      [Undo] [Redo]  [*Details*] [AI] [=] |
+---+----------------------------------------------------------------------------+-----------------------+
|1  |  +----------------------------------------------------------------------+  |[*Details*] [AI]   [x] |
|   |  |                                                                      |  |---------------------  |
|2  |  |                                                                      |  |All > L12 > Cut 2      |
|   |  |                                                                      |  |---------------------  |
|3  |  |                                                                      |  |namae o yobu   [<][>]  |
|   |  |                                                                      |  |0:43.20 - 0:44.90      |
|4  |  |                                                                      |  |[Reroll][Why][Pins 2]  |
|   |  |                                                                      |  |---------------------  |
|>> |  |                                                                      |  |Layout pinned: line ^  |
|   |  |                                                                      |  |[thumb] Giant+whisper  |
|   |  |                                                                      |  |Entrance pinned[d][x]  |
|   |  |                           PREVIEW 846 x 476                          |  |[thumb] Drop snap      |
|   |  |                                                                      |  | Length 0.60s Ease[v]  |
|   |  |                                                                      |  | Order[lead] Each 40   |
|   |  |                (selected cut: solid outline + handles)               |  |Hold  auto        [d]  |
|   |  |                                                                      |  |[thumb] Wave run       |
|   |  |                                                                      |  | Why: impact line !    |
|   |  |                                                                      |  |Exit  auto        [d]  |
|   |  |                                                                      |  |[thumb] Shard burst    |
|   |  |                                                                      |  |Transition auto   [d]  |
|   |  |                                                                      |  |[thumb] Push slide     |
|   |  |                                                                      |  |> Elements             |
|   |  |                                                                      |  | Text Deco2 Bg Cam Fx  |
|   |  |                                                                      |  |                       |
|   |  +----------------------------------------------------------------------+  |                       |
|   |+------------------------------------------------------------------------+  |                       |
|   ||TIMELINE  [Snap: beat][BPM 128 auto][- fit +][Follow]                   |  |                       |
|   ||                                                                        |  |                       |
|   ||Beat |  .  .  .  |  .  .  .  |  .  .  .  |  .  .  .  |                  |  |                       |
|   ||Song ~~~~~ verse ~~~~~~~~~~|~~~~~~~ chorus ~~~~~~~~~~~                  |  |                       |
|   ||Line [11 .....][=== 12 kimi no namae ===][13 todoku]                    |  |                       |
|   ||Cut            [12-1 ][12-2*][12-3 ]                                    |  |                       |
|   ||     0:40      0:42      0:44      0:46      0:48                       |  |                       |
|   ||                                                                        |  |                       |
|   ||                                                                        |  |                       |
|   ||[>] 0:43.20  [<]3/7[>] [* New look] [v] [TL]                            |  |                       |
+---++------------------------------------------------------------------------+--+-----------------------+

W5  1280x800  AI review in the right column; Details is disabled until Apply or Discard; rail auto-folded  (preview 888x499)
+--------------------------------------------------------------------------------------------------------+
| [#] Moji PV Maker | Yoake no uta  (autosaved)                      [Undo] [Redo]  [Details] [*AI*] [=] |
+---+----------------------------------------------------------------------------+-----------------------+
|1  |                                                                            |[Details-] [*AI*]  [x] |
|   |                                                                            |---------------------  |
|2  |                                                                            |Gemini ready [Change]  |
|   |+------------------------------------------------------------------------+  |gemini-3.8-flash       |
|3  ||                                                                        |  |Sent: lyrics, your     |
|   ||                                                                        |  | instruction, values   |
|4  ||                                                                        |  |---------------------  |
|   ||                                                                        |  |[Prepare lyrics]       |
|>> ||                                                                        |  |[Get 3 looks]          |
|   ||                                                                        |  |One-line edit [L12 v]  |
|   ||                                                                        |  |[louder chorus     ]   |
|   ||                                                                        |  |             [Send]    |
|   ||                                                                        |  |> Use the song         |
|   ||                                                                        |  |---------------------  |
|   ||                            PREVIEW 888 x 499                           |  |One-line edit: 7       |
|   ||                                                                        |  |[x] L12 Entrance>Pop   |
|   ||                                                                        |  |[x] L12 add impact !   |
|   ||                TRY-ON: checked changes (hold B = before)               |  |[x] Motion .40 > .75   |
|   ||                                                                        |  |[ ] L13 Layout changed |
|   ||                                                                        |  |[x] Accent [##]>[##]   |
|   ||                                                                        |  |> Not usable (2)       |
|   ||                                                                        |  |in 3,210 out 850 tok   |
|   ||                                                                        |  |about $0.006           |
|   ||                                                                        |  |[Discard]  [Apply 6]   |
|   ||                                                                        |  |                       |
|   ||                                                                        |  |                       |
|   ||                                                                        |  |                       |
|   ||                                                                        |  |                       |
|   |+------------------------------------------------------------------------+  |                       |
|   |                                                                            |                       |
|   |                                                                            |                       |
|   |                                                                            |                       |
|   |+------------------------------------------------------------------------+  |                       |
|   ||mode strip: Trying on one-line edit (6) [Apply] [Stop]                  |  |                       |
|   ||                                                                        |  |                       |
|   ||[>] 0:43.20  [<]3/7[>] [* New look] [v] [TL]                            |  |                       |
+---++------------------------------------------------------------------------+--+-----------------------+

W6  1024x768  compact: one side column switches Steps / Details / AI  (preview 672x378)
+-----------------------------------------------------------------------------------+
| [#] Moji PV | Yoake no uta                               [Un][Re] [*Det*][AI] [=] |
+--------------------------+--------------------------------------------------------+
|[Steps] [*Details*] [AI]  |                                                        |
|------------------------  |                                                        |
|All > Line 12             |                                                        |
|------------------------  |                                                        |
|kimi no namae o..  [<][>] |                                                        |
|0:42.10-0:45.80  [Lock]   |+------------------------------------------------------+|
|[Reroll] [Why] [Pins 3]   ||                                                      ||
|------------------------  ||                                                      ||
|v Time                    ||                                                      ||
| Start [0:42.10][-][+]    ||                                                      ||
| End   [0:45.80]   auto   ||                                                      ||
|v Marks                   ||                                                      ||
|v Look (all cuts)         ||                                                      ||
| Layout     auto    [d]   ||                                                      ||
| [thumb] Pillar columns   ||                   PREVIEW 672 x 378                  ||
| Entrance   pinned[d][x]  ||                                                      ||
| [thumb] Ink rise         ||                                                      ||
|> Color & type            ||                                                      ||
|> Cuts (3)                ||                                                      ||
|> Elements                ||                                                      ||
|                          ||                                                      ||
|                          ||                                                      ||
|                          ||                                                      ||
|                          ||                                                      ||
|                          |+------------------------------------------------------+|
|                          |                                                        |
|                          |                                                        |
|                          |                                                        |
|                          |                                                        |
|                          |                                                        |
|                          |+------------------------------------------------------+|
|(toasts appear here)      ||lane: ~~~|#1#|#2#|##3##|#4#|##5##|#6#|------------    ||
|                          ||                                                      ||
|                          ||[>] 0:43.20 [<]3/7[>] [* New look] [v][TL]            ||
+--------------------------++------------------------------------------------------++
```

Step-column panels for the other steps (296–320 px wide; content only):

```
Step 2 Song (loaded)                 Step 4 Export (ready)                Step 4 Export (running)
+----------------------------+       +----------------------------+       +----------------------------+
| yoake.mp3  3:42      [...] |       | Format [MP4][PNG][PNG a]   |       | Exporting 1080p 30fps      |
| ~~~~~~~~~~~~~~~~~~~~~~~~~~ |       | Size   [1080p 1920x1080 v] |       | [##########..........] 46% |
| Tempo [128.0] BPM auto [x] |       | Smooth [24][*30*][60] fps  |       | 3,080 / 6,660 frames       |
| [x] Snap cuts to beats     |       | Backgrnd [Normal       v]  |       | About 1:12 left            |
| [T Tap to sync]            |       | 1920x1080 30fps 3:42       |       | You can keep editing; the  |
|   from line 12 / Space     |       | about 120 MB, direct to    |       | export uses the video as   |
| [AI: align timing >]       |       |   disk                     |       | it was when it started.    |
|----------------------------|       | ! 2 checks (flash, fit) >  |       |----------------------------|
|   [ Next: 3 Look -> ]      |       | [More...] range/quality/   |       |          [ Cancel ]        |
+----------------------------+       |   audio/name               |       +----------------------------+
                                     |      [ Export ]            |
                                     +----------------------------+
Tap mode (T): the play-bar lane becomes the mode strip, the step column shows:
+----------------------------+
| Tap to sync   12 / 40      |
| 0:39.8  hikari no tsubu    |
| > next: kimi no namae o    |
|----------------------------|
| Space/Enter  start of next |
| E            end of line   |
| Backspace    back one line |
| <- / ->      -3 s / +3 s   |
| P pause   Esc finish (undo)|
+----------------------------+
```

### 6.4 Control hierarchy (complete)

#### 6.4.1 Header (6 controls)

| Control | ja / en | Action |
|---|---|---|
| Project title (+ save state 自動保存済み / 保存中… / 保存できません) | 無題 / Untitled | click → 詳細 at 作品全体 › タイトル |
| Undo, Redo | 元に戻す / やり直す | tooltips name the entry (「元に戻す: 12行の入り (Ctrl+Z)」); right-click → edit-history popover (last 50, click to jump) |
| 詳細 toggle | 詳細 / Details | opens the detail column at the current selection (作品全体 when nothing is selected) |
| AI toggle | AI | opens the AI tab of the detail column (hidden when AI is switched off in settings) |
| ≡ menu | | §6.4.12 |

#### 6.4.2 Play bar (≤ 8 controls; under the preview in every step)

▶/⏸ · time readout (click to type a time) · lane (scrub; shows cut blocks, pinned edges solid, auto edges dashed, locked
lines hatched, waveform behind) · ◀ · `n/m` · ▶ (look history; the counter is hidden while there is ≤ 1 entry; `●/m` when
modified, §3.7; clicking `n/m` opens 作品全体 › 試した見た目) · **おまかせ** · 音 (mute; only with a song) · タイムライン
(drawer). During tap mode or try-on, the lane row becomes the **mode strip** (「案Bを試写中 [この案にする] [やめる]」,
「タップ中 12/40 [1行戻る] [終わる]」); nothing shifts.

#### 6.4.3 Steps (step column; each body ≤ 5 controls; footer = 次へ and « fold)

| Step | Controls (command) |
|---|---|
| ① 歌詞 Lyrics | lyric editor (§6.4.14) · 記法 (inline help, not a popup) · 開く (.txt/.lrc/.json) · AIで整える (AI panel → 下ごしらえ) · footer 次へ |
| ② 曲 Song (任意) | song row (… menu: 差し替える / 外す) or drop zone · テンポ (BPM field; auto from analysis, typing pins `work:bpm`; ×2 ÷2 in its menu) · 拍に合わせる (`timing.set snap`) · タップで合わせる (tap mode from the selected line) · AIでタイミング (AI panel) |
| ③ 見た目 Look | 雰囲気 chips (click pins `work:mood`; the auto one is marked ＊; clicking the pinned chip unpins) · テーマ swatches (12 + もっと見る; pins `work:theme`; hover = try-on) · 画面の形 (`look.set aspect`) · 詳しく… (詳細 at 作品全体) · AIに3案 (AI panel) — plus one line of help: 「おまかせで雰囲気・配色・動きがまとめて変わります。ここで選んだものは固定されます。」 |
| ④ 書き出し Export | 形式 (MP4 / PNG連番 / 透過PNG) · 大きさ (720p–2160p with real px) · なめらかさ (24/30/60) · 背景 (`look.set backdrop`; 透明 only for PNG) · 書き出す; 詳しく (inline): 範囲 (全体 / 選んだ行 / I–O 範囲), 画質, 音声を入れる, ファイル名; preflight list (§4.21) with jump links |

Step status dots: ① done when there is a lyric line; ② optional (done when a song is loaded); ③ done after the first
おまかせ or pin; ④ shows progress while exporting.

#### 6.4.4 Inspector anatomy (detail column, tab 詳細)

1. Tabs `[詳細] [AI] [×]` (compact: `[手順] [詳細] [AI]`).
2. Breadcrumbs `全体 › 12行 › カット2 › 文字` (en `All › Line 12 › Cut 2 › Text`); click = go to that level; always fits in
   288 px (the full line text is in the level header).
3. Level header (64 px): title (line text; editable for a line — commits `lyrics.row`; double-clicking text on the preview
   focuses it), time range, [ロック] (lines), [振り直す], [なぜ] (opens the explanation of the most recently focused field),
   [◀][▶] (previous/next item at this level), [固定 n ▾] (every pin in this scope and below with ×, plus すべて外す; lock
   pins listed separately).
4. Sections (collapsible; open state remembered per level kind); sub-pages (part browser, color, font, looks tried) push onto
   the crumbs (`… › 入り を選ぶ`), Esc pops.
5. Field rows are stacked (label line + control line + optional one-line なぜ):
   ```
   入り  [固定]                         [d] [x]      label, state tag, reroll (part/number slots), unpin (only when pinned here)
   [thumb 64x36] ふわり上がり               v        control, full width
   なぜ: 見せ場（!）の行なので強め                    auto values only; muted; from explain() on demand
   ```
   Widgets: `part` (thumbnail + name → part browser page), `choice` (segmented ≤ 4 options, else select), `number`
   (slider + field with unit; drag the label to scrub), `time` (m:ss.cc, ±1 frame, [今] = playhead), `color` (theme
   swatches + native picker + hex + contrast readout), `font` (preview in the real font with the selected line's text;
   filtered by scripts in use), `toggle`, `words` (emphasis chips), `cutpoints` (clickable gaps: ┃ pinned/mark, ┊ current
   auto cut — clicking an auto one pins it), `text`, `slots` (ornament/filter list: add, remove, reorder, hide).
6. Every field has a ⋯ menu (right-click / Shift+F10): 自動に戻す (Del) · 振り直す · 今の値で固定 · コピー / 貼り付け ·
   範囲を広げる → この行のすべてのカット / 作品全体 (`pin.promote`; the toast reports 「3カットは個別の固定を保持」) ·
   固定元へ移動 (for inherited values) · なぜこの値？

#### 6.4.5 作品全体 (whole video)

Default-open sections: 見た目, 強さ.

| Section | Fields → slot / command |
|---|---|
| 見た目 Look | 雰囲気 `work:mood` · テーマ `work:theme` (swatch page) · 季節 `work:season` (自動/なし/春/夏/秋/冬; なぜ shows the keyword, e.g. 「雪」から) · 画面の形 `look.set aspect` · 背景の種類 `look.set backdrop` (通常 / グリーンバック / 黒（白文字） / 透明) |
| 色 Colors | 背景 `work:color.ground`, 背景2 `color.ground2`, 文字 `color.ink`, アクセント `color.accent`, ずれ色A/B `color.shiftA/B`, 控えめ `color.muted` — contrast warning below 3:1; [テーマの色に戻す] = `pin.clearUnder`-style batch of `pin.clear work:color.*` |
| 書体 Type | 見出し / 明朝 / 本文 × (和文 / 欧文 / 한글 / 繁體 / 简体) `work:face.<role>.<script>`; 太さ `face.<role>.weight`; 文字の大きさ(全体) `work:text.scale` |
| 強さ Energy (0–100; a ghost tick shows the mood's value) | 動き `amount.motion`, 乱れ `amount.glitch`, 色ずれ `amount.chroma`, 装飾の量 `amount.ornament`, 密度 `amount.density`, 質感 `amount.texture`, 背景の変化 `amount.groundSwitch`, 見せ場で光る `amount.flash` (toggle 0 / mood value), 揺れ `amount.shake`, カメラ `amount.camera`, カットの速さ `amount.pace`; [雰囲気の値に戻す] |
| 部品 Parts ("use only these") | one row per kind with a count 「18 / 22」: 構図 入り 見せ 抜け 切り替え 装飾 背景 カメラ 画面効果 → tile page (2 columns at 312 px, 3 at 352): checkbox per tile, presets すべて / 雰囲気に合うもの / 最小, search, season filter; `filter.set`; at least one stays checked |
| タイトル Title card | タイトル (= `[ti:]`, `meta.set`) · アーティスト (`[ar:]`) · タイトルカード `work:titleCard` (自動/出す/出さない) · its 構図 / 入り / 抜け via the `title` cut page |
| タイミング Timing | 読む速さ `work:readRate` · 拍に合わせる `timing.snap` (切る/拍/半拍/小節) · 入りの早さ `timing.lead` · 抜けの重なり `timing.tail` · 最初の余白 `timing.leadIn` · 最後の余韻 `timing.outro` · 動画の長さ `work:length` · テンポ `work:bpm` · 拍のずれ `work:beatOffset` · タップの補正 `timing.tapLatency` |
| 行 Lines | virtual list: # · start (grey = auto, bold' = pinned, LRC badge) · text · lock · pin count · warning badge → drill down |
| 試した見た目 Looks tried | thumbnail grid of `side.looks` (current outlined, ★ to keep, scope label 「全体」「12行」「カット2」) → click = `look.restore` |
| 要素の既定 Element defaults | 文字 / 装飾 / 背景 / カメラ / 画面効果 / 切り替え pages at work scope (pins `work:<slot>`) plus 質感 `work:texture` |
| その他 | 見た目の番号 (`look.seed`, read/type) · [すべての固定を外す] · [AIの固定を外す] (`pin.clearUnder work by ai` for every scope) · 迷子の固定 n件 (orphan/shadowed pins: delete or 「このカットに付け直す」) |

#### 6.4.6 行 (line)

Header: editable text (`lyrics.row`), [ロック] (`lock.set` with `planner.lockPayload` / `lock.clear`), [振り直す]
(`salt.bump line/<id>`), [◀][▶], [固定 n ▾], 同じ歌詞 n行 › (selects every line with identical text).

| Section | Fields |
|---|---|
| 時間 | 開始 `line/<id>:start` (time widget + source tag 自動 / LRC / タップ / AI / 手入力; [今] = S) · 終わり `line/<id>:end` · 長さ (read-only) |
| 文字の記号 (edit the text) | 強調 (word chips toggle `*…*`) · 見せ場 (trailing `!`) · 区切り (cutpoints: marks `/` ┃, auto ┊; pinning an auto one pins `line/<id>:split`) · 注釈 (`|note`) · 言語 `line/<id>:lang` |
| 演出 (applies to every cut of the line) | 構図 `line/<id>:arrange` · 入り `arrive` (+ 長さ `arrive.dur`, なめらかさ `arrive.ease`, 文字の出方 `arrive.order`, 間隔 `arrive.each`) · 見せ `dwell` (+ 強さ `dwell.amount`) · 抜け `depart` (+ `depart.dur`, `depart.ease`) · 切り替え `seam` (into the line's first cut) · 向き `orient` |
| 色と書体 | 書体 `text.face` · 文字色 `text.ink` · 飾り方 `text.style` · 大きさ `text.scale` |
| カット (n) | list → drill down (hidden when the line has one cut: its cut fields merge into this page and pins go to line scope) |
| 要素 | 文字 / 装飾 n / 背景 / カメラ / 画面効果 at line scope |
| AI | [この行をAIに頼む…] → AI panel ひとこと修正 with 対象 = this line |

#### 6.4.7 カット (cut)

Header: cut text, 「カット k / n」, time range, [振り直す] (`salt.bump cut/<key>`), [◀][▶] (cross line boundaries),
[固定 n ▾]. Sections: 時間 (開始 `cut/<key>:t0` for inner boundaries; end = next cut's start) · 構図 (`arrange` + 「この部品の
調整」 generated from its ParamSpecs + 位置 `el.text.nudge`, 大きさ `text.scale`) · 動き (`arrive`, `dwell`, `depart` with
their shared and part params) · 切り替え (`seam` into this cut + 長さ `seam.dur`) · 要素 (chips 文字 · 装飾 n · 背景 · カメラ ·
画面効果 n, [+ 装飾] [+ 効果]). Special cuts: title (`全体 › タイトル`), interlude (`全体 › 間奏（12行のあと）`, adds 表示する
文字: なし / ♪ / 見出し / 自由入力 → `cut/gap/<id>:arrange@breathMark.label`), intro, outro.

#### 6.4.8 要素 (element) pages — available at work, line and cut scope

| Element | Fields |
|---|---|
| 文字 Text | 書体 `text.face`, 大きさ `text.scale`, 文字色 `text.ink`, 塗り `el.text.fill` (the whole text element in one color: glyphs, emphasis and rules, §3.4.3; unpinned it reads 自動（文字色とアクセント）), 飾り方 `text.style`, 向き `orient`, 位置・回転・拡大 `el.text.nudge` (also by dragging handles on the preview), 非表示 `el.text.hide`, 文字の出方/間隔 (`arrive.order`, `arrive.each`), 「この部品の調整」 for the chosen arrange/arrive/dwell/depart part params |
| 装飾 Decoration (slots 0–2) | 数 `ornament.count`; per slot: 種類 `ornament#i` (part browser; なし = `none`), 量 `ornament#i.amount`, 色 `ornament#i.ink` (アクセント / ずれ色A / ずれ色B / 任意), part params, 非表示 `el.ornament#i.hide`, 位置 `el.ornament#i.nudge`; [+ 装飾を足す] (raises the count) |
| 背景 Background | 種類 `ground` (+ params, 量 `ground.amount`), 空気（粒子） `atmos` (+ params); a note: 「背景は前後のカットと続いています（n カット）」 with [このカットだけ変える] (cut pin) / [この行] / [作品全体] |
| カメラ Camera | 動き `lens` (+ 量 `lens.amount`, params) |
| 画面効果 Screen effects (slots 0–2) | 数 `filter.count`; per slot: 種類 `filter#i`, 量 `filter#i.amount`, いつ `filter#i.when` (いつも / 入り / 拍ごと / 見せ場 / 抜け), params; at work scope also 質感 `texture` and 見せ場の光 `amount.flash`; filters skipped by the backdrop mode are listed greyed with the reason |
| 切り替え Transition (cut scope only) | 種類 `seam` (+ 長さ `seam.dur`, params) |

List-slot semantics (FROZEN, §3.4.3): pinning 種類 of slot i at a scope makes that slot exist in every cut the pin covers;
なし hides it; the count field pins `ornament.count` / `filter.count`.

#### 6.4.9 Several lines selected (「n行を選択中」)

Buttons [ロック] [振り直す] [固定を外す]; 演出 fields show いろいろ where values differ and pin on every selected line (one
batch); 時間: まとめてずらす [−][+] (0.1 s; Shift = 1 frame) → `time.shift`; 見せ場 tri-state; [見た目をコピー/貼り付け].

#### 6.4.10 AI panel (tab AI of the detail column)

1. **Connection card**: サービス (Google Gemini default / the second AI service) · モデル · APIキー (masked, show toggle) · key
   shape hint on paste, then [確認] (free model-info check) · states 未設定 / 形が違うかも / 確認中… / 使えます / キーが
   違います / このモデルは使えません / 通信できません · 「この端末に記憶する（共用のPCではオフに）」 (off = sessionStorage) ·
   キーを作る ↗ · キーを消す. Collapses to one line once the key works.
2. **Always-visible notice**: 「送るもの: 歌詞のテキスト・指示・設定の数値」 (expands: audio only via 曲を使う, after consent).
3. **Tools**: [歌詞の下ごしらえ] · [演出を3案もらう] · ひとこと修正 (300-char field + 対象: 作品全体 / 選択中の行 / 選択中の
   n行 + [送る]; if the AI asks back, its question is shown inline) · 曲を使う (Gemini + song only): consent card stating
   「曲の音声を 16kHz モノラルにして Google Gemini に送ります（約 7MB・3:42）。この作品ではこのときだけ。」 +
   [書き起こす] [タイミングを合わせる] [曲を分析する].
4. **Running**: stage line (音声を準備中 → アップロード中 → 処理中 → 考え中), elapsed time, [中止].
   The thinking animation (`ui/ai_thinking`) runs while a request is out, wherever it was started from:
   - The stage line carries an orb: two counter-rotating rings, a pulsing core and orbiting sparks. Its text shimmers,
     and a light stream runs along its bottom edge.
   - A HUD sits over the preview. It has corner brackets, a faint grid and a scan beam, plus a card with the orb, the
     stage text, the elapsed seconds and a thinking wave. A song tool's card also shows its four stage steps.
   - The HUD is DOM over the canvas, so an export never contains it. It ignores the pointer, and it is not announced
     (the stage line is the live region).
   - While a request runs, `<body>` carries `is-ai-thinking`, which makes the AI buttons glow.
   - All of it is CSS animation, so it costs no script time. It stands still under prefers-reduced-motion.
5. **Review** (nothing is applied before this): summary; checked list grouped 歌詞 / 全体 / 行ごと / 時間 with scope and
   before → after (「12行 · 入り: 自動 → 花びら」, 「3行 · 区切り: 夜明けの/街を走る」 with a text diff); rows whose target
   changed since the request are unchecked and badged 「この後に変更あり」; [すべて] [なし]; ▸ 使えなかった提案 n件; cost
   line 「入力 3,210 / 出力 850 トークン · 約 0.9 円」 (USD in en); [捨てる] [選んだ n 件を反映]. 3案: three cards (title,
   concept, palette swatches, n changes, [試写] [この案にする]). 書き起こし: text preview + [置き換える] / [後ろに足す].
   分析: summary, sections, highlights + [保存する].
6. **While a review is open**: selection changes only highlight rows in the preview, timeline and lyric editor; the 詳細 tab
   is disabled with 「AIの提案を反映するか捨てると開けます」. Hovering a review row highlights its line and scrolls to it.
7. **Try-on** (試写): the stage renders `plan(apply(doc, checked changes))` without committing; mode strip 「案Bを試写中
   [この案にする] [やめる]」; hold B to see the current look; any edit ends the try-on.
8. **Log** 反映した AI の変更: entries (time, tool, count, [元に戻す] = selective revert via `revertCommands`, reporting
   「n件は後で変更されたので戻せません」) and 「AIが決めた固定 n [すべて自動に戻す]」.
9. **Errors**: one message per error code (`err.ai.<code>`).

#### 6.4.11 Toasts (never over the preview)

Host: the bottom of the step column when it is expanded; otherwise the bottom of the detail column; in compact layout the
bottom of the side column; if neither column is present (rail + closed panel), the mode strip shows the toast for 4 s.
During tap mode only errors are shown (in the mode strip). Every toast with an action (元に戻す) is reachable with F6 and is
announced by the polite live region. Toasts stack at most 2 and expire after 6 s.

#### 6.4.12 ≡ menu, command palette, popovers

- **≡ menu**: ファイル (新しく作る · 開く… Ctrl+O · 保存 Ctrl+S · 名前を付けて保存… Ctrl+Shift+S · 最近の作品 ▸ (5 autosaves) ·
  時間つき歌詞（.lrc）を保存 · 時刻を歌詞に書き込む) · 編集 (元に戻す · やり直す · 変更の履歴… · コマンド Ctrl+K) · 表示 (安全枠
  incl. the 9:16 platform-UI guide · プレビューの画質 自動/なめらか優先/きれい優先 · 点滅を抑える (preview only) · 手順パネルを
  たたむ · 詳細を開いたらたたむ (auto-fold) · 選択で再生位置を移動 · 再生位置に追従) · 設定 (1文字キーを使う · 貼り付け後に
  自動再生 · AIを使う · この端末に保存した作品と曲を消す — asks first, then empties both IndexedDB stores (works, songs)
  and every stored AI key, and opens an empty work that is stored at its first change) · ヘルプ (キーボード操作 ? · 記法の
  ヘルプ · このアプリについて・ライセンス) · 言語 English / 日本語.
- **Command palette (Ctrl+K)**: 600 px, top of the stage, closes on Esc/blur; lists `actions.list()` with shortcuts, recent
  first; prefixes `>` actions (default), `@12` / `@1:23` jump to a line / time, `#入り 墨のぼり` pins that part on the
  selection, `?` help; matches ja, en and romaji aliases (`omakase`).
- **Part browser** (inspector sub-page, never a popover): tiles 144×81 (animated only on hover/focus), tabs おすすめ / すべて /
  季節, search, tags; excluded parts dimmed 「使わない設定」; hover/arrow keys = **try-on** of that part on the selected cut in
  the main preview (250 ms delay); Enter/click pins; 「自動に戻す」 is the first tile; right-click a tile → この部品を使わない /
  これだけ使う.
- **Color / font / time pickers**: inline in the field row (they expand the row); never cover the preview.

#### 6.4.13 Timeline (lane and drawer)

Lane (always): cut blocks, playhead, waveform (with a song), section bands; click = seek; double-click = select the line;
drag = scrub. Drawer (Shift+T): rows 拍 (beats/bars) · 曲 (waveform + AI section bands + highlight marks) · 行 · カット;
ruler; toolbar [拍に合わせる] [BPM] [ズーム − 全体 +] [追いかける]. Drag a line body = move (pins start and end); drag an
edge = trim; drag an inner cut boundary = `cut/<key>:t0`; Alt during the drag = no snapping; Shift+I / Shift+O or Shift-drag
on the ruler = export range band. Keyboard: Ctrl+←/→ nudges the focused edge 1 frame (Shift ×10). A11y: each row has a
DOM listbox proxy (「12行, 0:42.10 から 0:45.80, ロック, 固定2件」).

#### 6.4.14 Lyric editor (step ①)

A controlled `<textarea>` over a mirror layer (same metrics) that tints marks (`/ * ! | [mm:ss.xx] #`), draws the karaoke
underline on the playing row, and a gutter (visible rows only) showing: start time (grey = auto, bold + `'` = pinned, `LRC`
badge), `L` for locked, `●n` pin count, `!` engine warning (overfull, orphan pins, lock-partial; click → the line page).
Typing dispatches `lyrics.set` (merge key `lyrics.type`, sealed after 600 ms idle / Enter / blur); paste is its own entry;
the caret is restored on undo. Alt+↑/↓ moves the caret's row(s) (`lyrics.move`); Ctrl+B wraps the selection or word in
`*…*`; Ctrl+Enter plays from the caret line. Caret moves select the line (the inspector follows only if already open).
Clicking a `#` heading's gutter selects the lines up to the next heading; follow-playback scrolls the editor, pausing for
3 s after a manual scroll. Placeholder when empty: the syntax in four lines + [サンプルで試す].

#### 6.4.15 Tap mode (T)

Starts at the selected line (else the line at the playhead, else line 1); playback starts 2 s before it (silent clock
without a song; while tapping, that clock runs past the automatic length — to max(duration, last line's start) + 600 s —
so lines can be marked later than the automatic timing ends, and leaving tap mode lays the player out again).
Space/Enter = start of the next line (and advance); E = end of the current line; Backspace = back one line
(its mark is forgotten, playback seeks 2 s before it); ← / → = −3 s / +3 s; P = pause; Esc or T = finish. Times use
`player.outputTimeOf(event.timeStamp) − timing.tapLatency`. Finishing dispatches one `time.tap` (one undo entry
「タップで合わせる（12行）」); finishing with no marks records nothing. No other shortcut fires in tap mode.
For the mouse and touch, a press (pointerdown) on the panel's big 「タップ」 button or on the preview is the same as Space,
at the press's own time; in tap mode a preview press never selects, pauses or opens 詳細. Starting tap mode unfolds the
step column, so the panel shows even with 詳細 open. No mark is taken while playback is stopped (the frozen clock would
give every line the same time; the panel says 「再生が止まっています…」), nor less than 0.12 s after the last start
(`core/tap.MIN_GAP`: timing drops such a start with `time-order`). Finishing seeks 2 s before the first marked line;
the toast offers 「再生して確認」, and says how many marks the timing could not use (a mark earlier than a pin or LRC time
above the session).

### 6.5 Selection model

`Sel` (§4.23) is view state (never undoable); every history entry stores `selBefore`/`selAfter` and undo/redo restore them.

| Source | Effect |
|---|---|
| Caret in the lyric editor | selects the line; the inspector follows only if open (it never pops open while typing); with 「選択で再生位置を移動」 on and playback paused, seeks to the line's hero time |
| Gutter click | selects the line and opens 詳細 (no auto-fold); Shift = range, Ctrl = toggle |
| Preview click | **drill**: first click → the line under the pointer; again on the same spot → its cut (skipped for single-cut lines) → the element under the pointer. **Double-click** → straight to the element (text: also focuses the level header's line text for inline editing). **Alt+click without movement** → the next hit below the current one at the same level (hits are top-first from `engine.hitTest`). Pauses playback at that moment. Opens 詳細 (auto-fold applies). |
| Preview drag | only on the selected text element, after ≥ 4 px of movement: moves/scales/rotates → `el.text.nudge` (one gesture = one undo entry). Holding Alt *during* a drag disables snapping (centre, thirds, safe area, other edges); Shift locks the axis. A pointerdown with Alt that ends without movement is a pick, never a drag. |
| Lane | click = seek only; double-click = select the line |
| Timeline drawer | line block → 行, cut block → カット (seeks when paused); opens 詳細 |
| Inspector lists / crumbs / Ctrl+K `@n` | drill down / up / jump |
| Keys | ↑/↓ line, `,` / `.` cut, Enter down, Esc up (at the root Esc closes 詳細) |

Selecting lines when step ① is not shown: ↑/↓, preview click, lane double-click, the drawer, 作品全体 › 行, and Ctrl+K
`@n` (all tested). Selection holds ids only; after undo, lyric edits or AI apply, `validate()` keeps it or climbs to the
nearest surviving ancestor. Seeking on select goes to `plan.cuts[i].repT` (the hero frame). During an AI review, selection
only highlights (§6.4.10). The overlay canvas draws: selected text block solid outline; line dashed; decoration dashed;
background inset frame; camera start → end guides; screen effects a corner badge list; handles when 文字 is selected.

### 6.6 Auto vs pinned: display and reset

- Every field shows a state tag in text + icon (never color alone): 自動 (hollow ring) · 固定 (filled pin) · 行で固定 ↑ /
  作品で固定 ↑ (dotted ring; click jumps to the owning scope) · AIで固定 (pin + "AI") · ロック中 (lock) · 記号 (a text mark:
  LRC time, `/`) · 導出 (derived, read-only, e.g. the fitted text size) · 無効 (inactive part param: 「部品が変わったため無効」)
  · いろいろ (mixed).
- Changing any value pins it at the current level (the last crumb). Reset: × on the field, Del, the ⋯ menu, the tag →
  自動, Shift+Del (everything in the selection, undo toast), [固定 n ▾], 作品全体 › その他, or the AI log.
- Pin counts appear in level headers, the 行 list and the lyric gutter; the lane shows pinned edges solid, auto dashed.
- The rule, shown once in step ③ and in the ? sheet: 「おまかせや振り直しで変わるのは『自動』だけ。固定・ロックはそのまま。」

### 6.7 おまかせ, reroll, lock, look history, try-on, compare

- **おまかせ** (play bar, R, Ctrl+Shift+Enter): §3.7; toast 「固定した3項目・ロックした2行はそのまま」 (+ 「AIで固定した n
  項目も」); first time only: 「気に入るまで押してみてください。◀ で前の見た目に戻れます」. The preview crossfades 150 ms
  (preview only). After おまかせ, reroll or undo, a one-line diff readout (`planner.diff`) appears in the toast host:
  「12行を振り直し: 構図 縦の柱→大と小, 入り …」.
- **Reroll**: [振り直す] in a level header or Shift+R rerolls the selection's scope; at the root Shift+R = 「同じ雰囲気・
  配色のまま振り直す」 (`look.seed`); `[d]` on a field = `salt.bump <scope>:<slot>`; on a pinned field `[d]` = unpin +
  reroll (one batch). Disabled on locked lines.
- **Lock** (L, gutter, level header): `planner.lockPayload` → `lock.set`. Shown as `L` in the gutter, hatched lane blocks and
  ロック中 tags.
- **Look history ◀ n/m ▶** ([ / ]): §3.7 rules; hovering ◀/▶ shows a thumbnail of the current frame in that look.
- **Try-on**: hovering/focusing part tiles, theme swatches, look-history tiles and AI proposals re-renders the selected cut in
  the main preview after 250 ms (no commit). **Compare**: hold B to see the doc before the last change (or the current look
  during an AI try-on).
- **Copy/paste look**: Ctrl+C / Ctrl+V outside text fields, or the ⋯ menu, on a selected line/cut (`pin.copy`); 前の行と
  同じにする in the line's ⋯ menu.

### 6.8 Shortcuts (FROZEN keymap; `ui/keys.js`)

Global keys fire only when focus is not in a text field/select/contenteditable, never during IME composition
(`isComposing` or keyCode 229), and single-letter keys can be switched off in 設定 (WCAG 2.1.4). Ctrl combinations and Esc
work everywhere unless noted.

| Key | Action |
|---|---|
| Space | play / pause |
| ← / → (Shift) | one frame back / forward (1 s) |
| Home / End | start / end |
| ↑ / ↓ | previous / next line (select + seek when paused) |
| , / . | previous / next cut |
| Enter / Esc | down / up one level (Esc at the root closes 詳細; Esc also closes the palette/menus) |
| R | おまかせ |
| Ctrl+Shift+Enter | おまかせ (works inside text fields) |
| Shift+R | reroll the selection (root: same mood/theme, new seed) |
| [ / ] | look history ◀ / ▶ |
| L | lock / unlock the selected line(s) |
| T | tap-sync from the selected line |
| S | pin the selected line's start at the playhead |
| Del / Backspace | unpin the focused field |
| Shift+Del | unpin everything in the selection (undo toast) |
| Ctrl+Z · Ctrl+Shift+Z · Ctrl+Y | undo · redo · redo (also inside the lyric editor, after flushing pending typing) |
| Ctrl+S · Ctrl+Shift+S · Ctrl+O | save · save as · open |
| Ctrl+Enter | play from the caret / selected line (works in the editor) |
| Ctrl+K | command palette |
| Ctrl+C / Ctrl+V (not in text fields) | copy / paste the look of the selected line or cut |
| 1–4 | go to step ①–④ |
| I / A | toggle 詳細 / AI |
| Shift+T | timeline drawer |
| Shift+I / Shift+O | export range in / out at the playhead |
| B (hold) | compare with the state before the last change |
| M / F | mute / fullscreen stage |
| F6 / Shift+F6 | next / previous region |
| ? | shortcut sheet (generated from KEYMAP) |
| Ctrl+← / → (timeline focus) | nudge the focused edge 1 frame (Shift ×10) |
| Alt+↑ / Alt+↓ (lyric editor) | move the caret's row(s) |
| Ctrl+B (lyric editor) | emphasis `*…*` |
| Tap mode | Space/Enter start of next line · E end · Backspace back · ← / → ∓3 s · P pause · Esc/T finish |

Never bound: Ctrl+N/T/W/Tab/R, Ctrl+Shift+C/I/J, Alt+←/→ (browser reserved). Keys match on `event.key` (JIS and US).
`tests/node/ui_keys.test.js` asserts no duplicate binding within a context and that every SPEC §2 shortcut exists.

### 6.9 First run and focus rules

1. The app opens on ① with the editor focused; the preview shows an engine-rendered idle card (「ここに、歌詞が動きます」).
   Play, ◀ ▶ and おまかせ are disabled with a tooltip until there is a line.
2. **Paste into the empty editor**: lines get ids and times, a default look is planned (the first `side.looks` entry), the
   preview starts playing from line 1 muted (unless `prefers-reduced-motion` or the preference is off), and **focus moves to
   the stage** (the canvas region, tabindex 0) so that R and Space act as shortcuts; the おまかせ button pulses once with
   「気に入るまで押してみてください (R)」. Hints are focus-aware: inside a text field they show 「Ctrl+Shift+Enter」.
3. おまかせ as often as wanted; ◀ goes back.
4. ④ (or 次へ through ② and ③; ② says 曲なしでも作れます) → [書き出す] → save picker (File System Access) → progress → done.
Minimum: paste, click, tab, click. No modal, key setup or song is required.

### 6.10 Undo (UI side)

- `store` semantics §3.10. Gestures (`store.gesture`) wrap every slider/drag; typing is sealed as in §6.4.14.
- Undo/redo restore `selAfter`/`selBefore`, scroll to the entry's `where` (scope + field, or the caret), and flash the field
  for 200 ms; the header tooltip names the entry; the edit-history popover (right-click ↶) jumps several steps.
- In the lyric textarea, Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y go to the store (the textarea is controlled).
- Loading a project clears history (toast); the previous work stays in autosave.

### 6.11 Empty and error states

| Situation | What the user sees |
|---|---|
| No lyrics | syntax placeholder + [サンプルで試す]; idle card; play/おまかせ disabled with reasons; lane empty |
| Only comments / blanks | 「歌詞の行がありません（# の行はコメントです）」 |
| No song | ② drop zone + 「曲がなくても作れます。長さは歌詞の量から決まります。」 + 曲なしで次へ; no waveform |
| Song fails to decode | inline error in ② + [別のファイルを選ぶ] |
| Song missing after open | 「曲をつなぎ直してください: song.mp3 (3:42)」 + picker (matched by sha1, else by duration ±0.5 s) |
| 詳細 opened with nothing selected | 作品全体 |
| AI not set up | connection card first; tools disabled 「キーを入れると使えます」 |
| 曲を使う without a song / with the second AI service | disabled with the reason |
| No WebCodecs | MP4 disabled with 「このブラウザでは MP4 を書き出せません。PC の Chrome か Edge を使ってください。PNG 連番は使えます。」 |
| No File System Access | memory warning with the estimated size |
| Part filter would empty a kind | the last checkbox refuses: 「少なくとも1つは使います」 |
| Font failed (offline) | banner in 書体: 「フォントを読み込めませんでした — 代わりの書体で表示・書き出しします」 |
| Text overfull | gutter `!` and ④ preflight item 「12行の文字が入りきりません」 → jump to the cut |
| Orphan / shadowed pins | gutter `!` and 作品全体 › その他 › 迷子の固定 |
| Locked line's split no longer fits | tag 「ロック中の区切りが合いません」 + [ロックし直す] |
| Autosave quota exceeded | header 「保存できません（容量）」 → [ファイルに保存] |
| Newer project file | 「新しいバージョンで作られた作品です。このバージョンでは開けません。」 |

### 6.12 Accessibility

Landmarks: header `banner`; step tabs `tablist` (arrow-key roving); stage `main`; 詳細/AI `complementary`; crumbs `nav`
with `aria-current`. The canvas is `role="img"` with a debounced label (「プレビュー: 12行「君の名前を…」 0:43」). Every
preview selection is reachable by keyboard. State tags are text + icon; reset buttons are labelled (「固定を外す: 入り」).
Drags have alternatives (time fields, nudge keys, position fields). Targets ≥ 24×24 px (main buttons 32–40). Single-letter
keys can be switched off. Focus moves to the level heading when drilling down and returns on Esc. Live regions: toasts
(polite), export progress (`progressbar`, announced ≤ once per 5 s), AI status, tap marks. Dark UI text ≥ 4.5:1, 2 px focus
ring with offset. `prefers-reduced-motion`: UI transitions off, no autoplay on paste, thumbnails static until focused;
video content unchanged. Forced-colors mode supported.

### 6.13 String table (sample; the full table is `i18n/strings.js`, pairs `[ja, en]`)

| Key | ja | en |
|---|---|---|
| `app.name` | 文字PVメーカー | Moji PV Maker |
| `hdr.untitled` / `hdr.saved` | 無題 / 自動保存済み | Untitled / Autosaved |
| `hdr.undo` | 元に戻す: {what} | Undo: {what} |
| `step.lyrics` / `.song` / `.look` / `.export` | ① 歌詞 / ② 曲（任意） / ③ 見た目 / ④ 書き出し | 1 Lyrics / 2 Song (optional) / 3 Look / 4 Export |
| `step.next` | 次へ: {step} | Next: {step} |
| `lyr.placeholder` | ここに歌詞を貼り付け（Ctrl+V） | Paste your lyrics here (Ctrl+V) |
| `lyr.sample` / `lyr.syntax` / `lyr.aiTidy` | サンプルで試す / 記法 / AIで整える | Try a sample / Syntax / AI tidy-up |
| `song.none` | 曲がなくても作れます。長さは歌詞の量から決まります。 | You can make a video without a song; its length then follows the lyrics. |
| `look.hint` | おまかせ（下のボタン / R）で雰囲気・配色・動きがまとめて変わります。ここで選んだものは固定されます。 | New look (button below / R) changes mood, colours and motion at once. Whatever you pick here stays pinned. |
| `play.omakase` | おまかせ | New look |
| `play.histPos` | 試した見た目 {i}/{n} | Look {i} of {n} |
| `crumb.work` / `.line` / `.cut` | 全体 / {n}行 / カット{k} | All / Line {n} / Cut {k} |
| `el.text` / `.ornament` / `.ground` / `.lens` / `.filter` / `.seam` | 文字 / 装飾 / 背景 / カメラ / 画面効果 / 切り替え | Text / Decor / Background / Camera / Screen effects / Transition |
| `state.auto` / `.pinned` / `.pinnedLine` / `.pinnedWork` / `.ai` / `.locked` / `.mark` / `.derived` / `.inactive` / `.mixed` | 自動 / 固定 / 行で固定 / 作品で固定 / AIで固定 / ロック中 / 記号 / 導出 / 無効 / いろいろ | Auto / Pinned / Pinned on line / Pinned for video / Set by AI / Locked / Mark / Derived / Inactive / Mixed |
| `act.unpin` / `.reroll` / `.lock` / `.unlock` / `.promote` | 固定を外す / 振り直す / ロック / ロックを外す / 範囲を広げる | Unpin / Reroll / Lock / Unlock / Widen scope |
| `why.mood.tag` | 雰囲気「{mood}」は「{tag}」寄り | The mood "{mood}" favours "{tag}" |
| `why.recent` | 前のカットと重ならないように | Different from the previous cut |
| `why.impact` | 見せ場（!）の行なので強め | Impact line (!), so stronger |
| `why.season` | 歌詞の「{word}」から | From "{word}" in the lyrics |
| `undo.ai` | AI: {tool}（{n}件） | AI: {tool} ({n}) |
| `tap.done` | {n}行のタイミングを記録しました | Timed {n} lines |
| `exp.snapshot` | 編集は続けられます。書き出しは開始時点の内容で進みます。 | You can keep editing; the export uses the video as it was when it started. |
| `ai.sends` | 送るもの: 歌詞のテキスト・指示・設定の数値 | Sent: lyric text, your instruction, setting values |
| `ai.consent` | 曲の音声を 16kHz モノラルにして Google Gemini に送ります（約 {mb}MB・{dur}）。この作品ではこのときだけ。 | The song's audio will be sent to Google Gemini as 16 kHz mono (about {mb} MB, {dur}), this time only. |
| `ai.stale` | この後に変更あり | Changed since |
| `err.ai.auth` | キーが使えません。キーを確かめてください。 | This key does not work. Please check it. |
| `err.ai.rate` | 回数の上限に達しました。少し待ってから試してください。 | Rate limit reached. Wait a moment and try again. |
| `err.ai.truncated` | 答えが途中で切れました。行を減らして試してください。 | The answer was cut off. Try with fewer lines. |
| `toast.kept` | 固定した{p}項目・ロックした{l}行はそのままです | {p} pinned values and {l} locked lines were kept |
| `empty.preview` | ここに、歌詞が動きます | Your lyrics will move here |
| `a11y.preview` | プレビュー: {line}（{time}） | Preview: {line} ({time}) |

### 6.14 UI files (`src/ui/`, WP8; "pure" = no DOM at factory time and Node-tested)

| File | Responsibility |
|---|---|
| `dom.js` | `h(tag, props, ...kids)` (text via `textContent` only), delegated `on()`, CSSOM styles, focus helpers, rAF batcher `invalidate(part)` |
| `icons.js` | original SVG icons built with `createElementNS` (pin, ring, lock, dice, …) |
| `keys.js` (pure) | KEYMAP, `resolveKey` |
| `actions.js` (pure core) | action registry (buttons, keys, menus, palette, tests share it) |
| `fields.js` (pure) | FIELDS and `sectionsFor` |
| `selection.js` (pure) | `down/up/validate/crumbs/onPreviewClick` |
| `layout.js` (pure) | `computeLayout`, `autoFold` |
| `looks.js` (pure) | look-history pointer and append rules |
| `view.js` (pure) | view store (selection, step, panels, playhead, prefs with an injected storage wrapped in try/catch) |
| `shell.js` | grid, breakpoints (ResizeObserver → `data-layout`), region mounts, rail, side tabs |
| `header.js` | title, save state, undo/redo, 詳細/AI toggles, ≡ |
| `stage.js` | canvas host, DPR sizing, render loop (only while playing or invalidated), overlay canvas, drill clicks, direct manipulation, try-on, compare |
| `playbar.js` | transport, time readout, lane, look history, おまかせ, mute, drawer toggle, mode strip |
| `timeline.js` | drawer rows, drags, zoom, snap, keyboard nudges, a11y proxies |
| `steps.js` | tabs, step host, footer, toast host |
| `step_lyrics.js`, `lyric_editor.js` | step ①; the controlled textarea, mirror layer, gutter |
| `step_song.js` | step ② (decode states, BPM, snap, tap entry, relink) |
| `step_look.js` | step ③ |
| `step_export.js` | step ④ (settings, preflight, progress, cancel, done) |
| `inspector.js` | tabs, crumbs, level header, sections from FIELDS, sub-page stack |
| `widgets.js` | widget registry (part, choice, number, time, color, font, toggle, words, cutpoints, text, slots) |
| `part_browser.js` | tile pages, filter pages, thumbnails via `engine.thumb` (idle-sliced, cached) |
| `palette.js` | Ctrl+K |
| `menus.js` | ≡ menu, field ⋯ menus, context menus |
| `tap.js` | tap-mode controller |
| `ai_panel.js`, `ai_review.js`, `ai_controller.js` | AI panel, review/try-on/log, glue to `ai/*` (keys in session/local storage, abort) |
| `dialogs.js` | `<dialog>` confirmations, shortcut sheet, about/licences |
| `project_io.js` | new/open/save/recent/.lrc, autosave to IndexedDB (doc + side; song blob by sha1), global drop routing; each open work holds a Web Lock `mojipv-work:<id>` (a second tab continues in a copy; without Web Locks a writer token in the record does the same); `clearDevice()` for ≡ › 設定 |
| `toasts.js` | toast host and live region |
| `boot.js` | builds store, registry, engine, player, font book, services; wires events; `?test=1` exposes `window.__mv` |
| `lab.js` | lab page: renders one part from the URL hash (`#arrive:inkRise@9:16&t=0.5&text=…`) with a pose-column debug view |
| `style.css` | inlined, hashed |

---

## 7. Performance and determinism rules

### 7.1 Determinism (FROZEN)

1. **One source of randomness**: `core/rng` streams named exactly as in §4.1.3. `Math.random`, `Date`, `performance.now`,
   timers and `Intl.Segmenter` are banned in L0–L5 (lint). Fresh entropy exists only in UI commands
   (`crypto.getRandomValues`) and is stored in the command payload (`look.omakase`, `look.seed`).
2. **Stable arithmetic in the planner**: chooser weights are `q6`-quantized before logs; candidates are iterated in sorted key
   order; sums are accumulated in a fixed order; object keys are sorted wherever iteration order could matter; Gumbel noise
   is keyed by part key (never by position), so adding parts disturbs few choices.
3. **The Plan is font-, DOM-, time- and audio-free**: it depends only on the document and the registry (the song enters as
   the persisted `digest`, `bpm`, `offset`). Plan hashes are identical in Node 22 and Chrome.
4. **Frames are functions of `(plan, scenes, t)`**: no behaviour, paint or filter keeps state between frames; particles and
   drifts are closed-form in `t`; stochastic looks (grain, flicker, glitch bands) change on `fx.tick(rate, t)` so a 60 fps
   preview and a 30 fps export show the same pattern at the same instants; audio reactions use `level(env, t)` and
   `Grid.beatAt(t)` lookups only.
5. **Scenes are functions of `(cut plan, registry, measurer.key)`**; the scene cache key includes the measurer key, and
   export waits for fonts, so it never renders a provisional scene.
6. **Export timing** is exact: frame `i` at `t0 + i/fps`, timestamps `ts(i)`, durations `ts(i+1) − ts(i)`.
7. **Glyph render path** is chosen from pose state only (§4.19.5), so preview and export of the same frame take the same path.
8. **What is guaranteed**: identical Plan hash everywhere; identical RecordingCtx op hash across runs and Node/Chrome for the
   same measurer; identical pixels within one browser build and font set (browser test compares frame N rendered directly
   and after rendering 0..N−1).
9. **Keys are forever**: a released part/theme/mood key is never renamed or removed; retire it with `pool: false`.

### 7.2 Allocation rules

- Nothing allocates per frame in `behave`, `solve` or glyph drawing: pose columns are TypedArrays; `K.perGlyph` uses one
  pooled `P` and one pooled `g`; `frameAt` fills a pooled FrameGraph; the PickList is reused; FX surfaces are pooled.
- Colors: `rgba()` strings are cached (alpha quantized to 1/64); font CSS strings are cached per run; paints may create at
  most 16 `CanvasGradient`s per frame (cache them per node when the palette is unchanged).
- Behaviour `run` functions and paint `draw` functions are defined once per module (lint + review); build-time allocation is
  unrestricted but bounded by the scene cache.
- Surface pool: ≤ 10 full-frame surfaces below 1440p, ≤ 6 at 1440p and above (world seams and isolation reuse scratch
  surfaces).

### 7.3 Caches

| Cache | Key | Bound |
|---|---|---|
| Plan | doc identity + registry version | last 2 |
| Scene | cut `fp` + measurer key | LRU 16; prefetch cuts within ±10 s of the playhead in idle time |
| Text layout | RunSpec hash + measurer key | LRU 2,000 |
| Measure | (css@100px, string) | unbounded per session (small) |
| Glyph sprites | §4.19.5 key | 96 MB (48 MB at ≥ 1440p during export) |
| Static layers | (segment, output size) | LRU 8 |
| Thumbnails (UI) | (kind, key, theme, aspect) | LRU 200 ImageBitmaps |
| Waveform | song sha1 | min/max mip chain |

### 7.4 Budgets (720p preview, mid-range laptop, Chrome)

| Stage | Budget |
|---|---|
| reset + behaviours + solve (≤ 3k nodes) | ≤ 0.8 ms |
| draw: ground + ≤ 60 glyphs + ornaments + ≤ 400 particles | ≤ 5 ms |
| post (≤ 8 full-frame passes in preview) | ≤ 3 ms |
| **frame total** | **≤ 10 ms target, 16.7 ms hard** |
| re-plan of 100 lines (Node) | ≤ 5 ms |
| scene build per cut | ≤ 4 ms |
| UI: field edit → repaint | < 50 ms (typing never waits on the planner: 120 ms debounce) |

**Adaptive preview**: when the EMA of frame time exceeds 14 ms for 30 frames, step down one level at a time — (1) filters
with `cost ≥ 3` at half resolution, (2) `draft` paints, (3) DPR 0.75 (only while the output's short side is above 720 px:
the stage has already stepped its backing down to 720p at this level), (4) skip filters with `cost ≥ 4` (badge 軽量表示) —
and step back up after 60 frames under 9 ms. **Export never degrades.**

**4K limits**: filters declare `passes`; world seams are clamped to ≤ 0.8 s and at most one per boundary; `fx.impulse`
considers at most 8 recent impulses; `afterImage` re-renders the text at most 3 times; sprites are ≤ 512 px per side.

---

## 8. Testing plan

Node tests live in `tests/node/*.test.js` and run with `node --test tests/node` (Node 22, no npm packages).
Browser tests live in `tests/browser/*.py` and use the launcher `dev/browser.py`. CI runs, in order:
`python3 build.py --check`, the Node tests, `python3 build.py --lab`, `python3 build.py` (the committed pages must match),
the browser tests and `python3 tests/build_test.py`.

### 8.1 Test corpus (`tests/helpers/corpus.js`, WP0)

- The four fixture projects (`project_basic` ja 16:9 with song digest, `project_vertical` ja 9:16 with pins and a lock,
  `project_lrc` multi-stamp LRC with ja/en lines and no song, `project_long` 120 lines generated from the sample text).
- `corpus(seeds = 20, aspects = ['16:9','9:16','1:1'])` yields `{ name, doc }` variants by changing `look.seed/moodSeed` and
  the aspect.
- `minimalFallbacks()` returns one fallback def per part kind plus one theme and one mood, so single-part registries validate.

### 8.2 Node tests (file → what it asserts)

| File | Owner | Asserts |
|---|---|---|
| `kernel.test.js` | WP0 | `MV.def/use/ids`; duplicate id, bad id, missing module and cycle errors; factories run once |
| `rng.test.js` | WP0 | `hash32` vectors fixed on day one; separator property; stream determinism and independence; `fork` does not advance; Gumbel-max sampling frequencies ≈ weights (χ² over 100k draws) |
| `schema.test.js` | WP0 | `coerce` per type; every AutoSpec form; source normalization table; `describeAuto` ja/en; `validateSpec` errors |
| `paths.test.js` | WP0 | `parse`/`format` round trip over 200 generated paths; every grammar branch; errors for bad scopes/slots |
| `pins.test.js` | WP0 | `lookup` precedence cut > line > work; `attachCuts` exact/sig/containment/conflict/orphan cases |
| `store.test.js` | WP0 | dispatch/undo/redo deep-equal; gesture and mergeKey coalescing; batch = one entry; limit; `side` never undone; sel restore |
| `registry.test.js` | WP0 | every validation error; `keys` sorted; `pool` honours only/deny/season/pool:false/role; one-part registries |
| `motion.test.js` | WP0 | `fitMotion` cases; `heroTime` inside `[a, b)` |
| `doc.test.js` | WP0 | `defaultDoc` validates; `touched`; `parseFile` errors (bad json, newer schema); serialize round trip |
| `script.test.js` | WP1 | graphemes (surrogates, ZWJ families, flags, VS16, combining, jamo, CR LF); `lineScript`; `cells`; `morae` samples |
| `lyrics.test.js` | WP1 | every mark and escape; `!!`; notes; comments/headings; meta rows; multi-stamp order algorithm (§4.9.3); `renderRow`/`roundTrip` over all fixture rows |
| `reconcile.test.js` | WP1 | id properties of §4.10.1; `offsetMap` cases; pin/salt/lock remap and deletion; split pin dedupe and removal |
| `timing.test.js` | WP1 | anchors and interpolation; back/forward fill and compression; "a single tag never discards the others"; demotion order; pins beat LRC; snap moves only auto starts; readRate/bpm modes; end rules; duration rules |
| `tap.test.js` | WP1 | mark/end/back sequences; one command per session; empty session → null |
| `commands.test.js` | WP1 | each reducer; identity when unchanged; property test: 500 random command sequences, undo all → deep-equal start; replaying the same command log → same doc hash; lock payload semantics; `pin.promote`; `lyrics.set` remaps |
| `vertical.test.js` | WP2 | the vertical table per class with `fakeMeasurer` (offsets, rotations, tcy, Latin runs); column order right→left |
| `breaker.test.js` | WP2 | NO_START/NO_END; phrases for ja/en/ko/zh samples; `columns` balance |
| `layout.test.js` | WP2 | h and v layouts; emphasis scaling; `sizeGroup`; fit monotonicity; overfull fallback steps are deterministic and set `overfull` |
| `faces.test.js` | WP2 | `resolveFaces` with pins; flavor fallbacks; `cssUrls` subsetting and the 1800-char rule |
| `planner_determinism.test.js` | WP3 | same doc → same hash (corpus); different seeds differ; golden `tests/golden/plan_hashes.json` |
| `planner_variety.test.js` | WP3 | no identical adjacent arrange/arrive unless pinned or filtered; each kind uses ≥ 60% of eligible parts over the corpus; no part > 3× its expected share; neighbour repetition < 3%; moods produce different distributions |
| `planner_stability.test.js` | WP3 | insert a line: ≥ 98% of other cuts' choices unchanged on average; with line starts pinned ≤ 4 other cuts change in ≥ 95% of insertions, never more than 6; add a part: ≥ 90% unchanged; reroll a cut: ≤ 3 other cuts change in ≥ 99% of cases, never more than 4 (shipped catalog: ≥ 98.5%, never more than 5 — its exit-replacing transitions pass a changed seam on) |
| `planner_pins.test.js` | WP3 | fuzz: random valid pins always honoured; locks immune to seed, moodSeed, salts, work and line pins; filters and season respected; a one-part `only` filter never falls back; list-slot index rule; seams owned by tracks and pinnable on the receiving cut; timing precedence |
| `planner_explain.test.js` | WP3 | `explain` value = plan value for 500 random slots; alternatives sorted; explain does not change the plan hash |
| `fields.test.js` | WP3 | `fieldState` states (auto/pinned/inherited/ai/locked/mark/derived/inactive/mixed); `lockPayload` covers every auto cut slot |
| `conformance.test.js` | WP4+WP5 | for **every registered part**: × 7 aspects × {h, v where allowed} × texts {short ja, long ja (40 cells), en, mixed ja/en, emoji, one grapheme} × 24 times incl. window edges, rendered through `createRecorder`: no throw; no NaN/Infinity in pose columns or transforms; save/restore balanced; globalAlpha in [0, 1]; identity rule; dwell envelope continuous; same op hash twice; build ≤ 20 ms; 200 random feature sets keep every auto inside its schema |
| `frame.test.js` | WP4 | `frameAt` purity (evaluation order independent); recorder op hashes of the fixtures at 40 times match `tests/golden/frame_hashes.json`; tick-based effects identical at 30 and 60 fps sample times |
| `audio.test.js` | WP6 | synthetic click tracks at 90/128/174 BPM: bpm within ±1, offset within 20 ms; envelope and `digest` round trip; `level` interpolation; `encodeWav` bytes pinned (SHA-256) for fixed inputs |
| `export_math.test.js` | WP6 | `frameCount` edge cases (exact multiples, 1e-9 noise); Σ frameDur = ts(N); `audioFrames`; `outputSize` even; bitrate; `pickAvc` order; preflight flash-rate detection |
| `zip.test.js` | WP6 | CRC32 vectors; archive structure readable by a small own reader; store-only |
| `ai_providers.test.js` | WP7 | Gemini request shape, key only in the header, thought parts ignored, error mapping, no key → nothing sent, SDK modes of the second AI service (fallback beta on the largest model, no thinking on the smallest), refusal/max_tokens mapping, key check, key shape hint, schema portability |
| `ai_lyrics.test.js` | WP7 | prep validation (cuts, emphasis, readings), `renderChecked` refusals, removals keep per-line settings (now by id), blank squeezing, stale rows skipped |
| `ai_looks.test.js` | WP7 | proposals (3, season set, off-season/unknown dropped), palette accent fitted, edit changes only real changes, understood=false → none, lyric words never change; every change maps to the commands of §4.22.5 and applies as one batch |
| `ai_song.test.js` | WP7 | WAV header/size, rate picking, base64, inline vs Files API upload, upload errors, audio part before the prompt, seconds(), transcript cleaning and LRC parse-back, `#` lines, alignment rules (now pins by `ai`, allowed over LRC with the review note), song info cleaning and context |
| `ui_layout.test.js` | WP8 | `computeLayout` reproduces the §6.2 table ±1 px; no overlaps; auto-fold rules |
| `ui_keys.test.js` | WP8 | IME guard; typing guard; single-key switch; tap context swallows keys; no duplicates per context; all SPEC shortcuts present |
| `ui_selection.test.js` | WP8 | drill, Alt cycle, double-click, up/down, validate after deletions and undo |
| `ui_looks.test.js` | WP8 | pointer derivation (duplicates, modified state), append/coalesce rules, cap and stars |
| `ui_fields.test.js` | WP8 | every FieldSpec path parses and exists for its scopes; every registry param maps to a widget |
| `i18n.test.js` | WP0+WP8 | pair parity, placeholder equality, no Japanese in `en` (allowlist: product name), every registry label, `why.*` and `err.ai.*` code covered, static scan: every `t('…')` key exists |
| `release.test.js` | lead | the playing re-prepare cadence keeps a budget-limited window warm (catalog, project_vertical, 720p); err.file.newer names the file; forgetting every AI key; LRC ID tags in the editor and the .lrc writer; thumbnails' second line; one list of song sections |
| `build_test.py` (Python) | WP0 | build twice → identical bytes; CSP hashes match the inline blocks; seeded lint and layer violations fail `--check` |

### 8.3 Browser tests (`tests/browser/*.py`)

| File | Asserts |
|---|---|
| `parts_gallery.py` | lab page: every part × every aspect renders without console errors; frame not blank (variance > ε); 0 `securitypolicyviolation` events |
| `glyph_parity.py` | direct vs level-0 sprite glyphs: mean abs error ≤ 2/255 at 1080p; blur crossfade continuity |
| `determinism.py` | frame N rendered directly equals frame N after rendering 0..N−1 (pixel hash); 30 vs 60 fps sample times agree |
| `ui_layout.py` | viewports 1920×1080, 1440×900, 1440×789, 1366×768, 1280×800, 1280×720, 1280×689, 1200×700, 1024×768, 1024×640 × ja/en × 16:9/9:16/21:9 × panel/drawer/rail states, with real inspector content: no region overlap, no page scroll, canvas = table ±1 px, no clipped labels, control budgets, preview never covered |
| `ui_flows.py` | first run (paste → おまかせ → 2 s 720p MP4, decoded frame count checked) with the mouse and keyboard-only; tap-sync 5 lines with Backspace; drill-click to 文字 and drag; pin → おまかせ keeps it → Del unpins; lock survives おまかせ; ◀ ▶ follows undo; AI prep / 3案 / edit / align with a faked provider (fetch routing) incl. stale rows and selective revert; every flow ends with undo-all = start |
| `csp.py` | 0 CSP violations across all flows |
| `i18n_pages.py` | the en page shows no Japanese UI text; string coverage |
| `perf.py` | fixture projects for 10 s at 720p: reports p50/p95 frame time (fails only above 2× budget) |

---

## 9. Work breakdown

Nine packages. **WP0 is the shared core** and is fully specified above (§2, §3, §4.1–4.7, §4.24 kernel, §8.1); every
other package can start the day WP0 lands, coding against the frozen interfaces and the fixtures/fake engine. "Imports"
lists what a package may use from other packages — by interface only; nobody edits another package's files.

### 9.1 Packages

#### WP0 — Core kernel, contracts, build, fixtures (1 engineer, ≈ 1 week, ≈ 2,600 LOC JS + 450 LOC Python)

- **Files**: `build.py`; `THIRD_PARTY_NOTICES.md`; `src/core/define.js`, `types.js` (JSDoc `@typedef`s that mirror
  §3 and §4 verbatim), `hash.js`, `rng.js`, `noise.js`, `num.js`, `ease.js`, `color.js`, `mat.js`, `schema.js`, `paths.js`,
  `pins.js`, `doc.js`, `migrate.js`, `store.js`, `registry.js`, `motion.js`; `src/i18n/t.js` and a skeleton
  `src/i18n/strings.js` (keys of §6.13); `tests/helpers/load.js`, `assert_plus.js`, `corpus.js`, `fake_engine.js`;
  `tests/fixtures/*` (four projects, `plan_basic.json` hand-written to the §3.12 shape, `song_digest.json`,
  `stub_parts.js` with one minimal part per kind + fallbacks, `sample_lyrics.txt` with our own lyrics);
  `tests/node/{kernel,rng,schema,paths,pins,store,registry,motion,doc,i18n}.test.js`, `tests/build_test.py`;
  `tests/update_golden.js` (rewrites `tests/golden/*` on purpose);
  the CI job definition.
- **Imports**: none.
- **Fake engine** (`tests/helpers/fake_engine.js`): implements the §4.20 facade over `plan_basic.json` (or a trivial plan:
  one cut per line, no measuring): draws a colored rectangle and the cut text per active cut, `hitTest`/`boxes` from those
  rectangles, `thumb` draws the part key. WP6 and WP8 build against it until WP4 lands.
- **Acceptance**: WP0 tests green; `build.py --check` passes; `build.py` produces both pages from a stub `ui/boot.js` that
  shows 「準備中」, and the page loads with 0 CSP violations in Chromium; fixtures pass `validate`; the fake engine renders
  `plan_basic.json`.

#### WP1 — Document: script, lyrics, ids, timing, commands (1 engineer, ≈ 2,300 LOC)

- **Files**: `src/core/script.js`, `lyrics.js`, `reconcile.js`, `timing.js`, `beats.js`, `tap.js`, `commands.js`; tests
  `script`, `lyrics`, `reconcile`, `timing`, `tap`, `commands`.
- **Imports**: WP0 (`hash`, `num`, `schema`, `paths`, `pins`, `doc`).
- **Acceptance**: its tests; parse + reconcile of 300 rows < 5 ms and `solveTimes` of 300 lines < 2 ms in Node; the
  property test (random commands, undo all) passes 500 iterations.

#### WP2 — Type: text layout, vertical Japanese, fonts (1 engineer, ≈ 2,600 LOC)

- **Files**: `src/engine/text/vert.js`, `breaker.js`, `layout.js`, `fit.js`, `fake_measure.js`, `faces.js`, `service.js`;
  `src/engine/host/measure.js`, `src/engine/host/fonts.js`; tests `vertical`, `breaker`, `layout`, `faces`; lab page mode
  `#text:<sample>@v` (through `ui/lab.js`, coordinated with WP4) for eyeballing real fonts.
- **Imports**: WP0; WP1 `core/script` (graphemes, classes, cells).
- **Acceptance**: its tests; every family named in §5.10 and the flavor table is verified to exist on Google Fonts on day one
  (a replacement keeps the flavor and is recorded in this file by PR); real-font screenshots of the vertical table for each
  Japanese display face are attached to the PR.

#### WP3 — Planner (1 engineer, ≈ 3,600 LOC)

- **Files**: `src/planner/features.js`, `segment.js`, `choose.js`, `params.js`, `look.js`, `cast.js`, `tracks.js`,
  `plan.js`, `explain.js`, `fields.js`, `diff.js`; tests `planner_determinism`, `planner_variety`, `planner_stability`,
  `planner_pins`, `planner_explain`, `fields`; regenerates `tests/fixtures/plan_basic.json` and `tests/golden/plan_hashes.json`
  at M2 (shape unchanged).
- **Imports**: WP0; WP1 (`lyrics`, `timing`, `beats`, `script`); WP2 `breaker` (`phrases`, `words`, `columns`) and `vert`
  classes; part definitions only through a `Registry` passed in (stub parts + corpus fallbacks until WP5 lands).
- **Acceptance**: its tests with the stub catalog at M1 and with the full catalog at M3; `plan()` of `project_long` ≤ 10 ms in
  Node. (Release reading: this is the re-plan after an edit, which reuses the cached casts — best ≈ 5 ms. A plan of all-new
  cuts — a new seed, おまかせ, the first open — takes ≈ 25–30 ms with the full catalog, once per such action; typing a
  lyric re-plans in ≈ 12–14 ms behind the 120 ms debounce, §7.4.)

#### WP4 — Engine: scene, behaviours, renderer, facade, kit (1–2 engineers, ≈ 6,500 LOC)

- **Files**: `src/engine/scene/table.js`, `builder.js`, `behave.js`, `stagger.js`, `build.js`, `cache.js`, `frame.js`;
  `src/engine/render/surface.js`, `sprites.js`, `shapes.js`, `draw.js`, `post.js`, `seam.js`, `pick.js`, `record.js`,
  `renderer.js`; `src/engine/facade.js`; `src/engine/host/canvas.js`; `src/parts/kit.js`; `src/ui/lab.js`; tests `frame`,
  the `conformance` runner; browser tests `parts_gallery.py`, `glyph_parity.py`, `determinism.py`, `perf.py` (with WP8).
- **Imports**: WP0; WP2 (`TextService`, `Measurer`, `FontBook` interfaces); the Plan shape (§3.12) and `planner.plan` inside
  the facade; part definitions through the registry.
- **Early deliverable (M1, first ~30%)**: `kit.js`, `table.js`, `builder.js`, `behave.js`, `stagger.js`, `record.js` and the
  conformance runner working on `stub_parts.js`, so WP5 can run the harness on its parts.
- **Acceptance**: `frame` and `conformance` tests; browser tests; §7.4 budgets on `project_basic` at 720p; export parity.

#### WP5 — Catalog (2–3 engineers in parallel, ≈ 8,000 LOC)

- **Files**: `src/parts/catalog.js` and every file under `src/parts/{arrange,arrive,dwell,depart,ground,ornament,lens,
  filter,seam,theme,mood}/`. Suggested split: **5a** text motion (arrange, arrive, dwell, depart), **5b** world (ground,
  ornament, lens, filter, seam), **5c** look data (theme, mood) and the catalog file.
- **Imports**: `parts/kit` only (the build enforces it).
- **Acceptance**: every part passes `conformance.test.js` and `parts_gallery.py`; `createRegistry(defaultRegistry defs)`
  validates in strict mode; counts ≥ §5; the planner variety/stability tests pass with the full catalog. Each PR adds parts of one file/family and includes a lab screenshot per part.

#### WP6 — Media: audio analysis, playback, export (1 engineer, ≈ 3,000 LOC)

- **Files**: `src/audio/analyze.js`, `fft.js`, `digest.js`, `wav.js`, `peaks.js`; `src/audio/host/decode.js`, `player.js`;
  `src/export/schedule.js`, `zip.js`, `muxer.js`; `src/export/host/mp4.js`, `png.js`, `sink.js`; tests `audio`,
  `export_math`, `zip`; the export part of `ui_flows.py`.
- **Imports**: WP0; the engine facade (§4.20) — `fake_engine.js` until WP4 lands; `Mp4Muxer` global only inside
  `export/muxer.js`.
- **Acceptance**: its tests; a 3-minute 1080p30 export of `project_basic` completes in Chrome with correct frame count and
  A/V length (decoded back in the browser test); cancel leaves no file; PNG ZIP opens.

#### WP7 — AI adapter (1 engineer, ≈ 2,200 LOC)

- **Files**: `src/ai/providers.js`, `lyricio.js`, `catalog.js`, `prep.js`, `looks.js`, `song.js`, `changes.js`; tests
  `ai_providers`, `ai_lyrics`, `ai_looks`, `ai_song`.
- **Imports**: WP0 (`registry`, `paths`, `pins`, `store` types, `color.fitContrast`); WP1 (`lyrics.renderRow/roundTrip`,
  `commands` shapes); WP3 (`plan()` output shape, `fieldState` for "from" values); WP6 `audio/wav.encodeWav`.
- **Acceptance**: the AI test cases all pass on the v2 model; every Change kind converts to commands and applies as one batch;
  stale detection and selective revert covered.

#### WP8 — UI shell, inspector, AI panel, i18n content (2 engineers, ≈ 9,000 LOC + CSS)

- **Files**: every file in §6.14 except `ui/lab.js`; `src/ui/style.css`; the full `src/i18n/strings.js`; tests `ui_layout`,
  `ui_keys`, `ui_selection`, `ui_looks`, `ui_fields`, the UI part of `i18n`; browser tests `ui_layout.py`, `ui_flows.py`,
  `csp.py`, `i18n_pages.py`. Suggested split: **8a** shell, stage, play bar, timeline, steps, lyric editor, tap, project I/O;
  **8b** inspector, widgets, part browser, palette, menus, AI panel, dialogs, toasts.
- **Imports**: everything by interface. Until WP3/WP4 land it runs on `fake_engine.js` and `plan_basic.json`; until WP7
  lands, the AI panel runs on a faked provider.
- **Acceptance**: its tests; the §6.2 table reproduced ±1 px in Chromium; the control budgets; first-run flow ≤ 4 user
  actions; keyboard-only flow; 0 CSP violations; axe-core (dev-only injection) with no serious findings.

### 9.2 Integration (who wires what)

`ui/boot.js` (WP8) is the only place that connects packages:
```js
const reg    = MV.use('parts/catalog').defaultRegistry();
const store  = MV.use('core/store').createStore({ doc, side, reduce: MV.use('core/commands').reduce });
const canvas = MV.use('engine/host/canvas').createCanvasFactory();
const fonts  = MV.use('engine/host/fonts').createFontBook({ document });
const measurer = MV.use('engine/host/measure').createCanvasMeasurer(canvas, fonts);
const engine = MV.use('engine/facade').createEngine({ registry: reg, canvas, measurer, fonts, assets: null });
const player = MV.use('audio/host/player').createPlayer({ buffer: null, duration: 0 });
MV.use('ai/providers').setSDK(sdkGlobal);   // the global that vendor/ai-sdk.min.js defines
store.on('doc', (e) => { engine.setDoc(store.doc); /* views update from e.touched */ });
```
Everything else talks through the store, the view store, the action registry and the engine facade.

### 9.3 Milestones

| Milestone | When | Content |
|---|---|---|
| M0 | week 1 | WP0 done; contracts in this file frozen; CI green on stubs |
| M1 | weeks 2–3 | WP1 and WP2 core; WP4 early deliverable (kit + harness); WP5 two parts per kind; WP6 schedule/zip/analyze; WP7 providers and lyric I/O; WP8 shell + stage + steps on the fake engine |
| M2 | weeks 4–6 | planner end-to-end; real scenes and renderer; inspector over the real Plan; MP4 export through the real engine |
| M3 | weeks 6–8 | full catalog; AI adapter complete; UI complete incl. AI panel, palette, timeline drawer |
| M4 | weeks 9–10 | performance, browser matrix, en UI, release candidate |

### 9.4 Changing a FROZEN contract

A change to anything marked FROZEN needs: a PR that edits this file first (with the reason), approval by the lead and by the
owners of every package that imports the changed interface, the matching test/fixture/golden updates in the same PR, and a
note in the PR description listing affected packages. NodeTable columns, the Plan shape, path grammar, command payloads and
the kit exports are the most expensive to change; prefer adding optional fields over changing existing ones.

---

## 10. Open questions (decide during M1; each has a default that the builders use until decided)

1. **AI alignment over LRC stamps.** Default: allowed; results are pins by `ai`, which win over stamps, and the review row
   says 「LRCの時刻より優先されます」.
2. **Reading-rate defaults** (7 morae/s; `bpm/20` with a song) and the cutter's `BASE` cells per aspect need tuning on real
   songs; change the constants, not the rules.
3. **Cost display in yen** for the AI panel: default shows USD in both languages until a fixed display rate is decided.
4. **User images** (`photoPan`): v2.0 keeps it pin-only with a minimal asset store; the asset UI may move to v2.1.
5. **Phase 2 options** (not in v2.0): export rendering in a Worker (then CSP `worker-src blob:`); an own fragmented-MP4
   writer behind `export/muxer.js` and direct REST calls instead of the AI SDK, which would leave no third-party code in the
   page. The spec currently keeps both vendor files and their notices.
6. **License statement.** v2 is released under the MIT License (`LICENSE`, © 2026 momomonbi); the vendor notices stay
   in `THIRD_PARTY_NOTICES.md` and on the About page.
7. **Font families.** WP2 verifies every listed Google Fonts family on day one; replacements keep the flavor.
