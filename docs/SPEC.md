# 文字PVメーカー v2 — product spec (what it does, not how)

v2 is an **original** engine and UI for lyric videos. This file describes behaviour only, from the outside. v2.1 adds
camerawork, speed curves, instructions per area, materials, the user's photos and videos, the one-file project package
and Filmora-ready output; how they are built is in `docs/DESIGN_2_1.md`.

## 0. Sources and layout (for everyone who writes v2 code)

- References: this spec, `docs/DESIGN.md` with its v2.1 addendum `docs/DESIGN_2_1.md`, and general web/graphics
  knowledge. Third-party code (v2.1 adds none):
  `vendor/mp4-muxer.min.js` (MIT, keep its notice), `vendor/ai-sdk.min.js` (MIT; the bundle also carries three MIT /
  Unlicense packages, all in `THIRD_PARTY_NOTICES.md`). Browser-test launcher: `dev/browser.py`.
- Names of parts, themes and moods are v2's own.
- The app lives at the repository root (`src/`, `build.py`, `tests/`). It builds to one self-contained page
  `index.html` (and `en/index.html`).

## 1. Who and where

- People making lyric videos (文字PV) for songs: from a quick "make it look good" to frame-level tweaking.
- PC Chrome / Edge first (WebCodecs for video export and for imported videos). Other browsers: everything but those.
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
- v2.1 adds no top-level control: camerawork, speed curves, materials, photos and videos live one level deeper or more.
  Files (lyrics, songs, photos, videos, projects) can be dropped anywhere.

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
- An imported video's own sound can become the song (この動画の音を曲にする); otherwise a video's sound is not used.

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
- **Camerawork (カメラワーク, v2.1)**: automatic by default and aimed at the words: it pushes in on a word, follows the
  singing word by word, reframes between phrases, and drifts slowly over a whole area (区画のカメラ). Its strength is at
  作品全体 › 強さ › カメラワーク; presets and a closeness slider are one level deeper, keyframes the deepest. Pinnable at
  every scope, like every automatic choice.
- **Speed curves (緩急, v2.1)** wherever something moves over time: entrances and exits and their stagger, holds, camera
  moves and transitions. Presets such as 「一瞬ゆっくり→すごく速く→一瞬ゆっくり」, a two-slider form, or a custom curve in a
  small editor. **動きの速さ** (×0.25–×4) gives slow or fast motion per line or cut.
- **Per line (v2.1)**: its own season (この行の季節) and parts it must not use (この行で使わない部品).
- **My materials (マイ素材, v2.1)**: new materials that the AI or the user builds from existing parts and a fixed set of
  primitives (shapes, particles, patterns, motion tracks, oscillators). They are data, never code; they are stored in the
  project and shown under マイ素材 in the part browser. AI-made materials appear only where they are placed, unless
  their おまかせでも使う is ticked.
- Background modes: normal, green screen, black (white text only), transparent (transparent WebM and PNG export).
- Performance: smooth preview at 720p for typical cuts on a mid-range laptop; export is frame-exact and deterministic.

**Photos and videos (写真・動画, v2.1)**
- Import images (PNG, JPEG, WebP, AVIF; animated GIF, WebP and APNG play like short silent videos; SVG is turned into
  a picture once) and videos (MP4, M4V, MOV, WebM, MKV with H.264, VP8, VP9 or AV1, and HEVC where the browser reads
  it). Unreadable files (HEIC, ProRes, …) are refused with what to do instead. Limits: images up to 40 MP; videos up to
  4K, 120 fps, 60 min and 4 GB.
- Uses: the background of the whole video, an area, a line or a cut; a photo frame near the words; inside the letters;
  overlay footage; inside a material. おまかせ uses a photo or video as a background only when its
  おまかせでも背景に使う is ticked.
- Controls: fit, crop (on the preview), Ken Burns motion, blur, veil and tint; for videos also the range used, speed,
  loop or hold, and the clock (from when it appears, or with the song).
- **動きと重なり** (Motion and layering) for backgrounds, frames and overlay footage: おまかせ / 演出と一緒に動かす /
  文字の前に出す / 後ろに下げる / 動かさない. おまかせ takes the AI's suggestion when 写真の説明 made one, else fixed rules.
- この色に合わせる matches the theme colours to a photo, on the device, without AI.
- Video is frame-exact in export. Photos and videos are kept in this browser and in the project package; a missing one
  can be relinked.

## 7. Output

