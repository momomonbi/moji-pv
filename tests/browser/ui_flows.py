#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: the UI flows of DESIGN §8.3 (first version, WP8b).

Flows, each on a fresh page (new browser context) and each ending with undo-all = the document it started from:
  first run with the mouse   paste → focus moves to the stage → おまかせ → step ④ (the 2 s 720p MP4 is exported and its
                             video sample count checked only where this browser can encode H.264; local Chromium skips it)
  first run, keyboard only   Ctrl+V → R → 4 → I → Esc
  drill-click to 文字        preview click → line → cut → 文字; drag the text (one undo entry); double-click → 文字
  pin → おまかせ keeps it    pin 入り in the part browser → おまかせ keeps it → Del unpins
  lock survives おまかせ     L locks a line; おまかせ changes other lines only; L unlocks
  ◀ ▶ follows undo           [ ] step the look history; Ctrl+Z / Ctrl+Shift+Z move the n/m pointer back and forth
  tools                      Ctrl+K palette, ≡ menu, ? shortcut sheet, the timeline drawer (drag a line = one entry)
  keys                       the part browser's keys stay inside it (and it closes with 詳細); slider and choice arrows;
                             Del acts on the focused row only and never removes a lock pin
  values                     the line page's 切り替え pins the first cut only; a pinned parameter of a replaced part shows
                             as 無効 with ×; clicking an auto cut ┊ pins the split; LRC starts are marks in the 行 list;
                             [ロックし直す]; [テーマの色に戻す]; picking a tried look with Enter keeps the focus
  AI (WP8c)                  a faked Gemini answers through page.route (never the network); the key goes in the header only,
                             audio only for the song tools after the consent card. ai_prep: 詳細 opened while the request
                             runs gives way to the review, stale rows, unchecking (rows updated in place), apply = one undo
                             step, selective revert from the log counted in accepted changes; ai_looks: three cards, try-on
                             of B, switch to C, hold B to compare, [やめる], nothing checked leaves only [やめる] in the
                             strip, この案にする from the mode strip, revert; ai_edit: the AI asks back inline, then (compact
                             layout, 詳細 side tab during the run) the selected line's change is applied; ai_align: consent,
                             stage line, audio part first, start pins by ai. During a review 詳細 is disabled and the panel
                             never covers the preview; hovering a review row outlines its line on the preview.
  output (INT-UI)            透過PNG ⇔ 透明 as one undo entry; the one-line transparency note; skipped effects greyed; the
                             summary uses the clamped range; a 3-frame PNG export; a large in-memory export asks first
                             from Ctrl+K and from the button
  cutkeys (INT-UI)           pins of a cut under an older key: pick, ⋯ 範囲を広げる, ×, the 自動 try-on, [d] and
                             [このカットに付け直す] all act where the pins are stored; nothing is orphaned
  song (INT-UI)              a newer file wins over a load still running; [中止]; 曲なしで次へ
  playback (INT-LEAD)        while playing, the prepared window (scenes, blurred-glyph sprites) follows the playhead
  open_damaged (final fixes) a project with a damaged side opens, steps switch, R replans; a parser failure that is not a
                             MigrateError reads as a damaged file; a failing look history never leaves a stale plan
  autosave (final fixes)     保存中… until written; an edit 200 ms before a reload survives; opening a project inside the
                             debounce keeps each work's text under its own id; Shift_JIS .lrc; unused song audio removed
  tabs (final fixes)         two tabs of one browser: the second continues in a copy, both tabs' edits survive
  tap (final fixes)          tap-sync of 5 lines with a song (E, Backspace, one undo entry, marks = clock − latency);
                             the mouse: preview presses and the タップ button mark, a stopped clock records nothing;
                             without a song the silent clock runs past the automatic end; opening a project ends a session
  first_look (final fixes)   typed lyrics: ◀ returns to the first look; Space after clicking おまかせ plays; a fresh
                             Ctrl+K + Enter flips no setting; a tempo pin leaves ③ todo; Esc/× give focus back; ? sheet;
                             the preview's name between lines
  preview (final fixes)      reduced motion parks on line 1's hero frame; HiDPI backing ≤ 1080 / ≤ 720 at level ≥ 3;
                             なめらか優先 at once; 軽量表示; きれい優先 never steps down
  song_step (final fixes)    ② without a song says why 拍に合わせる is off; the decode error names file and formats
  clear_device (release)     ≡ › 設定 › この端末に保存した作品と曲を消す: asks first; キャンセル keeps all; 消す empties both
                             IndexedDB stores and every AI key, an empty work opens and is stored only once it changes;
                             a newer project file is named in the error
It also asserts: no page errors and no CSP violations. The ja page runs every flow; the en page runs the first run.
The first run exports with the mouse and, in the keyboard flow, with Tab + Enter. Where H.264 encodes, the file's video
sample count is checked here (stsz or trun); the decoded-frame count of the same export path is WP6's check in
tests/browser/export_check.py (it decodes with VideoDecoder). Local Chromium without H.264 skips both with a message;
CI sets MV_REQUIRE_H264=1, which makes that a failure.

Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/ui_flows.py [--shots DIR] [--only NAME] [--root DIR]
"""
import argparse
import asyncio
import functools
import http.server
import json
import os
import struct
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
from browser import launch, new_page  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402

FONT_HOSTS = ('https://fonts.googleapis.com/**', 'https://fonts.gstatic.com/**')
# MV_REQUIRE_H264=1 (CI with Google Chrome): the first-run MP4 must run; a browser without H.264 fails instead of skipping.
REQUIRE_H264 = os.environ.get('MV_REQUIRE_H264') == '1'
LYRICS = '\n'.join([
    '[ti:朝の窓]', '# Aメロ', '窓をあけて/光を入れる', 'まだ眠い街に/*おはよう*', '坂道を下って/駅まで歩く',
    '', '# サビ', '今日も/ここから始まる!', '小さな/一歩で',
])
RECORD = """
window.__csp = [];
document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
"""
STATE = """() => {
  const a = window.__mv;
  const hist = document.querySelector('.hist-pos');
  return {
    seed: a.doc.look.seed, moodSeed: a.doc.look.moodSeed, looks: a.store.side.looks.list.length, sel: a.view.state.sel,
    pins: a.doc.pins, locks: a.doc.locks, panel: a.view.state.panel, step: a.view.state.step, drawer: a.view.state.drawer,
    lines: a.plan ? a.plan.lines.length : 0, hist: hist && !hist.hidden ? hist.textContent : null,
    focus: document.activeElement ? document.activeElement.className : '', palette: !!a.paletteOpen,
  };
}"""
DONE = "() => window.__mv.store.list().filter((e) => e.done).length"
DOC = "() => JSON.stringify(window.__mv.doc)"
# The CSS point of a cut's text block on the preview (from engine.boxes(), design units → CSS px).
BOX = """(cutKey) => {
  const a = window.__mv;
  const r = document.querySelector('.canvas-wrap').getBoundingClientRect();
  const d = a.plan.design;
  const b = a.engine.boxes().find((x) => x.cut === cutKey && x.owner === 'text');
  if (!b) return null;
  const q = b.quad;
  return { x: r.left + (q[0] + q[4]) / 2 / d.w * r.width, y: r.top + (q[1] + q[5]) / 2 / d.h * r.height };
}"""
# The keyboard flow's extra lines: one long line without marks (the cutter splits it) and one LRC-stamped line.
LYRICS_MORE = LYRICS + '\n' + '\n'.join(['今日もまたここから歩き出す朝の光の中で君を待つ', '[00:59.00]時計の針が/止まるまで'])
NOW = '() => window.__mv.time()'
# Pixels of the stage overlay in the review-highlight ink (#f0b64d; the selection outline is blue).
HIGHLIGHT_INK = """() => { const c = document.querySelector('.canvas-overlay');
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 160 && d[i] > 200 && d[i + 1] > 140 && d[i + 1] < 215 && d[i + 2] < 140) n++;
  return n; }"""
# A part tile other than the one shown; the shown one when the kind has a single part (e.g. a catalog still in progress).
OTHER_TILE = """() => { const tiles = [...document.querySelectorAll('.pb-tile')].filter((t) => t.dataset.key && t.dataset.key !== 'none');
  return (tiles.find((t) => !t.classList.contains('is-current')) || tiles[0]).dataset.key; }"""
PINS = '() => JSON.stringify(window.__mv.doc.pins)'
ROW = '[data-mount="inspector"] .frow[data-slot="%s"]'
LINE_SLOTS = """(id) => window.__mv.plan.cuts.filter((c) => c.line === id)
  .map((c) => ['arrange', 'arrive', 'dwell', 'depart'].map((s) => c.slots && c.slots[s] ? c.slots[s].v : null).join(','))"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory):
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(directory)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def ensure_built(root):
    pages = [root / 'index.html', root / 'en' / 'index.html']
    inputs = list((root / 'src').rglob('*')) + [ROOT / 'build.py']
    newest = max(p.stat().st_mtime for p in inputs if p.is_file())
    if all(p.is_file() for p in pages) and min(p.stat().st_mtime for p in pages) >= newest:
        return
    subprocess.run([sys.executable, str(ROOT / 'build.py'), '--root', str(root)], check=True)


class Flow:
    """One flow on its own page: helpers for waiting, asserting and undoing."""

    def __init__(self, name, page, shots):
        self.name, self.page, self.shots = name, page, shots
        self.problems, self.errors = [], []
        page.on('pageerror', lambda e: self.errors.append(str(e)))

    def check(self, cond, what):
        if not cond:
            self.problems.append(what)
        return cond

    async def state(self):
        return await self.page.evaluate(STATE)

    async def settle(self, frames=2):
        await self.page.evaluate('(n) => new Promise((r) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : r()); f(); })', frames)

    async def until(self, js, what, arg=None, timeout=3000):
        try:
            await self.page.wait_for_function(js, arg=arg, timeout=timeout)
            return True
        except Exception:
            self.problems.append('timed out: ' + what)
            return False

    async def shot(self, label):
        if self.shots:
            await self.page.screenshot(path=str(Path(self.shots) / ('%s_%s.png' % (self.name, label))))

    async def blur(self):
        await self.page.evaluate("() => { if (document.activeElement) document.activeElement.blur(); }")

    async def undo_all(self, done0, doc0):
        """Ctrl+Z until the history is back where the flow started; the document must equal the start."""
        await self.blur()
        for _ in range(80):
            if await self.page.evaluate(DONE) <= done0:
                break
            await self.page.keyboard.press('Control+z')
        await self.settle()
        self.check(await self.page.evaluate(DOC) == doc0, 'undo-all returns to the start document')


async def open_page(browser, base, rel, clipboard=False):
    kw = {'viewport': {'width': 1440, 'height': 900}}
    if clipboard:
        kw['permissions'] = ['clipboard-read', 'clipboard-write']
    page = await new_page(browser, **kw)
    await page.add_init_script(RECORD)
    for host in FONT_HOSTS:
        await page.route(host, lambda route: route.abort())
    await page.goto(base + rel + '?fresh=1&test=1', wait_until='load')
    await page.wait_for_function('window.__mv && window.__mv.ready')
    await page.evaluate('async () => { await window.__mv.ready; }')
    return page


async def with_lyrics(f, text=LYRICS):
    """Setup shared by the editing flows: lyrics in, playback off, the first look recorded."""
    await f.page.evaluate("""(text) => {
      const a = window.__mv;
      a.view.setPref('autoplay', false);
      a.dispatch({ t: 'lyrics.set', text }, { label: ['undo.paste', {}] });
      a.store.seal();
      a.firstRun();
      a.pause();
    }""", text)
    await f.until('() => window.__mv.plan && window.__mv.plan.lines.length > 3', 'lyrics planned')
    await f.settle()
    return await f.page.evaluate(DONE), await f.page.evaluate(DOC)


async def paste(f, text):
    """A real paste (clipboard + Ctrl+V) into the focused editor; a synthetic paste when the clipboard is closed."""
    ok = await f.page.evaluate('async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; } }', text)
    if ok:
        await f.page.keyboard.press('Control+v')
    else:
        await f.page.evaluate("""(t) => {
          const ta = document.querySelector('.le-text');
          ta.dispatchEvent(new Event('paste', { bubbles: true }));
          ta.value = t;
          ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
        }""", text)


# --- flows ------------------------------------------------------------------------------------------------------------

async def flow_first_run_mouse(f, lang):
    page = f.page
    s = await f.state()
    f.check('le-text' in s['focus'], 'the editor has focus on open (§6.9.1), got %r' % s['focus'])
    f.check(await page.is_disabled('.omakase'), 'おまかせ is disabled until there is a line')
    done0, doc0 = await page.evaluate(DONE), await page.evaluate(DOC)
    await paste(f, LYRICS)
    await f.until('() => window.__mv.plan && window.__mv.plan.lines.length > 3', 'paste gives lines')
    await f.settle(3)
    s = await f.state()
    f.check(s['looks'] == 1, 'the first look is recorded (%d)' % s['looks'])
    f.check('canvas-wrap' in s['focus'], 'focus moves to the stage after the first paste, got %r' % s['focus'])
    await page.evaluate('() => window.__mv.pause()')
    seed = s['seed']
    await page.click('.omakase')
    await f.until('(s) => window.__mv.doc.look.seed !== s', 'おまかせ changes the seed', seed)
    s = await f.state()
    f.check(s['looks'] == 2, 'おまかせ appends to the look history (%d)' % s['looks'])
    await page.click('.step-tab[data-step="export"], .rail-step[data-step="export"]')
    await f.until("() => window.__mv.view.state.step === 'export'", 'step ④ opens')
    await f.shot(lang + '_export')
    await export_check(f)
    await f.undo_all(done0, doc0)


async def export_check(f, start=None, how='mouse'):
    """The 2 s 720p MP4 of the first-run flow, where this browser can encode H.264 (CI: Google Chrome). `start` presses
    [書き出す] (default: a click)."""
    page = f.page
    h264 = await page.evaluate("""async () => {
      if (typeof VideoEncoder !== 'function') return false;
      try { const r = await VideoEncoder.isConfigSupported({ codec: 'avc1.42001f', width: 1280, height: 720, bitrate: 2e6, framerate: 30 });
        return !!r.supported; } catch (e) { return false; }
    }""")
    if not h264:
        if REQUIRE_H264:
            f.check(False, 'MV_REQUIRE_H264: this browser cannot encode H.264, so the first-run MP4 (%s) did not run' % how)
            return
        print('skip  first run (%s): MP4 export (this Chromium cannot encode H.264; CI runs it in Google Chrome)' % how)
        return
    await page.evaluate("""() => {
      const a = window.__mv;
      window.showSaveFilePicker = undefined;
      a.batch({ label: ['undo.output', {}] }, [{ t: 'output.set', key: 'short', v: 720 }, { t: 'output.set', key: 'range', v: { t0: 0, t1: 2 } },
        { t: 'output.set', key: 'fps', v: 30 }]);
    }""")
    await f.settle(3)
    async with page.expect_download(timeout=60000) as info:
        if start:
            await start()
        else:
            await page.click('[data-act="export.start"]')
    data = Path(await (await info.value).path()).read_bytes()
    f.check(data[4:8] == b'ftyp', 'the export is an MP4 file')
    count = video_samples(data)
    f.check(count == 60, 'the 2 s 30 fps MP4 has 60 video samples (got %d)' % count)


def video_samples(data):
    """Samples of the (only) video track: stsz's count, or the sum of 'trun' counts in a fragmented file."""
    at = data.find(b'stsz')
    count = struct.unpack('>I', data[at + 12:at + 16])[0] if at > 0 else 0
    if count:
        return count
    total, at = 0, data.find(b'trun')
    while at > 0:
        total += struct.unpack('>I', data[at + 8:at + 12])[0]
        at = data.find(b'trun', at + 4)
    return total


async def flow_first_run_keys(f, lang):
    page = f.page
    done0, doc0 = await page.evaluate(DONE), await page.evaluate(DOC)
    await paste(f, LYRICS)
    await f.until('() => window.__mv.plan && window.__mv.plan.lines.length > 3', 'paste gives lines')
    await f.settle(3)
    await page.keyboard.press('Space')                     # the stage has focus: Space pauses the autoplay
    seed = (await f.state())['seed']
    await page.keyboard.press('r')
    await f.until('(s) => window.__mv.doc.look.seed !== s', 'R = おまかせ', seed)
    await page.keyboard.press('4')
    await f.until("() => window.__mv.view.state.step === 'export'", '4 = step ④')
    await page.keyboard.press('i')
    await f.until("() => window.__mv.view.state.panel === 'details'", 'I opens 詳細')
    # Esc climbs one level at a time (the caret selected a line while pasting); at 全体 it closes 詳細 (§6.8).
    for _ in range(4):
        if not (await f.state())['panel']:
            break
        await page.keyboard.press('Escape')
        await f.settle(1)
    s = await f.state()
    f.check(not s['panel'] and s['sel'] == {'level': 'work'}, 'Esc climbs to 全体, then closes 詳細 (%r, %r)' % (s['sel'], s['panel']))

    async def tab_and_enter():
        for _ in range(120):
            if await page.evaluate("() => !!document.activeElement && document.activeElement.dataset.act === 'export.start'"):
                break
            await page.keyboard.press('Tab')
        f.check(await page.evaluate("() => document.activeElement.dataset.act === 'export.start'"), 'Tab reaches [書き出す]')
        await page.keyboard.press('Enter')
    await export_check(f, tab_and_enter, 'keyboard')
    await f.undo_all(done0, doc0)


async def flow_drill(f, lang):
    page = f.page
    done0, doc0 = await with_lyrics(f)
    target = await page.evaluate("() => { const l = window.__mv.plan.lines.find((x) => x.cuts.length > 1); return l ? { line: l.id, cut: l.cuts[1] } : null; }")
    if not f.check(target is not None, 'a line with two cuts'):
        return
    await page.evaluate("(k) => { const a = window.__mv; a.seek(a.plan.cuts.find((c) => c.key === k).repT); }", target['cut'])
    await f.settle(3)
    pt = await page.evaluate(BOX, target['cut'])
    if not f.check(pt is not None, 'the cut is on the preview'):
        return
    await page.mouse.click(pt['x'], pt['y'])
    await f.settle(3)
    s = await f.state()
    f.check(s['sel'] == {'level': 'line', 'ids': [target['line']]}, 'first click selects the line: %r' % s['sel'])
    f.check(s['panel'] == 'details', 'a preview click opens 詳細')
    pt = await page.evaluate(BOX, target['cut'])          # 詳細 opened: the preview is smaller now (§6.1.3)
    await page.mouse.click(pt['x'], pt['y'])
    await f.settle(3)
    f.check((await f.state())['sel'] == {'level': 'cut', 'key': target['cut']}, 'second click selects the cut')
    pt = await page.evaluate(BOX, target['cut'])
    await page.mouse.click(pt['x'], pt['y'])
    await f.settle(3)
    sel = (await f.state())['sel']
    f.check(sel == {'level': 'el', 'scope': 'cut/' + target['cut'], 'el': 'text'}, 'third click selects 文字: %r' % sel)
    crumbs = await page.inner_text('[data-mount="inspector"] .insp-crumbs')
    f.check(crumbs.strip().endswith('文字' if lang == 'ja' else 'Text'), 'crumbs end at 文字: %r' % crumbs)
    await f.shot('drill_text')
    # Drag the selected text: one gesture = one undo entry.
    done = await page.evaluate(DONE)
    await page.mouse.move(pt['x'], pt['y'])
    await page.mouse.down()
    for i in range(1, 7):
        await page.mouse.move(pt['x'] + i * 10, pt['y'])
    await page.mouse.up()
    await f.settle(2)
    path = 'cut/' + target['cut'] + ':el.text.nudge'
    pin = (await f.state())['pins'].get(path)
    f.check(pin is not None and pin['v']['dx'] > 0, 'dragging the text pins el.text.nudge: %r' % pin)
    f.check(await page.evaluate(DONE) == done + 1, 'the drag is one undo entry')
    # Double-click from 全体 goes straight to 文字.
    await page.evaluate("() => window.__mv.select({ level: 'work' }, { from: 'crumbs' })")
    await f.settle(2)
    await page.mouse.dblclick(pt['x'] + 60, pt['y'])
    await f.settle(3)
    sel = (await f.state())['sel']
    f.check(sel.get('level') == 'el' and sel.get('el') == 'text', 'double-click selects 文字 directly: %r' % sel)
    await f.undo_all(done0, doc0)


async def flow_pin(f, lang):
    page = f.page
    done0, doc0 = await with_lyrics(f)
    await page.locator('.canvas-wrap').focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    s = await f.state()
    line = s['sel'].get('ids', [None])[0]
    f.check(s['sel'].get('level') == 'line' and line, '↓ selects a line: %r' % s['sel'])
    await page.keyboard.press('i')
    await f.until("() => window.__mv.view.state.panel === 'details'", 'I opens 詳細')
    await f.settle(2)
    row = '[data-mount="inspector"] .frow[data-slot="arrive"]'
    await page.click(row + ' .w-part')
    await f.until("() => document.querySelectorAll('.pb-tile[data-key]').length > 3", 'the part browser opens')
    await f.shot('browser')
    key = await page.evaluate(OTHER_TILE)
    await page.click('.pb-tile[data-key="%s"]' % key)
    path = 'line/%s:arrive' % line
    await f.until('(p) => !!window.__mv.doc.pins[p]', 'picking a tile pins 入り on the line', path)
    s = await f.state()
    f.check(s['pins'].get(path, {}).get('v') == key, 'the pin holds the picked part (%s)' % key)
    tag = await page.get_attribute(row + ' .state-tag', 'data-state')
    f.check(tag == 'pinned', 'the field shows 固定 (%r)' % tag)
    await page.click('.omakase')
    await f.until('(s) => window.__mv.doc.look.seed !== s', 'おまかせ runs', s['seed'])
    s = await f.state()
    f.check(s['pins'].get(path, {}).get('v') == key, 'おまかせ keeps the pin')
    # A cut whose arrange moves the text itself (motion: 'own', e.g. tickerMarquee) has its entrance forced by rule
    # (DESIGN §4.18.2: instantShow), and a line pin skips it silently; every other cut of the line uses the pin.
    arrives = await page.evaluate("""(id) => window.__mv.plan.cuts.filter((c) => c.line === id).map((c) => [c.slots.arrive.v,
      c.slots.arrive.from, (window.__mv.reg.get('arrange', c.slots.arrange.v) || {}).motion === 'own'])""", line)
    f.check(arrives and all(a == key or (frm == 'rule' and own) for a, frm, own in arrives),
            'every cut of the line uses the pinned 入り after おまかせ (except a forced entrance): %r' % arrives)
    await page.locator(row + ' .w-part').focus()
    await page.keyboard.press('Delete')
    await f.until('(p) => !window.__mv.doc.pins[p]', 'Del unpins the focused field', path)
    await f.settle(2)
    tag = await page.get_attribute(row + ' .state-tag', 'data-state')
    f.check(tag in ('auto', 'mixed'), 'the field is automatic again (%r; mixed when the cuts pick differently)' % tag)
    await f.undo_all(done0, doc0)


