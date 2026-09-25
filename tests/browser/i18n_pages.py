#!/usr/bin/env python3
"""文字PVメーカー v2 — original work. Browser test: the ja and en pages speak their own language (DESIGN §8.3, §4.24).

Both built pages are opened from a local http.server and walked through the screens a user meets: the empty first run,
lyrics in, the four steps (④ with 詳しく open), 詳細 at every level (作品全体 → 行 → カット → 要素), the part browser, the
AI tab, the timeline drawer, the ≡ menu, the command palette, the shortcut sheet, the syntax help and the About page;
v2.1 adds the area page, the curve widget, マイ素材 (list, page, the 「AIで作る」 form), the keyframe editor, the AI area list
and the board (a material's name is user data: the en page shows its English name); the photo and video screens (the
drop label, the library and a row's menu, the asset page, the media rows with the trim row, the crop overlay and the
picker; asset names are user data) come last.
On every screen the visible text and the accessible names (aria-label, title, placeholder, alt) are read and checked:

  en page   no Japanese text (kana or kanji) outside the product name 文字PVメーカー and user data (the lyrics here are
            English, so everything else Japanese is UI text), and no text that is a Japanese entry of the string table
  ja page   no untranslated English: no text equal to an English entry of the string table, and no English word outside
            the allowlist below (technical names, key names, font families, file formats, the MIT license text of
            the About page, which is legal text and the same in both languages)
  both      no raw string key on screen (a key t() did not find), and every key the page asked t() for (recorded at run
            time) has a non-empty text in both languages; the same for every literal key in src/ (t('…'), t.label([…]))

Also: no page errors, no CSP violations. Google Fonts are blocked (fallback faces; font names stay as data).
Run: PW_EXECUTABLE=/opt/pw-browsers/chromium python3 tests/browser/i18n_pages.py [--root DIR] [--shots DIR]
"""
import argparse
import asyncio
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'dev'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from browser import launch, new_page  # noqa: E402
from playwright.async_api import async_playwright  # noqa: E402
from ui_flows import FONT_HOSTS, RECORD, ensure_built, serve  # noqa: E402

PRODUCT = '文字PVメーカー'
LYRICS = {
    'en': '\n'.join(['[ti:Morning Window]', '# Verse', 'Open the window/let the light in', 'The sleepy town/says *hello*',
                     'Down the hill /to the station', '', '# Chorus', 'Here we go/again today!', 'One small/step at a time']),
    'ja': '\n'.join(['[ti:朝の窓]', '# Aメロ', '窓をあけて/光を入れる', 'まだ眠い街に/*おはよう*', '坂道を下って/駅まで歩く',
                     '', '# サビ', '今日も/ここから始まる!', '小さな/一歩で']),
}
JAPANESE = re.compile(r'[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]')
RAW_KEY = re.compile(r'^[a-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9-]*)+$')
WORD = re.compile(r'[A-Za-z][A-Za-z0-9\'’.-]*[A-Za-z0-9]|[A-Za-z]')
VERSION = re.compile(r'^v?\d+(\.\d+)+$')
HEX = re.compile(r'#[0-9A-Fa-f]{6}\b')          # a colour code (the colour rows and a photo's swatches) is not a word
BROKEN = re.compile(r'\[object \w+\]|\bundefined\b|\bNaN\b|\{[A-Za-z0-9_]+\}')
# English words a Japanese UI legitimately shows: formats and codecs, units, key names, services and model names,
# the lab-free product parts that are names (not prose). Font families and part keys are added from the page.
JA_WORDS = {w.lower() for w in '''
MP4 PNG ZIP LRC JSON WAV MP3 M4A OGG FLAC AAC H.264 HEX RGB BPM fps px du Hz kHz dB MB GB KB TB B USD AI API
Ctrl Shift Alt Esc Enter Space Tab Del Delete Backspace Home End PageUp PageDown Cmd Option Win F1 F2 F6 F11 I O R T L
Gemini Claude Google Anthropic Opus Sonnet Haiku Flash gemini-3.8-flash pro preview
Chrome Edge WebCodecs OK x vs PV MIT ti ar
'''.split()}
# Proper names of other works shown as they are (removed before the word check on the ja page).
JA_NAMES = ('Google Fonts', 'SIL Open Font License', 'File System Access', 'mp4-muxer', '@anthropic-ai/sdk', 'standardwebhooks',
            '@stablelib/base64', 'fast-sha256')
