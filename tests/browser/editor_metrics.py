#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: the lyric editor's two layers stay in step (docs/NOTES.md, "Lyric
editor: iOS drift"). The editor is a transparent textarea (caret, selection) over a mirror of coloured rows, and the
gutter follows the mirror, so one row laid out differently in the two layers moves every row below it.

With the sample lyrics plus hard rows (long rows that wrap, digits around a '/', no-break and full-width spaces, emoji, a
stamp, blank rows), in the step column and on phones upright and on their side, it asserts:
  - both layers compute the same text styles; the line height is whole px, the gutter's too;
  - every mirror row is whole lines and ends where a textarea holding rows 0..i ends, also with 25, 25.5 and 28.6 px
    lines (rows follow the line height, whatever an engine or a page zoom makes of it);
  - a click on each row puts the caret in that row; Ctrl+End does not scroll the textarea inside itself;
  - a row is one text node (with a <br> after a blank one); its token colours are highlight ranges equal to the
    editor's segments(), held only for the rows near the viewport, and they paint the colours the spans paint;
  - typing at the end of the last row until it wraps, and Enter there, never leave the caret below the editor's bottom;
  - one paste into the empty editor leaves the textarea as tall as its text; textarea text taller than the mirror
    (another engine's wrap, simulated with padding) makes the textarea taller, also after a deletion; a taller or
    shorter editor resizes the textarea to its bottom.
Then without Custom Highlights (`Highlight` removed before the app starts, as in Safari before 17.2) the mirror's spans
pass the same row checks. No page errors, no CSP violations.

Chromium only: this proves the structure, not WebKit's layout (its whole-px line boxes with separately rounded ascent
and descent, its break decisions at text node boundaries). The WebKit-only declarations, which Chromium drops, are kept
in the stylesheet by tests/node/ui_selection.test.js.

Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/editor_metrics.py [--root DIR] [--shots DIR]
"""
import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from browser import launch  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402
from transparent_check import decode_png  # noqa: E402  (standard-library PNG decoding)
from ui_flows import Flow, ensure_built, open_page, serve  # noqa: E402  (the flows' page and harness)

VIEWPORTS = ((1440, 900), (1024, 768), (390, 844), (430, 932), (844, 390))
GUTTER_MARGIN_PX = 240                # ui/lyric_editor: gutter entries and token ink cover the viewport ± this
# The hard rows: long rows that wrap (kana, Latin with marks, a URL, digits around cut marks), no-break and full-width
# spaces, emoji, a stamp, blank rows (empty, spaces, a tab, a full-width space) and a trailing empty row.
EDITOR_ROWS = [
    '', 'ずっと遠くまで続いていく長い長い坂道の途中で君の名前を何度も呼んだあの夏の日のことを今も覚えている',
    'Keep *running* through the night / keep running through the night until the morning light! | note',
    'https://example.com/a/very/long/path/without/any/break/opportunity/at/all/0123456789abcdefghijklmnop',
    'open 24/7 from 12/31 to 1/1, 24時間/365日 ずっと 3.14/2.71 and ½/¾ of the way',
    'ことば と ことば の あいだ  に　　ある もの を　さがして いる よ',
    '🎤 うたう 🎶✨ 🌸 君と 👩‍👩‍👧 いっしょに 🏳️‍🌈', '[00:12.50]時計の針が/止まるまで!', '   ', '\t', '　', '',
]
# Everything that lays text out; both layers must compute the same values (properties this engine lacks are skipped).
EDITOR_KEYS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'fontVariant', 'fontKerning',
    'fontVariantLigatures', 'fontFeatureSettings', 'fontVariationSettings', 'fontSizeAdjust', 'fontSynthesis',
    'fontOpticalSizing', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform', 'textAlign',
    'whiteSpace', 'whiteSpaceCollapse', 'textWrap', 'textWrapMode', 'textWrapStyle', 'overflowWrap', 'wordBreak',
    'lineBreak', 'hyphens', 'tabSize', 'textRendering', 'textAutospace', 'textSpacingTrim', 'hangingPunctuation',
    'textSizeAdjust', 'webkitTextSizeAdjust', 'webkitNbspMode', 'appearance', 'boxSizing', 'paddingTop', 'paddingRight',
    'paddingBottom', 'paddingLeft', 'borderLeftWidth', 'borderRightWidth', 'borderTopWidth', 'direction', 'writingMode',
]
SET_TEXT = """(t) => {
  const a = window.__mv;
  a.view.setPref('autoplay', false);
  a.dispatch({ t: 'lyrics.set', text: t }, { label: ['undo.paste', {}] });
  a.pause();
  a.goStep('lyrics');
}"""
# The two layers, row by row. A hidden textarea like the editor's, holding rows 0..i, gives where row i ends in the
# textarea; mirror row i must end there too. whole=True also asks for a whole-px line height (the gutter's too) and rows
# of whole lines; whole=False is the check under a changed line height.
EDITOR_PROBE = r"""({ keys, whole }) => {
  const root = document.querySelector('.lyric-editor');
  if (!root || !root.getClientRects().length) return { problems: ['the editor is not shown'], rows: 0, wrapped: 0 };
  const ta = root.querySelector('.le-text'), m = root.querySelector('.le-mirror');
  const a = getComputedStyle(ta), b = getComputedStyle(m);
  const problems = [];
  for (const k of keys) if (a[k] !== undefined && a[k] !== b[k]) problems.push(k + ': ' + a[k] + ' (textarea), ' + b[k]);
  const lh = parseFloat(a.lineHeight);
  if (whole) {
    if (!/^\d+px$/.test(a.lineHeight)) problems.push('the line height ' + a.lineHeight + ' is not a whole number of px');
    const g = root.querySelector('.le-g'), glh = g && getComputedStyle(g).lineHeight;
    if (!g) problems.push('no gutter entry');
    else if (glh !== a.lineHeight) problems.push('the gutter\'s line height is ' + glh);
  }
  if (ta.scrollHeight > ta.clientHeight || ta.scrollTop || ta.scrollLeft) {
    problems.push('the textarea scrolls inside itself: ' + [ta.scrollHeight, ta.clientHeight, ta.scrollTop].join(' / '));
  }
  const rows = [...m.children], srcs = ta.value.split('\n');
  if (rows.length !== srcs.length) problems.push(rows.length + ' mirror rows for ' + srcs.length + ' text rows');
  const probe = document.createElement('textarea');
  probe.className = 'le-text';
  probe.tabIndex = -1;
  Object.assign(probe.style, { position: 'absolute', left: '0', top: '0', width: ta.offsetWidth + 'px', height: '0',
    minHeight: '0', visibility: 'hidden', lineHeight: ta.style.lineHeight });
  ta.parentNode.appendChild(probe);
  const top = m.getBoundingClientRect().top + parseFloat(b.paddingTop);
  const pad = parseFloat(a.paddingTop) + parseFloat(a.paddingBottom);
  let sum = 0, wrapped = 0, drift = null;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    sum += r.height;
    const n = r.height / lh;
    if (n > 1.5) wrapped++;
    const partLine = n < 0.99 || Math.abs(n - Math.round(n)) > 0.01;
    if (whole && partLine) problems.push('row ' + i + ' is ' + r.height + ' px, not whole lines');
    if (drift) continue;                                                        // the first row that drifts is enough
    probe.value = srcs.slice(0, i + 1).join('\n');
    const inText = probe.scrollHeight - pad, inMirror = r.bottom - top;
    if (Math.abs(inText - inMirror) > 1) {
      drift = 'row ' + i + ' ends at ' + inText + ' px in the textarea, ' + inMirror.toFixed(1) + ' in the mirror';
    }
  }
  probe.remove();
  if (drift) problems.push(drift);
  const content = m.getBoundingClientRect().height - parseFloat(b.paddingTop) - parseFloat(b.paddingBottom);
  if (Math.abs(sum - content) > 0.5) problems.push('the rows add up to ' + sum + ' px, the mirror holds ' + content);
  return { problems, rows: rows.length, wrapped };
}"""
# How each mirror row holds its text and colours, against the editor's own segments(). With Custom Highlights: one text
# node (a <br> after a blank row), and highlight ranges equal to the row's tokens, only near the viewport and on every
# row on screen. Without: a span per token, the plain text between them one node.
ROW_STRUCTURE = r"""({ margin }) => {
  const LE = MV.use('ui/lyric_editor');
  const root = document.querySelector('.lyric-editor'), ta = root.querySelector('.le-text');
  const rows = [...root.querySelector('.le-mirror').children], srcs = ta.value.split('\n');
  const problems = [];
  const reg = typeof CSS !== 'undefined' && CSS.highlights;
  const ink = typeof Highlight === 'function';
  const got = rows.map(() => []);
  let ranges = 0;
  for (const [cls, hl] of reg || []) {
    for (const r of hl) {
      ranges++;
      const i = rows.indexOf(r.startContainer.parentNode);
      if (i < 0 || r.endContainer !== r.startContainer) problems.push('a ' + cls + ' range outside one mirror row');
      else got[i].push([r.startOffset, cls, r.startContainer.data.slice(r.startOffset, r.endOffset)]);
    }
  }
  if (!ink && ranges) problems.push(ranges + ' highlight ranges without Custom Highlights');
  const top = root.scrollTop, bottom = top + root.clientHeight;
  let inked = 0;
  rows.forEach((row, i) => {
    const src = srcs[i];
    const kids = [...row.childNodes];
    const brs = kids.filter((k) => k.nodeName === 'BR').length;
    if (brs !== (src.trim() ? 0 : 1) || (brs && kids[kids.length - 1].nodeName !== 'BR')) problems.push('row ' + i + ': ' + brs + ' <br>');
    const runs = kids.filter((k) => k.nodeName !== 'BR').map((k) => [k.nodeType === 3 ? '' : k.className, k.textContent]);
    const tokens = [];
    let at = 0;
    for (const [text, cls] of LE.segments(src)) { if (cls) tokens.push([at, cls, text]); at += text.length; }
    if (ink) {
      if (runs.length > 1 || (runs.length ? runs[0][0] !== '' || runs[0][1] !== src : src !== '')) {
        problems.push('row ' + i + ' is not one text node: ' + JSON.stringify(runs));
      }
      const mine = got[i].sort((x, y) => x[0] - y[0]);
      const y0 = row.offsetTop, y1 = y0 + row.offsetHeight;
      if (mine.length) {
        inked++;
        if (JSON.stringify(mine) !== JSON.stringify(tokens)) problems.push('row ' + i + ' ink ' + JSON.stringify(mine) + ' ≠ ' + JSON.stringify(tokens));
        if (y1 < top - margin - 1 || y0 > bottom + margin + 1) problems.push('row ' + i + ' is inked ' + Math.round(y0 - top) + ' px from the viewport');
      } else if (tokens.length && y1 > top && y0 < bottom) problems.push('row ' + i + ' is on screen without its colours');
    } else {
      const want = [];
      for (const [text, cls] of LE.segments(src)) {
        if (!text) continue;
        if (!cls && want.length && !want[want.length - 1][0]) want[want.length - 1][1] += text; else want.push([cls, text]);
      }
      if (JSON.stringify(runs) !== JSON.stringify(want)) problems.push('row ' + i + ' spans ' + JSON.stringify(runs) + ' ≠ ' + JSON.stringify(want));
    }
  });
  return { problems, ranges, inked };
}"""
# Scrolls mirror row i into view → the point on its first line, just right of where its text starts.
EDITOR_ROW_POINT = """(i) => {
  const row = document.querySelector('.le-mirror').children[i];
  row.scrollIntoView({ block: 'center' });
  const r = row.getBoundingClientRect(), lh = parseFloat(getComputedStyle(row).lineHeight);
  return [r.left + 2, r.top + lh / 2];
}"""
CARET_ROW = """() => {
  const ta = document.querySelector('.le-text');
  return ta.value.slice(0, ta.selectionStart).split('\\n').length - 1;
}"""
# The textarea's own scroll and how far its text reaches below its box (both 0: it never scrolls inside itself).
INNER_SCROLL = "() => { const t = document.querySelector('.le-text'); return [t.scrollTop, t.scrollHeight - t.clientHeight]; }"
# Both layers get another line height ('' = back to the stylesheet's).
SET_LINE_HEIGHT = "(lh) => { for (const s of ['.le-text', '.le-mirror']) document.querySelector(s).style.lineHeight = lh; }"
# How far the last character of the text (where the caret is) ends below the editor's visible bottom, from the mirror.
CARET_BELOW = """() => {
  const root = document.querySelector('.lyric-editor'), row = document.querySelector('.le-mirror').lastElementChild;
  const w = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
  let last = null;
  for (let n = w.nextNode(); n; n = w.nextNode()) if (n.length) last = n;
  if (!last) return -1e9;
  const r = document.createRange();
  r.setStart(last, last.length - 1);
  r.setEnd(last, last.length);
  const rects = r.getClientRects();
  const bottom = root.getBoundingClientRect().top + root.clientTop + root.clientHeight;
  return rects[rects.length - 1].bottom - bottom;
}"""
CARET_TO_END = """() => {
  const ta = document.querySelector('.le-text');
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
}"""
# Every token span in view (its line boxes, relative to the editor's picture) with its colour, and the text colour.
TOKEN_BOXES = """() => {
  const root = document.querySelector('.lyric-editor'), view = root.getBoundingClientRect();
  const boxes = [];
  for (const s of document.querySelectorAll('.le-mirror span')) {
    if (!s.textContent.trim()) continue;
    for (const r of s.getClientRects()) {
      if (r.top < view.top + root.clientTop || r.bottom > view.top + root.clientTop + root.clientHeight) continue;
      boxes.push({ cls: s.className, color: getComputedStyle(s).color, x0: Math.floor(r.left - view.left), y0: Math.floor(r.top - view.top),
        x1: Math.ceil(r.right - view.left), y1: Math.ceil(r.bottom - view.top) });
    }
  }
  return { boxes, text: getComputedStyle(document.querySelector('.le-mirror')).color, ground: getComputedStyle(root).backgroundColor };
}"""
# The editor at rest for a picture: no focus, scrolled to the top, no karaoke row (its underline is the accent).
EDITOR_SHOT = """() => {
  if (document.activeElement) document.activeElement.blur();
  document.querySelector('.lyric-editor').scrollTop = 0;
  for (const row of document.querySelectorAll('.le-row.is-playing')) row.classList.remove('is-playing');
}"""


def rgb(css):
    """'rgb(r, g, b)' or 'rgba(…)' → (r, g, b)."""
    return tuple(int(float(v)) for v in css[css.index('(') + 1:css.index(')')].split(',')[:3])


def token_inks(png, found):
    """For each token box, whether its strongest pixel (the core of its glyphs; a thin '/' has little else) is the
    token's colour rather than the text colour, both as blends over the ground → {class: [ok, boxes]}."""
    w, _, _, px = decode_png(png)
    g, text = rgb(found['ground']), rgb(found['text'])

    def off(p, c):                    # how far p lies from the blend of colour c over the ground
        d = [x - y for x, y in zip(c, g)]
        a = max(0.0, min(1.0, sum((p[j] - g[j]) * d[j] for j in range(3)) / sum(v * v for v in d)))
        return sum((p[j] - g[j] - a * d[j]) ** 2 for j in range(3))

    out = {}
    for box in found['boxes']:
        best, core = -1, None
        for y in range(box['y0'], box['y1']):
            for x in range(box['x0'], box['x1']):
                i = 4 * (y * w + x)
                p = px[i:i + 3]
                strength = sum((p[j] - g[j]) ** 2 for j in range(3))
                if strength > best:
                    best, core = strength, p
        tally = out.setdefault(box['cls'], [0, 0])
        tally[1] += 1
        tally[0] += bool(core) and off(core, rgb(box['color'])) < off(core, text)
    return out