async def flow_lock(f, lang):
    page = f.page
    done0, doc0 = await with_lyrics(f)
    await page.locator('.canvas-wrap').focus()
    await page.keyboard.press('ArrowDown')
    line = (await f.state())['sel']['ids'][0]
    await page.keyboard.press('l')
    await f.until('(id) => !!window.__mv.doc.locks[id]', 'L locks the line', line)
    before = await page.evaluate(LINE_SLOTS, line)
    others = await page.evaluate("(id) => window.__mv.plan.cuts.filter((c) => c.line && c.line !== id).map((c) => c.slots.arrive.v + c.slots.arrange.v).join()", line)
    changed = False
    for _ in range(3):
        seed = (await f.state())['seed']
        await page.click('.omakase')
        await f.until('(s) => window.__mv.doc.look.seed !== s', 'おまかせ runs', seed)
        f.check(await page.evaluate(LINE_SLOTS, line) == before, 'the locked line keeps its look through おまかせ')
        now = await page.evaluate("(id) => window.__mv.plan.cuts.filter((c) => c.line && c.line !== id).map((c) => c.slots.arrive.v + c.slots.arrange.v).join()", line)
        changed = changed or now != others
    f.check(changed, 'おまかせ changes the other lines')
    await page.locator('.canvas-wrap').focus()
    await page.keyboard.press('l')
    await f.until('(id) => !window.__mv.doc.locks[id]', 'L unlocks the line', line)
    await f.undo_all(done0, doc0)


async def flow_history(f, lang):
    page = f.page
    done0, doc0 = await with_lyrics(f)
    for _ in range(3):
        seed = (await f.state())['seed']
        await page.click('.omakase')
        await f.until('(s) => window.__mv.doc.look.seed !== s', 'おまかせ runs', seed)
    await f.settle(2)
    s = await f.state()
    f.check(s['hist'] == '4/4', 'n/m after three おまかせ is 4/4 (%r)' % s['hist'])
    await f.blur()
    expect = [('[', '3/4'), ('[', '2/4'), ('Control+z', '3/4'), ('Control+z', '4/4'), ('Control+Shift+z', '3/4'), (']', '4/4')]
    for key, want in expect:
        await page.keyboard.press(key)
        await f.settle(2)
        got = (await f.state())['hist']
        f.check(got == want, '%s → %s (got %r)' % (key, want, got))
    await f.undo_all(done0, doc0)
    s = await f.state()
    f.check(s['hist'] == '1/4', 'undo-all points at the first look again (%r)' % s['hist'])


async def flow_tools(f, lang):
    page = f.page
    done0, doc0 = await with_lyrics(f)
    await f.blur()
    seed = (await f.state())['seed']
    await page.keyboard.press('Control+k')
    await f.until('() => window.__mv.paletteOpen', 'Ctrl+K opens the palette')
    await page.keyboard.type('omakase')
    await page.keyboard.press('Enter')
    await f.until('(s) => window.__mv.doc.look.seed !== s', 'the palette runs おまかせ', seed)
    f.check(not (await f.state())['palette'], 'the palette closes after running')
    await page.keyboard.press('Control+k')
    await page.keyboard.type('@3')
    await page.keyboard.press('Enter')
    await f.until("() => { const s = window.__mv.view.state.sel; return s.level === 'line' && s.ids[0] === window.__mv.plan.lines[2].id; }",
                  '@3 selects line 3')
    await page.click('[data-act="menu.open"]')
    await f.until("() => !!document.querySelector('.popover.menu')", 'the ≡ menu opens')
    await f.shot('menu')
    await page.keyboard.press('Escape')
    await f.until("() => !document.querySelector('.popover.menu')", 'Esc closes the menu')
    await f.blur()
    await page.keyboard.press('?')
    await f.until("() => !!document.querySelector('dialog.dlg[open]')", '? opens the shortcut sheet')
    await page.keyboard.press('Escape')
    await f.until("() => !document.querySelector('dialog.dlg')", 'Esc closes the sheet')
    await f.blur()
    await page.keyboard.press('Shift+T')
    await f.until('() => window.__mv.view.state.drawer', 'Shift+T opens the timeline drawer')
    await f.settle(3)
    await f.shot('drawer')
    # Drag line 3's body in the drawer: its start and end are pinned, as one undo entry.
    pt = await page.evaluate("""() => {
      const a = window.__mv, tl = a.timeline, l = a.plan.lines[2];
      const r = document.querySelector('.tl-canvas').getBoundingClientRect();
      const rows = tl.rows();
      return { x: r.left + (tl.xOf(l.t0) + tl.xOf(l.t1)) / 2, y: r.top + (rows.line[0] + rows.line[1]) / 2, id: l.id };
    }""")
    done = await page.evaluate(DONE)
    await page.mouse.move(pt['x'], pt['y'])
    await page.mouse.down()
    for i in range(1, 6):
        await page.mouse.move(pt['x'] + i * 8, pt['y'])
    await page.mouse.up()
    await f.settle(2)
    pins = (await f.state())['pins']
    f.check(('line/%s:start' % pt['id']) in pins and ('line/%s:end' % pt['id']) in pins, 'dragging a line pins its start and end')
    f.check(await page.evaluate(DONE) == done + 1, 'the drag is one undo entry')
    await f.undo_all(done0, doc0)


async def open_line(f, line_id):
    await f.page.evaluate("(id) => window.__mv.select({ level: 'line', ids: [id] }, { from: 'crumbs', open: true })", line_id)
    await f.until("() => window.__mv.view.state.panel === 'details'", '詳細 opens')
    await f.settle(3)


async def flow_keys(f, lang):
    page = f.page
    done0, doc0 = await with_lyrics(f)
    stage = page.locator('.canvas-wrap')
    await stage.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    line = (await f.state())['sel']['ids'][0]
    await page.keyboard.press('i')
    await f.until("() => window.__mv.view.state.panel === 'details'", 'I opens 詳細')
    await f.settle(2)
    # The part browser keeps the arrows only while focus is inside it (§6.8); closing 詳細 closes it.
    await page.click(ROW % 'arrive' + ' .w-part')
    await f.until("() => document.querySelectorAll('.pb-tile[data-key]').length > 1", 'the part browser opens')
    await stage.focus()
    t0 = await page.evaluate(NOW)
    await page.keyboard.press('ArrowRight')
    await f.settle(1)
    f.check(await page.evaluate(NOW) > t0, '→ on the stage steps a frame while the part browser is open')
    f.check(await page.evaluate('() => window.__mv.inspector.stackSize()') == 1, 'the part browser stays open meanwhile')
    await page.locator('.pb-tile[data-key]').first.focus()
    await page.keyboard.press('i')
    await f.until("() => window.__mv.view.state.panel !== 'details'", 'I closes 詳細 from a tile')
    f.check(await page.evaluate('() => window.__mv.inspector.stackSize()') == 0, 'closing 詳細 closes the part browser')
    await stage.focus()
    t0 = await page.evaluate(NOW)
    await page.keyboard.press('ArrowRight')
    await f.settle(1)
    f.check(await page.evaluate(NOW) > t0, '→ steps a frame after 詳細 closed')
    await page.keyboard.press('ArrowDown')
    await f.settle(1)
    f.check((await f.state())['sel'].get('ids') != [line], '↓ selects the next line after 詳細 closed')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('i')
    await f.until("() => window.__mv.view.state.panel === 'details'", 'I opens 詳細 again')
    await f.settle(2)
    # A slider takes its own arrows: one pin, one undo entry, no seek, no line change (§6.12).
    done, t0 = await page.evaluate(DONE), await page.evaluate(NOW)
    await page.locator(ROW % 'arrive.dur' + ' .w-range').focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await f.settle(2)
    s = await f.state()
    f.check(('line/%s:arrive.dur' % line) in s['pins'], '→ on the 長さ slider pins it')
    f.check(await page.evaluate(DONE) == done + 1, 'two arrows on one slider are one undo entry')
    f.check(await page.evaluate(NOW) == t0 and s['sel'] == {'level': 'line', 'ids': [line]}, 'the slider arrows neither seek nor change the line')
    # A segmented choice is a radio group: Home / → choose within it.
    group = page.locator('[data-mount="inspector"] .isec[data-sec="direction"] .frow .w-seg').first
    slot = await group.evaluate("(el) => el.closest('.frow').dataset.slot")
    await group.locator('.seg[tabindex="0"]').focus()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowRight')
    await f.settle(2)
    s = await f.state()
    f.check(('line/%s:%s' % (line, slot)) in s['pins'], 'Home, → in the %s radio group pins its second option' % slot)
    f.check(await page.evaluate("() => document.activeElement.getAttribute('role') === 'radio'"), 'focus stays in the radio group')
    f.check(await page.evaluate(NOW) == t0 and s['sel'] == {'level': 'line', 'ids': [line]}, 'radio arrows neither seek nor change the line')
    # Del unpins the focused row only: once focus left the row (and the line), it does nothing.
    await page.locator(ROW % 'arrive.dur' + ' .w-range').focus()
    await stage.focus()
    await page.keyboard.press('ArrowDown')
    pins = await page.evaluate(PINS)
    await page.keyboard.press('Delete')
    await f.settle(1)
    f.check(await page.evaluate(PINS) == pins, 'Del after focus left the row keeps the pins of the line shown before')
    # Del never removes a lock pin (Unlock does, §3.6).
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('l')
    await f.until('(id) => !!window.__mv.doc.locks[id]', 'L locks the line', line)
    cut = await page.evaluate('(id) => window.__mv.plan.lines.find((l) => l.id === id).cuts[0]', line)
    await page.evaluate("(k) => window.__mv.select({ level: 'cut', key: k }, { from: 'crumbs', open: true })", cut)
    await f.settle(3)
    lock_path = 'cut/%s:arrive' % cut
    f.check((await f.state())['pins'].get(lock_path, {}).get('by') == 'lock', 'the lock froze 入り of the cut')
    await page.locator(ROW % 'arrive' + ' .w-part').focus()
    pins = await page.evaluate(PINS)
    await page.keyboard.press('Delete')
    await f.settle(1)
    f.check(await page.evaluate(PINS) == pins, 'Del on a locked value keeps the lock pin')
    rows = await page.evaluate('() => window.__mv.inspector.rows()')
    arrive = next((r for r in rows if r['path'] == lock_path), None)
    f.check(arrive is not None and arrive['state'] == 'locked' and not arrive['unpin'], 'a locked row shows ロック中 without ×: %r' % arrive)
    await stage.focus()
    await page.keyboard.press('l')
    await f.until('(id) => !window.__mv.doc.locks[id]', 'L unlocks the line', line)
    await f.undo_all(done0, doc0)


async def flow_values(f, lang):
    page = f.page
    done0, doc0 = await with_lyrics(f, LYRICS_MORE)
    # The line page's 切り替え pins the transition into the line's first cut, not every cut of the line (§6.4.6).
    info = await page.evaluate("""() => {
      const l = window.__mv.plan.lines.find((x, i) => i > 0 && x.cuts.length > 1);
      return l ? { id: l.id, cuts: l.cuts } : null; }""")
    if not f.check(info is not None, 'a line with two cuts'):
        return
    await open_line(f, info['id'])
    await page.click(ROW % 'seam' + ' .w-part')
    await f.until("() => document.querySelectorAll('.pb-tile[data-key]').length > 1", 'the 切り替え browser opens')
    key = await page.evaluate(OTHER_TILE)
    await page.click('.pb-tile[data-key="%s"]' % key)
    first = 'cut/%s:seam' % info['cuts'][0]
    await f.until('(p) => !!window.__mv.doc.pins[p]', '切り替え pins the first cut', first)
    s = await f.state()
    f.check(('line/%s:seam' % info['id']) not in s['pins'], 'no line-scope seam pin')
    inner = await page.evaluate("(k) => { const s = window.__mv.plan.seams.find((x) => x.into === k); return s ? s.slot.from : 'auto'; }", info['cuts'][1])
    f.check(not inner.startswith('pin'), 'the boundary inside the line stays automatic (%s)' % inner)
    await f.settle(2)
    rows = await page.evaluate('() => window.__mv.inspector.rows()')
    seam = next((r for r in rows if r['path'] == first), None)
    f.check(seam is not None and seam['state'] == 'pinned' and seam['unpin'], 'the 切り替え row reads the first cut: %r' % seam)
    # A pinned parameter of a part that is no longer chosen stays listed as 無効, with × (§3.4, §6.6).
    cut = info['cuts'][0]
    made = await page.evaluate("""(cut) => {
      const a = window.__mv, r = a.reg;
      const own = (k) => (r.params('arrive', k) || []).find((p) => !p.shared);
      const withOwn = r.keys('arrive').filter((k) => own(k));
      if (!withOwn.length) return null;
      const A = withOwn[0], B = r.keys('arrive').find((k) => k !== A);
      const p = own(A), spec = p.spec;
      const v = spec.type === 'num' || spec.type === 'int' ? spec.min : spec.type === 'bool' ? true : spec.type === 'enum' ? spec.of[0] : 'x';
      const sig = a.svc.pinSig(a.plan, cut);
      a.batch({ label: ['undo.pin', { field: 'x', scope: 'y' }] }, [
        { t: 'pin.set', path: 'cut/' + cut + ':arrive', v: A, by: 'user', sig },
        { t: 'pin.set', path: 'cut/' + cut + ':arrive@' + A + '.' + p.name, v, by: 'user', sig },
        { t: 'pin.set', path: 'cut/' + cut + ':arrive', v: B, by: 'user', sig }]);
      return { path: 'cut/' + cut + ':arrive@' + A + '.' + p.name, slot: 'arrive@' + A + '.' + p.name };
    }""", cut)
    if f.check(made is not None, 'an entrance with its own parameter'):
        await page.evaluate("(k) => window.__mv.select({ level: 'cut', key: k }, { from: 'crumbs', open: true })", cut)
        await f.settle(3)
        rows = await page.evaluate('() => window.__mv.inspector.rows()')
        row = next((r for r in rows if r['path'] == made['path']), None)
        f.check(row is not None and row['state'] == 'inactive' and row['unpin'] and row['why'], 'the parameter shows as 無効 with × and its reason: %r' % row)
        await page.click(ROW % made['slot'] + ' .state-tag')
        await f.until('(p) => !window.__mv.doc.pins[p]', 'the tag of an inactive pin unpins it', made['path'])
    # Clicking an auto cut ┊ pins the split as it stands (§6.4.4).
    auto = await page.evaluate("""() => {
      const a = window.__mv;
      const l = a.plan.lines.find((x) => x.cuts.length > 1 && !a.doc.pins['line/' + x.id + ':split']
        && !((a.doc.sheet.rows.find((r) => r.id === x.row) || { src: '/' }).src.includes('/')));
      return l ? { id: l.id, offs: l.cuts.map((k) => Number(k.split('~')[1])) } : null; }""")
    if f.check(auto is not None, 'the long unmarked line is cut automatically'):
        await open_line(f, auto['id'])
        await page.locator(ROW % 'split' + ' .w-gap.is-auto').first.click()
        path = 'line/%s:split' % auto['id']
        await f.until('(p) => !!window.__mv.doc.pins[p]', 'clicking ┊ pins the split', path)
        got = (await f.state())['pins'].get(path, {}).get('v')
        f.check(got == auto['offs'], 'the pinned split is the current one (%r, want %r)' % (got, auto['offs']))
    # A locked line whose frozen split was lost shows 「ロック中の区切りが合いません」 + [ロックし直す] (§6.11).
    await open_line(f, info['id'])
    await page.evaluate("() => window.__mv.actions.run('lock.toggle')")
    split = 'line/%s:split' % info['id']
    await f.until('(p) => !!window.__mv.doc.pins[p]', 'the lock freezes the split', split)
    await page.evaluate("(p) => window.__mv.dispatch({ t: 'pin.clear', path: p }, { label: ['undo.unpin', {}] })", split)
    relock = '[data-mount="inspector"] [data-custom="lockPartial"] button'
    if await f.until('(s) => !!document.querySelector(s)', 'the lock-partial tag and [ロックし直す] appear', relock):
        await page.click(relock)
        await f.until("(p) => { const x = window.__mv.doc.pins[p]; return !!x && x.by === 'lock'; }", '[ロックし直す] freezes the split again', split)
        await f.until("(id) => !window.__mv.plan.warnings.some((w) => w.code === 'lock-partial' && w.line === id)", 'the warning goes', info['id'])
    # 作品全体 › 行: an LRC stamp is a mark (LRC badge), not a pin.
    await page.evaluate("() => window.__mv.select({ level: 'work' }, { from: 'header', open: true })")
    await f.settle(2)
    await open_section(f, 'lines')
    await f.until("() => document.querySelectorAll('.vl-row').length > 3", 'the 行 list fills')
    lrc = await page.evaluate("""() => {
      const i = window.__mv.plan.lines.findIndex((l) => l.by.start === 'lrc');
      const row = [...document.querySelectorAll('.vl-row')].find((r) => r.querySelector('.insp-num').textContent === String(i + 1));
      if (!row) return null;
      const time = row.querySelector('.vl-time');
      return { pinned: time.classList.contains('is-pinned'), mark: time.classList.contains('is-mark'), text: time.textContent,
               badge: !!row.querySelector('.g-badge') }; }""")
    f.check(lrc is not None and not lrc['pinned'] and lrc['mark'] and lrc['badge'] and "'" not in lrc['text'], 'the LRC line reads as a mark: %r' % lrc)
    # 色 › [テーマの色に戻す] clears the work colour pins (one entry).
    await page.evaluate("() => window.__mv.dispatch({ t: 'pin.set', path: 'work:color.accent', v: '#123456', by: 'user' }, { label: ['undo.unpin', {}] })")
    await open_section(f, 'colors')
    done = await page.evaluate(DONE)
    await page.click('[data-mount="inspector"] [data-custom="colorsReset"] button')
    await f.until("() => !window.__mv.doc.pins['work:color.accent']", '[テーマの色に戻す] clears the colour pins')
    f.check(await page.evaluate(DONE) == done + 1, 'one undo entry')
    # 試した見た目: Enter on a tile restores that look and the focus stays on it (§6.12).
    for _ in range(2):
        seed = (await f.state())['seed']
        await page.click('.omakase')
        await f.until('(s) => window.__mv.doc.look.seed !== s', 'おまかせ runs', seed)
    await open_section(f, 'looks')
    tile = page.locator('[data-mount="inspector"] .look-tile').nth(1)
    n = await tile.get_attribute('data-n')
    seed = (await f.state())['seed']
    await tile.locator('.look-pick').focus()
    await page.keyboard.press('Enter')
    await f.until('(s) => window.__mv.doc.look.seed !== s', 'Enter on a tried look restores it', seed)
    await f.settle(3)
    kept = await page.evaluate("() => { const e = document.activeElement; const t = e && e.closest('[data-n]'); return t ? t.dataset.n + ':' + e.className : e ? e.tagName : null; }")
    f.check(kept is not None and kept.startswith(n + ':look-pick'), 'focus stays on the chosen look (%r, want %s)' % (kept, n))
    await f.undo_all(done0, doc0)


async def open_section(f, sec):
    head = f.page.locator('[data-mount="inspector"] .isec[data-sec="%s"] .isec-head' % sec)
    if await head.get_attribute('aria-expanded') != 'true':
        await head.click()
    await f.settle(2)


# --- AI flows (WP8c): a faked Gemini through page.route, never the network --------------------------------------------

AI_KEY = 'AIza' + 'Q' * 35
# window.__wav(seconds, name) → a mono 16-bit WAV File (a quiet tone), enough to decode as the song.
AI_WAV_JS = r"""
() => {
  window.__wav = (seconds, name) => {
    const rate = 22050, n = Math.round(seconds * rate), buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const put = (o, x) => { for (let i = 0; i < x.length; i++) v.setUint8(o + i, x.charCodeAt(i)); };
    put(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); put(8, 'WAVE'); put(12, 'fmt '); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); put(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(i / 8) * 6000), true);
    return new File([buf], name, { type: 'audio/wav' });
  };
}
"""
TRY_ON = '(i) => { const x = window.__mv.ai.state.tryOn; return !!x && x.index === i; }'
AI_HOSTS = ('https://generativelanguage.googleapis.com/**', 'https://api.anthropic.com/**')
AI_STATE = "() => { const s = window.__mv.ai.state; return { key: s.keyStatus, run: s.run ? s.run.tool + ':' + s.run.stage : null, review: s.review ? s.review.kind : null, tryOn: s.tryOn ? s.tryOn.index : null, error: s.error ? s.error.code : null, notice: s.notice ? s.notice.kind : null, aiReview: window.__mv.view.state.aiReview }; }"
# What auto picks may use in this page's registry (the real catalog, or boot's stand-in while it is incomplete).
AI_KEYS = """() => {
  const a = window.__mv, reg = a.reg;
  const lyric = (kind) => reg.keys(kind).filter((k) => { const tr = reg.traits(kind, k), d = reg.get(kind, k);
    return tr && tr.roles.includes('lyric') && !d.season && d.pool !== false; });
  return { themes: reg.keys('theme').filter((k) => !reg.get('theme', k).season), moods: reg.keys('mood'),
    arrange: lyric('arrange'), arrive: lyric('arrive'), theme: a.plan.look.theme.v, mood: a.plan.look.mood.v,
    lines: a.plan.lines.map((l) => ({ id: l.id, text: l.text, arrange: (a.plan.cuts.find((c) => c.key === l.cuts[0]).slots.arrange || {}).v })) };
}"""


def gemini_answer(obj):
    return {'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': json.dumps(obj, ensure_ascii=False)}]}}],
            'usageMetadata': {'promptTokenCount': 3210, 'candidatesTokenCount': 850}}


async def ai_route(f, answers, delay=0):
    """Answers every request to the AI services from `answers` (in order) and records them in f.ai_seen. The answer
    delay (seconds) can be changed later through f.ai_delay[0]."""
    f.ai_seen = []
    f.ai_delay = [delay]

    async def gemini(route):
        req = route.request
        cors = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}
        if req.method == 'OPTIONS':
            await route.fulfill(status=204, headers=cors)
            return
        f.ai_seen.append({'url': req.url, 'method': req.method, 'headers': req.headers,
                          'body': json.loads(req.post_data) if req.post_data else None})
        if req.method == 'GET':
            body = {'name': 'models/gemini-3.8-flash', 'displayName': 'Gemini 3.8 Flash', 'supportedGenerationMethods': ['generateContent']}
        else:
            if f.ai_delay[0]:
                await asyncio.sleep(f.ai_delay[0])
            body = gemini_answer(answers.pop(0)) if answers else {'candidates': []}
        await route.fulfill(status=200, content_type='application/json', headers=cors, body=json.dumps(body, ensure_ascii=False))

    await f.page.route(AI_HOSTS[0], gemini)
    await f.page.route(AI_HOSTS[1], lambda route: route.abort())


async def ai_open(f):
    """Opens the AI tab from the header, enters the key and checks it (the free model-info request)."""
    page = f.page
    await page.click('.region-header [data-act="panel.ai"]')
    await f.until("() => window.__mv.view.state.panel === 'ai' && !!document.querySelector('#ai-key-input')", 'the AI tab opens')
    f.check(await page.is_disabled('[data-tool="prep"]'), 'tools are disabled until there is a key')
    await page.fill('#ai-key-input', AI_KEY)
    await page.click('.ai-conn [data-ctl="check"]')
    await f.until("() => window.__mv.ai.state.keyStatus === 'ok'", 'the key check succeeds')
    await f.settle(2)
    f.check(await page.is_hidden('.ai-conn-body'), 'the connection card collapses to one line once the key works')
    get = [s for s in f.ai_seen if s['method'] == 'GET']
    f.check(len(get) == 1, 'one model-info request for the check')


def ai_requests_ok(f, audio=False):
    """The key only in the x-goog-api-key header; audio parts only for the song tools."""
    for s in f.ai_seen:
        f.check(AI_KEY not in s['url'], 'the key is never in a URL')
        f.check(s['headers'].get('x-goog-api-key') == AI_KEY, 'the key goes in the x-goog-api-key header')
        if s['method'] == 'POST':
            parts = s['body']['contents'][0]['parts']
            has_audio = any('inlineData' in p or 'fileData' in p for p in parts)
            f.check(has_audio == audio, 'audio part %s' % ('sent (song tool, after consent)' if audio else 'not sent (text tool)'))