# Language names are written in their own language: the ja page offers "English".
JA_TEXTS = {'English'}
# The logo glyph next to the product name (decorative, aria-hidden) is part of the product's name.
PRODUCT_MARK = 'span.brand-mark'

INSTALL_KEY_LOG = r"""
(() => {
  // Record every key the page asks t() for: wrap i18n/t's createT as the kernel registers it (test page only).
  const used = new Set();
  window.__i18nUsed = used;
  const MVobj = {};
  let realDef = null;
  const wrapT = (mod) => Object.assign({}, mod, {
    createT(...args) {
      const t = mod.createT(...args);
      const w = (key, params) => { used.add(key); return t(key, params); };
      Object.assign(w, t);
      w.why = (code, params) => w('why.' + code, params);
      w.err = (code, params) => w('err.ai.' + code, params);
      w.label = (label) => (Array.isArray(label) ? w(label[0], label[1]) : String(label));
      return w;
    },
  });
  Object.defineProperty(MVobj, 'def', {
    configurable: true, enumerable: true,
    get() { return realDef; },
    set(fn) { realDef = (id, deps, factory) => fn(id, deps, id === 'i18n/t' ? (...a) => wrapT(factory(...a)) : factory); },
  });
  window.MV = MVobj;
})();
"""

# Visible text nodes and accessible names of visible elements, with a hint of where they are. Text inside the lyric
# editor (a textarea, user data) is skipped; everything else counts.
COLLECT = r"""() => {
  const out = [];
  const shown = (el) => !!el && el.isConnected && el.checkVisibility({ checkVisibilityCSS: true }) && el.getClientRects().length > 0;
  const where = (el) => {
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      parts.unshift(e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : ''));
    }
    return parts.join(' > ');
  };
  const inLicense = (el) => !!el.closest('pre, .about-license, .license');
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue.replace(/\s+/g, ' ').trim();
    const el = n.parentElement;
    if (!text || !el || el.closest('textarea, script, style') || !shown(el)) continue;
    out.push({ text, where: where(el), license: inLicense(el) });
  }
  for (const el of document.body.querySelectorAll('[aria-label], [title], [placeholder], [alt]')) {
    if (!shown(el) || el.closest('textarea')) continue;
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
      const v = el.getAttribute(a);
      if (v && v.trim()) out.push({ text: v.trim(), where: where(el) + ' @' + a, license: false });
    }
  }
  return out;
}"""

TABLE = """() => { const s = MV.use('i18n/strings'); return Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v])); }"""
FAMILIES = """() => {
  const F = MV.use('engine/text/faces');
  const names = new Set(Object.keys(F.FAMILIES || {}));
  const reg = window.__mv.registry || (window.__mv.svc && window.__mv.svc.registry);
  return [...names];
}"""


class Walk:
    def __init__(self, lang, page, shots):
        self.lang, self.page, self.shots = lang, page, shots
        self.problems, self.errors, self.screens = [], [], 0
        page.on('pageerror', lambda e: self.errors.append(str(e)))

    async def settle(self, frames=3):
        await self.page.evaluate('(n) => new Promise((r) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : r()); f(); })', frames)

    async def run(self, js, arg=None):
        return await self.page.evaluate(js, arg)

    async def act(self, cmd, args=None):
        await self.run('([c, a]) => window.__mv.actions.run(c, a || {})', [cmd, args])
        await self.settle()

    async def escape(self, times=1):
        for _ in range(times):
            await self.page.keyboard.press('Escape')
        await self.settle()


def english_words(text):
    return [w for w in WORD.findall(text)]


