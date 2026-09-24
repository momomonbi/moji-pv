"""Shared Playwright launcher for the dev tests.
- PW_CHANNEL=chrome     -> the installed Google Chrome (CI uses this)
- PW_EXECUTABLE=/path   -> a specific Chromium binary (e.g. /opt/pw-browsers/chromium)
- otherwise             -> Playwright's bundled Chromium
An HTTPS(_)PROXY in the environment is passed to the browser (localhost is not proxied)."""
import os


async def launch(p):
    kw = {}
    if os.environ.get('PW_CHANNEL'):
        kw['channel'] = os.environ['PW_CHANNEL']
    elif os.environ.get('PW_EXECUTABLE'):
        kw['executable_path'] = os.environ['PW_EXECUTABLE']
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    if proxy:
        kw['proxy'] = {'server': proxy, 'bypass': 'localhost,127.0.0.1'}
    return await p.chromium.launch(**kw)


async def new_page(browser, **kw):
    kw.setdefault('ignore_https_errors', bool(os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')))
    return await browser.new_page(**kw)
