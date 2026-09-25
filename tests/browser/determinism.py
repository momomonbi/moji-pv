#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: frames are functions of (plan, t) (DESIGN §7.1, §8.3).

For fixture projects rendered through the real engine on the lab page (pixel hashes of 640 px wide frames):
1. Frame N rendered by a fresh engine equals frame N rendered after frames 0 … N−1 (no state between frames: sprites,
   texture tiles, static rasters, pooled surfaces and the adaptive preview must not leak into a frame).
2. 30 vs 60 fps: an engine stepping at 60 fps and one stepping at 30 fps give the same pixels at their shared times
   (tick-based effects such as film grain change at a fixed rate, not per frame).
3. Two fresh engines give identical frames.
The windows cover entrances, exits, a seam and the texture filter. Two targeted checks follow:
4. Every screen effect at its hero time, rendered onto a surface that held red and onto one that held blue before the
   frame, gives the same pixels (what a filter leaves transparent shows the backdrop, never the caller's old pixels).
5. Blurred glyph sprites: the same grapheme at several em sizes (emphasis, text.scale), rendered by a fresh engine and
   by a fresh engine that first drew the text at another output size or text.scale (±4 %, ±8 %), gives the same pixels.
Registries: the catalog (what ships) and the examples, when the page has them; --parts picks one.
Google Fonts are blocked (fallback faces).
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/determinism.py [--parts catalog] [--projects basic,lrc]
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contact_sheet import launch, open_lab, csp_violations  # noqa: E402  (the shared lab-page helpers)
from playwright.async_api import async_playwright  # noqa: E402

WINDOW = (2.6, 4.6)          # seconds: the first lyric cuts, a seam and their filters in the fixture projects
FPS = 30
PROBES = (7, 31, 59)
MIXED_TEXT = 'あいあい'
MIXED_SIZE = (960, 540)
MIXED_BEFORE = ({'w': 1104, 'h': 621}, {'w': 835, 'h': 470}, {'textScale': 1.04}, {'textScale': 0.96}, {'textScale': 1.08},
                {'textScale': 0.92})
MIXED_BLURS = (1.0, 3.0, 6.0, 12.0)


def times_at(fps, t0, t1):
    n = int(round((t1 - t0) * fps))
    return [t0 + i / fps for i in range(n)]


async def frames(page, **o):
    return (await page.evaluate('(o) => window.__lab.frames(o)', o))['hashes']


async def render(page, **o):
    return await page.evaluate('(o) => window.__lab.render(o)', o)


async def check_project(page, src, project, failures):
    t0, t1 = WINDOW
    at30 = times_at(FPS, t0, t1)
    at60 = times_at(2 * FPS, t0, t1)
    seq30 = await frames(page, parts=src, project=project, times=at30, fresh=True)
    seq60 = await frames(page, parts=src, project=project, times=at60, fresh=True)
    bad = 0
    for n in PROBES:
        alone = await frames(page, parts=src, project=project, times=[at30[n]], fresh=True)
        if alone[0] != seq30[n]:
            failures.append('%s %s: frame %d (t=%.3f) alone differs from the same frame after 0..%d' % (src, project, n, at30[n], n - 1))
            bad += 1
    for i, t in enumerate(at30):
        if seq60[2 * i] != seq30[i]:
            failures.append('%s %s: t=%.4f differs between the 30 fps and the 60 fps run' % (src, project, t))
            bad += 1
            break
    again = await frames(page, parts=src, project=project, times=at30, fresh=True)
    if again != seq30:
        failures.append('%s %s: two fresh engines differ' % (src, project))
        bad += 1
    changing = len(set(seq30))
    if changing < 5:
        failures.append('%s %s: only %d distinct frames in %.1f s (nothing moves?)' % (src, project, changing, t1 - t0))
        bad += 1
    print('%s %s %s: %d frames at 30 fps, %d at 60 fps, %d distinct' % ('FAIL' if bad else 'ok  ', src, project, len(at30),
                                                                        len(at60), changing))


async def check_prefill(page, src, info, failures):
    """Check 4: a filter's transparent pixels never show what the target held before the frame."""
    keys = info['parts'][src].get('filter', [])
    bad = []
    for key in keys:
        base = {'parts': src, 'kind': 'filter', 'key': key, 'w': 480, 'h': 270, 'quality': 'export'}
        red = await render(page, **base, prefill='#FF0000')
        blue = await render(page, **base, prefill='#0000FF')
        if red['hash'] != blue['hash']:
            bad.append(key)
    for key in bad:
        failures.append('%s filter/%s: the frame shows what the target held before it' % (src, key))
    print('%s %s: %d screen effects drawn over red and over blue give the same frame' % ('FAIL' if bad else 'ok  ', src,
                                                                                         len(keys) - len(bad)))


async def check_mixed_em(page, src, failures):
    """Check 5: blurred sprites of one grapheme at several em sizes do not depend on which was drawn first. Each
    sequence is one fresh engine: a frame at another output size or text.scale (whose size buckets then hold rasters
    of the same grapheme at another em), then the frame itself."""
    w, h = MIXED_SIZE
    base = {'parts': src, 'text': MIXED_TEXT, 'quality': 'preview', 'level': 0, 'glyphPath': 'sprite', 'w': w, 'h': h}
    bad = 0
    for blur in MIXED_BLURS:
        probe = {'blur': blur}
        alone = await page.evaluate('(o) => window.__lab.sequence(o)', dict(base, steps=[{'probe': probe}]))
        if alone[0]['glyphs'] == 0:
            failures.append('%s: the mixed-em sample drew no glyphs' % src)
            return
        for before in MIXED_BEFORE:
            steps = [dict(before, probe=probe), {'probe': probe, 'w': w, 'h': h, 'textScale': 1}]
            seq = await page.evaluate('(o) => window.__lab.sequence(o)', dict(base, steps=steps))
            if seq[1]['hash'] != alone[0]['hash']:
                failures.append('%s: blur %.1f du differs after a frame with %r' % (src, blur, before))
                bad += 1
    print('%s %s: blurred sprites of one grapheme at several em sizes are order-independent (%d cases)' % (
        'FAIL' if bad else 'ok  ', src, len(MIXED_BLURS) * len(MIXED_BEFORE)))


def sources_of(info, wanted):
    if wanted:
        return [wanted]
    return [s for s in ('catalog', 'examples') if s in info['sources']] or info['sources'][:1]


async def run(args):
    failures = []
    async with async_playwright() as p:
        browser = await launch(p)
        try:
            page = await open_lab(browser)
            info = await page.evaluate('window.__lab.info()')
            srcs = sources_of(info, args.parts)
            if not srcs:
                print('determinism: no parts registry on the lab page')
                return 1
            for src in srcs:
                print('registry: %s (%s)' % (src, info['notes'].get(src, 'complete')))
                for project in [x for x in args.projects.split(',') if x]:
                    await check_project(page, src, project, failures)
                await check_prefill(page, src, info, failures)
                await check_mixed_em(page, src, failures)
            violations = await csp_violations(page)
            if violations:
                failures.append('CSP violations: %r' % violations)
            if page.lab_errors:
                failures.append('page errors: %r' % page.lab_errors[:10])
        finally:
            await browser.close()
    for msg in failures:
        print('  ' + msg)
    print('determinism.py: %s' % ('FAILED' if failures else 'OK'))
    return 1 if failures else 0


def main():
    ap = argparse.ArgumentParser(description='Frame determinism on the lab page.')
    ap.add_argument('--parts', default='', help='registry: catalog | examples | stub (default: catalog, then examples)')
    ap.add_argument('--projects', default='basic,vertical,lrc', help='fixture projects, comma-separated')
    return asyncio.run(run(ap.parse_args()))


if __name__ == '__main__':
    sys.exit(main())
