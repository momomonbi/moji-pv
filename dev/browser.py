"""Shared Playwright launcher for the dev tests.
- PW_CHANNEL=chrome     -> the installed Google Chrome (CI uses this)
- PW_EXECUTABLE=/path   -> a specific Chromium binary (e.g. /opt/pw-browsers/chromium)
- otherwise             -> Playwright's bundled Chromium
An HTTPS(_)PROXY in the environment is passed to the browser (localhost is not proxied).
The browser gets this process's environment, so FONTCONFIG_FILE=… here changes the system fonts it sees.

japanese_font_missing(page, test) is the check the tests that look at drawn text run first (see JAPANESE_PROBE)."""
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


# The tests block Google Fonts, so every face falls back to the system stacks of engine/text/faces (SYSTEM_FALLBACK),
# which end in the generic `serif` (mincho, brush, antique) or `sans-serif` (gothic, round, heavy). Without a CJK font
# the browser draws the missing-glyph box of the stack's first font instead of a kana: on Linux, Chrome's `serif` is
# Liberation Serif (via Times New Roman), whose box is empty, so Japanese in a mincho face draws nothing at all; the
# sans stacks draw a hollow box, the same one for every character. Each stack draws 「あ」 and 「い」: both need ink, and
# two different shapes. → a list of problems, [] when every stack draws Japanese.
JAPANESE_PROBE = r"""() => {
  const MVG = globalThis.MV;
  const faces = MVG && MVG.has && MVG.has('engine/text/faces') ? MVG.use('engine/text/faces') : null;
  const stacks = faces ? [...new Set(Object.values(faces.SYSTEM_FALLBACK))] : ['serif', 'sans-serif'];
  const S = 64;
  const draw = (stack, ch) => {
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.font = '400 48px ' + stack;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#000';
    g.fillText(ch, S / 2, S / 2);
    const d = g.getImageData(0, 0, S, S).data;
    let ink = 0, sig = '';
    for (let i = 3; i < d.length; i += 4) { if (d[i]) ink++; sig += d[i] > 127 ? '1' : '0'; }
    return { ink, sig };
  };
  const out = [];
  for (const stack of stacks) {
    const a = draw(stack, 'あ'), b = draw(stack, 'い');
    if (!a.ink) out.push('あ draws nothing in ' + stack);
    else if (a.sig === b.sig) out.push('あ and い draw the same missing-glyph box in ' + stack);
  }
  return out;
}"""


async def japanese_font_missing(page, test):
    """True (after printing one clear failure) when the browser's system fonts cannot draw Japanese. The tests that
    look at drawn text call this first, instead of reporting hundreds of blank frames or missing glyph pixels."""
    problems = await page.evaluate(JAPANESE_PROBE)
    if not problems:
        return False
    print('%s: FAILED — no system font draws Japanese in this browser, so the text checks cannot run:' % test)
    for msg in problems:
        print('  ' + msg)
    print('  The tests block Google Fonts, so the text is drawn with the system fonts. Install a Japanese font, e.g.\n'
          '  sudo apt-get install fonts-noto-cjk && fc-cache -f (Debian/Ubuntu; .github/workflows/ci.yml does this).')
    return True
