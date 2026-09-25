#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: glyph parity of the direct and sprite paths, blur crossfade continuity (§4.19.5).

1. Parity (FROZEN requirement): 20 glyphs (kana, kanji, Latin) in the sample cut at 1080p, drawn once with every glyph on
   the direct path and once on the level-0 sprite path at the same transforms: mean absolute error over the text block
   ≤ 2/255. A vertical column with rotated glyphs (「」ー, a Latin run, tate-chu-yoko digits) is checked as well; its
   rasters are resampled on both axes after the turn, so it gets a slightly wider bound (2.5/255), reported next to it.
2. Continuity: the same text with blur (du, on every glyph) swept from 0 to 4.5 in 0.05 steps. The step that crosses
   the direct → sprite switch (0.05 du) may change the block by at most the parity bound plus a normal step, and no
   step at the level boundaries (2, 4 du) may jump: each step ≤ 3 × the median step + 0.25/255.
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
