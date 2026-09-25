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
6. DESIGN_2_1 camerawork: shots (reading and pushing ones with a follow lean) and rigs on the sample cut: frame N
   directly equals frame N after 0 … N−1, and the 30- and 60-step runs agree at their shared times. Project v21 (a
   project with materials: an entrance, a hold and an atmosphere of its own, and shot pins) runs checks 1–3 over the
   materials' lines.
7. DESIGN_2_1 §11.8.3 (media, in the built app page with the real AssetStore: tests/www/media_parts.js): a project with
   a video ground (the VP9 counter of media_gen.js, clock song), a photo frame of the alpha WebM (clock show) and a still
   photo frame, the automatic camerawork on, in export quality (each frame awaited with mediaReady): frame N of a fresh
   engine and store equals frame N after 0..N−1 (pixel hashes, and the same source frames), and the 60-fps run equals
   the 30-fps run at their shared times. The paused preview (the root store, hardware preferred) after a scrub, redrawn
   until it is exact, shows the export's source frames (MediaFrame.index, seen through the store's frame calls) with
   pixels within MAE ≤ 2/255. The video ground is at its automatic depth (back: blurred), so its frames come with the
   blur baked by the store (DESIGN_2_1 §11.4.6): every export frame of it must be baked (MediaFrame.blur > 0), no draw
   may fall back to the per-frame blur (FrameStats.media.fallback 0), and the paused preview ends on the baked look too.
   --no-media skips it.
8. Filters that draw on the post stack's own surface (fx.own; NOTES "Perf: camerawork + materials row", POST-1) give
   the pixels they gave when every filter copied its input (lab switch postCopy): the fixture projects basic, vertical,
   lrc, long and v21 × the backdrops scene, clear, black and chroma × the automatic camerawork on and pinned off, and
   the perf.py camerawork + materials window, at export quality; then every screen effect of the catalog and the
   filter-stack material on the sample cut, at export quality and at adaptive level 2 (the half-resolution branch).
   The frames must be identical, and filters must have run in them.
Registries: the catalog (what ships) and the examples, when the page has them; --parts picks one.
Google Fonts are blocked (fallback faces).
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/determinism.py [--parts catalog] [--projects basic,lrc]
"""
import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from contact_sheet import launch, open_lab, csp_violations, japanese_font_missing  # noqa: E402  (lab-page helpers)
from media_page import open_media_page  # noqa: E402  (the built app page with tests/www/media_parts.js)
from playwright.async_api import async_playwright  # noqa: E402

WINDOW = (2.6, 4.6)          # seconds: the first lyric cuts, a seam and their filters in the fixture projects
WINDOWS = {'v21': (13.6, 15.6)}   # v21: line r7 enters with material myMat1, r8 holds with myMat2
# Presets that keep moving over the sample cut. (pushWord and snapZoom reach the 3× framing limit on its short
# emphasized word and then hold; settle and driftOff sit at the 0.9 floor on its wide line: neither would show a history
# leak.)
CAMERA = (('shot', 'readAlong', {'follow': 0.6}), ('shot', 'tiltHold', {'follow': 0.5}), ('shot', 'sweepAcross', None),
          ('shot', 'wideHold', {'follow': 0.3}), ('rig', 'climbRise', None), ('rig', 'leanTilt', {'amp': 1.5}))
CAMERA_STEPS = 30
CAMERA_PROBES = (7, 19, 29)
FPS = 30
PROBES = (7, 31, 59)
MIXED_TEXT = 'あいあい'
MIXED_SIZE = (960, 540)
MIXED_BEFORE = ({'w': 1104, 'h': 621}, {'w': 835, 'h': 470}, {'textScale': 1.04}, {'textScale': 0.96}, {'textScale': 1.08},
                {'textScale': 0.92})
MIXED_BLURS = (1.0, 3.0, 6.0, 12.0)
POST_PROJECTS = (('basic', 24), ('vertical', 24), ('lrc', 24), ('long', 60), ('v21', 24))
POST_BACKDROPS = ('scene', 'clear', 'black', 'chroma')
POST_FRAMES = 12


def times_at(fps, t0, t1):
    n = int(round((t1 - t0) * fps))
    return [t0 + i / fps for i in range(n)]


async def frames(page, **o):
    return (await page.evaluate('(o) => window.__lab.frames(o)', o))['hashes']


async def render(page, **o):
    return await page.evaluate('(o) => window.__lab.render(o)', o)


async def check_project(page, src, project, failures):
    t0, t1 = WINDOWS.get(project, WINDOW)
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


async def sequence(page, **o):
    return [x['hash'] for x in await page.evaluate('(o) => window.__lab.sequence(o)', o)]


async def check_camera(page, src, failures):
    """Check 6: a camera preset's frame N does not depend on the frames before it; 30 and 60 steps agree."""
    bad = 0
    for kind, key, params in CAMERA:
        base = {'parts': src, 'kind': kind, 'key': key, 'params': params, 'w': 480, 'h': 270, 'quality': 'export'}
        seq = await sequence(page, steps=[{'u': i / CAMERA_STEPS} for i in range(CAMERA_STEPS)], **base)
        seq60 = await sequence(page, steps=[{'u': i / (2 * CAMERA_STEPS)} for i in range(2 * CAMERA_STEPS)], **base)
        where = '%s %s/%s%s' % (src, kind, key, (' ' + repr(params)) if params else '')
        for n in CAMERA_PROBES:
            alone = await sequence(page, steps=[{'u': n / CAMERA_STEPS}], **base)
            if alone[0] != seq[n]:
                failures.append('%s: step %d alone differs from the same step after 0..%d' % (where, n, n - 1))
                bad += 1
        if any(seq60[2 * i] != seq[i] for i in range(CAMERA_STEPS)):
            failures.append('%s: the 30- and 60-step runs differ at a shared time' % where)
            bad += 1
        if len(set(seq)) < 5:
            failures.append('%s: only %d distinct frames (does the camera move?)' % (where, len(set(seq))))
            bad += 1
    print('%s %s: %d camera presets (shots with follow, rigs): frame N alone = after 0..N−1, 30 = 60 steps' % (
        'FAIL' if bad else 'ok  ', src, len(CAMERA)))


