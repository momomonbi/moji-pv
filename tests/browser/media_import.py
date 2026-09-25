#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test for photo and video import (DESIGN_2_1 §11.8.3 media_import.py).

Runs in the built app page (index.html?fresh=1&test=1), under its real CSP, with tests/helpers/exif_write.js,
tests/helpers/media_gen.js and the harness tests/www/media_check.js evaluated into it. Every generated fixture (the
counter videos: VP9 in WebM at 30 and 60 fps, VP9 in MP4, VFR, rotated, VP9 alpha, H.264 where the browser encodes it;
PNG with alpha, JPEG, WebP, a JPEG with EXIF orientation 6, an SVG) and every committed one (tests/fixtures/media) goes
through media/host/probe.importFile. Checked: the entry fields; the refusals and their media.err codes; routing by the
bytes (a WebM with video is media, an audio-only WebM is the song); dedupe; the IndexedDB round trip (blob = id, CRC,
index, thumbs) and pruning; the quota fallback (a faked QuotaExceededError keeps the asset in memory); and, through the
real AssetStore, frame exactness of every counter video in order, in a shuffled order and in a software export fork,
the WebM alpha merge, the EXIF-6 photo upright, and provisional frames in the preview. 0 CSP violations.
The committed H.264/VP8/VP9/AV1 clips carry placeholder payloads (MAKE.txt): they demux exactly, and the import refuses
them as media.err.codec where this browser has no decoder for the codec, else as media.err.broken.
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/media_import.py   (CI: PW_CHANNEL=chrome)
"""
import asyncio
import base64
import functools
import http.server
import os
import struct
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch, new_page  # noqa: E402  (dev/browser.py, the shared launcher)
from playwright.async_api import async_playwright  # noqa: E402

REQUIRE_H264 = os.environ.get('MV_REQUIRE_H264') == '1'
FONT_HOSTS = ('https://fonts.googleapis.com/**', 'https://fonts.gstatic.com/**')
RECORD = """
window.__csp = [];
document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || '')));
"""
HELPERS = ('tests/helpers/exif_write.js', 'tests/helpers/media_gen.js', 'tests/www/media_check.js')
COMMITTED = ROOT / 'tests' / 'fixtures' / 'media'
# The committed clips whose payloads are placeholders: refused as codec (no decoder here) or broken (decoder, bad data).
PLACEHOLDER = {'bframes.mp4': 'avc1.64000A', 'frag.mp4': 'avc1.4D400D', 'rot90.mp4': 'avc1.42C00A', 'clip.mov': 'avc1.4D4015',
               'vp9.webm': 'vp09.00.10.08', 'alpha_vp8.webm': 'vp8', 'av1.webm': 'av01.0.00M.08', 'laced.mkv': 'avc1.42C00A'}


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


# --- an audio-only WebM (Opus), written here: the app's WebM writer always has a video track ---------------------------

def ebml_id(i):
    out = b''
    while i:
        out = bytes([i & 255]) + out
        i >>= 8
    return out


def ebml_size(n):
    for length in range(1, 9):
        if n < 2 ** (7 * length) - 1:
            return (n | (1 << (7 * length))).to_bytes(length, 'big')
    raise ValueError(n)


def el(i, *parts):
    body = b''.join(parts)
    return ebml_id(i) + ebml_size(len(body)) + body


def uint(i, v):
    return el(i, v.to_bytes(max(1, (v.bit_length() + 7) // 8), 'big'))


def audio_only_webm():
    head = el(0x1a45dfa3, uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), el(0x4282, b'webm'), uint(0x4287, 4), uint(0x4285, 2))
    info = el(0x1549a966, uint(0x2ad7b1, 1000000), el(0x4489, struct.pack('>d', 100.0)))
    opus_head = b'OpusHead' + bytes([1, 2]) + struct.pack('<HIhB', 312, 48000, 0, 0)
    track = el(0xae, uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 2), el(0x86, b'A_OPUS'), el(0x63a2, opus_head),
               el(0xe1, el(0xb5, struct.pack('>d', 48000.0)), uint(0x9f, 2)))
    blocks = b''.join(el(0xa3, bytes([0x81, 0, 20 * k, 0x80]) + bytes([0xfc, 0xff, 0xfe])) for k in range(5))
    cluster = el(0x1f43b675, uint(0xe7, 0), blocks)
    return head + el(0x18538067, info, el(0x1654ae6b, track), cluster)


class Checks:
    def __init__(self):
        self.failures = []

    def ok(self, cond, what):
        print(('ok    ' if cond else 'FAIL  ') + what)
        if not cond:
            self.failures.append(what)


def check_entry(c, r, label, **want):
    if not c.ok(r and r.get('ok'), '%s imports (%r)' % (label, r if not (r and r.get('ok')) else '')):
        return
    e = r['entry']
    for k, v in want.items():
        c.ok(e.get(k) == v, '%s: %s = %r (got %r)' % (label, k, v, e.get(k)))
    c.ok(e['pv'] == 1 and e['pool'] is False and e['ai'] is None and len(e['id']) == 25 and e['id'][0] == 'a', '%s: id, pv, pool, ai' % label)


async def main():
    ensure_built(ROOT)
    server = serve(ROOT)
    base = 'http://127.0.0.1:%d/' % server.server_address[1]
    committed = {p.name: base64.b64encode(p.read_bytes()).decode('ascii') for p in sorted(COMMITTED.iterdir()) if p.name != 'MAKE.txt'}
    c = Checks()
    errors = []
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                page = await new_page(browser, viewport={'width': 1280, 'height': 800})
                page.set_default_timeout(0)
                page.on('pageerror', lambda e: errors.append(str(e)))
                await page.add_init_script(RECORD)
                for host in FONT_HOSTS:
                    await page.route(host, lambda route: route.abort())
                await page.goto(base + 'index.html?fresh=1&test=1', wait_until='load')
                await page.wait_for_function('window.__mv && window.__mv.ready')
                await page.evaluate('async () => { await window.__mv.ready; }')
                for rel in HELPERS:
                    await page.evaluate((ROOT / rel).read_text(encoding='utf-8'))
                r = await page.evaluate('([c, o]) => window.__mediaImport(c, o)',
                                        [committed, {'audioOnly': base64.b64encode(audio_only_webm()).decode('ascii')}])
                csp = await page.evaluate('() => window.__csp')
            finally:
                await browser.close()
    finally:
        server.shutdown()

    g = r['gen']
    # stills
    check_entry(c, g['png'], 'PNG with alpha', kind='image', mime='image/png', w=96, h=64, alpha=True, anim=False, rot=0, dur=None, codec=None,
                color='srgb', name='透明.png')
    check_entry(c, g['jpeg'], 'JPEG', kind='image', mime='image/jpeg', w=96, h=64, alpha=False)
    check_entry(c, g['webp'], 'WebP', kind='image', mime='image/webp', w=96, h=64, alpha=False)
    check_entry(c, g['exif6'], 'EXIF-6 JPEG (w/h swapped)', kind='image', mime='image/jpeg', w=32, h=64, rot=0)
    px = r.get('exifPixel')
    c.ok(px and px['rgb'][2] > 180 and px['rgb'][0] < 80 and px['exact'], 'EXIF-6 JPEG: the upright top-left pixel is the stored bottom-left (blue): %r' % px)
    check_entry(c, g['svg'], 'SVG (rasterized to PNG at 4096 px)', kind='image', mime='image/png', w=4096, h=2048)
    # videos
    check_entry(c, g['webm30'], 'VP9 WebM 30 fps', kind='video', mime='video/webm', w=192, h=108, fps=30, frames=45, dur=1.5, rot=0,
                alpha=False, audio=False, anim=False, codec='vp09.00.10.08')
    check_entry(c, g['webm60'], 'VP9 WebM 60 fps', kind='video', fps=60, frames=90, dur=1.5)
    check_entry(c, g['mp4_25'], 'VP9 MP4 25 fps', kind='video', mime='video/mp4', w=192, h=108, fps=25, frames=50, dur=2, codec='vp09.00.10.08')
    check_entry(c, g['vfr'], 'VFR MP4 (fps = 1 / the median frame)', kind='video', fps=30, frames=45, dur=2)
    check_entry(c, g['rot90'], 'rotated MP4', kind='video', rot=90, w=108, h=192)
    check_entry(c, g['alpha'], 'VP9 alpha WebM', kind='video', alpha=True, frames=30)
    if r['h264']:
        check_entry(c, g['h264'], 'H.264 MP4', kind='video', frames=45)
        c.ok(g['h264']['entry']['codec'].startswith('avc1.'), 'H.264 codec string %r' % g['h264']['entry']['codec'])
    elif REQUIRE_H264:
        c.ok(False, 'MV_REQUIRE_H264: this browser encodes H.264')
    else:
        print('SKIP  H.264 counter video: this browser cannot encode H.264 (CI with Google Chrome runs it)')
    idb = r['idb']
    for name in ('webm30', 'mp4_25', 'vfr', 'rot90', 'alpha', 'webm60'):
        if g[name].get('ok'):
            ix = idb['index'].get(g[name]['entry']['id'])
            c.ok(ix and ix['v'] == 1 and ix['n'] == g[name]['entry']['frames'], '%s: mediaIndex holds the sample table (%r)' % (name, ix))
    vfr_ix = idb['index'].get(g['vfr']['entry']['id']) if g['vfr'].get('ok') else None
    c.ok(vfr_ix and vfr_ix['vfr'] is True, 'VFR: the table is variable rate (%r)' % vfr_ix)
    c.ok(not idb['index'].get(g['webm30']['entry']['id'], {}).get('vfr', True), 'CFR: the table is constant rate')
    # animation (committed anim.gif: real GIF data)
    check_entry(c, r['committed']['anim.gif'], 'animated GIF', kind='image', mime='image/gif', anim=True, frames=10, dur=1.1, fps=10, w=64, h=36)
    gif_ix = idb['index'].get(r['committed']['anim.gif']['entry']['id']) if r['committed']['anim.gif'].get('ok') else None
    c.ok(gif_ix and gif_ix['anim'] and gif_ix['n'] == 10, 'animated GIF: its frame table is stored (%r)' % gif_ix)
    # refusals
    com = r['committed']
    c.ok(not com['heic.heic']['ok'] and com['heic.heic']['code'] == 'heic', 'HEIC → media.err.heic (%r)' % com['heic.heic'])
    c.ok(not com['prores.mov']['ok'] and com['prores.mov']['code'] == 'codec' and com['prores.mov']['detail'] == {'codec': 'apch'},
         'ProRes → media.err.codec naming apch (%r)' % com['prores.mov'])
    for name, codec in PLACEHOLDER.items():
        res = com[name]
        ok = not res['ok'] and (res['code'] == 'broken' or (res['code'] == 'codec' and res['detail'] == {'codec': codec}))
        c.ok(ok, '%s (placeholder frames): refused as codec %s or broken (%r)' % (name, codec, {k: res.get(k) for k in ('code', 'detail')}))
    c.ok(not g['huge']['ok'] and g['huge']['code'] == 'tooBig', '50 MP header → media.err.tooBig before decoding (%r)' % g['huge'])
    c.ok(not g['junk']['ok'] and g['junk']['code'] == 'type', 'unknown bytes → media.err.type (%r)' % g['junk'])
    c.ok(not g['cut']['ok'] and g['cut']['code'] == 'broken', 'a truncated MP4 → media.err.broken (%r)' % g['cut'])
    c.ok(not g['audioOnly']['ok'] and g['audioOnly']['code'] == 'audioOnly', 'an audio-only WebM is not media (%r)' % g['audioOnly'])
    c.ok(not g['wav']['ok'] and g['wav']['code'] == 'audioOnly', 'a WAV is not media (%r)' % g['wav'])
    # routing
    want = {'webmVideo': 'media', 'webmAudio': 'song', 'mp4Video': 'media', 'png': 'media', 'wav': 'song', 'json': 'project',
            'lrc': 'lyrics', 'pkg': 'package', 'gif': 'media', 'heic': 'media'}
    c.ok(r['routes'] == want, 'routing by the bytes: %r' % r['routes'])
    # dedupe
    d = r['dedupe']
    c.ok(d['ok'] and d['fresh'] is False and d['entry']['id'] == g['png']['entry']['id'] and r['dedupeStored'] == 0,
         'dedupe: the same bytes give the same id, fresh false, nothing stored again (%r, %r)' % (d.get('fresh'), r['dedupeStored']))
    # IndexedDB round trip
    c.ok(idb['version'] == 2 and idb['stores'] == ['media', 'mediaIndex', 'songs', 'thumbs', 'works'], 'IndexedDB v2 stores %r' % idb['stores'])
    for name in ('png', 'jpeg', 'webp', 'exif6', 'svg', 'webm30', 'mp4_25', 'vfr', 'rot90', 'alpha'):
        e = g[name].get('entry')
        if not e:
            continue
        m = idb['media'].get(e['id'])
        c.ok(m and m['idOk'] and m['crcOk'] and m['bytes'] == e['bytes'] == m['size'] and m['mime'] == e['mime'],
             '%s: the stored blob hashes to its id, CRC and size match (%r)' % (name, m))
        th = idb['thumbs'].get(e['id'])
        c.ok(th and th['poster'] and max(th['poster']) <= 320 and th['v'] == 1, '%s: a poster (≤ 320 px) is stored (%r)' % (name, th))
        if e['kind'] == 'video':
            c.ok(th and th['strip'] and th['tiles'] == 12 and th['strip'][0] >= 12 * min(th['strip'][1], 1), '%s: a 12-tile filmstrip (%r)' % (name, th))
    # frame exactness through the AssetStore
    for name, res in r['exact'].items():
        for mode in ('sequential', 'random', 'fork', 'baked', 'bakedRandom', 'bakedWhole'):
            c.ok(res[mode] == [], '%s: every frame exact, index k shows code k, rot as stored (%s): %r' % (name, mode, res[mode][:4]))
        rt = res['routes']
        # software VP9 / H.264 frames are 8-bit I420: the half copy takes the JS route, the whole frame the canvas route
        c.ok(rt['yuv'] >= rt['n'] and rt['canvas'] >= rt['n'], '%s: the baked copies took both routes (JS 4:2:0 at 1/2, canvas at 1/1): %r' % (name, rt))
        print('info  %s: %d ms for the six passes' % (name, res['ms']))
    c.ok(set(r['exact']) >= {'webm30', 'mp4_25', 'vfr', 'rot90', 'webm60'}, 'exactness ran for every counter video: %r' % sorted(r['exact']))
    ap = r.get('alphaProbe') or []
    c.ok(len(ap) == 3 and all(p['exact'] and abs(p['inside'] - 128) <= 12 and p['outside'] <= 4 for p in ap),
         'WebM alpha: the merged frame is 128 inside the square and clear outside: %r' % ap)
    an = r.get('animProbe') or []
    c.ok(len(an) == 5 and all(p['exact'] and p['index'] == p['want'] and p['bar'] == 6 * p['want'] for p in an),
         'animation through the store: m picks the frame by its durations, and that frame is drawn: %r' % an)
    la = r.get('lookAhead') or {}
    c.ok(la.get('k16') == 16 and la.get('k17') == 17, 'preview look-ahead: want() decodes frames 16 and 17 before they are drawn (%r)' % la)
    lf = r.get('loopFeed') or {}
    c.ok(lf.get('fed', 999) <= 5 and lf.get('seeks', 99) == 0 and lf.get('i43') == lf.get('code43') == 43 and lf.get('i0') == lf.get('code0') == 0,
         'over a loop, the look-ahead of the clip\'s start never sends the decoder back under its last frames: %r' % lf)
    pb = r.get('previewBake') or {}
    ans, shown, hinted = pb.get('answers') or [], pb.get('shown'), pb.get('hinted')
    early = [x for x in ans[:-1] if x is not None]
    c.ok(early and all(x['exact'] is False for x in early) and shown and shown['blur'] > 0 and shown['index'] == 20 and shown['code'] == 20,
         'preview with a blur: provisional (poster, unbaked frame) until the baked copy of frame 20 (exact, blurred, code 20): %r → %r' % (ans[:5], shown))
    c.ok(hinted and hinted['exact'] and hinted['blur'] > 0 and hinted['index'] == 21 and hinted['code'] == 21,
         'preview look-ahead with a blur: want() bakes the next hinted frame before it is drawn: %r' % hinted)
    c.ok(0 < pb.get('bakedMost', 0) <= 5, 'baked copies go with their source frames (at most HOLD + shown + pinned held): %r' % pb.get('bakedMost'))
    po = r.get('provisionalOrder') or {}
    first, unbaked, held_at, back, copies = po.get('first'), po.get('heldUnbaked'), po.get('heldAt'), po.get('back'), po.get('copies') or {}
    c.ok(first and first['index'] == 15 and first['exact'] is False,
         'preview scrub to frame 40 with a blur: first the nearest held frame at or before it (15), provisional: %r' % first)
    c.ok(unbaked and unbaked['index'] == 40 and unbaked['exact'] is False and unbaked['blur'] == 0,
         'frame 40 held, its bake not finished: 40 unbaked (blur 0, the engine blurs it), provisional — never another frame\'s '
         'baked copy: %r' % unbaked)
    c.ok(held_at and held_at['index'] == 40 and held_at['exact'] and held_at['blur'] > 0, 'then frame 40 baked, exact: %r' % held_at)
    c.ok(po.get('hintBakes', 0) >= 3, 'want() alone bakes the hinted frames as the session gets them: %r bakes' % po.get('hintBakes'))
    c.ok(back and back['index'] == 40 and back['exact'] is False,
         'scrubbing back to frame 3 (not held, nothing held before it) shows the last frame shown (40), provisional: %r' % back)
    c.ok(copies.get('baked', 0) > 0 and copies.get('over', 1) == 0 and (po.get('paused') or {}).get('baked', 99) <= (po.get('paused') or {}).get('held', 0),
         'baked copies never outnumber the held frames (closed with their source frames), playing and paused: %r, paused %r' % (
             copies, {k: (po.get('paused') or {}).get(k) for k in ('baked', 'held')}))
    hr = r.get('hintRoom') or {}
    c.ok(hr.get('hold') == 3 and hr.get('heldHinted') == hr['hold'] + 2 and hr.get('fedHinted', 99) <= hr['hold'] + 1 and hr.get('seeks') == 0,
         'preview look-ahead of 8 frames: decoded only while at most HOLD frames still to be shown are held (the shown one + '
         'HOLD + 1 held, nothing closed, no seek): %r' % hr)
    c.ok(hr.get('exact11') and hr.get('fedAfterShow') in (1, 2) and hr.get('exact15'),
         'showing the next frame lets the look-ahead decode one more (frame 15), with no further want(): %r' % hr)
    el = r.get('exportLookAhead') or {}
    c.ok(el.get('wrong') == [] and el.get('seeks', 99) == 0 and 0 < el.get('fed', 999) <= 43,
         'an export\'s look-ahead of every frame up to t + 3/fps, with a render\'s time and a pause between frames: each frame '
         'decoded once, in order (no seek, ≤ 43 chunks for 40 frames): fed %r, seeks %r, wrong %r' % (el.get('fed'), el.get('seeks'), el.get('wrong')))
    br = r.get('bakeRelink') or {}
    c.ok(br.get('failed') and br['failed']['index'] == 27 and br['failed']['exact'] and br['failed']['blur'] == 0,
         'a bake that fails leaves the exact frame unbaked (blur 0: the engine blurs it): %r' % br.get('failed'))
    c.ok(br.get('again') and br['again']['index'] == 27 and br['again']['blur'] > 0 and br.get('next') and br['next']['blur'] > 0,
         'after forget(id) (a relink) that frame is baked again: %r, then %r' % (br.get('again'), br.get('next')))
    pv = r.get('provisional') or {}
    c.ok(pv.get('first') is None or pv['first']['exact'] is False, 'preview: the first answer is provisional (%r)' % pv.get('first'))
    c.ok(pv.get('later') and pv['later']['exact'] and pv['later']['index'] == 30 and pv['later']['code'] == 30,
         'preview: the exact frame follows (%r)' % pv.get('later'))
    c.ok(pv.get('missing') == {'state': 'missing'} and pv.get('has') == [True, False] and pv.get('info') == {'state': 'ok'},
         'store info/has: ok and missing (%r)' % pv)
    # quota fallback
    q = r['quota']
    c.ok(q['result']['ok'] and 'quota' in q['result']['notes'] and q.get('memory') and q.get('has') and not q.get('inIdb'),
         'QuotaExceededError: the asset stays in memory for this session (%r)' % q)
    # pruning
    pr = r['prune']
    c.ok(pr['looseBefore'] and pr['looseAfter'] == [False, False, False], 'prune: an asset nothing uses leaves media, mediaIndex and thumbs (%r)' % pr)
    c.ok(pr['keptAfter'] is True, 'prune: an asset of a kept work stays (%r)' % pr)
    print('info  hashing + CRC-32 (MB/s): crypto.subtle %(hashSubtleMBs)d, streaming %(hashStreamMBs)d' % r['perf'])
    c.ok(not errors, 'no page errors %r' % errors[:3])
    c.ok(not csp, '0 CSP violations %r' % csp)
    print('media_import.py: %s' % ('FAILED (%d)' % len(c.failures) if c.failures else 'OK'))
    return 1 if c.failures else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
