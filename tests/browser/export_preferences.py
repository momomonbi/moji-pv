#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. JA/EN export preference controls and one-step speed changes.

The probe is controlled to verify preference cache keys and stale responses, not native GPU capability (covered by
codec tests). Checks the real radio controls, saved CPU/auto choices, speed caps for every format, preserved output
settings, a single undo, and keeping a pre-existing 24 fps choice. Run after the pages have been built:
PW_EXECUTABLE=/usr/bin/chromium python3 tests/browser/export_preferences.py [--root DIR]
"""
import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402
from ui_flows import DOC, DONE, Flow, open_page, serve, with_lyrics  # noqa: E402

PREF = '[data-seg="acceleration"]'
SPEED = '[data-act="export.speed"]'
HINT = '[data-note="acceleration"]'

INSTALL_PROBE = r"""() => {
  const a = window.__mv, original = a.svc.exporter.mp4;
  window.__preferenceProbes = [];
  window.__holdCpuProbe = false;
  a.svc.exporter.mp4 = Object.assign({}, original, { probe: (options) => new Promise((resolve) => {
    const cpu = options.acceleration === 'cpu';
    const entry = {options: {...options}, done: false};
    entry.resolve = () => {
      if (entry.done) return;
      entry.done = true;
      const acceleration = { requested: options.acceleration, selected: cpu ? 'prefer-software' : 'prefer-hardware', fallback: false };
      resolve({webcodecs: true, codec: 'avc1.640028', anyCodec: true, vp9Codec: 'vp09.00.31.08',
        audioCodec: 'mp4a.40.2', audioBitrate: 320000, audioBitrateMode: 'constant',
        webmAudioCodec: 'opus', webmAudioBitrate: 320000, webmAudioBitrateMode: 'constant',
        acceleration, webmAcceleration: acceleration});
    };
    window.__preferenceProbes.push(entry);
    if (!(cpu && window.__holdCpuProbe)) queueMicrotask(entry.resolve);
  })});
  a.batch({label: ['undo.output', {}]}, [
    {t: 'output.set', key: 'short', v: 2160},
    {t: 'output.set', key: 'fps', v: 60},
  ]);
  a.goStep('export'); a.pause();
}"""


async def preferences(flow):
    page = flow.page
    await page.evaluate(INSTALL_PROBE)
    await page.wait_for_function("() => document.querySelector('[data-note=\"acceleration\"]').dataset.selected === 'prefer-hardware'")
    assert await page.locator(PREF + ' [data-v="auto"]').get_attribute('aria-checked') == 'true'
    original = await page.evaluate(DOC)
    done = await page.evaluate(DONE)
    await page.locator(PREF + ' [data-v="cpu"]').click()
    await page.wait_for_function("() => document.querySelector('[data-note=\"acceleration\"]').dataset.selected === 'prefer-software'")
    assert await page.evaluate('() => window.__mv.doc.output.acceleration') == 'cpu'
    assert await page.evaluate(DONE) == done + 1
    assert await page.locator(PREF + ' [data-v="cpu"]').get_attribute('aria-checked') == 'true'
    saved = await page.evaluate("() => MV.use('core/migrate').parseFile(MV.use('core/doc').serialize({doc: window.__mv.doc})).doc.output.acceleration")
    assert saved == 'cpu'
    await flow.blur()
    await page.keyboard.press('Control+z')
    await page.wait_for_function("() => document.querySelector('[data-note=\"acceleration\"]').dataset.selected === 'prefer-hardware'")
    assert await page.evaluate(DOC) == original
    assert await page.evaluate(DONE) == done

    # A slower obsolete CPU response cannot overwrite a newer auto request or its explanatory text.
    await page.evaluate('() => { window.__holdCpuProbe = true; }')
    await page.locator(PREF + ' [data-v="cpu"]').click()
    await page.wait_for_function("() => window.__preferenceProbes.some((p) => p.options.acceleration === 'cpu' && !p.done)")
    pending = await page.evaluate("() => window.__preferenceProbes.findIndex((p) => p.options.acceleration === 'cpu' && !p.done)")
    await page.locator(PREF + ' [data-v="auto"]').click()
    await page.wait_for_function("() => document.querySelector('[data-note=\"acceleration\"]').dataset.selected === 'prefer-hardware'")
    await page.evaluate('async (index) => { window.__preferenceProbes[index].resolve(); await Promise.resolve(); await Promise.resolve(); }', pending)
    assert await page.locator(HINT).get_attribute('data-selected') == 'prefer-hardware'
    assert await page.evaluate('() => window.__mv.doc.output.acceleration') == 'auto'
    requests = await page.evaluate('() => window.__preferenceProbes.map((p) => p.options.acceleration)')
    assert 'cpu' in requests and 'auto' in requests and requests.count('auto') >= 2, requests
    await page.evaluate('() => { window.__holdCpuProbe = false; }')


async def speed(flow):
    page = flow.page
    for format_name in ('mp4', 'webmAlpha', 'png', 'pngAlpha', 'kit'):
        await page.evaluate("""(format) => {
          const a = window.__mv, OUT = MV.use('ui/output');
          a.batch({label: ['undo.output', {}]}, OUT.formatCmds(a.doc, format).concat([
            {t: 'output.set', key: 'short', v: 2160}, {t: 'output.set', key: 'fps', v: 60},
            {t: 'output.set', key: 'quality', v: 'light'}, {t: 'output.set', key: 'acceleration', v: 'cpu'},
            {t: 'output.set', key: 'audio', v: false}, {t: 'output.set', key: 'range', v: {t0: 2, t1: 9}},
            {t: 'output.set', key: 'kit', v: {overlay: false, bg: true, green: true, srt: false, lrc: true}},
          ]));
        }""", format_name)
        await flow.settle()
        original = json.loads(await page.evaluate(DOC))
        done = await page.evaluate(DONE)
        assert await page.locator(SPEED).is_enabled()
        assert await page.locator(PREF).is_visible() == (format_name not in ('png', 'pngAlpha'))
        await page.locator(SPEED).click()
        await flow.settle()
        changed = json.loads(await page.evaluate(DOC))
        expected = json.loads(json.dumps(original))
        expected['output']['short'] = 1080 if format_name == 'kit' else 720
        expected['output']['fps'] = 30
        assert changed == expected, format_name + ': unrelated output settings changed'
        assert await page.evaluate(DONE) == done + 1, format_name + ': speed was not one undo entry'
        assert await page.locator(SPEED).is_disabled()
        await flow.blur()
        await page.keyboard.press('Control+z')
        await flow.settle()
        assert json.loads(await page.evaluate(DOC)) == original
        assert await page.evaluate(DONE) == done

    await page.evaluate("""() => {
      const a = window.__mv;
      a.batch({label: ['undo.output', {}]}, MV.use('ui/output').formatCmds(a.doc, 'mp4').concat([
        {t: 'output.set', key: 'short', v: 1080}, {t: 'output.set', key: 'fps', v: 24},
      ]));
    }""")
    await flow.settle()
    await page.locator(SPEED).click()
    await flow.settle()
    assert await page.evaluate('() => window.__mv.doc.output.fps') == 24
    assert await page.evaluate('() => window.__mv.doc.output.short') == 720
    assert await page.locator(SPEED).is_disabled()


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    server = serve(args.root)
    base = 'http://127.0.0.1:' + str(server.server_address[1])
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            for language, rel in [('ja', '/index.html'), ('en', '/en/index.html')]:
                page = await open_page(browser, base, rel)
                flow = Flow('export_preferences_' + language, page, None)
                await with_lyrics(flow)
                await preferences(flow)
                await speed(flow)
                assert not flow.errors, flow.errors
                assert not await page.evaluate('window.__csp'), 'CSP violation'
                print(language + ': passed — preference probes, stale results, all speed formats and one undo', flush=True)
                await page.close()
            await browser.close()
    finally:
        server.shutdown()


if __name__ == '__main__':
    asyncio.run(main())
