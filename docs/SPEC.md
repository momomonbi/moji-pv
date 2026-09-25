# 文字PVメーカー v2 — product spec (what it does, not how)

v2 is an **original** engine and UI for lyric videos. This file describes behaviour only, from the outside.

## 0. Sources and layout (for everyone who writes v2 code)

- References: this spec, `docs/DESIGN.md` and general web/graphics knowledge. Third-party code:
  `vendor/mp4-muxer.min.js` (MIT, keep its notice), `vendor/ai-sdk.min.js` (MIT; the bundle also carries three MIT /
  Unlicense packages, all in `THIRD_PARTY_NOTICES.md`). Browser-test launcher: `dev/browser.py`.
- Names of parts, themes and moods are v2's own.
- The app lives at the repository root (`src/`, `build.py`, `tests/`). It builds to one self-contained page
  `index.html` (and `en/index.html`).

## 1. Who and where

- People making lyric videos (文字PV) for songs: from a quick "make it look good" to frame-level tweaking.
- PC Chrome / Edge first (WebCodecs for MP4). Other browsers: everything but MP4 export.
- Static page on GitHub Pages, strict CSP (inline scripts by hash; network only to Google Fonts and the AI APIs). No server.
- Japanese UI first, English UI too (one string table).

## 2. The screen: as simple as possible on top, deep underneath

- **Top level** shows only: the preview (large), a play bar, and one short step flow:
  ① 歌詞 → ② 曲（任意） → ③ 見た目 → ④ 書き出し.
  Each step shows at most a handful of controls. A first-time user can make a video with: paste lyrics → おまかせ → 書き出し.
- **Everything else is one level deeper, and deeper again**, in an inspector that follows what is selected:
  作品全体 → 行 → カット → 要素（文字・装飾・背景・カメラ・画面効果）. Selecting a line in the lyric list or clicking the preview
  / timeline selects it. Breadcrumbs show where you are; Esc goes up one level.
- Fine controls exist for every automatic choice (a value can be "auto" or pinned). Pinned values survive rerolls.
- Undo / redo (Ctrl+Z / Ctrl+Shift+Z) covers every edit, including lyrics, timing, look and AI changes.
- ◀ ▶ steps through looks tried with おまかせ / reroll.
- Keyboard: Space play/pause, ← → frame step (Shift = 1 s), R おまかせ, T tap-sync mode, Del clears a pinned value.
- The AI assistant is a side panel that never covers the preview or the header.

## 3. Lyrics

- One line = one sung phrase. Blank line = a short pause. `#` starts a comment. `[ti:…]` `[ar:…]` set title / artist.
- Marks inside a line: `/` cut point, `*word*` emphasis, trailing `!` impact (flash + shake), `|note` small annotation
  text, `[mm:ss.xx]` start time (LRC). Lines without a tag get times from their neighbours (a single tag never discards
  the others).
- **Stable line identity**: each line has an id. Editing the lyrics keeps ids on unchanged / slightly edited lines
  (diff by content and position), so per-line times, locks and settings follow the line, not the line number.
- Language: Japanese, English, Traditional / Simplified Chinese, Korean (auto-detected; fonts per language).

## 4. Timing

- Automatic start times from text length (and BPM when known); optional snap of cut boundaries to beats.
- Tap-sync: start from any line, Space/Enter marks the start, Backspace steps back one line, a second key marks a line's
  end (optional). Works while the song plays.
- Manual edit of start / end in the inspector (number fields and dragging on the timeline).
- LRC import; AI alignment (see 8).

## 5. Song (optional)

- Load mp3 / wav / m4a / ogg / flac. Decode in the browser; show a waveform on the timeline.
- Own analysis: loudness envelope, onsets, tempo (BPM) and beat grid; user can type BPM / offset instead.
- Playback in sync with the preview. The video length follows the song when a song is loaded.

## 6. Look (the engine)

- Design space independent of output resolution (short side = 1080 units). Aspects 16:9, 9:16, 1:1, 4:5, 4:3, 3:4, 21:9.
- **Cuts**: each line becomes one or more cuts (split at `/` or natural phrase boundaries depending on time and density);
  an emphasized/impact phrase may get its own cut; long gaps get an interlude cut; a title card when a title is set.
- **Composition** (where and how big the words sit): at least 16 original compositions — centered, stacked words,
  vertical columns (tategaki), big + small mix, off-axis / diagonal, corner caption, word scatter, oversized crop, split
  screen, ticker, grid, ring / arc, etc.
- **Motion**: entrances (≥ 20), holds (≥ 8), exits (≥ 16), with per-glyph timing (stagger, order, random), easing,
  typewriter, masks / wipes, blur, scale / rotate / skew, pseudo-3D flips, bounce, glyph break-up.
- **Themes**: ≥ 12 original themes (background, text, accent and two offset colors; display / serif / body typefaces from
  Google Fonts incl. Japanese faces; texture). Users can override any color and font.
- **Backgrounds** (≥ 12), **decorations** (≥ 16: lines, frames, shapes, particles, marks), **camera** (≥ 8: push, pan,
  shake, tilt, zoom-on-beat…), **screen effects** (≥ 12: RGB split, glitch slices, flash, invert, blur, grain,
  scanlines, vignette…), **transitions** between cuts (≥ 8).
- **Moods** (≥ 6) bias every choice (e.g. calm / pop / glitch / cinematic / editorial / emotional) and set effect amounts.
- **Season motifs**: parts whose picture belongs to a season are tagged; `project.season` keeps other seasons out.
- **Vertical Japanese** done right: rotate ー〜…「」（） and Latin runs, offset small kana and 、。, center punctuation.
- **Planner**: deterministic from (project, seed). Picks per cut from mood, text length, emphasis, energy and beats;
  avoids repeating the same choice in neighbouring cuts; respects every pinned value and locked line.
- **Variety controls**: おまかせ (new mood + theme + seed), reroll per line / cut / part, lock per line, "use only these
  parts" filters.
- Background modes: normal, green screen, black (white text only), transparent (PNG export).
- Performance: smooth preview at 720p for typical cuts on a mid-range laptop; export is frame-exact and deterministic.

## 7. Output

- MP4 (H.264 + AAC) via WebCodecs + mp4-muxer; 24 / 30 / 60 fps; 720p–2160p; progress, cancel, time left.
  Streams to disk when the File System Access API is available, otherwise builds in memory with a size warning.
- PNG sequence (ZIP) and transparent PNG sequence.
- Project file (.json, versioned, with line ids) save / open; autosave in the browser.

## 8. AI assistant (optional)

On the v2 data model:
- Google Gemini `gemini-3.8-flash` by default (REST, key in `x-goog-api-key`), the second service through the bundled
  SDK; key check (free model-info request); key kept in session / local storage only.
- 歌詞の下ごしらえ, AI 演出3案 (season-aware), ひとこと修正, and with the user's consent the song features
  (transcribe with times, align lines, analyze sections / mood / tempo). Every AI result is shown as a checked list of
  changes before anything is applied, and can be undone.
- Only lyric text, the instruction and setting values are sent; audio only for the song features after consent.

## 9. Quality bar

- Node unit tests: lyric parser (incl. LRC gaps), line-id diff, timing, planner determinism and variety, project
  migration, WAV / export math, AI adapters (providers faked).
- Browser tests: render every registered part in every aspect without errors; CSP violations = 0; UI flow tests;
  ja / en string coverage.

## 10. Not in v2.0

After Effects export / panels.
