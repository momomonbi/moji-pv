#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test for WP6 media: MP4 export, PNG ZIP export, decode/analysis, player.

The page is assembled in memory, the way build.py concatenates the app (kernel, then the needed modules in its
topological order, with the real CSP), plus the vendor muxer, tests/helpers/fake_engine.js as the engine (DESIGN §4.20
facade) and the harness tests/www/export_check.js. Nothing is written to disk.

Checks: a 2.5 s 720p30 MP4 export of the fake engine through a File System Access sink (OPFS, stream target) and a
memory sink (in-memory target): sample count, decoded frame count, key frames exactly at frames 0 and 60 (every 2·fps),
video and audio length; cancel leaves no file; a 5.1 song (sound on the centre channel only) reaches the AudioEncoder
mixed down to stereo; PNG and transparent PNG ZIPs read with zipfile (store-only, names — one cut at the name limit next
to an emoji —, CRCs, PNG sizes and colour types); decode + analysis of a generated click track; the player clock. When this Chromium cannot encode H.264 (no proprietary codecs), the MP4
checks run with VP9 in MP4 instead and the H.264 part is reported as skipped; CI uses Google Chrome and sets
MV_REQUIRE_H264=1, which turns that skip into a failure. The MP4 sound is AAC-LC, else Opus in MP4 (DESIGN_2_1 §13.4):
Google Chrome on Linux and Chromium have no AAC encoder, so there the default export carries an Opus track; a further
export forces AAC away (codecs.audioList) and checks the Opus track (dOps), its decoded length (N / fps ± 25 ms) and
level, and the pre-flight note opus-audio. The export loops await engine.mediaReady(t0 + i / fps) before every frame,
and a store failure stops the export with ExportError('media') naming the asset.
With --long [SECONDS] it also runs the WP6 acceptance export: project_basic at its own settings (1080p30, with sound),
SECONDS long (default 180), checking the decoded frame count and the A/V length. It takes minutes, so it is opt-in.
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/export_check.py   (CI: PW_CHANNEL=chrome)
"""
import argparse
import asyncio
import os
import json
import base64
import hashlib
import http.server
import importlib.util
import io
import struct
import sys
import threading
import zipfile
from pathlib import Path

# MV_REQUIRE_H264=1 (CI with Google Chrome): a browser without an H.264 encoder fails instead of skipping the MP4 checks.
REQUIRE_H264 = os.environ.get('MV_REQUIRE_H264') == '1'
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch, new_page  # noqa: E402  (dev/browser.py, the shared launcher)
from playwright.async_api import async_playwright  # noqa: E402

ROOTS = ('export/host/mp4', 'export/host/png', 'export/host/sink', 'audio/host/decode', 'audio/host/player', 'audio/wav',
         'audio/digest', 'core/doc')
FONT_HOSTS = ('https://fonts.googleapis.com/**', 'https://fonts.gstatic.com/**')
RECORD_VIOLATIONS = """
window.__cspViolations = [];
document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(e.violatedDirective + ' ' + e.blockedURI));
"""
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
FPS, SIZE = 30, (1280, 720)
MP4_FRAMES = 75            # 2.5 s: two key-frame intervals begin (frames 0 and 60)
PNG_FRAMES = 60            # 2 s
ALPHA_BASE = 'a' * 79      # the '[ti:aaa…a🎵 live]' title cut before the emoji (80 UTF-16 units)


def load_build():
    spec = importlib.util.spec_from_file_location('mv_build', ROOT / 'build.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def closure(modules, roots):
    seen, stack = set(), list(roots)
    while stack:
        mid = stack.pop()
        if mid in seen:
            continue
        seen.add(mid)
        stack.extend(modules[mid].deps)
    return seen


def page_html():
    """The test page: the same kernel + topologically sorted modules as build.py, with its CSP over every inline script."""
    build = load_build()
    problems = build.Problems(ROOT)
    kernel, modules, _css = build.collect(ROOT, problems)
    order = build.topo_sort(modules, problems)
    needed = closure(modules, ROOTS)
    app = '\n'.join([kernel.rstrip('\n'), "MV.DEV=true;MV.LANG='ja';"] + [modules[m].text.rstrip('\n') for m in order if m in needed])
    muxer = (ROOT / 'vendor' / 'mp4-muxer.min.js').read_text(encoding='utf-8')
    fake = (ROOT / 'tests' / 'helpers' / 'fake_engine.js').read_text(encoding='utf-8')
    harness = (ROOT / 'tests' / 'www' / 'export_check.js').read_text(encoding='utf-8')
    return build.render_page('ja', 'export check', '', [muxer, app + '\n', fake], harness)


def serve(html):
    body = html.encode('utf-8')

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != '/export_check.html':
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


class Checks:
    def __init__(self):
        self.failures = []

    def ok(self, cond, what):
        print(('ok    ' if cond else 'FAIL  ') + what)
        if not cond:
            self.failures.append(what)

    def near(self, value, want, eps, what):
        self.ok(value is not None and abs(value - want) <= eps, '%s: %r ≈ %r (±%g)' % (what, value, want, eps))


def png_header(data):
    """(width, height, colour type) from the IHDR chunk."""
    assert data[:8] == PNG_SIGNATURE and data[12:16] == b'IHDR'
    width, height, _depth, colour = struct.unpack('>IIBB', data[16:26])
    return width, height, colour


def check_zip(c, label, b64, frames, size, colour, base):
    z = zipfile.ZipFile(io.BytesIO(base64.b64decode(b64)))
    infos = z.infolist()
    c.ok(z.testzip() is None, '%s: every CRC matches (zipfile.testzip)' % label)
    c.ok([i.filename for i in infos] == ['%s_%05d.png' % (base, i) for i in range(frames)], '%s: %d frames named %s_00000.png …' % (label, frames, base))
    c.ok(all(i.compress_type == zipfile.ZIP_STORED for i in infos), '%s: store-only' % label)
    heads = [png_header(z.read(i)) for i in infos]
    c.ok(all(h[:2] == size for h in heads), '%s: every PNG is %d×%d' % (label, size[0], size[1]))
    c.ok(all(h[2] in colour for h in heads), '%s: PNG colour type in %r (got %r)' % (label, colour, sorted({h[2] for h in heads})))
    distinct = len({hashlib.sha1(z.read(i)).hexdigest() for i in infos})
    c.ok(distinct > 1, '%s: frames differ over time (%d distinct)' % (label, distinct))


def key_indices(frames):
    """0-based frames that must be key frames: every 2·fps, i.e. ceil(N / (2·fps)) of them."""
    return list(range(0, frames, 2 * FPS))


def check_mp4(c, label, run, want_audio, h264):
    v = run['video']
    frames = MP4_FRAMES
    seconds = frames / FPS
    c.ok(run['result']['frames'] == frames, '%s: N = frameCount(%g s, 30) = %d' % (label, seconds, frames))
    c.ok(v['samples'] == frames, '%s: %d video samples in the file (got %d)' % (label, frames, v['samples']))
    c.ok(v['decoded'] == frames and not v['decodeError'], '%s: decoded frame count %d = %d (%s)' % (label, v['decoded'], frames, v['codec']))
    c.ok((v['width'], v['height']) == SIZE, '%s: %d×%d' % (label, v['width'], v['height']))
    c.ok(v['keyIndices'] == key_indices(frames), '%s: key frames exactly at %r, every 2·fps (got %r)'
         % (label, key_indices(frames), v['keyIndices']))
    c.ok(v['firstDts'] == 0, '%s: first frame at t = 0' % label)
    c.near(v['seconds'], seconds, 1e-9, '%s: video track length (s)' % label)
    c.near(v['sampleSeconds'], seconds, 1e-9, '%s: Σ frame durations (s)' % label)
    c.ok(v['format'] == ('avc1' if h264 else 'vp09'), '%s: video sample entry %s' % (label, v['format']))
    if want_audio:
        a = run['audio']
        want = 'mp4a' if run['result'].get('audioCodec') == 'mp4a.40.2' else 'Opus'
        c.ok(a is not None and a['format'] == want, '%s: audio track %r (%s)' % (label, a and a['format'], run['result'].get('audioCodec')))
        if a:
            c.near(a['seconds'], v['seconds'], 0.05, '%s: audio length = video length' % label)
    else:
        c.ok(run['audio'] is None, '%s: no audio track' % label)
    c.ok(run['bytes'] == run['result']['bytes'], '%s: Result.bytes = file size (%d)' % (label, run['bytes']))


def check_surround(c, s):
    """A 5.1 song with sound only on the centre: the stereo AudioData must carry it on both sides (√½ · 0.3)."""
    want = 0.3 * 0.5 ** 0.5
    print('info  5.1 song: decoded to %d channels, channel peaks %s' % (s['channels'], ['%.3f' % x for x in s['sourcePeaks']]))
    if not s['audio']:
        print('SKIP  5.1 mix-down: this browser has no audio encoder for the MP4')
        return
    c.ok(len(s['sentPeaks']) == 2, '5.1 song: the AudioEncoder gets 2 channels (%d)' % len(s['sentPeaks']))
    if s['channels'] == 6:
        c.near(s['sourcePeaks'][2], 0.3, 0.01, '5.1 song: the centre channel holds the sound')
    for side, peak in zip(('left', 'right'), s['sentPeaks']):
        c.near(peak, want if s['channels'] == 6 else s['sourcePeaks'][0], 0.01, '5.1 song: %s channel of the export is not silent' % side)


def check_opus(c, o):
    """Opus in MP4 with AAC forced away: the track, its length and level, and the pre-flight note (DESIGN_2_1 §13.4)."""
    if o['probeAudio'] != 'opus':
        c.ok(o['probeAudio'] is None, 'opus: with AAC forced away the probe gives Opus or nothing (%r)' % o['probeAudio'])
        print('SKIP  Opus in MP4: this browser has no Opus encoder')
        return
    frames = MP4_FRAMES
    r, f, snd = o['result'], o['file'], o['sound']
    c.ok(r['audio'] and r['audioCodec'] == 'opus', 'opus: Result.audioCodec is opus (%r)' % r['audioCodec'])
    a = f['audio']
    c.ok(a is not None and a['format'] == 'Opus' and 'dOps' in a['boxes'], 'opus: an Opus sample entry with dOps (%r)' % (a and a['boxes']))
    if a and a['dOps']:
        c.ok(a['dOps']['channels'] == 2 and a['dOps']['rate'] == 48000, 'opus: dOps stereo at 48 kHz (%r)' % a['dOps'])
    print('info  opus: decoded through %s' % snd['via'])
    c.near(snd['seconds'], frames / FPS, 0.025, 'opus: decoded sound lasts N / fps')
    c.ok(snd['rms'] > 0.01, 'opus: the sound is not silent (RMS %.3f)' % snd['rms'])
    c.ok('opus-audio' in o['preflight'] and 'no-audio-codec' not in o['preflight'],
         'opus: the pre-flight shows opus-audio, not no-audio-codec (%r)' % o['preflight'])


def check_media_wait(c, w):
    """The export loops await mediaReady(t0 + i / fps) before each frame; a store failure is ExportError('media')."""
    t0, frames = 0.4, 15
    want = [t0 + i / FPS for i in range(frames)]
    for kind in ('mp4', 'png'):
        got = [x['t'] for x in w[kind]]
        c.ok(len(got) == frames and all(abs(a - b) < 1e-9 for a, b in zip(got, want)),
             '%s: mediaReady once per frame at t0 + i / fps, in order (%d calls)' % (kind, len(got)))
        c.ok(all(x['fps'] == FPS and x['signal'] for x in w[kind]), '%s: mediaReady gets the fps and the signal' % kind)
    for kind, f in (('mp4', w['fail']), ('png', w['failPng'])):
        c.ok(not f['ok'] and f['code'] == 'media', "%s: a store failure stops the export with ExportError('media') (%r)" % (kind, f))
        c.ok((f.get('detail') or {}).get('name') == '海辺.mp4' and (f.get('detail') or {}).get('id') == 'a3f9c2d17b0e4a5c6d7e8f901',
             '%s: the error names the asset (%r)' % (kind, f.get('detail')))
        c.ok(f['bytesLeft'] == 0, '%s: nothing is kept after a media failure' % kind)
    c.ok(w['fail']['asked'] == 5, 'mp4: no frame is rendered after the failed wait (%d asked)' % w['fail']['asked'])


def check_long(c, run, seconds, h264, aac):
    frames = seconds * FPS
    v = run['video']
    print('info  long export: %d frames in %.1f s (%.1f ms/frame), %d bytes, %s'
          % (run['result']['frames'], run['ms'] / 1000, run['ms'] / max(1, run['result']['frames']), run['bytes'], v['codec']))
    c.ok(run['result']['frames'] == frames and v['samples'] == frames, 'long: %d frames written' % frames)
    c.ok(v['decoded'] == frames and not v['decodeError'], 'long: decoded frame count %d = %d' % (v['decoded'], frames))
    c.ok((v['width'], v['height']) == (1920, 1080), 'long: 1920×1080')
    c.ok(v['keyIndices'] == key_indices(frames), 'long: key frames exactly every 2 s (%d, want %d)'
         % (len(v['keyIndices']), len(key_indices(frames))))
    c.near(v['seconds'], seconds, 1e-9, 'long: video length (s)')
    if run['audio']:
        c.near(run['audio']['seconds'], seconds, 0.05, 'long: audio length (s)')
    elif not aac:
        print('info  long: no AAC or Opus encoder in this browser, so the export has no sound')
    else:
        c.ok(False, 'long: an audio track')


async def main(long_seconds=None):
    html = page_html()
    server = serve(html)
    url = 'http://127.0.0.1:%d/export_check.html' % server.server_address[1]
    c = Checks()
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                page = await new_page(browser)
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                for host in FONT_HOSTS:
                    await page.route(host, lambda route: route.abort())
                await page.add_init_script(RECORD_VIOLATIONS)
                await page.goto(url, wait_until='load')
                await page.mouse.click(5, 5)          # user activation, so the AudioContext may start
                r = await page.evaluate('window.__exportCheck()')
                if long_seconds and r['mp4'] is not None:
                    fixture = json.loads((ROOT / 'tests' / 'fixtures' / 'project_basic.json').read_text(encoding='utf-8'))
                    page.set_default_timeout(0)
                    r['long'] = await page.evaluate('([doc, s, f]) => window.__exportLong(doc, s, f)',
                                                    [fixture['doc'], long_seconds, not r['probe']['codec']])
                violations = await page.evaluate('window.__cspViolations')
            finally:
                await browser.close()
    finally:
        server.shutdown()

    c.ok(not errors, 'no page errors %r' % errors)
    c.ok(not violations, '0 CSP violations %r' % violations)

    h264 = bool(r['probe']['codec'])
    # anyCodec tells "no H.264 encoder at all" (pre-flight no-h264) from "not at this size" (no-codec); at this small
    # size the two agree.
    c.ok(r['probe'].get('anyCodec') is h264, 'probe: anyCodec %r matches the codec at %s (%r)' % (r['probe'].get('anyCodec'), 'this size', r['probe']['codec']))
    if REQUIRE_H264:
        # CI (Google Chrome) must really run the H.264 branch, not skip it.
        c.ok(h264, 'MV_REQUIRE_H264: this browser encodes H.264 (%r)' % r['probe']['codec'])
        print('info  MP4 audio codec: %r (Chrome on Linux has no AAC encoder: Opus in MP4)' % r['probe']['audioCodec'])
    if h264:
        print('info  H.264 encoder: %s, MP4 audio: %s' % (r['probe']['codec'], r['probe']['audioCodec']))
    else:
        print('SKIP  H.264 MP4 checks: this browser cannot encode H.264 (VideoEncoder.isConfigSupported → false for %s). '
              'Running the same MP4 pipeline with %s instead; CI (Google Chrome) runs the H.264 checks.'
              % (', '.join(['avc1.640028', 'avc1.4D0028', 'avc1.42E028']), 'VP9' if r['fallback'] == 'vp9' else 'nothing'))
    m = r['mp4']
    if m is None:
        print('SKIP  MP4 checks: no usable video encoder at all')
    else:
        audio_ok = m['stream']['result']['audio']
        # the default order: AAC, else Opus; silent only when the probe found neither
        c.ok(m['stream']['result']['audioCodec'] == r['probe']['audioCodec'],
             'mp4 stream: the audio codec is the probed one (%r, probe %r)' % (m['stream']['result']['audioCodec'], r['probe']['audioCodec']))
        if not audio_ok:
            print('info  neither AAC nor Opus encodes here: the MP4 has no sound')
        check_mp4(c, 'mp4 stream (file sink)', m['stream'], audio_ok, h264)
        c.ok(m['stream']['order'][-1] == 'moov', 'mp4 stream: moov written at the end (fastStart false): %r' % m['stream']['order'])
        check_mp4(c, 'mp4 memory', m['memory'], False, h264)
        c.ok(m['memory']['order'].index('moov') < m['memory']['order'].index('mdat'), 'mp4 memory: fast start (moov before mdat)')
        c.ok(m['memory']['result']['name'] == '書き出しテスト.mp4', 'mp4 memory: file name from [ti:] (%s)' % m['memory']['result']['name'])
        c.ok(m['progress']['calls'] == MP4_FRAMES and m['progress']['last'] == {'i': MP4_FRAMES, 'N': MP4_FRAMES, 'eta': 0},
             'mp4: progress once per frame, ending at i = N, eta 0 (%r)' % m['progress']['last'])
        c.ok(m['progress']['etaNumbers'], 'mp4: every progress report has an ETA')
        c.ok(not m['cancel']['ok'] and m['cancel']['code'] == 'cancelled', 'mp4 cancel: ExportError cancelled (%r)' % m['cancel'])
        c.ok(not m['cancel']['fileLeft'], 'mp4 cancel: the partial file is removed')
        check_surround(c, m['surround'])
        check_opus(c, m['opus'])
        check_media_wait(c, m['wait'])

    g = r['png']
    check_zip(c, 'png', g['plain']['zip'], PNG_FRAMES, SIZE, (2, 6), '書き出しテスト')
    c.ok(g['plain']['pixel']['corner'] == 255, 'png: opaque background (alpha %r)' % g['plain']['pixel']['corner'])
    c.ok(g['plain']['name'] == '書き出しテスト.zip', 'png: zip name %s' % g['plain']['name'])
    check_zip(c, 'png alpha', g['alpha']['zip'], 12, SIZE, (6,), ALPHA_BASE)
    c.ok(g['alpha']['name'] == ALPHA_BASE + '.zip', 'png alpha: long title cut before the emoji (%r)' % g['alpha']['name'])
    c.ok(g['alpha']['pixel']['corner'] == 0, 'png alpha: transparent background (alpha %r)' % g['alpha']['pixel']['corner'])
    c.ok(not g['cancel']['ok'] and g['cancel']['code'] == 'cancelled' and g['cancel']['bytesLeft'] == 0,
         'png cancel: cancelled, nothing kept (%r)' % g['cancel'])

    a = r['audio']
    wav = base64.b64decode(a['wav'])
    c.ok(a['sha1'] == hashlib.sha1(wav).hexdigest(), 'decode: sha1 of the file bytes')
    c.ok(a['rate'] == 48000 and a['length'] == 8 * 48000, 'decode: 8 s decoded at 48 kHz (%r, %r)' % (a['rate'], a['length']))
    c.near(a['bpm'], 128, 1, 'analysis: bpm of the click track')
    c.near(a['offset'], 0.3, 0.02, 'analysis: first beat (s)')
    c.ok(a['digestFrames'] == 160 and a['problems'] == [] and a['name'] == 'clicks.wav', 'song record validates, 20 Hz digest')
    c.ok(a['peakLevels'] >= 2, 'waveform peaks: a mip chain (%d levels)' % a['peakLevels'])
    c.ok(a['emptyCode'] == 'empty' and a['junkCode'] == 'decode', 'decode errors: empty / decode (%r, %r)' % (a['emptyCode'], a['junkCode']))

    pl = r['player']
    c.near(pl['running'], 0.3, 0.2, 'player (no song): the clock runs')
    c.near(pl['eventTime'], pl['running'], 0.05, 'player: outputTimeOf(now) ≈ now()')
    c.ok(pl['pausedStable'], 'player: paused time stays')
    c.near(pl['seeked'], 0.9, 1e-9, 'player: seek')
    c.ok(pl['ended'] == ['ended'] and pl['atEnd'] == 1 and not pl['playing'], "player: 'ended' at the end (%r)" % pl)
    if pl['song']['now'] > 0.55:
        c.ok(pl['song']['playing'] and pl['song']['muted'], 'player (song): plays muted from 0.5 s (now %.3f)' % pl['song']['now'])
    else:
        print('SKIP  player with a song: the AudioContext did not run in this browser (now %.3f)' % pl['song']['now'])

    if r.get('long'):
        check_long(c, r['long'], long_seconds, h264, bool(r['probe']['audioCodec']))

    print('export_check.py: %s' % ('FAILED (%d)' % len(c.failures) if c.failures else 'OK'))
    return 1 if c.failures else 0


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='WP6 browser checks (export, decode, player).')
    ap.add_argument('--long', nargs='?', type=int, const=180, default=None, metavar='SECONDS',
                    help='also export project_basic at 1080p30 for SECONDS (default 180)')
    sys.exit(asyncio.run(main(ap.parse_args().long)))
