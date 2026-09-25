#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: transparency and the backdrop modes through the real export path.

The app page (built from the sources, or a staging copy with --root) opens the fixture project_basic, plays it at 720p30
over a range of two frames at a lyric cut's hero time, and exports PNG sequences from step ④ exactly as a user would:
the format and background controls of the step, [書き出す], export/host/png on a fork of the engine, the ZIP from the
memory sink (File System Access is switched off so no save dialog opens). The PNGs are decoded here (stdlib only) and
checked (DESIGN §4.19.4, SPEC §6 background modes, §7 transparent PNG sequence):

  透過PNG      choosing it makes the backdrop 透明; RGBA frames; the frame corners have alpha 0; the interior of the large
               glyphs has alpha 255; on the anti-aliased ring around the glyphs the un-premultiplied colour is the ink
               colour within the 8-bit rounding of premultiplied storage (no dark fringe)
  glow         text style グロー: the halo around the glyphs is partly transparent (0 < a < 255), never opaque
  グリーンバック  choosing it keeps a PNG sequence (now opaque); the corners are exactly #00B140
  黒（白文字）   the corners are exactly #000000, the glyphs exactly #FFFFFF and nothing in the frame has a colour

To keep the pixels about transparency only, the document pins what could reach the corners or tint the glyphs: no
other decorations, screen effects, texture or atmosphere, the fallback composition and motions, no flash or shake, a large
text size and (except for the black check) one ink for every glyph. It also asserts no page errors and no CSP violations.