async def ai_review_checks(f):
    """While a review is open: 詳細 is disabled (header, tab) and the panel does not cover the preview."""
    page = f.page
    s = await page.evaluate(AI_STATE)
    f.check(s['aiReview'], 'view.aiReview is on while a review is open')
    f.check(await page.is_disabled('.region-header [data-act="panel.details"]'), 'the header 詳細 is disabled during a review')
    f.check(await page.is_disabled('.panel-tabs [data-act="panel.details"]'), 'the 詳細 tab is disabled during a review')
    covered = await page.evaluate("""() => { const a = document.querySelector('.canvas-wrap').getBoundingClientRect();
      const b = document.querySelector('.region-panel').getBoundingClientRect();
      return a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top; }""")
    f.check(not covered, 'the AI panel never covers the preview')


REVIEW_SHOWN = """() => {
  const a = window.__mv, root = a.shell.panel.root;
  const shown = (el) => !!el && !el.hidden && !el.closest('[hidden]') && el.isConnected && el.getClientRects().length > 0;
  return { panel: a.view.state.panel, aiReview: a.view.state.aiReview,
    inspector: shown(root.querySelector('[data-mount="inspector"]')), ai: shown(root.querySelector('[data-mount="ai"]')),
    review: shown(root.querySelector('.ai-review')) };
}"""


async def details_during_run(f, click, what):
    """Opens 詳細 (`click`: its tab) while the request runs; once the answer is there the review must be what shows."""
    await f.until("() => !!window.__mv.ai.state.run", 'the request is running (%s)' % what)
    await f.page.click(click)
    await f.until("() => window.__mv.view.state.panel === 'details'", '詳細 opens while the request runs (%s)' % what)
    if not await f.until("() => window.__mv.view.state.aiReview", 'the review opens (%s)' % what, timeout=5000):
        return
    await f.settle(3)
    s = await f.page.evaluate(REVIEW_SHOWN)
    f.check(s['panel'] == 'ai' and s['ai'] and s['review'] and not s['inspector'],
            'an opening review brings the AI tab up and hides the inspector (%s): %r' % (what, s))


# The AI's thinking animation (ui/ai_thinking): the HUD over the preview, the orb of the running line, the glow class.
HUD = """() => { const d = document.querySelector('.canvas-wrap .ai-hud'), a = window.__mv, r = a.ai.state.run;
  return { shown: !!d && !d.hidden && d.getBoundingClientRect().width > 0, text: d ? d.querySelector('.ai-hud-text').textContent : null,
    want: r ? a.t('ai.runningStage', { tool: a.t('ai.name.' + r.tool), stage: a.t('ai.stage.' + r.stage) }) : null,
    steps: d ? !d.querySelector('.ai-hud-steps').hidden : null, dots: d ? [...d.querySelectorAll('.ai-hud-steps i')].map((i) => i.className) : [],
    glow: document.body.classList.contains('is-ai-thinking'), orb: !!document.querySelector('.ai-run .ai-orb'),
    pointer: d ? getComputedStyle(d).pointerEvents : null, running: !!r }; }"""


async def flow_ai_prep(f, lang):
    """歌詞の下ごしらえ: stale rows, unchecking, apply as one undo step, selective revert from the log."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    answers = [{'summary': '区切りと強調を提案します', 'lines': [
        {'i': 0, 'remove': False, 'reason': '文節で区切る', 'segments': ['窓を', 'あけて', '光を入れる'], 'emphasis': ['光'], 'reading': ''},
        {'i': 2, 'remove': False, 'reason': '', 'segments': [], 'emphasis': ['駅'], 'reading': ''},
        {'i': 4, 'remove': True, 'reason': 'テスト', 'segments': [], 'emphasis': [], 'reading': ''}]}]
    await ai_route(f, answers, delay=0.8)
    await ai_open(f)
    await page.click('[data-tool="prep"]')
    hud = await page.evaluate(HUD)
    f.check(hud['running'] and hud['shown'] and hud['text'] == hud['want'] and not hud['steps'] and hud['glow'] and hud['orb']
            and hud['pointer'] == 'none', 'a text tool: the thinking HUD over the preview, no audio steps: %r' % hud)
    await details_during_run(f, '.panel-tabs [data-act="panel.details"]', 'desktop tab')
    if not await f.until("() => document.querySelectorAll('.ai-review .ai-row').length === 4", 'the review lists 4 changes'):
        return
    f.check(await page.evaluate(DOC) == doc0, 'nothing is applied before the review')
    await ai_review_checks(f)
    ai_requests_ok(f)
    prompt = [s for s in f.ai_seen if s['method'] == 'POST'][0]['body']['contents'][0]['parts'][0]['text']
    f.check('窓をあけて光を入れる' in prompt, 'the lyric text is sent')
    await f.shot('ai_prep_review')
    rows = await page.evaluate("() => window.__mv.doc.sheet.rows.map((r) => r.id + '|' + r.src)")
    rid = {src: rid for rid, src in (r.split('|', 1) for r in rows)}
    row2 = rid['坂道を下って/駅まで歩く']
    # A row whose target changes after the request becomes stale and unchecked (badged 「この後に変更あり」).
    await page.evaluate("(id) => window.__mv.dispatch({ t: 'lyrics.row', rowId: id, src: '坂道を下って/駅まで歩く!' }, { label: ['undo.edit', {}] })", row2)
    await f.until("() => document.querySelectorAll('.ai-review .ai-row.is-stale').length === 1", 'the changed row is badged stale')
    stale = await page.evaluate("() => { const r = document.querySelector('.ai-row.is-stale'); return { checked: r.querySelector('input').checked, text: r.textContent }; }")
    f.check(not stale['checked'] and ('この後に変更あり' in stale['text'] or lang != 'ja'), 'the stale row is unchecked and badged: %r' % stale)
    await f.blur()
    await page.keyboard.press('Control+z')
    await f.until("() => !document.querySelector('.ai-row.is-stale')", 'undoing the edit clears the badge')
    # Hovering a row highlights its line: in the view state (lane, timeline) and on the preview's overlay.
    await page.evaluate("""(id) => { const a = window.__mv, line = a.plan.lines.find((l) => l.id === id);
      a.seek(a.plan.cuts.find((c) => c.key === line.cuts[0]).repT); }""", row2)
    await f.settle(3)
    before = await page.evaluate(HIGHLIGHT_INK)
    await page.hover('.ai-row[data-line="%s"]' % row2)
    await f.until('(id) => window.__mv.view.state.highlight === id', 'hovering a review row highlights its line', row2)
    await f.settle(3)
    during = await page.evaluate(HIGHLIGHT_INK)
    await page.mouse.move(2, 2)
    await f.until('() => window.__mv.view.state.highlight === null', 'leaving the review clears the highlight')
    await f.settle(3)
    after = await page.evaluate(HIGHLIGHT_INK)
    f.check(before == 0 and during > 50 and after == 0, 'the preview outlines the hovered row\'s line: %r' % [before, during, after])
    # Re-check the emphasis of row 2, uncheck the removal, apply. The rows are updated in place (no rebuild per click).
    await page.evaluate("() => document.querySelectorAll('.ai-review .ai-row').forEach((r) => { r.__kept = true; })")
    await page.click('.ai-row[data-line="%s"] input' % row2)
    await page.click('.ai-row[data-kind="remove"] input')
    await f.settle(2)
    label = await page.inner_text('.ai-review-foot .btn.primary')
    f.check('3' in label, 'the apply button counts the checked rows: %r' % label)
    same = await page.evaluate("() => [...document.querySelectorAll('.ai-review .ai-row')].every((r) => r.__kept)")
    f.check(same, 'checking rows updates them in place instead of rebuilding the list')
    focus = await page.evaluate("() => { const e = document.activeElement; return e && e.closest('.ai-row') ? e.closest('.ai-row').dataset.kind : null; }")
    f.check(focus == 'remove', 'the clicked checkbox keeps the focus: %r' % focus)
    done = await page.evaluate(DONE)
    await page.click('.ai-review-foot .btn.primary')
    await f.until('() => !window.__mv.view.state.aiReview', 'applying closes the review')
    f.check(await page.evaluate(DONE) == done + 1, 'apply = one undo entry')
    undo = await page.evaluate("() => window.__mv.store.peek().undo")
    f.check(undo[0] == 'undo.ai', 'the undo entry is the AI run: %r' % undo)
    srcs = await page.evaluate("() => window.__mv.doc.sheet.rows.map((r) => r.src)")
    f.check('窓を/あけて/*光*を入れる' in srcs and '坂道を下って/*駅*まで歩く' in srcs and '小さな/一歩で' in srcs,
            'the checked changes are applied, the unchecked removal is not: %r' % srcs)
    # Selective revert: row 0 is edited by hand afterwards, so only row 2 goes back.
    row0 = rid['窓をあけて/光を入れる']
    await page.evaluate("(id) => window.__mv.dispatch({ t: 'lyrics.row', rowId: id, src: '窓を/あけて/*光*を入れる!' }, { label: ['undo.edit', {}] })", row0)
    await f.until("() => !!document.querySelector('.ai-log-row button:not([disabled])')", 'the log offers [元に戻す]')
    entry = await page.inner_text('.ai-log-row')
    f.check(lang != 'ja' or '3件' in entry, 'the log counts the 3 accepted changes: %r' % entry)
    await page.click('.ai-log-row button')
    await f.until("() => window.__mv.doc.sheet.rows.some((r) => r.src === '坂道を下って/駅まで歩く')", 'the revert restores row 2')
    srcs = await page.evaluate("() => window.__mv.doc.sheet.rows.map((r) => r.src)")
    f.check('窓を/あけて/*光*を入れる!' in srcs, 'the row edited later keeps its edit')
    toast = await page.evaluate("() => [...document.querySelectorAll('.toast-text')].map((e) => e.textContent).join(' / ')")
    # Row 0's two changes (cut, emphasis) were edited later; row 2's emphasis goes back: 1 + 2 = the 3 in the log.
    f.check(lang != 'ja' or ('AIの変更を戻しました（1件）' in toast and '2件は後で変更されたので戻せません' in toast),
            'the revert reports reverted and kept changes in the log\'s unit: %r' % toast)
    await f.shot('ai_prep_log')
    await f.undo_all(done0, doc0)


def look_proposal(k, theme, mood, arrange, arrive):
    return {'title': '朝の' + k, 'concept': '光の案' + k, 'theme': theme, 'mood': mood,
            'amounts': {'motion': -1, 'glitch': -1, 'chroma': -1, 'ornament': -1, 'density': -1, 'texture': -1, 'groundSwitch': -1},
            'flash': False, 'palette': {'accent': '#C2413A', 'shiftA': '#3E6E8C', 'shiftB': '#C9A15B'}, 'avoid': [],
            'lines': [{'i': 0, 'arrange': arrange, 'arrive': arrive, 'depart': '', 'dwell': ''}]}


async def flow_ai_looks(f, lang):
    """演出3案: three cards, try-on of B, switching to C, hold B to compare, [やめる], この案にする from the strip, revert."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    keys = await page.evaluate(AI_KEYS)
    themes = [k for k in keys['themes'] if k != keys['theme']] or keys['themes']
    moods = keys['moods']
    if not f.check(len(themes) >= 1 and keys['arrange'] and keys['arrive'], 'the registry has themes and lyric parts'):
        return
    pick = [themes[i % len(themes)] for i in range(3)]
    answers = [{'topic': '朝の始まり', 'season': 'any', 'proposals': [
        look_proposal(k, pick[i], moods[i % len(moods)], keys['arrange'][i % len(keys['arrange'])], keys['arrive'][0])
        for i, k in enumerate('ABC')]}]
    await ai_route(f, answers)
    await ai_open(f)
    await page.click('[data-tool="looks"]')
    if not await f.until("() => document.querySelectorAll('.ai-look').length === 3", 'three proposal cards'):
        return
    await ai_review_checks(f)
    ai_requests_ok(f)
    await f.shot('ai_looks')
    engine_theme = "() => window.__mv.engine.plan.look.theme.v"
    await page.locator('.ai-look').nth(1).locator('button[aria-pressed]').click()
    await f.until('(t) => window.__mv.engine.plan.look.theme.v === t', 'try-on B renders B on the stage', pick[1])
    badge = await page.inner_text('.stage-badge')
    strip = await page.inner_text('.mode-strip')
    f.check(lang != 'ja' or ('案B' in badge and '案Bを試写中' in strip and 'この案にする' in strip and 'やめる' in strip),
            'badge and mode strip name look B: %r / %r' % (badge, strip))
    f.check(await page.evaluate(DOC) == doc0, 'try-on commits nothing')
    await f.shot('ai_looks_tryon')
    # Switch to C.
    await page.locator('.ai-look').nth(2).locator('button[aria-pressed]').click()
    await f.until(TRY_ON, 'switching the try-on to C', 2)
    await f.until('(t) => window.__mv.engine.plan.look.theme.v === t', 'C renders on the stage', pick[2])
    # Hold B: the current look; release: back to C.
    await page.keyboard.down('b')
    await f.until('(t) => window.__mv.engine.plan.look.theme.v === t', 'holding B shows the current look', keys['theme'])
    await page.keyboard.up('b')
    await f.until('(t) => window.__mv.engine.plan.look.theme.v === t', 'releasing B returns to the try-on', pick[2])
    f.check(await page.evaluate(TRY_ON, 2), 'the try-on is still C after comparing')
    # [やめる] in the mode strip.
    await page.click('.mode-strip button:nth-child(2)')
    await f.until("() => window.__mv.ai.state.tryOn === null && document.querySelector('.stage-badge').hidden", '[やめる] ends the try-on')
    # Try A on; with nothing of A checked the strip offers only [やめる] and the card can still stop the try-on.
    await page.locator('.ai-look').nth(0).locator('button[aria-pressed]').click()
    await f.until(TRY_ON, 'try-on A', 0)
    await page.locator('.ai-look').nth(0).locator('summary').click()
    await f.until("() => document.querySelectorAll('.ai-look')[0].querySelectorAll('.ai-row').length > 0", 'card A lists its changes')
    await page.locator('.ai-look').nth(0).locator('.ai-list-tools button').nth(1).click()
    await f.until("() => document.querySelectorAll('.mode-strip button').length === 1", 'nothing checked: only [やめる] in the strip')
    stop = page.locator('.ai-look').nth(0).locator('button[aria-pressed="true"]')
    f.check(await stop.count() == 1 and await stop.is_enabled(), 'the card\'s [試写をやめる] stays enabled with nothing checked')
    await page.locator('.ai-look').nth(0).locator('.ai-list-tools button').nth(0).click()
    await f.until("() => document.querySelectorAll('.mode-strip button').length === 2", 'checked again: [この案にする] is back')
    f.check(await page.evaluate(TRY_ON, 0), 'the try-on stays on A')
    # この案にする from the strip: one undo entry, A's theme pinned by ai.
    done = await page.evaluate(DONE)
    await page.click('.mode-strip button:nth-child(1)')
    await f.until('(t) => { const p = window.__mv.doc.pins["work:theme"]; return !!p && p.v === t && p.by === "ai"; }', 'この案にする pins A', pick[0])
    f.check(await page.evaluate(DONE) == done + 1, 'この案にする = one undo entry')
    s = await page.evaluate(AI_STATE)
    f.check(not s['aiReview'] and s['review'] is None and s['tryOn'] is None, 'the review and the try-on are closed: %r' % s)
    f.check(not await page.is_disabled('.region-header [data-act="panel.details"]'), '詳細 works again')
    # The log reverts the whole run (nothing was changed since).
    await page.click('.ai-log-row button')
    await f.until('() => !window.__mv.doc.pins["work:theme"]', 'the log reverts the run')
    f.check(await page.evaluate(DONE) == done + 2, 'the revert is one undo entry')
    await f.undo_all(done0, doc0)


# Answers of ai/direct (package E) in its frozen schema: every property present, -1 / '' / 'keep' = no change.
def d_curve(name='', **x):
    return dict({'name': name, 'ends': 'both', 'edge': -1, 'peak': -1}, **x)


def d_cam(**x):
    return dict({'shot': '', 'move': 'pushIn', 'focus': 'text', 'timing': 'whole', 'fill': -1, 'closer': -1, 'follow': -1,
                 'curve': d_curve()}, **x)


def d_edit(**x):
    return dict({'arrange': '', 'arrive': '', 'dwell': '', 'depart': '', 'lens': '', 'ground': '', 'atmos': '', 'ornaments': [],
                 'filters': [], 'avoid': [], 'season': '', 'speed': -1, 'arriveCurve': d_curve(), 'departCurve': d_curve(),
                 'flow': d_curve(), 'lensCurve': d_curve(), 'camera': d_cam(), 'impact': 'keep', 'emphasis': []}, **x)


def d_answer(s, understood=True, question='', summary='', all_=None, lines=None, cuts=None, work=None):
    amounts = {k: -1 for k in ('motion', 'glitch', 'chroma', 'ornament', 'density', 'texture', 'groundSwitch', 'camera')}
    w = {'theme': '', 'mood': '', 'season': '', 'amounts': amounts, 'flash': 'keep', 'palette': {'accent': '', 'shiftA': '', 'shiftB': ''}}
    if work:
        w['amounts'] = dict(amounts, **work)
    return {'s': s, 'understood': understood, 'summary': summary or ('' if not understood else 'サビを強くします'), 'question': question,
            'all': dict({'rig': '', 'rigCurve': d_curve()}, **d_edit(**(all_ or {}))), 'lines': lines or [], 'cuts': cuts or [], 'work': w}


async def flow_ai_edit(f, lang):
    """指示 (DESIGN_2_1 §6.2; was ひとこと修正): 対象 選択中 sends the selected line as an area; the AI asks back (the question
    shows under the box, per area); then (compact layout, 詳細 opened during the run) the answer is a review with the area
    group and 区画の外 (unchecked by default); checking it and applying is one undo step."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    keys = await page.evaluate(AI_KEYS)
    idx = 3
    line = keys['lines'][idx]
    other = [k for k in keys['arrange'] if k != line['arrange']]
    if not f.check(bool(other), 'another composition to choose'):
        return
    answers = [{'answers': [d_answer(0, False, 'どの行を派手にしますか？')]},
               {'answers': [d_answer(0, lines=[dict({'i': 0}, **d_edit(arrange=other[0]))], work={'motion': 0.95})]}]
    await ai_route(f, answers)
    await page.evaluate("(id) => window.__mv.select({ level: 'line', ids: [id] }, { from: 'key', seek: false })", line['id'])
    await ai_open(f)
    await page.fill('#ai-direct-text', 'サビをもっと派手に')
    await page.click('.ai-direct [data-target="sel"]')
    f.check(await page.get_attribute('.ai-direct [data-target="sel"]', 'aria-checked') == 'true', '対象: 選択中')
    chip = await page.evaluate("() => { const c = document.querySelector('.ai-target-chip'); return c && !c.hidden ? c.textContent : null; }")
    f.check(bool(chip), 'the target chip names the selected line: %r' % chip)
    await page.focus('#ai-direct-text')
    await page.keyboard.press('Enter')
    await f.until("() => window.__mv.ai.state.notice && window.__mv.ai.state.notice.kind === 'question'", 'the AI asks back')
    await f.until("() => document.querySelector('.ai-direct .ai-questions').textContent.length > 0", 'the question shows')
    note = await page.inner_text('.ai-direct .ai-questions')
    f.check('どの行を派手にしますか？' in note, 'the question is shown under the box: %r' % note)
    f.check(not (await page.evaluate(AI_STATE))['aiReview'], 'a question opens no review')
    prompt = [s for s in f.ai_seen if s['method'] == 'POST'][0]['body']['contents'][0]['parts'][0]['text']
    plain = prompt.replace('/', '')
    f.check('サビをもっと派手に' in prompt and line['text'].replace('/', '') in plain, 'the instruction and the selected line are sent')
    far = [x['text'] for i, x in enumerate(keys['lines']) if abs(i - idx) > 1]
    f.check(not any(t.replace('/', '') in plain for t in far), 'no other lyric line is sent (only one context line each side)')
    # Compact layout: the side column's 詳細 is opened while the second request runs; the review must take over.
    await page.set_viewport_size({'width': 1100, 'height': 900})
    await f.until("() => window.__mv.layout && window.__mv.layout.layout === 'compact'", 'the compact layout')
    f.ai_delay[0] = 0.8
    await page.focus('#ai-direct-text')
    await page.keyboard.press('Enter')
    await details_during_run(f, '.side-tabs [data-side="details"]', 'compact side tab')
    f.check(await page.is_disabled('.side-tabs [data-side="details"]'), 'the compact 詳細 side tab is disabled during the review')
    await page.set_viewport_size({'width': 1440, 'height': 900})
    if not await f.until("() => document.querySelectorAll('.ai-review .ai-row').length === 2", 'the second answer is a review of 2 rows'):
        return
    heads = await page.evaluate("() => [...document.querySelectorAll('.ai-review .ai-group-head')].map((e) => e.textContent)")
    f.check(lang != 'ja' or (len(heads) == 2 and heads[0].startswith('区画') and heads[1].startswith('区画の外（作品全体）')),
            'rows grouped 区画 / 区画の外: %r' % heads)
    checks = await page.evaluate("() => [...document.querySelectorAll('.ai-review .ai-row input')].map((b) => b.checked)")
    f.check(checks == [True, False], 'the row outside the area starts unchecked: %r' % checks)
    ai_requests_ok(f)
    await f.shot('ai_edit_review')
    await page.click('.ai-review .ai-row >> nth=1')
    done = await page.evaluate(DONE)
    await page.click('.ai-review-foot .btn.primary')
    await f.until('(p) => { const x = window.__mv.doc.pins[p]; return !!x && x.by === "ai"; }', 'the line pin is set by ai',
                  'line/%s:arrange' % line['id'])
    f.check(await page.evaluate(DONE) == done + 1, 'one undo entry')
    pins = await page.evaluate("() => window.__mv.doc.pins")
    f.check(pins.get('work:amount.motion', {}).get('v') == 0.95, 'the checked outside row is applied: %r' % pins.get('work:amount.motion'))
    label = await page.evaluate("() => window.__mv.store.peek().undo")
    f.check(label[0] == 'undo.aiArea', 'the undo entry names the area: %r' % label)
    await f.undo_all(done0, doc0)


async def flow_ai_align(f, lang):
    """曲を使う › タイミングを合わせる: consent card, running stage, audio part first, start pins by ai."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    await page.evaluate(AI_WAV_JS)
    ok = await page.evaluate("async () => { await window.__mv.loadSong(window.__wav(12, 'ai.wav')); return window.__mv.songReady(); }")
    if not f.check(ok, 'the song is loaded'):
        return
    n = await page.evaluate("() => window.__mv.plan.lines.length")
    answers = [{'note': '', 'lines': [{'i': i, 'start': '0:%05.2f' % (0.8 + i * 1.7)} for i in range(n)]}]
    await ai_route(f, answers, delay=0.5)
    await ai_open(f)
    consent = await page.inner_text('.ai-consent')
    f.check(lang != 'ja' or ('16kHz' in consent and 'Google Gemini' in consent and '0:12' in consent), 'the consent card says what is sent: %r' % consent)
    f.check(await page.is_disabled('[data-tool="align"]'), 'song tools wait for the consent')
    await page.click('.ai-consent input[type="checkbox"]')
    await f.until("() => !document.querySelector('[data-tool=\"align\"]').disabled", 'consent enables the song tools')
    await page.click('[data-tool="align"]')
    await f.until("() => { const r = window.__mv.ai.state.run; return !!r && r.stage === 'think'; }", 'the running stage reaches 考え中')
    hud = await page.evaluate(HUD)
    f.check(hud['shown'] and hud['text'] == hud['want'] and hud['steps'] and hud['dots'] == ['is-done', 'is-done', 'is-done', 'is-now']
            and hud['glow'] and hud['orb'], 'a song tool: the HUD shows the audio steps up to 考え中: %r' % hud)
    run_text = await page.inner_text('.ai-run')
    f.check(lang != 'ja' or ('考え中' in run_text and '中止' in run_text), 'the stage line and [中止] are shown: %r' % run_text)
    if not await f.until("() => document.querySelectorAll('.ai-review .ai-row').length > 0", 'the alignment review'):
        return
    hud = await page.evaluate(HUD)
    f.check(not hud['shown'] and not hud['glow'], 'the HUD and the glow go away with the answer: %r' % hud)
    ai_requests_ok(f, audio=True)
    parts = [s for s in f.ai_seen if s['method'] == 'POST'][0]['body']['contents'][0]['parts']
    f.check(parts[0].get('inlineData', {}).get('mimeType') == 'audio/wav' and 'text' in parts[1], 'the audio part comes before the prompt')
    heads = await page.evaluate("() => [...document.querySelectorAll('.ai-group-head')].map((e) => e.textContent)")
    f.check(lang != 'ja' or heads == ['時間'], 'the rows are in 時間: %r' % heads)
    done = await page.evaluate(DONE)
    await page.click('.ai-review-foot .btn.primary')
    await f.until("() => Object.entries(window.__mv.doc.pins).some(([p, x]) => p.endsWith(':start') && x.by === 'ai')", 'start pins by ai')
    f.check(await page.evaluate(DONE) == done + 1, 'one undo entry')
    await f.undo_all(done0, doc0)