def check_screen(walk, name, items, table, families):
    """Problems of one screen: Japanese on the en page, English on the ja page, raw keys on either."""
    other = 1 if walk.lang == 'ja' else 0            # the other language's column of the table
    mine = 0 if walk.lang == 'ja' else 1
    foreign = {pair[other].strip() for pair in table.values() if pair[other] and pair[other].strip() != (pair[mine] or '').strip()}
    seen = set()
    for it in items:
        text, where = it['text'], it['where']
        if (text, where) in seen:
            continue
        seen.add((text, where))
        where_s = '%s [%s] %r' % (name, where, text[:90])
        if BROKEN.search(text):
            walk.problems.append('broken text (an object, undefined, NaN or an unfilled {placeholder}): ' + where_s)
            continue
        if RAW_KEY.match(text):
            walk.problems.append('raw string key on screen: ' + where_s)
            continue
        if walk.lang == 'ja' and text in JA_TEXTS:
            continue
        if text in foreign and not (walk.lang == 'ja' and not JAPANESE.search(text) and all(w.lower() in JA_WORDS for w in english_words(text))):
            walk.problems.append('text of the other language: ' + where_s)
            continue
        if walk.lang == 'en':
            if where.endswith(PRODUCT_MARK):
                continue
            if JAPANESE.search(text.replace(PRODUCT, '')):
                walk.problems.append('Japanese on the en page: ' + where_s)
        else:
            if it['license']:
                continue
            rest = HEX.sub(' ', text)
            for proper in JA_NAMES:
                rest = rest.replace(proper, ' ')
            words = [w for w in english_words(rest) if w.lower() not in JA_WORDS and w not in families and not VERSION.match(w)]
            if words and sum(len(w) for w in words) >= 3:
                walk.problems.append('English on the ja page (%s): %s' % (' '.join(words[:6]), where_s))


async def screen(walk, name, table, families):
    await walk.settle()
    items = await walk.run(COLLECT)
    walk.screens += 1
    check_screen(walk, name, items, table, families)
    if walk.shots:
        await walk.page.screenshot(path=str(Path(walk.shots) / ('i18n_%s_%02d_%s.png' % (walk.lang, walk.screens, name))))


# v2.1 (package F, DESIGN_2_1 §7.4): the new screens. A material with a name in both languages (user data: the en page
# shows its English name), a ramp curve and a custom shot on line 1, then: the area page of # Chorus, the 緩急 row with
# かんたん, the keyframe editor, 全体 › マイ素材 and the material page, 入り › マイ素材 with the 「AIで作る」 form, the AI
# tab's area list and the board.
V21_SETUP = """() => { const a = window.__mv, id = a.plan.lines[0].id;
  a.batch({ label: ['undo.paste', {}] }, [
    { t: 'material.put', id: 'm' + a.doc.materials.next.toString(36), kind: 'ornament', by: 'ai', name: { ja: '桜吹雪', en: 'Cherry flurry' },
      blurb: { ja: '花びらが舞う', en: 'Petals drift' }, tags: ['soft'], season: 'spring', pool: false,
      recipe: { scope: 'run', knobs: [{ what: 'count' }], layers: [{ prim: 'particles', shape: 'petal', count: 40, inks: ['accent'] }] } },
    { t: 'pin.set', path: 'line/' + id + ':arrive.ease', v: { ramp: { edge: 0.1, ends: 'both', peak: 6 } }, by: 'user' }]);
  return id; }"""


async def v21_screens(w, table, families):
    page = w.page
    lid = await w.run(V21_SETUP)
    await w.act('panel.details')
    await w.run("""() => { const a = window.__mv, AR = MV.use('planner/areas'), S = MV.use('ui/selection');
      const heads = AR.areasOf(a.doc, a.plan).heads; a.select(S.areaSel(heads[heads.length - 1]), { from: 'crumbs', open: true }); }""")
    await screen(w, 'v21-area', table, families)
    await w.run("(id) => window.__mv.select({ level: 'line', ids: [id] }, { from: 'crumbs', open: true })", lid)
    await w.settle(4)
    await w.run("() => { const r = document.querySelector('.frow[data-slot=\"arrive.ease\"]'); if (r) r.scrollIntoView({ block: 'center' }); }")
    await screen(w, 'v21-curve', table, families)
    await page.click('[data-mount="inspector"] .frow[data-slot="arrive"] .w-part')
    await page.wait_for_function("() => !!document.querySelector('.pb-tabs [data-tab=\"mine\"]')")
    await page.click('.pb-tabs [data-tab="mine"]')
    await page.click('.pb-tile.pb-make')
    await screen(w, 'v21-mine-make', table, families)
    await w.escape()
    await w.run("() => { const a = window.__mv; a.select({ level: 'el', scope: 'cut/' + a.plan.lines[0].cuts[0], el: 'lens' }, { from: 'crumbs', open: true }); }")
    await w.settle(4)
    await screen(w, 'v21-camera', table, families)
    await page.click('[data-custom="camKeys"] button')
    await page.wait_for_function("() => document.querySelectorAll('.ke-page .ke-row').length > 1")
    await screen(w, 'v21-keyframes', table, families)
    await w.escape()
    await w.run("() => window.__mv.select({ level: 'work' }, { from: 'crumbs', open: true })")
    await w.settle(4)
    await w.run("() => window.__mv.inspector.openSection('materials')")
    await screen(w, 'v21-materials', table, families)
    await page.click('.mat-row .insp-item')
    await page.wait_for_function("() => !!document.querySelector('.mat-page .mat-name')")
    await screen(w, 'v21-material-page', table, families)
    await w.escape()
    await w.act('panel.ai')
    await page.click('.ai-direct [data-target="area"]')
    await screen(w, 'v21-ai-areas', table, families)
    await page.click('.ai-board-link')
    await page.wait_for_function("() => !!document.querySelector('.ai-board .ai-board-row')")
    await screen(w, 'v21-board', table, families)
    await w.act('panel.close')


