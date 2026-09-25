#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: pictures with alpha, backdrops and depth (DESIGN_2_1 §11.8.3 media_alpha.py, §11.9.7).

Runs in the built app page (index.html?fresh=1&test=1) under its real CSP, with tests/helpers/exif_write.js,
tests/helpers/media_gen.js and the harness tests/www/media_parts.js evaluated into it (the real AssetStore, the catalog's
media parts, export/host/png). Checked:
- The VP9 alpha WebM of media_gen.js (its alpha stream: 128 in a square that moves 4 px a frame, 0 elsewhere): the frame
  the store merges (colour + alpha decoders) has, at 5 times, alpha within ±4/255 of that truth inside and outside the
  square, and is the exact frame asked for.
- The same clip as a photoFrame (shape free: the picture's own alpha is the cut-out) in a 透過PNG export: the PNG keeps
  the frame's alpha (the square within ±4 of 128, around it ≤ 4) and nothing outside the frame (alpha 0).
- Backdrops (§11.4.10): photoPan (a red still) is drawn over the scene backdrop and absent over clear, green and black;
  mediaLayer (a blue still) likewise is skipped there. Those frames hold exactly the backdrop and nothing else.
- Depth (§11.9.7): a mediaLayer (a blue still, blend normal, full amount) with 文字の前に出す (depth front) is drawn over
  the glyphs: every glyph pixel of the frame without it turns bluer; with depth anim or back it is drawn behind them,
  and the glyph pixels keep the text's ink.
0 CSP violations, no page errors.
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/media_alpha.py   (CI: PW_CHANNEL=chrome)
"""
import asyncio
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch, japanese_font_missing  # noqa: E402  (dev/browser.py, the shared launcher)
from playwright.async_api import async_playwright  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from media_page import open_media_page  # noqa: E402  (the built app page with tests/www/media_parts.js)

TOL = 4                  # /255: the alpha of a merged frame against the generated truth
HALF = 128               # the alpha stream's square




class Checks:
    def __init__(self):
        self.failures = []

    def ok(self, cond, what):
        print(('ok    ' if cond else 'FAIL  ') + what)
        if not cond:
            self.failures.append(what)
        return cond


def near(values, want, tol=TOL):
    return all(abs(v - want) <= tol for v in values)


async def main():
    c = Checks()
    started = time.time()
    async with async_playwright() as p:
        browser = await launch(p)
        try:
            mp = await open_media_page(browser)
            try:
                if await japanese_font_missing(mp.page, 'media_alpha.py'):
                    return 1
                r = await mp.page.evaluate('() => window.__mediaParts.alpha()')
                csp = await mp.csp()
            finally:
                await mp.close()
        finally:
            await browser.close()
    errors = mp.errors

    e = r['entry']
    c.ok(e['alpha'] is True and e['frames'] == 30, 'the alpha WebM imports with alpha (%r)' % e)
    for m in r['merged']:
        c.ok(m['exact'] and m['index'] == m['k'], 'merged frame %d: the exact frame (index %r)' % (m['k'], m['index']))
        c.ok(near(m['inside'], HALF), 'merged frame %d: alpha %r inside the square (truth 128 ± %d)' % (m['k'], m['inside'], TOL))
        c.ok(near(m['outside'], 0), 'merged frame %d: alpha %r outside it (truth 0 ± %d)' % (m['k'], m['outside'], TOL))

    f = r['frame']
    c.ok(len(f['frames']) == 5, 'the 透過PNG export with the photo frame has 5 frames')
    for x in f['frames']:
        where = '透過PNG %dx%d at %.3f s (source frame %d)' % (x['size'][0], x['size'][1], x['t'], x['k'])
        c.ok(near(x['inside'], HALF), where + ': the frame keeps its alpha in the square: %r' % x['inside'])
        c.ok(near(x['outside'], 0), where + ': and around it: %r' % x['outside'])
        c.ok(x['beyond'] == [0, 0, 0], where + ': nothing outside the frame: %r' % x['beyond'])
        c.ok(x['clear'] > 0.8 * x['size'][0] * x['size'][1], where + ': the rest of the frame is transparent (%d px)' % x['clear'])

    b = r['backdrops']
    c.ok(b['photoPan scene']['red'] > 100000, 'photoPan over the scene backdrop: the picture is drawn (%d red px)' % b['photoPan scene']['red'])
    c.ok(b['photoPan chroma']['green'] and b['photoPan chroma']['red'] == 0, 'photoPan is absent over green (the frame is #00B140)')
    c.ok(b['photoPan black']['black'] and b['photoPan black']['red'] == 0, 'photoPan is absent over black (the frame is #000000)')
    c.ok(b['photoPan clear']['clear'], 'photoPan is absent from a transparent export (alpha 0 everywhere)')
    c.ok(b['mediaLayer scene']['blue'] > 100000, 'mediaLayer over the scene backdrop: the footage is drawn (%d blue px)' % b['mediaLayer scene']['blue'])
    c.ok(b['mediaLayer chroma']['green'] and b['mediaLayer chroma']['blue'] == 0, 'mediaLayer is skipped over green')
    c.ok(b['mediaLayer black']['black'] and b['mediaLayer black']['blue'] == 0, 'mediaLayer is skipped over black')
    c.ok(b['mediaLayer clear']['clear'], 'mediaLayer is skipped in a transparent export')

    d = r['depth']
    n = d['glyphPixels']
    c.ok(n >= 500, 'the text is drawn in its ink (%d glyph pixels)' % n)
    front = d['front']
    c.ok(front['media'] == 1 and front['raised'] >= 0.98 * n and front['ink'] <= 0.02 * n,
         '文字の前に出す (depth front): the overlay is drawn over the text (%d of %d glyph pixels bluer, %d keep the ink)'
         % (front['raised'], n, front['ink']))
    for depth in ('anim', 'back'):
        x = d[depth]
        c.ok(x['media'] == 1 and x['ink'] >= 0.98 * n and x['blueOutside'] > 10000,
             'depth %s: the overlay is drawn behind the text (%d of %d glyph pixels keep the ink; %d blue px around)'
             % (depth, x['ink'], n, x['blueOutside']))
    c.ok(not errors, 'no page errors %r' % errors[:3])
    c.ok(not csp, '0 CSP violations %r' % csp[:3])
    print('media_alpha.py: %s (%.0f s)' % ('FAILED (%d)' % len(c.failures) if c.failures else 'OK', time.time() - started))
    return 1 if c.failures else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
