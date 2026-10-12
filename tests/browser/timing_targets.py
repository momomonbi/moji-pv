#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Real JA/EN timing target controls, bounded nudges and undo.

Run: PW_EXECUTABLE=/usr/bin/chromium python3 tests/browser/timing_targets.py [--no-build] [--shots DIR]
"""
import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402
from ui_flows import DOC, DONE, Flow, ensure_built, open_page, serve  # noqa: E402

TEXT = '# A\n[00:05.00]abcdef/ghijkl/mnopqr\n[00:10.00]second line\n\n# B\n[00:15.00]third line\n[00:20.00]last line'
TARGET = '[data-ctl="shift-target"]'
AREA = '[data-ctl="shift-area"]'
SHIFT = '[data-ctl="shift"]'
STATUS = '[data-ctl="shift-status"]'
TIMES = '() => window.__mv.plan.lines.map((l) => [l.id, l.t0, l.t1])'


def same_time(a, b):
    return len(a) == len(b) and all(x[0] == y[0] and abs(x[1] - y[1]) < 1e-5 and abs(x[2] - y[2]) < 1e-5
                                 for x, y in zip(a, b))


async def setup(f):
    await f.page.evaluate('''(text) => {
      const a = window.__mv;
      a.view.setPref('autoplay', false);
      a.dispatch({ t: 'lyrics.set', text }, { label: ['undo.paste', {}] });
      a.store.seal(); a.firstRun(); a.pause(); a.view.set({ step: 'song' });
    }''', TEXT)
    await f.until('() => window.__mv.plan && window.__mv.plan.lines.length === 4', 'fixture planned')
    await f.settle()
    await f.page.locator(TARGET).wait_for(state='visible')
    f.check(await f.page.locator(TARGET + ' option').count() == 3, 'all, section and selection targets available')
    f.check('song.shift' not in await f.page.locator(SHIFT).inner_text(), 'all timing labels are translated')
    return await f.page.evaluate(DOC), await f.page.evaluate(DONE), await f.page.evaluate(TIMES)


async def undo(f, doc, count):
    await f.page.evaluate('() => window.__mv.store.undo()')
    await f.settle()
    f.check(await f.page.evaluate(DOC) == doc and await f.page.evaluate(DONE) == count, 'one undo restores the complete original document')


async def lines(f):
    page = f.page
    doc, count, before = await setup(f)
    await page.locator(TARGET).select_option('selection')
    f.check(await page.locator(SHIFT + ' [data-shift]').evaluate_all('(bs) => bs.every((b) => b.disabled)'),
            'nothing selected disables nudges instead of shifting everything')
    await page.evaluate('() => { const a = window.__mv; a.select({ level: "line", ids: [a.plan.lines[1].id] }, { from: "test", seek: false }); }')
    await f.settle()
    for _ in range(3):
        await page.locator(SHIFT + ' [data-shift="-0.1"]').click()
    after = await page.evaluate(TIMES)
    want = [[x[0], x[1] - (0.3 if i == 1 else 0), x[2] - (0.3 if i == 1 else 0)] for i, x in enumerate(before)]
    f.check(same_time(after, want), 'three nudges move only the selected line, keeping duration and neighbours')
    f.check(await page.evaluate(DONE) == count + 1, 'three repeated button presses merge into one undo entry')
    f.check(before[1][0] not in await page.locator(STATUS).inner_text(), 'target status is a readable line label')
    await f.shot('selected_line')
    await undo(f, doc, count)


async def sections(f):
    page = f.page
    doc, count, before = await setup(f)
    await page.locator(TARGET).select_option('area')
    await page.locator(AREA).select_option('head:r5')
    f.check(await page.evaluate(DOC) == doc and await page.evaluate(DONE) == count, 'choosing a section does not mutate history')
    await page.locator(SHIFT + ' [data-shift="-1"]').click()
    after = await page.evaluate(TIMES)
    want = [[x[0], x[1] - (1 if i >= 2 else 0), x[2] - (1 if i >= 2 else 0)] for i, x in enumerate(before)]
    f.check(same_time(after, want), 'only the two chosen section lines move by the same second')
    f.check('B' in await page.locator(STATUS).inner_text(), 'the current section is named in the status')
    await f.shot('selected_section')
    await undo(f, doc, count)
    await page.locator(TARGET).select_option('all')
    await page.locator(SHIFT + ' [data-shift="-1"]').click()
    after = await page.evaluate(TIMES)
    want = [[x[0], x[1] - 1, x[2] - 1] for x in before]
    f.check(same_time(after, want), 'the original global one-second nudge remains available')
    await undo(f, doc, count)


async def cuts(f):
    page = f.page
    doc, count, before = await setup(f)
    cut = await page.evaluate('''() => { const a = window.__mv; const c = a.plan.cuts.find((c) => c.key === a.plan.lines[0].cuts[1]);
      a.select({ level: "cut", key: c.key }, { from: "test", seek: false }); return { key: c.key, t0: c.t0, t1: c.t1,
        boundaries: a.plan.cuts.filter((x) => x.line === c.line).map((x) => [x.key, x.t0]) }; }''')
    await page.locator(TARGET).select_option('selection')
    await page.locator(SHIFT + ' [data-shift="0.1"]').click()
    boundaries = await page.evaluate('() => window.__mv.plan.cuts.filter((c) => c.line === window.__mv.plan.lines[0].id).map((c) => [c.key, c.t0, c.t1])')
    f.check(same_time(await page.evaluate(TIMES), before), 'cut boundary editing does not move its parent or unrelated lines')
    f.check(all(abs(x[1] - (y[1] + (0.1 if x[0] == cut['key'] else 0))) < 1e-5 for x, y in zip(boundaries, cut['boundaries'])),
            'only the selected inner cut start changes; sibling starts stay fixed')
    f.check(abs(next(x[2] for x in boundaries if x[0] == cut['key']) - cut['t1']) < 1e-5, 'selected cut end is fixed')
    await f.shot('selected_cut')
    await undo(f, doc, count)


async def boundaries(f):
    page = f.page
    doc, count, before = await setup(f)
    await page.evaluate('() => { const a = window.__mv; a.select({ level: "line", ids: [a.plan.lines[1].id] }, { from: "test", seek: false }); }')
    await page.locator(TARGET).select_option('selection')
    for _ in range(5):
        await page.locator(SHIFT + ' [data-shift="-1"]').click()
    after = await page.evaluate(TIMES)
    f.check(abs(after[1][1] - before[0][1] - 0.1) < 1e-5, 'large repeated shifts stop at the preceding line start plus margin')
    f.check(await page.locator(SHIFT + ' [data-shift="-1"]').is_disabled(), 'earlier nudge is disabled when it reaches the boundary')
    f.check(same_time(after[:1] + after[2:], before[:1] + before[2:]), 'all nonselected lines remain stable at the boundary')
    f.check(await page.evaluate('() => !window.__mv.plan.warnings.some((w) => w.code === "time-order")'), 'the real plan has no invalid timing-order warning')
    await f.shot('boundary')
    await undo(f, doc, count)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root')
    ap.add_argument('--shots')
    ap.add_argument('--no-build', action='store_true')
    args = ap.parse_args()
    root = Path(args.root).resolve() if args.root else ROOT
    if not args.no_build:
        ensure_built(root)
    if args.shots:
        Path(args.shots).mkdir(parents=True, exist_ok=True)
    server = serve(root)
    base = 'http://127.0.0.1:%d/' % server.server_address[1]
    failures, total = [], 0
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                for rel, lang in (('index.html', 'ja'), ('en/index.html', 'en')):
                    for name, run in (('lines', lines), ('sections', sections), ('cuts', cuts), ('boundaries', boundaries)):
                        page = await open_page(browser, base, rel)
                        f = Flow(lang + '_' + name, page, args.shots)
                        try:
                            await run(f)
                        except Exception as e:
                            f.problems.append(str(e))
                        failures.extend(f.name + ': ' + x for x in f.problems + f.errors)
                        total += 1
                        print(f.name + ': ' + ('FAILED' if f.problems or f.errors else 'OK'), flush=True)
                        await page.context.close()
            finally:
                await browser.close()
    finally:
        server.shutdown()
    for x in failures:
        print('  ' + x)
    print('timing_targets.py: ' + ('FAILED (%d problems)' % len(failures) if failures else 'OK (%d flows)' % total))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
