#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: glyph parity of the direct and sprite paths, blur crossfade continuity (§4.19.5).

1. Parity (FROZEN requirement): 20 glyphs (kana, kanji, Latin) in the sample cut at 1080p, drawn once with every glyph on
   the direct path and once on the level-0 sprite path at the same transforms: mean absolute error over the text block
   ≤ 2/255. A vertical column with rotated glyphs (「」ー, a Latin run, tate-chu-yoko digits) is checked as well; its
   rasters are resampled on both axes after the turn, so it gets a slightly wider bound (2.5/255), reported next to it.
2. Continuity: the same text with blur (du, on every glyph) swept from 0 to 4.5 in 0.05 steps. The step that crosses
   the direct → sprite switch (0.05 du) may change the block by at most the parity bound plus a normal step, and no
   step at the level boundaries (2, 4 du) may jump: each step ≤ 3 × the median step + 0.25/255.
3. Ink rects (NOTES "Perf: camerawork + materials row"): the rasters of kana, kanji, Latin, brackets, the long mark,
   tate-chu-yoko pairs and emoji (a ZWJ family too) × the 5 text styles × 3 sizes × levels 0–5 made on the host factory
   (which measures ink) equal those made without it, texel for texel, and hold no alpha outside their ink rect: the
   clip that draw.spriteAt puts round the rect cannot cut anything drawn.
4. Frames with the ink clips against the same frames without (lab switch inkClip: false), at export quality: the
   perf.py camerawork + materials window at 720p (the sample and the heaviest materials) and basic, vertical, lrc, long
   and v21 at 640 px, and the sample cut with blur, glow, shards and the mosaic (preview probes) at 360p and 1080p:
   every pixel equal.
