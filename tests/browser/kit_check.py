#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test for the Filmora kit: export/host/kit (DESIGN_2_1 §13.9, §13.12 kit_check.py).

Runs in the built app page (index.html?fresh=1&test=1) under its real CSP, with tests/helpers/exif_write.js, media_gen.js,
tests/www/webm_check.js and the harness tests/www/kit_check.js evaluated into it. project_basic with a still photo as its
background (a JPEG imported through media/host/probe into this device's store, pooled, pinned as the work's ground),
screen effects and texture pinned off, 2 s from its first lyric cut, 1080p30, every kit file on, a tone as the song; the
real engine with a real AssetStore (shared by the kit's two engine forks). The kit goes into an OPFS folder through
createDirSink. Checked:
  - the files: exactly kitFiles' names (ASCII suffixes after the title) — the main MP4, _overlay.webm, _bg.mp4,
    _green.mp4, .srt, .lrc, .wav (no AAC encoder: Chromium, Chrome on Linux) and README_Filmora.txt — in the folder,
    with Result.files, one progress report per frame and the phases;
  - every MP4, read here by a separate box reader: the video sample entry avc1 with the profile pickAvc got (High
    first; avcC) where H.264 encodes, else vp09 (the VP9 fallback of export_check.py); timescale = fps and every stts delta 1 (CFR); key frames
    (stss) at every 2·fps (an encoder may add one at a scene change); 60 samples; the main MP4 has AAC (mp4a) when the
    browser encodes AAC, else no audio track and the WAV; the background and green MP4s never have sound;
  - the WAV: RIFF PCM 16-bit, 48 kHz, stereo, exactly audioFrames(N) frames, the tone's samples from t0 (sample-exact);
  - decoded (media/isobmff + VideoDecoder, in the colour space the file declares): the background has N frames; the green
    screen's corners are #00B140 ± 4 and most of the frame is; the overlay (media/matroska): VP9 with alpha on every
    frame, no sound, and Chrome shows it transparent around the words;
  - background under overlay (the frames the PNG export encodes, no codec loss) equals the full render: MAE ≤ 2/255;
  - the pre-flight lists kit-fps, and not layers-approx (no screen effects, no world seams in this range);
  - SRT: BOM, CRLF, parses, and its cues are plan.lines relative to the export range (§13.8 rules); LRC: the bytes of
    export/subtitles.lrc, song times; README: the real names, size, fps and #00B140, Japanese then English;
  - without folder access (showDirectoryPicker hidden): the kit-memory pre-flight item, then one store-only ZIP
    '<base>_filmora.zip' with the same files (AAC forced away, so the WAV is in it);
  - cancel removes the folder and every file in it; no page errors, no CSP violations.
It prints the kit's throughput (frames per second over all its outputs) for NOTES.
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/kit_check.py   (CI: PW_CHANNEL=chrome, MV_REQUIRE_H264=1)
"""
import asyncio
import base64
import io
import math
import os
import re
import struct
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
sys.path.insert(0, str(ROOT / 'tests' / 'browser'))
from browser import launch, new_page, japanese_font_missing  # noqa: E402  (dev/browser.py, the shared launcher)
from playwright.async_api import async_playwright  # noqa: E402
from webm_check import serve, ensure_built, Checks, FONT_HOSTS, RECORD  # noqa: E402

REQUIRE_H264 = os.environ.get('MV_REQUIRE_H264') == '1'
HELPERS = ('tests/helpers/exif_write.js', 'tests/helpers/media_gen.js', 'tests/www/webm_check.js', 'tests/www/kit_check.js')
FPS, N, RATE = 30, 60, 48000
SUFFIXES = {'main': '.mp4', 'overlay': '_overlay.webm', 'bg': '_bg.mp4', 'green': '_green.mp4', 'srt': '.srt', 'lrc': '.lrc',
            'wav': '.wav'}


# --- MP4 boxes -----------------------------------------------------------------------------------------------------

def boxes(data, start, end):
    at = start
    while at + 8 <= end:
        size, kind = struct.unpack('>I4s', data[at:at + 8])
        head = 8
        if size == 1:
            size = struct.unpack('>Q', data[at + 8:at + 16])[0]
            head = 16
        elif size == 0:
            size = end - at
        yield kind.decode('latin-1'), at + head, at + size
        at += size


def find(data, parent, *path):
    start, end = parent
    for name in path:
        hit = None
        for kind, body, stop in boxes(data, start, end):
            if kind == name:
                hit = (body, stop)
                break
        if hit is None:
            return None
        start, end = hit
    return start, end


def read_mp4(data):
    """→ [track: { kind, timescale, entry, profile, stts: [(count, delta)], stss: [1-based] | None, samples }]."""
    moov = find(data, (0, len(data)), 'moov')
    tracks = []
    for kind, body, stop in boxes(data, *moov):
        if kind != 'trak':
            continue
        mdia = find(data, (body, stop), 'mdia')
        mdhd = find(data, mdia, 'mdhd')
        version = data[mdhd[0]]
        timescale = struct.unpack('>I', data[mdhd[0] + (20 if version == 1 else 12):][:4])[0]
        hdlr = find(data, mdia, 'hdlr')
        handler = data[hdlr[0] + 8:hdlr[0] + 12].decode('latin-1')
        stbl = find(data, mdia, 'minf', 'stbl')
        stsd = find(data, stbl, 'stsd')
        entry = next(boxes(data, stsd[0] + 8, stsd[1]))
        profile = None
        if entry[0] == 'avc1':
            avcc = find(data, (entry[1] + 78, entry[2]), 'avcC')
            profile = data[avcc[0] + 1] if avcc else None
        stts = find(data, stbl, 'stts')
        n = struct.unpack('>I', data[stts[0] + 4:stts[0] + 8])[0]
        runs = [struct.unpack('>II', data[stts[0] + 8 + 8 * k:stts[0] + 16 + 8 * k]) for k in range(n)]
        stss = find(data, stbl, 'stss')
        keys = None
        if stss:
            m = struct.unpack('>I', data[stss[0] + 4:stss[0] + 8])[0]
            keys = [struct.unpack('>I', data[stss[0] + 8 + 4 * k:stss[0] + 12 + 4 * k])[0] for k in range(m)]
        stsz = find(data, stbl, 'stsz')
        samples = struct.unpack('>I', data[stsz[0] + 8:stsz[0] + 12])[0]
        tracks.append({'kind': handler, 'timescale': timescale, 'entry': entry[0], 'profile': profile, 'stts': runs, 'stss': keys,
                       'samples': samples})
    return tracks


def check_mp4(c, label, data, codec, want_audio):
    tracks = read_mp4(data)
    video = [t for t in tracks if t['kind'] == 'vide']
    audio = [t for t in tracks if t['kind'] == 'soun']
    v = video[0] if video else {}
    if codec.startswith('avc1'):
        # pickAvc tries High, then Main, then Baseline: the file carries the profile the browser accepted
        want = int(codec[5:7], 16)
        c.ok(v.get('entry') == 'avc1' and v.get('profile') == want, '%s: H.264 %s (avc1, avcC profile 0x%02X)'
             % (label, {0x64: 'High', 0x4D: 'Main', 0x42: 'Baseline'}.get(want, codec), v.get('profile') or 0))
    else:
        c.ok(v.get('entry') == 'vp09', '%s: the VP9 fallback (%r; no H.264 encoder here)' % (label, v.get('entry')))
    c.ok(v.get('timescale') == FPS and v.get('stts') == [(N, 1)], '%s: CFR: timescale %r = fps, stts %r = [(%d, 1)]'
         % (label, v.get('timescale'), v.get('stts'), N))
    keys = v.get('stss') or []
    forced = list(range(1, N + 1, 2 * FPS))
    gaps = [b - a for a, b in zip(keys, keys[1:] + [N + 1])]
    c.ok(set(forced) <= set(keys) and max(gaps or [N + 1]) <= 2 * FPS,
         '%s: a key frame every 2·fps (stss %r ⊇ %r; the encoder may add one at a scene change)' % (label, keys, forced))
    c.ok(v.get('samples') == N, '%s: %d video samples (%r)' % (label, N, v.get('samples')))
    if want_audio:
        c.ok(len(audio) == 1 and audio[0]['entry'] == 'mp4a', '%s: AAC track (%r)' % (label, [t['entry'] for t in audio]))
    else:
        c.ok(not audio, '%s: no audio track (%r)' % (label, [t['entry'] for t in audio]))


def check_wav(c, data, t0):
    riff, size, wave = struct.unpack('<4sI4s', data[:12])
    fmt = struct.unpack('<4sIHHIIHH', data[12:36])
    tag, length = struct.unpack('<4sI', data[36:44])
    frames = N * RATE // FPS
    c.ok(riff == b'RIFF' and wave == b'WAVE' and size == len(data) - 8, 'WAV: RIFF/WAVE, size %d' % size)
    c.ok(fmt[0] == b'fmt ' and fmt[2:] == (1, 2, RATE, RATE * 4, 4, 16), 'WAV: PCM 16-bit, 48 kHz, stereo (%r)' % (fmt[2:],))
    c.ok(tag == b'data' and length == frames * 4 and len(data) == 44 + frames * 4,
         'WAV: exactly audioFrames(N) = %d frames (%d)' % (frames, length // 4))
    start = round(t0 * RATE)
    worst = 0
    for i in range(0, frames, 997):
        left, right = struct.unpack('<hh', data[44 + 4 * i:48 + 4 * i])
        want_l = round(0.3 * math.sin(2 * math.pi * 440 * (start + i) / RATE) * 32767)
        want_r = round(0.3 * math.sin(2 * math.pi * 660 * (start + i) / RATE) * 32767)
        worst = max(worst, abs(left - want_l), abs(right - want_r))
    c.ok(worst <= 1, 'WAV: the song from t0, sample-exact (the tone at sample %d on; worst %d LSB)' % (start, worst))


# --- subtitles --------------------------------------------------------------------------------------------------------

def srt_ms(stamp):
    m = re.fullmatch(r'(\d{2,}):([0-5]\d):([0-5]\d),(\d{3})', stamp)
    h, mi, s, ms = (int(x) for x in m.groups())
    return ((h * 60 + mi) * 60 + s) * 1000 + ms


def parse_srt(text):
    assert '\n' not in text.replace('\r\n', ''), 'CRLF only'
    cues = []
    for block in text.split('\r\n\r\n'):
        if not block:
            continue
        num, times, body = block.split('\r\n')
        a, b = times.split(' --> ')
        cues.append((int(num), srt_ms(a), srt_ms(b), body))
    return cues


def expected_cues(lines, t0, t1):
    """§13.8: lines overlapping [t0, t1), start max(0, l.t0 − t0), end min(l.t1, t1) − t0 (ms, halves up), in time order,
    cut back to the next start, then < 100 ms dropped."""
    cues = []
    for line in lines:
        text = ' '.join(line['text'].split())
        if not (line['t0'] < t1 and line['t1'] > t0) or not text:
            continue
        a, b, lo, hi = (round(x * 1e6) for x in (line['t0'], line['t1'], t0, t1))   # whole µs, then ms (halves up)
        start = (max(0, a - lo) + 500) // 1000
        end = (min(b, hi) - lo + 500) // 1000
        cues.append([start, end, text])
    cues.sort(key=lambda x: x[0])
    for i in range(len(cues) - 1):
        cues[i][1] = min(cues[i][1], cues[i + 1][0])
    return [(k + 1, a, b, t) for k, (a, b, t) in enumerate([x for x in cues if x[1] - x[0] >= 100])]


def lrc_tag(s):
    cs = max(0, round(s * 100))
    return '[%02d:%02d.%02d]' % (cs // 6000, cs // 100 % 60, cs % 100)


def check(c, r):
    base = r['base']
    h264 = not r['fallback']
    if REQUIRE_H264:
        c.ok(h264, 'MV_REQUIRE_H264: this browser encodes H.264 (%r)' % r['probe'].get('codec'))
    if not h264:
        print('SKIP  H.264 in the kit: this browser cannot encode H.264; its MP4s are checked with VP9 in MP4 (CI runs H.264)')
    aac = r['result']['audio'] == 'aac'
    print('info  probe %r; kit audio %s' % (r['probe'], r['result']['audio']))
    print('info  throughput: %d frames × %d video files at %d×%d in %.1f s = %.1f fps (%.1f output frames/s)'
          % (N, 4, r['w'], r['h'], r['ms'] / 1000, N / (r['ms'] / 1000), 4 * N / (r['ms'] / 1000)))
    kinds = ['main', 'overlay', 'bg', 'green', 'srt', 'lrc'] + ([] if aac else ['wav'])
    want = [base + SUFFIXES[k] for k in kinds] + ['README_Filmora.txt']
    c.ok([f['name'] for f in r['result']['files']] == want, 'Result.files: %r' % [f['name'] for f in r['result']['files']])
    c.ok(r['names'] == sorted(want) and r['kitFiles'] == want, 'the folder holds exactly those files, as kitFiles names them (%r)' % r['names'])
    c.ok(all(re.fullmatch(r'(_overlay\.webm|_bg\.mp4|_green\.mp4|\.mp4|\.srt|\.lrc|\.wav)', n[len(base):]) for n in want[:-1]),
         'every name is the title plus an ASCII suffix')
    c.ok(r['result']['audio'] == ('aac' if r['probe']['audioCodec'] == 'mp4a.40.2' else 'wav'),
         'audio: AAC where it encodes, else the WAV (%r, probe %r)' % (r['result']['audio'], r['probe']['audioCodec']))
    c.ok(r['result']['frames'] == N == r['N'] and not r['result']['blob'] and r['result']['folder'] == base + '_filmora',
         'N = %d, no ZIP, folder %r' % (N, r['result']['folder']))
    c.ok(r['progress']['frames'] == N and r['progress']['phases'] == ['video', 'files'], 'progress: once per frame, then the files (%r)' % r['progress'])
    c.ok(r['result']['overlayCodec'] == 'vp09.00.40.08', 'overlay codec pickVp9(1080p30) (%r)' % r['result']['overlayCodec'])

    codec = r['result']['codec']
    c.ok(codec == r['probe']['codec'] if h264 else codec.startswith('vp09'),
         'the kit\'s MP4 codec %r: the first of pickAvc (High, Main, Baseline) that encodes (probe %r)' % (codec, r['probe']['codec']))
    check_mp4(c, 'main MP4', base64.b64decode(r['mp4']['main']), codec, aac)
    check_mp4(c, '_bg.mp4', base64.b64decode(r['mp4']['bg']), codec, False)
    check_mp4(c, '_green.mp4', base64.b64decode(r['mp4']['green']), codec, False)
    if aac:
        c.ok('wav' not in r, 'AAC: no WAV file')
    else:
        check_wav(c, base64.b64decode(r['wav']), r['t0'])
    m = r['main']
    c.ok(m['decoded'] == N and not m['errors'] and (m['codec'].startswith('avc1') if h264 else m['codec'].startswith('vp09')),
         'main MP4 decodes: %d frames, %s' % (m['decoded'], m['codec']))
    bg = r['bg']
    c.ok(bg['n'] == N and bg['decoded'] == N and not bg['errors'], '_bg.mp4 has N frames (%d table, %d decoded)' % (bg['n'], bg['decoded']))
    g = r['green']
    c.ok(g['decoded'] == N and not g['errors'], '_green.mp4 decodes N frames (%d)' % g['decoded'])
    c.ok(g.get('corners', 99) <= 4 and g.get('share', 0) >= 0.5, '_green.mp4: background #00B140 ± 4 (corners off by %r, %.0f %% of the frame)'
         % (g.get('corners'), 100 * g.get('share', 0)))
    ov = r['overlay']
    c.ok(ov['alpha'] and ov['n'] == N and ov['alphaFrames'] == N and ov['audio'] == 0 and ov['codec'].startswith('vp09'),
         '_overlay.webm: VP9 with alpha on all %d frames, no sound (%r)' % (N, ov))
    s = ov.get('shown') or {}
    c.ok(s.get('corner') == 0 and s.get('clear', 0) > 0.3 and s.get('solid', 0) > 500, '_overlay.webm in Chrome: transparent around the words (%r)' % s)
    for x in r['composite']:
        c.ok(x['mae'] <= 2 and x['overlayPx'] > 1000 and x['bgDiffers'] > 1000,
             'frame %d: background under overlay = the full render, MAE %.3f ≤ 2 (max %d; overlay %d px)' % (x['i'], x['mae'], x['max'], x['overlayPx']))
    c.ok('kit-fps' in r['preflight'] and 'layers-approx' not in r['preflight'] and 'no-vp9' not in r['preflight'],
         'pre-flight: kit-fps, no layers-approx (%r)' % r['preflight'])

    # subtitles and the README
    srt = r['srt']
    c.ok(srt['bom'], 'SRT: UTF-8 with a BOM')
    try:
        cues = parse_srt(srt['text'])
    except Exception as e:  # noqa: BLE001
        cues = None
        c.ok(False, 'SRT parses (%s)' % e)
    want_cues = expected_cues(r['lines'], r['t0'], r['t1'])
    c.ok(cues is not None and cues == want_cues and len(want_cues) >= 1,
         'SRT: the cues are plan.lines relative to the export range (%r)' % cues)
    lrc = r['lrc']
    first = r['lines'][0]
    c.ok(not lrc['bom'] and lrc['text'] == r['lrcWant'] and lrc_tag(first['t0']) + first['text'] in lrc['text'],
         'LRC: export/subtitles.lrc, in song times (%r…)' % lrc['text'][:40])
    rd = r['readme']
    text = rd['text']
    names_ok = all(n in text for n in want[:-1])
    c.ok(rd['bom'] and '\r\n' in text and names_ok and '%d×%d' % (r['w'], r['h']) in text and '%dfps' % FPS in text
         and '#00B140' in text and '%d fps' % FPS in text,
         'README: BOM, CRLF, every file name, %d×%d, %d fps, #00B140' % (r['w'], r['h'], FPS))
    c.ok(text.index('文字PVメーカー') < text.index('Moji PV Maker'), 'README: Japanese, then English')

    # the ZIP path
    z = r['zip']
    c.ok(r['canDirectory'] is False and len(r['memoryPreflight']) == 1, 'no folder access: the kit-memory pre-flight item (%r)' % r['memoryPreflight'])
    zwant = [base + SUFFIXES[k] for k in ['main', 'overlay', 'bg', 'green', 'srt', 'lrc', 'wav']] + ['README_Filmora.txt']
    archive = zipfile.ZipFile(io.BytesIO(base64.b64decode(z['data'])))
    infos = archive.infolist()
    c.ok(z['name'] == base + '_filmora.zip' and z['audio'] == 'wav', 'ZIP: %r, the WAV with AAC forced away (%r)' % (z['name'], z['audio']))
    c.ok([i.filename for i in infos] == zwant == z['files'], 'ZIP: the same files, in order (%r)' % [i.filename for i in infos])
    c.ok(all(i.compress_type == zipfile.ZIP_STORED for i in infos) and archive.testzip() is None, 'ZIP: store-only, every CRC matches')
    zmain = read_mp4(archive.read(base + '.mp4'))
    c.ok(zmain and zmain[0]['stts'] == [(N, 1)] and not [t for t in zmain if t['kind'] == 'soun'], 'ZIP: its MP4 is the same length, without sound')
    check_wav(c, archive.read(base + '.wav'), r['t0'])
    c.ok(not r['cancel']['ok'] and r['cancel']['code'] == 'cancelled' and r['cancel']['folderLeft'] is False,
         'cancel: ExportError cancelled, the folder is removed (%r)' % r['cancel'])


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
                if await japanese_font_missing(page, 'kit_check.py'):
                    return ['no system font draws Japanese (see above)']
                for rel in HELPERS:
                    await page.evaluate((ROOT / rel).read_text(encoding='utf-8'))
                page.set_default_timeout(0)
                project = (ROOT / 'tests' / 'fixtures' / 'project_basic.json').read_text(encoding='utf-8')
                r = await page.evaluate('([p, o]) => window.__kitCheck(p, o)', [project, {'requireH264': REQUIRE_H264}])
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
    print('kit_check.py: %s (%.1f s)' % ('FAILED (%d problems)' % len(failures) if failures else 'OK', time.time() - started))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
