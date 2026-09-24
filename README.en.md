# Moji PV Maker (working title)

A browser app that turns lyrics and a song into a lyric motion video.
Based on JIZURA (© 2026 hakoniwa, MIT).

**▶ Open the app: <https://momomonbi.github.io/moji-pv/en/>**

- Nothing to install. Lyrics, audio and exports are processed in your browser.
- Every feature works without AI.

## What it does

707 parts and 24 styles combine into cuts automatically, exported as MP4. **Syntax** in the app explains the lyric
marks; **About / rights** shows the rights and licenses.

On top of that there is an optional AI assistant:

| Feature | What it does |
|---|---|
| Prepare lyrics | Suggests lines to drop (credits, [Verse] labels…), where to cut phrases, words to emphasize and unusual readings |
| Three looks by AI | Proposes three looks (style, colors, motion, how the chorus appears) from what the lyrics mean, leaving out motifs of another season |
| One-line edit | Turns one sentence such as "Make the chorus bolder" into a list of changes |
| Use the song (Gemini only, experimental) | Transcribes lyrics from the song, times the typed lyrics to it, or analyzes its sections, mood and tempo |

You always see the list of changes before anything is applied, and **Undo AI change** takes it back.

## Using the AI assistant

1. Click **AI** at the top right (or **Get three looks from AI** in Simple mode).
2. Under **AI service and API key**, pick a service and paste your key.
   The default is Google Gemini **gemini-3.8-flash** (key: [Google AI Studio](https://aistudio.google.com/apikey)).
3. Run a feature, tick the changes you want, and apply.

What is sent: the lyric text, your one-line instruction and setting values, directly from your browser to the AI
service you chose. The song audio is sent to Google Gemini only when you tick the agreement and press one of the
**Use the song** buttons (transcribe lyrics, time the lyrics, analyze the song). The key stays in this browser (forgotten when the tab closes unless you tick
**Remember on this device**) and is never written into project files. The service bills you; each call shows its token
use and an approximate cost.

## Development and license

Build with `python3 build.py`; tests and CI are listed in [README.md](README.md#開発).
[MIT License](LICENSE), based on JIZURA (© 2026 hakoniwa). Third-party software: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
