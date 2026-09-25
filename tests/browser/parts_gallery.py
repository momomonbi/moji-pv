#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: every registered part × every aspect renders on the lab page (DESIGN §8.3).

Each part is shown in the canned sample cut of engine/facade.samplePlan (the part in its slot, fallbacks elsewhere) at two
normalized times of its own window, at a small size, through the real Canvas2D renderer. Checks per render: no page error,
no console error, no 'part-error' warning; per part and aspect, a frame that is not blank (luminance variance > EPS) at
one of the times at least (an exit may rightly have cleared the frame near its end). The whole page must also report 0
securitypolicyviolation events. Registries: parts/catalog when it exists, the DESIGN §4.18 examples and the
stub parts (tests/fixtures). Google Fonts are blocked, so fallback faces draw.
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/parts_gallery.py [--parts examples] [--aspects 16:9,9:16]
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contact_sheet import launch, open_lab, csp_violations  # noqa: E402  (the shared lab-page helpers)
from playwright.async_api import async_playwright  # noqa: E402

EPS = 1.0            # luminance variance (0..255 scale) below this counts as a blank frame
TIMES = (0.2, 0.7)
WIDTH = 256

# One in-page loop per registry: fewer round trips, same checks.
RENDER_ALL = """
async (o) => {
  const out = [];
  for (const job of o.jobs) {
    const [w, h] = job.aspect.split(':').map(Number);
    const size = w >= h ? [o.width, Math.round(o.width * h / w)] : [Math.round(o.width * w / h), o.width];
    for (const u of o.times) {
      try {
        const r = await window.__lab.render({ parts: o.parts, kind: job.kind, key: job.key, aspect: job.aspect, u, w: size[0], h: size[1] });
        const bad = r.warnings.filter((w) => w.code === 'part-error').map((w) => w.detail || w.code);
        out.push({ kind: job.kind, key: job.key, aspect: job.aspect, u, variance: r.variance, glyphs: r.stats.drawn.glyphs, bad });
      } catch (e) {
        out.push({ kind: job.kind, key: job.key, aspect: job.aspect, u, error: String(e && e.stack || e) });
      }
    }
  }
  return out;
}
"""


async def run(args):
    failures = []
    async with async_playwright() as p:
        browser = await launch(p)
        try:
            page = await open_lab(browser)
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
                bad = 0
                shown = {}
                for r in results:
                    where = '%s %s/%s %s u=%.1f' % (src, r['kind'], r['key'], r['aspect'], r['u'])
                    case = (r['kind'], r['key'], r['aspect'])
                    shown.setdefault(case, 0)
                    if 'error' in r:
                        failures.append(where + ': ' + r['error'].splitlines()[0])
                    elif r['bad']:
                        failures.append(where + ': part-error ' + '; '.join(r['bad']))
                    else:
                        shown[case] += 1 if r['variance'] > EPS else 0
                        continue
                    bad += 1
                for (kind, key, aspect), n in shown.items():
                    if n == 0:
                        failures.append('%s %s/%s %s: blank frame at every time' % (src, kind, key, aspect))
                        bad += 1
                parts = sum(len(v) for v in info['parts'][src].values())
                print('%s %s: %d parts × %d aspects × %d times = %d renders' %
                      ('FAIL' if bad else 'ok  ', src, parts, len(aspects), len(TIMES), len(results)))
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
