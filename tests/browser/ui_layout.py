#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: the §6.1 layout invariants and the §6.2 geometry table in Chromium.

For every viewport of DESIGN §8.3 × ja/en × 16:9 / 9:16 / 21:9 × the panel/drawer/rail states, with lyrics loaded and a
toast showing, it asserts: the four regions never overlap and match computeLayout (±1 px); the page does not scroll; the
canvas equals the §6.2 table (16:9 and 9:16 columns) and computeLayout everywhere (±1 px); nothing covers the preview;
no label is clipped, by itself or by a clipping parent (e.g. a segment cut off by its segmented control); and the
control budgets (header ≤ 6, play bar ≤ 8, 4 step tabs, ≤ 5 controls per step body).

The fullest play bar (a song loaded → 音, two looks → n/m, the editor focused → the Ctrl+Shift+Enter hint, 詳細 open
with the step column kept) must keep every control whole inside the bar and the stage at every viewport; step ④ with
詳しく open is checked at the standard layout. Behaviour checks for the regressions found in review: a mouse click on
the lyric gutter selects and opens 詳細 (the textarea must not take it); a double-click on preview text reaches the
element although the first click reflows the stage; the first-run autoplay mute is never stored; the decoded song
follows doc.song through undo, redo, new work and open, and re-linking checks the file; a work-scope reroll is a new
seed; undo puts the lyric caret back.

With no lyrics yet, [サンプルで試す] lies inside the editor at every viewport and at the short ones of EMPTY_VIEWPORTS
(1024×600 …), and the empty editor shows no gutter (final fixes, ui-data).

Step ④ is also checked with its longest pre-flight items and their fix links (透過PNG leaving out a screen effect; an
MP4 of a transparent backdrop).

v2.1 (DESIGN_2_1 §7.4): on the v21 project, the curve widget with かんたん open, the keyframe editor, the AI board and a
material page are checked at every viewport with the same layout, clipping, covering and budget checks; the panel never
scrolls sideways, and the viewports cover panel widths from 288 to 352 px.

Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/ui_layout.py [--quick] [--shots DIR] [--root DIR]
"""
import argparse
import asyncio
import functools
import http.server
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch, new_page  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

VIEWPORTS = [(1920, 1080), (1440, 900), (1440, 789), (1366, 768), (1280, 800), (1280, 720), (1280, 689), (1200, 700),
             (1024, 768), (1024, 640)]
QUICK = [(1440, 900), (1280, 800), (1024, 768)]
ASPECTS = ['16:9', '9:16', '21:9']
# DESIGN §6.2 table: viewport → (nothing open, 詳細 kept, 詳細 + rail, drawer, 9:16 nothing open).
TABLE = {
    (1920, 1080): ((1568, 882), (1216, 684), (1488, 837), (1344, 756), (506, 900)),
    (1440, 900): ((1088, 612), (736, 414), (1008, 567), (1024, 576), (405, 720)),
    (1440, 789): ((1082, 609), (736, 414), (1008, 567), (826, 465), (342, 609)),
    (1366, 768): ((1014, 570), (662, 372), (934, 525), (789, 444), (330, 588)),
    (1280, 800): ((952, 535), (640, 360), (888, 499), (846, 476), (348, 620)),
    (1280, 720): ((960, 540), (648, 364), (896, 504), (814, 458), (320, 570)),
    (1280, 689): ((958, 539), (648, 364), (896, 504), (759, 427), (303, 539)),
    (1200, 700): ((880, 495), (568, 319), (816, 459), (778, 438), (309, 550)),
    (1024, 768): ((672, 378), (672, 378), None, (672, 378), (330, 588)),
    (1024, 640): ((680, 382), (680, 382), None, (672, 378), (275, 490)),
}
STATES = [  # name, view patch, table column
    ('none', {'panel': None, 'rail': False, 'railBy': None, 'drawer': False}, 0),
    ('details', {'panel': 'details', 'rail': False, 'railBy': None, 'drawer': False}, 1),
    ('details+rail', {'panel': 'details', 'rail': True, 'railBy': 'auto', 'drawer': False}, 2),
    ('drawer', {'panel': None, 'rail': False, 'railBy': None, 'drawer': True}, 3),
    ('ai+drawer+rail', {'panel': 'ai', 'rail': True, 'railBy': 'auto', 'drawer': True}, None),
]
FONT_HOSTS = ('https://fonts.googleapis.com/**', 'https://fonts.gstatic.com/**')
# ui-data (ux-4): short viewports where the empty editor's [サンプルで試す] used to fall below the editor's visible area.
EMPTY_VIEWPORTS = [(1024, 600), (1100, 650), (1200, 600), (1360, 600)]
# The empty editor: [サンプルで試す] lies inside the editor's box, and no gutter squeezes the placeholder.
EMPTY_PROBE = """() => {
  const ed = document.querySelector('.lyric-editor'), b = document.querySelector('[data-ctl="sample"]');
  if (!ed || !ed.getClientRects().length) return null;          // a layout without the step column (compact side tabs)
  if (!b || !b.getClientRects().length) return 'the sample button is not shown';
  const e = ed.getBoundingClientRect(), r = b.getBoundingClientRect();
  const out = Math.max(e.top - r.top, r.bottom - e.bottom, e.left - r.left, r.right - e.right);
  if (out > 0.5) return 'the sample button is outside the editor by ' + Math.round(out) + ' px';
  const g = document.querySelector('.le-gutter');
  if (g && g.getClientRects().length && g.getBoundingClientRect().width > 0) return 'the gutter shows in the empty editor';
  return null;
}"""
# Step ④ with 詳しく open: the standard layout (296 px step column) and the wide one.
EXPORT_MORE = [(1440, 900), (1280, 720), (1280, 689), (1200, 700)]

# window.__wav(seconds, name) → a mono 16-bit WAV File with a clicked 440 Hz tone (enough for decode and analysis).
WAV_JS = r"""
() => {
  window.__wav = (seconds, name) => {
    const rate = 22050, n = Math.round(seconds * rate);
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const str = (o, x) => { for (let i = 0; i < x.length; i++) v.setUint8(o + i, x.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const click = i % (rate / 2) < rate * 0.04 ? 1 : 0.15;
      v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 12000 * click), true);
    }
    return new File([buf], name, { type: 'audio/wav' });
  };
}
"""

# The play bar: every shown control whole and inside the bar and the stage.
PLAYBAR_PROBE = r"""
() => {
  const q = (s) => document.querySelector(s);
  const bar = q('.controls').getBoundingClientRect();
  const stage = q('.region-stage').getBoundingClientRect();
  const problems = [];
  for (const el of q('.controls').querySelectorAll('button, input')) {
    if (el.hidden || el.closest('[hidden]')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const name = (el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 30);
    if (r.left < bar.left - 0.5 || r.right > bar.right + 0.5 || r.top < bar.top - 0.5 || r.bottom > bar.bottom + 0.5) {
      problems.push(name + ' outside the bar by ' + Math.round(Math.max(r.right - bar.right, bar.left - r.left)) + ' px');
    }
    if (r.left < stage.left - 0.5 || r.right > stage.right + 0.5) problems.push(name + ' outside the stage');
    if (el.scrollWidth > el.clientWidth + 1) problems.push(name + ' clipped');
  }
  return {
    problems, fit: q('.controls').dataset.fit, kbd: q('.omakase-key').textContent,
    mute: !q('[data-act="audio.mute"]').hidden, hist: !q('.hist-pos').hidden, layout: window.__mv.layout.layout,
  };
}
"""

# Controls whose labels must never be cut, and the ancestor walk that finds a control cut off by a clipping parent
# (overflow hidden) or pushing a scroll container sideways. Rows scrolled out of a vertical scroll container are fine.
CLIP_JS = r"""
  const CONTROLS = '.region-header button, .controls button, .step-tab, .rail-step, .tab, .seg, .chip, .chip-btn, .btn, '
    + '.hbtn, .select, .text-input, .num-input';
  const cutByParent = (el) => {
    const r = el.getBoundingClientRect();
    let hScroll = false, vScroll = false;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const ar = a.getBoundingClientRect();
      const tag = '.' + (String(a.className).split(' ')[0] || a.tagName.toLowerCase());
      const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      if (!hScroll && clipX && (r.left < ar.left - 1 || r.right > ar.right + 1)) return 'cut by ' + tag;
      if (!vScroll && clipY && (r.top < ar.top - 1 || r.bottom > ar.bottom + 1)) return 'cut by ' + tag;
      if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') {
        if (a.scrollWidth > a.clientWidth + 1) return tag + ' scrolls sideways';
        hScroll = true;
      }
      if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') vScroll = true;
    }
    return null;
  };
