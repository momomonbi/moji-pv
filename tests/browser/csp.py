#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: the built pages load with 0 CSP violations and no page errors.

First version (WP0): loads index.html, en/index.html and the lab page tests/www/lab.html from a local
http.server and checks that the boot module rendered into #app and both vendor scripts ran (pages are rebuilt first
when missing or stale). It also builds a small scratch tree whose inputs have CRLF and lone-CR line endings and checks
that Chromium accepts every hash the build computed for it. WP8 extends it to every UI flow (DESIGN §8.3); v2.1 adds the
new pages on the v21 project (curve widget, keyframes, マイ素材, the AI area list and board, 区画 bands) and the photo and
video flows (import incl. SVG, playback, scrubbing, the crop overlay, the library and asset page, a vision request to a
faked Gemini, a PNG export and a package saved and opened; package G.4), and the editor-ready output (package H.3): a
透過動画（WebM）, the Filmora set into a folder and as a ZIP with its guide, and 字幕（.srt） saved both ways. Google Fonts
requests are blocked here, so the test never waits on the network and passes with fallback fonts.
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/csp.py   (CI: PW_CHANNEL=chrome)
"""
import asyncio
import functools
import json
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
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ui_flows import FAKE_DIR, FAKE_SAVE, KIT_CODECS  # noqa: E402  (the faked pickers and the kit's codecs, shared with the flows)
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


# v2.1 photos and videos (package G.4, DESIGN_2_1 §11.8.3): import (a PNG dropped on the preview, a JPEG, an SVG and an
# MP4 made in the page by tests/helpers/media_gen.js), playback, scrubbing and the trim peek, the crop overlay, the
# library, the asset page's filmstrip and the picker, 写真の説明 through a faked Gemini, a PNG export, and a package saved and
# opened again: 0 violations.
MEDIA_HELPERS = ('tests/helpers/exif_write.js', 'tests/helpers/media_gen.js')
MEDIA_STEPS = [
    # import: a drop on the preview (the stage's drop target) and the import queue
    """async () => { const a = window.__mv; a.view.setPref('autoplay', false);
      a.dispatch({ t: 'lyrics.set', text: '窓をあけて/光を入れる\\nまだ眠い街に\\n坂道を下って/駅まで歩く\\n今日も/ここから' }, { label: ['undo.paste', {}] });
      a.pause();
      const G = window.MVMediaGen, st = await G.stills();
      const v = await G.encodeCounter({ container: 'mp4', fps: 30, frames: 45 });
      const files = [new File([st.png], '窓.png', { type: 'image/png' }), new File([st.jpeg], '空.jpg', { type: 'image/jpeg' }),
        new File([G.SVG], '丸.svg', { type: 'image/svg+xml' }), new File([v.bytes], '海辺.mp4', { type: 'video/mp4' })];
      const wrap = document.querySelector('.canvas-wrap'), dt = new DataTransfer();
      dt.items.add(files[0]);
      const o = { bubbles: true, cancelable: true, dataTransfer: dt };
      wrap.dispatchEvent(new DragEvent('dragenter', o)); wrap.dispatchEvent(new DragEvent('dragover', o)); wrap.dispatchEvent(new DragEvent('drop', o));
      await a.media.importFiles(files.slice(1), {});
      const t0 = performance.now();
      while (a.doc.media.list.length < 4 && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50));
      const line = a.plan.lines[2].id, byName = (n) => a.doc.media.list.find((e) => e.name === n).id;
      a.media.place(byName('海辺.mp4'), 'ground', { kind: 'lines', scopes: ['line/' + line], lineIds: [line], area: null });
      a.media.place(byName('丸.svg'), 'frame', { kind: 'lines', scopes: ['line/' + a.plan.lines[1].id], lineIds: [a.plan.lines[1].id], area: null }); }""",
    # playback, then scrubbing and the trim peek
    """async () => { const a = window.__mv; a.seek(0); a.play(); await new Promise((r) => setTimeout(r, 1500)); a.pause();
      for (const t of [0.5, 5.2, 5.6, 6.1, 2.4]) { a.seek(t); await new Promise((r) => setTimeout(r, 120)); }
      a.shell.stage.peek(a.doc.media.list.find((e) => e.kind === 'video').id, 0.7); await new Promise((r) => setTimeout(r, 300)); a.shell.stage.peek(null); }""",
    # the line's background page: the trim row, then the crop overlay
    """async () => { const a = window.__mv; a.openPanel('details');
      a.select({ level: 'el', scope: 'line/' + a.plan.lines[2].id, el: 'ground' }, { from: 'crumbs', open: true });
      await new Promise((r) => setTimeout(r, 400));
      const h = document.querySelector('.w-trim-h.is-in'); h.focus(); h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      document.querySelector('.frow[data-slot="ground@photoPan.cropZoom"] .w-crop-edit').click(); }""",
    # the library, the asset page (its filmstrip on hover) and the picker
    """async () => { const a = window.__mv; a.shell.stage.crop(null); a.select({ level: 'work' }, { from: 'crumbs', open: true });
      await new Promise((r) => setTimeout(r, 300)); a.media.openAsset(a.doc.media.list.find((e) => e.kind === 'video').id);
      await new Promise((r) => setTimeout(r, 300));
      const p = document.querySelector('.med-poster-box'); if (p) p.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));
      a.select({ level: 'el', scope: 'line/' + a.plan.lines[2].id, el: 'ground' }, { from: 'crumbs', open: true });
      await new Promise((r) => setTimeout(r, 300)); document.querySelector('.frow[data-slot="ground@photoPan.image"] .w-media').click(); }""",
    # 写真の説明 through a faked Gemini (the consent question answered, the review applied)
    """async () => { const a = window.__mv; a.ai.setKey('AIza' + 'x'.repeat(35));
      const p = a.ai.describeMedia([a.doc.media.list.find((e) => e.name === '空.jpg').id]);
      for (let i = 0; i < 40 && !document.querySelector('dialog.dlg[open] .btn.primary'); i++) await new Promise((r) => setTimeout(r, 50));
      document.querySelector('dialog.dlg[open] .btn.primary').click();
      await p; a.ai.apply(); }""",
    # a PNG export of half a second
    """async () => { const a = window.__mv;
      window.showSaveFilePicker = undefined; window.showDirectoryPicker = undefined;
      a.goStep('export'); await new Promise((r) => setTimeout(r, 300));
      const other = document.querySelector('[data-other="format"]'); other.value = 'png'; other.dispatchEvent(new Event('change'));
      a.batch({ label: ['undo.output', {}] }, [{ t: 'output.set', key: 'short', v: 360 }, { t: 'output.set', key: 'range', v: { t0: 5, t1: 5.5 } }]);
      await new Promise((r) => setTimeout(r, 100));
      await a.exportStart();
      const t0 = performance.now();
      while (!['done', 'error'].includes(a.exportState().phase) && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 100));
      const st = a.exportState(); window.__exported = st.phase === 'done' ? 'done' : st.phase + ': ' + (st.message || ''); a.exportReset(); }""",
    # a package saved (in memory) and opened again
    """async () => { const a = window.__mv; window.__pkg = null;
      const orig = URL.createObjectURL; URL.createObjectURL = (b) => { window.__pkg = b; return orig(b); };
      await a.io.saveAs(); URL.createObjectURL = orig;
      if (window.__pkg) await a.io.openFiles([new File([window.__pkg], '作品.mojipv')]); }""",
]
MEDIA_SHOWN = """() => ({ list: window.__mv.doc.media.list.length, exported: window.__exported || null, pkg: !!window.__pkg,
  missing: window.__mv.doc.media.list.filter((e) => window.__mv.media.state(e.id) !== 'ok').length,
  described: window.__mv.doc.media.list.filter((e) => e.ai && e.ai.depth === 'still').length })"""
VISION_ANSWER = {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': json.dumps({'items': [{
    'n': 0, 'caption': '空', 'captionEn': 'Sky', 'tags': ['soft'], 'colors': ['#3080D0'], 'subject': {'x': 0, 'y': 0, 'w': 0, 'h': 0},
    'text': {'x': 0, 'y': 0, 'w': 1, 'h': 0.5}, 'use': 'ground', 'depth': 'still', 'reason': 'text'}]})}]}}],
    'usageMetadata': {'promptTokenCount': 10, 'candidatesTokenCount': 5}}


async def fake_gemini(route):
    cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}
    if route.request.method == 'OPTIONS':
        await route.fulfill(status=204, headers=cors)
    else:
        await route.fulfill(status=200, content_type='application/json', headers=cors, body=json.dumps(VISION_ANSWER))


async def check_media(browser, base, rel, lang):
    page = await new_page(browser, viewport={'width': 1440, 'height': 900})
    errors, console_csp = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: console_csp.append(m.text) if 'Content Security Policy' in m.text else None)
    for host in FONT_HOSTS:
        await page.route(host, lambda route: route.abort())
    await page.route('https://generativelanguage.googleapis.com/**', fake_gemini)
    await page.add_init_script(RECORD_VIOLATIONS)
    await page.goto(base + rel + '?fresh=1&test=1', wait_until='load')
    await page.wait_for_function('() => window.__mv && window.__mv.ready')
    await page.evaluate('async () => { await window.__mv.ready; }')
    for helper in MEDIA_HELPERS:
        await page.evaluate((ROOT / helper).read_text(encoding='utf-8'))
    problems = []
    for i, js in enumerate(MEDIA_STEPS):
        try:
            await page.evaluate(js)
        except Exception as e:  # noqa: BLE001 - reported with the violations
            problems.append('step %d failed: %s' % (i, str(e).splitlines()[0]))
        await page.wait_for_timeout(300)
    shown = await page.evaluate(MEDIA_SHOWN)
    violations = await page.evaluate('window.__cspViolations')
    await page.close()
    if shown != {'list': 4, 'exported': 'done', 'pkg': True, 'missing': 0, 'described': 1}:
        problems.append('not every media flow ran: %r' % shown)
    if violations or console_csp:
        problems.append('CSP violations: %r %r' % (violations, console_csp))
    if errors:
        problems.append('page errors: %r' % errors)
    return problems


# v2.1 editor-ready output (package H.3, DESIGN_2_1 §13.12): a 透過動画（WebM） built in memory and downloaded; the Filmora
# set with 詳しく, its guide from 詳しく and from the done state, written into a folder (the picker faked with OPFS) and,
# without a folder picker, as one ZIP; ≡ › 字幕（.srt）を保存 through the save dialog (faked) and as a download: 0 violations.
OUTPUT_STEPS = [
    """async () => { const a = window.__mv; a.view.setPref('autoplay', false);
      a.dispatch({ t: 'lyrics.set', text: '窓をあけて/光を入れる\\nまだ眠い街に\\n坂道を下って/駅まで歩く' }, { label: ['undo.paste', {}] });
      a.pause(); a.goStep('export'); await new Promise((r) => setTimeout(r, 200));
      const other = document.querySelector('[data-other="format"]'); other.value = 'webmAlpha'; other.dispatchEvent(new Event('change'));
      a.batch({ label: ['undo.output', {}] }, [{ t: 'output.set', key: 'short', v: 720 }, { t: 'output.set', key: 'range', v: { t0: 1, t1: 1.4 } }]);
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
      for (let i = 0; i < 100 && !a.exportProbe(); i++) await new Promise((r) => setTimeout(r, 100));
      await a.exportStart(); window.__done = [a.exportState().phase]; a.exportReset(); }""",
    """async () => { const a = window.__mv, wait = (ms) => new Promise((r) => setTimeout(r, ms));
      document.querySelector('[data-seg="format"] [data-v="kit"]').click(); await wait(100);
      document.querySelector('.step-export details.more > summary').click(); await wait(100);
      document.querySelector('label[for="exp-kit-bg"]').click(); await wait(100);
      document.querySelector('[data-kit-help="planned"]').click(); await wait(300);
      document.querySelector('dialog.dlg[open] .dlg-head .icon-btn').click();
      for (let i = 0; i < 100 && !a.exportProbe(); i++) await wait(100);
      await a.exportStart(); window.__done.push(a.exportState().phase);
      const help = document.querySelector('[data-kit-help="written"]');
      if (help) { help.click(); await wait(300); document.querySelector('dialog.dlg[open] .dlg-head .icon-btn').click(); }
      a.exportReset(); }""",
    """async () => { const a = window.__mv;
      Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true }); a.bus.emit('export', a.exportState());
      await a.exportStart(); window.__done.push(a.exportState().phase); a.exportReset(); }""",
    """async () => { const a = window.__mv; window.__pickName = 'sub.srt';
      await a.actions.run('file.saveSrt', { from: 'menu' }); await new Promise((r) => setTimeout(r, 300));
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
      await a.actions.run('file.saveSrt', { from: 'menu' }); window.__done.push((window.__picks || []).length); }""",
]


async def check_output(browser, base, rel, lang):
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
    await page.evaluate(KIT_CODECS)
    await page.evaluate(FAKE_DIR)
    await page.evaluate(FAKE_SAVE)
    problems = []
    for i, js in enumerate(OUTPUT_STEPS):
        try:
            if i == 0:
                await page.evaluate("() => { window.__saveSink = window.showSaveFilePicker; }")
            if i == 3:
                await page.evaluate("() => { window.showSaveFilePicker = window.__saveSink; }")   # the faked save dialog again
            await page.evaluate(js)
        except Exception as e:  # noqa: BLE001 - reported with the violations
            problems.append('step %d failed: %s' % (i, str(e).splitlines()[0]))
        await page.wait_for_timeout(300)
    done = await page.evaluate('() => window.__done || []')
    violations = await page.evaluate('window.__cspViolations')
    await page.close()
    if done != ['done', 'done', 'done', 1]:
        problems.append('not every output flow ran (WebM, set in a folder, set as a ZIP, SRT through the dialog): %r' % done)
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
                for rel, lang in PAGES[:2]:
                    problems = await check_output(browser, base, rel, lang)
                    print('%s %s WebM, Filmora set, subtitles' % ('FAIL' if problems else 'ok  ', rel))
                    failures += ['%s output: %s' % (rel, msg) for msg in problems]
                for rel, lang in PAGES[:2]:
                    problems = await check_media(browser, base, rel, lang)
                    print('%s %s photos and videos' % ('FAIL' if problems else 'ok  ', rel))
                    failures += ['%s photos and videos: %s' % (rel, msg) for msg in problems]
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
