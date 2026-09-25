#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: frame exactness of videos in the export (DESIGN_2_1 §11.8.3 media_exact.py).

Runs in the built app page (index.html?fresh=1&test=1) under its real CSP, with tests/helpers/exif_write.js,
tests/helpers/media_gen.js and the harness tests/www/media_parts.js evaluated into it: the real demuxers, the real
AssetStore (media/host/store, software decoders in the export fork), the catalog's media parts and export/host/png.

The counter videos of media_gen.js (frame i shows i as a 12-bit code): VP9 in WebM at 30 fps, VP9 in MP4 at 25 fps, VFR
(VP9 in MP4: 1 s at 30 fps, then 1 s at 15 fps), and H.264 in MP4 at 30 fps where this browser encodes it (Chrome CI;
MV_REQUIRE_H264=1 fails the run without it). Each is the work background (photoPan: fit cover, move none, clock song,
depth still, no veil; the text hidden) of a PNG export at 24, 30 and 60 fps, at 1280×720 and 1920×1080, over 2.4 s (the
2-s clips loop once). EVERY output frame's code must equal the source frame expected at its time, computed here from the
frame times the clip was made with and the §11.4.2 time rule (the largest frame start ≤ media time + 0.1 ms) — not from
media/samples.sampleAt. Then the params: speed 0.5 and 2, clipIn 0.5, loop hold past the end, and clock show in a cut
(a photo frame whose clip starts when the cut appears, read inside the frame). Last, a 3-s MP4 export of the WebM
background (H.264 where it encodes, else VP9 in MP4) decodes back, frame by frame, to the same codes. 0 CSP violations.
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/media_exact.py [--quick]   (CI: PW_CHANNEL=chrome)
"""
import argparse
import asyncio
import bisect
import math
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch  # noqa: E402  (dev/browser.py, the shared launcher)
from playwright.async_api import async_playwright  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from media_page import open_media_page  # noqa: E402  (the built app page with tests/www/media_parts.js)

REQUIRE_H264 = os.environ.get('MV_REQUIRE_H264') == '1'
EPS_MEDIA = 1e-4          # §11.4.2: a frame starts at its pts, rounded toward the later frame by 0.1 ms
HOLD_BACK = 0.001         # §11.4.2: hold stops 1 ms before the end
RANGE = 2.4               # s of each export: the 2-s clips loop once
RATES = (24, 30, 60)
SHORTS = (720, 1080)




class Checks:
    def __init__(self):
        self.failures = []

    def ok(self, cond, what):
        print(('ok    ' if cond else 'FAIL  ') + what)
        if not cond:
            self.failures.append(what)
        return cond


# --- the expected source frame (§11.4.2), from the times the clip was made with ------------------------------------------

def media_time(t, clip, clock_origin=0.0, speed=1.0, clip_in=0.0, clip_out=0.0, loop='loop'):
    """Media seconds at output time t: closed form in t, as DESIGN_2_1 §11.4.2 writes it."""
    dur = clip['dur']
    frame = 1 / clip['fps']
    clip_in = min(max(clip_in, 0.0), max(0.0, dur - frame))
    end = min(clip_out, dur) if clip_out > clip_in else dur
    span = max(frame, end - clip_in)
    x = max(0.0, t - clock_origin) * speed
    if loop == 'hold':
        return clip_in + min(x, span - HOLD_BACK)
    return clip_in + (x - span * math.floor(x / span))


def frame_at(times, m):
    """The frame shown at media time m: the last one whose start is ≤ m + 0.1 ms (the first one before any)."""
    return max(0, bisect.bisect_right(times, m + EPS_MEDIA) - 1)


def expected_codes(clip, t0, fps, n, **timing):
    return [frame_at(clip['times'], media_time(t0 + i / fps, clip, **timing)) for i in range(n)]


def compare(c, label, got, want):
    bad = [(i, g, w) for i, (g, w) in enumerate(zip(got, want)) if g != w]
    ok = len(got) == len(want) and not bad
    c.ok(ok, '%s: %d frames, every one shows its source frame%s' % (
        label, len(got), '' if ok else ' — %d wrong (frame, got, want): %r' % (len(bad) + abs(len(got) - len(want)), bad[:6])))
    return ok


async def main(quick):
    c = Checks()
    started = time.time()
    async with async_playwright() as p:
        browser = await launch(p)
        try:
            mp = await open_media_page(browser)
            page = mp.page
            try:
                info = await page.evaluate('() => window.__mediaParts.exact.prepare()')
                clips = info['clips']
                if REQUIRE_H264:
                    c.ok(bool(info['h264']), 'this browser encodes H.264 (MV_REQUIRE_H264=1)')
                elif not info['h264']:
                    print('SKIP  H.264: this browser has no H.264 encoder (Chrome CI covers it: MV_REQUIRE_H264=1)')
                for name, clip in clips.items():
                    made_dur = clip['times'][-1] + (clip['times'][-1] - clip['times'][-2])
                    c.ok(abs(clip['dur'] - made_dur) < 1e-3 and clip['frames'] == len(clip['times']),
                         '%s: imported as %d frames, %.3f s (%s)' % (name, clip['frames'], clip['dur'], clip['codec']))

                # every clip as the background, at every rate and both sizes
                for name in clips:
                    for fps in RATES:
                        for short in (SHORTS[:1] if quick else SHORTS):
                            r = await page.evaluate('(j) => window.__mediaParts.exact.run(j)',
                                                    {'clip': name, 'fps': fps, 'short': short, 't0': 0, 't1': RANGE})
                            want = expected_codes(clips[name], r['t0'], fps, r['n'])
                            compare(c, '%s background, PNG %dx%d at %d fps (%.1f s)' % (name, r['w'], r['h'], fps, r['ms'] / 1000),
                                    r['codes'], want)
                            c.ok(r['n'] == math.ceil(RANGE * fps - 1e-9), '%s %d fps: the export has %d frames' % (name, fps, r['n']))

                # the time params, on the 30-fps WebM at 30 fps and at 24 fps
                clip = clips['webm30']
                variants = [
                    ('speed 0.5', {'speed': 0.5}, {'speed': 0.5}),
                    ('speed 2', {'speed': 2}, {'speed': 2.0}),
                    ('clipIn 0.5', {'clipIn': 0.5}, {'clip_in': 0.5}),
                    ('clipIn 0.5, clipOut 1.5', {'clipIn': 0.5, 'clipOut': 1.5}, {'clip_in': 0.5, 'clip_out': 1.5}),
                    ('loop hold past the end', {'loop': 'hold'}, {'loop': 'hold'}),
                ]
                for label, params, timing in variants:
                    for fps in (30, 24):
                        r = await page.evaluate('(j) => window.__mediaParts.exact.run(j)',
                                                {'clip': 'webm30', 'fps': fps, 'short': 720, 't0': 0, 't1': RANGE, 'params': params})
                        compare(c, 'webm30 background, %s, at %d fps' % (label, fps), r['codes'],
                                expected_codes(clip, r['t0'], fps, r['n'], **timing))

                # clock show in a cut: a photo frame whose clip starts when the cut appears
                for name, fps in (('mp4_25', 30), ('webm30', 24), ('vfr', 60)):
                    r = await page.evaluate('(j) => window.__mediaParts.exact.run(j)',
                                            {'clip': name, 'fps': fps, 'short': 720, 'kind': 'frame', 'seconds': 1.2})
                    compare(c, '%s photo frame in a cut, clock show (appears at %.3f s), from %.3f s at %d fps' % (
                        name, r['cutA'], r['t0'], fps), r['codes'],
                        expected_codes(clips[name], r['t0'], fps, r['n'], clock_origin=r['cutA']))

                # a 3-s MP4 export decodes back to the same codes
                r = await page.evaluate('(j) => window.__mediaParts.exact.mp4(j)', {'clip': 'webm30', 'seconds': 3, 'fps': 30, 'short': 720})
                compare(c, 'MP4 export (%s) of the webm30 background, decoded back' % r['codec'], r['codes'],
                        expected_codes(clip, 0.0, 30, 90))
                csp = await mp.csp()
            finally:
                await mp.close()
        finally:
            await browser.close()
    errors = mp.errors
    c.ok(not errors, 'no page errors %r' % errors[:3])
    c.ok(not csp, '0 CSP violations %r' % csp[:3])
    print('media_exact.py: %s (%.0f s)' % ('FAILED (%d)' % len(c.failures) if c.failures else 'OK', time.time() - started))
    return 1 if c.failures else 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='Frame exactness of videos in the export (DESIGN_2_1 §11.8.3).')
    ap.add_argument('--quick', action='store_true', help='1280×720 only (the full run adds 1920×1080)')
    sys.exit(asyncio.run(main(ap.parse_args().quick)))
