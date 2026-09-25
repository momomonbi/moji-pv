#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: every registered part × every aspect renders on the lab page (DESIGN §8.3).

Each part is shown in the canned sample cut of engine/facade.samplePlan (the part in its slot, fallbacks elsewhere) at two
normalized times of its own window, at a small size, through the real Canvas2D renderer. Checks per render: no page error,
no console error, no 'part-error' warning; per part and aspect, a frame that is not blank (luminance variance > EPS) at
one of the times at least (an exit may rightly have cleared the frame near its end). The whole page must also report 0
securitypolicyviolation events. Registries: parts/catalog when it exists, the DESIGN §4.18 examples and the
stub parts (tests/fixtures). Google Fonts are blocked, so fallback faces draw: the system needs a Japanese font, or the
test stops at once with one message saying so (dev/browser.py japanese_font_missing).
DESIGN_2_1 additions: every shot and rig preset of core/shot in every aspect, rendered in the canned cut at the same two
times and as the picker thumbnail (engine.thumb), with the same checks; and the media mode: every part with a media
param (the fake store's test parts, and the catalog's media parts: photoPan, photoFrame, textFill and mediaLayer, which
must all be there) × every aspect × a still and a video fixture of tests/helpers/fake_media.js, in export quality (not
blank, no errors, the medium drawn).
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/parts_gallery.py [--parts examples] [--aspects 16:9,9:16]
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contact_sheet import launch, open_lab, csp_violations, japanese_font_missing  # noqa: E402  (lab-page helpers)
from playwright.async_api import async_playwright  # noqa: E402

EPS = 1.0            # luminance variance (0..255 scale) below this counts as a blank frame
TIMES = (0.2, 0.7)
WIDTH = 256
MEDIA_ASSETS = ('fixture:jpeg', 'fixture:mp4')       # a still and a video; overlay footage takes the video only
CATALOG_MEDIA = {('ground', 'photoPan'), ('ornament', 'photoFrame'), ('ornament', 'textFill'), ('ornament', 'mediaLayer')}

# One in-page loop per registry: fewer round trips, same checks.
RENDER_ALL = """
async (o) => {
  const out = [];
  for (const job of o.jobs) {
    const [w, h] = job.aspect.split(':').map(Number);
    const size = w >= h ? [o.width, Math.round(o.width * h / w)] : [Math.round(o.width * w / h), o.width];
    for (const u of o.times) {
      try {
        const r = await window.__lab.render({ parts: o.parts, kind: job.kind, key: job.key, aspect: job.aspect, u, w: size[0], h: size[1],
          asset: job.asset, quality: job.asset ? 'export' : undefined });
        const bad = r.warnings.filter((w) => w.code === 'part-error').map((w) => w.detail || w.code);
        const nan = ['x', 'y', 'zoom', 'roll'].some((k) => !Number.isFinite(r.view[k]));
        out.push({ kind: job.kind, key: job.key, aspect: job.aspect, asset: job.asset || '', u, variance: r.variance,
          glyphs: r.stats.drawn.glyphs, media: r.stats.media ? r.stats.media.drawn : 0, listed: r.media.length, nan, bad });
      } catch (e) {
        out.push({ kind: job.kind, key: job.key, aspect: job.aspect, asset: job.asset || '', u, error: String(e && e.stack || e) });
      }
    }
  }
  return out;
}
"""

# The picker tiles of the camera presets: engine.thumb with kind 'shot' / 'rig'.
THUMB_ALL = """
async (o) => {
  const out = [];
  for (const job of o.jobs) {
    const [w, h] = job.aspect.split(':').map(Number);
    const size = w >= h ? [o.width, Math.round(o.width * h / w)] : [Math.round(o.width * w / h), o.width];
    try {
      const r = window.__lab.thumb({ parts: o.parts, kind: job.kind, key: job.key, aspect: job.aspect, w: size[0], h: size[1] });
      out.push({ kind: job.kind, key: job.key, aspect: job.aspect, variance: r.variance, glyphs: r.stats.drawn.glyphs });
    } catch (e) {
      out.push({ kind: job.kind, key: job.key, aspect: job.aspect, error: String(e && e.stack || e) });
    }
  }
  return out;
}
"""


def check_results(results, src, failures, media=False):
    """Per render: no error, no part-error, a finite camera; per case: not blank at one time at least (media: the
    medium drawn and listed by mediaAt). Returns the number of bad cases."""
    bad = 0
    shown = {}
    for r in results:
        where = '%s %s/%s %s%s u=%.1f' % (src, r['kind'], r['key'], r['aspect'], (' ' + r['asset']) if r.get('asset') else '', r['u'])
        case = (r['kind'], r['key'], r['aspect'], r.get('asset', ''))
        shown.setdefault(case, 0)
        if 'error' in r:
            failures.append(where + ': ' + r['error'].splitlines()[0])
        elif r['bad']:
            failures.append(where + ': part-error ' + '; '.join(r['bad']))
        elif r['nan']:
            failures.append(where + ': the camera is not finite')
        elif media and (r['media'] < 1 or r['listed'] < 1):
            failures.append(where + ': the medium is not drawn (%d drawn, %d listed by mediaAt)' % (r['media'], r['listed']))
        else:
            shown[case] += 1 if r['variance'] > EPS else 0
            continue
        bad += 1
    for (kind, key, aspect, asset), n in shown.items():
        if n == 0:
            failures.append('%s %s/%s %s%s: blank frame at every time' % (src, kind, key, aspect, (' ' + asset) if asset else ''))
            bad += 1
    return bad