"""

# Step ④'s one line on transparency (no transparent video in the browser): shown, whole, inside the step column.
ALPHA_NOTE = r"""
() => {
""" + CLIP_JS + r"""
  const el = document.querySelector('.step-export [data-note="alpha"]');
  if (!el || el.hidden || el.closest('[hidden]')) return 'the transparency note is missing';
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return 'the transparency note is not shown';
  if (el.scrollWidth > el.clientWidth + 1) return 'the transparency note is clipped';
  const why = cutByParent(el);
  return why ? 'the transparency note is ' + why : null;
}
"""

# One in-page probe: DOM rects, computeLayout, scroll, clipped labels, covered preview, budgets.
PROBE = r"""
() => {
""" + CLIP_JS + r"""
  const app = window.__mv;
  const L = MV.use('ui/layout');
  const vs = app.view.state;
  const res = L.computeLayout({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight },
    { panel: vs.panel, rail: vs.rail, drawer: vs.drawer, aspect: app.doc.look.aspect });
  const box = (el) => { if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; };
  const q = (s) => document.querySelector(s);
  const regions = {
    header: box(q('.region-header')), steps: box(q('.region-steps')), rail: box(q('.region-rail')), side: box(q('.region-side')),
    stage: box(q('.region-stage')), panel: box(q('.region-panel')),
  };
  const canvas = box(q('.canvas-wrap'));
  const main = q('.canvas-main');
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const clipped = [];
  const nameOf = (el) => (el.textContent || el.getAttribute('aria-label') || el.className).trim().slice(0, 40);
  for (const el of document.querySelectorAll(CONTROLS)) {
    if (!visible(el) || el.closest('[hidden]')) continue;
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) clipped.push(nameOf(el));
    const why = cutByParent(el);
    if (why) clipped.push(nameOf(el) + ' (' + why + ')');
  }
  const covered = [];
  if (canvas) {
    for (const fx of [0.03, 0.5, 0.97]) for (const fy of [0.03, 0.5, 0.97]) {
      const x = canvas.x + canvas.w * fx, y = canvas.y + canvas.h * fy;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !hit.closest('.canvas-wrap')) covered.push(fx + ',' + fy + ':' + (hit ? hit.className || hit.tagName : 'none'));
    }
  }
  const count = (root, sel) => (root ? [...root.querySelectorAll(sel)].filter((el) => visible(el) && !el.closest('[hidden]')).length : -1);
  const body = q('.step-body');
  return {
    layout: res.layout, tier: res.tier, rects: res.rects, expect: res.canvas, regions, canvas,
    backing: main ? { w: main.width, h: main.height } : null,
    scroll: { sw: document.scrollingElement.scrollWidth, sh: document.scrollingElement.scrollHeight, iw: innerWidth, ih: innerHeight },
    clipped, covered,
    budget: {
      header: count(q('.region-header'), 'button'),
      controls: count(q('.controls'), 'button, input'),
      tabs: count(document, '.step-tab'),
      body: count(body, '[data-ctl]'),
    },
    toasts: document.querySelectorAll('.toast').length,
  };
}
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory):
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(directory)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def ensure_built(root=ROOT):
    pages = [root / 'index.html', root / 'en' / 'index.html']
    inputs = list((root / 'src').rglob('*')) + [ROOT / 'build.py']
    newest = max(p.stat().st_mtime for p in inputs if p.is_file())
    if all(p.is_file() for p in pages) and min(p.stat().st_mtime for p in pages) >= newest:
        return
    subprocess.run([sys.executable, str(ROOT / 'build.py'), '--root', str(root)], check=True)


