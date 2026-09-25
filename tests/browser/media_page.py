"""文字PVメーカー v2 — original work. The built app page with the media test harness, for the media browser tests (DESIGN_2_1 §11.8.3).

open_media_page(browser) serves this tree over HTTP (a random free port), opens index.html?fresh=1&test=1 under its real
CSP (securitypolicyviolation events recorded, Google Fonts blocked so the system fonts draw) and evaluates
tests/helpers/exif_write.js, tests/helpers/media_gen.js and tests/www/media_parts.js into it: window.__mediaParts is then
ready. It returns a MediaPage: .page, .errors (page errors), csp() (the violations so far) and close(). Used by
media_exact.py, media_alpha.py, determinism.py (media), perf.py (media) and transparent_check.py."""
import functools
import http.server
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import new_page  # noqa: E402  (dev/browser.py, the shared launcher)

FONT_HOSTS = ('https://fonts.googleapis.com/**', 'https://fonts.gstatic.com/**')
RECORD = """
window.__csp = [];
document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || '')));
"""
HELPERS = ('tests/helpers/exif_write.js', 'tests/helpers/media_gen.js', 'tests/www/media_parts.js')


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory):
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(directory)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def ensure_built(root=ROOT):
    """Rebuilds index.html and en/index.html when a source is newer than them."""
    pages = [root / 'index.html', root / 'en' / 'index.html']
    inputs = list((root / 'src').rglob('*')) + [ROOT / 'build.py']
    newest = max(p.stat().st_mtime for p in inputs if p.is_file())
    if all(p.is_file() for p in pages) and min(p.stat().st_mtime for p in pages) >= newest:
        return
    subprocess.run([sys.executable, str(ROOT / 'build.py'), '--root', str(root)], check=True)


class MediaPage:
    def __init__(self, page, server, errors):
        self.page, self.server, self.errors = page, server, errors

    async def csp(self):
        return await self.page.evaluate('() => window.__csp || []')

    async def close(self):
        try:
            await self.page.close()
        finally:
            self.server.shutdown()


async def open_media_page(browser, root=ROOT, viewport=None, harness=True):
    ensure_built(root)
    server = serve(root)
    errors = []
    try:
        page = await new_page(browser, viewport=viewport or {'width': 1280, 'height': 800})
        page.set_default_timeout(0)
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.add_init_script(RECORD)
        for host in FONT_HOSTS:
            await page.route(host, lambda route: route.abort())
        await page.goto('http://127.0.0.1:%d/index.html?fresh=1&test=1' % server.server_address[1], wait_until='load')
        await page.wait_for_function('window.__mv && window.__mv.ready')
        await page.evaluate('async () => { await window.__mv.ready; }')
        if harness:
            for rel in HELPERS:
                await page.evaluate((ROOT / rel).read_text(encoding='utf-8'))
    except Exception:
        server.shutdown()
        raise
    return MediaPage(page, server, errors)
