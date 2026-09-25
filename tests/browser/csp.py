#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: the built pages load with 0 CSP violations and no page errors.

First version (WP0): loads index.html, en/index.html and the lab page tests/www/lab.html from a local
http.server and checks that the boot module rendered into #app and both vendor scripts ran (pages are rebuilt first
when missing or stale). It also builds a small scratch tree whose inputs have CRLF and lone-CR line endings and checks
that Chromium accepts every hash the build computed for it. WP8 extends it to every UI flow (DESIGN §8.3); v2.1 adds the
new pages on the v21 project (curve widget, keyframes, マイ素材, the AI area list and board, 区画 bands). Google Fonts
requests are blocked here, so the test never waits on the network and passes with fallback fonts.
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/csp.py   (CI: PW_CHANNEL=chrome)
"""
import asyncio
import functools
import http.server
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch, new_page  # noqa: E402  (dev/browser.py, the shared launcher)
from playwright.async_api import TimeoutError as PlaywrightTimeout, async_playwright  # noqa: E402

PAGES = (('index.html', 'ja'), ('en/index.html', 'en'), ('tests/www/lab.html', 'ja'))
# A function, not an expression: Playwright polls an expression with eval inside the page, which this CSP refuses.
APP_RENDERED = "() => { const app = document.querySelector('#app'); return !!app && app.childElementCount > 0; }"
VENDOR_GLOBALS = "[typeof Mp4Muxer, typeof AnthropicSDK].filter((t) => t === 'undefined').length"
HEADER = '/* 文字PVメーカー v2 — original work. Line-ending probe for csp.py. */'
CR_PROBE = {   # CRLF everywhere, plus a lone CR inside a comment (JS and the HTML parser both read it as a line break)
    'core/probe.js': [HEADER, "MV.def('core/probe', [], () => {", "  'use strict';",
                      '  /* a lone CR ends this line\r inside a comment */', "  return { word: () => 'CR/LF ok' };", '});'],
    'ui/boot.js': [HEADER, "MV.def('ui/boot', ['core/probe'], (probe) => {", "  'use strict';",
                   '  function start() {', "    const p = document.createElement('p');", '    p.textContent = probe.word();',
                   "    document.getElementById('app').appendChild(p);", '  }', '  return { start };', '});'],
    'ui/style.css': [HEADER, 'p { margin: 0 }\r#app { padding: 8px }'],
}
FONT_HOSTS = ('https://fonts.googleapis.com/**', 'https://fonts.gstatic.com/**')
RECORD_VIOLATIONS = """
window.__cspViolations = [];
document.addEventListener('securitypolicyviolation', (e) => {
  window.__cspViolations.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sourceFile || '') + ':' + e.lineNumber);
});
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory):
    handler = functools.partial(QuietHandler, directory=str(directory))
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def newest_input():
    """Modification time of the newest build input (sources, style, vendor scripts, build.py)."""
    inputs = list((ROOT / 'src').rglob('*')) + list((ROOT / 'vendor').glob('*.js')) + [ROOT / 'build.py']
    return max(p.stat().st_mtime for p in inputs if p.is_file())


def ensure_built():
    """Builds the pages (and the lab page) when one is missing or older than its inputs, so a stale page is never tested."""
    pages = [ROOT / rel for rel, _ in PAGES]
    if all(p.is_file() for p in pages) and min(p.stat().st_mtime for p in pages) >= newest_input():
        return
    subprocess.run([sys.executable, str(ROOT / 'build.py'), '--lab'], check=True)


async def check_page(browser, base, rel, lang):
    page = await new_page(browser)
    errors, console_csp = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: console_csp.append(m.text) if 'Content Security Policy' in m.text else None)
    for host in FONT_HOSTS:
        await page.route(host, lambda route: route.abort())
    await page.add_init_script(RECORD_VIOLATIONS)
    await page.goto(base + rel, wait_until='load')
    try:
        await page.wait_for_function(APP_RENDERED, timeout=10000)
    except PlaywrightTimeout:
        pass                                     # reported below ('#app rendered no text'), with the violations
    await page.wait_for_timeout(300)             # late violations (e.g. styles set after load) still get reported
    violations = await page.evaluate('window.__cspViolations')
    html_lang = await page.evaluate('document.documentElement.lang')
    text = await page.evaluate("document.querySelector('#app').innerText")
    missing_vendor = await page.evaluate(VENDOR_GLOBALS)
    await page.close()
    problems = []
    if violations or console_csp:
        problems.append('CSP violations: %r %r' % (violations, console_csp))
    if errors:
        problems.append('page errors: %r' % errors)
    if html_lang != lang:
        problems.append('html lang is %r, expected %r' % (html_lang, lang))
    if not text.strip():
        problems.append('#app rendered no text')
    if missing_vendor:
        problems.append('a vendor script did not run (Mp4Muxer / AnthropicSDK missing)')
    return problems