# --- INT-UI flows: output settings, pins under older cut keys, the song pipeline ------------------------------------------

OUTPUT = """() => [window.__mv.doc.output.format, window.__mv.doc.look.backdrop,
  document.querySelector('.canvas-wrap').dataset.backdrop]"""


async def flow_output(f, lang):
    """透過PNG ⇔ 透明 as one pair (step ④ and 作品全体), skipped screen effects greyed with the reason, a PNG export."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    await page.evaluate("() => window.__mv.goStep('export')")
    await f.settle(2)
    note = await page.evaluate("() => window.__mv.t('exp.alphaNote')")
    shown = await page.evaluate("() => { const n = document.querySelector('.step-export [data-note=\"alpha\"]'); return n ? n.textContent : null; }")
    f.check(shown == note, 'step ④ says why there is no transparent video (MP4): %r' % shown)
    done = await page.evaluate(DONE)
    await page.click('[data-seg="format"] [data-v="pngAlpha"]')
    await f.settle(2)
    f.check(await page.evaluate(OUTPUT) == ['pngAlpha', 'clear', 'clear'], '透過PNG makes the backdrop 透明 and the preview transparent')
    f.check(await page.evaluate(DONE) == done + 1, 'one undo entry for the pair')
    f.check(await page.is_visible('.step-export [data-note="alpha"]'), 'the transparency note stays with 透過PNG')
    await f.blur()
    await page.keyboard.press('Control+z')
    await f.settle(2)
    f.check(await page.evaluate(OUTPUT) == ['mp4', 'scene', 'scene'], 'undo restores both')
    await page.keyboard.press('Control+Shift+z')
    await f.settle(2)
    opts = await page.evaluate("() => [...document.querySelectorAll('[data-ctl=\"backdrop\"] option')].map((o) => [o.value, o.disabled])")
    f.check(['clear', False] in opts, '透明 is always offered in step ④: %r' % opts)
    # A screen effect that transparent frames cannot keep is listed greyed with the reason (§4.19.4, §6.4.8).
    fx = await page.evaluate("""() => {
      const a = window.__mv, reg = a.reg;
      const key = reg.keys('filter').find((k) => { const d = reg.get('filter', k); return d.alphaSafe === false && !d.texture; })
        || reg.keys('filter').find((k) => reg.get('filter', k).alphaSafe === false);
      if (!key) return null;
      a.batch({ label: ['undo.pin', { field: 'x', scope: 'y' }] }, [
        { t: 'pin.set', path: 'work:filter.count', v: 1, by: 'user' }, { t: 'pin.set', path: 'work:filter#0', v: key, by: 'user' }]);
      a.select({ level: 'el', scope: 'work', el: 'filter', idx: 0 }, { from: 'header', open: true });
      return { key, label: a.label('filter', key) };
    }""")
    if f.check(fx is not None, 'a screen effect that is not alpha-safe'):
        await f.until("() => !!document.querySelector('[data-mount=\"inspector\"] .w-slot.is-skipped .w-slot-skip')", 'the slot is greyed with its reason')
        note = await page.evaluate("() => { const n = document.querySelector('[data-custom=\"backdropNote\"] .is-skip'); return n ? n.textContent : ''; }")
        f.check(fx['label'] in note, 'the 画面効果 page lists it as left out: %r' % note)
        why = await page.evaluate("() => { const r = document.querySelector('[data-mount=\"inspector\"] .frow.is-skipped .fr-why'); return r && !r.hidden ? r.textContent : ''; }")
        f.check(bool(why), 'its 種類 row says why under the row: %r' % why)
        await page.click(ROW % 'filter#0' + ' .w-part')
        await f.until("(k) => !!document.querySelector('.pb-tile.is-dim[data-key=\"' + k + '\"] .pb-badge')", 'the part browser dims it with a badge', fx['key'])
        await page.keyboard.press('Escape')
    # 作品全体 › 背景の種類 keeps the pair: 黒 turns 透過PNG into PNG連番 (and says so).
    await page.evaluate("() => window.__mv.select({ level: 'work' }, { from: 'header', open: true })")
    await f.settle(3)
    black = await page.evaluate("() => window.__mv.t('exp.bg.black')")
    await page.select_option('[data-mount="inspector"] .frow[data-field="work/look/look.set.backdrop"] select', label=black)
    await f.settle(2)
    f.check(await page.evaluate(OUTPUT) == ['png', 'black', 'black'], '背景の種類 黒 keeps a PNG sequence, opaque: %r' % await page.evaluate(OUTPUT))
    toast = await page.evaluate("() => [...document.querySelectorAll('.toast')].map((x) => x.textContent).join(' | ')")
    f.check('PNG' in toast, 'a toast names the new format: %r' % toast)
    # A saved range longer than the video: the summary and the I–O chip show what the export renders (the clamped range).
    await page.evaluate("""() => { const a = window.__mv;
      a.dispatch({ t: 'output.set', key: 'range', v: { t0: 2, t1: 600 } }, { label: ['undo.range', {}] });
      a.view.closePanel(); a.goStep('export'); }""")
    await f.settle(2)
    r = await page.evaluate("""() => { const a = window.__mv, T = MV.use('i18n/t');
      const clock = (s) => T.fmtTime(s).replace(/\\.\\d+$/, '');
      return { summary: document.querySelector('.exp-summary').textContent, want: clock(a.plan.duration - 2),
        chip: document.querySelector('[data-seg="range"] [data-v="io"]').textContent, chipWant: clock(2) + '–' + clock(a.plan.duration) }; }""")
    f.check(('・%s・' % r['want']) in r['summary'] and r['chip'] == r['chipWant'], 'the length is the clamped range: %r' % r)
    # A short PNG sequence through step ④ (memory sink when File System Access is off).
    await page.evaluate("""() => { const a = window.__mv;
      a.dispatch({ t: 'output.set', key: 'range', v: { t0: 1, t1: 1.1 } }, { label: ['undo.range', {}] });
      a.dispatch({ t: 'output.set', key: 'short', v: 720 }, { label: ['undo.output', {}] });
      a.view.closePanel(); a.goStep('export'); }""")
    await f.settle(2)
    ok = await page.evaluate("""async () => { const a = window.__mv;
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
      await a.exportStart();
      const st = a.exportState();
      return st.phase === 'done' ? st.result.frames : st.phase + ' ' + (st.message || ''); }""")
    f.check(ok == 3, 'the PNG export finishes with 3 frames: %r' % ok)
    await page.evaluate('() => window.__mv.exportReset()')
    await large_export_asks(f)
    await f.undo_all(done0, doc0)


async def large_export_asks(f):
    """A large in-memory export (pre-flight 'confirm', §4.21) asks first however it starts: Ctrl+K › 書き出す and the button."""
    page = f.page
    await page.click('[data-seg="format"] [data-v="pngAlpha"]')
    await page.evaluate("""() => { const a = window.__mv;
      Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
      a.dispatch({ t: 'output.set', key: 'range', v: null }, { label: ['undo.range', {}] });
      a.dispatch({ t: 'output.set', key: 'short', v: 2160 }, { label: ['undo.output', {}] });
      a.dispatch({ t: 'output.set', key: 'fps', v: 60 }, { label: ['undo.output', {}] }); }""")
    await f.settle(2)
    if not f.check(await page.evaluate("() => window.__mv.exportChecks().some((c) => c.level === 'confirm')"),
                   '2160p60 透過PNG in memory needs a confirmation'):
        return
    asked = "() => !!document.querySelector('dialog.dlg[open]') && window.__mv.exportState().phase === 'idle'"
    for how in ('palette', 'button'):
        await f.blur()
        if how == 'palette':
            await page.keyboard.press('Control+k')
            await f.until('() => window.__mv.paletteOpen', 'Ctrl+K opens the palette')
            await page.keyboard.type('export.start')
            await page.keyboard.press('Enter')
        else:
            await page.click('.footer-export [data-act="export.start"]')
        if await f.until(asked, 'the export asks before it starts (%s)' % how):
            await page.keyboard.press('Escape')
            await f.until("() => !document.querySelector('dialog.dlg[open]')", 'Esc closes the question (%s)' % how)
        await f.settle(2)
        f.check(await page.evaluate("() => window.__mv.exportState().phase") == 'idle', 'declining starts nothing (%s)' % how)


async def flow_cutkeys(f, lang):
    """A cut whose pins live under an older key (§4.10.4): the inspector writes, clears, widens, tries on, rerolls and
    reattaches there, and no pin is orphaned."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    info = await page.evaluate("""() => {
      const a = window.__mv;
      const line = a.plan.lines.find((l) => l.text.startsWith('窓をあけて'));
      const key = line.cuts[0];
      const cut = a.plan.cuts.find((c) => c.key === key);
      const old = line.id + '~2';
      const arrive = a.reg.keys('arrive').find((k) => k !== cut.slots.arrive.v && a.reg.traits('arrive', k).roles.includes('lyric'));
      a.dispatch({ t: 'pin.set', path: 'cut/' + old + ':arrive', v: arrive, by: 'user', sig: cut.text }, { label: ['undo.pin', { field: 'x', scope: 'y' }] });
      const now = a.plan.cuts.find((c) => c.key === key);
      a.select({ level: 'cut', key }, { from: 'crumbs', open: true });
      return { key, old, line: line.id, pinKey: now.pinKey || null, arrive, from: now.slots.arrive.from };
    }""")
    f.check(info['pinKey'] == info['old'] and info['from'] == 'pin:cut', 'the older key is reattached: %r' % info)
    await f.settle(3)
    await page.click(ROW % 'dwell' + ' .w-part')
    await f.until("() => document.querySelectorAll('.pb-tile[data-key]').length > 1", 'the 見せ browser opens')
    key = await page.evaluate(OTHER_TILE)
    await page.click('.pb-tile[data-key="%s"]' % key)
    stored = 'cut/%s:dwell' % info['old']
    await f.until('(p) => !!window.__mv.doc.pins[p]', 'the pin is written under the older key', stored)
    s = await page.evaluate("""(k) => { const a = window.__mv; const c = a.plan.cuts.find((x) => x.key === k);
      return { arrive: c.slots.arrive.from, dwell: c.slots.dwell.from,
        lost: a.plan.warnings.filter((w) => w.code === 'orphan-pin' || w.code === 'shadowed-pin').length,
        exact: !!a.doc.pins['cut/' + k + ':dwell'] }; }""", info['key'])
    f.check(s == {'arrive': 'pin:cut', 'dwell': 'pin:cut', 'lost': 0, 'exact': False}, 'both pins apply, none is orphaned: %r' % s)
    await f.settle(2)
    await widen_stored_pin(f, info, stored)
    await page.click(ROW % 'dwell' + ' [data-role="unpin"]')
    await f.until('(p) => !window.__mv.doc.pins[p]', '× clears the pin where it is stored', stored)
    await f.settle(2)
    await try_auto_and_reroll(f, info)
    await reattach_stray(f, info)
    await f.undo_all(done0, doc0)


async def widen_stored_pin(f, info, stored):
    """⋯ › 範囲を広げる on a pin under an older key: offered, and pin.promote moves that pin (undone afterwards)."""
    page = f.page
    labels = await page.evaluate("() => [window.__mv.t('fm.promoteLine'), window.__mv.t('fm.promoteWork')]")
    await page.click(ROW % 'dwell' + ' .fr-top [aria-haspopup="menu"]')
    if not await f.until("() => !!document.querySelector('.popover.menu')", 'the field menu opens'):
        return
    offered = await page.evaluate("""(labels) => labels.map((l) => {
      const b = [...document.querySelectorAll('.popover.menu .menu-item')].find((x) => x.textContent.trim() === l);
      return b ? !b.disabled : null; })""", labels)
    f.check(offered == [True, True], '範囲を広げる is offered for the pin under the older key: %r' % offered)
    await page.evaluate("""(l) => [...document.querySelectorAll('.popover.menu .menu-item')].find((x) => x.textContent.trim() === l).click()""",
                        labels[0])
    moved = ['line/%s:dwell' % info['line'], stored]
    await f.until('(p) => !!window.__mv.doc.pins[p[0]] && !window.__mv.doc.pins[p[1]]', 'the stored pin moves to the line', moved)
    await f.blur()
    await page.keyboard.press('Control+z')
    await f.until('(p) => !window.__mv.doc.pins[p[0]] && !!window.__mv.doc.pins[p[1]]', 'undo puts it back under the older key', moved)
    await f.settle(3)


async def try_auto_and_reroll(f, info):
    """The pinned 入り: the 自動 tile's try-on drops the stored pin; [d] clears it and bumps the displayed cut's salt."""
    page = f.page
    stored = 'cut/%s:arrive' % info['old']
    await page.click(ROW % 'arrive' + ' .w-part')
    await f.until("() => document.querySelectorAll('.pb-tile[data-key]').length > 1", 'the 入り browser opens')
    await page.hover('.pb-tile.pb-auto')
    await f.until("""(k) => { const a = window.__mv, c = a.shell.stage.hasAlt() && a.engine.plan.cuts.find((x) => x.key === k);
      return !!c && c.slots.arrive.from === 'auto'; }""", 'trying on 自動 previews the auto pick', info['key'])
    await page.mouse.move(2, 2)
    await page.keyboard.press('Escape')
    await f.until("() => !window.__mv.shell.stage.hasAlt()", 'leaving the browser ends the try-on')
    await f.settle(3)
    done = await page.evaluate(DONE)
    await page.click(ROW % 'arrive' + ' [data-role="dice"]')
    await f.until('(p) => !window.__mv.doc.pins[p]', '[d] clears the pin where it is stored', stored)
    s = await page.evaluate("""(k) => { const a = window.__mv;
      return { from: a.plan.cuts.find((x) => x.key === k).slots.arrive.from, salts: a.doc.salts }; }""", info['key'])
    f.check(s['from'] == 'auto' and s['salts'] == {'cut/%s:arrive' % info['key']: 1}, '[d] = unpin + reroll of the displayed cut: %r' % s)
    f.check(await page.evaluate(DONE) == done + 1, '[d] is one undo entry')


async def reattach_stray(f, info):
    """[このカットに付け直す] re-keys a stray pin to where the nearest cut's pins live, not to its displayed key."""
    page = f.page
    r = await page.evaluate("""(lineId) => { const a = window.__mv;
      const line = a.plan.lines.find((l) => l.id === lineId);
      const last = a.plan.cuts.find((c) => c.key === line.cuts[line.cuts.length - 1]);
      const off = Number(last.key.split('~')[1]);
      const older = lineId + '~' + (off + 2), stray = lineId + '~40';
      const depart = a.reg.keys('depart').find((k) => k !== last.slots.depart.v && a.reg.traits('depart', k).roles.includes('lyric'));
      const dwell = a.reg.keys('dwell').find((k) => k !== last.slots.dwell.v && a.reg.traits('dwell', k).roles.includes('lyric'));
      a.batch({ label: ['undo.pin', { field: 'x', scope: 'y' }] }, [
        { t: 'pin.set', path: 'cut/' + older + ':depart', v: depart, by: 'user', sig: last.text },
        { t: 'pin.set', path: 'cut/' + stray + ':dwell', v: dwell, by: 'user', sig: 'ずれた言葉' }]);
      const now = a.plan.cuts.find((c) => c.key === last.key);
      a.select({ level: 'work' }, { from: 'header', open: true });
      return { key: last.key, older, stray, pinKey: now.pinKey || null,
        warn: a.plan.warnings.filter((w) => w.code === 'orphan-pin').map((w) => w.path) }; }""", info['line'])
    f.check(r['pinKey'] == r['older'] and r['warn'] == ['cut/%s:dwell' % r['stray']], 'one stray pin next to an older key: %r' % r)
    await f.settle(3)
    await open_section(f, 'other')
    label = await page.evaluate("() => window.__mv.t('insp.reattach')")
    await page.click('[data-mount="inspector"] .insp-orphan button:has-text("%s")' % label)
    ok = """(r) => { const a = window.__mv, c = a.plan.cuts.find((x) => x.key === r.key);
      return !a.plan.warnings.some((w) => w.code === 'orphan-pin' || w.code === 'shadowed-pin') && c.slots.dwell.from === 'pin:cut'
        && c.slots.depart.from === 'pin:cut' && !!a.doc.pins['cut/' + r.older + ':dwell'] && !a.doc.pins['cut/' + r.key + ':dwell']; }"""
    if not await f.until(ok, 'the stray pin joins the pins under the older key, nothing is orphaned', r):
        f.check(False, 'after reattach: %r' % await page.evaluate("""() => ({ pins: Object.keys(window.__mv.doc.pins),
          warn: window.__mv.plan.warnings.map((w) => w.code + ' ' + w.path) })"""))


async def flow_song(f, lang):
    """Step ②: a newer file replaces a load still running; [中止] stops a load; 曲なしで次へ without a song."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    await page.evaluate(AI_WAV_JS)
    await page.evaluate("() => window.__mv.goStep('song')")
    await f.settle(2)
    label = await page.evaluate("() => document.querySelector('.next-btn').textContent")
    f.check(label == ('曲なしで次へ' if lang == 'ja' else 'Next without a song'), 'no song: %r' % label)
    r = await page.evaluate("""async () => { const a = window.__mv;
      const one = a.loadSong(window.__wav(20, 'first.wav')), two = a.loadSong(window.__wav(6, 'second.wav'));
      await Promise.all([one, two]);
      return [a.doc.song && a.doc.song.name, a.songReady()]; }""")
    f.check(r == ['second.wav', True], 'the newer file wins, the older load never reaches the document: %r' % r)
    # [中止] shows as soon as the load starts (a short song finishes before a pointer could reach it, so it is clicked
    # at once); the step keeps that one button while progress comes in.
    r = await page.evaluate("""async () => { const a = window.__mv;
      const load = a.loadSong(window.__wav(30, 'long.wav'));
      const button = document.querySelector('.song-cancel');
      if (!button) return 'no [中止]';
      await new Promise((r) => setTimeout(r, 60));
      if (a.songState().state === 'decoding' && document.querySelector('.song-cancel') !== button) return 'rebuilt [中止]';
      button.click();
      await load;
      return [a.doc.song && a.doc.song.name, a.songState().state]; }""")
    f.check(r == ['second.wav', 'ready'], 'a cancelled load changes nothing, [中止] stays one button: %r' % r)
    await f.settle(2)
    label = await page.evaluate("() => document.querySelector('.next-btn').textContent")
    f.check(label != ('曲なしで次へ' if lang == 'ja' else 'Next without a song'), 'with a song the button says 次へ: %r' % label)
    await f.undo_all(done0, doc0)


async def flow_playback(f, lang):
    """While the preview plays, the prepared window follows the playhead (INT-LEAD): prepare runs again after the playhead
    has moved 1.5 s (release check; it was 2.5 s, which left a budget-limited window cold before its horizon), so cuts are
    built and their blurred glyphs rasterized before they reach the screen."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    # Each call: [t0, t1, export, playing]; a preview prepare covers [max(0, t − 5), t + 5] around the playhead t.
    await page.evaluate("""() => { const a = window.__mv, e = a.engine, prepare = e.prepare; window.__prepared = [];
      e.prepare = (t0, t1, o) => { window.__prepared.push([t0, t1, !!(o && o.export), a.view.state.playing]); return prepare(t0, t1, o); }; }""")
    await page.evaluate('() => { window.__mv.seek(0.5); window.__mv.play(); }')
    ok = await f.until('() => window.__prepared.filter(([a, b, x, p]) => !x && p && b - 5 >= 3).length >= 2',
                       'prepares at ≥ 3 s while playing', timeout=15000)
    calls = await page.evaluate('() => window.__prepared')
    await page.evaluate('() => window.__mv.pause()')
    f.check(ok, 'the prepared window moves with playback: %r' % calls[:6])
    at = [round(b - 5, 2) for a, b, x, p in calls if not x and p]
    gaps = [y - x for x, y in zip(at, at[1:]) if y - x > 0.5]      # (a seek's debounced prepare may land just after play)
    f.check(bool(gaps) and max(gaps) <= 1.75 and min(gaps) >= 1.4, 'a prepare about every 1.5 s of playback: %r' % at)
    f.check(len(at) <= 8, 'not one prepare per frame (%d calls)' % len(at))
    await f.undo_all(done0, doc0)


# --- final fixes (ui-data) ----------------------------------------------------------------------------------------------

# window.__project(rows, name) → a project File; window.__idb() → what IndexedDB holds (works with their rows, song keys).
IO_JS = r"""
() => {
  window.__projectText = (rows) => {
    const D = MV.use('core/doc');
    const doc = D.defaultDoc();
    doc.sheet = Object.assign({}, doc.sheet, { rows: rows.map((src, i) => ({ id: 'r' + (i + 1), src })), next: rows.length + 1 });
    return D.serialize({ doc, side: D.defaultSide() });
  };
  window.__project = (rows, name) => new File([window.__projectText(rows)], name || 'project.json', { type: 'application/json' });
  window.__idb = async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('mojipv-v2'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const get = (store, how) => new Promise((res) => { const q = db.transaction(store).objectStore(store)[how](); q.onsuccess = () => res(q.result); });
    const works = await get('works', 'getAll');
    const songs = await get('songs', 'getAllKeys');
    db.close();
    return { songs, works: works.sort((a, b) => b.at - a.at).map((w) => { const f = JSON.parse(w.text);
      return { id: w.id, name: w.name, rows: f.doc.sheet.rows.map((r) => r.src), song: f.doc.song ? f.doc.song.sha1 : null }; }) };
  };
}
"""
TOASTS = "() => [...document.querySelectorAll('.toast-text')].map((x) => x.textContent)"
SAVED = "() => window.__mv.io.state() === 'saved'"


def app_url(f, query):
    return f.page.url.split('?')[0] + query