# v2.1 photos and videos (package G.4, DESIGN_2_1 §11.8.3): a still and a video imported here (names are user data: the en
# page gets English names), the video as line 2's background, the still as line 1's overlay footage, and a third photo
# whose bytes are not on this device. Screens: the preview's drop label, 全体 › 写真・動画, a row's ⋯ menu, the asset page,
# a missing asset's page, 重ねる映像 with its 重ね方, the element page with its media rows and the trim row, the crop
# overlay (with its strip) and the picker.
MEDIA_HELPERS = ('tests/helpers/exif_write.js', 'tests/helpers/media_gen.js')
MEDIA_NAMES = {'ja': ['空の写真.png', '海辺.mp4', '夜景.png'], 'en': ['Blue Sky.png', 'Seaside Walk.mp4', 'Night View.png']}
MEDIA_SETUP = """async (names) => {
  const a = window.__mv, G = window.MVMediaGen;
  const st = await G.stills();
  const v = await G.encodeCounter({ container: 'mp4', fps: 30, frames: 45 });
  const got = await a.media.importFiles([new File([st.png], names[0], { type: 'image/png' }), new File([v.bytes], names[1], { type: 'video/mp4' })], {});
  const line = a.plan.lines[1].id;
  a.media.place(got[1].id, 'ground', { kind: 'lines', scopes: ['line/' + line], lineIds: [line], area: null });
  // the photo as overlay footage on line 1, and a third photo whose bytes are not on this device
  const first = a.plan.lines[0].id;
  a.media.place(got[0].id, 'overlay', { kind: 'lines', scopes: ['line/' + first], lineIds: [first], area: null });
  const ghost = Object.assign({}, got[0], { id: 'a' + 'e'.repeat(24), name: names[2] });
  a.dispatch({ t: 'media.put', entry: ghost }, { label: ['undo.media.put', {}] });
  await a.assets.check([ghost.id]);
  return { line, first, video: got[1].id, ghost: ghost.id };
}"""
DRAG_OVER = """(leave) => { const w = document.querySelector('.canvas-wrap'), dt = new DataTransfer();
  dt.items.add(new File(['x'], 'x.png', { type: 'image/png' }));
  w.dispatchEvent(new DragEvent(leave ? 'dragleave' : 'dragenter', { bubbles: true, dataTransfer: dt })); }"""