async def check_rows(f, where, whole=True):
    """The probe and the row structure at the current size; → the probe's result."""
    page = f.page
    r = await page.evaluate(EDITOR_PROBE, {'keys': EDITOR_KEYS, 'whole': whole})
    f.check(not r['problems'], '%s: %r' % (where, r['problems'][:4]))
    s = await page.evaluate(ROW_STRUCTURE, {'margin': GUTTER_MARGIN_PX})
    f.check(not s['problems'], '%s, rows: %r' % (where, s['problems'][:4]))
    return r, s


async def editor_shot(f):
    await f.page.mouse.move(1, 1)
    await f.page.evaluate(EDITOR_SHOT)
    await f.settle(3)
    return await f.page.locator('.lyric-editor').screenshot()


async def flow_ink(f, text, rows):
    """The mirror with Custom Highlights (Chromium has them): every check at every size; → the editor's screenshot."""
    page = f.page
    await page.evaluate(SET_TEXT, text)
    await page.set_viewport_size({'width': 1440, 'height': 900})
    await f.settle(4)
    shot = await editor_shot(f)
    for w, h in VIEWPORTS:
        where = '%dx%d' % (w, h)
        await page.set_viewport_size({'width': w, 'height': h})
        await f.settle(4)
        r, s = await check_rows(f, where)
        f.check(r['rows'] == rows and r['wrapped'] >= 2, '%s: %d rows, %d wrapped' % (where, r['rows'], r['wrapped']))
        f.check(s['inked'] >= 3, '%s: only %d rows inked' % (where, s['inked']))
        # Safari's line boxes are whole px, page zoom scales them: the rows follow the line height, whatever it is.
        for lh in ('25px', '25.5px', '28.6px', ''):
            await page.evaluate(SET_LINE_HEIGHT, lh)
            await f.settle(3)                  # the mirror changed size: the textarea's height follows (ResizeObserver)
            if lh:
                r = await page.evaluate(EDITOR_PROBE, {'keys': EDITOR_KEYS, 'whole': False})
                f.check(not r['problems'], '%s with %s lines: %r' % (where, lh, r['problems'][:3]))
        # A click on each coloured row puts the caret in that row (the last one too); the ink follows the scroll.
        missed = []
        for i in range(rows):
            x, y = await page.evaluate(EDITOR_ROW_POINT, i)
            await f.settle(1)
            await page.mouse.click(x, y)
            got = await page.evaluate(CARET_ROW)
            if got != i:
                missed.append((i, got))
        f.check(not missed, '%s: clicks on rows put the caret in other rows (row, caret row): %r' % (where, missed[:6]))
        await f.settle(2)
        _, s = await check_rows(f, where + ' at the end')
        await page.keyboard.press('Control+End')
        got = await page.evaluate(INNER_SCROLL)
        f.check(got == [0, 0], '%s: the caret at the end scrolls the textarea (scrollTop, overflow): %r' % (where, got))
    return shot