async def extra_page(f, url, **kw):
    """A second page for one check (reduced motion, a HiDPI screen): its page errors count for the flow."""
    kw.setdefault('viewport', {'width': 1440, 'height': 900})
    page = await new_page(f.page.context.browser, **kw)
    await page.add_init_script(RECORD)
    page.on('pageerror', lambda e: f.errors.append(str(e)))
    for host in FONT_HOSTS:
        await page.route(host, lambda route: route.abort())
    await page.goto(url, wait_until='load')
    await page.wait_for_function('window.__mv && window.__mv.ready')
    await page.evaluate('async () => { await window.__mv.ready; }')
    return page


async def close_extra(f, page):
    csp = await page.evaluate('() => window.__csp || []')
    f.check(not csp, 'CSP violations (extra page): %r' % csp)
    await page.context.close()


async def flow_open_damaged(f, lang):
    """flows-1: a project file with a damaged side opens (and says so), the steps switch and R replans; a failure that is
    not the file's reads as a damaged file, never as "not JSON"; a look history that cannot be recorded never leaves the
    preview on the previous plan."""
    page = f.page
    await with_lyrics(f)
    await page.evaluate(IO_JS)
    r = await page.evaluate("""async () => {
      const a = window.__mv, f = JSON.parse(window.__projectText(['朝の窓をあけて', '光を入れる', 'おはよう']));
      f.side.looks = { list: [null, 'x', { n: 'a' }], cap: 50 };
      f.side.aiLog = [null, 3, { at: 'no' }];
      await a.io.openFiles([new File([JSON.stringify(f)], 'damaged.json', { type: 'application/json' })]);
      return { rows: a.doc.sheet.rows.map((x) => x.src), toasts: [...document.querySelectorAll('.toast-text')].map((x) => x.textContent) };
    }""")
    opened = await page.evaluate("() => window.__mv.t('io.opened', { name: 'damaged.json' })")
    badJson = await page.evaluate("() => window.__mv.t('err.file.bad-json')")
    f.check(r['rows'] == ['朝の窓をあけて', '光を入れる', 'おはよう'], 'the damaged file opened: %r' % r['rows'])
    f.check(opened in r['toasts'] and badJson not in r['toasts'], 'the toast says it opened: %r' % r['toasts'])
    for step in ('song', 'look', 'export', 'lyrics'):
        await page.click('.step-tab[data-step="%s"]' % step)
        await f.until("(s) => window.__mv.view.state.step === s", 'step %s shows' % step, step)
    await page.evaluate('() => window.__mv.shell.stage.focus()')
    before = await page.evaluate('() => { window.__plan0 = window.__mv.plan; return window.__mv.doc.look.seed; }')
    await page.keyboard.press('r')
    await f.until('(s) => window.__mv.doc.look.seed !== s', 'R changes the look', before)
    r = await page.evaluate("""() => { const a = window.__mv;
      return { replanned: a.plan !== window.__plan0 && a.plan.hash !== window.__plan0.hash && a.engine.plan === a.plan, looks: a.store.side.looks.list.length }; }""")
    f.check(r['replanned'], 'R replans after opening the damaged file: %r' % r)

    # A failure inside the parser that is not a MigrateError: 「作品ファイルが壊れています」, the work stays as it was.
    r = await page.evaluate("""async () => {
      const a = window.__mv, M = MV.use('core/migrate'), parse = M.parseFile, rows = a.doc.sheet.rows.map((x) => x.src);
      M.parseFile = () => { throw new TypeError('boom'); };
      try { await a.io.openFiles([window.__project(['別の歌'], 'other.json')]); } finally { M.parseFile = parse; }
      return { same: JSON.stringify(a.doc.sheet.rows.map((x) => x.src)) === JSON.stringify(rows),
        toasts: [...document.querySelectorAll('.toast-text')].map((x) => x.textContent), invalid: a.t('err.file.invalid', { n: 1 }) };
    }""")
    f.check(r['same'] and r['invalid'] in r['toasts'] and badJson not in r['toasts'],
            'a non-MigrateError reads as a damaged file and changes nothing: %r' % r)

    # The look history fails to record (a store 'side' listener throws once): the plan is still the new one, no error toast.
    r = await page.evaluate("""() => {
      const a = window.__mv; let n = 0;
      const off = a.store.on('side', () => { if (!n++) throw new Error('history listener'); });
      document.querySelectorAll('.toast').forEach((x) => x.remove());
      const plan0 = a.plan;
      a.actions.run('look.omakase');
      off();
      return { replanned: a.plan !== plan0 && a.plan.hash !== plan0.hash && a.engine.plan === a.plan, thrown: n,
        toasts: [...document.querySelectorAll('.toast-text')].map((x) => x.textContent), err: a.t('err.command') };
    }""")
    f.check(r['thrown'] == 1 and r['replanned'] and r['err'] not in r['toasts'], 'a failing look history never leaves a stale plan: %r' % r)


async def flow_autosave(f, lang):
    """flows-2, flows-6, flows-7, security-3: the autosave writes each work under its own id, says 保存中… until the write
    lands and survives a reload 200 ms after an edit; Shift_JIS lyric files open; song audio no work uses is removed."""
    page = f.page
    await page.evaluate(IO_JS)
    saving = await page.evaluate("() => window.__mv.t('hdr.save.saving')")
    await page.evaluate("(t) => window.__mv.dispatch({ t: 'lyrics.set', text: t }, { label: ['undo.paste', {}] })", '[ti:作品A]\n窓をあけて\n光を入れる')
    await f.until(SAVED, 'the first autosave lands', timeout=5000)
    ida = (await page.evaluate('() => window.__idb()'))['works'][0]['id']
    # flows-6: an edit reads 保存中… at once, and a reload 200 ms later keeps it.
    await page.evaluate("() => window.__mv.dispatch({ t: 'lyrics.set', text: window.__mv.doc.sheet.rows.map((r) => r.src).join('\\n') + 'ね' }, { label: ['undo.typing', {}] })")
    r = await page.evaluate("() => [window.__mv.io.state(), document.querySelector('.save-state').textContent]")
    f.check(r == ['saving', saving], 'an unsaved edit reads 保存中…: %r' % r)
    await page.wait_for_timeout(200)
    await page.goto(app_url(f, '?test=1'), wait_until='load')
    await page.wait_for_function('window.__mv && window.__mv.ready')
    await page.evaluate('async () => { await window.__mv.ready; }')
    await page.evaluate(IO_JS)
    rows = await page.evaluate('() => window.__mv.doc.sheet.rows.map((r) => r.src)')
    f.check(rows[-1:] == ['光を入れるね'], 'the edit made 200 ms before the reload is restored: %r' % rows)
    f.check([w['id'] for w in (await page.evaluate('() => window.__idb()'))['works']] == [ida], 'the reload continues the same work')

    # flows-2: an edit, then another project opened inside the debounce window: each record holds its own document.
    await page.evaluate("() => window.__mv.dispatch({ t: 'lyrics.set', text: window.__mv.doc.sheet.rows.map((r) => r.src).concat(['Aの最後の行']).join('\\n') }, { label: ['undo.typing', {}] })")
    await page.wait_for_timeout(150)
    await page.evaluate("async () => { await window.__mv.io.openFiles([window.__project(['[ti:朝の窓]', '別の作品の行'], 'b.json')]); }")
    idb = await page.evaluate("async () => { await window.__mv.io.flush(); return window.__idb(); }")
    old = next((w for w in idb['works'] if w['id'] == ida), None)
    new = next((w for w in idb['works'] if w['id'] != ida), None)
    f.check(old is not None and 'Aの最後の行' in old['rows'], 'the previous work keeps its last edit: %r' % old)
    f.check(new is not None and new['rows'] == ['[ti:朝の窓]', '別の作品の行'] and new['name'] == '朝の窓',
            'the opened work holds only its own text: %r' % new)

    # flows-7: a Shift_JIS .lrc opens as text, and the toast names the encoding.
    r = await page.evaluate("""async () => {
      const a = window.__mv, bytes = new Uint8Array(%s);
      await a.io.openFiles([new File([bytes], 'sjis.lrc', { type: 'text/plain' })]);
      return { rows: a.doc.sheet.rows.map((x) => x.src), toasts: [...document.querySelectorAll('.toast-text')].map((x) => x.textContent) };
    }""" % json.dumps(SJIS_LRC))
    f.check(r['rows'][:2] == ['[ti:夜明けのうた]', '[00:01.00]夜明けの街を走る'], 'Shift_JIS lyrics decode: %r' % r['rows'][:2])
    f.check(any('Shift_JIS' in x for x in r['toasts']), 'the toast names Shift_JIS: %r' % r['toasts'])

    # security-3: a song no kept work uses any more is removed from the device once the works move on.
    await page.evaluate(AI_WAV_JS)
    sha = await page.evaluate("async () => { const a = window.__mv; await a.loadSong(window.__wav(3, 'demo.wav')); return a.doc.song.sha1; }")
    await page.evaluate('async () => { await window.__mv.io.flush(); }')
    f.check(sha in (await page.evaluate('() => window.__idb()'))['songs'], 'the loaded song is stored')
    await page.evaluate('() => window.__mv.clearSong()')
    for i in range(6):
        await page.evaluate("async (i) => { const a = window.__mv; await a.io.newWork(); a.dispatch({ t: 'lyrics.set', text: '新しい作品 ' + i }, { label: ['undo.typing', {}] }); await a.io.flush(); }", i)
    idb = await page.evaluate('() => window.__idb()')
    used = {w['song'] for w in idb['works'] if w['song']}
    f.check(len(idb['works']) == 5 and set(idb['songs']) <= used, 'songs kept only for kept works: %r (used %r)' % (idb['songs'], used))


# 「[ti:夜明けのうた]\n[00:01.00]夜明けの街を走る」 in Shift_JIS.
SJIS_LRC = list('[ti:夜明けのうた]\n[00:01.00]夜明けの街を走る'.encode('shift_jis'))