5. The glyph cost model of DESIGN_2_1 §5.9.5 (draw.glyphCover) covers what is drawn: over the perf.py camerawork +
   materials window at 720p (the sample and the heaviest materials), for every frame the model's cover of the cuts on
   screen (at their own camera) is at least the frame share the sprite draws cover (the lab's sprite meter). The ink the
   model takes (draw.inkEm: 0.66 em either side of the centre, more for the outline, shadow and duo styles, + 2 px at
   720p) holds every level-0 ink rect of check 3, so a direct-path glyph, which the meter does not see, is covered too.
Registries: the catalog (what ships) and the examples, when the page has them; --parts picks one.
Google Fonts are blocked (fallback faces), so the result does not depend on the network.
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/glyph_parity.py [--parts catalog]
"""
import argparse
import asyncio
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contact_sheet import launch, open_lab, csp_violations, japanese_font_missing  # noqa: E402  (lab-page helpers)
from playwright.async_api import async_playwright  # noqa: E402

PARITY_MAX = 2 / 255
PARITY_VERTICAL_MAX = 2.5 / 255
VERTICAL_TEXT = '「夜明け」ーの街を走るRoad光と君の声が届く12'
SPIKE = 3.0
SPIKE_FLOOR = 0.25 / 255
INK_CHARS = ['空', 'あ', '夜', '明', '街', '光', '「', 'ー', '〜', 'W', 'g', 'j', 'Q', 'R', '12', '!?', '😀', '👨\u200d👩\u200d👧']
INK_STYLES = ['plain', 'outline', 'shadow', 'glow', 'duo']
INK_SIZES = [24, 96, 480]


def sources_of(info, wanted):
    """The registries to check: --parts, else the catalog (what ships) and the examples, when the page has them."""
    if wanted:
        return [wanted]
    return [s for s in ('catalog', 'examples') if s in info['sources']] or info['sources'][:1]


def vertical_case(info, src):
    """The vertical column's host: the example pillarColumns when the registry has it, else the registry's own
    composition for vertical text (the sample plan picks one that serves orient v)."""
    keys = info['parts'][src].get('arrange', [])
    if 'pillarColumns' in keys:
        return {'kind': 'arrange', 'key': 'pillarColumns', 'label': 'pillarColumns'}
    return {'orient': 'v', 'label': 'orient v'}


async def check_source(page, info, src, failures):
    r = await page.evaluate('(s) => window.__lab.parity({ parts: s, short: 1080 })', src)
    ok = r['mae'] <= PARITY_MAX and r['glyphs'] >= 20 and r['spriteGlyphs'] == r['glyphs']
    print('%s %s horizontal parity at 1080p: MAE %.3f/255 (max %.0f/255) over %d glyphs (limit 2/255)' %
          ('ok  ' if ok else 'FAIL', src, r['mae'] * 255, r['max'] * 255, r['glyphs']))
    if not ok:
        failures.append('%s horizontal parity: %r' % (src, r))

    case = vertical_case(info, src)
    label = case.pop('label')
    v = await page.evaluate('(o) => window.__lab.parity(o)', dict(case, parts=src, aspect='9:16', text=VERTICAL_TEXT, short=1080))
    ok = v['mae'] <= PARITY_VERTICAL_MAX and v['glyphs'] >= 20
    print('%s %s vertical parity at 1080p (%s): MAE %.3f/255 over %d glyphs (limit 2.5/255)' %
          ('ok  ' if ok else 'FAIL', src, label, v['mae'] * 255, v['glyphs']))
    if not ok:
        failures.append('%s vertical parity: %r' % (src, v))

    sweep = await page.evaluate('(s) => window.__lab.blurSweep({ parts: s, from: 0, to: 4.5, step: 0.05 })', src)
    steps = sweep['steps'][1:]
    diffs = [s['diff'] for s in steps]
    median = statistics.median(diffs)
    switch = steps[0]
    limit_switch = PARITY_MAX + median
    print('%s %s blur switch 0 → %.2f du: change %.3f/255 (limit %.3f/255)' %
          ('ok  ' if switch['diff'] <= limit_switch else 'FAIL', src, switch['blur'], switch['diff'] * 255, limit_switch * 255))
    if switch['diff'] > limit_switch:
        failures.append('%s: the direct → sprite switch jumps: %.3f/255' % (src, switch['diff'] * 255))
    spikes = [s for s in steps[1:] if s['diff'] > SPIKE * median + SPIKE_FLOOR]
    print('%s %s blur crossfade 0.05 → 4.5 du: median step %.3f/255, largest %.3f/255' %
          ('ok  ' if not spikes else 'FAIL', src, median * 255, max(diffs[1:]) * 255))
    for s in spikes:
        failures.append('%s: blur step to %.2f du jumps: %.3f/255' % (src, s['blur'], s['diff'] * 255))


def times(a, b, n):
    return [a + (b - a) * i / (n - 1) for i in range(n)]


async def check_ink(page, failures):
    """Checks 3, 4 and 5: ink rects hold every drawn texel; ink clips change no pixel; the cost model covers the draws."""
    r = await page.evaluate('(o) => window.__lab.spriteCheck(o)', {'chars': INK_CHARS, 'styles': INK_STYLES, 'sizes': INK_SIZES,
                                                                    'levels': [0, 1, 2, 3, 4, 5]})
    ok = r['outside'] == 0 and r['texel'] == 0 and r['clipped'] > r['cases'] // 2
    print('%s ink rects: %d of %d rasters have one, alpha outside %d, texel difference %d/255; the rects hold %.0f %% of '
          'the raster px' % ('ok  ' if ok else 'FAIL', r['clipped'], r['cases'], r['outside'], r['texel'],
                            100 * r['clip'] / max(1, r['area'])))
    if not ok:
        failures.append('ink rects: %r' % r)
    # the §5.9.5 model takes a glyph's ink as draw.inkEm(style) em either side of its centre (+ 2 px at 720p): every
    # level-0 ink rect (the measured ink and its 2 px) must lie within it
    held = r['beyond'] <= 0
    print("%s the §5.9.5 model's ink holds every ink rect: they reach %.3f em from the centre; the most past the model "
          "%.1f px (%s)" % ('ok  ' if held else 'FAIL', r['reach'], r['beyond'], r['reachAt']))
    if not held:
        failures.append('an ink rect reaches past the §5.9.5 model\'s ink: %r' % r['reachAt'])
    window = {'project': 'long', 'camera': True, 'materials': True, 'parts': 'materials', 'times': times(20, 30, 31), 'w': 1280,
              'prepare': True}
    cases = [('perf window', window), ('perf window, heaviest', dict(window, recipes='heaviest'))]
    for project, span in (('basic', (1, 20)), ('vertical', (1, 20)), ('lrc', (1, 20)), ('long', (1, 60)), ('v21', (10, 20))):
        cases.append((project, {'project': project, 'times': times(span[0], span[1], 24)}))
    for name, o in cases:
        rows = await page.evaluate('(o) => window.__lab.compare(o)', dict(o, a={}, b={'inkClip': False}))
        worst = max(x['max'] for x in rows)
        most = max(x['n'] for x in rows)
        print('%s %s: %d frames with and without ink clips: max %d/255, at most %d px differ in a frame' % (
            'FAIL' if worst else 'ok  ', name, len(rows), worst, most))
        if worst:
            failures.append('%s: ink clips change the frame: max %d/255 on %d px' % (name, worst, most))
    for probe in ({'blur': 3, 'shard': 0.4}, {'blur': 3, 'pixel': 6}, {'blur': 9, 'glow': 0.6}, {'blur': 0.5, 'glow': 0.6}, {'glow': 0.4}):
        for short in (360, 1080):
            w = short * 16 // 9
            r = await page.evaluate('(o) => window.__lab.comparePart(o)', {'probe': probe, 'quality': 'preview', 'level': 0,
                                                                          'w': w, 'h': short, 'a': {}, 'b': {'inkClip': False}})
            bad = r['max'] > 0 or r['glyphs'] < 5
            print('%s probe %s at %dp: max %d/255 on %d px' % ('FAIL' if bad else 'ok  ', probe, short, r['max'], r['n']))
            if bad:
                failures.append('probe %r at %dp: %r' % (probe, short, r))
    for name, recipes in (('samples', None), ('heaviest', 'heaviest')):
        o = {'parts': 'materials', 'project': 'long', 'seconds': 10, 'fps': 30, 'short': 720, 'start': 20.0, 'camera': True,
             'materials': True, 'meter': True}
        if recipes:
            o['recipes'] = recipes
        got = await page.evaluate('(o) => window.__lab.perf(o)', o)
        under = [(20 + i / 30, c[0], c[2]) for i, c in enumerate(got['cover']) if c[2] < c[0] - 1e-9]
        drawn = max(c[0] for c in got['cover'])
        ratio = min((c[2] / c[0] for c in got['cover'] if c[0] > 0.05), default=0)
        print('%s the §5.9.5 model covers the sprite draws (%s): largest drawn %.2f frames, model/drawn at least %.2f; '
              '%d frames under' % ('FAIL' if under else 'ok  ', name, drawn, ratio, len(under)))
        if under:
            failures.append('the glyph cost model is below what is drawn (%s): %r' % (name, under[:5]))


async def run(args):
    failures = []
    async with async_playwright() as p:
        browser = await launch(p)
        try:
            page = await open_lab(browser)
            if await japanese_font_missing(page, 'glyph_parity.py'):
                return 1
            info = await page.evaluate('window.__lab.info()')
            srcs = sources_of(info, args.parts)
            if not srcs:
                print('glyph_parity: no parts registry on the lab page')
                return 1
            for src in srcs:
                await check_source(page, info, src, failures)
            if 'materials' in info['sources']:
                await check_ink(page, failures)
            violations = await csp_violations(page)
            if violations:
                failures.append('CSP violations: %r' % violations)
            if page.lab_errors:
                failures.append('page errors: %r' % page.lab_errors[:10])
        finally:
            await browser.close()
    for msg in failures:
        print('  ' + msg)
    print('glyph_parity.py: %s' % ('FAILED' if failures else 'OK'))
    return 1 if failures else 0


def main():
    ap = argparse.ArgumentParser(description='Glyph path parity and blur continuity on the lab page.')
    ap.add_argument('--parts', default='', help='registry: catalog | examples | stub (default: catalog, then examples)')
    return asyncio.run(run(ap.parse_args()))


if __name__ == '__main__':
    sys.exit(main())