async def media_screens(w, table, families):
    page = w.page
    for helper in MEDIA_HELPERS:
        await page.evaluate((ROOT / helper).read_text(encoding='utf-8'))
    got = await w.run(MEDIA_SETUP, MEDIA_NAMES[w.lang])
    await w.run(DRAG_OVER, False)
    await screen(w, 'media-drop', table, families)
    await w.run(DRAG_OVER, True)
    await w.act('panel.details')
    await w.run("() => window.__mv.select({ level: 'work' }, { from: 'crumbs', open: true })")
    await w.settle(4)
    await w.run("() => window.__mv.inspector.openSection('media')")
    await page.wait_for_function("() => document.querySelectorAll('.med-row').length === 3")
    await screen(w, 'media-library', table, families)
    await page.click('.med-row[data-id="%s"] .med-more' % got['video'])
    await screen(w, 'media-row-menu', table, families)
    await w.escape()
    await w.run("(id) => window.__mv.media.openAsset(id)", got['video'])
    await page.wait_for_function("() => !!document.querySelector('.med-page .med-title')")
    await screen(w, 'media-asset', table, families)
    await w.escape()
    await w.run("() => window.__mv.view.setPref('ai', true)")
    await w.run("(id) => window.__mv.media.openAsset(id)", got['ghost'])
    await page.wait_for_function("() => !!document.querySelector('.med-page .med-missing')")
    await screen(w, 'media-asset-missing', table, families)
    await w.escape()
    await w.run("""(line) => window.__mv.select({ level: 'el', scope: 'line/' + line, el: 'ground' }, { from: 'crumbs', open: true })""", got['first'])
    await page.wait_for_function("() => !!document.querySelector('.frow[data-slot=\"atmos@mediaLayer.blend\"]')")
    await w.run("() => document.querySelector('.frow[data-slot=\"atmos@mediaLayer.blend\"]').scrollIntoView({ block: 'center' })")
    await screen(w, 'media-overlay', table, families)
    await w.run("""(line) => window.__mv.select({ level: 'el', scope: 'line/' + line, el: 'ground' }, { from: 'crumbs', open: true })""", got['line'])
    await page.wait_for_function("() => !!document.querySelector('.w-trim')")
    await screen(w, 'media-element', table, families)
    await w.run("() => document.querySelector('.w-trim').scrollIntoView({ block: 'center' })")
    await screen(w, 'media-trim', table, families)
    await page.click('.frow[data-slot="ground@photoPan.cropZoom"] .w-crop-edit')
    await screen(w, 'media-crop', table, families)
    await w.escape()
    await page.click('.frow[data-slot="ground@photoPan.image"] .w-media')
    await page.wait_for_function("() => document.querySelectorAll('.med-picker .pb-tile').length >= 3")
    await screen(w, 'media-picker', table, families)
    await w.escape()
    await w.act('panel.close')


async def walk_page(browser, base, lang, shots):
    page = await new_page(browser, viewport={'width': 1440, 'height': 900})
    await page.add_init_script(INSTALL_KEY_LOG)
    await page.add_init_script(RECORD)
    for host in FONT_HOSTS:
        await page.route(host, lambda route: route.abort())
    rel = 'index.html' if lang == 'ja' else 'en/index.html'
    await page.goto(base + rel + '?fresh=1&test=1', wait_until='load')
    await page.wait_for_function('window.__mv && window.__mv.ready')
    await page.evaluate('async () => { await window.__mv.ready; }')
    w = Walk(lang, page, shots)
    table = await w.run(TABLE)
    fam = set()
    for name in await w.run(FAMILIES):
        fam.update(name.split())
    families = fam | set(JA_WORDS)

    await screen(w, 'empty', table, families)
    await w.run("""(text) => { const a = window.__mv; a.view.setPref('autoplay', false);
      a.dispatch({ t: 'lyrics.set', text }, { label: ['undo.paste', {}] }); a.store.seal(); a.firstRun(); a.pause(); }""", LYRICS[lang])
    await page.wait_for_function('() => window.__mv.plan && window.__mv.plan.lines.length > 3')
    await screen(w, 'lyrics', table, families)
    for step in ('song', 'look', 'export'):
        await w.act('step.go', {'step': step})
        await screen(w, 'step-' + step, table, families)
    await page.click('[data-ctl="more"] > summary')
    await screen(w, 'export-more', table, families)
    await w.act('step.go', {'step': 'lyrics'})
    await w.act('panel.details')
    await screen(w, 'details-work', table, families)
    await page.locator('.canvas-wrap').focus()
    for level in ('line', 'cut', 'element'):
        await page.keyboard.press('ArrowDown')
        await w.settle(4)
        await screen(w, 'details-' + level, table, families)
    await w.escape(3)
    await w.act('sel.line', {'d': 1})
    await w.act('panel.details')
    await w.settle(4)
    part = page.locator('[data-mount="inspector"] .frow .w-part').first
    # Part thumbnails are pictures of a sample line: that line is UI text too, in the page's language.
    await w.run("""() => { const a = window.__mv, thumb = a.engine.thumb; window.__thumbTexts = [];
      a.engine.thumb = (ref, surface, o) => { window.__thumbTexts.push(o ? o.text : undefined); return thumb(ref, surface, o); }; }""")
    if await part.count():
        await part.click()
        await page.wait_for_function("() => document.querySelectorAll('.pb-tile[data-key]').length > 1")
        await page.wait_for_function('() => window.__thumbTexts.length > 0', timeout=5000)
        await screen(w, 'part-browser', table, families)
        texts = set(await w.run('() => window.__thumbTexts'))
        sample = table['pb.sampleText'][0 if lang == 'ja' else 1]
        if texts != {sample}:
            w.problems.append('part thumbnails draw %r, not the sample line %r' % (sorted(map(str, texts)), sample))
        await w.escape()
    else:
        w.problems.append('no part row on the line page')
    await w.act('panel.ai')
    await screen(w, 'ai', table, families)
    await w.act('panel.close')
    await w.act('timeline.toggle')
    await screen(w, 'timeline', table, families)
    await w.act('timeline.toggle')
    await page.click('[data-act="menu.open"]')
    await screen(w, 'menu', table, families)
    await w.escape()
    await w.act('palette.open')
    await screen(w, 'palette', table, families)
    await w.escape()
    await w.act('help.keys')
    await screen(w, 'keys', table, families)
    await w.escape()
    await w.act('help.syntax')
    await screen(w, 'syntax', table, families)
    await w.escape()
    await w.act('help.about')
    await screen(w, 'about', table, families)
    await w.escape()
    await v21_screens(w, table, families)
    await media_screens(w, table, families)

    used = await w.run('() => [...window.__i18nUsed]')
    for key in sorted(used):
        pair = table.get(key)
        if not pair:
            w.problems.append('t() asked for a key the table lacks: ' + key)
        elif not (pair[0] and pair[0].strip()) or not (pair[1] and pair[1].strip()):
            w.problems.append('key without text in both languages: %s %r' % (key, pair))
    csp = await w.run('() => window.__csp')
    if csp:
        w.problems.append('CSP violations: %r' % csp)
    w.problems.extend('page error: ' + e for e in w.errors)
    await page.close()
    return w, len(used), table