async def flow_ink_window(f, text):
    """Long lyrics: the highlight ranges stay those of the rows near the viewport, wherever the editor is scrolled."""
    page = f.page
    await page.set_viewport_size({'width': 1440, 'height': 900})
    await page.evaluate(SET_TEXT, '\n'.join([text] * 8))
    await f.settle(4)
    counts = []
    for at in ('0', 'root.scrollHeight / 2', 'root.scrollHeight'):
        await page.evaluate("() => { const root = document.querySelector('.lyric-editor'); root.scrollTop = %s; }" % at)
        await f.settle(3)
        s = await page.evaluate(ROW_STRUCTURE, {'margin': GUTTER_MARGIN_PX})
        f.check(not s['problems'], 'long lyrics scrolled to %s: %r' % (at, s['problems'][:4]))
        counts.append(s['ranges'])
    total = await page.evaluate("""() => { const LE = MV.use('ui/lyric_editor');
      return document.querySelector('.le-text').value.split('\\n').reduce((n, src) => n + LE.segments(src).filter((s) => s[1]).length, 0); }""")
    f.check(0 < max(counts) < total / 3, 'ranges held while scrolling: %r of %d tokens' % (counts, total))


async def flow_caret_reveal(f, text):
    """Typing at the end of the last row until it wraps (a caret reveal inside the textarea runs before `input`), and
    Enter there, never leave the caret's line below the editor's bottom."""
    page = f.page
    for w, h in ((1440, 900), (390, 844), (844, 390)):
        where = '%dx%d' % (w, h)
        await page.set_viewport_size({'width': w, 'height': h})
        await page.evaluate(SET_TEXT, text)
        await f.settle(4)
        await page.evaluate(CARET_TO_END)
        worst = -1e9
        for key in ['あ'] * 40 + ['Enter', 'い', 'Enter', 'Enter', 'う']:
            if key == 'Enter':
                await page.keyboard.press(key)
            else:
                await page.keyboard.type(key)
            worst = max(worst, await page.evaluate(CARET_BELOW))
        f.check(worst <= 0.5, '%s: typing at the end left the caret %.1f px below the editor' % (where, worst))
        got = await page.evaluate(INNER_SCROLL)
        f.check(got == [0, 0], '%s: after typing, the textarea scrolls inside itself: %r' % (where, got))


