# Third-party notices

## mp4-muxer 5.2.2 (bundled)

`vendor/mp4-muxer.min.js` is embedded in `index.html` and is used to write MP4 files.
Source: https://github.com/Vanilagy/mp4-muxer — licensed under the MIT License:

```
MIT License

Copyright (c) 2023 Vanilagy

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## @anthropic-ai/sdk 0.128.0 (bundled)

`vendor/ai-sdk.min.js` is embedded in `index.html` and is used only when the user picks the second AI service.
It is that service's official SDK, bundled for the browser by `tools/vendor` (esbuild).
Source: https://github.com/anthropics/anthropic-sdk-typescript — licensed under the MIT License:

```
MIT License

Copyright 2023 Anthropic, PBC.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## Fonts (not bundled)

The web app loads the following typefaces at runtime from Google Fonts (https://fonts.google.com/); they are not
included in this repository. They are distributed by their authors under the SIL Open Font License 1.1:
Noto Sans JP, Noto Serif JP, Dela Gothic One, Zen Kaku Gothic New, Zen Old Mincho, Kaisei Tokumin,
M PLUS Rounded 1c, Mochiy Pop One, DotGothic16, Yuji Syuku, IBM Plex Mono, IBM Plex Sans JP.
