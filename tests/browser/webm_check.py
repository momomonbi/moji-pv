#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test for 透過動画（WebM）: export/host/webm (DESIGN_2_1 §13.5, §13.12 webm_check.py).

Runs in the built app page (index.html?fresh=1&test=1) under its real CSP, with tests/helpers/media_gen.js and the
harness tests/www/webm_check.js evaluated into it. project_basic at 720p30, a 3 s range from its first lyric cut, with a
tone as the song, goes through the real engine (a fork of the preview engine, as step ④ makes it). The test engine
draws a test layer over every frame: the counter code of §11.8.1 (frame i shows i) and five alpha steps (0, 64, 128,
191, 255). Checked:
  - the export: N = 90 frames, the VP9 string of pickVp9 (level 31 at 720p30), Opus, one progress report per frame;
    two encoders (the alpha one at the colour's bitrate, ALPHA_SHARE; latencyMode quality), key frames forced on both every
    2·fps (0 and 60), every chunk at ts(i);
  - the file, read here by a separate EBML reader: EBML DocType webm, DocTypeVersion 4; Segment size patched; SeekHead
    with Info, Tracks and Cues; Info Duration = 3000 ms; video track V_VP9 with DefaultDuration round(1e9 / 30),
    AlphaMode 1, MaxBlockAdditionID 1 and a BlockAdditionMapping; the Opus track with its OpusHead; one cluster and one
    CuePoint per key frame; every video block a BlockGroup with BlockAdditional id 1;
  - media/matroska reads it back exactly: n = N, the colour and alpha bytes of every frame equal the encoders' chunks,
    the key flags equal "both chunks are key frames", the times on the frame grid (i / fps);
  - decoded by WebCodecs from that table: N colour and N alpha frames, and every colour frame shows its own code;
  - decoded by Chrome (<video src=blob:>, requestVideoFrameCallback, drawn to a canvas) at 6 frame times: the frame
    shown is the right one (its code), and its alpha is within ±6/255 of the transparent PNG export of the same frame for
    ≥ 99 % of the pixels (mean |Δα| ≤ 1); fully clear areas (4 px from any PNG α > 0) ≤ 3 and glyph cores (3 px inside
    α = 255) ≥ 250 for ≥ 99.9 % of their pixels, with no isolated codec spike beyond 24 / below 232; each alpha step ±6;
  - the song: the Opus track decodes (decodeAudioData) to audioFrames(N) samples ± one packet (960), not silent;
  - without a song the file has no audio track; cancel leaves nothing (ExportError cancelled); no VP9 or VP8 encoder
    gives ExportError no-vp9; no page errors and no CSP violations.
It also prints the export's throughput (frames per second, with the real engine) for NOTES (§13.5).
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/webm_check.py   (CI: PW_CHANNEL=chrome)
"""
import asyncio
import base64
import functools
import http.server
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch, new_page, japanese_font_missing  # noqa: E402  (dev/browser.py, the shared launcher)
from playwright.async_api import async_playwright  # noqa: E402

FONT_HOSTS = ('https://fonts.googleapis.com/**', 'https://fonts.gstatic.com/**')
RECORD = """
window.__csp = [];
document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || '')));
"""
HELPERS = ('tests/helpers/media_gen.js', 'tests/www/webm_check.js')
FPS, SECONDS, N = 30, 3, 90
# §13.12's alpha bounds hold for 99.9 % of the pixels; VP9 leaves isolated spikes, which may not exceed these.
CLEAR_MAX, CORE_MIN = 24, 232
OPUS_PACKET = 960                     # 20 ms at 48 kHz

# EBML ids (the bytes as written, marker bits included)
EBML, DOC_TYPE, DOC_TYPE_VERSION = 0x1A45DFA3, 0x4282, 0x4287
SEGMENT, SEEK_HEAD, SEEK, SEEK_ID, SEEK_POSITION = 0x18538067, 0x114D9B74, 0x4DBB, 0x53AB, 0x53AC
INFO, TIMESTAMP_SCALE, DURATION = 0x1549A966, 0x2AD7B1, 0x4489
TRACKS, TRACK_ENTRY, TRACK_NUMBER, TRACK_TYPE, CODEC_ID, CODEC_PRIVATE = 0x1654AE6B, 0xAE, 0xD7, 0x83, 0x86, 0x63A2
DEFAULT_DURATION, MAX_BLOCK_ADDITION_ID, BLOCK_ADDITION_MAPPING = 0x23E383, 0x55EE, 0x41E4
VIDEO, ALPHA_MODE, PIXEL_WIDTH, PIXEL_HEIGHT = 0xE0, 0x53C0, 0xB0, 0xBA
CLUSTER, TIMESTAMP, SIMPLE_BLOCK, BLOCK_GROUP, BLOCK = 0x1F43B675, 0xE7, 0xA3, 0xA0, 0xA1
BLOCK_ADDITIONS, BLOCK_MORE, BLOCK_ADD_ID, BLOCK_ADDITIONAL, REFERENCE_BLOCK = 0x75A1, 0xA6, 0xEE, 0xA5, 0xFB
CUES, CUE_POINT, CUE_TIME, CUE_TRACK_POSITIONS, CUE_CLUSTER_POSITION = 0x1C53BB6B, 0xBB, 0xB3, 0xB7, 0xF1
VOID = 0xEC


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory):
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(directory)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def ensure_built(root):
    pages = [root / 'index.html', root / 'en' / 'index.html']
    inputs = list((root / 'src').rglob('*')) + [ROOT / 'build.py']
    newest = max(p.stat().st_mtime for p in inputs if p.is_file())
    if all(p.is_file() for p in pages) and min(p.stat().st_mtime for p in pages) >= newest:
        return
    subprocess.run([sys.executable, str(ROOT / 'build.py'), '--root', str(root)], check=True)


class Checks:
    def __init__(self):
        self.failures = []

    def ok(self, cond, what):
        print(('ok    ' if cond else 'FAIL  ') + what)
        if not cond:
            self.failures.append(what)
        return cond


# --- a small EBML reader (independent of media/matroska) -----------------------------------------------------------

def vint(data, at, keep_marker):
    first = data[at]
    length = 1
    while length <= 8 and not first & (0x80 >> (length - 1)):
        length += 1
    value = first if keep_marker else first & (0xFF >> length)
    for k in range(1, length):
        value = value * 256 + data[at + k]
    return value, length


def elements(data, start, end):
    """[(id, body start, body end, size field bytes)] of the elements in data[start:end]."""
    out = []
    at = start
    while at < end:
        eid, il = vint(data, at, True)
        size, sl = vint(data, at + il, False)
        body = at + il + sl
        if size == (1 << (7 * sl)) - 1:        # unknown size: to the end of the parent
            size = end - body
        out.append((eid, body, body + size, sl))
        at = body + size
    return out


def child(data, parent, eid):
    return [e for e in elements(data, parent[1], parent[2]) if e[0] == eid]


def uint(data, e):
    return int.from_bytes(data[e[1]:e[2]], 'big') if e[2] > e[1] else 0


def read_webm(data):
    top = elements(data, 0, len(data))
    head = top[0]
    seg = [e for e in top if e[0] == SEGMENT][0]
    parts = elements(data, seg[1], seg[2])
    ids = [e[0] for e in parts]
    info = [e for e in parts if e[0] == INFO][0]
    dur = child(data, info, DURATION)[0]
    tracks = [e for e in parts if e[0] == TRACKS][0]
    entries = []
    for te in child(data, tracks, TRACK_ENTRY):
        rec = {'type': uint(data, child(data, te, TRACK_TYPE)[0]), 'codec': data[child(data, te, CODEC_ID)[0][1]:child(data, te, CODEC_ID)[0][2]].decode()}
        dd = child(data, te, DEFAULT_DURATION)
        rec['defaultDuration'] = uint(data, dd[0]) if dd else None
        mx = child(data, te, MAX_BLOCK_ADDITION_ID)
        rec['maxAdd'] = uint(data, mx[0]) if mx else None
        rec['mapping'] = bool(child(data, te, BLOCK_ADDITION_MAPPING))
        cp = child(data, te, CODEC_PRIVATE)
        rec['private'] = bytes(data[cp[0][1]:cp[0][2]]) if cp else b''
        vid = child(data, te, VIDEO)
        if vid:
            am = child(data, vid[0], ALPHA_MODE)
            rec['alphaMode'] = uint(data, am[0]) if am else 0
            rec['size'] = (uint(data, child(data, vid[0], PIXEL_WIDTH)[0]), uint(data, child(data, vid[0], PIXEL_HEIGHT)[0]))
        entries.append(rec)
    seeks = {}
    for sh in [e for e in parts if e[0] == SEEK_HEAD]:
        for s in child(data, sh, SEEK):
            sid = int.from_bytes(data[child(data, s, SEEK_ID)[0][1]:child(data, s, SEEK_ID)[0][2]], 'big')
            seeks[sid] = uint(data, child(data, s, SEEK_POSITION)[0])
    clusters = []
    groups = additions = simple_video = refs = 0
    for cl in [e for e in parts if e[0] == CLUSTER]:
        clusters.append({'pos': cl[1] - 4 - cl[3] - seg[1], 'ms': uint(data, child(data, cl, TIMESTAMP)[0])})
        for b in elements(data, cl[1], cl[2]):
            if b[0] == BLOCK_GROUP:
                groups += 1
                ba = child(data, b, BLOCK_ADDITIONS)
                if ba:
                    more = child(data, ba[0], BLOCK_MORE)[0]
                    if uint(data, child(data, more, BLOCK_ADD_ID)[0]) == 1 and child(data, more, BLOCK_ADDITIONAL):
                        additions += 1
                refs += bool(child(data, b, REFERENCE_BLOCK))
            elif b[0] == SIMPLE_BLOCK and data[b[1]] & 0x7F == 1:
                simple_video += 1
    cues = []
    for cu in [e for e in parts if e[0] == CUES]:
        for cp in child(data, cu, CUE_POINT):
            pos = child(data, child(data, cp, CUE_TRACK_POSITIONS)[0], CUE_CLUSTER_POSITION)[0]
            cues.append({'ms': uint(data, child(data, cp, CUE_TIME)[0]), 'pos': uint(data, pos)})
    doc_type = [e for e in elements(data, head[1], head[2]) if e[0] == DOC_TYPE][0]
    doc_ver = [e for e in elements(data, head[1], head[2]) if e[0] == DOC_TYPE_VERSION][0]
    seg_size, _ = vint(data, seg[1] - 8, False)
    return {
        'docType': data[doc_type[1]:doc_type[2]].decode(), 'docVersion': uint(data, doc_ver),
        'segmentSize': seg_size, 'segmentEnd': seg[2], 'fileSize': len(data),
        'ids': ids, 'seeks': seeks, 'offsets': {e[0]: e[1] - 4 - e[3] - seg[1] for e in parts},
        'duration': struct.unpack('>d', bytes(data[dur[1]:dur[2]]))[0] if dur[2] - dur[1] == 8 else None,
        'scale': uint(data, child(data, info, TIMESTAMP_SCALE)[0]),
        'tracks': entries, 'clusters': clusters, 'groups': groups, 'additions': additions, 'simpleVideo': simple_video,
        'refs': refs, 'cues': cues,
    }


def check_file(c, data):
    f = read_webm(data)
    c.ok(f['docType'] == 'webm' and f['docVersion'] == 4, 'EBML: DocType webm, DocTypeVersion 4 (%r %r)' % (f['docType'], f['docVersion']))
    c.ok(f['segmentEnd'] == f['fileSize'] and f['segmentSize'] == f['fileSize'] - (f['segmentEnd'] - f['segmentSize']),
         'Segment size patched to the end of the file (%d)' % f['segmentSize'])
    c.ok(all(i in f['seeks'] and f['seeks'][i] == f['offsets'].get(i) for i in (INFO, TRACKS, CUES)),
         'SeekHead points at Info, Tracks and Cues (%r)' % {hex(k): v for k, v in f['seeks'].items()})
    c.ok(f['scale'] == 1000000 and f['duration'] is not None and abs(f['duration'] - SECONDS * 1000) < 1e-6,
         'Info: TimestampScale 1 ms, Duration %r ms = %d' % (f['duration'], SECONDS * 1000))
    video = [t for t in f['tracks'] if t['type'] == 1]
    audio = [t for t in f['tracks'] if t['type'] == 2]
    v = video[0] if video else {}
    c.ok(v.get('codec') == 'V_VP9' and v.get('defaultDuration') == round(1e9 / FPS),
         'video track: V_VP9, DefaultDuration %r ns (CFR)' % v.get('defaultDuration'))
    c.ok(v.get('alphaMode') == 1 and v.get('maxAdd') == 1 and v.get('mapping') and v.get('size') == (1280, 720),
         'video track: AlphaMode 1, MaxBlockAdditionID 1, BlockAdditionMapping, 1280×720 (%r)' % {k: v.get(k) for k in ('alphaMode', 'maxAdd', 'mapping', 'size')})
    a = audio[0] if audio else {}
    c.ok(a.get('codec') == 'A_OPUS' and a.get('private', b'')[:8] == b'OpusHead', 'audio track: A_OPUS with its OpusHead')
    key_ms = [round(i / FPS * 1000) for i in range(0, N, 2 * FPS)]
    c.ok([x['ms'] for x in f['clusters']] == key_ms, 'one cluster per key frame, at %r ms (%r)' % (key_ms, [x['ms'] for x in f['clusters']]))
    c.ok([x['ms'] for x in f['cues']] == key_ms and [x['pos'] for x in f['cues']] == [x['pos'] for x in f['clusters']],
         'Cues: one CuePoint per cluster, pointing at it (%r)' % f['cues'])
    c.ok(f['groups'] == N and f['additions'] == N and f['simpleVideo'] == 0,
         'every video frame is a BlockGroup with BlockAdditional id 1 (%d groups, %d additions)' % (f['groups'], f['additions']))
    c.ok(f['refs'] == N - len(key_ms), 'ReferenceBlock on every delta frame (%d)' % f['refs'])


def check(c, r):
    print('info  t0 = %.3f s, probe %r' % (r['t0'], r['probe']))
    fps = r['N'] / (r['ms'] / 1000)
    print('info  throughput: %d frames of 1280×720 in %.1f s = %.1f fps (render + readback + two VP9 encodes + Opus)'
          % (r['N'], r['ms'] / 1000, fps))
    res = r['result']
    c.ok(res['frames'] == N and r['N'] == N, 'N = frameCount(3 s, 30) = %d (%r)' % (N, res['frames']))
    c.ok(res['codec'] == 'vp09.00.31.08' and r['probe']['vp9Codec'] == res['codec'],
         'codec: pickVp9 at 720p30 = vp09.00.31.08, and probe().vp9Codec agrees (%r, %r)' % (res['codec'], r['probe']['vp9Codec']))
    c.ok(res['audio'] and res['audioCodec'] == 'opus', 'the song is Opus (%r)' % res['audioCodec'])
    c.ok(res['name'].endswith('.webm'), 'file name %r' % res['name'])
    c.ok(r['progress']['calls'] == N and r['progress']['last']['i'] == N, 'one progress report per frame (%r)' % r['progress'])
    enc = r['encoders']
    c.ok(len(enc) == 2, 'two video encoders (%d)' % len(enc))
    if len(enc) == 2:
        col, alp = enc
        c.ok(col['codec'] == alp['codec'] == res['codec'] and col['latencyMode'] == alp['latencyMode'] == 'quality',
             'both encoders: %s, latencyMode quality' % col['codec'])
        c.ok(alp['bitrate'] == col['bitrate'], 'the alpha encoder at the colour bitrate (ALPHA_SHARE 1: %d / %d)' % (alp['bitrate'], col['bitrate']))
        c.ok(col['chunks'] == alp['chunks'] == N and col['ts'] and alp['ts'], 'N chunks each, every chunk at ts(i)')
        c.ok(col['keys'][:2] == [0, 60] and alp['keys'][:2] == [0, 60], 'key frames forced on both at 0 and 60 (%r, %r)' % (col['keys'], alp['keys']))
    data = base64.b64decode(r['file'])
    c.ok(len(data) == res['bytes'], 'Result.bytes = file size (%d)' % len(data))
    check_file(c, data)

    d = r['demux']
    c.ok(d['codec'] == 'vp09.00.31.08' and d['alpha'] and d['n'] == N and not d['vfr'] and d['audio'] == 'A_OPUS',
         'media/matroska: %s, alpha, n = %d, constant rate, Opus track (%r)' % (d['codec'], d['n'], {k: d[k] for k in ('codec', 'alpha', 'n', 'vfr', 'audio')}))
    c.ok(d['colourBytes'] == N and d['alphaBytes'] == N and not d['bad'],
         'media/matroska: every frame\'s colour and alpha bytes are the encoders\' chunks (%d, %d of %d)' % (d['colourBytes'], d['alphaBytes'], N))
    c.ok(d['keys'] == d['wantKeys'] and d['keys'][:2] == [0, 60], 'media/matroska: key flags = both chunks key (%r)' % d['keys'])
    c.ok(d['ptsOff'] < 1e-6, 'media/matroska: frame i starts at i · DefaultDuration = i / fps within 1 µs (off by %g s)' % d['ptsOff'])
    dec = r['decoded']
    c.ok(dec['colour'] == N and dec['alpha'] == N and not dec['errors'], 'WebCodecs: %d colour and %d alpha frames decode (%r)'
         % (dec['colour'], dec['alpha'], dec['errors'][:2]))
    wrong = [(i, code) for i, code in enumerate(dec['codes']) if code != i]
    c.ok(not wrong and len(dec['codes']) == N, 'frame-exact: every decoded frame shows its own code (%r)' % wrong[:5])

    v = r['video']
    c.ok(abs(v['duration'] - SECONDS) < 0.05 and (v['width'], v['height']) == (1280, 720),
         '<video>: loads, %.3f s, %d×%d' % (v['duration'], v['width'], v['height']))
    for f in v['frames']:
        label = '<video> frame %d' % f['i']
        c.ok(f['code'] == f['i'] and f['pngCode'] == f['i'], '%s: shows code %r (PNG %r)' % (label, f['code'], f['pngCode']))
        c.ok(f['within6'] >= 0.99 and f['mean'] <= 1, '%s: alpha within ±6/255 of the PNG (%.3f %% of the pixels; mean |Δα| %.2f, p99 %d)'
             % (label, 100 * f['within6'], f['mean'], f['p99']))
        c.ok(f['clearN'] > 100000 and f['clearOver'] <= 0.001 * f['clearN'] and f['clearMax'] <= CLEAR_MAX,
             '%s: fully clear areas ≤ 3 (%d of %d px above, max %d ≤ %d)' % (label, f['clearOver'], f['clearN'], f['clearMax'], CLEAR_MAX))
        c.ok(f['coreN'] > 2000 and f['coreUnder'] <= 0.001 * f['coreN'] and f['coreMin'] >= CORE_MIN,
             '%s: glyph and pattern cores ≥ 250 (%d of %d px below, min %d ≥ %d)' % (label, f['coreUnder'], f['coreN'], f['coreMin'], CORE_MIN))
        c.ok(all(abs(s['got'] - s['want']) <= 6 for s in f['steps']), '%s: alpha steps %r' % (label, [(s['want'], s['got']) for s in f['steps']]))

    s = r['sound']
    c.ok('error' not in s, 'the Opus track decodes (%r)' % s.get('error'))
    if 'error' not in s:
        c.ok(abs(s['frames'] - s['want']) <= OPUS_PACKET, 'Opus length %d = audioFrames(N) %d ± one packet' % (s['frames'], s['want']))
        c.ok(s['rms'] > 0.05, 'the sound is not silent (RMS %.3f)' % s['rms'])
    c.ok(not r['silent']['audio'] and r['silent']['tracks'] == ['video'] and r['silent']['frames'] == 15,
         'no song: no audio track (%r)' % r['silent'])
    c.ok(not r['cancel']['ok'] and r['cancel']['code'] == 'cancelled' and r['cancel']['bytesLeft'] == 0, 'cancel: nothing kept (%r)' % r['cancel'])
    c.ok(not r['noVp9']['ok'] and r['noVp9']['code'] == 'no-vp9', 'no VP9 or VP8 encoder: ExportError no-vp9 (%r)' % r['noVp9'])


async def run(root):
    c = Checks()
    server = serve(root)
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                page = await new_page(browser, viewport={'width': 1440, 'height': 900})
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                await page.add_init_script(RECORD)
                for host in FONT_HOSTS:
                    await page.route(host, lambda route: route.abort())
                await page.goto('http://127.0.0.1:%d/index.html?fresh=1&test=1' % server.server_address[1], wait_until='load')
                await page.wait_for_function('window.__mv && window.__mv.ready')
                await page.evaluate('async () => { await window.__mv.ready; }')
                if await japanese_font_missing(page, 'webm_check.py'):
                    return ['no system font draws Japanese (see above)']
                for rel in HELPERS:
                    await page.evaluate((ROOT / rel).read_text(encoding='utf-8'))
                page.set_default_timeout(0)
                project = (ROOT / 'tests' / 'fixtures' / 'project_basic.json').read_text(encoding='utf-8')
                r = await page.evaluate('(p) => window.__webmCheck(p)', project)
                check(c, r)
                csp = await page.evaluate('() => window.__csp || []')
                c.ok(not csp, 'no CSP violations (%r)' % csp[:3])
                c.ok(not errors, 'no page errors (%r)' % errors[:3])
            finally:
                await browser.close()
    finally:
        server.shutdown()
    return c.failures


def main():
    ensure_built(ROOT)
    started = time.time()
    failures = asyncio.run(run(ROOT))
    for msg in failures:
        print('  ' + msg)
    print('webm_check.py: %s (%.1f s)' % ('FAILED (%d problems)' % len(failures) if failures else 'OK', time.time() - started))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