def near(a, b, tol=1):
    return abs(a - b) <= tol


def overlap(a, b):
    return a['x'] < b['x'] + b['w'] - 0.5 and b['x'] < a['x'] + a['w'] - 0.5 and a['y'] < b['y'] + b['h'] - 0.5 and b['y'] < a['y'] + a['h'] - 0.5


def note_problems(problem, where):
    return ['%s: %s' % (where, problem)] if problem else []


def check(p, where, table_size):
    problems = []
    add = problems.append
    c, e = p['canvas'], p['expect']
    if not c:
        add('no canvas')
        return problems
    if not (near(c['w'], e['w']) and near(c['h'], e['h'])):
        add('canvas %dx%d, computeLayout %dx%d' % (c['w'], c['h'], e['w'], e['h']))
    if table_size and not (near(c['w'], table_size[0]) and near(c['h'], table_size[1])):
        add('canvas %dx%d, §6.2 table %dx%d' % (c['w'], c['h'], table_size[0], table_size[1]))
    if not (near(c['x'], e['x']) and near(c['y'], e['y'])):
        add('canvas at %d,%d, expected %d,%d' % (c['x'], c['y'], e['x'], e['y']))
    for name in ('header', 'steps', 'rail', 'side', 'stage', 'panel'):
        want, got = p['rects'].get(name), p['regions'].get(name)
        if bool(want) != bool(got):
            add('%s present=%s, computeLayout=%s' % (name, bool(got), bool(want)))
        elif want and not all(near(got[k], want[k]) for k in ('x', 'y', 'w', 'h')):
            add('%s at %r, computeLayout %r' % (name, got, want))
    shown = [(n, r) for n, r in p['regions'].items() if r]
    for i in range(len(shown)):
        for j in range(i + 1, len(shown)):
            if overlap(shown[i][1], shown[j][1]):
                add('%s overlaps %s' % (shown[i][0], shown[j][0]))
    s = p['scroll']
    if s['sw'] > s['iw'] or s['sh'] > s['ih']:
        add('page scrolls (%dx%d in %dx%d)' % (s['sw'], s['sh'], s['iw'], s['ih']))
    if p['covered']:
        add('preview covered at ' + ', '.join(p['covered']))
    if p['clipped']:
        add('clipped labels: ' + ' | '.join(sorted(set(p['clipped']))))
    b = p['budget']
    if b['header'] > 6:
        add('header has %d controls (> 6)' % b['header'])
    if b['controls'] > 8:
        add('play bar has %d controls (> 8)' % b['controls'])
    if b['tabs'] not in (4, 0):
        add('%d step tabs' % b['tabs'])
    if b['body'] > 5:
        add('step body has %d controls (> 5)' % b['body'])
    backing = p['backing']
    if backing and abs(backing['w'] / max(1, backing['h']) - c['w'] / max(1, c['h'])) > 0.02:
        add('backing store %r does not keep the aspect' % backing)
    return ['%s: %s' % (where, msg) for msg in problems]


async def settle(page):
    await page.evaluate('() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))')


