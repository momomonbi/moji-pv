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
v2.1 editor-ready output (package H.3, DESIGN_2_1 §13.12):
  kit                        Filmora用 (the backdrop kept), 詳しく's set contents (one entry each) and summary, the no-VP9 fix,
                             「Filmoraで使うには」, 書き出す into a folder (the picker faked with OPFS), the phases, the done
                             list and its guide, 中止 removing its folder, and one ZIP without a folder picker
  kit_keys                   keyboard only: the radio groups (one Tab stop, arrows choose, the app keys stay out), その他 ▾,
                             the set's checkboxes, the guide, [書き出す] and the done state's guide
  webm                       その他 › 透過動画 sets 透明; the backdrop list and the coupling both ways; the no-VP9 fix; a WebM
  subtitles                  ≡ › ファイル › 字幕（.srt）を保存 through the save dialog and as a download
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
import io
import json
import os
import struct
import subprocess
import sys
import threading
import zipfile
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


async def choose_other(page, fmt):
    """Step ④'s その他 ▾ (DESIGN_2_1 §13.10): 透過動画（WebM）, PNG連番 or 透過PNG."""
    await page.select_option('[data-other="format"]', fmt)


async def flow_output(f, lang):
    """透過PNG ⇔ 透明 as one pair (step ④ and 作品全体), skipped screen effects greyed with the reason, a PNG export."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    await page.evaluate("() => window.__mv.goStep('export')")
    await f.settle(2)
    note = await page.evaluate("() => window.__mv.t('exp.alphaNote2')")
    shown = await page.evaluate("() => { const n = document.querySelector('.step-export [data-note=\"alpha\"]'); return n ? n.textContent : null; }")
    f.check(shown == note, 'step ④ says which transparent format to use (MP4): %r' % shown)
    done = await page.evaluate(DONE)
    await choose_other(page, 'pngAlpha')
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
    await choose_other(page, 'pngAlpha')
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


# --- photos and videos (package G.4, DESIGN_2_1 §11.7, §11.8.3) -------------------------------------------------------

MEDIA_HELPERS = ('tests/helpers/exif_write.js', 'tests/helpers/media_gen.js')
# Files made in the page (window.__files[name]): 'png' | 'jpeg' | 'webp' stills of w × h (a gradient from `color` with a
# white square in the middle; `solid`: the colour alone), 'video' the counter clip of tests/helpers/media_gen.js (VP9, 1.5 s
# at 30 fps; `audio`: with an Opus tone track, where this browser encodes Opus).
MAKE_FILES = """async (specs) => {
  window.__files = window.__files || {};
  for (const s of specs) {
    let blob;
    if (s.kind === 'video') {
      const v = await window.MVMediaGen.encodeCounter({ container: s.container || 'mp4', fps: 30, frames: s.frames || 45, audio: !!s.audio });
      blob = new Blob([v.bytes], { type: s.container === 'webm' ? 'video/webm' : 'video/mp4' });
    } else {
      const c = new OffscreenCanvas(s.w, s.h), g = c.getContext('2d');
      const gr = g.createLinearGradient(0, 0, s.w, s.h);
      gr.addColorStop(0, s.color); gr.addColorStop(1, s.solid ? s.color : '#203040');
      g.fillStyle = gr; g.fillRect(0, 0, s.w, s.h);
      if (!s.solid) { g.fillStyle = '#ffffff'; g.fillRect(s.w * 0.45, s.h * 0.45, s.w * 0.1, s.h * 0.1); }
      blob = await c.convertToBlob({ type: 'image/' + s.kind, quality: 0.9 });
    }
    window.__files[s.name] = new File([blob], s.name, { type: blob.type });
  }
  return Object.keys(window.__files).length;
}"""
# Drags files over an element and drops them there (a real DragEvent with a DataTransfer of File objects); returns the
# stage's drop label while the files were over it (null elsewhere).
DROP = """async ([sel, names, hold]) => {
  const el = document.querySelector(sel);
  const dt = new DataTransfer();
  for (const n of names) dt.items.add(window.__files[n]);
  const r = el.getBoundingClientRect();
  const o = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  el.dispatchEvent(new DragEvent('dragenter', o));
  el.dispatchEvent(new DragEvent('dragover', o));
  const box = document.querySelector('.stage-drop');
  const said = box && !box.hidden ? box.textContent : null;
  if (!hold) el.dispatchEvent(new DragEvent('drop', o));
  return said;
}"""
# The bytes of a file made here (for a file chooser): { name, mimeType, bytes: [..] }.
FILE_BYTES = """async (name) => { const f = window.__files[name];
  return { name: f.name, mimeType: f.type, bytes: Array.from(new Uint8Array(await f.arrayBuffer())) }; }"""
MEDIA_IDS = '() => window.__mv.doc.media.list.map((e) => e.id)'
TOASTS = "() => [...document.querySelectorAll('.toast .toast-text')].map((x) => x.textContent)"
FIELD = '[data-mount="inspector"] .frow[data-slot="%s"]'


async def media_page(f):
    for rel in MEDIA_HELPERS:
        await f.page.evaluate((ROOT / rel).read_text(encoding='utf-8'))


async def make_files(f, specs):
    await f.page.evaluate(MAKE_FILES, specs)


async def drop(f, sel, names, hold=False):
    """Drops files made in the page on an element; hold=True only drags them over it (the drop label shows)."""
    return await f.page.evaluate(DROP, [sel, names, hold])


async def open_el(f, scope, el):
    await f.page.evaluate("""([scope, el]) => { const a = window.__mv; a.openPanel('details');
      a.select({ level: 'el', scope, el }, { from: 'crumbs', open: true }); }""", [scope, el])
    await f.until("() => window.__mv.view.state.panel === 'details'", '詳細 opens')
    await f.settle(3)


async def choose_files(f, click, names):
    """Clicks something that opens the file picker (ui/dom.pickFiles) and chooses files made in the page."""
    payloads = []
    for n in names:
        x = await f.page.evaluate(FILE_BYTES, n)
        payloads.append({'name': x['name'], 'mimeType': x['mimeType'], 'buffer': bytes(x['bytes'])})
    async with f.page.expect_file_chooser() as info:
        await click()
    await (await info.value).set_files(payloads)


# The crop pins of a scope: [cropX, cropY, cropZoom] (None when not pinned).
CROP = """(base) => ['cropX', 'cropY', 'cropZoom'].map((n) => { const p = window.__mv.doc.pins[base + '.' + n]; return p ? p.v : null; })"""
# The glyphs (black text) inside the text block of the cut at the playhead, on the main canvas: 'mark' remembers the
# dark pixels, 'read' says how many of them now show the magenta overlay (red and blue raised, green low; §11.9.3: in
# front, an overlay covering the frame is screened at 45 %).
OVERLAY_INK = """(mode) => { const a = window.__mv; const c = document.querySelector('.canvas-main');
  const cut = a.plan.cuts.find((x) => x.t0 <= a.time() && a.time() < x.t1);
  const b = cut && a.engine.boxes().find((x) => x.cut === cut.key && x.owner === 'text');
  if (!b) return null;
  const k = c.width / a.plan.design.w, q = b.quad;
  const x0 = Math.floor(Math.min(q[0], q[2], q[4], q[6]) * k), x1 = Math.ceil(Math.max(q[0], q[2], q[4], q[6]) * k);
  const y0 = Math.floor(Math.min(q[1], q[3], q[5], q[7]) * k), y1 = Math.ceil(Math.max(q[1], q[3], q[5], q[7]) * k);
  const d = c.getContext('2d').getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
  if (mode === 'mark') {
    window.__glyphs = [];
    for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) < 60) window.__glyphs.push(i);
    return { glyphs: window.__glyphs.length };
  }
  let tinted = 0;
  for (const i of window.__glyphs || []) if (d[i] > 80 && d[i + 2] > 80 && d[i + 1] < 60) tinted++;
  return { glyphs: (window.__glyphs || []).length, tinted }; }"""
# Whether the preview's last frame is final (no font, scene or picture still on its way).
FINAL = "() => { const s = window.__mv.engine.stats ? window.__mv.engine.stats() : null; return !document.querySelector('.stage-media') || document.querySelector('.stage-media').hidden; }"


async def flow_media(f, lang):
    """Photos and videos on the stage (DESIGN_2_1 §11.7.1–§11.7.7, §11.9.5): a PNG dropped on the preview becomes the
    work's background in one undo step; the element page shows its source, 動きと重なり as a radiogroup whose ⓘ toggles a
    why line that follows the value, and its shares in %; the crop overlay says what it does (the play bar's strip, the
    live region), its drag and its keys (→ ↑ ← 1 %, Shift 10 %, +) are one undo entry each at their own values, the
    wheel zooms, 0 and a double-click reset, Esc gives the focus back to [画面で調整]; a pasted picture is imported even
    after a look was copied, and a paste without one pastes the look; an MP4 dropped while a line is selected is that
    line's background (「3行目」); its 使う範囲 with the keyboard (slider handles ≥ 24 px) and with a drag (the peek and its
    strip), [▶ 範囲を見る]; 後ろに下げる then undone; overlay footage placed from the asset page (重ねる映像) with そのまま重ねる:
    後ろに下げる leaves the glyphs their colour, 文字の前に出す covers them (pixels); the 2 s 720p MP4 export where H.264
    encodes; undo-all returns to the start."""
    page = f.page
    await media_page(f)
    done0, doc0 = await with_lyrics(f)
    await make_files(f, [{'kind': 'png', 'name': '夕焼け.png', 'w': 1200, 'h': 1200, 'color': '#e08040'},
                         {'kind': 'video', 'name': '海辺.mp4'},
                         {'kind': 'png', 'name': '貼る.png', 'w': 320, 'h': 180, 'color': '#40a0e0'},
                         {'kind': 'png', 'name': '光.png', 'w': 640, 'h': 360, 'color': '#ff00ff', 'solid': True}])
    # 1. a PNG on the preview: 「背景にする（作品全体）」 while over it, then media.put and the two pins in one batch
    await drop(f, '.canvas-wrap', ['夕焼け.png'], hold=True)
    await f.shot('drag_over')
    said = await drop(f, '.canvas-wrap', ['夕焼け.png'])
    f.check(lang != 'ja' or said == '背景にする（作品全体）', 'the drop target says where: %r' % said)
    if not await f.until("() => { const p = window.__mv.doc.pins['work:ground@photoPan.image']; return !!p && /^a[0-9a-f]{24}$/.test(p.v); }",
                         'the PNG becomes the work background', timeout=15000):
        return
    photo = (await page.evaluate(MEDIA_IDS))[0]
    f.check(await page.evaluate(PIN_V, 'work:ground') == {'v': 'photoPan', 'by': 'user'}, 'work:ground is photoPan')
    f.check(await page.evaluate(DONE) == done0 + 1, 'the import and the background are one undo step')
    label = await page.evaluate("() => { const e = window.__mv.store.list().filter((x) => x.done).pop(); return window.__mv.t(e.label[0], e.label[1]); }")
    f.check(lang != 'ja' or label == '写真・動画を使う（作品全体）', 'the undo label names the scope: %r' % label)
    await f.until("(t) => [...document.querySelectorAll('.toast .toast-text')].some((x) => x.textContent === t)", 'the placed toast',
                  await page.evaluate("() => window.__mv.t('media.placed', { scope: window.__mv.t('area.work') })"))
    acts = await page.evaluate("() => [...document.querySelectorAll('.toast.has-acts .toast-act')].map((b) => b.textContent)")
    f.check(lang != 'ja' or acts[:2] == ['元に戻す', 'ほかの使い方…'], 'the toast offers 元に戻す and ほかの使い方…: %r' % acts)
    await f.shot('drop')
    # 2. the element page: source, 動きと重なり (a radiogroup whose おまかせ says what it does), shares in %, 切り抜き
    await open_el(f, 'work', 'ground')
    name = await page.evaluate("(s) => document.querySelector(s + ' .w-media-name').textContent", FIELD % 'ground@photoPan.image')
    f.check(name == '夕焼け.png', 'the media row names the asset: %r' % name)
    depth_row = FIELD % 'ground@photoPan.depth'
    radios = await page.evaluate("(s) => [...document.querySelectorAll(s + ' [role=\"radiogroup\"] [role=\"radio\"]')].map((b) => b.textContent)", depth_row)
    f.check(len(radios) == 5, '動きと重なり offers its five options: %r' % radios)
    tag = await page.evaluate("(s) => document.querySelector(s + ' .state-tag').textContent", depth_row)
    f.check(lang != 'ja' or tag.startswith('自動'), '動きと重なり says 自動 while unpinned: %r' % tag)
    f.check(not await page.evaluate("() => !!document.querySelector('.isec[data-sec=\"video\"]')"), 'a still has no video rows')
    units = await page.evaluate("""(rows) => rows.map((s) => { const u = document.querySelector(s + ' .unit'); return u ? u.textContent : null; })""",
                                [FIELD % 'ground@photoPan.zoom', FIELD % 'ground@photoPan.veil', FIELD % 'ground@photoPan.blur'])
    f.check(units == ['%', '%', None], '動きの強さ and 薄幕 in %%, ぼかし without du: %r' % units)
    veil_strength = await page.evaluate("(s) => { const r = document.querySelector(s + ' .fr-label'); return r ? r.textContent : null; }", FIELD % 'ground.amount')
    f.check(lang != 'ja' or veil_strength == '薄幕の強さ', 'the background\'s 強さ reads 薄幕の強さ: %r' % veil_strength)
    # ⓘ shows why, the line follows the value, and ⓘ again hides it
    why = depth_row + ' .fr-why'
    await page.click(depth_row + ' [data-role="why"]')
    auto_why = await page.evaluate("(s) => { const w = document.querySelector(s); return w && !w.hidden ? w.textContent : null; }", why)
    f.check(bool(auto_why), 'ⓘ shows why: %r' % auto_why)
    await page.evaluate("(s) => [...document.querySelectorAll(s + ' [role=\"radio\"]')].find((b) => b.textContent === window.__mv.t('opt.depth.front')).click()", depth_row)
    await f.until("() => { const x = window.__mv.doc.pins['work:ground@photoPan.depth']; return !!x && x.v === 'front'; }", '文字の前に出す pins depth')
    await f.settle(3)
    pinned_why = await page.evaluate("(s) => { const w = document.querySelector(s); return w && !w.hidden ? w.textContent : null; }", why)
    f.check(bool(pinned_why) and pinned_why != auto_why, 'the why line follows the pin: %r → %r' % (auto_why, pinned_why))
    await page.click(depth_row + ' [data-role="why"]')
    f.check(await page.evaluate("(s) => document.querySelector(s).hidden", why), 'ⓘ again hides the why line')
    await f.blur()
    await page.keyboard.press('Control+z')
    await f.until("() => !window.__mv.doc.pins['work:ground@photoPan.depth']", 'undo unpins 文字の前に出す')
    await f.shot('element_page')
    # 3. the crop overlay: [画面で調整] says what it does; one drag = one undo entry
    await page.click(FIELD % 'ground@photoPan.cropZoom' + ' .w-crop-edit')
    if not await f.until("() => document.querySelector('.canvas-wrap').classList.contains('is-cropping')", 'the crop overlay opens'):
        return
    await f.settle(3)
    strip = await page.evaluate("() => { const s = document.querySelector('.mode-strip'); return s && !s.hidden ? { kind: s.dataset.kind, text: s.querySelector('.strip-text').textContent, acts: [...s.querySelectorAll('.strip-acts button')].map((b) => b.textContent) } : null; }")
    f.check(strip is not None and strip['kind'] == 'crop' and len(strip['acts']) == 1 and (lang != 'ja' or ('ドラッグ' in strip['text'] and strip['acts'] == ['終わる'])),
            'the play bar says how the crop works, with [終わる]: %r' % strip)
    heard = await page.evaluate("() => document.querySelector('.preview-area [role=\"status\"]').textContent")
    f.check(heard == await page.evaluate("() => window.__mv.t('media.cropKeys')"), 'the live region says the crop keys: %r' % heard)
    f.check(await page.evaluate("() => document.activeElement === document.querySelector('.canvas-wrap')"), 'the preview has the focus')
    await f.shot('crop')
    box = await page.evaluate("() => { const r = document.querySelector('.canvas-wrap').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }")
    done = await page.evaluate(DONE)
    await page.mouse.move(box['x'], box['y'])
    await page.mouse.down()
    for k in range(1, 7):
        await page.mouse.move(box['x'] + 6 * k, box['y'] + 12 * k)
        await f.settle(1)
    await page.mouse.up()
    await f.settle(2)
    crop = await page.evaluate(CROP, 'work:ground@photoPan')
    f.check(crop[1] is not None and crop[1] < 0.5, 'dragging down shows more of the top (cropY %r)' % crop[1])
    f.check(await page.evaluate(DONE) == done + 1, 'the drag is one undo entry (%d)' % (await page.evaluate(DONE) - done))
    # the keys: → ↑ ← move the focus 1 % each (never to an edge), + zooms, all one entry; Shift+← 10 %
    await page.focus('.canvas-wrap')
    x0, y0 = crop[0], crop[1]
    done = await page.evaluate(DONE)
    await page.keyboard.press('ArrowRight')
    await f.settle(2)
    right = await page.evaluate(CROP, 'work:ground@photoPan')
    await page.keyboard.press('ArrowUp')
    await f.settle(2)
    await page.keyboard.press('ArrowLeft')
    await f.settle(2)
    await page.keyboard.press('+')
    await f.settle(2)
    after = await page.evaluate(CROP, 'work:ground@photoPan')
    f.check(right[0] is not None and abs(right[0] - (x0 + 0.01)) < 0.0026, '→ moves the focus 1 %% (%r → %r)' % (x0, right[0]))
    f.check(after[0] is not None and abs(after[0] - x0) < 0.0026 and abs(after[1] - (y0 - 0.01)) < 0.0026,
            '↑ and ← move 1 %% each: %r → %r' % ([x0, y0], after[:2]))
    f.check(after[2] is not None and abs(after[2] - 1.05) < 0.006, '+ zooms ×1.05: %r' % after[2])
    f.check(await page.evaluate(DONE) == done + 1, 'the key presses are one undo entry (%d)' % (await page.evaluate(DONE) - done))
    await page.keyboard.press('-')
    await f.settle(2)
    zoomed_out = await page.evaluate(CROP, 'work:ground@photoPan')
    f.check(zoomed_out[2] is not None and abs(zoomed_out[2] - 1.0) < 0.006, '− zooms back: %r' % zoomed_out[2])
    after = zoomed_out
    await page.keyboard.press('Shift+ArrowLeft')
    await f.settle(2)
    shifted = await page.evaluate(CROP, 'work:ground@photoPan')
    f.check(shifted[0] is not None and abs(shifted[0] - (after[0] - 0.1)) < 0.0026, 'Shift+← moves 10 %%: %r' % shifted[0])
    # the wheel zooms, one gesture per turn; 0 resets the three pins; a double-click resets too
    done = await page.evaluate(DONE)
    await page.mouse.move(box['x'], box['y'])
    await page.mouse.wheel(0, -120)
    await f.until("(z) => { const p = window.__mv.doc.pins['work:ground@photoPan.cropZoom']; return !!p && p.v > z + 0.01; }", 'the wheel zooms in', after[2])
    await page.wait_for_timeout(500)
    f.check(await page.evaluate(DONE) == done + 1, 'a turn of the wheel is one undo entry')
    await page.focus('.canvas-wrap')
    await page.keyboard.press('0')
    await f.until("(b) => ['cropX', 'cropY', 'cropZoom'].every((n) => !window.__mv.doc.pins[b + '.' + n])", '0 resets the crop', 'work:ground@photoPan')
    await page.keyboard.press('ArrowRight')
    await f.until("() => !!window.__mv.doc.pins['work:ground@photoPan.cropX']", '→ pins the focus again')
    await page.mouse.dblclick(box['x'], box['y'])
    await f.until("() => !window.__mv.doc.pins['work:ground@photoPan.cropX']", 'a double-click resets the crop')
    # Esc leaves, and the focus goes back to [画面で調整]
    await page.focus('.canvas-wrap')
    await page.keyboard.press('Escape')
    await f.until("() => !document.querySelector('.canvas-wrap').classList.contains('is-cropping')", 'Esc leaves the crop overlay')
    f.check(await page.evaluate("() => !!document.activeElement && document.activeElement.classList.contains('w-crop-edit')"),
            'Esc gives the focus back to [画面で調整]')
    f.check(await page.evaluate("() => document.querySelector('.mode-strip').hidden"), 'the crop strip goes with the overlay')
    # 4. a pasted picture is imported even after a look was copied (Ctrl+V is left to the paste event); a paste without
    # a picture pastes the look
    ids = await page.evaluate("() => window.__mv.plan.lines.slice(0, 2).map((l) => l.id)")
    await page.evaluate("(id) => window.__mv.dispatch({ t: 'pin.set', path: 'line/' + id + ':text.scale', v: 1.2, by: 'user' }, { label: ['undo.pin', { field: '', scope: '' }] })",
                        ids[0])                                  # a look to copy (setup)
    await page.evaluate("(id) => window.__mv.select({ level: 'line', ids: [id] }, { from: 'crumbs' })", ids[0])
    await f.settle(2)
    await page.evaluate("() => window.__mv.shell.stage.focus()")
    await page.keyboard.press('Control+c')
    f.check(await page.evaluate("() => window.__mv.clipboard") == 'line/' + ids[0], 'Ctrl+C copies the line\'s look')
    await page.evaluate("(id) => window.__mv.select({ level: 'line', ids: [id] }, { from: 'crumbs' })", ids[1])
    await f.settle(2)
    wrote = await page.evaluate("""async () => { try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': window.__files['貼る.png'] })]);
      return true; } catch (e) { return String(e); } }""")
    if f.check(wrote is True, 'the test can put a picture on the clipboard: %r' % wrote):
        n = len(await page.evaluate(MEDIA_IDS))
        done = await page.evaluate(DONE)
        await page.evaluate("() => window.__mv.shell.stage.focus()")
        await page.keyboard.press('Control+v')
        await f.until("(n) => window.__mv.doc.media.list.length === n + 1", 'Ctrl+V imports the pasted picture', n, timeout=10000)
        last = await page.evaluate("() => window.__mv.store.list().filter((e) => e.done).slice(-1)[0].label[0]")
        f.check(await page.evaluate(DONE) == done + 1 and last == 'undo.media.put', 'the picture is added, the look not pasted: %r' % last)
        await page.evaluate("async () => { await navigator.clipboard.writeText('ことば'); }")
        await page.evaluate("() => window.__mv.shell.stage.focus()")
        await page.keyboard.press('Control+v')
        await f.until("() => window.__mv.store.list().filter((e) => e.done).slice(-1)[0].label[0] === 'undo.pasteLook'",
                      'without a picture Ctrl+V pastes the copied look')
    # 5. an MP4 dropped while line 3 is selected: that line's background, 「3行目」
    lid = await page.evaluate('() => window.__mv.plan.lines[2].id')
    await page.evaluate("(id) => window.__mv.select({ level: 'line', ids: [id] }, { from: 'crumbs', open: true })", lid)
    await f.settle(2)
    done = await page.evaluate(DONE)
    said = await drop(f, '.canvas-wrap', ['海辺.mp4'])
    f.check(lang != 'ja' or said == '背景にする（3行目）', 'the drop target names the line (「3行目」, not a count): %r' % said)
    path = 'line/%s:ground@photoPan.image' % lid
    if not await f.until("(p) => !!window.__mv.doc.pins[p]", 'the MP4 becomes the line background', path, timeout=30000):
        return
    video = await page.evaluate("(p) => window.__mv.doc.pins[p].v", path)
    f.check(video != photo and video in await page.evaluate(MEDIA_IDS), 'the line shows the video')
    f.check(await page.evaluate(DONE) == done + 1, 'one undo step for the video too')
    placed = await page.evaluate("() => [...document.querySelectorAll('.toast .toast-text')].map((x) => x.textContent)")
    f.check(lang != 'ja' or '背景を動画にしました（3行目）' in placed, 'a video is called a video: %r' % placed)
    await page.evaluate("() => window.__mv.media.openLibrary()")
    await f.until("(id) => !!document.querySelector('.med-row[data-id=\"' + id + '\"] .med-more')", 'the video\'s row', video)
    await page.click('.med-row[data-id="%s"] .med-more' % video)
    await f.until("() => !!document.querySelector('.popover.menu')", 'its ⋯ menu')
    items = await page.evaluate("() => [...document.querySelectorAll('.popover.menu .menu-item')].map((b) => b.textContent)")
    f.check(lang != 'ja' or any(x.startswith('この動画を使わない') for x in items), 'the ⋯ menu of a video says この動画を使わない: %r' % items)
    await page.keyboard.press('Escape')
    # 6. 使う範囲 with the keyboard: → three frames on the in handle, ← one frame on the out handle
    await open_el(f, 'line/' + lid, 'ground')
    f.check(await page.evaluate("() => !!document.querySelector('.isec[data-sec=\"video\"] .w-trim')"), 'a video has the trim row in 動画')
    trim = FIELD % 'ground@photoPan.clipIn'
    handle = await page.evaluate("""(s) => { const h = document.querySelector(s + ' .w-trim-h.is-in'); const r = h.getBoundingClientRect();
      return { w: r.width, role: h.getAttribute('role'), text: h.getAttribute('aria-valuetext'), max: h.getAttribute('aria-valuemax') }; }""", trim)
    f.check(handle['w'] >= 24 and handle['role'] == 'slider' and handle['text'] == '0:00.00' and float(handle['max']) > 1.4,
            'a trim handle is a 24 px slider that says its time: %r' % handle)
    await page.focus(trim + ' .w-trim-h.is-in')
    await f.settle(2)
    done = await page.evaluate(DONE)
    for _ in range(3):
        await page.keyboard.press('ArrowRight')
    await f.settle(2)
    clip_in = await page.evaluate(PIN_V, 'line/%s:ground@photoPan.clipIn' % lid)
    f.check(clip_in is not None and abs(clip_in['v'] - 0.1) < 0.002, '→ ×3 moves the in point three frames: %r' % clip_in)
    f.check(await page.evaluate(DONE) == done + 1, 'the arrow presses are one undo entry')
    await page.focus(trim + ' .w-trim-h.is-out')
    await page.keyboard.press('ArrowLeft')
    await f.settle(2)
    clip_out = await page.evaluate(PIN_V, 'line/%s:ground@photoPan.clipOut' % lid)
    f.check(clip_out is not None and 1.4 < clip_out['v'] < 1.5, '← moves the out point one frame from the end: %r' % clip_out)
    await f.settle(2)
    f.check(not await page.evaluate("(s) => !!document.querySelector(s)", FIELD % 'ground@photoPan.clipOut'),
            'the pinned end stays inside the trim row (no row of its own)')
    times = await page.evaluate("(s) => document.querySelector(s + ' .w-trim-len').textContent", trim)
    f.check(lang != 'ja' or '秒' in times, 'the range length is shown: %r' % times)
    # a drag of the in handle: one gesture, the stage peeks at the source frame with 「使う範囲を調整中」
    await page.evaluate("(s) => document.querySelector(s).scrollIntoView({ block: 'center' })", trim)
    await f.settle(2)
    bar = await page.evaluate("""(s) => { const b = document.querySelector(s + ' .w-trim-bar').getBoundingClientRect();
      const h = document.querySelector(s + ' .w-trim-h.is-in').getBoundingClientRect();
      return { x: h.left + h.width / 2, y: h.top + h.height / 2, left: b.left, w: b.width }; }""", trim)
    done = await page.evaluate(DONE)
    await page.mouse.move(bar['x'], bar['y'])
    await page.mouse.down()
    await page.mouse.move(bar['left'] + bar['w'] * 0.3, bar['y'], steps=4)
    await f.settle(2)
    peek = await page.evaluate("() => { const s = document.querySelector('.mode-strip'); return s && !s.hidden ? [s.dataset.kind, s.querySelector('.strip-text').textContent] : null; }")
    await page.mouse.up()
    await f.settle(2)
    f.check(peek is not None and peek[0] == 'peek' and (lang != 'ja' or peek[1] == '使う範囲を調整中'), 'dragging a handle peeks with its strip: %r' % peek)
    moved = await page.evaluate(PIN_V, 'line/%s:ground@photoPan.clipIn' % lid)
    f.check(moved is not None and 0.3 < moved['v'] < 0.6 and await page.evaluate(DONE) == done + 1, 'the drag sets the start in one entry: %r' % moved)
    f.check(await page.evaluate("() => document.querySelector('.mode-strip').hidden"), 'the peek ends on release')
    await f.shot('trim')
    # [▶ 範囲を見る]: the playhead to the line's next appearance, and it plays
    t0 = await page.evaluate("(id) => Math.min(...window.__mv.plan.cuts.filter((c) => c.line === id).map((c) => c.t0))", lid)
    await page.evaluate("() => window.__mv.seek(0)")
    await page.click(trim + ' .w-trim-play')
    played = await page.evaluate("() => ({ playing: window.__mv.view.state.playing, t: window.__mv.time() })")
    await page.evaluate("() => window.__mv.pause()")
    f.check(played['playing'] and t0 - 0.05 <= played['t'] < t0 + 1, '[▶ 範囲を見る] plays from the line (%r at %.2f)' % (played, t0))
    # 7. 後ろに下げる from the radiogroup, then undone
    depth = 'line/%s:ground@photoPan.depth' % lid
    await page.evaluate("(s) => [...document.querySelectorAll(s + ' [role=\"radio\"]')].find((b) => b.textContent === window.__mv.t('opt.depth.back')).click()",
                        FIELD % 'ground@photoPan.depth')
    await f.until("(p) => { const x = window.__mv.doc.pins[p]; return !!x && x.v === 'back'; }", '後ろに下げる pins depth', depth)
    await f.blur()
    await page.keyboard.press('Control+z')
    await f.until("(p) => !window.__mv.doc.pins[p]", 'undo unpins it', depth)
    # 8. overlay footage through the UI (§11.9.7 G): 重ねる映像 from the asset page on line 1, そのまま重ねる, then 後ろに下げる
    # and 文字の前に出す; the glyphs keep their colour behind it and take its colour in front of it
    await drop(f, '[data-mount="inspector"]', ['光.png'])
    if await f.until("() => window.__mv.doc.media.list.some((e) => e.name === '光.png')", 'the overlay picture is imported', timeout=15000):
        light = await page.evaluate("() => window.__mv.doc.media.list.find((e) => e.name === '光.png').id")
        first = await page.evaluate('() => window.__mv.plan.lines[0].id')
        await page.evaluate("(id) => window.__mv.select({ level: 'line', ids: [id] }, { from: 'crumbs', open: true })", first)
        await f.settle(2)
        await page.evaluate("(id) => window.__mv.media.openAsset(id)", light)
        await f.until("() => !!document.querySelector('.med-page [data-use=\"overlay\"]')", 'the asset page offers 重ねる映像')
        said = await page.evaluate("() => document.querySelector('.med-page [data-use=\"overlay\"]').textContent")
        f.check(lang != 'ja' or said == '重ねる映像（1行目）', 'the button names where it places: %r' % said)
        await page.click('.med-page [data-use="overlay"]')
        atmos = 'line/%s:atmos' % first
        await f.until("([p, id]) => { const x = window.__mv.doc.pins[p + '@mediaLayer.src']; return !!x && x.v === id; }", '重ねる映像 pins mediaLayer', [atmos, light])
        await f.settle(3)
        title = await page.evaluate("() => { const s = document.querySelector('.isec[data-sec=\"atmos\"] .isec-head'); return s ? s.textContent : null; }")
        f.check(lang != 'ja' or title == '重ねる映像', 'its section reads 重ねる映像: %r' % title)
        pick = "([s, v]) => [...document.querySelectorAll(s + ' [role=\"radio\"]')].find((b) => b.textContent === window.__mv.t(v)).click()"
        await page.evaluate(pick, [FIELD % 'atmos@mediaLayer.blend', 'opt.blend.normal'])
        await f.until("(p) => { const x = window.__mv.doc.pins[p]; return !!x && x.v === 'normal'; }", 'そのまま重ねる', atmos + '@mediaLayer.blend')
        # black glyphs, so the overlay in front shows on them (setup pins, one undo step)
        await page.evaluate("""([a, t]) => window.__mv.batch({ label: ['undo.pin', { field: '', scope: '' }] }, [
          { t: 'pin.set', path: a, v: 1, by: 'user' }, { t: 'pin.set', path: t, v: '#000000', by: 'user' }])""",
                            [atmos + '.amount', 'line/%s:text.ink' % first])
        cut = await page.evaluate("(id) => { const c = window.__mv.plan.cuts.find((x) => x.line === id); return c.repT !== undefined ? c.repT : (c.t0 + c.t1) / 2; }", first)
        inks = {}
        for v in ('back', 'front'):
            await page.evaluate(pick, [FIELD % 'atmos@mediaLayer.depth', 'opt.depth.' + v])
            await f.until("([p, v]) => { const x = window.__mv.doc.pins[p]; return !!x && x.v === v; }", 'depth ' + v, [atmos + '@mediaLayer.depth', v])
            await page.evaluate("(t) => { window.__mv.pause(); window.__mv.seek(t); }", cut)
            await page.wait_for_timeout(600)
            await f.settle(4)
            inks[v] = await page.evaluate(OVERLAY_INK, 'mark' if v == 'back' else 'read')
            if v == 'back':
                await f.shot('overlay_back')
        await f.shot('overlay_front')
        back, front = inks.get('back'), inks.get('front')
        f.check(back and front and back['glyphs'] > 40 and front['tinted'] > back['glyphs'] * 0.6,
                '後ろに下げる leaves the glyphs black, 文字の前に出す shows the overlay on them: %r' % inks)
    # 9. the 2 s 720p MP4 (where H.264 encodes)
    await f.blur()
    await page.keyboard.press('4')
    await f.until("() => window.__mv.view.state.step === 'export'", '4 = step ④')
    await export_check(f)
    await f.undo_all(done0, doc0)


# Slows media/host/probe.importFile down by `ms`, so a flow can act while a file is read. It honours the abort signal,
# unless given [ms, true]: a reader that finishes anyway (the file's bytes come back after the app stopped waiting).
SLOW_IMPORT = """(arg) => { const ms = Array.isArray(arg) ? arg[0] : arg, deaf = Array.isArray(arg) && !!arg[1];
  const PR = MV.use('media/host/probe'); const real = window.__realImport || PR.importFile;
  window.__realImport = real;
  PR.importFile = (file, o) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => real(file, deaf ? Object.assign({}, o, { signal: undefined }) : o).then(resolve, reject), ms);
    if (o && o.signal && !deaf) o.signal.addEventListener('abort', () => { clearTimeout(timer); const e = new Error('cancelled'); e.name = 'AbortError'; reject(e); });
  }); }"""
FAST_IMPORT = "() => { if (window.__realImport) MV.use('media/host/probe').importFile = window.__realImport; }"
# Records what the live regions say that starts with a word (the import progress), until __heardStop().
HEARD = """(w) => { window.__heard = []; const regions = [...document.querySelectorAll('body > .sr-only[role="status"]')];
      const obs = new MutationObserver(() => { for (const r of regions) if (r.textContent.startsWith(w) && window.__heard[window.__heard.length - 1] !== r.textContent) window.__heard.push(r.textContent); });
      for (const r of regions) obs.observe(r, { childList: true, characterData: true, subtree: true });
      window.__heardStop = () => obs.disconnect(); }"""
# The size of a base64 JPEG.
JPEG_SIZE = """async (b64) => { const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const img = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' })); const r = [img.width, img.height]; img.close(); return r; }"""
LAST_LABEL = "() => { const e = window.__mv.store.list().filter((x) => x.done).pop(); return e ? e.label[0] : null; }"
# The parts every cut shows in ornament#0…#2.
ORNAMENTS = "() => window.__mv.plan.cuts.map((c) => [0, 1, 2].map((i) => (c.slots['ornament#' + i] ? c.slots['ornament#' + i].v : null)))"


async def flow_library(f, lang):
    """The library (DESIGN_2_1 §11.7.3, §11.7.5): three files dropped on the page go to 作品全体 › 写真・動画 (each row's
    name says its kind once); the same file again says so and opens its page; the asset page (crumbs 写真・動画 › name,
    buttons that name where they place, ✎ and おまかせ keep the focus, この色に合わせる = one batch with a toast); おまかせ
    picks the pooled photo in at least one of 20 seeds; the part browser's 写真・動画 tab; with a line selected before
    作品全体 the buttons name that line; the picker (Enter and a click pick; ＋ 読み込む finishing after the selection moved
    places nothing); 文字の中に写真・動画 on 作品全体 (not 無効 before; the automatic decorations stay; なし clears both pins);
    the import progress row (（あと n件）, [中止] stops the queue); 写真の説明 through a faked Gemini (a still: one JPEG; a
    video: three frames of the range it is used in); 置き換える…; 削除 asks first. Undo-all returns to the start."""
    page = f.page
    await media_page(f)
    done0, doc0 = await with_lyrics(f, LYRICS_MORE)
    await make_files(f, [{'kind': 'png', 'name': '空.png', 'w': 1280, 'h': 720, 'color': '#4080e0'},
                         {'kind': 'jpeg', 'name': '森.jpg', 'w': 960, 'h': 720, 'color': '#40a060'},
                         {'kind': 'webp', 'name': '街.webp', 'w': 720, 'h': 1280, 'color': '#a04080'},
                         {'kind': 'jpeg', 'name': '森2.jpg', 'w': 960, 'h': 720, 'color': '#208040'},
                         {'kind': 'png', 'name': '遅い.png', 'w': 320, 'h': 180, 'color': '#e0e040'},
                         {'kind': 'png', 'name': 'a.png', 'w': 64, 'h': 64, 'color': '#101010'},
                         {'kind': 'png', 'name': 'b.png', 'w': 64, 'h': 64, 'color': '#202020'},
                         {'kind': 'png', 'name': 'c.png', 'w': 64, 'h': 64, 'color': '#303030'},
                         {'kind': 'png', 'name': 'd.png', 'w': 64, 'h': 64, 'color': '#404040'},
                         {'kind': 'png', 'name': 'e.png', 'w': 64, 'h': 64, 'color': '#505050'},
                         {'kind': 'png', 'name': 'f.png', 'w': 64, 'h': 64, 'color': '#606060'},
                         {'kind': 'png', 'name': 'g.png', 'w': 64, 'h': 64, 'color': '#707070'},
                         {'kind': 'png', 'name': 'h.png', 'w': 64, 'h': 64, 'color': '#808080'},
                         {'kind': 'png', 'name': 'i.png', 'w': 64, 'h': 64, 'color': '#909090'},
                         {'kind': 'video', 'name': '海.mp4'}])
    await page.evaluate("() => { const a = window.__mv; a.openPanel('details'); a.select({ level: 'work' }, { from: 'crumbs', open: true }); }")
    await f.settle(2)
    said = await drop(f, '[data-mount="inspector"]', ['空.png', '森.jpg', '街.webp'])
    f.check(said is None, 'a drop outside the preview only imports')
    if not await f.until('() => window.__mv.doc.media.list.length === 3', 'three files in the library', timeout=15000):
        return
    f.check(await page.evaluate("() => Object.keys(window.__mv.doc.pins).length") == 0, 'importing places nothing')
    await f.until("() => document.querySelectorAll('.med-row').length === 3", 'the library lists them (open while not empty)')
    names = await page.evaluate("() => [...document.querySelectorAll('.med-row .med-name')].map((x) => x.textContent)")
    f.check(names == ['空.png', '森.jpg', '街.webp'], 'in import order: %r' % names)
    row_name = await page.evaluate("() => document.querySelector('.med-row').getAttribute('aria-label')")
    f.check(lang != 'ja' or row_name == '空.png、写真、1280×720 · 使用 0', 'a row says its kind once: %r' % row_name)
    await f.shot('library')
    sky, forest, town = await page.evaluate(MEDIA_IDS)
    # the same file again: 「もう入っています」, and its page opens
    await drop(f, '[data-mount="inspector"]', ['空.png'])
    await f.until("(t) => [...document.querySelectorAll('.toast .toast-text')].some((x) => x.textContent === t)", 'もう入っています',
                  await page.evaluate("() => window.__mv.t('media.dup', { name: '空.png' })"), timeout=10000)
    await f.until("() => !!document.querySelector('.med-page')", 'a duplicate opens its asset page')
    f.check(len(await page.evaluate(MEDIA_IDS)) == 3, 'the library still has three')
    # the asset page: its crumbs 写真・動画 › 空.png (写真・動画 goes back to the library), no title bar of its own; while
    # 作品全体 is shown and no line was selected, every button places on 作品全体
    crumbs = await page.evaluate("""() => [...document.querySelectorAll('[data-mount="inspector"] .insp-crumbs .crumb')]
      .map((c) => [c.tagName, c.textContent])""")
    f.check(crumbs[-2:] == [['BUTTON', await page.evaluate("() => window.__mv.t('sec.media')")], ['SPAN', '空.png']],
            'the crumbs end 写真・動画 (a button) › 空.png: %r' % crumbs)
    f.check(not await page.evaluate("() => !!document.querySelector('.sub-head .sub-title')"), 'no second copy of the path above the page')
    uses = await page.evaluate("() => [...document.querySelectorAll('.med-page .med-use .btn')].map((b) => b.textContent)")
    f.check(lang != 'ja' or uses == ['作品全体の背景', '文字の中に（作品全体）', '写真の枠として（作品全体）', '重ねる映像（作品全体）'],
            'with nothing selected before, every button names 作品全体: %r' % uses)
    poster = await page.evaluate("() => { const p = document.querySelector('.med-page .med-poster-box'); return [p.tagName, p.getAttribute('role'), p.tabIndex]; }")
    f.check(poster == ['DIV', 'img', -1], 'a photo\'s poster is a picture, not a button or a tab stop: %r' % poster)
    # ✎: renamed in one step, the focus back on ✎
    done = await page.evaluate(DONE)
    await page.click('.med-page [data-role="rename"]')
    await page.fill('.med-page .med-rename', '青空')
    await page.keyboard.press('Enter')
    await f.until("(id) => window.__mv.doc.media.list.find((e) => e.id === id).name === '青空'", '✎ renames', sky)
    await f.settle(3)
    f.check(await page.evaluate(DONE) == done + 1, 'the rename is one undo step')
    f.check(await page.evaluate("() => document.activeElement && document.activeElement.dataset.role === 'rename'"), 'the focus goes back to ✎')
    # おまかせでも背景に使う with Space: the focus stays on the switch
    await page.focus('.med-page [data-role="pool"]')
    await page.keyboard.press(' ')
    await f.until('(id) => window.__mv.doc.media.list.find((e) => e.id === id).pool === true', 'おまかせでも使う', sky)
    await f.settle(3)
    f.check(await page.evaluate("() => { const a = document.activeElement; return !!a && !!a.closest('.med-page') && a.dataset.role === 'pool'; }"),
            'Space on the switch keeps the focus on it')
    # この色に合わせる: the work's colours in one step, said in a toast
    tip = await page.evaluate("() => document.querySelector('.med-page [data-act=\"colors\"]').title")
    f.check(lang != 'ja' or '作品全体の色' in tip, 'この色に合わせる says what it does: %r' % tip)
    await f.until("() => !document.querySelector('.med-page [data-act=\"colors\"]').disabled", 'the colours are read')
    done = await page.evaluate(DONE)
    await page.click('.med-page [data-act="colors"]')
    await f.until("() => !!window.__mv.doc.pins['work:color.accent']", 'この色に合わせる pins the accent')
    f.check(await page.evaluate(DONE) == done + 1 and await page.evaluate(LAST_LABEL) == 'undo.media.colors', 'one batch 色を写真に合わせる')
    await f.until("(t) => [...document.querySelectorAll('.toast .toast-text')].some((x) => x.textContent === t)", 'the colours toast',
                  await page.evaluate("() => window.__mv.t('media.colorsMatched')"))
    # the crumb 写真・動画 goes back to the library, the focus on its first row
    await page.evaluate("() => [...document.querySelectorAll('[data-mount=\"inspector\"] .insp-crumbs button.crumb')].pop().click()")
    await f.until("() => !document.querySelector('.med-page') && document.activeElement && document.activeElement.classList.contains('med-row')",
                  'the crumb 写真・動画 opens the library with the focus on a row')
    # Ctrl+K 写真: 読み込む… first, the command that clears the device last; 写真・動画の一覧 puts the focus on a row
    await f.blur()
    await page.keyboard.press('Control+k')
    await f.until("() => !!window.__mv.paletteOpen", 'the palette opens')
    await page.keyboard.type('写真')
    await f.settle(2)
    listed = await page.evaluate("() => window.__mv.palette.items()")
    ends = await page.evaluate("() => [window.__mv.t('cmd.media.import'), window.__mv.t('cmd.file.clearDevice')]")
    f.check(listed and listed[0] == ends[0] and listed[-1] == ends[1], '写真 lists 読み込む… first and 消す last: %r' % listed)
    await page.keyboard.press('Escape')
    await page.evaluate("() => window.__mv.select({ level: 'line', ids: [window.__mv.plan.lines[0].id] }, { from: 'crumbs' })")
    await f.blur()
    await page.keyboard.press('Control+k')
    await f.until("() => !!window.__mv.paletteOpen", 'the palette again')
    await page.keyboard.type(await page.evaluate("() => window.__mv.t('cmd.media.library')"))
    await f.settle(2)
    await page.keyboard.press('Enter')
    await f.until("() => !!document.activeElement && document.activeElement.classList.contains('med-row')", '写真・動画の一覧 focuses the library')
    # おまかせ picks the pooled photo as a background at least once in 20 seeds
    key = await page.evaluate("(id) => 'myMed' + id.slice(1, 11)", sky)
    used = 0
    for _ in range(20):
        seed = (await f.state())['seed']
        await page.click('.omakase')
        await f.until('(s) => window.__mv.doc.look.seed !== s', 'おまかせ', seed)
        await f.settle(1)
        if await page.evaluate("(k) => window.__mv.plan.grounds.some((g) => g && g.ground && g.ground.v === k)", key):
            used += 1
    f.check(used >= 1, 'おまかせ picks the pooled photo as a background at least once in 20 seeds (%d)' % used)
    # the part browser of a line's 背景: the pooled photo's derived ground is not a tile of すべて; 写真・動画 (3) places one
    lid = await page.evaluate('() => window.__mv.plan.lines[1].id')
    await open_el(f, 'line/' + lid, 'ground')
    await page.click(FIELD % 'ground' + ' .w-part')
    await f.until("() => !!document.querySelector('.pb-tabs [data-tab=\"media\"]')", 'the part browser has a 写真・動画 tab')
    await page.click('.pb-tabs [data-tab="all"]')
    await f.settle(2)
    keys = await page.evaluate("() => [...document.querySelectorAll('.pb-tile[data-key]')].map((x) => x.dataset.key)")
    f.check(key not in keys and 'photoPan' in keys, 'すべて lists photoPan but not the derived ground: %r' % [k for k in keys if k.startswith('myMed')])
    await page.click('.pb-tabs [data-tab="media"]')
    await f.until("() => document.querySelectorAll('.pb-tile.pb-media').length === 3", 'the tab shows the three files')
    await f.shot('part_browser_media')
    done = await page.evaluate(DONE)
    await page.click('.pb-tile.pb-media[data-media="%s"]' % sky)
    image = 'line/%s:ground@photoPan.image' % lid
    await f.until("([p, id]) => { const x = window.__mv.doc.pins[p]; return !!x && x.v === id; }", 'a tile places the photo on the line', [image, sky])
    f.check(await page.evaluate(PIN_V, 'line/%s:ground' % lid) == {'v': 'photoPan', 'by': 'user'}, 'with photoPan as the line background')
    f.check(await page.evaluate(DONE) == done + 1, 'in one undo step')
    # the media picker: Enter on a tile picks it, a click too
    await f.settle(3)
    await page.click(FIELD % 'ground@photoPan.image' + ' .w-media')
    await f.until("() => !!document.querySelector('.med-picker')", 'the media row opens the picker')
    await page.focus('.med-picker .pb-tile[data-id="%s"]' % forest)
    await page.keyboard.press('Enter')
    await f.until("([p, id]) => { const x = window.__mv.doc.pins[p]; return !!x && x.v === id; }", 'Enter picks 森.jpg', [image, forest])
    await f.until("() => !document.querySelector('.med-picker')", 'the picker closes')
    await page.click(FIELD % 'ground@photoPan.image' + ' .w-media')
    await f.until("() => !!document.querySelector('.med-picker')", 'the picker again')
    await f.shot('picker')
    await page.click('.med-picker .pb-tile[data-id="%s"]' % town)
    await f.until("([p, id]) => { const x = window.__mv.doc.pins[p]; return !!x && x.v === id; }", 'a click picks 街.webp', [image, town])
    # ＋ 読み込む in the picker, finishing after another line was selected: nothing is placed there (or here)
    await f.settle(3)
    await page.evaluate(SLOW_IMPORT, 1500)
    await page.click(FIELD % 'ground@photoPan.image' + ' .w-media')
    await f.until("() => !!document.querySelector('.med-picker .med-add')", 'the picker offers ＋ 読み込む')
    other = await page.evaluate('() => window.__mv.plan.lines[3].id')
    await choose_files(f, lambda: page.click('.med-picker .med-add'), ['遅い.png'])
    await page.evaluate("(id) => window.__mv.select({ level: 'line', ids: [id] }, { from: 'crumbs', open: true })", other)
    await f.until("() => window.__mv.doc.media.list.some((e) => e.name === '遅い.png')", 'the slow file is imported', timeout=10000)
    await f.settle(3)
    late = await page.evaluate("() => window.__mv.doc.media.list.find((e) => e.name === '遅い.png').id")
    f.check(await page.evaluate("(id) => !Object.values(window.__mv.doc.pins).some((p) => p.v === id)", late),
            'an import that ends after the selection moved places nothing')
    f.check(await page.evaluate(PIN_V, image) == {'v': town, 'by': 'user'}, 'the line the picker was opened for is unchanged')
    # the part browser's 写真・動画 ＋ too: closed before the file is read, it places nothing
    await open_el(f, 'line/' + lid, 'ground')
    await page.click(FIELD % 'ground' + ' .w-part')
    await f.until("() => !!document.querySelector('.pb-tabs [data-tab=\"media\"]')", 'the part browser again')
    await page.click('.pb-tabs [data-tab="media"]')
    await f.until("() => !!document.querySelector('.pb-tile.pb-media-add')", 'its ＋ tile')
    await choose_files(f, lambda: page.click('.pb-tile.pb-media-add'), ['g.png'])
    await page.keyboard.press('Escape')
    await f.until("() => window.__mv.doc.media.list.some((e) => e.name === 'g.png')", 'g.png is imported', timeout=10000)
    await f.settle(3)
    gid = await page.evaluate("() => window.__mv.doc.media.list.find((e) => e.name === 'g.png').id")
    f.check(await page.evaluate("(id) => !Object.values(window.__mv.doc.pins).some((p) => p.v === id)", gid),
            'the part browser closed before the import ended: nothing placed')
    await page.evaluate(FAST_IMPORT)
    # a picture the preview could not decode: 再生できません on its row, its page and its media row (a stubbed state)
    await page.evaluate("(id) => { const m = window.__mv.media; window.__realState = m.state; m.state = (x) => (x === id ? 'error' : window.__realState(x)); window.__mv.bus.emit('media'); }", town)
    await open_el(f, 'line/' + lid, 'ground')
    widget = await page.evaluate("(s) => { const b = document.querySelector(s + ' .w-media'); return { label: b.getAttribute('aria-label'), badges: [...b.querySelectorAll('.w-media-badge')].map((x) => x.textContent) }; }",
                                 FIELD % 'ground@photoPan.image')
    cannot = await page.evaluate("() => window.__mv.t('media.cannotPlay')")
    f.check(cannot in widget['badges'] and cannot in widget['label'], 'the media row says 再生できません: %r' % widget)
    await page.evaluate("() => window.__mv.media.openLibrary()")
    await f.until("(id) => !!document.querySelector('.med-row[data-id=\"' + id + '\"]')", 'the library', town)
    row = await page.evaluate("(id) => { const r = document.querySelector('.med-row[data-id=\"' + id + '\"]'); const b = r.querySelector('.med-badge.is-warn'); return [b ? b.textContent : null, r.getAttribute('aria-label')]; }", town)
    f.check(row[0] == cannot and cannot in row[1], 'the library row says 再生できません: %r' % row)
    await page.evaluate("(id) => window.__mv.media.openAsset(id)", town)
    await f.until("() => !!document.querySelector('.med-page .med-badges')", 'its page')
    badges = await page.evaluate("() => [...document.querySelectorAll('.med-page .med-badge')].map((x) => x.textContent)")
    f.check(cannot in badges, 'the asset page says 再生できません: %r' % badges)
    await page.evaluate("() => { window.__mv.media.state = window.__realState; }")
    # with a line selected before 作品全体, the asset page's buttons name that line (never 「選択中」)
    await page.evaluate("(id) => window.__mv.select({ level: 'line', ids: [id] }, { from: 'crumbs', open: true })", other)
    await f.settle(2)
    await page.evaluate("() => window.__mv.select({ level: 'work' }, { from: 'crumbs', open: true })")
    await f.settle(2)
    await page.evaluate("(id) => window.__mv.media.openAsset(id)", forest)
    await f.until("() => !!document.querySelector('.med-page .med-use')", 'the asset page')
    uses = await page.evaluate("() => [...document.querySelectorAll('.med-page .med-use .btn')].map((b) => b.textContent)")
    f.check(lang != 'ja' or uses == ['作品全体の背景', '4行目の背景', '文字の中に（4行目）', '写真の枠として（4行目）', '重ねる映像（4行目）'],
            'the buttons name the line they place on: %r' % uses)
    await f.shot('asset_page')
    # 文字の中に写真・動画 on 作品全体: automatic, not 無効; a picture pins textFill and itself where no cut shows a decoration
    # yet, so every decoration stays; なし clears both. The look is fixed first: the おまかせ runs above leave a random seed
    # and mood seed, and how many first decorations the variety rule swaps depends on them (11 to 15 of 15 over 22 runs)
    await page.evaluate("() => window.__mv.dispatch({ t: 'look.omakase', seed: 1, moodSeed: 1 }, { label: ['undo.omakase', {}] })")
    await f.until("() => window.__mv.doc.look.seed === 1 && window.__mv.doc.look.moodSeed === 1", 'the fixed look')
    await f.settle(3)
    await open_el(f, 'work', 'text')
    row = '[data-mount="inspector"] .frow[data-slot$="@textFill.src"]'
    st = await page.evaluate("(s) => { const r = document.querySelector(s); return r ? { slot: r.dataset.slot, state: r.dataset.state, why: r.querySelector('.fr-why').hidden ? '' : r.querySelector('.fr-why').textContent, name: r.querySelector('.w-media-name').textContent } : null; }", row)
    f.check(st is not None and st['state'] == 'auto' and not st['why'] and st['name'] == await page.evaluate("() => window.__mv.t('fld.none')"),
            '文字の中に写真・動画 reads 自動 / なし before anything is set: %r' % st)
    if st:
        slot = st['slot'].split('@')[0]
        before = await page.evaluate(ORNAMENTS)
        done = await page.evaluate(DONE)
        await page.click(row + ' .w-media')
        await f.until("() => !!document.querySelector('.med-picker')", 'its picker')
        await page.click('.med-picker .pb-tile[data-id="%s"]' % forest)
        await f.until("([s, id]) => { const p = window.__mv.doc.pins['work:' + s]; const x = window.__mv.doc.pins['work:' + s + '@textFill.src']; return !!p && p.v === 'textFill' && !!x && x.v === id; }",
                      'the picture pins textFill and its source', [slot, forest])
        f.check(await page.evaluate(DONE) == done + 1, 'in one undo step')
        after = await page.evaluate(ORNAMENTS)
        k = int(slot[-1])
        # the slot where the fewest cuts change: every first decoration stays a decoration, and almost all stay the same
        # (the planner's variety rule may swap one next to a cut that changed)
        had = [(a, b) for a, b in zip(after, before) if b[0]]
        lost = [(a, b) for a, b in had if k > 0 and not a[0]]
        same = sum(1 for a, b in had if a[0] == b[0])
        f.check(k > 0 and all(a[k] == 'textFill' for a in after) and not lost and same >= 0.8 * len(had),
                'the first decorations stay (%d of %d unchanged, lost %r); textFill on #%d everywhere' % (same, len(had), lost[:3], k))
        await f.shot('text_fill')
        await f.settle(3)
        await page.click(row + ' .w-media')
        await f.until("() => !!document.querySelector('.med-picker')", 'its picker again')
        await page.click('.med-picker .pb-tile[data-id=""]:not(.med-add)')
        await f.until("(s) => !window.__mv.doc.pins['work:' + s] && !window.__mv.doc.pins['work:' + s + '@textFill.src']", 'なし clears both', slot)
    # the import progress row: announced at most once every 5 s (three quick files: once); closed with ×, it comes back
    # with the next file
    await page.evaluate("() => window.__mv.select({ level: 'work' }, { from: 'crumbs', open: true })")
    await f.settle(2)
    await page.evaluate(HEARD, await page.evaluate("() => window.__mv.t('media.progress', { name: '', p: 0 }).split(':')[0]"))
    n = len(await page.evaluate(MEDIA_IDS))
    await drop(f, '[data-mount="inspector"]', ['d.png', 'e.png', 'f.png'])
    await f.until("(n) => window.__mv.doc.media.list.length === n + 3", 'three quick files', n, timeout=10000)
    heard = await page.evaluate("() => { window.__heardStop(); return window.__heard; }")
    f.check(len(heard) <= 1, 'the progress is announced at most once for a quick batch: %r' % heard)
    await page.evaluate(SLOW_IMPORT, 900)
    await drop(f, '[data-mount="inspector"]', ['h.png', 'i.png'])
    await f.until("() => !!document.querySelector('.toast.is-sticky .toast-x')", 'the progress row', timeout=5000)
    await page.click('.toast.is-sticky .toast-x')
    again = await page.evaluate("(w) => new Promise((r) => { const t0 = Date.now(); const tick = () => { const x = [...document.querySelectorAll('.toast.is-sticky')].find((e) => e.textContent.includes(w)); if (x || Date.now() - t0 > 4000) r(!!x); else requestAnimationFrame(tick); }; tick(); })", 'i.png')
    f.check(again, 'closed with ×, the row comes back for the next file')
    await f.until("(n) => window.__mv.doc.media.list.length === n + 5", 'both files are imported', n, timeout=10000)
    # 「読み込み中: a.png 0%（あと2件）」 with [中止], which stops the file and the queue
    n = len(await page.evaluate(MEDIA_IDS))
    await page.evaluate(SLOW_IMPORT, 1200)
    await drop(f, '[data-mount="inspector"]', ['a.png', 'b.png', 'c.png'])
    queue = await page.evaluate("(t) => new Promise((r) => { const t0 = Date.now(); const tick = () => { const x = [...document.querySelectorAll('.toast.is-sticky')].find((e) => e.textContent.includes(t)); if (x || Date.now() - t0 > 3000) r(x ? x.textContent : null); else requestAnimationFrame(tick); }; tick(); })",
                                await page.evaluate("() => window.__mv.t('media.queue', { n: 2 })"))
    f.check(queue is not None, 'the progress row counts the files waiting: %r' % queue)
    await f.shot('progress')
    await page.evaluate("(t) => [...document.querySelectorAll('.toast.is-sticky .toast-act')].find((b) => b.textContent === t).click()",
                        await page.evaluate("() => window.__mv.t('media.cancel')"))
    await page.wait_for_timeout(3000)
    f.check(len(await page.evaluate(MEDIA_IDS)) == n, '[中止] stops the file being read and the files waiting')
    f.check(not await page.evaluate("() => !!document.querySelector('.toast.is-sticky')"), 'the progress row is gone')
    await page.evaluate(FAST_IMPORT)
    # 写真の説明 (§11.6.2) through a faked Gemini: the consent names the size, the JPEG goes before the prompt and no lyric
    # is sent; the review shows the depth suggestion; applying writes the description (one undo step); the asset page
    # then shows it
    await ai_route(f, [{'items': [{'n': 0, 'caption': '青い空', 'captionEn': 'Blue sky', 'tags': ['soft'], 'colors': ['#4080E0'],
                                   'subject': {'x': 0, 'y': 0, 'w': 0, 'h': 0}, 'text': {'x': 0, 'y': 0, 'w': 1, 'h': 0.4},
                                   'use': 'ground', 'depth': 'back', 'reason': '広い空で文字が読みやすい'}]}])
    await page.evaluate("(k) => window.__mv.ai.setKey(k)", AI_KEY)
    await page.evaluate("(id) => window.__mv.media.openAsset(id)", sky)
    await f.until("() => !!document.querySelector('.med-page [data-act=\"vision\"]')", 'the asset page offers AIに説明してもらう')
    await page.click('.med-page [data-act="vision"]')
    await f.until("() => !!document.querySelector('dialog.dlg[open] .btn.primary')", 'it asks before sending the picture')
    text = await page.evaluate("() => document.querySelector('dialog.dlg[open] .dlg-text').textContent")
    f.check(lang != 'ja' or ('Google Gemini' in text and 'KB' in text), 'the consent names the service and the size: %r' % text)
    await page.click('dialog.dlg[open] .btn.primary')
    if await f.until("() => window.__mv.ai.state.review && window.__mv.ai.state.review.tool === 'vision'", 'the vision review', timeout=10000):
        posts = [x for x in f.ai_seen if x['method'] == 'POST']
        body = posts[-1]['body'] if posts else {}
        parts = body.get('contents', [{}])[0].get('parts', [])
        first = parts[0] if parts else {}
        data = first.get('inline_data') or first.get('inlineData') or {}
        f.check((data.get('mime_type') or data.get('mimeType')) == 'image/jpeg' and len(parts) == 2, 'one JPEG, then the prompt')
        size = await page.evaluate(JPEG_SIZE, data.get('data') or '')
        f.check(size == [768, 432], 'the 1280×720 photo is sent at 768 px on its long side: %r' % size)
        f.check('窓をあけて' not in json.dumps(body, ensure_ascii=False) and '空.png' not in json.dumps(body, ensure_ascii=False),
                'neither lyrics nor file names are sent')
        row = await page.evaluate("() => { const r = document.querySelector('.ai-row[data-kind=\"media\"]'); return r ? r.textContent : ''; }")
        f.check(lang != 'ja' or ('青い空' in row and '後ろに下げる' in row), 'the review row shows the caption and the suggestion: %r' % row)
        await f.shot('vision_review')
        done = await page.evaluate(DONE)
        await page.click('.ai-review-foot .btn.primary')
        await f.until("(id) => { const e = window.__mv.doc.media.list.find((x) => x.id === id); return !!e.ai && e.ai.depth === 'back'; }",
                      'the description is written', sky)
        f.check(await page.evaluate(DONE) == done + 1, 'applying is one undo step')
        await page.evaluate("(id) => { const a = window.__mv; a.openPanel('details'); a.media.openAsset(id); }", sky)
        await f.until("() => !!document.querySelector('.med-page .med-depth')", 'the asset page shows the AI suggestion')
        said = await page.evaluate("() => document.querySelector('.med-page .med-ai').textContent")
        f.check(lang != 'ja' or ('後ろに下げる' in said and '青い空' in said), 'the caption and 動きと重なり suggestion: %r' % said)
        await f.shot('asset_ai')
    # a video's pictures for 写真の説明: three frames of the range it is used in (clipIn 0.5 s: frames 18, 30, 42), upright,
    # at its size (the counter clip is under 768 px)
    await drop(f, '[data-mount="inspector"]', ['海.mp4'])
    if await f.until("() => window.__mv.doc.media.list.some((e) => e.name === '海.mp4')", 'the video is imported', timeout=30000):
        sea = await page.evaluate("() => window.__mv.doc.media.list.find((e) => e.name === '海.mp4').id")
        # its bytes are stored and checked after the entry appears; only a playable asset is described
        await f.until("(id) => window.__mv.media.state(id) === 'ok'", 'the video is ready', sea, timeout=30000)
        done = await page.evaluate(DONE)
        await page.evaluate("""(id) => window.__mv.batch({ label: ['undo.pin', { field: '', scope: '' }] }, [
          { t: 'pin.set', path: 'work:ground', v: 'photoPan', by: 'user' }, { t: 'pin.set', path: 'work:ground@photoPan.image', v: id, by: 'user' },
          { t: 'pin.set', path: 'work:ground@photoPan.clipIn', v: 0.5, by: 'user' }])""", sea)
        codes = await page.evaluate("""async (id) => { const out = await window.__mv.media.visionParts([id]);
          const parts = out.length ? out[0].parts : [];
          return Promise.all(parts.map(async (p) => { const bytes = Uint8Array.from(atob(p.inline_data.data), (c) => c.charCodeAt(0));
            const img = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
            const r = [img.width, img.height, window.MVMediaGen.codeOf(img, 0)]; img.close(); return r; })); }""", sea)
        f.check(codes == [[192, 108, 18], [192, 108, 30], [192, 108, 42]], 'a video sends frames 18, 30 and 42 of its range: %r' % codes)
        await f.blur()
        while await page.evaluate(DONE) > done:
            await page.keyboard.press('Control+z')
            await f.settle(1)
    # the asset page: 使う › 作品全体, 置き換える… with a photo of the same kind (one step, the pins follow), then 削除 asks and
    # clears the pins
    await page.evaluate("() => window.__mv.media.openLibrary()")
    await f.until("() => !document.querySelector('.med-page') && !!document.querySelector('.med-row')", 'the library again')
    await page.click('.med-row[data-id="%s"]' % forest)
    await f.until("() => !!document.querySelector('.med-page')", 'the asset page opens')
    crumb = await page.evaluate("() => document.querySelector('[data-mount=\"inspector\"] .insp-crumbs').textContent")
    f.check('森.jpg' in crumb, 'the crumb names the asset: %r' % crumb)
    await page.click('.med-page [data-use="work"]')
    await f.until("(id) => { const p = window.__mv.doc.pins['work:ground@photoPan.image']; return !!p && p.v === id; }", '使う › 作品全体', forest)
    await page.evaluate("(id) => window.__mv.media.openAsset(id)", forest)
    await f.until("() => !!document.querySelector('.med-page [data-act=\"replace\"]')", 'the asset page again')
    done = await page.evaluate(DONE)
    await choose_files(f, lambda: page.click('.med-page [data-act="replace"]'), ['森2.jpg'])
    await f.until("(id) => !window.__mv.doc.media.list.some((e) => e.id === id)", '置き換える… replaces the asset', forest, timeout=10000)
    forest2 = await page.evaluate("() => window.__mv.doc.media.list.find((e) => e.name === '森2.jpg' || e.name === '森.jpg').id")
    f.check(await page.evaluate(PIN_V, 'work:ground@photoPan.image') == {'v': forest2, 'by': 'user'} and forest2 != forest,
            'the pins follow the new file')
    f.check(await page.evaluate(DONE) == done + 1 and await page.evaluate(LAST_LABEL) == 'undo.media.relink', 'in one undo step')
    await page.evaluate("(id) => window.__mv.media.openAsset(id)", forest2)
    await f.until("() => !!document.querySelector('.med-page [data-act=\"delete\"]')", 'the asset page again')
    note = await page.evaluate("() => { const n = document.querySelector('.med-page .med-delete .note'); return n ? n.textContent : ''; }")
    f.check(lang != 'ja' or '1か所' in note, '削除 says how many places use it: %r' % note)
    await page.click('.med-page [data-act="delete"]')
    await f.until("() => !!document.querySelector('dialog.dlg[open] .btn.danger')", '削除 asks first')
    await page.click('dialog.dlg[open] .btn.danger')
    await f.until("(id) => !window.__mv.doc.media.list.some((e) => e.id === id)", 'the asset is deleted', forest2)
    pins = await page.evaluate("(id) => Object.entries(window.__mv.doc.pins).filter(([p, x]) => x.v === id || p === 'work:ground').map(([p]) => p)", forest2)
    f.check(pins == [], 'its pins and the emptied background part go: %r' % pins)
    await f.undo_all(done0, doc0)


# The overlay's opacity at a design point (the placeholder plates are opaque there).
PLATE_AT = """([x, y]) => { const a = window.__mv; const c = document.querySelector('.canvas-overlay');
  const k = c.width / a.plan.design.w; const px = Math.round(x * k), py = Math.round(y * k);
  const d = c.getContext('2d').getImageData(Math.max(0, px - 20), py, 40, 1).data;
  let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 150) n++; return n; }"""
# The centre of the box of an element at the playhead (design units), or null.
BOX_OF = """(owner) => { const a = window.__mv; const cut = a.plan.cuts.find((x) => x.t0 <= a.time() && a.time() < x.t1);
  const b = cut && a.engine.boxes().find((x) => x.cut === cut.key && x.owner === owner);
  if (!b) return null; const q = b.quad;
  return [(Math.min(q[0], q[2], q[4], q[6]) + Math.max(q[0], q[2], q[4], q[6])) / 2, (Math.min(q[1], q[3], q[5], q[7]) + Math.max(q[1], q[3], q[5], q[7])) / 2]; }"""


async def tab_to(page, sel, most=80):
    """Presses Tab until the focus is on (or inside) sel; True when it got there."""
    for _ in range(most):
        if await page.evaluate("(s) => !!document.activeElement && !!document.activeElement.closest(s)", sel):
            return True
        await page.keyboard.press('Tab')
    return await page.evaluate("(s) => !!document.activeElement && !!document.activeElement.closest(s)", sel)


async def flow_missing(f, lang):
    """Missing media (DESIGN_2_1 §11.2.9, §11.7.8, §11.7.9, §12.7): 軽い保存 of a work with a photo background and a
    photo frame on line 1; opened in another browser (an empty IndexedDB) both are missing: a toast with [つなぎ直す],
    the media row's ？ (its name says so too), a placeholder plate where each picture is drawn (the frame's in its corner,
    the background's in the middle); saving a package then says in its result which pictures are not in the file;
    step ④ is blocked by media-missing, whose [つなぎ直す] opens the library. With the mouse: the row's [つなぎ直す] with the
    same file brings the background back (映像を準備中 does not stay on for the frame still missing); the missing frame's
    page offers neither 使う nor 写真の説明; another file for it is refused with [代わりにこのファイルを使う], which uses it;
    the export is allowed. The keyboard-only variant does the same with Tab, Space and Enter only, from step ④ through the
    library and the asset page to the file dialog (the one step a page test drives by its file chooser)."""
    page = f.page
    await media_page(f)
    await with_lyrics(f)
    await make_files(f, [{'kind': 'png', 'name': '夕焼け.png', 'w': 1280, 'h': 720, 'color': '#e08040'},
                         {'kind': 'png', 'name': '枠.png', 'w': 800, 'h': 600, 'color': '#40c0a0'},
                         {'kind': 'png', 'name': '別.png', 'w': 640, 'h': 480, 'color': '#8040c0'},
                         {'kind': 'video', 'name': '海.mp4'}])
    await drop(f, '.canvas-wrap', ['夕焼け.png'])
    if not await f.until("() => !!window.__mv.doc.pins['work:ground@photoPan.image']", 'the photo background', timeout=15000):
        return
    # 枠.png as a photo frame on line 1, from its asset page, in the corner
    first = await page.evaluate('() => window.__mv.plan.lines[0].id')
    await page.evaluate("(id) => { const a = window.__mv; a.openPanel('details'); a.select({ level: 'line', ids: [id] }, { from: 'crumbs', open: true }); }", first)
    await f.settle(2)
    await drop(f, '[data-mount="inspector"]', ['枠.png'])
    if not await f.until("() => window.__mv.doc.media.list.length === 2 && !!document.querySelector('.toast .toast-act')", 'the frame picture', timeout=15000):
        return
    photo, frame = await page.evaluate(MEDIA_IDS)
    await page.evaluate("(id) => window.__mv.media.openAsset(id)", frame)
    await f.until("() => !!document.querySelector('.med-page [data-use=\"frame\"]')", 'the frame picture\'s page')
    await page.click('.med-page [data-use="frame"]')
    slot = await page.evaluate("""([id, line]) => new Promise((r) => { const t0 = Date.now(); const tick = () => {
      const k = Object.keys(window.__mv.doc.pins).find((p) => p.startsWith('line/' + line + ':ornament#') && window.__mv.doc.pins[p].v === id);
      if (k || Date.now() - t0 > 3000) r(k ? k.split(':')[1].split('@')[0] : null); else setTimeout(tick, 50); }; tick(); })""", [frame, first])
    if not f.check(slot is not None, '写真の枠として places the frame on line 1'):
        return
    await page.evaluate("([p]) => window.__mv.dispatch({ t: 'pin.set', path: p, v: 'corner', by: 'user' }, { label: ['undo.pin', { field: '', scope: '' }] })",
                        ['line/%s:%s@photoFrame.place' % (first, slot)])
    # 海.mp4 as line 2's background (dropped on the preview while line 2 is selected)
    second = await page.evaluate('() => window.__mv.plan.lines[1].id')
    await page.evaluate("(id) => window.__mv.select({ level: 'line', ids: [id] }, { from: 'crumbs', open: true })", second)
    await f.settle(2)
    await drop(f, '.canvas-wrap', ['海.mp4'])
    if not await f.until("(p) => !!window.__mv.doc.pins[p]", 'the video on line 2', 'line/%s:ground@photoPan.image' % second, timeout=30000):
        return
    video = (await page.evaluate(MEDIA_IDS))[2]
    pngs = {n: await page.evaluate(FILE_BYTES, n) for n in ('夕焼け.png', '枠.png', '別.png', '海.mp4')}
    # ≡ › ファイル (§12.7): 保存, 名前を付けて保存…, 軽い保存…, 写真・動画を読み込む… in that order; 軽い保存 downloads the .json
    await page.evaluate("() => { window.showSaveFilePicker = undefined; }")
    await f.blur()
    await page.click('[data-act="menu.open"]')
    await f.until("() => !!document.querySelector('.popover.menu')", 'the ≡ menu opens')
    rows = await page.evaluate(MENU_ROWS)
    want = [await page.evaluate("(k) => window.__mv.t(k)", k) for k in ('cmd.file.save', 'cmd.file.saveAs', 'cmd.file.saveLight', 'cmd.media.import')]
    at = [rows.index(w) if w in rows else -1 for w in want]
    f.check(min(at) > rows.index('#' + await page.evaluate("() => window.__mv.t('menu.file')")) and at == sorted(at) and at[-1] - at[0] == 3,
            '≡ › ファイル: 保存, 名前を付けて保存…, 軽い保存…, 写真・動画を読み込む…: %r' % rows[:12])
    await f.shot('file_menu')
    async with page.expect_download(timeout=20000) as info:
        await page.click('.popover.menu .menu-item:has-text("%s")' % want[2])
    text = Path(await (await info.value).path()).read_text(encoding='utf-8')
    f.check(photo in text and frame in text and video in text and '"blob"' not in text, 'the light save names the assets by id only')
    chooser = lambda n: {'name': pngs[n]['name'], 'mimeType': pngs[n]['mimeType'], 'buffer': bytes(pngs[n]['bytes'])}
    for mode in ('mouse', 'keys'):
        other = await extra_page(f, app_url(f, '?fresh=1&test=1'))
        for rel in MEDIA_HELPERS:
            await other.evaluate((ROOT / rel).read_text(encoding='utf-8'))
        await other.evaluate("""async (text) => { const a = window.__mv; a.view.setPref('autoplay', false); a.view.setPref('ai', true);
          window.showSaveFilePicker = undefined;
          await a.io.openFiles([new File([text], '作品.json', { type: 'application/json' })]); a.pause(); }""", text)
        g = Flow(f.name, other, f.shots)
        g.errors = f.errors
        await g.until("(ids) => ids.every((id) => window.__mv.media.state(id) === 'missing')", 'the three are missing on this device (%s)' % mode,
                      [photo, frame, video], timeout=10000)
        await g.until("() => [...document.querySelectorAll('.toast .toast-act')].some((b) => b.textContent === window.__mv.t('media.relink'))",
                      'a toast offers つなぎ直す (%s)' % mode)
        if mode == 'mouse':
            await other.evaluate("() => { const a = window.__mv; a.openPanel('details'); a.select({ level: 'el', scope: 'work', el: 'ground' }, { from: 'crumbs', open: true }); }")
            await g.settle(3)
            q = await other.evaluate("(s) => { const x = document.querySelector(s + ' .w-media-q'); return !!x && !x.hidden; }", FIELD % 'ground@photoPan.image')
            label = await other.evaluate("(s) => document.querySelector(s + ' .w-media').getAttribute('aria-label')", FIELD % 'ground@photoPan.image')
            g.check(q and (lang != 'ja' or 'この端末にありません' in label), 'the media row shows ？ and its name says so: %r' % label)
            await other.click(FIELD % 'ground@photoPan.image' + ' .w-media')
            await g.until("() => !!document.querySelector('.med-picker')", 'its picker')
            tile = await other.evaluate("(id) => document.querySelector('.med-picker .pb-tile[data-id=\"' + id + '\"]').getAttribute('aria-label')", photo)
            g.check(lang != 'ja' or 'この端末にありません' in tile, 'a picker tile\'s name says the picture is not here: %r' % tile)
            await other.keyboard.press('Escape')
            # what the plates say (the overlay's text, recorded as it is drawn): a video is called a video
            await other.evaluate("""() => { const o = document.querySelector('.canvas-overlay').getContext('2d'); const real = o.fillText.bind(o);
              window.__plates = new Set(); o.fillText = (t, x, y) => { window.__plates.add(t); return real(t, x, y); }; }""")
            await other.evaluate("(id) => { const a = window.__mv; const c = a.plan.cuts.find((x) => x.line === id); a.pause(); a.seek((c.t0 + c.t1) / 2); }", second)
            await other.wait_for_timeout(600)
            await g.settle(4)
            said = await other.evaluate("() => [...window.__plates]")
            g.check(lang != 'ja' or '動画がありません: 海.mp4' in said, 'a missing video\'s plate says 動画: %r' % said)
            # the plates: where each picture is drawn (the frame's in its corner, the background's in the middle), and no
            # 映像を準備中
            # a moment of line 1 where the camera shows the whole frame
            span = await other.evaluate("(id) => { const cs = window.__mv.plan.cuts.filter((x) => x.line === id); return [cs[0].t0, cs[cs.length - 1].t1]; }", first)
            centre = await other.evaluate("() => [window.__mv.plan.design.w / 2, window.__mv.plan.design.h / 2]")
            fbox = None
            for k in range(1, 12):
                await other.evaluate("(t) => { window.__mv.pause(); window.__mv.seek(t); }", span[0] + (span[1] - span[0]) * k / 12)
                await g.settle(3)
                box = await other.evaluate(BOX_OF, slot)
                if box and 120 < box[0] < 2 * centre[0] - 120 and 80 < box[1] < 2 * centre[1] - 80 and abs(box[0] - centre[0]) > 200:
                    fbox = box
                    break
            await other.wait_for_timeout(800)
            await g.settle(4)
            plates = {'frame': await other.evaluate(PLATE_AT, fbox) if fbox else None, 'centre': await other.evaluate(PLATE_AT, centre),
                      'badge': not await other.evaluate("() => document.querySelector('.stage-media').hidden"), 'box': fbox}
            g.check(fbox is not None and abs(fbox[0] - centre[0]) > 80 and plates['frame'] > 30 and plates['centre'] > 30 and not plates['badge'],
                    'a plate where each missing picture is, without 映像を準備中: %r' % plates)
            await g.shot('missing')
            # 保存 as a package while they are missing: the result says what is not in the file, and stays
            await g.blur()
            async with other.expect_download(timeout=30000):
                await other.keyboard.press('Control+s')
            await other.wait_for_timeout(1500)
            warn = await other.evaluate("""() => [...document.querySelectorAll('.toast.toast-warn')].map((x) => ({ text: x.querySelector('.toast-text').textContent,
              acts: [...x.querySelectorAll('.toast-act')].map((b) => b.textContent) }))""")
            saved = [w for w in warn if w['text'].startswith(await other.evaluate("() => window.__mv.t('io.savedPkg', { name: '', size: '', what: '' }).split(':')[0]"))]
            g.check(saved and (lang != 'ja' or '写真・動画3件' in saved[0]['text']) and saved[0]['acts'] == [await other.evaluate("() => window.__mv.t('media.relink')")],
                    'the saved toast says which pictures are not in the file, with つなぎ直す, and stays: %r' % warn)
            await g.shot('saved_missing')
        # step ④: blocked by media-missing
        await other.evaluate("() => { if (document.activeElement) document.activeElement.blur(); }")
        await other.keyboard.press('4')
        await g.until("() => window.__mv.view.state.step === 'export'", '4 = step ④ (%s)' % mode)
        if mode == 'mouse':
            await choose_other(other, 'png')     # a PNG sequence needs no encoder (this Chromium has no H.264)
        else:
            # keyboard only: Tab to その他 ▾; P picks PNG連番 (the select's own type-ahead)
            g.check(await tab_to(other, '[data-other="format"]'), 'Tab reaches その他 (keys)')
            await other.keyboard.press('p')
        await g.until("() => window.__mv.doc.output.format === 'png'", 'PNG chosen (%s)' % mode)
        await g.settle(3)
        blocked = await other.evaluate("() => ({ item: !!document.querySelector('.check[data-code=\"media-missing\"]'), off: document.querySelector('[data-act=\"export.start\"]').disabled })")
        g.check(blocked == {'item': True, 'off': True}, 'export is blocked by media-missing (%s): %r' % (mode, blocked))
        link = '.check[data-code="media-missing"] .link'
        for n, name in enumerate(['夕焼け.png', '枠.png', '海.mp4']):
            # [つなぎ直す] opens the library, the focus on the first missing row
            if mode == 'mouse':
                await other.click(link)
            else:
                g.check(await tab_to(other, link), 'Tab reaches the pre-flight [つなぎ直す] (keys, %d)' % n)
                await other.keyboard.press('Enter')
            await g.until("() => !!document.activeElement && document.activeElement.classList.contains('med-row') && document.activeElement.classList.contains('is-missing')",
                          'つなぎ直す opens the library with the focus on a missing row (%s, %d)' % (mode, n))
            if mode == 'mouse' and n == 0:
                await g.shot('library_missing')
            target = await other.evaluate("() => document.activeElement.dataset.id")
            g.check(target == [photo, frame, video][n], 'the first missing row is %s (%s)' % (name, mode))
            if mode == 'mouse' and n == 1:
                # the missing frame's page: no 使う, no 写真の説明 (つなぎ直すと使えます)
                await other.evaluate("(id) => window.__mv.media.openAsset(id)", frame)
                await g.until("() => !!document.querySelector('.med-page [data-act=\"relink\"]')", 'the missing frame\'s page')
                page_state = await other.evaluate("""() => ({ use: [...document.querySelectorAll('.med-page .med-use .btn')].every((b) => b.disabled),
                  vision: (() => { const b = document.querySelector('.med-page [data-act="vision"]'); return b ? b.disabled : null; })(),
                  note: [...document.querySelectorAll('.med-page .med-ai .note')].map((x) => x.textContent).join(' ') })""")
                g.check(page_state['use'] and page_state['vision'] is True and (lang != 'ja' or 'つなぎ直すと使えます' in page_state['note']),
                        'a missing picture offers neither 使う nor 写真の説明: %r' % page_state)
                await g.shot('asset_missing')
                # another file is refused, with [代わりにこのファイルを使う]
                async with other.expect_file_chooser() as fc:
                    await other.click('.med-page [data-act="relink"]')
                await (await fc.value).set_files([chooser('別.png')])
                await g.until("(t) => [...document.querySelectorAll('.toast .toast-act')].some((b) => b.textContent === t)", 'a stand-in is offered',
                              await other.evaluate("() => window.__mv.t('media.useInstead')"), timeout=10000)
                await other.evaluate("(t) => [...document.querySelectorAll('.toast .toast-act')].find((b) => b.textContent === t).click()",
                                     await other.evaluate("() => window.__mv.t('media.useInstead')"))
                await g.until("([id, v]) => !window.__mv.doc.media.list.some((e) => e.id === id) && window.__mv.doc.media.list.every((e) => e.id === v || window.__mv.media.state(e.id) === 'ok')",
                              'the other file stands in for the frame', [frame, video], timeout=10000)
                await other.evaluate("() => window.__mv.goStep('export')")
                await g.settle(3)
                continue
            async with other.expect_file_chooser() as fc:
                if mode == 'mouse':
                    await other.click('.med-row[data-id="%s"] .med-relink' % target)
                else:
                    await other.keyboard.press('Enter')                  # the row opens its page, the focus on [つなぎ直す]
                    await g.until("() => !!document.activeElement && document.activeElement.dataset.act === 'relink'", 'the page\'s つなぎ直す has the focus (keys)')
                    await other.keyboard.press('Enter')
            await (await fc.value).set_files([chooser(name)])
            await g.until("(id) => window.__mv.media.state(id) === 'ok'", 'relinking the same file brings %s back (%s)' % (name, mode), target, timeout=10000)
            if mode == 'mouse' and n == 0:
                # the relinked row shows its poster at once (nothing was kept of it while it was missing)
                inked = await other.evaluate("""(id) => new Promise((r) => { const t0 = Date.now(); const tick = () => {
                  const c = document.querySelector('.med-row[data-id="' + id + '"] canvas.med-thumb');
                  let n = 0; if (c) { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; }
                  if (n || Date.now() - t0 > 4000) r(n); else setTimeout(tick, 100); }; tick(); })""", photo)
                g.check(inked > 0, 'the relinked photo\'s row shows its poster (%d px)' % inked)
                # the frame is still missing next to a background that is here: 映像を準備中 does not stay on
                await other.evaluate("(id) => { const a = window.__mv; const c = a.plan.cuts.find((x) => x.line === id); a.pause(); a.seek(c.repT !== undefined ? c.repT : (c.t0 + c.t1) / 2); }", first)
                seen = []
                for _ in range(4):
                    await other.wait_for_timeout(500)
                    seen.append(not await other.evaluate("() => document.querySelector('.stage-media').hidden"))
                g.check(not any(seen[1:]), '映像を準備中 does not stay on while a missing picture is shown: %r' % seen)
            await other.evaluate("() => window.__mv.goStep('export')")
            await g.settle(3)
        await g.until("() => !document.querySelector('.check[data-code=\"media-missing\"]') && !document.querySelector('[data-act=\"export.start\"]').disabled",
                      'export is allowed again (%s)' % mode)
        f.problems += g.problems
        await close_extra(f, other)


# The save dialog, faked: each call hands out an OPFS file handle (window.__pickName, else the first type's extension)
# and records the call; writes to it are slowed by window.__slow ms (the progress row and the header can be read).
FAKE_SAVE = """async () => {
  const root = await navigator.storage.getDirectory();
  window.__picks = [];
  window.__slow = 0;
  window.showSaveFilePicker = async (o) => {
    const exts = (o.types || []).map((x) => Object.values(x.accept)[0][0]);
    window.__picks.push({ name: o.suggestedName, exts });
    const h = await root.getFileHandle(window.__pickName || ('保存' + exts[0]), { create: true });
    const make = h.createWritable.bind(h);
    h.createWritable = async (opt) => {
      const w = await make(opt);
      const write = w.write.bind(w);
      w.write = async (x) => { if (window.__slow) await new Promise((r) => setTimeout(r, window.__slow)); return write(x); };
      return w;
    };
    return h;
  };
}"""
# An OPFS file's text (a package is store-only: project.json is readable in it), or null.
OPFS_TEXT = """async (name) => { try { const root = await navigator.storage.getDirectory(); const f = await (await root.getFileHandle(name)).getFile();
  return new TextDecoder('latin1').decode(new Uint8Array(await f.arrayBuffer())); } catch (e) { return null; } }"""
OPFS_UTF8 = """async (name) => { try { const root = await navigator.storage.getDirectory(); const f = await (await root.getFileHandle(name)).getFile();
  return await f.text(); } catch (e) { return null; } }"""
HEADER_FILE = """() => { const s = document.querySelector('.save-state'); s.dispatchEvent(new PointerEvent('pointerenter')); return s.title; }"""
# Every toast text that appears from now on (a progress row may come and go within one task), until __rowObs.disconnect().
ROWS_SEEN = """() => { window.__rows = []; window.__rowObs = new MutationObserver((records) => { for (const r of records) for (const n of r.addedNodes) {
  if (!(n instanceof Element)) continue; for (const t of [n, ...n.querySelectorAll('*')]) if (t.classList && t.classList.contains('toast-text')) window.__rows.push(t.textContent); } });
  window.__rowObs.observe(document.body, { childList: true, subtree: true }); }"""
MENU_RUN = """(k) => [...document.querySelectorAll('.popover.menu .menu-item')].find((b) => b.textContent.startsWith(window.__mv.t(k))).click()"""


async def flow_package(f, lang):
    """The project file (DESIGN_2_1 §12.7, §12.8 G): ≡ › 保存 writes a .mojipv through the save dialog (faked with an
    OPFS handle), which offers the package first; while it writes, the header reads 「ファイルに保存中… n%」 and a progress
    row has [中止]; 保存しました says what is in it and the header 「…に保存」; Ctrl+S writes the same file again without the
    dialog; 軽い保存 writes a .json, and Ctrl+S then keeps the .json; [中止] during 名前を付けて保存… leaves the work and the
    files as they were; a package opened says 「…に開きました」 (not 「…に保存」) until it is saved."""
    page = f.page
    await media_page(f)
    done0, doc0 = await with_lyrics(f)
    await make_files(f, [{'kind': 'png', 'name': '夕焼け.png', 'w': 640, 'h': 360, 'color': '#e08040'}])
    await drop(f, '.canvas-wrap', ['夕焼け.png'])
    if not await f.until("() => !!window.__mv.doc.pins['work:ground@photoPan.image']", 'the photo background', timeout=15000):
        return
    photo = (await page.evaluate(MEDIA_IDS))[0]
    await page.evaluate(FAKE_SAVE)
    await page.evaluate("() => { window.__pickName = 'テスト.mojipv'; window.__slow = 120; }")
    # ≡ › 保存: the dialog offers the package first; the header and the progress row while it writes
    await f.blur()
    await page.click('[data-act="menu.open"]')
    await f.until("() => !!document.querySelector('.popover.menu')", 'the ≡ menu opens')
    await page.evaluate(MENU_RUN, 'cmd.file.save')
    saving = await page.evaluate("""(w) => new Promise((r) => { const t0 = Date.now(); let seen = null, row = null; const tick = () => {
      const s = document.querySelector('.save-state');
      if (s.dataset.state === 'file') seen = s.textContent;
      const x = [...document.querySelectorAll('.toast.is-sticky')].find((e) => e.textContent.startsWith(w));
      if (x) row = { text: x.querySelector('.toast-text').textContent, acts: [...x.querySelectorAll('.toast-act')].map((b) => b.textContent) };
      if ((seen && row) || Date.now() - t0 > 8000) r({ seen, row }); else requestAnimationFrame(tick); }; tick(); })""",
                               await page.evaluate("() => window.__mv.t('io.savingPkg', { p: 0 }).split('…')[0]"))
    f.check(saving['seen'] and (lang != 'ja' or saving['seen'].startswith('ファイルに保存中… ')), 'the header reads ファイルに保存中… n%%: %r' % saving)
    f.check(saving['row'] and saving['row']['acts'] == [await page.evaluate("() => window.__mv.t('media.cancel')")], 'the progress row has [中止]: %r' % saving)
    await f.shot('saving')
    await f.until("(t) => [...document.querySelectorAll('.toast .toast-text')].some((x) => x.textContent.startsWith(t))", '保存しました',
                  await page.evaluate("() => window.__mv.t('io.savedPkg', { name: 'テスト.mojipv', size: '', what: '' }).split('（')[0]"), timeout=20000)
    picks = await page.evaluate("() => window.__picks")
    f.check(len(picks) == 1 and picks[0]['exts'][0] == '.mojipv', 'the dialog offers the package first: %r' % picks)
    pkg = await page.evaluate(OPFS_TEXT, 'テスト.mojipv')
    f.check(pkg is not None and pkg.startswith('PK') and 'project.json' in pkg and ('media/' + photo) in pkg, 'a .mojipv with the photo and project.json')
    f.check(await page.evaluate("() => document.querySelector('.save-state').dataset.state") != 'file', 'the header is back after the save')
    title = await page.evaluate(HEADER_FILE)
    f.check(lang != 'ja' or ('テスト.mojipv' in title and 'に保存' in title), 'the header names the file: %r' % title)
    # Ctrl+S: the same file, no dialog
    await page.evaluate("() => { window.__slow = 0; window.__mv.dispatch({ t: 'pin.set', path: 'work:text.scale', v: 1.25, by: 'user' }, { label: ['undo.pin', { field: '', scope: '' }] }); }")
    await f.blur()
    await page.keyboard.press('Control+s')
    await f.until("() => window.__mv.io.fileState() && !window.__mv.io.fileState().dirty", 'Ctrl+S saves', timeout=20000)
    pkg2 = await page.evaluate(OPFS_TEXT, 'テスト.mojipv')
    f.check(await page.evaluate("() => window.__picks.length") == 1 and pkg2 is not None and '"work:text.scale"' in pkg2,
            'Ctrl+S writes the package again without the dialog')
    # 軽い保存: a .json through the dialog; Ctrl+S then keeps the .json
    await page.evaluate("() => { window.__pickName = 'テスト.json'; }")
    await page.click('[data-act="menu.open"]')
    await f.until("() => !!document.querySelector('.popover.menu')", 'the ≡ menu again')
    await page.evaluate(MENU_RUN, 'cmd.file.saveLight')
    await f.until("() => window.__picks.length === 2", 'the light save asks where', timeout=10000)
    await f.until("() => window.__mv.io.fileState() && window.__mv.io.fileState().name === 'テスト.json' && !window.__mv.io.fileState().dirty",
                  '軽い保存 writes the .json', timeout=10000)
    light = await page.evaluate(OPFS_UTF8, 'テスト.json')
    f.check(light is not None and photo in light and '"blob"' not in light, 'the .json names the photo by id only')
    await page.evaluate("() => window.__mv.dispatch({ t: 'pin.set', path: 'work:text.scale', v: 1.5, by: 'user' }, { label: ['undo.pin', { field: '', scope: '' }] })")
    await f.blur()
    await page.keyboard.press('Control+s')
    await f.until("() => window.__mv.io.fileState() && !window.__mv.io.fileState().dirty", 'Ctrl+S saves the .json', timeout=10000)
    light2 = await page.evaluate(OPFS_UTF8, 'テスト.json')
    f.check(await page.evaluate("() => window.__picks.length") == 2 and light2 is not None and '1.5' in light2
            and await page.evaluate(OPFS_TEXT, 'テスト.mojipv') == pkg2, 'Ctrl+S keeps the kind: the .json again, the package untouched')
    # [中止] during 名前を付けて保存…: the work and the files stay as they were
    before = await page.evaluate(DOC)
    await page.evaluate("() => { window.__pickName = 'やめる.mojipv'; window.__slow = 400; }")
    await page.click('[data-act="menu.open"]')
    await f.until("() => !!document.querySelector('.popover.menu')", 'the ≡ menu once more')
    await page.evaluate(MENU_RUN, 'cmd.file.saveAs')
    stop = await page.evaluate("() => window.__mv.t('media.cancel')")
    await f.until("(t) => [...document.querySelectorAll('.toast.is-sticky .toast-act')].some((b) => b.textContent === t)", 'the progress row', stop, timeout=10000)
    await page.evaluate("(t) => [...document.querySelectorAll('.toast.is-sticky .toast-act')].find((b) => b.textContent === t).click()", stop)
    await page.wait_for_timeout(1500)
    state = await page.evaluate("() => ({ file: window.__mv.io.fileState(), header: document.querySelector('.save-state').dataset.state })")
    f.check(await page.evaluate(DOC) == before and state['file']['name'] == 'テスト.json' and state['header'] != 'file',
            '[中止] leaves the work and its file as they were: %r' % state)
    f.check(not await page.evaluate("(t) => [...document.querySelectorAll('.toast .toast-text')].some((x) => x.textContent.includes('やめる.mojipv'))", ''),
            'nothing says it was saved')
    await page.evaluate("() => { window.__slow = 0; }")
    await f.undo_all(done0, doc0)
    # a package opened: its progress row 「開いています: テスト.mojipv n%（写真・動画 i/n）」, then 「…に開きました」 until it is saved
    await page.evaluate(ROWS_SEEN)
    await page.evaluate("""async (text) => { const root = await navigator.storage.getDirectory(); const f = await (await root.getFileHandle('テスト.mojipv')).getFile();
      await window.__mv.io.openFiles([new File([await f.arrayBuffer()], 'テスト.mojipv')]); }""", '')
    await f.until("() => window.__mv.doc.media.list.length === 1", 'the package opens', timeout=15000)
    rows = await page.evaluate("() => { window.__rowObs.disconnect(); return window.__rows; }")
    f.check(lang != 'ja' or any(r.startswith('開いています: テスト.mojipv') and '写真・動画' in r for r in rows), 'opening shows its progress row: %r' % rows)
    title = await page.evaluate(HEADER_FILE)
    f.check(lang != 'ja' or ('テスト.mojipv' in title and 'に開きました' in title), 'an opened file says when it was opened: %r' % title)


async def flow_media_device(f, lang):
    """Photos and videos on this device (DESIGN_2_1 §11.2.7, §11.3.6): a work opened again from 最近の作品 whose picture
    (one nothing has shown or read since) is deleted and the delete undone keeps the picture's bytes through the
    autosave's pruning; a file still being read when another work is opened lands nowhere, even when its reader finishes;
    ≡ › 設定 › 消す forgets every picture the preview held, so the work opened afterwards shows its pictures missing and
    step ④ blocks; a poster that gave nothing is asked again once the bytes are back."""
    page = f.page
    await media_page(f)
    await with_lyrics(f)
    await make_files(f, [{'kind': 'png', 'name': '太陽.png', 'w': 640, 'h': 360, 'color': '#e0a040'},
                         {'kind': 'png', 'name': '月.png', 'w': 320, 'h': 180, 'color': '#4060e0'},
                         {'kind': 'png', 'name': '遅い.png', 'w': 320, 'h': 180, 'color': '#40e0a0'}])
    await drop(f, '.canvas-wrap', ['太陽.png'])
    if not await f.until("() => !!window.__mv.doc.pins['work:ground@photoPan.image']", 'the photo background', timeout=15000):
        return
    sun = (await page.evaluate(MEDIA_IDS))[0]
    # 月: only in 写真・動画 (nothing shows it, so nothing reads its bytes after the work is opened again)
    await page.evaluate("async () => { await window.__mv.media.importFiles([window.__files['月.png']]); }")
    moon = await page.evaluate("() => (window.__mv.doc.media.list.find((e) => e.name === '月.png') || {}).id")
    if not f.check(moon, '月 joins 写真・動画'):
        return
    light = await page.evaluate("() => MV.use('core/doc').serialize({ doc: window.__mv.doc, side: window.__mv.store.side })")
    await page.evaluate("async () => { await window.__mv.io.flush(); }")
    # 最近の作品: another work, then this one again; delete 月, autosave, undo: its bytes are still here
    work = (await page.evaluate("async () => (await window.__mv.io.recent()).map((w) => w.id)"))[0]
    await page.evaluate("""async () => { const a = window.__mv; await a.io.newWork(); a.dispatch({ t: 'lyrics.set', text: '別の作品\\n二行目' }, { label: ['undo.paste', {}] });
      await a.io.flush(); }""")
    await page.evaluate("async (id) => { await window.__mv.io.openRecent(id); }", work)
    await f.until("(ids) => ids.every((id) => window.__mv.doc.media.list.some((e) => e.id === id) && window.__mv.media.state(id) === 'ok')",
                  'the work is back with its pictures', [sun, moon], timeout=10000)
    await page.evaluate("(id) => { window.__mv.media.remove(id); }", moon)
    await f.until("() => !!document.querySelector('dialog.dlg[open] .btn.danger')", '削除 asks')
    await page.click('dialog.dlg[open] .btn.danger')
    await f.until("(id) => !window.__mv.doc.media.list.some((e) => e.id === id)", 'deleted', moon)
    kept = await page.evaluate("async (id) => { await window.__mv.io.flush(); return window.__mv.io.device.hasMedia(id); }", moon)
    f.check(kept, 'the autosave keeps the bytes of the reopened work\'s picture (undo may bring it back)')
    await f.blur()
    await page.keyboard.press('Control+z')
    await f.until("(id) => window.__mv.doc.media.list.some((e) => e.id === id)", 'undo brings 月 back', moon)
    back = await page.evaluate("async (id) => { await window.__mv.io.flush(); return { here: await window.__mv.io.device.hasMedia(id), state: window.__mv.media.state(id) }; }", moon)
    f.check(back == {'here': True, 'state': 'ok'}, 'and its bytes are here: %r' % back)
    # a file still being read when another work opens lands nowhere, even when its reader finishes anyway
    await page.evaluate(SLOW_IMPORT, [1500, True])
    await page.evaluate("() => window.__mv.select({ level: 'line', ids: [window.__mv.plan.lines[1].id] }, { from: 'crumbs' })")
    await drop(f, '.canvas-wrap', ['遅い.png'])
    await page.wait_for_timeout(300)
    await page.evaluate("""async () => { const D = MV.use('core/doc'); const C = MV.use('core/commands');
      const doc = C.reduce(D.defaultDoc(), { t: 'lyrics.set', text: 'ほかの作品\\n二行目' });
      await window.__mv.io.openFiles([new File([D.serialize({ doc, side: D.defaultSide() })], 'ほか.json', { type: 'application/json' })]); }""")
    await page.wait_for_timeout(2500)
    other = await page.evaluate("() => ({ media: window.__mv.doc.media.list.length, pins: Object.keys(window.__mv.doc.pins).length, title: window.__mv.doc.sheet.rows[0].src })")
    f.check(other == {'media': 0, 'pins': 0, 'title': 'ほかの作品'}, 'the file read for the other work lands nowhere: %r' % other)
    await f.until("(t) => [...document.querySelectorAll('.toast .toast-text')].some((x) => x.textContent === t)", 'it says the import stopped',
                  await page.evaluate("() => window.__mv.t('media.cancelled', { name: '遅い.png' })"))
    await page.evaluate(FAST_IMPORT)
    # ≡ › 設定 › 消す, then the light save of the first work: its pictures are missing (月 too, which the preview never
    # drew), and step ④ blocks
    await page.evaluate("async () => { await window.__mv.io.clearDevice(); }")
    await page.evaluate("async (text) => { await window.__mv.io.openFiles([new File([text], '作品.json', { type: 'application/json' })]); }", light)
    await f.until("(id) => window.__mv.doc.media.list.some((e) => e.id === id)", 'the first work opens', sun, timeout=10000)
    await f.until("(ids) => ids.every((id) => window.__mv.media.state(id) === 'missing' && window.__mv.assets.info(id).state === 'missing')",
                  'after 消す its pictures are missing on this device', [sun, moon], timeout=10000)
    items = await page.evaluate("() => window.__mv.media.preflight().map((i) => i.code)")
    f.check('media-missing' in items, 'step ④ blocks: %r' % items)
    # a poster that gave nothing is asked again once the bytes are back another way (another tab, a package)
    got = await page.evaluate("""async (id) => { const a = window.__mv; const before = await a.media.poster(id);
      await MV.use('media/host/probe').importFile(window.__files['太陽.png'], { name: '太陽.png', store: a.io.device, canvas: a.svc.canvas });
      a.assets.forget(id); await a.assets.check([id]);
      const after = await a.media.poster(id); return [before === null, !!after, a.media.state(id)]; }""", sun)
    f.check(got == [True, True, 'ok'], 'a picture that gave no poster is asked again when its bytes are back: %r' % got)


async def flow_media_song(f, lang):
    """A video's sound on step ② (DESIGN_2_1 §11.7.2; NOTES v2.1-G.4): a music video dropped on the song box
    (「曲を選ぶ（ここにドロップも可）」) gives the song its sound (and joins 写真・動画); a video with sound dropped on the
    preview while step ② is shown is placed, and the toast offers [この動画の音を曲にする] until it is used or closed;
    the same video again says もう入っています with the same action; using it makes that video's sound the song."""
    page = f.page
    await media_page(f)
    await with_lyrics(f)
    await make_files(f, [{'kind': 'video', 'name': 'MV.mp4', 'audio': True},
                         {'kind': 'video', 'name': '別MV.mp4', 'audio': True, 'frames': 40}])
    if not f.check(await page.evaluate("async () => (await window.__files['MV.mp4'].arrayBuffer()).byteLength > 0 && window.MVMediaGen.encodeTone && !!(await window.MVMediaGen.encodeTone(0.1))"),
                   'this browser encodes Opus (a video with sound)'):
        return
    await f.blur()
    await page.keyboard.press('2')
    await f.until("() => window.__mv.view.state.step === 'song' && !!document.querySelector('.song-box')", '2 = step ②')
    await drop(f, '.song-box', ['MV.mp4'])
    await f.until("() => !!window.__mv.doc.song", 'the video dropped on the song box gives the song', timeout=20000)
    mv = await page.evaluate("() => window.__mv.doc.media.list.find((e) => e.name === 'MV.mp4')")
    f.check(mv is not None and mv['audio'] is True, 'the video joins 写真・動画 as a video with sound')
    song = await page.evaluate("() => window.__mv.doc.song.sha1")
    await f.shot('song_box')
    # on the preview while step ② is shown: placed, with [この動画の音を曲にする] kept until used
    act = await page.evaluate("() => window.__mv.t('media.useAudio')")
    await drop(f, '.canvas-wrap', ['別MV.mp4'])
    await f.until("() => !!window.__mv.doc.pins['work:ground@photoPan.image']", 'the second video is placed', timeout=20000)
    await page.wait_for_timeout(6800)                                     # longer than a toast lives
    placed = await page.evaluate("(a) => [...document.querySelectorAll('.toast')].filter((x) => [...x.querySelectorAll('.toast-act')].some((b) => b.textContent === a)).map((x) => x.querySelector('.toast-text').textContent)", act)
    f.check(lang != 'ja' or placed == ['背景を動画にしました（作品全体）'], 'the placed toast offers the sound and stays: %r' % placed)
    await drop(f, '[data-mount="inspector"]', ['別MV.mp4'])
    dup = await page.evaluate("""(a) => new Promise((r) => { const t0 = Date.now(); const tick = () => {
      const x = [...document.querySelectorAll('.toast')].find((e) => e.querySelector('.toast-text').textContent.startsWith(window.__mv.t('media.dup', { name: '' })));
      if (x || Date.now() - t0 > 8000) r(x ? [...x.querySelectorAll('.toast-act')].map((b) => b.textContent) : null); else setTimeout(tick, 50); }; tick(); })""", act)
    f.check(dup == [act], 'the same video again: もう入っています with the sound action: %r' % dup)
    await page.evaluate("(a) => [...document.querySelectorAll('.toast .toast-act')].find((b) => b.textContent === a).click()", act)
    await f.until("(s) => !!window.__mv.doc.song && window.__mv.doc.song.sha1 !== s", 'この動画の音を曲にする makes that video\'s sound the song', song, timeout=20000)


# --- v2.1 editor-ready output (package H.3, DESIGN_2_1 §13.10, §13.12): 形式, the Filmora set, 透過動画, 字幕 --------------

# Where this Chromium has no H.264 encoder (local runs), the Filmora set's MP4s use VP9 in MP4, as tests/browser/kit_check.py
# does, and the probe reports that codec, so step ④ lets the set start; the UI path is the same. Where H.264 encodes (CI's
# Chrome), nothing is patched. → 'h264' | 'vp9'
KIT_CODECS = r"""async () => {
  const a = window.__mv, S = MV.use('export/schedule');
  let h264 = false;
  try {
    h264 = typeof VideoEncoder === 'function' && !!(await VideoEncoder.isConfigSupported({ codec: 'avc1.42001f', width: 1280,
      height: 720, bitrate: 2e6, framerate: 30 })).supported;
  } catch (e) { h264 = false; }
  if (h264) return 'h264';
  const ex = a.svc.exporter, mp4 = ex.mp4, kit = ex.kit;
  ex.mp4 = Object.assign({}, mp4, { probe: async (o) => Object.assign({}, await mp4.probe(o), { codec: S.pickVp9(o.w, o.h, o.fps)[0], anyCodec: true }) });
  ex.kit = Object.assign({}, kit, { exportKit: (o) => {
    const { w, h } = S.outputSize(a.plan.design.aspect, o.doc.output.short);
    return kit.exportKit(Object.assign({ codecs: { video: S.pickVp9(w, h, o.doc.output.fps)[0] } }, o));
  } });
  return 'vp9';
}"""
# The folder picker, faked (a page test cannot click it): the OPFS folder 'kit_pick' stands for the folder the user picks;
# window.__dirPicks records each call's options.
FAKE_DIR = r"""async () => {
  const root = await navigator.storage.getDirectory();
  try { await root.removeEntry('kit_pick', { recursive: true }); } catch (e) { /* not there yet */ }
  window.__dirPicks = [];
  window.showDirectoryPicker = async (o) => { window.__dirPicks.push(o); return root.getDirectoryHandle('kit_pick', { create: true }); };
}"""
# The files of a folder inside 'kit_pick' → [[name, bytes]] by name, or null when there is no such folder.
OPFS_DIR = r"""async (name) => {
  const root = await navigator.storage.getDirectory();
  try {
    const dir = await (await root.getDirectoryHandle('kit_pick')).getDirectoryHandle(name);
    const out = [];
    for await (const [n, h] of dir.entries()) out.push([n, h.kind === 'file' ? (await h.getFile()).size : -1]);
    return out.sort((x, y) => (x[0] < y[0] ? -1 : 1));
  } catch (e) { return null; }
}"""
# An OPFS file's bytes (a list of numbers), or null.
OPFS_BYTES = r"""async (name) => { try { const root = await navigator.storage.getDirectory();
  return Array.from(new Uint8Array(await (await (await root.getFileHandle(name)).getFile()).arrayBuffer())); } catch (e) { return null; } }"""
# Every running state of the export from now on: the set's phase, the phase line step ④ showed with it and the progress
# bar's text; the footer's buttons [text, data-act, disabled]; what the step's status region said (each new text once).
WATCH_EXPORT = r"""() => { window.__phases = []; window.__views = new Set(); window.__footers = []; window.__said = [];
  window.__mv.bus.on('export', (x) => {
  const said = document.querySelector('.step-export .exp-said[role="status"]');
  if (said && said.textContent && window.__said[window.__said.length - 1] !== said.textContent) window.__said.push(said.textContent);
  if (x.phase !== 'running') return;
  const el = document.querySelector('.step-export .exp-phase');
  const bar = document.querySelector('.step-export .exp-running [role="progressbar"]');
  window.__views.add(document.querySelector('.step-export .exp-running .exp-title'));
  window.__footers.push([...document.querySelectorAll('.footer-export button')].map((b) => [b.textContent, b.dataset.act || '', b.disabled]));
  window.__phases.push([x.part, el && !el.hidden ? el.textContent : null, bar ? bar.getAttribute('aria-valuetext') : null]); }); }"""
# The kit exporter as step ④ calls it, spied: whether it got the preview's AssetStore (app.assets, shared by its forks).
SPY_KIT_ASSETS = r"""() => { const a = window.__mv, ex = a.svc.exporter, kit = ex.kit;
  window.__kitAssets = [];
  ex.kit = Object.assign({}, kit, { exportKit: (o) => { window.__kitAssets.push(!!o.assets && o.assets === a.assets); return kit.exportKit(o); } }); }"""
# Step ④ as the set sees it.
KIT_STATE = r"""() => { const a = window.__mv, box = document.querySelector('.kit-box');
  return { format: a.doc.output.format, backdrop: a.doc.look.backdrop, kit: a.doc.output.kit,
    boxes: [...document.querySelectorAll('.kit-set input[type="checkbox"]')].filter((b) => !b.closest('[hidden]'))
      .map((b) => [b.id.replace('exp-kit-', ''), b.checked, b.disabled]),
    green: (() => { const n = document.querySelector('.kit-set [data-note="kit-chroma"]'); return n && !n.hidden ? n.textContent : null; })(),
    folderHint: (() => { const n = document.querySelector('.step-export [data-note="kit-folder"]'); return n && !n.hidden ? n.textContent : null; })(),
    backdrops: [...document.querySelectorAll('[data-ctl="backdrop"] option')].map((o) => o.value),
    shown: box.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true }), summary: document.querySelector('.exp-summary').textContent,
    more: document.querySelector('.step-export details.more > summary').textContent,
    checks: Object.fromEntries([...document.querySelectorAll('.step-export .check')].map((c) => [c.dataset.code, c.querySelector('.check-body span').textContent])) }; }"""
# What the set would write now (export/schedule.kitFiles with the probe's audio codec) and the summary line that says so.
KIT_WANT = r"""() => { const a = window.__mv, S = MV.use('export/schedule'), T = MV.use('i18n/t'), pr = a.exportProbe() || {};
  const files = S.kitFiles(a.doc, a.plan, { audioCodec: pr.audioCodec, songReady: a.songReady() });
  const dir = typeof window.showDirectoryPicker === 'function';
  return { names: files.map((x) => x.name), base: S.kitBase(a.doc), aac: pr.audioCodec === 'mp4a.40.2',
    summary: a.t('exp.kit.summary', { n: files.length, size: T.fmtBytes(files.reduce((s, x) => s + x.est, 0)),
      where: a.t(dir ? 'exp.kit.toFolder' : 'exp.kit.toZip') }) }; }"""
# The open help sheet (a <dialog>), or null.
SHEET = r"""() => { const d = document.querySelector('dialog.dlg[open]');
  if (!d) return null;
  const steps = d.querySelector('.kit-steps'), files = d.querySelector('.kit-help-files');
  return { title: d.querySelector('.dlg-title').textContent, intro: d.querySelector('.dlg-body > .dlg-text').textContent,
    files: [...d.querySelectorAll('.kit-help-files .kit-file-name')].map((x) => x.textContent),
    steps: [...d.querySelectorAll('.kit-steps li')].map((x) => x.textContent),
    extras: [...d.querySelectorAll('.kit-extras li > span:first-child')].map((x) => x.textContent),
    key: !!d.querySelector('.kit-key'), keyInGreen: !!d.querySelector('.kit-extras li[data-kind="green"] .kit-key'),
    stepsFirst: !!(steps && files && (steps.compareDocumentPosition(files) & Node.DOCUMENT_POSITION_FOLLOWING)),
    inside: d.contains(document.activeElement) }; }"""
# The steps the guide should show for the set the settings describe (ui/filmora_help over export/schedule.kitFiles).
SHEET_WANT = r"""() => { const a = window.__mv, H = MV.use('ui/filmora_help'), pr = a.exportProbe() || {};
  const g = H.guide(H.planned(a.doc, a.plan, { audioCodec: pr.audioCodec, songReady: a.songReady() }), a.t);
  return { steps: g.steps, extras: g.extras.map((x) => x.text) }; }"""
EXPORT_DONE = "() => ['done', 'error'].includes(window.__mv.exportState().phase)"
# Step ④'s done state.
DONE_STATE = r"""() => { const st = window.__mv.exportState(), el = document.querySelector('.step-export .exp-running');
  return { phase: st.phase, message: st.message || null, files: [...el.querySelectorAll('.kit-done-files .kit-file-name')].map((x) => x.textContent),
    metas: [...el.querySelectorAll('.kit-done-files .kit-file-meta')].map((x) => x.textContent),
    info: [...el.querySelectorAll('.exp-done .muted')].map((x) => x.textContent).join(' | '), result: st.result ? { folder: st.result.folder,
      name: st.result.name || null, files: (st.result.files || []).map((x) => [x.name, x.bytes]) } : null }; }"""
# The probe without VP9 (a browser that cannot write transparent video): on → every new probe says vp9Codec null; off → back.
NO_VP9 = r"""(on) => { const ex = window.__mv.svc.exporter;
  if (on) { ex.__mp4 = ex.mp4; ex.mp4 = Object.assign({}, ex.mp4, { probe: async (o) => Object.assign({}, await ex.__mp4.probe(o), { vp9Codec: null }) }); }
  else if (ex.__mp4) { ex.mp4 = ex.__mp4; delete ex.__mp4; } }"""
# The fix button of a pre-flight item, by code.
FIX_OF = """(code) => { const li = document.querySelector('.step-export .check[data-code="' + code + '"]');
  const b = li && li.querySelector('.check-actions .link'); return b ? b.textContent : null; }"""


async def no_vp9_fix(f, fmt, fix_key, fixed_js, what, focus):
    """Where VP9 does not encode, `no-vp9` blocks 透過動画 and the set's transparent video, and its fix button does `what`;
    the focus then goes to the control it changed (`focus`, as FOCUS names it), not to the page (A11Y-1)."""
    page = f.page
    fps = await page.evaluate('() => window.__mv.doc.output.fps')
    await page.evaluate(NO_VP9, True)
    await page.evaluate("(v) => window.__mv.dispatch({ t: 'output.set', key: 'fps', v }, { label: ['undo.output', {}] })", 24 if fps != 24 else 60)
    if not await f.until("() => window.__mv.exportChecks().some((c) => c.code === 'no-vp9')", 'no VP9: no-vp9 (%s)' % fmt, timeout=15000):
        return
    await f.settle(2)
    label = await page.evaluate(FIX_OF, 'no-vp9')
    f.check(label == await page.evaluate('(k) => window.__mv.t(k)', fix_key) and await page.is_disabled('[data-act="export.start"]'),
            'no VP9 blocks %s, with [%s]: %r' % (fmt, what, label))
    await page.focus('.step-export .check[data-code="no-vp9"] .check-actions .link')
    await page.keyboard.press('Enter')
    await f.settle(2)
    f.check(await page.evaluate(fixed_js) and not await page.evaluate("() => window.__mv.exportChecks().some((c) => c.code === 'no-vp9')"),
            'the fix %s and the block goes' % what)
    f.check(await page.evaluate(FOCUS) == focus, 'the focus goes to what the fix changed (%s), not the page: %r' % (focus, await page.evaluate(FOCUS)))
    await page.evaluate(NO_VP9, False)
    await page.evaluate("(v) => window.__mv.dispatch({ t: 'output.set', key: 'fps', v }, { label: ['undo.output', {}] })", fps)
    await f.until('() => !!window.__mv.exportProbe()', 'probed again', timeout=15000)


FOCUS = r"""() => { const e = document.activeElement;
  return e ? e.dataset.v || e.dataset.other || e.dataset.kitHelp || e.dataset.act || e.id || e.tagName.toLowerCase() : null; }"""


async def flow_kit(f, lang):
    """The Filmora set (DESIGN_2_1 §13.10, §13.12 flow "kit"): Filmora用 is one undo entry and keeps the backdrop (背景 does
    not offer 透明 then, so exploring it keeps the set); 詳しく shows the set's contents (完成動画 and the README always in,
    the WAV where the browser cannot put the song into the MP4; each checkbox one undo entry; the rows add up to the
    summary line's count; the green screen's how-to under its box) and where the set goes; its pre-flight names the
    Filmora project settings; 「Filmoraで使うには」 opens from 詳しく with the steps first, then the other files' uses, and
    closes with Esc; 書き出す asks for a folder (the picker, faked with OPFS) and writes the files there with the preview's
    AssetStore, the progress saying 動画 then 曲・字幕・説明 (also to screen readers and in the progress bar's text); the
    done state lists the files written and the folder inside the picked one, and its guide names both; 中止 removes the
    folder it made, and the next export has its 中止 again; without a folder picker the same files come as one ZIP
    download (phase ZIP), and a set too large for memory asks first."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    await page.evaluate(AI_WAV_JS)
    f.check(await page.evaluate("async () => { await window.__mv.loadSong(window.__wav(12, 'song.wav')); return window.__mv.songReady(); }"),
            'the test song loads')
    codec = await page.evaluate(KIT_CODECS)
    await page.evaluate(SPY_KIT_ASSETS)
    await page.evaluate(FAKE_DIR)
    await page.evaluate(WATCH_EXPORT)
    await page.evaluate("""() => { const a = window.__mv;
      a.batch({ label: ['undo.output', {}] }, [{ t: 'output.set', key: 'short', v: 720 }, { t: 'output.set', key: 'fps', v: 30 },
        { t: 'output.set', key: 'range', v: { t0: 1, t1: 2 } }, { t: 'output.set', key: 'audio', v: true }]);
      a.goStep('export'); }""")
    await f.until('() => !!window.__mv.exportProbe()', 'the encoders are probed', timeout=15000)
    await f.settle(2)
    t = lambda key, params=None: page.evaluate('([k, p]) => window.__mv.t(k, p || {})', [key, params])  # noqa: E731
    done = await page.evaluate(DONE)
    await page.click('[data-seg="format"] [data-v="kit"]')
    await f.settle(2)
    st = await page.evaluate(KIT_STATE)
    f.check([st['format'], st['backdrop']] == ['kit', 'scene'], 'Filmora用 keeps the backdrop: %r' % [st['format'], st['backdrop']])
    f.check(await page.evaluate(DONE) == done + 1, 'Filmora用 is one undo entry')
    f.check(await page.get_attribute('[data-seg="format"] [data-v="kit"]', 'aria-checked') == 'true', 'Filmora用 is the checked option')
    f.check(not st['shown'], 'the set\'s contents wait inside 詳しく')
    f.check(st['more'] == await t('exp.moreKit'), '詳しく says it holds the set\'s contents: %r' % st['more'])
    f.check(await page.evaluate("() => document.querySelector('.step-export [data-note=\"alpha\"]').hidden"),
            'the transparency note is not shown for the set (it has its own transparent video)')
    want = await page.evaluate(KIT_WANT)
    f.check(st['folderHint'] == await t('exp.kit.folderHint', {'folder': want['base'] + '_filmora'}),
            'where the set goes: a new folder inside the one the user picks: %r' % st['folderHint'])
    # 背景 without 透明 for the set, and a trip through its list comes back to the set (UX-H3-6)
    f.check(st['backdrops'] == ['scene', 'chroma', 'black'], 'Filmora用 does not offer 透明: %r' % st['backdrops'])
    for choice in ('chroma', 'scene'):
        await page.select_option('[data-ctl="backdrop"] select', choice)
        await f.settle(1)
        got = await page.evaluate(OUTPUT)
        f.check(got[:2] == ['kit', choice], '背景 %s keeps Filmora用: %r' % (choice, got))
        note = await page.evaluate("() => { const n = document.querySelector('.step-export [data-note=\"chroma\"]'); return n.hidden ? null : n.textContent; }")
        f.check(note == (await t('exp.chromaNote') if choice == 'chroma' else None), 'the green screen\'s how-to under 背景 (%s): %r' % (choice, note))
    f.check(not await page.is_disabled('#exp-audio'), '音声を入れる applies to the set')
    await choose_other(page, 'webmAlpha')
    await f.settle(1)
    f.check(not await page.is_disabled('#exp-audio'), '… and to 透過動画 (Opus in the WebM)')
    await choose_other(page, 'png')
    await f.settle(1)
    f.check(await page.is_disabled('#exp-audio'), '… not to a PNG sequence')
    await page.click('[data-seg="format"] [data-v="kit"]')
    await f.settle(1)
    await page.click('.step-export details.more > summary')
    await f.settle(1)
    st = await page.evaluate(KIT_STATE)
    want = await page.evaluate(KIT_WANT)
    f.check(st['shown'], '詳しく shows the set\'s contents')
    always = [['wav', True, True]] if not want['aac'] else []
    f.check(st['boxes'] == [['main', True, True], ['overlay', True, False], ['bg', False, False], ['green', False, False],
                            ['srt', True, False], ['lrc', False, False]] + always + [['readme', True, True]],
            'the contents and their defaults (完成動画 and the README always; the WAV without AAC): %r' % st['boxes'])
    f.check(st['summary'] == want['summary'], 'the summary line counts the set: %r (want %r)' % (st['summary'], want['summary']))
    f.check(sum(1 for _, on, _ in st['boxes'] if on) == len(want['names']), 'the ticked rows add up to the summary\'s count (%d)' % len(want['names']))
    for key in ('bg', 'lrc', 'green'):
        done = await page.evaluate(DONE)
        await page.click('label[for="exp-kit-%s"]' % key)
        await f.settle(1)
        st = await page.evaluate(KIT_STATE)
        f.check(st['kit'][key] is True and await page.evaluate(DONE) == done + 1, '%s joins the set, one undo entry: %r' % (key, st['kit']))
    f.check(st['green'] == await t('exp.chromaNote'), 'the green screen\'s how-to under its box: %r' % st['green'])
    await page.click('label[for="exp-kit-green"]')
    await f.settle(1)
    st = await page.evaluate(KIT_STATE)
    f.check(st['kit']['green'] is False and st['green'] is None, 'and it goes with the box')
    want = await page.evaluate(KIT_WANT)
    f.check(st['summary'] == want['summary'] and '%d' % len(want['names']) in st['summary'], 'the summary follows: %r' % st['summary'])
    f.check(sum(1 for _, on, _ in st['boxes'] if on) == len(want['names']), 'and the rows still add up to it')
    f.check(st['checks'].get('kit-fps') == await t('exp.pre.kit-fps', {'fps': 30, 'w': 1280, 'h': 720}), 'the Filmora project settings: %r' % st['checks'])
    f.check('kit-size' in st['checks'], '720p: 1080p or 4K is easier in Filmora')
    f.check(('kit-wav' in st['checks']) == (not want['aac']), 'the WAV note exactly when AAC does not encode (aac=%s)' % want['aac'])
    f.check(not any(c.endswith('memory') for c in st['checks']), 'a folder can be written: no memory note')
    f.check(not any('{' in v for v in st['checks'].values()), 'every pre-flight text is filled in: %r' % st['checks'])
    await f.shot(lang + '_kit_more')
    await no_vp9_fix(f, 'the set', 'exp.pre.noOverlay', '() => window.__mv.doc.output.kit.overlay === false', 'leaves the transparent video out',
                     'exp-kit-overlay')
    await page.click('label[for="exp-kit-overlay"]')
    await f.settle(1)
    f.check((await page.evaluate(KIT_STATE))['kit']['overlay'] is True, 'the transparent video is back in the set')
    # 「Filmoraで使うには」 from 詳しく: the steps first, then 「必要なときだけ」, then the files
    await page.click('[data-kit-help="planned"]')
    await f.until('() => !!document.querySelector("dialog.dlg[open]")', 'the guide opens')
    sheet = await page.evaluate(SHEET)
    guide = await page.evaluate(SHEET_WANT)
    f.check(sheet and sheet['title'] == await t('kit.help.title') and sheet['intro'] == await t('kit.help.before'), 'the guide: %r' % sheet)
    f.check(sheet and sheet['files'] == want['names'] and sheet['steps'] == guide['steps'] and len(sheet['steps']) >= 2
            and sheet['extras'] == guide['extras'] and len(sheet['extras']) >= 3,
            'its files, numbered steps and other uses are the set\'s: %r' % (sheet and [sheet['steps'], sheet['extras']]))
    f.check(sheet and sheet['stepsFirst'], 'the steps come before the file list')
    f.check(sheet and sheet['inside'], 'the focus is inside the guide')
    await f.shot(lang + '_kit_help')
    await page.keyboard.press('Escape')
    await f.until('() => !document.querySelector("dialog.dlg[open]")', 'Esc closes the guide')
    f.check(await page.evaluate(FOCUS) == 'planned', 'the focus is back on 「Filmoraで使うには」')
    # 書き出す: the folder picker, then every file into a new folder in it
    await page.click('[data-act="export.start"]')
    if not await f.until(EXPORT_DONE, 'the set is written', timeout=180000):
        return
    res = await page.evaluate(DONE_STATE)
    folder = want['base'] + '_filmora'
    f.check(res['phase'] == 'done', 'the set is written: %r' % res['message'])
    f.check(await page.evaluate('() => window.__dirPicks') == [{'mode': 'readwrite', 'id': 'mojipv-kit'}], 'the folder picker opened once, read-write')
    f.check(await page.evaluate('() => window.__kitAssets') == [True], 'the set\'s engine forks share the preview\'s AssetStore (app.assets)')
    f.check(res['files'] == want['names'], 'the done state lists the files written: %r' % res['files'])
    done_text = await t('exp.kit.doneIn', {'n': len(want['names']), 'folder': folder, 'parent': 'kit_pick'})
    f.check(res['info'] == done_text, 'and where: inside the picked folder: %r' % res['info'])
    f.check(await page.evaluate('() => window.__said.slice(-1)[0]') == await t('exp.done') + ' ' + done_text, 'and says so to screen readers')
    on_disk = await page.evaluate(OPFS_DIR, folder)
    f.check(on_disk is not None and sorted(n for n, _ in on_disk) == sorted(want['names']) and all(b > 0 for _, b in on_disk),
            'the folder %s holds every file: %r' % (folder, on_disk))
    f.check(len(res['metas']) == len(want['names']) and all(res['metas']), 'each file says what it is and its size: %r' % res['metas'])
    phases = await page.evaluate('() => window.__phases')
    parts = [p[0] for p in phases if p[0]]
    f.check(parts and parts[0] == 'video' and 'files' in parts and parts.index('files') > parts.index('video'),
            'the progress goes 動画 then 曲・字幕・説明: %r' % sorted(set(parts)))
    shown = {p[0]: p[1] for p in phases if p[0]}
    video_text = await t('exp.kit.phase', {'what': await t('exp.kit.what.video')})
    files_text = await t('exp.kit.phase', {'what': await t('exp.kit.what.files')})
    f.check(shown.get('video') == video_text, 'the phase line: %r' % shown)
    f.check(shown.get('files') == files_text, 'a new phase shows at once: %r' % shown)
    f.check(any(p[0] == 'files' and (p[2] or '').startswith(files_text) for p in phases), 'the progress bar\'s text names the phase: %r' % phases[-1:])
    said = await page.evaluate('() => window.__said')
    f.check(video_text in said and files_text in said and said.index(files_text) > said.index(video_text), 'the phases are said: %r' % said)
    f.check(await page.evaluate('() => window.__views.size') == 1 and len(phases) > 5,
            'the running view is made once and updated in place (%d progress events)' % len(phases))
    footers = await page.evaluate('() => window.__footers')
    only_cancel = [[await t('exp.cancel'), '', False]]
    f.check(footers and all(ft == only_cancel for ft in footers), 'while it runs the footer holds 中止 only: %r' % footers[:2])
    await f.shot(lang + '_kit_done')
    await page.click('[data-kit-help="written"]')
    await f.until('() => !!document.querySelector("dialog.dlg[open]")', 'the guide opens from the done state')
    sheet = await page.evaluate(SHEET)
    f.check(sheet and sheet['intro'] == await t('kit.help.folderIn', {'folder': folder, 'parent': 'kit_pick'}) and sheet['files'] == want['names'],
            'it names the folder, the one it is in and the files written: %r' % sheet)
    await page.click('dialog.dlg[open] .dlg-head .icon-btn')
    await f.until('() => !document.querySelector("dialog.dlg[open]")', '× closes the guide')
    # 中止 while the videos are written: the folder it made goes away
    await page.click('.footer-export .btn')
    await page.evaluate("""() => window.__mv.dispatch({ t: 'output.set', key: 'range', v: { t0: 0, t1: 8 } }, { label: ['undo.range', {}] })""")
    await f.settle(2)
    await page.click('[data-act="export.start"]')
    if await f.until("() => window.__mv.exportState().phase === 'running' && window.__mv.exportState().i >= 3", 'the second set is on its way', timeout=60000):
        await page.click('.footer-export .btn')
        await f.until("() => window.__mv.exportState().phase === 'idle'", '中止 stops it', timeout=30000)
        f.check(len(await page.evaluate('() => window.__dirPicks')) == 2, 'the picker opened for it')
        f.check(await page.evaluate(OPFS_DIR, folder + ' (2)') is None, 'the new folder (%s (2)) is removed' % folder)
        f.check(await page.evaluate(OPFS_DIR, folder) is not None, 'the first set stays')
    # no folder picker (Firefox, Safari): one ZIP download of the same files
    await page.evaluate("""() => { Object.defineProperty(window, 'showDirectoryPicker', { value: undefined, configurable: true });
      window.__mv.dispatch({ t: 'output.set', key: 'range', v: { t0: 1, t1: 2 } }, { label: ['undo.range', {}] }); }""")
    await f.settle(2)
    want = await page.evaluate(KIT_WANT)
    st = await page.evaluate(KIT_STATE)
    f.check(st['summary'] == want['summary'] and (await t('exp.kit.toZip')) in want['summary'], 'the summary says ZIPでダウンロード')
    f.check(st['folderHint'] is None, 'no folder is picked for a ZIP, so no hint about one')
    f.check(await page.evaluate("() => window.__mv.exportChecks().some((c) => c.code === 'kit-memory')"),
            'no folder picker: the set is built in memory (kit-memory; listed only when it asks first)')
    await page.evaluate('() => { window.__phases = []; window.__footers = []; }')
    async with page.expect_download(timeout=180000) as info:
        await page.click('[data-act="export.start"]')
    dl = await info.value
    data = Path(await dl.path()).read_bytes()
    names = [i.filename for i in zipfile.ZipFile(io.BytesIO(data)).infolist()]
    f.check(dl.suggested_filename == folder + '.zip' and names == want['names'], 'the ZIP %s holds the same files: %r' % (dl.suggested_filename, names))
    await f.until(EXPORT_DONE, 'the ZIP is done')
    res = await page.evaluate(DONE_STATE)
    f.check(res['info'] == await t('exp.kit.done', {'n': len(want['names']), 'folder': folder + '.zip'}), 'the done state names the ZIP: %r' % res['info'])
    # after 中止, this export has its 中止 again, and no working-looking 書き出す (H3-EXP-1)
    footers = await page.evaluate('() => window.__footers')
    f.check(footers and all(ft == only_cancel for ft in footers),
            'after 中止, the next export shows 中止 (enabled) and no 書き出す: %r' % footers[:2])
    phases = await page.evaluate('() => window.__phases')
    zip_text = await t('exp.kit.phase', {'what': await t('exp.kit.what.zip')})
    at = next((k for k, p in enumerate(phases) if p[0] == 'zip'), None)
    f.check(at is not None and phases[at][1] == zip_text and any(p[0] == 'files' for p in phases[:at]),
            'the last phase is ZIPを書き出し中, after 曲・字幕・説明: %r' % [p[:2] for p in phases if p[0] != 'video'])
    if codec == 'vp9':
        print('note  kit: this Chromium has no H.264 encoder, so the set\'s MP4s were VP9 in MP4 (CI\'s Chrome writes H.264)')
    await page.click('.footer-export .btn')
    await f.settle(1)
    await kit_memory_asks(f, t)
    await f.undo_all(done0, doc0)


async def kit_memory_asks(f, t):
    """A set too large to build in memory (no folder picker; `kit-memory` at confirm level, above 1.5 GiB) asks first,
    naming its size; キャンセル starts nothing and downloads nothing."""
    page = f.page
    downloads = []
    page.on('download', lambda d: downloads.append(d))
    await page.evaluate("async () => { await window.__mv.loadSong(window.__wav(60, 'long.wav')); }")
    await page.evaluate("""() => window.__mv.batch({ label: ['undo.output', {}] }, [{ t: 'output.set', key: 'short', v: 2160 },
      { t: 'output.set', key: 'fps', v: 60 }, { t: 'output.set', key: 'quality', v: 'max' }, { t: 'output.set', key: 'range', v: null },
      { t: 'output.set', key: 'kit', v: { overlay: true, bg: true, green: true, srt: true, lrc: true } }])""")
    await f.settle(2)
    item = await page.evaluate("() => window.__mv.exportChecks().find((c) => c.code === 'kit-memory') || null")
    if not f.check(item and item['level'] == 'confirm', 'a 2160p60 set of every file, a minute long, asks before building in memory: %r' % item):
        return
    await page.click('.footer-export [data-act="export.start"]')
    if await f.until("() => !!document.querySelector('dialog.dlg[open]') && window.__mv.exportState().phase === 'idle'", 'the set asks first'):
        text = await page.evaluate("() => document.querySelector('dialog.dlg[open]').textContent")
        size = await page.evaluate("(b) => MV.use('i18n/t').fmtBytes(b)", item['params']['bytes'])
        f.check(await t('exp.pre.memory.confirm', {'size': size}) in text, 'it names the size: %r' % text)
        no = 'dialog.dlg[open] .dlg-actions .btn:not(.primary)'
        f.check(await page.text_content(no) == await t('dlg.cancel'), 'with キャンセル (やめる)')
        await page.click(no)
        await f.until("() => !document.querySelector('dialog.dlg[open]')", 'キャンセル closes the question')
    await f.settle(3)
    f.check(await page.evaluate("() => window.__mv.exportState().phase") == 'idle' and not downloads, 'declining starts nothing and downloads nothing')


async def flow_kit_keys(f, lang):
    """The keyboard-only variant (DESIGN_2_1 §13.12): 形式 and なめらかさ are radio groups — one Tab stop each (the checked
    option), the arrows (and Home / End) choose and keep the focus, and the app's frame keys stay out; その他 ▾ is the next
    Tab stop (↓ picks 透過動画 there, which makes the backdrop 透明 — flow "webm" by keys —, ↓ again PNG連番, P PNG連番);
    the set's contents are checkboxes (Space); 「Filmoraで使うには」 opens with Enter and Esc gives the focus back; Enter
    on [書き出す] writes the set, and the done state's guide opens with Enter too."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    await page.evaluate(KIT_CODECS)
    await page.evaluate(FAKE_DIR)
    await page.evaluate("""() => window.__mv.batch({ label: ['undo.output', {}] }, [{ t: 'output.set', key: 'short', v: 720 },
      { t: 'output.set', key: 'range', v: { t0: 1, t1: 1.4 } }])""")
    await f.blur()
    await page.keyboard.press('4')
    await f.until("() => window.__mv.view.state.step === 'export'", '4 = step ④')
    await f.until('() => !!window.__mv.exportProbe()', 'the encoders are probed', timeout=15000)
    fmt = "() => window.__mv.doc.output.format"
    where = "() => [window.__mv.time(), JSON.stringify(window.__mv.view.state.sel)]"
    f.check(await tab_to(page, '[data-seg="format"] [role="radio"]'), 'Tab reaches 形式')
    f.check(await page.evaluate(FOCUS) == 'mp4', 'its Tab stop is the checked option, MP4')
    for key, want in (('ArrowRight', 'kit'), ('ArrowRight', 'mp4'), ('End', 'kit'), ('ArrowLeft', 'mp4'), ('ArrowDown', 'kit')):
        before = await page.evaluate(where)
        await page.keyboard.press(key)
        await f.settle(1)
        got = [await page.evaluate(fmt), await page.evaluate(FOCUS)]
        f.check(got == [want, want], '%s chooses %s and the focus follows: %r' % (key, want, got))
        f.check(await page.evaluate(where) == before, '%s neither moves the playhead nor the selection (the app keymap stays out)' % key)
    await page.keyboard.press('Tab')
    f.check(await page.evaluate(FOCUS) == 'format', 'Tab goes on to その他 ▾ (one stop for the radio pair)')
    # その他 › 透過動画 by keys: the backdrop becomes 透明 with it, in one undo entry (H3S-3)
    clear_label = "() => [...document.querySelectorAll('[data-ctl=\"backdrop\"] option')].find((o) => o.value === 'clear').textContent"
    for want in (['webmAlpha', 'clear', 'clear'], ['png', 'scene', 'scene']):
        done = await page.evaluate(DONE)
        await page.keyboard.press('ArrowDown')
        await f.settle(2)
        got = await page.evaluate(OUTPUT)
        f.check(got == want and await page.evaluate(DONE) == done + 1 and await page.evaluate(FOCUS) == 'format',
                '↓ in その他 ▾ picks %s (one undo entry, the focus stays): %r' % (want[0], [got, await page.evaluate(FOCUS)]))
        label = await page.evaluate(clear_label)
        f.check(label == await page.evaluate('(k) => window.__mv.t(k)', 'exp.bg.clearWebm' if want[0] == 'webmAlpha' else 'exp.bg.clearPng'),
                '背景 names what 透明 makes now: %r' % label)
    await page.keyboard.press('p')
    await f.settle(2)
    f.check(await page.evaluate(OUTPUT) == ['png', 'scene', 'scene'], 'P picks PNG連番 in その他 ▾: %r' % await page.evaluate(OUTPUT))
    await page.keyboard.press('Shift+Tab')
    f.check(await page.evaluate(FOCUS) == 'mp4', 'Shift+Tab: back to the pair, on its first option while none is checked')
    await page.keyboard.press('End')
    await f.settle(1)
    f.check(await page.evaluate(fmt) == 'kit', 'End chooses Filmora用')
    f.check(await tab_to(page, '[data-seg="fps"] [role="radio"]'), 'Tab reaches なめらかさ')
    f.check(await page.evaluate(FOCUS) == '30', 'its Tab stop is 30')
    await page.keyboard.press('ArrowRight')
    await f.settle(1)
    f.check(await page.evaluate('() => window.__mv.doc.output.fps') == 60 and await page.evaluate(FOCUS) == '60', '→ chooses 60')
    await page.keyboard.press('ArrowLeft')
    await f.settle(1)
    f.check(await page.evaluate('() => window.__mv.doc.output.fps') == 30, '← back to 30')
    f.check(await tab_to(page, '.step-export details.more > summary'), 'Tab reaches 詳しく')
    await page.keyboard.press('Enter')
    f.check(await page.evaluate("() => document.querySelector('.step-export details.more').open"), 'Enter opens 詳しく')
    f.check(await tab_to(page, '#exp-kit-bg'), 'Tab reaches 背景だけ（MP4）')
    await page.keyboard.press(' ')
    await f.settle(1)
    f.check(await page.evaluate('() => window.__mv.doc.output.kit.bg') is True, 'Space puts it into the set')
    f.check(await tab_to(page, '[data-kit-help="planned"]'), 'Tab reaches 「Filmoraで使うには」')
    await page.keyboard.press('Enter')
    await f.until('() => !!document.querySelector("dialog.dlg[open]")', 'Enter opens the guide')
    f.check((await page.evaluate(SHEET) or {}).get('inside'), 'the focus is inside the guide')
    await page.keyboard.press('Escape')
    await f.until('() => !document.querySelector("dialog.dlg[open]")', 'Esc closes it')
    f.check(await page.evaluate(FOCUS) == 'planned', 'the focus is back on the link')
    f.check(await tab_to(page, '[data-act="export.start"]'), 'Tab reaches [書き出す]')
    await page.keyboard.press('Enter')
    if not await f.until(EXPORT_DONE, 'the set is written (keys)', timeout=180000):
        return
    res = await page.evaluate(DONE_STATE)
    f.check(res['phase'] == 'done' and len(res['files']) >= 4, 'the done state lists the files (keys): %r' % res)
    f.check(await tab_to(page, '[data-kit-help="written"]'), 'Tab reaches the done state\'s guide')
    await page.keyboard.press('Enter')
    await f.until('() => !!document.querySelector("dialog.dlg[open]")', 'Enter opens it')
    await page.keyboard.press('Escape')
    await f.until('() => !document.querySelector("dialog.dlg[open]")', 'Esc closes it')
    f.check(await page.evaluate(FOCUS) == 'written', 'the focus is back')
    await page.evaluate('() => window.__mv.exportReset()')
    await f.undo_all(done0, doc0)


async def flow_webm(f, lang):
    """透過動画（WebM） (DESIGN_2_1 §13.3, §13.12 flow "webm"): その他 › 透過動画 sets the backdrop 透明 in one undo entry (the
    preview turns transparent; その他 is marked, the pair is not); the backdrop list names 透明 by what it makes; another
    backdrop turns 透過動画 into MP4, and 透明 turns MP4 back into 透過動画 and PNG連番 into 透過PNG; a short WebM (memory,
    downloaded) is a WebM file with the name the done state shows."""
    page = f.page
    done0, doc0 = await with_lyrics(f)
    await page.evaluate("() => window.__mv.goStep('export')")
    await f.settle(2)
    t = lambda key, params=None: page.evaluate('([k, p]) => window.__mv.t(k, p || {})', [key, params])  # noqa: E731
    bg = '[data-ctl="backdrop"] select'
    done = await page.evaluate(DONE)
    await choose_other(page, 'webmAlpha')
    await f.settle(2)
    f.check(await page.evaluate(OUTPUT) == ['webmAlpha', 'clear', 'clear'], 'その他 › 透過動画 makes the backdrop 透明: %r' % await page.evaluate(OUTPUT))
    f.check(await page.evaluate(DONE) == done + 1, 'one undo entry for the pair')
    ui = await page.evaluate("""() => { const s = document.querySelector('[data-other="format"]');
      return { on: s.classList.contains('is-on'), text: s.options[s.selectedIndex].textContent,
        radios: [...document.querySelectorAll('[data-seg="format"] [role="radio"]')].map((b) => [b.dataset.v, b.getAttribute('aria-checked'), b.tabIndex]),
        clear: [...document.querySelectorAll('[data-ctl="backdrop"] option')].find((o) => o.value === 'clear').textContent,
        note: document.querySelector('.step-export [data-note="alpha"]').hidden ? null : document.querySelector('.step-export [data-note="alpha"]').textContent }; }""")
    f.check(ui['on'] and ui['text'] == await t('exp.fmt.webmAlpha'), 'その他 shows 透過動画（WebM）, marked chosen: %r' % ui)
    f.check(ui['radios'] == [['mp4', 'false', 0], ['kit', 'false', -1]], 'the pair is unchecked, MP4 its Tab stop: %r' % ui['radios'])
    f.check(ui['clear'] == await t('exp.bg.clearWebm') and ui['note'] == await t('exp.alphaNote2'), '透明（透過動画） and the note: %r' % ui)
    f.check(await page.evaluate("() => document.querySelector('.step-export .kit-box').hidden"), 'no set contents for 透過動画')
    await f.shot(lang + '_webm')
    notes = """() => Object.fromEntries(['alpha', 'chroma'].map((k) => { const n = document.querySelector('.step-export [data-note="' + k + '"]');
      return [k, n.hidden ? null : n.textContent]; }))"""
    for choice, want in (('chroma', ['mp4', 'chroma', 'chroma']), ('clear', ['webmAlpha', 'clear', 'clear'])):
        done = await page.evaluate(DONE)
        await page.select_option(bg, choice)
        await f.settle(2)
        got = await page.evaluate(OUTPUT)
        f.check(got == want and await page.evaluate(DONE) == done + 1, '背景 %s → %r (one entry): %r' % (choice, want, got))
        shown = await page.evaluate(notes)
        want_notes = {'alpha': None, 'chroma': await t('exp.chromaNote')} if choice == 'chroma' else {'alpha': await t('exp.alphaNote2'), 'chroma': None}
        f.check(shown == want_notes, 'under 背景 %s: the green screen\'s how-to (#00B140) or the transparency note: %r' % (choice, shown))
    # a fix by keys: Enter on [透過動画にする] (MP4 with 透明, an older file) keeps the focus in step ④, and Space then
    # does not start playback (A11Y-1)
    await page.evaluate("""() => window.__mv.batch({ label: ['undo.output', {}] }, [{ t: 'output.set', key: 'format', v: 'mp4' },
      { t: 'look.set', key: 'backdrop', v: 'clear' }])""")
    await f.settle(2)
    await page.focus('.step-export .check[data-code="clear-mp4"] .check-actions .link')
    await page.keyboard.press('Enter')
    await f.settle(2)
    f.check(await page.evaluate(OUTPUT) == ['webmAlpha', 'clear', 'clear'], '[透過動画にする] makes it 透過動画')
    f.check(await page.evaluate(FOCUS) == 'format', 'the focus goes to その他 ▾, which now shows 透過動画: %r' % await page.evaluate(FOCUS))
    before = await page.evaluate(NOW)
    await page.keyboard.press(' ')
    await f.settle(3)
    f.check(await page.evaluate(NOW) == before and not await page.evaluate('() => window.__mv.view.state.playing'), 'Space does not start playback')
    await choose_other(page, 'png')
    await f.settle(2)
    f.check(await page.evaluate(OUTPUT) == ['png', 'scene', 'scene'], 'PNG連番 turns 透明 back to 通常')
    f.check(await page.evaluate("() => [...document.querySelectorAll('[data-ctl=\"backdrop\"] option')].find((o) => o.value === 'clear').textContent")
            == await t('exp.bg.clearPng'), 'from PNG連番, 透明 says 透過PNG')
    await page.select_option(bg, 'clear')
    await f.settle(2)
    f.check(await page.evaluate(OUTPUT) == ['pngAlpha', 'clear', 'clear'], 'PNG連番 + 透明 → 透過PNG (frames stay frames)')
    # a short 透過動画, built in memory and downloaded
    await choose_other(page, 'webmAlpha')
    await page.evaluate("""() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true });
      window.__mv.batch({ label: ['undo.output', {}] }, [{ t: 'output.set', key: 'short', v: 720 }, { t: 'output.set', key: 'range', v: { t0: 1, t1: 1.3 } }]); }""")
    await f.until('() => !!window.__mv.exportProbe()', 'the encoders are probed', timeout=15000)
    await f.settle(2)
    await no_vp9_fix(f, '透過動画', 'exp.pre.makeAlpha', "() => window.__mv.doc.output.format === 'pngAlpha' && window.__mv.doc.look.backdrop === 'clear'",
                     'makes it 透過PNG', 'format')
    await choose_other(page, 'webmAlpha')
    await f.settle(2)
    if await page.evaluate("() => window.__mv.exportChecks().some((c) => c.code === 'no-vp9')"):
        print('skip  webm: this browser has no VP9 encoder (the export is blocked by no-vp9)')
    else:
        name = await page.evaluate("() => MV.use('export/schedule').fileName(window.__mv.doc, 'webm')")
        async with page.expect_download(timeout=120000) as info:
            await page.click('[data-act="export.start"]')
        dl = await info.value
        data = Path(await dl.path()).read_bytes()
        f.check(dl.suggested_filename == name and data[:4] == b'\x1a\x45\xdf\xa3' and b'webm' in data[:64],
                'a WebM file named %s (%r, %r)' % (name, dl.suggested_filename, data[:8]))
        await f.until(EXPORT_DONE, 'the WebM is done')
        res = await page.evaluate(DONE_STATE)
        f.check(res['phase'] == 'done' and name in res['info'], 'the done state names it: %r' % res['info'])
        await page.click('.footer-export .btn')
    await f.undo_all(done0, doc0)


async def flow_subtitles(f, lang):
    """≡ › ファイル › 字幕（.srt）を保存 (DESIGN_2_1 §13.8): listed right after 時間つき歌詞（.lrc）; through the save dialog
    (faked with OPFS) it offers '<name>.srt' and writes UTF-8 with a BOM and CRLF, one cue per sung line of the whole
    video; without the dialog the same bytes are downloaded."""
    page = f.page
    await with_lyrics(f)
    await page.evaluate("""() => window.__mv.dispatch({ t: 'output.set', key: 'range', v: { t0: 2, t1: 3 } }, { label: ['undo.range', {}] })""")
    await page.evaluate(FAKE_SAVE)
    await page.evaluate("() => { window.__pickName = 'sub.srt'; }")
    await f.blur()
    await page.click('[data-act="menu.open"]')
    await f.until("() => !!document.querySelector('.popover.menu')", 'the ≡ menu opens')
    labels = await page.evaluate("() => [...document.querySelectorAll('.popover.menu .menu-item .menu-label')].map((x) => x.textContent)")
    srt, lrc = await page.evaluate("() => [window.__mv.t('cmd.file.saveSrt'), window.__mv.t('cmd.file.saveLrc')]")
    f.check(srt in labels and lrc in labels and labels.index(srt) == labels.index(lrc) + 1, 'ファイル lists 字幕（.srt）を保存 after .lrc: %r' % labels)
    await f.shot(lang + '_menu_file')
    await page.evaluate(MENU_RUN, 'cmd.file.saveSrt')
    await f.until('() => (window.__picks || []).length === 1', 'the save dialog opens')
    want = await page.evaluate("""() => { const a = window.__mv, SUB = MV.use('export/subtitles'), S = MV.use('export/schedule');
      return { text: SUB.BOM + SUB.srt(a.plan), name: S.kitBase(a.doc) + '.srt', lines: a.plan.lines.length }; }""")
    f.check(await page.evaluate('() => window.__picks') == [{'name': want['name'], 'exts': ['.srt']}], 'it offers %s' % want['name'])
    await f.until("async () => { const r = await navigator.storage.getDirectory(); try { return (await (await r.getFileHandle('sub.srt')).getFile()).size > 0; } catch (e) { return false; } }",
                  'the file is written')
    raw = bytes(await page.evaluate(OPFS_BYTES, 'sub.srt') or [])
    f.check(raw.startswith(b'\xef\xbb\xbf1\r\n') and b'\n' not in raw.replace(b'\r\n', b''), 'UTF-8 with a BOM, CRLF only: %r' % raw[:24])
    f.check(raw.decode('utf-8') == want['text'] and raw.count(b'\r\n\r\n') == want['lines'],
            'one cue per sung line of the whole video (not the export range)')
    # without a save dialog: a download of the same bytes
    await page.evaluate("() => Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true })")
    async with page.expect_download(timeout=30000) as info:
        await page.evaluate("() => window.__mv.actions.run('file.saveSrt', { from: 'palette' })")
    dl = await info.value
    f.check(dl.suggested_filename == want['name'] and Path(await dl.path()).read_bytes() == raw, 'the download is the same file: %r' % dl.suggested_filename)


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
# v2.1 photos and videos (package G.4, DESIGN_2_1 §11.8.3).
FLOWS += [('media', flow_media, True), ('library', flow_library, False), ('missing', flow_missing, False), ('package', flow_package, False),
          ('media_device', flow_media_device, False), ('media_song', flow_media_song, False)]
# v2.1 editor-ready output (package H.3, DESIGN_2_1 §13.12).
FLOWS += [('kit', flow_kit, False), ('kit_keys', flow_kit_keys, False), ('webm', flow_webm, False), ('subtitles', flow_subtitles, False)]


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