MEDIA_MAE = 2 / 255      # the paused preview against the export, mean absolute error per channel


async def check_media(browser, failures):
    """Check 7: photos and videos, in the built app page with the real AssetStore (DESIGN_2_1 §11.8.3)."""
    mp = await open_media_page(browser)
    try:
        r = await mp.page.evaluate('(o) => window.__mediaParts.determinism(o)', {'fps': FPS, 'seconds': 2, 'probes': list(PROBES)})
        csp = await mp.csp()
    finally:
        await mp.close()
    bad = []
    if max(r['media']) < 3 or min(r['media']) < 1:
        bad.append('the media are not all drawn (per frame %d–%d)' % (min(r['media']), max(r['media'])))
    if r['distinct'] < 5:
        bad.append('only %d distinct frames in %d (the video does not play?)' % (r['distinct'], r['n']))
    for x in r['alone']:
        if not x['same'] or x['index'] != x['seqIndex']:
            bad.append('frame %d alone differs from the same frame after 0..%d (source frames %r / %r)' % (x['k'], x['k'] - 1, x['index'], x['seqIndex']))
    if r['rate'] != 'same':
        bad.append('the 30- and 60-fps runs differ at shared times: %s' % r['rate'])
    if any(r['fallback']):
        bad.append('export frames fell back to the per-frame blur: %r' % r['fallback'])
    if not all(r['videoBaked']):
        bad.append('export frames of the blurred video ground came without their baked blur: %r' % r['videoBaked'])
    for x in r['preview']:
        if not x['first']:
            bad.append('preview at frame %d: the first frame after the scrub was not provisional (nothing was decoding?)' % x['k'])
        if x['provisional']:
            bad.append('preview at frame %d: still provisional after %d redraws' % (x['k'], x['tries']))
        elif x['index'] != x['exportIndex']:
            bad.append('preview at frame %d shows source frames %r, the export %r' % (x['k'], x['index'], x['exportIndex']))
        elif x['mae'] > MEDIA_MAE:
            bad.append('preview at frame %d: pixels differ from the export by MAE %.4f (> %.4f)' % (x['k'], x['mae'], MEDIA_MAE))
    if csp:
        bad.append('CSP violations: %r' % csp[:3])
    if mp.errors:
        bad.append('page errors: %r' % mp.errors[:3])
    failures.extend('media: ' + b for b in bad)
    print('%s media: video ground + alpha WebM frame + still frame, %d frames at %d fps (%d distinct): alone = in order, 30 = 60 fps; '
          'the paused preview = the export (source frames %s, MAE ≤ %.4f)' % (
              'FAIL' if bad else 'ok  ', r['n'], FPS, r['distinct'], [x['index'] == x['exportIndex'] for x in r['preview']],
              max([x['mae'] for x in r['preview']] or [0])))


