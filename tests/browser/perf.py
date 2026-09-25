#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: frame times of the fixture projects at 720p (DESIGN §7.4, §8.3).

Each fixture project is rendered for 10 s of its timeline at 30 fps at 720p (short side 720) through the real engine on
the lab page (full quality, as an export would; each frame is followed by a 1-pixel read so the canvas work is inside
the measurement). Reports p50 / p95 / max frame time and the mean behave / draw / post split. It fails only above twice
the budget: p50 > 20 ms (2 × the 10 ms target) or p95 > 33.4 ms (2 × the 16.7 ms hard limit). Shared CPUs and a
software-rendered headless browser make these numbers pessimistic; CI with Google Chrome gives the gate. Each
project is played twice, each time on a fresh engine whose scenes and sprites start cold (--runs), and the run with the
lower p95 is judged, which discounts time other processes took from the shared CPUs (INT-LEAD: long's p95 spread 30–35 ms
between identical single runs here); a slow draw path is slow in both runs.
DESIGN_2_1 §7.4 (+): project_long with the automatic camerawork (the planner's shots, under a pinned rig because the
project's own rig runs draw none) plus a material in every slot it fits (registry 'materials'): the heaviest glyph work
§5.8 admits for the entrance, the hold and the exit (the lab's HEAVIEST: blur 0.6 em, glow 1 and tint 1 at once, size
tracks, a turn and an inner part that adds an echo, a tint sweep or a glow), the sample material of every other kind.
The behave stage (evaluation and world solve) must stay ≤ 0.8 ms p50 at 720p and the frame within twice the budget.
Material particles are drawn by paints, so their budget is read from the chosen definitions (Σ mine.cost.particles,
scaled by env.mixShare to ≤ 400), not from FrameStats.drawn.particles. The glyph budget (§5.9.5) is read from the scenes:
no material phase may add more than its share of glyph cover while a mask is left to put on.
DESIGN_2_1 §11.8.3 (+): project_basic with a 1080p30 video ground (VP9, clock song, depth auto: 'back', so the
video is blurred) and a still photoFrame (a 1600×1200 JPEG), 10 s at 30 fps at 720p, in the built app page with the real
AssetStore (tests/www/media_parts.js). The timed frame is the whole iteration a player or an exporter runs: `await
mediaReady(t)` (the store's main-thread work for that frame: decoder output, the blur bakes) + renderFrame + a 1-pixel
read; the ready / render split and the store's decodeMs / prepMs per frame are printed. Budgets: frame ≤ 10 ms p50,
drawMedia ≤ 1 ms p50 per call, judged, like the rows above, at twice the budget. drawMedia is judged per medium (the
video calls and the still calls each), not pooled: pooled, the photo frame's calls outnumber the video's and set the
median alone. It is timed unflushed: the call's own main-thread work (recording, and any synchronous work such as a
VideoFrame's colour conversion or a forced raster, ≈ 9 ms for an unbaked 1080p frame), which is what the call costs a
browser that rasterizes elsewhere (GPU). The raster itself is inside the frame total. A separate flushed pass times
each drawMedia call from a 1-px read of its target to another (deferred raster charged to the call), per medium, with
the draws per call against the §11.5.12 "≤ 2 extra draws" row: printed for NOTES and marked OVER when above twice the
budget; with software raster any scaled full-frame draw costs ≈ 2.6–3 ms whatever its source, so it is not gated
here (whether to gate it, and on which hardware, is the lead's decision). The row also asserts that the ground's
effective depth is 'back' with a blur, that every frame of it came with its blur baked (MediaFrame.blur > 0), and that
no frame fell back to the
per-frame blur (FrameStats.media.fallback 0 in export quality); project_basic without the media runs in the same page
as the baseline. --media-rows also measures the other §11.5.12 rows once (NOTES): a still and a video ground alone, the
isolated path (a PNG with alpha), the WebM alpha merge of a 1080p frame, scrubbing a 1080p clip with 2-s key frames,
and the export overhead of a 1080p30 video background.
The GitHub CI runner (ubuntu-latest, Google Chrome, software raster, no GPU) is the twice-the-budget gate; it is not
the reference machine. The reference is the mid-range laptop of DESIGN_2_1 §8.7 / §11.5.12.
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/perf.py [--seconds 10] [--projects basic,long]
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contact_sheet import launch, open_lab, japanese_font_missing  # noqa: E402  (the shared lab-page helpers)
from media_page import open_media_page  # noqa: E402  (the built app page with tests/www/media_parts.js)
from playwright.async_api import async_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

TARGET_MS, HARD_MS = 10.0, 16.7
START = {'basic': 2.0, 'vertical': 1.0, 'lrc': 2.0, 'long': 20.0}
BEHAVE_MS = 0.8          # DESIGN_2_1 §7.2: behave + solve p50 at 720p with camerawork and materials
PARTICLES = 400          # D§7.4 draw budget, kept by env.mixShare (DESIGN_2_1 §5.9.4)
DRAW_MEDIA_MS = 1.0      # DESIGN_2_1 §11.8.3: drawMedia p50 per call at 720p


async def run(args):
    failures = []
    async with async_playwright() as p:
        browser = await launch(p)
        try:
            page = await open_lab(browser)
            if await japanese_font_missing(page, 'perf.py'):
                return 1
            info = await page.evaluate('window.__lab.info()')
            src = args.parts or ('catalog' if 'catalog' in info['sources'] else 'examples')
            print('registry: %s (%s)' % (src, info['notes'].get(src, 'complete')))
            for project in [x for x in args.projects.split(',') if x]:
                # Every run is a fresh engine (its scenes and sprites start cold), so the better run is the one the
                # other processes on the shared CPUs disturbed least; a slow path is slow in every run.
                runs = []
                for _ in range(max(1, args.runs)):
                    runs.append(await page.evaluate('(o) => window.__lab.perf(o)', {
                        'parts': src, 'project': project, 'seconds': args.seconds, 'fps': 30, 'short': 720,
                        'start': START.get(project, 0)}))
                runs.sort(key=lambda x: x['p95'])
                r = runs[0]
                bad = r['p50'] > 2 * TARGET_MS or r['p95'] > 2 * HARD_MS
                st = r['stages']
                others = ', '.join('%.2f' % x['p95'] for x in runs[1:])
                print('%s %-8s %dx%d, %d frames: p50 %.2f ms, p95 %.2f ms, max %.2f ms (behave %.2f, draw %.2f, post %.2f)%s' % (
                    'FAIL' if bad else 'ok  ', project, r['w'], r['h'], r['frames'], r['p50'], r['p95'], r['max'],
                    st['behave'], st['draw'], st['post'], ('; other runs p95 ' + others) if others else ''))
                if bad:
                    failures.append('%s: p50 %.2f ms / p95 %.2f ms is above twice the budget' % (project, r['p50'], r['p95']))
            if args.camera:
                await check_camerawork(page, info, args, failures)
            if page.lab_errors:
                failures.append('page errors: %r' % page.lab_errors[:10])
            if args.media:
                await check_media(browser, args, failures)
        finally:
            await browser.close()
    for msg in failures:
        print('  ' + msg)
    print('perf.py: %s' % ('FAILED' if failures else 'OK (within twice the §7.4 budget)'))
    return 1 if failures else 0


async def check_camerawork(page, info, args, failures):
    """project_long with the automatic camerawork, a rig and a material in every slot, the heaviest text ones
    (DESIGN_2_1 §7.4)."""
    src = 'materials' if 'materials' in info['sources'] else ('catalog' if 'catalog' in info['sources'] else None)
    if src is None:
        print('SKIP  camerawork: no catalog on the lab page')
        return
    runs = []
    for _ in range(max(3, args.runs)):          # the heaviest row: one more fresh run against the shared-CPU noise
        runs.append(await page.evaluate('(o) => window.__lab.perf(o)', {
            'parts': src, 'project': 'long', 'seconds': args.seconds, 'fps': 30, 'short': 720, 'start': START['long'],
            'camera': True, 'materials': src == 'materials', 'recipes': 'heaviest' if src == 'materials' else None}))
    # as above: the run the other processes disturbed least (lowest p95) is judged
    runs.sort(key=lambda x: x['p95'])
    r = runs[0]
    bad = []
    if r['behaveP50'] > BEHAVE_MS:
        bad.append('behave p50 %.2f ms > %.1f ms' % (r['behaveP50'], BEHAVE_MS))
    if r['p50'] > 2 * TARGET_MS or r['p95'] > 2 * HARD_MS:
        bad.append('p50 %.2f ms / p95 %.2f ms is above twice the budget' % (r['p50'], r['p95']))
    if r['shots'] < 1 or r['rigs'] < 1:
        bad.append('no camerawork was drawn (%d shots, %d rig runs)' % (r['shots'], r['rigs']))
    if r['particles'] * r['mixShare'] > PARTICLES + 1e-6:
        bad.append('material particles %.0f × share %.3f exceed %d' % (r['particles'], r['mixShare'], PARTICLES))
    gb = r['budget']
    if src == 'materials' and (gb['phases'] < 1 or gb['masked'] < 1):
        bad.append('the glyph budget was not exercised (%d material phases, %d masked)' % (gb['phases'], gb['masked']))
    if gb['over'] > 0:
        bad.append('%d material phases add more than %.1f frames of glyph cover' % (gb['over'], gb['share']))
    st = r['stages']
    print('%s long+camera%s %dx%d, %d frames: behave p50 %.2f ms (mean %.2f), frame p50 %.2f ms, p95 %.2f ms, max %.2f ms; '
          '%d shots, %d rig runs, material particles %.0f × %.2f; glyph budget: %d phases, %d masked, largest %.2f of %.1f' % (
              'FAIL' if bad else 'ok  ', '+materials' if src == 'materials' else '', r['w'], r['h'], r['frames'],
              r['behaveP50'], st['behave'], r['p50'], r['p95'], r['max'], r['shots'], r['rigs'], r['particles'],
              r['mixShare'], gb['phases'], gb['masked'], gb['fitted'], gb['share']))
    failures.extend('long+camera: ' + b for b in bad)


async def check_media(browser, args, failures):
    """project_basic with a 1080p30 video ground and a still photo frame, in the built app page (DESIGN_2_1 §11.8.3)."""
    project = (ROOT / 'tests' / 'fixtures' / 'project_basic.json').read_text(encoding='utf-8')
    mp = await open_media_page(browser)
    try:
        r = await mp.page.evaluate('(o) => window.__mediaParts.perf(o)', {
            'project': project, 'seconds': args.seconds, 'start': START['basic'], 'runs': max(1, args.runs), 'rows': args.media_rows})
        csp = await mp.csp()
    finally:
        await mp.close()
    m, dm = r['main'], r['main']['drawMedia']
    bad = []
    if m['p50'] > 2 * TARGET_MS or m['p95'] > 2 * HARD_MS:
        bad.append('p50 %.2f ms / p95 %.2f ms (whole iteration) is above twice the budget' % (m['p50'], m['p95']))
    for kind in ('video', 'still'):
        if dm[kind]['calls'] < 1 or dm[kind]['p50'] > 2 * DRAW_MEDIA_MS:
            bad.append('drawMedia (%s, unflushed) p50 %.3f ms over %d calls is above twice the %.1f ms budget' % (
                kind, dm[kind]['p50'], dm[kind]['calls'], DRAW_MEDIA_MS))
    if m['media']['min'] < 1 or m['media']['max'] < 2:
        bad.append('the media are not drawn (%d–%d per frame)' % (m['media']['min'], m['media']['max']))
    dp = m['depth'] or {}
    if dp.get('depth') != 'back' or not (dp.get('blurPx') or 0) > 0:
        bad.append('the video ground is not at its automatic depth back with a blur: %r' % dp)
    if not dp.get('baked') or dp.get('unbaked'):
        bad.append('the video frames did not all come with their blur baked (baked %r, unbaked %r)' % (dp.get('baked'), dp.get('unbaked')))
    if m['fallback']['sum']:
        bad.append('%d draws fell back to the per-frame blur in export quality' % m['fallback']['sum'])
    if csp or mp.errors:
        bad.append('CSP violations %r, page errors %r' % (csp[:3], mp.errors[:3]))
    st, rd, rn, so = m['stages'], m['ready'], m['render'], m['store']
    others = ', '.join('%.2f/%.2f' % (x['p50'], x['p95']) for x in r['others'])
    print('%s basic+media %dx%d, %d frames: p50 %.2f ms, p95 %.2f ms, max %.2f ms (whole iteration: ready p50 %.2f / p95 %.2f, '
          'render p50 %.2f / p95 %.2f; behave %.2f, draw %.2f, post %.2f)%s' % (
              'FAIL' if bad else 'ok  ', m['w'], m['h'], m['frames'], m['p50'], m['p95'], m['max'], rd['p50'], rd['p95'],
              rn['p50'], rn['p95'], st['behave'], st['draw'], st['post'], ('; other runs p50/p95 ' + others) if others else ''))
    print('      store per frame: decodeMs p50 %.2f (mean %.2f; wall time to a held frame), prepMs p50 %.2f (mean %.2f); %d chunks fed, '
          '%d seeks over the %d frames; ground depth %s, blur %.2f px (px %.0f), %d frames baked, %d unbaked; fallback %d' % (
              so['decodeP50'], so['decodeMean'], so['prepP50'], so['prepMean'], so.get('fed', 0), so.get('seeks', 0), m['frames'],
              dp.get('depth'), dp.get('blurPx') or 0, dp.get('px') or 0, dp.get('baked') or 0, dp.get('unbaked') or 0, m['fallback']['sum']))
    print('      drawMedia (unflushed, the gate per medium): video %d calls, p50 %.3f / p95 %.3f ms; still %d calls, p50 %.3f / p95 %.3f ms '
          '(%.3f ms per frame); all %d calls p50 %.3f, %.3f ms per frame (p50); %d–%d media per frame' % (
              dm['video']['calls'], dm['video']['p50'], dm['video']['p95'], dm['still']['calls'], dm['still']['p50'], dm['still']['p95'],
              dm['stillPerFrame'], dm['calls'], dm['p50'], dm['perFrameP50'], m['media']['min'], m['media']['max']))
    fl = m.get('flushed')
    if fl:
        for kind in ('video', 'still'):
            x = fl[kind]
            print('      drawMedia flushed, %-5s: %d calls, p50 %.3f ms%s, p95 %.3f ms, %.3f ms per frame; draws per call %d–%d (p50 %d; '
                  '§11.5.12: the picture + ≤ 2 extra)' % (kind, x['calls'], x['p50'],
                                                         ' (OVER twice the %.1f ms budget: software raster, not gated here)' % DRAW_MEDIA_MS
                                                         if x['p50'] > 2 * DRAW_MEDIA_MS else '', x['p95'], x['perFrame'], x['draws']['min'],
                                                         x['draws']['max'], x['draws']['p50']))
        print('      drawMedia flushed, all media per frame p50 %.3f ms' % fl['perFrameP50'])
    b = r['baseline']
    print('      baseline project_basic without media: p50 %.2f ms, p95 %.2f ms (render p50 %.2f)' % (b['p50'], b['p95'], b['render']['p50']))
    failures.extend('media: ' + b for b in bad)
    if r['rows']:
        rows = r['rows']
        for name in ('plainGround', 'stillGround', 'videoGround', 'videoBack', 'isolated'):
            x = rows[name]
            fl = x['flushed']
            print('      %-12s frame p50 %.2f ms, p95 %.2f ms (render p50 %.2f); drawMedia %d calls, p50 %.3f ms, p95 %.3f ms; flushed '
                  'video %d calls p50 %.3f ms (draws %d–%d), still %d calls p50 %.3f ms (draws %d–%d)' % (
                      name, x['p50'], x['p95'], x['render']['p50'], x['drawMedia']['calls'], x['drawMedia']['p50'], x['drawMedia']['p95'],
                      fl['video']['calls'], fl['video']['p50'], fl['video']['draws']['min'], fl['video']['draws']['max'],
                      fl['still']['calls'], fl['still']['p50'], fl['still']['draws']['min'], fl['still']['draws']['max']))
        vb = rows['videoBack']
        print('      videoBack: ready p50 %.2f ms, store prepMs %.2f per frame (the bake), %d baked frames; baked copies %.1f MB held' % (
            vb['ready']['p50'], vb['store']['prepMean'], (vb['depth'] or {}).get('baked') or 0, (vb['store'].get('bakedBytes') or 0) / 1e6))
        print('      WebM alpha merge, 1080p: p50 %.2f ms per frame (max %.2f)' % (rows['alphaMergeMs']['p50'], rows['alphaMergeMs']['max']))
        print('      scrub to the exact frame, 1080p, GOP 2 s: %s ms' % ', '.join('%.0f' % x for x in rows['scrubMs']))
        e = rows['exportMs']
        plain, video = min(e['plain'], e['plain2']), min(e['video'], e['video2'])
        print('      export 1 s 1080p30 MP4: %.0f ms without, %.0f ms with the 1080p30 video background (+%.0f %%)' % (
            plain, video, 100 * (video - plain) / plain))


def main():
    ap = argparse.ArgumentParser(description='Frame times of the fixture projects at 720p.')
    ap.add_argument('--parts', default='', help='registry: catalog (default when built) | examples | stub')
    ap.add_argument('--projects', default='basic,vertical,lrc,long')
    ap.add_argument('--seconds', type=float, default=10.0)
    ap.add_argument('--runs', type=int, default=2, help='fresh-engine runs per project; the least disturbed one is judged')
    ap.add_argument('--no-camera', dest='camera', action='store_false',
                    help='skip the camerawork + materials run of project_long (DESIGN_2_1 §7.4)')
    ap.add_argument('--no-media', dest='media', action='store_false',
                    help='skip the photos-and-videos run of project_basic (DESIGN_2_1 §11.8.3)')
    ap.add_argument('--media-rows', action='store_true', help='also measure the other §11.5.12 rows once (NOTES)')
    return asyncio.run(run(ap.parse_args()))


if __name__ == '__main__':
    sys.exit(main())