async def flow_heights(f, text):
    """The textarea's height: one paste into the empty editor; textarea text taller than the mirror; the editor's
    height alone changing."""
    page = f.page
    await page.set_viewport_size({'width': 1280, 'height': 800})
    await page.evaluate(SET_TEXT, '')
    await f.settle(4)
    r = await page.evaluate("""(t) => {
      const ta = document.querySelector('.le-text');
      const empty = document.querySelector('.lyric-editor').classList.contains('is-empty');
      ta.focus();
      ta.dispatchEvent(new Event('paste', { bubbles: true }));
      ta.value = t;
      ta.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
      return [empty, ta.scrollHeight, ta.clientHeight];
    }""", text)
    f.check(r[0] and r[1] <= r[2], 'after one paste into the empty editor the textarea is shorter than its text: %r' % r)
    await f.settle(2)
    await page.evaluate(CARET_TO_END)                # the first paste sends the focus to the preview
    await page.keyboard.press('Control+End')
    got = await page.evaluate("() => [document.activeElement.className, document.querySelector('.le-text').scrollTop]")
    f.check(got == ['le-text', 0], 'after the paste, the caret at the end scrolls the textarea (focus, scrollTop): %r' % got)
    # Another engine could wrap the textarea's text taller than the mirror: the textarea grows to its text on an edit,
    # keeps it after a deletion (in the same task) and when it is resized for another reason (the editor's height).
    await page.evaluate("() => { document.querySelector('.le-text').style.paddingBottom = '214px'; }")
    await page.evaluate(CARET_TO_END)
    await page.keyboard.type('x')
    got = await page.evaluate(INNER_SCROLL)
    f.check(got == [0, 0], 'text taller than the mirror: the textarea is not as tall as it (scrollTop, overflow): %r' % got)
    await page.keyboard.press('Backspace')
    got = await page.evaluate(INNER_SCROLL)
    f.check(got == [0, 0], 'text taller than the mirror, after a deletion (scrollTop, overflow): %r' % got)
    await page.set_viewport_size({'width': 1280, 'height': 760})
    await f.settle(4)
    got = await page.evaluate(INNER_SCROLL)
    f.check(got == [0, 0], 'text taller than the mirror, after the editor got shorter (scrollTop, overflow): %r' % got)
    await page.evaluate("() => { document.querySelector('.le-text').style.paddingBottom = ''; }")
    await page.keyboard.type('x')
    await page.keyboard.press('Backspace')
    await f.settle(2)
    got = await page.evaluate("() => { const t = document.querySelector('.le-text'); return [t.offsetHeight, document.querySelector('.le-mirror').offsetHeight]; }")
    f.check(got[0] == got[1], "back to the mirror's height (textarea, mirror): %r" % got)
    # Only the editor's height changes (the window's): the textarea still reaches the editor's bottom, no further.
    await page.evaluate(SET_TEXT, 'a\nb\nc')
    for h in (600, 900, 700):
        await page.set_viewport_size({'width': 1280, 'height': h})
        await f.settle(4)
        got = await page.evaluate("() => [document.querySelector('.le-text').offsetHeight, document.querySelector('.lyric-editor').clientHeight - 2]")
        f.check(got[0] == got[1], 'window height %d: the textarea is %d px, the editor %d' % (h, got[0], got[1]))