- MP4 (H.264 + AAC; Opus in MP4, with a note, where the browser has no AAC encoder) via WebCodecs + mp4-muxer;
  24 / 30 / 60 fps; 720p–2160p; progress, cancel, time left. Streams to disk when the File System Access API is
  available, otherwise builds in memory with a size warning.
- **Transparent video** (透過動画（WebM）, v2.1): VP9 with alpha (VP8 where VP9 cannot be encoded), for video editors.
- **Filmora用 (v2.1)**: one choice of 形式 writes a set of files into one folder (a ZIP download without the File System
  Access API): the finished MP4 always, and optionally 文字と装飾だけ (transparent WebM, on by default), 背景だけ (MP4),
  グリーンバック (MP4, key colour #00B140), 字幕 (SRT, on by default) and 時間つき歌詞 (LRC); a WAV of the song when the MP4
  cannot carry AAC; and README_Filmora.txt (Japanese and English). 「Filmoraで使うには」 explains the steps in the app.
- PNG sequence (PNG連番, a ZIP) and transparent PNG sequence (透過PNG). Subtitles (.srt) and timed lyrics (.lrc) can also
  be saved alone.
- **Project file (v2.1)**: 名前を付けて保存 (and 保存 of a work that has no file yet) writes the project package `.mojipv`
  by default, one file with the project, its photos, videos and song. 保存 keeps the kind of the open file: a work opened
  from, or last saved to, a `.json` gets a light save again. 軽い保存 writes the project alone as `.json` (versioned,
  with line ids); photos, videos and the song that are on the device relink when it is opened. `.mojipv`, v2.1 `.json`
  and v2.0 `.json` all open. Autosave stays in the browser and never rewrites a file.
- A save or an export never deletes a file or folder that it did not create itself.

## 8. AI assistant (optional)

Everything works without AI. On the v2 data model:
- Google Gemini `gemini-3.8-flash` by default (REST, key in `x-goog-api-key`), the second service through the bundled
  SDK; key check (free model-info request); key kept in session / local storage only, never in project files, logs,
  URLs or error texts.
- Tools: 歌詞の下ごしらえ; AI 演出3案 (season-aware); **指示** (v2.1, replaces ひとこと修正): an instruction for the whole
  video, the selected lines or an area (a song section, a `#` heading block, a blank-line block, one cut), and
  区画ごとに指示 for up to 8 areas at once. カメラワークをAIに任せる changes camera fields only. With
  新しい素材を作ってもよい the AI may make new materials; with 写真・動画をAIが使ってよい it may place the user's photos and
  videos. **素材づくり** makes or remakes one material. **写真の説明** (Google Gemini only) describes photos and videos and
  suggests their 動きと重なり. With the user's consent, the song features (transcribe with times, align lines, analyze
  sections / mood / tempo). Every AI result is shown as a checked list of changes before anything is applied, and can
  be undone.
- What is sent, straight from the browser to the chosen service only:
  - lyric text, the instruction and setting values (theme, mood, names of parts and materials, numbers);
  - for 指示 and 区画ごとに指示, only while 写真・動画をAIが使ってよい is on (one box for both): each photo or video only as
    `asset:<n>` with its kind, size, length and shape, and what 写真の説明 stored for it (such as its description and
    colours). The box is on by default, under 詳しく. With it off, no number, kind, size, length, shape or description
    of a photo or video is sent (only the part names, such as `photoPan`, tell that a background shows one);
  - audio only for the song features, after consent, to Google Gemini;
  - pictures only for 写真の説明, to Google Gemini, after a consent that is asked every time: JPEGs made smaller (768 px
    on the long side, without EXIF; a video sends 3 frames).
- Never sent: file names (of photos, videos or the song), and the key to anyone but the chosen service.

## 9. Quality bar

- Node unit tests: lyric parser (incl. LRC gaps), line-id diff, timing, planner determinism and variety, project
  migration, WAV / export math, AI adapters (providers faked); v2.1: curves, shots, materials, media demuxers, the
  project package, subtitles.
- Browser tests: render every registered part in every aspect without errors; CSP violations = 0; UI flow tests;
  ja / en string coverage; v2.1: frame-exact media, transparent WebM, the Filmora set.

## 10. Not in v2.1

After Effects export / panels. Also later (DESIGN_2_1 §10): a material or media library shared between projects,
HEIC, mixing a video's own sound with the song, 写真の説明 with the second AI service, ProRes and HDR export.
