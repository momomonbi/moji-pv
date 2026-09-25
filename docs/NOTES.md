
## WP0a

Contract gaps found while building the kernel (core/define, hash, rng, noise, num, ease, color, mat, schema, paths,
pins, motion, types). The public interfaces are unchanged; each item says what the code does.

- **`fitMotion({ … window … })` and the L0–L5 `window` lint (§4.7 vs §2.4).** The frozen option name is also a banned
  browser global. `build.py` lets it through only when the file binds `window` itself. `core/motion` destructures it as a
  parameter, and `heroTime` uses `const window = b - a`. **Callers (planner, scene) should do the same**:
  `const window = cut.b - cut.a; fitMotion({ dur, each, count, window, share })`. A bare `window: x` key is flagged.
- **`autoValue(spec, ax)` (§4.2) vs `autoValue(spec.auto, ax)` (§4.16.8).** It accepts both. A ParamSpec (it has `type`) gives
  a coerced value. A bare AutoSpec gives the raw value, because there is no type to coerce to. When an auto gives a value the
  type cannot hold (for example, a `fn` returns junk), the result falls back to a valid base value (`min`, `of[0]`,
  `'linear'`, …) and never to `undefined`.
- **`ease.reverse` (§4.1.4).** `elasticOut`, `bounceOut` and `springOut` have no In form in the frozen EASES list. `reverse`
  maps them to the nearest listed curve that starts the same way: elasticOut → backIn, springOut → backIn,
  bounceOut → quadIn. Every other name is exactly In↔Out, with InOut, linear and steps unchanged.
- **`describeAuto` text (§4.2 vs §4.24 "no UI text in code").** core/* is L0 and cannot use i18n, so the few ja/en words it
  needs (source, amount and tag names, "follows", "one of", …) live in `core/schema.js` as [ja, en] pairs. WP8 may override
  them later with string-table keys.
- **`validateSpec(name, spec, opts?)`.** Takes an optional `{ label: false }` to skip the label rule (labels are required
  for part params only). Extra rules beyond §4.2: auto ranges and value/pick candidates must lie within min..max; `weights`
  only goes with `pick`; `follow`/`jitter` only go with `range`; `follow` must be a known SOURCE (amount keys §3.4.1, tags
  §4.18.1).
- **`coerce` details.** For `num`, steps count from `min` (or 0), and the result is rounded with toPrecision(12) to remove
  float noise. `-0` becomes `0`. For `text`, line breaks become spaces and the value is cut to `max` code points (never inside
  a surrogate pair). `null` and objects give `undefined`.
- **`color.hueDeg` uses the HSL hue** in [0, 360), with 0 for greys. The DESIGN does not name a hue space; HSL matches
  the "within 40° of green" rule of §4.16.3 and CSS. `mix`, `shade` and `fitContrast` work in OKLab. `fitContrast` tries both
  directions and keeps the smaller change in L. If neither direction reaches `min`, it returns whichever end has the higher
  contrast.
- **`pins.lookup` result `at`** is the path of the winning pin (e.g. `'line/r3:arrive'`). If `at.pinCutKey` is undefined,
  `cutKey` is used; an explicit `null` means no cut pins are attached. If `at.lineId` is undefined, it is derived from the
  cut key. `PinIndex` has two extra fields: `byLine` (lineId → its pin cut keys, sorted by offset) and `bad` (paths that
  do not parse).
- **`attachCuts`** follows §4.10.4 literally. A key shadowed at step 2 is not retried at step 3. When a pin key's pins carry
  different `sig`s, a cut matches if its text equals any of them.
- **Additive exports** (not listed in §4, safe to use): `hash.canonical`, `rng.Stream`, `color.isHex`,
  `schema.{TYPES, UNITS, FACES, AMOUNT_KEYS, TAGS, SOURCES, sourceValue, SchemaError}`,
  `paths.{KINDS, isLineId, PathError}`. `hashJSON` prints typed arrays as plain arrays.
- **Kernel observation (frozen code, not changed).** If a factory throws, its id stays in `busy`, so a later `MV.use` of
  that id reports "dependency cycle" instead of the original error. Worth fixing through §9.4 if it confuses anyone.
- **Test command.** On Node 22.22, `node --test tests/node` (a bare directory) fails with MODULE_NOT_FOUND. Use
  `node --test 'tests/node/*.test.js'` in CI.

## WP0b

Build, document, store, registry, i18n kernel, fixtures and test helpers. Frozen interfaces are kept; these are the
readings and additions.

- **build.py lint of browser globals (§2.4 vs §4.7).** In L0–L5 (and `ai/*` for its list), `document window navigator
  localStorage sessionStorage indexedDB` are flagged only as values: not after `.` (`x.window`), not as object keys
  (`window: w` is allowed, correcting the WP0a note above), and not at all in a file that binds the name itself (a
  parameter, `const`, or destructuring). `fetch(`, `setTimeout`, `setInterval` and `requestAnimationFrame` are flagged only
  as bare globals, so injected services (`api.fetch(…)`) pass. Comments, string contents and regex bodies are skipped;
  `setAttribute('style'` and ` on…=` inside HTML strings are checked on the literals.
- **build.py part rules.** `let`/`var` directly in a part factory body is flagged (a `for (let …)` header is not). A
  function auto may use its own parameters and locals, the factory's kit parameter (`K`), and pure JS built-ins (`Math`,
  `Number`, …). Built-ins are not in §2.4's literal list, but they are pure.
- **build.py layers.** Same-layer dependencies are allowed in L2, L3, L5 and L6 (e.g. `ai/looks → ai/providers`); the
  table lists only lower layers. `parts/catalog` may depend only on `core/registry` (its frozen code).
- **build.py extras.** `--root DIR` builds a copy of the tree (tests). `--lab` writes both app pages and the lab page.
  The lab page has the same structure (vendor scripts included). A missing `src/ui/style.css` gives an empty, hashed
  `<style>`. The header rule also covers `style.css`. `</script` or `<!--` in an inline script, and `</style` in the CSS,
  fail the build. `ui/boot` (`ui/lab` with `--lab`) is required only when pages are written, so `--check` passes on a
  partial tree.
- **Test command.** CI runs `node --test "tests/node/*.test.js"`. On Node 22.22, a bare directory argument is not
  expanded; see the WP0a note.
- **core/doc.** Additive exports: `APP_VERSION FORMAT CURRENT_SCHEMA ASPECTS LANGS BACKDROPS PIN_BY FILTER_KINDS
  normalizeSide`. `touched()` also reports `meta`. `rows` is the set of added, removed and edited row ids, or `'all'` when
  kept rows changed their relative order. A row rebuilt with the same text is not touched. `serialize` writes maps keyed by
  user data (pins, salts, locks, filters, look-entry salts) with sorted keys, and unknown keys after the known ones. It
  ends with a newline. The fixtures are stored in this canonical form. `normalize` computes a missing `sheet.next` from the
  row ids.
- **core/migrate.** `MigrateError('invalid')` carries `problems` (from `validate`). A file without a `doc` object is
  `not-a-project`. `MIGRATIONS` is empty (schema 1 is the first).
- **core/store.** `createStore` takes two optional hooks: `now()` (milliseconds; `meta.at` overrides it per dispatch)
  and `freeze` (default `MV.DEV`). The store cannot read a clock under the L0 lint. Without `now`, a same-`mergeKey` run
  ends only at `seal()`, the end of a gesture, or another command; the UI seals after 600 ms idle (§3.10). Other details:
  - The default label is `['undo.edit', {}]`.
  - `list()` entries carry `done`, and `jump(0)` means "before the first entry".
  - A merged run whose `after` is the entry's own `before` object is dropped.
  - A throwing listener does not stop the others; the first error is rethrown after all have run.
  - `load()` emits `'doc'` (kind `'load'`, rows `'all'`), then `'side'`.
- **core/registry.** `SHARED[kind]` holds full ParamSpecs for the §3.4 shared params. The names are frozen; the ranges,
  autos and labels are WP0b defaults, and WP3/WP5 may tune them here. `registry.params(kind, key)` returns
  `[{ name, spec, shared }]`: shared params first, with the part's `shared` overrides merged, then the part params in
  declared order. `planner/params` should read specs from there.
  - Additive: `registry.blurb`, `registry.traits`, `registry.problems` (non-strict mode skips invalid defs),
    `checkDef`, and the constants.
  - `pool()` also accepts `aspect`, `amounts` (gate at 0 excludes) and `texture: true`. `scope` applies to ornaments and
    seams.
  - `all()` is ordered by KINDS order, then key.
  - Extra validation: shared overrides may only narrow the range and keep the type; `count` is a reserved param name for
    ornament and filter; mood `variety` is 0.6–1.2; mood `filters` is required (§4.18.2) but its keys are not checked
    against the registry. Theme `texture` is not checked either, so subset registries validate.
- **i18n/t.** `createT(lang, strings, registry?, opts?)`. `opts.strict` defaults to `MV.DEV`: in strict mode a missing
  key throws `I18nError('missing-key')`; otherwise `t` returns the key.
  - English plurals split on `|` only when `params.n` is a number, so texts about the `|` lyric mark need no escaping.
    `\|` is a literal bar.
  - Additive: `t.lang`, `t.has`, `t.label([key, params])`, and the `placeholders()` export.
  - `fmtTime(s, { frames: true, fps })` gives `m:ss:ff`.
  - `fmtMoney` shows USD in both languages (§10.3); `opts.yenPerUsd` switches ja to `¥n`.
- **i18n/strings (skeleton).** Keys beyond §6.13:
  - `boot.*`, `lab.*` and `count.lines`;
  - `kind.<kind>` for all 11 kinds;
  - `why.<code>` for every §4.16.8 code, and `warn.<code>` for every §3.13 warning code (the key is the code itself);
  - `err.ai.<code>` for all 17 §4.22.1 codes, and `err.file.<MigrateError code>`;
  - `undo.edit`, `undo.pin`, `hdr.redo`, `look.first` and `look.omakase`.

  The texts are first drafts; WP8 owns the content.
- **Fixtures.**
  - `stub_parts.js` exports `stubParts()`, `fallbackParts()`, `allStubParts()` and `PH`. The fallbacks use the §5 keys
    (rules name them) but are minimal stand-ins; the stub `sumiWashi` uses `grainFilm` as its texture. The other stubs are
    `stub*` keys. Ornaments draw with `sb.paint`, because the ShapeSpec encoding belongs to the kit. Dwell behaviours use
    `PH.REST`.
  - `plan_basic.json` is specified by hand for `project_basic` and uses only stub and fallback keys, so the stub registry
    can render it. Its `hash` is `hashJSON(plan without hash)`.
  - In `plan_basic.json`, the title cut's `a` is −0.12 (`t0 − lead`, not clamped). `seams` lists only boundaries that are
    not `hardCut`; otherwise `seamIn` is −1. `impact` is on the last piece of the `!` line.
  - `corpus()` returns an array, which is iterable, instead of a generator.
- **Golden files (for WP3/WP4).** `update_golden.js` uses the catalog when `parts/catalog` exists, and the stub parts
  otherwise. It skips goldens whose modules are missing, and `--check` compares without writing. The formats are
  `plan_hashes.json` = `{ registry: { kind, version } | null, plans: { "<corpus name>": hash } }` and
  `frame_hashes.json` = `{ registry, measurer: 'fake', frames: { "<project>": [40 hashes of each frame's recorder ops] } }`.
  Frames are rendered at a short side of 360 px, at t = duration·(i + 0.5)/40.
- **fake_engine.js.** `createFakeEngine({ …facade options, plan? })` implements the §4.20 methods. It also exports
  `createRecorder` (a §4.19.8-style recording Ctx2D with `ops/hash/stats/reset`), `surfaceOf`, `trivialPlan(doc)` and
  `loadPlanBasic()` (Node only). In a browser page it is `window.MVFake`. It is exercised by `tests/node/fake_engine.test.js`.
- **Stubs.** `ui/boot.js` shows 「準備中」 / "Coming soon" and sets `MV.app = { stub: true, lang }`; WP8 replaces it.
  `ui/lab.js` lists the loaded modules; WP4 replaces it. `csp.py` checks only that `#app` rendered something, so it still
  passes with the real boot.

## WP0 integration

WP0a and WP0b merged into one package. These entries supersede the earlier WP0a/WP0b lines where they differ.

- **`node --test tests/node` works now (§8).** Node 22 loads a directory argument as a module, so
  `tests/node/index.js` runs every `*.test.js` there, each in its own process (§2.7), and reports one result per
  file (with the file's pass/fail counts as a diagnostic). CI keeps `node --test "tests/node/*.test.js"`, which
  reports every test; the glob never loads `index.js`. New test files need no registration.
- **`tests/node/contract.test.js`** checks the FROZEN WP0 interfaces against DESIGN: every export named in §4.1–§4.7 and
  §4.24 (and its kind), the frozen lists and constants, the Stream/Store/Registry/`t` members, the return shapes and
  error codes, and that `define.js`, `hash32` and `gen` are verbatim copies of the DESIGN code blocks (read from DESIGN.md
  at test time). It also checks the seams: shared params are valid ParamSpecs, every registry key and param forms a
  slot path, `plan_basic` slots parse, and the fake engine hashes like `core/hash`. A §9.4 change must update it.
- **Registry keys are at most 32 characters.** The §4.6 key pattern allows longer keys, but the §3.4 PARTKEY grammar
  (`[a-z][A-Za-z0-9]{2,31}`) could not address them, so such a part could never be pinned. `createRegistry` reports
  `key must be at most 32 characters`.
- **`registry.all()` is sorted by (kind, key) as strings**, the literal §4.6 order. This replaces the WP0b note ("KINDS
  order, then key"). `keys(kind)` is unchanged.
- **`fitMotion` and the `window` lint, final rule.** `window: expr` as an object key passes; the shorthand `{ window }`
  needs a local `const window = …` (or parameter) in the same file. The WP0a line saying a bare `window: x` key is flagged
  is wrong; WP0b's note is right.
- **Fake engine.** `fake_engine.js` also exports `createEngine` (the §4.20 name), so code written against
  `engine/facade` can take it unchanged; `fork()` keeps the services it was created with.
- **`csp.py`** also loads the lab page, and rebuilds the pages (`build.py --lab`) when one is missing or older than its
  inputs, so it never tests a stale page.
- **Unchanged, for the lead:** the kernel keeps an id in `busy` when a factory throws (frozen code, WP0a note); the store
  has no clock of its own, so boot should pass `now` for the 2 s typing window (WP0b note).

## WP0 review fixes

Fixes for the reviewer's WP0 findings. Where these entries differ from the earlier WP0 notes, these win.

- **Line endings and the CSP hashes (§2.6 steps 5–6).** Before hashing a script or style element, the HTML parser turns
  CRLF and a lone CR into LF. The build now reads every inline input the same way: vendor scripts, modules, the kernel
  and `style.css`. So a CRLF checkout (for example `core.autocrlf` on Windows) or a stray CR gives the same page and
  hashes the browser checks. "Vendor used unmodified" (§1.4) therefore means unmodified apart from line endings; the
  browser sees those as LF anyway. A NUL in any inline text fails the build (the parser would turn it into U+FFFD). A
  file that is not UTF-8 is reported as `encoding: not UTF-8` instead of crashing the build. `csp.py` also builds a
  scratch tree with CRLF vendor files, a lone CR in a module and CRLF CSS, and checks it in Chromium. It also checks that
  `Mp4Muxer` and the AI SDK global exist on every page. No `.gitattributes` was added: the build no longer depends on
  checkout line endings, and a repo-wide attribute file would also cover files WP0 does not own. The lead can still
  add one.
- **Browser-global lint, final rule (replaces "fitMotion and the window lint" above).** In L0–L5 (and `ai/*` for its
  list), `document window navigator localStorage sessionStorage indexedDB` are checked per scope, not per file:
  - A use is allowed only inside the scope of a local binding of that name: the block around a `const`/`let`/`var`
    (a loop head covers the loop body), or the parameters and body of a function, method, `catch` or arrow. `var` is
    treated as block-scoped.
  - A member access, index or call on the name (`window.x`, `window[k]`, `window()`) is always flagged, even on a
    local, because a local that reuses one of these names is a number or a plain value, never an object.
  - The fitMotion pattern still works: `const window = cut.b - cut.a; fitMotion({ …, window })`. So does
    `fitMotion({ window: cut.b - cut.a })`. A local binding no longer opens the rest of the file to the global.
  - Default values bind nothing (`function f(w = window)` is flagged), and neither does a renamed key
    (`{ window: w }` binds `w`).
- **Object keys vs values.** A name counts as an object key only when the character before it is `{` or `,` and the
  one after it is `:`. The middle operand of `c ? document : null` and a spread `...navigator` are values. This rule
  applies to the browser globals, `Date` and the three timer names.
- **`Date` (§7.1).** In L0–L5 (not `ai/*`), any value use of the bare identifier `Date` is flagged as
  `lint Date (L0–L5)`: `Date()`, `new Date`, `Date.now` and `Reflect.construct(Date, …)`. The separate `Date.now` and
  `new Date` rules are gone.
- **Member calls are not the banned forms.** `eval(`, `import(`, `require(`, `fetch(` and `with (` are flagged only as
  bare identifiers. So `rows.with(i, row)` (ES2023, useful for structural sharing) and `o.import(1)` pass. `with (x)`
  and `import('x')` still fail.
- **Function autos (§2.4 last row).** The token scan now covers `fn(f) { … }` (method shorthand) as well as
  `fn: (…) =>`, `fn: x =>` and `fn: function (…) {…}`. Any other value (`fn: helper`, `{ fn }`, `fn: K.x`,
  `fn: make()`) is flagged as `lint fn auto must be an inline function literal`. Default values and spreads inside
  the auto are checked like its body. Locals declared inside it, destructuring included, are allowed.
- **i18n plurals (§4.24).** Only English texts are split on `|`. A ja text, and the ja fallback for an empty en text,
  is used as written, even with a numeric `n`. So `{n}行に「|」…` about the lyric note mark is never cut.
- **Open for the lead (§9.4):** the §2.4 lists do not name `globalThis` or `self`. So in L0–L5,
  `globalThis.localStorage` or `globalThis.fetch(…)` is not flagged. It could be banned outside `core/define.js`
  (whose FROZEN code uses `globalThis`), but that extends a FROZEN list, so it is not done here.

## WP6

Media: `audio/{fft,analyze,digest,wav,peaks}`, `audio/host/{decode,player}`, `export/{schedule,zip,muxer}`,
`export/host/{mp4,png,sink}`; tests `audio`, `export_math`, `zip` and `tests/browser/export_check.py` with the harness
`tests/www/export_check.js` (not shipped). Frozen signatures are kept; these are the readings and additions.

- **Analysis (§4.13).** Onset frame k is the 1024-sample Hann window centred on k/100 s. The strength is the log
  spectral flux, scaled so its 99th percentile is 1 (then clamped). The tempo is the peak of Σ autocorrelation at 1…4
  beats (60–200 BPM, 0.25 BPM grid). The octave is the best of score × a log-normal prior (120 BPM, 1 octave), then
  doubled while the off-beats are > 0.5 of the beats. Period and offset are refined by a weighted least-squares fit of the
  onset peaks. `bpm` is `null` (confidence < 0.15, silence, or < 2 s); `offset` is the first beat in `[0, period)`.
  Real songs can still come out at half or double tempo; the ② テンポ menu has ×2 ÷2 for that. Additive exports:
  `analyzeSync`, `estimateTempo(strength, hz)`, `dbToUnit`, `HZ`, `WIN`, `BPM_MIN`, `BPM_MAX`.
- **`level(env, t)`.** Sample i stands for the middle of its window, `(i + 0.5) / hz`. Between centres the value is
  interpolated; before the first centre it is sample 0, after the last it is the last sample. Outside `[0, n / hz)` it is
  0 (silence); with `env = null` it is 0.5. `digest` gives `ceil(frames · 20 / hz)` bytes. Additive:
  `songRecord({ name, sha1 }, analysis)` builds the `song.set` payload (bpm to 0.01, offset/seconds to 0.001),
  `toBase64`/`fromBase64` (own code, no `btoa`).
- **`encodeWav`** keeps a fixed arithmetic order (Float32 mono buffer, peak from the double), and `audio.test.js` pins
  its bytes (SHA-256) for fixed inputs. WP7 imports it from `audio/wav`. `pickRate` and the rest
  stay with WP7.
- **`peaks(channels, rate, { base = 128, minLength = 256 })`** → `{ rate, levels }`. Level 0 has 128 samples per peak,
  and each level doubles it. Additive: `levelFor(peaks, samplesPerPixel)`.
- **Decoding at 48 kHz.** `decodeFile` decodes with `OfflineAudioContext`, which resamples to its own rate, and the
  source rate is unknown until the file is decoded. So every song is 48 kHz, and the AAC track is too (§4.21 "source
  rate (44.1/48 kHz)"). The SHA-1 is computed before decoding, because `decodeAudioData` detaches the buffer. Additive:
  `DecodeError` (`empty`, `decode`, `unsupported`, `cancelled`), `sha1Hex`, `channelsOf`,
  `analyzeBuffer(buffer, { signal, onProgress })` (steps the generator in ~12 ms slices), and `loadSong(file)`, which
  returns `{ buffer, analysis, song, peaks }` in one call for step ②.
- **Player.** With a song, `now()` is the time being heard: `getOutputTimestamp()` maps the page clock onto the audio
  clock, so the preview never runs ahead of the sound by the output latency. `outputTimeOf(event.timeStamp)` uses the
  same mapping. With no song it runs on `performance.now()`. The clock runs to `duration` even when the buffer is
  shorter. `play()` with no argument at the end starts again from 0.
  - `on(kind, fn)` returns an unsubscribe function; listeners get `{ playing, t, rate, muted }`.
  - `rate` can be set (0.25–4); a running song restarts at its current position with the new playbackRate.
  - Additive: `duration`, `load({ buffer, duration })` (swap the song or the length; playback stops) and `dispose()`.
    The `AudioContext` is created on the first `play()`, so the play click unlocks audio.
- **Export math.** `frameCount` is the FROZEN formula clamped at 0, so `frameCount(0)` is `0`, not `−0`. `pickAvc` takes
  the smallest H.264 level whose MaxFS and MaxMBPS hold the frame. This gives every example in §4.21. Where the
  examples are silent, it picks what the level table requires: 1440p60 → `…33` (level 5.0 cannot carry 60 fps at
  1440p), 21:9 at 1080p → `…32`, 21:9 at 2160p → `…3C`/`…3D` (up to level 6.2). Additive:
  - audio chunk math: `audioChunk`, `audioChunkCount`, `fillPlanar`;
  - output helpers: `keyInterval`, `estimatePngBytes`, `exportRange(doc, plan)` (output.range clamped to the video),
    `backdropFor(format, backdrop)` (pngAlpha → `clear`; `clear` is shown as `scene` in MP4 and opaque PNG),
    `renderScale`, `fileName(doc, ext)` (output.name, else `[ti:]`, else `mojipv`; unsafe characters removed),
    `frameName`;
  - flash checks: `flashEvents`, `flashRate`;
  - `ExportError` (codes `cancelled no-webcodecs no-codec no-plan range-empty encode sink codec args aspect quality`).
- **Pre-flight** returns `{ code, level: 'block'|'confirm'|'warn'|'info', params, jump?, fix? }`. `fix` is the command
  to dispatch (the flash fix). It takes `env = { webcodecs, codec, audioCodec, fontsReady, fsAccess, songReady, warnings }`,
  where `codec`/`audioCodec` are null when unsupported and undefined when not probed. `export/host/mp4.probe({ w, h,
  fps })` fills the WebCodecs fields. Codes:
  - `range-empty` and `no-webcodecs` / `no-codec` block;
  - warnings: `no-audio-codec` (the MP4 is exported without sound), `song-missing` (the song is not re-linked, so no
    sound), `clear-mp4`, `memory` (`confirm` above 1.5 GiB), `flash-rate`, `overfull` (one per line, `jump: { cut }`);
  - info: `fonts-loading`, `font-fallback`.
  - Flash counting: `flash` impulses with amp > 0.3 (so the fix `work:amount.flash = 0.3` clears it), `whiteFlash` seams
    at `at`, and `flashPop` filters with amount > 0.3 by their `when` (each beat, arrival, departure, or the impact
    time). Events closer than 1/60 s are one flash. `invertBlink` is not counted, because §4.21 names only the two parts.
- **Muxer adapter.** `'stream'` uses `StreamTarget` (chunked, 8 MiB) whose `onData(data, position)` goes to
  `write(bytes, position)`. `FileSystemWritableFileStreamTarget` is not used, so every sink is one interface and the
  OPFS test covers the disk path. The adapter copies each piece before queuing it. `firstTimestampBehavior` is
  `'cross-track-offset'`. The video time scale is `fps`, so frame i lands exactly on i / fps. Additive: `codec`
  (`'avc'` default) and `audio.codec` (`'aac'` default), with `muxCodec('avc1.…') → 'avc'`; `ready()` waits while more
  than 64 MiB is unwritten; `backlog`.
- **exportVideo / exportPngs.** Extra options, all optional:
  - `canvas`: a CanvasFactory; the default is `OffscreenCanvas`.
  - `lib`: the default is the global `Mp4Muxer`, passed to the adapter.
  - `codecs: { video, audio }`: overrides the AVC/AAC choice. Only tests set it: local Chromium has no H.264/AAC
    encoder, so `export_check.py` then checks the same pipeline with VP9/Opus in MP4. The product never sets it.

  Behaviour:
  - When the fork has no plan yet, the export calls `setDoc(doc)`. The export sizes come from `plan.design.aspect` and
    `output.short`, and `renderFrame` gets `opts.backdrop` from `backdropFor`.
  - Progress is `{ i: frames done (1…N), N, eta: seconds | null }`, once per frame.
  - `Result` adds `codec` and `audio` (false when AAC is unsupported or no song was given).
  - Any failure or cancel closes the encoders and aborts the sink.
  - `exportPngs` keeps 4 PNG encodes in flight. `convertToBlob` snapshots the canvas, so the next frame renders at
    once.
  - The ZIP holds `<name>_00000.png …` at the root.
- **ZIP.** Without `opts.date` the DOS stamp is fixed (1980-01-01), so an archive is byte-reproducible. The PNG host passes
  the local time. ZIP64 records are written when sizes, offsets or the entry count need them; `zip64: true` forces them
  (tests). Python's `zipfile` and `unzip -t` accept both forms.
- **Sinks** = `{ kind, name, bytes, write(bytes, position?), close() → { bytes, blob? }, abort() }`.
  - A memory sink keeps appended pieces without copying them (callers hand over fresh buffers) and patches earlier
    bytes in place.
  - A file sink writes `{ type: 'write', position }` through `createWritable()`. `abort()` also calls
    `handle.remove()`, so a cancelled export leaves no file; the browser test checks this on OPFS.
  - Additive: `openSink({ name, kind })`, which calls `showSaveFilePicker` when it exists and must be called straight
    from the click; it returns `null` when the user closes the dialog, else a memory sink. Also `canStream()` and
    `downloadBlob(blob, name)`.
- **Not done here:** the export part of `ui_flows.py`, because there is no UI yet. WP8's `step_export.js` should use
  `probe` + `preflight`, `openSink`, `exportVideo` / `exportPngs` with an `AbortController`, and `downloadBlob` for
  memory results. The H.264/AAC branch of `export_check.py` has not run here (no Google Chrome in this container); CI
  runs its H.264 part (Google Chrome on Linux has no AAC encoder). `export_check.py --long [s]` is the WP6 acceptance
  run: project_basic at 1080p30, 180 s by default.

## strings wanted

For WP8 (`i18n/strings.js`), from WP6. `{size}` is `fmtBytes(params.bytes)`, `{time}` is `fmtTime(params.at)`,
`{eta}` is `fmtTime(eta)`.

| Key | ja | en |
|---|---|---|
| `exp.pre.no-webcodecs` | このブラウザでは MP4 を書き出せません。PC の Chrome か Edge を使ってください。PNG 連番は使えます。 | This browser cannot export MP4. Use Chrome or Edge on a computer. PNG sequences still work. |
| `exp.pre.no-codec` | このパソコンでは {w}×{h}・{fps}fps の MP4 を作れません。大きさかなめらかさを下げてください。 | This computer cannot make an MP4 at {w}×{h}, {fps} fps. Choose a smaller size or frame rate. |
| `exp.pre.no-audio-codec` | このブラウザでは MP4 に音声を入れられません。音なしで書き出します。 | This browser cannot add sound to an MP4. The video is exported without sound. |
| `exp.pre.song-missing` | 曲がつながっていないため、音なしで書き出します: {name} | The song is not loaded, so the video has no sound: {name} |
| `exp.pre.clear-mp4` | MP4 は透明にできないため、通常の背景で書き出します。透明にするには透過PNGを選んでください。 | An MP4 cannot be transparent, so it gets the normal background. Choose transparent PNG for transparency. |
| `exp.pre.fonts-loading` | 書体を読み込み中です。読み込みが終わってから書き出します。 | Typefaces are still loading. The export starts once they are ready. |
| `exp.pre.memory` | ファイルに直接書けないため、メモリ上で作ります（約 {size}）。 | The file cannot be written directly, so it is built in memory (about {size}). |
| `exp.pre.memory.confirm` | 約 {size} をメモリ上で作ります。パソコンが重くなることがあります。続けますか？ | About {size} will be built in memory. The computer may slow down. Continue? |
| `exp.pre.flash-rate` | 1秒間に{n}回の点滅があります（{time}）。光に敏感な人のために弱めることをおすすめします。 | There are {n} flashes within one second ({time}). Consider toning them down for viewers who are sensitive to flashing light. |
| `exp.pre.flash-fix` | 点滅を弱める | Tone down flashes |
| `exp.pre.overfull` | {n}行の文字が入りきりません | Line {n}: the text does not fit |
| `exp.pre.font-fallback` | 書体「{family}」を読み込めませんでした — 代わりの書体で書き出します | The typeface "{family}" did not load. A fallback is used. |
| `exp.pre.range-empty` | 書き出す範囲が空です | The export range is empty |
| `exp.progress` | 書き出し中 {i}/{n}（残り {eta}） | Exporting {i}/{n} ({eta} left) |
| `err.exp.cancelled` | 書き出しを中止しました | Export cancelled |
| `err.exp.encode` | 書き出し中にエラーが起きました。大きさかなめらかさを下げて試してください。 | Something went wrong while exporting. Try a smaller size or frame rate. |
| `err.exp.sink` | ファイルに書き込めませんでした。空き容量を確かめてください。 | The file could not be written. Check the free disk space. |
| `song.analyzing` | 曲を分析しています… {pct}% | Analyzing the song… {pct}% |
| `err.song.decode` | この曲のファイルを読み込めませんでした。 | This audio file could not be read. |
| `err.song.empty` | ファイルが空です。 | The file is empty. |
| `err.song.unsupported` | このブラウザでは曲を読み込めません。 | This browser cannot load songs. |

## WP1

Document: `core/{script,lyrics,reconcile,timing,beats,tap,commands}`; tests `script`, `lyrics`, `reconcile`,
`timing` (also covers `beats`), `tap`, `commands`. Frozen signatures are kept; these are the readings and additions.

- **core/script (for WP2).**
  - Additive exports: `snapOffset(str, off, 'floor'|'ceil')`, `snapToBoundary(graphemeOffsets, off, mode)` and
    `CLASSES` (the 13 class names).
  - Graphemes: the halfwidth voicing marks U+FF9E–FF9F also extend (Unicode treats them so).
  - `charClass` looks at the first code point, except that a grapheme with VS16, keycap or ZWJ is `emoji`. Other
    readings: ー is `kata`; ・ is `punctJa`; 々〆〇〻 are `han`; ― ‥ … ※ ‼ ⁉ are `punctJa`; U+3000 is `space`;
    Greek and Cyrillic are `latin`; ★ ♪ are `symbol`.
  - Halfwidth katakana has no class of its own in the frozen list, so it is `kata`/`smallKana`. Use `cells(g)` (0.5) to
    tell the width.
  - `cells` sums in twentieths, so results are exact (`cells('Fly high') === 4.15`). A fullwidth space counts 1.
  - `morae`: ヵ and ヶ count 1. Latin words inside any line count vowel groups (a leading y is a consonant). Han counts
    1.7 only when lang is `ja`.
  - `lineScript`: a line with no letters (symbols, emoji) takes `docHint`, else `en`. `SIMP_ONLY` is only data here: a
    han line without a TRAD_ONLY form is `zhHans` either way.
- **core/lyrics.**
  - `parseRow(src, hint?)` takes the sheet's script hint as an optional second argument. ParsedRow has two additive
    fields: `tag` and `value` (the meta row `[ti:x]` gives `ti` and `x`). Empty headings and titles are `null`.
  - A lyric row whose text is empty (`[00:30.00]` alone, or only marks) is not a line. `linesOf` counts it as a pause
    in `pauseBefore`, like a blank row.
  - Comment and meta rows are skipped when counting `pauseBefore`, so a blank row followed by `# サビ` still gives the
    chorus line its pause. This is broader than the literal "directly above".
  - `heading` is the nearest comment with a non-empty heading within the 3 rows above. Every occurrence of a row gets
    it.
  - `renderRow` escapes only where the parser would otherwise read a mark:
    - `/ * | \` are always escaped;
    - a leading `#` (when there are no stamps) and a leading `[` are escaped;
    - a final `!` is escaped when impact is off;
    - other `!`, `#` and `[` stay plain, because users see this text in the editor.
  - Stamps that centiseconds cannot hold are written as `[mm:ss.xxx]`, so parsed rows round-trip. `lrcTag` itself stays
    `[mm:ss.xx]`. A single piece is written with a trailing `/`.
  - `roundTrip` compares emphasis in sorted order.
  - The empty text has no rows: `lyrics.set('')` gives `rows: []`.
- **core/reconcile.**
  - `reconcile` also returns `info: { before, after }`: a `Map` from row id to `{ text, lines }`. `commands` uses it to
    remap without parsing twice.
  - Additive exports: `remapKeyed(keyed, before, after, edited)` (§4.10.3), `rowInfo`, `lcsPairs`, `splitRows` and
    `rowKey`.
  - Keys shorter than 2 characters have no bigrams. Their Dice score is 1 when the keys are equal, else 0. So editing a
    1–2 character row gives it a new id.
  - `edited` also covers anchored rows whose plain text changed only in spacing or case, because their offsets move.
  - Removed lines are lines that existed before and not after. This includes a row that turned into a comment or lost
    its text. Their `cut/gap/<lineId>` pins and salts are deleted as well: that gap cut can never exist again.
  - Pins of ids that were never lines are left alone. Cut offsets beyond the old text (already orphans) are kept.
  - Split pins are mapped and deduplicated, and offsets that land on the new text end are dropped. `'none'` is
    untouched. The planner derives `lock-partial` itself: a lock whose lock pins were lost to a remap.
- **core/timing.**
  - Optional ctx fields `beatOffset` and `meter` (or a ready `grid`) are read for snapping; the frozen ctx has only
    `bpm`. **WP3: pass `beatOffset` (the slot) and `song.meter`.**
  - `ctx.pins` may be a PinIndex or a plain pins map. Start and end use `lookup` and only accept line-scope pins, so
    `work:start` is ignored. A bad value gives `pin-bad-value`, and so does a bad `lengthPin` (path `work:length`).
  - Pause attribution: the gap from line k−1 to line k is reading(k−1) + 0.8·pauseBefore(k). The pause belongs before
    its own line. The end rule uses the literal w = reading + 0.8·pauseBefore.
  - Back-fill: when the first anchor is not later than the title card, lines compress into [0, anchor].
  - Forward-fill: "the fill ends" is the last start plus its reading. Compression keeps at least 0.1 s per line.
  - Snapping never breaks the strict order of starts. A snap that would pass a neighbour is skipped.
  - With no lines, duration = max(titleCard, leadIn) + outro.
  - Times are `q6`-rounded. `time-compressed` warnings carry `line` (the first compressed line) and `detail.lines`.
  - Additive exports: `readRateOf(ctx)` and `TIMING_DEFAULTS`.
- **core/beats.** The Grid also carries `bpm`, `offset` and `meter`. `snap` defaults to unit `beat` with no tolerance.
  `beatsIn` is half-open, `[t0, t1)`.
- **core/tap.**
  - State: `{ lineIds, cursor, current, starts, ends, paused, next, active }`, where `next` and `active` are line ids
    for the UI.
  - Marks and ends are ignored while paused. An end at or before the line's start is ignored. Times below 0 clamp
    to 0.
  - `back` may step to lines before the start line.
  - Bad input throws `TapError` with code `bad-event` or `bad-lines`.
- **core/commands.**
  - **`lock.set` takes an optional `n`**, the store revision shown with the lock; the reducer cannot read the store.
    Without it, n is the existing lock's n, else 0. **UI: pass `n: store.rev`.** The payload never overwrites a
    user, ai or tap pin at the same path.
  - `pin.set` keeps `sig` only on cut paths. It copies the JSON value, so the store's deep-freeze never reaches the
    caller's object. Only JSON scalars, arrays and objects are accepted.
  - `pin.promote`:
    - a missing pin is a no-op, and a `lock` pin moves as `user`;
    - `start`, `end`, `split` and `lang` cannot go to work scope, and `t0` cannot be promoted;
    - the §3.6 lock release is not applied, so sibling cut pins stay.
  - `pin.copy` copies part slots (with their params), `orient` and `text.*` from exactly the `from` scope. The copies
    are `by: 'user'`, and the §3.6 release applies on locked target lines.
  - `pin.clear` accepts any existing key, even an unparsable one, so bad pins can be cleaned up.
  - `meta.set`:
    - `''` acts like `null`;
    - the first `[ti:]`/`[ar:]` row is rewritten and keeps its id;
    - removing removes every such row;
    - `[ar:]` is inserted right after the `[ti:]` row, else at the top.
  - `lyrics.move` keeps the moved rows in document order. `beforeRowId` cannot be one of them.
  - `time.shift` writes `user` pins and clamps the shift so no start goes below 0. Shift and tap times are
    `q6`-rounded.
  - `filter.set` with both lists null removes that kind's entry.
  - `song.set` fills missing song fields through `core/doc.normalize`. `timing.set`, `output.set` and `song.set` are
    validated with `core/doc.validate`.
  - Additive export: `COMMANDS`, the list of command names.
- **Acceptance measurements (this container, Node 22):**
  - parse + reconcile + remap of 300 rows with local edits: about 2 ms. A full 300-row replacement takes about 16 ms.
  - `solveTimes` of 300 lines: about 0.6 ms.
  - The 500-sequence command property test takes about 1 s. It checks undo-all, replay hash, `validate` after every
    step and structural sharing.
  - The tests assert the budgets with a ×3 margin for CI.
- **Strings wanted:** none. The warning codes already have `warn.*` keys. `CommandError` and `TapError` messages are
  for developers.

## WP8a

UI part 1: `ui/{dom,icons,keys,actions,selection,layout,looks,view,shell,header,stage,playbar,steps,step_lyrics,
lyric_editor,step_song,step_look,step_export,tap,project_io,toasts,boot}.js`, `ui/style.css`, `i18n/strings.js`; tests
`ui_layout`, `ui_keys`, `ui_selection`, `ui_looks`, the UI part of `i18n`, and `tests/browser/ui_layout.py`. Frozen
signatures are kept; these are the readings and additions.

- **Geometry (§6.2).** `computeLayout` reproduces the whole table exactly (no ±1 needed). Additive fields:
  `rects.drawer`, `canvas.{x, y, scale}`, `metrics` (header, pad, gap, lane, laneGap, controls, playbar, drawer) and
  `page { w, h, scroll }`. Readings:
  - The stage stacks preview → gap → drawer (144/112) → lane → gap → controls; so the drawer sits between the preview
    and the play bar, and the play bar never moves.
  - Compact: `rects.panel` is `null`; the one 320 px side column (`rects.side`) hosts 手順 / 詳細 / AI.
  - "Below 600 px the stage keeps 360 px": the preview area keeps 360 px of height and the page scrolls.
  - Stacked (< 1024): stage on top, at most 70vh and shrunk to the canvas; the side column below (≥ 480 px); the page
    scrolls vertically only.
  - `floor()` gets a 1e-7 guard so 538.9999… is 539.
- **Keys (§6.8).** `ctx: 'text'` holds the bindings that act *inside* text fields (Ctrl chords, Esc, F6, the lyric
  editor's Alt+↑/↓ and Ctrl+B); `'global'` holds everything for focus outside text fields. So "Ctrl combinations and
  Esc work everywhere" and "Ctrl+C/V not in text fields" are both plain table entries. In tap mode every key that would
  be an app shortcut resolves to `{ cmd: 'noop' }` (swallowed, default prevented); browser keys (F5 …) return null.
  `resolveKey` takes `mode: 'normal' | 'tap' | 'picker' | 'palette'`; picker keys fall through to the normal tables,
  palette keys do not. Space and Enter on a focused button, tab, radio or checkbox keep their native activation (a11y);
  everywhere else Space is play/pause. B is "hold": keydown starts the compare, keyup (or window blur) ends it.
- **Actions.** `createActions(getCtx)` makes an isolated registry (tests); the module's own `defineAction / run / list`
  are the app registry and `setContext(fn)` wires it (ui/boot). `run` returns false when an action is disabled or
  declines (e.g. Ctrl+← outside the timeline), and then the key keeps its browser meaning. Every action label is
  `cmd.<id>` (i18n test checks every `def('…')` in boot and every keymap command).
- **Selection.** `onPreviewClick(sel, hits, { alt, dbl, plan })`: `plan` is additive and lets single-cut lines skip
  the cut level (their elements live at `line/<id>` scope, matching §6.4.6 "pins go to line scope"). Additive exports:
  `lineOfSel cutsOf nextLine nextCut seekTime scopeOf equal withLine ELS WORK`. Crumb labels: `crumb.lines` (n行を選択中),
  `crumb.title/intro/outro/gap`, `crumb.ornament/filter` ({k}).
- **Look history.** `pointer().index` is the 1-based position in `side.looks.list` (what `n/m` shows). Field-dice
  entries carry the label `look.dice`; that is how "the newest entry was also field dice at that scope" is detected.
  Recording the look that is already the newest entry is skipped. Additive: `record`, `recordCmd`, `prev`, `next`,
  `restoreCmd`, `toggleStar`, `sameLook`, `scopeOfCmd`, `isFieldDice`. The first-plan entry (`look.first`) is added
  on the first paste / sample / lyrics file.
- **View store** (`ui/view.createView({ storage })`): `sel step panel rail railBy drawer playing time mode compare
  focusField highlight aiReview prefs`. Prefs (localStorage, every access in try/catch): `singleKeys autoFold autoplay
  seekOnSelect follow reduceFlash safeArea ai quality muted hintOmakase hintStacked`. `openPanel / closePanel /
  togglePanel / setRail` implement auto-fold and "restore only what was auto-folded".
- **Mount points for UI part 2/3** (clean, empty until they land):
  - detail column: `[data-mount="inspector"]` (shows the crumbs and a placeholder) and `[data-mount="ai"]`; the tabs,
    close button and compact side tabs are the shell's.
  - timeline drawer: `[data-mount="timeline"]` inside the stage at `rects.drawer`.
  - view state for them: `focusField` (the path Del unpins), `aiReview` (disables 詳細), `highlight` (a line id);
    `app.paletteOpen` / `app.pickerOpen` switch the key mode; `app.bus` events `plan side time song export save
    layout focus ai.tool` (the AI panel listens to `ai.tool` = `prep | looks | align`).
  - the ≡ menu and the history popover are small built-in lists in `ui/header.js` (`header.popover`); menus.js may
    replace them. `help.keys` shows a generated key sheet the same way.
- **Boot and stand-ins.** Real modules are used whenever `MV.has` finds them: today `core/commands`, `core/tap`,
  `core/lyrics` (samples), `audio/host/{player,decode}`, `export/{schedule,host/*}`. The STAND-INS section at the end
  of `ui/boot.js` covers only what is missing: `parts/catalog` (the §5.10–5.11 moods and themes as labels and
  swatches), `engine/facade` (fake-engine behaviour with the theme palette, `/` pieces, a staggered entrance, picking
  and text nudges), the planner helpers `previewMood / lockPayload / pinSig / diff`, a silent-clock player, a `core/tap`
  twin, and the samples. A page that defines `window.MVFake` (the test fake engine) gets it instead of the stand-in.
  Integration deletes the section and the `STANDIN.` references in `services()`.
  - `?test=1` exposes `window.__mv` (= `MV.app`); `?fresh=1` skips the autosave restore (tests).
  - Planner calls are expected at `planner/look.previewMood`, `planner/fields.lockPayload`, `planner/plan.pinSig`
    (or `planner/fields.pinSig`) and `planner/diff.diff` (§4.16.1 names the functions, not their files for pinSig).
  - `lock.set` gets `n: store.rev` (WP1 note).
- **Player (WP6).** Its clock is clamped to `duration`, so boot keeps `player.duration` equal to `plan.duration` with
  `load()` whenever playback is stopped (load stops playback), and ends playback at the shorter of the two.
- **Songs and export (WP6).** Step ② uses `decode.loadSong` (progress → 曲を分析しています… n%). Step ④ uses
  `mp4.probe` (cached per size) + `schedule.preflight` (every item shown as `exp.pre.<code>`, with the flash fix and
  jump links), `sink.openSink` from the click, `exportVideo` / `exportPngs` on `engine.fork()`, and
  `sink.downloadBlob` for memory results. The `confirm` pre-flight level uses `window.confirm` until dialogs.js lands.
  Local Chromium shows the `no-codec` block for MP4 (no H.264); PNG sequences export here (checked by hand: 30 frames,
  zip downloaded).
- **Lyric editor.** Typing merges into one entry (`mergeKey: 'lyrics.type'`) and is sealed after 600 ms idle, on blur,
  and on a line break (`inputType insertLineBreak`, handled in the input event because a keydown timer can be starved
  by fast input). The gutter measures every row (not only visible rows) and re-measures on resize, which is fine for
  hundreds of rows. Mark tinting is display-only and never changes widths (colour only).
- **Tap mode** reads its display from the `core/tap` state (`lineIds cursor current paused`), which is WP1's
  documented TapState, not a §4.11 frozen shape.
- **Try-on / compare** render another document with `engine.setDoc(other)` and switch back; any edit ends a try-on.
- **i18n.test.js (WP0 part).** The test "only English texts have plural alternatives" looped over `STRINGS` with a `t`
  built on its own two-key table, so it threw as soon as a real ja string contained `|` (the note mark in the syntax
  help). It now builds a `t` over `STRINGS` for that loop; the intent is unchanged.
- **Not done here (UI part 2/3):** inspector, widgets, part browser, palette, menus, dialogs, timeline drawer, AI panel.
  `timeline.nudge`, `palette.*` and `picker.*` resolve in the keymap but have no actions yet (keys stay unhandled).

## WP6 review fixes

Readings changed by the WP6 review (the WP6 entry above still holds except where this says otherwise).

- **Tempo (§4.13).** The scan scores a tempo by the largest autocorrelation within ±1 frame of each of its 4 beat lags,
  because a beat is rarely a whole number of 10 ms frames (180 BPM = 33.3 frames) and interpolating across the narrow
  peak made 180 lose to its whole-frame third, 60. The octave check now also weighs ×3 and ÷3 (score × prior), and before
  the off-beat doubling it triples while both thirds of the beat are > 0.5 of the beat. The period is then taken from the
  sub-frame autocorrelation peaks at every multiple the lags reach, so the onset fit can follow a whole song. A 1-BPM
  sweep over 60–200 passes at 16, 20, 30 and 60 s (22.05 and 44.1 kHz).
- **No beat → no tempo.** The onset strength is scaled by max(99th percentile, a flux floor of 10), so a steady tone
  stays near 0, and a strength whose 99th percentile is < 0.1 has no tempo. The confidence is now
  `contrast × min(1, beat-lag correlation / 0.3) × (0.5 + 0.5 · hit fraction)`: contrast = how far the beat lags stand
  out from the mean over one period around them; the correlation coefficient of the onset curve with itself one to four
  beats later is about 0 for onsets at random times. Random clicks and steady tones now give `bpm: null`.
- **Known limits, unchanged.** A groove with strong 8th-note hi-hats under ~100 BPM still comes out doubled (the ②
  ×2 ÷2 menu covers it). The onset window is 1024 samples at any rate, so at 8 kHz onsets read ~40 ms early; songs are
  decoded at 48 kHz, where it is well inside the 20 ms tolerance.
- **File names.** `fileName` cuts at 80 UTF-16 units on a grapheme boundary (`core/script.graphemeOffsets`), so an
  emoji or a ZWJ family is never split, and drops unpaired surrogates from the input. `export/schedule` now depends on
  `core/script` (L0). The ZIP writer encodes an unpaired surrogate as U+FFFD, like `TextEncoder`.
- **Songs with more than two channels.** `fillPlanar` mixes down to stereo the way Web Audio's 'speakers' rules do,
  which is what the player plays: quad ½(L + SL), ½(R + SR); 5.1 L + √½(C + SL), R + √½(C + SR), LFE dropped; other
  layouts discrete (first two). Additive export: `mixMatrix(inCount, outCount)`. `decodeFile` still keeps the file's
  channels.
- **File sink.** `close()` goes open → closing → closed, or → failed when the writable's close rejects; `abort()` then
  still aborts the stream and removes the file. Only a successful close keeps the file.
- **`export_check.py`.** The MP4 exports are 2.5 s (75 frames) and the key frames must be exactly frames 0 and 60
  (`--long`: exactly every 2·fps). A 5.1 WAV with sound only on the centre goes through `decodeFile` and `exportVideo`;
  the AudioData handed to the encoder must carry √½ · the centre on both sides. The transparent-PNG ZIP uses a title
  with an emoji across the name limit and is opened with Python's `zipfile`.
- **For the lead: the harness is git-ignored.** `.gitignore` ignores `tests/www/` (meant for the built
  `lab.html`), so `tests/www/export_check.js`, which `export_check.py` loads, is not picked up by `git add`, and CI's
  browser step would fail on the missing file. Commit it with `git add -f tests/www/export_check.js`, or narrow the
  rule to `tests/www/lab.html`.

## WP1 review fixes

Fixes for the reviewer's WP1 findings. Where these entries differ from the earlier WP1 notes, these win.

- **Contract conflicts in §4.10.1 (for the lead, §9.4).** Two of the frozen tested properties cannot hold under the frozen
  rules as written. `reconcile` implements the closest faithful version and keeps its interface:
  - *"Swapping two unique rows keeps both ids"* vs rule 3 running before rule 4. When two swapped rows look alike
    (Dice ≥ 0.5, e.g. 夜明けの街を走る / 夜明けの街を歩く) and the LCS runs through the rows between them, rule 3 paired
    each row with its look-alike, so the ids (with their locks, tap times and cut pins) stayed with the position.
    Now the rule 4 pairs (key unique among the old rows and among the new rows, both left unpaired by the LCS) are
    found first and kept out of the rule 3 gaps. Rule 4 still pairs them after rule 3, so no other result changes.
  - *"Editing one character keeps every id"* vs rule 3's plain character bigrams. One keystroke in a key of 4 or
    fewer characters could drop Dice below 0.5, so the row got a new id and lost its pins, salts and lock
    (届くまで → 届けまで, ねえ → ねぇ). Two changes:
    - Bigrams are taken over the padded key `'^' + key + '$'`. One edit then keeps Dice ≥ 0.5 for keys of 3 or more
      characters (an insertion for 2 or more). The empty key has one bigram, so blank rows still pair with each other.
    - A gap with exactly one free old row and one free new row pairs them whatever their Dice. That row was edited in
      place: SPEC §3 "diff by content and position". This covers 1–2 character keys, and also a row replaced by
      different text in the same place. If such a row is no longer a line (it became blank or a comment), its pins are
      still deleted as a removed line (§4.10.3).
  - This replaces the earlier WP1 note "keys shorter than 2 characters have no bigrams … editing a 1–2 character row
    gives it a new id". DESIGN §4.10.1 rules 3–4 should be updated to say this.
- **Line breaks.** `splitRows` (and so `lyrics.set`) treats CR LF, a lone CR and LF as row ends. Rule 1 names only `\n`
  plus a trailing `\r`, so a lone CR left a row that `validate` rejects ("must be a single line"). The saved file could
  then not be opened again.
- **LCS cost (§9.1 budget, §7).** Myers now uses the linear-space middle-snake form, so memory is O(N + M) instead of
  one copy of V per d. Before the search, the common prefix and suffix are matched, and values found on only one side
  are dropped. Rule 3 scores only row pairs that share a bigram (an inverted index), and its DP runs only over rows that
  have a candidate. Measured here (Node 22, shared CPUs), parse + reconcile:
  - 300 rows: about 2–3 ms for local edits and about 3 ms for a full replacement (pasting new lyrics over old). The
    5 ms budget is asserted for both cases, with the ×3 CI margin.
  - 1000 rows: about 7 ms. 3000 rows: about 20 ms. Reversing 3000 rows: about 160 ms, at about 100 MB RSS for the whole
    process.
  - `offsetMap` on two unrelated 2000-character texts still takes about 50 ms (O((N + M)·D) time), but its memory is
    now linear.
- **core/timing: a first anchor needs room.** The lines above the first anchor need 0.1 s each from time 0, as
  forward-fill compression keeps. A first anchor earlier than `0.1 · (lines above it)` is demoted with `time-order`
  (with `path` for a pin), and the next anchor is tried. Examples: `[00:00.00]` below untagged rows, or a tap clamped
  to 0. Before, back-fill mapped those lines onto `[0, 0]`, so starts were equal. Back-fill compresses into
  `[titleCard, anchor]` when that leaves 0.1 s per line, else into `[0, anchor]`. This replaces the note "when the first
  anchor is not later than the title card …". Starts are now strictly increasing in every case (fuzz-tested).
- **core/timing: an anchor that loses no longer demotes others.** Rule 1 now first counts the LRC anchors a pin would
  pop. If the pin itself loses (to an earlier pin, or because it would be first without room), nothing else is
  demoted. Before, pin 10 · stamp 12 · pin 10.05 demoted both the stamp and the second pin. Now only the second pin is
  demoted.
- **Strings wanted:** none.

## WP2

Type: `engine/text/{vert,breaker,layout,fit,fake_measure,faces,service}`, `engine/host/{measure,fonts}`; tests
`vertical`, `breaker`, `layout`, `faces`. The frozen signatures are unchanged. These are the readings and additions.

- **Day-one font check (§9.1, §10.7).** All 66 families named in §5.10 and in the §4.14 flavor table exist on Google
  Fonts (CSS2 API, HTTP 200). Nothing is replaced.
  - A CSS2 request for a weight that a family does not serve fails with HTTP 400. For example,
    `DM Serif Display:wght@700` fails.
  - `faces.FAMILIES` records the weights each of these families serves, probed on day one. `snapWeight` moves every
    FontRef to a served weight, using CSS font matching.
  - So themes can keep the §5.10 weights. sodaFloat serif 700 gives Kaisei Decol 700 and DM Serif Display 400.
    sumiWashi serif 600 gives Nanum Myeongjo 700 for Korean.
  - A family outside FAMILIES (a user's face pin) is requested without a weight axis.
  - **WP5c:** no theme change is needed. **WP8:** the face picker can list `FAMILIES`.
- **FontRef** is `{ family, weight, script, flavor, role, key, stack, css(sizePx) }`, frozen. `key` is `family:weight`.
  - `toJSON()` gives `{ family, weight }`. So `resolveFaces(…)` can go into the Plan as it is, and it hashes like
    the §3.12 shape.
  - `fontFor` also accepts that plain JSON (`plan.look.faces`) and rebuilds full refs. The flavor comes from
    FAMILIES, else from the role's default.
- **resolveFaces(theme, pins, scriptsUsed).**
  - `pins` can be a plain object or a Map, keyed by slot (`face.display.ja`) or by path (`work:face.display.ja`).
    Values can be raw or `{ v }`.
  - A `face.<role>.weight` pin applies to every script of the role. It beats the flavor table's weight (heavy zhHant
    900).
  - Output scripts: `latin` always, plus the scripts used (`en` counts as latin). All five scripts when `scriptsUsed`
    is omitted. **WP3:** pass the lines' `lang` values.
  - In `fontFor`, a script that the faces lack borrows the role's ja face, with that script's fallback stack.
  - Fallback stacks: `SYSTEM_FALLBACK[flavor]` (ja first), preceded by `SCRIPT_FALLBACK` for ko, zh and latin.
  - Latin letters, digits and ASCII punctuation use the role's Latin face in non-en lines. A space follows the glyph
    before it.
  - Additive exports: `FAMILIES SCRIPTS ROLES FLAVOR_NAMES SCRIPT_FALLBACK faceRef asRef snapWeight usesLatinFace
    uniqueChars cssSize cssAt`, and `fontUsage(faces, [{ role, lang, text }]) → { refs, textByFamily }`. The facade
    and export can pass that result to `FontBook.request/ready`.
- **layoutRun(spec, text, fonts, measurer).**
  - `text` is the cut text. The run is `text.slice(span)`, unless `spec.text` is given (then span is ignored).
    Emphasis ranges and `RunLayout.off` use the same coordinates as `span`.
  - `fonts` is the resolved faces (or `plan.look.faces`).
  - **`RunSpec.lang` is additive and optional.** The builder should set it to `cut.lang`. Without it, the script is
    detected from the run's text with a ja hint.
  - Defaults: tracking 0, leading 1.3, align/valign center, fit shrink, maxLines 2, breakAt phrase, emphScale 1.15.
  - A spec without a finite box, or with size ≤ 0, throws `LayoutError('bad-spec')`. This is a programmer error.
- **RunLayout: readings and additions (for WP4).**
  - `box` is the union of the glyph cells, in absolute du (the ink box). `x`, `y` are relative to its origin.
  - `x`, `y` are where a glyph is drawn: the cell centre plus the §4.15.2 offset (small kana, corner marks). They are
    the cell centre for every other class.
  - Drawing contract (checked with the real faces):
    1. Translate to `(box.x + x[i], box.y + y[i])`.
    2. Rotate: rot 1 → `rotate(π/2)`; rot 2 → `scale(-1, 1)` then `rotate(π/2)` (canvas call order).
    3. If `sx[i] ≠ 1` (tcy), `scale(sx[i], 1)`.
    4. `fillText` with `textAlign 'center'`, `textBaseline 'middle'` and `fonts[font[i]].css(em[i] · scale)`.
  - `w`, `h` are the cell's on-screen size: advance × em horizontally, em × advance vertically.
  - `cls` is the index into `core/script` CLASSES. Space glyphs have class `space` and draw nothing.
  - Every grapheme is a glyph (`n` = graphemes), spaces included. A space at a line end has zero width.
  - A vertical Latin run is one glyph per letter, each rotated +90° and placed down the column. This is the same
    geometry as rotating the whole block. A tcy cell is its 1–2 glyphs side by side.
  - `lines[].x/y` is the top-left of the line or column box. `words` are split where a line breaks, and a space joins
    the word before it.
  - Additive fields:
    - `orient`, `lang`;
    - `em`: per-glyph font size in du;
    - `sx`;
    - `vcls`: VCLS code, 0 in horizontal runs;
    - `off`: UTF-16 offset in the source text;
    - `font`: 0 = script face, 1 = Latin face; `fonts`: `[FontRef, FontRef]`;
    - `clip`: `spec.box` when overfull, else null (the scene clips the run to it);
    - `fitStep` (0–4), and the `breakAt` and `maxLines` actually used.
  - Layouts are cached and shared, so treat them as read-only.
- **Line breaking in the layout** measures widths. The frozen `breakLines` is its cells-based twin.
  - At a size, it takes the fewest first-fit lines, then re-balances them to even widths: first the smallest widest
    line, then the smallest sum of squares.
  - When more than maxLines would be needed, it uses maxLines balanced lines.
  - A tcy cell is never split.
- **Fitting (§4.15.6), read so that it is monotone.**
  - `minSize = min(size, max(18, 0.35 · size))`, so a run asked below 18 du never grows.
  - Step 1 is the exact limit of the analytic shrink and re-break loop: the largest size in [minSize, size] at which
    the re-broken text fits. It uses 30 bisection steps over a fixed interval. Fitting is monotone in size because
    breaking is first-fit.
  - Step 2 is taken literally: char breaking with maxLines + 1, *at minSize*. The size stays at minSize. Growing back
    would let a smaller box give larger text.
  - Step 3 is the largest fitting size in [0.6 · minSize, minSize]. Step 4 sets 0.6 · minSize, `overfull` and `clip`.
  - `fit: 'none'` never reports overfull.
  - Horizontally, emphasized glyphs grow about the shared baseline (from `measurer.metrics`). Line spacing reserves
    room for them, so the ink box stays inside the box.
  - A fuzz of 45,000 layouts (random ja/Latin text, both orientations, every break mode, tracking, emphasis) found
    no smaller size for a larger box and no ink outside the box.
- **sizeGroup** needs every run at once: use `layoutRuns(items, fonts, measurer)` or
  `TextService.layoutAll([{ spec, text }])`.
  - The group's size is the smallest fitted size. Each member keeps the break mode it needed, and `overfull` is
    checked again.
  - **WP4:** commit a cut's text runs through `layoutAll`.
- **TextService** additions: `layoutAll`, `breakLines`, `faces`, `key` (the measurer key), `withFaces(faces)` (shares
  the LRU), `clear()` and `cached`. The cache key uses only the spec's layout fields, not ink, style, reveal, parent,
  move or rot.
- **Vertical classes (§4.15.2): characters the table does not list.**
  - ASCII counterparts behave like the fullwidth marks:
    - `,` `.` → corner;
    - `:` `;` `!` `?` → centred;
    - `-` `=` `[` `]` `{` `}` `<` `>` `~` → rotated (`~` also mirrored).
  - A Latin run also joins across inner `.` `,` `&`, and takes one trailing `.` or `,`.
  - 1–2 Latin letters (or a letter and a digit) stay upright, one per cell, as is usual for short abbreviations. 1–2
    ASCII digits are tcy. Three or more letters or digits form a Latin run.
  - Anything else not listed is upright.
  - Upright cells advance 1 em. Spaces advance by their measured width, and so do rotated glyphs and Latin runs.
  - `FACE_ADJUST` is empty. On a real-font render of all 16 display faces, the table offsets looked right, so no
    per-face correction was added.
- **Metric-free vert exports for WP3:** `segment(text) → [{ cls, a, b }]`, `longestLatinRun(text)` (for
  `feat.orients`: v only when ≤ 12), `classify`, `classOf`, `VCLS`.
- **Breaker readings.**
  - `phrases`, `words`, `columns` and `breakLines` return trimmed UTF-16 ranges, with no spaces at the edges.
  - ja phrases also break after ！？‼⁉，． and before an opening bracket. A particle ends a phrase only when the
    phrase holds more than the particle.
  - Script changes count letters only; digits are neutral, so 12月 stays whole.
  - Every phrase boundary moves to obey NO_START/NO_END: a closer stays with its phrase, an opener goes to the next.
  - zh: han are paired when the text has more than 8 content graphemes.
  - `columns(text, n)` returns fewer pieces when there are fewer phrase boundaries. It never splits inside a phrase.
  - Additive exports: `analyze trimmed opportunities widthFn greedy balance phraseUnits langOf`.
- **Fake measurer: what counts as "fullwidth".**
  - 100: the wide classes (han, kana, hangul, fullLatin, punctJa, emoji), wide symbols and U+3000.
  - 50: halfwidth forms.
  - Latin: `M` `W` are 80 and `i` `l` `j` are 28, case-sensitive.
  - Everything else not listed: 60.
- **Host.**
  - `createCanvasMeasurer(canvasFactory, fontBook)`:
    - with a null factory, it uses `new OffscreenCanvas(1, 1)`;
    - `key` is `'canvas:' + fontBook.epoch`, and both caches empty when the epoch moves;
    - metrics come from `fontBoundingBoxAscent/Descent`.
  - `createFontBook({ document, timeoutMs })`:
    - A family's characters accumulate. Each time they grow, one URL with all of them is requested, because a later
      @font-face rule for the same family replaces the earlier one.
    - `epoch` +1 when a face first loads, and when a newer URL of a ready face loads.
    - A face whose stylesheet fails or times out is `failed`. Its `css()` stack falls back by itself.
    - Additive `failures()`: the refs whose status is failed (for the `font-fallback` warning).
  - Checked in Chromium with a routed stylesheet: a load gives epoch 1 and a new measurer key; a blocked family fails
    at once.
- **Pending:** the lab page mode `#text:<sample>@v` belongs to `ui/lab.js` (WP4).
- **Strings wanted:** none. `warn.overfull` and `warn.font-fallback` already exist.

## WP8b

UI part 2: `ui/{fields,inspector,widgets,part_browser,palette,menus,dialogs,timeline}.js`, WP8b sections appended to
`ui/style.css` and `i18n/strings.js`, marked edits in `ui/boot.js`; tests `tests/node/ui_fields.test.js` and
`tests/browser/ui_flows.py` (first version). Frozen signatures are kept; these are the readings and additions.

- **FieldSpec (§4.23).** The frozen fields are all there; `id` is `page/section/key`, one FieldSpec per placement (the
  same slot sits in several pages and sections). Additive: `page`, `key`, `kind`/`idx`/`partKind` (part widgets; atmos
  browses run-scope ornaments, the work `texture` browses `texture: true` filters), `spec` (the ParamSpec the widget
  follows; `{ type: 'nudge' }` for `el.*.nudge`, a four-number `number` widget, so the widget list stays frozen),
  `options`, `scale` (amounts show 0–100), `auto` (the choice offers 自動 = unpin), `labelArgs`, `presets`, `select`,
  `noneOk`, `flashToggle`, `readOnly`, `group`, `generated`, `param`. Fields that change the document through a command
  instead of a pin have `path: null` and `cmd: { t, key }` (`look.set`, `look.seed`, `timing.set`, `meta.set`, and
  `lyrics.row` for the 強調 / 見せ場 / 注釈 marks); read-only values have `derived`. `ui_fields.test.js` checks every
  path against the §3.4 slot catalogue for its scopes (`slotScopes`) and every command name against `core/commands`.
- **sectionsFor.** Returns `label` as a `[key, params]` tuple (list slots: 装飾{k} / 画面効果{k}) and `custom` for
  sections the inspector draws itself (行 list, 試した見た目, 部品 filters, elements, cuts, その他, several-lines tools,
  the ground run note). Part rows are followed by their parameters (`paramFields`): shared ones always, the part's own
  ones only when every covered cut uses the same part; rows the page already lists are not repeated. The work page's
  要素の既定 section id is `defaults`.
- **Planner calls (§4.16.1).** `app.svc.fieldStates(doc, plan, sel, paths, { registry })` with full paths at the page
  scope (the first line's path on the several-lines page, where `sel` carries every line). `explain(doc, plan, path,
  { registry })` on demand (なぜ, ⋯ › なぜこの値？, part browser おすすめ from `alts`). The inspector localizes these
  explain params when they are keys: `mood` (registry label), `tag` (`tag.*`), `scope` (`scope.*`), `by` (`by.*`),
  `key` (part label), `amount` (`fld.amount.*`). **WP3: please report keys there, not display text.**
- **Writes.** A change pins at the page scope (`pin.set`, `sig` from `svc.pinSig`); several lines = one batch. Sliders,
  label scrubbing, colour drags and timeline drags use `store.gesture` (one entry each); slider arrow keys merge per
  field within the store's typing window. `[d]` = `salt.bump '<scope>:<slot>'` (pinned: `pin.clear` + bump, one batch);
  on parameter rows the key is the parameter's own slot (`line/r4:arrive.dur`). **WP3: key the parameter streams by that
  path, or the dice on a number row does nothing.** × and Del never remove `lock` pins (Unlock does); the tag of an
  inherited value jumps to the owning scope.
- **Interlude text (§6.4.7).** The 表示する文字 field writes `cut/gap/<id>:arrange@breathMark.label`, a text value with the
  presets `none`, `♪` and `heading`. **WP5: `breathMark` should declare `label: { type: 'text', max: 40 }` and read
  those two words as "nothing" and "the section heading".**
- **Actions added** (all with `cmd.*` labels): `palette.open/move/run/close`, `picker.move/pick/back`, `timeline.nudge`
  (declines unless focus is in the drawer, so Ctrl+←/→ keeps its browser meaning), `pref.safeArea/reduceFlash/
  seekOnSelect/follow`, `view.quality`, `view.foldSteps`, `lyrics.bakeTimes` (時刻を歌詞に書き込む: `pin.clear` of every
  start pin + `lyrics.set` with the stamps from `core/lyrics.renderRow`, one entry), `edit.history`, `help.syntax`,
  `help.about`.
- **Menus.** menus.js owns the ≡ menu (§6.4.12, submenus open inline); it listens on the header's ≡ button and stops the
  event, so `ui/header.js` is unchanged and its built-in list is no longer shown. Popovers set `app.popover`, as the
  header's do, so app shortcuts stay quiet while one is open; `<dialog>`s do the same.
- **Dialogs.** `app.confirm(o) → Promise<boolean>` exists now. `ui/step_export.js` still calls `window.confirm` for the
  memory warning; **UI part 1: switch it to `app.confirm`.** The ? sheet is a dialog (boot's `help.keys` calls it). The
  About page shows the two MIT texts verbatim (legal text, the same in both languages).
- **Part browser.** おすすめ = `explain().alts` (unmasked, by weight), else the mood's tag fit; 季節 appears only when the
  kind has seasonal parts; first tile 自動に戻す, list slots add なし; right-click → この部品を使わない / これだけ使う
  (`filter.set`). Filter pages leave out `pool: false` parts (never auto picks); presets: すべて, 雰囲気に合うもの (tag fit
  ≥ 1), 最小 (tagged `minimal` + the fallback); the last usable part refuses to go. Thumbnails: `engine.thumb` at 288×162,
  LRU 200 keyed (kind, key, theme, aspect), idle-sliced; still frames at t 0.32 (entrances) / 2.86 (exits), animated on
  hover. 試した見た目 tiles render the restored look on one `engine.fork()` in idle slices (cache 60).
- **Timeline drawer.** Rows 拍 / 曲 / 行 / カット + ruler on one canvas; line body drag = `time.shift`, edges = `start` /
  `end` pins, inner cut boundary = `cut/<key>:t0`, Shift-drag on the ruler = export range; snap to the beat unit of
  `timing.snap`, other line edges and the playhead (Alt: none). The keyboard proxy is an sr-only listbox: ↑↓ line (and
  select), ←→ choose the start / end edge, Enter opens 詳細, Ctrl+←/→ (Shift ×10) nudges that edge by frames.
- **Palette.** Recent commands live in `localStorage` (`mojipv.palette.recent`, try/catch). Actions that need a mode or a
  held key (tap.*, view.compare, …) are not listed; `step.go` is offered once per step. Romaji aliases are search data
  only.
- **The AI line button** opens the AI tab, sets `app.aiTarget = { lines }` and emits `bus 'ai.tool'` = `'edit'` for UI
  part 3.
- **Boot (marked WP8b).** Deps and `mountDetails()` (dialogs, menus, palette, inspector into `[data-mount="inspector"]`,
  timeline into `[data-mount="timeline"]`); services pick `fieldState`/`fieldStates`/`explain` from `planner/fields` /
  `planner/explain`; `looks.open` opens 試した見た目; `help.keys` uses the dialog. **Integration fix:**
  `planner/look.previewMood` (now loaded) throws without a registry unless `plan()` ran first, and the frozen call has no
  registry argument, so boot passes `{ registry }` as a third argument (おまかせ threw before).
- **Stand-ins (boot's STAND-IN section, deleted at integration).** The registry is now a real `createRegistry` over the
  §5.10–5.11 themes and moods plus a few §5 parts per kind with no-op functions (so the inspector has ParamSpecs); the
  stand-in plan casts slots, grounds and seams in miniature; `fieldState`/`fieldStates`/`explain`/`lockPayload` stand-ins
  follow §3.13 / §4.16.1 / §3.6; the stand-in engine draws the cast slots (composition, text.*, entrance/exit moves,
  decorations, grounds, cameras) and **uses the real `planner/plan.plan` when it is loaded** (the stand-in plan only if
  it throws).
- **ui_flows.py (first version).** Seven flows on the ja page (first run by mouse and by keyboard, drill-click to 文字 and
  drag, pin → おまかせ keeps it → Del unpins, lock survives おまかせ, ◀ ▶ follows undo, palette / menu / ? / drawer
  drag), the first run on the en page; every flow ends with undo-all = its start document; no page errors, no CSP
  violations. The first-run MP4 (2 s, 720p30) runs where H.264 encodes and checks the file's video sample count (stsz or
  trun); local Chromium skips it with a message, and the decoded-frame check stays in WP6's `export_check.py`. AI flows
  wait for UI part 3.
- **Not done here:** the AI panel (UI part 3). The font widget lists families from the registry's themes and a free
  entry; it does not load fonts itself (that is the FontBook's job), so a family shows in its face only once loaded.

## WP4a

Engine part 1: `parts/kit`, `engine/scene/{table,builder,behave,stagger,build,cache,frame}`, `engine/render/record`;
tests `conformance`, `frame`; fixture `tests/fixtures/example_parts.js` (the §4.18 examples written against the kit).
Frozen signatures are kept; these are the readings and additions.

- **Seeds (§4.1.3 vs §3.12).** The Plan carries no seeds, so a scene cannot compute `slotSeed`. `env.rng`
  (`stream(seed, 'build', key)`), the per-glyph randoms (`stream(seed, 'glyph', key)`) and the `scatter` order
  (`stream(seed, 'order')`) use a seed derived from the Plan: `hash32('slot', slot, hashJSON(decision), cut.text)`
  (segments: `seg.key` instead of the text). Equal decisions give equal randomness, so a scene is a function of
  (cut plan, registry, measurer key) (§7.1.5) and cuts with equal `fp` may share one cached scene. It is `env.seed`.
- **Seam window.** `seams[i].at` is read as the window's centre: the seam is active for `at − dur/2 ≤ t < at + dur/2`,
  `u = (t − (at − dur/2)) / dur`. That is §4.16.6's `[B.a − dur/2, B.a + dur/2]` with `at = B.a`, as in
  `plan_basic.json`. **WP3: write `at = B.a`.** `seam.aCuts`/`bCuts` list A and B even when they are not in `cuts`
  (B is invisible before `B.a`; its entrance clamps to the start pose there).
- **FrameGraph readings.** `cuts` is strict `a ≤ t < b`. `grounds`: the segment holding `t` (the first/last one outside
  the video), both segments during a `world` seam whose A and B are in different segments. `accents`: `filter#k` with
  `k < filter.count` and `v ≠ 'none'` of the current cut. `post.texture` is `null` when its `v` is `'none'`. The pooled
  `out` keeps its entry objects in a non-enumerable `_pool`. Additive export `currentCut(plan, t, fg)`.
- **Times.** The arrange sees `env.times` = `{ a, rest: a, out: b, b }`. After the text commit, `rest = a + A` and
  `out = b − L`, where A and L are the entrance and exit as the kit adapters fit them: `fitMotion` with count = distinct
  stagger ranks of the laid-out text, window = b − a, `SHARE[kind]`. An entrance (exit) whose `make` returns `[]`
  (`instantShow`, `instantHide`) gives `rest = a` (`out = b`). When the two overlap, `rest = out` (the exit still ends
  at b). `repT` is not read by the scene; the planner's `heroTime` uses feature counts and can differ a little.
- **Motion adapters (`K.moves`, `K.perGlyph`, `K.perGlyphHold`).** Order `sung`: delays = (morae before the unit / all
  morae) · (t1 − t0), capped at `window − dur` (exit: `share · window − dur`). At `t ≥ t1` every glyph is at `u = 1`,
  at `t ≤ t0` at `u = 0`, so float rounding never leaves a glyph a hair short (the expo eases are not continuous at 1).
  Track units: `x y z blur jx jy pixel` in em of the glyph unless `unit: 'du'`; angles in degrees (`'rad'` allowed);
  others plain. `curve` replaces the ease for its column (applied to `u`). Exposed params are `num` with a per-column
  range, `ui: 'advanced'`, labels 始まりの… / "Start …" and 終わりの… / "End …". `g.cls` is the class name
  (core/script CLASSES); `g.cx/cy` are du from the focus centre; dwell `time` counts from each glyph's own arrival.
- **Kit helpers.** They fill `tags [] season null weight 1 pool true fallback false needs [] shared {} params {}`,
  ornaments `scope 'cut'` `follow 'text'`, grounds `animated true`, and freeze the definition. They throw `KitError`
  for a missing key/label/required function and for moves tracks that do not rest at identity. `variant` never inherits
  `fallback: true`. `mirror` swaps moves tracks and reverses their curves, reverses the ease auto (value or pick), carries
  the entrance's `dur`/`each` overrides and keeps the exit's own `order` default. Put `...K.moves()` before your own
  `params`; exposed params are regenerated per kind either way.
- **Additive env fields:** `orient` (the orient slot), `slot`, `key`, `seed`. **Additive target fields:** `ch cls em`,
  `x y` (local rest centre), `wx wy` (frame rest centre), `w h`, `cx cy`, `lang`, `arrived`.
- **SceneBuilder.** RunSpec defaults: the whole cut text, the orient slot, `text.*` slots, `emphInk 'accent'`,
  `revealMode` wipeX/wipeY, `lang = cut.lang`, `emph = cut.emph` (only for runs of the cut text). Box coordinates are in
  the parent's frame; the run node pivots on its box centre (`RunSpec.rot`, radians); `move` adds a drift behaviour.
  `sb.bounds` works before the commit (pending runs are laid out on demand). Text made after the commit (by ornaments)
  is laid out and allocated at once and is not part of `target`/`scene.text`. A shape with neither fill nor stroke
  strokes `'ink'`. `sb.particles` works only while a part builds (its randoms fork the part's stream). ShapeSpec ops:
  M L Q C A(cx, cy, r, a0, a1; anticlockwise when a1 < a0) E(full ellipse) R Z.
- **Element pins.** `nudge`: dx/dy on every root node of the element; rot and s about the element's rest centre (a root
  that is already turned or scaled keeps its own pivot). `fill`: runs, glyphs, shapes (fill and stroke), particles;
  ornaments also get `p.ink = fill`. `el.text.hide` flags the text nodes hidden (the layout still runs, so ornaments and
  the lens get hints); a hidden ornament is not built.
- **Part errors.** A part that throws, or an unknown key, makes the cut rebuild with fallback parts plus the warning
  `{ code: 'part-error', cut, line, detail }` (new code, strings below). `svc.strict` rethrows (tests). Unknown keys
  alone fall back per slot with the same warning.
- **Scene additive fields:** `kind` ('cut'|'ground'), `t0` (local time origin), `stores` (per-type payloads), `times`,
  `target`, `focus`, `fontKey`. `runs[k]` = `{ node, spec, layout, from, to, ink, emphInk, clip }`. The store records the
  renderer reads are documented above `sceneOf` in `engine/scene/build.js`. Glyph `ink` already holds the emphasis ink.
- **Cache.** Additive `has`, `size`, `fontKey`. `prefetch(plan, t0, t1, build(item, kind))` builds the missing cuts and
  segments nearest first, up to `max`, checking presence under the latest `get()` key. Cuts with equal `fp` share a
  scene: place scenes with the FrameGraph, never with `scene.key`/`span`. **WP3:** `env.level` reads absolute time, so
  include `cut.t0` in `fp` when a chosen part `needs: ['level']`.
- **Recorder.** `createRecorder()` also has `mark()`, `hash(from)` and `reset()`; `stats()` adds `depth`, `underflow`,
  `alphaBad`, `balanced`, `ops`. Methods outside the §4.19.8 subset are absent on purpose (a part calling
  `getImageData` or `measureText` throws). Additive: `createRecordingFx(recorder, opts)` (the §4.18.11 FxContext over
  recorder surfaces, with `begin()` and `outstanding()`; tiles are named `tile:<name>:<seed>`) and `drawScene(g, scene,
  opts)`, a simple complete reference drawing for Node tests. Neither is the renderer.
- **For WP4 part 2 (renderer, facade, lab).** `frame.js` also exports `evaluate(scene, tl)` (reset → behaviours →
  solve), `cameraAt(scene, plan, t, out)` (camera node + impulses; the shake noise is
  `noise2(hash32('impulse', 'shake'), 23t, 0 | 1)`), `viewMatrix(out, cam, k, W, H)`, `paletteFor` (black mode),
  `backdropFill`, `groundVisible`, `filterAllowed` (§4.19.4), `impulseAt`, `beatAt`, `gridAt`, `levelAt` (reads
  `plan.env`, the 20 Hz Float32Array), `tick`. `builder.js` exports `replayShape`, `shapeBounds` and `particleAt`;
  `table.js` exports `writeQuad` (pick) and `isIsolated` (layers). The facade must create the TextService with
  `plan.look.faces` and pass `svc = { registry, text, assets, provisional }`.
- **Conformance runner.** It runs the stub registry, the examples and `parts/catalog` when it exists. Registries with
  more than 60 parts run a sampled matrix (every aspect, text and orientation still appears, in rotation) unless
  `MV_CONFORMANCE=full`. Build budget: median ≤ 20 ms, slowest ≤ 60 ms (×3 for shared CPUs). Stub + examples take
  about 11 s here. Parts are tested with fallback parts in the other slots, beats at 120 BPM and a loudness envelope.
- **Golden frames.** `update_golden.js` renders through `engine/facade`, so `frame_hashes.json` stays empty until part 2
  lands; `frame.test.js` skips that comparison with a message until then. The rest of `frame.test.js` checks the
  recorded frames of `plan_basic` directly (determinism, frame N alone = frame N after 0..N−1).
- **Example fixture.** The `quietHush` example names five themes; four fixture-only theme variants (`frostGlass`,
  `mossStone`, `snowLantern`, `monoPress`) keep a strict registry valid.
- **Strings wanted (WP8):**

| Key | ja | en |
|---|---|---|
| `warn.part-error` | 部品でエラーが起きたため、標準の部品で表示しています | A part failed, so the standard part is shown |

## WP8a review fixes

Readings changed by the WP8a review (the WP8a entry above still holds except where this says otherwise).

- **Lyric gutter clicks.** `.le-gutter` has `z-index: 1` and `pointer-events: none`; its entries (`.le-g`) take
  `pointer-events: auto`. So a click on an entry reaches the gutter handler, and a click on empty gutter space still
  reaches the textarea.
- **Step ① layout.** The step now fills the step body (`height: 100%`), and the editor is `flex: 1 1 0` and scrolls
  inside itself. The chips and the summary stay in view, and follow-playback (`scrollToRow`) can scroll the editor.
  Before, the step body scrolled instead and follow-playback did nothing.
- **Editor cost (§7.4).**
  - `renderMirror` rebuilds only the rows between the common prefix and suffix (`changedRows`). It still sets the
    textarea height in the same task, so the textarea never scrolls inside itself.
  - The gutter is built in one rAF, only for the rows in the editor's viewport ± 240 px (binary search over
    `offsetTop`). It is rebuilt on scroll and resize.
  - Measured in Chromium with 1500 rows: our part is about 1 ms per keystroke. What is left is Chromium's own relayout
    of the textarea text: about 30 µs per row (10 ms at 300 rows, 45–50 ms at 1500), whatever the CSS. The
    `core/commands` `lyrics.set` reducer adds about 15 ms at 1500 rows.
  - Edit → repaint stays under 50 ms up to about 600 rows (the reviewer measured about 450 before). Going further
    needs a virtualized editor instead of the §6.4.14 `<textarea>`, which would be a contract change.
- **Undo caret.** `where` gains `before`: the caret before the first keystroke of a burst (from `beforeinput` /
  `compositionstart`), because a merged entry keeps its first dispatch's `where`. Undo puts the caret at
  `where.before`. Redo, and entries without `before`, put it at the end of the changed span (a text diff).
  Additive exports: `changedRows`, `changeEnd`, `caretAfterHistory`.
- **Play bar fit.** `controls.dataset.fit` 0–4 is measured whenever the row's content or size changes:
  1. hides the おまかせ key hint;
  2. hides the duration in the time readout;
  3. makes おまかせ icon-only (its `aria-label` keeps the name);
  4. tightens the gaps.

  Every control stays whole inside the bar. This holds for ja/en at every §8.3 viewport, with a song, n/m and the
  editor focused.
- **Song ↔ doc.song.**
  - `app.bufferSha1` records which song the decoded buffer belongs to, and `app.songReady()` tells whether it matches
    `doc.song`.
  - On every store `doc` event (do, undo, redo, load, new work), `syncSong` drops a buffer that no longer matches. It
    then looks the song up in IndexedDB by sha1, once per sha1, so a miss is not retried on every keystroke. The
    state is `linking` while it looks.
  - `loadSong` sets the buffer before it dispatches `song.set`.
  - Export passes audio only when `songReady()`, and the preflight's `songReady` uses the same check.
  - `project_io` and the autosave restore no longer call `relinkSong` themselves.
  - Step ② now also refreshes on plan events that touch the song, the timing, or the `work:bpm` pin. Before, undoing
    `song.set` left it stale.
- **Re-link (§6.11).** The banner's button calls `app.pickRelink()` → `app.relinkFile(file)`:
  - The same sha1 is accepted.
  - A file whose length is within ±0.5 s is accepted after `app.confirm` (the WP8b dialog; `window.confirm` without
    it).
  - Any other file is refused with a toast.
  - An accepted file is stored in IndexedDB under the document's sha1. No `song.set` is dispatched, so the analysis,
    tempo and offset stay.
- **First-run mute.** This is `view.state.autoMuted` (transient), not `prefs.muted`. `V.isMuted(state)` /
  `app.isMuted()` = the preference or the one-off mute. The mute ends when playback stops or a song is loaded. The mute
  toggle ends it too, and then unmutes.
- **Double-click on the preview.** The second click of a double-click reuses the first click's design-space point,
  because opening 詳細 with auto-fold moves the canvas in between.
- **Provisional frames.**
  - `stage.render` redraws a paused provisional frame every 120 ms, at most 50 times in a row.
  - `svc.fonts()` (additive) returns the preview's FontBook. Its `on('epoch')` invalidates the stage.
  - After seeks and new plans, `engine.prepare(t − 5, t + 5)` runs (debounced by 80 ms) and then repaints.
- **Reroll.** A work-scope selection (the root, or an element page such as 全体 › 文字) rerolls with `look.seed`, never
  `salt.bump 'work'`.
- **Kept toast and diff readout (§6.7).**
  - Kept counts: user pins (by is not lock, tap or ai), then `toast.keptAi` for pins by `ai` (or `toast.keptAiOnly`),
    then the one-line readout on a second line of the same toast. Toast text is `pre-line`.
  - Undo/redo of look commands (おまかせ, seed, salts, `look.restore`) shows the readout alone.
  - The readout comes from `LK.diffSummary(planner.diff(...), plan)` → `LK.diffText(summary, t, { scope })`. Only part
    choices are named. A line or cut reroll of one line says 「n行を振り直し」; otherwise 「n行が変わりました」 /
    「全体が変わりました」.
- **Step ④ 詳しく.** Labels sit above their controls, so 全体 / 選んだ行 / I–O 範囲 get the column's full width. The
  memory pre-flight confirm uses `app.confirm` (as WP8b asked).
- **i18n.test.js.** A label tuple is `[key, {…}]`; the scan requires the params object, so lists of command names such
  as `['look.set', …]` are no longer matched.
- **New strings.** `song.linking`, `song.relinkTitle`, `song.relinkAsk`, `song.relinkOk`, `song.relinkMismatch`,
  `song.relinked`, `toast.keptAi`, `toast.keptAiOnly`, `diff.line`, `diff.lines`, `diff.work`, `diff.sep`,
  `diff.join`.
- **`ui_layout.py`.**
  - The clip check now also walks the ancestors. It flags a control cut off by an `overflow: hidden` parent, or one that
    pushes a scroll container sideways.
  - New layout states: the fullest play bar (a real WAV through `loadSong`, two looks, 詳細 kept, editor focused or
    not) at every viewport plus 1200×700, and step ④ with 詳しく open at 1440×900, 1280×720, 1280×689 and 1200×700.
  - `behaviour()` covers:
    - real mouse clicks on the gutter (line, Ctrl, heading);
    - a preview double-click with 詳細 closed;
    - the first-run mute not being stored;
    - undo/redo caret;
    - a work-scope reroll;
    - the diff readout after おまかせ and undo;
    - a paused provisional redraw;
    - song load, undo, redo, clear + undo, and new work;
    - a missing song with the re-link rules.

    Each check was confirmed to fail with its fix reverted.

## WP7

AI adapter: `ai/{providers,lyricio,catalog,prep,looks,song,changes}`; tests `ai_providers`, `ai_lyrics`, `ai_looks`,
`ai_song`. The §4.22 signatures are kept. These are the readings and additions.

- **How the AI panel uses it (WP8).**
  1. Build a request: `prep.request(doc, lang)`, `looks.proposalsRequest(doc, plan, reg, lang)`,
     `looks.editRequest(doc, plan, reg, text, lang, { lineIds })`, `song.transcribeRequest(lang)`,
     `song.alignRequest(doc, plan, lang)`, `song.analyzeRequest(lang)`. Each gives `{ system, prompt, schema, effort }`.
  2. Call `providers.call({ provider, model, apiKey, …request, signal, media })` and get `{ json, usage, model }`.
     `costUSD(provider, model, usage)` gives the cost line.
  3. Validate the answer. Pass `{ rev: store.rev }` as the last argument so `base.rev` is set:
     - `prep.changes(doc, json)` and `looks.editChanges(doc, plan, reg, json, { lineIds })`;
     - `looks.proposalChanges(doc, plan, reg, json)`;
     - `song.alignChanges(doc, plan, json, seconds)`;
     - `song.transcriptLines(json, seconds)`, then `song.transcriptChange(doc, result, 'replace' | 'append')` for the
       [置き換える] / [後ろに足す] buttons;
     - `song.analyzeChanges(doc, json, seconds)`.
  4. Before applying, call `changes.markStale(doc, plan, changes)`. Then
     `cmds = changes.toCommands(doc, plan, checked)`, `store.batch({ label: ['undo.ai', { tool, n }] }, cmds)`, and push
     `changes.logEntry(docBefore, cmds, { runId, tool, n })` to `side.aiLog`.
  5. Try-on renders `changes.apply(doc, plan, checked)`. [元に戻す] dispatches `changes.revertCommands(doc, entry).cmds`
     as one batch; its `kept` is the 「n件は後で変更されたので戻せません」 count.
  - Review text: `changes.describe(change, t)`. Warning text: `changes.warningText(w, t)`. Group: `changes.groupOf(c)`
    → `lyrics | work | lines | time`.
  - Consent card: `song.audioFromBuffer(audioBuffer)` → `{ bytes, seconds, rate }`, and `song.audioSize(audio)` →
    `{ mb, seconds }`. Then call `song.audioPart({ audio, apiKey, signal, onStage })`. `onStage` gets `'upload'` and
    `'process'` (only on the Files API path) and passes the part as `media: [part]`.
- **Injection.** `setSDK(…)` with the AI SDK global is called from ui/boot (§9.2). A call's own `SDK` / `fetchImpl`
  always wins. `setFetch(fn)` is optional; without it, Gemini uses `globalThis.fetch`. The §2.4 `ai/*` lint does not ban
  it. Tests always inject, so nothing touches the network.
- **Error codes.** The §4.22.1 codes, plus **`recitation`**: a Gemini `finishReason` of `RECITATION` (not
  `blocked`). Its message recommends pasting the lyrics and using alignment instead of transcription. Other readings:
  - A Gemini answer with no text part is `empty` (not `bad_json`).
  - An SDK error of an unknown class maps by its HTTP status before falling back to `server`.
  - A failed Files API upload is `auth` (bad key, 401/403), `rate` (429), `server` (≥ 500), else `upload`.
  - The key is scrubbed from every message.
  - Effort maps to `LOW`/`MEDIUM`/`HIGH`; anything else is `LOW`, never `MINIMAL`.
  - The second AI service: its largest model goes through `beta.messages.create` with
    `betas: ['server-side-fallback-2026-07-01']` and `fallbacks: 'default'`. Its smallest model gets no thinking and no
    effort. Key checks stay free (model-info GET /
    `models.retrieve`).
  - **i18n.test.js (WP0+WP8):** please add `recitation` to its `AI_ERRORS` list once `err.ai.recitation` exists.
- **Change objects.** `Change` has the §4.22.5 fields. Additive fields where they apply:
  - `n`: the 1-based line or lyric-row number for display;
  - `partKind` (part);
  - `filterKind` and `partKey` (avoid/allow);
  - `key` (amount);
  - `word` and `repeats` (emphasis/impact);
  - `reason` (prep);
  - `diff: { before, after }`: the row src with all of that row's changes (lyric kinds);
  - `overLrc` (time);
  - `mode` (rows);
  - `fromSource`: the Decision `from` of the shown value (`auto`, `pin:line`, `lrc`, …).
  `base` holds, per kind:
  - the pin value at `path` (work pins, part, time), plus the row src for time;
  - the three color pins (palette);
  - `doc.filters[kind]` (avoid/allow);
  - the row src (lyric kinds);
  - the whole lyric text (rows);
  - the song's sha1 (songInfo).
  `markStale` compares these values and unchecks rows that became stale.
- **toCommands.**
  - It takes changes with `checked !== false`.
  - Lyric changes are re-applied to the *current* row, and only while its plain text still equals the text at request
    time. Each step is checked with `renderChecked`. A stale change that the user checks again still applies when its
    target is valid.
  - Removals produce one `lyrics.set` from `editRows`, which also carries that review's other row edits. Without
    removals, each edited row gets one `lyrics.row`.
  - `avoid` adds to `deny`, but never empties an `only` list. `allow` removes from `deny`, else adds to `only`. One
    `filter.set` per kind.
  - Part and time pins for lines missing from `plan` are skipped. Pins that already hold the value are dropped.
- **aiLog entries.** `applied` items carry `prev`, so a revert restores the pin, filter, row, text or song info that the
  AI replaced. The shapes are `{ path, to, prev }`, `{ filter, to, prev }`, `{ rowId, to, prev }`,
  `{ rows: 'all', to, prev }` and `{ songInfo: true, to, prev }`. An item is reverted only while the document still holds
  `to`, which for pins also means `by: 'ai'`.
- **Look answers.**
  - **Schema.** The proposals schema calls the lyric topic `topic`, so it is not confused with the theme *key*.
    `proposalChanges` still returns it as `theme`. Proposal lines also carry `dwell` (`""` = keep). Validator warnings
    are `[stringKey, params]`, not English text.
  - **Pinning a proposal.** A proposal is a whole look: it pins the theme and mood it names even when the auto value is
    the same today, because おまかせ would otherwise change them under the other pins. An edit changes only what differs
    from what is shown.
  - **Line parts.** A line part pick is a change unless the line pin already holds it. Picks on locked lines are dropped
    with `ai.warn.locked`: lock pins are cut pins, which shadow line pins, and a by-`ai` pin does not release them.
    Title-, interlude- and outro-only compositions are neither offered (catalog) nor accepted.
  - **Season.** An equal auto season is not pinned. `any` clears a season pin.
  - **Amounts and flash** are compared with their value after the answer's mood change (pin, else the new mood's
    amount).
  - **Palette.** The accent is fitted to ≥ 3:1 against the ground: the plan's, or the new theme's swatch (a ground pin
    or a black/chroma backdrop wins). The comparison uses pins, else that palette.
  - **Filters.** The fallback part and `pool: false` parts cannot be avoided.
  - **Selected lines.** An edit with `{ lineIds }` drops line changes outside them (`ai.warn.notSelected`).
  - **Screen effects.** The look prompts also list screen effects (`filter`, "only for avoid"), so the model can name
    the glitch effects it should avoid.
- **Lyrics.**
  - Prep numbers the lyric rows 0..n: rows that are sung lines. Comments, meta rows and stamp-only rows are not sent.
  - Emphasis goes on the first occurrence of the word that lies inside one piece. A word overlapping an existing
    emphasis is skipped silently.
  - The v2 syntax can say more: `Yeah!!` can drop its impact (written `Yeah\!`, same words), and a cut next to a
    space keeps the space (rule 8). The tests assert this behaviour.
  - `editRows` squeezes only the blank rows around removed rows (never two in a row, none at the start or end there).
    Other blank runs stay as written, because they are pauses (§4.9.3 `pauseBefore`).
  - `lyricio` additions: `findWord`, `rowById`, `sheetText`, `pieceTexts`, `SYNTAX_CHARS`. `rowsView` also gives
    `kind`.
- **Song.**
  - Transcript rows are written with `core/lyrics.renderRow` after the §4.22.4 replacements, so a leading `[` is escaped
    and `[ti:x]` or `[00:09]歌` stay lyric rows.
  - Alignment over LRC stamps is allowed (§10.1 default) with `overLrc` and the label `ai.ch.time.lrc`. Editing the row
    (its stamps) makes the change stale.
  - `songInfo` returns `{ summary, mood, bpm, sections, highlights, duration }`. The planner reads these names.
  - Additive exports: `audioFromChannels`, `audioFromBuffer`, `audioSize`, `transcriptText`, `transcriptChange` and
    `analyzeChanges`.
  - `audioPart` / `uploadFile` take `inlineMax` and `sleep` for tests (modules are frozen in dev, so a constant
    cannot be overridden from outside). Polling waits 1 s between polls, 60 times at most, and stops on abort.
  - `toBase64` is `audio/digest.toBase64` over 48 KiB chunks.
- **Tests** use the real `planner/plan` with a test registry: the stub parts plus seasonal clones. Without the planner
  module they fall back to a minimal plan.

## strings wanted

For WP8 (`i18n/strings.js`), from WP7. These are the Change `label` keys (`changes.describe` resolves part, theme and
mood names, seasons via `fld.season.*`, amounts via `fld.amount.*`, kinds via `kind.*`, and times via `fmtTime`), the
validator warning keys (`changes.warningText` resolves `{kind}` and `{key}`), and one error.

| Key | ja | en |
|---|---|---|
| `err.ai.recitation` | 公開されている歌詞と判断され、書き起こせませんでした。歌詞を貼り付けて「タイミングを合わせる」を使ってください。 | The song was recognised as published lyrics, so it could not be transcribed. Paste the lyrics and use "Match timing" instead. |
| `ai.ch.auto` | 自動（{v}） | Auto ({v}) |
| `ai.ch.theme` | テーマ: {from} → {to} | Theme: {from} → {to} |
| `ai.ch.mood` | 雰囲気: {from} → {to} | Mood: {from} → {to} |
| `ai.ch.season` | 季節: {from} → {to} | Season: {from} → {to} |
| `ai.ch.amount` | {what}: {from} → {to} | {what}: {from} → {to} |
| `ai.ch.flash.on` | 見せ場で光る: オン | Flash on impact: on |
| `ai.ch.flash.off` | 見せ場で光る: オフ | Flash on impact: off |
| `ai.ch.palette` | 色: {accent} · {shiftA} · {shiftB} | Colors: {accent} · {shiftA} · {shiftB} |
| `ai.ch.avoid` | 使わない: {kind}「{part}」 | Don't use: {kind} "{part}" |
| `ai.ch.allow` | また使う: {kind}「{part}」 | Use again: {kind} "{part}" |
| `ai.ch.part` | {n}行 · {kind}: {from} → {to} | Line {n} · {kind}: {from} → {to} |
| `ai.ch.impact.on` | {n}行 · 見せ場（!）にする | Line {n} · make it an impact line (!) |
| `ai.ch.impact.off` | {n}行 · 見せ場（!）をやめる | Line {n} · no longer an impact line (!) |
| `ai.ch.emphasis` | {n}行 · 強調: {word} | Line {n} · emphasis: {word} |
| `ai.ch.cut` | {n}行 · 区切り: {text} | Line {n} · cut points: {text} |
| `ai.ch.note` | {n}行 · 読み: {note} | Line {n} · reading: {note} |
| `ai.ch.remove` | {n}行 · 削除: {text} | Line {n} · remove: {text} |
| `ai.ch.time` | {n}行 · 開始: {from} → {to} | Line {n} · start: {from} → {to} |
| `ai.ch.time.lrc` | {n}行 · 開始: {from} → {to}（LRCの時刻より優先されます） | Line {n} · start: {from} → {to} (overrides the LRC time) |
| `ai.ch.rows.replace` | 歌詞を書き起こしで置き換える（{n}行） | Replace the lyrics with the transcript ({n} line\|{n} lines) |
| `ai.ch.rows.append` | 書き起こしを歌詞の後ろに足す（{n}行） | Add the transcript after the lyrics ({n} line\|{n} lines) |
| `ai.ch.songInfo` | 曲の分析を保存する | Save the song analysis |
| `ai.warn.notLine` | {n}行目はありません | There is no line {n} |
| `ai.warn.cutMismatch` | {n}行 · 区切りが歌詞と合いません | Line {n}: the cut pieces do not match the words |
| `ai.warn.emphasisNotFound` | {n}行 · 「{word}」が区切りの中に見つかりません | Line {n}: "{word}" is not inside one piece of the line |
| `ai.warn.cannotWrite` | {n}行 · 歌詞の言葉を変えずには書けない変更です | Line {n}: this change cannot be written without changing the words |
| `ai.warn.unknown` | 知らない{kind}です: {key} | Unknown {kind}: {key} |
| `ai.warn.offSeason` | 季節が合わない{kind}です: {key} | {kind} of another season: {key} |
| `ai.warn.lineUnknown` | {n}行 · この{kind}は使えません: {key} | Line {n}: {key} cannot be used as {kind} |
| `ai.warn.lineOffSeason` | {n}行 · 季節が合わない{kind}です: {key} | Line {n}: {kind} of another season: {key} |
| `ai.warn.filtered` | {n}行 · 使わないことにした{kind}です: {key} | Line {n}: {kind} {key} is turned off |
| `ai.warn.locked` | {n}行はロック中なので見た目を変えません | Line {n} is locked, so its look stays |
| `ai.warn.notSelected` | {n}行は選んだ行ではありません | Line {n} is not one of the selected lines |
| `ai.warn.empty` | 答えが空でした | The answer was empty |
| `ai.warn.badTime` | 時刻「{time}」が読めないか、曲の外です | The time "{time}" is unreadable or outside the song |
| `ai.warn.lineTime` | {n}行 · 時刻「{time}」は使えません（順番が逆か曲の外） | Line {n}: the time "{time}" cannot be used (out of order or outside the song) |
| `ai.warn.noSong` | 曲がないため分析を保存できません | There is no song to keep the analysis with |

The running stages (`音声を準備中 → アップロード中 → 処理中 → 考え中`) are UI strings. `audioPart`'s `onStage` reports
`'upload'` and `'process'`.

## WP5c

Catalog: `parts/catalog.js`, `parts/theme/{paper,night,glass,earth,season}.js` (16 themes), `parts/mood/{calm,lively,story}.js`
(8 moods); test `tests/node/catalog.test.js`. The frozen interfaces are kept; these are the readings and additions.

- **`parts/catalog` (§4.6).** `defs()` is the frozen code: every module whose id is `parts/<kind>/…` for the 11 kinds,
  flattened in module id order, read at each call (so a module defined later is picked up). `defaultRegistry(opts?)` is
  `createRegistry(defs(), opts)`: strict when called without arguments, as frozen. Additive: `opts` is passed on, so
  `defaultRegistry({ strict: false })` gives a partial registry with `problems`.
- **Interim state, for everyone running the whole suite.** Until every part kind has its fallback part (5a: arrange
  arrive dwell depart; 5b: ground ornament lens filter seam), strict `defaultRegistry()` throws `RegistryError`
  ("arrange/*: exactly one definition needs fallback: true (found 0)" …). This is the frozen contract (§4.6, §9.1 WP5
  acceptance), not a bug. Code that switches to the catalog on `MV.has('parts/catalog')` without guarding the call
  fails until then; when this was written, that was `conformance.test.js` (at load), the registry-label test of
  `i18n.test.js` and the app boot (`ui/boot.js` has no stand-in once the module exists). `ui_fields.test.js` and
  `planner_determinism.test.js` already fall back while the catalog is incomplete. Once the catalog is complete,
  `tests/golden/plan_hashes.json` must be regenerated on purpose (`node tests/update_golden.js`), because the
  registry version changes.
- **Themes (§5.10)** are the table verbatim: labels, the 7 colors, faces (`{ ja, latin, weight, flavor }` per role, the
  §4.18.13 format), texture (`'none'` where the table says none), season, style (the §5.10 defaults paragraph), `dark` =
  ground luminance < 0.2 (written as a literal; the test recomputes it). WP2 recorded no family replacements, so none
  are made; weights a family does not serve snap through `faces.snapWeight` (e.g. DM Serif Display serves only 400).
  Additions, each chosen from the theme's own picture in §5.10: 3 `tags` (the AI theme list and the part browser's mood
  fit read them), a one-sentence `blurb` (tooltips, §4.18.1), and `prefer` maps. `prefer` names only §5 keys, factors
  ≤ 3; seasonal parts appear only in the theme of that season; sumiWashi keeps the §4.18.13 example's map (plus two
  ornaments).
- **Moods (§5.11)** are the table verbatim: labels, amounts, themes, pace, filters, variety, keywords. §5.11 lists only
  the strong tag biases; each mood also has a few milder ones (the §4.18.14 quietHush example does the same, and
  quietHush is that example exactly). The milder biases always lie between the table's strongest damp and weakest
  favour, so they never outweigh it (tested). Moods have blurbs, no tags.
- **Keys other packages should know (5a/5b).** Theme textures name `paperTooth grainFilm dotScreen dustSpecks` (they
  need `texture: true`, as does `rasterLines`, §5.8). Theme `prefer` names arrange `magazineHead`; depart `burnOut`;
  ground `washiFiber flatFill gridPaper halftoneSun stripeShift neonHaze nightBokeh spotBeam fogNoise skyGrade auroraVeil
  tideBands inkWash petalWash heatShimmer maplePaper snowLight`; ornament `hankoSeal bigBrackets underSweep cornerTicks
  tapeStrip pinDotBoard crossHair serialMark rainLines sparkSpray hairFrame bokehDots orbitRing ripplePath petalFall
  sunBurst fireworkBloom leafFall snowDust`; filter `grainFilm duoTone dotScreen rasterLines glowSpill chromaSlip
  amberSpill edgeShade softVeil dustSpecks`. Mood `filters` name 13 §5.8 keys. A named part that is not registered is
  never a candidate, so nothing breaks while it is missing (and a theme texture that is not a registered texture filter
  gives no texture); `catalog.test.js` checks each key against the catalog as soon as that kind has parts.
- **catalog.test.js** reads the §5 tables from DESIGN.md at test time (as `contract.test.js` does for frozen code), so
  the data is checked against the one source. The theme/mood checks run on themes and moods plus the stub parts of the
  other kinds, independent of 5a/5b: strict validation, faces against `faces.FAMILIES` (script, served weights,
  resolveFaces for all five scripts), every mood and every theme reachable as an auto pick, each mood favouring its
  listed themes, the season gate, and a planner → scene → recorder render of every theme and mood (no NaN, balanced
  save/restore, no part errors). The whole-catalog test (strict validity plus every §5 key of every kind) skips with a
  message while a kind has no parts. Run time about 1.5 s.
- **Keys are forever (§7.1.9):** these 24 keys are released with this package; retire one with `pool: false`.
- **Strings wanted:** none (labels and blurbs live in the definitions; `t.part` reads them).

## WP3

Planner: `planner/{features,segment,choose,params,look,cast,tracks,plan,explain,fields,diff}`; tests `planner_determinism`,
`planner_variety`, `planner_stability`, `planner_pins`, `planner_explain`, `fields`; `tests/golden/plan_hashes.json`
regenerated (stub registry). The frozen entry points are kept. These are the readings, additions and deviations.

- **Where the entry points live (§4.16.1).** `plan` and `pinSig` in `planner/plan` (`planner/fields` re-exports
  `pinSig`), `explain` in `planner/explain`, `fieldState`/`fieldStates`/`lockPayload` in `planner/fields`, `diff` in
  `planner/diff`, `previewMood` in `planner/look`. Additive:
  - `previewMood(doc, moodSeed, { registry })`: without the third argument it uses the registry of the last `plan()`
    call and throws if there was none (boot passes it, WP8b note).
  - `lockPayload(doc, plan, lineId, { registry })`: the registry only names the hard cut (else the last plan's).
  - `plan.run(doc, registry, { trace })` (unmemoized), `plan.trace(doc, { registry }, { cutKey, slot })` (explain's
    re-run with one slot traced), `plan.canon` (the canonical encoder below).
  - **Plan cut `pinKey`** (optional): present when the cut's pins live under an older key (§4.10.4 reattachment).
    `lockPayload` writes lock pins under that key, so earlier user pins stay attached. **FieldState `pinAt`**: the path of
    the pin a field shows (`cut/<pinKey>:<slot>` after an edit); **WP8: Del/× should clear `pinAt`**, not the displayed
    path, which may not exist.
  - `diff.changedLines(entries)`. Work-level diff entries (mood, theme, season, texture) have `cut: null`.
- **Faces (§4.16.3 vs §2.3).** The build lets the planner use only `engine/text/breaker` and `vert`, so it cannot call
  `resolveFaces`. `planner/look` resolves the same way (face pins → the theme's ja/latin families → the §4.14 flavor
  table, heavy zhHant 900 unless a weight pin) and stores plain `{ family, weight }` with the *requested* weight;
  `engine/text/faces.asRef/fontFor` snap it when the engine builds refs. `fields.test.js` compares every role × script
  with `resolveFaces` (same family, same snapped weight) over themes × face pins × script sets. **For the lead:**
  allowing `engine/text/faces` in L2 would remove the copy.
- **Stability (§4.16.4, §8.2) needed three changes to how the formula is fed.** Measured first with the literal
  reading: one inserted line changed 29 other cuts, one reroll up to 38, because recency cascades (a changed cut
  flips its neighbour, which flips the next, …) and the segment counter never re-synchronizes.
  1. *Recency reads each neighbour's natural pick*: its argmax without recency factors, and for a rerolled cut
     without its salts (a second, silent pass over that cut only). Pins, rules and fallbacks are facts, as §4.16.4
     says. The weights and the ×0.03 / ×0.35 / ×0.5 factors are unchanged; only what "the previous cut's value" means
     is fixed. A change now reaches only the 4 cuts whose window it is in, and a reroll changes only the streams under
     its key (§3.7). Echoes (×2.5) also read the first copy's natural pick.
  2. *No identical adjacent arrange/arrive* (§8.2): with ×0.03 alone a repeat still wins ≈ 0.2 % of the time (measured
     10 per 7,000 pairs). When the Gumbel winner equals the previous cut's actual value and another candidate weighs
     > 0, the runner-up is taken (`choose.pick` `avoid`). A pool of one still returns its part (§1.5).
  3. *Segment breaks are memoryless*: `(cuts in segment ≥ L ? 1 : 0)` became a per-cut coin with probability
     2 / (L + 1), keyed by the cut like the break noise (same mean segment length, L + 1 cuts when nothing else
     breaks). §4.16.6 is not marked FROZEN.
  Results (stub + a synthetic 12-parts-per-kind registry): insertion keeps 99 % of other choices; changes after the
  new line stay in its recency window (4 cuts, plus one through a seam's replace rule), and the line before it may
  change because its end moves; that is ≤ 4 cuts in about 98 % of insertions (2 of 108 in the test changed 5) and ≤ 6
  always. Adding a part keeps ≥ 98 % (with 12–18 parts per kind; with the two-part stub pools a third part takes about a
  third of its kind's picks). A reroll changes ≤ 3 other cuts in > 99 % of cases (a wider sweep found 2 of 1,244 with
  4, both runner-up chains of rule 2). The tests assert exactly
  these numbers; the DESIGN's flat "at most 4" and "at most 3" cannot hold with a 4-cut recency window and a strict
  no-repeat rule. Insertions are measured with line starts pinned (as after tap-sync): with auto timing and a song,
  every later line moves and gets a new loudness percentile, which is timing, not the chooser.
- **Roles.** Every per-cut kind is pooled by the cut's role (the §4.16.4 pool); seams, grounds and atmos are not (they
  belong to boundaries and segments). A special cut whose role no part serves gets the kind's fallback silently, or
  `'none'` for decoration/effect slots whose fallback does not serve it. `pool-empty` is reported on lyric and focus
  cuts, and elsewhere only when the fallback itself is outside the user's filter.
- **Chooser details.** Candidates are the pool in sorted key order; the relax order is: full weights → no traitFit/fits
  → pool without orient/script/aspect → fallback. `traitFit` measures "50 % beyond" against max(|bound|, 2 cells or
  0.2 energy). List kinds (ornament, filter) share recency across their indices, and a value chosen for a lower index
  of the same cut counts as the previous cut (no two equal decorations in one cut). `gumbel` for a pool is computed from
  a shared FNV prefix (same numbers as `core/rng.gumbel`, tested).
- **Seeds and salts.** Frozen labels as §4.1.3. Field dice on a parameter (`cut/<key>:arrive.dur`) and work salts
  (`work:mood`, `work:theme`, `work:texture`) are appended as an extra label only when present. The cutter's focus coin
  uses the cut seed of `<lineId>~0`. The texture seed is `hash32('texture', moodSeed[, salt])`.
- **Cutter.** Split pins are line scope only; `'none'` = one piece. `/` pieces and split pins are never re-split; the
  focus split (coin) applies to auto pieces. A piece whose letters are all emphasized is `focus` too. Cut text drops
  trailing spaces; `note` rides on the line's last piece, `impact` too. A short first piece absorbs the next.
  `cut/<key>:t0` pins count at cut scope only and must lie strictly between the previous boundary and the line's end.
  Special cuts: `title` text = title, `note` = artist; `intro` and `gap/<id>` text `''` with `note` = the next line's
  heading (the interlude arrange decides what to show); `outro` text = title, `note` = artist. With no lines, a title
  (if set) fills the video. `b` uses `max(t1, next.t0)` when a pinned end runs past the next start.
- **Features.** `energy` with a song = share of the song's 20 Hz samples ≤ the mean over [t0, t1]; without = the §4.16.7
  formula. `section`: song.info at t0, else the last heading above that names a section (サビ/chorus, Bメロ/pre-chorus,
  Aメロ/verse/n番, Cメロ/bridge, 間奏, ソロ, イントロ, アウトロ), carried forward to the following lines (a section lasts until
  the next heading). `repeatOf` = the cut at the same offset in the earliest identical line, else its first cut, so a
  repeated chorus echoes piece by piece. `units.glyph` counts non-space graphemes; `units.line` is 1 (the planner never
  measures). Numbers are rounded to 3 decimals.
- **Look.** Mood keywords match case-insensitively in `song.info.mood + summary` (×3 each). Pinned colors are kept
  exactly (the inspector warns about contrast); only the automatic ink (4.5) and accent (3) are fitted. `chroma` turns
  ink/accent within 40° (HSL) of #00B140 by 60° away from it; `black` makes shiftA/B greys of the same luminance. The
  auto texture must be a registered `texture: true` filter allowed by `filters.filter`; its `amount` = `amount.texture`.
  `look.texture` is `null` when there is none.
- **Tracks.** `seams` lists only boundaries that are not the hard cut (`registry.fallback('seam')`; WP0's plan_basic
  reading). `at` = B.a; `dur` = the seam's `dur` param clamped to 0.4 · the shorter window and to 0.8 s for world seams
  (§7.4), rounded down to 1 µs. The replace rules use `registry.fallback('depart'|'arrive')` and skip pinned motions.
  Ground/atmos params come from the first cut's pins; atmos with nothing eligible is `'none'`. Segments tile
  [0, duration]; a segment starts at its first cut's `a` (0 for the first). A video with no cuts yet has one segment
  `{ key: 'g', cuts: [] }` over the whole length (WP4's `buildGround` already handles a segment without cuts), chosen with the
  work pins. Impulses sort by (t, flash/shake/slip/punch).
- **Rules.** An arrange with `motion: 'own'` forces the three motion kinds to their fallbacks (`from: 'rule'`); pins on
  them do not apply there (a cut pin warns `pin-not-applicable`). A pinned arrange that works in one orientation sets
  `orient` (`rule`) unless `orient` is pinned. An inapplicable `orient` pin (text that cannot stand) warns.
  `ornament.count`/`filter.count` raised by a pinned part are `from: 'rule'`. Pins beat filters and the season with
  `pin-filtered`/`pin-off-season`; every warning is reported once per (code, path, line, cut).
- **Fingerprints.** `fp` hashes the cut's text, emph, impact, note, role, lang, feat, slots and els, its window relative
  to t0 (lead and length), and the palette, faces, amounts, design size and registry version; plus the beat phase of `a`
  when a chosen part needs `beats`, and `a` with the digest when one needs `level`. **WP4/WP5:** a part's build must
  not depend on the cut's absolute time or key beyond these, or its scene will be stale after a timing edit.
- **Plan hash.** `hash` is exactly `hashJSON(plan without hash)`; the planner assembles that canonical text itself from
  per-cut encodings (reused for `fp`), so each cut is encoded once. Tested equal to `core/hash.canonical` on the corpus.
- **explain.** Chooser slots (parts, orient, text.*, counts, seams, grounds, atmos) re-run the pipeline with that slot
  traced, so the value is the Plan's by construction (tested on 500 random slots); other slots read the Plan and the
  pins. A line/work path explains the first cut it covers (work: the first lyric cut). `why` codes are those of
  §4.16.8; rules name themselves (`seam`, `motion-own`, `arrange`, `index`, `role`, `pace`, `world-chance`, `chance`,
  `fallback`, `relaxed`, `marks`, `lrc`, `mood`, `theme`, `song`, `auto`, or the slot name for formula slots).
  `alts` list every pool:true part of the kind with its weight here, masked by `filter`, `season`, `gate`, `role` or
  `trait` (orient/script/aspect or scope); a pinned slot still shows what the chooser would weigh. Mood and theme alts
  carry their look weights.
- **FieldState.** `state` from the pin at the path (or under `pinKey`): lock → `locked`, ai → `ai`, else `pinned`; a
  pin the Plan does not use → `inactive` (`not-applicable`); a part-qualified parameter whose part is not chosen →
  `inactive` (`part-changed`); values that differ across the covered cuts, or some cuts pinned and some not → `mixed`;
  all from one broader pin → `inherited`; all cut lock pins → `locked`; marks → `mark`; rules → `derived`. `display` is
  a string for numbers and text, and `['val.part', { kind, key }]`, `['val.none']`, `['val.on'|'val.off']`,
  `['state.mixed']` otherwise. `autoText` is `null`: the inspector can show `core/schema.describeAuto(state.schema, lang)`
  (the schema carries the AutoSpec). `schema` is the ParamSpec, a slot spec (`{ type: 'part', kind, of, none }` for part
  choices, SLOT_SPECS/LOOK_SPECS/LINE_SPECS otherwise). `warn` is the plan warning for that path.
- **lockPayload (§3.6).** Every auto/rule/fallback value in `cut.slots` (choices, counts, orient, text.*) with its
  unpinned parameters, the seam into each cut (the hard cut too, except into the video's first cut), and the split.
  Not frozen: values already pinned (also inherited ones), colors, faces, amounts, times, and backgrounds/atmos (they
  belong to a segment; a cut pin would split it around the locked line).
- **plan_basic.json is not regenerated.** WP0 wrote it by hand, and `fake_engine`, `frame`, `contract`, `ui_fields`
  and `ui_selection` tests assert its content (a title card, focus cut `ra~3` with `filter#0`, `seams[0]`, …). The real
  planner plans project_basic differently (no title card: the first line starts at leadIn 1 s < 1.5 s). Regenerate it at
  integration together with those owners.
- **Golden hashes.** `plan_hashes.json` holds the stub-registry hashes of all 240 corpus plans. The determinism test uses
  the registry kind the golden records, so an incomplete catalog does not break it; once the catalog is complete, run
  `node tests/update_golden.js` on purpose.
- **Performance (§9.1 acceptance "plan(project_long) ≤ 10 ms", §7.4 "100 lines ≤ 5 ms") is not met here.**
  project_long (120 lines, 245 cuts) takes about 26 ms with the stub parts and 35 ms with 12–18 parts per kind in this
  container; project_basic about 4 ms. About 40 % is casting (≈ 35k candidate weights, parameter autos through
  `core/schema.coerce`), 30 % is encoding and hashing a 380 KB canonical plan twice (fp and the frozen plan hash), the
  rest parsing, timing, features and tracks. Already done: pool/static caches, batched Gumbel and param-stream hashing,
  a planner-side canonical encoder. Next steps if needed: re-plan incrementally (reuse cut encodings and casts of cuts
  whose inputs did not change). The test asserts < 100 ms to catch regressions.

## strings wanted

For WP8 (`i18n/strings.js`), from WP3. Only needed if the inspector renders `FieldState.display` with `t.label`
(it currently reads `value`); `val.part` should be shown with `t.part(kind, key)`.

| Key | ja | en |
|---|---|---|
| `val.none` | なし | None |
| `val.on` | オン | On |
| `val.off` | オフ | Off |
| `val.part` | {key} | {key} |

## WP8b review fixes

All review findings on UI part 2 are fixed; the readings below are what changed. Marked `WP8b` edits in `ui/boot.js`:
`pin.clearField` and the Space/Enter activation rule.

- **Picker keys follow focus (§6.8).** `app.pickerOpen` is now a getter: true only while focus is inside the inspector's
  sub-page (part browser, filter page). `picker.move/pick/back` also decline outside it. Sub-pages close when 詳細 closes
  or the column switches to AI. Inside a sub-page, Space/Enter on a tile or checkbox keep their native activation (boot).
- **Del (§6.8, §3.6).** A focused row publishes `view.focusField` = the path(s) it may clear. That is a string, or an
  array on the several-lines page (one path per line). The row clears it on focusout, on rebuild, on selection change and
  when 詳細 closes. `pin.clearField` (boot) removes those that hold a pin and **never a `lock` pin**, like ×.
  **UI part 3 / others: `focusField` may be an array.**
- **切り替え on the line page (§6.4.6)** now writes the transition into the line's **first cut**:
  `cut/<first cut>:seam` (+ `seam.dur`, `seam@key.p`), with `sig`. FieldSpecs carry `firstCut: true`. A one-cut line
  keeps `line/<id>:seam`, because its cut fields merge into the line page. On the several-lines page each line's first
  cut is written, and いろいろ shows when they differ. That row's × / Del also clears an existing `line/<id>:seam`
  pin, which reaches the first cut and otherwise could not be removed from anywhere. "Every cut of the line" is the
  existing ⋯ › 範囲を広げる → この行のすべてのカット (`pin.promote`). The label is `fld.seamIntoLine`.
  Pure helpers in `ui/fields`: `pathsFor(field, ctx)`, `clearPathsFor`, `firstCutScope`.
- **Inactive part parameters (§3.4, §6.6 無効).** `fields.withPinnedParams(sections, ctx, fields.pinnedSlots(ctx, pins))`
  adds a row (`pinnedOnly: true`) for every `kind@key.param` pin at the page scope (or at the first cut, for firstCut
  rows) that no row shows yet. The row goes after its part's rows, or into この部品の調整. An unknown part gets a
  read-only text row. The inspector reads their FieldState (`inactive`, reason `part-changed` / `not-applicable`) and
  shows the reason under the row. ×, the tag and ⋯ 自動に戻す act on inactive pins. A lock pin is never "pinned here".
- **Generated parameter labels (§4.23).** `label: 'fld.param'` (`'{name}'`). The name comes from `labelText` { ja, en }
  (the registry's param label) as `{name}`. Every FieldSpec now has a string `label`.
- **Widgets.** Sliders keep ← → ↑ ↓ Home End PageUp PageDown. Each key commits, merged per field in the store's typing
  window. Segmented choices are radio groups (one tab stop, arrows / Home / End choose). A number without a value (no
  tempo, `readRate`) shows an empty box with 自動, never the spec minimum. `cutpoints`: clicking an auto ┊ pins the
  current split as it stands; only ┃ (pinned / mark) is removed on click (`widgets.cutClick`).
  **WP3: `planner/fields.fieldState('work:readRate')` returns `undefined` (lookValue: "not stored in the Plan"). Please
  return the §3.4.1 auto (`clamp(bpm / 20, 3, 14)`, else 7) so the field can show it.**
- **Timeline.** It reads `song.info` as the AI stores it: sections `{ kind, start, end }` with `songSec.<kind>` labels,
  and highlights `{ time }` (`timeline.songMarks`). Edges: `pin` is solid, an LRC stamp is thin and solid (a mark, not a
  pin), `auto` is dashed (`timeline.edgeKind`). The 行 list likewise shows LRC starts as marks (LRC badge, no `'`).
  **UI part 3: `songSec.*` (イントロ … その他) can label the 分析 review too.**
- **Lists** are joined with `list.sep` (`・` / `; `), never a literal; a Node test scans the WP8b views for Japanese in
  string literals. Unknown `why` codes are left out instead of being shown raw.
- **Added controls (§6.4.5, §6.11).** 色 › [テーマの色に戻す] and 強さ › [雰囲気の値に戻す] clear the non-lock
  `work:color.*` / `work:amount.*` pins, one entry each. 書体 shows a banner on `font-fallback`. On the line page, a
  locked line with `lock-partial` shows 「ロック中の区切りが合いません」 + [ロックし直す]. That button is one `lock.set` of
  the line's current lock pins plus `planner.lockPayload` (which adds the split and whatever else went back to auto).
- **試した見た目** keeps the focus on the chosen entry after the redraw. The reset / relock customs redraw with focus
  inside and put the focus back.
- **Tests.** `ui_fields.test.js` gains tests for the first-cut paths, pinned-only rows, the extra customs, `cutClick`,
  `numberText` / `ownsKey`, `songMarks` / `edgeKind` and the no-Japanese-literal scan. It uses `parts/catalog` only once
  `defaultRegistry()` builds. `ui_flows.py` gains `keys` and `values` flows, and the keyboard first run now ends with
  Tab → [書き出す] → Enter through the same MP4 check (skipped without H.264). The decoded-frame count stays in WP6's
  `export_check.py`. New option `--root DIR` serves another tree (with `src/` and `vendor/`).
- **Integration note (not WP8b).** While `parts/catalog` has only moods and themes, `createRegistry` throws "exactly one
  definition needs fallback" for every part kind. `ui/boot` uses the catalog whenever the module exists, so the app page
  does not boot (ui_flows / ui_layout cannot open it), and `i18n.test.js` fails its registry test. I ran ui_flows against
  a local copy without `parts/catalog`, `parts/mood`, `parts/theme` (`--root`). All flows pass there.

## WP7 review fixes

Fixes from the WP7 review. **This replaces steps 3 and 4 of the WP7 recipe above.**

- **Validate against what was sent (WP8).**
  - Every request now returns `lines`, its numbering: `[{ i, rowId, text }]` for prep, and `[{ i, lineId, text }]`
    for proposals, edit and align.
  - When you send a request, keep `doc`, `plan` and `store.rev`. Validate the answer against **those**, and pass
    `{ rev, lines: req.lines }` (plus `lineIds` for an edit): `prep.changes(doc, json, { rev, lines })`,
    `looks.proposalChanges(doc, plan, reg, json, { rev, lines })`,
    `looks.editChanges(doc, plan, reg, json, { rev, lines, lineIds })` and
    `song.alignChanges(doc, plan, json, seconds, { rev, lines })`. `base` is then what was sent.
  - Before showing the review, and again before applying it, call `changes.markStale(store.doc, currentPlan, changes)`.
  - Then apply as before: `toCommands(store.doc, currentPlan, checked)`, one `store.batch`, and `logEntry`.
  - With `lines`, an answer's `i` maps through the id. An edit made while the request runs (for example a new first
    row) cannot move a change onto another row or line. A row or line whose words changed since the request is skipped
    with `ai.warn.changedSince`. This also holds if a caller validates against the current document by mistake.
    Without `lines`, `i` is the position in the doc/plan given (the old behaviour).
- **Season.** Every seasonal pick is checked against the season that will be in effect after the answer, not against
  the answer's word:
  - `"any"`, `""` or an unknown value with no season pin: the season the plan shows. That is the keyword season, so
    winter lyrics still drop spring themes and summer parts.
  - `"any"` with a season pin: the pin is cleared (§4.22.5). The season in effect is then the keyword season
    (`planner/look.scanSeason`, as explain does). The change keeps `to: 'any'` (toCommands → `pin.clear`), adds
    `toSource: 'auto'`, and its label carries the automatic season as `to`. `describe` shows it as
    「季節: 夏 → 自動（春）」, reusing `ai.ch.auto`.
- **Pins go through `core/pins.lookup`** (§4.3). The validators no longer read `doc.pins`.
  - A line part pick is dropped when every cut of the line decides that part with its own cut pin. The warning is
    `ai.warn.pinned` ({n, kind}), or `ai.warn.locked` when those pins are all `by: 'lock'`.
  - When only some cuts are pinned, the pick is kept. `from` is then what the first cut the line pin can reach shows.
  - The edit prompt lists cut-level settings: `2:arrive(cuts)=x` means all cuts are pinned, and
    `0:arrive(1 of 2 cuts)=y` means some are. The system text says the "(cuts)" ones cannot be changed.
  - Prep drops a cut (`/` marks) change when a `line/<id>:split` pin decides the cuts of every line the row is sung as,
    because the marks would change the text but not the cuts. The warning is `ai.warn.splitPinned` ({n}), or
    `ai.warn.locked` for a lock's split pin. Emphasis and readings on that row still apply.
  - `markStale` still compares the exact target (for example the line pin's value). It does not track cut pins added
    after the request.
- **Themes turned off** (`doc.filters.theme`) are left out of the theme list (`catalog.themesText(registry, lang, doc)`;
  `doc` is optional). They still appear under "Parts turned off" in the edit prompt. A proposal or edit that names one
  is dropped with `ai.warn.turnedOff` ({kind, key}), unless the same answer allows `theme.<key>` again.
- **Uploads.**
  - A failed Files API poll is an error: 5xx → `server`, 401/403 → `auth`, 429 → `rate`, anything else → `upload`.
  - After polling, the file must have a `uri` and be `ACTIVE`, else `upload`. A poll record without a `uri` keeps the
    upload's `uri`.
  - Upload errors scrub the key, as `providers.call` does: network errors and server messages. `providers.scrub` is
    now exported.
- **Big reviews stay linear.**
  - `changes.rowSrcs(doc)` (rowId → src) is built once per call and passed to `make` as `opts.srcs`.
  - `markStale`, `logEntry` and `revertCommands` use it too, so they never search the sheet once per change.
  - `toCommands` groups lyric changes by row once. It parses only the rows it edits: `lyricio.rowsView(doc, only)`
    takes an optional Set of row ids.
  - Measured in Node 22 on 3,000 rows (9,000 changes): `toCommands` went from ≈ 500 ms to ≈ 160 ms, `markStale` from
    36 ms to 2 ms, and `prep.changes` from ≈ 150 ms to ≈ 120 ms. All of them now grow linearly.
- **Additive exports:** `changes.rowSrcs`, `changes.lineResolver(plan, lines)` (the shared i → line mapping),
  `providers.scrub`, and the `toSource` field on a Change.

## strings wanted

For WP8 (`i18n/strings.js`), from the WP7 review fixes. `changes.warningText` resolves `{kind}` and `{key}`.

| Key | ja | en |
|---|---|---|
| `ai.warn.changedSince` | {n}行は送ったあとに変更されたので使いません | Line {n} changed after the request, so it was skipped |
| `ai.warn.pinned` | {n}行 · {kind}はカットごとに手動で固定されているので変えません | Line {n}: {kind} is set by hand on its cuts, so it stays |
| `ai.warn.splitPinned` | {n}行 · 区切りは手動で固定されているので変えません | Line {n}: the cut points are set by hand, so they stay |
| `ai.warn.turnedOff` | 使わないことにした{kind}です: {key} | {kind} {key} is turned off |

## WP2 review fixes

- **Kinsoku on phrase boundaries (§4.15.3).** A phrase start now steps back over every opener, down to the previous
  start. A start that would leave the previous phrase holding only openers is dropped, so the openers join the phrase
  after. `phrases`, `words`, `columns` and the layout's `words` never end a unit with an opener or leave `「` alone.
  - Examples: `君「Love」` → 君 | 「Love」. zh `（笑）` → one phrase. `「你好」世界` → 「你 | 好」 | 世 | 界.
  - The auto cutter (`planner/segment`) now splits `夜明けの君「Love song」` as 夜明けの君 | 「Love song」.
  - Spaces and the ends of the text are still hard boundaries.
- **`RunLayout.emph`** marks the glyphs in `RunSpec.emph` whatever `emphScale` is. So `emphScale: 1` (colour-only
  emphasis) still gets the accent ink, emphFirst order and emphasis ornaments. The size factor is kept separately.
- **Narrow corner marks in vertical text (§4.15.2).** `vert.offsetFor(cls, family, adv)` takes the glyph's advance in
  em as an optional third argument. For a corner mark narrower than 1 em, dx = 0.55 − (1 − adv) / 2. Its advance box
  then starts 0.05 em right of the column axis, as a fullwidth mark's does. The FROZEN table is unchanged.
  - The layout passes each glyph's measured advance. So "`x` = cell centre plus the §4.15.2 offset" in the WP2 notes
    means this advance-aware offset.
  - Measured in Chromium with the real faces, ink in em from the cell centre (the cell edge is +0.5):

    | Glyphs | Face | Before | After |
    |---|---|---|---|
    | `,` `.` | Fraunces | +0.45…+0.65 | +0.09…+0.29 |
    | `｡` `､` | Zen Kaku Gothic New | +0.35…+0.62 | +0.10…+0.37 |
    | `、` `。` `，` `．` | Zen Kaku Gothic New | +0.11…+0.41 | unchanged |
- **FontBook.**
  - Each face is loaded (`document.fonts.load`) only for the characters it draws. New pure helper
    `faces.loadText(ref, text)`: a Latin family keeps Latin letters, digits and punctuation, and loads its default
    subset when none are left. A CJK family keeps every character.
  - Result: `ready(refs, '夜明けの街を走る')`, the FROZEN string form, no longer fails Inter. Checked in Chromium with
    the real Google CSS: both faces load and `failures()` is empty.
  - A failed load is forgotten, so a later `request`/`ready` tries again. The ref stays `failed` until a retry
    succeeds.
  - A stylesheet whose `<link>` errored stays failed for that URL. It is not re-added on every scene build.
  - The watch key includes the load text, so new Latin characters (e.g. a latin-ext subset) are loaded too. Each newer
    successful load bumps `epoch`, as a new CJK URL already did.
  - `request`/`ready` accept plain `{ family, weight }` entries (`plan.look.faces`). They become FontRefs for the
    family's script (from FAMILIES, else ja). An entry without a family name throws `TypeError` instead of being
    skipped silently.
  - Additive faces exports: `isLatinFamily(family, script)`, `loadText(ref, text)`.
- **Tests:**
  - `breaker`: kinsoku on every touching phrase/word boundary (ja and zh samples, plus a 1,500-text fuzz).
  - `layout`: `emph` at `emphScale` 1, 0.9 and 1.15, and no lone opener in layout words.
  - `vertical`: narrow corner marks.
  - `faces`: `loadText`, and FontBook against a Chrome-like document double (Japanese-only text, retry after a failed
    load, blocked stylesheet, plain entries).

## WP5c review fixes

- **Catalog landing order (major; no code change, not a WP5c edit).** `defaultRegistry()` stays strict (FROZEN §4.6).
  `parts/catalog.js` was checkpointed (2db02d4) before 5a/5b, so today the strict call throws and the app page does not
  boot, `conformance.test.js` fails at load and the registry test in `i18n.test.js` fails (`frame.test.js:190` will once
  `engine/facade` exists). There are two ways out, both outside WP5c:
  (a) **lead:** take `src/parts/catalog.js` out of the tree until the first 5a/5b delivery gives all 9 part kinds
  a fallback part. Then restore it (from 2db02d4, or the §4.6 frozen code) and regenerate
  `tests/golden/plan_hashes.json`.
  `catalog.test.js` no longer needs the file: the theme and mood checks load the part modules directly, the catalog-file
  tests skip, and one test fails once every part kind has parts but the catalog is still missing.
  (b) **callers guard the call the way `ui_fields.test.js` does:** `ui/boot.js:36` (WP8a: `try` the catalog, else
  `STANDIN.registry()`), `conformance.test.js:454` and `frame.test.js:190` (WP4), `i18n.test.js:74` (WP8).
- **A theme does not favour its own texture.** `risoPink.prefer.filter` is now `{ duoTone: 1.6 }` (dotScreen removed).
  `chalkBoard.prefer.filter` is now `{ softVeil: 1.3 }` (a chalk-dust haze) instead of dustSpecks. Tested. In the
  "## WP5c" key list, the filters named by theme `prefer` are now `grainFilm duoTone rasterLines glowSpill chromaSlip
  amberSpill edgeShade softVeil`.
- **For WP3 (a suggestion, not frozen).** Mood `filters` (§5.11) still name texture filters: dotScreen for popFizz and
  printColumn, grainFilm for quietHush, silverReel, printColumn and heartAche. So an auto `filter#i` can still repeat
  the work texture on a cut. The planner could leave `plan.look.texture.v` out of the auto `filter#i` pool. Pins would
  still win.
- **Blurbs are one sentence** (§4.18.1): the ja blurbs of monoPress and cyanPrint were two sentences. Every theme and
  mood blurb is now tested for this.

## WP4a review fixes

Fixes to the reviewed WP4a findings. Where a bullet here contradicts the `## WP4a` section above, this one holds.

- **Unit pivots and the identity rule.** `runGlyphMotion` writes `px py` only while a glyph is away from rest (entrance
  `u < 1`, exit `u > 0`), so a word/line/run entrance at progress ≥ 1 (and an exit at ≤ 0) leaves every pose column,
  `px py` included, at the base pose. Glyph-motion behaviours carry an additive `exit` flag (true for a depart).
- **Slot seeds (supersedes "Seeds").** `env.seed` = `hash32('slot', slot, decision.v, cut.text)`; segments (ground,
  atmos) use `''` for the text. Like §4.1.3 it never depends on params, `from`, `by` or `pfrom`: locking a line, pinning
  a value to what it already is, or moving any slider keeps `env.rng`, per-glyph `g.rnd`, the `scatter` order and
  particle layouts; choosing another part changes them. A segment's fp covers neither its key nor its cuts' text, so the
  old `seg.key` seed let two segments with equal fp render differently depending on which one the cache built first.
  Open for WP3/WP4b: a ground's env still exposes the segment's first cut (`env.cut`, `env.feat`, autos for params the
  decision lacks), which `groundFp` does not cover; either the fp should include what a ground reads or grounds should
  not read the first cut.
- **Dwell arrivals** come from the entrance behaviour as built (`t0 + delay[j] + dur`), so `time` in `K.perGlyphHold`
  counts from each glyph's real arrival for every order, `scatter` included. A non-kit entrance is fitted with its own env.
- **Ground errors.** `buildGround` has the same safety net as `buildCut`: a throwing ground or atmos rebuilds the segment
  with the fallback ground (auto params) and no atmos, plus `{ code: 'part-error', cut: seg.cuts[0], detail }`.
- **Kit: exposed params (supersedes "Put `...K.moves()` before your own `params`; exposed params are regenerated").**
  A part's own `params.yFrom` (entrance) / `params.yTo` (exit) refines the generated spec field by field (auto, label,
  range …); `K.variant` patches do the same. A number auto outside the range widens it unless the author set that bound.
  The other direction's name is dropped. `K.mirror` moves the entrance's refinements to the exit's name (`yFrom` → `yTo`)
  except the label, which is generated ("終わりの…"); a mirror patch can still set it. `...K.moves()` must still come
  before your own `params` key (a later spread replaces the whole object). A generated step is made finer when the
  authored value does not lie on it, so coercion never changes a default.
- **Kit: track units (supersedes "Track units").** `x y z blur` are em of the glyph unless `unit: 'du'`; `jx jy pixel`
  are **du** unless `unit: 'em'`; angles degrees (`'rad'` allowed); others plain. Exposed `jx jy pixel` params are `du`
  with ranges ±400 / 0–200.
- **Scene cache prefetch.** Before building, prefetch touches the cached scenes of its window (the nearest `max` items),
  farthest first, so the scenes it builds evict only scenes outside the window. An idle prefetch per frame now builds each
  scene of a moving window once, also when the ±10 s window holds more items than the cache (short cuts).
- **Conformance runner (supersedes "Conformance runner").** Every part runs the full §8.2 matrix by default;
  `MV_CONFORMANCE=quick` runs the sampled matrix for local runs. CI needs no variable. The catalog is read module by
  module (the §4.6 pattern) and validated non-strictly: its valid parts are tested even while other kinds are missing,
  kinds without a fallback borrow `corpus.minimalFallbacks()` as hosts, and module errors plus registry problems fail
  the test "catalog registry: valid, every kind present …" (it fails until WP5 has one fallback per kind). The stub and
  example registries always run. A new self-test checks word/line/run entrances and exits (K.moves, K.perGlyph, K.mirror).
  Full run of stub + examples + today's catalog (themes, moods): about 10 s here.
- **Golden frames.** `frame.test.js` mirrors `update_golden.js` (registry choice, `prepare(0, duration, { export: true })`)
  and skips only while `engine/facade` is missing or the goldens are empty. A registry kind or version different from the
  goldens' fails with "goldens were made with the … registry …: check the frames, then run node tests/update_golden.js".

## WP4b

Engine part 2: `engine/render/{surface,sprites,shapes,draw,post,seam,pick,renderer}`, `engine/facade`,
`engine/host/canvas`, `ui/lab`; tests `tests/node/facade.test.js` and the browser tests `parts_gallery`, `glyph_parity`,
`determinism`, `perf`, plus the tool `tests/browser/contact_sheet.py` (it also holds the lab-page helpers the other four
import). The §4.20 API is kept; these are the readings and additions.

- **Facade additions.** `createEngine` also takes `now` (a ms clock; L0–L5 may not read clocks, so the host lends one:
  the `engine/host/canvas` factory has `now()` and is used when `now` is absent), `strict` (tests: part errors throw)
  and `sceneMax`. Without a clock (the recorder in Node) frame times read 0 and the adaptive preview stays at level 0.
  Additive members: `setPlan(plan)` (render a plan made elsewhere: sample plans, fixtures), `scene(kind, i)` (the built
  scene, for the lab), `fontUsage(t0, t1)`, `setLevel(n)`; module exports `samplePlan(registry, ref, opts)`,
  `sampleTime`, `SAMPLE`, `SAMPLE_TEXT`. `FrameStats` and `stats()` add `level` (adaptive preview 0–4) and `passes`.
- **renderFrame options (additive).** `reduceFlash` (the UI already passes it): in the preview, `fx.impulse('flash')` is
  ×0.3. `glyphPath: 'sprite' | 'direct'` and `probe: { blur, glow, shard, pixel }` (added to every glyph's pose) are lab
  and test hooks; `quality: 'export'` ignores both.
- **Draw order (§4.19.2).** Per world and per layer (ground, far, mid, text, near): the ground segment's nodes, then each
  visible cut's in `a` order — layers interleave across scenes, so an atmos on `near` stays above the text and A's exit
  and B's entrance share their layers. `hud` last with view(0). Grounds use the camera of the current cut (during a world
  seam, A's or B's). Text seam: ground/far/mid of everything and the grounds' text layer; A's and B's text + near layers
  into two surfaces → `seam.mix`; then the grounds' near layer and hud. World seam: two complete worlds (a segment both
  sides share is drawn in both), the backdrop under the mix result. The post stack always runs once, on the result.
- **Post.** Texture and accents are sorted together: stage, then the texture before accents of its stage, then key and
  slot. `when` weights `p.amount` (a weight 0 skips the filter, no passes): `arrive` 1 until the entrance ends, then
  down over 0.2 s; `depart` up over 0.2 s before the exit; `beat` exp(−since/0.15) (no grid: a pulse every 0.5 s from
  the cut start); `impact` exp(−tl/0.6) after t0 on impact cuts, else 0. §4.19.4 gates filters per backdrop. A filter
  or seam that throws is skipped (a seam becomes a hard cut) with `{ code: 'part-error', detail: 'filter/<key>: …' }` in
  `warnings()`; `strict` rethrows. Adaptive preview exactly as §7.4 (EMA α 0.1; level 1 halves cost ≥ 3 filters, 2 draft
  paints, 3 renders at 0.75 and scales up, 4 skips cost ≥ 4). **WP8:** show 軽量表示 when `stats().level ≥ 1`.
- **FxContext.** `apply(fx, src, p, t)` gets absolute `t`; `fx.cut = { tl, dur, impact, energy }` (null for the texture);
  `fx.rng`/`fx.noise` are seeded by `hash32('fx', cutKey, slot, key)` (texture: `'texture'`). `fx.beat` returns a pooled
  object (valid until the next call). `fx.blurred` works at ½ per side below 8 px and ¼ above (one more downscale when a
  browser ignores `ctx.filter`). `fx.textAt` renders the visible cuts' text + near layers at t − dt; a 4th call per frame
  throws. **Tiles** are 128 px and wrap seamlessly: `grain` (core/noise.tile, drawn once with 1-px fillRects in 16
  greys, since engine/render may not use putImageData), `halftone`, `scan`, `dust`, `fiber` (paths); a seed picks a
  wrapped offset of the base tile (LRU 24), so a tile that changes on `fx.tick` costs four drawImage calls.
- **Glyphs (§4.19.5).** The path rule is exactly the frozen one. Text style `glow` is a steady glow of 0.45 under the
  glyph, so glow-styled text is always on the sprite path (from its state, never its size). Styles, shared by both paths
  (`sprites.paintStyled`): outline = fill in the ground colour + a 0.045 em stroke in the ink; shadow = a copy offset
  (0.06, 0.07) em in the ground shaded 62 %; duo = a copy offset (0.045, 0.045) em in shiftA. Sprites: bucket = the
  nearest 2^(k/4) px (4…1024 px); box 1.6 em plus 2.5 σ of blur (σ = the level in du); crossfade alpha 1 − f / f;
  **level-0 sprites are rasterized at 2× their bucket** (within the 512 px cap): parity measured 1.5/255 (1.9/255 at 1×).
  Glow = the 8 du sprite in accent with `lighter`; tint, echo = sprites in accent / shiftA / shiftB; pixel = through a
  512 px scratch canvas with smoothing off; shard = 6 strips offset by ±0.6 em (x) / ±0.4 em (y) × shard, seeded per
  glyph. Flip shading in 1/16 steps. The sprite cache empties when the measurer key moves (faces arrived); budget 96 MB,
  48 MB for exports at ≥ 1440p. Reveal clips cover the cell × 1.3 (overhanging ink); `lines` = 4 slats. Overfull runs
  are clipped to `RunLayout.clip` in the run node's frame. Font css strings are cached per face and size.
- **Paints and layers.** A paint with `animated: false` on a static node is rasterized once per (output scale, palette,
  draft) with its bleed rounded to whole device px, then placed with the camera (LRU 8, 48 MB); non-animated paints are
  always drawn with `t = 0` so the cached and direct draws agree. `LayerSpec.cache: 'static'` layers are cached the same
  way (not pickable). Masks use `destination-in`/`-out`; a layer blur uses the fx blur.
- **Surfaces.** Pooled per size, ≤ 10 frame surfaces (≤ 6 at ≥ 1440p) plus a grace of 4, then `SurfaceError`; every
  surface taken in a frame is taken back at its end. A taken surface is reset unconditionally, so a reused surface and a
  new one receive the same calls (a frame never depends on an earlier one; `facade.test.js` checks the op streams).
- **Picking.** Glyphs (cell box), shapes (bounds + half the stroke) and images record world quads in design units; a
  ground scene's nodes belong to the current cut with owner `ground`/`atmos`. `hitTest` gives one hit per (cut, owner),
  top-first; `boxes()` gives each owner's axis-aligned union as a quad. Frames with `pick: false` keep the last picks.
  Two visible cuts that share one cached scene (equal fp) get a private build for the second.
- **Scenes, fonts, warnings.** Scenes are cached by (fp, measurer key) (LRU 16). A cut built while one of its faces is
  idle/loading is provisional; the FontBook's epoch moves the measurer key, so it is rebuilt. `prepare`: export awaits
  `fonts.ready` for the range, then builds it; preview requests the faces, prefetches the window, warms the glyph
  sprites of cuts whose motion needs blur (levels 0–3; glow style and shard: 0 and 3 / 0) at the latest frame's scale,
  and lays out 12 more unseen cuts per call. `warnings()` = plan warnings + the warnings of every scene built so far (for
  the current fps, so `overfull` covers the song after a few prepares) + `font-fallback` `{ detail: { family } }` for
  failed faces + renderer part errors.
- **Thumbnails and sample plans.** `thumb` uses a renderer of its own (preview picks and stats stay as they were) and
  a sample plan: cut 0.12–2.9 s (window 0–3.15 s), 120 BPM, a synthetic loudness envelope; the part in its slot,
  fallbacks elsewhere (a vertical-only composition gets `orient: 'v'`; a seam gets two cuts, the transition at B.a);
  text `はじまりの朝`, theme = the current plan's (else the fallback), aspect = the current one. So parts show, the
  auto `amount` is raised to ≥ 0.6 (dwell), 0.7 (lens, ornament) and 0.75 (filter, `when: 'always'`). Default `t` =
  the hero time (seam: its centre). LRU 8, rebuilt when the measurer key moves.
- **fork()** makes a new engine with the same registry, factory, measurer, fonts and assets, its own caches, the same
  plan, and the source document, so `setDoc(sameDoc)` on it is a no-op.
- **Lab (`ui/lab.js`).** Routes: `#<kind>:<key>@<aspect>&t=<0..1>&text=…&theme=…&orient=h|v&parts=…&backdrop=…
  &fonts=1`, `#gallery@<aspect>`, `#text:<sample>@v` (WP2's text mode: the sample in every theme face with the real
  measurer and FontBook, cell outlines drawn). `t` is normalized over the part's own window: arrive → the entrance,
  depart → the exit, dwell → between them, seam → the transition, else the whole cut. The pose view lists the live
  columns of the text glyphs and the path each takes. Registries: `parts/catalog`; the fixtures when a page defines
  `globalThis.MVLabFixtures` (the test pages do). While the catalog does not validate, the lab shows it with a lenient
  registry plus the fixture fallbacks for kinds that have none (noted in `__lab.info().notes`). `window.__lab` =
  `{ info, render, sheet, parity, blurSweep, frames, perf, errors }`.
- **contact_sheet.py.** `python3 tests/browser/contact_sheet.py --kind arrive [--keys a,b] [--aspect 16:9]
  [--times 0.1,0.3,0.6,0.9] [--text …] [--theme …] [--orient h|v] [--parts catalog|examples|stub] [--backdrop …]
  [--cell 320] [--fonts] --out /tmp/sheet.png`; `--list` prints the parts. It builds the lab page in memory from the
  current sources (lint problems are printed, not fatal), serves it through a Playwright route, blocks Google Fonts
  unless `--fonts`, and exits 1 when a cell failed. About 2 s for a kind here.
- **Measured here** (headless Chromium, fonts blocked): parts_gallery 1,134 renders (catalog + examples + stub × 7
  aspects × 2 times) in ~4 s; glyph parity 1.5/255 over 20 glyphs at 1080p (vertical column with 「」ー, a Latin run and
  tate-chu-yoko 1.1/255); blur switch 2.0/255 against a median step of 0.37/255; determinism OK for basic, vertical, lrc;
  perf at 720p with the examples: p50 0.9–4.4 ms, p95 7.5–13.7 ms.
- **Golden frames not written.** `update_golden.js` renders with `parts/catalog`, whose strict registry throws until
  every kind has a fallback part (WP5), so `tests/golden/frame_hashes.json` stays empty and `frame.test.js` skips.
  **WP5/lead:** once the catalog validates, run `node tests/update_golden.js` and check a few frames in the lab.
- **Integration check.** With `engine/facade`, `engine/host/canvas` and `engine/host/measure` present, `ui/boot` now uses
  the real engine. On a staging copy whose catalog adds the stub parts, `ui_flows.py` passes first run (mouse, keys, en),
  drill, lock, history, tools and keys; `pin` and `values` fail only for lack of parts (they need > 3 entrances and one
  with its own parameter). The shipped page does not boot today because the strict catalog throws (see WP5c review).
- **For WP3.** (1) World seams are drawn over the window the plan gives; §7.4's "≤ 0.8 s" clamp belongs in
  `planner/tracks`. (2) The open point in the WP4a review notes stands: a ground scene reads its segment's first cut
  (env.cut / env.feat, autos), which `groundFp` does not cover; the facade caches scenes by fp as §4.17.5 says.
- **For WP5 (part authors).** Look at your parts with `contact_sheet.py` or the lab. Filters get absolute `t`; they must
  return a Surface and give back every other surface they take; `fx.textAt` at most 3 times per frame; tiles are the five
  names above. Glyph particles (`'glyph:<char>'`) draw with the display face's ja font.
- **Strings wanted:** none (the lab is a developer page with English labels; its title uses `lab.title`).

## WP8c

UI part 3: `ui/{ai_panel,ai_review,ai_controller}.js`, the WP8c sections of `ui/style.css` and `i18n/strings.js`, marked
`WP8c` edits in `ui/shell.js` and `ui/boot.js`; tests `tests/node/ui_ai.test.js` and four AI flows in
`tests/browser/ui_flows.py`. The ai/* API is used as WP7 (and its review fixes) describe; nothing of its logic is redone.

- **Structure.** `ui/ai_controller` holds the state and the verbs and is Node-tested with a real store, the real planner
  and a faked Gemini: `createController(host, { session, local, fetchImpl, SDK })`. `host` is the app as the AI sees it
  (`ui/ai_panel.hostOf(app)`: doc/plan/rev/side getters, `batch`, `setSide`, `undo`, `toast`, `setReviewOpen`, `tryOn`,
  `altShown`, `song`, `now`, `nextFrame`). `ui/ai_panel` builds the DOM once and updates it in place (the key field and the
  instruction keep focus and caret); `ui/ai_review` renders the review and the log and exports the pure `textDiff`.
  Boot sets `app.aiPanel` and `app.ai` (the controller).
- **Keys (§4.22.6).** `mojipv.ai.key.<provider>` lives in sessionStorage, or localStorage when 「この端末に記憶する」 is on
  (moving every stored key; a key is never in both). `mojipv.ai.ok.<provider>` next to it records the model the key was
  last confirmed for (not secret). `mojipv.ai.settings` (localStorage) = `{ provider, models: { provider: model }, remember }`.
  Every storage access is wrapped. The card states are §6.4.10.1's, plus one: `set` 「キーが入っています（未確認）」 for a
  key that was entered but not confirmed yet (a stored key is never checked behind the user's back). A key counts as
  confirmed after [確認] or after any successful request; the card then collapses to one line ([変更] opens it).
- **Consent.** Per song sha1, in memory, for the open project only: it is cleared on every store `load` (new work, open,
  restore) and on reload. The card's size is computed before anything is encoded, with the sample count
  `audio/wav.encodeWav` produces at `ai/song.pickRate` (tested equal to `audioSize(audioFromBuffer(…))`).
- **Runs.** One at a time; the request is validated against the doc, plan and rev it was built from (`{ rev, lines }`),
  then `markStale` against the current ones before the review shows, on every plan event while it is open, and again
  inside [反映]. Stages 音声を準備中 → アップロード中 → 処理中 → 考え中 (upload/process only on the Files API path); the
  stage text is the live region, the elapsed seconds beside it are not announced. [中止] aborts the signal. An answer
  with nothing to change, an empty transcript, or `understood: false` gives an inline note (the question, or 「変える必要の
  あるところは見つかりませんでした」 with the dropped suggestions) instead of a review, so 詳細 is not locked for nothing.
  Exceptions that are not `AIError`s show `ai.error.internal` (and go to the console, never with the key).
- **Review.** Kinds `list` (prep, edit, align), `looks` (three cards, each with its own checked list under 変更を見る),
  `transcript`, `analysis`. [すべて] checks every row that is not stale (a stale row is re-checked one by one, on purpose);
  a re-checked stale row still applies when its target is valid (ai/changes rule). Lyric rows show the combined text diff
  once per row (`textDiff`: LCS by code point, marks deletions struck and insertions underlined, not by colour alone).
  [試写] exists for list reviews too; the try-on follows the checks. While a review is open `view.aiReview` is on (header
  詳細, the 詳細 tab and the compact side tab are disabled); hovering or focusing a row sets `view.highlight` (lane,
  timeline) and scrolls the lyric editor to the row. **For UI part 1:** the stage overlay does not draw `view.highlight`
  yet, so the preview itself shows the hovered line only through the lane.
- **Apply.** `toCommands` → one `store.batch` labelled `['undo.ai', { tool: <localized tool name>, n }]` (n = checked rows;
  a transcript: its line count), then `logEntry` + `at` (ms, additive; shown as hh:mm) appended to `side.aiLog`, capped at
  50 like the look history. この案にする also calls `ui/looks.record(append, ['look.ai', { title }])` (§3.7). Because look
  entries hold only seeds and salts and pins are never part of a look, that adds an entry only when the current look is
  not already the newest one — usually nothing is added. That is the frozen §3.7 entry shape, not changed here.
- **Log.** Each entry's [元に戻す] is enabled while `revertCommands` still has commands (derived, so undo/redo keep it
  right); the toast says 「n件は後で変更されたので戻せません」. 「AIが決めた固定 n [すべて自動に戻す]」 is one
  `pin.clearUnder work by: 'ai'`, the same command as the inspector's その他 button.
- **Try-on and compare (boot hooks, marked WP8c).** `app.tryOn` tells the controller when another try-on (part tile, theme
  swatch) replaces its own; `app.modeStrip` shows 「案Bを試写中 [この案にする] [やめる]」; `view.compare` (hold B) shows the
  current look during an AI try-on and returns to the try-on on release (§6.4.10.7, §6.7). Boot also calls
  `ai/providers.setSDK(…)` with the AI SDK global (§9.2) and mounts the panel in `[data-mount="ai"]`.
- **Shell fix (marked WP8c).** The detail column's tab buttons [詳細] [AI] [×] had `data-act` but no click handler, so they
  did nothing; they now run their actions (a click on the current tab keeps it). The AI tab hides with 「AIを使う」 off;
  turning that setting off also aborts a run and discards a review.
- **Strings.** Every key of every "## strings wanted" section so far is in `i18n/strings.js` (WP6, WP7 ×2, WP3), plus the
  panel's own. `ai.ch.rows.*` and other English plurals are written as whole alternatives (`t` splits the whole text on
  `|`). **For the i18n.test.js owner (WP0/WP8a):** its `AI_ERRORS` list still lacks `recitation`; `ui_ai.test.js` checks
  every `providers.ERROR_CODES` code has an `err.ai.*` string in the meantime.
- **Tests.** `ui_ai.test.js` (21 tests): settings and key storage (incl. blocked storage), card states, cost line, consent
  size, selection/checks/groups/log cap, `textDiff` (fuzzed rebuild of both texts), and controller runs over a faked
  Gemini: key only in the header, no audio for text tools, review before apply, one undo step, selective revert with a
  kept item, 3案 try-on following the checks, stale rows, the inline question, abort, auth errors, consent-gated audio
  with stages, Gemini-only song tools, transcript append, analysis save, project change. `ui_flows.py` gains `ai_prep`,
  `ai_looks`, `ai_edit`, `ai_align` (page.route answers for generativelanguage.googleapis.com; the second AI service's host aborted;
  every flow ends with undo-all = start).
- **How they were run here.** The tree's page does not boot while `parts/catalog` is incomplete (WP5c note), so the
  browser tests ran on staging copies: without `parts/catalog`, `parts/mood`, `parts/theme` (as WP8b did). With the real
  `engine/facade` and boot's stand-in registry, `engine.boxes()` is empty (the stand-in parts are no-ops), so the existing
  `drill` flow and `ui_layout.py`'s double-click behaviour check fail there, independent of WP8c; with the facade also
  removed (boot's stand-in engine) all 14 `ui_flows.py` flows and `ui_layout.py --quick` (90 layouts, which now include the
  AI panel's real content) pass. CSP violations: 0 in every flow.
- **Not done here:** nothing of WP8c's list is left open. The second AI service's path is exercised in Node through
  ai/providers' own tests only (no browser flow: the SDK would need a faked SDK global).

## WP5a2

Catalog: entrances and exits. `parts/arrive/{soft,flip,wipe,digital,fall,pop,gather,instant}.js` (22 entrances +
`instantShow`), `parts/depart/{drift,fall,burst,instant}.js` (exits + `instantHide`); new test
`tests/node/parts_motion.test.js`. Keys, labels and tags are the §5.2/§5.4 tables verbatim (tested against DESIGN.md
at test time). The frozen formats are kept; these are the readings and deviations.

- **Where the exits live (§4.18.7, §5 "any grouping is fine").** The five table mirrors (`inkSink`, `hingeClose`,
  `twirlDepart`, `sliceHide`, `curtainFall`) are `K.mirror`s in the module of their entrance, as §4.18.7's example puts
  `inkSink` in `parts/arrive/soft.js`. `typeErase` (shares the caret code) and `strobeOut` (a `K.mirror` of `strobeIn`)
  sit in `parts/arrive/digital.js` for the same reason. **WP5c:** `catalog.test.js` "part modules under parts/<kind>/
  each return … definitions of that kind" fails on these (`typeErase is a depart in the arrive directory`); it
  contradicts §4.18.7's own example. Please let an `arrive` module return `depart` definitions too.
- **Kit bug (WP4, `parts/kit.js` `mirror`).** With `patch.shared` (or `patch.params`), `Object.assign(def, patch)` runs
  before `mergePerField(def.shared, patch.shared)`, and `def` is the merged object, so the mirrored `dur`/`each` and the
  reversed ease auto are replaced by the patch. Workaround used here (curtainFall, strobeOut):
  `K.variant(K.mirror(entrance, { key, label, blurb, tags }), { key, shared: { order: … } })`. Suggested fix: merge
  from a copy taken before `Object.assign`. Note too that a mirror carries only the entrance's own `dur`/`each`
  overrides; without them it gets the exit defaults (hingeClose, twirlDepart use the depart ranges; tested as such).
- **The typewriter caret (§4.17.4 "a caret shape node moved by a behaviour") — for WP4 review.** `typeOn`/`typeErase`
  make, inside `make`, one accent bar per run with `sb.shape` (parented to the run node, so it follows the run's turn
  and nudges) and one raw behaviour (multi-node; module-level `run`, no allocation) that moves the active run's bar to
  the glyph typed/erased last and hides the others. It runs in phase `ORNAMENT`, `live: 'always'`, not `MOTION`: the
  caret is gone once the text rests, so its alpha differs from its base pose, while the identity rule (conformance
  checks MOTION behaviours) is about glyph poses. It blinks (0.5 s) while waiting, is lit while typing, lingers 0.7 s
  after `typeOn` (never past the exit), and appears 0.35 s before `typeErase` starts. Limitations: `el.text.hide`
  hides the glyphs but not the caret (a part cannot read node flags), and `el.text.fill` does not recolour it (accent
  by design). If WP4 wants the first fixed: apply `hide` to every `text` node after the motion parts are made.
- **Build-time data for per-glyph functions.** The kit binds `K.perGlyph` to the kind and passes the params object
  straight through, so parts that need the frame or the layout wrap the bound `make` once per definition and add
  fields to the params at build: `prepared()` in `depart/fall.js` (per-glyph landing spots of `pileCollapse` — stagger
  order, ~1 em columns on the frame floor, `env.rng` drift and tilt — and the clearance below the frame for
  `dropAway`), `oriented()` in `arrive/wipe.js` (`p.vertical` for `seamJoin`). The per-glyph functions stay factory-level.
  Such parts cannot be `K.mirror`ed (no `glyphFn`); none needs to be.
- **Readings of the pictures.** `curtainRise`/`curtainFall`: the reveal clip follows the run's `revealMode` (wipeX for
  horizontal text), so a bottom-up clip is not available; each glyph unfolds upward from its cell's bottom edge (sy about
  the baseline), word by word. `seamJoin`: the pose model cannot cut a line in two, so the halves are a hard shear
  about the line centre (kx; ky for vertical text) snapping straight. `ghostConverge`: the echo copies are at most
  ±0.08 em apart (§4.17.4), so the ghosts ride with the glyph as it slides in from alternating sides and close in on
  landing. `bloomOpen` adds an accent tint (the `lighter` glow barely shows on light grounds). `strobeIn`,
  `strobeOut`, `staticJoin` switch on `floor(tl · rate)` (param `rate`, Hz) with an integer hash, so 30 and 60 fps show
  the same pattern (§7.1.4). `stampPress`, `shardBurst` have `traits.impact`; `staticJoin` has `gate: 'glitch'`.
- **Roles.** Special cuts that no part serves get the fallback silently (WP3), which would make every title card,
  interlude and outro pop in and out. The quiet parts also serve `title interlude outro`: inkRise, fogIn, bloomOpen,
  sliceReveal, curtainRise, typeOn; inkSink, fogOut, sliceHide, curtainFall, typeErase (tested: ≥ 4 per role).
- **Tests.** `parts_motion.test.js` (a new file; §8.2 lists only the shared conformance row for parts): the §5.2/§5.4
  tables (keys, labels, tags, notes → impact/gate/fallback), counts, blurbs, roles; mirrors reproduce the entrance's
  pose at 1 − u glyph by glyph; the caret (h and v; it defines a test-only vertical composition `testColumn`);
  dropAway leaves the frame, pileCollapse lands on the floor, pointImplode ends at the focus centre (16:9, 9:16);
  strobeIn flickers; no two entrances move alike (sampled pose trajectories). About 0.3 s. `conformance.test.js`:
  all 41 parts pass the full matrix (~12 s); `parts_gallery.py` OK.
- **Seen when running the whole suite, not caused by these parts** (reproduced on a copy of the tree without them):
  `planner_determinism` golden plan hashes, `planner_stability` field dice, `catalog.test.js` theme prefer
  `magazineHead` (5a1's arranges in flight), `i18n.test.js` registry labels and the conformance "catalog registry" test
  (the strict catalog still lacks dwell, ground, ornament, lens, filter, seam).
- **Keys are forever (§7.1.9):** these 41 keys are released with this package.
- **Strings wanted:** none (labels, blurbs and param labels live in the definitions).

## WP8c review fixes

- **A review always shows in the AI tab (§6.4.10.6, §1.5).** `ai_panel.hostOf(app).setReviewOpen(true)` now also runs
  `app.openPanel('ai', 'ai')` when the column shows 詳細 or is closed (desktop tab and compact side column alike), so the
  inspector is never left on screen, editable, behind a disabled 詳細 tab. Tested in `ui_flows.py`: 詳細 is opened while
  the request runs (desktop tab in `ai_prep`, compact side tab in `ai_edit`) and the review must be what shows.
- **Checking rows no longer rebuilds the review (§7.4).** `ai_review.patchReview` updates rows in place (checkbox, stale
  badge, `aria-describedby`) when only checks, stale marks or the try-on changed, and replaces just the counts and the
  buttons that depend on them; a review is rebuilt only when it is new, its rows differ, a look card opens or closes, or
  the lyrics change under a transcript (its [後ろに足す]). Text diffs are cached per `change.diff` object. Measured here
  (click → render → layout): 600 lines / 1200 rows 218 ms → 13 ms max; 2000 lines / 4000 rows 24 ms max. The stale
  badge is always rendered (hidden when not stale); stale ids and focus keys carry the list index (the three looks share
  change ids such as `theme`, which gave duplicate DOM ids).
- **Nothing is lost without [捨てる] (§6.4.10.5/7).** With nothing checked the try-on strip offers only [やめる]; a
  commit with nothing to apply keeps the review open (toast 「反映できる変更はありませんでした」), and a batch the store
  refuses brings the review back. The card's [試写をやめる] stays enabled with nothing checked.
- **Consent card states the real rate (§4.22.6).** `ai.consent` has a `{khz}` placeholder (ja and en); `consentFacts`
  returns `khz` from `ai/song.pickRate` (16, 12 or 8).
- **[元に戻す] counts what the user accepted (§6.4.10.8).** Log entries gain `groups` (additive, like `at`): for each
  applied change, the indices of the `applied` items it produced (a palette owns three pins; the lyric changes of one
  row share its item). The toast reports reverted and kept changes that add up to the entry's `n`; a change counts as
  kept when anything it produced was changed since (a re-pinned accent keeps the palette change, while its other two
  colours still go back). Entries without valid `groups` (older autosaves) still count items.
- **String keys are tested beyond literal `t()` calls.** `ui_ai.test.js` scans `ai/*.js` and `ui/ai_*.js` for key
  literals (`ai.ch.*`, `ai.warn.*`, `ai.song.*`, …) and checks the computed families (`ai.stage.*` from the new
  `ai_controller.STAGES`, `ai.name.*`/`ai.tool.*` from `TOOLS`, `ai.group.*`, `ai.guide.*` from `GUIDE_TOPICS`,
  `songSec.*`, `fld.season.*`, `fld.amount.*`, `kind.*`); a new computed family fails the test until it is listed. Every
  review the controller tests produce is also described with the strict ja and en tables.

## WP3 review fixes

Fixes to the reviewed WP3 findings. Where a bullet here contradicts the `## WP3` section, this one holds.

- **Recency reading (§4.16.4), replacing "Recency reads each neighbour's natural pick" of `## WP3`.** Every cut
  leaves, per choice slot, its *natural* pick (argmax without recency; for a rerolled cut, without its salts) and its
  *reference* pick (argmax with recency against the neighbours' natural picks; the same Gumbel noise). A cut weighs
  ×0.03 against the previous cut's natural and reference picks, ×0.5 against their families, ×0.35 against the natural
  picks of the 3 cuts before. Neither pick depends on anything but the 5 cuts before, so changes stay local, and the
  final value differs from the reference pick exactly where that would repeat the previous cut. Grounds, atmos and
  seams use the same reading over segments and boundaries. Measured (synthetic registry, corpus(8)): adjacent repeats
  of dwell/depart/lens/ornament#0 0.5 % (were 2.4 %; the literal final-value reading gives 0.2 % but lets a change run
  down the song: rerolls changed up to 12 other cuts); seams 0.4 %, grounds 0.6 %.
- **Locks are invisible to the history (§3.6).** A cut under lock pins records what it would choose without them (a
  silent pass with the pin index minus lock pins, `ctx.lockFree`); a lock-pinned seam records the boundary's unlocked
  decision. Locking any line of the corpus now changes nothing else (tested: every line of 2 seeds × 2 aspects × 4
  projects, with and without `/` marks, stub and synthetic registries: other cuts' slots, params, seams, grounds, times
  and `fp` identical). Trade-off: this reads "locked neighbours count as facts" of §4.16.4 as *user and AI pins count
  as facts*; after おまかせ a neighbour of a locked line weighs against what that line would pick unlocked, so it may
  repeat the locked value at the ordinary rate. Making the shown values facts too breaks the invariance again
  (measured: seams and replaced exits of the next line change).
- **For the lead (§9.4, FROZEN text; I did not edit DESIGN.md).** Proposed §4.16.4 recency line: "×0.03 if d.key is
  the previous cut's natural or reference pick of this slot; ×0.35 if it is the natural pick of one of the 3 cuts
  before that; ×0.5 if d.family is the family of either of the previous cut's picks (natural pick = argmax without
  recency and salts; reference pick = argmax with recency against natural picks; pins and rules count as both; lock
  pins count as the values the line would have unlocked)". Proposed §4.16.4 stability line: "inserting one line keeps
  ≥ 98 % of the other cuts' part choices on average; with line starts pinned at most 4 other cuts change in ≥ 95 % of
  insertions and never more than 6; rerolling one cut changes at most 3 other cuts in ≥ 99 % of cases, never more
  than 4". Measured: starts pinned 99.4 % kept (basic 97.4 %, vertical 97.2 %, lrc 97.9 %, long 99.8 %), worst 5, 4 of
  108 insertions > 4 (6 at most over 480); automatic timing 99.2 % (basic 96.3 %, vertical 95.8 %), worst 7 — every
  later line moves and its energy/position change, which is timing, not the chooser; rerolls worst 3 over 242, one 4
  over 720. `planner_stability.test.js` asserts these (per project and pooled, both timings) and prints them.
- **Scene fingerprints ignore where a value came from.** `fp` hashes each decision's `{ p, v }` only (the scene never
  reads `from`/`by`/`pfrom`, WP4a note), so pinning or locking a value as it is keeps the cut's scene. **WP4:** a part
  build must keep not reading them.
- **Focus role (§4.16.5).** A piece from a split pin or from `/` marks that is exactly the focus range gets the focus
  role by the same conditions and coin as an auto piece, so a role never depends on where the boundaries came from
  (locking or pinning the cut points of a line with an impact/emphasis piece used to turn `focus` into `lyric`).
- **Cutter span (§3.12 time order).** A line whose pinned end runs past the next line's start shares only
  `[t0, next start)` among its pieces (auto split decision and morae shares included); the last piece keeps the rest up
  to the pinned end. A `cut/<key>:t0` pin must lie before the next line's start too (else `pin-bad-value`). Tested
  with `/` pieces, auto pieces and random end pins over the corpus: cuts in time order, every seam at `B.a ≥ A.a`.
- **Atmos pins split segments like ground pins (§3.4.3, §4.16.6).** A segment starts where a cut's resolved ground
  pin *or* atmos pin differs from the previous cut's, so a cut or line atmos pin applies to exactly the cuts it covers.
- **Retired moods** (`pool: false`) are never auto-picked or offered as explain alternatives (`look.moodPool`);
  retired themes are not offered as alternatives either. A pin still chooses them.
- **Warnings of work pins** carry no `line`/`cut` (one warning per bad work pin, not one per cut).
- **FieldState below the selection (§4.16.8).** `inherited` only when the shared pin's scope is broader than the
  path's. When every covered cut is pinned at a narrower (or the same) scope: `pinned` / `ai` / `locked` with
  `pinnedAt` = that scope and `pinAt: null`; by different hands: `mixed`. **WP8:** `tagOf` shows 固定 for `pinned`
  whatever `pinnedAt` is; on a line page `pinnedAt: 'cut'` means 「カットで固定」 (and a line pin set there is shadowed by
  those cut pins).
- **lockPayload and motion: 'own'.** Entrance, hold and exit forced by an arrange with `motion: 'own'` (from `rule`)
  are not frozen (the arrange decides them; a lock pin on them could never apply); their parameters are.
- **Re-planning (§9.1 "plan(project_long) ≤ 10 ms", §7.4 "re-plan of 100 lines ≤ 5 ms").** `plan()` now reuses work
  of unchanged cuts across plans: casts keyed by everything a cast reads (look and seed, the pins at work/line/cut key,
  the salts under the cut and line, the skeleton, the features, the recency window and echo), features, cut
  encodings and fingerprints (keyed by object identity), the parsed sheet (by rows array, checked by content), and the
  cutter's text measures. The plan hash is streamed through FNV part by part (same number as `hashJSON`, no 380 KB
  string). Each cache keeps the last two plans; traced runs (explain) and `plan.run(doc, registry, { fresh: true })`
  use none. Cached decisions, features and element maps are frozen and shared between plans: nobody may mutate plan
  data (nobody does today). Measured in this shared container: project_long 6–8 ms after an edit (was 25–37 ms), a
  100-line document 6 ms after a slider edit, project_basic 1–2 ms; a plan whose cuts are all new (a new seed, the first
  plan) still 25–35 ms, so §9.1 holds for re-planning, not for a cold plan. Tests: re-planning after 160 random edits
  (pins, salts, seeds, locks, text, timing, filters, aspect, undo) equals the fresh plan; the speed test asserts the best
  of eight edit batches ≤ 20 ms (2 × the budget, like `perf.py`, §8.3) and a cold plan < 100 ms and prints both
  (with all planner test files running at once here: 12 ms and 46 ms).
- **Golden plan hashes** regenerated with the stub registry (`kind: 'stub'`, same version and shape) by a script doing
  exactly what `update_golden.js` does for plans: that script picks `parts/catalog`, which does not validate yet, and
  would also rewrite WP4's `frame_hashes.json`. `plan_basic.json` stays hand-written (see `## WP3`).
- **Scratch.** My probe scripts lived in a scratch folder (`.wp3tmp`); a checkpoint commit
  picked them up. I removed the folder at the end; **lead:** drop it from history if you squash.

## WP5a1

Catalog: compositions `parts/arrange/{core,columns,editorial,scatter,special}.js` (the 18 of §5.1 and the three special
roles) and holds `parts/dwell/{calm,lively}.js` (the 10 of §5.3); test `tests/node/arrange_dwell.test.js` (new file,
WP5a1's own: the §5 tables, traits, and the pictures conformance cannot see). Keys, labels, tags and fallbacks are the §5
tables verbatim (the test reads them from DESIGN.md). These are the readings and additions.

- **Params other packages already name are kept:** `pillarColumns` `cols anchor step rule` (§4.18.4, the §3.1 pins),
  `stairStep` `steps indent` (§3.12), `breathMark` `label` = `{ type: 'text', max: 40 }` (WP8b): `'heading'` (the auto)
  shows the section heading (the interlude cut's `note`), else ♪; `'none'` shows nothing; any other text as written.
- **Roles.** `titlePlate` title, `breathMark` interlude, `creditFold` outro; `pillarColumns`, `spineColumn` and
  `magazineHead` also serve title (title + artist fit their pictures). `stillHold` serves every role; `breathePulse` and
  `slowDrift` also title and outro; the other holds lyric/focus. So interlude cuts get `stillHold`, and `breathMark`
  breathes by itself (its own behaviour on its group). Special cut text as WP3 plans it: title/outro `text` = title
  (laid out as a span), `note` = artist; interlude `text` '' and `note` = heading. Any composition given a blank cut
  (the fallback, when filters leave nothing) shows the note or ♪.
- **Notes (`|note`, SPEC §3).** Every composition shows `cut.note` once, small (body face, plain style), where its
  picture has room; `tickerMarquee` (a moving strip) and `breathMark` (its label) do not.
- **Fills are paints, lines are shapes.** Bands, panels, cards, strips, the knockout slab, tag cards and grid paper are
  `sb.paint` nodes: `builder.fill` (an `el.text.fill` pin) recolours *every* shape of the text element, which would turn a
  band behind the words into the words' colour. Rules, threads, marks and grid lines stay shapes and follow the fill.
  `sb.paint` has no parent, so paint data carry the composition's offsets; a nudge still moves them (they are roots of the
  element). They are `animated: true` so the renderer never rasterizes them as full-frame static layers.
- **Decorations fade with the text** (entrance/exit windows, like `follow: 'text'` ornaments), through a behaviour in
  `PH.ORNAMENT` that reads the `times` object after the build has fitted it. Not `MOTION`/`REST`: the conformance identity
  and dwell checks look at those phases, and the host composition must not appear in them.
- **Layers.** Fills behind words sit on `mid`, so the previous cut's exiting text (drawn on `text`) stays above the next
  cut's panel during the overlap; echo copies are on `mid` too (behind the line, with a touch of parallax).
- **edgeBleed knockout.** A slab paint on `far` masked by `{ layer: 'text', invert: true }`, and the text layer
  `{ opacity: 0, isolate: true }`: `table.isIsolated` ignores opacity alone (§4.17.2 lists the isolating fields), so
  `isolate` is needed or the words would draw over their own holes. Consequence **for WP5b**: in a knockout cut, nodes of
  this scene on `text` are invisible and nodes on `far` are masked; ornaments are safe on `near` and `mid`.
- **tickerMarquee** (`motion: 'own'`): copies of the line with `RunSpec.move`, separators parented to their copy (so they
  scroll with it), and its own fade over the first and last 0.3 s of the window; at most 200 glyphs of copies.
- **sidebarIndex number.** The cut plan has no line index (§3.12), and a build may not read the absolute time or key
  (WP3 fingerprint note), so the "line number" is a text param whose function auto is the cut's position in the song
  (`feat.pos`, covered by the fingerprint) as a two-digit percentage. It can be pinned to any number.
- **text.scale** multiplies the composition's size. Where a composition places several boxes from its size (columns,
  stairs, confetti, tags, halo, grid, giant, echo, headline, title), a scale above 1 may pass the part's own size cap but
  never the frame's limit. Tested for 0.5 and 2 in 16:9 and 9:16, h and v: every glyph stays in the frame.
- **Line counts** come from `text.columns` (the phrase pieces the layout will also find); a split leaving a lone word on
  its own line is rejected, and the chosen count is the run's `maxLines`, so a line a little wider than its cells
  shrinks instead of breaking unevenly (「はじまりの／朝」 no longer happens).
- **confettiWords**: words flowed in reading order, then each turned and nudged inside its own flow cell (the slot plus
  half the gap to each neighbour), so words never overlap (tested over seeds and aspects); long words turn less. Sizes
  are scanned from the top down: a greedy flow is not monotone in size, so bisection found sizes half as large.
- **hangingTags**: one row, or two tiers when one row would make the type small (even tags high, odd tags hanging in
  the gaps, so every thread passes between the upper tags). Vertical tags (tanzaku) read right to left.
- **gridMosaic**: one run per cell (vertical cells use the vertical rules per glyph); 1–2 ASCII digits share a cell, as
  tate-chu-yoko numbers do. **haloRing** is horizontal only; its glyph units are the same.
- **Holds** wrap `K.perGlyphHold` to pass the hold window (`rest`, `out`), the reading axis, the scene seed and the block
  size in the params the function sees. Block motions (breathe, sway, beat pulse) move each glyph about the focus
  centre with `g.cx/g.cy`, so the block moves as one piece; the offsets are applied in each glyph's parent frame (exact
  for upright runs, a small approximation on the turned runs of slantBand, tiltedCard and confetti). `flickerLight` dips
  are sin² pulses on a fixed tick (≤ 12 Hz), `thumpSwell` releases before the next beat (no scale jump; 2 Hz without a
  grid; `needs: ['beats']`, `fits` ≈ 0 without a beat), `slowDrift` is a half sine over the hold (it settles back before
  the exit), `stillHold` makes no behaviour at all.
- **Checked by eye** with `contact_sheet.py` and a scratch preview (roles, notes, emphasis, params) in all 7 aspects,
  h and v, ja / en / mixed / vertical-punctuation texts, 8 themes (light and dark), knockout, and once with the real
  Google Fonts faces. `parts_gallery.py` (catalog): 101 parts × 7 aspects × 2 times OK, 0 CSP violations. Full
  conformance matrix for the 31 parts: pass, about 13 s.
- **Keys are forever (§7.1.9):** these 31 keys ship with this package.
- **Strings wanted:** none (labels, blurbs, param labels and the `number` auto's `why` live in the definitions).

## WP5b1

Catalog: backgrounds and decorations. `parts/ground/{plain,sky,light,paper,season,photo}.js` (18 grounds),
`parts/ornament/{frame,mark,digital,atmos,season}.js` (22 decorations: 15 per cut, 7 atmospheres with `scope: 'run'`);
tests `tests/node/parts_world.test.js` (new) and `tests/browser/ground_contrast.py` (new). Keys, labels, tags, scopes,
seasons, `(fb)` and `pool false` are the §5.5/§5.6 tables verbatim (read from DESIGN.md at test time). Frozen formats are
kept; these are the readings and decisions.

- **"Never fight the text" is measured, not assumed.** Every colour a background paints is a tint of the ground made by
  a small `readable()` helper: OKLab mix toward the wanted colour (`K.color.mix`), backed off until the ink keeps WCAG
  contrast ≥ 5.5 on the ground's side of the ink and the accent keeps ≥ 72 % of its own contrast with the ground.
  Brighter things (bokeh, glows, halftone dots, leaves, glints) may go to 3.2 but are then dimmed by a `calm()` factor in
  the middle of the frame, where lyrics usually sit; hairlines (snow crests) may go to 1.8. `ground_contrast.py` renders
  every ground × all 16 themes × 16:9/9:16 × 3 times through the real renderer with the text hidden, averages 32-du
  blocks and requires: safe area ink ≥ 3.0, centre ink ≥ 4.5, centre accent ≥ 60 % of the theme's accent/ground
  contrast. All 1,728 renders pass (worst safe-area block 4.0, worst centre block 6.1).
- **Kit gap (for WP4 / §9.4, not blocking).** Parts may depend only on the kit, whose `color` has `mix` and `rgba` but no
  contrast, so the ~20-line `readable()` helper is repeated in each ground file. A `K.color.contrast` (or `readable`)
  would remove the copies.
- **Grounds read nothing of their segment's cuts** (`env.cut`, `env.feat`, `env.role`): the segment fingerprint does not
  cover them (WP4a review note, INT-PLAN). Tested: changing the first cut's text, role and features leaves every ground
  and atmosphere frame identical. They read only the palette, design size, `env.times.b` (segment length), `env.rng`,
  and `env.level` (neonHaze, `needs: ['level']`).
- **Decorations read only what the cut fingerprint covers.** `barCode` prints the line's sung start (`cut.t0`); it has
  `needs: ['level']`, so the fingerprint covers the absolute window, and its bars genuinely shrink when the song is quiet.
  `serialMark` follows the WP5a1 `sidebarIndex` decision: its `number` is a text param whose function auto is the line's
  place in the song (`feat.pos` as two digits), pinnable to the real row number (the Plan cut has no line index and a
  build may not read the line id). `underSweep` sweeps as the emphasized word is sung (its share of the characters ×
  `feat.dur`).
- **No glyph positions for decorations.** Ornaments get `hints.focus` / `hints.free` only, so `underSweep` places its
  bar under the emphasis by the emphasis's share of the characters along the block (exact for one line; approximate for
  several lines or columns). It already uses an additive `hints.emph` box when the engine provides one — **WP4:** an
  `emph` box (union of the emphasized glyphs) in the ornament hints would make it exact.
- **ShapeSpec ellipses join the previous point.** `E` replays as `ctx.ellipse`, which (canvas semantics) draws a line
  from the current point to the ellipse start. Paths with several dots must `M` to `(cx + rx, cy)` before each `E` (done
  here, `dot()` helper). **WP4:** `replayShape` could do that moveTo itself.
- **`count` is a reserved ornament (and filter) param name** (registry): `inkSplat` uses `splashes`.
- **Roles.** Every per-cut decoration serves `lyric` and `focus`; frame-like ones also serve `title` and `outro`
  (hairFrame, bigBrackets, cornerTicks, orbitRing, hankoSeal, sunBurst; crossHair `title`). None serves `interlude`
  (its text is empty). `orbitRing` has `traits.cells [1, 14]` (a ring round a long line would cross it).
- **Motion of decorations** is raw ORNAMENT-phase behaviours over multi-node groups (§4.18.3 allows it; for WP4 review):
  grow along one axis (hairFrame sides draw themselves and retract; crossHair arms in eight steps), slide + fade
  (bigBrackets), settle with overshoot (cornerTicks, tapeStrip, orbitRing), orbit (orbitRing dots), stamp (hankoSeal
  lands at the end of the entrance), burst (inkSplat at the sung start), sweep (underSweep), turn-in (register marks),
  type-on (serialMark digits), loudness bars (barCode). All are module-level functions, allocation-free, pure in t.
  Paint-based ones (ripplePath, sunBurst, sparkSpray, pinDotBoard lights, every atmosphere) are closed-form in t; particles
  only in snowDust (engine particle field). `follow: 'own'` where the part animates its own entrance/exit.
- **Vertical text.** Decorations read `env.orient`: bigBrackets become ﹁﹂ (top right, bottom left), underSweep becomes a
  side line on the right (傍線), ripplePath runs down the right side, hankoSeal goes under the last column, sparks fly
  from the column ends.
- **Seasonal atmospheres** use the season's own colours (cherry pink, maple reds, firefly yellow-green, snow white or a
  cool grey on light grounds); their shared `ink` tints them (auto: accent; snow: ink), so the inspector's colour field
  does something.
- **photoPan** has a text param `image` (an asset id, `ai: false`). Without one it is a plain ground; with one, an image
  node covers the bleed plus the pan travel, zooms 1 → 1 + zoom and drifts along `pan` over the segment (closed form),
  under a ground-coloured veil for readability. Boot passes `assets: null` today, so it only shows when an asset store
  and a pin supply both.
- **Static rasters.** flatFill, gridPaper, maplePaper, the washi paper, the snowbanks, neonHaze's scan lines and
  photoPan's base and veil are `animated: false` paints (drawn once per output size, then moved by the camera). Tested:
  ≤ 16 gradients per frame (§7.2) and ≤ 9,000 drawing calls per frame for every part.
- **Frame time** (headless Chromium here: software raster, no GPU; 1280×720, text included, median): flat/paper/grid
  grounds and every decoration 3.6–5 ms (the fallback cut alone is 3.8 ms), sunBurst 9, heatShimmer/skyGrade/petalWash
  9–10, inkWash 9, halftoneSun 11, fogNoise 13, auroraVeil 14–18 ms. The expensive part is large gradient fills, which a
  GPU canvas does cheaply; `perf.py` on real Chrome is the judge (§7.4).
- **Checked by eye** with `contact_sheet.py` and full-size renders in light and dark themes (sumiWashi, sodaFloat,
  frostGlass, sakuraFog; nightTram, emberGlow, tidePool, snowLantern, mapleInk), 16:9 and 9:16, vertical text, and the
  black and chroma backdrops. `parts_gallery.py`: OK, 0 CSP violations. Full conformance matrix for the 40 parts: pass
  (about 18 s).
- **Seen in the whole suite, not caused by these parts:** `catalog.test.js` "part modules under parts/<kind>/…" (5a2's
  `typeErase` in the arrive directory, see ## WP5a2), and, only while other packages' tests load the 4 CPUs, the
  conformance build-time budget of a few text parts (they pass when run alone).
- **Keys are forever (§7.1.9):** these 40 keys ship with this package.
- **Strings wanted:** none (labels, blurbs, param labels and the `number` auto's `why` live in the definitions).

## INT-UI

Integration prep, UI side: `ui/output.js` (new, pure), edits in `ui/{boot,fields,inspector,widgets,part_browser,stage,
step_export,step_song,steps,timeline,palette}.js`, `ui/style.css`, `i18n/strings.js`; tests `ui_output.test.js` (new),
`ui_fields.test.js`, `i18n.test.js`, `ui_flows.py`, `ui_layout.py`, `transparent_check.py` (new). These are the readings
and changes; where they differ from the WP8a/b/c notes, these win.

- **Stand-ins are gone (§9.2).** Every module boot needs exists, so the STAND-INS section of `ui/boot.js` (≈ 1,300
  lines: reducer, catalog, planner helpers, engine, player, tap, samples) and the `STANDIN` export are deleted.
  `services()` is the §9.2 wiring with `MV.use`; a missing module fails at boot with its id, instead of a page that
  quietly runs on stand-ins. The app still needs a strict `parts/catalog` (WP5c note) to boot.
- **透過PNG ⇔ 透明 is one pair (SPEC §6 "transparent (PNG export)", §7; §3.2 `clear` "PNG export only").**
  `ui/output.formatCmds/backdropCmds` return the commands of one choice, dispatched as one undo entry, from step ④ and
  from 作品全体 › 背景の種類 alike: 透過PNG sets 透明; MP4 / PNG連番 turn 透明 back to 通常; 透明 turns the output into
  透過PNG; グリーンバック / 黒 / 通常 while 透過PNG keep a PNG sequence, now opaque (PNG連番), so the frames show that
  background. Reading of §6.4.3 「透明 only for PNG」: step ④ always offers 「透明（透過PNG）」 and choosing it switches the
  format, instead of a disabled option (one step instead of two; the inspector offers all four modes anyway). The
  inspector toasts 「書き出しの形式を「…」にしました」 when the format followed, since the format is not on its page. An
  older file with a mismatched pair gets a pre-flight item with a fix (`alpha-backdrop`, `clear-png`; the schedule's
  `clear-mp4` gains 透過PNGにする).
- **The preview shows what the export renders.** The stage passes `opts.backdrop = export/schedule.backdropFor(format,
  backdrop)` (§4.19.2 override), so MP4 + 透明 previews the normal background (with the `clear-mp4` warning) and
  透過PNG previews a cleared frame. A cleared frame is shown over a mid-grey checkerboard (`.canvas-wrap[data-backdrop=
  "clear"]`, CSS only, CSP-safe), in fullscreen too, never over black that could pass for part of the video.
- **Screen effects per backdrop (§4.19.4, §6.4.8)** use `engine/scene/frame.filterAllowed`, the renderer's own rule:
  a skipped `filter#i` is greyed in the 並び list with 「背景「…」では使われません」, its 種類 row says so under the row, the
  part browser dims it with a 使われない badge, 画面効果 pages state the mode's rule and list the effects of that scope it
  leaves out, 背景 pages say the background part is not drawn, and step ④ has an info item (`fx-skipped`) naming the
  effects the export leaves out.
- **Step ④ export (§4.21).** The export forks an engine planned from the committed document (`fork().setDoc(app.doc)`):
  before, a fork taken during a try-on or the B compare exported the try-on's look. Showing ④ asks the FontBook for the
  faces of the export range (`engine.fontUsage` + `fonts.ready`); `fontsReady` for the pre-flight comes from the
  FontBook states, so 書体を読み込み中 shows only while faces load. Every `font-fallback` item is folded into one line
  that names each family. Fix and jump links sit on their own row under the item text. Export failures show a message
  per ExportError code (`ui/output.errorKey`: codec, sink, range, no plan) instead of one generic text.
- **Step ② song (§4.13, §6.11).** One song loads at a time: a newer file (or the new [中止] during analysis) aborts the
  analysis of the one still loading (`analyzeBuffer` signal), and a replaced or cancelled load never reaches the
  document (toast 「曲の読み込みを中止しました」 for [中止]). The loading row is built once per file and updated in place, so
  [中止] survives the progress updates. The footer reads 「曲なしで次へ」 while there is no song (§6.11).
- **Pins of a cut whose pins live under an older key (§4.10.4) — a bug fix.** After a text edit moves a cut's offset,
  its pins stay under the old key (plan cut `pinKey`). The UI wrote new pins at the displayed key, which wins step 1 of
  the reattachment and orphaned every older pin of that cut, lock pins included (`ui_fields.test.js` shows it with the
  real planner). New pure helpers in `ui/fields`: `writePath(path, plan)`, `writeScope(scope, plan)`, `pinCmd(path, v,
  plan, pinSig, by)` (sig = the displayed cut's text), and `clearPathsFor` now also returns the stored path, so × / Del /
  the tag clear it. Used by the inspector (fields, list slots, hide, [固定 n ▾] counts, pinned-parameter rows), the
  stage drag (`el.text.nudge`), the timeline (`t0` drags), the palette (`#kind` pins) and paste look (`pin.copy` targets
  and source).
- **Lock and scope details (§3.6, §4.16.8, §6.4.4–§6.4.7).** A value every cut of a line pins at cut scope reads
  「カットで固定」 on the line page (WP3 review note; `tagOf` read only `state`); likewise 「行で固定」 on a work-scope element
  page. Setting a value at line or work scope that cut pins of the same slot still override says so once per field with
  the promote toast 「nカットは個別の固定を保持」. The several-lines page disables [振り直す] while a selected line is locked
  and redraws its buttons after [ロック] (the label toggles). `lockPayload` gets `{ registry }` from the L key too.
- **Strings.** Added `warn.part-error` (WP4a) and the INT-UI keys (backdrop rules, fixes, errors, song cancel,
  曲なしで次へ); removed `exp.notReady` and `insp.clearSkips` (their code paths are gone). `i18n.test.js` now reads every
  "## strings wanted" table of this file at test time (so a table row in the `` | `key` | `` form is enough to be
  checked), takes the AI codes from `ai/providers.ERROR_CODES` (`recitation` is covered), adds `part-error` to the
  warning codes, and checks registry labels on a lenient catalog while the strict one does not build yet.
- **Tests.** `ui_output.test.js` (6): the pair stays consistent from all 12 states for every choice; preview = export
  backdrop; the §4.19.4 table; usedFilters / skippedFilters; the UI pre-flight items and their fixes (applied through
  `core/commands`); font folding; every error code has a message. `ui_fields.test.js` (+2): writePath / pinCmd /
  clearPathsFor, and with the real planner that pinCmd keeps an older key's pins attached while the naive write orphans
  them. `ui_flows.py` (+3 flows, 17 in all): `output` (透過PNG ⇔ 透明 as one undo entry, 透明 always offered, a skipped
  effect greyed in the list, under its row and in the part browser, 背景の種類 黒 → PNG連番 with the toast, a 3-frame PNG
  export through step ④), `cutkeys` (the inspector writes and × clears under the older key; nothing orphaned), `song`
  (a newer file wins, [中止] stays one button and changes nothing, 曲なしで次へ). `values` and `pin` pick another part tile
  or, when the kind has one part, the current one (`OTHER_TILE`). `ui_layout.py` gains `--root` and step ④ with its
  longest pre-flight items (透過PNG leaving an effect out; MP4 + 透明) at the four 詳しく viewports.
- **`transparent_check.py` (new).** Exports from step ④ of the real page (memory sink: File System Access is hidden)
  two 720p frames of project_basic in the middle of a lyric cut that is alone on screen, with decorations, effects,
  texture, atmosphere, flash and shake pinned off, the fallback composition and motions, text ×1.6 and one ink
  (`work:el.text.fill` #F2C230), and decodes the PNGs with its own stdlib decoder (all five filters; checked against
  PIL): 透過PNG → RGBA, corners a = 0, ≥ 200 glyph pixels 2 px inside an edge at a = 255, every ring pixel with
  48 ≤ a < 255 un-premultiplies to the ink within 3 + 255/(2a) (8-bit premultiplied rounding), none far from it; glow →
  the band 3–8 px around the plain glyph mask is partly transparent (≥ 60 %, a = 255 ≤ 1 %); グリーンバック → PNG連番, corners
  exactly #00B140; 黒 (ink pin removed) → corners #000000, no coloured pixel, white glyphs. A mutation check (colours
  stored premultiplied; an opaque halo) fails the ring and halo assertions. About 3–4 s here.
- **How it was run.** The tree's page does not boot while the catalog is incomplete, so the browser tests ran on a
  staging copy: `parts/catalog` lenient, stub fallback parts (`tests/fixtures/stub_parts.js`) only for kinds without a
  fallback (at the last run: seam), and a package whose working copy failed the lint at that moment (planner) taken from
  HEAD. There: `ui_flows.py` 17 flows OK (first-run MP4 skipped: no H.264 here), `ui_layout.py --quick` 90 layouts OK,
  `transparent_check.py` OK, 0 CSP violations. Every test takes `--root` and runs unchanged on the tree once the catalog
  validates. Node: `i18n`, `ui_*` 109 tests pass; `build.py --check` is clean for these files.
- **Strings wanted:** none (UI package; the keys are in `i18n/strings.js`).

## WP5b2

Catalog: cameras `parts/lens/{still,glide,kick}.js` (10), screen effects `parts/filter/{flash,glitch,glow,film,print,
frame,trail}.js` (16), transitions `parts/seam/{soft,wipe,burst}.js` (11); tests `tests/node/lens_filter_seam.test.js`
(new) and `tests/browser/fx_parts.py` (new). Keys, labels, tags, stages, scopes, replace rules, `(fb)`, the texture list
and the table notes (gates, trait impact, needs) are the §5.7–§5.9 tables verbatim (read from DESIGN.md at test time).
With these parts every kind has its fallback: strict `parts/catalog.defaultRegistry()` validates. These are the readings,
additions and requests.

- **Seams leave the old cut on screen after their window — for WP3 (major, visible in every planned video).** A seam
  window ends at `at + dur/2`, but the old cut A stays in `FrameGraph.cuts` until `A.b = B.t0 + tail`, i.e. 0.12 + 0.25 s
  after `B.a`. After the window the renderer draws A again in the ordinary way: with `replaces.depart` (instantHide has no
  behaviour) A's words pop back at full strength over the new world for up to `lead + tail − dur/2`; without it A reappears
  mid-exit although the transition had removed it. Seen on project_basic (irisGate, swishCut, sumiSeep …) and on the sample
  plans. My transitions are complete by contract (a at u = 0, b at u = 1; `fx_parts.py` checks it on pixels), so they
  cannot hide this. Proposed fix in `planner/tracks.seams` (stage 6, before `fp`): for every seam that is not the hard
  cut, `A.b = min(A.b, at + dur/2)` (A's exit is then fitted to end with the seam, and a replaced exit simply ends there).
  A renderer-side alternative (skip a seam's `aCuts` after its window) would leave non-replaced exits cut off mid-way.
- **FxContext has no palette — for WP4 (§4.18.11, additive).** `duoTone` must map the frame to "ground and accent", and a
  filter only sees pixels. It reads `fx.pal` (the frame palette after §4.19.4, as the draw context has it) when present;
  without it the token inks fall back to a neutral indigo-and-cream print pair (so on a dark theme the ground turns
  indigo). Please add `fx.pal` in `createFx` (`frame()` from `dc.pal`); the Node test already covers the palette path.
- **Amounts.** Cameras: `0.5 + amount` scales the authored move (the §4.18.10 example's scale). Filters: amount 0 is off —
  src comes back and no surface is taken (tested for all 16, with impulses and on impact cuts), and every look scales
  with amount, so the post stack's `when` weighting fades every filter. `cinemaBars` bar height = `size` × the frame's
  short side at amount 0.5 (a 9:16 frame gets bands, not a third of its height in black).
- **`when` for the flash effects (flashPop, invertBlink), consistent with WP6's pre-flight count.** 'arrive' → the sung
  start, 'depart' → the sung end, 'beat' → every beat, 'always'/'impact' → impact cuts: the plan's `flash` impulses lead
  (so `reduceFlash` dims them in the preview), and an impact cut without an impulse (amount.flash was 0) flashes on its
  own start. Their shared `when` auto is a function auto: `impact` on impact cuts, else `arrive` (a pinned flashPop on a
  plain line flashes when the line starts). `fits` ×0.25 off impact cuts. invertBlink blinks on alternate ticks of
  `rate` counted from the event, `blinks` times.
- **Gates beyond the table:** flashPop, invertBlink and whiteFlash `gate: 'flash'`, glitchSwap `gate: 'glitch'` (SPEC §6:
  moods set effect amounts; a mood with flash 0 never flashes, blinks or flash-cuts). Table gates kept (chromaSlip
  chroma, sliceGlitch glitch). Other `fits`: beatZoom 0 without a beat grid (the example), impactKick ×0.25 off impact
  cuts, cinemaBars ×0.1 under compositions that set words against the top or bottom edge (cornerNote, hangingTags,
  tickerMarquee).
- **Roles.** Calm cameras (fixedFrame, slowPush, dollyOut, driftFloat; parallaxOrbit also title/outro; beatZoom also
  interlude) and every effect except chromaSlip, sliceGlitch, flashPop, invertBlink and afterImage serve title, interlude
  and outro cuts too. hardCut stays in the pool (the table does not mark it `pool false`; the planner lists hard-cut
  boundaries as no seam anyway).
- **Cameras** run over the cut's whole window, closed form, allocation-free, no per-build closures: push/pull zoom about
  the text block's centre (`aim`, so off-centre words stay put), drift/pan pass the rest position mid-window, orbit swings
  and counter-rolls (layers slide by parallax), rollSway starts level, handHeld is two octaves of value noise (seeded by
  `env.rng`), beatZoom reads the grid's period/offset directly (no `beatAt` allocation; 0.5 s pulses without a grid,
  bar accent), impactKick pulls back 0.12 s before the sung start, punches in within 35 ms and shakes (`jx/jy`).
- **Filters and seams always return a new surface** from `fx.take()`, never draw into `src`/`a`/`b` in place: under the
  adaptive preview's half-resolution pass an in-place draw on the scaled copy would be lost, and returning `src` means
  "no-op" (§4.18.2). `passes` counts full-frame draws. Tick-based looks (grain, dust, slice glitch) are evaluated at the
  start of the tick, so they hold still between ticks (tested). Texture filters handle `fx.cut === null`.
- **Pooled surfaces keep line state — for WP4.** `surface.resetState` resets transform, alpha, blend, smoothing and
  filter, but not `lineCap`/`lineJoin`/`lineDash`/`lineWidth`/styles. My strokes set all of it (`lineState()`); before
  that, `determinism.py --parts catalog` failed on project_basic (dust hairs inherited another frame's caps). Resetting
  line state in `resetState` would make every part safe.
- **alphaSafe** only for sliceGlitch (moves bands, no inverted bands in a transparent frame) and afterImage (copies of the
  text layers). `fx_parts.py`: an empty transparent frame stays empty through both.
- **Speed on software canvases.** Headless Chromium here has no GPU; blend-mode pattern fills, stretched draws and big
  gradients cost 2–8 ms each at 720p. Textures therefore cover the frame with `drawImage` tiles at whole-number (or ½)
  scales instead of pattern fills (paperTooth 37 → 17 ms at 1080p), light leaks are painted at ¼ size and the bloom mask
  at ½ size. Best-of-3 per call at 1920×1080 here: glowSpill 23, duoTone 22, amberSpill 19, paperTooth 18, chromaSlip 17,
  softVeil 12, afterImage 8, grain/dots 5–6, the rest ≤ 4 ms; transitions sumiSeep 30, plungeZoom 18, swishCut 17,
  blendDissolve 11, the rest ≤ 4. `perf.py --parts catalog` (720p, export quality, no adaptation) fails here for
  vertical (p50 24 ms: paperTooth texture + glowSpill) and long (p50 18 ms: paperTooth + dotScreen); basic and lrc pass.
  Real Chrome with a GPU is the judge (§7.4); the adaptive preview halves cost ≥ 3 effects.
- **Param names:** dustSpecks uses `specks` (`count` is reserved for filters).
- **For WP4 (thumbnails):** `samplePlan` shows a filter with `when: 'always'` on a plain cut without impulses, so the part
  browser shows flashPop, invertBlink (and the impactKick camera) doing nothing. A sample cut marked impact with a
  `flash`/`slip` impulse at its start, and a thumbnail time just after it, would show them.
- **For WP4/WP6 (reduceFlash):** only `fx.impulse('flash')` is dimmed; flashes flashPop draws for 'arrive'/'depart'/
  'beat', invertBlink and the whiteFlash seam are not. An `fx.flashScale` (or dimming those parts' amount) would cover them.
- **Tests.** `lens_filter_seam.test.js` (20 tests, ~2 s): the tables, notes and texture list; blurbs; roles; each camera's
  track over time (monotone push, text held in place, pan/orbit centred, handHeld smooth and small, beat peaks and decay,
  kick shape); every filter off at amount 0 and visible at 0.7; tick stability; flash/blink events; chromaSlip covering
  the frame; duoTone reading `fx.pal`; alpha-safe filters never filling; hardCut = both layers; world transitions from a
  to b. `fx_parts.py` (browser, ~40 s): pixel checks of every transition (a at 0, b at 1, neither at 0.5) and filter (off
  at 0, changes at 0.7, alpha-safe keeps empty frames empty) through the renderer's own FxContext, plus timings. **For
  CI (WP0):** please add `python3 tests/browser/fx_parts.py` to the browser steps. Full conformance matrix for the 37
  parts: pass (~5 s); `parts_gallery.py --parts catalog`: 173 parts × 7 aspects OK; `determinism.py --parts catalog` OK.
- **Checked by eye** with `contact_sheet.py` and scratch sheets (impact cuts, impulses, two grounds per world seam, planned
  projects) in light and dark themes (sumiWashi, sodaFloat, cicadaNoon, nightTram, emberGlow), 16:9 and 9:16.
- **Seen in the whole suite, not caused by these parts:** `catalog.test.js` "part modules under parts/<kind>/…" (WP5a2's
  `typeErase`), and under full-suite load the conformance build budget of `arrange/hangingTags` (passes alone). The
  catalog is now complete: `tests/golden/plan_hashes.json` / `frame_hashes.json` can be regenerated on purpose
  (`node tests/update_golden.js`; not done here, those files are not mine).
- **Keys are forever (§7.1.9):** these 37 keys ship with this package.
- **Strings wanted:** none (labels, blurbs, param labels and the `when` auto's `why` live in the definitions).

## INT-UI review fixes

All five findings fixed (none declined). Files: `ui/{stage,step_export,boot,inspector,timeline}.js`, `ui/style.css`,
`i18n/strings.js`; tests `ui_flows.py`, `ui_layout.py`.

- **The preview draws `view.highlight` (§6.4.10.6).** The stage overlay outlines every drawn box of the highlighted
  line in amber (#f0b64d), apart from the cuts the selection already outlines, also during a try-on; a `highlight`
  change invalidates the stage. So hovering a review row now shows its line on the preview, the lane and the timeline.
- **Step ④ says why there is no transparent video.** It shows one muted line under 背景, in every format: 「透明な動画は
  まだブラウザで作れません。透過PNGか、動画アプリ用はグリーンバックで。」 (`exp.alphaNote`). It sits inside the 背景 field,
  so the step keeps its 5 controls.
- **The large in-memory export confirmation lives in `app.exportStart`.** So Ctrl+K › 書き出す, keys and the button all
  ask first, and the button's own copy is gone. It is safe to await the dialog first: a `confirm` item exists only
  without File System Access, and then `openSink` shows no picker and needs no user activation. A `starting` guard keeps
  a second start out while the dialog or the save picker is open.
- **Step ④'s length and size come from `export/schedule.exportRange`,** as does the I–O chip, so a saved range longer
  than the video reads as the part the export renders.
- **Inspector paths that act on the shown pin now use the key it is stored under (§4.10.4):** [d] clears
  `row.clearPaths`, which is what × clears, then bumps the salt of the displayed cut (the planner reads salts by cut
  key). So on a pinned field [d] really is unpin + reroll (§6.7), and on the line page's 切り替え it also takes the line
  pin the row owns. ⋯ 範囲を広げる looks up and promotes the stored pin. The 自動 try-on clears what 自動に戻す clears.
  このカットに付け直す re-keys into `writeScope(target)`, so the target's older-key pins are no longer orphaned. Also
  (cheap, same bug class): the timeline draws a cut's `t0` edge as pinned when the pin sits under an older key.
- **Tests.** `ui_flows.py`:
  - `ai_prep`: the overlay has highlight-ink pixels while a row is hovered, and none before or after.
  - `output`: the note in MP4 and 透過PNG; the clamped summary and chip (range 2–600 s); a 2160p60 透過PNG in memory
    asks first from Ctrl+K and from the button, and declining starts nothing.
  - `cutkeys`: ⋯ 範囲を広げる is offered and moves the stored pin (then undone); the 自動 try-on previews the auto
    pick; [d] clears the stored pin, bumps `cut/<shown key>:arrive` and is one undo entry; a stray pin reattached
    next to an older key joins it and nothing is orphaned.

  `ui_layout.py` checks at the four step ④ viewports that the note is shown and not cut off. Mutation checks on a
  staging copy, one per fix (9 in all: no highlight; no note; no confirm; raw range; and the old reroll, menu lookup,
  try-on, reattach and promote): each fails its flow.
- **Run on the real tree** (the strict catalog boots now):
  - `ui_flows.py`: 17 flows OK (first-run MP4 skipped: no H.264 in this Chromium).
  - `ui_layout.py`: 300 layouts OK; `--quick`: 90 OK.
  - `transparent_check.py`: OK.
  - Node `ui_*` + `i18n`: 109 pass.
  - `build.py --check`: 173 modules OK.
- **Strings wanted:** none (`exp.alphaNote` is in `i18n/strings.js`).

## INT-PLAN

Integration prep on the planner side. Files: `planner/{plan,cast,choose,params,tracks,segment,look,fields,explain,features}.js`,
new `planner/encode.js`; `build.py` (layer rule only) and `tests/build_test.py`; tests `planner_determinism`, `planner_pins`,
`fields`. One scene-side change, marked `INT-PLAN` in `engine/scene/build.js` (below).

- **Faces (§4.16.3, §2.3).** `planner/look.faces` now calls `engine/text/faces.resolveFaces(theme, work pins, scripts used)`;
  the planner's own copy of the flavor/role tables is gone (and `planner/look` no longer exports `FLAVORS`; nobody used it).
  `build.py` lets L2 use `engine/text/breaker`, `vert` and `faces` (`PLANNER_TEXT`); `build_test.py` checks that planner →
  faces/vert pass and planner → any other `engine/text` module is refused. `plan.design.faces` holds the **served** weight
  (snapped to the family's weights, what the renderer draws); the inspector's weight field keeps showing the **request** (the
  pin, else the theme's role weight). **DESIGN change proposed (§2.3, FROZEN):** the L2 note should read "`engine/text/*` only
  for metric-free functions: `breaker`, `vert` classes, `faces.resolveFaces`". `resolveFaces` is pure data (no measuring, no
  fonts), so it is within the rule's intent.
- **Ground fingerprint (§3.12 `fp`, §4.16.6, §4.17.5).** A ground scene used to read its segment's first cut (text, features,
  role) while the segment's `fp` did not cover that cut, so a cached ground could be stale after an edit of the first line.
  Chosen fix: the ground scene reads no cut. **Scene-side change (WP4a file, marked `INT-PLAN`):** `buildGroundWith` builds
  with `cutText: ''`, `env.cut/feat/role = null` (the default text style) and `autoContext(plan, null)`. The planner's segment
  `fp` covers its ground and atmos decisions (with params), its span and the shared look, and not its cuts; its params were
  already resolved by the planner from the first cut (§4.16.6). **DESIGN change proposed (§4.17.5):** "buildGround: `env.cut`,
  `env.feat` and `env.role` are null." Tests: "a ground scene is the same whatever its first cut holds" (fails with the old
  `build.js`), "segment fingerprints: their decisions change them, the cuts in the segment do not"; the facade test
  "setDoc … changedGrounds []" passes.
- **lock-partial (§3.6, §4.10).** A locked line warns `lock-partial` when its cuts are no longer the frozen ones: the lock's
  split pin is gone or does not fit the text, a frozen piece was merged by the solver (`piece-merged`), or a cut of the line
  has no pin key. A split the user pinned (`by: 'user'`) is the user's choice and does not warn. Lock pins whose piece is gone
  are reported as `orphan-pin` only. Relocking (`lock.set` with `F.lockPayload`) clears the warning. Test in
  `planner_pins.test.js`.
- **Timing context (§4.11, §4.16.2 step 1).** `solveTimes` gets the tempo (the `bpm` slot: pin, `null` = none, else the song
  analysis), `beatOffset`, meter and beat grid, the `readRate` and `length` pins, and a 2 s title reservation. Fields: `readRate`
  shows the pin, else `clamp(bpm / 20, 3, 14)`, else 7 (through `core/timing`). `beatOffset` shows a pinned value even without
  beats. `explain` names the rule: amounts → mood; `bpm`/`beatOffset` → song; `readRate` → bpm (with beats) or its own rule;
  `length`/`titleCard` → their own rule; colors, faces, texture → theme. **Deviation from §4.11:** the 2 s reservation applies
  only when `titleCard` is pinned true **and** there is a title (`[ti:]`). With no title there is nothing to show, so the card
  is skipped with `title-skipped` (§4.16.5) and no time is reserved.
- **Performance (§7.4, §9.1).** `project_long` (120 lines, 245 cuts), CPU time, quiet machine, before → after. Stub parts:
  cold 26 → ~19 ms, re-plan after an edit 7.0 → ~4.6 ms. Synthetic registry (12–20 parts per kind): cold 35 → ~24 ms,
  re-plan 8.5 → ~5.0 ms. Full catalog: cold ~28 → ~27 ms, re-plan ~5.0 ms. Under full-suite load the speed test reads best
  5.5 ms and cold 23 ms. Its bounds are now best ≤ 10 ms (2 × the §7.4 budget) and cold < 60 ms (they were 20 and 100). What
  changed:
  - Canonical encoding moved to `planner/encode`. Plan objects are built with sorted keys, so `JSON.stringify` is the
    canonical text. Cut encodings are cached, and the plan hash is streamed with the unchanged prefix resumed.
  - Cast cache entries keep their inputs, compared by identity then content. Seam and segment decisions are memoized on the
    cast entries.
  - Per-cut slot-seed prefixes (`CH.slotPrefix`/`slotSeedAt`, equal to `hash32`).
  - Recency flags are computed once per pick with the same arithmetic.
  - Pools are indexed by kind; pin lookups are skipped for slots nobody pins (`PA.pinned`/`pinnedUnder`).
  - Stepped-number coercion answers are kept per spec and step index (`PA.coerceStepped`; a fuzz test compares it with
    `core/schema.coerce`).

  Every step was checked byte for byte against a baseline of 312 plans (stub and synthetic registries; seeds, salts, pins,
  locks, plus explain/fieldState digests). With the catalog, 48 plans cached = fresh, hash = hash of the JSON, and 384
  explain/fieldState answers agree. **Not met: §9.1 "plan() of project_long ≤ 10 ms"** for a plan whose every cut is new
  (~20–27 ms). Where the time goes: ~25k candidate weighings, ~5k parameter autos and ~400 KB of canonical text hashed. A
  re-plan after an edit (the §7.4 "≤ 5 ms") is about met. **DESIGN change proposed (§9.1):** read the 10 ms as the re-plan
  after an edit, or allow ≈ 30 ms for a cold plan (a new seed or first open; it happens once per おまかせ).
- **Goldens.** `tests/golden/plan_hashes.json` is the stub-registry set, the same as in HEAD (the speed work changed no
  hash). The catalog is complete now (strict `defaultRegistry` boots), so the lead can regenerate it on purpose with
  `node tests/update_golden.js`. That script also writes the frame hashes.
- **Seen, not mine:** `catalog.test.js` "part modules under parts/<kind>/…" fails on WP5a2's `typeErase` (a depart in
  `parts/arrive/digital`). Built pages (`index.html`, `en/index.html`, lab) were not rebuilt here.
- **For DESIGN/WP5c (not changed here, §4.16 does not exclude it):** the auto pool of `filter#i` includes the texture filters,
  so a cut can get the work texture again as an accent. With the catalog: 49 of 5,580 cuts in 60 plans of basic/long/vertical.
  Proposal: leave `texture: true` filters, or at least the current work texture, out of the auto `filter#i` pool.
- **Strings wanted:** none. The rule names in `explain` (`mood`, `song`, `bpm`, `theme`, …) are ids the UI may localize.

## WP4b review fixes

Fixes for the WP4b review (engine part 2). Where an entry here and the `## WP4b` section differ, this one holds.

- **Sprite keys (§4.19.5, §7.1.8).** A blurred sprite's key now includes its blur in raster px (1/8 px steps; it
  depends on the glyph's em in du), and the raster is drawn with exactly that quantized blur, so a raster is a function
  of its key: two same-grapheme glyphs of different em that land in one size bucket (emphasis, a `text.scale` drag,
  overlapping cuts) no longer share a raster whose blur suits only the first one drawn. Level-0 keys are unchanged.
  Keys are nested maps by the ink strings themselves (font → grapheme → ink → second ink → numeric code), so no
  session-long ink id is packed into a fixed-width number any more (they aliased after 4,096 colours); evictions drop
  emptied key maps.
- **Post compositing.** When the post stack runs, the caller's surface is filled with the backdrop (cleared for `clear`)
  before the result is drawn onto it, so what a filter leaves transparent shows the backdrop, never the previous frame
  (exports reuse one surface; thumbnails too).
- **Surface pool (§7.2, §7.3).** A new frame size releases the free surfaces of the previous size and its derived sizes
  (½, ¼, DPR 0.75); a surface still out when the size changes is dropped when it comes back. `stats().surfaces` is now
  the number of pooled surfaces alive (was: ever created); `stats().surfaceBytes` is added.
- **`fx.textAt` at half resolution.** When a `cost ≥ 3` filter runs at half size (adaptive level ≥ 1), its text copies
  are `fx.w × fx.h` surfaces drawn with the device matrix scaled by `fx.unit / unit`.
- **Text style `glow` is a style, not a pose.** The halo (the 8 du sprite in the accent ink, `lighter`, alpha 0.45 or the
  pose glow if larger) is always a sprite; the body takes the path its pose selects, so resting glow-styled text is on
  the direct path (no upscaled 512 px level-0 rasters at 1440p/2160p). Replaces "glow-styled text is always on the
  sprite path" in `## WP4b`. `prepare` warms the halo sprites.
- **Font usage (§4.14, §7.1.5).** What the facade asks the FontBook for now comes from what the scenes lay out: every
  glyph's face and grapheme (notes and artists in the body face, interlude headings, ornament text in any face) and
  glyph particles (`'glyph:<char>'`, display ja face). Before a scene is built, a cut counts with its text in its
  `text.face` role plus its note in the body role. A scene's usage is recorded per fingerprint (it depends only on it).
  `fontUsage(t0, t1)` = that estimate plus every scene built so far (it builds nothing). `prepare(…, { export: true })`
  builds each fingerprint of the range whose usage is unknown, awaits `fonts.ready` for the complete usage, then builds
  the range (a moved measurer key rebuilds). The preview asks for faces a built scene reveals (and again for failed
  faces, so the FontBook retries); a scene is provisional when any face it draws is idle/loading, and a cached
  provisional scene whose faces all settled under the same measurer key (they failed) is final again. `fork()` passes
  the usage it learned to the copy, so an export fork of a warmed preview builds almost nothing twice.
- **prepare() in slices (§4.19.2, §7.3, §7.4).** New additive option `createEngine({ idle })`: `() → Promise` that
  settles after the host could run other work; the host canvas factory now has `idle()` (`scheduler.yield`, else a
  message-channel task — not throttled like timers in a hidden tab) and the facade uses it when the option is absent,
  like `now`. The preview prepare yields every ~8 ms (export every ~40 ms) and stops at its next slice when a newer
  preview prepare starts or the plan changes. Without `idle` (Node, the recorder) the work runs at once as before.
  Measured (headless Chromium, catalog, `project_long` ±5 s windows): total 30–80 ms in 3–8 slices, longest slice
  9–14 ms (one scene build can overrun a slice); before, 65–155 ms in one task. **Declined:** laying out only the text
  for the warnings scan — that needs a layout-only entry point in `engine/scene/build` (WP4a); the scan's builds are
  spread over the slices instead.
- **Sample plans / lab.** `samplePlan` opts add `textScale` (the cut's `text.scale`). Lab `render` options add `fresh`,
  `level` (pins the adaptive level), `prefill` (a colour the surface holds before the frame), `textScale`, and it returns
  the pixel `hash`; `__lab.sequence({ …, steps })` renders steps in order on one fresh engine. `parity` and `blurSweep`
  pin level 0: with the catalog the sweep "jumped" at 4.25 du because the adaptive preview stepped down to draft paints
  mid-sweep (not a glyph problem).
- **Tests.** `facade.test.js` adds: mixed-em blurred sprites in both orders (op streams equal, raster keyed by blur),
  ink aliasing after 4,200 colours, post target filled/cleared first (scene/black/chroma/clear), a pool over 60 output
  sizes (≤ 10 surfaces, bytes bounded), `textAt` size and scale at level 1, glow style direct body + halo, font usage
  from scenes (body/serif text and glyph particles reach `fonts.ready`; the preview requests them; a fork inherits),
  sliced prepare (yields, same scenes and warnings as unsliced, an older prepare stops). All eight fail on the code
  before these fixes. A ninth checks that faces failing during the export wait leave final, not provisional, scenes. `determinism.py` and `glyph_parity.py` now run the catalog (what ships) and then the examples;
  determinism adds a red/blue prefill check over every filter and a mixed-em sprite order check (sizes and
  `text.scale` ±4/±8 %); both new checks fail on the old code.
- **Goldens.** `tests/golden/frame_hashes.json` written with `update_golden.js` (catalog registry `d088ca2e`, fake
  measurer; the version flipped between `d088ca2e` and `f226c243` while WP5a2 edited parts); a few frames of
  basic/vertical checked in the lab. `plan_hashes.json` was put back as it was: it already
  differs from the current planner and belongs to WP3/INT-PLAN. **Everyone:** `update_golden.js` rewrites both files;
  when the catalog registry version changes (WP5a2 is moving `typeErase`), `frame.test.js` fails with the registry
  message on purpose — check a few frames, then regenerate the frame goldens.
- **perf.py (catalog) — for WP5.** vertical p50 25 ms / long p50 19 ms, above twice the budget; the time is in post
  (17–23 ms per frame on average: the `paperTooth` texture on every frame, plus `glowSpill`), not in draw or behave.
  `tileCover` in `parts/filter/print.js` and `film.js` issues one `drawImage` per tile (≈ 60–80 at 720p for the fibre
  tile); one `createPattern` fill per layer should be much cheaper.
- **Strings wanted:** none.

## INT-PLAN review fixes

Files: `planner/segment.js`, `planner/plan.js`, `planner/cast.js`; tests in `planner_pins`, `planner_determinism`.

- **lock-partial when lock pins lose their piece (§3.6, §4.10.3).** `segment.checkLock` also warns when a key that
  `attachCuts` left as an orphan or shadowed holds a `by: 'lock'` pin. Example: `project_vertical` r6 (split `[0, 5]`)
  edited to 「影ぼうし」: the reducer trims the split to `[0]`, the second piece's lock pins move to `r6~4` and are
  orphans; the plan now says `lock-partial` as well as `orphan-pin`. Not reported: a split the user (or AI) pinned over
  the lock (the orphans are their choice; `orphan-pin` only), orphaned **user** pins, and a trimmed split whose lock pins
  all kept a piece (first piece deleted: the pins fold into `r6~0` by the reducer's collision rule).
- **For INT-UI (`ui/inspector.js relock`, not changed here):** [ロックし直す] keeps *every* lock pin under the line, the
  orphaned ones too, so after this fix the banner stays until those are removed (迷子の固定 [削除]). Proposed: keep only
  the lock pins of the keys the plan still attaches (`'cut/' + (cut.pinKey || cut.key)` for the line's cuts) plus the
  line's own lock pins; the orphaned lock pins are lost values anyway. The test simulates both.
- **Fingerprints (§3.12 fp).** One helper, `plan.songTerms`, for cut and ground fingerprints: when a chosen part needs
  `beats` and there is a tempo → `[bpm, meter, q6(origin − beat offset)]`; when it needs `level` and the plan has an
  envelope → `[q6(origin), digest id]`; else nothing, so a scene that reads neither keeps its fingerprint in time. The
  origin is what the scene builder uses: the cut's `t0`, the segment's `t0`. The beat phase alone was not enough: a ground
  kept its fingerprint across a tempo change (phase 0 at t0 = 0, offset 0), and `sparkSpray` counts beat indices
  (`beatAt(t).index % every`), which a whole-beat offset change flips at the same phase. **DESIGN change proposed
  (§3.12):** "plus the beat grid seen from the scene's origin (`bpm`, `meter`, origin − offset) when a chosen part
  declares `needs: ['beats']`, and the origin and the digest when one declares `needs: ['level']`". New test: pinned-time
  lines, a flat envelope and a pinned mood, so features and look stay put; cut and ground fingerprints change with the
  terms their parts need (shift, offset of one whole beat, envelope, tempo for grounds) and not with the others.
- **Cast cache (§7.1, determinism).** `sameRows` now compares the previous row's natural picks (`base`) too: the next
  cut's reference pick weighs against them. Two windows with the same `{X, Y}` but natural picks X vs Y were treated as
  equal. Unit test with `castCut`/`createHistory`/`historyRow` (now exported for it): the cache misses, the cast and its
  recorded row equal a fresh cast; it fails with the old field list. No measurable speed change.
- **Timing context test** now covers the meter: a song in 3/4 with snap `bar` moves an automatic start to the 1.5 s bar
  and leaves it in 4/4 (fails when the meter is dropped from the grid given to `solveTimes`).
- **Declined: §9.1 cold plan ≤ 10 ms.** Still ~23–30 ms cold, ~6 ms best re-plan on this (busier) machine; a flat profile.
  Getting a cold plan to 10 ms needs a cheaper chooser/parameter design, a DESIGN-level change. The proposal in
  `## INT-PLAN` stands for the lead to decide (read §9.1 as the re-plan budget, or allow ≈ 30 ms cold).
- **Seen, not mine:** `catalog.test.js` (typeErase under `parts/arrive/`) and `frame.test.js` goldens (catalog registry
  version changed by the part packages in flight) fail in the full run.

## WP5a2 review fixes

Files: `parts/depart/{burst,fall,type}.js` (type.js is new), `parts/arrive/digital.js`, `tests/node/parts_motion.test.js`.
Keys, params and autos are unchanged (registry version and plan hashes unaffected). This entry supersedes two statements
of `## WP5a2`: where `typeErase` lives, and the caret "Limitations" sentence.

- **Exits that aim at the frame (major).** A glyph's delta pose moves it in its run's frame; a composition may turn or
  scale that frame. `pointImplode`, `shardBurst`, `zoomPast`, `burnOut` (burst.js) and `dropAway`, `pileCollapse`,
  `meltDown` (fall.js) now get a per-glyph frame map at build (`p.frame`: cos, sin, scale of the similarity from the
  glyph's parent frame to the frame), and every frame vector goes through it: the pull to the focus point, "outward",
  "up" (burst lift, ember rise), "down" and the clearance below the frame, the pile landing (computed on the frame, each
  glyph stacked by its height on the frame at the turn it lands with), and the melt drip (the stretch runs along the
  glyph's own axis nearest the frame's down, from its edge nearest the frame's top). The map: a run with glyphs at two
  or more places → least-squares similarity of the local rest centres (target.x/y) onto the frame ones (wx/wy), exact;
  a one-glyph run → its `spec.rot` about its box centre inside a parent fitted over every glyph seen through its run's
  turn (exact when the runs share a parent, as haloRing's do, also under an `el.text.nudge` turn and scale), else an
  upright parent. Near-identity maps snap to the identity, so upright compositions move exactly as before. Assumed: no
  mirroring and no non-uniform scale above a run (the catalog has neither). Probe over every composition (except
  `motion: 'own'`) × h/v × 16:9, 9:16, 1:1 × ja, en, one glyph: 0 of 8,028 glyph checks off (before: 433, on haloRing,
  slantBand, confettiWords, tiltedCard).
- **For WP4 (additive request).** A per-glyph target field with the parent's rest world turn and scale (for example
  `target.pm`, the 2×2 linear part of the parent's rest world matrix per glyph) would replace the fit. Until then the
  helpers are copied in burst.js and fall.js (parts share code only through the kit).
- **Entrances stay text-relative (a reading, not an oversight).** dropSnap, rainDrop, ribbonWave and curtainRise move
  in the text's own frame: "from above" is above the glyph's own baseline, so on haloRing (tangent) glyphs drop onto the
  ring from outside. Only the exits whose pictures name the frame (§5.4: "out of the frame", "at the bottom", "into one
  point", "outward") use the frame map.
- **Caret and element pins (major).** typeOn/typeErase read `env.cut.els.text` (in the cut fp, so cache-safe): with
  `hide` no caret is made; with `fill` the caret takes that ink (accent otherwise).
- **typeErase moved to `parts/depart/type.js`** with its own erase-only copy of the caret code, so no deviation needs
  accepting. **WP5c:** `catalog.test.js` "part modules under parts/<kind>/…" now stops at `strobeOut`, a `K.mirror` of
  strobeIn that §4.18.7 requires next to its entrance, as are inkSink (soft.js), hingeClose, twirlDepart (flip.js),
  sliceHide, curtainFall (wipe.js). Please let `parts/arrive/` modules return `depart` definitions (the mirrors);
  `parts_motion.test.js` checks the precise rule (an arrive module holds entrances and only their six mirrors; every
  other exit lives under `parts/depart/`). If WP4 wants it, `K.mirror` could stamp `mirrorOf` so such a test needs no list.
- **Tint over a mosaic or strips (minor).** The renderer draws a tint (and echoes) as whole glyphs, not through the
  pixel/shard path, so: pixelStep has no tint while in blocks and a short accent flash (0.5, fading) once sharp;
  shardBurst flashes the accent over the first 8 % of its motion and only then cracks (shard 0 → 1 over the next 17 %),
  never both at once. Contact sheets re-rendered (pixelStep, strobeIn, staticJoin; all frame-aimed exits, typeErase).
- **Tests (`parts_motion.test.js`, 19 tests, < 1 s).** New or split: module placement (above); the six K.mirror exits'
  ease auto = `E.reverse` of the entrance's and dur/each autos carried (catches the kit's `mirror` patch.shared bug,
  still open for WP4, should a mirror be written the plain way); the caret under `el.text.hide` / `el.text.fill`
  (typeOn, typeErase); frame-aimed exits on the fallback, haloRing (tangent), slantBand, confettiWords, tiltedCard and a
  nudged (60°, ×1.3) layout in 16:9 and 9:16: implode ends at the point, drop away falls monotonically and leaves the
  frame, pile lies on the floor, burst and zoom move outward, burn rises, melt drips down; no tint/echo while pixelated
  or shattered (every pool entrance and exit); strobeIn/strobeOut flicker (strobe out ends dark); strobeIn, strobeOut,
  staticJoin give the same poses at i/30 and 2i/60 (60 fps in playback order, 30 fps reversed), a strobing glyph flips
  at most once inside a tick and a glitch keeps its draw for the whole tick; every pool entrance ends and every exit
  starts exactly at rest, glyph by glyph while the others move. The placement, caret-pin, frame-aimed and tint
  tests fail on the pre-fix parts; the mirror-ease test fails when strobeOut is written as a plain K.mirror with a
  `shared` patch.
- **Seen in the full run, not caused by these files:** the catalog test above (WP5c), and once the conformance build
  budget of `arrange/haloRing` (80 ms slowest > 60 ms under full-suite load; passes alone).

## WP5b1 review fixes

Files: `parts/ground/{season,plain}.js`, `parts/ornament/{season,frame,mark,digital}.js`, `tests/node/parts_world.test.js`.
These corrections replace the matching lines of ## WP5b1.

- **petalWash wrapped only y.** Its petals drifted right by 6 du/s without end, so on a long segment (a work-scope ground
  pin makes one segment of the whole song, §4.16.6) the left half emptied after a minute or two. x now wraps over the
  painted area plus a 40-du margin, like y. Positions are unchanged until a petal wraps, so short segments look the same.
  Every other drift in these files already wrapped.
- **fireworkBloom drew burst c only once floor(t / period) reached c**, so a shell whose launch began earlier appeared
  halfway up the frame. The bursts drawn at t are now exactly those with burstAt(c) in [t − LIFE, t + LAUNCH].
- **halftoneSun** at size 1.4 and spacing 8 (both allowed by its schema) drew about 24,800 dots (48,000 calls, 36–43 ms
  here against 8 ms for the auto params). The dot pitch is now at least R / 32, so at most about 3,200 dots. A finer
  pinned spacing applies only as far as that bound allows; the inspector still shows the pinned value. That heavy case
  now takes about 10 ms here (software raster).
- **Backdrop colours (§4.19.4).** The seasonal atmospheres mix their own colours at build time, so the frame palette of
  a backdrop mode never reached them. They now read the mode from the planner's palette (§4.16.3). Black means a black
  ground under white ink and accent, and every mixed colour becomes a grey of the same luma. Chroma means the ground is
  `#00B140`: no colour is derived from the ground (snowDust's cool flake starts from a neutral paper), no `lighter`
  blending onto the key (fireflyGlow, fireworkBloom), and the ink alone decides whether the theme is light. tapeStrip's
  highlight becomes a white sheen and hankoSeal's carving (inner ring, specks, character) a neutral paper (light under
  dark ink, dark under light ink). Both apply only in chroma; normal, clear and black modes keep the 'ground' token.
- **barCode deviation (§5.6 "the line's start time").** It prints `cut.t0`, the cut's sung start. On a line's first cut
  that is the line's start; later cuts of the line (`r3~4`) print their own start. The plan cut carries no line start
  (§3.12), and the cut fingerprint does not cover one. The blurb now reads 「小さなバーコードに、このカットの歌い出しの時刻」 /
  "A small barcode with the cut's start time printed under it". **For WP3, optional:** an additive `cut.lineT0`, covered
  by `fp`, would let it print the line's start.
- **Tests (`parts_world.test.js`, now 18, about 7 s).** Each new test fails on the pre-fix files:
  - Long segments: every ground and atmosphere, count params at their maximum, 16:9 and 9:16. Each half of the frame
    (left, right, top, bottom) must keep at least 0.6 × its item count minus 2 at 60 s and at 300 s. Items are subpath
    centroids and rectangle centres, found by replaying the recorded transforms.
  - fireworkBloom: 30 fps over a minute at rate 3.5. Every shell first appears at y ≥ 0.97 h.
  - Budgets at the heaviest pinnable params. A greedy search takes each number, bool or enum param to whichever end or
    option makes the most work, at 21:9. The limits are ≤ 9,000 animated calls per frame, ≤ 16 gradients, and ≤ 16,000
    calls per static raster. The closest cases are leafFall at 60 leaves (about 8,800 per frame) and maplePaper at 48
    leaves (about 10,300, drawn once).
  - Backdrops: every decoration uses the planner's own palette (`planner/look.palette`) for sumiWashi and nightTram. In
    black mode only greys may appear. In chroma no colour may fall within 40° of the key hue with a spread above 48,
    and nothing may use `lighter`.
  - barCode: with react 0, a later cut changes only the digits' ShapeSpec (the bars are identical), and moving the window
    does not change the digits. With react 1 the frames change with loudness.
- **For WP3 / DESIGN §4.16.3 (not changed here).** Chroma moves only ink and accent away from green. shiftA of
  sakuraFog, risoPink, mossStone and chalkBoard, and shiftB of cicadaNoon, stay within 40° of the key hue. Decorations
  that draw those tokens are then partly keyed: rainLines, bokehDots, fireworkBloom, tapeStrip, sparkSpray. Proposal:
  apply the same `awayFromGreen` to every token except the ground.
- **For WP4 (lab only).** `facade.samplePlan` accepts a backdrop but keeps the theme swatch as the palette, so lab
  contact sheets with `--backdrop black|chroma` do not show the §4.16.3 palette the app uses. Passing `palette:
  planner/look.palette(theme, pins.index({}), backdrop)` makes them match; the backdrop test above does this.
- **Goldens.** I rendered the 160 golden frames with the old and the new versions of these six files (everything else
  as in the tree): all identical. The golden test fails in the full run because of changes by other packages still in
  progress (arrange/dwell), not because of these files.
- **Seen in the full run, not caused by these files:** `catalog.test.js` "part modules under parts/<kind>/…"
  (`strobeOut` in `parts/arrive/digital`), and the golden frames above. Full suite: 970 of 972 pass.
- **Strings wanted:** none.

## WP5a1 review fixes

Files: `parts/arrange/{core,columns,editorial,scatter}.js`, `parts/dwell/{calm,lively}.js`,
`tests/node/arrange_dwell.test.js`. All nine findings fixed; none declined. These lines replace the matching ones of
`## WP5a1` (edgeBleed knockout, gridMosaic/haloRing units, holds).

- **Nothing is dropped (major).** gridMosaic, haloRing and confettiWords no longer cut their units at 64. Up to 64
  units they place one run per glyph (or word), as before. Past that: the grid sets one run per grid line, tracked so a
  full-width glyph keeps one cell each (Latin letters, which are narrower, sit closer and stay inside their line); the
  ring sets short tangent chords of neighbouring glyphs on their own slots (upright rings turn these chords too);
  confetti flows groups of neighbouring words. Sizes shrink to fit every unit, so a 700-character line on a ring is
  tiny but complete. The confetti size scan runs down to 0.98^400 instead of 0.98^140.
- **Graphemes (minor).** A line-break pair (a character plus the no-start mark kept with it) is split by graphemes, not
  code points: marks and variation selectors (U+20E3 included), ZWJ sequences, skin tones, tag sequences, flags and
  Hangul jamo stay whole (a local splitter; parts have no segmenter).
- **echoStack fits the whole stack (major).** Across the line: the block plus every step (`gap` em, ×1.3 vertical);
  along it: the widest line plus the drift spread (`(hi − lo)·|drift|` em). The stack is centred as a whole, with the
  note's room reserved; the note sits under (left of, vertical) the whole stack, not over the copies.
- **Knockout and the ink ticker strip (major).** Both left the autos (`knockout` auto `false`; `strip` auto
  `tint`/`rules`). By pin they draw as before under the scene backdrop. Under black and chroma, the plan's palette
  says so (§4.16.3: black ground under white ink, or the key green), and the part falls back to plain words (no slab,
  no mask, text layer opacity 1) or to the tinted strip. **For WP4 (renderer, optional):** the clear backdrop keeps the
  scene palette, and the export override (`backdropFor`: pngAlpha → clear) is not in the plan, so a pinned knockout
  still exports as an opaque slab with transparent letters there. A renderer rule would cover it: when the backdrop is
  not `scene`, skip layers masked with `invert: true` and draw the text layer at opacity 1.
- **Block holds vs decorated compositions (minor).** breathePulse, slowDrift, swaySwing, creepTrack and thumpSwell have
  `fits(f, chosen) = 0` when `chosen.arrange` is gridMosaic, hangingTags, tiltedCard, slantBand, titlePlate or
  magazineHead (the words sit on cells, tags, a card, a band, or right over a rule). The planner decides arrange first
  (cast order), so these cuts get stillHold, waveRun, jitterShake, flickerLight or shimmerSweep; title cuts on
  titlePlate get stillHold. A dwell pin still pairs them. The set is repeated in calm.js and lively.js (kit-only deps).
- **creepTrack (minor)** closes again over the last quarter of the hold (at least 0.6 s): peak at about 75 % of the hold,
  return at most about 1.8× the fastest opening speed (was a snap inside the envelope's 0.2 s ramp).
- **diptychSplit offsets (minor).** The split follows the offset along its axis (clamped to 20–80 % of the frame); the
  panel paint, the divider and the pieces are all placed from it, so each piece stays in its own panel. The other
  offset moves the words inside their panels.
- **Focus (minor).** hangingTags (the tags, not the threads nor the corner note) and diptychSplit (the words) return
  the union of their text runs, clipped to the frame.
- **Safe area (minor), and what the stricter test found.** gridMosaic and spineColumn reserve the note's line inside
  the safe area; haloRing keeps `R + 0.72·em` within half the safe size (a turned cell reaches half its diagonal past
  the circle); pillarColumns counts its note column in the width fit and centres block and note together. Also fixed:
  giantWhisper's vertical group was centred the wrong way (the giant moved toward the side holding the whispers) and
  its under-tuck box ran past the safe edge; confetti cells at the ends of a flow line could start before the safe
  edge; slantBand at steep angles (−20° in 21:9) turned its box out of the safe area; sidebarIndex's note left the safe
  area at `text.scale` 2; haloRing's arc em for short arcs used `max(step, 0.2)`, which let glyphs overlap when a
  pinned sweep was narrow (now `step`).
- **How the tests measure.** Vertical punctuation and small kana are drawn off-centre in their cell (top right), so their
  em box can cross the safe edge while their ink stays in the cell; the new checks use each run's ink box (its cells)
  through the run's rest world matrix, which also covers turned runs. With glyph em boxes, cornerNote, creditFold and
  sidebarIndex seemed to leave the area by 12–54 du in vertical frames; that was only this offset.
- **Tests (`arrange_dwell.test.js`, 22 tests, ~8 s).** New: safe area over seeded autos (3 seeds × energies, 7 aspects,
  h/v, with/without note); every combination of pinned enum/bool values and number ends (4 aspects, with a note);
  text.scale 0.5/2 against the safe area; the echo stack at the schema's extremes and over seeds; no text dropped
  (80–700 graphemes, emoji, every composition; exact order and whole graphemes for grid, ring and confetti, ≤ 70 runs);
  a long line reaching a filtered-in grid, ring or confetti through the real planner; the grid past its budget (one
  full-width glyph per cell); diptych split, divider and pieces under offsets; focus of hangingTags and diptychSplit;
  knockout/ink-strip autos and their black/chroma fallbacks; block holds never auto-paired with the six compositions
  (corpus through the real planner); creep return speed. Eleven of these fail on the pre-fix parts. A real-plan probe
  (corpus, 5 seeds × 7 aspects, 10,741 cuts, full catalog): no composition leaves the safe area except under
  `project_vertical`'s own `el.text.nudge` pin (dy −24) on r3~0.
- **Goldens — for the lead / WP4.** These are intended render and plan changes (layouts of the compositions above,
  dwell picks on the six compositions, knockout/strip autos), so `frame.test.js` "golden frame hashes" now fails on
  basic/vertical/lrc/long. The registry version is unchanged (no key or param name changed). I did not touch
  `tests/golden/*` (not mine): please regenerate `frame_hashes.json` with `node tests/update_golden.js` (and put
  `plan_hashes.json` back if it should stay as it is). Checked by eye with `contact_sheet.py` (long ja/en lines on grid,
  ring and confetti; echoStack, giantWhisper, spineColumn, slantBand in 16:9 and 3:4, h and v); `parts_gallery.py
  --parts catalog` and `determinism.py` pass.
- **Seen in the full run, not caused by these files:** `catalog.test.js` "part modules under parts/<kind>/…"
  (`strobeOut` in `parts/arrive/digital`).
- **Strings wanted:** none.

## WP5b2 review fixes

Fixes for the WP5b2 review (cameras, screen effects, transitions). Files: `parts/filter/{flash,glow,print,glitch,film,
frame}.js`, `parts/lens/kick.js`, `parts/seam/{soft,wipe,burst}.js`; tests `tests/node/lens_filter_seam.test.js`,
`tests/browser/fx_parts.py`. Where this section and `## WP5b2` differ, this one holds.

- **Flash rate (§4.21) — flashPop and invertBlink stay within "≤ 3 flashes in any 1 s window" on every cut, for every
  param and `when`.** invertBlink: at most 3 blinks per event (`blinks` 1–3; a pinned 4 is clamped). 'beat' events
  fire only on every stride-th beat of the grid (stride = ⌈gap / period⌉ by beat index; gap = 1/3 s for flashPop,
  1 s for invertBlink), and on a beat invertBlink keeps only the blinks that end before the next beat (the post
  stack's 'beat' weighting lifts `amount` on every beat and would relight a blink); a beat flash of flashPop has faded
  to 0 by the next beat for the same reason. No beat grid → no beat flashes at all (the 0.5 s pulses are gone). With
  events ≥ 1 s apart and ≤ 3 evenly spaced blinks, a 1 s window meets the blinks of at most two events and never more
  than 3 onsets, so no rate floor is needed (declined the "3 blinks span ≥ 1 s" part; the 240 Hz test sweeps rates
  6–24 Hz). Events of neighbouring cuts cannot be seen from inside a part: that stays the pre-flight's job (below).
- **The pre-flight fix reaches both parts.** Their `amount` auto is `{ range: [0, 1], follow: 'amount.flash',
  jitter: 0 }` (= amount.flash), so `pin.set work:amount.flash 0.3` makes every auto flashPop/invertBlink amount ≤ 0.3.
  flashPop is then a faint wash; invertBlink's inversion strength is `clamp((amount − 0.3) / 0.2)`: nothing at or
  below 0.3, a full inversion from 0.5 (continuous, so the `when` weighting fades it). A pinned part in a mood with
  flash 0 therefore does nothing until its amount is raised (SPEC §6: moods set effect amounts).
- **'depart' fires where the cut still holds the screen effects:** at cut-local `max(0, dur − span)` with `dur` =
  `fx.cut.dur`, span = 2·decay (flashPop) or 2·blinks/rate (invertBlink), so the flash or the last blink is over by
  the sung end (the next cut's effects take over at t1). The scene's exit start (`times.out`, which `whenWeight`
  uses) is not in `fx.cut` and is not computable from the plan, so the pre-flight could not follow it.
- **For WP6 (pre-flight flash count, `export/schedule.filterFlashes`), to count what renders:**
  - invertBlink counts like flashPop (amount > 0.3), `blinks` flashes per event at E + 2j/rate (j < min(3, blinks);
    on beat events at most ⌊(period·rate + 1)/2⌋);
  - 'beat' events: grid beats with `index % stride === 0` (above), none without a grid; today every beat is counted
    (over-counts above 180 BPM for flashPop, and invertBlink is not counted at all);
  - 'depart' at `cut.t0 + max(0, dur − span)`, dur = `cut.feat.dur` when a number, else `t1 − t0` (today: `t1`);
  - screen effects run only while their cut is the current one (`[t0, next cut's t0)`), not over `[a, b)`.
- **For WP4 (renderer / post):**
  - `fx.flashScale`: please expose the reduce-flash scale (`st.flashScale`, 0.3 in the preview when `reduceFlash`,
    1 in export) on the FxContext. flashPop (its own events), invertBlink and the whiteFlash seam already read it when
    present; until then only `fx.impulse('flash')` is dimmed.
  - Seam window: `seamPart` passes the slot's `p.dur`, but `planner/tracks` shortens the real window
    (`plan.seams[i].dur`, 0.4 × the shorter cut window, ≤ 0.8 s for world seams). Please pass the real length as
    `p.dur` (one line in `seamPart`). glitchSwap counts its ticks in seconds over `u · min(p.dur, 0.5)` meanwhile, so a
    long pinned `dur` squeezed into a short window no longer ticks several times faster than `rate` (the review's case:
    1.2 s pinned, 0.457 s window, now ≈ 22 Hz for rate 20 instead of 52); only windows shorter than both are still
    faster. Its strips now start exactly on a and end exactly on b (jumps and tints × an envelope that is 0 at u = 0
    and 1; switch moments in [0.2, 0.8]).
  - `whenWeight('depart')` never rises on a cut whose exit a seam replaced (`instantHide` → `times.out = b = t1 +
    tail`, so the weight is > 0 only after t1 + 0.05, when the next cut already holds the effects): every 'depart'
    screen effect is invisible there. Rising toward `min(times.out, t1 − t0)` instead would fix it.
  - `fx.pal` is still wanted for duoTone (see `## WP5b2`).
  - `tests/golden/frame_hashes.json` no longer matches (these parts changed; so did other packages'): regenerate on
    purpose after a look at a few frames.
- **Cost (§7.4) — perf.py --parts catalog passes here now** (headless Chromium, software canvas; 3 runs):
  basic p50 9.0–9.2 / p95 28–31 ms, vertical 13.5–14.3 / 24.5–26.5, lrc 5.0–5.2 / 13.2–13.5, long 15.7–16.3 /
  31.5–33.2 (before: vertical 25.2 / 36.4 and long 18.7 / 38.1 failed). long's p95 sits near the 33.4 ms limit because
  of frames with no screen effect or seam at all (entrances around 21.0, 23.5, 26.2 and 28.0 s of project_long, up to
  64 ms) — not in this package; its sumiSeep frames now take ≈ 7 ms of post instead of 14.
  What a canvas without a GPU charges, at 1280×720 (a full-frame copy ≈ 0.2–0.4 ms): a smoothed resize or a
  fractional `drawImage` offset ≈ 2.5 ms; 'saturation' 3.4, 'color'/'luminosity' 2.8, 'soft-light' 2.7,
  'color-burn'/'color-dodge' 1.8, 'multiply'/'screen'/'lighter'/'difference'/'hard-light'/'lighten' 0.6–0.9 per fill;
  a pattern fill costs more than drawing the tile image by image; a canvas drawn onto itself is copied whole first
  (≈ 2 ms), and so is a surface written (even `clearRect`) while another surface still has to draw it. Changes:
  glowSpill 13.6 → ≈ 6 ms (mask, threshold — `steep` now raises the burn threshold to 0.75^(1/2^steep), which is
  what the power did — and blur all on ¼-size corners of two surfaces, one smoothed stretch at the end); amberSpill
  8.7 → 4.5 (one ¼ layer, one stretched 'hard-light' draw: channels above ½ light dark areas, below ½ tint light
  ones); duoTone 10 → 5.6 (luminance by a grey 'color' fill, × (light − dark)/luma(light), + dark); chromaSlip 8 →
  3.1 (whole-pixel offsets, no zoom — see below); paperTooth 5 → 2.7 (tooth = the grain tile overlaid at one tile
  pixel per device pixel, crisp, instead of a smoothed 9 du stretch: finer tooth, same fibres); dotScreen 6.2 → 2.1
  and grainFilm (tile scales are whole numbers ≥ 1: a shrunk tile was the slowest draw); seams sumiSeep 13.9 → 7.1
  (mask painted at 1/f size, f ≈ twice the feather, one stretch feathers it), plungeZoom 8.2 → 6.6 (one motion
  streak copy, not two), swishCut and shoveAcross at whole-pixel positions, swishCut's smear without clears.
  Declined: softVeil (fx.blurred is already one ¼ blur and one stretch) and edgeShade (one full-frame gradient) keep
  their pictures and costs.
- **`cost` re-rated from measured time** (fx_parts.py measures it; classes in full-frame copies at 720p: 1 ≤ 3,
  2 ≤ 5, 3 ≤ 10, 4 ≤ 20, 5 above or re-rendered text): glowSpill, duoTone, softVeil, amberSpill 4; chromaSlip,
  edgeShade, paperTooth, grainFilm, dotScreen 3; rasterLines, flashPop, sliceGlitch 2; invertBlink, dustSpecks,
  cinemaBars 1; afterImage 5. So the adaptive preview halves the textures and skips the heavy light/tone effects.
  Measured the same way here (copies): 14.1, 14.0, 13.0, 11.5; 8.4, 7.3, 7.0, 6.1, 5.7; 3.6, 2.2, 1.5; 1.0, 1.6, 1.5.
  No GPU run was possible here; the software numbers are the reference until one is recorded.
- **Minor findings, all fixed:** edgeShade's darkness is `(0.12 + 0.45·amount)·smooth(amount / 0.1)` (fades to 0, no
  snap at 0.01). chromaSlip draws each channel copy 1:1 at a whole-pixel offset and fills the uncovered strips with
  the edge rows/columns stretched (no hidden 1–5 % zoom). impactKick's `shake` auto is `{ range: [0, 30], follow:
  'amount.shake', jitter: 0 }` and the jolt scales with it: amount.shake 0 → no shake, no jolt (the punch-in stays).
  dustSpecks and sliceGlitch take their layout from the tick only (speck positions and order; which bands, where,
  which gate value) and apply amount as continuous scales: the last speck fades in/out with amount, a tick's glitch
  fades in as amount passes its gate, band jumps and tints scale with amount (a band whose jump rounds to 0 is not
  drawn). Note the reviewed dust already kept positions per tick; what popped was the count.
- **Tests** (all fail on the reviewed code except the layout-prefix one): 240 Hz sweep of both flash parts over every
  `when`, tempos 60–240 and none, param extremes and the post stack's weighting (`whenWeight`), ≤ 3 onsets per 1 s;
  beat strides and no-grid; depart over by the end; amount auto = amount.flash, nothing at 0.3; reduce-flash scale;
  the pre-flight fix on a planned project (200 BPM, flashPop on every beat: count 4 → 0); impactKick at shake 0;
  chromaSlip 1:1 and edge coverage at five angles; duoTone fills; edgeShade continuity; dust/slice continuity in
  amount (1/1000 steps) and layout within a tick; glitchSwap exact at u = 0/1 and ≤ 2 px near them. fx_parts.py adds
  "fades with amount" (change at 0.011 ≤ 0.3 × change at 0.1) for every filter and the cost-class check. Runs:
  `lens_filter_seam.test.js` 32/32 (≈ 3 s), conformance OK, full Node suite: only `catalog.test.js` (strobeOut, WP5a2)
  and the golden frame hashes fail; fx_parts, determinism, parts_gallery (--parts catalog) and perf.py pass;
  `build.py --check` OK.
- **Strings wanted:** none.

## INT-LEAD

Integration lead: the whole CI sequence on the real tree (nothing staged), the §8.3 browser test list, the CI job, and the
first-run and transparent paths walked by hand in the built pages. Where this section differs from an earlier one, it
holds.

- **What ran, in CI order** (local Chromium at `PW_EXECUTABLE`, so the H.264/AAC branches skip here; 4 shared CPUs):
  `build.py --check` · `node --test 'tests/node/*.test.js'` · `build.py --lab` · `build.py` · every
  `tests/browser/*.py` with its default arguments · `tests/build_test.py`. Final run: see **Final run** below. First run
  (before any change): 2 Node failures (`catalog.test.js` placement of `strobeOut`; golden frame hashes), `contact_sheet.py`
  exit 2 (no arguments), `perf.py` over its bound once under load (basic p95 33.6 ms > 33.4; 30.5 ms alone), no
  `i18n_pages.py`.
- **Transitions hand the picture over (§3.12 `b`, §4.16.6; a §9.4 change, DESIGN edited).** A seam's window ends at
  `at + dur/2`, but its cut A stayed in the FrameGraph until `B.t0 + tail`, so after the transition A was drawn again:
  mid-exit, or at full strength when the seam had replaced its exit (`instantHide`). In the four fixture projects 101 of
  103 seams did this, by up to 0.235 s, 79 of them with a replaced exit (seen on screen: 「白い息」 fogging back in after a
  dissolve). `planner/tracks.seams` now ends every cut before B that reaches past the window at
  `max(t1, at + dur/2)` (`endWithSeam`), so its exit is fitted to finish with the transition; seam lengths are still
  computed from the cutter's windows. `b ≥ t1` is kept (in 2,501 corpus seams the window never ends before A's sung
  end). The planner-side fix was chosen over skipping A in the renderer because then everything that reads `b` agrees
  (FrameGraph, current cut → screen effects and ground camera, picking, prefetch). `plan_basic.json` follows the rule
  (`r4~7.b` 8.5 → 8.33, hash recomputed). Tests: the plan-shape check (every cut before a seam's B ends by the window
  end; seam lengths against the cutter's windows) and "after a transition the cuts before it are off screen" (catalog,
  `frameAt`); both fail on the old `tracks.js`.
- **Neighbouring transitions, backgrounds and atmospheres do not repeat (SPEC §6).** With the catalog's two text
  transitions (blendDissolve, sumiSeep; the hard cut is penalized as recent almost always), ×0.03 recency under a
  variety-1.2 mood left 13 % of neighbouring text transitions equal (85 of 1,519 neighbouring transitions). Transitions,
  a segment's ground and its atmos now avoid the previous entry's **winner** (`avoidOf`, `chooseAuto` returns `win`,
  the argmax before its own `avoid`; `pick`'s runner-up rule, as for arrange/arrive). Avoiding the previous *final*
  value instead chains (a changed value changes what the next one avoids, down the song: measured more rerolls
  spilling over 3 cuts); the winner depends only on the natural/reference picks before it. Left: 8 / 1,463 catalog,
  1 / 1,748 synthetic (a repeat needs the previous entry to have been avoided onto this one's winner). The hard cut and
  `none` are exempt. The history memo compares `win` too. DESIGN §4.16.6 says so.
- **Variety and stability tests now also run on the shipped catalog** (WP3 acceptance "with the full catalog at M3"):
  every `planner_variety` and `planner_stability` test runs for `synthetic` and `catalog`. Variety: all pass on the
  catalog; the neighbour test is now "< 1 %" for both (was < 2 % on the synthetic registry only); the season test checks
  every seasonal pick against the season (the catalog has seasonal themes). Stability, catalog only, measured bounds (the
  synthetic bounds are unchanged): a reroll changes ≤ 3 other cuts in ≥ 98.5 % of cases, never more than 5 (measured over
  corpus(6), 725 rerolls: 1.10 % over 3, worst 5; with HEAD's `tracks.js` 0.97 %, worst 5 — the catalog, not the new
  rule: 7 of its 8 world transitions and sumiSeep replace the exit, so a changed seam history changes another cut's exit);
  insertion locality allows one more recency window after a cut whose composition changed to or from a `motion: 'own'`
  one (tickerMarquee forces its motions as rule facts; seen on `long@16:9#1`, pre-existing).
- **FxContext `pal` and `flashScale` (additive to FROZEN §4.18.11; WP5b2 asked for both).** `duoTone` got no palette (dark
  themes turned indigo), and `reduceFlash` never reached flashPop's own flashes, invertBlink or whiteFlash, which read
  `fx.flashScale`. `post.createFx` now sets both per frame from the renderer (`pal` = the frame palette after §4.19.4,
  the one paints use). Test in `facade.test.js` (fails without the change).
- **A transition part gets its real window as `p.dur`** (`engine/render/seam.seamPart`; WP5b2 request): the planner clamps
  the window below the slot's `dur`; glitchSwap counts its ticks over it. Test in `facade.test.js`.
- **The pre-flight flash count follows what renders** (`export/schedule`, WP5b2's list): flashPop 'beat' fires on every
  stride-th beat (≥ 1/3 s apart), invertBlink counts (`blinks` ≤ 3 per event, 2/rate apart, beat events ≥ 1 s apart, on a
  beat only the blinks over by the next beat), 'depart' fires at `t0 + max(0, dur − span)`, and a cut's effects count only
  while it is the current cut `[t0, next t0)`. The old count over-counted beat flashPops and missed invertBlink, so two
  neighbouring cuts that each keep the ≤ 3/s rule but break it together were not caught. `export_math.test.js` and the
  WP5b2 pre-flight-fix test assert the new count (a beat flashPop at 200 BPM is ≤ 3/s by construction; invertBlink on
  neighbouring line starts is counted, and the fix removes it).
- **Step ④ in a browser without H.264** (the first-run path in a Chromium without proprietary codecs): the block said
  「…MP4 を作れません。大きさかなめらかさを下げてください」, which no size fixes. `export/host/mp4.probe` adds `anyCodec`
  (H.264 at 640×360@30 when the chosen size fails); the pre-flight says `no-h264` 「このブラウザは MP4（H.264）を書き出せ
  ません。PNG連番で書き出すか、PC の Chrome か Edge で開いてください。」 with [PNG連番にする] (the same fix now also on
  `no-webcodecs`); `no-codec` stays for a size the encoder refuses. Tests: `export_math`, `ui_output`, `export_check.py`
  (anyCodec agrees with the codec at 720p).
- **About page licences (§1.4).** `Node.append` got an array, so the dialog showed 「[object HTMLDetailsElement],[object
  HTMLDetailsElement]」 instead of the two MIT texts. Spread. Caught by `i18n_pages.py`'s broken-text check.
- **Part thumbnails draw the sample line in the page's language** (`pb.sampleText`: はじまりの朝 / First light); before, the
  en page's part browser showed Japanese in every tile. English font-fallback line is plural for several families.
- **`tests/browser/i18n_pages.py` (new, DESIGN §8.3).** Serves the built pages and walks 18 screens per language (empty,
  lyrics in, ②③④, ④ 詳しく, 詳細 at 作品全体/行/カット/要素, part browser, AI tab, timeline, ≡ menu, palette, ? sheet, syntax
  help, About). On each: visible text and accessible names (aria-label, title, placeholder, alt). en: no Japanese
  outside the product name (and its logo glyph 文) — the lyrics are English there, so anything Japanese is UI; ja: no
  text of the en table and no English word outside a short allowlist (formats, units, key names, services, font
  families read from `engine/text/faces`, proper names such as Google Fonts, the MIT texts, version numbers, the
  language switch's "English"); both: no raw key, no `[object …]`/`undefined`/`NaN`/unfilled `{placeholder}`. Keys: every
  key the page asked `t()` for at run time (recorded by wrapping `i18n/t.createT` through an init script) and every
  literal key in `src/` has non-empty ja and en text; part thumbnails are drawn with the page's sample line. Mutation
  checks: the old dialogs.js and part_browser.js fail it. About 17 s.
- **`contact_sheet.py` without arguments** is a self-check (CI runs every browser file with its default arguments): one
  small sheet of two parts per kind in memory; it fails on a failed cell, a page error or a CSP violation. `--kind` and
  `--list` are unchanged.
- **`MV_REQUIRE_H264=1`** makes `export_check.py` (H.264) and `ui_flows.py` (the first-run MP4) fail instead of
  skipping when the browser cannot encode H.264. CI sets it with Google Chrome, so those branches must really run. AAC
  is not required: Google Chrome on Linux has no AAC encoder, so CI checks the H.264 MP4 without sound.
- **CI (`.github/workflows/ci.yml`).** The sequence above in that order. The browser step
  uses `PW_CHANNEL=chrome` (the runner's Google Chrome; `google-chrome --version` is printed) and `MV_REQUIRE_H264=1`,
  runs every file even after a failure and fails at the end naming each failed file (before, `bash -e` stopped at the
  first). No browser tests found is now an error. Timeout 40 min.
- **The preview prepares ahead while it plays (`ui/boot` installPrepare).** `engine.prepare(t ± 5 s)` ran only after
  seeks and plan changes, so during playback every cut past the first window was built, and its blurred glyphs
  rasterized, in the frame that first showed it (the 30–65 ms spikes of perf.py). Now a `time` event while playing runs
  prepare again once the playhead has moved half a window. `ui_flows.py` flow `playback` checks it (a prepare centred
  ≥ 3 s while playing from 0.5 s, and not one per frame); it fails without the change. `ui/lab` perf() now shows a frame
  before it prepares, as the stage does (prepare warms sprites at the scale of the latest frame, and warmed nothing when
  called before the first one). perf.py here: basic p95 25.6–26.0 ms (was 28.8–33.6), long 30.3–30.8 (was 32.6–33.6).
- **perf.py judges the least disturbed of two runs** (`--runs 2`): each run is a fresh engine (scenes and sprites cold),
  so the better one only discounts CPU time other processes took; identical single runs of long spread over 30–35 ms
  p95 on these shared CPUs, so one run failed or passed by chance. The bounds (2 × §7.4) are unchanged. Tried and
  dropped: making the static base of auroraVeil/halftoneSun a static raster (no gain: placing a full-frame raster under
  the camera costs as much as the gradient fill on a software canvas).
- **Goldens regenerated on purpose** (`node tests/update_golden.js`) after the code above: `plan_hashes.json` from the
  stub registry to the catalog (`d088ca2e`; all 240 plans, the registry itself plus the seam window and neighbour rules),
  `frame_hashes.json` (basic 10, vertical 40, lrc 26, long 40 of 40 frames changed: exits fitted to the seam windows,
  neighbour rule, seam `p.dur`, `fx.pal`). Frames of vertical and long were looked at in the lab before writing.
  `plan_basic.json` stays hand-written: the fake engine, frame, contract, commands, ui_fields and ui_selection tests
  assert its stub-registry content (title card, focus cut `ra~3` with `filter#0`, `seams[0]`), and a real plan of
  project_basic has none of those; it only follows the new `b` rule.
- **Walked by hand** (ja and en pages, 1440×900, clipboard paste into the editor, the mouse for everything else; no File
  System Access in the harness, so the in-memory path):
  paste the sample lyrics → the stage takes focus and plays muted → おまかせ → ④ → PNG連番: the summary says 3.7 GB for the
  53 s song at 1080p and 書き出す asks first (declined; 4 s instead) → progress with frames and time left, [中止] → 「書き出し
  ました」 → a ZIP of 120 PNGs, 1920×1080, 208 MB, about 12 s here. Then [設定に戻る] → 背景 透明（透過PNG）: the format
  follows to 透過PNG, the preview shows the checkerboard, the ZIP (1 s) holds 30 RGBA frames, 3.9 MB. No page errors, no
  CSP violations. Found and fixed on the way: the no-H.264 message, the About licences, the en thumbnails, the English
  font-fallback grammar, and (before) the reappearing old cut after every transition.
- **Open, for the next step (not changed here):**
  - `perf.py` margin: long p95 ≈ 30.5 ms against 33.4. What is left is raster time of large gradient grounds
    (auroraVeil, halftoneSun) and the paperTooth texture on a software canvas; the stage timings under-report it
    because Chrome rasterizes at the read-back (without the texture, "draw" reads 2–4 ms of a 14 ms frame). CI's Chrome
    has no GPU either.
  - Opaque PNG sequences come out RGBA (Chrome's `convertToBlob`), ≈ 1.7 MB per 1080p frame; an own RGB encoder
    (CompressionStream) would save about a quarter. The 1.2 bytes/pixel estimate is ≈ 50 % high for such frames.
  - Earlier packages' requests still open: `surface.resetState` line state (WP5b2), `K.mirror` with `patch.shared`
    (WP5a2), `whenWeight('depart')` on replaced exits (WP5b2), knockout under the clear backdrop (WP5a1), chroma
    `awayFromGreen` for every token (WP5b1), the work texture in the auto `filter#i` pool (INT-PLAN/WP5c), relock keeping
    orphaned lock pins (INT-PLAN review), cold plan ≤ 10 ms (§9.1), `cut.lineT0` for barCode.
  - DESIGN text proposed by earlier packages is not folded in yet (L2 `faces.resolveFaces`, §4.17.5 buildGround,
    §3.12 fp song terms, §4.16.4 recency/stability wording, §4.10.1 rules 3–4, §9.1 cold plan). This step edited only
    §3.12 (`b`) and §4.16.6 (hand-over, neighbour rule).
- **Final run** (the CI sequence in order, local Chromium, after every change above): `build.py --check` 174 modules OK;
  Node 1,005 tests, 0 failures (≈ 62 s); `--lab` and pages built; browser: contact_sheet self-check OK, csp OK, determinism
  OK, export_check OK (H.264/AAC branch skipped: no encoder here), fx_parts OK, glyph_parity OK, ground_contrast OK
  (1,728 renders), i18n_pages OK (18 screens × 2), parts_gallery OK, perf OK (long p95 29.4 ms, other run 32.1),
  transparent_check OK, ui_flows OK (18 flows; first-run MP4 skipped here), ui_layout OK (300 layouts); `build_test.py`
  OK (21). About 4½ minutes for the browser tests.
- **Strings wanted:** none (added `exp.pre.no-h264`, `exp.pre.makePng`, `pb.sampleText`; `exp.pre.font-fallback` en plural).

## QA-MOTION (visual QA and tuning: arrive, depart)

Files: `parts/arrive/{digital,fall,gather}.js`, `parts/depart/{drift,fall,type}.js`, `tests/node/parts_motion.test.js`
(new tests at its end, and a test-only two-column vertical composition `testColumns`). Keys, labels, tags, param names
and the §5.2/§5.4 pictures are unchanged, so the registry version is too; some autos changed (below), so plan hashes
change.

- **How it was judged.** Contact sheets (lab page, fallback fonts) of every entrance and exit at u = 0.05, 0.2, 0.4, 0.7,
  1.0 in six set-ups: 16:9 ja (sumiWashi, light), 16:9 en two lines (nightTram, dark), 9:16 mixed ja/en (nightTram),
  9:16 vertical ja with 、 (sumiWashi), 1:1 en two lines (sodaFloat, light), 1:1 mixed (emberGlow, dark); tuned parts
  re-rendered at 0.05 … 1.0 in all six, the caret and falls again at finer times. Beside the eye, a scratch probe
  measured, per part, how often two visible glyphs that do not touch at rest cover each other mid-motion (bodies through
  scale only, not turn or shear); it found the skew, wind and rain collisions below and nothing else that is not the
  picture itself (zoomSettle, stampPress, shardGather, pointImplode, the drop/pile/burst exits overlap by design).
- **Verdicts.** Good as they are: inkRise, fogIn, bloomOpen, hingeFlip, riseFromFlat, twirlArrive, sliceReveal, curtainRise,
  seamJoin, pixelStep, staticJoin, ribbonWave, stampPress, wordPop, zoomSettle, shardGather, ghostConverge, instantShow;
  inkSink, hingeClose, twirlDepart, sliceHide, curtainFall, fogOut, dropAway, meltDown, shardBurst, pointImplode, zoomPast,
  burnOut, instantHide. Tuned: typeOn, strobeIn, dropSnap, rainDrop, skewSlide; strobeOut (broken), typeErase,
  windBlow, skewExit, pileCollapse.
- **strobeOut (broken) and strobeIn.** A strobing glyph was lit with a 20 % chance per tick right up to its end, so strobe
  out could leave a glyph lit in the last frames and the cut then dropped it (seen: the last "y" lit at u = 0.98–1.0).
  A strobing glyph is now dark over the first 15 % of its flicker (`STROBE_DARK`), so strobe out (its mirror) ends dark;
  strobe in simply lights a glyph a moment later. Still one flip at most per tick, same pattern at any frame rate.
- **dropSnap, rainDrop: no glyph falls through another.** In a vertical column each glyph fell through the one above
  it (it lands first); in rain drop's random order and heights a lower glyph could also cross one still falling above it
  (seen: 走 and る drawn over each other). Now, measured once per build from the entrance as made (its delays and
  per-glyph randoms; `measureFalls`): below a glyph that lands no later, a glyph falls only from the room between them
  (at least 0.45 em, fading in while it is still under it; drop snap treats a whole line above as a shelf); below a glyph
  that is still falling when it starts and lands later, it falls from no higher than that glyph plus the room between
  them, so the two move alike with the lower one ahead and never cross; its bounce never rises into a glyph above.
  Horizontal single lines are unchanged (nothing is above anything). rainDrop's ease auto is `linear` (was quadIn):
  its own fall already accelerates, and quadIn on top left glyphs hanging still for half their time.
- **typeOn, typeErase: the caret next to the cell.** In a vertical run 、。 and small kana are drawn off-centre in their
  cell (§4.15.2), and the caret stood next to the drawn glyph, off the column. It now stands on the column's axis,
  next to the cell (`cellsOf`, copied in both files).
- **skewSlide, skewExit: words no longer run into each other.** skewSlide came in from the left over the words already
  there ("Holdon", "toe"); skewExit slid right into the words still there. Now skewSlide comes in from the side the text
  goes on to (no word has arrived there yet, and a word ahead in the stagger is always nearer its place) and skewExit
  leaves to the side it came from (the words before it have gone): right and left in horizontal text, mirrored in
  vertical text (columns go on to the left), which is exactly the old vertical motion. Autos: xFrom 2.4, kxFrom −50;
  xTo −2.6, kxTo 40 (the lean relative to the direction of travel is kept). The params keep their names and meaning in
  horizontal text; in vertical text the make negates them. To wrap a K.moves make, the definition is spread without
  `motion` (`advancing`): the kit rebuilds the make of any definition that has one, so `K.variant(def, { make })` would
  silently drop the wrapper (a kit property, see below).
- **windBlow: the wind takes the glyphs from its downwind edge.** Every glyph follows the same accelerating path, so with
  lead order and a rightward wind the blown glyphs flew over the waiting ones and bunched into one travelling clump
  (up to 12 overlapping pairs in two English lines). Autos now: `dir` left, `order` sweepX (leftmost first), clean in
  horizontal and vertical text; the path is the §4.18.7 example's, unchanged. A pinned right wind with the auto order
  clumps as before; in vertical text sweepX ranks a whole column alike, so columns leave one by one.
- **pileCollapse: the pile stays inside the frame.** A glyph's sideways drift (up to ±1.5 em in vertical text) carried
  columns near the edge of a narrow frame out of it (9:16 vertical); landing spots are now kept between the frame's
  sides (0.4 of the safe margin, as the floor), and glyphs stack where they land.
- **Seen and left as they are.** The K.mirror exits (inkSink, hingeClose, twirlDepart, sliceHide) take the reversed ease
  (expoIn, backIn …), so most of their motion falls in the last ~40 % of the exit window: an exit that accelerates away,
  by the mirror's definition. stampPress's first frames at 160 % may reach past the frame edge; dropSnap and shardGather
  may start outside the frame; typeOn's caret keeps blinking after the text rests (LINGER), typeErase's caret is alone
  for its last frames; all as pictured.
- **Tests (`parts_motion.test.js`, 25 tests, < 1 s).** New: skew slide/exit never run a word into another (16:9, 9:16,
  1:1, two vertical columns); wind blow with its autos neither flies over waiting glyphs nor bunches (glyphs that leave
  at different times); drop snap and rain drop never pass through a glyph above (lead, scatter, tail; a column, two
  columns, two lines); strobe in starts and strobe out ends dark; the caret on the column axis next to the cell of 、。
  and small kana (typeOn, typeErase); the pile inside the frame. Each fails on the code before its fix (checked on a
  copy of the tree: HEAD skew/wind/fall/digital/type, the strobe and pile changes undone, the fall cap removed).
  `conformance.test.js` passes (226); `build.py --check` OK.
- **For the lead: golden hashes.** `planner_determinism` (plan hashes) and `frame.test.js` (frame hashes) fail with these
  files alone: new autos (skewSlide, skewExit, windBlow, rainDrop ease) change plans, and the motions change frames. The
  arrange/dwell tuning changes them too, so regenerate once with `node tests/update_golden.js` after all tuning has
  landed. Nothing else fails in the full Node run.
- **Kit notes (WP4, not changed).** `K.variant(base, { make })` on a K.moves definition keeps `motion` and rebuilds the
  make from it, dropping the patch's make without a word (a check or a documented rule would help); `sweepX` ranks by
  rounded x, so a vertical column ties. The `K.mirror` patch.shared issue of `## WP5a2` is still open.
- **Strings wanted:** none.

## QA-LAYOUT (visual QA and tuning: arrange, dwell)

Files: `parts/arrange/{core,columns,editorial,scatter,special}.js`, `tests/node/arrange_dwell.test.js` (eight new tests at
the end). `parts/dwell/*` unchanged. Keys, labels, tags, params and autos are unchanged (registry version too); only
layout maths moved. Where this section differs from `## WP5a1` or its review fixes, it holds.

- **How it was looked at.** `contact_sheet.py` for every part of both kinds, re-tiled for reading: arrange at u = 0.5 in
  16:9, 9:16, 1:1 and 4:5, h and v, with Japanese (「ねえ、ちょっと待って」ってもう一度言えなかったー), English, mixed
  (今夜はDANCE FLOORで踊ろう!! 2024年の夏), short (はじまりの朝) and a punctuation-heavy vertical line (…「さよなら」ねぇ…
  Let it go！？), on dark (nightTram, emberGlow, mapleInk, tidePool) and light (sumiWashi, risoPink, sodaFloat) themes;
  dwell at five hold times in 16:9 h ja dark, 9:16 v mixed light, 1:1 en light. Plus scratch grids per part with
  pinned params, notes, emphasis and roles, and a pose probe of every hold over its window (drift, scale, turn, alpha,
  tint, largest per-frame step). Tategaki checked on every vertical sheet: corner punctuation in the upper right, small
  kana offset, ー and brackets turned, 1–2 digit numbers and !? tate-chu-yoko, longer Latin runs turned as a block.
- **Verdicts.** Dwell: all ten good (stillHold none; breathePulse ±2.4 %; slowDrift ≈ 20 du; swaySwing ≈ 2°;
  creepTrack opens and returns; waveRun ≈ 0.1 em; jitterShake a few du; flickerLight dips to 0.35–0.5; thumpSwell ≈ 3 %
  punches; shimmerSweep tint 0.74), in h and v. Arrange good as they were: centerAnchor, confettiWords, stairStep,
  pillarColumns, spineColumn, magazineHead, tickerMarquee, breathMark, edgeBleed (apart from its note). Tuned (below):
  giantWhisper, echoStack, edgeBleed, cornerNote, hangingTags, haloRing, gridMosaic, tiltedCard, slantBand,
  diptychSplit, sidebarIndex, titlePlate, creditFold. None broken, but the old hangingTags tiers could overlap
  (found by the new test: 16:9, 「ちょっと待ってよー、20回目の「さよなら」」, tags 1 and 3).
- **Square and tall frames.** The recurring problem: compositions that cap a long line at two lines set it small in
  1:1, 4:5 and 9:16 (25 cells: 5 % of the short side or less). A frame "no longer along the lines than across them"
  (horizontal lines in a square or tall frame, vertical columns in a square or wide one) now gets: tiltedCard a wider
  card (0.76 of the width) and a fourth line (58 → 89 du), slantBand and titlePlate a third line (56 → 86, 50 → 77),
  echoStack a third line (51 → 78 in 1:1), diptychSplit panels split across the lines in a square frame (above each
  other for h, side by side for v; 45 → 98), sidebarIndex a column of half the width in a square frame (47 → 69),
  creditFold 0.72 of the width in square frames too (32 → 46). centerAnchor keeps "one or two lines" (§5.1).
- **giantWhisper.** An emphasis on part of a Latin word takes the whole word in mixed lines without spaces too
  (「Loveって」: "Lo" → "Love"). `beside` only when the whispers keep (nearly) their size next to the giant, else they go
  under it (tall frames, long whispers); the giant and its whispers are centred as a group. Under: whispers wider than
  the giant (a one-letter emphasis such as "I") are centred under/over it instead of hanging from its end, which pulled
  the group half a frame to one side; their line breaks are unchanged.
- **echoStack.** Several lines carry each line's trail in the space between them (the leading grows by the whole
  trail), so an echo never lands on the next line. Overlapping copies (steps under 0.9 em) keep that trail short
  (≤ 0.9 em in all), as before; copies a line apart keep their step when the room across allows it (they read as
  repeated lines instead of a smear). Up to three lines in square/tall frames; the block's box is as wide as its
  widest planned line, so the layout breaks it into exactly that many.
- **edgeBleed.** Without the knockout the note lies over the huge words; it now sits on a small rounded plate of the
  ground colour (a `near` paint that fades with the text). No plate with the knockout or without a note.
- **cornerNote (vertical).** Columns start at the block's top (ragged foot, as vertical text is set) in every corner;
  the note column follows the caption on its left, its room kept inside the safe area, and a note longer than a short
  caption in a bottom corner starts higher so it ends inside the safe area (the WIP left it 78 du out). The rule or
  dot sits in line with the first (rightmost) column: above it in bottom corners, below it in top corners.
- **hangingTags.** In frames up to 1.2 : 1, long horizontal phrases may take two lines on their tag (at a phrase
  boundary, or between characters for CJK phrases of six cells or more) when that makes the type ≥ 20 % larger
  (9:16 ja 43 → 67 du). Two tiers are placed by `tierRows`: every lower tag hangs on a thread through its gap in the
  upper row (clear of the upper tags), inside its own tag, and 0.3 em from the other lower tags; the tier size shrinks
  until that holds. A lower tag hangs below every upper tag it passes under; its random drop is capped at 30 % of the
  safe height (in tall frames the zig-zag order got lost). The rng order is unchanged.
- **haloRing.** Glyphs turned along the ring take slots of their own width (Latin letters of a word stay together).
  Upright glyphs take slots that follow the angle: their width where the ring runs across, up to a full slot on the
  sides where they stack (the WIP's width slots let upright letters overlap there); CJK keeps one slot each.
- **gridMosaic (manuscript rules).** 句読点 and closing brackets (、。」』）… and two of them in a row, which share one
  cell) never open a line: they hang one cell past the end of the line before (in the margin cells; one cell past the
  ruled grid when `pad` is 0, and the fit counts that cell). Two digits share a cell in both orientations (2024 → 20
  24, tate-chu-yoko when vertical); in a horizontal grid two Latin letters too (DA NC E); a vertical grid keeps Latin
  letters upright, one per cell. A multi-glyph line never gets one cell per line (はじまりの朝 vertical in 16:9 was a
  right-to-left row of one-glyph columns). When the cell size is capped, the fewest text lines win. Cells two glyphs
  share are inset 10 % so the pair clears the rules.
- **creditFold (vertical).** A long title takes two columns and a taller reach (0.7 of the safe height); the artist
  column follows the title's real left edge.
- **Tests** (`arrange_dwell.test.js`, 30 tests, ~9 s): long lines in square and tall frames (median glyph per part
  and aspect, not overfull); giantWhisper whole Latin word, group centred (6 cases), beside falls back in 9:16;
  echoStack line count, short trail for overlapping copies, full step for clear ones, trail within the leading;
  hangingTags no overlap and no thread behind another tag (5 aspects × h/v × 6 texts × 3 seeds/cards); haloRing
  Latin pitch on turned rings and no touching upright glyphs (ink boxes) over aspects/texts/sweeps; gridMosaic marks
  never open a line (5 aspects × h/v × 4 texts × pad 0–2, > 10 hung), digit pairs, two-line はじまりの朝; edgeBleed
  plate; vertical cornerNote (note left, tops aligned, rule in line) and two-column credits. All eight fail on the
  committed parts (checked on a copy of the tree with HEAD's `parts/arrange/*`). `conformance.test.js` 226/226,
  `build.py --check` OK, `parts_gallery.py` OK (catalog 2,422 renders), `determinism.py` OK, contact_sheet self-check OK.
- **Goldens — for the lead.** `frame.test.js` "golden frame hashes" fails: intended (these layouts; please regenerate
  `frame_hashes.json` with `node tests/update_golden.js` once the parallel QA edits are in). `planner_determinism`
  "golden plan hashes" also fails in the shared tree, but not from these files: with HEAD's arrive/depart and these
  arrange files it passes; with HEAD's arrange and the in-flight arrive/depart edits it fails.
- **Seen outside these files (not changed):**
  - `engine/text/breaker` phrases (§4.15.3): the "chunk ≥ 6 graphemes" exception breaks after the particles も and な
    inside words: 「…待って」っても／う一度」 (もう split) and 「う一度言えな／かったー」 (言えなかった split). Every
    composition that uses phrases shows it (centerAnchor, diptychSplit, confettiWords and hangingTags words, echoStack).
    Suggest a DESIGN change: no break after a one-mora particle when hiragana follows, whatever the chunk length.
  - `tests/browser/contact_sheet.py`: the `t=` label covers the bottom-left corner of each cell, so bottom-left
    compositions (cornerNote, creditFold) are hidden there.
  - The hold envelope (`engine/scene/behave` RAMP_OUT 0.2 s) settles block holds quickly right before the exit: a 2°
    swaySwing of a full-height 9:16 column moves its far glyphs up to 7 du per frame in that ramp. Not visible as a
    jump; creepTrack has its own longer return, the others could too if wanted.
  - `script.test.js` "script functions are fast enough" failed once in the full Node run under load (61.9 ms for 300
    lines); it passes alone.
- **Strings wanted:** none.

## QA-WORLD (visual QA and tuning: ground, ornament)

Files: `parts/ground/{plain,sky}.js`, `parts/ornament/{frame,mark,atmos,season}.js`, `tests/node/parts_world.test.js`
(nine new tests at its end, and a wider sampling window in the long-segment test). Keys, labels, blurbs, tags, seasons,
scopes, param names and autos are unchanged, so the registry version and plan hashes are too; frames change.

- **How it was judged.** Contact sheets (lab page, fallback fonts) of all 18 backgrounds and 22 decorations in eight
  set-ups: 16:9 ja (sumiWashi, light), 16:9 en two lines (nightTram, dark), 9:16 mixed ja/en (emberGlow, dark), 9:16 ja
  (sodaFloat, light), 1:1 en (frostGlass, light), 1:1 mixed (tidePool, dark), and vertical ja in 9:16 (sumiWashi) and
  16:9 (nightTram); per-cut decorations at u = 0.05 … 0.97, backgrounds and atmospheres at three times; then 640-px
  cells of every part in light and dark themes (plus risoPink, monoPress) for detail. Contrast behind the safe area is
  `ground_contrast.py` (1,728 renders): passes before and after.
- **Verdicts.** Backgrounds good as they are: flatFill, washiFiber, skyGrade, tideBands, fogNoise, gridPaper, inkWash,
  nightBokeh, neonHaze, spotBeam, petalWash, heatShimmer, maplePaper, snowLight, photoPan; tuned: stripeShift,
  halftoneSun, auroraVeil. Decorations good: hairFrame, bigBrackets, cornerTicks, hankoSeal, ripplePath, sunBurst,
  sparkSpray, pinDotBoard, barCode, crossHair, serialMark, rainLines, snowDust; tuned: tapeStrip, fireworkBloom, and the
  near layers of petalFall, leafFall, bokehDots, fireflyGlow; broken: orbitRing, inkSplat, underSweep.
- **orbitRing (broken): the ring ran through the text.** Its semi-axes were 0.6 × the block plus the gap, which passes
  inside the block's corners (seen: through the "H" and "e" of two-line English, through 今 and で). The ring is now the
  least ellipse through the corners of the block grown by the gap and the largest dot (√2 × the half sides), taller
  where the frame caps its width, with the tilt taken into account (the corners are measured in the ring's own frame).
  If the frame cannot hold a turned ring, the tilt is eased toward level (1, ¾, ½, ¼, 0 of it); if it cannot hold
  any, the ring may run out of the frame at its ends (semi-axes up to 0.75 of w and h) rather than through the text.
- **inkSplat (broken): accent splashes behind accent glyphs.** A splash sat r·0.45 out from a block corner, so its body
  (up to 1.16 r, more during the burst's overshoot) and its randomly thrown fingers and droplets reached into the
  block; on the mid layer, in the accent, behind emphasized words in the accent (seen: 今 and "with" half hidden in
  9:16). Now it sits 1.3 r + 10 du out along its anchor's outward direction (corners and the middles of the sides; the
  block lies wholly behind that anchor), and throws fingers and droplets away from the block (within ±1.35 rad).
  Anchors whose splash lands well inside the frame and apart from the others come first (vertical columns that fill
  the frame's height get splashes at their sides instead of off the bottom).
- **underSweep (broken): a bar under nothing.** The emphasis was placed by its share of the characters along the whole
  block, so on two lines (the usual case in 9:16 and 1:1) the bar lay under the second line at the block's left edge
  — under empty space in centred text — and in two vertical columns above the first glyph. Without glyph positions a
  decoration cannot know on which line the emphasis falls, so it now estimates the line count from the block's shape
  and the characters' advances (full-width 1 em, spaces 0.3, others 0.56; emphasis × 1.15): n ≈ √(length · depth /
  (block length · 1.35 em pitch)). One line: the bar goes under the emphasis by its share of the estimated advances
  (better than characters for mixed ja/en). Several lines or columns: the bar runs under (beside) the whole block. The
  sweep still lands when the emphasized word is sung. **For WP4 (still open from WP5b1):** a `hints.emph` box (or
  per-line boxes) in the ornament hints would make it exact; the part already uses `hints.emph` when given.
- **tapeStrip: tape over the first glyph.** Pieces sat W·0.35 out along the diagonal, so a straight tape's edge reached
  the block's corner and a skewed or snapping one crossed it (seen on "H" and 今). Each piece now sits out along its
  corner's diagonal by 12 du plus its own half extent across the diagonal (skew and the 1.2 × snap-in included). The
  sheen follows the piece's own length (it used the param length, so it overran shortened pieces).
- **Atmospheres in front of the text.** The near layers (petals, leaves, bokeh, fireflies passing in front of the
  words) dimmed only to 45 % in the lyric zone, so a near leaf or petal veiled glyphs at ~25 % (seen: a leaf over 今).
  Near items now dim to 12 % there; fireflies behind the text (which add light) to 30 %; everything else behind stays
  at 45 %. rainLines and snowDust are unchanged (thin streaks; engine particles).
- **fireworkBloom: bursts across the words.** Bursts opened at 0.1–0.28 h with radius 0.18–0.26 short × 1.25, so in
  16:9 and 1:1 their sparks reached "with" and "the". Bursts now open at 0.07–0.22 h and 0.2–0.48 w from the middle,
  below the top by 3 %, above the lyric zone (an ellipse 0.36 w × 0.3 h) by room for their droop; each burst opens
  only as far as the zone allows (its distance to the zone's outline, measured from where it has sunk after 1.3 s, the
  time its sparks stay bright; at least 24 du). The droop is 45 τ² du (was 60 τ²). Bursts look smaller and more
  distant in wide and square frames, which fits "in the distance".
- **stripeShift: busy edges.** The stripe was the ground tinted toward its colour by 0.1–0.4, limited only by ink
  contrast; with a dark or saturated token (sumiWashi shiftA, emberGlow shiftB, tidePool, nightTram) every glyph was
  cut by hard stripe edges (OKLab distance up to 0.19 from the ground). The tint is now also limited to an OKLab
  distance of 0.052 × (0.6 + 0.4 amount) from the ground (a local `oklab` helper: a contrast ratio misses saturated
  colours of the ground's own lightness). Pastel pairs (sodaFloat, frostGlass) look as before.
- **halftoneSun: accent dots behind accent words.** The dots thinned only to 30 % in the middle, and the disc (0.7–1
  short across, centred at a corner) reaches the lyric block in every aspect (seen: red dots behind は, teal behind 今夜).
  Dots of a disc in a corner now shrink to nothing inside the lyric zone (ellipse 0.42 w × 0.34 h, clear to 0.6 of it,
  full from 1.35). A disc pinned to `center` is meant to stand behind the words and keeps the old 30 % floor.
- **auroraVeil: curtains down to the first line.** The lowest curtain's bright edge reached 0.41–0.47 h (its wave is
  1.1 × `wave`, not 1 ×), onto the top line in 1:1 and 16:9. The whole veil now shrinks toward the top edge until its
  lowest reach is 0.22 × short above the middle (16:9 and 1:1: ≤ 0.28 h; 9:16 is nearly unchanged). On light grounds
  its colours are lightened 35 % first (the muddy olive and slate curtains on sumiWashi become pastel).
- **Seen and left.** nightBokeh, neonHaze and spotBeam (dark-tagged) on light themes read as muted, slightly grey
  washes: their lights can only be darker than a pale ground under the readable() rules. Pastel lights were tried and
  measured (5 of 7 light themes a little lighter; monoPress unchanged; spotBeam's edge is capped by the accent rule
  either way) and dropped as not worth a change. petalWash on dark teal or brown grounds turns into a grey veil (the
  OKLab mix of pink and a dark ground passes through grey); readable, left. The aurora's rays read as reeds at
  thumbnail size; fine at full size. Grounds and atmospheres assume lyrics in the middle; compositions that set text
  in a corner or at the top (corner caption, ticker) can still meet the halftone disc, the aurora or a burst — a ground
  cannot see its segment's text (its fingerprint does not cover the cuts, ## WP5b1).
- **Tests (`parts_world.test.js`, 27 tests, about 11 s).** New, each fails on the files before this tuning (checked on
  a copy of the tree with the six HEAD part files): orbitRing clears every glyph (tilts ±20, 16:9 / 9:16 / 1:1,
  ja / en / mixed, horizontal and vertical); no tape piece overlaps a glyph (skew 25, lengths 60 and 400, snap-in
  scale); no ink point inside a glyph box and no glyph inside a splash (up to 5 splashes, size 0.3, burst overshoot);
  underSweep lies under the emphasized word on one line (≥ 60 % of it, ≤ 1.6 × its length) and along the line next to
  it on several (≥ 90 %), beside the text in vertical columns; near-layer atmosphere items in the lyric zone draw at
  alpha ≤ 0.16; no bright firework spark (alpha > 0.2) inside the lyric zone over a minute at rate 10 and size 0.45;
  no halftone dot in the lyric zone for a corner disc; the aurora's lowest reach at every aspect and height; stripes
  within the OKLab bound in every theme and colour. The geometry tests build cut scenes with the catalog registry (real
  compositions, vertical ones included) and the fake measurer. The long-segment test now samples 30 frames a second
  apart (was 10, two seconds apart): fireworkBloom's burst sides are random per burst, and moving its bursts made the
  old sample fail by chance (left half 30.2 against 0.6 × 53.8 − 2); the new window passes with the old and new files.
- **Runs.** `build.py --check` OK; `conformance.test.js` 226/226; `parts_world.test.js` 27/27; browser:
  `ground_contrast.py` OK (1,728 renders), `parts_gallery.py` OK (catalog 2,422 renders, 0 CSP violations),
  `contact_sheet.py` self-check OK. Full Node run: 1,025 of 1,028 pass; the three failures are not these files: golden
  frame hashes (these parts change frames too — regenerate once after all tuning), golden plan hashes (other packages'
  autos; these files change no auto), and `lens_filter_seam.test.js` "duoTone maps to the palette…" (`filter/print.js`
  is being tuned in parallel).
- **Kit notes (WP4, not changed).** Parts may use only the kit, whose `color` has `mix` and `rgba` but no contrast or
  colour distance, so `readable()` is still copied into each ground file and plain.js now carries a small OKLab
  distance; `K.color.contrast` and `K.color.distance` would remove the copies.
- **Strings wanted:** none.

## QA-FX (visual QA and tuning: lens, filter, seam)

Files: `parts/filter/{glitch,flash,print}.js`, `parts/seam/{soft,wipe,burst}.js`, `tests/node/lens_filter_seam.test.js`
(eight new tests at its end, the duoTone test rewritten, `runSeam` takes `{ alpha, pal }`). `parts/lens/*` unchanged.
Keys, labels, blurbs, tags, stages, scopes, replace rules, param names and autos are unchanged, so the registry version
and plan hashes are too; frames change. duoTone's `cost` is re-rated 4 → 5 and `passes` 6 → 8 (measured below).
Where this section differs from `## WP5b2` or `## WP5b2 review fixes`, it holds.

- **How it was judged.** `contact_sheet.py` sheets of all 37 parts: cameras at u = 0.02 … 0.98 in 16:9 ja (sumiWashi,
  light), 9:16 en two lines (nightTram, dark), 1:1 mixed (emberGlow, dark); effects at three times in those plus 16:9 en
  (sodaFloat, light); transitions at u = 0.05, 0.25, 0.45, 0.55, 0.75, 0.95 in the first three. Because the sample cut
  boosts amounts (0.7 cameras, 0.75 effects), is never an impact and shows only one `when`, a scratch lab-page grid
  (samplePlan + the real engine, params / impact / impulses / borrowed slots / ground / backdrop palette per row) added:
  every effect at a typical amount 0.55 in four themes and 9:16; flash effects on an impact cut with the planner's flash
  impulse, frame by frame; sliceGlitch over 12 consecutive ticks at three amounts; afterImage behind moving entrances and
  a hand-held camera; textures as 1:1 crops of a 1080p frame (grain, dots, paper, scanlines at their real pixel size);
  every effect and transition under the chroma, black and clear backdrops (with the backdrop palette the planner makes);
  a text transition over a textured ground with moving cameras. Cameras also got a numeric track (text-corner travel,
  per-frame speed at 30 fps, zoom, roll, off-frame corners) at amounts 0.38 and 0.71, 16:9 and 9:16.
- **Verdicts.** Cameras: all ten good (fixedFrame; slowPush 6–9 % in; dollyOut 8–11 % out; driftFloat 30–40 du and ≤ 1.1°;
  handHeld 11–17 du; beatZoom 3–5 % punches; rollSway 1.3–1.8°; panSweep 55–76 du in 16:9; impactKick 8–11 % kick;
  parallaxOrbit 77–107 du with layers sliding), nothing leaves the frame. Effects good: chromaSlip, flashPop, softVeil,
  grainFilm, rasterLines, edgeShade, glowSpill, dotScreen, amberSpill, dustSpecks, cinemaBars, afterImage; tuned:
  sliceGlitch, invertBlink, duoTone, paperTooth. Transitions good: hardCut, sumiSeep, whiteFlash, swishCut; tuned:
  blendDissolve, glitchSwap, plungeZoom, shutterSnap; broken: shoveAcross (its shadow never showed), irisGate and
  blindSlats (on transparent frames).
- **duoTone: muddy, not two-colour.** Luminance was mapped from black to the lighter ink, so a pixel as dark as the
  darker ink did not print that ink: a navy ground turned olive grey (nightTram, emberGlow: the whole frame lost its
  colour), and on light themes, where the darker ink is the accent, words printed pale pink. Now the range between the
  two inks' own luminances is stretched over the pair, `y' = clamp((y − Ld)/(Ll − Ld))` ('color-burn' by 1 − Ld, then
  'color-dodge' by 1 − 1/k, both greys), so the ground keeps its exact colour and the words print in the full other
  ink; anything lighter than the lighter ink prints that ink. Five blend fills instead of three: 22 copies at 720p (class
  5; 21.8 ms per call at 1080p here, was ≈ 14 copies).
- **sliceGlitch: flat colour bars, jumps too small to read.** Tinted bands were 'difference' fills at 0.55–0.95 on any
  band up to 7.6 % of the height: over empty ground a solid magenta or teal block (like a UI bar), while the jumps
  (uniform 0 … shift) mostly moved empty ground by a fifth of an em. Now bands sit toward the middle of the frame (mean
  of two uniform draws: 75 % of band centres in the middle half, was 51 %), a shown band jumps at least 35 % of
  the widest jump at that strength (median 0.54 × shift, was 0.36), and only bands ≤ 3.5 % of the height get a tint, at 0.28–0.48. Tints are left
  out on transparent, green-screen and black frames (plainFrame: `fx.alpha`, or `fx.pal.ground` #00B140, or #000000
  with white ink — the convention the ornament and arrange parts already use): under chroma the tint changed the key
  colour, under black it put colour into a white-text-only frame. Burst gating, rate, amount continuity and the tick
  layout are unchanged (the continuity and layout tests pass as they were).
- **invertBlink: grey frames.** The inversion's strength ramped from the safe amount 0.3 to 0.5; as the post stack's
  `when` weighting lowered amount, the second and third blinks became partial inversions — a flat mid-grey frame, not a
  weaker blink (seen at 0.2 s after an impact at amount 0.6). A blink is now a full inversion while amount × the
  reduce-flash scale is above 0.3 and none at or below it, so later blinks drop out or end early. Flash safety is
  unchanged: the same events, ≤ 3 blinks each, and the pre-flight already counts invertBlink only above 0.3.
- **paperTooth: hairy repeat on dark grounds.** The fibres are mostly light strokes: invisible on light paper, but on a
  dark ground (mapleInk, whose texture it is; any dark theme with it pinned) they read as grey hairs and the 128-px
  fibre tile's repeat shows plainly. Fibre strength now scales with the frame palette's ground lightness (0.3 on black …
  1 on white; 1 without a palette), and on the black backdrop there are no fibres (white text only; the tooth and the
  other film textures vanish on black by themselves). A fibre pass at zero strength is skipped.
- **blendDissolve: two lyrics printed over each other.** One sine curve put both lines at half strength, both sharp, in
  the same place mid-window. Now the old words fade over [0, 0.7] of the window and soften up to 1.6 × `soften`, the new
  ones come in over [0.2, 0.8]: mid-window a fading smudge (≤ 25 %) under the new words (≥ 40 %). u = 0 and 1 unchanged.
- **shoveAcross (broken): the shadow was never on screen.** It was placed at the new frame's trailing edge (outside the
  frame) and ran inward. It now falls from the new frame's leading edge onto the old one, 6 % of the frame deep, drawn
  'source-atop' (on a transparent frame only over the words; the same on opaque frames), left out on the green-screen key.
- **irisGate, blindSlats, plungeZoom on transparent frames (clear backdrop, transparent PNG).** These assumed an opaque
  frame covers what is under it. irisGate showed the old words inside the opening next to the new ones (now cleared
  inside the opening first when `fx.alpha`); blindSlats showed the new words through the old ones from the first frame
  (now the new frame is drawn only in the gaps the slats open, band by band, 1:1); plungeZoom showed both lines at
  full strength mid-window (now the old frame fades as the new one fades in). Opaque frames draw as before. blindSlats'
  shading is 'source-atop' and left out on the green-screen key; irisGate's rim too.
- **glitchSwap: colour blocks.** A tinted strip was the whole strip (7–10 % of the height) in 'difference' cyan or
  magenta at up to 0.6: saturated green, red, magenta and teal bars. The tint is now a seeded sliver of 30 % of the
  strip at up to 0.45, and none on transparent, green-screen or black frames (as sliceGlitch).
- **shutterSnap:** on the black backdrop the blades are #000000 (were #0B0B0D, a faint grey panel in a screen blend).
- **Backdrops (§4.19.4) checked** for every effect under chroma, black and clear: the renderer skips what the table
  says; what runs adapts as above (sliceGlitch tints, paperTooth fibres; grain, dots, scanlines, vignette, bars, dust
  and afterImage behave on black / transparent / green as they should). Transitions: see above.
- **Tests (`lens_filter_seam.test.js`, 40 tests, ≈ 4 s).** New or rewritten, each fails on the HEAD part files (checked
  on a copy of the tree): duoTone ground → ground, ink → full other ink, on a dark and a light palette (a small
  uniform-frame model applies the recorded blend fills with the W3C formulas); sliceGlitch band placement, jump size,
  thin light tints, none on green-screen / black palettes; invertBlink never between 0 and 1 over every `when` and
  amounts 0.32–1 (240 Hz, the post stack's weighting); paperTooth fibre strength light vs dark, none on black;
  blendDissolve alphas and softening at u = 0, 0.15, 0.5, 0.85, 1; glitchSwap slivers, alpha, none on transparent /
  keyed / black; shoveAcross shadow inside the frame against the leading edge, all four directions, none on the key;
  irisGate / blindSlats / plungeZoom on transparent frames; shutterSnap blades on black.
- **Runs.** `build.py --check` OK; `conformance.test.js` 226/226; `lens_filter_seam.test.js` 40/40; browser:
  `fx_parts.py` OK (declared cost vs measured class; timings above), `determinism.py` OK, `contact_sheet.py` self-check
  OK. Full Node run:
  1,034 of 1,036; the two failures are the golden frame hashes (these parts change frames; regenerate once after all
  tuning) and the golden plan hashes (other packages' autos; these files change no auto or param).
- **Seen outside these files (not changed):**
  - **The ground jumps mid-way through a text transition (WP4, `engine/render/renderer`).** Grounds follow the current
    cut's camera, which switches from A's to B's at u = 0.5. With a moving camera on both cuts the ground (parallax
    0.25) jumps by the difference of their poses in one frame: over gridPaper with panSweep or slowPush on both cuts, the
    top fifth of the frame changed 1.3–1.9 (mean abs, 8-bit) at the switch against 0.04–0.09 between ordinary frames.
    Blending the ground's camera from A's to B's across the seam window (or holding A's until the window ends) would
    remove it. At a plain cut boundary the same jump is a new shot and reads as one.
  - **'arrive' effects start weak on instant entrances (WP4, `engine/render/post.whenWeight`).** The 'arrive' weight
    is 1 until the entrance's rest time and then falls over 0.2 s; with instantShow (the fallback, and forced under
    `motion: 'own'` compositions) rest is the cut's `a`, 0.12 s before the sung start, so at the sung start the weight
    is already 0.4: flashPop's arrive flash is a faint wash there, and invertBlink's (the `when` auto on non-impact
    cuts) does not blink unless amount > 0.75. Holding the weight at 1 until `max(times.rest, 0)` would fix it; it is
    the counterpart of the open 'depart' item (`## WP5b2 review fixes`).
  - **whiteFlash under chroma (planner or UI).** The white wash turns the key colour pale green on its way to white, which
    keys as a semi-transparent green veil. A transition cannot flash only the words on an opaque green frame. Leaving
    whiteFlash out of the auto pool under the chroma backdrop (a pin still works) would avoid it; under clear it
    composites cleanly (white with alpha) and under black it is a white flash, as designed.
  - **Sample plans ignore the backdrop palette (WP4, `engine/facade.samplePlan`).** The lab, contact sheets and part
    thumbnails under chroma or black draw with the theme's swatch, not the §4.16.3 backdrop palette, so parts that adapt
    to `fx.pal` (and ornaments / compositions that test the ground) look unadapted there. An additive `fx.backdrop` on
    the FxContext would also spare the parts the ground-colour test they now copy (the key colour is spelled out in eight
    part files).
  - `contact_sheet.py` cannot set params, an impact or impulses, so flashPop, invertBlink and impactKick show nothing on
    the sheet (the sample cut is never an impact; `## WP5b2` asked for this for thumbnails too).
  - Seen and left in my parts: flashPop on a dark theme peaks as a grey veil (≈ 52 % white at amount 0.6) rather than a
    white-out — kept, as the gentler flash on dark frames is the safer one; glowSpill is subtle on light themes (by
    design: a light ground passes the bloom threshold only partly); dotScreen reads as a fine mesh on very dark grounds
    at 1080p; cameras that end away from rest (push, pull, pan) make the ground (parallax 0.25) jump by up to 2 % zoom /
    35 du at a cut, as a new shot does.
- **Strings wanted:** none.

## QA-LOOK (visual QA and tuning: theme, mood; the whole result)

Files: `parts/theme/season.js`, `parts/mood/{calm,lively,story}.js`, `tests/node/catalog.test.js` (three new tests, the
seasonal `prefer` rule widened). `parts/theme/{paper,night,glass,earth}.js` unchanged. Keys, labels, blurbs, tags,
swatches, faces, styles, textures, seasons and every §5.10 / §5.11 table value are unchanged (catalog.test.js still reads
them from DESIGN.md); only `prefer` maps of the four seasonal themes and milder tag biases of five moods moved, so the
registry version is the same but plan hashes change (goldens: regenerate once with the other QA edits).

- **How it was judged.** `contact_sheet.py` sheets of all 16 themes (16:9 ja, 16:9 mixed, 9:16 en, 1:1 vertical ja with
  「」 and 2024) and all 8 moods (16:9 ja on nightTram, 9:16 en on sodaFloat, 1:1 mixed on sumiWashi) — the mood sheets
  are identical by construction (the sample cut holds fallback parts, which no amount moves), so moods were judged in
  the app. The app: a scratch build of the page, `sample_lyrics.txt` pasted into the editor (clipboard + Ctrl+V), the
  real おまかせ button once, then the same `look.omakase` command with chosen seeds so that every mood meets every aspect:
  24 looks (8 moods × 16:9 / 9:16 / 1:1, 24 seeds), 16 more with each theme pinned under a fitting mood, 12 with the
  seasonal themes; six moments each (five holds spread over the song, one transition mid-window), rendered by the
  page's engine at export quality with fallback fonts. Beside the eye, a scratch planner probe over the sample lyrics
  (per mood: themes, orientation, faces, every slot's picks and their tags; per seasonal theme: season motifs).
- **Verdicts — themes.** Good: sumiWashi, monoPress, risoPink, cyanPrint (see the accent note below), nightTram,
  emberGlow, brassLamp, mossStone, chalkBoard, sodaFloat, frostGlass, tidePool. Needed tuning: sakuraFog, cicadaNoon,
  mapleInk, snowLantern. None broken. Palettes, text styles (glow, shadow, duo) and textures read well on every
  aspect; every ink/ground pair is ≥ 9.4 : 1, every fitted accent ≥ 3.5 : 1.
- **Verdicts — moods.** Good: quietHush, dashSprint, silverReel (data; its bars rarely show, see below). Needed tuning:
  dreamHaze, popFizz, glitchFracture, printColumn, heartAche. None broken.
- **Seasonal themes showed the other seasons (needs tuning → fixed).** The sample lyrics name no season (白い息 is one
  hit), so the season is `any` and every season's motifs enter the pool at ×0.5. A seasonal theme then showed other
  seasons' motifs more often than its own: sakuraFog with heat shimmer, fireworks, maple leaves and snow; mapleInk
  with a petal wash (seen: spring theme + heatShimmer ground + leafFall atmosphere; autumn theme + petalWash turned into a
  mauve veil). On the sample lyrics (per theme 8 moods × 12 seeds over 16:9, 9:16 and 1:1) 3.7–4.5 % of the ground
  and ornament picks were another season's motif, against 1.7–2.6 % of its own; 22–24 of 24 videos per theme showed one.
  Each seasonal theme's `prefer` now damps every other season's motif (grounds petalWash heatShimmer maplePaper
  snowLight, ornaments petalFall fireflyGlow fireworkBloom leafFall snowDust) to ×0.005, from one table in season.js
  (`MOTIFS`, `seasonal()`); own entries are kept. After: 0–0.04 % of picks, 0–2 of 24 videos (the neighbour-avoid rule
  can still push a small atmosphere pool onto a damped one); own-season motifs in 85–94 % of videos, 17–22 % of the time.
  A tiny weight rather than 0 keeps `prefer` a weight (0 would silently filter). Pins and `project.season` behave as before.
- **Milder mood biases (needs tuning → tuned; §5.11 strong biases untouched, each new value inside the table's bounds).**
  Seen in the renders and measured with the chooser's geometric mean: popFizz `minimal` 0.8 → 0.6 (tiny corner captions,
  sidebar and diptych layouts made fizzy videos look like a quiet editorial: cornerNote 0.94 → 0.81, fixedFrame / flatFill /
  stillHold 0.8 → 0.6); heartAche `bold` 0.7 (new; sunBurst rays behind a sad line 1.0 → 0.84, edgeBleed 0.71 → 0.59);
  glitchFracture `playful` 0.7 (new; hanging tags and halo rings under a glitch 0.63 → 0.53, 0.77 → 0.65); printColumn
  `soft` 0.8 (new; bokeh dots and sky gradients on a letterpress page 0.71 → 0.63, 0.95 → 0.85); dreamHaze `retro` 0.8
  (new; manuscript grids and tape strips in a haze 1.0 → 0.89). quietHush is the §4.18.14 example and was left alone.
  The effect on whole videos is small (≈ 1 point of tag share), see the planner notes below for why.
- **Tests (`catalog.test.js`, 26 tests, ≈ 2.5 s).** The `prefer` rule now allows a seasonal part only as a favour (≥ 1)
  by its own season's theme or as a damping (< 1) by another season's theme. New: every seasonal theme damps every §5.5 /
  §5.6 season motif of the other seasons to ≤ 0.01 and none of its own; on the sample lyrics (season `any`, 8 moods × 3
  seeds/aspects, whole catalog) a seasonal theme's ground/ornament picks hold ≤ 0.2 % other-season motifs and its own
  season shows in ≥ 70 % of videos; the five moods lean away (bias ≤ 0.9) from the parts that looked out of place in
  their renders. All three fail on the HEAD files (checked on a copy of the tree); the other 23 pass as before.
- **Runs.** `build.py --check` OK; `conformance.test.js` and `catalog.test.js` pass; `planner_variety`,
  `planner_stability`, `i18n`, `ai_looks` pass. Full Node run: all pass except the two golden hash tests (plans and frames;
  the parallel QA tuning changes them too — regenerate once, `node tests/update_golden.js`).
- **For the planner / DESIGN (not changed here; numbers from the sample lyrics).**
  - *A mood's themes are a coin flip.* `mood.themes[key] ?? 0.4` (§4.16.3) gives the 11–12 unlisted themes together as
    much weight as the listed ones: the listed share is 51–64 % per mood (heartAche 51 %, quietHush 64 %). Seen: quietHush
    on cicadaNoon (heavy pop face, summer yellow), popFizz on frostGlass / snowLantern / emberGlow, dreamHaze and
    heartAche on risoPink, silverReel on frostGlass, printColumn on nightTram — the mood's name and the picture disagree.
    Default 0.15 would give 74–83 %, 0.1 gives 81–88 %. Before lowering it, give chalkBoard a home: no mood lists it, so
    it is reachable only through the default (e.g. printColumn 1.2 and heartAche 1.0 in §5.11).
  - *Moods differ little.* The chooser's geometric mean over tags, Gumbel noise at variety 0.8–1.2 and recency flatten
    the biases: quietHush still takes `fast`-tagged parts in 6 % of picks (dashSprint 13 %), `minimal` is 17–22 % in every
    mood, arrange picks are 6–10 % each under every mood. A stronger mood factor (e.g. moodBias^1.5 in §4.16.4) would
    do more for "each mood feels like its name" than any milder bias can; check it against the variety and stability tests.
  - *quietHush has no bold/bright bias* (§4.18.14 = §5.11 row, test-frozen), so sunBurst ("rays radiating from behind
    the text") scores 1.0 and was 8 % of its ornaments — rays behind the words in 3 of 3 quietHush looks. Suggest adding
    `bold: 0.6, bright: 0.8` to that row.
  - *Signature filters rarely show.* `filter.count = floor(0.8·max(glitch, chroma) + r)` (§4.16.4) ignores moods whose
    signature is not a glitch: silverReel (blurb: "Letterbox bars, film grain…") gets 0.15 filters per cut, so cinemaBars
    is on ≈ 3 % of cuts; printColumn 0.07, quietHush 0.04 per cut. Suggest `max(glitch, chroma, 0.5 + texture/2)`-style
    driving, or a per-mood filter pace.
  - *Work texture again as filter#i* (INT-PLAN/WP5c, still open): risoPink's dotScreen texture plus a dotScreen filter on
    one cut doubled the dots (dreamHaze 16:9).
  - *Season `any` and non-seasonal themes:* seasonal parts still reach every other theme at ×0.5 (nightTram with maple
    paper and falling leaves, emberGlow with a petal wash). ×0.25 for `any`, or taking a seasonal theme's season as the
    project season when no season was found (which would make the season.js damping redundant), would settle it.
  - *cyanPrint's accent is too close to its ink* (§5.10 colours): #9FD3FF vs #EAF2FA is OKLab 0.131 apart (the lowest of
    all themes; brassLamp 0.192), so emphasized words barely stand out. Swapping accent and shiftB (#F2C14E, blueprint
    yellow) gives 0.197 at 6.8 : 1 on the ground.
- **Seen in other parts (not changed; owners' files).**
  - `arrange/core.js` giantWhisper, tuck `beside`: the words before the giant are stacked to its right too, so the line
    reads out of order — 「向こうで｜改札の」 (sakuraFog 1:1), 「ため息｜昨日の／を」 (monoPress 16:9). Use `beside` only when
    there are no words before the giant (the condition at `p.tuck === 'beside'`), or set them to its left.
  - `arrange/editorial.js` diptychSplit: when `text.columns` returns one piece (「昨日のため息を」), the piece goes to the
    tinted panel and the other half of the frame stays empty (9:16: text in the top half only; 16:9: right half only).
    Suggest a `fits` near 0 for one-piece lines without a note, or a character split at the best phrase boundary.
  - `arrange/scatter.js` haloRing with `tangent` and a wide sweep (auto 150–360°): the first glyphs sit at 7–8 o'clock
    turned 90–150°, i.e. sideways or upside down (「昨日の…」, 「紙ひこうき」 in four looks). Cap the tangent sweep near 200°
    centred on the top, or turn glyphs below the horizontal to read outward.
  - `arrange/scatter.js` hangingTags, two tiers in 1:1: 「昨日の」 upper left, 「を」 upper right, 「ため息」 lower middle
    reads 昨日の → を → ため息 at a glance.
  - `engine/text/breaker` (QA-LAYOUT's note on な/も): centerAnchor sets 「まだ名前のな／い今日へ行く」 (every mood
    sheet); another case for the particle rule.
  - Ornaments over sidebarIndex's number: barCode across the big "22" (sakuraFog 1:1), tapeStrip over its rule (sodaFloat
    16:9). The number is not in the text box the decorations avoid.
  - Small type by design, legible at export size: sidebarIndex sets the lyric at 0.07 of the short side (75 px in
    1080 × 1920) and cornerNote at 0.05–0.074 (its `size` auto); at preview size in 9:16 both read as captions.
- **Strings wanted:** none.

## final fixes (ui-fields)

Files: `ui/{fields,widgets,part_browser,inspector,timeline}.js`; small edits to `i18n/strings.js` and `ui/style.css`
(shared with ui-data); tests in `tests/node/ui_fields.test.js` (7 new tests, with a small fake DOM for the widget and
part-browser tests). Each new test fails on HEAD's versions of these files and passes now.

- **ux-1 (major) 塗り, not 強調色.** `el.text.fill` replaces the whole text element's ink (§3.4.3, frozen; builder.fill
  recolours glyphs, rules and threads), so §6.4.8's 「強調色 (emphasis)」 was the wrong reading. `fld.emphInk` (key kept)
  now reads 「塗り（強調・線も同じ色）」 / "Fill (all text, emphasis and lines)". The color widget no longer falls back to
  #000000: `widgets.colorView(value, path, palette)` resolves a hex or a palette token; without a value it says 自動 —
  for `el.text.fill` 「自動（文字色とアクセント）」 with a diagonal chip of ink and accent — with no hex, no contrast line,
  and the native picker opening at the accent. Test: every color FieldSpec unpinned shows no black (the fixture palette
  holds none); the widget in ja and en (name, hex box, contrast, picker, chip), then pinned.
- **perf-3 (major) part browser.** `pickerPage` builds its tiles once per plan and asks `o.alts()` (explain, which re-runs
  the planner) once per plan, in an idle callback after the page shows. Tabs, tag chips and the search only choose and
  order the existing tiles (the ones left out wait outside the grid; the same elements come back); tab and tag buttons
  update in place, so the focus stays on them. Until the first answer おすすめ holds 自動に戻す and the current part only
  (no tile appears that the answer would take away); after a new plan the last answer shows until the next lands. A
  focused tile keeps the focus when the order changes; one that leaves hands it to 自動に戻す; `refresh()` (bus `plan`)
  keeps the focused part focused. Thumbnails are drawn when a tile first shows. Also fixed on the way: the filter
  (使わない設定 dimming) and the mood were read once at open, so a right-click 「この部品を使わない」 did not dim the tile
  on refresh. Measured on project_long (line 4 → 入り, this shared-CPU Chromium, HEAD vs now, two runs each): open click
  98/105 ms → 15/15 ms; search input handlers 43–106 ms → 1.5–6.4 ms; tab back to おすすめ 44–53 ms → 6–8 ms; explain
  calls for open + 6 inputs + 4 tab clicks 9 → 1. The one explain (70–90 ms here) still runs as one long task, now in
  an idle slot; making `planner/explain` cheaper (it traces a whole re-plan) is the planner's.
- **spec-4 (major) enum option labels.** 47 `opt.<value>` strings (ja/en) for every string value of every registered enum
  parameter. One key serves every part that uses the value, so places and directions share plain nouns (左 / 上 / 中央 …;
  `split` 上下, `x`/`y` 横軸/縦軸, `start`/`end` 行頭/行末 for edgeBleed's anchor). In dev builds (`MV.DEV`) a missing
  option string is reported with `console.warn` instead of silently showing the value. The coverage test is in
  `ui_fields.test.js` (i18n.test.js is not this fixer's file): every enum value of the stub and catalog registries has a
  non-empty ja and en `opt.<v>`.
- **spec-5 (minor) なぜ in words.** `fields.whyParts(ex, path, t, plan)` (pure) replaces the inspector's `whyParams`:
  mood and part keys → labels; tag, scope, by, amount → their strings; `rule` → `whyRule.<rule>` (`fields.whyRuleKey`:
  element slots share `whyRule.el.nudge|fill|hide`, `el.text.fill` has its own, `ornament#i`/`filter#i` beyond the count
  → `whyRule.slot`, the mood slot's own rule → `whyRule.moodPick`); a cut key → 「3行のカット2」 / "Cut 2 of Line 3" (the
  breadcrumbs' labels, `why.lineCut`); the family id is dropped (`why.family` no longer has `{family}`). `why.rule` is
  now `{rule}` and the 40 `whyRule.*` texts are short phrases like the other reasons. A reason that would still show an
  id is left out. `why.gate` now says what the gate is (the part is used only while that amount is above 0), `why.pin`
  en "Pinned for {scope}". Test: every row path of every page of three corpus projects (catalog) explained and rendered
  in ja and en: no Latin letters in ja (LRC aside), no code-shaped words in either, and every rule the planner names has
  its own string.
- **ux-16 (minor) strings.** The named ones: 拍に合わせる 切る → しない; 知らないサービスです → 対応していないサービスです;
  ＊ = いま自動で選ばれているもの; err.file.newer says the file was not opened; the preview hint 「「① 歌詞」に歌詞を貼り付けると
  動き出します」 / "Paste lyrics into step 1 (Lyrics) to start". Reviewed the rest: パーツ → 部品 in the planner warnings
  (the UI's word), orphan-pin 「どのカットにも合わなくなった固定があります」, empty.preview 「ここで歌詞が動き出します」,
  why.recent 「前のカットと同じにならないように」 (重ならない meant overlap), readRate 「1秒あたりの音数」 (not モーラ),
  keys.singleNote 「オフにできます」 (切れます was ambiguous), insp.fontFailed 書体 (not フォント), ai.warn.unknown
  存在しない, pb.autoTip 「自動で選ばれるようにする」, the timeline proxy joins its parts with 、 (`tl.proxySep`). English:
  one spelling (color, favor, center, neighboring, recognized, licenses — also ui-data's io.encodingUnknown), Recent
  projects / Started a new project (not "works"), Orientation, Type, Angle, End (next cut's start), tag.wet Mellow.
- **style.css, shared rules.** Repeated declarations are restated without changing the look: one shared one-line rule
  (`.ell, .doc-title-text, .song-name, .strip-text, .w-part-name, .w-font-name, .w-font-sample, .pb-name, .pal-text,
  .fr-label, .w-slot-skip { white-space; text-overflow; overflow }`, min-width stays in each rule); `.looks-grid, .pb-grid`
  share one two-column rule written `minmax(0, 1fr) minmax(0, 1fr)` (the no-op `.mv[data-layout="wide"] .pb-grid` copy
  is gone); `.insp-num` uses `text-align: end` in its own order; `.w-nudge-cell` is one rule (the later override merged).
  A test checks that none of the merged runs is back.
- **Needed outside these files (not changed here):**
  - DESIGN §6.4.8 (文字 row): `強調色 el.text.fill (emphasis)` → `塗り el.text.fill (the whole text element in one color:
    glyphs, emphasis and rules; §3.4.3)`.
  - `ui/project_io.openProject`: to name the file in err.file.newer, add `{name}` to both texts and pass `name: file.name`
    (today the call passes only `{ n }`, so the text is written without the name and reads right as is).
  - `tests/browser/ui_flows.py` needs no change (all 18 flows pass on HEAD + these files). Note for flows that want
    *another* tile: until explain() answers, おすすめ holds 自動 and the current part only, so wait for
    `.pb-tile[data-key]` count > 2 before OTHER_TILE (flows that wait for > 1 pick the current part meanwhile, which
    still pins). The item's suggested ui_flows assertion (explain ≤ 1 call over open + 3 keys + 2 tab switches on
    project_long) is covered in Node by the perf-3 test; ui-data may add it to the `keys` flow.
- **Declined / changed from the suggested fix:** the preview hint drops 「左の」 (in the stacked layout the steps sit
  below the preview); family names are dropped rather than given 58 `family.*` strings (internal groupings with no
  user-facing meaning); the enum coverage assertion lives in `ui_fields.test.js`, not `i18n.test.js` (not this fixer's
  file).
- **Ran:** `node --test tests/node/ui_fields.test.js tests/node/i18n.test.js tests/node/ui_*.test.js` 121/121;
  the whole Node suite on the working tree 1067/1072 (the 5 failures are the stale golden plan/frame hashes and three in
  other fixers' files in progress: an arrange layout test, conformance of edgeBleed, planning speed) and on a copy of
  HEAD + these files 1042/1045 (goldens, and encodeWav which needs the repository's `src/` outside the copy);
  `build.py --check` 174 modules OK; browser on HEAD + these files: `i18n_pages.py` OK (18 screens × 2), `ui_flows.py`
  OK (18 flows; first-run MP4 skipped, no H.264), `ui_layout.py` OK (300 layouts).
- **Strings wanted:** none.

## final fixes (ui-data)

Files: `ui/{project_io,boot,tap,looks,steps,palette,dialogs,stage,step_song,lyric_editor,ai_panel}.js`; small edits to
`i18n/strings.js` and `ui/style.css` (shared with ui-fields); tests `tests/node/ui_data.test.js` (new, 6 tests),
`tests/browser/ui_flows.py` (+7 flows, 25 in all), `tests/browser/ui_layout.py` (an empty-editor pass). Every new test
was run on a copy of the tree with these UI files (and `style.css`) at HEAD: the 6 Node tests and all 7 new flows fail
there, and the empty-editor pass reports the finding's numbers (en 1024×600 hidden by 52 px, 1100×650 by 2 px,
1200/1360×600 by 3 px, a gutter beside every empty placeholder).

- **flows-1 (UI half; the side sanitizer is the engine fixer's `D.sanitizeSide`, now in `migrate.parseFile`).**
  `openProject` parses the whole file before anything changes; a parse failure that is not a `MigrateError` reads
  「作品ファイルが壊れています」 (`err.file.invalid`, n ≥ 1), never 「JSONではありません」; a failure while loading reads
  `err.command` instead of claiming the file was unreadable. In `installStore` the 'doc' listener replans first and then
  records the look inside try/catch, so a look history that cannot be recorded never leaves the preview on the old plan
  or skips the autosave. Defence in depth for a damaged side that reaches the UI some other way: `looks.listOf` reads a
  non-array list or non-object entries as the usable entries only (`record` never spreads a non-object `looks`), and
  `steps.statusOf` reads the list the same way.
- **flows-2.** `writeNow` reads the work id, its name and the serialized text before anything waits and writes exactly
  those; `flush()` returns the pending write's promise, and `loadFile` / `newWork` / `openRecent` await it before the new
  work takes over (`openRecent` flushes before it reads the record, so re-opening the current work gets its last edit).
- **flows-3 (two tabs).** Each tab holds a Web Lock `mojipv-work:<id>` on the work it writes (`navigator.locks`,
  ifAvailable; released when the work changes). `restore()` asks for the newest work's lock, waiting up to 1.5 s (a
  reloaded page can still see its previous document's lock); when another tab holds it, this tab continues in a copy
  under a new id and says so (`io.tabCopy`); 最近の作品 into a work open elsewhere does the same. Second guard, for a
  browser without Web Locks: every record stores the writing tab's token (`writer`); a tab that adopts a record claims
  it, and a write that finds another tab's token goes to a new record with the toast `io.forked` instead of
  overwriting. Chosen over "start empty and offer 最近の作品": the second tab shows the newest work at once and nothing is
  lost. The token check is skipped on the page-hide write (below), which must put without a read.
- **flows-6.** `schedule()` sets the save state to 'saving' at once, so the header reads 保存中… until the write lands.
  `pagehide` and `visibilitychange` (hidden) write the pending autosave in the same task: the connection is kept open, the
  put needs no await, and the transaction is committed explicitly (`tr.commit()`; without it Chromium dropped the write
  when the page went away — measured). 言語 switching uses the same path.
- **flows-7.** `openLyrics` reads bytes: a BOM wins (UTF-8, UTF-16 LE/BE); otherwise strict UTF-8, then Shift_JIS and
  EUC-JP (the one that decodes without an error; when both do, the one with fewer half-width-kana/private-use characters).
  A legacy encoding is named in the toast (「Shift_JIS として読み込みました」, `io.encoding`); bytes that decode nowhere
  are read as UTF-8 with a warning (`io.encodingUnknown`). Pure `decodeText` is exported and Node-tested.
- **flows-4.** While tapping without a ready song, the clock's end (`app.clockEnd`) is `max(duration, last line's t0) +
  600 s`: `onTick`, `seek` (←/→ ±3 s too), `play`, `pause` and `syncPlayer` use it, and entering or leaving tap mode lays
  the stopped player out again (after a session that ran past the automatic end, the time comes back inside the video).
  `tap.start` pauses first, so a preview that was playing does not keep the old length.
- **flows-8.** `recordLook`: when the look history is still empty and there are lines, the look before the change is
  recorded first as 「最初の見た目」, whatever brought the lyrics in (typing, the AI, a drop). Chosen over recording at
  the first plan with lines: the history then starts where a look is first changed, and nothing is written while typing.
- **flows-9.** `tap.cancel()` ends a session without recording; `app.loadProject` calls it (open, new, recent, drop), and
  so does a lyric file opened during a session (its marks belong to the lines being replaced).
- **security-3.** `prune()` also deletes every stored song that no kept work (their saved `doc.song.sha1`), the current
  document, or this tab's undo history uses. "This tab's undo history" = songs it stored or re-linked since the last
  load (loading clears the history, §6.10), so 外す then Ctrl+Z still re-links from IndexedDB. The ≡ menu entry
  「この端末に保存した作品と曲を消す」 was optional and is not added (≡ menu is `menus.js`, not this fixer's file).
- **ux-2.** The palette's order is a pure `palette.order`: settings (`pref.*`) and the language switch are always last;
  then recent commands; with an empty query the starters next (おまかせ, 再生, 詳細, the four steps, timeline, tap, export,
  keys). A setting run from the palette toasts 「「…」をオフにしました（≡ メニューで戻せます）」 — "≡ menu", not "≡ › 設定",
  since some toggles live under 表示.
- **ux-3.** `firstRun` seeks to line 1's lead only when it autoplays; otherwise to line 1's hero frame (`repT`, as
  seeking on select, §6.5).
- **ux-4.** The empty editor (`.lyric-editor.is-empty`, toggled with the placeholder) has no gutter; the placeholder and
  the caret take the full width; [サンプルで試す] sits right under the title.
- **ux-9, ux-10.** The tempo field's placeholder is an example (例: 120); a disabled 拍に合わせる row is dimmed
  (`.check-row:has(input:disabled)`) and says why on a visible line under it (also its aria-describedby). The song error
  box stacks the message (full width) over its button; `err.song.decode` names the file and the formats; 「曲がなくても
  作れます」 stays under the box.
- **ux-11.** Step ③'s dot counts look pins only (`steps.LOOK_PIN`): work pins of bpm, beatOffset, readRate, length and
  titleCard no longer mark ③ done.
- **ux-12.** `app.closePanel()` (Esc at the root, ×, the header toggles, AI switched off): when focus was inside the
  column it goes back to what opened it, else to the stage — never to <body>.
- **ux-13.** The ? sheet has one row per command in every context, listing all its keys (`dialogs.keyRows`, pure), and
  states the look rule (§6.6) before the single-key note.
- **ux-19.** Between lines the preview's name is 「プレビュー: 歌詞のない部分（0:00.50）」 (`a11y.previewGap`); the idle
  card's text only while there are no lyrics.
- **perf-5 (UI half).** The stage owns the resolution step: the backing's short side is ≤ 1080 (自動 / なめらか優先), and
  ≤ 720 while the adaptive preview is at level ≥ 3 (back up at ≤ 1: hysteresis, so it does not flip every few frames);
  the canvas keeps its CSS size.
- **perf-6.** Changing プレビューの画質 lays the backing out at once. きれい優先 = full device ratio and no step-down: the
  stage calls the facade's additive `setLevel(0)` before each frame, so no renderer option is needed. A 軽量表示 badge
  (top right, apart from the try-on badge) shows while the level is ≥ 1.
- **spec-3.** A button of the header, play bar or step tabs that got focus from a pointer press leaves Space to the
  shortcut (play / pause); keyboard focus keeps Space as activation. Tracked with pointerdown / focusin (cleared by Tab):
  `:focus-visible` cannot tell them apart, since Chromium makes the focused element match it on the key press itself.
  Chosen over moving focus to the stage after every click (which would also change where Tab goes next).
- **spec-7.** `ui_flows.py` flow `tap` (§8.3 "tap-sync 5 lines with Backspace"), with the checks the item lists.
- **Tests.** `ui_data.test.js`: `decodeText` (BOMs, UTF-8, Shift_JIS, EUC-JP, junk), `songsInUse`, a damaged look
  history, ③'s status, the palette order, the ? sheet rows. `ui_flows.py`: `open_damaged` (flows-1), `autosave` (flows-2,
  -6, -7, security-3), `tabs` (flows-3; two pages of one browser context), `tap` (spec-7, flows-4, flows-9), `first_look`
  (flows-8, spec-3, ux-2, ux-11, ux-12, ux-13, ux-19), `preview` (ux-3 with reduced motion; perf-5/6 at DPR 2), `song_step`
  (ux-9, ux-10). `ui_layout.py`: the empty editor at every viewport plus 1024×600, 1100×650, 1200×600 and 1360×600.
- **Needed outside these files (not changed here):**
  - `engine/render/renderer.render` (perf-5, renderer half): apply `DPR_STEP` only while the surface's short side is
    still above 720 — `const dpr = level >= 3 && Math.min(sw, sh) > 720 ? DPR_STEP : 1;` — so a preview the stage has
    already stepped down to 720p does not pay the 0.75 draw plus the upscale on top.
  - Optional (security-3): a ≡ › 設定 entry 「この端末に保存した作品と曲を消す」 in `ui/menus.js` that deletes both
    IndexedDB stores (and the AI keys); `project_io` would need a `clearDevice()` for it.
  - DESIGN §6.4.15 could say that without a song the silent clock runs past the automatic length during tap mode, and
    §6.14 `project_io` that each tab holds a lock on the work it writes.
- **Declined:** none of the items; the changes from the suggested fixes are named above (flows-3 copy, flows-8 place,
  spec-3 mechanism, ux-2 toast wording).
- **Ran:** see the report; `build.py --check` 174 modules OK; Node `ui_*` + `i18n` 121/121, the whole suite 1073/1075
  (the two stale golden hash tests, expected until the final run regenerates them); browser (staging copy of the tree,
  local Chromium): `ui_flows.py` 25 flows OK (first-run MP4 skipped: no H.264), `ui_layout.py` OK (328 layouts),
  `i18n_pages.py` OK (18 screens × 2), `transparent_check.py` OK; `csp.py` OK on the tree itself.
- **Strings wanted:** none (added `io.tabCopy`, `io.forked`, `io.encoding`, `io.encodingUnknown`, `pal.prefOn`,
  `pal.prefOff`, `a11y.previewGap`, `play.lightPreview`; changed `song.tempoNone`, `err.song.decode`).

## final fixes (look)

Files: `planner/{plan,features,encode,cast,choose,look,explain,segment}.js`, `parts/arrange/{core,columns,editorial,
scatter}.js`, `parts/mood/{calm,story}.js`, `parts/theme/paper.js`; tests `planner_determinism`, `planner_pins`,
`catalog`, `arrange_dwell`; DESIGN §3.4.1, §3.8, §4.11, §4.16.3–§4.16.5, §4.16.7, §4.18.14, §5.10, §5.11 (small edits,
§9.4 changes named there). Plan hashes, frames and the registry version change: the goldens are for the final run.
Every new test fails on HEAD's files (checked on `git archive HEAD` + the new tests) and passes now.

- **perf-2 (major): typing re-planned cold.** `featuresOf` keyed the feature *id* on its inputs (absolute t0/t1 and the
  song key with the duration), so one more character in a lyric row moved every later automatic line and no cast was
  reused (0 of 245 in project_long). The id is now the features' value (`intern(canon(feat))`; the input-keyed map
  only finds the object). `pos` is rounded to 1/100 (the resolution parts read; DESIGN §4.16.7), so a small move
  keeps the features. The encoding cache is keyed relative to t0 (text, marks, window lead/length, ground, seam,
  shared look, song terms); a cut that only moved in time reuses its fingerprint and printed decisions and gets new
  absolute numbers (`encode.retimeCut`). **Bug found on the way:** with the value id, the cast id no longer stands for
  the text (「あ」→「い」 keeps the features), and the old encoding key would have reused the old text — the key now
  holds `text` (16 of 41 same-feature swaps were wrong before that). The plan hash hashes each cut as one joined flat
  text with a loop of its own (`feedText`): sharing `feed` with encodeCut's pieces left that loop about 3× slower in
  some plans (a pin re-plan of project_long 5 → 7 ms after the title card change; now 5.4). Measured (Node, project_long,
  catalog, 30 keys into row 31): cast reuse 0 → 96 %, typing re-plan median 36 → 12–14 ms; pin re-plans unchanged
  (test best 4.5 ms). `plan.reuse = { cuts, casts }` (non-enumerable, like `env`) lets tests see the reuse. Test
  (`planner_determinism`, catalog): 40 keys typed, cached plan == fresh plan after every batch, ≥ 60 % casts reused,
  best batch ≤ 30 ms, and a same-feature swap reaches the plan. Left for the UI owner: the 120 ms typing debounce.
- **spec-1 (major): no title card on the paste → おまかせ path.** Automatic lines start at leadIn (1 s), below the 1.5 s
  the cutter needs, and time was kept only for a card pinned true. `planner/plan titleCardTime`: with a title, pinned
  true → 2 s, pinned false → 0, not pinned → 2 s when no line has a start anchor (all `by.start === 'auto'`; else it
  re-solves with 0, so an LRC or tapped line is never moved or squeezed for an automatic card, and back-filled lines
  keep their times). A non-boolean pin counts as not pinned (segment already treated it so). DESIGN §4.11, §3.4.1,
  §4.16.5. Test (`planner_pins`): [ti:] + auto lines → `title` on [0, 2) and the first line at 2.0 (stub and catalog,
  with a song too); pinned false → no card, first line at 1.0; pinned true → card; no title → 1.0; LRC first line at
  1.0 → no card, no title-skipped / time-compressed; a start pin later on → the same times as without a title.
  project_long and the vertical/basic fixtures now open with a card (goldens).
- **spec-6 (minor): tickerMarquee dropped `|note`.** The note is drawn once, still (no `move`), small (0.36 em, clamped
  to 3–5 % of the short side, body face, plain), beside the strip where the copies start: above it (left of a vertical
  strip), on the other side when that leaves the safe area; it fades with the strip (runEdgeFade) and is in the focus.
  The `tickerMarquee` skip is gone from the notes test; a new test checks 3 aspects × h/v × pos 0.15/0.5/0.85.
- **Moods look like their names (DESIGN §4.16.3/§4.16.4/§5.11, §9.4 changes).** Measured on the sample lyrics
  (8 moods × 3 aspects × 6 seeds, catalog; before → after):
  - unlisted themes 0.4 → **0.15**, after giving chalkBoard a home (printColumn 1.2; it was listed by no mood): a
    listed theme in 44–78 % → 72–100 % of looks. Explain's theme alternatives use the same constant.
  - moodBias **^1.5** (the geometric mean to a power): quietHush fast-tagged picks 5.9 → 4.2 %, dashSprint 13.5 → 15.1 %.
    ^2 was tried: 3.4 vs 16.6 %, but it broke the insertion-locality test (a change 6+ cuts after an inserted line,
    synthetic and catalog), so 1.5 it is; all variety and stability tests pass with it.
  - quietHush `bold 0.6, bright 0.8` (§4.18.14 example; not a §5.11 strong bias): sunBurst 5.7 → 3.0 % of its
    decorations.
  - `filter.count` drive = max(glitch, chroma, **texture × the mood's top filter weight**): effects per cut silverReel
    0.15 → 0.55 (letterbox bars on 3 → 13 % of cuts), printColumn 0.07 → 0.22, quietHush 0.05 → 0.31, heartAche
    0.24 → 0.31, dreamHaze 0.19 → 0.30; glitch moods unchanged.
  - the **work texture** leaves every `filter#i` pool (`cast.poolBy`; a pin still works): 47 → 0 doubled textures.
  - **season any**: a seasonal part is ×0.5 only when it is the theme's own season, else ×0.25 (`seasonFactor(part,
    season, home)`; themes keep ×0.5): stray seasonal picks under non-seasonal themes 1.6–3.9 → 1.2–3.2 per look.
  - **whiteFlash under chroma**: seams read `amounts.flash` as 0 under the green-screen backdrop (`look.gateAmounts`,
    used by the pools and explain's masks): 19 → 0 in 24 looks; a pin still works.
  - **cyanPrint** accent #9FD3FF ↔ shiftB #F2C14E (§5.10): accent–ink OKLab 0.131 → 0.197, 6.8 : 1 on the ground.
    (mossStone 0.135, snowLantern 0.138, tidePool 0.147 are as close but differ in hue/chroma; left.)
  Tests (`catalog.test.js`): listed themes ≥ 65 % per mood and every theme listed somewhere; quietHush fast share
  < 0.36 × dashSprint's; film moods' effects per cut and silverReel's bars, no texture repeated as an effect; the
  season factors; accent vs ink (cyanPrint ≥ 0.18, all ≥ 0.13); whiteFlash never auto under chroma (pin works);
  quietHush × sunBurst ≤ 0.9 in the off-picture list.
- **Compositions.** giantWhisper `beside`: the words before the giant stand to its left, the words after it to its
  right (both centred on its height), so 「昨日のため息を」 no longer reads ため息｜昨日の／を. diptychSplit: `fits` 0.05
  for one-word lines (`words < 2`, which matches `text.columns(…, 2)` returning one piece on all 70 corpus lines);
  pinned, it still sets one piece. haloRing: glyphs turned along the arc keep to 200° centred on the top (end glyphs
  ≤ 100°, never upside down); upright rings keep the full sweep. hangingTags: two tiers read row by row (the first
  ⌈n/2⌉ tags above, the rest below in the gaps); the type is equal or larger in 15 of 18 probes (9 lines × square/tall
  and 16:9), 2–12 % smaller in the other three.
  sidebarIndex: the focus is the whole block (column, number, rule, note), so decorations avoid the number. Tests
  (`arrange_dwell`): reading order of giant and whispers (5 aspects × 5 texts × both tucks), no turned glyph past
  100°, diptych fits vs columns and both panels filled, tag reading order (4 aspects × 7 texts × cards, drop 0),
  sidebarIndex focus holds every run.
- **Test bound moved, not a look change:** `arrange_dwell` "long lines in square and tall frames" sidebarIndex 0.06 →
  0.05 of the short side. With the engine fixer's §4.15.3 particle rule 「一度言えなかったー」 (9 cells) can no longer be
  broken, and it sets the size in the column beside the number, which already takes all the width the picture gives
  (1:1 54 du, 9:16 59.5; 69–76 with HEAD's breaker).
- **Declined:** a stronger mood power (above); flipping lower halo glyphs (reversed reading along the bottom arc);
  a per-mood filter pace field (a new mood field needs `core/registry`, not mine; the texture-driven count does it).
- **For the engine owner / lead (not my files):** `determinism.py` now fails on `catalog vertical` (frames 31/59 alone ≠
  after the frames before; 30 vs 60 fps at 2.67 s). It is **pre-existing**: on an untouched `git archive HEAD` tree with
  `work:ground` pinned to washiFiber in `project_vertical.json` it fails the same way; with washiFiber's paper paint
  animated, with `filter.count` 0 and texture none it still fails (frames 31/59), so it is the washiFiber ground under
  the title cut's dollyOut camera in the renderer, not a filter. The tuning above makes the vertical fixture pick
  washiFiber (sumiWashi prefers it ×3) instead of inkWash. Worth a look in `engine/render` (paint cache / ground
  camera); the fixture could also pin its ground meanwhile.
- **Ran:** Node, my area (`planner_*`, `fields`, `catalog`, `conformance`, `parts_motion`, `arrange_dwell`,
  `parts_world`, `lens_filter_seam`): all pass except the golden plan hashes; whole suite 1079/1081 (the two golden
  hash tests); `build.py --check` 174 modules OK. Browser: `contact_sheet.py` self-check OK and sheets of the six
  compositions in 16:9 / 1:1 / 9:16 on cyanPrint (looked at), `parts_gallery.py` OK (catalog 2,422 renders, 0 CSP
  violations), `ground_contrast.py` OK (1,728 renders), `determinism.py` FAILED on vertical only (above).
- **Strings wanted:** none.

## final fixes (engine)

Files: `core/{doc,migrate,commands,lyrics,color}.js`, `ai/song.js`, `engine/text/breaker.js`, `engine/scene/{build,stagger}.js`,
`engine/render/{draw,renderer,sprites,post,surface}.js`, `engine/facade.js`, `export/host/sink.js`, `parts/kit.js`,
`i18n/strings.js` (one key), `tests/browser/contact_sheet.py`; tests in `doc`, `lyrics`, `breaker`, `ai_song`, `facade`,
`frame`, `script`, `export_math` (each new test fails on the HEAD file it covers — checked on a copy of the tree with only
that file from HEAD, plus the stats counter where the test reads it). Goldens not regenerated (stale on purpose).

- **flows-1 / security-1 (engine half).** `D.sanitizeSide(side)` (core/doc), called by `migrate.parseFile` instead of
  `normalizeSide`, so open, restore and 最近の作品 all go through it. Side is history, not undoable, so bad parts are
  dropped, never refused: `looks` must be an object; an entry is kept when `n` is an integer ≥ 1 (first entry per `n`
  wins), seed/moodSeed uint32, `salts` keys pass `paths.scopeKey` with integer values ≥ 1, `scope` a string, `label`
  `[string, object]`, `star` boolean; `cap` an integer in 1..500, else 50; an `aiLog` entry needs string `runId`/`tool`,
  a finite `at`, an integer `n` ≥ 0, `applied` a list of objects, `groups` absent or a list. Other side keys are dropped;
  kept entries are the same objects. `doc.song.info` is validated (`D.songInfoProblems`): an object whose present keys
  have their types (`summary`/`mood` strings, `bpm`/`duration` numbers, `sections` [{kind ∈ `D.SECTION_KINDS`, numbers
  start < end}], `highlights` [{time number, what string}]); keys may be missing (partial analyses such as `{ mood }`
  are valid, as `commands.test` already relied on). A malformed analysis makes the file `invalid`, like any other doc
  field. The `song.info` reducer checks the same rule, so the store can never hold a document that would not open again.
  `SECTION_KINDS` moved to core/doc; ai/song reads it, and `songContext` skips sections/highlights without finite
  times (a prompt never fails on one). The UI half (openProject, installStore) is ui-data's (done, `## final fixes (ui-data)`).
- **flows-10 / spec-2 (LRC ID tags).** `[au:]`, `[length:]`, `[tool:]` and `[#:]` are meta rows (ignored), next to
  ti/ar/al/by/offset/re/ve; one pattern `L.META_ROW` plus `L.isMetaRow(src)` exported. `[offset:]` is still ignored
  (not honoured: it would move every stamp, a behaviour change nobody asked for yet).
- **ux-8 and QA-LAYOUT/QA-LOOK's な/も note (breaker, §4.15.3).** Before hiragana a particle ends a phrase only when it
  cannot be the start of the next word: after a long chunk (≥ 6) only は が を に で と へ の (and も, but not before
  う or っ: もう, もっと); after a kanji/katakana word (chunk ≥ 3) の は を へ also end it (名前の|ない; not 背の|び,
  手の|ひら); never before a stacked particle (では, のは, でも + kanji). In a long chunk a kanji after hiragana starts a
  new phrase (…ってもう|一度…), except after the prefixes お ご. Results on the sample lyrics: まだ名前の|ない今日へ|行く,
  数だけ強くなれる, 君のいない世界なんて, ほどけた靴ひもを|結び直して, 「ねえ、|ちょっと|待って」ってもう|一度言えなかったー,
  切符を|そっと, 昨日の|ため息を, 飛ばせ紙ひこうき|空の|果てまで; unchanged: 向かい風でも|かまわないさ, 遠回りしても|
  たどり着ける, 背のびをする. Emphasis chips and per-word motions use the same units. Plans change (goldens stale).
- **ux-14.** `engine.thumb(ref, surface, { textB })` and `samplePlan(…, { textB })`: a transition's second line (falls
  back to 光のなかへ). New string `pb.sampleTextB` ['光のなかへ', 'Into the light'].
- **perf-1 (sprites made inside preview frames).** `renderer.warmAt(plan, source, t)` gathers and evaluates the cuts at
  t exactly as `render()` does (cameras included) and walks every layer with `draw.warmLayer`, which runs the one
  `drawGlyph` code path with no target (`dc.g = null`): only the `sprites.glyph()` lookups, so the keys cannot drift
  from the draw path (bucket from the full transform with pose scale and camera zoom, every blur level pair 0–5, the
  flip-shaded ink, echo shiftA/shiftB, tint accent, halo, level 0 for pixel/shard). Static layers and grounds are skipped.
  `facade.preparePreview` replaces `warmLevels`/`renderer.warm` with `warmAhead`: from the playhead (the latest
  frame's time, `renderer.lastTime()`) to 3 s after it at 30 fps, in the existing idle slices, skipping frames playback
  showed meanwhile, and stopping when the sprites these frames use (found or made; `beginWarm`/`warmBytes`, a byte count
  per span in the sprite cache) reach 0.9 of the sprite budget — warming more made the LRU drop the sprites it had made
  first, for the frames needed soonest (seen on project_vertical at 720p, where 12.5–15.5 s needs ≈ 130 MB). Blurred
  rasters whose blur is wider than 4 raster px are rasterized smaller (a Gaussian that wide holds nothing finer than the
  grid; the key is unchanged, so a raster stays a function of its key): that heavy window went 233 → 133 MB. Measured
  (Node, catalog, 720p, prepare every 2.5 s as ui/boot does; HEAD in the first 16 s: 45/61/55 frames of basic/vertical/
  long made sprites, up to 13/30/24 in one frame): whole songs from 0 s — basic ≤ 2 in any frame (1 frame), vertical
  none, lrc ≤ 3 (3 frames), long ≤ 16 (8 of 6,000 frames, at 189 s); from other start points a budget-limited window can
  still make up to 18 in one frame about 2 s after a prepare (vertical from 13.5 s). With a 1 GB budget no frame makes
  one (the keys are exact). Additive: `createEngine({ spriteBudget })`, `stats().spritesMade`.
  **Declined:** the per-frame raster cap with nearest-bucket substitutes and a level-0 fall back to the direct path: it
  would make preview frames depend on what was drawn before (determinism.py check 5 renders preview frames and requires
  order independence) and take the direct path for sprite-path poses in the preview only (§4.19.5, §7.1.7).
  Suggestion for ui/boot: prepare again every ~1.5 s while playing (not 2.5), so a window over the budget is refilled
  before its horizon.
- **Determinism (found in the runs).** `determinism.py` failed on catalog vertical (frames alone ≠ after the frames
  before; the look fixer traced it to washiFiber under dollyOut). Cause: `surface.resetState` did not reset line state,
  so a stroke relying on a default cap/join/width drew differently on a pooled surface an earlier frame had used, and the
  caller's target kept the last frame's state. `resetState` now also resets lineWidth, lineCap, lineJoin, dash, stroke
  and fill styles (the WP5b2 request), and `fillBackdrop` resets the target with it. Test in `facade.test.js`.
- **'when' weights (post.whenWeight).** 'arrive' is full until `max(times.rest, 0)` (an instant entrance rested at
  −lead, 0.4 at the sung start); 'depart' is full from `min(times.out, cut dur)` (an exit a seam replaced ends at b, so
  the weight never rose while the cut held the effects — the WP5b2 counterpart).
- **Ground camera in a text seam (renderer).** Grounds follow A's camera eased (smoothstep in u) into B's over the
  window instead of switching at u = 0.5 (panSweep both ways: a 5.9 px jump at 640 px → largest step 1.9 px, 1.7 outside).
- **Sample plans under chroma/black (facade.samplePlan)** take `planner/look.palette(theme, {}, backdrop)` — the palette
  a real plan of that theme and backdrop gets (contrast fit, then black / green-screen rules). FxContext gets
  `fx.backdrop` ('scene' | 'chroma' | 'black' | 'clear'; additive to §4.18.11), so parts need not test the key colour.
- **Decoration hints (build).** Ornaments and cameras get `hints.lines` (each line's/column's rest box, reading order),
  `hints.emphLines` (the first emphasized word's part on each line it touches) and `hints.emph` (that box when the text
  is a single line, else null: underSweep reads `emph` and keeps its whole-block rule on several lines, which the
  parts_world test asserts; with `lines`/`emphLines` it can put the bar under the word's own line when there is room —
  the ornament owner's call). The target gets `box` (each cell's frame rest box through its whole transform).
- **Kit.** `K.variant(def, { make })` on a K.moves definition keeps the given make (the motion is dropped; the exposed
  params stay). `K.mirror(entrance, { shared | params })` merges over the mirrored dur/each, reversed ease and exit
  params (the WP5a2 bug); the K.variant workarounds in digital.js/wipe.js still work. `K.color` adds `contrast`,
  `luminance`, `distance` (OKLab, new `core/color.distance`) and `fitContrast`, so ground files can drop their copies.
  `sweepX`/`sweepY` break ties along the other axis (top to bottom, left to right): a vertical column sweeps glyph by
  glyph (windBlow in vertical text), only equal positions share a rank.
- **contact_sheet.py.** It builds the sheet itself from the engine modules in the lab page: the time label sits in a
  strip under each cell (the frame's bottom-left corner is checked to be untouched), and `--params JSON`, `--impact`
  (the planner's impulses for an impact cut, amounts at least 0.6/0.5/0.3) and `--impulses kind@s[:amp]` reach the
  frame. The self-check also renders flashPop (when impact) with and without `--impact` on nightTram. The lab page's own
  `__lab.sheet` still draws the label over the corner (ui/lab.js, not mine; nothing calls it now).
- **Also:** `script.test.js` speed test takes the best of 5 runs after a warm-up (61.9 ms once under load, ≈ 10 ms alone;
  same bound). `export/host/sink.downloadBlob` restructured: `saveLink()` builds the link, the link is
  removed and the URL release (still 60 s later) is scheduled in `finally` blocks — also when `click()` throws, which
  before left both behind. ui-data's perf-5 request: the adaptive DPR step applies only above 720p.
- **Needed outside these files (not changed here):**
  - `ui/lyric_editor.js` (`META`) and `ui/project_io.js` (`META_ROW`): replace the copied patterns with `L.isMetaRow(src)`
    (core/lyrics), so `[au:]`, `[length:]`, `[tool:]`, `[#:]` are marked and kept like the other tags.
  - `ui/part_browser.js`: pass `textB: app.t('pb.sampleTextB')` next to `text` in `app.engine.thumb(…)`.
  - `ui/timeline.js` SECTION_KINDS: read `D.SECTION_KINDS` instead of its own copy (same list).
  - DESIGN (FROZEN text, §9.4, for the lead): §4.9.1 rule 3 → "Exactly `[ti:…]`, `[ar:…]`, `[al:…]`, `[au:…]`, `[by:…]`,
    `[length:…]`, `[offset:…]`, `[re:…]`, `[tool:…]`, `[ve:…]`, `[#:…]` (case-insensitive tag) → meta (ti → title, ar →
    artist; others ignored)". §4.15.3 phrases (ja) → "a break after the particles …, before a non-hiragana grapheme;
    before hiragana only after は が を に で と へ の (or も not followed by う っ) once the chunk is ≥ 6 graphemes, or after
    の は を へ that follow a kanji/katakana word of a chunk ≥ 3, and never when the hiragana is a particle stacked on it;
    in a chunk ≥ 6 a kanji after hiragana (not お ご) starts a phrase". §4.4: `sanitizeSide(side)`, `songInfoProblems`,
    `SECTION_KINDS`; parseFile = JSON.parse + migrate + normalize + validate(doc) + sanitizeSide. §4.17.5 hints:
    `{ focus, free, lines, emphLines, emph }`. §4.18.11 FxContext `backdrop`. §4.18.3 K.color `contrast luminance distance
    fitContrast`. §4.17.4 sweepX/Y tie order. §4.20 thumb `textB`, `createEngine({ spriteBudget })`, `stats().spritesMade`.
    §4.19.5 note: blurred sprite rasters are made no finer than a 4-px blur needs.
  - `tests/browser/determinism.py` etc. need nothing. The look fixer's `arrange_dwell` bound for sidebarIndex follows the
    new phrases (their section).
- **Declined:** the dwell RAMP_OUT (engine/scene/behave) change — QA-LAYOUT saw no jump, only a quick settle; grounds and
  atmospheres seeing the text (needs the segment fingerprint to cover the cuts: planner) and whiteFlash under chroma
  (planner; done by the look fixer); cameras ending away from rest (a new shot, by design).
- **Ran** (working tree with every fixer's changes): `build.py --check` 174 modules OK; `node --test
  'tests/node/*.test.js'` 1,079/1,081 (the two stale golden hash tests only); browser (local Chromium, lab page from
  the sources): `determinism.py` OK (failed on catalog vertical before the line-state fix), `glyph_parity.py` OK,
  `contact_sheet.py` self-check OK (with the new options check), `parts_gallery.py` OK, `fx_parts.py` OK,
  `export_check.py` OK (H.264/AAC branch skipped: no encoder here), `ground_contrast.py` OK (1,728 renders),
  `perf.py` OK (p95 basic 20.8, vertical 23.2, lrc 14.9, long 25.2 ms).
- **Strings wanted:** none (added `pb.sampleTextB`).

## release check

Owner of the whole tree after the fixers. Files: `ui/{boot,project_io,menus,dialogs,ai_controller,lyric_editor,
part_browser,timeline}.js`, `i18n/strings.js` (one text changed, 7 keys added), `DESIGN.md`, the goldens; tests
`tests/node/release.test.js` (new, 6 tests) and `tests/browser/ui_flows.py` (flow `clear_device`, flow `playback`
checks the cadence). Each new check fails on HEAD's files or with the old value and passes now (the Node tests on this
tree before the fixes, the flows on a `git archive HEAD` copy with the new `ui_flows.py`, the cadence with 2.5 s put back).

- **Determinism, catalog vertical: verified, fixed at the root by the engine fixer** (`surface.resetState` resets line
  state; test in `facade.test.js`). The vertical fixture still has washiFiber under the title cut's dollyOut on [0, 8.4),
  inside determinism.py's 2.6–4.6 s window, and `determinism.py` passes for all three projects and both registries.
  Nothing pinned.
- **perf-5 (renderer half): verified** — `renderer.render` steps DPR only above 720p (`DPR_FLOOR`), test in
  `facade.test.js`. DESIGN §7.4 now says so.
- **perf-1 follow-up: prepare every 1.5 s of playback** (`ui/boot` `REPREPARE_S`, pure `prepareDue(center, t)`, exported
  with `PREPARE_S` for the tests; the preview drawing path is unchanged — it only warms caches). Measured (Node, catalog,
  project_vertical, 720p, §7.3 budget, prepare ±5 s as the stage does): from 11 s and from 13.5 s one frame about 2 s
  after a prepare made 18 sprites; now none in 5 s of playback (basic from 0 s: 2 in its first frame either way). Tests:
  `release.test.js` plays it with `prepareDue` (≤ 2 per frame; 18 with 2.5 s); flow `playback` asserts prepares 1.4–1.75 s
  apart while playing (with 2.5 s: at 0.58, 3.1, 5.6 s). The flow reads the playhead as the window's end − 5 s, since the
  window's centre is skewed near 0.
- **err.file.newer names the file.** `openProject` already passed `name: file.name` (ui-data); both texts now use it:
  「「{name}」は新しいバージョンで作られた作品のため、このバージョンでは開けません。」. Tests: `release.test.js`, and the
  `clear_device` flow opens a schema-99 file (named in the toast, the open work unchanged).
- **Privacy: ≡ › 設定 › 「この端末に保存した作品と曲を消す」** (action `file.clearDevice`, so Ctrl+K finds it too; it asks
  there as well). `app.confirm` (danger) says what goes — the autosaved works (最近の作品), the loaded songs, the remembered
  AI keys — that the open work closes and that it cannot be undone. Then `project_io.clearDevice()`: cancels the pending
  autosave and waits for a write under way, clears both IndexedDB stores (`works`, `songs`), forgets every AI key in
  session and local storage (`ai_controller.forgetKeys()`, so the panel also drops the key it holds in memory and cannot
  save it again; `createKeyStore().clearAll()` when no panel is mounted), and opens an empty work under a new id that is
  written only at its first change (`loadProject(…, { quiet: true })`, save state idle). → false (toast `clear.failed`)
  when IndexedDB refused. Choices: the open work closes (kept open, its next keystroke would have stored it again —
  「消した」 would not hold); the service/model choices stay (not secret); a danger question starts with the focus on
  キャンセル (`dialogs.confirm`; only this question uses `danger`), so Enter alone never deletes. Known limit: another tab
  that has a work open stores it again at its next change (no cross-tab message). Tests: flow `clear_device` (the entry
  under 設定, Enter on the question keeps everything, 消す empties both stores and every key, the empty work is not
  written after 1.4 s, the next change is; fails on HEAD: no entry), `release.test.js` (forgetKeys).
- **The engine fixer's requests outside its files, done:** `ui/lyric_editor` and `ui/project_io` use `L.isMetaRow`
  (before, `[au:]`, `[length:]`, `[tool:]`, `[#:]` rows were tinted as lyrics and dropped from the saved .lrc; test);
  `ui/part_browser` passes `textB: t('pb.sampleTextB')` (a seam thumbnail's second line was Japanese on the en page; test);
  `ui/timeline` reads `D.SECTION_KINDS` (refactor, the lists were equal; a guard test keeps one list).
- **DESIGN folded in** (the proposals of the four final-fix sections, and the older ones INT-LEAD listed as not folded):
  §2.3 L2 may use `faces.resolveFaces` (as build.py already enforces); §3.12 `fp` song terms and segment fp; §4.4
  `sanitizeSide`, `songInfoProblems`, `SECTION_KINDS`, parseFile; §4.9.1 rule 3 (au, length, tool, #) and §4.9.2
  `isMetaRow`; §4.10.1 rules 3–4 (padded bigrams, one-to-one gaps, moves first); §4.15.3 phrases; §4.16.4 recency
  (natural/reference picks); §4.17.4 sweep ties; §4.17.5 hints and buildGround reading no cut; §4.18.3 `K.color`;
  §4.18.11 FxContext `pal`, `flashScale`, `backdrop`; §4.19.5 blurred rasters; §4.20 `thumb` textB, `spritesMade`, the
  additive options and members, the warm-ahead; §6.4.8 塗り; §6.4.12 the new ≡ entry; §6.4.15 the silent clock in tap
  mode; §6.14 project_io's Web Lock and clearDevice; §7.4 the 720p DPR floor; §8.2 `release.test.js` and the catalog's
  stability bounds; §9.1 the planning-time reading (below).
- **§9.1 planning time, decided:** the 10 ms acceptance is read as the re-plan after an edit (best 4.8 ms in the full
  suite run); a plan of all-new cuts (new seed, おまかせ, first open) takes 23.5 ms there, ≈ 25–30 ms alone, once per such
  action; typing re-plans in 12.5 ms best behind the 120 ms debounce. Written into DESIGN §9.1.
- **Goldens regenerated on purpose** after looking at the lab page: hero frames of six cuts of each fixture (basic
  monoPress/printColumn, vertical sumiWashi/quietHush, lrc sodaFloat/dashSprint, long) — compositions, vertical setting,
  title cards and grounds read right, no page errors. `node tests/update_golden.js`: registry `d088ca2e` →
  `1e6ef40c`; all 240 plan hashes and all 160 frame hashes changed (title cards, the breaker's phrases, the look tuning,
  the arrange fixes); `--check` matches.
- **Seen, not changed:** the lrc title card's hero time (1.38 s) comes while its artist line is still revealing
  (sliceReveal, lead order; whole by ≈ 1.8 s): `repT` follows the main text, so selecting the title card seeks slightly
  early. Cosmetic.
- **Declined:** none of the open items.
- **CI, in order** (local Chromium at `PW_EXECUTABLE`, 4 shared CPUs; results of the final run): see `## Release status`.
- **Strings wanted:** none (added `cmd.file.clearDevice`, `clear.title`, `clear.text`, `clear.ok`, `clear.done`,
  `clear.failed`; changed `err.file.newer`).

## Release status

**Done.** v2 implements SPEC §1–§9 as one self-contained page per language (`index.html`,
`en/index.html`, strict CSP): the ①–④ step flow over an inspector that goes 作品全体 → 行 → カット → 要素; lyrics with
stable line ids, marks, LRC (incl. ID tags) and Shift_JIS/EUC-JP files; automatic timing, tap-sync, song decoding and
analysis; the original engine (planner, scenes, renderer, adaptive preview) with the catalog — 21 compositions, 23
entrances, 10 holds, 18 exits, 18 backgrounds, 22 decorations, 10 cameras, 16 screen effects, 11 transitions, 16 themes,
8 moods (registry `1e6ef40c`), every SPEC minimum met; pins, locks, filters, season, おまかせ and the look history;
MP4 (H.264 + AAC), PNG and transparent PNG sequences, project files, autosave, 最近の作品 and clearing the device; the
AI assistant with review and undo; ja and en. Every fixer's open item is resolved (`## release check`), the DESIGN text
the packages proposed is folded in, and the goldens are current.

**Final CI run** (the sequence of DESIGN §8 in order, local Chromium, 4 shared CPUs, a clean copy of this tree after
`## release fixes` below):
`build.py --check` OK (174 modules) · Node 1,090 tests, 0 failures (61 s) · `build.py --lab` OK · `build.py` OK, the
pages equal the committed ones ·
browser, every file with default arguments: contact_sheet self-check OK, csp OK (0 violations), determinism OK, export_check
OK (H.264/AAC branch skipped: no encoder here; the same pipeline ran with VP9/Opus), fx_parts OK, glyph_parity OK,
ground_contrast OK (1,728 renders), i18n_pages OK, parts_gallery OK (catalog 2,422 renders), perf OK (p95 basic 20.9,
vertical 21.4, lrc 14.3, long 26.2 ms; bound 33.4), transparent_check OK, ui_flows OK (26 flows; first-run MP4 skipped
here), ui_layout OK (328 layouts) · `build_test.py` OK (21). About 3.5 minutes for the browser tests.

**Known limits.**
- **MP4 is verifiable only in Chrome CI.** This Chromium has no H.264/AAC encoder, so `export_check.py` and the first-run
  flow skip the MP4 branch locally; CI uses Google Chrome with `MV_REQUIRE_H264=1`, where a missing H.264 encoder fails.
  Google Chrome on Linux has no AAC encoder either, so no automated run covers the MP4's sound (AAC); check it by hand in
  Chrome on Windows or macOS. MP4 export needs WebCodecs (PC Chrome / Edge); elsewhere step ④ says so and offers
  PNG連番 (SPEC §1).
- **No transparent video files.** Browsers cannot encode video with alpha in MP4 today; 透明 exports as a transparent PNG
  sequence, and MP4 + 透明 gets the normal background with the note in step ④ (`exp.pre.clear-mp4`).
- **Planner cold-plan time.** A plan of all-new cuts (new seed, おまかせ, first open) takes ≈ 25–30 ms on project_long with
  the catalog; re-plans after an edit ≈ 5 ms, typing ≈ 12–14 ms behind the 120 ms debounce. §9.1's 10 ms is read as the
  re-plan budget (DESIGN §9.1). A 10 ms cold plan would need a cheaper chooser, a DESIGN-level change.
- **Preview speed** on a software canvas: long p95 ≈ 28 ms against the 33.4 ms test bound (2 × §7.4); the rest is raster
  time of large gradient grounds and the paper texture. CI's Chrome has no GPU either. Export never degrades.
- **Opaque PNG sequences are RGBA** (Chrome's `convertToBlob`), ≈ 1.7 MB per 1080p frame; the size estimate is on the high
  side for them.
- **Fonts** come from Google Fonts; offline (or blocked) the preview uses fallback faces and export waits for the real ones.
  The browser tests block Google Fonts on purpose, so they need a Japanese system font (CI installs fonts-noto-cjk; the
  text tests stop at once without one). A machine with neither draws no Japanese at all in a mincho face (see "CI fonts
  and edgeShade" below); step ④ then still names the faces that fell back.
- **Two tabs**: a second tab continues in a copy (Web Locks; a writer token where Web Locks are missing). Clearing the
  device in one tab does not reach another tab's open work, which is stored again at its next change.
- **AI** is tested only with faked providers (request shapes, keys in headers, errors); real service calls are not part of
  CI. Keys stay in session storage unless 「この端末に記憶する」 is on.
- Cosmetic: a title card's hero time can come before its artist line has finished its entrance (seeking to the card lands
  slightly early).

**What a maintainer must know.**
- **Goldens** (`tests/golden/plan_hashes.json`, `frame_hashes.json`) are regenerated only on purpose with
  `node tests/update_golden.js`, after looking at frames in the lab page (`build.py --lab`; `contact_sheet.py`); any
  planner, part or registry change moves them. `plan_basic.json` is hand-written for the stub registry.
- **Contracts**: anything marked FROZEN changes through DESIGN §9.4 (DESIGN first). `contract.test.js` and several part
  tests read DESIGN.md itself, and `i18n.test.js` reads the "strings wanted" tables in this file, so edit both with care.
  Part, theme and mood keys are forever (§7.1.9): retire with `pool: false`.
- **Determinism** (§7.1): frames are functions of `(plan, scenes, t)`; `determinism.py` renders frames alone vs after
  earlier ones and at 30 vs 60 fps. Caches (sprites, prepare/warm-up, static layers) may only speed frames up, never
  change them; pooled surfaces start every frame from reset state (`surface.resetState`).
- **CI** (`.github/workflows/ci.yml`): the order above; every browser file runs with default arguments; `PW_CHANNEL=chrome`
  and `MV_REQUIRE_H264=1`. Locally: `PW_EXECUTABLE=/opt/pw-browsers/chromium`. `perf.py` judges the better of two runs
  against 2 × §7.4, so a very busy machine can still make it fail.
- **Strings** are `[ja, en]` pairs in `i18n/strings.js`; placeholders must match; `i18n_pages.py` walks both pages.
- **Privacy**: autosave lives in IndexedDB `mojipv-v2` (`works`, `songs` by sha1; old works beyond 5 and unused songs are
  pruned); ≡ › 設定 › この端末に保存した作品と曲を消す empties it and the AI keys.
- The built pages are committed; run `python3 build.py` after any change under `src/` (it is byte-identical for
  identical inputs, `build_test.py`).
- `docs/DESIGN_2_1.md` is the v2.1 addendum (camerawork, speed curves, areas, materials); it is not part of v2.0.

## release fixes

- **CI without AAC.** Google Chrome on Linux has no WebCodecs AAC encoder (Chromium enables its platform audio encoder
  only on Windows, macOS and Android), so `MV_REQUIRE_H264=1` no longer asks `export_check.py` for AAC: it requires H.264
  and prints the AAC encoder as info. There the MP4 is checked without sound (no audio track; the 5.1 mix-down skips);
  a local scratch run whose fallback asked for AAC (unsupported here) went through that path: OK. `--long` accepts a silent
  export when the browser has H.264 but no AAC. The CI comments say "H.264" only. No automated run covers the MP4's
  sound; see Known limits above.
- **Notices of the SDK bundle's dependencies.** `vendor/ai-sdk.min.js` bundles the SDK's webhooks helper, which brings
  in standardwebhooks 1.1.1 (MIT, Svix), @stablelib/base64 1.0.1 (MIT, Dmitry Chestnykh) and fast-sha256 1.3.0
  (Unlicense); the app never calls it. Their licence texts are now in `THIRD_PARTY_NOTICES.md` (new section "Bundled
  inside `vendor/ai-sdk.min.js`"), in `vendor/LICENSE.{standardwebhooks,stablelib-base64,fast-sha256}.txt` and on the
  About page (`ui/dialogs` LICENCES, label `about.bundled`). standardwebhooks ships no licence file on npm; its text is
  `libraries/LICENSE` of the package's repository. `tests/node/notices.test.js` keeps the three in step: every notice is
  on the About page with the same words, every `vendor/LICENSE.*.txt` is a notice, and the bundle's markers of the three
  packages need their notices. `i18n_pages.py` allows the three package names on the ja page.
- **The v2.1 addendum** is in the repository as `docs/DESIGN_2_1.md` (paths rewritten to this layout); the READMEs link
  it.
- **Flaky pin flow.** `ui_flows.py` `pin` failed in about one run in ten: when おまかせ gives a cut of the pinned line an
  arrange that moves the text itself (`motion: 'own'`, tickerMarquee), the planner forces that cut's entrance to
  instantShow by rule (DESIGN §4.18.2) and the line pin skips it, as designed. The check now accepts such a forced
  entrance and still requires the pin on every other cut of the line.

## CI fonts and edgeShade

The first CI run of the v2 browser suite (ubuntu-latest, Google Chrome) failed three tests that pass locally.

- **Japanese drew nothing in CI** (`parts_gallery.py`: blank frames for every examples/stub part and for catalog parts on
  flat grounds; `transparent_check.py`: no glyph pixels at all). ubuntu-latest has DejaVu, Liberation and Noto Color
  Emoji but no CJK font, and the tests block Google Fonts, so every face falls back to `SYSTEM_FALLBACK`. Chrome's
  generic `serif` there is Times New Roman → Liberation Serif, whose missing-glyph box is empty (advance 0.78 em, no
  outline): the mincho, brush and antique stacks draw no ink for any kana or kanji. The sans stacks draw a hollow box
  (Liberation Sans), the same for every character. Latin text draws, which is why `glyph_parity.py` passed (its text has
  "Road"; the kana were missing on both paths). Reproduced here with a fontconfig of only those three font directories
  plus `/etc/fonts/conf.d` (`FONTCONFIG_FILE=…`; dev/browser.py passes the environment to the browser): the catalog
  failures matched CI's list part for part. (Without `/etc/fonts/conf.d`, `serif` maps to DejaVu, whose box has ink,
  and both tests pass: the empty box is Liberation Serif's.)
  - CI installs `fonts-noto-cjk` and `fonts-noto-color-emoji` (and runs `fc-cache -f`) before the browser tests, the
    system fallback a user's machine has.
  - `dev/browser.py` `japanese_font_missing(page, test)`: draws 「あ」 and 「い」 in every `SYSTEM_FALLBACK` stack and needs
    ink and two different shapes. `parts_gallery`, `transparent_check`, `glyph_parity`, `determinism` and `perf` call it
    first and stop with one message ("no system font draws Japanese … install fonts-noto-cjk") instead of hundreds of
    blank frames.
  - Users: only a machine without any CJK font whose browser cannot reach Google Fonts meets this (Windows, macOS,
    ChromeOS and Android ship Japanese fonts; a minimal Linux may not, and then the UI's own Japanese shows boxes too).
    The existing `font-fallback` warning does show then: step ④'s pre-flight names every face that fell back (checked
    in Chromium with the CI font set), and `transparent_check.py` now asserts that line with Google Fonts blocked. Its
    wording ("a fallback is used") is optimistic for this case; a sharper message would need a probe of the fallback
    in `engine/host/fonts` and new strings (not done).
  - With Noto CJK the text tests measure real kana: `glyph_parity.py` examples reads MAE 1.883/255 (limit 2) and a blur
    switch of 2.321/255 (limit 2.331) with the CI font set (Noto Serif CJK's thin strokes), the same to the digit in
    Chromium 141 and in a Chromium 156 snapshot; IPAGothic here reads 1.505 and 2.036. The empty `serif` box
    reproduces in both builds too.
- **edgeShade cost** (`fx_parts.py`: declared cost 3, measured class 5, 20.2 copies in CI's Chrome; 8.1 here). It filled
  the whole frame with a radial gradient every frame. The vignette is the same picture on every frame of one size, so it
  is now painted once at full strength (stop alphas u²) into a kept layer and laid over the frame at alpha `dark`: 2.8–3.0
  copies in Chromium 141 and in a Chromium 156 snapshot (class 1; CI's Chrome measured the similar flashPop and
  cinemaBars at about twice their local copies, which would put edgeShade near 5–6). The declared cost stays 3 (the test fails only on a cost more than one class below the
  measure; lowering it would need a measurement in Chrome). Pixels against the old code: at most 3/255, mean ≤ 0.55/255
  over 30 cases (1280×720 and 720×1280, amount 0.02–1, size 0.35–0.55): the old stops were rounded to 1/64 alpha by
  `color.rgba`, the new fade with amount is continuous.
  - Additive FxContext member `layer(key, paint)` (DESIGN §4.18.11): the tile bank keeps frame-sized layers per (key,
    frame size), LRU of 4 within 64 MB, cleared with the renderer; a layer larger than that is painted into a frame
    surface each time. `engine/render/record`'s FxContext has it too (painted once, canvas id `layer:<key>:<w>x<h>`).
  - Goldens regenerated on purpose (`node tests/update_golden.js`): 39 frame hashes of `lrc` and `long` changed.
    Compared with the old edgeShade in a scratch copy, with canvas and gradient ids renumbered per frame, only the two
    frames that draw edgeShade differ (lrc 29, long 9); the other 37 changed because the recorder numbers canvases and
    gradients with one counter, and the kept layer shifts the ids after it. Plan hashes are unchanged.
- Seen once while the browser tests ran in parallel with other browser runs here: `ui_flows.py` `values` read the
  切り替え row as 無効 (`OTHER_TILE` picked a transition that does not apply at that boundary). Four runs of the flow alone,
  with either font set, passed; it looks like a timing flake in the tile order, not a font effect.

## Pinned hard cut reads as pinned

A pinned 切り替え「なし」 (the seam fallback, the hard cut) is applied by the planner, but hard cuts are not listed in
`Plan.seams`, so `planner/fields.sourceAt` found no source for the pin and the inspector showed it as 無効
(not-applicable). `sourceAt` now reports the winning pin when a later cut has no seam and that pin is the hard cut
(`hardCutSource`); a seam pin on the very first cut still reads as not applicable. This made ui_flows' `values` flow
fail whenever its tile pick happened to be the hard cut. Test: fields.test.js 'a pinned hard cut … reads as pinned'.

## v2.1 package A

A.1, A.2 and A.3 of DESIGN_2_1 §8.1, delivered together: curves, shots and rigs, the recipe validator, areas, schema 2
(materials, media, `output.kit`, `side.asks`) with the 1 → 2 migration, the material and media commands, `core/media`,
the ParamSpec types `curve`, `shot`, `rig`, `partRefs` and `media`, the registry's shared params and `extend`, the
`parts/mix` stub, and every string of §6.11, §11.7.11, §12.7 and §13.10.

- **New modules:** `core/curve`, `core/shot`, `core/recipe`, `core/media` (L0), `planner/areas` (L2), `parts/mix` (L3,
  stub: `derive` → `{ def: null }`, `registryFor(base)` → `base`, `materialHash` → `'00000000'`, `sampleDefs` → `[]`).
  `build.py.layer_of` maps `parts/mix` to L3 (build_test `test_parts_mix_is_l3`).
- **Changed:** `core/schema`, `core/registry`, `core/doc`, `core/migrate`, `core/commands` (33 commands), `core/types`,
  `i18n/t` (the registry argument may be a function that returns the current, effective registry), `i18n/strings`,
  `ui/fields` (one-time compatibility, below).
- **Fixtures:** `project_v21.json` and `project_media.json` (schema 2, stored exactly as `serialize` writes them);
  `corpus.V21_PROJECTS`, `ALL_PROJECTS` and `projects(names)`. The v2.0 corpus (`corpus()`) is unchanged, so every
  existing golden keeps its inputs.

**Frames and goldens.** `node tests/update_golden.js --check` reported `frame_hashes.json: matches` and
`plan_hashes.json: DIFFERS`. The plan golden was regenerated (all 240 entries). Every arrive and depart decision now
carries `p.flow = 'linear'`, and every dwell and lens decision carries `p.curve = 'linear'` (seams alike). These are
constant autos with no random draw, so every pick and every frame is the same; the regenerated `frame_hashes.json` is
byte-identical. The base registry version stays `1e6ef40c`: its signature is the kinds, the keys and each definition's
own param names, and shared params are not part of it.

**Decisions and deviations**

- **String keys that already existed with another meaning:**
  - `keys.title` is the keyboard help heading (キーボード操作), so §6.11's keyframe heading is `keys.heading` (キーフレーム /
    Keyframes). `keys.item` is as designed.
  - `opt.start` / `opt.end` are 行頭 / 行末 for the arrange `anchor` enum and stay that way. The curve editor's ends use
    `curve.both` / `curve.start` / `curve.end`, which have the texts that §6.11 gives for `opt.*`. `opt.both` is new.
  - `whyRule.role` existed; it now has the §6.11 text.
  - `menu.clearDevice` (changed) is the existing key `cmd.file.clearDevice`, and its text is updated.
  - `part.ground.photoPan` (changed): part labels live in their definitions (D§4.18.1). The new label 写真・動画 / Photo
    or video comes with the photoPan upgrade in package G.3, which owns `parts/ground/photo.js`.
  - "colour" in five en texts of §11.7.11 is written "color" (the ux-16 test asks for American spelling).
  - `i18n.test.js` reads the four string tables from DESIGN_2_1.md at test time. It checks that every key exists and
    that each single-key row has the design text. The two renamed keys are listed in the test (`DESIGN_KEY_HOME`).
- **`ui/fields` compatibility:** `curve` → `choice` with presets and ease names (as §8.1 says). `ui_fields.test.js` asks
  that every `SC.TYPES` entry has a widget, so `shot` and `rig` → `choice` (none and the presets), and `partRefs` and
  `media` → `text`. Packages F and G replace these with their widgets.
- **Recipe media cost:** "plus 1.5 ms with blur or alpha" (§11.5.8) is read as: the layer's `blur > 0`, or the asset has
  alpha (its `doc.media` entry, passed as `ctx.media`). The layer's own `alpha` param does not count, because every layer
  has one. Without a media list, only blur counts.
  - **Design tension:** 0.4 + 1.5 = 1.9 ms is over the ornament budgets (1.2 ms per cut, 1.5 ms per run). So a blurred
    or transparent-video media layer fits only in a ground material (2 ms), and the media fixture's ornament material
    uses the MP4. If transparent overlays in ornaments are wanted, the budget or `mediaHeavy` needs a new number (C, E
    or the lead); nothing else depends on it.
- **Recipe normalize:**
  - A composite kind whose `base` is not a valid part key is treated as a composite, and the base is reported `dropped`.
  - `cost()` normalizes its input first, so raw input never throws.
  - A particle field `dir` is rounded before and after the wrap, and 360 becomes 0. The fuzz test found that 359.9999999
    normalized to 360 and then to 0; `normalize` is now idempotent there too.
- **Media reducers** (the details §11.2.5 leaves open):
  - `media.relink` to an asset that is already in the library keeps that entry and its place (the payload's metadata is
    not applied) and removes `from`.
  - A rewritten `@key` path replaces a pin already at the new path.
  - Avoid lists rewritten by a relink are de-duplicated and sorted.
  - `media.remove` leaves material recipes unchanged, as designed. `refsOf` still lists them, so the library can count
    them.
  - `entryProblems` returns `'field: what'` strings. `validate` adds the unique-id check.
- **Files:** a file without a `doc` object is refused (`not-a-project`) before any migration step runs. `normalize`
  fills a missing `materials.next` with one past the highest id.
- **NOTES heading:** this section uses the lead's name, "v2.1 package A". §8 of DESIGN_2_1 suggests `## v2.1-<letter>`.

**Until the other packages land.** `registryFor` returns the base registry, so pins with material or media keys
(`myMat…`, `myMed…`) and the parts G adds (`photoFrame`) plan with `pin-bad-value`. `cam.*`, `rig*`, `motion.speed`,
line `season` and `avoid` pins are stored, validated and scope-checked, but the planner does not read them yet (D).
Shared `flow` and `curve` params are resolved into the plan but not applied by the engine yet (B). Linear is the
identity, so this cannot change a frame. An `ease` pinned to a curve preset or a custom curve plays as linear until
then (`behave.easeOf` falls back for names it does not know).

## Tap-sync with the mouse and touch

A user found that tapping did not seem to take effect. Probing the page like a mouse user showed why:
- Tap mode had no on-screen control to tap with; only Space and Enter marked a line.
- A click on the preview (the natural "tap") ran the normal preview click. It selected a line, paused playback and opened
  詳細, which folds the step column and hid the tap panel.
- While playback was stopped, Space still marked lines at the frozen clock, so every line got the same time.
  `core/timing` then dropped all but the first with `time-order`, while the toast still said 「3行のタイミングを記録しました」.

Fixes:
- `core/tap`: a mark less than `MIN_GAP` (0.12 s) after the last start is not taken.
- `ui/tap`:
  - a big 「タップ」 button (pointerdown, at the press's time);
  - no mark while playback is stopped, with the hint `tap.stopped`, and `tap.tooSoon` for a rejected mark;
  - the announced time is the recorded one;
  - starting unfolds the step column;
  - finishing seeks 2 s before the first marked line, with a toast action 「再生して確認」 (`tap.check`);
  - `tap.doneSome` when the timing cannot use some marks (a mark earlier than a pin or LRC time above the session).
- `ui/stage`: in tap mode, a press on the preview is a tap and never selects or pauses.

Tests:
- `tap.test.js`: a new gap test.
- `ui_flows.py` `tap`: the mouse sub-flow.
- Both were mutation-checked: each fails when its fix is removed.

## AI thinking animation

The owner asked for a near-future thinking animation while the AI works (timing, prep, looks and the other tools).
- New module `ui/ai_thinking` (L7), with two exports:
  - `orb(large)`: the orb that replaces the small spinner of the AI panel's running line;
  - `mountHud(app, ctl, host)`: the HUD over the preview, mounted by `ui/ai_panel` on `app.shell.stage.element`.
- The HUD and the glow are driven by the controller's state (`ctl.on`). They show exactly while `state.run` exists.
- Colors are `--ai-a` (cyan) and `--ai-b` (violet). The HUD is `pointer-events: none` and sits over the canvas, so
  exports and hit tests are unaffected.
- Tests: `ui_flows.py` `ai_prep` checks the HUD during a text tool (shown, stage text equal to the running line, no audio
  steps, glow, orb, pointer passes through). `ai_align` checks the four steps up to 考え中, and that the HUD and the glow
  go away with the answer.

## v2.1-H.1

H.1 of DESIGN_2_1 §8.8: the WebM writer `export/webm` (§13.5) and the subtitles `export/subtitles` (§13.8), both pure
(L5, Node-tested), with `tests/node/webm.test.js` (19 tests) and `tests/node/subtitles.test.js` (11 tests). No other
source file changed; `build.py` already gives `export/*` layer 5. The shipped pages are rebuilt because they now contain
the two modules. Goldens unchanged (`update_golden.js --check`: both match).

Base: this worktree's branch started at `origin/main`, which does not have §11–§13 or package A. It was fast-forwarded
to the package-A commit (the base of the other v2.1 packages) before any work; no merge commit.

**`createWebm` as frozen, and what the design left open**

- **Calls.** `video(colour, alpha, key, ts)` and `audio(chunk, ts)` take `ts` in µs (the chunk timestamp, `ts(i)`).
  Block times are `round(ts / 1000)` ms. Frames and packets may be a `Uint8Array`, an `ArrayBuffer` or view, or an
  encoded chunk (anything with `byteLength` and `copyTo`, e.g. `EncodedVideoChunk`); they are copied, so the caller may
  reuse its buffers. `alpha` may be `null` for a frame (a BlockGroup without BlockAdditions).
- **`key` means "decoding can start here".** With alpha, the host passes `colour.type === 'key' && alpha.type === 'key'`.
  §13.5 calls spontaneous key frames in one encoder harmless; that holds for playing straight through, but a cluster and
  cue at a colour-only key frame would make a seek there start the alpha decoder on a delta frame.
- **Checks** (`ExportError` codes): `args` (options, empty or non-byte frames, an alpha frame on an opaque track, audio
  without an audio track, a bad OpusHead), `order` (the first video frame is not a key frame; video times not strictly
  increasing in whole ms; audio times not strictly increasing), `finished`, `sink`.
- **Return values.** `video()` and `audio()` return a promise that resolves once the bytes they completed are written. It
  never rejects, so an ignored promise cannot become an unhandled rejection; a failed write makes the next call throw
  `sink`, and `finish()` rejects. `finish()` → `{ bytes, frames, packets, clusters, cues, duration (s) }`.
- **Opaque WebM** (`video.alpha` not `true`): the frames are SimpleBlocks with the key flag, and the track has no
  MaxBlockAdditionID, BlockAdditionMapping or AlphaMode. G's counter fixtures (§11.8.1) need this. With alpha, every
  frame is a BlockGroup (`ReferenceBlock` = previous frame's ms − this frame's ms on delta frames).
- **Clusters.** A cluster starts at every key frame. It holds the video up to the next key frame and the audio packets
  timed before it, in time order (video first at equal ms). It is assembled in memory and appended in one write once it
  is complete: when the next key frame has arrived and, with audio, a packet at or after the cluster's end has too. The
  output depends only on each track's own sequence, not on how the calls interleave (tested with random interleavings).
  A group longer than 32 767 ms is split at the first block past that. Only the part that holds the key frame gets a
  CuePoint. There is one CuePoint per key frame, at the cluster that holds it; that equals "one per cluster" of §13.5
  whenever key frames come at least every 32.7 s.
- **Placeholders.** The Segment is written with the unknown size (`01 FF…FF`, 8 bytes), so a file cut short still
  parses. The SeekHead lives in a fixed 96-byte area (SeekHead + Void). `finish()` appends the Cues, then makes exactly
  three positional writes: the Segment size, the Duration (8-byte float, in ms), and the whole SeekHead area, now with
  the Cues entry. A file without video frames has no Cues (a Cues element needs a CuePoint) and no Cues entry.
- **Duration** = the latest end of any frame or packet, rounded to the µs. A frame ends at `ts` plus the chunk's own
  `duration` when it carries one, else plus 1/fps. A packet ends at `ts` plus its chunk `duration`, else at `ts`. With
  `EncodedVideoChunk`s made from `frameDur(i)`, the Duration is exactly `ts(N)`.
- **Determinism.** Identical input → identical bytes. TrackUID = the track number, and there is no SegmentUID or DateUTC.
- **Audio entry** as in §13.5, plus `FlagLacing 0` (as on the video entry; we never lace). CodecPrivate is the encoder's
  OpusHead as given, checked for its magic, its length (≥ 19) and a channel count equal to `audio.channels`; CodecDelay
  comes from its pre-skip. Without one, the head is built from the options (§13.5's values when the host passes 2 and
  48000); more than 2 channels without a head are refused (mapping family 0). SamplingFrequency is `audio.rate`.
- Additive exports beyond §13.11: `ebmlSize(n, width?)` takes an optional fixed width (the Segment size uses 8).

**Subtitles**

- `srt` works in whole µs (`Math.round(t · 1e6)`), then milliseconds with halves up. So `0.5005` s is `,501`, although
  `0.5005 · 1e6` is 500499.99999999994 in binary, and `4.2 − 1.1` gives `,100`.
- The 0.1 s rule is checked on the written milliseconds, after the overlap cut-back. Lines with empty text (after
  trimming) are left out before that, so they never cut back the cue before them. Line breaks in a text (CR, LF,
  U+2028/9) become spaces: a blank line would end the cue.
- Cues are sorted by start (stable, so equal starts keep plan order). `per: 'cut'` uses the cuts that have a `line`
  (roles `lyric` and `focus`); title, intro, gap and outro cuts are left out.
- `srt` throws `ExportError('args')` for an unknown `per` or a non-numeric `t0`/`t1`. An empty or reversed range gives
  `''`. The design names no furigana or line-break rules, so none are applied.
- `BOM` (`'﻿'`) is exported so that the kit and the menu item add the same one.
- `lrc(plan, doc)` is `lrcText`'s algorithm. The test keeps a verbatim copy of the previous `lrcText` as the reference and
  also compares with the live `ui/project_io.lrcText` on all six fixture projects.

**Checks.** Mutation check: 35 hand-made mutants of the two modules; 33 are caught. The two survivors are equivalent:
a line that ends exactly at `t0`, or starts exactly at `t1`, becomes a zero-length cue, which is dropped anyway and cannot
cut back another cue.

**Browser probe** (not committed; Playwright with the bundled Chromium 141.0.7390.37, headless). `VideoEncoder` VP9
`vp09.00.10.08`, or VP8 at 24 fps, encoded 72–90 frames, key frames forced every 2 s. The alpha encoder got an I420 frame
whose Y plane is the alpha and whose U and V are 128. `createWebm` wrote the chunks; `<video src=blob:>` played the file,
seeking to 6 frame times, drawing to a canvas and reading pixels:
- opaque VP9 192×108@30: loads, duration 3 s, colours within ±2 of the source;
- VP9 alpha 192×108@30: alpha 128 on the half-transparent square and 0 outside at every sample, colour within ±2
  (±4 in the case below);
- VP9 alpha 320×180@30 + Opus (`AudioEncoder`, its OpusHead passed as `codecPrivate`, pre-skip 312):
  `decodeAudioData` gives 144 648 samples for `audioFrames` 144 000 (less than one 960-sample packet over), RMS 0.21
  for a 0.3 sine;
- VP8 alpha 192×108@24: same results as VP9 alpha.

So Chrome accepts `MaxBlockAdditionID` and `BlockAdditionMapping` and reads the alpha from BlockAdditional id 1. H.2's
`webm_check.py` repeats this properly.

**Requests to other packages**

- **H.2 (host WebM and kit):**
  - The Tracks element, and with it the OpusHead, is written when `createWebm` is called. So encode the audio before
    the video, and pass the first output's `decoderConfig.description` as `codecPrivate`. This also avoids a memory trap:
    while audio lags behind the video, the writer holds the video clusters in memory. 60 min of Opus at 160 kbps is
    about 70 MB. Pass `audio: null` when there is no song.
  - Pass `key` as described above.
  - The encoded chunks can be passed as they are (their durations are used).
  - Add `SUB.BOM` before the SRT text.
  - `lrc(plan, doc)` has no range. FG7 says "SRT and LRC … relative to the export range", but §13.8 freezes
    `lrc(plan, doc)` with the same bytes as today. If the kit's LRC must be relative to the export range, that needs a
    lead decision (for example an optional `{ t0, t1 }` that keeps today's bytes when absent).
  - `ui/project_io.lrcText` → `export/subtitles.lrc(app.plan, app.doc)` (§8.8 H.2).
- **G.1 (`media/matroska`, `media/samples`):**
  - WebM times are whole milliseconds (TimestampScale 1 ms, frozen). At 24, 30, 30000/1001 and 60 fps, frame k starts up
    to 0.5 ms after k/fps. For example, frame 2 of a 30-fps file is at 0.067 s, not 0.0667 s. With `EPS_MEDIA` = 0.1 ms,
    `sampleAt(table, k / fps)` then returns k − 1 for a third of the frames at 24, 30 and 60 fps. This holds for our
    own WebM and for ffmpeg's alike.
  - A possible rule: when a track has `DefaultDuration` and every block time is within 0.5 ms of `i · DefaultDuration`,
    take `pts = i · DefaultDuration`. Otherwise the frame-exactness expectations of §11.8.3 for WebM sources must be
    computed from the ms times. G and the lead should decide.
  - The round trip through `media/matroska` named in §13.12 is not in `webm.test.js`, because the module is not in this
    tree. At integration, add it there: `writeFile`, `makeFrames` and `readFile` in the test already produce the
    expected table, including the alpha ranges. Alternatively, confirm that G's `media_demux.test.js` "matroska on
    `export/webm` output" covers it.
- **Strings wanted:** none.

## Lead decisions (v2.1 integration)

- **LRC times are always song times.** `export/subtitles.lrc(plan, doc)` has no range: an LRC file travels with the song,
  so its times count from the song's start, whatever the export range. SRT follows the export range
  (`srt(plan, { t0, t1 })`, times relative to `t0`), because it sits next to the exported clip. H.2 and H.3 follow this.
- **WebM frame times are snapped to the frame grid.** WebM stores whole milliseconds, so at 24, 30 and 60 fps some
  frames start up to 0.5 ms after `k / fps`, and `sampleAt(k / fps)` would pick frame k − 1. `media/matroska` therefore
  sets `pts = i · DefaultDuration` (i = the presentation index) when a track has a DefaultDuration and every block time is
  within 0.5 ms of that grid. Otherwise it keeps the stored times (VFR). The frame-exactness tests of §11.8.3 then hold for
  our WebM files and for ffmpeg's alike.

## CI: Node tests one file at a time

On PR #4 one CI run failed `planning speed: re-planning project_long after an edit`, with batches of 10.1–16.2 ms against
the 10 ms budget (the best of eight must stay within it). The other run on the same commit passed. The speed tests
(planner_determinism, conformance, …) shared the runner's cores with the other test files, which `node --test` runs side
by side; the H.1 property tests had just added CPU-heavy files. The budgets are unchanged. Instead, CI now runs
`node --test --test-concurrency=1`, so each file has the CPU to itself. Locally that takes about 3 minutes (1215 tests),
and the re-plan measures 5.8 ms. Run the Node tests the same way on a busy machine.


## v2.1-C

Package C, the materials runtime (DESIGN_2_1 §8.3 with its media additions): `src/parts/mix.js` replaces A's stub, with
`tests/node/mix.test.js` and `tests/browser/materials_gallery.py`.

**What it does**
- `derive(entry, base, ctx?)` turns a MaterialEntry into a part definition:
  - a variant goes through `K.variant` (§5.7.2): params are coerced through the base's specs, shared values through
    the kind's shared specs as the base narrows them;
  - a composite goes through `K.<kind>`, with its build / make / apply bound to the normalized recipe in one closure
    per material version;
  - every definition carries `mine: { id, rhash, cost, by, media }`.
- The interpreters. Every run and draw function is defined once, at module level:

  | Recipe part | Built as |
  |---|---|
  | layer `shape` | one `sb.shape` per item; the SHAPE_LIB path is scaled by the item's size |
  | layer `frame` | `sb.shape` nodes around `hints.focus` (the safe area in grounds) |
  | layer `fill`, `pattern` | one `sb.paint` each (`drawFill`, `drawPattern`), still unless a behaviour moves it |
  | layers `particles`, `lines`, `glyphs` | one `sb.paint` each (`drawFlow`), closed form in t |
  | layer `media` | `K.media` when the kit exports it; skipped otherwise |
  | movers and appear | one `runItems` behaviour per node layer; per item inside `drawFlow` |
  | arrive / depart motion | `BH.glyphMotionMaker(kind, { unit, fn: glyphTracks })`, made once per kind and unit |
  | dwell osc | `BH.holdMaker(oscHold)` |
  | lens osc | a `runLensOsc` behaviour on the camera node |
  | filter stack | the inner filters' `apply`, chained |

- `registryFor(base, materials, media)`, `materialHash(entry)`, `sampleDefs(base?)` and `SHAPE_LIB` (18 unit shapes).

**Decisions where the design was silent**
- **Flow layers draw through a paint, not `sb.particles`.** `sb.particles` starts every particle at a random angle,
  sways only along x, fades every particle by its life cycle and has a single ink. Recipes need more than that:
  - lines that lie along `dir`, upright glyphs and the `rot` range;
  - movers per item with their phases, appear per item (a wipe), several inks.

  `drawFlow` batches its items into one path per ink and alpha step of 1/16. The §2.1 cherry flurry (90 petals, two
  inks) draws with at most 32 fills; the test asserts exactly one fill per used step.
- **Units.** Sizes and mover `x`/`y` amplitudes are shares of the short side; `place.x`/`y` are shares of the frame.
- **Regions per anchor:**
  - `frame`: the frame plus the 15 % bleed;
  - `focus`: the text block, or the safe area in scenes without text;
  - `around`: the block grown by 0.08 short. Shapes sit on an ellipse, and particles fade out inside the block;
  - `under`: a 0.08 short band under the block;
  - `behind`: the block × 1.25, always in the far layer;
  - `corners`: four 0.14 short squares of the safe area;
  - `edges`: four 0.07 short bands;
  - `free`: `hints.free`, or the safe area.

  `spread` scales every region. Items are spread over several regions in proportion to their areas.
- **Frame and pattern fields:**
  - `frame`: `size[0]` is the gap to the text and `size[1]` the arm of brackets and ticks; ticks are two per side;
  - `pattern`: `size[1]` is the mark and `rot[0]` the pattern's angle. It is clipped to its region. A moving pattern
    draws at most 2,500 marks per frame (a finer one is coarsened); a still one is rasterized once;
  - `lines`: 6 % of the longest line wide (1–8 du);
  - `glyphs`: drawn in the page's sans-serif;
  - a ground's fill always covers the bleed.
- **Fields.** The velocity is `speed · short` along `dir` (0 = right, 90 = down), × 0.7–1.3 per item. The sway is
  perpendicular to `dir`, and the spin is × ±0.5–1.5 per item. Items wrap inside their region grown by their size.
  Regions other than `frame` fade items near their edges. `life [0, 0]` means no life cycle.
- **Bursts:**
  - `beat` fires on every beat; `arrive` fires once at the sung start (the start of a ground or atmosphere);
  - `impact` fires at the sung start too, and does so on lines that are not impacts as well;
  - particles fly out from the region's centre at `speed · (0.5–1.5)` and are pulled along `dir` at `1.2 · speed` per
    second;
  - they fade out over their life (1 s when unset, and under 0.95 of the beat period for `beat`).
- **Appear times:**
  - `start` is the window start, `arrive` the sung start (the cut-local 0) and `rest` the end of the entrance;
  - `impact` is the sung start (arrive on other lines), and `beat` restarts on every beat;
  - grounds and atmospheres start at 0.
- **Movers.** The value is `amp · wave(hz · t + φ)`:
  - `beat` is `exp(−since / 0.2 s)`, with half-second pulses when there is no grid;
  - `ramp` is the seconds since the window start, or the window length shaped by its curve;
  - the phases are `index` = j / n and `rnd` = seeded;
  - an alpha mover keeps the alpha between 1 − |amp| and 1, full at the wave's peak when amp > 0; a ramp fades in
    (amp > 0) or out;
  - `scale` scales items about their centre.
- **Oscillators:**
  - dwell `sx` scales uniformly (sx and sy); `glow` and `tint` are unipolar;
  - the phases are `index` / `word` × `step`, and `rnd` = the glyph's random;
  - lens times run from the window start.
- **Knobs and shared params:**
  - the `amp` knob of arrive/depart scales every track's distance from the identity;
  - the amount factors follow §5.7.4.
- **Inner parts:**
  - their params are the fixed recipe params, then the material's shared values, then autos seeded by the scene;
  - entrance and exit parts share the material's `dur` / `each` / `order` / `ease`, so they fill the same window;
  - a composite entrance without motion takes its first part's shared overrides and unit;
  - filter stacks resolve their inner params once per material version (neutral features, seeded by `rhash`). Each
    inner filter runs at `min(1, amount × mix)` with `when: 'always'`, because the renderer weighs `when` once;
  - the stack's `gate` is the first inner gate.
- **`mirrorOf` works by data,** with K.mirror's rule:
  - tracks swap ends; column curves and the ease reverse through `CV.reverse`; `dur` and `each` carry over, `order`
    does not;
  - the arrive's inner parts go through `K.mirror`;
  - the depart's `rhash` covers the arrive's.

  K.mirror itself would drop the per-build knob wrapper. The arrive must come earlier in the list, so `derive` without
  the list gives `mirror-missing`.
- **`derive` problems** use A's Problem shape `{ path, code, params }`:
  - Fatal: entry problems, `rv-newer`, every `core/recipe` limit problem, `no-base`, `flash-base`, `mirror-missing`,
    `kit` and `def`.
  - Dropped with a problem: normalization codes, `part-missing`, `part-flash`, `part-scope`, `part-frames`,
    `part-param`, `part-mirror` and `param`.
  - `derive` runs `REG.checkDef`. `registryFor` leaves that to `REG.extend`.
- **`registry.problems`**, which D turns into `material-bad`:
  - a failed material gives `'<kind>/<key>: <first fatal code>'`, for example `ornament/myMatb: cost`;
  - a 40-bit media key collision gives `'ground/<myMed key>: media-key'`.
- **Pooled media grounds:**
  - `mine.cost` is a cost object `{ ms: 0.4, particles: 0, … }`. §11.5.9 writes `0.4`; the object lets §5.9.4 sum
    `mine.cost.particles` over any definition;
  - `mine.media` is `true` for them and an id array for materials (§8.3);
  - `clock` and `move` autos are set only when `photoPan` has those params (G.3).
- **Memo caches (WeakMaps only):**
  - registries: per base, the last 4 (materials, media) pairs;
  - per material entry: its last derivation, reused while the base, the media list (only for recipes with media
    layers) and the mirrored arrive entry are the same objects. An edit re-derives one entry;
  - per asset: its ground definition;
  - per filter-stack version: the params object of each decision → its inner params objects.
- **Media layers** call `K.media` with:
  - `use` = `ground` (grounds), `layer` (anchor `frame`) or `frame`;
  - a mask from `shape`, and `p` holding the layer's fit, time and blur plus `depth: 'anim'`. The recipe places the
    picture itself, which is what §11.9.3 means by `anim`.

  The border is a stroked shape. A group node carries the movers and the appear. An empty `src` (the part param) builds
  nothing.
- **`sampleDefs(base?)`:**
  - with a base, 8 definitions: one composite per COMPOSITE_KIND and the §2.1 cherry-petal atmosphere;
  - without one, 7: a filter stack needs inner filters;
  - the keys are `myMatSornament`, `myMatSatmos` and so on. Tests and the gallery re-key them to `myMatz…`.

**Design tension (A's note on media cost vs the ornament budgets): decided — the budget stays hard.** `core/recipe` is
the only judge of a recipe. A fixed picture with transparency or blur costs 0.4 + 1.5 = 1.9 ms, so it fits only a
ground material (2.0 ms), exactly as A implemented. The reasons, in §5.8's spirit:
- The ornament budgets bound three cut ornaments and an atmosphere per frame within D§7.4's draw budget, and the
  isolated path is the expensive part of a media node (§11.5.12).
- Transparent pictures near the words and overlay footage are what G's `photoFrame` and `mediaLayer` are for, when
  pinned.
- A material whose picture is the `src` param (a reusable frame style) is costed without its picture, like a pinned
  `photoFrame`; the interpreter draws whatever picture is chosen.

If the owner wants fixed transparent pictures in ornament materials, the lever is `core/recipe.LIMITS` (A), not
`parts/mix`.

The flash rule stays hard at derive (`core/recipe.problems`) and again at build:
- a large layer (cover > 0.25 at knob maximum, computed as `core/recipe` does) never changes with the beat more than
  3 times a second: beat appears and beat bursts use every n-th beat at fast tempos;
- burst particles of large layers fade in over at least 0.15 s;
- no particle life cycle is shorter than 1/3 s;
- media layers use the same rule with cover = size².

**Deviations**
- Flow layers use `sb.paint` instead of `sb.particles`; the reasons are above. `FrameStats.drawn.particles` counts only
  `sb.particles`, so material particles are not in it. The §5.9.4 budget still holds by construction through
  `env.mixShare`.
- The ornament count knob is the param `quantity` while `core/registry` reserves `count` on ornaments (D§3.4,
  `RESERVED_PARAMS`). `REG.extend` refuses a `count` param, which would drop every ornament material with a count knob,
  the §2.1 flurry among them. A probe at module creation picks `count` as soon as the registry accepts it. Until then
  project_v21's pin `atmos@myMat3.count` has no effect.
- Additive signatures: `derive(entry, base, ctx?)` takes `ctx = { list, media }` (for `mirrorOf` and the media list),
  and `sampleDefs(base?)` takes the base its filter stack needs.
- New dependencies of `parts/mix`: `core/schema`, `core/media` and `engine/scene/builder` (L0 and L3, within §3.1).
- `tests/node/contract.test.js` (A's file): three assertions that checked the stub's placeholder answers were replaced
  by the real contract, since §3.12 says C replaces the stub:
  - `derive({})` has problems;
  - `materialHash` gives 8 hex digits;
  - `sampleDefs()` is non-empty with `myMatS…` keys.

  `registryFor` still returns the base itself.

**Measured** (this shared container; Node 22, headless Chromium)
- `registryFor` after an edit (a new `doc.materials` with one changed entry), best of 8 batches of 5:
  - 64 materials: 1.39 ms (budget 3 ms);
  - 64 materials and 200 assets, 20 pooled: 1.82 ms (budget 4 ms).
- The first composition of 64 new materials takes 8.0–9.6 ms, once when a document opens. About 120 µs per material
  goes to `core/recipe` `normalize`, `problems` and `cost`, each of which normalizes again, plus the recipe hash. A cold
  `REG.extend` of 64 definitions takes 1.1–2 ms.
- The §2.1 cherry-petal atmosphere:
  - static cost 0.54 ms (budget 1.5 ms);
  - at 720p, 0.90 ms per frame with it and 0.60 ms without: 0.30 ms.
- Scene build per material scene: 0.14–0.67 ms (budget 4 ms). behave + solve: ≤ 0.023 ms.
- `mix.test.js` runs in about 13 s. It has 24 tests, including the harness: 8 samples and 40 generated recipes × 7
  aspects × 24 times.
- Fifteen mutations were checked, and each fails its test:
  - registryFor always extends; mixShare ignored; no beat skipping; minimum life dropped;
  - an arrive that does not end at identity; rhash that ignores the recipe; a mirror that keeps its direction;
  - K.media never called; the media depth left out; a filter stack that leaks a surface;
  - the per-entry memo off; particles filled one by one; paint state leaking between frames;
  - a flash base accepted; the count knob ignored.

**Requests to other packages**
- **A (or the lead), `core/registry`:** exempt definitions added through `extend` from `RESERVED_PARAMS`. In
  `checkParams`, use `const reserved = mine ? [] : RESERVED_PARAMS[def.kind] || []`. §5.7.6's knob `count` is always
  part-qualified (`@myMat3.count`), so it cannot be confused with the slot `ornament.count`. `parts/mix` switches to
  `count` by itself.
- **A (optional), `core/recipe`:** `problems` and `cost` normalize their input again; a fast path for recipes that
  `normalize` produced would cut the first composition by about half.
- **B:**
  - `build.js`: `env.mixShare` per §5.9.4, summing `def.mine.cost.particles`. Every `mine.cost` is an object; media
    grounds have particles 0.
  - `perf.py`: material particles are drawn by paints, so budget checks should use the `mine.cost` sum, not
    `FrameStats.drawn.particles`.
  - `facade.setDoc`: `MIX.registryFor(base, doc.materials, doc.media)`.
  - The lab: re-key `sampleDefs(base)` as the tests do (`myMatS…` → `myMatz` + lowercase).
  - `K.media`: C passes `p.depth: 'anim'` and skips its border when `K.media` returns −1.
- **D:**
  - the `registry.problems` format above;
  - `extra[key].media` is an id array for materials (for `plan.media`) and `true` for pooled-media grounds, whose asset
    id is `mine.id` (and the `image` auto).
- **E:** the derive problem codes above, for review texts and `fromAi` warnings. `materialHash` hashes the whole
  normalized entry: id, kind, by, name, blurb, tags, season, pool, rv and recipe.
- **F / G:**
  - hide derived media grounds with `registry.extra[key].media === true`, not a truthy test, because materials carry an
    id array;
  - `mat.problem` needs texts for the codes (strings wanted below).

**Strings wanted** (package F; `mat.problem`'s `{what}` for C's codes)

| Key | ja | en |
|---|---|---|
| `mat.why.no-base` | 元にする部品が見つかりません | The base part was not found |
| `mat.why.flash-base` | 点滅する部品は元にできません | A flashing part cannot be the base |
| `mat.why.part-missing` | 部品「{key}」が見つかりません | The part "{key}" was not found |
| `mat.why.part-flash` | 点滅する部品は使えません（{key}） | Flashing parts cannot be used ({key}) |
| `mat.why.part-scope` | 「{key}」は使える範囲が違います | "{key}" works in a different scope |
| `mat.why.part-frames` | 寄り引きのカメラは1つまでです（{key}） | Only one framing camera move ({key}) |
| `mat.why.part-param` | 「{key}」の設定「{name}」が読めません | The setting "{name}" of "{key}" could not be read |
| `mat.why.part-mirror` | 「{key}」は逆向きにできません | "{key}" cannot be reversed |
| `mat.why.param` | 設定「{name}」が読めません | The setting "{name}" could not be read |
| `mat.why.mirror-missing` | 逆向きにする入りの素材が見つかりません | The entrance material to reverse was not found |
| `mat.why.kit` | 素材を部品にできませんでした | The material could not be made into a part |
| `mat.why.def` | 素材の定義に問題があります | The material definition has a problem |
| `mat.why.media-key` | おまかせで使えない写真・動画があります | A photo or video cannot be used in automatic picks |

## Lead: materials may name their count knob `count`

Package C asked for this (NOTES v2.1-C). `core/registry.checkParams` keeps `count` reserved on catalog ornaments and
filters, where it would clash with the list slot's count. A definition added through `extend` (a material) is exempt,
because its paths always carry its key (`atmos@myMat3.count`). `parts/mix` detects this when the module loads, so the
ornament count knob is now `count`, as the §2.1 example writes it. Test: `registry.test.js`, "a material may name its
ornament count knob `count`".
## v2.1-E

Package E of DESIGN_2_1 §8.5, with its media additions (§11.6) and the depth request (§11.9.4): the `direct` tool, AI
materials, vision, and the v2.1 parts of `ai/changes`, `ai/catalog` and `ai/looks`.

- **New modules** (L5): `ai/direct` (requests, the FROZEN answer schema in five frozen variants, answer → changes),
  `ai/recipe` (`AI_MATERIAL`, `fromAi`, `toAi`, the standalone material tool, the `[media]` list), `ai/vision`
  (`VISION_SCHEMA`, `visionRequest`, `visionChanges`).
- **Changed:** `ai/changes` (kinds `value`, `material`, `media`; groups; the new Change fields; `markStale` with
  `staleWhy` and `resolveArea`; `toCommands` in the §5.6 order with `requires` and the apply-time area check; material
  and media log items and revert; review text), `ai/catalog` (`atmos`, `materialsText`, `cameraText`, `recipeText`),
  `ai/looks` (the `helpers` export only), `core/media` (§11.9.4: `ai.depth`, `DEPTHS`).
- **Tests:** `ai_direct` (32), `ai_recipe` (14), `ai_vision` (5) are new; `ai_providers` walks every new schema variant;
  `ai_looks` checks the helpers and pins the hashes of the two look schemas; `media_core` and `media_doc` cover
  `ai.depth`.
- **Mutation check:** 21 mutants of the key rules; 20 fail a test. They cover `requires`, the stale reasons, revert while
  the user uses a material, the free index, lines over all, the speed epsilon, the area guarantee and its cut-in-line
  rule, depth `keep`, locks, the recipe drift guard, the flash fix, budget scaling, toAi curve names, vision boxes and
  JPEG-only parts, and `ai.depth` in `normalizeEntry`. The survivor is equivalent: an unknown depth written by
  `visionChanges` is also dropped by `normalizeEntry`, whose own mutant fails.

**Decisions where the design is silent**

- **Material hash.** Stale checks and revert compare `CH.entryHash(entry)` = `hashJSON` of the stored entry.
  `material.put` stores entries normalized, so this is the §3.12 definition of `parts/mix.materialHash`. E does not
  call the stub, whose constant `'00000000'` would make every material look unchanged.
- **Areas and targets.**
  - `lines[i]` wins over `all` field by field, even when the line's value cannot be used: that line gets neither.
    `camera` is merged slot by slot.
  - A cut area merges `all`, `lines[0]` and `cuts[0,0]` onto the cut; `season` and `avoid` are never cut pins.
  - Cut pins are written under the plan cut's `pinKey`, as `ui/fields.writePath` does. Area checks use the cut key.
  - A special cut (title, intro, outro, gap) is sent as line 0 with `lineId: null`.
  - In a whole-video brief, `all.avoid` turns the parts off (the existing kind `avoid`, a filter), because
    `work:avoid` is refused. `all.season` and `work.season` make one work season change.
  - Windows: a line area applies `all` to the lines of each window. A whole-video brief split into windows applies
    its work pins only in the first part (the prompt says so). Ids are `w<k>:s<s>:<path>`, materials `w<k>:mat:<i>`.
- **Values.** Parts are "no change" only when the target's own pin holds them (as in `looks`). Values compare with
  what the target shows (its pin, else the plan). `from` is the target's pin, else the first cut the line pin reaches.
  `ornaments: ['none']` / `filters: ['none']` pin the count 0. A run-scope ornament named among `ornaments` is taken
  as the atmosphere.
- **Materials.**
  - `use.slot` other than `none` places the material where its kind goes (§5.11 table); the given slot word is not
    trusted further. `use.s = −1` means every understood brief of the window.
  - The season fix is added when the season in effect is a specific season other than the material's (not under
    `any`), unless the answer set one. It is skipped in cut areas, where it would leave the area.
  - A remake keeps the id, kind, name and おまかせ setting; `by` becomes `ai`.
  - `fromAi` details: the seed is `hash32('material', name)`; particles and glyphs spin from any angle (`rot [0, 360]`);
    `appear: 'always'` is `{ start, none, 0 }`, other appears last 0.5 s; `index`/`word` oscillators step 0.3; a
    composite's `dur`/`each` become `[d, d]` (−1: the kind's default range); a variant's `dur`, `each`, `curve` (its
    `ease`) and `order` become shared autos, and a param named like a shared param is one too; a media layer's border
    is `stroke × 1000` du and its shape maps roundRect → round, ellipse/ring/dot → circle, arc → arch, else round; a
    ground without a leading fill gets its first fill moved to the front, or a default fill.
  - Fitting order: the flash fix first (alpha movers off `beat`/`ramp` to `sine` ≤ 1 Hz, hz ≤ 3 / speed knob max,
    amp ≤ 0.35 / amp knob max, appear ≥ 0.15 s), then counts × 0.9 (at least 1) until the recipe fits, then the last
    layer, then the last part. Anything still wrong gives `null` and `ai.warn.matEmpty`.
- **Curves.** `curveFromAi` lives in `ai/recipe` (materials need it; `ai/direct` re-exports it). It reads the §1.4 #1
  names too: slowFastSlow / fastSlowFast (ramps), easeIn / easeOut / easeInOut (cubic), hold (holdThenDash), snap
  (dashStop). A ramp without numbers takes edge 0.1 and peak 4. `cameraFromAi` also accepts a move word as `shot`.
- **Media.**
  - `opts.media` is `true` (the library) or a list of asset ids (the ones whose bytes are on this device).
  - The accept rule reads the part's `media` spec; a param that is not of type `media` yet (today's
    `photoPan.image`) accepts any. Params the part does not have are skipped.
  - A kind mismatch warns with the planner's existing string `warn.media-kind` (`{ detail: name }`).
  - `use: 'none'` clears exactly the pins §11.6.1 names; the AI's param pins of those parts (a blur) stay, unused.
  - `depth` with `use: ''` pins the depth of the media part the target shows as `as` (the ground's `photoPan` or a
    pooled `myMed…` ground, the atmosphere's `mediaLayer`, every `photoFrame`); `fill` has none; `keep` does nothing.
- **Vision.** Image parts are passed through as given, in either JSON spelling (`inline_data`/`mime_type` or
  `inlineData`/`mimeType`); only inline JPEG parts count. The prompt lists `n=k: photo | video (frames)` and the tag
  vocabulary. `use` and the depth `reason` stay on the change for the review; neither is stored (`ORDER.assetAi` has no
  field for them).
- **Review text.** Direct rows use `ai.ch.value` with `where` as a label tuple; `CH.describeAgg(list, t)` gives the
  aggregate row; `null` reads 自動 and a `none` part なし. `logEntry` records a material's hash as stored after the put.
- **Cost.** Area membership is checked with `CH.inArea`, the rule of `planner/areas.inArea` with the area's scopes in a
  Set, so a large review stays linear (the per-scope `paths.isUnder` loop took 3/4 of the time). `toCommands` and
  `markStale` resolve each area key once per call. Measured on 100 area lines (a loaded machine): the request builds
  in about 1.4 ms; validation costs about 10 µs per change it produces (an answer that sets 11 settings on 100 lines
  gives 1,100 changes in about 12 ms; three settings, about 3–4 ms). §7.2's "< 2 ms for 100 lines" holds for the
  request and for answers that change a few settings; nothing here runs per frame.

**Deviations**

- `CH.GROUPS` keeps its four v2 groups; the §5.6 groups are `CH.AREA_GROUPS` (`materials`, `area`, `cuts`,
  `outside`). `ui_ai.test.js` (F) asserts that every `GROUPS` key has a heading in `ui/ai_controller` `GROUP_ORDER`,
  which F owns. `groupOf` returns the new groups already.
- `ai/looks.helpers` also holds `flashChange` (the direct tool's `work.flash`) and `PALETTE_SCHEMA` (§5.4 names
  `LOOKS.PALETTE_SCHEMA`); keeping it inside `helpers` leaves the other exports unchanged.
- A gone area marks its rows `left` (区画から外れました), not `gone`, whose text is about cuts.
- Additive exports beyond §3.13: `ai/direct.MEDIA_USES`; `ai/recipe` `AI_MATERIAL_MEDIA`, `MATERIAL_SCHEMA_MEDIA`,
  `USE_SLOTS`, `curveToAi`, `materialChange`, `slotFor`, `freeIndex`, `whereOf`, `assetOf`, `mediaSent`, `mediaText`,
  `MAX_MEDIA`; `ai/changes` `AREA_GROUPS`, `STALE_WHY`, `describeAgg`, `entryHash`, `keyInUse`, `inArea`; `ai/vision` `MAX_ITEMS`,
  `MAX_FRAMES`, `USES`, `DEPTHS`; `core/media.DEPTHS`; `ai/catalog.catalog` takes an optional fifth argument
  `{ mine, cutOrnaments }` (defaults keep v2's lists).
- `ai_looks.test.js`: the drift guard that lists every change kind now names `value`, `material` and `media` as covered
  by `ai_direct` and `ai_vision`.

**Requests to other packages**

- **F** (`ui/ai_controller`, `ui/ai_review`, `ui_ai.test.js`):
  - add `materials`, `area`, `cuts`, `outside` to `GROUP_ORDER` with their headings (`ai.grp.*`), then fold
    `CH.AREA_GROUPS` into `CH.GROUPS` (one line in `ai/changes`), or let the test read both;
  - `itemKey` of the new log items: `{ material: id }` → `'m:' + id`, `{ media: id }` → `'a:' + id`;
  - pass `resolveArea(areaKey)` (the sent brief's ref through `AREAS.resolve`) to `markStale`, `toCommands` and
    `apply`; dispatch with `['undo.aiArea', { area, n }]` (`['undo.ai', …]` for the whole video); give `logEntry` the
    `areas` and `instructions`;
  - run the windows of one request in order and merge them into one review; on `bad_request` retry once with
    `allowMaterials: false` and show `ai.materialsFailed`;
  - aggregate rows through `CH.describeAgg`; a material's dependents (`requires`) disabled while it is unchecked;
  - vision rows: `change.depth`, `change.reason` and `change.use` next to the caption (`media.ai.depth`).
- **C:** keep `materialHash(entry)` equal to `hashJSON` of the stored (normalized) entry, so it agrees with
  `CH.entryHash`.
- **B / G:** the direct tool pins only the media params a part has: `fit`, `blur`, `veil`, `clipIn`, `speed` (§11.5.6)
  and `depth` (§11.9.1, an enum with `auto`).
- **Lead:** the vision `reason` has no field in `doc.media`. If the asset page should show it after the review, the
  entry format needs `ai.reason` (≤ 60).

**Strings wanted**

None new. `param.depth` and `opt.depth.*` (§11.9.6, package F) are read through `t.has` and fall back to the key until
F adds them.

## Lead: the AI's depth reason is stored

Package E kept the vision `reason` on the review change only. §11.9.5 shows it on the asset page, so it is now stored:
- `core/media.AI_ORDER` ends with `'depth', 'reason'`.
- `normalizeEntry` keeps `ai.reason` only as text next to a valid depth.
- `entryProblems` refuses a reason over 60 characters or one with control characters.
- `ai/vision.aiOf` writes the cleaned reason with the depth.

Tests: `media_core.test.js` (normalize and problems) and `ai_vision.test.js` (stored with the depth, dropped with an
unknown depth, field order).

## v2.1-G.1

G.1 of DESIGN_2_1 §8.7: images and videos at runtime, and the single-file project package. Pure: `core/sha256` (L0),
`media/sniff`, `media/isobmff`, `media/matroska`, `media/samples`, `media/palette` (L1), `export/unzip`,
`export/package` (L5). Host: `media/host/probe`, `media/host/session`, `media/host/store` (L6). Changed:
`export/zip` (`addBlob`, Blob parts, a faster CRC-32), `export/host/sink` (`write` takes a Blob), `ui/project_io`
(IndexedDB v2, the device media store, pruning, the package save and open, routing by sniffing), `build.py` and
`tests/build_test.py` (layers). H.1's four files (`export/webm`, `export/subtitles` and their tests) were checked out
from the lead branch unchanged, as the lead asked (no merge).

**What works now.** A photo, animation or video imports (sniff, SHA-256 + CRC-32 in one pass, probe, poster and
12-tile filmstrip, IndexedDB) and is added to `doc.media`. The AssetStore gives frame-exact video frames (WebCodecs
fed from our own sample tables) and still tiers; the engine does not draw media yet (B.3, G.3), and `ui/boot` passes
`assets: null` until G.4 wires the store in. 保存 / 名前を付けて保存 write a `.mojipv` holding the project, every asset,
the posters and the song; opening one restores all of it, the song included (it is stored again by its sha1, so
`ui/boot` re-links it as usual).

**Tests.** Node: `sha256`, `media_demux`, `media_samples`, `media_palette`, `unzip`, `package`, `zip` (+),
`project_io_media` (new: the pure parts of the project_io additions). Browser: `media_import.py`, `package_io.py` (both
in the built app page, under its CSP, through the app's own `ui/project_io`). Frame exactness is checked in G.1
already, through the real AssetStore: every frame of the counter videos (VP9 WebM 30 and 60 fps, VP9 MP4 25 fps,
VFR, rotated; H.264 where the browser encodes it), in order, shuffled, and in a software export fork, shows its own
code. Mutation checks: 20 mutants across the pure modules and the build rules, and one of the store (it hands out the
previous frame), all caught; two tests were strengthened on the way (the EPS rule is now tested directly, and pixels
counting by their alpha in the palette).

**Measured** (this machine: 4 shared CPUs, load 5–12; headless Chromium):
- Hashing plus CRC-32 of a 64 MB file in the page: 127 MB/s through `crypto.subtle` (files ≤ 256 MB) and 109 MB/s
  streaming (our SHA-256), under that load. CRC-32 alone went from 358 to 674 MB/s with slicing-by-8; our SHA-256
  alone runs at ~120 MB/s in Node. The §11.5.12 "≥ 150 MB/s" row is plausible for files up to 256 MB on an idle
  mid-range laptop, but the streaming path (> 256 MB) is bound by our SHA-256; see open items.
- Exact frames through the store: 135 decodes (three passes of 45 frames, 192×108 VP9) in 170–220 ms, 270 at 60 fps
  in about 410 ms, including every seek of the shuffled pass.

### Decisions where the design was silent

- **Committed fixtures without ffmpeg** (the constraint of this run): `tests/helpers/make_media_fixtures.js` writes
  them byte by byte: ISO BMFF boxes, EBML elements and GIF blocks are real; codec payloads are placeholders except a
  VP9 key frame's uncompressed header, and `anim.gif` is a real GIF (LZW data) that browsers decode. `MAKE.txt` holds
  the generator line, the ffmpeg recipe each file could be replaced with, and the expected tables (computed by the
  generator from what it wrote, not by the demuxer). `media_demux.test.js` rebuilds everything in memory and fails if a
  committed byte differs. In the browser the placeholder clips are refused as `media.err.codec` (no decoder for the
  codec here) or `media.err.broken` (a decoder, bad data); `media_import.py` asserts exactly that.
  - Contents beyond §11.8.1's list: `bframes.mp4` also has an empty edit and one pre-roll frame; `frag.mp4` uses trun
    version 1 with negative composition offsets; `rot90.mp4` uses `co64` and `colr nclx`; `clip.mov` has a `wide` box,
    `colr nclc`, a constant `stsz` and a sound track; `laced.mkv` is H.264 + Opus with a last frame in a BlockGroup
    with BlockDuration; `av1.webm` has a Segment and Clusters of unknown size.
- **SampleTable.** `n` counts shown frames; the decode-order arrays may be longer (pre-roll: fed, never shown).
  Equal presentation times get distinct chunk timestamps (+1 µs in presentation order), so decoder output always maps
  back to one sample. The last frame's duration is its own sample duration, else the median. `vfr` ignores the last
  frame and allows 1.5 ms or 5 % around the median (so 33/34 ms WebM steps are constant rate). `runFor` steps back one
  GOP for a leading picture of an open GOP (shown before its key frame).
- **MediaError** lives in `media/samples` (both demuxers and the host use it). Its codes are the §11.7.9 ones plus
  `container` (§11.4.3 laced video, and Matroska content encodings), `tooBigVideo` (> 4 GB), `tooFast` (> 120 fps) and
  `audioOnly` (a file with sound only: `ui/project_io` sends it to the song).
- **Demuxers.** `Movie.warnings` is added (`rotation` for a matrix that is not a quarter turn; `codec:<fourcc>`).
  VP8/VP9 tracks get no `description` (vpcC is not decoder input; the §11.4.3 wording lists it). ctts and trun
  composition offsets are read signed in both versions, as writers use them. Matroska also accepts H.264 and HEVC
  tracks (`V_MPEG4/ISO/AVC`, `V_MPEGH/ISO/HEVC`, CodecPrivate as description); any element that runs past the end of
  the file is `broken` (a cut download), and `parse(…, { tracksOnly })` stops after Tracks for routing. The VP9 level
  table goes to level 52 (4K60), one step past the §11.4.3 list.
- **Matroska times (lead decision):** when a track has a DefaultDuration and every block time is within 0.5 ms of
  i · DefaultDuration (i counted from the first frame, in presentation order), the frames start exactly there;
  otherwise the stored milliseconds stay (VFR). Tested at 24, 29.97, 30 and 60 fps over 40 s of frames and on
  `export/webm` output (no off-by-one), and on a VFR file (times kept).
- **sniff** returns three more kinds for routing: `audio` (WAV, MP3, AAC, FLAC, Ogg, M4A), `package` (a ZIP whose
  first entry is the package mimetype) and `zip`.
- **Probe.** Posters are drawn upright (`rot` applied), WebP, 320 px on the long side; the filmstrip is one WebP sprite
  of 12 tiles, 160 px on the long side each, key frames spread evenly (frames, for animations). The thumbs record is
  `{ v: 1, poster, strip, tiles }` (tiles added). The mediaIndex track record holds codec, description, coded and
  displayed size, rot, colour, alpha, audio, container and mime, so a stored video's entry is rebuilt without a second
  scan. Import results carry `notes` (`animFirstFrame`, `alphaIgnored`, `bigFile`, `quota`, `memoryOnly`) and `crc`.
  An SVG keeps its file name as the entry name; the stored bytes and mime are the PNG.
- **AssetStore** (`createMediaStore`): it takes `entries(id)` (the document's metadata; w, h, kind and anim come from
  it) besides the §11.3.5 options, and adds `check(ids)` (load presence so `has`/`info` answer at once) and
  `forget(id)` (drop caches after a relink or a clear). `ready()` items may carry `{ px, blur }` for stills (see the
  request to B). `MediaFrame.w`/`h` are the displayed size of the image returned (a tier, a poster, a video frame), and
  posters and stills have `rot` 0. Blur is quantized to 0, 2, 4, … 128 device px; the crossfade between two levels is
  left to the drawer. `fork()` prefers software decoders. A missing or failed asset gives `null` (the placeholder).
- **Sessions.** Up to the target the queue holds 8 chunks; after the target, one chunk at a time once the decoder has
  taken the previous ones, so frames after the target are not output (and closed) before they are asked for: with
  HOLD = 3 an overshoot would force a seek. Frames at or after the frame being decoded are kept; `pin()` keeps an
  export batch, `hint()` is the preview look-ahead. No decoder progress for 10 s counts as a decode error (the §11.4.4
  retry rule then applies).
- **project_io.** DB v2 adds `media`, `mediaIndex`, `thumbs`; `putMedia` returns `{ stored, reason }`, and a failure
  (no IndexedDB, or `QuotaExceededError`) keeps the record in a per-tab Map. `persist()` is asked once, at the first
  media put. Pruning keeps an asset used by a kept work, the current document or this tab's `usedMedia`. `clearDevice`
  clears the three stores and the Map. `save()` follows the file handle's kind, `saveAs()` writes a package (the picker
  offers the light .json second, and choosing it writes the light save), `saveLight()` is new; `fileState()` gives
  the header tooltip data. `openFiles` routes by `routeOf` (text formats by extension, the rest by bytes, containers by
  their tracks). Until G.4 sets `app.media.importFiles`, `openFiles` imports media itself (`importMedia`: one undo
  step, `media.dup`, `media.full`, the `media.err.*` toasts). Opening a light .json or a package shows
  `media.missingOpen` when assets are not on this device. A package's song is stored as a File named after
  `doc.song.name`, so the existing relink path decodes it.
- **Package.** `layout()` returns every entry in the FROZEN order (text entries carry their text), the manifest and
  the exact file size (`archiveSize` mirrors `export/zip`). Thumbs are packed only for the media that are packed; the
  song only when its sha1 is the document's and is 40 hex digits. `manifestProblems` returns `'code: detail'` strings
  (`newer` → `pkg.err.newer`, others → `pkg.err.invalid`) and also checks file order and that project.json comes last.
  `mimetypeProblem` checks the first entry by its CRC and size (plus a sniff of the first 64 bytes when opening).
- **Unzip.** The end record is read from the last 22 bytes when there is no comment (so only headers are read), else
  from the 65,557-byte tail. An unsafe name refuses the whole archive (`bad-entry` → `pkg.err.invalid`); bytes that are
  no ZIP at all → `pkg.err.notPackage`; a cut file → `pkg.err.truncated`. `Entry.limit` (the directory start) is added.
- **Memory sink** keeps Blob parts by reference and accepts them only as appends (overwriting inside a Blob part
  throws; nothing writes that way).
- **build.py**: besides the §11.3.1 rules, `engine/*` may not depend on `media/*` (the design says it never does).

### Deviations (with reasons)

- **Fixtures** are generated, not made with ffmpeg (no ffmpeg here; see above). The ffmpeg recipes are in MAKE.txt.
- **`tests/browser/ui_flows.py`** (package F's file): its IndexedDB helper opened `mojipv-v2` at version 1, which throws
  VersionError once G.1 upgrades the database to 2. One edit: it now opens the current version. No check changed.
- **`package_io.py`**: "a frame of the preview identical to before" is skipped until G.3 (the engine draws no media
  yet), as §8.7 says. The 4.1 GiB run (`--long`) needs 8.5 GB of OPFS; the local headless profile's quota is 969 MB,
  so it reports a skip there. ZIP64 sizes are also checked in Node with a fake 4.1 GiB Blob (`zip`, `package` tests).
- **No APNG / animated WebP is generated** in the browser (canvases cannot encode them); `anim.gif` covers animation
  decoding, the ImageDecoder table and the store.
- **Re-probing** (§11.2.9, `pv < PROBE_V`) is not implemented: PROBE_V is 1 and `entryProblems` refuses pv < 1, so no
  entry can need it yet. It is one call to `importFile` on the stored blob when PROBE_V moves.
- **The 80 % quota warning** and a package toast without a song have no string yet (below); `quotaNote()` exists, and a
  package without a song reports with `io.saved`.

### Requests to other packages

- **B (B.3):** (1) `mediaAt` items for still nodes should carry `px` (the node's `want.px` at that output scale) and
  `blur`, so `mediaReady` → `assets.ready()` decodes exactly the tier the export draw asks for; without them the store
  decodes the largest tier any `frame()` asked for, else full size. (2) `MediaFrame.w`/`h` are the returned image's
  displayed size: scale FitRect by `w / meta.w`. Posters and stills are upright (`rot` 0); video frames come in coded
  orientation with the track's `rot`. (3) `frame()` returns `null` for a missing or failed asset (placeholder in the
  preview; the export throws). (4) The store does not crossfade blur levels.
- **G.4:** set `app.media.importFiles` (the §11.7.2 flow) — `project_io` defers to it; create the store in `ui/boot`
  with `createMediaStore({ blobs: app.io.mediaBlobs, entries: (id) => entry of app.doc.media, canvas })` and call
  `check(ids)` on load and `forget(id)` after a relink or clear; show `quotaNote(await io.storageInfo())`; progress
  toasts from the `onProgress` of `savePackage`/`openPackage` (and an AbortController for [中止]); the header file
  line from `io.fileState()`; ≡ › ファイル › 軽い保存 → `app.io.saveLight()`; the import notes as toasts.
- **F:** the strings below; the one-line `ui_flows.py` edit above.
- **H (H.2):** `sink.write` takes a Blob; `zip.addBlob(name, blob, { crc })`; a memory sink keeps Blob parts append-only.
- **Lead:** `build.py` has the extra engine → media rule; DESIGN §11.4.3 could list VP9 level 52 and the Matroska
  snap rule.

### Strings wanted (key, ja, en)

- `media.err.container`: 「この動画の入れ物（コンテナ）の形式には対応していません: {name}」 / "This video's container layout is not supported: {name}"
- `media.err.tooBigVideo`: 「4GBより大きい動画は読めません」 / "Videos larger than 4 GB cannot be read"
- `media.err.tooFast`: 「120fpsを超える動画は読めません」 / "Videos above 120 fps cannot be read"
- `media.warn.storage`: 「この端末の保存容量の{p}%を使っています（{size}）。作品ファイルに保存してください」 / "{p}% of this device's storage is in use ({size}). Save a project file"
- `io.savedWhatNoSong`: 「写真{p}・動画{v}」 / "{p} photos, {v} videos"
- `media.note.animFirstFrame`: 「このブラウザではアニメの最初のコマだけを使います」 / "This browser uses only the first frame of the animation"
- `media.note.alphaIgnored`: 「1920×1080 より大きい透明動画は、透明なしで再生します」 / "Transparent videos larger than 1920×1080 play without transparency"

### Open items

- The streaming hash path (files over 256 MB) runs at about 100–120 MB/s here, below the 150 MB/s row. A faster
  streaming SHA-256 (unrolled rounds) would close it; `crypto.subtle` cannot stream, and a tree hash instead of the
  plain SHA-256 would change the AssetId, which needs a D§9.4 decision.
- H.264 counter videos and H.264 decoding are exercised only where the browser encodes H.264 (Chrome CI:
  `MV_REQUIRE_H264=1` fails the run without it).
## v2.1-D

Package D, the planner (DESIGN_2_1 §8.4), with the media additions of §11.2.6 and §11.5.9 and the depth resolution of
§11.9.2. Plan v2 (§2.7): `v: 2`, the camera slots of every cut, `cut.rig`, `rigs`, `grounds[].zoomed`,
`feat.sectionStart` and `media`.

- **New:** `planner/camera` (L2): the `motion.speed` slot and its scaling of motion parameters (§4.3), the automatic
  shot, zoom, curve and follow of every cut (§4.7), carry between the cuts of one line (§4.5.7), and the rig runs with
  `rig` and `rig.curve` (§4.6). Tests: `camera_planner`, `planner_areas_season`, `planner_materials`, `planner_media`.
- **Changed:**
  - `cast`: the FROZEN slot order with `motion.speed` after `text.*` and the four `cam.*` slots after `lens`, each on
    its own slot stream, so no part choice moves. Line conditions (§4.9): the effective season (line pin, else the
    look's) and the line's avoid list feed the pools, which are cached per condition. The cast cache is keyed by
    `registry.base ?? registry`, then by `registry.version` (the last 4).
  - `choose`: a part of the line's own season weighs `SECTION_SEASON` ×2.5; the look-only factors are cached per season;
    `noMedia` gives derived media grounds the weight 0.
  - `params`: media params are checked against `doc.media` (`media-missing`, `media-kind`, the value falls back to
    `''`); `depth: 'auto'` is resolved (`depthRule`, `textCoverage`); a frame in front never sits `behind` (an
    automatic `place: 'behind'` becomes `side`, §11.9.3).
  - `tracks`: segments also break where the effective season changes and where the media source of a pinned ground or
    atmosphere changes; grounds, atmospheres and seams read their line's conditions; a line with its own season has an
    atmosphere chance of at least 0.85; derived media grounds never go to a segment under 3 s or to the title card;
    motions replaced by a seam follow the cut's speed.
  - `plan`: `sharedText` uses `registry.baseVersion ?? registry.version`; `matTerms` and `mediaTerms` go into the cut
    fingerprint, the encoding key and `groundFp`; `plan.media`; `material-bad`; `grounds[].zoomed`.
  - `features` (`sectionStart`, `sectionOf`), `segment` (the specs of the line slots `season` and `avoid`), `encode`
    (`rig` in the cut; canonical curve and shot objects print as plain decisions), `explain` and `fields` (every new
    slot, its why codes and alternatives, `media.pin`, `media.pool`, `why.media.depth.<rule>` as the auto text of a
    depth field).

**Goldens.** `node tests/update_golden.js --check` reported `plan_hashes.json: DIFFERS` and `frame_hashes.json:
matches`. The plan golden was regenerated: all 240 entries change because every plan now has the Plan v2 fields (`v: 2`,
five camera slots per cut, `cut.rig`, `rigs`, `grounds[].zoomed`, `feat.sectionStart`, `media: {}`). The registry
version stays `1e6ef40c`. No part choice changed:
- `camera_planner` checks a digest of every v2 choice (parts, their parameters and sources, cut windows, grounds,
  atmospheres, seams, warnings) over corpus(4) with the stub and the synthetic registry against the digest of the
  planner before v2.1;
- before regenerating, 720 plans (corpus(20) × stub, synthetic and catalog) were compared value by value with the old
  planner: every v2 value was identical.

The regenerated `frame_hashes.json` is byte-identical.

**Decisions where the design was silent**

- A pin wins over `amount.camera` 0, as pins win elsewhere. `amount.camera` below 0.1 turns off the automatic shot,
  and below 0.15 the automatic rig; pinned shots and rigs still apply.
- Carry is skipped when there is nothing to carry (A's shot ends on the frame, as `wideHold` does) or nothing to carry it
  into (B's shot opens on the frame). It needs A and B on one line, across a hard cut or a text-scope transition, and B
  on a preset shot.
- A pinned rig still gets `amp = q2(0.4 + 0.6·A)`, with ×1.25 (≤ 1.3) on the last chorus. `rig.curve` is read at a
  run's first cut.
- Rig runs also split around each title, interlude and outro cut and where the resolved rig pin changes. A title reads
  the intro row. An interlude or outro cut reads its own row, unless its section is intro, interlude or outro. The last
  chorus is the last run of lyric cuts in a chorus section. An empty document has one run `k` with rig `none`,
  `[0, duration]`.
- The previous run's winner (before its own runner-up rule) is avoided, as the grounds do (D§4.16.6). `none` is exempt.
- `cam.shot` recency reads the previous cut's final shot (×0.1) and the natural shots of the 3 cuts before (×0.4); only
  preset strings count as choices (a custom shot object is not one).
- Line `season` is a line value that cascades (line pin, else the work's season). `work:season` stays the look's. A
  line `avoid` list is the line's pin, else `[]`. A pinned part on the avoid list is used without a warning.
- `material-bad` reads `registry.problems` in the format of `## v2.1-C`: `'<kind>/myMat<x>: <code>'` gives
  `{ id: 'm<x>', code }`; `'<kind>/?: <code>'` gives id `''`. `REG.extend`'s own `'<kind>/<key>: <message>'` gives the
  code `def`. `'ground/<myMed key>: media-key'` is not about a material and gives nothing.
- A derived ground of a pooled asset (`mine.media === true`) adds its asset `mine.id` to `plan.media` and to the
  fingerprints. A material adds the ids in `mine.media`. An id the library does not hold warns `media-missing`.
- **Depth:**
  - How a media part uses its picture comes from `spec.use` when a spec names it. Otherwise a ground is `ground`, a
    run ornament is `layer`, and a cut ornament is `frame`.
  - A pin of `depth: 'auto'` is no pin.
  - The AI's suggestion is read from `doc.media` entry `ai.depth`, only when it is one of anim, front, back or still.
  - The cast cache key of the media library includes each entry's id, kind, anim, dur and `ai.depth`.
- `motion.speed` scales only unpinned parameters, each coerced through its part's own spec, with `pfrom: 'rule'`.
  Explain names this with the rule `speed`.

**Deviations**

- **hints.focus → text coverage.** §11.9.2 rule 5 reads the text boxes of `hints.focus`. Those come from layout,
  which the planner does not have (fonts and measuring belong to the engine). `PA.textCoverage` estimates them
  instead: a lyric cut's text covers about 1.5 / cells of the frame, times the square of its `text.scale`. A segment's
  coverage is the duration-weighted mean over its lyric cuts. A busy still photo is one with coverage ≥ 0.35.
- **§7.3 targets for shots.** The FROZEN weights of §4.7 give less than §7.3 asks, measured over corpus(8):
  - impact cuts → `snapZoom`: 54 % with the catalog, 52 % with the synthetic registry (target ≥ 60 %);
  - framing lens → `none`: 62 % and 62 % (target ≥ 70 %);
  - repeated lines sharing their shot: 34 % and 30 %, against 25 % and 18 % for unrelated cuts (target ≥ 80 %).

  The tests hold the direction and size of each effect. The constants are for the lead's tuning, step (b) of §7.5.
- **Shot stability.** §4.7 says inserting a line changes ≤ 4 other cuts' shots, and a reroll ≤ 3. Because a shot
  weighs ×0.1 against the previous cut's *final* shot, a change can occasionally travel down a run of cuts that
  alternate between two presets. Measured with line starts pinned:
  - catalog: 1 of 108 insertions changed more than 4 other cuts (worst 5);
  - synthetic: 3 of 108 (worst 7);
  - rerolls: 1 of 249 changed more than 3 (worst 5).

  `planner_stability` holds these bounds (≤ 5 % of insertions, worst 7; with automatic timing ≤ 15 %, worst 9; rerolls
  ≤ 2 %, worst 5).
- **Planning speed** (below): the §8.4 targets (cold ≤ 10 ms, re-plan ≤ 5 ms) are not met. The planner before v2.1
  did not meet them either on this machine. v2.1 adds 10–20 % to a cold plan and up to about 15 % to a re-plan.

**Measured** (`project_long`, best of several runs, on a shared machine that other work was also using; the planner
before v2.1 on the same machine in brackets; ms):

| registry | cold plan | re-plan after an edit |
|---|---|---|
| stub | 28–30 (23–26) | 6.7–7.2 (5.6–5.9) |
| catalog | 41–44 (36–40) | 6.8–7.5 (6.1–6.8) |

`planner_determinism`'s own speed test, run alone, measured a re-plan of 5.9 ms and a cold plan of 27.5 ms (budgets 10
and 60 ms). Most of the added time is encoding and hashing (`encodeCut`, `feed`, `planHash`), which grows with the
number of slots (five more per cut). The camera itself (`decideCamera`, `carry`, `rigs`) takes about 3 %. Two fixes
brought v2.1 down to these numbers:
- `plan` now declares every `ctx` field that is filled late or on first use, so `ctx` keeps one shape while the cuts
  are cast. Before, the first plans of a session were up to twice as slow;
- `cast.decideValue` no longer `delete`s the trace-only fields of a decision, which left the object slow for encoding.

Before these fixes, with the machine under heavy load, the cold test measured 55–80 ms against its 60 ms budget; the
planner before v2.1 measured 35–37 ms at the same time. After the fixes it measures 27–37 ms. CI runs the Node tests
one file at a time.

**Requests to other packages**

- **B (engine):**
  - read `plan.rigs` (an empty document has one run `k`, rig `none`);
  - read `p.depth` (never `'auto'` in a plan);
  - read `p.carry` on `cam.shot` and `grounds[].zoomed`.
  - A media part may name its use in its spec (`use: 'ground' | 'layer' | 'frame'`) when kind and scope do not tell.
- **C (materials):** keep the `registry.problems` format above; `material-bad` parses it.
- **F (UI and strings):**
  - add the strings below;
  - `whyParts` could translate the section and season params of `cam.section`, `rig.section` and `season.line`, which
    are key names today.
- **Lead:**
  - tune the §4.7 constants (above);
  - the `diff` view has no readout for the camera slots yet.

**Strings wanted** (key, ja, en)

- `whyRule.motion.speed`: いつもの速さ / The usual speed
- `whyRule.cam.curve`: カットの勢いと雰囲気から / From the energy of the cut and the mood
- `whyRule.cam.follow`: カメラワークと動きの量から / From the camerawork and the motion amount
- `whyRule.rig.curve`: 区画のカメラの標準 / The section camera's own curve
- `val.refs`: {n}件 / {n} parts

## Lead: integrating D after E

With D's planner, the plan resolves rig, motion.speed and media depth, where E's tests had assumed null or auto. By §5.5
("a change that equals the current value is not made"), an instruction that asks for the value a line already has makes
no change. `ai_direct.test.js` therefore asks for values the fixture plan does not hold: rig `leanTilt`, where rc's
automatic rig is `slowSwell`, and depth `still`, where the video ground's automatic depth is `back`. A new assertion covers
the equal-value rule for a rig. The review text of a planned speed now reads the number
(「動きの速さ: 100% → 50%（2行）」) where it used to read 自動.

## v2.1-B

Package B of DESIGN_2_1 §8.2: the engine side of camerawork and curves, the media engine hooks (B.3), sound in MP4
without an AAC encoder (B.4), and the engine part of §11.9 depth (added by the owner during the run).

### What was built

- **Curves in the engine** (§3.11, §4.1–§4.3). `engine/scene/behave`: `ease` takes any curve (`CV.fn`); the shared
  `flow` spreads the stagger as `W(rank / maxRank) · maxRank · each` when it is not linear; `dwell.curve` warps the hold
  over `[rest, out]` through `BH.warped` (a behaviour wrapper that is the behaviour itself for a linear curve).
  `engine/render/seam`: `seam.curve` warps `u` before `mix`. `parts/kit`: a lens without `warp: false` has every
  behaviour it makes warped by `lens.curve` over `[a, b]`; the framing lenses of `parts/lens/glide` read `p.curve` as
  their move's own ease (`warp: false`, and each part's `curve` auto is the ease it had in v2); `beatZoom` and
  `impactKick` are locked to the beat and the sung start (`warp: false`, the curve row `advanced`, not for the AI).
  New kit exports: `K.curve`, `K.warp`, `K.warped`, `K.CURVES`, `K.aimBox`, `K.frameBox`.
- **Shots** (§3.10, §4.4–§4.5): new `engine/scene/shot` (L3): aims (`frame`, `point`, `block`, `reading`, `emph`,
  `first`, `last`, `word:k`, `line:k`, `glyph:k`, every text box floored at 0.06 × short), anchors (`a rest out b sung
  mid end emph word:k beat:n`, numbers, `dt`), framing with the safe and bleed clamps, the reading path, key tracks
  (zoom in log space, the curve of the key moved into, jumps for keys < 1/120 s apart), `runShot` in the LENS phase
  after the lens (lens deltas stay screen-constant: `x = X + x_lens / Z`), and the follow lean as a post-solve pass.
  `build.js` resolves the shot before the lens, so lenses see `env.target` and `env.shot` (the track).
- **Rigs** (§4.6): `frame.rigIndex` / `rigAt` (cached by plan identity; binary search; the blend window of a non-hard
  seam may start before the run), `cutCamera`, `composeCamera`, `cameraAt` (cut camera inside, rig outside, then the
  impulses), `rigCamera` (grounds between cuts keep moving), `depthCam`.
- **Renderer**: the gap camera, the text-seam camera blend, ×1.25 oversampling of zoomed static ground rasters (and of
  still paint rasters on zoomed grounds), `FrameStats` `fz` in the camera. **Facade**: `registry` getter and the
  effective registry (`MIX.registryFor(base, doc.materials, doc.media)`; forks keep it), `shotTrack(cutKey)`,
  `viewAt(t)`, sample plans and thumbnails of kind `shot` / `rig`. Arrange parts got their `cam` field (§3.11 table).
- **Media (B.3, §11.3.6–§11.3.7, §11.5.1–§11.5.6)**: `sb.media` (every field checked, FitRect at build, a timed node
  refuses a static layer cache), `svc.media` → `env.media`, `scene.media`; `shapes.drawMedia` (plain and isolated
  paths, mirror neighbours only when they show, the soft copy first, rotation turned back into coded pixels, veil and
  tint, mask, placeholder in the preview); the recorder logs `drawImage('media:<id>@<m>#<index>', …)` so op hashes
  show the source frame; renderer `layers: 'ground'`, `dc.t`, `dc.backdrop` (overlay footage is `sceneOnly`),
  `FrameStats.media { drawn, waiting }`; facade `mediaAt`, `mediaReady`, `fork({ assets })`, the export exactness throw
  (`EngineError('media-not-ready' | 'media-missing')`), thumbnails ask for posters only; kit `K.media`,
  `K.mediaParams`, `K.MEDIA`, `K.runKenBurns`. New `tests/helpers/fake_media.js` (the AssetStore contract with synthetic
  stills, sample tables at any fps, VFR and rotations; `MediaFrame.index` in the op hash; `testParts(K)`: one test part
  per `use`, for the tests and the lab until G.3's parts land).
- **Depth (§11.9.1, §11.9.3)**: `depth` in `K.mediaParams` (enum `auto anim front back still`, `ai: true`, for `use`
  ground, frame and layer), its meaning in `K.media` (layer, camera factor 1 / 1.15 / 0.5 / 0, Ken Burns, blur + 3 and
  veil + 0.15 for `back`, the front readability guard, `still` drawn outside the seam composite), the per-node view
  through `depthCam` in `draw.js`, and the FROZEN `K.depthCam(cam, f)`.
- **B.4 (§13.4)**: `export/host/mp4` tries AAC-LC 192 kbps, then Opus 160 kbps in MP4; `probe().audioCodec` and
  `Result.audioCodec`; `codecs.audioList` (tests) overrides the order; `schedule.preflight` notes `opus-audio` (info)
  and reports `no-audio-codec` only when neither encodes. Both export loops (`mp4`, `png`) await
  `e.mediaReady(t0 + i / fps, { signal, fps, scale })` through `job.ready(i, signal)`; a store that cannot deliver
  stops the export with `ExportError('media', …, { id, name, code })`.
- **Lab** (`ui/lab.js`): `#shot:<key>@<aspect>&t=…`, `#rig:<key>@<aspect>&t=…`, `#media:<kind>/<key>@<aspect>&asset=
  fixture:<name>&t=…` (fake store, test pages only), a `materials` source (C's `sampleDefs` re-keyed `myMatS…` →
  `myMatz` + lower case; `info()` lists only the materials there), `__lab.thumb`, and `perf({ camera, materials })`.
- **Tests**: new `shot_engine.test.js` (15), `media_engine.test.js` (23); additions to `frame`, `lens_filter_seam`,
  `conformance` (every shot and rig × 7 aspects × h/v × 6 texts × 24 times), `facade`, `export_math`; browser
  `determinism.py` (camera presets; project v21 with materials), `perf.py` (camerawork + materials row),
  `parts_gallery.py` (camera presets and their tiles in every aspect; the media mode), `contact_sheet.py`
  (`--kind shot|rig`, self-check sheets), `export_check.py` (Opus track, its length and level, the pre-flight note,
  the media wait and the `media` error in both loops). Key tests were mutation-checked (composeCamera's rig offset,
  the blend window, the dwell warp, the lens warp wrapper, the zoom clamp, the Opus order, the pre-flight note, the
  export loop's wait): each mutant failed its test.

### Goldens

`frame_hashes.json` is byte-identical. `plan_hashes.json` was regenerated (`node tests/update_golden.js`): all 240
corpus plans changed because the glide lenses' shared `curve` auto is now their v2 ease (§3.11) instead of `linear`.
Checked: with those five `shared` lines removed, the old plan hashes match exactly, and the frames with them are the
v2 frames. The registry version is unchanged (1e6ef40c): shared autos are not in its signature.

### Decisions where the design was silent

- **Impulse shake and the seam camera use the framing zoom.** `composeCamera` divides the shake impulse by the framing
  zoom `fz` = shot zoom · rig zoom (not by the full zoom, which includes the lens's own zoom), and the text-seam camera
  blend log-lerps only `fz` (the rest linear). Both reduce exactly to v2 without shots and rigs, which the frame
  goldens require (a full-zoom division changed v2 frames with punch lenses).
- **Zoom clamp while interpolating.** `poseAt` keeps Z in [0.9, 3] between keys too, not only at keys.
- **Near jumps.** Keys less than 1/120 s apart jump (§4.5); a segment shorter than 0.1 s (pushWord's `emph` key right
  after `a` on a line that starts with its emphasis) is a near jump; the continuity test allows it only within 0.15 s of
  `a`.
- **`auto` depth without the planner.** The plan should always hold the resolved value (§11.9.2). If `'auto'` reaches
  the engine, `K.media` uses layer → front, frame → anim, a video ground → back, a still ground → anim.
- **The front guard** (§11.9.3): a ground or overlay at `front` that covers ≥ 40 % of the frame gets alpha ≤ 0.45 and
  `comp: 'screen'`, unless the part passes a comp other than `over` itself (then it is kept); photo frames are exempt.
- **`still` across seams.** A still medium is drawn once on the target, outside the composite, when it belongs to the
  ground both sides share; a text seam leaves grounds under the composite anyway.
- **`mediaAt` items for stills carry `px` and `blur`** (G.1's request): `mediaAt(t, { scale })` adds the long side and
  blur (device px) the draw will ask the store for (else the last frame's scale; none before a first frame). The
  media lists are remembered per scene fingerprint (`renderer.mediaEntries`), so `mediaAt` never keeps or rebuilds a
  scene after its first build. Blur is fixed per node, so the store's blur levels need no crossfade.
- **Opus rate.** The Opus config uses the song's `sampleRate`: songs are decoded at 48 kHz (DECODE_RATE), so this is
  the design's 48000, and a buffer at another rate cannot be fed at the wrong speed. `codecs.audio` (one codec) still
  works next to `codecs.audioList`.
- **`ExportError('media')` detail** is `{ id, name, code }` (the store's `err.id`, the entry's name, the store's code).
- **Placeholder**: the engine draws the checkerboard only; any text on it is the UI's.
- **Additive fields**: `poseAt` also returns the aim centre `ax`/`ay`; `sb.media` takes `cam` (0..2) and `still`;
  `K.MEDIA.DEPTHS` (with `auto`; `core/media.DEPTHS` is E's list without it); `viewAt` includes the shake in x/y;
  `shotTrack` times are absolute; `FrameStats.mediaError` is internal (the facade turns it into the throw);
  `renderer.lastScale()`.

### Deviations (with reasons)

- **§4.5.4 check line**: the bleed limit formula gives 0.24 W at Z = 1.5, not the "± 0.28 W" the text states. The formula
  is implemented; the number in the text is an arithmetic slip.
- **Reading comfort**: readAlong's hops on fast singing move the aim faster than 1.5 frame widths/s. The continuity test
  holds them to 6 W/s (no jumps); how they read is a visual-QA item.
- **Files outside §8.2** (all as the lead asked or to keep the suite green): checked out unchanged from the lead branch:
  `docs/DESIGN_2_1.md`, `src/parts/mix.js`, `src/core/registry.js`, `tests/node/{mix,registry,contract}.test.js`,
  `src/media/`, `src/core/sha256.js`, `src/export/zip.js`, `src/export/host/sink.js`, `build.py`,
  `tests/build_test.py`. One edit in C's `tests/node/mix.test.js`: its second module world installed the recording
  `K.media` only when the kit had none, so with B's kit it recorded nothing; it now always installs the recorder
  (no check changed). `tests/www/export_check.js` (harness): the VP9 fallback no longer forces Opus, so the default
  AAC → Opus order is what the MP4 checks exercise. `tests/browser/contact_sheet.py` loads `project_v21.json` and
  `fake_media.js` into the lab page.
- **perf.py camerawork row** uses a stand-in until D's planner makes camerawork: a shot preset per cut in turn and a
  rig run per 4 cuts (blended ±0.25 s), plus C's sample material of each kind in every slot it fits.

### Measured (this machine: 4 shared CPUs, load 3–5 from the other packages' tests; headless Chromium)

- `mediaAt` on project_long (Node): 0.06 µs per call without plan media, 1.9 µs with plan media and no media nodes,
  2.2 µs with a video ground on every segment and a photo frame on every cut (budget 50 µs; the test asserts it).
- perf.py at 720p (best of 2 runs): basic p50 11.2 / p95 22.3 ms, vertical 13.4 / 22.3, lrc 4.7 / 15.3, long
  12.1 / 25.0. project_long with camerawork: p50 12.3 / p95 27.8 (behave 0.10 ms, draw +0.25 ms). With camerawork and
  the materials: **behave + solve p50 0.10 ms** (≤ 0.8), frame p50 17.1–18.7 ms, p95 32.1–39.6 ms over five perf.py
  runs (the best of 2–3 fresh engines each; the limit is 33.4 ms: one run passed, four failed). The materials alone
  take p50 17.0 / p95 32.4; most of it is post (+3.9 ms mean): the filter-stack material (4 passes) on every cut.
- Export check (local Chromium, no H.264, no AAC): the default export and the forced one carry an Opus track (`dOps`,
  stereo, 48 kHz, pre-skip 312); decoded length 2.5135 s for 2.5 s (± 25 ms); RMS 0.212.

### Requests to other packages

- **D**: the §2.7 plan fields as the engine reads them: `cut.slots['cam.shot' | 'cam.zoom' | 'cam.curve' |
  'cam.follow']`, `plan.v = 2`, `plan.rigs[]` (`t0`, `t1`, `rig`, `curve`, `blend` window or null), `cut.rig`,
  `grounds[].zoomed`, `plan.media`, and the media parts' `p.depth` resolved (never `'auto'`). Observation for the
  pools: on a wide one-line layout (centerAnchor at 16:9, the block ≈ 0.74 W) `settle` (fill .58 → .66) and
  `driftOff` (.50 → .52) sit at the 0.9 zoom floor, and `pushWord` / `snapZoom` reach the 3× limit on a short emphasized
  word. When the planner makes camerawork, perf.py's stand-in (lab `perf({ camera: true })`) can use the planned plan.
- **C**: `env.mixShare` = min(1, 400 / Σ `mine.cost.particles`) per cut scene (300 for grounds), as asked. `K.media`
  returns −1 for a `src` that is not in `plan.media`, so fixed-src media layers need their ids in `plan.media` (D's
  `extra[key].media`). The mix.test.js edit above. The filter-stack sample material costs about 4 ms of post per frame
  here when it is on every cut.
- **G.3**: build the media parts on `K.media` / `K.mediaParams` / `K.MEDIA` / `K.runKenBurns` / `K.depthCam`; the lab's
  media mode and parts_gallery.py pick up every part with a param of type `media` (photoPan's `image` must become one).
  The four test parts can stay in `fake_media.js` for the tests. **G.1/G.4 (store)**: `ready()` gets
  `{ id, m, px?, blur? }`; a rejection should carry `code` and `id` (used in `ExportError('media')`). The stage calls
  `engine.mediaAt(t)` (tiers at the last frame's scale) for `assets.want`.
- **F**: `ui/output.ERROR_KEYS` gains `media: 'err.exp.media'` (string below).
- **H (H.2)**: the WebM and kit loops call `job.ready(i, signal)` (or `e.mediaReady(t, { signal, fps, scale })`) before
  each frame, as mp4 and png do; `Result.audioCodec` is available.
- **Lead**: DESIGN_2_1 §4.5.4's check line (0.24 W), §11.3.7's `mediaAt` item shape (`px`, `blur` for stills) and
  §13.4's Opus `sampleRate` could be updated to match.

### Strings wanted (package F)

| Key | ja | en |
|---|---|---|
| `err.exp.media` | 写真・動画「{name}」を読めないため、書き出しを止めました。つなぎ直してからもう一度書き出してください。 | The export stopped: the photo or video "{name}" could not be read. Relink it and export again. |

### Open items

- perf.py's camerawork + materials row is borderline here: behave + solve is far within budget (0.10 ms), but the frame
  p95 (32.1–39.6 ms) straddles twice the 16.7 ms hard limit on this loaded machine, driven by the materials' post cost
  (the same project without materials: p95 25–29 ms). To be re-measured on CI (Chrome).
- Visual QA: readAlong's fast hops; the zoom floor and ceiling cases above.
- Only the fake store has driven the media engine so far; the real store (G.1) and the catalog media parts (G.3) meet
  it in G.3 / G.4.

## v2.1-F

Package F of DESIGN_2_1 §8.6: the UI of §6 (the instruction block, the board, the area review, the inspector rows, the
curve widget, the keyframe editor, areas, マイ素材, keys and accessibility) and the §7.4 browser flows. F now holds
`i18n/strings.js`.

**Built**
- **New modules** (L7): `ui/curve_widget` (選択肢, the plot with its handles, かんたん, カスタム), `ui/shot_editor` (キーフレーム:
  rows, markers, ◆, the drag inversion helpers), `ui/material_page` (the material page, the マイ素材 rows and menus),
  `ui/ai_board` (区画ごとに指示).
- **Changed:**
  - `ui/fields`: the §2.3 scope table (camerawork, speed, rig, line season, avoid, curve params); the curve, shot, rig
    and partRefs widgets; the pages of §6.5 (行 › 演出 and 区画のカメラ, カット › 動き and AI, 要素 › カメラ, 全体 ›
    マイ素材); `areaLabel` / `areaTitle`.
  - `ui/widgets` (shot, rig, partRefs; curve from `ui/curve_widget`) and `ui/inspector` (the rows, the shot and part-ref
    pickers, キーフレーム, the material page, この区画 / この行をAIに頼む…, the area header).
  - `ui/part_browser`: the マイ素材 tab with ＋ AIで作る and its inline form, material menus, and the thumbnail key with
    `rhash`.
  - `ui/ai_panel`, `ui/ai_review` and `ui/ai_controller`: the direct and material tools; targets, groups, aggregates,
    dependencies, windows, the bad_request retry and board drafts.
  - `ui/selection` (`sel.area`, `areaSel`), `ui/timeline` (area bands, band options in the listbox, ◆), `ui/stage`
    (markers, drag inversion through `engine.viewAt`), `ui/palette` (`%`), `ui/lyric_editor` (§ selects the heading's
    area), `ui/boot` (the registry comes from `engine.registry` when the engine has it), `ui/style.css` (one v2.1 block
    at the end) and `i18n/strings`.
- **Tests:**
  - Node: `ui_fields` (+15), `ui_ai` (+8, two of them against the real `ai/direct`, `ai/recipe` and `parts/mix`),
    `ui_selection` (+3). `tests/helpers/fake_engine.js` gains `registry`, `shotTrack` and `viewAt`.
  - Browser: `ui_flows` gains six flows (curve, keyframes, areas, ai_area, ai_board, materials) and `ai_edit` moves to
    the instruction block. `ui_layout` checks the new pages at every viewport and in a 288 px panel. `csp` and
    `i18n_pages` walk the new screens.
- **Mutation check:** 25 mutants of the key rules, and every one fails a test. They cover:
  - selection: the area check and `areaSel`;
  - the controller: the dependency cascade, disabled rows at apply, the drafts cap, the bad_request retry, 反映済み,
    log item keys, `boot.soon` and the material request's `sent`;
  - keyframes: the drag inversion and the key-to-track order;
  - the curve widget: knob bounds, Delete, 位置の動きだけ, ease names in words and the speed scale;
  - マイ素材: uses, problem texts, derive problems and the strict media test; the one-line area title.

  Four tests were made stronger on the way: a superset area, a missing material, the exact knob removed and the problem
  text.

**Decisions where the design is silent**
- **Selections and areas:**
  - An area selection is `{ level: 'line', ids, area }` and opens the 行 page with the area header, even for one
    line. `S.validate(sel, plan, doc?)` keeps `area` only while the area still has exactly those lines. Without
    `doc`, a well-formed line-level ref is kept.
  - `view.highlight` may be a list of line ids (an area); the stage and the drawer read both forms.
  - Area titles are 「サビ1（5行）」. The whole video, a cut and a one-line set (「4行」) name no count.
  - The board's rows are the song sections (else the headings, else the blocks), then added and drafted areas. Sections
    without lines (イントロ, 間奏) are rows too, since their special cuts are in the area.
  - A board draft is a one-line textarea that wraps and grows, so 120 characters show whole. Enter never adds a line
    break.
- **Curves and keyframes:**
  - Dragging a preset, an ease or a ramp turns it into its data within the same gesture. A speed-step curve draws its
    speed fill in knot units, through the handles.
  - A keyframe edit pins the whole Shot at the page scope. Editing from なし starts from 落ち着く's keys.
  - Markers use `engine.shotTrack`. Its keys (in time order) are matched to the data keys by their estimated times.
- **マイ素材:**
  - The knobs (量 …) bake their multipliers into the recipe with `core/recipe.withKnobs`, over the recipe as the page
    opened. One drag is one undo entry.
  - この素材を使わない is the kind's filter deny list, like この部品を使わない.
  - [確かめる] lists `parts/mix.derive`'s problems in words (`mat.why.<code>`). [反映] needs a recipe that derives into a
    part.
  - The マイ素材 tab hides grounds derived from pooled photos with `extra[key].media === true`.
- **Keys and the AI tab:**
  - Sub-pages without a tile grid (キーフレーム, マイ素材, 使わない部品's kinds) leave the arrows and Enter to their controls:
    `picker.move` / `picker.pick` run only when the top page has them. ＋ AIで作る is never picked or tried on.
  - Arrowing onto 対象 › 区画 without an area opens the list with the focus on its first area.
  - A question of the direct tool shows under the instruction box, per area, not in the message line.
  - The controller has no stand-in for `ai/direct` / `ai/recipe`: a build without them says `boot.soon`.
  - `GROUP_ORDER` adds `materials`, `area`, `cuts` and `outside`. Their headings are the design's `ai.grp.*` keys;
    `ai.group.*` stay for the v2 groups.
  - The resolver given to `markStale` / `toCommands` / `apply` returns `undefined` for a key it cannot read, so no
    area check is made for it.
- **Two fixes found by the new checks:**
  - The lyric gutter was built with every entry at the top when the editor was hidden (another step) and not rebuilt
    when it showed again. A render while hidden now waits until the editor shows.
  - `.w-seg` now includes its border in its width. The 向き control stuck out 2 px on line pages.

**Deviations**
- The §7.4 "area direct" flow wants "preview renders the material" and "マイ素材 tile exists". Both need B's
  `engine.registry`. `ui_flows` checks them when the engine has it and otherwise checks 全体 › マイ素材 (from the
  document).
- The §6.8 bands in the play bar's lane are not drawn: `ui/playbar` is not F's (request below). The drawer's 曲 row has
  them.
- The layouts give panels of 312, 320 and 352 px. The 288 px end of §7.4 is checked by narrowing the open panel through
  the CSSOM in `ui_layout`.
- `validate(sel, plan)` has an optional third argument.
- axe-core is not available. Roles, names and focus order are checked in the flows instead:
  - radiogroups with roving tabindex, the area listbox and the timeline's band options;
  - tri-state aggregate checkboxes (`aria-checked="mixed"`) and `aria-describedby` on stale and needs-material rows;
  - focus return from sub-pages, and the keyboard-only paths of every new flow.

**Requests to other packages**
- **Lead (`ui/playbar`):** draw the area bands in the lane, and accept a list in `view.highlight`.
- **E:** fold `CH.AREA_GROUPS` into `CH.GROUPS`. `ui_ai.test.js` reads both until then.
- **B:** `engine.registry`, `shotTrack(cutKey)` and `viewAt(t)` are read when present (`ui/boot`, `ui/shot_editor`,
  `ui/stage`). `fake_engine.js` has their shapes. `ui_flows`' `FAKE_TRACK` steps aside by itself when the engine has
  `shotTrack`.
- **G.4:** the G.1 strings wanted are in `strings.js`. `mineFor` already hides pooled media grounds.

**Integration notes**
- From the lead branch, by path and without a merge:
  - `docs/DESIGN_2_1.md` (§11.9);
  - C and E: `src/parts/mix.js`, `src/ai/`, `src/core/media.js`, `src/core/registry.js` and their tests (`mix`,
    `ai_direct`, `ai_recipe`, `ai_vision`, `ai_looks`, `ai_providers`, `media_core`, `media_doc`, `registry`,
    `contract`).
  - `ai_panel` injects `ai/direct` and `ai/recipe` through `MV.has`, so the direct and material tools run against E's
    modules. The Node tests use them with faked answers in E's schema.
- **G.1:** its one-line `ui_flows.py` change (IndexedDB opened without a version) is applied by hand.
- **Fakes to replace:**
  - `tests/helpers/fake_engine.js` (`registry`, `shotTrack`, `viewAt`) and `ui_flows`' `FAKE_TRACK`;
  - `ui_flows`' `ai_board` / `ai_area` answers, which follow E's frozen schema.
- **Strings added:**
  - the F block (curves, keyframes, areas, the instruction block, the board, the area review, マイ素材);
  - §11.9.6 (`param.depth`, `opt.depth.*`, `why.media.depth.*`, `media.ai.depth`);
  - `mat.why.*` (C's derive codes and core/recipe's codes);
  - G.1's `media.err.container` / `tooBigVideo` / `tooFast`, `media.warn.storage`, `media.note.animFirstFrame` /
    `alphaIgnored` and `io.savedWhatNoSong`.

## Lead integration: B and F

### B with D's planner: the five failing Node tests

B (engine) was applied from its worktree commit onto the lead branch, which already had D (planner). Each package kept
every test green alone; together, D's automatic camerawork is drawn by B's engine for the first time.

- **`ai_direct` "camera mode"** — the code is right, the test asked for a value the plan already holds. B gave the
  arranges their `cam` field (§3.11): rb~8's layout `slantBand` is `'gentle'`, so D caps its automatic closeness at
  0.7 / maxFill(pushWord) = 0.7 / 0.88, which is 0.8 in steps of 0.01 (§4.7). The answer's `closer: 0.8` equals it, and
  §5.5 says "a change that equals the current value is not made". The test now asks for 0.9 and asserts that 0.8 gives
  no zoom change (the rule the lead already applied for rigs, `## Lead: integrating D after E`).
- **Golden frames, and B's two tests that compared with the v2 frames.** With the camerawork on, the frames change by
  design (§7.5 step (b), §9: documents without new pins differ from v2 only by the automatic camerawork). The checks
  keep their meaning by comparing like with like:
  - New golden `tests/golden/frame_hashes_v2.json`: the v2 frames, a byte copy of `frame_hashes.json` before this
    regeneration. It is frozen: `update_golden.js` renders the corpus projects with the camerawork pinned off, compares,
    and in a plain run writes nothing at all when they differ (§7.5: the frames that must stay equal are asserted before
    the goldens are regenerated); `--v2` rewrites it on purpose.
  - The switch is `corpus.withoutCamerawork(doc)`: the pins `work:cam.shot` and `work:rig` = `'none'` (§2.3 scopes, a pin
    wins, D's decision). `amount.camera = 0` is not the same thing: in v2 it already sets the lens amplitudes (beatZoom's
    follow) and the punch impulses; with it, only 3–25 of the 40 frames per project stayed equal.
  - `frame.test.js`: new test "with the camerawork pinned off, every corpus project renders the v2 frames" (all four
    projects, and the plan really has no shot and no rig). B's "default lens.curve, seam.curve, dwell.curve and flow give
    the v2 op hashes exactly" runs on the camerawork-off document against `frame_hashes_v2.json`, and additionally
    checks that the same defaults with the camerawork on give `frame_hashes.json`.
  - `media_engine.test.js` "frame hashes of the media-free fixtures are unchanged": with an asset store and no media,
    basic and vertical give the golden frames, and with the camerawork pinned off the v2 frames.
  - Mutation check: a `withoutCamerawork` that pins only `cam.shot` (the rigs stay on) fails all three tests; a changed
    hash in `frame_hashes_v2.json` makes `update_golden.js` stop without writing and `--check` report DIFFERS.
- **Goldens regenerated** (`node tests/update_golden.js`; registry `catalog 1e6ef40c`, unchanged; `frame_hashes_v2.json:
  matches` first). Why they changed:
  - `plan_hashes.json`, all 240 plans. Compared value by value with the planner before B (the lead branch without B)
    over corpus(20) × 3 aspects (18,556 cut decisions): no part choice and no other slot moved; only `cam.shot` (8,742
    cuts), `cam.follow` (6,467), `cam.zoom` (1,963), `cam.shot`'s `p.carry` (1,349), `lens.p.curve` (8,491) and
    `grounds[].zoomed` (143 plans). The causes are B's metadata that D's planner reads: the glide lenses' `curve` auto
    is their v2 ease (§3.11, was `linear`), lens `frames: true` (the `none` weight + 4, §4.7) and the arranges' `cam`
    ('none' pools, the 'gentle' pool and zoom cap).
  - `frame_hashes.json`: basic 40, vertical 40, lrc 39 and long 32 of 40 frames differ, all by the camerawork (the
    camerawork-off test above renders every one of the old frames).
  - **Provisional.** §7.5 step (b) — the visual QA of the automatic camerawork and rigs with `contact_sheet.py` (12 seeds
    × 8 moods × 3 aspects) and the tuning of the §4.7 constants, D's open numbers included — comes after this
    integration. These two goldens are regenerated now so that CI checks the integrated engine, and will be regenerated
    again, on purpose, after that tuning.

### F (UI) applied

- F's worktree commit was applied with `git apply --3way` from its base, without the files F had copied unchanged from
  the lead branch (DESIGN_2_1.md, `parts/mix`, `ai/*`, `core/media`, `core/registry`, their tests, the two pages).
  F's section `## v2.1-F` is placed before this one.
- **One conflict**, the module header of `ui/ai_panel`: both sides kept — F's new dependencies (`ui/ai_board`,
  `planner/areas`, `ui/fields`, `ui/selection`, `i18n/t`) and the lead's `ui/ai_thinking` (the running line's orb
  `AT.orb` and the preview HUD `AT.mountHud`; no `.ai-spin` element is left). The other overlaps merged cleanly and were
  checked by hand: `ui/stage` (tap mode returns from pointerdown before F's marker drag, and the click returns early),
  `i18n/strings` (the tap keys and the new `tap.ready` text next to F's block), `ui/style.css` (the tap pad, `--ai-a` /
  `--ai-b`, the orb and HUD block and `.ai-hud-text` in the shared ellipsis rule, next to F's v2.1 block; ux-16's
  one-rule test passes), `tests/browser/ui_flows.py` (the tap mouse sub-flow, the HUD checks of ai_prep and ai_align,
  G.1's `indexedDB.open` without a version, F's own `FLOWS +=` line, `flow_ai_edit` on the instruction block and no
  `edit_answer` helper). F did not touch `ui/tap`.
- **The real interfaces now that B landed:** `ui/boot` reads `app.reg` from `engine.registry`, `ui/shot_editor` calls
  `engine.shotTrack(cutKey)` and `ui/stage` inverts drags with `engine.viewAt(t)`, all without presence checks.
  `tests/helpers/fake_engine.js` keeps the three for the Node tests. In `ui_flows`: `FAKE_TRACK` stands aside and the
  keyframes flow requires the engine's own track; the area-direct flow requires `engine.registry`, finds the material
  in `registry.mine('ornament')`, waits until the plan puts it in the area's atmosphere and checks that a frame in the
  area draws more paints with it than after the undo (§7.4 "preview renders the material"); the materials flow requires
  the マイ素材 tile. All 32 flows pass.

### Requests closed

- **E → `CH.GROUPS`.** `AREA_GROUPS` is folded into `ai/changes` `GROUPS` (`materials: ['material']`, `area`, `cuts`,
  `outside`, §5.6 "GROUPS +="); `groupOf` reads one table. `ui_ai.test.js` asserts that `GROUP_ORDER` and the groups
  are the same set, that the four area groups are groups, that `AREA_GROUPS` is gone, and two `groupOf` answers.
- **F → the play bar.** `ui/playbar` draws the area bands (`planner/areas.bands`, the timeline's memo rule) in the
  strip above the cut blocks, the selected area's band in the selection ink; a double-click on the strip selects that
  area (`S.areaSel`, 詳細 opens), as the drawer's band does; `view.highlight` may be an array (an area's lines) through
  the timeline's `highlighted`. `ui_flows` `areas` reads the lane's pixels (the selected band, the other band, the cuts
  of a highlighted area) and double-clicks a band; both checks fail when their drawing is removed.
- **B → export errors.** `ui/output.ERROR_KEYS.media = 'err.exp.media'`, plus `errorParams(err)`: the asset's name from
  `ExportError('media').detail` ('—' when the library no longer names it). `ui/boot` passes it. String `err.exp.media`
  as requested. `ui_output.test.js` checks the key, the words with a name, the fallback and other codes.
- **D → strings and なぜ.** `whyRule.motion.speed`, `.cam.curve`, `.cam.follow` and `.rig.curve` now have D's texts
  (F had written placeholders under the same keys); `val.refs` is new (`{n}件` / `{n} part|{n} parts`). `ui/fields
  whyParts` turns D's params into words: `section` through `songSec.*`, `season` through `fld.season.*`, the `key` of
  `cam.lens` / `cam.arrange` through the part label, and a shot or rig key through its preset name. spec-5's check
  that Japanese text has no Latin letters now allows the song-section names (Aメロ, Bメロ, Cメロ are Japanese); new
  assertions cover each translation, and removing any one of them fails the test.
- **Strings wanted** in the sections of A to G.1 were checked one by one against `i18n/strings` (39 keys: C's
  `mat.why.*`, G.1's media and storage texts, D's, B's, and §11.9.6): all present with the requested words, except that
  `val.refs` is written with the English plural.

### perf.py "long+camera+materials": the real cause, and what is left open

- **The stand-in camerawork is gone.** B's row gave every cut a shot and every 4 cuts a rig until D's planner made
  camerawork. It now uses the planner's automatic camerawork of project_long (5 shots in the window) under a pinned rig
  (`slowSwell`: the project's own two rig runs draw none), as §7.4 says ("auto camerawork"). A first version pinned
  `amount.camera` to 1 as well; that also raises v2's punch impulses and beatZoom amplitude (the only thing it adds) and
  cost about 1.5 ms of p95, so the project keeps its own amount.
- **Where the time goes** (local Chromium, 720p, the p95 of the per-frame minimum over three fresh-engine runs; taking one
  sample material out at a time; the plan and the rest unchanged):

  | Row | p50 | p95 |
  |---|---|---|
  | every sample material | 16.4–16.6 | 31.9–32.8 |
  | without the arrive material (blur track 0.1 em) | 15.6–16.0 | 25.5–26.0 |
  | without the dwell material (a `glow` beat oscillator) | 13.7–13.8 | 28.2 |
  | without the filter stack (grainFilm + edgeShade, 4 passes) | 12.8–13.2 | 27.5–29.1 |
  | without the ornament and the atmosphere | 15.3 | 31.5 |
  | the catalog alone | 11.9 | 23.9 |

  - The filter stack costs what its two filters cost as two separate filter slots (post mean +3.4 ms against +2.9 ms;
    grainFilm alone +1.3–1.6, edgeShade alone +0.1–0.6): its chain has no extra pass or copy to remove. It adds a flat
    ~3.5 ms to every frame of every cut, because the row gives every cut a filter slot with `when: 'always'`.
  - The frames that set the p95 are glyph frames: cut re~8 (`edgeBleed`, six glyphs of about 480 px em at 720p). The
    arrive material's blur and the dwell material's glow put each glyph on the sprite path (D§4.19.5: the path follows
    the pose), whose quads are 746–775 px here (the 1.6 em box plus the blur reach, rasterized at most 512 px and drawn
    scaled): its entrance frames cost 37–53 ms (14 ms without the arrive material) and its hold 31–58 ms (13–27 ms
    without the dwell material). A filtered draw of such a quad costs about 1.3 ms on this software canvas (an
    unfiltered 1:1 blit 0.27 ms); `willReadFrequently`, ImageBitmap sprites, an opaque target and the prepare following
    the playhead made no difference. The catalog does the same (inkRise on every cut is heavier than the arrive
    material; taking the depart material out makes the row slower, because the catalog departs there blur).
  - Measured at preview quality with the adaptive preview, the p95 stays the same: its levels (half-resolution filters,
    draft paints, DPR only above 720p) do not touch glyph sprites.
- **Before / after** (p95; limit 33.4 ms): B's stand-in 32.1–39.6 ms here (B); the lead branch 4163b5b (camerawork at
  amount 1) 32.6 here, 36.7 on CI (Google Chrome); now 33.1–35.0 here over five perf.py runs (each the best of three
  fresh engines; 33.6 in the last complete CI sequence), with another agent's browser tests sharing the CPUs part of the
  time. **Still over the limit, so nothing after 4163b5b is pushed.**
- **Open, for the lead (a design decision):** §7.4 asks this row for "frame ≤ 2× budget" with the heaviest allowed
  material in every slot, and §5.8 allows exactly what costs the time (glyph blur up to 0.6 em, glow up to 1, stacks of
  6 passes); on a software canvas the frozen glyph path cannot draw that on giant text within 33.4 ms. Nothing here is
  raised, skipped or loosened. Options, none taken:
  1. change the glyph path (D§4.19.5): draw the body of a glowing glyph on the direct path, as the text style `glow`
     already does (measured −1.5 ms p95), and draw blurred sprites with their quad trimmed to the ink plus the blur reach
     (not measured; about half the area). Both change v2 frames with those poses, so the v2 goldens move;
  2. give this row a budget that says what §7.2 guarantees for materials (behave + solve ≤ 0.8 ms p50, the particles
     through `mixShare`, the passes of a stack) and report its frame times, or fail on p50 only;
  3. fill only the slots the plan has (the row now creates a filter slot on every cut, which the planner never does for
     this mood): −1.5 to 2 ms, not enough for CI on its own.
## v2.1-H.2

H.2 of DESIGN_2_1 §8.8: editor-ready output. New `export/host/webm` (透過動画（WebM）, §13.5) and `export/host/kit` (the
Filmora kit, §13.9); changed `export/host/mp4` (the export job's `backdrop`, `layers`, `assets` and `replan` options, the
MP4 output reused by the kit, `probe().vp9Codec`), `export/schedule` (`FORMATS`, `pickVp9`, `alphaBitrate`,
`estimateWebmBytes`, `backdropFor` for `webmAlpha`, `kitOptions`, `kitBase`, `kitFolder`, `kitFiles`, `layerDiffs`, the
§13.10 pre-flight codes), `export/host/sink` (`openDirectory`, `createDirSink`, `canDirectory`, the WebM save type),
`audio/wav` (`encodePcm16`, `pcm16Header`, `pcm16Data`; the export down-mix moved here), `ui/project_io` (`lrcText` is
`export/subtitles.lrc(app.plan, app.doc)`). Tests: `tests/node/export_kit.test.js` (new: both hosts and the folder sinks
with fake WebCodecs), `export_math.test.js` (+9), browser `webm_check.py` and `kit_check.py` (new) with the harnesses
`tests/www/webm_check.js` and `tests/www/kit_check.js`. The shipped pages are rebuilt (they contain the new modules);
no golden changed. The lead decisions are followed: LRC in song times, SRT relative to the export range.

### What was built

- **exportWebm** `({ engine, doc, audio, sink, signal, onProgress, canvas?, codecs? })` → `{ bytes, frames, ms, name,
  blob?, codec, audio, audioCodec }`. The job renders with the backdrop `clear` (`backdropFor('webmAlpha', …)`). The song
  (音声を入れる on) is encoded to Opus first, all of `[t0, t1)` (`audioFrames(N)` samples, 5 s per step with a cancel
  check), and its packets go to `createWebm` before any frame, with the encoder's OpusHead as `codecPrivate` (H.1's
  request); `audio: null` otherwise. Per frame: `job.ready(i)` (B's media wait; a store failure is `ExportError('media')`),
  render, one `getImageData` readback, the colour frame (`RGBA`, the straight bytes; the encoder discards alpha) and the
  alpha frame (I420: Y = the alpha bytes, U = V = 128, full range; one reused buffer), both at `ts(i)`/`frameDur(i)`, key
  frames forced on both every 2·fps, each encoder waited on at the queue limit. The chunks are paired by timestamp in
  the output callbacks (either encoder may lag) and written as one BlockGroup each; `key = colour.type === 'key' &&
  alpha.type === 'key'`. Codecs: the first of `pickVp9(w, h, fps)` that encodes (VP9 profile 0 at the level of
  `media/samples.vp9Level`, then VP8); none → `ExportError('no-vp9')`. Out-of-step streams → `ExportError('encode')`.
- **exportKit** `({ engine, doc, audio, dir, signal, onProgress, assets?, canvas?, lib?, codecs? })` → `{ files: [{ name,
  kind, bytes }], ms, audio: 'aac' | 'wav' | 'none', frames, bytes, folder, codec, overlayCodec, name?, blob? }`.
  - The files and their names are `kitFiles(doc, plan, env)` (one source for the UI's summary and the export): the
    main MP4, `_overlay.webm`, `_bg.mp4`, `_green.mp4`, `.srt`, `.lrc`, `.wav`, `README_Filmora.txt`, in §13.9's order.
  - One pass: job A (the document) and, with the green screen, job G (`look.set backdrop chroma` through
    `core/commands.reduce`, `replan`). Both forks get one `assets.fork()` when the caller passes its AssetStore (disposed
    at the end). Per frame: both jobs' media waits, then main (doc backdrop), overlay (`clear`), background
    (`layers: 'ground'`, the main MP4's encoder config), green (job G, quality `max`) — each its own surface, encoder and
    queue limit. Then the WAV (no AAC), SRT (`SUB.BOM` + `srt(plan, { t0, t1 })`), LRC (`lrc(plan, doc)`), README.
  - Audio: the main MP4 tries AAC only (`codecs.audioList` in tests, Opus always filtered out: the kit never relies on
    Opus in MP4, §13.4); without AAC the MP4 is silent and `<base>.wav` holds exactly `audioFrames(N)` frames from `t0`.
  - `dir` (a DirSink) gets one file sink per file; `dir: null` makes memory sinks and one store-only ZIP
    `<base>_filmora.zip` (`zip.addBlob`, the CRC read from each Blob in 8 MB slices; entries at the root, local time
    stamp); the caller downloads `blob` as `name`, like `exportVideo`'s memory result.
  - Progress `{ i, N, eta, phase }`: once per frame with `phase: 'video'`, then `'files'`, then `'zip'` (memory only).
  - Cancel or any failure closes every encoder and aborts every sink; a DirSink made by `openDirectory` removes its
    folder with everything in it.
- **Sinks.** `openDirectory({ name, id = 'mojipv-kit' })` → DirSink | null: `showDirectoryPicker({ mode: 'readwrite', id })`
  (call it straight from the click), then a new folder `name` — or `name (2)` … `name (99)` when the name is taken by a
  file or folder, so nothing the user has is written into or removed; null when the picker is closed; `ExportError('sink')`
  where `canDirectory()` is false. `createDirSink(dirHandle, { parent?, name? })` → `{ kind: 'dir', name, files,
  file(name) → Promise<Sink>, close(), abort() }`: `close()` closes the sinks still open and lists every file; `abort()`
  aborts each file sink, then `parent.removeEntry(name, { recursive: true })` (without a parent: each file it made).
  `openSink` also takes `kind: 'webm'`.
- **Pre-flight** (`preflight(doc, plan, env)`, env + `vp9Codec`, `dirAccess` (default `fsAccess`), `registry`):
  - kit: the H.264 blocks as for MP4; `no-vp9` (block) while the overlay is on; `kit-wav` (info, `{ name: base }`) when
    the probed audio codec is not AAC (never `opus-audio` or `no-audio-codec`); `kit-fps` (info, `{ fps, w, h }`,
    always); `kit-size` (info, `{ short }`, 720p and 1440p); `layers-approx` (info, `{ keys, seams }`, only with both the
    overlay and the background); `kit-memory` (`{ bytes }` = Σ kitFiles estimates) without folder access.
  - webmAlpha: `no-webcodecs`, `no-vp9`; its sound is Opus (no `opus-audio`; `no-audio-codec` only when no audio codec
    encodes at all); `memory` by `estimateWebmBytes`. `clear-mp4` stays MP4-only.
  - `layerDiffs(doc, plan, registry?)`: the accent filters of the cuts on screen in the range that run under the kit's
    backdrop (the background keeps the texture only), plus the texture when it is not alphaSafe (the overlay leaves it
    out), sorted; and the world seams whose window meets the range.
- **encodePcm16(channels, rate, start, frames)** → a complete WAV: RIFF/PCM 16-bit stereo, `frames` frames from source
  sample `start`, zeros outside the song, mixed down with the §4.21 `fillPlanar`, samples `round(v · 32767)` clamped to
  ±32767 (NaN is silence). `pcm16Header` and `pcm16Data` write it in pieces (the kit: 4 MB steps); consecutive pieces
  equal one call.
- **README_Filmora.txt**: `kit.readme.head`, every file with its `exp.kit.*` label, the numbered `kit.help.*` steps that
  apply (overlay, green with #00B140, SRT, WAV) with the real names, size and frame rate — Japanese, a rule, English.
  UTF-8 with a BOM and CRLF, so Windows Notepad shows it right. `KIT.readme(files, { w, h, fps })` is exported for the
  in-app guide; `KIT.KEY_COLOUR` = `#00B140`.

### Decisions where the design was silent

- **The down-mix moved to `audio/wav`.** §13.4 says the WAV writer mixes down with `export/schedule.fillPlanar`, but
  `audio/*` (L1) may not depend on `export/*` (L5). `mixMatrix` and `fillPlanar` now live in `audio/wav`, and
  `export/schedule` re-exports the same functions (tested identical), so there is still one down-mix.
- **`kit-memory` level:** `warn` below 1.5 GiB and `confirm` above — the D§4.21 memory rule applied to the kit's total
  (§13.9: "the memory confirmation of D§4.21 applies to the total"), rather than a confirmation for every kit.
- **The WebM's Duration** equals `ts(N)`: the Opus packets are handed over as plain bytes, so the last packet (which
  starts before `ts(N)`) does not lengthen it.
- **The green job must match:** job G plans the chroma document; its N and t0 must equal job A's (else `encode`).
- **`probe().vp9Codec`** is checked at the export size at quality `high`, like the AVC probe.
- **Colour.** Chrome encodes canvas frames as BT.601 (`smpte170m`) and tags the stream so (`decoderConfig.colorSpace`,
  the MP4's colour box). Decoded in the declared space, #00B140 comes back as (0, 176, 61); a decoder that ignores the
  tag and assumes BT.709 shows (0, 152, 61) — Chrome's own `<video>` does that for VP9 in MP4 (the local fallback only;
  the product's MP4 is H.264). The overlay WebM plays with the right colours in Chrome. Whether Filmora honours the tag
  is a manual-checklist item (below).

### Deviations (with reasons)

- **Alpha bitrate = the colour bitrate (`ALPHA_SHARE` 1), not 25 %.** Measured on project_basic, 720p30, 3 s from the
  first lyric cut (Chrome's VP9, `latencyMode: 'quality'`), decoded by `<video>` against the transparent PNG frames:

  | Alpha bitrate | alpha / colour bytes | ≥ 4 px from any content: max α (frames 0 17 45 59 60 89) | cores ≥ 3 px inside: min α | mean \|Δα\| |
  |---|---|---|---|---|
  | 25 % | 209 / 905 KB | 14 23 22 98 12 31 | 218–255 | 0.15–1.01 |
  | 100 % | 707 / 905 KB | 4 12 6 16 6 9 | 246–255 | 0.06–0.29 |
  | fixed quantizer 4 (`bitrateMode: 'quantizer'`) | 1728 / 905 KB | 1 7 8 8 2 8 | 252–255 | 0.03–0.11 |

  At 25 % the alpha falls behind moving text by the end of a key-frame interval: frame 59 shows α 98 where the frame is
  clear (a ghost trail over the user's footage), and §13.12's own bounds fail. At the colour's bitrate the variable-rate
  encoder uses what the alpha needs (0.8 of the colour here); a fixed quantizer is sharper but twice the size and not
  supported everywhere. `estimateWebmBytes` follows `ALPHA_SHARE`.
- **§13.12's alpha bounds, read statistically.** Even at a fixed quantizer VP9 leaves isolated one-pixel spikes (α up to
  27 where the PNG is 0 around), so "±6/255", "clear ≤ 3" and "cores ≥ 250" cannot hold for every pixel. webm_check
  asserts: within ±6 for ≥ 99 % of the pixels and mean |Δα| ≤ 1; "fully clear" (no PNG α > 0 within 4 px) ≤ 3 and
  "cores" (PNG α = 255 within 3 px) ≥ 250 for ≥ 99.9 % of their pixels, with no spike beyond 24 / below 232; each alpha
  step ±6. Measured: 99.4–99.99 %, 1–219 clear pixels above 3 per frame (max 16), cores min 246. At 25 % the test fails.
- **The test pattern is drawn by the test engine**, not by a cut: the harness wraps the engine so that every frame
  (except the background layer) also shows the §11.8.1 counter code and five alpha steps. A test part cannot be
  registered in the shipped registry, and G.3's media parts are not in this tree.
- **Key frames:** kit_check asserts a key frame at every 2·fps and none further apart; an encoder may add one at a scene
  change (Chrome's VP9 did at frame 22/23 of project_basic), and WebCodecs cannot turn that off.
- **`DirSink.file(name)` returns a Promise** (file handles are made asynchronously); §13.11 writes `→ Sink`.
- **`exportKit` takes `assets`** (the AssetStore to share): the facade has no getter for its store, so the caller passes
  it; without it each fork makes its own store fork (a video ground is then decoded twice when the green screen is on).
- **`ui/project_io`** drops its now unused `core/lyrics` dependency; its exported `lrcTag` stays.

### Measured (this machine: 4 shared CPUs, load 3–5 from the other packages' tests; headless Chromium 141)

- **Transparent WebM, project_basic with the real engine, Opus included:** 1080p30 **18–25 fps** (180 frames; rendering
  and the readback alone run at 54 fps, so the two VP9 encoders set the pace); 720p30 **34–49 fps**. §13.5's estimate
  (25–45 fps at 1080p30 on a mid-range laptop) is plausible on an idle machine. 1080p30: 7.9 MB for 6 s; 720p30: 1.2 MB
  for 3 s.
- **The kit, 1080p30, all four videos** (here the three MP4s are VP9 in MP4 — no H.264 encoder): 5.3–8.9 timeline
  frames/s (21–36 encoded output frames/s) over four runs. With H.264 for the MP4s (Chrome) it should be faster.
- Node: 1481 tests pass (`--test-concurrency=1`, about 4 min). Mutation check: 29 hand-made mutants of the new and
  changed code (pairing key rule, alpha plane source, audio before video and its packets, the Opus list, the green
  re-plan, the kit's AAC-only list, the overlay backdrop, both media waits, SRT BOM, WAV start, abort on failure, the
  job's `layers`/`assets`, `vp9Codec`, the folder removal and free-name rule, closing open files, five pre-flight
  rules, pickVp9's VP8, `backdropFor`, the int16 scale and clamp, the lrcText delegation), all caught by the Node tests;
  the two that survived the first round (the audio packets, the job's `layers`) led to two more tests. In the browser,
  `ALPHA_SHARE` 0.25 fails webm_check and a job without `layers` fails kit_check's composite.

### Requests to other packages

- **H.3 (step ④, menus):**
  - `app.exportStart` for `kit`: call `SINK.canDirectory() ? SINK.openDirectory({ name: S.kitFolder(doc) }) : null`
    straight from the click (null from the picker = cancelled); the `confirm` item is `kit-memory`; then
    `exporter.kit.exportKit({ engine: source, doc, audio, dir, assets, signal, onProgress })`; a memory result is
    `SINK.downloadBlob(result.blob, result.name)`; the done state lists `result.files` (and `result.folder`).
  - `webmAlpha`: `openSink({ name: S.fileName(doc, 'webm'), kind: 'webm' })` and `exporter.webm.exportWebm(…)`.
  - `ui/boot` services: `exporter.webm = MV.use('export/host/webm')`, `exporter.kit = MV.use('export/host/kit')`;
    `defaultFileName` by `S.FORMATS[format].ext` (the kit's folder is `S.kitFolder(doc)`).
  - `app.exportChecks`: pass `vp9Codec: probe.vp9Codec`, `dirAccess: SINK.canDirectory()` and `registry: app.reg`
    (the effective registry) to `preflight`; build `layers-approx`'s `{what}` from `params.keys` (`t.part('filter', k)`)
    and `params.seams`. The summary line: `S.kitFiles(doc, plan, { audioCodec, songReady })` (names, estimates).
  - `ui/output.ERROR_KEYS`: `'no-vp9' → 'exp.pre.no-vp9'`.
  - ≡ › ファイル › 字幕（.srt）: `SUB.BOM + SUB.srt(app.plan)` (the whole video), saved as `S.kitBase(doc) + '.srt'`.
  - The guide (`ui/filmora_help`) can use `S.kitFiles` names, `KIT.KEY_COLOUR` and `KIT.readme` (the same steps).
  - Progress phases: `video` (all videos per frame), `files`, `zip`.
- **G.4 / B:** the kit shares one AssetStore fork between its two engine forks only when the caller passes the store
  (`assets`). Either G.4 hands `app`'s store to H.3, or the facade gets an `assets` getter (then the kit can fork it
  itself).
- **Lead:** DESIGN_2_1 §13.5 (alpha bitrate = colour bitrate), §13.11 (`file(name)` → Promise), §13.12 (the alpha
  bounds as above) and §13.4 (the down-mix in `audio/wav`) could be updated. CI runs `webm_check.py` and `kit_check.py`
  with the other browser tests; with `MV_REQUIRE_H264=1` kit_check requires the kit's MP4s to be H.264 (the profile
  pickAvc got — High first). Not verified here: Chrome's H.264 in the kit, AAC (Google Chrome on Linux has none, so CI
  checks the WAV path too).

### Strings wanted (key, ja, en)

- `exp.kit.wav`: 「曲（WAV）」 / "Song (WAV)" — the WAV's label (the README and the done state list it by name only).
- `exp.kit.readme`: 「使い方（README）」 / "How to use (README)".
- `exp.kit.what.video`: 「動画」 / "the videos"; `exp.kit.what.files`: 「曲・字幕・説明」 / "the song, subtitles and notes";
  `exp.kit.what.zip`: 「ZIP」 / "the ZIP" — `{what}` of `exp.kit.phase` for the three progress phases.
- `exp.pre.layers.seams`: 「場面の切り替わり（{n}か所）」 / "scene changes ({n})" — for `layers-approx`'s `{what}`.
- `kit.help.bg`: 「背景だけのときは「{bg}」を下のトラックに置き、その上に自分の文字や映像を重ねます。」 / "For the background
  only, place "{bg}" on a lower track and put your own titles or footage above it." — a README / guide step.

### Open items

- **Filmora check (FG10):** add to the checklist: `_green.mp4` (H.264) — does Filmora's picker read the background as
  #00B140 (it is tagged BT.601)? If it shows about (0, 152, 61), the MP4s should be fed as our own BT.709 I420 frames.
  And: does Filmora read VP9 alpha at our alpha bitrate without trails?
- The kit at 4K60 has not been run here (memory and time); the ZIP path keeps every file in memory until the download.
## v2.1-G.3

G.3 of DESIGN_2_1 §8.7: the media parts (§11.5.7, with §11.9 depth) on B's kit (`K.media`, `K.mediaParams`, `K.MEDIA`,
`K.runKenBurns`), their tests, and goldens step (c) of §7.5.

### What was built

- **`parts/ground/photo.js`: `photoPan`, upgraded in place.** Key, `pool: false` and tags kept; label 写真・動画 / Photo or
  video and the §11.5.7 blurb; `needs: ['media']`. Params: `K.mediaParams({ src: 'image', use: 'ground', autos: { veil:
  range 0.3–0.45 } })`: `image` (type `media`, accept `any`), `depth`, `fit`, `cropZoom`/`cropX`/`cropY`, `edge`,
  `move`, `zoom`, `pan`, `blur`, `veil`, `veilInk`, `tint`, `tintInk`, `clipIn`, `clipOut`, `speed`, `loop`, `clock`;
  `zoom`, `pan` and `veil` keep their v2 names, ranges, steps, units and autos. Build: the v2 base paint (the ground
  colour over the frame and its bleed), then `K.media(use 'ground', box = the frame)`; the veil is now the node's own,
  at v2's strength `veil · (0.6 + 0.4 · amount)`. No picture (none chosen, or an id the plan does not hold): the base
  paint only, as v2 drew without an image.
- **New `parts/ornament/media.js`**: `photoFrame`, `textFill`, `mediaLayer`, each `pool: false`, `needs: ['media']`, tags
  `['soft']`, labels and blurbs in the definitions. Params: the source and the depth first (the element page shows the
  depth under the source row, §11.9.5), then the part's own (the §11.5.7 table), then the other media params of its use.
  A part without a picture builds nothing.
  - `photoFrame` (cut, follow text; roles lyric, focus, title and outro, like the other text-bound frames): a group at
    its place, turned by `tilt`, holding the stepped shadow (4 fills of the outline, `#000000`, alpha 0.08 each, step
    `0.015 · short · shadow` down and right, no filter), the picture (`K.media`, use `frame`, the outline as its mask)
    and the border (the mask stroked, `borderInk`, `border` du). Box: the long side is `size · short`; a circle is
    square, an arch upright (width ≤ 0.85 of the height), the other shapes take the picture's aspect (within 1:2 and
    2:1), so the default cover fit shows the whole picture. `free` is the picture's own alpha: no mask, border or shadow.
    Places: `behind` on the text block's centre in the far layer; `side` in the free band where it fits largest (a
    margin of 0.03 short from the text and the band's edges; a band that takes less than 0.12 short sends it to the
    corner); `corner` the lower right of the safe area, scaled into that quarter; `free` the middle, moved by the
    element's nudge. The border and the shadow share the picture's layer (the §11.9.3 table: front → near, back → far)
    and, through one behaviour after K.media's, its pose: its Ken Burns and its depth fade, so the frame moves as one.
    `appear` over the text's entrance (at least 0.3 s): grow from 0.8, slide in over 0.06 short from its outer side
    (away from the text; from below when not `side`), fade (a bloom 0.4 s longer than the entrance), none; the exit is
    the automatic follow-text envelope.
  - `textFill` (cut, follow text): `K.media` use `fill` (comp `atop`) in the text layer after the glyphs, the text layer
    isolated only when a picture is built; alpha `0.4 + 0.6 · amount` with `amount` auto 1; `place` frame (the whole
    frame) or text (the text block grown by 10 %; the frame when the block is empty). No depth (§11.9.1).
  - `mediaLayer` (run, follow own): `blend` (screen, multiply, overlay; normal = comp `over`), no `over` (depth replaces
    it); `K.media` use `layer` on the far layer (the kit moves front to near and sets `sceneOnly`), the box the frame plus
    the 15 % bleed so camera moves never show an edge; alpha `0.2 + 0.8 · amount`.
- **Registration:** nothing to change. `parts/catalog` gathers every module under `parts/<kind>/`, `build.py` collects
  `src/` and gives `parts/ornament/*` layer 4 with the part-file lint; `build.py --check`: 200 modules OK. The base
  registry version goes `1e6ef40c` → `83c7523d`.

### Tests

- `media_engine.test.js` (+14): photoPan (label, the media params, v2's three params, base paint + one node, the veil
  strength, depth and params through K.media, no picture); photoFrame (group, shadow, picture, border on the layer of
  every depth; border strokes the mask; shadow steps; sizes and shapes; the four placements and the corner fallback;
  border and shadow keep the picture's pose at 49 times with Ken Burns and the anim depth fade; the four entrances);
  textFill (after every glyph, isolated text layer, `source-atop` onto the glyphs' surface, alpha, the two places);
  mediaLayer (bleed box, blend → comp, alpha, front/back layers, drawn after the glyphs in front and before them
  behind: the op order); backdrops (mediaLayer skipped for chroma, black, clear; photoFrame and textFill drawn);
  **conformance** of the four parts: 154 cases (every depth × every aspect, with fit, edge, move, clock, blur, shape,
  place, appear, tilt, blend and still, video, VFR, rotated and animated sources varied) × 24 times × 2 runs: no NaN,
  balanced save/restore, no alpha out of range, no part-error, the medium drawn, the same op hashes twice; the derived
  おまかせ ground of a pooled video (C's `registryFor`) now gets `clock: song` and `move: none`; the media golden.
- `parts_world.test.js`: the §5.5/§5.6 tables also read DESIGN_2_1 §11.5.7 (photoPan's new label; the three media
  ornaments' keys, labels, scope, follow, tags, pool, needs); the v2 photoPan test now uses an asset of the plan's media
  (a v2 text value such as `asset:test` is no id and gives the plain ground) and still checks "pans and zooms
  closed-form and always covers the frame" with the edge rule `zoom` (v2's behaviour). No check removed.
- New `tests/browser/media_exact.py`, `media_alpha.py`, the shared page helper `media_page.py`, the harness
  `tests/www/media_parts.js` (everything in the built app page under its CSP, the real AssetStore):
  - `media_exact.py`: the counter videos of media_gen.js (VP9 WebM 30 fps, VP9 MP4 25 fps, VFR; H.264 where it encodes,
    `MV_REQUIRE_H264=1` for CI) as the background in PNG exports at 24, 30 and 60 fps, 1280×720 and 1920×1080, 2.4 s
    (a loop wrap): every frame's code equals the frame expected from the times the clip was made with (Python, not
    `sampleAt`); speed 0.5 and 2, clipIn 0.5, clipIn–clipOut, hold past the end; clock `show` in a cut (a photo frame,
    read inside it); a 3-s MP4 export decodes back to the same codes. About 2,500 frames, all exact here (VP9; ≈ 70 s).
  - `media_alpha.py`: the alpha WebM's merged frames at 5 times (128 and 0 exactly here, ±4 allowed); as a free-shape
    photoFrame in a 透過PNG export the alpha is kept (128 / 0 / nothing outside); photoPan and mediaLayer drawn over the
    scene backdrop and absent from green, black and clear frames (those frames are exactly the backdrop); the §11.9.7
    probe: a mediaLayer at 文字の前に出す turns every glyph pixel bluer (8,077 of 8,077), at anim and back every glyph pixel
    keeps the ink.
- `determinism.py` (+ check 7, `--no-media`): video ground + alpha WebM frame + still frame, camerawork on, export
  quality: frame N of a fresh engine and store = frame N after 0..N−1 (pixels and source frames), 30 = 60 fps; the
  paused preview after a scrub starts provisional and, redrawn until exact, shows the export's source frames with MAE 0
  here (≤ 2/255 allowed).
- `perf.py` (+ media row, `--no-media`, `--media-rows`), `transparent_check.py` (+ a free-shape photoFrame of a PNG with
  alpha in every export: its rect left out of the glyph checks; in 透過PNG its alpha is the PNG's, opaque 255, half 128,
  cleared 0; drawn over green and black), `package_io.py` (the preview-frame check G.1 left: the WebM as the
  background and the PNG in a photo frame, identical pixel for pixel before the save and after clear + open;
  `media_check.js` `previewFrame`), `parts_gallery.py` (the media mode must list the four catalog media parts; it
  shows 8 parts: those and B's four test parts).
- **Mutation checks:** 16 mutants of the parts against the Node tests (the pose tracking's scale and alpha, the frame
  layer, textFill's isolation and alpha, mediaLayer's normal blend, alpha and bleed, `behind` in mid, the side margin,
  the shadow strength, fade, slide direction, circle, photoPan's veil strength and auto): all caught. Browser: no
  0.1-ms rule in `sampleAt` (5 VFR frames wrong), a scaled loop time, an overlay never in front, a frame at alpha 0.98
  (transparent_check), a behaviour with history (determinism check 7): all caught. (A first history mutant was
  equivalent: two frames made its counter even at every evaluation.)

### Goldens (§7.5 step (c))

Asserted before regenerating: `node tests/update_golden.js --check` gave `frame_hashes_v2.json: matches`; the 160
frames of `frame_hashes.json` (4 projects × 40) rendered with the new catalog were compared hash by hash: 0 differ;
`media_engine.test.js` "frame hashes of the media-free fixtures are unchanged" passed with the new registry. And the 240
corpus plans, with their hashes and fingerprints left out, are byte-identical to the plans of the catalog before G.3
(no part choice, param, window or slot moved: photoPan stays pool-only and the new parts are `pool: false`). Then
`node tests/update_golden.js`:
- `frame_hashes_v2.json`: matches (unchanged);
- `plan_hashes.json`: all 240 plans (+ the registry line), because the base registry version enters every plan hash
  through `sharedText`; nothing else changed;
- `frame_hashes.json`: only its registry version line changed; the frames are byte-identical;
- new `project_media.json` (plan hash and 40 frame hashes): the v2.1 media fixture plus a text fill on r5
  (`fake_media.js goldenDoc`; A.3's fixture has the video background, the pooled still background, the photo frame and
  a material, but no text fill), planned with its effective registry and rendered with the fake store, so its op hashes
  include the media times. `media_engine.test.js` checks it; `update_golden.js` writes it.

### Decisions where the design was silent

- The param order (source, depth, own, other media params); the photoFrame geometry, shadow step and ink, round radius
  (0.12 of the shorter side), placement rules and entrance numbers above; `free` has no border or shadow (there is no
  outline to draw); textFill isolates the text layer only when it draws; mediaLayer's bleed box; `photoPan` also
  declares `needs: ['media']` (the vocabulary word; it only feeds the song terms of `needs`, so nothing changes).
- None of the parts names `use` in its specs: the planner's rule (ground → ground, run ornament → layer, cut ornament →
  frame) is right for all four, and textFill has no depth.

### Deviations (with reasons)

- **Entrance window.** §11.5.7 says `appear` runs over `[a, rest]`. It runs over at least 0.3 s (an instant text
  entrance would otherwise show no entrance at all), and `fade` 0.4 s longer: the follow-text envelope already fades the
  frame over `[a, rest]`, so `fade` and `none` would otherwise look the same.
- **Border and shadow at depth front, back and still.** They share the picture's layer and pose, but only media nodes
  carry a camera factor (`sb.media` `cam`/`still`), so at those depths they see the layer's own camera while the picture
  sees `depthCam(f)`; under camera motion (and, for `still`, through a seam) the picture then slides inside its border.
  At anim (the automatic depth of a frame) they match exactly. Request to B below.
- **Files outside §8.7's G.3 list:** `tests/node/parts_world.test.js` (the photoPan upgrade changes its v2 label and
  param type, which that file checks against DESIGN.md §5.5; it now also reads DESIGN_2_1 §11.5.7);
  `tests/helpers/fake_media.js` (`goldenDoc`, the golden's document, shared by `update_golden.js` and the test);
  `tests/update_golden.js` (the `project_media.json` job); `tests/www/media_check.js` (`previewFrame` for package_io);
  `tests/browser/package_io.py` also waits up to 10 s for its two download events before reading them (it read them at
  once, and one run on the loaded machine reported none; no check changed).
- **The app's engine has no AssetStore until G.4** (ui/boot passes `assets: null`): the tests fork it with a store
  (`engine.fork({ assets })`), and transparent_check's step-④ exports go through `wireExport`, which makes
  `app.engine.fork()` pass one, as ui/boot will.

### Measured (this machine: 4 shared CPUs, other packages' tests running; headless Chromium 141, software raster)

| §11.5.12 row | here |
|---|---|
| `drawMedia`, still, full frame | p50 ≤ 0.1 ms per call (the timer's resolution); frame p50 13.0–14.5 ms vs 12.0 without (budget ≤ 0.3 ms) |
| `drawMedia`, video, full frame | p50 11.3–13.0 ms per call for a 1080p VP9 frame drawn at 720p (budget ≤ 0.8 ms, "a hardware frame upload") |
| Isolated path (a PNG with alpha as the ground) | +2.8–3.0 ms per call (budget ≤ +1.2 ms) |
| WebM alpha merge, 1080p | 45–51 ms per frame through the store, decoding both 1080p streams in software included (budget ≤ 7 ms merge) |
| Frame with one video ground and one still frame (perf.py row) | p50 34.7–43.5 ms, p95 100–160 ms at 720p (budget ≤ 10 ms target, 16.7 ms hard) |
| Scrub, 1080p, GOP 2 s | 33–120 ms to the exact frame (budget ≤ 250 ms) |
| Export overhead of a 1080p30 background at 1080p30 | +43 % to +61 % (VP9 export here: no H.264 encoder; budget ≤ +35 % for H.264) |
| `mediaAt(t)` | B's figure: 2.2 µs with media everywhere (budget 50 µs) |
| Import (hashing, probe, poster) | G.1's figures |
| Re-plan with media pins | unchanged: the 240 corpus plans hold the same values; `planner_determinism` passes |

Where the time goes, measured in the page: `drawImage` of a 1080p `VideoFrame` costs 8–17 ms **every** time here (YUV →
RGB on the CPU, not cached between draws of the same frame); `createImageBitmap(frame)` takes 6–9 ms once (async), and
drawing that bitmap 3 ms. A video ground at its automatic depth (back) adds the per-frame video blur of the isolated
path (+≈ 12 ms). With the store's video frames turned into bitmaps (an experiment, not committed) the perf.py row went
from p50 29.7 to 23.4 ms. The budgets are written for a GPU laptop; this machine cannot show them.

### Requests to other packages

- **G.4 / F (`ui/fields`, strings):** `ui_fields.test.js` "spec-4: every string value of every registered enum parameter
  has an opt.<value> label" fails now that the catalog has media parts: `depth` (auto, anim, front, still) and
  `move`'s `auto` have no `opt.<value>` string, and `opt.back` exists with another meaning (逆方向). §11.9.6 names the
  depth labels `opt.depth.*` (F adds them): `ui/fields` should label the `depth` enum `'opt.depth.' + v`, and `move`'s
  `auto` needs a string (below). Until then this one Node test is red in this tree.
- **B:** let `sb.shape` (and `sb.group`) take `cam` and `still` as `sb.media` does, and give parts the effective depth of
  a picture (for example `K.media` returning it, or a `K.depthOf(p, use, meta)` export), so a photo frame's border and
  shadow can share its camera factor and seam pass. Performance: the per-frame blur of a `back` video (the isolated
  path) is the largest item in the perf.py media row here.
- **G.1 (`media/host/session`, `store`):** hand out video frames as `ImageBitmap`s made once when they are held
  (`createImageBitmap` in the output path, off the main thread) instead of drawing the `VideoFrame` each time: here a
  draw drops from ≈ 10 ms to ≈ 3 ms (and mirror neighbours draw the same frame again). Worth measuring on a GPU first:
  there a `VideoFrame` draw is a texture upload.
- **G.4 (ui/boot):** create the AssetStore and pass it to `createEngine`; then `wireExport` and the `engine.fork({ assets
  })` calls of the harnesses can go.
- **E:** `ai/direct`'s comment "a param that is not of type media yet (today's photoPan.image)" is outdated: it is one
  now.
- **Lead:** DESIGN_2_1 §11.5.7's table still lists mediaLayer's `over` (§11.9.1 replaced it by `depth`). The perf.py
  media row (and B's camerawork + materials row) cannot meet their budgets on a software-rendered runner; they need a
  GPU reference machine or a decision about CI.

### Strings wanted (key, ja, en)

- `opt.auto`: おまかせ / Auto (`move`'s `auto`; photoPan, photoFrame, textFill, mediaLayer)
- the `depth` options through `opt.depth.auto` / `.anim` / `.front` / `.back` / `.still` (§11.9.6; F has them) once
  `ui/fields` maps the depth enum to them.

### Open items

- `ui_fields.test.js` spec-4 is red until the request above lands; the perf.py media row fails here (numbers above).
- H.264 exactness runs only where the browser encodes H.264 (Chrome CI with `MV_REQUIRE_H264=1`).
- Visual QA of the photo frame's placements and entrances in every aspect (the Node tests check their geometry).

## Lead: integrating G.3

- G.3's diff was applied onto the integration branch after F and H.2. The goldens were then regenerated. Beforehand,
  `update_golden --check` showed `frame_hashes_v2.json` unchanged, and the only key that changed in `frame_hashes.json`
  was `registry.version` (1e6ef40c → 83c7523d): no media-free frame moved. `project_media.json` is G.3's new golden.
- spec-4 (option labels): an enum spec may name its own label group with `optKey`. Its options are then labelled
  `opt.<optKey>.<value>`. The reason: `depth`'s `back` means 後ろに下げる, not the shared `opt.back` 逆方向.
  `core/schema.validateSpec` accepts `optKey` only on an enum and only as an identifier. `K.mediaParams`' depth sets
  `optKey: 'depth'`. `opt.auto` おまかせ / Auto is added for `move: auto`. Tests: `schema.test.js` and `ui_fields.test.js`.
- Open: perf.py's new media row (a 1080p30 video ground and a still photo frame) fails here and on CI, which have no
  GPU: a 1080p VideoFrame costs 8–17 ms to draw in software. This is handled next, together with the
  camerawork + materials row.
## Lyric editor: iOS drift

Seen by the owner on iOS Safari: in step ① the caret and selection crept away from the coloured text, more with every
row further down. A bug, not a design choice. The editor is a transparent `<textarea>` (caret, selection) over a
mirror `<div>` of coloured rows (the gutter follows the mirror), so any row laid out differently in the two layers
moves every row below it.

- **Why.** The line height, `15px/1.7` = 25.5px. WebKit's line layout makes line boxes whole px: 25px in the release
  branches read (safari-7616 to 7624; only 7625 turns subpixel inline layout on). That happens in both layers, but
  each mirror row also had `min-height: 1.7em`, which a block keeps at 25.5px, so every single-line or blank row was
  0.5px taller in the mirror: half a line after 30 rows. Blink keeps 25.5px lines, so the Chromium tests never saw it.
  Found in WebKit's source as further ways to differ (not seen on a device): iOS's built-in textarea style adds
  `-webkit-nbsp-mode: space` and `line-break: after-white-space`, which a div lacks; WebKit does not kern across the
  mirror's token `<span>`s, and decides a break at a text node boundary from the two characters before it in the
  previous node only (`TextUtil::mayBreakInBetween`), so a UAX #14 rule that needs more context (digits around a '/'
  cut mark) could wrap a mirror row where the textarea's one run of text does not; text autosizing (iPad's idempotent
  mode) can enlarge the mirror's rows but never the textarea's text, and skips an element only for
  `text-size-adjust: none` (`Style::Adjuster::adjustmentForTextAutosizing`). And `renderMirror` set the textarea
  height before it left the empty state (14px left padding), so text arriving in one step into the empty editor
  (サンプルで試す, a paste, opening a file) left the textarea shorter than its text until the next edit; a caret reveal
  then scrolled the textarea inside itself by that much, and clicks on the last rows missed. In Chromium at 1440×900
  with the old build: 187px on the first keystroke at the end of the sample lyrics, 357px after Ctrl+End with the
  longer text of the test below; the longer the text, the more.
- **What changed.**
  - `style.css`: one rule sets every text-layout property on both `.le-mirror` and `.le-text` (font `16px/var(--le-lh)`
    with `--le-lh: 26px`, border 0, kerning and ligatures off, spacing, indent, white-space, word-break, overflow-wrap,
    hyphens, `line-break` and `-webkit-nbsp-mode` at the iOS textarea's values, hanging punctuation, autospace, spacing
    trim, `text-size-adjust: none`, `appearance: none`); an engine drops what it does not know, on both layers alike.
    The gutter's `.le-g` uses the same `--le-lh`. 16px (was 15px) also stops iPhone Safari zooming in on focus; rows
    wrap a little sooner.
  - `.le-row` has no `min-height`; a blank row (empty or white space only) ends with `<br>`, as the textarea's line
    ends with `\n`. Every row's height then comes from its own line boxes, whatever an engine or page zoom does to the
    line height (a 26px min-height would fix 100% only: at 110% Safari zoom a 28.6px block sits over 28px lines).
  - A mirror row holds its text as one text node, like the textarea's line, and the token colours are CSS Custom
    Highlights over it (`.le-row::highlight(tok-…)`, one `Highlight` per token class, `StaticRange`s), so the line
    breaker reads the same text in both layers. Only the rows in and near the viewport (the gutter's rows, ±240px) hold
    ranges: WebKit's paint of each line of text walks every registered range of every highlight
    (`MarkedText::collectForHighlights`), so their number stays a screenful's however long the lyrics are. Without
    Custom Highlights (Safari before 17.2) the tokens stay spans, with plain text next to plain text merged.
  - `lyric_editor.js`, `syncHeight()`: the textarea is as tall as the mirror and the editor's viewport, or as its own
    text where an engine lays that out taller. The reads come first and one write follows, if the height changes;
    only a shorter textarea is measured again (its text may overflow it now). A caret reveal runs before `input`, so
    when the new text outgrew the textarea (a typed character wrapping the last row, Enter at the end, a paste) it
    scrolled the textarea inside itself and the editor that much less, which left the caret up to 12px below the
    editor's bottom (the old build did the same): that inner scroll is now handed to the editor. One ResizeObserver on
    the mirror and the editor acts only on a height `syncHeight` has not seen: the mirror's (a web font of the stack
    loading re-wraps both layers) or the editor's (a taller or shorter window with the same width, which used to leave
    the textarea, the gutter and now the ink as they were). The textarea's `scroll` listener is gone: with the height
    rule and the hand-off it had nothing left to undo. Measured in Chromium (CDP LayoutCount, 1260 rows), the layouts
    per keystroke hardly change (Enter 4.07 → 4.00, a character 3.07 → 3.07): Chromium skips an unchanged inline
    height, and after a changed one the gutter's frame reads layout anyway.
  - Tests. `tests/browser/editor_metrics.py`, a file of its own (CI runs every `tests/browser/*.py`), on the sample
    lyrics plus hard rows (wrapping kana, Latin with marks, a URL, digits around cut marks, no-break and full-width
    spaces, emoji, a stamp, blank rows), at five sizes down to phones: both layers compute the same ~45 layout
    properties; the line height (the gutter's too) is whole px; rows are whole lines, add up to the mirror and end
    where a hidden textarea of rows 0..i ends, also with 25, 25.5 and 28.6px lines; a click on each row puts the caret
    in it; each row is one text node whose highlight ranges equal `segments()`, held near the viewport only (also in
    344 rows scrolled through); typing at the end until the row wraps and Enter leave the caret inside the editor; one
    paste into the empty editor, text taller than the mirror (simulated with padding, then a deletion, then a shorter
    editor) and a height-only resize never let the textarea scroll inside itself or stop short of the editor's bottom.
    Then, with `Highlight` removed before the app starts, the spans pass the same row checks and every token in view
    has its colour in both pictures. Against the old build and the previous fix it fails (the latter on the one text
    node, the 11px caret and the height-only resize); mutations of the new code (no re-measure after a shrink, no
    reveal hand-off, spans only, every row inked, the editor's height not observed, a `::highlight` rule removed) each
    fail it.
    `tests/node/ui_selection.test.js` checks the stylesheet itself, since Chromium drops the WebKit-only values: the
    shared rule and its iOS values, a whole-px `--le-lh`, no text-layout property on one layer only, tokens set colour
    only.
- **Not verified here.** No WebKit in this environment: the fix is by construction and untried on an iPhone, and which
  Safari release ships which WebKit branch was not checked. The browser test proves Chromium's structure: it cannot
  reproduce WebKit's whole-px line boxes (`floorf` of the line height, ascent and descent rounded apart), its break
  context at node boundaries, or its highlight painting cost (bounded by the viewport window, not measured). WebKit's
  own editing may split the textarea's text into several nodes (not checked); only the mirror side is one node by
  construction. Desktop Safari uses the same line layout, so it is a cheap place to confirm the fix.
- **Merging.** `tests/browser/ui_flows.py` is untouched and the test is a file of its own, so another package's flows
  file stays as it is; `src/ui/lyric_editor.js`, `src/ui/style.css` and `tests/node/ui_selection.test.js` apply with
  `git apply` to the pending UI package's copies (checked). This section is appended to NOTES.md, as other packages'
  are: keep both. Rebuild `index.html` and `en/index.html` with `build.py` rather than merging them.

## v2.1-G.4

G.4 of DESIGN_2_1 §8.7: the photo and video UI (§11.7, §11.9.5, §12.7) on G.1's device store and import, B's facade,
C's `registryFor`, D's `plan.media`, E's `ai/vision`, F's inspector and G.3's parts. Built in two rounds: the package,
then the fixes of its review (41 findings, all fixed; see "Review fixes").

### What was built

- **`ui/boot`: the AssetStore.** One `media/host/store` per app over `app.io.mediaBlobs` (IndexedDB, or this tab's memory
  when it is full or missing); the metadata comes from every library entry the store has seen (ids name content, so an
  entry seen once stays right for try-on and undo documents). The preview engine gets it (`createEngine(assets)`); every
  `engine.fork()` (the export, the Filmora kit, the test harness) forks it and disposes the fork. `app.assets` (getter,
  H.2's request), `app.knownMedia()` (every id seen), `app.media` (`ui/media_io`), the action `file.saveLight`, the page's
  drop label, the mode strips 「使う範囲を調整中」 (trim peek) and 「切り抜きを調整中 — …」 with [終わる] (crop overlay), and
  the one document `paste` listener (below).
- **Paste (§11.7.2).** Ctrl+V outside the text fields is left to the browser (the key handler does not consume it), so
  the `paste` event always comes: image or video files are imported (`media_io.pastedFiles`), anything else runs
  `look.paste`. The palette and the menus run `look.paste` directly.
- **New `ui/media_io`**: the import queue (drop, paste, ≡ › ファイル › 写真・動画を読み込む…, the library's ＋ 読み込む, the
  picker's ＋ tile): one file at a time, a sticky progress row 「読み込み中: {name} {p}%（あと n件）」 with [中止], which
  stops the file and every file waiting; the live region hears it at most once every 5 s (a `quiet` toast when it is
  made again); closed with ×, the row comes back with the next file. Imports belong to the work they started in: a work
  loaded meanwhile (`plan` event `load`) stops them and they place nothing. An audio-only MP4/WebM goes to the song; a
  duplicate says so; errors are `media.err.*`. A file dropped on the preview becomes the background where the selection
  is (作品全体, the selected lines, the cut) with `media.put` in the same undo step; its toast offers [元に戻す]
  [ほかの使い方…], and on step ② [この動画の音を曲にする] for a video with sound (then kept until used or closed; the
  duplicate toast too). A video dropped on step ②'s song box also gives the song its sound (see Decisions). The end
  toast [使い方を選ぶ]; the storage warnings (2 GB, `quotaNote`). Placement (`placeCmds`: the part and its media param
  per scope, ornaments at `freeIndex`, cut pins written where the cut lives with its sig), delete (`media.remove` plus
  `pin.clear` of every part pin whose media param emptied; lock pins stay), この写真を使わない (この動画を使わない for a
  video), 上へ/下へ, 使っている場所, relink (same id: stored, `forget`; another file of the same kind and size or length:
  asked, `media.relink`; a file that fits no missing entry is refused with [代わりにこのファイルを使う] when one entry of
  its kind could take it), 置き換える…, colour matching (one batch 「色を写真に合わせる」 and a toast with [元に戻す]),
  posters, filmstrips, sample tables and GOP stats from the device store (nothing is cached for an asset that gave
  nothing, and a relink, a replace, a load that finds it missing and ≡ › 設定 › 消す drop what is cached, bitmaps
  closed), the file progress rows of G.1 (`fileProgress`), step ④'s items (`preflight`), and the pictures of 写真の説明
  (`visionParts`: a still decoded upright at the size it is sent at, 768 px on the long side, JPEG 0.8, the bitmap closed;
  a video or an animation as three frames of the range it is used in (`usedRange`: its first use's clipIn…clipOut) at
  10 %, 50 % and 90 %, decoded exactly by a fork of the AssetStore at 768 px). ≡ › 設定 › 消す forgets every id the tab
  has seen (`app.knownMedia`), not only the empty work's. `scopeWords`: 作品全体 / 3行目 / サビ1 / 3–5行 / 3行目のカット2.
- **New `ui/media_widgets`**: `mediaRows(gen)` turns a part's generated rows into the element page's media rows: the
  source first (widget `media`: poster, name, short badges, ？ when missing, 再生できません when the preview could not
  decode it, › the picker; its accessible name says the badges too); 動きと重なり right under it as a radiogroup of its
  five options whose おまかせ is 自動 (unpins; the tag 「自動: 後ろに下げる」, ⓘ toggles why, and the why follows the
  value); 拡大 as 切り抜き [画面で調整] with the zoom in %; 動きの強さ, 薄幕, 色味 and 速さ in %, ぼかし without a unit;
  a background's shared 強さ (which only strengthens its 薄幕 in photoPan) as 薄幕の強さ right after 薄幕; 重ね方 as
  明るく重ねる / 暗く重ねる / くっきり重ねる / そのまま重ねる; 使う範囲 (clipIn and clipOut) as one `trim` row; the video
  rows marked `video` with a `when`. `paramSpec(registry, media, name)`: another param's own spec (the crop overlay's
  focus and zoom, the trim's end). The widgets: `media`, `crop`, `trim` (filmstrip, two handles that are 24 px buttons
  with the slider role and their time as `aria-valuetext`, drag = one gesture with a peek, ← → one source frame, Shift
  one second, Home/End, [▶ 範囲を見る]).
- **New `ui/media_page`**: 作品全体 › 写真・動画 (a listbox of two-line rows: the whole name, then the facts or
  この端末にありません, 再生できません, 使用 n, おまかせ, ⋯, [つなぎ直す]; one tab stop; the row's name says the kind
  once), the asset page (crumbs 全体 › 写真・動画 › name, where 写真・動画 opens the library, and no second copy of the
  path above it; rename ✎; facts, badges, the missing banner; a poster that is a picture for a still and a focusable
  picture that scrubs its filmstrip for a video; 使う buttons that name where they place: 作品全体の背景, 「2行目の背景」,
  「文字の中に（2行目）」…, disabled with 「つなぎ直すと使えます」 while the file is missing; おまかせでも背景に使う;
  使っている場所 (「3行目（枠）」); colours with [この色に合わせる] and what it does; the AI row, whose
  [AIに説明してもらう…] waits for the file; [この動画の音を曲にする]; [置き換える…] [削除]). The page is drawn again
  only when what it shows changes, and the focus stays on the same control (✎ after a rename). The picker sub-page (＋
  読み込む, なし, the assets its param accepts; try-on after 250 ms; a tile's name says この端末にありません).
- **`ui/fields`**: widgets `media`, `trim`, `crop`; `sec.media` after 見た目; the media rows of every part page; the text
  page's 文字の中に写真・動画; `freeIndex` (see Decisions); the video rows in a section of their own right after the
  part's (`video` after 背景, `video.atmos` after 重ねる映像: each keeps its own open state); 空気（粒子） that shows
  a mediaLayer reads 重ねる映像; a pinned clipOut stays inside the trim row.
- **`ui/widgets`**: `choice` with `radio` and `autoValue`; the three makers.
- **`ui/inspector`**: the asset page and picker sub-pages (a page may name its own crumbs and have no title bar), the part
  browser's 写真・動画 tab, the crop target of a row, `siblingOf` (with the sibling's own spec), textFill commits (the
  picture pins the part too; なし clears both; the row reads 自動 / なし, not 無効, until its slot holds textFill), the
  picker and the tab place an import that ends later only while they are still shown, and asset pages refresh on media
  events.
- **`ui/part_browser`**: the 写真・動画 tab; derived `myMed…` grounds left out of the lists by `extra[key].media === true`.
- **`ui/stage`**: the drop target; the crop overlay (drag, wheel, arrows 1 % / Shift 10 %, + −, 0 or a double-click
  resets, Esc leaves and gives the focus back to [画面で調整]; entering it says the keys in the live region and the play
  bar's strip says what the mouse does); want/ready; the placeholder plates 「写真がありません: {name}」 /
  「動画がありません: {name}」 / 「この動画を再生できませんでした」 where each picture is drawn (a frame's in its box,
  text fill's on the text, a background's in the middle); 映像を準備中 only while a picture this device has is still on
  its way; the trim peek.
- **`ui/menus`** (≡ › ファイル as §12.7), **`ui/palette`** (romaji aliases; the command that clears the device comes
  last and 写真 / 動画 find 読み込む… first), **`ui/step_look`** (the hint), **`style.css`**, **`strings`** (the keys the
  screens needed that A had not written).
- **写真の説明 (§11.6.2).** `ui/ai_controller` gains the tool `vision` (Gemini only; no lyrics needed); `describeMedia`
  asks the consent per asset, sends the JPEGs before the prompt, opens the review in the AI tab, and says
  「写真・動画がこの端末にないため、説明を頼めません…」 when none of the pictures is on this device.
- **G.1's requests:** `app.media.importFiles`; the store in boot over `app.io.mediaBlobs`; `check` on load and `forget`
  after relink and 消す; `quotaNote(storageInfo())` once; the progress rows through `fileProgress`; the header's file
  line from `io.fileState()` (「ファイル: 作品.mojipv（10:20 に開きました）」 until the first save to it); ≡ › 軽い保存 →
  `io.saveLight()`. **G.3's:** boot wires the store (`tests/www/media_parts.js` no longer patches `engine.fork`). **H.2's:**
  `app.assets`.

### Decisions

- **freeIndex (文字の中に, 写真の枠として).** Never a slot a user or lock pin holds; of the others, the one where the
  fewest cuts of the scope change: a cut changes when the slot shows an automatic decoration there (it would be replaced)
  or when its count is below the slot (the planner raises the count to reach a pinned slot and fills the slots in
  between); ties go to the slot that replaces fewer, then the lower one. The review asked for the first slot no cut
  uses; measured on the sample lyrics (50 cuts: #0 in all, #1 in 15), pinning #2 adds a decoration to 35 cuts and the
  planner's variety rule then changes 13 of the 50 first decorations, while #1 replaces the 15 second ones and keeps 48
  of 50 first ones. A slot is "full" only when pins hold all three.
- **The asset page's scope.** 選択中 is gone: every scoped button names its scope. While the page shows 作品全体, the
  other scope is the latest line or cut selected since the work was loaded (「2行目の背景」); with none, every button says
  作品全体.
- **Step ②'s song box** (a deviation from §11.7.2's table, which routes a video with sound to media only): a video with
  sound dropped on the song box (「曲を選ぶ（ここにドロップも可）」) still joins 写真・動画, and its sound becomes the song
  at once; a video dropped anywhere else on step ② keeps the toast's [この動画の音を曲にする], now until used or closed.
- **Saving without everything on this device (§12.7).** The package's result toast carries what is not in the file:
  「保存しました: …。ただし写真・動画1件と曲はこの端末にないため入っていません [つなぎ直す]」 (a warning that stays until
  closed); the song counts too. The separate `pkg.warn.missingIn` toast before the save is not shown (the toast host
  evicted it); `ui/toasts` now drops an ok or info note before a warning when more than two are shown.
- **Plain words** (the owner's rule): 重ね方's options are 明るく重ねる / 暗く重ねる / くっきり重ねる / そのまま重ねる
  (`opt.blend.*`) instead of §11.7.11's スクリーン / 乗算 / オーバーレイ / 通常 (those keys stay for other uses);
  a single line is 「3行目」 in every placement and 使っている場所 text; a video is 動画 in its toast, plate and ⋯ menu.
- **Step ④'s [つなぎ直す]** opens the library (§11.7.8) with the focus on the first missing row; its [つなぎ直す] (or
  Enter, then the asset page's [つなぎ直す]) opens the file dialog.
- The crop drag writes cropX and cropY as one batch per move inside one store gesture; the crop keys write through the
  row's commit with one merge key (one undo entry per burst).
- The trim keys move exactly one source frame although clipIn and clipOut have a 0.01 s step (the value still means
  that frame).
- Step ④'s media items cover every asset the plan draws (`plan.media`: decision params and materials); media-skipped
  follows the backdrop the export renders (`ui/output.effectiveBackdrop`).
- The vision consent is the app's question dialog; its 約{kb}KB is the size of one sent picture, which is now true for
  videos too (768-px frames).

### Review fixes

- **G4UX-1, G4-R1, a11y-1** (crop keys pinned cropX = 1): `siblingOf` read the value against the 切り抜き row's spec;
  now `MW.paramSpec`. Node: `paramSpec`; flow media: → ↑ ← + − (1 %, one entry), Shift+← (10 %), the wheel, 0, double-click.
- **G4-S1, G4-R8** (paste after copying a look): see Paste. Flow media: a real clipboard picture after Ctrl+C →
  `media.put`, no `pin.copy`; text on the clipboard → the look.
- **G4-S2, G4-R4, G4-S4, G4-S8** (step ④): see Decisions. Node: a material-only missing asset blocks, HDR through a
  material, webmAlpha skips, an MP4 with an old 透明 does not, the jump; flow missing: the library opens on the missing row.
- **G4-S3** (untested behaviours): flows media, library, missing, and the new package, media_device and media_song (below).
- **G4-S5** 再生できません on the row, the asset page and the media widget (flow library, a stubbed state).
- **G4-S6** video section ids (Node). **G4-S7** the audio action on the placed and the duplicate toasts (flow media_song).
- **G4-S9** plates where the picture is (flow missing: the frame's plate in its corner box, the background's centred).
- **G4-S10** progress: announcements rate-limited, × then the next file shows a row again, [中止] stops the queue (flow
  library: three quick files are announced once; × comes back; 中止 imports none).
- **G4-S11, G4-R9** vision pictures (Node `usedRange`; flow library: the 1280×720 photo is sent at 768×432, a video's
  three frames are 18, 30 and 42 of its clipIn 0.5 s range, read back from the JPEGs).
- **G4-S12** the keyboard-only variant is Tab, Space and Enter from step ④ to the file dialog (step ④'s format buttons
  are plain buttons: Tab and Space; they have no arrow keys, and step ④ is H.3's).
- **G4-S13** overlay footage from the asset page, そのまま重ねる, then 後ろに下げる and 文字の前に出す: black glyphs stay
  black behind it and take its colour in front (the readability guard screens it at 45 %, §11.9.3) (flow media).
- **G4UX-2** see freeIndex; the text-fill row reads 自動 / なし (flow library: the first decorations stay, なし clears).
- **G4UX-3** see Saving (flow missing: the result toast after Ctrl+S names the three pictures and keeps [つなぎ直す]).
- **G4UX-4** see the asset page's scope (flow library, with and without a remembered line). **G4UX-5** see the song box.
- **G4UX-6** 映像を準備中 (flow missing: one picture back, one still missing, the badge does not stay).
- **G4UX-7** ⓘ toggles and the why follows the pin (flow media). **G4UX-8** the missing page (flow missing).
- **G4UX-9, a11y-5** the crop strip, the live region and Esc (flow media). **G4UX-10** units (Node and flow media).
- **G4UX-11** words by kind (flows media and missing: 背景を動画にしました, 動画がありません: 海.mp4, この動画を使わない;
  Node: 「3行目」; 重ねる映像 as the section title). **G4UX-12, a11y-7** two-line rows (ui_layout: names and statuses
  whole at 288 px and at the real width; flow library: the row's name).
- **G4UX-13** この色に合わせる (flow library). **G4UX-14** the palette (Node `order`; flow library: 一覧 → focus on a row).
- **G4UX-15** opened time (flow package). **G4UX-16** the stand-in (flow missing). **G4UX-17** crumbs (flow library).
- **G4-R2** imports stopped by a load (flow media_device: a file whose reader finishes anyway after another work
  opened places nothing there). **G4-R3** `project_io.loadFile` keeps the loaded work's asset ids in `usedMedia` (flow
  media_device: a picture only in 写真・動画, which nothing reads after the work is reopened, deleted, autosaved, undone:
  the bytes are still here).
- **G4-R5** 消す forgets all (flow media_device: the reopened light file shows its pictures missing, the one the preview
  never drew too, and step ④ blocks).
- **G4-R6** captured picker and tab (flow library: a picker import finishing after another line was selected, and a
  part-browser import finishing after it was closed, place nothing). **G4-R7** caches (flow missing: the relinked row
  shows its poster; flow media_device: a poster that gave nothing is asked again once the bytes are back).
- **a11y-2** the asset page keeps the focus (flow library: ✎, the switch with Space). **a11y-3** badges in names (flows
  library and missing). **a11y-4** trim handles (flow media). **a11y-6** the poster (flow library).

### Outside the G.4 file list

`ui/toasts` (several actions, sticky rows, `update`, `quiet`, `onClose`, and a warning outlives ok notes), `ui/header`
(the save and file state; 「…に開きました」), `ui/project_io` (G.1's file: relink action on the missing toast, drop target
passed on, progress rows, the result toast of a package save with what is missing, the `device` event, the loaded work's
ids kept for pruning, `fileState().opened`), `ui/step_export` (the jump button's label and comments), `ui/ai_controller`
(the vision tool; the missing-pictures toast), `ui/ai_panel`, `ui/ai_board`, `ui/ai_review`, `tests/node/ui_fields.test.js`,
`tests/www/media_parts.js` and `transparent_check.py` (the workaround removed), `tests/helpers/media_gen.js`
(`encodeTone` and `encodeCounter({ audio })`: an Opus tone track in the MP4, so a test video can have sound), and
`i18n_pages.py`.

### Tests

- `tests/node/ui_media.test.js` (28): routing by the tracks; `whereOf`; `scopeWords`; placement batches at the work, on
  lines, on an area, on a cut and a full scope, with the decorations of the lines kept; `freeIndex` (pins, AI pins,
  fewest changes, ties, a typical work); the library order; delete; この写真を使わない; 使っている場所; relink candidates;
  colour matching; library facts; `mediaRows` (media, depth, trim, crop; units, 薄幕の強さ, 重ね方's words); `paramSpec`;
  the video rows' `when` and their section ids; the text page's textFill slot; `sec.media`; `isDerivedMedia`; trim maths;
  a document without a library; the palette's order; step ④'s items (plan.media, materials, HDR, the effective
  backdrop, the jump); the vision consent, request, review, apply and the missing-pictures toast; `usedRange`.
- `ui_flows.py`: **media** (stage drop; element page with ⓘ, units, 薄幕の強さ; the crop overlay's strip, live region,
  drag, keys, − and +, wheel, 0, double-click, Esc; paste after a copied look, and a paste of text; an MP4 on 3行目 with
  its toast and ⋯ menu; trim keys, slider handles, drag with its peek strip, [▶ 範囲を見る]; 後ろに下げる undone;
  overlay footage in front of and behind black glyphs (pixels); export where H.264 encodes; undo-all), **library**
  (import, the rows' names, a duplicate, the asset page's crumbs, buttons, poster, ✎, the switch, この色に合わせる; the
  palette; おまかせ × 20; the part browser's tab; the picker (Enter, click, ＋ finishing late); the part browser's ＋
  finishing after it closed; 再生できません; the asset page with a remembered line; 文字の中に on 作品全体; the progress
  row (announcements, ×, 中止); 写真の説明 (a still at 768 px, a video's range); 置き換える…; 削除; undo-all),
  **missing** (light save; a fresh context with three missing pictures: toast, ？ and names, picker tiles, plates in place,
  a video's plate, the package result toast; step ④; [つなぎ直す] → library → relink, mouse and keyboard-only; the
  relinked row's poster; 映像を準備中; the missing page; the stand-in; export allowed), **package** (§12.8 G: 保存 →
  .mojipv through a faked dialog offering the package first, the header 「ファイルに保存中… n%」 and the row with [中止],
  保存しました and the header's file; Ctrl+S again without the dialog; 軽い保存 → .json and Ctrl+S keeps it; [中止] leaves
  the work and the files; opening shows its progress row and 「…に開きました」), **media_device** (R3, R2, R5, R7),
  **media_song** (the song box, the placed toast's action kept past a toast's life, the duplicate's, the sound becomes the
  song). Mutation-checked: 17 Node mutants of the new logic (pre-flight ids, backdrop and jump, `paramSpec`, three of
  `freeIndex`, the units, 重ね方, 薄幕の強さ, the section ids and title, `usedRange`, the vision toast, two of the
  palette's order, 「n行目」) and 24 browser mutants of the fixes (each fails its flow): see Checks.
- `ui_layout.py`: the library with a missing asset (its row and names whole at 288 px and at the real width), the asset
  page, picker and trim row at every viewport, and the crop overlay never covering the preview canvas. `csp.py`: import,
  playback, scrubbing, the trim, crop overlay, library, asset page, picker, 写真の説明, a PNG export, a package saved and
  opened. `i18n_pages.py`: + a missing asset's page and 重ねる映像 with its 重ね方 (ten media screens).

### Checks

- `python3 build.py --check`: 209 modules OK. `node --test --test-concurrency=1 "tests/node/*.test.js"`: 1553 pass
  (1525 before G.4, + 28 in `ui_media.test.js`). `build.py --lab`, `build.py`, `tests/build_test.py`: OK.
- Every `tests/browser/*.py` (local Chromium, no H.264): all OK except `perf.py`'s two known red rows,
  long+camera+materials and basic+media (as before G.4). `ui_flows.py` 38 flows (the six media flows among them),
  `ui_layout.py` 488 layouts, `i18n_pages.py` 37 screens per page, `csp.py` 0 violations.
- Mutation checks: the 17 Node mutants listed in Tests fail `ui_media.test.js`. 24 browser mutants of the review fixes
  each fail their flow: crop keys against the sibling's spec, Ctrl+V consumed by the key handler, ⓘ that only opens, a
  why line that does not follow the pin, no crop strip, Esc without the focus back, trim handles without the slider
  role, 映像を準備中 for a missing picture, every plate in the middle, the old saved toast, no 「…に開きました」, the song
  box drop, the placed toast without the sound, a picker import placed after the selection moved, 無効 on the text-fill
  row, every progress update announced, × not closing the row, 中止 stopping only the current file, the asset page
  losing the focus, vision frames of the whole video, an import placed in the work opened meanwhile, `usedMedia` not
  seeded on load, 消す forgetting only the shown work's pictures, and a poster that gave nothing kept as nothing. The
  first run left four alive (the generation check, the seed, 消す, the empty poster); the media_device flow was made
  sharper (a reader that ignores the abort, a picture nothing reads after the reopen, a poster asked again once the
  bytes are back) and kills them.
- `webm_check.py` loads a raw document without `media`: the first full run caught `ui/media_io` reading
  `doc.media.list` there; it now reads the library through `libraryOf` (tested).

### Open

- The 2 s MP4 of the media flow runs only where H.264 encodes (CI's Chrome); local Chromium skips it with a message.
- The keyboard-only relink ends in the system's file dialog, which a page test drives through its file chooser.
- Step ④'s format and fps segments have no arrow keys (they are Tab stops); H.3 may make them radiogroups proper.

## Lead: integrating G.4

- **The library flow depended on the random look.** Its check "the first decorations stay" counts how many first
  decorations stay the same when 文字の中に写真・動画 pins `textFill`; the planner's variety rule may swap a few next to a cut
  that changed. The おまかせ runs earlier in the flow leave a random seed and mood seed, and over 22 runs the count went
  from 11 to 15 of 15 (one run fell under the 80 % bound). With the seed alone fixed it still varied (the mood seed stayed
  random). The flow now sets `look.omakase { seed: 1, moodSeed: 1 }` before it opens the text page, so the inspector row,
  the slot `freeIndex` picks and the counts come from one known plan: 15 of 15 in every run.
- **The video's pictures for 写真の説明 were asked for too early.** The flow waited for the entry in `doc.media.list`,
  while `visionParts` describes only an asset whose bytes are stored and checked (`state(id) === 'ok'`). Under load
  (four runs at once) the list came back empty. The flow now waits for the state first.
- **DESIGN_2_1 wording asked for by the packages:** §4.5.4's check line (±0.24 W at Z = 1.5), the Opus `sampleRate` (the
  song buffer's rate, 48000), the down-mix's home in `audio/wav` (§13.4), the alpha bitrate at the colour's bitrate
  (§13.5, `ALPHA_SHARE` 1), `DirSink.file(name)` returning a Promise (§13.11) and webm_check's statistical alpha bounds
  (§13.12). §11.3.7's `mediaAt` item shape and §11.4.3 are left to the media-row work, which edits the same sections.


## Lead: registryFor after G.3

CI's Node run failed `mix.test.js`'s budget "registryFor with 64 materials and 200 assets ≤ 4 ms": 4.13–4.47 ms in
all 16 batches of two runs. Bisected locally: 1.9 ms up to H.2, 3.9 ms from G.3. G.3's `photoPan` spec is larger, and
`core/registry.extend` checked, listed and hashed every added definition again on every call, although `parts/mix`
hands it the same deep-frozen objects for every entry an edit did not touch (the 20 media grounds took 2.9 ms, half of it
`metaHash`). `extend` now keeps, per frozen definition (the definition and its `params` frozen), the result of
`checkDef(def, { mine: true })`, its param list and its signature entry; an unfrozen definition is still checked and
hashed on every call. The versions are unchanged (same signature). Measured here: 64 materials 1.55 → 0.35 ms, with 200
assets 3.9 → 0.42 ms. `registry.test.js` covers the re-use (the same param list object; a bad frozen definition keeps
its problem) and the unfrozen case (an edit changes the version and the checks); mutants that never re-use or that
re-use unfrozen definitions both fail it.