async def flow_spans(f, text, rows, ink_shot):
    """Without Custom Highlights: the spans pass the row checks, and paint what the highlights painted."""
    page = f.page
    csp = await page.evaluate('() => window.__csp || []')      # the reload starts a new record
    f.check(not csp, 'CSP violations: %r' % csp)
    await page.add_init_script('delete window.Highlight;')
    await page.reload(wait_until='load')
    await page.wait_for_function('window.__mv && window.__mv.ready')
    await page.evaluate('async () => { await window.__mv.ready; }')
    await page.evaluate(SET_TEXT, text)
    await page.set_viewport_size({'width': 1440, 'height': 900})
    await f.settle(4)
    shot = await editor_shot(f)
    # Every token in view has its colour in both pictures. Not pixel for pixel: a span starts a new text run, which
    # moves the glyphs after it by a fraction of a pixel.
    found = await page.evaluate(TOKEN_BOXES)
    ink, spans = token_inks(ink_shot, found), token_inks(shot, found)
    f.check(len(spans) >= 4, 'token classes in view: %r' % sorted(spans))
    for cls, (ok, n) in sorted(spans.items()):
        f.check(ok == n, '%s: %d of %d tokens in their colour with spans' % (cls, ok, n))
        f.check(ink[cls][0] == n, '%s: %d of %d tokens in their colour with highlights' % (cls, ink[cls][0], n))
    for w, h in ((1440, 900), (390, 844)):
        await page.set_viewport_size({'width': w, 'height': h})
        await f.settle(4)
        r, _ = await check_rows(f, 'spans %dx%d' % (w, h))
        f.check(r['rows'] == rows and r['wrapped'] >= 2, 'spans %dx%d: %d rows, %d wrapped' % (w, h, r['rows'], r['wrapped']))