async def flow_tabs(f, lang):
    """flows-3: a second tab of the app never writes the first tab's work: it continues in a copy, and both tabs' edits
    survive. Two pages of one browser context share IndexedDB and Web Locks, like two tabs."""
    ctx = await f.page.context.browser.new_context(viewport={'width': 1440, 'height': 900},
                                                   ignore_https_errors=bool(os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')))
    await ctx.add_init_script(RECORD)
    for host in FONT_HOSTS:
        await ctx.route(host, lambda route: route.abort())
    tabs = []
    for name, query in (('A', '?fresh=1&test=1'), ('B', '?test=1')):
        if tabs:
            await tabs[0].evaluate("(t) => window.__mv.dispatch({ t: 'lyrics.set', text: t }, { label: ['undo.paste', {}] })", '[ti:ふたつのタブ]\n一行目')
            await tabs[0].wait_for_function(SAVED, timeout=5000)
        page = await ctx.new_page()
        page.on('pageerror', lambda e, n=name: f.errors.append('tab %s: %s' % (n, e)))
        await page.goto(app_url(f, query), wait_until='load')
        await page.wait_for_function('window.__mv && window.__mv.ready')
        await page.evaluate('async () => { await window.__mv.ready; }')
        tabs.append(page)
    a, b = tabs
    await a.evaluate(IO_JS)
    ida = (await a.evaluate('() => window.__idb()'))['works'][0]['id']
    r = await b.evaluate("() => ({ rows: window.__mv.doc.sheet.rows.map((x) => x.src), toasts: [...document.querySelectorAll('.toast-text')].map((x) => x.textContent) })")
    f.check(r['rows'] == ['[ti:ふたつのタブ]', '一行目'], 'tab B opens the newest work: %r' % r)
    f.check(any('ふたつのタブ' in x for x in r['toasts']), 'tab B says it is a copy: %r' % r['toasts'])
    add = "(line) => window.__mv.dispatch({ t: 'lyrics.set', text: window.__mv.doc.sheet.rows.map((r) => r.src).concat([line]).join('\\n') }, { label: ['undo.typing', {}] })"
    await a.evaluate(add, 'タブAで足した行')
    await b.evaluate(add, 'タブBで足した行')
    await a.evaluate('async () => { await window.__mv.io.flush(); }')
    await b.evaluate('async () => { await window.__mv.io.flush(); }')
    idb = await a.evaluate('() => window.__idb()')
    rows = {w['id']: w['rows'] for w in idb['works']}
    f.check(len(idb['works']) == 2, 'two works in 最近の作品: %r' % idb['works'])
    f.check('タブAで足した行' in rows.get(ida, []) and 'タブBで足した行' not in rows.get(ida, []), 'tab A keeps its own work: %r' % rows)
    f.check(any('タブBで足した行' in v and 'タブAで足した行' not in v for k, v in rows.items() if k != ida), 'tab B writes its copy: %r' % rows)
    for page in tabs:
        csp = await page.evaluate('() => window.__csp || []')
        f.check(not csp, 'CSP violations: %r' % csp)
    await ctx.close()


async def flow_tap(f, lang):
    """spec-7 (§6.4.15): tap-sync of 5 lines with a song, from the selected line, with E and Backspace, as one undo entry;
    flows-4: without a song the silent clock runs past the automatic length; flows-9: opening a project ends a session."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    await page.evaluate(AI_WAV_JS)
    ok = await page.evaluate("async () => { await window.__mv.loadSong(window.__wav(30, 'tap.wav')); return window.__mv.songReady(); }")
    if not f.check(ok, 'the song is loaded'):
        return
    ids = await page.evaluate('() => window.__mv.plan.lines.map((l) => l.id)')
    await page.evaluate("(id) => window.__mv.select({ level: 'line', ids: [id] }, { from: 'key', seek: false })", ids[1])
    await page.evaluate('() => window.__mv.shell.stage.focus()')
    # What the clock read at each tap key (the marks come from the same event).
    await page.evaluate("""() => { window.__taps = [];
      document.addEventListener('keydown', (ev) => { const a = window.__mv; if (a.view.state.mode === 'tap')
        window.__taps.push({ key: ev.key, out: a.player.outputTimeOf(ev.timeStamp), latency: a.doc.timing.tapLatency || 0 }); }, true); }""")
    done1 = await page.evaluate(DONE)
    await page.keyboard.press('t')
    if not await f.until("() => window.__mv.view.state.mode === 'tap' && window.__mv.view.state.playing", 'T starts tap mode and plays'):
        return
    for key in ('Space', 'e', 'Enter', 'Space', 'Backspace', 'Space', 'Enter'):
        await page.wait_for_timeout(350)
        await page.keyboard.press(key)
    await page.wait_for_timeout(200)
    await page.keyboard.press('Escape')
    await f.until("() => window.__mv.view.state.mode === 'normal'", 'Esc finishes')
    r = await page.evaluate("""() => { const a = window.__mv, p = a.doc.pins;
      return { pins: Object.keys(p).filter((k) => p[k].by === 'tap').sort().map((k) => [k, p[k].v]), taps: window.__taps,
        entries: a.store.list().filter((e) => e.done).map((e) => e.label[0]) }; }""")
    starts = [(k, v) for k, v in r['pins'] if k.endswith(':start')]
    want = ['line/%s:start' % i for i in ids[1:6]]
    f.check([k for k, _ in starts] == want, 'starts from the selected line, 5 lines: %r' % starts)
    by = {k: v for k, v in r['pins']}
    f.check(all(by[want[i]] < by[want[i + 1]] for i in range(len(want) - 1) if want[i] in by and want[i + 1] in by),
            'the marks increase: %r' % starts)
    f.check('line/%s:end' % ids[1] in by and by[want[0]] < by['line/%s:end' % ids[1]] < by.get(want[1], 1e9), 'E marks the end of line 2: %r' % r['pins'])
    marks = [x['out'] - x['latency'] for x in r['taps'] if x['key'] in (' ', 'Enter')]
    # The marks are the clock at the key event minus the latency: Space, Enter, Space (forgotten), Space, Enter.
    if f.check(len(marks) == 5, 'five mark keys recorded: %r' % r['taps']):
        expect = [marks[0], marks[1], marks[3], marks[4]]
        got = [by.get(k) for k in want[:1] + want[1:2] + want[2:3] + want[3:4]]
        f.check(all(g is not None and abs(g - round(e, 3)) <= 1 / 30 for g, e in zip(got, expect)), 'marks = clock − latency: %r vs %r' % (got, expect))
        f.check(abs(by[want[2]] - marks[2]) > 0.05, 'the backspaced line holds its second mark: %r' % r['pins'])
    f.check(r['entries'][-1] == 'undo.tap' and len(r['entries']) == done1 + 1, 'one undo entry: %r' % r['entries'][done1:])
    await f.undo_all(done0, doc0)

    # flows-4: no song, tapping slower than the automatic timing: the clock runs on past the automatic end.
    await page.evaluate('() => window.__mv.clearSong()')
    await f.settle(2)
    dur = await page.evaluate('() => window.__mv.plan.duration')
    await page.evaluate("(id) => { const a = window.__mv; a.pause(); a.select({ level: 'line', ids: [id] }, { from: 'key', seek: false }); a.shell.stage.focus(); }", ids[0])
    await page.keyboard.press('t')
    await f.until("() => window.__mv.view.state.mode === 'tap' && window.__mv.view.state.playing", 'T without a song plays the silent clock')
    await page.keyboard.press('Space')
    for _ in range(int(dur // 3) + 2):
        await page.keyboard.press('ArrowRight')
    await page.wait_for_timeout(250)
    r = await page.evaluate('() => ({ t: window.__mv.time(), playing: window.__mv.view.state.playing })')
    f.check(r['playing'] and r['t'] > dur, 'the silent clock runs past the automatic length %.2f: %r' % (dur, r))
    for _ in range(2):
        await page.wait_for_timeout(300)
        await page.keyboard.press('Space')
    await page.keyboard.press('Escape')
    await f.until("() => window.__mv.view.state.mode === 'normal'", 'Esc finishes')
    r = await page.evaluate("(ids) => ids.map((id) => (window.__mv.doc.pins['line/' + id + ':start'] || {}).v)", ids[:3])
    f.check(None not in r and r[0] < r[1] < r[2] and r[1] > dur and r[2] - r[1] > 0.2, 'the marks follow the clock past the end: %r' % r)
    r2 = await page.evaluate('() => ({ player: window.__mv.player.duration, plan: window.__mv.plan.duration, time: window.__mv.view.state.time })')
    f.check(abs(r2['player'] - r2['plan']) < 1e-6 and r2['time'] <= r2['plan'] + 1e-6, 'finishing restores the normal length: %r' % r2)
    await f.undo_all(done0, doc0)

    # The mouse and touch (a user found that taps did not seem to take effect): with 詳細 open the tap panel still
    # shows; a press on the preview and on the タップ button mark at the press's time without selecting, pausing or
    # opening 詳細; while playback is stopped nothing is recorded and the panel says why; finishing seeks 2 s before the
    # first marked line and the toast offers 再生して確認.
    ok = await page.evaluate("async () => { await window.__mv.loadSong(window.__wav(30, 'tap.wav')); return window.__mv.songReady(); }")
    f.check(ok, 'the song is loaded again')
    await page.evaluate("(id) => { const a = window.__mv; a.pause(); a.select({ level: 'line', ids: [id] }, { from: 'key', seek: false }); a.openPanel('details', 'key'); }", ids[0])
    sel0 = await page.evaluate('() => JSON.stringify(window.__mv.view.state.sel)')
    done1 = await page.evaluate(DONE)
    await page.evaluate("() => window.__mv.actions.run('tap.start', { from: 'test' })")
    await f.until("() => window.__mv.view.state.mode === 'tap' && window.__mv.view.state.playing", 'tap mode plays')
    shown = await page.evaluate("() => { const b = document.querySelector('.step-tap .tap-pad'); const r = b && b.getBoundingClientRect(); return !!r && r.width > 0 && r.height > 0 && !b.disabled; }")
    f.check(shown, 'the タップ button shows although 詳細 was open')
    mid = await page.evaluate("() => { const r = document.querySelector('.canvas-wrap').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
    await page.wait_for_timeout(300)
    await page.mouse.click(mid[0], mid[1])
    await page.wait_for_timeout(300)
    await page.click('.step-tap .tap-pad')
    r = await page.evaluate("""() => { const a = window.__mv; return { playing: a.view.state.playing, sel: JSON.stringify(a.view.state.sel),
      mode: a.view.state.mode, last: document.querySelector('.tap-last').textContent }; }""")
    f.check(r['playing'] and r['mode'] == 'tap' and r['sel'] == sel0, 'presses neither pause nor select: %r' % r)
    await page.click('[data-act="play.toggle"]')
    await page.wait_for_timeout(200)
    await page.keyboard.press('Space')
    await page.mouse.click(mid[0], mid[1])
    r = await page.evaluate("(k) => ({ last: document.querySelector('.tap-last').textContent, want: window.__mv.t(k), n: document.querySelector('.tap-count').textContent })", 'tap.stopped')
    f.check(r['last'] == r['want'], 'a tap while playback is stopped says so: %r' % r)
    await page.click('[data-act="play.toggle"]')
    await page.wait_for_timeout(300)
    await page.keyboard.press('Space')
    await page.wait_for_timeout(100)
    await page.click('.step-tap .row-actions .btn.primary')
    await f.until("() => window.__mv.view.state.mode === 'normal'", 'the 終わる button finishes')
    r = await page.evaluate("""(ids) => { const a = window.__mv, p = a.doc.pins;
      const starts = ids.map((id) => (p['line/' + id + ':start'] || {}));
      const toast = [...document.querySelectorAll('.toast')].pop();
      return { starts: starts.map((x) => [x.by, x.v]), time: a.time(), t0: a.plan.lines[0].t0, done: a.store.list().filter((e) => e.done).length,
        toast: toast ? toast.querySelector('.toast-text').textContent : null, act: toast && toast.querySelector('.toast-act') ? toast.querySelector('.toast-act').textContent : null,
        wantToast: a.t('tap.done', { n: 3 }), wantAct: a.t('tap.check') }; }""", ids[:4])
    v = [x[1] for x in r['starts'][:3]]
    f.check(all(x[0] == 'tap' for x in r['starts'][:3]) and v[0] < v[1] < v[2] and r['starts'][3][0] is None,
            'the preview, the button and Space after resuming mark lines 1-3, nothing while stopped: %r' % r['starts'])
    f.check(r['done'] == done1 + 1 and r['toast'] == r['wantToast'] and r['act'] == r['wantAct'], 'one undo entry and the toast with 再生して確認: %r' % r)
    f.check(abs(r['time'] - max(0, r['t0'] - 2)) < 0.05, 'finishing seeks 2 s before the first marked line: %r' % r)
    await page.click('.toast .toast-act')
    await f.until('() => window.__mv.view.state.playing', '再生して確認 plays')
    await page.evaluate('() => window.__mv.pause()')
    await f.undo_all(done0, doc0)
    await page.evaluate('() => { const a = window.__mv; a.closePanel(); a.clearSong(); }')
    await f.settle(2)

    # flows-9: opening a project during a session ends it; nothing is recorded into the opened project.
    await page.evaluate(IO_JS)
    await page.evaluate('() => window.__mv.shell.stage.focus()')
    await page.keyboard.press('t')
    await f.until("() => window.__mv.view.state.mode === 'tap'", 'T starts tap mode')
    await page.keyboard.press('Space')
    await page.wait_for_timeout(300)
    await page.keyboard.press('Space')
    await page.evaluate("async () => { await window.__mv.io.openFiles([window.__project(['ひらいた作品', '二行目', '三行目'], 'open.json')]); }")
    r = await page.evaluate("() => ({ mode: window.__mv.view.state.mode, pins: Object.keys(window.__mv.doc.pins), undo: window.__mv.store.list().length })")
    f.check(r['mode'] == 'normal' and not r['pins'] and r['undo'] == 0, 'opening a project ends the session: %r' % r)
    await page.keyboard.press('Escape')
    r = await page.evaluate("() => ({ pins: Object.keys(window.__mv.doc.pins), undo: window.__mv.store.list().length })")
    f.check(not r['pins'] and r['undo'] == 0, 'and Esc afterwards records nothing: %r' % r)


async def flow_first_look(f, lang):
    """flows-8, spec-3, ux-2, ux-11, ux-12, ux-13, ux-19: typed lyrics get a first look that ◀ returns to; Space after a
    mouse click on おまかせ plays; Ctrl+K Enter on a fresh palette flips no setting; a tempo pin is not a look; Esc that
    closes 詳細 gives focus back; the ? sheet; the preview's name between lines."""
    page = f.page
    await page.click('.le-text')
    await page.keyboard.type('窓をあけて光を入れる')
    await page.keyboard.press('Enter')
    await page.keyboard.type('まだ眠い街におはよう')
    await f.until('() => window.__mv.plan && window.__mv.plan.lines.length === 2', 'typed lyrics are planned')
    s0 = await f.state()
    f.check(s0['looks'] == 0, 'typing records no look yet (%d)' % s0['looks'])
    await page.evaluate('() => window.__mv.shell.stage.focus()')
    await page.keyboard.press('r')
    await f.until('(s) => window.__mv.doc.look.seed !== s', 'R changes the look', s0['seed'])
    s1 = await f.state()
    f.check(s1['looks'] == 2 and s1['hist'], 'the typed look is recorded before the おまかせ one: %r' % [s1['looks'], s1['hist']])
    await page.keyboard.press('[')
    await f.until('(s) => window.__mv.doc.look.seed === s', '[ goes back to the typed look', s0['seed'])
    s2 = await f.state()
    f.check((s2['seed'], s2['moodSeed']) == (s0['seed'], s0['moodSeed']), '◀ restores seed and moodSeed: %r' % [s2['seed'], s2['moodSeed']])

    # spec-3: Space after a mouse click on おまかせ plays instead of running おまかせ again.
    await page.click('.omakase')
    await f.until('(s) => window.__mv.doc.look.seed !== s', 'the click runs おまかせ', s2['seed'])
    seed = (await f.state())['seed']
    await page.keyboard.press('Space')
    await f.until('() => window.__mv.view.state.playing', 'Space plays after a click on おまかせ')
    f.check((await f.state())['seed'] == seed, 'Space did not run おまかせ again')
    await page.keyboard.press('Space')
    await f.until('() => !window.__mv.view.state.playing', 'Space pauses again')
    # Keyboard focus keeps Space as activation: Tab onto おまかせ, Space runs it.
    await page.evaluate('() => window.__mv.shell.stage.focus()')
    for _ in range(40):
        if await page.evaluate("() => document.activeElement.classList.contains('omakase')"):
            break
        await page.keyboard.press('Tab')
    if f.check(await page.evaluate("() => document.activeElement.classList.contains('omakase')"), 'Tab reaches おまかせ'):
        await page.keyboard.press('Space')
        await f.until('(s) => window.__mv.doc.look.seed !== s', 'Space on a keyboard-focused おまかせ runs it', seed)
        f.check(not await page.evaluate('() => window.__mv.view.state.playing'), 'and does not play')

    # ux-2: a fresh palette (no recent commands) and Enter flips no setting.
    prefs0 = await page.evaluate('() => JSON.stringify(window.__mv.view.state.prefs)')
    await page.evaluate("() => { try { localStorage.removeItem('mojipv.palette.recent'); } catch (e) {} window.__mv.shell.stage.focus(); }")
    await page.keyboard.press('Control+k')
    await f.until('() => window.__mv.paletteOpen', 'Ctrl+K opens the palette')
    first = await page.evaluate("() => window.__mv.palette.items()[0]")
    await page.keyboard.press('Enter')
    f.check(await page.evaluate('() => JSON.stringify(window.__mv.view.state.prefs)') == prefs0, 'Ctrl+K, Enter flips no setting (first row %r)' % first)

    # ux-11: a tempo pin is not a look choice; step ③'s dot stays todo on a fresh look history.
    await page.evaluate("""() => { const a = window.__mv; a.store.setSide((s) => Object.assign({}, s, { looks: { list: [], cap: 50 } }));
      a.dispatch({ t: 'pin.set', path: 'work:bpm', v: 120, by: 'user' }, { label: ['undo.tempo', {}] }); }""")
    status = await page.evaluate("() => document.querySelector('.step-tab[data-step=\"look\"]').dataset.status")
    f.check(status == 'todo', 'a tempo pin leaves ③ todo: %r' % status)
    await page.evaluate("() => window.__mv.dispatch({ t: 'pin.set', path: 'work:mood', v: window.__mv.plan.look.mood.v, by: 'user' }, { label: ['undo.pin', {}] })")
    status = await page.evaluate("() => document.querySelector('.step-tab[data-step=\"look\"]').dataset.status")
    f.check(status == 'done', 'a mood pin makes ③ done: %r' % status)

    # ux-12: Esc that closes 詳細 from inside it gives focus back to what opened it (never <body>).
    await page.evaluate("() => { window.__mv.select({ level: 'work' }, { from: 'key' }); window.__mv.shell.stage.focus(); }")
    await page.keyboard.press('i')
    await f.until("() => window.__mv.view.state.panel === 'details'", 'I opens 詳細')
    inside = '[data-mount="inspector"] button:not([disabled])'
    await f.until('(q) => !!document.querySelector(q)', 'the inspector shows its buttons', inside)
    await page.focus(inside)
    await page.keyboard.press('Escape')
    await f.until('() => !window.__mv.view.state.panel', 'Esc at 全体 closes 詳細')
    focus = await page.evaluate('() => document.activeElement.className')
    f.check('canvas-wrap' in focus, 'focus returns to the stage that opened 詳細: %r' % focus)
    await page.click('.hbtn[data-act="panel.details"]')
    await f.until("() => window.__mv.view.state.panel === 'details'", 'the header opens 詳細')
    await page.click('.panelbox [data-act="panel.close"]')
    await f.until('() => !window.__mv.view.state.panel', '× closes 詳細')
    focus = await page.evaluate("() => document.activeElement.dataset.act || document.activeElement.className")
    f.check(focus == 'panel.details', 'after ×, focus is on the header toggle that opened it: %r' % focus)

    # ux-13: the ? sheet lists 3秒移動 once and states the look rule (§6.6).
    r = await page.evaluate("""async () => { const a = window.__mv; a.dialogs.keys(); await new Promise((r) => setTimeout(r, 50));
      const d = document.querySelector('dialog.dlg'); const text = d ? d.innerText : '';
      const rows = [...(d ? d.querySelectorAll('.key-cmd') : [])].map((x) => x.textContent);
      if (d) d.querySelector('.dlg-head .icon-btn').click();
      return { seek: rows.filter((x) => x === a.t('cmd.tap.seek')).length, rule: text.includes(a.t('look.rule')) }; }""")
    f.check(r == {'seek': 1, 'rule': True}, 'the ? sheet: one 3秒移動 row and the look rule: %r' % r)

    # ux-19: between lines the preview's name says so; the idle card's text is for an empty work only.
    await page.evaluate('() => window.__mv.seek(0)')
    await page.wait_for_timeout(600)
    label = await page.evaluate("() => document.querySelector('.canvas-wrap').getAttribute('aria-label')")
    gap = await page.evaluate("() => window.__mv.t('a11y.previewGap', { time: '' }).split('（')[0].split(' (')[0]")
    empty = await page.evaluate("() => window.__mv.t('empty.preview')")
    f.check(label != empty and label.startswith(gap), 'the lead-in is named as a gap: %r' % label)


async def flow_preview(f, lang):
    """ux-3, perf-5, perf-6: with reduced motion the first paste parks on line 1's hero frame (lyrics visible); on a HiDPI
    screen the backing short side is ≤ 1080, ≤ 720 while the adaptive preview is at level ≥ 3; なめらか優先 applies at
    once; 軽量表示 shows while the preview is below full quality; きれい優先 never steps down."""
    url = app_url(f, '?fresh=1&test=1')
    page = await extra_page(f, url, reduced_motion='reduce')
    await page.evaluate("(t) => { const a = window.__mv; a.dispatch({ t: 'lyrics.set', text: t }, { label: ['undo.paste', {}] }); a.store.seal(); a.firstRun(); }", LYRICS)
    await page.wait_for_function('() => window.__mv.plan && window.__mv.plan.lines.length > 3')
    await page.wait_for_timeout(400)
    r = await page.evaluate("""() => { const a = window.__mv, l = a.plan.lines[0], c = a.plan.cuts.find((x) => x.key === l.cuts[0]);
      return { time: a.view.state.time, repT: c.repT, playing: a.view.state.playing,
        text: a.engine.boxes().filter((b) => b.owner === 'text' && b.line === l.id).length }; }""")
    f.check(not r['playing'] and abs(r['time'] - r['repT']) < 1e-6, 'reduced motion: parked on line 1\'s hero frame: %r' % r)
    f.check(r['text'] > 0, 'line 1 is drawn on the parked frame: %r' % r)
    await close_extra(f, page)

    page = await extra_page(f, url, device_scale_factor=2)
    await page.evaluate("(t) => { const a = window.__mv; a.view.setPref('autoplay', false); a.dispatch({ t: 'lyrics.set', text: t }, { label: ['undo.paste', {}] }); a.firstRun(); }", LYRICS)
    await page.wait_for_function('() => window.__mv.plan && window.__mv.plan.lines.length > 3')
    size = """() => { const c = document.querySelector('.canvas-main'), r = c.getBoundingClientRect();
      return { w: c.width, h: c.height, cw: Math.round(r.width), ch: Math.round(r.height), level: window.__mv.engine.stats().level,
        light: !document.querySelector('.stage-light').hidden }; }"""
    frames = "(n) => new Promise((r) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : r()); f(); })"
    render = "async (lv) => { const a = window.__mv; if (lv !== null) a.engine.setLevel(lv); a.shell.stage.invalidate(); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }"
    await page.evaluate(render, None)
    s0 = await page.evaluate(size)
    f.check(min(s0['w'], s0['h']) <= 1080 and s0['w'] > s0['cw'], 'HiDPI auto: sharper than CSS, short side ≤ 1080: %r' % s0)
    await page.evaluate(render, 3)
    await page.evaluate(frames, 3)
    s3 = await page.evaluate(size)
    f.check(min(s3['w'], s3['h']) <= 720 and (s3['cw'], s3['ch']) == (s0['cw'], s0['ch']), 'level ≥ 3: backing ≤ 720p, same CSS size: %r' % s3)
    f.check(s3['light'], '軽量表示 shows at level ≥ 1: %r' % s3)
    await page.evaluate(render, 0)
    await page.evaluate(frames, 3)
    s = await page.evaluate(size)
    f.check((s['w'], s['h']) == (s0['w'], s0['h']) and not s['light'], 'back at level 0: full backing, no badge: %r' % s)
    await page.evaluate("() => window.__mv.view.setPref('quality', 'smooth')")
    await page.evaluate(frames, 2)
    s = await page.evaluate(size)
    f.check(s['w'] < s0['w'] and s['h'] < s0['h'], 'なめらか優先 shrinks the backing at once: %r → %r' % (s0, s))
    await page.evaluate("() => window.__mv.view.setPref('quality', 'sharp')")
    await page.evaluate(render, 4)
    await page.evaluate(frames, 3)
    s = await page.evaluate(size)
    f.check(s['level'] == 0 and not s['light'] and (s['w'], s['h']) == (s0['cw'] * 2, s0['ch'] * 2), 'きれい優先: level 0, full DPR, no badge: %r' % s)
    await page.evaluate("() => window.__mv.view.setPref('quality', 'auto')")
    await close_extra(f, page)


async def flow_song_step(f, lang):
    """ux-9, ux-10: step ② without a song says why 拍に合わせる is off, and looks off; a file that does not decode names
    itself and the formats, on its own line, with 曲がなくても作れます kept below."""
    page = f.page
    await with_lyrics(f)
    await page.evaluate("() => window.__mv.goStep('song')")
    await f.settle(2)
    r = await page.evaluate("""() => { const row = document.querySelector('[data-ctl="snap"]'), why = document.querySelector('.snap-why');
      return { disabled: row.querySelector('input').disabled, opacity: getComputedStyle(row).opacity, why: why && !why.hidden ? why.textContent : null,
        placeholder: document.querySelector('[data-ctl="tempo"] input').placeholder, reason: window.__mv.t('song.snapNeedsBpm'), none: window.__mv.t('song.tempoNone') }; }""")
    f.check(r['disabled'] and float(r['opacity']) <= 0.55 and r['why'] == r['reason'], 'the disabled snap row looks off and says why: %r' % r)
    f.check(r['placeholder'] == r['none'] and any(ch.isdigit() for ch in r['placeholder']), 'the tempo field shows an example, not a value: %r' % r)
    await page.evaluate("() => window.__mv.loadSong(new File([new Uint8Array(2048).fill(7)], 'broken.mp3', { type: 'audio/mpeg' }))")
    await f.until("() => !!document.querySelector('.song-box .inline-error.stacked')", 'the decode error shows')
    r = await page.evaluate("""() => { const box = document.querySelector('.song-box .inline-error'), text = box.querySelector('.inline-error-text span');
      return { text: text.textContent, width: text.getBoundingClientRect().width, boxWidth: box.getBoundingClientRect().width,
        buttonBelow: box.querySelector('.btn').getBoundingClientRect().top >= text.getBoundingClientRect().bottom - 1,
        note: [...document.querySelectorAll('.song-box .note')].map((x) => x.textContent), none: window.__mv.t('song.none') }; }""")
    f.check('broken.mp3' in r['text'] and 'flac' in r['text'], 'the message names the file and the formats: %r' % r['text'])
    f.check(r['width'] >= r['boxWidth'] * 0.7 and r['buttonBelow'], 'the message has the width, the button is under it: %r' % r)
    f.check(r['none'] in r['note'], '曲がなくても作れます stays under the box: %r' % r['note'])


# --- release check -------------------------------------------------------------------------------------------------------

STORED_AI_KEYS = """() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => /^mojipv\\.ai\\.(key|ok)\\./.test(k)).sort()"""
MENU_ROWS = """() => [...document.querySelectorAll('.popover.menu > *')].map((x) => x.classList.contains('menu-heading') ? '#' + x.textContent
  : (x.querySelector('.menu-label') || x).textContent)"""


async def flow_clear_device(f, lang):
    """Privacy (release check): ≡ › 設定 › この端末に保存した作品と曲を消す asks first, with the focus on キャンセル (Enter
    keeps everything); 消す empties both IndexedDB stores (works and songs) and removes every AI key from session and local
    storage; an empty work takes the open work's place and nothing is written until it changes; the next change is
    autosaved again. A newer project file is named in the error."""
    page = f.page
    t = lambda key, params=None: page.evaluate('([k, p]) => window.__mv.t(k, p || {})', [key, params])  # noqa: E731
    await page.evaluate(IO_JS)
    await page.evaluate(AI_WAV_JS)
    await page.evaluate("(x) => window.__mv.dispatch({ t: 'lyrics.set', text: x }, { label: ['undo.paste', {}] })", '[ti:消す前の作品]\n窓をあけて')
    sha = await page.evaluate("async () => { const a = window.__mv; await a.loadSong(window.__wav(2, 'keep.wav')); await a.io.flush(); return a.doc.song.sha1; }")
    await page.evaluate("""() => { const ai = window.__mv.ai;
      ai.setRemember(true); ai.setKey('AIza' + 'x'.repeat(35));
      sessionStorage.setItem('mojipv.ai.key.claude', 'sk-ant-' + 'y'.repeat(40)); }""")
    before = await page.evaluate('() => window.__idb()')
    keys = await page.evaluate(STORED_AI_KEYS)
    f.check(len(before['works']) == 1 and sha in before['songs'] and len(keys) == 2, 'a work, its song and two keys are stored: %r %r' % (before, keys))

    label = await t('cmd.file.clearDevice')
    for answer in ('cancel', 'ok'):
        await page.click('[data-act="menu.open"]')
        await f.until("() => !!document.querySelector('.popover.menu')", 'the ≡ menu opens')
        rows = await page.evaluate(MENU_ROWS)
        settings, helpHead = '#' + await t('menu.settings'), '#' + await t('menu.help')
        f.check(label in rows and settings in rows and rows.index(settings) < rows.index(label) < rows.index(helpHead),
                'the entry sits under 設定: %r' % rows)
        await page.click('.popover.menu .menu-item:has-text("%s")' % label)
        await f.until("() => !!document.querySelector('dialog.dlg[open] .btn.danger')", 'it asks first (%s)' % answer)
        text = await page.evaluate("() => document.querySelector('dialog.dlg[open] .dlg-text').textContent")
        f.check(text == await t('clear.text'), 'the question says what goes: %r' % text)
        if answer == 'ok':
            await page.click('dialog.dlg[open] .btn.danger')
        else:                                                # the focus starts on キャンセル: Enter alone never deletes
            focus = await page.evaluate("() => document.activeElement.matches('dialog.dlg[open] .dlg-actions .btn:not(.danger)')")
            f.check(focus, 'the question starts with the focus on キャンセル')
            await page.keyboard.press('Enter')
        await f.until("() => !document.querySelector('dialog.dlg')", 'the question closes (%s)' % answer)
        if answer == 'cancel':
            await page.wait_for_timeout(200)
            idb = await page.evaluate('() => window.__idb()')
            f.check(idb == before and await page.evaluate(STORED_AI_KEYS) == keys, 'キャンセル keeps everything: %r' % idb)
            f.check(await page.evaluate('() => window.__mv.doc.sheet.rows.length') == 2, 'the open work stays open')

    done = await t('clear.done')
    await f.until('(d) => [...document.querySelectorAll(".toast-text")].some((x) => x.textContent === d)', 'it says it is done', done)
    r = await page.evaluate("""async () => { const a = window.__mv;
      return { idb: await window.__idb(), rows: a.doc.sheet.rows.length, song: a.doc.song, key: a.ai.state.key, status: a.ai.state.keyStatus,
        save: a.io.state(), header: document.querySelector('.save-state').textContent, undo: a.store.list().filter((e) => e.done).length }; }""")
    f.check(r['idb'] == {'songs': [], 'works': []}, 'both IndexedDB stores are empty: %r' % r['idb'])
    f.check(await page.evaluate(STORED_AI_KEYS) == [] and r['key'] == '' and r['status'] == 'unset', 'every AI key is gone: %r' % r)
    f.check(r['rows'] == 0 and r['song'] is None and r['undo'] == 0, 'an empty work is open, with no history: %r' % r)
    f.check(r['save'] == 'idle' and r['header'] == '', 'nothing claims to be saved: %r' % r)
    await page.wait_for_timeout(1400)                                   # longer than the autosave delay
    f.check((await page.evaluate('() => window.__idb()'))['works'] == [], 'the empty work is not written before it changes')
    await page.evaluate("(x) => window.__mv.dispatch({ t: 'lyrics.set', text: x }, { label: ['undo.paste', {}] })", '新しい行')
    await page.evaluate('async () => { await window.__mv.io.flush(); }')
    works = (await page.evaluate('() => window.__idb()'))['works']
    f.check([w['rows'] for w in works] == [['新しい行']], 'the next change is autosaved again: %r' % works)

    # err.file.newer names the file that was not opened.
    r = await page.evaluate("""async () => { const a = window.__mv, f = JSON.parse(window.__projectText(['未来の歌']));
      f.schema = 99;
      await a.io.openFiles([new File([JSON.stringify(f)], 'mirai.json', { type: 'application/json' })]);
      return { rows: a.doc.sheet.rows.map((x) => x.src), toasts: [...document.querySelectorAll('.toast-text')].map((x) => x.textContent) }; }""")
    newer = await t('err.file.newer', {'name': 'mirai.json'})
    f.check('mirai.json' in newer and newer in r['toasts'] and r['rows'] == ['新しい行'], 'a newer file is named and not opened: %r' % r)


# --- v2.1 (package F): curves, keyframes, areas, area instructions, the board, マイ素材 (DESIGN_2_1 §6, §7.4) -------------

V21_TEXT = (ROOT / 'tests' / 'fixtures' / 'project_v21.json').read_text(encoding='utf-8')
PIN_V = "(p) => { const x = window.__mv.doc.pins[p]; return x ? { v: x.v, by: x.by } : null; }"
CURVE_SEL = ROW % 'arrive.ease' + ' select.cw-select'


async def open_v21(f):
    """Opens the v21 fixture (song sections, materials, camera and curve pins, a board draft) as a project."""
    await f.page.evaluate("""async (text) => { const a = window.__mv; a.view.setPref('autoplay', false);
      await a.io.openFiles([new File([text], 'v21.json', { type: 'application/json' })]); a.pause(); }""", V21_TEXT)
    await f.until('() => window.__mv.plan && window.__mv.plan.lines.length === 9', 'the v21 project opens')
    await f.settle(2)
    return await f.page.evaluate(DONE), await f.page.evaluate(DOC)


async def handle_point(f, i):
    """The CSS centre of curve handle i of the 緩急 row (scrolled into view)."""
    await f.page.evaluate("(sel) => document.querySelector(sel).closest('.frow').scrollIntoView({ block: 'center' })", CURVE_SEL)
    await f.settle(2)
    return await f.page.evaluate("""([sel, i]) => { const row = document.querySelector(sel).closest('.w-curve');
      const b = row.querySelectorAll('.cw-h')[i]; if (!b) return null; const r = b.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }""", [CURVE_SEL, i])


async def flow_curve(f, lang):
    """緩急 (DESIGN_2_1 §6.6): a preset from the select; dragging a handle turns it custom as one undo entry; keyboard only:
    the arrows move a handle (one entry per field), Enter adds and Delete removes a speed step, Esc returns to the select;
    かんたん's slider; 自動 unpins. Undo-all returns to the start."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    lid = await page.evaluate('() => window.__mv.plan.lines[1].id')
    path = 'line/%s:arrive.ease' % lid
    await open_line(f, lid)
    if not await f.until('(s) => !!document.querySelector(s)', 'the 緩急 row has the curve widget', CURVE_SEL):
        return
    # A preset from the select: one undo entry, the pin names it.
    done = await page.evaluate(DONE)
    await page.select_option(CURVE_SEL, 'softEnds')
    await f.until('(p) => !!window.__mv.doc.pins[p]', 'the preset is pinned', path)
    f.check((await page.evaluate(PIN_V, path)) == {'v': 'softEnds', 'by': 'user'}, 'the preset is pinned by the user')
    f.check(await page.evaluate(DONE) == done + 1, 'a preset is one undo entry')
    await f.settle(3)
    await f.shot('curve_preset')
    # Mouse: dragging a Bézier handle turns the preset into its data (custom) within one undo entry.
    pt = await handle_point(f, 1)
    if not f.check(pt is not None, 'the Bézier has handles'):
        return
    done = await page.evaluate(DONE)
    await page.mouse.move(pt['x'], pt['y'])
    await page.mouse.down()
    for i in range(1, 6):
        await page.mouse.move(pt['x'] - i * 4, pt['y'] + i * 2)
    await page.mouse.up()
    await f.settle(2)
    v = (await page.evaluate(PIN_V, path))['v']
    f.check(isinstance(v, dict) and 'bz' in v and v['bz'][2] < 0.4, 'the drag pins a custom Bézier: %r' % v)
    f.check(await page.evaluate(DONE) == done + 1, 'the drag is one undo entry')
    f.check(await page.evaluate('(s) => document.querySelector(s).value', CURVE_SEL) == 'custom', 'the select reads カスタム')
    # Keyboard only: a speed-step preset, Tab to a handle, ↑ ×3 (one entry), Enter adds a step, Delete removes it, Esc.
    await page.focus(CURVE_SEL)
    await page.select_option(CURVE_SEL, 'hushRushHush')
    await f.until('(p) => JSON.stringify(window.__mv.doc.pins[p].v) === \'"hushRushHush"\'', 'the speed-step preset', path)
    await f.settle(2)
    await page.focus(CURVE_SEL)
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    on_handle = await page.evaluate("() => document.activeElement.classList.contains('cw-h') ? Number(document.activeElement.dataset.i) : -1")
    if not f.check(on_handle == 1, 'Tab reaches the second handle: %r' % on_handle):
        return
    done = await page.evaluate(DONE)
    for _ in range(3):
        await page.keyboard.press('ArrowUp')
    await f.settle(2)
    v = (await page.evaluate(PIN_V, path))['v']
    f.check(isinstance(v, dict) and abs(v['sp'][1][1] - 0.33) < 1e-6, '↑ ×3 raises the step by 0.03: %r' % v)
    f.check(await page.evaluate(DONE) == done + 1, 'the arrow steps merge into one undo entry')
    await page.keyboard.press('Enter')
    await f.settle(2)
    n = len((await page.evaluate(PIN_V, path))['v']['sp'])
    f.check(n == 7, 'Enter adds a speed step: %d' % n)
    await page.keyboard.press('Delete')
    await f.settle(2)
    pin = await page.evaluate(PIN_V, path)
    f.check(pin is not None and len(pin['v']['sp']) == 6, 'Delete removes the step, not the pin: %r' % pin)
    await page.keyboard.press('Escape')
    f.check(await page.evaluate("(s) => document.activeElement === document.querySelector(s)", CURVE_SEL), 'Esc returns to the select')
    # かんたん: the default ramp; ← on the length slider (keyboard) shortens the slow part.
    await page.select_option(CURVE_SEL, 'simple')
    await f.until("(p) => { const x = window.__mv.doc.pins[p]; return !!x && !!x.v.ramp; }", 'かんたん pins a ramp', path)
    await f.settle(2)
    edge = ROW % 'arrive.ease' + ' .cw-simple input[type="range"]'
    await page.focus(edge)
    await page.keyboard.press('ArrowLeft')
    await f.settle(2)
    ramp = (await page.evaluate(PIN_V, path))['v']['ramp']
    f.check(abs(ramp['edge'] - 0.09) < 1e-6 and ramp['ends'] == 'both' and ramp['peak'] == 6, 'the slider edits the ramp: %r' % ramp)
    await f.shot('curve_simple')
    # 自動 unpins.
    await page.select_option(CURVE_SEL, 'auto')
    await f.until('(p) => !window.__mv.doc.pins[p]', '自動 unpins', path)
    await f.undo_all(done0, doc0)


# engine.shotTrack / engine.viewAt (package B) as tests/helpers/fake_engine.js has them, installed on the page's engine
# only while it has none (a build without the engine's camera): one track key per key of the shot being edited, spread
# over the cut, each aiming a little further right. The engine has them since B, so this stands aside ('engine').
FAKE_TRACK = """() => {
  const a = window.__mv, e = a.engine;
  if (typeof e.shotTrack === 'function') return 'engine';
  try {
    e.shotTrack = (cutKey) => {
      const cut = a.plan.cuts.find((c) => c.key === cutKey), n = a.shotEdit ? a.shotEdit.keys().length : 2;
      if (!cut) return null;
      const d = a.plan.design, keys = [];
      for (let i = 0; i < n; i++) {
        const aim = { x: d.w * (0.1 + 0.2 * i), y: d.h * 0.4, w: d.w * 0.2, h: d.h * 0.2 };
        keys.push({ t: cut.a + (cut.b - cut.a) * i / Math.max(1, n - 1), x: 0, y: 0, zoom: 1 + 0.1 * i, roll: 0, aim });
      }
      return { a: cut.a, b: cut.b, keys };
    };
    e.viewAt = () => ({ x: 0, y: 0, zoom: 1, roll: 0 });
    return 'fake';
  } catch (err) { return 'frozen'; }
}"""
KEYS_STATE = """(p) => { const a = window.__mv, pin = a.doc.pins[p], rows = document.querySelectorAll('.ke-page .ke-row');
  return { pin: pin ? pin.v : null, by: pin ? pin.by : null, rows: rows.length, times: a.shotEdit ? a.shotEdit.times().length : 0,
    marks: a.shotEdit ? a.shotEdit.marks().length : 0, reset: !!document.querySelector('.ke-reset:not([disabled])') }; }"""


async def flow_keyframes(f, lang):
    """カメラワーク and キーフレーム (DESIGN_2_1 §6.5, §6.7): a preset from the shot picker; キーフレームを編集… lists its keys;
    editing a row pins the whole shot as custom (one undo entry each); + adds and × removes a key; a marker dragged on the
    preview places its key (one entry); a timeline ◆ dragged moves its key (one entry); プリセットに戻す clears the pin. The
    keyboard-only variant opens the page with Enter and edits とき with the arrows."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    info = await page.evaluate("() => { const a = window.__mv, l = a.plan.lines[2]; return { key: l.cuts[0], id: l.id }; }")
    scope = 'cut/' + info['key']
    await page.evaluate("(s) => window.__mv.select({ level: 'el', scope: s, el: 'lens' }, { from: 'crumbs', open: true, seek: true })", scope)
    await f.until("() => window.__mv.view.state.panel === 'details'", '詳細 opens on the camera page')
    await f.settle(3)
    if not await f.until('(s) => !!document.querySelector(s)', 'the カメラワーク row', ROW % 'cam.shot' + ' .w-shot'):
        return
    await page.click(ROW % 'cam.shot' + ' .w-shot')
    if not await f.until("() => !!document.querySelector('.pb-tile[data-key=\"pushWord\"]')", 'the shot picker lists the presets'):
        return
    await f.shot('shots')
    await page.click('.pb-tile[data-key="pushWord"]')
    path = scope + ':cam.shot'
    await f.until('(p) => !!window.__mv.doc.pins[p]', 'picking a shot pins it', path)
    f.check((await page.evaluate(PIN_V, path)) == {'v': 'pushWord', 'by': 'user'}, 'the shot is pinned at the cut')
    await f.settle(2)
    await page.click('[data-custom="camKeys"] button')
    if not await f.until("() => document.querySelectorAll('.ke-page .ke-row').length > 0", 'the keyframe page opens'):
        return
    how = await page.evaluate(FAKE_TRACK)
    await page.evaluate("() => window.__mv.bus.emit('shotEdit')")
    await f.settle(3)
    st = await page.evaluate(KEYS_STATE, path)
    n0 = st['rows']
    f.check(n0 >= 2 and st['times'] == n0, 'one row and one ◆ per key: %r' % st)
    await f.shot('keyframes')
    # A row edit: key ① at 割合 → the whole shot is pinned as custom by the user; one undo entry.
    done = await page.evaluate(DONE)
    await page.select_option('.ke-row[data-i="0"] .ke-sel >> nth=0', 'frac')
    await f.until('(p) => { const x = window.__mv.doc.pins[p]; return !!x && typeof x.v === "object"; }', 'the edit pins a custom shot', path)
    st = await page.evaluate(KEYS_STATE, path)
    f.check(st['by'] == 'user' and isinstance(st['pin']['keys'][0]['at'], (int, float)) and st['reset'], 'key ① gets a number at: %r' % st)
    f.check(await page.evaluate(DONE) == done + 1, 'a row edit is one undo entry')
    await page.click('.ke-add')
    await f.until('(n) => document.querySelectorAll(".ke-page .ke-row").length === n + 1', '+ キーを足す adds a row', n0)
    await page.click('.ke-row[data-i="%d"] .ke-remove' % n0)
    await f.until('(n) => document.querySelectorAll(".ke-page .ke-row").length === n', '× removes it', n0)
    # The markers on the preview (engine.shotTrack of package B; FAKE_TRACK stands aside): drag ② = 位置 自由, one entry.
    f.check(how == 'engine', 'the engine gives the shot track itself: %s' % how)
    await page.evaluate("(t) => window.__mv.seek(t)", await page.evaluate("(k) => { const c = window.__mv.plan.cuts.find((x) => x.key === k); return (c.a + c.b) / 2; }", info['key']))
    await f.settle(3)
    st = await page.evaluate(KEYS_STATE, path)
    if f.check(st['marks'] == st['rows'], 'one marker per key: %r' % st):
        pt = await page.evaluate("""() => { const a = window.__mv, m = a.shotEdit.marks()[1], d = a.plan.design;
          const r = document.querySelector('.canvas-wrap').getBoundingClientRect();
          return { x: r.left + m.x / d.w * r.width, y: r.top + m.y / d.h * r.height }; }""")
        done = await page.evaluate(DONE)
        await page.mouse.move(pt['x'], pt['y'])
        await page.mouse.down()
        for i in range(1, 7):
            await page.mouse.move(pt['x'] + i * 12, pt['y'] - i * 4)
        await page.mouse.up()
        await f.settle(2)
        k1 = (await page.evaluate(PIN_V, path))['v']['keys'][1]
        want = await page.evaluate("""(p) => { const d = window.__mv.plan.design, r = document.querySelector('.canvas-wrap').getBoundingClientRect();
          return Math.round(Math.max(-0.4, Math.min(0.4, ((p.x - r.left) / r.width * d.w - d.w / 2) / d.w)) * 1000) / 1000; }""",
                                   {'x': pt['x'] + 72, 'y': pt['y'] - 24})
        f.check('oy' in k1 and abs(k1.get('ox', 9) - want) < 0.002, 'the marker drag places key ② where it is dropped: %r (ox %r)' % (k1, want))
        f.check(await page.evaluate(DONE) == done + 1, 'the marker drag is one undo entry')
        f.check(await page.evaluate("() => window.__mv.view.state.sel.level") == 'el', 'the drag does not change the selection')
    # The ◆ of key ② on the timeline: a drag gives it a number at (one entry).
    await page.keyboard.press('Shift+T') if not await page.evaluate('() => window.__mv.view.state.drawer') else None
    await f.until('() => window.__mv.view.state.drawer', 'the timeline drawer opens')
    await f.settle(3)
    pt = await page.evaluate("""() => { const a = window.__mv, tl = a.timeline, m = a.shotEdit.times()[1];
      const r = document.querySelector('.tl-canvas').getBoundingClientRect(), rows = tl.rows();
      return { x: r.left + tl.xOf(m.t), y: r.top + (rows.cut[0] + rows.cut[1]) / 2 }; }""")
    done = await page.evaluate(DONE)
    await page.mouse.move(pt['x'], pt['y'])
    await page.mouse.down()
    for i in range(1, 5):
        await page.mouse.move(pt['x'] - i * 5, pt['y'])
    await page.mouse.up()
    await f.settle(2)
    at = (await page.evaluate(PIN_V, path))['v']['keys'][1]['at']
    f.check(isinstance(at, (int, float)), 'the ◆ drag gives key ② a number at: %r' % at)
    f.check(await page.evaluate(DONE) == done + 1, 'the ◆ drag is one undo entry')
    # プリセットに戻す: the pin goes (the cut shows its inherited or automatic shot again).
    await page.click('.ke-reset')
    await f.until('(p) => !window.__mv.doc.pins[p]', 'プリセットに戻す clears the pin', path)
    # Keyboard only: Esc from the page back to the camera page, Enter on キーフレームを編集…, ↓ on ① とき.
    await page.focus('.ke-add')
    await page.keyboard.press('Escape')
    await f.until("() => !document.querySelector('.ke-page')", 'Esc leaves the keyframe page')
    await f.until("() => document.activeElement && document.activeElement.closest('[data-custom=\"camKeys\"]')", 'the focus returns to its button')
    await page.keyboard.press('Enter')
    await f.until("() => !!document.querySelector('.ke-page .ke-sel')", 'Enter opens the keyframe page')
    f.check(await page.evaluate("() => document.activeElement.classList.contains('ke-sel')"), 'the focus starts on ① とき')
    done = await page.evaluate(DONE)
    await page.keyboard.press('ArrowDown')
    await f.until('(p) => !!window.__mv.doc.pins[p]', '↓ on とき pins a custom shot', path)
    f.check(await page.evaluate(DONE) == done + 1, 'one undo entry')
    await f.undo_all(done0, doc0)


# The area bands of the drawer (planner/areas.bands) with their CSS rectangles, and the selection's area.
BANDS = """() => { const a = window.__mv, AR = MV.use('planner/areas'), F = MV.use('ui/fields'), tl = a.timeline;
  const r = document.querySelector('.tl-canvas').getBoundingClientRect(), rows = tl.rows();
  return AR.bands(a.doc, a.plan).map((b) => { const area = AR.resolve(a.doc, a.plan, b.ref);
    return { key: b.key, ids: area.lineIds, title: F.areaTitle(a.t, area), x: r.left + (tl.xOf(b.t0) + tl.xOf(b.t1)) / 2,
      y: r.top + (rows.song[0] + rows.song[1]) / 2, t: (b.t0 + b.t1) / 2 }; }); }"""
# The play bar's lane at a time: the colour of its band strip (the top fifth) and of the cut blocks, and a point on the
# strip to click (DESIGN_2_1 §6.8).
LANE_AT = """(tt) => { const c = document.querySelector('.lane-canvas'), a = window.__mv, g = c.getContext('2d');
  const d = a.plan.duration, x = Math.min(c.width - 1, Math.max(0, Math.round(tt / d * c.width)));
  const px = (y) => Array.from(g.getImageData(x, y, 1, 1).data.slice(0, 3)), r = c.getBoundingClientRect();
  return { band: px(Math.round(c.height * 0.08)), cut: px(Math.round(c.height * 0.5)),
    client: { x: r.left + tt / d * r.width, y: r.top + r.height * 0.08 } }; }"""
LANE_ON = [226, 85, 59]           # ui/playbar: the selected area's band, and a highlighted or selected cut
SEL_AREA = """() => { const a = window.__mv, s = a.view.state.sel, AR = MV.use('planner/areas');
  const t = document.querySelector('[data-mount="inspector"] .lh-title');
  return { level: s.level, ids: s.ids || null, area: s.area ? AR.keyOf(s.area) : null, title: t ? t.textContent : null,
    panel: a.view.state.panel, rig: !!document.querySelector('[data-mount="inspector"] .isec[data-sec="rig"]') }; }"""


async def flow_areas(f, lang):
    """区画 (DESIGN_2_1 §6.8): a band of the drawer's 曲 row selects its lines as the area and opens the 行 page with the area
    header 「サビ（3行）」 and 区画のカメラ; the play bar's lane shows the bands and an area highlight, and a double-click on
    its band selects the area; the lyric gutter's heading § does the same; %サビ in Ctrl+K too. Keyboard only:
    ↑ from the first line of the timeline listbox reaches the bands, ↓ moves among them, Enter selects."""
    page = f.page
    await with_lyrics(f)
    await f.blur()
    await page.keyboard.press('Shift+T')
    await f.until('() => window.__mv.view.state.drawer', 'the timeline drawer opens')
    await f.settle(3)
    bands = await page.evaluate(BANDS)
    if not f.check(len(bands) == 2, 'two bands (the headings # Aメロ and # サビ): %r' % bands):
        return
    await page.mouse.click(bands[1]['x'], bands[1]['y'])
    await f.until("() => window.__mv.view.state.panel === 'details'", 'a band click opens 詳細')
    await f.settle(3)
    s = await page.evaluate(SEL_AREA)
    f.check(s['level'] == 'line' and s['ids'] == bands[1]['ids'] and s['area'] == bands[1]['key'], 'the band selects its area: %r' % s)
    f.check(s['title'] == bands[1]['title'] and len(bands[1]['ids']) > 1, 'the 行 page names the area: %r' % s)
    f.check(lang != 'ja' or 'サビ' in s['title'], 'the heading is the area name: %r' % s['title'])
    f.check(s['rig'], '区画のカメラ is offered for an area')
    await f.shot('area_page')
    # The play bar's lane shows the same bands in its top strip, the selected area's in the selection ink; an area
    # highlight (view.highlight as an array of line ids) marks its lines' cuts; a double-click on the strip selects.
    lane = await page.evaluate(LANE_AT, bands[1]['t'])
    other = await page.evaluate(LANE_AT, bands[0]['t'])
    f.check(lane['band'] == LANE_ON, 'the lane marks the selected area band: %r' % lane)
    f.check(other['band'] not in (LANE_ON, [18, 21, 27]), 'the lane draws the other band too: %r' % other)
    f.check(other['cut'] != LANE_ON, 'the other area is not marked: %r' % other)
    await page.evaluate('(ids) => window.__mv.view.set({ highlight: ids })', bands[0]['ids'])
    lit = await page.evaluate(LANE_AT, bands[0]['t'])
    f.check(lit['cut'] == LANE_ON, 'an area highlight marks the cuts of its lines on the lane: %r' % lit)
    await page.evaluate('() => window.__mv.view.set({ highlight: null })')
    await page.mouse.dblclick(other['client']['x'], other['client']['y'])
    await f.settle(2)
    s2 = await page.evaluate(SEL_AREA)
    f.check(s2['area'] == bands[0]['key'] and s2['ids'] == bands[0]['ids'], 'a double-click on a lane band selects its area: %r' % s2)
    # The lyric gutter: § of # Aメロ.
    await page.evaluate("() => window.__mv.select({ level: 'work' }, { from: 'key' })")
    await page.evaluate("() => { window.__mv.view.set({ drawer: false }); window.__mv.goStep('lyrics'); }")
    await f.until("() => !!document.querySelector('.le-g[data-heading]')", 'the gutter shows the headings')
    await f.settle(4)
    await f.shot('gutter')
    await page.click('.le-g[data-heading] >> nth=0')
    await f.settle(2)
    s = await page.evaluate(SEL_AREA)
    f.check(s['area'] == bands[0]['key'] and s['ids'] == bands[0]['ids'], 'the heading § selects its area: %r' % s)
    # Ctrl+K %サビ.
    await f.blur()
    await page.keyboard.press('Control+k')
    await f.until('() => window.__mv.paletteOpen', 'Ctrl+K opens the palette')
    await page.keyboard.type('%' + ('サビ' if lang == 'ja' else ''))
    await f.settle(2)
    await page.keyboard.press('Enter')
    await f.until('(k) => { const s = window.__mv.view.state.sel; return !!s.area && MV.use("planner/areas").keyOf(s.area) === k; }',
                  '%サビ selects the area', bands[1]['key'] if lang == 'ja' else bands[0]['key'])
    # Keyboard only: the timeline listbox leads with the bands.
    await page.evaluate("() => { const a = window.__mv; a.view.set({ drawer: true }); a.select({ level: 'line', ids: [a.plan.lines[0].id] }, { from: 'key' }); }")
    await f.settle(3)
    await page.focus('.tl-proxy')
    await page.keyboard.press('ArrowUp')
    active = await page.evaluate("() => document.querySelector('.tl-proxy').getAttribute('aria-activedescendant')")
    f.check(active == 'tl-band-%d' % (len(bands) - 1), '↑ from the first line reaches the last band: %r' % active)
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await f.settle(2)
    s = await page.evaluate(SEL_AREA)
    f.check(s['area'] == bands[0]['key'], 'Enter selects the focused band: %r' % s)
    label = await page.evaluate("() => document.getElementById('tl-band-0').textContent")
    f.check(bands[0]['title'].split('（')[0] in label or lang != 'ja', 'the band option reads its area: %r' % label)


# A new run ornament in ai/direct's material schema (the §2.1 cherry flurry), used where the brief asks (s 0).
D_FLURRY = {'name': '桜吹雪', 'nameEn': 'Cherry flurry', 'kind': 'ornament', 'scope': 'run', 'season': 'spring', 'tags': ['organic', 'soft'],
            'blurb': '花びらが斜めに舞う', 'base': '', 'params': [], 'parts': [], 'unit': 'glyph', 'order': 'lead', 'dur': -1, 'each': -1,
            'tracks': [], 'curve': d_curve(), 'osc': [], 'knobs': ['count'], 'use': {'slot': 'none', 's': 0, 'lines': [], 'cuts': []},
            'layers': [{'prim': 'particles', 'shape': 'petal', 'glyph': '', 'inks': ['#F4B4C6', 'accent'], 'alpha': 0.85, 'layer': 'near',
                        'anchor': 'frame', 'x': 0, 'y': 0, 'spread': 1.15, 'sizeMin': 0.012, 'sizeMax': 0.022, 'count': 90, 'stroke': 0,
                        'dir': 115, 'speed': 0.09, 'sway': 26, 'swayHz': 0.35, 'spin': 60, 'burst': 'none', 'move': 'none',
                        'moveWhat': 'scale', 'moveAmp': 0, 'moveHz': 0, 'appear': 'always', 'draw': 'fade', 'style': '', 'pattern': '',
                        'stops': [], 'angle': 0}]}
# The song areas of the plan (planner/areas), the review's group headings and what the AI state holds.
SONG_AREAS = """() => { const a = window.__mv, AR = MV.use('planner/areas');
  return AR.areasOf(a.doc, a.plan).song.map((x) => ({ key: x.key, kind: x.songKind, ids: x.lineIds })); }"""
REVIEW_GROUPS = "() => [...document.querySelectorAll('.ai-review .ai-group-head')].map((e) => e.textContent)"
# Whether the current plan puts a part key in a segment's atmosphere, and the paint nodes of a frame the app's engine
# draws in the middle of a line (engine.renderFrame's FrameStats; the atmosphere of a material draws as paints).
PLAN_USES = "(k) => window.__mv.plan.grounds.some((g) => !!g.atmos && g.atmos.v === k)"
PAINTS_AT = """(ids) => { const a = window.__mv, l = a.plan.lines.find((x) => x.id === ids[0]), c = new OffscreenCanvas(320, 180);
  return a.engine.renderFrame({ canvas: c, ctx: c.getContext('2d'), w: 320, h: 180 }, (l.t0 + l.t1) / 2,
    { quality: 'export', pick: false }).drawn.paints; }"""


async def analysed_song(f, answers):
    """A 12 s song, the key, the consent and a faked 曲を分析 saved: the lines fall into イントロ / Aメロ / サビ."""
    page = f.page
    await page.evaluate(AI_WAV_JS)
    ok = await page.evaluate("async () => { await window.__mv.loadSong(window.__wav(12, 'ai.wav')); return window.__mv.songReady(); }")
    if not f.check(ok, 'the song is loaded'):
        return False
    t = await page.evaluate("() => window.__mv.plan.lines.map((l) => l.t0)")
    clock = lambda x: '0:%05.2f' % x  # noqa: E731
    answers.insert(0, {'summary': '明るい曲', 'mood': '軽快', 'bpm': 120, 'highlights': [],
                       'sections': [{'kind': 'intro', 'start': clock(0), 'end': clock(t[0] - 0.05)},
                                    {'kind': 'verse', 'start': clock(t[0] - 0.05), 'end': clock(t[3] - 0.05)},
                                    {'kind': 'chorus', 'start': clock(t[3] - 0.05), 'end': clock(12)}]})
    await ai_route(f, answers)
    await ai_open(f)
    await page.click('.ai-consent input[type="checkbox"]')
    await f.until("() => !document.querySelector('[data-tool=\"analyze\"]').disabled", 'consent enables 曲を分析')
    await page.click('[data-tool="analyze"]')
    if not await f.until("() => window.__mv.ai.state.review && window.__mv.ai.state.review.kind === 'analysis'", 'the analysis review'):
        return False
    await page.click('.ai-review-foot .btn.primary')
    return await f.until("() => { const i = window.__mv.doc.song.info; return !!i && i.sections.length === 3; }", 'the sections are saved')


async def flow_ai_area(f, lang):
    """The §7.4 "area direct" story: a faked analysis gives song sections; 区画▾ › サビ1 shows the target chip; the faked
    answer (a new run-ornament material, speed 0.5, a ramp curve, a custom push-in, a cut and a work change) is a review
    of 4 groups (素材 / 区画 / カット / 区画の外); 試写; apply = one undo step; the material is in マイ素材; undo restores
    materials and pins; redo; selective revert; the material deleted from its page clears its pins."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    answers = []
    if not await analysed_song(f, answers):
        return
    areas = await page.evaluate(SONG_AREAS)
    chorus = next((x for x in areas if x['kind'] == 'chorus'), None)
    if not f.check(chorus and len(chorus['ids']) == 2, 'サビ1 has the last two lines: %r' % areas):
        return
    answers.append({'answers': [d_answer(0, summary='桜が舞う中、ゆっくり文字へ寄ります', all_={
        'atmos': 'mat:桜吹雪', 'speed': 0.5, 'arriveCurve': d_curve('ramp', edge=0.1, peak=6),
        'camera': d_cam(shot='custom', move='pushIn', focus='text', timing='whole')},
        cuts=[{'i': 0, 'j': 1, 'arrange': '', 'arrive': '', 'depart': '', 'lens': '', 'ornaments': [], 'speed': 0.75, 'camera': d_cam()}],
        work={'motion': 0.9})], 'materials': [D_FLURRY]})
    await page.click('.ai-direct [data-target="area"]')
    await f.until("() => !document.querySelector('#ai-area-list').hidden", '区画▾ opens the area list')
    await f.shot('area_list')
    await page.click('#ai-area-list [data-area="%s"]' % chorus['key'])
    chip = await page.evaluate("() => { const c = document.querySelector('.ai-target-chip'); return c && !c.hidden ? c.textContent : null; }")
    f.check(chip and (lang != 'ja' or 'サビ1' in chip), 'the target chip names サビ1: %r' % chip)
    f.check(await page.evaluate("() => document.activeElement.id") == 'ai-direct-text', 'the focus moves to the instruction')
    await page.keyboard.type('桜が舞う中、ゆっくり文字へ寄る')
    await page.click('.ai-chips [data-chip="material"]')
    f.check(await page.is_checked('.ai-direct [data-ctl="allowMaterials"]'), '素材を作る ticks 新しい素材を作ってもよい')
    await page.click('.ai-direct [data-tool="direct"]')
    if not await f.until("() => window.__mv.ai.state.review && window.__mv.ai.state.review.kind === 'direct'", 'the area review', timeout=6000):
        return
    await f.settle(3)
    heads = await page.evaluate(REVIEW_GROUPS)
    f.check(len(heads) == 4 and (lang != 'ja' or (heads[0].startswith('素材') and heads[1].startswith('区画 サビ1')
                                                     and heads[2].startswith('カット') and heads[3].startswith('区画の外'))),
            'the review has 4 groups: %r' % heads)
    body = [s for s in f.ai_seen if s['method'] == 'POST'][-1]['body']
    f.check('Materials (data, never code)' in json.dumps(body, ensure_ascii=False), 'materials were allowed in the request')
    await f.shot('area_review')
    # 試写 shows the tried document on the stage; apply is one undo step named by the area.
    await page.click('.ai-review-foot [data-fkey="try"]')
    await f.until('() => window.__mv.shell.stage.hasAlt()', '試写 shows the tried document')
    done = await page.evaluate(DONE)
    before = await page.evaluate(DOC)
    await page.click('.ai-review-foot .btn.primary')
    await f.until("() => window.__mv.doc.materials.list.length === 1", 'the material is created')
    f.check(await page.evaluate(DONE) == done + 1, 'apply is one undo entry')
    label = await page.evaluate("() => window.__mv.store.peek().undo")
    f.check(label[0] == 'undo.aiArea' and (lang != 'ja' or 'サビ1' in label[1]['area']), 'the undo entry names サビ1: %r' % label)
    st = await page.evaluate("""(ids) => { const a = window.__mv, p = a.doc.pins, m = a.doc.materials.list[0];
      const key = 'myMat' + m.id.slice(1);
      return { key, atmos: ids.map((id) => (p['line/' + id + ':atmos'] || {}).v), speed: ids.map((id) => (p['line/' + id + ':motion.speed'] || {}).v),
        ramp: ids.every((id) => !!(p['line/' + id + ':arrive.ease'] || { v: {} }).v.ramp),
        shot: ids.every((id) => typeof (p['line/' + id + ':cam.shot'] || {}).v === 'object'),
        motion: (p['work:amount.motion'] || {}).v, registry: !!a.engine.registry }; }""", chorus['ids'])
    f.check(st['atmos'] == [st['key']] * 2 and st['speed'] == [0.5, 0.5] and st['ramp'] and st['shot'],
            'the area lines get the material, the speed, the ramp and the custom shot: %r' % st)
    f.check(st['motion'] is None, 'the row outside the area was left unchecked: %r' % st)
    f.check(st['registry'], 'the engine has the effective registry (engine.registry)')
    mine = await page.evaluate("() => window.__mv.engine.registry.mine('ornament')")
    f.check(st['key'] in mine, 'the preview registry has the material: %r' % mine)
    uses = await f.until(PLAN_USES, 'the plan puts the material in the area', st['key'])
    painted = await page.evaluate(PAINTS_AT, chorus['ids']) if uses else 0
    after = await page.evaluate(DOC)
    # 全体 › マイ素材 lists it.
    await page.evaluate("() => { const a = window.__mv; a.openPanel('details'); a.select({ level: 'work' }, { from: 'key', open: true }); }")
    await f.settle(3)
    await open_section(f, 'materials')
    rows = await page.evaluate("() => [...document.querySelectorAll('.mat-row')].map((r) => r.textContent)")
    f.check(len(rows) == 1 and (lang != 'ja' or '桜吹雪' in rows[0]), 'マイ素材 lists the material: %r' % rows)
    # Undo restores the materials and the pins; redo brings them back; the log's 元に戻す reverts pins, then the material.
    await f.blur()
    await page.keyboard.press('Control+z')
    await f.until('(d) => JSON.stringify(window.__mv.doc) === d', 'undo restores materials and pins', before)
    # The preview renders the material (DESIGN_2_1 §7.4): a frame inside the area draws more paints with it than without.
    if await f.until('(k) => !(%s)(k)' % PLAN_USES, 'the plan drops the material with the undo', st['key']):
        bare = await page.evaluate(PAINTS_AT, chorus['ids'])
        f.check(painted > bare, 'the preview draws the material in the area (%d paints, %d without)' % (painted, bare))
    await page.keyboard.press('Control+Shift+z')
    await f.until('(d) => JSON.stringify(window.__mv.doc) === d', 'redo brings them back', after)
    run_id = await page.evaluate("() => { const l = window.__mv.store.side.aiLog; return l[l.length - 1].runId; }")
    res = await page.evaluate("(id) => window.__mv.ai.revert(id)", run_id)
    f.check(res and res['kept'] == 0 and res['n'] > 0, 'selective revert: %r' % res)
    f.check(await page.evaluate('() => window.__mv.doc.materials.list.length') == 0, 'the created material goes with the revert')
    await page.keyboard.press('Control+z')
    await f.until('(d) => JSON.stringify(window.__mv.doc) === d', 'undo of the revert', after)
    # Delete from the material page: its pins go with it (material.remove).
    await f.settle(2)
    await open_section(f, 'materials')
    await page.click('.mat-row .insp-item')
    await f.until("() => !!document.querySelector('.mat-page .mat-delete .btn')", 'the material page opens')
    await f.shot('material_page')
    await page.click('.mat-page .mat-delete .btn')
    await f.until("() => window.__mv.doc.materials.list.length === 0", 'the material is deleted')
    left = await page.evaluate("(k) => Object.entries(window.__mv.doc.pins).filter(([p, x]) => x.v === k).length", st['key'])
    f.check(left == 0, 'its pins are cleared: %d left' % left)
    await f.undo_all(done0, doc0)


async def flow_ai_board(f, lang):
    """区画ごとに指示 (DESIGN_2_1 §6.3), keyboard only: the board lists the song areas; two drafts (kept in side.asks and
    when the board is closed and opened again); まとめて送る → one request with two briefs → a review with two area groups →
    Enter on 反映 → both rows say 反映済み. 9 drafts disable 送る with ai.board.max."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    answers = []
    if not await analysed_song(f, answers):
        return
    areas = await page.evaluate(SONG_AREAS)
    verse = next((x for x in areas if x['kind'] == 'verse'), None)
    chorus = next((x for x in areas if x['kind'] == 'chorus'), None)
    answers.append({'answers': [d_answer(0, all_={'speed': 0.75}), d_answer(1, all_={'arriveCurve': d_curve('softEnds')})]})
    # 対象 by keyboard: → → reaches 区画 and opens the list with the focus on its first area; ↓ and Enter pick サビ1.
    await page.focus('.ai-direct [data-target="work"]')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await f.until("() => !document.querySelector('#ai-area-list').hidden", '→ → opens the area list')
    f.check(await page.evaluate("() => document.activeElement.getAttribute('role')") == 'option', 'the focus is on the first area')
    for _ in range(len(areas) + 2):
        if await page.evaluate("(k) => document.activeElement.dataset.area === k", chorus['key']):
            break
        await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    chip = await page.evaluate("() => { const c = document.querySelector('.ai-target-chip'); return c && !c.hidden ? c.textContent : null; }")
    f.check(chip and (lang != 'ja' or 'サビ1' in chip), 'Enter picks サビ1: %r' % chip)
    f.check(await page.evaluate("() => document.activeElement.id") == 'ai-direct-text', 'the focus moves to the instruction')
    await page.focus('.ai-board-link')
    await page.keyboard.press('Enter')
    if not await f.until("() => !!document.querySelector('.ai-board .ai-board-input')", 'the board opens'):
        return
    rows = await page.evaluate("() => [...document.querySelectorAll('.ai-board-row')].map((r) => r.dataset.key)")
    f.check(rows == [x['key'] for x in areas], 'one row per song area: %r' % rows)
    f.check(await page.evaluate("() => document.activeElement === document.querySelector('.ai-board-input')"), 'the focus starts on the first row')
    await page.focus('.ai-board-row[data-key="%s"] .ai-board-input' % verse['key'])
    await page.keyboard.type('動きをゆっくり')
    await page.keyboard.press('Tab')
    active = await page.evaluate("() => document.activeElement.closest('.ai-board-row').dataset.key")
    f.check(active == chorus['key'], 'Tab moves to the next row: %r' % active)
    await page.keyboard.type('入りを滑らかに')
    await f.until('(k) => !!(window.__mv.store.side.asks || {})[k]', 'the drafts are kept in side.asks', chorus['key'])
    # Back and in again: the drafts are still there.
    await page.focus('.ai-board [data-fkey="board-back"]')
    await page.keyboard.press('Enter')
    await f.until("() => !document.querySelector('.ai-board') || document.querySelector('.ai-board-host').hidden", 'back to the tools')
    await page.focus('.ai-board-link')
    await page.keyboard.press('Enter')
    await f.until("() => !!document.querySelector('.ai-board .ai-board-input')", 'the board opens again')
    kept = await page.evaluate("(k) => document.querySelector('.ai-board-row[data-key=\"' + k + '\"] .ai-board-input').value", verse['key'])
    f.check(kept == '動きをゆっくり', 'a draft survives closing the board: %r' % kept)
    await f.shot('board')
    await page.focus('.ai-board .btn.primary')
    await page.keyboard.press('Enter')
    if not await f.until("() => window.__mv.ai.state.review && window.__mv.ai.state.review.kind === 'direct'", 'the review of both areas'):
        return
    sent = [s for s in f.ai_seen if s['method'] == 'POST'][-1]['body']['contents'][0]['parts'][0]['text']
    f.check('動きをゆっくり' in sent and '入りを滑らかに' in sent, 'one request carries both briefs')
    await f.settle(3)
    heads = await page.evaluate(REVIEW_GROUPS)
    f.check(len(heads) == 2 and (lang != 'ja' or (heads[0].startswith('区画 Aメロ1') and heads[1].startswith('区画 サビ1'))),
            'a group per area: %r' % heads)
    done = await page.evaluate(DONE)
    await page.focus('.ai-review-foot .btn.primary')
    await page.keyboard.press('Enter')
    await f.until('(n) => window.__mv.store.list().filter((e) => e.done).length === n + 1', 'one undo entry', done)
    await f.until("() => !!document.querySelector('.ai-board-row')", 'the board comes back after the review')
    states = await page.evaluate("() => [...document.querySelectorAll('.ai-board-row')].map((r) => r.querySelector('.ai-board-state').dataset.state)")
    want = ['done' if k in (verse['key'], chorus['key']) else 'new' for k in rows]
    f.check(states == want, 'both rows say 反映済み: %r' % states)
    # 9 drafts: 送る is off and says why.
    await page.evaluate("""() => { const a = window.__mv, AC = MV.use('ui/ai_controller'), AR = MV.use('planner/areas');
      const ids = a.plan.lines.map((l) => l.id), sets = ids.map((x) => [x]);
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) sets.push([ids[i], ids[j]]);
      a.store.setSide((side) => sets.slice(0, 9).reduce((s, x, k) => AC.withAsk(s, AR.keyOf({ kind: 'lines', ids: x }), 'x' + k, k), side)); }""")
    await f.settle(3)
    n = await page.evaluate("() => document.querySelectorAll('.ai-board-row').length")
    why = await page.evaluate("() => { const b = document.querySelector('.ai-board .btn.primary'), r = document.querySelector('.ai-board .ai-reason'); return { off: b.disabled, text: r.hidden ? '' : r.textContent, want: window.__mv.t('ai.board.max') }; }")
    f.check(why['off'] and why['text'] == why['want'], 'more than 8 drafts: 送る is off with ai.board.max (%d rows): %r' % (n, why))
    await f.undo_all(done0, doc0)


async def flow_materials(f, lang):
    """マイ素材 (DESIGN_2_1 §6.9) on the v21 project: 入り › マイ素材 › ＋ AIで作る (the inline form) runs the material tool for
    the line; its review applies the material and uses it there (one undo step). 全体 › マイ素材 › a material: rename ✎,
    おまかせでも使う, a knob (量), 複製, the recipe JSON (確かめる names what is wrong), 削除 with its note. Undo-all."""
    page = f.page
    done0, doc0 = await open_v21(f)
    mat = dict(D_FLURRY, name='ふわ入り', nameEn='Soft rise', kind='arrive', scope='cut', season='', base='inkRise',
               params=[{'name': 'yFrom', 'value': '1.2'}], layers=[], knobs=[])
    await ai_route(f, [{'understood': True, 'question': '', 'material': mat}])
    await ai_open(f)
    await open_line(f, 'r5')
    await page.click(ROW % 'arrive' + ' .w-part')
    await f.until("() => !!document.querySelector('.pb-tabs [data-tab=\"mine\"]')", 'the part browser has マイ素材')
    await page.click('.pb-tabs [data-tab="mine"]')
    await f.until("() => !!document.querySelector('.pb-tile.pb-make')", 'the first tile is ＋ AIで作る')
    tiles = await page.evaluate("() => [...document.querySelectorAll('.pb-grid .pb-tile')].map((x) => x.dataset.key || 'make')")
    f.check('myMat1' in tiles, 'the 入り material is a tile: %r' % tiles)
    await page.click('.pb-tile.pb-make')
    await f.until("() => !document.querySelector('#pb-make-form').hidden", 'the inline form opens under the grid')
    f.check(await page.evaluate("() => document.activeElement.classList.contains('pb-make-text')"), 'the focus is in the form')
    await page.keyboard.type('ふわっと浮かんで着地する')
    await f.shot('make_form')
    done = await page.evaluate(DONE)
    await page.keyboard.press('Enter')
    if not await f.until("() => window.__mv.ai.state.review && window.__mv.ai.state.review.tool === 'material'", 'the material review'):
        return
    await f.settle(3)
    rows = await page.evaluate("() => document.querySelectorAll('.ai-review .ai-row').length")
    f.check(rows == 2, 'the material and its use on the line: %d rows' % rows)
    await page.click('.ai-review-foot .btn.primary')
    await f.until("() => window.__mv.doc.materials.list.length === 4", 'the material is made')
    f.check(await page.evaluate(DONE) == done + 1, 'one undo entry')
    pin = await page.evaluate(PIN_V, 'line/r5:arrive')
    f.check(pin == {'v': 'myMat4', 'by': 'ai'}, 'the line uses it: %r' % pin)
    # 全体 › マイ素材 › 桜吹雪.
    await page.evaluate("() => { const a = window.__mv; a.openPanel('details'); a.select({ level: 'work' }, { from: 'key', open: true }); }")
    await f.settle(3)
    await open_section(f, 'materials')
    names = await page.evaluate("() => [...document.querySelectorAll('.mat-row')].map((r) => r.dataset.mat)")
    f.check(names == ['m1', 'm2', 'm3', 'm4'], 'マイ素材 lists every material: %r' % names)
    await page.click('.mat-row[data-mat="m3"] .insp-item')
    await f.until("() => !!document.querySelector('.mat-page .mat-name')", 'the material page opens')
    crumb = await page.evaluate("() => document.querySelector('[data-mount=\"inspector\"] .insp-crumbs').textContent")
    f.check(lang != 'ja' or '桜吹雪' in crumb, 'the crumb names it: %r' % crumb)
    done = await page.evaluate(DONE)
    await page.click('.mat-page .mat-head .icon-btn')
    await page.keyboard.press('Control+a')
    await page.keyboard.type('夜桜')
    await page.keyboard.press('Enter')
    await f.until("() => window.__mv.doc.materials.list[2].name.ja === '夜桜'", 'rename ✎')
    await page.click('.mat-page .check-row input')
    await f.until("() => window.__mv.doc.materials.list[2].pool === true", 'おまかせでも使う')
    knob = '.mat-page .mat-knob input[type="text"], .mat-page .mat-knob .w-num'
    if await page.evaluate('(s) => !!document.querySelector(s)', knob):
        before = await page.evaluate("() => JSON.stringify(window.__mv.doc.materials.list[2].recipe)")
        await page.fill(knob + ' >> nth=0', '1.5')
        await page.keyboard.press('Enter')
        await f.until('(b) => JSON.stringify(window.__mv.doc.materials.list[2].recipe) !== b', 'the knob bakes into the recipe', before)
    f.check(await page.evaluate(DONE) >= done + 3, 'each change is an undo entry')
    await page.click('.mat-page .row-actions .btn >> nth=1')
    await f.until("() => window.__mv.doc.materials.list.length === 5", '複製')
    dup = await page.evaluate("() => { const m = window.__mv.doc.materials.list[4]; return [m.by, m.name.ja]; }")
    f.check(dup == ['user', '夜桜'], 'the copy is made by the user: %r' % dup)
    await page.click('.mat-page .mat-recipe summary')
    await page.click('.mat-page .mat-recipe .link')
    await page.fill('.mat-page .mat-json-edit', '{ "layers": [')
    await page.click('.mat-page .mat-json-box .btn >> nth=0')
    probs = await page.evaluate("() => document.querySelector('.mat-page .mat-problems').textContent")
    f.check(probs == await page.evaluate("() => window.__mv.t('mat.badJson')"), '確かめる says the JSON is unreadable: %r' % probs)
    await f.shot('material_page')
    note = await page.evaluate("() => { const n = document.querySelector('.mat-page .mat-delete .note'); return n ? n.textContent : ''; }")
    f.check(lang != 'ja' or '2か所' in note, '削除 says how many places use it: %r' % note)
    await page.click('.mat-page .mat-delete .btn')
    await f.until("() => !window.__mv.doc.materials.list.some((m) => m.id === 'm3')", 'the material is deleted')
    pins = await page.evaluate("() => Object.keys(window.__mv.doc.pins).filter((p) => p.includes('myMat3') || (window.__mv.doc.pins[p].v === 'myMat3'))")
    f.check(pins == [], 'its pins go with it: %r' % pins)
    await f.undo_all(done0, doc0)


FLOWS = [('first_run', flow_first_run_mouse, True), ('first_run_keys', flow_first_run_keys, True), ('drill', flow_drill, False),
         ('pin', flow_pin, False), ('lock', flow_lock, False), ('history', flow_history, False), ('tools', flow_tools, False),
         ('keys', flow_keys, False), ('values', flow_values, False), ('ai_prep', flow_ai_prep, False),
         ('ai_looks', flow_ai_looks, False), ('ai_edit', flow_ai_edit, False), ('ai_align', flow_ai_align, False),
         ('output', flow_output, False), ('cutkeys', flow_cutkeys, False), ('song', flow_song, False),
         ('playback', flow_playback, False), ('open_damaged', flow_open_damaged, False), ('autosave', flow_autosave, False),
         ('tabs', flow_tabs, False), ('tap', flow_tap, False), ('first_look', flow_first_look, False), ('preview', flow_preview, False),
         ('song_step', flow_song_step, False), ('clear_device', flow_clear_device, False)]
# v2.1 (package F, DESIGN_2_1 §7.4).
FLOWS += [('curve', flow_curve, False), ('keyframes', flow_keyframes, False), ('areas', flow_areas, False),
          ('ai_area', flow_ai_area, False), ('ai_board', flow_ai_board, False), ('materials', flow_materials, False)]


async def run(browser, base, rel, lang, only, shots):
    failures, count = [], 0
    for name, fn, clipboard in FLOWS:
        if only and name != only:
            continue
        if lang == 'en' and name != 'first_run':
            continue
        page = await open_page(browser, base, rel, clipboard)
        f = Flow(lang + '_' + name, page, shots)
        try:
            await fn(f, lang)
        except Exception as e:  # a crashed flow is a failure, the others still run
            f.problems.append('crashed: %r' % e)
        csp = await page.evaluate('() => window.__csp || []')
        f.check(not csp, 'CSP violations: %r' % csp)
        f.check(not f.errors, 'page errors: %r' % f.errors[:3])
        count += 1
        print('%s %s %s' % ('FAIL' if f.problems else 'ok  ', lang, name))
        failures += ['%s %s: %s' % (lang, name, p) for p in f.problems]
        await page.context.close()
    return count, failures


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shots', help='write screenshots to this directory')
    ap.add_argument('--only', help='run one flow by name')
    ap.add_argument('--root', help='the tree to build and serve, with src/ and vendor/ (default: this one), e.g. a staging copy')
    args = ap.parse_args()
    root = Path(args.root).resolve() if args.root else ROOT
    ensure_built(root)
    if args.shots:
        Path(args.shots).mkdir(parents=True, exist_ok=True)
    server = serve(root)
    base = 'http://127.0.0.1:%d/' % server.server_address[1]
    total, failures = 0, []
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                for rel, lang in (('index.html', 'ja'), ('en/index.html', 'en')):
                    n, fl = await run(browser, base, rel, lang, args.only, args.shots)
                    total += n
                    failures += fl
            finally:
                await browser.close()
    finally:
        server.shutdown()
    for msg in failures:
        print('  ' + msg)
    print('ui_flows.py: %s' % ('FAILED (%d problems)' % len(failures) if failures else 'OK (%d flows)' % total))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