async def run(args):
    failures = []
    async with async_playwright() as p:
        browser = await launch(p)
        try:
            page = await open_lab(browser)
            if await japanese_font_missing(page, 'parts_gallery.py'):
                return 1
            info = await page.evaluate('window.__lab.info()')
            sources = [s for s in info['sources'] if not args.parts or s == args.parts]
            if not sources:
                print('parts_gallery: no parts registry on the lab page')
                return 1
            aspects = [a for a in (args.aspects.split(',') if args.aspects else info['aspects']) if a]
            for src in sources:
                if src in info['notes']:
                    print('note (%s): %s' % (src, info['notes'][src]))
                jobs = [{'kind': kind, 'key': key, 'aspect': aspect}
                        for kind, keys in info['parts'][src].items() for key in keys for aspect in aspects]
                results = await page.evaluate(RENDER_ALL, {'jobs': jobs, 'parts': src, 'times': list(TIMES), 'width': WIDTH})
                bad = check_results(results, src, failures)
                parts = sum(len(v) for v in info['parts'][src].values())
                print('%s %s: %d parts × %d aspects × %d times = %d renders' %
                      ('FAIL' if bad else 'ok  ', src, parts, len(aspects), len(TIMES), len(results)))
            # the camera presets (DESIGN_2_1 §3.10) with the first registry's fallback parts
            src = sources[0]
            cam = [{'kind': kind, 'key': key, 'aspect': aspect}
                   for kind in ('shot', 'rig') for key in info['camera'][kind] for aspect in aspects]
            results = await page.evaluate(RENDER_ALL, {'jobs': cam, 'parts': src, 'times': list(TIMES), 'width': WIDTH})
            bad = check_results(results, src, failures)
            print('%s %s camera: %d shots + %d rigs × %d aspects × %d times = %d renders' %
                  ('FAIL' if bad else 'ok  ', src, len(info['camera']['shot']), len(info['camera']['rig']), len(aspects),
                   len(TIMES), len(results)))
            thumbs = await page.evaluate(THUMB_ALL, {'jobs': cam, 'parts': src, 'width': 160})
            bad = 0
            for r in thumbs:
                where = '%s %s/%s %s thumb' % (src, r['kind'], r['key'], r['aspect'])
                if 'error' in r:
                    failures.append(where + ': ' + r['error'].splitlines()[0])
                    bad += 1
                elif not r['variance'] > EPS or r['glyphs'] < 1:
                    failures.append(where + ': blank tile (variance %.2f, %d glyphs)' % (r['variance'], r['glyphs']))
                    bad += 1
            print('%s %s camera thumbnails: %d tiles' % ('FAIL' if bad else 'ok  ', src, len(thumbs)))
            # the media mode (DESIGN_2_1 §11.8.2): parts with a media param × aspects × a still and a video
            media = info.get('media')
            if not media:
                failures.append('the lab page has no media fixtures (tests/helpers/fake_media.js)')
            else:
                found = media['parts'].get(src, [])
                if not found:
                    failures.append('%s: no part with a media param (the fake store\'s test parts are missing)' % src)
                missing = CATALOG_MEDIA - {(m['kind'], m['key']) for m in found} if src == 'catalog' else set()
                if missing:
                    failures.append('catalog: the media parts %s have no media param' % sorted(missing))
                jobs = [{'kind': m['kind'], 'key': m['key'], 'aspect': aspect, 'asset': asset}
                        for m in found for aspect in aspects for asset in MEDIA_ASSETS
                        if m['accept'] != 'image' or asset != 'fixture:mp4'
                        if m['accept'] != 'video' or asset != 'fixture:jpeg']
                results = await page.evaluate(RENDER_ALL, {'jobs': jobs, 'parts': src, 'times': list(TIMES), 'width': WIDTH})
                bad = check_results(results, src, failures, media=True)
                print('%s %s media: %d parts × %d aspects × %d assets × %d times = %d renders' %
                      ('FAIL' if bad else 'ok  ', src, len(found), len(aspects), len(MEDIA_ASSETS), len(TIMES), len(results)))
            violations = await csp_violations(page)
            if violations:
                failures.append('CSP violations: %r' % violations)
            if page.lab_errors:
                failures.append('page errors: %r' % page.lab_errors[:10])
        finally:
            await browser.close()
    for msg in failures[:60]:
        print('  ' + msg)
    if len(failures) > 60:
        print('  … and %d more' % (len(failures) - 60))
    print('parts_gallery.py: %s' % ('FAILED' if failures else 'OK (0 CSP violations, no page errors)'))
    return 1 if failures else 0


def main():
    ap = argparse.ArgumentParser(description='Render every part in every aspect on the lab page.')
    ap.add_argument('--parts', default='', help='only this registry: catalog | examples | stub')
    ap.add_argument('--aspects', default='', help='comma-separated aspects (default: all seven)')
    return asyncio.run(run(ap.parse_args()))


if __name__ == '__main__':
    sys.exit(main())