LITERAL_KEYS = [
    re.compile(r"""\bt\(\s*'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9-]+)+)'"""),
    re.compile(r"""\bt\.label\(\s*\[\s*'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9-]+)+)'"""),
    re.compile(r"""label:\s*\[\s*'([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9-]+)+)'\s*,\s*\{"""),
]


def literal_keys(root):
    keys = {}
    for path in sorted((root / 'src').rglob('*.js')):
        text = path.read_text(encoding='utf-8')
        for rx in LITERAL_KEYS:
            for m in rx.finditer(text):
                keys.setdefault(m.group(1), str(path.relative_to(root)))
    return keys


async def run(args):
    root = Path(args.root).resolve() if args.root else ROOT
    ensure_built(root)
    if args.shots:
        Path(args.shots).mkdir(parents=True, exist_ok=True)
    server = serve(root)
    base = 'http://127.0.0.1:%d/' % server.server_address[1]
    failed = False
    try:
        async with async_playwright() as p:
            browser = await launch(p)
            try:
                table = None
                for lang in ('ja', 'en'):
                    walk, n_used, table = await walk_page(browser, base, lang, args.shots)
                    for msg in walk.problems:
                        print('FAIL %s: %s' % (lang, msg))
                    failed = failed or bool(walk.problems)
                    print('%s   %s: %d screens, %d keys used at run time' % ('ok ' if not walk.problems else 'FAIL', lang,
                                                                         walk.screens, n_used))
                missing = []
                for key, where in sorted(literal_keys(root).items()):
                    pair = table.get(key)
                    if not pair or not (pair[0] or '').strip() or not (pair[1] or '').strip():
                        missing.append('%s (%s)' % (key, where))
                for msg in missing:
                    print('FAIL literal key without text in both languages: ' + msg)
                failed = failed or bool(missing)
                print('%s   literal keys in src/: every one has ja and en text' % ('ok ' if not missing else 'FAIL'))
            finally:
                await browser.close()
    finally:
        server.shutdown()
    print('i18n_pages.py: ' + ('FAILED' if failed else 'OK'))
    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser(description='ja / en page language check')
    ap.add_argument('--root', default='', help='serve another tree, with src/ and vendor/ (a staging copy)')
    ap.add_argument('--shots', default='', help='write a screenshot of every screen into this directory')
    return asyncio.run(run(ap.parse_args()))


if __name__ == '__main__':
    sys.exit(main())
