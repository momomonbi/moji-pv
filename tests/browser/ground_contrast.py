#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: backgrounds never fight the text (SPEC §6 backgrounds, DESIGN §5.5).

Every ground part is rendered through the real Canvas2D renderer (engine/facade.samplePlan with the text hidden, so only
the ground shows) in every theme, in 16:9 and 9:16, at three times of the sample segment. The frame is averaged in blocks
of about 32 du (what the eye reads behind a glyph), and each block's colour is compared with the theme's ink and accent:

- inside the safe area (5% of the short side in from every edge), the ink keeps WCAG contrast ≥ SAFE_MIN;
- in the middle of the frame, where lyrics usually sit (an ellipse of 0.36 w × 0.3 h radii, scaled by CENTRE), the ink keeps
  ≥ CENTRE_MIN and the accent (emphasized words) keeps ≥ ACCENT_SHARE of its own contrast with the theme's ground.

Also: no page errors, no part-error warnings, no CSP violations. Google Fonts are blocked (no text is drawn anyway).
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/ground_contrast.py [--keys a,b] [--themes a,b]
     [--aspects 16:9,9:16] [--report]   (--report prints the worst block of every ground × theme, pass or fail)
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contact_sheet import launch, open_lab, csp_violations  # noqa: E402  (the shared lab-page helpers)
from playwright.async_api import async_playwright  # noqa: E402

SAFE_MIN = 3.0        # WCAG AA for large text, anywhere text may stand
CENTRE_MIN = 4.5      # WCAG AA for normal text, behind the usual lyric position
ACCENT_SHARE = 0.6    # of the accent's own contrast with the plain ground
CENTRE = 0.6          # the centre ellipse, as a share of (0.36 w, 0.3 h)
TIMES = (0.15, 0.5, 0.85)
WIDTH = 480

MEASURE = """
async (o) => {
  const FAC = MV.use('engine/facade'), HC = MV.use('engine/host/canvas'), HM = MV.use('engine/host/measure');
  const REG = MV.use('core/registry'), C = MV.use('core/color'), cat = MV.use('parts/catalog');
  let reg;
  try { reg = cat.defaultRegistry(); } catch (e) {
    const defs = cat.defs(), have = new Set(defs.filter((d) => d.fallback).map((d) => d.kind));
    reg = REG.createRegistry(defs.concat(MVLabFixtures.stub.fallbackParts().filter((d) => !have.has(d.kind))), { strict: false });
  }
  const factory = HC.createCanvasFactory();
  const engine = FAC.createEngine({ registry: reg, canvas: factory, measurer: HM.createCanvasMeasurer(factory, null), fonts: null,
    assets: null });
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const keys = o.keys.length ? o.keys : reg.keys('ground');
  const themes = o.themes.length ? o.themes : reg.keys('theme');
  const out = [];
  for (const key of keys) for (const theme of themes) for (const aspect of o.aspects) {
    const plan = FAC.samplePlan(reg, { kind: 'ground', key }, { theme, aspect });
    for (const c of plan.cuts) c.els = { text: { hide: true } };
    engine.setPlan(plan);
    const pal = plan.look.palette, inkL = C.luminance(pal.ink), accL = C.luminance(pal.accent);
    const accentMin = o.accentShare * C.contrast(pal.accent, pal.ground);
    const k = o.width / Math.max(plan.design.w, plan.design.h);
    const w = Math.round(plan.design.w * k), h = Math.round(plan.design.h * k);
    const made = factory.create(w, h, { alpha: false });
    const surface = { canvas: made.canvas, ctx: made.ctx, w, h };
    const B = Math.max(4, Math.round(32 * k)), safe = 0.05 * plan.design.short * k;
    const rec = { key, theme, aspect, safe: Infinity, centre: Infinity, accent: Infinity, accentMin, errors: [] };
    for (const u of o.times) {
      try {
        engine.renderFrame(surface, plan.duration * u, { quality: 'export', pick: false, scale: k });
      } catch (e) { rec.errors.push(String(e && e.stack || e)); continue; }
      const px = surface.ctx.getImageData(0, 0, w, h).data;
      for (let y = Math.ceil(safe); y + B <= h - safe; y += B) {
        for (let x = Math.ceil(safe); x + B <= w - safe; x += B) {
          let r = 0, g = 0, b = 0;
          for (let j = 0; j < B; j++) for (let i = 0; i < B; i++) {
            const p = ((y + j) * w + x + i) * 4;
            r += px[p]; g += px[p + 1]; b += px[p + 2];
          }
          const n = B * B;
          const L = 0.2126 * lin(r / n) + 0.7152 * lin(g / n) + 0.0722 * lin(b / n);
          const ink = ratio(L, inkL);
          rec.safe = Math.min(rec.safe, ink);
          const e = Math.hypot((x + B / 2 - w / 2) / (0.36 * w), (y + B / 2 - h / 2) / (0.3 * h));
          if (e <= o.centre) { rec.centre = Math.min(rec.centre, ink); rec.accent = Math.min(rec.accent, ratio(L, accL)); }
        }
      }
    }
    for (const wn of engine.warnings()) if (wn.code === 'part-error') rec.errors.push(wn.detail || wn.code);
    out.push(rec);
  }
  return out;
}
"""


def parse_list(text):
    return [x.strip() for x in text.split(',') if x.strip()] if text else []


async def run(args):
    async with async_playwright() as p:
        browser = await launch(p)
        try:
            page = await open_lab(browser)
            recs = await page.evaluate(MEASURE, {'keys': parse_list(args.keys), 'themes': parse_list(args.themes),
                                                 'aspects': parse_list(args.aspects), 'times': list(TIMES), 'width': WIDTH,
                                                 'centre': CENTRE, 'accentShare': ACCENT_SHARE})
            failures = []
            for r in recs:
                bad = [m for m in r['errors']]
                if r['safe'] < SAFE_MIN:
                    bad.append('safe area ink contrast %.2f < %.1f' % (r['safe'], SAFE_MIN))
                if r['centre'] < CENTRE_MIN:
                    bad.append('centre ink contrast %.2f < %.1f' % (r['centre'], CENTRE_MIN))
                if r['accent'] < r['accentMin']:
                    bad.append('centre accent contrast %.2f < %.2f' % (r['accent'], r['accentMin']))
                line = '%-12s %-12s %-5s safe %5.2f  centre %5.2f  accent %5.2f (min %.2f)' % (
                    r['key'], r['theme'], r['aspect'], r['safe'], r['centre'], r['accent'], r['accentMin'])
                if bad:
                    failures.append(line + '  ← ' + '; '.join(bad))
                elif args.report:
                    print(line)
            problems = page.lab_errors + await csp_violations(page)
            for msg in failures + problems:
                print('FAIL ' + msg)
            grounds = sorted({r['key'] for r in recs})
            print('ground_contrast: %d renders of %d grounds, %d failing, %d page problems' % (
                len(recs) * len(TIMES), len(grounds), len(failures), len(problems)))
            return 1 if failures or problems or not recs else 0
        finally:
            await browser.close()


def main(argv=None):
    ap = argparse.ArgumentParser(description='Check that every ground keeps the text readable in every theme.')
    ap.add_argument('--keys', default='', help='ground keys (default: all)')
    ap.add_argument('--themes', default='', help='theme keys (default: all)')
    ap.add_argument('--aspects', default='16:9,9:16')
    ap.add_argument('--report', action='store_true', help='print every ground × theme, not only failures')
    return asyncio.run(run(ap.parse_args(argv)))


if __name__ == '__main__':
    sys.exit(main())
