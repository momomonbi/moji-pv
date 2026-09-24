"""Open the built pages with their Content-Security-Policy and check that
  1) using the app raises no CSP violation and no page error,
  2) the fonts the current plan draws with are loaded from Google Fonts,
  3) the policy really is active (an injected inline script and a fetch to another host are blocked),
  4) the AI API origins are allowed by connect-src.
usage: python3 build.py && python3 dev/csp_check.py [index.html en/index.html] [--strict-fonts]   (exit 1 on failure)
Without --strict-fonts a font that failed with a network error (not a CSP block) is only reported."""
import asyncio, functools, http.server, json, os, sys, threading
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from browser import launch, new_page

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = [a for a in sys.argv[1:] if a.endswith('.html')] or ['index.html', 'en/index.html']
STRICT_FONTS = '--strict-fonts' in sys.argv      # CI: every font of the plan must load

INIT = """
window.__csp = [];
document.addEventListener('securitypolicyviolation', e => window.__csp.push({ directive: e.effectiveDirective, blocked: e.blockedURI, sample: (e.sample || '').slice(0, 80) }));
"""

FONT_STATE = """
async () => {
  const S = J.ui;
  await J.ensureFonts(S.project.lyrics + '0123456789', J.fontsOfPlan(S.plan));
  const strip = s => s.replace(/["']/g, '').trim();
  const faces = [...document.fonts];
  const out = [];
  for (const k of J.fontsOfPlan(S.plan)) {
    const f = J.faceOf ? J.faceOf(k) : J.FONTS[k];
    if (!f.gf) continue;                                   // PC / user fonts are not fetched
    const fam = strip(f.family.split(',')[0]);
    const mine = faces.filter(x => strip(x.family) === fam);
    out.push({ key: k, family: fam, faces: mine.length, loaded: mine.filter(x => x.status === 'loaded').length });
  }
  return out;
}
"""


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a): pass
    handler = functools.partial(Quiet, directory=ROOT)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


async def check(browser, base, page_path):
    pg = await new_page(browser, viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    errors, console_csp, failed = [], [], []
    pg.on('requestfailed', lambda r: failed.append((r.url, r.failure)))
    pg.on('pageerror', lambda e: errors.append(str(e)[:300]))
    pg.on('console', lambda m: console_csp.append(m.text[:300]) if 'Content Security Policy' in m.text or 'Content-Security-Policy' in m.text else None)
    await pg.add_init_script(INIT)
    await pg.goto(f'{base}/{page_path}', wait_until='domcontentloaded')
    await pg.wait_for_function('() => window.J && J.ui && J.ui.plan', timeout=20000)
    await pg.wait_for_timeout(1500)
    # use the app: both modes, every tab, おまかせ, playback, the terms dialog, a project save
    await pg.click('#modeEasy'); await pg.click('#btnOmakaseBig'); await pg.wait_for_timeout(600)
    await pg.click('#btnOmakaseBig'); await pg.wait_for_timeout(600)
    await pg.click('#modePro')
    for tab in ['fx', 'tech', 'out', 'style']:
        await pg.click(f'.tabs button[data-tab="{tab}"]'); await pg.wait_for_timeout(250)
    await pg.click('#btnPlay'); await pg.wait_for_timeout(1200); await pg.click('#btnPlay')
    await pg.click('#btnTerms'); await pg.wait_for_timeout(200); await pg.click('#termsDlg button[value="close"]')
    async with pg.expect_download() as dl:
        await pg.click('#btnSave')
    await dl.value
    if await pg.query_selector('#aiOpen'):
        await pg.click('#aiOpen'); await pg.wait_for_timeout(300)
        await pg.keyboard.press('Escape')
    fonts = await pg.evaluate(FONT_STATE)
    used = json.loads(json.dumps(await pg.evaluate('() => window.__csp')))
    # the policy must be live: these two are expected to be blocked
    probe = await pg.evaluate("""async () => {
      const s = document.createElement('script'); s.textContent = 'window.__injected = 1'; document.body.appendChild(s);
      let other = 'allowed';
      try { await fetch('https://example.com/', { mode: 'no-cors' }); } catch (e) { other = 'blocked'; }
      const ai = {};
      for (const u of ['https://generativelanguage.googleapis.com/v1beta/models', 'https://api.anthropic.com/v1/models']) {
        const before = window.__csp.length;
        try { await fetch(u, { method: 'GET' }); } catch (e) {}
        await new Promise(r => setTimeout(r, 50));
        ai[u] = window.__csp.slice(before).some(v => v.blocked && v.blocked.startsWith(u.slice(0, 30))) ? 'blocked by CSP' : 'allowed by CSP';
      }
      await new Promise(r => setTimeout(r, 100));
      return { injected: window.__injected === 1, other, ai };
    }""")
    await pg.close()
    ok = True
    print(f'== {page_path}')
    print('  CSP violations while using the app:', len(used))
    for v in used[:10]: print('   ', v)
    if used: ok = False
    for m in console_csp[:5]: print('  console:', m)
    print('  page errors:', len(errors))
    for e in errors[:5]: print('   ', e)
    if errors: ok = False
    font_fail = [(u, f) for u, f in failed if 'fonts.g' in u]
    blocked = [(u, f) for u, f in failed if 'BLOCKED_BY_CSP' in (f or '') and 'example.com' not in u]
    print('  requests blocked by CSP:', len(blocked))
    for u, f in blocked[:5]: print('   ', f, u[:120])
    if blocked: ok = False
    kinds = sorted(set(f for _, f in font_fail))
    print('  font requests that failed for other reasons (network):', len(font_fail), kinds)
    for f in fonts:
        print(f"  font {f['key']:<12} {f['family']:<24} loaded {f['loaded']}/{f['faces']}")
    missing = [f['key'] for f in fonts if f['loaded'] == 0]
    if not fonts or not any(f['loaded'] for f in fonts):
        print('  FAIL: no Google Fonts face loaded'); ok = False
    elif missing and (STRICT_FONTS or not font_fail):
        print('  FAIL: fonts of the current plan did not load:', missing); ok = False
    elif missing:
        print('  note: some fonts did not load because of network errors (not CSP):', missing, '— run with --strict-fonts on a normal connection')
    print('  injected inline script ran:', probe['injected'], '(must be False)')
    print('  fetch to another host:', probe['other'], '(must be blocked)')
    for u, r in probe['ai'].items(): print(f'  {u}: {r}')
    if probe['injected'] or probe['other'] != 'blocked' or any(r != 'allowed by CSP' for r in probe['ai'].values()): ok = False
    return ok


async def main():
    srv = serve()
    base = f'http://127.0.0.1:{srv.server_address[1]}'
    async with async_playwright() as p:
        b = await launch(p)
        results = [await check(b, base, pg) for pg in PAGES]
        await b.close()
    srv.shutdown()
    print('CSP check', 'OK' if all(results) else 'FAILED')
    sys.exit(0 if all(results) else 1)

asyncio.run(main())