DESIGN_2_1 §11.8.3 (+): the project also holds a photo frame (photoFrame, shape free: the picture's own alpha) of a PNG
with alpha (tests/helpers/media_gen.js stills: opaque on the left, a half-transparent square, cleared elsewhere), in the
lower right corner. The glyph checks above leave its rect out, and the 透過PNG frames keep its alpha exactly as the PNG
has it (opaque 255, the square 128 ± 3, cleared 0), as PNG glyphs keep theirs; over the green screen and black it is
drawn too (§11.4.10). The export's engine is a fork of the app's, with a fork of the app's AssetStore (ui/boot).
Google Fonts are blocked, so the glyphs come from the system fonts: without a Japanese font the test stops at once with
one message saying so (dev/browser.py japanese_font_missing).

Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/transparent_check.py [--root DIR] [--keep DIR]
"""
import argparse
import asyncio
import base64
import functools
import http.server
import io
import json
import math
import struct
import subprocess
import sys
import threading
import time
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch, new_page, japanese_font_missing  # noqa: E402  (dev/browser.py, the shared launcher)
from playwright.async_api import async_playwright  # noqa: E402

FONT_HOSTS = ('https://fonts.googleapis.com/**', 'https://fonts.gstatic.com/**')
HELPERS = ('tests/helpers/exif_write.js', 'tests/helpers/media_gen.js', 'tests/www/media_parts.js')
PNG_SIZE = (96, 64)                  # the photo frame's PNG (media_gen.js stills): its probes in its own pixels
PNG_OPAQUE = ((30, 25), (5, 5), (50, 55))
PNG_HALF = ((75, 35), (68, 28), (82, 42))
PNG_CLEAR = ((93, 5), (93, 58), (65, 58))
# Records CSP violations; hides File System Access so the export goes to a memory sink (no save dialog in a test).
INIT = """
window.__csp = [];
document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
"""
INK = (0xF2, 0xC2, 0x30)             # the one ink of every glyph (work:el.text.fill), light so a dark fringe would show
CHROMA = (0x00, 0xB1, 0x40)
FPS, FRAMES, SHORT = 30, 2, 720
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
MIN_RING_ALPHA = 48                  # below this, 8-bit premultiplied storage cannot say much about the colour
OPAQUE_DIGITS = bytes([0x30] * 255 + [0x31])   # alpha byte → '1' when 255, else '0' (for int(…, 2))


# --- serving the page -------------------------------------------------------------------------------------------------

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


# --- PNG decoding (stdlib only; CI installs nothing but Playwright) -------------------------------------------------------

def swar_add(x, y, lo, hi):
    """Byte-wise (x + y) mod 256 of two big-endian byte strings held as ints, without carries across bytes."""
    return ((x & lo) + (y & lo)) ^ ((x ^ y) & hi)


def unfilter_sub(row, bpp, lo, hi, width):
    """Filter 1: a prefix sum over the pixels, by doubling steps (Hillis–Steele) on the whole row at once."""
    r = int.from_bytes(row, 'big')
    step = 1
    while step < width:
        r = swar_add(r, r >> (8 * bpp * step), lo, hi)
        step *= 2
    return r


def unfilter_row(kind, row, prev, bpp, width):
    """One scanline of 8-bit RGB/RGBA (PNG filters 0–4); prev is the previous unfiltered row."""
    n = len(row)
    if kind == 0:
        return bytes(row)
    if not any(row) and not any(prev):
        return bytes(n)              # every filter maps zeros over zeros to zeros (most of a transparent frame)
    lo = int.from_bytes(b'\x7f' * n, 'big')
    hi = int.from_bytes(b'\x80' * n, 'big')
    if kind == 1:
        return unfilter_sub(row, bpp, lo, hi, width).to_bytes(n, 'big')
    if kind == 2:
        return swar_add(int.from_bytes(row, 'big'), int.from_bytes(prev, 'big'), lo, hi).to_bytes(n, 'big')
    out = bytearray(row)
    if kind == 3:
        for i in range(n):
            left = out[i - bpp] if i >= bpp else 0
            out[i] = (out[i] + ((left + prev[i]) >> 1)) & 0xFF
        return bytes(out)
    if kind == 4:
        for i in range(n):
            a = out[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            p = a + b - c
            pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
            pred = a if pa <= pb and pa <= pc else b if pb <= pc else c
            out[i] = (out[i] + pred) & 0xFF
        return bytes(out)
    raise ValueError('bad PNG filter %d' % kind)


def decode_png(data):
    """→ (width, height, colour type, RGBA bytes). 8-bit RGB (2) or RGBA (6), not interlaced."""
    if data[:8] != PNG_SIGNATURE:
        raise ValueError('not a PNG')
    pos, idat, head = 8, [], None
    while pos < len(data):
        (length,) = struct.unpack('>I', data[pos:pos + 4])
        kind, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b'IHDR':
            head = struct.unpack('>IIBBBBB', body)
        elif kind == b'IDAT':
            idat.append(body)
        elif kind == b'IEND':
            break
    width, height, depth, ctype, _comp, _filt, interlace = head
    if depth != 8 or ctype not in (2, 6) or interlace:
        raise ValueError('unsupported PNG: depth %d, colour type %d, interlace %d' % (depth, ctype, interlace))
    bpp = 4 if ctype == 6 else 3
    raw = zlib.decompress(b''.join(idat))
    stride = width * bpp
    rows, prev = [], bytes(stride)
    for y in range(height):
        at = y * (stride + 1)
        prev = unfilter_row(raw[at], raw[at + 1:at + 1 + stride], prev, bpp, width)
        rows.append(prev)
    pixels = b''.join(rows)
    if ctype == 6:
        return width, height, ctype, pixels
    rgba = bytearray(width * height * 4)
    for c in range(3):
        rgba[c::4] = pixels[c::3]
    rgba[3::4] = b'\xff' * (width * height)
    return width, height, ctype, bytes(rgba)


# --- frame measurements -------------------------------------------------------------------------------------------------

class Frame:
    def __init__(self, name, png):
        self.name = name
        self.w, self.h, self.ctype, self.px = decode_png(png)
        self.alpha = self.px[3::4]

    def at(self, x, y):
        i = 4 * (y * self.w + x)
        return tuple(self.px[i:i + 4])

    def corners(self, size=4):
        """Every pixel of the four size×size corner patches."""
        out = []
        for x0 in (0, self.w - size):
            for y0 in (0, self.h - size):
                out += [self.at(x, y) for y in range(y0, y0 + size) for x in range(x0, x0 + size)]
        return out

    def opaque_rows(self):
        """Per row, an int with bit x set where alpha is 255 (bit 0 = the first pixel)."""
        rows = []
        for y in range(self.h):
            line = self.alpha[y * self.w:(y + 1) * self.w]
            rows.append(int(line.translate(OPAQUE_DIGITS)[::-1], 2) if b'\xff' in line else 0)
        return rows

    def interior(self, rows, reach=2):
        """How many opaque pixels have opaque pixels `reach` px away on all four sides (inside a glyph, not its edge)."""
        count = 0
        for y in range(reach, self.h - reach):
            m = rows[y] & rows[y - reach] & rows[y + reach] & (rows[y] >> reach) & (rows[y] << reach)
            count += bin(m).count('1')
        return count


def dilate(rows, r, width):
    """Chebyshev dilation of a bit-row mask by r pixels."""
    mask = (1 << width) - 1
    wide = []
    for m in rows:
        out = m
        for k in range(1, r + 1):
            out |= (m << k) | (m >> k)
        wide.append(out & mask)
    h = len(rows)
    return [functools.reduce(lambda a, b: a | b, wide[max(0, y - r):min(h, y + r + 1)], 0) for y in range(h)]


# --- the photo frame (DESIGN_2_1 §11.8.3): its rect in output px, left out of the glyph checks -----------------------------

FRAME_PAD = 4                        # px around the photo frame's rect that the glyph checks also leave out


def frame_mask(rect, width, height, pad=FRAME_PAD):
    """Per row, an int with the bits of the photo frame's rect (grown by pad) set (bit 0 = the first pixel)."""
    if not rect:
        return [0] * height
    x0, x1 = max(0, int(rect['x']) - pad), min(width, int(math.ceil(rect['x'] + rect['w'])) + pad)
    y0, y1 = max(0, int(rect['y']) - pad), min(height, int(math.ceil(rect['y'] + rect['h'])) + pad)
    bits = ((1 << max(0, x1 - x0)) - 1) << x0
    return [bits if y0 <= y < y1 else 0 for y in range(height)]


def in_frame(mask, frame, i):
    return (mask[i // frame.w] >> (i % frame.w)) & 1


def png_point(rect, x, y):
    """The output pixel of a pixel of the photo frame's PNG (the picture fills the rect: its box has the PNG's aspect)."""
    return int(rect['x'] + (x + 0.5) * rect['w'] / PNG_SIZE[0]), int(rect['y'] + (y + 0.5) * rect['h'] / PNG_SIZE[1])


def ring_errors(frame, ink, mask=None):
    """For every pixel with MIN_RING_ALPHA ≤ a < 255 outside the mask: (alpha, max channel distance of its straight colour
    to the ink)."""
    out = []
    a_all = frame.alpha
    for i, a in enumerate(a_all):
        if MIN_RING_ALPHA <= a < 255 and not (mask and in_frame(mask, frame, i)):
            j = 4 * i
            out.append((a, max(abs(frame.px[j] - ink[0]), abs(frame.px[j + 1] - ink[1]), abs(frame.px[j + 2] - ink[2])), i))
    return out


def ring_tolerance(a):
    """The rounding of 8-bit premultiplied storage, un-premultiplied: 255 / (2a), plus a small margin."""
    return 3 + 255 / (2 * a)


# --- the page side -------------------------------------------------------------------------------------------------------

SETUP = """([project, frame]) => {
  const a = window.__mv;
  a.view.setPref('autoplay', false);
  const file = JSON.parse(project);
  const reg = a.reg;
  const fb = (kind) => reg.fallback(kind);
  const pin = (v) => ({ v, by: 'user' });
  // the photo frame (DESIGN_2_1 §11.8.3): a PNG with alpha, its own alpha as the cut-out, still in the lower right corner
  file.doc.media = { list: [frame] };
  const pf = (k, v) => ['work:ornament#0@photoFrame.' + k, pin(v)];
  file.doc.pins = Object.assign({}, file.doc.pins, Object.fromEntries([['work:ornament#0', pin('photoFrame')], pf('src', frame.id),
    pf('place', 'corner'), pf('shape', 'free'), pf('size', 0.3), pf('depth', 'still'), pf('appear', 'none'), pf('move', 'none'),
    pf('tilt', 0)]), {
    'work:ornament.count': pin(1), 'work:filter.count': pin(0), 'work:atmos': pin('none'), 'work:texture': pin('none'),
    'work:arrange': pin(fb('arrange')), 'work:arrive': pin(fb('arrive')), 'work:dwell': pin(fb('dwell')),
    'work:depart': pin(fb('depart')), 'work:lens': pin(fb('lens')), 'work:seam': pin(fb('seam')),
    'work:amount.flash': pin(0), 'work:amount.shake': pin(0), 'work:text.style': pin('plain'), 'work:text.scale': pin(1.6),
    'work:el.text.fill': pin(%s),
  });
  file.doc.output = Object.assign({}, file.doc.output, { format: 'mp4', short: %d, fps: %d, audio: false, range: null });
  a.store.load(file.doc, file.side);
  // Two frames in the middle of the longest lyric cut that is alone on screen then and is not an impact line (no flash,
  // no shake): the glyphs of one cut, at rest.
  const fps = %d, span = %d / fps;
  const alone = (t) => a.plan.cuts.filter((c) => c.a <= t && t < c.b).length === 1;
  const cuts = a.plan.cuts.filter((c) => c.role === 'lyric' && !c.impact && c.text).sort((x, y) => y.text.length - x.text.length);
  let pick = null;
  for (const cut of cuts) {
    const t0 = Math.round((cut.t0 + cut.t1) / 2 * fps) / fps;
    if (alone(t0) && alone(t0 + span)) { pick = { cut, t0 }; break; }
  }
  if (!pick) return null;
  a.dispatch({ t: 'output.set', key: 'range', v: { t0: pick.t0, t1: pick.t0 + span } });
  a.goStep('export');
  return { cut: pick.cut.key, text: pick.cut.text, t0: pick.t0 };
}""" % (json.dumps('#%02X%02X%02X' % INK), SHORT, FPS, FPS, FRAMES)

EXPORT = """async () => {
  const a = window.__mv;
  const done = () => { const s = a.exportState(); return s.phase === 'done' || s.phase === 'error'; };
  const before = a.exportState().phase;
  if (before === 'done' || before === 'error') a.exportReset();
  document.querySelector('.footer-export [data-act="export.start"]').click();
  const t0 = performance.now();
  while (!done()) {
    if (performance.now() - t0 > 60000) return { error: 'timeout' };
    await new Promise((r) => setTimeout(r, 50));
  }
  const s = a.exportState();
  if (s.phase === 'error') return { error: s.message };
  const bytes = new Uint8Array(await s.result.blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  a.exportReset();
  return { zip: btoa(bin), frames: s.result.frames, format: a.doc.output.format, backdrop: a.doc.look.backdrop };
}"""


class Checks:
    def __init__(self):
        self.failures = []

    def ok(self, cond, what):
        print(('ok    ' if cond else 'FAIL  ') + what)
        if not cond:
            self.failures.append(what)
        return cond


def frames_of(result, keep, label):
    archive = zipfile.ZipFile(io.BytesIO(base64.b64decode(result['zip'])))
    names = sorted(n for n in archive.namelist() if n.endswith('.png'))
    out = []
    for n in names:
        data = archive.read(n)
        if keep:
            (Path(keep) / ('%s_%s' % (label, n))).write_bytes(data)
        out.append(Frame(n, data))
    return out


async def export(page, checks, label, keep):
    started = time.time()
    res = await page.evaluate(EXPORT)
    if not checks.ok('error' not in res, '%s: the export finishes (%s)' % (label, res.get('error', 'ok'))):
        return None, res
    frames = frames_of(res, keep, label)
    checks.ok(len(frames) == FRAMES == res['frames'], '%s: %d PNG frames in the ZIP (%.1f s with decoding)'
              % (label, len(frames), time.time() - started))
    return frames, res


def check_clear(checks, frames, rect):
    rows_of = []
    for f in frames:
        checks.ok(f.ctype == 6 and (f.w, f.h) == (1280, 720), '%s: RGBA %dx%d (colour type %d)' % (f.name, f.w, f.h, f.ctype))
        checks.ok(all(p[3] == 0 for p in f.corners()), '%s: the frame corners have alpha 0' % f.name)
        mask = frame_mask(rect, f.w, f.h)
        rows = [r & ~m for r, m in zip(f.opaque_rows(), mask)]
        rows_of.append(rows)
        inside = f.interior(rows)
        checks.ok(inside >= 200, '%s: the interior of the glyphs has alpha 255 (%d pixels 2 px inside an edge)' % (f.name, inside))
        ring = ring_errors(f, INK, mask)
        bad = [r for r in ring if r[1] > ring_tolerance(r[0])]
        worst = max(ring, key=lambda r: r[1] - ring_tolerance(r[0])) if ring else None
        checks.ok(len(ring) >= 200 and not bad,
                  '%s: the anti-aliased ring (%d pixels with %d ≤ a < 255) keeps the ink colour un-premultiplied — %d off, worst %r'
                  % (f.name, len(ring), MIN_RING_ALPHA, len(bad), worst and (worst[0], worst[1], f.at(worst[2] % f.w, worst[2] // f.w))))
        dark = [r for r in ring if r[1] > 40]
        checks.ok(not dark, '%s: no dark fringe (%d ring pixels far from the ink)' % (f.name, len(dark)))
    return rows_of


def check_glow(checks, frames, plain_rows, rect):
    for f, rows in zip(frames, plain_rows):
        checks.ok(all(p[3] == 0 for p in f.corners()), '%s (glow): the corners stay transparent' % f.name)
        near, far = dilate(rows, 2, f.w), dilate(rows, 8, f.w)
        mask = frame_mask(rect, f.w, f.h)
        band = partial = solid = 0
        for y in range(f.h):
            m = far[y] & ~near[y] & ~mask[y]
            if not m:
                continue
            base = y * f.w
            x = 0
            while m:
                if m & 1:
                    a = f.alpha[base + x]
                    band += 1
                    partial += 0 < a < 255
                    solid += a == 255
                m >>= 1
                x += 1
        checks.ok(band > 1000 and partial >= 0.6 * band,
                  '%s (glow): the halo 3–8 px around the glyphs is partly transparent (%d of %d pixels with 0 < a < 255)'
                  % (f.name, partial, band))
        checks.ok(solid <= 0.01 * band, '%s (glow): no opaque halo (%d of %d band pixels have a = 255)' % (f.name, solid, band))


def check_chroma(checks, frames):
    for f in frames:
        corners = f.corners()
        checks.ok(all(p[:3] == CHROMA and p[3] == 255 for p in corners),
                  '%s (green): the corners are exactly #00B140 (%r)' % (f.name, corners[0]))
        greens = sum(1 for i in range(0, len(f.px), 4) if f.px[i:i + 3] == bytes(CHROMA))
        checks.ok(greens >= 0.5 * f.w * f.h, '%s (green): the green fills the frame around the text (%d%%)'
                  % (f.name, 100 * greens // (f.w * f.h)))


def check_black(checks, frames, rect):
    for f in frames:
        corners = f.corners()
        checks.ok(all(p == (0, 0, 0, 255) for p in corners), '%s (black): the corners are exactly #000000 (%r)' % (f.name, corners[0]))
        r, g, b = f.px[0::4], f.px[1::4], f.px[2::4]
        mask = frame_mask(rect, f.w, f.h)
        coloured = 0 if r == g == b else sum(1 for i in range(len(r)) if not (r[i] == g[i] == b[i]) and not in_frame(mask, f, i))
        checks.ok(coloured == 0, '%s (black): nothing in the frame has a colour (%d coloured pixels)' % (f.name, coloured))
        white = r.count(255)
        checks.ok(white >= 500, '%s (black): the glyphs are white #FFFFFF (%d pixels)' % (f.name, white))


def check_frame(checks, frames, rect, label):
    """The photo frame keeps its PNG's alpha in a transparent export (opaque 255, the half-transparent square 128 ± 3,
    cleared 0); over the green screen and black it is drawn, opaque, in its own colours."""
    for f in frames:
        at = lambda xy: f.at(*png_point(rect, *xy))  # noqa: E731
        if label == 'clear':
            got = ([at(p)[3] for p in PNG_OPAQUE], [at(p)[3] for p in PNG_HALF], [at(p)[3] for p in PNG_CLEAR])
            checks.ok(got[0] == [255] * 3 and all(abs(v - 128) <= 3 for v in got[1]) and got[2] == [0] * 3,
                      '%s: the photo frame keeps the PNG\'s alpha exactly (opaque %r, half %r, cleared %r)' % (f.name, *got))
        else:
            back = CHROMA if label == 'chroma' else (0, 0, 0)
            px = [at(p) for p in PNG_OPAQUE]
            checks.ok(all(p[3] == 255 and p[:3] != back for p in px),
                      '%s (%s): the photo frame is drawn over the backdrop (%r)' % (f.name, label, px))


async def run(root, keep):
    checks = Checks()
    server = serve(root)
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                page = await new_page(browser, viewport={'width': 1440, 'height': 900})
                errors = []
                page.on('pageerror', lambda e: errors.append(str(e)))
                await page.add_init_script(INIT)
                for host in FONT_HOSTS:
                    await page.route(host, lambda route: route.abort())
                await page.goto('http://127.0.0.1:%d/index.html?fresh=1&test=1' % server.server_address[1], wait_until='load')
                await page.wait_for_function('window.__mv && window.__mv.ready')
                await page.evaluate('async () => { await window.__mv.ready; }')
                if await japanese_font_missing(page, 'transparent_check.py'):
                    return ['no system font draws Japanese (see above)']
                for rel in HELPERS:
                    await page.evaluate((ROOT / rel).read_text(encoding='utf-8'))
                frame = await page.evaluate('() => window.__mediaParts.importPng()')
                project = (ROOT / 'tests' / 'fixtures' / 'project_basic.json').read_text(encoding='utf-8')
                info = await page.evaluate(SETUP, [project, frame])
                if not checks.ok(info is not None, 'a lyric cut that is alone on screen for %d frames' % FRAMES):
                    return checks.failures
                print('cut %s 「%s」 at %.3f s, %d frames at %dp%d' % (info['cut'], info['text'], info['t0'], FRAMES, SHORT, FPS))
                rect = await page.evaluate('(t) => window.__mediaParts.boxOf("ornament#0", t, 1280)', info['t0'] + 0.5 / FPS)
                checks.ok(bool(rect) and rect['w'] > 100 and rect['x'] + rect['w'] <= 1280 and rect['y'] + rect['h'] <= 720,
                          'the photo frame is on screen (%r)' % rect)
                rect = rect or {'x': 0, 'y': 0, 'w': 0, 'h': 0}

                # 透過PNG, chosen in step ④: the backdrop follows (透明).
                await page.select_option('[data-other="format"]', 'pngAlpha')     # その他 ▾ (DESIGN_2_1 §13.10)
                state = await page.evaluate('() => [window.__mv.doc.output.format, window.__mv.doc.look.backdrop]')
                checks.ok(state == ['pngAlpha', 'clear'], '透過PNG makes the backdrop 透明 (%r)' % state)
                # the stage shows the backdrop when it next draws (a frame after the click), so wait for that draw
                try:
                    await page.wait_for_function("() => document.querySelector('.canvas-wrap').dataset.backdrop === 'clear'", timeout=5000)
                except Exception:
                    pass
                preview = await page.evaluate("() => document.querySelector('.canvas-wrap').dataset.backdrop")
                checks.ok(preview == 'clear', 'the preview shows the transparent frame over the checkerboard (%r)' % preview)
                frames, _ = await export(page, checks, 'clear', keep)
                plain_rows = check_clear(checks, frames, rect) if frames else None
                if frames:
                    check_frame(checks, frames, rect, 'clear')

                # Glow: partial alpha around the text.
                await page.evaluate("() => window.__mv.dispatch({ t: 'pin.set', path: 'work:text.style', v: 'glow', by: 'user' })")
                frames, _ = await export(page, checks, 'glow', keep)
                if frames and plain_rows:
                    check_glow(checks, frames, plain_rows, rect)
                await page.evaluate("() => window.__mv.dispatch({ t: 'pin.set', path: 'work:text.style', v: 'plain', by: 'user' })")

                # グリーンバック from step ④'s background control: a PNG sequence stays, opaque now.
                await page.select_option('[data-ctl="backdrop"] select', 'chroma')
                state = await page.evaluate('() => [window.__mv.doc.output.format, window.__mv.doc.look.backdrop]')
                checks.ok(state == ['png', 'chroma'], 'グリーンバック turns 透過PNG into PNG連番 (%r)' % state)
                frames, _ = await export(page, checks, 'chroma', keep)
                if frames:
                    check_chroma(checks, frames)
                    check_frame(checks, frames, rect, 'chroma')

                # 黒（白文字） without the ink pin: white text only.
                await page.evaluate("() => window.__mv.dispatch({ t: 'pin.clear', path: 'work:el.text.fill' })")
                await page.select_option('[data-ctl="backdrop"] select', 'black')
                frames, _ = await export(page, checks, 'black', keep)
                if frames:
                    check_black(checks, frames, rect)
                    check_frame(checks, frames, rect, 'black')

                # Google Fonts are blocked, so every face fell back to the system fonts: step ④ says so (the existing
                # font-fallback line). Without a Japanese system font a mincho fallback draws nothing, and this line is
                # then the user's only hint.
                fallback = await page.evaluate("""() => {
                  const li = document.querySelector('li.check[data-code="font-fallback"]');
                  return li ? li.textContent : null;
                }""")
                checks.ok(bool(fallback), 'step ④ names the typefaces that fell back to system fonts (%r)' % fallback)

                csp = await page.evaluate('() => window.__csp || []')
                checks.ok(not csp, 'no CSP violations (%r)' % csp[:3])
                checks.ok(not errors, 'no page errors (%r)' % errors[:3])
            finally:
                await browser.close()
    finally:
        server.shutdown()
    return checks.failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', help='the tree to build and serve, with src/ and vendor/ (default: this one), e.g. a staging copy')
    ap.add_argument('--keep', help='also write the exported PNGs to this directory')
    args = ap.parse_args()
    root = Path(args.root).resolve() if args.root else ROOT
    ensure_built(root)
    if args.keep:
        Path(args.keep).mkdir(parents=True, exist_ok=True)
    started = time.time()
    failures = asyncio.run(run(root, args.keep))
    for msg in failures:
        print('  ' + msg)
    print('transparent_check.py: %s (%.1f s)' % ('FAILED (%d problems)' % len(failures) if failures else 'OK', time.time() - started))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