async def run_lang(browser, base, rel, lang, viewports, shots):
    page = await new_page(browser, viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    for host in FONT_HOSTS:
        await page.route(host, lambda route: route.abort())
    await page.goto(base + rel + '?fresh=1&test=1', wait_until='load')
    await page.wait_for_function('window.__mv && window.__mv.ready')
    await page.evaluate('async () => { await window.__mv.ready; }')
    failures, checked = [], 0
    # ui-data (ux-4): the empty editor shows [サンプルで試す] whole, at every viewport and the short ones below 700 px.
    for (w, h) in viewports + EMPTY_VIEWPORTS:
        await page.set_viewport_size({'width': w, 'height': h})
        await settle(page)
        bad = await page.evaluate(EMPTY_PROBE)
        if bad:
            failures.append('%s %dx%d empty lyrics: %s' % (lang, w, h, bad))
        checked += 1
        if shots and (w, h) == (1024, 600):
            await page.screenshot(path=str(Path(shots) / ('%s_%dx%d_empty.png' % (lang, w, h))))
    await page.set_viewport_size({'width': 1440, 'height': 900})
    await page.evaluate("() => { window.__mv.view.setPref('autoplay', false); window.__mv.loadSample(); }")
    for (w, h) in viewports:
        await page.set_viewport_size({'width': w, 'height': h})
        for aspect in ASPECTS:
            await page.evaluate("(a) => window.__mv.dispatch({ t: 'look.set', key: 'aspect', v: a })", aspect)
            for name, patch, col in STATES:
                await page.evaluate("(p) => { window.__mv.view.set(p); window.__mv.toast('layout check'); }", patch)
                await settle(page)
                probe = await page.evaluate(PROBE)
                size = None
                row = TABLE[(w, h)]
                if aspect == '16:9' and col is not None:
                    size = row[col]
                elif aspect == '9:16' and name == 'none':
                    size = row[4]
                failures += check(probe, '%s %dx%d %s %s' % (lang, w, h, aspect, name), size)
                checked += 1
                if shots and aspect == '16:9' and name in ('none', 'details+rail'):
                    await page.screenshot(path=str(Path(shots) / ('%s_%dx%d_%s.png' % (lang, w, h, name.replace('+', '_')))))
    # Every step body within budget at one viewport.
    await page.set_viewport_size({'width': 1440, 'height': 900})
    await page.evaluate("() => { window.__mv.dispatch({ t: 'look.set', key: 'aspect', v: '16:9' }); window.__mv.view.set({ panel: null, rail: false, drawer: false }); }")
    for step in ('lyrics', 'song', 'look', 'export'):
        await page.evaluate('(s) => window.__mv.goStep(s)', step)
        await settle(page)
        probe = await page.evaluate(PROBE)
        failures += check(probe, '%s step %s' % (lang, step), (1088, 612))
        if shots:
            await page.screenshot(path=str(Path(shots) / ('%s_step_%s.png' % (lang, step))))
    # Step ④ with 詳しく open (範囲 全体 / 選んだ行 / I–O 範囲 must fit the step column).
    await page.evaluate("() => { const d = document.querySelector('.step-export details.more'); d.open = true; }")
    for (w, h) in EXPORT_MORE:
        await page.set_viewport_size({'width': w, 'height': h})
        await settle(page)
        failures += check(await page.evaluate(PROBE), '%s %dx%d step export + 詳しく' % (lang, w, h), None)
        failures += note_problems(await page.evaluate(ALPHA_NOTE), '%s %dx%d step export + 詳しく' % (lang, w, h))
        if shots:
            await page.screenshot(path=str(Path(shots) / ('%s_%dx%d_export_more.png' % (lang, w, h))))
    # INT-UI: step ④ with its longest pre-flight items and their fix links: 透過PNG with a screen effect it leaves out,
    # and an MP4 of a transparent backdrop (an older file; the choices themselves keep the pair consistent).
    await page.evaluate("""() => { document.querySelector('.step-export details.more').open = false;
      const a = window.__mv, reg = a.reg;
      const fx = reg.keys('filter').find((k) => reg.get('filter', k).alphaSafe === false);
      if (fx) a.batch({ label: ['undo.pin', { field: 'x', scope: 'y' }] }, [{ t: 'pin.set', path: 'work:filter.count', v: 1, by: 'user' },
        { t: 'pin.set', path: 'work:filter#0', v: fx, by: 'user' }]);
      document.querySelector('[data-seg="format"] [data-v="pngAlpha"]').click(); }""")
    for label, js in (('透過PNG', None), ('MP4 + 透明', """() => { const a = window.__mv;
      a.batch({ label: ['undo.output', {}] }, [{ t: 'output.set', key: 'format', v: 'mp4' }, { t: 'look.set', key: 'backdrop', v: 'clear' }]); }""")):
        if js:
            await page.evaluate(js)
        for (w, h) in EXPORT_MORE:
            await page.set_viewport_size({'width': w, 'height': h})
            await settle(page)
            failures += check(await page.evaluate(PROBE), '%s %dx%d step export %s' % (lang, w, h, label), None)
            failures += note_problems(await page.evaluate(ALPHA_NOTE), '%s %dx%d step export %s' % (lang, w, h, label))
            if shots:
                await page.screenshot(path=str(Path(shots) / ('%s_%dx%d_export_%s.png' % (lang, w, h, 'alpha' if js is None else 'mp4clear'))))
    await page.evaluate("""() => { const a = window.__mv;
      a.batch({ label: ['undo.output', {}] }, [{ t: 'output.set', key: 'format', v: 'mp4' }, { t: 'look.set', key: 'backdrop', v: 'scene' },
        { t: 'pin.clear', path: 'work:filter.count' }, { t: 'pin.clear', path: 'work:filter#0' }]);
      a.goStep('lyrics'); }""")
    failures += await check_playbar(page, lang, viewports, shots)
    # Stacked (< 1024): vertical scroll only.
    await page.set_viewport_size({'width': 800, 'height': 900})
    await settle(page)
    stacked = await page.evaluate(PROBE)
    if stacked['layout'] != 'stacked' or stacked['scroll']['sw'] > stacked['scroll']['iw']:
        failures.append('%s 800x900: stacked layout scrolls sideways' % lang)
    if stacked['covered']:
        failures.append('%s 800x900: preview covered' % lang)
    await page.close()
    if errors:
        failures.append('%s page errors: %r' % (lang, errors))
    return checked, failures


async def check_playbar(page, lang, viewports, shots):
    """The fullest play bar: a song (音), two looks (n/m), the editor focused (Ctrl+Shift+Enter hint), 詳細 open with the
    step column kept (the state after opening 詳細 from the lyric editor); also with the focus elsewhere."""
    failures = []
    await page.evaluate(WAV_JS)
    ready = await page.evaluate("async () => { await window.__mv.loadSong(window.__wav(4, 'layout.wav')); return window.__mv.songReady(); }")
    if not ready:
        return ['%s play bar: the test song did not load' % lang]
    await page.evaluate("() => { const a = window.__mv.actions; a.run('look.omakase'); a.run('look.omakase'); }")
    for (w, h) in viewports + [(1200, 700)]:
        await page.set_viewport_size({'width': w, 'height': h})
        for focused in (True, False):
            await page.evaluate("""(focused) => {
              const app = window.__mv;
              app.goStep('lyrics');
              app.view.set({ panel: 'details', rail: false, railBy: null, drawer: false });
              if (focused) app.shell.steps.bodies.lyrics.editor.focus(); else document.activeElement.blur();
            }""", focused)
            await settle(page)
            pb = await page.evaluate(PLAYBAR_PROBE)
            where = '%s %dx%d play bar (song, 2 looks, 詳細 kept%s)' % (lang, w, h, ', editor focused' if focused else '')
            if not (pb['mute'] and pb['hist']):
                failures.append(where + ': 音 or n/m not shown (mute=%s hist=%s)' % (pb['mute'], pb['hist']))
            # Compact layouts show 詳細 in place of the steps (no editor to focus) and never show the key hint.
            if focused and pb['layout'] not in ('compact', 'stacked') and pb['kbd'] != 'Ctrl+Shift+Enter':
                failures.append(where + ': key hint is %r' % pb['kbd'])
            failures += ['%s: %s (fit %s)' % (where, x, pb['fit']) for x in pb['problems']]
            if shots and focused and (w, h) in ((1200, 700), (1366, 768)):
                await page.screenshot(path=str(Path(shots) / ('%s_%dx%d_playbar_full.png' % (lang, w, h))))
    await page.evaluate("() => { document.activeElement.blur(); window.__mv.view.set({ panel: null }); }")
    return failures


# v2.1 (package F, DESIGN_2_1 §7.4): the new pages in the 詳細 / AI panel at every viewport: the curve widget with
# かんたん open, the keyframe editor, the board and a material page fit the panel (288–352 px wide), with the same layout,
# clipping, covering and control-budget checks as above.
V21_TEXT = (ROOT / 'tests' / 'fixtures' / 'project_v21.json').read_text(encoding='utf-8')
V21_PAGES = [
    ('curve', """() => { const a = window.__mv; a.openPanel('details');
      a.select({ level: 'line', ids: ['r4'] }, { from: 'crumbs', open: true }); }""",
     "() => !!document.querySelector('.frow[data-slot=\"arrive.ease\"] .cw-simple:not([hidden])')"),
    ('keyframes', """() => { const a = window.__mv; a.openPanel('details');
      a.select({ level: 'el', scope: 'cut/' + a.plan.lines[1].cuts[0], el: 'lens' }, { from: 'crumbs', open: true });
      requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector('[data-custom="camKeys"] button').click())); }""",
     "() => document.querySelectorAll('.ke-page .ke-row').length > 1"),
    ('board', """() => { const a = window.__mv; a.openPanel('ai');
      requestAnimationFrame(() => document.querySelector('.ai-board-link').click()); }""",
     "() => document.querySelectorAll('.ai-board .ai-board-row').length > 1"),
    ('material', """() => { const a = window.__mv; a.openPanel('details'); a.select({ level: 'work' }, { from: 'crumbs', open: true });
      requestAnimationFrame(() => requestAnimationFrame(() => { a.inspector.openSection('materials');
        requestAnimationFrame(() => document.querySelector('.mat-row[data-mat="m3"] .insp-item').click()); })); }""",
     "() => !!document.querySelector('.mat-page .mat-name')"),
]


# The open panel narrowed to `px` (CSSOM, restored after): no control of the new page (`scope`) is clipped or cut off, and
# the page does not stick out of the panel or scroll sideways.
NARROW_PROBE = r"""
async ([px, scope]) => {
""" + CLIP_JS + r"""
  const panel = document.querySelector('.region-panel:not([hidden])') || document.querySelector('.region-side:not([hidden])');
  const root = document.querySelector(scope);
  if (!panel || !root) return ['no panel or no ' + scope];
  const old = panel.style.width;
  panel.style.width = px + 'px';
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
  const out = [];
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  for (const el of root.querySelectorAll(CONTROLS)) {
    if (!visible(el) || el.closest('[hidden]')) continue;
    const name = (el.textContent || el.getAttribute('aria-label') || el.className).trim().slice(0, 40);
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 2) out.push('clipped: ' + name);
    const why = cutByParent(el);
    if (why) out.push(name + ' ' + why);
  }
  const pr = panel.getBoundingClientRect(), rr = root.getBoundingClientRect();
  if (rr.right > pr.right + 0.5) out.push(scope + ' sticks out by ' + Math.round(rr.right - pr.right) + ' px');
  if (root.scrollWidth > root.clientWidth + 1) out.push(scope + ' scrolls sideways (' + root.scrollWidth + ' in ' + root.clientWidth + ')');
  panel.style.width = old;
  return [...new Set(out)];
}
"""


NARROW_SCOPE = {'curve': '.frow[data-slot="arrive.ease"]', 'keyframes': '.ke-page', 'board': '.ai-board', 'material': '.mat-page'}


async def v21_pages(browser, base, rel, lang, viewports, shots):
    page = await new_page(browser, viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    for host in FONT_HOSTS:
        await page.route(host, lambda route: route.abort())
    await page.goto(base + rel + '?fresh=1&test=1', wait_until='load')
    await page.wait_for_function('window.__mv && window.__mv.ready')
    await page.evaluate('async () => { await window.__mv.ready; }')
    await page.evaluate("""async (text) => { const a = window.__mv; a.view.setPref('autoplay', false);
      await a.io.openFiles([new File([text], 'v21.json', { type: 'application/json' })]); a.pause();
      a.dispatch({ t: 'pin.set', path: 'line/r4:arrive.ease', v: { ramp: { edge: 0.1, ends: 'both', peak: 6 } }, by: 'user' }); }""", V21_TEXT)
    failures, checked, widths = [], 0, set()
    for (w, h) in viewports:
        await page.set_viewport_size({'width': w, 'height': h})
        for name, js, ready in V21_PAGES:
            await page.evaluate("() => { const a = window.__mv; a.view.set({ rail: false, railBy: null, drawer: false }); }")
            await page.evaluate(js)
            if not await poll(page, ready):
                failures.append('%s %dx%d %s: the page did not open' % (lang, w, h, name))
                continue
            if name == 'curve':
                await page.evaluate("() => document.querySelector('.frow[data-slot=\"arrive.ease\"]').scrollIntoView({ block: 'center' })")
            await settle(page)
            probe = await page.evaluate(PROBE)
            where = '%s %dx%d %s' % (lang, w, h, name)
            failures += check(probe, where, None)
            panel = probe['regions'].get('panel') or probe['regions'].get('side')
            side = await page.evaluate("""() => { const p = document.querySelector('.region-panel:not([hidden]), .region-side:not([hidden])');
              const s = p && p.querySelector('.insp-sub:not([hidden]), .insp-body, .ai-panel');
              return p ? { sw: (s || p).scrollWidth, cw: (s || p).clientWidth } : null; }""")
            if side and side['sw'] > side['cw'] + 1:
                failures.append('%s: the panel scrolls sideways (%d in %d)' % (where, side['sw'], side['cw']))
            if panel:
                widths.add(round(panel['w']))
            checked += 1
            if shots and (w, h) in ((1024, 768), (1440, 900)):
                await page.screenshot(path=str(Path(shots) / ('%s_%dx%d_v21_%s.png' % (lang, w, h, name))))
            # The narrowest panel the design allows (288 px; no layout of §6.2 makes it that narrow today).
            if (w, h) == viewports[0]:
                bad = await page.evaluate(NARROW_PROBE, [288, NARROW_SCOPE[name]])
                failures += ['%s at a 288 px panel: %s' % (where, x) for x in bad]
            await page.keyboard.press('Escape')
    if viewports == VIEWPORTS and not {312, 320, 352} <= widths:
        failures.append('%s: the new pages were not checked at every panel width of §6.2 (saw %r)' % (lang, sorted(widths)))
    await page.close()
    if errors:
        failures.append('%s v2.1 pages: page errors: %r' % (lang, errors[:3]))
    return checked, failures, sorted(widths)


async def poll(page, js, timeout_ms=4000):
    """Waits until the expression is truthy; returns its last value."""
    try:
        await page.wait_for_function(js, timeout=timeout_ms)
    except Exception:  # noqa: BLE001 - the caller reports the value it got
        pass
    return await page.evaluate(js)


async def behaviour(browser, base, rel, lang):
    """Regression checks from review: gutter clicks, preview double-click, first-run mute, song ↔ doc.song, relink,
    work-scope reroll, lyric caret on undo, the diff readout."""
    failures = []
    fail = lambda msg: failures.append('%s behaviour: %s' % (lang, msg))  # noqa: E731
    page = await new_page(browser, viewport={'width': 1440, 'height': 900}, reduced_motion='no-preference')
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    for host in FONT_HOSTS:
        await page.route(host, lambda route: route.abort())
    await page.goto(base + rel + '?fresh=1&test=1', wait_until='load')
    await page.wait_for_function('window.__mv && window.__mv.ready')
    await page.evaluate('async () => { await window.__mv.ready; }')
    await page.evaluate(WAV_JS)

    # First run (§6.9.2): the autoplay is muted once; the stored preference is untouched.
    r = await page.evaluate("""() => {
      const app = window.__mv;
      app.loadSample();
      const stored = JSON.parse(localStorage.getItem('mojipv.prefs') || '{}');
      const during = { playing: app.view.state.playing, muted: app.isMuted(), pref: app.view.state.prefs.muted, stored: stored.muted };
      app.pause();
      return Object.assign(during, { after: app.isMuted() });
    }""")
    if not (r['playing'] and r['muted']):
        fail('first-run autoplay should play muted: %r' % r)
    if r['pref'] or r['stored']:
        fail('first-run mute leaked into the preferences: %r' % r)
    if r['after']:
        fail('still muted after the autoplay stopped')

    # Lyric gutter: a real mouse click selects the line and opens 詳細 without folding; Ctrl adds; a heading selects its section.
    await page.evaluate("() => { const app = window.__mv; app.goStep('lyrics'); app.view.set({ panel: null, rail: false, railBy: null }); }")
    await settle(page)
    entries = await page.evaluate("""() => {
      const view = document.querySelector('.lyric-editor').getBoundingClientRect();
      return [...document.querySelectorAll('.le-g')].map((el) => {
        const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
        const hit = document.elementFromPoint(x, y);
        return { row: el.dataset.row, heading: !!el.dataset.heading, x, y, top: !!(hit && hit.closest('.le-g') === el),
          shown: y > view.top + 2 && y < view.bottom - 2 };
      }).filter((e) => e.shown);
    }""")
    lines = [e for e in entries if not e['heading']]
    if len(lines) < 2:
        fail('fewer than two gutter entries: %r' % entries)
    else:
        if not all(e['top'] for e in entries):
            fail('the textarea covers gutter entries: %r' % [e['row'] for e in entries if not e['top']])
        await page.mouse.click(lines[0]['x'], lines[0]['y'])
        st = await page.evaluate('() => { const v = window.__mv.view.state; return { sel: v.sel, panel: v.panel, rail: v.rail }; }')
        if st['panel'] != 'details' or st['rail'] or st['sel'] != {'level': 'line', 'ids': [lines[0]['row']]}:
            fail('gutter click: %r' % st)
        second = await page.evaluate('(row) => { const r = document.querySelector(\'.le-g[data-row="\' + row + \'"]\').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }', lines[1]['row'])
        await page.keyboard.down('Control')
        await page.mouse.click(second[0], second[1])
        await page.keyboard.up('Control')
        ids = await page.evaluate('() => window.__mv.view.state.sel.ids || []')
        if sorted(ids) != sorted([lines[0]['row'], lines[1]['row']]):
            fail('Ctrl+click on the gutter should add the line: %r' % ids)
        heads = [e for e in entries if e['heading']]
        if heads:
            want = await page.evaluate("""(row) => {
              const app = window.__mv, rows = app.doc.sheet.rows, at = rows.findIndex((r) => r.id === row), out = [];
              for (let i = at + 1; i < rows.length && !/^\s*#/.test(rows[i].src); i++) if (app.plan.lines.some((l) => l.id === rows[i].id)) out.push(rows[i].id);
              return out;
            }""", heads[0]['row'])
            box = await page.evaluate('(row) => { const r = document.querySelector(\'.le-g[data-row="\' + row + \'"]\').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }', heads[0]['row'])
            await page.mouse.click(box[0], box[1])
            got = await page.evaluate('() => window.__mv.view.state.sel.ids || []')
            if got != want:
                fail('heading gutter click selected %r, want %r' % (got, want))

    # Undo puts the caret back where the typing started; redo after the typed text.
    r = await page.evaluate("""() => {
      const app = window.__mv; app.view.set({ panel: null, rail: false, railBy: null });
      const ta = document.querySelector('.le-text'); ta.focus(); ta.setSelectionRange(4, 4); return ta.value;
    }""")
    await page.keyboard.type('XYZ')
    await page.keyboard.press('Control+z')
    after = await page.evaluate("() => { const ta = document.querySelector('.le-text'); return [ta.value, ta.selectionStart]; }")
    if after != [r, 4]:
        fail('undo of typing: text restored=%s caret=%r (want 4)' % (after[0] == r, after[1]))
    await page.keyboard.press('Control+Shift+z')
    redo = await page.evaluate("() => document.querySelector('.le-text').selectionStart")
    if redo != 7:
        fail('redo of typing: caret %r (want 7)' % redo)
    await page.keyboard.press('Control+z')

    # Preview double-click with 詳細 closed: straight to the element, although the first click opens 詳細 and folds.
    target = await page.evaluate("""async () => {
      const app = window.__mv;
      document.activeElement.blur();
      app.view.set({ panel: null, rail: false, railBy: null, sel: { level: 'work' } });
      const line = app.plan.lines[0];
      app.seek((line.t0 + line.t1) / 2);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const box = app.engine.boxes().find((b) => b.owner === 'text');
      if (!box) return null;
      const q = box.quad, rect = document.querySelector('.canvas-wrap').getBoundingClientRect();
      const k = rect.width / app.plan.design.w;
      return [rect.left + (q[0] + q[4]) / 2 * k, rect.top + (q[1] + q[5]) / 2 * k];
    }""")
    if not target:
        fail('no text box on the preview to double-click')
    else:
        await page.mouse.dblclick(target[0], target[1])
        st = await page.evaluate('() => { const v = window.__mv.view.state; return { sel: v.sel, panel: v.panel, rail: v.rail }; }')
        if st['sel'].get('level') != 'el' or st['sel'].get('el') != 'text' or st['panel'] != 'details' or not st['rail']:
            fail('double-click on preview text: %r' % st)

    # Reroll on a work-scope element page is a new seed, never salts['work'].
    r = await page.evaluate("""() => {
      const app = window.__mv;
      app.select({ level: 'el', scope: 'work', el: 'text' }, { from: 'crumbs' });
      const seed = app.doc.look.seed;
      app.actions.run('look.reroll');
      return { salts: Object.keys(app.doc.salts), changed: app.doc.look.seed !== seed };
    }""")
    if 'work' in r['salts'] or not r['changed']:
        fail('work-scope reroll: %r' % r)

    # The diff readout after おまかせ and after its undo (§6.7).
    heads = ['行が変わりました', '全体が変わりました', 'changed']
    r = await page.evaluate("""() => {
      const app = window.__mv; app.view.set({ panel: null, rail: false, railBy: null }); app.shell.toasts.clearAll();
      app.actions.run('look.omakase');
      const a = [...document.querySelectorAll('.toast-text')].map((x) => x.textContent);
      app.shell.toasts.clearAll();
      app.actions.run('edit.undo');
      return [a, [...document.querySelectorAll('.toast-text')].map((x) => x.textContent)];
    }""")
    for label, texts in (('おまかせ', r[0]), ('undo', r[1])):
        if not any(h in x for x in texts for h in heads):
            fail('no diff readout after %s: %r' % (label, texts))

    # A provisional frame (§4.20) is redrawn while paused, without anything else invalidating the stage.
    n = await page.evaluate("""async () => {
      const app = window.__mv, engine = app.engine, orig = engine.renderFrame;
      app.pause();
      let calls = 0;
      engine.renderFrame = function (...args) {
        calls += 1;
        return Object.assign({}, orig.apply(engine, args), { provisional: calls < 4 });
      };
      app.shell.stage.invalidate();
      await new Promise((r) => setTimeout(r, 900));
      engine.renderFrame = orig;
      return calls;
    }""")
    if n < 4:
        fail('a paused provisional frame was not redrawn (%d renders)' % n)

    # The decoded song follows doc.song: load, undo, redo (re-linked from IndexedDB), clear + undo, new work.
    ready = "() => window.__mv.songReady()"
    r = await page.evaluate("async () => { await window.__mv.loadSong(window.__wav(4, 'a.wav')); return [window.__mv.songReady(), window.__mv.doc.song.sha1]; }")
    if not r[0]:
        fail('the song did not load')
    song_a = r[1]
    r = await page.evaluate("() => { const app = window.__mv; app.store.undo(); return { song: app.doc.song, buffer: !!app.buffer, mute: !document.querySelector('[data-act=\"audio.mute\"]').hidden }; }")
    if r['song'] or r['buffer'] or r['mute']:
        fail('undo of song.set kept the audio: %r' % r)
    await page.evaluate('() => window.__mv.store.redo()')
    if not await poll(page, ready):
        fail('redo of song.set did not re-link the audio from IndexedDB')
    await page.evaluate('() => window.__mv.clearSong()')
    if await page.evaluate('() => !!window.__mv.buffer'):
        fail('clearing the song kept the audio')
    await page.evaluate('() => window.__mv.store.undo()')
    if not await poll(page, ready):
        fail('undo of song.clear did not re-link the audio')
    await page.evaluate('() => window.__mv.io.newWork()')
    r = await page.evaluate('() => ({ buffer: !!window.__mv.buffer, state: window.__mv.songState().state })')
    if r['buffer'] or r['state'] != 'none':
        fail('new work kept the previous song: %r' % r)

    # Opening a project whose song is not stored: 「曲をつなぎ直してください」; the picker checks the file (§6.11).
    await page.evaluate("""(sha) => {
      const app = window.__mv, D = MV.use('core/doc');
      const doc = D.defaultDoc();
      doc.sheet = Object.assign({}, doc.sheet, { rows: [{ id: 'r1', src: 'ひとつめ' }, { id: 'r2', src: 'ふたつめ' }] });
      doc.song = { name: 'lost.wav', sha1: 'f'.repeat(40), seconds: 4, bpm: null, offset: 0, digest: null };
      app.loadProject(doc, D.defaultSide());
    }""", song_a)
    state = await poll(page, "() => window.__mv.songState().state !== 'linking' && window.__mv.songState().state")
    if state != 'missing':
        fail('a project without its stored song should ask to re-link, got %r' % state)
    else:
        banner = await page.evaluate("() => { window.__mv.goStep('song'); return !!document.querySelector('.step-song .inline-error'); }")
        if not banner:
            fail('step ② shows no re-link banner')
        r = await page.evaluate("async () => { const app = window.__mv; const ok = await app.relinkFile(window.__wav(8, 'other.wav')); return [ok, app.songReady()]; }")
        if r != [False, False]:
            fail('a song of another length was linked: %r' % r)
        r = await page.evaluate("""async () => {
          const app = window.__mv; const undo = app.store.peek().undo; app.confirm = async () => true;
          const ok = await app.relinkFile(window.__wav(4, 'same-length.wav'));
          return [ok, app.songReady(), app.doc.song.sha1, app.store.peek().undo === undo];
        }""")
        if r != [True, True, 'f' * 40, True]:
            fail('a same-length file should re-link without changing the document: %r' % r)
    await page.close()
    if errors:
        fail('page errors: %r' % errors)
    return failures


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--quick', action='store_true', help='three viewports instead of ten')
    ap.add_argument('--shots', help='write screenshots to this directory')
    ap.add_argument('--root', help='the tree to build and serve, with src/ and vendor/ (default: this one), e.g. a staging copy')
    args = ap.parse_args()
    root = Path(args.root).resolve() if args.root else ROOT
    ensure_built(root)
    if args.shots:
        Path(args.shots).mkdir(parents=True, exist_ok=True)
    server = serve(root)
    base = 'http://127.0.0.1:%d/' % server.server_address[1]
    viewports = QUICK if args.quick else VIEWPORTS
    total, failures = 0, []
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                for rel, lang in (('index.html', 'ja'), ('en/index.html', 'en')):
                    n, f = await run_lang(browser, base, rel, lang, viewports, args.shots)
                    total += n
                    failures += f
                    print('%s %s: %d layouts checked' % ('FAIL' if f else 'ok  ', lang, n))
                    f = await behaviour(browser, base, rel, lang)
                    failures += f
                    print('%s %s: behaviour checks' % ('FAIL' if f else 'ok  ', lang))
                    n, f, widths = await v21_pages(browser, base, rel, lang, viewports, args.shots)
                    total += n
                    failures += f
                    print('%s %s: %d v2.1 pages checked (panel widths %r)' % ('FAIL' if f else 'ok  ', lang, n, widths))
            finally:
                await browser.close()
    finally:
        server.shutdown()
    for msg in failures[:60]:
        print('  ' + msg)
    if len(failures) > 60:
        print('  … and %d more' % (len(failures) - 60))
    print('ui_layout.py: %s' % ('FAILED (%d problems)' % len(failures) if failures else 'OK (%d layouts)' % total))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