# v2.1 (package F, DESIGN_2_1 §7.4): the new pages cause no violations either. The v21 project is opened and the curve
# widget (かんたん, a drawn plot, handles placed through CSSOM), the keyframe editor, the area list and the board of the
# AI tab, a material page (its thumbnail animated) and 区画 bands in the drawer are shown in turn.
V21_TEXT = (ROOT / 'tests' / 'fixtures' / 'project_v21.json').read_text(encoding='utf-8')
V21_STEPS = [
    """async (text) => { const a = window.__mv; a.view.setPref('autoplay', false);
      await a.io.openFiles([new File([text], 'v21.json', { type: 'application/json' })]); a.pause(); }""",
    """() => { const a = window.__mv; a.dispatch({ t: 'pin.set', path: 'line/r4:arrive.ease', v: { ramp: { edge: 0.1, ends: 'both', peak: 6 } },
      by: 'user' }); a.openPanel('details'); a.select({ level: 'line', ids: ['r4'] }, { from: 'crumbs', open: true }); a.view.set({ drawer: true }); }""",
    """() => { const a = window.__mv; a.select({ level: 'el', scope: 'cut/' + a.plan.lines[1].cuts[0], el: 'lens' }, { from: 'crumbs', open: true });
      requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector('[data-custom="camKeys"] button').click())); }""",
    """() => { const a = window.__mv; a.select({ level: 'work' }, { from: 'crumbs', open: true });
      requestAnimationFrame(() => requestAnimationFrame(() => { a.inspector.openSection('materials');
        requestAnimationFrame(() => { document.querySelector('.mat-row[data-mat="m3"] .insp-item').click();
          requestAnimationFrame(() => document.querySelector('.mat-thumb-btn').focus()); }); })); }""",
    """() => { const a = window.__mv; a.openPanel('ai');
      requestAnimationFrame(() => { document.querySelector('.ai-direct [data-target="area"]').click();
        requestAnimationFrame(() => document.querySelector('.ai-board-link').click()); }); }""",
]


async def check_v21(browser, base, rel, lang):
    page = await new_page(browser, viewport={'width': 1440, 'height': 900})
    errors, console_csp = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: console_csp.append(m.text) if 'Content Security Policy' in m.text else None)
    for host in FONT_HOSTS:
        await page.route(host, lambda route: route.abort())
    await page.add_init_script(RECORD_VIOLATIONS)
    await page.goto(base + rel + '?fresh=1&test=1', wait_until='load')
    await page.wait_for_function('() => window.__mv && window.__mv.ready')
    await page.evaluate('async () => { await window.__mv.ready; }')
    shown = []
    for i, js in enumerate(V21_STEPS):
        await page.evaluate(js, V21_TEXT) if i == 0 else await page.evaluate(js)
        await page.wait_for_timeout(500)
        shown.append(await page.evaluate("""() => ['.w-curve .cw-canvas', '.ke-page', '.mat-page', '.ai-board', '.tl-canvas']
          .filter((s) => { const el = document.querySelector(s); return !!el && el.getClientRects().length > 0; })"""))
    violations = await page.evaluate('window.__cspViolations')
    await page.close()
    problems = []
    seen = {s for step in shown for s in step}
    if not {'.w-curve .cw-canvas', '.ke-page', '.mat-page', '.ai-board', '.tl-canvas'} <= seen:
        problems.append('not every new page was shown: %r' % shown)
    if violations or console_csp:
        problems.append('CSP violations: %r %r' % (violations, console_csp))
    if errors:
        problems.append('page errors: %r' % errors)
    return problems


def build_cr_tree(tmp):
    """A minimal tree whose sources, style and vendor scripts use CRLF (as a Windows checkout with core.autocrlf
    gives) and a lone CR; returns its root directory (src/ and vendor/) after building it."""
    root = tmp / 'tree'
    (root / 'src' / 'core').mkdir(parents=True)
    shutil.copy(ROOT / 'src' / 'core' / 'define.js', root / 'src' / 'core' / 'define.js')
    for rel, lines in CR_PROBE.items():
        path = root / 'src' / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(('\r\n'.join(lines) + '\r\n').encode('utf-8'))
    (root / 'vendor').mkdir()
    for vendor in sorted((ROOT / 'vendor').glob('*.js')):
        crlf = vendor.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
        (root / 'vendor' / vendor.name).write_bytes(crlf)
    subprocess.run([sys.executable, str(ROOT / 'build.py'), '--root', str(root)], check=True, stdout=subprocess.DEVNULL)
    return root


async def check_cr_tree(browser):
    tmp = Path(tempfile.mkdtemp(prefix='mv-csp-cr-'))
    server = None
    try:
        server = serve(build_cr_tree(tmp))
        base = 'http://127.0.0.1:%d/' % server.server_address[1]
        return await check_page(browser, base, 'index.html', 'ja')
    finally:
        if server:
            server.shutdown()
        shutil.rmtree(tmp, ignore_errors=True)


async def main():
    ensure_built()
    server = serve(ROOT)
    base = 'http://127.0.0.1:%d/' % server.server_address[1]
    failures = []
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                for rel, lang in PAGES:
                    problems = await check_page(browser, base, rel, lang)
                    print('%s %s' % ('FAIL' if problems else 'ok  ', rel))
                    failures += ['%s: %s' % (rel, msg) for msg in problems]
                for rel, lang in PAGES[:2]:
                    problems = await check_v21(browser, base, rel, lang)
                    print('%s %s v2.1 pages' % ('FAIL' if problems else 'ok  ', rel))
                    failures += ['%s v2.1 pages: %s' % (rel, msg) for msg in problems]
                problems = await check_cr_tree(browser)
                print('%s %s' % ('FAIL' if problems else 'ok  ', 'CRLF / lone-CR scratch tree'))
                failures += ['CR tree: %s' % msg for msg in problems]
            finally:
                await browser.close()
    finally:
        server.shutdown()
    for msg in failures:
        print('  ' + msg)
    print('csp.py: %s' % ('FAILED' if failures else 'OK (0 CSP violations, no page errors)'))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