async def run(browser, base, shots):
    page = await open_page(browser, base, 'index.html')
    f = Flow('ja_editor_metrics', page, shots)
    try:
        text = await page.evaluate("() => window.__mv.svc.sample(window.__mv.lang)") + '\n' + '\n'.join(EDITOR_ROWS)
        rows = text.count('\n') + 1
        shots = {}
        steps = (('ink', lambda: flow_ink(f, text, rows)), ('ink window', lambda: flow_ink_window(f, text)),
                 ('caret reveal', lambda: flow_caret_reveal(f, text)), ('heights', lambda: flow_heights(f, text)),
                 ('spans', lambda: flow_spans(f, text, rows, shots['ink'])))       # last: it reloads the page
        for name, step in steps:
            before = len(f.problems)
            try:
                shots[name] = await step()
            except Exception as e:  # a crashed step is a failure, the others still run
                f.problems.append('%s crashed: %r' % (name, e))
            print('%s %s' % ('FAIL' if len(f.problems) > before else 'ok  ', name))
        await f.shot('end')
    except Exception as e:
        f.problems.append('crashed: %r' % e)
    csp = await page.evaluate('() => window.__csp || []')
    f.check(not csp, 'CSP violations: %r' % csp)
    f.check(not f.errors, 'page errors: %r' % f.errors[:3])
    await page.context.close()
    return f.problems


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shots', help='write a screenshot to this directory')
    ap.add_argument('--root', help='the tree to build and serve, with src/ and vendor/ (default: this one)')
    args = ap.parse_args()
    root = Path(args.root).resolve() if args.root else ROOT
    ensure_built(root)
    if args.shots:
        Path(args.shots).mkdir(parents=True, exist_ok=True)
    server = serve(root)
    base = 'http://127.0.0.1:%d/' % server.server_address[1]
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                problems = await run(browser, base, args.shots)
            finally:
                await browser.close()
    finally:
        server.shutdown()
    for msg in problems:
        print('  ' + msg)
    print('editor_metrics.py: %s' % ('FAILED (%d problems)' % len(problems) if problems else 'OK'))
    return 1 if problems else 0


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
