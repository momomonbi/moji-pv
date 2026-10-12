#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Real song-clock timers in legacy numbered parts and barcodes, JA/EN.

Uses actual compiled pages, native Canvas drawing and real PNG sequence exports. A single LRC lyric cut crosses
59.8→60.2 seconds (00:59.80→01:00.20); paused/seeking/rewound frames must agree with the absolute song clock and exported frame pixels.
Old saved sidebarIndex/serialMark keys and number pins are retained. Barcode labels also follow the live song time.
Hidden/none decorations draw no timer.
Run: PW_EXECUTABLE=/usr/bin/chromium python3 tests/browser/song_timer.py --no-build
"""
import argparse
import asyncio
import base64
import hashlib
import io
from pathlib import Path
import sys
import zipfile

from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch  # noqa: E402
from ui_flows import Flow, ensure_built, open_page, serve  # noqa: E402

LYRICS = '[00:58.00]ワームホール\n[01:02.00]夜明けの空\n[01:06.00]未来へ'
SETUP = r"""([text, kind, aspect, orient]) => {
  const a = window.__mv, fb = (k) => a.reg.fallback(k);
  a.view.setPref('autoplay', false); a.view.setPref('quality', 'sharp');
  a.dispatch({ t: 'lyrics.set', text }); a.pause();
  const pins = { 'work:arrange': kind === 'sidebarIndex' ? kind : fb('arrange'),
    'work:orient': orient, 'work:arrive': fb('arrive'), 'work:dwell': fb('dwell'), 'work:depart': fb('depart'),
    'work:lens': fb('lens'), 'work:seam': fb('seam'), 'work:cam.shot': 'none', 'work:rig': 'none',
    'work:filter.count': 0, 'work:atmos': 'none', 'work:texture': 'none', 'work:amount.shake': 0, 'work:amount.flash': 0,
    'work:text.style': 'plain', 'work:ornament.count': kind === 'sidebarIndex' ? 0 : 1,
    ...(kind === 'barCode' ? {} : { 'work:arrange@sidebarIndex.number': '42', 'work:ornament#0@serialMark.number': '42' }),
    'work:arrange@sidebarIndex.side': 'left',
    'work:ornament#0': kind === 'sidebarIndex' ? 'none' : kind,
    'work:ornament#0@serialMark.place': 'bottomRight', 'work:ornament#0@serialMark.rule': false,
    ...(kind === 'barCode' ? { 'work:ornament#0@barCode.react': 0 } : {}),
    ['line/' + a.plan.lines[0].id + ':end']: 62,
  };
  a.batch({}, [ ...Object.entries(pins).map(([path, v]) => ({ t: 'pin.set', path, v, by: 'user' })),
    { t: 'look.set', key: 'aspect', v: aspect }, { t: 'look.set', key: 'backdrop', v: 'black' },
    { t: 'output.set', key: 'format', v: 'png' }, { t: 'output.set', key: 'audio', v: false },
    { t: 'output.set', key: 'short', v: 720 }, { t: 'output.set', key: 'fps', v: 30 },
  ]); a.store.seal();
  const saved = MV.use('core/migrate').parseFile(MV.use('core/doc').serialize({ doc: a.doc, side: a.store.side }));
  a.store.load(saved.doc, saved.side); a.pause(); a.seek(59.8);
  const one = (t) => a.plan.cuts.filter((c) => c.a <= t && t < c.b && c.text);
  const left = one(59.8), right = one(60.2);
  window.__timerCut = a.plan.cuts.indexOf(left[0]); window.__timerScene = a.engine.scene('cut', window.__timerCut);
  window.__timerDoc = JSON.stringify(a.doc);
  return { keys: [left.map((c) => c.key), right.map((c) => c.key)],
    kind: left[0] && left[0].slots[kind === 'sidebarIndex' ? 'arrange' : 'ornament#0'].v,
    span: left[0] && [left[0].t0, left[0].t1],
    number: kind === 'barCode' ? null : a.doc.pins['work:' + (kind === 'sidebarIndex' ? 'arrange@sidebarIndex.number' : 'ornament#0@serialMark.number')].v };
}"""

INSTRUMENT = r"""() => {
  const a = window.__mv;
  window.__timerDraws = [];
  const install = (engine) => {
    const render = engine.renderFrame, fork = engine.fork;
    engine.renderFrame = function (surface, time, opts) {
      for (let i = 0; i < engine.plan.cuts.length; i++) {
        const cut = engine.plan.cuts[i];
        if (!cut.text || time < cut.a || time >= cut.b) continue;
        const scene = engine.scene('cut', i);
        for (const rec of scene.stores.paint) {
          if (!rec.data || rec.data.kind !== 'timer' || rec.testRecorded) continue;
          const draw = rec.draw;
          rec.testRecorded = true;
          rec.draw = function (g, local, data, q) {
            const scope = window.__timerScope;
            window.__timerDraws.push({ absolute: q.time, local, frame: scope && scope.time, canvas: scope && scope.canvas });
            return draw.call(this, g, local, data, q);
          };
        }
      }
      const prev = window.__timerScope;
      window.__timerScope = { time, canvas: surface.canvas };
      try { return render.call(this, surface, time, opts); }
      finally { window.__timerScope = prev; }
    };
    engine.fork = (...args) => install(fork.apply(engine, args));
    return engine;
  };
  install(a.engine);
}"""

FRAME = r"""async (time) => {
  const a = window.__mv, size = MV.use('export/schedule').outputSize(a.plan.design.aspect, 720);
  const factory = MV.use('engine/host/canvas').createCanvasFactory();
  window.__timerDraws = [];
  const made = factory.create(size.w, size.h, { alpha: false });
  a.engine.renderFrame({ ...made, w: size.w, h: size.h }, time,
    { quality: 'export', scale: size.w / a.plan.design.w, backdrop: 'black', glyphPath: 'direct' });
  const timers = window.__timerDraws.filter((r) => r.canvas === made.canvas).map(({ absolute, local, frame }) => ({ absolute, local, frame }));
  const blob = await made.canvas.convertToBlob({ type: 'image/png' }), bytes = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return { png: btoa(s), cached: window.__timerScene === a.engine.scene('cut', window.__timerCut), timers };
}"""

STAGE = r"""() => document.querySelector('.canvas-main').toDataURL('image/png').split(',')[1]"""


def rgba(data):
    with Image.open(io.BytesIO(data)) as image:
        return image.convert('RGBA').tobytes()


def digest(b64):
    return hashlib.sha256(rgba(base64.b64decode(b64))).hexdigest()


async def flow(f, kind, aspect, orient, shots):
    page = f.page
    setup = await page.evaluate(SETUP, [LYRICS, kind, aspect, orient])
    f.check(setup['keys'][0] == setup['keys'][1] and len(setup['keys'][0]) == 1, '59.8 and 60.2 belong to the same actual lyric cut')
    f.check(setup['span'][0] <= 59 and setup['span'][1] >= 61, 'test lyric remains in its hold window across all clock samples: %r' % setup['span'])
    f.check(setup['kind'] == kind and (setup['number'] is None if kind == 'barCode' else setup['number'] == '42'),
            'saved part key and any legacy number pin survive reload')
    await page.evaluate(INSTRUMENT)
    await page.evaluate('async () => { await window.__mv.engine.prepare(59, 61, { export: true }); }')
    frames = {}
    for time in (59.8, 60.2, 59.123, 59.129, 59.131, 60.203, 60.209, 59.8, 60.2):
        result = await page.evaluate(FRAME, time)
        f.check(result['cached'], 'timer update reuses its cached scene')
        f.check(len(result['timers']) == 1 and abs(result['timers'][0]['absolute'] - time) < 1e-9,
                'native timer painter receives absolute song time at %g: %r' % (time, result['timers']))
        hashed = digest(result['png'])
        f.check(time not in frames or frames[time] == hashed, 'out-of-order time rendering is deterministic')
        frames[time] = hashed
        if shots and time in (59.8, 60.2):
            (shots / (f.name + '_%s.png' % ('0059' if time < 60 else '0100'))).write_bytes(base64.b64decode(result['png']))
    f.check(frames[59.8] != frames[60.2], 'animated timer pixels change across the minute boundary')
    labels = await page.evaluate('(times) => times.map((t) => MV.use("parts/timecode").format(t))', [59.123, 59.129, 59.131, 60.203, 60.209, 59.8, 60.2])
    f.check(labels == ['00:59.12', '00:59.12', '00:59.13', '01:00.20', '01:00.20', '00:59.80', '01:00.20'],
            'centisecond labels hold/change independently of animation and include the correct absolute minute: %r' % labels)
    await page.evaluate('() => { const a = window.__mv; a.pause(); a.seek(59.8); }')
    await f.settle(3)
    if shots and f.name == 'ja_sidebarIndex_h':
        await page.evaluate('() => window.__mv.goStep("look")')
        await f.settle(3)
        await page.screenshot(path=str(shots / 'timer_app.png'))
    paused = digest(await page.evaluate(STAGE))
    await page.wait_for_timeout(200)
    f.check(digest(await page.evaluate(STAGE)) == paused, 'paused timer does not advance with wall time')
    await page.evaluate('() => window.__mv.seek(60.2)')
    await f.settle(2)
    f.check(digest(await page.evaluate(STAGE)) != paused, 'seek immediately updates the visible timer')
    await page.evaluate('() => window.__mv.seek(59.8)')
    await f.settle(2)
    f.check(digest(await page.evaluate(STAGE)) == paused, 'backward seek restores the same visible frame')
    await page.evaluate('() => { const a = window.__mv; window.__timerDraws = []; a.seek(59); a.play(); }')
    await f.until(r"""() => window.__mv.view.state.playing && window.__timerDraws.some((r) => r.canvas === document.querySelector('.canvas-main') && r.absolute < 60)""",
                  'genuine pre-minute playing frame', timeout=5000)
    await f.until(r"""() => window.__timerDraws.some((r) => r.canvas === document.querySelector('.canvas-main') && r.absolute >= 60.05)""",
                  'actual playback crosses the minute', timeout=5000)
    await page.evaluate('() => window.__mv.pause()')
    await f.settle(2)
    played = await page.evaluate(r"""() => ({ playing: window.__mv.view.state.playing, time: window.__mv.time(),
      times: window.__timerDraws.filter((r) => r.canvas === document.querySelector('.canvas-main')).map((r) => r.absolute) })""")
    f.check(not played['playing'] and any(t < 60 for t in played['times']) and any(t >= 60 for t in played['times']),
            'native preview timer follows the real playback clock on both sides of the minute')
    f.check(await page.evaluate('() => JSON.stringify(window.__mv.doc) === window.__timerDoc'), 'timer render/seek does not write the project')

    await page.evaluate(r"""() => {
      const a = window.__mv, ex = a.svc.exporter, sink = ex.sink;
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
      ex.sink = Object.assign({}, sink, {
        openSink: async (o) => sink.createMemorySink({ name: o.name, type: 'application/zip' }),
        downloadBlob: () => {},
      });
      a.dispatch({ t: 'output.set', key: 'range', v: { t0: 59.75, t1: 60.25 } });
      a.store.seal(); a.goStep('export'); window.__timerDraws = [];
    }""")
    await page.locator('[data-act="export.start"]').click()
    await f.until('() => ["done", "error"].includes(window.__mv.exportState().phase)', 'actual PNG sequence exported', timeout=60000)
    state = await page.evaluate(r"""async () => {
      const s = window.__mv.exportState();
      if (s.phase !== 'done') return { error: s.message };
      const bytes = new Uint8Array(await s.result.blob.arrayBuffer()); let bin = '';
      for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return { zip: btoa(bin), frames: s.result.frames,
        times: window.__timerDraws.filter((r) => r.canvas !== document.querySelector('.canvas-main')).map((r) => r.absolute) };
    }""")
    f.check('error' not in state, 'real PNG output completes: %r' % state.get('error'))
    if 'error' in state:
        return
    f.check(state['frames'] == 15, 'half-second PNG range produces 15 frames')
    times = [59.75 + i / 30 for i in range(15)]
    f.check(len(state['times']) == 15 and all(abs(a - b) < 1e-9 for a, b in zip(state['times'], times)),
            'every exported timer uses absolute range time, starting at 59.75 rather than zero')
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(state['zip']))) as archive:
        names = archive.namelist()
        f.check(len(names) == 15, 'actual ZIP holds every PNG frame')
        for name, time in zip(names, times):
            expected = await page.evaluate(FRAME, time)
            f.check(rgba(archive.read(name)) == rgba(base64.b64decode(expected['png'])),
                    'export PNG agrees pixel-for-pixel with song time %0.6f' % time)
    if shots and f.name == 'ja_sidebarIndex_h':
        animation = []
        for i in range(30):
            sample = await page.evaluate(FRAME, 59.5 + i / 30)
            with Image.open(io.BytesIO(base64.b64decode(sample['png']))) as image:
                animation.append(image.convert('RGB').resize((960, 540), Image.Resampling.LANCZOS))
        animation[0].save(shots / 'timer_rollover.gif', save_all=True, append_images=animation[1:],
                          duration=[30, 30, 40] * 10, loop=0, disposal=2)
    # Keep the part key while hiding it through the existing control. Legacy empty numbers remain the opt-out.
    await page.evaluate('() => window.__mv.exportReset()')
    hide = 'work:el.text.hide' if kind == 'sidebarIndex' else 'work:el.ornament#0.hide'
    prefix = 'work:arrange@sidebarIndex' if kind == 'sidebarIndex' else 'work:ornament#0@' + kind
    number = None if kind == 'barCode' else prefix + '.number'
    show = prefix + '.showTime'
    visibility_checks = [(hide, True)]
    if number:
        visibility_checks += [(number, ''), (number, '   ')]
    for path, value in visibility_checks:
        await page.evaluate(r"""([path, value, hide, show]) => {
          const a = window.__mv; a.batch({}, [{ t: 'pin.clear', path: hide }, { t: 'pin.clear', path: show }, { t: 'pin.set', path, v: value, by: 'user' }]);
          if (typeof value === 'string') { const file = MV.use('core/migrate').parseFile(MV.use('core/doc').serialize({ doc: a.doc, side: a.store.side }));
            a.store.load(file.doc, file.side); }
        }""", [path, value, hide, show])
        result = await page.evaluate(FRAME, 60.2)
        expected = path == number and value == '   ' and kind == 'serialMark'
        f.check(bool(result['timers']) == expected, 'old visibility intent is retained (serial whitespace was a visible 00 label)')
    await page.evaluate("([show, number, hide]) => window.__mv.batch({}, [{ t: 'pin.clear', path: hide }, { t: 'pin.set', path: show, v: true, by: 'user' }, ...(number ? [{ t: 'pin.set', path: number, v: '42', by: 'user' }] : [])])", [show, number, hide])
    f.check(len((await page.evaluate(FRAME, 60.2))['timers']) == 1, 'the current visibility switch restores the timer')
    motion = prefix + '.motion'
    await page.evaluate("(path) => window.__mv.dispatch({ t: 'pin.set', path, v: 0, by: 'user' })", motion)
    still = {}
    for time in (59.123, 59.129, 59.131, 60.203, 60.209):
        still[time] = digest((await page.evaluate(FRAME, time))['png'])
    f.check(still[59.123] == still[59.129] and still[60.203] == still[60.209], 'motion zero preserves pixels within a displayed centisecond')
    f.check(still[59.123] != still[59.131], 'motion zero still updates the .12 to .13 digit')
    await page.evaluate("(path) => window.__mv.dispatch({ t: 'pin.clear', path })", motion)
    await page.evaluate("(path) => window.__mv.dispatch({ t: 'pin.set', path, v: false, by: 'user' })", show)
    f.check(not (await page.evaluate(FRAME, 60.2))['timers'], 'the current visibility switch hides the timer')
    if kind != 'sidebarIndex':
        await page.evaluate("(path) => window.__mv.dispatch({ t: 'pin.set', path, v: true, by: 'user' })", show)
        f.check(len((await page.evaluate(FRAME, 60.2))['timers']) == 1, 'timer is visible before testing none')
        await page.evaluate(r"""(number) => { const a = window.__mv;
          a.batch({}, [...(number ? [{ t: 'pin.set', path: number, v: '42', by: 'user' }] : []),
            { t: 'pin.set', path: 'work:ornament#0', v: 'none', by: 'user' }]); }""", number)
        result = await page.evaluate(FRAME, 60.2)
        f.check(not result['timers'], 'none decoration draws no timer')


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root')
    ap.add_argument('--no-build', action='store_true')
    ap.add_argument('--shots', type=Path)
    ap.add_argument('--kind', choices=('sidebarIndex', 'serialMark', 'barCode'))
    args = ap.parse_args()
    if args.shots:
        args.shots.mkdir(parents=True, exist_ok=True)
    root = Path(args.root).resolve() if args.root else ROOT
    if not args.no_build:
        ensure_built(root)
    server = serve(root)
    failures, cases = [], 0
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                for rel, lang in (('index.html', 'ja'), ('en/index.html', 'en')):
                    for kind, aspect, orient in (('sidebarIndex', '16:9', 'h'), ('sidebarIndex', '9:16', 'v'), ('serialMark', '16:9', 'h'), ('barCode', '16:9', 'h')):
                        if args.kind and kind != args.kind:
                            continue
                        page = await open_page(browser, 'http://127.0.0.1:%d/' % server.server_address[1], rel)
                        f = Flow(lang + '_' + kind + '_' + orient, page, None)
                        try:
                            await flow(f, kind, aspect, orient, args.shots)
                        except Exception as error:
                            f.problems.append(str(error))
                        f.problems += ['page error: ' + e for e in f.errors]
                        csp = await page.evaluate('() => window.__csp')
                        if csp:
                            f.problems.append('CSP: ' + repr(csp))
                        print(('FAIL ' if f.problems else 'ok   ') + f.name, flush=True)
                        for problem in f.problems:
                            print('  ' + problem, flush=True)
                        failures += [f.name + ': ' + x for x in f.problems]
                        cases += 1
                        await page.close()
            finally:
                await browser.close()
    finally:
        server.shutdown()
    print('song_timer.py: %s (%d JA/EN cases)' % ('FAILED' if failures else 'OK', cases))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
