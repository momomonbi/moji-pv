# Moji PV Maker

Turn lyrics into a lyric motion video, right in your browser.

**▶ <https://momomonbi.github.io/moji-pv/en/>** (Japanese UI: <https://momomonbi.github.io/moji-pv/>)

Nothing to install, no account. Every feature works without AI.

## How to use it (3 steps)

1. **Paste your lyrics** into step 1 (or press "Try a sample").
2. **New look** — each press of **New look** in the play bar (key: R) changes mood, colors and motion at once. Press it as often as you like.
3. **Export** — pick a format and size in step 4 and press **Export**.

**Syntax** in the app explains the lyric marks: `/` splits a cut, `*word*` for emphasis, a trailing `!` for an impact
line, `[00:12.34]` for a start time (LRC), and more.

## Fine-tuning

Click the preview or a lyric line and the **Details** column shows that part. You move through
**whole video → line → cut → element** (text, decor, background, camera, screen effects, transition).

- **Auto / Pinned** — everything starts as Auto. A value you pick yourself is Pinned: New look and reroll leave it alone.
  **Unpin** makes it automatic again.
- **Lock** — lock a line you like and it keeps its look.
- **Look history ◀ ▶** — the ◀ ▶ buttons in the play bar step through the looks you have tried.
- Every change can be undone, and your work is autosaved in the browser.

## Song (optional) and tap sync

You can make a video without a song; its length then follows the lyrics. Load an mp3, wav, m4a, ogg or flac file in
step 2 and the app finds the tempo and uses it for the motion. **Snap to beats** moves the automatic line starts onto
the beat.

- **Tap to sync** — play the song and press Space when each line starts; the times are recorded line by line.
- Times in the lyrics such as `[00:12.34]` (LRC) are used as they are.

## Export

| Format | What you get |
|---|---|
| MP4 | A video (sound can be included) |
| For Filmora | The finished MP4 and the files to layer with it (a transparent video of the lyrics and decorations, subtitles and more) in one folder. How to use it: [docs/FILMORA.md](docs/FILMORA.md) |
| Transparent video (WebM) | A video with a transparent background (VP9 with alpha), to lay over other footage in Filmora, Premiere, DaVinci and others |
| PNG seq. | One PNG per frame, in a ZIP |
| PNG alpha | A PNG sequence with a transparent background |

Sizes 720p to 2160p, 24 / 30 / 60 fps; screen shapes 16:9, 9:16, 1:1 and more.

**Background modes**: Normal / Green screen / Black (white text) / Transparent (transparent video or PNG alpha).
To lay the lyrics over other footage, Transparent video (WebM) is recommended; PNG sequences suit After Effects and
similar.

For MP4, transparent video and the Filmora set, Chrome or Edge on a computer is recommended (they use WebCodecs).

## AI assist (optional)

Open the **AI** tab of the detail column. You need your own API key (the default is Google Gemini
**gemini-3.8-flash**).

- **Prepare lyrics** — drops lines that are not lyrics (credits, [Chorus] …) and suggests cut points, emphasis and readings
- **Three looks** — three looks that fit the meaning and the season of the lyrics; try each one on before you choose
- **Instruction** — changes the whole video, the selected lines or a section (Chorus 1 …) from an instruction such as
  "add a seasonal feel here and slow the motion down"; **Instructions per section** sends one for each section at once
- **Make a material** — builds a new material (My materials) from the app's parts and simple shapes
- **Describe photos** (Gemini only) — after a confirmation every time, sends your photos and videos made smaller and
  describes them: what they show, their colors, and a suggestion for their motion and layering
- **Use the song** (Gemini only) — with your consent, sends the song to transcribe it, time the lines or analyze it

Results first appear as a checked list; only what you keep is applied, and one undo takes it back.
Sent: the lyric text, your instruction, and setting values and names. With **AI may use photos and videos** on, also
each photo or video's number, kind, size, length and shape, and the AI's description of it. The song's audio and the
pictures are sent to Google Gemini only after you agree. File names are never sent. The key stays in this browser and
goes straight to the AI service you chose, nowhere else.

More in [docs/AI_GUIDE.md](docs/AI_GUIDE.md).

## Privacy

Lyrics, songs, photos, videos and exports are all processed inside your browser; nothing is uploaded to a server of
ours.
The only outside connections are the typefaces (Google Fonts) and, when you use AI assist, the AI service.

## Development

Python 3.11 and Node 22, no npm or pip packages (the browser tests use Playwright).

```
python3 build.py --check              # lint, layer rules and module order; writes nothing
node --test 'tests/node/*.test.js'    # Node tests
python3 build.py --lab                # also builds tests/www/lab.html for the tests
python3 build.py                      # builds index.html and en/index.html
python3 tests/browser/ui_flows.py     # browser tests (tests/browser/*.py, Playwright)
python3 tests/build_test.py           # tests of build.py
```

Browser tests run with `PW_CHANNEL=chrome` (an installed Chrome) or `PW_EXECUTABLE=/path/to/chromium`. CI
(`.github/workflows/ci.yml`) runs all of these in this order and checks that the committed index.html / en/index.html
match the build. The pages carry a CSP that allows scripts by hash, so never edit index.html by hand: rebuild it with
`build.py`.

Design: [docs/DESIGN.md](docs/DESIGN.md) · spec: [docs/SPEC.md](docs/SPEC.md) · work notes: [docs/NOTES.md](docs/NOTES.md) ·
v2.1 design addendum: [docs/DESIGN_2_1.md](docs/DESIGN_2_1.md).

## License

[MIT License](LICENSE). Third-party software: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Videos and images you make with this app belong to you (and to the rights holders of the lyrics and the song).