async def check_post_in_place(page, info, failures):
    """Check 8: filters drawing on the stack's own surface give the frames the copying stack gave."""
    bad, frames, drawn = 0, 0, 0
    for project, end in POST_PROJECTS:
        times = [0.5 + (end - 0.5) * i / (POST_FRAMES - 1) for i in range(POST_FRAMES)]
        for camera in (None, 'off'):
            for backdrop in POST_BACKDROPS:
                rows = await page.evaluate('(o) => window.__lab.compare(o)', {
                    'parts': 'catalog', 'project': project, 'camera': camera, 'backdrop': backdrop, 'times': times, 'w': 480,
                    'a': {}, 'b': {'postCopy': True}})
                frames += len(rows)
                drawn += sum(1 for r in rows if r['passes'] > 0)
                for r in rows:
                    if r['max'] > 0:
                        bad += 1
                        failures.append('post in place: %s camera %s backdrop %s t=%.2f differs by %d/255 on %d px' % (
                            project, camera or 'auto', backdrop, r['t'], r['max'], r['n']))
    if 'materials' in info['sources']:
        rows = await page.evaluate('(o) => window.__lab.compare(o)', {
            'parts': 'materials', 'project': 'long', 'camera': True, 'materials': True, 'w': 1280,
            'times': [20 + i / 3 for i in range(31)], 'a': {}, 'b': {'postCopy': True}})
        frames += len(rows)
        drawn += sum(1 for r in rows if r['passes'] > 0)
        bad += sum(1 for r in rows if r['max'] > 0)
        if any(r['max'] > 0 for r in rows):
            failures.append('post in place: the perf.py materials window differs')
    if drawn < frames // 4:
        failures.append('post in place: filters ran in only %d of %d frames' % (drawn, frames))
    print('%s post stack in place = copying: %d frames (%d with filters) identical' % (
        'FAIL' if bad else 'ok  ', frames, drawn))
    parts = []
    for src in [x for x in ('catalog', 'materials') if x in info['sources']]:
        keys = info['parts'][src].get('filter', [])
        parts += [(src, k) for k in keys]
    bad, ran = 0, 0
    for src, key in parts:
        for quality, level in (('export', 0), ('preview', 2)):
            for u in (0.2, 0.5, 0.8):
                r = await page.evaluate('(o) => window.__lab.comparePart(o)', {
                    'parts': src, 'kind': 'filter', 'key': key, 'u': u, 'quality': quality, 'level': level,
                    'params': {'when': 'always'}, 'a': {}, 'b': {'postCopy': True}})
                ran += 1 if r['passes'] > 0 else 0
                if r['max'] > 0:
                    bad += 1
                    failures.append('post in place: %s filter/%s (%s, level %d, u %.1f) differs by %d/255 on %d px' % (
                        src, key, quality, level, u, r['max'], r['n']))
    if ran < len(parts) * 6:
        failures.append('post in place: a screen effect did not run on the sample cut (%d of %d)' % (ran, len(parts) * 6))
    print('%s %d screen effects in place = copying at export and at half resolution' % ('FAIL' if bad else 'ok  ', len(parts)))


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
            if await japanese_font_missing(page, 'determinism.py'):
                return 1
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
                if src == 'catalog':
                    await check_camera(page, src, failures)
                    await check_post_in_place(page, info, failures)
            violations = await csp_violations(page)
            if violations:
                failures.append('CSP violations: %r' % violations)
            if page.lab_errors:
                failures.append('page errors: %r' % page.lab_errors[:10])
            if args.media:
                await check_media(browser, failures)
        finally:
            await browser.close()
    for msg in failures:
        print('  ' + msg)
    print('determinism.py: %s' % ('FAILED' if failures else 'OK'))
    return 1 if failures else 0


def main():
    ap = argparse.ArgumentParser(description='Frame determinism on the lab page.')
    ap.add_argument('--parts', default='', help='registry: catalog | examples | stub (default: catalog, then examples)')
    ap.add_argument('--projects', default='basic,vertical,lrc,v21', help='fixture projects, comma-separated')
    ap.add_argument('--no-media', dest='media', action='store_false', help='skip check 7 (photos and videos, DESIGN_2_1 §11.8.3)')
    return asyncio.run(run(ap.parse_args()))


if __name__ == '__main__':
    sys.exit(main())
